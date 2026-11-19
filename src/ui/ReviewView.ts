/** The quiz view: owns session state, delegates rendering to the screen modules. */
import { ItemView, Modal, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import {
    DEFAULT_SESSION_CONFIG,
    PLUGIN_NAME,
    VIEW_TYPE,
    type SessionConfig,
} from '../constants';
import type ReviewQuizPlugin from '../main';
import {
    buildQuestion,
    buildSessionFromFrozen,
    createTimerRuntime,
    createTimerRuntimeForIds,
    generationEntries,
    hydrateSessionItems,
    openFreshSession,
    planFrozenSession,
    planSession,
    sanitizeSessionConfig,
    type Mode,
    type SessionQuestion,
} from '../session';
import { deriveSessionSeed, deriveStreamSeed, mulberry32 } from '../session/rng';
import { orderPool } from '../session/order';
import type { Question } from '../parser';
import {
    appendReproducedInto,
    archiveSession,
    configFromSnapshot,
    deleteSession,
    generateSessionId,
    renameSession,
    snapshotFromConfig,
    unarchiveSession,
    writeSessionFile,
    type SessionLogState,
    type SessionSummary,
} from '../vault/sessionLog';
import { SessionRuntime } from '../vault/sessionRuntime';
import type {
    SharedSession,
    SharedSessionEvent,
} from '../vault/sessionHub';
import {
    ConfirmModal,
    InfoModal,
    showLeaveModal,
    openRenameSessionPrompt,
    openSavePresetPrompt,
    openUpdatePresetPrompt,
} from './Modals';
import { ReproduceConfigModal } from './history/ReproduceConfigModal';
import { relativeToReview } from '../util/paths';
import { SessionHistoryModal } from './history/SessionHistoryModal';
import { renderQuizScreen, type DisplayMode, type QuizScreenHandle } from './screens/QuizScreen';
import { renderSessionDetailPanel, sessionDetailTitle, type SessionDetailAction } from './history/SessionDetailPanel';
import type {
    SessionHistoryExpanded,
    SessionHistoryView,
} from './history/SessionHistoryPanel';
import { renderSessionViewScreen, type SessionViewScreenHandle } from './screens/SessionViewScreen';
import { renderStartScreen, refreshSessionConfigArea, type StartScreenProps } from './screens/StartScreen';
import { releaseLazyMarkdown } from './MarkdownEditor';
import { ManageQuestionsModal } from './manage/ManageQuestionsModal';
import { SessionPresetsModal } from './presets/SessionPresets';
import { QuestionPresetsModal } from './presets/QuestionPresets';
import {
    isQuestionMatched,
    resolveManageSelection,
    type ManageQuestionPreset,
    type ManageSelection,
} from '../vault/managePresets';
import type { SessionPreset } from '../vault/sessionPresets';

/**
 * Outcome hooks for a session-detail action that opens a second-layer modal
 * (Reproduce, Restart, Rename, Delete). The owning view keeps itself open
 * while that layer is up and acts only when it settles.
 */
interface SessionActionHooks {
    /** The second-layer modal confirmed the action. */
    onLayerConfirm?: () => void;
}

export class ReviewView extends ItemView {
    private mode: Mode = 'choice';
    private pendingSessionName = '';
    private sessionConfig: SessionConfig = { ...DEFAULT_SESSION_CONFIG };
    private activeSessionPresetId: string | null = null;
    private sessionPresetsExpanded = false;
    private managePresetsExpanded = false;
    private saveConfig: SessionConfig = { ...DEFAULT_SESSION_CONFIG };
    private navigatorShown = true;
    private shared: SharedSession | null = null;
    private readonly viewID = `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    private generationNoticeShown = false;
    private inSession = false;
    private screen: QuizScreenHandle | null = null;
    private disposed = false;
    private renderPromise: Promise<void> | null = null;
    private renderPending = false;
    private renderPendingReload = false;

    private get session(): SessionRuntime | null {
        return this.shared?.runtime ?? null;
    }

    private get sessionLog(): SessionLogState | null {
        return this.session?.log ?? null;
    }

    private get items(): SessionQuestion[] {
        return this.session?.items ?? [];
    }

    private get saved(): boolean {
        return this.session?.saved ?? false;
    }

    private get savedFile(): TFile | null {
        return this.session?.savedFile ?? null;
    }

    private get currentIndex(): number {
        return this.shared?.currentIndex ?? 0;
    }

    private sessions: SessionSummary[] = [];
    private sessionsPanelOpen = false;
    private sessionsView: SessionHistoryView = 'recent';
    private sessionsExpanded: SessionHistoryExpanded = {
        recent: false,
        archived: false,
    };

    // View-mode state
    private viewLog: SessionLogState | null = null;
    private viewFile: TFile | null = null;
    private viewItems: SessionQuestion[] = [];
    private viewDisplayMode: 'all' | 'one' = 'all';
    private viewCurrentIndex = 0;
    private viewHandle: SessionViewScreenHandle | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private plugin: ReviewQuizPlugin,
    ) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE; }
    getDisplayText(): string { return PLUGIN_NAME; }
    getIcon(): string { return 'list-checks'; }

    async onOpen(): Promise<void> {
        this.disposed = false;
        this.contentEl.addClass('rv-root');
        this.registerDomEvent(activeDocument, 'visibilitychange', () => {
            if (this.disposed) return;
            const visible = !activeDocument.hidden;
            this.shared?.setDocumentVisible(visible);
            this.updateStreamingVisibility();
            if (!visible) void this.flushSession();
        });
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () =>
                this.updateStreamingVisibility(),
            ),
        );
        this.registerEvent(
            this.app.workspace.on('layout-change', () =>
                this.updateStreamingVisibility(),
            ),
        );
        this.renderLoading();

        // Never let a restored tab block Obsidian's workspace load on the
        // persistent index. Render a shell now and fill it in once the plugin
        // has hydrated (or finished its bootstrap scan).
        void this.plugin.whenReady().then(() => {
            if (this.disposed) return;
            this.sessionConfig = { ...this.plugin.settings.sessionDefaults };
            void this.renderStart();
        });
    }

    onClose(): Promise<void> {
        this.disposed = true;
        this.screen?.destroy();
        this.screen = null;
        this.viewHandle?.destroy();
        this.viewHandle = null;
        releaseLazyMarkdown(this.contentEl);
        return this.endSession();
    }

    /** Human-readable label used by the "already open" tab picker. */
    getTabLabel(): string {
        if (this.viewLog) return `View ${this.viewLog.session_id}`;
        const log = this.shared?.log;
        if (!log) return 'Start screen';
        const name = log.session_name.trim();
        return name ? `${log.session_id} — ${name}` : log.session_id;
    }

    /** Detach this view from its shared session and flush the last state. */
    private async endSession(): Promise<void> {
        const shared = this.shared;
        this.shared = null;
        this.inSession = false;
        if (shared) await shared.release(this.viewID);
    }

    /** Join a shared session group and render its quiz screen. */
    private attachShared(shared: SharedSession): void {
        this.shared = shared;
        this.saveConfig = { ...shared.config };
        this.mode = shared.mode;
        this.navigatorShown = this.saveConfig.navigator;
        shared.subscribe(this.viewID, (event) => this.onSharedEvent(event));
        this.inSession = true;
        this.generationNoticeShown = false;
        shared.resumeGeneration();
        shared.prioritizeGeneration([
            this.currentIndex,
            this.currentIndex + 1,
            this.currentIndex + 2,
        ]);
        shared.setDocumentVisible(
            typeof activeDocument === 'undefined' || !activeDocument.hidden,
        );
        this.renderQuiz();
    }

    /** Pause card DOM work when this leaf is not the visible tab. */
    private updateStreamingVisibility(): void {
        if (!this.screen) return;
        this.screen.setRenderingPaused(!this.contentEl.isShown());
    }

    private onSharedEvent(event: SharedSessionEvent): void {        if (this.disposed || !this.shared || !this.inSession) return;
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
                if (this.saveConfig.presentation === 'one') {
                    this.renderQuiz(true);
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
                this.onSessionArchivedElsewhere(event.name);
                return;
        }
    }

    /**
     * Another tab archived the session this view is running. The runtime was
     * already frozen on the archiving side, so all that is left here is the
     * note; acknowledging it (or dismissing the modal any other way) returns
     * this tab to the start screen and detaches the shared session.
     */
    private onSessionArchivedElsewhere(sessionName: string): void {
        new InfoModal(this.app, {
            title: 'Session archived',
            message: `"${sessionName}" was archived in another tab. This tab will return to the start screen.`,
            confirmLabel: 'Back to start screen',
            onDismiss: () => void this.renderStart(),
        }).open();
    }

    private renderLoading(): void {
        this.destroyScreens();
        this.contentEl.empty();
        this.contentEl.addClass('rv-start-mode');
        const body = this.contentEl.createDiv({ cls: 'rv-start-body' });
        const status = body.createDiv({ cls: 'rv-start-status' });
        status.createEl('p', {
            cls: 'rv-muted',
            text: 'Loading the question index…',
        });
    }

    refreshIfIdle(full = false): void {
        if (this.inSession) return;
        if (full || !this.contentEl.querySelector('.rv-session-config')) {
            void this.renderStart();
        } else {
            this.refreshStartConfigArea();
        }
    }

    private destroyScreens(): void {
        this.screen?.destroy();
        this.screen = null;
        this.viewHandle?.destroy();
        this.viewHandle = null;
        releaseLazyMarkdown(this.contentEl);
    }

    private buildStartScreenProps(): StartScreenProps {
        const all = this.plugin.getQuestions();
        const matched = all.filter((q) => isQuestionMatched(q, this.plugin.settings.reviewDir));
        // Normalize a stale/missing/hidden preset id back to All questions.
        const currentManageId = this.sessionConfig.managePresetId;
        const currentManagePreset = this.plugin.getManagePresets().find((p) => p.id === currentManageId);
        if (currentManageId !== 'all' && currentManageId !== 'last-custom' && (!currentManagePreset || currentManagePreset.showOnStart === false)) {
            this.sessionConfig.managePresetId = 'all';
        }
        const manage = this.resolveCurrentManageSelection(matched);
        if (this.sessionConfig.managePresetId !== manage.presetId) {
            this.sessionConfig.managePresetId = manage.presetId;
        }
        if (
            typeof this.sessionConfig.count === 'number' &&
            manage.questions.length > 0 &&
            this.sessionConfig.count > manage.questions.length
        ) {
            this.sessionConfig.count = manage.questions.length;
        }

        const allSessionPresets = this.plugin.getSessionPresets();
        const sessionPresets = allSessionPresets.filter((p) => p.showOnStart !== false);
        if (
            this.activeSessionPresetId !== null &&
            this.activeSessionPresetId !== '__default' &&
            !sessionPresets.some((p) => p.id === this.activeSessionPresetId)
        ) {
            this.activeSessionPresetId = null;
        }

        return {
            root: this.contentEl,
            questionCount: manage.questions.length,
            totalQuestionCount: matched.length,
            mismatchedCount: all.length - matched.length,
            issues: this.plugin.getIssues(),
            warnings: this.plugin.getWarnings(),
            mode: this.mode,
            onModeChange: (m) => {
                this.mode = m;
                this.activeSessionPresetId = null;
            },
            sessionConfig: this.sessionConfig,
            onSessionConfigChange: (patch) => {
                this.activeSessionPresetId = null;
                Object.assign(this.sessionConfig, patch);
            },
            sessionName: this.pendingSessionName,
            onSessionNameChange: (name) => { this.pendingSessionName = name; },
            onOpenSessionPresets: () => this.openSessionPresetsSettings(),
            onOpenFullHistory: () => this.openFullHistory(),
            managePresets: this.plugin.getManagePresets().filter((p) => p.showOnStart !== false),
            hasLastCustom: this.plugin.getLastCustomSelection().length > 0,
            managePresetsExpanded: this.managePresetsExpanded,
            onManagePresetsExpandedChange: (expanded) => {
                this.managePresetsExpanded = expanded;
                this.refreshStartConfigArea();
            },
            onManageQuestions: () => this.openManageQuestions(),
            onManagePresetSelect: (id) => {
                this.activeSessionPresetId = null;
                this.sessionConfig.managePresetId = id;
                this.refreshStartConfigArea();
            },
            sessionPresets,
            activeSessionPresetId: this.activeSessionPresetId,
            sessionPresetsExpanded: this.sessionPresetsExpanded,
            onSessionPresetsExpandedChange: (expanded) => {
                this.sessionPresetsExpanded = expanded;
                this.refreshStartConfigArea();
            },
            onSessionPresetSelect: (id) => this.selectSessionPreset(id),
            onSessionPresetDefault: () => this.selectSessionPreset('__default'),
            onSessionPresetSave: () => this.openSaveSessionPreset(),
            onSessionPresetUpdate: () => this.openUpdateSessionPreset(),
            onSessionPresetDirty: () => { this.activeSessionPresetId = null; },
            sessions: this.sessions,
            sessionsOpen: this.sessionsPanelOpen,
            sessionsView: this.sessionsView,
            sessionsExpanded: this.sessionsExpanded,
            onSessionsToggle: (open) => { this.sessionsPanelOpen = open; },
            onSessionsViewChange: (view) => { this.sessionsView = view; },
            onSessionsExpandedChange: (view, expanded) => {
                this.sessionsExpanded = { ...this.sessionsExpanded, [view]: expanded };
            },
            onStart: () => void this.startSession(),
            onContinueRecent: () => this.continueRecentSession(),
            onRescan: () => void this.rescanNotes(),
            onOpenSessionDetail: (summary) => this.openSessionDetail(summary),
            onOpenNote: (path) => this.openNoteInNewTab(path),
        };
    }

    /** Opens a note from the skipped/warning outlines without replacing the quiz view. */
    private openNoteInNewTab(path: string): void {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            void this.app.workspace.getLeaf('tab').openFile(file);
            return;
        }
        new Notice(`Note not found: ${path}`);
    }

    private refreshStartConfigArea(): void {
        const props = this.buildStartScreenProps();
        refreshSessionConfigArea(this.contentEl, props);
    }

    /** Rescan Notes: the only place that rebuilds the whole index. */
    private async rescanNotes(): Promise<void> {
        new Notice('Rescanning notes and sessions…');
        await this.plugin.scanAll();
        new Notice('Rescan complete.');
    }

    /**
     * Render the start screen. Calls are coalesced: a burst of refresh
     * requests collapses into the render already in flight plus at most one
     * follow-up, so vault events cannot stack full re-renders.
     */
    private renderStart(skipSessionReload = false): Promise<void> {
        this.renderPending = true;
        if (!skipSessionReload) this.renderPendingReload = true;
        if (!this.renderPromise) {
            const run = this.drainRenders();
            this.renderPromise = run;
            const clear = (): void => {
                this.renderPromise = null;
                if (this.renderPending) void this.renderStart();
            };
            void run.then(clear, clear);
            return run;
        }
        return this.renderPromise;
    }

    private async drainRenders(): Promise<void> {
        while (this.renderPending) {
            const reload = this.renderPendingReload;
            this.renderPending = false;
            this.renderPendingReload = false;
            await this.doRenderStart(!reload);
        }
    }

    private async doRenderStart(skipSessionReload: boolean): Promise<void> {
        if (this.disposed) return;
        await this.endSession();
        const scrollTop = this.contentEl.scrollTop;
        this.destroyScreens();
        this.inSession = false;
        this.viewLog = null;
        this.viewFile = null;
        this.viewItems = [];

        if (!skipSessionReload) {
            try {
                this.sessions = await this.plugin.listSessions();
            } catch {
                this.sessions = [];
            }
        }
        if (this.disposed) return;

        const props = this.buildStartScreenProps();
        renderStartScreen(props);
        
        // Restore scroll position to prevent jumping when clicking presets
        window.requestAnimationFrame(() => {
            this.contentEl.scrollTop = scrollTop;
        });
    }

    private continueRecentSession(): void {
        const pending = this.sessions
            .filter((s) => s.log.status === 'pending')
            .sort((a, b) => b.log.created.localeCompare(a.log.created));
        if (pending.length === 0) {
            new Notice('No pending session to continue.');
            return;
        }
        void this.resumePending(pending[0]!);
    }

    private openSessionPresetsSettings(): void {
        new SessionPresetsModal(this.app, this.plugin).open();
    }

    private openFullHistory(): void {
        new SessionHistoryModal(this.app, {
            sessions: this.sessions,
            reviewDir: this.plugin.settings.reviewDir,
            onAction: (summary, action) =>
                this.performHistoryAction(summary, action),
        }).open();
    }

    /**
     * Shared by the full-history modal and the standalone session-detail
     * modal. The result drives the history modal: `null` closes it (the action
     * navigates away), an array refreshes it in place. `hooks.onLayerConfirm`
     * lets the session-detail modal close only when a second-layer modal
     * confirms instead of on the first click.
     */
    private async performHistoryAction(
        summary: SessionSummary,
        action: SessionDetailAction,
        hooks?: SessionActionHooks,
    ): Promise<SessionSummary[] | null> {
        const shared = this.plugin.getSessionHub().get(summary.file.path);
        const attachedElsewhere =
            shared !== null && shared.hasOtherViewers(this.viewID);
        // Only a session that is still pending is actively writing. A
        // completed session can stay attached to the quiz screen while its
        // completion panel is open, so its actions must remain available.
        const running =
            shared !== null && shared.runtime.log.status === 'pending';
        if (
            action !== 'resume' &&
            running &&
            // The one exception: archiving a session that another tab is
            // running asks for confirmation instead of being refused.
            !(action === 'archive' && attachedElsewhere)
        ) {
            new Notice(
                attachedElsewhere
                    ? 'This session is open in another tab. Close it there before changing it here.'
                    : 'This session is running in this tab. Close it before changing it here.',
            );
            return null;
        }
        switch (action) {
            case 'view':
                await this.enterViewMode(summary);
                return null;
            case 'resume':
                await this.resumePending(summary);
                return null;
            case 'restart':
                return this.confirmRestart(summary, hooks);
            case 'reproduce':
                return this.reproduceCompleted(summary, hooks);
            case 'rename':
                return this.renameFromHistory(summary, hooks);
            case 'archive':
                return attachedElsewhere
                    ? this.confirmArchiveRunning(summary)
                    : this.applyArchive(summary);
            case 'unarchive':
                try {
                    await unarchiveSession(this.app.vault, summary.file);
                    await this.plugin.refreshSessionEntry(summary.file);
                    await this.renderStart();
                } catch (e) {
                    new Notice(`Unarchive failed: ${(e as Error).message}`);
                }
                return this.sessions;
            case 'delete':
                return this.deleteFromHistory(summary, hooks);
        }
    }

    /**
     * Archive a session that is running in another tab: confirm first, then
     * archive. Cancelling resolves with the unchanged sessions so the caller's
     * view (history or session detail) simply stays open.
     */
    private confirmArchiveRunning(summary: SessionSummary): Promise<SessionSummary[]> {
        return new Promise((resolve) => {
            let settled = false;
            new ConfirmModal(this.app, {
                title: 'Archive running session?',
                message: `"${summary.log.session_name}" is currently running in another tab. Archive it anyway? That tab will be notified and returned to the start screen.`,
                confirmLabel: 'Archive',
                destructive: true,
                onConfirm: async () => {
                    if (settled) return;
                    settled = true;
                    try {
                        resolve(await this.applyArchive(summary));
                    } catch (e) {
                        new Notice(`Archive failed: ${(e as Error).message}`);
                        resolve(this.sessions);
                    }
                },
                onCancel: () => {
                    if (settled) return;
                    settled = true;
                    resolve(this.sessions);
                },
            }).open();
        });
    }

    /**
     * Write the archive and refresh the index. If some view still holds the
     * session, its runtime is frozen to the status the note is about to get
     * *before* the write: `SessionRuntime.flush()` serialises the whole log,
     * so a running tab would otherwise rewrite `status: pending` over the
     * archive on its next answer.
     */
    private async applyArchive(summary: SessionSummary): Promise<SessionSummary[]> {
        const shared = this.plugin.getSessionHub().get(summary.file.path);
        // A completed session is no longer writing, so its attached runtime
        // must keep its completed state; only a pending run is frozen here.
        const running =
            shared !== null && shared.runtime.log.status === 'pending';
        if (shared && running) {
            // archiveSession() maps pending → abandoned and records the old
            // status; mirror that in memory so writes stop immediately.
            shared.runtime.log.status = 'abandoned';
            shared.runtime.log.archived_from = 'pending';
        }
        try {
            await archiveSession(this.app.vault, summary.file);
            await this.plugin.refreshSessionEntry(summary.file);
            await this.renderStart();
        } catch (e) {
            if (shared && running) {
                shared.runtime.log.status = 'pending';
                shared.runtime.log.archived_from = null;
            }
            new Notice(`Archive failed: ${(e as Error).message}`);
            return this.sessions;
        }
        shared?.notifyArchived(this.viewID, summary.log.session_name);
        return this.sessions;
    }

    /** True when this view is showing the given session file. */
    private keepsSessionScreen(file: TFile): boolean {
        return (
            this.viewFile?.path === file.path ||
            this.session?.file.path === file.path ||
            this.session?.savedFile?.path === file.path
        );
    }

    private renameFromHistory(
        summary: SessionSummary,
        hooks?: SessionActionHooks,
    ): Promise<SessionSummary[]> {
        return new Promise((resolve) => {
            // Renaming from the quiz's completion panel or the read-only
            // session view must not tear that screen down. The file path does
            // not change on rename, so the current screen keeps its runtime.
            const keepsCurrentView = this.keepsSessionScreen(summary.file);
            let renamed = false;
            let settled = false;
            const finish = async (): Promise<void> => {
                if (settled) return;
                settled = true;
                if (keepsCurrentView) {
                    if (renamed) {
                        try {
                            this.sessions = await this.plugin.listSessions();
                        } catch {
                            // Keep the open screen even if the cache refresh fails.
                        }
                        if (!this.disposed && this.viewFile?.path === summary.file.path) {
                            this.renderSessionView();
                        }
                    }
                } else {
                    await this.renderStart();
                }
                resolve(this.sessions);
            };
            openRenameSessionPrompt(this.app, {
                initialName: summary.log.session_name,
                onSave: async (name) => {
                    let ok = true;
                    try {
                        await renameSession(this.app.vault, summary.file, name);
                        await this.plugin.refreshSessionEntry(summary.file);
                    } catch (e) {
                        ok = false;
                        new Notice(`Rename failed: ${(e as Error).message}`);
                    }
                    if (ok) {
                        summary.log.session_name = name;
                        renamed = true;
                        // A confirmed rename closes only the session-detail
                        // layer; the screen underneath stays.
                        hooks?.onLayerConfirm?.();
                    }
                    await finish();
                },
                onCancel: () => void finish(),
            });
        });
    }

    private deleteFromHistory(
        summary: SessionSummary,
        hooks?: SessionActionHooks,
    ): Promise<SessionSummary[]> {
        return new Promise((resolve) => {
            // Cancelling or failing a delete leaves the completion panel or
            // read-only session view underneath intact. Only a successful
            // delete returns to the start screen.
            const keepsCurrentView = this.keepsSessionScreen(summary.file);
            let settled = false;
            const finish = async (deleted: boolean): Promise<void> => {
                if (settled) return;
                settled = true;
                if (deleted || !keepsCurrentView) await this.renderStart();
                resolve(this.sessions);
            };
            new ConfirmModal(this.app, {
                title: 'Delete session?',
                message: `Delete session ${summary.log.session_id}? This cannot be undone.`,
                confirmLabel: 'Delete',
                destructive: true,
                onConfirm: async () => {
                    let ok = true;
                    try {
                        await deleteSession(this.app, summary.file);
                    } catch (e) {
                        ok = false;
                        new Notice(`Delete failed: ${(e as Error).message}`);
                    }
                    // Confirming closes both the delete modal and the
                    // session-detail view; cancelling closes only the delete
                    // modal, so `finish` keeps the detail view open.
                    if (ok) hooks?.onLayerConfirm?.();
                    await finish(ok);
                },
                onCancel: () => void finish(false),
            }).open();
        });
    }

    private resolveCurrentManageSelection(questions: Question[]): ManageSelection & { presetId: string } {
        const settings = this.plugin;
        const presets = settings.getManagePresets();
        const lastCustom = settings.getLastCustomSelection();
        let id = this.sessionConfig.managePresetId;
        if (id !== 'all' && id !== 'last-custom' && !presets.some((p) => p.id === id)) {
            id = 'all';
        }
        const selection = resolveManageSelection(questions, id, presets, lastCustom);
        return { ...selection, presetId: id };
    }

    private selectSessionPreset(id: string | null): void {
        if (id === '__default') {
            this.sessionConfig = { ...DEFAULT_SESSION_CONFIG };
            this.mode = 'choice';
            this.activeSessionPresetId = '__default';
            this.refreshStartConfigArea();
            return;
        }
        if (id === null) {
            this.activeSessionPresetId = null;
            this.refreshStartConfigArea();
            return;
        }
        const preset = this.plugin.getSessionPresets().find((p) => p.id === id);
        if (!preset) return;
        this.sessionConfig = this.sanitizePresetConfig({
            ...DEFAULT_SESSION_CONFIG,
            ...preset.config,
        });
        if (preset.mode === 'typed' && this.sessionConfig.submitMode === 'auto') {
            this.sessionConfig.submitMode = 'any';
        }
        this.mode = preset.mode;
        this.activeSessionPresetId = preset.id;
        this.refreshStartConfigArea();
    }

    private sanitizePresetConfig(config: SessionConfig): SessionConfig {
        return sanitizeSessionConfig(config);
    }



private openSaveSessionPreset(): void {
    const names = new Set(
        this.plugin.getSessionPresets().map((p) => p.name.toLowerCase()),
    );
    let n = 1;
    while (names.has(`session preset ${n}`.toLowerCase())) n++;
    openSavePresetPrompt(this.app, {
        initialName: `Session preset ${n}`,
        title: 'Save session preset',
        confirmLabel: 'Save',
        onSave: async (name) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            if (
                this.plugin.getSessionPresets().some(
                    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
                )
            ) {
                new Notice('A session preset with that name already exists.');
                return;
            }
            const preset: SessionPreset = {
                id: this.plugin.generatePresetId(),
                name: trimmed,
                mode: this.mode,
                config: this.sanitizePresetConfig({ ...this.sessionConfig }),
                showOnStart: true,
            };
            if (preset.mode === 'typed' && preset.config.submitMode === 'auto') {
                preset.config.submitMode = 'any';
            }
            await this.plugin.saveSessionPresets([
                ...this.plugin.getSessionPresets(),
                preset,
            ]);
            this.activeSessionPresetId = preset.id;
            this.plugin.refreshIdleViews();
        },
    });
}

private openUpdateSessionPreset(): void {
    const presets = this.plugin.getSessionPresets();
    if (presets.length === 0) {
        new Notice('No session presets to update. Save one first.');
        return;
    }
    openUpdatePresetPrompt(this.app, {
        title: 'Update session preset',
        presets: presets.map((p) => ({ id: p.id, name: p.name })),
        onSave: async (presetId) => {
            const preset = presets.find((p) => p.id === presetId);
            if (!preset) return;
            const nextConfig = this.sanitizePresetConfig({ ...this.sessionConfig });
            if (this.mode === 'typed' && nextConfig.submitMode === 'auto') {
                nextConfig.submitMode = 'any';
            }
            const next = presets.map((p) =>
                p.id === presetId
                    ? { ...p, mode: this.mode, config: nextConfig }
                    : p,
            );
            await this.plugin.saveSessionPresets(next);
            this.activeSessionPresetId = presetId;
            this.plugin.refreshIdleViews();
            new Notice(`Updated preset "${preset.name}".`);
        },
    });
}

    private openManageQuestions(): void {
        const questions = this.plugin.getQuestions();
        const matched = questions.filter((q) =>
            isQuestionMatched(q, this.plugin.settings.reviewDir),
        );
        const manage = this.resolveCurrentManageSelection(matched);
        new ManageQuestionsModal(this.app, {
            questions,
            folders: this.plugin.getReviewFolders(),
            reviewDir: this.plugin.settings.reviewDir,
            sessionsSubdir: this.plugin.settings.sessionsSubdir,
            presets: this.plugin.getManagePresets(),
            lastCustomSelection: this.plugin.getLastCustomSelection(),
            activePresetId: manage.presetId,
            includedPaths: manage.includedPaths,
            onApply: async ({ includedPaths, presetId, saveLastCustom }) => {
                if (saveLastCustom) {
                    await this.plugin.saveLastCustomSelection(includedPaths);
                }
                this.activeSessionPresetId = null;
                this.sessionConfig.managePresetId = presetId;
                await this.renderStart();
            },
            onSavePreset: async (name, includedPaths) => {
                const preset: ManageQuestionPreset = {
                    id: this.plugin.generatePresetId(),
                    name,
                    includedPaths,
                    showOnStart: true,
                };
                await this.plugin.saveManagePresets([...this.plugin.getManagePresets(), preset]);
                // Refresh the start screen incrementally (preset chips/settings
                // only). A full renderStart() here wiped and rebuilt the whole
                // start screen while this modal was still open, producing a
                // visible jump to the top before the scroll position was
                // restored on the next frame.
                this.plugin.refreshIdleViews();
                return preset;
            },
            onUpdatePreset: async (presetId, includedPaths) => {
                const next = this.plugin.getManagePresets().map((p) =>
                    p.id === presetId ? { ...p, includedPaths } : p,
                );
                await this.plugin.saveManagePresets(next);
                this.plugin.refreshIdleViews();
            },
            onMoveFile: async (path, category) => {
                const result = await this.plugin.moveQuestionFile(path, category);
                if (!result.frontmatterUpdated) {
                    new Notice(`Moved ${path} but could not update rv-category.`);
                }
                return {
                    newPath: result.newPath,
                    presetsUpdated: result.presetsUpdated,
                };
            },
            onAddFolder: async (parent, name) => {
                const folder = await this.plugin.addCategoryFolder(parent, name);
                return { folder };
            },
            onDeleteFolder: async (category) => this.plugin.deleteCategoryFolder(category),
            onOpenQuestionPresets: () => new QuestionPresetsModal(this.app, this.plugin).open(),
        }).open();
    }

    private async startSession(): Promise<void> {
        const matched = this.plugin
            .getQuestions()
            .filter((q) => isQuestionMatched(q, this.plugin.settings.reviewDir));
        const manage = this.resolveCurrentManageSelection(matched);
        this.sessionConfig.managePresetId = manage.presetId;
        if (manage.questions.length === 0) {
            new Notice(
                'No matched questions are selected. Open Manage questions or fix category sync first.',
            );
            return;
        }
        const pending = await this.plugin.getSessionIndex().pending();
        if (pending.length === 0) {
            await this.launch(manage.questions, manage);
            return;
        }
        const hub = this.plugin.getSessionHub();
        const free = pending.filter((p) => !hub.isAttached(p.file));
        const attachedCount = pending.length - free.length;
        const first = pending[0]!.preview;
        const label = first.session_name
            ? `${first.session_id} (${first.session_name})`
            : first.session_id;
        const warning =
            attachedCount > 0
                ? `${attachedCount} of these ${attachedCount === 1 ? 'is' : 'are'} open in another tab and will be left untouched.`
                : undefined;
        new ConfirmModal(this.app, {
            title: pending.length === 1 ? 'Pending session exists' : 'Pending sessions exist',
            message:
                `You have ${pending.length} pending session${pending.length === 1 ? '' : 's'} (${label}, created ${first.created}). ` +
                'Start a new session and keep the pending one unarchived, or archive it first.',
            warning,
            confirmLabel: 'Archive and start new',
            alternateLabel: 'Start new',
            destructive: true,
            onConfirm: async () => {
                for (const p of free) {
                    try {
                        await archiveSession(this.app.vault, p.file);
                    } catch (e) {
                        new Notice(`Could not archive ${p.preview.session_id}: ${(e as Error).message}`);
                    }
                }
                await this.launch(manage.questions, manage);
            },
            onAlternate: () => this.launch(manage.questions, manage),
        }).open();
    }



    private async launch(source: Question[], manageSelection?: ManageSelection): Promise<void> {
        await this.endSession();
        this.destroyScreens();

        const effectiveConfig = this.sanitizePresetConfig({ ...this.sessionConfig });
        const plan = planSession(
            source,
            effectiveConfig,
            this.plugin.settings.reviewDir,
        );
        if (plan.errors.length) {
            new Notice(`Skipped ${plan.errors.length} question(s): ${plan.errors.join('; ')}`, 8000);
        }
        if (plan.planned.length === 0) return;

        this.saveConfig = { ...effectiveConfig, seed: plan.effectiveSeedInput };
        this.navigatorShown = this.saveConfig.navigator;

        let opened;
        try {
            opened = await openFreshSession({
                vault: this.app.vault,
                hub: this.plugin.getSessionHub(),
                reviewDir: this.plugin.settings.reviewDir,
                sessionsSubdir: this.plugin.settings.sessionsSubdir,
                plan,
                config: this.saveConfig,
                mode: this.mode,
                sessionName: this.pendingSessionName,
                manageSelection: manageSelection
                    ? {
                          name: manageSelection.name,
                          includedPaths: manageSelection.includedPaths,
                      }
                    : undefined,
            });
        } catch (e) {
            new Notice(`Could not write pending session file: ${(e as Error).message}`);
            this.inSession = false;
            return;
        }

        this.pendingSessionName = '';
        this.attachShared(opened.shared);
    }

    private async flushSession(): Promise<void> {
        await this.shared?.flush();
    }

    private setSessionFlags(flags: number[]): void {
        this.shared?.setFlags(flags, this.viewID);
    }

    private backToStart(): void {
        const answered = this.items.filter((i) => i.isCorrect !== undefined).length;
        const leave = (): void => {
            void this.endSession().then(() => this.renderStart());
        };
        if (answered === 0 || this.saved) {
            leave();
            return;
        }
        showLeaveModal({
            parent: this.contentEl,
            answered,
            onLeave: leave,
        });
    }

    private saveOnce(_items: SessionQuestion[], mode: Mode): Promise<TFile> {
        const shared = this.shared;
        if (!shared) {
            return Promise.reject(new Error('no pending session to save'));
        }
        return shared.save(mode);
    }

private openRenameModal(): void {
    const runtime = this.session;
    if (!runtime) return;
    openRenameSessionPrompt(this.app, {
        initialName: runtime.log.session_name,
        onSave: (name) => {
            void runtime.rename(name).catch((e) => {
                new Notice(`Rename failed: ${(e as Error).message}`);
            });
        },
    });
}

    private renderQuiz(preserveScroll = false): void {
        const runtime = this.session;
        const shared = this.shared;
        if (!runtime || !shared) return;
        
        const scrollTop = preserveScroll ? this.contentEl.scrollTop : 0;
        
        // Capture the navigator's internal scroll position
        const navGrid = this.contentEl.querySelector<HTMLElement>('.rv-nav-grid');
        const navScrollTop = preserveScroll && navGrid ? navGrid.scrollTop : 0;
        
        this.screen?.destroy();
        this.viewHandle?.destroy();
        this.viewHandle = null;
        this.viewLog = null;
        this.viewFile = null;
        this.viewItems = [];
        releaseLazyMarkdown(this.contentEl);

        const displayMode: DisplayMode = this.saveConfig.presentation;
        const planned = [...shared.plannedEntries];
        const generation = shared.generationState;
        const plannedIds = planned.map((entry) => entry.id);
        const timerState =
            runtime.timer ??
            createTimerRuntimeForIds(
                this.saveConfig,
                plannedIds.length > 0 ? plannedIds : runtime.items.map((item) => item.id),
                this.saveConfig.presentation,
            );
        runtime.timer = timerState;
        const seedShown =
            this.saveConfig.order !== 'source' || this.saveConfig.trim === 'rand'
                ? this.saveConfig.seed
                : undefined;
        this.screen = renderQuizScreen({
            app: this.app,
            component: this,
            root: this.contentEl,
            items: this.items,
            planned,
            expectedTotal: Math.max(0, planned.length - generation.failed),
            generation,
            mode: this.mode,
            displayMode,
            currentIndex: this.currentIndex,
            savedFile: this.savedFile,
            seedInput: seedShown,
            submitMode: this.saveConfig.submitMode,
            gradeMode: this.saveConfig.gradeMode,
            passScore: this.saveConfig.passScore,
            timerConfig: this.saveConfig,
            timerState,
            allowFlag: this.saveConfig.allowFlag,
            navigator: this.saveConfig.navigator,
            navigatorShown: this.navigatorShown,
            onNavigatorToggle: (shown) => { this.navigatorShown = shown; },
            initialFlags: this.sessionLog?.flags ?? [],
            onFlagsChange: (flags) => this.setSessionFlags(flags),
            onJump: (index) => {
                if (index < 0 || index >= planned.length || index === this.currentIndex) return;
                void this.flushSession();
                shared.setIndex(index, this.viewID);
                this.renderQuiz(true);
            },
            onFlush: () => void this.flushSession(),
            onRename: () => this.openRenameModal(),
            onBack: () => this.backToStart(),
            onPrev: () => {
                if (this.currentIndex <= 0) return;
                void this.flushSession();
                shared.setIndex(this.currentIndex - 1, this.viewID);
                this.renderQuiz(true);
            },
            onNext: () => {
                if (this.currentIndex >= planned.length - 1) return;
                void this.flushSession();
                shared.setIndex(this.currentIndex + 1, this.viewID);
                this.renderQuiz(true);
            },
            onPick: (id, picked) => shared.pick(id, picked, this.viewID),
            onDraft: (id, value) => shared.setDraft(id, value, this.viewID),
            onScratch: (id, value) => shared.setScratch(id, value, this.viewID),
            onSubmit: (id) => shared.submit(id, this.viewID),
            onSubmitAll: () => shared.submitAll('hub'),
            saveSession: (items, mode) => this.saveOnce(items, mode),
            onShowDetails: () => this.openCurrentSessionDetails(),
            onNewSession: () => void this.renderStart(),
        });
        this.updateStreamingVisibility();

        if (preserveScroll) {
            window.requestAnimationFrame(() => {
                this.contentEl.scrollTop = scrollTop;
                // Restore the navigator's internal scroll position
                const newGrid = this.contentEl.querySelector<HTMLElement>('.rv-nav-grid');
                if (newGrid && navScrollTop > 0) {
                    newGrid.scrollTop = navScrollTop;
                }
            });
        }
    }

    // ========================================================================
    // Session detail actions
    // ========================================================================

    private openSessionDetail(
        summary: SessionSummary,
        options?: { hideView?: boolean },
    ): void {
        const modal = new Modal(this.app);
        modal.modalEl.addClass('rv-modal-session-detail');
        // Kept live so an in-place action (archive / unarchive) can re-render
        // this panel against the refreshed summary without reopening the modal.
        let current = summary;
        let open = false;

        const render = (): void => {
            const { contentEl } = modal;
            contentEl.empty();
            contentEl.createEl('h2', { text: sessionDetailTitle(current) });
            renderSessionDetailPanel(contentEl, {
                summary: current,
                showClose: true,
                hideView: options?.hideView,
                onOpenNote: () => {
                    const path = current.file.path;
                    modal.close();
                    this.openNoteInNewTab(path);
                },
                onClose: () => modal.close(),
                onAction: (action) => {
                    // View is navigation: it replaces the screen underneath
                    // this modal, so the modal goes away with the click.
                    if (action === 'view') {
                        modal.close();
                        return this.handleSessionAction(current, action).then(
                            () => undefined,
                        );
                    }
                    // Continue has no second layer, but it must not close the
                    // modal on the click either: the modal stays up while the
                    // resume runs and closes only once the session is
                    // attached underneath. A failed resume leaves it open.
                    if (action === 'resume') {
                        return this.handleSessionAction(current, action).then(
                            () => {
                                if (open && this.session) modal.close();
                            },
                        );
                    }
                    // Archive / unarchive apply in place: refresh this panel
                    // and stay open, the button flips to its counterpart.
                    if (action === 'archive' || action === 'unarchive') {
                        return this.handleSessionAction(current, action).then(
                            (updated) => {
                                const fresh = updated?.find(
                                    (s) =>
                                        s.log.session_id === current.log.session_id,
                                );
                                if (fresh) current = fresh;
                                if (open) render();
                            },
                        );
                    }
                    // Reproduce, restart, rename and delete open a second
                    // layer. This modal stays open until that layer confirms,
                    // then closes together with it; cancelling the layer only
                    // closes the layer.
                    return this.handleSessionAction(current, action, {
                        onLayerConfirm: () => {
                            if (open) modal.close();
                        },
                    }).then(() => undefined);
                },
            });
        };

        modal.onOpen = () => {
            open = true;
            const { contentEl } = modal;
            contentEl.empty();
            contentEl.addClass('rv-session-detail-modal');
            render();
        };
        modal.onClose = () => {
            open = false;
            modal.contentEl.empty();
        };
        modal.open();
    }

    private handleSessionAction(
        summary: SessionSummary,
        action: SessionDetailAction,
        hooks?: SessionActionHooks,
    ): Promise<SessionSummary[] | null> {
        return this.performHistoryAction(summary, action, hooks);
    }

    /** Open the details modal for the session currently in the quiz view. */
    private openCurrentSessionDetails(): void {
        const runtime = this.session;
        if (!runtime || !runtime.saved) return;
        this.openSessionDetail({
            file: runtime.savedFile ?? runtime.file,
            log: runtime.log,
        });
    }

    // ========================================================================
    // View mode
    // ========================================================================

    private async enterViewMode(summary: SessionSummary): Promise<void> {
        await this.endSession();
        this.destroyScreens();

        const { items, errors, missingPaths } = buildSessionFromFrozen(this.plugin.getQuestions(), {
            frozenPool: summary.log.frozen_pool,
            initialOrder: summary.log.initial_order,
            sessionSeed: summary.log.session_seed,
            choiceCount: summary.log.qs_snapshot.choices,
        }, { includeMissing: true });

        if (errors.length) new Notice(`Errors in frozen pool: ${errors.join('; ')}`, 8000);
        if (missingPaths.length) {
            new Notice(
                `${missingPaths.length} question${missingPaths.length === 1 ? '' : 's'} missing from the vault — skipped.`,
                6000,
            );
        }
        if (!items.length) {
            new Notice('No questions could be loaded from this session.');
            return;
        }

        hydrateSessionItems(items, summary.log);

        this.viewLog = summary.log;
        this.viewFile = summary.file;
        this.viewItems = items;
        this.viewDisplayMode = summary.log.qs_snapshot.presentation;
        this.viewCurrentIndex = 0;
        this.inSession = false;

        this.renderSessionView();
    }

    private renderSessionView(): void {
        this.viewHandle?.destroy();
        this.viewHandle = null;
        if (!this.viewLog) return;

        this.viewHandle = renderSessionViewScreen({
            app: this.app,
            component: this,
            root: this.contentEl,
            log: this.viewLog,
            items: this.viewItems,
            flags: this.viewLog.flags,
            allowFlag: this.viewLog.qs_snapshot.allowFlag,
            displayMode: this.viewDisplayMode,
            currentIndex: this.viewCurrentIndex,
            onDisplayModeChange: (m) => {
                this.viewDisplayMode = m;
                this.viewCurrentIndex = Math.min(this.viewCurrentIndex, this.viewItems.length - 1);
                this.renderSessionView();
            },
            onShowDetails: () => {
                if (this.viewLog && this.viewFile) {
                    this.openSessionDetail(
                        { file: this.viewFile, log: this.viewLog },
                        { hideView: true },
                    );
                }
            },
            onPrev: () => {
                if (this.viewCurrentIndex > 0) {
                    this.viewCurrentIndex -= 1;
                    this.renderSessionView();
                }
            },
            onNext: () => {
                if (this.viewCurrentIndex < this.viewItems.length - 1) {
                    this.viewCurrentIndex += 1;
                    this.renderSessionView();
                }
            },
            onBack: () => void this.renderStart(),
        });
    }

    // ========================================================================
    // Pending resume + reproduce (unchanged from Phase 3b-ii)
    // ========================================================================

    private async resumePending(summary: SessionSummary): Promise<void> {
        await this.endSession();
        this.destroyScreens();

        const existing = this.plugin.getSessionHub().get(summary.file);
        if (existing) {
            this.attachShared(existing);
            return;
        }

        const { log, file } = summary;
        const plan = planFrozenSession(this.plugin.getQuestions(), {
            frozenPool: log.frozen_pool,
            initialOrder: log.initial_order,
            sessionSeed: log.session_seed,
            choiceCount: log.qs_snapshot.choices,
        });

        if (plan.missingPaths.length) {
            new Notice(
                `${plan.missingPaths.length} question${plan.missingPaths.length === 1 ? '' : 's'} missing from the vault — skipped.`,
                6000,
            );
        }
        if (plan.planned.length === 0) {
            new Notice('No questions could be loaded from the frozen pool.');
            return;
        }

        this.saveConfig = configFromSnapshot(log.qs_snapshot);
        this.navigatorShown = this.saveConfig.navigator;
        const timer =
            log.timer_state ??
            createTimerRuntimeForIds(
                this.saveConfig,
                plan.initialOrder,
                this.saveConfig.presentation,
            );
        timer.running = false;
        this.mode = log.mode;
        const runtime = new SessionRuntime(
            this.app.vault,
            log,
            file,
            [],
            timer,
            this.saveConfig,
            this.mode,
        );
        const shared = this.plugin.getSessionHub().register(file, runtime);
        shared.startGeneration(
            generationEntries(plan, this.saveConfig.choiceCount, (sq) => {
                hydrateSessionItems([sq], log, { timers: true });
            }),
        );
        this.attachShared(shared);
    }

    /**
     * Pending-session restart: clear submitted answers and scratch, keep the
     * session identity, questions, seed, and mode, then reopen at question 1.
     * Resolves with `null` (close the history modal) once the restart is
     * confirmed and entered, or with the refreshed sessions on cancel/failure,
     * so the caller stays open until the confirm layer settles.
     */
    private confirmRestart(
        summary: SessionSummary,
        hooks?: SessionActionHooks,
    ): Promise<SessionSummary[] | null> {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (result: SessionSummary[] | null): void => {
                if (settled) return;
                settled = true;
                resolve(result);
            };
            new ConfirmModal(this.app, {
                title: 'Restart session?',
                message:
                    'All submitted answers, scratch notes, and flags will be cleared. The same questions, seed, and navigator settings will be reused.',
                confirmLabel: 'Restart',
                destructive: true,
                onConfirm: async () => {
                    const entered = await this.restartPending(summary);
                    if (!entered) {
                        finish(this.sessions);
                        return;
                    }
                    // The restart navigates into the session: close the
                    // session-detail view along with this confirm layer.
                    hooks?.onLayerConfirm?.();
                    finish(null);
                },
                onCancel: () => finish(this.sessions),
            }).open();
        });
    }

    private async restartPending(summary: SessionSummary): Promise<boolean> {
        await this.endSession();
        this.destroyScreens();

        const { log, file } = summary;
        const plan = planFrozenSession(this.plugin.getQuestions(), {
            frozenPool: log.frozen_pool,
            initialOrder: log.initial_order,
            sessionSeed: log.session_seed,
            choiceCount: log.qs_snapshot.choices,
        });

        if (plan.missingPaths.length) {
            new Notice(
                `${plan.missingPaths.length} question${plan.missingPaths.length === 1 ? '' : 's'} missing from the vault — skipped.`,
                6000,
            );
        }
        if (plan.planned.length === 0) {
            new Notice('No questions could be loaded from the frozen pool.');
            return false;
        }

        // Keep the same session, questions, and seed; clear only submitted state.
        const restartedLog: SessionLogState = {
            ...log,
            status: 'pending',
            completed_at: null,
            answers: {},
            flags: [],
            scratch: {},
        };
        const restartedConfig = configFromSnapshot(restartedLog.qs_snapshot);
        const restartedRuntime = createTimerRuntimeForIds(
            restartedConfig,
            plan.initialOrder,
            restartedConfig.presentation,
        );
        restartedRuntime.running = false;
        restartedLog.timer_state = restartedRuntime;

        const runtime = new SessionRuntime(
            this.app.vault,
            restartedLog,
            file,
            [],
            restartedRuntime,
            restartedConfig,
            restartedLog.mode,
        );
        try {
            await runtime.writeNow();
        } catch (e) {
            new Notice(`Could not restart the session: ${(e as Error).message}`);
            return false;
        }

        this.saveConfig = restartedConfig;
        this.navigatorShown = restartedConfig.navigator;
        this.mode = restartedLog.mode;
        const shared = this.plugin.getSessionHub().register(file, runtime);
        shared.startGeneration(
            generationEntries(plan, restartedConfig.choiceCount),
        );
        this.attachShared(shared);
        return true;
    }

    /**
     * Opens the reproduce config layer. The caller's view stays open until the
     * layer settles: confirming navigates into the new session (`null` closes
     * the history modal), cancelling keeps it open with the refreshed sessions.
     */
    private reproduceCompleted(
        summary: SessionSummary,
        hooks?: SessionActionHooks,
    ): Promise<SessionSummary[] | null> {
        const { log: originalLog, file: originalFile } = summary;

        return new Promise((resolve) => {
            let settled = false;
            const finish = (result: SessionSummary[] | null): void => {
                if (settled) return;
                settled = true;
                resolve(result);
            };
            new ReproduceConfigModal(this.app, {
                originalLog,
                onConfirm: (newConfig, name) => {
                    // Confirming closes both the reproduce layer and the
                    // session-detail view; the new session takes over the view.
                    hooks?.onLayerConfirm?.();
                    finish(null);
                    void this.executeReproduce(originalLog, originalFile, newConfig, name);
                },
                onCancel: () => finish(this.sessions),
            }).open();
        });
    }

    private async executeReproduce(
        originalLog: SessionLogState,
        originalFile: TFile,
        newConfig: SessionConfig,
        name: string,
    ): Promise<void> {
        await this.endSession();
        this.destroyScreens();

        const seedChanged = newConfig.seed !== originalLog.qs_snapshot.seed;
        const orderChanged = newConfig.order !== originalLog.qs_snapshot.order;

        const reviewDir = this.plugin.settings.reviewDir;

        let newSessionSeed: number;
        if (!seedChanged) {
            newSessionSeed = originalLog.session_seed;
        } else {
            const frozenRelativePaths = originalLog.frozen_pool
                .map((p) => relativeToReview(p, reviewDir) ?? p)
                .sort();
            newSessionSeed = deriveSessionSeed(
                newConfig.seed,
                { ...newConfig, count: 'all', trim: 'seq' },
                frozenRelativePaths,
            );
        }

        const allQuestions = this.plugin.getQuestions();
        const byPath = new Map(allQuestions.map((q) => [q.path, q]));
        const availableFrozenIndices: number[] = [];
        const availableFrozenQuestions: Question[] = [];
        for (let i = 0; i < originalLog.frozen_pool.length; i++) {
            const q = byPath.get(originalLog.frozen_pool[i]!);
            if (q) {
                availableFrozenIndices.push(i);
                availableFrozenQuestions.push(q);
            }
        }
        if (!availableFrozenQuestions.length) {
            new Notice('None of the frozen pool questions are available in the vault.');
            return;
        }

        let newInitialOrder: number[];
        if (!seedChanged && !orderChanged) {
            newInitialOrder = originalLog.initial_order.filter((idx) =>
                availableFrozenIndices.includes(idx),
            );
        } else {
            const orderRng = mulberry32(deriveStreamSeed(newSessionSeed, 'order'));
            const ordered = orderPool(availableFrozenQuestions, newConfig.order, orderRng);
            const frozenIndex = new Map(
                originalLog.frozen_pool.map((path, index) => [path, index]),
            );
            newInitialOrder = ordered.map(
                (q) => frozenIndex.get(q.path) ?? -1,
            );
        }

        const items: SessionQuestion[] = [];
        const errors: string[] = [];
        for (const frozenIdx of newInitialOrder) {
            const path = originalLog.frozen_pool[frozenIdx]!;
            const q = byPath.get(path);
            if (!q) continue;
            try {
                const drawsRng = mulberry32(deriveStreamSeed(newSessionSeed, 'draws', path));
                const optionsRng = mulberry32(deriveStreamSeed(newSessionSeed, 'options', path));
                const variantRng = mulberry32(deriveStreamSeed(newSessionSeed, 'variant', path));
                items.push(
                    buildQuestion(
                        q,
                        drawsRng,
                        optionsRng,
                        variantRng,
                        frozenIdx,
                        newConfig.choiceCount,
                    ),
                );
            } catch (e) {
                errors.push(`${q.title}: ${(e as Error).message}`);
            }
        }
        if (errors.length) new Notice(`Skipped ${errors.length} question(s): ${errors.join('; ')}`, 8000);
        if (!items.length) {
            new Notice('No questions could be built for the reproduced session.');
            return;
        }

        const now = new Date().toISOString();
        const timerRuntime = createTimerRuntime(newConfig, items, newConfig.presentation);
        const newLog: SessionLogState = {
            schema_version: 1,
            session_id: generateSessionId(),
            session_name: name.trim(),
            status: 'pending',
            archived_from: null,
            created: now,
            completed_at: null,
            mode: originalLog.mode,
            source_session: originalLog.session_id,
            reproduced_into: [],
            session_seed: newSessionSeed,
            session_seed_default: originalLog.session_seed,
            rounds: 1,
            round_history: [{ index: 1, action: 'reproduce', started: now, ended: null }],
            qs_snapshot: snapshotFromConfig(newConfig, {
                name: originalLog.qs_snapshot.managePresetName,
                includedPaths: originalLog.qs_snapshot.manageIncludedPaths,
                categoryScope: originalLog.qs_snapshot.categoryScope,
            }),
            frozen_pool: [...originalLog.frozen_pool],
            initial_order: newInitialOrder,
            answers: {},
            flags: [],
            scratch: {},
            timer_state: timerRuntime,
        };

        let newFile: TFile;
        try {
            newFile = await writeSessionFile(
                this.app.vault,
                newLog,
                items,
                this.plugin.settings.reviewDir,
                this.plugin.settings.sessionsSubdir,
            );
        } catch (e) {
            new Notice(`Could not write new session file: ${(e as Error).message}`);
            return;
        }

        try {
            await appendReproducedInto(this.app.vault, originalFile, newLog.session_id);
        } catch (e) {
            new Notice(`Could not update original session link: ${(e as Error).message}`);
        }

        this.saveConfig = { ...newConfig };
        this.navigatorShown = newConfig.navigator;
        this.mode = originalLog.mode;
        const runtime = new SessionRuntime(
            this.app.vault,
            newLog,
            newFile,
            items,
            timerRuntime,
            this.saveConfig,
            this.mode,
        );
        const shared = this.plugin.getSessionHub().register(newFile, runtime);
        this.attachShared(shared);
    }
}