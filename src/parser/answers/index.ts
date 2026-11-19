/** Parse `## ANSWERS` and `## DISTRACTORS`: variants, quantity policy, and pruning. */
import {
    DIMENSIONLESS_UNIT,
    type AnswerSlotSpec,
    type AnswerSpec,
} from '../../math/units';
import { extractPlaceholders, type PlaceholderRef } from '../placeholders';
import { sectionBlocks, SECTIONS } from '../sections';
import type { VarDef, Warning } from '../types';
import { parseAnswerSpec, type ParsedAnswerSpec } from './answerSpec';
import { parseVariant } from './variants';

export {
    AnswerSpecError,
    parseAnswerSpec,
    type AnswerSpecContext,
    type ParsedAnswerSpec,
} from './answerSpec';

export interface AnswerSectionInput {
    answerSection: string;
    distractorSection: string;
    answerFence?: string;
    answerFenceCount: number;
    vars: VarDef[];
    stringNames: Set<string>;
    literalSections: Set<string>;
    /** Precomputed by `requireAnswerSection` when the caller needs early checks. */
    rawAnswerBlocks?: string[];
}

export interface ParsedAnswers {
    answerMode: 'numeric' | 'text';
    answerFormat?: 'quantity' | 'prose';
    answerSpec?: AnswerSpec;
    answerBlocks: string[];
    numericAnswerBlocks: string[];
    distractorBlocks: string[];
    answerName: string;
    answerValNames: string[];
    /** Unpruned blocks, for the global placeholder validation pass. */
    rawAnswerBlocks: string[];
    /** Unpruned blocks, for the global placeholder validation pass. */
    rawDistractorBlocks: string[];
    warnings: Warning[];
}

function firstVal(block: string): PlaceholderRef | undefined {
    return extractPlaceholders(block).find((r) => r.kind === 'val');
}

function hasVal(block: string): boolean {
    return firstVal(block) !== undefined;
}

function distinctValNames(block: string): string[] {
    return [
        ...new Set(
            extractPlaceholders(block)
                .filter((ref) => ref.kind === 'val')
                .map((ref) => ref.name),
        ),
    ].sort();
}

function sameNames(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((name, index) => name === b[index]);
}

function answerBlockKind(
    block: string,
    stringNames: Set<string>,
): 'numeric' | 'string' | 'text' {
    const val = firstVal(block);
    if (!val) return 'text';
    return stringNames.has(val.name) ? 'string' : 'numeric';
}

function hasValOrNumber(block: string): boolean {
    if (hasVal(block)) return true;
    return /\b\d+(\.\d+)?\b/.test(block);
}

function hasExpression(block: string): boolean {
    return extractPlaceholders(block).some((r) => r.kind === 'expression');
}

function defaultSlot(def: VarDef): AnswerSlotSpec {
    const unit = def.quantity?.unit ?? DIMENSIONLESS_UNIT;
    return {
        id: def.name,
        valueName: def.name,
        type: 'number',
        unitSystem: unit.namespace,
        unit,
        unitMode: 'expanded',
        display: 'atomic',
        prefixPolicy: 'any',
        allowedPrefixes: 'auto',
        precision: { kind: 'sigfigs', min: 3, max: 15 },
        notation: 'auto',
        unitOptional: false,
        currency: undefined,
        groupThousands: false,
        tol: 0,
        relTol: 0,
    };
}

export function requireAnswerSection(
    answerSection: string,
    answerFenceCount: number,
    answerFence: string | undefined,
): string[] {
    const rawAnswerBlocks = sectionBlocks(answerSection);
    if (answerFenceCount > 1) {
        throw new Error('rv-answer: only one rv-answer fence is allowed per note');
    }
    if (rawAnswerBlocks.length === 0 && answerFence === undefined) {
        throw new Error('missing "## ANSWERS"');
    }
    return rawAnswerBlocks;
}

export function parseAnswerSection(input: AnswerSectionInput): ParsedAnswers {
    const warnings: Warning[] = [];
    const allAnswerBlocks =
        input.rawAnswerBlocks ??
        requireAnswerSection(input.answerSection, input.answerFenceCount, input.answerFence);
    const rawDistractorBlocks = sectionBlocks(input.distractorSection);
    const answersLiteral = input.literalSections.has(SECTIONS.ANSWERS);

    // Strict variant model: the highest distinct-placeholder count wins.
    // Lower-count blocks are dropped with a warning; a same-count name-set
    // mismatch is fatal for the note.
    let answerBlocks = allAnswerBlocks;
    if (!answersLiteral) {
        const analysed = allAnswerBlocks.map((block) => ({
            block,
            names: distinctValNames(block),
        }));
        const maxCount = analysed.reduce((max, item) => Math.max(max, item.names.length), 0);
        analysed.forEach((item, index) => {
            if (item.names.length < maxCount) {
                warnings.push({
                    section: 'answers',
                    message:
                        `## ANSWERS block ${index + 1} dropped — it has ${item.names.length} ` +
                        `placeholder${item.names.length === 1 ? '' : 's'} but the highest count is ${maxCount}`,
                });
            }
        });
        const winners = analysed.filter((item) => item.names.length === maxCount);
        const reference = winners[0]?.names ?? [];
        const mismatch = winners.find((item) => !sameNames(item.names, reference));
        if (mismatch !== undefined) {
            throw new Error(
                '## ANSWERS variants do not use the same placeholder set — ' +
                    'same-count blocks must reference exactly the same names in any order',
            );
        }
        answerBlocks = winners.map((item) => item.block);
    }

    let parsedAnswer: ParsedAnswerSpec | undefined;
    if (input.answerFence !== undefined) {
        parsedAnswer = parseAnswerSpec(input.answerFence, {
            vars: input.vars,
            stringNames: input.stringNames,
            blocks: answerBlocks,
            distractorBlocks: rawDistractorBlocks,
            literalSections: input.literalSections,
        });
        warnings.push(...parsedAnswer.warnings);
    }

    const boundNames = [
        ...new Set(
            answerBlocks.flatMap((block) =>
                extractPlaceholders(block)
                    .filter((ref) => ref.kind === 'val')
                    .map((ref) => ref.name),
            ),
        ),
    ];
    if (input.answerFence !== undefined) {
        const declared = [
            ...input.answerFence.matchAll(/^([A-Za-z][A-Za-z0-9_]*):\s*$/gm),
        ].map((match) => match[1]!);
        for (const name of declared) {
            if (!boundNames.includes(name)) {
                warnings.push({
                    section: 'answers',
                    message:
                        `rv-answer: "${name}:" has no matching <<rv:value:${name}>> placeholder ` +
                        'in the accepted answer variants — the constraint is unused',
                });
            }
        }
    }

    const quantityDefs = new Map(
        input.vars
            .filter((def) => def.valueType === 'quantity')
            .map((def) => [def.name, def]),
    );
    const slots: AnswerSlotSpec[] = [...(parsedAnswer?.spec.slots ?? [])];
    for (const name of boundNames) {
        if (slots.some((slot) => slot.valueName === name)) continue;
        const def = quantityDefs.get(name);
        if (def) slots.push(defaultSlot(def));
    }

    const quantityMode = slots.length > 0;
    const answerMode: 'numeric' | 'text' = quantityMode
        ? 'numeric'
        : !answersLiteral &&
            answerBlocks.some((block) => answerBlockKind(block, input.stringNames) === 'numeric')
          ? 'numeric'
          : 'text';

    let numericAnswerBlocks = answerBlocks;
    if (answerMode === 'numeric' && !quantityMode) {
        const kept: string[] = [];
        answerBlocks.forEach((block, i) => {
            if (answerBlockKind(block, input.stringNames) === 'text' && !hasExpression(block)) {
                warnings.push({
                    section: 'answers',
                    message: `## ANSWERS block ${i + 1} dropped — no <<rv:val:>> but other blocks have one`,
                });
            } else {
                kept.push(block);
            }
        });
        if (kept.length === 0) {
            throw new Error('all ## ANSWERS blocks were dropped — none contains <<rv:val:>>');
        }
        answerBlocks = kept;
        numericAnswerBlocks = kept;
    } else if (!quantityMode) {
        numericAnswerBlocks = answerBlocks.filter(
            (block) => answerBlockKind(block, input.stringNames) === 'numeric',
        );
    }

    let distractorBlocks = rawDistractorBlocks;
    if (
        answerMode === 'numeric' &&
        !quantityMode &&
        !input.literalSections.has(SECTIONS.DISTRACTORS)
    ) {
        const kept: string[] = [];
        rawDistractorBlocks.forEach((block, i) => {
            if (!hasValOrNumber(block) && !hasExpression(block)) {
                warnings.push({
                    section: 'distractors',
                    message: `## DISTRACTORS block ${i + 1} dropped — numeric answer mode requires <<rv:val:>>, a literal number, or a numeric <<rv:expression:>>`,
                });
            } else {
                kept.push(block);
            }
        });
        distractorBlocks = kept;
    }

    let answerSpec: AnswerSpec | undefined;
    if (quantityMode) {
        const variants = answersLiteral
            ? answerBlocks.map((raw) => ({
                  raw,
                  segments: [{ kind: 'literal' as const, text: raw }],
                  required: [],
                  literalText: raw,
              }))
            : answerBlocks.map((block) => parseVariant(block));
        answerSpec = {
            kind: slots.length > 1 ? 'prose' : 'scalar',
            slots,
            variants,
            typedMode: parsedAnswer?.spec.typedMode ?? 'either',
            sep: parsedAnswer?.spec.sep ?? ',',
            distractorStrategy: 'variable',
            raw: parsedAnswer?.spec.raw ?? '',
        };
    }

    if (!answersLiteral && !quantityMode) {
        answerBlocks.forEach((block, i) => {
            const vals = extractPlaceholders(block).filter((r) => r.kind === 'val');
            if (vals.length >= 2) {
                warnings.push({
                    section: 'answers',
                    message: `## ANSWERS block ${i + 1}: ${vals.length} <<rv:val:>> occurrences — only the first is used for grading`,
                });
            }
        });
    }

    const answerValNames = quantityMode
        ? slots.map((slot) => slot.valueName)
        : answerMode === 'numeric'
          ? numericAnswerBlocks
                .map((block) => firstVal(block)?.name)
                .filter((name): name is string => name !== undefined)
          : [];

    return {
        answerMode,
        ...(answerSpec !== undefined
            ? {
                  answerFormat: answerSpec.kind === 'prose' ? ('prose' as const) : ('quantity' as const),
                  answerSpec,
              }
            : {}),
        answerBlocks,
        numericAnswerBlocks,
        distractorBlocks,
        answerName: answerValNames[0] ?? '',
        answerValNames,
        rawAnswerBlocks: allAnswerBlocks,
        rawDistractorBlocks,
        warnings,
    };
}
