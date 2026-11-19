/** Markdown rendering (immediate + lazy) and the inline editor surface. */
import { App, Component, MarkdownRenderer } from 'obsidian';

// Markdown rendering (immediate + lazy)

/** Render markdown into an element, scoped to the quiz view's component lifecycle. */
export function renderMarkdown(
    app: App,
    component: Component,
    el: HTMLElement,
    text: string,
    sourcePath: string,
): void {
    el.addClass('rv-md');
    void MarkdownRenderer.render(app, text, el, sourcePath, component);
}

/** Render Markdown and run a callback once the render has completed. */
function renderMarkdownNow(
    app: App,
    component: Component,
    el: HTMLElement,
    text: string,
    sourcePath: string,
    onRendered?: () => void,
): void {
    el.addClass('rv-md');
    void MarkdownRenderer.render(app, text, el, sourcePath, component).then(() => {
        onRendered?.();
    });
}

type RenderJob = () => void;

const jobs = new WeakMap<Element, RenderJob>();
let observer: IntersectionObserver | null = null;
const observerRootMargin = '300px';
const pending: Element[] = [];
let flushFrame: number | null = null;
const RENDER_BUDGET_MS = 8;

function scheduleFlush(): void {
    if (flushFrame !== null) return;
    if (typeof window === 'undefined') {
        flushJobs();
        return;
    }
    flushFrame = window.requestAnimationFrame(() => {
        flushFrame = null;
        flushJobs();
    });
}

function flushJobs(): void {
    const start =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
    while (pending.length > 0) {
        const target = pending.shift()!;
        const job = jobs.get(target);
        if (!job) continue;
        jobs.delete(target);
        observer?.unobserve(target);
        if (target.isConnected) job();
        const now =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - start >= RENDER_BUDGET_MS) break;
    }
    if (pending.length > 0) scheduleFlush();
}

function sharedObserver(): IntersectionObserver {
    if (observer) return observer;
    observer = new IntersectionObserver(
        (entries) => {
            let queued = false;
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const job = jobs.get(entry.target);
                if (!job) continue;
                pending.push(entry.target);
                queued = true;
            }
            if (queued) scheduleFlush();
        },
        { rootMargin: observerRootMargin },
    );
    return observer;
}

/**
 * Defer a Markdown render until the element is near the viewport. Falls back
 * to an immediate render where IntersectionObserver is unavailable.
 */
export function renderMarkdownLazy(
    app: App,
    component: Component,
    el: HTMLElement,
    text: string,
    sourcePath: string,
    onRendered?: () => void,
): void {
    el.addClass('rv-md');
    if (typeof IntersectionObserver === 'undefined') {
        renderMarkdownNow(app, component, el, text, sourcePath, onRendered);
        return;
    }
    jobs.set(el, () => {
        renderMarkdownNow(app, component, el, text, sourcePath, onRendered);
    });
    sharedObserver().observe(el);
}

/**
 * Stop observing markdown containers that are about to be removed. Without
 * this, the shared observer keeps detached cards alive until the plugin unloads.
 */
export function releaseLazyMarkdown(root: HTMLElement): void {
    if (!observer) return;
    const targets = root.querySelectorAll<HTMLElement>('.rv-md');
    for (const el of Array.from(targets)) {
        jobs.delete(el);
        observer.unobserve(el);
    }
}

// Editor surface (two layers: mount controller + low-level editor)

/**
 * Editor surface for scratch and final-answer fields. Current implementation is
 * a textarea plus a debounced MarkdownRenderer preview; `buildEditorInternal` is
 * the single swap point for the Obsidian live-preview editor.
 */

export interface EditorHandle {
    getValue(): string;
    setValue(value: string): void;
    focus(): void;
    destroy(): void;
}

export interface CreateEditorOptions {
    app: App;
    component: Component;
    container: HTMLElement;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    /** HTML input mode; `'decimal'` opens a numeric keypad on mobile. */
    inputMode?: 'text' | 'decimal';
}

export function createEmbeddableEditor(options: CreateEditorOptions): EditorHandle {
    try {
        return buildEditorInternal(options);
    } catch (e) {
        console.warn('[rv] internal editor unavailable, using textarea fallback', e);
        return buildTextareaFallback(options);
    }
}

function buildEditorInternal(options: CreateEditorOptions): EditorHandle {
    // Path 1 upgrade point. For now: behave identically to the fallback.
    return buildTextareaFallback(options);
}

function buildTextareaFallback(options: CreateEditorOptions): EditorHandle {
    const wrap = options.container.createDiv({ cls: 'rv-editor' });
    const textarea = wrap.createEl('textarea', { cls: 'rv-editor-input' });
    textarea.value = options.value;
    textarea.placeholder = options.placeholder;

    if (options.inputMode) {
        textarea.inputMode = options.inputMode;
        if (options.inputMode === 'decimal') {
            textarea.autocapitalize = 'off';
            textarea.autocomplete = 'off';
            textarea.spellcheck = false;
        }
    }

    const updateRows = (): void => {
        const lines = textarea.value.split('\n').length;
        textarea.rows = Math.min(10, Math.max(3, lines));
    };
    updateRows();

    const preview = wrap.createDiv({ cls: 'rv-editor-preview rv-md' });
    let renderTimer: number | null = null;

    const renderPreview = (): void => {
        preview.empty();
        const text = textarea.value;
        if (!text.trim()) {
            preview.createSpan({ cls: 'rv-editor-placeholder', text: 'Preview' });
            return;
        }
        void MarkdownRenderer.render(options.app, text, preview, '', options.component);
    };
    renderPreview();

    textarea.addEventListener('input', () => {
        options.onChange(textarea.value);
        updateRows();
        if (renderTimer !== null) window.clearTimeout(renderTimer);
        renderTimer = window.setTimeout(renderPreview, 250);
    });

    let blurred = false;
    const handleBlur = (): void => {
        if (blurred) return;
        blurred = true;
        options.onChange(textarea.value);
        options.onBlur();
    };

    textarea.addEventListener('blur', handleBlur);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            textarea.blur();
        }
    });

    return {
        getValue: () => textarea.value,
        setValue: (value: string) => {
            if (textarea.value === value) return;
            const atEnd = textarea.selectionStart === textarea.value.length;
            textarea.value = value;
            updateRows();
            if (renderTimer !== null) window.clearTimeout(renderTimer);
            renderTimer = window.setTimeout(renderPreview, 250);
            if (atEnd) textarea.setSelectionRange(value.length, value.length);
        },
        focus: () => {
            textarea.focus();
            // Keep the sticky header from covering the textarea when the
            // keyboard opens on mobile.
            textarea.scrollIntoView({ block: 'nearest' });
            // Move caret to end
            const len = textarea.value.length;
            textarea.setSelectionRange(len, len);
        },
        destroy: () => {
            if (renderTimer !== null) window.clearTimeout(renderTimer);
            wrap.remove();
        },
    };
}

// EditorMount controller

/**
 * One click-to-edit slot: preview when idle, live editor when focused.
 * Only one editor across the whole view is mounted at a time.
 */
export interface EditorMountOptions {
    app: App;
    component: Component;
    host: HTMLElement;
    initialValue: string;
    placeholder: string;
    onChange: (value: string) => void;
    /** Called after the editor demounts (blur or Escape). */
    onBlur?: () => void;
    /** Read-only: no click, no editable mount. */
    initialDisabled?: boolean;
    /** Read-only view mode: like disabled but with dashed border preserved. */
    readOnly?: boolean;
    /** Only meaningful when `initialDisabled` or `readOnly`. */
    initialOk?: boolean;
    /** Input mode for the underlying textarea. Default `'text'`. */
    inputMode?: 'text' | 'decimal';
}

export class EditorMount {
    private app: App;
    private component: Component;
    private slot: HTMLElement;
    private handle: EditorHandle | null = null;
    private value: string;
    private placeholder: string;
    private onChangeCallback: (value: string) => void;
    private onBlurCallback: (() => void) | null;
    private disabled: boolean;
    private readOnly: boolean;
    private ok: boolean | undefined;
    private inputMode: 'text' | 'decimal';

    constructor(options: EditorMountOptions) {
        this.app = options.app;
        this.component = options.component;
        this.value = options.initialValue;
        this.placeholder = options.placeholder;
        this.onChangeCallback = options.onChange;
        this.onBlurCallback = options.onBlur ?? null;
        this.disabled = options.initialDisabled ?? false;
        this.readOnly = options.readOnly ?? false;
        this.inputMode = options.inputMode ?? 'text';
        this.ok = options.initialOk;

        this.slot = options.host.createDiv({ cls: 'rv-editor-slot' });
        this.renderProxy();
    }

    getValue(): string {
        return this.value;
    }

    /** Apply a value typed in another tab without emitting an onChange echo. */
    setValue(value: string): void {
        if (this.value === value) return;
        this.value = value;
        if (this.handle) this.handle.setValue(value);
        else this.renderProxy();
    }

    /** Update the correctness tint; re-renders the proxy when no editor is open. */
    setCorrectness(ok: boolean | undefined): void {
        this.ok = ok;
        if (!this.handle) this.renderProxy();
    }

    /** Lock the surface: destroy any live editor and render a disabled proxy. */
    lock(ok?: boolean): void {
        this.disabled = true;
        this.ok = ok;
        if (this.handle) {
            const handle = this.handle;
            this.handle = null;
            this.value = handle.getValue();
            handle.destroy();
        }
        this.renderProxy();
    }

    destroy(): void {
        this.handle?.destroy();
        this.handle = null;
        this.slot.remove();
    }

    private renderProxy(): void {
        this.slot.empty();
        const proxy = this.slot.createDiv({ cls: 'rv-editor-proxy rv-md' });

        if (this.readOnly) {
            proxy.addClass('is-readonly');
            if (this.ok !== undefined) proxy.addClass(this.ok ? 'is-correct' : 'is-wrong');
        } else if (this.disabled) {
            if (this.ok !== undefined) proxy.addClass(this.ok ? 'is-correct' : 'is-wrong');
        } else {
            proxy.addClass('is-clickable');
            proxy.addEventListener('click', () => this.mountEditor());
        }

        if (this.value.trim()) {
            void MarkdownRenderer.render(this.app, this.value, proxy, '', this.component);
        } else {
            proxy.createSpan({ cls: 'rv-editor-placeholder', text: this.placeholder });
        }
    }

    private mountEditor(): void {
        this.slot.empty();
        this.handle = createEmbeddableEditor({
            app: this.app,
            component: this.component,
            container: this.slot,
            value: this.value,
            placeholder: this.placeholder,
            inputMode: this.inputMode,
            onChange: (v) => {
                this.value = v;
                this.onChangeCallback(v);
            },
            onBlur: () => this.demount(),
        });
        this.handle.focus();
    }

    private demount(): void {
        if (!this.handle) return;
        this.value = this.handle.getValue();
        this.onChangeCallback(this.value);
        this.handle.destroy();
        this.handle = null;
        this.renderProxy();
        this.onBlurCallback?.();
    }
}
