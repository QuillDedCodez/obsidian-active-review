/**
 * Text-mode builder. `drawsRng` seeds variable draws; `optionsRng` seeds
 * choice ordering and distractor subset selection.
 */
import { fillPlaceholders, SECTIONS, type Question } from '../../parser';
import { normaliseAnswerText } from '../../math/normalize';
import { drawAll } from '../draws';
import { shuffleSeeded } from '../rng';
import { resolve, type Resolved } from '../resolve';
import type { Choice, SessionQuestion } from '../types';

export function buildTextQuestion(
    q: Question,
    drawsRng: () => number,
    optionsRng: () => number,
    id: number,
    needed: number = 3,
): SessionQuestion {
    let resolved: Resolved = { values: {}, sources: {}, displaySources: {} };

    if (q.vars.length > 0) {
        const randomDefs = q.vars.filter((d) => !d.fixed && d.kind !== 'display');
        let ok = false;
        for (let tries = 0; tries < 50 && !ok; tries++) {
            const given = drawAll(randomDefs, q.links, drawsRng);
            try {
                resolved = resolve(q.vars, given);
                ok = true;
            } catch {
                // retry
            }
        }
        if (!ok) {
            throw new Error('could not resolve variables for this draw — try rescanning');
        }
    }

    const fill = (s: string, section: string): string =>
        fillPlaceholders(s, resolved.values, resolved.sources, resolved.displaySources, {
            literal: q.literalSections.has(section),
        });

    const variantIndex = Math.floor(optionsRng() * q.variants.length);
    const text = fill(q.variants[variantIndex] ?? '', SECTIONS.QUESTIONS);

    const correctIndex = Math.floor(optionsRng() * q.answerBlocks.length);
    const correctBlock = q.answerBlocks[correctIndex] ?? '';
    const correctText = fill(correctBlock, SECTIONS.ANSWERS);

    const acceptedAnswers = q.answerBlocks.map((b) =>
        normaliseAnswerText(fill(b, SECTIONS.ANSWERS)),
    );

    const picked = shuffleSeeded(q.distractorBlocks, optionsRng).slice(
        0,
        Math.max(0, needed),
    );
    const choices = shuffleSeeded<Choice>(
        [
            { text: correctText, correct: true, note: '' },
            ...picked.map((b) => ({
                text: fill(b, SECTIONS.DISTRACTORS),
                correct: false,
                note: '',
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
        acceptedAnswers,
        explanation,
    };
}