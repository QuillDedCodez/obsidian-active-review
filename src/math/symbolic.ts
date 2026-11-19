/** Partial symbolic rendering for `<<rv:expression:...>>`. */
import { evaluate } from './evaluator';
import { fmt } from './format';
import { latexCall, latexIdentifier } from './latex';
import { tokenize, type Tok } from './tokenizer';
import { EVAL_FUNC_ONE_ARG as FUNC_ONE_ARG, EVAL_FUNC_TWO_ARG as FUNC_TWO_ARG } from './commands';

type Node =
    | { k: 'num'; v: number }
    | { k: 'var'; name: string; explicit: boolean }
    | { k: 'const'; name: 'pi' | 'e' }
    | { k: 'neg'; value: Node }
    | { k: 'add'; op: '+' | '-'; left: Node; right: Node }
    | { k: 'mul'; factors: Node[] }
    | { k: 'div'; num: Node; den: Node }
    | { k: 'pow'; base: Node; exp: Node }
    | { k: 'fact'; value: Node }
    | { k: 'func'; name: string; args: Node[] }
    | { k: 'sqrt'; index?: Node; arg: Node }
    | { k: 'binom'; n: Node; r: Node }
    | { k: 'degree'; base: Node }
    /** `\sum_{i=a}^{b} body` — drawn with standard LaTeX. */
    | { k: 'bigop'; name: 'sum' | 'prod'; index: string; from: Node; to: Node; body: Node }
    /** `\lim_{x \to a} body`, optionally one-sided. */
    | { k: 'limit'; variable: string; point: Node; side: 0 | 1 | -1; body: Node }
    /** `\int_{a}^{b} body \, dx`. */
    | { k: 'integral'; variable: string; from: Node; to: Node; body: Node }
    /** `\diff_{x=a} body` (`point` absent for `\frac{d}{dx}`). */
    | { k: 'derivative'; variable: string; point: Node | null; order: number; body: Node };

function flattenMul(nodes: Node[]): Node[] {
    const out: Node[] = [];
    for (const node of nodes) {
        if (node.k === 'mul') out.push(...flattenMul(node.factors));
        else out.push(node);
    }
    return out;
}

class Parser {
    private pos = 0;

    constructor(private toks: Tok[]) {}

    run(): Node {
        const node = this.expr();
        if (this.pos < this.toks.length) {
            throw new Error(`Unexpected trailing input near "${String(this.toks[this.pos]!.v)}"`);
        }
        return node;
    }

    private is(type: Tok['t'], value: string): boolean {
        const token = this.toks[this.pos];
        return token !== undefined && token.t === type && token.v === value;
    }

    private expect(value: string): void {
        if (!this.is('op', value)) throw new Error(`Expected "${value}"`);
        this.pos++;
    }

    private startsFactor(): boolean {
        const token = this.toks[this.pos];
        if (!token) return false;
        if (token.t === 'num' || token.t === 'id' || token.t === 'ref') return true;
        if (token.t === 'op') return token.v === '(' || token.v === '{';
        return token.v !== 'cdot' && token.v !== 'times' && token.v !== 'circ';
    }

    private expr(): Node {
        let left = this.term();
        for (;;) {
            if (this.is('op', '+') || this.is('op', '-')) {
                const op = this.toks[this.pos]!.v as '+' | '-';
                this.pos++;
                left = { k: 'add', op, left, right: this.term() };
            } else {
                return left;
            }
        }
    }

    private term(): Node {
        let node = this.unary();
        const factors: Node[] = [node];
        for (;;) {
            if (
                this.is('cmd', 'cdot') ||
                this.is('cmd', 'times') ||
                this.is('op', '*')
            ) {
                this.pos++;
                factors.push(this.unary());
            } else if (this.is('op', '/')) {
                this.pos++;
                const right = this.unary();
                node = factors.length === 1
                    ? { k: 'div', num: node, den: right }
                    : { k: 'div', num: { k: 'mul', factors }, den: right };
                factors.length = 0;
                factors.push(node);
                node = factors[0]!;
            } else if (this.startsFactor()) {
                factors.push(this.unary());
            } else {
                break;
            }
        }
        if (factors.length === 1) return factors[0]!;
        return { k: 'mul', factors: flattenMul(factors) };
    }

    private unary(): Node {
        if (this.is('op', '-')) {
            this.pos++;
            return { k: 'neg', value: this.unary() };
        }
        if (this.is('op', '+')) {
            this.pos++;
            return this.unary();
        }
        const base = this.atom();
        // Postfix factorial binds tighter than `^`, matching the evaluator.
        let value = base;
        while (this.is('op', '!')) {
            this.pos++;
            value = { k: 'fact', value };
        }
        if (this.is('op', '^')) {
            this.pos++;
            if (
                this.is('op', '{') &&
                this.toks[this.pos + 1]?.t === 'cmd' &&
                this.toks[this.pos + 1]?.v === 'circ' &&
                this.toks[this.pos + 2]?.t === 'op' &&
                this.toks[this.pos + 2]?.v === '}'
            ) {
                this.pos += 3;
                return { k: 'degree', base: value };
            }
            return { k: 'pow', base: value, exp: this.exponent() };
        }
        return value;
    }

    private exponent(): Node {
        if (this.is('op', '-')) {
            this.pos++;
            return { k: 'neg', value: this.exponent() };
        }
        if (this.is('op', '{')) return this.group();
        if (this.is('op', '(')) return this.atom();
        const token = this.toks[this.pos];
        if (token && (token.t === 'num' || token.t === 'id' || token.t === 'ref')) {
            return this.atom();
        }
        throw new Error('Bad exponent');
    }

    private group(): Node {
        this.expect('{');
        const node = this.expr();
        this.expect('}');
        return node;
    }

    private parens(): Node {
        this.expect('(');
        const node = this.expr();
        this.expect(')');
        return node;
    }

    /**
     * Merge a trailing `_sub` / `_{sub}` into the variable name, so `x_i` and
     * `x_{i+1}` render (and substitute) as one identifier.
     */
    private subscriptedName(base: string): string {
        if (!this.is('op', '_')) return base;
        this.pos++;
        const token = this.toks[this.pos];
        if (token && (token.t === 'id' || token.t === 'ref' || token.t === 'num')) {
            this.pos++;
            return `${base}_${token.v}`;
        }
        if (this.is('op', '{')) {
            this.pos++;
            let sub = '';
            while (!this.is('op', '}')) {
                const inner = this.toks[this.pos];
                if (!inner) throw new Error('Missing "}" in subscript');
                sub += String(inner.v);
                this.pos++;
            }
            this.expect('}');
            if (sub === '') throw new Error('Empty subscript');
            return `${base}_${sub}`;
        }
        throw new Error('Expected a subscript after "_"');
    }

    /**
     * `\sum_{i=a}^{b} body` / `\prod_{i=a}^{b} body`. The body is a term, so
     * `\sum_{i=1}^{5} i + 1` renders as `(Σ i) + 1`.
     */
    private bigOperator(name: 'sum' | 'prod'): Node {
        if (!this.is('op', '_')) {
            throw new Error(`\\${name} needs a lower limit: \\${name}_{i=1}^{n}`);
        }
        this.pos++;
        this.expect('{');
        const indexToken = this.toks[this.pos];
        if (!indexToken || indexToken.t !== 'id') {
            throw new Error(`\\${name}: the lower limit must start with an index, e.g. _{i=1}`);
        }
        this.pos++;
        const index = indexToken.v;
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
        const body = this.term();
        return { k: 'bigop', name, index, from, to, body };
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

    /** A limit point: like a term, but leaves a trailing `^{+}`/`^{-}` alone. */
    private limitPoint(): Node {
        let value = this.signedAtom();
        for (;;) {
            if (this.is('cmd', 'cdot') || this.is('cmd', 'times') || this.is('op', '*')) {
                this.pos++;
                value = { k: 'mul', factors: flattenMul([value, this.signedAtom()]) };
            } else if (this.is('op', '/')) {
                this.pos++;
                value = { k: 'div', num: value, den: this.signedAtom() };
            } else if (this.startsFactor()) {
                value = { k: 'mul', factors: flattenMul([value, this.signedAtom()]) };
            } else {
                return value;
            }
        }
    }

    private signedAtom(): Node {
        if (this.is('op', '-')) {
            this.pos++;
            return { k: 'neg', value: this.signedAtom() };
        }
        if (this.is('op', '+')) {
            this.pos++;
            return this.signedAtom();
        }
        return this.atom();
    }

    /** `\lim_{x \to a[^{\pm}]} body`. */
    private limitOperator(): Node {
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
        const body = this.term();
        return { k: 'limit', variable, point, side, body };
    }

    /**
     * Detect `\frac{d}{dx}` / `\frac{d^{n}}{dx^{n}}`. Returns the variable,
     * order, and the token index just after the denominator.
     */
    private derivativeSpec(): { variable: string; order: number; after: number } | null {
        const toks = this.toks;
        const p = this.pos;
        if (!(toks[p]?.t === 'op' && toks[p].v === '{')) return null;
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
        return { variable, order, after };
    }

    private isDerivativeFraction(): boolean {
        return this.derivativeSpec() !== null;
    }

    /** `\frac{d}{dx} body \bigg|_{x=a}`, or without a bar at the current value. */
    private derivativeFraction(): Node {
        const spec = this.derivativeSpec();
        if (!spec) throw new Error('Expected a derivative fraction');
        this.pos = spec.after;
        const body = this.term();

        let point: Node | null = null;
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
        return { k: 'derivative', variable: spec.variable, point, order: spec.order, body };
    }

    /** `\int_{a}^{b} body dx` or `\int_{x=a}^{b} body`. */
    private integralOperator(): Node {
        if (!this.is('op', '_')) {
            throw new Error('\\int needs limits: \\int_{a}^{b} … dx');
        }
        this.pos++;
        this.expect('{');

        let variable: string | undefined;
        let from: Node;
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

        const end = this.bodyEnd();
        const differential = this.trailingDifferential(end);
        let body: Node;
        if (differential && (variable === undefined || differential.name === variable)) {
            variable = differential.name;
            const full = this.toks;
            try {
                this.toks = full.slice(0, differential.index);
                body = this.term();
            } finally {
                this.toks = full;
                this.pos = end;
            }
        } else {
            body = this.term();
        }
        if (variable === undefined) {
            throw new Error(
                '\\int: include the differential, e.g. \\int_{0}^{1} x^{2}\\,dx, or write \\int_{x=0}^{1} …',
            );
        }
        return { k: 'integral', variable, from, to, body };
    }

    private atom(): Node {
        const token = this.toks[this.pos];
        if (!token) throw new Error('Unexpected end of expression');
        this.pos++;
        if (token.t === 'num') return { k: 'num', v: token.v };
        if (token.t === 'id') {
            const name = this.subscriptedName(token.v);
            if (name === 'e') return { k: 'const', name: 'e' };
            return { k: 'var', name, explicit: false };
        }
        if (token.t === 'ref') {
            return { k: 'var', name: this.subscriptedName(token.v), explicit: true };
        }
        if (token.t === 'op' && token.v === '(') {
            this.pos--;
            return this.parens();
        }
        if (token.t === 'op' && token.v === '{') {
            this.pos--;
            return this.group();
        }
        if (token.t === 'cmd') {
            if (token.v === 'pi') return { k: 'const', name: 'pi' };
            if (token.v === 'frac') {
                if (this.isDerivativeFraction()) return this.derivativeFraction();
                return { k: 'div', num: this.group(), den: this.group() };
            }
            if (token.v === 'sqrt') {
                let index: Node | undefined;
                if (this.is('op', '[')) {
                    this.pos++;
                    index = this.expr();
                    this.expect(']');
                }
                return { k: 'sqrt', index, arg: this.group() };
            }
            if (token.v === 'circ') {
                throw new Error('\\circ must be used as a superscript, e.g. 30^{\\circ}');
            }
            if (token.v === 'sum' || token.v === 'prod') {
                return this.bigOperator(token.v);
            }
            if (token.v === 'lim') return this.limitOperator();
            if (token.v === 'int') return this.integralOperator();
            if (FUNC_ONE_ARG.has(token.v)) {
                return { k: 'func', name: token.v, args: [this.parens()] };
            }
            if (FUNC_TWO_ARG.has(token.v)) {
                this.expect('(');
                const first = this.expr();
                this.expect(',');
                const second = this.expr();
                this.expect(')');
                return { k: 'func', name: token.v, args: [first, second] };
            }
            if (token.v === 'binom') {
                if (this.is('op', '(')) {
                    this.pos++;
                    const n = this.expr();
                    this.expect(',');
                    const r = this.expr();
                    this.expect(')');
                    return { k: 'binom', n, r };
                }
                return { k: 'binom', n: this.group(), r: this.group() };
            }
            if (token.v === 'C' || token.v === 'P') {
                this.expect('(');
                const n = this.expr();
                this.expect(',');
                const r = this.expr();
                this.expect(')');
                return {
                    k: 'func',
                    name: token.v,
                    args: [n, r],
                };
            }
            if (token.v === 'cdot' || token.v === 'times') {
                throw new Error(`\\${token.v} can only appear between two expressions`);
            }
            throw new Error(`Unexpected "${token.v}"`);
        }
        throw new Error(`Unexpected "${token.v}"`);
    }
}

function substitute(node: Node, env: Map<string, number>): Node {
    if (node.k === 'var') {
        const value = env.get(node.name);
        return value === undefined ? node : { k: 'num', v: value };
    }
    switch (node.k) {
        case 'num':
        case 'const':
            return node;
        case 'neg':
            return { k: 'neg', value: substitute(node.value, env) };
        case 'add':
            return {
                k: 'add',
                op: node.op,
                left: substitute(node.left, env),
                right: substitute(node.right, env),
            };
        case 'mul':
            return { k: 'mul', factors: node.factors.map((f) => substitute(f, env)) };
        case 'div':
            return {
                k: 'div',
                num: substitute(node.num, env),
                den: substitute(node.den, env),
            };
        case 'pow':
            return {
                k: 'pow',
                base: substitute(node.base, env),
                exp: substitute(node.exp, env),
            };
        case 'fact':
            return { k: 'fact', value: substitute(node.value, env) };
        case 'bigop': {
            // The bound index is local to the body, so it must not be replaced
            // by an outer definition of the same name.
            const inner = new Map(env);
            inner.delete(node.index);
            return {
                k: 'bigop',
                name: node.name,
                index: node.index,
                from: substitute(node.from, env),
                to: substitute(node.to, env),
                body: substitute(node.body, inner),
            };
        }
        case 'limit': {
            const inner = new Map(env);
            inner.delete(node.variable);
            return {
                k: 'limit',
                variable: node.variable,
                point: substitute(node.point, env),
                side: node.side,
                body: substitute(node.body, inner),
            };
        }
        case 'integral': {
            const inner = new Map(env);
            inner.delete(node.variable);
            return {
                k: 'integral',
                variable: node.variable,
                from: substitute(node.from, env),
                to: substitute(node.to, env),
                body: substitute(node.body, inner),
            };
        }
        case 'derivative': {
            const inner = new Map(env);
            inner.delete(node.variable);
            return {
                k: 'derivative',
                variable: node.variable,
                point: node.point ? substitute(node.point, env) : null,
                order: node.order,
                body: substitute(node.body, inner),
            };
        }
        case 'func':
            return {
                k: 'func',
                name: node.name,
                args: node.args.map((a) => substitute(a, env)),
            };
        case 'sqrt':
            return {
                k: 'sqrt',
                index: node.index ? substitute(node.index, env) : undefined,
                arg: substitute(node.arg, env),
            };
        case 'binom':
            return {
                k: 'binom',
                n: substitute(node.n, env),
                r: substitute(node.r, env),
            };
        case 'degree':
            return { k: 'degree', base: substitute(node.base, env) };
    }
}

function numericValue(node: Node): number | null {
    if (node.k === 'var' || node.k === 'const' || node.k === 'degree') return null;
    try {
        return evaluate(render(node), {});
    } catch {
        return null;
    }
}

function simplify(node: Node): Node {
    switch (node.k) {
        case 'num':
        case 'var':
        case 'const':
            return node;
        case 'neg': {
            const value = simplify(node.value);
            if (value.k === 'num') return { k: 'num', v: -value.v };
            if (value.k === 'neg') return value.value;
            const n = numericValue(value);
            return n === null ? { k: 'neg', value } : { k: 'num', v: -n };
        }
        case 'add': {
            const left = simplify(node.left);
            const right = simplify(node.right);
            if (left.k === 'num' && right.k === 'num') {
                return {
                    k: 'num',
                    v: node.op === '+' ? left.v + right.v : left.v - right.v,
                };
            }
            if (left.k === 'num' && left.v === 0) return right;
            if (right.k === 'num' && right.v === 0) return left;
            return { k: 'add', op: node.op, left, right };
        }
        case 'mul': {
            const factors = flattenMul(node.factors.map(simplify));
            let coefficient = 1;
            const symbolic: Node[] = [];
            for (const factor of factors) {
                if (factor.k === 'num') coefficient *= factor.v;
                else symbolic.push(factor);
            }
            if (coefficient === 0) return { k: 'num', v: 0 };
            if (symbolic.length === 0) return { k: 'num', v: coefficient };
            // Keep explicit \var{...} references after bare factors so an
            // author-supplied variable name is visually distinct.
            symbolic.sort((a, b) => {
                const rank = (n: Node): number =>
                    n.k === 'var' && n.explicit ? 1 : 0;
                return rank(a) - rank(b);
            });
            if (coefficient === 1 && symbolic.length === 1) return symbolic[0]!;
            return {
                k: 'mul',
                factors:
                    coefficient === 1
                        ? symbolic
                        : [{ k: 'num', v: coefficient }, ...symbolic],
            };
        }
        case 'div': {
            const num = simplify(node.num);
            const den = simplify(node.den);
            if (den.k === 'num' && den.v === 1) return num;
            if (num.k === 'num' && num.v === 0) return { k: 'num', v: 0 };
            return { k: 'div', num, den };
        }
        case 'pow': {
            const base = simplify(node.base);
            const exp = simplify(node.exp);
            if (exp.k === 'num' && exp.v === 0) return { k: 'num', v: 1 };
            if (exp.k === 'num' && exp.v === 1) return base;
            const n = numericValue({ k: 'pow', base, exp });
            return n === null ? { k: 'pow', base, exp } : { k: 'num', v: n };
        }
        case 'fact': {
            const value = simplify(node.value);
            const n = numericValue({ k: 'fact', value });
            return n === null ? { k: 'fact', value } : { k: 'num', v: n };
        }
        case 'bigop': {
            const from = simplify(node.from);
            const to = simplify(node.to);
            const body = simplify(node.body);
            const n = numericValue({ k: 'bigop', name: node.name, index: node.index, from, to, body });
            if (n === null || !Number.isFinite(n)) {
                return { k: 'bigop', name: node.name, index: node.index, from, to, body };
            }
            return { k: 'num', v: n };
        }
        case 'limit': {
            const point = simplify(node.point);
            const body = simplify(node.body);
            const folded = { k: 'limit' as const, variable: node.variable, point, side: node.side, body };
            const n = numericValue(folded);
            return n === null || !Number.isFinite(n) ? folded : { k: 'num', v: n };
        }
        case 'integral': {
            const from = simplify(node.from);
            const to = simplify(node.to);
            const body = simplify(node.body);
            const folded = { k: 'integral' as const, variable: node.variable, from, to, body };
            const n = numericValue(folded);
            return n === null || !Number.isFinite(n) ? folded : { k: 'num', v: n };
        }
        case 'derivative': {
            const point = node.point ? simplify(node.point) : null;
            const body = simplify(node.body);
            const folded = {
                k: 'derivative' as const,
                variable: node.variable,
                point,
                order: node.order,
                body,
            };
            const n = numericValue(folded);
            return n === null || !Number.isFinite(n) ? folded : { k: 'num', v: n };
        }
        case 'func': {
            const args = node.args.map(simplify);
            const n = numericValue({ k: 'func', name: node.name, args });
            return n === null ? { k: 'func', name: node.name, args } : { k: 'num', v: n };
        }
        case 'sqrt': {
            const arg = simplify(node.arg);
            const index = node.index ? simplify(node.index) : undefined;
            const n = numericValue({ k: 'sqrt', index, arg });
            return n === null ? { k: 'sqrt', index, arg } : { k: 'num', v: n };
        }
        case 'binom': {
            const nNode = simplify(node.n);
            const rNode = simplify(node.r);
            const n = numericValue({ k: 'binom', n: nNode, r: rNode });
            return n === null ? { k: 'binom', n: nNode, r: rNode } : { k: 'num', v: n };
        }
        case 'degree':
            return { k: 'degree', base: simplify(node.base) };
    }
}

function precedence(node: Node): number {
    switch (node.k) {
        case 'add':
        case 'bigop':
        case 'limit':
        case 'integral':
        case 'derivative':
            return 1;
        case 'mul':
        case 'div':
            return 2;
        case 'pow':
            return 3;
        case 'neg':
            return 4;
        default:
            return 5;
    }
}

function render(node: Node, parent = 0): string {
    let text: string;
    let prec = precedence(node);
    switch (node.k) {
        case 'num':
            text = fmt(node.v);
            break;
        case 'var':
            // `\var{...}` never reaches the card: it renders as the identifier
            // itself, upright when the name is longer than one letter.
            text = latexIdentifier(node.name);
            break;
        case 'const':
            text = node.name === 'pi' ? '\\pi' : 'e';
            break;
        case 'neg':
            text = `-${render(node.value, 4)}`;
            break;
        case 'add':
            text = `${render(node.left, 1)} ${node.op} ${render(node.right, 1)}`;
            break;
        case 'mul': {
            const parts: string[] = [];
            for (const factor of node.factors) {
                const negative = factor.k === 'num' && factor.v < 0;
                if (negative) {
                    parts.push(`-${render({ k: 'num', v: Math.abs(factor.v) }, 5)}`);
                } else {
                    parts.push(render(factor, factor.k === 'add' ? 2 : 0));
                }
            }
            text = parts.join('');
            break;
        }
        case 'div':
            text = `\\frac{${render(node.num)}}{${render(node.den)}}`;
            break;
        case 'pow':
            text = `${render(node.base, 3)}^{${render(node.exp)}}`;
            break;
        case 'fact':
            text = `${render(node.value, 5)}!`;
            break;
        case 'bigop':
            text =
                `\\${node.name}_{${latexIdentifier(node.index)}=${render(node.from)}}` +
                `^{${render(node.to)}} ${render(node.body, 2)}`;
            break;
        case 'limit': {
            const target =
                node.side === 0
                    ? render(node.point)
                    : `${render(node.point)}^{${node.side > 0 ? '+' : '-'}}`;
            text =
                `\\lim_{${latexIdentifier(node.variable)} \\to ${target}} ` +
                `${render(node.body, 2)}`;
            break;
        }
        case 'integral':
            text =
                `\\int_{${render(node.from)}}^{${render(node.to)}} ` +
                `${render(node.body, 2)}\\,d${latexIdentifier(node.variable)}`;
            break;
        case 'derivative': {
            const variable = latexIdentifier(node.variable);
            const numerator = node.order === 1 ? 'd' : `d^{${node.order}}`;
            const denominator =
                node.order === 1 ? `d${variable}` : `d${variable}^{${node.order}}`;
            const fraction = `\\frac{${numerator}}{${denominator}} ${render(node.body, 2)}`;
            text =
                node.point === null
                    ? fraction
                    : `${fraction}\\bigg|_{${variable}=${render(node.point)}}`;
            break;
        }
        case 'func':
            text = latexCall(node.name, node.args.map((a) => render(a)));
            break;
        case 'sqrt':
            text = node.index
                ? `\\sqrt[${render(node.index)}]{${render(node.arg)}}`
                : `\\sqrt{${render(node.arg)}}`;
            break;
        case 'binom':
            text = `\\binom{${render(node.n)}}{${render(node.r)}}`;
            break;
        case 'degree':
            text = `${render(node.base, 3)}^{\\circ}`;
            break;
    }
    if (prec < parent) return `(${text})`;
    return text;
}

export interface ExpressionRenderOptions {
    /** Values to substitute; only these names are replaced. */
    values: Map<string, number>;
}

/** Render an expression source with optional partial substitution. */
export function renderExpression(source: string, options: ExpressionRenderOptions): string {
    const parsed = new Parser(tokenize(source)).run();
    return render(simplify(substitute(parsed, options.values)));
}

/** Evaluate an expression source after substituting the named variables. */
export function evaluateExpression(
    source: string,
    values: Record<string, unknown>,
    args: string[],
): number | null {
    const env = new Map<string, number>();
    for (const arg of args) {
        const value = values[arg];
        if (typeof value !== 'number') return null;
        env.set(arg, value);
    }
    try {
        const parsed = new Parser(tokenize(expandExpressionSource(source, values))).run();
        const rendered = render(simplify(substitute(parsed, env)));
        const result = evaluate(rendered, {});
        return Number.isFinite(result) ? result : null;
    } catch {
        return null;
    }
}

/** Expand `<<rv:val:...>>` / `<<rv:values:...>>` inside an expression source. */
export function expandExpressionSource(
    source: string,
    values: Record<string, unknown>,
): string {
    return source.replace(
        /<<rv:(?:val|values):([^>]*?)>>/g,
        (whole, raw: string) => {
            const value = values[raw.trim()];
            return typeof value === 'number' ? `(${fmt(value)})` : whole;
        },
    );
}
