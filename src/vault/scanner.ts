/** Read every quiz note in the vault, and react to vault changes. */
import { debounce, type Plugin, type TFile, type Vault } from 'obsidian';
import { isQuizPath, parseQuestionNote, type Question } from '../parser';

export interface ScanFileStat {
    mtime: number;
    size: number;
}

export interface ScanResult {
    questions: Map<string, Question>;
    /** Fatal problems — the file was skipped. One message per file. */
    issues: Map<string, string>;
    /** Stat snapshot for every scanned file, used to build the persistent index. */
    files: Map<string, ScanFileStat>;
}

export interface VaultPaths {
    reviewDir: string;
    sessionsSubdir: string;
}

export interface ScanEntry extends ScanFileStat {
    question: Question | null;
    issue: string | null;
}

export interface VaultChange {
    path: string;
    /** Set on rename events: the previous path. */
    oldPath?: string;
    deleted?: boolean;
}

export type VaultChangeHandler = (changes: VaultChange[]) => void;

/**
 * Incremental note scanner. A file is re-parsed only when its mtime or size
 * changed; unchanged notes keep the same `Question` object identity so
 * downstream caches (validation, selection) stay warm.
 */
export class VaultScanner {
    private cache = new Map<string, ScanEntry>();
    private cacheScope = '';

    constructor(
        private vault: Vault,
        private getPaths: () => VaultPaths,
    ) {}

    async scan(): Promise<ScanResult> {
        const { reviewDir, sessionsSubdir } = this.getPaths();
        this.syncScope(reviewDir, sessionsSubdir);

        const files = this.relevantFiles(reviewDir, sessionsSubdir);
        const live = new Set(files.map((f) => f.path));
        for (const path of [...this.cache.keys()]) {
            if (!live.has(path)) this.cache.delete(path);
        }

        const questions = new Map<string, Question>();
        const issues = new Map<string, string>();
        const stats = new Map<string, ScanFileStat>();

        for (const file of files) {
            const entry = await this.parseFile(file);
            stats.set(file.path, { mtime: entry.mtime, size: entry.size });
            if (entry.question) questions.set(file.path, entry.question);
            else if (entry.issue) issues.set(file.path, entry.issue);
        }

        return { questions, issues, files: stats };
    }

    /** Parse one file, reusing the cached entry when its stat is unchanged. */
    async parseFile(file: TFile): Promise<ScanEntry> {
        const { reviewDir } = this.getPaths();
        const cached = this.cache.get(file.path);
        if (
            cached &&
            cached.mtime === file.stat.mtime &&
            cached.size === file.stat.size
        ) {
            return cached;
        }
        const entry = await this.parse(file, reviewDir);
        this.cache.set(file.path, entry);
        return entry;
    }

    private syncScope(reviewDir: string, sessionsSubdir: string): void {
        const scope = `${reviewDir}\u0000${sessionsSubdir}`;
        if (scope !== this.cacheScope) {
            this.cache.clear();
            this.cacheScope = scope;
        }
    }

    private relevantFiles(reviewDir: string, sessionsSubdir: string): TFile[] {
        return this.vault
            .getMarkdownFiles()
            .filter((f) => isQuizPath(f.path, reviewDir, sessionsSubdir))
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    private async parse(file: TFile, reviewDir: string): Promise<ScanEntry> {
        const stat = { mtime: file.stat.mtime, size: file.stat.size };
        try {
            const q = parseQuestionNote(
                file.path,
                await this.vault.cachedRead(file),
                reviewDir,
            );
            return { ...stat, question: q, issue: null };
        } catch (e) {
            return { ...stat, question: null, issue: (e as Error).message };
        }
    }
}

/**
 * Batches vault events into change sets. Full-scan policy lives in the caller;
 * this only reports which paths changed.
 */
export function registerVaultEvents(
    plugin: Plugin,
    getPaths: () => VaultPaths,
    onChange: VaultChangeHandler,
): () => void {
    let queue: VaultChange[] = [];
    const flush = debounce(() => {
        const changes = queue;
        queue = [];
        if (changes.length > 0) onChange(changes);
    }, 500, true);

    const relevant = (path: string): boolean => {
        const { reviewDir } = getPaths();
        const prefix = reviewDir.endsWith('/') ? reviewDir : `${reviewDir}/`;
        return path.startsWith(prefix);
    };

    const push = (change: VaultChange): void => {
        queue.push(change);
        flush();
    };

    plugin.registerEvent(
        plugin.app.vault.on('create', (f) => {
            if (relevant(f.path)) push({ path: f.path });
        }),
    );
    plugin.registerEvent(
        plugin.app.vault.on('modify', (f) => {
            if (relevant(f.path)) push({ path: f.path });
        }),
    );
    plugin.registerEvent(
        plugin.app.vault.on('delete', (f) => {
            if (relevant(f.path)) push({ path: f.path, deleted: true });
        }),
    );
    plugin.registerEvent(
        plugin.app.vault.on('rename', (f, oldPath) => {
            if (relevant(f.path) || relevant(oldPath)) {
                push({ path: f.path, oldPath });
            }
        }),
    );

    return () => {
        flush.cancel();
        queue = [];
    };
}
