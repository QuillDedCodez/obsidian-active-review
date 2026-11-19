/** Assemble the parser output for one quiz note. */
import { parseAnswerSection, requireAnswerSection } from './answers';
import { parseDefinitions } from './definitions';
import { parseDistractorLinks } from './distractors';
import { parseExplanationSection } from './explanations';
import { extractPlaceholders } from './placeholders';
import {
    extractDeclaredCategory,
    extractFolderCategory,
    isExcluded,
    parsePriority,
    resolveCategory,
} from './properties';
import { parseQuestionSection } from './questions';
import { extractBlocks, SECTIONS } from './sections';
import type { Question, Warning } from './types';

function maskCode(content: string): string {
    const out = content.split('');
    let i = 0;
    while (i < content.length) {
        if (content[i] !== '`') {
            i++;
            continue;
        }
        const openStart = i;
        while (i < content.length && content[i] === '`') i++;
        const fenceLen = i - openStart;

        const closeStart = findClosingRun(content, i, fenceLen);
        if (closeStart < 0) continue; // unmatched opener — leave as-is

        const closeEnd = closeStart + fenceLen;
        const inner = content.slice(i, closeStart);
        const hasNewline = inner.includes('\n');
        const isRvFence = hasNewline && /^rv-/.test(inner);
        if (!isRvFence) {
            for (let k = openStart; k < closeEnd; k++) out[k] = ' ';
        }
        i = closeEnd;
    }
    return out.join('');
}

function findClosingRun(content: string, from: number, fenceLen: number): number {
    let j = from;
    while (j < content.length) {
        if (content[j] === '`') {
            const start = j;
            while (j < content.length && content[j] === '`') j++;
            if (j - start === fenceLen) return start;
        } else {
            j++;
        }
    }
    return -1;
}

export function parseQuestionNote(
    path: string,
    content: string,
    reviewDir: string,
): Question | null {
    const { frontmatter, sections, ignoredWarnings, literalSections, blocks } =
        extractBlocks(content);
    if (isExcluded(frontmatter)) return null;

    if (/<<rv:(?:var|eq|ev|expr|exprs|expressions):/.test(maskCode(content))) {
        throw new Error(
            '<<rv:var:X>>, <<rv:eq:X>>, <<rv:ev:EXPR>>, <<rv:expr:X>>, and ' +
                '<<rv:expressions:X>> are no longer supported. ' +
                'Use <<rv:expression:X>> (source/display form) or <<rv:val:X>> (value form). ' +
                'To display a computed expression inline, define it as a variable in ' +
                '## DEFINITIONS and reference it via <<rv:expression:NAME>>.',
        );
    }

    if (blocks.deprecated.length > 0) {
        const names = blocks.deprecated.join(', ');
        throw new Error(
            `rv-def: block ${names} is no longer supported — use "rv-def" under the ` +
                `"## DEFINITIONS" heading. See Rules.md.`,
        );
    }

    const totalDistractFences = (
        content.match(/```rv-distract(?:ors)?[^\n]*\r?\n/g) ?? []
    ).length;
    if (totalDistractFences > blocks.distractFenceCount) {
        throw new Error('rv-distract: the fence must appear inside "## DISTRACTORS"');
    }
    if (blocks.distractFenceCount > 1) {
        throw new Error('rv-distract: only one rv-distract fence is allowed per note');
    }

    const section = (name: string): string => sections.get(name) ?? '';
    const warnings: Warning[] = [];

    const { priority, warning: priorityWarning } = parsePriority(frontmatter);
    if (priorityWarning) {
        warnings.push({ section: 'general', message: priorityWarning });
    }

    const variants = parseQuestionSection(section(SECTIONS.QUESTIONS));
    const explanation = parseExplanationSection(section(SECTIONS.EXPLANATIONS));

    const answerSection = section(SECTIONS.ANSWERS);
    const rawAnswerBlocks = requireAnswerSection(
        answerSection,
        blocks.answerFenceCount,
        blocks.answerFence,
    );

    const {
        vars,
        links,
        warnings: definitionWarnings,
        displayNames,
        env,
        stringNames,
    } = parseDefinitions(blocks.defBlock);
    warnings.push(...definitionWarnings);

    const answers = parseAnswerSection({
        answerSection,
        distractorSection: section(SECTIONS.DISTRACTORS),
        answerFence: blocks.answerFence,
        answerFenceCount: blocks.answerFenceCount,
        rawAnswerBlocks,
        vars,
        stringNames,
        literalSections,
    });
    warnings.push(...answers.warnings);

    const distractorLinks = parseDistractorLinks(blocks.distractFence, vars, warnings);
    for (const link of distractorLinks) {
        for (const target of link.targets) {
            const used = answers.distractorBlocks.some((block) =>
                new RegExp(
                    `<<rv:(?:value|val|values|expression):${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?::|>>)`,
                ).test(block),
            );
            if (!used) {
                warnings.push({
                    section: 'distractors',
                    message:
                        `rv-distract: "${target}" is conditioned from "${link.anchor}" ` +
                        'but is not used by any ## DISTRACTORS block',
                });
            }
        }
    }

    const knownNames = new Set<string>([
        ...Object.keys(env),
        ...stringNames,
        ...displayNames,
        ...vars.map((def) => def.name),
    ]);
    const varIndex = new Map(vars.map((v, i) => [v.name, i]));
    const checkBlockPlaceholders = (text: string, label: string): void => {
        for (const ref of extractPlaceholders(text)) {
            if (!knownNames.has(ref.name)) {
                throw new Error(
                    `${label}: <<rv:${ref.kind}:${ref.name}>> — "${ref.name}" is not defined in ## DEFINITIONS`,
                );
            }
            if (ref.kind === 'expression') {
                const expressionIndex = varIndex.get(ref.name);
                for (const arg of ref.args) {
                    if (arg === ref.name) {
                        throw new Error(
                            `${label}: <<rv:expression:${ref.name}:${arg}>> — an expression cannot call itself`,
                        );
                    }
                    if (!knownNames.has(arg)) {
                        throw new Error(
                            `${label}: <<rv:expression:${ref.name}:${arg}>> — calling variable "${arg}" is not defined`,
                        );
                    }
                    if (stringNames.has(arg)) {
                        throw new Error(
                            `${label}: <<rv:expression:${ref.name}:${arg}>> — calling variable "${arg}" is a string; expression arguments must be numeric`,
                        );
                    }
                    const argIndex = varIndex.get(arg);
                    if (
                        argIndex !== undefined &&
                        expressionIndex !== undefined &&
                        argIndex >= expressionIndex
                    ) {
                        throw new Error(
                            `${label}: <<rv:expression:${ref.name}:${arg}>> — calling variable "${arg}" must be declared before "${ref.name}"`,
                        );
                    }
                }
            }
        }
    };

    variants.forEach((block, i) => {
        if (!literalSections.has(SECTIONS.QUESTIONS)) {
            checkBlockPlaceholders(block, `## QUESTIONS block ${i + 1}`);
        }
    });
    answers.answerBlocks.forEach((block, i) => {
        if (!literalSections.has(SECTIONS.ANSWERS)) {
            checkBlockPlaceholders(block, `## ANSWERS block ${i + 1}`);
        }
    });
    answers.rawDistractorBlocks.forEach((block, i) => {
        if (!literalSections.has(SECTIONS.DISTRACTORS)) {
            checkBlockPlaceholders(block, `## DISTRACTORS block ${i + 1}`);
        }
    });
    if (explanation && !literalSections.has(SECTIONS.EXPLANATIONS)) {
        checkBlockPlaceholders(explanation, '## EXPLANATIONS');
    }

    const declared = extractDeclaredCategory(frontmatter);
    const folder = extractFolderCategory(path, reviewDir);
    const { category, categorySource } = resolveCategory(folder, declared);
    const base = (path.split('/').pop() ?? '').replace(/\.md$/, '');
    const common = {
        path,
        title: base,
        variants,
        explanation,
        category,
        categorySource,
        declaredCategory: declared,
        warnings,
        ignoredWarnings,
        literalSections,
    };

    return {
        ...common,
        answerMode: answers.answerMode,
        ...(answers.answerSpec !== undefined
            ? {
                  answerFormat: answers.answerFormat,
                  answerSpec: answers.answerSpec,
              }
            : {}),
        answerBlocks: answers.answerBlocks,
        numericAnswerBlocks: answers.numericAnswerBlocks,
        distractorBlocks: answers.distractorBlocks,
        vars,
        links,
        answerName: answers.answerName,
        answerValNames: answers.answerValNames,
        distractorLinks,
        priority,
    };
}
