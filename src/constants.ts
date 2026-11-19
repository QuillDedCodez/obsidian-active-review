/** Official plugin display name — single source for every user-visible title. */
export const PLUGIN_NAME = 'Active Review';

/** Ribbon tooltip, built from the display name. */
export const RIBBON_TOOLTIP = `Open ${PLUGIN_NAME} Tab`;

/** Prefix shared by notices and console diagnostics. */
export const MESSAGE_PREFIX = `${PLUGIN_NAME}:`;

/** Default review folder; overridden at runtime by plugin settings. */
export const DEFAULT_REVIEW_DIR = 'review';

/** Default subfolder inside the review folder for session logs. */
export const DEFAULT_SESSIONS_SUBDIR = '!rv-sessions';

/** Allowed difference when comparing a typed number or a distractor to the answer. */
export const TOLERANCE = 0.001;

/** Registered view type for the quiz tab. */
export const VIEW_TYPE = 'active-review-view';

/** Display-order modes for a fixed subset of questions. */
export type OrderMode = 'source' | 'random' | 'priority' | 'priority-random';

/** How answers are locked in. */
export type SubmitMode = 'auto' | 'any' | 'all';

/** When correctness feedback is revealed. Grading itself is silent at submit. */
export type GradeMode = 'immediate' | 'afterAll';

/** Countdown timer mode. */
export type TimerMode = 'off' | 'on' | 'soft';

/** Lowest and highest selectable number of multiple-choice options. */
export const MIN_CHOICE_COUNT = 2;
export const MAX_CHOICE_COUNT = 6;

/** Clamp a stored/generated value to the selectable choice range. */
export function clampChoiceCount(value: unknown): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 4;
    return Math.max(MIN_CHOICE_COUNT, Math.min(MAX_CHOICE_COUNT, n));
}

/**
 * Per-session configuration. Snapshotted when "Start session" is pressed.
 * Append-only across phases; no field is ever renamed or removed.
 */
export interface SessionConfig {
    /** `all` = every question on one page; `one` = one at a time with Prev/Next. */
    presentation: 'all' | 'one';
    /** Multiple-choice options per question (correct answer included). */
    choiceCount: number;
    /** Number of questions. `all` = no limit. */
    count: number | 'all';
    /** When `count < total`: keep the first N in source order (`seq`) or a seeded random subset (`rand`). */
    trim: 'seq' | 'rand';
    /** Display order of the trimmed subset. */
    order: OrderMode;
    /** Seed for trim, order, and per-question options. 0 = auto-generate on start. */
    seed: number;
    /** AutoSubmit (MCQ only), SubmitAny (per card), or SubmitAll (header). */
    submitMode: SubmitMode;
    /** Reveal feedback per submitted card, or only after all are submitted. */
    gradeMode: GradeMode;
    /** Pass threshold percentage, or `off`. */
    passScore: number | 'off';
    /** Which Manage Questions preset selects the session pool. */
    managePresetId: string;
    /** Session countdown mode. */
    timerSessionMode: TimerMode;
    /** Session countdown duration in seconds. */
    timerSessionSeconds: number;
    /** Session low-time warning threshold in seconds; 0 disables. */
    timerSessionWarningSeconds: number;
    /** Per-question countdown mode. */
    timerQuestionMode: TimerMode;
    /** Per-question countdown duration in seconds. */
    timerQuestionSeconds: number;
    /** Per-question low-time warning threshold in seconds; 0 disables. */
    timerQuestionWarningSeconds: number;
    /** Show a session stopwatch. */
    stopwatchSession: boolean;
    /** Show a per-question stopwatch. */
    stopwatchQuestion: boolean;
    /** Show the live navigator grid in one-at-a-time sessions. */
    navigator: boolean;
    /** Show per-card flag controls and persist flags in the session log. */
    allowFlag: boolean;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
    presentation: 'all',
    choiceCount: 4,
    count: 'all',
    trim: 'seq',
    order: 'source',
    seed: 0,
    submitMode: 'any',
    gradeMode: 'immediate',
    passScore: 80,
    managePresetId: 'all',
    timerSessionMode: 'off',
    timerSessionSeconds: 60,
    timerSessionWarningSeconds: 0,
    timerQuestionMode: 'off',
    timerQuestionSeconds: 60,
    timerQuestionWarningSeconds: 0,
    stopwatchSession: false,
    stopwatchQuestion: false,
    navigator: true,
    allowFlag: true,
};