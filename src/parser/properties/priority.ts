/** `rv-priority` frontmatter parsing. */
import { stripValueQuotes, stripYamlComment } from './yaml';

/**
 * Parse `rv-priority` from frontmatter.
 * - Bare or quoted integer → used as-is.
 * - Float → rounded down.
 * - Non-finite or unparseable → 100, warning.
 */
export function parsePriority(
    fmBody: string | undefined,
): { priority: number; warning?: string } {
    if (!fmBody) return { priority: 100 };
    const m = /^rv-priority:\s*(.+?)\s*$/m.exec(fmBody);
    if (!m) return { priority: 100 };
    const raw = stripValueQuotes(stripYamlComment(m[1] ?? ''));
    if (raw === '') return { priority: 100 };
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        return {
            priority: 100,
            warning: `rv-priority: "${raw}" is not a finite number — falling back to 100`,
        };
    }
    return { priority: Math.floor(n) };
}
