/**
 * Build a SessionQuestion list from a pool of Questions. Also exports
 * `buildSessionFromFrozen` used on resume — rebuilds items from a saved
 * frozen pool + seed without re-filtering, re-trimming, or re-randomising.
 */
import { DEFAULT_SESSION_CONFIG, type SessionConfig } from '../constants';
import type { Question } from '../parser';
import { basename, relativeToReview } from '../util/paths';
import {
    deriveSessionSeed,
    deriveStreamSeed,
    generateRandomSeedInput,
    mulberry32,
    shuffleSeeded,
} from './rng';
import { orderPool } from './order';
import { buildQuestion } from './build';
import type { SessionQuestion } from './types';

function trimQuestions(
    pool: Question[],
    config: SessionConfig,
    trimRng: () => number,
): Question[] {
    if (config.count === 'all' || config.count >= pool.length) return pool.slice();
    if (config.trim === 'seq') return pool.slice(0, config.count);
    const chosen = shuffleSeeded(pool, trimRng).slice(0, config.count);
    const chosenSet = new Set(chosen.map((q) => q.path));
    return pool.filter((q) => chosenSet.has(q.path));
}

export interface BuildSessionResult {
    items: SessionQuestion[];
    errors: string[];
    sessionSeed: number;
    effectiveSeedInput: number;
    frozenPool: string[];
    initialOrder: number[];
}

/** One planned question: parsed note plus its stable frozen-pool index. */
export interface PlannedQuestion {
    question: Question;
    frozenIndex: number;
}

/**
 * Fast planning result. It contains everything needed to create the pending
 * session note and to build questions later, one at a time.
 */
export interface SessionPlan {
    sessionSeed: number;
    effectiveSeedInput: number;
    frozenPool: string[];
    initialOrder: number[];
    planned: PlannedQuestion[];
    choiceCount: number;
    errors: string[];
}

/** Plan a fresh session without resolving draws, distractors, or choices. */
export function planSession(
    questions: Question[],
    config: SessionConfig = DEFAULT_SESSION_CONFIG,
    reviewDir: string = 'review',
): SessionPlan {
    let seedInput = config.seed;
    if (seedInput === 0) {
        seedInput = generateRandomSeedInput();
    }

    const relativePaths = questions.map(
        (q) => relativeToReview(q.path, reviewDir) ?? q.path,
    );

    const sessionSeed = deriveSessionSeed(seedInput, config, relativePaths);
    const trimRng = mulberry32(deriveStreamSeed(sessionSeed, 'trim'));
    const orderRng = mulberry32(deriveStreamSeed(sessionSeed, 'order'));

    const trimmed = trimQuestions(questions, config, trimRng);
    const frozenPool = trimmed.map((q) => q.path);
    const frozenIndex = new Map(frozenPool.map((path, index) => [path, index]));
    const ordered = orderPool(trimmed, config.order, orderRng);

    const planned: PlannedQuestion[] = [];
    const errors: string[] = [];
    for (const q of ordered) {
        const frozenIdx = frozenIndex.get(q.path);
        if (frozenIdx === undefined) {
            errors.push(`${q.title}: not present in the frozen pool`);
            continue;
        }
        planned.push({ question: q, frozenIndex: frozenIdx });
    }

    return {
        sessionSeed,
        effectiveSeedInput: seedInput,
        frozenPool,
        initialOrder: planned.map((entry) => entry.frozenIndex),
        planned,
        choiceCount: config.choiceCount,
        errors,
    };
}

export interface PlannedBuildContext {
    sessionSeed: number;
    choiceCount?: number;
}

/** Build one question from a plan. The RNG streams stay path-derived. */
export function buildPlannedQuestion(
    plan: PlannedBuildContext,
    entry: PlannedQuestion,
): SessionQuestion {
    const q = entry.question;
    const drawsRng = mulberry32(deriveStreamSeed(plan.sessionSeed, 'draws', q.path));
    const optionsRng = mulberry32(deriveStreamSeed(plan.sessionSeed, 'options', q.path));
    const variantRng = mulberry32(deriveStreamSeed(plan.sessionSeed, 'variant', q.path));
    return buildQuestion(
        q,
        drawsRng,
        optionsRng,
        variantRng,
        entry.frozenIndex,
        plan.choiceCount,
    );
}

export function buildSession(
    questions: Question[],
    config: SessionConfig = DEFAULT_SESSION_CONFIG,
    reviewDir: string = 'review',
): BuildSessionResult {
    const plan = planSession(questions, config, reviewDir);
    const items: SessionQuestion[] = [];
    const errors = [...plan.errors];
    const initialOrder: number[] = [];
    for (const entry of plan.planned) {
        try {
            items.push(buildPlannedQuestion(plan, entry));
            initialOrder.push(entry.frozenIndex);
        } catch (e) {
            errors.push(`${entry.question.title}: ${(e as Error).message}`);
        }
    }

    return {
        items,
        errors,
        sessionSeed: plan.sessionSeed,
        effectiveSeedInput: plan.effectiveSeedInput,
        frozenPool: plan.frozenPool,
        initialOrder,
    };
}

// ============================================================================
// Frozen-state rebuild (resume + reproduce)
// ============================================================================

export interface FrozenSessionState {
    frozenPool: string[];
    initialOrder: number[];
    sessionSeed: number;
    /** Saved choice count; omitted by older logs, which used four choices. */
    choiceCount?: number;
}

export interface FrozenBuildOptions {
    /** In view mode, produce a placeholder `SessionQuestion` for missing paths. */
    includeMissing?: boolean;
}

/** Plan a resume/replay without building any question yet. Missing paths are skipped. */
export interface FrozenSessionPlan {
    sessionSeed: number;
    frozenPool: string[];
    initialOrder: number[];
    planned: PlannedQuestion[];
    choiceCount?: number;
    missingPaths: string[];
    errors: string[];
}

export function planFrozenSession(
    allQuestions: Question[],
    frozen: FrozenSessionState,
): FrozenSessionPlan {
    const byPath = new Map(allQuestions.map((q) => [q.path, q]));
    const planned: PlannedQuestion[] = [];
    const missingPaths: string[] = [];
    const errors: string[] = [];

    for (const frozenIdx of frozen.initialOrder) {
        const path = frozen.frozenPool[frozenIdx];
        if (!path) continue;
        const q = byPath.get(path);
        if (!q) {
            missingPaths.push(path);
            continue;
        }
        planned.push({ question: q, frozenIndex: frozenIdx });
    }

    return {
        sessionSeed: frozen.sessionSeed,
        frozenPool: frozen.frozenPool,
        initialOrder: planned.map((entry) => entry.frozenIndex),
        planned,
        choiceCount: frozen.choiceCount,
        missingPaths,
        errors,
    };
}

export interface BuildFromFrozenResult {
    items: SessionQuestion[];
    errors: string[];
    missingPaths: string[];
}

/**
 * Rebuild items from a saved frozen pool + initial order + seed. Skips
 * questions whose underlying md file is missing or unparseable; those paths
 * are reported in `missingPaths`. When `includeMissing` is true, a missing
 * path yields a placeholder `SessionQuestion` with `missingPath` set instead
 * of being skipped (used by read-only view mode).
 */
export function buildSessionFromFrozen(
    allQuestions: Question[],
    frozen: FrozenSessionState,
    options: FrozenBuildOptions = {},
): BuildFromFrozenResult {
    const byPath = new Map(allQuestions.map((q) => [q.path, q]));
    const items: SessionQuestion[] = [];
    const errors: string[] = [];
    const missingPaths: string[] = [];

    for (const frozenIdx of frozen.initialOrder) {
        const path = frozen.frozenPool[frozenIdx];
        if (!path) continue;
        const q = byPath.get(path);
        if (!q) {
            missingPaths.push(path);
            if (options.includeMissing) {
                items.push(missingSessionQuestion(path, frozenIdx));
            }
            continue;
        }
        try {
            const drawsRng = mulberry32(deriveStreamSeed(frozen.sessionSeed, 'draws', path));
            const optionsRng = mulberry32(deriveStreamSeed(frozen.sessionSeed, 'options', path));
            const variantRng = mulberry32(deriveStreamSeed(frozen.sessionSeed, 'variant', path));
            items.push(
                buildQuestion(
                    q,
                    drawsRng,
                    optionsRng,
                    variantRng,
                    frozenIdx,
                    frozen.choiceCount,
                ),
            );
        } catch (e) {
            errors.push(`${q.title}: ${(e as Error).message}`);
        }
    }

    return { items, errors, missingPaths };
}

/** A read-only placeholder for a question whose source note has gone missing. */
function missingSessionQuestion(path: string, id: number): SessionQuestion {
    return {
        q: {
            path,
            title: basename(path),
            variants: [],
            explanation: '',
            category: [],
            categorySource: 'none',
            declaredCategory: [],
            warnings: [],
            ignoredWarnings: new Set<string>(),
            literalSections: new Set<string>(),
            answerMode: 'text',
            answerBlocks: [],
            numericAnswerBlocks: [],
            distractorBlocks: [],
            vars: [],
            links: [],
            answerName: '',
            answerValNames: [],
            priority: 100,
        },
        id,
        text: '',
        variantIndex: 0,
        values: {},
        sources: {},
        choices: [],
        correctText: '',
        missingPath: path,
    };
}