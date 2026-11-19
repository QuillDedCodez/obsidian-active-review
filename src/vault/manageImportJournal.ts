/** Persisted Manage Questions import journal and undo. */
import { TFile, normalizePath, type App } from 'obsidian';
import { folderOf } from '../util/paths';
import { ensureFolder } from './folders';
import type { ManageQuestionPreset } from './managePresets';
import { writeCategoryFrontMatter } from './managePresets';

export interface ManageImportMove {
    from: string;
    to: string;
    beforeCategory: string[];
    afterCategory: string[];
}

export interface ManageImportJournal {
    createdAt: string;
    moves: ManageImportMove[];
    createdFolders: string[];
    presetsBefore: ManageQuestionPreset[];
    presetsAfter: ManageQuestionPreset[];
    lastCustomBefore: string[];
    lastCustomAfter: string[];
}

export interface UndoManageImportResult {
    restored: number;
    errors: string[];
    foldersLeft: string[];
    blocked: boolean;
}

export interface UndoManageImportOptions {
    app: App;
    journal: ManageImportJournal;
    savePresets: (presets: ManageQuestionPreset[]) => Promise<void>;
    saveLastCustom: (paths: string[]) => Promise<void>;
}

/** Best-effort undo. Preflights every reverse move before changing anything. */
export async function undoManageImport(
    options: UndoManageImportOptions,
): Promise<UndoManageImportResult> {
    const errors: string[] = [];
    const { app, journal } = options;

    for (const move of journal.moves) {
        const target = app.vault.getAbstractFileByPath(move.to);
        if (!(target instanceof TFile)) {
            errors.push(`Cannot undo ${move.to}: file no longer exists.`);
        }
        if (app.vault.getAbstractFileByPath(move.from)) {
            errors.push(`Cannot undo ${move.to}: original path is occupied (${move.from}).`);
        }
    }
    if (errors.length > 0) {
        return {
            restored: 0,
            errors,
            foldersLeft: journal.createdFolders.filter(
                (folder) => app.vault.getAbstractFileByPath(folder) !== null,
            ),
            blocked: true,
        };
    }

    let restored = 0;
    for (const move of [...journal.moves].reverse()) {
        try {
            const file = app.vault.getAbstractFileByPath(move.to);
            if (!(file instanceof TFile)) throw new Error('file no longer exists');
            await ensureFolder(app.vault, folderOf(move.from));
            await app.fileManager.renameFile(file, normalizePath(move.from));
            restored++;
            const updated = await writeCategoryFrontMatter(
                app,
                move.from,
                move.beforeCategory,
            );
            if (!updated) {
                errors.push(`${move.from}: restored, but rv-category could not be updated.`);
            }
        } catch (e) {
            errors.push(`${move.to}: ${(e as Error).message}`);
        }
    }

    if (errors.length === 0) {
        try {
            await options.savePresets(
                journal.presetsBefore.map((preset) => ({
                    ...preset,
                    includedPaths: [...preset.includedPaths],
                })),
            );
            await options.saveLastCustom([...journal.lastCustomBefore]);
        } catch (e) {
            errors.push(`Could not restore preset metadata: ${(e as Error).message}`);
        }
    }

    return {
        restored,
        errors,
        foldersLeft: journal.createdFolders.filter(
            (folder) => app.vault.getAbstractFileByPath(folder) !== null,
        ),
        blocked: false,
    };
}
