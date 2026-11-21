/**
 * Quantity-mode builder (Proposal 2). One numeric value bound to a unit, prefix,
 * notation, and sig-fig policy. Both RNG streams are derived from the session
 * seed, so the same seed reproduces the same answer and choices.
 */
import {
    extractPlaceholders,
    fillPlaceholders,
    SECTIONS,
    type FormattedValue,
    type Question,
    type Warning,
} from '../../parser';
import { fmtQuantity, resolveAnswer, type ResolvedQuantityAnswer } from '../../math/units';
import { buildQuantityDistractors, distractorText } from '../distractors/quantity';
import { drawAll } from '../draws';
import { shuffleSeeded } from '../rng';
import { describe, resolve, type Resolved } from '../resolve';
import type { Choice, SessionQuestion, Value } from '../types';

export function buildQuantityQuestion(
    q: Question,
    drawsRng: () => number,
    optionsRng: () => number,
    variantRng: () => number,
    id: number,
    needed: number = 3,
): SessionQuestion {
    const spec = q.answerSpec;
    if (!spec) throw new Error('buildQuantityQuestion requires an answerSpec');
    const slot = spec.slots[0];
    if (!slot) throw new Error('rv-answer has no value binding');

    const randomDefs = q.vars.filter((d) => !d.fixed && d.kind !== 'display');
    let given: Record<string, Value> = {};
    let resolved: Resolved = { values: {}, sources: {}, displaySources: {} };
    let answer: ResolvedQuantityAnswer | undefined;
    let lastError: Error | undefined;

    for (let tries = 0; tries < 50 && answer === undefined; tries++) {
        given = drawAll(randomDefs, q.links, drawsRng);
        try {
            resolved = resolve(q.vars, given);
            answer = resolveAnswer(spec, resolved.values);
        } catch (e) {
            answer = undefined;
            lastError = e instanceof Error ? e : new Error(String(e));
        }
    }
    if (answer === undefined) {
        const detail = lastError?.message ? ` — ${lastError.message}` : '';
        throw new Error(`the answer is not a finite quantity for the generated values${detail}`);
    }

    // The bound value renders as its formatted quantity in every section, so
    // `<<rv:val:name>>` and `<<rv:value:name>>` agree here by construction.
    const formatted: Record<string, FormattedValue> = {
        [slot.valueName]: (math: boolean) => fmtQuantity(answer.canonical, answer.policy, { math }),
    };
    const fill = (s: string, section: string): string =>
        fillPlaceholders(s, resolved.values, resolved.sources, resolved.displaySources, {
            formatted,
            literal: q.literalSections.has(section),
        });

    const answersLiteral = q.literalSections.has(SECTIONS.ANSWERS);
    const buildWarnings: Warning[] = [];
    const variantCount = Math.max(1, q.answerBlocks.length);
    const answerVariantIndex = Math.min(
        variantCount - 1,
        Math.floor(variantRng() * variantCount),
    );
    let correctText = answer.text;
    const template = q.answerBlocks[answerVariantIndex] ?? q.answerBlocks[0];
    if (template !== undefined && answersLiteral) {
        if (template.trim() !== '') correctText = template;
    } else if (template !== undefined) {
        const hasBound = extractPlaceholders(template).some(
            (ref) => ref.kind === 'val' && ref.name === slot.valueName,
        );
        if (hasBound) {
            correctText = fill(template, SECTIONS.ANSWERS);
        } else if (template.trim() !== '') {
            buildWarnings.push({
                section: 'answers',
                message:
                    `## ANSWERS block 1 has no <<rv:val:${slot.valueName}>> — ` +
                    'using the formatted quantity as the correct answer',
            });
        }
    }

    const variantIndex = Math.floor(optionsRng() * q.variants.length);
    const text = fill(q.variants[variantIndex] ?? '', SECTIONS.QUESTIONS);

    const { distractors, warnings } = buildQuantityDistractors(
        q,
        given,
        resolved,
        answer,
        optionsRng,
        needed,
    );

    const names = q.vars.map((d) => d.name);
    const choices = shuffleSeeded<Choice>(
        [
            { text: correctText, correct: true, note: describe(names, resolved.values) },
            ...distractors.map((d) => ({
                text: distractorText(d, answer.policy),
                correct: false,
                note: d.note,
            })),
        ],
        optionsRng,
    );

    const explanation = q.explanation
        ? fill(q.explanation, SECTIONS.EXPLANATIONS)
        : undefined;

    return {
        q,
        id,
        text,
        variantIndex,
        values: resolved.values,
        sources: resolved.sources,
        choices,
        correctText,
        correctNumbers: [answer.canonical],
        answer,
        acceptedAnswers: q.answerBlocks
            .map((block) => fill(block, SECTIONS.ANSWERS))
            .filter((text) => text !== ''),
        explanation,
        buildWarnings: [...warnings, ...buildWarnings],
    };
}
