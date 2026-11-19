/**
 * Numeric-mode distractor chain. Accepts a caller-supplied `rng` so
 * re-entering the same seed reproduces the same distractors.
 */
import { TOLERANCE } from '../../constants';
import {
    effectiveCount,
    extractPlaceholders,
    isFlipped,
    linkName,
    SECTIONS,
    type Question,
    type VarDef,
    type Warning,
} from '../../parser';
import { fmt } from '../../math';
import { evaluateExpression } from '../../math/symbolic';
import {
    MAX_ALTERNATIVES,
    beyondRange,
    buildMaxIndexSample,
    inRange,
    round,
    sampleIndices,
} from '../draws';
import { shuffleSeeded } from '../rng';
import { computeAnswer, describe, resolve, type Resolved } from '../resolve';
import { conditionDistractors, fillConditionedDistractor } from './condition';
import type { Value } from '../types';

export interface NumericDistractor {
    value: number;
    note: string;
    source: 'pick-family' | 'author' | 'deviation';
}

export interface BuildNumericDistractorsResult {
    distractors: NumericDistractor[];
    warnings: Warning[];
}

function isDrawable(def: VarDef): boolean {
    return (
        def.kind === 'rand' ||
        def.kind === 'pick' ||
        def.kind === 'stringPick' ||
        def.kind === 'exprPick' ||
        def.kind === 'unit' ||
        def.kind === 'prefix' ||
        def.kind === 'quantityPick'
    );
}

/** Walk answer placeholders back to their drawable dependencies. */
function dependentDrawables(q: Question, answerNames: string[]): VarDef[] {
    const byName = new Map(q.vars.map((def) => [def.name, def]));
    const reached = new Set<string>();
    const visit = (name: string): void => {
        if (reached.has(name)) return;
        reached.add(name);
        const def = byName.get(name);
        if (!def) return;
        for (const dependency of def.dependencies ?? []) visit(dependency);
    };
    for (const name of answerNames) visit(name);
    return q.vars.filter((def) => reached.has(def.name) && isDrawable(def));
}

function combinationCount(q: Question): number {
    let count = 1;
    const inGroup = new Set<string>();
    for (const group of q.links) {
        const leader = q.vars.find((d) => d.name === linkName(group[0] ?? ''));
        if (!leader) continue;
        const hasDrawable = group.some((member) => {
            const d = q.vars.find((x) => x.name === linkName(member));
            return d !== undefined && (d.kind === 'pick' || d.kind === 'rand' || d.kind === 'exprPick');
        });
        if (!hasDrawable) continue;
        const c = effectiveCount(leader);
        if (c > 0) count *= c;
        for (const member of group) inGroup.add(linkName(member));
    }
    for (const d of q.vars) {
        if (inGroup.has(d.name)) continue;
        if (d.kind === 'pick' || d.kind === 'rand' || d.kind === 'exprPick') {
            const c = effectiveCount(d);
            if (c > 0) count *= c;
        }
    }
    return count;
}

function authorDistractorValue(block: string, resolved: Resolved): number | null {
    const refs = extractPlaceholders(block);
    const firstVal = refs.find((r) => r.kind === 'val');
    if (firstVal) {
        const v = resolved.values[firstVal.name];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    const expression = refs.find((r) => r.kind === 'expression');
    if (expression) {
        const source = resolved.sources[expression.name];
        if (typeof source === 'number' && Number.isFinite(source)) return source;
        if (typeof source === 'string') {
            const value = evaluateExpression(source, resolved.values, expression.args);
            if (value !== null) return value;
        }
    }
    const numMatch = /\b(\d+(?:\.\d+)?)\b/.exec(block);
    if (numMatch) {
        const n = Number(numMatch[1]);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function deviationFrom(base: number, taken: number[], rng: () => number, maxAttempts = 20): number | null {
    const isZero = Math.abs(base) < 1e-9;
    for (let i = 0; i < maxAttempts; i++) {
        const r = rng() * 0.1;
        if (r <= 0) continue;
        const sign = rng() < 0.5 ? -1 : 1;
        const candidate = isZero ? round(sign * r) : round(base + sign * Math.abs(base) * r);
        if (!Number.isFinite(candidate)) continue;
        if (Math.abs(candidate - base) <= TOLERANCE) continue;
        if (taken.some((t) => Math.abs(t - candidate) <= TOLERANCE || fmt(t) === fmt(candidate))) continue;
        return candidate;
    }
    return null;
}

export function buildNumericDistractors(
    q: Question,
    given: Record<string, Value>,
    resolved: Resolved,
    correctNumbers: number[],
    rng: () => number,
    needed: number = 3,
): BuildNumericDistractorsResult {
    const pool = dependentDrawables(q, q.answerValNames);
    const taken: number[] = [...correctNumbers];
    const found: NumericDistractor[] = [];
    const warnings: Warning[] = [];
    const conditioned = conditionDistractors(q, resolved);
    warnings.push(...conditioned.warnings);
    const conditionedResolved: Resolved = { ...resolved, values: conditioned.values };

    const pushWarning = (message: string): void => {
        warnings.push({ section: 'distractors', message });
    };

    const tryAdd = (override: Record<string, Value>, changed: string[]): void => {
        if (found.length >= needed) return;
        try {
            const candidate = resolve(q.vars, { ...given, ...override });
            const v = computeAnswer(q, candidate.values);
            if (!Number.isFinite(v)) return;
            if (taken.some((t) => Math.abs(t - v) <= TOLERANCE || fmt(t) === fmt(v))) return;
            taken.push(v);
            found.push({ value: v, note: describe(changed, candidate.values), source: 'pick-family' });
        } catch {
            return;
        }
    };

    const tryAddRaw = (value: number, note: string, source: 'author' | 'deviation'): void => {
        if (found.length >= needed) return;
        if (!Number.isFinite(value)) return;
        if (taken.some((t) => Math.abs(t - value) <= TOLERANCE || fmt(t) === fmt(value))) return;
        taken.push(value);
        found.push({ value, note, source });
    };

    const groupOf = new Map<string, string[]>();
    for (const g of q.links) for (const member of g) groupOf.set(linkName(member), g);
    const inGroup = new Set<string>(groupOf.keys());

    const combos = combinationCount(q);
    const pickFamilyBaseline = found.length;

    outer: for (const group of q.links) {
        const leader = q.vars.find((d) => d.name === linkName(group[0] ?? ''));
        if (!leader) continue;
        const count = effectiveCount(leader);
        if (count < 2) continue;

        const members = group
            .map((member) => ({
                def: q.vars.find((d) => d.name === linkName(member)),
                flip: isFlipped(member),
            }))
            .filter((m): m is { def: VarDef; flip: boolean } => !!m.def && pool.includes(m.def));
        if (members.length < 2) continue;

        const anyRand = members.find((m) => m.def.kind === 'rand')?.def;
        let max_offset = 0;
        let gap = 1;
        if (anyRand) {
            const k = anyRand.max_index !== undefined ? anyRand.max_index : count;
            const sample = buildMaxIndexSample(anyRand.first, anyRand.last, anyRand.step, k);
            max_offset = sample.max_offset;
            gap = sample.gap;
        }

        const offsets =
            max_offset + 1 <= MAX_ALTERNATIVES
                ? Array.from({ length: max_offset + 1 }, (_, i) => i)
                : sampleIndices(max_offset + 1, rng, MAX_ALTERNATIVES);
        const indices =
            count <= MAX_ALTERNATIVES
                ? Array.from({ length: count }, (_, i) => i)
                : sampleIndices(count, rng, MAX_ALTERNATIVES);

        let attempts = 0;
        step: for (const offset of offsets) {
            for (const idx of indices) {
                if (found.length >= needed) break outer;
                // Hard budget per link group: a family that can never change the
                // answer must not make session start scale with its size.
                if (++attempts > MAX_ALTERNATIVES * 4) break step;
                const override: Record<string, Value> = {};
                let changed = false;
                for (const m of members) {
                    const def = m.def;
                    // Mirrors the shared index for flipped members, matching
                    // `drawAll`, so a candidate keeps the declared pairing.
                    const memberIdx = m.flip ? count - 1 - idx : idx;
                    let newVal: Value;
                    if (def.kind === 'rand') newVal = round(def.first + def.step * (offset + memberIdx * gap));
                    else if (def.kind === 'pick' || def.kind === 'stringPick') newVal = def.values![memberIdx] ?? 0;
                    else if (def.kind === 'exprPick') newVal = memberIdx;
                    else continue;
                    override[def.name] = newVal;
                    if (given[def.name] !== newVal) changed = true;
                }
                if (!changed) continue;
                tryAdd(override, group.map(linkName));
            }
        }
    }

    const singles = shuffleSeeded(
        pool
            .filter((d) => !inGroup.has(d.name) && d.kind !== 'stringPick')
            .flatMap((d) =>
                [...inRange(d, rng), ...beyondRange(d)]
                    .filter((v) => v !== given[d.name])
                    .map((v) => ({ d, v })),
            ),
        rng,
    );
    for (const { d, v } of singles) {
        if (found.length >= needed) break;
        tryAdd({ [d.name]: v }, [d.name]);
    }

    for (let tries = 0; tries < 300 && found.length < needed && pool.length > 1; tries++) {
        const subset = shuffleSeeded(pool, rng).slice(0, 2 + Math.floor(rng() * (pool.length - 1)));
        const expanded = new Set<string>(subset.map((d) => d.name));
        for (const d of subset) {
            const g = groupOf.get(d.name);
            if (g) for (const member of g) expanded.add(linkName(member));
        }
        const override: Record<string, Value> = {};
        for (const n of expanded) {
            const d = q.vars.find((x) => x.name === n);
            if (!d) continue;
            if (d.kind === 'pick' || d.kind === 'stringPick') {
                const vals = d.values ?? [];
                if (vals.length < 2) continue;
                const cur = given[n];
                let next = vals[Math.floor(rng() * vals.length)] ?? 0;
                let guard = 0;
                while (next === cur && guard++ < 5) next = vals[Math.floor(rng() * vals.length)] ?? 0;
                override[n] = next;
            } else if (d.kind === 'exprPick') {
                const vals = d.values ?? [];
                if (vals.length < 2) continue;
                let next = Math.floor(rng() * vals.length);
                let guard = 0;
                while (next === given[n] && guard++ < 5) next = Math.floor(rng() * vals.length);
                override[n] = next;
            } else if (d.kind === 'fixed' || d.kind === 'expr') {
                const opts = [...inRange(d, rng), ...beyondRange(d)].filter((v) => v !== given[n]);
                if (opts.length === 0) continue;
                override[n] = opts[Math.floor(rng() * opts.length)] ?? 0;
            }
        }
        tryAdd(override, [...expanded]);
    }

    const pickFamilyFound = found.length - pickFamilyBaseline;

    const authorBaseline = found.length;
    if (found.length < needed && q.distractorBlocks.length > 0) {
        for (const block of q.distractorBlocks) {
            if (found.length >= needed) break;
            const filled = fillConditionedDistractor(
                block,
                resolved,
                conditioned,
                q.literalSections.has(SECTIONS.DISTRACTORS),
            );
            const v = authorDistractorValue(filled, conditionedResolved);
            if (v === null) continue;
            tryAddRaw(v, 'author-supplied', 'author');
        }
    }
    const authorFound = found.length - authorBaseline;

    const deviationBaseline = found.length;
    if (found.length < needed) {
        for (const base of correctNumbers) {
            if (found.length >= needed) break;
            const d = deviationFrom(base, taken, rng);
            if (d !== null) tryAddRaw(d, '— ±X% deviation', 'deviation');
        }
        if (found.length < needed && correctNumbers.length === 1) {
            while (found.length < needed) {
                const d = deviationFrom(correctNumbers[0]!, taken, rng, 50);
                if (d === null) break;
                tryAddRaw(d, '— ±X% deviation', 'deviation');
            }
        }
    }
    const deviationFound = found.length - deviationBaseline;

    if (pickFamilyFound === 0) {
        pushWarning(`rv-def has ${combos} combination(s) — no pick-family distractors produced`);
        if (authorFound > 0 && deviationFound === 0) pushWarning(`using author-supplied ## DISTRACTORS to fill`);
        else if (deviationFound > 0) pushWarning(`using ±10% deviation to fill ${deviationFound} remaining`);
    } else if (pickFamilyFound < needed) {
        if (authorFound > 0 && deviationFound === 0) {
            pushWarning(`pick-family produced ${pickFamilyFound} — using author-supplied ## DISTRACTORS to fill`);
        } else if (authorFound === 0 && deviationFound > 0) {
            pushWarning(`pick-family produced ${pickFamilyFound}, no ## DISTRACTORS — using ±10% deviation for remaining`);
        } else if (authorFound > 0 && deviationFound > 0) {
            pushWarning(`pick-family: ${pickFamilyFound}, author: ${authorFound} — using ±10% deviation for ${deviationFound} remaining`);
        }
    }

    const total = pickFamilyFound + authorFound + deviationFound;
    if (total < needed) {
        pushWarning(`only ${total} of ${needed} required distractors produced — MCQ will show fewer choices or fall back to typed mode`);
    }

    return { distractors: found, warnings };
}