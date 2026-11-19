/** Shared Timer/Stopwatch configuration rows for QS and Reproduce. */
import { Notice } from 'obsidian';
import type { SessionConfig, TimerMode } from '../constants';
import {
    formatTimeInput,
    parseTimeInput,
    perQuestionTimersAllowed,
} from '../session';

export interface TimerConfigSectionProps {
    parent: HTMLElement;
    config: SessionConfig;
    presentedCount: number;
    onChange: (patch: Partial<SessionConfig>) => void;
    showSessionWarning?: boolean;
}

export interface TimerConfigSectionHandle {
    refresh: () => void;
}

const TIMER_MODES: [TimerMode, string][] = [
    ['off', 'OFF'],
    ['on', 'ON'],
    ['soft', 'SOFT'],
];

interface TimerRow {
    label: HTMLElement;
    modes: Map<TimerMode, HTMLButtonElement>;
    timeInput: HTMLInputElement;
    warnWrap: HTMLElement;
    warnInput: HTMLInputElement;
}

interface StopwatchRow {
    label: HTMLElement;
    modes: Map<string, HTMLButtonElement>;
}

export function renderTimerConfigSection(
    props: TimerConfigSectionProps,
): TimerConfigSectionHandle {
    const root = props.parent.createDiv({ cls: 'rv-timer-config' });

    // Build the controls once and update them in place. Rebuilding this
    // subtree on every toggle used to destroy the tapped button mid-gesture,
    // which made mobile browsers scroll the start screen back to the focused
    // (or removed) element. In-place updates avoid that scroll jump entirely.
    const setTimerMode = (scope: 'session' | 'question', value: TimerMode): void => {
        const config = props.config;
        const isSession = scope === 'session';
        const mode = isSession ? config.timerSessionMode : config.timerQuestionMode;
        if (mode === value) return;
        const patch: Partial<SessionConfig> = isSession
            ? { timerSessionMode: value }
            : { timerQuestionMode: value };
        if (mode === 'off' && value !== 'off') {
            if (isSession) {
                const base =
                    config.timerQuestionMode !== 'off'
                        ? config.timerQuestionSeconds
                        : 60;
                patch.timerSessionSeconds = Math.max(
                    1,
                    (props.presentedCount || 1) * base,
                );
            } else if (config.timerQuestionSeconds <= 0) {
                patch.timerQuestionSeconds = 60;
            }
        }
        props.onChange(patch);
        refresh();
    };

    const setTime = (scope: 'session' | 'question', raw: string): boolean => {
        const isSession = scope === 'session';
        const parsed = parseTimeInput(raw);
        if (parsed === null) {
            new Notice('Use S, SS, M:SS, MM:SS, H:MM:SS, or HH:MM:SS.');
            return false;
        }
        props.onChange(
            isSession
                ? { timerSessionSeconds: parsed }
                : { timerQuestionSeconds: parsed },
        );
        refresh();
        return true;
    };

    const setWarning = (scope: 'session' | 'question', raw: string): void => {
        const isSession = scope === 'session';
        const parsed = parseInt(raw, 10);
        const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        props.onChange(
            isSession
                ? { timerSessionWarningSeconds: next }
                : { timerQuestionWarningSeconds: next },
        );
        refresh();
    };

    const createTimerRow = (label: string, scope: 'session' | 'question'): TimerRow => {
        const row = root.createDiv({ cls: 'rv-config-row rv-timer-row' });
        const labelEl = row.createEl('label', { cls: 'rv-config-label', text: label });
        const modesEl = row.createDiv({ cls: 'rv-modes' });
        const modes = new Map<TimerMode, HTMLButtonElement>();
        for (const [value, text] of TIMER_MODES) {
            const b = modesEl.createEl('button', { text, cls: 'rv-mode' });
            b.addEventListener('click', () => {
                if (b.disabled) return;
                setTimerMode(scope, value);
            });
            modes.set(value, b);
        }

        const timeInput = row.createEl('input', {
            type: 'text',
            cls: 'rv-config-timer-input',
            attr: { placeholder: 'M:SS' },
        });
        timeInput.addEventListener('change', () => {
            if (timeInput.disabled) return;
            if (setTime(scope, timeInput.value)) return;
            const config = props.config;
            const seconds =
                scope === 'session'
                    ? config.timerSessionSeconds
                    : config.timerQuestionSeconds;
            timeInput.value = formatTimeInput(seconds);
        });

        const warnWrap = row.createDiv({ cls: 'rv-timer-warn' });
        warnWrap.createSpan({ text: 'Warn at' });
        const warnInput = warnWrap.createEl('input', {
            type: 'number',
            cls: 'rv-config-timer-warn',
            attr: { min: '0', max: '359999', step: '1', value: '0' },
        });
        warnWrap.createSpan({ text: 's' });
        warnInput.addEventListener('change', () => {
            if (warnInput.disabled) return;
            setWarning(scope, warnInput.value);
        });

        return { label: labelEl, modes, timeInput, warnWrap, warnInput };
    };

    const createStopwatchRow = (
        label: string,
        scope: 'session' | 'question',
    ): StopwatchRow => {
        const row = root.createDiv({
            cls: 'rv-config-row rv-timer-row rv-stopwatch-row',
        });
        const labelEl = row.createEl('label', { cls: 'rv-config-label', text: label });
        const modesEl = row.createDiv({ cls: 'rv-modes' });
        const modes = new Map<string, HTMLButtonElement>();
        for (const [value, text] of [
            ['off', 'OFF'],
            ['on', 'ON'],
        ] as [string, string][]) {
            const b = modesEl.createEl('button', { text, cls: 'rv-mode' });
            b.addEventListener('click', () => {
                if (b.disabled) return;
                const enabled = value === 'on';
                props.onChange(
                    scope === 'session'
                        ? { stopwatchSession: enabled }
                        : { stopwatchQuestion: enabled },
                );
                refresh();
            });
            modes.set(value, b);
        }
        return { label: labelEl, modes };
    };

    // ---------- Timer ----------
    root.createEl('h4', { text: 'Timer' });
    const sessionTimer = createTimerRow('Session', 'session');
    const questionTimer = createTimerRow('Per Question', 'question');

    // ---------- Stopwatch ----------
    root.createEl('h4', { text: 'Stopwatch' });
    const sessionStopwatch = createStopwatchRow('Session', 'session');
    const questionStopwatch = createStopwatchRow('Per Question', 'question');

    const warningNote = root.createEl('p', { cls: 'rv-timer-warning-note' });
    warningNote.addClass('rv-hidden');

    const refresh = (): void => {
        const config = props.config;
        const allowed = perQuestionTimersAllowed(config.presentation, config.submitMode);
        if (!allowed && (config.timerQuestionMode !== 'off' || config.stopwatchQuestion)) {
            props.onChange({ timerQuestionMode: 'off', stopwatchQuestion: false });
        }

        for (const [scope, row] of [
            ['session', sessionTimer],
            ['question', questionTimer],
        ] as const) {
            const isSession = scope === 'session';
            const disabled = !isSession && !allowed;
            const mode = isSession ? config.timerSessionMode : config.timerQuestionMode;
            const seconds = isSession
                ? config.timerSessionSeconds
                : config.timerQuestionSeconds;
            const warning = isSession
                ? config.timerSessionWarningSeconds
                : config.timerQuestionWarningSeconds;

            for (const [value, button] of row.modes) {
                button.toggleClass('is-active', mode === value);
                button.disabled = disabled;
            }
            row.timeInput.disabled = disabled || mode === 'off';
            if (activeDocument.activeElement !== row.timeInput) {
                row.timeInput.value = formatTimeInput(seconds);
            }
            row.warnInput.disabled = disabled || mode === 'off';
            if (activeDocument.activeElement !== row.warnInput) {
                row.warnInput.value = String(warning);
            }
        }

        for (const [scope, row] of [
            ['session', sessionStopwatch],
            ['question', questionStopwatch],
        ] as const) {
            const isSession = scope === 'session';
            const disabled = !isSession && !allowed;
            const enabled = isSession ? config.stopwatchSession : config.stopwatchQuestion;
            for (const [value, button] of row.modes) {
                button.toggleClass('is-active', (value === 'on') === enabled);
                button.disabled = disabled;
            }
        }

        const showWarning =
            props.showSessionWarning !== false &&
            config.timerSessionMode !== 'off' &&
            config.timerQuestionMode !== 'off' &&
            props.presentedCount > 0 &&
            config.timerSessionSeconds <
                props.presentedCount * config.timerQuestionSeconds;
        warningNote.toggleClass('rv-hidden', !showWarning);
        warningNote.setText(
            showWarning
                ? 'Session timer is shorter than the total per-question timer allowance.'
                : '',
        );
    };

    refresh();
    return { refresh };
}
