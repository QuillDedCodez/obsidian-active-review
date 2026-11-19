/** Category Sync arrangement: choose which mismatched files to sync. */
import { Modal, type App } from 'obsidian';
import { displayName } from '../../util/paths';

export interface SyncEntry {
    path: string;
    folder: string[];
    from: string;
    to: string;
}

export interface CategorySyncModalOptions {
    title: string;
    description: string;
    reviewDir: string;
    entries: SyncEntry[];
    onContinue: (selectedPaths: string[]) => void;
}

interface SyncNode {
    path: string[];
    label: string;
    children: SyncNode[];
    entries: SyncEntry[];
}

type CheckState = 'all' | 'none' | 'mixed';

export class CategorySyncModal extends Modal {
    private options: CategorySyncModalOptions;
    private selected = new Set<string>();
    private collapsed = new Set<string>();
    private treeEl!: HTMLElement;
    private continueBtn!: HTMLButtonElement;

    constructor(app: App, options: CategorySyncModalOptions) {
        super(app);
        this.options = options;
    }

    onOpen(): void {
        const { contentEl } = this;
        this.modalEl.addClass('rv-modal-with-cancel', 'rv-modal-manage');
        contentEl.empty();
        contentEl.addClass('rv-manage-modal');
        contentEl.createEl('h2', { text: this.options.title });
        contentEl.createEl('p', {
            cls: 'setting-item-description',
            text: this.options.description,
        });
        this.treeEl = contentEl.createDiv({ cls: 'rv-manage-tree' });

        const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
        const cancel = buttons.createEl('button', { text: 'Cancel' });
        cancel.addEventListener('click', () => this.close());
        this.continueBtn = buttons.createEl('button', {
            text: 'Continue',
            cls: 'mod-cta',
        });
        this.continueBtn.disabled = true;
        this.continueBtn.addEventListener('click', () => {
            if (this.selected.size === 0) return;
            this.options.onContinue([...this.selected]);
            this.close();
        });

        this.renderTree();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private buildTree(): SyncNode {
        const root: SyncNode = { path: [], label: '', children: [], entries: [] };
        const ensure = (segments: string[]): SyncNode => {
            let node = root;
            for (let i = 0; i < segments.length; i++) {
                const full = segments.slice(0, i + 1);
                const key = full.join('/');
                let child = node.children.find((c) => c.path.join('/') === key);
                if (!child) {
                    child = {
                        path: full,
                        label: segments[i]!,
                        children: [],
                        entries: [],
                    };
                    node.children.push(child);
                }
                node = child;
            }
            return node;
        };
        for (const entry of this.options.entries) {
            ensure(entry.folder).entries.push(entry);
        }
        const sortNode = (node: SyncNode): void => {
            node.children.sort((a, b) => a.label.localeCompare(b.label));
            node.entries.sort((a, b) => a.path.localeCompare(b.path));
            for (const child of node.children) sortNode(child);
        };
        sortNode(root);
        return root;
    }

    private collectPaths(node: SyncNode): string[] {
        const out = node.entries.map((e) => e.path);
        for (const child of node.children) out.push(...this.collectPaths(child));
        return out;
    }

    private stateOf(paths: string[]): CheckState {
        if (paths.length === 0) return 'none';
        let selected = 0;
        for (const p of paths) if (this.selected.has(p)) selected++;
        return selected === 0 ? 'none' : selected === paths.length ? 'all' : 'mixed';
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
            for (const p of paths) this.selected.delete(p);
        } else if (state === 'none') {
            for (const p of paths) this.selected.add(p);
        } else {
            for (const p of paths) {
                if (this.selected.has(p)) this.selected.delete(p);
                else this.selected.add(p);
            }
        }
        this.renderTree();
    }

    private toggleEntry(path: string): void {
        if (this.selected.has(path)) this.selected.delete(path);
        else this.selected.add(path);
        this.renderTree();
    }

    private renderTree(): void {
        const scrollTop = this.treeEl.scrollTop;
        this.treeEl.empty();
        const root = this.buildTree();
        this.renderRoot(root);
        this.treeEl.scrollTop = scrollTop;
        this.continueBtn.disabled = this.selected.size === 0;
        this.continueBtn.setText(
            this.selected.size === 0
                ? 'Continue'
                : `Continue (${this.selected.size})`,
        );
    }

    private renderRoot(root: SyncNode): void {
        const paths = this.collectPaths(root);
        const state = this.stateOf(paths);
        const row = this.treeEl.createDiv({ cls: 'rv-manage-cat-row rv-manage-root' });
        this.makeCheck(row, state, () => this.togglePaths(paths), paths.length === 0);
        row.createSpan({ cls: 'rv-manage-cat-label', text: `${this.options.reviewDir}/` });
        row.createSpan({
            cls: 'rv-manage-count',
            text: `${paths.filter((p) => this.selected.has(p)).length}/${paths.length}`,
        });
        const children = this.treeEl.createDiv({ cls: 'rv-tree-children' });
        for (const entry of root.entries) this.renderEntry(entry, children);
        for (const child of root.children) this.renderNode(child, children);
    }

    private renderNode(node: SyncNode, parent: HTMLElement): void {
        const paths = this.collectPaths(node);
        const key = node.path.join('/');
        const state = this.stateOf(paths);
        const nodeEl = parent.createDiv({ cls: 'rv-tree-node' });
        const row = nodeEl.createDiv({ cls: 'rv-manage-cat-row' });
        this.makeCheck(row, state, () => this.togglePaths(paths), paths.length === 0);

        const collapsed = this.collapsed.has(key);
        const arrow = row.createEl('button', {
            text: collapsed ? '▸' : '▾',
            cls: 'rv-manage-arrow',
        });
        arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            if (collapsed) this.collapsed.delete(key);
            else this.collapsed.add(key);
            this.renderTree();
        });
        row.createSpan({ cls: 'rv-manage-cat-label', text: node.label });
        row.createSpan({
            cls: 'rv-manage-count',
            text: `${paths.filter((p) => this.selected.has(p)).length}/${paths.length}`,
        });

        if (collapsed) return;
        const children = nodeEl.createDiv({ cls: 'rv-tree-children' });
        for (const entry of node.entries) this.renderEntry(entry, children);
        for (const child of node.children) this.renderNode(child, children);
    }

    private renderEntry(entry: SyncEntry, parent: HTMLElement): void {
        const row = parent.createDiv({ cls: 'rv-manage-q-row' });
        this.makeCheck(
            row,
            this.selected.has(entry.path) ? 'all' : 'none',
            () => this.toggleEntry(entry.path),
        );
        row.createSpan({ cls: 'rv-manage-q-title', text: displayName(entry.path) });
        const detail = row.createSpan({ cls: 'rv-sync-entry-detail' });
        detail.createSpan({ cls: 'rv-sync-entry-from', text: entry.from });
        detail.createSpan({ cls: 'rv-sync-entry-arrow', text: ' → ' });
        detail.createSpan({ cls: 'rv-sync-entry-to', text: entry.to });
    }
}
