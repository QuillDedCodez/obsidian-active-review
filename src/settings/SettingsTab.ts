/** Active Review settings tab — declarative 1.13 API, one page per section. */
import { PluginSettingTab, SettingPage, type App, type SettingDefinitionItem } from 'obsidian';
import type ReviewQuizPlugin from '../main';
import { AdvancedPage, FoldersPage } from './pages/GeneralPages';
import { CategorySyncPage } from './pages/CategorySyncPage';
import { SessionDefaultsPage } from './pages/SessionDefaultsPage';
import { SessionPresetManager } from '../ui/presets/SessionPresets';
import { QuestionPresetManager } from '../ui/presets/QuestionPresets';

// Preset page launchers (previously in PresetPages.ts)

class SessionPresetsPage extends SettingPage {
    private manager: SessionPresetManager | null = null;

    constructor(private plugin: ReviewQuizPlugin) {
        super();
        this.title = 'Manage Session Presets';
    }

    display(): void {
        // Settings can be asked to redraw while a row is being held. Replacing
        // the manager then would abort the drag and leave nothing to drop.
        if (this.manager?.isReordering()) return;
        this.manager?.destroy();
        this.containerEl.empty();
        this.manager = new SessionPresetManager({
            app: this.plugin.app,
            plugin: this.plugin,
            containerEl: this.containerEl,
        });
        this.manager.render();
    }

    hide(): void {
        this.manager?.destroy();
        this.manager = null;
        super.hide();
    }
}

class QuestionPresetsPage extends SettingPage {
    private manager: QuestionPresetManager | null = null;

    constructor(private plugin: ReviewQuizPlugin) {
        super();
        this.title = 'Manage Question Presets';
    }

    display(): void {
        if (this.manager?.isReordering()) return;
        this.manager?.destroy();
        this.containerEl.empty();
        this.manager = new QuestionPresetManager({
            app: this.plugin.app,
            plugin: this.plugin,
            containerEl: this.containerEl,
        });
        this.manager.render();
    }

    hide(): void {
        this.manager?.destroy();
        this.manager = null;
        super.hide();
    }
}

// Settings tab

export class ReviewQuizSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private plugin: ReviewQuizPlugin,
    ) {
        super(app, plugin);
        // Scope mobile CSS overrides to this plugin's settings modal without
        // relying on translated titles or plugin IDs in selectors.
        this.containerEl.addClass('rv-settings-tab');
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'page',
                name: 'Folders',
                desc: 'Review folder and session folder locations.',
                page: () => new FoldersPage(this.plugin),
            },
            {
                type: 'page',
                name: 'Session Defaults',
                desc: 'Presentation, count, trim, order, seed, navigator, allow-flag.',
                page: () => new SessionDefaultsPage(this.plugin),
            },
            {
                type: 'page',
                name: 'Manage Session Presets',
                desc: 'Rename, duplicate, delete, pin, import, or export saved session presets.',
                page: () => new SessionPresetsPage(this.plugin),
            },
            {
                type: 'page',
                name: 'Manage Question Presets',
                desc: 'Rename, delete, import, or export saved Manage Questions presets.',
                page: () => new QuestionPresetsPage(this.plugin),
            },
            {
                type: 'page',
                name: 'Category Sync',
                desc: 'Align note folders with rv-category. Irreversible from the plugin.',
                page: () => new CategorySyncPage(this.plugin),
            },
            {
                type: 'page',
                name: 'Advanced',
                desc: 'Warning display options.',
                page: () => new AdvancedPage(this.plugin),
            },
        ];
    }
}
