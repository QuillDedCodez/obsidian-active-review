/** Create folders recursively and scan category folders under the review root. */
import { TFolder, type Vault } from 'obsidian';

/** Create every missing segment in `path` recursively. */
export async function ensureFolder(vault: Vault, path: string): Promise<void> {
    if (!path) return;
    if (vault.getAbstractFileByPath(path)) return;
    const parent = path.split('/').slice(0, -1).join('/');
    if (parent) await ensureFolder(vault, parent);
    await vault.createFolder(path);
}

/** Recursively list category folders under the review root, including empty folders. */
export function scanReviewFolders(
    vault: Vault,
    reviewDir: string,
    sessionsSubdir: string,
): string[] {
    const root = reviewDir.replace(/^\/+|\/+$/g, '');
    const out: string[] = [''];
    if (!root) return out;

    const rootLower = root.toLowerCase();
    const sessionsLower = sessionsSubdir.toLowerCase();

    for (const entry of vault.getAllLoadedFiles()) {
        if (!(entry instanceof TFolder)) continue;
        const entryLower = entry.path.toLowerCase();
        if (entryLower === rootLower) continue;
        if (!entryLower.startsWith(`${rootLower}/`)) continue;

        const rel = entry.path.slice(root.length + 1);
        if (!rel) continue;
        const relLower = rel.toLowerCase();
        if (
            sessionsLower &&
            (relLower === sessionsLower || relLower.startsWith(`${sessionsLower}/`))
        ) {
            continue;
        }
        if (rel.split('/').some((segment) => segment.startsWith('.'))) continue;
        out.push(rel);
    }

    return [...new Set(out)].sort();
}