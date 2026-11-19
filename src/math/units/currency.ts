/**
 * Currency units. Currencies reuse the abstract unit namespace so definition-side
 * `unit("USD")` and `unit("PHP")` work through the existing unit grammar.
 *
 * Each code is a distinct abstract atom with its own `quantity` tag and a
 * `currencyCode` marker. Grading only ever matches the exact same code.
 */
import { ZERO_DIM } from './dimensions';
import type { UnitDef } from './types';

/** ISO 4217 codes supported by the plugin. */
export const CURRENCY_CODES = [
    'USD', 'EUR', 'GBP', 'JPY', 'PHP', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'KRW', 'SGD',
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyDef {
    code: CurrencyCode;
    /** Conventional symbol, used by helpers and diagnostics. */
    symbol: string;
    /** Symbols and names accepted in typed answers and `unit("...")` strings. */
    aliases: readonly string[];
}

export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyDef>> = {
    USD: { code: 'USD', symbol: '$', aliases: ['$', 'USD', 'US Dollar', 'US Dollars', 'Dollar', 'Dollars'] },
    EUR: { code: 'EUR', symbol: '€', aliases: ['€', 'EUR', 'Euro', 'Euros'] },
    GBP: { code: 'GBP', symbol: '£', aliases: ['£', 'GBP', 'Pound', 'Pounds', 'Pound Sterling'] },
    JPY: { code: 'JPY', symbol: '¥', aliases: ['¥', 'JPY', 'Yen'] },
    PHP: { code: 'PHP', symbol: '₱', aliases: ['₱', 'PHP', 'Peso', 'Pesos', 'Philippine Peso'] },
    AUD: { code: 'AUD', symbol: 'A$', aliases: ['A$', 'AUD', 'Australian Dollar', 'Australian Dollars'] },
    CAD: { code: 'CAD', symbol: 'C$', aliases: ['C$', 'CAD', 'Canadian Dollar', 'Canadian Dollars'] },
    CHF: { code: 'CHF', symbol: 'Fr', aliases: ['Fr', 'CHF', 'Franc', 'Francs', 'Swiss Franc'] },
    CNY: { code: 'CNY', symbol: '¥', aliases: ['CNY', 'Yuan', 'Renminbi', 'RMB'] },
    INR: { code: 'INR', symbol: '₹', aliases: ['₹', 'INR', 'Rupee', 'Rupees'] },
    KRW: { code: 'KRW', symbol: '₩', aliases: ['₩', 'KRW', 'Won'] },
    SGD: { code: 'SGD', symbol: 'S$', aliases: ['S$', 'SGD', 'Singapore Dollar', 'Singapore Dollars'] },
};

const CODE_SET: ReadonlySet<string> = new Set<string>(CURRENCY_CODES);

/** Is `value` one of the supported ISO codes (case-insensitive)? */
export function isCurrencyCode(value: string): value is CurrencyCode {
    return CODE_SET.has(value.trim().toUpperCase());
}

/** Normalize an arbitrary string to a supported code, or `undefined`. */
export function toCurrencyCode(value: string): CurrencyCode | undefined {
    const code = value.trim().toUpperCase();
    return isCurrencyCode(code) ? code : undefined;
}

/**
 * Abstract `UnitDef`s for every currency. `symbol` is the ISO code so the unit
 * tokenizer matches it; symbols like `$` are handled as input aliases instead.
 */
export const CURRENCY_UNITS: readonly UnitDef[] = CURRENCY_CODES.map((code) => ({
    symbol: code,
    aliases: [...CURRENCIES[code].aliases],
    dim: ZERO_DIM,
    scale: 1,
    kind: 'nonSI',
    namespace: 'abstract',
    quantity: `currency_${code}`,
    prefixable: false,
    currencyCode: code,
}));

const UNIT_BY_CODE = new Map<CurrencyCode, UnitDef>(
    CURRENCY_UNITS.map((unit) => [unit.currencyCode as CurrencyCode, unit]),
);

/** The canonical abstract unit expression backing a currency code. */
export function currencyUnit(code: CurrencyCode): UnitDef {
    const unit = UNIT_BY_CODE.get(code);
    if (!unit) throw new Error(`unknown currency code "${code}"`);
    return unit;
}

/** Which currency code(s) a written label may refer to. */
export function codesForLabel(label: string): ReadonlySet<CurrencyCode> {
    return LABEL_CODES.get(label.trim().toLowerCase()) ?? new Set<CurrencyCode>();
}

/** All known labels, longest first, for building an unambiguous scanner. */
export const CURRENCY_LABELS: readonly string[] = (() => {
    const labels = new Set<string>();
    for (const code of CURRENCY_CODES) {
        for (const alias of CURRENCIES[code].aliases) labels.add(alias);
    }
    return [...labels].sort((a, b) => b.length - a.length || a.localeCompare(b));
})();

const LABEL_CODES: ReadonlyMap<string, ReadonlySet<CurrencyCode>> = (() => {
    const map = new Map<string, Set<CurrencyCode>>();
    for (const code of CURRENCY_CODES) {
        for (const alias of CURRENCIES[code].aliases) {
            const key = alias.trim().toLowerCase();
            if (!map.has(key)) map.set(key, new Set<CurrencyCode>());
            map.get(key)!.add(code);
        }
    }
    return map;
})();

/** Phrase → ISO code rewrites, applied before unit tokenizing in abstract mode. */
export const CURRENCY_PHRASES: readonly [RegExp, string][] = CURRENCY_CODES.flatMap((code) =>
    CURRENCIES[code].aliases
        .filter((alias) => /^[A-Za-z][A-Za-z ]*$/.test(alias))
        .map((alias) => [new RegExp(`\\b${alias}\\b`, 'gi'), code] as [RegExp, string]),
).sort((a, b) => String(b[0]).length - String(a[0]).length);

/** The currency code declared on a unit expression, if any. */
export function currencyCodeOfUnit(unit: { factors: readonly { unit: UnitDef }[] }): CurrencyCode | undefined {
    for (const factor of unit.factors) {
        const code = factor.unit.currencyCode;
        if (code !== undefined && isCurrencyCode(code)) return code;
    }
    return undefined;
}
