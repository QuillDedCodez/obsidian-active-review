/** Reads and writes the persistent index in the plugin folder. */
import { normalizePath, type App } from 'obsidian';
import {
    decodeIndexData,
    encodeIndexData,
    type VaultIndexData,
} from './indexCodec';
import { MESSAGE_PREFIX } from '../constants';

const CACHE_DIR = 'cache';
const CACHE_FILE = 'index.json.gz';

/**
 * `<plugin dir>/cache/index.json.gz`, written atomically. A missing directory
 * or unreadable file is never fatal: the caller falls back to a bootstrap scan.
 *
 * The previous file is rotated to `.bak` before the new one is moved into
 * place, and `load()` falls back to `.bak` (then a leftover `.tmp`). A quit in
 * the middle of a write therefore cannot destroy the only copy.
 */
export class VaultIndexStore {
    /** Serializes writes so quit-time and debounced saves cannot interleave. */
    private saveChain: Promise<void> = Promise.resolve();

    constructor(
        private app: App,
        private pluginDir: string | undefined,
    ) {}

    private get baseDir(): string | null {
        return this.pluginDir ?? null;
    }

    private get filePath(): string | null {
        const dir = this.baseDir;
        return dir ? normalizePath(`${dir}/${CACHE_DIR}/${CACHE_FILE}`) : null;
    }

    async load(): Promise<VaultIndexData | null> {
        const path = this.filePath;
        if (!path) return null;
        const adapter = this.app.vault.adapter;
        // Prefer the live file, then the rotation backup, then an interrupted
        // write's temp file. Corrupt candidates decode to null and are skipped.
        for (const candidate of [path, `${path}.bak`, `${path}.tmp`]) {
            try {
                if (!(await adapter.exists(candidate))) continue;
                const decoded = await decodeIndexData(
                    await adapter.readBinary(candidate),
                );
                if (decoded) return decoded;
            } catch {
                // Try the next candidate.
            }
        }
        return null;
    }

    save(data: VaultIndexData): Promise<void> {
        const run = this.saveChain.then(() => this.write(data));
        this.saveChain = run.catch(() => undefined);
        return run;
    }

    private async write(data: VaultIndexData): Promise<void> {
        const dir = this.baseDir;
        const path = this.filePath;
        if (!dir || !path) return;
        const cacheDir = normalizePath(`${dir}/${CACHE_DIR}`);
        const tmp = `${path}.tmp`;
        const bak = `${path}.bak`;
        try {
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(cacheDir))) await adapter.mkdir(cacheDir);

            // Encode and write fully before touching the live index.
            await adapter.writeBinary(tmp, await encodeIndexData(data));

            const hadOld = await adapter.exists(path);
            if (hadOld) {
                if (await adapter.exists(bak)) await adapter.remove(bak);
                await adapter.rename(path, bak);
            }
            try {
                await adapter.rename(tmp, path);
            } catch (e) {
                // Restore the previous index if the new one could not be put
                // in place, so the next start still has a usable cache.
                if (
                    hadOld &&
                    !(await adapter.exists(path)) &&
                    (await adapter.exists(bak))
                ) {
                    try {
                        await adapter.rename(bak, path);
                    } catch {
                        // Keep the .bak; `load()` can still use it.
                    }
                }
                throw e;
            }
            if (hadOld && (await adapter.exists(bak))) {
                await adapter.remove(bak);
            }
        } catch (e) {
            console.error(`${MESSAGE_PREFIX} could not write the question index`, e);
        }
    }

    async clear(): Promise<void> {
        const path = this.filePath;
        if (!path) return;
        const adapter = this.app.vault.adapter;
        for (const candidate of [path, `${path}.bak`, `${path}.tmp`]) {
            try {
                if (await adapter.exists(candidate)) await adapter.remove(candidate);
            } catch {
                // Ignore: a missing cache is the same as an empty one.
            }
        }
    }
}
