# Active Review — Agent Guide

## Project overview

Active Review is an Obsidian community plugin that turns Markdown notes in the
vault's review folder into interactive quiz sessions. Notes supply questions,
answers, distractors, definitions, and explanations; the plugin draws randomized
values, grades multiple-choice and typed answers (including numeric, text,
multi-value, and quantity-aware answers), and writes local session history.

- Plugin ID: `active-review` (never change it after release).
- Version: `2.0.0`; minimum Obsidian version: `1.13.0`.
- Entry point: `src/main.ts` → bundled to `main.js`.
- Release artifacts: `main.js`, `manifest.json`, `styles.css`.
- Local-only: no network requests, no telemetry, no remote code.

## Repository layout

| Path | Role |
|---|---|
| `dev-active-review/` | Canonical development copy. Edit sources, tests, docs tooling, and build config here. |
| `obsidian-active-review/` | Submission/final copy: the published plugin repository. Maintained as a standalone folder (can be copied to Windows/macOS/Linux and built there). |
| `dev Plugin Docs/` | Authored documentation source (OpenCode/dev workspace). Synced to the submission copy as `Plugin Docs/` by the dev build. |
| `Final Adjusted Submission Ready/` | Windows reference snapshot only; not a build target. |

Rules:

- Treat `dev-active-review/` as the source of truth for `src/`, `tests/`,
  `styles.css`, and build configuration.
- Do not hand-edit generated `main.js`. Rebuild it instead.
- The submission copy ships the same `src/`, `tests/`, and build configuration as
  dev, plus generated artifacts (`main.js`) and release metadata.
- Remove Windows `*:Zone.Identifier` files before committing; they are metadata,
  not project files.

## Build workflows

### Dev/OpenCode workflow (syncs the submission folder)

Run from the workspace:

```bash
cd dev-active-review && npm run build && cd ..
```

`scripts/build.mjs` is cross-platform (Windows, macOS, Linux):

1. Checks Node 18+/npm and `package-lock.json`; installs from the lockfile if
   needed (`npm ci --ignore-scripts`, or with `--clean`).
2. Audits production dependencies.
3. Runs `npm run verify` (type-check, lint, and tests).
4. Bundles production `main.js` and checks artifacts.
5. Syncs `src/`, `tests/`, config, generated artifacts, and `dev Plugin Docs/`
   (as `Plugin Docs/`) into `../obsidian-active-review/`.

Options: `--clean`, `--no-sync`, `--no-docs`. Set `OUT_DIR` / `DOCS_OUT` /
`DEV_DOCS` to override paths. Docs sync and folder copying are dev/OpenCode-only
steps.

### Submission/final workflow (standalone, no copying)

Inside `obsidian-active-review/`:

```bash
npm ci            # once, if needed
npm run build
```

`scripts/build-submission.mjs` is the trimmed, general-purpose build for the
published repository. It runs on Windows, macOS, and Linux and does not copy
files to other folders or manage docs:

1. Checks Node 18+/npm and `package-lock.json`; auto-runs
   `npm ci --ignore-scripts --no-audit --no-fund` if `node_modules` is missing.
2. Audits production dependencies (`npm audit --omit=dev --audit-level=high`).
3. Runs `npm run verify` (type-check, lint, and tests).
4. Bundles production `main.js` and checks artifacts.

The folder can be copied to another machine and built independently.

## Commands

| Command | Action |
|---|---|
| `npm run dev` | esbuild watch mode with inline source maps. |
| `npm run build` | Dev: full verified build + sync. Submission: standalone verified build (no sync/docs). |
| `npm run build:bundle` | Production bundle only. |
| `npm run verify` | Type-check, lint, and run the full test suite. |
| `npm run typecheck` | `tsc --noEmit` only. |
| `npm run lint` | ESLint over `src/`. |
| `npm test` | Compile `src/` + `tests/` and run the harness (cross-platform). |

## Environment and tooling

- Node.js 18+ (current LTS recommended); npm.
- Bundler: esbuild (`esbuild.config.mjs`).
- TypeScript, ESLint, and `eslint-plugin-obsidianmd`.
- `.npmrc` pins the public registry, `save-exact=true`, blocks install scripts,
  and sets `tag-version-prefix=""`. Prefer `npm ci` over `npm install`.
- `.gitattributes` enforces LF for text files to keep bundles and artifacts
  consistent across platforms.

## TypeScript requirements

`tsconfig.json` is intentionally strict. Do not weaken it to make a build pass.

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- Target/module: `ES2021` / `ESNext`
- `esModuleInterop` and `allowSyntheticDefaultImports` are enabled for the test
  harness and default imports.

When strict checks fail:

- Add an explicit bounds/existence guard before indexed access.
- Use a non-null assertion (`!`) only for an invariant the code just proved.
- Widen a parameter’s type when a runtime guard legitimately receives
  `undefined`; do not silence the error with `any`.
- Prefer small typed helpers over casts. Avoid `@ts-ignore`.

## Source layout

| Path | Responsibility |
|---|---|
| `src/main.ts` | Plugin lifecycle, settings, scan orchestration, view/ribbon registration. |
| `src/constants.ts` | `SessionConfig`, defaults, IDs, limits. |
| `src/embed/` | `active-review` code-block parsing/resolution, embedded start card and controller. |
| `src/math/` | LaTeX-subset tokenizer, evaluator, symbolic rendering, formatting. |
| `src/math/units/` | Unit registry, parsing, conversion, currency, quantity formatting. |
| `src/math/normalize/` | Answer-text and expression normalization used by grading. |
| `src/parser/` | Sections, properties, definitions, questions, answers, distractors, explanations, placeholders. |
| `src/session/` | Seeded generation, draws, distractors, grading, ordering, timers, hydration. |
| `src/settings/` | Settings tab and declarative setting pages. |
| `src/ui/` | View, screens, cards, modals, Markdown editing/rendering, presets, history, manage tools. |
| `src/util/` | Path, text, and clipboard helpers. |
| `src/vault/` | Incremental scanner, compressed index, session log/I/O, preset operations. |
| `tests/` | TypeScript test harness and pure-module suites. |

Keep `main.ts` focused on lifecycle and orchestration. Put feature logic in the
owning module and split files that grow beyond a single responsibility.

## Obsidian API and lifecycle rules

- Register every command with `this.addCommand(...)` and keep command IDs stable.
- Register events, DOM listeners, intervals, views, and code-block processors
  with the `register*` helpers so unload is leak-free.
- Persist settings with `loadData()` / `saveData()`; merge with defaults and
  validate before use.
- Keep `minAppVersion` accurate when adopting newer APIs.
- Mark the plugin desktop-only only if it imports Electron/Node-only APIs;
  otherwise preserve mobile compatibility.
- Do not log vault contents or personal data. Development diagnostics may use
  `console.warn` / `console.error`; avoid `console.log` in shipped code.

## Testing

- `tests/` compiles into `tests/.build` and runs through the stubbed `obsidian`
  module; no fixture vault is required.
- `npm test` and `npm run verify` are Node/TypeScript-only and work the same on
  Windows, macOS, and Linux.
- Run `npm run verify` after any code change.
- Add or update a focused test for parser, grading, unit, index, or session
  logic when behavior changes.
- Manual check: copy `main.js`, `manifest.json`, and `styles.css` into
  `<Vault>/.obsidian/plugins/active-review/`, reload Obsidian, and enable the
  plugin.

## Versioning and release

Keep these three values synchronized:

1. `manifest.json` → `version` and `description` (user-facing).
2. `package.json` → `version` and `description`.
3. `versions.json` → `{ "<version>": "<minAppVersion>" }`.

Release checklist:

- Run `npm run verify`, then a production build.
- Confirm `main.js` has no source map, no absolute local paths, and no CRLF.
- Confirm `styles.css` is present and current.
- Commit the submission folder, then create a GitHub release whose tag exactly
  matches `manifest.json`’s version (no leading `v`).
- Attach `main.js`, `manifest.json`, and `styles.css` as individual release
  assets.

## UX and copy

- Sentence case for headings, buttons, and labels.
- Clear, action-oriented imperative copy; use **bold** for literal UI labels.
- Use arrow notation for navigation, e.g. **Settings → Community plugins**.
- Keep in-app strings short and consistent.

## Security and privacy

- Default to local/offline operation; do not add network calls without a
  user-facing reason and documentation.
- No hidden telemetry, ads, or remote code. Never fetch or evaluate scripts.
- Read/write only what the feature needs, inside the vault.
- Disclose any external service, data sent, and risk in `README.md` and
  settings.
- Avoid deceptive patterns and spammy notices.

## Agent do / don’t

**Do**

- Read the existing module and surrounding patterns before changing behavior.
- Keep edits surgical and consistent with the file’s existing style.
- Run `npm run verify` and a production build before declaring completion.
- Preserve local-only operation and established command/settings IDs.

**Don’t**

- Don’t weaken `tsconfig.json`, ESLint rules, or artifact checks to pass a build.
- Don’t commit `node_modules/`, `cache/`, `tests/.build/`, or `data.json`.
- Don’t introduce cloud services, analytics, or telemetry without explicit
  opt-in and documentation.
- Don’t rewrite or reformat unrelated files.
