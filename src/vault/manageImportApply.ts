/** Apply a validated Manage Questions import after preview. */
import { TFile, normalizePath, type App } from 'obsidian';
import { folderOf, joinPath, uniqueFileName } from '../util/paths';
import { ensureFolder } from './folders';
import type { ManageQuestionPreset } from './managePresets';
import { writeCategoryFrontMatter } from './managePresets';
import type {
    ImportPreview,
    ImportPreviewRow,
    ManagePresetManifest,
} from './manageImportExport';

export type ImportApplyMode = 'add' | 'update' | 'structure';

export interface ApplyManageImportOptions {
    app: App;
    reviewDir: string;
    manifest: ManagePresetManifest;
    preview: ImportPreview;
    mode: ImportApplyMode;
    generateId: () => string;
    remapPaths: (map: Map<string, string>) => Promise<void>;
    getPresets: () => ManageQuestionPreset[];
    savePresets: (presets: ManageQuestionPreset[]) => Promise<void>;
}

export interface ApplyManageImportResult {
    moved: number;
    skipped: number;
    foldersCreated: number;
    createdFolders: string[];
    presetsAdded: number;
    presetsUpdated: number;
    errors: string[];
    pathMap: Map<string, string>;
    moves: { from: string; to: string }[];
    presets: ManageQuestionPreset[];
}

function uniqueName(base: string, presets: ManageQuestionPreset[]): string {
    const existing = new Set(presets.map((p) => p.name.toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    let n = 2;
    while (existing.has(`${base} (${n})`.toLowerCase())) n++;
    return `${base} (${n})`;
}

function absolute(reviewDir: string, relative: string): string {
    return normalizePath(joinPath(reviewDir, relative));
}

function uniqueTarget(
    vault: { getAbstractFileByPath(path: string): unknown },
    target: string,
): string {
    return uniqueFileName(target, (candidate) => !!vault.getAbstractFileByPath(candidate));
}

/** Apply only move/no-op rows; conflicts/missing/ambiguous stay untouched. */
export async function applyManageImport(
    options: ApplyManageImportOptions,
): Promise<ApplyManageImportResult> {
    const errors: string[] = [];
    const pathMap = new Map<string, string>();
    const moves: { from: string; to: string }[] = [];
    const createdFolders: string[] = [];
    const actualTargets = new Map<string, string>();
    let moved = 0;
    let skipped = 0;

    for (const folder of options.preview.targetFolders) {
        if (!folder) continue;
        const abs = absolute(options.reviewDir, folder);
        if (!options.app.vault.getAbstractFileByPath(abs)) {
            try {
                await ensureFolder(options.app.vault, abs);
                createdFolders.push(abs);
            } catch (e) {
                errors.push(`Folder ${folder}: ${(e as Error).message}`);
            }
        }
    }

    const rowBySource = new Map<string, ImportPreviewRow>();
    for (const row of options.preview.rows) {
        rowBySource.set(row.sourcePath.toLowerCase(), row);
        const sourceRel = row.matchedSourcePath ?? row.sourcePath;
        const sourceAbs = absolute(options.reviewDir, sourceRel);
        if (row.status === 'noop') {
            actualTargets.set(row.sourcePath.toLowerCase(), sourceAbs);
            continue;
        }
        const suffixConflict =
            row.status === 'conflict' && row.collisionPolicy === 'suffix';
        if (row.status !== 'move' && !suffixConflict) {
            skipped++;
            continue;
        }
        const file = options.app.vault.getAbstractFileByPath(sourceAbs);
        if (!(file instanceof TFile)) {
            errors.push(`${sourceRel}: source file is missing.`);
            skipped++;
            continue;
        }
        let targetAbs = absolute(options.reviewDir, row.targetPath);
        if (options.app.vault.getAbstractFileByPath(targetAbs)) {
            if (suffixConflict) {
                targetAbs = uniqueTarget(options.app.vault, targetAbs);
            } else {
                errors.push(`${sourceRel}: target already exists (${row.targetPath}).`);
                skipped++;
                continue;
            }
        }
        try {
            await ensureFolder(options.app.vault, folderOf(targetAbs));
            await options.app.fileManager.renameFile(file, targetAbs);
            const category = folderOf(row.targetPath).split('/').filter(Boolean);
            const updated = await writeCategoryFrontMatter(options.app, targetAbs, category);
            if (!updated) {
                errors.push(`${row.targetPath}: moved, but rv-category could not be updated.`);
            }
            pathMap.set(sourceAbs, targetAbs);
            actualTargets.set(row.sourcePath.toLowerCase(), targetAbs);
            moves.push({ from: sourceAbs, to: targetAbs });
            moved++;
        } catch (e) {
            errors.push(`${sourceRel}: ${(e as Error).message}`);
            skipped++;
        }
    }

    try {
        await options.remapPaths(pathMap);
    } catch (e) {
        errors.push(`Could not remap existing presets: ${(e as Error).message}`);
    }
    const presets = options.getPresets().map((p) => ({
        ...p,
        includedPaths: [...p.includedPaths],
    }));

    let presetsAdded = 0;
    let presetsUpdated = 0;
    if (options.mode !== 'structure') {
        for (const manifestPreset of options.manifest.presets) {
            const resolved: string[] = [];
            const seen = new Set<string>();
            for (const source of manifestPreset.files) {
                const row = rowBySource.get(source.toLowerCase());
                if (!row) continue;
                const target =
                    row.status === 'noop'
                        ? absolute(
                              options.reviewDir,
                              row.matchedSourcePath ?? row.sourcePath,
                          )
                        : actualTargets.get(row.sourcePath.toLowerCase()) ?? null;
                if (!target) continue;
                if (seen.has(target)) continue;
                seen.add(target);
                resolved.push(target);
            }
            if (resolved.length === 0) {
                errors.push(`Preset "${manifestPreset.name}": no resolved files; not imported.`);
                continue;
            }
            const existing = presets.find(
                (p) => p.name.toLowerCase() === manifestPreset.name.toLowerCase(),
            );
            if (existing && options.mode === 'update') {
                existing.includedPaths = resolved;
                if (manifestPreset.showOnStart !== undefined) {
                    existing.showOnStart = manifestPreset.showOnStart;
                }
                presetsUpdated++;
            } else {
                const name = existing
                    ? uniqueName(manifestPreset.name, presets)
                    : manifestPreset.name;
                presets.push({
                    id: options.generateId(),
                    name,
                    includedPaths: resolved,
                    showOnStart: manifestPreset.showOnStart ?? true,
                });
                presetsAdded++;
            }
        }
    }
    if (presetsAdded > 0 || presetsUpdated > 0) {
        try {
            await options.savePresets(presets);
        } catch (e) {
            errors.push(`Could not save imported presets: ${(e as Error).message}`);
        }
    }

    // Keep the result useful for diagnostics even though moves already happened.
    return {
        moved,
        skipped,
        foldersCreated: createdFolders.length,
        createdFolders,
        presetsAdded,
        presetsUpdated,
        errors,
        pathMap,
        moves,
        presets,
    };
}
