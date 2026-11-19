/**
 * Unified modal utilities for Active Review.
 * Consolidates: ConfirmModal, SyncConfirmModal, TextPromptModal,
 * UpdatePresetModal, LeaveModal.
 *
 * Note: LeaveModal intentionally stays as a standalone overlay function
 * because it must render on top of the quiz view (not as an Obsidian Modal).
 */
import { Modal, type App } from 'obsidian';
import { renderChipList, type ChipItem } from './ChipList';

// Shared base

abstract class BaseRvModal extends Modal {
    protected settled = false;
    protected applying = false;
    protected onDismissed?: () => void;

    onClose(): void {
        this.contentEl.empty();
        if (!this.settled) {
            this.settled = true;
            this.onDismissed?.();
        }
    }

    protected cancel(): void {
        if (this.settled) return;
        this.settled = true;
        this.close();
        this.onDismissed?.();
    }

    protected async apply(fn: () => void | Promise<void>): Promise<void> {
        if (this.applying) return;
        this.applying = true;
        this.settled = true;
        try {
            await fn();
        } finally {
            this.applying = false;
            this.close();
        }
    }
}

// ConfirmModal (also covers SyncConfirmModal)

export interface ConfirmModalOptions {
    title: string;
    message?: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
    /** Optional middle action button (neither cancel nor the destructive confirm). */
    alternateLabel?: string;
    onAlternate?: () => void | Promise<void>;
    /** Optional warning text (rendered above the list). */
    warning?: string;
    /** Optional list of items (max 5 shown + "… and N more"). */
    lines?: string[];
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
}

export class ConfirmModal extends BaseRvModal {
    constructor(app: App, private options: ConfirmModalOptions) {
        super(app);
        // Escape / click-outside dismissals count as a cancel too, so callers
        // that await an outcome (session delete, restart) never hang.
        this.onDismissed = options.onCancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.options.title });

        if (this.options.warning) {
            contentEl.createEl('p', { cls: 'mod-warning', text: this.options.warning });
        }
        if (this.options.message) {
            contentEl.createEl('p', { text: this.options.message });
        }

        if (this.options.lines && this.options.lines.length > 0) {
            const list = contentEl.createEl('ul', { cls: 'rv-sync-list' });
            const shown = this.options.lines.slice(0, 5);
            for (const line of shown) list.createEl('li', { text: line });
            if (this.options.lines.length > 5) {
                list.createEl('li', {
                    cls: 'rv-sync-more',
                    text: `… and ${this.options.lines.length - 5} more`,
                });
            }
        }

        const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
        const cancel = buttons.createEl('button', {
            text: this.options.cancelLabel ?? 'Cancel',
        });
        cancel.addEventListener('click', () => {
            if (this.settled) return;
            this.settled = true;
            this.close();
            this.options.onCancel?.();
        });

        if (this.options.alternateLabel && this.options.onAlternate) {
            const alternate = buttons.createEl('button', {
                text: this.options.alternateLabel,
            });
            alternate.addEventListener('click', () => {
                alternate.disabled = true;
                void this.apply(() => this.options.onAlternate?.());
            });
        }

        const confirm = buttons.createEl('button', {
            text: this.options.confirmLabel,
            cls: this.options.destructive ? 'mod-warning' : 'mod-cta',
        });
        confirm.addEventListener('click', () => {
            confirm.disabled = true;
            void this.apply(() => this.options.onConfirm());
        });
    }
}

// InfoModal — a one-button note. `onDismiss` fires exactly once however the
// modal goes away (OK, Escape, click-outside), so callers can use it as an
// "acknowledged" hook instead of a cancel/confirm pair.

export interface InfoModalOptions {
    title: string;
    message?: string;
    confirmLabel?: string;
    onDismiss?: () => void;
}

export class InfoModal extends BaseRvModal {
    constructor(app: App, private options: InfoModalOptions) {
        super(app);
        this.onDismissed = options.onDismiss;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.options.title });
        if (this.options.message) {
            contentEl.createEl('p', { text: this.options.message });
        }
        const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
        const ok = buttons.createEl('button', {
            text: this.options.confirmLabel ?? 'OK',
            cls: 'mod-cta',
        });
        ok.addEventListener('click', () => this.cancel());
    }
}

// TextPromptModal + factories

export interface TextPromptModalOptions {
    title: string;
    description?: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    allowEmpty?: boolean;
    onSave: (value: string) => void | Promise<void>;
    onCancel?: () => void;
}

export class TextPromptModal extends BaseRvModal {
    constructor(app: App, private options: TextPromptModalOptions) {
        super(app);
        this.onDismissed = options.onCancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.options.title });
        if (this.options.description) {
            contentEl.createEl('p', {
                cls: 'setting-item-description',
                text: this.options.description,
            });
        }

        const input = contentEl.createEl('input', {
            type: 'text',
            cls: 'rv-config-text',
            attr: { placeholder: this.options.placeholder ?? '' },
        });
        input.value = this.options.initialValue ?? '';
        input.focus();
        input.select();

        const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
        const cancel = buttons.createEl('button', { text: 'Cancel' });
        cancel.addEventListener('click', () => this.cancel());
        const save = buttons.createEl('button', {
            text: this.options.confirmLabel ?? 'Save',
            cls: 'mod-cta',
        });
        save.addEventListener('click', () => void this.doSubmit(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void this.doSubmit(input.value);
            }
        });
    }

    private async doSubmit(raw: string): Promise<void> {
        if (this.settled) return;
        const value = raw.trim();
        if (!this.options.allowEmpty && value === '') return;
        await this.apply(() => this.options.onSave(value));
    }
}

export interface RenameSessionPromptOptions {
    initialName: string;
    onSave: (name: string) => void | Promise<void>;
    onCancel?: () => void;
}

export function openRenameSessionPrompt(app: App, options: RenameSessionPromptOptions): void {
    new TextPromptModal(app, {
        title: 'Session name',
        description: 'Optional. Leave empty to display only the session ID.',
        initialValue: options.initialName,
        placeholder: 'My practice run',
        confirmLabel: 'Save',
        allowEmpty: true,
        onSave: options.onSave,
        onCancel: options.onCancel,
    }).open();
}

export interface SavePresetPromptOptions {
    initialName: string;
    onSave: (name: string) => void | Promise<void>;
    title?: string;
    confirmLabel?: string;
}

export function openSavePresetPrompt(app: App, options: SavePresetPromptOptions): void {
    new TextPromptModal(app, {
        title: options.title ?? 'Save preset',
        initialValue: options.initialName,
        placeholder: 'Preset name',
        confirmLabel: options.confirmLabel ?? 'Save',
        onSave: options.onSave,
    }).open();
}

export interface FolderNamePromptOptions {
    initialName: string;
    onSave: (name: string) => void | Promise<void>;
}

export function openFolderNamePrompt(app: App, options: FolderNamePromptOptions): void {
    new TextPromptModal(app, {
        title: 'Add subcategory',
        initialValue: options.initialName,
        placeholder: 'Category name',
        confirmLabel: 'Create',
        onSave: options.onSave,
    }).open();
}

// UpdatePresetModal (chip picker)

export interface UpdatePresetPromptOptions {
    title?: string;
    presets: { id: string; name: string }[];
    initialPresetId?: string;
    confirmLabel?: string;
    onSave: (presetId: string) => void | Promise<void>;
    onCancel?: () => void;
}

export class UpdatePresetModal extends BaseRvModal {
    private selectedPresetId: string | null = null;
    private listEl: HTMLElement | null = null;
    private saveBtn: HTMLButtonElement | null = null;

    constructor(app: App, private options: UpdatePresetPromptOptions) {
        super(app);
        this.onDismissed = options.onCancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('rv-modal-with-cancel', 'rv-update-preset-modal');
        contentEl.createEl('h2', { text: this.options.title ?? 'Update preset' });
        contentEl.createEl('p', {
            cls: 'setting-item-description',
            text: 'Choose which preset to overwrite with the current configuration.',
        });

        if (this.options.presets.length === 0) {
            contentEl.createEl('p', {
                cls: 'setting-item-description',
                text: 'No presets available to update.',
            });
            const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
            const cancel = buttons.createEl('button', { text: 'Close' });
            cancel.addEventListener('click', () => this.cancel());
            return;
        }

        this.selectedPresetId = this.options.initialPresetId ?? null;

        const row = contentEl.createDiv({ cls: 'rv-config-row rv-update-preset-row' });
        row.createEl('label', { cls: 'rv-config-label', text: 'Preset' });
        this.listEl = row.createDiv({ cls: 'rv-update-preset-list' });

        const buttons = contentEl.createDiv({
            cls: 'modal-button-container rv-update-preset-actions',
        });
        const cancel = buttons.createEl('button', { text: 'Cancel' });
        cancel.addEventListener('click', () => this.cancel());

        this.saveBtn = buttons.createEl('button', {
            text: this.options.confirmLabel ?? 'Update',
            cls: 'mod-cta',
        });
        this.saveBtn.addEventListener('click', () => void this.doSave());

        this.renderList();
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.empty();
        const items: ChipItem[] = this.options.presets.map((preset) => ({
            label: preset.name,
            active: preset.id === this.selectedPresetId,
            onClick: () => {
                this.selectedPresetId = this.selectedPresetId === preset.id ? null : preset.id;
                this.renderList();
            },
        }));
        renderChipList({
            parent: this.listEl,
            items,
            rowClass: 'rv-modes',
            limit: items.length,
            expanded: true,
            onExpandedChange: () => {},
        });
        if (this.saveBtn) this.saveBtn.disabled = this.selectedPresetId === null;
    }

    private async doSave(): Promise<void> {
        if (!this.selectedPresetId) return;
        const id = this.selectedPresetId;
        await this.apply(() => this.options.onSave(id));
    }
}

export function openUpdatePresetPrompt(app: App, options: UpdatePresetPromptOptions): void {
    new UpdatePresetModal(app, options).open();
}

// OpenReviewTabModal (already-open detection)

export interface OpenReviewTabModalOptions {
    tabs: { label: string; onSelect: () => void }[];
    onNewTab: () => void | Promise<void>;
    onCancel?: () => void;
}

export class OpenReviewTabModal extends BaseRvModal {
    constructor(app: App, private options: OpenReviewTabModalOptions) {
        super(app);
        this.onDismissed = options.onCancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Active Review is already open' });
        contentEl.createEl('p', {
            cls: 'mod-warning',
            text: 'Opening it again creates another Active Review tab. Tabs that open the same session stay synchronized; tabs on different sessions run independently.',
        });

        if (this.options.tabs.length > 0) {
            contentEl.createEl('p', {
                cls: 'setting-item-description',
                text: 'Switch to an existing tab:',
            });
            const list = contentEl.createDiv({ cls: 'rv-open-tab-list' });
            for (const tab of this.options.tabs) {
                const row = list.createDiv({ cls: 'rv-open-tab-row' });
                row.createSpan({ cls: 'rv-open-tab-label', text: tab.label });
                const button = row.createEl('button', { text: 'Switch' });
                button.addEventListener('click', () => {
                    if (this.settled) return;
                    void this.apply(() => tab.onSelect());
                });
            }
        }

        const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
        const cancel = buttons.createEl('button', { text: 'Cancel' });
        cancel.addEventListener('click', () => this.cancel());
        const newTab = buttons.createEl('button', {
            text: 'Open new tab',
            cls: 'mod-cta',
        });
        newTab.addEventListener('click', () => {
            newTab.disabled = true;
            void this.apply(() => this.options.onNewTab());
        });
    }
}

// LeaveModal (overlay — must NOT be a Modal subclass)

export interface LeaveModalProps {
    parent: HTMLElement;
    answered: number;
    onLeave: () => void;
}

export function showLeaveModal(props: LeaveModalProps): void {
    const overlay = props.parent.createDiv({ cls: 'rv-modal-overlay' });
    const box = overlay.createDiv({ cls: 'rv-modal' });
    box.createEl('h3', { text: 'Leave this session?' });
    box.createEl('p', {
        cls: 'rv-muted',
        text:
            `${props.answered} question${props.answered === 1 ? '' : 's'} answered. ` +
            `This session stays pending — you can continue it from Session history.`,
    });
    const actions = box.createDiv({ cls: 'rv-modal-actions' });
    const stay = actions.createEl('button', { text: 'Stay' });
    const leave = actions.createEl('button', { text: 'Leave', cls: 'mod-cta' });

    const close = (): void => {
        overlay.remove();
        activeDocument.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') close();
    };
    activeDocument.addEventListener('keydown', onKey);

    stay.addEventListener('click', close);
    leave.addEventListener('click', () => { close(); props.onLeave(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    stay.focus();
}
