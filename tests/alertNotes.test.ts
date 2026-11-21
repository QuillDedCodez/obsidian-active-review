import { test, assert } from './harness';
import {
    formatSkippedNotes,
    formatWarningNotes,
    skippedIssueLabel,
} from '../src/ui/alertNotes';
import type { Warning } from '../src/parser';

test('skipped notes copy keeps the count header and one bullet per note', () => {
    const text = formatSkippedNotes([
        ['review/rv-a.md', 'missing ## ANSWERS'],
    ]);
    assert.equal(
        text,
        [
            '# Skipped Note — 1 note',
            '',
            '- [[review/rv-a.md]]',
            '  - Note Structure Error: missing ## ANSWERS',
        ].join('\n'),
    );
});

test('skipped notes copy pluralizes and preserves order', () => {
    const text = formatSkippedNotes([
        ['review/rv-a.md', 'bad fence'],
        ['review/rv-b.md', 'empty section'],
    ]);
    assert.equal(
        text,
        [
            '# Skipped Note — 2 notes',
            '',
            '- [[review/rv-a.md]]',
            '  - General Error: bad fence',
            '- [[review/rv-b.md]]',
            '  - General Error: empty section',
        ].join('\n'),
    );
});

test('skipped note labels identify the failing section or build stage', () => {
    assert.equal(
        skippedIssueLabel('rv-def: line 4: I = V / R — remove the explicit unit'),
        'Definitions Error',
    );
    assert.equal(skippedIssueLabel('rv-answer: unknown key "foo"'), 'Answers Error');
    assert.equal(skippedIssueLabel('rv-distract: anchor "x" is not defined'), 'Distractors Error');
    assert.equal(
        skippedIssueLabel('test: the answer is not a finite quantity set for the generated values'),
        'Answer Build Error',
    );
    assert.equal(skippedIssueLabel('missing "## QUESTIONS" text'), 'Note Structure Error');
    assert.equal(skippedIssueLabel('something else'), 'General Error');
});

test('warning copy totals every warning but counts notes separately', () => {
    const warnings: [string, Warning[]][] = [
        [
            'review/rv-a.md',
            [
                {
                    section: 'distractors',
                    message:
                        'pick-family produced 2 — using author-supplied ## DISTRACTORS to fill',
                },
                { section: 'answers', message: 'unit-optional defaults to true' },
            ],
        ],
        [
            'review/rv-b.md',
            [{ section: 'distractors', message: 'fewer choices than requested' }],
        ],
    ];
    const text = formatWarningNotes(warnings);
    assert.equal(
        text,
        [
            '# Warning Note — 3 warnings in 2 notes',
            '',
            '- [[review/rv-a.md]]',
            '  - ## DISTRACTORS: pick-family produced 2 — using author-supplied ## DISTRACTORS to fill',
            '  - ## ANSWERS: unit-optional defaults to true',
            '- [[review/rv-b.md]]',
            '  - ## DISTRACTORS: fewer choices than requested',
        ].join('\n'),
    );
});

test('warning copy uses singular forms for one warning in one note', () => {
    const text = formatWarningNotes([
        ['review/rv-a.md', [{ section: 'general', message: 'split across variants' }]],
    ]);
    assert.equal(
        text,
        [
            '# Warning Note — 1 warning in 1 note',
            '',
            '- [[review/rv-a.md]]',
            '  - ## GENERAL: split across variants',
        ].join('\n'),
    );
});

test('empty alert lists still produce a header', () => {
    assert.equal(formatSkippedNotes([]), '# Skipped Note — 0 notes\n');
    assert.equal(formatWarningNotes([]), '# Warning Note — 0 warnings in 0 notes\n');
});
