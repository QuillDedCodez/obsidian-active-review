import { Notice, Setting, SettingPage } from 'obsidian';
import type ReviewQuizPlugin from '../../main';
import { extractFolderCategory } from '../../parser';
import { CategorySyncModal, type SyncEntry } from '../../ui/manage/CategorySyncModal';
import { ConfirmModal } from '../../ui/Modals';
import { applyCategorySync, applyFolderSync, planCategorySync, planFolderSync } from '../../vault';

export class CategorySyncPage extends SettingPage {
    constructor(private plugin: ReviewQuizPlugin) {
        super();
        this.title = 'Category Sync';
    }

    display(): void {
        this.containerEl.empty();
        this.containerEl.createEl('p', {
            cls: 'setting-item-description',
            text: 'Category sync rewrites frontmatter or moves files in your vault. Neither action can be undone from this plugin.',
        });

        new Setting(this.containerEl)
            .setName('Move notes to their declared categories')
            .setDesc('Move each note to the review subfolder matching its rv-category.')
            .addButton((btn) => btn.setButtonText('Arrange move…').onClick(() => void this.runFolderSync()));

        new Setting(this.containerEl)
            .setName('Update categories from folder locations')
            .setDesc("Rewrite each note's rv-category to match its current subfolder.")
            .addButton((btn) => btn.setButtonText('Arrange update…').onClick(() => void this.runCategorySync()));
    }

    private async runFolderSync(): Promise<void> {
        const app = this.plugin.app;
        const reviewDir = this.plugin.settings.reviewDir;
        const plan = await planFolderSync(app.vault, reviewDir, this.plugin.getQuestionMap());
        if (plan.moves.length === 0) { new Notice('No notes need moving.'); return; }

        this.confirmAndApply({
            arrangeTitle: 'Arrange move',
            entries: plan.moves.map((m) => ({
                path: m.from,
                folder: extractFolderCategory(m.from, reviewDir),
                from: m.from,
                to: m.to,
            })),
            items: plan.moves,
            key: (m) => m.from,
            title: (n) => `Move ${n} note${n === 1 ? '' : 's'}?`,
            warning: 'Files will be moved in your vault. This action cannot be undone from the plugin.',
            confirmLabel: 'Move',
            line: (m) => `${m.from}  →  ${m.to}`,
            apply: async (moves) => {
                const result = await applyFolderSync(app.vault, { moves, errors: plan.errors });
                const remap = await this.plugin.remapPresetPaths(
                    new Map(result.movedPaths.map((m) => [m.from, m.to])),
                );
                let msg = result.errors.length === 0
                    ? `Moved ${result.moved} note${result.moved === 1 ? '' : 's'}.`
                    : `Moved ${result.moved}, ${result.errors.length} failed.`;
                if (remap.presetsUpdated > 0) msg += ` Updated ${remap.presetsUpdated} presets.`;
                new Notice(msg);
                await this.plugin.scanAll();
            },
        });
    }

    private async runCategorySync(): Promise<void> {
        const app = this.plugin.app;
        const reviewDir = this.plugin.settings.reviewDir;
        const plan = await planCategorySync(app.vault, reviewDir, this.plugin.getQuestionMap());
        if (plan.updates.length === 0) { new Notice('No notes need category updates.'); return; }

        this.confirmAndApply({
            arrangeTitle: 'Arrange update',
            entries: plan.updates.map((u) => ({
                path: u.path,
                folder: extractFolderCategory(u.path, reviewDir),
                from: u.oldCategory.join('/') || '(none)',
                to: u.newCategory.join('/') || '(root)',
            })),
            items: plan.updates,
            key: (u) => u.path,
            title: (n) => `Update rv-category on ${n} note${n === 1 ? '' : 's'}?`,
            warning: "Each selected note's rv-category will be rewritten. This cannot be undone from the plugin.",
            confirmLabel: 'Update',
            line: (u) => `${u.path}  →  rv-category: ${u.newCategory.join('/') || '(root)'}`,
            apply: async (updates) => {
                const result = await applyCategorySync(app, { updates, errors: plan.errors });
                new Notice(
                    result.errors.length === 0
                        ? `Updated ${result.updated} note${result.updated === 1 ? '' : 's'}.`
                        : `Updated ${result.updated}, ${result.errors.length} failed.`,
                );
                await this.plugin.scanAll();
            },
        });
    }

    /** Shared arrange → confirm → apply flow for both sync directions. */
    private confirmAndApply<T>(config: {
        arrangeTitle: string;
        entries: SyncEntry[];
        items: T[];
        key: (item: T) => string;
        title: (count: number) => string;
        warning: string;
        confirmLabel: string;
        line: (item: T) => string;
        apply: (selected: T[]) => Promise<void>;
    }): void {
        const app = this.plugin.app;
        new CategorySyncModal(app, {
            title: `${config.arrangeTitle} (${config.entries.length})`,
            description: 'Only notes whose rv-category differs from their folder are listed.',
            reviewDir: this.plugin.settings.reviewDir,
            entries: config.entries,
            onContinue: (selectedPaths) => {
                const selectedSet = new Set(selectedPaths);
                const selected = config.items.filter((item) => selectedSet.has(config.key(item)));
                if (selected.length === 0) return;
                new ConfirmModal(app, {
                    title: config.title(selected.length),
                    warning: config.warning,
                    lines: selected.map(config.line),
                    confirmLabel: config.confirmLabel,
                    destructive: true,
                    onConfirm: async () => {
                        await config.apply(selected);
                    },
                }).open();
            },
        }).open();
    }
}
