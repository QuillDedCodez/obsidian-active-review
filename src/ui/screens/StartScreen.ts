/** The pre-session screen. */
import {
    MAX_CHOICE_COUNT,
    MIN_CHOICE_COUNT,
    PLUGIN_NAME,
    clampChoiceCount,
    type GradeMode,
    type OrderMode,
    type SessionConfig,
    type SubmitMode,
} from '../../constants';
import type { Mode } from '../../session';
import type { SessionSummary } from '../../vault/sessionLog';
import type { ManageQuestionPreset } from '../../vault/managePresets';
import type { SessionPreset } from '../../vault/sessionPresets';
import type { Warning } from '../../parser';
import { renderChipList, type ChipItem } from '../ChipList';
import { renderSessionHistoryPanel } from '../history/SessionHistoryPanel';
import type {
    SessionHistoryExpanded,
    SessionHistoryView,
} from '../history/SessionHistoryPanel';
import {
    renderTimerConfigSection,
    type TimerConfigSectionHandle,
} from '../TimerConfigSection';
import {
    attachAlertCopyButton,
    formatSkippedNotes,
    skippedIssueLabel,
    formatWarningNotes,
} from '../alertNotes';

/** Sentinel used by `activeSessionPresetId` to mean "the plugin default config". */
export const DEFAULT_SESSION_PRESET_ID = '__default';

export interface StartScreenProps {
    root: HTMLElement;
    questionCount: number;
    totalQuestionCount: number;
    mismatchedCount: number;
    issues: [string, string][];
    warnings: [string, Warning[]][];
    mode: Mode;
    onModeChange: (mode: Mode) => void;
    sessionConfig: SessionConfig;
    onSessionConfigChange: (patch: Partial<SessionConfig>) => void;
    sessionName: string;
    onSessionNameChange: (name: string) => void;
    onOpenSessionPresets: () => void;
    onOpenFullHistory: () => void;
    managePresets: ManageQuestionPreset[];
    hasLastCustom: boolean;
    managePresetsExpanded: boolean;
    onManagePresetsExpandedChange: (expanded: boolean) => void;
    onManageQuestions: () => void;
    onManagePresetSelect: (id: string) => void;
    sessionPresets: SessionPreset[];
    activeSessionPresetId: string | null;
    sessionPresetsExpanded: boolean;
    onSessionPresetsExpandedChange: (expanded: boolean) => void;
    onSessionPresetSelect: (id: string | null) => void;
    onSessionPresetDefault: () => void;
    onSessionPresetSave: () => void;
    onSessionPresetUpdate: () => void;
    onSessionPresetDirty: () => void;
    sessions: SessionSummary[];
    sessionsOpen: boolean;
    sessionsView: SessionHistoryView;
    sessionsExpanded: SessionHistoryExpanded;
    onSessionsToggle: (open: boolean) => void;
    onSessionsViewChange: (view: SessionHistoryView) => void;
    onSessionsExpandedChange: (view: SessionHistoryView, expanded: boolean) => void;
    onStart: () => void;
    onContinueRecent: () => void;
    onRescan: () => void;
    onOpenSessionDetail: (summary: SessionSummary) => void;
    /** Open a vault-relative note path, used by the skipped/warning outlines. */
    onOpenNote: (path: string) => void;
}

export function renderStartScreen(props: StartScreenProps): void {
    const { root } = props;

    // Capture the current scroll position before wiping the DOM to prevent jump-scroll
    const existingBody = root.querySelector<HTMLElement>('.rv-start-body');
    const previousScrollTop = existingBody ? existingBody.scrollTop : 0;

    root.empty();
    root.addClass('rv-start-mode');

    // --- 1. Fixed Header Section ---
    const header = root.createDiv({ cls: 'rv-start-header' });
    header.createEl('h2', { text: PLUGIN_NAME });
    const actions = header.createDiv({ cls: 'rv-actions rv-start-actions' });
    const start = actions.createEl('button', {
        text: 'Start New Session',
        cls: 'mod-cta',
    });
    start.disabled = props.questionCount === 0;
    start.addEventListener('click', () => props.onStart());

    const pendingCount = props.sessions.filter(
        (s) => s.log.status === 'pending',
    ).length;
    const continueRecent = actions.createEl('button', {
        text: 'Continue Recent Session',
    });
    continueRecent.disabled = pendingCount === 0;
    if (pendingCount === 0) continueRecent.title = 'No pending session';
    continueRecent.addEventListener('click', () => props.onContinueRecent());

    // --- 2. Scrollable Body Section ---
    const body = root.createDiv({ cls: 'rv-start-body' });

    // "Sticky overlay" state: track scrolling to trigger the shadow and enable jump-scroll
    body.addEventListener('scroll', () => {
        header.toggleClass('is-scrolled', body.scrollTop > 0);
    }, { passive: true });

    const attachCollapseScroll = (details: HTMLDetailsElement) => {
        details.addEventListener('toggle', () => {
            if (details.open) return;
            
            // GATE: Do nothing if the page is at the very top (overlay not triggered)
            if (!header.hasClass('is-scrolled')) return;

            // Wait for the collapse layout to settle, then scroll the header into view
            window.setTimeout(() => {
                details.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 10);
        });
    };

    const status = body.createDiv({ cls: 'rv-start-status' });
    status.createEl('p', {
        cls: 'rv-muted',
        text: `${props.questionCount} of ${props.totalQuestionCount} question${props.totalQuestionCount === 1 ? '' : 's'} selected.`,
    });
    if (props.mismatchedCount > 0) {
        status.createEl('p', {
            cls: 'rv-need-sync',
            text: `${props.mismatchedCount} question${props.mismatchedCount === 1 ? '' : 's'} need Category Sync and are excluded.`,
        });
    }

    // Session list.
    const sessionsSection = body.createDiv({ cls: 'rv-start-section' });
    const sessionsHead = sessionsSection.createDiv({ cls: 'rv-start-section-head' });
    sessionsHead.createEl('h3', { text: 'Session List' });
    const sessionsActions = sessionsHead.createDiv({ cls: 'rv-start-head-actions' });
    const historyBtn = sessionsActions.createEl('button', {
        text: `Full history (${props.sessions.length})`,
        cls: 'rv-link-button',
    });
    historyBtn.disabled = props.sessions.length === 0;
    historyBtn.addEventListener('click', () => props.onOpenFullHistory());
    const rescan = sessionsActions.createEl('button', {
        text: 'Rescan notes',
        cls: 'rv-link-button',
    });
    rescan.addEventListener('click', () => props.onRescan());
    const sessionsHost = sessionsSection.createDiv();
    renderSessionHistoryPanel({
        root: sessionsHost,
        sessions: props.sessions,
        summaryLabel: `Recent and archived (${props.sessions.length})`,
        open: props.sessionsOpen,
        view: props.sessionsView,
        expanded: props.sessionsExpanded,
        onToggle: props.onSessionsToggle,
        onViewChange: props.onSessionsViewChange,
        onExpandedChange: props.onSessionsExpandedChange,
        onOpenDetail: props.onOpenSessionDetail,
    });
    const sessionsDetails = sessionsHost.querySelector('details');
    if (sessionsDetails) attachCollapseScroll(sessionsDetails);

    // Skipped notes and warnings.
    const createNoteLink = (parent: HTMLElement, path: string): void => {
        const link = parent.createEl('a', {
            cls: 'rv-outline-path rv-note-link',
            text: path,
        });
        link.href = path;
        link.addEventListener('click', (evt) => {
            evt.preventDefault();
            props.onOpenNote(path);
        });
        link.addEventListener('auxclick', (evt) => {
            // Middle-click would otherwise navigate the app window to a
            // vault-relative href; route it through the same opener instead.
            if (evt.button === 1) {
                evt.preventDefault();
                props.onOpenNote(path);
            }
        });
    };

    const alerts =
        props.issues.length > 0 || props.warnings.length > 0
            ? body.createDiv({ cls: 'rv-start-alerts' })
            : null;

    if (props.issues.length > 0) {
        const issuesSection = (alerts ?? body).createDiv({ cls: 'rv-start-section' });
        issuesSection.createEl('h3', { text: 'Skipped Note' });
        const details = issuesSection.createEl('details', { cls: 'rv-issues' });
        const summaryRow = details
            .createEl('summary')
            .createDiv({ cls: 'rv-alert-summary' });
        summaryRow.createSpan({
            text: `${props.issues.length} note${props.issues.length === 1 ? '' : 's'} skipped`,
        });
        attachAlertCopyButton(summaryRow, {
            getText: () => formatSkippedNotes(props.issues),
            ariaLabel: 'Copy all skipped notes',
        });

        const ul = details.createEl('ul', { cls: 'rv-outline-list' });
        for (const [path, reason] of props.issues) {
            const li = ul.createEl('li');
            createNoteLink(li, path);
            const sub = li.createEl('ul', { cls: 'rv-outline-sublist' });
            const subLi = sub.createEl('li');
            subLi.createDiv({
                cls: 'rv-outline-header',
                text: `## ${skippedIssueLabel(reason)}`,
            });
            const msgList = subLi.createEl('ul', { cls: 'rv-outline-messages' });
            msgList.createEl('li', { cls: 'rv-outline-message', text: reason });
        }
        attachCollapseScroll(details);
    }

    if (props.warnings.length > 0) {
        const warningsSection = (alerts ?? body).createDiv({ cls: 'rv-start-section' });
        warningsSection.createEl('h3', { text: 'Warning Note' });
        const totalWarnings = props.warnings.reduce((n, [, ws]) => n + ws.length, 0);
        const details = warningsSection.createEl('details', { cls: 'rv-warnings' });
        const summaryRow = details
            .createEl('summary')
            .createDiv({ cls: 'rv-alert-summary' });
        summaryRow.createSpan({
            text:
                `${totalWarnings} warning${totalWarnings === 1 ? '' : 's'} in ` +
                `${props.warnings.length} note${props.warnings.length === 1 ? '' : 's'}`,
        });
        attachAlertCopyButton(summaryRow, {
            getText: () => formatWarningNotes(props.warnings),
            ariaLabel: 'Copy all warning notes',
        });

        const ul = details.createEl('ul', { cls: 'rv-outline-list' });

        for (const [path, ws] of props.warnings) {
            const li = ul.createEl('li');
            createNoteLink(li, path);

            const sub = li.createEl('ul', { cls: 'rv-outline-sublist' });

            // Group warnings by their section header
            const groups = new Map<string, string[]>();
            for (const w of ws) {
                if (!groups.has(w.section)) groups.set(w.section, []);
                groups.get(w.section)!.push(w.message);
            }

            for (const [section, messages] of groups) {
                const sectionLi = sub.createEl('li');
                sectionLi.createDiv({
                    cls: 'rv-outline-header',
                    text: `## ${section.toUpperCase()}`,
                });
                const msgList = sectionLi.createEl('ul', { cls: 'rv-outline-messages' });
                for (const msg of messages) {
                    msgList.createEl('li', { cls: 'rv-outline-message', text: msg });
                }
            }
        }
        attachCollapseScroll(details);
    }

    // Session configuration.
    const configHead = body.createDiv({
        cls: 'rv-start-section-head rv-start-config-head',
    });
    configHead.createEl('h3', { text: 'Session Configuration' });
    const configActions = configHead.createDiv({ cls: 'rv-start-head-actions' });
    const presetsBtn = configActions.createEl('button', {
        text: 'Manage Session Presets',
        cls: 'rv-link-button',
    });
    presetsBtn.addEventListener('click', () => props.onOpenSessionPresets());

    // Route the preset row + session config card through `.rv-start-body`
    // so they scroll together with the rest of the start screen. This is
    // what makes `body.scrollTo(...)` in attachCollapseScroll() actually
    // jump the scroll position on collapse.
    const bodyProps: StartScreenProps = { ...props, root: body };
    const markCustom = renderSessionPresetRow(bodyProps);
    renderSessionSettings(bodyProps, (patch) => {
        props.onSessionConfigChange(patch);
        markCustom();
    }, markCustom);

    // Restore the scroll position immediately, in the same task as the render.
    // Deferring this to setTimeout let the browser paint the freshly emptied
    // body at scrollTop 0 for one frame, which showed up as a quick jump to the
    // top followed by a jump back down. Setting it here (and re-applying once
    // after layout settles) avoids that flash on both desktop and mobile.
    if (previousScrollTop > 0) {
        body.scrollTop = previousScrollTop;
        window.requestAnimationFrame(() => {
            if (body.scrollTop !== previousScrollTop) {
                body.scrollTop = previousScrollTop;
            }
        });
    }
}

export function renderSessionPresetRow(props: StartScreenProps): () => void {
    const host = props.root.createDiv({ cls: 'rv-session-presets' });
    host.createEl('label', {
        cls: 'rv-config-label',
        text: 'Session presets',
    });

    const items: ChipItem[] = [
        {
            label: 'Default',
            active: props.activeSessionPresetId === DEFAULT_SESSION_PRESET_ID,
            title: 'Reset to plugin defaults',
            onClick: () => props.onSessionPresetDefault(),
        },
        {
            label: 'Custom',
            active: props.activeSessionPresetId === null,
            onClick: () => props.onSessionPresetSelect(null),
        },
        ...props.sessionPresets.map<ChipItem>((preset) => ({
            label: preset.name,
            active: props.activeSessionPresetId === preset.id,
            class: 'rv-mode rv-session-preset',
            onClick: () => props.onSessionPresetSelect(preset.id),
        })),
    ];

    const handle = renderChipList({
        parent: host,
        items,
        rowClass: 'rv-session-preset-row',
        limit: 5,
        expanded: props.sessionPresetsExpanded,
        onExpandedChange: props.onSessionPresetsExpandedChange,
    });

    // ---- Row 2: Save as new, Update existing ----
    const row2 = host.createDiv({
        cls: 'rv-session-preset-row rv-session-preset-row-actions',
    });
    const save = row2.createEl('button', {
        text: '+ Save as new',
        cls: 'rv-mode rv-session-preset-save',
    });
    save.addEventListener('click', () => props.onSessionPresetSave());

    const update = row2.createEl('button', {
        text: 'Update existing…',
        cls: 'rv-mode rv-session-preset-update',
    });
    update.disabled = props.sessionPresets.length === 0;
    if (props.sessionPresets.length === 0) {
        update.title = 'Create a preset first';
    }
    update.addEventListener('click', () => props.onSessionPresetUpdate());

    return (): void => {
        for (const btn of handle.buttons) btn.removeClass('is-active');
        handle.findLabel('Custom')?.addClass('is-active');
        props.onSessionPresetDirty();
    };
}

export function renderSessionSettings(
    props: StartScreenProps,
    changeConfig: (patch: Partial<SessionConfig>) => void,
    markCustom: () => void,
): void {
    const { root, sessionConfig, questionCount: total } = props;
    let timerSection: TimerConfigSectionHandle | null = null;
    let currentMode: Mode = props.mode;
    const presentedCount = (): number =>
        sessionConfig.count === 'all'
            ? total
            : Math.min(sessionConfig.count, total);
    if (props.mode === 'typed' && sessionConfig.submitMode === 'auto') {
        changeConfig({ submitMode: 'any' });
    }

    const card = root.createDiv({ cls: 'rv-card rv-session-config' });
    const timerProps = {
        parent: card,
        config: sessionConfig,
        presentedCount: presentedCount(),
        onChange: (patch: Partial<SessionConfig>) => changeConfig(patch),
    };

    // Session name.
    const nameRow = card.createDiv({ cls: 'rv-config-row rv-span-2' });
    nameRow.createEl('label', { cls: 'rv-config-label', text: 'Session Name (optional)' });
    const nameInput = nameRow.createEl('input', { type: 'text', cls: 'rv-config-text' });
    nameInput.placeholder = 'Optional name';
    nameInput.value = props.sessionName;
    nameInput.addEventListener('input', () => props.onSessionNameChange(nameInput.value));

    // Manage Questions & Question Presets.
    const presetRow = card.createDiv({ cls: 'rv-config-row rv-span-2 rv-manage-presets' });
    const presetHead = presetRow.createDiv({ cls: 'rv-preset-head' });
    presetHead.createEl('label', { cls: 'rv-config-label', text: 'Question Presets' });
    const manageBtn = presetHead.createEl('button', { text: 'Manage questions', cls: 'rv-back' });
    manageBtn.addEventListener('click', () => props.onManageQuestions());

    const manageItems: ChipItem[] = [
        {
            label: 'All questions',
            active: props.sessionConfig.managePresetId === 'all',
            onClick: () => props.onManagePresetSelect('all'),
        },
    ];
    if (props.hasLastCustom || props.sessionConfig.managePresetId === 'last-custom') {
        manageItems.push({
            label: 'Last custom',
            active: props.sessionConfig.managePresetId === 'last-custom',
            onClick: () => props.onManagePresetSelect('last-custom'),
        });
    }
    for (const preset of props.managePresets) {
        manageItems.push({
            label: preset.name,
            active: props.sessionConfig.managePresetId === preset.id,
            onClick: () => props.onManagePresetSelect(preset.id),
        });
    }

    renderChipList({
        parent: presetRow,
        items: manageItems,
        rowClass: 'rv-modes',
        limit: 5,
        expanded: props.managePresetsExpanded,
        onExpandedChange: props.onManagePresetsExpandedChange,
    });

    // Submit options (needed early for mode change).
    const submitOptions: [SubmitMode, string][] = [
        ['auto', 'AutoSubmit'],
        ['any', 'Submit any'],
        ['all', 'Submit all'],
    ];
    const submitButtons: HTMLButtonElement[] = [];

    // Two-column block: Answer Mode / No. of Choices, Presentation / Order,
    // No of Questions / Trim method, Submit / Grade. Explicit row placement
    // keeps the right-column gap reserved when conditional rows are hidden.
    const pairs = card.createDiv({ cls: 'rv-config-pairs rv-span-2' });

    // Answer mode.
    const modeRow = pairs.createDiv({ cls: 'rv-config-row rv-config-mode' });
    modeRow.createEl('label', { cls: 'rv-config-label', text: 'Answer Mode' });
    const modes = modeRow.createDiv({ cls: 'rv-modes' });
    const modeOptions: [Mode, string][] = [
        ['choice', 'Multiple Choice'],
        ['typed', 'Typed Answer'],
    ];
    const modeButtons: HTMLButtonElement[] = [];
    let choiceRow: HTMLElement | null = null;
    for (const [value, label] of modeOptions) {
        const b = modes.createEl('button', { text: label, cls: 'rv-mode' });
        b.toggleClass('is-active', currentMode === value);
        b.addEventListener('click', () => {
            if (value === currentMode) return;
            currentMode = value;
            props.onModeChange(value);
            markCustom();
            modeButtons.forEach((x, i) => x.toggleClass('is-active', modeOptions[i]?.[0] === value));
            choiceRow?.toggleClass('rv-hidden', value !== 'choice');
            const autoBtn = submitButtons[0];
            if (autoBtn) autoBtn.disabled = value === 'typed';
            if (value === 'typed' && props.sessionConfig.submitMode === 'auto') {
                changeConfig({ submitMode: 'any' });
                submitButtons.forEach((x, i) => x.toggleClass('is-active', submitOptions[i]?.[0] === 'any'));
            }
        });
        modeButtons.push(b);
    }

    // No. of choices (multiple choice only).
    choiceRow = pairs.createDiv({ cls: 'rv-config-row rv-config-choice' });
    choiceRow.toggleClass('rv-hidden', currentMode !== 'choice');
    choiceRow.createEl('label', { cls: 'rv-config-label', text: 'No. of Choices' });
    const choiceModes = choiceRow.createDiv({ cls: 'rv-modes' });
    const choiceOptions = Array.from(
        { length: MAX_CHOICE_COUNT - MIN_CHOICE_COUNT + 1 },
        (_, index) => MIN_CHOICE_COUNT + index,
    );
    const activeChoice = clampChoiceCount(sessionConfig.choiceCount);
    const choiceButtons: HTMLButtonElement[] = [];
    for (const n of choiceOptions) {
        const b = choiceModes.createEl('button', { text: String(n), cls: 'rv-mode' });
        b.toggleClass('is-active', activeChoice === n);
        b.addEventListener('click', () => {
            changeConfig({ choiceCount: n });
            choiceButtons.forEach((x, i) =>
                x.toggleClass('is-active', choiceOptions[i] === n),
            );
        });
        choiceButtons.push(b);
    }

    // Presentation.
    const presRow = pairs.createDiv({ cls: 'rv-config-row rv-config-pres' });
    presRow.createEl('label', {
        cls: 'rv-config-label',
        text: 'Question Presentation Format',
    });
    const presModes = presRow.createDiv({ cls: 'rv-modes' });
    const presOptions: [string, string][] = [
        ['all', 'All at once'],
        ['one', 'One at a time'],
    ];
    const presButtons: HTMLButtonElement[] = [];
    for (const [value, label] of presOptions) {
        const b = presModes.createEl('button', { text: label, cls: 'rv-mode' });
        b.toggleClass('is-active', sessionConfig.presentation === value);
        b.addEventListener('click', () => {
            changeConfig({ presentation: value as 'all' | 'one' });
            presButtons.forEach((x, i) => x.toggleClass('is-active', presOptions[i]![0] === value));
            timerProps.presentedCount = presentedCount();
            timerSection?.refresh();
        });
        presButtons.push(b);
    }

    // Order.
    const orderRow = pairs.createDiv({ cls: 'rv-config-row rv-config-order' });
    orderRow.createEl('label', { cls: 'rv-config-label', text: 'Order of Questions' });
    const orderModes = orderRow.createDiv({ cls: 'rv-modes' });
    const orderOptions: [OrderMode, string][] = [
        ['source', 'Source'],
        ['random', 'Random'],
        ['priority', 'Priority'],
        ['priority-random', 'Priority shuffle'],
    ];
    const orderButtons: HTMLButtonElement[] = [];
    for (const [value, label] of orderOptions) {
        const b = orderModes.createEl('button', { text: label, cls: 'rv-mode' });
        b.toggleClass('is-active', sessionConfig.order === value);
        b.addEventListener('click', () => {
            changeConfig({ order: value });
            orderButtons.forEach((x, i) => x.toggleClass('is-active', orderOptions[i]![0] === value));
        });
        orderButtons.push(b);
    }

    // Number of questions.
    if (total > 0) {
        const countField = pairs.createDiv({ cls: 'rv-config-field rv-config-numq' });
        const displayVal = sessionConfig.count === 'all' ? total : Math.min(sessionConfig.count, total);
        const countRow = countField.createDiv({ cls: 'rv-config-row' });
        countRow.createEl('label', { cls: 'rv-config-label', text: 'No of Questions' });
        const countInner = countRow.createDiv({ cls: 'rv-config-count' });
        const sliderEl = countInner.createEl('input', {
            type: 'range',
            attr: { min: '1', max: String(total), value: String(displayVal) },
            cls: 'rv-config-slider',
        });
        const numberEl = countInner.createEl('input', {
            type: 'number',
            attr: { min: '1', max: String(total), value: String(displayVal) },
            cls: 'rv-config-number',
        });
        const hintEl = countRow.createDiv({ cls: 'rv-config-hint rv-muted' });
        hintEl.setText(sessionConfig.count === 'all' ? `All ${total} questions` : `${displayVal} of ${total} questions`);

        const setSliderFill = (value: number): void => {
            const pct = total > 1 ? ((value - 1) / (total - 1)) * 100 : 100;
            sliderEl.style.setProperty('--rv-slider-progress', `${pct}%`);
        };
        setSliderFill(displayVal);

        const trimRow = pairs.createDiv({ cls: 'rv-config-row rv-config-trim' });
        trimRow.toggleClass(
            'rv-hidden',
            sessionConfig.count === 'all' || displayVal >= total,
        );
        trimRow.createEl('label', { cls: 'rv-config-label', text: 'Trim method' });
        const trimModes = trimRow.createDiv({ cls: 'rv-modes' });
        const trimOptions: [string, string][] = [
            ['seq', 'Sequential'],
            ['rand', 'Random'],
        ];
        const trimButtons: HTMLButtonElement[] = [];
        for (const [value, label] of trimOptions) {
            const b = trimModes.createEl('button', { text: label, cls: 'rv-mode' });
            b.toggleClass('is-active', sessionConfig.trim === value);
            b.addEventListener('click', () => {
                changeConfig({ trim: value as 'seq' | 'rand' });
                trimButtons.forEach((x, i) => x.toggleClass('is-active', trimOptions[i]![0] === value));
            });
            trimButtons.push(b);
        }

        const updateCount = (rawValue: string): void => {
            let n = parseInt(rawValue, 10);
            if (!Number.isFinite(n) || n < 1) n = 1;
            if (n > total) n = total;
            const newCount: number | 'all' = n === total ? 'all' : n;
            sliderEl.value = String(n);
            numberEl.value = String(n);
            setSliderFill(n);
            hintEl.setText(newCount === 'all' ? `All ${total} questions` : `${n} of ${total} questions`);
            trimRow.toggleClass('rv-hidden', newCount === 'all' || n >= total);
            changeConfig({ count: newCount });
            timerProps.presentedCount = presentedCount();
            timerSection?.refresh();
        };
        sliderEl.addEventListener('input', () => updateCount(sliderEl.value));
        numberEl.addEventListener('input', () => updateCount(numberEl.value));
    } else {
        card.createDiv({
            cls: 'rv-config-hint rv-muted rv-span-2',
            text: 'No questions selected. Open Manage questions to include some.',
        });
    }

    // Submit.
    const submitRow = pairs.createDiv({ cls: 'rv-config-row rv-config-submit' });
    submitRow.createEl('label', { cls: 'rv-config-label', text: 'Submit' });
    const submitModes = submitRow.createDiv({ cls: 'rv-modes' });
    for (const [value, label] of submitOptions) {
        const b = submitModes.createEl('button', { text: label, cls: 'rv-mode' });
        b.toggleClass('is-active', sessionConfig.submitMode === value);
        b.disabled = value === 'auto' && props.mode === 'typed';
        b.addEventListener('click', () => {
            if (b.disabled) return;
            changeConfig({ submitMode: value });
            submitButtons.forEach((x, i) => x.toggleClass('is-active', submitOptions[i]?.[0] === value));
            timerSection?.refresh();
        });
        submitButtons.push(b);
    }

    // Grade.
    const gradeRow = pairs.createDiv({ cls: 'rv-config-row rv-config-grade' });
    gradeRow.createEl('label', { cls: 'rv-config-label', text: 'Grade' });
    const gradeModes = gradeRow.createDiv({ cls: 'rv-modes' });
    const gradeOptions: [GradeMode, string][] = [
        ['immediate', 'Immediate'],
        ['afterAll', 'After all'],
    ];
    const gradeButtons: HTMLButtonElement[] = [];
    for (const [value, label] of gradeOptions) {
        const b = gradeModes.createEl('button', { text: label, cls: 'rv-mode' });
        b.toggleClass('is-active', sessionConfig.gradeMode === value);
        b.addEventListener('click', () => {
            changeConfig({ gradeMode: value });
            gradeButtons.forEach((x, i) => x.toggleClass('is-active', gradeOptions[i]?.[0] === value));
        });
        gradeButtons.push(b);
    }

    // Pass score.
    const passRow = card.createDiv({ cls: 'rv-config-row rv-span-2' });
    passRow.createEl('label', { cls: 'rv-config-label', text: 'Pass score' });
    const passModes = passRow.createDiv({ cls: 'rv-modes' });
    const passInner = passRow.createDiv({ cls: 'rv-config-count' });
    const passSlider = passInner.createEl('input', {
        type: 'range',
        attr: { min: '0', max: '100', step: '1', value: '80' },
        cls: 'rv-config-slider',
    });
    const passNumber = passInner.createEl('input', {
        type: 'number',
        attr: { min: '0', max: '100', step: '1', value: '80' },
        cls: 'rv-config-number',
    });
    const passHint = passRow.createDiv({
        cls: 'rv-config-hint rv-muted',
        text: 'Pass threshold: correct answers ÷ total questions.',
    });

    const rawPass = sessionConfig.passScore === 'off' ? 80 : sessionConfig.passScore;
    const currentPass = Number.isFinite(rawPass) ? Math.max(0, Math.min(100, Math.round(rawPass))) : 80;
    const setPassFill = (value: number): void => {
        passSlider.style.setProperty('--rv-slider-progress', `${value}%`);
    };
    const setPassControlsVisible = (on: boolean): void => {
        passInner.toggleClass('rv-hidden', !on);
        passHint.toggleClass('rv-hidden', !on);
    };
    const applyPassScore = (value: number): void => {
        let n = Math.round(value);
        if (!Number.isFinite(n)) n = 80;
        n = Math.max(0, Math.min(100, n));
        passSlider.value = String(n);
        passNumber.value = String(n);
        setPassFill(n);
        changeConfig({ passScore: n });
    };

    passSlider.value = String(currentPass);
    passNumber.value = String(currentPass);
    setPassFill(currentPass);
    setPassControlsVisible(sessionConfig.passScore !== 'off');

    const passOff = passModes.createEl('button', { text: 'Off', cls: 'rv-mode' });
    const passOn = passModes.createEl('button', { text: 'On', cls: 'rv-mode' });
    passOff.toggleClass('is-active', sessionConfig.passScore === 'off');
    passOn.toggleClass('is-active', sessionConfig.passScore !== 'off');
    passOff.addEventListener('click', () => {
        changeConfig({ passScore: 'off' });
        passOff.addClass('is-active');
        passOn.removeClass('is-active');
        setPassControlsVisible(false);
    });
    passOn.addEventListener('click', () => {
        const next = props.sessionConfig.passScore === 'off' ? 80 : props.sessionConfig.passScore;
        changeConfig({ passScore: next });
        passOn.addClass('is-active');
        passOff.removeClass('is-active');
        setPassControlsVisible(true);
        applyPassScore(next);
    });
    passSlider.addEventListener('input', () => {
        const n = parseInt(passSlider.value, 10);
        if (Number.isFinite(n)) applyPassScore(n);
    });
    passNumber.addEventListener('input', () => {
        const n = parseInt(passNumber.value, 10);
        if (Number.isFinite(n)) applyPassScore(n);
    });

    // Timer + Stopwatch.
    timerSection = renderTimerConfigSection(timerProps);

    // Seed.
    const seedRow = card.createDiv({ cls: 'rv-config-row rv-span-2 rv-seed-row' });
    seedRow.createEl('label', { cls: 'rv-config-label', text: 'Seed' });
    const seedInner = seedRow.createDiv({ cls: 'rv-config-count' });
    const seedEl = seedInner.createEl('input', {
        type: 'number',
        attr: { min: '0', step: '1', value: String(sessionConfig.seed) },
        cls: 'rv-config-number',
    });
    seedRow.createDiv({
        cls: 'rv-config-hint rv-muted',
        text: 'Affects picked values, expression picks, distractors, and ordering. 0 = auto-generate on start.',
    });
    seedEl.addEventListener('input', () => {
        const n = parseInt(seedEl.value, 10);
        changeConfig({ seed: Number.isFinite(n) && n >= 0 ? n : 0 });
    });
}

/**
 * Re-renders only the Session Configuration area (preset row + settings card).
 * Used when a preset changes: avoids rebuilding the session list, alerts, etc.
 */
export function refreshSessionConfigArea(
    root: HTMLElement,
    props: StartScreenProps,
): void {
    const old = root.querySelector<HTMLElement>('.rv-session-config');
    if (!old) return;

    const bodyRoot = old.parentElement as HTMLElement;
    // Save the current scroll position before destroying the DOM
    const previousScrollTop = bodyRoot.scrollTop;

    bodyRoot.querySelector<HTMLElement>('.rv-session-presets')?.remove();
    old.remove();

    const bodyProps: StartScreenProps = { ...props, root: bodyRoot };
    const markCustom = renderSessionPresetRow(bodyProps);
    renderSessionSettings(
        bodyProps,
        (patch) => {
            props.onSessionConfigChange(patch);
            markCustom();
        },
        markCustom,
    );

    // Restore the scroll position immediately after rendering
    bodyRoot.scrollTop = previousScrollTop;
}