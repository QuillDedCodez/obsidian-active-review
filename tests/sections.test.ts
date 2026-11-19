import { test, assert } from './harness';
import {
    DEBUG_CALLED_DEFINITIONS_MARKER,
    IGNORE_WARNINGS_MARKER,
    extractSections,
} from '../src/parser/sections';

test('plain section headers are recognised', () => {
    const result = extractSections('## questions\nA\n');
    assert.deepEqual([...result.sections.keys()], ['questions']);
    assert.equal(result.ignoredWarnings.size, 0);
    assert.equal(result.literalSections.size, 0);
});

test('ignore-warnings HTML marker is stripped and recorded', () => {
    const result = extractSections(`## questions ${IGNORE_WARNINGS_MARKER}\nA\n`);
    assert.deepEqual([...result.sections.keys()], ['questions']);
    assert.deepEqual([...result.ignoredWarnings], ['questions']);
});

test('both markers parse in either order', () => {
    const forward = extractSections(
        `## questions ${DEBUG_CALLED_DEFINITIONS_MARKER} ${IGNORE_WARNINGS_MARKER}\nA\n`,
    );
    const reverse = extractSections(
        `## questions ${IGNORE_WARNINGS_MARKER} ${DEBUG_CALLED_DEFINITIONS_MARKER}\nA\n`,
    );
    for (const result of [forward, reverse]) {
        assert.deepEqual([...result.sections.keys()], ['questions']);
        assert.deepEqual([...result.ignoredWarnings], ['questions']);
        assert.deepEqual([...result.literalSections], ['questions']);
    }
});

test('literal marker is ignored on definitions', () => {
    const result = extractSections(`## definitions ${DEBUG_CALLED_DEFINITIONS_MARKER}\nA\n`);
    assert.deepEqual([...result.sections.keys()], ['definitions']);
    assert.equal(result.literalSections.size, 0);
});

test('markers are only stripped from the end of the header', () => {
    const result = extractSections(`## questions ${IGNORE_WARNINGS_MARKER} extra\nA\n`);
    assert.deepEqual(
        [...result.sections.keys()],
        [`questions ${IGNORE_WARNINGS_MARKER} extra`],
    );
    assert.equal(result.ignoredWarnings.size, 0);
});
