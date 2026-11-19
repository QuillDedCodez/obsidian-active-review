/** Preset list engine plus the shared export/import panes. */
import { App, Notice, normalizePath, setIcon } from 'obsidian';
import type ReviewQuizPlugin from '../../main';
import { ConfirmModal, openSavePresetPrompt } from '../Modals';
import { createCopyButton, type CopyButton } from '../CopyButton';
import { attachListReorder } from '../Reorder';

export interface PresetManagerContext {
    app: App;
    plugin: ReviewQuizPlugin;
    containerEl: HTMLElement;
}

export type PresetMode = 'list' | 'export' | 'import';

export interface PresetItem {
    id: string;
    name: string;
    showOnStart?: boolean;
}

export type PresetRenameResult<T extends PresetItem> =
    | { ok: true; name: string; next: T[] }
    | { ok: false; reason: 'empty' | 'duplicate' };

/** Shared rename rules: trim, reject empty, reject case-insensitive duplicates. */
export function resolvePresetRename<T extends PresetItem>(
    items: T[],
    id: string,
    rawName: string,
): PresetRenameResult<T> {
    const name = rawName.trim();
    if (!name) return { ok: false, reason: 'empty' };
    if (items.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, reason: 'duplicate' };
    }
    return {
        ok: true,
        name,
        next: items.map((p) => (p.id === id ? { ...p, name } : p)),
    };
}

export abstract class PresetManager<T extends PresetItem> {
    protected selection = new Set<string>();
    protected mode: PresetMode = 'list';
    protected reorderInFlight = false;
    protected reorderActive = false;
    protected containerEl: HTMLElement;
    protected app: App;
    protected plugin: ReviewQuizPlugin;
    private detachReorder: (() => void) | null = null;

    constructor(ctx: PresetManagerContext) {
        this.app = ctx.app;
        this.plugin = ctx.plugin;
        this.containerEl = ctx.containerEl;
    }

    // ---- Subclass hooks ----
    protected abstract getItems(): T[];
    protected abstract saveItems(next: T[]): Promise<void>;
    protected abstract renderDetail(item: T): string;
    protected abstract renderExportView(host: HTMLElement): void;
    protected abstract renderImportView(host: HTMLElement): void;
    protected abstract emptyListMessage(): string;
    protected abstract readonly itemNoun: string;

    /** True while a row is held or its order is being persisted. */
    isReordering(): boolean {
        return this.reorderActive || this.reorderInFlight;
    }

    // ---- Public lifecycle ----
    render(): void {
        // Never tear the list out from under an active drag. The DOM already
        // shows the new order and the drop handler persists it.
        if (this.isReordering()) return;
        this.detachReorder?.();
        this.detachReorder = null;
        this.containerEl.empty();
        if (this.mode === 'export') return this.renderExport();
        if (this.mode === 'import') return this.renderImport();
        this.renderList();
    }

    destroy(): void {
        this.selection.clear();
        this.reorderActive = false;
        this.reorderInFlight = false;
        this.detachReorder?.();
        this.detachReorder = null;
        this.containerEl.empty();
    }

    // ---- Shared list ----
    private renderList(): void {
        const items = this.getItems();
        const validIds = new Set(items.map((i) => i.id));
        for (const id of [...this.selection]) {
            if (!validIds.has(id)) this.selection.delete(id);
        }

        const actions = this.containerEl.createDiv({ cls: 'rv-preset-toolbar rv-preset-toolbar-top' });
        this.renderToolbar(actions, items.length);
        if (this.selection.size > 0) this.renderBulkBar();

        if (items.length === 0) {
            this.containerEl.createEl('p', {
                cls: 'setting-item-description',
                text: this.emptyListMessage(),
            });
            return;
        }

        const list = this.containerEl.createDiv({ cls: 'rv-preset-list' });
        items.forEach((item) => this.renderRow(list, item));
        this.wireReorder(list);
    }

    private renderToolbar(actions: HTMLElement, count: number): void {
        const exportBtn = actions.createEl('button', { text: 'Export presets…', cls: 'rv-preset-tool' });
        exportBtn.disabled = count === 0;
        exportBtn.addEventListener('click', () => { this.mode = 'export'; this.render(); });

        const importBtn = actions.createEl('button', { text: 'Import presets…', cls: 'rv-preset-tool' });
        importBtn.addEventListener('click', () => { this.mode = 'import'; this.render(); });

        this.renderToolbarExtras(actions);
    }

    /** Optional hook for subclasses to inject buttons next to Import. */
    protected renderToolbarExtras(_actions: HTMLElement): void {}

    private renderBulkBar(): void {
        const bar = this.containerEl.createDiv({ cls: 'rv-preset-bulk' });
        bar.createSpan({
            cls: 'rv-preset-bulk-count',
            text: `${this.selection.size} selected`,
        });
        this.renderBulkExtras(bar);
        const clearBtn = bar.createEl('button', { cls: 'rv-preset-tool', text: 'Clear selection' });
        clearBtn.addEventListener('click', () => {
            this.selection.clear();
            this.render();
        });
    }

    protected bulkDelete(verb: string, description: string): void {
        const count = this.selection.size;
        new ConfirmModal(this.app, {
            title: `Delete ${count} ${verb}${count === 1 ? '' : 's'}?`,
            message: description,
            confirmLabel: 'Delete',
            destructive: true,
            onConfirm: async () => {
                const next = this.getItems().filter((i) => !this.selection.has(i.id));
                await this.saveItems(next);
                this.selection.clear();
                this.plugin.refreshIdleViews();
                this.render();
            },
        }).open();
    }

    protected confirmDelete(verb: string, description: string, id: string): void {
        new ConfirmModal(this.app, {
            title: `Delete ${verb}?`,
            message: description,
            confirmLabel: 'Delete',
            destructive: true,
            onConfirm: async () => {
                const next = this.getItems().filter((i) => i.id !== id);
                await this.saveItems(next);
                this.plugin.refreshIdleViews();
                this.render();
            },
        }).open();
    }

    /** Shared rename flow: trim, reject duplicate names, persist, refresh. */
    protected renamePreset(item: T, label: string): void {
        openSavePresetPrompt(this.app, {
            initialName: item.name,
            title: `Rename ${label}`,
            confirmLabel: 'Rename',
            onSave: async (name) => {
                const result = resolvePresetRename(this.getItems(), item.id, name);
                if (!result.ok) {
                    if (result.reason === 'duplicate') {
                        this.toast(`A ${label} with that name already exists.`);
                    }
                    return;
                }
                await this.saveItems(result.next);
                this.plugin.refreshIdleViews();
                this.render();
            },
        });
    }

    protected rowDeleteMessage(item: T): string {
        return `"${item.name}" will be removed.`;
    }

    protected bulkDeleteMessage(): string {
        return 'These presets will be removed.';
    }

    protected renderRowActions(actions: HTMLElement, item: T): void {
        const renameBtn = actions.createEl('button', { cls: 'rv-preset-action', text: 'Rename' });
        renameBtn.addEventListener('click', () => this.renamePreset(item, this.itemNoun));
        const visible = item.showOnStart !== false;
        const toggleBtn = actions.createEl('button', { cls: 'rv-preset-action', text: visible ? 'Hide on start' : 'Show on start' });
        toggleBtn.addEventListener('click', () => {
            void (async () => {
                const next = this.getItems().map((p) => p.id === item.id ? { ...p, showOnStart: !visible } : p);
                await this.saveItems(next);
                this.plugin.refreshIdleViews();
                this.render();
            })();
        });

        this.renderRowActionsExtras(actions, item);
        const delBtn = actions.createEl('button', {
            cls: 'rv-preset-action rv-preset-action-danger',
            text: 'Delete',
        });
        delBtn.addEventListener('click', () =>
            this.confirmDelete(this.itemNoun, this.rowDeleteMessage(item), item.id),
        );
    }

    /** Optional extra row buttons, inserted between Rename and Delete. */
    protected renderRowActionsExtras(_actions: HTMLElement, _item: T): void {}

    protected renderBulkExtras(bar: HTMLElement): void {
        const delBtn = bar.createEl('button', {
            cls: 'rv-preset-tool mod-warning',
            text: 'Delete selected',
        });
        delBtn.addEventListener('click', () =>
            this.bulkDelete(this.itemNoun, this.bulkDeleteMessage()),
        );
    }

    private renderRow(parent: HTMLElement, item: T): void {
        const row = parent.createDiv({
            cls: 'rv-preset-row',
            attr: { 'data-preset-id': item.id },
        });

        const check = row.createEl('input', { type: 'checkbox', cls: 'rv-preset-check' });
        check.checked = this.selection.has(item.id);
        check.addEventListener('change', () => {
            if (check.checked) this.selection.add(item.id);
            else this.selection.delete(item.id);
            this.render();
        });

        this.renderDragHandle(row);
        const main = row.createDiv({ cls: 'rv-preset-main' });
        main.createSpan({ cls: 'rv-preset-name', text: item.name });
        main.createSpan({ cls: 'rv-preset-detail', text: this.renderDetail(item) });

        const actions = row.createDiv({ cls: 'rv-preset-actions' });
        this.renderRowActions(actions, item);
    }

    private renderDragHandle(row: HTMLElement): void {
        const handle = row.createSpan({
            cls: 'rv-preset-drag',
            attr: { title: 'Drag to reorder', 'aria-label': 'Reorder preset' },
        });
        setIcon(handle, 'menu');
    }

    private wireReorder(list: HTMLElement): void {
        this.detachReorder?.();
        this.detachReorder = attachListReorder(list, {
            itemSelector: '.rv-preset-row',
            handleSelector: '.rv-preset-drag',
            onStart: () => {
                this.reorderActive = true;
            },
            onEnd: () => {
                void this.persistRowOrder(list).finally(() => {
                    this.reorderActive = false;
                    this.reorderInFlight = false;
                });
            },
        });
    }

    /** Persist the order the user left in the DOM, without re-rendering mid-settle. */
    private async persistRowOrder(list: HTMLElement): Promise<void> {
        const items = this.getItems();
        const byId = new Map(items.map((item) => [item.id, item]));
        const ordered: T[] = [];
        for (const child of Array.from(list.children)) {
            const id = child.getAttribute('data-preset-id');
            const item = id ? byId.get(id) : undefined;
            if (item) ordered.push(item);
        }
        if (ordered.length !== items.length) {
            this.render();
            return;
        }
        if (ordered.every((item, index) => item === items[index])) return;
        this.reorderInFlight = true;
        try {
            await this.saveItems(ordered);
            this.plugin.refreshIdleViews();
        } catch (e) {
            console.error('Could not save preset order', e);
            this.reorderInFlight = false;
            this.reorderActive = false;
            this.render();
        } finally {
            this.reorderInFlight = false;
        }
    }

    private renderExport(): void {
        this.renderLocalBack();
        const host = this.containerEl.createDiv({ cls: 'rv-preset-body' });
        this.renderExportView(host);
    }

    private renderImport(): void {
        this.renderLocalBack();
        const host = this.containerEl.createDiv({ cls: 'rv-import-host' });
        this.renderImportView(host);
    }

    private renderLocalBack(): void {
        const back = this.containerEl.createEl('button', {
            cls: 'rv-settings-back',
            text: '← Back to presets',
            attr: { type: 'button' },
        });
        back.addEventListener('click', () => { this.mode = 'list'; this.render(); });
    }

    protected toast(msg: string): void {
        new Notice(msg);
    }
}
// ============================================================================
// Import preview helpers (shared by every import surface)
// ============================================================================

export type ImportCountTone =
    | 'total'
    | 'move'
    | 'noop'
    | 'ready'
    | 'missing'
    | 'ambiguous'
    | 'conflict'
    | 'invalid';

export interface ImportCountItem {
    count: number;
    label: string;
    tone?: ImportCountTone;
}

export interface ImportDetailsParts {
    details: HTMLDetailsElement;
    body: HTMLElement;
}

export interface ImportFilesSection {
    details: HTMLDetailsElement;
    scroll: HTMLElement;
}

export function renderImportCounts(
    parent: HTMLElement,
    items: ImportCountItem[],
): HTMLElement {
    const bar = parent.createDiv({ cls: 'rv-import-counts' });
    for (const item of items) {
        const tone = item.tone ? ` rv-import-count-${item.tone}` : '';
        const pill = bar.createDiv({ cls: `rv-import-count-pill${tone}` });
        pill.createSpan({ cls: 'rv-import-count-value', text: String(item.count) });
        pill.createSpan({ cls: 'rv-import-count-label', text: item.label });
    }
    return bar;
}

export function createImportDetails(
    parent: HTMLElement,
    label: string,
    count: number,
    open = true,
): ImportDetailsParts {
    const details = parent.createEl('details', { cls: 'rv-import-details' });
    details.open = open;
    const summary = details.createEl('summary', { cls: 'rv-import-details-summary' });
    summary.createSpan({ cls: 'rv-import-details-title', text: label });
    summary.createSpan({ cls: 'rv-import-details-count', text: `(${count})` });
    const body = details.createDiv({ cls: 'rv-import-details-body' });
    return { details, body };
}

export function createImportFilesSection(
    parent: HTMLElement,
    title: string,
    count: number,
    open = true,
): ImportFilesSection {
    const details = parent.createEl('details', {
        cls: 'rv-import-details rv-import-files',
    });
    details.open = open;
    const summary = details.createEl('summary', { cls: 'rv-import-details-summary' });
    summary.createSpan({ cls: 'rv-import-details-title', text: title });
    summary.createSpan({ cls: 'rv-import-details-count', text: `(${count})` });
    const body = details.createDiv({
        cls: 'rv-import-details-body rv-import-files-body',
    });
    const scroll = body.createDiv({ cls: 'rv-import-files-scroll' });
    return { details, scroll };
}

/**
 * Give every open subsection the same explicit height inside the fixed
 * preview area. CSS flex handles the common case; this pass keeps each body
 * scrollable when the textarea or window changes the available height.
 */
export function layoutImportPreview(preview: HTMLElement): void {
    if (preview.clientHeight <= 0) return;
    const style = getComputedStyle(preview);
    const paddingY =
        (parseFloat(style.paddingTop) || 0) +
        (parseFloat(style.paddingBottom) || 0);
    const gap = parseFloat(style.rowGap) || 0;
    const children = Array.from(preview.children);
    const details = children.filter(
        (child): child is HTMLDetailsElement =>
            child.instanceOf(HTMLDetailsElement) &&
            child.classList.contains('rv-import-details'),
    );
    if (details.length === 0) return;

    for (const item of details) {
        if (!item.open) clearDetailsHeight(item);
    }

    const fixed = children
        .filter((child) => !details.includes(child as HTMLDetailsElement))
        .reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
    const closed = details.filter((item) => !item.open);
    const open = details.filter((item) => item.open);
    const closedHeight = closed.reduce((sum, item) => sum + item.offsetHeight, 0);
    const gaps = Math.max(0, children.length - 1) * gap;
    const available = Math.max(
        0,
        preview.clientHeight - paddingY - fixed - closedHeight - gaps,
    );
    const each = open.length > 0 ? Math.floor(available / open.length) : 0;

    for (const item of details) {
        const body = item.querySelector<HTMLElement>(
            ':scope > .rv-import-details-body',
        );
        if (item.open) {
            item.setCssProps({ '--rv-import-details-height': `${each}px` });
            if (body) {
                const summary = item.querySelector<HTMLElement>(':scope > summary');
                const bodyHeight = Math.max(0, each - (summary?.offsetHeight ?? 0));
                body.setCssProps({
                    '--rv-import-details-body-height': `${bodyHeight}px`,
                });
            }
        } else {
            clearDetailsHeight(item);
        }
    }
}

function clearDetailsHeight(item: HTMLDetailsElement): void {
    item.setCssProps({ '--rv-import-details-height': '' });
    const body = item.querySelector<HTMLElement>(
        ':scope > .rv-import-details-body',
    );
    if (body) body.setCssProps({ '--rv-import-details-body-height': '' });
}

export function renderImportWarnings(parent: HTMLElement, warnings: string[]): void {
    if (warnings.length === 0) return;
    const details = parent.createEl('details', { cls: 'rv-warnings' });
    details.createEl('summary', {
        text: `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
    });
    const ul = details.createEl('ul');
    for (const warning of warnings) ul.createEl('li', { text: warning });
}

// ============================================================================
// Export pane
// ============================================================================

export interface PresetExportItem { id: string; name: string; detail: string; }

export interface PresetExportBuild { manifest: unknown; warnings: string[]; }

export interface PresetExportConfig {
    emptyText: string;
    noSelectionText: string;
    saveTitle: string;
    defaultFileName: string;
    copySuccessText: string;
    items: PresetExportItem[];
    build: (selected: ReadonlySet<string>) => PresetExportBuild;
    summary: (selected: ReadonlySet<string>) => string;
    renderExtras?: (host: HTMLElement) => void;
}

export class PresetExportPane {
    private selected: Set<string>;
    private summaryEl!: HTMLElement;
    private warningEl!: HTMLElement;
    private copyBtn: CopyButton | null = null;
    private pendingWarnings: string[] = [];
    private saveBtn!: HTMLButtonElement;
    private listEl: HTMLElement | null = null;

    constructor(
        private app: App,
        private reviewDir: string,
        private config: PresetExportConfig,
    ) {
        this.selected = new Set(config.items.map((i) => i.id));
    }

    render(containerEl: HTMLElement): void {
        containerEl.empty();
        const toolbar = containerEl.createDiv({ cls: 'rv-preset-toolbar' });
        const all = toolbar.createEl('button', { text: 'Select all', cls: 'rv-preset-tool' });
        all.disabled = this.config.items.length === 0;
        all.addEventListener('click', () => {
            this.selected = new Set(this.config.items.map((i) => i.id));
            this.renderList();
        });
        const none = toolbar.createEl('button', { text: 'Select none', cls: 'rv-preset-tool' });
        none.disabled = this.config.items.length === 0;
        none.addEventListener('click', () => {
            this.selected.clear();
            this.renderList();
        });

        if (this.config.items.length === 0) {
            containerEl.createEl('p', { cls: 'rv-preset-empty', text: this.config.emptyText });
        } else {
            this.listEl = containerEl.createDiv({ cls: 'rv-export-list' });
        }

        this.config.renderExtras?.(containerEl);
        this.summaryEl = containerEl.createDiv({ cls: 'rv-export-summary rv-preset-summary' });
        this.warningEl = containerEl.createDiv({ cls: 'rv-export-warnings' });

        const buttons = containerEl.createDiv({ cls: 'rv-preset-footer' });
        this.copyBtn?.destroy();
        this.copyBtn = createCopyButton(buttons, {
            label: 'Copy JSON',
            ariaLabel: 'Copy selected presets as JSON',
            feedback: 'notice',
            successNotice: this.config.copySuccessText,
            beforeCopy: () => {
                if (this.selected.size === 0) {
                    new Notice(this.config.noSelectionText);
                    return false;
                }
                return true;
            },
            getText: () => {
                const result = this.config.build(this.selected);
                this.pendingWarnings = result.warnings;
                return JSON.stringify(result.manifest, null, 2);
            },
            onCopied: () => this.showWarnings(this.pendingWarnings),
        });
        this.saveBtn = buttons.createEl('button', { text: 'Save JSON', cls: 'mod-cta' });
        this.saveBtn.addEventListener('click', () => this.saveJson());

        this.renderList();
    }

    private renderList(): void {
        if (this.listEl) {
            this.listEl.empty();
            for (const item of this.config.items) this.createRow(item);
        }
        this.updateSummary();
    }

    private updateSummary(): void {
        this.summaryEl.setText(this.config.summary(this.selected));
        this.warningEl.empty();
        const n = this.selected.size;
        this.copyBtn?.setDisabled(n === 0);
        this.saveBtn.disabled = n === 0;
        if (this.config.items.length === 0) {
            this.warningEl.createEl('p', { cls: 'rv-muted', text: this.config.emptyText });
        } else if (n === 0) {
            this.warningEl.createEl('p', { cls: 'rv-muted', text: this.config.noSelectionText });
        }
    }

    private saveJson(): void {
        if (this.selected.size === 0) { new Notice(this.config.noSelectionText); return; }
        openSavePresetPrompt(this.app, {
            initialName: this.config.defaultFileName,
            title: this.config.saveTitle,
            confirmLabel: 'Save',
            onSave: async (name) => {
                const result = this.config.build(this.selected);
                const clean = name
                    .trim()
                    .replace(/\.json$/i, '')
                    .replace(/[\\/:*?"<>|]/g, '-')
                    .replace(/\s+/g, '-');
                const base = clean || `${this.config.defaultFileName}-${Date.now()}`;
                let path = normalizePath(`${this.reviewDir}/${base}.json`);
                let n = 2;
                while (this.app.vault.getAbstractFileByPath(path)) {
                    path = normalizePath(`${this.reviewDir}/${base}-${n}.json`);
                    n++;
                }
                try {
                    await this.app.vault.create(path, JSON.stringify(result.manifest, null, 2));
                    new Notice(`Saved ${path}.`);
                    this.showWarnings(result.warnings);
                } catch (e) {
                    new Notice(`Could not save manifest: ${(e as Error).message}`);
                }
            },
        });
    }

    private showWarnings(warnings: string[]): void {
        this.warningEl.empty();
        if (warnings.length === 0) return;
        const details = this.warningEl.createEl('details', { cls: 'rv-warnings' });
        details.createEl('summary', {
            text: `${warnings.length} export warning${warnings.length === 1 ? '' : 's'}`,
        });
        const ul = details.createEl('ul');
        for (const w of warnings) ul.createEl('li', { text: w });
    }

    private createRow(item: PresetExportItem): void {
        if (!this.listEl) return;
        const row = this.listEl.createEl('label', { cls: 'rv-export-row' });
        const check = row.createEl('input', { type: 'checkbox' });
        check.checked = this.selected.has(item.id);
        check.addEventListener('change', () => {
            if (check.checked) this.selected.add(item.id);
            else this.selected.delete(item.id);
            this.updateSummary();
        });
        row.createSpan({ cls: 'rv-export-name', text: item.name });
        row.createSpan({ cls: 'rv-export-count', text: item.detail });
    }
}

// ============================================================================
// Import pane
// ============================================================================

export interface PresetImportModeOption {
    value: string;
    label: string;
    title?: string;
}

export interface PresetImportParseResult<M> {
    manifest: M | null;
    errors: string[];
    warnings: string[];
}

export interface PresetImportConfig<M, P> {
    placeholder: string;
    modes: PresetImportModeOption[];
    initialMode: string;
    applyLabel?: string;
    parse: (text: string) => PresetImportParseResult<M>;
    buildPreview: (manifest: M) => { preview: P; warnings: string[] };
    canApply: (preview: P, mode: string) => boolean;
    hasErrors?: (preview: P) => boolean;
    confirm: (preview: P, mode: string) => {
        title: string;
        message: string;
        confirmLabel: string;
        destructive?: boolean;
    };
    apply: (
        manifest: M,
        preview: P,
        mode: string,
    ) => Promise<{ notice: string; errors?: string[] }>;
    onApplied?: (result: { notice: string; errors?: string[] }) => void;
}

export abstract class PresetImportPane<M, P> {
    protected previewEl!: HTMLElement;
    protected currentManifest: M | null = null;
    protected currentPreview: P | null = null;
    protected currentWarnings: string[] = [];
    protected currentMode: string;
    protected applied = false;

    private inputEl!: HTMLTextAreaElement;
    private modeEl!: HTMLSelectElement;
    private applyBtn!: HTMLButtonElement;
    private loadBtn!: HTMLButtonElement;
    private previewBtn!: HTMLButtonElement;
    private fileInputEl!: HTMLInputElement;
    private observer: ResizeObserver | null = null;
    private frame: number | null = null;

    constructor(protected app: App, protected config: PresetImportConfig<M, P>) {
        this.currentMode = config.initialMode;
    }

    protected abstract renderPreviewContent(preview: P): void;
    protected onPreviewLoaded(): void {}
    protected renderAppliedContent(_r: { notice: string; errors?: string[] }): void {}

    render(containerEl: HTMLElement): void {
        // Clears only the dedicated host div (see renderSessionImportPage /
        // renderImportView); the settings tab's back button and headings live
        // outside this subtree.
        containerEl.empty();
        const jsonSection = containerEl.createDiv({ cls: 'rv-import-json-section' });
        jsonSection.createEl('h3', { cls: 'rv-import-section-title', text: 'JSON import' });
        this.inputEl = jsonSection.createEl('textarea', {
            cls: 'rv-import-json',
            attr: { rows: '4', placeholder: this.config.placeholder, spellcheck: 'false' },
        });

        this.fileInputEl = jsonSection.createEl('input', {
            type: 'file',
            cls: 'rv-hidden',
            attr: { accept: '.json,application/json' },
        });
        const fileRow = jsonSection.createDiv({ cls: 'rv-import-file-row' });
        this.loadBtn = fileRow.createEl('button', { text: 'Load JSON file', cls: 'rv-manage-tool' });
        this.loadBtn.addEventListener('click', () => this.fileInputEl.click());
        this.fileInputEl.addEventListener('change', () => void this.loadFile());
        this.previewBtn = fileRow.createEl('button', { text: 'Preview import', cls: 'mod-cta' });
        this.previewBtn.addEventListener('click', () => this.renderPreview());

        const modeRow = fileRow.createDiv({ cls: 'rv-import-mode-row' });
        modeRow.createEl('label', { text: 'Preset action' });
        this.modeEl = modeRow.createEl('select', { cls: 'dropdown' });
        for (const m of this.config.modes) {
            this.modeEl.createEl('option', { text: m.label, attr: { value: m.value } });
        }
        this.modeEl.value = this.config.initialMode;
        const titled = this.config.modes.find((m) => m.title);
        if (titled) this.modeEl.setAttr('title', titled.title ?? '');
        this.modeEl.addEventListener('change', () => {
            this.currentMode = this.modeEl.value;
            this.updateApplyState();
        });

        this.previewEl = containerEl.createDiv({ cls: 'rv-import-preview' });
        this.previewEl.createEl('h3', {
            cls: 'rv-import-section-title rv-import-preview-title',
            text: 'Preview',
        });
        this.previewEl.createEl('p', {
            cls: 'rv-import-empty',
            text: 'Paste a manifest or load a JSON file, then choose Preview import.',
        });

        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.scheduleLayout());
            this.observer.observe(this.previewEl);
            this.observer.observe(this.inputEl);
        }

        const footer = containerEl.createDiv({ cls: 'rv-preset-footer' });
        this.applyBtn = footer.createEl('button', {
            text: this.config.applyLabel ?? 'Apply import',
            cls: 'mod-cta',
        });
        this.applyBtn.disabled = true;
        this.applyBtn.addEventListener('click', () => this.confirmApply());
    }

    destroy(): void {
        if (this.frame !== null) window.cancelAnimationFrame(this.frame);
        this.frame = null;
        this.observer?.disconnect();
        this.observer = null;
    }

    protected updateApplyState(): void {
        const p = this.currentPreview;
        this.applyBtn.disabled =
            this.applied ||
            !p ||
            (this.config.hasErrors?.(p) ?? false) ||
            !this.config.canApply(p, this.currentMode);
    }

    protected wirePreviewLayout(): void {
        const items = Array.from(
            this.previewEl.querySelectorAll<HTMLDetailsElement>(
                ':scope > details.rv-import-details',
            ),
        );
        for (const item of items) item.addEventListener('toggle', () => this.scheduleLayout());
        this.scheduleLayout();
    }

    protected scheduleLayout(): void {
        if (this.frame !== null) return;
        this.frame = window.requestAnimationFrame(() => {
            this.frame = null;
            layoutImportPreview(this.previewEl);
        });
    }

    private async loadFile(): Promise<void> {
        if (this.applied) return;
        const file = this.fileInputEl.files?.[0];
        if (!file) return;
        try {
            this.inputEl.value = await file.text();
            this.renderPreview();
        } catch (e) {
            this.renderErrors([`Could not read file: ${(e as Error).message}`]);
        } finally {
            this.fileInputEl.value = '';
        }
    }

    private renderErrors(errors: string[]): void {
        this.currentManifest = null;
        this.currentPreview = null;
        this.applyBtn.disabled = true;
        this.previewEl.empty();
        this.previewEl.removeClass('is-applied');
        this.previewEl.createEl('h3', {
            cls: 'rv-import-section-title rv-import-preview-title',
            text: 'Preview',
        });
        const box = this.previewEl.createDiv({ cls: 'rv-import-errors' });
        box.createEl('strong', { text: 'Import preview failed' });
        const ul = box.createEl('ul');
        for (const e of errors) ul.createEl('li', { text: e });
    }

    private renderPreview(): void {
        if (this.applied) return;
        const parsed = this.config.parse(this.inputEl.value);
        if (!parsed.manifest) {
            this.renderErrors(parsed.errors.length > 0 ? parsed.errors : ['Invalid manifest.']);
            return;
        }
        const built = this.config.buildPreview(parsed.manifest);
        this.currentManifest = parsed.manifest;
        this.currentPreview = built.preview;
        this.currentWarnings = [...parsed.warnings, ...built.warnings];
        this.applied = false;
        this.applyBtn.setText(this.config.applyLabel ?? 'Apply import');
        this.previewEl.removeClass('is-applied');
        this.onPreviewLoaded();
        this.renderPreviewContent(built.preview);
        this.updateApplyState();
    }

    private confirmApply(): void {
        const manifest = this.currentManifest;
        const preview = this.currentPreview;
        if (!manifest || !preview || this.applied) return;
        const mode = this.currentMode;
        const message = this.config.confirm(preview, mode);
        new ConfirmModal(this.app, {
            ...message,
            onConfirm: async () => {
                this.applyBtn.disabled = true;
                this.applyBtn.setText('Applying…');
                try {
                    const result = await this.config.apply(manifest, preview, mode);
                    this.applied = true;
                    new Notice(result.notice);
                    this.renderApplied(result);
                    this.config.onApplied?.(result);
                } catch (e) {
                    this.renderErrors([`Apply failed: ${(e as Error).message}`]);
                    new Notice(`Import failed: ${(e as Error).message}`);
                }
            },
        }).open();
    }

    private renderApplied(result: { notice: string; errors?: string[] }): void {
        this.previewEl.empty();
        this.previewEl.addClass('is-applied');
        this.previewEl.createEl('h4', { text: 'Import applied' });
        this.renderAppliedContent(result);
        if (result.errors?.length) {
            const details = this.previewEl.createEl('details', { cls: 'rv-import-errors' });
            details.createEl('summary', {
                text: `${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`,
            });
            const ul = details.createEl('ul');
            for (const e of result.errors) ul.createEl('li', { text: e });
        }
        this.modeEl.disabled = true;
        this.applyBtn.disabled = true;
        this.applyBtn.setText('Applied');
        this.previewBtn.disabled = true;
        this.loadBtn.disabled = true;
        this.inputEl.disabled = true;
        this.fileInputEl.disabled = true;
    }
}
