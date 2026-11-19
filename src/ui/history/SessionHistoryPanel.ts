/** Collapsible session history panel — recent + archived views. */
import type { SessionSummary } from '../../vault/sessionLog';
import { sessionLabel, statusLabel } from '../../vault/sessionLog';

export type SessionHistoryView = 'recent' | 'archived';

export interface SessionHistoryExpanded {
    recent: boolean;
    archived: boolean;
}

export interface SessionHistoryProps {
    root: HTMLElement;
    sessions: SessionSummary[];
    summaryLabel?: string;
    open?: boolean;
    view?: SessionHistoryView;
    expanded?: SessionHistoryExpanded;
    onToggle?: (open: boolean) => void;
    onViewChange?: (view: SessionHistoryView) => void;
    onExpandedChange?: (view: SessionHistoryView, expanded: boolean) => void;
    onOpenDetail: (summary: SessionSummary) => void;
}

export function renderSessionHistoryPanel(props: SessionHistoryProps): void {
    const { root, sessions } = props;

    const expandedState: SessionHistoryExpanded = {
        recent: props.expanded?.recent ?? false,
        archived: props.expanded?.archived ?? false,
    };

    const details = root.createEl('details', { cls: 'rv-sessions' });
    details.open = props.open ?? false;
    
    details.addEventListener('toggle', () => {
        // If the user is collapsing the main panel, reset the inner list view
        if (!details.open) {
            if (expandedState.recent || expandedState.archived) {
                expandedState.recent = false;
                expandedState.archived = false;
                props.onExpandedChange?.('recent', false);
                props.onExpandedChange?.('archived', false);
                renderList(); // Update the DOM so it's ready in the collapsed state
            }
        }
        props.onToggle?.(details.open);
    });
    details.createEl('summary', {
        text: props.summaryLabel ?? `Session history (${sessions.length})`,
    });
    const body = details.createDiv({ cls: 'rv-sessions-body' });

    if (sessions.length === 0) {
        body.createEl('p', { cls: 'rv-muted', text: 'No sessions yet.' });
        return;
    }

    let view: SessionHistoryView = props.view ?? 'recent';
    const FEW_COUNT = 4;
    // expandedState is now initialized at the top of the function.
    const toggle = body.createDiv({ cls: 'rv-sessions-toggle' });
    const recentBtn = toggle.createEl('button', {
        text: 'Recent',
        cls: view === 'recent' ? 'rv-mode is-active' : 'rv-mode',
    });
    const archivedBtn = toggle.createEl('button', {
        text: 'Archived',
        cls: view === 'archived' ? 'rv-mode is-active' : 'rv-mode',
    });
    const list = body.createDiv({ cls: 'rv-sessions-list' });

    const renderList = (): void => {
        list.empty();
        const filtered = view === 'recent'
            ? sessions.filter(
                  (s) =>
                      s.log.status !== 'abandoned' && s.log.status !== 'archived',
              )
            : sessions.filter(
                  (s) =>
                      s.log.status === 'abandoned' || s.log.status === 'archived',
              );

        if (filtered.length === 0) {
            list.createEl('p', {
                cls: 'rv-muted',
                text: view === 'recent' ? 'No recent sessions.' : 'No archived sessions.',
            });
            return;
        }

        const visible = expandedState[view]
            ? filtered
            : filtered.slice(0, FEW_COUNT);

        for (const summary of visible) {
            const { log } = summary;
            const row = list.createEl('button', { cls: 'rv-session-row' });
            row.createSpan({
                cls: `rv-session-status rv-status-${log.status}`,
                text: statusLabel(log.status),
            });
            row.createSpan({ cls: 'rv-session-label', text: sessionLabel(log) });
            const submitted = Object.values(log.answers).filter((a) => a.submitted === true).length;
            const total = log.frozen_pool.length;
            row.createSpan({ cls: 'rv-session-progress', text: `${submitted}/${total}` });
            row.createSpan({
                cls: `rv-session-flags${log.flags.length > 0 ? ' has-flags' : ''}`,
                text: `flags ${log.flags.length}`,
            });
            row.addEventListener('click', () => props.onOpenDetail(summary));
        }

        if (filtered.length > FEW_COUNT) {
            const more = list.createEl('button', {
                cls: 'rv-sessions-more',
                text: expandedState[view]
                    ? 'Show few'
                    : `Show all (${filtered.length})`,
            });
            more.addEventListener('click', () => {
                expandedState[view] = !expandedState[view];
                props.onExpandedChange?.(view, expandedState[view]);
                renderList();
            });
        }
    };

    recentBtn.addEventListener('click', () => {
        view = 'recent';
        props.onViewChange?.(view);
        recentBtn.addClass('is-active');
        archivedBtn.removeClass('is-active');
        renderList();
    });
    archivedBtn.addEventListener('click', () => {
        view = 'archived';
        props.onViewChange?.(view);
        archivedBtn.addClass('is-active');
        recentBtn.removeClass('is-active');
        renderList();
    });

    renderList();
}