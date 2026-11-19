/** Session screen: sticky header with display toggle, cards, one-at-a-time nav in header, completion trigger. */
import { Notice, type App, type Component, type TFile } from 'obsidian';
import type { GradeMode, SubmitMode, SessionConfig } from '../../constants';
import {
    perQuestionTimersAllowed,
    formatTimerMs,
    formatStopwatchMs,
    type Mode,
    type SessionQuestion,
    type TimerRuntimeState,
} from '../../session';
import { EditorMount } from '../MarkdownEditor';
import { renderQuestionCard, type QuestionCardHandle } from '../QuestionCard';
import { ChoiceLayoutController } from '../ChoiceLayout';
import { AdaptiveTaskQueue } from '../../util/adaptiveQueue';
import type {
    GenerationState,
    PlannedDisplayEntry,
} from '../../vault/sessionHub';

export type DisplayMode = 'all' | 'one';

export interface QuizScreenProps {
    app: App;
    component: Component;
    root: HTMLElement;
    items: SessionQuestion[];
    /** Every planned display slot, including questions not built yet. */
    planned: PlannedDisplayEntry[];
    /** Expected number of playable questions (planned minus failures). */
    expectedTotal: number;
    generation: GenerationState;
    mode: Mode;
    displayMode: DisplayMode;
    currentIndex: number;
    savedFile: TFile | null;
    seedInput?: number;
    submitMode: SubmitMode;
    gradeMode: GradeMode;
    passScore: number | 'off';
    timerConfig: SessionConfig;
    timerState: TimerRuntimeState;
    allowFlag: boolean;
    navigator: boolean;
    navigatorShown: boolean;
    onNavigatorToggle: (shown: boolean) => void;
    initialFlags: number[];
    onFlagsChange: (flags: number[]) => void;
    onJump: (index: number) => void;
    onFlush: () => void;
    onRename: () => void;
    onBack: () => void;
    onPrev: () => void;
    onNext: () => void;
    saveSession: (items: SessionQuestion[], mode: Mode) => Promise<TFile>;
    onShowDetails: () => void;
    onNewSession: () => void;
    /** Live session: a choice was picked or deselected (before submission). */
    onPick?: (id: number, picked: number | undefined) => void;
    /** Live session: the typed final answer changed. */
    onDraft?: (id: number, value: string) => void;
    /** Live session: the scratch note changed. */
    onScratch?: (id: number, value: string) => void;
    /** Live session: this question was submitted and graded. */
    onSubmit?: (id: number) => void;
    /** Live session: Submit all mode; submit every prepared answered item. */
    onSubmitAll?: () => void;
    /** Render inside a note rather than a full tab. */
    embedded?: boolean;
    /** Completion action label; embedded sessions open the saved note. */
    showDetailsLabel?: string;
}

export interface QuizScreenHandle {
    destroy(): void;
    /** Apply a change made in another tab sharing this session. */
    applySharedChange(
        kind: 'pick' | 'draft' | 'scratch' | 'submit',
        id: number | undefined,
    ): void;
    /** Apply a flag-set change made in another tab. */
    applyFlags(flags: number[]): void;
    /** Refresh timer/stopwatch readouts from the shared clock. */
    applyTimer(): void;
    /** A question finished generating. */
    addItem(item: SessionQuestion, displayIndex: number): void;
    /** Generation progress/completion from the shared session. */
    setGenerationState(state: GenerationState): void;
    /** A planned question could not be generated. */
    markGenerationError(displayIndex: number, message: string): void;
    /** Pause/resume card DOM work while this tab is not visible. */
    setRenderingPaused(paused: boolean): void;
    /** Many answered items changed at once (Submit all / timer expiry). */
    applyBulk(): void;
}

/** Completion panel: save the session note, then offer details / raw note / new. */
interface CompletionPanelProps {
    parent: HTMLElement;
    items: SessionQuestion[];
    mode: Mode;
    passScore: number | 'off';
    saveSession: (items: SessionQuestion[], mode: Mode) => Promise<TFile>;
    existingFile: TFile | null;
    onShowDetails: () => void;
    onNewSession: () => void;
    showDetailsLabel?: string;
}

async function renderCompletionPanel(props: CompletionPanelProps): Promise<void> {
    const done = props.parent;
    done.empty();
    done.removeClass('rv-hidden');
    const score = props.items.filter((i) => i.isCorrect).length;
    const total = props.items.length;
    const pct = total > 0 ? (score / total) * 100 : 0;
    done.createEl('h3', { text: `Session complete: ${score} / ${total}` });

    if (props.passScore !== 'off') {
        const passed = pct >= props.passScore;
        const verdict = done.createDiv({
            cls: `rv-pass-summary ${passed ? 'is-pass' : 'is-fail'}`,
        });
        verdict.createSpan({ cls: 'rv-pass-verdict', text: passed ? 'Passed' : 'Failed' });
        verdict.createSpan({
            cls: 'rv-pass-detail',
            text: `Score ${score}/${total} (${Math.round(pct)}%) · Pass ${props.passScore}%`,
        });
    }

    try {
        const file = props.existingFile ?? await props.saveSession(props.items, props.mode);
        if (!done.isConnected) return;
        done.createEl('p', { cls: 'rv-muted', text: `Saved to ${file.path}` });
        const actions = done.createDiv({ cls: 'rv-actions' });

        const view = actions.createEl('button', {
            text: props.showDetailsLabel ?? 'Show session details',
        });
        view.addEventListener('click', () => props.onShowDetails());

        const again = actions.createEl('button', { text: 'New session', cls: 'mod-cta' });
        again.addEventListener('click', () => props.onNewSession());
    } catch (e) {
        if (!done.isConnected) return;
        new Notice(`Could not save the session note: ${(e as Error).message}`);
        const retry = done.createEl('button', { text: 'Retry saving', cls: 'mod-cta' });
        retry.addEventListener('click', () => void renderCompletionPanel(props));
    }
}

/** A card counts as "ready" once a choice is picked or a typed draft exists. */
function hasAnswer(sq: SessionQuestion): boolean {
    return (
        sq.submitted === true ||
        sq.isCorrect !== undefined ||
        sq.pickedIndex !== undefined ||
        (sq.finalDraft ?? '').trim() !== ''
    );
}

export function renderQuizScreen(props: QuizScreenProps): QuizScreenHandle {
    props.root.empty();
    props.root.toggleClass('rv-embedded', props.embedded === true);
    props.root.removeClass('rv-start-mode');
    const editors: EditorMount[] = [];
    const handlesById = new Map<number, QuestionCardHandle>();
    const registerEditor = (m: EditorMount): void => { editors.push(m); };
    const choiceLayout = new ChoiceLayoutController();

    const planned = props.planned;
    const displayByFrozenId = new Map<number, number>();
    for (const entry of planned) displayByFrozenId.set(entry.id, entry.displayIndex);
    const builtByIndex = new Map<number, SessionQuestion>();
    for (const item of props.items) {
        const displayIndex = displayByFrozenId.get(item.id);
        if (displayIndex !== undefined) builtByIndex.set(displayIndex, item);
    }

    let expectedTotal = props.expectedTotal;
    let generationState: GenerationState = { ...props.generation };

    let completed = false;
    let doneEl: HTMLElement | null = null;
    let cardHost: HTMLElement | null = null;
    let submitAllBtn: HTMLButtonElement | null = null;
    let navigatorEl: HTMLElement | null = null;
    let renderingPaused = false;
    const flagged = new Set<number>(props.initialFlags);
    const slotEls: HTMLElement[] = [];
    const renderedSlots = new Set<number>();
    let currentRenderedId: number | null = null;

    const renderQueue = new AdaptiveTaskQueue<number>({
        targetMs: 8,
        maxBatch: 16,
    });
    renderQueue.start();

    const itemAt = (displayIndex: number): SessionQuestion | undefined =>
        builtByIndex.get(displayIndex);

    const syncBuiltFromItems = (): void => {
        for (const item of props.items) {
            const displayIndex = displayByFrozenId.get(item.id);
            if (displayIndex !== undefined) builtByIndex.set(displayIndex, item);
        }
    };

    function setFlagged(id: number, next: boolean): void {
        if (!props.allowFlag) return;
        if (next) flagged.add(id);
        else flagged.delete(id);
        props.onFlagsChange([...flagged].sort((a, b) => a - b));
        updateStatus();
    }

    function toggleFlag(id: number): void {
        setFlagged(id, !flagged.has(id));
    }

    function navState(sq: SessionQuestion | undefined): string {
        if (!sq) return generationState.complete ? 'skipped' : 'loading';
        if (sq.isCorrect === true) return 'correct';
        if (sq.isCorrect === false) return 'wrong';
        if (sq.submitted === true) return 'submitted';
        if (
            sq.pickedIndex !== undefined ||
            (sq.finalDraft ?? '').trim() !== ''
        ) {
            return 'in-progress';
        }
        return 'unanswered';
    }

    const navCells: HTMLButtonElement[] = [];
    const navStates: string[] = [];
    const navFlags: boolean[] = [];

    function updateNavigatorCell(index: number): void {
        const cell = navCells[index];
        const entry = planned[index];
        if (!cell || !entry) return;
        const state = navState(itemAt(index));
        const isFlagged = flagged.has(entry.id);
        if (navStates[index] !== state) {
            cell.className = `rv-nav-cell rv-nav-${state}`;
            navStates[index] = state;
        }
        if (navFlags[index] !== isFlagged) {
            const flagEl = cell.querySelector<HTMLElement>('.rv-nav-flag');
            flagEl?.toggleClass('rv-hidden', !isFlagged);
            navFlags[index] = isFlagged;
        }
        cell.toggleClass('is-current', index === props.currentIndex);
        cell.setAttr(
            'title',
            `Question ${index + 1}: ${state}${isFlagged ? ', flagged' : ''}`,
        );
    }

    function updateNavigator(): void {
        if (!navigatorEl) return;
        for (let index = 0; index < planned.length; index++) {
            updateNavigatorCell(index);
        }
    }

    function buildNavigator(): void {
        if (!navigatorEl) return;
        navigatorEl.empty();
        navCells.length = 0;
        navStates.length = 0;
        navFlags.length = 0;
        navigatorEl.createEl('h4', { cls: 'rv-nav-title', text: 'Navigator' });
        const grid = navigatorEl.createDiv({ cls: 'rv-nav-grid' });
        planned.forEach((_entry, index) => {
            const cell = grid.createEl('button', {
                cls: 'rv-nav-cell rv-nav-loading',
                attr: {
                    type: 'button',
                    'aria-label': `Go to question ${index + 1}`,
                },
            });
            cell.createSpan({ cls: 'rv-nav-number', text: String(index + 1) });
            cell.createSpan({ cls: 'rv-nav-flag rv-hidden', text: '!' });
            cell.addEventListener('click', () => {
                props.onJump(index);
            });
            navCells.push(cell);
            navStates.push('');
            navFlags.push(false);
            updateNavigatorCell(index);
        });
        const legend = navigatorEl.createDiv({ cls: 'rv-nav-legend' });
        for (const [cls, label] of [
            ['unanswered', 'unanswered'],
            ['loading', 'preparing'],
            ['submitted', 'submitted'],
            ['correct', 'correct'],
            ['wrong', 'wrong'],
            ['skipped', 'skipped'],
            ['flagged', 'flagged'],
        ] as const) {
            const item = legend.createSpan({ cls: `rv-nav-legend-item rv-legend-${cls}` });
            item.createSpan({ cls: 'rv-nav-legend-dot' });
            item.createSpan({ text: label });
        }
    }

    // ---------- header ----------
    const head = props.root.createDiv({ cls: 'rv-head' });
    const headRow = head.createDiv({ cls: 'rv-head-row' });

    const back = headRow.createEl('button', { cls: 'rv-back' });
    back.createSpan({ text: '←' });
    back.createSpan({ text: ' Back' });
    back.addEventListener('click', () => {
        props.onFlush();
        props.onBack();
    });

    const headActions = headRow.createDiv({ cls: 'rv-head-actions' });
    if (props.submitMode === 'all') {
        submitAllBtn = headActions.createEl('button', {
            cls: 'mod-cta rv-submit-all',
            text: 'Submit answers',
        });
        submitAllBtn.addEventListener('click', () => submitAll());
    }
    const rename = headActions.createEl('button', { cls: 'rv-back', text: 'Rename session' });
    rename.addEventListener('click', () => props.onRename());

    const timerRow = head.createDiv({ cls: 'rv-session-timers' });
    if (
        props.timerConfig.timerSessionMode === 'off' &&
        !props.timerConfig.stopwatchSession
    ) {
        timerRow.addClass('rv-hidden');
    }
    const sessionTimerEl = timerRow.createSpan({ cls: 'rv-session-timer' });
    const sessionStopwatchEl = timerRow.createSpan({ cls: 'rv-session-stopwatch' });

    const statusEl = head.createDiv({ cls: 'rv-status' });
    const barEl = head.createDiv({ cls: 'rv-bar' }).createDiv({ cls: 'rv-bar-fill' });

    const seedText = props.seedInput !== undefined ? ` · Seed ${props.seedInput}` : '';

    const updateStatus = (): void => {
        const total = expectedTotal;
        let submitted = 0;
        let ready = 0;
        let score = 0;
        let allReady = true;
        for (const item of props.items) {
            if (item.submitted === true) submitted++;
            if (hasAnswer(item)) ready++;
            else allReady = false;
            if (item.isCorrect === true) score++;
        }
        if (!generationState.complete) allReady = false;
        const waitingForGlobalSubmit = props.submitMode === 'all' && submitted < total;

        let text: string;
        if (!generationState.complete) {
            text = `Preparing ${generationState.built}/${expectedTotal}`;
            if (submitted > 0) text += ` · Submitted ${submitted}`;
        } else {
            text = waitingForGlobalSubmit
                ? `Ready ${ready}/${total}`
                : `Submitted ${submitted}/${total}`;
        }

        let pct: number | null = null;
        if (
            generationState.complete &&
            props.passScore !== 'off'
        ) {
            if (props.gradeMode === 'immediate' && submitted > 0) {
                pct = (score / submitted) * 100;
            } else if (props.gradeMode === 'afterAll' && submitted === total && total > 0) {
                pct = (score / total) * 100;
            }
            if (pct !== null) text += ` · Score ${Math.round(pct)}%`;
        }
        text += seedText;
        if (props.allowFlag) text += ` · Flags ${flagged.size}`;
        statusEl.setText(text);

        statusEl.removeClass('rv-score-pass');
        statusEl.removeClass('rv-score-fail');
        if (pct !== null && props.passScore !== 'off') {
            statusEl.addClass(pct >= props.passScore ? 'rv-score-pass' : 'rv-score-fail');
        }

        const progress = generationState.complete
            ? waitingForGlobalSubmit
                ? ready
                : submitted
            : generationState.built;
        barEl.setCssProps({ '--rv-progress': `${total > 0 ? (progress / total) * 100 : 0}%` });

        if (submitAllBtn) {
            const allSubmitted = submitted === total && total > 0;
            submitAllBtn.disabled =
                expectedTotal === 0 ||
                !generationState.complete ||
                !allReady ||
                allSubmitted;
            submitAllBtn.setText(
                !generationState.complete
                    ? 'Preparing questions…'
                    : allSubmitted
                      ? 'Submitted'
                      : 'Submit answers',
            );
            submitAllBtn.toggleClass('rv-hidden', allSubmitted);
        }
        updateNavigator();
    };

    // ---------- completion ----------
    function triggerCompletion(): void {
        if (completed || !doneEl) return;
        if (!generationState.complete) return;
        if (props.items.length === 0) return;
        if (!props.items.every((i) => i.submitted === true)) return;
        completed = true;
        renderQueue.stop();
        void renderCompletionPanel({
            parent: doneEl,
            items: props.items,
            mode: props.mode,
            passScore: props.passScore,
            saveSession: props.saveSession,
            existingFile: props.savedFile,
            onShowDetails: props.onShowDetails,
            onNewSession: props.onNewSession,
            showDetailsLabel: props.showDetailsLabel,
        });
    }

    function revealAll(): void {
        if (props.gradeMode !== 'afterAll') return;
        for (const h of handlesById.values()) h.reveal();
    }

    function afterAnswer(): void {
        updateStatus();
        updateTimerUi();
        if (
            generationState.complete &&
            props.items.length > 0 &&
            props.items.every((i) => i.submitted === true)
        ) {
            revealAll();
            triggerCompletion();
        } else {
            props.onFlush();
        }
    }

    function submitAll(): void {
        if (!generationState.complete) return;
        if (!props.items.every(hasAnswer)) return;
        if (props.onSubmitAll) {
            props.onSubmitAll();
            return;
        }
        for (const h of handlesById.values()) h.submit();
        updateStatus();
        updateTimerUi();
        if (
            props.items.length > 0 &&
            props.items.every((i) => i.submitted === true)
        ) {
            revealAll();
            triggerCompletion();
        }
    }

    // ---------- timer / stopwatch readouts ----------
    // The clock itself lives in the shared session (SessionHub), so every tab
    // on the same session sees one timer and one stopwatch.
    const timerConfig = props.timerConfig;
    const timerState = props.timerState;
    const sessionTimerOn = timerConfig.timerSessionMode !== 'off';
    const sessionStopwatchOn = timerConfig.stopwatchSession;
    const questionTimersAllowed = perQuestionTimersAllowed(
        props.displayMode,
        props.submitMode,
    );
    const questionTimerOn =
        questionTimersAllowed && timerConfig.timerQuestionMode !== 'off';
    const questionStopwatchOn =
        questionTimersAllowed && timerConfig.stopwatchQuestion;

    const activeItem = (): SessionQuestion | null =>
        props.displayMode === 'one' ? itemAt(props.currentIndex) ?? null : null;

    function updateTimerUi(): void {
        if (sessionTimerOn) {
            sessionTimerEl.removeClass('rv-hidden');
            sessionTimerEl.setText(`Timer ${formatTimerMs(timerState.sessionRemainingMs)}`);
            sessionTimerEl.toggleClass(
                'is-warning',
                (timerConfig.timerSessionWarningSeconds > 0 &&
                    timerState.sessionRemainingMs <=
                        timerConfig.timerSessionWarningSeconds * 1000) ||
                    timerState.sessionRemainingMs < 0,
            );
        } else {
            sessionTimerEl.addClass('rv-hidden');
        }

        if (sessionStopwatchOn) {
            sessionStopwatchEl.removeClass('rv-hidden');
            sessionStopwatchEl.setText(
                `Stopwatch ${formatStopwatchMs(timerState.sessionElapsedMs)}`,
            );
        } else {
            sessionStopwatchEl.addClass('rv-hidden');
        }

        if (props.displayMode !== 'one') {
            return;
        }
        if (!questionTimerOn && !questionStopwatchOn) {
            return;
        }

        const active = activeItem();
        const handle = active ? handlesById.get(active.id) : undefined;
        if (!active || !handle) return;

        const key = String(active.id);
        const timerInfo = questionTimerOn
            ? (() => {
                  const ms =
                      timerState.questionRemainingMs[key] ??
                      timerConfig.timerQuestionSeconds * 1000;
                  const warning =
                      (timerConfig.timerQuestionWarningSeconds > 0 &&
                          ms <= timerConfig.timerQuestionWarningSeconds * 1000) ||
                      ms < 0;
                  return { text: formatTimerMs(ms), warning };
              })()
            : null;
        const stopwatchText = questionStopwatchOn
            ? formatStopwatchMs(timerState.questionElapsedMs[key] ?? 0)
            : null;
        handle.setTimer(timerInfo, stopwatchText);
    }

    // ---------- sticky nav row (one-at-a-time only) ----------
    if (props.displayMode === 'one') {
        const idx = Math.max(0, Math.min(props.currentIndex, planned.length - 1));
        const nav = head.createDiv({ cls: 'rv-nav-row' });
        
        const leftGroup = nav.createDiv({ cls: 'rv-nav-group-left' });
        const rightGroup = nav.createDiv({ cls: 'rv-nav-group-right' });

        if (props.navigator) {
            const toggle = leftGroup.createEl('button', {
                text: 'Navigator',
                cls: 'rv-nav-toggle',
                attr: {
                    type: 'button',
                    'aria-pressed': String(props.navigatorShown),
                },
            });
            toggle.toggleClass('is-active', props.navigatorShown);
            toggle.addEventListener('click', () => {
                const next = !props.navigatorShown;
                toggle.toggleClass('is-active', next);
                toggle.setAttr('aria-pressed', String(next));
                navigatorEl?.toggleClass('rv-hidden', !next);
                layout.toggleClass('has-navigator', next);
                props.onNavigatorToggle(next);
            });
        }

        const prev = leftGroup.createEl('button', { text: '← Previous', cls: 'rv-nav' });
        prev.disabled = idx === 0;
        prev.addEventListener('click', () => {
            props.onFlush();
            props.onPrev();
        });
        
        const next = rightGroup.createEl('button', { text: 'Next →', cls: 'rv-nav' });
        next.disabled = idx === planned.length - 1;
        next.addEventListener('click', () => {
            props.onFlush();
            props.onNext();
        });
    }

    // ---------- body ----------
    const layout = props.root.createDiv({ cls: 'rv-quiz-layout' });
    if (props.navigator && props.displayMode === 'one') {
        navigatorEl = layout.createEl('aside', {
            cls: `rv-navigator${props.navigatorShown ? '' : ' rv-hidden'}`,
        });
        layout.toggleClass('has-navigator', props.navigatorShown);
    }
    const body = layout.createDiv({ cls: 'rv-body rv-quiz-body' });
    if (planned.length > 100) body.addClass('rv-streaming-cards');
    buildNavigator();
    const cardsHost = body.createDiv({ cls: 'rv-cards' });
    cardHost = cardsHost;
    doneEl = body.createDiv({ cls: 'rv-done rv-hidden' });

    const isAllDone = (): boolean =>
        generationState.complete &&
        props.items.length > 0 &&
        props.items.every((item) => item.submitted === true);

    const cardProps = {
        app: props.app,
        component: props.component,
        mode: props.mode,
        choiceLayout,
        onAnswer: afterAnswer,
        onFlush: props.onFlush,
        registerEditor,
        submitMode: props.submitMode,
        gradeMode: props.gradeMode,
        onStateChange: updateStatus,
        allowFlag: props.allowFlag,
        onPick: props.onPick,
        onDraft: props.onDraft,
        onScratch: props.onScratch,
        onSubmit: props.onSubmit,
    };
    const handleForId = (id: number): QuestionCardHandle | null =>
        handlesById.get(id) ?? null;

    function renderSlotPlaceholder(index: number): void {
        const entry = planned[index];
        const slot = slotEls[index];
        if (!entry || !slot) return;
        slot.empty();
        const shell = slot.createDiv({ cls: 'rv-card rv-card-placeholder' });
        const top = shell.createDiv({ cls: 'rv-card-top' });
        top.createSpan({ cls: 'rv-num', text: String(index + 1) });
        top.createSpan({ cls: 'rv-src', text: entry.title });
        shell.createEl('p', {
            cls: 'rv-muted',
            text: generationState.complete
                ? 'Question unavailable.'
                : 'Preparing question…',
        });
    }

    function renderErrorSlot(index: number, detail: string): void {
        const entry = planned[index];
        const slot = slotEls[index];
        if (!entry || !slot) return;
        slot.empty();
        renderedSlots.add(index);
        const shell = slot.createDiv({ cls: 'rv-card rv-card-missing' });
        const top = shell.createDiv({ cls: 'rv-card-top' });
        top.createSpan({ cls: 'rv-num', text: String(index + 1) });
        top.createSpan({ cls: 'rv-src', text: entry.title });
        shell.createEl('p', {
            cls: 'rv-muted',
            text: 'This question could not be prepared.',
        });
        if (detail) shell.createEl('p', { cls: 'rv-missing-path', text: detail });
    }

    function renderCardIntoSlot(index: number): void {
        const sq = itemAt(index);
        const slot = slotEls[index];
        if (!sq || !slot || renderedSlots.has(index)) return;
        slot.empty();
        const handle = renderQuestionCard({
            ...cardProps,
            parent: slot,
            sq,
            index,
            flagged: flagged.has(sq.id),
            onToggleFlag: () => toggleFlag(sq.id),
            revealSubmitted: isAllDone(),
        });
        handlesById.set(sq.id, handle);
        renderedSlots.add(index);
    }

    function renderCurrentCard(): void {
        if (!cardHost) return;
        const index = Math.max(0, Math.min(props.currentIndex, planned.length - 1));
        const sq = itemAt(index);
        if (sq && currentRenderedId === sq.id) return;
        currentRenderedId = sq?.id ?? null;
        cardHost.empty();
        handlesById.clear();
        if (sq) {
            const handle = renderQuestionCard({
                ...cardProps,
                parent: cardHost,
                sq,
                index,
                flagged: flagged.has(sq.id),
                onToggleFlag: () => toggleFlag(sq.id),
                revealSubmitted: isAllDone(),
            });
            handlesById.set(sq.id, handle);
        } else {
            const shell = cardHost.createDiv({
                cls: `rv-card ${generationState.complete ? 'rv-card-missing' : 'rv-card-placeholder'}`,
            });
            const top = shell.createDiv({ cls: 'rv-card-top' });
            top.createSpan({ cls: 'rv-num', text: String(index + 1) });
            top.createSpan({
                cls: 'rv-src',
                text: planned[index]?.title ?? '',
            });
            shell.createEl('p', {
                cls: 'rv-muted',
                text: generationState.complete
                    ? 'Question unavailable.'
                    : 'Preparing question…',
            });
        }
        updateTimerUi();
    }

    if (props.displayMode === 'all') {
        for (let index = 0; index < planned.length; index++) {
            const slot = cardsHost.createDiv({ cls: 'rv-stream-slot' });
            slotEls.push(slot);
            renderSlotPlaceholder(index);
        }
        let firstBuilt = -1;
        for (let index = 0; index < planned.length; index++) {
            if (!itemAt(index)) continue;
            if (firstBuilt < 0) {
                firstBuilt = index;
                renderCardIntoSlot(index);
            } else {
                renderQueue.enqueue(index, () => renderCardIntoSlot(index));
            }
        }
    } else {
        renderCurrentCard();
    }

    updateStatus();
    updateTimerUi();
    triggerCompletion();

    return {
        destroy: () => {
            renderQueue.stop();
            renderQueue.clear();
            choiceLayout.destroy();
            for (const e of editors) e.destroy();
        },
        applySharedChange: (kind, id) => {
            if (id === undefined) return;
            const item = props.items.find((sq) => sq.id === id);
            if (!item) return;
            const handle = handleForId(id);
            if (kind === 'pick') {
                handle?.setPicked(item.pickedIndex);
                updateStatus();
                return;
            }
            if (kind === 'draft') {
                if (item.submitted === true) return;
                handle?.setDraft(item.finalDraft ?? '');
                updateStatus();
                return;
            }
            if (kind === 'scratch') {
                handle?.setScratch(item.scratch ?? '');
                return;
            }
            handle?.applySubmitted();
            updateStatus();
            updateTimerUi();
            if (isAllDone()) {
                revealAll();
                triggerCompletion();
            }
        },
        applyFlags: (flags) => {
            flagged.clear();
            for (const id of flags) {
                if (Number.isFinite(id)) flagged.add(id);
            }
            for (let index = 0; index < planned.length; index++) {
                updateNavigatorCell(index);
            }
            for (const entry of planned) {
                handlesById.get(entry.id)?.setFlagged(flagged.has(entry.id));
            }
            updateStatus();
        },
        applyTimer: () => updateTimerUi(),
        addItem: (item, displayIndex) => {
            builtByIndex.set(displayIndex, item);
            if (props.displayMode === 'one') {
                if (displayIndex === props.currentIndex && !renderingPaused) {
                    renderCurrentCard();
                }
                updateNavigatorCell(displayIndex);
                return;
            }
            updateNavigatorCell(displayIndex);
            if (
                !renderingPaused &&
                !renderedSlots.has(displayIndex) &&
                itemAt(displayIndex)
            ) {
                if (renderedSlots.size === 0) renderCardIntoSlot(displayIndex);
                else renderQueue.enqueue(displayIndex, () => renderCardIntoSlot(displayIndex));
            }
        },
        setGenerationState: (state) => {
            generationState = { ...state };
            expectedTotal = Math.max(0, state.total - state.failed);
            syncBuiltFromItems();
            if (state.complete) {
                if (props.displayMode === 'all') {
                    for (let index = 0; index < planned.length; index++) {
                        if (!itemAt(index)) {
                            if (!renderedSlots.has(index)) renderErrorSlot(index, '');
                        } else if (
                            !renderedSlots.has(index) &&
                            !renderingPaused
                        ) {
                            renderQueue.enqueue(index, () => renderCardIntoSlot(index));
                        }
                    }
                } else if (!itemAt(props.currentIndex) && !renderingPaused) {
                    renderCurrentCard();
                }
                if (isAllDone()) revealAll();
                triggerCompletion();
            }
            updateStatus();
            updateTimerUi();
        },
        markGenerationError: (displayIndex, message) => {
            if (props.displayMode === 'all') {
                renderErrorSlot(displayIndex, message);
            } else if (
                displayIndex === props.currentIndex &&
                !renderingPaused
            ) {
                renderCurrentCard();
            }
            updateStatus();
        },
        setRenderingPaused: (paused) => {
            if (renderingPaused === paused) return;
            renderingPaused = paused;
            if (paused) {
                renderQueue.stop();
                return;
            }
            renderQueue.start();
            if (props.displayMode === 'one') {
                renderCurrentCard();
                return;
            }
            for (let index = 0; index < planned.length; index++) {
                if (!itemAt(index) || renderedSlots.has(index)) continue;
                if (renderedSlots.size === 0) renderCardIntoSlot(index);
                else renderQueue.enqueue(index, () => renderCardIntoSlot(index));
            }
        },
        applyBulk: () => {
            for (const handle of handlesById.values()) handle.applySubmitted();
            updateStatus();
            updateTimerUi();
            if (isAllDone()) {
                revealAll();
                triggerCompletion();
            }
        },
    };
}
