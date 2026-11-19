/** Format a number for display: up to 4 decimals, no trailing zeros. */
export function fmt(n: number): string {
    if (!Number.isFinite(n)) return String(n);
    const s = Math.abs(n) >= 1e15 ? n.toPrecision(6) : String(Number(n.toFixed(4)));
    return s === '-0' ? '0' : s;
}