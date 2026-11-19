/**
 * Substitute `<<rv:expr:…>>` / `<<rv:val:…>>` (and their long-form aliases)
 * in question text, answers, distractors, and explanations.
 *
 * Literal render mode — a section header carrying
 * `<!--debug-called-definitions-->` — keeps every placeholder as written instead
 * of resolving it. That section is also exempt from placeholder validation;
 * see `parseNote.ts`.
 *
 * Display-only variables:
 *   - `<<rv:expr:name>>` where name is display-only renders via
 *     `renderDisplaySource` — expands `<rv:val:>` markers, keeps display
 *     markers, normalizes, and strips markers.
 *   - `<<rv:val:name>>` where name is display-only leaves the placeholder
 *     literal (validation at parse time errors first — see parseNote.ts).
 *
 * Quantity definitions:
 *   - `<<rv:value:name>>` / `<<rv:val:name>>` render the formatted quantity.
 *   - `<<rv:expression:name[:args]>>` renders the magnitude source with the
 *     declared unit and declared prefix appended (`withDeclaredUnit`).
 *
 * Cluster normalization inside `<<rv:expr:>>`:
 *   - Recursive through groups; reorder numerics-first; paren-wrap if 2+
 *     numerics OR if a display variable is present; opaque brace groups keep
 *     their braces and wrap adjacent bare numerics.
 */
import { fmt } from '../math';
import { describeUnitLatex, describeUnitWithPrefix, fmtQuantityValue, type PrefixDef, type QuantityValue, type UnitExpr } from '../math/units';
import { isInsideMath, latexIdentifier } from '../math/latex';
import type { UnitValue } from './types';
import {
    DISPLAY_FUNC_WITH_PAREN as FUNC_WITH_PAREN,
    DISPLAY_FUNC_WITH_PAREN_2ARG as FUNC_WITH_PAREN_2ARG,
} from '../math/commands';
import { expandExpressionSource, renderExpression } from '../math/symbolic';

type PlaceholderValue = number | string | QuantityValue | UnitExpr | UnitValue;

function isQuantityValue(value: PlaceholderValue | undefined): value is QuantityValue {
    return typeof value === 'object' && value !== null && 'canonical' in value && 'unit' in value;
}

function isUnitValue(value: PlaceholderValue): value is UnitValue {
    return typeof value === 'object' && value !== null && 'unit' in value && 'factors' in value.unit;
}

function isUnitExpr(value: PlaceholderValue): value is UnitExpr {
    return typeof value === 'object' && value !== null && 'factors' in value;
}

function unitText(unit: UnitExpr, prefix: PrefixDef | undefined, math: boolean): string {
    return math ? describeUnitLatex(unit, prefix) : describeUnitWithPrefix(unit, prefix);
}

/**
 * Value text for a placeholder. `math` is true when the placeholder sits
 * inside `$…$` / `$$…$$`; only then are units and prefixes wrapped in
 * `\text{…}` so `4 cm` does not render as four italic variables.
 */
function placeholderText(value: PlaceholderValue, math = false): string {
    if (isQuantityValue(value)) return fmtQuantityValue(value, 3, { math });
    if (isUnitValue(value)) return unitText(value.unit, value.prefix, math);
    if (isUnitExpr(value)) return unitText(value, undefined, math);
    return typeof value === 'string' ? value : fmt(value);
}

/** A pre-rendered display value, or a formatter that knows the math context. */
export type FormattedValue = string | ((math: boolean) => string);

function formattedText(value: FormattedValue | undefined, math: boolean): string | undefined {
    if (value === undefined) return undefined;
    return typeof value === 'function' ? value(math) : value;
}

const MARK_START = '\u0001';
const MARK_END = '\u0002';
const DISP_START = '\u0003';
const DISP_END = '\u0004';

const DISPLAY_TRANSFORMS: Record<string, (inner: string) => string> = {
    // Standard LaTeX; `\abs` is not defined by MathJax or KaTeX.
    abs: (inner) => `\\left|${inner}\\right|`,
};

// ============================================================================
// Source pretty-printing
// ============================================================================

function prettySource(src: string): string {
    let out = '';
    let i = 0;
    while (i < src.length) {
        let matched = false;

        if (src.charAt(i) === '\\') {
            for (const kw of ['variable', 'var']) {
                const prefix = `\\${kw}{`;
                if (src.startsWith(prefix, i)) {
                    const closeIdx = src.indexOf('}', i + prefix.length);
                    if (closeIdx > 0) {
                        out += latexIdentifier(src.slice(i + prefix.length, closeIdx).trim());
                        i = closeIdx + 1;
                        matched = true;
                        break;
                    }
                }
            }
            if (matched) continue;

            for (const [cmd, transform] of Object.entries(DISPLAY_TRANSFORMS)) {
                const prefix = `\\${cmd}(`;
                if (src.startsWith(prefix, i)) {
                    let depth = 1;
                    let j = i + prefix.length;
                    while (j < src.length && depth > 0) {
                        if (src.charAt(j) === '(') depth++;
                        else if (src.charAt(j) === ')') depth--;
                        j++;
                    }
                    if (depth === 0) {
                        const inner = src.slice(i + prefix.length, j - 1);
                        out += transform(prettySource(inner));
                        i = j;
                        matched = true;
                        break;
                    }
                }
            }
        }
        if (!matched) {
            out += src.charAt(i);
            i++;
        }
    }
    return out;
}

// ============================================================================
// Cluster normalization
// ============================================================================

interface Atom {
    kind: 'num' | 'var';
    base: string;
    exp?: string;
    sub?: string;
    dyn?: boolean;
}

type Segment =
    | { type: 'atom'; atom: Atom }
    | { type: 'group'; open: string; inner: string; close: string }
    | { type: 'struct'; text: string };

function findMatching(src: string, start: number, open: string, close: string): number {
    let depth = 0;
    for (let i = start; i < src.length; i++) {
        if (src[i] === open) depth++;
        else if (src[i] === close) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function parseArgAt(src: string, i: number): [string, number] {
    if (src[i] === '{') {
        const end = findMatching(src, i, '{', '}');
        if (end > 0) return [src.slice(i + 1, end), end + 1];
    }
    if (/[A-Za-z0-9]/.test(src[i] ?? '')) return [src[i]!, i + 1];
    if (src[i] === '\\') {
        const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
        if (m) return ['\\' + m[1], i + m[0].length];
    }
    return ['', i];
}

function parseExpSub(src: string, i: number): [{ type: 'exp' | 'sub'; value: string } | null, number] {
    if (i >= src.length) return [null, i];
    const ch = src[i];
    if (ch !== '^' && ch !== '_') return [null, i];
    const [val, next] = parseArgAt(src, i + 1);
    return [{ type: ch === '^' ? 'exp' : 'sub', value: normalizeCluster(val) }, next];
}

function parseGroupAt(src: string, i: number): [string | null, number] {
    if (src[i] !== '{') return [null, i];
    const end = findMatching(src, i, '{', '}');
    if (end < 0) return [null, i];
    return [src.slice(i + 1, end), end + 1];
}

function tokenizeSource(src: string): Segment[] {
    const segments: Segment[] = [];
    let i = 0;

    while (i < src.length) {
        const ch = src[i]!;

        if (/\s/.test(ch)) {
            segments.push({ type: 'struct', text: ch });
            i++;
            continue;
        }

        // Numeric value marker
        if (ch === MARK_START) {
            const end = src.indexOf(MARK_END, i + 1);
            if (end > 0) {
                const inner = src.slice(i + 1, end);
                i = end + 1;
                const atom: Atom = { kind: 'num', base: inner };
                const [suf, next] = parseExpSub(src, i);
                if (suf) {
                    if (suf.type === 'exp') atom.exp = suf.value;
                    else atom.sub = suf.value;
                    i = next;
                    const [suf2, next2] = parseExpSub(src, i);
                    if (suf2) {
                        if (suf2.type === 'exp' && !atom.exp) atom.exp = suf2.value;
                        else if (suf2.type === 'sub' && !atom.sub) atom.sub = suf2.value;
                        i = next2;
                    }
                }
                segments.push({ type: 'atom', atom });
                continue;
            }
        }

        // Display-var marker
        if (ch === DISP_START) {
            const end = src.indexOf(DISP_END, i + 1);
            if (end > 0) {
                const inner = src.slice(i + 1, end);
                i = end + 1;
                const atom: Atom = { kind: 'var', base: inner, dyn: true };
                const [suf, next] = parseExpSub(src, i);
                if (suf) {
                    if (suf.type === 'exp') atom.exp = suf.value;
                    else atom.sub = suf.value;
                    i = next;
                }
                segments.push({ type: 'atom', atom });
                continue;
            }
        }

        if (ch === '\\') {
            const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
            if (!m) {
                segments.push({ type: 'struct', text: src.slice(i, i + 2) });
                i += 2;
                continue;
            }
            const name = m[1]!;
            i += m[0].length;

            if (name === 'pi') {
                const atom: Atom = { kind: 'var', base: '\\pi' };
                const [suf, next] = parseExpSub(src, i);
                if (suf) {
                    if (suf.type === 'exp') atom.exp = suf.value;
                    else atom.sub = suf.value;
                    i = next;
                }
                segments.push({ type: 'atom', atom });
                continue;
            }

            if (name === 'var' || name === 'variable') {
                const [inner, next] = parseGroupAt(src, i);
                if (inner !== null) {
                    const atom: Atom = { kind: 'var', base: inner };
                    i = next;
                    segments.push({ type: 'atom', atom });
                    continue;
                }
            }

            if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
                const [num, next1] = parseGroupAt(src, i);
                if (num === null) { segments.push({ type: 'struct', text: '\\' + name }); continue; }
                const [den, next2] = parseGroupAt(src, next1);
                if (den === null) { segments.push({ type: 'struct', text: '\\' + name + `{${normalizeCluster(num)}}` }); i = next1; continue; }
                i = next2;
                segments.push({
                    type: 'struct',
                    text: `\\frac{${normalizeCluster(num)}}{${normalizeCluster(den)}}`,
                });
                continue;
            }

            if (name === 'sqrt') {
                let index: string | null = null;
                if (src[i] === '[') {
                    const end = src.indexOf(']', i);
                    if (end > 0) {
                        index = src.slice(i + 1, end);
                        i = end + 1;
                    }
                }
                const [arg, next] = parseGroupAt(src, i);
                if (arg === null) { segments.push({ type: 'struct', text: '\\sqrt' }); continue; }
                i = next;
                const normArg = normalizeCluster(arg);
                const normIdx = index !== null ? normalizeCluster(index) : null;
                segments.push({
                    type: 'struct',
                    text: normIdx !== null ? `\\sqrt[${normIdx}]{${normArg}}` : `\\sqrt{${normArg}}`,
                });
                continue;
            }

            if (FUNC_WITH_PAREN.has(name) || FUNC_WITH_PAREN_2ARG.has(name)) {
                if (src[i] === '(') {
                    const end = findMatching(src, i, '(', ')');
                    if (end > 0) {
                        const inner = src.slice(i + 1, end);
                        i = end + 1;
                        segments.push({
                            type: 'struct',
                            text: `\\${name}(${normalizeCluster(inner)})`,
                        });
                        continue;
                    }
                }
            }

            if (name === 'binom') {
                if (src[i] === '{') {
                    const [n, next1] = parseGroupAt(src, i);
                    if (n !== null) {
                        const [r, next2] = parseGroupAt(src, next1);
                        if (r !== null) {
                            i = next2;
                            segments.push({
                                type: 'struct',
                                text: `\\binom{${normalizeCluster(n)}}{${normalizeCluster(r)}}`,
                            });
                            continue;
                        }
                    }
                } else if (src[i] === '(') {
                    const end = findMatching(src, i, '(', ')');
                    if (end > 0) {
                        const inner = src.slice(i + 1, end);
                        i = end + 1;
                        segments.push({ type: 'struct', text: `\\binom(${normalizeCluster(inner)})` });
                        continue;
                    }
                }
            }

            segments.push({ type: 'struct', text: '\\' + name });
            continue;
        }

        if (/[0-9.]/.test(ch)) {
            const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
            if (!m) { segments.push({ type: 'struct', text: ch }); i++; continue; }
            i += m[0].length;
            const atom: Atom = { kind: 'num', base: m[0] };
            const [suf, next] = parseExpSub(src, i);
            if (suf) {
                if (suf.type === 'exp') atom.exp = suf.value;
                else atom.sub = suf.value;
                i = next;
                const [suf2, next2] = parseExpSub(src, i);
                if (suf2) {
                    if (suf2.type === 'exp' && !atom.exp) atom.exp = suf2.value;
                    else if (suf2.type === 'sub' && !atom.sub) atom.sub = suf2.value;
                    i = next2;
                }
            }
            segments.push({ type: 'atom', atom });
            continue;
        }

        if (/[A-Za-z]/.test(ch)) {
            i++;
            const atom: Atom = { kind: 'var', base: ch };
            const [suf, next] = parseExpSub(src, i);
            if (suf) {
                if (suf.type === 'exp') atom.exp = suf.value;
                else atom.sub = suf.value;
                i = next;
                const [suf2, next2] = parseExpSub(src, i);
                if (suf2) {
                    if (suf2.type === 'exp' && !atom.exp) atom.exp = suf2.value;
                    else if (suf2.type === 'sub' && !atom.sub) atom.sub = suf2.value;
                    i = next2;
                }
            }
            segments.push({ type: 'atom', atom });
            continue;
        }

        if (ch === '{' || ch === '(' || ch === '[') {
            const close = ch === '{' ? '}' : ch === '(' ? ')' : ']';
            const end = findMatching(src, i, ch, close);
            if (end > 0) {
                const inner = src.slice(i + 1, end);
                i = end + 1;
                segments.push({
                    type: 'group',
                    open: ch,
                    inner: normalizeCluster(inner),
                    close,
                });
                continue;
            }
        }

        segments.push({ type: 'struct', text: ch });
        i++;
    }

    return segments;
}

function renderAtom(a: Atom, wrap: boolean): string {
    const exp = a.exp !== undefined ? `^{${a.exp}}` : '';
    const sub = a.sub !== undefined ? `_{${a.sub}}` : '';
    const base = wrap ? `(${a.base})` : a.base;
    return `${base}${exp}${sub}`;
}

export function normalizeCluster(src: string): string {
    const segments = tokenizeSource(src);
    if (segments.length === 0) return src;

    const output: string[] = [];
    let cluster: Atom[] = [];
    let prevNonAtomWasGroup = false;

    const flush = (nextIsGroup: boolean): void => {
        if (cluster.length === 0) return;

        const numerics = cluster.filter((a) => a.kind === 'num');
        const vars = cluster.filter((a) => a.kind === 'var');
        const hasDyn = cluster.some((a) => a.dyn === true);
        const shouldWrapAll = numerics.length >= 2 || hasDyn;
        const singleNumericAdjacentToGroup =
            cluster.length === 1 &&
            numerics.length === 1 &&
            (prevNonAtomWasGroup || nextIsGroup);

        const reordered = [...numerics, ...vars];
        const rendered = reordered.map((a) => {
            const wrap =
                shouldWrapAll || (singleNumericAdjacentToGroup && a.kind === 'num');
            return renderAtom(a, wrap);
        });
        output.push(rendered.join(''));
        cluster = [];
    };

    for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx]!;
        if (seg.type === 'atom') {
            cluster.push(seg.atom);
            continue;
        }
        const next = segments[idx + 1];
        const nextIsGroup = next !== undefined && next.type === 'group';
        flush(nextIsGroup);

        if (seg.type === 'group') {
            output.push(seg.open + seg.inner + seg.close);
            prevNonAtomWasGroup = true;
        } else {
            output.push(seg.text);
            prevNonAtomWasGroup = false;
        }
    }
    flush(false);

    // Strip any leftover markers (should not appear in output, but safe).
    return output
        .join('')
        .split(MARK_START).join('')
        .split(MARK_END).join('')
        .split(DISP_START).join('')
        .split(DISP_END).join('');
}

// ============================================================================
// Placeholder resolution
// ============================================================================

/**
 * Render a display-only variable's source: expand `<<rv:val:>>` placeholders
 * to markers, recurse into any nested exprs, normalize the cluster, strip
 * markers, return the final LaTeX string.
 */
function renderDisplaySource(
    displaySource: string,
    values: Record<string, PlaceholderValue>,
    sources: Record<string, PlaceholderValue>,
    displaySources: Record<string, string>,
    math: boolean,
    formatted?: Record<string, FormattedValue>,
): string {
    const expanded = displaySource.replace(
        /<<rv:(expr|exprs|val|values|value):([^>]*?)>>/g,
        (match, kind: string, raw: string) => {
            const name = raw.trim();
            if (kind === 'val' || kind === 'values' || kind === 'value') {
                const preset = formattedText(formatted?.[name], math);
                if (preset !== undefined) return `${MARK_START}${preset}${MARK_END}`;
                const v = values[name];
                if (v === undefined) return match;
                return `${MARK_START}${placeholderText(v, math)}${MARK_END}`;
            }
            if (name in displaySources) {
                return renderDisplaySource(
                    displaySources[name]!,
                    values,
                    sources,
                    displaySources,
                    math,
                    formatted,
                );
            }
            const src = sources[name];
            if (src === undefined) return match;
            const pretty = typeof src === 'string' ? prettySource(src) : placeholderText(src, math);
            return fillCore(pretty, values, sources, displaySources, true, math, formatted);
        },
    );
    return normalizeCluster(prettySource(expanded));
}

function valueText(
    name: string,
    values: Record<string, PlaceholderValue>,
    math: boolean,
    formatted?: Record<string, FormattedValue>,
): string | undefined {
    const preset = formattedText(formatted?.[name], math);
    if (preset !== undefined) return preset;
    const value = values[name];
    if (value === undefined) return undefined;
    return placeholderText(value, math);
}

/**
 * An expression placeholder whose definition is a quantity renders the
 * declared unit (and declared prefix) after the magnitude source — the
 * declared data type decides the form. A dimensionless quantity appends
 * nothing.
 */
function withDeclaredUnit(
    name: string,
    values: Record<string, PlaceholderValue>,
    rendered: string,
    math: boolean,
): string {
    const value = values[name];
    if (!isQuantityValue(value)) return rendered;
    const unit = unitText(value.unit, value.prefix, math);
    if (unit === '') return rendered;
    return math ? `${rendered}\\,${unit}` : `${rendered} ${unit}`;
}

function resolveOne(
    kind: string,
    payload: string,
    values: Record<string, PlaceholderValue>,
    sources: Record<string, PlaceholderValue>,
    displaySources: Record<string, string>,
    math: boolean,
    formatted?: Record<string, FormattedValue>,
): string {
    const parsed = parsePayload(payload);
    const name = parsed.name;
    if (kind === 'val' || kind === 'values' || kind === 'value') {
        return valueText(name, values, math, formatted) ?? `<<rv:${kind}:${payload}>>`;
    }
    if (name in displaySources) {
        return renderDisplaySource(displaySources[name]!, values, sources, displaySources, math, formatted);
    }
    const src = sources[name];
    if (src === undefined) return `<<rv:expression:${payload}>>`;
    if (typeof src !== 'string') return placeholderText(src, math);
    if (typeof values[name] === 'string') return src;
    const env = new Map<string, number>();
    for (const arg of parsed.args) {
        const value = values[arg];
        if (typeof value !== 'number') {
            throw new Error(
                `<<rv:expression:${payload}>>: "${arg}" is not a numeric variable`,
            );
        }
        env.set(arg, value);
    }
    const numericValues: Record<string, number | string> = {};
    for (const [key, value] of Object.entries(values)) {
        if (typeof value === 'number' || typeof value === 'string') numericValues[key] = value;
    }
    const expanded = expandExpressionSource(src, numericValues);
    return withDeclaredUnit(name, values, renderExpression(expanded, { values: env }), math);
}

/**
 * Single-pass fill: walk the text and substitute each placeholder.
 * `inExprSource` normalizes the result as an expression cluster; `inheritedMath`
 * says whether the enclosing source is already inside math.
 */
function fillCore(
    text: string,
    values: Record<string, PlaceholderValue>,
    sources: Record<string, PlaceholderValue>,
    displaySources: Record<string, string>,
    inExprSource: boolean,
    inheritedMath: boolean,
    formatted?: Record<string, FormattedValue>,
): string {
    let output = '';
    let lastEnd = 0;
    const re = /<<rv:(expression|val|values|value):([^>]*?)>>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        output += text.slice(lastEnd, start);
        const math = inheritedMath || isInsideMath(text, start);
        output += resolveOne(m[1]!, m[2] ?? '', values, sources, displaySources, math, formatted);
        lastEnd = end;
    }
    output += text.slice(lastEnd);

    if (inExprSource) {
        output = normalizeCluster(output);
    }
    return output;
}

export interface FillOptions {
    /**
     * Pre-formatted display text per bound name. Quantity answers bind their
     * value to the formatted quantity so `<<rv:val:x>>` and `<<rv:value:x>>`
     * render alike in every section. A formatter receives whether the
     * placeholder sits inside math, so units can be wrapped in `\text{…}`.
     */
    formatted?: Record<string, FormattedValue>;
    /**
     * Literal render mode (`<!--debug-called-definitions-->`): leave every
     * placeholder exactly as written instead of resolving it.
     */
    literal?: boolean;
}

/**
 * Replace typed placeholders in `text`.
 *
 * In literal mode the text is returned unchanged so the placeholder source is
 * displayed as plaintext. See module docblock.
 */
export function fillPlaceholders(
    text: string,
    values: Record<string, PlaceholderValue>,
    sources?: Record<string, PlaceholderValue>,
    displaySources?: Record<string, string>,
    options?: FillOptions,
): string {
    if (options?.literal) return text;
    return fillCore(
        text,
        values,
        sources ?? {},
        displaySources ?? {},
        false,
        false,
        options?.formatted,
    );
}

// ============================================================================
// Placeholder extraction (validation)
// ============================================================================

export interface PlaceholderRef {
    kind: 'expression' | 'val';
    name: string;
    args: string[];
}

function parsePayload(payload: string): { name: string; args: string[] } {
    const parts = payload.split(':').map((part) => {
        const trimmed = part.trim();
        if (
            trimmed.length >= 2 &&
            ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
                (trimmed.startsWith("'") && trimmed.endsWith("'")))
        ) {
            return trimmed.slice(1, -1).trim();
        }
        return trimmed;
    });
    return { name: parts[0] ?? '', args: parts.slice(1).filter(Boolean) };
}

/**
 * Extract every `<<rv:expression:...>>` / `<<rv:val:...>>` (and `values`)
 * from `text`. Callers skip sections in literal render mode.
 */
export function extractPlaceholders(text: string): PlaceholderRef[] {
    const refs: PlaceholderRef[] = [];
    const re = /<<rv:(expression|val|values|value):([^>]*?)>>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const payload = parsePayload(m[2] ?? '');
        refs.push({
            kind: m[1] === 'expression' ? 'expression' : 'val',
            name: payload.name,
            args: payload.args,
        });
    }
    return refs;
}