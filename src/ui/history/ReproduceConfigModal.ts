/** Config modal for reproduce — subset selection is frozen; all other QS settings editable. */
import { Modal, type App } from 'obsidian';
import {
    MAX_CHOICE_COUNT,
    MIN_CHOICE_COUNT,
    clampChoiceCount,
    type GradeMode,
    type OrderMode,
    type SessionConfig,
    type SubmitMode,
} from '../../constants';
import { configFromSnapshot, type SessionLogState } from '../../vault/sessionLog';
import {
    renderTimerConfigSection,
    type TimerConfigSectionHandle,
} from '../TimerConfigSection';

export interface ReproduceConfigModalOptions {
    originalLog: SessionLogState;
    onConfirm: (config: SessionConfig, name: string) => void;
    /** Fired when the modal is dismissed without confirming (Cancel or Escape). */
    onCancel?: () => void;
}

export class ReproduceConfigModal extends Modal {
    private options: ReproduceConfigModalOptions;
    private config: SessionConfig;
    private sessionName = '';
    private timerSection: TimerConfigSectionHandle | null = null;
    private confirmed = false;

    constructor(app: App, options: ReproduceConfigModalOptions) {
        super(app);
        this.options = options;
        const snap = options.originalLog.qs_snapshot;
        this.config = {
            ...configFromSnapshot(snap),
            count: 'all',
            trim: 'seq',
        };
    }

    onOpen(): void {
        const { contentEl } = this;
        const { originalLog } = this.options;
        const config = this.config;

        contentEl.empty();
        contentEl.createEl('h2', { text: 'Reproduce session' });
        contentEl.createEl('p', {
            cls: 'setting-item-description',
            text: `Frozen pool: ${originalLog.frozen_pool.length} question${originalLog.frozen_pool.length === 1 ? '' : 's'}. Answers, scratch, and flags will be cleared.`,
        });

        const nameRow = contentEl.createDiv({ cls: 'rv-config-row' });
        nameRow.createEl('label', { cls: 'rv-config-label', text: 'Session name' });
        const nameInput = nameRow.createEl('input', { type: 'text', cls: 'rv-config-text' });
        nameInput.placeholder = 'Optional name';
        nameInput.value = this.sessionName;
        nameInput.addEventListener('input', () => { this.sessionName = nameInput.value; });

        const presRow = contentEl.createDiv({ cls: 'rv-config-row' });
        presRow.createEl('label', { cls: 'rv-config-label', text: 'Presentation' });
        const presSeg = presRow.createDiv({ cls: 'rv-modes' });
        const presOptions: ['all' | 'one', string][] = [
            ['all', 'All at once'],
            ['one', 'One at a time'],
        ];
        const presButtons: HTMLButtonElement[] = [];
        for (const [value, label] of presOptions) {
            const b = presSeg.createEl('button', { text: label, cls: 'rv-mode' });
            b.toggleClass('is-active', config.presentation === value);
            b.addEventListener('click', () => {
                config.presentation = value;
                presButtons.forEach((x, i) => x.toggleClass('is-active', presOptions[i]![0] === value));
                this.timerSection?.refresh();
            });
            presButtons.push(b);
        }

        if (originalLog.mode === 'choice') {
            const choiceRow = contentEl.createDiv({ cls: 'rv-config-row' });
            choiceRow.createEl('label', { cls: 'rv-config-label', text: 'No. of Choices' });
            const choiceSeg = choiceRow.createDiv({ cls: 'rv-modes' });
            const choiceOptions = Array.from(
                { length: MAX_CHOICE_COUNT - MIN_CHOICE_COUNT + 1 },
                (_, index) => MIN_CHOICE_COUNT + index,
            );
            const activeChoice = clampChoiceCount(config.choiceCount);
            const choiceButtons: HTMLButtonElement[] = [];
            for (const n of choiceOptions) {
                const b = choiceSeg.createEl('button', { text: String(n), cls: 'rv-mode' });
                b.toggleClass('is-active', activeChoice === n);
                b.addEventListener('click', () => {
                    config.choiceCount = n;
                    choiceButtons.forEach((x, i) =>
                        x.toggleClass('is-active', choiceOptions[i] === n),
                    );
                });
                choiceButtons.push(b);
            }
        }

        const submitRow = contentEl.createDiv({ cls: 'rv-config-row' });
        submitRow.createEl('label', { cls: 'rv-config-label', text: 'Submit' });
        const submitSeg = submitRow.createDiv({ cls: 'rv-modes' });
        const submitOptions: [SubmitMode, string][] = [
            ['auto', 'AutoSubmit'],
            ['any', 'Submit any'],
            ['all', 'Submit all'],
        ];
        const submitButtons: HTMLButtonElement[] = [];
        for (const [value, label] of submitOptions) {
            const b = submitSeg.createEl('button', { text: label, cls: 'rv-mode' });
            b.toggleClass('is-active', config.submitMode === value);
            b.disabled = value === 'auto' && originalLog.mode === 'typed';
            b.addEventListener('click', () => {
                if (b.disabled) return;
                config.submitMode = value;
                submitButtons.forEach((x, i) => x.toggleClass('is-active', submitOptions[i]![0] === value));
                this.timerSection?.refresh();
            });
            submitButtons.push(b);
        }
        if (config.submitMode === 'auto' && originalLog.mode === 'typed') {
            config.submitMode = 'any';
            submitButtons.forEach((x, i) =>
                x.toggleClass('is-active', submitOptions[i]![0] === 'any'),
            );
        }

        const displayRow = contentEl.createDiv({ cls: 'rv-config-row' });
        displayRow.createEl('label', {
            cls: 'rv-config-label',
            text: 'Session controls',
        });
        const displayToggles = displayRow.createDiv({ cls: 'rv-modes' });
        const mkToggle = (
            label: string,
            value: boolean,
            onChange: (value: boolean) => void,
        ): void => {
            const wrap = displayToggles.createEl('label', { cls: 'rv-advanced-check' });
            const input = wrap.createEl('input', { type: 'checkbox' });
            input.checked = value;
            input.addEventListener('change', () => onChange(input.checked));
            wrap.createSpan({ text: label });
        };
        mkToggle('Navigator', config.navigator, (value) => {
            config.navigator = value;
        });
        mkToggle('Allow flag', config.allowFlag, (value) => {
            config.allowFlag = value;
        });

        const gradeRow = contentEl.createDiv({ cls: 'rv-config-row' });
        gradeRow.createEl('label', { cls: 'rv-config-label', text: 'Grade' });        const gradeSeg = gradeRow.createDiv({ cls: 'rv-modes' });
        const gradeOptions: [GradeMode, string][] = [
            ['immediate', 'Immediate'],
            ['afterAll', 'After all'],
        ];
        const gradeButtons: HTMLButtonElement[] = [];
        for (const [value, label] of gradeOptions) {
            const b = gradeSeg.createEl('button', { text: label, cls: 'rv-mode' });
            b.toggleClass('is-active', config.gradeMode === value);
            b.addEventListener('click', () => {
                config.gradeMode = value;
                gradeButtons.forEach((x, i) => x.toggleClass('is-active', gradeOptions[i]![0] === value));
            });
            gradeButtons.push(b);
        }

        const passRow = contentEl.createDiv({ cls: 'rv-config-row' });
        passRow.createEl('label', { cls: 'rv-config-label', text: 'Pass score' });
        const passSeg = passRow.createDiv({ cls: 'rv-modes' });
        const passNumber = passRow.createEl('input', {
            type: 'number',
            cls: 'rv-config-number',
            attr: { min: '0', max: '100', step: '1' },
        });
        const passOff = passSeg.createEl('button', { text: 'Off', cls: 'rv-mode' });
        const passOn = passSeg.createEl('button', { text: 'On', cls: 'rv-mode' });
        const syncPass = (): void => {
            const on = config.passScore !== 'off';
            passNumber.disabled = !on;
            passNumber.value = on ? String(config.passScore) : '80';
            passOff.toggleClass('is-active', !on);
            passOn.toggleClass('is-active', on);
        };
        passOff.addEventListener('click', () => { config.passScore = 'off'; syncPass(); });
        passOn.addEventListener('click', () => {
            config.passScore = config.passScore === 'off' ? 80 : config.passScore;
            syncPass();
        });
        passNumber.addEventListener('input', () => {
            const n = parseInt(passNumber.value, 10);
            if (Number.isFinite(n)) config.passScore = Math.max(0, Math.min(100, n));
        });
        syncPass();

        const orderRow = contentEl.createDiv({ cls: 'rv-config-row' });
        orderRow.createEl('label', { cls: 'rv-config-label', text: 'Order' });
        const orderSeg = orderRow.createDiv({ cls: 'rv-modes' });
        const orderOpts: [OrderMode, string][] = [
            ['source', 'Source'],
            ['random', 'Random'],
            ['priority', 'Priority'],
            ['priority-random', 'Priority shuffle'],
        ];
        const orderButtons: HTMLButtonElement[] = [];
        for (const [value, label] of orderOpts) {
            const b = orderSeg.createEl('button', { text: label, cls: 'rv-mode' });
            b.toggleClass('is-active', config.order === value);
            b.addEventListener('click', () => {
                config.order = value;
                orderButtons.forEach((x, i) => x.toggleClass('is-active', orderOpts[i]![0] === value));
            });
            orderButtons.push(b);
        }

        const seedRow = contentEl.createDiv({ cls: 'rv-config-row' });
        seedRow.createEl('label', { cls: 'rv-config-label', text: 'Seed' });
        const seedInput = seedRow.createEl('input', {
            type: 'number',
            cls: 'rv-config-number',
            attr: { min: '0', step: '1', value: String(config.seed) },
        });
        seedRow.createDiv({
            cls: 'rv-config-hint rv-muted',
            text: 'Keep to reproduce identical content. Change to re-shuffle the frozen pool and pick new values.',
        });
        seedInput.addEventListener('input', () => {
            const n = parseInt(seedInput.value, 10);
            config.seed = Number.isFinite(n) && n >= 0 ? n : 0;
        });

        this.timerSection = renderTimerConfigSection({
            parent: contentEl,
            config,
            presentedCount: originalLog.frozen_pool.length,
            onChange: (patch) => Object.assign(config, patch),
            showSessionWarning: false,
        });

        contentEl.createEl('p', {
            cls: 'rv-muted',
            text: `Count and trim are frozen: ${originalLog.frozen_pool.length} questions.`,
        });

        const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
        const cancel = buttons.createEl('button', { text: 'Cancel' });
        cancel.addEventListener('click', () => this.close());
        const confirm = buttons.createEl('button', {
            text: 'Start reproducible session',
            cls: 'mod-cta',
        });
        confirm.addEventListener('click', () => {
            this.confirmed = true;
            this.options.onConfirm({ ...config, count: 'all', trim: 'seq' }, this.sessionName);
            this.close();
        });
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.confirmed) this.options.onCancel?.();
    }
}
