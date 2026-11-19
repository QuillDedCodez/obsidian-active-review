/** Unit and quantity types (Proposal 2). No runtime code. */

/** Base-unit exponents in the order `m, kg, s, A, K, mol, cd`. */
export type Dimension = readonly [number, number, number, number, number, number, number];

export type UnitNamespace = 'si' | 'abstract';

export type UnitKind = 'base' | 'derived' | 'nonSI' | 'dimensionless' | 'affine';

export interface PrefixDef {
    symbol: string;
    /** Word aliases, e.g. `kilo`, `kilo-`. */
    aliases: string[];
    /** Power of ten. */
    power: number;
}

export interface UnitDef {
    symbol: string;
    aliases: string[];
    dim: Dimension;
    /** Multiplier to the SI base unit. */
    scale: number;
    kind: UnitKind;
    namespace: UnitNamespace;
    /** Semantic tag, e.g. `force`, `resistance`, `abstract_area`. */
    quantity?: string;
    prefixable: boolean;
    /** Expanded display form, e.g. `kg*m/s^2`. */
    expansion?: string;
    /** Affine offset: `canonical = value * scale + offset`. */
    offset?: number;
    /** English/US-customary unit, allowed by `unit-mode = expanded`. */
    english?: boolean;
    /**
     * Temperature semantics. Absolute and interval temperatures never convert
     * into one another.
     */
    temperature?: 'absolute' | 'delta';
    /** ISO code when this unit is a currency. Currencies only match the same code. */
    currencyCode?: string;
}

export interface UnitFactor {
    unit: UnitDef;
    prefix?: PrefixDef;
    exponent: number;
}

export interface UnitExpr {
    factors: UnitFactor[];
    dim: Dimension;
    scale: number;
    /** Affine offset; non-zero only for a lone absolute temperature unit. */
    offset?: number;
    namespace: UnitNamespace;
}

/** A canonical SI value with a dimension and a display unit. */
export interface Quantity {
    canonical: number;
    dim: Dimension;
    displayUnit: UnitExpr;
}

export type UnitSystem = 'si' | 'abstract';
export type UnitMode = 'declared' | 'atomic' | 'expanded' | 'list' | 'dimension' | 'family';
export type DisplayMode = 'declared' | 'atomic' | 'expanded';
export type PrefixPolicy = 'any' | 'exact';
export type Notation = 'auto' | 'decimal' | 'scientific';
export type AllowedPrefixes = 'auto' | 'none' | PrefixDef[];

/** One graded answer value: a number bound to a unit/prefix/sig-fig policy. */
export interface AnswerSlotSpec {
    id: string;
    /** Definition name selected by a variable header in `rv-answer`. */
    valueName: string;
    type: 'number';
    unitSystem: UnitSystem;
    unit: UnitExpr;
    unitLabel?: string;
    unitMode: UnitMode;
    acceptUnits?: UnitExpr[];
    display: DisplayMode;
    sourceUnit?: UnitExpr;
    /** Set when a dynamic source prefix is resolved per draw. */
    sourcePrefixRef?: string;
    sourcePrefix?: PrefixDef;
    /** Set when a dynamic prefix is resolved per draw. */
    prefixRef?: string;
    prefix?: PrefixDef;
    prefixPolicy: PrefixPolicy;
    allowedPrefixes: AllowedPrefixes;
    precision?: PrecisionPolicy;
    /**
     * Compound presentation: decompose the value into these units, in
     * descending order (`ft, in`). Requires a decimals precision band.
     */
    components?: UnitExpr[];
    /**
     * Display constraint: the mantissa may keep at most this many integer
     * digits. Values that do not fit use an SI prefix when one fits, otherwise
     * scientific notation.
     */
    maxIntegerDigits?: number;
    notation: Notation;
    unitOptional: boolean;
    /** ISO currency code declared with `rv-currency`; labels must match it exactly. */
    currency?: string;
    /** Render integer digits with thousands separators (`1,000`). */
    groupThousands?: boolean;
    tol: number;
    relTol: number;
}

export interface AnswerSpec {
    kind: 'scalar' | 'prose';
    slots: AnswerSlotSpec[];
    variants: AnswerVariantSpec[];
    typedMode: TypedMode;
    /** Values-only separator; default `,`. */
    sep: string;
    distractorStrategy: DistractorStrategy;
    raw: string;
}

export type TypedMode = 'values' | 'prose' | 'either';
export type DistractorStrategy = 'variable' | 'one-value' | 'author';

/**
 * Accepted precision band for one value.
 *
 * - `sigfigs`: relative precision; the band is scale-invariant.
 * - `decimals`: digits after the point **as written**, so scientific notation
 *   keeps its mantissa precision (Proposal 2 revision 2).
 *
 * The band is a tolerance/display range: `min` sets the grading tolerance,
 * `max` sets the displayed precision. The student's written digit count is not
 * enforced.
 */
export type PrecisionPolicy =
    | { kind: 'sigfigs'; min: number; max: number }
    | { kind: 'decimals'; min: number; max: number };

/** One piece of an answer variant: literal text or a bound value. */
export type TemplateSegment =
    | { kind: 'literal'; text: string }
    | { kind: 'value'; valueName: string };

export interface AnswerVariantSpec {
    /** Source block, for diagnostics. */
    raw: string;
    segments: TemplateSegment[];
    /** Distinct value names used by this variant. */
    required: string[];
    /** Concatenated literal segments, for diagnostics and weak-anchor checks. */
    literalText: string;
}

/** A quantity produced by a definition. Display fields are metadata, not grading. */
export interface QuantityValue {
    /** Canonical value in SI/abstract base units. */
    canonical: number;
    /** Declared unit expression, without any global display prefix. */
    unit: UnitExpr;
    /** Global display prefix, applied to the whole unit expression. */
    prefix?: PrefixDef;
    /** Optional display label, e.g. "square units". */
    label?: string;
}

/** A resolved quantity answer for one draw. */
export interface ResolvedQuantityAnswer {
    canonical: number;
    unit: UnitExpr;
    /** Policy actually used, with dynamic prefixes resolved. */
    policy: AnswerSlotSpec;
    displayPrefix?: PrefixDef;
    displayScale: number;
    /** Display text only; never used for comparison. */
    text: string;
    /** Canonical values for the distractor chain. */
    numericValues: number[];
}
