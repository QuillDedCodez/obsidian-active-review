/** Manage Questions: single-page modal — folder tree, preset row, folder ops. */
import { Modal, Notice, Platform, setIcon, type App } from 'obsidian';
import { extractFolderCategory, type Question } from '../../parser';
import {
    buildFolderTree,
    collectFolderQuestionPaths,
    isQuestionMatched,
    type FolderTreeNode,
    type ManageQuestionPreset,
} from '../../vault/managePresets';
import { basename, displayName } from '../../util/paths';
import {
    ConfirmModal,
    openFolderNamePrompt,
    openSavePresetPrompt,
    openUpdatePresetPrompt,
} from '../Modals';
import { renderChipList, type ChipItem } from '../ChipList';

export interface ManageApplyResult {
    includedPaths: string[];
    presetId: string;
    saveLastCustom: boolean;
}

export interface ManageMoveOutcome {
    newPath: string;
    presetsUpdated: number;
}

export interface ManageAddOutcome {
    folder: string;
}

export interface ManageDeleteOutcome {
    removedPrefix: string;
    moved: { from: string; to: string }[];
    errors: string[];
    presetsUpdated: number;
    lastCustomUpdated: boolean;
    folders: string[];
}

export interface ManageQuestionsModalOptions {
    questions: Question[];
    folders: string[];
    reviewDir: string;
    sessionsSubdir: string;
    presets: ManageQuestionPreset[];
    lastCustomSelection: string[];
    activePresetId: string;
    includedPaths: string[];
    onApply: (result: ManageApplyResult) => Promise<void> | void;
    onSavePreset: (name: string, includedPaths: string[]) => Promise<ManageQuestionPreset | null>;
    onUpdatePreset: (presetId: string, includedPaths: string[]) => Promise<void>;
    onMoveFile: (path: string, category: string[]) => Promise<ManageMoveOutcome>;
    onAddFolder: (parent: string[], name: string) => Promise<ManageAddOutcome>;
    onDeleteFolder: (category: string[]) => Promise<ManageDeleteOutcome>;
    onOpenQuestionPresets: () => void;
}

type CheckState = 'all' | 'none' | 'mixed';

const DRAG_TOLERANCE = 5;
const HOLD_DELAY = 240;

interface QuestionDragState {
    question: Question;
    row: HTMLElement;
    ghost: HTMLElement | null;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    active: boolean;
    cancelled: boolean;
    targetKey: string | null;
    targetRow: HTMLElement | null;
    holdTimer: number | null;
    cleanup: () => void;
}

function dedupe(paths: string[]): string[] {
    return [...new Set(paths)];
}

export class ManageQuestionsModal extends Modal {
    private options: ManageQuestionsModalOptions;
    private questions: Question[];
    private folders: string[];
    private reviewDir: string;
    private included: Set<string>;
    private presets: ManageQuestionPreset[];
    private lastCustomSelection: string[];
    private activePresetId: string;
    private dirty = false;
    private customTouched = false;
    private expanded = new Set<string>();
    private highlighted: string | null = null;
    private folderRows = new Map<string, HTMLElement>();
    private folderRowKeys = new Map<HTMLElement, string>();
    private drag: QuestionDragState | null = null;
    private dragConsumedClick = false;
    private justMovedPath: string | null = null;
    private folderChecks = new Map<
        string,
        { check: HTMLButtonElement; count: HTMLElement; paths: string[] }
    >();
    private questionChecks = new Map<string, HTMLButtonElement>();
    private presetEl!: HTMLElement;
    private presetRow: HTMLElement | null = null;
    private presetActionsRow: HTMLElement | null = null;
    private presetButtons = new Map<string, HTMLButtonElement>();
    private presetUpdateBtn: HTMLButtonElement | null = null;
    private presetsExpanded = false;
    private summaryEl!: HTMLElement;
    private listedPaths: string[] = [];
    private treeEl!: HTMLElement;
    private addBtn!: HTMLButtonElement;
    private deleteBtn!: HTMLButtonElement;
    private highlightEl!: HTMLElement;

    constructor(app: App, options: ManageQuestionsModalOptions) {
        super(app);
        this.options = options;
        this.questions = options.questions.map((q) => ({ ...q }));
        this.folders = [...new Set(options.folders)];
        if (!this.folders.includes('')) this.folders.unshift('');
        this.reviewDir = options.reviewDir;
        this.included = new Set(options.includedPaths);
        this.presets = options.presets.map((p) => ({
            ...p,
            includedPaths: [...p.includedPaths],
        }));
        this.lastCustomSelection = [...options.lastCustomSelection];
        this.activePresetId = options.activePresetId;
    }

    onOpen(): void {
        this.modalEl.addClass('rv-modal-with-cancel', 'rv-modal-manage');
        this.render();
    }

    onClose(): void {
        this.endQuestionDrag();
        this.contentEl.empty();
    }

    private render(): void {
        this.endQuestionDrag();
        this.folderRows.clear();
        this.folderRowKeys.clear();
        this.folderChecks.clear();
        this.questionChecks.clear();
        this.presetButtons.clear();
        this.presetRow = null;
        this.presetActionsRow = null;
        this.presetUpdateBtn = null;

        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rv-manage-modal');
        contentEl.createEl('h2', { text: 'Manage questions' });
        contentEl.createEl('p', {
            cls: 'setting-item-description',
            text: 'Only questions whose rv-category matches their folder are listed. Folders with mismatches show a need-sync badge. Click a folder to expand or collapse it; drag a question onto a folder to move it.',
        });
        const mismatchTotal = this.questions.filter(
            (q) => !isQuestionMatched(q, this.reviewDir),
        ).length;
        if (mismatchTotal > 0) {
            contentEl.createEl('p', {
                cls: 'rv-need-sync',
                text: `${mismatchTotal} question${mismatchTotal === 1 ? '' : 's'} need Category Sync and are not listed here.`,
            });
        }

        const toolbar = contentEl.createDiv({ cls: 'rv-manage-toolbar' });
        this.addBtn = toolbar.createEl('button', { text: 'Add subcategory', cls: 'rv-manage-tool' });
        this.addBtn.addEventListener('click', () => this.openAddFolder());
        this.deleteBtn = toolbar.createEl('button', {
            text: 'Delete category',
            cls: 'rv-manage-tool mod-warning',
        });
        this.deleteBtn.addEventListener('click', () => this.openDeleteFolder());
        const presetsBtn = toolbar.createEl('button', {
            text: 'Manage question presets',
            cls: 'rv-manage-tool',
        });
        presetsBtn.addEventListener('click', () => {
            this.close();
            this.options.onOpenQuestionPresets();
        });
        this.highlightEl = toolbar.createSpan({ cls: 'rv-manage-selected' });

        this.presetEl = contentEl.createDiv({ cls: 'rv-manage-preset-bar' });
        this.summaryEl = contentEl.createDiv({ cls: 'rv-manage-summary' });
        this.treeEl = contentEl.createDiv({ cls: 'rv-manage-tree' });

        const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
        const cancel = buttons.createEl('button', { text: 'Cancel' });
        cancel.addEventListener('click', () => this.close());
        const apply = buttons.createEl('button', { text: 'Apply', cls: 'mod-cta' });
        apply.addEventListener('click', () => {
            apply.disabled = true;
            void this.apply().finally(() => { apply.disabled = false; });
        });

        this.renderPresets();
        this.renderTree();
    }

    private stateOf(paths: string[]): CheckState {
        if (paths.length === 0) return 'none';
        let included = 0;
        for (const p of paths) if (this.included.has(p)) included++;
        return included === 0 ? 'none' : included === paths.length ? 'all' : 'mixed';
    }

    private countText(paths: string[]): string {
        let included = 0;
        for (const p of paths) if (this.included.has(p)) included++;
        return `${included}/${paths.length}`;
    }

    private makeCheck(
        parent: HTMLElement,
        state: CheckState,
        onClick: () => void,
        disabled = false,
    ): HTMLButtonElement {
        const b = parent.createEl('button', { cls: 'rv-manage-check' });
        if (state === 'all') {
            b.classList.add('is-checked');
            b.textContent = '✓';
        } else if (state === 'mixed') {
            b.classList.add('is-indeterminate');
            b.textContent = '−';
        }
        b.disabled = disabled;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!disabled) onClick();
        });
        return b;
    }

    private togglePaths(paths: string[]): void {
        if (paths.length === 0) return;
        const state = this.stateOf(paths);
        if (state === 'all') {
            for (const p of paths) this.included.delete(p);
        } else if (state === 'none') {
            for (const p of paths) this.included.add(p);
        } else {
            for (const p of paths) {
                if (this.included.has(p)) this.included.delete(p);
                else this.included.add(p);
            }
        }
        const wasDirty = this.dirty;
        this.dirty = true;
        this.customTouched = true;
        if (!wasDirty) this.renderPresets();
        this.updateTreeStates();
    }

    private toggleQuestion(path: string): void {
        if (this.included.has(path)) this.included.delete(path);
        else this.included.add(path);
        const wasDirty = this.dirty;
        this.dirty = true;
        this.customTouched = true;
        if (!wasDirty) this.renderPresets();
        this.updateTreeStates();
    }

    private currentPresetPaths(): string[] {
        const known = new Set(
            this.questions
                .filter((q) => isQuestionMatched(q, this.reviewDir))
                .map((q) => q.path),
        );
        return [...this.included].filter((p) => known.has(p));
    }

    private renderPresets(): void {
        const effectiveActive = this.dirty ? 'last-custom' : this.activePresetId;
        const showLastCustom =
            this.lastCustomSelection.length > 0 || effectiveActive === 'last-custom';

        // Row 1: chips (All / Last custom / named presets)
        if (!this.presetRow) {
            this.presetRow = this.presetEl.createDiv({ cls: 'rv-manage-preset-row' });
        }
        const row1 = this.presetRow;
        row1.empty();

        const items: ChipItem[] = [
            {
                label: 'All questions',
                active: effectiveActive === 'all',
                onClick: () => this.loadPreset('all'),
            },
        ];

        if (showLastCustom) {
            items.push({
                label: 'Last custom',
                active: effectiveActive === 'last-custom',
                onClick: () => this.loadPreset('last-custom'),
            });
        }

        for (const preset of this.presets) {
            items.push({
                label: preset.name,
                active: effectiveActive === preset.id,
                onClick: () => this.loadPreset(preset.id),
            });
        }

        renderChipList({
            parent: row1,
            items,
            rowClass: 'rv-modes',
            limit: 5,
            expanded: this.presetsExpanded,
            onExpandedChange: (expanded) => {
                this.presetsExpanded = expanded;
                this.renderPresets();
            },
        });

        // Row 2: Save as new, Update existing
        if (!this.presetActionsRow) {
            this.presetActionsRow = this.presetEl.createDiv({
                cls: 'rv-manage-preset-row rv-manage-preset-actions',
            });
        }
        const row2 = this.presetActionsRow;
        row2.empty();

        const save = row2.createEl('button', {
            text: '+ Save as new preset',
            cls: 'rv-mode rv-manage-save',
        });
        save.addEventListener('click', () => this.openSavePreset());

        this.presetUpdateBtn = row2.createEl('button', {
            text: 'Update existing…',
            cls: 'rv-mode rv-manage-update',
        });
        this.presetUpdateBtn.disabled = this.presets.length === 0;
        if (this.presets.length === 0) {
            this.presetUpdateBtn.title = 'Create a preset first';
        }
        this.presetUpdateBtn.addEventListener('click', () => this.openUpdatePreset());
    }

    private loadPreset(id: string): void {
        this.activePresetId = id;
        this.dirty = false;
        this.customTouched = false;
        if (id === 'all') {
            this.included = new Set(
                this.questions.filter((q) => isQuestionMatched(q, this.reviewDir)).map((q) => q.path),
            );
        } else if (id === 'last-custom') {
            this.included = new Set(this.lastCustomSelection);
        } else {
            const preset = this.presets.find((p) => p.id === id);
            this.included = new Set(preset?.includedPaths ?? []);
        }
        this.renderPresets();
        this.renderTree();
    }

    private openSavePreset(): void {
        openSavePresetPrompt(this.app, {
            initialName: `Custom ${this.presets.length + 1}`,
            title: 'Save question preset',
            onSave: (name) => {
                const paths = this.currentPresetPaths();
                void (async () => {
                    try {
                        const preset = await this.options.onSavePreset(name, paths);
                        if (!preset) return;
                        this.presets.push(preset);
                        this.activePresetId = preset.id;
                        this.dirty = false;
                        if (this.customTouched) this.lastCustomSelection = [...paths];
                        this.renderPresets();
                    } catch (e) {
                        new Notice(`Could not save preset: ${(e as Error).message}`);
                    }
                })();
            },
        });
    }

    private openUpdatePreset(): void {
        if (this.presets.length === 0) return;
        const paths = this.currentPresetPaths();
        openUpdatePresetPrompt(this.app, {
            title: 'Update question preset',
            presets: this.presets.map((p) => ({ id: p.id, name: p.name })),
            onSave: async (presetId) => {
                const target = this.presets.find((p) => p.id === presetId);
                if (!target) return;
                try {
                    await this.options.onUpdatePreset(presetId, paths);
                    this.presets = this.presets.map((p) =>
                        p.id === presetId ? { ...p, includedPaths: paths } : p,
                    );
                    this.activePresetId = presetId;
                    this.dirty = false;
                    this.customTouched = false;
                    this.renderPresets();
                    new Notice(`Updated preset "${target.name}".`);
                } catch (e) {
                    new Notice(`Could not update preset: ${(e as Error).message}`);
                }
            },
        });
    }



    private renderTree(): void {
        this.endQuestionDrag();
        const scrollTop = this.treeEl.scrollTop;
        this.treeEl.empty();
        this.folderRows.clear();
        this.folderRowKeys.clear();
        this.folderChecks.clear();
        this.questionChecks.clear();
        const tree = buildFolderTree(this.folders, this.questions, this.reviewDir);
        this.listedPaths = this.questions
            .filter((q) => isQuestionMatched(q, this.reviewDir))
            .map((q) => q.path);
        this.renderRoot(tree);
        this.treeEl.scrollTop = scrollTop;
        this.updateToolbar();
        this.updateSummary();
    }

    private updateSummary(): void {
        if (!this.summaryEl) return;
        const listed = this.listedPaths.length;
        if (listed === 0) {
            this.summaryEl.setText('No questions available to include.');
            this.summaryEl.removeClass('is-empty');
            return;
        }
        let included = 0;
        for (const path of this.listedPaths) if (this.included.has(path)) included++;
        this.summaryEl.setText(
            `${included} of ${listed} question${listed === 1 ? '' : 's'} soft-included`,
        );
        this.summaryEl.toggleClass('is-empty', included === 0);
    }

    private updateTreeStates(): void {
        for (const [, data] of this.folderChecks) {
            const state = this.stateOf(data.paths);
            data.check.className = 'rv-manage-check';
            data.check.toggleClass('is-checked', state === 'all');
            data.check.toggleClass('is-indeterminate', state === 'mixed');
            data.check.setText(state === 'all' ? '✓' : state === 'mixed' ? '−' : '');
            data.check.disabled = data.paths.length === 0;
            data.count.setText(this.countText(data.paths));
        }
        for (const [path, check] of this.questionChecks) {
            const on = this.included.has(path);
            check.className = 'rv-manage-check';
            check.toggleClass('is-checked', on);
            check.setText(on ? '✓' : '');
        }
        this.updateSummary();
    }

    private toggleExpanded(key: string): void {
        if (this.expanded.has(key)) this.expanded.delete(key);
        else this.expanded.add(key);
        this.renderTree();
    }

    private selectFolder(key: string): void {
        if (this.highlighted !== null) {
            this.folderRows.get(this.highlighted)?.removeClass('is-highlighted');
        }
        this.highlighted = key;
        const row = this.folderRows.get(key);
        if (row) row.addClass('is-highlighted');
        this.updateToolbar();
    }

    private renderRoot(node: FolderTreeNode): void {
        const paths = collectFolderQuestionPaths(node);
        const state = this.stateOf(paths);
        const row = this.treeEl.createDiv({ cls: 'rv-manage-cat-row rv-manage-root' });
        this.folderRows.set('', row);
        this.folderRowKeys.set(row, '');
        if (this.highlighted === '') row.addClass('is-highlighted');
        row.addEventListener('click', () => this.selectFolder(''));
        const check = this.makeCheck(row, state, () => this.togglePaths(paths), paths.length === 0);
        row.createSpan({ cls: 'rv-manage-cat-label', text: `${this.reviewDir}/` });
        const count = row.createSpan({ cls: 'rv-manage-count', text: this.countText(paths) });
        this.folderChecks.set('', { check, count, paths });
        this.renderBadge(row, node.mismatchCount);

        const children = this.treeEl.createDiv({ cls: 'rv-tree-children' });
        for (const q of node.questions) this.renderQuestion(q, children);
        for (const child of node.children) this.renderNode(child, children);
    }

    private renderNode(node: FolderTreeNode, parent: HTMLElement): void {
        const paths = collectFolderQuestionPaths(node);
        const key = node.path.join('/');
        const state = this.stateOf(paths);
        const nodeEl = parent.createDiv({ cls: 'rv-tree-node' });
        const row = nodeEl.createDiv({ cls: 'rv-manage-cat-row' });
        this.folderRows.set(key, row);
        this.folderRowKeys.set(row, key);
        if (this.highlighted === key) row.addClass('is-highlighted');
        row.addEventListener('click', () => {
            this.selectFolder(key);
            this.toggleExpanded(key);
        });
        const check = this.makeCheck(row, state, () => this.togglePaths(paths), paths.length === 0);

        const isExpanded = this.expanded.has(key);
        const arrow = row.createSpan({
            text: '▸',
            cls: 'rv-manage-arrow',
        });
        arrow.toggleClass('is-expanded', isExpanded);
        arrow.setAttr('aria-hidden', 'true');
        row.createSpan({ cls: 'rv-manage-cat-label', text: node.label });
        const count = row.createSpan({ cls: 'rv-manage-count', text: this.countText(paths) });
        this.folderChecks.set(key, { check, count, paths });
        this.renderBadge(row, node.mismatchCount);

        if (!isExpanded) return;
        const children = nodeEl.createDiv({ cls: 'rv-tree-children' });
        for (const q of node.questions) this.renderQuestion(q, children);
        for (const child of node.children) this.renderNode(child, children);
    }

    private renderQuestion(q: Question, parent: HTMLElement): void {
        const row = parent.createDiv({
            cls: 'rv-manage-q-row is-draggable',
            attr: { 'data-question-path': q.path },
        });
        const parentCategory = extractFolderCategory(q.path, this.reviewDir).join('/');
        row.addEventListener('click', () => {
            if (this.dragConsumedClick) {
                this.dragConsumedClick = false;
                return;
            }
            this.selectFolder(parentCategory);
        });
        const check = this.makeCheck(
            row,
            this.included.has(q.path) ? 'all' : 'none',
            () => this.toggleQuestion(q.path),
        );
        this.questionChecks.set(q.path, check);
        row.createSpan({ cls: 'rv-manage-q-title', text: displayName(q.path) });
        if (this.justMovedPath === q.path) {
            row.addClass('is-just-moved');
            this.justMovedPath = null;
        }
        const grip = row.createSpan({
            cls: 'rv-manage-q-grip',
            attr: { title: 'Drag to move', 'aria-label': 'Drag question to a category' },
        });
        setIcon(grip, 'grip-vertical');
        row.addEventListener('pointerdown', (e) => this.startQuestionDrag(e, q, row));
    }

    private renderBadge(row: HTMLElement, count: number): void {
        if (count > 0) {
            row.createSpan({
                cls: 'rv-need-sync-badge',
                text: `need sync (${count})`,
            });
        }
    }

    private updateToolbar(): void {
        const label =
            this.highlighted === null
                ? 'No folder selected'
                : this.highlighted === ''
                  ? `${this.reviewDir}/`
                  : this.highlighted;
        this.highlightEl.setText(`Selected: ${label}`);
        this.addBtn.disabled = this.highlighted === null;
        this.deleteBtn.disabled = this.highlighted === null || this.highlighted === '';
    }

    private openAddFolder(): void {
        if (this.highlighted === null) return;
        const parent = this.highlighted === '' ? [] : this.highlighted.split('/');
        openFolderNamePrompt(this.app, {
            initialName: 'New category',
            onSave: (name) => {
                void (async () => {
                    try {
                        const outcome = await this.options.onAddFolder(parent, name);
                        if (!this.folders.includes(outcome.folder)) {
                            this.folders.push(outcome.folder);
                        }
                        this.highlighted = outcome.folder;
                        this.renderTree();
                    } catch (e) {
                        new Notice(`Could not add category: ${(e as Error).message}`);
                    }
                })();
            },
        });
    }

    private openDeleteFolder(): void {
        if (this.highlighted === null || this.highlighted === '') return;
        const category = this.highlighted.split('/');
        new ConfirmModal(this.app, {
            title: 'Delete category?',
            message:
                `Delete "${this.highlighted}"? Its files will be moved up one level. ` +
                'Markdown files except rv-exclude will get their rv-category updated.',
            confirmLabel: 'Delete category',
            destructive: true,
            onConfirm: async () => {
                try {
                    const outcome = await this.options.onDeleteFolder(category);
                    const map = new Map(outcome.moved.map((move) => [move.from, move.to]));
                    this.folders = [...outcome.folders];
                    if (!this.folders.includes('')) this.folders.unshift('');

                    this.questions = this.questions.map((q) => {
                        const to = map.get(q.path);
                        if (!to) return q;
                        const folder = extractFolderCategory(to, this.reviewDir);
                        q.path = to;
                        q.category = folder;
                        q.declaredCategory = folder;
                        return q;
                    });
                    this.remapLocalPaths(map);
                    this.highlighted = category.slice(0, -1).join('/');
                    this.renderPresets();
                    this.renderTree();

                    let msg = `Moved ${outcome.moved.length} file(s).`;
                    if (outcome.errors.length > 0) msg += ` ${outcome.errors.length} failed.`;
                    if (outcome.presetsUpdated > 0) {
                        msg += ` Updated ${outcome.presetsUpdated} saved presets.`;
                    }
                    new Notice(msg);
                } catch (e) {
                    new Notice(`Could not delete category: ${(e as Error).message}`);
                }
            },
        }).open();
    }

    /** Pick up a question row and follow the pointer until it is dropped on a category. */
    private startQuestionDrag(event: PointerEvent, question: Question, row: HTMLElement): void {
        if (this.drag) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const target = event.target;
        if (target instanceof Element && target.closest('button, input, textarea, select')) return;

        const doc =
            (event as unknown as { doc?: Document }).doc ?? row.ownerDocument;
        const win =
            (event as unknown as { win?: Window }).win ??
            doc.defaultView ??
            window;
        const rect = row.getBoundingClientRect();
        const isTouch = event.pointerType !== 'mouse';
        const pointerId = event.pointerId;
        const currentCategory = extractFolderCategory(question.path, this.reviewDir).join('/');

        const state: QuestionDragState = {
            question,
            row,
            ghost: null,
            pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            active: false,
            cancelled: false,
            targetKey: null,
            targetRow: null,
            holdTimer: null,
            cleanup: () => {},
        };

        const clearHold = (): void => {
            if (state.holdTimer === null) return;
            win.clearTimeout(state.holdTimer);
            state.holdTimer = null;
        };

        const updateTarget = (x: number, y: number): void => {
            const hit = doc.elementFromPoint(x, y);
            const cat = hit?.instanceOf(Element) ? hit.closest<HTMLElement>('.rv-manage-cat-row') : null;
            const key = cat ? this.folderRowKeys.get(cat) : undefined;
            const valid = cat && key !== undefined && key !== currentCategory ? { key, row: cat } : null;
            if (state.targetRow !== (valid?.row ?? null)) {
                state.targetRow?.removeClass('is-drop-target');
                valid?.row.addClass('is-drop-target');
            }
            state.targetKey = valid?.key ?? null;
            state.targetRow = valid?.row ?? null;
        };

        const start = (): void => {
            if (state.active || state.cancelled) return;
            state.active = true;
            clearHold();
            const ghost = row.cloneNode(true) as HTMLElement;
            ghost.className = 'rv-manage-q-ghost';
            ghost.style.width = `${rect.width}px`;
            ghost.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
            doc.body.appendChild(ghost);
            doc.body.addClass('rv-manage-dragging');
            row.addClass('is-drag-source');
            state.ghost = ghost;
            if (Platform.isMobile) {
                try {
                    navigator.vibrate?.(15);
                } catch {
                    // Haptics are optional.
                }
            }
            updateTarget(state.startX, state.startY);
        };

        const positionGhost = (x: number, y: number): void => {
            if (!state.ghost) return;
            state.ghost.style.transform = `translate(${x - state.offsetX}px, ${y - state.offsetY}px)`;
        };

        const onMove = (moveEvent: PointerEvent): void => {
            if (moveEvent.pointerId !== pointerId) return;
            const dx = moveEvent.clientX - state.startX;
            const dy = moveEvent.clientY - state.startY;
            if (!state.active) {
                const distance = Math.hypot(dx, dy);
                if (isTouch) {
                    // A finger that moves early is scrolling the tree, not dragging.
                    if (distance > 10) this.endQuestionDrag();
                    return;
                }
                if (distance < DRAG_TOLERANCE) return;
                start();
                if (!state.active) return;
            }
            moveEvent.preventDefault();
            positionGhost(moveEvent.clientX, moveEvent.clientY);
            updateTarget(moveEvent.clientX, moveEvent.clientY);
        };

        const onUp = (upEvent: PointerEvent): void => {
            if (upEvent.pointerId !== pointerId) return;
            if (!state.active) {
                this.endQuestionDrag();
                return;
            }
            updateTarget(upEvent.clientX, upEvent.clientY);
            this.dragConsumedClick = true;
            this.finishQuestionDrag();
            win.setTimeout(() => {
                this.dragConsumedClick = false;
            }, 0);
        };

        const onCancel = (cancelEvent: PointerEvent): void => {
            if (cancelEvent.pointerId !== pointerId) return;
            this.endQuestionDrag();
        };

        const onBlur = (): void => {
            this.endQuestionDrag();
        };

        state.cleanup = () => {
            clearHold();
            win.removeEventListener('pointermove', onMove);
            win.removeEventListener('pointerup', onUp);
            win.removeEventListener('pointercancel', onCancel);
            win.removeEventListener('blur', onBlur);
        };
        win.addEventListener('pointermove', onMove, { passive: false });
        win.addEventListener('pointerup', onUp);
        win.addEventListener('pointercancel', onCancel);
        win.addEventListener('blur', onBlur);

        this.drag = state;
        if (isTouch) state.holdTimer = win.setTimeout(start, HOLD_DELAY);
    }

    /** Abort the current gesture and restore every transient visual. */
    private endQuestionDrag(keepGhost = false): void {
        const state = this.drag;
        if (!state) return;
        this.drag = null;
        state.cleanup();
        if (!keepGhost) state.ghost?.remove();
        state.row.removeClass('is-drag-source');
        state.targetRow?.removeClass('is-drop-target');
        state.row.ownerDocument.body.removeClass('rv-manage-dragging');
    }

    private finishQuestionDrag(): void {
        const state = this.drag;
        if (!state) return;
        const ghost = state.ghost;
        const targetRow = state.targetRow;
        const targetKey = state.targetKey;
        const question = state.question;
        this.endQuestionDrag(true);

        if (!ghost) return;
        const destination = targetRow ?? state.row;
        const rect = destination.getBoundingClientRect();
        const transform = ghost.style.transform || 'translate(0, 0)';
        const drop = targetKey !== null;
        ghost.addClass('is-settling');
        const animation = ghost.animate(
            [
                { transform, opacity: 1 },
                {
                    transform: `translate(${rect.left}px, ${rect.top}px) scale(0.85)`,
                    opacity: 0,
                },
            ],
            { duration: drop ? 220 : 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
        const dispose = (): void => ghost.remove();
        animation.onfinish = dispose;
        animation.oncancel = dispose;

        if (drop) {
            const category = targetKey === '' ? [] : targetKey.split('/');
            void this.moveQuestion(question, category);
        }
    }

    private async moveQuestion(question: Question, category: string[]): Promise<void> {
        const current = extractFolderCategory(question.path, this.reviewDir).join('/');
        const next = category.join('/');
        if (current === next) return;
        try {
            const outcome = await this.options.onMoveFile(question.path, category);
            const oldPath = question.path;
            question.path = outcome.newPath;
            const actualCategory = extractFolderCategory(outcome.newPath, this.reviewDir);
            question.category = actualCategory;
            question.declaredCategory = actualCategory;
            const rel = actualCategory.join('/');
            if (rel && !this.folders.includes(rel)) this.folders.push(rel);
            this.remapLocalPaths(new Map([[oldPath, outcome.newPath]]));
            this.highlighted = rel;
            this.justMovedPath = outcome.newPath;
            // Reveal the destination so the moved row does not disappear into
            // a collapsed category.
            if (rel) this.expanded.add(rel);
            this.renderPresets();
            this.renderTree();

            if (outcome.newPath !== oldPath) {
                let msg = `Moved ${basename(outcome.newPath)}.`;
                if (outcome.presetsUpdated > 0) {
                    msg += ` Updated ${outcome.presetsUpdated} saved presets.`;
                }
                new Notice(msg);
            }
        } catch (e) {
            new Notice(`Could not move question: ${(e as Error).message}`);
        }
    }

    private remapLocalPaths(map: Map<string, string>): void {
        if (map.size === 0) return;
        const nextIncluded = new Set<string>();
        for (const path of this.included) nextIncluded.add(map.get(path) ?? path);
        this.included = nextIncluded;

        this.presets = this.presets.map((preset) => ({
            ...preset,
            includedPaths: dedupe(preset.includedPaths.map((p) => map.get(p) ?? p)),
        }));
        this.lastCustomSelection = dedupe(
            this.lastCustomSelection.map((p) => map.get(p) ?? p),
        );
    }

    private async apply(): Promise<void> {
        const includedPaths = this.currentPresetPaths();
        const presetId = this.dirty ? 'last-custom' : this.activePresetId;
        const saveLastCustom = this.customTouched || presetId === 'last-custom';
        try {
            await this.options.onApply({ includedPaths, presetId, saveLastCustom });
            this.close();
        } catch (e) {
            new Notice(`Could not apply Manage questions: ${(e as Error).message}`);
        }
    }
}