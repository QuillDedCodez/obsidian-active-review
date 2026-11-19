/** Split a quiz-note body into fenced `rv-*` blocks and `## ` sections. */

export const SECTIONS = {
    DEFINITIONS: 'definitions',
    QUESTIONS: 'questions',
    ANSWERS: 'answers',
    DISTRACTORS: 'distractors',
    EXPLANATIONS: 'explanations',
} as const;

export type SectionName = (typeof SECTIONS)[keyof typeof SECTIONS];

/** Marker suffix on a section header. Renders as an HTML comment in Obsidian. */
export const IGNORE_WARNINGS_MARKER = '<!--ignore-warnings-->';

/**
 * Marker suffix that turns a content section into literal render mode: every
 * placeholder stays as written instead of calling its `rv-def` definition.
 * Valid on `## QUESTIONS`, `## ANSWERS`, `## DISTRACTORS`, and
 * `## EXPLANATIONS`; on `## DEFINITIONS` it is silently ignored.
 */
export const DEBUG_CALLED_DEFINITIONS_MARKER = '<!--debug-called-definitions-->';

/** Sections that accept the literal-render marker. */
const LITERAL_SECTIONS: ReadonlySet<string> = new Set([
    SECTIONS.QUESTIONS,
    SECTIONS.ANSWERS,
    SECTIONS.DISTRACTORS,
    SECTIONS.EXPLANATIONS,
]);

const HEADER_MARKERS = [
    { marker: IGNORE_WARNINGS_MARKER, kind: 'ignoreWarnings' },
    { marker: DEBUG_CALLED_DEFINITIONS_MARKER, kind: 'debugCalledDefinitions' },
] as const;

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface HeaderMarkers {
    name: string;
    ignoreWarnings: boolean;
    debugCalledDefinitions: boolean;
}

/**
 * Split trailing `<!--…-->` markers off a header in any order. Repeated markers
 * are harmless; anything else stays part of the header name.
 */
function splitHeaderMarkers(rawHeader: string): HeaderMarkers {
    let text = rawHeader;
    let ignoreWarnings = false;
    let debugCalledDefinitions = false;
    let matched = true;
    while (matched) {
        matched = false;
        for (const { marker, kind } of HEADER_MARKERS) {
            const suffix = new RegExp(`(?:^|\\s)${escapeRegExp(marker)}\\s*$`);
            const m = suffix.exec(text);
            if (!m) continue;
            text = text.slice(0, m.index).trim();
            if (kind === 'ignoreWarnings') ignoreWarnings = true;
            else debugCalledDefinitions = true;
            matched = true;
        }
    }
    return { name: text.trim().toLowerCase(), ignoreWarnings, debugCalledDefinitions };
}

/** Extracts the content of an `rv-def` fence. Only matched under `## DEFINITIONS`. */
const RV_DEF_FENCE = /```rv-def(?:initions)?[^\n]*\r?\n([\s\S]*?)\r?\n?```/g;

/** `rv-answer` fence under `## ANSWERS`. Removed before block splitting. */
const RV_ANSWER_FENCE = /```rv-answers?[^\n]*\r?\n([\s\S]*?)\r?\n?```/g;

/** `rv-distract` fence under `## DISTRACTORS`. */
const RV_DISTRACT_FENCE = /```rv-distract(?:ors)?[^\n]*\r?\n([\s\S]*?)\r?\n?```/g;

/** Detects deprecated `rv-var` / `rv-eq` fences anywhere in the note. */
const RV_DEPRECATED = /```(rv-var|rv-eq)[^\n]*\r?\n[\s\S]*?\r?\n?```/g;

export interface Blocks {
    defBlock: string;
    deprecated: string[];
    /** Body of the first `## ANSWERS` → `rv-answer` fence, if present. */
    answerFence?: string;
    /** How many `rv-answer` fences were found under `## ANSWERS`. */
    answerFenceCount: number;
    /** Body of the first `## DISTRACTORS` → `rv-distract` fence, if present. */
    distractFence?: string;
    /** How many `rv-distract` fences were found under `## DISTRACTORS`. */
    distractFenceCount: number;
}

export interface Extracted {
    frontmatter: string | undefined;
    body: string;
    sections: Map<string, string>;
    /** Sections whose header carried the `<!--ignore-warnings-->` marker. */
    ignoredWarnings: Set<string>;
    /** Sections whose header carried the `<!--debug-called-definitions-->` marker. */
    literalSections: Set<string>;
    blocks: Blocks;
}

export interface SectionsResult {
    sections: Map<string, string>;
    ignoredWarnings: Set<string>;
    literalSections: Set<string>;
}

/**
 * Strip the frontmatter and pull out the `rv-def` fence that lives under
 * `## DEFINITIONS`. Heading exclusivity: `rv-def` fences elsewhere are ignored.
 */
export function extractBlocks(content: string): Extracted {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];

    const deprecated: string[] = [];
    RV_DEPRECATED.lastIndex = 0;
    let dm: RegExpExecArray | null;
    while ((dm = RV_DEPRECATED.exec(content)) !== null) {
        const name = dm[1]!;
        if (!deprecated.includes(name)) deprecated.push(name);
    }

    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const { sections, ignoredWarnings, literalSections } = extractSections(body);

    const defParts: string[] = [];
    const defContent = sections.get(SECTIONS.DEFINITIONS) ?? '';
    RV_DEF_FENCE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RV_DEF_FENCE.exec(defContent)) !== null) {
        defParts.push(m[1]!.trim());
    }

    // Pull the `rv-answer` fence out of `## ANSWERS` so `sectionBlocks` does not
    // treat it as answer text.
    let answerFence: string | undefined;
    let answerFenceCount = 0;
    const answersContent = sections.get(SECTIONS.ANSWERS);
    if (answersContent !== undefined) {
        RV_ANSWER_FENCE.lastIndex = 0;
        const spans: { start: number; end: number; body: string }[] = [];
        let fm: RegExpExecArray | null;
        while ((fm = RV_ANSWER_FENCE.exec(answersContent)) !== null) {
            spans.push({
                start: fm.index,
                end: fm.index + fm[0].length,
                body: fm[1]!.trim(),
            });
        }
        if (spans.length > 0) {
            answerFenceCount = spans.length;
            answerFence = spans[0]!.body;
            let rebuilt = '';
            let cursor = 0;
            for (const span of spans) {
                rebuilt += answersContent.slice(cursor, span.start);
                cursor = span.end;
            }
            rebuilt += answersContent.slice(cursor);
            sections.set(SECTIONS.ANSWERS, rebuilt.trim());
        }
    }

    let distractFence: string | undefined;
    let distractFenceCount = 0;
    const distractContent = sections.get(SECTIONS.DISTRACTORS);
    if (distractContent !== undefined) {
        RV_DISTRACT_FENCE.lastIndex = 0;
        const spans: { start: number; end: number; body: string }[] = [];
        let dmatch: RegExpExecArray | null;
        while ((dmatch = RV_DISTRACT_FENCE.exec(distractContent)) !== null) {
            spans.push({
                start: dmatch.index,
                end: dmatch.index + dmatch[0].length,
                body: dmatch[1]!.trim(),
            });
        }
        if (spans.length > 0) {
            distractFenceCount = spans.length;
            distractFence = spans[0]!.body;
            let rebuilt = '';
            let cursor = 0;
            for (const span of spans) {
                rebuilt += distractContent.slice(cursor, span.start);
                cursor = span.end;
            }
            rebuilt += distractContent.slice(cursor);
            sections.set(SECTIONS.DISTRACTORS, rebuilt.trim());
        }
    }

    return {
        frontmatter,
        body,
        sections,
        ignoredWarnings,
        literalSections,
        blocks: {
            defBlock: defParts.join('\n'),
            deprecated,
            answerFence,
            answerFenceCount,
            distractFence,
            distractFenceCount,
        },
    };
}

/**
 * Split a markdown body into `## ` sections, ignoring headings inside code
 * fences. Section keys are lowercased. Trailing `<!--ignore-warnings-->` and
 * `<!--debug-called-definitions-->` markers are stripped and recorded.
 */
export function extractSections(body: string): SectionsResult {
    const raw = new Map<string, string[]>();
    const ignoredWarnings = new Set<string>();
    const literalSections = new Set<string>();
    let current = '';
    let inFence = false;
    for (const line of body.split(/\r?\n/)) {
        if (/^```/.test(line) || /^~~~/.test(line)) inFence = !inFence;
        const h = !inFence && /^##\s+(.+?)\s*$/.exec(line);
        if (h) {
            const parsed = splitHeaderMarkers((h[1] ?? '').trim());
            const name = parsed.name;
            if (parsed.ignoreWarnings) ignoredWarnings.add(name);
            if (parsed.debugCalledDefinitions && LITERAL_SECTIONS.has(name)) {
                literalSections.add(name);
            }
            current = name;
            raw.set(current, []);
        } else if (current) {
            raw.get(current)?.push(line);
        }
    }
    const out = new Map<string, string>();
    for (const [k, v] of raw) out.set(k, v.join('\n').trim());
    return { sections: out, ignoredWarnings, literalSections };
}

/**
 * Split a section's content into blocks separated by a bare `---` line.
 * (Unchanged from Stage 1.)
 */
export function sectionBlocks(section: string): string[] {
    const blocks: string[] = [];
    const lines = section.split(/\r?\n/);
    let current: string[] = [];
    let fenceChar = '';
    let fenceLen = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);

        if (!fenceChar && fenceMatch) {
            fenceChar = fenceMatch[1]![0]!;
            fenceLen = fenceMatch[1]!.length;
        } else if (
            fenceChar &&
            fenceMatch &&
            fenceMatch[1]![0] === fenceChar &&
            fenceMatch[1]!.length >= fenceLen &&
            trimmed === fenceMatch[1]
        ) {
            fenceChar = '';
            fenceLen = 0;
        }

        if (!fenceChar && trimmed === '---') {
            const block = current.join('\n').trim();
            if (block) blocks.push(block);
            current = [];
        } else {
            current.push(line);
        }
    }

    const last = current.join('\n').trim();
    if (last) blocks.push(last);
    return blocks;
}