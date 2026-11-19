/** Quantity formatting (Proposal 2 §8). */
import { currencyCodeOfUnit, toCurrencyCode } from './currency';
import { latexUnitText } from '../latex';
import { SI_PREFIXES, prefixScale } from './prefixes';
import {
    atomOf,
    describeUnit,
    describeUnitLatex,
    describeUnitWithPrefix,
    fromCanonical,
    namedUnitFor,
    parseUnitExpr,
} from './parseUnit';
import type {
    AllowedPrefixes,
    AnswerSlotSpec,
    Notation,
    PrecisionPolicy,
    PrefixDef,
    UnitExpr,
    UnitFactor,
} from './types';

const LOG10 = Math.log(10);

/** Rendering context. `math` wraps unit/prefix text in `\text{…}`. */
export interface FormatOptions {
    math?: boolean;
}

function exponentOf(x: number): number {
    return x === 0 ? 0 : Math.floor(Math.log(Math.abs(x)) / LOG10);
}

/** Round to `S` significant figures. */
export function roundSig(x: number, S: number): number {
    if (x === 0) return 0;
    const e = exponentOf(x);
    const f = Math.pow(10, S - 1 - e);
    return Math.sign(x) * (Math.round(Math.abs(x) * f) / f);
}

/** Truncate toward zero at `S` significant figures (deviation candidates). */
export function truncateSig(x: number, S: number): number {
    if (x === 0) return 0;
    const e = exponentOf(x);
    const f = Math.pow(10, S - 1 - e);
    return Math.trunc(x * f) / f;
}

/** Value of the last displayed digit, for the display grid. */
export function ulp(x: number, S: number, zeroTol: number): number {
    if (x === 0) return zeroTol > 0 ? zeroTol : 1e-3;
    const e = exponentOf(x);
    return Math.pow(10, e - S + 1);
}

function trimFloat(x: number): string {
    const s = String(Number(x.toPrecision(12)));
    return s === '-0' ? '0' : s;
}

function decimalString(x: number, S: number | undefined): string {
    if (!Number.isFinite(x)) return String(x);
    if (x === 0) return '0';
    if (S === undefined) return trimFloat(x);
    const e = exponentOf(x);
    const decimals = S - 1 - e;
    if (decimals >= 0) return x.toFixed(Math.min(decimals, 20));
    // Too large for a decimal mantissa: keep the magnitude, sig figs implied.
    return trimFloat(Number(x.toPrecision(S)));
}

function scientificString(x: number, S: number | undefined): string {
    if (!Number.isFinite(x)) return String(x);
    if (x === 0) {
        return S === undefined
            ? '0 × 10^0'
            : `${(0).toFixed(Math.max(0, (S ?? 1) - 1))} × 10^0`;
    }
    const e = exponentOf(x);
    const mantissa = x / Math.pow(10, e);
    const m = S === undefined ? trimFloat(mantissa) : mantissa.toFixed(Math.max(0, S - 1));
    return `${m} × 10^${e}`;
}

/** Display a number in the requested notation, preserving `S` sig figs. */
export function formatNumber(x: number, S: number | undefined, notation: Notation): string {
    if (!Number.isFinite(x)) return String(x);
    const useScientific =
        notation === 'scientific' ||
        (notation === 'auto' && (exponentOf(x) < -3 || exponentOf(x) >= 4));
    if (useScientific && x !== 0) return scientificString(x, S);
    return decimalString(x, S);
}

/**
 * Display with a fixed number of **decimal places**, counted as written.
 * Retained for callers that only need a number; `fmtQuantity` uses the shared
 * layout so grading tolerance matches what is shown.
 */
export function formatDecimalPlaces(
    x: number,
    decimals: number,
    notation: Notation,
): string {
    if (!Number.isFinite(x)) return String(x);
    const places = Math.max(0, Math.min(20, Math.trunc(decimals)));
    if (x === 0) return (0).toFixed(places);

    const e = exponentOf(x);
    const useScientific =
        notation === 'scientific' || (notation === 'auto' && (e < -places || e > 8));

    if (useScientific) {
        const mantissa = x / Math.pow(10, e);
        return `${mantissa.toFixed(places)} × 10^${e}`;
    }
    const fixed = x.toFixed(places);
    return fixed === `-${(0).toFixed(places)}` ? (0).toFixed(places) : fixed;
}

/** Round one number to the band's displayed precision. */
function roundForPrecision(x: number, policy: AnswerSlotSpec): number {
    const precision = policy.precision;
    if (precision?.kind === 'sigfigs') return roundSig(x, precision.min);
    if (precision?.kind === 'decimals') {
        const factor = Math.pow(10, precision.min);
        return Math.round(x * factor) / factor;
    }
    return x;
}

/** Render an already-rounded mantissa, preserving trailing zeros. */
function mantissaText(x: number, policy: AnswerSlotSpec): string {
    if (policy.precision !== undefined) {
        return digitsFor(x, {
            kind: policy.precision.kind,
            min: policy.precision.min,
            max: policy.precision.min,
        });
    }
    return trimFloat(x);
}

/**
 * The digits a mantissa shows at a given precision. Two values agree when they
 * produce the same string, which is how grading compares them — no epsilon.
 */
export function digitsFor(mantissa: number, precision: PrecisionPolicy): string {
    if (precision.kind === 'sigfigs') {
        return decimalString(roundSig(mantissa, precision.max), precision.max);
    }
    const places = Math.max(0, Math.min(20, Math.trunc(precision.max)));
    const factor = Math.pow(10, places);
    const rounded = Math.round(mantissa * factor) / factor;
    const fixed = (Object.is(rounded, -0) ? 0 : rounded).toFixed(places);
    return fixed === `-${(0).toFixed(places)}` ? (0).toFixed(places) : fixed;
}

/** Integer digits allowed in the mantissa, from `notation` / `max-integer-digits`. */
function mantissaCap(policy: AnswerSlotSpec): number {
    if (policy.notation === 'scientific') return 1;
    return policy.maxIntegerDigits ?? Infinity;
}

/**
 * Pick the power-of-ten exponent for display.
 *
 * - `scientific` normalises to one integer digit.
 * - `max-integer-digits` outranks the notation hint: the smallest exponent that
 *   brings the integer part within the limit.
 * - `auto` keeps the plain form while it stays readable and falls back to
 *   scientific so the precision is not lost.
 */
function chooseExponent(x: number, policy: AnswerSlotSpec): number {
    if (!Number.isFinite(x) || x === 0) return 0;
    const e = exponentOf(x);
    const intDigits = e + 1;
    const maxInt = policy.maxIntegerDigits;

    if (policy.notation === 'scientific') return e;
    if (maxInt !== undefined && intDigits > maxInt) return intDigits - maxInt;
    if (policy.notation === 'decimal') return 0;

    const precision = policy.precision;
    if (precision?.kind === 'decimals') {
        return e < -precision.max || e > 8 ? e : 0;
    }
    return e < -3 || e >= 4 ? e : 0;
}

/**
 * Decide the exponent and mantissa. Rounding can carry into an extra integer
 * digit (`99.9999` with a cap of 2 becomes `100.0000`), so the exponent is
 * bumped until the mantissa fits.
 */
function layout(
    x: number,
    policy: AnswerSlotSpec,
): { exponent: number; mantissa: number } {
    let exponent = chooseExponent(x, policy);
    const cap = mantissaCap(policy);

    if (Number.isFinite(cap) && x !== 0) {
        for (let attempt = 0; attempt < 3; attempt++) {
            const mantissa = x / Math.pow(10, exponent);
            const rounded = roundForPrecision(mantissa, policy);
            const digits =
                Math.abs(rounded) >= 1 ? Math.floor(Math.log10(Math.abs(rounded))) + 1 : 0;
            if (digits <= cap) break;
            exponent += digits - cap;
        }
    }

    return { exponent, mantissa: x / Math.pow(10, exponent) };
}

/** The finest displayed increment for a precision band, in display units. */
export function precisionStep(
    value: number,
    precision: PrecisionPolicy,
    zeroTol: number,
    exponent = 0,
): number {
    if (precision.kind === 'sigfigs') return ulp(value, precision.min, zeroTol);
    return Math.pow(10, exponent - precision.min);
}

/** Choose a display prefix so the mantissa reads well, else none. */
export function choosePrefix(
    canonical: number,
    atom: UnitFactor,
    allowed: AnswerSlotSpec['allowedPrefixes'],
    maxIntegerDigits?: number,
): PrefixDef | undefined {
    if (canonical === 0) return undefined;
    // Never invent a prefix on a unit that does not take one (`kg`, `min`,
    // `°C`, and every English unit).
    if (!atom.unit.prefixable) return undefined;
    const list: readonly PrefixDef[] =
        allowed === 'auto' ? SI_PREFIXES : allowed === 'none' ? [] : allowed;
    const upper = maxIntegerDigits === undefined ? 1000 : Math.pow(10, maxIntegerDigits);

    const inRangeFor = (candidate: PrefixDef | undefined): boolean => {
        const scale = prefixScale(candidate) * atom.unit.scale;
        const x = Math.abs(canonical / scale);
        return x >= 1 && x < upper;
    };

    // An unprefixed value that already reads well is preferred: `10 N`, not
    // `1 daN`.
    if (inRangeFor(undefined)) return undefined;

    const usable = list.filter((candidate) => inRangeFor(candidate));
    if (usable.length === 0) return undefined;

    // Prefer engineering prefixes (powers of 1000), then the largest exponent.
    // When a digit cap is active only engineering prefixes qualify, so the
    // answer reads `12.3457 × 10^3` rather than `1.2346 hN`.
    const engineering = usable.filter((candidate) => candidate.power % 3 === 0);
    const candidates =
        maxIntegerDigits === undefined
            ? engineering.length > 0
                ? engineering
                : usable
            : engineering;
    if (candidates.length === 0) return undefined;
    return [...candidates].sort((a, b) => b.power - a.power)[0];
}

export interface DisplayUnit {
    unit: UnitExpr;
    prefix?: PrefixDef;
    scale: number;
}

/**
 * Resolve the display unit, prefix, and scale for one canonical value.
 * `scale` is the factor from canonical SI units to the displayed number:
 * `x = canonical / scale`.
 */
export function resolveDisplay(canonical: number, policy: AnswerSlotSpec): DisplayUnit {
    let unit = policy.unit;
    let atom = atomOf(unit);

    if (policy.display === 'expanded' && atom?.unit.expansion) {
        try {
            unit = parseUnitExpr(atom.unit.expansion, unit.namespace);
            atom = atomOf(unit);
        } catch {
            // Keep the declared unit if the expansion cannot parse.
        }
    }

    // Default atomic display prefers a named derived unit: kg*m/s^2 -> N.
    if (policy.display === 'atomic' && atom === null) {
        const named = namedUnitFor(unit);
        if (named !== null) {
            unit = named;
            atom = atomOf(unit);
        }
    }

    // A prefix already inside the declared expression stays there; only an
    // explicit `prefix` adds one on top.
    let outsidePrefix: PrefixDef | undefined;
    if (atom && atom.prefix === undefined) {
        if (policy.prefix) {
            outsidePrefix = policy.prefix;
        } else if (
            policy.display === 'atomic' &&
            policy.allowedPrefixes !== 'none' &&
            policy.unitLabel === undefined
        ) {
            outsidePrefix = choosePrefix(
                canonical,
                atom,
                policy.allowedPrefixes,
                policy.maxIntegerDigits,
            );
        }
    }

    // A global prefix on a compound unit that has no named equivalent is left
    // in the canonical magnitude, so it displays as `0.001 m^2` rather than
    // inventing a non-standard prefixed unit.
    const scale = unit.scale * prefixScale(outsidePrefix);
    return { unit, prefix: outsidePrefix, scale };
}

export interface DisplayLayout {
    display: DisplayUnit;
    /** Power of ten applied to the mantissa; 0 means plain decimal. */
    exponent: number;
    /** `canonical / display.scale / 10^exponent`. */
    mantissa: number;
}

/** Shared layout used by both formatting and grading tolerance. */
export function resolveLayout(canonical: number, policy: AnswerSlotSpec): DisplayLayout {
    const display = resolveDisplay(canonical, policy);
    const x = fromCanonical(canonical, display.unit, display.scale);
    const { exponent, mantissa } = layout(x, policy);
    return { display, exponent, mantissa };
}

/** The value as it is written in the display unit (affine-aware). */
export function displayValue(canonical: number, policy: AnswerSlotSpec): number {
    if (policy.components !== undefined && policy.components.length > 0) return canonical;
    const display = resolveDisplay(canonical, policy);
    return fromCanonical(canonical, display.unit, display.scale);
}

/** Suffix for a display unit, honouring `unit-label`. */
export function unitSuffix(display: DisplayUnit, unitLabel?: string, math = false): string {
    if (unitLabel !== undefined) return math ? latexUnitText(unitLabel) : unitLabel;
    if (display.unit.factors.length === 0) return '';
    return math
        ? describeUnitLatex(display.unit, display.prefix)
        : describeUnitWithPrefix(display.unit, display.prefix);
}

/** Increment of the smallest compound component, in canonical units. */
export function compoundStep(policy: AnswerSlotSpec, decimals: number): number {
    const components = policy.components ?? [];
    const last = components[components.length - 1];
    return Math.pow(10, -decimals) * (last ? last.scale : 1);
}

/**
 * Decompose a canonical value into the declared components (`5 ft 7.00 in`).
 * The value is snapped to the last component's precision first, so carry
 * (`11.999 in` → `1 ft`) is automatic.
 */
export function fmtCompound(
    canonical: number,
    policy: AnswerSlotSpec,
    options: FormatOptions = {},
): string {
    const components = policy.components;
    if (components === undefined || components.length === 0) {
        return fmtQuantity(canonical, policy, options);
    }

    const decimals = policy.precision?.kind === 'decimals' ? policy.precision.max : 0;
    const step = compoundStep(policy, decimals);
    const snapped = step > 0 ? Math.round(canonical / step) * step : canonical;
    const sign = snapped < 0 ? '-' : '';
    let remaining = Math.abs(snapped);

    const parts: { count: number; unit: UnitExpr; value: number }[] = [];
    const halfStep = 0.5 * Math.pow(10, -Math.max(0, Math.min(20, decimals)));
    for (let i = 0; i < components.length; i++) {
        const unit = components[i]!;
        if (i === components.length - 1) {
            let value = remaining / unit.scale;
            // Floating error can leave -0.00; snap it.
            if (Math.abs(value) < halfStep) value = 0;
            parts.push({ count: 0, unit, value });
        } else {
            const count = Math.floor(remaining / unit.scale + 1e-9);
            remaining -= count * unit.scale;
            parts.push({ count, unit, value: count });
        }
    }

    // Trim leading zero components: `0 ft 6.00 in` → `6.00 in`.
    let start = 0;
    while (start < parts.length - 1 && parts[start]!.value === 0) start++;

    const rendered = parts.slice(start).map((part, index, slice) => {
        const isLast = index === slice.length - 1;
        const number = isLast ? part.value.toFixed(Math.max(0, Math.min(20, decimals))) : String(part.count);
        const unit = options.math
            ? describeUnitLatex(part.unit)
            : describeUnit(part.unit);
        return options.math ? `${number}\\,${unit}` : `${number} ${unit}`;
    });

    return sign + rendered.join(options.math ? '\\ ' : ' ');
}

/** Insert thousands separators into the integer part of a rendered number. */
export function groupIntegerDigits(text: string): string {
    const m = /^([+-]?)(\d+)([\s\S]*)$/.exec(text);
    if (!m || m[2]!.length <= 3) return text;
    return `${m[1]}${m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3]}`;
}

/** Format a canonical value for display. */
export function fmtQuantity(
    canonical: number,
    policy: AnswerSlotSpec,
    options: FormatOptions = {},
): string {
    if (policy.components !== undefined && policy.components.length > 0) {
        return fmtCompound(canonical, policy, options);
    }

    // Grouping implies a plain integer part, so suppress the scientific-notation
    // fallback that `auto` would otherwise use for large currency amounts.
    const layoutPolicy = policy.groupThousands ? { ...policy, notation: 'decimal' as const } : policy;
    const { display, exponent, mantissa } = resolveLayout(canonical, layoutPolicy);
    const rounded = roundForPrecision(mantissa, layoutPolicy);
    let number = mantissaText(rounded === 0 ? 0 : rounded, layoutPolicy);
    if (exponent !== 0) {
        number = options.math
            ? `${number} \\times 10^{${exponent}}`
            : `${number} × 10^${exponent}`;
    }
    number = trimNumericZeros(number);
    if (policy.groupThousands) {
        number = groupIntegerDigits(number);
        if (options.math) number = number.replace(/,/g, '{,}');
    }

    const currency = toCurrencyCode(policy.currency ?? '') ?? currencyCodeOfUnit(policy.unit);
    // A currency symbol label reads as a prefix (`$1,000`); otherwise the unit
    // text stays a suffix (`1,000 USD`).
    if (currency !== undefined && policy.unitLabel !== undefined) {
        const label = options.math ? latexUnitText(policy.unitLabel) : policy.unitLabel;
        return `${label}${number}`;
    }
    const suffix = unitSuffix(display, policy.unitLabel, options.math);
    if (suffix === '') return number;
    return `${number}${options.math ? '\\,' : ' '}${suffix}`;
}

/** Rendered text key used for duplicate detection. */
export function displayKey(canonical: number, policy: AnswerSlotSpec): string {
    return fmtQuantity(canonical, policy);
}

/** Strip insignificant trailing zeros from a formatted numeric prefix. */
export function trimNumericZeros(text: string): string {
    const m = /^(-?\d+)\.(\d+)([\s\S]*)$/.exec(text);
    if (!m) return text;
    const frac = m[2]!.replace(/0+$/, '');
    return frac === '' ? `${m[1]}${m[3]}` : `${m[1]}.${frac}${m[3]}`;
}

/**
 * Display a definition-produced quantity. Definitions have no independent
 * display-precision override, so the shared `min-sigfigs` rule applies and
 * trailing zeros are trimmed.
 */
export function fmtQuantityValue(
    value: { canonical: number; unit: UnitExpr; prefix?: PrefixDef; label?: string },
    minSigfigs = 3,
    options: {
        display?: 'declared' | 'atomic' | 'expanded';
        notation?: Notation;
        allowedPrefixes?: AllowedPrefixes;
        math?: boolean;
    } = {},
): string {
    const abstractPrefix = value.prefix !== undefined && value.unit.namespace === 'abstract';
    const policy: AnswerSlotSpec = {
        id: '',
        valueName: '',
        type: 'number',
        unitSystem: value.unit.namespace,
        unit: value.unit,
        unitLabel: value.label,
        unitMode: 'expanded',
        display: options.display ?? 'atomic',
        prefix: abstractPrefix ? undefined : value.prefix,
        prefixPolicy: 'any',
        allowedPrefixes: options.allowedPrefixes ?? 'auto',
        precision: { kind: 'sigfigs', min: minSigfigs, max: minSigfigs },
        notation: abstractPrefix ? 'scientific' : (options.notation ?? 'auto'),
        unitOptional: false,
        tol: 0,
        relTol: 0,
    };
    return trimNumericZeros(fmtQuantity(value.canonical, policy, { math: options.math }));
}

/** Unit text without a chosen prefix (used in warnings and diagnostics). */
export function plainUnitText(unit: UnitExpr): string {
    return describeUnit(unit);
}
