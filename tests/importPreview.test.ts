import { test, assert } from './harness';
import {
    buildImportPreview,
    buildManagePresetManifest,
    parseManagePresetManifest,
    recountImportPreview,
    resolveImportRow,
    type ManagePresetManifest,
} from '../src/vault/manageImportExport';
import type { Question } from '../src/parser/types';
import type { ManageQuestionPreset } from '../src/vault/managePresets';

const reviewDir = 'review';
const sessionsSubdir = 'review/sessions';

const preset: ManageQuestionPreset = {
    id: 'p1',
    name: 'Bio',
    includedPaths: ['review/Bio/cell.md'],
    showOnStart: true,
};

const questions = [{ path: 'review/Bio/cell.md' } as unknown as Question];

function buildManifest(): ManagePresetManifest {
    return buildManagePresetManifest({
        presets: [preset],
        folders: ['review/Bio', 'review/Chem'],
        reviewDir,
        includeEmptyFolders: true,
    }).manifest;
}

function preview(manifest: ManagePresetManifest, fileExists: (p: string) => boolean = () => false) {
    return buildImportPreview(manifest, {
        questions,
        reviewDir,
        sessionsSubdir,
        existingPresets: [],
        fileExists,
    });
}

test('manifest round-trips through export and parse', () => {
    const manifest = buildManifest();
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0]!.sourcePath, 'Bio/cell.md');
    const parsed = parseManagePresetManifest(JSON.stringify(manifest));
    assert.equal(parsed.errors.length, 0);
    assert.ok(parsed.manifest);
    assert.equal(parsed.manifest.presets[0]!.name, 'Bio');
});

test('parser rejects a malformed manifest', () => {
    const parsed = parseManagePresetManifest('{"format":"wrong","version":1}');
    assert.equal(parsed.manifest, null);
    assert.ok(parsed.errors.length > 0);
});

test('a file already at its target is a noop and resolves', () => {
    const result = preview(buildManifest());
    assert.equal(result.rows[0]!.status, 'noop');
    assert.equal(result.counts.noop, 1);
    assert.equal(result.presets[0]!.resolved, 1);
    assert.equal(result.presets[0]!.unresolved, 0);
});

test('a file with a new target folder becomes a move', () => {
    const manifest = buildManifest();
    manifest.files[0]!.targetFolder = 'Chem';
    const result = preview(manifest);
    assert.equal(result.rows[0]!.status, 'move');
    assert.equal(result.rows[0]!.targetPath, 'Chem/cell.md');
    assert.equal(result.counts.move, 1);
    assert.equal(result.presets[0]!.resolved, 1);
});

test('an existing target is a conflict and does not resolve', () => {
    const manifest = buildManifest();
    manifest.files[0]!.targetFolder = 'Chem';
    const result = preview(manifest, (path) => path === 'review/Chem/cell.md');
    assert.equal(result.rows[0]!.status, 'conflict');
    assert.equal(result.counts.conflict, 1);
    assert.equal(result.presets[0]!.resolved, 0);
});

test('resolveImportRow switches between noop, move and conflict', () => {
    const manifest = buildManifest();
    manifest.files[0]!.targetFolder = 'Chem';
    const result = preview(manifest);
    const row = result.rows[0]!;

    resolveImportRow(row, 'Chem/cell.md', reviewDir, () => false);
    assert.equal(row.status, 'noop');
    assert.equal(row.matchedSourcePath, 'Chem/cell.md');

    resolveImportRow(row, 'Bio/cell.md', reviewDir, () => false);
    assert.equal(row.status, 'move');
    assert.equal(row.matchedSourcePath, 'Bio/cell.md');

    resolveImportRow(row, 'Bio/cell.md', reviewDir, () => true);
    assert.equal(row.status, 'conflict');
});

test('recountImportPreview recomputes counts and resolution', () => {
    const result = preview(buildManifest());
    result.rows[0]!.status = 'missing';
    recountImportPreview(result);
    assert.equal(result.counts.missing, 1);
    assert.equal(result.counts.noop, 0);
    assert.equal(result.presets[0]!.resolved, 0);
    assert.equal(result.presets[0]!.unresolved, 1);
});

test('existing preset names are flagged', () => {
    const result = buildImportPreview(buildManifest(), {
        questions,
        reviewDir,
        sessionsSubdir,
        existingPresets: [preset],
        fileExists: () => false,
    });
    assert.equal(result.presets[0]!.nameExists, true);
});
