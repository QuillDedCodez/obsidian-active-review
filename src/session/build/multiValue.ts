/**
 * Multi-value builder (Proposal 3).
 *
 * One `rv-answer` fence declares N value bindings; every `## ANSWERS` block is
 * one complete answer variant over those bindings. The correct choice uses one
 * complete variant; distractors reuse that same wording with changed values.
 */
import { fillPlaceholders, SECTIONS, type FormattedValue, type Question } from '../../parser';
import { fmtQuantity, resolveSlotAnswer } from '../../math/units';
import { buildMultiValueDistractors, gridCandidates } from '../distractors/multiValue';
import { renderVariantWith } from '../grading/multiValue';
import { drawAll } from '../draws';
import { shuffleSeeded } from '../rng';
import { describe, resolve, type Resolved } from '../resolve';
import type { Choice, ResolvedMultiValueAnswer, ResolvedSlot, SessionQuestion, Value } from '../types';

export function buildMultiValueQuestion(
    q: Question,
    drawsRng: () => number,
    optionsRng: () => number,
    variantRng: () => number,
    id: number,
    needed: number = 3,
): SessionQuestion {
    const spec = q.answerSpec;
    if (!spec) throw new Error('buildMultiValueQuestion requires an answerSpec');
    if (spec.variants.length === 0) throw new Error('rv-answer: this note has no answer variants');

    const randomDefs = q.vars.filter((d) => !d.fixed && d.kind !== 'display');
    let given: Record<string, Value> = {};
    let resolved: Resolved = { values: {}, sources: {}, displaySources: {} };
    let slots: ResolvedSlot[] | undefined;

    for (let tries = 0; tries < 50 && slots === undefined; tries++) {
        given = drawAll(randomDefs, q.links, drawsRng);
        try {
            const candidate = resolve(q.vars, given);
            const resolvedSlots = spec.slots.map((slotSpec) => {
                const answer = resolveSlotAnswer(slotSpec, candidate.values);
                return {
                    valueName: slotSpec.valueName,
                    canonical: answer.canonical,
                    text: answer.text,
                    displayScale: answer.displayScale,
                    policy: answer.policy,
                    numericValues: answer.numericValues,
                };
            });
            resolved = candidate;
            slots = resolvedSlots;
        } catch {
            slots = undefined;
        }
    }
    if (slots === undefined) {
        throw new Error('the answer is not a finite quantity set for the generated values');
    }

    const texts: Record<string, FormattedValue> = {};
    for (const slot of slots) {
        texts[slot.valueName] = (math: boolean) =>
            fmtQuantity(slot.canonical, slot.policy, { math });
    }

    const stemIndex = Math.floor(optionsRng() * q.variants.length);
    const text = fillPlaceholders(
        q.variants[stemIndex] ?? '',
        resolved.values,
        resolved.sources,
        resolved.displaySources,
        {
            formatted: texts,
            literal: q.literalSections.has(SECTIONS.QUESTIONS),
        },
    );

    // Dedicated stream: variant choice never shifts the option order of notes
    // that already exist.
    const variantIndex = Math.min(
        spec.variants.length - 1,
        Math.floor(variantRng() * spec.variants.length),
    );
    const chosen = spec.variants[variantIndex]!;
    const answersLiteral = q.literalSections.has(SECTIONS.ANSWERS);
    const correctText = answersLiteral ? chosen.raw : renderVariantWith(chosen, texts);

    const { distractors, warnings } = buildMultiValueDistractors(
        q,
        spec,
        chosen,
        given,
        resolved,
        slots,
        texts,
        optionsRng,
        needed,
    );

    const names = q.vars.map((d) => d.name);
    const choices = shuffleSeeded<Choice>(
        [
            { text: correctText, correct: true, note: describe(names, resolved.values) },
            ...distractors.map((distractor) => ({
                text:
                    distractor.fixedText ??
                    renderVariantWith(chosen, distractor.texts ?? {}),
                correct: false,
                note: distractor.note,
            })),
        ],
        optionsRng,
    );

    const vector = slots.map((slot) => slot.canonical);
    const variants = spec.variants.map((variant, index) => ({
        index,
        text: answersLiteral ? variant.raw : renderVariantWith(variant, texts),
        segments: variant.segments,
        vector,
    }));

    const answer: ResolvedMultiValueAnswer = {
        variants,
        correctVariantIndex: variantIndex,
        correctText,
        slots,
        vector,
    };

    const explanation = q.explanation
        ? fillPlaceholders(q.explanation, resolved.values, resolved.sources, resolved.displaySources, {
              formatted: texts,
              literal: q.literalSections.has(SECTIONS.EXPLANATIONS),
          })
        : undefined;

    return {
        q,
        id,
        text,
        variantIndex: stemIndex,
        values: resolved.values,
        sources: resolved.sources,
        choices,
        correctText,
        correctNumbers: vector,
        multiValue: answer,
        acceptedAnswers: variants.map((variant) => variant.text),
        explanation,
        buildWarnings: warnings,
    };
}

/** Re-exported for tests that need a single-slot grid. */
export { gridCandidates };
