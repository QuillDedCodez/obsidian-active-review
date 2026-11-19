/**
 * Score one answer.
 *
 * Numeric mode: user input parsed as a number; matches **any** accepted
 * numeric value within TOLERANCE (B28 — multi-block answers), then falls back
 * to accepted display variants such as "42 J".
 *
 * Text mode: user input whitespace-normalised (collapse runs, trim ends) and
 * compared case-insensitively against **any** accepted answer (B34).
 */
import { TOLERANCE } from '../../constants';
import { gradeQuantity } from '../../math/units';
import { normaliseAnswerText } from '../../math/normalize';
import { gradeMultiValue } from './multiValue';
import { matchAcceptedText } from './text';
import type { SessionQuestion } from '../types';

export const hasChoices = (sq: SessionQuestion): boolean => sq.choices.length >= 2;

export function grade(sq: SessionQuestion, input: { choice?: number; typed?: string }): boolean {
    if (input.choice !== undefined) return sq.choices[input.choice]?.correct === true;
    const typed = input.typed ?? '';

    // Multi-value path — variant matching, then the values form.
    if (sq.multiValue !== undefined) {
        const spec = sq.q.answerSpec;
        return gradeMultiValue(sq.multiValue, typed, spec?.typedMode ?? 'either', spec?.sep ?? ',').correct;
    }

    // Quantity path — unit-aware comparison, never the text fallback.
    if (sq.answer !== undefined) {
        if (gradeQuantity(sq.answer, typed)) return true;
        // Extra accepted spellings (and math-equivalent text) for accepted blocks.
        const accepted = (sq.acceptedAnswers ?? []).filter((text) => text !== '');
        return accepted.length > 0 && matchAcceptedText(typed, accepted);
    }

    // Numeric mode — correctNumbers is authoritative.
    const numericAnswers = sq.correctNumbers;
    if (numericAnswers !== undefined) {
        const trimmed = typed.trim();
        if (trimmed === '') return false;
        const n = Number(trimmed);
        if (Number.isFinite(n) && numericAnswers.some((c) => Math.abs(n - c) <= TOLERANCE)) {
            return true;
        }
        // Fall through: an accepted unit/form variant may match literally.
    }

    // Text mode — whitespace-normalised, case-insensitive match.
    const normalised = normaliseAnswerText(typed).toLowerCase();
    const accepted = (sq.acceptedAnswers ?? []).map((a) =>
        normaliseAnswerText(a).toLowerCase(),
    );
    return accepted.some((a) => a === normalised);
}