/**
 * One shared quiz session per session file. Every view attached to the same
 * file reads and mutates the same runtime, so the session has a single write
 * chain, a single timer, and one current question index. Views on different
 * session files never interfere with each other.
 */
import { normalizePath, type TFile } from 'obsidian';
import { grade } from '../session/grading/grade';
import { perQuestionTimersAllowed } from '../session/timer';
import type { Mode, SessionQuestion } from '../session/types';
import { AdaptiveTaskQueue } from '../util/adaptiveQueue';
import type { SessionRuntime } from './sessionRuntime';

export type SharedChangeKind = 'pick' | 'draft' | 'scratch' | 'submit' | 'bulk';

/** Planned question metadata available before the question is built. */
export interface PlannedDisplayEntry {
    /** Stable frozen-pool index. */
    id: number;
    title: string;
    /** Position in the session's display order. */
    displayIndex: number;
}

/** A planned question plus its one-shot builder. */
export interface GenerationEntry extends PlannedDisplayEntry {
    build: () => SessionQuestion;
}

export interface GenerationState {
    built: number;
    total: number;
    failed: number;
    complete: boolean;
}

export type SharedSessionEvent =
    | { type: 'change'; kind: SharedChangeKind; id?: number; origin: string }
    | { type: 'flags'; flags: number[]; origin: string }
    | { type: 'index'; index: number; origin: string }
    | { type: 'timer'; origin: string }
    | {
          type: 'item';
          item: SessionQuestion;
          displayIndex: number;
          origin: string;
      }
    | {
          type: 'generation';
          built: number;
          total: number;
          failed: number;
          complete: boolean;
          origin: string;
      }
    | {
          type: 'generation-error';
          displayIndex: number;
          message: string;
          origin: string;
      }
    /** Another tab archived this session; every attached view must stand down. */
    | { type: 'archived'; origin: string; name: string };

type Listener = (event: SharedSessionEvent) => void;
type TextChangeEvent = Extract<SharedSessionEvent, { type: 'change' }>;

const TEXT_BROADCAST_DELAY = 80;

function hasAnswer(sq: SessionQuestion): boolean {
    return (
        sq.submitted === true ||
        sq.isCorrect !== undefined ||
        sq.pickedIndex !== undefined ||
        (sq.finalDraft ?? '').trim() !== ''
    );
}

function answerKey(sq: SessionQuestion): string {
    return String(sq.id);
}

export class SharedSession {
    readonly path: string;
    readonly runtime: SessionRuntime;
    currentIndex = 0;

    private subscribers = new Map<string, Listener>();
    private timerInterval: number | null = null;
    private timerCompleted: boolean;
    private lastTick = 0;
    private pendingText = new Map<string, SharedSessionEvent>();
    private textTimer: number | null = null;

    private planned: PlannedDisplayEntry[] = [];
    private builtByDisplay = new Map<number, SessionQuestion>();
    private generationQueue: AdaptiveTaskQueue<number> | null = null;
    private generationTotal = 0;
    private generationBuilt = 0;
    private generationFailed = 0;
    private generationComplete = true;
    private generationErrors: string[] = [];

    constructor(
        path: string,
        runtime: SessionRuntime,
        private onEmpty: (shared: SharedSession) => void,
    ) {
        this.path = path;
        this.runtime = runtime;
        this.timerCompleted =
            runtime.items.length > 0 &&
            runtime.items.every((sq) => sq.submitted === true);
        this.generationBuilt = runtime.items.length;
        this.generationTotal = runtime.items.length;
        for (let index = 0; index < runtime.items.length; index++) {
            const item = runtime.items[index]!;
            this.builtByDisplay.set(index, item);
            this.planned.push({
                id: item.id,
                title: item.q.title,
                displayIndex: index,
            });
        }
    }

    get items(): SessionQuestion[] {
        return this.runtime.items;
    }

    /** All planned questions, including ones still being prepared. */
    get plannedEntries(): readonly PlannedDisplayEntry[] {
        return this.planned;
    }

    get generationState(): GenerationState {
        return {
            built: this.generationBuilt,
            total: this.generationTotal,
            failed: this.generationFailed,
            complete: this.generationComplete,
        };
    }

    get generationIsComplete(): boolean {
        return this.generationComplete;
    }

    get generationErrorMessages(): readonly string[] {
        return this.generationErrors;
    }

    /** Find a built item by its display position. */
    itemAt(displayIndex: number): SessionQuestion | undefined {
        return this.builtByDisplay.get(displayIndex);
    }

    get timer() {
        return this.runtime.timer;
    }

    get config() {
        return this.runtime.config;
    }

    get mode(): Mode {
        return this.runtime.mode;
    }

    get log() {
        return this.runtime.log;
    }

    get saved(): boolean {
        return this.runtime.saved;
    }

    get savedFile(): TFile | null {
        return this.runtime.savedFile;
    }

    subscribe(viewID: string, listener: Listener): () => void {
        this.subscribers.set(viewID, listener);
        return () => {
            this.subscribers.delete(viewID);
        };
    }

    /** True when some view other than `except` is attached to this session. */
    hasOtherViewers(except: string): boolean {
        for (const viewID of this.subscribers.keys()) {
            if (viewID !== except) return true;
        }
        return false;
    }

    /** True when any view is currently attached. */
    hasViewers(): boolean {
        return this.subscribers.size > 0;
    }

    /**
     * Tell every attached view that this session was archived elsewhere, so
     * each of them can show a note and return to its start screen. The
     * archiving view is not a subscriber, so `origin` only keeps the emit
     * skip rule honest.
     */
    notifyArchived(origin: string, sessionName: string): void {
        this.emit({ type: 'archived', origin, name: sessionName });
    }

    /**
     * Start building the planned questions in adaptive background batches.
     * The session shell (log, timer ids, placeholders) already exists.
     */
    startGeneration(entries: GenerationEntry[]): void {
        this.generationErrors = [];
        this.generationFailed = 0;
        this.generationTotal = entries.length;
        this.planned = entries.map((entry) => ({
            id: entry.id,
            title: entry.title,
            displayIndex: entry.displayIndex,
        }));
        this.generationBuilt = this.runtime.items.length;

        const pending = entries.filter(
            (entry) => !this.builtByDisplay.has(entry.displayIndex),
        );
        if (this.generationTotal === 0 || pending.length === 0) {
            this.generationComplete = true;
            this.emitGenerationProgress();
            this.startTimers();
            return;
        }

        this.generationComplete = false;
        this.timerCompleted = false;
        this.timer.running = false;
        if (this.config.presentation === 'one') {
            this.timer.activeQuestionId = this.planned[0]?.id ?? null;
        }
        const queue = new AdaptiveTaskQueue<number>({
            targetMs: 8,
            maxBatch: 16,
            onSlice: () => this.emitGenerationProgress(),
        });
        for (const entry of pending) {
            queue.enqueue(entry.displayIndex, () => this.runGenerationTask(entry));
        }
        this.generationQueue = queue;
        queue.start();
        this.emitGenerationProgress();
    }

    /** Pull the current question and a short lookahead to the front. */
    prioritizeGeneration(displayIndices: number[]): void {
        if (!this.generationQueue || this.generationComplete) return;
        this.generationQueue.prioritize(displayIndices);
    }

    /** A new tab attached while generation was paused; continue it. */
    resumeGeneration(): void {
        if (this.generationComplete || !this.generationQueue) return;
        this.generationQueue.start();
    }

    private runGenerationTask(entry: GenerationEntry): void {
        try {
            const item = entry.build();
            this.runtime.items.push(item);
            this.builtByDisplay.set(entry.displayIndex, item);
            this.generationBuilt++;
            this.emit({
                type: 'item',
                item,
                displayIndex: entry.displayIndex,
                origin: 'hub',
            });
        } catch (e) {
            this.generationFailed++;
            const message = `${entry.title}: ${(e as Error).message}`;
            this.generationErrors.push(message);
            // Match the synchronous builder: a failed question is not part of
            // the session order. Missing source notes are excluded earlier,
            // during planning.
            this.runtime.log.initial_order = this.runtime.log.initial_order.filter(
                (frozenIndex) => frozenIndex !== entry.id,
            );
            this.emit({
                type: 'generation-error',
                displayIndex: entry.displayIndex,
                message,
                origin: 'hub',
            });
        }

        if (
            this.generationBuilt + this.generationFailed >=
            this.generationTotal
        ) {
            this.finishGeneration();
        }
    }

    private finishGeneration(): void {
        if (this.generationComplete) return;
        this.generationComplete = true;
        this.generationQueue?.stop();
        this.generationQueue = null;
        this.emitGenerationProgress();
        if (
            this.items.length === 0 ||
            this.items.every((sq) => sq.submitted === true)
        ) {
            this.timerCompleted = true;
        }
        this.startTimers();
        void this.runtime.flush();
    }

    private emitGenerationProgress(): void {
        this.emit({
            type: 'generation',
            built: this.generationBuilt,
            total: this.generationTotal,
            failed: this.generationFailed,
            complete: this.generationComplete,
            origin: 'hub',
        });
    }

    /** Detach a view; the last view flushes and removes the group. */
    async release(viewID: string): Promise<void> {
        if (!this.subscribers.delete(viewID)) return;
        if (this.subscribers.size > 0) return;
        this.generationQueue?.stop();
        this.stopTimer(false);
        this.clearTextBroadcast();
        await this.runtime.flush();
        // A new view may have attached while the flush was pending; keep the
        // group in that case so both views keep sharing one runtime.
        if (this.subscribers.size === 0) this.onEmpty(this);
    }

    /**
     * Detach a view but keep this shared session registered with the hub.
     * Used by embedded sessions so a Reading/Live Preview re-render can
     * reattach to the same runtime without creating a new session.
     */
    async suspend(viewID: string): Promise<void> {
        if (!this.subscribers.delete(viewID)) return;
        if (this.subscribers.size > 0) return;
        this.generationQueue?.stop();
        this.stopTimer(false);
        this.clearTextBroadcast();
        await this.runtime.flush();
    }

    /** Plugin unload: stop clocks and pending text broadcasts. */
    dispose(): void {
        this.generationQueue?.stop();
        this.stopTimer(false);
        this.clearTextBroadcast();
    }

    setDocumentVisible(visible: boolean): void {
        if (visible) this.startTimers();
        else this.pauseTimer();
    }

    startTimers(): void {
        if (!this.generationComplete) {
            this.timer.running = false;
            return;
        }
        if (this.runtime.log.status !== 'pending' || this.timerCompleted) {
            this.timer.running = false;
            return;
        }
        if (!this.hasTimepieces()) {
            this.timer.running = false;
            return;
        }
        if (this.timerInterval !== null) return;
        this.timer.running = true;
        this.lastTick = performance.now();
        this.timer.updatedAt = new Date().toISOString();
        this.timerInterval = window.setInterval(() => this.tick(), 100);
        this.emit({ type: 'timer', origin: 'hub' });
    }

    pauseTimer(): void {
        if (this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.timer.running = false;
        this.timer.updatedAt = new Date().toISOString();
        this.emit({ type: 'timer', origin: 'hub' });
    }

    pick(id: number, picked: number | undefined, origin: string): void {
        const sq = this.findItem(id);
        if (!sq || sq.submitted === true) return;
        sq.pickedIndex = picked;
        this.clearPendingText(id);
        void this.runtime.flush();
        this.emit({ type: 'change', kind: 'pick', id, origin });
    }

    setDraft(id: number, value: string, origin: string): void {
        const sq = this.findItem(id);
        if (!sq || sq.submitted === true) return;
        sq.finalDraft = value;
        this.scheduleText({ type: 'change', kind: 'draft', id, origin });
    }

    setScratch(id: number, value: string, origin: string): void {
        const sq = this.findItem(id);
        if (!sq) return;
        sq.scratch = value;
        this.scheduleText({ type: 'change', kind: 'scratch', id, origin });
    }

    submit(id: number, origin: string): void {
        const sq = this.findItem(id);
        if (!sq) return;
        this.captureAnswerTimers(sq);
        void this.runtime.flush();
        this.clearPendingText(id);
        this.emit({ type: 'change', kind: 'submit', id, origin });
        this.stopIfComplete();
    }

    /** Submit every prepared item that has an answer (Submit all mode). */
    submitAll(origin: string): void {
        if (!this.generationComplete) return;
        for (const sq of this.items) {
            if (sq.submitted === true || !hasAnswer(sq)) continue;
            this.captureAnswerTimers(sq);
            this.finalizeItem(sq);
        }
        this.clearTextBroadcast();
        void this.runtime.flush();
        this.emit({ type: 'change', kind: 'bulk', origin });
        this.stopIfComplete();
    }

    setFlags(flags: number[], origin: string): void {
        this.runtime.setFlags(flags);
        this.emit({
            type: 'flags',
            flags: [...this.runtime.flags],
            origin,
        });
    }

    setIndex(index: number, origin: string): void {
        const total = this.planned.length > 0 ? this.planned.length : this.items.length;
        const max = Math.max(0, total - 1);
        const next = Math.min(Math.max(0, index), max);
        if (next === this.currentIndex) return;
        this.currentIndex = next;
        this.timer.activeQuestionId =
            this.config.presentation === 'one'
                ? this.itemAt(next)?.id ?? this.planned[next]?.id ?? null
                : null;
        this.prioritizeGeneration([next, next + 1, next + 2]);
        this.emit({ type: 'index', index: next, origin });
    }

    save(mode: Mode): Promise<TFile> {
        return this.runtime.save(mode).then((file) => {
            this.stopIfComplete();
            return file;
        });
    }

    async flush(): Promise<void> {
        await this.runtime.flush();
    }

    // ------------------------------------------------------------------
    // Timer
    // ------------------------------------------------------------------

    private get questionTimersAllowed(): boolean {
        return perQuestionTimersAllowed(
            this.config.presentation,
            this.config.submitMode,
        );
    }

    private get sessionTimerOn(): boolean {
        return this.config.timerSessionMode !== 'off';
    }

    private get questionTimerOn(): boolean {
        return (
            this.questionTimersAllowed &&
            this.config.timerQuestionMode !== 'off'
        );
    }

    private get questionStopwatchOn(): boolean {
        return this.questionTimersAllowed && this.config.stopwatchQuestion;
    }

    private hasTimepieces(): boolean {
        return (
            this.sessionTimerOn ||
            this.config.stopwatchSession ||
            this.questionTimerOn ||
            this.questionStopwatchOn
        );
    }

    private activeItem(): SessionQuestion | null {
        if (this.config.presentation !== 'one') return null;
        return this.itemAt(this.currentIndex) ?? null;
    }

    private tick(): void {
        if (!this.generationComplete) return;
        if (this.runtime.log.status !== 'pending' || this.timerCompleted) {
            this.stopTimer(false);
            return;
        }
        if (
            typeof activeDocument !== 'undefined' &&
            activeDocument.hidden
        ) {
            this.pauseTimer();
            return;
        }

        const now = performance.now();
        const delta = Math.max(0, now - this.lastTick);
        this.lastTick = now;
        const timer = this.timer;

        if (this.sessionTimerOn && timer.sessionExpired !== true) {
            timer.sessionRemainingMs -= delta;
            if (
                this.config.timerSessionMode === 'on' &&
                timer.sessionRemainingMs <= 0
            ) {
                timer.sessionRemainingMs = 0;
                this.expireSession();
                return;
            }
        }
        if (this.config.stopwatchSession) {
            timer.sessionElapsedMs += delta;
        }

        const active = this.activeItem();
        if (
            active &&
            active.submitted !== true &&
            timer.questionExpired[answerKey(active)] !== true
        ) {
            const key = answerKey(active);
            if (this.questionTimerOn) {
                timer.questionRemainingMs[key] =
                    (timer.questionRemainingMs[key] ??
                        this.config.timerQuestionSeconds * 1000) - delta;
                if (
                    this.config.timerQuestionMode === 'on' &&
                    (timer.questionRemainingMs[key] ?? 0) <= 0
                ) {
                    timer.questionRemainingMs[key] = 0;
                    this.expireQuestion(active);
                    return;
                }
            }
            if (this.questionStopwatchOn) {
                timer.questionElapsedMs[key] =
                    (timer.questionElapsedMs[key] ?? 0) + delta;
            }
        }

        timer.updatedAt = new Date().toISOString();
        this.emit({ type: 'timer', origin: 'hub' });
    }

    private expireSession(): void {
        if (this.timerCompleted) return;
        const timer = this.timer;
        timer.sessionExpired = true;
        timer.sessionRemainingMs = 0;
        this.timerCompleted = true;
        this.stopTimer(false);

        for (const sq of this.items) {
            if (sq.submitted === true) continue;
            sq.timerExpired = true;
            const key = answerKey(sq);
            if (this.questionStopwatchOn) {
                sq.timeSpentMs = timer.questionElapsedMs[key] ?? 0;
            }
            if (this.questionTimerOn) {
                sq.timerRemainingMs = timer.questionRemainingMs[key] ?? 0;
            }
            this.finalizeItem(sq);
        }

        void this.runtime.flush();
        this.clearTextBroadcast();
        this.emit({ type: 'change', kind: 'bulk', origin: 'hub' });
        this.emit({ type: 'timer', origin: 'hub' });
    }

    private expireQuestion(sq: SessionQuestion): void {
        const key = answerKey(sq);
        const timer = this.timer;
        timer.questionRemainingMs[key] = 0;
        timer.questionExpired[key] = true;
        if (this.questionStopwatchOn) {
            sq.timeSpentMs = timer.questionElapsedMs[key] ?? 0;
        }
        if (this.questionTimerOn) {
            sq.timerRemainingMs = 0;
        }
        if (!hasAnswer(sq)) sq.timerExpired = true;
        this.finalizeItem(sq);
        this.clearPendingText(sq.id);

        void this.runtime.flush();
        this.emit({ type: 'change', kind: 'submit', id: sq.id, origin: 'hub' });
        this.emit({ type: 'timer', origin: 'hub' });
        this.stopIfComplete();
    }

    private finalizeItem(sq: SessionQuestion): void {
        if (sq.submitted === true) return;
        const picked = sq.pickedIndex;
        if (picked !== undefined) {
            const choice = sq.choices[picked];
            if (choice) {
                sq.given = choice.text;
                sq.givenNote = choice.note;
                sq.isCorrect = grade(sq, { choice: picked });
                sq.submitted = true;
                return;
            }
        }
        const draft = (sq.finalDraft ?? '').trim();
        if (draft !== '') {
            sq.given = draft;
            sq.isCorrect = grade(sq, { typed: draft });
            sq.submitted = true;
            return;
        }
        sq.given = '';
        sq.isCorrect = false;
        sq.submitted = true;
    }

    private captureAnswerTimers(sq: SessionQuestion): void {
        const key = answerKey(sq);
        if (this.questionStopwatchOn) {
            sq.timeSpentMs =
                this.timer.questionElapsedMs[key] ?? sq.timeSpentMs;
        }
        if (this.questionTimerOn) {
            sq.timerRemainingMs =
                this.timer.questionRemainingMs[key] ?? sq.timerRemainingMs;
        }
    }

    private stopIfComplete(): void {
        if (this.timerCompleted) return;
        if (!this.generationComplete) return;
        if (!this.items.every((sq) => sq.submitted === true)) return;
        this.timerCompleted = true;
        this.stopTimer();
    }

    private stopTimer(emit = true): void {
        if (this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.timer.running = false;
        this.timer.updatedAt = new Date().toISOString();
        if (emit) this.emit({ type: 'timer', origin: 'hub' });
    }

    // ------------------------------------------------------------------
    // Sync plumbing
    // ------------------------------------------------------------------

    private findItem(id: number): SessionQuestion | undefined {
        return this.items.find((sq) => sq.id === id);
    }

    private scheduleText(event: TextChangeEvent): void {
        this.pendingText.set(
            `${event.origin}:${event.kind}:${event.id ?? ''}`,
            event,
        );
        if (this.textTimer !== null) return;
        this.textTimer = window.setTimeout(() => {
            this.textTimer = null;
            const events = [...this.pendingText.values()];
            this.pendingText.clear();
            for (const pending of events) this.emit(pending);
        }, TEXT_BROADCAST_DELAY);
    }

    private clearPendingText(id: number): void {
        for (const key of [...this.pendingText.keys()]) {
            if (key.endsWith(`:${id}`)) this.pendingText.delete(key);
        }
    }

    private clearTextBroadcast(): void {
        if (this.textTimer !== null) {
            window.clearTimeout(this.textTimer);
            this.textTimer = null;
        }
        this.pendingText.clear();
    }

    private emit(event: SharedSessionEvent): void {
        for (const [viewID, listener] of [...this.subscribers]) {
            if (event.origin === viewID) continue;
            try {
                listener(event);
            } catch (e) {
                console.warn(
                    '[rv] shared session listener failed:',
                    (e as Error).message,
                );
            }
        }
    }
}

export class SessionHub {
    private sessions = new Map<string, SharedSession>();

    register(file: TFile, runtime: SessionRuntime): SharedSession {
        const key = normalizePath(file.path);
        const existing = this.sessions.get(key);
        if (existing) return existing;
        const shared = new SharedSession(key, runtime, (empty) => {
            if (this.sessions.get(key) === empty) this.sessions.delete(key);
        });
        this.sessions.set(key, shared);
        return shared;
    }

    get(file: TFile | string): SharedSession | null {
        const path = typeof file === 'string' ? file : file.path;
        return this.sessions.get(normalizePath(path)) ?? null;
    }

    isAttached(file: TFile | string): boolean {
        return this.get(file) !== null;
    }

    /** Remove this exact shared session from the hub (embed cleanup). */
    drop(shared: SharedSession): void {
        if (this.sessions.get(shared.path) === shared) {
            this.sessions.delete(shared.path);
        }
    }

    attachedPaths(): string[] {
        return [...this.sessions.keys()];
    }

    async flushAll(): Promise<void> {
        await Promise.all(
            [...this.sessions.values()].map((shared) => shared.flush()),
        );
    }

    /** Stop clocks and release timers when the plugin unloads. */
    disposeAll(): void {
        for (const shared of this.sessions.values()) shared.dispose();
        this.sessions.clear();
    }
}
