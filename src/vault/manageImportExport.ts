/** Manage Questions preset export/import manifest and dry-run matching. */
import type { Question } from '../parser';
import { basename as baseOf, folderOf, relativeToReview, trimSlashes } from '../util/paths';
import type { ManageQuestionPreset } from './managePresets';

export const MANIFEST_FORMAT = 'active-review/manage-presets';
export const MANIFEST_VERSION = 1;
export const MANIFEST_MAX_BYTES = 5 * 1024 * 1024;
export const MANIFEST_MAX_FILES = 10000;
export const MANIFEST_MAX_PRESETS = 500;

export interface ManifestFolder {
    sourcePath: string;
    targetPath: string;
}

export interface ManifestFile {
    sourcePath: string;
    targetFolder: string;
    targetName?: string;
}

export interface ManifestPreset {
    name: string;
    files: string[];
    /** Whether this preset appears on the start screen. Defaults to true. */
    showOnStart?: boolean;
}

export interface ManagePresetManifest {
    format: string;
    version: number;
    exportedAt: string;
    source: {
        reviewRoot: string;
        pathMode: 'relative';
    };
    folders: ManifestFolder[];
    files: ManifestFile[];
    presets: ManifestPreset[];
}

export interface ManifestParseResult {
    manifest: ManagePresetManifest | null;
    errors: string[];
    warnings: string[];
}

export type ImportRowStatus =
    | 'move'
    | 'noop'
    | 'missing'
    | 'ambiguous'
    | 'conflict'
    | 'invalid';

export interface ImportPreviewRow {
    sourcePath: string;
    targetPath: string;
    status: ImportRowStatus;
    message: string;
    candidates: string[];
    /** Actual local question path chosen by the matcher or user. */
    matchedSourcePath?: string;
    /** True when the row originally needed a manual source selection. */
    manualMatch?: boolean;
    collisionPolicy: 'skip' | 'suffix';
}

export interface ImportPresetPreview {
    name: string;
    files: number;
    filePaths: string[];
    resolved: number;
    unresolved: number;
    nameExists: boolean;
}

export interface ImportPreview {
    rows: ImportPreviewRow[];
    presets: ImportPresetPreview[];
    targetFolders: string[];
    warnings: string[];
    errors: string[];
    counts: Record<ImportRowStatus, number>;
}

export interface ExportManifestOptions {
    presets: ManageQuestionPreset[];
    folders: string[];
    reviewDir: string;
    includeEmptyFolders: boolean;
}

export interface ExportManifestResult {
    manifest: ManagePresetManifest;
    warnings: string[];
}

export interface ImportPreviewOptions {
    questions: Question[];
    reviewDir: string;
    sessionsSubdir: string;
    existingPresets: ManageQuestionPreset[];
    fileExists: (path: string) => boolean;
}

function slash(value: string): string {
    return value.replace(/\\/g, '/');
}

/** Read a string field, rejecting structured values instead of stringifying them. */
function readString(value: unknown, field: string): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    throw new Error(`${field} must be a string`);
}

/** Human-readable rendering for validation errors. */
function describeValue(value: unknown): string {
    if (value === undefined) return '(missing)';
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return String(value);
    }
    try {
        return JSON.stringify(value) ?? '(invalid)';
    } catch {
        return '(invalid)';
    }
}

function normalizeRel(value: string, allowEmpty: boolean): string {
    const raw = slash(value).trim();
    if (!raw) {
        if (allowEmpty) return '';
        throw new Error('path is empty');
    }
    if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) {
        throw new Error('path must be relative');
    }
    const parts = raw.split('/').filter((p) => p !== '');
    if (parts.some((p) => p === '.' || p === '..')) {
        throw new Error('path must not contain "." or ".."');
    }
    return parts.join('/');
}

function normalizeFile(value: string): string {
    const path = normalizeRel(value, false);
    if (!/\.md$/i.test(path)) throw new Error('file path must end in .md');
    return path;
}

function normalizeFolder(value: string): string {
    return normalizeRel(value, true);
}

function normalizeTargetName(value: string): string {
    const name = slash(value).trim();
    if (!name || name.includes('/') || name.includes('\0')) {
        throw new Error('targetName must be a file name');
    }
    if (!/\.md$/i.test(name)) throw new Error('targetName must end in .md');
    return name;
}

function uniqueFolders(files: ManifestFile[], allFolders: string[]): ManifestFolder[] {
    const set = new Set<string>();
    for (const file of files) {
        const folder = folderOf(file.sourcePath);
        const parts = folder ? folder.split('/') : [];
        for (let i = 1; i <= parts.length; i++) {
            set.add(parts.slice(0, i).join('/'));
        }
    }
    for (const folder of allFolders) {
        try {
            const normalized = normalizeFolder(folder);
            if (normalized) set.add(normalized);
        } catch {
            // ignore malformed folder entries in the export; paths are validated
        }
    }
    return [...set].sort().map((path) => ({ sourcePath: path, targetPath: path }));
}

/** Build a structure-only manifest from selected Manage Questions presets. */
export function buildManagePresetManifest(
    options: ExportManifestOptions,
): ExportManifestResult {
    const warnings: string[] = [];
    const files = new Map<string, ManifestFile>();
    const presets: ManifestPreset[] = [];

    for (const preset of options.presets) {
        const presetFiles: string[] = [];
        for (const absolute of preset.includedPaths) {
            const relative = relativeToReview(absolute, options.reviewDir);
            if (relative === null) {
                warnings.push(`${preset.name}: path is outside the review folder: ${absolute}`);
                continue;
            }
            if (!/\.md$/i.test(relative)) {
                warnings.push(`${preset.name}: ignored non-Markdown path: ${absolute}`);
                continue;
            }
            let sourcePath: string;
            try {
                sourcePath = normalizeFile(relative);
            } catch (e) {
                warnings.push(`${preset.name}: ${(e as Error).message} (${absolute})`);
                continue;
            }
            presetFiles.push(sourcePath);
            if (!files.has(sourcePath.toLowerCase())) {
                files.set(sourcePath.toLowerCase(), {
                    sourcePath,
                    targetFolder: folderOf(sourcePath),
                    targetName: baseOf(sourcePath),
                });
            }
        }
        presets.push({ name: preset.name, files: [...new Set(presetFiles)], showOnStart: preset.showOnStart ?? true });
    }

    const includeFolders = options.includeEmptyFolders ? options.folders : [];
    return {
        manifest: {
            format: MANIFEST_FORMAT,
            version: MANIFEST_VERSION,
            exportedAt: new Date().toISOString(),
            source: {
                reviewRoot: options.reviewDir,
                pathMode: 'relative',
            },
            folders: uniqueFolders([...files.values()], includeFolders),
            files: [...files.values()].sort((a, b) =>
                a.sourcePath.localeCompare(b.sourcePath),
            ),
            presets,
        },
        warnings,
    };
}

/** Parse and validate a manifest. Unknown fields are ignored. */
export function parseManagePresetManifest(text: string): ManifestParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (text.length > MANIFEST_MAX_BYTES) {
        return {
            manifest: null,
            errors: [`Manifest is larger than ${MANIFEST_MAX_BYTES} bytes.`],
            warnings,
        };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        return {
            manifest: null,
            errors: [`Invalid JSON: ${(e as Error).message}`],
            warnings,
        };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { manifest: null, errors: ['Manifest must be a JSON object.'], warnings };
    }
    const obj = raw as Record<string, unknown>;
    if (obj.format !== MANIFEST_FORMAT) {
        errors.push(`Unsupported format: ${describeValue(obj.format)}`);
    }
    if (obj.version !== MANIFEST_VERSION) {
        errors.push(`Unsupported version: ${describeValue(obj.version)}`);
    }
    const sourceRaw = obj.source;
    const source =
        sourceRaw && typeof sourceRaw === 'object' && !Array.isArray(sourceRaw)
            ? (sourceRaw as Record<string, unknown>)
            : {};
    const reviewRoot =
        typeof source.reviewRoot === 'string' ? source.reviewRoot : '';
    if (!reviewRoot) warnings.push('source.reviewRoot is missing; using the current vault root label.');

    const folders: ManifestFolder[] = [];
    if (Array.isArray(obj.folders)) {
        for (const value of obj.folders) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                errors.push('folders[] contains a non-object entry.');
                continue;
            }
            const item = value as Record<string, unknown>;
            try {
                folders.push({
                    sourcePath: normalizeFolder(
                        readString(item.sourcePath, 'sourcePath'),
                    ),
                    targetPath: normalizeFolder(
                        readString(item.targetPath, 'targetPath'),
                    ),
                });
            } catch (e) {
                errors.push(`folders: ${(e as Error).message}`);
            }
        }
    } else if (obj.folders !== undefined) {
        errors.push('folders must be an array.');
    }

    const files: ManifestFile[] = [];
    const seenFiles = new Set<string>();
    if (Array.isArray(obj.files)) {
        if (obj.files.length > MANIFEST_MAX_FILES) {
            errors.push(`files exceeds the ${MANIFEST_MAX_FILES} entry limit.`);
        }
        for (const value of obj.files) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                errors.push('files[] contains a non-object entry.');
                continue;
            }
            const item = value as Record<string, unknown>;
            try {
                const sourcePath = normalizeFile(
                    readString(item.sourcePath, 'sourcePath'),
                );
                const targetFolder = normalizeFolder(
                    readString(item.targetFolder, 'targetFolder'),
                );
                const targetName =
                    item.targetName === undefined
                        ? undefined
                        : normalizeTargetName(
                              readString(item.targetName, 'targetName'),
                          );
                const key = sourcePath.toLowerCase();
                if (seenFiles.has(key)) {
                    errors.push(`duplicate file sourcePath: ${sourcePath}`);
                    continue;
                }
                seenFiles.add(key);
                files.push({ sourcePath, targetFolder, targetName });
            } catch (e) {
                errors.push(`files: ${(e as Error).message}`);
            }
        }
    } else if (obj.files !== undefined) {
        errors.push('files must be an array.');
    }

    const presets: ManifestPreset[] = [];
    const seenPresets = new Set<string>();
    if (Array.isArray(obj.presets)) {
        if (obj.presets.length > MANIFEST_MAX_PRESETS) {
            errors.push(`presets exceeds the ${MANIFEST_MAX_PRESETS} entry limit.`);
        }
        for (const value of obj.presets) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                errors.push('presets[] contains a non-object entry.');
                continue;
            }
            const item = value as Record<string, unknown>;
            if (typeof item.name !== 'string') {
                errors.push('presets[] contains a non-string name.');
                continue;
            }
            const name = item.name.trim();
            if (!name) {
                errors.push('presets[] contains an empty name.');
                continue;
            }
            const key = name.toLowerCase();
            if (seenPresets.has(key)) {
                errors.push(`duplicate preset name: ${name}`);
                continue;
            }
            seenPresets.add(key);
            const presetFiles: string[] = [];
            if (Array.isArray(item.files)) {
                for (const file of item.files) {
                    try {
                        presetFiles.push(
                            normalizeFile(readString(file, 'preset file')),
                        );
                    } catch (e) {
                        errors.push(`presets: ${(e as Error).message}`);
                    }
                }
            } else {
                errors.push(`presets[${name}].files must be an array.`);
            }
            let showOnStart = true;
            if (item.showOnStart !== undefined) {
                if (typeof item.showOnStart !== 'boolean') {
                    errors.push(`presets[${name}].showOnStart must be a boolean.`);
                    showOnStart = true;
                } else {
                    showOnStart = item.showOnStart;
                }
            }
            presets.push({ name, files: [...new Set(presetFiles)], showOnStart });
        }
    } else if (obj.presets !== undefined) {
        errors.push('presets must be an array.');
    }

    if (files.length === 0 && presets.length === 0) {
        errors.push('Manifest has no files or presets.');
    }
    if (errors.length > 0) {
        return { manifest: null, errors, warnings };
    }
    return {
        manifest: {
            format: MANIFEST_FORMAT,
            version: MANIFEST_VERSION,
            exportedAt:
                typeof obj.exportedAt === 'string'
                    ? obj.exportedAt
                    : new Date().toISOString(),
            source: {
                reviewRoot,
                pathMode: 'relative',
            },
            folders,
            files,
            presets,
        },
        errors,
        warnings,
    };
}

function commonSuffixLength(a: string[], b: string[]): number {
    let n = 0;
    while (
        n < a.length &&
        n < b.length &&
        a[a.length - 1 - n]!.toLowerCase() === b[b.length - 1 - n]!.toLowerCase()
    ) {
        n++;
    }
    return n;
}

function targetPathFor(file: ManifestFile, sourcePath: string): string {
    const folder = file.targetFolder;
    const name = file.targetName ?? baseOf(sourcePath);
    return folder ? `${folder}/${name}` : name;
}

function absoluteTarget(reviewDir: string, relative: string): string {
    const root = reviewDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return root ? `${root}/${relative}` : relative;
}

/** Resolve an ambiguous/missing row to a manually chosen local question. */
export function resolveImportRow(
    row: ImportPreviewRow,
    candidateRel: string,
    reviewDir: string,
    fileExists: (path: string) => boolean,
): void {
    const sourceRel = normalizeFile(candidateRel);
    const targetRel = normalizeRel(row.targetPath, false);
    row.matchedSourcePath = sourceRel;
    row.collisionPolicy = 'skip';
    if (sourceRel.toLowerCase() === targetRel.toLowerCase()) {
        row.status = 'noop';
        row.message = 'Already at the target path.';
    } else if (fileExists(absoluteTarget(reviewDir, targetRel))) {
        row.status = 'conflict';
        row.message = 'Target path already exists.';
    } else {
        row.status = 'move';
        row.message = `Move from ${candidateRel}`;
    }
}

/** Recompute counts and preset resolution after manual row edits. */
export function recountImportPreview(preview: ImportPreview): void {
    const counts: Record<ImportRowStatus, number> = {
        move: 0,
        noop: 0,
        missing: 0,
        ambiguous: 0,
        conflict: 0,
        invalid: 0,
    };
    // Index rows once: presets can reference thousands of files, so the old
    // rows.find() per file made recounting quadratic on large imports.
    const rowBySource = new Map<string, ImportPreviewRow>();
    for (const row of preview.rows) {
        counts[row.status]++;
        rowBySource.set(row.sourcePath.toLowerCase(), row);
    }
    preview.counts = counts;

    for (const preset of preview.presets) {
        const resolved = preset.filePaths.filter((file) => {
            const row = rowBySource.get(file.toLowerCase());
            return (
                row &&
                (row.status === 'move' ||
                    row.status === 'noop' ||
                    (row.status === 'conflict' && row.collisionPolicy === 'suffix'))
            );
        }).length;
        preset.resolved = resolved;
        preset.unresolved = preset.files - resolved;
    }
}

/** Build a dry-run preview. This function performs no writes. */
export function buildImportPreview(
    manifest: ManagePresetManifest,
    options: ImportPreviewOptions,
): ImportPreview {
    const warnings: string[] = [];
    const errors: string[] = [];
    const root = trimSlashes(options.reviewDir);
    const sessions = trimSlashes(options.sessionsSubdir);
    const questionByPath = new Map<string, Question>();
    const questionByBase = new Map<string, Question[]>();
    for (const q of options.questions) {
        const rel = relativeToReview(q.path, options.reviewDir);
        if (!rel) continue;
        questionByPath.set(rel.toLowerCase(), q);
        const base = baseOf(rel).toLowerCase();
        const list = questionByBase.get(base) ?? [];
        list.push(q);
        questionByBase.set(base, list);
    }

    const rows: ImportPreviewRow[] = [];
    const rowBySource = new Map<string, ImportPreviewRow>();
    const targetFolderSet = new Set<string>();
    const targetSeen = new Map<string, string>();
    for (const folder of manifest.folders) {
        try {
            const target = normalizeFolder(folder.targetPath);
            if (!target) continue;
            if (sessions && (target === sessions || target.startsWith(`${sessions}/`))) {
                warnings.push(
                    `Folder target skipped because it is inside the sessions folder: ${target}`,
                );
                continue;
            }
            targetFolderSet.add(target);
        } catch (e) {
            warnings.push(`Folder target skipped: ${(e as Error).message}`);
        }
    }
    for (const file of manifest.files) {
        const targetPath = targetPathFor(file, file.sourcePath);
        let status: ImportRowStatus = 'move';
        let message = '';
        let candidates: string[] = [];
        let matchedSourcePath: string | undefined;
        try {
            const targetRel = normalizeRel(targetPath, false);
            if (sessions && (targetRel === sessions || targetRel.startsWith(`${sessions}/`))) {
                status = 'invalid';
                message = 'Target is inside the sessions folder.';
            }
            const targetAbs = root ? `${root}/${targetRel}` : targetRel;
            const previousSource = targetSeen.get(targetRel.toLowerCase());
            if (previousSource && previousSource !== file.sourcePath) {
                status = 'conflict';
                message = `Another manifest file targets the same path: ${previousSource}`;
            } else {
                targetSeen.set(targetRel.toLowerCase(), file.sourcePath);
            }
            const sourceRel = normalizeFile(file.sourcePath);
            const exact = questionByPath.get(sourceRel.toLowerCase());
            let matched: Question | undefined = exact;
            if (!matched) {
                const base = baseOf(sourceRel).toLowerCase();
                const list = questionByBase.get(base) ?? [];
                if (list.length === 1) {
                    matched = list[0];
                } else if (list.length > 1) {
                    const sourceFolder = folderOf(sourceRel).split('/').filter(Boolean);
                    const scored = list
                        .map((q) => {
                            const rel = relativeToReview(q.path, options.reviewDir) ?? '';
                            return {
                                q,
                                rel,
                                score: commonSuffixLength(
                                    sourceFolder,
                                    folderOf(rel).split('/').filter(Boolean),
                                ),
                            };
                        })
                        .sort((a, b) => b.score - a.score);
                    const best = scored.filter((c) => c.score === scored[0]!.score);
                    if (scored[0]!.score > 0 && best.length === 1) {
                        matched = best[0]!.q;
                    } else {
                        candidates = list
                            .map((q) => relativeToReview(q.path, options.reviewDir) ?? q.path)
                            .sort();
                    }
                }
            }

            if (status !== 'invalid' && status !== 'conflict') {
                if (!matched && candidates.length > 0) {
                    status = 'ambiguous';
                    message = `${candidates.length} local filename matches; choose one.`;
                } else if (!matched) {
                    status = 'missing';
                    message = 'No matching question note found.';
                } else {
                    matchedSourcePath =
                        relativeToReview(matched.path, options.reviewDir) ?? '';
                    const matchedRel = matchedSourcePath;
                    if (matchedRel.toLowerCase() === targetRel.toLowerCase()) {
                        status = 'noop';
                        message = 'Already at the target path.';
                    } else if (options.fileExists(targetAbs)) {
                        status = 'conflict';
                        message = 'Target path already exists.';
                    } else {
                        status = 'move';
                        message = `Move from ${matchedRel}`;
                    }
                }
            } else if (matched) {
                matchedSourcePath =
                    relativeToReview(matched.path, options.reviewDir) ?? '';
            }
            if (status !== 'invalid') targetFolderSet.add(folderOf(targetRel));
            const row: ImportPreviewRow = {
                sourcePath: sourceRel,
                targetPath: targetRel,
                status,
                message,
                candidates,
                matchedSourcePath,
                manualMatch: status === 'ambiguous' || status === 'missing',
                collisionPolicy: 'skip',
            };
            rows.push(row);
            rowBySource.set(row.sourcePath.toLowerCase(), row);
        } catch (e) {
            const row: ImportPreviewRow = {
                sourcePath: file.sourcePath,
                targetPath,
                status: 'invalid',
                message: (e as Error).message,
                candidates: [],
                manualMatch: false,
                collisionPolicy: 'skip',
            };
            rows.push(row);
            rowBySource.set(row.sourcePath.toLowerCase(), row);
        }
    }

    const existingPresetNames = new Set(
        options.existingPresets.map((p) => p.name.toLowerCase()),
    );
    const previewPresets: ImportPresetPreview[] = manifest.presets.map((preset) => {
        const resolved = preset.files.filter((file) => {
            const row = rowBySource.get(file.toLowerCase());
            return row && (row.status === 'move' || row.status === 'noop');
        }).length;
        return {
            name: preset.name,
            files: preset.files.length,
            filePaths: [...preset.files],
            resolved,
            unresolved: preset.files.length - resolved,
            nameExists: existingPresetNames.has(preset.name.toLowerCase()),
        };
    });

    if (rows.some((r) => r.status === 'move' || r.status === 'conflict')) {
        warnings.push(
            'Session history is not updated by this preview. Moving questions may make old session frozen paths stale.',
        );
    }
    if (manifest.files.length !== rows.length) {
        warnings.push('Some manifest files could not be represented in the preview.');
    }

    const counts: Record<ImportRowStatus, number> = {
        move: 0,
        noop: 0,
        missing: 0,
        ambiguous: 0,
        conflict: 0,
        invalid: 0,
    };
    for (const row of rows) counts[row.status]++;

    return {
        rows,
        presets: previewPresets,
        targetFolders: [...targetFolderSet].filter(Boolean).sort(),
        warnings,
        errors,
        counts,
    };
}
