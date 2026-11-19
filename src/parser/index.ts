/** parser: quiz-note text → Question objects. This file is the folder's public API. */
export { parseQuestionNote } from './parseNote';
export { isQuizPath } from './paths';
export { SECTIONS, type SectionName } from './sections';
export { fillPlaceholders, extractPlaceholders, type PlaceholderRef, type FillOptions, type FormattedValue } from './placeholders';
export { parseAnswerSpec, AnswerSpecError, type ParsedAnswerSpec } from './answers';
export { DefinitionExpressionError } from './definitions';
export { effectiveCount, isFlipped, linkName, parseVars, validateLinks } from './definitions';
export { extractFolderCategory, extractDeclaredCategory, resolveCategory } from './properties';
export type {
    Question,
    VarDef,
    CategorySource,
    Warning,
    WarningSection,
    UnitValue,
} from './types';
