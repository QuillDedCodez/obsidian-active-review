/** Vault-path helpers shared by parser, vault, session, and UI modules. */

/** Last path segment. Empty input yields an empty string. */
export function basename(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? path : path.slice(index + 1);
}

/** Folder portion of a path; root-level paths yield `''`. */
export function folderOf(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
}

/** Remove a trailing `.md` (case-insensitive). */
export function stripMd(name: string): string {
    return name.replace(/\.md$/i, '');
}

/** File name without folder or `.md` suffix. */
export function displayName(path: string): string {
    return stripMd(basename(path));
}

/** Remove leading and trailing slashes and collapse duplicate separators. */
export function trimSlashes(path: string): string {
    return path
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .replace(/\/{2,}/g, '/');
}

/** Join non-empty path segments with single slashes. */
export function joinPath(...parts: string[]): string {
    return parts
        .map(trimSlashes)
        .filter((part) => part !== '')
        .join('/');
}

/** Path relative to the review root, or null when outside it. */
export function relativeToReview(path: string, reviewDir: string): string | null {
    const root = trimSlashes(reviewDir);
    const full = path.replace(/\\/g, '/');
    if (!root) return full;
    if (full === root) return '';
    if (!full.startsWith(`${root}/`)) return null;
    return full.slice(root.length + 1);
}

/** Append `-2`, `-3`, … before the extension until `exists` is false. */
export function uniqueFileName(
    path: string,
    exists: (candidate: string) => boolean,
): string {
    if (!exists(path)) return path;
    const folder = folderOf(path);
    const name = basename(path);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    let candidate = joinPath(folder, `${stem}-${n}${ext}`);
    while (exists(candidate)) {
        n++;
        candidate = joinPath(folder, `${stem}-${n}${ext}`);
    }
    return candidate;
}
