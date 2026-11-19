/** Session configuration normalization shared by the tab, embeds, and presets. */
import { clampChoiceCount, type SessionConfig } from '../constants';
import type { Mode } from './types';

/**
 * Clamp and normalize a session configuration. Used when a preset is applied,
 * when an embedded block overrides a preset, and before a session starts.
 */
export function sanitizeSessionConfig(config: SessionConfig): SessionConfig {
    const next = { ...config };
    if (next.presentation !== 'one' || next.submitMode === 'all') {
        next.timerQuestionMode = 'off';
        next.stopwatchQuestion = false;
    }
    if (next.timerSessionMode !== 'off' && next.timerSessionSeconds <= 0) {
        next.timerSessionSeconds = 60;
    }
    if (next.timerQuestionMode !== 'off' && next.timerQuestionSeconds <= 0) {
        next.timerQuestionSeconds = 60;
    }
    next.timerSessionWarningSeconds = Math.max(
        0,
        Math.floor(next.timerSessionWarningSeconds),
    );
    next.timerQuestionWarningSeconds = Math.max(
        0,
        Math.floor(next.timerQuestionWarningSeconds),
    );
    if (typeof next.count === 'number' && next.count < 1) next.count = 'all';
    next.seed = Math.max(0, Math.floor(next.seed));
    if (next.passScore !== 'off') {
        next.passScore = Math.max(0, Math.min(100, Math.floor(next.passScore)));
    }
    next.choiceCount = clampChoiceCount(next.choiceCount);
    next.navigator = next.navigator !== false;
    next.allowFlag = next.allowFlag !== false;
    return next;
}

/** Typed sessions cannot use AutoSubmit; mirror the start screen's rule. */
export function normalizeModeConfig(
    mode: Mode,
    config: SessionConfig,
): SessionConfig {
    const next = { ...config };
    if (mode === 'typed' && next.submitMode === 'auto') next.submitMode = 'any';
    return next;
}
