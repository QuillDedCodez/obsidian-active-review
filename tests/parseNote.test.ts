import { test, assert } from './harness';
import { parseQuestionNote } from '../src/parser';

test('parseQuestionNote assembles sections and frontmatter properties', () => {
    const note = [
        '---',
        'rv-category: physics/kinematics',
        'rv-priority: 25',
        '---',
        '',
        '## QUESTIONS',
        '',
        'What is displacement?',
        '',
        '---',
        '',
        'Define displacement.',
        '',
        '## ANSWERS',
        '',
        'Change in position',
        '',
        '---',
        '',
        'The straight-line distance from start to finish',
        '',
        '## EXPLANATIONS',
        '',
        'Displacement is a vector.',
        '',
    ].join('\n');

    const q = parseQuestionNote('review/physics/rv-displacement.md', note, 'review');
    assert.ok(q);
    assert.equal(q.priority, 25);
    assert.deepEqual(q.category, ['physics']);
    assert.deepEqual(q.declaredCategory, ['physics', 'kinematics']);
    assert.equal(q.categorySource, 'folder');
    assert.equal(q.variants.length, 2);
    assert.equal(q.answerBlocks.length, 2);
    assert.equal(q.answerMode, 'text');
    assert.equal(q.explanation, 'Displacement is a vector.');
});

test('parseQuestionNote keeps the quantity answer path after section extraction', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'v = 2; ; "u"',
        '```',
        '',
        '## QUESTIONS',
        '',
        'The value is <<rv:val:v>>.',
        '',
        '## ANSWERS',
        '',
        '```rv-answer',
        'v:',
        '```',
        '',
        '<<rv:value:v>>',
        '',
    ].join('\n');

    const q = parseQuestionNote('review/rv-value.md', note, 'review');
    assert.ok(q);
    assert.equal(q.answerMode, 'numeric');
    assert.equal(q.answerFormat, 'quantity');
    assert.deepEqual(q.answerValNames, ['v']);
    assert.equal(q.answerName, 'v');
    assert.equal(q.numericAnswerBlocks.length, 1);
});

test('parseQuestionNote builds a default quantity answer without rv-answer', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = 1; ; "m"',
        '```',
        '',
        '## QUESTIONS',
        '',
        'Length: <<rv:value:a>>',
        '',
        '## ANSWERS',
        '',
        '<<rv:value:a>>',
        '',
    ].join('\n');

    const q = parseQuestionNote('review/rv-default-quantity.md', note, 'review');
    assert.ok(q);
    assert.equal(q.answerFormat, 'quantity');
    assert.equal(q.answerMode, 'numeric');
    assert.equal(q.answerSpec?.slots.length, 1);
    assert.equal(q.answerSpec?.slots[0]?.valueName, 'a');
    assert.equal(q.answerSpec?.slots[0]?.unitOptional, false);
    assert.equal(q.answerSpec?.slots[0]?.precision?.min, 3);
    assert.equal(q.answerSpec?.slots[0]?.precision?.max, 15);
});

test('answer variants keep the highest placeholder count and drop lower ones', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = 1',
        'b = 2',
        'c = 3',
        'd = 4',
        '```',
        '',
        '## QUESTIONS',
        '',
        'Q',
        '',
        '## ANSWERS',
        '',
        '<<rv:val:a>> <<rv:val:b>> <<rv:val:c>>',
        '---',
        '<<rv:val:a>> <<rv:val:b>> <<rv:val:c>> <<rv:val:d>>',
        '---',
        '<<rv:val:d>> <<rv:val:c>> <<rv:val:b>> <<rv:val:a>>',
        '',
    ].join('\n');

    const q = parseQuestionNote('review/rv-variants.md', note, 'review');
    assert.ok(q);
    assert.equal(q.answerBlocks.length, 2);
    assert.ok(q.warnings.some((warning) => /highest count is 4/.test(warning.message)));
});

test('same-count answer variants with different placeholders skip the note', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = 1',
        'b = 2',
        'c = 3',
        'd = 4',
        'e = 5',
        '```',
        '',
        '## QUESTIONS',
        '',
        'Q',
        '',
        '## ANSWERS',
        '',
        '<<rv:val:a>> <<rv:val:b>> <<rv:val:c>> <<rv:val:d>>',
        '---',
        '<<rv:val:a>> <<rv:val:b>> <<rv:val:c>> <<rv:val:e>>',
        '',
    ].join('\n');

    assert.throws(
        () => parseQuestionNote('review/rv-variant-mismatch.md', note, 'review'),
        /same placeholder set/,
    );
});

test('parseQuestionNote drops excluded notes', () => {
    const note = ['---', 'rv-exclude: true', '---', '', '## QUESTIONS', '', 'Q', '', '## ANSWERS', '', 'A', ''].join('\n');
    assert.equal(parseQuestionNote('review/rv-excluded.md', note, 'review'), null);
});

test('rv-answer display settings are kept for MCQ use', () => {
    const note = [
        '## DEFINITIONS',
        '',
        '```rv-def',
        'a = 1; ; "m"',
        '```',
        '',
        '## QUESTIONS',
        '',
        'Length: <<rv:value:a>>',
        '',
        '## ANSWERS',
        '',
        '```rv-answer',
        'a:',
        'min-sigfigs = 5',
        'display = expanded',
        '```',
        '',
        '<<rv:value:a>>',
        '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-display.md', note, 'review');
    assert.ok(q);
    assert.equal(q.answerSpec?.slots[0]?.precision?.min, 5);
    assert.equal(q.answerSpec?.slots[0]?.display, 'expanded');
});

test('rv-distract outside DISTRACTORS is an error', () => {
    const note = [
        '## DEFINITIONS', '', '```rv-def', 'ans = 5; ; "m"', 'd1 = 3; ; "m"', '```', '',
        '## QUESTIONS', '', 'Q', '',
        '## ANSWERS', '', '<<rv:value:ans>>', '',
        '```rv-distract', 'd1 <- ans', '```', '',
    ].join('\n');
    assert.throws(
        () => parseQuestionNote('review/rv-distract-outside.md', note, 'review'),
        /must appear inside "## DISTRACTORS"/,
    );
});

test('rv-distract last anchor wins and warns', () => {
    const note = [
        '## DEFINITIONS', '', '```rv-def', 'ans1 = 5; ; "m"', 'ans2 = 7; ; "m"', 'd1 = 3; ; "cm"', '```', '',
        '## QUESTIONS', '', 'Q', '',
        '## ANSWERS', '', '<<rv:value:ans2>>', '',
        '## DISTRACTORS', '',
        '```rv-distract', 'd1 <- ans1', 'd1 <- ans2', '```', '---', 'd1 is <<rv:value:d1>>', '',
    ].join('\n');
    const q = parseQuestionNote('review/rv-distract-last.md', note, 'review');
    assert.ok(q);
    assert.deepEqual(q.distractorLinks, [{ anchor: 'ans2', targets: ['d1'] }]);
    assert.ok(q.warnings.some((warning) => /last anchor "ans2" wins/.test(warning.message)));
});
