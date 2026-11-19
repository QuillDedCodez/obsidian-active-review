/**
 * On-disk index codec.
 *
 * The index is the only thing the plugin reads at startup, so it stores the
 * full parsed questions and session logs. Sets inside `Question` are encoded as
 * arrays because JSON cannot represent them.
 *
 * Pure module: no Obsidian imports, so it is covered by the Node test harness.
 */
import type { Question, Warning } from '../parser';
import type { SessionLogState } from './sessionLog';

export const INDEX_SCHEMA = 3;

export interface IndexedVerdict {
    error: string | null;
    warnings: Warning[];
    choiceCount: number;
}

export interface IndexedQuestion {
    mtime: number;
    size: number;
    /** Absent when the note failed to parse (see `issue`). */
    q: Question | null;
    /** Fatal scanner error, e.g. removed placeholder syntax. */
    issue: string | null;
    /** Validation result; absent when `issue` or `q` is null. */
    verdict: IndexedVerdict | null;
}

export interface IndexedSession {
    mtime: number;
    size: number;
    log: SessionLogState | null;
}

export interface VaultIndexScope {
    reviewDir: string;
    sessionsSubdir: string;
}

export interface VaultIndexData {
    schema: number;
    pluginVersion: string;
    scope: VaultIndexScope;
    builtAt: number;
    questions: Record<string, IndexedQuestion>;
    sessions: Record<string, IndexedSession>;
}

type StoredQuestion = Omit<Question, 'ignoredWarnings' | 'literalSections'> & {
    ignoredWarnings: string[];
    literalSections: string[];
};

interface StoredQuestionEntry {
    mtime: number;
    size: number;
    q: StoredQuestion | null;
    issue: string | null;
    verdict: IndexedVerdict | null;
}

interface StoredIndexData {
    schema: number;
    pluginVersion: string;
    scope: VaultIndexScope;
    builtAt: number;
    questions: Record<string, StoredQuestionEntry>;
    sessions: Record<string, IndexedSession>;
}

function toStored(q: Question): StoredQuestion {
    return {
        ...q,
        ignoredWarnings: [...q.ignoredWarnings],
        literalSections: [...q.literalSections],
    };
}

function fromStored(q: StoredQuestion): Question {
    return {
        ...q,
        ignoredWarnings: new Set(q.ignoredWarnings ?? []),
        literalSections: new Set(q.literalSections ?? []),
    };
}

async function compress(text: string): Promise<ArrayBuffer> {
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream === 'undefined') {
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
    }
    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}

async function decompress(buffer: ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(buffer);
    const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!gzipped) return new TextDecoder().decode(bytes);
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('gzip is not supported in this runtime');
    }
    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}

export async function encodeIndexData(data: VaultIndexData): Promise<ArrayBuffer> {
    const questions: Record<string, StoredQuestionEntry> = {};
    for (const [path, entry] of Object.entries(data.questions)) {
        questions[path] = {
            mtime: entry.mtime,
            size: entry.size,
            q: entry.q ? toStored(entry.q) : null,
            issue: entry.issue,
            verdict: entry.verdict,
        };
    }
    const stored: StoredIndexData = {
        schema: data.schema,
        pluginVersion: data.pluginVersion,
        scope: data.scope,
        builtAt: data.builtAt,
        questions,
        sessions: data.sessions,
    };
    return compress(JSON.stringify(stored));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns null for anything unreadable, outdated, or structurally wrong. */
export async function decodeIndexData(
    buffer: ArrayBuffer,
): Promise<VaultIndexData | null> {
    try {
        const parsed: unknown = JSON.parse(await decompress(buffer));
        if (!isRecord(parsed)) return null;
        if (parsed.schema !== INDEX_SCHEMA) return null;
        if (!isRecord(parsed.scope)) return null;
        if (!isRecord(parsed.questions) || !isRecord(parsed.sessions)) return null;

        const scope = parsed.scope as unknown as VaultIndexScope;
        if (typeof scope.reviewDir !== 'string') return null;
        if (typeof scope.sessionsSubdir !== 'string') return null;

        const questions: Record<string, IndexedQuestion> = {};
        for (const [path, raw] of Object.entries(parsed.questions)) {
            if (!isRecord(raw)) return null;
            if (typeof raw.mtime !== 'number' || typeof raw.size !== 'number') {
                return null;
            }
            const stored = raw.q as unknown as StoredQuestion | null;
            questions[path] = {
                mtime: raw.mtime,
                size: raw.size,
                q: stored ? fromStored(stored) : null,
                issue: typeof raw.issue === 'string' ? raw.issue : null,
                verdict: (raw.verdict as IndexedVerdict | null) ?? null,
            };
        }

        const sessions: Record<string, IndexedSession> = {};
        for (const [path, raw] of Object.entries(parsed.sessions)) {
            if (!isRecord(raw)) return null;
            if (typeof raw.mtime !== 'number' || typeof raw.size !== 'number') {
                return null;
            }
            sessions[path] = {
                mtime: raw.mtime,
                size: raw.size,
                log: (raw.log as SessionLogState | null) ?? null,
            };
        }

        return {
            schema: INDEX_SCHEMA,
            pluginVersion:
                typeof parsed.pluginVersion === 'string'
                    ? parsed.pluginVersion
                    : 'unknown',
            scope,
            builtAt: typeof parsed.builtAt === 'number' ? parsed.builtAt : 0,
            questions,
            sessions,
        };
    } catch {
        return null;
    }
}

/** Fresh, empty index data for a scan. */
export function emptyIndexData(
    scope: VaultIndexScope,
    pluginVersion: string,
): VaultIndexData {
    return {
        schema: INDEX_SCHEMA,
        pluginVersion,
        scope,
        builtAt: 0,
        questions: {},
        sessions: {},
    };
}
