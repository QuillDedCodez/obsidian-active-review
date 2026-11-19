/**
 * Reusable copy-to-clipboard button.
 *
 * `CopyButton` owns the fixed pipeline — guard, read the text, write the
 * clipboard, show feedback, recover — while every call site supplies the parts
 * that vary (`getText`, `beforeCopy`, `onCopied`) as callbacks. That is the
 * template-method shape expressed with the strategy pattern: one mechanism,
 * many behaviours, no inheritance.
 *
 * Call sites so far: the start-screen warning/skip outlines and the preset
 * export panes. Question cards and session detail panels can reuse it without
 * changes by passing a different `getText`.
 */
import { Notice, setIcon } from 'obsidian';
import { copyText } from '../util/clipboard';

export interface CopyButtonOptions {
    /** Text placed on the clipboard. Called once per click. */
    getText: () => string | Promise<string>;
    /** Return false to abort before reading or writing anything. */
    beforeCopy?: () => boolean;
    /** Runs only after a successful clipboard write. */
    onCopied?: () => void;
    /** Replaces the default failure Notice. */
    onError?: (err: unknown) => void;

    /** Visible label. Defaults to `Copy`. */
    label?: string;
    /** Label shown briefly after a successful copy. Defaults to `Copied`. */
    copiedLabel?: string;
    ariaLabel?: string;
    /** Extra classes appended to the base `rv-copy-button` class. */
    className?: string;
    /** How a successful copy is acknowledged. Defaults to `label`. */
    feedback?: 'label' | 'notice' | 'both';
    successNotice?: string;
    errorNotice?: string;
    /** How long the copied label stays up, in milliseconds. */
    holdMs?: number;
    /**
     * Cancel the click's default action and propagation. Required when the
     * button sits inside a `<summary>` or any other clickable container.
     */
    stopPropagation?: boolean;
    disabled?: boolean;
    /** Optional Lucide icon name, rendered through `setIcon`. */
    icon?: string;
    /** Icon swapped in after a successful copy, e.g. `check`. */
    copiedIcon?: string;
    /** Native tooltip text. Falls back to `ariaLabel` when omitted. */
    title?: string;
}

const DEFAULT_LABEL = 'Copy';
const DEFAULT_COPIED_LABEL = 'Copied';
const DEFAULT_SUCCESS_NOTICE = 'Copied to clipboard.';
const DEFAULT_ERROR_NOTICE = 'Could not copy to clipboard.';
const DEFAULT_HOLD_MS = 1500;

export class CopyButton {
    readonly el: HTMLButtonElement;

    private readonly options: CopyButtonOptions;
    private readonly copiedLabel: string;
    private readonly baseIcon: string | null;
    private readonly copiedIcon: string | null;
    private iconEl: HTMLElement | null = null;
    private textEl: HTMLElement | null = null;
    private baseLabel: string;
    private timer: number | null = null;
    private copying = false;

    constructor(parent: HTMLElement, options: CopyButtonOptions) {
        this.options = options;
        this.baseLabel = options.label ?? (options.icon ? '' : DEFAULT_LABEL);
        this.copiedLabel = options.copiedLabel ?? DEFAULT_COPIED_LABEL;
        this.baseIcon = options.icon ?? null;
        this.copiedIcon = options.copiedIcon ?? null;

        this.el = parent.createEl('button', {
            cls: options.className
                ? `rv-copy-button ${options.className}`
                : 'rv-copy-button',
            attr: { type: 'button' },
        });
        if (options.ariaLabel) this.el.setAttribute('aria-label', options.ariaLabel);
        const title = options.title ?? options.ariaLabel;
        if (title) this.el.setAttribute('title', title);
        if (options.disabled) this.el.disabled = true;

        if (this.baseIcon) {
            this.iconEl = this.el.createSpan({ cls: 'rv-copy-button-icon' });
            setIcon(this.iconEl, this.baseIcon);
        }
        if (this.baseLabel) {
            this.textEl = this.el.createSpan({
                cls: 'rv-copy-button-label',
                text: this.baseLabel,
            });
        } else if (!this.baseIcon) {
            this.baseLabel = DEFAULT_LABEL;
            this.textEl = this.el.createSpan({
                cls: 'rv-copy-button-label',
                text: this.baseLabel,
            });
        }

        this.el.addEventListener('click', (evt) => {
            if (options.stopPropagation) {
                evt.preventDefault();
                evt.stopPropagation();
            }
            void this.copy();
        });

        if (options.stopPropagation) {
            // Enter and Space activate a button; keep them from toggling the
            // surrounding <details> the way a summary click would.
            this.el.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter' || evt.key === ' ') evt.stopPropagation();
            });
        }
    }

    /** Runs the whole pipeline. Returns true only when text reached the clipboard. */
    async copy(): Promise<boolean> {
        if (this.copying || this.el.disabled) return false;
        if (this.options.beforeCopy && !this.options.beforeCopy()) return false;

        this.copying = true;
        try {
            const text = await this.options.getText();
            await copyText(text);
            this.flashCopied();
            const feedback = this.options.feedback ?? 'label';
            if (feedback === 'notice' || feedback === 'both') {
                new Notice(this.options.successNotice ?? DEFAULT_SUCCESS_NOTICE);
            }
            this.options.onCopied?.();
            return true;
        } catch (err) {
            if (this.options.onError) this.options.onError(err);
            else new Notice(this.options.errorNotice ?? DEFAULT_ERROR_NOTICE);
            return false;
        } finally {
            this.copying = false;
        }
    }

    /** Sets the resting label. Clears a pending reset first. */
    setLabel(label: string): void {
        this.baseLabel = label;
        this.clearTimer();
        this.el.removeClass('is-copied');
        this.textEl?.setText(label);
    }

    setDisabled(disabled: boolean): void {
        this.el.disabled = disabled;
    }

    destroy(): void {
        this.clearTimer();
        this.el.remove();
    }

    private flashCopied(): void {
        if ((this.options.feedback ?? 'label') === 'notice') return;
        this.clearTimer();
        if (this.copiedIcon) this.renderIcon(this.copiedIcon);
        this.textEl?.setText(this.copiedLabel);
        this.el.addClass('is-copied');
        this.timer = window.setTimeout(() => {
            this.timer = null;
            if (this.baseIcon) this.renderIcon(this.baseIcon);
            this.textEl?.setText(this.baseLabel);
            this.el.removeClass('is-copied');
        }, this.options.holdMs ?? DEFAULT_HOLD_MS);
    }

    private renderIcon(name: string): void {
        if (!this.iconEl) return;
        this.iconEl.empty();
        setIcon(this.iconEl, name);
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

/** Factory wrapper, matching the `create*` style used elsewhere in `ui/`. */
export function createCopyButton(
    parent: HTMLElement,
    options: CopyButtonOptions,
): CopyButton {
    return new CopyButton(parent, options);
}
