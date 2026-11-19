/** Shared behaviour for the plugin's declarative settings pages. */
import { SettingPage } from 'obsidian';

/**
 * Marks the containing settings modal before rendering. The marker replaces
 * `:has()`-based ancestor selectors in `styles.css`, which are expensive for
 * Obsidian's broad selector invalidation.
 */
export abstract class RvSettingPage extends SettingPage {
    display(): void {
        this.rootEl.closest('.modal')?.addClass('rv-settings-modal');
        this.renderPage();
    }

    protected abstract renderPage(): void;
}
