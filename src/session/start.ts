/**
 * Fresh-session bootstrap shared by the review tab and embedded sessions:
 * plan metadata -> timer -> log -> pending session note -> runtime -> hub.
 */
import type { Vault } from 'obsidian';
import type { SessionConfig } from '../constants';
import {
    generateSessionId,
    snapshotFromConfig,
    writeSessionFile,
    type SessionLogState,
} from '../vault/sessionLog';
import type {
    GenerationEntry,
    SharedSession,
    SessionHub,
} from '../vault/sessionHub';
import { SessionRuntime } from '../vault/sessionRuntime';
import {
    buildPlannedQuestion,
    type FrozenSessionPlan,
    type SessionPlan,
} from './assemble';
import { createTimerRuntimeForIds } from './timer';
import type { Mode, SessionQuestion } from './types';

/** One build closure per planned question, in display order. */
export function generationEntries(
    plan: SessionPlan | FrozenSessionPlan,
    choiceCount: number,
    prepare?: (question: SessionQuestion) => void,
): GenerationEntry[] {
    return plan.planned.map((entry, displayIndex) => ({
        id: entry.frozenIndex,
        title: entry.question.title,
        displayIndex,
        build: () => {
            const sq = buildPlannedQuestion(
                { sessionSeed: plan.sessionSeed, choiceCount },
                entry,
            );
            prepare?.(sq);
            return sq;
        },
    }));
}

export interface SessionManageSnapshot {
    name: string;
    includedPaths: string[];
    categoryScope?: string[];
}

export interface OpenFreshSessionOptions {
    vault: Vault;
    hub: SessionHub;
    reviewDir: string;
    sessionsSubdir: string;
    plan: SessionPlan;
    config: SessionConfig;
    mode: Mode;
    sessionName: string;
    manageSelection?: SessionManageSnapshot;
}

export interface OpenFreshSessionResult {
    shared: SharedSession;
    log: SessionLogState;
}

/**
 * Create the pending session note and start streamed generation. The caller
 * owns the returned shared session and must eventually attach a view to it.
 */
export async function openFreshSession(
    options: OpenFreshSessionOptions,
): Promise<OpenFreshSessionResult> {
    const { plan, config } = options;
    const timer = createTimerRuntimeForIds(
        config,
        plan.initialOrder,
        config.presentation,
    );
    // Generation is streamed; the clock starts when every question exists.
    timer.running = false;

    const now = new Date().toISOString();
    const log: SessionLogState = {
        schema_version: 1,
        session_id: generateSessionId(),
        session_name: options.sessionName.trim(),
        status: 'pending',
        archived_from: null,
        created: now,
        completed_at: null,
        mode: options.mode,
        source_session: null,
        reproduced_into: [],
        session_seed: plan.sessionSeed,
        session_seed_default: plan.sessionSeed,
        rounds: 1,
        round_history: [{ index: 1, action: 'initial', started: now, ended: null }],
        qs_snapshot: snapshotFromConfig(config, options.manageSelection),
        frozen_pool: plan.frozenPool,
        initial_order: [...plan.initialOrder],
        answers: {},
        flags: [],
        scratch: {},
        timer_state: timer,
    };

    const file = await writeSessionFile(
        options.vault,
        log,
        [],
        options.reviewDir,
        options.sessionsSubdir,
    );

    const runtime = new SessionRuntime(
        options.vault,
        log,
        file,
        [],
        timer,
        config,
        options.mode,
    );
    const shared = options.hub.register(file, runtime);
    shared.startGeneration(generationEntries(plan, config.choiceCount));
    return { shared, log };
}
