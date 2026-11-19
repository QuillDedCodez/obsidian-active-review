import { test, assert } from './harness';
import type { TFile, Vault } from 'obsidian';
import {
    DEFAULT_REVIEW_DIR,
    DEFAULT_SESSION_CONFIG,
    DEFAULT_SESSIONS_SUBDIR,
    type SessionConfig,
} from '../src/constants';
import {
    buildPlannedQuestion,
    buildSession,
    createTimerRuntime,
    hydrateSessionItems,
    planFrozenSession,
    planSession,
    type SessionQuestion,
} from '../src/session';
import { parseQuestionNote } from '../src/parser';
import {
    parseSessionLog,
    serializeSessionLog,
    snapshotFromConfig,
    type SessionLogState,
} from '../src/vault/sessionLog';
import { SessionRuntime } from '../src/vault/sessionRuntime';
import {
    SessionHub,
    type SharedSessionEvent,
} from '../src/vault/sessionHub';

function makeItem(id: number): SessionQuestion {
    return {
        id,
        q: { path: `review/note-${id}.md`, title: `Q${id}` },
        text: `Question ${id}`,
        variantIndex: 0,
        values: {},
        sources: {},
        choices: [
            { text: 'A', correct: true, note: '' },
            { text: 'B', correct: false, note: '' },
        ],
        correctText: 'A',
    } as unknown as SessionQuestion;
}

function makeLog(sessionId: string): SessionLogState {
    const created = new Date(0).toISOString();
    return {
        schema_version: 1,
        session_id: sessionId,
        session_name: '',
        status: 'pending',
        archived_from: null,
        created,
        completed_at: null,
        mode: 'choice',
        source_session: null,
        reproduced_into: [],
        session_seed: 1,
        session_seed_default: 1,
        rounds: 1,
        round_history: [
            { index: 1, action: 'initial', started: created, ended: null },
        ],
        qs_snapshot: snapshotFromConfig(DEFAULT_SESSION_CONFIG),
        frozen_pool: [],
        initial_order: [],
        answers: {},
        flags: [],
        scratch: {},
        timer_state: null,
    };
}

function makeFile(name: string): TFile {
    return {
        path: `${DEFAULT_REVIEW_DIR}/${DEFAULT_SESSIONS_SUBDIR}/session-${name}.md`,
    } as TFile;
}

const vault = {
    modify: async () => undefined,
} as unknown as Vault;

function makeRuntime(
    file: TFile,
    config: SessionConfig = DEFAULT_SESSION_CONFIG,
    writeVault: Vault = vault,
) {
    const items = [makeItem(0), makeItem(1)];
    const timer = createTimerRuntime(config, items, config.presentation);
    return new SessionRuntime(
        writeVault,
        makeLog(file.path),
        file,
        items,
        timer,
        config,
        'choice',
    );
}

test('planned generation matches the synchronous session build', () => {
    const note = (n: number): string =>
        [
            '## QUESTIONS',
            `What is ${n} + ${n}?`,
            '',
            '## ANSWERS',
            String(n + n),
            '',
        ].join('\n');
    const questions = [1, 2, 3, 4].map((n) => {
        const q = parseQuestionNote(`review/q-${n}.md`, note(n), 'review');
        assert.ok(q);
        return q;
    });
    const config: SessionConfig = {
        ...DEFAULT_SESSION_CONFIG,
        seed: 7,
        order: 'random',
        choiceCount: 4,
    };

    const plan = planSession(questions, config, 'review');
    const builtFromPlan = plan.planned.map((entry) =>
        buildPlannedQuestion(plan, entry),
    );
    const synchronous = buildSession(questions, config, 'review');

    assert.equal(plan.sessionSeed, synchronous.sessionSeed);
    assert.equal(plan.effectiveSeedInput, synchronous.effectiveSeedInput);
    assert.deepEqual(plan.frozenPool, synchronous.frozenPool);
    assert.deepEqual(plan.initialOrder, synchronous.initialOrder);
    assert.equal(builtFromPlan.length, synchronous.items.length);
    for (let i = 0; i < builtFromPlan.length; i++) {
        const planned = builtFromPlan[i]!;
        const expected = synchronous.items[i]!;
        assert.equal(planned.id, expected.id);
        assert.equal(planned.text, expected.text);
        assert.equal(planned.correctText, expected.correctText);
        assert.deepEqual(
            planned.choices.map((choice) => ({
                text: choice.text,
                correct: choice.correct,
            })),
            expected.choices.map((choice) => ({
                text: choice.text,
                correct: choice.correct,
            })),
        );
    }
});

test('planned resume matches the synchronous frozen rebuild', () => {
    const note = (n: number): string =>
        [
            '## QUESTIONS',
            `What is ${n} + ${n}?`,
            '',
            '## ANSWERS',
            String(n + n),
            '',
        ].join('\n');
    const questions = [1, 2, 3, 4, 5].map((n) => {
        const q = parseQuestionNote(`review/r-${n}.md`, note(n), 'review');
        assert.ok(q);
        return q;
    });
    const config: SessionConfig = {
        ...DEFAULT_SESSION_CONFIG,
        seed: 11,
        order: 'priority-random',
        choiceCount: 4,
    };
    const fresh = buildSession(questions, config, 'review');
    const plan = planFrozenSession(questions, {
        frozenPool: fresh.frozenPool,
        initialOrder: fresh.initialOrder,
        sessionSeed: fresh.sessionSeed,
        choiceCount: config.choiceCount,
    });
    const rebuilt = plan.planned.map((entry) =>
        buildPlannedQuestion(plan, entry),
    );
    assert.equal(rebuilt.length, fresh.items.length);
    for (let i = 0; i < rebuilt.length; i++) {
        assert.equal(rebuilt[i]!.id, fresh.items[i]!.id);
        assert.equal(rebuilt[i]!.text, fresh.items[i]!.text);
        assert.equal(rebuilt[i]!.correctText, fresh.items[i]!.correctText);
    }
});

test('a partially generated session serializes with the planned total', () => {
    const log = makeLog('partial');
    log.frozen_pool = ['review/a.md', 'review/b.md'];
    log.initial_order = [0, 1];
    const text = serializeSessionLog(log, [makeItem(0)]);
    const parsed = parseSessionLog(text);
    assert.ok(parsed);
    assert.deepEqual(parsed.initial_order, [0, 1]);
    assert.ok(text.includes('0 / 2 submitted'));
});

test('an unsubmitted choice survives serialize, parse, and hydrate', () => {    const log = makeLog('pick-roundtrip');
    log.answers['0'] = { picked: 1, typed: false, submitted: false };
    log.scratch['0'] = 'working';

    const parsed = parseSessionLog(serializeSessionLog(log, []));
    assert.ok(parsed);
    assert.equal(parsed.answers['0']?.picked, 1);
    assert.equal(parsed.answers['0']?.submitted, false);

    const item = makeItem(0);
    item.scratch = undefined;
    hydrateSessionItems([item], parsed);
    assert.equal(item.pickedIndex, 1);
    assert.equal(item.submitted, false);
    assert.equal(item.isCorrect, undefined);
    assert.equal(item.scratch, 'working');
});

test('picking a choice before submission is written to the session file', async () => {
    const writes: string[] = [];
    const capture = {
        modify: async (_file: TFile, content: string) => {
            writes.push(content);
        },
    } as unknown as Vault;
    const file = makeFile('persist-pick');
    const shared = new SessionHub().register(
        file,
        makeRuntime(file, DEFAULT_SESSION_CONFIG, capture),
    );

    shared.pick(0, 1, 'view');
    await shared.flush();

    const content = writes[writes.length - 1] ?? '';
    const parsed = parseSessionLog(content);
    assert.ok(parsed);
    assert.equal(parsed.answers['0']?.picked, 1);
    assert.equal(parsed.answers['0']?.submitted, false);
});

test('shared sessions broadcast within a group and skip the origin', async () => {
    const hub = new SessionHub();
    const file = makeFile('shared');
    const runtime = makeRuntime(file);
    const shared = hub.register(file, runtime);

    const originEvents: SharedSessionEvent[] = [];
    const peerEvents: SharedSessionEvent[] = [];
    shared.subscribe('origin', (event) => originEvents.push(event));
    shared.subscribe('peer', (event) => peerEvents.push(event));

    shared.pick(0, 1, 'origin');
    assert.equal(originEvents.length, 0);
    assert.deepEqual(peerEvents[0], {
        type: 'change',
        kind: 'pick',
        id: 0,
        origin: 'origin',
    });

    shared.setIndex(1, 'origin');
    assert.deepEqual(peerEvents[1], {
        type: 'index',
        index: 1,
        origin: 'origin',
    });
    assert.equal(originEvents.length, 0);

    shared.setDraft(0, 'typed answer', 'origin');
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(peerEvents[2], {
        type: 'change',
        kind: 'draft',
        id: 0,
        origin: 'origin',
    });
    assert.equal(originEvents.length, 0);

    await shared.flush();
    await shared.release('origin');
    await shared.release('peer');
    assert.equal(hub.isAttached(file), false);
});

test('suspend keeps a shared session registered and reattachable', async () => {
    const hub = new SessionHub();
    const file = makeFile('suspend');
    const shared = hub.register(file, makeRuntime(file));

    shared.subscribe('view-a', () => undefined);
    shared.pick(0, 1, 'other');
    await shared.suspend('view-a');

    assert.equal(shared.hasViewers(), false);
    assert.equal(hub.isAttached(file), true);
    assert.equal(shared.items[0]?.pickedIndex, 1);

    const events: SharedSessionEvent[] = [];
    shared.subscribe('view-b', (event) => events.push(event));
    assert.equal(shared.hasViewers(), true);
    assert.equal(hub.get(file), shared);

    shared.setIndex(1, 'other');
    assert.deepEqual(events[0], { type: 'index', index: 1, origin: 'other' });

    await shared.release('view-b');
    assert.equal(hub.isAttached(file), false);
});

test('dropping a shared session removes only that instance', async () => {
    const hub = new SessionHub();
    const file = makeFile('drop');
    const shared = hub.register(file, makeRuntime(file));
    shared.subscribe('view-a', () => undefined);
    await shared.suspend('view-a');

    hub.drop(shared);
    assert.equal(hub.isAttached(file), false);
});

test('different session files stay isolated', async () => {
    const hub = new SessionHub();
    const fileA = makeFile('group-a');
    const fileB = makeFile('group-b');
    const sharedA = hub.register(fileA, makeRuntime(fileA));
    const sharedB = hub.register(fileB, makeRuntime(fileB));

    const eventsA: SharedSessionEvent[] = [];
    const eventsB: SharedSessionEvent[] = [];
    sharedA.subscribe('a', (event) => eventsA.push(event));
    sharedB.subscribe('b', (event) => eventsB.push(event));

    sharedA.pick(0, 1, 'other-a');
    assert.equal(eventsB.length, 0);
    assert.equal(eventsA.length, 1);

    sharedB.pick(0, 1, 'other-b');
    assert.equal(eventsA.length, 1);
    assert.equal(eventsB.length, 1);

    await sharedA.flush();
    await sharedB.flush();
});
