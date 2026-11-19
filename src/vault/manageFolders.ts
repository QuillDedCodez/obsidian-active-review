/** File and folder operations for the folder-based Manage Questions tree. */
import { TFile, TFolder, type App, type Vault } from 'obsidian';
import { basename } from '../util/paths';
import { arraysEqualCI } from '../util/text';
import { ensureFolder } from './folders';

export interface FileMove {
    from: string;
    to: string;
}

export interface MoveCategoryResult {
    newPath: string;
    frontmatterUpdated: boolean;
}

export interface DeleteFolderResult {
    removedPrefix: string;
    moved: FileMove[];
    errors: string[];
}

/** Category paths compare case-insensitively. */
export function categoriesEqualCI(a: string[], b: string[]): boolean {
    return arraysEqualCI(a, b);
}

/**
 * Resolve a category path to the casing of existing folders where possible.
 * Missing trailing segments keep the requested casing.
 */
export async function resolveCategoryCasing(
    vault: Vault,
    reviewDir: string,
    category: string[],
): Promise<string[]> {
    let current = reviewDir.replace(/\/+$/g, '');
    const out: string[] = [];
    let missing = false;

    for (const segment of category) {
        if (missing) {
            out.push(segment);
            current = `${current}/${segment}`;
            continue;
        }

        let folders: string[] = [];
        try {
            const listing = await vault.adapter.list(current);
            folders = listing.folders;
        } catch {
            folders = [];
        }

        const match = folders.find(
            (folder) => basename(folder).toLowerCase() === segment.toLowerCase(),
        );
        if (match) {
            const name = basename(match);
            out.push(name);
            current = `${current}/${name}`;
        } else {
            out.push(segment);
            current = `${current}/${segment}`;
            missing = true;
        }
    }

    return out;
}

async function moveFileToFolder(app: App, from: string, targetFolder: string): Promise<string> {
    const file = app.vault.getAbstractFileByPath(from);
    if (!(file instanceof TFile)) throw new Error('not a file');
    await ensureFolder(app.vault, targetFolder);

    const base = basename(from);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let target = `${targetFolder}/${base}`;
    let n = 2;
    while (app.vault.getAbstractFileByPath(target)) {
        target = `${targetFolder}/${stem}-${n}${ext}`;
        n++;
    }
    await app.vault.rename(file, target);
    return target;
}

async function listFilesRecursive(app: App, folder: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (path: string): Promise<void> => {
        const listing = await app.vault.adapter.list(path);
        out.push(...listing.files);
        for (const child of listing.folders) await walk(child);
    };
    await walk(folder);
    return out;
}

/** Move one question file to a category folder and keep rv-category aligned. */
export async function moveFileToCategory(
    app: App,
    reviewDir: string,
    oldPath: string,
    category: string[],
): Promise<MoveCategoryResult> {
    const currentFolder = oldPath.split('/').slice(0, -1).join('/');
    const resolved = await resolveCategoryCasing(app.vault, reviewDir, category);
    const targetFolder = resolved.length ? `${reviewDir}/${resolved.join('/')}` : reviewDir;
    if (currentFolder.toLowerCase() === targetFolder.toLowerCase()) {
        return { newPath: oldPath, frontmatterUpdated: true };
    }
    await ensureFolder(app.vault, targetFolder);
    const newPath = await moveFileToFolder(app, oldPath, targetFolder);

    let frontmatterUpdated = true;
    try {
        const file = app.vault.getAbstractFileByPath(newPath);
        if (!(file instanceof TFile)) throw new Error('moved file missing');
        await app.fileManager.processFrontMatter(file, (fm) => {
            const frontmatter = fm as Record<string, unknown>;
            if (resolved.length) frontmatter['rv-category'] = resolved.join('/');
            else delete frontmatter['rv-category'];
        });
    } catch {
        frontmatterUpdated = false;
    }

    return { newPath, frontmatterUpdated };
}

/** Merge src into an existing destination folder, suffixing file collisions. */
async function mergeFolder(
    app: App,
    src: string,
    dest: string,
    errors: string[],
): Promise<FileMove[]> {
    const moved: FileMove[] = [];
    await ensureFolder(app.vault, dest);
    const listing = await app.vault.adapter.list(src);

    for (const file of listing.files) {
        try {
            const to = await moveFileToFolder(app, file, dest);
            moved.push({ from: file, to });
        } catch (e) {
            errors.push(`${file}: ${(e as Error).message}`);
        }
    }

    for (const child of listing.folders) {
        const target = `${dest}/${basename(child)}`;
        const existing = app.vault.getAbstractFileByPath(target);
        if (!existing) {
            try {
                const files = await listFilesRecursive(app, child);
                const folder = app.vault.getAbstractFileByPath(child);
                if (!(folder instanceof TFolder)) throw new Error('not a folder');
                await app.vault.rename(folder, target);
                for (const old of files) {
                    moved.push({ from: old, to: `${target}/${old.slice(child.length + 1)}` });
                }
            } catch (e) {
                errors.push(`${child}: ${(e as Error).message}`);
            }
        } else if (existing instanceof TFolder) {
            moved.push(...(await mergeFolder(app, child, target, errors)));
        } else {
            errors.push(`${child}: destination exists as a file`);
        }
    }

    try {
        await app.vault.adapter.rmdir(src, false);
    } catch (e) {
        errors.push(`${src}: ${(e as Error).message}`);
    }

    return moved;
}

/** Recursively delete a category folder by lifting its contents one level. */
export async function deleteCategoryFolder(
    app: App,
    reviewDir: string,
    category: string[],
): Promise<DeleteFolderResult> {
    if (category.length === 0) throw new Error('Cannot delete the review root.');

    const folderPath = `${reviewDir}/${category.join('/')}`;
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) throw new Error('not a folder');

    const parentSegments = category.slice(0, -1);
    const parentPath = parentSegments.length
        ? `${reviewDir}/${parentSegments.join('/')}`
        : reviewDir;
    await ensureFolder(app.vault, parentPath);

    const moved: FileMove[] = [];
    const errors: string[] = [];
    const listing = await app.vault.adapter.list(folderPath);

    for (const file of listing.files) {
        try {
            const to = await moveFileToFolder(app, file, parentPath);
            moved.push({ from: file, to });
        } catch (e) {
            errors.push(`${file}: ${(e as Error).message}`);
        }
    }

    for (const child of listing.folders) {
        const target = `${parentPath}/${basename(child)}`;
        const existing = app.vault.getAbstractFileByPath(target);
        if (!existing) {
            try {
                const files = await listFilesRecursive(app, child);
                const childFolder = app.vault.getAbstractFileByPath(child);
                if (!(childFolder instanceof TFolder)) throw new Error('not a folder');
                await app.vault.rename(childFolder, target);
                for (const old of files) {
                    moved.push({ from: old, to: `${target}/${old.slice(child.length + 1)}` });
                }
            } catch (e) {
                errors.push(`${child}: ${(e as Error).message}`);
            }
        } else if (existing instanceof TFolder) {
            moved.push(...(await mergeFolder(app, child, target, errors)));
        } else {
            errors.push(`${child}: destination exists as a file`);
        }
    }

    for (const move of moved) {
        if (!move.to.toLowerCase().endsWith('.md')) continue;
        const file = app.vault.getAbstractFileByPath(move.to);
        if (!(file instanceof TFile)) continue;

        const rel = move.to.startsWith(`${reviewDir}/`)
            ? move.to.slice(reviewDir.length + 1)
            : '';
        const newCategory = rel.split('/').slice(0, -1);
        try {
            await app.fileManager.processFrontMatter(file, (fm) => {
                const frontmatter = fm as Record<string, unknown>;
                if (frontmatter['rv-exclude'] === true) return;
                if (newCategory.length) {
                    frontmatter['rv-category'] = newCategory.join('/');
                } else {
                    delete frontmatter['rv-category'];
                }
            });
        } catch (e) {
            errors.push(`${move.to}: ${(e as Error).message}`);
        }
    }

    try {
        await app.vault.adapter.rmdir(folderPath, false);
    } catch (e) {
        errors.push(`${folderPath}: ${(e as Error).message}`);
    }

    return { removedPrefix: category.join('/'), moved, errors };
}

/** Create a real category folder. */
export async function addCategoryFolder(
    app: App,
    reviewDir: string,
    parent: string[],
    name: string,
): Promise<string> {
    const rel = [...parent, name].join('/');
    await ensureFolder(app.vault, `${reviewDir}/${rel}`);
    return rel;
}
