import { test, assert } from './harness';
import { parseQuestionNote, type Question } from '../src/parser';
import {
    INDEX_SCHEMA,
    decodeIndexData,
    emptyIndexData,
    encodeIndexData,
    type VaultIndexData,
} from '../src/vault/indexCodec';
import type { SessionLogState } from '../src/vault/sessionLog';
import { VaultIndexStore } from '../src/vault/vaultIndex';

const NOTE = [
    '## QUESTIONS <!--debug-called-definitions-->',
    'What is 2 + 2?',
    '',
    '## ANSWERS <!--ignore-warnings-->',
    '4',
    '',
].join('\n');

function sampleQuestion(): Question {
    const q = parseQuestionNote('review/rv-sample.md', NOTE, 'review');
    assert.ok(q, 'sample note must parse');
    return q;
}

function sampleIndex(): VaultIndexData {
    const q = sampleQuestion();
    const data = emptyIndexData(
        { reviewDir: 'review', sessionsSubdir: 'sessions' },
        '0.1.0',
    );
    data.questions['review/rv-sample.md'] = {
        mtime: 123,
        size: 456,
        q,
        issue: null,
        verdict: { error: null, warnings: [], choiceCount: 4 },
    };
    data.sessions['review/sessions/session-1.md'] = {
        mtime: 789,
        size: 1011,
        log: {
            session_id: 'session-1',
            session_name: 'Sample',
            status: 'completed',
        } as unknown as SessionLogState,
    };
    return data;
}

test('index round-trips questions and session summaries', async () => {
    const encoded = await encodeIndexData(sampleIndex());
    const decoded = await decodeIndexData(encoded);
    assert.ok(decoded, 'index must decode');

    const entry = decoded.questions['review/rv-sample.md'];
    assert.ok(entry && entry.q, 'question entry must survive');
    assert.equal(entry.q.path, 'review/rv-sample.md');
    assert.equal(entry.mtime, 123);
    assert.equal(entry.verdict?.choiceCount, 4);
    assert.ok(entry.q.ignoredWarnings instanceof Set);
    assert.ok(entry.q.ignoredWarnings.has('answers'));
    assert.ok(entry.q.literalSections instanceof Set);
    assert.ok(entry.q.literalSections.has('questions'));

    const session = decoded.sessions['review/sessions/session-1.md'];
    assert.ok(session, 'session entry must survive');
    assert.equal(session.log?.session_id, 'session-1');
});

test('index decoding rejects an outdated schema', async () => {
    const data = sampleIndex();
    data.schema = INDEX_SCHEMA + 1;
    assert.equal(await decodeIndexData(await encodeIndexData(data)), null);
});

test('index decoding returns null for a corrupt buffer', async () => {
    const bytes = new TextEncoder().encode('not json at all');
    assert.equal(
        await decodeIndexData(
            bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
        ),
        null,
    );
});

test('index decoding accepts the uncompressed JSON fallback', async () => {
    const plain = JSON.stringify({
        schema: INDEX_SCHEMA,
        pluginVersion: '0.1.0',
        scope: { reviewDir: 'review', sessionsSubdir: 'sessions' },
        builtAt: 0,
        questions: {},
        sessions: {},
    });
    const bytes = new TextEncoder().encode(plain);
    const decoded = await decodeIndexData(
        bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
    );
    assert.ok(decoded);
    assert.deepEqual(decoded.scope, {
        reviewDir: 'review',
        sessionsSubdir: 'sessions',
    });
});

test('index store writes, reads, and replaces the cache atomically', async () => {
    const files = new Map<string, ArrayBuffer>();
    const adapter = {
        exists: async (path: string) => files.has(path),
        mkdir: async () => undefined,
        readBinary: async (path: string) => files.get(path)!.slice(0),
        writeBinary: async (path: string, data: ArrayBuffer) => {
            files.set(path, data);
        },
        remove: async (path: string) => {
            files.delete(path);
        },
        rename: async (from: string, to: string) => {
            const data = files.get(from);
            if (!data) return;
            files.set(to, data);
            files.delete(from);
        },
    };
    const app = {
        vault: { adapter },
    } as unknown as ConstructorParameters<typeof VaultIndexStore>[0];

    const store = new VaultIndexStore(app, '.obsidian/plugins/active-review');
    assert.equal(await store.load(), null, 'missing cache reads as null');

    await store.save(sampleIndex());
    const loaded = await store.load();
    assert.ok(loaded, 'saved cache must load');
    assert.equal(loaded.questions['review/rv-sample.md']?.size, 456);
    assert.ok(
        [...files.keys()].some((path) => path.endsWith('cache/index.json.gz')),
        'cache file lives under cache/index.json.gz',
    );
    assert.ok(
        ![...files.keys()].some((path) => path.endsWith('.tmp')),
        'temporary file must be renamed away',
    );

    await store.save(emptyIndexData(sampleIndex().scope, '0.1.0'));
    const replaced = await store.load();
    assert.deepEqual(replaced?.questions, {});
});
