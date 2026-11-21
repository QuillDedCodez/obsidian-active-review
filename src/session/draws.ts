/** Random draws and sampling ranges — all seeded via caller-supplied rng. */
import { effectiveCount, isFlipped, linkName, type VarDef } from '../parser';
import type { Value } from './types';

export const round = (n: number): number => Math.round(n * 1e9) / 1e9;

/**
 * Upper bound on candidate values explored per definition when building
 * distractors. Only the first three usable candidates matter; without a cap a
 * single question with a large `pick` family (thousands of values) makes session
 * start scale with the size of the family instead of with the question count.
 */
export const MAX_ALTERNATIVES = 60;

function uniformInclusive(min: number, max: number, rng: () => number): number {
    return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Deterministic sample of distinct indices in [0, length), without building or
 * shuffling the whole range. Small ranges are returned in full so existing
 * sessions keep their RNG stream and choices.
 */
export function sampleIndices(
    length: number,
    rng: () => number,
    limit: number,
): number[] {
    if (length <= 0) return [];
    if (length <= limit) return Array.from({ length }, (_, index) => index);
    const chosen = new Set<number>();
    const attempts = limit * 4;
    for (let i = 0; i < attempts && chosen.size < limit; i++) {
        chosen.add(Math.floor(rng() * length));
    }
    if (chosen.size < limit) {
        // Guaranteed fill if random draws collided; keeps the cap hard.
        const stride = Math.max(1, Math.floor(length / limit));
        for (let i = 0; i < length && chosen.size < limit; i += stride) {
            chosen.add(i);
        }
    }
    return [...chosen];
}

/**
 * Bounded alternatives for a drawable definition. `pick`/`stringPick` families
 * are sampled instead of copied wholesale; numeric ranges already sample.
 */
export function drawableAlternatives(
    def: VarDef,
    rng: () => number,
    limit: number = MAX_ALTERNATIVES,
): Value[] {
    if (def.kind === 'rand' || def.kind === 'exprPick') return inRange(def, rng);
    const values = def.values ?? [];
    if (values.length <= limit) return values.slice();
    return sampleIndices(values.length, rng, limit).map((index) => values[index]!);
}

export function buildMaxIndexSample(
    first: number,
    last: number,
    step: number,
    k: number,
): { gap: number; max_offset: number; count: number } {
    const low = Math.min(first, last);
    const high = Math.max(first, last);
    const n = Math.floor((high - low) / step + 1e-9) + 1;
    const kk = Math.min(k, n);
    if (kk === n) return { gap: 1, max_offset: 0, count: n };
    if (kk === 1) return { gap: 0, max_offset: n - 1, count: 1 };
    const gap = Math.floor((n - 1) / (kk - 1));
    const max_offset = (n - 1) - (kk - 1) * gap;
    return { gap, max_offset, count: kk };
}

/** Authored first-to-last direction. Decreasing ranges are allowed. */
export function randDirection(d: VarDef): 1 | -1 {
    return d.last < d.first ? -1 : 1;
}

export function randLow(d: VarDef): number {
    return Math.min(d.first, d.last);
}

export function randHigh(d: VarDef): number {
    return Math.max(d.first, d.last);
}

/** Value at a zero-based position from the authored `first` endpoint. */
export function randAt(d: VarDef, position: number): number {
    return round(d.first + randDirection(d) * d.step * position);
}

function stepCount(d: VarDef): number {
    if (
        (d.kind === 'pick' || d.kind === 'stringPick' || d.kind === 'unit' || d.kind === 'prefix' || d.kind === 'quantityPick') &&
        d.values
    ) {
        return d.values.length - 1;
    }
    return d.fixed ? 0 : Math.floor(Math.abs(d.last - d.first) / d.step + 1e-9);
}

function draw(d: VarDef, rng: () => number): Value {
    if (d.kind === 'exprPick') {
        return uniformInclusive(0, d.values!.length - 1, rng);
    }
    if (
        (d.kind === 'pick' ||
            d.kind === 'stringPick' ||
            d.kind === 'unit' ||
            d.kind === 'prefix' ||
            d.kind === 'quantityPick') &&
        d.values &&
        d.values.length > 0
    ) {
        return d.values[uniformInclusive(0, d.values.length - 1, rng)] ?? 0;
    }
    if (d.kind === 'rand' && d.max_index !== undefined) {
        const { gap, max_offset, count } = buildMaxIndexSample(d.first, d.last, d.step, d.max_index);
        const offset = uniformInclusive(0, max_offset, rng);
        const idx = uniformInclusive(0, count - 1, rng);
        return randAt(d, offset + idx * gap);
    }
    return randAt(d, uniformInclusive(0, stepCount(d), rng));
}

/** Draw every random variable, honouring link groups (one index shared across members). */
export function drawAll(
    defs: VarDef[],
    links: string[][],
    rng: () => number,
): Record<string, Value> {
    const drawn: Record<string, Value> = {};
    const linked = new Set<string>();

    for (const group of links) {
        const leader = defs.find((d) => d.name === linkName(group[0] ?? ''));
        if (!leader) continue;

        const members = group
            .map((member) => ({
                def: defs.find((d) => d.name === linkName(member)),
                flip: isFlipped(member),
            }))
            .filter((m): m is { def: VarDef; flip: boolean } => !!m.def);
        if (members.length === 0) continue;

        const count = effectiveCount(leader);
        if (count === 0) continue;

        let offset = 0;
        let gap = 1;
        const anyRand = members.find((m) => m.def.kind === 'rand')?.def;
        if (anyRand) {
            const k = anyRand.max_index !== undefined ? anyRand.max_index : count;
            const sample = buildMaxIndexSample(anyRand.first, anyRand.last, anyRand.step, k);
            offset = uniformInclusive(0, sample.max_offset, rng);
            gap = sample.gap;
        }

        const idx = uniformInclusive(0, count - 1, rng);

        for (const m of members) {
            const def = m.def;
            // A flipped member reads the shared index in reverse: its first
            // value pairs with the leader's last, and so on.
            const memberIdx = m.flip ? count - 1 - idx : idx;
            if (def.kind === 'rand') {
                drawn[def.name] = randAt(def, offset + memberIdx * gap);
            } else if (
                def.kind === 'pick' ||
                def.kind === 'stringPick' ||
                def.kind === 'unit' ||
                def.kind === 'prefix' ||
                def.kind === 'quantityPick'
            ) {
                drawn[def.name] = def.values?.[memberIdx] ?? 0;
            } else if (def.kind === 'exprPick') {
                drawn[def.name] = memberIdx;
            }
            linked.add(def.name);
        }
    }

    for (const d of defs) {
        if (linked.has(d.name)) continue;
        if (!d.fixed) drawn[d.name] = draw(d, rng);
    }
    return drawn;
}

/** Numeric candidates inside the declared range. Large-range sampling uses rng. */
export function inRange(d: VarDef, rng: () => number): number[] {
    if (d.kind === 'exprPick') return d.values!.map((_, i) => i);
    if (d.kind === 'unit' || d.kind === 'prefix' || d.kind === 'quantityPick') return [];
    if ((d.kind === 'pick' || d.kind === 'stringPick') && d.values) {
        const numeric = d.values.filter((v): v is number => typeof v === 'number');
        if (numeric.length <= MAX_ALTERNATIVES) return numeric;
        return sampleIndices(numeric.length, rng, MAX_ALTERNATIVES).map(
            (index) => numeric[index]!,
        );
    }
    const n = stepCount(d);
    if (n < MAX_ALTERNATIVES) {
        return Array.from({ length: n + 1 }, (_, k) => randAt(d, k));
    }
    const picks = new Set<number>();
    // Bounded sampling: rounding collisions must not turn this into a spin.
    for (let attempts = 0; attempts < MAX_ALTERNATIVES * 10 && picks.size < MAX_ALTERNATIVES; attempts++) {
        picks.add(randAt(d, Math.floor(rng() * (n + 1))));
    }
    if (picks.size < MAX_ALTERNATIVES) {
        const stride = Math.max(1, Math.floor((n + 1) / MAX_ALTERNATIVES));
        for (let k = 0; k <= n && picks.size < MAX_ALTERNATIVES; k += stride) {
            picks.add(randAt(d, k));
        }
    }
    return [...picks];
}