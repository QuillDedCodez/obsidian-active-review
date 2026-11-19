import { test, assert } from './harness';
import { parseAnswerSpec, type AnswerSpecContext } from '../src/parser/answers/answerSpec';
import { DIMENSIONLESS_UNIT } from '../src/math/units';
import type { VarDef } from '../src/parser';

const quantityDef: VarDef = {
    name: 'v',
    first: 0,
    last: 0,
    step: 1,
    fixed: true,
    kind: 'expr',
    valueType: 'quantity',
    quantity: { valueExpr: '1', fixedValue: 1, unit: DIMENSIONLESS_UNIT },
};

const context: AnswerSpecContext = {
    vars: [quantityDef],
    stringNames: new Set<string>(),
    blocks: ['<<rv:val:v>>'],
};

test('deprecated sigfigs alias is rejected', () => {
    assert.throws(
        () => parseAnswerSpec('v:\nsigfigs = 3\n', context),
        /unknown key "sigfigs"/,
    );
});

test('removed unit key is rejected', () => {
    assert.throws(
        () => parseAnswerSpec('v:\nunit = none\n', context),
        /unknown key "unit"/,
    );
});

test('removed tolerance keys are rejected', () => {
    assert.throws(
        () => parseAnswerSpec('v:\ntol = 0.1\n', context),
        /unknown key "tol"/,
    );
});

test('min and max sigfigs are parsed independently', () => {
    const parsed = parseAnswerSpec('v:\nmin-sigfigs = 2\nmax-sigfigs = 5\n', context);
    const precision = parsed.spec.slots[0]!.precision!;
    assert.equal(precision.kind, 'sigfigs');
    assert.equal(precision.min, 2);
    assert.equal(precision.max, 5);
});

test('non-quantity bindings warn and are ignored', () => {
    const parsed = parseAnswerSpec('v:\n', {
        ...context,
        vars: [{ ...quantityDef, valueType: 'number', quantity: undefined }],
    });
    assert.equal(parsed.spec.slots.length, 0);
    assert.match(parsed.warnings[0]?.message ?? '', /not a quantity definition/);
});

test('old rvdef syntax is a migration error', () => {
    assert.throws(
        () => parseAnswerSpec('rvdef(v)\n', context),
        /rvdef\(name\) has been removed/,
    );
});

test('global typed-mode and sep must appear before headers', () => {
    const parsed = parseAnswerSpec('typed-mode = values\nsep = ";"\nv:\n', context);
    assert.equal(parsed.spec.typedMode, 'values');
    assert.equal(parsed.spec.sep, ';');
    assert.throws(
        () => parseAnswerSpec('v:\ntyped-mode = values\n', context),
        /must appear before the first variable header/,
    );
});

test('unknown variable headers error', () => {
    assert.throws(
        () => parseAnswerSpec('missing:\nmin-sigfigs = 3\n', context),
        /is not defined/,
    );
});

test('rv-currency and rv-comma are recognized slot bindings', () => {
    const parsed = parseAnswerSpec('v:\nrv-currency: USD\nrv-comma: true\n', context);
    const slot = parsed.spec.slots[0]!;
    assert.equal(slot.currency, 'USD');
    assert.equal(slot.groupThousands, true);
});
