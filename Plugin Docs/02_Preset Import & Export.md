# Preset Import & Export — Manage Questions and Session Configuration

**Baseline checkpoint.** This document describes the preset transfer code in `obsidian-active-review/` at plugin version `2.0.0` (manifest id `active-review`, display name Active Review, `minAppVersion` `1.13.0`). It is verified against the current source tree; where an older description differs, the code wins.

**Document authority.** This file owns the two JSON manifest formats, their validation, preview, apply, save, and undo behaviour. It does not own the note format (see [[01_Active Review Authoring Rule Book]]) and does not own session runtime semantics, storage layout, or overall architecture (see [[00_Active Review Plugin Workflow]]).

**Scope rule.** Only behaviour present in the current code is described. Both transports are local: they read and write vault files and `data.json`, and make no network requests.

## 1. Scope, authority, and the two families

The plugin has **two independent preset families** with separate stores, separate formats, and separate modals. Neither transport knows about the other except for one cross-reference: a session preset records **the name** of the Manage Questions preset it uses.

| | Manage Questions presets | Session Configuration presets |
|---|---|---|
| Stored in | `data.json` → `managePresets[]` | `data.json` → `sessionPresets[]` |
| Selects | a set of question note paths | one full `SessionConfig` + answer mode |
| Format id | `active-review/manage-presets` | `active-review/session-presets` |
| Version | `1` | `1` |
| Entry point | Review start screen → `Manage questions` → toolbar `Manage question presets` → `Manage Question Presets` modal; or Settings → `Manage Question Presets` | Start screen `Session Configuration` header → `Manage Session Presets`; or Settings → `Manage Session Presets` |
| Writes vault files | **Yes** — moves notes, creates folders, rewrites `rv-category` | **No** — `data.json` only |
| Undo | Yes, one step (`Undo last import`, journal in `data.json`) | Yes, one step (`Undo last import`, whole-list snapshot in `data.json`) |
| Size limit | 5 MB, compared against UTF-16 `text.length` | 1 MB, compared against UTF-8 bytes via `TextEncoder` |
| Entry limits | 10,000 files, 500 presets | 200 presets |

A stored preset is exactly `{ id, name, showOnStart, config }` (session) or `{ id, name, showOnStart, includedPaths }` (Manage). A session manifest entry is `{ name, mode, managePresetName, showOnStart, config }`.

The only command is `open` (`Open quiz`). Import and export are UI actions inside the preset managers, not commands.

### 1.1 What each manifest carries

| Item | Manage manifest | Session manifest |
|---|---|---|
| Preset names | yes | yes |
| Preset ids (`preset-…`) | **no** | **no** |
| Preset membership (which files) | yes, as review-relative paths | yes, as a Manage **name** |
| Folder layout | yes (`folders[]`, `targetFolder`) | no |
| Session configuration fields | no | yes (19 fields) |
| Answer mode (`choice` / `typed`) | no | yes |
| `showOnStart` | yes | yes (written, but not restored on import — see §10.2) |
| `seed` | no | yes (part of config) |
| Question Markdown / stems / answers / distractors / explanations | **never** | **never** |
| `rv-category` frontmatter | **never** (rewritten on move instead) | **never** |
| Session logs, answers, history | **never** | **never** |
| Last custom selection | **never** | **never** |
| Undo journal | **never** | **never** |

## 2. Entry points and the preset-manager UI

**Manage Questions.** Two routes open the same modal, `QuestionPresetsModal` (title `Manage Question Presets`): (1) Review view → start screen → `Question Presets` row → `Manage questions` button → `Manage questions` modal toolbar → `Manage question presets`; (2) Settings → `Manage Question Presets` page, a `SettingPage` that embeds `QuestionPresetManager` directly.

**Session Configuration.** Two routes open `SessionPresetsModal` (title `Manage Session Presets`): (1) Review view → start screen → `Session Configuration` section header → `Manage Session Presets` link button; (2) Settings → `Manage Session Presets` page, a `SettingPage` that embeds `SessionPresetManager`.

The Settings page description still reads “Rename, duplicate, delete, pin, import, or export saved session presets”. “pin” is stale copy in that string: no pin control or pinned state exists. Hide/show-on-start is the only visibility control.

### 2.1 Shared list UI

Both managers use `PresetManager`:

| Element | Behaviour |
|---|---|
| Toolbar | `Export presets…` (disabled when the list is empty), `Import presets…`, then family extras |
| Family extra | `Undo last import`, disabled unless that family's journal exists |
| Selection | Per-row checkbox; a bulk bar appears with `N selected`, `Delete selected`, and `Clear selection` |
| Row | Drag handle (`=`, “Drag to reorder”), preset name, family detail, row actions |
| Row actions | `Rename`, `Hide on start` / `Show on start`, family extras (Session: `Duplicate`), `Delete` |
| Details | Manage: `N file(s)`. Session: `1 at a time` / `All at once`, then `All` or a count, then `Typed` / `Multiple Choice` |
| Empty state | Manage: `No question presets yet. Create one from Manage Questions on the start screen.` Session: `No session presets yet. Save one from the quiz view via "+ Save as new" in the Session presets row.` |
| Reorder | Dragging a row persists the new array order immediately; the list is not re-rendered while a row is held or its order is being saved, in the modal and the settings page alike |
| Rename | Trimmed; empty or case-insensitive duplicate names are rejected (`A <noun> with that name already exists.`) |
| Delete | `ConfirmModal`, destructive, then save and `refreshIdleViews` |

`Export presets…` and `Import presets…` switch the manager into an in-place pane with a `← Back to presets` button; neither opens a separate modal. The modal chrome still has its own close control.

## 3. Shared preset-manager shell

### 3.1 Export pane

`PresetExportPane` owns layout, selection, and file I/O. Both families supply an item list, summary callback, `build()` callback, save title, default file name, and success text.

| Element | Behaviour |
|---|---|
| `Select all` / `Select none` | Replace or clear the selection; disabled when there are no items |
| Item rows | Checkbox + preset name + family detail |
| Initial selection | **Every** preset is selected when the pane opens |
| Summary | Live count: Manage `N preset(s) · M unique file(s)`; Session `N preset(s) selected` |
| `Copy JSON` | `JSON.stringify(manifest, null, 2)` → clipboard; success notice; disabled at zero selection |
| `Save JSON` | Opens the single-field save prompt; disabled at zero selection |
| Warnings | Collapsible `N export warning(s)` block, rendered **after** a copy or save, because the manifest is built then |
| Empty state | `No Manage Questions presets available to export.` / `No session presets available to export.` |

Copying writes nothing to the vault. The build callback runs on each copy or save, so `exportedAt` is regenerated each time.

### 3.2 Import pane

`PresetImportPane<M, P>` is abstract; `QuestionImportPane` and `SessionImportAdapter` supply family behaviour.

| Element | Behaviour |
|---|---|
| `JSON import` textarea | Paste target; `spellcheck="false"`; placeholder names the format |
| `Load JSON file` | Hidden `<input type="file" accept=".json,application/json">`; reads text into the textarea and immediately previews |
| `Preview import` | Parses and builds the preview; the only path that fills the preview panel |
| `Preset action` select | `add` / `update` (Manage also `structure`); initial mode is `add` |
| Mode tooltip | Only the first option that defines a `title` is applied to the `<select>` as a whole |
| Preview panel | `Preview` heading plus family content; initially `Paste a manifest or load a JSON file, then choose Preview import.` |
| `Cancel` | Modal chrome only; no writes |
| `Apply import` | Disabled until a preview exists and `canApply(preview, mode)` is true |
| `← Back to presets` | Returns to the list; discards the pane state |

Mode change only calls `updateApplyState()`. Because neither preview builder ever populates `preview.errors`, the configured `hasErrors` hook never disables Apply; enablement is purely `canApply` plus a parsed preview.

### 3.3 Lifecycle and side effects

```text
paste/load → parse (errors stop here) → build preview → user edits (Manage only)
          → Apply → confirm → writes → notice → applied render → list
```

Parsing and previewing are side-effect free for **both** families. For Manage Questions the preview performs vault *reads* only (`fileExists`, question index); all writes happen inside apply. Session preview reads only stored Manage preset names and the last-custom selection.

### 3.4 Apply feedback and modal behaviour

On `Apply import`: `confirm(preview, mode)` returns title, message, label, and destructive flag; `ConfirmModal` opens; on confirm the button is disabled and reads `Applying…`; `apply()` runs and returns `{ notice, errors }`; a `Notice` is shown; `renderApplied()` swaps the preview panel to an `Import applied` heading, disables the inputs and mode select, and sets the button to `Applied`; then `onApplied` runs.

**Both families immediately switch the manager back to list mode and re-render.** The modal stays open; the import pane, including its applied summary, is destroyed by that re-render. The applied panel is therefore a transient frame, not durable feedback. The `Notice` is the only feedback the user can rely on. `onApplied` in `QuestionPresetManager.renderImportView` starts a full `scanAll()` fire-and-forget, refreshes idle views, then sets `this.mode = 'list'` and re-renders; `SessionPresetManager.renderImportView` does the same without the scan. The harness does not auto-close the modal.

When an exception escapes `apply()`, the pane calls `renderErrors` with `Apply failed: <message>` and also shows `Import failed: <message>`; Apply stays disabled. File-read errors during `Load JSON file` render `Could not read file: <message>`.

## 4. Save-file rules

`Save JSON` opens `openSavePresetPrompt` (`TextPromptModal`), which rejects an empty trimmed value. The prompt's initial value is a UTC date stamp:

| Transport | Default file name | Prompt title |
|---|---|---|
| Manage Questions | `manage-presets-YYYY-MM-DD` | `Save Manage Questions manifest` |
| Session Configuration | `session-presets-YYYY-MM-DD` | `Save session preset manifest` |

The accepted name is trimmed by the prompt, then normalised in `saveJson`:

1. a trailing `.json` is stripped, case-insensitively;
2. every character in `\ / : * ? " < > |` becomes `-`;
3. runs of whitespace become `-`;
4. if the result is empty, the fallback is `<defaultFileName>-<epoch ms>`.

The fallback is effectively unreachable in normal use because the prompt rejects an empty name. It can still trigger if the user types exactly `.json` (or `.JSON`): the prompt sees a non-empty string, step 1 empties it, and step 4 runs. Treat the epoch branch as a defensive path.

The manifest is written as pretty-printed JSON (2-space indent) to `<reviewDir>/<name>.json` through `app.vault.create`. If that path already exists, `-2`, `-3`, … are appended to the base until a free path is found. Notices: success `Saved <path>.`; failure `Could not save manifest: <message>`. The saved file is an ordinary vault file inside the review folder; the scanner ignores it because it does not end in `.md`.

Copy feedback is separate: `Manage Questions manifest copied to clipboard.`, `Session preset manifest copied to clipboard.`, and the shared fallback `Could not copy to clipboard.` `CopyButton.copyText` first tries `navigator.clipboard.writeText`, then falls back to a hidden textarea and `execCommand('copy')`.

## 5. Manage manifest schema and export

### 5.1 Export selection

`Manage questions` modal toolbar → `Manage question presets` → `Export presets…`. Items are the stored presets (`managePresets[]`). The virtual selections `All questions` and `Last custom` are **not** presets and never appear. An extra checkbox, `Include empty folders`, sits above the summary and starts **checked**.

### 5.2 Manifest schema

```json
{
  "format": "active-review/manage-presets",
  "version": 1,
  "exportedAt": "2026-11-10T07:12:44.518Z",
  "source": { "reviewRoot": "review", "pathMode": "relative" },
  "folders": [
    { "sourcePath": "Algebra", "targetPath": "Algebra" },
    { "sourcePath": "Algebra/Linear", "targetPath": "Algebra/Linear" }
  ],
  "files": [
    {
      "sourcePath": "Algebra/Linear/rv-matrix-rank.md",
      "targetFolder": "Algebra/Linear",
      "targetName": "rv-matrix-rank.md"
    },
    {
      "sourcePath": "Algebra/rv-quadratic-roots.md",
      "targetFolder": "Algebra",
      "targetName": "rv-quadratic-roots.md"
    }
  ],
  "presets": [
    {
      "name": "Linear algebra core",
      "showOnStart": true,
      "files": [
        "Algebra/Linear/rv-matrix-rank.md",
        "Algebra/rv-quadratic-roots.md"
      ]
    }
  ]
}
```

### 5.3 Field reference

Top level:

| Field | Type | Notes |
|---|---|---|
| `format` | string | Constant `active-review/manage-presets` |
| `version` | number | Constant `1` |
| `exportedAt` | string | ISO timestamp of the export |
| `source.reviewRoot` | string | Review folder at export time. **Informational only** — import never uses it for matching |
| `source.pathMode` | string | Always rewritten to `relative` by the parser; not used otherwise |
| `folders[]` | array | Folders the import should create |
| `files[]` | array | The move list; also the referencing vocabulary for `presets[].files` |
| `presets[]` | array | `{ name, files, showOnStart }` where `files` are `sourcePath` values |
| `presets[].showOnStart` | boolean | Defaults to `true`; hidden presets stay saved and remain usable outside the start screen. A non-boolean value is a parse **error**, not a coercion |

`files[]` entry:

| Field | Type | Notes |
|---|---|---|
| `sourcePath` | string | Review-relative path ending in `.md`; matched against local questions |
| `targetFolder` | string | Review-relative folder; `""` means the review root |
| `targetName` | string, optional | File name ending in `.md`. Export always writes it (the current basename). Import defaults to `basename(sourcePath)` when absent |

`presets[]` entry:

| Field | Type | Notes |
|---|---|---|
| `name` | string | Non-empty after trimming; unique case-insensitively within the manifest |
| `files` | string[] | `sourcePath` values; exact duplicates removed |
| `showOnStart` | boolean, optional | Defaults to `true`. Export always writes it. Any non-boolean (including `"true"` or `0`) rejects the whole manifest |

### 5.4 How the manifest is built

For every selected preset and every `includedPaths` entry, convert the path to review-relative (a path outside the review folder is dropped with a warning), drop non-`.md` paths with a warning, and normalise the relative path, dropping failures with a warning. Surviving paths are collected per preset (exact-string de-duplicated) and added to a **case-insensitive** file map keyed by `sourcePath`; the first spelling wins, and each file records `targetFolder` = its folder and `targetName` = its basename. `files[]` is sorted by `sourcePath` (`localeCompare`). `folders[]` is the sorted union of every ancestor folder of every emitted file and, when `Include empty folders` is checked, every current review folder (normalised; malformed entries are ignored); `sourcePath` and `targetPath` are always identical because the manifest describes the current layout, not a remap. The preset array preserves the order of the selected presets, and file order inside each preset preserves `includedPaths` order.

### 5.5 Export warnings

| Warning | Cause |
|---|---|
| `<preset>: path is outside the review folder: <path>` | Preset references a note outside the current review root (for example after the review folder setting changed, or a stale path) |
| `<preset>: ignored non-Markdown path: <path>` | Preset holds a non-`.md` path |
| `<preset>: <path error> (<path>)` | Path normalisation failed |

Dropped files still leave their preset entry in the manifest, possibly with an empty `files` array. Such a preset is exported but imports no files (see §8). Question content (stems, answers, distractors, explanations), `rv-category`, session logs, `lastCustomSelection`, preset ids, and the Manage-import journal are never exported.

## 6. Manage import validation

### 6.1 Modes

| Mode | Label | Moves files | Presets |
|---|---|---|---|
| `add` | `Add new` | yes | Adds every manifest preset; an existing name is suffixed ` (2)`, ` (3)`, … |
| `update` | `Update by name` | yes | For a case-insensitive name match: replaces that preset's `includedPaths` in place (same `id`, same spelling). Non-matching names are added |
| `structure` | `Move files only` | yes | No preset writes at all |

Initial mode is `add`. Existing presets are **always** path-remapped for the moves, including in `structure` mode, and `lastCustomSelection` is remapped too. The select's tooltip is `Add suffixes duplicate names; update preserves preset IDs and replaces their paths.`

### 6.2 Parse and validation

`parseManagePresetManifest(text)` returns `{ manifest | null, errors, warnings }`. **Any** error means `manifest === null`; the import is all-or-nothing at the format level. There is no partial manifest.

| Check | Failure result |
|---|---|
| `text.length` ≤ 5,242,880 UTF-16 code units | `Manifest is larger than 5242880 bytes.` |
| Valid JSON | `Invalid JSON: <message>` |
| Root is an object | `Manifest must be a JSON object.` |
| `format === "active-review/manage-presets"` | `Unsupported format: <value>` |
| `version === 1` | `Unsupported version: <value>` |
| `folders` optional; if present, an array of objects with string paths | `folders must be an array.` / `folders[] contains a non-object entry.` / `folders: <path error>` |
| `files` optional; if present, an array, ≤ 10,000 entries | `files must be an array.` / `files exceeds the 10000 entry limit.` / `files[] contains a non-object entry.` |
| `sourcePath` normalises and ends `.md` | `files: file path must end in .md` and related path errors |
| `targetFolder` normalises (may be empty) | `files: path must not contain "." or ".."` and related |
| `targetName`, when present, is a bare `*.md` file name | `files: targetName must be a file name` / `files: targetName must end in .md` |
| `sourcePath` unique case-insensitively | `duplicate file sourcePath: <path>` |
| `presets` optional; if present, an array, ≤ 500 entries | `presets must be an array.` / `presets exceeds the 500 entry limit.` |
| Preset `name` is a non-empty string | `presets[] contains a non-string name.` / `presets[] contains an empty name.` |
| Preset names unique case-insensitively | `duplicate preset name: <name>` |
| `presets[].files` is an array of valid `.md` paths | `presets[<name>].files must be an array.` / `presets: <path error>` |
| `presets[].showOnStart`, when present, is a boolean | `presets[<name>].showOnStart must be a boolean.` (hard error; the manifest is rejected) |
| At least one file or preset exists | `Manifest has no files or presets.` |

Rules applied to accepted values: `sourcePath` / `targetFolder` / `targetName` must be **relative** (no leading `/`, no `C:`-style prefix, no NUL, no `.`/`..` segment); backslashes become `/` and empty segments are removed; `readString` rejects objects and numbers with `<field> must be a string`; unknown fields are ignored everywhere (forward compatibility). `source.reviewRoot` missing is only a **warning**: `source.reviewRoot is missing; using the current vault root label.` `exportedAt` missing falls back to the current time, and `source.pathMode` is rewritten to `relative` (a different input value is not rejected).

Note the size asymmetry: this parser compares `text.length` (UTF-16 code units) while its message says “bytes”, whereas the session parser measures real UTF-8 bytes. See §13.

## 7. Manage preview, matching, collisions, manual resolution

### 7.1 Target path computation

For each `files[]` entry:

```text
targetPath = targetFolder === "" ? targetName : targetFolder + "/" + targetName
targetName defaults to basename(sourcePath)
```

The absolute vault target is `<reviewDir>/<targetPath>`. The source of the move is the **matched local question**, not necessarily `sourcePath`, so a note that lives elsewhere but matches by basename or folder suffix is moved from its real location.

### 7.2 Preview row statuses

| Status | Meaning | Apply behaviour |
|---|---|---|
| `move` | Matched locally; source ≠ target; target free | Renamed to the target |
| `noop` | Matched locally and already at the target path | Nothing moved; target recorded for preset resolution |
| `missing` | No local question matched | Skipped (can be resolved manually) |
| `ambiguous` | Several local basenames match and the suffix score cannot break the tie | Skipped (resolvable manually) |
| `conflict` | Target path exists, or two manifest files target the same path | Skipped unless the collision policy is `suffix` |
| `invalid` | Path normalisation failed, or the target is inside the sessions folder | Skipped |

Exact messages:

| Status | Message |
|---|---|
| `move` | `Move from <matchedRelativePath>` |
| `noop` | `Already at the target path.` |
| `ambiguous` | `<N> local filename matches; choose one.` |
| `missing` | `No matching question note found.` |
| `conflict` (target exists) | `Target path already exists.` |
| `conflict` (duplicate manifest target) | `Another manifest file targets the same path: <previousSourcePath>` |
| `invalid` (sessions folder) | `Target is inside the sessions folder.` |
| `invalid` (path error) | the raw normalisation error, e.g. `path must not contain "." or ".."` |

Rows are keyed by manifest `sourcePath`. Each row stores `targetPath`, `matchedSourcePath`, `candidates`, `manualMatch`, and `collisionPolicy` (`skip` by default). Folders declared in `folders[]` are added to `targetFolders` unless empty or inside the sessions folder. Targets inside the sessions subfolder are rejected per file as `invalid`.

Statuses are assigned in order, and a later check can relabel an earlier one: the duplicate-target test runs after the sessions-folder test, so a row that is `invalid` because its target is inside the sessions folder becomes `conflict` (`Another manifest file targets the same path: …`) when an earlier manifest file already claims that path. The matching pass only runs for rows that are neither `invalid` nor `conflict`, but a row that ends up `invalid` or `conflict` still records `matchedSourcePath` when a local note was matched, and still contributes its folder to `targetFolders`.

### 7.3 Matching algorithm

The preview indexes every scanned question (including notes whose `rv-category` does not match their folder) by review-relative path, lower-cased, and by basename, lower-cased → list of questions. For each `sourcePath`: (1) an **exact path** case-insensitive relative-path match wins immediately; (2) a **unique basename** wins if exactly one local note has that file name; (3) **folder-suffix scoring** compares the manifest entry's folder segments with each candidate's folder segments **from the end**, case-insensitively, and counts the common suffix length — a candidate wins only if its score is `> 0` and it is the single best score; (4) otherwise the row becomes `ambiguous` and lists every candidate, or `missing` when there is no basename match at all.

Once a source is known: same path → `noop`; target exists → `conflict`; else `move`. Consequence: paths are portable across vaults that use a different review root, as long as file names (or trailing folder names) still identify the notes.

### 7.4 Manual resolution and collision policy

`ambiguous` and `missing` rows render a dropdown (`Choose local question…`) with the candidate list, or with every `.md` question path when there were no candidates. Choosing a path calls `resolveImportRow`, so the row becomes `noop`, `conflict`, or `move`, and its collision policy resets to `skip`. Clearing the selection restores `ambiguous`/`missing`.

The dropdown is rendered whenever `row.manualMatch === true`. `resolveImportRow` does **not** clear `manualMatch`, so the dropdown stays visible after a selection and its selected value is `row.matchedSourcePath`. This is deliberate current behaviour, not a vanished control.

Every `conflict` row renders a second dropdown:

| Choice | Effect | Message written |
|---|---|---|
| `Skip collision` (default) | Row is skipped on apply | `Target exists; skip this row.` |
| `Move with suffix` | Apply renames into the first free `<stem>-2.md`, `<stem>-3.md`, … in the target folder | `Target exists; apply will use a numeric suffix.` |

Both dropdowns re-render the preview, recount statuses, and re-evaluate preset resolution and Apply enablement.

### 7.5 Preset resolution in the preview

The preview panel renders count pills (total files plus one per non-zero status), a `Files` section (warnings, then one row per entry with status badge, `sourcePath → targetPath`, message, dropdowns, candidates), a `Target folders` section (sorted, or `No target folders in this manifest.`), and a `Presets in manifest` section (`New`/`Existing` badge, name, `<resolved>/<files> resolved`, and an `N unresolved` marker).

Each `presets[]` entry is `Existing` when a stored preset matches its name case-insensitively. The **initial** preview counts a preset file as resolved only for `move` and `noop`. `recountImportPreview` (run after any manual edit) also counts a `conflict` row whose policy is `suffix`. The initial render can therefore show fewer resolved files than a later recount.

The preview adds `Session history is not updated by this preview. Moving questions may make old session frozen paths stale.` whenever at least one row is `move` or `conflict`.

`preview.errors` is initialised to `[]` and never appended to, so the errors box never renders and `hasErrors` never blocks Apply. The builder also contains `Some manifest files could not be represented in the preview.`, which is unreachable because every manifest file pushes exactly one row, whether it succeeds or throws.

## 8. Manage apply and counters

`applyManageImport` treats the preview as the plan and never re-asks the user.

1. **Create target folders.** Every folder in `preview.targetFolders` is created if missing (`ensureFolder`). Created absolute paths are recorded. This includes folders belonging to skipped rows and is not rolled back if later steps fail. A folder failure adds `Folder <folder>: <message>` and does not count as skipped.
2. **Move files, row by row.** `noop` rows record their resolved absolute path as the actual target. For `move` rows and `conflict` + `suffix` rows: the resolved source must still be a `TFile`, otherwise `<sourceRel>: source file is missing.` and the row is skipped; the target is re-checked at apply time, and if it now exists and the policy is `skip`, `<sourceRel>: target already exists (<targetPath>).`; with `suffix`, a free `-2`, `-3`, … target is chosen (`uniqueFileName`); the target folder is ensured, then `app.fileManager.renameFile` performs the move (Obsidian updates links pointing at the note); `rv-category` is rewritten from the target folder (`writeCategoryFrontMatter`), using the folder path relative to the review root or removing the key when the note lands in the root. If that write fails the move still counts, with `<targetPath>: moved, but rv-category could not be updated.`
3. **Remap existing state.** `pathMap` (absolute `from → to`) is applied to every stored preset and to `lastCustomSelection`, de-duplicating paths. A failure reports `Could not remap existing presets: <message>`.
4. **Preset writes** (skipped in `structure` mode). For each manifest preset, collect the resolved local targets of its `files` through the row map. A file with no row, or an unmoved row, contributes nothing; duplicates are removed. Zero resolved files → `Preset "<name>": no resolved files; not imported.`; existing name + `update` → `includedPaths` and `showOnStart` replaced in place; otherwise a new preset is pushed with a fresh id and `showOnStart` from the manifest, and when the name is taken, the suffixed name `Name (2)`, `Name (3)`, … A save failure reports `Could not save imported presets: <message>`.
5. **Save.** Stored presets are written only if at least one preset was added or updated. Moves and the path remap are already persisted by their own calls.

Preset `files` entries that are absent from `files[]` are silently dropped from the imported preset, because no row exists for them.

### 8.1 Result counters

| Counter | Meaning |
|---|---|
| `moved` | Files actually renamed |
| `skipped` | Rows left untouched (missing/ambiguous/conflict-skip/invalid/source errors/target races) |
| `foldersCreated` | Number of successful folder creations in step 1 |
| `createdFolders` | Absolute paths of those folders |
| `presetsAdded` / `presetsUpdated` | Preset writes |
| `errors[]` | Every non-fatal problem, in execution order |
| `pathMap`, `moves` | Absolute remap and move records, used for the journal |
| `presets` | Post-apply preset array (also when only moves happened) |

Apply never aborts halfway on a single bad row; it accumulates errors and continues. The Manage notice is `Import applied: N moved, N added, N updated, N errors.`

### 8.2 Side effects and limits

- **Session logs are not updated.** Frozen pools store paths, so moving a question makes old session logs stale. **`rv-category` is rewritten** from the target folder, which keeps the note listed in Manage Questions.
- **Files are moved, not copied.** Source paths disappear. No merge into an existing note: a collision is skipped or suffixed, and content is never overwritten.
- **A preview can go stale.** Targets are re-checked at apply time; a file that disappears becomes a skipped row with an error. **Apply does not close the modal**; the manager returns to the list (see §3.4).

## 9. Manage undo and the import journal

An import that changed anything writes a journal to `data.json` under `manageImportJournal`. “Changed” means `moves.length > 0` **or** `presetsAdded > 0` **or** `presetsUpdated > 0`. An import that only created folders, only remapped paths, or only produced errors does not write a journal and leaves the previous journal untouched. Only the **last** import is journalled; a new qualifying import overwrites it.

```ts
interface ManageImportJournal {
  createdAt: string;
  moves: {
    from: string;
    to: string;
    beforeCategory: string[];
    afterCategory: string[];
  }[];
  createdFolders: string[];
  presetsBefore: ManageQuestionPreset[];
  presetsAfter: ManageQuestionPreset[];
  lastCustomBefore: string[];
  lastCustomAfter: string[];
}
```

`createdAt` is an ISO timestamp. Categories are derived from the absolute move paths relative to the review root, not read from frontmatter. `from` and `to` are stored as absolute vault paths, so undo is tied to the review folder that was configured at import time: changing the review folder between an import and its undo makes the preflight fail or restore into the wrong root. If the journal write fails, apply appends `Import applied, but undo journal could not be saved: <message>`.

`Undo last import` is enabled only when a journal exists. Confirmation title: `Undo last Manage Questions import?`; message: `This reverses the recorded file moves, restores the previous preset arrays and last-custom selection, and restores rv-category. Created folders are left in place. Session logs are not changed.`; confirm label `Undo import`, destructive.

### 9.1 Preflight and reversal

Nothing is changed if any preflight check fails: every `move.to` must still be a `TFile` → `Cannot undo <to>: file no longer exists.`; every `move.from` must be free → `Cannot undo <to>: original path is occupied (<from>).` A blocked preflight returns `blocked: true`, `restored: 0`, all errors, and the still-existing created folders. The journal is **not** cleared, so the user can fix the obstruction and retry.

Moves are reversed in reverse order: re-create the source parent folder, `renameFile` back to `from`, then restore `rv-category` from `beforeCategory`. A category failure adds `<from>: restored, but rv-category could not be updated.` A rename failure adds `<to>: <message>`.

Only when the entire reversal produced **zero** errors are `presetsBefore` and `lastCustomBefore` written back. A metadata failure adds `Could not restore preset metadata: <message>`. Created folders are never deleted. `foldersLeft` is computed as every journal folder that still exists in the vault, so the count is “folders still present”, not strictly “empty folders”.

### 9.2 Notices

| Situation | Notice |
|---|---|
| Clean undo | `Undo complete: N file(s) restored[; K empty folder(s) left].` |
| Errors after some reversal | `Undo incomplete: R restored; E error(s). <first error>` |
| Journal save/undo throw | `Undo failed: <message>` |
| No journal (defensive) | `No Manage Questions import to undo.` |

The clean-undo path clears the journal (`saveManageImportJournal(null)`); the incomplete path keeps it. The “no journal” notice is reachable only through `undoLastImport()` directly, because the UI disables the button; it is defensive rather than a normal user-facing message.

## 10. Session manifest and config field reference

### 10.1 Manifest schema

```json
{
  "format": "active-review/session-presets",
  "version": 1,
  "exportedAt": "2026-11-10T07:13:02.004Z",
  "presets": [
    {
      "name": "Timed drill",
      "mode": "typed",
      "managePresetName": "Linear algebra core",
      "showOnStart": true,
      "config": {
        "presentation": "one",
        "choiceCount": 4,
        "count": 20,
        "trim": "rand",
        "order": "priority-random",
        "seed": 0,
        "submitMode": "any",
        "gradeMode": "immediate",
        "passScore": 80,
        "timerSessionMode": "on",
        "timerSessionSeconds": 900,
        "timerSessionWarningSeconds": 60,
        "timerQuestionMode": "on",
        "timerQuestionSeconds": 45,
        "timerQuestionWarningSeconds": 10,
        "stopwatchSession": false,
        "stopwatchQuestion": true,
        "navigator": true,
        "allowFlag": true
      }
    }
  ]
}
```

### 10.2 Field reference

| Field | Type | Notes |
|---|---|---|
| `format` | string | Constant `active-review/session-presets` |
| `version` | number | Constant `1` |
| `exportedAt` | string | ISO timestamp |
| `presets[].name` | string | Preset name; must be non-empty and unique case-insensitively |
| `presets[].mode` | `"choice"` \| `"typed"` | Answer mode |
| `presets[].managePresetName` | string \| null | Referenced Manage preset **name**, or `null` when the reference could not be resolved at export |
| `presets[].showOnStart` | boolean | Written by export, defaults to `true`. **Not restored on import**: the parser discards it, so every imported session preset appears on the start screen. §11.2 lists the parse fields it is omitted from |
| `presets[].config` | object | 19 fields (the full `SessionConfig` minus `managePresetId`) |

`config` is emitted as `cloneConfig({ ...DEFAULT_SESSION_CONFIG, ...preset.config })`. The defaults merge guarantees every export contains every field even if the stored object predates a field; `managePresetId` is then removed. The result has exactly 19 keys. `managePresetId` is deliberately not exported: ids are local to one `data.json`. The name is the portable reference.

### 10.3 Config field reference

| Field | Type | Default | Meaning |
|---|---|---|---|
| `presentation` | `"all"` \| `"one"` | `"all"` | All questions on one page, or one at a time with Prev/Next |
| `choiceCount` | number | `4` | MCQ options including the correct answer (clamped 2–6) |
| `count` | number \| `"all"` | `"all"` | Questions per session; `"all"` means no limit |
| `trim` | `"seq"` \| `"rand"` | `"seq"` | How the subset is cut when `count` is lower than the pool |
| `order` | `"source"` \| `"random"` \| `"priority"` \| `"priority-random"` | `"source"` | Display order |
| `seed` | number | `0` | RNG seed input; `0` means generate at start |
| `submitMode` | `"auto"` \| `"any"` \| `"all"` | `"any"` | How answers lock in |
| `gradeMode` | `"immediate"` \| `"afterAll"` | `"immediate"` | When feedback is revealed |
| `passScore` | number \| `"off"` | `80` | Pass threshold percentage (**not** off) |
| `timerSessionMode` | `"off"` \| `"on"` \| `"soft"` | `"off"` | Session countdown behaviour |
| `timerSessionSeconds` | number | `60` | Session countdown duration |
| `timerSessionWarningSeconds` | number | `0` | Low-time warning threshold; `0` disables |
| `timerQuestionMode` | `"off"` \| `"on"` \| `"soft"` | `"off"` | Per-question countdown behaviour |
| `timerQuestionSeconds` | number | `60` | Per-question countdown duration |
| `timerQuestionWarningSeconds` | number | `0` | Per-question warning threshold; `0` disables |
| `stopwatchSession` | boolean | `false` | Session stopwatch |
| `stopwatchQuestion` | boolean | `false` | Per-question stopwatch |
| `navigator` | boolean | `true` | One-at-a-time navigator grid |
| `allowFlag` | boolean | `true` | Per-card flag controls |

The list above is the complete exported set.

### 10.4 How the Manage reference is encoded

| Stored `managePresetId` | Exported `managePresetName` | Warning |
|---|---|---|
| `"all"` | `"All questions"` | — |
| `"last-custom"` | `"Last custom"` | `"<preset>" references Last custom, but no last-custom selection exists.` when no last-custom selection is stored |
| A stored preset id | that preset's `name` | — |
| A missing id | `null` | `"<preset>" references a missing Manage Questions preset.` |

`All questions` and `Last custom` are fixed English literals in the format, not lookups, so a session preset that uses the whole pool always round-trips. Warnings are shown only after a copy or save; they never block the export. The manifest is still written, possibly with `managePresetName: null`, which import later treats as unresolvable.

## 11. Session import: validation, normalization, references, apply

### 11.1 Modes

| Mode | Label | Behaviour |
|---|---|---|
| `add` | `Add new` | Every ready row is appended with a fresh id. A name collision is suffixed ` 2`, ` 3`, … (space, not parentheses) |
| `update` | `Update by name` | A case-insensitive name match is updated **in place**, keeping its `id`; `mode` and the whole `config` are replaced. Non-matching names are added |

Initial mode is `add`. The tooltip on the select is `Add suffixes duplicate names; update preserves matching preset IDs.` The confirmation is destructive only in `update` mode.

### 11.2 Parse and validation

`parseSessionPresetManifest(text)` is all-or-nothing after the structural gates. Parse failures return `manifest: null`.

| Check | Failure result |
|---|---|
| Non-empty after `trim()` | `Manifest is empty.` |
| UTF-8 byte length ≤ 1,048,576 (`TextEncoder`) | `Manifest is too large.` |
| Valid JSON | `Invalid JSON: <message>` |
| Root is an object | `Manifest root must be an object.` |
| `format` matches | `Unsupported format. Expected "active-review/session-presets".` |
| `version === 1` | `Unsupported version. Expected 1.` |
| `presets` is an array | `"presets" must be an array.` |
| ≤ 200 presets | `Too many presets (maximum 200).` |
| Each entry is an object | `Preset <n>: must be an object.` |
| `name` non-empty, unique case-insensitively | `Preset <n>: name is required.` / `Preset <n>: duplicate preset name "<name>".` |
| `mode` is `choice` or `typed` | `Preset <n>: mode must be "choice" or "typed".` |
| `config` is an object | `Preset <n>: config must be an object.` |

The format/version/presets checks accumulate and return immediately when any fail; per-preset errors accumulate across all entries and return `null` at the end.

`mode` defaults to `choice` when invalid **and still records an error**, so the manifest is rejected anyway. `managePresetName` is trimmed when it is a string; it becomes `null` when `null`, omitted, or another type. A `null` result adds the warning `Preset <n>: no Manage Questions preset name was exported.` An empty string is kept as `""`, does not warn at parse time, and later fails reference resolution as “no exported name”. An empty `presets` array is valid; the import is then not applyable because no row is ready. Unknown fields are ignored; unknown `format`/`version` are hard errors.

`showOnStart` is the one field read by the preview but dropped by the parser: `parseSessionPresetManifest` builds each entry from `name`, `mode`, `managePresetName`, and `config` only. The preview then falls back to `true`, so a session manifest that declares `showOnStart: false` still imports a preset shown on the start screen. The field is not type-checked either.

### 11.3 Config normalization

Every config field is rebuilt from scratch, so unknown keys are dropped and every value is clamped or defaulted:

| Field | Accepted input | Otherwise |
|---|---|---|
| `presentation` | exactly `"one"` | `"all"` |
| `choiceCount` | finite number floored, clamped 2…6 | `4` |
| `count` | `"all"`, or a finite number floored and clamped 1…1,000,000 | `DEFAULT_SESSION_CONFIG.count` (`"all"`) |
| `trim` | exactly `"rand"` | `"seq"` |
| `order` | `random`, `priority`, `priority-random` | `"source"` |
| `seed` | finite number floored, clamped 0…2,147,483,647 | `0` |
| `submitMode` | `auto`, `all` | `"any"` |
| `gradeMode` | `afterAll` | `"immediate"` |
| `passScore` | `"off"`, or a finite number floored, clamped 0…100 | `DEFAULT_SESSION_CONFIG.passScore` (`80`) |
| `timerSessionMode` / `timerQuestionMode` | `on`, `soft` | `"off"` |
| `timerSessionSeconds` / `timerQuestionSeconds` | finite number floored, clamped 0…86,400 | `60` |
| `timerSessionWarningSeconds` / `timerQuestionWarningSeconds` | finite number floored, clamped 0…86,400 | `0` |
| `stopwatchSession` / `stopwatchQuestion` | exactly `true` | `false` |
| `navigator` / `allowFlag` | anything except literal `false` | `true` |

`count` uses the full clamp helper but its fallback is the merged default; `passScore` is only clamped when it is a finite number, so its `70` fallback argument is unreachable. The defaults are authoritative.

After the per-field pass, four consistency rules run in this order: (1) `typed` + `submitMode: "auto"` → `submitMode: "any"`; (2) `presentation !== "one"` **or** `submitMode === "all"` → `timerQuestionMode: "off"` and `stopwatchQuestion: false`; (3) `timerSessionMode !== "off"` with `timerSessionSeconds <= 0` → `60`; (4) `timerQuestionMode !== "off"` with `timerQuestionSeconds <= 0` → `60`. These mirror the runtime sanitizer, so an imported preset behaves like a locally saved one.

### 11.4 Reference resolution and preview

Each row resolves `managePresetName` against the current vault:

| Name | Result |
|---|---|
| `"All questions"` | `managePresetId: "all"` (compared **case-sensitively**) |
| `"Last custom"` | `"last-custom"` when `lastCustomSelection.length > 0`, otherwise unresolved (case-sensitive) |
| Any other name | Case-insensitive name match against stored Manage presets; first match wins |
| `null` or `""` | Unresolved: `No Manage Questions preset name was exported.` |

Unresolved errors: `Last custom is not available in this vault.` and `Manage Questions preset "<name>" is not available.`

Row statuses:

| Status | Meaning | Apply behaviour |
|---|---|---|
| `ready` | Reference resolved; config normalized | Imported |
| `manage-missing` | Reference unresolved (missing preset, absent last-custom, no exported name) | Skipped, `message` shown |
| `invalid` | Declared in the row type but never emitted by the current preview builder; parse errors abort earlier | — |

The preview renders count pills (total presets, `ready`, `Manage reference missing`, `invalid` — optional pills only when non-zero), a `Session presets` section with `name → referenced Manage name` and the status for non-ready rows (`Missing` badge for `manage-missing`), a `Manage Questions references` section listing every external reference as `Available` / `Unavailable` (skipping `All questions`), a `Presets in manifest` section listing each preset and `N config fields`, and warnings, including `No Manage Questions presets exist. Only All questions / Last custom references can import.` when the vault has no Manage presets at all.

`Apply import` requires at least one `ready` row. The confirmation reports how many rows are ready and how many unresolved rows will be skipped. `preview.errors` is again always empty, so `hasErrors` never disables Apply.

### 11.5 Apply and persistence

`applySessionPresetImport`:

1. clones the stored presets (new objects and new config objects);
2. for each row: `manage-missing` rows increment `skipped`; `update` + name match overwrites `mode`, `config`, and `showOnStart` on the existing preset (id preserved); otherwise a new preset is appended with `generatePresetId()` and a collision-free name (`Name 2`, `Name 3`, …), with `showOnStart` from the row;
3. saves through the supplied `save` callback, which calls `saveSessionPresets`: writes `data.json` and fires the workspace event `active-review:session-presets-changed`;
4. returns `{ added, updated, skipped, presets, errors }`.

The save runs even when nothing changed. A save failure adds `Could not save session presets: <message>` and the import still reports counters. The notice is `Session presets: N added, N updated, N skipped[, N error(s)].`

The modal then returns to the preset list. Imported presets do **not** become active; the current configuration is unchanged. Import does not touch Manage Questions presets, notes, or session logs. The journal is written by the UI adapter, not the transfer module: after apply, if `result.errors.length === 0`, it stores the pre-apply list under `sessionImportJournal`. The adapter does not diff the before/after lists; the write is gated only on the error count.

## 12. Session undo

Session imports have a one-step, whole-list undo. Unlike the Manage journal, it records no moves, no folder list, and no per-item report.

```ts
// stored in data.json
sessionImportJournal: { presetsBefore: SessionPreset[] } | null
```

- Written only after an error-free apply (see §11.5); single slot, so each successful import overwrites it.
- Restores the **entire previous preset list**, not individual rows. No preflight: the restore is a single `saveSessionPresets(presetsBefore)` call, so there are no path checks and no partial failure model. No per-item report: the only summary is the notice.
- Undo does not verify that the current list still matches the imported result. Manual edits made after the import are also overwritten.

`Undo last import` is in the session manager toolbar and is disabled when the journal is null. Confirmation title: `Undo last session preset import?`; message: `This restores the previous session preset list.`; confirm label `Undo import`, destructive.

On confirm: `saveSessionPresets(journal.presetsBefore)` → `saveSessionImportJournal(null)` → `refreshIdleViews()` → re-render → Notice `Session preset import undone.` A thrown error produces `Undo failed: <message>` and leaves the journal in place.

There is **no** “No session preset import to undo.” message in the code. The guard is simply `if (!journal) return;` plus a disabled button.

## 13. Cross-cutting rules and the round-trip matrix

### 13.1 Names and case

| Rule | Manage presets | Session presets |
|---|---|---|
| Comparison | Case-insensitive | Case-insensitive |
| Uniqueness enforced on save | **No** — `Manage questions` → `+ Save as new preset` pushes without a duplicate check | Session start-screen save path enforces uniqueness; manager rename rejects duplicates |
| Duplicate handling on import | `add`: `Name (2)`; `update`: first match updated | `add`: `Name 2`; `update`: first match updated |
| Duplicate names inside one manifest | Rejected at parse time | Rejected at parse time |
| Rename guard | Shared `resolvePresetRename`: trims, rejects empty and CI duplicates | Same |

Because Manage saving does not check names, two Manage presets can share a name. They export as two entries with the same `name`, which the Manage parser rejects as `duplicate preset name`. Session export would emit the same `managePresetName` for both, and import resolves both to the first match.

### 13.2 Ids, paths, unknown fields

Neither manifest contains ids. Every imported preset gets a fresh `preset-<base36 time>-<5 random base36 characters>` id from `generatePresetId`; `update` is the only path that preserves an existing id because it mutates the stored object. Manifest paths are always review-relative and forward-slashed; `sourcePath`/`targetFolder` reject absolute paths, drive letters, NUL, and `.`/`..` segments; file paths must end in `.md` (case-insensitive); `targetName` must be a bare file name (no `/`). `source.reviewRoot` is never used for matching, so a manifest from a vault with a different review folder name still imports. Imported session references are names only: renaming or deleting a Manage preset does not cascade, and the reference becomes unresolved at the next session start/preview.

Both parsers ignore unknown fields at every level and never copy them into storage. Session `config` is rebuilt field by field, so unknown config keys are dropped even before storage. Unknown `format` or `version` values are hard errors, which is the supported place to introduce a new format revision.

### 13.3 Persistence touch points

| Key in `data.json` | Written by |
|---|---|
| `managePresets` | Manage import, Manage saves/deletes/moves/renames/reorder, Category Sync, undo |
| `sessionPresets` | Session import, save/rename/duplicate/delete, session undo |
| `lastCustomSelection` | Manage modal apply, Manage import remap, Manage undo |
| `manageImportJournal` | Manage import (after a qualifying change), clean undo (clear) |
| `sessionImportJournal` | Session import (after an error-free apply), session undo (clear) |

`remapPresetPaths` is the shared writer used by Manage moves, folder deletes, and Manage import. It only writes when the map is non-empty and returns `{ presetsUpdated, lastCustomUpdated }`.

### 13.4 Round-trip matrix

Export → import in the same or another vault:

| Item | Round-trips? | Note |
|---|---|---|
| Manage preset names | Yes | May gain ` (2)` on `add` collision |
| Manage preset membership | Yes | Paths re-resolved and moved to `targetFolder`/`targetName` |
| Folder layout | Yes | Empty folders only when `Include empty folders` was checked |
| Question content | n/a | Never part of either manifest |
| `rv-category` | Rebuilt | Set from the target folder, not restored from the manifest |
| Session preset names | Yes | May gain ` 2` on `add` collision |
| Session preset config | Yes | Normalized on import; consistency rules may change fields |
| Session preset `mode` | Yes | |
| Session preset `showOnStart` | **No** | Exported, but the parser discards it; imported presets always show on the start screen |
| `seed` | Yes | Part of config; `0` still means generate at start |
| Manage reference | By name | Unresolvable references are skipped, never guessed |
| Manage preset ids / session preset ids | No | Fresh ids, except `update` in place |
| Last custom selection | No | Not exported |
| Undo journal | No | Local to the importing vault |
| Import provenance (which vault, when) | Partial | `exportedAt` and `source.reviewRoot` are informational only |

### 13.5 Asymmetries to keep in mind

| Area | Manage | Session |
|---|---|---|
| Undo strength | Moves reversed, presets and last-custom restored, categories restored, preflight | Whole-list snapshot, no preflight, no per-item report |
| Journal write trigger | At least one move or preset write | Any error-free apply, even a no-op |
| Journal slot | Single | Single |
| Journal path assumptions | Absolute paths; break if the review folder setting changes | Ids and configs; no paths |
| Undo coverage | Imports only — not renames, deletes, duplicates, reorder, or Category Sync moves | Imports only — not manual saves, renames, duplicates, deletes, or reorder |
| Collision suffix | ` (2)` on preset names; `-2.md` on files | ` 2` on preset names |
| Size accounting | `text.length` (UTF-16) against a “bytes” message | `TextEncoder` UTF-8 bytes |
| Preview errors | `errors: []` always | `errors: []` always |
| Save side effects | Moves notes and rewrites frontmatter | `data.json` only |
| Session references | n/a | Name-only; no cascade on Manage rename |

## 14. Message reference

### 14.1 Export and shared shell

| Message | Meaning |
|---|---|
| `Select at least one preset to export.` | Manage copy/save with an empty selection |
| `Select at least one session preset to export.` | Session copy/save with an empty selection |
| `No Manage Questions presets available to export.` | Manage export pane with zero presets |
| `No session presets available to export.` | Session export pane with zero presets |
| `Manage Questions manifest copied to clipboard.` | Manage copy succeeded |
| `Session preset manifest copied to clipboard.` | Session copy succeeded |
| `Could not copy to clipboard.` | Clipboard write and fallback both failed |
| `Saved <path>.` | JSON written to the vault |
| `Could not save manifest: <message>` | Vault create failed |
| `Paste a manifest or load a JSON file, then choose Preview import.` | Empty preview panel |
| `Import preview failed` | Parse failed; heading of the error panel |
| `Could not read file: <message>` | `Load JSON file` read error |
| `Apply failed: <message>` | Exception during apply, shown in the pane |
| `Import failed: <message>` | Exception during apply, shown as a Notice |
| `Applying…` / `Applied` / `Import applied` | Button and panel states |
| `A <noun> with that name already exists.` | Rename duplicate guard |
| `A session preset with that name already exists.` | Unrelated manual save/rename guard |

### 14.2 Manage preview and apply

| Message | Meaning |
|---|---|
| `Unsupported format: <value>` | Wrong manifest family or hand-edited file |
| `Manifest is larger than 5242880 bytes.` | Over the 5 MB ceiling |
| `Manifest has no files or presets.` | Structurally valid but empty |
| `Already at the target path.` | `noop` row |
| `Move from <path>` | `move` row |
| `N local filename matches; choose one.` | Ambiguous basename |
| `No matching question note found.` | Missing locally |
| `Target path already exists.` | Conflict, skipped by default |
| `Another manifest file targets the same path: <previous>` | Two manifest files share a target |
| `Target is inside the sessions folder.` | Entry points at the session log folder |
| `Target exists; skip this row.` | Collision policy `skip` |
| `Target exists; apply will use a numeric suffix.` | Collision policy `suffix` |
| `Session history is not updated by this preview. Moving questions may make old session frozen paths stale.` | Preview warning when a move or conflict exists |
| `Preset "<name>": no resolved files; not imported.` | Every file of that preset failed to resolve |
| `<source>: source file is missing.` | Source vanished between preview and apply |
| `<source>: target already exists (<target>).` | Target appeared between preview and apply |
| `<target>: moved, but rv-category could not be updated.` | Frontmatter write failed after a successful move |
| `Folder <folder>: <message>` | Target folder creation failed |
| `Could not remap existing presets: <message>` | Remap write failed |
| `Could not save imported presets: <message>` | Preset save failed |
| `Import applied, but undo journal could not be saved: <message>` | Moves done, undo unavailable |
| `Import applied: N moved, N added, N updated, N errors.` | Apply notice |

### 14.3 Manage undo

| Message | Meaning |
|---|---|
| `Cannot undo <to>: file no longer exists.` | Preflight blocked |
| `Cannot undo <to>: original path is occupied (<from>).` | Preflight blocked |
| `<from>: restored, but rv-category could not be updated.` | Reversal category failure |
| `Could not restore preset metadata: <message>` | Preset/last-custom restore failed |
| `Undo complete: N file(s) restored[; K empty folder(s) left].` | Clean undo |
| `Undo incomplete: R restored; E error(s). <first>` | Partial undo; journal kept |
| `Undo failed: <message>` | Undo threw |
| `No Manage Questions import to undo.` | Defensive only; button is disabled without a journal |

### 14.4 Session import and undo

| Message | Meaning |
|---|---|
| `Unsupported format. Expected "active-review/session-presets".` | Manage manifest passed to the session importer |
| `Preset <n>: duplicate preset name "<name>".` | Duplicate names inside the manifest |
| `Preset <n>: no Manage Questions preset name was exported.` | Parse warning for `null` |
| `Manage Questions preset "<name>" is not available.` | Reference not found in this vault |
| `Last custom is not available in this vault.` | Reference is `Last custom` but no selection is stored |
| `No Manage Questions preset name was exported.` | `managePresetName` is `null` or `""` |
| `No Manage Questions presets exist. Only All questions / Last custom references can import.` | Empty Manage preset store |
| `Session presets: N added, N updated, N skipped[, N error(s)].` | Apply notice |
| `Could not save session presets: <message>` | `data.json` write failed |
| `Session preset import undone.` | Undo succeeded |
| `Undo failed: <message>` | Undo threw |

### 14.5 Dead or unreachable messages

| Message | Status |
|---|---|
| `Some manifest files could not be represented in the preview.` | Never emitted: every manifest file produces exactly one row |
| `Folder target skipped: <message>` | Defensive; parser already normalised `folders[]` |
| `No session preset import to undo.` | **Does not exist** in the code |
| Session row status `invalid` | Type exists; preview builder never emits it |
| Preview `errors` lists in both families | Always empty; the error boxes never render |
| In-pane `Import applied` summary | Rendered, then immediately wiped by the list re-render |
| Epoch save-name fallback | Reachable only for a typed name of exactly `.json` |
| `presets[<name>].showOnStart must be a boolean.` | Reachable; a non-boolean value rejects the Manage manifest |

See [[00_Active Review Plugin Workflow]] §12 for how these manifest rules surface in the operator workflow.

## 15. Worked end-to-end transfer

Move both preset families from vault **A** to vault **B**.

1. **Vault A — Manage presets.** Open the review view → start screen → `Question Presets` row → `Manage questions` → toolbar `Manage question presets` → `Export presets…`. Keep `Include empty folders` if B should get empty categories too, click `Save JSON`, accept `manage-presets-2026-11-10.json`. The file lands in A's review folder.
2. **Copy the JSON** and the question notes into vault B, preserving folder layout where possible. Paths are relative, so B's review folder may have a different name.
3. **Vault B — Manage presets.** Open `Manage questions` → `Manage question presets` → `Import presets…` → `Load JSON file` (or paste) → `Preview import`.
4. Read the status pills. Expected: `noop` when the layout already matches; `missing`/`ambiguous` when B stores notes under different names or duplicate basenames exist — resolve those with the `Choose local question…` dropdowns; `conflict` when a target is occupied — choose `Move with suffix` or leave it skipped.
5. Choose `Add new` (fresh presets) or `Update by name` (overwrite presets that already exist in B), or `Move files only` to skip preset writes, then `Apply import`. Confirm `Apply Manage Questions import?`. The modal stays open and returns to the preset list; the Notice reports `Import applied: …`.
6. Verify the tree, then use `Undo last import` in the same list toolbar if a move was wrong. Undo must be used before any further qualifying import, because only the last journal is kept.
7. **Vault A — Session presets.** Start screen → `Session Configuration` header → `Manage Session Presets` → `Export presets…` → `Save JSON` → `session-presets-2026-11-10.json`.
8. **Vault B — Session presets.** Open `Manage Session Presets` → `Import presets…` → load and preview. Presets whose Manage name is not in B yet show `Manage reference missing`; do step 5 first so they resolve. Then `Apply import` with `Add new`, confirming `Apply session preset import?`.
9. If the session import was wrong, use `Undo last import` in the session manager; it restores the whole previous list.
10. Start a session in B from an imported preset and confirm the mode, count, order, timers, and pool match A.

Order matters: session presets reference Manage presets by name, so import the Manage presets first.

## 16. Source map and maintenance checklist

### 16.1 Source map

| Concern | Module |
|---|---|
| Session manifest build / parse / preview / apply / config normalization | `src/vault/sessionPresetTransfer.ts` |
| Session preset type | `src/vault/sessionPresets.ts` |
| Session preset export/import UI, undo, list manager | `src/ui/presets/SessionPresets.ts` (`SessionPresetManager`, `SessionPresetsModal`, `SessionImportAdapter`) |
| Session preset entry points | `src/ui/screens/StartScreen.ts`, `src/settings/SettingsTab.ts` |
| Manage manifest build / parse / preview / matching | `src/vault/manageImportExport.ts` |
| Manage import apply | `src/vault/manageImportApply.ts` |
| Manage import journal and undo | `src/vault/manageImportJournal.ts` |
| Manage preset type and `rv-category` writer | `src/vault/managePresets.ts` |
| Manage export/import UI | `src/ui/presets/QuestionPresets.ts` (`QuestionPresetManager`, `QuestionPresetsModal`, `QuestionImportPane`) |
| Manage toolbar entry point | `src/ui/manage/ManageQuestionsModal.ts` |
| Shared export/import panes and helpers | `src/ui/presets/PresetManager.ts` (`PresetManager`, `PresetExportPane`, `PresetImportPane`) |
| Save prompt and confirm modal | `src/ui/Modals.ts` (`openSavePresetPrompt`, `ConfirmModal`) |
| Copy-to-clipboard pipeline | `src/ui/CopyButton.ts` (`createCopyButton`, `copyText`) |
| Persistence, ids, path remapping | `src/main.ts` (`saveManagePresets`, `saveSessionPresets`, `remapPresetPaths`, `generatePresetId`, `applyManageImport`, `undoLastImport`, journal getters/setters) |
| Folder creation and category moves | `src/vault/manageFolders.ts`, `src/vault/folders.ts` (`ensureFolder`) |
| Category Sync moves that also remap presets | `src/vault/syncCategory.ts` |
| Defaults used by config merge | `src/constants.ts` (`DEFAULT_SESSION_CONFIG`) |

Tests live in `dev-active-review/tests`:

- `importPreview.test.ts` covers Manage manifest round-trip, parse rejection, noop/move/conflict previews, `resolveImportRow`, recounting, and existing-name flags.
- `rename.test.ts` covers the shared rename rules.
- There are **no** tests for the session transfer format, session normalization, either apply path, either journal, or undo. Those paths are verified manually.

### 16.2 Maintenance checklist

When changing a transport, keep these in sync:

1. **Format constants** — `MANIFEST_FORMAT`/`MANIFEST_VERSION` and `SESSION_PRESET_FORMAT`/`SESSION_PRESET_VERSION`. Bump the version for any incompatible schema change; both parsers reject unknown versions.
2. **Limits** — size, file, and preset caps in both modules, plus any UI text that quotes them. Keep the Manage UTF-16 / session UTF-8 measurement difference explicit.
3. **Normalization** — `normalizeConfig` must keep mirroring the runtime sanitizer, including the four consistency rules and the `passScore: 80` default.
4. **Field set** — a new `SessionConfig` field reaches the export automatically through the defaults merge, but it must also be added to `normalizeConfig` (otherwise import drops it) and to §10.3 here.
5. **Undo** — new apply-time mutations must be journalled, or undo will silently leave them in place. Both journals are single-slot; do not assume history.
6. **UI strings** — titles, descriptions, empty-state text, and notices are duplicated between the modals and §2, §3, §14. Note that the session summary and the applied-state panel are wiped by the list re-render.
7. **Dead paths** — if `preview.errors` is ever populated, remove the “always empty” caveat from §7.5 and §11.4 and re-check Apply enablement.
8. **Cross-references** — [[00_Active Review Plugin Workflow]] summarises this document; update that summary when behaviour changes.
