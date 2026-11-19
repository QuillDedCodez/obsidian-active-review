# Embedded Quiz Blocks

The `active-review` code block turns any note **outside the review folder** into
an embedded quiz session. It reuses the same presets, question pool, session
engine, grading, timers, navigator, and session notes as the review tab.

```markdown
```active-review
sessionPreset: Exam Mode
```
```

---

## 1. Where it works

| Location of the fenced block | Behaviour |
|---|---|
| A note outside `reviewDir` | Renders the embedded start card, then the quiz |
| A note inside `reviewDir` (including the session folder) | Renders as an ordinary code block |
| A question card, answer block, or explanation | Renders as an ordinary code block |

The distinction is based on the note that contains the block, not the plugin
folder. Inside the review root the block is never parsed, never starts a
session, and never writes a warning or skipped-note entry. Question notes can
therefore keep an `active-review` example without side effects.

The block is interpreted in Reading view and Live Preview. It does not
auto-start: a session note is created only after **Start review** is pressed.

---

## 2. Minimal form

Only one key is required:

```markdown
```active-review
sessionPreset: Daily 10
```
```

`sessionPreset` accepts either:

- the preset's **name**, case-insensitive (`Exam Mode`, `exam mode`);
- the preset's **id** (`preset-m1abc2`).

Hidden presets are allowed. A missing or duplicate name is a start-card error
that lists the available presets.

---

## 3. Full example

````markdown
```active-review
sessionPreset: Exam Mode

message: |
  ## Chapter 4 — Kinematics
  Ten questions, one at a time. Your session is saved automatically.
submessage: 10 questions · multiple choice · pass 80%

sessionName: Chapter 4 practice

questionPreset: Kinematics
count: 10
order: random
seed: 20261119

include:
  [[4.1 Velocity]]
  [[4.2 Acceleration|the alias is ignored for matching]]

exclude:
  [[4.9 Optional challenge]]
```
````

Include-only session:

````markdown
```active-review
sessionPreset: Quick Check
pool: replace

include:
  [[5.1 Limits]]
  [[5.2 Continuity]]
```
````

---

## 4. Keys

| Key | Required | Meaning |
|---|---|---|
| `sessionPreset` | Yes | Session preset name or id. Supplies the base mode and `SessionConfig`. |
| `questionPreset` | No | Question preset name or id. Replaces the pool configured by the session preset. Accepts a comma-separated union. `questionPresets` is an alias. |
| `pool` | No | `add` (default): preset pool + include − exclude. `replace`: include − exclude only. |
| `sessionName` | No | Session-history label. Defaults to the host note's basename. |
| `message` | No | Markdown shown at the top of the start card. |
| `submessage` | No | Smaller plain-text line under the message. |
| `mode` | No | `choice` or `typed`. Overrides the preset's answer mode. |
| `include` | No | Notes added to the question pool. |
| `exclude` | No | Notes removed from the question pool. Exclude wins over include. |
| config keys | No | Any `SessionConfig` field; see §5. |

### Include / exclude syntax

Any of these forms work:

```markdown
include:
  [[4.1 Velocity]]
  [[4.2 Acceleration|alias]]
  [[4.3 Momentum#Derivation]]
  ![[4.4 Impulse]]
  - [[4.5 Work]]
  [[4.6 Energy]], [[4.7 Power]]
  [4.8 Rotation](review/mechanics/4.8%20Rotation.md)
  review/mechanics/4.9%20Springs.md
```

Matching is by resolved vault path. Duplicates are collapsed, and explicitly
including a note that is already in the preset pool is a harmless no-op.
Resolved links that are outside the review root, not quiz notes, or excluded by
Category Sync appear as warnings on the start card.

---

## 5. Session config overrides

Overrides are applied after the preset:

```
DEFAULT_SESSION_CONFIG → preset.config → block overrides → sanitize
```

Both exact `SessionConfig` names and short aliases are accepted. Keys ignore
case and `-`/`_`/space differences, so `choiceCount`, `choice-count`, and
`choices` all work.

| Friendly key | Also accepted | Values |
|---|---|---|
| `presentation` | — | `all`, `one` |
| `choices` | `choiceCount` | 2–6 |
| `count` | — | `all`, or a positive integer |
| `trim` | — | `seq`, `rand` |
| `order` | — | `source`, `random`, `priority`, `priority-random` |
| `seed` | — | integer; `0` generates one on start |
| `submit` | `submitMode` | `auto`, `any`, `all` |
| `grade` | `gradeMode` | `immediate`, `afterAll` |
| `passScore` | `pass` | `off`, 0–100 |
| `navigator` | — | `true`, `false`, `on`, `off`, `yes`, `no` |
| `allowFlag` | — | same booleans |
| `timerSessionMode` | — | `off`, `on`, `soft` |
| `timerSessionSeconds` | — | integer seconds |
| `timerSessionWarningSeconds` | — | integer seconds |
| `timerQuestionMode` | — | `off`, `on`, `soft` |
| `timerQuestionSeconds` | — | integer seconds |
| `timerQuestionWarningSeconds` | — | integer seconds |
| `stopwatchSession` | — | boolean |
| `stopwatchQuestion` | — | boolean |
| `managePresetId` | — | raw Manage Questions preset id |

Practical notes:

- `count` is applied **after** include/exclude. A pool of 8 with `count: 5`
  asks 5 questions.
- Typed mode plus `submit: auto` becomes `submit: any`, matching the tab.
- Per-question timers/stopwatches are disabled when presentation is not
  `one`, or when submit is `all`, matching the settings UI.
- Invalid values are ignored with a note; out-of-range choice counts and pass
  scores are clamped with a note.

---

## 6. Message blocks

```markdown
message: A single line.
```

```markdown
message:
  A line.
  Another line.
```

```markdown
message: |
  ## Heading
  Preserves newlines.

  Markdown, links, and math work.
```

```markdown
message: >
  Folds continuation
  lines into one paragraph.
```

`message` is rendered with Obsidian's Markdown renderer using the host note as the source path. `submessage` is plain text. Indent the message content when it starts with `#`, so a heading is message content rather than a full-line comment.

Full-line `#` and `//` comments are allowed at column 0:

```markdown
sessionPreset: Exam Mode
# count: 10
```

---

## 7. Pool resolution

Without `questionPreset`:

```
preset.config.managePresetId
  ├─ all          → every matched question
  ├─ last-custom  → settings.lastCustomSelection
  └─ preset id    → that question preset's includedPaths
```

Then:

```
pool: add     → base + include
pool: replace → include

final = (pool) − exclude
final = Category Sync matched only
final = deduplicated by vault path
```

`exclude` always wins. If a linked note is in both lists, it is removed and a
warning is not required.

---

## 8. Start card, warnings, and errors

The embedded start card is intentionally minimal:

- `message` (or the preset name as a heading);
- `submessage` when supplied;
- preset name, question count, and answer mode;
- `+N included · −N excluded` when links changed the pool;
- a collapsible warning list;
- **Start review**.

**Errors** disable the button:

- missing or ambiguous session preset;
- missing question preset;
- no questions after filtering.

**Warnings** do not block the start:

- unresolved include/exclude link;
- link outside the review root;
- linked note is not a parseable quiz note;
- linked note is excluded by Category Sync;
- unknown key, invalid value, duplicate key, or clamped value.

No `Notice` is used for block validation, so re-rendering a note does not spam
the user.

### Layout

The start card follows the note's normal flow. The live quiz is a self-contained
subsection:

- an additional 3% inline margin on each side;
- its own vertical scrollport (`--rv-embed-max-height`, default `85dvh`);
- a sticky header that is sticky only inside that scrollport;
- `overscroll-behavior: contain`, so scrolling the quiz does not chain to the
  note at its boundaries;
- a subtle border/radius and inner padding so the subsection reads as one unit.

---

## 9. Sessions and re-rendering

An embedded session behaves like a tab session:

- a pending session note is written immediately to
  `<reviewDir>/<sessionsSubdir>/session-<id>.md`;
- answers, scratch notes, flags, and timers are shared through
  `SessionHub`/`SessionRuntime`;
- completion saves the same session note;
- **Rename session**, **Open session note**, and **New session** mirror the tab;
- the session appears in the normal Session List and history.

When the note re-renders (edit above the block, Reading/Live Preview/Source
switch, pane move), the block keeps one in-memory session keyed by note path +
block source. The replacement render reattaches to the same runtime, so a quiz
stays on the same question instead of jumping back to the start card. In Source
mode no quiz renderer is mounted, but the open note leaf still keeps the entry;
returning to a rendered mode reattaches to the same session.

**Back** detaches from the quiz but keeps the in-memory instance. The start card
then shows a single **Continue review** button; it does not offer a new session.
The same Continue state survives a Reading/Live Preview switch.

The in-memory instance is deliberately not persisted. Closing the note tab or
Obsidian drops it after a short grace period, so reopening the note shows
**Start review** again. Disabling the plugin clears the registry immediately.
The session note itself remains in history as pending.

If another tab archives the running session, the embedded session stops and the
start card shows a banner.

---

## 10. Implementation map

| File | Responsibility |
|---|---|
| `src/embed/spec.ts` | Pure parser and resolver. No Obsidian UI. Unit-tested. |
| `src/embed/index.ts` | Code-block registration, `MarkdownRenderChild` lifecycle, in-memory session registry, plain fallback, start card, embedded controller. |
| `src/session/config.ts` | `sanitizeSessionConfig` / `normalizeModeConfig`, shared with the tab. |
| `src/session/start.ts` | `openFreshSession` and `generationEntries`, shared with the tab. |
| `src/main.ts` | Calls `registerActiveReviewEmbed(this)` in `onload()`. |
| `src/ui/screens/QuizScreen.ts` | Reused by the embed with `embedded` and `showDetailsLabel` props. |
| `styles.css` | `.rv-embed-*` start card and embedded quiz overrides, including container queries. |

The embed does not create a second session engine. It plans with
`planSession`, writes with `openFreshSession`, renders with `renderQuizScreen`,
and shares with `SessionHub`.
