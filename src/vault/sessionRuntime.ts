/**
 * Owns one active session: its log, file, generated items, timer, and the
 * single write queue that serialises every disk update.
 */
import type { TFile, Vault } from 'obsidian';
import type { SessionConfig } from '../constants';
import type { Mode, SessionQuestion, TimerRuntimeState } from '../session';
import {
    updateSessionFile,
    type SessionAnswerEntry,
    type SessionLogState,
} from './sessionLog';

export class SessionRuntime {
    saved = false;
    savedFile: TFile | null = null;
    savePromise: Promise<TFile> | null = null;
    currentIndex = 0;

    private writeChain: Promise<void> = Promise.resolve();
    private completing = false;

    constructor(
        private vault: Vault,
        public log: SessionLogState,
        public file: TFile,
        public items: SessionQuestion[],
        public timer: TimerRuntimeState,
        public config: SessionConfig,
        public mode: Mode,
    ) {}

    get flags(): number[] {
        return this.log.flags;
    }

    /** Write the current answer state while the session is still pending. */
    async flush(): Promise<void> {
        if (this.log.status !== 'pending' || this.completing) return;
        this.syncLog();
        try {
            await this.enqueue(this.log);
        } catch (e) {
            console.warn('[rv] flush failed:', (e as Error).message);
        }
    }

    /** Write the current state once, propagating failures. */
    async writeNow(): Promise<void> {
        this.syncLog();
        await this.enqueue(this.log);
    }

    /** Mark the session completed and write it exactly once. */
    save(mode: Mode): Promise<TFile> {
        if (this.savedFile) return Promise.resolve(this.savedFile);
        if (this.savePromise) return this.savePromise;
        // A session another tab archived is frozen (status no longer pending):
        // completing it here would write `completed` over the archive.
        if (this.log.status !== 'pending') return Promise.resolve(this.file);

        const previousStatus = this.log.status;
        const previousCompletedAt = this.log.completed_at;
        const previousMode = this.log.mode;
        this.completing = true;
        this.syncLog();
        const completedLog: SessionLogState = {
            ...this.log,
            status: 'completed',
            completed_at: new Date().toISOString(),
            mode,
        };

        this.savePromise = this.enqueue(completedLog).then(
            () => {
                this.log = completedLog;
                this.saved = true;
                this.savedFile = this.file;
                this.completing = false;
                return this.file;
            },
            (e) => {
                this.log.status = previousStatus;
                this.log.completed_at = previousCompletedAt;
                this.log.mode = previousMode;
                this.completing = false;
                this.savePromise = null;
                throw e;
            },
        );
        return this.savePromise;
    }

    setFlags(flags: number[]): void {
        this.log.flags = [...new Set(flags)]
            .filter((value) => Number.isFinite(value))
            .sort((a, b) => a - b);
        void this.flush();
    }

    async rename(name: string): Promise<void> {
        this.log.session_name = name;
        await this.enqueue(this.log);
    }

    private enqueue(log: SessionLogState): Promise<void> {
        const run = this.writeChain.then(() =>
            updateSessionFile(this.vault, this.file, log, this.items),
        );
        this.writeChain = run.catch(() => undefined);
        return run;
    }

    private syncLog(): void {
        const answers: Record<string, SessionAnswerEntry> = { ...this.log.answers };
        const scratch: Record<string, string> = { ...this.log.scratch };
        for (const sq of this.items) {
            const key = String(sq.id);
            const hasRecorded =
                sq.submitted === true ||
                sq.isCorrect !== undefined ||
                sq.pickedIndex !== undefined ||
                (sq.finalDraft ?? '').trim() !== '';
            if (hasRecorded) {
                const entry: SessionAnswerEntry = {
                    submitted: sq.submitted === true,
                };
                if (sq.isCorrect !== undefined) {
                    entry.isCorrect = sq.isCorrect;
                    entry.firstCorrect = sq.isCorrect;
                }
                if (sq.pickedIndex !== undefined) {
                    entry.picked = sq.pickedIndex;
                    entry.typed = false;
                } else {
                    entry.given = sq.given ?? sq.finalDraft ?? '';
                    entry.typed = true;
                }
                if (sq.timeSpentMs !== undefined) entry.timeSpentMs = sq.timeSpentMs;
                if (sq.timerRemainingMs !== undefined) {
                    entry.timerRemainingMs = sq.timerRemainingMs;
                }
                if (sq.timerExpired === true) entry.timerExpired = true;
                answers[key] = entry;
            } else {
                delete answers[key];
            }
            if (sq.scratch && sq.scratch.trim()) scratch[key] = sq.scratch;
            else delete scratch[key];
        }
        this.log.answers = answers;
        this.log.scratch = scratch;
        this.log.timer_state = this.timer;
    }
}
