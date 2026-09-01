# The handbook family: what four siblings converged on, and what diverged

Comparison report. The Rust Handbook is documented in depth elsewhere
(`RUSTBOOK-design-system.md`, `RUSTBOOK-app-architecture.md`,
`RUSTBOOK-workbench.md`, `RUSTBOOK-content-pipeline.md`) and is treated here
only as the baseline to diff against.

The four, with their true state on disk:

| | Path | app.css | app.js | Units authored | Backend |
|---|---|---|---|---|---|
| **Rust** | `rust_learning` | 1827 lines | 1360 lines | 28 units, 28 ex files, 13 projects | real `rustc` via Play/API |
| **Python** | `python_study` | **678 lines** | 713 lines | 10 units, 10 ex files, 0 projects | real CPython via a runner |
| **Voice** | `learning_voice_models` | 1830 lines | 1359 lines | **0 — content dirs are empty** | `api/run.py` + `api/_runner.py`, numpy/scipy |
| **Medical** | `study_medicine` | 1749 lines | ~990 lines | 3 books, 63 qbank chapters, no unit/ex dirs | **none — no code execution at all** |

**The single most important structural fact, stated up front:** the Voice
Handbook is not an independent design. `diff rust_learning/assets/app.js
learning_voice_models/assets/app.js` is **67 lines** on a 1360-line file, and
`app.css` differs only in the `:root` blocks plus three or four selector names.
It is a fork with the palette swapped, the mascot swapped, the copy swapped,
and **no content written yet**. So there are really **three** designs in the
family — Rust (with Voice as its clone), Python (a deliberate rewrite), and
Medical (an independent branch for a subject with no compiler) — and any claim
that a convention is "shared by all four" that rests on Rust+Voice agreeing is
really a claim about one codebase counted twice. That is flagged throughout.

---

## 1. Design system diff

### 1.1 The token table

Rust column is the baseline. **Bold** = differs from Rust. "=" = byte-identical.

#### Structure (identical across all four — this is the family's real design system)

| Token | Value in all four | Note |
|---|---|---|
| `--t-micro` | `clamp(10.5px, 0.1vw + 10.2px, 11.5px)` | |
| `--t-tiny` | `clamp(12px, 0.12vw + 11.6px, 13px)` | |
| `--t-sm` | `clamp(13.5px, 0.14vw + 13.1px, 14.5px)` | |
| `--t-body` | `clamp(15px, 0.2vw + 14.4px, 16.5px)` | |
| `--t-read` | `clamp(16px, 0.34vw + 15px, 18.5px)` | |
| `--t-lede` | `clamp(17.5px, 0.5vw + 16.3px, 21px)` | |
| `--t-h3` | `clamp(19px, 0.6vw + 17.6px, 24px)` | |
| `--t-h2` | `clamp(24px, 1.4vw + 20.5px, 36px)` | |
| `--t-h1` | `clamp(32px, 3.4vw + 21px, 60px)` | |
| `--drop` | `2px` | button hard-shadow offset *and* press translate |
| radii ladder | `4 / 6 / 8 / 16px` | Python renames them (below), values identical |
| `--sans` | `"Inter", …` first | Medical + Rust + Voice use the identical fallback stack |
| ink count | exactly four (`--ink` … `--ink-4`) | the four-ink discipline survives everywhere |
| `--measure` | `72ch` (Medical: **74ch**) | the only near-miss |
| `--accent` indirection | `[data-accent="x"] { --accent: var(--x) }` | 7 accents in Rust/Voice/Python, **9** in Medical |

**The nine-step fluid type scale is copied character-for-character into all four
files, including whitespace differences in only Python.** Nobody has ever
touched it. Same for `--drop: 2px`. This is the load-bearing structure: it is
what makes the four look like one family even though every colour differs.

#### Palette (varies — this is what a new handbook is *supposed* to change)

| Token | Rust | Python | Voice | Medical |
|---|---|---|---|---|
| `--bg` light | `#efebe4` | **`#eae7e1`** | **`#f1ece0`** | **`#eeefe9`** |
| `--bg` dark | `#1c1917` | **`#1a1917`** | **`#1b1815`** | **`#1e1f23`** (cool/blue) |
| `--surface` light | `#fdfbf6` | **`#faf8f4`** | **`#fefcf6`** | **`#fdfdf8`** |
| `--ink` light | `#211d1a` | **`#1d1b19`** | **`#211d18`** | **`#23251d`** (olive-tinted) |
| `--ink` dark | `#faf9f7` | = | **`#faf9f6`** | **`#fafafa`** (pure grey) |
| accent default | `--ferris #f74c00` | `--gold #b5790a` | `--parrot #d94f37` | *(none — see §1.4)* |
| accent count | 7 | 7 | 7 | **9** |
| `--mono` | JetBrains Mono | JetBrains Mono | JetBrains Mono | **IBM Plex Mono** |
| `--rail` | `288px` | **`232px`** | `288px` | **`268px`** |
| `--measure` | `72ch` | `72ch` | `72ch` | **`74ch`** |

Three of the four keep a *warm* ground (all four light `--bg` values are
warm-tinted off-whites in the `#ea–#f1` range; all inks are warm-black, not
`#000`). Medical is the only one that goes cool in dark mode (`#1e1f23`,
blue-grey) while keeping a warm-olive light ink (`#23251d`) — a slight
inconsistency, but a deliberate one: it inherits the PostHog brand ramp.

#### Tokens one handbook has and the others do not

| Token | Who | Verdict |
|---|---|---|
| `--ok-bg` / `--warn-bg` / `--bad-bg` | **Python only** | **Earned.** Rust has `--ok/--warn/--bad` as *ink* colours only, so every "tinted panel" is a `color-mix(...)` written out at each call site. Python's three extra tokens make the verdict panel a two-token component. Inherit this. |
| `--sunken` | **Medical only** | Marginal. Its light value `#e5e7e0` is byte-identical to `--raised`; only dark differs (`#191a1e` vs `#2d2e37`). Half-implemented. |
| `--r-xs: 2px` | **Medical only** | Fine, cheap. |
| `--code-bg` / `--code-border` | Rust, Python, Voice — **absent in Medical** | Correct: Medical has no code. |
| `--shadow` / `--hair` / `--mark` | Rust, Voice, Medical — **absent in Python** | **A Python regression.** Python has no elevation-shadow token and no `::selection` token at all; it lost the "shadow colour is the ink in rgb space" derivation the others share. |
| `--btn-bg` / `--btn-fg` | Rust, Voice, Medical | Python replaced with `--btn-ink` + `--btn-shadow` and reads `--accent` for the fill (see §1.3). |

### 1.2 Motion tokens — the family fell apart here

| | `--ease` | fast | medium | slow |
|---|---|---|---|---|
| **Rust** | `cubic-bezier(0.22, 0.9, 0.28, 1)` | `--fast: 0.14s` | `--med: 0.26s` | — |
| **Voice** | = (identical) | = | = | — |
| **Python** | **none** | `--fast: 90ms` | `--mid: 180ms` | `--slow: 320ms` |
| **Medical** | **none** | **none** | **none** | **none** |

This is the clearest divergence in the whole family and it goes the wrong way
with each generation:

- Rust ships one easing curve, used by *every* transition and keyframe in the
  file, and two durations. Comment in the source calls it "sharp out, soft in."
- Python renames the durations to a three-step ms ladder (a defensible
  improvement — three steps beat two) but **drops the shared easing entirely**;
  its transitions read `transition: transform var(--fast) ease, …` — bare
  `ease`, the browser default. The family's one motion signature is gone.
- Medical drops the tokens altogether. Every transition is a literal:
  `transition: background 0.12s, color 0.12s;` appears **~30 times** with
  `0.12s`, `0.07s`, `0.16s`, `0.1s` sprinkled through. There is no way to slow
  the whole app down or speed it up.

**Verdict: Rust/Voice are right on the easing, Python is right on the ladder.
The fifth should ship `--ease` + a three-or-four-step duration ladder, and no
literal duration anywhere.**

### 1.3 The two named Rust bugs — did they persist?

**Bug A: duplicated `@keyframes tick`.** In Rust, `@keyframes tick` is declared
twice (line 712 for the contents-rail done-dot, line 1309 for the workbench
verdict stamp); the second silently wins, so the rail dot plays the verdict
animation.

| | Status |
|---|---|
| Rust | present — lines 712 and 1309 |
| **Voice** | **present, verbatim** — lines 715 and 1312. Copied wholesale. |
| Python | **gone.** Python has only 5 keyframes total (`rise`, `breathe`, `washout`, `pulse`, `stamp`) and no `tick` at all. Fixed by not having the component. |
| Medical | **gone.** 4 keyframes (`land`, `kenburns`, `grain`, `shake`), no `tick`. |

So the bug survives exactly where the code was copied and dies exactly where
someone rewrote. It was never *found* and fixed; it was outrun.

**Bug B: the unthemed `.btn:hover` literal.** Rust: `.btn:hover { background:
#ff7a35; }` at line 349 — a hard-coded lighter orange, so a dark-theme button
hovers to a light orange that belongs to no token.

| | The line | Verdict |
|---|---|---|
| Rust | `.btn:hover { background: #ff7a35; }` | the bug |
| **Voice** | `.btn:hover { background: #ff7a35; }` (line 352) | **A genuine regression, worse than Rust's.** Voice's button is a scarlet macaw red — `--btn-bg: #e0543a` on a `--parrot: #d94f37` accent. Its hover flashes **Rust's orange**. The copy-paste carried a colour that is not in Voice's palette at all. This is the single most visible defect in the family. |
| Medical | `.btn:hover { background: #ffb71c; }` (line 245) | **Half-fixed.** Still a literal, but at least re-derived by hand for Medical's yellow (`--btn-bg: #f7a501` → `#ffb71c`). Fixes the wrong-hue symptom, not the untokenised cause; the dark theme still hovers to the light value. |
| **Python** | **`.btn:hover { filter: brightness(1.06); }`** | **The correct fix, and the one to inherit.** No literal, no second token, works in both themes, works for `.btn.ghost` and every future variant for free. One line. |

Python's `.btn` is worth quoting whole because it is the family's best button:

```css
.btn {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.62rem 1.05rem; border: 1.5px solid var(--btn-shadow);
  border-radius: var(--r-2); background: var(--accent); color: var(--btn-ink);
  font: 700 var(--t-sm)/1 var(--sans); cursor: pointer;
  box-shadow: var(--drop) var(--drop) 0 0 var(--btn-shadow);
  transition: transform var(--fast) ease, box-shadow var(--fast) ease, background var(--fast) ease;
}
.btn:hover  { filter: brightness(1.06); }
.btn:active { transform: translate(var(--drop), var(--drop)); box-shadow: 0 0 0 0 var(--btn-shadow); }
```

Note `background: var(--accent)` — Python deleted `--btn-bg` and made the button
read the *ambient* accent, so a button inside a `data-accent="teal"` card is
teal. Rust's button is always Ferris orange regardless of the unit accent. Both
are defensible; Python's is one fewer token and more obviously correct.

Also note Python's shadow is a **two-axis** offset (`translate(var(--drop),
var(--drop))`) while Rust/Voice press only vertically (`translateY`). Python's
matches its `box-shadow: var(--drop) var(--drop)`; Rust's `box-shadow: 0
var(--drop)` matches its `translateY`. Both internally consistent.

### 1.4 Literal colours outside `:root` — the cleanliness ranking

| | Literals outside the token blocks | Detail |
|---|---|---|
| **Python** | **0** | The only handbook where the claim "no component names a colour" is actually true. Achieved partly by having no syntax highlighter in CSS and no mask gradients. |
| Rust | 22 | 16 are the intentional `.t-*` syntax theme; the rest are `#ff7a35`, two `#000` mask stops, three `#fff`-on-accent. |
| Voice | 22 | identical set, including the syntax theme — which is still **Rust's** syntax theme, tuned for `rustc` token classes, in a Python/numpy handbook. |
| Medical | 15 | `#ffb71c` hover, two `#fdfdf8` "sticker" grounds (with a comment admitting it: *"the cream disc is the same #FDFDF8 as a card"* — i.e. it knew and did it anyway), and six `var(--accent, #2F80FA)` fallbacks. |

Medical's `var(--accent, #2F80FA)` pattern is worth calling out: because Medical
sets no `--accent` in `:root` at all, every consumer carries a fallback literal.
Six sites now hard-code PostHog blue as a default. Rust's `--accent:
var(--ferris)` in `:root` costs one line and removes all six.

### 1.5 Section 1 summary — what is structure and what is palette

**Structure (never varies, therefore is the design):** the nine-step fluid type
scale verbatim; four inks; the 4/6/8/16 radii ladder; `--drop: 2px` driving both
the hard shadow and the press; `--measure` ~72ch; the `[data-accent]`
indirection so no component names a hue; Inter + a mono; a warm-tinted ground in
both themes.

**Palette (varies every time, and is expected to):** every hex; accent count
(7–9); `--rail` width (232–288px); mono face; whether the ground is warm or cool
in dark.

**Contested, i.e. the family has not agreed:** motion tokens (three different
answers, one of them "none"); whether the button reads `--accent` or its own
`--btn-bg`; whether verdict colours get `-bg` companions; whether `--shadow` /
`--hair` / `--mark` exist.

---

## 2. Information architecture diff

### 2.1 Route tables, side by side

| Concept | Rust | Voice | Python | Medical |
|---|---|---|---|---|
| landing | `#/` | `#/` | `#/` | `#/` |
| the index | `#/track` | `#/track` | `#/track` | `#/books` + `#/book/<id>` |
| a unit | `#/unit/<slug>` `#/unit/<slug>/<heading>` | same | `#/unit/<slug>[/<h>]` | `#/read/<book>/<ch>` `?at=<heading>` |
| exercise workbench | `#/work/<slug>/<n>` | same | `#/work/<slug>/<n>` | **—** |
| projects | `#/projects[/<domain>]`, `#/project/<slug>` | same | `#/projects`, `#/project/<slug>` | **—** |
| project stage bench | `#/project/<slug>/<n>` | same | — | **—** |
| quiz / drills | `#/drills/<slug>` | same | `#/drills/<slug>` | `#/qbank`, `#/qbank/<ch>` |
| progress | `#/progress` | same | `#/progress` | **—** (folded into `#/plan`) |
| glossary | `#/glossary` | same | `#/glossary[/<letter>]` | `#/glossary` |
| search | `#/search/<encoded>` | same | `#/search[/<q>]` | `#/search?q=` |
| **error index** | — | *link exists, route does not* | **`#/errors`** | — |
| **study plan** | — | — | — | **`#/plan`** |
| not found | `notFound()` | same | `notFound()` | `notFound()` |

**In all four:** landing, an index, a unit reader, a glossary, search, a
not-found. That is the irreducible spine.

**Router implementations differ in kind, not just content:**

- Rust/Voice: `const [, route, a, b] = hash.split('/')` then an `if/else if`
  chain. Positional. Cannot express an optional segment without a nested check.
- Python: a **regex table**, the cleanest of the three —
  ```js
  const routes = [
    [/^\/?$/,                        viewHome],
    [/^\/unit\/([\w-]+)(?:\/([\w-]+))?$/, viewUnit],
    [/^\/glossary(?:\/([A-Za-z]))?$/, viewGlossary],
    …
  ];
  const hit = routes.find(([re]) => re.test(path));
  await hit[1](...path.match(hit[0]).slice(1));
  ```
  Optional segments are free, the arity of each view is declared by its regex,
  and adding a route is one line. **Inherit this.**
- Medical: `seg = path.split('/')` plus a `URLSearchParams` for the query, then
  an `if/else` chain. It is the only one with a real query string, which it
  needs for `#/read/<book>/<ch>?at=<heading>` and `#/search?q=`.

### 2.2 The views one handbook has and the others lack

**Python's `#/errors` — earned its place, and is the most transferable idea in
the family.** It renders every diagnostic the book explains, grouped by a
"judge" bucket, each card linking to the exercise where it is raised:

```js
async function viewErrors() {
  const errors = await load("errors");
  …
  <p class="lede muted">${errors.length} of them so far, each written up where it is
  raised rather than in the abstract. This page is generated from those explanations, so it can never drift
  from what the workbench tells you.</p>
```

That last sentence is the whole argument: the error index is *derived from* the
`diagnose` map rather than being a second hand-maintained document. Every card
is `<a href="#/work/${first.unit}/${first.n}">`, so an error is a route into the
exercise that produces it — the reverse of the usual direction.

**Voice links to `#/errors` but has no such route.** `app.js` line 760 emits
`<a class="chip mono" href="#/errors">` inside the diagnostics panel; the Voice
router has no `errors` branch, so the link lands on not-found. Paired with
`assets/parrot.svg` referenced in the hero when only `parrot.png` exists on
disk, this is what an un-exercised fork looks like. **Do not treat the Voice
handbook as a working reference for anything.**

**Medical's `#/plan` — earned.** Medical has no `#/progress`; instead `#/plan`
is an exam-plan view, filterable, that carries the progress role. For a subject
where the unit of achievement is "revised chapter N before the exam" rather than
"passed exercise N", replacing a progress dashboard with a dated plan is the
right call. It is also the only handbook whose landing page's primary CTA is not
"start the track": `<a class="btn" href="#/plan">Start with the exam plan</a>`.

**Medical's `#/books` two-level index — earned, and directly relevant to the
fifth.** Medical is the only handbook whose corpus does not fit one flat track:
`data/manifest.json` has a `books` array, each with `chapters`, and the index
splits into `#/books` (choose a book) → `#/book/<id>` (choose a chapter). Each
book carries its own `accent` (`"accent": "blue"` for Kumar & Clark), so the
accent is a property of the *volume*, not a rotating per-unit cycle. **This is
the only prior art in the family for an index bigger than one screen**, and the
fifth handbook (19 parts, 122 units) needs exactly this shape.

**Rust/Voice's `#/projects` + `#/project/<slug>/<n>` — probably not earned at
this scale.** Rust runs a second, near-duplicate content type through the same
workbench (`RUSTBOOK-app-architecture.md` §2.7, and the `B.route` indirection at
app.js:628–657 exists solely to make one bench serve two routes). Python dropped
projects entirely; Medical never had them. Two of the three independent designs
voted it out.

**What no handbook has, and one probably should:** a per-part landing.
Rust/Python/Voice go straight from `#/track` (one long list) to a unit. At 28
units that is fine. Medical is the only one that inserted an intermediate level,
and it did so because it had to.

### 2.3 Search, compared

| | Where the index lives | Trigger |
|---|---|---|
| Rust/Voice | `data/search.json`, fetched lazily — split out of the manifest precisely because "section titles and concept lists … were 45% of a file every page view downloads" | topbar input, `#/search/<encoded>` |
| Python | inline over the loaded corpus, memoised per entry: `entry._t ??= entry.title.toLowerCase()` — "lowercase once per entry, not once per keystroke" | topbar input **plus a global `/` hotkey** (`if (e.key === "/" && !typing) location.hash = "#/search/"`) |
| Medical | over the manifest's `sections` arrays | topbar input, placeholder `Search 671,000 words…` |

Python is the only one with the `/` hotkey and the only one that guards it with
`const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)`.
Inherit both.

---

## 3. The unit reading experience, compared

All four render a reader as **rail + column**, all four use a `readerbar` or
equivalent sticky sub-header, and three of the four break long notes into
collapsible `<details class="sect">` blocks. The differences are in the wiring.

### 3.1 Feature matrix

| | Rust | Voice | Python | Medical |
|---|---|---|---|---|
| Rail levels | 2 (`h2` part / `h3` sub) | 2 | **1 (flat section list)** | 2 (`h2`/`h3`) |
| Per-entry estimated minutes in the rail | **yes** (`<span class="mins">${p.mins}m</span>`) | yes | **no** | **yes, on both levels** |
| Rail collapse toggle | yes, persisted (`rh-rail`) | yes (`vh-rail`) | yes, persisted (`RAIL_KEY`) | **no** |
| Rail spine / read-so-far fill | `.railfill`, `transform: scaleY(ratio)` | same | `#railfill`, `style.height = px` | none — top bar only |
| Top progress bar | `#prog`, `transform: scaleX(ratio)` | same | none | `#prog`, `style.width = %` |
| "Already scrolled past" state | `.read` class per link | same | `.seen` class per link | **no** — only `.on` |
| `aria-current` on the active entry | via `.on` class only | same | **`aria-current="true"`** | via `.on` class only |
| Collapsible sections | `<details class="sect">`, first part open | same | **no — the whole note is one flow** | `<details class="sect">`, overview parts open |
| Expand all / Collapse all | yes | yes | n/a | **yes, and it preserves scroll position** |
| Prev / next | `pagenav(prev, next)`, titles both sides, skips unwritten units | same | **next only**, in the unit footer | `pagenav`, titles both sides |
| Chapter-level meta chips | mins / words / parts / exercises / concepts | same | none | mins / words / parts / **coverage gaps** |
| Deep-link into a section | `#/unit/<slug>/<id>` (a real route) | same | `#/unit/<slug>/<id>` | `#<id>` bare fragment, intercepted in `route()` |
| Glossary popover | `mouseover` only | same | none in prose (glossary is a page) | **`pointerover` + `focusin`, term is `tabindex="0"`** |
| Reading toggles (hide terms / hide page cites) | Terms | Terms | none | **Terms + Pages**, and both appear in the mobile sheet |

### 3.2 Who does it best

**Rust has the best rail *engine*. Medical has the best rail *content and
recovery*. Python's is the weakest and it is not close.**

**Rust's scroll loop** is the piece worth copying verbatim. One rAF-throttled
pass does all three jobs, and both indicators are transforms, not layout:

```js
const ratio = max > 0 ? Math.min(1, h.scrollTop / max) : 0;
if (bar)  bar.style.transform  = `scaleX(${ratio})`;
if (fill) fill.style.transform = `scaleY(${ratio})`;
```

with the reason written next to it: *"A ratio, not a percentage string: both
indicators scale rather than resize, so neither one triggers layout on a frame
the browser is already spending on the scroll itself."* It early-returns when
the active index has not changed (`if (now === active) return;`), it skips the
scroll-into-view work when the rail is collapsed or below its breakpoint
(*"these two reads would flush layout to compare a pair of empty rects"*), and
it tears down with an `AbortController` because *"render() replaces
app.innerHTML wholesale, so without aborting the previous one every unit read
leaves its handler behind holding a whole detached DOM."*

Compare Python's, which runs on every scroll event with no throttle and reads
`rail.offsetHeight` inside the handler — a forced synchronous reflow per event:

```js
const update = () => {
  let current = 0;
  heads.forEach((h, n) => { if (h.getBoundingClientRect().top < 140) current = n; });
  …
  if (rail) fill.style.height = `${((current + 1) / heads.length) * (rail.offsetHeight - 12)}px`;
};
addEventListener("scroll", update, { passive: true });
```

and Medical's, same pattern with `prog.style.width = '${…}%'`. Both are fine at
28 units and 15 sections. **Neither will hold at 122 units with the section
counts a hardware note implies.**

**Medical's `jumpTo` is the piece nobody else has and everybody needs:**

```js
/* A deep link from the exam plan names one section. It is almost always inside a
   collapsed <details>, so opening it is part of arriving -- otherwise the reader
   lands on a closed row and thinks the link is broken. */
function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let n = el; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true;
  if (el.tagName === 'DETAILS') el.open = true;
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    scrollBy(0, -104);
    el.classList.add('landed');
    setTimeout(() => el.classList.remove('landed'), 2400);
  });
}
```

Three correct decisions in twelve lines: **walk up and open every ancestor
`<details>`** (a deep link into collapsed content is otherwise a dead link);
**scroll then offset by the sticky header height** rather than fighting
`scroll-padding`; and **a 2400ms `.landed` highlight** so the reader can see
which of forty rows they were sent to. Rust has the same function (it was
clearly the source), so this is a Rust/Medical convention that Python dropped.

**Medical's Expand-all is the one that got the detail right:**

```js
const keep = document.documentElement.scrollTop;
document.querySelectorAll('.sect').forEach((d) => { d.open = open; });
…
// collapsing shrinks the document under the reader; hold their place
document.documentElement.scrollTop = Math.min(keep, document.documentElement.scrollHeight);
```

Rust's version omits the scroll restore, so collapsing a long unit throws the
reader to a random position. Medical also documents *why* the control exists at
all — it replaced an earlier "Overview / Full chapter" pair, and the commit
comment is honest about the failure: *"The old Overview / Full chapter pair hid
its rule in a set of section titles and moved the scroll position when it fired,
so it read as the page jumping for no reason."*

**Estimated time.** Rust and Medical both show minutes at three levels — chapter
(`<span class="chip accent">${ico('clock',11)} ${mins(ch.mins)}</span>`), part
(`${p.subs.length} topics · ${mins(p.mins)}` in the `.partband`), and section
(`<span class="chip">${m}m</span>` on every `<details>` summary). Both compute
`mins` at build time from word count. Python shows no time estimate anywhere.
The three-level version is right: at 122 units a reader needs to know whether a
section is a 3-minute aside or a 40-minute slog before opening it.

**Prerequisites and cross-references: nobody solved this.** All four assert a
linear order in prose and never model it. Rust's track view says the units are
*"ordered by tier, then by how far into the track their prerequisites reach"* —
computed at build time and then **thrown away**; nothing in the UI shows a
prerequisite edge. Python's track page says the same thing as flat copy: *"Each
unit depends on the ones before it. There are no optional units."* Medical
sidesteps it by making the plan the ordering device. **The only cross-reference
that exists in any of them is the inline glossary term**, and Medical's version
is the accessible one: `<strong class="term" tabindex="0" data-g="…">` with
`pointerover`/`pointerout` **and** `focusin`/`focusout`, against Rust's
mouse-only `mouseover`/`mouseout` on a non-focusable span. Medical also reuses a
single persistent popover node with an `.on` class; Rust creates and destroys a
`div` per hover.

**Coverage honesty — Medical only, and it is a genuinely good idea.** The
chapter head can render a warning that the note does not cover everything:

```html
<div class="dashed"><b>Coverage check:</b> ${ch.gaps.map(esc).join(' · ')}.
  Read those pages from the book itself.</div>
```

and the plan rows carry the same admission per row: *"the note cites nothing
from these pages — read them from the book"*. A handbook that tells you where it
is thin is more trustworthy than one that does not. Directly applicable to a
hardware book that cannot simulate everything it describes.
