/** Apply `rv-distract` conditioning to free-text distractor blocks (MCQ only). */
import { fmt } from '../../math';
import { isInsideMath } from '../../math/latex';
import { renderExpression } from '../../math/symbolic';
import type { FormattedValue, Question, UnitValue, Warning } from '../../parser';
import {
    describeUnitLatex,
    describeUnitWithPrefix,
    fmtQuantity,
    fmtQuantityValue,
    namedUnitFor,
    prefixScale,
    type AnswerSlotSpec,
    type QuantityValue,
    type UnitExpr,
} from '../../math/units';
import { fillPlaceholders } from '../../parser';
import type { Resolved } from '../resolve';
import type { Value } from '../types';

function isQuantityValue(value: unknown): value is QuantityValue {
    return typeof value === 'object' && value !== null && 'canonical' in value && 'unit' in value;
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

function displayedMagnitude(value: QuantityValue): number {
    const scale = value.unit.scale * prefixScale(value.prefix);
    return (value.canonical - (value.unit.offset ?? 0)) / scale;
}

function asQuantity(
    magnitude: number,
    unit: UnitExpr,
    prefix?: UnitValue['prefix'],
): QuantityValue {
    return {
        canonical: magnitude * unit.scale * prefixScale(prefix) + (unit.offset ?? 0),
        unit,
        prefix,
    };
}

function defaultPolicy(unit: UnitExpr, prefix?: UnitValue['prefix']): AnswerSlotSpec {
    return {
        id: '',
        valueName: '',
        type: 'number',
        unitSystem: unit.namespace,
        unit,
        unitMode: 'expanded',
        display: 'atomic',
        prefix,
        prefixPolicy: 'any',
        allowedPrefixes: 'auto',
        precision: { kind: 'sigfigs', min: 3, max: 15 },
        notation: 'auto',
        unitOptional: false,
        tol: 0,
        relTol: 0,
    };
}

function formatQuantity(value: QuantityValue, policy?: AnswerSlotSpec, math = false): string {
    const base = policy ?? defaultPolicy(value.unit, value.prefix);
    return fmtQuantity(
        value.canonical,
        {
            ...base,
            unit: value.unit,
            prefix: value.prefix,
            unitLabel: undefined,
        },
        { math },
    );
}

function stringValue(value: Value): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return fmt(value);
    if (isQuantityValue(value)) return fmtQuantityValue(value);
    if (isUnitValue(value)) return describeUnitWithPrefix(value.unit, value.prefix);
    return '';
}

export interface DistractorCondition {
    valueText: (math: boolean) => string;
    expressionSource: (math: boolean) => string;
    expressionValueText: (math: boolean) => string;
}

export interface ConditionedDistractors {
    values: Record<string, Value>;
    conditions: Map<string, DistractorCondition>;
    warnings: Warning[];
}

/**
 * Convert linked distractor definitions to their anchor's data type/unit.
 * This is display-only: the shared parsed Question is never mutated.
 */
export function conditionDistractors(
    q: Question,
    resolved: Resolved,
): ConditionedDistractors {
    const values: Record<string, Value> = { ...resolved.values };
    const conditions = new Map<string, DistractorCondition>();
    const warnings: Warning[] = [];

    for (const link of q.distractorLinks ?? []) {
        const anchorValue = resolved.values[link.anchor];
        if (anchorValue === undefined) {
            warnings.push({
                section: 'distractors',
                message: `rv-distract: anchor "${link.anchor}" did not resolve for this draw`,
            });
            continue;
        }
        if (!q.answerValNames.includes(link.anchor)) {
            warnings.push({
                section: 'distractors',
                message:
                    `rv-distract: anchor "${link.anchor}" is not used by the current answer variant`,
            });
        }

        const anchorPolicy = q.answerSpec?.slots.find(
            (slot) => slot.valueName === link.anchor,
        );

        for (const target of link.targets) {
            const targetValue = resolved.values[target];
            if (targetValue === undefined) {
                warnings.push({
                    section: 'distractors',
                    message: `rv-distract: target "${target}" did not resolve for this draw`,
                });
                continue;
            }
            if (isUnitValue(targetValue)) {
                warnings.push({
                    section: 'distractors',
                    message: `rv-distract: unit target "${target}" cannot be conditioned`,
                });
                continue;
            }

            let converted: Value;
            let valueText: (math: boolean) => string;

            if (isQuantityValue(anchorValue)) {
                let magnitude: number;
                if (typeof targetValue === 'number') {
                    magnitude = targetValue;
                } else if (isQuantityValue(targetValue)) {
                    magnitude = displayedMagnitude(targetValue);
                } else {
                    warnings.push({
                        section: 'distractors',
                        message:
                            `rv-distract: string target "${target}" cannot be conditioned ` +
                            `by quantity anchor "${link.anchor}"`,
                    });
                    continue;
                }
                const qty = asQuantity(magnitude, anchorValue.unit, anchorValue.prefix);
                converted = qty;
                valueText = (math: boolean) => formatQuantity(qty, anchorPolicy, math);
            } else if (typeof anchorValue === 'number') {
                let numeric: number;
                if (typeof targetValue === 'number') numeric = targetValue;
                else if (isQuantityValue(targetValue)) numeric = displayedMagnitude(targetValue);
                else {
                    warnings.push({
                        section: 'distractors',
                        message:
                            `rv-distract: string target "${target}" cannot be conditioned ` +
                            `by numeric anchor "${link.anchor}"`,
                    });
                    continue;
                }
                converted = numeric;
                const text = fmt(numeric);
                valueText = () => text;
            } else if (typeof anchorValue === 'string') {
                converted = stringValue(targetValue);
                const text = converted;
                valueText = () => text;
            } else {
                warnings.push({
                    section: 'distractors',
                    message:
                        `rv-distract: anchor "${link.anchor}" is not a supported anchor type`,
                });
                continue;
            }

            const originalSource = resolved.sources[target];
            const sourceText =
                typeof originalSource === 'string'
                    ? originalSource
                    : originalSource === undefined
                      ? target
                      : stringValue(originalSource);
            const canonicalSource = (): string => {
                if (typeof originalSource !== 'string' || originalSource.includes('<<rv:')) {
                    return sourceText;
                }
                try {
                    return renderExpression(originalSource, { values: new Map() });
                } catch {
                    return sourceText;
                }
            };
            const expressionSource = (math: boolean): string => {
                const source = canonicalSource();
                if (!isQuantityValue(anchorValue)) return source;
                const unit = namedUnitFor(anchorValue.unit) ?? anchorValue.unit;
                const unitText = math
                    ? describeUnitLatex(unit, anchorValue.prefix)
                    : describeUnitWithPrefix(unit, anchorValue.prefix);
                if (unitText === '') return `(${source})`;
                return `(${source})${math ? '\\,' : ' '}${unitText}`;
            };

            conditions.set(target, {
                valueText,
                expressionSource,
                expressionValueText: valueText,
            });
            values[target] = converted;
        }
    }

    return { values, conditions, warnings };
}

/** Fill one free-text distractor block after applying conditioned values. */
export function fillConditionedDistractor(
    block: string,
    resolved: Resolved,
    conditioned: ConditionedDistractors,
    literal: boolean,
    formatted?: Record<string, FormattedValue>,
): string {
    if (literal) return block;

    let text = block.replace(
        /<<rv:expression:([^:>]+)(?::([^>]*))?>>/g,
        (match, rawName: string, args: string | undefined, offset: number) => {
            const condition = conditioned.conditions.get(rawName.trim());
            if (!condition) return match;
            const math = isInsideMath(block, offset);
            return args === undefined
                ? condition.expressionSource(math)
                : condition.expressionValueText(math);
        },
    );
    text = text.replace(
        /<<rv:(?:value|val|values):([^>]*?)>>/g,
        (match, rawName: string, offset: number) => {
            const condition = conditioned.conditions.get(rawName.trim());
            if (!condition) return match;
            return condition.valueText(isInsideMath(text, offset));
        },
    );
    return fillPlaceholders(
        text,
        conditioned.values,
        resolved.sources,
        resolved.displaySources,
        { formatted },
    );
}
