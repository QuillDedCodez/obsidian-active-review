/** SI decimal prefixes. */
import type { PrefixDef } from './types';

function prefix(symbol: string, power: number, aliases: string[] = []): PrefixDef {
    return { symbol, power, aliases };
}

export const SI_PREFIXES: readonly PrefixDef[] = [
    prefix('Y', 24, ['yotta']),
    prefix('Z', 21, ['zetta']),
    prefix('E', 18, ['exa']),
    prefix('P', 15, ['peta']),
    prefix('T', 12, ['tera']),
    prefix('G', 9, ['giga']),
    prefix('M', 6, ['mega']),
    prefix('k', 3, ['kilo']),
    prefix('h', 2, ['hecto']),
    prefix('da', 1, ['deca', 'deka']),
    prefix('d', -1, ['deci']),
    prefix('c', -2, ['centi']),
    prefix('m', -3, ['milli']),
    prefix('µ', -6, ['micro', 'u']),
    prefix('n', -9, ['nano']),
    prefix('p', -12, ['pico']),
    prefix('f', -15, ['femto']),
    prefix('a', -18, ['atto']),
    prefix('z', -21, ['zepto']),
    prefix('y', -24, ['yocto']),
];

const BY_SYMBOL = new Map<string, PrefixDef>();
for (const p of SI_PREFIXES) BY_SYMBOL.set(p.symbol, p);
BY_SYMBOL.set('u', BY_SYMBOL.get('µ')!);
BY_SYMBOL.set('μ', BY_SYMBOL.get('µ')!);

/** Prefixes ordered longest-first so `da` wins over `d`. */
export const PREFIXES_LONGEST_FIRST: readonly PrefixDef[] = [...SI_PREFIXES].sort(
    (a, b) => b.symbol.length - a.symbol.length,
);

export function prefixScale(prefix: PrefixDef | undefined): number {
    return prefix === undefined ? 1 : Math.pow(10, prefix.power);
}

export function findPrefix(symbol: string): PrefixDef | undefined {
    return BY_SYMBOL.get(symbol.trim());
}

export function prefixSymbol(prefix: PrefixDef | undefined): string {
    return prefix === undefined ? '' : prefix.symbol;
}
