import { test, assert } from './harness';
import { DEFAULT_SESSION_CONFIG } from '../src/constants';
import { parseQuestionNote } from '../src/parser';
import { buildSession } from '../src/session/assemble';
import {
    configFromSnapshot,
    parseSessionLog,
    serializeSessionLog,
    snapshotFromConfig,
    type SessionLogState,
} from '../src/vault/sessionLog';

function textNote(distractors: number): string {
    const blocks = ['One', 'Two', 'Three', 'Four', 'Five'].slice(0, distractors);
    return [
        '## QUESTIONS',
        '',
        'Q',
        '',
        '## ANSWERS',
        '',
        'A',
        '',
        '## DISTRACTORS',
        '',
        blocks.join('\n---\n'),
        '',
    ].join('\n');
}

function numericNote(): string {
    return [
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
}

function buildChoices(note: string, choiceCount: number): number {
    const q = parseQuestionNote('review/choices/q.md', note, 'review');
    assert.ok(q);
    const result = buildSession([q], { ...DEFAULT_SESSION_CONFIG, seed: 1, choiceCount }, 'review');
    assert.equal(result.errors.length, 0);
    return result.items[0]?.choices.length ?? 0;
}

test('choice count caps generated and author distractors', () => {
    assert.equal(buildChoices(numericNote(), 2), 2);
    assert.equal(buildChoices(numericNote(), 4), 4);
    assert.equal(buildChoices(numericNote(), 6), 6);

    assert.equal(buildChoices(textNote(5), 2), 2);
    assert.equal(buildChoices(textNote(5), 4), 4);
    assert.equal(buildChoices(textNote(5), 6), 6);
});

test('choice count round-trips through the session snapshot', () => {
    const snapshot = snapshotFromConfig({ ...DEFAULT_SESSION_CONFIG, choiceCount: 5 });
    assert.equal(configFromSnapshot(snapshot).choiceCount, 5);

    const log: SessionLogState = {
        schema_version: 1,
        session_id: '2026-01-01-000000',
        session_name: '',
        status: 'pending',
        archived_from: null,
        created: '2026-01-01T00:00:00.000Z',
        completed_at: null,
        mode: 'choice',
        source_session: null,
        reproduced_into: [],
        session_seed: 1,
        session_seed_default: 1,
        rounds: 1,
        round_history: [],
        qs_snapshot: snapshot,
        frozen_pool: [],
        initial_order: [],
        answers: {},
        flags: [],
        scratch: {},
        timer_state: null,
    };

    const text = serializeSessionLog(log, []);
    const parsed = parseSessionLog(text);
    assert.ok(parsed);
    assert.equal(configFromSnapshot(parsed.qs_snapshot).choiceCount, 5);

    // Older session notes have no `choices` line and keep the historical default.
    const legacyText = text.replace(/^\s*choices:.*\n/m, '');
    const legacyParsed = parseSessionLog(legacyText);
    assert.ok(legacyParsed);
    assert.equal(configFromSnapshot(legacyParsed.qs_snapshot).choiceCount, 4);
});
