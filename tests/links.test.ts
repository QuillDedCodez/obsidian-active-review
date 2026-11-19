import { test, assert } from './harness';
import { isFlipped, linkName, parseVars, validateLinks } from '../src/parser';
import { drawAll } from '../src/session/draws';

function parse(block: string) {
    return parseVars(block, 'rv-def', {}, new Set());
}

test('link() accepts three or more members and pairs them on one index', () => {
    const r = parse('a = rand(1, 10, 1)\nb = rand(1, 10, 1)\nc = rand(1, 10, 1)\nlink(a, b, c)');
    assert.deepEqual(r.links, [['a', 'b', 'c']]);
    validateLinks(r.links, r.defs);

    const drawn = drawAll(r.defs, r.links, () => 0.5);
    assert.equal(drawn.a, 6);
    assert.equal(drawn.b, 6);
    assert.equal(drawn.c, 6);
});

test('link(a, -b) mirrors the shared index for the flipped member', () => {
    const r = parse('a = rand(1, 10, 1)\nb = rand(1, 10, 1)\nlink(a, -b)');
    assert.deepEqual(r.links, [['a', '-b']]);
    validateLinks(r.links, r.defs);

    for (let k = 0; k < 10; k++) {
        const drawn = drawAll(r.defs, r.links, () => k / 10);
        assert.equal(drawn.a, 1 + k, `leader at index ${k}`);
        assert.equal(drawn.b, 10 - k, `flipped member at index ${k}`);
        assert.equal(Number(drawn.a) + Number(drawn.b), 11, 'pair sums to first + last');
    }
});

test('link(a, -b) mirrors pick-family values', () => {
    const r = parse('p = pick(10, 20, 30)\nq = pick(40, 50, 60)\nlink(p, -q)');
    validateLinks(r.links, r.defs);

    const drawn = drawAll(r.defs, r.links, () => 0.9);
    assert.equal(drawn.p, 30);
    assert.equal(drawn.q, 40);
});

test('a flipped first link member is fatal at parse time', () => {
    assert.throws(
        () => parse('a = rand(1, 10, 1)\nb = rand(1, 10, 1)\nlink(-a, b)'),
        /first member cannot be flipped/,
    );
});

test('a flipped first link member is fatal in validateLinks too', () => {
    const r = parse('a = rand(1, 10, 1)\nb = rand(1, 10, 1)');
    assert.throws(() => validateLinks([['-a', 'b']], r.defs), /first member cannot be flipped/);
});

test('a flip marker with no name is fatal', () => {
    assert.throws(
        () => parse('a = rand(1, 10, 1)\nb = rand(1, 10, 1)\nlink(a, -)'),
        /missing name after "-"/,
    );
});

test('link() count mismatch names the flipped member without its marker', () => {
    const r = parse('a = rand(1, 10, 1)\nb = rand(1, 20, 1)\nlink(a, -b)');
    assert.throws(
        () => validateLinks(r.links, r.defs),
        /"b" has 20 values but "a" has 10 values/,
    );
});

test('linkName and isFlipped strip or report the flip marker', () => {
    assert.equal(linkName('-b'), 'b');
    assert.equal(linkName('b'), 'b');
    assert.equal(linkName('- b'), 'b');
    assert.equal(isFlipped('-b'), true);
    assert.equal(isFlipped('b'), false);
});
