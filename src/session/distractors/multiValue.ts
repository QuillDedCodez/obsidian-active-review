/**
 * Multi-value distractors (Proposal 3 §10).
 *
 * One strategy per note:
 *   - `variable`  perturb a definition, recompute every value (keeps coupling);
 *   - `one-value` change exactly one value, for author-declared independence;
 *   - `author`    use the `## DISTRACTORS` blocks as final text.
 *
 * Candidates are deduplicated by rendered text and by canonical vector.
 */
import { SECTIONS, type FormattedValue, type Question, type VarDef, type Warning } from '../../parser';
import { conditionDistractors, fillConditionedDistractor } from './condition';
import {
    compoundStep,
    displayValue,
    fmtQuantity,
    precisionStep,
    quantityTolerance,
    resolveLayout,
    resolveSlotAnswer,
    roundSig,
    truncateSig,
    type AnswerSpec,
    type AnswerVariantSpec,
} from '../../math/units';
import { describe, resolve } from '../resolve';
import { drawableAlternatives } from '../draws';
import { shuffleSeeded } from '../rng';
import { renderVariantWith } from '../grading/multiValue';
import type { Resolved } from '../resolve';
import type { ResolvedSlot, Value } from '../types';

export interface MultiValueDistractor {
    /** Final text for author-supplied distractors. */
    fixedText?: string;
    /** Formatted value text per binding, for template rendering. */
    texts?: Record<string, FormattedValue>;
    vector?: number[];
    note: string;
    source: 'variable' | 'one-value' | 'author';
}

export interface BuildMultiValueDistractorsResult {
    distractors: MultiValueDistractor[];
    warnings: Warning[];
}

function isDrawable(def: VarDef): boolean {
    return (
        def.kind === 'rand' ||
        def.kind === 'pick' ||
        def.kind === 'stringPick' ||
        def.kind === 'exprPick' ||
        def.kind === 'unit' ||
        def.kind === 'prefix' ||
        def.kind === 'quantityPick'
    );
}

function perturbable(q: Question, answerNames: string[]): VarDef[] {
    const byName = new Map(q.vars.map((def) => [def.name, def]));
    const reached = new Set<string>();
    const visit = (name: string): void => {
        if (reached.has(name)) return;
        reached.add(name);
        const def = byName.get(name);
        if (!def) return;
        for (const dependency of def.dependencies ?? []) visit(dependency);
    };
    for (const name of answerNames) visit(name);
    return q.vars.filter((def) => reached.has(def.name) && isDrawable(def));
}

/** Format one canonical value through its own slot policy. */
function slotText(canonical: number, slot: ResolvedSlot): FormattedValue {
    return (math: boolean) => fmtQuantity(canonical, slot.policy, { math });
}

/** Single-slot deviation candidates around the correct display value. */
export function gridCandidates(slot: ResolvedSlot): number[] {
    const compound = slot.policy.components !== undefined && slot.policy.components.length > 0;
    const layout = compound ? null : resolveLayout(slot.canonical, slot.policy);
    const scale = compound ? 1 : layout!.display.scale;
    const offset = compound ? 0 : (layout!.display.unit.offset ?? 0);
    const shown = compound ? slot.canonical : displayValue(slot.canonical, slot.policy);
    const precision = slot.policy.precision;
    const zeroTol = slot.policy.tol / scale;
    const grid = precision
        ? compound
            ? compoundStep(slot.policy, precision.kind === 'decimals' ? precision.max : 0)
            : precisionStep(shown, precision, zeroTol, layout!.exponent)
        : compound
          ? slot.policy.tol
          : zeroTol;
    const snap = (x: number): number =>
        Number.isFinite(grid) && grid > 0 ? Math.round(x / grid) * grid : x;

    const raw: number[] = [];
    for (const k of [1, 2, 3, 5, 10]) raw.push(shown + k * grid, shown - k * grid);
    for (const r of [0.01, 0.02, 0.05, 0.1, 0.2]) {
        raw.push(snap(shown * (1 + r)), snap(shown * (1 - r)));
    }
    for (const m of [-3, -2, -1, 1, 2, 3]) raw.push(snap(shown * Math.pow(10, m)));
    if (precision?.kind === 'sigfigs') {
        raw.push(
            roundSig(shown, Math.max(1, precision.min - 1)),
            truncateSig(shown, precision.min),
        );
    } else if (precision?.kind === 'decimals' && !compound) {
        const factor = Math.pow(10, precision.max);
        raw.push(Math.round(shown * factor) / factor, Math.trunc(shown * factor) / factor);
    }
    raw.push(-shown);
    return raw.filter((value) => Number.isFinite(value)).map((value) => value * scale + offset);
}

function vectorDiffers(a: number[], b: number[], tolerances: number[]): boolean {
    return a.some(
        (value, index) =>
            Math.abs(value - (b[index] ?? 0)) > (tolerances[index] ?? 0),
    );
}

export function buildMultiValueDistractors(
    q: Question,
    spec: AnswerSpec,
    variant: AnswerVariantSpec,
    given: Record<string, Value>,
    resolved: Resolved,
    slots: ResolvedSlot[],
    answerTexts: Record<string, FormattedValue>,
    rng: () => number,
    needed: number = 3,
): BuildMultiValueDistractorsResult {
    const warnings: Warning[] = [];
    const conditioned = conditionDistractors(q, resolved);
    warnings.push(...conditioned.warnings);
    const found: MultiValueDistractor[] = [];
    const correctVector = slots.map((slot) => slot.canonical);
    const tolerances = slots.map(
        (slot) => quantityTolerance(slot.canonical, slot.policy).canonicalStep,
    );
    const takenTexts = new Set<string>([renderVariantWith(variant, answerTexts)]);
    const takenVectors: number[][] = [correctVector];

    const push = (candidate: MultiValueDistractor): void => {
        if (found.length >= needed) return;
        if (candidate.fixedText !== undefined) {
            const text = candidate.fixedText.trim();
            if (text === '' || takenTexts.has(text)) return;
            takenTexts.add(text);
            found.push(candidate);
            return;
        }
        if (!candidate.texts || !candidate.vector) return;
        if (takenVectors.some((vector) => !vectorDiffers(vector, candidate.vector!, tolerances))) {
            return;
        }
        const text = renderVariantWith(variant, candidate.texts);
        if (takenTexts.has(text)) return;
        takenTexts.add(text);
        takenVectors.push(candidate.vector);
        found.push(candidate);
    };

    const textsFor = (canonicals: number[]): Record<string, FormattedValue> => {
        const texts: Record<string, FormattedValue> = {};
        slots.forEach((slot, index) => {
            texts[slot.valueName] = slotText(canonicals[index]!, slot);
        });
        return texts;
    };

    /** Resolve every slot for a perturbed draw, recomputing derived values. */
    const slotsFor = (givenValues: Record<string, Value>): ResolvedSlot[] | null => {
        try {
            const nextResolved = resolve(q.vars, givenValues);
            return spec.slots.map((slotSpec) => {
                const answer = resolveSlotAnswer(slotSpec, nextResolved.values);
                return {
                    valueName: slotSpec.valueName,
                    canonical: answer.canonical,
                    text: answer.text,
                    displayScale: answer.displayScale,
                    policy: answer.policy,
                    numericValues: answer.numericValues,
                };
            });
        } catch {
            return null;
        }
    };

    if (spec.distractorStrategy === 'author') {
        for (const block of q.distractorBlocks) {
            if (found.length >= needed) break;
            const text = fillConditionedDistractor(
                block.trim(),
                resolved,
                conditioned,
                q.literalSections.has(SECTIONS.DISTRACTORS),
                answerTexts,
            ).trim();
            if (text === '') continue;
            push({ fixedText: text, note: 'author-supplied', source: 'author' });
        }
    } else if (spec.distractorStrategy === 'one-value') {
        for (const [index, slot] of slots.entries()) {
            if (found.length >= needed) break;
            for (const candidate of shuffleSeeded(gridCandidates(slot), rng)) {
                if (found.length >= needed) break;
                const canonicals = correctVector.slice();
                canonicals[index] = candidate;
                push({
                    texts: textsFor(canonicals),
                    vector: canonicals,
                    note: describe([slot.valueName], { [slot.valueName]: candidate }),
                    source: 'one-value',
                });
            }
        }
    } else {
        // `variable`: recompute every value from one changed definition.
        const pool = perturbable(q, slots.map((slot) => slot.valueName));
        for (const def of shuffleSeeded([...pool], rng)) {
            if (found.length >= needed) break;
            const candidates: Value[] = shuffleSeeded(drawableAlternatives(def, rng), rng);
            for (const value of candidates) {
                if (found.length >= needed) break;
                if (value === given[def.name]) continue;
                const next = slotsFor({ ...given, [def.name]: value });
                if (!next) continue;
                const vector = next.map((slot) => slot.canonical);
                if (!vectorDiffers(vector, correctVector, tolerances)) continue;
                const texts: Record<string, FormattedValue> = {};
                next.forEach((slot) => (texts[slot.valueName] = slotText(slot.canonical, slot)));
                push({
                    texts,
                    vector,
                    note: describe([def.name], { ...resolved.values, [def.name]: value }),
                    source: 'variable',
                });
            }
        }

    }

    // Fallback 1: author-supplied blocks.
    if (found.length < needed) {
        for (const block of q.distractorBlocks) {
            if (found.length >= needed) break;
            const text = fillConditionedDistractor(
                block.trim(),
                resolved,
                conditioned,
                q.literalSections.has(SECTIONS.DISTRACTORS),
                answerTexts,
            ).trim();
            if (text === '') continue;
            push({ fixedText: text, note: 'author-supplied', source: 'author' });
        }
    }

    // Fallback 2: single-value display-grid deviations.
    if (found.length < needed) {
        for (const [index, slot] of slots.entries()) {
            if (found.length >= needed) break;
            for (const candidate of shuffleSeeded(gridCandidates(slot), rng)) {
                if (found.length >= needed) break;
                const canonicals = correctVector.slice();
                canonicals[index] = candidate;
                push({
                    texts: textsFor(canonicals),
                    vector: canonicals,
                    note: describe([slot.valueName], { [slot.valueName]: candidate }),
                    source: 'one-value',
                });
            }
        }
    }

    if (found.length < needed) {
        warnings.push({
            section: 'distractors',
            message: `only ${found.length} of ${needed} required distractors produced — MCQ will show fewer choices or fall back to typed mode`,
        });
    }

    return { distractors: found, warnings };
}
