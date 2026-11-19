/** normalize: answer-text and expression normalization for grading. This file is the folder's public API. */
export {
    expandUnicodeSuperscripts,
    foldSeparators,
    normalizeForMatch,
    normalizeLiteral,
    normalizePresentation,
    normaliseAnswerText,
} from './answerText';
export { expressionsEquivalent } from './expression';
