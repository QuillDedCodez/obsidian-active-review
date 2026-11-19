import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import {
    DEFAULT_REVIEW_DIR,
    DEFAULT_SESSION_CONFIG,
    DEFAULT_SESSIONS_SUBDIR,
    MESSAGE_PREFIX,
    RIBBON_TOOLTIP,
    VIEW_TYPE,
    clampChoiceCount,
    type SessionConfig,
} from './constants';
import type { Question, Warning } from './parser';
import { buildSession } from './session';
import { ReviewQuizSettingTab } from './settings/SettingsTab';
import { ReviewView } from './ui';
import { registerActiveReviewEmbed, disposeEmbedRegistry } from './embed';
import { ensureFolder, registerVaultEvents, SessionHub, SessionIndex, VaultScanner } from './vault';
import {
    INDEX_SCHEMA,
    VaultIndexStore,
    emptyIndexData,
    isSessionFilePath,
    type IndexedQuestion,
    type IndexedSession,
    type SessionIndexEntry,
    type SessionSummary,
    type VaultChange,
    type VaultIndexData,
} from './vault';
import type { ManageQuestionPreset } from './vault/managePresets';
import type { SessionPreset } from './vault/sessionPresets';
import {
    addCategoryFolder as addCategoryFolderVault,
    deleteCategoryFolder as deleteCategoryFolderFiles,
    moveFileToCategory,
    resolveCategoryCasing,
    scanReviewFolders,
    type FileMove,
} from './vault';
import { relativeToReview } from './util/paths';
import { OpenReviewTabModal } from './ui/Modals';
import {
    applyManageImport,
    type ApplyManageImportResult,
    type ImportApplyMode,
} from './vault/manageImportApply';
import type { ImportPreview, ManagePresetManifest } from './vault/manageImportExport';
import {
    undoManageImport,
    type ManageImportJournal,
    type UndoManageImportResult,
} from './vault/manageImportJournal';


interface ReviewQuizSettings {
    reviewDir: string;
    sessionsSubdir: string;
    forceShowWarnings: boolean;
    sessionDefaults: SessionConfig;
    managePresets: ManageQuestionPreset[];
    sessionPresets: SessionPreset[];
    manageImportJournal: ManageImportJournal | null;
    sessionImportJournal: { presetsBefore: SessionPreset[] } | null;
    lastCustomSelection: string[];
}

interface LoadedData {
    reviewDir?: string;
    sessionsSubdir?: string;
    forceShowWarnings?: boolean;
    sessionDefaults?: Partial<SessionConfig>;
    managePresets?: ManageQuestionPreset[];
    sessionPresets?: SessionPreset[];
    manageImportJournal?: ManageImportJournal | null;
    sessionImportJournal?: { presetsBefore: SessionPreset[] } | null;
    lastCustomSelection?: string[];
}

const DEFAULT_SETTINGS: ReviewQuizSettings = {
    reviewDir: DEFAULT_REVIEW_DIR,
    sessionsSubdir: DEFAULT_SESSIONS_SUBDIR,
    forceShowWarnings: false,
    sessionDefaults: { ...DEFAULT_SESSION_CONFIG },
    managePresets: [],
    sessionPresets: [],
    manageImportJournal: null,
    sessionImportJournal: null,
    lastCustomSelection: [],
};

const VALIDATION_CONFIG: SessionConfig = { ...DEFAULT_SESSION_CONFIG, seed: 1 };

interface ValidationVerdict {
    question: Question;
    error: string | null;
    warnings: Warning[];
    choiceCount: number;
}

export default class ReviewQuizPlugin extends Plugin {
    settings: ReviewQuizSettings = { ...DEFAULT_SETTINGS };
    private questions = new Map<string, Question>();
    private issues = new Map<string, string>();
    private warnings = new Map<string, Warning[]>();
    private reviewFolders: string[] = [''];
    private scanner: VaultScanner | null = null;
    private sessionIndex: SessionIndex | null = null;
    private sessionHub: SessionHub | null = null;
    private validationCache = new Map<string, ValidationVerdict>();
    private indexStore: VaultIndexStore | null = null;
    private indexData: VaultIndexData | null = null;
    private indexSaveTimer: number | null = null;
    /** True once the app's quit sequence has queued the final index save. */
    private quitSaveStarted = false;
    private ready: Promise<void> = Promise.resolve();
    private resolveReady: () => void = () => undefined;
    private readyResolved = false;
    /** Resolves as soon as settings are loaded, before the index is built. */
    settingsReady: Promise<void> = Promise.resolve();
    private resolveSettingsReady: () => void = () => undefined;
    private settingsReadyResolved = false;
    private scanning = false;
    private rescanQueued = false;
    private deferredChanges: VaultChange[] = [];
    private applyQueue: Promise<void> = Promise.resolve();

    /** Files whose stat changed since the last scan; refreshed inline up to this limit. */
    private static readonly STALE_INLINE_LIMIT = 25;

    /** Indexed questions hydrated per task before yielding to the event loop. */
    private static readonly HYDRATE_CHUNK = 250;

    getSessionIndex(): SessionIndex {
        if (!this.sessionIndex) {
            this.sessionIndex = new SessionIndex(this.app.vault, () => ({
                reviewDir: this.settings.reviewDir,
                sessionsSubdir: this.settings.sessionsSubdir,
            }));
        }
        return this.sessionIndex;
    }

    /** One shared quiz session per session file. */
    getSessionHub(): SessionHub {
        if (!this.sessionHub) this.sessionHub = new SessionHub();
        return this.sessionHub;
    }

    /**
     * Session list for the start screen. Reads the hydrated session index;
     * reconciling session notes is a full-scan concern (`scanAll`).
     */
    async listSessions(): Promise<SessionSummary[]> {
        return this.getSessionIndex().list();
    }

    /**
     * Re-read one session note into the in-memory index right after this
     * plugin mutates it (archive, unarchive, rename). Vault events are
     * debounced by 500 ms, so without this the next listSessions() returns the
     * pre-mutation log and a freshly rendered detail pane still shows the old
     * status or name — which reads as "the button did nothing".
     */
    async refreshSessionEntry(file: TFile): Promise<void> {
        const changed = await this.upsertSession(file, true);
        if (changed) this.scheduleIndexSave();
    }

    private getScanner(): VaultScanner {
        if (!this.scanner) {
            this.scanner = new VaultScanner(this.app.vault, () => ({
                reviewDir: this.settings.reviewDir,
                sessionsSubdir: this.settings.sessionsSubdir,
            }));
        }
        return this.scanner;
    }

    private getIndexStore(): VaultIndexStore {
        if (!this.indexStore) {
            const dir =
                this.manifest.dir ??
                `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
            this.indexStore = new VaultIndexStore(this.app, dir);
        }
        return this.indexStore;
    }

    /** Resolves after settings are loaded and the index (or a bootstrap scan) is ready. */
    whenReady(): Promise<void> {
        return this.ready;
    }

    onload(): void {
        this.ready = new Promise<void>((resolve) => {
            this.resolveReady = resolve;
        });
        this.settingsReady = new Promise<void>((resolve) => {
            this.resolveSettingsReady = resolve;
        });

        this.registerView(VIEW_TYPE, (leaf) => new ReviewView(leaf, this));
        registerActiveReviewEmbed(this);
        this.addRibbonIcon('list-checks', RIBBON_TOOLTIP, () => void this.activateView());
        this.addCommand({
            id: 'open',
            name: 'Open quiz',
            callback: () => void this.activateView(),
        });
        this.addSettingTab(new ReviewQuizSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(() => {
            void this.initialize();
        });

        // Persist the index during Obsidian's quit sequence. `onunload` cannot
        // await async work, so ask the app to wait for this save instead.
        this.registerEvent(
            this.app.workspace.on('quit', (tasks) => {
                this.clearIndexTimer();
                this.quitSaveStarted = true;
                if (this.indexData) {
                    tasks.addPromise(this.getIndexStore().save(this.indexData));
                }
            }),
        );

    }

    onunload(): void {
        this.clearIndexTimer();
        const hub = this.getSessionHub();
        void hub.flushAll();
        hub.disposeAll();
        disposeEmbedRegistry(this);
        // Quit is handled above so Obsidian can await it. This best-effort
        // write covers disable/reload, where async work cannot be awaited.
        if (this.indexData && !this.quitSaveStarted) {
            void this.getIndexStore().save(this.indexData);
        }
    }

    /**
     * Load settings and hydrate from the persistent index. A full scan only
     * happens when no usable index exists (first run, schema upgrade, scope
     * change, or a corrupt cache).
     */
    private async initialize(): Promise<void> {
        let settingsLoaded = false;
        try {
            const loaded = (await this.loadData()) as LoadedData | null;
            this.settings = {
                reviewDir: loaded?.reviewDir ?? DEFAULT_SETTINGS.reviewDir,
                sessionsSubdir: loaded?.sessionsSubdir ?? DEFAULT_SETTINGS.sessionsSubdir,
                forceShowWarnings: loaded?.forceShowWarnings ?? DEFAULT_SETTINGS.forceShowWarnings,
                sessionDefaults: {
                    ...DEFAULT_SESSION_CONFIG,
                    ...(loaded?.sessionDefaults ?? {}),
                    choiceCount: clampChoiceCount(loaded?.sessionDefaults?.choiceCount),
                },
                managePresets: (loaded?.managePresets ?? []).map((p) => ({
                    ...p,
                    showOnStart: p.showOnStart ?? true,
                })),
                sessionPresets: (loaded?.sessionPresets ?? []).map((p) => ({
                    ...p,
                    showOnStart: p.showOnStart ?? true,
                    config: {
                        ...DEFAULT_SESSION_CONFIG,
                        ...p.config,
                        choiceCount: clampChoiceCount(p.config?.choiceCount),
                    },
                })),
                manageImportJournal: loaded?.manageImportJournal ?? null,
                sessionImportJournal: loaded?.sessionImportJournal ?? null,
                lastCustomSelection: loaded?.lastCustomSelection ?? [],
            };
            settingsLoaded = true;
            this.settingsReadyResolved = true;
            this.resolveSettingsReady();

            const stored = await this.getIndexStore().load();
            if (stored) {
                await this.hydrateFromIndex(stored);
            } else {
                new Notice(`${MESSAGE_PREFIX} building the question index for the first time…`);
                await this.scanAll();
            }
        } catch (e) {
            console.error(`${MESSAGE_PREFIX} startup failed`, e);
        } finally {
            if (settingsLoaded) {
                const disposeEvents = registerVaultEvents(
                    this,
                    () => ({
                        reviewDir: this.settings.reviewDir,
                        sessionsSubdir: this.settings.sessionsSubdir,
                    }),
                    (changes) => void this.handleVaultChanges(changes),
                );
                this.register(disposeEvents);
            }
            if (!this.settingsReadyResolved) {
                this.settingsReadyResolved = true;
                this.resolveSettingsReady();
            }
            this.readyResolved = true;
            this.resolveReady();
        }
    }

    private _questionCache: Question[] | null = null;

    getQuestions(): Question[] {
        if (!this._questionCache) {
            this._questionCache = [...this.questions.values()];
        }
        return this._questionCache;
    }

    getQuestionMap(): Map<string, Question> {
        return this.questions;
    }

    getIssues(): [string, string][] {
        return [...this.issues.entries()];
    }

    getWarnings(): [string, Warning[]][] {
        return [...this.warnings.entries()];
    }

    async setReviewDir(value: string): Promise<void> {
        const cleaned = value.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
        if (!cleaned) {
            new Notice('Review folder cannot be empty.');
            return;
        }
        if (cleaned.includes('..')) {
            new Notice('Review folder cannot contain "..".');
            return;
        }
        const existing = this.app.vault.getAbstractFileByPath(cleaned);
        if (existing && !(existing instanceof TFolder)) {
            new Notice(`"${cleaned}" exists as a file, not a folder.`);
            return;
        }
        if (cleaned === this.settings.reviewDir) return;

        const previous = this.settings.reviewDir;
        this.settings.reviewDir = cleaned;
        await this.saveData(this.settings);

        if (!existing) {
            await ensureFolder(this.app.vault, cleaned);
            new Notice(
                `Review folder set to "${cleaned}" (folder created). Sessions will be written to "${cleaned}/${this.settings.sessionsSubdir}". Notes and session logs in "${previous}" were not moved.`,
            );
        } else {
            new Notice(
                `Review folder set to "${cleaned}". Sessions will be written to "${cleaned}/${this.settings.sessionsSubdir}". Notes and session logs in "${previous}" were not moved.`,
            );
        }
        await this.scanAll();
    }

    async setSessionsSubdir(value: string): Promise<void> {
        const cleaned = value.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
        if (!cleaned) {
            new Notice('Session folder cannot be empty.');
            return;
        }
        if (cleaned.split('/').some((seg) => seg === '..' || seg === '.')) {
            new Notice('Session folder cannot contain ".." or "." segments.');
            return;
        }
        if (cleaned === this.settings.sessionsSubdir) return;

        const fullPath = `${this.settings.reviewDir}/${cleaned}`;
        const existing = this.app.vault.getAbstractFileByPath(fullPath);
        if (existing && !(existing instanceof TFolder)) {
            new Notice(`"${fullPath}" exists as a file, not a folder.`);
            return;
        }

        const conflicting = [...this.questions.values()].filter((q) => q.path.startsWith(`${fullPath}/`));
        const previous = this.settings.sessionsSubdir;
        this.settings.sessionsSubdir = cleaned;
        await this.saveData(this.settings);

        if (!existing) await ensureFolder(this.app.vault, fullPath);

        new Notice(`Session folder set to "${cleaned}". Sessions will be written to "${fullPath}". Existing session notes in "${this.settings.reviewDir}/${previous}" were not moved.`);

        if (conflicting.length > 0) {
            new Notice(
                `Warning: ${conflicting.length} quiz note${conflicting.length === 1 ? '' : 's'} currently live under "${fullPath}" and will no longer be scanned.`,
                10000,
            );
        }
        await this.scanAll();
    }

    async setForceShowWarnings(value: boolean): Promise<void> {
        if (value === this.settings.forceShowWarnings) return;
        this.settings.forceShowWarnings = value;
        await this.saveData(this.settings);
        await this.scanAll();
    }

    async setSessionDefaults(next: SessionConfig): Promise<void> {
        this.settings.sessionDefaults = { ...next };
        await this.saveData(this.settings);
    }

    getManagePresets(): ManageQuestionPreset[] {
        return this.settings.managePresets;
    }

    getLastCustomSelection(): string[] {
        return this.settings.lastCustomSelection;
    }

    getReviewFolders(): string[] {
        return this.reviewFolders;
    }

    generatePresetId(): string {
        return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    async saveManagePresets(presets: ManageQuestionPreset[]): Promise<void> {
        this.settings.managePresets = presets;
        await this.saveData(this.settings);
    }

    getSessionPresets(): SessionPreset[] {
        return this.settings.sessionPresets;
    }

    async saveSessionPresets(presets: SessionPreset[]): Promise<void> {
        this.settings.sessionPresets = presets;
        await this.saveData(this.settings);
        this.app.workspace.trigger('active-review:session-presets-changed');
    }

    getManageImportJournal(): ManageImportJournal | null {
        return this.settings.manageImportJournal;
    }

    async saveManageImportJournal(journal: ManageImportJournal | null): Promise<void> {
        this.settings.manageImportJournal = journal;
        await this.saveData(this.settings);
    }

    getSessionImportJournal(): { presetsBefore: SessionPreset[] } | null {
        return this.settings.sessionImportJournal;
    }

    async saveSessionImportJournal(journal: { presetsBefore: SessionPreset[] } | null): Promise<void> {
        this.settings.sessionImportJournal = journal;
        await this.saveData(this.settings);
    }

    refreshIdleViews(full = false): void {
        if (!this.readyResolved) return;
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            if (leaf.view instanceof ReviewView) leaf.view.refreshIfIdle(full);
        }
    }

    async saveLastCustomSelection(paths: string[]): Promise<void> {
        this.settings.lastCustomSelection = paths;
        await this.saveData(this.settings);
    }

    async remapPresetPaths(
        map: Map<string, string>,
    ): Promise<{ presetsUpdated: number; lastCustomUpdated: boolean }> {
        if (map.size === 0) return { presetsUpdated: 0, lastCustomUpdated: false };

        let presetsUpdated = 0;
        for (const preset of this.settings.managePresets) {
            const next: string[] = [];
            const seen = new Set<string>();
            let changed = false;
            for (const path of preset.includedPaths) {
                const mapped = map.get(path) ?? path;
                if (mapped !== path) changed = true;
                if (!seen.has(mapped)) {
                    seen.add(mapped);
                    next.push(mapped);
                } else {
                    changed = true;
                }
            }
            if (changed) {
                preset.includedPaths = next;
                presetsUpdated++;
            }
        }

        const nextLast: string[] = [];
        const seenLast = new Set<string>();
        let lastChanged = false;
        for (const path of this.settings.lastCustomSelection) {
            const mapped = map.get(path) ?? path;
            if (mapped !== path) lastChanged = true;
            if (!seenLast.has(mapped)) {
                seenLast.add(mapped);
                nextLast.push(mapped);
            } else {
                lastChanged = true;
            }
        }
        if (lastChanged) this.settings.lastCustomSelection = nextLast;

        await this.saveData(this.settings);
        return { presetsUpdated, lastCustomUpdated: lastChanged };
    }

    async moveQuestionFile(
        oldPath: string,
        category: string[],
    ): Promise<{
        newPath: string;
        presetsUpdated: number;
        lastCustomUpdated: boolean;
        frontmatterUpdated: boolean;
    }> {
        const result = await moveFileToCategory(
            this.app,
            this.settings.reviewDir,
            oldPath,
            category,
        );
        const remap = await this.remapPresetPaths(new Map([[oldPath, result.newPath]]));
        await this.scanAll();
        return {
            newPath: result.newPath,
            frontmatterUpdated: result.frontmatterUpdated,
            ...remap,
        };
    }

    async addCategoryFolder(parent: string[], name: string): Promise<string> {
        const clean = name.trim();
        if (
            !clean ||
            clean.includes('/') ||
            clean === '.' ||
            clean === '..' ||
            clean.startsWith('.')
        ) {
            throw new Error('Invalid category name.');
        }

        const reviewDir = this.settings.reviewDir;
        const parentActual = await resolveCategoryCasing(this.app.vault, reviewDir, parent);
        const parentPath = parentActual.length
            ? `${reviewDir}/${parentActual.join('/')}`
            : reviewDir;
        const targetPath = `${parentPath}/${clean}`;
        const existing = this.app.vault
            .getAllLoadedFiles()
            .find((file) => file.path.toLowerCase() === targetPath.toLowerCase());
        if (existing) {
            throw new Error('Category already exists.');
        }

        const folder = await addCategoryFolderVault(
            this.app,
            reviewDir,
            parentActual,
            clean,
        );
        await this.scanAll();
        return folder;
    }

    async deleteCategoryFolder(category: string[]): Promise<{
        removedPrefix: string;
        moved: FileMove[];
        errors: string[];
        presetsUpdated: number;
        lastCustomUpdated: boolean;
        folders: string[];
    }> {
        const result = await deleteCategoryFolderFiles(
            this.app,
            this.settings.reviewDir,
            category,
        );
        const remap = await this.remapPresetPaths(
            new Map(result.moved.map((move) => [move.from, move.to])),
        );
        await this.scanAll();
        return { ...result, ...remap, folders: this.getReviewFolders() };
    }

    /**
     * Full scan of the review folder and the sessions folder. Only the Rescan
     * button, settings changes, and the bootstrap path call this; startup reads
     * the persistent index instead.
     */
    async scanAll(): Promise<void> {
        if (this.scanning) {
            this.rescanQueued = true;
            return;
        }
        this.scanning = true;
        try {
            // Let any in-flight incremental batch finish before replacing the maps.
            await this.applyQueue.catch(() => undefined);
            const scanned = await this.getScanner().scan();
            try {
                this.reviewFolders = scanReviewFolders(
                    this.app.vault,
                    this.settings.reviewDir,
                    this.settings.sessionsSubdir,
                );
            } catch {
                this.reviewFolders = [''];
            }

            const questions = new Map<string, Question>();
            const issues = new Map<string, string>(scanned.issues);
            const warnings = new Map<string, Warning[]>();
            const indexed: Record<string, IndexedQuestion> = {};

            const livePaths = new Set(scanned.questions.keys());
            for (const path of [...this.validationCache.keys()]) {
                if (!livePaths.has(path)) this.validationCache.delete(path);
            }

            for (const [path, issue] of scanned.issues) {
                const stat = scanned.files.get(path);
                indexed[path] = {
                    mtime: stat?.mtime ?? 0,
                    size: stat?.size ?? 0,
                    q: null,
                    issue,
                    verdict: null,
                };
            }

            for (const [path, q] of scanned.questions) {
                // Yield to the event loop every 20 questions so the UI can paint.
                if (this.validationCache.size > 0 && this.validationCache.size % 20 === 0) {
                    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
                }
                const verdict = this.validateQuestion(q);
                const stat = scanned.files.get(path);
                indexed[path] = {
                    mtime: stat?.mtime ?? 0,
                    size: stat?.size ?? 0,
                    q,
                    issue: null,
                    verdict: {
                        error: verdict.error,
                        warnings: verdict.warnings,
                        choiceCount: verdict.choiceCount,
                    },
                };
                const record = this.computeQuestionRecord(q, verdict);
                if (record.issue !== null) {
                    issues.set(path, record.issue);
                    continue;
                }
                if (record.warnings) warnings.set(path, record.warnings);
                questions.set(path, q);
            }

            this.questions = questions;
            this.issues = issues;
            this.warnings = warnings;
            this._questionCache = null;

            await this.getSessionIndex().rebuild();
            const sessions: Record<string, IndexedSession> = {};
            for (const [path, entry] of this.getSessionIndex().snapshot()) {
                sessions[path] = {
                    mtime: entry.mtime,
                    size: entry.size,
                    log: entry.log,
                };
            }

            this.indexData = {
                schema: INDEX_SCHEMA,
                pluginVersion: this.manifest.version,
                scope: {
                    reviewDir: this.settings.reviewDir,
                    sessionsSubdir: this.settings.sessionsSubdir,
                },
                builtAt: Date.now(),
                questions: indexed,
                sessions,
            };
            this.refreshIdleViews(true);
            await this.writeIndexNow();
        } finally {
            this.scanning = false;
        }

        const deferred = this.deferredChanges;
        this.deferredChanges = [];
        if (deferred.length > 0) await this.applyChanges(deferred);
        if (this.rescanQueued) {
            this.rescanQueued = false;
            await this.scanAll();
        }
    }

    private validateQuestion(q: Question): ValidationVerdict {
        const cached = this.validationCache.get(q.path);
        if (cached && cached.question === q) return cached;
        const { items, errors } = buildSession(
            [q],
            VALIDATION_CONFIG,
            this.settings.reviewDir,
        );
        const verdict: ValidationVerdict = {
            question: q,
            error: errors[0] ?? null,
            warnings: items[0]?.buildWarnings ?? [],
            choiceCount: items[0]?.choices.length ?? 0,
        };
        this.validationCache.set(q.path, verdict);
        return verdict;
    }

    private computeQuestionRecord(
        q: Question,
        verdict: ValidationVerdict,
    ): { issue: string | null; warnings: Warning[] | null } {
        if (verdict.error !== null) {
            return { issue: verdict.error, warnings: null };
        }
        const all: Warning[] = [...q.warnings, ...verdict.warnings];
        if (verdict.choiceCount < 2) {
            all.push({
                section: 'distractors',
                message: 'Insufficient choices — session will fall back to typed mode.',
            });
        }
        const seen = new Set<string>();
        const visible = all
            .filter(
                (w) =>
                    this.settings.forceShowWarnings ||
                    !q.ignoredWarnings.has(w.section),
            )
            .filter((w) => {
                if (seen.has(w.message)) return false;
                seen.add(w.message);
                return true;
            });
        return { issue: null, warnings: visible.length > 0 ? visible : null };
    }

    /** Rebuild the in-memory maps from the persisted index; no vault scan. */
    private async hydrateFromIndex(data: VaultIndexData): Promise<void> {
        if (
            data.scope.reviewDir !== this.settings.reviewDir ||
            data.scope.sessionsSubdir !== this.settings.sessionsSubdir
        ) {
            await this.scanAll();
            return;
        }

        const questions = new Map<string, Question>();
        const issues = new Map<string, string>();
        const warnings = new Map<string, Warning[]>();
        const validation = new Map<string, ValidationVerdict>();
        const stale: VaultChange[] = [];
        const dropped: string[] = [];

        let hydrated = 0;
        for (const [path, entry] of Object.entries(data.questions)) {
            if (hydrated > 0 && hydrated % ReviewQuizPlugin.HYDRATE_CHUNK === 0) {
                await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
            }
            hydrated++;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                dropped.push(path);
                continue;
            }
            if (file.stat.mtime !== entry.mtime || file.stat.size !== entry.size) {
                stale.push({ path });
                continue;
            }
            this.hydrateQuestionEntry(path, entry, questions, issues, warnings, validation);
        }

        this.questions = questions;
        this.issues = issues;
        this.warnings = warnings;
        this.validationCache = validation;
        this._questionCache = null;

        const sessionEntries = new Map<string, SessionIndexEntry>();
        for (const [path, entry] of Object.entries(data.sessions)) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                dropped.push(path);
                continue;
            }
            sessionEntries.set(path, {
                mtime: entry.mtime,
                size: entry.size,
                log: entry.log,
            });
            if (file.stat.mtime !== entry.mtime || file.stat.size !== entry.size) {
                stale.push({ path });
            }
        }
        this.getSessionIndex().hydrate(sessionEntries);
        this.indexData = data;

        for (const path of dropped) this.dropPath(path);

        if (stale.length > 0 && stale.length <= ReviewQuizPlugin.STALE_INLINE_LIMIT) {
            await this.applyChanges(stale);
        } else if (stale.length > 0) {
            new Notice(
                `${stale.length} indexed notes changed since the last scan — press Rescan notes.`,
            );
        }
        if (dropped.length > 0 || stale.length > 0) this.scheduleIndexSave();
    }

    private hydrateQuestionEntry(
        path: string,
        entry: IndexedQuestion,
        questions: Map<string, Question>,
        issues: Map<string, string>,
        warnings: Map<string, Warning[]>,
        validation: Map<string, ValidationVerdict>,
    ): void {
        if (entry.issue !== null) {
            issues.set(path, entry.issue);
            return;
        }
        const q = entry.q;
        const stored = entry.verdict;
        if (!q || !stored) return;
        const verdict: ValidationVerdict = {
            question: q,
            error: stored.error,
            warnings: stored.warnings,
            choiceCount: stored.choiceCount,
        };
        validation.set(path, verdict);
        const record = this.computeQuestionRecord(q, verdict);
        if (record.issue !== null) {
            issues.set(path, record.issue);
            return;
        }
        if (record.warnings) warnings.set(path, record.warnings);
        questions.set(path, q);
    }

    private async handleVaultChanges(changes: VaultChange[]): Promise<void> {
        if (this.scanning) {
            this.deferredChanges.push(...changes);
            return;
        }
        // Serialize batches so two debounced flushes cannot interleave writes.
        const run = this.applyQueue.then(() => this.applyChanges(changes));
        this.applyQueue = run.catch(() => undefined);
        await run;
    }

    /** Incremental update for the changed paths; never scans the whole vault. */
    private async applyChanges(changes: VaultChange[]): Promise<void> {
        let changed = false;
        const seen = new Set<string>();
        for (const change of changes) {
            if (change.oldPath && change.oldPath !== change.path) {
                changed = this.dropPath(change.oldPath) || changed;
            }
            if (change.deleted) {
                changed = this.dropPath(change.path) || changed;
                continue;
            }
            if (seen.has(change.path)) continue;
            seen.add(change.path);
            if (!this.isUnderReview(change.path)) {
                changed = this.dropPath(change.path) || changed;
                continue;
            }
            const file = this.app.vault.getAbstractFileByPath(change.path);
            if (!(file instanceof TFile)) {
                changed = this.dropPath(change.path) || changed;
                continue;
            }
            changed =
                (this.isSessionPath(change.path)
                    ? await this.upsertSession(file)
                    : await this.upsertQuestion(file)) || changed;
        }
        if (!changed) return;
        this._questionCache = null;
        this.scheduleIndexSave();
        this.refreshIdleViews(true);
    }

    private async upsertQuestion(file: TFile): Promise<boolean> {
        const entry = await this.getScanner().parseFile(file);
        const index = this.ensureIndexData();
        const current = index.questions[file.path];
        if (current && current.mtime === entry.mtime && current.size === entry.size) {
            return false;
        }

        if (entry.question === null) {
            if (entry.issue === null) {
                // Excluded or non-quiz note: it is not part of the index at all.
                return this.dropPath(file.path);
            }
            index.questions[file.path] = {
                mtime: entry.mtime,
                size: entry.size,
                q: null,
                issue: entry.issue,
                verdict: null,
            };
            this.questions.delete(file.path);
            this.warnings.delete(file.path);
            this.validationCache.delete(file.path);
            this.issues.set(file.path, entry.issue);
            return true;
        }

        const verdict = this.validateQuestion(entry.question);
        index.questions[file.path] = {
            mtime: entry.mtime,
            size: entry.size,
            q: entry.question,
            issue: null,
            verdict: {
                error: verdict.error,
                warnings: verdict.warnings,
                choiceCount: verdict.choiceCount,
            },
        };
        const record = this.computeQuestionRecord(entry.question, verdict);
        if (record.issue !== null) {
            this.questions.delete(file.path);
            this.warnings.delete(file.path);
            this.issues.set(file.path, record.issue);
        } else {
            this.issues.delete(file.path);
            this.questions.set(file.path, entry.question);
            if (record.warnings) this.warnings.set(file.path, record.warnings);
            else this.warnings.delete(file.path);
        }
        return true;
    }

    private async upsertSession(file: TFile, force = false): Promise<boolean> {
        const entry = await this.getSessionIndex().read(file);
        const index = this.ensureIndexData();
        const current = index.sessions[file.path];
        if (
            !force &&
            current &&
            current.mtime === entry.mtime &&
            current.size === entry.size
        ) {
            return false;
        }
        index.sessions[file.path] = {
            mtime: entry.mtime,
            size: entry.size,
            log: entry.log,
        };
        this.getSessionIndex().setEntry(file.path, entry);
        return true;
    }

    private dropPath(path: string): boolean {
        let changed = false;
        if (this.questions.delete(path)) changed = true;
        if (this.issues.delete(path)) changed = true;
        if (this.warnings.delete(path)) changed = true;
        if (this.validationCache.delete(path)) changed = true;
        const index = this.indexData;
        if (index && index.questions[path]) {
            delete index.questions[path];
            changed = true;
        }
        if (index && index.sessions[path]) {
            delete index.sessions[path];
            changed = true;
        }
        if (this.getSessionIndex().has(path)) {
            this.getSessionIndex().remove(path);
            changed = true;
        }
        return changed;
    }

    private isSessionPath(path: string): boolean {
        return isSessionFilePath(
            path,
            this.settings.reviewDir,
            this.settings.sessionsSubdir,
        );
    }

    private isUnderReview(path: string): boolean {
        const root = this.settings.reviewDir.replace(/^\/+|\/+$/g, '');
        return path === root || path.startsWith(`${root}/`);
    }

    private ensureIndexData(): VaultIndexData {
        if (!this.indexData) {
            this.indexData = emptyIndexData(
                {
                    reviewDir: this.settings.reviewDir,
                    sessionsSubdir: this.settings.sessionsSubdir,
                },
                this.manifest.version,
            );
        }
        return this.indexData;
    }

    private scheduleIndexSave(): void {
        this.clearIndexTimer();
        this.indexSaveTimer = window.setTimeout(() => {
            this.indexSaveTimer = null;
            void this.writeIndexNow();
        }, 2000);
    }

    private clearIndexTimer(): void {
        if (this.indexSaveTimer !== null) {
            window.clearTimeout(this.indexSaveTimer);
            this.indexSaveTimer = null;
        }
    }

    private async writeIndexNow(): Promise<void> {
        this.clearIndexTimer();
        if (!this.indexData) return;
        this.indexData.builtAt = Date.now();
        await this.getIndexStore().save(this.indexData);
    }

    async activateView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        if (existing.length === 0) {
            await this.openReviewTab();
            return;
        }
        new OpenReviewTabModal(this.app, {
            tabs: existing.map((leaf, index) => ({
                label: `Tab ${index + 1} — ${
                    leaf.view instanceof ReviewView
                        ? leaf.view.getTabLabel()
                        : 'Active Review'
                }`,
                onSelect: () => {
                    void this.app.workspace.revealLeaf(leaf);
                },
            })),
            onNewTab: () => this.openReviewTab(),
        }).open();
    }

    private async openReviewTab(): Promise<void> {
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
        await this.app.workspace.revealLeaf(leaf);
    }

    // ========================================================================
    // Manage Questions import — shared by settings and the Manage modal
    // ========================================================================

    async applyManageImport(
        manifest: ManagePresetManifest,
        preview: ImportPreview,
        mode: ImportApplyMode,
    ): Promise<ApplyManageImportResult> {
        const clonePresets = (): ManageQuestionPreset[] =>
            this.settings.managePresets.map((p) => ({
                ...p,
                includedPaths: [...p.includedPaths],
            }));
        const presetsBefore = clonePresets();
        const lastCustomBefore = [...this.settings.lastCustomSelection];

        const result = await applyManageImport({
            app: this.app,
            reviewDir: this.settings.reviewDir,
            manifest,
            preview,
            mode,
            generateId: () => this.generatePresetId(),
            remapPaths: async (map) => { await this.remapPresetPaths(map); },
            getPresets: () => this.getManagePresets(),
            savePresets: async (presets) => { await this.saveManagePresets(presets); },
        });

        if (result.moves.length > 0 || result.presetsAdded > 0 || result.presetsUpdated > 0) {
            const reviewRoot = this.settings.reviewDir;
            const categoryOf = (path: string): string[] => {
                const rel = relativeToReview(path, reviewRoot);
                if (rel === null || rel === '') return [];
                return rel.split('/').slice(0, -1).filter(Boolean);
            };
            const journal: ManageImportJournal = {
                createdAt: new Date().toISOString(),
                moves: result.moves.map((move) => ({
                    from: move.from,
                    to: move.to,
                    beforeCategory: categoryOf(move.from),
                    afterCategory: categoryOf(move.to),
                })),
                createdFolders: result.createdFolders,
                presetsBefore,
                presetsAfter: clonePresets(),
                lastCustomBefore,
                lastCustomAfter: [...this.settings.lastCustomSelection],
            };
            try {
                await this.saveManageImportJournal(journal);
            } catch (e) {
                result.errors.push(
                    `Import applied, but undo journal could not be saved: ${(e as Error).message}`,
                );
            }
        }
        return result;
    }

    async undoLastImport(): Promise<UndoManageImportResult> {
        const journal = this.settings.manageImportJournal;
        if (!journal) {
            new Notice('No Manage Questions import to undo.');
            return { restored: 0, errors: ['No import journal.'], foldersLeft: [], blocked: true };
        }
        const result = await undoManageImport({
            app: this.app,
            journal,
            savePresets: async (presets) => { await this.saveManagePresets(presets); },
            saveLastCustom: async (paths) => { await this.saveLastCustomSelection(paths); },
        });
        if (!result.blocked && result.errors.length === 0) {
            await this.saveManageImportJournal(null);
        }
        return result;
    }
}