# Active Review — Authoring Rule Book

> **Baseline checkpoint.**
> This is the authoring contract for **Active Review** (`active-review` 2.0.0,
> minimum Obsidian 1.13.0). It describes what the shipped parser, session
> builders, unit registry, and grader in `obsidian-active-review/src` actually
> accept and do.
>
> **Audience.** Authors writing quiz notes and reviewers checking
> them.
>
> **How to use this document.** Author against these rules exactly. Do not
> invent sections, keys, functions, placeholders, or grading behaviour. Where a
> rule gives a rendered result, that result is what the current code produces.
>
> **Companions.** [[00_Active Review Plugin Workflow]] owns architecture, session
> configuration, and UI behaviour. [[02_Preset Import & Export]] owns presets
> and transfer formats.

## 0. Accepted format at a glance

| Construct | Accepted form | Where |
|---|---|---|
| Definition fence | ```` ```rv-def ```` / ```` ```rv-definitions ```` | Only under `## DEFINITIONS` |
| Answer fence | ```` ```rv-answer ```` / ```` ```rv-answers ```` | Only under `## ANSWERS` |
| Distractor fence | ```` ```rv-distract ```` / ```` ```rv-distractors ```` | Only under `## DISTRACTORS` |
| Sections | `DEFINITIONS`, `QUESTIONS`, `ANSWERS`, `DISTRACTORS`, `EXPLANATIONS` | Case-insensitive names |
| Value placeholder (all spellings are aliases) | `<<rv:val:NAME>>`, `<<rv:values:NAME>>`, `<<rv:value:NAME>>` | Content sections |
| Expression placeholder | `<<rv:expression:NAME>>` | Content sections |
| Partial expression | `<<rv:expression:NAME:arg1:arg2>>` | Content sections |
| Definition functions | `rand`/`random`, `pick`, `link` | `rv-def` |
| Unit constructors | `unit("m")`, `prefixUnit("k")` | `rv-def` |

Aliases: `rv-def`/`rv-definitions`, `rv-answer`/`rv-answers`, `rv-distract`/`rv-distractors`, `rand`/`random`; `val`, `values`, and `value` placeholders are interchangeable (§13.1).

---

# Part I — The note

## 1. Note model and placement

A quiz note contains exactly one question. It may contain several stem
variants, several accepted answer variants, several distractors, and one
explanation. Different problems belong in different files.

- The file must sit under the configured review folder (default `review/`).
- The file must end with `.md`.
- Subfolders become category path segments.
- The session subfolder (default `!rv-sessions`) is never scanned.
- Any `.md` file under the review folder is scanned; a file without quiz structure is reported as a skipped note.

| Header | Required | Purpose |
|---|---|---|
| `## DEFINITIONS` | Optional | Variables, unit declarations, link groups |
| `## QUESTIONS` | Required | One stem variant per block |
| `## ANSWERS` | Required | Accepted answers and/or the `rv-answer` fence |
| `## DISTRACTORS` | Optional | Authored wrong choices and/or `rv-distract` |
| `## EXPLANATIONS` | Optional | Markdown shown after submission |

`## QUESTIONS` with no content is fatal (`missing "## QUESTIONS" text`).
`## ANSWERS` with no blocks and no fence is fatal (`missing "## ANSWERS"`). A
fence-only answers section is fatal (`rv-answer: requires at least one ## ANSWERS block`).

### 1.1 Section recognition

The scanner uses `^##\s+(.+?)\s*$`:

- Line starts at column 0 with two `#` followed by whitespace.
- Names are lowercased, so `## Questions` equals `## QUESTIONS`.
- `###` headings are not sections.
- A suffix breaks recognition: `## QUESTIONS (easy)` is not the section, unless
  the suffix is a header marker (§3.2).
- Unknown H2 headings are ignored but still end the previous section.
- Content before the first H2 is ignored.
- A duplicate recognized heading replaces earlier content; only content after
  the last occurrence is used. Marker sets accumulate across duplicates.
- Fenced code beginning at column 0 is tracked; a line inside it is not a
  header. Indented fences are not recognized.

### 1.2 Markdown in blocks

Everything in a block is raw Markdown: single newline = space, blank line =
paragraph, trailing `\\` or two spaces = line break, and `$…$`, `$$…$$`,
callouts, lists, tables, wiki links, embeds, Mermaid, and footnotes render. The
plugin does not strip `%%` comments; do not rely on them in content sections.

## 2. Frontmatter

Frontmatter is recognized only when the opening `---` is at **byte 0**. A BOM
or leading blank line prevents detection. The closing delimiter is a line
containing `---`.

| Key | Required | Default | Effect |
|---|---|---|---|
| `rv-category` | No | Folder path | Declared category; fallback only at review root |
| `rv-priority` | No | `100` | Lower runs earlier in priority order |
| `rv-exclude` | No | `false` | Any value other than empty, `false`, or `no` excludes |

`rv-type` and `rv-tags` are ignored. Other unknown keys are ignored and left
untouched.

```yaml
---
rv-category: physics/kinematics
rv-priority: 50
rv-exclude: false
---
```

YAML quirks:

- Inline `#` is a comment only at start or after whitespace; `#` inside quotes
  is preserved.
- One pair of surrounding single/double quotes is stripped.
- `rv-priority` accepts integers, quoted integers, and floats; floats floor. A
  non-finite/unparseable value becomes `100` with a warning.
- `rv-exclude: 0`, `yes`, and any non-empty value other than `false`/`no`
  exclude. An empty value includes.
- `rv-exclude` and `rv-priority` are read line-wise from the frontmatter body.

### 2.1 Category and Manage Questions

Session category resolution:

1. If the note is inside a review subfolder, the folder path wins.
2. Otherwise, `rv-category`.
3. Otherwise, empty.

| Situation | Category used |
|---|---|
| Subfolder note, no `rv-category` | Folder |
| Subfolder note, `rv-category` equals folder (CI) | Folder |
| Subfolder note, `rv-category` differs | Folder |
| Root note, with `rv-category` | Declared value |
| Root note, no `rv-category` | Empty |

Manage Questions is stricter: a note is manageable only when its **declared**
`rv-category` equals its actual folder path, case-insensitive. A root note with
no declared category matches the empty folder path.

Practical consequences:

- A subfolder note with no `rv-category` is in the session pool but not listed
  as matched in Manage Questions.
- A subfolder note must declare exactly its folder path to be manageable.
- A root note with a non-empty `rv-category` needs a move.
- **Arrange move** writes the matching path; **Arrange update** clears it.

Priority: lower = earlier; default 100; floats floor; invalid falls back to 100
with a warning; priority is not part of seed derivation; changing it after a
session is frozen does not change that session's order.

## 3. Headers, markers, and blocks

### 3.1 Header markers

Write markers at the **end** of the header line, separated by whitespace. Both
may appear together, in any order, and may repeat.

| Marker | Accepted on | Effect |
|---|---|---|
| `<!--ignore-warnings-->` | Any section | Hides warnings attributed to that section |
| `<!--debug-called-definitions-->` | `QUESTIONS`, `ANSWERS`, `DISTRACTORS`, `EXPLANATIONS` | Shows placeholders literally |

````markdown
## ANSWERS <!--ignore-warnings--> <!--debug-called-definitions-->
````

- Markers must end the header line; a marker on a content line does nothing.
- `<!--ignore-warnings-->` only hides warnings; **Force show all warnings**
ignores it.
- `<!--debug-called-definitions-->` is silently ignored on `DEFINITIONS` and
unknown headings.
- Percent-style markers are not recognized; there is no compatibility layer.

### 3.2 Block splitting

`QUESTIONS`, `ANSWERS`, and `DISTRACTORS` split on a line whose trimmed content is exactly `---`, outside a fenced block.

- One block with no separator = one item.
- `A` / `---` / `B` = two items; a multi-line block is one item.
- Leading, trailing, and consecutive separators create empty blocks, ignored.
- `----`, `***`, `___`, and `--- text` are not separators.
- `---` inside a fenced code block is literal.
- `---` in `## EXPLANATIONS` is a horizontal rule.
- `---` inside `rv-def` reaches the definition parser and is a parse error.

To show a horizontal rule in a block, use `***`, `___`, or a code span.

### 3.3 Embedded quiz blocks in question notes

The `active-review` code block is only interpreted **outside** the configured review root. Inside the root — including question cards, answer blocks, and explanations — it is rendered as a plain code block. It does not start a session, is not recorded as skipped, and produces no warning. Keeping an example in a question note is therefore safe:

````markdown
## EXPLANATIONS

This is how to embed a session in a host note:

```active-review
sessionPreset: Daily 10
```
````

Host notes outside the review root use the same fence to mount an embedded quiz. See `03_Embedded Quiz Blocks` for the full key list, include/exclude rules, and override precedence.

## 4. Literal rendering

Append `<!--debug-called-definitions-->` to a content section header:

````markdown
## QUESTIONS <!--debug-called-definitions-->
````

Every placeholder in that section is shown exactly as written:

- `<<rv:val:name>>`, `<<rv:values:name>>`, `<<rv:value:name>>`;
- `<<rv:expression:name>>`, `<<rv:expression:name:a:b>>`.

The definition is not called and the text is not evaluated. The flagged section is exempt from placeholder validation: names need not exist and call arguments are not checked.

Scope is per section:

- `QUESTIONS`: every stem variant.
- `ANSWERS`: correct choice and every accepted answer. The note is text mode
unless a quantity binding exists; the student types the literal text.
- `DISTRACTORS`: authored distractor text; in numeric mode, authored blocks are
shown literally in place of generated numeric distractors.
- `EXPLANATIONS`: explanation text only.

A placeholder inside a fenced code block is still processed unless its whole section is flagged. There is no per-placeholder escape. Do not flag a numeric answer section unless the literal
placeholder text should be the answer.

## 5. Quick decision

```text
Does ## ANSWERS contain an rv-answer fence, or a val bound to a quantity rv-def?
│
├─ YES → Quantity/multi-value path
│         · quantity definitions carry value, prefix, unit
│         · one binding = scalar quantity; two or more = multi-value
│         · typed grading is unit-aware with a significant-figure band
│         · MCQ: correct + up to `choiceCount − 1` generated/author choices
│
└─ NO  → Numeric/text path
          · prune answer blocks by distinct val count (§14.2)
          · numeric if any surviving block's first val is a non-string pick,
            or if any quantity slot exists
          · otherwise text
          · numeric typed grading: Number(input) within 0.001, else accepted
            normalized strings
          · text typed grading: normalized whitespace/case equality only
          · MCQ: correct + up to `choiceCount − 1` choices; <2 total choices makes the card typed

Always:
· every placeholder must resolve unless its section is literal-rendered
· blocks are separated by a bare --- line
· headers are exactly the five plural names, case-insensitive
· one rv-answer fence, one rv-distract fence, any number of rv-def fences
```

---

# Part II — Definitions

## 6. `## DEFINITIONS` and `rv-def`

Only ```` ```rv-def ```` or ```` ```rv-definitions ```` under `## DEFINITIONS` is parsed. Multiple fences are concatenated in order. A heading with no fence defines nothing.

- An **empty** fence is valid and defines nothing.
- A non-empty fence that produces zero definitions is fatal:
`## DEFINITIONS block is empty`.
- A `rv-def` fence under another heading is inert and renders as code.

Each non-empty line is exactly one of:

```text
name = rhs
link(name_a, name_b, ...)
```

Blank lines are ignored. Anything else is fatal: `rv-def: cannot read "…" (use e.g. x = rand(3, 5, 1) or f = x^{3})`.

### 6.1 Names and references

- Left side: `[A-Za-z][A-Za-z0-9_]*`; case-sensitive.
- On the right, bare letters are read one character at a time by the numeric
evaluator unless declared as a multi-letter name.
- Wrap multi-letter RHS names in `\var{…}` or `\variable{…}`.

```text
s  = pick(4, 6, 8)
h  = rand(5, 20, 1)
LA = 6 \cdot s \cdot h
SA = \var{LA} + 2s
```

`SA = LA + 2s` means `S · A` on the right. `\text{speed} = 10` is a parse error; write `speed = 10`. Avoid naming a variable `e` (§32.4).

Definitions process in file order and may reference only earlier names; `link()` name checks are the exception and run after all lines.

A duplicate name replaces the earlier definition with a warning: `variable "x" is defined twice — last definition wins`. Case differences are distinct.

### 6.2 Parse-time environment

Numeric `rand` and `pick` place their first possible value in the parse-time environment; fixed numbers and computed expressions add their value. Quantity declarations do **not** enter the
numeric environment. Expressions are validated against first values; a later expression can be valid at parse time but fail for some draws. Builders retry up to 50 draws, then skip the card.

## 7. Scalar RHS forms

| Form | Example | Kind | Notes |
|---|---|---|---|
| Integer range | `a = rand(3, 5, 1)` | `rand` | draws 3, 4, 5 |
| Decimal range | `b = rand(0.1, 1.0, 0.1)` | `rand` | stepwise |
| Capped range | `c = rand(1, 20, 1, 10)` | `rand` | sample cap |
| Numeric pick | `d = pick(2, 5, 8, 11)` | `pick` | one value |
| String pick | `u = pick("m", "km")` | `stringPick` | text value |
| LaTeX string pick | `u = pick(\text{m}, \text{km})` | `stringPick` | value `m`, source `\text{m}` |
| Expression pick | `e = pick(x^2, 2x + 1)` | `exprPick` | draws an index |
| Mixed numeric/expression | `e = pick(5, x^2)` | `exprPick` | valid |
| Fixed number | `f = 4` | `fixed` | constant |
| Computed expression | `g = \frac{a}{2}` | `expr` | evaluated per draw |
| Explicit reference | `h = \var{ab} + \var{a}` | `expr` | exact names |
| Quoted string | `s = "a push or pull"` | `fixed` | string |
| Unit set | `u = pick(unit("m"), unit("s"))` | `unit` | drawable |
| Prefix set | `p = pick(prefixUnit("k"), prefixUnit("m"))` | `prefix` | drawable |
| Quantity declaration | `d = 5 ; ; "m"` | `expr`/`rand`/`exprPick` | §9 |
| Quantity pick | `d = pick(1; ; "m", 2; ; "s")` | `quantityPick` | §8.3 |

### 7.1 `rand` / `random`

`rand(first, last, step)` draws one value per session. `rand(first, last, step, max_index)` produces a reduced sample. The endpoints may be written in either direction and may carry any sign combination:

```text
low  = min(first, last)
high = max(first, last)
dir  = last < first ? -1 : 1
n  = floor((high − low) / step + 1e-9) + 1
kk = min(max_index, n)
if kk == n: gap = 1, max_offset = 0
if kk == 1: gap = 0, max_offset = n − 1
else:       gap = floor((n − 1) / (kk − 1)),
            max_offset = (n − 1) − (kk − 1) * gap
value = first + dir * step * (offset + index * gap)
```

- `step > 0`; `first` and `last` may be any finite numbers; `max_index` a positive integer.
- `rand(20, 1, 1)`, `rand(-5, 5, 1)`, `rand(5, -5, 1)`, and `rand(-1, -10, 1)` are all valid.
- Every value stays inside the inclusive endpoints, `[low, high]`; the authored direction controls linked pairing.
- `max_index` is a cap, not a promise.
- `rand(1, 5, 1, 10)` behaves like `rand(1, 5, 1)`.

| Call | Possible session sets |
|---|---|
| `rand(1, 20, 1, 10)` | `[1,3,5,…,19]` or `[2,4,6,…,20]` |
| `rand(1, 20, 1, 7)` | `[1,4,7,…,19]` or `[2,5,8,…,20]` |
| `rand(1, 20, 1, 8)` | six distinct sets |
| `rand(1, 5, 1, 1)` | `[1]` … `[5]` |

### 7.2 Computed expressions and string picks

- A RHS that is not a function, fixed number, string, pick, unit expression, or
quantity declaration is evaluated as a numeric expression.
- It may use only earlier names.
- It is evaluated once at parse time and again per draw.
- `<<rv:expression:name>>` shows the source, not the value.
- The shared criterion (§11) runs before the evaluator; an ambiguous numeric
RHS is fatal.

String picks:

- `pick("force", "mass")` stores `force`, `mass`.
- `pick(\text{force}, \text{mass})` stores values with display sources.
- `<<rv:val:term>>` prints the plain value; `<<rv:expression:term>>` prints the
LaTeX source.
- Inside `$…$`, use `<<rv:expression:term>>` for upright words.
- String picks cannot enter numeric arithmetic.

### 7.3 ExprPick

Every option is treated as an expression source; numeric literals may be mixed with expressions. Each option passes the criterion, then is evaluated at parse time with the current
environment. At session time the drawn option is evaluated with drawn values. `<<rv:expression:name>>` shows the selected source; `<<rv:val:name>>` shows its value.

```text
x = rand(2, 9, 1)
expr = pick(x^2, 2x + 1, x - 3, 3x + 2)
```

A declared variable may be an option on its own:

```text
a = rand(1, 5, 1)
b = rand(2, 6, 1)
c = rand(3, 7, 1)
p = pick(\var{a}, \var{b}, \var{c})
```

`p` is an `exprPick` of three options; each option is the drawn value of the
variable it names. Multi-letter names must be wrapped in `\var{…}` or
`\variable{…}` (§6.1) and the variable must be declared earlier. The declared
data type still decides the flavour — see §8.

## 8. `pick()` flavours

`pick(...)` resolves in this order:

1. **All quantity literals** → `quantityPick`, e.g.
`pick(1; ; "m", 2; ; "s")`.
2. **All unit expressions** → `unit` drawable set, e.g.
`pick(unit("m"), unit("s"))`.
3. **All prefix constructors** → `prefix` drawable set, e.g.
`pick(prefixUnit("k"), prefixUnit("m"))`.
4. **All strings / `\text{…}`** → `stringPick`.
5. **All numeric or expression options** → `pick` (no expressions) or
`exprPick` (at least one expression).

| Mixed call | Outcome |
|---|---|
| `pick(1, 2, 3)` | Numeric pick |
| `pick(1, x^2, 3)` | ExprPick; valid |
| `pick("a", "b")` | String pick |
| `pick(\text{one}, \text{two})` | String pick |
| `pick(1, "a")` | **Fatal**: mixes string and numeric values |
| `pick("a", 3)` | **Fatal**: same |
| `pick(\text{one}, 2)` | **Fatal**: same |

A numeric literal combined with an expression is **not** a mix error; it is an exprPick whose literal option is a constant expression.

### 8.1 Declared variables as options

A declared variable may be written directly inside `pick(...)`. Wrap it in
`\var{…}` or `\variable{…}`; multi-letter names must always be wrapped (§6.1).
The variable must be declared before the `pick()` line, and its declared data
type decides the outcome:

| Option | Outcome |
|---|---|
| `pick(\var{a}, \var{b}, \var{c})` with numeric/expression `a`, `b`, `c` | `exprPick`; each option is that variable's drawn value |
| Bare single-letter numeric name, e.g. `pick(a, b)` | Same result; a bare multi-letter name is read one character at a time (§6.1) |
| Bare name of a unit or prefix variable | `unit` / `prefix` drawable set (§9.6) |
| Bare name of a string variable | Read as a unit reference (§8.2); fatal if its text is not a unit |
| `\var{s}` where `s` is a string variable | **Fatal**: `cannot use string variable "s" in a math expression` |
| `\var{q}` where `q` is a quantity declaration | **Fatal**: quantity declarations do not enter the numeric environment |

### 8.2 Unit constructors

The only constructors are `unit("m")` and `prefixUnit("k")`:

- Each takes exactly one argument.
- A quoted argument is a literal unit/prefix symbol.
- An unquoted bare name is looked up as a previously declared unit/prefix
variable.
- `unit(...)` may also take a previously declared string variable.
- `prefix(...)` does not exist; use `prefixUnit(...)`.
- `unit(N, kN)` does not exist; use `pick(unit("N"), unit("kN"))`.
- `unit("")` is the empty unit; `prefixUnit("")` is the empty prefix.
- Wrong arity or an unknown unit/prefix is fatal.

### 8.3 Quantity picks

```text
d = pick(1; ; "m", 2; ; "s")
```

Each option is `value ; prefix ; unit` or `value ; unit`; prefix may be empty; an empty unit becomes abstract `u`. Quoted unit/prefix text is parsed as a unit/prefix; a bare unit identifier
is a reference to an earlier unit variable. Stacked prefixes are rejected.

## 9. Quantity declarations and unit algebra

### 9.1 Declaration syntax

A definition whose RHS contains one or two top-level semicolons is a quantity declaration:

```text
name = value ; unit
name = value ; prefix ; unit
```

```text
d = 5 ; ; "m"
t = 2 ; ; "s"
v = d / t
E = 1500 ; "k" ; "J"
A = s^{2} ; ; "u^2"
R = pick(2, 4) ; ; "Ω"
```

- Split on top-level `;`, respecting quotes and brackets.
- At most three fields; more is fatal.
- Value is required; empty is fatal.
- Prefix may be empty.
- Unit may be empty; it becomes abstract `u`.
- **Quote literal units and prefixes.** An unquoted bare identifier is a
reference to an earlier unit/prefix variable. `d = 5 ; m` looks for a variable named `m` and fails; write `d = 5 ; "m"` or `d = 5 ; unit("m")`.

### 9.2 Resolved quantity

A quantity stores:

- `canonical`: value converted to base SI/abstract units;
- `unit`: the declared unit expression;
- `prefix`: a global display prefix, if declared.

```text
canonical = magnitude × prefixScale(prefix) × unit.scale + unit.offset
```

A declared prefix changes the canonical magnitude, not just the display.

### 9.3 Magnitude expressions

- A literal magnitude is fixed.
- `rand(...)` as the value field creates a randomized quantity magnitude.
- `pick(...)` as the value field creates a drawable quantity magnitude, e.g.
`R = pick(2, 4) ; ; "Ω"`. Every option must be a number or a numeric
expression.
- Any other value expression is evaluated with the numeric environment at
session time; earlier numeric definitions may be used.
- Quantity declarations do not enter the numeric environment, so numeric
expressions cannot use them.
- When the value expression already uses earlier quantity definitions, its unit
comes from that arithmetic. Do **not** add an explicit `; ; "unit"` — it is
redundant and fatal. Write `I = V / R`, not `I = V / R ; ; "A"`.
- The shared expression criterion does **not** run on a quantity magnitude
expression or on quantity arithmetic; an ambiguous magnitude there is accepted.

### 9.4 Quantity arithmetic

If a RHS depends on earlier quantity values and is not a declaration or constructor, the quantity evaluator handles it:

```text
F = m * a
p = F / A
v = d / t
E = \frac{1}{2} m v^{2}
```

- `+`/`-` require the same dimension.
- `*`/`/` combine dimensions and scales.
- Powers require integer exponents.
- `sqrt()` requires even unit exponents.
- `sin`/`cos`/`tan` accept angles or dimensionless values.
- `log`/`ln`/`exp` require dimensionless values.
- `abs` preserves the unit.
- Implicit multiplication works (`2a`, `a(b)`).
- Multi-character names need `\var{…}` / `\variable{…}`.
- Mixing SI and abstract namespaces is fatal.

### 9.5 Unit expression grammar

Unit text is parsed by the unit registry, not the numeric evaluator: factors are identifiers or parenthesised groups, combined by `*` and `/`, with `^n` integer exponents. `m*m` equals
`m^2`. One division per level at most; nothing may be multiplied after a division.

Valid: `kg*m/s`, `N*m`, `J/(kg*K)`, `m/s^2`, `lb/ft^3`, `BTU/(h*ft*deltaF)`, `u^2`.

Invalid: `kg/m*s` (write `kg*m/s` or `kg/(m*s)`), `J/kg/K` (write `J/(kg*K)`), `m/s/kg` (write `m/(s*kg)`).

### 9.6 Unit and prefix variables

```text
u = unit("m")
u = unit("kg/m^3")
u = pick(unit("m"), unit("s"))
u = m / s
p = prefixUnit("k")
p = pick(prefixUnit("k"), prefixUnit("m"), prefixUnit(""))
```

- A later quantity declaration may reference a unit variable by bare name in
its unit field, or a prefix variable by bare name in its prefix field.
- Drawable unit/prefix variables vary per session.
- If a referenced prefix variable is drawable, the resolved quantity's prefix
varies.
- `prefixUnit("")` is the empty prefix.

### 9.7 Abstract units and temperatures

The abstract namespace contains only `u`, with phrase aliases (`square units`, `units squared`, `sq u`, `cubic units`, `units cubed`, `abstract unit`, `arb. unit`).

- Write `unit("u^2")` or `A = s^{2} ; ; "u^2"`.
- Abstract units do not accept SI prefixes. A prefix written on an abstract quantity is dropped silently when the quantity resolves, and the value switches to scientific notation instead of raising a fatal error.
- `u^2` is a real dimension, not a dimensionless value.

`K`, `°C`, `°F`, and `°R` are absolute temperature units with offsets; `deltaC` and `deltaF` are interval units.

- An absolute unit may be used only alone, first power.
- It cannot be combined with another unit in a product or quotient.
- It cannot take a prefix.
- Absolute and interval temperatures never satisfy each other's checks.
- Use `deltaC`/`deltaF` in compounds such as `BTU/(lb*deltaF)`.

## 10. `link()`

`link(a, b, …)` keeps drawable definitions on the same draw index.

```text
a = rand(1, 20, 1, 5)
b = rand(1, 20, 1, 5)
link(a, b)
```

A group may list any number of members. The first member sets the shared index
and the rest follow it:

```text
a = rand(1, 20, 1, 5)
b = rand(1, 20, 1, 5)
c = rand(1, 20, 1, 5)
link(a, b, c)
```

Prefix a member with `-` to **flip** it: it reads the shared index in reverse,
so the leader's first value pairs with the flipped member's last:

```text
a = rand(1, 20, 1)
b = rand(1, 20, 1)
link(a, -b)
```

Here index 0 draws `a = 1` and `b = 20`, and the last index draws `a = 20` and
`b = 1`.

- Minimum two members.
- Members must be drawable: `rand`, `pick`, `stringPick`, `exprPick`, `unit`,
`prefix`, or `quantityPick`.
- A **fixed unit or prefix** is accepted.
- Fixed numbers, computed expressions, and non-pick
quantity definitions are rejected.
- All members must have the same effective count.
- All `rand` members must share identical `(min, max, step, max_index)`.
- A flip marker may appear on any member **except the first**; the first
member sets the shared index, so `link(-a, b)` is fatal:
`link(): the first member cannot be flipped ("a") — it sets the shared draw index`.
- `link()` may reference later definitions; checks run after all lines.
- N-way groups are supported.

| Kind | Effective count |
|---|---|
| `pick`, `stringPick`, `exprPick`, `unit`, `prefix`, `quantityPick` | Number of values/arguments |
| `rand` | `min(max_index, floor((last−first)/step + 1e-9) + 1)` |
| `rand` without cap | Full range length |
| Fixed number / computed expression | Rejected |

The validator does **not** reject the same name in two `link()` groups, or
repeated inside one group. Draw resolution applies groups in file order and
later draws overwrite earlier ones. Use one group per variable.

## 11. The expression criterion

### 11.1 Where it applies

It runs on:

- plain numeric `rv-def` RHS expressions;
- every `exprPick` option;
- typed math comparison inside `matchAcceptedText` (the scalar quantity
fallback).

It does **not** run on:

- the value expression of a quantity declaration (`x = … ; ; "J"`);
- quantity arithmetic definitions (`F = m*a` with quantity operands).

Those are evaluated by the quantity evaluator with the same power grouping and associativity rules. An ambiguous quantity expression is not rejected by this criterion; group it explicitly.

### 11.2 Rule

Every expression is parsed into a group tree, and every layer is checked independently. A group boundary changes the parent layer; it never repairs an ambiguous child.

**Ambiguous — fatal for numeric RHS/exprPick**

| Form | Why |
|---|---|
| `a/b*c` | `/` followed by `*` at the same layer |
| `a/b/c` | `/` followed by `/` |
| `ab/cd` | reads as `a*b/c*d`: `/` then `*` |
| `(a/b*c)` | grouping the whole child does not fix the child layer |
| `a^b + c`, `a^b*c`, `a^b/c` | power followed by an operator |
| `a^b^c + d`, `a^b^c*d` | power chain followed by an operator |
| `a/b^c`, `x / a^b^c` | `/` before an ungrouped power |
| `a^bc`, `a^2x`, `a^b(c)` | implicit multiplication after an exponent |

**Valid**

| Form | Why |
|---|---|
| `a*b`, `a*b*c` | product chain |
| `a*b/c`, `b*c/d` | `*` followed by `/` |
| `(a/b)*c`, `a/(b*c)` | group boundary separates operators |
| `a^b`, `a^b^c`, `a^b^c^d` | power/chain at the **end** of its layer |
| `a^(b) + c`, `(a^b) + c`, `a^(b+c)` | exponent, whole power, or exponent group bounded |
| `(a^b^c) + d`, `a^(b)^(c) + d`, `a^(b^c) + d` | chain bounded by grouping |
| `a + b^c`, `a*b^c`, `x*a^b^c` | term boundary or product before a final power |
| `a/(b^c)`, `(a/b)^c` | base or whole power grouped |
| `\frac{a}{b}`, `\frac{a}{b} \cdot d`, `\frac{b}{cd}` | LaTeX braces group the division |

- A power chain is right-associative: `a^b^c` = `a^(b^c)`. Braces or
  parentheses around a single exponent are only a group, so `a^{b}` =
  `a^(b)`:
  - `2^2^2^2` = `2^(2^(2^2))` = `2^(2^4)` = `2^16` = 65536.
  - `2^{2}^{2}^{2}` and `2^(2)^(2)^(2)` have the same value.
- Grouping the **whole power** changes the sequence: `(a^b)^c` =
  `a^(b*c)`.
  - `((2^2)^2)^2` = `(2^2)^(2*2)` = `(2^2)^4` = `2^(2*4)` = `2^8` = 256.
  - `(2^2)^2^2` is also 256: the grouped base is squared, then the right
    chain applies to that result.
- To select a different operation order, group explicitly: `2^(2^2^2)` =
  65536, but `((2^2)^2)^2` = 256. In general, `a^(b^c)` keeps `b^c` as the
  exponent, while `(a^b)^c` is `a^(b*c)`.
- A sign in front of a power applies after the power: `-2^2` =
  `-(2^2)` = -4, while `(-2)^2` = 4.
- Everyday forms need braces: `a^{2} + b^{2}`, `I^{2}*R`, `v^{2}/r`, not
  `a^2 + b^2`, `I^2*R`, `v^2/r`.
- Recursive layers are checked: `a^{b*c/d}` valid, `a^{b/c*d}` and
  `a^{b/c/d}` not.
- Symbols must already be declared (`link()` name checks excepted). `e` and
`\pi` are builtin constants.

Failure reports the line, definition, source, group path, and a fix hint:

```text
rv-def: line 3: g = a/b*c — "a/b*c" is ambiguous: group the division before multiplying, e.g. (a/b)*c, or group the divisor, e.g. a/(b*c)
```

Numeric expressions support `+ - * /`, `\cdot`, `\times`, `^`, postfix `!`
(factorial), `\frac`, `\dfrac`, `\tfrac`, `\sqrt`, `\sqrt[n]`, parentheses/braces, implicit multiplication, `\sum_{i=a}^{b}` / `\prod_{i=a}^{b}` (term-level body), `\binom`, `\C`/`\comb`, `\P`/`\perm`, `\abs`, `\round`, `\roundTo`, `\radToDeg`, `\degToRad`, `\min`, `\max`, the trigonometric/log functions, and `x_i`-style subscripts. They ignore `\left`, `\right`, `\displaystyle`, `\quad`, `\qquad`, `\,`, `\;`, `\!`, `\ `.

`\int` and `\lim`, plus the standard derivative form `\frac{d}{dx} … \big|_{x=a}`, are evaluated **numerically** (see below). `\partial`, `\infty`, `\pm`, `\leq`, `\geq`, `\neq`, `\approx`, `\equiv`, `\to`, and `\cdots` are display-only: they are accepted in text and in typed answers but rejected inside a numeric `rv-def` expression.

Everything the plugin prints is standard LaTeX valid in both MathJax and KaTeX: `\abs(x)` prints as `\left|x\right|`, `\var{name}` as the identifier itself (`\mathrm{name}` when multi-letter), `\C`/`\P` as upright `\mathrm{C}`/`\mathrm{P}`, and plugin functions such as `\round` as `\operatorname{round}`.

### Calculus: numerical evaluation

Calculus operators produce numbers; the plugin does not derive or integrate symbolically.

- `\lim_{x \to a} body` — two-sided limit. It is finite only when the left and right limits both exist and agree. `a^{+}` / `a^{-}` (or `a^+` / `a^-`) requests a one-sided limit. When both sides diverge to the same infinity the result is `±Infinity`; opposite infinities, a finite/infinite mismatch, or a side that does not converge is undefined. The variable can be any symbol (`t`, `z`, …), not only `x`.
- `\frac{d}{dx} body \bigg|_{x=a}` — derivative at the point `a`. The denominator may use any variable (`\frac{d}{dz} … \bigg|_{z=a}`), and `\frac{d^{n}}{dx^{n}}` gives the nth derivative (`n` from 1 to 4).
- `\frac{d}{dx} body` without the evaluation bar — derivative at the current drawn value of `x`.
- `\int_{a}^{b} body\,dx` or `\int_{x=a}^{b} body` — definite integral only; indefinite integrals are not supported. Nested integrals such as `\int_{x=0}^{1} \int_{y=0}^{1} xy\,dy` evaluate recursively.

Limits and derivatives use Richardson extrapolation; definite integrals use adaptive Simpson quadrature. Undefined results are `NaN`, so a definition that depends on them is reported as non-finite when the answer is built.

---

# Part III — Questions and placeholders

## 12. `## QUESTIONS`

- Each `---`-separated block is one stem variant.
- A variant may span lines and use full Markdown.
- Variants must ask the same question in different wording.
- One block with no separator is the normal single-variant case.
- Every placeholder must resolve unless the section is literal-rendered.
- `%%` comments are not removed.

````markdown
## QUESTIONS
A right triangle has legs $a = <<rv:val:a>>$ cm and $b = <<rv:val:b>>$ cm.

> [!tip] Hint
> Use $a^2 + b^2 = c^2$.

Find the hypotenuse $c$.

$$c = \sqrt{a^2 + b^2}$$
````

## 13. Placeholders

### 13.1 Families

| Placeholder | Resolves to |
|---|---|
| `<<rv:val:name>>` | Numeric value via `fmt()`, string verbatim, or a quantity if `name` is a quantity |
| `<<rv:values:name>>` | Alias of `val`; same rendering |
| `<<rv:value:name>>` | Conventional spelling for a bound quantity; otherwise the same as `val` |
| `<<rv:expression:name>>` | Expression source rendered canonically |
| `<<rv:expression:name:var1:var2>>` | Source with only listed arguments substituted |

`val`, `values`, and `value` take the same parser path: one extraction, one
formatter, one answer-binding check. Only the declared data type and the
presence of a binding change the rendering (§14.1).

The **declared data type of the definition** decides what the value and
expression placeholder families render — six forms in total:

| Placeholder | Numeric definition | Quantity definition |
|---|---|---|
| `<<rv:value:name>>` | Numeric value via `fmt()` (same as `val`) | **Numeric quantity** — formatted magnitude with the declared unit |
| `<<rv:expression:name>>` | **Expression** — canonical source | **Expression quantity with units** — source with the declared unit and prefix appended |
| `<<rv:expression:name:var1:var2>>` | **Partial expression** — only the listed arguments substituted | **Partial expression quantity with units** — substituted magnitude with the declared unit and prefix appended |

| Want | Use |
|---|---|
| Formula/source | `<<rv:expression:name>>` |
| Partially substituted formula | `<<rv:expression:name:a:b>>` |
| Numeric result | `<<rv:val:name>>` |
| String-pick value | `<<rv:val:name>>` |
| String-pick LaTeX source | `<<rv:expression:name>>` |
| Quantity with unit | Any value placeholder when bound; `value` is conventional |
| Quantity source with its unit | `<<rv:expression:name>>` |

Names are exact and case-sensitive; `<<rv:val:Speed>>` does not match `speed`.

### 13.2 Validation

Every placeholder in `QUESTIONS`, `ANSWERS`, `DISTRACTORS`, and `EXPLANATIONS` must resolve unless the section is literal-rendered. Failure skips the note.

Expression call arguments must resolve, be numeric, be declared before the expression, and not be the expression itself. An undefined, string-pick, later-declared, or self-referencing
argument is fatal.

Arguments may be bare or quoted (`:a:b` or `:"a":"b"`). Extra arguments not in the source are harmless if they are known numeric names declared earlier. An expression cannot call itself.

### 13.3 Rendering

`fmt()`:

- up to four decimals, no trailing zeros;
- `320.0000` → `320`; `320.123456` → `320.1235`;
- `-0` → `0`;
- magnitude ≥ `1e15` uses six significant digits.

`<<rv:val:name>>` uses `fmt()` for plain numbers; strings insert verbatim. For a quantity definition, both `val` and `value` render `fmtQuantityValue` (fixed 3 significant figures, trailing
zeros trimmed) in every section. A quantity note does not reformat unrelated plain numbers.

`<<rv:expression:name>>`:

- resolves nested `<<rv:val:…>>` inside the source before rendering;
- substitutes listed call variables, which must be numeric and earlier;
- folds constant-only subexpressions;
- preserves implicit multiplication (`3x`, `2x^{2}`);
- moves numeric coefficients to the front (`a3b` → `3ab`);
- renders a multi-letter explicit `\var{…}` reference as one upright name
(`\var{area}` → `\mathrm{area}`), after bare factors;
- renders `\abs(x)` as `\left|x\right|`, `\C`/`\P` as `\mathrm{C}`/`\mathrm{P}`,
and plugin functions as `\operatorname{…}`, so the output is valid Obsidian
LaTeX;
- renders postfix factorial and `\sum` / `\prod` with standard LaTeX;
- inserts parentheses only where precedence requires them;
- renders bare `e` as Euler's constant;
- for a **quantity** definition, appends the declared unit and declared prefix
(`<<rv:expression:KE>>` on `KE = … ; ; "J"` renders the source followed by
` J`; the same rule applies to `<<rv:expression:name:args>>`);
- when a quantity placeholder sits inside `$…$` or `$$…$$`, appends the unit as
upright `\text{…}` and separates it with `\,` (§33.5.1);
- appends nothing for a dimensionless quantity;
- inside `## DISTRACTORS`, a target conditioned by `rv-distract` renders in
the anchor's data type instead (§27.4), so no unit is appended twice.

Because the same fill runs in every section, an answer or distractor block
using `<<rv:expression:q>>` on a quantity carries the unit into the filled
text. Do **not** write a literal unit after the placeholder — that is the
double-unit anti-pattern (§17.6, §33.5). Numeric definitions are unchanged:
`<<rv:expression:n>>` still renders the bare source with no unit.

Inside an `rv-def` RHS, only `val`/`value`/`values` placeholders are substituted. `<<rv:expression:…>>` inside `rv-def` is not supported; use a name or `\var{…}`.

Example with `a=1`, `b=2`, `c=3`, `k=5`, `x=4`, `f = ax^{2} + bx + \var{k}3ac`:

| Placeholder | Display |
|---|---|
| `<<rv:expression:f>>` | `ax^{2} + bx + 3ac\mathrm{k}` |
| `<<rv:expression:f:a:b:c:k>>` | `x^{2} + 2x + 45` |
| `<<rv:expression:f:a:b:c:k:x>>` | `69` |
| `<<rv:val:f>>` | `69` |

---

# Part IV — Answers

## 14. Answer paths and pruning

### 14.1 Two paths

| Path | When | Behaviour |
|---|---|---|
| Numeric/text | No `rv-answer` fence and no quantity binding | Prune blocks, then choose numeric or text |
| Quantity/multi-value | `rv-answer` fence, or an accepted block uses a val bound to a quantity definition | Unit-aware quantity or multi-value grading |

A quantity value alone is enough to enter the quantity path; the placeholder
name (`val` / `values` / `value`) does not matter (§13.1). The `rv-answer` fence
is **optional**: without it, **every quantity binding used by an answer
placeholder receives the default bounded constraint** — `unit-mode = expanded`,
`display = atomic`, `prefix-policy = any`, `allowed-prefixes = auto`,
`min-sigfigs = 3`, `max-sigfigs = 15`, `notation = auto`, `unit-optional =
false` — applied to the typed answer and to the display placeholders alike. The
fence exists only to narrow or widen that constraint per binding (§17).

The `rv-answer` fence is extracted from `## ANSWERS` **before** blocks split. Only one is allowed; more is fatal. Everything outside the fence remains answer text. A fence-only note is
fatal; an empty section with no fence is fatal.

### 14.2 Block pruning before classification

This applies to both text and numeric notes, with or without a fence, unless the answers section is literal-rendered.

1. For every non-empty answer block, collect distinct val names used by `val`,
`values`, and `value` placeholders.
2. Find the highest count `M`.
3. Blocks with fewer than `M` names are dropped with a warning:

   ```text
   ## ANSWERS block N dropped — it has K placeholder(s) but the highest count is M
   ```

4. The remaining blocks are the winners.
5. All winners must reference exactly the same name set, in any order. Any
mismatch is fatal:

   ```text
   ## ANSWERS variants do not use the same placeholder set — same-count blocks must reference exactly the same names in any order
   ```

Consequences:

- Two one-value blocks with different names (`{r1}` and `{r2}`) are fatal.
Numeric/text notes cannot express a two-value answer by giving each value its own block; use a multi-binding `rv-answer` fence.
- Two blocks with the same name (`<<rv:val:a>>`, `<<rv:val:a>> cm`) are fine.
- A block with extra values wins; simpler blocks are dropped.
- Expression-only blocks have zero names and are dropped whenever any block
has a val. If all have zero, all survive.

Literal-rendered answers skip pruning.

### 14.3 Numeric/text classification

After pruning:

- `quantityMode` is true if any surviving block uses a val whose name is a
quantity definition, or if a fence produced quantity slots.
- If `quantityMode`, `answerMode = numeric` and the quantity or multi-value
builder is used.
- Else `answerMode = numeric` if any surviving block's **first** val is not a
string pick.
- Else `text`.

A first val bound to a string pick does not make the note numeric. A block containing only `<<rv:expression:…>>` does not force numeric. A numeric val later in a block does not count if the
first val is a string.

Only string picks are excluded from the numeric classification: a first val bound to `unit(...)` or `prefixUnit(...)` still classifies the note as numeric, so it reaches the numeric builder and fails at build time with `the answer is not a finite number for the generated values` instead of a targeted diagnostic.

### 14.4 Numeric answer pruning

In numeric mode with no quantity slots:

- First val numeric → numeric block.
- First val string pick → kept as an accepted text variant.
- No val but contains `<<rv:expression:>>` → kept as an accepted text variant.
- No val and no expression → dropped:

  ```text
  ## ANSWERS block N dropped — no <<rv:val:>> but other blocks have one
  ```

- If none remain: `all ## ANSWERS blocks were dropped — none contains <<rv:val:>>`.

### 14.5 Numeric distractor pruning

In numeric mode without quantity slots, and a non-literal distractor section, each distractor block must contain a `<<rv:val:>>`, a literal number, or an `<<rv:expression:>>`. Otherwise it
is dropped:

```text
## DISTRACTORS block N dropped — numeric answer mode requires <<rv:val:>>, a literal number, or a numeric <<rv:expression:>>
```

## 15. Numeric answers

A numeric block may mix val, expression, text, and Markdown. Only the first val supplies the graded number; the rest is display text.

```text
<<rv:val:SA>>
<<rv:val:SA>> cm²
**Answer:** <<rv:val:SA>>
<<rv:expression:formula>> = <<rv:val:SA>>
```

A second val in one block warns: `## ANSWERS block N: 2 <<rv:val:>> occurrences — only the first is used for grading`.

Same-name blocks produce interchangeable display forms. Different names at the same count are fatal under §14.2; there is no numeric/text multi-answer across different names. Use a multi-binding
fence for independent values.

Correct choice: the first numeric answer block is the display template for the correct choice and generated numeric distractors; unit text around the answer is inherited by every distractor.
If the template does not contain the first val token, generated choices use the bare number. Text mode picks one answer block at random.

```markdown
## ANSWERS
Area $= <<rv:val:SA>>$ cm$^2$
```

Correct choice renders as `Area $= 96$ cm$^2$`; distractor `90` renders as `Area $= 90$ cm$^2$`.

### 15.1 Literal answers

With `<!--debug-called-definitions-->` on `## ANSWERS`, every placeholder is literal:

- correct choice and accepted answers show the placeholder source;
- the student types that literal text;
- a val in a flagged section does not count for numeric/text classification;
- validation is skipped.

Remove the marker to grade resolved values again.

### 15.2 Units in numeric mode

- Put the unit-bearing block first for MCQ units.
- Bare `<<rv:val:SA>>` first gives bare-number choices.
- Add other accepted spellings as separate blocks **with the same val name**.
- A string-pick block in numeric mode is an accepted text variant, not a value.

```markdown
## ANSWERS
<<rv:val:a>> J
---
<<rv:val:a>> joules
```

Correct choice `10 J`; distractors `5 J`, `7 J`, `9 J`; typed accepts `10`, `10 J`, `10 joules`.

### 15.3 Expression answers

- An expression-only block is text mode; the rendered expression is the answer
string.
- If it renders `69`, typing `69` matches as text, with no numeric tolerance.
- In numeric mode an expression block is kept as an accepted text variant.
- For numeric tolerance, add a numeric val block.
- Text answer grading has no structural math equivalence.

## 16. Text answers

- `<<rv:expression:>>`, a string-pick val, plain text, and Markdown may appear
in any order.
- Every kept block is an accepted answer.
- The correct choice is one block at random.
- No numeric tolerance.
- Matching is normalized whitespace/case equality only; Markdown is not
removed. Keep answers plain.
- Multiple blocks are alternatives, not separate values.

## 17. The `rv-answer` fence

The fence is **optional**. It sets a bounded constraint for a declared quantity
data type taken from the definitions, and its main purpose is **grading the
answer**. A header that names a non-quantity definition has no effect: it warns
and is ignored (§17.1), and a fence whose headers are all non-quantity produces
zero slots and falls back to numeric/text answer handling (§17.4). Without the fence
the same quantities are graded under the default bounded constraint (§14.1), so
a fence is only ever a deliberate narrowing or widening.

Only a fence inside `## ANSWERS` is pulled out as the answer fence. A second
`rv-answer` fence anywhere else stays in that section as ordinary text and is
never counted, so the one-fence rule applies to fences inside `## ANSWERS`.

````markdown
## ANSWERS

```rv-answer
typed-mode = either
sep = ","

KE:
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

<<rv:value:KE>>
````

### 17.1 Grammar

Each non-empty line is a global key, a binding header, or a binding key:

```text
global-key = value
name:
binding-key = value
```

- Blank lines are ignored.
- Globals are only `typed-mode` and `sep`, and only **before** the first header.
- A duplicate global is fatal.
- A global after the first header is fatal.
- `sep` may be quoted; an empty `sep` is fatal.
- A header is `name:` with name matching `[A-Za-z][A-Za-z0-9_]*`.
- The header name must be defined in `rv-def`; missing is fatal.
- A **non-quantity** definition in a header produces a warning and is ignored.
- A duplicate header is fatal.
- A binding key before any header is fatal.
- A duplicate binding key is fatal.
- An unknown key is fatal: `rv-answer: unknown key "…"`.
- An unreadable line is fatal:
`rv-answer: cannot read "…" (use name:, key = value, or a global key)`.
- A binding declared but unused by surviving variants warns that the constraint
is unused.

### 17.2 Accepted binding keys

Only these are accepted:

| Key | Default | Meaning |
|---|---|---|
| `unit-label` | — | Display-only suffix, e.g. `square units` |
| `prefix-policy` | `any` | `any` or `exact` |
| `allowed-prefixes` | `auto` | `auto`, `none`, or comma list |
| `unit-mode` | `expanded` | `declared`, `atomic`, `expanded`, `list`, `dimension`, `family` |
| `accept-units` | — | Comma-separated unit expressions |
| `display` | `atomic` | `declared`, `atomic`, `expanded` |
| `min-sigfigs` | `3` | Minimum accepted/display significant figures |
| `max-sigfigs` | `15` | Maximum accepted significant figures |
| `notation` | `auto` | `auto`, `decimal`, `scientific` |
| `unit-optional` | `false` | Accept a bare number in the display unit |
| `rv-currency` | — | ISO currency code for the answer (see §17.7) |
| `rv-comma` | `false` | `true` or `false`; group displayed integer digits with commas |

Unit and prefix come from the quantity definition named by the header; there is no per-binding unit or prefix key. Both `key = value` and `key: value` forms are accepted; the currency and comma parameters are normally written with a colon, e.g. `rv-currency: USD`.

### 17.3 Validation

- `unit-mode = list` requires `accept-units`.
- `prefix-policy = exact` with `unit-mode = dimension` or `expanded` is fatal.
- `max-sigfigs < min-sigfigs` is fatal.
- Bounds are integers: sig figs 1–15.
- An `accept-units` entry with a different dimension from the declared unit
warns and is inactive.
- `unit-mode = dimension` or `family` warns that a broad family is accepted.
- `unit-label` with automatic prefix selection warns that it suppresses
automatic prefixing. An explicit declared prefix still applies.
- `rv-currency` must be one of the supported ISO codes; an unknown code is fatal.
- If the bound definition already declares a different currency, `rv-currency`
  is fatal. A non-currency unit cannot be combined with `rv-currency`.
- `rv-comma` accepts only `true` or `false`.

### 17.4 Scalar versus multi-value

- `slots` is the list of resolved quantity bindings.
- One slot = scalar quantity; more than one = multi-value.
- A fence with only non-quantity headers produces zero slots and falls back to
numeric/text answer handling.

### 17.5 Global modes

| Key | Values | Effect |
|---|---|---|
| `typed-mode` | `values` | One value per binding, in binding order, separated by `sep` |
| | `prose` | Must match a complete variant's literal anchors |
| | `either` | Prose first, then values (default) |
| `sep` | text | Separator for `values`; default `,` |

`typed-mode = prose` requires every non-literal block to contain literal text. A values-only block is fatal:

```text
rv-answer: typed-mode = prose requires literal anchors, but ## ANSWERS block N contains only values
```

### 17.6 Declaring the answer as a quantity

Whether `\variable{answer}` is declared as a quantity is what lets the plugin
accept equivalent answers. The rendered display can be identical either way; only
grading changes.

Non-quantity declaration — the unit is literal text in the block:

````markdown
## DEFINITIONS

```rv-def
answer = 5
```

## ANSWERS
<<rv:val:answer>> cm
````

Quantity declaration — the unit comes from the definition, so the literal ` cm`
is dropped to avoid the double-unit anti-pattern (§33.5):

````markdown
## DEFINITIONS

```rv-def
answer = 5 ; ; "cm"
```

## ANSWERS
<<rv:value:answer>>
````

Both render `5 cm`, but the typed answer is graded differently:

| Typed answer | Non-quantity `answer = 5` | Quantity `answer = 5 ; ; "cm"` |
|---|---|---|
| `5 cm` | Accepted — literal match | Accepted — declared form |
| `50 mm`, `0.05 m`, `50000 µm` | **Rejected** — numeric/text grading does no unit conversion | **Accepted** — equivalent quantity under the default constraint |
| `5.0 cm` | **Rejected** — the literal text must match exactly | **Accepted** — inside the significant-figure band |
| `5` (bare number) | Accepted — numeric tolerance | **Rejected** — `unit-optional = false` |

Declaring the quantity does not by itself change how wide the accepted set is:
`unit-mode`, `prefix-policy`, `allowed-prefixes`, the significant-figure band,
and `unit-optional` still come from the defaults (§14.1) unless the fence
overrides them.

### 17.7 Currency and comma grouping

Currency is a quantity, not a separate answer type. A currency code is an
abstract unit whose symbol is the ISO code, so it reuses `unit("…")` in
`rv-definitions` with no new syntax:

```text
cost = 1000; ; unit("USD")
peso = 500; ; unit("PHP")
```

`unit("USD")`, `unit("Dollar")`, `unit("PHP")` and `unit("Philippine Peso")` all
resolve to the canonical ISO unit. The supported codes are `USD`, `EUR`, `GBP`,
`JPY`, `PHP`, `AUD`, `CAD`, `CHF`, `CNY`, `INR`, `KRW`, `SGD`. Each code is a
distinct unit; a different code in a typed answer is rejected.

A currency may also be assigned per binding with `rv-currency`, which is useful
when the definition is a plain number:

````text
```rv-answer
cost:
rv-currency: USD
rv-comma: true
```
````

With `rv-currency: USD`, a bare number and any alias of that currency are
accepted; only a label from a different currency fails. For example `1000`,
`$1,000`, `USD 1000`, `1,000 USD` and `Dollar 1000` are all correct, while
`PHP 1000` and `€1000` are not. The label is optional, so omitting
`rv-currency` leaves the old behaviour: no currency label is interpreted.
A currency declared by the definition and one declared by `rv-currency` must
name the same code, otherwise it is a fatal author error.

`rv-comma: true` affects display only: the integer part of the formatted answer
and every bound placeholder is grouped with commas (`1000` → `1,000`,
`1000000` → `1,000,000`). Grading always treats `1,000` and `1000` as equal;
`rv-comma: false` (the default) only removes the grouping from the display.

## 18. Quantity policy and unit modes

### 18.1 Source of the unit

The declared unit comes from the quantity definition:

```text
KE = \frac{1}{2} m v^{2} ; ; "J"
```

The `rv-answer` header selects `KE`; it does not restate the unit. If the declaration has a global prefix, that prefix applies to the canonical value and to display. If its unit is empty,
the quantity is in abstract `u`.

### 18.2 `unit-mode`

| Mode | Accepts |
|---|---|
| `declared` | Only the exact declared unit key |
| `atomic` | Declared atom with any allowed prefix, subject to `prefix-policy` |
| `expanded` | Exact declared form, exact `accept-units`, or any same-dimension combination of allowed atoms with allowed prefixes |
| `list` | Only units listed in `accept-units` with the declared dimension |
| `dimension` | Any unit with the same dimension |
| `family` | Same dimension and same first-factor quantity tag |

Display and acceptance can disagree under `declared`: `display = atomic` may render a compound declared unit as a named one (`kg*m/s^2` displays as `N`), but `declared` accepts only the exact declared unit key, so typing `N` is rejected even though the answer is shown as `N`.

Atoms allowed in `expanded`:

- SI base and SI derived units;
- units with a temperature tag;
- English/US units;
- the time units `h`, `min`, `d`.

Registry contents: SI base (`m`, `kg`, `g`, `s`, `A`, `K`, `mol`, `cd`); SI derived (`N`, `J`, `W`, `Pa`, `Hz`, `C`, `V`, `Ω`, `F`, `S`, `Wb`, `T`, `H`); electrical non-SI (`VA`, `var`, `Wh`, `Ah`); other non-SI (`L`, `min`, `h`, `d`, `t`, `bar`, `atm`, `eV`, `%`, `ppm`, `rad`, `deg`, `grad`, `rev`); English/US (`in`, `ft`, `yd`, `mi`, `acre`, `lb`, `oz`, `slug`, `ton`, `lbf`, `kip`, `psi`, `psf`, `ksi`, `BTU`, `ftlb`, `hp`, `gal`, `qt`, `pt`, `floz`, `mph`, `knot`); temperatures (`K`, `°C`, `°F`, `°R`, `deltaC`, `deltaF`); abstract `u`. Other non-SI units are **not** accepted by `expanded` merely because they are in the registry; add what you need to `accept-units`.

For a quantity whose declared unit is shown on the left, `expanded` accepts the forms on the right:

```text
m/s       → m/s, cm/s, m/ms, mm/µs, km/h, m/min
N         → N, kN, kg*m/s^2, g*cm/ms^2, J/m, lbf, kip
Ω         → Ω, V/A, mV/mA, W/A^2
lb/ft^3   → lb/ft^3, kg/m^3, oz/in^3, g/cm^3
```

### 18.3 Prefix policy

- `any`: any prefix allowed by `allowed-prefixes` is accepted.
- `exact`: input prefix must match the expected prefix (resolved quantity
prefix, or the declared unit's built-in prefix).
- `exact` is usable only with `unit-mode = atomic` or a `list` of atomic forms.

`allowed-prefixes`:

- `auto`: all SI decimal prefixes.
- `none`: no prefix.
- comma list: only those symbols.
- Unknown symbols are fatal.

The SI prefix set is `Y Z E P T G M k h da d c m µ n p f a z y`, with `u` and `μ` as spellings of `µ`, plus word aliases such as `kilo`, `micro`.

### 18.4 `accept-units` and `unit-optional`

`accept-units` is comma-separated unit expressions, parsed at note load (unknown = fatal). Same-dimension entries are active; different-dimension entries are inactive and warn. In `expanded`
they are additive; in `list` they are the complete allowed set.

`unit-optional`:

- `false` (default): a bare number is not accepted.
- `true`: a bare number is interpreted in the display unit, including scale,
prefix, and offset.

Do not enable it on a question that asks for a unit unless a bare number should truly count.

## 19. Precision, display, and notation

### 19.1 Significant-figure band

- `min-sigfigs` defaults to 3.
- `max-sigfigs` defaults to 15.
- `max` must be at least `min`.
- Rendered numbers use **min** precision.
- `max` caps typed input: more significant figures than `max` is rejected even
if numerically close.
- There is no author-facing decimal-place band; precision is expressed in significant figures only.

### 19.2 Display rounding and trailing zeros

`fmtQuantity`:

1. resolves display unit and prefix;
2. lays out the exponent;
3. rounds the mantissa at `min-sigfigs`;
4. renders notation;
5. appends the unit suffix;
6. trims insignificant trailing zeros.

So `9.00 J` renders `9 J`; `25.0 square units` renders `25 square units`. Do not write templates that expect trailing zeros to survive.

### 19.3 Display mode

| `display` | Rendering |
|---|---|
| `declared` | Declared unit as written, no automatic prefix selection |
| `atomic` | Named derived unit if the declared form is compound (`kg*m/s^2` → `N`), plus automatic prefix selection when allowed |
| `expanded` | Declared atom's expansion if one exists (`N` → `kg*m/s^2`), no automatic prefix selection |

Automatic prefix selection happens only when:

- `display = atomic`;
- `allowed-prefixes != none`;
- no `unit-label`;
- the display unit is a single prefixable atom;
- the atom has no prefix already.

It prefers the unprefixed form when the magnitude is at least 1 and below 1000, otherwise an engineering prefix (power divisible by 3), choosing the largest suitable one. Thus `1500 J`
renders `1.5 kJ`, not `1500 J` or `15 hJ`.

### 19.4 Notation

| `notation` | Behaviour |
|---|---|
| `auto` | Decimal for ordinary magnitudes; scientific when exponent < −3 or ≥ 4 |
| `decimal` | Keep decimal form |
| `scientific` | One integer digit and `× 10^n` |

An abstract prefix forces scientific notation in `fmtQuantityValue`.

`fmtQuantityValue` uses fixed `min-sigfigs = 3`, trims zeros, and does not use an answer slot's band. It also runs automatic prefix selection with `allowed-prefixes = auto`, so an unbound `<<rv:value:…>>` or `<<rv:val:…>>` on a quantity can render a different prefix from one draw to the next. A bound answer slot uses its own `min-sigfigs` and display policy.

## 20. Variants and multi-value answers

Every non-empty `## ANSWERS` block is one **complete variant** over the same bindings.

```markdown
## ANSWERS
V = <<rv:value:V>>, I = <<rv:value:I>>
---
The voltage is <<rv:value:V>> and the current is <<rv:value:I>>.
```

- After pruning, all variants use the same distinct value set.
- Order and repetition are free.
- A variant with fewer distinct values is dropped with a warning; same-count
  variants that name different values are fatal.
- Adjacent value placeholders with no literal between them are fatal.
- Never split one multi-value answer across variants.

Scalar quantity: the correct choice uses a variant chosen from the per-question variant stream when available. If that block does not contain the bound value, the formatted quantity is used
and a warning is added.

Multi-value: one complete variant is chosen deterministically from the session seed; distractors reuse that wording with changed values.

Typed modes:

| Mode | Accepted input |
|---|---|
| `values` | Exactly one part per binding, in binding order, separated by `sep` |
| `prose` | A complete variant sentence, matched against literal anchors |
| `either` | Prose first, then values |

`values` splitting is top-level, outside brackets. With `sep = ","`, a comma between digits is a thousands separator and not a split. Part count must equal binding count exactly.

## 21. Grading

### 21.1 Numeric answers

1. Trim input.
2. If it parses as a finite number and is within `TOLERANCE = 0.001` of any
accepted numeric value, correct.
3. Else compare normalized input against every accepted answer block string.

Consequences: `10`, `10 J`, `10 joules` can each be accepted if listed; `10.0 J` needs listing; `1,000` does not parse as a number and does not match `1000`; `1e3` parses as 1000; there is
no unit conversion.

### 21.2 Text answers

1. Normalize `$`, `$$`, `\text{…}`, `\mathrm{…}`, LaTeX spacing, whitespace.
2. Lowercase both sides.
3. Require exact equality.

No structural math equivalence on this path. `\frac{1}{2}` is not equivalent to `1/2` here.

### 21.3 Quantity input

1. Normalize typed text. For a currency answer, a written label (`$`, `USD`,
`Dollar`, `₱`, …) is rewritten before tokenizing; a label from another currency
fails immediately, and an omitted label still carries the declared code.
2. Split magnitude/unit at the first position where the remainder parses as a
unit and the prefix as a number. Thousands commas are removed, so `1,000` and
`1000` are the same magnitude.
3. If no unit is found, accept a bare number only when `unit-optional = true`,
interpreted in the display unit. A currency answer always carries the declared
code after normalization, so a bare number is accepted there.
4. Require the same dimension.
5. Apply `unit-mode` and prefix checks. For a currency, the code must match
exactly under every mode; no other code is accepted.
6. Apply the significant-figure band.

### 21.4 Significant-figure grading

- Count significant figures in the typed magnitude text.
- If count > `max-sigfigs`, reject.
- Apply the **magnitude absolute tolerance**: normalize the expected answer to its display prefix/scientific representation at `min-sigfigs`, then take one unit of the last displayed digit. Example: `10.234 µA` has a `0.001 µA` step, or `1e-9 A` canonical. Accept when the typed and expected canonical values differ by at most that step.
- If expected displayed value is zero, accept only within `1e-12`.
- Else, for every precision from `min-sigfigs` upward to `max-sigfigs`, accept
if the typed value equals the expected value **rounded** at that precision, or equals it **truncated toward zero** at that precision.
- Else fail.

Comparison uses display scale and offset, so prefixes and scientific notation do not change the outcome. The magnitude tolerance follows the normalized display: `10.234 µA`, `10.234e-6 A`, and `1.0234e-5 A` share the same canonical window.

### 21.5 Quantity fallback

After quantity grading fails, a scalar quantity also tries accepted answer blocks:

1. normalized literal equality;
2. structural math equivalence via the criterion and AST.

This fallback is not used for multi-value slots: each multi-value value is graded only by `gradeQuantity`.

### 21.6 Multi-value `values`

- Split on `sep` at top level.
- Exactly one part per slot.
- Grade each part against its slot in binding order.
- Trim, strip leading/trailing `. ; : ! ?`, then parse as a quantity.
- Value text is case-sensitive for units (`V` vs `v`, `S` vs `s`).
- An empty part fails.

### 21.7 Multi-value `prose` and `either`

- Presentation-normalize but preserve case for value slices.
- Fold separators and lowercase for literal anchors.
- Find each literal anchor in order.
- Grade the text between anchors as the corresponding slot.
- A repeated placeholder is graded against the same value every time.
- Missing anchors or unparseable slices fail.
- `either` tries prose first, then values.

### 21.8 MCQ

A choice is correct only by identity (`choice.correct`). Typed grading is used only when no choice is submitted. Correct and distractor choice strings are display text; they are never parsed
for grading.
---

# Part V — Normalization

Normalization is a **backend layer**, not an authoring surface. You never write
a normalization function or a flag: the author supplies a wide constraint
(whatever a human would plausibly type), the answering user supplies their own
wide constraint (with units, LaTeX, Unicode, thousands separators, casing), and
the plugin shapes both into a canonical form before anything is compared or
displayed. Everything in Parts I–IV is therefore "wide in, wide out" — this part
only defines how wide inputs are collapsed to a match. The three sections below
are the three shapers: typed/accepted text (§22), quantity input (§23), and
multi-value/typed math presentation (§24), followed by structural AST equivalence
(§25).

## 22. Text normalization

`normaliseAnswerText` runs on typed input and every accepted block: remove `$` and `$$`; unwrap `\text{…}` and `\mathrm{…}`; replace `\,`, `\;`, `\!`, `\ ` with a space; collapse whitespace
and trim; lowercase both sides at comparison time.

Nothing else is removed. Markdown markers, backticks, headings, `\frac`, `^`, and units remain significant. Multi-line answers match with whitespace runs collapsed.

## 23. Quantity input normalization

`normalizeQuantityText` is presentation-only and never used for display. In order: expand Unicode superscripts (`u²` → `u^2`, `m⁻¹` → `m^-1`); apply NFKC; for a currency answer rewrite a written label to the declared ISO code (a foreign label fails); otherwise remove `$`; remove `\(`, `\)`,
`\[`, `\]`; remove `\left`, `\right`, `\displaystyle`, `\textstyle`; remove `\,`, `\;`, `\!`; replace `\ ` with a space; unwrap `\text{…}`, `\mathrm{…}`, `\operatorname{…}`; map `µ`/`μ` to
`u`; canonicalize ohm to `Ω`; map `·`, `⋅`, `×` to `*`; map `÷` to `/`; map Unicode minus/en dash to `-`; map `**` to `^`; remove every thousands separator in front of a 3-digit group (`1,000,000` → `1000000`); rewrite `1e3` as
`1*10^3`; rewrite `10^(n)` as `10^n`; abstract namespace only, apply phrase aliases (including currency names such as `Dollar` → `USD`); collapse spaces and trim. A currency answer finally has its ISO code appended so a bare number resolves to that unit.

Display grouping is the separate `rv-comma: true` policy (§17.7): it inserts
commas into the integer part of the formatted answer and placeholders only; it
does not change normalization or grading.

| Input | Normalized shape |
|---|---|
| `1,000 m` | `1000 m` |
| `1,000,000 USD` | `1000000 USD` |
| `$1,000` (currency `USD`) | `1000 USD` |
| `Dollar 1,000` (currency `USD`) | `1000 USD` |
| `1000 PHP` (currency `USD`) | rejected |
| `1.20 × 10^3 kN` | `1.20 * 10^3 kN` |
| `2.5 µs` | `2.5 us` |
| `3 m·s^-1` | `3 m*s^-1` |
| `9.8 m/s²` | `9.8 m/s^2` |
| `25 square units` | `25 u^2` (abstract only) |

## 24. Multi-value presentation normalization

`normalizePresentation` is used for prose and typed math comparison and
**preserves case**. In order: trim and expand Unicode superscripts; apply NFKC;
map Unicode minus/en dash to `-`; map `·`, `⋅`, `×` to `*`; map `÷` to `/`; map `µ`/`μ` to `u`; canonicalize ohm to `Ω`; convert `**` between operands to `^`; strip math delimiters (`$$…$$`,
`$…$`, `\(…\)`, `\[…\]`, and `equation`/`align`/`gather`/`multline` environments); remove `\left`, `\right`, `\displaystyle`, `\textstyle`; remove `\,`, `\;`, `\!`; replace `\quad`,
`\qquad`, `\enspace`, `\ `, `\\` with spaces; map `\dfrac`/`\tfrac` to `\frac`; map `\cdot`/`\times` to `*`; map `\div` to `/`; unwrap `\text`, `\mathrm`, `\operatorname`, `\mathbf`; unwrap
`\unit{…}`; rewrite `\SI{a}{b}` and `\qty{a}{b}` as `a b`; flatten brace exponents/subscripts (`^{2}` → `^2`, `_{i}` → `_i`); remove whitespace around brackets and operators; collapse
spaces; remove Markdown emphasis `**`, `__`, and backticks.

`normalizeLiteral` then folds `,`, `;`, `&`, and the word `and` to `, `, preserving digit–comma–digit thousands separators; lowercases; collapses whitespace; removes terminal `.` and `。`.

`normalizeForMatch` applies presentation normalization and separator folding without lowercasing or terminal-punctuation removal. This is the haystack for anchors, so value slices keep unit
case.

## 25. AST equivalence

`expressionsEquivalent` is used only by the scalar quantity fallback.

- Both sides are presentation-normalized; identical strings are equal.
- Both are parsed with the shared criterion parser.
- Ambiguous/invalid parses are not equivalent.
- Trees compare a normalized AST:
  - grouping is transparent;
  - `\frac{a}{b}` equals `a/b`;
  - `\cdot` equals `*`;
  - `x^{2}` equals `x^2`;
  - `a*b` and `b*a` are **not** equal;
  - algebraic rearrangement is **not** implemented.

## 26. What normalization does not do

It never:

- changes a displayed value;
- applies algebraic simplification;
- applies commutativity, distribution, or factoring;
- converts units in text mode;
- removes Markdown emphasis from text answers;
- removes `\frac` from text answers;
- makes `1,000` numeric in numeric mode;
- accepts a different word order for prose anchors;
- preserves case in prose anchors;
- repairs an ambiguous expression for `rv-def` or exprPick.
---

# Part VI — Distractors and feedback

## 27. `## DISTRACTORS` and `rv-distract`

### 27.1 Role

- Optional; only read in multiple-choice sessions.
- Typed sessions grade from `## ANSWERS` alone.
- Every distractor block is parsed and placeholder-validated when the note is
scanned, regardless of mode.
- A bad placeholder in `## DISTRACTORS` skips the whole note.
- Blocks split on bare `---`.
- Text mode: up to `choiceCount − 1` blocks are chosen at random; no deduplication.
- Numeric answer: each block supplies a **value**, not display text.
- Quantity: each block is parsed as a quantity; unparseable text is kept
literally with a warning.
- Multi-value: author blocks are final text variants, used as a fallback.

### 27.2 Numeric value extraction

For each kept block, in order:

1. First `<<rv:val:NAME>>` → that value.
2. First `<<rv:expression:NAME[:args]>>` → evaluate it.
3. First literal number in the block.
4. Skip if none yields a finite number.

Literal-number parsing finds the first run of digits, optionally with a decimal point, ignoring a leading minus sign and a leading decimal point:

| Block text | Extracted value |
|---|---|
| `7` | `7` |
| `-3` | `3` |
| `.5` | `5` |
| `option 2` | `2` |
| `cm2` | none — the digits sit inside a word, so the block is skipped |

Use `<<rv:val:>>` or a numeric expression for negative, sub-one fractional, or text-embedded values. Do not put incidental digits in a numeric distractor.

### 27.3 The `rv-distract` fence

- Only under `## DISTRACTORS`.
- One per note; more is fatal.
- A fence outside `## DISTRACTORS` is fatal:
`rv-distract: the fence must appear inside "## DISTRACTORS"`.
- Alias: ```` ```rv-distractors ````.

Grammar:

```text
target, target <- anchor
```

Rules:

- One arrow per line; blank lines ignored.
- Left side is a comma-separated target list; right side is exactly one anchor.
- Target and anchor must be defined in `rv-def`.
- Anchor must be number, string, or quantity. Unit/prefix anchors are fatal:
`anchors must be numeric, expression, string, or quantity`.
- Target must be number, string, or quantity. A unit/prefix target warns and is
ignored.
- A target cannot use itself as anchor; warns and is ignored.
- A string target cannot be conditioned by a number/quantity anchor; warns and
is ignored.
- If a target appears on multiple lines, the **last anchor wins**, with a
warning.
- A conditioned target not used by any `## DISTRACTORS` block warns at note
load.
- An anchor that does not resolve on a draw, is not used by the current answer
variant, or a target that does not resolve produces a build warning.
- Conditioning applies to numeric, quantity, and multi-value builders. Plain text
(`buildTextQuestion`) does not apply it.

### 27.4 What conditioning does

At fill time a conditioned target's `<<rv:val:target>>` and `<<rv:expression:target>>` render in the anchor's data type:

| Anchor | Target conversion |
|---|---|
| Quantity | Target number becomes a magnitude in the anchor's unit/prefix; target quantity keeps its displayed magnitude; formatted with the anchor policy |
| Number | Target number via `fmt()`; target quantity uses displayed magnitude |
| String | Target value stringified |

`<<rv:expression:target>>` without arguments renders a source-like form; with arguments it renders value text. The parsed question is never mutated; conditioning is per-build only.

### 27.5 Anti-patterns

| Anti-pattern | Effect |
|---|---|
| Distractor equal to answer | A wrong click looks correct |
| Many paragraphs in a distractor | Tall, unreadable button |
| `---` intended as a horizontal rule | Splits into two choices |
| Unresolved placeholder | Whole note skipped |
| No distractors in a text MCQ | Falls back to typed input |
| Incidental digits in a numeric distractor | Wrong extracted value |
| Conditioning an unused target | Warning, no effect |

## 28. Choice generation

The builder targets `choiceCount − 1` distractors. `choiceCount` is a session setting (default 4, selectable 2–6), so a card has one correct choice plus up to five wrong choices when 6 is selected. Producing fewer than requested is valid and warns. Fewer than two total choices makes `hasChoices()` false; that card
renders typed even in a multiple-choice session.

### 28.1 Numeric distractor chain

1. **Link groups.** Enumerate group offsets/indices, recompute the answer, add
distinct values.
2. **Single variables.** For each unlinked drawable numeric variable, try
in-range values only (up to 60 samples for large ranges), shuffled. A `rand()` range is a hard domain: auto-distractors never go below its `low` or above its `high` endpoint.
3. **Random subsets.** Try two or more variables, pulling in link partners and
alternate fixed/expression values; recompute.
4. **Author blocks.** Use values extracted from `## DISTRACTORS`.
5. **±10% deviation.** Fill with `A ± |A| · r`, `r ∈ (0, 0.10]`. For near-zero
answers use `±r`.

Deduplication compares against every accepted numeric answer and existing distractors using `TOLERANCE` or identical `fmt()` strings.

The perturbable pool is dependency-limited: only drawables reachable from the accepted answer values are perturbed. Computed expressions and fixed numbers are not directly perturbable and do
not produce pick-family distractors.

Warnings:

```text
rv-def has N combination(s) — no pick-family distractors produced
pick-family produced K — using author-supplied ## DISTRACTORS to fill
pick-family produced K, no ## DISTRACTORS — using ±10% deviation for remaining
only K of M required distractors produced — MCQ will show fewer choices or fall back to typed mode
```

### 28.2 Quantity chain

1. **Pick-family perturbations.** For each drawable definition reachable from
the bound values, try alternatives one definition at a time, recompute every bound value, keep the coupled result.
2. **Author blocks.** Fill placeholders, parse as a quantity. Parsed → canonical
value; unparseable → literal text with a warning.
3. **Display-grid deviations.** Displayed value ± k grid units for k in 1,2,3,5,
10; percentages 1,2,5,10,20%; powers of ten −3…−1 and 1…3; adjacent significant-figure roundings; the negative displayed value.

Every candidate is formatted through the answer's own policy, so a wrong choice never uses a different prefix convention or unit system. Dedup uses the magnitude absolute tolerance (one last-displayed-digit step after prefix/scientific normalization) and the formatted display key. The old absolute canonical `TOLERANCE = 1e-3` no longer applies to quantity choices, so small values such as currents in `µA` keep their distinct pick-family distractors.

Warnings:

```text
## DISTRACTORS block "…" is not a parseable quantity — kept as literal text
only N of M required distractors produced — MCQ will show fewer choices or fall back to typed mode
using author-supplied ## DISTRACTORS — rv-def produced no usable quantity distractors
```

### 28.3 Multi-value chain

The strategy is fixed to `variable`; there is no key that selects another one.

`variable`:

1. Perturb one drawable definition at a time.
2. Recompute every slot.
3. Skip candidates whose canonical vector equals the correct vector.
4. Render the chosen variant with new value texts.
5. Deduplicate by rendered text and canonical vector.

Fallbacks: author `## DISTRACTORS` as final text, then one-value display-grid deviations varying one slot at a time.

### 28.4 Text chain

- Shuffle author blocks, take up to `choiceCount − 1`.
- No dedup against answers or each other.
- No generated values.
- Fewer than two total choices renders typed.

### 28.5 Correct-choice templates

| Path | Correct choice | Wrong choices |
|---|---|---|
| Numeric answer | First numeric answer block, filled | Same template with distractor value substituted |
| Text answer | One answer block at random, filled | Up to `choiceCount − 1` author blocks, shuffled |
| Scalar quantity | A chosen answer block containing the bound value; else formatted quantity | Formatted through answer policy |
| Multi-value | One complete answer variant | Same wording with changed values |

## 29. `## EXPLANATIONS`

- Everything from the heading to the next H2 is one Markdown block.
- Full Obsidian Markdown is supported.
- Placeholders are substituted unless the section is literal-rendered.
- Optional.
- `---` is a horizontal rule, not a separator.
- Every placeholder must resolve unless literal-rendered, or the note is
skipped.
- A `rv-def` fence outside `## DEFINITIONS` is inert.
- `%%` comments are not stripped.
---

# Part VII — Reference

## 30. Fatal error catalogue

A fatal error skips the whole note and appears in the Skipped Note panel. The panel labels the failure type — **Definitions Error**, **Answers Error**, **Distractors Error**, **Answer Build Error**, **Note Structure Error**, or **General Error**. Build failures also include the last underlying cause after the summary message.

### 30.1 Structure

| Message / condition | Cause |
|---|---|
| Not a quiz note | Path outside the review folder, or basename does not end in `.md` |
| Inside the session folder | File lives under `<reviewDir>/<sessionsSubdir>/` |
| Frontmatter not recognized | Opening `---` not at byte 0 |
| `missing "## QUESTIONS" text` | No question blocks |
| `missing "## ANSWERS"` | No answer blocks and no fence |
| `rv-answer: only one rv-answer fence is allowed per note` | Two or more fences inside `## ANSWERS` |
| `rv-answer: requires at least one ## ANSWERS block` | Fence with no text |
| `rv-distract: the fence must appear inside "## DISTRACTORS"` | Fence elsewhere |
| `rv-distract: only one rv-distract fence is allowed per note` | Two or more |

### 30.2 Definitions

| Message / condition | Cause |
|---|---|
| `## DEFINITIONS block is empty` | Non-empty fence produced no definitions |
| `rv-def: cannot read "…"` | Line is not `name = rhs` or `link(...)` |
| `rv-def: … has too many semicolons` | More than two top-level `;` |
| `rv-def: … is missing a value` | Empty value field |
| `rv-def: … "x" is not a known prefix` | Unknown literal prefix |
| `rv-def: … prefix variable "p" is not defined` | Missing bare prefix ref |
| `rv-def: … "p" is not a prefix` | Wrong reference type |
| `rv-def: … unit variable "u" is not defined` | Missing bare unit ref |
| `rv-def: … "u" is not a unit` | Wrong reference type |
| `rv-def: … stacked prefixes are not allowed` | Prefix + prefixed unit |
| `rv-def: … unit "…" does not take a prefix` | Prefix on non-prefixable atom |
| `rv-def: … cannot mix SI and abstract units` | Namespace mismatch |
| `rv-def: … affine unit "…" cannot be combined` | Temperature in a product |
| `rv-def: … unit expression is ambiguous` | `kg/m*s`, `J/kg/K`, etc. |
| `pick() for x is empty` | No arguments |
| `pick() for x mixes string and numeric values` | String + number/expression |
| `unit(…): unknown unit` | Unknown constructor argument |
| `prefixUnit(…): unknown prefix` | Unknown constructor argument |
| `link(): needs at least two names` | One-member link |
| `link(): the first member cannot be flipped ("x") — …` | Flip marker on the first member |
| `link(): missing name after "-" in "…"` | Bare `-` member |
| `link(): "x" is not defined` | Missing member |
| `link(): "x" is a fixed value, not a drawable set` | Fixed number |
| `link(): "x" is a computed value, not a drawable set` | Computed or quantity arithmetic |
| `link(): "x" has N values but "y" has M values` | Count mismatch |
| `link(): rand variables … identical (min, max, step, max_index)` | Rand mismatch |
| `cannot use string variable "s" in a math expression` | String arithmetic |
| Ambiguous expression diagnostic | Numeric RHS/exprPick fails criterion |
| `is not a finite number` | Computed expression NaN/Infinity |
| `rand(): step must be > 0` | Invalid rand |
| `rand(): max_index must be a positive integer` | Invalid cap |

### 30.3 Answers

| Message / condition | Cause |
|---|---|
| `## ANSWERS variants do not use the same placeholder set — …` | Same-count name sets differ |
| `all ## ANSWERS blocks were dropped — none contains <<rv:val:>>` | No numeric block |
| `rv-answer: sep must not be empty` | Empty separator |
| `rv-answer: typed-mode is global and must appear before the first variable header` | Global after header |
| `rv-answer: duplicate global key "…"` | Repeated global |
| `rv-answer: unknown key "…"` | Misspelled or unsupported key |
| `rv-answer: "…" must appear under a variable header (name:)` | Key before header |
| `rv-answer: duplicate key "…" for "…"` | Repeated binding key |
| `rv-answer: duplicate variable header "…:"` | Repeated header |
| `rv-answer header: "…" is not defined in rv-def` | Missing definition |
| `rv-answer: cannot read "…"` | Unreadable line |
| `rv-answer: … unit-mode = list requires accept-units` | List without list |
| `rv-answer: … max-sigfigs (M) must not be less than min-sigfigs (N)` | Inverted band |
| `rv-answer: … prefix-policy = exact requires unit-mode = atomic or list of atomic forms` | Exact with dimension/expanded |
| `rv-answer: … expected an integer between …` | Invalid bound |
| `rv-answer: typed-mode = prose requires literal anchors …` | Values-only variant |
| `rv-answer: two value placeholders are adjacent …` | No literal between values |
| `rv-answer: empty <<rv:value:…>> name …` | Empty name |

### 30.4 Distractors and runtime

| Message | Cause |
|---|---|
| `rv-distract: cannot read "…" — use "target, target <- anchor"` | Malformed line |
| `rv-distract: anchor "…" is not defined in rv-def` | Missing anchor |
| `rv-distract: anchor "…" is a unit value …` | Unit/prefix anchor |
| `rv-distract: missing target before "<-"` | Empty left side |
| `rv-distract: "…" is not a valid variable name` | Bad target |
| `rv-distract: target "…" is not defined in rv-def` | Missing target |
| `the answer is not a finite number for the generated values` | 50 draws failed |
| `the answer is not a finite quantity for the generated values` | 50 quantity draws failed |
| `the answer is not a finite quantity set for the generated values` | 50 multi-value draws failed |
| `rv-def: "X" uses quantity definitions (…), so "…" already has a unit` | Explicit unit repeated on quantity arithmetic |
| `could not resolve variables for this draw — try rescanning` | Text builder exhausted |
| `rv-answer has no value binding` | No slots |

## 31. Warning catalogue

Warnings do not skip the note. They appear on the card or start screen unless hidden by `<!--ignore-warnings-->`.

| Warning | Cause |
|---|---|
| `variable "x" is defined twice — last definition wins` | Duplicate name |
| `rv-priority: "…" is not a finite number — falling back to 100` | Bad priority |
| `rv-answer: "X" is not a quantity definition; … ignored` | Non-quantity header |
| `rv-answer: "X:" has no matching <<rv:value:X>> placeholder …` | Unused binding |
| `rv-answer: … accept-units entry "…" has a different dimension …` | Inactive unit |
| `rv-answer: … unit-mode = dimension/family accepts a broad unit family` | Broad mode |
| `rv-answer: … unit-label suppresses automatic prefix selection` | Label + auto |
| `## ANSWERS block N dropped — it has K placeholder(s) but …` | Pruning |
| `## ANSWERS block N dropped — no <<rv:val:>> …` | Numeric answer pruning |
| `## ANSWERS block N: K <<rv:val:>> occurrences — only the first …` | Multiple vals |
| `## ANSWERS block 1 has no <<rv:val:X>> — using the formatted quantity …` | Template mismatch |
| `## DISTRACTORS block N dropped — numeric answer mode requires …` | No extractable value |
| `## DISTRACTORS block "…" is not a parseable quantity — kept as literal text` | Unparseable author block |
| `rv-distract: target "…" is a unit value and cannot be conditioned` | Unit target |
| `rv-distract: "…" cannot use itself as an anchor` | Self target |
| `rv-distract: string target "…" cannot be conditioned by …` | Type mismatch |
| `rv-distract: "…" was already linked to "…" — the last anchor "…" wins` | Duplicate target |
| `rv-distract: "…" is conditioned from "…" but is not used …` | Unused target |
| `rv-distract: anchor "…" did not resolve for this draw` | Build miss |
| `rv-distract: anchor "…" is not used by the current answer variant` | Build miss |
| `rv-distract: target "…" did not resolve for this draw` | Build miss |
| `rv-def has N combination(s) — no pick-family distractors produced` | numeric chain |
| `pick-family produced K — using author-supplied …` | Fill |
| `pick-family produced K, no ## DISTRACTORS — using ±10% deviation …` | Fill |
| `only N of M required distractors produced — …` | Shortfall |
| `using author-supplied ## DISTRACTORS — rv-def produced no usable quantity distractors` | Quantity fill |

## 32. Safety and limitations

### 32.1 Safe / unsafe

Always safe: a value whose answer is recomputed; a linked draw; a capped rand; a coefficient shown in the stem; an author-verified exprPick option.

Never safe: a coefficient that controls factorability (`x²+5x+6` factors, `+7` does not); a coefficient tied to a fixed structure; an exponent tuned for term combination; a shift that must
stay symmetric; a ratio that fixes a conic type; a parity-dependent count; a value that makes the problem unsolvable; mismatched link counts; rand–rand links with different parameters; an
ambiguous numeric RHS.

Conditional: a `pick()` set is safe only if every value preserves the invariant. Verify all combinations, not just the diagonal.

No `if` exists. Use a hand-verified `pick()`, freeze the value with several stem variants, or use a static text concept question.

### 32.2 Retries

Builders retry up to 50 draws if evaluation throws or the answer is not finite. This covers arithmetic failures, not structural validity. A retry loop cannot make an unanswerable geometry or
factoring problem valid.

### 32.3 Structural limitations

Fenced code does not protect placeholders (flag the section literal). `%%` comments are not stripped. A header suffix breaks recognition. Category mismatch excludes a note from Manage Questions (declare the exact folder or use **Arrange move/update**). Review-root path casing is case-sensitive. Quantity magnitude expressions skip the criterion (group explicitly). Numeric/text multi-answer with different names is fatal (use one multi-binding fence). Display rounds at `min-sigfigs` and trims zeros. `1,000` fails numeric parsing.

### 32.4 The `e` trap

- Evaluator: if a numeric variable `e` exists, bare `e` is that variable;
otherwise Euler's constant.
- Expression renderer: bare `e` is always the constant, even if a variable `e`
exists.
- `\var{e}` resolves the variable explicitly.

Never name a variable `e`. If you must, use `\var{e}` everywhere and avoid `<<rv:expression:e>>`; prefer `<<rv:val:e>>`.

### 32.5 Session and verification limits

A frozen session stores pool, order, seed, and answer state, not note content; replay re-reads current notes. A renamed/moved note becomes missing, `rv-exclude: true` behaves as missing, priority changes do not affect a frozen order, and deleting/rewriting a note can make replay incomplete.

The start-screen validation pass does not prove every draw is valid. Run several real sessions with different seeds, check `max_index` variety and `link()` pairing, and use the warning panel; enable **Force show all warnings** if markers hide messages.

## 33. Templates

### 33.1 Minimal text question

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
````

### 33.2 Numeric question with a unit template

````markdown
---
rv-category: physics/energy
---

## DEFINITIONS

```rv-def
m = pick(2, 4, 5)
v = rand(3, 9, 1)
KE = \frac{1}{2} m v^2
```

## QUESTIONS
A mass of $<<rv:val:m>>$ kg moves at $<<rv:val:v>>$ m/s.
Find its kinetic energy.

## ANSWERS
$<<rv:val:KE>>\ \text{J}$
---
<<rv:val:KE>> joules

## DISTRACTORS
5
---
7
---
9

## EXPLANATIONS
$$KE = \frac{1}{2}mv^2
       = \frac{1}{2}(<<rv:val:m>>)(<<rv:val:v>>)^{2}
       = <<rv:val:KE>>\ \text{J}$$
````

The first block supplies MCQ unit display; the second adds an accepted spelling with the same val name.

### 33.3 Multi-value numeric question

The old pattern of separate `<<rv:val:r1>>` and `<<rv:val:r2>>` blocks is fatal: both have one distinct name but different sets. Use one binding per value.

````markdown
---
rv-category: physics/projectiles
---

## DEFINITIONS

```rv-def
v0 = pick(10, 20)
theta = pick(30, 45, 60)
vx = v0 * \cos(theta * \pi / 180) ; ; "m/s"
vy = v0 * \sin(theta * \pi / 180) ; ; "m/s"
```

## QUESTIONS
A projectile is launched at $<<rv:val:v0>>$ m/s at $<<rv:val:theta>>^\circ$.
Find the horizontal and vertical velocity components.

## ANSWERS

```rv-answer
typed-mode = either
sep = ","

vx:
min-sigfigs = 3
max-sigfigs = 4
unit-optional = false

vy:
min-sigfigs = 3
max-sigfigs = 4
unit-optional = false
```

$v_x = <<rv:value:vx>>$, $v_y = <<rv:value:vy>>$
---
The components are $<<rv:value:vx>>$ horizontally and $<<rv:value:vy>>$
vertically.
````

### 33.4 Automatic quantity answer without a fence

A quantity definition is enough. Default policy applies: `unit-mode = expanded`, `display = atomic`, `prefix-policy = any`, `allowed-prefixes = auto`, `min-sigfigs = 3`, `max-sigfigs = 15`,
`unit-optional = false`.

````markdown
---
rv-category: physics/energy
---

## DEFINITIONS

```rv-def
m = pick(2, 4, 5)
v = rand(3, 9, 1)
KE = \frac{1}{2} m v^2 ; ; "J"
```

## QUESTIONS
A mass of $<<rv:val:m>>$ kg moves at $<<rv:val:v>>$ m/s.
Find its kinetic energy.

## ANSWERS
<<rv:val:KE>>
````

### 33.5 Scalar quantity with an explicit fence

````markdown
---
rv-category: physics/pressure
---

## DEFINITIONS

```rv-def
F = pick(1500, 3000)
A = pick(2, 4)
p = F / A ; ; "Pa"
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
````

Do not write `<<rv:value:p>> Pa`; that is the double-unit anti-pattern.

#### 33.5.1 Quantities inside `$…$`

When a quantity placeholder sits **inside** `$…$` or `$$…$$`, the plugin emits
the unit and any prefix as upright `\text{…}` so `4 cm` does not render as
`4cm` (four italic variables). Outside math the unit stays plain text.

| Source | Display |
|---|---|
| `$<<rv:value:p>>$` | `$1500\,\text{Pa}$` |
| `$$<<rv:value:p>>$$` | `$$1500\,\text{Pa}$$` |
| `<<rv:value:p>>` | `1500 Pa` |
| `$<<rv:value:E>>$` with prefix `k` | `$4\,\text{kJ}$` |

Compound units keep their mathematical structure:
`kg*m/s^2` becomes `\text{kg}\cdot\text{m}/\text{s}^{2}`, and `m^2` becomes
`\text{m}^{2}`. Code spans and escaped `\$` do not count as math. The same rule
applies to `<<rv:expression:…>>` on a quantity and to multi-value answer variants.

### 33.6 Quantity with unit and prefix picks

````markdown
---
rv-category: measurement/units
---

## DEFINITIONS

```rv-def
E = pick(1.5, 2.5, 4.5)
p = pick(prefixUnit("k"), prefixUnit("M"), prefixUnit("G"))
link(E, p)
Edisp = E ; p ; "J"
```

## QUESTIONS
An energy is recorded as $<<rv:val:E>>$ with SI prefix $<<rv:val:p>>$.
Express it with its unit.

## ANSWERS

```rv-answer
Edisp:
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

<<rv:value:Edisp>>
````

`link(E, p)` keeps magnitude and prefix paired: `1.5 kJ`, `2.5 MJ`, `4.5 GJ`.

### 33.7 Mathematical abstract units

````markdown
---
rv-category: geometry/area
---

## DEFINITIONS

```rv-def
s = pick(3, 5, 7)
A = s^{2} ; ; "u^2"
```

## QUESTIONS
A square has side $<<rv:val:s>>$ u.
Find its area.

## ANSWERS

```rv-answer
A:
unit-mode = declared
unit-label = square units
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

<<rv:value:A>>
````

Abstract mode comes from the declared unit's namespace; no answer key selects it. The answer displays `25 square units` (zero trimmed) and accepts `25 u^2`, `25 u²`, `25 sq. u`, `25
square units`.

### 33.8 Multi-value with per-binding policies

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
````

Two bindings make this multi-value automatically. Accepted typed forms include `V = 12 V, I = 6 A`, the full sentence, and `12 V; 6 A` in binding order.

### 33.9 Precision band and prefix display

````markdown
---
rv-category: physics/resistance
---

## DEFINITIONS

```rv-def
R = pick(12345.6789, 98765.4321) ; ; "Ω"
```

## QUESTIONS
A component has a resistance of $<<rv:val:R>>$ Ω.
Report it with at most two whole digits.

## ANSWERS

```rv-answer
R:
display = atomic
allowed-prefixes = auto
notation = auto
min-sigfigs = 3
max-sigfigs = 5
unit-optional = false
```

<<rv:value:R>>
````

`12345.6789 Ω` displays with an engineering prefix such as `12.3 kΩ` (display uses `min-sigfigs`) and accepts up to 5 significant figures. To suppress prefixing and force scientific
notation, use `allowed-prefixes = none` and `notation = scientific`; the answer reads `1.2346 × 10^4 Ω`. Both forms grade the same because grading is scale-aware.

### 33.10 English units

````markdown
---
rv-category: materials/mass
---

## DEFINITIONS

```rv-def
m = 150 ; ; "lb"
```

## QUESTIONS
A crate has a mass of 68.0389 kg. Express it in pounds.

## ANSWERS

```rv-answer
m:
unit-mode = expanded
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

<<rv:value:m>>
````

Displays `150 lb`. The typed value must satisfy `unit-mode = expanded` **and** carry at most `max-sigfigs = 3` written significant figures that reproduce the displayed value: `150 lb` and `1.5×10^2 lb` are accepted, while `68.0389 kg` and `68038.9 g` are rejected because they write six significant figures. Raise `max-sigfigs` if converted answers should pass. English units share the SI registry; mixed expressions such as `kg*ft/s^2` and `BTU/(h*ft*deltaF)` parse. `lb` is mass; `lbf`
is force. English units are never prefixed.

### 33.11 Absolute temperature

````markdown
---
rv-category: thermodynamics/temperature
---

## DEFINITIONS

```rv-def
T = 100 ; ; "°C"
```

## QUESTIONS
A thermometer reads 212 °F at boiling point. Convert it to degrees Celsius.

## ANSWERS

```rv-answer
T:
min-sigfigs = 3
max-sigfigs = 3
unit-optional = false
```

<<rv:value:T>>
````

Answer `100 °C`. Absolute units (`K`, `°C`, `°F`, `°R`) convert under `expanded` but never combine in a product; use `deltaC`/`deltaF` there. An absolute temperature and an interval are
never interchangeable.

### 33.12 Distractors with `rv-distract`

A complete quantity question whose wrong choices are plain numbers conditioned
onto the answer. Conditioning (`rv-distract`, §27.3) runs in the numeric,
quantity, and multi-value builders; plain-text questions ignore it, and authored-only
distractors need no fence at all (§33.1).

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

Notes:

- The fence sits **inside** `## DISTRACTORS`, one per note, and each line is
  `target, target <- anchor` (§27.3).
- `F` is the anchor: it must resolve on this draw and be used by the current
  answer variant — here it is the answer itself.
- `p`, `q`, `r` are the targets. Each one **must appear in a `## DISTRACTORS`
  block**, or the note warns and the conditioning has no effect (§27.3).
- A number target under a quantity anchor renders as a magnitude in the
  anchor's unit and prefix policy (§27.4): `p` becomes `50 N`, not a bare
  `50`, so the block parses as a quantity choice in the answer's unit.
- The target ranges (1–5, 45–70, 75–100) lie outside the answer's range
  (`m · a` = 6–42), so no choice can equal the correct one (§27.5).
- Quantity questions always offer choices; no session mode flag is written in
  the note.

## 34. Checklist before shipping

**Structure and definitions**

- [ ] A `.md` note under the review root, outside the session folder
- [ ] Frontmatter starts at byte 0; `rv-category` matches the folder or is omitted intentionally
- [ ] Exact plural headers, one of each; unused sections deleted; bare `---` separators
- [ ] Headers, fences, Mermaid, and LaTeX preview correctly
- [ ] `rv-def` under `## DEFINITIONS`; lines are `name = rhs` or `link(...)`
- [ ] Unique names; multi-letter RHS names use `\var{…}`; no variable named `e`
- [ ] Variables inside `pick()` are numeric or expression, declared earlier, and wrapped in `\var{…}`
- [ ] References are earlier (`link()` excepted); numeric RHS valid and finite
- [ ] `link()` flips (`-name`) only on non-first members
- [ ] Mixed `*` and `/` grouped; no `/` chain; powers next to operators braced
- [ ] `link()` members drawable, equal-count, rand parameters identical; one group per variable
- [ ] Quantity units/prefixes quoted or constructed; magnitude expressions grouped
- [ ] Draw sets preserve invariants across the cross-product

**Answers and placeholders**

- [ ] Mode matches intent; every surviving block has the same distinct val-name set
- [ ] One `<<rv:val:>>` per numeric answer block; unit-bearing block first
- [ ] Text answers plain with every accepted spelling; expression-only answers intended as text
- [ ] Literal answer sections contain exactly what the student types
- [ ] Every placeholder resolves unless literal-rendered; arguments numeric and earlier
- [ ] Documentation placeholders sit in a flagged section

**Quantity, variants, and multi-value**

- [ ] Each header names a quantity definition; declaration carries `value ; prefix ; unit`
- [ ] Answer block contains the bound placeholder, no manual unit suffix; display is typeable
- [ ] No literal unit after an `expression` placeholder on a quantity definition
- [ ] `min-sigfigs` coarsest, `max-sigfigs` highest and ≥ `min`
- [ ] `unit-mode = list` has `accept-units`; `prefix-policy = exact` only with `atomic`/atomic list
- [ ] Expanded mode intentional; non-SI extras listed; `lb` mass, `lbf` force
- [ ] Absolute temperatures not combined in products; `unit-optional` matches the question
- [ ] Intended typed forms tried: bare, prefixed, scientific, aliases
- [ ] Every answer block contains the same distinct value set; multi-value never split
- [ ] `typed-mode` and `sep` match expected answering; repeated placeholders intentional
- [ ] No adjacent value placeholders; no diagrams inside choice text

**Distractors and runtime**

- [ ] At least `choiceCount − 1` distinct plausible wrong values (three at the default of 4 choices); no incidental digits; text distractors distinct and short
- [ ] `rv-distract` targets numeric/string/quantity; every conditioned target used
- [ ] Author blocks are valid quantities or the literal fallback is intended
- [ ] `max_index` and `link()` variety checked across seeds; real session verified in both modes
- [ ] Choice grid and warning notes checked; Force show all warnings toggled

## 35. Quick reference

### 35.1 Placeholders

```text
<<rv:val:name>>
<<rv:values:name>>
<<rv:value:name>>
<<rv:expression:name>>
<<rv:expression:name:a:b>>
```

The `val` / `values` / `value` placeholders are interchangeable; `value` is
conventional for a bound quantity answer (§13.1). The declared data type decides
the rendering; both `expression` forms append the declared unit and prefix on a
quantity definition (§13.1).

### 35.2 Answer-key defaults

| Key | Default |
|---|---|
| `typed-mode` | `either` |
| `sep` | `,` |
| `unit-label` | none |
| `prefix-policy` | `any` |
| `allowed-prefixes` | `auto` |
| `unit-mode` | `expanded` |
| `accept-units` | none |
| `display` | `atomic` |
| `min-sigfigs` | `3` |
| `max-sigfigs` | `15` |
| `notation` | `auto` |
| `unit-optional` | `false` |

## 36. Source map

| Concern | Module |
|---|---|
| Frontmatter, sections, markers, fences, blocks | `src/parser/sections.ts` |
| Category, priority, exclusion, YAML helpers | `src/parser/properties/` |
| Note assembly and placeholder validation | `src/parser/parseNote.ts` |
| Definition lines, picks, quantities, links | `src/parser/definitions/variables.ts` |
| Definition orchestration, unit algebra, quantity arithmetic | `src/parser/definitions/` |
| Answer pruning, classification, `rv-answer` grammar, variants | `src/parser/answers/` |
| Placeholder extraction and filling | `src/parser/placeholders.ts` |
| `rv-distract` grammar | `src/parser/distractors/index.ts` |
| Expression criterion, AST, evaluator, numeric formatting | `src/math/` |
| Unit registry, prefixes, parsing, formatting, input, resolution | `src/math/units/` |
| Numeric/text/multi-value normalization and AST equivalence | `src/math/normalize/` |
| Grading, text acceptance, multi-value grading | `src/session/grading/grade.ts`, `grading/text.ts`, `grading/multiValue.ts` |
| Builders: text, numeric, quantity, multi-value | `src/session/build/index.ts`, `build/text.ts`, `build/numeric.ts`, `build/quantity.ts`, `build/multiValue.ts` |
| Distractors: numeric, quantity, multi-value, conditioning | `src/session/distractors/*.ts`, `distractors/condition.ts` |
| Draws, ranges, max_index sampling | `src/session/draws.ts` |
| Session assembly, retries, per-draw resolution | `src/session/assemble.ts`, `resolve.ts` |
| Constants and tolerance | `src/constants.ts` |
