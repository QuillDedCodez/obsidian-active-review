/** Session preset manager and its modal. */
import { Modal, Notice, type App, type EventRef } from 'obsidian';
import { clampChoiceCount } from '../../constants';
import type ReviewQuizPlugin from '../../main';
import type { SessionPreset } from '../../vault/sessionPresets';
import type { ManageQuestionPreset } from '../../vault/managePresets';
import {
    applySessionPresetImport,
    buildSessionPresetImportPreview,
    buildSessionPresetManifest,
    parseSessionPresetManifest,
    type SessionPresetApplyResult,
    type SessionPresetImportMode,
    type SessionPresetImportPreview,
    type SessionPresetManifest,
} from '../../vault/sessionPresetTransfer';
import { ConfirmModal } from '../Modals';
import {
    PresetExportPane,
    PresetImportPane,
    PresetManager,
    type PresetManagerContext,
    createImportDetails,
    createImportFilesSection,
    renderImportCounts,
    renderImportWarnings,
    type ImportCountItem,
    type PresetExportConfig,
    type PresetImportConfig,
} from './PresetManager';

export class SessionPresetManager extends PresetManager<SessionPreset> {
    private eventRef: EventRef | null = null;
    private importPane: SessionImportAdapter | null = null;

    constructor(ctx: PresetManagerContext) {
        super(ctx);
        const ws = this.app.workspace as unknown as {
            on(name: string, cb: () => void): EventRef;
        };
        this.eventRef = ws.on('active-review:session-presets-changed', () => {
            // A local reorder is already reflected in the DOM; re-rendering here
            // would cut off the drop animation and leave the ghost floating.
            if (this.mode === 'list' && !this.isReordering()) this.render();
        });
    }

    destroy(): void {
        if (this.eventRef) {
            this.app.workspace.offref(this.eventRef);
            this.eventRef = null;
        }
        this.importPane?.destroy();
        this.importPane = null;
        super.destroy();
    }

    protected getItems(): SessionPreset[] {
        return this.plugin.getSessionPresets();
    }

    protected saveItems(next: SessionPreset[]): Promise<void> {
        return this.plugin.saveSessionPresets(next);
    }

    protected renderDetail(item: SessionPreset): string {
        const pres = item.config.presentation === 'one' ? '1 at a time' : 'All at once';
        const count = item.config.count === 'all' ? 'All' : String(item.config.count);
        const mode =
            item.mode === 'typed'
                ? 'Typed'
                : `Multiple Choice · ${clampChoiceCount(item.config.choiceCount)} choices`;
        return `${pres} · ${count} · ${mode}`;
    }

    protected emptyListMessage(): string {
        return 'No session presets yet. Save one from the quiz view via "+ Save as new" in the Session presets row.';
    }

    protected readonly itemNoun = 'session preset';

    protected rowDeleteMessage(preset: SessionPreset): string {
        return `"${preset.name}" will be removed. Sessions already using its settings are unaffected.`;
    }

    protected bulkDeleteMessage(): string {
        return 'These presets will be removed. Sessions already using their settings are unaffected.';
    }

    protected renderRowActionsExtras(actions: HTMLElement, preset: SessionPreset): void {
        const dupBtn = actions.createEl('button', { cls: 'rv-preset-action', text: 'Duplicate' });
        dupBtn.addEventListener('click', () => void this.duplicate(preset));
    }

    protected renderExportView(host: HTMLElement): void {
        new PresetExportPane(this.app, this.plugin.settings.reviewDir, this.buildExportConfig()).render(host);
    }

    protected renderImportView(host: HTMLElement): void {
        this.importPane = new SessionImportAdapter(this.app, {
            existing: this.plugin.getSessionPresets(),
            managePresets: this.plugin.getManagePresets(),
            hasLastCustom: this.plugin.getLastCustomSelection().length > 0,
            onApply: async (_manifest, preview, mode) => {
                const before = this.plugin.getSessionPresets();
                const result = await applySessionPresetImport({
                    existing: before,
                    preview,
                    mode,
                    generateId: () => this.plugin.generatePresetId(),
                    save: async (presets) => { await this.plugin.saveSessionPresets(presets); },
                });
                if (result.errors.length === 0) {
                    await this.plugin.saveSessionImportJournal({ presetsBefore: before });
                }
                return result;
            },
            onApplied: () => {
                this.plugin.refreshIdleViews();
                this.mode = 'list';
                this.render();
            },
        });
        this.importPane.render(host);
    }

    protected renderToolbarExtras(actions: HTMLElement): void {
        const journal = this.plugin.getSessionImportJournal();
        const undoBtn = actions.createEl('button', {
            text: 'Undo last import',
            cls: 'rv-preset-tool',
        });
        undoBtn.disabled = !journal;
        undoBtn.addEventListener('click', () => {
            if (!journal) return;
            new ConfirmModal(this.app, {
                title: 'Undo last session preset import?',
                message: 'This restores the previous session preset list.',
                confirmLabel: 'Undo import',
                destructive: true,
                onConfirm: async () => {
                    try {
                        await this.plugin.saveSessionPresets(journal.presetsBefore);
                        await this.plugin.saveSessionImportJournal(null);
                        this.plugin.refreshIdleViews();
                        this.render();
                        new Notice('Session preset import undone.');
                    } catch (e) {
                        new Notice(`Undo failed: ${(e as Error).message}`);
                    }
                }
            }).open();
        });
    }

    private buildExportConfig(): PresetExportConfig {
        const managePresets = this.plugin.getManagePresets();
        const manageLabel = (p: SessionPreset): string => {
            const id = p.config.managePresetId;
            if (id === 'all') return 'All questions';
            if (id === 'last-custom') return 'Last custom';
            return managePresets.find((c) => c.id === id)?.name ?? 'Missing Manage preset';
        };
        return {
            emptyText: 'No session presets available to export.',
            noSelectionText: 'Select at least one session preset to export.',
            saveTitle: 'Save session preset manifest',
            defaultFileName: `session-presets-${new Date().toISOString().slice(0, 10)}`,
            copySuccessText: 'Session preset manifest copied to clipboard.',
            items: this.plugin.getSessionPresets().map((p) => ({
                id: p.id, name: p.name, detail: manageLabel(p),
            })),
            summary: (sel) => `${sel.size} preset${sel.size === 1 ? '' : 's'} selected`,
            build: (sel) =>
                buildSessionPresetManifest({
                    presets: this.plugin.getSessionPresets().filter((p) => sel.has(p.id)),
                    managePresets,
                    hasLastCustom: this.plugin.getLastCustomSelection().length > 0,
                }),
        };
    }

    private async duplicate(preset: SessionPreset): Promise<void> {
        const names = new Set(this.plugin.getSessionPresets().map((p) => p.name.toLowerCase()));
        let base = `${preset.name} copy`;
        if (names.has(base.toLowerCase())) {
            let n = 2;
            while (names.has(`${base} ${n}`.toLowerCase())) n++;
            base = `${base} ${n}`;
        }
        const copy: SessionPreset = {
            ...preset,
            id: this.plugin.generatePresetId(),
            name: base,
            config: { ...preset.config },
        };
        await this.saveItems([...this.plugin.getSessionPresets(), copy]);
        this.plugin.refreshIdleViews();
        this.render();
    }
}

// ============================================================================
// Session import adapter (private)
// ============================================================================

interface SessionImportAdapterOptions {
    existing: SessionPreset[];
    managePresets: ManageQuestionPreset[];
    hasLastCustom: boolean;
    onApply: (
        manifest: SessionPresetManifest,
        preview: SessionPresetImportPreview,
        mode: SessionPresetImportMode,
    ) => Promise<SessionPresetApplyResult>;
    onApplied: (result: SessionPresetApplyResult) => void;
}

class SessionImportAdapter extends PresetImportPane<SessionPresetManifest, SessionPresetImportPreview> {
    private referencesOpen = true;
    private manifestOpen = true;
    private presetsOpen = true;

    constructor(app: App, private options: SessionImportAdapterOptions) {
        super(app, buildSessionImportConfig(options));
    }

    protected onPreviewLoaded(): void {
        this.referencesOpen = true;
        this.manifestOpen = true;
        this.presetsOpen = true;
    }

    protected renderPreviewContent(preview: SessionPresetImportPreview): void {
        this.previewEl.empty();
        this.previewEl.createEl('h3', { cls: 'rv-import-section-title rv-import-preview-title', text: 'Preview' });

        const ready = preview.rows.filter((r) => r.status === 'ready').length;
        const missing = preview.rows.filter((r) => r.status === 'manage-missing').length;
        const invalid = preview.rows.filter((r) => r.status === 'invalid').length;
        const items: ImportCountItem[] = [
            { count: preview.rows.length, label: preview.rows.length === 1 ? 'preset' : 'presets', tone: 'total' },
            { count: ready, label: 'ready', tone: 'ready' },
        ];
        if (missing > 0) items.push({ count: missing, label: 'Manage reference missing', tone: 'missing' });
        if (invalid > 0) items.push({ count: invalid, label: 'invalid', tone: 'invalid' });
        renderImportCounts(this.previewEl, items);

        const files = createImportFilesSection(this.previewEl, 'Session presets', preview.rows.length, this.presetsOpen);
        files.details.addEventListener('toggle', () => { this.presetsOpen = files.details.open; });
        renderImportWarnings(files.scroll, this.currentWarnings);

        for (const row of preview.rows) {
            const cls = row.status === 'ready' ? 'ready' : row.status === 'invalid' ? 'invalid' : 'missing';
            const item = files.scroll.createDiv({ cls: `rv-import-row rv-import-${cls}` });
            item.createSpan({
                cls: 'rv-import-status',
                text: row.status === 'manage-missing' ? 'Missing' : row.status.charAt(0).toUpperCase() + row.status.slice(1),
            });
            const main = item.createDiv({ cls: 'rv-import-row-main' });
            main.createSpan({ cls: 'rv-import-source', text: row.name });
            main.createSpan({ cls: 'rv-import-arrow', text: '→' });
            main.createSpan({ cls: 'rv-import-target', text: row.managePresetName ?? 'No Manage preset' });
            if (row.status !== 'ready') item.createSpan({ cls: 'rv-import-message', text: row.message });
        }

        const references = this.manageReferences(preview);
        const refDetails = createImportDetails(this.previewEl, 'Manage Questions references', references.length, this.referencesOpen);
        refDetails.details.addEventListener('toggle', () => { this.referencesOpen = refDetails.details.open; });
        if (references.length === 0) {
            refDetails.body.createEl('p', { cls: 'rv-import-empty', text: 'No external Manage Questions references in this manifest.' });
        } else {
            for (const r of references) {
                const item = refDetails.body.createDiv({ cls: 'rv-import-reference-row' });
                item.createSpan({ cls: 'rv-import-reference-name', text: r.name });
                item.createSpan({
                    cls: `rv-import-availability ${r.available ? 'is-available' : 'is-unavailable'}`,
                    text: r.available ? 'Available' : 'Unavailable',
                });
            }
        }

        const manifestPresets = this.currentManifest?.presets ?? [];
        const manifestDetails = createImportDetails(this.previewEl, 'Presets in manifest', manifestPresets.length, this.manifestOpen);
        manifestDetails.details.addEventListener('toggle', () => { this.manifestOpen = manifestDetails.details.open; });
        if (manifestPresets.length === 0) {
            manifestDetails.body.createEl('p', { cls: 'rv-import-empty', text: 'No presets in this manifest.' });
        } else {
            for (const p of manifestPresets) {
                const item = manifestDetails.body.createDiv({ cls: 'rv-import-preset-row' });
                item.createSpan({ cls: 'rv-import-preset-name', text: p.name });
                item.createSpan({
                    cls: 'rv-import-preset-count',
                    text: `${Object.keys(p.config).length} config field${Object.keys(p.config).length === 1 ? '' : 's'}`,
                });
            }
        }
        this.wirePreviewLayout();
    }

    private manageReferences(preview: SessionPresetImportPreview): { name: string; available: boolean }[] {
        const map = new Map<string, { name: string; available: boolean }>();
        const availableNames = new Set(
            this.options.managePresets.map((p) => p.name.toLowerCase()),
        );
        for (const row of preview.rows) {
            const name = row.managePresetName;
            if (!name || name === 'All questions') continue;
            const key = name.toLowerCase();
            if (map.has(key)) continue;
            const available =
                name === 'Last custom'
                    ? this.options.hasLastCustom
                    : availableNames.has(key);
            map.set(key, { name, available });
        }
        return [...map.values()];
    }
}

function buildSessionImportConfig(
    options: SessionImportAdapterOptions,
): PresetImportConfig<SessionPresetManifest, SessionPresetImportPreview> {
    return {
        placeholder: 'Paste an active-review/session-presets JSON manifest here.',
        modes: [
            { value: 'add', label: 'Add new', title: 'Add suffixes duplicate names; update preserves matching preset IDs.' },
            { value: 'update', label: 'Update by name' },
        ],
        initialMode: 'add',
        parse: parseSessionPresetManifest,
        buildPreview: (manifest) => {
            const preview = buildSessionPresetImportPreview(manifest, {
                managePresets: options.managePresets,
                hasLastCustom: options.hasLastCustom,
            });
            return { preview, warnings: preview.warnings };
        },
        hasErrors: (preview) => preview.errors.length > 0,
        canApply: (preview) => preview.rows.some((r) => r.status === 'ready'),
        confirm: (preview, mode) => {
            const ready = preview.rows.filter((r) => r.status === 'ready').length;
            const skipped = preview.rows.length - ready;
            const skipNote = skipped > 0 ? ` ${skipped} unresolved preset${skipped === 1 ? '' : 's'} will be skipped.` : '';
            return {
                title: 'Apply session preset import?',
                message: `${mode === 'update' ? 'Update matching presets' : 'Add new presets'} from ${ready} ready manifest preset(s).${skipNote} Manage Questions content is not changed.`,
                confirmLabel: 'Apply import',
                destructive: mode === 'update',
            };
        },
        apply: async (manifest, preview, mode) => {
            const result = await options.onApply(manifest, preview, mode as SessionPresetImportMode);
            options.onApplied(result);
            return {
                notice: `Session presets: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped${result.errors.length ? `, ${result.errors.length} error(s)` : ''}.`,
                errors: result.errors,
            };
        },
    };
}
export class SessionPresetsModal extends Modal {
    private manager: SessionPresetManager | null = null;

    constructor(app: App, private plugin: ReviewQuizPlugin) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass('rv-modal-with-cancel', 'rv-preset-manager-modal');
        this.contentEl.empty();
        this.contentEl.createEl('h2', { text: 'Manage Session Presets' });
        const host = this.contentEl.createDiv({ cls: 'rv-preset-modal-host' });
        this.manager = new SessionPresetManager({
            app: this.app,
            plugin: this.plugin,
            containerEl: host,
        });
        this.manager.render();
    }

    onClose(): void {
        this.manager?.destroy();
        this.manager = null;
        this.contentEl.empty();
    }
}
