import { test, assert } from './harness';
import { fillPlaceholders, parseQuestionNote, parseVars, type VarDef } from '../src/parser';
import { buildNumericQuestion } from '../src/session/build/numeric';
import { buildQuantityQuestion } from '../src/session/build/quantity';
import { buildQuestion } from '../src/session/build';
import { conditionDistractors, fillConditionedDistractor } from '../src/session/distractors/condition';
import { resolve } from '../src/session/resolve';
import {
    fmtQuantity,
    fmtQuantityValue,
    gradeQuantity,
    parseUnitExpr,
    quantityTolerance,
    unitAccepted,
    unitKey,
    type AnswerSlotSpec,
    type QuantityValue,
} from '../src/math/units';
import { buildMaxIndexSample, inRange, randAt } from '../src/session/draws';

function defs(block: string): VarDef[] {
    const env: Record<string, number> = {};
    const strings = new Set<string>();
    return parseVars(block, 'rv-def', env, strings).defs;
}

function resolvedQuantity(defsList: VarDef[], name: string): QuantityValue {
    const resolved = resolve(defsList, {});
    const value = resolved.values[name];
    assert.ok(value && typeof value === 'object' && 'canonical' in value);
    return value as QuantityValue;
}

function policy(unit: string, min = 3, max = 15): AnswerSlotSpec {
    return {
        id: 'v',
        valueName: 'v',
        type: 'number',
        unitSystem: 'si',
        unit: parseUnitExpr(unit, 'si'),
        unitMode: 'expanded',
        display: 'atomic',
        prefixPolicy: 'any',
        allowedPrefixes: 'auto',
        precision: { kind: 'sigfigs', min, max },
        notation: 'auto',
        unitOptional: false,
        tol: 0,
        relTol: 0,
    };
}

test('prefix applies globally and normalizes to a named unit', () => {
    const list = defs('a = 1; "m"; "N"\nb = 1; "m"; "kg""m"/("s"^2)');
    const a = resolvedQuantity(list, 'a');
    const b = resolvedQuantity(list, 'b');
    assert.equal(a.canonical, 0.001);
    assert.equal(b.canonical, 0.001);
    assert.equal(fmtQuantityValue(a), '1 mN');
    assert.equal(fmtQuantityValue(b), '1 mN');
});

test('global prefix on a powered unit stays in the magnitude', () => {
    const list = defs('a = 1; "m"; "m"^2');
    const a = resolvedQuantity(list, 'a');
    assert.equal(a.canonical, 0.001);
    assert.equal(fmtQuantityValue(a), '0.001 m^2');
});

test('quoted unit algebra normalizes to a named derived unit', () => {
    const list = defs('d = unit(\'kg\'\'m\'/(\'s\'^2))');
    const resolved = resolve(list, {});
    const unit = resolved.values.d;
    assert.ok(unit && typeof unit === 'object' && 'unit' in unit);
    assert.equal(unitKey(unit.unit), unitKey(parseUnitExpr('kg*m/s^2', 'si')));
});

test('dynamic prefix and unit picks resolve independently', () => {
    const list = defs(
        'p = pick("m", "u")\nq = pick("m", "s")\ns = prefixUnit(p)\nt = unit(q)\na = 1; s; t',
    );
    const resolved = resolve(list, { p: 'm', q: 's' });
    const a = resolved.values.a as QuantityValue;
    assert.ok(a);
    assert.equal(a.canonical, 0.001);
    assert.equal(fmtQuantityValue(a), '1 ms');
});

test('sigfig grading accepts rounded and trimmed values', () => {
    const p = policy('m');
    const answer = { canonical: 1.23456, displayScale: 1, policy: p };
    assert.equal(gradeQuantity(answer, '1.23 m'), true);
    assert.equal(gradeQuantity(answer, '1.235 m'), true);
    assert.equal(gradeQuantity(answer, '1.2346 m'), true);
    // One last-displayed-digit step at 3 sigfigs is 0.01, so 1.24 is inside
    // the magnitude tolerance around 1.23456.
    assert.equal(gradeQuantity(answer, '1.24 m'), true);
    assert.equal(gradeQuantity(answer, '1.2 m'), false);
});

test('sigfig grading accepts both candidates near a rounding boundary', () => {
    const p = policy('m');
    const answer = { canonical: 1.998, displayScale: 1, policy: p };
    assert.equal(gradeQuantity(answer, '2.00 m'), true);
    assert.equal(gradeQuantity(answer, '2 m'), true);
    assert.equal(gradeQuantity(answer, '1.99 m'), true);
    assert.equal(gradeQuantity(answer, '1.9 m'), false);
});

test('explicit maximum bound clamps accepted precision', () => {
    const p = policy('m', 3, 5);
    const answer = { canonical: 1.25678, displayScale: 1, policy: p };
    for (const text of ['1.25 m', '1.26 m', '1.256 m', '1.257 m', '1.2567 m', '1.2568 m']) {
        assert.equal(gradeQuantity(answer, text), true, text);
    }
    assert.equal(gradeQuantity(answer, '1.25678 m'), false);
    assert.equal(gradeQuantity(answer, '1.2 m'), false);
});

test('magnitude tolerance follows the normalized prefix and precision', () => {
    const five = quantityTolerance(1.0234e-5, policy('A', 5, 5));
    assert.equal(Number(five.shown.toFixed(3)), 10.234);
    assert.equal(five.step, 0.001);
    assert.equal(five.canonicalStep, 1e-9);

    const three = quantityTolerance(1.0234e-5, policy('A', 3, 15));
    assert.equal(Number(three.shown.toFixed(1)), 10.2);
    assert.equal(three.step, 0.1);
    assert.equal(three.canonicalStep, 1e-7);
});

test('magnitude tolerance accepts equivalent prefixes and scientific notation', () => {
    const p = policy('A', 5, 5);
    const answer = { canonical: 1.0234e-5, displayScale: 1e-6, policy: p };
    for (const text of ['10.234 µA', '10.234e-6 A', '1.0234e-5 A']) {
        assert.equal(gradeQuantity(answer, text), true, text);
    }
    assert.equal(gradeQuantity(answer, '10.235 µA'), true);
    assert.equal(gradeQuantity(answer, '10.24 µA'), false);
});

test('small-current quantity distractors keep pick-family values', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'I = pick(1e-5, 1.1e-5, 1.2e-5, 1.3e-5) ; ; "A"',
        '```',
        '',
        '## QUESTIONS',
        '',
        'Current is <<rv:value:I>>.',
        '',
        '## ANSWERS',
        '',
        '```rv-answer',
        'I:',
        'min-sigfigs = 5',
        'max-sigfigs = 5',
        'unit-optional = false',
        '```',
        '',
        '<<rv:value:I>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-small-current.md', note, 'review');
    assert.ok(q);
    const rng = (): number => 0.2;
    const sq = buildQuantityQuestion(q, rng, rng, rng, 0, 3);
    assert.ok(sq.choices.length >= 4, String(sq.choices.length));
    assert.equal(
        (sq.buildWarnings ?? []).some((warning) =>
            /no usable quantity distractors|no pick-family/i.test(warning.message),
        ),
        false,
    );
    const values = sq.choices.map((choice) => Number.parseFloat(choice.text));
    assert.equal(new Set(values).size, values.length);
});

test('decreasing rand ranges are accepted and stay inside their endpoints', () => {
    const list = defs('a = rand(20, 1, 1)');
    const a = list[0];
    assert.ok(a && a.kind === 'rand');
    assert.equal(a.first, 20);
    assert.equal(a.last, 1);
    const values = inRange(a, () => 0);
    assert.equal(values.length, 20);
    assert.equal(values[0], 20);
    assert.equal(values[19], 1);
    assert.equal(randAt(a, 5), 15);
    assert.equal(buildMaxIndexSample(20, 1, 1, 5).count, 5);
});

test('unit-optional false rejects a bare number', () => {
    const p = policy('m');
    const answer = { canonical: 1, displayScale: 1, policy: p };
    assert.equal(gradeQuantity(answer, '1'), false);
    assert.equal(gradeQuantity(answer, '1 m'), true);
});

test('fixed answer falls back to author distractors in MCQ', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = 6',
        'b = a + 1',
        'ans = b^2',
        'd1 = 3b',
        '```',
        '',
        '## QUESTIONS',
        '',
        'What is ans?',
        '',
        '## ANSWERS',
        '',
        '<<rv:value:ans>>',
        '',
        '## DISTRACTORS',
        '',
        '<<rv:value:d1>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-mcq-fixed.md', note, 'review');
    assert.ok(q);
    const rng = (): number => 0.42;
    const sq = buildNumericQuestion(q, rng, rng, 0);
    assert.ok(sq.choices.length >= 2);
    assert.ok(sq.choices.some((choice) => choice.correct));
    assert.ok(sq.choices.some((choice) => !choice.correct));
});

test('numeric rand distractors stay inside the declared nonnegative range', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'x = rand(1, 5, 1)',
        'ans = x',
        '```',
        '',
        '## QUESTIONS',
        '',
        'What is ans?',
        '',
        '## ANSWERS',
        '',
        '<<rv:val:ans>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-rand-domain.md', note, 'review');
    assert.ok(q);
    const rng = (): number => 0.42;
    const sq = buildNumericQuestion(q, rng, rng, 0);
    for (const choice of sq.choices) {
        const value = Number(choice.text);
        assert.ok(Number.isFinite(value), choice.text);
        assert.ok(value >= 0, choice.text);
        assert.ok(value <= 5, choice.text);
    }
});

test('pick-family dependencies produce MCQ distractors', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = pick(2,4,6,8)',
        'b = a + 1',
        'ans = b^2',
        'd1 = 3b',
        '```',
        '',
        '## QUESTIONS',
        '',
        'What is ans?',
        '',
        '## ANSWERS',
        '',
        '<<rv:value:ans>>',
        '',
        '## DISTRACTORS',
        '',
        '<<rv:value:d1>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-mcq-pick.md', note, 'review');
    assert.ok(q);
    const rng = (): number => 0.42;
    const sq = buildNumericQuestion(q, rng, rng, 0);
    assert.ok(sq.choices.length >= 2);
    assert.ok(sq.choices.some((choice) => choice.correct));
    assert.ok(sq.choices.some((choice) => !choice.correct));
});

test('empty unit declarations become the abstract unit', () => {
    const list = defs('a = 1;\nb = 1; ;\nc = 1; "" ; ""');
    for (const name of ['a', 'b', 'c']) {
        const value = resolvedQuantity(list, name);
        assert.equal(value.canonical, 1);
        assert.equal(fmtQuantityValue(value), '1 u');
    }
});

test('prefix-only abstract units normalize to scientific notation', () => {
    const list = defs('a = 1; "m";');
    const value = resolvedQuantity(list, 'a');
    assert.equal(value.canonical, 0.001);
    assert.equal(fmtQuantityValue(value), '1 × 10^-3 u');
});

test('stacked prefixes are rejected', () => {
    assert.throws(() => defs('a = unit("mkg")'), /unknown unit|prefix/i);
});

test('unit and string picks can drive quantity units', () => {
    const unitPick = defs('d = pick(unit("m"), unit("s"))\ng = 1; ; d');
    const resolvedUnit = resolve(unitPick, { d: parseUnitExpr('s', 'si') });
    const g1 = resolvedUnit.values.g as QuantityValue;
    assert.equal(fmtQuantityValue(g1), '1 s');

    const stringPick = defs('e = pick("m", "s")\ng = 1; ; e');
    const resolvedString = resolve(stringPick, { e: 's' });
    const g2 = resolvedString.values.g as QuantityValue;
    assert.equal(fmtQuantityValue(g2), '1 s');
});

test('quantity picks are typed and drawable', () => {
    const list = defs('p = pick(1; ; "m", 2; ; "s")');
    const resolved = resolve(list, { p: { canonical: 2, unit: parseUnitExpr('s', 'si') } });
    const value = resolved.values.p as QuantityValue;
    assert.equal(value.canonical, 2);
    assert.equal(fmtQuantityValue(value), '2 s');
});

test('quantity arithmetic propagates units', () => {
    const list = defs('a = 2; ; "m"\nb = a * 3\nc = a + a\nd = a * a\ne = sqrt(d)');
    const resolved = resolve(list, {});
    assert.equal(fmtQuantityValue(resolved.values.b as QuantityValue), '6 m');
    assert.equal(fmtQuantityValue(resolved.values.c as QuantityValue), '4 m');
    assert.equal(fmtQuantityValue(resolved.values.d as QuantityValue), '4 m^2');
    assert.equal(fmtQuantityValue(resolved.values.e as QuantityValue), '2 m');
});

test('quantity arithmetic accepts LaTeX braced exponents', () => {
    const list = defs([
        'U = 2; ; "m/s"',
        'A = 3; ; "m/s^2"',
        'P = 1; ; "s"',
        'Q = 4; ; "s"',
        'D = U * (Q - P) + 0.5 * A * (Q^{2} - P^{2})',
    ].join('\n'));
    const resolved = resolve(list, {});
    assert.equal(fmtQuantityValue(resolved.values.D as QuantityValue), '28.5 m');

    const nested = defs('a = 2; ; "m"\nb = a^{1 + 1}\nc = a^{2^{1}}');
    const nestedResolved = resolve(nested, {});
    assert.equal(fmtQuantityValue(nestedResolved.values.b as QuantityValue), '4 m^2');
    assert.equal(fmtQuantityValue(nestedResolved.values.c as QuantityValue), '4 m^2');
});

test('quantity arithmetic chains powers right-to-left and honours groups', () => {
    const list = defs([
        'u = 1; ; "u"',
        'chain = 2^2^2^2 * u',
        'braced = 2^{2}^{2}^{2} * u',
        'grouped = ((2^2)^2)^2 * u',
        'mixed = (2^2)^2^2 * u',
        'sign = -2^2 * u',
        'signGrouped = (-2)^2 * u',
    ].join('\n'));
    const resolved = resolve(list, {});
    const canonical = (name: string): number =>
        (resolved.values[name] as QuantityValue).canonical;
    assert.equal(canonical('chain'), 65536);
    assert.equal(canonical('braced'), 65536);
    assert.equal(canonical('grouped'), 256);
    assert.equal(canonical('mixed'), 256);
    assert.equal(canonical('sign'), -4);
    assert.equal(canonical('signGrouped'), 4);
});

test('display uses min-sigfigs while max-sigfigs only caps acceptance', () => {
    const p = policy('m', 3, 5);
    assert.equal(fmtQuantity(1.25678, p), '1.26 m');
    const defaultMax = policy('m');
    assert.equal(fmtQuantity(1.25678, defaultMax), '1.26 m');
});

test('accept-units filters naturally by the drawn dimension', () => {
    const base = policy('N');
    base.unitMode = 'list';
    base.acceptUnits = ['N', 'kg*m/s^2', 'm', 's'].map((unit) => parseUnitExpr(unit, 'si'));
    assert.equal(unitAccepted(parseUnitExpr('N', 'si'), base), true);
    assert.equal(unitAccepted(parseUnitExpr('m', 'si'), base), false);
    const metre = { ...base, unit: parseUnitExpr('m', 'si') };
    assert.equal(unitAccepted(parseUnitExpr('m', 'si'), metre), true);
    assert.equal(unitAccepted(parseUnitExpr('N', 'si'), metre), false);
});

test('unit-mode family separates angles from other dimensionless units', () => {
    const p = policy('rad');
    p.unitMode = 'family';
    assert.equal(unitAccepted(parseUnitExpr('deg', 'si'), p), true);
    assert.equal(unitAccepted(parseUnitExpr('%', 'si'), p), false);
});

test('numeric picks can mix literals and variables', () => {
    const list = defs('a = 2\np = pick(1, a)');
    const resolved = resolve(list, { p: 1 });
    assert.equal(resolved.values.p, 2);
});

test('trailing-zero padding is allowed only within the maximum sf', () => {
    const p = policy('m', 3, 5);
    const answer = { canonical: 1.25678, displayScale: 1, policy: p };
    assert.equal(gradeQuantity(answer, '1.250 m'), true);
    assert.equal(gradeQuantity(answer, '1.2500 m'), true);
    assert.equal(gradeQuantity(answer, '1.25000 m'), false);
});

test('abstract-unit quantities require the unit when unit-optional is false', () => {
    const list = defs('a = 1; "m";');
    const q = resolvedQuantity(list, 'a');
    const p: AnswerSlotSpec = {
        ...policy('m'),
        unit: parseUnitExpr('u', 'abstract'),
        unitSystem: 'abstract',
        unitOptional: false,
        precision: { kind: 'sigfigs', min: 3, max: 15 },
        notation: 'scientific',
    };
    const answer = { canonical: q.canonical, displayScale: 1, policy: p };
    assert.equal(gradeQuantity(answer, '0.001'), false);
    assert.equal(gradeQuantity(answer, '0.001 u'), true);
    assert.equal(gradeQuantity(answer, '1e-3 unit'), true);
});

test('more than two semicolons is rejected', () => {
    assert.throws(() => defs('a = 1; ; ;'), /too many semicolons/);
});

test('prefixUnit can be applied in pure unit algebra', () => {
    const list = defs('e = prefixUnit("k") * unit("m")\ng = 1; ; e');
    const resolved = resolve(list, {});
    assert.equal(fmtQuantityValue(resolved.values.g as QuantityValue), '1 km');
});

test('a numeric factor can be multiplied by a unit constructor', () => {
    const list = defs('a = 2 * unit("m")');
    const value = resolvedQuantity(list, 'a');
    assert.equal(value.canonical, 2);
    assert.equal(fmtQuantityValue(value), '2 m');
});

test('zero is graded exactly', () => {
    const p = policy('m');
    const answer = { canonical: 0, displayScale: 1, policy: p };
    assert.equal(gradeQuantity(answer, '0 m'), true);
    assert.equal(gradeQuantity(answer, '0.00 m'), true);
    assert.equal(gradeQuantity(answer, '0.001 m'), false);
});

test('random() is an alias for rand()', () => {
    const list = defs('a = random(1, 3, 1)');
    assert.equal(list[0]?.kind, 'rand');
});

test('unit("m/s") and unit("m"/"s") normalize identically', () => {
    const list = defs('a = unit("m/s")\nb = unit("m"/"s")');
    const resolved = resolve(list, {});
    assert.equal(
        unitKey((resolved.values.a as { unit: ReturnType<typeof parseUnitExpr> }).unit),
        unitKey((resolved.values.b as { unit: ReturnType<typeof parseUnitExpr> }).unit),
    );
});


test('rv-distract conditions free-text distractor quantities', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = pick(1, 2, 3)',
        'ans = 5; ; "m"',
        'd1 = 3; ; "cm"',
        'd2 = 3*10^2; ; "m"',
        '```',
        '',
        '## QUESTIONS',
        '',
        'What is ans?',
        '',
        '## ANSWERS',
        '',
        '<<rv:value:ans>>',
        '',
        '## DISTRACTORS',
        '',
        '```rv-distract',
        'd1, d2 <- ans',
        '```',
        '---',
        'd1 is <<rv:value:d1>>',
        '---',
        'd2 is <<rv:value:d2>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-distract-q.md', note, 'review');
    assert.ok(q);
    assert.deepEqual(q.distractorLinks, [{ anchor: 'ans', targets: ['d1', 'd2'] }]);
    const rng = (): number => 0.42;
    const sq = buildQuantityQuestion(q, rng, rng, rng, 0);
    const texts = sq.choices.map((choice) => choice.text);
    assert.ok(texts.includes('d1 is 3 m'), texts.join(' | '));
    assert.ok(texts.includes('d2 is 300 m'), texts.join(' | '));
});

test('rv-distract conditions expression and value placeholders', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = 3',
        'ans = 5; ; "m"',
        'd1 = a + 1',
        '```',
        '',
        '## QUESTIONS',
        '',
        'What is ans?',
        '',
        '## ANSWERS',
        '',
        '<<rv:value:ans>>',
        '',
        '## DISTRACTORS',
        '',
        '```rv-distract',
        'd1 <- ans',
        '```',
        '---',
        'value <<rv:value:d1>> source <<rv:expression:d1>> arg <<rv:expression:d1:a>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-distract-expr.md', note, 'review');
    assert.ok(q);
    const resolved = resolve(q.vars, {});
    const conditioned = conditionDistractors(q, resolved);
    const text = fillConditionedDistractor(
        q.distractorBlocks[0]!,
        resolved,
        conditioned,
        false,
    );
    assert.equal(text, 'value 4 m source (a + 1) m arg 4 m');
});

test('expression placeholders append the declared unit for quantity definitions', () => {
    const list = defs('a = 3\nq = 2 * a ; ; "m"\nd = 5 ; ; "m"\nn = 7');
    const resolved = resolve(list, {});
    const fill = (text: string): string =>
        fillPlaceholders(text, resolved.values, resolved.sources, resolved.displaySources);
    assert.equal(fill('<<rv:expression:q:a>>'), '6 m');
    assert.equal(fill('<<rv:expression:d>>'), '5 m');
    assert.equal(fill('<<rv:expression:n>>'), '7');
});

test('prefixUnit can carry a global prefix through compound unit algebra', () => {
    const list = defs('u = prefixUnit("m") * unit("kg") * unit("m") / unit("s")^2\na = 1; ; u');
    const value = resolvedQuantity(list, 'a');
    assert.equal(value.canonical, 0.001);
    assert.equal(fmtQuantityValue(value), '1 mN');
});

test('a numeric factor times prefixUnit and unit forms a quantity', () => {
    const list = defs('a = 1 * prefixUnit("m") * unit("N")');
    const value = resolvedQuantity(list, 'a');
    assert.equal(value.canonical, 0.001);
    assert.equal(fmtQuantityValue(value), '1 mN');
});

test('pick() magnitudes in a quantity declaration are drawable', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'V = pick(6, 12) ; ; "V"',
        'R = pick(2, 4) ; ; "Ω"',
        'I = V / R',
        '```',
        '',
        '## QUESTIONS',
        '',
        'A resistor of <<rv:value:R>> has <<rv:value:V>> across it.',
        '',
        '## ANSWERS',
        '',
        '```rv-answer',
        'V:',
        'I:',
        '```',
        '',
        'V = <<rv:value:V>>, I = <<rv:value:I>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-quantity-pick.md', note, 'review');
    assert.ok(q);
    assert.equal(q.vars.find((def) => def.name === 'V')?.kind, 'exprPick');
    assert.equal(q.vars.find((def) => def.name === 'V')?.fixed, false);
    const rng = (): number => 0.99;
    const sq = buildQuestion(q, rng, rng, rng, 1, 4);
    // V / Ω reduces to the named base unit A for display.
    assert.ok(/ A$/.test(sq.correctText), sq.correctText);
});

test('an explicit unit on a quantity expression is rejected with detail', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'V = pick(6, 12) ; ; "V"',
        'R = pick(2, 4) ; ; "Ω"',
        'I = V / R ; ; "A"',
        '```',
        '',
        '## QUESTIONS',
        '',
        'Find the voltage and the current.',
        '',
        '## ANSWERS',
        '',
        '```rv-answer',
        'V:',
        'I:',
        '```',
        '',
        'V = <<rv:value:V>>, I = <<rv:value:I>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-redundant-unit.md', note, 'review');
    assert.ok(q);
    const rng = (): number => 0.5;
    assert.throws(
        () => buildQuestion(q, rng, rng, rng, 1, 4),
        /Remove the explicit unit and write I = V \/ R/,
    );
});

test('string anchors stringify conditioned targets', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'ans = "anchor"',
        'd1 = 4; ; "m"',
        '```',
        '',
        '## QUESTIONS',
        '',
        'Q',
        '',
        '## ANSWERS',
        '',
        '<<rv:value:ans>>',
        '',
        '## DISTRACTORS',
        '',
        '```rv-distract',
        'd1 <- ans',
        '```',
        '---',
        'd1 is <<rv:value:d1>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-distract-string.md', note, 'review');
    assert.ok(q);
    const resolved = resolve(q.vars, {});
    const conditioned = conditionDistractors(q, resolved);
    const text = fillConditionedDistractor(q.distractorBlocks[0]!, resolved, conditioned, false);
    assert.equal(text, 'd1 is 4 m');
});
