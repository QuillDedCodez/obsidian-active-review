/** Small text helpers shared across layers. */

/** Collapse whitespace runs and trim. */
export function normaliseWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/** Case-insensitive array equality, used for category paths. */
export function arraysEqualCI(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i]!.toLowerCase() !== b[i]!.toLowerCase()) return false;
    }
    return true;
}
