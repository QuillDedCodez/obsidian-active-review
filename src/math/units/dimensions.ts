/** Dimension vectors: element-wise helpers. Never compare tuples by reference. */
import type { Dimension } from './types';

export const ZERO_DIM: Dimension = [0, 0, 0, 0, 0, 0, 0];

export const DIM_LABELS = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd'] as const;

export function addDim(a: Dimension, b: Dimension): Dimension {
    return [
        a[0] + b[0],
        a[1] + b[1],
        a[2] + b[2],
        a[3] + b[3],
        a[4] + b[4],
        a[5] + b[5],
        a[6] + b[6],
    ];
}

export function scaleDim(a: Dimension, k: number): Dimension {
    return [a[0] * k, a[1] * k, a[2] * k, a[3] * k, a[4] * k, a[5] * k, a[6] * k];
}

/** Element-wise equality. `a === b` on tuples is always false unless aliased. */
export function dimEquals(a: Dimension, b: Dimension): boolean {
    for (let i = 0; i < 7; i++) if (a[i] !== b[i]) return false;
    return true;
}

export function isDimensionless(a: Dimension): boolean {
    return dimEquals(a, ZERO_DIM);
}

/** `m*kg/s^2` style label, for diagnostics. */
export function dimToString(d: Dimension): string {
    const parts: string[] = [];
    for (let i = 0; i < 7; i++) {
        const e = d[i] ?? 0;
        if (e === 0) continue;
        parts.push(e === 1 ? DIM_LABELS[i]! : `${DIM_LABELS[i]}^${e}`);
    }
    return parts.length === 0 ? '1' : parts.join('*');
}
