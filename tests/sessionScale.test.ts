import { test, assert } from './harness';
import { parseQuestionNote, parseVars } from '../src/parser';
import {
    MAX_ALTERNATIVES,
    drawableAlternatives,
    inRange,
} from '../src/session/draws';
import { mulberry32 } from '../src/session/rng';
import { buildSession } from '../src/session/assemble';
import { DEFAULT_SESSION_CONFIG } from '../src/constants';

function bigPick(count: number) {
    const block = `b = pick(${Array.from({ length: count }, (_, i) => i + 1).join(',')})`;
    const parsed = parseVars(block, 'rv-def', {}, new Set());
    return parsed.defs[0]!;
}

test('large pick families yield a bounded, deterministic alternative sample', () => {
    const def = bigPick(5000);

    const first = drawableAlternatives(def, mulberry32(7));
    const second = drawableAlternatives(def, mulberry32(7));

    assert.ok(first.length <= MAX_ALTERNATIVES, String(first.length));
    assert.deepEqual(first, second);
    assert.ok(inRange(def, mulberry32(7)).length <= MAX_ALTERNATIVES);
});

test('a question with a huge pick family still builds a full choice set', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = 5',
        `b = pick(${Array.from({ length: 5000 }, (_, i) => i + 1).join(',')})`,
        'ans = a + 0*b',
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
    ].join('\n');

    const q = parseQuestionNote('review/rv-scale.md', note, 'review');
    assert.ok(q);
    const result = buildSession([q], { ...DEFAULT_SESSION_CONFIG, seed: 1 }, 'review');
    assert.equal(result.errors.length, 0);
    assert.ok((result.items[0]?.choices.length ?? 0) >= 2);
});
