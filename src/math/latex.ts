/**
 * Obsidian-compatible LaTeX for everything the plugin prints.
 *
 * Obsidian renders mathematics with MathJax (app) and KaTeX (Publish) inside
 * `$…$` for inline and `$$…$$` for display. Neither engine defines the
 * plugin's own commands (`\abs`, `\var`, `\round`, `\C`, …), so anything the
 * plugin emits has to be plain, standard LaTeX or the card shows an error
 * instead of mathematics. Every display path funnels through this module.
 */

/** Upright operators LaTeX already defines — emitted unchanged. */
const STANDARD_OPERATORS: ReadonlySet<string> = new Set([
    'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan',
    'csc', 'sec', 'cot', 'log', 'ln', 'exp', 'min', 'max',
]);

/**
 * Combination / permutation render as upright letters. `\C` is undefined in
 * MathJax/KaTeX and `\P` silently renders as ¶, so both are rewritten.
 */
const COMBINATORIC_NAMES: Readonly<Record<string, string>> = {
    C: 'C',
    comb: 'C',
    P: 'P',
    perm: 'P',
};

/** Render one plugin function call as Obsidian-supported LaTeX. */
export function latexCall(name: string, args: string[]): string {
    const list = args.join(', ');
    if (name === 'abs') return `\\left|${args[0] ?? ''}\\right|`;
    const upright = COMBINATORIC_NAMES[name];
    if (upright !== undefined) return `\\mathrm{${upright}}(${list})`;
    if (STANDARD_OPERATORS.has(name)) return `\\${name}(${list})`;
    return `\\operatorname{${name}}(${list})`;
}

/**
 * Render a variable identifier. One letter stays bare; longer names go
 * upright (`\mathrm`) so `LA` reads as one name rather than L·A, and a
 * declared `a_i` keeps its subscript instead of collapsing to `a` · `i`.
 */
export function latexIdentifier(name: string): string {
    const cut = name.indexOf('_');
    if (cut > 0) {
        return `${latexIdentifier(name.slice(0, cut))}_{${name.slice(cut + 1)}}`;
    }
    return name.length <= 1 ? name : `\\mathrm{${name}}`;
}

/** Escape text that will sit inside `\text{…}`. */
export function latexText(text: string): string {
    return text.replace(/[\\{}%$#&_]/g, (ch) => `\\${ch}`);
}

/** Upright unit text for math mode: `\text{cm}`, `\text{kN}`. */
export function latexUnitText(text: string): string {
    return `\\text{${latexText(text)}}`;
}

/** Scan `text` and report whether the math state has flipped by `index`. */
function mathStateAt(text: string, index: number, start: boolean): boolean {
    let i = 0;
    let inline = start;
    let display = false;
    let paren = false;
    let bracket = false;

    while (i < index) {
        const ch = text[i]!;
        if (ch === '`') {
            const end = text.indexOf('`', i + 1);
            if (end < 0 || end >= index) return false;
            i = end + 1;
            continue;
        }
        if (ch === '\\') {
            const next = text[i + 1];
            if (next === '$') {
                i += 2;
                continue;
            }
            if (next === '(') paren = true;
            else if (next === ')') paren = false;
            else if (next === '[') bracket = true;
            else if (next === ']') bracket = false;
            i += 2;
            continue;
        }
        if (ch === '$') {
            if (text[i + 1] === '$') {
                display = !display;
                i += 2;
                continue;
            }
            inline = !inline;
            i++;
            continue;
        }
        i++;
    }

    return inline || display || paren || bracket;
}

/**
 * True when `index` falls inside `$…$`, `$$…$$`, `\(…\)`, or `\[…\]`.
 * Code spans (backticks) and escaped `\$` are skipped, because Obsidian does
 * not render math there.
 */
export function isInsideMath(text: string, index: number): boolean {
    return mathStateAt(text, index, false);
}

/**
 * Math state after a whole fragment, used when a sentence is assembled from
 * literal and substituted segments (`$…$` lives in the literals).
 */
export function mathStateAfter(text: string, start = false): boolean {
    return mathStateAt(text, text.length, start);
}
