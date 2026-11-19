import { test, assert } from './harness';
import { analyzeExpression } from '../src/math/expressionCriterion';
import { evaluate } from '../src/math/evaluator';
import { isInsideMath, mathStateAfter } from '../src/math/latex';
import { normalizePresentation } from '../src/math/normalize';
import { describeUnitLatex, fmtQuantity, parseUnitExpr } from '../src/math/units';
import { renderExpression } from '../src/math/symbolic';
import { fillPlaceholders, parseQuestionNote, parseVars, type VarDef } from '../src/parser';
import { buildQuantityQuestion } from '../src/session/build/quantity';
import { resolve, type Resolved } from '../src/session/resolve';
import { renderVariantWith } from '../src/session/grading/multiValue';
import type { AnswerVariantSpec } from '../src/math/units';

function defs(block: string): VarDef[] {
    return parseVars(block, 'rv-def', {}, new Set<string>()).defs;
}

function quantity(name = 'q'): Resolved {
    return resolve(defs(`${name} = 4; "cm"`), {});
}

const render = (source: string): string => renderExpression(source, { values: new Map() });

// ============================================================================
// Emission — only standard LaTeX reaches the card
// ============================================================================

test('emission: \\abs becomes \\left|…\\right|', () => {
    assert.equal(render('\\abs(x - 1)'), '\\left|x - 1\\right|');
});

test('emission: \\var renders the identifier instead of a custom command', () => {
    assert.equal(render('2\\var{area}'), '2\\mathrm{area}');
    assert.equal(render('\\var{a} + 1'), 'a + 1');
});

test('emission: a declared subscript stays a subscript', () => {
    assert.equal(render('x_i + 1'), 'x_{i} + 1');
    assert.equal(render('x_{i+1}'), 'x_{i+1}');
});

test('emission: combinatorics are upright letters, never \\C or \\P', () => {
    assert.equal(render('\\C(5, 2)'), '\\mathrm{C}(5, 2)');
    assert.equal(render('\\P(5, 2)'), '\\mathrm{P}(5, 2)');
    assert.equal(render('\\comb(5, 2)'), '\\mathrm{C}(5, 2)');
    assert.equal(render('\\perm(5, 2)'), '\\mathrm{P}(5, 2)');
});

test('emission: paren-form \\binom becomes braced', () => {
    assert.equal(render('\\binom(n, r)'), '\\binom{n}{r}');
});

test('emission: non-standard functions become \\operatorname', () => {
    assert.equal(render('\\round(x)'), '\\operatorname{round}(x)');
    assert.equal(render('\\roundTo(x, 1)'), '\\operatorname{roundTo}(x, 1)');
    assert.equal(render('\\radToDeg(x)'), '\\operatorname{radToDeg}(x)');
});

test('emission: standard operators and big operators keep their LaTeX', () => {
    assert.equal(render('\\min(x, 2)'), '\\min(x, 2)');
    assert.equal(render('\\sum_{i=1}^{n} i'), '\\sum_{i=1}^{n} i');
    assert.equal(render('\\prod_{i=1}^{n} i^{2}'), '\\prod_{i=1}^{n} i^{2}');
});

test('emission: calculus renders as standard notation', () => {
    assert.equal(
        render('\\lim_{x \\to a} x^{2}'),
        '\\lim_{x \\to a} x^{2}',
    );
    assert.equal(
        render('\\lim_{x \\to a^{+}} \\frac{1}{x}'),
        '\\lim_{x \\to a^{+}} \\frac{1}{x}',
    );
    assert.equal(
        render('\\frac{d}{dx} x^{2} \\bigg|_{x=a}'),
        '\\frac{d}{dx} x^{2}\\bigg|_{x=a}',
    );
    assert.equal(
        render('\\frac{d^{2}}{dx^{2}} x^{3} \\bigg|_{x=a}'),
        '\\frac{d^{2}}{dx^{2}} x^{3}\\bigg|_{x=a}',
    );
    assert.equal(render('\\frac{d}{dx} x^{2}'), '\\frac{d}{dx} x^{2}');
    assert.equal(
        render('\\frac{d}{dz} z^{2} \\bigg|_{z=a}'),
        '\\frac{d}{dz} z^{2}\\bigg|_{z=a}',
    );
    assert.equal(
        render('\\int_{a}^{b} x^{2}\\,dx'),
        '\\int_{a}^{b} x^{2}\\,dx',
    );
    assert.equal(
        render('\\int_{x=a}^{b} x^{2}'),
        '\\int_{a}^{b} x^{2}\\,dx',
    );
});

test('emission: constant calculus folds numerically', () => {
    assert.equal(render('\\lim_{x \\to 2} x^{2}'), '4');
    assert.equal(render('\\frac{d}{dx} x^{2} \\bigg|_{x=2}'), '4');
    assert.equal(render('\\int_{0}^{1} 2x\\,dx'), '1');
});

test('criterion: calculus syntax is accepted', () => {
    assert.equal(analyzeExpression('\\lim_{x \\to 0} x^{2}').status, 'valid');
    assert.equal(analyzeExpression('\\lim_{x \\to 0^{+}} \\frac{1}{x}').status, 'valid');
    assert.equal(analyzeExpression('\\frac{d}{dx} x^{2} \\bigg|_{x=1}').status, 'valid');
    assert.equal(analyzeExpression('\\frac{d^{2}}{dx^{2}} x^{3} \\bigg|_{x=1}').status, 'valid');
    assert.equal(analyzeExpression('\\int_{0}^{1} x^{2}\\,dx').status, 'valid');
    assert.equal(analyzeExpression('\\int_{x=0}^{1} x^{2}').status, 'valid');
});

test('emission: renderExpression output normalises back to itself', () => {
    assert.equal(normalizePresentation('\\left|x\\right|'), normalizePresentation('|x|'));
    assert.equal(normalizePresentation('\\mathrm{C}(5, 2)'), normalizePresentation('C(5, 2)'));
});

// ============================================================================
// Evaluation — factorial, big operators, combinatorics
// ============================================================================

test('evaluation: postfix factorial', () => {
    assert.equal(evaluate('5!', {}), 120);
    assert.equal(evaluate('(2 + 1)!', {}), 6);
});

test('evaluation: factorial rejects non-integers with a readable message', () => {
    assert.throws(() => evaluate('(-1)!', {}), /Factorial needs a non-negative integer/);
});

test('evaluation: \\sum and \\prod iterate', () => {
    assert.equal(evaluate('\\sum_{i=1}^{5} i', {}), 15);
    assert.equal(evaluate('\\prod_{i=1}^{4} i', {}), 24);
    assert.equal(evaluate('\\sum_{i=1}^{3} 2i', {}), 12);
});

test('evaluation: big-operator body binds at term level', () => {
    assert.equal(evaluate('\\sum_{i=1}^{5} i + 1', {}), 16);
    assert.equal(evaluate('\\sum_{i=2}^{4} i^{2}', {}), 29);
});

test('evaluation: permutation and combination aliases', () => {
    assert.equal(evaluate('\\perm(5, 2)', {}), 20);
    assert.equal(evaluate('\\comb(5, 2)', {}), 10);
});

test('evaluation: calculus — two-sided limits', () => {
    assert.ok(Math.abs(evaluate('\\lim_{x \\to 0} \\frac{\\sin(x)}{x}', {}) - 1) < 1e-6);
    assert.equal(evaluate('\\lim_{x \\to 2} x^{2}', {}), 4);
    assert.equal(evaluate('\\lim_{x \\to 0} \\frac{x}{x}', {}), 1);
});

test('evaluation: calculus — infinite and undefined limits', () => {
    assert.equal(evaluate('\\lim_{x \\to 0^{+}} \\frac{1}{x}', {}), Infinity);
    assert.equal(evaluate('\\lim_{x \\to 0^{-}} \\frac{1}{x}', {}), -Infinity);
    // Both sides diverge to the same infinity: defined.
    assert.equal(evaluate('\\lim_{x \\to 0} \\frac{1}{x^{2}}', {}), Infinity);
    // Opposite infinities are not a limit.
    assert.ok(Number.isNaN(evaluate('\\lim_{x \\to 0} \\frac{1}{x}', {})));
    // Different finite sides are not a limit.
    assert.ok(Number.isNaN(evaluate('\\lim_{x \\to 0} \\frac{\\abs(x)}{x}', {})));
});

test('evaluation: calculus — derivatives at a point', () => {
    assert.ok(Math.abs(evaluate('\\frac{d}{dx} x^{2} \\bigg|_{x=2}', {}) - 4) < 1e-4);
    assert.ok(Math.abs(evaluate('\\frac{d^{2}}{dx^{2}} x^{3} \\bigg|_{x=1}', {}) - 6) < 1e-2);
    assert.ok(Number.isNaN(evaluate('\\frac{d}{dx} \\abs(x) \\bigg|_{x=0}', {})));
    // Any variable works, not just x.
    assert.ok(Math.abs(evaluate('\\frac{d}{dz} z^{2} \\bigg|_{z=3}', {}) - 6) < 1e-4);
    // No bar: differentiate at the current drawn value.
    assert.ok(Math.abs(evaluate('\\frac{d}{dx} x^{2}', { x: 3 }) - 6) < 1e-4);
    // \diff is not a notation we accept.
    assert.throws(() => evaluate('\\diff_{x=1} x^{2}', {}), /Unsupported/);
});

test('evaluation: calculus — definite integrals', () => {
    assert.ok(Math.abs(evaluate('\\int_{0}^{1} x^{2}\\,dx', {}) - 1 / 3) < 1e-9);
    assert.ok(Math.abs(evaluate('\\int_{x=0}^{1} x^{2}', {}) - 1 / 3) < 1e-9);
    assert.ok(Math.abs(evaluate('\\int_{0}^{\\pi} \\sin(x)\\,dx', {}) - 2) < 1e-9);
    assert.ok(Math.abs(evaluate('\\int_{1}^{0} x\\,dx', {}) + 0.5) < 1e-9);
    assert.ok(Number.isNaN(evaluate('\\int_{-1}^{1} \\frac{1}{x}\\,dx', {})));
    // Endpoint singularity, nudged open.
    assert.ok(Math.abs(evaluate('\\int_{0}^{1} \\frac{1}{\\sqrt{x}}\\,dx', {}) - 2) < 1e-3);
});

test('evaluation: calculus — nested definite integrals', () => {
    assert.ok(Math.abs(evaluate('\\int_{x=0}^{1} \\int_{y=0}^{1} xy\\,dy', {}) - 0.25) < 1e-6);
});

test('evaluation: non-calculus render commands stay display-only', () => {
    assert.throws(() => evaluate('\\partial x', { x: 1 }), /display-only/);
    assert.throws(() => evaluate('\\infty', {}), /display-only/);
});

// ============================================================================
// Criterion — new syntax is accepted before evaluation
// ============================================================================

test('criterion: factorial and subscripts', () => {
    assert.equal(analyzeExpression('5!').status, 'valid');
    assert.equal(
        analyzeExpression('x_i + 1', { knownSymbols: new Set(['x_i']) }).status,
        'valid',
    );
});

test('criterion: \\sum and \\prod with a local index', () => {
    const analysis = analyzeExpression('\\sum_{i=1}^{n} i^{2}', {
        knownSymbols: new Set(['n']),
    });
    assert.equal(analysis.status, 'valid');
});

test('criterion: integral and limit are structurally valid', () => {
    assert.equal(
        analyzeExpression('\\int_{0}^{1} x^{2} dx', {
            knownSymbols: new Set(['x', 'd']),
        }).status,
        'valid',
    );
    assert.equal(
        analyzeExpression('\\lim_{x \\to 0} \\frac{1}{x}', {
            knownSymbols: new Set(['x']),
        }).status,
        'valid',
    );
});

test('criterion: partial-derivative notation', () => {
    assert.equal(
        analyzeExpression('\\frac{\\partial f}{\\partial x}', {
            knownSymbols: new Set(['f', 'x']),
        }).status,
        'valid',
    );
});

// ============================================================================
// Math-context detection
// ============================================================================

test('math detection: inline, display, paren and bracket forms', () => {
    assert.equal(isInsideMath('a $x$ b', 3), true);
    assert.equal(isInsideMath('$$x$$', 2), true);
    assert.equal(isInsideMath('\\(x\\)', 2), true);
    assert.equal(isInsideMath('\\[x\\]', 2), true);
    assert.equal(isInsideMath('a x b', 2), false);
});

test('math detection: escaped dollars and code spans are not math', () => {
    assert.equal(isInsideMath('\\$x$', 3), false);
    assert.equal(isInsideMath('`$x$`', 3), false);
});

test('math detection: state carries across assembled segments', () => {
    assert.equal(mathStateAfter('The mass is $'), true);
    assert.equal(mathStateAfter('$', true), false);
});

// ============================================================================
// Quantities inside math get \text{} units
// ============================================================================

test('units: simple and compound units render as upright text', () => {
    assert.equal(describeUnitLatex(parseUnitExpr('cm', 'si')), '\\text{cm}');
    assert.equal(
        describeUnitLatex(parseUnitExpr('kg*m/s^2', 'si')),
        '\\text{kg}\\cdot \\text{m}/\\text{s}^{2}',
    );
    assert.equal(describeUnitLatex(parseUnitExpr('m^2', 'si')), '\\text{m}^{2}');
});

test('placeholder: quantity inside $…$ wraps the unit in \\text', () => {
    const { values, sources } = quantity();
    assert.equal(
        fillPlaceholders('$<<rv:value:q>>$', values, sources),
        '$4\\,\\text{cm}$',
    );
    assert.equal(
        fillPlaceholders('$$<<rv:value:q>>$$', values, sources),
        '$$4\\,\\text{cm}$$',
    );
});

test('placeholder: quantity outside math stays plain', () => {
    const { values, sources } = quantity();
    assert.equal(fillPlaceholders('<<rv:value:q>>', values, sources), '4 cm');
    assert.equal(fillPlaceholders('a <<rv:val:q>> b', values, sources), 'a 4 cm b');
});

test('placeholder: code span and escaped dollar are not math', () => {
    const { values, sources } = quantity();
    assert.equal(
        fillPlaceholders('`<<rv:value:q>>`', values, sources),
        '`4 cm`',
    );
    assert.equal(
        fillPlaceholders('\\$<<rv:value:q>>', values, sources),
        '\\$4 cm',
    );
});

test('placeholder: expression form appends a wrapped unit inside math', () => {
    const { values, sources } = quantity();
    assert.equal(
        fillPlaceholders('$<<rv:expression:q>>$', values, sources),
        '$4\\,\\text{cm}$',
    );
    assert.equal(
        fillPlaceholders('<<rv:expression:q>>', values, sources),
        '4 cm',
    );
});

test('display source: \\abs is emitted as standard LaTeX', () => {
    assert.equal(
        fillPlaceholders('$<<rv:expression:d>>$', { a: -2 }, {}, {
            d: '\\abs(<<rv:val:a>>)',
        }),
        '$\\left|-2\\right|$',
    );
});

test('placeholder: display-only source keeps the wrapped unit intact', () => {    const { values, sources } = quantity();
    assert.equal(
        fillPlaceholders('$<<rv:expression:d>>$', values, sources, {
            d: '\\frac{<<rv:val:q>>}{2}',
        }),
        '$\\frac{4\\,\\text{cm}}{2}$',
    );
});

test('placeholder: prefix stays inside the same \\text group', () => {
    const resolved = resolve(defs('p = 4; "k"; "N"'), {});
    assert.equal(
        fillPlaceholders('$<<rv:value:p>>$', resolved.values, resolved.sources),
        '$4\\,\\text{kN}$',
    );
    assert.equal(
        fillPlaceholders('<<rv:value:p>>', resolved.values, resolved.sources),
        '4 kN',
    );
});

test('quantity formatting: scientific notation uses \\times inside math', () => {    const policy = {
        id: 'v',
        valueName: 'v',
        type: 'number' as const,
        unitSystem: 'si' as const,
        unit: parseUnitExpr('m', 'si'),
        unitMode: 'expanded' as const,
        display: 'atomic' as const,
        prefixPolicy: 'any' as const,
        allowedPrefixes: 'auto' as const,
        precision: { kind: 'sigfigs' as const, min: 3, max: 3 },
        notation: 'scientific' as const,
        unitOptional: false,
        tol: 0,
        relTol: 0,
    };
    assert.ok(fmtQuantity(12345, policy, { math: true }).includes('\\times 10^{'));
});

// ============================================================================
// Prose answers: math context per segment
// ============================================================================

test('quantity-mode card: $…$ wraps the unit, plain text does not', () => {
    const note = (stem: string): string =>
        [
            '## DEFINITIONS',
            '',
            '```rv-def',
            'ans = 4; "cm"',
            '```',
            '',
            '## QUESTIONS',
            '',
            stem,
            '',
            '## ANSWERS',
            '',
            '<<rv:value:ans>>',
            '',
        ].join('\n');

    const rng = (): number => 0.42;
    const inside = parseQuestionNote('review/q-in.md', note('Length: $<<rv:value:ans>>$.'), 'review');
    const outside = parseQuestionNote('review/q-out.md', note('Length: <<rv:value:ans>>.'), 'review');
    assert.ok(inside && outside);

    const inProblem = buildQuantityQuestion(inside, rng, rng, rng, 0);
    const outProblem = buildQuantityQuestion(outside, rng, rng, rng, 0);
    assert.ok(inProblem.text.includes('\\text{cm}'), inProblem.text);
    assert.ok(!inProblem.text.includes('4cm'), inProblem.text);
    assert.ok(!outProblem.text.includes('\\text{'), outProblem.text);
    assert.ok(outProblem.text.includes('cm'), outProblem.text);
});

test('prose variants: only the segment inside $…$ gets \\text units', () => {
    const variant = {
        raw: '',
        segments: [
            { kind: 'literal', text: 'The mass is $' },
            { kind: 'value', valueName: 'm' },
            { kind: 'literal', text: '$ kg, or ' },
            { kind: 'value', valueName: 'm' },
            { kind: 'literal', text: ' kilograms.' },
        ],
    } as unknown as AnswerVariantSpec;

    const text = renderVariantWith(variant, {
        m: (math: boolean) => (math ? '4\\,\\text{cm}' : '4 cm'),
    });
    assert.equal(text, 'The mass is $4\\,\\text{cm}$ kg, or 4 cm kilograms.');
});
