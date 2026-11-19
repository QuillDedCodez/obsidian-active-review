# Active Review — question-authoring skill for AI agents

> **Artifact:** `skills.md` in the published `obsidian-active-review` repository.
> **Scope:** Active Review `2.0.0`, minimum Obsidian `1.13.0`.
> **Audience:** any AI agent or harness asked to generate a **set of Active Review question notes**. This is not an OpenCode skill file; it is a task contract meant to be fed to a general agent.
> **Authority:** `Plugin Docs/01_Active Review Authoring Rule Book.md` is the source of truth for what the shipped parser and grader accept. This file is a task-oriented translation of that contract. If they ever disagree, the rulebook wins.
> **Hard rule:** never invent a section name, fence name, function, answer key, placeholder, or grading behaviour. Unsupported syntax does not degrade gracefully — it skips the note.

Rule IDs (`G#`, `S#`, `P#`, `Q#`, `V#`) are stable so a harness can cite a specific rule when rejecting output.

---

## 0. Agent protocol

Follow this order. Do not skip to generation.

1. **Ask the gate question** (§1) and wait for the author's explicit answer.
2. **Collect the remaining inputs** (§2) in the same turn if convenient, but the gate answer is mandatory before any note is written.
3. **Select a mode**: `static` or `semi-procedural` (§3).
4. **Generate one `.md` note per question** (§4), applying the set-level rules (§5).
5. **Self-validate** every note against §9 and return the file list plus a short manifest (§8).

Harness rule: if the gate answer is missing, the run is invalid. Do not guess a mode. Do not default to semi-procedural. Ask once more; if the author still does not answer, stop.

### 1. Mandatory first question (G1)

Ask the author, verbatim or equivalently:

> **Should this question set be semi-procedural or static?**
>
> - **Semi-procedural** — the plugin draws random values, units, or choices at session time from `rv-def` definitions; every number in the stem, answer, distractors, and explanation is derived from those draws.
> - **Static** — the question text and answer are fixed; no definitions, no placeholders, no randomization.

Wait for the answer. A reply such as "whatever you think" is not an answer — repeat the question with the two options.

### 2. Remaining intake (G2)

After the gate answer, collect what is missing. Use sensible defaults only when the author permits them; state the defaults you used in the final manifest.

| Input | Why it matters | Default if allowed |
|---|---|---|
| Topic / learning objective | question content and distractors | — (required) |
| Number of questions | one note per question | — (required) |
| Review folder and category | `rv-category` must match the folder path | `review/<topic>` |
| Answer style | typed, multiple-choice, or both | MCQ with typed fallback |
| Units / quantity grading | decides the quantity path and `rv-answer` policy | no units unless the topic needs them |
| Significant figures | `min-sigfigs` / `max-sigfigs` | `3` / `3` for teaching, `3` / `15` otherwise |
| Choice count | at least `choiceCount − 1` distractors | `4` |
| Difficulty / bloom level | wording and distractor quality | — |
| Output location | where to write the `.md` files | vault review folder |

### 3. What the two modes mean (G3)

**Static** = a note with no `rv-def` fence and no `<<rv:…>>` placeholders. Text answers are plain accepted strings; numeric answers are literal numbers or simple `rv`-free text. Distractors and explanations are still allowed and recommended.

**Semi-procedural** = at least one drawable definition (`rand`, `pick`, `exprPick`, quantity pick, unit/prefix pick) and a complete dependency chain:

```text
rv-def draw → placeholder in QUESTIONS → placeholder in ANSWERS → placeholders in DISTRACTORS/EXPLANATIONS
```

The answer is **recomputed from the drawn values**, not hard-coded. Merely sprinkling `<<rv:val:x>>` into a fixed sentence without recomputing the answer is not semi-procedural and is rejected by Q1.

---

## 4. Global hard rules (apply to both modes)

| ID | Rule | Severity |
|---|---|---|
| G4 | Exactly **one question per note**. Different problems go in different files. | must |
| G5 | File lives under the configured review folder (default `review/`), ends in `.md`, and is outside the session subfolder (default `!rv-sessions/`). | must |
| G6 | Frontmatter, if present, opens with `---` at **byte 0** (no BOM, no leading blank line). `rv-category` must equal the actual folder path if you want the note manageable; omit it at the review root. | must |
| G7 | Only these H2 headings: `DEFINITIONS`, `QUESTIONS`, `ANSWERS`, `DISTRACTORS`, `EXPLANATIONS`. Use uppercase, column 0, exact plural names. A suffix such as `## QUESTIONS (easy)` is **not** recognized. | must |
| G8 | `QUESTIONS` and `ANSWERS` are required and non-empty. `DEFINITIONS`, `DISTRACTORS`, `EXPLANATIONS` are optional; delete unused ones. | must |
| G9 | Separate blocks with a line whose trimmed content is exactly `---`. In `EXPLANATIONS`, `---` is a horizontal rule. For a visible rule inside a block, use `***` or `___`. | must |
| G10 | Only these fences: `rv-def` / `rv-definitions` under `DEFINITIONS`, `rv-answer` / `rv-answers` under `ANSWERS`, `rv-distract` / `rv-distractors` under `DISTRACTORS`. At most one answer fence and one distractor fence per note; any number of `rv-def` fences. | must |
| G11 | Every placeholder in `QUESTIONS`, `ANSWERS`, `DISTRACTORS`, and `EXPLANATIONS` must resolve, unless the section is explicitly literal-rendered. | must |
| G12 | Do not invent functions, answer keys, or placeholders. `prefix(...)`, `unit(N, kN)`, percent-style markers, and `rv-type` / `rv-tags` frontmatter do not exist. | must |
| G13 | Do not rely on `%%` comments; they are not stripped. Fenced code does not protect placeholders — use `<!--debug-called-definitions-->` if literal text is intended. | must |
| G14 | Explanation must be pedagogically correct and consistent with the answer under every draw, not just one example. | must |
| G15 | Use LF line endings, no BOM, and plain Markdown. Keep choice text short; no diagrams, tables, or multi-paragraph buttons in a choice. | should |

Header markers, when genuinely needed, go at the **end** of the header line: `<!--ignore-warnings-->` (any section) and `<!--debug-called-definitions-->` (content sections). They are diagnostic tools, not a way to hide a broken note. `<!--ignore-warnings-->` does not survive **Force show all warnings**.

---

## 5. Set-level rules (S#)

| ID | Rule |
|---|---|
| S1 | Every note in the set uses the same review folder/category convention, the same accepted header set, and the same answer-style policy unless the author asked for variety. |
| S2 | No duplicate question, stem, or answer across the set. If two questions test the same fact, vary the tested angle or merge them. |
| S3 | Balance the set: mix recall, application, and interpretation when the author asks for a "set" without further detail. Do not produce N copies of one template with different numbers. |
| S4 | Use stable, unique filenames: lowercase kebab-case, e.g. `kinematics/kinetic-energy-from-mass-and-speed.md`. Never use the session folder as output. |
| S5 | If a topic cannot be made invariant-preserving under randomization, mark that question `static` and say why in the manifest. Never force semi-procedural mode onto an unsafe problem. |
| S6 | Do not create or edit plugin source, `main.js`, presets, sessions, or the plugin folder. Your output is question notes only. |

---

## 6. Semi-procedural core-feature rules (P#)

### P1 — Definitions (`rv-def`)

| ID | Rule |
|---|---|
| P1.1 | Put definitions only under `## DEFINITIONS` in a ` ```rv-def ` fence. Multiple fences concatenate in order; an empty fence is fine, a non-empty fence producing zero definitions is fatal. |
| P1.2 | Each non-empty line is exactly `name = rhs` or `link(name_a, name_b, ...)`. No comments, no `if`, no assignments with `:=`. |
| P1.3 | Names match `[A-Za-z][A-Za-z0-9_]*`, are case-sensitive, and may reference only **earlier** names (`link()` name checks excepted). Wrap multi-letter RHS names in `\var{name}` / `\variable{name}`; `SA = LA + 2s` means `S·A`, not `LA`. |
| P1.4 | **Never name a variable `e`.** The evaluator treats bare `e` as that variable but the renderer treats it as Euler's constant. |
| P1.5 | `rand(min, max, step[, max_index])`: `step > 0`, `max >= min`, `max_index` a positive integer cap. Choose ranges that keep every draw solvable; use `max_index` when variety matters. |
| P1.6 | `pick(...)` is **type-homogeneous**: numeric, expression, string, unit, prefix, or quantity options — never string + number. A numeric literal mixed with an expression is an `exprPick`, which is valid. |
| P1.7 | A declared variable used inside `pick()` must be declared earlier; wrap multi-letter names in `\var{…}` and ensure its declared type is numeric/expression or unit/prefix. |
| P1.8 | Group expressions defensively: write `(a/b)*c` or `a/(b*c)`, never `a/b*c` or `a/b/c`; brace powers next to operators (`a^{2} + b^{2}`, `I^{2}*R`, not `a^2 + b^2`). Prefer `\frac{a}{b}` for displayed math. |
| P1.9 | Quantity declarations are `name = value ; prefix ; unit` (or `value ; unit`). **Quote literal units and prefixes**: `d = 5 ; ; "m"`, not `d = 5 ; m`. Empty prefix is `; ;`; empty unit becomes abstract `u`. A prefix changes the canonical magnitude. |
| P1.10 | Unit text follows one-division-per-level grammar: `J/(kg*K)`, `m/s^2`, `kg*m/s` are valid; `J/kg/K`, `kg/m*s`, `m/s/kg` are not. Mixing SI and abstract `u` namespaces is fatal. |
| P1.11 | Coupled values must be linked: `link(a, b)` keeps drawables on one index. Members must be drawable, equal-count, and `rand` members must share identical `(min, max, step, max_index)`. Flip with `-name` only on non-first members. Use **one group per variable**. |
| P1.12 | There is no conditional. If a value must stay in a safe subset, hand-verify every `pick()` option, or freeze the value and vary the wording with stem variants, or write a static question. |
| P1.13 | Builders retry failed draws up to 50 times. Retries cover arithmetic failures, not structural invalidity. Never rely on retries to rescue a bad range. |

### P2 — Placeholders

| ID | Rule |
|---|---|
| P2.1 | `<<rv:val:name>>` / `<<rv:values:name>>` → drawn value: numeric via `fmt()`, string verbatim, or a formatted quantity when bound. `<<rv:values:name>>` is an alias of `<<rv:val:name>>`. |
| P2.2 | `<<rv:value:name>>` → preferred spelling in a bound quantity answer; renders identically to `<<rv:val:name>>` / `<<rv:values:name>>`. |
| P2.3 | `<<rv:expression:name>>` → expression source (with declared unit for a quantity); `<<rv:expression:name:a:b>>` substitutes only the listed numeric, earlier-declared arguments. |
| P2.4 | For a string pick, `<<rv:val:name>>` prints the word and `<<rv:expression:name>>` its LaTeX source; use `<<rv:expression:name>>` inside `$…$` for upright words. |
| P2.5 | **No double units.** Never append a literal unit after a bound quantity placeholder (`<<rv:value:p>> Pa` is wrong); `<<rv:val:SA>> cm²` is fine for a non-quantity `SA`. |
| P2.6 | A quantity placeholder inside `$…$` renders its unit as upright `\text{…}`; do not hand-write `\text{}` around it. |
| P2.7 | Names are exact and case-sensitive; `<<rv:expression:name:…>>` arguments must be numeric, declared earlier, and not the expression itself. |

### P3 — Answers and grading path

| ID | Rule |
|---|---|
| P3.1 | Choose the path first: **quantity/multi-value** if an answer binds a value placeholder to a quantity definition or an `rv-answer` fence resolves quantity slots; otherwise **numeric/text**. See rulebook §5 quick decision and §14. |
| P3.2 | Quantity grading is what accepts equivalent units and significant-figure variants. If the question asks for a unit, declare the answer as a quantity (`answer = 5 ; ; "cm"`) rather than writing `<<rv:val:answer>> cm`. |
| P3.3 | The `rv-answer` fence is **optional**. Without it, every quantity binding gets the default bounded policy: `unit-mode=expanded`, `display=atomic`, `prefix-policy=any`, `allowed-prefixes=auto`, `min-sigfigs=3`, `max-sigfigs=15`, `notation=auto`, `unit-optional=false`. Add a fence only to narrow or widen deliberately. |
| P3.4 | Numeric answer blocks: exactly **one** graded `<<rv:val:…>>` per block (only the first is graded). Every surviving block must use the same distinct name set. Put the unit-bearing template first for MCQ; list extra accepted spellings as separate blocks with the **same** placeholder name. |
| P3.5 | Never express two independent values as two same-count blocks with different names — that is fatal. Use a multi-binding `rv-answer` fence. |
| P3.6 | Text answers: keep them plain, list every accepted spelling as its own block, and remember grading is normalized whitespace/case equality only — no structural math equivalence and no Markdown stripping. |
| P3.7 | `rv-answer` grammar: globals `typed-mode` and `sep` only before the first header; one `name:` header per binding; no duplicate globals, headers, or keys; no unknown keys. Allowed binding keys: `unit-label`, `prefix-policy`, `allowed-prefixes`, `unit-mode`, `accept-units`, `display`, `min-sigfigs`, `max-sigfigs`, `notation`, `unit-optional`, `rv-currency`, `rv-comma`. |
| P3.8 | `min-sigfigs` / `max-sigfigs` are integers 1–15 with `max >= min`. Display uses `min`; `max` caps typed input. `unit-mode = list` requires `accept-units`; `prefix-policy = exact` only with `atomic` or an atomic `list`; `unit-optional = true` only when a bare number truly counts. |
| P3.9 | Currency is a quantity: `cost = 1000 ; ; unit("USD")` or `rv-currency: USD` on a binding. Supported codes: `USD EUR GBP JPY PHP AUD CAD CHF CNY INR KRW SGD`. `rv-comma: true` groups display only; `1,000` and `1000` always grade equal. |
| P3.10 | Multi-value: one binding per value, and **every** answer block is one complete variant over the same binding set. Use `typed-mode = either`, a non-empty `sep`, literal anchors between values, and never split one multi-value answer across variants. |

### P4 — Distractors

| ID | Rule |
|---|---|
| P4.1 | Distractors are MCQ-only; typed sessions ignore them, but bad placeholders still skip the note. Provide at least `choiceCount − 1` distinct, plausible wrong choices (three at the default of 4). |
| P4.2 | Text distractors are short, distinct, and never equal to the answer. Fewer than two total choices makes the card render typed. |
| P4.3 | Numeric blocks supply a **value**: first `<<rv:val:…>>`, else a numeric `<<rv:expression:…>>`, else the first literal number. Avoid incidental digits in words (`cm2` extracts nothing) and use `<<rv:val:…>>` for negatives or sub-one fractions. |
| P4.4 | `rv-distract` lives **inside** `## DISTRACTORS`, at most one fence, with lines `target, target <- anchor`. Anchor must be number, string, or quantity; targets must be defined, used by a distractor block, and cannot be their own anchor. A unit/prefix anchor is fatal. |
| P4.5 | Choose anchor ranges so no distractor can equal the answer on any draw. A number target under a quantity anchor renders in the anchor's unit and prefix, so it parses as a quantity choice. |
| P4.6 | Every conditioned target must appear in a `## DISTRACTORS` block; unused targets only warn and do nothing. |

### P5 — Invariant safety (the semi-procedural gate)

| ID | Rule |
|---|---|
| P5.1 | Before writing any `rv-def`, state the **invariant** in one sentence: what must remain true for every draw (solvable, integer result, factorable, same dimension, correct unit, unique answer). |
| P5.2 | **Always safe:** recomputed answers, linked draws, capped `rand`, coefficients shown in the stem, hand-verified `exprPick` options. |
| P5.3 | **Never randomize:** a coefficient controlling factorability, a value tied to a fixed structure, an exponent tuned for term combination, a shift that must stay symmetric, a ratio fixing a conic type, a parity-dependent count, or anything that can make the problem unsolvable. |
| P5.4 | A `pick()` set is safe only if **every option** preserves the invariant. Verify the full cross-product, not just matching indices. Use `link()` for genuinely coupled values. |
| P5.5 | If the invariant cannot be guaranteed by construction, downgrade that note to static (S5). Do not rely on warnings or retries to catch it. |

### P6 — Explanation

| ID | Rule |
|---|---|
| P6.1 | Use `## EXPLANATIONS` for a short derivation: formula → substitution with drawn placeholders → result. Placeholders resolve here too, so they must all exist. |
| P6.2 | Keep unit handling consistent with the answer path; never append a second unit after a quantity placeholder. |
| P6.3 | `---` inside explanations is a horizontal rule, not a block separator. Avoid it unless you want one. |

---

## 7. Templates

### 7.1 Static text question

````markdown
---
rv-category: fundamentals/logarithms
---
## QUESTIONS
What is the integer part of a logarithm called?

## ANSWERS
characteristic

## DISTRACTORS
mantissa
---
base
---
exponent

## EXPLANATIONS
For $\log_b x$, the integer part is the **characteristic** and the fractional part is the **mantissa**.
````

### 7.2 Static numeric question with accepted spellings

````markdown
---
rv-category: physics/energy
---
## QUESTIONS
A 2 kg mass moves at 10 m/s. Find its kinetic energy in joules.

## ANSWERS
100 J
---
100 joules

## DISTRACTORS
20 J
---
50 J
---
200 J

## EXPLANATIONS
$KE = \tfrac{1}{2}mv^2 = \tfrac{1}{2}(2)(10)^2 = 100\ \text{J}$.
````

### 7.3 Semi-procedural numeric question

````markdown
---
rv-category: physics/energy
---
## DEFINITIONS

```rv-def
m = pick(2, 4, 5)
v = rand(3, 9, 1)
KE = \frac{1}{2} m v^2
d1 = rand(1, 8, 1)
d2 = rand(210, 260, 10)
d3 = rand(300, 400, 25)
```

## QUESTIONS
A mass of $<<rv:val:m>>$ kg moves at $<<rv:val:v>>$ m/s.
Find its kinetic energy in joules.

## ANSWERS
$<<rv:val:KE>>\ \text{J}$
---
<<rv:val:KE>> joules

## DISTRACTORS
<<rv:val:d1>>
---
<<rv:val:d2>>
---
<<rv:val:d3>>

## EXPLANATIONS
$$KE = \frac{1}{2}mv^2 = \frac{1}{2}(<<rv:val:m>>)(<<rv:val:v>>)^2 = <<rv:val:KE>>\ \text{J}$$
````

### 7.4 Semi-procedural quantity question (explicit policy)

````markdown
---
rv-category: physics/pressure
---
## DEFINITIONS

```rv-def
F = pick(1500, 3000)
A = pick(2, 4)
p = F / A ; ; "Pa"
d1 = rand(200, 350, 50)
d2 = rand(500, 700, 100)
d3 = rand(2000, 4000, 500)
```

## QUESTIONS
A force of $<<rv:val:F>>$ N acts on an area of $<<rv:val:A>>$ m².
Find the pressure.

## ANSWERS

```rv-answer
p:
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

<<rv:value:p>>

## DISTRACTORS
<<rv:val:d1>>
---
<<rv:val:d2>>
---
<<rv:val:d3>>
```rv-distract
d1 <- p
d2 <- p
d3 <- p
```

## EXPLANATIONS
Pressure is force per area: $p = <<rv:val:F>> / <<rv:val:A>> = <<rv:value:p>>$.
````

### 7.5 Semi-procedural multi-value question

````markdown
---
rv-category: circuits/ohm
---
## DEFINITIONS

```rv-def
V = pick(6, 12) ; ; "V"
R = pick(2, 4) ; ; "Ω"
I = V / R ; ; "A"
```

## QUESTIONS
A resistor of $<<rv:val:R>>$ has $<<rv:val:V>>$ across it.
Find the voltage and the current.

## ANSWERS

```rv-answer
typed-mode = either
sep = ";"

V:
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false

I:
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

V = <<rv:value:V>>, I = <<rv:value:I>>
---
The voltage is <<rv:value:V>> and the current is <<rv:value:I>>.

## EXPLANATIONS
$I = V/R = <<rv:value:V>> / <<rv:value:R>> = <<rv:value:I>>$.
````

### 7.6 Quantity distractors conditioned to the answer

````markdown
---
rv-category: mechanics/force
---
## DEFINITIONS

```rv-def
m = rand(2, 6, 1) ; ; "kg"
a = rand(3, 7, 1) ; ; "m/s^2"
F = m * a
p = rand(45, 70, 5)
q = rand(1, 5, 1)
r = rand(75, 100, 5)
```

## QUESTIONS
A block of mass <<rv:value:m>> accelerates at <<rv:value:a>>.
What net force acts on it?

## ANSWERS

```rv-answer
F:
unit-mode = expanded
display = atomic
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

<<rv:value:F>>

## DISTRACTORS
<<rv:val:p>>
---
<<rv:val:q>>
---
<<rv:val:r>>
```rv-distract
p <- F
q <- F
r <- F
```
````

The target ranges lie outside the answer range (`m·a` = 6–42), so no choice can equal the correct answer (P4.5, P5.1).

---

## 8. Handoff contract

Return:

1. Every generated note as a separate file, written to the agreed output folder.
2. A manifest table with columns: `file`, `mode` (static / semi-procedural), `category`, `answer path` (text / numeric / quantity / multi-value), `bindings` (for semi-procedural), and `validation` (checks passed).
3. One short paragraph naming the invariant (S5/P5.1) for each semi-procedural note, or the reason a note stayed static.
4. Any assumptions or defaults you used (G2).

Do not modify plugin code, `main.js`, presets, session logs, or documentation. Do not claim a note is valid unless §9 passed.

---

## 9. Self-validation before handoff (V#)

Run this checklist mentally for **every** note. A harness can enforce the `must` rows.

| ID | Check |
|---|---|
| V1 | One question per note; path under review root, outside sessions; `.md`, LF, no BOM. |
| V2 | `---` frontmatter at byte 0 if used; `rv-category` matches folder or is intentionally omitted. |
| V3 | Exact H2 headings only; `QUESTIONS` and `ANSWERS` present and non-empty; no suffix on headings; no stray `###` masquerading as sections. |
| V4 | Blocks separated by bare `---`; no accidental `---` inside explanations or `rv-def`. |
| V5 | Fences only in their allowed sections; one `rv-answer`, one `rv-distract`, any number of `rv-def`. |
| V6 | Every placeholder resolves; names exact; expression arguments numeric and earlier; no placeholder inside `rv-def` except `<<rv:val:…>>` / `<<rv:values:…>>` / `<<rv:value:…>>`. |
| V7 | Numeric: one graded `<<rv:val:…>>` per block; same name set across surviving blocks; unit template first; accepted spellings reuse the same name. |
| V8 | Quantity: answer bound to a quantity definition; no literal unit after the placeholder; fence keys valid; sig-fig band sane; `unit-optional` intentional; currency code supported. |
| V9 | Multi-value: one binding per value; all variants complete with the same names; `sep` non-empty; no adjacent placeholders. |
| V10 | Distractors: enough distinct wrong choices; no incidental digits; no value equal to the answer on any draw; every `rv-distract` target defined and used. |
| V11 | Semi-procedural: invariant stated, every `pick()` option verified, coupled values linked, no `e` variable, no ambiguous `/` or unbraced power expressions, no random structural changes. |
| V12 | Explanation correct for all draws and free of double units. |
| V13 | Author-side check recommended after import: **Rescan notes**, review the Warning Note and Skipped Note panels with **Force show all warnings**, then run several real sessions with different seeds in both typed and MCQ modes. |

### Quick failure reference

A fatal error skips the whole note: missing `QUESTIONS` text, missing `ANSWERS`, fence-only answers, two answer/distractor fences, malformed `rv-def` line, ambiguous numeric expression, mixed `pick()` types, bad `link()` counts or parameters, undefined placeholder, mismatched same-count answer name sets, unknown `rv-answer` key, `unit-mode = list` without `accept-units`, inverted sig-fig band, or a non-finite answer after draws.

A warning does not skip the note but should be eliminated where possible: duplicate definition, dropped answer/distractor block, unused binding, unused conditioned target, broad `unit-mode = dimension/family`, shortfall of requested distractors, or a non-quantity `rv-answer` header.

---

## 10. Compact enforcement index

| Code | One-line statement |
|---|---|
| G1 | Ask semi-procedural vs static first; wait for an explicit answer. |
| G2 | Collect topic, count, folder/category, answer style, units, precision, choice count. |
| G3 | Semi-procedural draws recompute the answer; static has no definitions or placeholders. |
| G4–G15 | One question per file, valid path/frontmatter/headings/blocks/fences, resolvable placeholders, no invented syntax. |
| S1–S6 | Consistent, unique, non-duplicate set; stable filenames; downgrade unsafe questions to static; notes only. |
| P1.1–P1.13 | Definitions are typed, ordered, invariant-preserving draws with quoted units, linked coupling, safe expressions. |
| P2.1–P2.7 | Correct placeholder family, no double units, exact case-sensitive names. |
| P3.1–P3.10 | Correct grading path; one graded value placeholder per block; optional fence used deliberately; valid keys; complete multi-value variants. |
| P4.1–P4.6 | Enough plausible wrong choices; value extraction rules; correct `rv-distract` placement and targets. |
| P5.1–P5.5 | State and prove the invariant; no structural randomization; verify the full cross-product. |
| P6.1–P6.3 | Explanation derives the answer for every draw. |
| V1–V13 | Validate structure, placeholders, grading, distractors, invariants, and author-side session checks before handoff. |
