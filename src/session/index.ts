/** session: parsed notes → playable questions. This file is the folder's public API. */
export {
    buildSession,
    buildSessionFromFrozen,
    planSession,
    planFrozenSession,
    buildPlannedQuestion,
    type BuildSessionResult,
    type BuildFromFrozenResult,
    type FrozenSessionState,
    type FrozenSessionPlan,
    type SessionPlan,
    type PlannedBuildContext,
    type PlannedQuestion,
} from './assemble';
export { buildQuestion } from './build';
export { sanitizeSessionConfig, normalizeModeConfig } from './config';
export {
    generationEntries,
    openFreshSession,
    type OpenFreshSessionOptions,
    type OpenFreshSessionResult,
    type SessionManageSnapshot,
} from './start';
export { grade, hasChoices } from './grading/grade';
export { hydrateSessionItems, type HydrateOptions } from './hydrate';
export type { Mode, Choice, SessionQuestion } from './types';
export {
    MAX_TIMER_SECONDS,
    perQuestionTimersAllowed,
    createTimerRuntime,
    createTimerRuntimeForIds,
    formatTimerMs,
    formatStopwatchMs,
    formatTimeInput,
    parseTimeInput,
    type TimerRuntimeState,
} from './timer';
