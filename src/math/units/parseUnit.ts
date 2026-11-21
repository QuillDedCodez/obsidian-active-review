/** Parse unit expressions such as `kg*m/s^2`, `kN`, `u^2`. */
import { latexUnitText } from '../latex';
import { addDim, dimEquals, scaleDim, ZERO_DIM } from './dimensions';
import { lookupUnitAlias, lookupUnitSymbol, ABSTRACT_ALIASES, SI_UNITS } from './registry';
import { prefixScale, PREFIXES_LONGEST_FIRST } from './prefixes';
import type { PrefixDef, UnitExpr, UnitFactor, UnitNamespace, UnitDef, UnitSystem } from './types';

export class UnitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnitError';
    }
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUPERSCRIPT_MINUS = '⁻';

/** `u²` → `u^2`, `m⁻¹` → `m^-1`. */
export function expandSuperscripts(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i]!;
        const isSuper = SUPERSCRIPT_DIGITS.includes(ch) || ch === SUPERSCRIPT_MINUS;
        if (!isSuper) {
            out += ch;
            i++;
            continue;
        }
        let digits = '';
        let negative = false;
        while (i < text.length) {
            const c = text[i]!;
            if (c === SUPERSCRIPT_MINUS) {
                negative = true;
                i++;
            } else if (SUPERSCRIPT_DIGITS.includes(c)) {
                digits += String(SUPERSCRIPT_DIGITS.indexOf(c));
                i++;
            } else break;
        }
        if (digits === '') {
            out += text[i - 1] ?? '';
            continue;
        }
        out += `^${negative ? '-' : ''}${digits}`;
    }
    return out;
}

/**
 * Canonicalize text before unit parsing: symbols, spacing, superscripts, and
 * the abstract-unit phrase aliases. Case of unit symbols is preserved.
 */
export function normalizeUnitText(text: string, system: UnitSystem): string {
    // Superscripts must be expanded before NFKC, which would flatten `²` to `2`.
    let out = expandSuperscripts(text.trim()).normalize('NFKC');
    out = out
        .replace(/[\u2126Ω]/g, 'Ω')
        .replace(/[\u00B5\u03BC]/g, 'u')
        .replace(/[·⋅×]/g, '*')
        .replace(/÷/g, '/')
        .replace(/[\u2212\u2013]/g, '-')
        .replace(/\\cdot|\\times/g, '*')
        .replace(/\\div/g, '/')
        .replace(/\\left|\\right|\\displaystyle/g, '')
        .replace(/\\[,;!]/g, '')
        .replace(/\\ /g, ' ');
    if (system === 'abstract') {
        for (const [pattern, replacement] of ABSTRACT_ALIASES) {
            out = out.replace(pattern, replacement);
        }
    }
    return out;
}

const IDENT_START = /[A-Za-zΩ%°]/;
const IDENT_BODY = /[A-Za-zΩ%°]/;

/** Convert a written value in `expr` to canonical SI units. */
export function toCanonical(value: number, expr: UnitExpr, prefixFactor = 1): number {
    return value * expr.scale * prefixFactor + (expr.offset ?? 0);
}

/** Convert a canonical value back into `expr` (scale includes any prefix). */
export function fromCanonical(canonical: number, expr: UnitExpr, scale = expr.scale): number {
    return (canonical - (expr.offset ?? 0)) / scale;
}

/** Resolve one identifier to a unit, optionally with a prefix. */
function resolveFactor(
    system: UnitSystem,
    ident: string,
): { unit: UnitDef; prefix?: PrefixDef } {
    const bySymbol = lookupUnitSymbol(system, ident);
    if (bySymbol) return { unit: bySymbol };

    const byAlias = lookupUnitAlias(system, ident);
    if (byAlias) return { unit: byAlias };

    for (const prefix of PREFIXES_LONGEST_FIRST) {
        // Prefixes may be written with a single-character alias (`u` for `µ`).
        const symbols = [prefix.symbol, ...prefix.aliases.filter((a) => a.length === 1)];
        for (const symbol of symbols) {
            if (!ident.startsWith(symbol)) continue;
            const rest = ident.slice(symbol.length);
            if (rest === '') continue;
            const unit = lookupUnitSymbol(system, rest);
            if (unit && unit.prefixable) return { unit, prefix };
        }
    }

    throw new UnitError(`unknown unit "${ident}"`);
}

/**
 * Recursive unit-expression parser.
 *
 * Grammar: `level := factor (op factor)*`, `factor := ident | '(' level ')'`,
 * each optionally followed by `^n`. `op` is `*` or `/`.
 *
 * Ambiguity rule (same spirit as the maths criterion): a level may contain one
 * division at most, and nothing may be multiplied after it. `kg*m/s` is fine;
 * `kg/m*s` and `J/kg/K` must be written `kg*m/s` and `J/(kg*K)`.
 */
class UnitParser {
    private i = 0;

    constructor(
        private readonly source: string,
        private readonly system: UnitSystem,
    ) {}

    parse(): UnitFactor[] {
        const factors = this.parseLevel(false);
        this.skipSpaces();
        if (this.i < this.source.length) {
            throw new UnitError(`unexpected "${this.source[this.i]}" in unit expression`);
        }
        return factors;
    }

    private skipSpaces(): void {
        while (/\s/.test(this.source[this.i] ?? '')) this.i++;
    }

    private parseLevel(closeOnParen: boolean): UnitFactor[] {
        const factors: UnitFactor[] = [];
        let inDenominator = false;
        let justHadFactor = false;

        for (;;) {
            this.skipSpaces();
            const ch = this.source[this.i];
            if (ch === undefined) {
                if (closeOnParen) throw new UnitError('missing ")" in unit expression');
                break;
            }
            if (ch === ')') {
                if (!closeOnParen) throw new UnitError('unexpected ")" in unit expression');
                break;
            }

            if (ch === '*' || ch === '/') {
                if (!justHadFactor) {
                    throw new UnitError('unit expression has an operator without a factor');
                }
                if (ch === '*') {
                    if (inDenominator) {
                        throw new UnitError(
                            'ambiguous unit expression: "*" after "/" — write the product before the division (kg*m/s) or group the denominator (kg/(m*s))',
                        );
                    }
                } else {
                    if (inDenominator) {
                        throw new UnitError(
                            'ambiguous unit expression: "/" after "/" — group the denominator, e.g. J/(kg*K)',
                        );
                    }
                    inDenominator = true;
                }
                this.i++;
                justHadFactor = false;
                continue;
            }

            if (ch !== '(' && !IDENT_START.test(ch)) {
                throw new UnitError(`unexpected "${ch}" in unit expression`);
            }
            if (justHadFactor && inDenominator) {
                throw new UnitError(
                    'ambiguous unit expression: implicit product after "/" — group the denominator',
                );
            }

            factors.push(...this.parseFactor(inDenominator));
            justHadFactor = true;
        }

        if (factors.length === 0) throw new UnitError('empty unit expression');
        if (!justHadFactor) throw new UnitError('unit expression ends with an operator');
        return factors;
    }

    private parseFactor(negate: boolean): UnitFactor[] {
        this.skipSpaces();
        const ch = this.source[this.i];
        let parts: UnitFactor[];

        if (ch === '(') {
            this.i++;
            parts = this.parseLevel(true);
            this.skipSpaces();
            if (this.source[this.i] !== ')') throw new UnitError('missing ")" in unit expression');
            this.i++;
        } else {
            let ident = '';
            while (this.i < this.source.length && IDENT_BODY.test(this.source[this.i]!)) {
                ident += this.source[this.i];
                this.i++;
            }
            if (ident === '') throw new UnitError(`unexpected "${ch}" in unit expression`);
            const resolved = resolveFactor(this.system, ident);
            parts = [{ unit: resolved.unit, prefix: resolved.prefix, exponent: 1 }];
        }

        let exponent = this.parseExponent();
        if (negate) exponent = -exponent;
        return parts.map((part) => ({ ...part, exponent: part.exponent * exponent }));
    }

    private parseExponent(): number {
        this.skipSpaces();
        if (this.source[this.i] !== '^') return 1;
        this.i++;
        let negative = false;
        if (this.source[this.i] === '-') {
            negative = true;
            this.i++;
        }
        let digits = '';
        while (this.i < this.source.length && /[0-9]/.test(this.source[this.i]!)) {
            digits += this.source[this.i];
            this.i++;
        }
        if (digits === '') throw new UnitError('missing exponent after "^"');
        return Number(digits) * (negative ? -1 : 1);
    }
}

/**
 * Parse a unit expression. Throws `UnitError` for anything unknown or
 * ambiguous. Compound factors are never auto-prefixed: `kN` is prefix+atom,
 * `N*m` is two factors.
 */
export function parseUnitExpr(text: string, system: UnitSystem): UnitExpr {
    const source = normalizeUnitText(text, system);
    if (source === '') throw new UnitError('empty unit expression');
    const factors = new UnitParser(source, system).parse();
    return computeUnitExpr(factors, system);
}

/** Combine factors, merging repeats so `m*m` and `m^2` are the same unit. */
export function computeUnitExpr(factors: UnitFactor[], namespace: UnitNamespace): UnitExpr {
    const merged = new Map<string, UnitFactor>();
    for (const factor of factors) {
        if (factor.exponent === 0) continue;
        const key = `${factor.unit.symbol}|${factor.prefix?.symbol ?? ''}`;
        const existing = merged.get(key);
        if (existing) existing.exponent += factor.exponent;
        else merged.set(key, { ...factor });
    }

    let dim = ZERO_DIM;
    let scale = 1;
    let offset: number | undefined;
    const kept: UnitFactor[] = [];
    for (const factor of merged.values()) {
        if (factor.exponent === 0) continue;
        kept.push(factor);
        dim = addDim(dim, scaleDim(factor.unit.dim, factor.exponent));
        const factorScale = prefixScale(factor.prefix) * factor.unit.scale;
        scale *= Math.pow(factorScale, factor.exponent);

        if (factor.unit.offset !== undefined) {
            // Affine units are meaningful only on their own, first power.
            if (kept.length > 1 || factor.exponent !== 1) {
                throw new UnitError(
                    `affine unit "${factor.unit.symbol}" cannot be combined; use its delta form or K`,
                );
            }
            offset = factor.unit.offset;
        }
    }

    // The affine factor may have appeared before the rest of the expression.
    if (offset !== undefined && kept.length !== 1) {
        throw new UnitError('an affine temperature unit cannot be combined with other units');
    }

    return { factors: kept, dim, scale, offset, namespace };
}

/** The single unprefixed-or-declared-prefixed factor of an atomic unit, if any. */
export function atomOf(expr: UnitExpr): UnitFactor | null {
    if (expr.factors.length !== 1) return null;
    const factor = expr.factors[0]!;
    return factor.exponent === 1 ? factor : null;
}

/**
 * Map a compound expression to a named unit when its dimension and scale match
 * one exactly. `kg*m/s^2` becomes `N` and `V/Ω` becomes `A`; `m^2` stays
 * compound.
 */
export function namedUnitFor(expr: UnitExpr): UnitExpr | null {
    if (expr.factors.length === 1 && expr.factors[0]!.exponent === 1) return expr;
    for (const candidate of SI_UNITS) {
        if (candidate.kind !== 'derived' && candidate.kind !== 'base') continue;
        if (candidate.namespace !== expr.namespace) continue;
        if (candidate.scale !== expr.scale) continue;
        if (!dimEquals(candidate.dim, expr.dim)) continue;
        return {
            factors: [{ unit: candidate, exponent: 1 }],
            dim: candidate.dim,
            scale: candidate.scale,
            namespace: candidate.namespace,
        };
    }
    return null;
}

export const DIMENSIONLESS_UNIT: UnitExpr = {
    factors: [],
    dim: ZERO_DIM,
    scale: 1,
    namespace: 'si',
};

/** Append-only structural key used by `unit-mode = list` and dedup. */
export function unitKey(expr: UnitExpr): string {
    const parts = [...expr.factors]
        .sort((a, b) => {
            const ak = `${a.unit.symbol}|${a.prefix?.symbol ?? ''}`;
            const bk = `${b.unit.symbol}|${b.prefix?.symbol ?? ''}`;
            return ak.localeCompare(bk);
        })
        .map((f) => `${f.prefix?.symbol ?? ''}${f.unit.symbol}^${f.exponent}`);
    return `${expr.namespace}:${parts.join('*')}`;
}

export function unitsAreEquivalent(a: UnitExpr, b: UnitExpr): boolean {
    return unitKey(a) === unitKey(b);
}

/** True when both expressions are the same atom with the same declared prefix. */
export function isAtomicUnit(expr: UnitExpr): boolean {
    return atomOf(expr) !== null;
}

function factorLabel(factor: UnitFactor, exponent: number): string {
    const base = `${factor.prefix?.symbol ?? ''}${factor.unit.symbol}`;
    return exponent === 1 ? base : `${base}^${exponent}`;
}

/** Display form: `N`, `kN`, `kg*m/s^2`, `u^2`. */
export function describeUnit(expr: UnitExpr): string {
    if (expr.factors.length === 0) return '';
    const positive = expr.factors.filter((f) => f.exponent > 0);
    const negative = expr.factors.filter((f) => f.exponent < 0);

    const numerator = positive.map((f) => factorLabel(f, f.exponent)).join('*');
    if (negative.length === 0) return numerator === '' ? '1' : numerator;
    const denominator = negative.map((f) => factorLabel(f, -f.exponent)).join('*');
    const den = negative.length > 1 ? `(${denominator})` : denominator;
    return `${numerator === '' ? '1' : numerator}/${den}`;
}

/** Display form including an auto-selected prefix. */
export function describeUnitWithPrefix(expr: UnitExpr, prefix?: PrefixDef): string {
    if (expr.factors.length === 0) return '';
    const atom = atomOf(expr);
    if (atom && atom.prefix === undefined && prefix) {
        return `${prefix.symbol}${atom.unit.symbol}`;
    }
    return describeUnit(expr);
}

/**
 * Math-mode form of {@link describeUnitWithPrefix}. Units are upright text,
 * not variables: `cm` becomes `\text{cm}`. Compound units keep their
 * structure in math (`\text{kg}\cdot\text{m}/\text{s}^{2}`), because `*` and
 * `^` are literal inside `\text{…}`.
 */
export function describeUnitLatex(expr: UnitExpr, prefix?: PrefixDef): string {
    if (expr.factors.length === 0) return '';
    const atom = atomOf(expr);
    if (atom && atom.prefix === undefined && prefix) {
        return latexUnitText(`${prefix.symbol}${atom.unit.symbol}`);
    }

    const factorText = (factor: UnitFactor, exponent: number): string => {
        const base = latexUnitText(`${factor.prefix?.symbol ?? ''}${factor.unit.symbol}`);
        return exponent === 1 ? base : `${base}^{${exponent}}`;
    };
    const positive = expr.factors.filter((f) => f.exponent > 0);
    const negative = expr.factors.filter((f) => f.exponent < 0);

    const numerator = positive.map((f) => factorText(f, f.exponent)).join('\\cdot ');
    if (negative.length === 0) return numerator === '' ? '1' : numerator;
    const denominator = negative.map((f) => factorText(f, -f.exponent)).join('\\cdot ');
    const den = negative.length > 1 ? `(${denominator})` : denominator;
    return `${numerator === '' ? '1' : numerator}/${den}`;
}
