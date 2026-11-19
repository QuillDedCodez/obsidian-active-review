/** Parse the `## QUESTIONS` section into variant blocks. */
import { sectionBlocks } from '../sections';

export function parseQuestionSection(section: string): string[] {
    const variants = sectionBlocks(section);
    if (variants.length === 0) throw new Error('missing "## QUESTIONS" text');
    return variants;
}
