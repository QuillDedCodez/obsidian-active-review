/** One question card. In readOnly mode renders as a static reveal. */
import type { App, Component } from 'obsidian';
import type { GradeMode, SubmitMode } from '../constants';
import { grade, hasChoices, type Mode, type SessionQuestion } from '../session';
import { EditorMount, renderMarkdown, renderMarkdownLazy } from './MarkdownEditor';
import type { ChoiceLayoutController } from './ChoiceLayout';

export interface QuestionCardProps {
    app: App;
    component: Component;
    parent: HTMLElement;
    sq: SessionQuestion;
    index: number;
    mode: Mode;
    choiceLayout: ChoiceLayoutController;
    onAnswer: () => void;
    onFlush?: () => void;
    registerEditor?: (mount: EditorMount) => void;
    /** View mode: read-only reveal. */
    readOnly?: boolean;
    /** Phase 5: how answers are locked in. Default SubmitAny. */
    submitMode?: SubmitMode;
    /** Phase 5: when feedback is revealed. Default Immediate. */
    gradeMode?: GradeMode;
    /** Called when a choice or draft changes before submission. */
    onStateChange?: () => void;
    /** True when every card is submitted and Grade = After all. */
    revealSubmitted?: boolean;
    /** Live session: this card is flagged. */
    flagged?: boolean;
    /** Live session: show the flag control when true. */
    allowFlag?: boolean;
    /** Live session: toggle this card's flag. */
    onToggleFlag?: () => void;
    /** Live session: a choice was picked or deselected (before submission). */
    onPick?: (id: number, picked: number | undefined) => void;
    /** Live session: the typed final answer changed. */
    onDraft?: (id: number, value: string) => void;
    /** Live session: the scratch note changed. */
    onScratch?: (id: number, value: string) => void;
    /** Live session: this card was submitted and graded. */
    onSubmit?: (id: number) => void;
}

export interface QuestionCardHandle {
    hasAnswer(): boolean;
    submit(): void;
    reveal(): void;
    isSubmitted(): boolean;
    setTimer(
        timer: { text: string; warning: boolean } | null,
        stopwatch: string | null,
    ): void;
    expire(): void;
    /** Apply a choice picked in another tab. */
    setPicked(picked: number | undefined): void;
    /** Apply a final answer typed in another tab. */
    setDraft(value: string): void;
    /** Apply a scratch note typed in another tab. */
    setScratch(value: string): void;
    /** Apply a submission/grading result from another tab or the timer. */
    applySubmitted(): void;
    /** Apply a flag change from another tab. */
    setFlagged(flagged: boolean): void;
}

// ============================================================================
// Choice grid (inlined from ChoiceAnswer.ts)
// ============================================================================

/** Renders the two-column choice grid; returns handles the card uses to grade. */
export interface ChoiceAnswerProps {
    app: App;
    component: Component;
    card: HTMLElement;
    before: HTMLElement;
    sq: SessionQuestion;
    submit: HTMLButtonElement;
    choiceLayout: ChoiceLayoutController;
    /** Previously-picked choice index when the question is already answered. */
    initialPicked?: number;
    /** When true, buttons render disabled and cannot be picked. */
    initialDisabled?: boolean;
    /** Called whenever the selected choice changes (-1 = none). */
    onPick?: (picked: number) => void;
}

export interface ChoiceAnswerHandle {
    getPicked(): number;
    setPicked(picked: number): void;
    reveal(): void;
    lock(): void;
}

/**
 * Register the grid with the screen's shared layout controller. The controller
 * owns observation, visibility checks, and debounced measurement, so hundreds
 * of cards do not each install their own listener/observer stack.
 */
function wireChoiceLayout(
    list: HTMLElement,
    choiceLayout: ChoiceLayoutController,
): void {
    const texts = Array.from(
        list.querySelectorAll<HTMLElement>(':scope > .rv-choice > .rv-md'),
    );
    choiceLayout.observe(list, texts);
}

export function renderChoiceAnswer(props: ChoiceAnswerProps): ChoiceAnswerHandle {
    let picked = props.initialPicked ?? -1;
    const list = props.card.createDiv({ cls: 'rv-choices' });
    const btns: HTMLButtonElement[] = [];
    props.sq.choices.forEach((c, ci) => {
        const b = list.createEl('button', { cls: 'rv-choice' });
        b.createSpan({ cls: 'rv-letter', text: String.fromCharCode(65 + ci) });
        const textEl = b.createDiv({ cls: 'rv-choice-text' });
        // Multi-line markdown (including paragraph breaks and LaTeX blocks)
        // renders via MarkdownRenderer — see Stage 6 §4.2 (B36).
        renderMarkdownLazy(
            props.app,
            props.component,
            textEl,
            c.text,
            props.sq.q.path,
            () => props.choiceLayout.markDirty(textEl),
        );

        if (props.initialDisabled) {
            b.disabled = true;
            if (ci === picked) b.addClass('is-picked');
        } else {
            if (ci === picked) b.addClass('is-picked');
            b.setAttr('aria-pressed', String(ci === picked));
            let isSelecting = false;
            b.addEventListener('mousedown', () => { isSelecting = false; });
            b.addEventListener('mousemove', (e) => { if (e.buttons === 1) isSelecting = true; });

            b.addEventListener('click', () => {
                if (isSelecting) return;
                picked = picked === ci ? -1 : ci;
                btns.forEach((x, xi) => {
                    x.toggleClass('is-picked', xi === picked);
                    x.setAttr('aria-pressed', String(xi === picked));
                });
                props.submit.disabled = picked < 0;
                props.onPick?.(picked);
            });
        }
        btns.push(b);
    });
    props.card.insertBefore(list, props.before);
    wireChoiceLayout(list, props.choiceLayout);

    return {
        getPicked: () => picked,
        setPicked: (next: number) => {
            picked = next;
            btns.forEach((b, bi) => {
                b.toggleClass('is-picked', bi === picked);
                b.setAttr('aria-pressed', String(bi === picked));
            });
        },
        reveal: () => {
            btns.forEach((b, bi) => {
                b.disabled = true;
                if (props.sq.choices[bi]?.correct) b.addClass('is-correct');
                else if (bi === picked) b.addClass('is-wrong');
            });
        },
        lock: () => {
            btns.forEach((b) => { b.disabled = true; });
        },
    };
}

function renderMissingCard(props: QuestionCardProps, path: string): void {
    const card = props.parent.createDiv({ cls: 'rv-card rv-card-missing' });
    const top = card.createDiv({ cls: 'rv-card-top' });
    top.createSpan({ cls: 'rv-num', text: String(props.index + 1) });
    top.createSpan({ cls: 'rv-src', text: 'Missing note' });
    card.createEl('p', { cls: 'rv-muted', text: 'This note is no longer in the vault.' });
    card.createEl('p', { cls: 'rv-missing-path', text: path });
}

export function renderQuestionCard(props: QuestionCardProps): QuestionCardHandle {
    const missingPath = props.sq.missingPath;
    if (missingPath) {
        renderMissingCard(props, missingPath);
        return {
            hasAnswer: () => false,
            submit: () => {},
            reveal: () => {},
            isSubmitted: () => false,
            setTimer: () => {},
            expire: () => {},
            setPicked: () => {},
            setDraft: () => {},
            setScratch: () => {},
            applySubmitted: () => {},
            setFlagged: () => {},
        };
    }

    const readOnly = props.readOnly === true;
    const submitMode: SubmitMode = props.submitMode ?? 'any';
    const gradeMode: GradeMode = props.gradeMode ?? 'immediate';
    const submitted = props.sq.submitted === true;
    const graded = props.sq.isCorrect !== undefined;
    const answered = submitted || graded;
    const revealSubmitted = props.revealSubmitted === true;
    const revealAllowed = readOnly || gradeMode === 'immediate' || revealSubmitted;
    const isNumeric = props.sq.q.answerMode === 'numeric';

    const card = props.parent.createDiv({ cls: 'rv-card' });
    const top = card.createDiv({ cls: 'rv-card-top' });
    top.createSpan({ cls: 'rv-num', text: String(props.index + 1) });
    top.createSpan({ cls: 'rv-src', text: props.sq.q.title });
    if (props.sq.q.category.length > 0) {
        top.createDiv({ cls: 'rv-breadcrumb', text: props.sq.q.category.join(' > ') });
    }
    let cardFlagged = props.flagged === true;
    let flagButton: HTMLButtonElement | null = null;
    const applyFlagVisual = (): void => {
        if (!flagButton) return;
        flagButton.setText(cardFlagged ? 'Flagged' : 'Flag');
        flagButton.toggleClass('is-flagged', cardFlagged);
        flagButton.setAttr('aria-pressed', String(cardFlagged));
        flagButton.setAttr(
            'title',
            cardFlagged ? 'Remove review flag' : 'Flag for review',
        );
    };
    if (props.flagged === true && props.onToggleFlag === undefined) {
        top.createSpan({
            cls: 'rv-flag-badge is-flagged',
            text: 'Flagged',
            attr: { title: 'Flagged for review' },
        });
    } else if (props.allowFlag === true && props.onToggleFlag) {
        flagButton = top.createEl('button', {
            cls: 'rv-flag-button',
            attr: { type: 'button' },
        });
        applyFlagVisual();
        flagButton.addEventListener('click', () => {
            cardFlagged = !cardFlagged;
            applyFlagVisual();
            props.onToggleFlag?.();
        });
    }
    const timersEl = top.createDiv({ cls: 'rv-q-timers' });
    const qTimerEl = timersEl.createSpan({ cls: 'rv-q-timer rv-hidden' });
    const qStopwatchEl = timersEl.createSpan({ cls: 'rv-q-stopwatch rv-hidden' });
    const setTimer = (
        timer: { text: string; warning: boolean } | null,
        stopwatch: string | null,
    ): void => {
        if (timer) {
            qTimerEl.setText(`Timer ${timer.text}`);
            qTimerEl.removeClass('rv-hidden');
            qTimerEl.toggleClass('is-warning', timer.warning);
        } else {
            qTimerEl.addClass('rv-hidden');
        }
        if (stopwatch) {
            qStopwatchEl.setText(`Stopwatch ${stopwatch}`);
            qStopwatchEl.removeClass('rv-hidden');
        } else {
            qStopwatchEl.addClass('rv-hidden');
        }
    };
    renderMarkdownLazy(props.app, props.component, card.createDiv({ cls: 'rv-q' }), props.sq.text, props.sq.q.path);

    // ---------- scratch ----------
    card.createEl('h4', { cls: 'rv-section-label', text: 'Scratch' });
    const scratchMount = new EditorMount({
        app: props.app,
        component: props.component,
        host: card.createDiv({ cls: 'rv-scratch' }),
        initialValue: props.sq.scratch ?? '',
        placeholder: 'Working, calculations, notes',
        onChange: (v) => {
            props.sq.scratch = v;
            props.onScratch?.(props.sq.id, v);
        },
        onBlur: () => props.onFlush?.(),
        readOnly,
    });
    if (!readOnly) props.registerEditor?.(scratchMount);

    const submitRow = card.createDiv({ cls: 'rv-submit-row' });
    const submit = submitRow.createEl('button', { text: 'Submit answer', cls: 'mod-cta rv-submit' });
    submit.disabled = true;

    const hasChoice = props.mode === 'choice' && hasChoices(props.sq);
    const autoChoice = submitMode === 'auto' && hasChoice;
    const recordedPick = !submitted && !graded && props.sq.pickedIndex !== undefined;
    const showPerCardSubmit =
        !readOnly &&
        submitMode !== 'all' &&
        (!autoChoice || recordedPick);
    if (!showPerCardSubmit || answered) submit.addClass('rv-hidden');

    const feedback = card.createDiv({ cls: 'rv-feedback rv-hidden' });
    let explanationDetails: HTMLDetailsElement | null = null;
    if (props.sq.explanation) {
        explanationDetails = card.createEl('details', { cls: 'rv-explanation rv-hidden' });
        explanationDetails.createEl('summary', { text: 'Explanation', cls: 'rv-explanation-summary' });
        const content = explanationDetails.createDiv({
            cls: 'rv-explanation-content markdown-preview-view markdown-rendered',
        });
        renderMarkdownLazy(props.app, props.component, content, props.sq.explanation, props.sq.q.path);
    }

    const showFeedback = (ok: boolean): void => {
        feedback.empty();
        feedback.removeClass('rv-hidden');
        feedback.removeClass('is-correct');
        feedback.removeClass('is-wrong');
        feedback.addClass(ok ? 'is-correct' : 'is-wrong');
        if (ok) {
            feedback.createSpan({ text: 'Correct.' });
        } else {
            feedback.createSpan({ text: 'Incorrect. Correct answer: ' });
            renderMarkdown(props.app, props.component, feedback.createSpan(), props.sq.correctText, props.sq.q.path);
            if (isNumeric && props.sq.givenNote) {
                const hint = feedback.createDiv({ cls: 'rv-provenance' });
                hint.createSpan({ text: 'That choice assumed: ' });
                hint.createSpan({ cls: 'rv-provenance-value', text: props.sq.givenNote });
            }
        }
        if (explanationDetails) {
            explanationDetails.removeClass('rv-hidden');
            explanationDetails.open = !ok;
        }
    };

    let choiceHandle: ReturnType<typeof renderChoiceAnswer> | null = null;
    let answerMount: EditorMount | null = null;

    const reveal = (): void => {
        if (props.sq.isCorrect === undefined) return;
        showFeedback(props.sq.isCorrect);
        choiceHandle?.reveal();
        if (answerMount) answerMount.setCorrectness(props.sq.isCorrect);
    };

    const finish = (ok: boolean, given: string, note?: string, pickedIndex?: number): void => {
        props.sq.given = given;
        props.sq.givenNote = note;
        props.sq.pickedIndex = pickedIndex;
        props.sq.isCorrect = ok;
        props.sq.submitted = true;
        submit.addClass('rv-hidden');
        if (answerMount) answerMount.lock(revealAllowed ? ok : undefined);
        if (revealAllowed) {
            showFeedback(ok);
            choiceHandle?.reveal();
        } else {
            choiceHandle?.lock();
        }
        props.onSubmit?.(props.sq.id);
        props.onAnswer();
        props.onStateChange?.();
    };

    /** Apply a submission made in another tab or by the shared timer. */
    const applySubmitted = (): void => {
        if (props.sq.submitted !== true) return;
        submit.addClass('rv-hidden');
        if (answerMount) {
            answerMount.lock(revealAllowed ? props.sq.isCorrect : undefined);
        }
        if (revealAllowed) {
            if (props.sq.isCorrect !== undefined) showFeedback(props.sq.isCorrect);
            choiceHandle?.reveal();
        } else {
            choiceHandle?.lock();
        }
    };

    const expire = (): void => {
        if (props.sq.submitted === true) return;
        props.sq.timerExpired = true;
        finish(false, '', undefined);
    };

    const submitCurrent = (): void => {
        if (props.sq.submitted === true) return;
        if (choiceHandle) {
            const picked = choiceHandle.getPicked();
            if (picked < 0) return;
            finish(
                grade(props.sq, { choice: picked }),
                props.sq.choices[picked]?.text ?? '',
                props.sq.choices[picked]?.note,
                picked,
            );
        } else if (answerMount) {
            const typed = answerMount.getValue();
            if (typed.trim() === '') return;
            finish(grade(props.sq, { typed }), typed);
        }
    };

    const hasAnswer = (): boolean => {
        if (props.sq.submitted === true || props.sq.isCorrect !== undefined) return true;
        if (choiceHandle) return choiceHandle.getPicked() >= 0;
        if (answerMount) return answerMount.getValue().trim() !== '';
        return false;
    };

    if (hasChoice) {
        const answerLabel = card.createEl('h4', { cls: 'rv-section-label', text: 'Answer' });
        card.insertBefore(answerLabel, submitRow);
        choiceHandle = renderChoiceAnswer({
            app: props.app,
            component: props.component,
            card,
            before: submitRow,
            sq: props.sq,
            submit,
            choiceLayout: props.choiceLayout,
            initialPicked: props.sq.pickedIndex,
            initialDisabled: answered || readOnly,
            onPick: (picked) => {
                props.sq.pickedIndex = picked >= 0 ? picked : undefined;
                props.onPick?.(props.sq.id, props.sq.pickedIndex);
                props.onStateChange?.();
                if (submitMode === 'auto' && picked >= 0) {
                    submitCurrent();
                } else if (!answered) {
                    props.onFlush?.();
                }
            },
        });
        if (answered) {
            if (revealAllowed) choiceHandle.reveal();
            else choiceHandle.lock();
        } else if (!readOnly && showPerCardSubmit) {
            submit.disabled = choiceHandle.getPicked() < 0;
            submit.addEventListener('click', () => submitCurrent());
        }
    } else {
        const answerLabel = card.createEl('h4', { cls: 'rv-section-label', text: 'Final answer' });
        card.insertBefore(answerLabel, submitRow);
        const answerHost = card.createDiv({ cls: 'rv-final-answer' });
        card.insertBefore(answerHost, submitRow);

        const numericMode = isNumeric && props.sq.correctNumbers !== undefined && props.sq.correctNumbers.length > 0;
        const multiValueMode = props.sq.multiValue !== undefined;
        const quantityMode = props.sq.answer !== undefined;
        const quantityHint = multiValueMode
            ? props.sq.q.answerSpec?.typedMode === 'values'
                ? 'One value per answer, in order'
                : 'Type the values or the full answer'
            : quantityMode
              ? props.sq.answer?.policy.unitOptional === false
                  ? 'Type a value with a unit'
                  : 'Type a value, with or without a unit'
              : undefined;

        answerMount = new EditorMount({
            app: props.app,
            component: props.component,
            host: answerHost,
            initialValue: props.sq.finalDraft ?? props.sq.given ?? '',
            placeholder: quantityHint
                ? quantityHint
                : numericMode
                  ? 'Type a number or number with unit'
                  : 'Type your answer',
            onChange: (v) => {
                props.sq.finalDraft = v;
                props.onDraft?.(props.sq.id, v);
                if (!answered && !readOnly) submit.disabled = v.trim() === '';
                props.onStateChange?.();
            },
            onBlur: () => props.onFlush?.(),
            initialDisabled: answered,
            readOnly,
            initialOk: revealAllowed ? props.sq.isCorrect : undefined,
            // Quantities and prose accept units, notation, and separators, so a
            // decimal-only keyboard would block a correct answer.
            inputMode: numericMode && !quantityMode && !multiValueMode ? 'decimal' : 'text',
        });
        if (!readOnly) props.registerEditor?.(answerMount);
        if (!answered && !readOnly && (props.sq.finalDraft ?? '').trim() !== '') submit.disabled = false;

        if (!answered && !readOnly && showPerCardSubmit) {
            submit.addEventListener('click', () => submitCurrent());
        }
    }

    // ---------- final state (session mode vs view mode) ----------
    if (readOnly) {
        submit.addClass('rv-hidden');
        if (graded) {
            reveal();
        } else if (submitted) {
            feedback.empty();
            feedback.removeClass('rv-hidden');
            feedback.addClass('rv-pending');
            feedback.createSpan({ text: 'Submitted — awaiting grade.' });
            choiceHandle?.lock();
        } else {
            feedback.empty();
            feedback.removeClass('rv-hidden');
            feedback.addClass('rv-pending');
            feedback.createSpan({ text: 'Not answered yet.' });
        }
    } else if (answered) {
        submit.addClass('rv-hidden');
        if (revealAllowed) reveal();
    }

    return {
        hasAnswer,
        submit: submitCurrent,
        reveal,
        isSubmitted: () => props.sq.submitted === true,
        setTimer,
        expire,
        setPicked: (picked) => {
            const next = picked ?? -1;
            choiceHandle?.setPicked(next);
            if (!answered && !readOnly && showPerCardSubmit) {
                submit.disabled = next < 0;
            }
            props.onStateChange?.();
        },
        setDraft: (value) => {
            if (props.sq.submitted === true) return;
            answerMount?.setValue(value);
            if (!answered && !readOnly) submit.disabled = value.trim() === '';
            props.onStateChange?.();
        },
        setScratch: (value) => {
            scratchMount.setValue(value);
        },
        applySubmitted,
        setFlagged: (next) => {
            cardFlagged = next;
            applyFlagVisual();
        },
    };
}
