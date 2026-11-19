/**
 * Tiny evaluator for the LaTeX subset used in `rv-def` expressions:
 * numbers, single-letter variables, explicit `\var{name}` / `\variable{name}`
 * references, + - \cdot \times * /, ^, \frac{}{}, \sqrt{}, \sqrt[n]{}, ( ), { },
 * commas, functions (see FUNC_ONE_ARG / FUNC_TWO_ARG), \binom{n}{r}, \C(n, r),
 * \P(n, r), \pi, e, and x^{\circ} degree literals.
 * Adjacent terms multiply (`ax` = a times x).
 */
import { tokenize, type Tok } from './tokenizer';
import {
    BIG_OPERATORS,
    DISPLAY_ONLY_COMMANDS,
    EVAL_FUNC_ONE_ARG as FUNC_ONE_ARG,
    EVAL_FUNC_TWO_ARG as FUNC_TWO_ARG,
    LATEX_SYMBOL_COMMANDS,
} from './commands';

/** Largest number of iterations a `\sum` / `\prod` body may run. */
const MAX_BIG_OP_RANGE = 10_000;

/** Samples used by the limit/derivative extrapolation. */
const CALCULUS_STEPS = 14;

interface Extrapolation {
    value: number;
    converged: boolean;
}

/**
 * Richardson extrapolation over a halving-step sequence.
 *
 * `ratio` is 2 for sequences whose error is O(h), and 4 for O(h²). Samples may
 * contain `NaN`/`±Infinity`; only the longest finite suffix is used, and the
 * convergence flag is false when the diagonal never settles.
 */
function extrapolate(samples: number[], ratio: number, tolerance = 1e-6): Extrapolation | null {
    let end = samples.length - 1;
    while (end >= 0 && !Number.isFinite(samples[end]!)) end--;
    if (end < 1) return null;
    let start = end;
    while (start > 0 && Number.isFinite(samples[start - 1]!)) start--;
    const seq = samples.slice(start, end + 1);
    if (seq.length < 2) return null;

    const rows: number[][] = [];
    let converged = false;
    let value = seq[seq.length - 1]!;
    let bestDiff = Infinity;
    for (let k = 0; k < seq.length; k++) {
        const row = [seq[k]!];
        for (let j = 1; j <= k; j++) {
            const factor = Math.pow(ratio, j);
            row.push((factor * row[j - 1]! - rows[k - 1]![j - 1]!) / (factor - 1));
        }
        rows.push(row);
        const diagonal = row[k]!;
        if (k > 0) {
            const previous = rows[k - 1]![k - 1]!;
            const diff = Math.abs(diagonal - previous);
            if (diff <= tolerance * Math.max(1, Math.abs(diagonal))) converged = true;
            if (diff < bestDiff) {
                bestDiff = diff;
                value = diagonal;
            }
        }
    }
    return Number.isFinite(value) ? { value, converged } : null;
}

/** Divergence test for a sequence whose magnitude keeps growing. */
function diverges(samples: number[]): number | null {
    const finite = samples.filter((v) => Number.isFinite(v));
    if (finite.length < 5) return null;
    const tail = finite.slice(-5);
    if (!tail.every((v) => Math.abs(v) > 1e3)) return null;
    const sign = Math.sign(tail[0]!);
    if (sign === 0) return null;
    for (const value of tail) {
        if (Math.sign(value) !== sign) return null;
    }
    // Halving the distance should roughly double a 1/h divergence.
    if (Math.abs(tail[tail.length - 1]!) < 4 * Math.abs(tail[0]!)) return null;
    return sign > 0 ? Infinity : -Infinity;
}

/**
 * One-sided numerical limit. Returns a finite number, `±Infinity` when that
 * side diverges consistently, or `NaN` when the side does not converge.
 */
function oneSidedLimit(f: (x: number) => number, x0: number, side: 1 | -1): number {
    const scale = Math.max(1, Math.abs(x0));
    const samples: number[] = [];
    for (let k = 0; k < CALCULUS_STEPS; k++) {
        const h = 0.5 * scale * Math.pow(0.5, k);
        samples.push(f(side > 0 ? x0 + h : x0 - h));
    }

    const infinities = samples.filter((v) => v === Infinity || v === -Infinity);
    if (infinities.length > 0) {
        if (infinities.every((v) => v === Infinity)) return Infinity;
        if (infinities.every((v) => v === -Infinity)) return -Infinity;
        return NaN;
    }

    const growth = diverges(samples);
    if (growth !== null) return growth;

    const result = extrapolate(samples, 2);
    return result !== null && result.converged ? result.value : NaN;
}

/**
 * Two-sided numerical limit: finite only when both one-sided limits exist and
 * agree. Mismatched, non-convergent, or one-sided-infinite cases are `NaN`.
 */
function twoSidedLimit(f: (x: number) => number, x0: number): number {
    const left = oneSidedLimit(f, x0, -1);
    const right = oneSidedLimit(f, x0, 1);
    if (Number.isNaN(left) || Number.isNaN(right)) return NaN;
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return left === right ? left : NaN;
    }
    const scale = Math.max(1, Math.abs(left), Math.abs(right));
    if (Math.abs(left - right) > 1e-6 * scale) return NaN;
    return (left + right) / 2;
}

/** One-sided derivative by extrapolated forward/backward differences. */
function oneSidedDerivative(
    f: (x: number) => number,
    x0: number,
    side: 1 | -1,
): number {
    const scale = Math.max(1, Math.abs(x0));
    const samples: number[] = [];
    for (let k = 0; k < CALCULUS_STEPS; k++) {
        const h = 0.1 * scale * Math.pow(0.5, k);
        samples.push((f(x0 + side * h) - f(x0)) / (side * h));
    }
    const result = extrapolate(samples, 2);
    return result !== null && result.converged ? result.value : NaN;
}

/** Derivative at a point; `NaN` when the two sides disagree. */
function derivativeAt(f: (x: number) => number, x0: number): number {
    const left = oneSidedDerivative(f, x0, -1);
    const right = oneSidedDerivative(f, x0, 1);
    if (Number.isNaN(left) || Number.isNaN(right)) return NaN;
    const scale = Math.max(1, Math.abs(left), Math.abs(right));
    if (Math.abs(left - right) > 1e-5 * scale) return NaN;
    return (left + right) / 2;
}

/** nth derivative, by recursive numerical differentiation (n ≤ 4). */
function nthDerivative(f: (x: number) => number, x0: number, order: number): number {
    let g = f;
    for (let i = 0; i < order; i++) {
        const previous = g;
        g = (x: number) => derivativeAt(previous, x);
    }
    return g(x0);
}

function simpson(fa: number, fm: number, fb: number, a: number, b: number): number {
    return ((b - a) / 6) * (fa + 4 * fm + fb);
}

/** Adaptive Simpson with a bounded recursion depth. */
function adaptiveSimpson(
    f: (x: number) => number,
    a: number,
    b: number,
    fa: number,
    fm: number,
    fb: number,
    whole: number,
    eps: number,
    depth: number,
): number {
    const m = (a + b) / 2;
    const lm = (a + m) / 2;
    const rm = (m + b) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(fa, flm, fm, a, m);
    const right = simpson(fm, frm, fb, m, b);
    const delta = left + right - whole;
    if (depth <= 0 || !Number.isFinite(delta) || Math.abs(delta) <= 15 * eps) {
        return left + right + delta / 15;
    }
    return (
        adaptiveSimpson(f, a, m, fa, flm, fm, left, eps / 2, depth - 1) +
        adaptiveSimpson(f, m, b, fm, frm, fb, right, eps / 2, depth - 1)
    );
}

/** Definite integral over `[a, b]`; `NaN` when it cannot be evaluated. */
function numericIntegral(f: (x: number) => number, a: number, b: number): number {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    const sign = a <= b ? 1 : -1;
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    if (lo === hi) return 0;

    // Open the interval slightly when an endpoint is singular (`1/sqrt(x)` at 0).
    const nudge = Math.max(1, Math.abs(hi - lo)) * 1e-8;
    for (let i = 0; i < 8 && !Number.isFinite(f(lo)); i++) lo += nudge;
    for (let i = 0; i < 8 && !Number.isFinite(f(hi)); i++) hi -= nudge;
    if (!(lo < hi)) return NaN;

    const fa = f(lo);
    const fb = f(hi);
    const fm = f((lo + hi) / 2);
    if (!Number.isFinite(fa) || !Number.isFinite(fb) || !Number.isFinite(fm)) return NaN;
    const whole = simpson(fa, fm, fb, lo, hi);
    const result = adaptiveSimpson(f, lo, hi, fa, fm, fb, whole, 1e-10, 25);
    return Number.isFinite(result) ? sign * result : NaN;
}

function applyOneArg(name: string, x: number): number {
    switch (name) {
        case 'sin': return Math.sin(x);
        case 'cos': return Math.cos(x);
        case 'tan': return Math.tan(x);
        case 'arcsin': return Math.asin(x);
        case 'arccos': return Math.acos(x);
        case 'arctan': return Math.atan(x);
        case 'csc': return 1 / Math.sin(x);
        case 'sec': return 1 / Math.cos(x);
        case 'cot': return 1 / Math.tan(x);
        case 'log': return Math.log10(x);
        case 'ln': return Math.log(x);
        case 'exp': return Math.exp(x);
        case 'abs': return Math.abs(x);
        case 'round': return Math.round(x);
        case 'radToDeg': return (x * 180) / Math.PI;
        case 'degToRad': return (x * Math.PI) / 180;
        default: throw new Error(`Unknown function \\${name}`);
    }
}

function applyTwoArg(name: string, a: number, b: number): number {
    switch (name) {
        case 'min': return Math.min(a, b);
        case 'max': return Math.max(a, b);
        case 'roundTo': {
            const factor = Math.pow(10, b);
            return Math.round(a * factor) / factor;
        }
        // Combinatorics aliases: `\perm(n, r)` = nPr, `\comb(n, r)` = nCr.
        case 'perm': return permutations(a, b);
        case 'comb': return binomial(a, b);
        default: throw new Error(`Unknown function \\${name}`);
    }
}

function factorial(n: number): number {
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return NaN;
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

/** Postfix `!` — throws a readable error instead of returning NaN. */
function factorialChecked(n: number): number {
    const v = factorial(n);
    if (Number.isNaN(v)) {
        throw new Error(`Factorial needs a non-negative integer (got ${n})`);
    }
    return v;
}

function binomial(n: number, r: number): number {
    if (!Number.isFinite(n) || !Number.isFinite(r)) return NaN;
    if (!Number.isInteger(n) || !Number.isInteger(r)) return NaN;
    if (n < 0 || r < 0 || r > n) return NaN;
    return factorial(n) / (factorial(r) * factorial(n - r));
}

function permutations(n: number, r: number): number {
    if (!Number.isFinite(n) || !Number.isFinite(r)) return NaN;
    if (!Number.isInteger(n) || !Number.isInteger(r)) return NaN;
    if (n < 0 || r < 0 || r > n) return NaN;
    return factorial(n) / factorial(n - r);
}

class Parser {
    private pos = 0;

    constructor(
        private toks: Tok[],
        private env: Record<string, number>,
    ) {}

    run(): number {
        const v = this.expr();
        if (this.pos < this.toks.length) throw new Error('Unexpected trailing input');
        return v;
    }

    private is(type: Tok['t'], v: string): boolean {
        const t = this.toks[this.pos];
        return t !== undefined && t.t === type && t.v === v;
    }

    private expect(v: string): void {
        if (!this.is('op', v)) throw new Error(`Expected "${v}"`);
        this.pos++;
    }

    private expr(): number {
        let v = this.term();
        for (;;) {
            if (this.is('op', '+')) {
                this.pos++;
                v += this.term();
            } else if (this.is('op', '-')) {
                this.pos++;
                v -= this.term();
            } else return v;
        }
    }

    private startsFactor(): boolean {
        const t = this.toks[this.pos];
        if (!t) return false;
        if (t.t === 'num' || t.t === 'id' || t.t === 'ref') return true;
        if (t.t === 'op') return t.v === '(' || t.v === '{';
        // cmd: cdot/times are binary ops; circ is a postfix degree marker.
        // Everything else (\frac, \sqrt, \sin, \pi, \binom, …) starts a factor.
        return t.v !== 'cdot' && t.v !== 'times' && t.v !== 'circ';
    }

    private term(): number {
        let v = this.unary();
        for (;;) {
            if (this.is('cmd', 'cdot') || this.is('cmd', 'times') || this.is('op', '*')) {
                this.pos++;
                v *= this.unary();
            } else if (this.is('op', '/')) {
                this.pos++;
                v /= this.unary();
            } else if (this.startsFactor()) {
                v *= this.unary();
            } else return v;
        }
    }

    private unary(): number {
        if (this.is('op', '-')) {
            this.pos++;
            return -this.unary();
        }
        if (this.is('op', '+')) {
            this.pos++;
            return this.unary();
        }
        const base = this.atom();
        // Postfix factorial: `5!`, `(n+1)!` — binds tighter than `^`.
        let value = base;
        while (this.is('op', '!')) {
            this.pos++;
            value = factorialChecked(value);
        }
        if (this.is('op', '^')) {
            this.pos++;
            // Degree literal: base^{\circ} → base · π/180
            if (
                this.is('op', '{') &&
                this.toks[this.pos + 1]?.t === 'cmd' &&
                this.toks[this.pos + 1]?.v === 'circ' &&
                this.toks[this.pos + 2]?.t === 'op' &&
                this.toks[this.pos + 2]?.v === '}'
            ) {
                this.pos += 3;
                return (value * Math.PI) / 180;
            }
            return Math.pow(value, this.exponent());
        }
        return value;
    }

    private exponent(): number {
        if (this.is('op', '-')) {
            this.pos++;
            return -this.exponent();
        }
        let value: number;
        if (this.is('op', '{')) {
            value = this.group();
        } else if (this.is('op', '(')) {
            value = this.atom();
        } else {
            const t = this.toks[this.pos];
            // `x^\var{n}` and `x^a` are both legal — accept id and ref.
            if (t && (t.t === 'num' || t.t === 'id' || t.t === 'ref')) value = this.atom();
            else throw new Error('Bad exponent');
        }
        // Power chains are right-associative: a^b^c === a^(b^c).
        if (this.is('op', '^')) {
            this.pos++;
            return Math.pow(value, this.exponent());
        }
        return value;
    }

    private group(): number {
        this.expect('{');
        const v = this.expr();
        this.expect('}');
        return v;
    }

    private parenExpr(): number {
        this.expect('(');
        const v = this.expr();
        this.expect(')');
        return v;
    }

    /**
     * Merge a trailing `_sub` / `_{sub}` into the variable name so `x_i`
     * resolves the same key the rv-def LHS declared.
     */
    private subscriptedName(base: string): string {        if (!this.is('op', '_')) return base;
        this.pos++;
        const t = this.toks[this.pos];
        if (t && (t.t === 'id' || t.t === 'ref')) {
            this.pos++;
            return `${base}_${t.v}`;
        }
        if (t && t.t === 'num') {
            this.pos++;
            return `${base}_${t.v}`;
        }
        if (this.is('op', '{')) {
            this.pos++;
            let sub = '';
            while (!this.is('op', '}')) {
                const inner = this.toks[this.pos];
                if (!inner) throw new Error('Missing "}" in subscript');
                sub += inner.t === 'num' ? String(inner.v) : String(inner.v);
                this.pos++;
            }
            this.expect('}');
            if (sub === '') throw new Error('Empty subscript');
            return `${base}_${sub}`;
        }
        throw new Error('Expected a subscript after "_"');
    }

    /**
     * `\sum_{i=a}^{b} body` / `\prod_{i=a}^{b} body`. The body runs to the end
     * of the current **term**, so `\sum_{i=1}^{5} i + 1` is `(Σ i) + 1`.
     */
    private bigOperator(name: 'sum' | 'prod'): number {
        if (!this.is('op', '_')) {
            throw new Error(`\\${name} needs a lower limit: \\${name}_{i=1}^{n}`);
        }
        this.pos++;
        this.expect('{');
        const indexToken = this.toks[this.pos];
        if (!indexToken || indexToken.t !== 'id') {
            throw new Error(`\\${name}: the lower limit must start with an index, e.g. _{i=1}`);
        }
        const index = indexToken.v;
        this.pos++;
        if (!this.is('op', '=')) {
            throw new Error(`\\${name}: the lower limit must be index=value, e.g. _{i=1}`);
        }
        this.pos++;
        const from = this.expr();
        this.expect('}');
        if (!this.is('op', '^')) {
            throw new Error(`\\${name} needs an upper limit: \\${name}_{i=1}^{n}`);
        }
        this.pos++;
        this.expect('{');
        const to = this.expr();
        this.expect('}');

        if (!Number.isInteger(from) || !Number.isInteger(to)) {
            throw new Error(`\\${name}: the limits must be integers`);
        }
        const steps = Math.abs(to - from) + 1;
        if (steps > MAX_BIG_OP_RANGE) {
            throw new Error(
                `\\${name}: ${steps} iterations exceeds the limit of ${MAX_BIG_OP_RANGE}`,
            );
        }

        const bodyStart = this.pos;
        if (!this.startsFactor()) throw new Error(`\\${name} has no body`);

        const hadIndex = index in this.env;
        const previous = this.env[index];
        let acc = name === 'sum' ? 0 : 1;
        try {
            const step = from <= to ? 1 : -1;
            for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
                this.env[index] = i;
                this.pos = bodyStart;
                const v = this.term();
                acc = name === 'sum' ? acc + v : acc * v;
            }
            // The last pass already left `pos` just past the body.
        } finally {
            if (hadIndex) this.env[index] = previous!;
            else delete this.env[index];
        }
        return acc;
    }

    /**
     * A limit point: like a term, but it does not consume `^`, so a trailing
     * `^{+}` / `^{-}` stays available as the side marker.
     */
    private limitPoint(): number {
        let value = this.signedAtom();
        for (;;) {
            if (this.is('cmd', 'cdot') || this.is('cmd', 'times') || this.is('op', '*')) {
                this.pos++;
                value *= this.signedAtom();
            } else if (this.is('op', '/')) {
                this.pos++;
                value /= this.signedAtom();
            } else if (this.startsFactor()) {
                value *= this.signedAtom();
            } else {
                return value;
            }
        }
    }

    private signedAtom(): number {
        if (this.is('op', '-')) {
            this.pos++;
            return -this.signedAtom();
        }
        if (this.is('op', '+')) {
            this.pos++;
            return this.signedAtom();
        }
        return this.atom();
    }

    /** Evaluate the body at `variable = value`, leaving `pos` past the body. */
    private calculusBody(start: number, variable: string, value: number): number {
        const had = variable in this.env;
        const previous = this.env[variable];
        this.env[variable] = value;
        this.pos = start;
        try {
            return this.term();
        } finally {
            if (had) this.env[variable] = previous!;
            else delete this.env[variable];
        }
    }

    /** Same as {@link calculusBody}, with the token stream cut at `end`. */
    private calculusSlice(start: number, end: number, variable: string, value: number): number {
        const full = this.toks;
        const had = variable in this.env;
        const previous = this.env[variable];
        try {
            this.toks = full.slice(0, end);
            this.env[variable] = value;
            this.pos = start;
            return this.term();
        } finally {
            this.toks = full;
            this.pos = end;
            if (had) this.env[variable] = previous!;
            else delete this.env[variable];
        }
    }

    /** Index just past the current term, respecting nested brackets. */
    private bodyEnd(): number {
        let depth = 0;
        let i = this.pos;
        while (i < this.toks.length) {
            const token = this.toks[i]!;
            if (token.t === 'op') {
                if (token.v === '(' || token.v === '[' || token.v === '{') depth++;
                else if (token.v === ')' || token.v === ']' || token.v === '}') {
                    if (depth === 0) break;
                    depth--;
                } else if (
                    depth === 0 &&
                    (token.v === '+' ||
                        token.v === '-' ||
                        token.v === ',' ||
                        token.v === '=' ||
                        token.v === '|')
                ) {
                    break;
                }
            }
            i++;
        }
        return i;
    }

    /** `… dx` at the end of a term — the integration variable. */
    private trailingDifferential(end: number): { index: number; name: string } | null {
        const name = this.toks[end - 1];
        const d = this.toks[end - 2];
        if (
            d?.t === 'id' && d.v === 'd' &&
            name !== undefined && (name.t === 'id' || name.t === 'ref') &&
            end - 2 > this.pos
        ) {
            return { index: end - 2, name: name.v };
        }
        return null;
    }

    /**
     * `\lim_{x \to a} body`, with optional `a^{+}` / `a^{-}`.
     * Two-sided limits are finite only when both sides agree; otherwise the
     * result is `NaN` (undefined). Agreeing infinite sides yield ±Infinity.
     */
    private limitOperator(): number {
        if (!this.is('op', '_')) {
            throw new Error('\\lim needs a limit: \\lim_{x \\to a}');
        }
        this.pos++;
        this.expect('{');
        const variableToken = this.toks[this.pos];
        if (!variableToken || (variableToken.t !== 'id' && variableToken.t !== 'ref')) {
            throw new Error('\\lim: the limit must start with a variable, e.g. _{x \\to 0}');
        }
        const variable = variableToken.v;
        this.pos++;
        if (!this.is('cmd', 'to')) {
            throw new Error('\\lim: expected \\to, e.g. _{x \\to 0}');
        }
        this.pos++;
        const point = this.limitPoint();

        let side: 0 | 1 | -1 = 0;
        if (this.is('op', '^')) {
            this.pos++;
            const braced = this.is('op', '{');
            if (braced) this.pos++;
            const sign = this.toks[this.pos];
            if (sign?.t === 'op' && (sign.v === '+' || sign.v === '-')) {
                side = sign.v === '+' ? 1 : -1;
                this.pos++;
            } else {
                throw new Error('\\lim: use ^{+} or ^{-} for a one-sided limit');
            }
            if (braced) this.expect('}');
        } else if (this.is('op', '+') || this.is('op', '-')) {
            side = this.toks[this.pos]!.v === '+' ? 1 : -1;
            this.pos++;
        }
        this.expect('}');

        const bodyStart = this.pos;
        if (!this.startsFactor()) throw new Error('\\lim has no body');
        const body = (x: number): number => this.calculusBody(bodyStart, variable, x);
        return side === 0 ? twoSidedLimit(body, point) : oneSidedLimit(body, point, side);
    }

    /**
     * Detect `\frac{d}{dx}` / `\frac{d^{n}}{dx^{n}}`. Returns the variable,
     * order, and the token index just after the denominator.
     */
    private derivativeSpec(): { variable: string; order: number; after: number } | null {
        const toks = this.toks;
        const p = this.pos;
        if (!(toks[p]?.t === 'op' && toks[p]!.v === '{')) return null;
        if (!(toks[p + 1]?.t === 'id' && toks[p + 1]!.v === 'd')) return null;

        let order = 1;
        let after = p + 2;
        if (toks[after]?.t === 'op' && toks[after]!.v === '^') {
            if (!(toks[after + 1]?.t === 'op' && toks[after + 1]!.v === '{')) return null;
            const value = toks[after + 2];
            if (!value || value.t !== 'num') return null;
            order = value.v;
            if (!(toks[after + 3]?.t === 'op' && toks[after + 3]!.v === '}')) return null;
            after += 4;
        }
        if (!(toks[after]?.t === 'op' && toks[after]!.v === '}')) return null;
        after++;

        if (!(toks[after]?.t === 'op' && toks[after]!.v === '{')) return null;
        if (!(toks[after + 1]?.t === 'id' && toks[after + 1]!.v === 'd')) return null;
        const variableToken = toks[after + 2];
        if (!variableToken || (variableToken.t !== 'id' && variableToken.t !== 'ref')) {
            return null;
        }
        const variable = variableToken.v;
        after += 3;

        let denominatorOrder = 1;
        if (toks[after]?.t === 'op' && toks[after]!.v === '^') {
            if (!(toks[after + 1]?.t === 'op' && toks[after + 1]!.v === '{')) return null;
            const value = toks[after + 2];
            if (!value || value.t !== 'num') return null;
            denominatorOrder = value.v;
            if (!(toks[after + 3]?.t === 'op' && toks[after + 3]!.v === '}')) return null;
            after += 4;
        }
        if (!(toks[after]?.t === 'op' && toks[after]!.v === '}')) return null;
        after++;

        if (denominatorOrder !== order) return null;
        if (!Number.isInteger(order) || order < 1 || order > 4) {
            throw new Error('the derivative order must be an integer from 1 to 4');
        }
        return { variable, order, after };
    }

    private isDerivativeFraction(): boolean {
        return this.derivativeSpec() !== null;
    }

    /**
     * `\frac{d}{dx} body \bigg|_{x=a}` — numerical derivative at a point.
     * Without an evaluation bar, the current value of the variable is used.
     */
    private derivativeFraction(): number {
        const spec = this.derivativeSpec();
        if (!spec) throw new Error('Expected a derivative fraction');
        this.pos = spec.after;
        const bodyStart = this.pos;
        if (!this.startsFactor()) {
            throw new Error(`\\frac{d}{d${spec.variable}} has no body`);
        }
        const end = this.bodyEnd();
        const f = (x: number): number =>
            this.calculusSlice(bodyStart, end, spec.variable, x);
        this.pos = end;

        let point: number | undefined;
        if (this.is('op', '|')) {
            this.pos++;
            this.expect('_');
            this.expect('{');
            const barVariable = this.toks[this.pos];
            if (!barVariable || (barVariable.t !== 'id' && barVariable.t !== 'ref')) {
                throw new Error('the evaluation bar must be written |_{x=a}');
            }
            this.pos++;
            if (barVariable.v !== spec.variable) {
                throw new Error(
                    `the evaluation bar variable "${barVariable.v}" must match d${spec.variable}`,
                );
            }
            if (!this.is('op', '=')) {
                throw new Error('the evaluation bar must be written |_{x=a}');
            }
            this.pos++;
            point = this.expr();
            this.expect('}');
        }

        if (point === undefined) {
            const at = this.env[spec.variable];
            if (typeof at !== 'number') {
                throw new Error(
                    `\\frac{d}{d${spec.variable}}: "${spec.variable}" has no value to differentiate at — append \\bigg|_{${spec.variable}=a}`,
                );
            }
            point = at;
        }
        const resume = this.pos;
        const result = nthDerivative(f, point, spec.order);
        this.pos = resume;
        return result;
    }

    /**
     * `\int_{a}^{b} body dx` or `\int_{x=a}^{b} body` — numerical definite
     * integral. Indefinite integration is intentionally unsupported.
     */
    private integralOperator(): number {
        if (!this.is('op', '_')) {
            throw new Error('\\int needs limits: \\int_{a}^{b} … dx');
        }
        this.pos++;
        this.expect('{');

        let variable: string | undefined;
        let from: number;
        const first = this.toks[this.pos];
        const equals = this.toks[this.pos + 1];
        if (
            first && (first.t === 'id' || first.t === 'ref') &&
            equals?.t === 'op' && equals.v === '='
        ) {
            variable = first.v;
            this.pos += 2;
            from = this.expr();
        } else {
            from = this.expr();
        }
        this.expect('}');

        if (!this.is('op', '^')) {
            throw new Error('\\int needs an upper limit: \\int_{a}^{b} … dx');
        }
        this.pos++;
        this.expect('{');
        const to = this.expr();
        this.expect('}');

        if (!this.startsFactor()) throw new Error('\\int has no integrand');
        const bodyStart = this.pos;
        const end = this.bodyEnd();
        let bodyEnd = end;
        // A trailing `dx` names the variable. In a nested integral the outer
        // operator sees the inner `dy`, which does not belong to it.
        const differential = this.trailingDifferential(end);
        if (differential && (variable === undefined || differential.name === variable)) {
            variable = differential.name;
            bodyEnd = differential.index;
        }
        if (variable === undefined) {
            throw new Error(
                '\\int: include the differential, e.g. \\int_{0}^{1} x^{2}\\,dx, or write \\int_{x=0}^{1} …',
            );
        }
        const integrandVariable = variable;

        const value = numericIntegral(
            (x) => this.calculusSlice(bodyStart, bodyEnd, integrandVariable, x),
            from,
            to,
        );
        // Resume after the full body, including `dx`.
        this.pos = end;
        return value;
    }

    private atom(): number {
        const t = this.toks[this.pos];
        if (!t) throw new Error('Unexpected end of expression');
        this.pos++;
        if (t.t === 'num') return t.v;
        if (t.t === 'id') {
            const name = this.subscriptedName(t.v);
            if (name === 'e' && !(name in this.env)) return Math.E;
            const v = this.env[name];
            if (v === undefined) throw new Error(`Unknown variable "${name}"`);
            return v;
        }
        if (t.t === 'ref') {
            // Explicit `\var{name}` / `\variable{name}` — env only. No Euler
            // fallback, no single-letter constraint.
            const name = this.subscriptedName(t.v);
            const v = this.env[name];
            if (v === undefined) throw new Error(`Unknown variable "${name}"`);
            return v;
        }
        if (t.t === 'op' && t.v === '(') {
            const v = this.expr();
            this.expect(')');
            return v;
        }
        if (t.t === 'op' && t.v === '{') {
            this.pos--;
            return this.group();
        }
        if (t.t === 'cmd') {
            if (t.v === 'pi') return Math.PI;
            if (t.v === 'frac') {
                // `\frac{d}{dx} …` is a derivative, not a fraction.
                if (this.isDerivativeFraction()) return this.derivativeFraction();
                const n = this.group();
                const d = this.group();
                return n / d;
            }
            if (t.v === 'sqrt') {
                if (this.is('op', '[')) {
                    this.pos++;
                    const n = this.expr();
                    this.expect(']');
                    const x = this.group();
                    return Math.pow(x, 1 / n);
                }
                return Math.sqrt(this.group());
            }
            if (t.v === 'circ') {
                throw new Error('\\circ must be used as a superscript, e.g. 30^{\\circ}');
            }
            if (FUNC_ONE_ARG.has(t.v)) {
                const x = this.parenExpr();
                return applyOneArg(t.v, x);
            }
            if (FUNC_TWO_ARG.has(t.v)) {
                this.expect('(');
                const a = this.expr();
                this.expect(',');
                const b = this.expr();
                this.expect(')');
                return applyTwoArg(t.v, a, b);
            }
            if (t.v === 'binom') {
                if (this.is('op', '(')) {
                    this.pos++;
                    const n = this.expr();
                    this.expect(',');
                    const r = this.expr();
                    this.expect(')');
                    return binomial(n, r);
                }
                const n = this.group();
                const r = this.group();
                return binomial(n, r);
            }
            if (t.v === 'C' || t.v === 'P') {
                this.expect('(');
                const n = this.expr();
                this.expect(',');
                const r = this.expr();
                this.expect(')');
                return t.v === 'C' ? binomial(n, r) : permutations(n, r);
            }
            if (t.v === 'classify') {
                throw new Error('\\classify is available only inside <<rv:ev:...>> (arrives in Pass 5)');
            }
            if (BIG_OPERATORS.has(t.v)) {
                return this.bigOperator(t.v as 'sum' | 'prod');
            }
            if (t.v === 'lim') return this.limitOperator();
            if (t.v === 'int') return this.integralOperator();
            if (DISPLAY_ONLY_COMMANDS.has(t.v) || LATEX_SYMBOL_COMMANDS.has(t.v)) {
                throw new Error(
                    `\\${t.v} is display-only — write it in question, answer, or explanation text, not in a numeric expression`,
                );
            }
            if (t.v === 'cdot' || t.v === 'times') {
                throw new Error(`\\${t.v} can only appear between two expressions`);
            }
            throw new Error(`Unexpected "${t.v}"`);
        }
        throw new Error(`Unexpected "${t.v}"`);
    }
}

/** Evaluate a LaTeX-subset expression. Throws on syntax errors or unknown variables. */
export function evaluate(src: string, env: Record<string, number>): number {
    return new Parser(tokenize(src), env).run();
}