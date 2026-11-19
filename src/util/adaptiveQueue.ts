/**
 * Time-sliced, adaptive task queue.
 *
 * Work is processed in small batches on animation frames. The batch size
 * grows while slices finish well inside the budget and shrinks when a slice
 * overruns, so slow devices process fewer questions per frame and fast
 * devices catch up quickly. A slice always completes at least one task, so a
 * single expensive question can never be interrupted halfway through.
 */

export interface AdaptiveQueueStats {
    /** Tasks processed so far. */
    processed: number;
    /** Tasks still queued. */
    remaining: number;
    /** Current adaptive batch size. */
    batchSize: number;
    /** Smoothed milliseconds per task. */
    avgItemMs: number;
    /** Duration of the most recent slice. */
    lastSliceMs: number;
}

export interface AdaptiveQueueOptions {
    /** Target time budget for one animation-frame slice. */
    targetMs?: number;
    minBatch?: number;
    maxBatch?: number;
    /** Injectable clock (tests). */
    now?: () => number;
    /** Injectable frame scheduler (tests). */
    schedule?: (callback: () => void) => number;
    cancel?: (handle: number) => void;
    /** Called after every slice (including the final one). */
    onSlice?: (stats: AdaptiveQueueStats) => void;
}

interface QueuedTask<K> {
    key: K;
    run: () => void;
}

export class AdaptiveTaskQueue<K extends string | number = number> {
    private tasks: QueuedTask<K>[] = [];
    private keys = new Set<K>();
    private batchSize = 1;
    private avgItemMs = 0;
    private processed = 0;
    private lastSliceMs = 0;

    private running = false;
    private frame: number | null = null;

    private readonly targetMs: number;
    private readonly minBatch: number;
    private readonly maxBatch: number;
    private readonly now: () => number;
    private readonly schedule: (callback: () => void) => number;
    private readonly cancel: (handle: number) => void;
    private readonly onSlice: ((stats: AdaptiveQueueStats) => void) | null;

    constructor(options: AdaptiveQueueOptions = {}) {
        this.targetMs = Math.max(1, options.targetMs ?? 8);
        this.minBatch = Math.max(1, Math.floor(options.minBatch ?? 1));
        this.maxBatch = Math.max(this.minBatch, Math.floor(options.maxBatch ?? 32));
        this.now =
            options.now ??
            (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
        this.schedule =
            options.schedule ??
            ((callback) => {
                if (
                    typeof window !== 'undefined' &&
                    typeof window.requestAnimationFrame === 'function'
                ) {
                    return window.requestAnimationFrame(callback);
                }
                if (typeof window !== 'undefined') {
                    return window.setTimeout(callback, 16);
                }
                return 0;
            });
        this.cancel =
            options.cancel ??
            ((handle) => {
                if (typeof window === 'undefined') return;
                if (typeof window.cancelAnimationFrame === 'function') {
                    window.cancelAnimationFrame(handle);
                } else {
                    window.clearTimeout(handle);
                }
            });
        this.onSlice = options.onSlice ?? null;
    }

    get size(): number {
        return this.tasks.length;
    }

    get stats(): AdaptiveQueueStats {
        return {
            processed: this.processed,
            remaining: this.tasks.length,
            batchSize: this.batchSize,
            avgItemMs: this.avgItemMs,
            lastSliceMs: this.lastSliceMs,
        };
    }

    hasWork(): boolean {
        return this.tasks.length > 0;
    }

    /** Add a task. Duplicate keys are ignored until the task has run. */
    enqueue(key: K, run: () => void): void {
        if (this.keys.has(key)) return;
        this.keys.add(key);
        this.tasks.push({ key, run });
        this.wake();
    }

    /**
     * Move the given keys to the front, preserving their order. Missing keys
     * are ignored. This is used for the current/visible question and lookahead.
     */
    prioritize(keys: K[]): void {
        if (keys.length === 0 || this.tasks.length === 0) return;
        const wanted = new Set(keys);
        const front: QueuedTask<K>[] = [];
        const rest: QueuedTask<K>[] = [];
        for (const task of this.tasks) {
            if (wanted.has(task.key)) front.push(task);
            else rest.push(task);
        }
        const byKey = new Map(front.map((task) => [task.key, task]));
        const ordered: QueuedTask<K>[] = [];
        for (const key of keys) {
            const task = byKey.get(key);
            if (task) {
                ordered.push(task);
                byKey.delete(key);
            }
        }
        for (const task of byKey.values()) ordered.push(task);
        this.tasks = [...ordered, ...rest];
    }

    start(): void {
        this.running = true;
        this.wake();
    }

    stop(): void {
        this.running = false;
        if (this.frame !== null) {
            this.cancel(this.frame);
            this.frame = null;
        }
    }

    clear(): void {
        this.stop();
        this.tasks = [];
        this.keys.clear();
    }

    /**
     * Process one slice immediately. Public so tests can drive the queue with
     * an injected clock instead of animation frames.
     */
    runSlice(): AdaptiveQueueStats {
        if (this.tasks.length === 0) return this.stats;
        const start = this.now();
        const deadline = start + this.targetMs;
        let processedInSlice = 0;

        while (this.tasks.length > 0 && processedInSlice < this.batchSize) {
            if (processedInSlice > 0 && this.now() >= deadline) break;
            const task = this.tasks.shift()!;
            this.keys.delete(task.key);
            try {
                task.run();
            } catch (e) {
                console.warn(
                    '[rv] adaptive task failed:',
                    (e as Error).message,
                );
            }
            processedInSlice++;
            this.processed++;
        }

        const sliceMs = this.now() - start;
        this.lastSliceMs = sliceMs;
        if (processedInSlice > 0) {
            const per = sliceMs / processedInSlice;
            this.avgItemMs =
                this.avgItemMs === 0 ? per : this.avgItemMs * 0.7 + per * 0.3;
            this.adapt(sliceMs);
        }

        const stats = this.stats;
        this.onSlice?.(stats);
        return stats;
    }

    private adapt(sliceMs: number): void {
        if (sliceMs > this.targetMs * 1.5) {
            this.batchSize = Math.max(
                this.minBatch,
                Math.floor(this.batchSize / 2),
            );
            return;
        }
        if (sliceMs < this.targetMs * 0.5) {
            const predicted = Math.max(
                1,
                Math.floor(this.targetMs / Math.max(this.avgItemMs, 0.05)),
            );
            this.batchSize = Math.min(
                this.maxBatch,
                Math.max(this.batchSize + 1, predicted),
            );
        }
    }

    private wake(): void {
        if (!this.running || this.frame !== null || this.tasks.length === 0) {
            return;
        }
        this.frame = this.schedule(() => {
            this.frame = null;
            this.runSlice();
            if (this.running && this.tasks.length > 0) this.wake();
        });
    }
}
