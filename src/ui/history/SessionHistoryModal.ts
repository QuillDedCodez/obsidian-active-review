/** Full session history: filterable list + shared session-detail panel. */
import { Modal, type App } from 'obsidian';
import {
    sessionLabel,
    statusLabel,
    type SessionStatus,
    type SessionSummary,
} from '../../vault/sessionLog';
import {
    renderSessionDetailPanel,
    sessionDetailTitle,
    type SessionDetailAction,
} from './SessionDetailPanel';

export type SessionHistoryAction = SessionDetailAction;

export interface SessionHistoryModalOptions {
    sessions: SessionSummary[];
    reviewDir: string;
    /** Return the refreshed sessions to stay open, or null to close and navigate. */
    onAction: (
        summary: SessionSummary,
        action: SessionHistoryAction,
    ) => Promise<SessionSummary[] | null>;
}

type StatusFilter = 'all' | SessionStatus;
type FlagFilter = 'any' | 'flagged' | 'no-flags';

function categoryNames(
    summary: SessionSummary,
    reviewDir: string,
): string[] {
    const scope = summary.log.qs_snapshot.categoryScope;
    if (scope.length > 0) return [scope.join(' / ')];
    const root = reviewDir.replace(/^\/+|\/+$/g, '');
    const prefix = root ? `${root}/` : '';
    const names = new Set<string>();
    for (const path of summary.log.frozen_pool) {
        const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path;
        const parts = rel.split('/');
        if (parts.length > 1 && parts[0]) names.add(parts[0]);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}

function submittedCount(summary: SessionSummary): number {
    return Object.values(summary.log.answers).filter((a) => a.submitted === true).length;
}

export class SessionHistoryModal extends Modal {
    private options: SessionHistoryModalOptions;
    private search = '';
    private status: StatusFilter = 'all';
    private flags: FlagFilter = 'any';
    private from = '';
    private to = '';
    private category = '';
    private selected: SessionSummary | null = null;
    private listEl!: HTMLElement;
    private detailEl!: HTMLElement;
    private countEl!: HTMLElement;
    private clearBtn!: HTMLButtonElement;
    private searchEl!: HTMLInputElement;
    private fromEl!: HTMLInputElement;
    private toEl!: HTMLInputElement;
    private categoryEl!: HTMLSelectElement;
    private statusGroupEl!: HTMLElement;
    private flagGroupEl!: HTMLElement;

    constructor(app: App, options: SessionHistoryModalOptions) {
        super(app);
        this.options = options;
    }

    onOpen(): void {
        const { contentEl } = this;
        this.modalEl.addClass('rv-history-modal');
        contentEl.empty();
        contentEl.addClass('rv-history-shell');

        const header = contentEl.createDiv({ cls: 'rv-history-header' });
        header.createEl('h2', { text: 'Session history' });
        header.createEl('p', {
            cls: 'setting-item-description',
            text: 'Filter sessions, then inspect or act on the selected session in the detail pane.',
        });

        const body = contentEl.createDiv({ cls: 'rv-history-body' });
        const filters = body.createDiv({ cls: 'rv-history-filters' });
        const searchRow = filters.createDiv({ cls: 'rv-history-filter-row' });
        searchRow.createEl('label', { text: 'Search' });
        const search = searchRow.createEl('input', {
            type: 'search',
            cls: 'rv-history-search',
            attr: { placeholder: 'Session name, id, Manage preset, or category' },
        });
        this.searchEl = search;
        search.addEventListener('input', () => {
            this.search = search.value.trim().toLowerCase();
            this.renderList();
        });
        // A focused search collapses the chip/date filter rows on phones so
        // the results keep room above the IME; see the `is-search-focused`
        // rules in styles.css. The class is toggled here because `:has(:focus)`
        // is not reliable inside Obsidian's nested mobile frames.
        search.addEventListener('focus', () => filters.addClass('is-search-focused'));
        search.addEventListener('blur', () => filters.removeClass('is-search-focused'));

        const statusRow = filters.createDiv({ cls: 'rv-history-filter-row' });
        statusRow.createEl('label', { text: 'Status' });
        const statusGroup = statusRow.createDiv({ cls: 'rv-history-chip-row' });
        this.statusGroupEl = statusGroup;
        const statusOptions: [StatusFilter, string][] = [
            ['all', 'All'],
            ['completed', 'Completed'],
            ['abandoned', 'Abandoned'],
            ['archived', 'Archived'],
            ['pending', 'Pending'],
        ];
        for (const [value, label] of statusOptions) {
            this.mkChip(statusGroup, label, value, this.status === value, () => {
                this.status = value;
                this.refreshChips(statusGroup, value);
                this.renderList();
            });
        }

        const flagRow = filters.createDiv({ cls: 'rv-history-filter-row' });
        flagRow.createEl('label', { text: 'Flags' });
        const flagGroup = flagRow.createDiv({ cls: 'rv-history-chip-row' });
        this.flagGroupEl = flagGroup;
        const flagOptions: [FlagFilter, string][] = [
            ['any', 'Any'],
            ['flagged', 'Flagged'],
            ['no-flags', 'No flags'],
        ];
        for (const [value, label] of flagOptions) {
            this.mkChip(flagGroup, label, value, this.flags === value, () => {
                this.flags = value;
                this.refreshChips(flagGroup, value);
                this.renderList();
            });
        }

        const dateRow = filters.createDiv({
            cls: 'rv-history-filter-row rv-history-filter-row-dates',
        });
        dateRow.createEl('label', { text: 'Date' });
        const from = dateRow.createEl('input', {
            type: 'date',
            cls: 'rv-history-date',
            attr: { 'aria-label': 'From date' },
        });
        this.fromEl = from;
        from.addEventListener('change', () => {
            this.from = from.value;
            this.renderList();
        });
        dateRow.createSpan({ cls: 'rv-muted', text: 'to' });
        const to = dateRow.createEl('input', {
            type: 'date',
            cls: 'rv-history-date',
            attr: { 'aria-label': 'To date' },
        });
        this.toEl = to;
        to.addEventListener('change', () => {
            this.to = to.value;
            this.renderList();
        });

        dateRow.createEl('label', { text: 'Category' });
        const categorySelect = dateRow.createEl('select', {
            cls: 'dropdown rv-history-category',
        });
        this.categoryEl = categorySelect;
        categorySelect.createEl('option', {
            text: 'All categories',
            attr: { value: '' },
        });
        const categories = new Set<string>();
        for (const summary of this.options.sessions) {
            for (const name of categoryNames(summary, this.options.reviewDir)) {
                categories.add(name);
            }
        }
        for (const name of [...categories].sort((a, b) => a.localeCompare(b))) {
            categorySelect.createEl('option', { text: name, attr: { value: name } });
        }
        categorySelect.addEventListener('change', () => {
            this.category = categorySelect.value;
            this.renderList();
        });

        const summaryRow = body.createDiv({ cls: 'rv-history-summary-row' });
        this.countEl = summaryRow.createSpan({ cls: 'rv-muted' });
        this.clearBtn = summaryRow.createEl('button', {
            text: 'Clear filters',
            cls: 'rv-history-clear',
            attr: { type: 'button' },
        });
        this.clearBtn.addEventListener('click', () => this.clearFilters());

        const workspace = body.createDiv({ cls: 'rv-history-workspace' });
        this.listEl = workspace.createDiv({ cls: 'rv-history-list' });
        this.detailEl = workspace.createDiv({ cls: 'rv-history-detail' });

        const footer = contentEl.createDiv({
            cls: 'modal-button-container rv-history-footer',
        });
        const close = footer.createEl('button', { text: 'Close' });
        close.addEventListener('click', () => this.close());

        this.renderList();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private mkChip(
        parent: HTMLElement,
        label: string,
        value: string,
        active: boolean,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = parent.createEl('button', {
            text: label,
            cls: `rv-mode rv-history-chip${active ? ' is-active' : ''}`,
            attr: { type: 'button', 'data-value': value },
        });
        button.addEventListener('click', onClick);
        return button;
    }

    private refreshChips(parent: HTMLElement, activeValue: string): void {
        for (const child of Array.from(parent.children)) {
            if (!child.instanceOf(HTMLButtonElement)) continue;
            child.toggleClass('is-active', child.dataset.value === activeValue);
        }
    }

    private categoryCache = new WeakMap<SessionSummary, string[]>();

    private getCategories(summary: SessionSummary): string[] {
        let cached = this.categoryCache.get(summary);
        if (!cached) {
            cached = categoryNames(summary, this.options.reviewDir);
            this.categoryCache.set(summary, cached);
        }
        return cached;
    }

    private matches(summary: SessionSummary): boolean {
        const { log } = summary;
        if (this.status !== 'all' && log.status !== this.status) return false;
        if (this.flags === 'flagged' && log.flags.length === 0) return false;
        if (this.flags === 'no-flags' && log.flags.length > 0) return false;
        const date = log.created.slice(0, 10);
        if (this.from && date < this.from) return false;
        if (this.to && date > this.to) return false;
        
        if (this.category) {
            if (!this.getCategories(summary).includes(this.category)) {
                return false;
            }
        }
        if (this.search) {
            const haystack = `${log.session_id} ${log.session_name} ${log.qs_snapshot.managePresetName} ${this.getCategories(summary).join(' ')}`.toLowerCase();
            if (!haystack.includes(this.search)) return false;
        }
        return true;
    }

    private hasFilters(): boolean {
        return (
            this.search !== '' ||
            this.status !== 'all' ||
            this.flags !== 'any' ||
            this.from !== '' ||
            this.to !== '' ||
            this.category !== ''
        );
    }

    private clearFilters(): void {
        this.search = '';
        this.status = 'all';
        this.flags = 'any';
        this.from = '';
        this.to = '';
        this.category = '';
        this.searchEl.value = '';
        this.fromEl.value = '';
        this.toEl.value = '';
        this.categoryEl.value = '';
        this.refreshChips(this.statusGroupEl, 'all');
        this.refreshChips(this.flagGroupEl, 'any');
        this.renderList();
    }

    private renderList(): void {
        const filtered = this.options.sessions.filter((summary) => this.matches(summary));
        this.countEl.setText(
            `${filtered.length} of ${this.options.sessions.length} session${
                this.options.sessions.length === 1 ? '' : 's'
            }`,
        );
        this.clearBtn.disabled = !this.hasFilters();
        if (this.selected && !filtered.includes(this.selected)) this.selected = null;
        if (!this.selected && filtered.length > 0) this.selected = filtered[0]!;

        const scrollTop = this.listEl.scrollTop;
        this.listEl.empty();
        if (filtered.length === 0) {
            this.listEl.createEl('p', {
                cls: 'rv-history-empty',
                text: 'No sessions match these filters.',
            });
            this.renderDetail();
            return;
        }

        for (const summary of filtered) {
            const { log } = summary;
            const row = this.listEl.createEl('button', {
                cls: `rv-history-row${this.selected === summary ? ' is-selected' : ''}`,
                attr: { type: 'button' },
            });
            row.createSpan({ cls: 'rv-history-date', text: log.created.slice(0, 10) });
            const label = row.createSpan({ cls: 'rv-history-label' });
            label.createSpan({ text: sessionLabel(log) });
            row.createSpan({
                cls: 'rv-history-progress',
                text: `${submittedCount(summary)}/${log.frozen_pool.length}`,
            });
            row.createSpan({
                cls: `rv-session-status rv-status-${log.status}`,
                text: statusLabel(log.status),
            });
            row.createSpan({
                cls: `rv-history-flags${log.flags.length > 0 ? ' has-flags' : ''}`,
                text: `flags ${log.flags.length}`,
            });
            row.addEventListener('click', () => {
                this.selected = summary;
                this.renderList();
            });
        }
        this.listEl.scrollTop = scrollTop;
        this.renderDetail();
    }

    private renderDetail(): void {
        this.detailEl.empty();
        if (!this.selected) {
            this.detailEl.createEl('p', {
                cls: 'rv-history-empty',
                text: 'Select a session to view details.',
            });
            return;
        }
        this.detailEl.createEl('h3', {
            cls: 'rv-history-detail-title',
            text: sessionDetailTitle(this.selected),
        });
        renderSessionDetailPanel(this.detailEl, {
            summary: this.selected,
            onOpenNote: () => {
                if (this.selected) {
                    void this.app.workspace.getLeaf('tab').openFile(this.selected.file);
                }
            },
            onAction: (action) => this.runAction(action),
        });
    }

    private async runAction(action: SessionHistoryAction): Promise<void> {
        const selected = this.selected;
        if (!selected) return;
        const sessionId = selected.log.session_id;
        const updated = await this.options.onAction(selected, action);
        if (updated === null) {
            this.close();
            return;
        }
        this.options.sessions = updated;
        this.selected =
            updated.find((summary) => summary.log.session_id === sessionId) ??
            updated.find((summary) => this.matches(summary)) ??
            null;
        this.renderList();
    }
}
