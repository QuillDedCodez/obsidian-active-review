/** Restore per-question answer state from a stored session log. */
import type { SessionQuestion } from './types';

interface StoredAnswers {
    answers: Record<
        string,
        {
            picked?: number;
            given?: string;
            submitted?: boolean;
            isCorrect?: boolean;
            timeSpentMs?: number;
            timerRemainingMs?: number;
            timerExpired?: boolean;
        }
    >;
    scratch: Record<string, string>;
}

export interface HydrateOptions {
    /** Resume mode restores timer/stopwatch figures; replay mode does not. */
    timers?: boolean;
}

/**
 * Apply a stored log's answers and scratch to freshly rebuilt items. Missing
 * notes are skipped; they carry no answer key of their own.
 */
export function hydrateSessionItems(
    items: SessionQuestion[],
    log: StoredAnswers,
    options: HydrateOptions = {},
): void {
    const includeTimers = options.timers === true;
    for (const sq of items) {
        if (sq.missingPath) continue;
        const key = String(sq.id);
        const entry = log.answers[key];
        if (entry) {
            sq.submitted = entry.submitted === true;
            if (entry.picked !== undefined) {
                sq.pickedIndex = entry.picked;
                sq.given = sq.choices[entry.picked]?.text ?? '';
                sq.isCorrect = entry.isCorrect;
            } else if (entry.given !== undefined) {
                sq.given = entry.given;
                sq.finalDraft = entry.given;
                sq.isCorrect = entry.isCorrect;
            }
            if (includeTimers) {
                if (entry.timeSpentMs !== undefined) sq.timeSpentMs = entry.timeSpentMs;
                if (entry.timerRemainingMs !== undefined) {
                    sq.timerRemainingMs = entry.timerRemainingMs;
                }
                if (entry.timerExpired === true) sq.timerExpired = true;
            }
        }
        const scratch = log.scratch[key];
        if (scratch) sq.scratch = scratch;
    }
}
