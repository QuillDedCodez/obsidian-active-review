/**
 * Parse the `rv-answer` fence under `## ANSWERS` (Proposal 2 §4–5, Proposal 3 §4–5).
 *
 * One fence per note. Global keys (`typed-mode`, `sep`) appear before the first
 * variable header. Parameters after a header belong to that variable.
 */
import {
    CURRENCY_CODES,
    DIMENSIONLESS_UNIT,
    currencyCodeOfUnit,
    currencyUnit,
    dimEquals,
    findPrefix,
    plainUnitText,
    toCurrencyCode,
    ZERO_DIM,
    type AnswerSlotSpec,
    type AnswerSpec,
    type CurrencyCode,
    type DisplayMode,
    type Notation,
    type PrecisionPolicy,
    type PrefixPolicy,
    type TypedMode,
    type UnitMode,
} from '../../math/units';
import { parseVariant, VariantError } from './variants';
import { parseUnitString } from '../definitions/typed';
import { SECTIONS } from '../sections';
import type { VarDef, Warning } from '../types';

export class AnswerSpecError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AnswerSpecError';
    }
}

export interface AnswerSpecContext {
    vars: VarDef[];
    stringNames: Set<string>;
    /** `## ANSWERS` blocks, in source order. */
    blocks: string[];
    /** `## DISTRACTORS` blocks, in source order. */
    distractorBlocks?: string[];
    /** Sections carrying `<!--debug-called-definitions-->`. */
    literalSections?: Set<string>;
}

export interface ParsedAnswerSpec {
    spec: AnswerSpec;
    warnings: Warning[];
}

const BINDING_KEYS = new Set([
    'unit-label',
    'prefix-policy',
    'allowed-prefixes',
    'unit-mode',
    'accept-units',
    'display',
    'min-sigfigs',
    'max-sigfigs',
    'notation',
    'unit-optional',
    'rv-currency',
    'rv-comma',
]);


function fail(message: string): never {
    throw new AnswerSpecError(message);
}

function asUnitMode(raw: string): UnitMode {
    const value = raw.trim().toLowerCase();
    if (
        value === 'declared' ||
        value === 'atomic' ||
        value === 'expanded' ||
        value === 'list' ||
        value === 'dimension' ||
        value === 'family'
    ) {
        return value;
    }
    return fail(`unit-mode = ${raw}: expected declared, atomic, expanded, list, dimension, or family`);
}

function asDisplay(raw: string): DisplayMode {
    const value = raw.trim().toLowerCase();
    if (value === 'declared' || value === 'atomic' || value === 'expanded') return value;
    return fail(`display = ${raw}: expected declared, atomic, or expanded`);
}

function asPrefixPolicy(raw: string): PrefixPolicy {
    const value = raw.trim().toLowerCase();
    if (value === 'any' || value === 'exact') return value;
    return fail(`prefix-policy = ${raw}: expected "any" or "exact"`);
}

function asNotation(raw: string): Notation {
    const value = raw.trim().toLowerCase();
    if (value === 'auto' || value === 'decimal' || value === 'scientific') return value;
    return fail(`notation = ${raw}: expected auto, decimal, or scientific`);
}

function asTypedMode(raw: string): TypedMode {
    const value = raw.trim().toLowerCase();
    if (value === 'values' || value === 'prose' || value === 'either') return value;
    return fail(`typed-mode = ${raw}: expected values, prose, or either`);
}

function asBoolean(raw: string, key: string): boolean {
    const value = raw.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fail(`${key} = ${raw}: expected true or false`);
}

function asNumber(raw: string, key: string): number {
    const value = Number(raw.trim());
    if (!Number.isFinite(value)) return fail(`${key} = ${raw}: not a finite number`);
    return value;
}

function readIntBound(
    keys: Map<string, string>,
    key: string,
    minimum: number,
    maximum: number,
): number | undefined {
    const value = keys.get(key);
    if (value === undefined) return undefined;
    const n = asNumber(value, key);
    if (!Number.isInteger(n) || n < minimum || n > maximum) {
        fail(`${key} = ${value}: expected an integer between ${minimum} and ${maximum}`);
    }
    return n;
}

/**
 * Precision band. The families are mutually exclusive per binding; `min` drives
 * grading tolerance and `max` drives the displayed precision. A single bound is
 * mirrored, so `min-sigfigs = 3` means exactly 3.
 */
function stripOptionalQuotes(raw: string): string {
    const value = raw.trim();
    if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

function findDef(context: AnswerSpecContext, name: string, where: string): VarDef {
    const def = context.vars.find((d) => d.name === name);
    if (!def) return fail(`${where}: "${name}" is not defined in rv-def`);
    return def;
}

/** Build one quantity value binding; non-quantity definitions are ignored with a warning. */
function buildSlot(
    valueName: string,
    keys: Map<string, string>,
    context: AnswerSpecContext,
    warnings: Warning[],
): AnswerSlotSpec | null {
    const def = findDef(context, valueName, 'rv-answer');
    if (def.valueType !== 'quantity') {
        warnings.push({
            section: 'answers',
            message:
                `rv-answer: "${valueName}" is not a quantity definition; ` +
                'the rv-answer constraint is ignored. Declare it with value ; prefix ; unit first.',
        });
        return null;
    }

    const unitMode: UnitMode = keys.has('unit-mode')
        ? asUnitMode(keys.get('unit-mode')!)
        : 'expanded';
    const declaredUnit = def.quantity?.unit;
    const defCurrency = declaredUnit !== undefined
        ? currencyCodeOfUnit(declaredUnit)
        : undefined;

    let currency: CurrencyCode | undefined;
    if (keys.has('rv-currency')) {
        const rawCode = stripOptionalQuotes(keys.get('rv-currency')!);
        const code = toCurrencyCode(rawCode);
        if (code === undefined) {
            fail(
                `rv-answer: ${valueName}: rv-currency = ${rawCode}: expected one of ${CURRENCY_CODES.join(', ')}`,
            );
        }
        if (defCurrency !== undefined && defCurrency !== code) {
            fail(
                `rv-answer: ${valueName}: rv-currency = ${code} conflicts with ` +
                    `the definition's ${defCurrency} unit`,
            );
        }
        currency = code;
    }
    const groupThousands = keys.has('rv-comma')
        ? asBoolean(keys.get('rv-comma')!, 'rv-comma')
        : false;

    let unit = declaredUnit ?? DIMENSIONLESS_UNIT;
    let unitSystem: AnswerSlotSpec['unitSystem'] = declaredUnit?.namespace ?? 'si';
    if (currency !== undefined && defCurrency === undefined) {
        if (unit.factors.length === 0) {
            // A plain numeric definition adopts the declared currency as its unit.
            unit = {
                factors: [{ unit: currencyUnit(currency), exponent: 1 }],
                dim: ZERO_DIM,
                scale: 1,
                namespace: 'abstract',
            };
            unitSystem = 'abstract';
        } else {
            fail(
                `rv-answer: ${valueName}: rv-currency = ${currency} cannot be combined ` +
                    'with a declared non-currency unit',
            );
        }
    }

    const acceptUnits = keys.has('accept-units')
        ? keys
              .get('accept-units')!
              .split(',')
              .map((part) => part.trim())
              .filter((part) => part !== '')
              .map((part) => parseUnitString(part))
        : undefined;

    let allowedPrefixes: AnswerSlotSpec['allowedPrefixes'] = 'auto';
    if (keys.has('allowed-prefixes')) {
        const text = keys.get('allowed-prefixes')!.trim();
        const lower = text.toLowerCase();
        if (lower === 'auto' || lower === 'none') {
            allowedPrefixes = lower;
        } else {
            allowedPrefixes = text
                .split(',')
                .map((part) => part.trim())
                .filter((part) => part !== '')
                .map((part) => {
                    const found = findPrefix(part);
                    if (!found) return fail(`allowed-prefixes: "${part}" is not a known prefix`);
                    return found;
                });
        }
    }

    const min = readIntBound(keys, 'min-sigfigs', 1, 15) ?? 3;
    const max = readIntBound(keys, 'max-sigfigs', 1, 15);
    if (max !== undefined && max < min) {
        fail(`rv-answer: ${valueName}: max-sigfigs (${max}) must not be less than min-sigfigs (${min})`);
    }
    const precision: PrecisionPolicy = {
        kind: 'sigfigs',
        min,
        max: max ?? 15,
    };

    const notation = keys.has('notation') ? asNotation(keys.get('notation')!) : 'auto';
    const display = keys.has('display') ? asDisplay(keys.get('display')!) : 'atomic';
    const prefixPolicy = keys.has('prefix-policy')
        ? asPrefixPolicy(keys.get('prefix-policy')!)
        : 'any';
    const unitOptional = keys.has('unit-optional')
        ? asBoolean(keys.get('unit-optional')!, 'unit-optional')
        : false;

    if (unitMode === 'list' && (!acceptUnits || acceptUnits.length === 0)) {
        fail(`rv-answer: ${valueName}: unit-mode = list requires accept-units`);
    }
    if (declaredUnit && acceptUnits) {
        for (const accepted of acceptUnits) {
            if (!dimEquals(accepted.dim, declaredUnit.dim)) {
                warnings.push({
                    section: 'answers',
                    message:
                        `rv-answer: ${valueName}: accept-units entry "${plainUnitText(accepted)}" ` +
                        'has a different dimension from the declared unit and will be inactive',
                });
            }
        }
    }
    if (prefixPolicy === 'exact' && (unitMode === 'dimension' || unitMode === 'expanded')) {
        fail(
            `rv-answer: ${valueName}: prefix-policy = exact requires unit-mode = atomic or list of atomic forms`,
        );
    }
    if (unitMode === 'dimension' || unitMode === 'family') {
        warnings.push({
            section: 'answers',
            message: `rv-answer: ${valueName}: unit-mode = ${unitMode} accepts a broad unit family`,
        });
    }
    if (keys.has('unit-label') && allowedPrefixes === 'auto') {
        warnings.push({
            section: 'answers',
            message: `rv-answer: ${valueName}: unit-label suppresses automatic prefix selection`,
        });
    }

    return {
        id: valueName,
        valueName,
        type: 'number',
        unitSystem,
        unit,
        unitLabel: keys.has('unit-label') ? stripOptionalQuotes(keys.get('unit-label')!) : undefined,
        unitMode,
        acceptUnits,
        display,
        prefixPolicy,
        allowedPrefixes,
        precision,
        notation,
        unitOptional,
        currency,
        groupThousands,
        tol: 0,
        relTol: 0,
    };
}

/**
 * Parse one `rv-answer` fence. Throws `AnswerSpecError` with a message suitable
 * for the scanner's Skipped Note panel.
 */
export function parseAnswerSpec(rawText: string, context: AnswerSpecContext): ParsedAnswerSpec {
    const globals = new Map<string, string>();
    const bindings: { name: string; keys: Map<string, string> }[] = [];
    let current: Map<string, string> | null = null;

    for (const rawLine of rawText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line === '') continue;

        if (/^rvdef\s*\(/.test(line)) {
            fail(
                'rv-answer: rvdef(name) has been removed — use a variable header instead, e.g. "ans:"',
            );
        }

        const header = /^([A-Za-z][A-Za-z0-9_]*):\s*$/.exec(line);
        if (header) {
            const name = header[1] ?? '';
            findDef(context, name, 'rv-answer header');
            if (bindings.some((binding) => binding.name === name)) {
                fail(`rv-answer: duplicate variable header "${name}:"`);
            }
            current = new Map();
            bindings.push({ name, keys: current });
            continue;
        }

        // Both `key = value` and `key: value` are accepted. The colon form is
        // used by the currency/comma parameters; the equals form by older keys.
        const kv = /^([a-z][a-z-]*)\s*[=:]\s*(.+)$/.exec(line);
        if (!kv) {
            fail(`rv-answer: cannot read "${line}" (use name:, key = value, or a global key)`);
        }
        const key = kv[1] ?? '';
        const value = (kv[2] ?? '').trim();

        if (key === 'typed-mode' || key === 'sep') {
            if (current !== null) {
                fail(`rv-answer: ${key} is global and must appear before the first variable header`);
            }
            if (globals.has(key)) fail(`rv-answer: duplicate global key "${key}"`);
            globals.set(key, value);
            continue;
        }

        if (!BINDING_KEYS.has(key)) return fail(`rv-answer: unknown key "${key}"`);
        if (current === null) {
            fail(`rv-answer: "${key}" must appear under a variable header (name:)`);
        }
        if (current.has(key)) {
            fail(`rv-answer: duplicate key "${key}" for "${bindings[bindings.length - 1]!.name}"`);
        }
        current.set(key, value);
    }

    const typedMode = globals.has('typed-mode')
        ? asTypedMode(globals.get('typed-mode')!)
        : 'either';
    const sep = globals.has('sep') ? stripOptionalQuotes(globals.get('sep')!) : ',';
    if (sep === '') fail('rv-answer: sep must not be empty');

    const warnings: Warning[] = [];
    const slots: AnswerSlotSpec[] = [];
    for (const binding of bindings) {
        const slot = buildSlot(binding.name, binding.keys, context, warnings);
        if (slot !== null) slots.push(slot);
    }

    const prose = slots.length > 1;
    const answersLiteral = context.literalSections?.has(SECTIONS.ANSWERS) === true;
    let variants: AnswerSpec['variants'] = [];
    if (answersLiteral) {
        variants = context.blocks
            .filter((raw) => raw.trim() !== '')
            .map((raw) => ({
                raw,
                segments: [{ kind: 'literal' as const, text: raw }],
                required: [],
                literalText: raw,
            }));
    } else {
        try {
            variants = context.blocks
                .map((block) => parseVariant(block))
                .filter((variant) => variant.raw.trim() !== '');
        } catch (e) {
            if (e instanceof VariantError) return fail(`rv-answer: ${e.message}`);
            throw e;
        }
    }
    if (variants.length === 0) fail('rv-answer: requires at least one ## ANSWERS block');
    if (typedMode === 'prose' && !answersLiteral) {
        const weak = variants.findIndex((variant) => variant.literalText.trim() === '');
        if (weak >= 0) {
            fail(
                `rv-answer: typed-mode = prose requires literal anchors, but ## ANSWERS block ${weak + 1} ` +
                    'contains only values',
            );
        }
    }

    return {
        spec: {
            kind: prose ? 'prose' : 'scalar',
            slots,
            variants,
            typedMode,
            sep,
            distractorStrategy: 'variable',
            raw: rawText,
        },
        warnings,
    };
}
