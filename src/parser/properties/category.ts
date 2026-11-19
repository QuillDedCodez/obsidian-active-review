/** Category resolution from `rv-category` and the note's folder location. */
import type { CategorySource } from '../types';
import { stripValueQuotes, stripYamlComment } from './yaml';

/** Folder segments between the review root and the filename. */
export function extractFolderCategory(path: string, reviewDir: string): string[] {
    const prefix = reviewDir.endsWith('/') ? reviewDir : `${reviewDir}/`;
    if (!path.toLowerCase().startsWith(prefix.toLowerCase())) return [];
    const rest = path.slice(prefix.length);
    const segs = rest.split('/');
    return segs.slice(0, -1).filter((s) => s !== '');
}

/** Parse `rv-category: a/b/c` into segments. Empty or absent → `[]`. */
export function extractDeclaredCategory(frontmatter: string | undefined): string[] {
    if (!frontmatter) return [];
    const m = /^rv-category:\s*(.*)$/m.exec(frontmatter);
    if (!m) return [];
    const raw = stripValueQuotes(stripYamlComment((m[1] ?? '').trim()));
    if (!raw) return [];
    return raw.split('/').map((s) => s.trim()).filter((s) => s !== '');
}

/** Option A: folder wins; frontmatter is the fallback when the note is at the review root. */
export function resolveCategory(
    folder: string[],
    declared: string[],
): { category: string[]; categorySource: CategorySource } {
    if (folder.length > 0) return { category: folder, categorySource: 'folder' };
    if (declared.length > 0) return { category: declared, categorySource: 'frontmatter' };
    return { category: [], categorySource: 'none' };
}
