# The Rust Handbook content pipeline and authoring contract

A reproduction reference, read out of `/Users/madalintat/learning_series/rust_learning`.
Everything below is quoted from or directly derived from:

| file | lines | role |
|---|---|---|
| `/Users/madalintat/learning_series/rust_learning/build.py` | 1391 | the whole pipeline: parser, renderer, validator, emitter |
| `/Users/madalintat/learning_series/rust_learning/docs/AUTHORING.md` | 377 | the human-facing contract |
| `/Users/madalintat/learning_series/rust_learning/CONTRIBUTING.md` | 69 | the one command, the review shape |
| `/Users/madalintat/learning_series/rust_learning/release.sh` | 111 | the verification sequence, single owner |
| `/Users/madalintat/learning_series/rust_learning/test_build.py` | 408 | regression suite for the parser and the cache |
| `/Users/madalintat/learning_series/rust_learning/.github/workflows/ci.yml` | | CI: build, compiler, live, deploy jobs |
| `/Users/madalintat/learning_series/rust_learning/assets/workbench.js` | 376 | the browser-side execution backend and diagnostics parser |
| `/Users/madalintat/learning_series/rust_learning/assets/app.js` | 1406 | routing and rendering of the emitted JSON |

## The shape in one paragraph

`content/` is authored markdown and JSON. `build.py` is a pure function from
`content/` to `data/`. `data/` is committed. The browser fetches JSON and paints;
there is no server, no framework, no dependency (`build.py` is stdlib only, the
site ships no JS libraries, and CI actively asserts that no `package.json` or
`requirements.txt` has appeared). The one thing that reaches outside is
`--validate`, which POSTs every exercise to `play.rust-lang.org` and holds the
content to what it claims.

```
content/units/<slug>.md      -> data/unit/<slug>.json
content/ex/<slug>.md         -> data/ex/<slug>.json
content/drills/<slug>.md     -> data/drills/<slug>.json
content/projects/<slug>.md   -> data/project/<slug>.json
content/glossary.json                \
content/gloss/<slug>.json            /-> data/glossary.json
TRACK (in build.py) + all of the above -> data/manifest.json, data/search.json
manifest -> llms.txt
```

Actual scale at the time of reading: 28 units, 13 projects, 224 exercises,
92 project stages, 420 drills, 72,572 words, validated against rustc 1.98.0.

---

## 1. The `TRACK` manifest

`TRACK` is a module-level list of 4-tuples in `build.py` (lines 43-79). It is the
table of contents, and the comment directly under it is the design rule:

> `TRACK` is the registry. num, title and accent come from here and nowhere else:
> reading them from front matter too gave a unit two identities, and a card could
> show one number while the page it opened showed another.

### Structure

```python
TRACK = [
    ("00-toolchain",    "The toolchain",              "slate",  "What rustc, cargo and an edition actually are, and what `cargo run` does to your file."),
    ("01-bindings",     "Bindings and mutability",    "amber",  "Why `let` is not assignment, what shadowing is for, and why mutability is a property of the binding."),
    ...
    ("05-ownership",    "Ownership",                  "ferris", "One owner, one drop. What a move copies, what it does not, and which bug the whole rule exists to prevent."),
    ...
    ("27-no-std",       "No_std and embedded",        "slate",  "What the standard library actually is, what survives without it, and how the same language runs on a microcontroller."),
]
```

Four positional fields, no names, no dict:

| position | field | type | meaning |
|---|---|---|---|
| 0 | `slug` | `str` | `NN-kebab-name`. The filename stem in all four content directories, the route segment, the cache-ref prefix, and the JSON filename. |
| 1 | `title` | `str` | Display title. Authoritative. |
| 2 | `accent` | `str` | One of `rust ferris amber clay moss slate plum`. Drives the card and page colour. |
| 3 | `blurb` | `str` | One sentence for the card. A **fallback**: the unit's own front-matter `blurb` wins if present (`build_manifest`: `u["blurb"] if u and u.get("blurb") else blurb`). |

### The three derived maps

```python
TITLES  = {slug: title  for slug, title, _, _ in TRACK}
ACCENTS = {slug: accent for slug, _, accent, _ in TRACK}
ORDER   = {slug: i for i, (slug, _, _, _) in enumerate(TRACK)}
```

`ORDER` is list position, so **the unit number is the index in `TRACK`, not the
number in the filename or front matter**. The numeric filename prefix is
convention (it makes `sorted(glob)` agree with `TRACK`) and nothing reads it.

### How TRACK drives the site

1. **Membership is mandatory.** `build_units()` raises if a unit's slug is absent:

```python
if slug not in ORDER:
    raise ValueError(
        f"{path.name}: slug {slug!r} is not in TRACK. "
        f"Add it to build.py's TRACK list or fix the slug.")
```
   with the comment: *"Without this the unit builds, prints its word count,
   satisfies the author's definition of done, and is invisible in the app,
   because only TRACK produces manifest entries."*

2. **Front matter that disagrees is ignored, loudly but non-fatally:**

```python
for key, want in (("num", ORDER[slug]), ("title", TITLES[slug]), ("accent", ACCENTS[slug])):
    got = meta.get(key)
    if got is not None and str(got) != str(want):
        print(f"  ! {path.name}: front-matter {key}={got!r} ignored; TRACK says {want!r}")
```

3. **TRACK, not the filesystem, generates the manifest.** `build_manifest`
   iterates `TRACK` and emits an entry per slug whether or not a file exists:

```python
entries.append({
    "slug": slug, "num": i, "title": title, "accent": accent,
    "blurb": u["blurb"] if u and u.get("blurb") else blurb,
    "ready": bool(u),                      # <- the stub flag
    "words": u["words"] if u else 0,
    "mins":  u["mins"]  if u else 0,
    "exercises": len(exs),
    "drills": len(drills.get(slug, [])),
})
```
   Header comment: *"Units without a file in content/units are emitted as stubs so
   the map is honest about what exists and what is still to come."* `ready: false`
   is how the site greys out an unwritten unit instead of hiding it.

4. **Project ordering.** `ORDER` sorts projects by how deep their prerequisites
   reach into the track:

```python
project_entries.sort(key=lambda p: (
    TIER_ORDER.index(p["tier"]),
    max([ORDER.get(n, 0) for n in p["needs"]] or [0]),
    p["title"]))
```

5. **Namespace collision check.** A project slug may not equal a unit slug,
   because validation merges the two dicts (`{**exercises, **projects}`) and they
   share the cache-key space:

```python
if slug in ORDER:
    raise ValueError(f"{path.name}: project slug {slug!r} collides with a unit slug")
```

6. **`search.json` is emitted in TRACK order**, not glob order:
   `for slug, *_ in TRACK if slug in units`.

### Adjacent module-level constants that belong to the same contract

```python
WPM  = 230              # a careful read of technical prose, not a skim
SITE = "https://github.com/madalintat/rust-handbook"
LIVE = "https://the-rust-handbook.com"

PER_UNIT   = {"exercises": 8, "drills": 15}
NOTE_WORDS = (1400, 2200)

TIERS = {
    "mini": ("Mini", "four stages, one idea, about twenty minutes", 4),
    "core": ("Core", "eight stages, a real program end to end", 8),
    "deep": ("Deep", "twelve stages or more, a weekend, something you would use", 12),
}
TIER_ORDER = ["mini", "core", "deep"]
DOMAINS = ["ai", "systems", "languages", "network", "graphics",
           "data", "crypto", "games", "tools", "embedded"]
```

The comment on `PER_UNIT`/`TIERS` states the philosophy of the whole file:

> docs/AUTHORING.md states these. Every one of them held by discipline alone
> until now, and a number a build prints without checking is decoration.

---

## 2. The unit note format

File: `content/units/<slug>.md`. Parser: `front_matter()` + `split_parts()` +
`render()`. Emitter: `build_units()`.

### Front matter

`---` delimited, one `key: value` per line, **split on the first colon only**,
values are always strings. The parser is deliberately not YAML:

```python
def front_matter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        raise ValueError("front matter opened with --- but never closed")
    meta = {}
    for line in text[3:end].strip().split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, text[end + 4 :].lstrip("\n")
```

Consequences to reproduce faithfully: no nesting, no lists, no quoting, no
comments, a line without a colon is silently skipped, and an unterminated block
is a named error rather than a traceback (*"leaving the author to bisect 56
markdown files by hand"*).

The real header, from `content/units/05-ownership.md`:

```markdown
---
num: 5
slug: 05-ownership
title: Ownership
accent: ferris
concepts: move, drop, Copy, Clone, ownership, RAII, double free, use after free
needs: 01-bindings, 03-expressions
blurb: One owner, one drop. What a move actually copies, what it does not, and which bug the whole rule exists to prevent.
---
```

| key | type | required | consumed by | notes |
|---|---|---|---|---|
| `slug` | str | **effectively yes** | `build_units` | Defaults to `path.stem` if absent. Must be in `TRACK` or the build raises. |
| `num` | int-as-str | no | nothing | Cross-checked against `ORDER[slug]`, warned about, then discarded. |
| `title` | str | no | nothing | Cross-checked against `TITLES[slug]`, warned, discarded. |
| `accent` | str | no | nothing | Cross-checked against `ACCENTS[slug]`, warned, discarded. |
| `concepts` | comma list | no (defaults `[]`) | `unit.concepts`, `search.json` | `[c.strip() for c in meta.get("concepts","").split(",") if c.strip()]`. Rendered as chips. |
| `blurb` | str | yes in practice | `unit.blurb`, manifest card | Overrides the TRACK blurb when non-empty. |
| `needs` | comma list | no | **nothing, for units** | Authored in every unit and read only for *projects* (`build_projects`). For units it is documentation for a human and for `llms.txt` prose. A reproduction can either wire it up or drop it. |

So the required set is small: `slug` (or a filename that is a TRACK slug) plus a
`blurb` if you do not want the TRACK fallback. Everything else is either
cross-checked-and-discarded or optional.

### Body structure: parts and sub-topics

```markdown
%% The opening paragraph, the lede.

One more short paragraph, then straight into the first part.

## A part title

Optional intro prose.

### A sub-topic

Body.
```

`split_parts()` implements the whole readability policy:

```python
def split_parts(body, seen, toc):
    """A unit is cut at its `##` boundaries into parts, and a long part is cut
    again at `###` into sub-topics. That is the whole readability trick: nobody
    opens a 5,000-word page, but everybody opens a four-minute section."""
```

- Everything before the first `##` is the **lead**, rendered and emitted as
  `unit.lead`.
- Each `##` becomes a **part**: `{id, title, intro, subs, words, mins}`.
- Everything in a part before its first `###` is that part's `intro` (HTML).
- Each `###` becomes a **sub**: `{id, text, html, words, mins}`.
- Only two levels are split. `####` is rendered as a heading by `render()` but
  does not create a structural node.

AUTHORING.md's targets (not enforced): 5 to 7 parts, 2 to 4 subs each, one to
four minutes per sub, and *"the first part opens by default in the reader, so it
must carry the argument."* `app.js` honours that literally: `sectionBlock(..., pi === 0)`.

### The lede directive

The only custom paragraph syntax. In `render()`'s paragraph branch:

```python
text = " ".join(body)
cls = ' class="lede"' if text.startswith("%%") else ""
out.append(f"<p{cls}>{inline(text.lstrip('%').strip())}</p>")
```

`%%` at the start of a paragraph emits `<p class="lede">`. The marker is
stripped with `lstrip('%')`, so any run of leading `%` works.

### Custom block syntax

Beyond CommonMark-ish basics (ATX headings 1-4, `|` tables with a `|---|`
separator row, `>` blockquotes recursively rendered, `-`/`*` and `1.` lists with
indented continuation lines, fenced code), there are two custom constructs.

**1. `:::` callouts.** Delimited by a `:::kind` opener and a bare `:::` closer.

```python
CALLOUTS = {
    "note":    ("callout", "Note"),
    "gotcha":  ("callout gotcha", "Gotcha"),
    "compare": ("callout compare", "Coming from elsewhere"),
}
```

An unknown kind falls back to `note` (`CALLOUTS.get(kind, CALLOUTS["note"])`), so
a typo degrades rather than crashes. The body is rendered recursively, so a
callout may contain code, lists and tables. Output:
`<div class="{cls}"><div class="ct">{label}</div>{rendered body}</div>`.

**2. `:::memory <title>` ASCII diagrams.** Special-cased *before* the callout
lookup, matched with `kind.startswith("memory")`:

```python
if kind.startswith("memory"):
    title = kind[6:].strip() or "In memory"
    out.append(
        f'<div class="memory"><div class="mt">{html.escape(title)}</div>'
        f'<pre>{html.escape(chr(10).join(body), quote=False)}</pre></div>')
```

The body is escaped and dropped into `<pre>` **without inline processing**, which
is the point: `->`, `*`, `_` and `|` in a diagram must survive verbatim.
`test_build.py` pins this: *"memory body is not inline-processed"* and *"arrows
must not become &rarr; inside a diagram"*. AUTHORING.md: *"Use box-drawing
characters `┌─┐│└┘├┤▶●✗` and keep columns aligned. These diagrams are the single
most effective thing in the book."*

A real one:

```markdown
:::memory let s = String::from("hi")
       STACK  (frame of main)                HEAP
     ┌───────────────────────────┐         ┌───┬───┐
 s   │ ptr      ●────────────────┼────────▶│ h │ i │
     │ len      2                │         └───┴───┘
     │ capacity 2                │
     └───────────────────────────┘
     24 bytes, whether the string
     holds 2 chars or 2 million
:::
```

### Fences and the tone system

```python
FENCE = re.compile(r"^(`{3,})(.*)$")
TONES = {"bad": "will not compile", "good": "compiles"}

def fence_meta(info):
    head, _, rest = info.partition(",")
    flag = rest.strip()
    if flag in TONES:
        return (head.strip() or "rust"), flag, TONES[flag]
    return (info or "rust"), "", (info or "rust")
```

- Three **or more** backticks open a fence; the closer must be at least as long.
  This is load bearing, not a nicety: AUTHORING.md documents the format using
  ` ````markdown ` blocks, and *"a parser that only knows ``` closes on the first
  inner line and shreds everything after it."* `test_build.py` has seven
  assertions on this alone.
- `read_fence` returns `(info, code, next_i, raw)`. `raw` is the block exactly as
  written, tick count preserved, *"because a caller that only wants to ROUTE the
  block must not re-serialise it."*
- An unterminated fence consumes to EOF without hanging.
- `rust,bad` -> `<div class="codeblock bad">` with the header "will not compile".
  `rust,good` -> green, "compiles". Anything else is a label, never a lookup that
  can fail: `no_run`, `text`, `sh`, `toml`, `c`, `cpp` all appear in the corpus
  and all just print themselves in the header.
- Fence bodies are escaped with `html.escape(code, quote=False)`. `"` is
  deliberately left alone inside `<pre><code>`.

Fence-tag census across `content/`: 436 `rust`, 316 each of `starter`/`tests`/
`solution`, 85 `rust,bad`, 29 `rust,good`, 12 `text`, 6 `toml`, 6 `sh`, 5 `c`,
2 `cpp`.

### Inline syntax and glossary linking

`inline()` runs in a fixed order, and the order is the design:

1. **Stash code spans first.** `` `...` `` contents are pulled out to a
   placeholder `\x00N\x00`, *"because a `*` or a `_` inside `let x = a * b` is not
   emphasis and an escaped underscore in every code sample would make the source
   unreadable to write."*
2. `html.escape(text, quote=False)`.
3. Links: `[text](url)` -> `<a href="...">`, done before emphasis so link text
   can still carry emphasis.
4. **Bold, which is also the glossary hook.** This is the cross-reference syntax:

```python
def bold(m):
    term = m.group(1)
    entry = GLOSSARY.get(re.sub(r"<[^>]+>", "", term).lower())
    if entry:
        GLOSS_USE.setdefault(entry["t"].lower(), set()).add(
            (_CUR["unit"], _CUR["title"], _CUR["kind"]))
        return (f'<span class="term" data-g="{html.escape(entry["p"], quote=True)}"'
                f' data-t="{html.escape(entry["t"], quote=True)}">{term}</span>')
    return f"<strong>{term}</strong>"
```

   `**term**` is a hover-glossed term **if and only if** the lowercased text is a
   key in the loaded glossary; otherwise it is plain `<strong>`. There is no
   separate link syntax and no way to get a broken glossary link. The definition
   is inlined into the HTML as `data-g`, so the reader needs no second fetch.

   The side effect is the **back-reference index**: every hit records
   `(unit slug, unit title, kind)` into `GLOSS_USE`, which becomes each glossary
   term's `in` array in `data/glossary.json`. The module-global `_CUR` dict is
   what makes this work, and its correctness is the reason `parse_exercise_file`
   exists as one function (*"Three copies of this existed at various times and
   each one drifted in the line that sets _CUR, which is how glossary terms ended
   up filed under the wrong unit and then under the wrong kind."*).
5. Italic: `*text*` with a negative lookbehind `(?<![*\w])` and lookahead
   `(?!\*)` so it cannot eat a bold marker or an intra-word underscore-ish star.
6. Unstash code spans as `<code>...</code>`.

Note there is **no autolinking, no wiki-links, and no `[[unit]]` cross-reference
syntax**. Cross-unit references are ordinary markdown links written by hand, and
`app.js` renders `needs` slugs as `#/unit/<slug>` chips for projects only.

### Heading ids and the contents rail

```python
def slug_id(text, seen):
    """A stable, readable id for a heading. Collisions get a numeric suffix."""
    s = re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", text).lower()).strip("-")
    s = s or "section"
    if s in seen:
        seen[s] += 1
        s = f"{s}-{seen[s]}"
    else:
        seen[s] = 0
    return s
```

`seen` is one dict for the whole unit, so ids are unique per page. First
occurrence gets the bare slug, the second gets `-1`, the third `-2`.
`test_build.py`: *"duplicate headings get distinct ids"*.

**The rail is not built from a `toc` array.** `render()` and `split_parts()` both
accept a `toc` list and append `{"id","text","level"}` entries for `##`/`###`,
and `build_units()` does pass one, but it is never written to the unit JSON. The
emitted `parts[].id/title/mins` and `parts[].subs[].id/text/mins` are the real
source, and `app.js` reconstructs the rail from them:

```js
const railItems = u.parts.flatMap((p) => [
  { href: `#/unit/${slug}/${p.id}`, id: p.id, text: p.title, level: 2, note: `${p.mins}m` },
  ...p.subs.map((sub) => ({ href: `#/unit/${slug}/${sub.id}`, id: sub.id,
                            text: sub.text, level: 3, note: `${sub.mins}m` })),
]);
```

Rail links are **full routes** (`#/unit/<slug>/<id>`), not bare fragments,
because the app owns the hash: *"A bare `#some-heading` would be parsed by this
app's own hash router as a route, match nothing, and render the 404, which is
exactly what it did before."* Reproduce that or reproduce the bug.

The dead `toc` plumbing is harmless but is dead code; a reproduction can drop it.

### Word-count enforcement: the exact bounds and the failure

```python
NOTE_WORDS = (1400, 2200)
```

Counted in `build_units()` **after rendering**, over the stripped HTML:

```python
def words_of(html_text):
    return len(re.sub(r"<[^>]+>", " ", html_text).split())

w = words_of(lead) + sum(p["words"] for p in parts)
...
lo, hi = NOTE_WORDS
if not lo <= w <= hi:
    raise ValueError(f"{path.name}: {w:,} words, the note should be "
                     f"{lo:,} to {hi:,}")
```

Confirmed: **1,400 to 2,200 inclusive**, matching the docs exactly. On violation
the build raises `ValueError` and dies; there is no warning mode and no override.
Two details that matter when porting:

- The count is of *rendered* text, so code blocks, table cells, callout bodies
  and `:::memory` diagram contents all count as words. `05-ownership.md` is 1,977
  words by `wc -w` on the raw file and 1,773 by `words_of` on the HTML.
- The `raise` happens **after** `data/unit/<slug>.json` has already been written.
  An over-long note therefore leaves a valid JSON file behind and then kills the
  build before the manifest is regenerated. Not a bug in practice (the build is
  all-or-nothing and CI checks `git status data/`), but a reproduction that wants
  a clean failure should move the check above the write.

Reading time: `mins_of(n) = max(1, round(n / 230))`, computed at build time for
the unit, each part, and each sub.

---

## 3. The exercise format

This is the core of the product. File: `content/ex/<slug>.md`. Parser:
`parse_exercise_file()` -> `parse_exercise()`. The **same parser** handles project
stages, so everything here applies to `content/projects/<slug>.md` too.

### File-level grammar

```
file        := front-matter? lead-prose? exercise+
front-matter:= "---" NL (key ":" value NL)* "---"
exercise    := "## " INT "." title NL body
body        := ( directive | fence | prose-line )*
```

```python
def parse_exercise_file(path):
    meta, body = front_matter(path.read_text())
    slug = meta.get("unit") or meta.get("project") or path.stem
    kind = "project" if meta.get("project") else "unit"
    _CUR["unit"]  = slug
    _CUR["title"] = TITLES.get(slug, meta.get("title", slug))
    _CUR["kind"]  = kind
    lead, blocks = sections(body)
    items = sorted((parse_exercise(b, i) for i, b in enumerate(blocks, 1)),
                   key=lambda e: e["n"])
    return meta, slug, lead, items
```

- Front matter for an exercise file is minimal: just `unit: <slug>`. (For a
  project file it is `project:` plus the project metadata, see section 5.)
- Exercises are delimited by `##` headings only. `sections(md, "##")` splits with
  `re.split(rf"^{hashes}\s+(.+)$", md, flags=re.M)` and zips alternate captures.
  There is no other delimiter; a `###` inside an exercise body is just prose.
- The heading is `## N. Title`. `re.match(r"^(\d+)\.\s*(.+)$", head.strip())`
  gives the number and title. If it does not match, the number falls back to the
  1-based document position and the whole heading becomes the title.
- Items are **sorted by `n`**, so authored order does not have to be numeric
  order, and the number in the heading is the identity used everywhere
  downstream (route `#/work/<slug>/<n>`, cache ref `<slug>#<n>`, progress key).
- Prose before the first `##` is `lead`. For an exercise file it is parsed and
  then **discarded** (`build_exercises` does `_, slug, _, exs = ...`). For a
  project it becomes the intro.

### The exercise record

`parse_exercise` initialises exactly this and fills it in:

```python
ex = {
    "n": num,
    "title": title,
    "kind": "fix",
    "concept": "",
    "expect": None,
    "starter": "",
    "tests": None,
    "solution": "",
    "hints": [],
    "diagnose": {},
    "brief": "",
    "after": "",
}
```

plus a computed `"mins"` at the end. Defaults matter: `kind` defaults to `"fix"`,
`tests` defaults to `None` (distinguishable from an empty block), `starter` and
`solution` default to `""`.

### The directive grammar

```python
DIRECTIVE = re.compile(r"^@(\w+)(?:\s+(.*))?$")
```

Matched against the **stripped** line, so a directive must be alone on its line,
may be indented, and its argument is everything after the first run of
whitespace. A directive inside a fenced block is not seen, because fences are
consumed first.

The complete set, exhaustively, from the parser's dispatch:

| directive | argument | effect | sink after |
|---|---|---|---|
| `@kind` | `fix` \| `fill` \| `write` \| `predict` | `ex["kind"] = val` | brief |
| `@concept` | one lowercase word | `ex["concept"] = val` | brief |
| `@expect` | see below | parsed into a dict or `None` | brief |
| `@hint` | one line of prose | appended to `ex["hints"]` | brief |
| `@diagnose` | an error code (the map key) | opens a new sink `("diagnose", val)`, creates `ex["diagnose"][val] = []` | that diagnose block |
| `@after` | none | opens the `after` sink | after |

Corpus census: 917 `@hint`, 561 `@diagnose`, 316 `@kind`, 316 `@concept`,
316 `@after`, 314 `@expect` (two exercises are `@kind predict` and carry none),
plus 420 `@why` which belongs to drills, not exercises.

`@kind` census: 304 `fix`, 6 `fill`, 4 `write`, 2 `predict`. The format supports
four kinds but the corpus is overwhelmingly `fix`, and only `predict` changes
what the validator does.

**An unrecognised `@foo` is silently swallowed.** The dispatch is a chain of
`elif`s with no `else`, and the line is consumed either way (`i += 1; continue`).
A typo like `@hints` deletes the line without a word of complaint. This is the
one hole in an otherwise strict format, and a reproduction should close it with
an `else: raise ValueError(f"unknown directive @{key}")`.

### The sink machine

The single subtle mechanism in the file. `sink` is `None` (meaning brief),
`"after"`, or `("diagnose", code)`. All loose content, prose lines *and* fences,
routes through one function:

```python
def emit(text):
    """Route one chunk to the active sink. Written twice, once for prose,
    once for fences, the two copies disagreed, and a fence inside a
    @diagnose landed in the brief, giving the answer away."""
    if isinstance(sink, tuple) and sink[0] == "diagnose":
        ex["diagnose"][sink[1]].append(text)
    elif sink == "after":
        after.append(text)
    else:
        brief.append(text)
```

`@kind`, `@concept`, `@expect` and `@hint` all reset `sink = None`, so prose
following any of them goes back to the brief. `@diagnose` and `@after` do not
reset; content accumulates until the next directive. Ordering therefore is:
brief first, then blocks, then hints, then diagnoses, then after. That is the
order AUTHORING.md prescribes and the parser is what enforces it.

### The three named fences

```python
if FENCE.match(s):
    tag, text, i, raw = read_fence(lines, i)
    if tag in ("starter", "tests", "solution"):
        ex[tag] = text
        continue
    emit(raw)
    continue
```

`starter`, `tests` and `solution` are info strings, not directives. They are
recognised **anywhere in the body regardless of the current sink** and their
content is stored raw and unrendered. Every other fence (```` ```rust ````,
```` ```text ````, a nested ```` ````markdown ````) is emitted verbatim into the
current sink and later run through `render()`.

That last point is what makes `raw` exist. `test_build.py` pins four regressions
here: a fence inside `@diagnose` must stay in the diagnose and must **not** leak
into the brief; same for `@after`; and a ```` ````markdown ```` block inside an
`@after` must survive whole rather than being truncated at its inner fence.

### `@expect`: the full grammar

```python
elif key == "expect":
    # Not every rustc error has a code. `const LIMIT = 4;` gives a
    # bare "missing type for const item", and an exercise built on
    # one could previously assert nothing at all about why its
    # starter failed, so it would keep passing validation even if
    # it began failing for a completely different reason.
    if not val:
        ex["expect"] = None
    elif val in ("test-failure", "none"):
        # The starter must still fail; there is just no compiler
        # message to pin. A mismatched #[should_panic], a stale
        # doctest.
        ex["expect"] = {"any": True}
    elif re.fullmatch(r"E\d{4}", val):
        ex["expect"] = {"code": val}
    else:
        ex["expect"] = {"msg": val.strip('"\'')}
    sink = None
```

Four forms, in precedence order:

| written | parsed | meaning |
|---|---|---|
| `@expect` (bare) | `None` | asserts nothing. Only legal for `@kind predict`. |
| `@expect test-failure` or `@expect none` | `{"any": True}` | the starter must still fail, but no message is checked. |
| `@expect E0382` | `{"code": "E0382"}` | exact `E` + four digits. The preferred form. |
| `@expect "missing type for `const` item"` | `{"msg": "missing type for `const` item"}` | any other text. Surrounding `"` or `'` stripped. Matched **case-insensitively as a substring** of stderr. |

The regex is `E\d{4}` with `fullmatch`, so the code form is rigid. In the whole
corpus, 312 of 314 `@expect`s are E-codes and 2 are `test-failure`; the quoted
message form is documented and supported but currently unused.

### A full exercise, verbatim

`content/ex/05-ownership.md`, exercise 1. This is the canonical example the
project's own docs point at.

````markdown
---
unit: 05-ownership
---

## 1. The function ate your string

@kind fix
@concept move
@expect E0382

`describe` only wants to know how long the string is. But look at its signature: it
takes `String` **by value**, which means calling it hands over ownership. When
`describe` returns, its parameter goes out of scope and the buffer is freed. By
the time `run` tries to format `s`, there is nothing there.

Make this compile. There is more than one correct answer, and one of them is
better than the others.

```starter
pub fn describe(s: String) -> usize {
    s.len()
}

pub fn run() -> String {
    let s = String::from("ferris");
    let n = describe(s);
    format!("{s} has {n} bytes")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_the_string() {
        assert_eq!(run(), "ferris has 6 bytes");
    }
}
```

```solution
pub fn describe(s: &str) -> usize {
    s.len()
}

pub fn run() -> String {
    let s = String::from("ferris");
    let n = describe(&s);
    format!("{s} has {n} bytes")
}
```

@hint `describe` never modifies the string and never needs to keep it. It only reads it.
@hint Change the parameter type so the function borrows instead of taking ownership, then pass `&s` at the call site.
@hint `pub fn describe(s: &str) -> usize`, and `&String` coerces to `&str` automatically, so `describe(&s)` just works.

@diagnose E0382
Read the three underlines rustc gave you, because together they are a complete
story:

- `move occurs because s has type String, which does not implement the Copy trait` is the *reason*. A `String` owns a heap buffer, so duplicating its three-word handle would produce two owners of one allocation. Rust will not do that silently.
- `value moved here` under `describe(s)` is *where* ownership left. Passing by value to a function is a move, the same as an assignment.
- `value borrowed here after move` is *what broke*. The `{s}` inside `format!` needs to read `s`, and `s` no longer owns anything to read.

The compiler is not objecting to the `format!`. It is objecting to the
combination: you gave the string away on one line and read it on the next. Fix
either half and it is happy.

@after
The fix you want is `&str`, not `&String`, and the reason is worth internalising
early. A `&String` can only ever point at a heap-allocated `String`. A `&str`
points at *any* run of UTF-8 bytes: one inside a `String`, a literal baked into
the binary, or a slice of either. Taking `&str` makes `describe` callable with
`describe("hi")` as well as `describe(&s)`, at no cost.

The rule of thumb that follows: **take the most general borrowed form your
function can work with.** `&str` over `&String`, `&[T]` over `&Vec<T>`. Return
the owned form; accept the borrowed one.
````

Note the shape of the hints: three of them, escalating, and the third is nearly
the answer including the signature. AUTHORING.md: *"A nudge that reframes the
problem without naming the fix. / Stronger, point at the mechanism. / Nearly the
answer, including the signature they need."*

### The `diagnose` map: authoring and emission

`@diagnose <KEY>` opens a block. The key is whatever text follows the directive
and becomes a **literal JSON object key**; nothing validates that it is an error
code, and nothing cross-checks it against `@expect` at parse time (the validator
does that later, against reality).

Authored:

```markdown
@diagnose E0382
Read the three underlines rustc gave you, because together they are a complete
story:

- `move occurs because ...` is the *reason*. ...

@diagnose E0308
Another likely error for this exercise.
```

Accumulated as a list of raw lines, then rendered as a unit at the end of
`parse_exercise`:

```python
ex["diagnose"] = {k: render("\n".join(v)) for k, v in ex["diagnose"].items()}
```

Emitted into `data/ex/<slug>.json` as `exercises[i].diagnose`, an object of
`code -> HTML string`. It is looked up by *the code the reader actually hit*, not
the expected one, in `assets/app.js`:

```js
${!e.inTests && ex.diagnose[e.code] ? `<div class="why">
    <div class="lbl">${ico('bulb', 12)} What that actually means</div>
    ${ex.diagnose[e.code]}</div>` : ''}
```

Three properties fall out of that one line and they are the product:

1. **Keyed by observed code.** The reader who writes a different wrong answer and
   gets `E0499` sees the `E0499` prose, not the `E0382` prose. AUTHORING.md:
   *"Write every code the exercise can plausibly raise, not just the expected
   one."*
2. **A miss is silent.** No `diagnose` entry means no explanation panel; the raw
   rustc output and the error-index link are still shown. That is why the
   validator's *"no @diagnose written for E0382"* finding exists: the format
   cannot fail loudly at runtime, so it fails loudly at build time.
3. **Suppressed for errors inside the hidden tests** (`!e.inTests`), which get a
   fixed generic explanation instead, because a diagnostic about the test harness
   is never about the concept.

AUTHORING.md on the prose itself: *"What rustc is actually saying. Walk its
underlines. 80 to 140 words. This is the most valuable text in the whole
platform. It is what the reader sees at the moment they are stuck."*

### How starter, tests and solution are combined at check time

Server side (`build.py`, `compile_once`):

```python
payload = {
    "channel": "stable",
    "mode": "debug",
    "edition": "2024",
    "crateType": "lib" if tests else "bin",
    "tests": bool(tests),
    "backtrace": False,
    "code": code + ("\n\n" + tests + "\n" if tests else ""),
}
```

Browser side (`assets/workbench.js`, `assemble`) builds the identical payload and
adds one thing the build does not need:

```js
/* Hidden tests are appended, never prepended, so that every line number rustc
   reports about the reader's own code still points at the line they are
   looking at. Anything past `userLines` came from the tests. */
function assemble(code, tests) {
  return {
    source: tests ? code + '\n\n' + tests + '\n' : code,
    userLines: code.split('\n').length,
  };
}
```

`userLines` is the whole trick for attributing errors: `parse()` sets
`cur.inTests = cur.line > userLines`, and `renderOutput` uses that to swap the
diagnose panel for the "this one is in the hidden tests" explanation.

Consequences the author must respect, and AUTHORING.md states them:

- Tests are appended to the reader's buffer as a sibling `#[cfg(test)] mod tests`
  block, so **they may only call `pub` items**. Never reference a private name.
- `crateType` is `lib` when tests are present, `bin` otherwise. That is why the
  convention is `pub fn run() -> ...` rather than `fn main()`: it gives the tests
  a stable entry point and leaves the reader free to change every other signature.
- Difficulty ramps across the eight: *"Number 1 is nearly free; number 8 should
  make a competent reader think."*

### Count enforcement

```python
if len(exs) != PER_UNIT["exercises"]:
    raise ValueError(f"{path.name}: {len(exs)} exercises, "
                     f"the contract is {PER_UNIT['exercises']}")
```

Exactly 8, not a minimum. Raised **after** `data/ex/<slug>.json` is written, same
ordering wrinkle as the word count.

### Computed reading time

```python
ex["mins"] = max(2, mins_of(words_of(ex["brief"])) + len(ex["starter"].split("\n")) // 12)
```

Brief reading minutes plus one minute per twelve lines of starter, floored at two.

---

## 4. The drills format

File: `content/drills/<slug>.md`. Parser and emitter are the single function
`build_drills()`. It does not reuse `parse_exercise`; drills are a separate,
simpler grammar.

### Authored shape

````markdown
---
unit: 05-ownership
---

## 1

Does this compile?

```rust
let a = String::from("hi");
let b = a;
println!("{a}");
```

- A. Yes, `a` and `b` both point at the string
- *B. No, `a` was moved into `b`
- C. No, `String` cannot be printed with `{}`
- D. Yes, but it prints an empty string

@why
`String` is not `Copy`, so `let b = a;` **moves**. It copies the three-word handle
and retires `a`. Reading `a` afterwards is `error[E0382]`.

The tempting wrong answer is D. Nothing is blanked at runtime; `a`'s bytes are
still sitting in the stack frame. The restriction is purely in the compiler's
bookkeeping, which is exactly why it costs nothing.
````

### The grammar, precisely

- Front matter: `unit: <slug>` only. Falls back to `path.stem`.
- Questions are delimited by `##`, same `sections()` split. The heading is just a
  number: `n = int(re.match(r"^(\d+)", head.strip()).group(1))`. **A heading not
  starting with a digit crashes with an `AttributeError`**, not a named error.
  Trailing text after the number is tolerated and ignored.
- Questions are sorted by `n` (`qs.sort(key=lambda q: q["n"])`).
- Three sinks: `stem` (default), `why`, and the option list.

**Options.** One regex, and it is the whole answer encoding:

```python
mo = re.match(r"^-\s*(\*?)\s*([A-E])\.\s+(.*)$", s)
if mo and sink != "why":
    opts.append({"key": mo.group(2), "text": inline(mo.group(3)),
                 "correct": mo.group(1) == "*"})
```

- A list item, `-` only (`*` bullets would collide with the correct-answer
  marker).
- An optional `*` **before** the letter marks it correct.
- The key must be a single capital letter `A` to `E`. Five options maximum,
  hard-coded. `F` falls through to the stem, silently.
- Option text is run through `inline()`, not `render()`, so an option can carry
  code spans, bold, italics and links but cannot be a block.
- Options are only recognised while `sink != "why"`, so a `- A.`-shaped line
  inside the explanation is safe.

**`@why`.** Recognised by exact string equality, not by the `DIRECTIVE` regex:

```python
if s == "@why":
    sink = "why"
```

So `@why something` is not a directive and lands in the stem. Everything after
`@why` to the end of the question is the explanation, rendered with `render()`
(full block markdown, including fences).

**Fences** are routed by the same sink and kept `raw`, so a code block belongs to
the stem before `@why` and to the explanation after it:

```python
if FENCE.match(s):
    _, _, i, raw = read_fence(lines, i)
    (why if sink == "why" else stem).append(raw)
    continue
```

### The emitted record

```python
qs.append({
    "n": n,
    "stem": render("\n".join(stem)),
    "options": opts,
    "answer": "".join(o["key"] for o in opts if o["correct"]),
    "why": render("\n".join(why)),
})
```

- `answer` is a **concatenated string of the correct keys** in option order:
  `"B"` for single-answer, `"ABDE"` for multi-answer. Multi-answer is not a
  separate mode; it emerges from marking more than one option with `*`.
  AUTHORING.md: *"Several `*` makes it multi-answer; phrase the stem as 'Choose
  all that apply.'"* Exercise 3 of `05-ownership` does exactly that, with five
  options and four correct.
- Nothing checks that at least one option is correct, that keys are contiguous,
  or that they start at `A`. A question with no `*` emits `"answer": ""`.

### Count enforcement

```python
if len(qs) != PER_UNIT["drills"]:
    raise ValueError(f"{path.name}: {len(qs)} drills, "
                     f"the contract is {PER_UNIT['drills']}")
```

Exactly 15, raised after the JSON is written. 28 units x 15 = 420, matching the
`@why` count in the corpus.

### Authoring rules that are not enforced

From AUTHORING.md, all on the author:

- *"Four or five options. Every distractor must be plausible, no filler."*
- *"Why the right answer is right, **and why the tempting wrong one is
  tempting**. 50 to 110 words. Naming the trap is most of the value."* The real
  `@why` blocks visibly do this: every one in `05-ownership` names the specific
  distractor and says why it attracts.
- *"Vary the shape: 'does this compile', 'what does it print', 'which of these
  moves', 'why can X not be Y', 'what is the cost of'."*
- *"each one teaches something the note did not quite say."*

---

## 5. Projects and the glossary

### Projects

File: `content/projects/<slug>.md`. Emitter: `build_projects()`. A project is an
intro plus a list of **stages**, and *"a stage is an exercise, so this reuses the
exercise parser wholesale."* Every directive from section 3 is available and
behaves identically.

Front matter, from `content/projects/huffman.md`:

```markdown
---
project: huffman
tier: mini
domain: data
title: Huffman coding
accent: moss
blurb: Count the bytes, grow a tree out of a heap, and pack a paragraph of English into a bit over half its size, then get every byte of it back.
needs: 09-enums, 11-collections, 18-smart-ptr
mins: 30
---
```

| key | type | required | validated | default |
|---|---|---|---|---|
| `project` | slug str | yes | must not collide with a unit slug | `path.stem` |
| `title` | str | yes in practice | no | the slug |
| `accent` | str | no | no | `"plum"` |
| `blurb` | str | yes in practice | no | `""` |
| `tier` | `mini`\|`core`\|`deep` | no | **yes**, must be a `TIERS` key | `"core"` |
| `domain` | one of `DOMAINS` | no | **yes**, must be in the list | `"tools"` |
| `needs` | comma list of unit slugs | no | no | `[]` |
| `mins` | int | no | `int()`, so a non-integer crashes | computed |

Note that unlike a unit, a project's `title` and `accent` **are** authoritative:
projects are not in `TRACK`, so there is no registry to disagree with.

Three validations, all fatal:

```python
if slug in ORDER:
    raise ValueError(f"{path.name}: project slug {slug!r} collides with a unit slug")
tier = meta.get("tier", "core")
if tier not in TIERS:
    raise ValueError(f"{path.name}: tier {tier!r} is not one of {list(TIERS)}")
domain = meta.get("domain", "tools")
if domain not in DOMAINS:
    raise ValueError(f"{path.name}: domain {domain!r} is not one of {DOMAINS}")
want = TIERS[tier][2]
if len(stages) < want or (tier != "deep" and len(stages) != want):
    raise ValueError(
        f"{path.name}: tier {tier} promises {TIERS[tier][1]}, "
        f"but this has {len(stages)} stages")
```

The stage-count rule reads: `mini` is **exactly** 4, `core` is **exactly** 8,
`deep` is **12 or more**. The comment explains why the check exists at all:
*"docs/AUTHORING.md stated all three counts and nothing verified any of them, so
a tier was a label a project could simply contradict."*

Duration:

```python
"mins": int(meta.get("mins", 0)) or max(20, mins_of(words) + 4 * len(stages)),
```

An authored `mins` wins; otherwise it is reading minutes plus four minutes per
stage, floored at twenty. Note `mins: 0` is falsy and falls through to the
computed value.

The intro is prose before the first `## 1.` heading, rendered with `render()`.
AUTHORING.md: *"Two or three hundred words: what the thing is, where it is used in
the real world, and what you will understand at the end that you do not now. No
marketing. If the honest answer is 'this is a toy', say what the real version
adds."* `huffman.md`'s intro does precisely that, ending with two named
omissions (storing the tree, and the LZ77 stage).

The one structural rule projects add, and the one nothing can check:

> **Stages accumulate.** Stage N's `starter` contains the finished code from
> stages 1 to N-1, plus the next piece stubbed out. The reader is editing one
> growing program, not eight unrelated snippets. By the last stage the file is
> the whole thing and it runs.
>
> This is the hardest part to get right. Write all eight solutions first, check
> that stage 8's solution is a complete working program, then derive each starter
> by taking the previous solution and removing the next piece.

Plus: *"A stage whose tests pass should leave a program the reader can run and see
do something. ... A stage that only satisfies a type checker is a bad stage."*

Emitted `data/project/<slug>.json`:

```
{slug, title, accent, blurb, tier, domain, needs, mins, words, intro, stages}
```

where each stage is a full exercise record. The manifest carries everything
except `intro` and `stages`, replacing the latter with `stages: <count>`.

### The glossary

Two source shapes, one loader:

```python
def load_glossary():
    sources = []
    p = CONTENT / "glossary.json"
    if p.exists():
        sources.append(p)
    sources.extend(sorted((CONTENT / "gloss").glob("*.json")))
    for src in sources:
        try:
            data = json.loads(src.read_text())
        except json.JSONDecodeError as e:
            print(f"  ! {src.name} is not valid JSON: {e}")
            continue
        for e in data.get("terms", []):
            GLOSSARY[e["t"].lower()] = e
```

- `content/glossary.json` is the shared file, loaded first.
- `content/gloss/*.json` are per-unit files, loaded in filename order, **later
  wins**. The concurrency rationale: *"Per-unit files exist so several authors can
  add terms at once without editing, and corrupting, one shared JSON document."*
  AUTHORING.md is blunt: *"never edit the shared `content/glossary.json`, because
  other authors are working at the same time and a shared JSON file is the one
  thing that cannot survive two writers."*
- A malformed file prints a warning and is skipped; it does not fail the build.
- The filename is not checked against `TRACK` (there is a
  `content/gloss/allocator.json` named after a project).

Term shape, three fields:

```json
{"terms": [
{"t": "monomorphisation", "x": "generic expansion", "p": "The compiler emitting one specialised copy of a generic function per concrete type used, which is why generic Rust costs nothing at runtime."}
]}
```

| field | required | meaning |
|---|---|---|
| `t` | **yes** | the term. Lowercased to form the lookup key. `KeyError` if absent. |
| `p` | **yes** | the plain-sentence definition, inlined into `data-g` on every hover chip. |
| `x` | no (`""`) | a short gloss or expansion, shown alongside the definition. |

There is one entry **per surface form**, not per concept: the real
`content/glossary.json` carries both `"move"` and `"moves"` with identical `p`,
because matching is exact on lowercased text with no stemming.

AUTHORING.md: *"One plain sentence per term. No jargon inside the definition."*

Emission, `build_glossary()`:

```python
for key, e in sorted(GLOSSARY.items()):
    used = sorted(GLOSS_USE.get(key, []))
    terms.append({
        "t": e["t"], "p": e["p"], "x": e.get("x", ""),
        "in": [{"s": slug, "n": name, "k": kind} for slug, name, kind in used if slug],
    })
```

`in` is the computed back-reference list: every `(unit slug, display name, kind)`
where the term was actually matched by `**bold**`, deduplicated by set, sorted,
and with `slug is None` entries filtered out (that is the guard for text rendered
outside any unit context, which is why `main()` resets `_CUR` to `None` before
calling `build_glossary()`). A term nobody bolded emits `"in": []`.

---

## 6. The validator

The stated purpose, from `build.py`'s module docstring:

> An exercise passes when its starter fails the way the exercise claims and its
> solution compiles and passes every hidden test. That is what stops the content
> rotting: rustc changes its diagnostics between releases, and an exercise
> promising E0382 that quietly starts emitting E0505 is now a build failure rather
> than a confused reader.

### The two entry points

```
python3 build.py                       rebuild data/
python3 build.py --validate            rebuild, then compile every exercise
                                       for real. Cached by content hash.
python3 build.py --check content/ex/X.md
                                       compile one unit's exercises and
                                       report. Writes nothing, so several
                                       authors can run it at once.
```

`--check` is dispatched **first thing in `main()`, before anything else runs**:

```python
def main():
    if "--check" in sys.argv:
        i = sys.argv.index("--check")
        return check_one(sys.argv[i + 1])
```

so it never loads the glossary, never builds, and never touches `data/`. It takes
a path, not a slug.

| | `--check <file>` | `--validate` |
|---|---|---|
| scope | one file | all units' exercises **and** all project stages, merged: `validate({**exercises, **projects})` |
| writes | nothing | `data/**`, `data/manifest.json`, `data/.validate-cache.json`, `llms.txt` |
| cache | **not used at all**, every run recompiles | read and written |
| concurrency | serial, one exercise at a time | `ThreadPoolExecutor(max_workers=4)` |
| safe to run in parallel with other authors | yes, that is the point | no |
| output | per-exercise `ok`/`FAIL` lines, then `N clean` or `N finding(s). Fix and re-run.` | per-item `ok`/`FAIL` lines, then a summary, plus the toolchain |
| exit code | 1 on any finding, 0 on clean | 1 on any finding, 0 otherwise |

`check_one` is the author's loop:

```python
def check_one(path):
    """Validate a single exercise file without touching data/.

    Parallel authors each run this on their own file. A full --validate writes
    the shared manifest and cache, so several at once would race; this writes
    nothing and is safe to run concurrently. The verdict comes from the same
    check_exercise() that --validate uses, so the two cannot disagree.
    """
```

CONTRIBUTING and AUTHORING both say the same thing three different ways: *"An
exercise is finished when `python3 build.py --check content/ex/<slug>.md` prints
`N clean`. Never `--validate` for a single file."*

### The execution backend

```python
PLAY     = "https://play.rust-lang.org/execute"
VERSIONS = "https://play.rust-lang.org/meta/versions"
```

One HTTP POST per compile, stdlib `urllib` only, no session, no auth.

```python
def compile_once(code, tests=None):
    payload = {
        "channel": "stable", "mode": "debug", "edition": "2024",
        "crateType": "lib" if tests else "bin",
        "tests": bool(tests), "backtrace": False,
        "code": code + ("\n\n" + tests + "\n" if tests else ""),
    }
    req = urllib.request.Request(PLAY, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "rust-handbook-build"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
```

Three attempts, 45s timeout each, backoff of 2s then 4s. The response is
`{success, stdout, stderr}`.

`toolchain()` separately fetches `/meta/versions` and records
`{version, date, hash[:9]}` into the audit, with the rationale:

> Worth recording rather than assuming: the playground tracks stable, so the
> compiler under the exercises moves on its own every six weeks. When the version
> in the manifest and the version answering today diverge, that is exactly the
> window in which a diagnostic can change out from under an exercise, which is
> the whole reason --validate exists.

It returns `None` on any exception, so a network failure degrades the audit
rather than failing the build.

### `check_exercise`: the single definition of sound

Both runners call this and only this. The comment: *"so the two runners cannot
drift into grading content by different rulebooks, which they had already started
to do."*

```python
def check_exercise(ex):
    out = []
    if not ex["starter"]:
        out.append("no starter")
    if not ex["tests"]:
        out.append("no tests")
    if ex["kind"] != "predict" and not ex["expect"]:
        out.append('no @expect (use `@expect E0382`, `@expect "message"`, '
                   'or `@expect test-failure` when the starter fails a test '
                   'rather than the compiler)')

    # The starter must fail, and fail the way the exercise says it will.
    if ex["starter"] and ex["kind"] != "predict":
        r = compile_once(ex["starter"], ex["tests"])
        if r["success"]:
            out.append("starter compiles and passes; nothing to fix")
        else:
            out.extend(expect_findings(ex, r["stderr"]))

    # The solution must compile and pass every hidden test.
    if ex["solution"]:
        r = compile_once(ex["solution"], ex["tests"])
        if not r["success"]:
            err = first_error_code(r["stderr"]) or first_error_line(r["stderr"])
            out.append(f"solution does not build: {err}")
        elif ex["tests"] and "test result: ok" not in (r["stdout"] or ""):
            failed = re.findall(r"^test (\S+) \.\.\. FAILED", r["stdout"] or "", re.M)
            out.append("solution builds but fails its own tests: " + (", ".join(failed) or "?"))
    else:
        out.append("no solution given")

    return out
```

So exactly **two network round-trips per exercise**, one for the starter and one
for the solution, except `@kind predict`, which skips the starter compile
entirely (there is nothing to fix, the reader is predicting an outcome).

Static checks come first and are free: missing starter, missing tests, missing
`@expect` on a non-`predict` exercise, missing solution.

`expect_findings` is the message-matching half, pulled out and pure so
`test_build.py` can exercise it offline:

```python
def expect_findings(ex, stderr):
    out = []
    got = first_error_code(stderr)
    want = ex["expect"] or {}

    if "code" in want:
        if got and got != want["code"]:
            out.append(f"starter raises {got}, exercise explains {want['code']}")
        elif not got:
            out.append(f"starter fails without an error code; {want['code']} expected")
    elif "msg" in want and want["msg"].lower() not in (stderr or "").lower():
        out.append(
            f"starter does not say {want['msg']!r}; it says {first_error_line(stderr)!r}")

    if got and got not in ex["diagnose"]:
        out.append(f"no @diagnose written for {got}")
    return out
```

Two supporting readers:

```python
def first_error_code(stderr):
    m = re.search(r"^error\[(E\d{4})\]", stderr or "", re.M)
    return m.group(1) if m else None

def first_error_line(stderr):
    """The first line that is actually an error, not cargo's "Compiling" banner."""
    return next((l for l in (stderr or "").split("\n") if l.startswith("error")),
                "unknown failure")
```

Note the `{"any": True}` form (`@expect test-failure`) falls through both
branches: the starter must still fail, and nothing about the message is checked.
And the `no @diagnose` rule fires on the code **actually observed**, independent
of `@expect`, which is what forces authors to write the explanation for the error
readers will really see.

### Every failure message

The complete set, quotable verbatim. AUTHORING.md tabulates five of them; the
parser produces nine.

| message | meaning |
|---|---|
| `no starter` | no ```` ```starter ```` block |
| `no tests` | no ```` ```tests ```` block |
| `no @expect (use ...E0382..., ..."message"..., or ...test-failure...)` | a non-`predict` exercise asserts nothing about why its starter fails |
| `no solution given` | no ```` ```solution ```` block |
| `starter compiles and passes; nothing to fix` | the starter is not actually broken |
| `starter raises E0507, exercise explains E0382` | the compiler is right and `@expect` is wrong |
| `starter fails without an error code; E0382 expected` | it fails, but with an uncoded diagnostic |
| `starter does not say 'missing type'; it says 'error: ...'` | quoted-message form did not match |
| `no @diagnose written for E0499` | the observed code has no explanation block |
| `solution does not build: E0277` (or the first error line) | the solution is broken |
| `solution builds but fails its own tests: tests::keeps_the_string` | the tests and the solution disagree, with the failing test names extracted |

AUTHORING.md's guidance on the second one is the cultural rule, and CONTRIBUTING
repeats it: *"If a starter raises a different error than you expected, the
compiler is right. Change `@expect` and write the explanation for the error it
actually raises."*

### Parallelism and rate limiting

```python
def validate(exercises, workers=4):
    """...
    446 round-trips at roughly 1.5s each is 11 minutes of sitting in urlopen, so
    they run four at a time. Concurrency does not increase the load on the
    playground, the same 446 requests either way, only its density, and the
    content hash means an unchanged rebuild sends none at all. Four is chosen to
    stay comfortably inside what one ordinary user of a free service looks like.
    """
```

Four threads, fixed, not configurable from the command line (`workers=4` is a
default parameter and `main()` never passes it). There is no token bucket and no
sleep between requests; the rate limit is the pool width. `--check` is fully
serial, so a lone author is even gentler.

The politeness reasoning is repeated in three places: here, in
`CONTRIBUTING.md` (*"which is a free service, so CI runs them on `main` rather
than on every pull request"*), and in `ci.yml` (*"It runs on main and on demand,
not on every push to a branch, to keep the load on a free service
proportionate."*).

### The cache

File: `data/.validate-cache.json`, a flat map from ref to `{key, findings}`.

**Ref format**, given exactly one spelling on purpose:

```python
def ref_of(slug, ex):
    """The one spelling of a cache ref. It was written out in two places, and a
    change to the format would have silently emptied the carry-forward's set
    intersection, reporting every item as never validated."""
    return f"{slug}#{ex['n']}"
```

**The key** is a SHA-256 over everything a verdict can depend on:

```python
def cache_key(ex):
    payload = "\x00".join([
        ex["starter"],
        ex["tests"] or "",
        ex["solution"],
        json.dumps(ex["expect"], sort_keys=True),
        ",".join(sorted(ex["diagnose"])),
        ex["kind"],
    ])
    return hashlib.sha256(payload.encode()).hexdigest()
```

Six inputs and each one is there for a reason the docstring names:

> The first version hashed only starter/tests/solution and the expected code,
> which meant the fix for "no @diagnose written for E0382" did not change the
> key: the author added the block, re-ran, and got the identical stale finding
> replayed out of the cache with no way to clear it short of deleting the file.
> `kind` matters too, flipping to `predict` skips the starter compile entirely.

Note what is deliberately **not** hashed: the brief, the hints, the `@after`
prose, the title, and the *bodies* of the diagnose blocks (only the sorted set of
their keys). Editing prose does not invalidate a compile verdict, which is what
makes routine authoring cheap.

**Coverage, not presence**:

```python
def cache_split(items):
    """(cache, refs the cache still speaks for, refs it does not).

    "The cache covers this item" means its key still matches, not merely that an
    entry exists. ..."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    fresh, stale = set(), set()
    for slug, exs in items.items():
        for ex in exs:
            ref = ref_of(slug, ex)
            (fresh if cache.get(ref, {}).get("key") == cache_key(ex) else stale).add(ref)
    return cache, fresh, stale
```

**The run loop**, with the cache write in a `finally`:

```python
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(check_exercise, ex): (ref, key)
                       for ref, key, ex in todo}
            for fut in concurrent.futures.as_completed(futures):
                ref, key = futures[fut]
                checked += 1
                record(ref, key, [{"ref": ref, "what": w} for w in fut.result()])
    finally:
        # Written whatever happens. Losing eleven minutes of someone else's CPU
        # to a Ctrl-C, and then asking the same free service for it again, is
        # not a reasonable thing to do.
        CACHE.write_text(json.dumps(cache))
```

A cached item contributes its stored findings to the report without a network
call, so a *clean* cache entry and a *failing* cache entry are both replayed
faithfully.

### The carried verdict

A plain `python3 build.py` does not validate, but it must not erase the record
either, because `data/manifest.json` is committed and the site's footer reads the
toolchain out of it.

```python
def carry(old, fresh, stale):
    """The verdict a plain build inherits: what the cache still speaks for. ..."""
    if not fresh:
        return {"checked": 0, "cached": 0, "findings": [], "ran": False}
    return {**old, "ran": True, "checked": 0, "cached": len(fresh),
            "findings": [f for f in old.get("findings", [])
                         if f.get("ref") in fresh],
            "unvalidated": sorted(stale)[:20],
            "unvalidated_count": len(stale)}
```

Two bugs are written into that docstring as the reason for its shape:

> What speaks for an item is the cache, not the previous run's `ran` flag. Gating
> on the flag made it a latch: one plain build over a manifest saying `ran: false`
> and nothing short of --validate could set it back, so a false committed once
> shipped a live site whose footer named no rustc version at all. Carrying only
> the covered items matters just as much: a wholesale copy of the old verdict once
> claimed "308 validated, no findings" over stages nothing had ever compiled.

Called from `main()` over the **merged** exercise and project space:

```python
audit = {"checked": 0, "cached": 0, "findings": [], "ran": False}
prev = OUT / "manifest.json"
if prev.exists():
    try:
        old = json.loads(prev.read_text()).get("audit", {})
        audit = carry(old, *cache_split({**exercises, **projects})[1:])
    except (json.JSONDecodeError, OSError):
        pass
```

and after a real `--validate` the stale bookkeeping is zeroed and the toolchain
stamped:

```python
audit = validate({**exercises, **projects})
audit["ran"] = True
audit["unvalidated"] = []
audit["unvalidated_count"] = 0
audit["toolchain"] = tc
```

### Exit codes and what constitutes failure

```python
if audit["ran"]:
    ...
    for f in audit["findings"]:
        print(f"  ! {f['ref']}: {f['what']}")
    return 1 if audit["findings"] else 0
return 0
```

**Any finding on any exercise fails the build**, whether it came from this run or
was replayed out of the cache. A build that has never validated returns 0. The
cache file is excluded from the published site (`release.sh`'s `site()` does
`rm -f "$dest/data/.validate-cache.json"`), so it is a repo artefact, not a
shipped one.

---

## 7. The emitted data

`data/` is a pure function of `content/` plus `TRACK`. Nothing is hand-edited.
Every JSON file is written with a bare `json.dumps(...)`, so it is minified,
UTF-8, no indentation, no sorting.

Sizes at the time of reading: `data/project` 1.5M, `data/ex` 792K, `data/unit`
596K, `data/drills` 560K, `data/glossary.json` 52K, `data/manifest.json` 16K,
`data/search.json` 12K.

### `data/unit/<slug>.json` <- `content/units/<slug>.md`

```
{ slug, num, title, blurb, concepts[], words, mins, lead, parts[] }
parts[]  = { id, title, intro, subs[], words, mins }
subs[]   = { id, text, html, words, mins }
```

- `num`, `title` come from `TRACK`, not from the file.
- `blurb`, `concepts` from front matter.
- `lead` is rendered HTML of everything before the first `##`.
- `intro` is the rendered HTML between a `##` and its first `###`, and is the
  **only** HTML field on a part. There used to be an `html` field beside it:

  > One field, not two. `html` and `intro` were provably equal for every part in
  > the book, so the reader was downloading each part's markup twice: 118 KB of
  > 705 KB.

  A part with no `###` children puts its whole body in `intro` and `subs: []`;
  `app.js` branches on `p.subs.length` to decide whether to render a band.
- `words`/`mins` appear at three levels: unit, part, sub. All computed by
  `words_of()` over the **rendered HTML** with tags stripped, and `mins_of()` at
  230 wpm with a floor of 1.

### `data/ex/<slug>.json` <- `content/ex/<slug>.md`

```
{ unit, exercises[] }
exercises[] = { n, title, kind, concept, expect, starter, tests, solution,
                hints[], diagnose{}, brief, after, mins }
```

- `brief`, `after` and every value in `diagnose` are rendered HTML.
- `starter`, `tests`, `solution` are **raw source text**, unescaped and
  unrendered; the editor and the compiler both want the bytes.
- `expect` is the parsed dict or `null`.
- `diagnose` is `{code: HTML}`.

### `data/drills/<slug>.json` <- `content/drills/<slug>.md`

```
{ unit, questions[] }
questions[] = { n, stem, options[], answer, why }
options[]   = { key, text, correct }
```

`stem` and `why` are block HTML, `text` is inline HTML, `answer` is the
concatenated correct keys.

### `data/project/<slug>.json` <- `content/projects/<slug>.md`

```
{ slug, title, accent, blurb, tier, domain, needs[], mins, words, intro, stages[] }
```

`stages[]` are exercise records, byte-identical in shape to `exercises[]`.

### `data/glossary.json` <- `content/glossary.json` + `content/gloss/*.json`

```
{ terms: [ { t, p, x, in: [ { s, n, k } ] } ] }
```

Sorted by lowercased term. `in` is computed, not authored: see section 5.

### `data/manifest.json` <- `TRACK` + everything

The single document every page load fetches.

```python
manifest = {
    "title": "Rust Handbook",
    "units": entries,                 # one per TRACK slug, ready:false for stubs
    "projects": project_entries,      # sorted by tier, then prerequisite depth, then title
    "tiers": {k: {"name": v[0], "note": v[1]} for k, v in TIERS.items()},
    "totals": {...},
    "audit": audit,
    "edition": "2024",
}
```

`totals`, all computed at build time:

```python
"units":     len(entries),
"ready":     sum(1 for e in entries if e["ready"]),
"words":     sum(e["words"] for e in entries) + sum(p["words"] for p in project_entries),
"unit_words":sum(e["words"] for e in entries),
"mins":      sum(e["mins"] for e in entries) + sum(mins_of(p["words"]) for p in project_entries),
"project_mins": sum(p["mins"] for p in project_entries),
"exercises": sum(e["exercises"] for e in entries),
"drills":    sum(e["drills"] for e in entries),
"projects":  len(project_entries),
"stages":    sum(p["stages"] for p in project_entries),
```

The `mins` versus `project_mins` split is deliberate and the comment says why:

> Reading minutes, derived from words the same way for both. A project's own
> `mins` is how long the whole build takes, which is a different quantity and
> lives in `project_mins`; adding it here would put "17 hours of reading" under a
> word count of 72,000.

Real values: 28 units all ready, 72,572 words, 50,818 of them unit prose, 316
reading minutes, 835 project minutes, 224 exercises, 420 drills, 13 projects, 92
stages.

`audit` is the validator's record, carried or fresh:

```json
{"checked": 0, "cached": 316, "findings": [], "ran": true,
 "unvalidated": [], "unvalidated_count": 0,
 "toolchain": {"version": "1.98.0", "date": "2026-08-18", "hash": "88d9e12ae"}}
```

### `data/search.json`

Split out of the manifest purely for page weight:

```python
# Section titles and concept lists are read by search and by nothing else,
# and they were 45% of a file every page view downloads. They live in their
# own document now, fetched only if someone actually searches.
(OUT / "search.json").write_text(json.dumps({
    "units": [{
        "slug": slug,
        "sections": [p["title"] for p in units[slug]["parts"]],
        "concepts": units[slug]["concepts"],
    } for slug, *_ in TRACK if slug in units],
}))
```

So the search index is deliberately thin: **slug, part titles, and concept
chips**. No full-text index, no inverted index, no body text. Emitted in `TRACK`
order. A real entry:

```json
{"slug": "05-ownership",
 "sections": ["The bug this exists to prevent", "What a value actually is",
              "Moving", "Copy: the types that do not move", "Drop",
              "Getting unstuck"],
 "concepts": ["move", "drop", "Copy", "Clone", "ownership", "RAII",
              "double free", "use after free"]}
```

### `llms.txt`

Generated from the manifest, not written by hand, *"so it cannot drift from the
content the way a hand-kept summary does."* It follows llmstxt.org: a title, a
`>` paragraph, then linked sections (Units, Projects, How the content is written,
Optional). Two pieces are worth copying wholesale into a new handbook:

- `onboarding()`, which opens the file by asking the reader-assistant which of
  three things they want (build your own / work on this / learn with it),
  *"because guessing wastes the turn."*
- `build_your_own()`, which **inlines `docs/BUILD-YOUR-OWN.md`** with every
  heading demoted one level, using `read_fence` rather than a three-backtick
  toggle, so a guide that itself contains ` ````markdown ` blocks survives. There
  are five `test_build.py` assertions on this alone.

### Deletion: data/ is a pure function

```python
for sub, keep in (("unit", units), ("ex", exercises),
                  ("project", projects), ("drills", drills)):
    for f in (OUT / sub).glob("*.json"):
        if f.stem not in keep:
            f.unlink()
            print(f"removed data/{sub}/{f.name}, its source is gone")
```

> data/ is a pure function of content/. Without this a deleted source left its
> JSON behind, and CI's `git status --porcelain data/` can only report files the
> build wrote, never one it should have removed: an abandoned test project stayed
> live on the site long after its source was gone.

### Everything computed at build time, in one list

- heading ids (`slug_id`, collision-suffixed, per-page `seen` dict)
- word counts at unit / part / sub / exercise-brief / project level, over
  rendered HTML with tags stripped
- reading minutes at 230 wpm, floor 1
- exercise minutes: `max(2, brief_mins + starter_lines // 12)`
- project minutes: authored, else `max(20, mins_of(words) + 4 * stages)`
- glossary back-references (`in`), collected as a side effect of rendering
- the glossary definition inlined into every `data-g` attribute
- project ordering by tier then prerequisite depth
- manifest totals
- the search index
- `ready` flags for unwritten TRACK entries
- the audit and its toolchain stamp
- `llms.txt` in full

---

## 8. Quality gates

The design rule is one owner for the verification sequence. `release.sh`'s own
header says what went wrong before that:

> One owner for the verification sequence, and one for what "the site" is. Both
> used to be written out in ci.yml, release.yml and this script, and both had
> drifted: the workbench suite ran in CI and in neither release path, and the
> Pages deploy published the whole repository, so 3 MB of source markdown that
> data/ already encodes was live and fetchable on the domain.

### `./release.sh --check`, in order

```bash
check() {
  local net="${1:-}"

  echo "building"
  python3 build.py > /dev/null
  if [ -n "$(git status --porcelain data/)" ]; then
    echo "data/ is stale. Run 'python3 build.py' and commit the result." >&2
    git --no-pager diff --stat data/ >&2
    return 1
  fi

  echo "the prose rule"
  if grep -rlq '—\|–' $PROSE 2>/dev/null; then
    echo "em or en dashes found. The rule in docs/AUTHORING.md is absolute." >&2
    grep -rn '—\|–' $PROSE 2>/dev/null | head -20 >&2
    return 1
  fi

  echo "testing"
  python3 test_build.py  > /dev/null
  node     test_views.mjs > /dev/null
  node     test_vim.mjs   > /dev/null

  if [ "$net" = "--net" ]; then
    echo "the workbench, against the live compiler"
    node test_workbench.mjs > /dev/null

    echo "compiling every exercise"
    python3 build.py --validate | tail -2
  fi
}
```

`set -euo pipefail` at the top, so any non-zero exits.

**Step 1: build, then the staleness check.** This is the mechanism that stops
`data/` drifting from `content/`. It runs the build and then asks git whether
anything under `data/` changed. If the committed JSON was generated from
different markdown, the rebuild produces a diff, `git status --porcelain data/`
is non-empty, and the check fails with `data/ is stale. Run 'python3 build.py'
and commit the result.` plus a `diff --stat`. It works in both directions
(edited content, and edited-then-reverted content) and, because `main()` deletes
orphaned JSON, it also catches a deleted source. CONTRIBUTING states the author's
half of the contract: *"If you touched anything under `content/`, commit the
regenerated `data/` with it. CI fails if the two disagree."*

**Step 2: the prose rule.** The only prose rule that is mechanised.

```bash
PROSE="content assets build.py index.html README.md CONTRIBUTING.md
       CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md docs
       .github/ISSUE_TEMPLATE .github/pull_request_template.md test_*.*"
```

> Everything a human reads, including the documents that state the rule.
> CONTRIBUTING says CI enforces this, so the check has to cover the file
> CONTRIBUTING itself lives in.

AUTHORING.md explains why this one rule and no other is grepped:

> No em dashes and no en dashes. Not "used sparingly": none. ... This one rule is
> mechanical, and CI greps for it: those two characters have no other use in this
> corpus. Everything below is for review, not for a grep, and deliberately so. A
> spaced hyphen is subtraction in every Rust snippet here, and `underscore` is the
> `_` character far more often than it is the verb.

**Step 3: three offline suites.** `test_build.py`, `test_views.mjs`,
`test_vim.mjs`.

### `--net` adds two

1. `node test_workbench.mjs`, the browser-side playground client and diagnostics
   parser against the live compiler. It issues five compiles concurrently:
   *"Serially this suite took 9.7 s, which was forty times the other three
   combined and put a free third-party service on the critical path of every
   run."* It asserts that an E0382 is parsed with code, line 5 and column 16; that
   test verdicts come off stdout not stderr; that warnings are separated from
   errors; and that an error inside the appended tests is flagged `inTests`.
2. `python3 build.py --validate`, compiling all 316 exercises and stages.

### What `test_build.py` asserts

408 lines, no framework, a hand-rolled `ok(name, cond, extra)` that appends to
`PASS`/`FAIL` and `sys.exit(1 if FAIL else 0)`. It imports `build` directly and
monkey-patches `build.compile_once` and `build.CACHE` to stay offline. Its
docstring names the incident that created it:

> The fence reader earned this file. Its first version assumed exactly three
> backticks and did a dict lookup on the info string, so an author writing about
> the format, with the ````markdown blocks that AUTHORING.md itself uses, closed
> the outer fence on the first inner line, shredded the rest of the section, and
> then crashed the whole build on a KeyError. Two authors hit it independently.

Sections and what each pins:

| section | assertions |
|---|---|
| fence reader | three-backtick info/code/resume; four-backtick does not close on an inner fence and keeps it verbatim; `raw` preserves the original tick count; an unterminated fence neither hangs nor crashes; a nested fence inside `@after` survives whole and does not swallow the prose after it |
| fence info strings | ten cases through `fence_meta`, including `rust,bad`, `rust, bad`, `no_run`, a long free-text info string, `text`, `sh`, `toml`. The point is stated in the code: *"Anything else is a label, never a lookup. These are the shapes that crashed."* |
| render | `bad` class and label; `Vec<&str>` and `a && b` escaped inside code; nested fence survives; `gotcha` callout; `:::memory` renders and is **not** inline-processed; tables; both list kinds; arrows and dashes pass through verbatim (both substitution rules were removed as dead or harmful); real unicode punctuation survives; duplicate headings get distinct ids |
| exercise parser | number, title, kind/concept/expect; all three named fences captured; both hints; the brief keeps its own fence; and four leak tests: a fence inside `@diagnose` stays there and does **not** appear in the brief, same for `@after` |
| cache coverage | with no cache nothing is fresh; a matching key is fresh; an edited starter is stale; a wrong key is stale; `ref_of` is the one spelling |
| `@expect` forms | E-code, quoted message, bare message, absent; then `expect_findings` on matching code, wrong code, missing `@diagnose`, matching message, case-insensitive message, wrong message, and no-expect-asserts-nothing |
| `check_exercise` | eight scenarios with `compile_once` stubbed by a queue of `(success, stdout, stderr)`: sound, starter compiles, wrong code, solution does not build, a failing hidden test **named**, missing solution, missing tests, and `predict` skipping the starter compile |
| front matter | keys parsed, body starts after the fence, absent front matter is not an error |
| carried verdict | toolchain survives a plain build; only covered items counted; a finding for an edited item is dropped; uncovered items are named; **the latch bug**: a `ran: false` verdict is restored by the cache rather than latched off; no cache means no claim |
| `build_your_own` | the guide's h1 does not survive as one; headings outside a fence are demoted; headings inside a fence are not; an inner fence does not close the outer one |

Almost every assertion has a comment naming the bug it prevents. That is the
house style and it is worth copying.

### CI

`.github/workflows/ci.yml`, four jobs.

**`build`** on every push to main, every PR, and manual dispatch. Python 3.12,
Node 22, concurrency group `ci-${{ github.ref }}` with `cancel-in-progress: true`
(*"the older result is about code nobody will ship"*). Two steps:

```yaml
- name: Assert there are no dependencies
  run: |
    test ! -f package.json || (echo "package.json appeared" && exit 1)
    test ! -f requirements.txt || (echo "requirements.txt appeared" && exit 1)

- name: Verify
  run: ./release.sh --check
```

with the comment *"No lockfile and no install step: the project has no
dependencies, and this job failing on a missing one would be the signal that
changed."* The verify step delegates entirely, *"so that CI and a release cannot
disagree about what 'verified' means."*

**`compiler`**, `if: github.event_name != 'pull_request'`, 25 minute timeout.
Runs `python3 build.py --validate` and then prints the toolchain and counts out
of the manifest. Not on PRs, to keep the load on the free playground
proportionate.

**`live`**, same condition, runs `node test_workbench.mjs`.

**`deploy`**, `needs: build`, only on `refs/heads/main`. Stages with
`./release.sh --site _site` and publishes to Pages. The `needs` is there because
of a real incident: *"as a workflow of its own it had no ordering against CI at
all, and could put a failing commit on the domain before a single test had run."*
Its concurrency group is `pages` with `cancel-in-progress: false`, unlike CI's.

**`release.yml`** fires on `v*.*.*` tags. It runs `./release.sh --check --net`
**before** tagging anything (*"A release is a promise that the content compiles.
Verify before tagging anything, not after."*), reads the shipped numbers out of
`data/manifest.json` into `$GITHUB_OUTPUT`, generates release notes containing
the units / projects / compiled-items / drills / words / verified-against table,
and attaches a tarball built by `./release.sh --site`.

### `./release.sh <version>`

The local release path: refuses an existing tag, a dirty tree, or a branch that
is not `main`; runs `check --net`; inserts a dated CHANGELOG entry with a small
inline Python script; commits `CHANGELOG.md` and `data/`; annotates the tag.
Version must match `^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$`.

### `./release.sh --site DIR`

The one definition of what the site is:

```bash
SITE=(index.html assets data llms.txt vercel.json CNAME .nojekyll README.md LICENSE)

site() {
  local dest="$1"
  rm -rf "$dest"; mkdir -p "$dest"
  cp -R "${SITE[@]}" "$dest"/
  rm -f "$dest/data/.validate-cache.json"
  du -sh "$dest"
}
```

`content/` is **not** published. The validate cache is dropped.

---

## 9. Adaptation plan for the hardware handbook

Four differences from the Rust Handbook: four execution backends instead of one,
no stable error codes, a per-exercise backend and GPU-capability declaration, and
a data-driven hardware atlas.

### 9.0 What is reusable unchanged

Most of `build.py`, and this is the point of porting rather than rewriting. These
functions have nothing Rust-specific in them:

| function | change needed |
|---|---|
| `front_matter` | none |
| `sections` | none |
| `FENCE`, `read_fence` | none. Keep every four-backtick behaviour and every test. |
| `slug_id` | none |
| `words_of`, `mins_of` | none (retune `WPM` if you like) |
| `inline` | none. The `**term**` glossary hook is subject-neutral. |
| `render` | one small change, see 9.2 |
| `split_parts` | none |
| `build_drills` | **none at all**. Ship it verbatim. |
| `load_glossary`, `build_glossary` | none |
| `build_manifest`, `search.json` | additive only (atlas entries) |
| the orphaned-JSON deletion pass | additive only (one more `(sub, keep)` pair) |
| `ref_of`, `cache_split`, `carry` | none |
| `cache_key` | extend the payload, see 9.5 |
| `check_one` | none, once `check_exercise` dispatches |
| `onboarding`, `build_your_own`, `build_llms_txt` | reword only |
| `release.sh`, `ci.yml`, `release.yml` | reword only, keep every gate |
| `test_build.py` | keep the fence, render, front-matter, cache and carry sections verbatim; rewrite the `@expect` and `check_exercise` sections |

The three enforcement constants (`NOTE_WORDS`, `PER_UNIT`, `TIERS`) are a policy
choice, not code. Keep the *mechanism* and retune the numbers. Hardware notes
carrying more tables than prose may want a wider band; the `words_of` count is
over rendered HTML, so table cells inflate it.

Fix the one ordering wrinkle while porting: move the `NOTE_WORDS` and `PER_UNIT`
raises **above** the `write_text` calls so a failing build leaves no JSON behind.

Close the one hole: add an `else: raise ValueError(f"{path.name}: unknown
directive @{key}")` to `parse_exercise`'s directive chain. With five new
directives coming, a silently-swallowed typo goes from annoying to dangerous.

### 9.1 `TRACK` and a second registry

`TRACK` itself is subject-neutral. Keep the 4-tuple, keep the derived
`TITLES`/`ACCENTS`/`ORDER` maps, keep the "registry is authoritative, front matter
is cross-checked and discarded" rule. Change only the accent vocabulary and the
slugs.

Add a **parallel registry for the atlas**, not a fifth field on `TRACK`, because
atlas pages are not units and are not in the reading spine:

```python
ATLAS = [
    ("gpu-memory-hierarchy", "GPU memory hierarchy", "slate", "What each level costs, in cycles and in bytes."),
    ("fpga-primitives",      "FPGA primitives",      "moss",  "LUTs, FFs, BRAM, DSPs: what a synthesis tool is actually packing into."),
]
ATLAS_ORDER = {slug: i for i, (slug, *_ ) in enumerate(ATLAS)}
```

Same four fields, same rules, same stub-if-missing behaviour. Reusing the shape
means `build_manifest` gets a third near-identical loop rather than a new concept.

Add the same collision guard the projects have: an atlas slug may not equal a
unit or project slug.

### 9.2 Note format changes

Almost none. Three specifics:

**Tone labels.** `TONES` is the only Rust-specific string in `render()`:

```python
TONES = {"bad": "will not compile", "good": "compiles"}
```

With four backends "will not compile" is wrong for three of them. Make the label
a function of language and tone, with a generic fallback so an unknown pair is a
label and never a `KeyError` (the exact bug `fence_meta` was rewritten to avoid):

```python
TONE_LABELS = {
    ("verilog", "bad"):  "fails elaboration",
    ("verilog", "good"): "elaborates",
    ("cuda",    "bad"):  "will not compile",
    ("cuda",    "good"): "compiles",
    ("asm",     "bad"):  "will not assemble",
}
TONES = {"bad": "does not build", "good": "builds"}      # the fallback

def fence_meta(info):
    head, _, rest = info.partition(",")
    flag = rest.strip()
    lang = head.strip() or "verilog"
    if flag in TONES:
        return lang, flag, TONE_LABELS.get((lang, flag), TONES[flag])
    return (info or "verilog"), "", (info or "verilog")
```

**`:::memory` generalises.** Rename it or keep it and add siblings; the mechanism
(a `:::` block whose body is escaped into `<pre>` with **no inline processing**)
is exactly what every hardware diagram needs: a pipeline diagram, a timing
waveform, a bus transaction, a memory map, a die floorplan. Do it by prefix,
mirroring the existing `kind.startswith("memory")`:

```python
DIAGRAMS = {"memory": "In memory", "timing": "Timing", "pipeline": "Pipeline",
            "layout": "Layout", "waveform": "Waveform"}
```

Preserve the "not inline-processed" property and keep `test_build.py`'s assertion
on it. Waveform and timing diagrams are dense in `|`, `_`, `-`, `*` and `~`, all
of which the inline pass would mangle.

**The glossary hook is unchanged.** `**term**` still works, and a hardware
corpus wants it more, not less.

### 9.3 `@expect` without error codes

This is the load-bearing change. Today:

```python
elif re.fullmatch(r"E\d{4}", val):
    ex["expect"] = {"code": val}
else:
    ex["expect"] = {"msg": val.strip('"\'')}
```

and downstream, `first_error_code(stderr)` pulls `^error\[(E\d{4})\]` out of
stderr and the whole diagnose map is keyed on it. With four backends and no
codes, both halves go.

**Replace the code form with a regex form. Keep the substring form as the cheap
option.** Delimiters distinguish them:

```
@expect /identifier '\w+' is not declared/     regex, over normalised text
@expect /width mismatch/i                      regex, case-insensitive
@expect "undefined reference to"               substring, case-insensitive
@expect any                                    must fail, message unchecked
@expect                                        asserts nothing; predict only
```

```python
EXPECT_RE = re.compile(r"^/(.*)/([im]*)$")

def parse_expect(val, where):
    if not val:
        return None
    if val in ("any", "none", "test-failure"):
        return {"any": True}
    m = EXPECT_RE.match(val)
    if m:
        pat, flags = m.group(1), m.group(2)
        compile_pattern(pat, flags, where)         # fails the build on a bad one
        return {"re": pat, "flags": flags}
    return {"msg": val.strip('"\'')}
```

**Normalisation is the new load-bearing helper.** A code was stable across
machines for free; message text is not. Four backends, several compiler versions,
temp paths and line numbers all leak into stderr. Normalise before matching, in
`build.py` and in the browser, from one shared spec:

```python
NORM = [
    (re.compile(r"\x1b\[[0-9;]*m"),                    ""),        # ANSI colour
    (re.compile(r"^\s*\d+\s*\|.*$", re.M),             ""),        # source echo lines
    (re.compile(r"[\w./\\-]*[/\\]([\w.-]+\.(?:v|sv|cu|cpp|h))"), r"\1"),  # paths -> basename
    (re.compile(r"\b\d+:\d+\b"),                       "L:C"),     # line:col
    (re.compile(r"\bline \d+\b"),                      "line N"),
    (re.compile(r"\b0x[0-9a-fA-F]+\b"),                "0xADDR"),
    (re.compile(r"\b\d+(\.\d+)?\s?(ms|us|ns|s)\b"),    "T"),       # timings
    (re.compile(r"[ \t]+"),                            " "),
]

def normalise(text):
    for rx, sub in NORM:
        text = rx.sub(sub, text or "")
    return "\n".join(l.strip() for l in text.split("\n") if l.strip())
```

Everything author-facing then matches against `normalise(stderr)`, so a pattern
written once keeps working when the CI runner's temp directory changes. Publish
the same list to the browser (emit it into `data/manifest.json` as
`"normalise": [[pattern, replacement], ...]`, or duplicate it in `workbench.js`
with a test that both produce the same output on a fixture corpus).

**The Python/JS regex gap.** The pattern string is authored once and run in both
`build.py` (validation) and `workbench.js` (choosing the diagnose block). Restrict
to the shared subset and reject the rest at build time rather than discovering it
in a browser:

```python
JS_HOSTILE = re.compile(r"\(\?P[<=]|\(\?#|\\A|\\Z|\(\?\(")

def compile_pattern(pat, flags, where):
    if JS_HOSTILE.search(pat):
        raise ValueError(f"{where}: pattern uses Python-only syntax: {pat!r}")
    try:
        return re.compile(pat, re.I if "i" in flags else 0)
    except re.error as e:
        raise ValueError(f"{where}: {pat!r} is not a valid regex: {e}")
```

Compile every pattern at parse time so a broken regex is a named build failure at
the file that contains it, never a silent runtime miss.

**Matching, replacing `expect_findings`:**

```python
def expect_findings(ex, stderr):
    out = []
    text = normalise(stderr)
    want = ex["expect"] or {}

    if "re" in want:
        if not compile_pattern(want["re"], want["flags"], ex["_where"]).search(text):
            out.append(f"starter does not match /{want['re']}/; it says "
                       f"{first_error_line(text)!r}")
    elif "msg" in want and want["msg"].lower() not in text.lower():
        out.append(f"starter does not say {want['msg']!r}; it says "
                   f"{first_error_line(text)!r}")

    if not match_diagnose(ex, text):
        out.append(f"no @diagnose matches the starter's error: "
                   f"{first_error_line(text)!r}")
    return out
```

`first_error_line` needs a per-backend "what does an error line look like"
predicate instead of `l.startswith("error")`; put it in the backend registry
(9.4). Everything else in `check_exercise` is untouched.

### 9.4 The diagnose map without codes

Today `diagnose` is `{code: HTML}` and the app does `ex.diagnose[e.code]`, an O(1)
dict hit. Without codes it becomes an **ordered list of (pattern, prose)**, first
match wins, because the author is now supplying the classification the compiler
used to supply.

The directive gains a second argument: a stable id, then the matcher.

````markdown
@diagnose undeclared-identifier /identifier '.*' is not declared/
What the elaborator is actually saying. ...

@diagnose width-mismatch /(width mismatch|operand size)/i
The other error this exercise plausibly raises. ...
````

Parser change, in place of `sink = ("diagnose", val)`:

```python
elif key == "diagnose":
    did, _, pat = val.partition(" ")
    pat = pat.strip()
    m = EXPECT_RE.match(pat)
    if not m:
        raise ValueError(f"{where}: @diagnose {did} needs a /regex/ matcher")
    compile_pattern(m.group(1), m.group(2), where)
    ex["diagnose"].append({"id": did, "re": m.group(1),
                           "flags": m.group(2), "_body": []})
    sink = ("diagnose", len(ex["diagnose"]) - 1)     # index, not key
```

`emit` routes to `ex["diagnose"][sink[1]]["_body"]`. At the end, each entry's
`_body` is rendered into `html` and `_body` is dropped. Emitted:

```json
"diagnose": [
  {"id": "undeclared-identifier", "re": "identifier '.*' is not declared",
   "flags": "", "html": "<p>...</p>"}
]
```

**Order is now semantic**, which it was not before. Authored order is match
precedence; put the specific pattern above the general one. Say that in
AUTHORING.md in as many words, because it is the one property of the new format
that a dict-shaped intuition gets wrong.

Selection, shared by validator and app:

```python
def match_diagnose(ex, text):
    for d in ex["diagnose"]:
        if compile_pattern(d["re"], d["flags"], ex["_where"]).search(text):
            return d
    return None
```

```js
const hit = ex.diagnose.find(d => new RegExp(d.re, d.flags).test(norm(e.raw)));
```

Two more consequences:

- **The error-index link goes.** `doc.rust-lang.org/error_codes/<code>.html` has
  no analogue. Replace it with an optional per-backend documentation base URL in
  the registry, or with an optional `@ref <url>` on the diagnose block.
- **`cache_key` must hash the patterns, not just the ids.** Today it hashes
  `",".join(sorted(ex["diagnose"]))`, the keys. If it hashed only ids now, an
  author fixing a wrong pattern would get the stale finding replayed with no way
  to clear it, which is precisely the bug `cache_key`'s docstring records.

### 9.5 `@backend`, `@gpu` and the backend registry

A registry table, in the spirit of `TIERS` and `CALLOUTS`:

```python
BACKENDS = {
    #  label                        net    workers  run adapter        error-line predicate
    "sim":    ("The in-page simulator", False,  8, run_sim,     lambda l: l.startswith(("error", "assert"))),
    "godbolt":("Compiler Explorer",     True,   3, run_godbolt, lambda l: ": error" in l or l.startswith("error")),
    "yosys":  ("Yosys (WASM)",          False,  4, run_yosys,   lambda l: l.startswith("ERROR")),
    "modal":  ("Your Modal endpoint",   True,   2, run_modal,   lambda l: l.startswith(("error", "Traceback"))),
}
DEFAULT_BACKEND = "sim"
```

Every adapter returns the **same three-key dict `compile_once` returns today**:
`{"success": bool, "stdout": str, "stderr": str}`. That single decision is what
keeps `check_exercise` a five-line diff instead of a rewrite.

**New directives:**

| directive | argument | required | validated |
|---|---|---|---|
| `@backend` | a `BACKENDS` key | no, defaults from unit front matter then `DEFAULT_BACKEND` | must be a known key, else a named build error |
| `@gpu` | `MAJOR.MINOR`, e.g. `7.5` | **only** with `@backend modal`, and **required** there | `re.fullmatch(r"\d+\.\d+", val)`; illegal on any other backend |
| `@opts` | a free-form `k=v` list, e.g. `compiler=g142 flags=-O2 -march=native` | no | keys checked against a per-backend allowlist |
| `@top` | a module name (yosys) | required for `@backend yosys` | non-empty |

```python
elif key == "backend":
    if val not in BACKENDS:
        raise ValueError(f"{where}: backend {val!r} is not one of {list(BACKENDS)}")
    ex["backend"] = val
    sink = None
elif key == "gpu":
    if not re.fullmatch(r"\d+\.\d+", val):
        raise ValueError(f"{where}: @gpu wants a compute capability like 7.5, got {val!r}")
    maj, minor = val.split(".")
    ex["gpu"] = {"cc": val, "n": int(maj) * 10 + int(minor)}
    sink = None
```

Emit `gpu` as both the display string and a comparable integer, so the app can
gate before dispatch without parsing:

```js
if (ex.gpu && endpoint.cc_n < ex.gpu.n)
  return `This exercise needs compute capability ${ex.gpu.cc} or newer.
          Your endpoint reports ${endpoint.cc}.`;
```

Cross-checks that belong in `check_exercise`'s free static section, before any
network call:

```python
if ex["backend"] == "modal" and not ex.get("gpu"):
    out.append("no @gpu (a modal exercise must declare its minimum compute capability)")
if ex.get("gpu") and ex["backend"] != "modal":
    out.append(f"@gpu is only meaningful with @backend modal, not {ex['backend']}")
if ex["backend"] == "yosys" and not ex.get("top"):
    out.append("no @top (yosys needs the module to synthesise)")
```

A **per-unit default** in front matter (`backend: yosys`) keeps a synthesis unit
from repeating the directive eight times. Resolve it in `parse_exercise_file`,
after parsing, so `parse_exercise` stays a pure function of one block.

Roll up the set of backends a unit uses into the manifest entry
(`"backends": ["sim", "yosys"]`) so the track page can badge "needs a GPU
endpoint" without fetching the exercise file.

### 9.6 The validator with four backends

`check_exercise` changes in exactly one place, the compile call:

```python
run = BACKENDS[ex["backend"]][3]
...
r = run(ex["starter"], ex["tests"], ex)
```

Everything else, the static checks, the starter-must-fail rule, the
solution-must-pass rule, the finding strings, is unchanged. Keep the invariant
stated in `check_exercise`'s docstring: one function, both runners.

**Parallelism must become per-backend.** A single pool of four is wrong now:

```python
WORKERS = {k: v[2] for k, v in BACKENDS.items()}

def validate(items):
    by_backend = collections.defaultdict(list)
    for ref, key, ex in todo:
        by_backend[ex["backend"]].append((ref, key, ex))
    for backend, group in by_backend.items():
        with concurrent.futures.ThreadPoolExecutor(WORKERS[backend]) as pool:
            ...
```

Two reasons, both concrete. One shared pool lets 200 sub-second local simulator
compiles queue behind three slow Compiler Explorer round-trips, so the fast
majority runs at the speed of the slow minority. And a shared width of four
cannot express "eight local threads, three against a free public API", which is
the politeness budget the original file argues for at length. Keep the `finally:
CACHE.write_text(...)` around the whole thing, for the same reason as before.

**Modal cannot be validated in CI.** It is a user-deployed endpoint; there is no
shared instance and no credential that belongs in the repo. Be honest about it
the way `ready: false` and `unvalidated` are honest:

```python
MODAL = os.environ.get("HANDBOOK_MODAL_ENDPOINT")

def run_modal(code, tests, ex):
    if not MODAL:
        raise Unavailable("modal")
```

and in the runner, catch `Unavailable` and record the item as **skipped, not
clean**:

```python
audit["skipped"] = {"modal": [...refs...]}
```

`--validate` should print `N validated, M skipped (no modal endpoint configured)`
and, critically, **must not exit 0 while claiming those items were checked**. The
site footer and `llms.txt` should say "GPU exercises verified locally, not in CI"
rather than implying otherwise. The whole file's ethic is that a number a build
prints without checking is decoration.

`toolchain()` becomes a dict, one entry per backend, because there is no longer
one compiler:

```python
def toolchains():
    return {
        "sim":     {"rev": hashlib.sha256(Path("assets/sim.js").read_bytes()).hexdigest()[:9]},
        "godbolt": godbolt_version(),      # GET /api/compilers/<id>
        "yosys":   {"version": yosys_version()},
        "modal":   {"endpoint": bool(MODAL)},
    }
```

Hashing the simulator's own source is the analogue of recording the rustc
version: for the `sim` backend the toolchain *is* a file in the repo, and a
change to it can invalidate every exercise that runs on it. Feed that hash into
`cache_key` for `sim` exercises, or a simulator edit will replay stale verdicts.

**`cache_key`, extended:**

```python
payload = "\x00".join([
    ex["starter"], ex["tests"] or "", ex["solution"],
    json.dumps(ex["expect"], sort_keys=True),
    json.dumps([(d["id"], d["re"], d["flags"]) for d in ex["diagnose"]]),
    ex["kind"],
    ex["backend"],
    json.dumps(ex.get("gpu"), sort_keys=True),
    json.dumps(ex.get("opts"), sort_keys=True),
    TOOLCHAIN_REV.get(ex["backend"], ""),
])
```

Note the diagnose entry now carries `re` and `flags`, not just ids, per 9.4.

**Failure messages**, reworded from section 6's table:

| old | new |
|---|---|
| `starter raises E0507, exercise explains E0382` | `starter does not match /width mismatch/; it says 'ERROR: syntax error at foo.v line N'` |
| `no @diagnose written for E0499` | `no @diagnose matches the starter's error: 'ERROR: ...'` |
| `starter fails without an error code; E0382 expected` | gone; there are no codes |
| `no @expect (use @expect E0382 ...)` | `no @expect (use @expect /regex/, @expect "substring", or @expect any)` |
| | `no @gpu (a modal exercise must declare its minimum compute capability)` |
| | `backend 'modal' is not configured; set HANDBOOK_MODAL_ENDPOINT to validate this exercise` |

Keep `starter compiles and passes; nothing to fix`, `solution does not build:
...`, `solution builds but fails its own tests: ...`, `no starter`, `no tests`,
`no solution given` verbatim. They are backend-neutral already.

### 9.7 The hardware atlas

Reference tables are data, not prose. Authoring them as markdown tables inside a
unit note would put them through `render()`, count them against `NOTE_WORDS`,
make them unsortable and unfilterable, and give nothing to check. Author them as
JSON, the way the glossary already is:

```
content/atlas/<slug>.json   ->   data/atlas/<slug>.json
```

```json
{
  "slug": "gpu-memory-hierarchy",
  "note": "Latencies are for Ampere. Every number here moves between architectures; the ordering does not.",
  "columns": [
    {"k": "level",   "t": "Level"},
    {"k": "latency", "t": "Latency", "unit": "cycles", "align": "right"},
    {"k": "size",    "t": "Size per SM", "align": "right"},
    {"k": "scope",   "t": "Shared by"}
  ],
  "rows": [
    {"level": "Register",      "latency": 1,   "size": "256 KB", "scope": "one thread"},
    {"level": "Shared / L1",   "latency": 30,  "size": "128 KB", "scope": "one block"},
    {"level": "L2",            "latency": 200, "size": "40 MB",  "scope": "the device"},
    {"level": "Global (HBM2e)","latency": 400, "size": "40 GB",  "scope": "the device"}
  ],
  "sources": [
    {"t": "NVIDIA A100 Tensor Core GPU Architecture", "u": "https://..."}
  ]
}
```

`build_atlas()`, mirroring `build_projects()`:

```python
def build_atlas():
    got = {}
    for path in sorted((CONTENT / "atlas").glob("*.json")):
        d = json.loads(path.read_text())
        slug = d.get("slug", path.stem)
        if slug not in ATLAS_ORDER:
            raise ValueError(f"{path.name}: slug {slug!r} is not in ATLAS")
        if slug in ORDER or slug in projects:
            raise ValueError(f"{path.name}: atlas slug {slug!r} collides")
        keys = [c["k"] for c in d["columns"]]
        if not keys:
            raise ValueError(f"{path.name}: no columns")
        for i, row in enumerate(d["rows"], 1):
            missing = [k for k in keys if k not in row]
            extra   = [k for k in row if k not in keys]
            if missing or extra:
                raise ValueError(f"{path.name}: row {i} missing {missing}, unknown {extra}")
        if not d.get("sources"):
            raise ValueError(f"{path.name}: no sources. An atlas table without a citation is folklore.")
        d["note"] = render(d.get("note", ""))
        d["rows_n"], d["cols_n"] = len(d["rows"]), len(keys)
        (OUT / "atlas").mkdir(parents=True, exist_ok=True)
        (OUT / "atlas" / f"{slug}.json").write_text(json.dumps(d))
        got[slug] = d
        print(f"  atlas {slug:18s} {len(d['rows']):3d} rows x {len(keys)} cols")
    return got
```

The row/column consistency check is the atlas's answer to `--validate`: it is the
thing that stops a table rotting when someone adds a column and forgets a row.
The mandatory `sources` is the other half. Neither needs a network.

Wire-up, all additive:

- one more `(sub, keep)` pair in the orphaned-JSON deletion loop:
  `("atlas", atlas)`
- an `"atlas"` array in the manifest, built from `ATLAS` the same way `units` is
  built from `TRACK`, with the same `ready: bool(d)` stub flag
- `totals` gains `"atlas": len(entries)`, `"atlas_rows": sum(...)`
- `search.json` gains an atlas section indexing **column titles and the first
  column's row values**, which is what someone actually searches an atlas for:

```python
"atlas": [{"slug": s, "cols": [c["t"] for c in a["columns"]],
           "rows": [r[a["columns"][0]["k"]] for r in a["rows"]]}
          for s, a in atlas.items()]
```

- `llms.txt` gains an `## Atlas` section listing each table with its row and
  column counts

Do **not** run atlas rows through `inline()` wholesale. If a cell needs a code
span, add an explicit per-column `"inline": true` flag and process only those
columns, so a cell containing `*` or `_` in a bus name survives.

### 9.8 Front-end changes, for completeness

Not asked for, but they follow from the format and are worth naming:

- `workbench.js` splits into a thin router plus four adapters, each exposing
  `run(code, opts) -> {success, stdout, stderr}` and `parse(res) -> {errors,
  warnings, tests}`. The `assemble()` / `userLines` trick (append tests, never
  prepend, so reported line numbers still point at the reader's own code)
  transfers to every backend that reports line numbers, and is the reason errors
  can be attributed to the hidden tests. Keep it.
- `snippet(code, line, col)` is backend-neutral. Keep it.
- The diagnose lookup changes from `ex.diagnose[e.code]` to the ordered
  first-match scan in 9.4.
- The `sim` backend needs no network, so exercises on it work offline. Say so in
  the UI; it is the one genuine advantage this handbook has over the Rust one,
  whose workbench dies with `'offline'` when the network does.
- The `modal` backend needs an endpoint URL from the reader. Store it in
  `localStorage`, gate `@gpu` exercises on the reported capability before
  dispatch, and give a specific message when it is missing rather than a failed
  fetch, following the existing rule: *"Naming the network is the whole point: a
  silent failure here reads as 'my code is so broken it did not even produce an
  error'."*

### 9.9 Build order

The original's `onboarding()` prescribes it and it is right:

> Then work in the order the guide gives: shell, palette, mascot, manifest, one
> complete unit, the execution backend, then the rest of the content. Do not
> restyle first. Do not write twenty units before one of them is finished end to
> end.

Concretely, for this port: port `build.py`'s parser and renderer with the tests
first; get `TRACK` and one stub manifest rendering; write **one** unit trio end to
end on the `sim` backend only; make `--check` green on it; then add the other
three backends one at a time, each with its adapter, its error-line predicate and
its `test_build.py` stub cases; then the atlas; then the remaining content.

Also note, plainly, what the original tells anyone reproducing it to ask first:

> What can execute the learner's work and complain specifically about it? A
> compiler, a type checker, a linter, a test runner, a solver. This is the load
> bearing question. If the answer is nothing, say so plainly: the shape is wasted
> without it, and a quiz site is the honest alternative.

Four backends is four answers to that question, which is a stronger position than
the original had. The corresponding risk is that four backends is four sets of
error text to normalise and four sets of `@diagnose` patterns to keep matching,
with no error codes to anchor them. The normalisation layer in 9.3 and the
per-pattern cache key in 9.6 are what keeps that maintainable; do not skip them.
