/** Apply the two category sync directions to the vault. */
import { TFile, type App, type Vault } from 'obsidian';
import { extractFolderCategory, type Question } from '../parser';
import { basename } from '../util/paths';
import { ensureFolder } from './folders';
import { categoriesEqualCI, resolveCategoryCasing } from './manageFolders';

export interface FolderSyncMove {
    from: string;
    to: string;
    file: TFile;
}

export interface SyncPlan {
    moves: FolderSyncMove[];
    errors: string[];
}

export interface CategoryUpdate {
    path: string;
    file: TFile;
    oldCategory: string[];
    newCategory: string[];
}

export interface UpdatePlan {
    updates: CategoryUpdate[];
    errors: string[];
}

export interface FolderSyncResult {
    moved: number;
    errors: string[];
    movedPaths: { from: string; to: string }[];
}

/** Direction 1: notes whose declared category disagrees with their current folder. */
export async function planFolderSync(
    vault: Vault,
    reviewDir: string,
    questions: Map<string, Question>,
): Promise<SyncPlan> {
    const moves: FolderSyncMove[] = [];
    const errors: string[] = [];
    const resolvedCache = new Map<string, string[]>();

    const resolve = async (category: string[]): Promise<string[]> => {
        const key = category.map((s) => s.toLowerCase()).join('/');
        let resolved = resolvedCache.get(key);
        if (!resolved) {
            resolved = await resolveCategoryCasing(vault, reviewDir, category);
            resolvedCache.set(key, resolved);
        }
        return resolved;
    };

    for (const [path, q] of questions) {
        const currentFolder = extractFolderCategory(path, reviewDir);
        if (categoriesEqualCI(currentFolder, q.declaredCategory)) continue;
        const file = vault.getAbstractFileByPath(path);
        if (!file) {
            errors.push(`${path}: no longer in vault`);
            continue;
        }
        if (!(file instanceof TFile)) {
            errors.push(`${path}: not a file`);
            continue;
        }
        const filename = basename(path);
        const targetCategory = await resolve(q.declaredCategory);
        const targetFolder = targetCategory.length
            ? `${reviewDir}/${targetCategory.join('/')}`
            : reviewDir;
        const target = `${targetFolder}/${filename}`;
        moves.push({ from: path, to: target, file });
    }
    return { moves, errors };
}

/** Direction 2: notes whose `rv-category` disagrees with their current folder. */
export async function planCategorySync(
    vault: Vault,
    reviewDir: string,
    questions: Map<string, Question>,
): Promise<UpdatePlan> {
    const updates: CategoryUpdate[] = [];
    const errors: string[] = [];
    for (const [path, q] of questions) {
        const folder = extractFolderCategory(path, reviewDir);
        if (categoriesEqualCI(q.declaredCategory, folder)) continue;
        const file = vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            errors.push(`${path}: no longer in vault`);
            continue;
        }
        updates.push({
            path,
            file,
            oldCategory: q.declaredCategory,
            newCategory: folder,
        });
    }
    return { updates, errors };
}

export async function applyFolderSync(
    vault: Vault,
    plan: SyncPlan,
): Promise<FolderSyncResult> {
    let moved = 0;
    const errors = [...plan.errors];
    const movedPaths: { from: string; to: string }[] = [];
    const taken = new Set<string>();

    for (const move of plan.moves) {
        try {
            const folder = move.to.split('/').slice(0, -1).join('/');
            await ensureFolder(vault, folder);

            let target = move.to;
            const stem = target.slice(0, -3);
            let n = 2;
            while (vault.getAbstractFileByPath(target) || taken.has(target)) {
                target = `${stem}-${n}.md`;
                n++;
            }
            taken.add(target);
            await vault.rename(move.file, target);
            movedPaths.push({ from: move.from, to: target });
            moved++;
        } catch (e) {
            errors.push(`${move.from}: ${(e as Error).message}`);
        }
    }
    return { moved, errors, movedPaths };
}

export async function applyCategorySync(
    app: App,
    plan: UpdatePlan,
): Promise<{ updated: number; errors: string[] }> {
    let updated = 0;
    const errors = [...plan.errors];
    for (const update of plan.updates) {
        const file = app.vault.getAbstractFileByPath(update.path);
        if (!(file instanceof TFile)) {
            errors.push(`${update.path}: no longer in vault`);
            continue;
        }
        try {
            await app.fileManager.processFrontMatter(file, (fm) => {
                const frontmatter = fm as Record<string, unknown>;
                if (update.newCategory.length) {
                    frontmatter['rv-category'] = update.newCategory.join('/');
                } else {
                    delete frontmatter['rv-category'];
                }
            });
            updated++;
        } catch (e) {
            errors.push(`${update.path}: ${(e as Error).message}`);
        }
    }
    return { updated, errors };
}