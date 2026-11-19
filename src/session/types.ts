/** Data shapes for a playable session. No runtime code. */
import type { Question, Warning } from '../parser';
import type {
    AnswerSlotSpec,
    QuantityValue,
    ResolvedQuantityAnswer,
    TemplateSegment,
    UnitExpr,
} from '../math/units';
import type { UnitValue } from '../parser';

export type Mode = 'choice' | 'typed';

export interface Choice {
    text: string;
    correct: boolean;
    /** Which variable values produced this choice (numeric mode only). */
    note: string;
}

/** One resolved value binding. */
export interface ResolvedSlot {
    valueName: string;
    canonical: number;
    /** Display text from `fmtQuantity`. */
    text: string;
    displayScale: number;
    policy: AnswerSlotSpec;
    numericValues: number[];
}

/** One complete answer variant, resolved for this draw. */
export interface ResolvedVariant {
    index: number;
    /** Display only: original literals plus formatted values. */
    text: string;
    segments: TemplateSegment[];
    /** Canonical values in binding order. */
    vector: number[];
}

export interface ResolvedMultiValueAnswer {
    variants: ResolvedVariant[];
    correctVariantIndex: number;
    correctText: string;
    slots: ResolvedSlot[];
    vector: number[];
}

export interface SessionQuestion {
    q: Question;
    /**
     * Index into the session's frozen pool. Stable across display reorderings.
     * Used as the key for `answers`, `scratch`, `flags` in the session log.
     */
    id: number;
    /** Question text with placeholders resolved for the chosen variant. */
    text: string;
    /** Which variant of `q.variants` was shown (0-indexed). */
    variantIndex: number;
    values: Record<string, Value>;
    /** Source/display form of each definition. */
    sources: Record<string, Value>;
    choices: Choice[];
    /** Rendered correct-answer text (first kept answer block). */
    correctText: string;
    /** Numeric mode: every accepted numeric value. */
    correctNumbers?: number[];
    /** Quantity answer path: resolved value, unit policy, and display text. */
    answer?: ResolvedQuantityAnswer;
    /** Multi-value answer path. */
    multiValue?: ResolvedMultiValueAnswer;
    explanation?: string;
    /** Accepted display strings (text mode or numeric unit/form variants). */
    acceptedAnswers?: string[];
    given?: string;
    givenNote?: string;
    isCorrect?: boolean;
    /** True once the answer is locked in for this session. */
    submitted?: boolean;
    scratch?: string;
    finalDraft?: string;
    pickedIndex?: number;
    /** Set when this instance is a view-mode placeholder for a missing note. */
    missingPath?: string;
    /** Time spent on this question, when a per-question stopwatch is enabled. */
    timeSpentMs?: number;
    /** Remaining time when a countdown stopped, in milliseconds. */
    timerRemainingMs?: number;
    /** True when a hard timer forced this question to submit. */
    timerExpired?: boolean;
    /**
     * Warnings produced while building this instance (e.g. distractor
     * shortfalls). Kept off the shared parsed `Question` so a cached note is
     * never mutated by generation.
     */
    buildWarnings?: Warning[];
}

export type Value = number | string | UnitExpr | UnitValue | QuantityValue;