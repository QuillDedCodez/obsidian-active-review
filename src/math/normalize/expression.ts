/**
 * Structural math comparison for typed answers (Proposal 3 §8.4).
 *
 * Parses both sides with the shared criterion parser, so ambiguity is rejected
 * exactly as it is for `rv-def`. This is grading-only: no AST ever reaches a
 * display field.
 */
import { astEquals, parseExpressionAst } from '../expressionCriterion';
import { normalizePresentation } from './answerText';

/**
 * True when the two inputs are the same mathematics with notation-only
 * differences (`\frac` vs `/`, `\cdot` vs `*`, redundant grouping, `x^{2}` vs
 * `x^2`). Algebraic equivalence is deliberately not implemented.
 */
export function expressionsEquivalent(a: string, b: string): boolean {
    const left = normalizePresentation(a);
    const right = normalizePresentation(b);
    if (left === right) return true;
    if (left === '' || right === '') return false;

    const parsedLeft = parseExpressionAst(left);
    const parsedRight = parseExpressionAst(right);
    if (parsedLeft.status !== 'valid' || parsedRight.status !== 'valid') return false;
    if (!parsedLeft.ast || !parsedRight.ast) return false;
    return astEquals(parsedLeft.ast, parsedRight.ast);
}
