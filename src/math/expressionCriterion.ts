/**
 * Shared expression criterion (CRP-01).
 *
 * Builds a group tree from the token stream, then validates **every layer**
 * independently. Grouping changes the parent layer; it never repairs an
 * ambiguous child, because children are validated first.
 *
 * Rules, per layer:
 *
 * 1. `/` followed by `*` or `/` is ambiguous (both readings are defensible).
 * 2. A power or power chain followed by an operator at the same layer is
 *    ambiguous unless the **last exponent** is an explicit group.
 * 3. A `/` before an ungrouped power is ambiguous (divisor extent unclear).
 *
 * `* /`, `* *`, `+ -`, and anything separated by `+`/`-` are valid. `a^b^c` and
 * `a*b*c` are valid at the end of their layer. A `/` chain is never valid.
 *
 * Both the `rv-def` pipeline (Proposal 1) and typed math answers (Proposal 3)
 * must call this module. Do not duplicate the classifier.
 */
import {
    BIG_OPERATORS,
    CALCULUS_COMMANDS,
    LATEX_SYMBOL_COMMANDS,
    MATH_FUNCTIONS,
} from './commands';
import { tokenize, type Tok } from './tokenizer';

export type ExprMode = 'unicode' | 'latex';
export type ExprStatus = 'valid' | 'ambiguous' | 'parse-error';

export interface ExprDiagnostic {
    status: ExprStatus;
    /** Stable machine code, e.g. `E_AMBIGUOUS_DIV_MUL`. */
    code: string;
    /** Human-readable, single-line message including a fix hint. */
    message: string;
    /** Group path; `[]` is the root layer. */
    path: number[];
    operatorPair?: [string, string];
    /** Offending symbol or function name, when the diagnostic has one. */
    symbol?: string;
}

export interface ExprAnalysis {
    status: ExprStatus;
    diagnostics: ExprDiagnostic[];
}

export interface AnalyzeOptions {
    mode?: ExprMode;
    /** Numeric variables in scope. `e` is Euler unless listed here. */
    knownSymbols?: ReadonlySet<string>;
    /** Function names accepted in addition to the MathJax-style builtins. */
    knownFunctions?: ReadonlySet<string>;
}

type BinOp = '+' | '-' | '*' | '/' | '=';

type BigOpName = 'sum' | 'prod' | 'int' | 'lim' | 'diff';

interface LayerOp {
    op: BinOp;
    /** Set for adjacency-inserted multiplication (`ab`, `2x`, `a(b)`). */
    implicit: boolean;
}

type Operand =
    | { kind: 'atom'; text: string; symbol?: string }
    | { kind: 'neg'; body: Operand }
    | { kind: 'fact'; body: Operand }
    | { kind: 'group'; layer: Layer }
    | { kind: 'fraction'; num: Layer; den: Layer }
    | { kind: 'root'; arg: Layer; index?: Layer }
    | { kind: 'call'; name: string; args: Layer[] }
    | { kind: 'power'; base: Operand; exponents: Operand[] }
    | {
          kind: 'bigop';
          name: BigOpName;
          /** Bound index of `\sum` / `\prod`; absent for `\int` / `\lim`. */
          index?: string;
          lower?: Layer;
          upper?: Layer;
          body: Layer;
      };

interface Layer {
    path: number[];
    operands: Operand[];
    ops: LayerOp[];
}

/** Raised by the parser to signal an unrecoverable structural problem. */
class StructureError extends Error {}

const CLOSERS = new Set([')', ']', '}']);
const OPERATORS = new Set(['+', '-', '*', '/', '=']);

const CONSTANT_COMMANDS = new Set(['pi', 'circ']);
const MULTIPLY_COMMANDS = new Set(['cdot', 'times']);

const pairCode = (a: BinOp, b: BinOp): string | null => {
    if (a !== '/') return null;
    if (b === '*') return 'E_AMBIGUOUS_DIV_MUL';
    if (b === '/') return 'E_AMBIGUOUS_DIV_DIV';
    return null;
};

const pairMessage = (_a: BinOp, b: BinOp): string => {
    if (b === '*') {
        return '"a/b*c" is ambiguous: group the division before multiplying, e.g. (a/b)*c, or group the divisor, e.g. a/(b*c)';
    }
    return '"a/b/c" is ambiguous: group it as (a/b)/c or a/(b*c)';
};

class LayerParser {
    private pos = 0;
    /** Symbols local to an enclosing big operator (`\sum_{i=…}`'s `i`). */
    private readonly localSymbols = new Set<string>();

    constructor(
        private toks: Tok[],
        private readonly options: AnalyzeOptions,
        private readonly diagnostics: ExprDiagnostic[],
    ) {}

    atEnd(): boolean {
        return this.pos >= this.toks.length;
    }

    /**
     * Parse the token range until an unmatched closer or a `,` separator.
     * `termOnly` stops at a binary `+`/`-` so a big-operator body stays at
     * term level (`\sum i + 1` is `(Σ i) + 1`).
     */
    parseLayer(path: number[], termOnly = false): Layer {
        const layer: Layer = { path, operands: [], ops: [] };
        let lastWasOperand = false;
        let pendingNegate = false;

        for (;;) {
            const tok = this.toks[this.pos];
            if (tok === undefined) break;
            if (tok.t === 'op' && (CLOSERS.has(tok.v) || tok.v === ',' || tok.v === '|')) break;

            // A +/− at the start of a layer, or right after an operator, is a
            // unary sign and does not participate in adjacency checks.
            const expectingOperand =
                layer.operands.length === 0 || layer.ops.length >= layer.operands.length;

            // In term mode a binary sign ends the body.
            if (
                termOnly &&
                !expectingOperand &&
                tok.t === 'op' &&
                (tok.v === '+' || tok.v === '-')
            ) {
                break;
            }

            // A side marker inside a group: `a^{+}` / `a^{-}` (limits).
            const afterSign = this.toks[this.pos + 1];
            if (
                tok.t === 'op' &&
                (tok.v === '+' || tok.v === '-') &&
                afterSign?.t === 'op' &&
                CLOSERS.has(afterSign.v)
            ) {
                this.pos++;
                if (lastWasOperand) layer.ops.push({ op: '*', implicit: true });
                layer.operands.push({ kind: 'atom', text: tok.v });
                lastWasOperand = true;
                continue;
            }

            if (
                tok.t === 'op' &&
                (tok.v === '+' || tok.v === '-') &&
                expectingOperand &&
                this.startsOperandAt(this.pos + 1)
            ) {
                if (tok.v === '-') pendingNegate = !pendingNegate;
                this.pos++;
                continue;
            }

            if (tok.t === 'op' && OPERATORS.has(tok.v)) {
                this.pos++;
                layer.ops.push({ op: tok.v as BinOp, implicit: false });
                lastWasOperand = false;
                continue;
            }
            if (tok.t === 'cmd' && MULTIPLY_COMMANDS.has(tok.v)) {
                this.pos++;
                layer.ops.push({ op: '*', implicit: false });
                lastWasOperand = false;
                continue;
            }

            if (!this.startsOperandAt(this.pos)) {
                throw new StructureError(`unexpected "${describeToken(tok)}"`);
            }

            // Two adjacent operands: implicit multiplication.
            if (lastWasOperand) layer.ops.push({ op: '*', implicit: true });

            const index = layer.operands.length;
            let operand = this.parseOperand([...path, index]);
            if (pendingNegate) operand = { kind: 'neg', body: operand };
            pendingNegate = false;
            layer.operands.push(operand);
            lastWasOperand = true;
        }

        if (layer.operands.length === 0) throw new StructureError('missing operand');
        if (layer.ops.length >= layer.operands.length) {
            throw new StructureError('expression ends with an operator');
        }
        return layer;
    }

    private startsOperandAt(index: number): boolean {
        const tok = this.toks[index];
        if (tok === undefined) return false;
        if (tok.t === 'num' || tok.t === 'id' || tok.t === 'ref') return true;
        if (tok.t === 'op') return tok.v === '(' || tok.v === '[' || tok.v === '{';
        if (tok.t === 'cmd') return !MULTIPLY_COMMANDS.has(tok.v);
        return false;
    }

    private parseOperand(path: number[]): Operand {
        let base = this.parsePrimary(path);
        // Postfix factorial: `5!`, `(n+1)!` — binds tighter than `^`.
        while (this.isOp('!')) {
            this.pos++;
            base = { kind: 'fact', body: base };
        }
        if (this.isOp('^')) {
            const exponents: Operand[] = [];
            const power: Operand = { kind: 'power', base, exponents };
            while (this.isOp('^')) {
                this.pos++;
                exponents.push(this.parseExponent([...path, exponents.length]));
            }
            base = power;
        }
        return base;
    }

    /** The operand after `^`. May be signed, grouped, or a fraction/root. */
    private parseExponent(path: number[]): Operand {
        if (this.isOp('-') || this.isOp('+')) {
            this.pos++;
            return this.parseExponent(path);
        }
        return this.parsePrimary(path);
    }

    private parsePrimary(path: number[]): Operand {
        const tok = this.toks[this.pos];
        if (tok === undefined) throw new StructureError('missing operand');

        if (tok.t === 'num') {
            this.pos++;
            return { kind: 'atom', text: String(tok.v) };
        }
        if (tok.t === 'id') {
            this.pos++;
            const name = this.subscriptedName(tok.v);
            this.checkSymbol(name, path, name === 'e');
            return { kind: 'atom', text: name, symbol: name };
        }
        if (tok.t === 'ref') {
            this.pos++;
            const name = this.subscriptedName(tok.v);
            this.checkSymbol(name, path, false);
            return { kind: 'atom', text: `\\var{${name}}`, symbol: name };
        }
        if (tok.t === 'op' && (tok.v === '(' || tok.v === '[' || tok.v === '{')) {
            this.pos++;
            const inner = this.parseLayer(path);
            this.expectCloser(tok.v);
            return { kind: 'group', layer: inner };
        }
        if (tok.t === 'op' && CLOSERS.has(tok.v)) {
            throw new StructureError(`unexpected "${tok.v}"`);
        }
        if (tok.t === 'op') {
            throw new StructureError(`unexpected "${tok.v}"`);
        }
        if (tok.t === 'cmd') {
            return this.parseCommand(tok.v, path);
        }
        throw new StructureError(`unexpected "${describeToken(tok)}"`);
    }

    /** Merge a trailing `_sub` / `_{sub}` into the identifier. */
    private subscriptedName(base: string): string {
        if (!this.isOp('_')) return base;
        this.pos++;
        const tok = this.toks[this.pos];
        if (tok && (tok.t === 'id' || tok.t === 'ref' || tok.t === 'num')) {
            this.pos++;
            return `${base}_${tok.v}`;
        }
        if (this.isOp('{')) {
            this.pos++;
            let sub = '';
            while (!this.isOp('}')) {
                const inner = this.toks[this.pos];
                if (!inner) throw new StructureError('missing "}" in subscript');
                sub += String(inner.v);
                this.pos++;
            }
            this.pos++;
            if (sub === '') throw new StructureError('empty subscript');
            return `${base}_${sub}`;
        }
        throw new StructureError('expected a subscript after "_"');
    }

    /**
     * `\sum_{i=a}^{b} body` / `\prod_{i=a}^{b} body`. The index is local to
     * the operator, and the body stays at term level.
     */
    private parseBigOperator(name: 'sum' | 'prod', path: number[]): Operand {
        if (!this.isOp('_')) {
            throw new StructureError(`\\${name} needs a lower limit: \\${name}_{i=1}^{n}`);
        }
        const open = this.toks[this.pos + 1];
        const indexTok = this.toks[this.pos + 2];
        if (open?.t !== 'op' || open.v !== '{' || !indexTok || indexTok.t !== 'id') {
            throw new StructureError(
                `\\${name}: the lower limit must start with an index, e.g. _{i=1}`,
            );
        }
        const index = indexTok.v;
        this.localSymbols.add(index);

        this.pos++; // consume '_'
        const lower = this.parseBracedGroup([...path, 0]);
        if (lower.ops[0]?.op !== '=') {
            throw new StructureError(
                `\\${name}: the lower limit must be index=value, e.g. _{i=1}`,
            );
        }
        if (!this.isOp('^')) {
            throw new StructureError(`\\${name} needs an upper limit: \\${name}_{i=1}^{n}`);
        }
        this.pos++;
        const upper = this.parseBracedGroup([...path, 1]);
        if (!this.startsOperandAt(this.pos)) {
            throw new StructureError(`\\${name} has no body`);
        }
        const body = this.parseLayer([...path, 2], true);
        return { kind: 'bigop', name, index, lower, upper, body };
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
                    (token.v === '+' || token.v === '-' || token.v === ',' || token.v === '=')
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

    /** Detect `\frac{d}{dx}` / `\frac{d^{n}}{dx^{n}}`. */
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
        return { variable, order, after };
    }

    /** `\frac{d}{dx} body \bigg|_{x=a}` — derivative at a point. */
    private parseDerivative(path: number[]): Operand {
        const spec = this.derivativeSpec();
        if (!spec) throw new StructureError('expected a derivative fraction');
        this.localSymbols.add(spec.variable);
        this.pos = spec.after;
        if (!this.startsOperandAt(this.pos)) {
            throw new StructureError(`\\frac{d}{d${spec.variable}} has no body`);
        }
        const body = this.parseLayer([...path, 0], true);

        let lower: Layer | undefined;
        if (this.isOp('|')) {
            this.pos++;
            if (!this.isOp('_')) {
                throw new StructureError('the evaluation bar must be written |_{x=a}');
            }
            this.pos++;
            const first = this.toks[this.pos + 1];
            if (first?.t === 'id') this.localSymbols.add(first.v);
            lower = this.parseBracedGroup([...path, 1]);
        }
        return { kind: 'bigop', name: 'diff', index: spec.variable, lower, body };
    }

    /**
     * `\int_{a}^{b} …`, `\lim_{x \to a} …` — evaluated numerically at run
     * time. Bound variables are local, like a sum index.
     */
    private parseCalculus(name: 'int' | 'lim', path: number[]): Operand {
        let lower: Layer | undefined;
        let upper: Layer | undefined;
        let slot = 0;
        let explicitVariable: string | undefined;

        if (this.isOp('_')) {
            const open = this.toks[this.pos + 1];
            const first = this.toks[this.pos + 2];
            const after = this.toks[this.pos + 3];
            if (open?.t === 'op' && open.v === '{' && first?.t === 'id') {
                if (name === 'lim') {
                    // `_{x \to a}` binds x for the body.
                    this.localSymbols.add(first.v);
                } else if (after?.t === 'op' && after.v === '=') {
                    // `_{x=a}` binds x for the body.
                    explicitVariable = first.v;
                    this.localSymbols.add(first.v);
                }
            }
            this.pos++;
            lower = this.parseBracedGroup([...path, slot++]);
        }
        if (this.isOp('^')) {
            this.pos++;
            upper = this.parseBracedGroup([...path, slot++]);
        }
        if (!this.startsOperandAt(this.pos)) {
            throw new StructureError(`\\${name} has no body`);
        }

        let body: Layer;
        if (name === 'int') {
            const end = this.bodyEnd();
            const differential = this.trailingDifferential(end);
            if (
                differential &&
                (explicitVariable === undefined || differential.name === explicitVariable)
            ) {
                this.localSymbols.add(differential.name);
                const full = this.toks;
                try {
                    this.toks = full.slice(0, differential.index);
                    body = this.parseLayer([...path, slot], true);
                } finally {
                    this.toks = full;
                    this.pos = end;
                }
            } else {
                body = this.parseLayer([...path, slot], true);
            }
        } else {
            body = this.parseLayer([...path, slot], true);
        }
        return { kind: 'bigop', name, lower, upper, body };
    }

    private parseCommand(name: string, path: number[]): Operand {
        this.pos++;

        if (CONSTANT_COMMANDS.has(name)) {
            return { kind: 'atom', text: `\\${name}` };
        }
        if (MULTIPLY_COMMANDS.has(name)) {
            throw new StructureError(`\\${name} can only appear between two expressions`);
        }
        if (name === 'frac') {
            if (this.derivativeSpec() !== null) return this.parseDerivative(path);
            const num = this.parseBracedGroup([...path, 0]);
            const den = this.parseBracedGroup([...path, 1]);
            return { kind: 'fraction', num, den };
        }
        if (name === 'sqrt') {
            if (this.isOp('[')) {
                this.pos++;
                const index = this.parseLayer([...path, 0]);
                this.expectCloser('[');
                const arg = this.parseBracedGroup([...path, 1]);
                return { kind: 'root', arg, index };
            }
            return { kind: 'root', arg: this.parseBracedGroup([...path, 0]) };
        }
        if (name === 'binom') {
            if (this.isOp('(')) {
                return { kind: 'call', name, args: this.parseParenArgs(path) };
            }
            return {
                kind: 'call',
                name,
                args: [this.parseBracedGroup([...path, 0]), this.parseBracedGroup([...path, 1])],
            };
        }
        if (name === 'C' || name === 'P') {
            if (!this.isOp('(')) throw new StructureError(`\\${name} requires (n, r)`);
            return { kind: 'call', name, args: this.parseParenArgs(path) };
        }
        if (BIG_OPERATORS.has(name)) {
            return this.parseBigOperator(name as 'sum' | 'prod', path);
        }
        if (CALCULUS_COMMANDS.has(name)) {
            return this.parseCalculus(name as 'int' | 'lim', path);
        }
        if (LATEX_SYMBOL_COMMANDS.has(name)) {
            return { kind: 'atom', text: `\\${name}` };
        }

        const known = this.options.knownFunctions ?? MATH_FUNCTIONS;
        if (!known.has(name) && !MATH_FUNCTIONS.has(name)) {
            this.diagnostics.push({
                status: 'parse-error',
                code: 'E_UNKNOWN_FUNCTION',
                message: `unknown function \\${name}`,
                path,
                symbol: name,
            });
            // Consume a following argument list so parsing can continue.
            if (this.isOp('(')) this.parseParenArgs(path);
            return { kind: 'atom', text: `\\${name}` };
        }
        if (!this.isOp('(')) throw new StructureError(`\\${name} requires a parenthesised argument`);
        return { kind: 'call', name, args: this.parseParenArgs(path) };
    }

    private parseBracedGroup(path: number[]): Layer {
        if (!this.isOp('{')) throw new StructureError('expected a braced argument');
        this.pos++;
        const inner = this.parseLayer(path);
        this.expectCloser('{');
        return inner;
    }

    private parseParenArgs(path: number[]): Layer[] {
        this.pos++; // consume '('
        const args: Layer[] = [];
        for (;;) {
            args.push(this.parseLayer([...path, args.length]));
            if (this.isOp(',')) {
                this.pos++;
                continue;
            }
            break;
        }
        this.expectCloser('(');
        return args;
    }

    private expectCloser(open: string): void {
        const tok = this.toks[this.pos];
        const want = open === '(' ? ')' : open === '[' ? ']' : '}';
        if (tok?.t === 'op' && tok.v === want) {
            this.pos++;
            return;
        }
        throw new StructureError(`expected "${want}"`);
    }

    private isOp(v: string): boolean {
        const tok = this.toks[this.pos];
        return tok !== undefined && tok.t === 'op' && tok.v === v;
    }

    private checkSymbol(symbol: string, path: number[], allowEuler: boolean): void {
        const known = this.options.knownSymbols;
        // No table means "structure only": accept every symbol. Typed-answer
        // comparison uses this because the answer is not bound to an rv-def env.
        if (known === undefined) return;
        if (this.localSymbols.has(symbol)) return;
        if (known.has(symbol)) return;
        if (allowEuler && !known.has('e')) return;
        this.diagnostics.push({
            status: 'parse-error',
            code: 'E_UNKNOWN_SYMBOL',
            message: `unknown symbol "${symbol}" — declare it above this line in ## DEFINITIONS`,
            path,
            symbol,
        });
    }
}

function describeToken(tok: Tok): string {
    if (tok.t === 'cmd') return `\\${tok.v}`;
    return String(tok.v);
}

function validateLayer(
    layer: Layer,
    diagnostics: ExprDiagnostic[],
    opts?: { suppressPowerBoundary?: boolean },
): void {
    // Children first: a group boundary changes the parent layer only.
    for (const operand of layer.operands) {
        switch (operand.kind) {
            case 'neg':
                validateOperand(operand.body, diagnostics);
                break;
            case 'fact':
                validateOperand(operand.body, diagnostics);
                break;
            case 'group':
                validateLayer(operand.layer, diagnostics);
                break;
            case 'fraction':
                validateLayer(operand.num, diagnostics);
                validateLayer(operand.den, diagnostics);
                break;
            case 'root':
                if (operand.index) validateLayer(operand.index, diagnostics);
                validateLayer(operand.arg, diagnostics);
                break;
            case 'call':
                for (const arg of operand.args) validateLayer(arg, diagnostics);
                break;
            case 'bigop':
                if (operand.lower) validateLayer(operand.lower, diagnostics);
                if (operand.upper) validateLayer(operand.upper, diagnostics);
                validateLayer(operand.body, diagnostics, { suppressPowerBoundary: true });
                break;
            case 'power':
                validateOperandLayer(operand, diagnostics);
                break;
            default:
                break;
        }
    }

    for (let i = 0; i < layer.ops.length - 1; i++) {
        const a = layer.ops[i]!;
        const b = layer.ops[i + 1]!;
        const code = pairCode(a.op, b.op);
        if (code) {
            diagnostics.push({
                status: 'ambiguous',
                code,
                message: pairMessage(a.op, b.op),
                path: layer.path,
                operatorPair: [a.op, b.op],
            });
        }
    }

    // A big-operator body (∫ … dx, lim …) legitimately ends in `f(x) dx`, so
    // the "power followed by an operator" rule is not applied there.
    if (!opts?.suppressPowerBoundary) {
        for (let i = 0; i < layer.operands.length; i++) {
            const operand = layer.operands[i];
            if (operand?.kind !== 'power') continue;
            const last = operand.exponents[operand.exponents.length - 1];
            const followedBy = layer.ops[i];
            const precededBy = i > 0 ? layer.ops[i - 1] : undefined;

            if (followedBy && last?.kind !== 'group') {
                diagnostics.push({
                    status: 'ambiguous',
                    code: 'E_AMBIGUOUS_EXPONENT_BOUNDARY',
                    message:
                        `power followed by "${followedBy.op}" at layer ${formatPath(layer.path)}: ` +
                        'group the exponent, e.g. a^(b), or the whole power, e.g. (a^b)',
                    path: layer.path,
                    operatorPair: ['^', followedBy.op],
                });
            }
            if (precededBy?.op === '/' && operand.base.kind !== 'group') {
                diagnostics.push({
                    status: 'ambiguous',
                    code: 'E_AMBIGUOUS_EXPONENT_BOUNDARY',
                    message:
                        `"/" before an ungrouped power at layer ${formatPath(layer.path)}: ` +
                        'write a/(b^c) or (a/b)^c',
                    path: layer.path,
                    operatorPair: ['/', '^'],
                });
            }
        }
    }
}

/** Validate the base and exponent operands of a power chain. */
function validateOperandLayer(operand: Extract<Operand, { kind: 'power' }>, diagnostics: ExprDiagnostic[]): void {
    validateOperand(operand.base, diagnostics);
    for (const exp of operand.exponents) validateOperand(exp, diagnostics);
}

function validateOperand(operand: Operand, diagnostics: ExprDiagnostic[]): void {
    switch (operand.kind) {
        case 'neg':
            validateOperand(operand.body, diagnostics);
            break;
        case 'fact':
            validateOperand(operand.body, diagnostics);
            break;
        case 'group':
            validateLayer(operand.layer, diagnostics);
            break;
        case 'fraction':
            validateLayer(operand.num, diagnostics);
            validateLayer(operand.den, diagnostics);
            break;
        case 'root':
            if (operand.index) validateLayer(operand.index, diagnostics);
            validateLayer(operand.arg, diagnostics);
            break;
        case 'call':
            for (const arg of operand.args) validateLayer(arg, diagnostics);
            break;
        case 'bigop':
            if (operand.lower) validateLayer(operand.lower, diagnostics);
            if (operand.upper) validateLayer(operand.upper, diagnostics);
            validateLayer(operand.body, diagnostics, { suppressPowerBoundary: true });
            break;
        case 'power':
            validateOperandLayer(operand, diagnostics);
            break;
        default:
            break;
    }
}

function formatPath(path: number[]): string {
    return `[${path.join(',')}]`;
}

const comparePath = (a: number[], b: number[]): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d !== 0) return d;
    }
    return a.length - b.length;
};

/**
 * Analyze an expression against the shared criterion.
 *
 * Never throws: tokenizer/grammar failures become `parse-error` diagnostics.
 * The `mode` option is accepted now; Unicode-specific preprocessing arrives
 * with Proposal 3, which normalizes before calling this function.
 */
export function analyzeExpression(input: string, options: AnalyzeOptions = {}): ExprAnalysis {
    const source = input.trim();
    if (source === '') {
        return {
            status: 'parse-error',
            diagnostics: [
                {
                    status: 'parse-error',
                    code: 'E_EMPTY',
                    message: 'empty expression',
                    path: [],
                },
            ],
        };
    }

    let toks: Tok[];
    try {
        toks = tokenize(source);
    } catch (e) {
        return {
            status: 'parse-error',
            diagnostics: [
                {
                    status: 'parse-error',
                    code: 'E_PARSE',
                    message: (e as Error).message,
                    path: [],
                },
            ],
        };
    }

    const diagnostics: ExprDiagnostic[] = [];
    let root: Layer;
    try {
        const parser = new LayerParser(toks, options, diagnostics);
        root = parser.parseLayer([]);
        if (!parser.atEnd()) {
            throw new StructureError('unexpected trailing input');
        }
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Keep the symbol/function diagnostics collected before the failure.
        if (diagnostics.length === 0) {
            diagnostics.push({
                status: 'parse-error',
                code: 'E_PARSE',
                message,
                path: [],
            });
        }
        return { status: 'parse-error', diagnostics: sortDiagnostics(diagnostics) };
    }

    validateLayer(root, diagnostics);
    const sorted = sortDiagnostics(diagnostics);
    const status: ExprStatus = sorted.some((d) => d.status === 'ambiguous')
        ? 'ambiguous'
        : sorted.length > 0
          ? 'parse-error'
          : 'valid';
    return { status, diagnostics: sorted };
}

function sortDiagnostics(diagnostics: ExprDiagnostic[]): ExprDiagnostic[] {
    return diagnostics
        .map((d, index) => ({ d, index }))
        .sort((a, b) => comparePath(a.d.path, b.d.path) || a.index - b.index)
        .map((entry) => entry.d);
}

/** First diagnostic, for single-error surfaces such as the scanner warning. */
export function firstDiagnostic(analysis: ExprAnalysis): ExprDiagnostic | undefined {
    return analysis.diagnostics[0];
}

// ============================================================================
// Structural AST (Proposal 3 §8.4 comparison)
// ============================================================================

/**
 * A normalized expression tree. Grouping is transparent and `\frac` is the same
 * node as `/`, so notation-only differences compare equal. Commutativity is
 * *not* applied: `a*b` and `b*a` stay different.
 */
export type ExprAst =
    | { kind: 'num'; value: number }
    | { kind: 'sym'; name: string }
    | { kind: 'const'; name: string }
    | { kind: 'neg'; body: ExprAst }
    | { kind: 'fact'; body: ExprAst }
    | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '='; left: ExprAst; right: ExprAst }
    | { kind: 'power'; base: ExprAst; exponent: ExprAst }
    | { kind: 'call'; name: string; args: ExprAst[] }
    | { kind: 'root'; arg: ExprAst; index?: ExprAst }
    | {
          kind: 'bigop';
          name: BigOpName;
          index?: string;
          lower?: ExprAst;
          upper?: ExprAst;
          body: ExprAst;
      };

function operandToAst(operand: Operand): ExprAst {
    switch (operand.kind) {
        case 'atom': {
            if (operand.symbol !== undefined) return { kind: 'sym', name: operand.symbol };
            if (operand.text === '\\pi') return { kind: 'const', name: 'pi' };
            if (operand.text === '\\circ') return { kind: 'const', name: 'circ' };
            const value = Number(operand.text);
            return Number.isFinite(value) ? { kind: 'num', value } : { kind: 'sym', name: operand.text };
        }
        case 'neg':
            return { kind: 'neg', body: operandToAst(operand.body) };
        case 'fact':
            return { kind: 'fact', body: operandToAst(operand.body) };
        case 'group':
            return layerToAst(operand.layer);
        case 'fraction':
            return {
                kind: 'binary',
                op: '/',
                left: layerToAst(operand.num),
                right: layerToAst(operand.den),
            };
        case 'root': {
            const ast: ExprAst = { kind: 'root', arg: layerToAst(operand.arg) };
            if (operand.index) return { ...ast, index: layerToAst(operand.index) };
            return ast;
        }
        case 'call':
            return { kind: 'call', name: operand.name, args: operand.args.map(layerToAst) };
        case 'bigop': {
            const ast: ExprAst = { kind: 'bigop', name: operand.name, body: layerToAst(operand.body) };
            if (operand.index !== undefined) ast.index = operand.index;
            if (operand.lower) ast.lower = layerToAst(operand.lower);
            if (operand.upper) ast.upper = layerToAst(operand.upper);
            return ast;
        }
        case 'power': {
            const exponents = operand.exponents.map(operandToAst);
            let inner = exponents[exponents.length - 1]!;
            for (let i = exponents.length - 2; i >= 0; i--) {
                inner = { kind: 'power', base: exponents[i]!, exponent: inner };
            }
            return { kind: 'power', base: operandToAst(operand.base), exponent: inner };
        }
        default:
            return { kind: 'sym', name: '?' };
    }
}

/** Build an AST with standard precedence; `*` and `/` bind tighter than `+`/`-`. */
function layerToAst(layer: Layer): ExprAst {
    let operandIndex = 0;
    let opIndex = 0;

    const parseProduct = (): ExprAst => {
        let node = operandToAst(layer.operands[operandIndex++]!);
        while (opIndex < layer.ops.length) {
            const op = layer.ops[opIndex]!.op;
            if (op !== '*' && op !== '/') break;
            opIndex++;
            node = {
                kind: 'binary',
                op,
                left: node,
                right: operandToAst(layer.operands[operandIndex++]!),
            };
        }
        return node;
    };

    let node = parseProduct();
    while (opIndex < layer.ops.length) {
        const op = layer.ops[opIndex]!.op;
        if (op !== '+' && op !== '-') break;
        opIndex++;
        node = { kind: 'binary', op, left: node, right: parseProduct() };
    }
    // Relations bind loosest of all: `i=1` in a big-operator limit.
    while (opIndex < layer.ops.length) {
        const op = layer.ops[opIndex]!.op;
        if (op !== '=') break;
        opIndex++;
        node = { kind: 'binary', op, left: node, right: parseProduct() };
    }
    return node;
}

/** Structural equality of two ASTs. */
export function astEquals(a: ExprAst, b: ExprAst): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case 'num':
            return a.value === (b as typeof a).value;
        case 'sym':
            return a.name === (b as typeof a).name;
        case 'const':
            return a.name === (b as typeof a).name;
        case 'neg':
            return astEquals(a.body, (b as typeof a).body);
        case 'fact':
            return astEquals(a.body, (b as typeof a).body);
        case 'bigop': {
            const other = b as typeof a;
            if (a.name !== other.name || a.index !== other.index) return false;
            if ((a.lower === undefined) !== (other.lower === undefined)) return false;
            if (a.lower && other.lower && !astEquals(a.lower, other.lower)) return false;
            if ((a.upper === undefined) !== (other.upper === undefined)) return false;
            if (a.upper && other.upper && !astEquals(a.upper, other.upper)) return false;
            return astEquals(a.body, other.body);
        }
        case 'binary': {
            const other = b as typeof a;
            return a.op === other.op && astEquals(a.left, other.left) && astEquals(a.right, other.right);
        }
        case 'power': {
            const other = b as typeof a;
            return astEquals(a.base, other.base) && astEquals(a.exponent, other.exponent);
        }
        case 'call': {
            const other = b as typeof a;
            return (
                a.name === other.name &&
                a.args.length === other.args.length &&
                a.args.every((arg, i) => astEquals(arg, other.args[i]!))
            );
        }
        case 'root': {
            const other = b as typeof a;
            if ((a.index === undefined) !== (other.index === undefined)) return false;
            if (a.index && other.index && !astEquals(a.index, other.index)) return false;
            return astEquals(a.arg, other.arg);
        }
        default:
            return false;
    }
}

export interface AstParse {
    ast: ExprAst | null;
    status: ExprStatus;
    diagnostics: ExprDiagnostic[];
}

/** Parse an expression into the comparison AST, reusing the criterion parser. */
export function parseExpressionAst(input: string, options: AnalyzeOptions = {}): AstParse {
    const source = input.trim();
    if (source === '') {
        return {
            ast: null,
            status: 'parse-error',
            diagnostics: [
                { status: 'parse-error', code: 'E_EMPTY', message: 'empty expression', path: [] },
            ],
        };
    }

    let toks: Tok[];
    try {
        toks = tokenize(source);
    } catch (e) {
        return {
            ast: null,
            status: 'parse-error',
            diagnostics: [
                { status: 'parse-error', code: 'E_PARSE', message: (e as Error).message, path: [] },
            ],
        };
    }

    const diagnostics: ExprDiagnostic[] = [];
    let root: Layer;
    try {
        const parser = new LayerParser(toks, options, diagnostics);
        root = parser.parseLayer([]);
        if (!parser.atEnd()) throw new StructureError('unexpected trailing input');
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (diagnostics.length === 0) {
            diagnostics.push({ status: 'parse-error', code: 'E_PARSE', message, path: [] });
        }
        return { ast: null, status: 'parse-error', diagnostics: sortDiagnostics(diagnostics) };
    }

    validateLayer(root, diagnostics);
    const sorted = sortDiagnostics(diagnostics);
    const status: ExprStatus = sorted.some((d) => d.status === 'ambiguous')
        ? 'ambiguous'
        : sorted.length > 0
          ? 'parse-error'
          : 'valid';
    if (status !== 'valid') return { ast: null, status, diagnostics: sorted };
    return { ast: layerToAst(root), status, diagnostics: sorted };
}

