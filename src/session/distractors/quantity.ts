/**
 * Quantity-mode distractor chain (Proposal 2 §10).
 *
 * Order: pick-family variable perturbations, then author `## DISTRACTORS`
 * blocks, then display-grid deviations. Every candidate is formatted through the
 * answer's own policy, so a wrong choice never shows a different unit system or
 * prefix convention from the correct one.
 */
import { SECTIONS } from '../../parser';
import { conditionDistractors, fillConditionedDistractor } from './condition';
import { describe, resolve, type Resolved } from '../resolve';
import { drawableAlternatives } from '../draws';
import { shuffleSeeded } from '../rng';
import {
    compoundStep,
    displayKey,
    displayValue,
    fmtQuantity,
    parseQuantityInput,
    precisionStep,
    quantityTolerance,
    resolveAnswer,
    resolveLayout,
    roundSig,
    truncateSig,
    type AnswerSlotSpec,
    type AnswerSpec,
    type ResolvedQuantityAnswer,
} from '../../math/units';
import type { Question, VarDef, Warning } from '../../parser';
import type { Value } from '../types';

export interface QuantityDistractor {
    /** Canonical value, when the distractor is numeric. */
    canonical?: number;
    /** Final display text (author-supplied literal that could not be parsed). */
    text?: string;
    note: string;
    source: 'pick-family' | 'author' | 'grid';
}

export interface BuildQuantityDistractorsResult {
    distractors: QuantityDistractor[];
    warnings: Warning[];
}

/** Snap `x` to a multiple of `grid`. */
function roundGrid(x: number, grid: number): number {
    if (!Number.isFinite(grid) || grid <= 0) return x;
    return Math.round(x / grid) * grid;
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
function perturbable(q: Question, answerNames: string[]): VarDef[] {
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

/** Canonical value of the bound answer for a perturbed draw. */
function canonicalFor(spec: AnswerSpec, values: Record<string, Value>): number | null {
    try {
        return resolveAnswer(spec, values).canonical;
    } catch {
        return null;
    }
}

export function buildQuantityDistractors(
    q: Question,
    given: Record<string, Value>,
    resolved: Resolved,
    answer: ResolvedQuantityAnswer,
    rng: () => number,
    needed: number = 3,
): BuildQuantityDistractorsResult {
    const policy = answer.policy;
    const warnings: Warning[] = [];
    const conditioned = conditionDistractors(q, resolved);
    warnings.push(...conditioned.warnings);
    const found: QuantityDistractor[] = [];
    const correctKey = displayKey(answer.canonical, policy);
    const takenKeys = new Set<string>([correctKey]);
    const takenValues: number[] = [answer.canonical];
    const tolerance = quantityTolerance(answer.canonical, policy);

    const push = (candidate: QuantityDistractor): void => {
        if (found.length >= needed) return;
        if (candidate.canonical !== undefined) {
            if (
                takenValues.some(
                    (t) => Math.abs(t - candidate.canonical!) <= tolerance.canonicalStep,
                )
            ) {
                return;
            }
            const key = displayKey(candidate.canonical, policy);
            if (takenKeys.has(key)) return;
            takenKeys.add(key);
            takenValues.push(candidate.canonical);
        } else if (candidate.text !== undefined) {
            if (takenKeys.has(candidate.text)) return;
            takenKeys.add(candidate.text);
        } else return;
        found.push(candidate);
    };

    // 1. Pick-family: perturb one variable, recompute every value, keep the
    //    coupled answer. This preserves author-declared relationships.
    const specs = q.answerSpec;
    if (specs) {
        const pool = perturbable(q, q.answerValNames);
        for (const def of shuffleSeeded([...pool], rng)) {
            if (found.length >= needed) break;
            for (const alt of shuffleSeeded(drawableAlternatives(def, rng), rng)) {
                if (found.length >= needed) break;
                if (alt === given[def.name]) continue;
                try {
                    const candidate = resolve(q.vars, { ...given, [def.name]: alt });
                    const canonical = canonicalFor(specs, candidate.values);
                    if (canonical === null) continue;
                    push({
                        canonical,
                        note: describe([def.name], candidate.values),
                        source: 'pick-family',
                    });
                } catch {
                    // Skip draws that cannot be resolved.
                }
            }
        }
    }
    const pickFamilyCount = found.length;

    // 2. Author blocks: fill placeholders, then parse as a quantity.
    for (const block of q.distractorBlocks) {
        if (found.length >= needed) break;
        const text = fillConditionedDistractor(
            block.trim(),
            resolved,
            conditioned,
            q.literalSections.has(SECTIONS.DISTRACTORS),
            {
                [policy.valueName]: (math: boolean) =>
                    fmtQuantity(answer.canonical, policy, { math }),
            },
        ).trim();
        if (text === '') continue;
        const parsed = parseQuantityInput(text, policy);
        if (parsed !== null) {
            const scale = parsed.unit === null ? answer.displayScale : parsed.unit.scale;
            push({
                canonical: parsed.magnitude * scale,
                note: 'author-supplied',
                source: 'author',
            });
            continue;
        }
        push({ text, note: 'author-supplied (unparsed text)', source: 'author' });
        warnings.push({
            section: 'distractors',
            message: `## DISTRACTORS block "${text}" is not a parseable quantity — kept as literal text`,
        });
    }
    const authorCount = found.length - pickFamilyCount;

    // 3. Display-grid deviations (replaces the earlier ±10% chain).
    const compound = policy.components !== undefined && policy.components.length > 0;
    const layout = compound ? null : resolveLayout(answer.canonical, policy);
    const scale = compound ? 1 : layout!.display.scale;
    const offset = compound ? 0 : (layout!.display.unit.offset ?? 0);
    const shown = compound ? answer.canonical : displayValue(answer.canonical, policy);
    const zeroTol = policy.tol / scale;
    const precision = policy.precision;
    const grid = precision
        ? compound
            ? compoundStep(policy, precision.kind === 'decimals' ? precision.max : 0)
            : precisionStep(shown, precision, zeroTol, layout!.exponent)
        : compound
          ? policy.tol
          : zeroTol;
    if (found.length < needed) {
        const raw: number[] = [];
        for (const k of [1, 2, 3, 5, 10]) raw.push(shown + k * grid, shown - k * grid);
        for (const r of [0.01, 0.02, 0.05, 0.1, 0.2]) {
            raw.push(roundGrid(shown * (1 + r), grid), roundGrid(shown * (1 - r), grid));
        }
        for (const m of [-3, -2, -1, 1, 2, 3]) raw.push(roundGrid(shown * Math.pow(10, m), grid));
        if (precision?.kind === 'sigfigs') {
            raw.push(
                roundSig(shown, Math.max(1, precision.min - 1)),
                truncateSig(shown, precision.min),
            );
        } else if (precision?.kind === 'decimals' && !compound) {
            const factor = Math.pow(10, precision.max);
            raw.push(Math.round(shown * factor) / factor, Math.trunc(shown * factor) / factor);
        }
        raw.push(-shown);

        for (const value of shuffleSeeded(raw, rng)) {
            if (found.length >= needed) break;
            if (!Number.isFinite(value)) continue;
            push({
                canonical: value * scale + offset,
                note: '— grid deviation',
                source: 'grid',
            });
        }
    }

    if (found.length < needed) {
        warnings.push({
            section: 'distractors',
            message: `only ${found.length} of ${needed} required distractors produced — MCQ will show fewer choices or fall back to typed mode`,
        });
    }
    if (authorCount > 0 && pickFamilyCount === 0) {
        warnings.push({
            section: 'distractors',
            message: 'using author-supplied ## DISTRACTORS — rv-def produced no usable quantity distractors',
        });
    }

    return { distractors: found, warnings };
}

/** Display text for a distractor under the answer's policy. */
export function distractorText(
    distractor: QuantityDistractor,
    policy: AnswerSlotSpec,
): string {
    if (distractor.canonical !== undefined) return fmtQuantity(distractor.canonical, policy);
    return distractor.text ?? '';
}
