/** SI and abstract unit registries (Proposal 2 §6). */
import { CURRENCY_PHRASES, CURRENCY_UNITS } from './currency';
import type { Dimension, UnitDef, UnitNamespace, UnitSystem } from './types';

const M: Dimension = [1, 0, 0, 0, 0, 0, 0];
const KG: Dimension = [0, 1, 0, 0, 0, 0, 0];
const S: Dimension = [0, 0, 1, 0, 0, 0, 0];
const A: Dimension = [0, 0, 0, 1, 0, 0, 0];
const K: Dimension = [0, 0, 0, 0, 1, 0, 0];
const MOL: Dimension = [0, 0, 0, 0, 0, 1, 0];
const CD: Dimension = [0, 0, 0, 0, 0, 0, 1];
const AREA: Dimension = [2, 0, 0, 0, 0, 0, 0];
const VOLUME: Dimension = [3, 0, 0, 0, 0, 0, 0];
const SPEED: Dimension = [1, 0, -1, 0, 0, 0, 0];
const N_DIM: Dimension = [1, 1, -2, 0, 0, 0, 0];
const J_DIM: Dimension = [2, 1, -2, 0, 0, 0, 0];
const W_DIM: Dimension = [2, 1, -3, 0, 0, 0, 0];
const PA_DIM: Dimension = [-1, 1, -2, 0, 0, 0, 0];
const HZ_DIM: Dimension = [0, 0, -1, 0, 0, 0, 0];
const C_DIM: Dimension = [0, 0, 1, 1, 0, 0, 0];
const V_DIM: Dimension = [2, 1, -3, -1, 0, 0, 0];
const OHM_DIM: Dimension = [2, 1, -3, -2, 0, 0, 0];
const F_DIM: Dimension = [-2, -1, 4, 2, 0, 0, 0];
const S_DIM: Dimension = [-2, -1, 3, 2, 0, 0, 0];
const WB_DIM: Dimension = [2, 1, -2, -1, 0, 0, 0];
const T_DIM: Dimension = [0, 1, -2, -1, 0, 0, 0];
const H_DIM: Dimension = [2, 1, -2, -2, 0, 0, 0];

// US customary / Imperial definitions (exact where defined).
const INCH = 0.0254;
const FOOT = 0.3048;
const YARD = 0.9144;
const MILE = 1609.344;
const ACRE = 4046.8564224;
const POUND = 0.45359237;
const OUNCE = 0.028349523125;
const SLUG = 14.593902937206364;
const SHORT_TON = 907.18474;
const LBF = 4.4482216152605;
const KIP = 4448.2216152605;
const PSI = LBF / (INCH * INCH);
const PSF = LBF / (FOOT * FOOT);
const KSI = KIP / (INCH * INCH);
const BTU = 1055.05585262;
const FT_LBF = FOOT * LBF;
const HP = 745.6998715822702;
const GALLON = 0.003785411784;
const QUART = GALLON / 4;
const PINT = QUART / 2;
const FLUID_OUNCE = GALLON / 128;
const MPH = MILE / 3600;
const KNOT = 1852 / 3600;
const RANKINE = 5 / 9;

interface UnitInit {
    symbol: string;
    aliases?: string[];
    dim: Dimension;
    scale?: number;
    kind?: UnitDef['kind'];
    quantity?: string;
    prefixable?: boolean;
    expansion?: string;
    namespace?: UnitNamespace;
    offset?: number;
    english?: boolean;
    temperature?: UnitDef['temperature'];
}

function unit(init: UnitInit): UnitDef {
    return {
        symbol: init.symbol,
        aliases: init.aliases ?? [],
        dim: init.dim,
        scale: init.scale ?? 1,
        kind: init.kind ?? 'derived',
        namespace: init.namespace ?? 'si',
        quantity: init.quantity,
        prefixable: init.prefixable ?? true,
        expansion: init.expansion,
        offset: init.offset,
        english: init.english,
        temperature: init.temperature,
    };
}

/** SI base + derived + accepted non-SI + electrical-engineering units. */
export const SI_UNITS: readonly UnitDef[] = [
    // Base units
    unit({ symbol: 'm', aliases: ['metre', 'metres', 'meter', 'meters'], dim: M, kind: 'base' }),
    unit({ symbol: 'kg', aliases: ['kilogram', 'kilograms'], dim: KG, kind: 'base', prefixable: false, expansion: 'kg' }),
    unit({ symbol: 'g', aliases: ['gram', 'grams'], dim: KG, scale: 0.001, kind: 'base', expansion: 'g' }),
    unit({ symbol: 's', aliases: ['sec', 'second', 'seconds'], dim: S, kind: 'base' }),
    unit({ symbol: 'A', aliases: ['ampere', 'amperes', 'amp', 'amps'], dim: A, kind: 'base', quantity: 'current' }),
    unit({ symbol: 'K', aliases: ['kelvin', 'kelvins'], dim: K, kind: 'base', temperature: 'absolute' }),
    unit({ symbol: 'mol', aliases: ['mole', 'moles'], dim: MOL, kind: 'base' }),
    unit({ symbol: 'cd', aliases: ['candela', 'candelas'], dim: CD, kind: 'base' }),

    // Common derived units
    unit({ symbol: 'N', aliases: ['newton', 'newtons'], dim: N_DIM, quantity: 'force', expansion: 'kg*m/s^2' }),
    unit({ symbol: 'J', aliases: ['joule', 'joules'], dim: J_DIM, quantity: 'energy', expansion: 'N*m' }),
    unit({ symbol: 'W', aliases: ['watt', 'watts'], dim: W_DIM, quantity: 'power', expansion: 'J/s' }),
    unit({ symbol: 'Pa', aliases: ['pascal', 'pascals'], dim: PA_DIM, quantity: 'pressure', expansion: 'N/m^2' }),
    unit({ symbol: 'Hz', aliases: ['hertz'], dim: HZ_DIM, quantity: 'frequency', expansion: '1/s' }),
    unit({ symbol: 'C', aliases: ['coulomb', 'coulombs'], dim: C_DIM, quantity: 'charge', expansion: 'A*s' }),
    unit({ symbol: 'V', aliases: ['volt', 'volts'], dim: V_DIM, quantity: 'voltage', expansion: 'W/A' }),
    unit({ symbol: 'Ω', aliases: ['ohm', 'ohms'], dim: OHM_DIM, quantity: 'resistance', expansion: 'V/A' }),
    unit({ symbol: 'F', aliases: ['farad', 'farads'], dim: F_DIM, quantity: 'capacitance', expansion: 'C/V' }),
    unit({ symbol: 'S', aliases: ['siemens'], dim: S_DIM, quantity: 'conductance', expansion: 'A/V' }),
    unit({ symbol: 'Wb', aliases: ['weber', 'webers'], dim: WB_DIM, quantity: 'magnetic_flux', expansion: 'V*s' }),
    unit({ symbol: 'T', aliases: ['tesla', 'teslas'], dim: T_DIM, quantity: 'flux_density', expansion: 'Wb/m^2' }),
    unit({ symbol: 'H', aliases: ['henry', 'henries'], dim: H_DIM, quantity: 'inductance', expansion: 'Wb/A' }),

    // Non-SI electrical units
    unit({ symbol: 'VA', aliases: ['volt-ampere', 'voltamperes'], dim: W_DIM, kind: 'nonSI', quantity: 'apparent_power' }),
    unit({ symbol: 'var', aliases: ['volt-ampere-reactive'], dim: W_DIM, kind: 'nonSI', quantity: 'reactive_power' }),
    unit({ symbol: 'Wh', aliases: ['watt-hour', 'watt-hour', 'watthour'], dim: J_DIM, scale: 3600, kind: 'nonSI', quantity: 'energy' }),
    unit({ symbol: 'Ah', aliases: ['ampere-hour', 'amperehour'], dim: C_DIM, scale: 3600, kind: 'nonSI', quantity: 'charge' }),

    // Accepted non-SI
    unit({ symbol: 'L', aliases: ['l', 'litre', 'litres', 'liter', 'liters'], dim: [3, 0, 0, 0, 0, 0, 0], scale: 0.001, kind: 'nonSI' }),
    unit({ symbol: 'min', aliases: ['minute', 'minutes'], dim: S, scale: 60, kind: 'nonSI', prefixable: false }),
    unit({ symbol: 'h', aliases: ['hr', 'hour', 'hours'], dim: S, scale: 3600, kind: 'nonSI', prefixable: false }),
    unit({ symbol: 'd', aliases: ['day', 'days'], dim: S, scale: 86400, kind: 'nonSI', prefixable: false }),
    unit({ symbol: 't', aliases: ['tonne', 'tonnes'], dim: KG, scale: 1000, kind: 'nonSI', prefixable: false }),
    unit({ symbol: 'bar', aliases: ['bars'], dim: PA_DIM, scale: 100000, kind: 'nonSI' }),
    unit({ symbol: 'atm', aliases: ['atmosphere', 'atmospheres'], dim: PA_DIM, scale: 101325, kind: 'nonSI', prefixable: false }),
    unit({ symbol: 'eV', aliases: ['electronvolt', 'electronvolts'], dim: J_DIM, scale: 1.602176634e-19, kind: 'nonSI' }),
    unit({ symbol: '%', aliases: ['percent'], dim: [0, 0, 0, 0, 0, 0, 0], scale: 0.01, kind: 'dimensionless', quantity: 'fraction', prefixable: false }),
    unit({ symbol: 'ppm', aliases: [], dim: [0, 0, 0, 0, 0, 0, 0], scale: 1e-6, kind: 'dimensionless', quantity: 'ratio', prefixable: false }),
    unit({ symbol: 'rad', aliases: ['radian', 'radians'], dim: [0, 0, 0, 0, 0, 0, 0], scale: 1, kind: 'dimensionless', quantity: 'angle', prefixable: false }),
    unit({ symbol: 'deg', aliases: ['degree', 'degrees', '°'], dim: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 180, kind: 'dimensionless', quantity: 'angle', prefixable: false }),
    unit({ symbol: 'grad', aliases: ['gradian', 'gradians', 'gon'], dim: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 200, kind: 'dimensionless', quantity: 'angle', prefixable: false }),
    unit({ symbol: 'rev', aliases: ['revolution', 'revolutions', 'turn', 'turns'], dim: [0, 0, 0, 0, 0, 0, 0], scale: 2 * Math.PI, kind: 'dimensionless', quantity: 'angle', prefixable: false }),

    // ------------------------------------------------------------------
    // US customary / Imperial units. Same registry as SI on purpose: a note
    // may mix them, and the value conversion is exact.
    // ------------------------------------------------------------------
    unit({ symbol: 'in', aliases: ['inch', 'inches'], dim: M, scale: INCH, kind: 'nonSI', quantity: 'length', prefixable: false, english: true }),
    unit({ symbol: 'ft', aliases: ['foot', 'feet'], dim: M, scale: FOOT, kind: 'nonSI', quantity: 'length', prefixable: false, english: true }),
    unit({ symbol: 'yd', aliases: ['yard', 'yards'], dim: M, scale: YARD, kind: 'nonSI', quantity: 'length', prefixable: false, english: true }),
    unit({ symbol: 'mi', aliases: ['mile', 'miles'], dim: M, scale: MILE, kind: 'nonSI', quantity: 'length', prefixable: false, english: true }),
    unit({ symbol: 'acre', aliases: ['acres'], dim: AREA, scale: ACRE, kind: 'nonSI', quantity: 'area', prefixable: false, english: true }),

    unit({ symbol: 'lb', aliases: ['pound', 'pounds', 'lbm'], dim: KG, scale: POUND, kind: 'nonSI', quantity: 'mass', prefixable: false, english: true }),
    unit({ symbol: 'oz', aliases: ['ounce', 'ounces'], dim: KG, scale: OUNCE, kind: 'nonSI', quantity: 'mass', prefixable: false, english: true }),
    unit({ symbol: 'slug', aliases: ['slugs'], dim: KG, scale: SLUG, kind: 'nonSI', quantity: 'mass', prefixable: false, english: true }),
    unit({ symbol: 'ton', aliases: ['shortton', 'shorttons'], dim: KG, scale: SHORT_TON, kind: 'nonSI', quantity: 'mass', prefixable: false, english: true }),

    unit({ symbol: 'lbf', aliases: ['poundforce', 'poundsforce'], dim: N_DIM, scale: LBF, kind: 'nonSI', quantity: 'force', prefixable: false, english: true }),
    unit({ symbol: 'kip', aliases: ['kips'], dim: N_DIM, scale: KIP, kind: 'nonSI', quantity: 'force', prefixable: false, english: true }),

    unit({ symbol: 'psi', aliases: ['poundpersquareinch'], dim: PA_DIM, scale: PSI, kind: 'nonSI', quantity: 'pressure', prefixable: false, english: true }),
    unit({ symbol: 'psf', aliases: ['poundpersquarefoot'], dim: PA_DIM, scale: PSF, kind: 'nonSI', quantity: 'pressure', prefixable: false, english: true }),
    unit({ symbol: 'ksi', aliases: [], dim: PA_DIM, scale: KSI, kind: 'nonSI', quantity: 'pressure', prefixable: false, english: true }),

    unit({ symbol: 'BTU', aliases: ['btu', 'btus'], dim: J_DIM, scale: BTU, kind: 'nonSI', quantity: 'energy', prefixable: false, english: true }),
    unit({ symbol: 'ftlb', aliases: ['footpound', 'footpounds'], dim: J_DIM, scale: FT_LBF, kind: 'nonSI', quantity: 'energy', prefixable: false, english: true }),
    unit({ symbol: 'hp', aliases: ['horsepower'], dim: W_DIM, scale: HP, kind: 'nonSI', quantity: 'power', prefixable: false, english: true }),

    unit({ symbol: 'gal', aliases: ['gallon', 'gallons'], dim: VOLUME, scale: GALLON, kind: 'nonSI', quantity: 'volume', prefixable: false, english: true }),
    unit({ symbol: 'qt', aliases: ['quart', 'quarts'], dim: VOLUME, scale: QUART, kind: 'nonSI', quantity: 'volume', prefixable: false, english: true }),
    unit({ symbol: 'pt', aliases: ['pint', 'pints'], dim: VOLUME, scale: PINT, kind: 'nonSI', quantity: 'volume', prefixable: false, english: true }),
    unit({ symbol: 'floz', aliases: ['fluidounce', 'fluidounces'], dim: VOLUME, scale: FLUID_OUNCE, kind: 'nonSI', quantity: 'volume', prefixable: false, english: true }),

    unit({ symbol: 'mph', aliases: ['milesperhour'], dim: SPEED, scale: MPH, kind: 'nonSI', quantity: 'speed', prefixable: false, english: true }),
    unit({ symbol: 'knot', aliases: ['knots'], dim: SPEED, scale: KNOT, kind: 'nonSI', quantity: 'speed', prefixable: false, english: true }),

    // Temperature: absolute units carry an offset, interval units do not.
    unit({ symbol: '°C', aliases: ['degC', 'celsius'], dim: K, scale: 1, offset: 273.15, kind: 'nonSI', quantity: 'temperature', prefixable: false, temperature: 'absolute' }),
    unit({ symbol: '°F', aliases: ['degF', 'fahrenheit'], dim: K, scale: RANKINE, offset: (459.67 * 5) / 9, kind: 'nonSI', quantity: 'temperature', prefixable: false, english: true, temperature: 'absolute' }),
    unit({ symbol: '°R', aliases: ['degR', 'rankine'], dim: K, scale: RANKINE, kind: 'nonSI', quantity: 'temperature', prefixable: false, english: true, temperature: 'absolute' }),
    unit({ symbol: 'deltaC', aliases: ['delta°C'], dim: K, scale: 1, kind: 'nonSI', quantity: 'temperature_interval', prefixable: false, temperature: 'delta' }),
    unit({ symbol: 'deltaF', aliases: ['delta°F'], dim: K, scale: RANKINE, kind: 'nonSI', quantity: 'temperature_interval', prefixable: false, english: true, temperature: 'delta' }),
];

/**
 * Mathematical abstract units. `u^2` / `u^3` parse as `u` with an exponent; the
 * phrase aliases are rewritten to those forms before tokenizing.
 */
export const ABSTRACT_UNITS: readonly UnitDef[] = [
    unit({
        symbol: 'u',
        aliases: ['unit', 'units', 'abstract unit', 'abstract units', 'arb. unit', 'arb. units'],
        dim: M,
        kind: 'nonSI',
        namespace: 'abstract',
        quantity: 'abstract_length',
        prefixable: false,
        expansion: 'u',
    }),
    // Currency codes are abstract atoms so `unit("USD")` resolves through the
    // same SI → abstract fallback as any other unit string.
    ...CURRENCY_UNITS,
];

/** Phrase → canonical unit text, applied before tokenizing an abstract unit. */
export const ABSTRACT_ALIASES: readonly [RegExp, string][] = [
    [/\bsq(?:uare)?\.?\s*u(?:nits?)?\b/gi, 'u^2'],
    [/\bunits?\s+squared\b/gi, 'u^2'],
    [/\bsqr\.?\s*u(?:nits?)?\b/gi, 'u^2'],
    [/\bcu(?:bic)?\.?\s*u(?:nits?)?\b/gi, 'u^3'],
    [/\bunits?\s+cubed\b/gi, 'u^3'],
    [/\babstract\s+units?\b/gi, 'u'],
    [/\barb\.?\s+units?\b/gi, 'u'],
    // Currency names such as `Dollar` / `Philippine Peso` rewrite to their ISO
    // code so `unit("Dollar")` and typed labels resolve to the canonical atom.
    ...CURRENCY_PHRASES,
];

const SI_SYMBOLS = new Map<string, UnitDef>();
const SI_ALIASES = new Map<string, UnitDef>();
for (const u of SI_UNITS) {
    SI_SYMBOLS.set(u.symbol, u);
    for (const a of u.aliases) {
        const key = a.toLowerCase();
        if (!SI_ALIASES.has(key)) SI_ALIASES.set(key, u);
    }
}

const ABSTRACT_SYMBOLS = new Map<string, UnitDef>();
const ABSTRACT_ALIASES_MAP = new Map<string, UnitDef>();
for (const u of ABSTRACT_UNITS) {
    ABSTRACT_SYMBOLS.set(u.symbol, u);
    for (const a of u.aliases) ABSTRACT_ALIASES_MAP.set(a.toLowerCase(), u);
}

export function registryFor(system: UnitSystem): readonly UnitDef[] {
    return system === 'abstract' ? ABSTRACT_UNITS : SI_UNITS;
}

export function lookupUnitSymbol(system: UnitSystem, symbol: string): UnitDef | undefined {
    return system === 'abstract' ? ABSTRACT_SYMBOLS.get(symbol) : SI_SYMBOLS.get(symbol);
}

export function lookupUnitAlias(system: UnitSystem, alias: string): UnitDef | undefined {
    const key = alias.toLowerCase();
    return system === 'abstract' ? ABSTRACT_ALIASES_MAP.get(key) : SI_ALIASES.get(key);
}
