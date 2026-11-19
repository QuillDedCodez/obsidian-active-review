/**
 * SessionQuestion builders, selected by the parser's normalized answer shape.
 *
 * Each builder handles both static and generated questions; the split is the
 * answer shape, not whether definitions are present.
 */
import { clampChoiceCount, DEFAULT_SESSION_CONFIG } from '../../constants';
import type { Question } from '../../parser';
import type { SessionQuestion } from '../types';
import { buildMultiValueQuestion } from './multiValue';
import { buildNumericQuestion } from './numeric';
import { buildQuantityQuestion } from './quantity';
import { buildTextQuestion } from './text';

export {
    buildMultiValueQuestion,
    buildNumericQuestion,
    buildQuantityQuestion,
    buildTextQuestion,
};

/**
 * Build one playable question from a parsed note.
 *
 * The parser labels a multi-slot `rv-answer` as `kind: 'prose'`; that shape is
 * multi-value. "Prose" as a typed mode is handled inside multi-value grading.
 */
export function buildQuestion(
    q: Question,
    drawsRng: () => number,
    optionsRng: () => number,
    variantRng: () => number,
    id: number,
    choiceCount: number = DEFAULT_SESSION_CONFIG.choiceCount,
): SessionQuestion {
    const needed = clampChoiceCount(choiceCount) - 1;
    if (q.answerSpec?.kind === 'prose') {
        return buildMultiValueQuestion(q, drawsRng, optionsRng, variantRng, id, needed);
    }
    if (q.answerSpec) {
        return buildQuantityQuestion(q, drawsRng, optionsRng, variantRng, id, needed);
    }
    if (q.answerMode === 'numeric') {
        return buildNumericQuestion(q, drawsRng, optionsRng, id, needed);
    }
    return buildTextQuestion(q, drawsRng, optionsRng, id, needed);
}
