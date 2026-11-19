/** Parsing and validating the `rv-def` block. */
import {
    analyzeExpression,
    evaluate,
    firstDiagnostic,
    MATH_FUNCTIONS,
    type ExprDiagnostic,
} from '../../math';
import {
    findPrefix,
    prefixScale,
    type PrefixDef,
    type QuantityValue,
    type UnitExpr,
} from '../../math/units';
import type { VarDef, VarValue, Warning } from '../types';
import {
    parseUnitAlgebra,
    parseUnitString,
    readQuoted,
    splitTopLevel,
    type TypedLookup,
} from './typed';

const DISP_START = '\u0003';
const DISP_END = '\u0004';

/**
 * A `rv-def` expression that fails the shared criterion (Proposal 1).
 * Fatal for the whole note: the scanner excludes it from the question pool.
 */
export class DefinitionExpressionError extends Error {
    constructor(
        readonly where: string,
        readonly line: number,
        readonly defName: string,
        readonly rhs: string,
        readonly diagnostic: ExprDiagnostic,
    ) {
        super(
            `${where}: line ${line}: ${defName} = ${rhs} — ${diagnostic.message}`,
        );
        this.name = 'DefinitionExpressionError';
    }
}

function checkExpression(
    substituted: string,
    original: string,
    where: string,
    line: number,
    defName: string,
    env: Record<string, number>,
    stringNames: Set<string>,
): void {
    const analysis = analyzeExpression(substituted, {
        mode: 'latex',
        knownSymbols: new Set(Object.keys(env)),
        knownFunctions: MATH_FUNCTIONS,
    });
    if (analysis.status === 'valid') return;

    const diagnostic = firstDiagnostic(analysis);
    if (diagnostic === undefined) {
        throw new DefinitionExpressionError(where, line, defName, original, {
            status: 'parse-error',
            code: 'E_PARSE',
            message: 'invalid expression',
            path: [],
        });
    }

    const symbol = diagnostic.symbol;
    if (diagnostic.code === 'E_UNKNOWN_SYMBOL' && symbol !== undefined && stringNames.has(symbol)) {
        throw new Error(
            `${where}: line ${line}: ${defName} = ${original} — cannot use string variable "${symbol}" in a math expression`,
        );
    }

    throw new DefinitionExpressionError(where, line, defName, original, diagnostic);
}

function evalIn(
    expr: string,
    env: Record<string, number>,
    stringNames: Set<string>,
    label: string,
): number {
    try {
        return evaluate(expr, env);
    } catch (e) {
        const msg = (e as Error).message;
        const missing = /Unknown variable "(.+)"/.exec(msg)?.[1];
        throw new Error(
            `${label}: ${missing && stringNames.has(missing) ? `cannot use string variable "${missing}"` : msg}`,
        );
    }
}

function splitArgs(src: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let quote = '';
    let cur = '';
    for (let i = 0; i < src.length; i++) {
        const ch = src.charAt(i);
        if (quote) {
            cur += ch;
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            cur += ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) {
            out.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.trim() !== '') out.push(cur.trim());
    return out.filter((s) => s !== '');
}

function parsePickArgs(
    src: string,
    where: string,
    name: string,
): { kind: 'num' | 'str' | 'expr'; value: string | number; source?: string }[] {
    const parts = splitArgs(src);
    const out: { kind: 'num' | 'str' | 'expr'; value: string | number; source?: string }[] = [];
    for (const part of parts) {
        const quoted = readQuoted(part);
        if (quoted !== null && quoted.rest.trim() === '') {
            out.push({ kind: 'str', value: quoted.value, source: quoted.value });
            continue;
        }
        const text = /^\\text\{([\s\S]*)\}$/.exec(part);
        if (text) {
            out.push({
                kind: 'str',
                value: text[1] ?? '',
                source: `\\text{${text[1] ?? ''}}`,
            });
            continue;
        }
        if (part !== '' && Number.isFinite(Number(part))) {
            out.push({ kind: 'num', value: Number(part) });
            continue;
        }
        out.push({ kind: 'expr', value: part });
    }
    if (out.length === 0) throw new Error(`${where}: pick() for ${name} is empty`);
    return out;
}

function substituteForEval(
    src: string,
    env: Record<string, number>,
    stringNames: Set<string>,
    label: string,
): string {
    return src.replace(/<<rv:(expr|exprs|val|values|value):([^>]*?)>>/g, (_whole, kind: string, raw: string) => {
        const name = raw.trim();
        if (stringNames.has(name)) {
            throw new Error(`${label}: cannot substitute <<rv:${kind}:${name}>> — "${name}" is a string variable`);
        }
        const v = env[name];
        if (v === undefined) {
            throw new Error(`${label}: cannot substitute <<rv:${kind}:${name}>> — "${name}" is not defined`);
        }
        return `(${v})`;
    });
}

/**
 * A `link()` member is stored exactly as written: a plain definition name, or
 * `-name` for a flipped member. The first member sets the shared draw index
 * and is never flipped.
 */
export function linkName(member: string): string {
    return member.startsWith('-') ? member.slice(1).trim() : member;
}

/** Whether a `link()` member carries the leading `-` flip marker. */
export function isFlipped(member: string): boolean {
    return member.startsWith('-');
}

export function effectiveCount(d: VarDef): number {
    if (
        d.kind === 'pick' ||
        d.kind === 'stringPick' ||
        d.kind === 'exprPick' ||
        d.kind === 'unit' ||
        d.kind === 'prefix' ||
        d.kind === 'quantityPick'
    ) {
        return d.values?.length ?? 0;
    }
    if (d.kind === 'rand') {
        const fullLength = Math.floor((d.last - d.first) / d.step + 1e-9) + 1;
        return d.max_index !== undefined ? Math.min(d.max_index, fullLength) : fullLength;
    }
    return 0;
}

function buildDisplaySource(
    source: string,
    env: Record<string, number>,
    displayNames: Set<string>,
): string {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const ch = source[i]!;

        if (ch === '\\') {
            const varMatch = /^\\(?:var|variable)\{([^}]+)\}/.exec(source.slice(i));
            if (varMatch) {
                const varName = varMatch[1]!.trim();
                if (displayNames.has(varName)) {
                    out += `${DISP_START}${varName}${DISP_END}`;
                } else if (varName in env) {
                    out += `<<rv:val:${varName}>>`;
                } else {
                    out += varMatch[0];
                }
                i += varMatch[0].length;
                continue;
            }
            const cmdMatch = /^\\[A-Za-z]+/.exec(source.slice(i));
            if (cmdMatch) {
                out += cmdMatch[0];
                i += cmdMatch[0].length;
                continue;
            }
            out += ch;
            i++;
            continue;
        }

        if (/[A-Za-z]/.test(ch)) {
            if (displayNames.has(ch)) {
                out += `${DISP_START}${ch}${DISP_END}`;
            } else if (ch in env) {
                out += `<<rv:val:${ch}>>`;
            } else {
                out += ch;
            }
            i++;
            continue;
        }

        out += ch;
        i++;
    }
    return out;
}

function findFirstDisplayRef(source: string, displayNames: Set<string>): string | null {
    const varRe = /\\(?:var|variable)\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = varRe.exec(source)) !== null) {
        const n = m[1]!.trim();
        if (displayNames.has(n)) return n;
    }
    for (const ch of source) {
        if (/[A-Za-z]/.test(ch) && displayNames.has(ch)) return ch;
    }
    return null;
}

function extractDependencies(source: string, known: Set<string>): string[] {
    const names = new Set<string>();
    const scrubbed = source.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ');
    const varRe = /\\(?:var|variable)\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = varRe.exec(scrubbed)) !== null) {
        if (known.has(m[1]!.trim())) names.add(m[1]!.trim());
    }
    const identRe = /[A-Za-z][A-Za-z0-9_]*/g;
    while ((m = identRe.exec(scrubbed)) !== null) {
        if (known.has(m[0])) names.add(m[0]);
    }
    return [...names];
}

function parseRand(
    rhs: string,
    where: string,
): { first: number; last: number; step: number; max_index?: number } | null {
    const r = /^(?:rand|random)\(\s*([^,]+),\s*([^,]+),\s*([^,)\s]+)\s*(?:,\s*([^,)\s]+)\s*)?\)$/.exec(rhs);
    if (!r) return null;
    const first = Number(r[1]);
    const last = Number(r[2]);
    const step = Number(r[3]);
    if (![first, last, step].every(Number.isFinite)) {
        throw new Error(`${where}: rand(): all parameters must be numbers`);
    }
    if (step <= 0) throw new Error(`${where}: rand(): step must be > 0`);
    if (last < first) throw new Error(`${where}: rand(): max must be >= min`);
    let max_index: number | undefined;
    if (r[4] !== undefined) {
        const n = Number(r[4]);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
            throw new Error(`${where}: rand(): max_index must be a positive integer`);
        }
        max_index = n;
    }
    return { first, last, step, max_index };
}

function matchConstructor(text: string): { name: 'unit' | 'prefixUnit'; arg: string } | null {
    const m = /^(unit|prefixUnit)\s*\(/.exec(text);
    if (!m) return null;
    const open = m[0].length - 1;
    let depth = 0;
    let quote = '';
    for (let i = open; i < text.length; i++) {
        const ch = text[i]!;
        if (quote) {
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) {
                if (i !== text.length - 1) return null;
                return {
                    name: m[1] as 'unit' | 'prefixUnit',
                    arg: text.slice(open + 1, i).trim(),
                };
            }
        }
    }
    return null;
}

function parseQuantityLiteral(
    text: string,
    lookup: (name: string) => TypedLookup,
    where: string,
): QuantityValue | null {
    const parts = splitTopLevel(text, ';');
    if (parts.length < 2 || parts.length > 3) return null;
    if (parts.length === 3 && parts[2] === '') {
        // prefix-only abstract is allowed
    }
    const valueText = parts[0]!;
    const prefixText = parts.length === 3 ? parts[1]! : '';
    const unitText = parts.length === 3 ? parts[2]! : parts[1]!;

    const value = Number(valueText);
    if (!Number.isFinite(value)) return null;

    let prefix: PrefixDef | undefined;
    if (prefixText !== '') {
        const lit = readQuoted(prefixText);
        if (lit === null) return null;
        if (lit.value !== '') {
            prefix = findPrefix(lit.value);
            if (!prefix) throw new Error(`${where}: "${lit.value}" is not a known prefix`);
        }
    }

    let unit: UnitExpr;
    const unitLit = readQuoted(unitText);
    if (unitLit !== null && unitLit.rest.trim() === '') {
        unit = unitLit.value === '' ? parseUnitString('u') : parseUnitString(unitLit.value);
    } else if (unitText === '') {
        unit = parseUnitString('u');
    } else {
        const algebra = parseUnitAlgebra(unitText, lookup);
        unit = algebra.unit;
        if (algebra.prefix) {
            if (prefix) throw new Error(`${where}: stacked prefixes are not allowed`);
            prefix = algebra.prefix;
        }
    }
    const canonical = value * prefixScale(prefix) * unit.scale + (unit.offset ?? 0);
    return { canonical, unit, prefix };
}

export function parseVars(
    block: string | undefined,
    where: string,
    env: Record<string, number>,
    stringNames: Set<string>,
): {
    defs: VarDef[];
    links: string[][];
    warnings: Warning[];
    displayNames: Set<string>;
} {
    const out: VarDef[] = [];
    const links: string[][] = [];
    const warnings: Warning[] = [];
    const displayNames = new Set<string>();
    const byName = new Map<string, VarDef>();

    const pushOrReplace = (def: VarDef): void => {
        const idx = out.findIndex((d) => d.name === def.name);
        if (idx >= 0) out[idx] = def;
        else out.push(def);
        byName.set(def.name, def);
    };

    const lookup = (name: string): TypedLookup => {
        const def = byName.get(name);
        if (!def) return undefined;
        if (def.valueType === 'unit') {
            const first = def.values?.[0];
            if (first && typeof first === 'object' && 'unit' in first && 'factors' in first.unit) {
                return { type: 'unit', unit: first.unit, prefix: first.prefix };
            }
            if (first && typeof first === 'object' && 'factors' in first) {
                return { type: 'unit', unit: first };
            }
        }
        if (def.valueType === 'prefix') {
            const first = def.values?.[0];
            if (typeof first === 'string') {
                const prefix = first === '' ? undefined : findPrefix(first);
                return { type: 'prefix', prefix };
            }
        }
        if (def.valueType === 'string') {
            const first = def.values?.[0];
            if (typeof first === 'string') return { type: 'string', text: first };
        }
        return undefined;
    };

    const rawLines = (block ?? '').split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
        const line = rawLines[lineIndex]!.trim();
        if (!line) continue;
        const lineNo = lineIndex + 1;

        const lm = /^link\s*\(([^)]*)\)/.exec(line);
        if (lm) {
            const names = splitArgs(lm[1] ?? '');
            if (names.length < 2) throw new Error(`${where}: link(): needs at least two names`);
            for (const member of names) {
                if (isFlipped(member) && linkName(member) === '') {
                    throw new Error(`${where}: link(): missing name after "-" in "${line}"`);
                }
            }
            if (isFlipped(names[0] ?? '')) {
                throw new Error(
                    `${where}: link(): the first member cannot be flipped ("${linkName(names[0]!)}") — ` +
                        'it sets the shared draw index',
                );
            }
            links.push(names);
            continue;
        }

        const m = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
        if (!m) throw new Error(`${where}: cannot read "${line}" (use e.g. x = rand(3, 5, 1) or f = x^{3})`);
        const name = m[1] ?? '';
        const rhs = (m[2] ?? '').trim();

        const isDuplicate =
            name in env || stringNames.has(name) || displayNames.has(name) || byName.has(name);
        if (isDuplicate) {
            warnings.push({
                section: 'definitions',
                message: `${where}: variable "${name}" is defined twice — last definition wins`,
            });
            delete env[name];
            stringNames.delete(name);
            displayNames.delete(name);
        }

        if (/^(display|disp)\s*\(/.test(rhs)) {
            throw new Error(
                `${where}: display() has been removed — use <<rv:expression:NAME>> to show an expression source`,
            );
        }

        const displayMatch = /^(display|disp)\(([^)]*)\)$/.exec(rhs);
        if (displayMatch) {
            const inner = displayMatch[2]!.trim();
            const source = inner === '' ? name : inner;
            displayNames.add(name);
            pushOrReplace({
                name,
                kind: 'display',
                expr: source,
                displaySource: source,
                first: 0,
                last: 0,
                step: 1,
                fixed: false,
                valueType: 'number',
                dependencies: extractDependencies(source, new Set([...Object.keys(env), ...byName.keys()])),
            });
            continue;
        }

        const parts = splitTopLevel(rhs, ';');
        if (parts.length > 3) {
            throw new Error(`${where}: ${name} has too many semicolons — use value, value; unit, or value; prefix; unit`);
        }

        // Quantity declaration.
        if (parts.length >= 2) {
            const valueText = parts[0]!;
            const prefixText = parts.length === 3 ? parts[1]! : '';
            const unitText = parts.length === 3 ? parts[2]! : parts[1]!;

            if (valueText === '') throw new Error(`${where}: ${name} is missing a value`);
            if (valueText.includes(';')) throw new Error(`${where}: ${name} has too many semicolons`);

            const known = new Set([...Object.keys(env), ...byName.keys()]);
            const dependencies = extractDependencies(valueText, known);

            let prefix: string | undefined;
            let prefixRef: string | undefined;
            if (prefixText !== '') {
                const lit = readQuoted(prefixText);
                if (lit !== null && lit.rest.trim() === '') {
                    if (lit.value !== '') {
                        const found = findPrefix(lit.value);
                        if (!found) throw new Error(`${where}: ${name}: "${lit.value}" is not a known prefix`);
                        prefix = found.symbol;
                    }
                } else if (/^prefixUnit\s*\(/.test(prefixText)) {
                    const algebra = parseUnitAlgebra(prefixText, lookup);
                    if (!algebra.prefix) throw new Error(`${where}: ${name}: prefixUnit() is empty`);
                    prefix = algebra.prefix.symbol;
                } else if (/^[A-Za-z][A-Za-z0-9_]*$/.test(prefixText)) {
                    const ref = byName.get(prefixText);
                    if (!ref) throw new Error(`${where}: ${name}: prefix variable "${prefixText}" is not defined`);
                    if (ref.valueType !== 'prefix' && ref.valueType !== 'string') {
                        throw new Error(`${where}: ${name}: "${prefixText}" is not a prefix`);
                    }
                    if ((ref.values?.length ?? 0) === 1) {
                        const value = ref.values?.[0];
                        if (typeof value === 'string') prefix = value;
                    } else {
                        prefixRef = prefixText;
                        dependencies.push(prefixText);
                    }
                } else {
                    throw new Error(`${where}: ${name}: cannot read prefix "${prefixText}"`);
                }
            }

            let unit: UnitExpr | undefined;
            let unitRef: string | undefined;
            if (unitText === '') {
                unit = parseUnitString('u');
            } else {
                const lit = readQuoted(unitText);
                if (lit !== null && lit.rest.trim() === '') {
                    unit = lit.value === '' ? parseUnitString('u') : parseUnitString(lit.value);
                } else if (/^unit\s*\(/.test(unitText)) {
                    const algebra = parseUnitAlgebra(unitText, lookup);
                    unit = algebra.unit;
                    if (algebra.prefix) {
                        if (prefix || prefixRef) throw new Error(`${where}: ${name}: stacked prefixes are not allowed`);
                        prefix = algebra.prefix.symbol;
                    }
                } else if (/^[A-Za-z][A-Za-z0-9_]*$/.test(unitText)) {
                    const ref = byName.get(unitText);
                    if (!ref) throw new Error(`${where}: ${name}: unit variable "${unitText}" is not defined`);
                    if (ref.valueType !== 'unit' && ref.valueType !== 'string') {
                        throw new Error(`${where}: ${name}: "${unitText}" is not a unit`);
                    }
                    if ((ref.values?.length ?? 0) === 1) {
                        const value = ref.values?.[0];
                        if (typeof value === 'object' && 'unit' in value && 'factors' in value.unit) {
                            unit = value.unit;
                            if (value.prefix) {
                                if (prefix || prefixRef) {
                                    throw new Error(`${where}: ${name}: stacked prefixes are not allowed`);
                                }
                                prefix = value.prefix.symbol;
                            }
                        } else if (typeof value === 'object' && 'factors' in value) {
                            unit = value;
                        } else if (typeof value === 'string') unit = parseUnitString(value);
                    } else {
                        unitRef = unitText;
                        dependencies.push(unitText);
                    }
                } else {
                    const algebra = parseUnitAlgebra(unitText, lookup);
                    unit = algebra.unit;
                    if (algebra.prefix) {
                        if (prefix || prefixRef) throw new Error(`${where}: ${name}: stacked prefixes are not allowed`);
                        prefix = algebra.prefix.symbol;
                    }
                }
            }

            if ((prefix || prefixRef) && unit) {
                if (unit.factors.some((factor) => factor.prefix !== undefined)) {
                    throw new Error(`${where}: ${name}: stacked prefixes are not allowed`);
                }
                const first = unit.factors[0];
                if (
                    unit.factors.length === 1 &&
                    first !== undefined &&
                    first.exponent === 1 &&
                    first.unit.namespace !== 'abstract' &&
                    !first.unit.prefixable
                ) {
                    throw new Error(
                        `${where}: ${name}: unit "${first.unit.symbol}" does not take a prefix`,
                    );
                }
            }

            const rand = parseRand(valueText, where);
            const base = {
                name,
                first: 0,
                last: 0,
                step: 1,
                fixed: rand === null,
                valueType: 'quantity' as const,
                dependencies,
                quantity: {
                    valueExpr: valueText,
                    fixedValue: Number.isFinite(Number(valueText)) ? Number(valueText) : undefined,
                    prefix,
                    prefixRef,
                    unit,
                    unitRef,
                },
            };
            if (rand) {
                pushOrReplace({
                    ...base,
                    kind: 'rand',
                    first: rand.first,
                    last: rand.last,
                    step: rand.step,
                    fixed: false,
                    ...(rand.max_index !== undefined ? { max_index: rand.max_index } : {}),
                });
            } else {
                pushOrReplace({ ...base, kind: 'expr', expr: valueText });
            }
            // Quantity definitions do not enter the numeric env directly.
            continue;
        }

        // Single-field RHS.
        const constructor = matchConstructor(rhs);
        if (constructor) {
            const which = constructor.name;
            const arg = constructor.arg;
            const deps = extractDependencies(arg, new Set([...byName.keys()]));
            const lit = readQuoted(arg);
            let values: VarValue[];
            if (lit !== null && lit.rest.trim() === '') {
                values =
                    which === 'unit'
                        ? [{ unit: parseUnitString(lit.value === '' ? 'u' : lit.value) }]
                        : [lit.value === '' ? '' : (() => {
                              const found = findPrefix(lit.value);
                              if (!found) throw new Error(`${where}: ${name}: "${lit.value}" is not a known prefix`);
                              return found.symbol;
                          })()];
            } else if (/^[A-Za-z][A-Za-z0-9_]*$/.test(arg)) {
                const ref = byName.get(arg);
                if (!ref) throw new Error(`${where}: ${name}: "${arg}" is not defined`);
                if (which === 'unit') {
                    if (ref.valueType === 'unit') {
                        values = [...(ref.values ?? [])];
                    } else if (ref.valueType === 'string') {
                        values = (ref.values ?? []).map((value) => {
                            if (typeof value !== 'string') {
                                throw new Error(`${where}: ${name}: unit pick contains a non-string value`);
                            }
                            return { unit: parseUnitString(value) };
                        });
                    } else {
                        throw new Error(`${where}: ${name}: "${arg}" is not a unit or string variable`);
                    }
                } else {
                    if (ref.valueType === 'prefix') {
                        values = [...(ref.values ?? [])];
                    } else if (ref.valueType === 'string') {
                        values = (ref.values ?? []).map((value) => {
                            if (typeof value !== 'string') {
                                throw new Error(`${where}: ${name}: prefix pick contains a non-string value`);
                            }
                            const text = value;
                            if (text === '') return '';
                            const found = findPrefix(text);
                            if (!found) {
                                throw new Error(`${where}: ${name}: "${text}" is not a known prefix`);
                            }
                            return found.symbol;
                        });
                    } else {
                        throw new Error(`${where}: ${name}: "${arg}" is not a prefix or string variable`);
                    }
                }
            } else {
                const algebra = parseUnitAlgebra(arg, lookup);
                values =
                    which === 'unit'
                        ? [{ unit: algebra.unit, prefix: algebra.prefix }]
                        : [algebra.prefix?.symbol ?? ''];
            }
            pushOrReplace({
                name,
                first: 0,
                last: 0,
                step: 1,
                fixed: values.length === 1,
                kind: which === 'unit' ? 'unit' : 'prefix',
                valueType: which === 'unit' ? 'unit' : 'prefix',
                values,
                dependencies: deps,
            });
            continue;
        }

        // A numeric factor times a unit constructor forms a quantity.
        const quantityProduct =
            /^([+-]?\d+(?:\.\d+)?)\s*\*\s*(.+)$/.exec(rhs) ??
            /^(.+?)\s*\*\s*([+-]?\d+(?:\.\d+)?)$/.exec(rhs);
        if (quantityProduct) {
            const numericText =
                /^[+-]?\d+(?:\.\d+)?$/.test(quantityProduct[1]!)
                    ? quantityProduct[1]!
                    : quantityProduct[2]!;
            const unitText =
                numericText === quantityProduct[1]
                    ? quantityProduct[2]!
                    : quantityProduct[1]!;
            try {
                const algebra = parseUnitAlgebra(unitText, lookup);
                if (algebra.unit.factors.length > 0) {
                    pushOrReplace({
                        name,
                        first: 0,
                        last: 0,
                        step: 1,
                        fixed: true,
                        kind: 'expr',
                        valueType: 'quantity',
                        expr: rhs,
                        quantity: {
                            valueExpr: numericText,
                            fixedValue: Number(numericText),
                            prefix: algebra.prefix?.symbol,
                            unit: algebra.unit,
                        },
                        dependencies: extractDependencies(rhs, new Set([...byName.keys()])),
                    });
                    continue;
                }
            } catch {
                // Fall through.
            }
        }

        // Pure unit algebra over constructors and literal factors.
        if (/\bunit\s*\(|\bprefixUnit\s*\(|['"]/.test(rhs)) {
            try {
                const algebra = parseUnitAlgebra(rhs, lookup);
                if (algebra.unit.factors.length > 0) {
                    const unitValue = { unit: algebra.unit, prefix: algebra.prefix };
                    pushOrReplace({
                        name,
                        first: 0,
                        last: 0,
                        step: 1,
                        fixed: true,
                        kind: 'unit',
                        valueType: 'unit',
                        values: [unitValue],
                        dependencies: extractDependencies(rhs, new Set([...byName.keys()])),
                    });
                    continue;
                }
                if (algebra.prefix) {
                    pushOrReplace({
                        name,
                        first: 0,
                        last: 0,
                        step: 1,
                        fixed: true,
                        kind: 'prefix',
                        valueType: 'prefix',
                        values: [algebra.prefix.symbol],
                        dependencies: extractDependencies(rhs, new Set([...byName.keys()])),
                    });
                    continue;
                }
            } catch {
                // Fall through to the numeric/quantity paths for a clearer error.
            }
        }

        const p = /^pick\((.+)\)$/.exec(rhs);
        if (p) {
            const args = splitArgs(p[1] ?? '');
            if (args.length === 0) throw new Error(`${where}: pick() for ${name} is empty`);

            const quantityValues: QuantityValue[] = [];
            const unitValues: Array<{ unit: UnitExpr; prefix?: import('../../math/units').PrefixDef }> = [];
            const prefixValues: string[] = [];
            let allQuantity = true;
            let allUnit = true;
            let allPrefix = true;
            for (const arg of args) {
                const lit = readQuoted(arg);
                if (lit !== null) {
                    allQuantity = false;
                    allUnit = false;
                    allPrefix = false;
                    continue;
                }
                const quantity = parseQuantityLiteral(arg, lookup, where);
                if (quantity) {
                    quantityValues.push(quantity);
                    allUnit = false;
                    allPrefix = false;
                    continue;
                }
                allQuantity = false;
                const unitAlgebra = /^unit\s*\(|^prefixUnit\s*\(|^[A-Za-z][A-Za-z0-9_]*$/.test(arg)
                    ? (() => {
                          try {
                              return parseUnitAlgebra(arg, lookup);
                          } catch {
                              return null;
                          }
                      })()
                    : null;
                if (unitAlgebra) {
                    if (/^prefixUnit\s*\(/.test(arg) || (unitAlgebra.unit.factors.length === 0 && unitAlgebra.prefix)) {
                        prefixValues.push(unitAlgebra.prefix?.symbol ?? '');
                        allQuantity = false;
                        allUnit = false;
                        continue;
                    }
                    unitValues.push({ unit: unitAlgebra.unit, prefix: unitAlgebra.prefix });
                    allQuantity = false;
                    allPrefix = false;
                    continue;
                }
                allQuantity = false;
                allUnit = false;
                allPrefix = false;
            }

            if (allQuantity && quantityValues.length === args.length) {
                pushOrReplace({
                    name,
                    first: 0,
                    last: 0,
                    step: 1,
                    fixed: false,
                    kind: 'quantityPick',
                    valueType: 'quantity',
                    values: quantityValues,
                    dependencies: [],
                });
                continue;
            }
            if (allUnit && unitValues.length === args.length) {
                pushOrReplace({
                    name,
                    first: 0,
                    last: 0,
                    step: 1,
                    fixed: false,
                    kind: 'unit',
                    valueType: 'unit',
                    values: unitValues,
                    dependencies: [],
                });
                continue;
            }
            if (allPrefix && prefixValues.length === args.length) {
                pushOrReplace({
                    name,
                    first: 0,
                    last: 0,
                    step: 1,
                    fixed: false,
                    kind: 'prefix',
                    valueType: 'prefix',
                    values: prefixValues,
                    dependencies: [],
                });
                continue;
            }

            // Fall back to the numeric/string pick parser.
            const parsed = parsePickArgs(p[1] ?? '', where, name);
            const hasString = parsed.some((part) => part.kind === 'str');
            const hasExpr = parsed.some((part) => part.kind === 'expr');
            if (hasString && (hasExpr || parsed.some((part) => part.kind === 'num'))) {
                throw new Error(`${where}: pick() for ${name} mixes string and numeric values`);
            }
            if (hasString) {
                const values = parsed.map((x) => x.value as string);
                const valueSources = parsed.map((x) => x.source ?? (x.value as string));
                pushOrReplace({
                    name,
                    first: 0,
                    last: 0,
                    step: 1,
                    fixed: false,
                    kind: 'stringPick',
                    valueType: 'string',
                    values,
                    valueSources,
                    dependencies: [],
                });
                stringNames.add(name);
            } else if (!hasExpr) {
                const values = parsed.map((x) => x.value as number);
                const first = values[0] ?? 0;
                const last = values[values.length - 1] ?? first;
                pushOrReplace({
                    name,
                    first,
                    last,
                    step: 1,
                    fixed: false,
                    kind: 'pick',
                    valueType: 'number',
                    values,
                    dependencies: [],
                });
                env[name] = first;
            } else {
                const values = parsed.map((x) => String(x.value));
                let v = 0;
                for (const expr of values) {
                    const substituted = substituteForEval(expr, env, stringNames, `${where}: pick() for ${name}`);
                    checkExpression(substituted, expr, where, lineNo, name, env, stringNames);
                    v = evalIn(substituted, env, stringNames, `${where}: pick() for ${name}`);
                }
                pushOrReplace({
                    name,
                    first: v,
                    last: v,
                    step: 1,
                    fixed: false,
                    kind: 'exprPick',
                    valueType: 'number',
                    values,
                    dependencies: extractDependencies(values.join(' '), new Set([...Object.keys(env), ...byName.keys()])),
                });
                env[name] = v;
            }
            continue;
        }

        const r = parseRand(rhs, where);
        if (r) {
            const def: VarDef = {
                name,
                first: r.first,
                last: r.last,
                step: r.step,
                fixed: false,
                kind: 'rand',
                valueType: 'number',
            };
            if (r.max_index !== undefined) def.max_index = r.max_index;
            pushOrReplace(def);
            env[name] = r.first;
            continue;
        }

        const stringLiteral = readQuoted(rhs);
        if (stringLiteral !== null && stringLiteral.rest.trim() === '') {
            pushOrReplace({
                name,
                first: 0,
                last: 0,
                step: 1,
                fixed: true,
                kind: 'fixed',
                valueType: 'string',
                values: [stringLiteral.value],
                dependencies: [],
            });
            stringNames.add(name);
            continue;
        }

        // A unit algebra expression over previously declared unit/prefix values.
        if (
            /['"]/.test(rhs) ||
            /\bunit\s*\(|\bprefixUnit\s*\(/.test(rhs) ||
            /[*/^]/.test(rhs)
        ) {
            const known = new Set([...byName.keys()]);
            const hasUnit = [...known].some((n) => {
                const d = byName.get(n);
                return d?.valueType === 'unit' || d?.valueType === 'prefix';
            });
            if (hasUnit) {
                const algebra = parseUnitAlgebra(rhs, lookup);
                if (algebra.unit.factors.length > 0) {
                    const unitValue = { unit: algebra.unit, prefix: algebra.prefix };
                    pushOrReplace({
                        name,
                        first: 0,
                        last: 0,
                        step: 1,
                        fixed: true,
                        kind: 'unit',
                        valueType: 'unit',
                        values: [unitValue],
                        dependencies: extractDependencies(rhs, known),
                    });
                    continue;
                }
            }
        }

        // Quantity arithmetic: a = 2 * b, c = a / s^2, etc.
        const quantityKnown = new Set([...byName.keys()]);
        const quantityDeps = extractDependencies(rhs, quantityKnown).filter(
            (dep) => byName.get(dep)?.valueType === 'quantity',
        );
        if (quantityDeps.length > 0) {
            pushOrReplace({
                name,
                first: 0,
                last: 0,
                step: 1,
                fixed: true,
                kind: 'expr',
                valueType: 'quantity',
                expr: rhs,
                dependencies: extractDependencies(rhs, quantityKnown),
            });
            continue;
        }

        if (rhs !== '' && Number.isFinite(Number(rhs))) {
            pushOrReplace({
                name,
                first: Number(rhs),
                last: Number(rhs),
                step: 1,
                fixed: true,
                kind: 'fixed',
                valueType: 'number',
                dependencies: [],
            });
            env[name] = Number(rhs);
            continue;
        }

        const displayRef = findFirstDisplayRef(rhs, displayNames);
        if (displayRef !== null) {
            const displaySource = buildDisplaySource(rhs, env, displayNames);
            displayNames.add(name);
            pushOrReplace({
                name,
                kind: 'display',
                expr: rhs,
                displaySource,
                first: 0,
                last: 0,
                step: 1,
                fixed: false,
                valueType: 'number',
                dependencies: extractDependencies(rhs, new Set([...Object.keys(env), ...byName.keys()])),
            });
            continue;
        }

        const substituted = substituteForEval(rhs, env, stringNames, `${where}: ${name}`);
        checkExpression(substituted, rhs, where, lineNo, name, env, stringNames);
        const v = evalIn(substituted, env, stringNames, `${where}: ${name} = ${rhs}`);
        if (!Number.isFinite(v)) throw new Error(`${where}: ${name} = ${rhs} is not a finite number`);
        pushOrReplace({
            name,
            first: v,
            last: v,
            step: 1,
            fixed: true,
            kind: 'expr',
            valueType: 'number',
            expr: rhs,
            dependencies: extractDependencies(rhs, new Set([...Object.keys(env), ...byName.keys()])),
        });
        env[name] = v;
    }

    return { defs: out, links, warnings, displayNames };
}

export function validateLinks(links: string[][], defs: VarDef[]): void {
    const byName = new Map(defs.map((d) => [d.name, d]));
    const seen = new Set<string>();
    for (const group of links) {
        const label = group.join(', ');
        if (isFlipped(group[0] ?? '')) {
            throw new Error(
                `rv-def: link(${label}): the first member cannot be flipped ("${linkName(group[0]!)}") — ` +
                    'it sets the shared draw index',
            );
        }
        const randMembers: VarDef[] = [];
        let leaderName = linkName(group[0] ?? '');
        let leaderCount: number | null = null;

        for (const member of group) {
            const name = linkName(member);
            const d = byName.get(name);
            if (!d) throw new Error(`rv-def: link(${label}): "${name}" is not defined`);
            if (d.kind === 'fixed' && d.valueType !== 'unit' && d.valueType !== 'prefix') {
                throw new Error(`rv-def: link(${label}): "${name}" is a fixed value, not a drawable set`);
            }
            if (
                d.kind === 'expr' ||
                d.kind === 'display' ||
                (d.valueType === 'quantity' && d.kind !== 'quantityPick')
            ) {
                throw new Error(`rv-def: link(${label}): "${name}" is a computed value, not a drawable set`);
            }
            seen.add(name);
            if (d.kind === 'rand') randMembers.push(d);

            const c = effectiveCount(d);
            if (leaderCount === null) {
                leaderCount = c;
                leaderName = name;
            } else if (leaderCount !== c) {
                const suffix = d.kind === 'rand' && d.max_index !== undefined ? ` (max_index = ${d.max_index})` : '';
                throw new Error(
                    `rv-def: link(${label}): "${name}" has ${c} values${suffix} but "${leaderName}" has ${leaderCount} values. All members must have the same effective count.`,
                );
            }
        }

        if (randMembers.length >= 2) {
            const ref = randMembers[0]!;
            for (let i = 1; i < randMembers.length; i++) {
                const m = randMembers[i]!;
                const same =
                    m.first === ref.first &&
                    m.last === ref.last &&
                    m.step === ref.step &&
                    m.max_index === ref.max_index;
                if (!same) {
                    const fmtRand = (d: VarDef): string =>
                        `rand(${d.first}, ${d.last}, ${d.step}${d.max_index !== undefined ? `, ${d.max_index}` : ''})`;
                    throw new Error(
                        `rv-def: link(${label}): rand variables in a link group must share identical (min, max, step, max_index). "${ref.name}" is ${fmtRand(ref)}; "${m.name}" is ${fmtRand(m)}.`,
                    );
                }
            }
        }
    }
}
