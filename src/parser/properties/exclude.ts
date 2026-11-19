/** `rv-exclude` frontmatter parsing. */
import { stripValueQuotes, stripYamlComment } from './yaml';

/** True when `rv-exclude` is truthy. `false` / `no` / empty are explicit includes. */
export function isExcluded(fmBody: string | undefined): boolean {
    if (!fmBody) return false;
    const m = /^rv-exclude:\s*["']?([^\r\n"']*)/m.exec(fmBody);
    if (!m) return false;
    const val = stripValueQuotes(stripYamlComment(m[1] ?? '')).toLowerCase();
    return val !== '' && val !== 'false' && val !== 'no';
}
