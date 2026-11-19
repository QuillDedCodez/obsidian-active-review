/** Turns LaTeX-subset text into tokens. */

export type Tok =
    | { t: 'num'; v: number }
    | { t: 'id'; v: string }
    | { t: 'op'; v: string }
    | { t: 'cmd'; v: string }
    /** Explicit variable reference — `\var{name}` / `\variable{name}`.
     *  Resolves against `env` only; no Euler fallback, no single-letter constraint. */
    | { t: 'ref'; v: string };

import {
    BIG_OPERATORS,
    CALCULUS_COMMANDS,
    LATEX_SYMBOL_COMMANDS,
    MATH_FUNCTIONS,
} from './commands';

const IGNORED_COMMANDS = new Set([
    'left', 'right', 'displaystyle', 'textstyle', 'quad', 'qquad',
    // limit placement is presentation only: \sum\limits_{…} ≡ \sum_{…}
    'limits', 'nolimits', 'displaylimits',
    // delimiter sizing: \bigg| ≡ |
    'big', 'Big', 'bigg', 'Bigg',
    'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr',
]);

const SUPPORTED_COMMANDS = new Set([
    // structural
    'frac', 'sqrt', 'cdot', 'times',
    // functions, combinatorics, constants, degree literal
    ...MATH_FUNCTIONS,
    'pi',
    'circ',
    // classification (deferred to Pass 5 — tokenized so errors are readable)
    'classify',
    // big operators: \sum_{i=1}^{n} …, \prod_{i=1}^{n} …
    ...BIG_OPERATORS,
    // calculus: \lim_{x \to a}, \int_{a}^{b}, \diff_{x=a}
    ...CALCULUS_COMMANDS,
    // upright/relational symbols used in typed answers
    ...LATEX_SYMBOL_COMMANDS,
]);

const INVERSE_MAP: Record<string, string> = {
    sin: 'arcsin',
    cos: 'arccos',
    tan: 'arctan',
};

/** Matches a valid variable name — same shape as the rv-def LHS regex. */
const VAR_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export function tokenize(src: string): Tok[] {
    const out: Tok[] = [];
    let i = 0;
    while (i < src.length) {
        const ch = src.charAt(i);
        if (/\s/.test(ch)) {
            i++;
        } else if (/[0-9.]/.test(ch)) {
            const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
            if (!m) throw new Error(`Bad number near "${src.slice(i, i + 5)}"`);
            out.push({ t: 'num', v: Number(m[0]) });
            i += m[0].length;
        } else if (/[A-Za-z]/.test(ch)) {
            out.push({ t: 'id', v: ch });
            i++;
        } else if (ch === '\\') {
            const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
            if (m) {
                let name = m[1] ?? '';
                i += m[0].length;

                // \var{name} / \variable{name} — explicit variable reference.
                // Emits a `ref` token so the evaluator resolves it against
                // env only (no Euler fallback, no single-letter constraint).
                if (name === 'var' || name === 'variable') {
                    if (src.charAt(i) !== '{') {
                        throw new Error(`\\${name} must be followed by {name} (found "${src.slice(i, i + 5)}")`);
                    }
                    const closeIdx = src.indexOf('}', i + 1);
                    if (closeIdx < 0) throw new Error(`\\${name}: missing closing "}"`);
                    const refName = src.slice(i + 1, closeIdx).trim();
                    if (!VAR_NAME.test(refName)) {
                        throw new Error(
                            `\\${name}{${refName}}: invalid variable name — must match [A-Za-z][A-Za-z0-9_]*`,
                        );
                    }
                    i = closeIdx + 1;
                    out.push({ t: 'ref', v: refName });
                    continue;
                }

                if (name === 'dfrac' || name === 'tfrac') name = 'frac';
                // `\mid` is a relation bar: treat it like `|`.
                if (name === 'mid') {
                    out.push({ t: 'op', v: '|' });
                    continue;
                }
                // Convert `\sin^{-1}` into `\arcsin` (and cos/tan) at tokenize time.
                if (name in INVERSE_MAP && src.slice(i, i + 5) === '^{-1}') {
                    name = INVERSE_MAP[name]!;
                    i += 5;
                }
                if (IGNORED_COMMANDS.has(name)) continue;
                if (!SUPPORTED_COMMANDS.has(name)) throw new Error(`Unsupported LaTeX command \\${name}`);
                out.push({ t: 'cmd', v: name });
            } else if (',;! '.includes(src.charAt(i + 1))) {
                i += 2; // LaTeX spacing (\; \, \! and "\ ")
            } else {
                throw new Error(`Unexpected "${src.slice(i, i + 2)}"`);
            }
        } else if ('+-*/^(){}[],!_=|'.includes(ch)) {
            out.push({ t: 'op', v: ch });
            i++;
        } else {
            throw new Error(`Unexpected character "${ch}"`);
        }
    }
    return out;
}