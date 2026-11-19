# Active Review

Turns notes in the vault's review folder into interactive quiz sessions. Answers
are graded as you go, and a session note is written to the review folder's
session subfolder.

## Note format

A note is a quiz note when it is a `.md` file under the configured review folder
(default `review/`), excluding the session subfolder. A minimal text-answer note:

```markdown
## QUESTIONS

Which term describes the integer part of a logarithm?

## ANSWERS

characteristic
```

Optional sections:

| Section | Purpose |
|---|---|
| `## DEFINITIONS` | A ```` ```rv-def ```` fence with `name = rand(min, max, step)`, `pick(...)`, fixed values, or expressions. |
| `## DISTRACTORS` | One block per wrong choice, separated by `---`. |
| `## EXPLANATIONS` | Markdown shown with the feedback. |

Placeholders in question, answer, distractor, and explanation text:

- `<<rv:val:name>>` — the drawn value.
- `<<rv:value:name>>` — the value plus its unit, for `rv-answer` bindings.
- `<<rv:expression:name>>` — the expression source, optionally partially
  substituted with `<<rv:expression:name:a:b>>`.

A note's category is its subfolder under the review root; `rv-category` in
frontmatter is the fallback for notes at the review root. `rv-priority` controls
priority ordering. `rv-exclude: true` keeps a note out of sessions and the
Manage Questions pool.

### Section markers

Two HTML-comment markers may follow a section heading:

| Marker | Applies to | Effect |
|---|---|---|
| `<!--ignore-warnings-->` | Any section | Hides warnings attributed to that section unless **Force show all warnings** is enabled. |
| `<!--debug-called-definitions-->` | `QUESTIONS`, `ANSWERS`, `DISTRACTORS`, `EXPLANATIONS` | Renders placeholders literally instead of resolving them. Ignored on `DEFINITIONS`. |

```markdown
## ANSWERS <!--ignore-warnings-->
```

Only these exact HTML comments are recognized. The older percent-style markers
are not supported.

### Quantified and multi-value answers

Add an `rv-answer` fence under `## ANSWERS` when an answer needs custom unit,
precision, or multi-value constraints. A quantified answer without the fence
uses the default quantity policy; simple numeric and text notes keep the
automatic behavior.

````markdown
## DEFINITIONS

```rv-def
m = pick(2, 4, 5)
v = rand(3, 9, 1)
KE = \frac{1}{2} m v^2; ; "J"
```

## QUESTIONS

A mass of $<<rv:val:m>>$ kg moves at $<<rv:val:v>>$ m/s.
Find its kinetic energy.

## ANSWERS

```rv-answer
KE:
    min-sigfigs = 3
    max-sigfigs = 3
```

<<rv:value:KE>>
````

Multiple variable headers in `rv-answer` select the multi-value variant model.
Each non-empty `## ANSWERS` block is then one complete variant over the same
bindings, and the global `typed-mode` and `sep` settings control typing.

#### Currency and comma grouping

Currency is a quantity. Declare a currency unit in `rv-definitions` with
`unit("USD")` (codes: `USD`, `EUR`, `GBP`, `JPY`, `PHP`, `AUD`, `CAD`, `CHF`, `CNY`,
`INR`, `KRW`, `SGD`), or assign one per binding with `rv-currency: USD`. Labels
for that code (`$`, `USD`, `Dollar`, `₱`, …) and bare numbers are accepted; a
label from another code is rejected. Commas are equivalent to no comma on input
(`1,000` ≡ `1000`); `rv-comma: true` additionally groups the integer digits of
the displayed answer and placeholders.

````markdown
```rv-def
cost = 1000; ; unit("USD")
```
```rv-answer
cost:
rv-comma: true
```
````

## Embedded quiz blocks

A host note **outside** the review folder can embed a session with the
`active-review` fence:

````markdown
```active-review
sessionPreset: Exam Mode

message: |
  ## Chapter 4 — Kinematics
  Ten questions, one at a time.
submessage: 10 questions · multiple choice

include:
  [[4.1 Velocity]]
  [[4.2 Acceleration]]

exclude:
  [[4.9 Optional challenge]]
```
````

`sessionPreset` is the only required key. It accepts a visible or hidden
preset's name or id. Optional keys add `message`/`submessage`, a `questionPreset`
override, `include`/`exclude` notes, and any `SessionConfig` override
(`count`, `order`, `choices`, `submit`, `grade`, `passScore`, timers, …).
`pool: replace` makes the include list the whole pool.

Inside the review folder the same fence is rendered as a plain code block, so
question notes can keep an example without starting a session or logging a
warning. Reading/Live Preview/Source switches keep the same in-memory session;
the Back button leaves a Continue-only start card. Closing the note tab or
Obsidian drops that in-memory instance, so reopening shows Start review. See
[`Plugin Docs/03_Embedded Quiz Blocks.md`](Plugin%20Docs/03_Embedded%20Quiz%20Blocks.md)
for the full syntax and precedence.

See
[`Plugin Docs/00_Active Review Plugin Workflow.md`](Plugin%20Docs/00_Active%20Review%20Plugin%20Workflow.md)
for the architecture and operator guide,
[`Plugin Docs/01_Active Review Authoring Rule Book.md`](Plugin%20Docs/01_Active%20Review%20Authoring%20Rule%20Book.md)
for the full authoring contract,
[`Plugin Docs/02_Preset Import & Export.md`](Plugin%20Docs/02_Preset%20Import%20%26%20Export.md)
for preset import/export, and
[`Plugin Docs/03_Embedded Quiz Blocks.md`](Plugin%20Docs/03_Embedded%20Quiz%20Blocks.md)
for embedded sessions.

Inside `## DISTRACTORS`, an optional `rv-distract` fence conditions variables
before free-text distractor placeholders are filled:

````markdown
## DISTRACTORS

```rv-distract
d1, d2 <- ans
```
---
A wrong value is <<rv:value:d1>>.
````

The anchor (`ans`) supplies the target type and unit; automatic pick/rand
distractors are not affected.

## Use

Open the view from the ribbon or the **Open quiz** command. If an Active Review
tab is already open, the plugin lists the open tabs and lets you switch or open
another instance. Choose a session preset or configure presentation, count,
order, submit mode, grading, timers, and pass score, then **Start New Session**.
Pending sessions can be continued from Session history; completed sessions can
be viewed, reproduced, archived, or deleted. Multiple tabs that open the same
session file stay synchronized (choice, typed answer, scratch, flags, score,
timers, and the one-at-a-time page); tabs on different session files run
independently. Large sessions plan first, then stream question generation and
card rendering in adaptive batches; the session timer stays paused until
generation completes. Manage Questions selects the question pool by folder and
saved presets. Question and session presets can be exported to and imported from
JSON manifests, with a preview and an undo journal for Manage imports.

Skipped Note and Warning Note panels list the notes that could not be parsed or
that produced warnings. Each listed path is a link that opens the note in a new
tab, and each panel has a copy icon (the same one Obsidian uses on code blocks)
that copies the whole list as Markdown with `[[wiki links]]` — handy for pasting
into an AI agent or an issue report.

### Index and rescanning

The plugin keeps a compressed index of the parsed notes and sessions in
`<plugin folder>/cache/index.json.gz`. Opening Obsidian reads that index instead
of scanning the vault, so startup stays fast as the vault grows. **Rescan notes**
is the only full scan: it reparses every quiz note and session note and rewrites
the index. Editing, adding, renaming, or deleting a note in the review folder
updates just that entry. If no index exists yet (first install or an update), the
plugin builds one automatically once.

## Install / develop

- Manual: copy `main.js`, `manifest.json`, and `styles.css` into
  `<vault>/.obsidian/plugins/active-review/`, then enable the plugin.
- Develop on Windows, macOS, or Linux: install Node.js 18 or newer, then run
  `npm ci` once. The committed lockfile pins every dependency and `.npmrc`
  blocks install scripts, so `npm ci` is preferred over `npm install`. The
  build script is cross-platform, so the same commands work in PowerShell,
  Command Prompt, and a POSIX shell.

| Command | Action |
|---|---|
| `npm run dev` | esbuild watch mode with inline source maps |
| `npm run build` | Audit, type-check, lint, test, bundle, then sync the submission folder |
| `npm run build -- --clean` | Reinstall from the lockfile first, then run the full build |
| `npm run build -- --no-sync` | Full verified build in place, without syncing |
| `npm run verify` | Type-check, lint, and run the test suite |
| `npm run typecheck` | Type-check only |
| `npm run lint` | ESLint over `src` |
| `npm test` | Compile `src` + `tests` and run the test harness (cross-platform) |

`main.js` is generated by `npm run build`; edit files under `src/`. In the
development checkout, the build also refreshes the sibling
`obsidian-active-review/` folder with the generated bundle, sources, tests, and
build configuration; set `OUT_DIR` to override.
Inside the submission folder `npm run build` runs its own trimmed
`scripts/build-submission.mjs`, which verifies, tests, bundles, and checks the
artifacts in place but never copies files to another folder. Syncing and docs
management are development-only steps and are not shipped.

The test harness compiles into `tests/.build`, stubs the types-only `obsidian`
package, and runs sync and async tests. It covers section parsing and
HTML-comment markers, Manage preset import previews, preset rename rules,
removed answer aliases, alert copy formatting, index encode/decode and cache
storage, plus a startup test that hydrates from the index without reading any
note body. No fixture vault is required.

## Source layout

| Path | Role |
|---|---|
| `src/main.ts` | Plugin entry: scan orchestration, settings, view registration. |
| `src/constants.ts` | `SessionConfig` and shared defaults. |
| `src/embed/` | `active-review` code-block parsing, resolution, start card, and embedded controller. |
| `src/math/` | LaTeX-subset tokenizer, evaluator, symbolic renderer, formatting. |
| `src/math/units/` | Unit registry, parsing, conversion, and quantity formatting. |
| `src/math/normalize/` | Answer-text and expression normalization (grading only). |
| `src/parser/` | Note parsing: sections, variables, placeholders, answers, categories. |
| `src/session/` | Seeded generation, distractors, grading, timers, hydration, shared bootstrap. |
| `src/vault/` | Incremental scanner, session index, log schema/I/O, preset operations. |
| `src/ui/` | View, screens, cards, modals, Markdown rendering, preset managers. |
| `src/settings/` | Settings tab and its declarative pages. |
| `src/util/` | Path, text, and clipboard helpers. |
| `tests/` | TypeScript test harness and pure-module suites. |

## License

0-BSD. See `LICENSE`.
