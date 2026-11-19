import { test, assert } from './harness';
import { TFile } from 'obsidian';
import ReviewQuizPlugin from '../src/main';

interface FakeFileInfo {
    path: string;
    content: string;
    mtime: number;
    size: number;
}

interface FakeEnv {
    app: unknown;
    adapterFiles: Map<string, ArrayBuffer>;
    cachedReads: () => number;
    files: Map<string, TFile>;
}

const PLUGIN_DIR = '.obsidian/plugins/active-review';
const CACHE_PATH = `${PLUGIN_DIR}/cache/index.json.gz`;

const NOTE_A = [
    '## QUESTIONS',
    'What is 2 + 2?',
    '',
    '## ANSWERS',
    '4',
    '',
].join('\n');

const NOTE_B = [
    '## QUESTIONS',
    'What is 3 + 3?',
    '',
    '## ANSWERS',
    '6',
    '',
].join('\n');

const SESSION = ['---', 'session_id: session-1', '---', ''].join('\n');

function makeFile(info: FakeFileInfo): TFile {
    const file = new (TFile as unknown as new () => TFile)();
    Object.assign(file, {
        path: info.path,
        stat: { mtime: info.mtime, size: info.size },
        basename: info.path.split('/').pop()?.replace(/\.md$/, '') ?? '',
        extension: 'md',
    });
    return file;
}

function makeEnv(
    contents: Record<string, string>,
    options: { failReads?: boolean; adapterFiles?: Map<string, ArrayBuffer> } = {},
): FakeEnv {
    const adapterFiles = options.adapterFiles ?? new Map<string, ArrayBuffer>();
    const files = new Map<string, TFile>();
    let cachedReadCount = 0;
    let index = 0;
    for (const [path, content] of Object.entries(contents)) {
        index++;
        const file = makeFile({
            path,
            content,
            mtime: 1000 + index,
            size: content.length,
        });
        files.set(path, file);
    }

    const readContent = (file: TFile): string => {
        const info = contents[file.path];
        if (info === undefined) throw new Error(`missing ${file.path}`);
        return info;
    };

    const adapter = {
        exists: async (path: string) => adapterFiles.has(path),
        mkdir: async () => undefined,
        readBinary: async (path: string) => adapterFiles.get(path)!.slice(0),
        writeBinary: async (path: string, data: ArrayBuffer) => {
            adapterFiles.set(path, data);
        },
        remove: async (path: string) => {
            adapterFiles.delete(path);
        },
        rename: async (from: string, to: string) => {
            const data = adapterFiles.get(from);
            if (!data) return;
            adapterFiles.set(to, data);
            adapterFiles.delete(from);
        },
    };

    const vault = {
        adapter,
        configDir: '.obsidian',
        getMarkdownFiles: () => [...files.values()],
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        getAllLoadedFiles: () => [...files.values()],
        cachedRead: async (file: TFile) => {
            cachedReadCount++;
            if (options.failReads) throw new Error('disk read should not happen');
            return readContent(file);
        },
        read: async (file: TFile) => {
            if (options.failReads) throw new Error('disk read should not happen');
            return readContent(file);
        },
        on: () => ({ ref: 'fake' }),
        createFolder: async () => undefined,
    };

    return {
        app: {
            vault,
            workspace: { getLeavesOfType: () => [] },
        },
        adapterFiles,
        cachedReads: () => cachedReadCount,
        files,
    };
}

interface PluginInternals {
    app: unknown;
    manifest: unknown;
    registerEvent: (ref: unknown) => void;
    register: (dispose: () => void) => void;
    registerView: () => void;
    addRibbonIcon: () => void;
    addCommand: () => void;
    addSettingTab: () => void;
    loadData: () => Promise<unknown>;
    saveData: () => Promise<void>;
    initialize: () => Promise<void>;
    handleVaultChanges: (changes: { path: string }[]) => Promise<void>;
    writeIndexNow: () => Promise<void>;
    getQuestions: () => unknown[];
    getIssues: () => unknown[];
    getSessionIndex: () => { has: (path: string) => boolean };
    listSessions: () => Promise<unknown[]>;
}

function makePlugin(env: FakeEnv): PluginInternals {
    const plugin = new (ReviewQuizPlugin as unknown as new () => ReviewQuizPlugin)() as unknown as PluginInternals;
    plugin.app = env.app;
    plugin.manifest = {
        id: 'active-review',
        version: '0.1.0',
        dir: PLUGIN_DIR,
    };
    plugin.registerEvent = () => undefined;
    plugin.register = () => undefined;
    plugin.registerView = () => undefined;
    plugin.addRibbonIcon = () => undefined;
    plugin.addCommand = () => undefined;
    plugin.addSettingTab = () => undefined;
    plugin.loadData = async () => ({
        reviewDir: 'review',
        sessionsSubdir: 'sessions',
        forceShowWarnings: false,
    });
    plugin.saveData = async () => undefined;
    return plugin;
}

test('vault changes reparse only the changed note', async () => {
    const contents: Record<string, string> = {
        'review/rv-a.md': NOTE_A,
        'review/rv-b.md': NOTE_B,
        'review/sessions/session-1.md': SESSION,
    };
    const env = makeEnv(contents);
    const plugin = makePlugin(env);
    await plugin.initialize();
    const baselineReads = env.cachedReads();

    const broken = ['## QUESTIONS', 'What is 3 + 3?', ''].join('\n');
    contents['review/rv-b.md'] = broken;
    const file = env.files.get('review/rv-b.md')!;
    const stat = (file as unknown as { stat: { mtime: number; size: number } })
        .stat;
    stat.mtime += 10;
    stat.size = broken.length;

    await plugin.handleVaultChanges([{ path: 'review/rv-b.md' }]);

    assert.equal(plugin.getQuestions().length, 1, 'the broken note leaves the pool');
    assert.equal(plugin.getIssues().length, 1, 'the broken note becomes an issue');
    assert.equal(
        env.cachedReads() - baselineReads,
        1,
        'only the changed note is parsed',
    );

    await plugin.writeIndexNow();
});

test('bootstrap scan writes the index, and the next start reads it without parsing', async () => {
    const contents = {
        'review/rv-a.md': NOTE_A,
        'review/rv-b.md': NOTE_B,
        'review/sessions/session-1.md': SESSION,
    };
    const env = makeEnv(contents);

    const first = makePlugin(env);
    await first.initialize();
    assert.equal(first.getQuestions().length, 2, 'bootstrap loads both questions');
    assert.ok(env.cachedReads() > 0, 'bootstrap parses notes');
    assert.ok(env.adapterFiles.has(CACHE_PATH), 'bootstrap writes the cache');

    // A restart: the index exists, so no note may be read from disk.
    const restart = makeEnv(contents, {
        failReads: true,
        adapterFiles: env.adapterFiles,
    });
    const second = makePlugin(restart);
    await second.initialize();
    assert.equal(
        second.getQuestions().length,
        2,
        'hydration restores questions without parsing',
    );
    assert.equal(restart.cachedReads(), 0, 'startup must not read note bodies');
    assert.ok(
        second.getSessionIndex().has('review/sessions/session-1.md'),
        'session entries are hydrated from the index',
    );
});

test('the index falls back to the rotation backup', async () => {
    const contents = {
        'review/rv-a.md': NOTE_A,
        'review/rv-b.md': NOTE_B,
        'review/sessions/session-1.md': SESSION,
    };
    const env = makeEnv(contents);

    const first = makePlugin(env);
    await first.initialize();

    // Simulate a quit that rotated the live index to `.bak` before dying.
    const cache = env.adapterFiles.get(CACHE_PATH)!;
    env.adapterFiles.set(`${CACHE_PATH}.bak`, cache);
    env.adapterFiles.delete(CACHE_PATH);

    const restart = makeEnv(contents, {
        failReads: true,
        adapterFiles: env.adapterFiles,
    });
    const second = makePlugin(restart);
    await second.initialize();

    assert.equal(
        second.getQuestions().length,
        2,
        'the backup is used when the live index is missing',
    );
    assert.equal(restart.cachedReads(), 0, 'no note bodies are read');
});

test('the start-screen session list does not scan the vault', async () => {
    const sessionLog = [
        '---',
        'rv-session: true',
        'session_id: session-1',
        'status: pending',
        'created: 2026-01-01T00:00:00',
        '---',
        '',
    ].join('\n');
    const contents = {
        'review/rv-a.md': NOTE_A,
        'review/sessions/session-1.md': sessionLog,
    };
    const env = makeEnv(contents);
    const plugin = makePlugin(env);
    await plugin.initialize();

    // Any call after hydration would mean the start screen is reconciling the
    // vault instead of reading the hydrated session index.
    const vault = (env.app as { vault: { getMarkdownFiles: () => unknown } }).vault;
    vault.getMarkdownFiles = () => {
        throw new Error('start screen must not enumerate the vault');
    };
    const sessions = await plugin.listSessions();
    assert.equal(sessions.length, 1, 'the hydrated session is listed');
});
