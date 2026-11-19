/**
 * In-memory view of the session index. The persistent copy lives in the
 * plugin's index file; `rebuild()` is only called by a full scan.
 */
import { TFile, type Vault } from 'obsidian';
import {
    parseSessionLog,
    type PendingSessionFile,
    type SessionLogState,
    type SessionStatus,
    type SessionSummary,
} from './sessionLog';

export interface SessionIndexEntry {
    mtime: number;
    size: number;
    log: SessionLogState | null;
}

const STATUS_ORDER: Record<SessionStatus, number> = {
    pending: 0,
    completed: 1,
    abandoned: 2,
    archived: 3,
};

export function isSessionFilePath(
    path: string,
    reviewDir: string,
    sessionsSubdir: string,
): boolean {
    const sessionDir = `${reviewDir}/${sessionsSubdir}/`;
    if (!path.startsWith(sessionDir)) return false;
    const base = path.split('/').pop() ?? '';
    return base.startsWith('session-') && base.endsWith('.md');
}

function previewOf(log: SessionLogState): PendingSessionFile['preview'] {
    return {
        session_id: log.session_id,
        session_name: log.session_name,
        status: log.status,
        created: log.created,
    };
}

export class SessionIndex {
    private entries = new Map<string, SessionIndexEntry>();

    constructor(
        private vault: Vault,
        private getPaths: () => { reviewDir: string; sessionsSubdir: string },
    ) {}

    /** Replace the whole index with entries loaded from the persistent index. */
    hydrate(entries: Iterable<[string, SessionIndexEntry]>): void {
        this.entries = new Map(entries);
    }

    setEntry(path: string, entry: SessionIndexEntry): void {
        this.entries.set(path, entry);
    }

    remove(path: string): void {
        this.entries.delete(path);
    }

    has(path: string): boolean {
        return this.entries.has(path);
    }

    rename(oldPath: string, newPath: string): void {
        const entry = this.entries.get(oldPath);
        if (!entry) return;
        this.entries.delete(oldPath);
        this.entries.set(newPath, entry);
    }

    snapshot(): Map<string, SessionIndexEntry> {
        return new Map(this.entries);
    }

    async list(): Promise<SessionSummary[]> {
        const out: SessionSummary[] = [];
        for (const [path, entry] of this.entries) {
            if (!entry.log) continue;
            const file = this.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;
            out.push({ file, log: entry.log });
        }
        out.sort((a, b) => {
            const byStatus =
                STATUS_ORDER[a.log.status] - STATUS_ORDER[b.log.status];
            if (byStatus !== 0) return byStatus;
            return b.log.created.localeCompare(a.log.created);
        });
        return out;
    }

    async pending(): Promise<PendingSessionFile[]> {
        const all = await this.list();
        return all
            .filter((summary) => summary.log.status === 'pending')
            .map(({ file, log }) => ({ file, preview: previewOf(log) }));
    }

    /**
     * Full pass over the sessions folder. Only changed files are parsed, so a
     * rescan after a few edits stays cheap. Returns true when entries changed.
     */
    async rebuild(): Promise<boolean> {
        const { reviewDir, sessionsSubdir } = this.getPaths();
        let changed = false;

        const files = this.vault
            .getMarkdownFiles()
            .filter((file) => isSessionFilePath(file.path, reviewDir, sessionsSubdir))
            .sort((a, b) => a.path.localeCompare(b.path));

        const live = new Set(files.map((file) => file.path));
        for (const path of [...this.entries.keys()]) {
            if (!live.has(path)) {
                this.entries.delete(path);
                changed = true;
            }
        }

        for (const file of files) {
            const cached = this.entries.get(file.path);
            if (
                cached &&
                cached.mtime === file.stat.mtime &&
                cached.size === file.stat.size
            ) {
                continue;
            }
            this.entries.set(file.path, await this.read(file));
            changed = true;
        }

        return changed;
    }

    /** Parse one session note and return its index entry. */
    async read(file: TFile): Promise<SessionIndexEntry> {
        let log: SessionLogState | null = null;
        try {
            log = parseSessionLog(await this.vault.read(file));
        } catch {
            log = null;
        }
        return { mtime: file.stat.mtime, size: file.stat.size, log };
    }
}
