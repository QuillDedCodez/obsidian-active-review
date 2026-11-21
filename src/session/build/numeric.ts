/**
 * Numeric-mode builder. Both `drawsRng` (variable draws) and `optionsRng`
 * (option order + distractors) are derived from the session seed for full
 * reproducibility.
 */
import { fmt } from '../../math';
import { fillPlaceholders, SECTIONS, type Question } from '../../parser';
import { normaliseAnswerText } from '../../math/normalize';
import { buildNumericDistractors } from '../distractors/numeric';
import { drawAll } from '../draws';
import { shuffleSeeded } from '../rng';
import { computeAnswer, describe, resolve, type Resolved } from '../resolve';
import type { Choice, SessionQuestion, Value } from '../types';

export function buildNumericQuestion(
    q: Question,
    drawsRng: () => number,
    optionsRng: () => number,
    id: number,
    needed: number = 3,
): SessionQuestion {
    const randomDefs = q.vars.filter((d) => !d.fixed && d.kind !== 'display');
    let given: Record<string, Value> = {};
    let resolved: Resolved = { values: {}, sources: {}, displaySources: {} };
    let correct = NaN;
    let lastError: Error | undefined;

    for (let tries = 0; tries < 50 && !Number.isFinite(correct); tries++) {
        given = drawAll(randomDefs, q.links, drawsRng);
        try {
            resolved = resolve(q.vars, given);
            correct = computeAnswer(q, resolved.values);
        } catch (e) {
            correct = NaN;
            lastError = e instanceof Error ? e : new Error(String(e));
        }
    }
    if (!Number.isFinite(correct)) {
        const detail = lastError?.message ? ` — ${lastError.message}` : '';
        throw new Error(`the answer is not a finite number for the generated values${detail}`);
    }

    const correctNumbers: number[] = [];
    for (const name of q.answerValNames) {
        const v = resolved.values[name];
        if (typeof v === 'number' && Number.isFinite(v)) correctNumbers.push(v);
    }
    if (correctNumbers.length === 0) correctNumbers.push(correct);

    const literalDistractors =
        q.literalSections.has(SECTIONS.DISTRACTORS) && q.distractorBlocks.length > 0;
    const { distractors, warnings: distractorWarnings } = literalDistractors
        ? { distractors: [], warnings: [] }
        : buildNumericDistractors(q, given, resolved, correctNumbers, optionsRng, needed);

    const fill = (s: string, section: string): string =>
        fillPlaceholders(s, resolved.values, resolved.sources, resolved.displaySources, {
            literal: q.literalSections.has(section),
        });

    const variantIndex = Math.floor(optionsRng() * q.variants.length);
    const text = fill(q.variants[variantIndex] ?? '', SECTIONS.QUESTIONS);
    const form = q.numericAnswerBlocks?.[0] ?? q.answerBlocks[0];
    const correctText =
        form !== undefined ? fill(form, SECTIONS.ANSWERS) : fmt(correct);
    const acceptedAnswers = q.answerBlocks
        .map((block) => normaliseAnswerText(fill(block, SECTIONS.ANSWERS)))
        .filter((block) => block !== '');
    const explanation = q.explanation
        ? fill(q.explanation, SECTIONS.EXPLANATIONS)
        : undefined;

    const answersLiteral = q.literalSections.has(SECTIONS.ANSWERS);
    const names = q.vars.map((d) => d.name);
    const choices = shuffleSeeded<Choice>(
        [
            { text: correctText, correct: true, note: describe(names, resolved.values) },
            ...(literalDistractors
                ? q.distractorBlocks.slice(0, Math.max(0, needed)).map((block) => ({
                      text: fill(block, SECTIONS.DISTRACTORS),
                      correct: false,
                      note: '',
                  }))
                : distractors.map((f) => ({
                      text: renderNumericChoice(form, resolved, q.answerName, f.value, answersLiteral),
                      correct: false,
                      note: f.note,
                  }))),
        ],
        optionsRng,
    );

    return {
        q,
        id,
        text,
        variantIndex,
        values: resolved.values,
        sources: resolved.sources,
        choices,
        correctText,
        correctNumbers,
        acceptedAnswers,
        explanation,
        buildWarnings: distractorWarnings,
    };
}

/** Reuse the first numeric answer block as the display template for a distractor. */
function renderNumericChoice(
    template: string | undefined,
    resolved: Resolved,
    answerName: string,
    value: number,
    literalAnswers: boolean,
): string {
    // In literal mode the template is placeholder source, so an option cannot be
    // built from it; show the bare numeric value instead.
    if (literalAnswers || !template || !answerName) return fmt(value);
    const token = new RegExp(
        `<<rv:(?:val|values):${answerName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}>>`,
    );
    if (!token.test(template)) return fmt(value);
    const values = { ...resolved.values, [answerName]: value };
    return fillPlaceholders(
        template,
        values,
        resolved.sources,
        resolved.displaySources,
    );
}