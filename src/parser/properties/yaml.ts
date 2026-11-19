/** Small YAML scalar helpers shared by frontmatter property parsers. */

export function stripYamlComment(raw: string): string {
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i]!;
        if (quote) { if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]!))) {
            return raw.slice(0, i).trimEnd();
        }
    }
    return raw;
}

export function stripValueQuotes(raw: string): string {
    let value = raw.trim();
    if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
    ) {
        value = value.slice(1, -1).trim();
    }
    return value;
}
