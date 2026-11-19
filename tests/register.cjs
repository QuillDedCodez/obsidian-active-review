/**
 * Runtime stub for the `obsidian` package (types only on npm).
 * Tests only exercise pure logic, so the stub just needs to be loadable.
 */
const Module = require('module');

// Popout-window helpers used by main.ts; Node has no `window` global.
globalThis.window = globalThis;

const originalLoad = Module._load;
const noop = () => {};

class StubClass {
    constructor() {}
}

class Modal {
    constructor(app) {
        this.app = app;
        this.contentEl = { empty: noop, createEl: () => ({}), createDiv: () => ({}) };
        this.modalEl = { addClass: noop };
    }
    open() {}
    close() {}
}

class Notice {
    constructor() {}
    setMessage() {}
    hide() {}
}

const stub = new Proxy(
    {},
    {
        get(_target, prop) {
            if (prop === '__esModule') return true;
            if (prop === 'normalizePath') {
                return (p) =>
                    String(p)
                        .replace(/\\/g, '/')
                        .replace(/^\/+|\/+$/g, '');
            }
            if (prop === 'setIcon') return noop;
            if (prop === 'debounce') {
                return (fn, _timeout, _resetTimer) => {
                    let handle = null;
                    return (...args) => {
                        if (handle !== null) clearTimeout(handle);
                        handle = setTimeout(() => {
                            handle = null;
                            fn(...args);
                        }, 0);
                    };
                };
            }
            if (prop === 'Modal') return Modal;
            if (prop === 'Notice') return Notice;
            if (prop === 'MarkdownRenderer') return { render: async () => {} };
            return StubClass;
        },
    },
);

Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'obsidian') return stub;
    return originalLoad.call(this, request, parent, isMain);
};
