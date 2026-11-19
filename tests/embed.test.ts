import { test, assert } from './harness';
import { DEFAULT_SESSION_CONFIG } from '../src/constants';
import type { Question } from '../src/parser';
import type { ManageQuestionPreset } from '../src/vault/managePresets';
import type { SessionPreset } from '../src/vault/sessionPresets';
import { MarkdownView } from 'obsidian';
import { noteIsOpen } from '../src/embed/index';
import { parseEmbedBlock } from '../src/embed/spec';
import {
    resolveEmbedBlock,
    type EmbedResolveContext,
} from '../src/embed/spec';

function question(path: string, declaredCategory: string[] = []): Question {
    return {
        path,
        title: path.split('/').pop() ?? path,
        variants: ['Question?'],
        explanation: '',
        category: declaredCategory,
        categorySource: 'folder',
        declaredCategory,
        warnings: [],
        ignoredWarnings: new Set<string>(),
        literalSections: new Set<string>(),
        answerMode: 'text',
        answerBlocks: ['Answer'],
        numericAnswerBlocks: [],
        distractorBlocks: [],
        vars: [],
        links: [],
        answerName: '',
        answerValNames: [],
        priority: 100,
    };
}

function sessionPreset(overrides: Partial<SessionPreset> = {}): SessionPreset {
    return {
        id: 'sp-1',
        name: 'Exam Mode',
        mode: 'choice',
        showOnStart: true,
        config: { ...DEFAULT_SESSION_CONFIG },
        ...overrides,
    };
}

function questionPreset(
    id: string,
    name: string,
    includedPaths: string[],
): ManageQuestionPreset {
    return { id, name, includedPaths, showOnStart: true };
}

function context(
    overrides: Partial<EmbedResolveContext> = {},
): EmbedResolveContext {
    const questions = [
        question('review/a.md'),
        question('review/b.md'),
        question('review/c.md'),
        question('review/typed/d.md', ['wrong']),
    ];
    return {
        presets: [sessionPreset()],
        managePresets: [],
        questions,
        issues: new Map<string, string>(),
        lastCustomSelection: [],
        reviewDir: 'review',
        sourcePath: 'host/note.md',
        defaultSessionName: 'Host note',
        resolveLink: (link) => (link.startsWith('review/') ? `${link}.md` : null),
        ...overrides,
    };
}

// ============================================================================
// Parser
// ============================================================================

test('embed parser: minimal block', () => {
    const parsed = parseEmbedBlock('sessionPreset: Exam Mode\n');
    assert.equal(parsed.sessionPreset, 'Exam Mode');
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.include, []);
});

test('embed parser: CRLF, comments, and blank lines', () => {
    const parsed = parseEmbedBlock(
        '# comment\r\nsessionPreset: "Exam Mode"\r\n\r\n// another\r\ncount: 5\r\n',
    );
    assert.equal(parsed.sessionPreset, 'Exam Mode');
    assert.equal(parsed.overrides.count, 5);
    assert.deepEqual(parsed.errors, []);
});

test('embed parser: message literal block and submessage inline', () => {
    const parsed = parseEmbedBlock(
        [
            'sessionPreset: Exam',
            'message: |',
            '  ## Chapter 4',
            '',
            '  Read carefully.',
            'submessage: 10 questions',
        ].join('\n'),
    );
    assert.equal(parsed.message, '## Chapter 4\n\nRead carefully.');
    assert.equal(parsed.submessage, '10 questions');
});

test('embed parser: include and exclude accept links in several styles', () => {
    const parsed = parseEmbedBlock(
        [
            'sessionPreset: Exam',
            'include:',
            '  [[review/a|alias]]',
            '  - [[review/b#Heading]]',
            '  [[review/c^block]]',
            '  [d](review/typed/d.md)',
            '  review/e',
            'include: [[review/f]]',
            'exclude:',
            '  [[review/a]]',
        ].join('\n'),
    );
    assert.deepEqual(parsed.include, [
        'review/a',
        'review/b',
        'review/c',
        'review/typed/d.md',
        'review/e',
        'review/f',
    ]);
    assert.deepEqual(parsed.exclude, ['review/a']);
});

test('embed parser: config aliases, enums, and booleans', () => {
    const parsed = parseEmbedBlock(
        [
            'sessionPreset: Exam',
            'choices: 3',
            'submit: auto',
            'grade: after-all',
            'pass: 75',
            'order: priority-random',
            'presentation: one',
            'navigator: false',
            'allowFlag: no',
            'timersessionmode: soft',
            'timerSessionSeconds: 300',
        ].join('\n'),
    );
    assert.equal(parsed.overrides.choiceCount, 3);
    assert.equal(parsed.overrides.submitMode, 'auto');
    assert.equal(parsed.overrides.gradeMode, 'afterAll');
    assert.equal(parsed.overrides.passScore, 75);
    assert.equal(parsed.overrides.order, 'priority-random');
    assert.equal(parsed.overrides.presentation, 'one');
    assert.equal(parsed.overrides.navigator, false);
    assert.equal(parsed.overrides.allowFlag, false);
    assert.equal(parsed.overrides.timerSessionMode, 'soft');
    assert.equal(parsed.overrides.timerSessionSeconds, 300);
});

test('embed parser: missing sessionPreset is an error', () => {
    const parsed = parseEmbedBlock('count: 5\n');
    assert.equal(parsed.sessionPreset, '');
    assert.ok(parsed.errors.some((e) => e.includes('sessionPreset is required')));
});

test('embed parser: unknown key and invalid value produce warnings', () => {
    const parsed = parseEmbedBlock(
        'sessionPreset: Exam\nflavour: mint\nchoiceCount: 99\nmode: essay\n',
    );
    assert.equal(parsed.overrides.choiceCount, 6);
    assert.equal(parsed.mode, null);
    assert.ok(parsed.warnings.some((w) => w.includes('flavour')));
    assert.ok(parsed.warnings.some((w) => w.includes('clamped')));
    assert.ok(parsed.warnings.some((w) => w.includes('mode')));
});

test('embed parser: questionPresets accepts a comma-separated list', () => {
    const parsed = parseEmbedBlock(
        'sessionPreset: Exam\nquestionPresets: Algebra, Geometry\n',
    );
    assert.deepEqual(parsed.questionPresets, ['Algebra', 'Geometry']);
});

test('embed parser: pool replace and duplicate key warning', () => {
    const parsed = parseEmbedBlock(
        'sessionPreset: Exam\npool: replace\ncount: 4\ncount: 8\n',
    );
    assert.equal(parsed.pool, 'replace');
    assert.equal(parsed.overrides.count, 8);
    assert.ok(parsed.warnings.some((w) => w.includes('duplicate')));
});

// ============================================================================
// Resolver
// ============================================================================

test('embed resolver: preset by name, case-insensitive, hidden allowed', () => {
    const parsed = parseEmbedBlock('sessionPreset: exam mode\n');
    const resolved = resolveEmbedBlock(
        parsed,
        context({
            presets: [sessionPreset({ showOnStart: false })],
        }),
    );
    assert.equal(resolved.ok, true);
    assert.equal(resolved.preset?.id, 'sp-1');
    assert.equal(resolved.questions.length, 3);
});

test('embed resolver: preset by id', () => {
    const parsed = parseEmbedBlock('sessionPreset: sp-1\n');
    const resolved = resolveEmbedBlock(parsed, context());
    assert.equal(resolved.ok, true);
    assert.equal(resolved.presetName, 'Exam Mode');
});

test('embed resolver: missing preset lists available names', () => {
    const parsed = parseEmbedBlock('sessionPreset: Nope\n');
    const resolved = resolveEmbedBlock(
        parsed,
        context({
            presets: [
                sessionPreset(),
                sessionPreset({ id: 'sp-2', name: 'Hidden One', showOnStart: false }),
            ],
        }),
    );
    assert.equal(resolved.ok, false);
    const message = resolved.errors.join(' ');
    assert.ok(message.includes('Nope'));
    assert.ok(message.includes('Exam Mode'));
    assert.ok(message.includes('Hidden One (hidden)'));
});

test('embed resolver: block overrides beat preset config', () => {
    const parsed = parseEmbedBlock(
        'sessionPreset: Exam Mode\nchoices: 3\npresentation: one\n',
    );
    const resolved = resolveEmbedBlock(
        parsed,
        context({
            presets: [sessionPreset({ config: { ...DEFAULT_SESSION_CONFIG, choiceCount: 5 } })],
        }),
    );
    assert.equal(resolved.config.choiceCount, 3);
    assert.equal(resolved.config.presentation, 'one');
});

test('embed resolver: typed plus auto becomes submit any', () => {
    const parsed = parseEmbedBlock('sessionPreset: Exam Mode\nsubmit: auto\n');
    const resolved = resolveEmbedBlock(
        parsed,
        context({ presets: [sessionPreset({ mode: 'typed' })] }),
    );
    assert.equal(resolved.mode, 'typed');
    assert.equal(resolved.config.submitMode, 'any');
});

test('embed resolver: question preset overrides the pool and unions names', () => {
    const parsed = parseEmbedBlock(
        'sessionPreset: Exam Mode\nquestionPresets: A, B\n',
    );
    const resolved = resolveEmbedBlock(
        parsed,
        context({
            managePresets: [
                questionPreset('qp-a', 'A', ['review/a.md']),
                questionPreset('qp-b', 'B', ['review/b.md', 'review/a.md']),
            ],
        }),
    );
    assert.equal(resolved.ok, true);
    assert.deepEqual(
        resolved.questions.map((q) => q.path),
        ['review/a.md', 'review/b.md'],
    );
    assert.equal(resolved.manageSelection.name, 'A + B');
});

test('embed resolver: include adds, deduplicates, and exclude wins', () => {
    const parsed = parseEmbedBlock(
        [
            'sessionPreset: Exam Mode',
            'pool: replace',
            'include:',
            '  [[review/a]]',
            '  [[review/b]]',
            '  [[review/a]]',
            'exclude:',
            '  [[review/b]]',
        ].join('\n'),
    );
    const resolved = resolveEmbedBlock(parsed, context());
    assert.equal(resolved.ok, true);
    assert.deepEqual(
        resolved.questions.map((q) => q.path),
        ['review/a.md'],
    );
    assert.equal(resolved.counts.included, 2);
    assert.equal(resolved.counts.excluded, 1);
});

test('embed resolver: unresolved links warn instead of failing', () => {
    const parsed = parseEmbedBlock(
        [
            'sessionPreset: Exam Mode',
            'pool: replace',
            'include:',
            '  [[missing]]',
            '  [[outside/note]]',
        ].join('\n'),
    );
    const resolved = resolveEmbedBlock(parsed, context());
    assert.equal(resolved.ok, false);
    assert.ok(resolved.warnings.some((w) => w.includes('missing')));
    assert.ok(resolved.warnings.some((w) => w.includes('outside/note')));
    assert.ok(resolved.errors.some((e) => e.includes('no questions')));
});

test('embed resolver: category mismatch is a warning and is excluded', () => {
    const parsed = parseEmbedBlock(
        [
            'sessionPreset: Exam Mode',
            'pool: replace',
            'include: [[review/typed/d]]',
        ].join('\n'),
    );
    const resolved = resolveEmbedBlock(parsed, context());
    assert.equal(resolved.ok, false);
    assert.ok(resolved.warnings.some((w) => w.includes('Category Sync')));
    assert.equal(resolved.questions.length, 0);
});

test('embed resolver: session name defaults to the host note', () => {
    const parsed = parseEmbedBlock('sessionPreset: Exam Mode\n');
    const resolved = resolveEmbedBlock(parsed, context());
    assert.equal(resolved.sessionName, 'Host note');

    const named = resolveEmbedBlock(
        parseEmbedBlock('sessionPreset: Exam Mode\nsessionName: Chapter 4\n'),
        context(),
    );
    assert.equal(named.sessionName, 'Chapter 4');
});

test('embed resolver: an empty base pool is a blocking error', () => {
    const parsed = parseEmbedBlock('sessionPreset: Exam Mode\n');
    const resolved = resolveEmbedBlock(
        parsed,
        context({
            presets: [sessionPreset({ config: { ...DEFAULT_SESSION_CONFIG, managePresetId: 'qp-empty' } })],
            managePresets: [questionPreset('qp-empty', 'Empty', [])],
        }),
    );
    assert.equal(resolved.ok, false);
    assert.ok(resolved.errors.some((e) => e.includes('No questions')));
});

function pluginWithMarkdownLeaves(paths: string[]) {
    const leaves = paths.map((path) => {
        const view = new MarkdownView({} as never);
        (view as { file?: { path: string } }).file = { path };
        return { view };
    });
    return {
        app: {
            workspace: {
                iterateAllLeaves: (cb: (leaf: unknown) => void) => {
                    for (const leaf of leaves) cb(leaf);
                },
            },
        },
    } as unknown as Parameters<typeof noteIsOpen>[0];
}

test('embed persistence follows the open note leaf, not the renderer', () => {
    const open = pluginWithMarkdownLeaves(['notes/quiz.md']);
    assert.equal(noteIsOpen(open, 'notes/quiz.md'), true);
    assert.equal(noteIsOpen(open, 'notes/other.md'), false);
    assert.equal(noteIsOpen(pluginWithMarkdownLeaves([]), 'notes/quiz.md'), false);
});
