/** Session log: YAML schema, serializer, parser, file helpers. */
import { normalizePath, type App, type TFile, type Vault } from 'obsidian';
import type { OrderMode, SessionConfig, SubmitMode, TimerMode } from '../constants';
import { DEFAULT_SESSION_CONFIG, clampChoiceCount } from '../constants';
import { formatStopwatchMs, formatTimerMs, formatTimeInput } from '../session/timer';
import type { Mode, SessionQuestion } from '../session/types';
import type { TimerRuntimeState } from '../session/timer';
import { ensureFolder } from './folders';

// ============================================================================
// Types
// ============================================================================

export type SessionStatus = 'pending' | 'completed' | 'abandoned' | 'archived';
export type RoundAction = 'initial' | 'restart' | 'reset' | 'reproduce';

export interface SessionAnswerEntry {
    picked?: number;
    given?: string;
    typed?: boolean;
    isCorrect?: boolean;
    /** True once the answer is locked in for this session. */
    submitted?: boolean;
    /** Reserved — defaults to isCorrect when absent on read. */
    firstCorrect?: boolean;
    /** Time spent on the question, when a per-question stopwatch is enabled. */
    timeSpentMs?: number;
    /** Timer remaining when the answer was submitted. */
    timerRemainingMs?: number;
    /** True when a hard timer forced this question to submit. */
    timerExpired?: boolean;
}

export interface RoundEntry {
    index: number;
    action: RoundAction;
    started: string;
    ended: string | null;
}

export interface SessionSnapshot {
    presentation: 'all' | 'one';
    choices: number;
    count: number | 'all';
    trim: 'seq' | 'rand';
    order: OrderMode;
    seed: number;
    show: 'immediate' | 'submitAll' | 'submitAny';
    grade: 'immediate' | 'afterAll';
    passScore: number | 'off';
    managePresetId: string;
    managePresetName: string;
    manageIncludedPaths: string[];
    /** Legacy category scope stored by older sessions. */
    categoryScope: string[];
    filter: { scope: 'include' | 'exclude'; granularity: 'group' | 'individual'; values: string[] };
    sessionShortcut: 'all' | 'current' | 'random-n' | 'weak';
    timer_session: number | 'off';
    timer_per_question: number | 'off';
    timer_session_mode: TimerMode;
    timer_question_mode: TimerMode;
    timer_session_warning: number;
    timer_question_warning: number;
    stopwatch_session: boolean;
    stopwatch_question: boolean;
    navigator: boolean;
    allowFlag: boolean;
}

export interface SessionLogState {
    schema_version: number;
    session_id: string;
    session_name: string;
    status: SessionStatus;
    archived_from: SessionStatus | null;
    created: string;
    completed_at: string | null;
    mode: Mode;
    source_session: string | null;
    reproduced_into: string[];
    session_seed: number;
    session_seed_default: number;
    rounds: number;
    round_history: RoundEntry[];
    qs_snapshot: SessionSnapshot;
    frozen_pool: string[];
    initial_order: number[];
    answers: Record<string, SessionAnswerEntry>;
    flags: number[];
    scratch: Record<string, string>;
    timer_state: TimerRuntimeState | null;
}

export interface SessionLogPreview {
    session_id: string;
    session_name: string;
    status: SessionStatus;
    created: string;
}

export interface SessionSummary {
    file: TFile;
    log: SessionLogState;
}

// ============================================================================
// Snapshot <-> Config
// ============================================================================

export function submitModeToShow(mode: SubmitMode): SessionSnapshot['show'] {
    return mode === 'auto' ? 'immediate' : mode === 'all' ? 'submitAll' : 'submitAny';
}

export function submitModeFromShow(show: SessionSnapshot['show']): SubmitMode {
    return show === 'immediate' ? 'auto' : show === 'submitAll' ? 'all' : 'any';
}

/** Map a stored snapshot back to a live session configuration. */
export function configFromSnapshot(snap: SessionSnapshot): SessionConfig {
    return {
        presentation: snap.presentation,
        choiceCount: clampChoiceCount(snap.choices),
        count: snap.count,
        trim: snap.trim,
        order: snap.order,
        seed: snap.seed,
        submitMode: submitModeFromShow(snap.show),
        gradeMode: snap.grade,
        passScore: snap.passScore,
        managePresetId: snap.managePresetId,
        timerSessionMode: snap.timer_session_mode,
        timerSessionSeconds: snap.timer_session === 'off' ? 60 : snap.timer_session,
        timerSessionWarningSeconds: snap.timer_session_warning,
        timerQuestionMode: snap.timer_question_mode,
        timerQuestionSeconds: snap.timer_per_question === 'off' ? 60 : snap.timer_per_question,
        timerQuestionWarningSeconds: snap.timer_question_warning,
        stopwatchSession: snap.stopwatch_session,
        stopwatchQuestion: snap.stopwatch_question,
        navigator: snap.navigator,
        allowFlag: snap.allowFlag,
    };
}

export function snapshotFromConfig(
    config: SessionConfig,
    manage?: { name?: string; includedPaths?: string[]; categoryScope?: string[] },
): SessionSnapshot {
    return {
        presentation: config.presentation,
        choices: clampChoiceCount(config.choiceCount),
        count: config.count,
        trim: config.trim,
        order: config.order,
        seed: config.seed,
        show: submitModeToShow(config.submitMode),
        grade: config.gradeMode,
        passScore: config.passScore,
        managePresetId: config.managePresetId,
        managePresetName: manage?.name ?? 'All questions',
        manageIncludedPaths: manage?.includedPaths ?? [],
        categoryScope: [...(manage?.categoryScope ?? [])],
        filter: { scope: 'include', granularity: 'group', values: [] },
        sessionShortcut: 'all',
        timer_session: config.timerSessionMode === 'off' ? 'off' : config.timerSessionSeconds,
        timer_per_question:
            config.timerQuestionMode === 'off' ? 'off' : config.timerQuestionSeconds,
        timer_session_mode: config.timerSessionMode,
        timer_question_mode: config.timerQuestionMode,
        timer_session_warning: config.timerSessionWarningSeconds,
        timer_question_warning: config.timerQuestionWarningSeconds,
        stopwatch_session: config.stopwatchSession,
        stopwatch_question: config.stopwatchQuestion,
        navigator: config.navigator,
        allowFlag: config.allowFlag,
    };
}

// ============================================================================
// ID helpers
// ============================================================================

export function generateSessionId(): string {
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function sessionLabel(log: { session_id: string; session_name: string }): string {
    return log.session_name.trim() !== ''
        ? `${log.session_id} - ${log.session_name}`
        : log.session_id;
}

/** Human-readable status label for the status chip. */
export function statusLabel(status: SessionStatus): string {
    switch (status) {
        case 'completed':
            return 'Completed';
        case 'abandoned':
            return 'Abandoned';
        case 'archived':
            return 'Archived';
        default:
            return 'Pending';
    }
}

// ============================================================================
// YAML string helpers
// ============================================================================

function yamlString(s: string): string {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

function unquoteYaml(s: string): string {
    const t = s.trim();
    if (t.startsWith('"') && t.endsWith('"')) {
        return t.slice(1, -1)
            .replace(/\\\\/g, '\\')
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r');
    }
    if (t.startsWith("'") && t.endsWith("'")) {
        return t.slice(1, -1).replace(/''/g, "'");
    }
    return t;
}

// ============================================================================
// Serialize
// ============================================================================

function serializeSnapshot(snap: SessionSnapshot): string[] {
    const lines: string[] = ['qs_snapshot:'];
    lines.push(`  presentation: ${snap.presentation}`);
    lines.push(`  choices: ${clampChoiceCount(snap.choices)}`);
    lines.push(`  count: ${snap.count === 'all' ? 'all' : snap.count}`);
    lines.push(`  trim: ${snap.trim}`);
    lines.push(`  order: ${snap.order}`);
    lines.push(`  seed: ${snap.seed}`);
    lines.push(`  show: ${snap.show}`);
    lines.push(`  grade: ${snap.grade}`);
    lines.push(`  passScore: ${snap.passScore === 'off' ? 'off' : snap.passScore}`);
    lines.push(`  managePresetId: ${yamlString(snap.managePresetId)}`);
    lines.push(`  managePresetName: ${yamlString(snap.managePresetName)}`);
    if (snap.manageIncludedPaths.length === 0) {
        lines.push('  manageIncludedPaths: []');
    } else {
        lines.push('  manageIncludedPaths:');
        for (const p of snap.manageIncludedPaths) lines.push(`    - ${yamlString(p)}`);
    }
    if (snap.categoryScope.length === 0) {
        lines.push('  categoryScope: []');
    } else {
        lines.push('  categoryScope:');
        for (const part of snap.categoryScope) lines.push(`    - ${yamlString(part)}`);
    }
    lines.push('  filter:');
    lines.push(`    scope: ${snap.filter.scope}`);
    lines.push(`    granularity: ${snap.filter.granularity}`);
    if (snap.filter.values.length === 0) {
        lines.push('    values: []');
    } else {
        lines.push('    values:');
        for (const v of snap.filter.values) lines.push(`      - ${yamlString(v)}`);
    }
    lines.push(`  sessionShortcut: ${snap.sessionShortcut}`);
    lines.push(`  timer_session: ${snap.timer_session === 'off' ? 'off' : snap.timer_session}`);
    lines.push(`  timer_per_question: ${snap.timer_per_question === 'off' ? 'off' : snap.timer_per_question}`);
    lines.push(`  timer_session_mode: ${snap.timer_session_mode}`);
    lines.push(`  timer_question_mode: ${snap.timer_question_mode}`);
    lines.push(`  timer_session_warning: ${snap.timer_session_warning}`);
    lines.push(`  timer_question_warning: ${snap.timer_question_warning}`);
    lines.push(`  stopwatch_session: ${snap.stopwatch_session}`);
    lines.push(`  stopwatch_question: ${snap.stopwatch_question}`);
    lines.push(`  navigator: ${snap.navigator}`);
    lines.push(`  allowFlag: ${snap.allowFlag}`);
    return lines;
}

export function serializeSessionLog(log: SessionLogState, items: SessionQuestion[]): string {
    const lines: string[] = [
        '---',
        'rv-session: true',
        `schema_version: ${log.schema_version}`,
        `session_id: ${log.session_id}`,
        `session_name: ${yamlString(log.session_name)}`,
        `status: ${log.status}`,
        `archived_from: ${log.archived_from ?? 'null'}`,
        `created: ${log.created}`,
        `completed_at: ${log.completed_at ?? 'null'}`,
        `mode: ${log.mode}`,
        `source_session: ${log.source_session ?? 'null'}`,
        `reproduced_into: [${log.reproduced_into.join(', ')}]`,
        `session_seed: ${log.session_seed}`,
        `session_seed_default: ${log.session_seed_default}`,
        `rounds: ${log.rounds}`,
    ];

    if (log.round_history.length === 0) {
        lines.push('round_history: []');
    } else {
        lines.push('round_history:');
        for (const r of log.round_history) {
            lines.push(`  - index: ${r.index}`);
            lines.push(`    action: ${r.action}`);
            lines.push(`    started: ${r.started}`);
            lines.push(`    ended: ${r.ended ?? 'null'}`);
        }
    }

    lines.push(...serializeSnapshot(log.qs_snapshot));

    if (log.frozen_pool.length === 0) {
        lines.push('frozen_pool: []');
    } else {
        lines.push('frozen_pool:');
        for (const p of log.frozen_pool) lines.push(`  - ${yamlString(p)}`);
    }

    lines.push(`initial_order: [${log.initial_order.join(', ')}]`);

    const answerKeys = Object.keys(log.answers).sort((a, b) => Number(a) - Number(b));
    if (answerKeys.length === 0) {
        lines.push('answers: {}');
    } else {
        lines.push('answers:');
        for (const key of answerKeys) {
            const a = log.answers[key]!;
            const parts: string[] = [];
            parts.push(`picked: ${a.picked !== undefined ? a.picked : 'null'}`);
            parts.push(`given: ${a.given !== undefined ? yamlString(a.given) : 'null'}`);
            parts.push(`typed: ${a.typed === true}`);
            parts.push(`submitted: ${a.submitted === true}`);
            parts.push(`isCorrect: ${a.isCorrect === undefined ? 'null' : a.isCorrect}`);
            if (a.firstCorrect !== undefined) parts.push(`firstCorrect: ${a.firstCorrect}`);
            if (a.timeSpentMs !== undefined) parts.push(`timeSpentMs: ${Math.round(a.timeSpentMs)}`);
            if (a.timerRemainingMs !== undefined) {
                parts.push(`timerRemainingMs: ${Math.round(a.timerRemainingMs)}`);
            }
            if (a.timerExpired === true) parts.push('timerExpired: true');
            lines.push(`  "${key}": { ${parts.join(', ')} }`);
        }
    }

    lines.push(`flags: [${log.flags.join(', ')}]`);

    const scratchKeys = Object.keys(log.scratch).sort((a, b) => Number(a) - Number(b));
    if (scratchKeys.length === 0) {
        lines.push('scratch: {}');
    } else {
        lines.push('scratch:');
        for (const key of scratchKeys) {
            lines.push(`  "${key}": ${yamlString(log.scratch[key]!)}`);
        }
    }

    lines.push(
        `timer_state: ${log.timer_state ? yamlString(JSON.stringify(log.timer_state)) : 'null'}`,
    );

    lines.push('---', '');
    lines.push(`# Session ${sessionLabel(log)}`, '');
    lines.push(`**Status:** ${log.status}`);
    lines.push(`**Created:** ${log.created}`);
    if (log.completed_at) lines.push(`**Completed:** ${log.completed_at}`);
    lines.push(`**Mode:** ${log.mode === 'choice' ? 'Multiple choice' : 'Typed answer'}`);
    const submitLabel =
        log.qs_snapshot.show === 'immediate'
            ? 'AutoSubmit'
            : log.qs_snapshot.show === 'submitAll'
              ? 'Submit all'
              : 'Submit any';
    const gradeLabel = log.qs_snapshot.grade === 'afterAll' ? 'After all submitted' : 'Immediate';
    lines.push(`**Submit:** ${submitLabel}`);
    lines.push(`**Grade:** ${gradeLabel}`);
    lines.push(`**Pass score:** ${log.qs_snapshot.passScore === 'off' ? 'Off' : `${log.qs_snapshot.passScore}%`}`);
    const selectedCount =
        log.qs_snapshot.manageIncludedPaths.length > 0
            ? log.qs_snapshot.manageIncludedPaths.length
            : log.frozen_pool.length;
    lines.push(`**Manage questions:** ${log.qs_snapshot.managePresetName} (${selectedCount} selected)`);
    const qs = log.qs_snapshot;
    const modeLabel = (mode: 'off' | 'on' | 'soft'): string =>
        mode === 'off' ? 'Off' : mode === 'on' ? 'ON' : 'SOFT';
    const sessionTimerLabel =
        qs.timer_session_mode === 'off' || qs.timer_session === 'off'
            ? 'Off'
            : `${modeLabel(qs.timer_session_mode)} ${formatTimeInput(qs.timer_session)}`;
    const questionTimerLabel =
        qs.timer_question_mode === 'off' || qs.timer_per_question === 'off'
            ? 'Off'
            : `${modeLabel(qs.timer_question_mode)} ${formatTimeInput(qs.timer_per_question)}`;
    const warnLabel = (seconds: number): string => (seconds > 0 ? `${seconds}s` : 'Off');
    lines.push(`**Session timer:** ${sessionTimerLabel}`);
    lines.push(`**Session timer warning:** ${warnLabel(qs.timer_session_warning)}`);
    lines.push(`**Per-question timer:** ${questionTimerLabel}`);
    lines.push(`**Per-question timer warning:** ${warnLabel(qs.timer_question_warning)}`);
    lines.push(`**Session stopwatch:** ${qs.stopwatch_session ? 'On' : 'Off'}`);
    lines.push(`**Per-question stopwatch:** ${qs.stopwatch_question ? 'On' : 'Off'}`);
    if (qs.timer_session_mode !== 'off' && log.timer_state) {
        lines.push(
            `**Session timer remaining:** ${formatTimerMs(log.timer_state.sessionRemainingMs)}`,
        );
    }
    if (qs.stopwatch_session && log.timer_state) {
        lines.push(
            `**Session stopwatch elapsed:** ${formatStopwatchMs(log.timer_state.sessionElapsedMs)}`,
        );
    }
    lines.push(`**Seed:** ${log.session_seed}`);
    if (log.source_session) lines.push(`**Reproduced from:** ${log.source_session}`);
    if (log.reproduced_into.length > 0) lines.push(`**Reproduced into:** ${log.reproduced_into.join(', ')}`);
    lines.push('');

    const totalPresented =
        log.initial_order.length > 0
            ? log.initial_order.length
            : items.length > 0
              ? items.length
              : log.frozen_pool.length;
    const submittedCount = Object.values(log.answers).filter((a) => a.submitted === true).length;
    const correctCount = Object.values(log.answers).filter((a) => a.isCorrect === true).length;
    const scorePct = totalPresented > 0 ? (correctCount / totalPresented) * 100 : 0;

    lines.push('## Progress', '');
    lines.push(`${submittedCount} / ${totalPresented} submitted · ${correctCount} correct`);
    if (log.status === 'completed') {
        lines.push(`**Score:** ${correctCount} / ${totalPresented} (${Math.round(scorePct)}%)`);
        if (log.qs_snapshot.passScore !== 'off') {
            const passed = scorePct >= log.qs_snapshot.passScore;
            lines.push(
                `**Result:** ${passed ? 'Passed' : 'Failed'} (pass ${log.qs_snapshot.passScore}%)`,
            );
        }
    }
    lines.push('');

    lines.push('## Questions', '');
    const questionTimerOn =
        qs.timer_question_mode !== 'off' && qs.timer_per_question !== 'off';
    const questionStopwatchOn = qs.stopwatch_question;
    // Item id is the frozen index; index it once instead of scanning `items`
    // for every question (which made serialisation quadratic in session size).
    const itemsById = new Map(items.map((item) => [item.id, item]));
    for (let displayIdx = 0; displayIdx < log.initial_order.length; displayIdx++) {
        const frozenIdx = log.initial_order[displayIdx]!;
        const path = log.frozen_pool[frozenIdx] ?? '(missing)';
        const key = String(frozenIdx);
        const ans = log.answers[key];
        const scratch = log.scratch[key];
        const sq = itemsById.get(frozenIdx);

        lines.push(`### ${displayIdx + 1}. ${path}`, '');
        if (sq) {
            const quoted = sq.text.split('\n').map((l) => `> ${l}`).join('\n');
            lines.push(quoted, '');
        }
        if (ans) {
            if (ans.picked !== undefined) lines.push(`- **Choice:** option ${String.fromCharCode(65 + ans.picked)}`);
            if (ans.given !== undefined) lines.push(`- **Given:** ${ans.given}`);
            if (ans.isCorrect !== undefined) {
                lines.push(`- **Result:** ${ans.isCorrect ? 'Correct' : 'Incorrect'}`);
            } else if (ans.submitted === true) {
                lines.push('- **Result:** submitted (awaiting grade)');
            } else {
                lines.push('- **Result:** in progress');
            }
        } else {
            lines.push('- **Result:** unanswered');
        }
        if (scratch) lines.push('', '**Scratch:**', '', scratch, '');
        if (questionTimerOn && (sq || ans)) {
            const timerMs =
                ans?.timerRemainingMs ??
                log.timer_state?.questionRemainingMs[key];
            lines.push(
                `- **Timer ${ans?.submitted ? 'recorded' : 'remaining'}:** ${
                    timerMs !== undefined ? formatTimerMs(timerMs) : '—'
                }`,
            );
        }
        if (questionStopwatchOn && (sq || ans)) {
            const stopwatchMs =
                ans?.timeSpentMs ??
                log.timer_state?.questionElapsedMs[key];
            lines.push(
                `- **Stopwatch ${ans?.submitted ? 'recorded' : 'current'}:** ${
                    stopwatchMs !== undefined ? formatStopwatchMs(stopwatchMs) : '—'
                }`,
            );
        }
        if (ans?.timerExpired) lines.push('- **Timer expired**');
        lines.push('');
    }

    return lines.join('\n');
}

// ============================================================================
// Parse
// ============================================================================

function extractFrontmatter(content: string): string | null {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    return fm ? (fm[1] ?? null) : null;
}

function scalarFromBody(body: string, key: string): string | null {
    const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(body);
    if (!m) return null;
    return m[1]!.trim();
}

function blockLinesFromBody(body: string, key: string, indent: number): string[] {
    const re = new RegExp(`^${key}:\\s*\\r?\\n`, 'm');
    const match = re.exec(body);
    if (!match) return [];
    const start = match.index + match[0].length;
    const rest = body.slice(start);
    const lines = rest.split(/\r?\n/);
    const prefix = ' '.repeat(indent);
    const out: string[] = [];
    for (const line of lines) {
        if (line === '') continue;
        if (!line.startsWith(prefix)) break;
        out.push(line.slice(indent));
    }
    return out;
}

function parseInlineArray<T>(raw: string, convert: (s: string) => T): T[] {
    if (!raw.startsWith('[') || !raw.endsWith(']')) return [];
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => convert(s.trim())).filter((v) => v !== undefined) as T[];
}

/**
 * Split a one-line YAML flow mapping body on top-level commas. Commas inside
 * double-quoted values are part of the value, so a typed answer like
 * `"1, 2 and 3"` must stay intact. Backslash escapes are preserved verbatim;
 * `unquoteYaml` resolves them later.
 */
function splitInlineMapEntries(src: string): string[] {
    const parts: string[] = [];
    let current = '';
    let quoted = false;
    let escaped = false;
    for (const ch of src) {
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (ch === '"') {
            quoted = !quoted;
            current += ch;
            continue;
        }
        if (ch === ',' && !quoted) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts;
}

function assignRound(r: Partial<RoundEntry>, key: string, val: string): void {
    if (key === 'index') r.index = parseInt(val, 10);
    else if (key === 'action') r.action = val as RoundAction;
    else if (key === 'started') r.started = val;
    else if (key === 'ended') r.ended = val === 'null' ? null : val;
}

function finalizeRound(r: Partial<RoundEntry>, fallbackCreated: string): RoundEntry {
    return {
        index: r.index ?? 1,
        action: (r.action ?? 'initial') as RoundAction,
        started: r.started ?? fallbackCreated,
        ended: r.ended ?? null,
    };
}

function parseSnapshotBlock(lines: string[]): SessionSnapshot {
    const def = snapshotFromConfig(DEFAULT_SESSION_CONFIG);
    const get = (key: string): string | null => {
        for (const line of lines) {
            const m = new RegExp(`^${key}:\\s*(.+)$`).exec(line);
            if (m) return m[1]!.trim();
        }
        return null;
    };

    const filterLines: string[] = [];
    const filterValues: string[] = [];
    let inFilter = false;
    let inFilterValues = false;
    for (const line of lines) {
        if (line === 'filter:') { inFilter = true; continue; }
        if (inFilter) {
            if (inFilterValues) {
                const m = /^- (.+)$/.exec(line.trim());
                if (m) filterValues.push(unquoteYaml(m[1]!));
                continue;
            }
            if (line.startsWith('  ')) {
                const sub = line.slice(2);
                if (sub === 'values: []' || sub === 'values:') { inFilterValues = true; continue; }
                filterLines.push(sub);
            } else {
                inFilter = false;
            }
        }
    }
    const getFilter = (key: string): string | null => {
        for (const line of filterLines) {
            const m = new RegExp(`^${key}:\\s*(.+)$`).exec(line);
            if (m) return m[1]!.trim();
        }
        return null;
    };

    const numOr = (raw: string | null, fallback: number): number => {
        if (raw === null) return fallback;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : fallback;
    };
    const numOrOff = (raw: string | null, fallback: number | 'off'): number | 'off' => {
        if (raw === null) return fallback;
        if (raw === 'off') return 'off';
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : fallback;
    };

    const orderRaw = get('order') ?? def.order;
    const order: OrderMode = (['source', 'random', 'priority', 'priority-random'] as const).includes(orderRaw as OrderMode)
        ? (orderRaw as OrderMode)
        : 'source';

    const showRaw = get('show') ?? def.show;
    const show = (['immediate', 'submitAll', 'submitAny'] as const).includes(showRaw as SessionSnapshot['show'])
        ? (showRaw as SessionSnapshot['show'])
        : 'immediate';
    // Legacy logs (no `grade`) used `show: immediate` to mean the old
    // per-card Check behavior, not the new AutoSubmit. Normalize them.
    const gradePresent = get('grade') !== null;
    const normalizedShow: SessionSnapshot['show'] =
        !gradePresent && show === 'immediate' ? 'submitAny' : show;

    const grade: 'immediate' | 'afterAll' = get('grade') === 'afterAll' ? 'afterAll' : 'immediate';

    const scRaw = get('sessionShortcut') ?? def.sessionShortcut;
    const sessionShortcut = (['all', 'current', 'random-n', 'weak'] as const).includes(scRaw as SessionSnapshot['sessionShortcut'])
        ? (scRaw as SessionSnapshot['sessionShortcut'])
        : 'all';

    const countRaw = get('count') ?? String(def.count);

    const timerMode = (raw: string | null): TimerMode =>
        raw === 'on' || raw === 'soft' || raw === 'off' ? raw : 'off';

    const managePresetId = unquoteYaml(get('managePresetId') ?? '"all"');
    const managePresetName = unquoteYaml(get('managePresetName') ?? '"All questions"');
    const manageIncludedPaths: string[] = [];
    let inManageIncluded = false;
    for (const line of lines) {
        const t = line.trim();
        if (t === 'manageIncludedPaths: []') break;
        if (t === 'manageIncludedPaths:') { inManageIncluded = true; continue; }
        if (inManageIncluded) {
            const m = /^- (.+)$/.exec(t);
            if (m) manageIncludedPaths.push(unquoteYaml(m[1]!));
            else if (t !== '') break;
        }
    }

    const categoryScope: string[] = [];
    let inCategoryScope = false;
    for (const line of lines) {
        const t = line.trim();
        if (t === 'categoryScope: []') break;
        if (t === 'categoryScope:') { inCategoryScope = true; continue; }
        if (inCategoryScope) {
            const m = /^- (.+)$/.exec(t);
            if (m) categoryScope.push(unquoteYaml(m[1]!));
            else if (t !== '') break;
        }
    }

    return {
        presentation: (get('presentation') === 'one' ? 'one' : 'all') as 'all' | 'one',
        choices: clampChoiceCount(numOr(get('choices'), def.choices)),
        count: countRaw === 'all' ? 'all' : numOr(countRaw, 0),
        trim: (get('trim') === 'rand' ? 'rand' : 'seq') as 'seq' | 'rand',
        order,
        seed: numOr(get('seed'), 0),
        show: normalizedShow,
        grade,
        passScore: numOrOff(get('passScore'), 'off'),
        managePresetId,
        managePresetName,
        manageIncludedPaths,
        categoryScope,
        filter: {
            scope: getFilter('scope') === 'exclude' ? 'exclude' : 'include',
            granularity: getFilter('granularity') === 'individual' ? 'individual' : 'group',
            values: filterValues,
        },
        sessionShortcut,
        timer_session: numOrOff(get('timer_session'), 'off'),
        timer_per_question: numOrOff(get('timer_per_question'), 'off'),
        timer_session_mode: timerMode(get('timer_session_mode')),
        timer_question_mode: timerMode(get('timer_question_mode')),
        timer_session_warning: numOr(get('timer_session_warning'), 0),
        timer_question_warning: numOr(get('timer_question_warning'), 0),
        stopwatch_session: get('stopwatch_session') === 'true',
        stopwatch_question: get('stopwatch_question') === 'true',
        navigator: get('navigator') === 'true',
        allowFlag: get('allowFlag') !== 'false',
    };
}

export function parseSessionLog(content: string): SessionLogState | null {    const body = extractFrontmatter(content);
    if (!body) return null;
    if (!/^rv-session:\s*true/m.test(body)) return null;

    const idRaw = scalarFromBody(body, 'session_id');
    if (!idRaw || idRaw === 'null') return null;
    const session_id = unquoteYaml(idRaw);

    const schema_version = parseInt(scalarFromBody(body, 'schema_version') ?? '1', 10);
    const session_name = unquoteYaml(scalarFromBody(body, 'session_name') ?? '""');

    const statusRaw = (scalarFromBody(body, 'status') ?? 'pending').toLowerCase();
    const storedStatus: SessionStatus = (['pending', 'completed', 'abandoned', 'archived'] as const).includes(statusRaw as SessionStatus)
        ? (statusRaw as SessionStatus)
        : 'pending';

    const archivedFromRaw = scalarFromBody(body, 'archived_from');
    const archived_from: SessionStatus | null =
        archivedFromRaw && archivedFromRaw !== 'null' ? (archivedFromRaw as SessionStatus) : null;
    // Older versions archived completed sessions as "abandoned" with
    // archived_from=completed. Treat those as archived.
    const status: SessionStatus =
        storedStatus === 'abandoned' && archived_from === 'completed'
            ? 'archived'
            : storedStatus;

    const created = unquoteYaml(scalarFromBody(body, 'created') ?? '""');
    const completedRaw = scalarFromBody(body, 'completed_at');
    const completed_at = completedRaw && completedRaw !== 'null' ? completedRaw : null;

    const modeRaw = (scalarFromBody(body, 'mode') ?? 'choice').toLowerCase();
    const mode: Mode = modeRaw === 'typed' ? 'typed' : 'choice';

    const sourceRaw = scalarFromBody(body, 'source_session');
    const source_session = sourceRaw && sourceRaw !== 'null' ? unquoteYaml(sourceRaw) : null;

    const reproduced_into = parseInlineArray(scalarFromBody(body, 'reproduced_into') ?? '[]', (s) => unquoteYaml(s));

    const session_seed = parseInt(scalarFromBody(body, 'session_seed') ?? '0', 10);
    const session_seed_default = parseInt(
        scalarFromBody(body, 'session_seed_default') ?? String(session_seed),
        10,
    );
    const rounds = parseInt(scalarFromBody(body, 'rounds') ?? '1', 10);

    const roundLines = blockLinesFromBody(body, 'round_history', 2);
    const round_history: RoundEntry[] = [];
    let currentRound: Partial<RoundEntry> | null = null;
    for (const line of roundLines) {
        if (line.startsWith('- ')) {
            if (currentRound) round_history.push(finalizeRound(currentRound, created));
            currentRound = {};
            const m = /^- (\w+):\s*(.*)$/.exec(line);
            if (m) assignRound(currentRound, m[1]!, m[2]!);
        } else if (currentRound) {
            const m = /^(\w+):\s*(.*)$/.exec(line);
            if (m) assignRound(currentRound, m[1]!, m[2]!);
        }
    }
    if (currentRound) round_history.push(finalizeRound(currentRound, created));
    if (round_history.length === 0) {
        round_history.push({ index: 1, action: 'initial', started: created, ended: null });
    }

    const snapLines = blockLinesFromBody(body, 'qs_snapshot', 2);
    const qs_snapshot = parseSnapshotBlock(snapLines);

    const frozen_pool = blockLinesFromBody(body, 'frozen_pool', 2)
        .filter((l) => l.startsWith('- '))
        .map((l) => unquoteYaml(l.slice(2).trim()));

    const initial_order = parseInlineArray(
        scalarFromBody(body, 'initial_order') ?? '[]',
        (s) => parseInt(s, 10),
    ).filter((n) => Number.isFinite(n));

    const answersLines = blockLinesFromBody(body, 'answers', 2);
    const answers: Record<string, SessionAnswerEntry> = {};
    for (const line of answersLines) {
        const m = /^"([^"]+)":\s*\{\s*(.*?)\s*\}$/.exec(line);
        if (!m) continue;
        const key = m[1]!;
        const entry: SessionAnswerEntry = {};
        for (const part of splitInlineMapEntries(m[2]!)) {
            const pm = /^(\w+):\s*(.*)$/.exec(part.trim());
            if (!pm) continue;
            const k = pm[1]!;
            const v = pm[2]!.trim();
            if (v === 'null') continue;
            if (k === 'picked') entry.picked = parseInt(v, 10);
            else if (k === 'given') entry.given = unquoteYaml(v);
            else if (k === 'typed') entry.typed = v === 'true';
            else if (k === 'submitted') entry.submitted = v === 'true';
            else if (k === 'isCorrect') entry.isCorrect = v === 'true';
            else if (k === 'firstCorrect') entry.firstCorrect = v === 'true';
            else if (k === 'timeSpentMs') {
                const n = parseFloat(v);
                if (Number.isFinite(n)) entry.timeSpentMs = n;
            } else if (k === 'timerExpired') entry.timerExpired = v === 'true';
            else if (k === 'timerRemainingMs') {
                const n = parseFloat(v);
                if (Number.isFinite(n)) entry.timerRemainingMs = n;
            }
        }
        if (entry.submitted === undefined && entry.isCorrect !== undefined) {
            entry.submitted = true;
        }
        if (entry.firstCorrect === undefined && entry.isCorrect !== undefined) {
            entry.firstCorrect = entry.isCorrect;
        }
        answers[key] = entry;
    }

    const flags = parseInlineArray(
        scalarFromBody(body, 'flags') ?? '[]',
        (s) => parseInt(s, 10),
    ).filter((n) => Number.isFinite(n));

    const scratchLines = blockLinesFromBody(body, 'scratch', 2);
    const scratch: Record<string, string> = {};
    for (const line of scratchLines) {
        const m = /^"([^"]+)":\s*"((?:[^"\\]|\\.)*)"$/.exec(line);
        if (m) scratch[m[1]!] = unquoteYaml(`"${m[2]!}"`);
    }

    const timerRaw = scalarFromBody(body, 'timer_state');
    let timer_state: TimerRuntimeState | null = null;
    if (timerRaw && timerRaw !== 'null') {
        try {
            const parsed = JSON.parse(unquoteYaml(timerRaw)) as TimerRuntimeState;
            if (parsed && typeof parsed === 'object') timer_state = parsed;
        } catch {
            timer_state = null;
        }
    }

    return {
        schema_version,
        session_id,
        session_name,
        status,
        archived_from,
        created,
        completed_at,
        mode,
        source_session,
        reproduced_into,
        session_seed,
        session_seed_default,
        rounds,
        round_history,
        qs_snapshot,
        frozen_pool,
        initial_order,
        answers,
        flags,
        scratch,
        timer_state,
    };
}

// ============================================================================
// File I/O
// ============================================================================

export async function writeSessionFile(
    vault: Vault,
    log: SessionLogState,
    items: SessionQuestion[],
    reviewDir: string,
    sessionsSubdir: string,
): Promise<TFile> {
    const sessionDir = `${reviewDir}/${sessionsSubdir}`;
    await ensureFolder(vault, reviewDir);
    await ensureFolder(vault, sessionDir);

    const baseId = log.session_id;
    let sessionId = baseId;
    let path = normalizePath(`${sessionDir}/session-${sessionId}.md`);
    let suffix = 2;
    while (vault.getAbstractFileByPath(path)) {
        sessionId = `${baseId}-${suffix}`;
        path = normalizePath(`${sessionDir}/session-${sessionId}.md`);
        suffix++;
    }
    if (sessionId !== baseId) log.session_id = sessionId;

    return vault.create(path, serializeSessionLog(log, items));
}

export async function updateSessionFile(
    vault: Vault,
    file: TFile,
    log: SessionLogState,
    items: SessionQuestion[],
): Promise<void> {
    await vault.modify(file, serializeSessionLog(log, items));
}

export interface PendingSessionFile {
    file: TFile;
    preview: SessionLogPreview;
}

export async function deleteSession(app: App, file: TFile): Promise<void> {
    await app.fileManager.trashFile(file);
}

function replaceYamlField(content: string, field: string, value: string): string {
    const re = new RegExp(`^${field}:.*$`, 'm');
    return re.test(content) ? content.replace(re, `${field}: ${value}`) : content;
}

export async function renameSession(vault: Vault, file: TFile, newName: string): Promise<void> {
    const content = await vault.read(file);
    await vault.modify(file, replaceYamlField(content, 'session_name', yamlString(newName)));
}

export async function archiveSession(vault: Vault, file: TFile): Promise<void> {
    const content = await vault.read(file);
    const statusMatch = /^status:\s*(\w+)/m.exec(content);
    const currentStatus = statusMatch?.[1] ?? 'pending';
    const targetStatus = currentStatus === 'completed' ? 'archived' : 'abandoned';
    let updated = replaceYamlField(content, 'status', targetStatus);
    updated = replaceYamlField(updated, 'archived_from', currentStatus);
    await vault.modify(file, updated);
}

export async function unarchiveSession(vault: Vault, file: TFile): Promise<void> {
    const content = await vault.read(file);
    const archivedMatch = /^archived_from:\s*(\w+)/m.exec(content);
    const archivedValue = archivedMatch?.[1];
    const restored: SessionStatus =
        archivedValue === 'completed' ? 'completed' : 'pending';
    let updated = replaceYamlField(content, 'status', restored);
    updated = replaceYamlField(updated, 'archived_from', 'null');
    await vault.modify(file, updated);
}

/** Append a reproduced session's id to the original's `reproduced_into` array. */
export async function appendReproducedInto(
    vault: Vault,
    originalFile: TFile,
    newSessionId: string,
): Promise<void> {
    const content = await vault.read(originalFile);
    const updated = content.replace(
        /^reproduced_into:\s*\[(.*?)\]\s*$/m,
        (_, inner: string) => {
            const trimmed = inner.trim();
            const existing = trimmed === '' ? [] : trimmed.split(',').map((s) => s.trim()).filter((s) => s !== '');
            if (existing.includes(newSessionId)) return `reproduced_into: [${existing.join(', ')}]`;
            existing.push(newSessionId);
            return `reproduced_into: [${existing.join(', ')}]`;
        },
    );
    await vault.modify(originalFile, updated);
}