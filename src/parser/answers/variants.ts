/**
 * Answer variants (Proposal 3 §4.4–5).
 *
 * Every non-empty `## ANSWERS` block is one complete answer. Variants are
 * opt-in: they only exist for notes that carry an `rv-answer` fence.
 */
import type { AnswerVariantSpec, TemplateSegment } from '../../math/units';
import type { Warning } from '../types';

export class VariantError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VariantError';
    }
}

const VALUE_TOKEN = /<<rv:(?:value|val|values):([^>]*?)>>/g;

/** Split one block into literal and value segments. */
export function parseVariant(raw: string): AnswerVariantSpec {
    const segments: TemplateSegment[] = [];
    const required: string[] = [];
    let literalText = '';

    let lastIndex = 0;
    VALUE_TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VALUE_TOKEN.exec(raw)) !== null) {
        const name = (match[1] ?? '').trim();
        if (name === '') throw new VariantError('empty <<rv:value:…>> name in an answer block');

        const before = raw.slice(lastIndex, match.index);
        if (before !== '') {
            segments.push({ kind: 'literal', text: before });
            literalText += before;
        }
        const previous = segments[segments.length - 1];
        if (previous?.kind === 'value') {
            throw new VariantError(
                `two value placeholders are adjacent in an answer block ` +
                    `("${previous.valueName}" and "${name}"); add literal text between them so the ` +
                    'grader knows where each value starts',
            );
        }

        segments.push({ kind: 'value', valueName: name });
        if (!required.includes(name)) required.push(name);
        lastIndex = match.index + match[0].length;
    }

    const tail = raw.slice(lastIndex);
    if (tail !== '') {
        segments.push({ kind: 'literal', text: tail });
        literalText += tail;
    }

    return { raw, segments, required, literalText };
}

export interface VariantValidation {
    variants: AnswerVariantSpec[];
    warnings: Warning[];
}

/**
 * Parse every non-empty block and enforce distinct-set completeness.
 *
 * Occurrence counts and order are free; membership is not. A block that misses
 * a declared value is fatal, because it is an incomplete answer rather than an
 * alternative spelling.
 */
export function parseVariants(
    blocks: string[],
    requiredNames: string[],
): VariantValidation {
    const warnings: Warning[] = [];
    const variants = blocks.map((block) => parseVariant(block)).filter((v) => v.raw.trim() !== '');

    const required = new Set(requiredNames);
    variants.forEach((variant, index) => {
        const present = new Set(variant.required);
        const missing = [...required].filter((name) => !present.has(name));
        const extra = [...present].filter((name) => !required.has(name));

        if (missing.length > 0) {
            throw new VariantError(
                `## ANSWERS block ${index + 1} is missing ${missing.map((m) => `<<rv:value:${m}>>`).join(', ')}. ` +
                    'Every variant must contain every bound value; multi-value answers are never split across variants',
            );
        }
        if (extra.length > 0) {
            throw new VariantError(
                `## ANSWERS block ${index + 1} references ${extra.map((m) => `<<rv:value:${m}>>`).join(', ')} ` +
                    'which is not a declared value binding',
            );
        }
        if (variant.literalText.trim() === '') {
            warnings.push({
                section: 'answers',
                message: `## ANSWERS block ${index + 1} has no literal text — the grader cannot tell the values apart`,
            });
        }
    });

    return { variants, warnings };
}
