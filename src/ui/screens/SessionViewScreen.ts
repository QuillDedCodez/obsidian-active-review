/** Read-only session view screen — header with display toggle and sticky nav. */
import type { App, Component } from 'obsidian';
import type { SessionQuestion } from '../../session';
import { sessionLabel, statusLabel, type SessionLogState } from '../../vault/sessionLog';
import { renderQuestionCard } from '../QuestionCard';
import { ChoiceLayoutController } from '../ChoiceLayout';

export interface SessionViewScreenProps {
    app: App;
    component: Component;
    root: HTMLElement;
    log: SessionLogState;
    items: SessionQuestion[];
    flags: number[];
    allowFlag: boolean;
    displayMode: 'all' | 'one';
    currentIndex: number;
    onDisplayModeChange: (mode: 'all' | 'one') => void;
    onShowDetails: () => void;
    onPrev: () => void;
    onNext: () => void;
    onBack: () => void;
}

export interface SessionViewScreenHandle {
    destroy(): void;
}

export function renderSessionViewScreen(props: SessionViewScreenProps): SessionViewScreenHandle {
    props.root.empty();
    props.root.removeClass('rv-start-mode');
    const choiceLayout = new ChoiceLayoutController();

    // ---------- header ----------
    const head = props.root.createDiv({ cls: 'rv-head' });
    const headRow = head.createDiv({ cls: 'rv-head-row' });

    const back = headRow.createEl('button', { cls: 'rv-back' });
    back.createSpan({ text: '←' });
    back.createSpan({ text: ' Back' });
    back.addEventListener('click', () => props.onBack());

    const headActions = headRow.createDiv({ cls: 'rv-head-actions' });
    const toggle = headActions.createDiv({ cls: 'rv-display-toggle' });
    const mkToggleBtn = (label: string, value: 'all' | 'one'): HTMLButtonElement => {
        const b = toggle.createEl('button', { text: label });
        b.toggleClass('is-active', props.displayMode === value);
        b.addEventListener('click', () => {
            if (props.displayMode !== value) props.onDisplayModeChange(value);
        });
        return b;
    };
    mkToggleBtn('All questions', 'all');
    mkToggleBtn('One at a time', 'one');

    const details = headActions.createEl('button', {
        cls: 'rv-back rv-session-details-btn',
        text: 'Session details',
        attr: { type: 'button' },
    });
    details.addEventListener('click', () => props.onShowDetails());

    const answeredCount = props.items.filter((i) => i.submitted === true).length;
    const score = props.items.filter((i) => i.isCorrect).length;
    const missingCount = props.items.filter((i) => i.missingPath).length;

    const seedText =
        props.log.qs_snapshot.order !== 'source' || props.log.qs_snapshot.trim === 'rand'
            ? ` · Seed ${props.log.qs_snapshot.seed}`
            : '';
    const missingText = missingCount > 0 ? ` · Missing ${missingCount}` : '';
    const flagText = props.log.flags.length > 0 ? ` · Flags ${props.log.flags.length}` : '';

    const statusEl = head.createDiv({ cls: 'rv-status' });
    statusEl.createSpan({
        cls: `rv-session-status rv-status-${props.log.status}`,
        text: statusLabel(props.log.status),
    });
    statusEl.createSpan({
        text: ` ${sessionLabel(props.log)} · Submitted ${answeredCount}/${props.items.length} · Score ${score}${seedText}${missingText}${flagText}`,
    });

    const barEl = head.createDiv({ cls: 'rv-bar' }).createDiv({ cls: 'rv-bar-fill' });
    barEl.setCssProps({
        '--rv-progress': `${props.items.length > 0 ? (answeredCount / props.items.length) * 100 : 0}%`,
    });

    // ---------- sticky nav row (one-at-a-time only) ----------
    if (props.displayMode === 'one') {
        const idx = Math.max(0, Math.min(props.currentIndex, props.items.length - 1));
        const nav = head.createDiv({ cls: 'rv-nav-row' });
        const prev = nav.createEl('button', { text: '← Previous', cls: 'rv-nav' });
        prev.disabled = idx === 0;
        prev.addEventListener('click', () => props.onPrev());
        const next = nav.createEl('button', { text: 'Next →', cls: 'rv-nav' });
        next.disabled = idx === props.items.length - 1;
        next.addEventListener('click', () => props.onNext());
    }

    // ---------- body ----------
    const body = props.root.createDiv({ cls: 'rv-body' });
    if (props.items.length > 100) body.addClass('rv-streaming-cards');

    if (props.displayMode === 'one') {
        const idx = Math.max(0, Math.min(props.currentIndex, props.items.length - 1));
        const sq = props.items[idx];
        if (sq) {
            renderQuestionCard({
                app: props.app,
                component: props.component,
                parent: body,
                sq,
                index: idx,
                mode: props.log.mode,
                choiceLayout,
                onAnswer: () => {},
                readOnly: true,
                flagged: props.flags.includes(sq.id),
                allowFlag: props.allowFlag,
            });
        }
    } else {
        props.items.forEach((sq, i) => {
            renderQuestionCard({
                app: props.app,
                component: props.component,
                parent: body,
                sq,
                index: i,
                mode: props.log.mode,
                choiceLayout,
                onAnswer: () => {},
                readOnly: true,
                flagged: props.flags.includes(sq.id),
                allowFlag: props.allowFlag,
            });
        });
    }

    return {
        destroy: () => {
            choiceLayout.destroy();
            // Read-only — no editors to destroy
        },
    };
}