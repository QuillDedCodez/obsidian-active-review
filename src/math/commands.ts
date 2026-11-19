/** Function-name tables shared by the evaluator, symbolic renderer, and placeholder normaliser. */

/** Evaluator functions that take one parenthesised argument. */
export const EVAL_FUNC_ONE_ARG: ReadonlySet<string> = new Set([
    'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'csc', 'sec', 'cot',
    'log', 'ln', 'exp', 'abs', 'round', 'radToDeg', 'degToRad',
]);

/** Evaluator functions that take two comma-separated arguments. */
export const EVAL_FUNC_TWO_ARG: ReadonlySet<string> = new Set([
    'min', 'max', 'roundTo',
    // Combinatorics: `\perm(5, 2)` and `\comb(5, 2)` are the spelled-out
    // aliases of `\P(n, r)` and `\C(n, r)`.
    'perm', 'comb',
]);

/** Big operators with a lower and an upper limit; both evaluate by iteration. */
export const BIG_OPERATORS: ReadonlySet<string> = new Set(['sum', 'prod']);

/**
 * Calculus operators evaluated numerically: limits by extrapolated one-sided
 * sampling and integrals by adaptive quadrature. Derivatives use the standard
 * `\frac{d}{dx} … \big|_{x=a}` form, so they need no command of their own.
 * No algebraic manipulation is attempted.
 */
export const CALCULUS_COMMANDS: ReadonlySet<string> = new Set(['int', 'lim']);

/**
 * Commands that are valid Obsidian LaTeX but never produce a number.
 * (Currently empty; reserved for future render-only constructs.)
 */
export const DISPLAY_ONLY_COMMANDS: ReadonlySet<string> = new Set();

/**
 * Upright/relational glyphs that appear in typed answers (`\partial`,
 * `\infty`, `\pm`, `\leq`, …). They parse as symbols for structural
 * comparison but are never evaluated.
 */
export const LATEX_SYMBOL_COMMANDS: ReadonlySet<string> = new Set([
    'partial', 'infty', 'pm',
    'leq', 'le', 'geq', 'ge', 'neq', 'approx', 'equiv',
    'to', 'rightarrow', 'cdots', 'ldots', 'dots',
]);

/** LaTeX commands whose parenthesised body the display normaliser rewrites. */
export const DISPLAY_FUNC_WITH_PAREN: ReadonlySet<string> = new Set([
    ...EVAL_FUNC_ONE_ARG,
    'min',
    'max',
    'roundTo',
    'classify',
]);

/** Display-normaliser commands with two arguments (comma-separated). */
export const DISPLAY_FUNC_WITH_PAREN_2ARG: ReadonlySet<string> = new Set([
    'min',
    'max',
    'roundTo',
    'C',
    'P',
    'perm',
    'comb',
]);

/**
 * Every command the expression criterion treats as a named function. Used as
 * the default `knownFunctions` for `analyzeExpression`; structural commands
 * (`\frac`, `\sqrt`), big operators (`\sum`), display-only commands, and
 * constants (`\pi`, `\circ`) are handled separately.
 */
export const MATH_FUNCTIONS: ReadonlySet<string> = new Set([
    ...EVAL_FUNC_ONE_ARG,
    ...EVAL_FUNC_TWO_ARG,
    'binom',
    'C',
    'P',
]);
