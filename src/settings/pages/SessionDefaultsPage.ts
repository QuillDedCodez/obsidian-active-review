/** Default settings used by new sessions. */
import { Setting } from 'obsidian';
import {
    MAX_CHOICE_COUNT,
    MIN_CHOICE_COUNT,
    type GradeMode,
    type OrderMode,
    type SessionConfig,
    type SubmitMode,
    type TimerMode,
} from '../../constants';
import type ReviewQuizPlugin from '../../main';
import { RvSettingPage } from '../SettingsPageBase';

const SUBMIT_MODES: [SubmitMode, string][] = [
    ['any', 'Submit any'],
    ['auto', 'AutoSubmit'],
    ['all', 'Submit all'],
];

const GRADE_MODES: [GradeMode, string][] = [
    ['immediate', 'Immediate'],
    ['afterAll', 'After all'],
];

const TIMER_MODES: [TimerMode, string][] = [
    ['off', 'Off'],
    ['on', 'On'],
    ['soft', 'Soft'],
];

const CHOICE_OPTIONS: [string, string][] = Array.from(
    { length: MAX_CHOICE_COUNT - MIN_CHOICE_COUNT + 1 },
    (_, index) => {
        const value = String(MIN_CHOICE_COUNT + index);
        return [value, value];
    },
);

export class SessionDefaultsPage extends RvSettingPage {
    constructor(private plugin: ReviewQuizPlugin) {
        super();
        this.title = 'Session Defaults';
    }

    protected renderPage(): void {
        this.containerEl.empty();
        const defaults = this.plugin.settings.sessionDefaults;

        this.containerEl.createEl('p', {
            cls: 'setting-item-description',
            text: 'Used by the Session settings panel on the start screen. Changes affect new views opened after this point.',
        });

        // ---------- Shape ----------
        this.addDropdown(
            'Presentation',
            'All on one page, or one at a time with Previous / Next.',
            [
                ['all', 'All at once'],
                ['one', 'One at a time'],
            ],
            defaults.presentation,
            (v) => void this.persist({ presentation: v as 'all' | 'one' }),
        );

        this.addDropdown(
            'Choices',
            'Multiple-choice options per question, including the correct answer.',
            CHOICE_OPTIONS,
            String(defaults.choiceCount),
            (v) => void this.persist({ choiceCount: parseInt(v, 10) }),
        );

        this.addText(
            'Number of questions',
            'Enter "all" for no limit, or a positive integer.',
            defaults.count === 'all' ? 'all' : String(defaults.count),
            'all',
            (value) => {
                const t = value.trim().toLowerCase();
                if (t === 'all' || t === '') return void this.persist({ count: 'all' });
                const n = parseInt(t, 10);
                if (Number.isFinite(n) && n >= 1) void this.persist({ count: n });
            },
        );

        this.addDropdown(
            'Trim method',
            'Sequential (first N) or seeded random subset.',
            [
                ['seq', 'Sequential'],
                ['rand', 'Random subset'],
            ],
            defaults.trim,
            (v) => void this.persist({ trim: v as 'seq' | 'rand' }),
        );

        this.addDropdown(
            'Order',
            'Display order of the selected questions.',
            [
                ['source', 'Source'],
                ['random', 'Random'],
                ['priority', 'Priority'],
                ['priority-random', 'Priority shuffle'],
            ],
            defaults.order,
            (v) => void this.persist({ order: v as OrderMode }),
        );

        this.addText(
            'Default seed',
            '0 = auto-generate on session start.',
            String(defaults.seed),
            '0',
            (value) => {
                const n = parseInt(value.trim(), 10);
                void this.persist({ seed: Number.isFinite(n) && n >= 0 ? n : 0 });
            },
        );

        // ---------- Submit ----------
        this.addDropdown(
            'Submit',
            'How answers are locked in. AutoSubmit is MCQ-only.',
            SUBMIT_MODES,
            defaults.submitMode,
            (v) => void this.persist({ submitMode: v as SubmitMode }),
        );

        // ---------- Grade ----------
        this.addDropdown(
            'Grade',
            'When correctness feedback is revealed.',
            GRADE_MODES,
            defaults.gradeMode,
            (v) => void this.persist({ gradeMode: v as GradeMode }),
        );

        // ---------- Pass score ----------
        this.renderPassScore();

        // ---------- Timer ----------
        this.renderTimer();

        // ---------- Stopwatch ----------
        this.renderStopwatch();

        // ---------- Session controls ----------
        new Setting(this.containerEl)
            .setName('Navigator')
            .setDesc('Show the question grid in one-at-a-time sessions.')
            .addToggle((t) =>
                t.setValue(defaults.navigator).onChange((v) => void this.persist({ navigator: v })),
            );

        new Setting(this.containerEl)
            .setName('Allow flag')
            .setDesc('Show per-card flag controls.')
            .addToggle((t) =>
                t.setValue(defaults.allowFlag).onChange((v) => void this.persist({ allowFlag: v })),
            );
    }

    // ---------- Persist helpers ----------

    private async persist(patch: Partial<SessionConfig>): Promise<void> {
        await this.plugin.setSessionDefaults({
            ...this.plugin.settings.sessionDefaults,
            ...patch,
        });
    }

    /** Persist then redraw — used when the change toggles visibility/enabled
     *  state of another control (e.g. timer mode → seconds field). */
    private async persistAndRefresh(patch: Partial<SessionConfig>): Promise<void> {
        await this.persist(patch);
        this.renderPage();
    }

    // ---------- Generic row builders ----------

    private addDropdown(
        name: string,
        desc: string,
        options: readonly [string, string][],
        current: string,
        onChange: (value: string) => void,
    ): Setting {
        return new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addDropdown((dd) => {
                for (const [value, label] of options) dd.addOption(value, label);
                dd.setValue(current).onChange(onChange);
            });
    }

    private addText(
        name: string,
        desc: string,
        current: string,
        placeholder: string,
        onChange: (value: string) => void,
    ): Setting {
        return new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addText((text) =>
                text
                    .setPlaceholder(placeholder)
                    .setValue(current)
                    .onChange(onChange),
            );
    }

    // ---------- Pass score ----------

    private renderPassScore(): void {
        const defaults = this.plugin.settings.sessionDefaults;
        const passOn = defaults.passScore !== 'off';
        const numeric = passOn ? (defaults.passScore as number) : 80;

        new Setting(this.containerEl)
            .setName('Pass score')
            .setDesc('Correct-answer threshold. Off disables pass/fail display.')
            .addToggle((toggle) =>
                toggle.setValue(passOn).onChange((on) => {
                    void this.persistAndRefresh({ passScore: on ? numeric : 'off' });
                }),
            )
            .addText((text) => {
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text.inputEl.max = '100';
                text.setValue(String(numeric));
                text.setDisabled(!passOn);
                text.onChange((value) => {
                    if (!passOn) return;
                    const n = parseInt(value.trim(), 10);
                    if (Number.isFinite(n) && n >= 0 && n <= 100) {
                        void this.persist({ passScore: n });
                    }
                });
            });
    }

    // ---------- Timer ----------

    private renderTimer(): void {
        const defaults = this.plugin.settings.sessionDefaults;

        this.renderTimerRow(
            'Session timer',
            'Whole-session countdown. On = force-submit at zero; Soft = warning only.',
            defaults.timerSessionMode,
            defaults.timerSessionSeconds,
            (mode) => void this.persistAndRefresh({ timerSessionMode: mode }),
            (seconds) => void this.persist({ timerSessionSeconds: seconds }),
        );

        this.renderTimerRow(
            'Per-question timer',
            'Countdown per card. One-at-a-time sessions only; disabled when Submit is All.',
            defaults.timerQuestionMode,
            defaults.timerQuestionSeconds,
            (mode) => void this.persistAndRefresh({ timerQuestionMode: mode }),
            (seconds) => void this.persist({ timerQuestionSeconds: seconds }),
        );
    }

    private renderTimerRow(
        name: string,
        desc: string,
        currentMode: TimerMode,
        currentSeconds: number,
        onModeChange: (mode: TimerMode) => void,
        onSecondsChange: (seconds: number) => void,
    ): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addDropdown((dd) => {
                for (const [value, label] of TIMER_MODES) dd.addOption(value, label);
                dd.setValue(currentMode).onChange((v) => onModeChange(v as TimerMode));
            })
            .addText((text) => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.setValue(String(currentSeconds));
                text.setDisabled(currentMode === 'off');
                text.onChange((value) => {
                    if (currentMode === 'off') return;
                    const n = parseInt(value.trim(), 10);
                    if (Number.isFinite(n) && n > 0) onSecondsChange(n);
                });
            });
    }

    // ---------- Stopwatch ----------

    private renderStopwatch(): void {
        const defaults = this.plugin.settings.sessionDefaults;

        this.renderStopwatchRow(
            'Session stopwatch',
            'Elapsed-time readout for the whole session.',
            defaults.stopwatchSession,
            (v) => void this.persist({ stopwatchSession: v }),
        );

        this.renderStopwatchRow(
            'Per-question stopwatch',
            'Elapsed-time readout per card. Same availability as the per-question timer.',
            defaults.stopwatchQuestion,
            (v) => void this.persist({ stopwatchQuestion: v }),
        );
    }

    private renderStopwatchRow(
        name: string,
        desc: string,
        current: boolean,
        onChange: (value: boolean) => void,
    ): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addToggle((t) => t.setValue(current).onChange(onChange));
    }
}
