/** Data shapes shared by the parser and its callers. No runtime code. */
import type { AnswerSpec, PrefixDef, QuantityValue, UnitExpr } from '../math/units';

export type VarValueType = 'number' | 'string' | 'prefix' | 'unit' | 'quantity';

/** A value carried by a definition or a drawn pick element. */
export interface UnitValue {
    unit: UnitExpr;
    prefix?: PrefixDef;
}

export type VarValue = number | string | UnitExpr | UnitValue | QuantityValue;

/** The parts of a `value ; prefix ; unit` declaration. */
export interface QuantityDef {
    /** Numeric/expression source for the magnitude. */
    valueExpr: string;
    /** Precomputed fixed magnitude, when the source is a literal. */
    fixedValue?: number;
    /** Prefix symbol or prefix variable name. */
    prefix?: string;
    prefixRef?: string;
    /** Unit expression or unit variable name. */
    unit?: UnitExpr;
    unitRef?: string;
}

export interface VarDef {
    name: string;
    first: number;
    last: number;
    step: number;
    fixed: boolean;
    /** Raw RHS source text (for `expr` and `display` kinds). */
    expr?: string;
    kind:
        | 'rand'
        | 'pick'
        | 'stringPick'
        | 'exprPick'
        | 'fixed'
        | 'expr'
        | 'display'
        | 'unit'
        | 'prefix'
        | 'quantity'
        | 'quantityPick';
    /** The value type produced by this definition. Defaults to `number`. */
    valueType?: VarValueType;
    /** Names referenced by the RHS, used by the distractor dependency walker. */
    dependencies?: string[];
    /** Drawn values for pick-like definitions, or static values otherwise. */
    values?: VarValue[];
    /** Per-value display sources for string picks, e.g. `\text{force}`. */
    valueSources?: string[];
    /** [v2] Cap on how many values a rand() can produce per session. */
    max_index?: number;
    /** Display-only variables: marker-wrapped source, built at parse time. */
    displaySource?: string;
    /** Quantity construction metadata for `kind = quantity`. */
    quantity?: QuantityDef;
    /** Prefix/unit metadata for unit picks. */
    prefixValues?: (PrefixDef | undefined)[];
}

export interface DistractorLink {
    targets: string[];
    anchor: string;
}

export type CategorySource = 'folder' | 'frontmatter' | 'none';

export type WarningSection =
    | 'definitions'
    | 'questions'
    | 'answers'
    | 'distractors'
    | 'explanations'
    | 'general';

export interface Warning {
    section: WarningSection;
    message: string;
}

interface Base {
    path: string;
    title: string;
    variants: string[];
    explanation?: string;
    category: string[];
    categorySource: CategorySource;
    declaredCategory: string[];
    warnings: Warning[];
    ignoredWarnings: Set<string>;
    /** Sections whose header carried `<!--debug-called-definitions-->`. */
    literalSections: Set<string>;
}

export interface Question extends Base {
    answerMode: 'numeric' | 'text';
    /** Set when the note carries an `rv-answer` fence. Absent = numeric/text path. */
    answerFormat?: 'quantity' | 'prose';
    answerSpec?: AnswerSpec;
    answerBlocks: string[];
    /** Numeric-mode display blocks; same as answerBlocks when all are numeric. */
    numericAnswerBlocks: string[];
    distractorBlocks: string[];
    vars: VarDef[];
    /**
     * `link()` groups, stored as written: a plain definition name or `-name`
     * for a flipped member (mirrors the shared draw index). The first member
     * sets the index and is never flipped; see `linkName`/`isFlipped`.
     */
    links: string[][];
    answerName: string;
    answerValNames: string[];
    /** `rv-distract` links: targets are conditioned from an anchor definition. */
    distractorLinks?: DistractorLink[];
    /**
     * Author-declared priority from `rv-priority` frontmatter. Lower = reviewed
     * first. Defaults to 100 when absent. Phase 2 uses this for ordering modes.
     */
    priority: number;
}