/**
 * Pure parsing and resolution for the `active-review` code block.
 *
 * The block format is deliberately forgiving: full-line `#`/`//` comments,
 * YAML-ish message blocks, wiki links, markdown links, and raw vault paths all
 * work. Resolution turns the parsed spec into a SessionConfig plus a concrete
 * question pool using the plugin's existing preset and category rules.
 */
import { DEFAULT_SESSION_CONFIG, type SessionConfig } from '../constants';
import type { Question } from '../parser';
import { normalizeModeConfig, sanitizeSessionConfig } from '../session/config';
import type { Mode } from '../session/types';
import { isQuestionMatched, type ManageQuestionPreset } from '../vault/managePresets';
import type { SessionPreset } from '../vault/sessionPresets';

export type EmbedPoolMode = 'add' | 'replace';
export type EmbedMode = 'choice' | 'typed';

export interface ParsedEmbedBlock {
    sessionPreset: string;
    questionPresets: string[];
    pool: EmbedPoolMode;
    sessionName: string | null;
    message: string | null;
    submessage: string | null;
    mode: EmbedMode | null;
    include: string[];
    exclude: string[];
    overrides: Partial<SessionConfig>;
    errors: string[];
    warnings: string[];
}

interface RawSection {
    rawKey: string;
    key: string;
    line: number;
    /** Inline value after the colon (already trimmed). */
    inline: string;
    /** Continuation lines, as written. */
    continuation: string[];
}

/** Lowercase and strip separators so `choice-count` === `choiceCount`. */
export function normalizeKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function stripQuotes(value: string): string {
    const text = value.trim();
    if (text.length < 2) return text;
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return text.slice(1, -1);
    }
    return text;
}

function isComment(line: string): boolean {
    return line.startsWith('#') || line.startsWith('//');
}

function isKeyLine(line: string): RegExpExecArray | null {
    if (!/^[A-Za-z]/.test(line)) return null;
    return /^([A-Za-z][A-Za-z0-9 _-]*):[ \t]*(.*)$/.exec(line);
}

function dedent(lines: string[]): string[] {
    const nonEmpty = lines.filter((line) => line.trim() !== '');
    if (nonEmpty.length === 0) return lines.map(() => '');
    let min = Infinity;
    for (const line of nonEmpty) {
        const match = /^[ \t]*/.exec(line);
        min = Math.min(min, match ? match[0].length : 0);
    }
    if (!Number.isFinite(min) || min === 0) return lines;
    return lines.map((line) => line.slice(Math.min(min, line.length)));
}

function sectionText(section: RawSection): string {
    const continuation = dedent(section.continuation);
    const lines =
        section.inline === ''
            ? continuation
            : [section.inline, ...continuation];
    return lines.join('\n').replace(/^\s*\n|\n\s*$/g, '');
}

function scalarText(section: RawSection): string {
    return sectionText(section)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join(' ')
        .trim();
}

function blockStyle(value: string): 'literal' | 'fold' | null {
    if (value === '|' || value === '|-') return 'literal';
    if (value === '>' || value === '>-') return 'fold';
    return null;
}

function messageText(section: RawSection): string {
    const style = blockStyle(section.inline);
    const continuation = dedent(section.continuation);
    if (style === 'fold') {
        return continuation
            .map((line) => line.trim())
            .filter((line) => line !== '')
            .join(' ')
            .trim();
    }
    // A literal block preserves newlines; a non-block message may also use
    // indented continuation lines, which is useful for plain prose.
    const text = continuation.join('\n').replace(/^\s*\n|\n\s*$/g, '');
    if (style === 'literal' || section.inline === '') return text;
    return [section.inline, ...continuation]
        .join('\n')
        .replace(/^\s*\n|\n\s*$/g, '')
        .trim();
}

function splitNames(value: string): string[] {
    return value
        .split(',')
        .map((part) => stripQuotes(part))
        .filter((part) => part !== '');
}

function normalizeWikiLink(inner: string): string {
    let value = inner.trim();
    // `[[target|alias]]`
    const pipe = value.indexOf('|');
    if (pipe >= 0) value = value.slice(0, pipe);
    // `[[target#heading]]` and `[[target^block]]`
    const hash = value.indexOf('#');
    if (hash >= 0) value = value.slice(0, hash);
    const caret = value.indexOf('^');
    if (caret >= 0) value = value.slice(0, caret);
    return value.trim();
}

function extractLinks(text: string): string[] {
    const out: string[] = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#') || line.startsWith('//')) continue;

        let found = false;
        const wiki = /!?\[\[([^\]]+)\]\]/g;
        for (const match of line.matchAll(wiki)) {
            const target = normalizeWikiLink(match[1] ?? '');
            if (target !== '') out.push(target);
            found = true;
        }
        if (found) continue;

        const markdown = /\[([^\]]*)\]\(([^)]+)\)/g;
        for (const match of line.matchAll(markdown)) {
            let target = (match[2] ?? '').trim();
            if (target.startsWith('<') && target.endsWith('>')) {
                target = target.slice(1, -1);
            }
            target = target.replace(/[?#].*$/, '').trim();
            try {
                target = decodeURIComponent(target);
            } catch {
                // Leave malformed escapes as written; resolution will warn.
            }
            if (target !== '') out.push(target);
            found = true;
        }
        if (found) continue;

        const plain = line
            .replace(/^[-*+][ \t]+/, '')
            .replace(/^["']|["']$/g, '')
            .replace(/,$/, '')
            .trim();
        if (plain !== '' && !plain.startsWith('[')) out.push(plain);
    }
    return out;
}

// ============================================================================
// Session config overrides
// ============================================================================

type EnumKind =
    | 'presentation'
    | 'trim'
    | 'order'
    | 'submitMode'
    | 'gradeMode'
    | 'timerMode';
type ConfigKind =
    | EnumKind
    | 'choiceCount'
    | 'count'
    | 'seed'
    | 'passScore'
    | 'seconds'
    | 'boolean'
    | 'string';

interface ConfigField {
    field: keyof SessionConfig;
    kind: ConfigKind;
}

const ENUM_VALUES: Record<EnumKind, Record<string, string>> = {
    presentation: { all: 'all', one: 'one' },
    trim: { seq: 'seq', rand: 'rand' },
    order: {
        source: 'source',
        random: 'random',
        priority: 'priority',
        priorityrandom: 'priority-random',
    },
    submitMode: { auto: 'auto', any: 'any', all: 'all' },
    gradeMode: { immediate: 'immediate', afterall: 'afterAll' },
    timerMode: { off: 'off', on: 'on', soft: 'soft' },
};

const CONFIG_FIELDS: Record<string, ConfigField> = {
    presentation: { field: 'presentation', kind: 'presentation' },
    choicecount: { field: 'choiceCount', kind: 'choiceCount' },
    choices: { field: 'choiceCount', kind: 'choiceCount' },
    count: { field: 'count', kind: 'count' },
    trim: { field: 'trim', kind: 'trim' },
    order: { field: 'order', kind: 'order' },
    seed: { field: 'seed', kind: 'seed' },
    submitmode: { field: 'submitMode', kind: 'submitMode' },
    submit: { field: 'submitMode', kind: 'submitMode' },
    grademode: { field: 'gradeMode', kind: 'gradeMode' },
    grade: { field: 'gradeMode', kind: 'gradeMode' },
    passscore: { field: 'passScore', kind: 'passScore' },
    pass: { field: 'passScore', kind: 'passScore' },
    managepresetid: { field: 'managePresetId', kind: 'string' },
    timersessionmode: { field: 'timerSessionMode', kind: 'timerMode' },
    timersessionseconds: { field: 'timerSessionSeconds', kind: 'seconds' },
    timersessionwarningseconds: {
        field: 'timerSessionWarningSeconds',
        kind: 'seconds',
    },
    timerquestionmode: { field: 'timerQuestionMode', kind: 'timerMode' },
    timerquestionseconds: { field: 'timerQuestionSeconds', kind: 'seconds' },
    timerquestionwarningseconds: {
        field: 'timerQuestionWarningSeconds',
        kind: 'seconds',
    },
    stopwatchsession: { field: 'stopwatchSession', kind: 'boolean' },
    stopwatchquestion: { field: 'stopwatchQuestion', kind: 'boolean' },
    navigator: { field: 'navigator', kind: 'boolean' },
    allowflag: { field: 'allowFlag', kind: 'boolean' },
};

function parseBoolean(value: string): boolean | null {
    switch (normalizeKey(value)) {
        case 'true':
        case 'yes':
        case 'on':
        case '1':
            return true;
        case 'false':
        case 'no':
        case 'off':
        case '0':
            return false;
        default:
            return null;
    }
}

function parseInteger(value: string): number | null {
    if (!/^-?\d+$/.test(value.trim())) return null;
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}

interface OverrideResult {
    value: unknown;
    warning?: string;
}

function parseConfigValue(kind: ConfigKind, raw: string): OverrideResult | null {
    const value = raw.trim();
    if (value === '') return null;

    if (kind === 'string') {
        return { value: stripQuotes(value) };
    }

    if (kind === 'boolean') {
        const bool = parseBoolean(value);
        return bool === null ? null : { value: bool };
    }

    if (
        kind === 'presentation' ||
        kind === 'trim' ||
        kind === 'order' ||
        kind === 'submitMode' ||
        kind === 'gradeMode' ||
        kind === 'timerMode'
    ) {
        const map = ENUM_VALUES[kind];
        const mapped = map[normalizeKey(value)];
        return mapped === undefined ? null : { value: mapped };
    }

    if (kind === 'seconds') {
        const n = parseInteger(value);
        if (n === null) return null;
        if (n < 0) {
            return {
                value: 0,
                warning: `negative time "${raw}" normalized to 0`,
            };
        }
        return { value: n };
    }

    if (kind === 'choiceCount') {
        const n = parseInteger(value);
        if (n === null) return null;
        const clamped = Math.max(2, Math.min(6, n));
        return {
            value: clamped,
            warning:
                clamped === n
                    ? undefined
                    : `choice count ${n} clamped to ${clamped}`,
        };
    }

    if (kind === 'seed') {
        const n = parseInteger(value);
        if (n === null) return null;
        return {
            value: Math.max(0, n),
            warning: n < 0 ? `seed ${n} normalized to 0` : undefined,
        };
    }

    if (kind === 'count') {
        if (normalizeKey(value) === 'all') return { value: 'all' };
        const n = parseInteger(value);
        if (n === null) return null;
        return {
            value: n < 1 ? 'all' : n,
            warning: n < 1 ? `count ${n} normalized to all` : undefined,
        };
    }

    if (kind === 'passScore') {
        if (normalizeKey(value) === 'off') return { value: 'off' };
        const n = parseInteger(value);
        if (n === null) return null;
        const clamped = Math.max(0, Math.min(100, n));
        return {
            value: clamped,
            warning:
                clamped === n
                    ? undefined
                    : `pass score ${n} clamped to ${clamped}`,
        };
    }

    return null;
}

// ============================================================================
// Main parser
// ============================================================================

function collectSections(source: string): {
    sections: RawSection[];
    warnings: string[];
} {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const sections: RawSection[] = [];
    const warnings: string[] = [];
    let current: RawSection | null = null;

    const finish = (): void => {
        if (current) sections.push(current);
        current = null;
    };

    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index]!;
        const lineNumber = index + 1;

        if (raw.trim() === '') {
            if (current) current.continuation.push('');
            continue;
        }
        if (isComment(raw)) continue;

        const keyMatch = isKeyLine(raw);
        if (keyMatch) {
            finish();
            const rawKey = keyMatch[1] ?? '';
            current = {
                rawKey,
                key: normalizeKey(rawKey),
                line: lineNumber,
                inline: (keyMatch[2] ?? '').trim(),
                continuation: [],
            };
            continue;
        }

        if (!current) {
            warnings.push(`line ${lineNumber}: ignored before the first key`);
            continue;
        }
        current.continuation.push(raw);
    }
    finish();
    return { sections, warnings };
}

export function parseEmbedBlock(source: string): ParsedEmbedBlock {
    const parsed: ParsedEmbedBlock = {
        sessionPreset: '',
        questionPresets: [],
        pool: 'add',
        sessionName: null,
        message: null,
        submessage: null,
        mode: null,
        include: [],
        exclude: [],
        overrides: {},
        errors: [],
        warnings: [],
    };

    const { sections, warnings } = collectSections(source);
    parsed.warnings.push(...warnings);
    const seen = new Set<string>();

    for (const section of sections) {
        const { key, rawKey, line } = section;

        if (seen.has(key) && key !== 'include' && key !== 'exclude' && key !== 'questionpreset' && key !== 'questionpresets') {
            parsed.warnings.push(
                `line ${line}: duplicate "${rawKey}" — the last value wins`,
            );
        }
        seen.add(key);

        switch (key) {
            case 'sessionpreset': {
                const value = stripQuotes(scalarText(section));
                if (value === '') {
                    parsed.errors.push(`line ${line}: sessionPreset is empty`);
                } else {
                    parsed.sessionPreset = value;
                }
                break;
            }
            case 'questionpreset':
            case 'questionpresets': {
                parsed.questionPresets.push(...splitNames(scalarText(section)));
                break;
            }
            case 'pool': {
                const value = normalizeKey(scalarText(section));
                if (value === 'add' || value === '' || value === 'preset') {
                    parsed.pool = 'add';
                } else if (value === 'replace') {
                    parsed.pool = 'replace';
                } else {
                    parsed.warnings.push(
                        `line ${line}: unknown pool "${scalarText(section)}" — using add`,
                    );
                }
                break;
            }
            case 'sessionname': {
                const value = scalarText(section);
                parsed.sessionName = value === '' ? null : stripQuotes(value);
                break;
            }
            case 'message': {
                const value = messageText(section);
                parsed.message = value === '' ? null : value;
                break;
            }
            case 'submessage': {
                const value = messageText(section);
                parsed.submessage = value === '' ? null : value;
                break;
            }
            case 'mode': {
                const value = normalizeKey(scalarText(section));
                if (value === 'choice' || value === 'choiceonly') parsed.mode = 'choice';
                else if (value === 'typed' || value === 'type') parsed.mode = 'typed';
                else {
                    parsed.warnings.push(
                        `line ${line}: unknown mode "${scalarText(section)}" — using the preset mode`,
                    );
                }
                break;
            }
            case 'include': {
                parsed.include.push(...extractLinks(sectionText(section)));
                break;
            }
            case 'exclude': {
                parsed.exclude.push(...extractLinks(sectionText(section)));
                break;
            }
            default: {
                const field = CONFIG_FIELDS[key];
                if (!field) {
                    parsed.warnings.push(
                        `line ${line}: unknown key "${rawKey}" ignored`,
                    );
                    break;
                }
                const rawValue = scalarText(section);
                const result = parseConfigValue(field.kind, rawValue);
                if (result === null) {
                    parsed.warnings.push(
                        `line ${line}: invalid value "${rawValue}" for ${rawKey} — ignored`,
                    );
                    break;
                }
                if (result.warning) {
                    parsed.warnings.push(`line ${line}: ${result.warning}`);
                }
                (parsed.overrides as Record<string, unknown>)[field.field] =
                    result.value;
                break;
            }
        }
    }

    if (parsed.sessionPreset === '') {
        parsed.errors.unshift('sessionPreset is required.');
    }

    parsed.include = [...new Set(parsed.include)];
    parsed.exclude = [...new Set(parsed.exclude)];
    return parsed;
}

export interface EmbedResolveContext {
    presets: SessionPreset[];
    managePresets: ManageQuestionPreset[];
    questions: Question[];
    issues: ReadonlyMap<string, string>;
    lastCustomSelection: string[];
    reviewDir: string;
    sourcePath: string;
    defaultSessionName: string;
    resolveLink: (linkpath: string, sourcePath: string) => string | null;
}

export interface EmbedManageSelection {
    name: string;
    includedPaths: string[];
}

export interface EmbedResolution {
    ok: boolean;
    preset: SessionPreset | null;
    presetName: string;
    pool: EmbedPoolMode;
    config: SessionConfig;
    mode: Mode;
    questions: Question[];
    manageSelection: EmbedManageSelection;
    sessionName: string;
    message: string | null;
    submessage: string | null;
    errors: string[];
    warnings: string[];
    counts: {
        base: number;
        included: number;
        excluded: number;
        final: number;
    };
}

function nameKey(value: string): string {
    return value.trim().toLocaleLowerCase();
}

function findSessionPreset(
    presets: SessionPreset[],
    value: string,
): { preset: SessionPreset | null; error: string | null } {
    const byId = presets.find((preset) => preset.id === value);
    if (byId) return { preset: byId, error: null };

    const key = nameKey(value);
    const matches = presets.filter((preset) => nameKey(preset.name) === key);
    if (matches.length === 1) return { preset: matches[0]!, error: null };
    if (matches.length > 1) {
        return {
            preset: null,
            error: `Session preset "${value}" is ambiguous (${matches
                .map((p) => p.id)
                .join(', ')}). Use the preset id instead.`,
        };
    }
    const names = presets
        .map((preset) => `${preset.name}${preset.showOnStart === false ? ' (hidden)' : ''}`)
        .join(', ');
    return {
        preset: null,
        error:
            `Session preset "${value}" not found.` +
            (names ? ` Available: ${names}.` : ' No session presets are saved.'),
    };
}

function findQuestionPreset(
    presets: ManageQuestionPreset[],
    value: string,
): { preset: ManageQuestionPreset | null; error: string | null } {
    const byId = presets.find((preset) => preset.id === value);
    if (byId) return { preset: byId, error: null };

    const key = nameKey(value);
    const matches = presets.filter((preset) => nameKey(preset.name) === key);
    if (matches.length === 1) return { preset: matches[0]!, error: null };
    if (matches.length > 1) {
        return {
            preset: null,
            error: `Question preset "${value}" is ambiguous (${matches
                .map((p) => p.id)
                .join(', ')}). Use the preset id instead.`,
        };
    }
    const names = presets.map((preset) => preset.name).join(', ');
    return {
        preset: null,
        error:
            `Question preset "${value}" not found.` +
            (names ? ` Available: ${names}.` : ' No question presets are saved.'),
    };
}

function pushQuestion(
    list: Question[],
    seen: Set<string>,
    question: Question,
): boolean {
    if (seen.has(question.path)) return false;
    seen.add(question.path);
    list.push(question);
    return true;
}

/**
 * Resolve a block. This does not start a session and never mutates the parsed
 * block or the plugin's settings.
 */
export function resolveEmbedBlock(
    parsed: ParsedEmbedBlock,
    context: EmbedResolveContext,
): EmbedResolution {
    const errors = [...parsed.errors];
    const warnings = [...parsed.warnings];

    const presetResult = parsed.sessionPreset
        ? findSessionPreset(context.presets, parsed.sessionPreset)
        : { preset: null, error: null };
    if (presetResult.error) errors.push(presetResult.error);
    const preset = presetResult.preset;

    const byPath = new Map(context.questions.map((question) => [question.path, question]));
    const matched = context.questions.filter((question) =>
        isQuestionMatched(question, context.reviewDir),
    );
    const matchedPaths = new Set(matched.map((question) => question.path));

    let baseName = 'All questions';
    const base: Question[] = [];

    if (parsed.pool === 'replace') {
        baseName = 'Included notes';
    } else if (parsed.questionPresets.length > 0) {
        const names: string[] = [];
        const seen = new Set<string>();
        for (const value of parsed.questionPresets) {
            const found = findQuestionPreset(context.managePresets, value);
            if (found.error) {
                errors.push(found.error);
                continue;
            }
            const questionPreset = found.preset!;
            names.push(questionPreset.name);
            for (const path of questionPreset.includedPaths) {
                const question = byPath.get(path);
                if (question && matchedPaths.has(path)) pushQuestion(base, seen, question);
            }
        }
        baseName = names.length > 0 ? names.join(' + ') : 'No question preset';
    } else if (preset) {
        const manageId =
            parsed.overrides.managePresetId ?? preset.config.managePresetId;
        if (manageId === 'all') {
            base.push(...matched);
        } else if (manageId === 'last-custom') {
            const seen = new Set<string>();
            for (const path of context.lastCustomSelection) {
                const question = byPath.get(path);
                if (question && matchedPaths.has(path)) pushQuestion(base, seen, question);
            }
            baseName = 'Last custom';
        } else {
            const questionPreset = context.managePresets.find(
                (candidate) => candidate.id === manageId,
            );
            if (!questionPreset) {
                warnings.push(
                    `The session preset's question preset (${manageId}) no longer exists — using all matched questions.`,
                );
                base.push(...matched);
            } else {
                baseName = questionPreset.name;
                const seen = new Set<string>();
                for (const path of questionPreset.includedPaths) {
                    const question = byPath.get(path);
                    if (question && matchedPaths.has(path)) {
                        pushQuestion(base, seen, question);
                    }
                }
            }
        }
    }

    const baseCount = base.length;
    const basePaths = new Set(base.map((question) => question.path));
    const includeQuestions: Question[] = [];
    const includeSeen = new Set<string>();
    let includedAdded = 0;

    for (const link of parsed.include) {
        const path = context.resolveLink(link, context.sourcePath);
        if (!path) {
            warnings.push(`Include link not found: ${link}`);
            continue;
        }
        const question = byPath.get(path);
        if (!question) {
            const issue = context.issues.get(path);
            if (issue) {
                warnings.push(`Include "${link}" could not be parsed: ${issue}`);
            } else {
                warnings.push(`Include "${link}" is not a quiz note.`);
            }
            continue;
        }
        if (!matchedPaths.has(path)) {
            warnings.push(
                `Include "${link}" is excluded by Category Sync (folder/category mismatch).`,
            );
            continue;
        }
        // Already in the preset pool: explicit reassurance, not a new card.
        if (basePaths.has(path)) continue;
        if (pushQuestion(includeQuestions, includeSeen, question)) includedAdded++;
    }

    const excludePaths = new Set<string>();
    for (const link of parsed.exclude) {
        const path = context.resolveLink(link, context.sourcePath);
        if (!path) {
            warnings.push(`Exclude link not found: ${link}`);
            continue;
        }
        excludePaths.add(path);
    }

    const finalPool: Question[] = [];
    const finalSeen = new Set<string>();
    for (const question of [...base, ...includeQuestions]) {
        if (excludePaths.has(question.path)) continue;
        pushQuestion(finalPool, finalSeen, question);
    }
    const excludedRemoved =
        baseCount + includeQuestions.length - finalPool.length;

    const baseConfig: SessionConfig = {
        ...DEFAULT_SESSION_CONFIG,
        ...(preset?.config ?? {}),
        ...parsed.overrides,
    };
    const sanitized = sanitizeSessionConfig(baseConfig);
    const mode: Mode = parsed.mode ?? preset?.mode ?? 'choice';
    const config = normalizeModeConfig(mode, sanitized);

    if (finalPool.length === 0) {
        errors.push(
            parsed.pool === 'replace'
                ? 'The included notes produced no questions.'
                : 'No questions are selected for this embedded session.',
        );
    }

    return {
        ok: errors.length === 0,
        preset,
        presetName: preset?.name ?? parsed.sessionPreset,
        pool: parsed.pool,
        config,
        mode,
        questions: finalPool,
        manageSelection: {
            name: baseName,
            includedPaths: finalPool.map((question) => question.path),
        },
        sessionName:
            parsed.sessionName ??
            (context.defaultSessionName.trim() || parsed.sessionPreset),
        message: parsed.message,
        submessage: parsed.submessage,
        errors,
        warnings,
        counts: {
            base: baseCount,
            included: includedAdded,
            excluded: excludedRemoved,
            final: finalPool.length,
        },
    };
}
