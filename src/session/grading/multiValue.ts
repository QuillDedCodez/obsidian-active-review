/**
 * Multi-value grading (Proposal 3 §7–9).
 *
 * Two accepted shapes:
 *   - `values`: one part per binding, separated by `sep`, in binding order;
 *   - `prose`:  the full variant sentence, matched against literal anchors.
 *
 * Normalization is used only here. Display text is never normalized.
 */
import { gradeQuantity, type AnswerVariantSpec } from '../../math/units';
import { mathStateAfter } from '../../math/latex';
import { normalizeForMatch, normalizeLiteral } from '../../math/normalize';
import type { FormattedValue } from '../../parser';
import type { ResolvedMultiValueAnswer, ResolvedSlot, ResolvedVariant } from '../types';

// ============================================================================
// Variant rendering (was session/variantText.ts)
// ============================================================================

export function renderVariant(
    variant: AnswerVariantSpec,
    textOf: (valueName: string, math: boolean) => string,
    startMath = false,
): string {
    let math = startMath;
    let out = '';
    for (const segment of variant.segments) {
        if (segment.kind === 'literal') {
            out += segment.text;
            math = mathStateAfter(segment.text, math);
        } else {
            out += textOf(segment.valueName, math);
        }
    }
    return out.trim();
}

/** Render with a full text map; unknown names render as empty. */
export function renderVariantWith(
    variant: AnswerVariantSpec,
    texts: Record<string, FormattedValue>,
    startMath = false,
): string {
    return renderVariant(
        variant,
        (name, math) => {
            const value = texts[name];
            if (value === undefined) return '';
            return typeof value === 'function' ? value(math) : value;
        },
        startMath,
    );
}

// ============================================================================
// Grading
// ============================================================================

export interface GradeMultiValueResult {
    correct: boolean;
    reason?: string;
}

const OPEN = '([{';
const CLOSE = ')]}';

/**
 * Split on a separator that is not inside brackets. A comma between digits is a
 * thousands separator, not a value separator.
 */
export function splitTopLevel(input: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    let i = 0;

    while (i < input.length) {
        const ch = input[i]!;
        if (OPEN.includes(ch)) depth++;
        else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);

        if (depth === 0 && sep !== '' && input.startsWith(sep, i)) {
            const previous = i > 0 ? input[i - 1]! : '';
            const next = input[i + sep.length] ?? '';
            const thousandsSeparator = sep === ',' && /[0-9]/.test(previous) && /[0-9]/.test(next);
            if (!thousandsSeparator) {
                parts.push(current);
                current = '';
                i += sep.length;
                continue;
            }
        }
        current += ch;
        i++;
    }
    parts.push(current);
    return parts.map((part) => part.trim());
}

/** Grade one value part against one resolved slot. */
export function matchValue(part: string, slot: ResolvedSlot): boolean {
    const trimmed = part.trim().replace(/^[.;:!?]+|[.;:!?]+$/g, '');
    if (trimmed === '') return false;
    return gradeQuantity(
        {
            canonical: slot.canonical,
            displayScale: slot.displayScale,
            policy: slot.policy,
        },
        trimmed,
    );
}

function nextAnchor(variant: ResolvedVariant, from: number): string | null {
    for (let i = from + 1; i < variant.segments.length; i++) {
        const segment = variant.segments[i]!;
        if (segment.kind !== 'literal') continue;
        const anchor = normalizeLiteral(segment.text);
        if (anchor !== '') return anchor;
    }
    return null;
}

/**
 * Match a typed sentence against one variant.
 *
 * Literal text is matched case-insensitively after presentation normalization;
 * each value position is graded with that slot's own policy on a case-preserved
 * slice (units such as `V` and `S` are case-sensitive). A repeated placeholder
 * is graded against the same value every time.
 */
export function matchVariant(
    input: string,
    variant: ResolvedVariant,
    slots: ResolvedSlot[],
): boolean {
    const norm = normalizeForMatch(input);
    const lower = norm.toLowerCase();
    let pos = 0;

    for (let i = 0; i < variant.segments.length; i++) {
        const segment = variant.segments[i]!;

        if (segment.kind === 'literal') {
            const anchor = normalizeLiteral(segment.text);
            if (anchor === '') continue;
            const idx = lower.indexOf(anchor, pos);
            if (idx < 0) return false;
            pos = idx + anchor.length;
            continue;
        }

        const slot = slots.find((candidate) => candidate.valueName === segment.valueName);
        if (!slot) return false;

        const anchor = nextAnchor(variant, i);
        const end = anchor === null ? norm.length : lower.indexOf(anchor, pos);
        if (end < 0) return false;

        const part = norm.slice(pos, end);
        if (!matchValue(part, slot)) return false;
        pos = end;
    }

    return true;
}

/** `typed-mode = values`: exactly one part per binding, in binding order. */
export function gradeValues(input: string, slots: ResolvedSlot[], sep: string): boolean {
    const parts = splitTopLevel(input, sep);
    if (parts.length !== slots.length) return false;
    return parts.every((part, index) => matchValue(part, slots[index]!));
}

/**
 * Grade a typed answer against the resolved multi-value answer.
 *
 * `either` tries prose first and then the values form, so omitting labels or
 * punctuation does not punish a correct value set.
 */
export function gradeMultiValue(
    answer: ResolvedMultiValueAnswer,
    typed: string,
    typedMode: 'values' | 'prose' | 'either',
    sep: string,
): GradeMultiValueResult {
    const input = typed.trim();
    if (input === '') return { correct: false };

    const tryProse = (): boolean =>
        answer.variants.some((variant) => matchVariant(input, variant, answer.slots));

    if (typedMode === 'prose') {
        return tryProse()
            ? { correct: true }
            : { correct: false, reason: 'Did not match any complete answer variant.' };
    }

    if (typedMode === 'values') {
        return gradeValues(input, answer.slots, sep)
            ? { correct: true }
            : { correct: false, reason: 'Expected one value per answer, in the declared order.' };
    }

    if (tryProse()) return { correct: true };
    if (gradeValues(input, answer.slots, sep)) return { correct: true };
    return { correct: false, reason: 'Did not match any complete answer variant.' };
}

