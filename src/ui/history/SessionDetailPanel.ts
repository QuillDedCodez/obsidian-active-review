/** Shared session detail body used by the detail modal and full history. */
import { formatStopwatchMs, formatTimerMs, formatTimeInput } from '../../session';
import type { SessionSummary } from '../../vault/sessionLog';
import { sessionLabel, statusLabel } from '../../vault/sessionLog';

export type SessionDetailAction =
    | 'view'
    | 'resume'
    | 'restart'
    | 'reproduce'
    | 'rename'
    | 'archive'
    | 'unarchive'
    | 'delete';

export interface SessionDetailPanelOptions {
    summary: SessionSummary;
    onAction: (action: SessionDetailAction) => void | Promise<void>;
    showClose?: boolean;
    onClose?: () => void;
    /** Hide the View session action (e.g. while already viewing the session). */
    hideView?: boolean;
    /** Open the raw session note in a new tab. Shown for every status. */
    onOpenNote?: () => void;
}

export function renderSessionDetailPanel(
    parent: HTMLElement,
    options: SessionDetailPanelOptions,
): void {
    const { summary } = options;
    const { log } = summary;

    // Shared shell for both the standalone modal and the history detail pane:
    // a scrollable body plus a fixed action footer.
    const root = parent.createDiv({ cls: 'rv-session-detail' });
    const body = root.createDiv({ cls: 'rv-session-detail-body' });

    const meta = body.createDiv({ cls: 'rv-detail-meta' });
    meta.createSpan({
        cls: `rv-detail-status rv-status-${log.status}`,
        text: statusLabel(log.status),
    });
    meta.createSpan({ text: `Created ${log.created}` });
    if (log.completed_at) meta.createSpan({ text: `Completed ${log.completed_at}` });

    const submitted = Object.values(log.answers).filter((a) => a.submitted === true).length;
    const correct = Object.values(log.answers).filter((a) => a.isCorrect).length;
    const submitLabel =
        log.qs_snapshot.show === 'immediate'
            ? 'AutoSubmit'
            : log.qs_snapshot.show === 'submitAll'
              ? 'Submit all'
              : 'Submit any';
    const gradeLabel = log.qs_snapshot.grade === 'afterAll' ? 'After all' : 'Immediate';
    const passLabel =
        log.qs_snapshot.passScore === 'off' ? 'Off' : `${log.qs_snapshot.passScore}%`;
    const snap = log.qs_snapshot;
    const modeLabel = (mode: 'off' | 'on' | 'soft'): string =>
        mode === 'off' ? 'Off' : mode === 'on' ? 'ON' : 'SOFT';
    const sessionTimerLabel =
        snap.timer_session_mode === 'off' || snap.timer_session === 'off'
            ? 'Off'
            : `${modeLabel(snap.timer_session_mode)} ${formatTimeInput(snap.timer_session)}`;
    const questionTimerLabel =
        snap.timer_question_mode === 'off' || snap.timer_per_question === 'off'
            ? 'Off'
            : `${modeLabel(snap.timer_question_mode)} ${formatTimeInput(snap.timer_per_question)}`;
    const warnLabel = (seconds: number): string => (seconds > 0 ? `${seconds}s` : 'Off');
    const sessionRemaining =
        snap.timer_session_mode === 'off'
            ? 'Off'
            : log.timer_state
              ? formatTimerMs(log.timer_state.sessionRemainingMs)
              : '—';
    const sessionStopwatch =
        !snap.stopwatch_session
            ? 'Off'
            : log.timer_state
              ? formatStopwatchMs(log.timer_state.sessionElapsedMs)
              : '—';

    const grid = body.createDiv({ cls: 'rv-detail-grid' });
    const rows: [string, string][] = [
        ['Submitted', `${submitted} / ${log.frozen_pool.length}`],
        ['Correct', String(correct)],
        ['Flags', String(log.flags.length)],
        ['Navigator', snap.navigator ? 'On' : 'Off'],
        ['Allow flag', snap.allowFlag ? 'On' : 'Off'],
        ['Submit', submitLabel],
        ['Grade', gradeLabel],
        ['Pass score', passLabel],
        [
            'Manage questions',
            `${snap.managePresetName} (${
                snap.manageIncludedPaths.length || log.frozen_pool.length
            } selected)`,
        ],
        ['Session timer', sessionTimerLabel],
        ['Session timer warning', warnLabel(snap.timer_session_warning)],
        ['Per-question timer', questionTimerLabel],
        ['Per-question timer warning', warnLabel(snap.timer_question_warning)],
        ['Session stopwatch', snap.stopwatch_session ? 'On' : 'Off'],
        ['Per-question stopwatch', snap.stopwatch_question ? 'On' : 'Off'],
        ['Session timer remaining', sessionRemaining],
        ['Session stopwatch elapsed', sessionStopwatch],
        ['Seed', String(log.session_seed)],
        ['Config', `${snap.presentation} · ${snap.order} · ${snap.trim}`],
    ];
    if (log.source_session) rows.push(['Reproduced from', log.source_session]);
    if (log.reproduced_into.length > 0) {
        rows.push(['Reproduced into', log.reproduced_into.join(', ')]);
    }
    if (snap.categoryScope.length > 0) {
        rows.push(['Category scope', snap.categoryScope.join(' / ')]);
    }
    for (const [key, value] of rows) {
        grid.createSpan({ cls: 'rv-detail-key', text: key });
        grid.createSpan({ cls: 'rv-detail-val', text: value });
    }

    if (log.flags.length > 0) {
        const flagsDetails = body.createEl('details', { cls: 'rv-detail-flags' });
        flagsDetails.open = true;
        flagsDetails.createEl('summary', {
            text: `Flagged questions (${log.flags.length})`,
        });
        const flagList = flagsDetails.createEl('ul');
        for (const frozenIdx of log.flags) {
            const path = log.frozen_pool[frozenIdx];
            const displayIdx = log.initial_order.indexOf(frozenIdx);
            const li = flagList.createEl('li');
            li.createSpan({
                cls: 'rv-detail-qn',
                text: `${displayIdx >= 0 ? displayIdx + 1 : frozenIdx + 1}.`,
            });
            li.createSpan({
                cls: 'rv-detail-qp',
                text: path ?? '(missing)',
            });
        }
    }

    const poolDetails = body.createEl('details', { cls: 'rv-detail-pool' });
    poolDetails.createEl('summary', {
        text: `Frozen pool (${log.frozen_pool.length})`,
    });
    const list = poolDetails.createEl('ul');
    const questionTimerOn =
        snap.timer_question_mode !== 'off' && snap.timer_per_question !== 'off';
    const questionStopwatchOn = snap.stopwatch_question;
    log.initial_order.forEach((frozenIdx, displayIdx) => {
        const path = log.frozen_pool[frozenIdx];
        const ans = log.answers[String(frozenIdx)];
        const state = !path
            ? 'missing'
            : ans
              ? ans.isCorrect === true
                  ? 'correct'
                  : ans.isCorrect === false
                    ? 'wrong'
                    : ans.submitted === true
                      ? 'submitted'
                      : 'in-progress'
              : 'unanswered';
        const li = list.createEl('li', { cls: `rv-detail-q rv-q-${state}` });
        li.createSpan({ cls: 'rv-detail-qn', text: `${displayIdx + 1}.` });
        li.createSpan({ cls: 'rv-detail-qp', text: path ?? '(missing)' });
        li.createSpan({
            cls: 'rv-detail-qs',
            text: state.charAt(0).toUpperCase() + state.slice(1),
        });
        if (log.flags.includes(frozenIdx)) {
            li.createSpan({ cls: 'rv-detail-flag', text: 'flag' });
        }

        if (path && questionTimerOn) {
            const key = String(frozenIdx);
            const timerMs =
                ans?.timerRemainingMs ?? log.timer_state?.questionRemainingMs[key];
            li.createSpan({
                cls: 'rv-detail-qtime',
                text:
                    timerMs !== undefined
                        ? `Timer ${formatTimerMs(timerMs)} ${
                              ans?.submitted ? 'recorded' : 'remaining'
                          }`
                        : 'Timer —',
            });
        }
        if (path && questionStopwatchOn) {
            const key = String(frozenIdx);
            const stopwatchMs =
                ans?.timeSpentMs ?? log.timer_state?.questionElapsedMs[key];
            li.createSpan({
                cls: 'rv-detail-qtime',
                text:
                    stopwatchMs !== undefined
                        ? `Stopwatch ${formatStopwatchMs(stopwatchMs)} ${
                              ans?.submitted ? 'recorded' : 'current'
                          }`
                        : 'Stopwatch —',
            });
        }
        if (ans?.timerExpired) {
            li.createSpan({ cls: 'rv-detail-qtimer', text: 'timer expired' });
        }
    });

    const warning = body.createDiv({ cls: 'rv-detail-warning' });
    if (log.status === 'pending') {
        warning.setText(
            'Configuration locked. Continuing resumes this session with the frozen pool and answers. Missing questions will be skipped.',
        );
    } else if (log.status === 'completed') {
        warning.setText(
            'Reproduce creates a new pending session. Answers, scratch, and flags will be cleared. Pool and seed reused.',
        );
    } else if (log.status === 'archived') {
        warning.setText(
            'This completed session is archived. Unarchive it to return it to the completed list, or reproduce it as a fresh pending session.',
        );
    } else {
        warning.setText(
            'This pending session was abandoned. Reproduce creates a fresh pending session with the same frozen pool and seed.',
        );
    }

    const buttons = root.createDiv({
        cls: 'modal-button-container rv-detail-actions rv-session-detail-actions',
    });
    let busy = false;
    const actionButtons: HTMLButtonElement[] = [];
    const addAction = (
        label: string,
        action: SessionDetailAction,
        cls?: string,
    ): HTMLButtonElement => {
        const button = buttons.createEl('button', {
            text: label,
            cls,
            attr: { type: 'button' },
        });
        actionButtons.push(button);
        button.addEventListener('click', () => {
            if (busy) return;
            busy = true;
            for (const item of actionButtons) item.disabled = true;
            void (async () => {
                try {
                    await options.onAction(action);
                } finally {
                    busy = false;
                    for (const item of actionButtons) {
                        if (item.isConnected) item.disabled = false;
                    }
                }
            })();
        });
        return button;
    };

    if (options.onOpenNote) {
        const openNote = buttons.createEl('button', {
            text: 'Open raw note',
            attr: { type: 'button' },
        });
        openNote.addEventListener('click', () => options.onOpenNote?.());
    }
    if (!options.hideView) addAction('View session', 'view');
    if (log.status === 'pending') {
        addAction('Continue', 'resume', 'mod-cta');
        addAction('Restart', 'restart');
    } else {
        addAction('Reproduce', 'reproduce', 'mod-cta');
    }
    addAction('Rename', 'rename');
    if (log.status === 'abandoned' || log.status === 'archived') {
        addAction('Unarchive', 'unarchive');
    } else {
        addAction('Archive', 'archive');
    }
    addAction('Delete', 'delete', 'mod-warning');
    if (options.showClose) {
        const close = buttons.createEl('button', {
            text: 'Close',
            attr: { type: 'button' },
        });
        close.addEventListener('click', () => options.onClose?.());
    }
}

/** Header label for a selected session. */
export function sessionDetailTitle(summary: SessionSummary): string {
    return `Session ${sessionLabel(summary.log)}`;
}
