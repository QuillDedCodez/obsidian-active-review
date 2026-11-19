/**
 * Normalized text acceptance used by the numeric, quantity, and text paths:
 * literal equality, then structural math equivalence. Both are grading-only.
 */
import { expressionsEquivalent, normalizeLiteral } from '../../math/normalize';

export function matchAcceptedText(typed: string, accepted: string[]): boolean {
    const normalized = normalizeLiteral(typed);
    for (const candidate of accepted) {
        if (normalized === normalizeLiteral(candidate)) return true;
        if (expressionsEquivalent(typed, candidate)) return true;
    }
    return false;
}
