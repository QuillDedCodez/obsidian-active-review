/** Helpers for typed definition values: quoted strings, unit algebra, and splits. */
import {
    UnitError,
    addDim,
    findPrefix,
    parseUnitExpr,
    scaleDim,
    ZERO_DIM,
    type Dimension,
    type PrefixDef,
    type UnitExpr,
    type UnitFactor,
    type UnitSystem,
} from '../../math/units';

export interface UnitAlgebraResult {
    unit: UnitExpr;
    prefix?: PrefixDef;
}

export type TypedLookup =
    | { type: 'unit'; unit: UnitExpr; prefix?: PrefixDef }
    | { type: 'prefix'; prefix?: PrefixDef }
    | { type: 'string'; text: string }
    | undefined;

/** Split on a separator at top level, respecting quotes and brackets. */
export function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let current = '';
    let quote = '';
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (quote) {
            current += ch;
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        if (ch === separator && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current.trim());
    return parts;
}

/** Read one complete quoted string at the start of `text`. */
export function readQuoted(text: string): { value: string; rest: string } | null {
    const first = text[0];
    if (first !== '"' && first !== "'") return null;
    let value = '';
    for (let i = 1; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === first) return { value, rest: text.slice(i + 1) };
        value += ch;
    }
    throw new Error('unterminated quoted string');
}

/** Parse a unit string in SI first, then abstract. */
export function parseUnitString(text: string): UnitExpr {
    try {
        return parseUnitExpr(text, 'si');
    } catch (e) {
        if (!(e instanceof UnitError)) throw e;
        return parseUnitExpr(text, 'abstract');
    }
}

const UNIT_ONE: UnitExpr = {
    factors: [],
    dim: ZERO_DIM,
    scale: 1,
    namespace: 'si',
};

function mergeFactors(a: UnitExpr, b: UnitExpr, divide: boolean): UnitFactor[] {
    const merged = new Map<string, UnitFactor>();
    const add = (factor: UnitFactor, sign: number): void => {
        const key = `${factor.unit.symbol}|${factor.prefix?.symbol ?? ''}`;
        const existing = merged.get(key);
        if (existing) existing.exponent += factor.exponent * sign;
        else merged.set(key, { ...factor, exponent: factor.exponent * sign });
    };
    for (const factor of a.factors) add(factor, 1);
    for (const factor of b.factors) add(factor, divide ? -1 : 1);
    return [...merged.values()].filter((factor) => factor.exponent !== 0);
}

function combineDims(a: Dimension, b: Dimension, divide: boolean): Dimension {
    return addDim(a, scaleDim(b, divide ? -1 : 1));
}

/**
 * Parse unit algebra such as `'kg''m'/('s'^2)`, `unit("m")^2`, or `a*c`.
 * A prefix value multiplies the whole expression as a global scale.
 */
export function parseUnitAlgebra(
    text: string,
    lookup: (name: string) => TypedLookup,
    _system: UnitSystem = 'si',
): UnitAlgebraResult {
    let i = 0;
    const source = text;

    const skip = (): void => {
        while (/\s/.test(source[i] ?? '')) i++;
    };

    const readIdent = (): string => {
        let name = '';
        while (/[A-Za-z0-9_]/.test(source[i] ?? '')) {
            name += source[i];
            i++;
        }
        return name;
    };

    const readBalanced = (): string => {
        const open = source[i];
        const close = open === '(' ? ')' : open === '[' ? ']' : '}';
        if (!open) throw new Error('expected a group');
        let depth = 0;
        const start = i;
        while (i < source.length) {
            const ch = source[i]!;
            i++;
            if (ch === open) depth++;
            else if (ch === close) {
                depth--;
                if (depth === 0) break;
            }
        }
        if (depth !== 0) throw new Error('unbalanced group in unit expression');
        return source.slice(start + 1, i - 1);
    };

    const parseFactor = (): UnitAlgebraResult => {
        skip();
        const ch = source[i];
        if (ch === '(') {
            const inner = readBalanced();
            return parseUnitAlgebra(inner, lookup);
        }
        const quoted = readQuoted(source.slice(i));
        if (quoted !== null) {
            i += source.slice(i).length - quoted.rest.length;
            return { unit: parseUnitString(quoted.value) };
        }
        const name = readIdent();
        if (name === '') throw new Error(`unexpected "${ch ?? 'end'}" in unit expression`);

        if (name === 'unit' || name === 'prefixUnit') {
            skip();
            if (source[i] !== '(') throw new Error(`${name} requires (...)`);
            const inner = readBalanced();
            const arg = inner.trim();
            const lit = readQuoted(arg);
            const textValue = lit !== null ? lit.value : arg;
            const ref = lit !== null ? undefined : lookup(textValue);
            if (name === 'unit') {
                if (lit !== null) return { unit: parseUnitString(textValue) };
                if (ref?.type === 'unit') return { unit: ref.unit, prefix: ref.prefix };
                if (ref?.type === 'string') return { unit: parseUnitString(ref.text) };
                throw new Error(`unit(${textValue}): unknown unit`);
            }
            if (lit !== null) {
                if (textValue === '') return { unit: UNIT_ONE };
                const prefix = findPrefix(textValue);
                if (!prefix) throw new Error(`prefixUnit(${textValue}): unknown prefix`);
                return { unit: UNIT_ONE, prefix };
            }
            if (ref?.type === 'prefix') return { unit: UNIT_ONE, prefix: ref.prefix };
            if (ref?.type === 'string') {
                if (ref.text === '') return { unit: UNIT_ONE };
                const prefix = findPrefix(ref.text);
                if (!prefix) throw new Error(`prefixUnit(${ref.text}): unknown prefix`);
                return { unit: UNIT_ONE, prefix };
            }
            throw new Error(`prefixUnit(${textValue}): unknown prefix`);
        }

        const ref = lookup(name);
        if (ref?.type === 'unit') return { unit: ref.unit, prefix: ref.prefix };
        if (ref?.type === 'prefix') return { unit: UNIT_ONE, prefix: ref.prefix };
        if (ref?.type === 'string') return { unit: parseUnitString(ref.text) };
        throw new Error(`unknown unit "${name}"`);
    };

    const parsePowered = (): UnitAlgebraResult => {
        let value = parseFactor();
        skip();
        if (source[i] === '^') {
            i++;
            skip();
            let sign = 1;
            if (source[i] === '-') {
                sign = -1;
                i++;
            }
            let digits = '';
            while (/[0-9]/.test(source[i] ?? '')) {
                digits += source[i];
                i++;
            }
            if (digits === '') throw new Error('missing unit exponent');
            const exponent = Number(digits) * sign;
            value = {
                unit: {
                    factors: value.unit.factors.map((f) => ({
                        ...f,
                        exponent: f.exponent * exponent,
                    })),
                    dim: scaleDim(value.unit.dim, exponent),
                    scale: Math.pow(value.unit.scale, exponent),
                    namespace: value.unit.namespace,
                },
                prefix: value.prefix,
            };
        }
        return value;
    };

    const parseTerm = (): UnitAlgebraResult => {
        let left = parsePowered();
        let inDenominator = false;
        for (;;) {
            skip();
            const op = source[i];
            if (op !== '*' && op !== '/' && !(op !== undefined && /[('"\w]/.test(op))) break;
            let divide = false;
            if (op === '*' || op === '/') {
                divide = op === '/';
                i++;
            }
            if (inDenominator) {
                throw new Error(
                    'ambiguous unit expression: group the denominator before multiplying, e.g. kg/(m*s)',
                );
            }
            if (divide) inDenominator = true;
            const right = parsePowered();
            if (left.unit.namespace !== right.unit.namespace) {
                throw new Error('cannot mix SI and abstract units in one expression');
            }
            if (left.prefix && right.prefix) {
                throw new Error('stacked prefixes are not allowed');
            }
            const prefix = left.prefix ?? right.prefix;
            left = {
                unit: {
                    factors: mergeFactors(left.unit, right.unit, divide),
                    dim: combineDims(left.unit.dim, right.unit.dim, divide),
                    scale: divide
                        ? left.unit.scale / right.unit.scale
                        : left.unit.scale * right.unit.scale,
                    namespace: left.unit.namespace,
                },
                prefix,
            };
        }
        return left;
    };

    const result = parseTerm();
    skip();
    if (i < source.length) {
        throw new Error(`unexpected "${source[i]}" in unit expression`);
    }
    return result;
}


