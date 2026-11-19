/** Parse and validate the `rv-def` block under `## DEFINITIONS`. */
import type { VarDef, Warning } from '../types';
import { parseVars, validateLinks } from './variables';

export interface DefinitionsResult {
    vars: VarDef[];
    links: string[][];
    warnings: Warning[];
    displayNames: Set<string>;
    /** Numeric definitions, mutated as the block is parsed. */
    env: Record<string, number>;
    /** String-valued definitions. */
    stringNames: Set<string>;
}

export function parseDefinitions(defBlock: string): DefinitionsResult {
    const vars: VarDef[] = [];
    const links: string[][] = [];
    const warnings: Warning[] = [];
    const displayNames = new Set<string>();
    const env: Record<string, number> = {};
    const stringNames = new Set<string>();

    if (defBlock) {
        const parsed = parseVars(defBlock, 'rv-def', env, stringNames);
        vars.push(...parsed.defs);
        links.push(...parsed.links);
        warnings.push(...parsed.warnings);
        for (const name of parsed.displayNames) displayNames.add(name);
        validateLinks(links, vars);
        if (vars.length === 0) {
            throw new Error('## DEFINITIONS block is empty');
        }
    }

    return { vars, links, warnings, displayNames, env, stringNames };
}

export {
    DefinitionExpressionError,
    effectiveCount,
    isFlipped,
    linkName,
    parseVars,
    validateLinks,
} from './variables';
