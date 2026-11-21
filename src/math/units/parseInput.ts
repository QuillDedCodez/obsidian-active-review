/** Typed-answer input parsing and grading for quantity answers (Proposal 2 §9). */
import { evaluate } from '../evaluator';
import { dimEquals } from './dimensions';
import {
    atomOf,
    expandSuperscripts,
    parseUnitExpr,
    toCanonical,
    unitKey,
    UnitError,
} from './parseUnit';
import {
    compoundStep,
    digitsFor,
    quantityTolerance,
    resolveDisplay,
    resolveLayout,
    roundSig,
    truncateSig,
} from './format';
import {
    codesForLabel,
    CURRENCY_LABELS,
    currencyCodeOfUnit,
    toCurrencyCode,
    type CurrencyCode,
} from './currency';
import { ABSTRACT_ALIASES } from './registry';
import type { AnswerSlotSpec, PrefixDef, UnitDef, UnitExpr } from './types';

export interface ParsedQuantityInput {
    magnitude: number;
    unit: UnitExpr | null;
    /** Normalized numeric portion, used to count written significant figures. */
    magnitudeText: string;
}

const UNIT_START = /[A-Za-zΩ%°]/;

/** Currency code declared on a slot, either directly or via its bound definition. */
export function currencyCodeForPolicy(policy: AnswerSlotSpec): CurrencyCode | undefined {
    return toCurrencyCode(policy.currency ?? '') ?? currencyCodeOfUnit(policy.unit);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CURRENCY_LABEL_RE = new RegExp(CURRENCY_LABELS.map(escapeRegExp).join('|'), 'gi');

/**
 * Remove a written currency label so the magnitude can be parsed, while
 * rejecting labels that name a different currency. The canonical code is
 * re-appended by the caller, so the declared label stays optional in input and
 * every currency answer resolves to exactly one unit.
 */
function stripCurrencyLabel(text: string, code: CurrencyCode): string | null {
    let rejected = false;
    const stripped = text.replace(CURRENCY_LABEL_RE, (label) => {
        if (!codesForLabel(label).has(code)) {
            rejected = true;
            return label;
        }
        return '';
    });
    return rejected ? null : stripped.trim();
}

/**
 * Presentation-only normalization for typed input. Never used for display.
 *
 * When `currencyCode` is supplied, currency labels are rewritten before the
 * unit tokenizer runs (`$` is not a token character) and a foreign label makes
 * the answer unparseable. The canonical ISO code is appended so a bare number
 * still carries the correct unit.
 */
export function normalizeQuantityText(
    text: string,
    system: 'si' | 'abstract',
    currencyCode?: CurrencyCode,
): string {
    // Superscripts first: NFKC would flatten `²` to `2`.
    let s = expandSuperscripts(text.trim()).normalize('NFKC');
    if (currencyCode !== undefined) {
        const stripped = stripCurrencyLabel(s, currencyCode);
        if (stripped === null) return '';
        s = stripped;
    } else {
        s = s.replace(/\$/g, '');
    }
    s = s.replace(/\\[()[\]]/g, '');
    s = s.replace(/\\left|\\right|\\displaystyle|\\textstyle/g, '');
    s = s.replace(/\\[,;!]/g, '');
    s = s.replace(/\\ /g, ' ');
    s = s.replace(/\\text\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\mathrm\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\operatorname\{([^{}]*)\}/g, '$1');
    s = s.replace(/[\u00B5\u03BC]/g, 'u');
    s = s.replace(/[\u2126]/g, 'Ω');
    s = s.replace(/[·⋅×]/g, '*');
    s = s.replace(/÷/g, '/');
    s = s.replace(/[\u2212\u2013]/g, '-');
    s = s.replace(/\*\*/g, '^');
    // Remove every comma that sits in front of a 3-digit group, so `1,000`,
    // `1,000,000` and `1,000.50` all reduce to a plain magnitude.
    s = s.replace(/,(?=\d{3}(?:\D|$))/g, '');
    s = s.replace(/(\d)[eE]([+-]?\d+)/g, '$1*10^$2');
    s = s.replace(/10\^\(([-+]?\d+)\)/g, '10^$1');
    if (system === 'abstract') {
        for (const [pattern, replacement] of ABSTRACT_ALIASES) {
            s = s.replace(pattern, replacement);
        }
    }
    s = s.replace(/[ \t]+/g, ' ').trim();
    if (currencyCode !== undefined && s !== '') s = `${s} ${currencyCode}`;
    return s;
}

function tryMagnitude(source: string): number | null {
    if (source === '') return null;
    try {
        const value = evaluate(source, {});
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * Split a typed answer into magnitude and unit.
 *
 * The split point is the first position where the remainder parses as a unit
 * expression and the prefix evaluates as a number. Scanning left to right keeps
 * `1.20 × 10^3 kN` and `1000 mm` unambiguous.
 */
export function parseQuantityInput(
    text: string,
    policy: AnswerSlotSpec,
): ParsedQuantityInput | null {
    const normalized = normalizeQuantityText(
        text,
        policy.unitSystem,
        currencyCodeForPolicy(policy),
    );
    if (normalized === '') return null;

    for (let i = 0; i < normalized.length; i++) {
        if (!UNIT_START.test(normalized[i]!)) continue;
        const magnitudeSource = normalized.slice(0, i).trim();
        if (magnitudeSource === '') continue;
        const magnitude = tryMagnitude(magnitudeSource);
        if (magnitude === null) continue;
        const unitSource = normalized.slice(i).trim();
        if (unitSource === '') continue;
        try {
            const unit = parseUnitExpr(unitSource, policy.unitSystem);
            return { magnitude, unit, magnitudeText: magnitudeSource };
        } catch (e) {
            if (!(e instanceof UnitError)) throw e;
        }
    }

    const alone = tryMagnitude(normalized);
    return alone === null ? null : { magnitude: alone, unit: null, magnitudeText: normalized };
}

/** Atoms a prefixed/expanded unit may be built from. */
const EXPANDED_EXTRA_ATOMS = new Set(['h', 'min', 'd']);

function atomAllowedInExpanded(unit: UnitDef): boolean {
    if (unit.namespace !== 'si') return false;
    if (unit.kind === 'base' || unit.kind === 'derived') return true;
    if (unit.temperature !== undefined) return true;
    if (unit.english === true) return true;
    // Time units keep `km/h` and `m/min` usable; other non-SI units do not.
    return EXPANDED_EXTRA_ATOMS.has(unit.symbol);
}

/** Absolute and interval temperatures never convert into one another. */
function temperatureKind(expr: UnitExpr): UnitDef['temperature'] | undefined {
    for (const factor of expr.factors) {
        if (factor.unit.temperature !== undefined) return factor.unit.temperature;
    }
    return undefined;
}

function prefixesAllowedIn(input: UnitExpr, policy: AnswerSlotSpec): boolean {
    const used = input.factors
        .map((factor) => factor.prefix)
        .filter((prefix): prefix is PrefixDef => prefix !== undefined);
    const allowed = policy.allowedPrefixes;
    if (allowed === 'none') return used.length === 0;
    if (Array.isArray(allowed)) {
        return used.every((prefix) => allowed.some((entry) => entry.symbol === prefix.symbol));
    }
    return true;
}

/** Does the typed unit satisfy the slot's `unit-mode` / prefix policy? */
export function unitAccepted(input: UnitExpr, policy: AnswerSlotSpec): boolean {
    if (input.namespace !== policy.unit.namespace) return false;

    // A currency label must name exactly the declared code, under every mode.
    const policyCurrency = currencyCodeOfUnit(policy.unit);
    const inputCurrency = currencyCodeOfUnit(input);
    if (policyCurrency !== undefined || inputCurrency !== undefined) {
        return policyCurrency === inputCurrency;
    }

    const declaredTemperature = temperatureKind(policy.unit);
    const inputTemperature = temperatureKind(input);
    if (declaredTemperature !== undefined || inputTemperature !== undefined) {
        if (declaredTemperature !== inputTemperature) return false;
    }

    switch (policy.unitMode) {
        case 'declared':
            return unitKey(input) === unitKey(policy.unit);
        case 'atomic': {
            const declared = atomOf(policy.unit);
            const inputAtom = atomOf(input);
            if (!declared || !inputAtom) return unitKey(input) === unitKey(policy.unit);
            if (inputAtom.unit.symbol !== declared.unit.symbol) return false;
            const prefix = inputAtom.prefix;
            if (policy.allowedPrefixes === 'none') return prefix === undefined;
            if (Array.isArray(policy.allowedPrefixes)) {
                if (prefix !== undefined && !policy.allowedPrefixes.some((p) => p.symbol === prefix.symbol)) {
                    return false;
                }
            }
            if (policy.prefixPolicy === 'exact') {
                const expected = policy.prefix ?? declared.prefix;
                return (prefix?.symbol ?? '') === (expected?.symbol ?? '');
            }
            return true;
        }
        case 'expanded': {
            // Explicit extras first, then an exact match, then any prefixed
            // combination of allowed atoms with the same dimension.
            if (
                (policy.acceptUnits ?? []).some(
                    (unit) =>
                        dimEquals(unit.dim, policy.unit.dim) &&
                        unitKey(unit) === unitKey(input),
                )
            ) {
                return true;
            }
            if (unitKey(input) === unitKey(policy.unit)) return true;
            if (!dimEquals(input.dim, policy.unit.dim)) return false;
            if (!input.factors.every((factor) => atomAllowedInExpanded(factor.unit))) return false;
            return prefixesAllowedIn(input, policy);
        }
        case 'list': {
            const key = unitKey(input);
            return (policy.acceptUnits ?? []).some(
                (u) => dimEquals(u.dim, policy.unit.dim) && unitKey(u) === key,
            );
        }
        case 'dimension':
            return dimEquals(input.dim, policy.unit.dim);
        case 'family': {
            if (!dimEquals(input.dim, policy.unit.dim)) return false;
            const declared = policy.unit.factors[0]?.unit.quantity;
            const candidate = input.factors[0]?.unit.quantity;
            return declared !== undefined && declared === candidate;
        }
        default:
            return false;
    }
}

/**
 * Parse a compound typed answer such as `5 ft 7 in` or `2 h 30 min`.
 *
 * Each part is a plain number followed by a unit; every unit must have the
 * declared dimension. Returns the canonical value, or null when the input is
 * not compound (the caller then tries a single-unit parse).
 */
export function parseCompoundInput(text: string, policy: AnswerSlotSpec): number | null {
    const components = policy.components;
    if (components === undefined || components.length === 0) return null;

    const normalized = normalizeQuantityText(
        text,
        policy.unitSystem,
        currencyCodeForPolicy(policy),
    );
    const numberRe = /^[+-]?(\d+\.?\d*|\.\d+)/;
    const identRe = /^[A-Za-zΩ%°]+/;
    const parts: { value: number; unitText: string }[] = [];
    let i = 0;

    while (i < normalized.length) {
        while (i < normalized.length && /\s/.test(normalized[i]!)) i++;
        if (i >= normalized.length) break;

        const numberMatch = numberRe.exec(normalized.slice(i));
        if (!numberMatch) return null;
        const value = Number(numberMatch[0]);
        if (!Number.isFinite(value)) return null;
        i += numberMatch[0].length;
        while (i < normalized.length && /\s/.test(normalized[i]!)) i++;

        const unitMatch = identRe.exec(normalized.slice(i));
        const unitText = unitMatch ? unitMatch[0] : '';
        if (unitMatch) i += unitMatch[0].length;
        parts.push({ value, unitText });
    }

    if (parts.length < 2) return null;
    if (parts.some((part) => part.unitText === '')) return null;

    let canonical = 0;
    for (const part of parts) {
        let unit;
        try {
            unit = parseUnitExpr(part.unitText, policy.unitSystem);
        } catch {
            return null;
        }
        if (unit.namespace !== policy.unit.namespace) return null;
        if (!dimEquals(unit.dim, policy.unit.dim)) return null;
        canonical += toCanonical(part.value, unit);
    }
    return canonical;
}

/** Count significant figures in a written numeric magnitude. */
export function countSignificantFigures(text: string): number {
    let s = text.trim().replace(/^[+-]/, '').replace(/\s+/g, '');
    const sci = /^([^eE*]+)(?:[eE][+-]?\d+|\*10\^[+-]?\d+)?$/.exec(s);
    if (sci) s = sci[1]!;
    const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m) return 0;
    const digits = `${m[1] ?? ''}${m[2] ?? ''}`;
    let start = 0;
    while (start < digits.length && digits[start] === '0') start++;
    if (start >= digits.length) return 1; // zero
    return digits.length - start;
}

/**
 * Grade one typed answer against a resolved quantity answer.
 * `answer` is the resolved slot; `typed` is the raw input string.
 */
export function gradeQuantity(
    answer: { canonical: number; displayScale: number; policy: AnswerSlotSpec },
    typed: string,
): boolean {
    const policy = answer.policy;
    const expected = answer.canonical;

    // Compound presentation (`5 ft 7 in`): compare at the last component's
    // precision, and also accept a single-unit or bare-number form.
    if (policy.components !== undefined && policy.components.length > 0) {
        const typedCompound = parseCompoundInput(typed, policy);
        if (typedCompound !== null) return compoundAgrees(typedCompound, expected, policy);

        const parsedSingle = parseQuantityInput(typed, policy);
        if (parsedSingle === null) return false;
        let canonical: number;
        if (parsedSingle.unit === null) {
            if (!policy.unitOptional) return false;
            const display = resolveDisplay(expected, policy);
            canonical = parsedSingle.magnitude * display.scale + (display.unit.offset ?? 0);
        } else {
            if (!dimEquals(parsedSingle.unit.dim, policy.unit.dim)) return false;
            canonical = toCanonical(parsedSingle.magnitude, parsedSingle.unit);
        }
        return compoundAgrees(canonical, expected, policy);
    }

    const parsed = parseQuantityInput(typed, policy);
    if (parsed === null) return false;

    let inputCanonical: number;
    if (parsed.unit === null) {
        if (!policy.unitOptional) return false;
        const display = resolveDisplay(expected, policy);
        inputCanonical = parsed.magnitude * display.scale + (display.unit.offset ?? 0);
    } else {
        if (!dimEquals(parsed.unit.dim, policy.unit.dim)) return false;
        if (!unitAccepted(parsed.unit, policy)) return false;
        inputCanonical = toCanonical(parsed.magnitude, parsed.unit);
    }

    if (policy.precision !== undefined) {
        const layout = resolveLayout(expected, policy);
        const scale = layout.display.scale;
        const offset = layout.display.unit.offset ?? 0;
        const expectedShown = (expected - offset) / scale;
        const typedShown = (inputCanonical - offset) / scale;
        const band = policy.precision;

        if (band.kind === 'sigfigs') {
            // A written answer above the maximum significant figures is rejected,
            // even if its numeric value matches.
            const typedSf = countSignificantFigures(parsed.magnitudeText);
            if (Number.isFinite(band.max) && typedSf > band.max) return false;
        }

        // Magnitude absolute tolerance: one last-displayed-digit step in the
        // answer's normalized prefix / scientific representation.
        const magnitude = quantityTolerance(expected, policy);
        if (Math.abs(inputCanonical - expected) <= magnitude.canonicalStep) return true;

        if (band.kind === 'sigfigs') {
            if (expectedShown === 0) return Math.abs(typedShown) <= 1e-12;
            const typedSf = countSignificantFigures(parsed.magnitudeText);

            const upper = Number.isFinite(band.max)
                ? band.max
                : Math.max(15, typedSf + 2, band.min + 10);
            for (let precision = band.min; precision <= upper; precision++) {
                const rounded = roundSig(expectedShown, precision);
                const trimmed = truncateSig(expectedShown, precision);
                const tolerance = Math.max(1e-12, Math.abs(rounded) * 1e-12);
                if (
                    Math.abs(typedShown - rounded) <= tolerance ||
                    Math.abs(typedShown - trimmed) <= tolerance
                ) {
                    return true;
                }
            }
            return false;
        }

        // Decimal-place fallback path (used by compound components).
        const factor = Math.pow(10, layout.exponent);
        const expectedMantissa = expectedShown / factor;
        const typedMantissa = typedShown / factor;
        for (let precision = band.min; precision <= band.max; precision++) {
            const probe = { kind: 'decimals', min: precision, max: precision } as const;
            if (digitsFor(typedMantissa, probe) === digitsFor(expectedMantissa, probe)) {
                return true;
            }
        }
        return false;
    }

    const magnitude = quantityTolerance(expected, policy).canonicalStep;
    return (
        Math.abs(inputCanonical - expected) <=
        Math.max(policy.tol, policy.relTol * Math.abs(expected), magnitude)
    );
}

/** Rounding agreement at any precision the compound band accepts. */
function compoundAgrees(typedCanonical: number, expected: number, policy: AnswerSlotSpec): boolean {
    const band = policy.precision;
    const decimals = band !== undefined && band.kind === 'decimals'
        ? Array.from({ length: band.max - band.min + 1 }, (_, index) => band.min + index)
        : [0];
    for (const places of decimals) {
        const step = compoundStep(policy, places);
        if (!(step > 0)) continue;
        if (Math.round(typedCanonical / step) === Math.round(expected / step)) return true;
    }
    return false;
}
