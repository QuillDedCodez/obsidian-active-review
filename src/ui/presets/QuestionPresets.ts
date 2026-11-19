/** Question preset manager, its modal, and the full import pane. */
import { Modal, Notice, type App } from 'obsidian';
import type ReviewQuizPlugin from '../../main';
import type { Question } from '../../parser';
import type { ManageQuestionPreset } from '../../vault/managePresets';
import {
    buildImportPreview,
    buildManagePresetManifest,
    parseManagePresetManifest,
    recountImportPreview,
    resolveImportRow,
    type ImportPreview,
    type ImportRowStatus,
    type ManagePresetManifest,
} from '../../vault/manageImportExport';
import type { ApplyManageImportResult, ImportApplyMode } from '../../vault/manageImportApply';
import { ConfirmModal } from '../Modals';
import {
    PresetExportPane,
    PresetImportPane,
    PresetManager,
    createImportDetails,
    createImportFilesSection,
    renderImportCounts,
    renderImportWarnings,
    type ImportCountItem,
    type ImportCountTone,
    type PresetExportConfig,
    type PresetImportConfig,
} from './PresetManager';

export class QuestionPresetManager extends PresetManager<ManageQuestionPreset> {
    private importPane: QuestionImportPane | null = null;

    destroy(): void {
        this.importPane?.destroy();
        this.importPane = null;
        super.destroy();
    }

    protected getItems(): ManageQuestionPreset[] {
        return this.plugin.getManagePresets();
    }

    protected saveItems(next: ManageQuestionPreset[]): Promise<void> {
        return this.plugin.saveManagePresets(next);
    }

    protected renderDetail(item: ManageQuestionPreset): string {
        return `${item.includedPaths.length} file${item.includedPaths.length === 1 ? '' : 's'}`;
    }

    protected emptyListMessage(): string {
        return 'No question presets yet. Create one from Manage Questions on the start screen.';
    }

    protected readonly itemNoun = 'question preset';

    protected rowDeleteMessage(preset: ManageQuestionPreset): string {
        return `"${preset.name}" will be removed. Sessions using it keep their frozen pool.`;
    }

    protected bulkDeleteMessage(): string {
        return 'These presets will be removed. Sessions using them keep their frozen pool.';
    }

    protected renderExportView(host: HTMLElement): void {
        new PresetExportPane(this.app, this.plugin.settings.reviewDir, this.buildExportConfig()).render(host);
    }

    protected renderImportView(host: HTMLElement): void {
        this.importPane = new QuestionImportPane(this.app, {
            questions: this.plugin.getQuestions(),
            folders: this.plugin.getReviewFolders(),
            reviewDir: this.plugin.settings.reviewDir,
            sessionsSubdir: this.plugin.settings.sessionsSubdir,
            existingPresets: this.plugin.getManagePresets(),
            fileExists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
            onApply: (manifest, preview, mode) =>
                this.plugin.applyManageImport(manifest, preview, mode),
            onApplied: () => {
                void this.plugin.scanAll();
                this.plugin.refreshIdleViews();
                this.mode = 'list';
                this.render();
            },
        });
        this.importPane.render(host);
    }

    protected renderToolbarExtras(actions: HTMLElement): void {
        const hasJournal = this.plugin.getManageImportJournal() !== null;
        const undoBtn = actions.createEl('button', {
            text: 'Undo last import',
            cls: 'rv-preset-tool',
        });
        undoBtn.disabled = !hasJournal;
        undoBtn.addEventListener('click', () => {
            if (!hasJournal) return;
            new ConfirmModal(this.app, {
                title: 'Undo last Manage Questions import?',
                message: 'This reverses the recorded file moves, restores the previous preset arrays and last-custom selection, and restores rv-category. Created folders are left in place. Session logs are not changed.',
                confirmLabel: 'Undo import',
                destructive: true,
                onConfirm: async () => {
                    try {
                        const result = await this.plugin.undoLastImport();
                        if (result.errors.length > 0) {
                            new Notice(`Undo incomplete: ${result.restored} restored; ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}. ${result.errors[0] ?? ''}`);
                            void this.plugin.scanAll();
                            this.render();
                            return;
                        }
                        new Notice(`Undo complete: ${result.restored} file${result.restored === 1 ? '' : 's'} restored${result.foldersLeft.length > 0 ? `; ${result.foldersLeft.length} empty folder(s) left` : ''}.`);
                        void this.plugin.scanAll();
                        this.render();
                    } catch (e) {
                        new Notice(`Undo failed: ${(e as Error).message}`);
                    }
                }
            }).open();
        });
    }

    private buildExportConfig(): PresetExportConfig {
        let includeEmptyFolders = true;
        return {
            emptyText: 'No Manage Questions presets available to export.',
            noSelectionText: 'Select at least one preset to export.',
            saveTitle: 'Save Manage Questions manifest',
            defaultFileName: `manage-presets-${new Date().toISOString().slice(0, 10)}`,
            copySuccessText: 'Manage Questions manifest copied to clipboard.',
            items: this.plugin.getManagePresets().map((p) => ({
                id: p.id,
                name: p.name,
                detail: `${p.includedPaths.length} file${p.includedPaths.length === 1 ? '' : 's'}`,
            })),
            summary: (sel) => {
                const presets = this.plugin.getManagePresets().filter((p) => sel.has(p.id));
                const fileCount = new Set(presets.flatMap((p) => p.includedPaths)).size;
                return `${presets.length} preset${presets.length === 1 ? '' : 's'} · ${fileCount} unique file${fileCount === 1 ? '' : 's'}`;
            },
            build: (sel) =>
                buildManagePresetManifest({
                    presets: this.plugin.getManagePresets().filter((p) => sel.has(p.id)),
                    folders: this.plugin.getReviewFolders(),
                    reviewDir: this.plugin.settings.reviewDir,
                    includeEmptyFolders,
                }),
            renderExtras: (host) => {
                const row = host.createEl('label', { cls: 'rv-export-row rv-export-option' });
                const check = row.createEl('input', { type: 'checkbox' });
                check.checked = includeEmptyFolders;
                check.addEventListener('change', () => { includeEmptyFolders = check.checked; });
                row.createSpan({ cls: 'rv-export-name', text: 'Include empty folders' });
            },
        };
    }
}

export class QuestionPresetsModal extends Modal {
    private manager: QuestionPresetManager | null = null;

    constructor(app: App, private plugin: ReviewQuizPlugin) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass('rv-modal-with-cancel', 'rv-preset-manager-modal');
        this.contentEl.empty();
        this.contentEl.createEl('h2', { text: 'Manage Question Presets' });
        const host = this.contentEl.createDiv({ cls: 'rv-preset-modal-host' });
        this.manager = new QuestionPresetManager({
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
export interface QuestionImportPaneOptions {
    questions: Question[];
    folders: string[];
    reviewDir: string;
    sessionsSubdir: string;
    existingPresets: ManageQuestionPreset[];
    fileExists: (path: string) => boolean;
    onApply: (
        manifest: ManagePresetManifest,
        preview: ImportPreview,
        mode: ImportApplyMode,
    ) => Promise<ApplyManageImportResult>;
    onApplied: (result: ApplyManageImportResult) => void;
}

const STATUS_COUNTS: {
    status: ImportRowStatus;
    label: string;
    tone: ImportCountTone;
}[] = [
    { status: 'move', label: 'move', tone: 'move' },
    { status: 'noop', label: 'noop', tone: 'noop' },
    { status: 'missing', label: 'missing', tone: 'missing' },
    { status: 'ambiguous', label: 'ambiguous', tone: 'ambiguous' },
    { status: 'conflict', label: 'conflict', tone: 'conflict' },
    { status: 'invalid', label: 'invalid', tone: 'invalid' },
];

export class QuestionImportPane extends PresetImportPane<ManagePresetManifest, ImportPreview> {
    private foldersOpen = true;
    private presetsOpen = true;
    private filesOpen = true;
    private lastApplyResult: ApplyManageImportResult | null = null;
    /** Local question paths are expensive to gather/sort; do it once per pane. */
    private localPathsCache: string[] | null = null;
    /** Guards the chunked preview renderer against superseded passes. */
    private renderToken = 0;
    private rowFrame: number | null = null;
    private countsEl: HTMLElement | null = null;
    private presetsBodyEl: HTMLElement | null = null;
    private static readonly ROW_CHUNK = 150;
    private static readonly EAGER_OPTION_LIMIT = 80;

    constructor(app: App, private options: QuestionImportPaneOptions) {
        const holder = { capture: (_: ApplyManageImportResult) => {} };
        super(app, buildConfig(options, (r) => holder.capture(r)));
        holder.capture = (r) => { this.lastApplyResult = r; };
    }

    destroy(): void {
        this.cancelRowRender();
        super.destroy();
    }

    private cancelRowRender(): void {
        this.renderToken++;
        if (this.rowFrame !== null) {
            window.cancelAnimationFrame(this.rowFrame);
            this.rowFrame = null;
        }
    }

    protected onPreviewLoaded(): void {
        this.foldersOpen = true;
        this.presetsOpen = true;
        this.filesOpen = true;
    }

    protected renderAppliedContent(_r: { notice: string; errors?: string[] }): void {
        this.cancelRowRender();
        const result = this.lastApplyResult;
        if (!result) return;
        const summary = this.previewEl.createDiv({ cls: 'rv-import-applied-summary' });
        const lines = [
            `${result.moved} file${result.moved === 1 ? '' : 's'} moved`,
            `${result.skipped} skipped`,
            `${result.foldersCreated} folder${result.foldersCreated === 1 ? '' : 's'} created`,
            `${result.presetsAdded} preset${result.presetsAdded === 1 ? '' : 's'} added`,
            `${result.presetsUpdated} preset${result.presetsUpdated === 1 ? '' : 's'} updated`,
        ];
        for (const line of lines) summary.createEl('p', { text: line });
        this.previewEl.createEl('p', {
            cls: 'rv-import-phase-note',
            text: 'Manage Questions was refreshed. Reopen it to review the new tree and presets. Undo last import is available there.',
        });
    }

    private questionPaths(): string[] {
        const root = this.options.reviewDir.replace(/\/+$/g, '');
        const prefix = root ? `${root}/` : '';
        return this.options.questions
            .map((q) => (q.path.startsWith(prefix) ? q.path.slice(prefix.length) : q.path))
            .filter((p) => /\.md$/i.test(p))
            .sort();
    }

    private localQuestionPaths(): string[] {
        if (!this.localPathsCache) this.localPathsCache = this.questionPaths();
        return this.localPathsCache;
    }

    private fillMatchOptions(select: HTMLSelectElement, candidates: string[], value: string): void {
        select.empty();
        select.createEl('option', { text: 'Choose local question…', attr: { value: '' } });
        for (const candidate of candidates) {
            select.createEl('option', { text: candidate, attr: { value: candidate } });
        }
        select.value = value;
    }

    /**
     * Render file rows in animation-frame chunks. A large manifest can produce
     * thousands of rows; building them in one synchronous pass froze the mobile
     * UI for seconds after Preview and again on every row edit.
     */
    private renderRowsProgressively(preview: ImportPreview, host: HTMLElement): void {
        this.cancelRowRender();
        const token = this.renderToken;
        let index = 0;
        const pump = (): void => {
            this.rowFrame = null;
            if (token !== this.renderToken) return;
            const end = Math.min(
                index + QuestionImportPane.ROW_CHUNK,
                preview.rows.length,
            );
            for (; index < end; index++) {
                this.renderFileRow(preview.rows[index]!, host, preview);
            }
            if (index < preview.rows.length) {
                this.rowFrame = window.requestAnimationFrame(pump);
            } else {
                this.wirePreviewLayout();
            }
        };
        pump();
    }

    private renderFileRow(
        row: ImportPreview['rows'][number],
        parent: HTMLElement,
        preview: ImportPreview,
    ): void {
        this.fillFileRow(parent.createDiv(), row, preview);
    }

    private updateFileRow(
        item: HTMLElement,
        row: ImportPreview['rows'][number],
        preview: ImportPreview,
    ): void {
        item.empty();
        this.fillFileRow(item, row, preview);
    }

    private fillFileRow(
        item: HTMLElement,
        row: ImportPreview['rows'][number],
        preview: ImportPreview,
    ): void {
        item.className = `rv-import-row rv-import-${row.status}`;
        item.createSpan({
            cls: 'rv-import-status',
            text: row.status.charAt(0).toUpperCase() + row.status.slice(1),
        });
        const main = item.createDiv({ cls: 'rv-import-row-main' });
        main.createSpan({ cls: 'rv-import-source', text: row.sourcePath });
        if (row.status !== 'noop') {
            main.createSpan({ cls: 'rv-import-arrow', text: '→' });
            main.createSpan({ cls: 'rv-import-target', text: row.targetPath });
        }
        if (row.message && row.status !== 'noop') {
            item.createSpan({ cls: 'rv-import-message', text: row.message });
        }
        if (row.manualMatch === true) {
            const candidates =
                row.candidates.length > 0
                    ? row.candidates
                    : this.localQuestionPaths();
            if (candidates.length > 0) {
                const select = item.createEl('select', { cls: 'dropdown rv-import-match' });
                const current = row.matchedSourcePath ?? '';
                if (candidates.length <= QuestionImportPane.EAGER_OPTION_LIMIT) {
                    this.fillMatchOptions(select, candidates, current);
                } else {
                    // Building thousands of <option> nodes for every ambiguous
                    // row was the main import-preview stall. Show a lightweight
                    // placeholder and fill the real list on first interaction.
                    select.createEl('option', {
                        text: 'Choose local question…',
                        attr: { value: '' },
                    });
                    if (current) {
                        select.createEl('option', {
                            text: current,
                            attr: { value: current },
                        });
                    }
                    select.value = current;
                    let filled = false;
                    const fillOnce = (): void => {
                        if (filled) return;
                        filled = true;
                        this.fillMatchOptions(select, candidates, current);
                    };
                    select.addEventListener('pointerdown', fillOnce, { once: true });
                    select.addEventListener('focus', fillOnce, { once: true });
                    select.addEventListener('click', fillOnce, { once: true });
                }
                select.value = current;
                select.addEventListener('change', () => {
                    const value = select.value;
                    if (!value) {
                        row.matchedSourcePath = undefined;
                        row.collisionPolicy = 'skip';
                        row.status = row.candidates.length > 0 ? 'ambiguous' : 'missing';
                        row.message =
                            row.status === 'ambiguous'
                                ? `${row.candidates.length} local filename matches; choose one.`
                                : 'No matching question note found.';
                    } else {
                        resolveImportRow(row, value, this.options.reviewDir, this.options.fileExists);
                    }
                    recountImportPreview(preview);
                    // Update only this row and the summary counters. Rebuilding
                    // the whole preview made every manual match edit re-render
                    // thousands of rows.
                    this.updateFileRow(item, row, preview);
                    this.refreshPreviewSummary(preview);
                    this.updateApplyState();
                });
            }
        }
        if (row.status === 'conflict') {
            const select = item.createEl('select', { cls: 'dropdown rv-import-collision' });
            select.createEl('option', { text: 'Skip collision', attr: { value: 'skip' } });
            select.createEl('option', { text: 'Move with suffix', attr: { value: 'suffix' } });
            select.value = row.collisionPolicy;
            select.addEventListener('change', () => {
                row.collisionPolicy = select.value === 'suffix' ? 'suffix' : 'skip';
                row.message =
                    row.collisionPolicy === 'suffix'
                        ? 'Target exists; apply will use a numeric suffix.'
                        : 'Target exists; skip this row.';
                recountImportPreview(preview);
                this.updateFileRow(item, row, preview);
                this.refreshPreviewSummary(preview);
                this.updateApplyState();
            });
        }
        if (row.candidates.length > 0) {
            const ul = item.createEl('ul', { cls: 'rv-import-candidates' });
            for (const candidate of row.candidates) ul.createEl('li', { text: candidate });
        }
    }

    private countItems(preview: ImportPreview): ImportCountItem[] {
        const items: ImportCountItem[] = [
            {
                count: preview.rows.length,
                label: preview.rows.length === 1 ? 'file' : 'files',
                tone: 'total',
            },
        ];
        for (const entry of STATUS_COUNTS) {
            const count = preview.counts[entry.status];
            if (count > 0) items.push({ count, label: entry.label, tone: entry.tone });
        }
        return items;
    }

    private renderPresetRows(preview: ImportPreview, body: HTMLElement): void {
        if (preview.presets.length === 0) {
            body.createEl('p', { cls: 'rv-import-empty', text: 'No presets in this manifest.' });
            return;
        }
        for (const preset of preview.presets) {
            const item = body.createDiv({ cls: 'rv-import-preset-row' });
            item.createSpan({
                cls: 'rv-import-preset-action',
                text: preset.nameExists ? 'Existing' : 'New',
            });
            item.createSpan({ cls: 'rv-import-preset-name', text: preset.name });
            item.createSpan({
                cls: 'rv-import-preset-count',
                text: `${preset.resolved}/${preset.files} resolved`,
            });
            if (preset.unresolved > 0) {
                item.createSpan({
                    cls: 'rv-import-unresolved',
                    text: `${preset.unresolved} unresolved`,
                });
            }
        }
    }

    private refreshPreviewSummary(preview: ImportPreview): void {
        if (this.countsEl) {
            const holder = this.previewEl.ownerDocument.createElement('div');
            const bar = renderImportCounts(holder, this.countItems(preview));
            this.countsEl.replaceWith(bar);
            this.countsEl = bar;
        }
        if (this.presetsBodyEl) {
            this.presetsBodyEl.empty();
            this.renderPresetRows(preview, this.presetsBodyEl);
        }
    }

    protected renderPreviewContent(preview: ImportPreview): void {
        this.previewEl.empty();
        this.previewEl.createEl('h3', {
            cls: 'rv-import-section-title rv-import-preview-title',
            text: 'Preview',
        });

        this.countsEl = renderImportCounts(this.previewEl, this.countItems(preview));

        const files = createImportFilesSection(this.previewEl, 'Files', preview.rows.length, this.filesOpen);
        files.details.addEventListener('toggle', () => { this.filesOpen = files.details.open; });
        const warnings = [...this.currentWarnings, ...preview.warnings];
        renderImportWarnings(files.scroll, warnings);
        if (preview.errors.length > 0) {
            const box = files.scroll.createDiv({ cls: 'rv-import-errors' });
            const ul = box.createEl('ul');
            for (const error of preview.errors) ul.createEl('li', { text: error });
        }

        const folders = createImportDetails(this.previewEl, 'Target folders', preview.targetFolders.length, this.foldersOpen);
        folders.details.addEventListener('toggle', () => { this.foldersOpen = folders.details.open; });
        if (preview.targetFolders.length === 0) {
            folders.body.createEl('p', { cls: 'rv-import-empty', text: 'No target folders in this manifest.' });
        } else {
            for (const folder of preview.targetFolders) {
                folders.body.createDiv({ cls: 'rv-import-folder-row', text: folder });
            }
        }

        const presets = createImportDetails(this.previewEl, 'Presets in manifest', preview.presets.length, this.presetsOpen);
        presets.details.addEventListener('toggle', () => { this.presetsOpen = presets.details.open; });
        this.presetsBodyEl = presets.body;
        this.renderPresetRows(preview, presets.body);
        this.renderRowsProgressively(preview, files.scroll);
    }
}

function buildConfig(
    options: QuestionImportPaneOptions,
    capture: (r: ApplyManageImportResult) => void,
): PresetImportConfig<ManagePresetManifest, ImportPreview> {
    let captured: ApplyManageImportResult | null = null;
    return {
        placeholder: 'Paste an active-review/manage-presets JSON manifest here.',
        modes: [
            {
                value: 'add',
                label: 'Add new',
                title: 'Add suffixes duplicate names; update preserves preset IDs and replaces their paths.',
            },
            { value: 'update', label: 'Update by name' },
            { value: 'structure', label: 'Move files only' },
        ],
        initialMode: 'add',
        parse: parseManagePresetManifest,
        buildPreview: (manifest) => ({
            preview: buildImportPreview(manifest, {
                questions: options.questions,
                reviewDir: options.reviewDir,
                sessionsSubdir: options.sessionsSubdir,
                existingPresets: options.existingPresets,
                fileExists: options.fileExists,
            }),
            warnings: [],
        }),
        hasErrors: (preview) => preview.errors.length > 0,
        canApply: (preview, mode) => {
            const hasMoveWork = preview.rows.some(
                (row) =>
                    row.status === 'move' ||
                    (row.status === 'conflict' && row.collisionPolicy === 'suffix'),
            );
            const hasPresetWork =
                mode !== 'structure' &&
                preview.presets.some((preset) => preset.resolved > 0);
            return hasMoveWork || hasPresetWork;
        },
        confirm: (preview, mode) => {
            const modeLabel =
                mode === 'add'
                    ? 'move files and add new presets'
                    : mode === 'update'
                      ? 'move files and update presets by name'
                      : 'move files only';
            const moveCount = preview.rows.filter(
                (row) =>
                    row.status === 'move' ||
                    (row.status === 'conflict' && row.collisionPolicy === 'suffix'),
            ).length;
            const presetActions =
                mode === 'structure'
                    ? 0
                    : preview.presets.filter((p) => p.resolved > 0).length;
            return {
                title: 'Apply Manage Questions import?',
                message:
                    `${modeLabel}: ${moveCount} move(s), ` +
                    `${presetActions} preset action(s). ` +
                    'Missing, ambiguous, conflicting, and invalid entries are skipped. ' +
                    'Session history is not updated. This cannot be undone automatically.',
                confirmLabel: 'Apply import',
                destructive: true,
            };
        },
        apply: async (manifest, preview, mode) => {
            const result = await options.onApply(manifest, preview, mode as ImportApplyMode);
            captured = result;
            capture(result);
            return {
                notice: `Import applied: ${result.moved} moved, ${result.presetsAdded} added, ${result.presetsUpdated} updated, ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}.`,
                errors: result.errors,
            };
        },
        onApplied: (_) => {
            if (captured) options.onApplied(captured);
        },
    };
}
