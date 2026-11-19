/**
 * Presentation and literal normalization for typed answers (Proposal 3 §8).
 *
 * Grading only. Nothing here may produce text the student sees: display text is
 * always built from the original literals plus Proposal 2's `fmtQuantity`.
 */
import { normaliseWhitespace } from '../../util/text';

/** `u²` → `u^2`, `m⁻¹` → `m^-1`. Runs before NFKC, which flattens superscripts. */
const SUPERSCRIPTS: Record<string, string> = {
    '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
    '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7',
    '\u2078': '8', '\u2079': '9', '\u207B': '-',
};

export function expandUnicodeSuperscripts(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i]!;
        const digit = SUPERSCRIPTS[ch];
        if (digit === undefined) { out += ch; i++; continue; }
        let run = '';
        while (i < text.length && SUPERSCRIPTS[text[i]!] !== undefined) {
            run += SUPERSCRIPTS[text[i]!]!;
            i++;
        }
        out += `^${run}`;
    }
    return out;
}

function stripDelimiters(s: string): string {
    let out = s;
    out = out.replace(/\\begin\{(?:equation|align|gather|multline)\*?\}([\s\S]*?)\\end\{(?:equation|align|gather|multline)\*?\}/g, '$1');
    out = out.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
    out = out.replace(/\$([^$]*?)\$/g, '$1');
    out = out.replace(/\\\(([\s\S]*?)\\\)/g, '$1');
    out = out.replace(/\\\[([\s\S]*?)\\\]/g, '$1');
    return out;
}

function unwrapCommand(s: string, command: string): string {
    const re = new RegExp(`\\\\${command}\\{([^{}]*)\\}`, 'g');
    let previous = '';
    let out = s;
    while (out !== previous) { previous = out; out = out.replace(re, '$1'); }
    return out;
}

/**
 * Strip presentation noise but **preserve case**: `S` vs `s` and `T` vs `t`
 * are meaningful for units and variables.
 */
export function normalizePresentation(input: string): string {
    let s = expandUnicodeSuperscripts(input.trim()).normalize('NFKC');

    s = s
        .replace(/[\u2212\u2013]/g, '-')
        .replace(/[·⋅×]/g, '*')
        .replace(/÷/g, '/')
        .replace(/[\u00B5\u03BC]/g, 'u')
        .replace(/\u2126/g, 'Ω');

    s = s.replace(/([0-9A-Za-z)\]}])\*\*(?=[0-9A-Za-z([{\\])/g, '$1^');

    s = stripDelimiters(s);

    s = s
        .replace(/\\left|\\right|\\displaystyle|\\textstyle/g, '')
        .replace(/\\[,;!]/g, '')
        .replace(/\\quad|\\qquad|\\enspace/g, ' ')
        .replace(/\\ /g, ' ')
        .replace(/\\\\/g, ' ');

    s = s.replace(/\\dfrac|\\tfrac/g, '\\frac');
    s = s.replace(/\\cdot|\\times/g, '*');
    s = s.replace(/\\div/g, '/');

    for (const command of ['text', 'mathrm', 'operatorname', 'mathbf']) {
        s = unwrapCommand(s, command);
    }
    s = s.replace(/\\unit\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\(?:SI|qty)\{([^{}]*)\}\{([^{}]*)\}/g, '$1 $2');

    // Strip single-token braces only: `x^{2}` ≡ `x^2`, but `\sum_{i=1}^{5}`
    // and `\lim_{x \to 0}` must keep their braces, and `x^{i+1}` is a group,
    // not a bare exponent.
    s = s.replace(/\^\{(-?[A-Za-z0-9.]+)\}/g, '^$1');
    s = s.replace(/_\{(-?[A-Za-z0-9.]+)\}/g, '_$1');

    s = s.replace(/\s*([()[\]{}])\s*/g, '$1');
    s = s.replace(/\s*([=+\-*/^<>])\s*/g, '$1');

    s = s.replace(/[ \t]+/g, ' ').trim();
    s = s.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '');

    return s.replace(/\s+/g, ' ').trim();
}

/**
 * Fold `,` `;` `&` `and` to `, ` without touching thousands separators.
 * Length may change, so callers must fold both sides the same way.
 */
export function foldSeparators(input: string, lower: boolean): string {
    const source = lower ? input.toLowerCase() : input;
    const collapsed = source.replace(/\s*([,;&])\s*/g, (match, _ch: string, offset: number) => {
        const previous = source[offset - 1] ?? '';
        const next = source[offset + match.length] ?? '';
        if (/[0-9]/.test(previous) && /[0-9]/.test(next)) return match;
        return ', ';
    });
    return collapsed.replace(/\band\b/g, ', ').replace(/\s+,/g, ',');
}

/**
 * Fold case, separators, and terminal punctuation for prose anchors.
 * Never applied to value text before unit parsing.
 */
export function normalizeLiteral(input: string): string {
    let s = foldSeparators(normalizePresentation(input), true);
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[.。]+$/, '');
    return s.trim();
}

/**
 * Matching haystack: presentation-normalized but **case preserved**, with
 * separators folded so `,`/`;`/`and` compare equal. Value slices taken from this
 * string keep unit case (`V` vs `v`).
 */
export function normalizeForMatch(input: string): string {
    const s = foldSeparators(normalizePresentation(input), false);
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * Strip display-only LaTeX wrappers for typed string comparison.
 * (Folded in from the old `session/normalize.ts`.)
 */
export function normaliseAnswerText(s: string): string {
    return normaliseWhitespace(
        s
            .replace(/\$\$?/g, '')
            .replace(/\\text\{([^{}]*)\}/g, '$1')
            .replace(/\\mathrm\{([^{}]*)\}/g, '$1')
            .replace(/\\(?:,|;|!| )/g, ' '),
    );
}