import { test, assert } from './harness';
import { parseAnswerSpec, type AnswerSpecContext } from '../src/parser/answers/answerSpec';
import { parseQuestionNote, parseVars, type VarDef } from '../src/parser';
import { buildQuantityQuestion } from '../src/session/build/quantity';
import { resolve } from '../src/session/resolve';
import {
    CURRENCIES,
    CURRENCY_CODES,
    DIMENSIONLESS_UNIT,
    fmtQuantity,
    gradeQuantity,
    normalizeQuantityText,
    parseUnitExpr,
    unitAccepted,
    type AnswerSlotSpec,
    type QuantityValue,
} from '../src/math/units';

function numericDef(name = 'v', value = 1000): VarDef {
    return {
        name,
        first: 0,
        last: 0,
        step: 1,
        fixed: true,
        kind: 'expr',
        valueType: 'quantity',
        quantity: { valueExpr: String(value), fixedValue: value, unit: DIMENSIONLESS_UNIT },
    };
}

function context(defs: VarDef[], blocks = ['<<rv:val:v>>']): AnswerSpecContext {
    return { vars: defs, stringNames: new Set<string>(), blocks };
}

function slot(bindings: string, defs = [numericDef()], blocks?: string[]): AnswerSlotSpec {
    const { spec } = parseAnswerSpec(bindings, context(defs, blocks));
    const result = spec.slots[0];
    assert.ok(result, 'expected a slot');
    return result;
}

function answer(policy: AnswerSlotSpec, canonical = 1000) {
    return { canonical, displayScale: 1, policy };
}

test('currency codes resolve as abstract units through unit strings', () => {
    for (const code of CURRENCY_CODES) {
        const unit = parseUnitExpr(code, 'abstract');
        assert.equal(unit.namespace, 'abstract', code);
        assert.equal(unit.factors.length, 1, code);
        assert.equal(unit.factors[0]!.unit.currencyCode, code, code);
        assert.equal(unit.factors[0]!.unit.quantity, `currency_${code}`, code);
    }
});

test('currency declared in rv-definitions via unit("USD")', () => {
    const defs = parseVars(
        'cost = 1000; ; unit("USD")\npeso = 500; ; unit("PHP")\nword = 7; ; unit("Dollar")',
        'rv-def',
        {},
        new Set<string>(),
    ).defs;
    const resolved = resolve(defs, {}).values;
    const cost = resolved.cost as QuantityValue;
    const peso = resolved.peso as QuantityValue;
    const word = resolved.word as QuantityValue;
    assert.equal(cost.unit.factors[0]!.unit.currencyCode, 'USD');
    assert.equal(peso.unit.factors[0]!.unit.currencyCode, 'PHP');
    assert.equal(word.unit.factors[0]!.unit.currencyCode, 'USD');
    assert.equal(cost.canonical, 1000);
});

test('rv-currency assigns the unit to a plain numeric definition', () => {
    const p = slot('v:\nrv-currency: USD\n');
    assert.equal(p.currency, 'USD');
    assert.equal(p.unit.namespace, 'abstract');
    assert.equal(p.unit.factors[0]!.unit.currencyCode, 'USD');
    assert.equal(p.unitSystem, 'abstract');
});

test('rv-currency validates the ISO code', () => {
    assert.throws(
        () => slot('v:\nrv-currency: XYZ\n'),
        /rv-currency = XYZ: expected one of/,
    );
});

test('rv-currency must agree with a definition-declared currency', () => {
    const usdDefs = parseVars('cost = 1000; ; unit("USD")', 'rv-def', {}, new Set<string>()).defs;
    const blocks = ['<<rv:val:cost>>'];
    const same = slot('cost:\nrv-currency: USD\n', usdDefs, blocks);
    assert.equal(same.currency, 'USD');
    assert.equal(same.unit.factors[0]!.unit.currencyCode, 'USD');
    assert.throws(
        () => slot('cost:\nrv-currency: PHP\n', usdDefs, blocks),
        /conflicts with the definition's USD unit/,
    );
});

test('rv-comma toggles grouped display without changing grading', () => {
    const plain = slot('v:\nrv-currency: USD\n');
    const grouped = slot('v:\nrv-currency: USD\nrv-comma: true\n');
    assert.equal(plain.groupThousands, false);
    assert.equal(grouped.groupThousands, true);
    assert.equal(fmtQuantity(1000, plain), '1000 USD');
    assert.equal(fmtQuantity(1000, grouped), '1,000 USD');
    const fullPrecision = slot('v:\nrv-currency: USD\nrv-comma: true\nmin-sigfigs = 7\n');
    assert.equal(fmtQuantity(1234567, fullPrecision), '1,234,567 USD');
    assert.ok(!fmtQuantity(1000000, plain).includes(','));
    assert.equal(answer(plain).canonical, answer(grouped).canonical);
});

test('rv-comma accepts only true or false', () => {
    assert.throws(() => slot('v:\nrv-comma: yes\n'), /rv-comma = yes: expected true or false/);
});

test('currency symbol label renders as a prefix with grouping', () => {
    const p = slot('v:\nrv-currency: USD\nrv-comma: true\nunit-label: $\n');
    assert.equal(fmtQuantity(1000, p), '$1,000');
});

test('all supported currencies accept their first alias as a label', () => {
    for (const code of CURRENCY_CODES) {
        const p = slot(`v:\nrv-currency: ${code}\n`);
        const a = answer(p);
        const alias = CURRENCIES[code].aliases[0]!;
        assert.equal(gradeQuantity(a, `${alias}1000`), true, `${code} / ${alias}`);
        assert.equal(gradeQuantity(a, '1000'), true, `${code} bare number`);
    }
});

test('currency grading accepts labels, commas, and bare numbers', () => {
    const a = answer(slot('v:\nrv-currency: USD\n'));
    for (const text of [
        '1000',
        '1,000',
        '$1000',
        '$1,000',
        'USD 1,000',
        'Dollar 1000',
        '1,000 USD',
        '1,000 dollars',
    ]) {
        assert.equal(gradeQuantity(a, text), true, text);
    }
});

test('currency grading rejects foreign labels', () => {
    const a = answer(slot('v:\nrv-currency: USD\n'));
    for (const text of ['PHP 1000', '1000 PHP', '€1000', '1000 EUR', '₱1,000', 'Yen 1000']) {
        assert.equal(gradeQuantity(a, text), false, text);
    }
});

test('comma grouping is an equivalent numeric magnitude', () => {
    const a = answer(slot('v:\nrv-currency: USD\n'));
    assert.equal(gradeQuantity(a, '1,000'), gradeQuantity(a, '1000'));
    assert.equal(gradeQuantity(answer(slot('v:\nrv-currency: USD\n'), 1000000), '1,000,000'), true);
});

test('unitAccepted matches only the exact currency code', () => {
    const p = slot('v:\nrv-currency: USD\n');
    assert.equal(unitAccepted(p.unit, p), true);
    assert.equal(unitAccepted(parseUnitExpr('PHP', 'abstract'), p), false);
    assert.equal(unitAccepted(parseUnitExpr('EUR', 'abstract'), p), false);
});

test('currency symbols are rewritten before unit tokenizing', () => {
    assert.equal(normalizeQuantityText('$1,000', 'abstract', 'USD'), '1000 USD');
    assert.equal(normalizeQuantityText('Dollar 1,000', 'abstract', 'USD'), '1000 USD');
    assert.equal(normalizeQuantityText('1000 PHP', 'abstract', 'USD'), '');
});

test('rv-comma groups the displayed answer and bound placeholders', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'cost = 1234567; ; unit("USD")',
        '```',
        '',
        '## QUESTIONS',
        '',
        'How much?',
        '',
        '## ANSWERS',
        '',
        '```rv-answer',
        'cost:',
        'rv-currency: USD',
        'rv-comma: true',
        'min-sigfigs = 7',
        '```',
        '',
        '<<rv:val:cost>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/currency.md', note, 'review');
    assert.ok(q);
    const rng = (): number => 0.42;
    const sq = buildQuantityQuestion(q, rng, rng, rng, 0);
    assert.equal(sq.correctText, '1,234,567 USD');
    const correct = sq.choices.find((choice) => choice.correct);
    assert.equal(correct?.text, '1,234,567 USD');
});
