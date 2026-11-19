/**
 * Consolidated small settings pages:
 * - AdvancedPage (force-show warnings)
 * - FoldersPage (review folder + session folder)
 * - FolderSuggest, SessionFolderSuggest (moved from suggesters.ts)
 */
import { AbstractInputSuggest, Setting, TFolder, normalizePath, type App } from 'obsidian';
import { DEFAULT_SESSIONS_SUBDIR } from '../../constants';
import type ReviewQuizPlugin from '../../main';
import { RvSettingPage } from '../SettingsPageBase';

// Suggesters

export class FolderSuggest extends AbstractInputSuggest<string> {
    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
    }
    getSuggestions(query: string): string[] {
        const lower = query.toLowerCase();
        const all = this.app.vault
            .getAllLoadedFiles()
            .filter((f): f is TFolder => f instanceof TFolder)
            .map((f) => f.path)
            .filter((p) => p !== '')
            .sort();
        return lower ? all.filter((p) => p.toLowerCase().includes(lower)).slice(0, 20) : all.slice(0, 20);
    }
    renderSuggestion(value: string, el: HTMLElement): void { el.setText(value); }
    selectSuggestion(value: string): void { this.setValue(value); }
}

export class SessionFolderSuggest extends AbstractInputSuggest<string> {
    constructor(app: App, inputEl: HTMLInputElement, private getReviewDir: () => string) {
        super(app, inputEl);
    }
    getSuggestions(query: string): string[] {
        const base = normalizePath(this.getReviewDir() || '').replace(/^\/+|\/+$/g, '');
        const lower = query.toLowerCase();
        const all = this.app.vault
            .getAllLoadedFiles()
            .filter((f): f is TFolder => f instanceof TFolder)
            .map((f) => f.path)
            .filter((p) => p !== '')
            .filter((p) => !base || p === base || p.startsWith(`${base}/`))
            .map((p) => (base ? p.slice(base.length).replace(/^\/+/, '') : p))
            .filter((p) => p !== '');
        const uniq = [...new Set(all)].sort();
        return lower ? uniq.filter((p) => p.toLowerCase().includes(lower)).slice(0, 20) : uniq.slice(0, 20);
    }
    renderSuggestion(value: string, el: HTMLElement): void { el.setText(value); }
    selectSuggestion(value: string): void { this.setValue(value); }
}

// AdvancedPage

export class AdvancedPage extends RvSettingPage {
    constructor(private plugin: ReviewQuizPlugin) {
        super();
        this.title = 'Advanced';
    }

    protected renderPage(): void {
        this.containerEl.empty();
        new Setting(this.containerEl)
            .setName('Force show all warnings')
            .setDesc('Show warning messages even when the section header carries <!--ignore-warnings-->.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.forceShowWarnings).onChange(async (v) => {
                    await this.plugin.setForceShowWarnings(v);
                }),
            );
    }
}

// FoldersPage

export class FoldersPage extends RvSettingPage {
    constructor(private plugin: ReviewQuizPlugin) {
        super();
        this.title = 'Folders';
    }

    protected renderPage(): void {
        this.containerEl.empty();
        const app: App = this.plugin.app;
        let reviewDirInput = '';
        let sessionsSubdirInput = '';

        new Setting(this.containerEl)
            .setName('Review folder')
            .setDesc('Folder that contains quiz notes. Changing this does not move existing notes.')
            .addText((text) => {
                text.setPlaceholder('review').setValue(this.plugin.settings.reviewDir);
                text.onChange((v) => { reviewDirInput = v; });
                new FolderSuggest(app, text.inputEl);
            })
            .addButton((btn) =>
                btn.setButtonText('Apply').onClick(async () => {
                    await this.plugin.setReviewDir(reviewDirInput || this.plugin.settings.reviewDir);
                }),
            );

        new Setting(this.containerEl)
            .setName('Session folder')
            .setDesc(
                `Subfolder inside the review folder where finished sessions are written. Default "${DEFAULT_SESSIONS_SUBDIR}". Current: ${this.plugin.settings.reviewDir}/${this.plugin.settings.sessionsSubdir}.`,
            )
            .addText((text) => {
                text.setPlaceholder(DEFAULT_SESSIONS_SUBDIR).setValue(this.plugin.settings.sessionsSubdir);
                text.onChange((v) => { sessionsSubdirInput = v; });
                new SessionFolderSuggest(app, text.inputEl, () => this.plugin.settings.reviewDir);
            })
            .addButton((btn) =>
                btn.setButtonText('Apply').onClick(async () => {
                    await this.plugin.setSessionsSubdir(
                        sessionsSubdirInput || this.plugin.settings.sessionsSubdir,
                    );
                }),
            );
    }
}
