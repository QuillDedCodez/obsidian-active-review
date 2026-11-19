/** Given a set of overrides, recompute variable values and their display sources. */
import { evaluate, fmt } from '../math';
import type { Question, UnitValue, VarDef } from '../parser';
import { evaluateQuantityExpression } from '../parser/definitions/quantityEval';
import {
    DIMENSIONLESS_UNIT,
    describeUnit,
    describeUnitWithPrefix,
    findPrefix,
    fmtQuantityValue,
    parseUnitExpr,
    prefixScale,
    type QuantityValue,
    type UnitExpr,
} from '../math/units';
import type { Value } from './types';

function isQuantityValue(value: unknown): value is QuantityValue {
    return typeof value === 'object' && value !== null && 'canonical' in value && 'unit' in value;
}

function isUnitExpr(value: unknown): value is UnitExpr {
    return typeof value === 'object' && value !== null && 'factors' in value;
}

function isUnitValue(value: unknown): value is UnitValue {
    return (
        typeof value === 'object' &&
        value !== null &&
        'unit' in value &&
        'factors' in (value as UnitValue).unit &&
        !('canonical' in value)
    );
}

const valueText = (v: Value | undefined): string => {
    if (typeof v === 'string') return `"${v}"`;
    if (isQuantityValue(v)) return fmtQuantityValue(v);
    if (isUnitValue(v)) return describeUnitWithPrefix(v.unit, v.prefix);
    if (isUnitExpr(v)) return describeUnit(v);
    return fmt(v ?? NaN);
};

export const describe = (names: string[], values: Record<string, Value>): string =>
    names
        .map((n) => `${n} = ${valueText(values[n])}`)
        .join(', ');

export interface Resolved {
    values: Record<string, Value>;
    sources: Record<string, Value>;
    /** Display-only variable sources — keyed by name, marker-wrapped. */
    displaySources: Record<string, string>;
}

function substituteForEval(src: string, numeric: Record<string, number>): string {
    return src.replace(/<<rv:(expr|exprs|val|values|value):([^>]*?)>>/g, (_whole, kind: string, raw: string) => {
        const name = raw.trim();
        const v = numeric[name];
        if (v === undefined) {
            throw new Error(`cannot substitute <<rv:${kind}:${name}>> — "${name}" is not a finite number`);
        }
        return `(${v})`;
    });
}

/** Resolve every definition in file order. Draws come from `given`; expressions
 *  are evaluated with the current numeric environment. `exprPick` receives an
 *  index and evaluates the drawn expression source. */
export function resolve(defs: VarDef[], given: Record<string, Value>): Resolved {
    const values: Record<string, Value> = {};
    const sources: Record<string, Value> = {};
    const displaySources: Record<string, string> = {};
    const numeric: Record<string, number> = {};

    for (const d of defs) {
        // Display-only: no numeric value, only a marker-wrapped source.
        if (d.kind === 'display') {
            displaySources[d.name] = d.displaySource ?? d.expr ?? '';
            continue;
        }

        // Quantity arithmetic expression.
        if (d.valueType === 'quantity' && !d.quantity && d.expr) {
            const value = evaluateQuantityExpression(d.expr, values);
            const quantity: QuantityValue =
                typeof value === 'number'
                    ? { canonical: value, unit: DIMENSIONLESS_UNIT }
                    : value;
            values[d.name] = quantity;
            sources[d.name] = d.expr;
            continue;
        }

        // Quantity definition: evaluate the magnitude, then apply the resolved
        // prefix and unit.
        if (d.valueType === 'quantity' && d.quantity) {
            const spec = d.quantity;
            let magnitude: number;
            if (d.kind === 'rand') {
                magnitude =
                    typeof given[d.name] === 'number' ? (given[d.name] as number) : d.first;
            } else if (spec.fixedValue !== undefined) {
                magnitude = spec.fixedValue;
            } else {
                magnitude = evaluate(substituteForEval(spec.valueExpr, numeric), numeric);
            }

            let prefix = spec.prefix ? findPrefix(spec.prefix) : undefined;
            if (spec.prefixRef !== undefined) {
                const picked = values[spec.prefixRef];
                if (typeof picked === 'string') {
                    prefix = picked.trim() === '' ? undefined : findPrefix(picked);
                }
            }

            let unit = spec.unit;
            if (spec.unitRef !== undefined) {
                const picked = values[spec.unitRef];
                if (isUnitValue(picked)) {
                    unit = picked.unit;
                    if (picked.prefix) prefix = picked.prefix;
                } else if (isUnitExpr(picked)) {
                    unit = picked;
                } else if (typeof picked === 'string') {
                    unit = parseUnitStringSafe(picked);
                }
            }
            if (!unit) unit = parseUnitStringSafe('u');

            const canonical =
                magnitude * prefixScale(prefix) * unit.scale + (unit.offset ?? 0);
            const quantity: QuantityValue = { canonical, unit, prefix };
            values[d.name] = quantity;
            sources[d.name] = spec.valueExpr;
            continue;
        }

        let val: Value;
        let src: Value;
        if (d.kind === 'quantityPick') {
            val = given[d.name] ?? d.values?.[0] ?? 0;
            src = val;
        } else if (d.kind === 'unit' || d.kind === 'prefix') {
            // Drawn unit/prefix values are objects/strings; they never enter `numeric`.
            let index = -1;
            const sourceName = d.dependencies?.[0];
            if (sourceName !== undefined && (d.values?.length ?? 0) > 1) {
                const sourceDef = defs.find((def) => def.name === sourceName);
                const picked = given[sourceName] ?? values[sourceName];
                index = (sourceDef?.values ?? []).findIndex((value) => value === picked);
            }
            val =
                index >= 0
                    ? d.values![index] ?? d.values?.[0] ?? ''
                    : (given[d.name] ?? d.values?.[0] ?? '');
            src = val;
        } else if (d.valueType === 'string' && d.kind !== 'stringPick') {
            val = given[d.name] ?? d.values?.[0] ?? '';
            src = val;
        } else if (d.kind === 'exprPick') {
            const idx = given[d.name] as number;
            const expr = d.values![idx] as string;
            val = evaluate(substituteForEval(expr, numeric), numeric);
            src = expr;
        } else if (d.kind === 'expr') {
            val = evaluate(substituteForEval(d.expr!, numeric), numeric);
            src = d.expr!;
        } else if (d.name in given) {
            val = given[d.name] ?? d.first;
            if (d.kind === 'stringPick') {
                const idx = (d.values ?? []).indexOf(val);
                src = idx >= 0 ? (d.valueSources?.[idx] ?? val) : val;
            } else {
                src = val;
            }
        } else if (d.kind === 'stringPick') {
            val = (d.values?.[0] as string) ?? '';
            src = d.valueSources?.[0] ?? val;
        } else {
            val = d.first;
            src = val;
        }
        values[d.name] = val;
        sources[d.name] = src;
        if (typeof val === 'number') numeric[d.name] = val;
    }
    return { values, sources, displaySources };
}

function parseUnitStringSafe(text: string): UnitExpr {
    try {
        return parseUnitExpr(text, 'si');
    } catch {
        return parseUnitExpr(text, 'abstract');
    }
}

export function computeAnswer(q: Question, values: Record<string, Value>): number {
    const v = values[q.answerName];
    return typeof v === 'number' ? v : NaN;
}