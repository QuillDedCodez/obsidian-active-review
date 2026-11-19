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

- `<<rv:val:name>>`, `<<rv:values:name>>`, `<<rv:value:name>>` — the drawn value.
  All three are interchangeable; `<<rv:value:name>>` is the conventional spelling
  for a bound `rv-answer` quantity, where the unit is included.
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

## Comprehensive example

Distance problem (SI units): with given acceleration and a velocity equation, derive the distance equation for a time interval and evaluate the distance for the drawn time values. Calculus is shown in the explanation.

`````markdown
## DEFINITIONS

```rv-def
u = pick(4, 6, 8)
a = rand(1, 3, 1)
p = pick(1, 2, 3)
d = pick(2, 3, 4)
q = p + d
U = u ; ; "m/s"
A = a ; ; "m/s^2"
P = p ; ; "s"
Q = q ; ; "s"
D = U * (Q - P) + 0.5 * A * (Q^(2) - P^(2))
b = 100
c = 125
g = 150
```

## QUESTIONS
A particle moves along a straight line with constant acceleration
$a(t)=<<rv:val:a>>\ \text{m/s}^{2}$. Its velocity is
$v(t)=<<rv:val:u>>+<<rv:val:a>>t$ in m/s. At
$t=<<rv:val:p>>\ \text{s}$ the particle is at the origin, and it continues
moving in the positive direction. Find the distance traveled from
$t=<<rv:val:p>>\ \text{s}$ to $t=<<rv:val:q>>\ \text{s}$.

## ANSWERS

```rv-answer
D:
unit-mode = expanded
display = atomic
prefix-policy = any
allowed-prefixes = auto
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

<<rv:value:D>>

## DISTRACTORS

<<rv:val:b>>
---
<<rv:val:c>>
---
<<rv:val:g>>

```rv-distract
b, c, g <- D
```

## EXPLANATIONS
Because $v(t)=<<rv:val:u>>+<<rv:val:a>>t$ is positive on the interval, the
distance traveled equals the displacement:
$$
\Delta x=\int_{<<rv:val:p>>}^{<<rv:val:q>>}
\left(<<rv:val:u>>+<<rv:val:a>>t\right)\,dt
=<<rv:val:u>>\left(<<rv:val:q>>-<<rv:val:p>>\right)
+\frac{1}{2}<<rv:val:a>>\left(<<rv:val:q>>^{2}-<<rv:val:p>>^{2}\right)
=<<rv:value:D>>.
$$
`````

### How this example uses the plugin

- **Definitions and randomization (`## DEFINITIONS`, `rv-def`)**: `pick` and `rand` draw the initial speed, acceleration, and time bounds each session; `q = p + d` computes the end time. `U`, `A`, `P`, and `Q` declare SI quantities (`m/s`, `m/s^2`, `s`), and `D = U * (Q - P) + 0.5 * A * (Q^(2) - P^(2))` converts the acceleration/velocity and time inputs into a distance equation and evaluates the distance for the drawn interval. `b`, `c`, and `g` provide base values for distractors.
- **Question stem (`## QUESTIONS`)**: `<<rv:val:...>>` inserts the drawn values into the prose and LaTeX ($a(t)$, $v(t)$, and the interval), asking for the distance traveled from $t=p$ to $t=q$.
- **Quantity answer and grading (`## ANSWERS`, `rv-answer`)**: the `D` binding sets an explicit grading/display policy (expanded unit forms, atomic display, SI prefix handling, 3 significant figures, unit required). `<<rv:value:D>>` is the accepted quantity answer, so equivalent unit forms are graded under that policy.
- **Distractors (`## DISTRACTORS`, `rv-distract`)**: authored choices `<<rv:val:b>>`, `<<rv:val:c>>`, and `<<rv:val:g>>` are conditioned on `D` (`b, c, g <- D`), so they are interpreted in the answer’s quantity context when presented.
- **Explanation with calculus (`## EXPLANATIONS`)**: explains that positive velocity makes distance equal displacement, integrates $v(t)$ over $[p,q]$ to derive the distance expression, substitutes the drawn values, and reports the evaluated result as `<<rv:value:D>>`.

### Session display (one possible draw)

With $u=4$, $a=3$, $p=1$, $d=3$ (so $q=4$), a session may show:

**Question**

> A particle moves along a straight line with constant acceleration $a(t)=3\ \text{m/s}^{2}$. Its velocity is $v(t)=4+3t$ in m/s. At $t=1\ \text{s}$ the particle is at the origin, and it continues moving in the positive direction. Find the distance traveled from $t=1\ \text{s}$ to $t=4\ \text{s}$.

**Answer (typed)**: `34.5 m` (unit required, 3 significant figures; equivalent unit forms accepted per policy)

**Choices (multiple choice, order may vary)**

> - `34.5 m`
> - `100 m`
> - `125 m`
> - `150 m`

**Explanation (after submit)**

> Because $v(t)=4+3t$ is positive on the interval, the distance traveled equals the displacement:
> $$
> \Delta x=\int_{1}^{4}\left(4+3t\right)\,dt
> =4\left(4-1\right)+\frac{1}{2}3\left(4^{2}-1^{2}\right)
> =34.5\ \text{m}.
> $$

## Use

Open the view from the ribbon or the **Open quiz** command. Choose a session preset (or configure presentation, count, order, grading, timers, and pass score), then **Start New Session**.

**Session history** lets you continue pending sessions or view, reproduce, archive, and delete completed ones. Tabs on the same session file stay synchronized; different session files run independently.

**Manage Questions** selects the pool by folder and saved presets. Question and session presets can be exported/imported as JSON (with preview and an undo journal for Manage imports).

**Skipped Note** and **Warning Note** panels list notes that could not be parsed or produced warnings. Each path opens the note, and the copy icon copies the list as Markdown with `[[wiki links]]`.

### Index and rescanning

The plugin keeps a compressed index in `<plugin folder>/cache/index.json.gz`, so startup does not rescan the vault. Edits in the review folder update only that entry.

**Rescan notes** performs a full reparse and rewrites the index (run automatically once if no index exists).

## Install / build

- Manual install: copy `main.js`, `manifest.json`, and `styles.css` into
  `<vault>/.obsidian/plugins/active-review/`, then enable the plugin.
- Build from source (Windows, macOS, or Linux): install Node.js 18 or newer,
  then run `npm ci` once. The committed lockfile pins dependencies and `.npmrc`
  blocks install scripts.

| Command | Action |
|---|---|
| `npm run dev` | esbuild watch mode with inline source maps |
| `npm run build` | Audit, type-check, lint, test, and bundle `main.js` |
| `npm run verify` | Type-check, lint, and run the test suite |
| `npm run typecheck` | Type-check only |
| `npm run lint` | ESLint over `src` |
| `npm test` | Compile `src` + `tests` and run the test harness |

`main.js` is generated by `npm run build`; edit files under `src/`.

Release assets are built from the tagged source by
`.github/workflows/release.yml`, which also attests their provenance, so the
downloads always match the committed lockfile and source.

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

## Privacy and security

- **Local-only:** the plugin makes no network requests, sends no telemetry,
  and loads no remote code. Everything happens inside the vault.
- **Vault access:** the plugin enumerates vault file paths and reads Markdown
  notes under the configured review folder to build the question pool. It also
  writes session notes, the plugin cache, and settings inside the vault.
- **Clipboard:** copy actions (for example, copying a warning list) write the
  requested text to the system clipboard through the browser Clipboard API.
  The plugin never reads the clipboard.
- **No hidden data collection:** settings, indexes, and session history stay in
  the vault or the plugin folder.

## License

0-BSD. See `LICENSE`.
