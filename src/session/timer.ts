/** Timer/stopwatch runtime shapes, formatting, and time-input parsing. */
import type { SessionConfig, SubmitMode } from '../constants';
import type { SessionQuestion } from './types';

export const MAX_TIMER_SECONDS = 99 * 3600 + 59 * 60 + 59;

export interface TimerRuntimeState {
    sessionRemainingMs: number;
    sessionElapsedMs: number;
    sessionExpired: boolean;
    questionRemainingMs: Record<string, number>;
    questionElapsedMs: Record<string, number>;
    questionExpired: Record<string, boolean>;
    activeQuestionId: number | null;
    running: boolean;
    updatedAt: string;
}

export function perQuestionTimersAllowed(
    presentation: 'all' | 'one',
    submitMode: SubmitMode,
): boolean {
    return presentation === 'one' && submitMode !== 'all';
}

export function createTimerRuntime(
    config: SessionConfig,
    items: SessionQuestion[],
    presentation: 'all' | 'one',
): TimerRuntimeState {
    return createTimerRuntimeForIds(
        config,
        items.map((item) => item.id),
        presentation,
    );
}

/**
 * Create timer state from stable frozen-question ids. Streaming generation
 * can start the session (and persist its timer state) before the questions
 * themselves exist.
 */
export function createTimerRuntimeForIds(
    config: SessionConfig,
    ids: number[],
    presentation: 'all' | 'one',
): TimerRuntimeState {
    const sessionTimer =
        config.timerSessionMode !== 'off' && config.timerSessionSeconds > 0;
    const questionAllowed = perQuestionTimersAllowed(presentation, config.submitMode);
    const questionTimer =
        questionAllowed &&
        config.timerQuestionMode !== 'off' &&
        config.timerQuestionSeconds > 0;

    const questionRemainingMs: Record<string, number> = {};
    const questionElapsedMs: Record<string, number> = {};
    const questionExpired: Record<string, boolean> = {};
    for (const id of ids) {
        const key = String(id);
        questionRemainingMs[key] = questionTimer ? config.timerQuestionSeconds * 1000 : 0;
        questionElapsedMs[key] = 0;
        questionExpired[key] = false;
    }

    return {
        sessionRemainingMs: sessionTimer ? config.timerSessionSeconds * 1000 : 0,
        sessionElapsedMs: 0,
        sessionExpired: false,
        questionRemainingMs,
        questionElapsedMs,
        questionExpired,
        activeQuestionId: presentation === 'one' ? ids[0] ?? null : null,
        running: true,
        updatedAt: new Date().toISOString(),
    };
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

function formatClock(ms: number, signed: boolean): string {
    const negative = signed && ms < 0;
    const tenths = Math.floor(Math.abs(ms) / 100);
    let text: string;

    if (tenths >= 36000) {
        const hours = Math.floor(tenths / 36000);
        const minutes = Math.floor((tenths % 36000) / 600);
        const seconds = Math.floor((tenths % 600) / 10);
        text = `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
    } else if (tenths >= 600) {
        const minutes = Math.floor(tenths / 600);
        const seconds = Math.floor((tenths % 600) / 10);
        text = `${minutes}:${pad2(seconds)}`;
    } else {
        text = (tenths / 10).toFixed(1);
    }

    return negative && tenths > 0 ? `-${text}` : text;
}

export function formatTimerMs(ms: number): string {
    return formatClock(ms, true);
}

export function formatStopwatchMs(ms: number): string {
    return formatClock(ms, false);
}

export function formatTimeInput(seconds: number): string {
    const total = Math.max(1, Math.round(seconds));
    if (total >= 3600) {
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        return `${hours}:${pad2(minutes)}:${pad2(total % 60)}`;
    }
    return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/** Parse S, SS, M:SS, MM:SS, H:MM:SS, or HH:MM:SS into seconds. */
export function parseTimeInput(raw: string): number | null {
    const text = raw.trim();
    if (!text) return null;
    const parts = text.split(':');
    let seconds: number;

    if (parts.length === 1) {
        if (!/^\d{1,6}$/.test(parts[0]!)) return null;
        seconds = parseInt(parts[0]!, 10);
    } else if (parts.length === 2) {
        const [m, s] = parts;
        if (!/^\d{1,2}$/.test(m!) || !/^\d{1,2}$/.test(s!)) return null;
        const minutes = parseInt(m!, 10);
        const secs = parseInt(s!, 10);
        if (secs >= 60) return null;
        seconds = minutes * 60 + secs;
    } else if (parts.length === 3) {
        const [h, m, s] = parts;
        if (
            !/^\d{1,2}$/.test(h!) ||
            !/^\d{1,2}$/.test(m!) ||
            !/^\d{1,2}$/.test(s!)
        ) {
            return null;
        }
        const hours = parseInt(h!, 10);
        const minutes = parseInt(m!, 10);
        const secs = parseInt(s!, 10);
        if (hours > 99 || minutes >= 60 || secs >= 60) return null;
        seconds = hours * 3600 + minutes * 60 + secs;
    } else {
        return null;
    }

    if (seconds <= 0 || seconds > MAX_TIMER_SECONDS) return null;
    return seconds;
}
