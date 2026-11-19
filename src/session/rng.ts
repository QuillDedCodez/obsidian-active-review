/** Seeded RNG primitives + seed derivation — one source of randomness. */
import type { SessionConfig } from '../constants';

// ============================================================================
// RNG primitives
// ============================================================================

/** FNV-1a 32-bit hash of a string. Stable across runs. */
export function hashString(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Mulberry32 PRNG. Deterministic given the same seed. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Fisher–Yates shuffle driven by a caller-supplied rng. */
export function shuffleSeeded<T>(arr: T[], rng: () => number): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
}

// ============================================================================
// Seed derivation
// ============================================================================

/** Generate a fresh seed_input when the user left the seed field at 0. */
export function generateRandomSeedInput(): number {
    return 1 + Math.floor(Math.random() * 2_000_000_000);
}

/**
 * Canonical selection string. Only fields that affect **which questions
 * are picked** feed the seed. `order` is excluded so that changing display
 * order doesn't change the subset.
 */
export function canonicalSelectionString(config: SessionConfig): string {
    return `count=${config.count === 'all' ? 'all' : config.count}|trim=${config.trim}`;
}

/** Effective seed for the session — hash of (seed_input, selection, paths). */
export function deriveSessionSeed(
    seedInput: number,
    config: SessionConfig,
    relativePaths: string[],
): number {
    const pathsStr = [...relativePaths].sort().join('\n');
    return hashString(`${seedInput}|${canonicalSelectionString(config)}|${pathsStr}`);
}

/**
 * Sub-stream seed for one independent RNG domain. Splitting the streams
 * means changing trim doesn't shift the order stream, changing order
 * doesn't shift the option stream, per-question option streams stay
 * stable regardless of session-level reorderings, and per-question draw
 * streams (`'draws'`) reproduce every `pick()` / `rand()` / `exprPick()`
 * value for the same seed.
 */
export function deriveStreamSeed(
    sessionSeed: number,
    streamName: 'trim' | 'order' | 'draws' | 'options' | 'variant',
    extra: string = '',
): number {
    return hashString(`${streamName}|${sessionSeed}|${extra}`);
}