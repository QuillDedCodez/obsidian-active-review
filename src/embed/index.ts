/**
 * `active-review` code block: registration, lifecycle, embedded start card,
 * and the controller that binds an existing SessionHub session to the note.
 *
 * The embedding layer intentionally reuses the tab's session engine:
 * `planSession`, `openFreshSession`, `renderQuizScreen`, `SharedSession`, and
 * the shared rename/leave modals. Only the start card and block lifecycle are
 * embed-specific.
 */
import {
    MarkdownRenderChild,
    MarkdownView,
    Notice,
    TFile,
    normalizePath,
} from 'obsidian';
import type { App, Component } from 'obsidian';
import type { SessionConfig } from '../constants';
import { openFreshSession, planSession, type Mode } from '../session';
import type ReviewQuizPlugin from '../main';
import type {
    SharedSession,
    SharedSessionEvent,
} from '../vault/sessionHub';
import { showLeaveModal, openRenameSessionPrompt } from '../ui/Modals';
import { displayName, relativeToReview } from '../util/paths';
import { releaseLazyMarkdown, renderMarkdown } from '../ui/MarkdownEditor';
import {
    renderQuizScreen,
    type QuizScreenHandle,
} from '../ui/screens/QuizScreen';
import {
    parseEmbedBlock,
    resolveEmbedBlock,
    type EmbedResolution,
    type ParsedEmbedBlock,
} from './spec';

export interface EmbedContinuation {
    sessionId: string;
    sessionName: string;
    submitted: number;
    total: number;
    status: 'pending' | 'completed';
    mode: Mode;
}

export interface EmbedStartScreenProps {
    app: App;
    component: Component;
    root: HTMLElement;
    sourcePath: string;
    resolution: EmbedResolution;
    starting: boolean;
    startError: string | null;
    archivedMessage: string | null;
    continuation: EmbedContinuation | null;
    onStart: () => void;
}

function modeLabel(mode: Mode): string {
    return mode === 'choice' ? 'Multiple choice' : 'Typed answer';
}

function countLabel(config: SessionConfig, total: number): string {
    if (config.count === 'all' || config.count >= total) {
        return `${total} question${total === 1 ? '' : 's'}`;
    }
    return `${config.count} of ${total} question${total === 1 ? '' : 's'}`;
}

export function renderEmbedStartScreen(props: EmbedStartScreenProps): void {
    const { root, resolution } = props;
    root.empty();
    root.removeClass('rv-embed-quiz');
    root.removeClass('rv-embedded');
    root.addClass('rv-embed-start');

    const card = root.createDiv({ cls: 'rv-embed-card' });

    if (props.archivedMessage) {
        card.createDiv({ cls: 'rv-embed-banner', text: props.archivedMessage });
    }

    if (props.continuation) {
        const { sessionId, sessionName, submitted, total } = props.continuation;
        const name = sessionName ? ` — ${sessionName}` : '';
        card.createDiv({
            cls: 'rv-embed-banner',
            text: `Session ${sessionId}${name} is still open · ${submitted}/${total} submitted. Continue where you left off.`,
        });
    }

    if (resolution.message) {
        const message = card.createDiv({ cls: 'rv-embed-message' });
        renderMarkdown(
            props.app,
            props.component,
            message,
            resolution.message,
            props.sourcePath,
        );
    } else {
        card.createEl('h2', { cls: 'rv-embed-title', text: resolution.presetName });
    }

    if (resolution.submessage) {
        card.createEl('p', {
            cls: 'rv-embed-submessage',
            text: resolution.submessage,
        });
    }

    const meta = card.createDiv({ cls: 'rv-embed-meta' });
    // Without a message the preset name is already the heading; don't repeat it.
    if (resolution.message) meta.createSpan({ text: resolution.presetName });
    if (props.continuation) {
        meta.createSpan({
            text: `${props.continuation.submitted}/${props.continuation.total} submitted`,
        });
        meta.createSpan({
            text: props.continuation.status === 'completed' ? 'Completed' : 'Pending',
        });
    } else {
        meta.createSpan({ text: countLabel(resolution.config, resolution.counts.final) });
    }
    meta.createSpan({ text: modeLabel(props.continuation?.mode ?? resolution.mode) });

    if (
        !props.continuation &&
        resolution.pool !== undefined &&
        resolution.counts.included + resolution.counts.excluded > 0
    ) {
        meta.createSpan({
            text: `+${resolution.counts.included} included · −${resolution.counts.excluded} excluded`,
        });
    }

    if (!props.continuation && (resolution.errors.length > 0 || props.startError)) {
        const errors = card.createDiv({ cls: 'rv-embed-errors' });
        errors.createEl('strong', { text: 'This embedded quiz cannot start yet.' });
        const list = errors.createEl('ul');
        for (const error of resolution.errors) list.createEl('li', { text: error });
        if (props.startError) list.createEl('li', { text: props.startError });
    }

    if (!props.continuation && resolution.warnings.length > 0) {
        const details = card.createEl('details', { cls: 'rv-embed-notes' });
        details.createEl('summary', {
            text: `${resolution.warnings.length} note${resolution.warnings.length === 1 ? '' : 's'}`,
        });
        const list = details.createEl('ul');
        for (const warning of resolution.warnings) {
            list.createEl('li', { text: warning });
        }
    }

    const actions = card.createDiv({ cls: 'rv-embed-actions' });
    const start = actions.createEl('button', {
        cls: 'mod-cta',
        text: props.continuation
            ? 'Continue review'
            : props.starting
              ? 'Starting…'
              : 'Start review',
        attr: { type: 'button' },
    });
    start.disabled = props.continuation
        ? props.starting
        : !resolution.ok || props.starting;
    start.addEventListener('click', () => props.onStart());
}

export const EMBED_LANGUAGE = 'active-review';

interface EmbedSessionEntry {
    key: string;
    sourcePath: string;
    shared: SharedSession;
    state: 'quiz' | 'start';
    viewers: number;
    cleanupTimer: number | null;
}

const embedRegistries = new WeakMap<
    ReviewQuizPlugin,
    Map<string, EmbedSessionEntry>
>();

function embedRegistry(plugin: ReviewQuizPlugin): Map<string, EmbedSessionEntry> {
    let registry = embedRegistries.get(plugin);
    if (!registry) {
        registry = new Map();
        embedRegistries.set(plugin, registry);
    }
    return registry;
}

/** Stable across Reading/Live Preview re-renders for the same block source. */
function embedKey(sourcePath: string, source: string): string {
    return `${normalizePath(sourcePath)}\u0000${source
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/, ''))
        .join('\n')
        .trim()}`;
}

function isResumable(shared: SharedSession): boolean {
    const status = shared.log.status;
    return status === 'pending' || status === 'completed';
}

function cancelEntryCleanup(entry: EmbedSessionEntry): void {
    if (entry.cleanupTimer !== null) {
        window.clearTimeout(entry.cleanupTimer);
        entry.cleanupTimer = null;
    }
}

function removeEntry(
    plugin: ReviewQuizPlugin,
    entry: EmbedSessionEntry,
): void {
    cancelEntryCleanup(entry);
    const registry = embedRegistry(plugin);
    if (registry.get(entry.key) === entry) registry.delete(entry.key);
}

/**
 * A note can stay open while no code-block child is mounted: Source mode shows
 * the fence as plain text, and mobile mode switches can unmount the old child
 * before the new one is ready. The leaf, not the renderer, owns persistence.
 */
export function noteIsOpen(
    plugin: ReviewQuizPlugin,
    sourcePath: string,
): boolean {
    const path = normalizePath(sourcePath);
    let open = false;
    plugin.app.workspace.iterateAllLeaves((leaf) => {
        if (open) return;
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file) {
            if (normalizePath(view.file.path) === path) open = true;
        }
    });
    return open;
}

/** Drop an unrendered entry only once its note is no longer open. */
function dropEntryIfClosed(
    plugin: ReviewQuizPlugin,
    entry: EmbedSessionEntry,
): void {
    if (entry.viewers > 0) return;
    if (noteIsOpen(plugin, entry.sourcePath)) return;
    const registry = embedRegistry(plugin);
    if (registry.get(entry.key) !== entry) return;
    registry.delete(entry.key);
    // A tab may have resumed this session from history; leave its runtime alone.
    if (entry.shared.hasViewers()) return;
    plugin.getSessionHub().drop(entry.shared);
    entry.shared.dispose();
}

/**
 * Defer cleanup so a renderer can reattach during a mode switch. A note that
 * is still open keeps its entry even after the timer expires; a later layout
 * change schedules another check when the note is finally closed.
 */
function scheduleEntryCleanup(
    plugin: ReviewQuizPlugin,
    entry: EmbedSessionEntry,
): void {
    if (entry.cleanupTimer !== null) return;
    const registry = embedRegistry(plugin);
    if (registry.get(entry.key) !== entry) return;
    entry.cleanupTimer = window.setTimeout(() => {
        entry.cleanupTimer = null;
        dropEntryIfClosed(plugin, entry);
    }, 1000);
}

function watchEmbedRegistry(plugin: ReviewQuizPlugin): void {
    plugin.registerEvent(
        plugin.app.workspace.on('layout-change', () => {
            const registry = embedRegistries.get(plugin);
            if (!registry) return;
            for (const entry of [...registry.values()]) {
                if (entry.viewers > 0) continue;
                if (noteIsOpen(plugin, entry.sourcePath)) continue;
                scheduleEntryCleanup(plugin, entry);
            }
        }),
    );
}

/** Plugin unload: forget every in-memory embed session. */
export function disposeEmbedRegistry(plugin: ReviewQuizPlugin): void {
    const registry = embedRegistries.get(plugin);
    if (!registry) return;
    for (const entry of registry.values()) {
        cancelEntryCleanup(entry);
        entry.shared.dispose();
    }
    registry.clear();
    embedRegistries.delete(plugin);
}

export function registerActiveReviewEmbed(plugin: ReviewQuizPlugin): void {
    watchEmbedRegistry(plugin);
    plugin.registerMarkdownCodeBlockProcessor(
        EMBED_LANGUAGE,
        async (source, el, ctx) => {
            // Settings (notably `reviewDir`) are loaded after onload. Waiting
            // for that small gate avoids mounting a quiz inside the review root
            // during the first layout pass, without waiting for the full index.
            await plugin.settingsReady;
            const reviewDir = plugin.settings.reviewDir;
            if (relativeToReview(ctx.sourcePath, reviewDir) !== null) {
                renderPlainCodeBlock(el, source);
                return;
            }
            const child = new ActiveReviewEmbedChild(
                el,
                plugin,
                source,
                ctx.sourcePath,
            );
            ctx.addChild(child);
        },
    );
}

class ActiveReviewEmbedChild extends MarkdownRenderChild {
    private controller: EmbedController | null = null;

    constructor(
        containerEl: HTMLElement,
        private readonly plugin: ReviewQuizPlugin,
        private readonly source: string,
        private readonly sourcePath: string,
    ) {
        super(containerEl);
    }

    onload(): void {
        this.controller = new EmbedController(
            this.containerEl,
            this.plugin,
            this,
            this.sourcePath,
            this.source,
        );
        this.registerDomEvent(activeDocument, 'visibilitychange', () => {
            this.controller?.handleVisibility(!activeDocument.hidden);
        });
        void this.controller.init();
    }

    onunload(): void {
        this.controller?.destroy();
        this.controller = null;
    }
}

/** Reproduce Obsidian's plain code block when the block is inside the root. */
function renderPlainCodeBlock(el: HTMLElement, source: string): void {
    el.empty();
    el.addClass('rv-embed-plain');
    const text = source.replace(/\r\n?/g, '\n');
    const pre = el.createEl('pre', { cls: `language-${EMBED_LANGUAGE}` });
    pre.createEl('code', {
        cls: `language-${EMBED_LANGUAGE}`,
        text,
    });
}

export class EmbedController {
    private readonly viewID = `embed-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    private readonly key: string;
    private entry: EmbedSessionEntry | null = null;
    private parsed: ParsedEmbedBlock | null = null;
    private resolution: EmbedResolution | null = null;
    private shared: SharedSession | null = null;
    private screen: QuizScreenHandle | null = null;
    private saveConfig: SessionConfig | null = null;
    private mode: Mode = 'choice';
    private navigatorShown = true;
    private starting = false;
    private startError: string | null = null;
    private archivedMessage: string | null = null;
    private generationNoticeShown = false;
    private disposed = false;
    private inSession = false;

    constructor(
        private readonly root: HTMLElement,
        private readonly plugin: ReviewQuizPlugin,
        private readonly component: Component,
        private readonly sourcePath: string,
        private readonly source: string,
    ) {
        this.key = embedKey(sourcePath, source);
    }

    async init(): Promise<void> {
        this.root.addClass('rv-root', 'rv-embed');
        const candidate = embedRegistry(this.plugin).get(this.key) ?? null;
        if (candidate) {
            cancelEntryCleanup(candidate);
            this.adoptEntry(candidate);
            if (!isResumable(candidate.shared)) this.forgetEntry();
        }
        this.renderLoading();
        await this.plugin.whenReady();
        if (this.disposed) return;
        if (
            this.entry &&
            this.entry.state === 'quiz' &&
            isResumable(this.entry.shared)
        ) {
            this.attachShared(this.entry.shared);
            return;
        }
        this.renderStart();
    }

    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.screen?.destroy();
        this.screen = null;
        releaseLazyMarkdown(this.root);
        const shared = this.shared;
        const entry = this.entry;
        if (entry) {
            if (this.inSession) entry.state = 'quiz';
            entry.viewers = Math.max(0, entry.viewers - 1);
        }
        this.shared = null;
        this.inSession = false;
        this.entry = null;
        if (shared) {
            void shared.suspend(this.viewID).then(() => {
                if (entry) scheduleEntryCleanup(this.plugin, entry);
            });
        } else if (entry) {
            scheduleEntryCleanup(this.plugin, entry);
        }
        this.root.empty();
    }

    handleVisibility(visible: boolean): void {
        if (this.disposed) return;
        this.shared?.setDocumentVisible(visible);
    }

    // ------------------------------------------------------------------
    // Start screen
    // ------------------------------------------------------------------

    private renderLoading(): void {
        this.root.empty();
        this.root.removeClass('rv-embed-quiz');
        this.root.addClass('rv-embed-start');
        const card = this.root.createDiv({ cls: 'rv-embed-card' });
        card.createEl('p', { cls: 'rv-muted', text: 'Loading the question index…' });
    }

    private resolve(): void {
        this.parsed = parseEmbedBlock(this.source);
        const plugin = this.plugin;
        const issues = new Map(plugin.getIssues());
        this.resolution = resolveEmbedBlock(this.parsed, {
            presets: plugin.getSessionPresets(),
            managePresets: plugin.getManagePresets(),
            questions: plugin.getQuestions(),
            issues,
            lastCustomSelection: plugin.getLastCustomSelection(),
            reviewDir: plugin.settings.reviewDir,
            sourcePath: this.sourcePath,
            defaultSessionName: displayName(this.sourcePath),
            resolveLink: (link, sourcePath) => this.resolveLink(link, sourcePath),
        });
    }

    private resolveLink(link: string, sourcePath: string): string | null {
        const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(
            link,
            sourcePath,
        );
        if (dest) return dest.path;

        const candidate = link.endsWith('.md') ? link : `${link}.md`;
        const direct = this.plugin.app.vault.getAbstractFileByPath(candidate);
        return direct instanceof TFile ? direct.path : null;
    }

    private continuationInfo(): EmbedContinuation | null {
        const entry = this.entry;
        if (!entry || !isResumable(entry.shared)) return null;
        const log = entry.shared.log;
        const submitted = Object.values(log.answers).filter(
            (answer) => answer.submitted === true,
        ).length;
        const total =
            entry.shared.plannedEntries.length || entry.shared.items.length;
        return {
            sessionId: log.session_id,
            sessionName: log.session_name.trim(),
            submitted,
            total,
            status: log.status as 'pending' | 'completed',
            mode: entry.shared.mode,
        };
    }

    /** Take ownership of a registry entry for this mounted controller. */
    private adoptEntry(entry: EmbedSessionEntry): void {
        if (this.entry === entry) return;
        entry.viewers++;
        this.entry = entry;
    }

    /** Drop an entry this controller owns but is not attached to. */
    private forgetEntry(): void {
        const entry = this.entry;
        if (!entry) return;
        this.entry = null;
        entry.viewers = Math.max(0, entry.viewers - 1);
        if (entry.viewers > 0) return;
        removeEntry(this.plugin, entry);
        if (entry.shared.hasViewers()) return;
        this.plugin.getSessionHub().drop(entry.shared);
        entry.shared.dispose();
    }

    /** New session / archived elsewhere: release, drop, and show Start cleanly. */
    private async forgetCurrent(): Promise<void> {
        const shared = this.shared;
        const entry = this.entry;
        this.shared = null;
        this.inSession = false;
        if (shared) await shared.release(this.viewID);
        if (entry) {
            this.entry = null;
            entry.viewers = Math.max(0, entry.viewers - 1);
            if (entry.viewers > 0) return;
            removeEntry(this.plugin, entry);
            if (entry.shared.hasViewers()) return;
            this.plugin.getSessionHub().drop(entry.shared);
            entry.shared.dispose();
        } else if (shared && !shared.hasViewers()) {
            this.plugin.getSessionHub().drop(shared);
            shared.dispose();
        }
    }

    private renderStart(): void {
        if (this.disposed) return;
        this.screen?.destroy();
        this.screen = null;
        releaseLazyMarkdown(this.root);
        this.inSession = false;
        this.resolve();
        const resolution = this.resolution!;
        const continuation = this.continuationInfo();
        renderEmbedStartScreen({
            app: this.plugin.app,
            component: this.component,
            root: this.root,
            sourcePath: this.sourcePath,
            resolution,
            starting: this.starting,
            startError: this.startError,
            archivedMessage: this.archivedMessage,
            continuation,
            onStart: () => {
                if (continuation) this.continueSession();
                else void this.startSession();
            },
        });
    }

    private continueSession(): void {
        const entry = this.entry ?? embedRegistry(this.plugin).get(this.key) ?? null;
        if (!entry || !isResumable(entry.shared)) {
            if (entry) {
                this.adoptEntry(entry);
                this.forgetEntry();
            }
            this.renderStart();
            return;
        }
        cancelEntryCleanup(entry);
        this.adoptEntry(entry);
        entry.state = 'quiz';
        this.attachShared(entry.shared);
    }

    private async startSession(): Promise<void> {
        if (this.disposed || this.starting) return;
        const existing =
            this.entry ?? embedRegistry(this.plugin).get(this.key) ?? null;
        if (existing) {
            if (isResumable(existing.shared)) {
                this.continueSession();
                return;
            }
            this.adoptEntry(existing);
            this.forgetEntry();
        }
        this.starting = true;
        this.startError = null;
        this.archivedMessage = null;
        this.renderStart();

        try {
            const resolution = this.resolution!;
            if (!resolution.ok) {
                throw new Error('Resolve the embedded quiz errors before starting.');
            }
            const plan = planSession(
                resolution.questions,
                resolution.config,
                this.plugin.settings.reviewDir,
            );
            if (plan.planned.length === 0) {
                throw new Error(
                    plan.errors.length > 0
                        ? plan.errors.join('; ')
                        : 'No questions could be planned for this session.',
                );
            }
            if (plan.errors.length > 0) {
                new Notice(
                    `Skipped ${plan.errors.length} question(s): ${plan.errors.join('; ')}`,
                    8000,
                );
            }

            this.saveConfig = {
                ...resolution.config,
                seed: plan.effectiveSeedInput,
            };
            this.mode = resolution.mode;
            this.navigatorShown = this.saveConfig.navigator;
            const opened = await openFreshSession({
                vault: this.plugin.app.vault,
                hub: this.plugin.getSessionHub(),
                reviewDir: this.plugin.settings.reviewDir,
                sessionsSubdir: this.plugin.settings.sessionsSubdir,
                plan,
                config: this.saveConfig,
                mode: this.mode,
                sessionName: resolution.sessionName,
                manageSelection: resolution.manageSelection,
            });
            if (this.disposed) {
                void opened.shared.release(this.viewID);
                this.plugin.getSessionHub().drop(opened.shared);
                opened.shared.dispose();
                return;
            }

            const raced =
                embedRegistry(this.plugin).get(this.key) ?? null;
            if (raced && isResumable(raced.shared)) {
                await opened.shared.release(this.viewID);
                this.plugin.getSessionHub().drop(opened.shared);
                opened.shared.dispose();
                cancelEntryCleanup(raced);
                this.adoptEntry(raced);
                raced.state = 'quiz';
                this.attachShared(raced.shared);
                this.starting = false;
                return;
            }

            const entry: EmbedSessionEntry = {
                key: this.key,
                sourcePath: this.sourcePath,
                shared: opened.shared,
                state: 'quiz',
                viewers: 1,
                cleanupTimer: null,
            };
            embedRegistry(this.plugin).set(this.key, entry);
            this.entry = entry;
            this.attachShared(opened.shared);
        } catch (e) {
            this.startError = (e as Error).message;
            this.starting = false;
            this.renderStart();
            return;
        }
        this.starting = false;
    }

    // ------------------------------------------------------------------
    // Live session
    // ------------------------------------------------------------------

    private attachShared(shared: SharedSession): void {
        const entry =
            this.entry ?? embedRegistry(this.plugin).get(this.key) ?? null;
        if (entry) {
            cancelEntryCleanup(entry);
            this.entry = entry;
            entry.state = 'quiz';
        }
        this.shared = shared;
        this.saveConfig = { ...shared.config };
        this.mode = shared.mode;
        this.navigatorShown = shared.config.navigator;
        shared.subscribe(this.viewID, (event) => this.onSharedEvent(event));
        this.inSession = true;
        this.generationNoticeShown = false;
        shared.resumeGeneration();
        shared.prioritizeGeneration([
            shared.currentIndex,
            shared.currentIndex + 1,
            shared.currentIndex + 2,
        ]);
        shared.setDocumentVisible(
            typeof activeDocument === 'undefined' || !activeDocument.hidden,
        );
        this.renderQuiz();
    }

    private onSharedEvent(event: SharedSessionEvent): void {
        if (this.disposed || !this.shared || !this.inSession) return;
        switch (event.type) {
            case 'change':
                if (event.kind === 'bulk') {
                    this.screen?.applyBulk();
                    return;
                }
                this.screen?.applySharedChange(event.kind, event.id);
                return;
            case 'flags':
                this.screen?.applyFlags(event.flags);
                return;
            case 'index':
                if (this.shared.config.presentation === 'one') {
                    this.renderQuiz();
                }
                return;
            case 'timer':
                this.screen?.applyTimer();
                return;
            case 'item':
                this.screen?.addItem(event.item, event.displayIndex);
                return;
            case 'generation':
                this.screen?.setGenerationState({
                    built: event.built,
                    total: event.total,
                    failed: event.failed,
                    complete: event.complete,
                });
                if (event.complete) {
                    const errors = this.shared.generationErrorMessages;
                    if (errors.length > 0 && !this.generationNoticeShown) {
                        this.generationNoticeShown = true;
                        new Notice(
                            `Skipped ${errors.length} question${errors.length === 1 ? '' : 's'}: ${errors.join('; ')}`,
                            8000,
                        );
                    }
                }
                return;
            case 'generation-error':
                this.screen?.markGenerationError(
                    event.displayIndex,
                    event.message,
                );
                return;
            case 'archived':
                this.archivedMessage = `"${event.name}" was archived in another tab. This embedded session has stopped.`;
                void this.forgetCurrent().then(() => this.renderStart());
                return;
        }
    }

    private renderQuiz(): void {
        const shared = this.shared;
        const config = this.saveConfig;
        if (!shared || !config) return;

        this.screen?.destroy();
        this.screen = null;
        releaseLazyMarkdown(this.root);
        this.root.removeClass('rv-embed-start');
        this.root.addClass('rv-embed-quiz');

        const planned = [...shared.plannedEntries];
        const generation = shared.generationState;
        const seedShown =
            config.order !== 'source' || config.trim === 'rand'
                ? config.seed
                : undefined;

        this.screen = renderQuizScreen({
            app: this.plugin.app,
            component: this.component,
            root: this.root,
            items: shared.items,
            planned,
            expectedTotal: Math.max(0, planned.length - generation.failed),
            generation,
            mode: this.mode,
            displayMode: config.presentation,
            currentIndex: shared.currentIndex,
            savedFile: shared.savedFile,
            seedInput: seedShown,
            submitMode: config.submitMode,
            gradeMode: config.gradeMode,
            passScore: config.passScore,
            timerConfig: config,
            timerState: shared.timer,
            allowFlag: config.allowFlag,
            navigator: config.navigator,
            navigatorShown: this.navigatorShown,
            onNavigatorToggle: (shown) => {
                this.navigatorShown = shown;
            },
            initialFlags: shared.log.flags,
            onFlagsChange: (flags) => shared.setFlags(flags, this.viewID),
            onJump: (index) => {
                if (
                    index < 0 ||
                    index >= planned.length ||
                    index === shared.currentIndex
                ) {
                    return;
                }
                void shared.flush();
                shared.setIndex(index, this.viewID);
                this.renderQuiz();
            },
            onFlush: () => void shared.flush(),
            onRename: () => this.openRenameModal(),
            onBack: () => this.backToStart(),
            onPrev: () => {
                if (shared.currentIndex <= 0) return;
                void shared.flush();
                shared.setIndex(shared.currentIndex - 1, this.viewID);
                this.renderQuiz();
            },
            onNext: () => {
                if (shared.currentIndex >= planned.length - 1) return;
                void shared.flush();
                shared.setIndex(shared.currentIndex + 1, this.viewID);
                this.renderQuiz();
            },
            onPick: (id, picked) => shared.pick(id, picked, this.viewID),
            onDraft: (id, value) => shared.setDraft(id, value, this.viewID),
            onScratch: (id, value) => shared.setScratch(id, value, this.viewID),
            onSubmit: (id) => shared.submit(id, this.viewID),
            onSubmitAll: () => shared.submitAll('hub'),
            saveSession: (_items, mode) => shared.save(mode),
            onShowDetails: () => this.openSessionFile(),
            onNewSession: () => {
                void this.forgetCurrent().then(() => this.renderStart());
            },
            embedded: true,
            showDetailsLabel: 'Open session note',
        });
    }

    private backToStart(): void {
        const shared = this.shared;
        const answered =
            shared?.items.filter((item) => item.isCorrect !== undefined).length ??
            0;
        const leave = (): void => {
            const shared = this.shared;
            const entry = this.entry;
            if (entry) entry.state = 'start';
            this.shared = null;
            this.inSession = false;
            if (shared) void shared.suspend(this.viewID);
            this.renderStart();
        };
        if (answered === 0 || shared?.saved) {
            leave();
            return;
        }
        showLeaveModal({
            parent: this.root,
            answered,
            onLeave: leave,
        });
    }

    private openRenameModal(): void {
        const shared = this.shared;
        if (!shared) return;
        openRenameSessionPrompt(this.plugin.app, {
            initialName: shared.log.session_name,
            onSave: (name) => {
                void shared.runtime.rename(name).catch((e) => {
                    new Notice(`Rename failed: ${(e as Error).message}`);
                });
            },
        });
    }

    private openSessionFile(): void {
        const file: TFile | null = this.shared?.savedFile ?? null;
        if (!(file instanceof TFile)) {
            new Notice('The session note has not been saved yet.');
            return;
        }
        void this.plugin.app.workspace.getLeaf('tab').openFile(file);
    }
}
