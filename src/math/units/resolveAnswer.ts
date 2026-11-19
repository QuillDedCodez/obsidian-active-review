/** Resolve an answer spec against one draw (Proposal 2 §5.3). */
import { dimEquals } from './dimensions';
import { fmtQuantity, resolveDisplay } from './format';
import { findPrefix, prefixScale } from './prefixes';
import type { AnswerSlotSpec, AnswerSpec, QuantityValue, ResolvedQuantityAnswer } from './types';

type Values = Record<string, unknown>;

function isQuantityValue(value: unknown): value is QuantityValue {
    return (
        typeof value === 'object' &&
        value !== null &&
        'canonical' in value &&
        'unit' in value
    );
}

/**
 * Substitute dynamic prefixes once per draw, so the display prefix may differ
 * between sessions.
 */
export function resolveSlotPolicy(slot: AnswerSlotSpec, values: Values): AnswerSlotSpec {
    let prefix = slot.prefix;
    if (slot.prefixRef !== undefined) {
        const raw = values[slot.prefixRef];
        if (typeof raw !== 'string') {
            throw new Error(`prefix "${slot.prefixRef}" did not resolve to a prefix`);
        }
        prefix = findPrefix(raw);
        if (prefix === undefined && raw.trim() !== '') {
            throw new Error(`prefix "${raw}" is not a known prefix`);
        }
    }

    let sourcePrefix = slot.sourcePrefix;
    if (slot.sourcePrefixRef !== undefined) {
        const raw = values[slot.sourcePrefixRef];
        if (typeof raw !== 'string') {
            throw new Error(`source-prefix "${slot.sourcePrefixRef}" did not resolve to a prefix`);
        }
        sourcePrefix = findPrefix(raw);
        if (sourcePrefix === undefined && raw.trim() !== '') {
            throw new Error(`source-prefix "${raw}" is not a known prefix`);
        }
    }

    if (prefix === slot.prefix && sourcePrefix === slot.sourcePrefix) return slot;
    return { ...slot, prefix, sourcePrefix };
}

export function resolveAnswer(spec: AnswerSpec, values: Values): ResolvedQuantityAnswer {
    const declared = spec.slots[0];
    if (!declared) throw new Error('rv-answer has no value binding');
    return resolveSlotAnswer(declared, values);
}

/** Resolve one slot; used by the prose path, which resolves each binding. */
export function resolveSlotAnswer(
    declared: AnswerSlotSpec,
    values: Values,
): ResolvedQuantityAnswer {
    const raw = values[declared.valueName];

    // A definition-produced quantity supplies its own unit and global prefix.
    if (isQuantityValue(raw)) {
        const abstractPrefix = raw.prefix !== undefined && raw.unit.namespace === 'abstract';
        const accepted = declared.acceptUnits;
        const hasAcceptedForDimension =
            accepted === undefined ||
            accepted.length === 0 ||
            accepted.some((unit) => dimEquals(unit.dim, raw.unit.dim));
        const policy: AnswerSlotSpec = {
            ...declared,
            unitSystem: raw.unit.namespace,
            unit: raw.unit,
            prefix: abstractPrefix ? undefined : raw.prefix,
            notation: abstractPrefix ? 'scientific' : declared.notation,
            unitMode: hasAcceptedForDimension ? declared.unitMode : 'expanded',
            acceptUnits: hasAcceptedForDimension ? accepted : undefined,
        };
        const display = resolveDisplay(raw.canonical, policy);
        return {
            canonical: raw.canonical,
            unit: raw.unit,
            policy,
            displayPrefix: display.prefix,
            displayScale: display.scale,
            text: fmtQuantity(raw.canonical, policy),
            numericValues: [raw.canonical],
        };
    }

    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new Error(
            `"${declared.valueName}" is not a finite number for the generated values`,
        );
    }

    const slot = resolveSlotPolicy(declared, values);
    const sourceUnit = slot.sourceUnit ?? slot.unit;
    const sourceScale = sourceUnit.scale * prefixScale(slot.sourcePrefix);
    const canonical = raw * sourceScale + (sourceUnit.offset ?? 0);
    const display = resolveDisplay(canonical, slot);

    return {
        canonical,
        unit: slot.unit,
        policy: slot,
        displayPrefix: display.prefix,
        displayScale: display.scale,
        text: fmtQuantity(canonical, slot),
        numericValues: [canonical],
    };
}
