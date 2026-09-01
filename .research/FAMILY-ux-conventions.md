# The handbook family: what four siblings converged on, and what diverged

Comparison report. The Rust Handbook is documented in depth elsewhere
(`RUSTBOOK-design-system.md`, `RUSTBOOK-app-architecture.md`,
`RUSTBOOK-workbench.md`, `RUSTBOOK-content-pipeline.md`) and is treated here
only as the baseline to diff against.

The four, with their true state on disk:

| | Path | app.css | app.js | Units authored | Backend |
|---|---|---|---|---|---|
| **Rust** | `rust_learning` | 1827 lines | 1360 lines | 28 units, 28 ex files, 13 projects | real `rustc` via Play/API |
| **Python** | `python_study` | **678 lines** | 713 lines | manifest declares **39** units + 15 projects; **10** unit/ex files on disk, 0 project files | three judges in-browser (WASM) |
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

---

## 4. The exercise / practice experience, compared

### 4.1 Four backends already exist in the family, and they are four different shapes

| | What actually checks the answer | Where it runs | Latency shape |
|---|---|---|---|
| **Rust** | real `rustc` — POST to a compile endpoint, structured JSON back | remote | one round trip, seconds |
| **Voice** | `api/_runner.py` — a real CPython subprocess with numpy/scipy, `rlimit`-capped | remote (own serverless fn) | one round trip, `TIMEOUT = 20` |
| **Python** | **three judges in parallel, all in the browser**: `ruff` (WASM), `mypy` (Pyodide), CPython (Pyodide) | **local, WASM** | cold start ~tens of MB, then instant |
| **Medical** | **nothing** — the answer is pre-rendered in the DOM behind a CSS class | n/a | zero |

**The fifth handbook's four-backend problem has already been solved once, by
Python, and the solution is `mountWorkbench`'s three-row verdict panel.** This
is the most directly transferable code in the family and §4.2 is about it.

### 4.2 Python's multi-judge verdict — the interface to inherit

The panel is three rows, one per judge, rendered before any of them has
answered:

```js
const row = (who, cls, text) =>
  `<div class="verdict-row ${cls}"><i class="lamp"></i><span class="who">${who}</span><span class="what">${esc(text)}</span></div>`;

verdict.innerHTML = `<div class="verdict">
  ${row("ruff",    "is-wait", "checking…")}
  ${row("mypy",    "is-wait", "waiting for CPython to load…")}
  ${row("cpython", "is-wait", "starting…")}</div>`;
```

Everything the fifth handbook needs is in the eight design decisions around it:

1. **Name the backend in the row.** `who` is literally `"ruff"` / `"mypy"` /
   `"cpython"`. The reader always knows which tool is speaking. This is the
   answer to "show which of four backends an exercise uses without clutter" —
   you do not badge the exercise, you **label the verdict row**, and the row
   only exists if that backend runs.
2. **Fan out, display in order.** The comment is the whole argument:
   > *"Start all three at once. They are independent downloads on a cold cache,
   > and awaiting them in series turned a max into a sum. They are still
   > *displayed* in this order, which is what the reader cares about."*
3. **A `settle()` wrapper so one dead backend is not an unhandled rejection:**
   `const settle = p => p.then(value => ({ value }), error => ({ error }));`
4. **Five row states, and "unavailable" is not "failed":**
   `is-wait` / `is-ok` / `is-warn` / `is-bad` / `""` (unavailable). A CDN that
   does not answer renders `set(0, "", "unavailable (${e.message})")` and the
   exercise can still pass. **Essential for the fifth** — Compiler Explorer and
   a user-deployed Modal endpoint will both be down sometimes.
5. **Live status text for slow backends.** `say?.("fetching CPython…")` /
   `"fetching mypy…"` into a `#wbstatus` mono micro span. A 30MB WASM download
   with no narration reads as a hang.
6. **The backends are configured by the build, not the client.**
   `const judges = () => cached("judges", () => fetch("data/judges.json").then(r => r.json()))`
   with the reason attached:
   > *"The three judges are described once, by build.py, and shipped as
   > data/judges.json. Fetching it rather than restating it here is what stops
   > the browser calling something clean that --validate would have failed."*
   CDN URL, ruff `select`/`ignore`, `target-version`, line length — all
   server-authored. **This is the single-source-of-truth pattern for a
   four-backend registry.**
7. **Memoise the success, never the failure:**
   ```js
   const memo = {};
   export const cached = (key, make) => {
     memo[key] ||= make().catch(err => { memo[key] = null; throw err; });
     return memo[key];
   };
   ```
   with *"`p ||= f()` caches a rejected promise forever, which turns one flaky
   CDN fetch into a judge that is dead for the session."*
8. **A machine-readable verdict for the QA harness:**
   `globalThis.__phVerdict = { ruff, mypy, raises: exec?.exc || "", ok: !!exec?.ok };`
   — *"The QA harness reads this to compare the browser's verdict against the one
   `build.py --validate` reached offline. Nothing in the page uses it."*

Voice's runner states the same principle from the server side, and it is the
one that makes a multi-backend book trustworthy:

> *"`api/run.py` wraps it for the browser and `build.py --validate` imports it
> directly, so the thing that validates the content is the same code that
> answers the reader. A validator that runs a different interpreter than the
> site is a validator that certifies nothing."*

And one trick worth stealing outright:

> *"The learner's code and the hidden tests are compiled as two separate code
> objects with two different filenames. That is the one design decision here
> that earns its keep: every traceback frame then says, without arithmetic,
> whether it came from the reader's editor or from a test they cannot see."*

Rust does the same thing by hand with an `e.inTests` boolean and a `userLines`
boundary; Voice's two-filename version is cheaper and does not drift.

### 4.3 How each presents a wrong answer

**Rust** — the most composed. `renderOutput()` is pure (data in, HTML string
out, *"so it can be tested: it is the densest markup in the app"*) and emits, in
order: a verdict banner with attempt/hint count, then per-diagnostic a header
(`code` chip · message · `line N`), a caret/underline snippet of the offending
line, a "What that actually means" reading from `ex.diagnose[e.code]`, and a
`<details>` holding rustc's raw output. Hidden-test failures get their own copy
because a diagnostic in code you cannot see needs different advice:

```
The tests call into your code and could not. Usually that means a name or a
signature does not match what they expect — check the exact function name,
its parameters and its return type.
```

The verdict line has four states, not two:
`'Compiles, and every test passes.'` / `'It compiles.'` /
`'It compiles, but the tests disagree.'` / `'rustc said no.'`

**Python** — the same idea, generalised. `renderReading()` picks the diagnose
entry *"in order of how loudly it failed: an exception first, then the static
judges, then silence"*, dedupes by key, and — crucially — **has a pass state
that is not binary**:

```js
const stamp = `<span class="stamp">passed${ruff.length || mypy.length ? " · with notes" : ""}</span>`;
…
<h4>${ruff.length || mypy.length ? "Correct, but not clean" : "Green"}</h4>
```

"Correct, but not clean" is the family's best single idea about wrongness. With
four backends, "the simulator agrees but Yosys warns" is exactly this state.

Python also handles the case Rust does not — an error with no authored reading:

```
<h4>Not one of this exercise's errors</h4>
The judges are objecting to something the exercise does not have a written
reading for, usually a typo or a change further from the starter than the
exercise expects. Read their messages above; they are the real ones, not a
simplification. reset restores the starter if you want to begin again.
```

That is the correct behaviour and Rust silently renders nothing in the same
situation.

**Both** mark the offending lines in the editor gutter. Python's union is the
generalisable one — a set fed from every judge, including regex-scraped
traceback line numbers:

```js
const lines = new Set();
ruff.forEach(d => lines.add(d.line));
mypy.forEach(d => lines.add(d.line));
for (const m of (exec?.tb || "").matchAll(/your_code\.py", line (\d+)/g)) lines.add(Number(m[1]));
editor.setErrorLines([...lines].filter(Boolean));
```

### 4.4 Drills / quizzes

**Rust and Python** run a real one-question-at-a-time quiz: click an option,
every option disables, the correct one gets `.right`, yours gets `.wrong` if it
was not, the authored `why` appears, then Next. Score at the end with three
graded messages — Python's:

```js
right === drills.length      ? "Every one. Move on."
: right >= drills.length*0.7 ? "Solid. Re-read the sections you missed."
:                              "Worth another pass through the note."
```

**Medical's question bank is not a quiz and this is its main weakness.** 63
chapters, thousands of questions, and `wireQbank()` binds exactly one thing:

```js
list.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reveal]');
  if (b) b.closest('.q').classList.add('shown');
});
```

There is no answer selection, no wrong state, no score, nothing stored. Worse,
`questionCard()` renders the correct option's class into the DOM up front —
`<li class="${o.correct ? 'right' : ''}">` — so the answer is present before
reveal and only hidden by CSS. Devtools, Reader mode, or a stylesheet failing to
load all expose it. **Do not inherit this.** It is a printed answer key rendered
in HTML, not a practice surface.

### 4.5 What Medical did instead of execution, and whether it is any good

Medical could not run anything, so it invested in **explanation quality and
provenance** instead, and that part is genuinely good and directly relevant to
the hardware book's un-runnable units:

- **Every distractor is explained, not just the key.** The blurb commits to it:
  *"Every question carries an answer and a worked explanation of why each
  distractor fails — printed where the source had a key, derived and
  cross-checked where it did not."*
- **The provenance of the answer is a first-class UI element.** A paper with no
  printed key gets a `<span class="chip">derived key</span>` and a paragraph
  saying so: *"No printed answer key exists for this paper. The answers were
  worked out from the medicine and cross-checked against the handwritten marks
  on the scan; every question says how the two compare."* A single contested
  option gets `<span class="chip warn">one option contested</span>`.
- **The most re-readable sentence is lifted out of the paragraph.** The build
  writes explanations ending in `Key point · …` and the card regexes it into its
  own `.keypoint` block: *"which is the single most re-readable sentence in the
  whole bank, so it is lifted out of the paragraph."*

Verdict: **the honesty machinery is excellent and should be inherited; the
interaction model should not.** A question you can only reveal is a flashcard
with extra steps. Rust and Python already have the interaction; Medical already
has the epistemics. The fifth needs both, because a hardware book will have many
units where nothing executes and a drill is the only check available.

### 4.6 Hints — one convention, three implementations, all the same

All three code handbooks do progressive disclosure, one press at a time, with a
countdown in the label. Python's is the smallest and clearest:

```js
$("#hintbtn").textContent = shown >= ex.hints.length ? "No more hints" : `Hint (${ex.hints.length - shown} left)`;
$("#hintbtn").disabled = shown >= ex.hints.length;
store.set("hinted", `${slug}:${i}`, shown);
```

and the hint count is recorded and shown back in the verdict (Rust:
`attempt ${rec.tries} · ${rec.hints} hints`). Solutions are never one press away
in any of them. This convention is settled — copy it.

---

## 5. Copy and voice

### 5.1 The register the family settled on

Scanning all four for the usual AI-writing tells — `seamless`, `delve`,
`leverage`, `elevate`, `robust`, `comprehensive`, `cutting-edge`, `empower`,
`journey`, `dive into`, `transform your`, `unlock the power of` — produces
**zero real hits across four codebases.** The only matches are literal technical
uses (`"The five things it unlocks"` about `unsafe`; `gate.js`'s `unlocked()`
function). This family already writes the way the fifth handbook's prose lint
wants, and the lint should be calibrated to *keep* this, not to fix it.

The register, stated as rules the copy actually follows:

**1. State the mechanism, then the consequence. Never the benefit.**
Rust: *"One owner, one drop. What a move copies, what it does not, and which bug
the whole rule exists to prevent."*
Python: *"Python has no variables. `a = b` binds a second name to one object, and
almost every surprising bug in this book begins by forgetting that."*
Neither says the unit is important. Both say what happens.

**2. Second person, present tense, and the reader is assumed competent and
currently wrong about something specific.**
Python: *"the evaluation order you have been assuming without ever checking."*
Python: *"why every function you made in that loop returned the same answer."*
Rust: *"the rule that makes data races a compile error rather than a Tuesday."*
The blurb accuses you of a specific bug you have written. That is the family's
signature move and it is worth naming explicitly for the fifth.

**3. Sentences end on the concrete noun.** *"…and it will find you at a file
boundary."* *"…a break is not a loss."* *"…rustc said no."* Almost nothing ends
on an abstraction.

**4. Negative parallelism is allowed — sparingly, and always with a real
alternative.** Rust: *"compiles for real, not a simulation, not a quiz."*
Python: *"Nothing is a toy and nothing imports the thing it is supposed to be
teaching you to write."* This is the one "AI-tell" pattern the family uses on
purpose, and it works because the negation is doing informational work, not
rhythmic work.

**5. Numbers are what exists, never what is planned.** Python's home view has
the rule in a comment:
> *"What exists, not what the manifest plans. Advertising a number the reader
> cannot reach is the one thing a progress figure must never do."*
Rust's eyebrow reads `${t.ready} of ${t.units} units written` and its section
head `${t.ready} ready · ${t.units - t.ready} on the way`.

### 5.2 The three hero paragraphs, side by side

**Rust** — the family's best. A claim, its evidence, and what you get:
> **Learn Rust by *fighting the compiler*.**
> Every exercise here compiles for real, not a simulation, not a quiz. When
> rustc rejects your code, you get its actual diagnostic, and next to it a
> plain-English reading of what the borrow checker saw and why it cared.

**Python** — equally good, and the only one whose hero states a *thesis about
the subject* rather than about the product:
> **Python doesn't stop you.**
> A compiler refuses code it cannot make sense of. Python takes almost anything
> you write, runs it, and finds the mistake when it reaches that line, or hands
> back a wrong answer and says nothing at all. Every exercise here runs for real
> in your own browser, judged by three tools that disagree with each other.

**Medical** — the weakest of the three, and the one that drifts:
> **Medical Student Handbook**
> Every examinable chapter, rewritten so the facts arrive attached to the reason
> they are true. Read the idea first. Go deeper only where you want to.

The second sentence is excellent. The `<h1>` is not — it is the product's name,
not a claim, and it is the only `<h1>` in the family that does not say anything.
Rust and Python both put an argument in the `<h1>`; Medical put a label there
and pushed the argument into the lede.

**Voice** — a straight transposition of Rust's, which is why it reads well and
also why it proves nothing:
> **Learn how voices are *heard and made*.**
> Every exercise here runs for real on numpy and scipy, not a simulation, not a
> quiz. When Python raises, you get the actual traceback, and next to it a
> plain-English reading of what went wrong with your signal and why it mattered.

### 5.3 Empty states and errors — the family's weakest surface

| | Not-found copy |
|---|---|
| Rust | **"Not here."** / *"That unit may not be written yet."* + `See the track` |
| Voice | same |
| Python | **"Nothing here"** — a mascot, an `<h1>`, and a Home button. **No explanatory sentence at all.** |
| Medical | **"That page does not exist"** + `Back to the handbook` |

Rust's is the only good one: it is short, it guesses the likely cause, and its
button goes somewhere useful rather than home. Python's is the worst — three
words and a picture. Medical's is serviceable but generic.

The search and glossary empties are better, and Medical wins them:
- Medical: `<b>No term matches that</b>Try a shorter word.` and
  `<b>Nothing matched</b>Try a shorter word, or a disease name.` — **an empty
  state that suggests the specific next action, and a different suggestion per
  surface.**
- Rust: `Nothing matches.` / `Nothing found.` / `Nothing in that domain yet.`
  Three different strings for the same idea, all bare.
- Python: no search empty state found.

**Error messages** are the family's best-written copy, because they were written
under pressure. Python's fallback reading:
> *"The judges are objecting to something the exercise does not have a written
> reading for, usually a typo or a change further from the starter than the
> exercise expects. Read their messages above; they are the real ones, not a
> simplification. **reset** restores the starter if you want to begin again."*

Names the cause, names the two likely reasons, tells you the output above is not
dumbed down, and names the escape hatch. Four jobs, one paragraph.

Python's load failure is the only one that considers the local-dev reader:
> *"If you are running this locally, make sure `python3 build.py` has been run."*

### 5.4 Button labels

Settled convention: **verb + object, sentence case, no terminal punctuation, and
the label says what happens rather than naming the control.**

`Run` · `Show answer` · `Reveal all` / `Hide all` · `Expand all` / `Collapse all`
· `Hint (3)` → `Hint (2 left)` → `No more hints` · `Open the workbench` ·
`See the track` · `Back to the note` · `Start with the exam plan` ·
`Continue: Ownership` · `Next →`

Two conventions inside that worth naming:
- **Toggles rename themselves to the action, not the state**
  (`Expand all` ⇄ `Collapse all`), and Rust also updates `aria-label` because
  *"Below 420px the span is hidden and this label is the only name there is."*
- **Counted buttons count down** (`Hint (3)` → `Hint (2 left)` →
  `No more hints`), never up.

The strongest single label in the family is Rust's continue CTA, because it
carries the destination: `Continue: Ownership` rather than `Continue`.

### 5.5 Mascot copy

Both Rust and Python ship a mascot that says one line, rarely. The lines are
in-register and non-promotional — Python's:

```js
"Draw the arrows. How many objects, how many names?",
"If it runs and it is still wrong, that is the interesting kind of wrong.",
"ruff is fast and shallow. CPython is slow and honest. Both are useful.",
"A hint is cheaper than an hour. Two hints is still cheaper than an hour.",
"Nothing here leaves your browser. Break whatever you like.",
```

Rust's are contextual rather than random — bucketed into `FIRST` / `MID` /
`LAST` / `REST`, chosen by how far through you are and how long you have been
sitting there, with a hard rate limit (*"At most one line every two minutes,
whatever happens"*) and a session-length check that switches to the rest bucket
after 1.6 hours: *"Long session. The compiler will still be here. Sleep is where
the model actually consolidates."* Rust's contextual bucketing is the better
design; Python's `Math.random() > 0.22` is cruder but a tenth of the code.

**Verdict for the fifth:** the family's register is already correct and the
prose lint should encode §5.1's five rules. The gaps to fix are (a) empty states
— write one explanatory sentence and one specific next action for every one, on
Medical's model; (b) the `<h1>` rule — put a claim there, not a product name.

---

## 6. Mobile and accessibility, compared

### 6.1 Breakpoints

| Breakpoint | Rust / Voice | Python | Medical |
|---|---|---|---|
| 1060 / 1061px | **rail → sheet** (`max-width:1060px` + a matching `min-width:1061px` for the JS) | rail → sheet (`max-width:1060px`) | — |
| 1040px | reader frame narrows | — | reader frame narrows |
| 900px | **nav row → tab bar** (5 rules) | nav → tab bar | nav → tab bar |
| 860px | — | — | figure layout |
| 760px | 3 rules; plus `(max-width:760px), (pointer: coarse)` | — | — |
| 620px | 2 rules; plus `(pointer: coarse)` in Python | `(pointer: coarse), (max-width: 620px)` | — |
| 560px | — | — | 1 rule |
| 420px | the label-hiding block | — | 1 rule |
| Total media blocks | **18** | **5** | **10** |

**The convention, in all three independent designs:** two structural
breakpoints — **~1060px turns the contents rail into a bottom sheet**, and
**~900px turns the top nav row into a thumb-reachable bottom tab bar**. Both
`index.html` shells carry the same comment verbatim:

```html
<!-- Mobile: a thumb-reachable tab bar instead of a nav row nobody can hit, and a
     contents sheet that slides up from the bottom the way an iOS sheet does. -->
```

**Rust's is the most careful, in one specific way worth copying:** it keys touch
targets on **pointer type, not width** —
`@media (max-width: 760px), (pointer: coarse)` and Python's
`@media (pointer: coarse), (max-width: 620px)`. A 1200px touchscreen gets the
44px targets. Medical does the opposite: it has a `@media (hover: hover)` guard
but sizes targets by width only.

**Rust also pairs its CSS breakpoint with a matching JS one and says so:**
```js
// Matches the rail's own breakpoint in app.css. Evaluated once, not per scroll.
const wide = matchMedia('(min-width: 1061px)');
```
That `1060 / 1061` pair is the family's one place where a CSS breakpoint and a
JS breakpoint are deliberately kept in sync. Nothing enforces it — a build-time
constant would.

### 6.2 The mobile nav below the breakpoint

All three ship a **bottom tab bar**, never a hamburger. Medical's is the best
thought through and documents the reasoning:

```js
// The tab bar carries Home as well, because on a phone the brand mark in the top
// bar is too small a target to be the only way back.
const TABS = [
  ['#/', 'Home', 'book'], ['#/books', 'Library', 'layers'], ['#/plan', 'Plan', 'route'],
  ['#/qbank', 'Questions', 'quiz'], ['#/glossary', 'Terms', 'book'],
];
```

Two details Rust and Python miss: **the tab bar's labels are shortened**
(`Exam plan` in the top nav becomes `Plan`; `Glossary` becomes `Terms`) so five
tabs fit a 375px screen, and **each tab carries an icon plus a label plus an
active dot** (`${ico(i,19)}<span>${l}</span><span class="dot"></span>`). Python's
tab bar is five bare text links copied straight from the desktop nav. Rust's is
painted from JS with icons but with the desktop labels.

Medical also computes active state correctly for the root route, which the
others get subtly wrong:
```js
const active = (h) => (h === '#/' ? hash === '#/' || hash === '' : hash.startsWith(h));
```

### 6.3 Focus management — the family's weakest area, and it is unanimous

**Nobody implements a focus trap.** Rust, Voice and Medical all ship
`<div class="sheet" role="dialog" aria-modal="true" aria-label="Contents">` and
then wire only three things: scrim click, close button, `Escape`. There is no
`Tab` handler, no `inert` on the background, no focus moved into the sheet on
open, and no focus restored to the opener on close. **`aria-modal="true"` is
asserted and not honoured** — which is worse than not claiming it, because a
screen reader will hide the rest of the page while keyboard `Tab` walks straight
out of the sheet into it.

Python is worse again: its sheet is `<div class="sheet" id="sheet">` with **no
role, no `aria-modal`, no label, and no `Escape` handler** — only
`sheet.classList.toggle("open")`.

`.focus()` is called in exactly four places in the family and all four are
convenience, not management: returning focus to the editor after toggling vim
(Rust ×2), and focusing the search box on arrival (Python, Medical).

**No handbook has a skip link.** `grep -i skip` returns nothing in any of the
four.

### 6.4 ARIA usage

| Attribute | Rust / Voice | Python | Medical |
|---|---|---|---|
| `aria-label` | 9 | 5 | 6 |
| `aria-pressed` | 4 | 4 | **7** |
| `aria-current` | **0** | **10** | **0** |
| `aria-expanded` | 2 | 0 | 0 |
| `aria-controls` | 1 | 0 | 0 |
| `aria-hidden` | 3 | 1 | 2 |
| `role="dialog"` + `aria-modal` | yes | **no** | yes |
| `role="alert"` | 0 | 0 | **1** |
| `tabindex` on interactive non-buttons | 0 | 0 | **1** (`.term`) |
| `:focus-visible` rules | 1 | 1 | **3** |

**Python is the clear winner on `aria-current`** and it is not close — 10 uses,
including the one that matters most, the active rail entry:

```js
if (n === current) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
```
and the nav, computed generically in the router:
```js
document.querySelectorAll("#nav a, #tabbar a").forEach(a => {
  const href = a.getAttribute("href").slice(1);
  if (href === "/" ? path === "/" : path.startsWith(href)) a.setAttribute("aria-current", "page");
  else a.removeAttribute("aria-current");
});
```
and the exercise strip: `${k + 1 === i ? 'aria-current="true"' : ""}`.

**Rust and Medical use a `.on` class and nothing else** for every active state in
the app — nav, tab bar, rail entry, exercise number. To a screen reader those
are all just links. This is a straightforward, mechanical fix and Python already
wrote it.

**Rust wins on `aria-expanded` / `aria-controls`**, which only it has, on the
rail toggle:
```html
<button class="railtoggle" id="railtoggle" aria-expanded="${!railCollapsed()}"
  aria-controls="railol" title="…">
```
and it keeps it in sync on click. It also updates `aria-label` when a button's
visible text is hidden by a breakpoint (§5.4).

**Medical wins on keyboard reachability of the glossary term**, which is the
only place in the family where an interactive non-button is made focusable and
given a keyboard-equivalent trigger:
```python
f'<strong class="term" tabindex="0" data-g="…"'
```
```js
addEventListener('pointerover', e => { const t = e.target.closest('.term'); if (t) showGloss(t); });
addEventListener('focusin',     e => { const t = e.target.closest('.term'); if (t) showGloss(t); });
addEventListener('focusout', hideGloss);
```
Rust's identical feature is `mouseover`/`mouseout` on a non-focusable span —
unreachable by keyboard and unreliable on touch. Medical also uses `pointer*`
rather than `mouse*`, which is the correct family of events.

### 6.5 Reduced motion

All four honour it, and all four use the same nuclear option:

```css
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition: none !important; animation: none !important; }
}
```

Python's omits the `scroll-behavior: auto` line, which is a real miss: it sets
`scroll-behavior: smooth` on `html` and never turns it off, so a
reduced-motion reader still gets smooth-scrolled on every rail click.

Rust/Voice add a second block that also drops `will-change` on the two animated
indicators (`.railfill`, `.readerbar .progress`) — a compositor-layer cleanup
nobody else does. Medical's second block disables its landing-page video
entirely (`.gate-bg video { display: none; }`), which is the right call for a
full-bleed autoplaying background.

### 6.6 Verdict: who is furthest along

**Nobody is far along, and the strengths are disjoint.**

- **Rust/Voice** — best breakpoint discipline (18 media blocks, pointer-keyed
  touch targets, CSS/JS breakpoints paired), best `aria-expanded`/`aria-controls`
  hygiene, only one to update `aria-label` when a label is visually hidden.
- **Python** — the only one that does `aria-current` at all, and does it
  everywhere. Otherwise the weakest: 5 media blocks, an unlabelled non-dialog
  sheet with no Escape, and `scroll-behavior: smooth` left on under
  reduced-motion.
- **Medical** — best mobile nav (shortened labels, icons, correct root-active
  test), best keyboard/pointer story for the inline glossary, most
  `:focus-visible` rules, only `role="alert"`.

**The union of the three is a decent baseline; no single one is.** And the one
thing all four get wrong — a `role="dialog" aria-modal="true"` sheet with no
focus trap, no focus move, no focus restore, and no skip link anywhere — is the
first thing the fifth should fix, because it is ~30 lines and it is the same
30 lines for all of them.

---

## 7. What the fifth handbook should inherit, and what it should improve

### 7.1 Inherit unchanged (P0 — do not redesign these)

1. **The nine-step fluid type scale, verbatim.** Four handbooks, zero edits.
   Copy the `clamp()` block character for character.
2. **Four inks, one job each; no component ever names a colour.** With
   `[data-accent="x"] { --accent: var(--x) }` as the only indirection.
3. **`--drop: 2px` driving both the button's hard shadow and its press
   translate.** One token, they can never disagree.
4. **The radii ladder 4/6/8/16 and `--measure` ~72ch.**
5. **Python's regex route table.** One line per route, optional segments free.
6. **Python's `.btn:hover { filter: brightness(1.06); }`.** Fixes the family's
   longest-lived bug in one line and survives every future button variant.
7. **Rust's rAF-throttled single-pass rail loop** with `transform: scaleX/scaleY`
   indicators and `AbortController` teardown.
8. **Medical's `jumpTo`** — open every ancestor `<details>`, scroll, offset by
   the sticky header, flash `.landed` for 2400ms.
9. **Progressive hints with a counting-down label**, hint count recorded and
   echoed in the verdict.
10. **The two structural breakpoints** (~1060px rail→sheet, ~900px nav→tab bar)
    and **pointer-keyed touch targets**, not width-keyed.
11. **The prose register of §5.1** — mechanism before consequence, second
    person, the reader is specifically wrong about something, sentences end on
    concrete nouns, numbers are what exists.
12. **Voice's rule that the validator and the reader share one execution path.**
    *"A validator that runs a different interpreter than the site is a validator
    that certifies nothing."* With four backends this becomes four shared paths,
    and it is the hardest and most important thing in the build.

### 7.2 Fix the family's known defects while you are copying them (P0, cheap)

| Fix | Cost |
|---|---|
| Never declare `@keyframes` twice — the Rust/Voice `tick` collision. Add a build-time check: parse `app.css`, assert every `@keyframes` name is unique. | 5 lines in `release.sh --check` |
| No literal colour outside the token blocks except a syntax theme. Python proves it is achievable (0 literals). Add the same lint. | 5 lines |
| Tokenise the scrim and the pill radius (`--scrim`, `--r-pill`) — both are literals in three of the four. | 2 tokens |
| Ship `--ease` **and** a 4-step duration ladder; ban literal durations in the same lint. Medical has ~30 of them. | 1 block |
| Set `--accent` in `:root`, so no consumer needs a `var(--accent, #hex)` fallback (Medical has six). | 1 line |
| Add `--ok-bg` / `--warn-bg` / `--bad-bg` (Python's). With four backends you will render a lot of tinted verdict panels. | 6 tokens |
| Keep `--shadow` / `--hair` / `--mark` (Python dropped them). | 3 tokens |
| A real focus trap on the bottom sheet: move focus in on open, `Tab`-cycle inside, restore to the opener on close, `inert` the background. Every handbook claims `aria-modal="true"` and none honours it. | ~30 lines, once |
| A skip link. Nobody has one. | 3 lines |
| `aria-current` on nav, tab bar, rail entry and exercise strip, Python's way. | ~6 lines |
| `pointer*` + `focusin`/`focusout` + `tabindex="0"` for the inline glossary term, Medical's way, not Rust's `mouseover`. | ~8 lines |
| Keep `html { scroll-behavior: auto }` inside the reduced-motion block (Python lost it). | 1 line |
| Never render the correct answer into the DOM behind a CSS class (Medical's qbank). | design rule |

### 7.3 Do not inherit

- **The Voice fork strategy.** Copying `app.js` and swapping strings produced
  a broken hero image (`parrot.svg` referenced, `parrot.png` on disk), a dead
  `#/errors` link to a route that does not exist, Rust's `#ff7a35` hover on a
  red palette, and Rust's rustc-tuned syntax theme in a numpy handbook — all
  before a single unit was written. Whatever the fifth takes, take it as a
  reviewed extraction, not a copy.
- **Rust's `#/projects` + a second content type through the same bench.** Two of
  three independent designs dropped it. `BENCH[source]` / `B.route` indirection
  exists solely to serve it and will collide with the backend registry.
- **Medical's reveal-only question bank.** No selection, no wrong state, no
  score, answer pre-rendered in the DOM.
- **Medical's untokenised motion.** ~30 literal durations.

### 7.4 What will not survive the scale, and what to do instead

#### (a) 122 units, not 28 — the flat track dies

Rust's `#/track` is `DB.units.map(unitCard)` — one flat grid of 28 cards, no
grouping, no filter. At 122 that is a wall nobody scans, and the manifest that
feeds it becomes a several-hundred-KB download on **every page view**, because
every handbook loads the whole manifest at boot.

The family has already produced the three pieces of the answer; nobody has all
three at once:

1. **Two levels, from Medical.** `#/books` → `#/book/<id>` → chapter. For the
   fifth: `#/track` (19 part cards) → `#/part/<n>` (its 5–8 units) → `#/unit/…`.
   **The accent becomes a property of the part, not a rotating cycle** — Medical
   already does this (`"accent": "blue"` on the book), and with 19 parts a
   7-colour rotation means three parts share every hue with no meaning attached.
   Assign one accent per *phase* (transistor → gate → CPU → OS → GPU →
   distributed, say) and let the parts inside a phase share it. Colour then
   encodes where in the machine you are.
2. **Phase bands, from Python.** `viewTrack` renders a `.phase-head` with a
   title and a blurb before each group. Keep this *inside* a part page and at
   the top level as a spine.
3. **A live client-side filter, from Medical.** `chapterCard` pre-bakes the
   searchable text into the DOM at build time:
   ```js
   <a class="chcard" data-t="${esc((c.title + ' ' + c.sections.join(' ')).toLowerCase())}">
   ```
   and the filter is nine lines of `style.display`. At 122 units + ~1500 section
   titles this is the right amount of machinery — no index, no fetch, instant.
   Put the filter on `#/track` and on every `#/part/<n>`.

**The manifest split is mandatory, not optional.** Rust already learned this
once and left the reason in the build:
> *"Section titles and concept lists are read by search and by nothing else, and
> they were 45% of a file every page view downloads. They live in their own
> document now, fetched only if someone actually searches."*
Medical learned it again for the glossary:
> *"2,782 terms is too many to put in the DOM at once and still feel quick, so
> the page renders one letter at a time and searching swaps in matches instead.
> The data lives in its own file rather than the manifest, so the other pages
> never pay for it."*
At 122 units, ship `data/track.json` (19 parts + 122 titles/blurbs/accents,
nothing else), `data/part/<n>.json` per part, and `data/search.json` lazily.
Nothing that only one view reads belongs in the boot payload.

**Progress at 122 units also needs rethinking.** Rust's `#/progress` aggregates
28 units into one page of rings; 122 will not fit and "6 of 122" is
demoralising rather than informative. Show progress *per part* on the track, and
make the home CTA carry the destination the way Rust's does
(`Continue: Ownership`, not `Continue`).

#### (b) Four backends, shown without clutter

**Do not badge the exercise. Label the verdict rows.** This is Python's answer
and it is already built.

- **Before you run:** the exercise header shows nothing about backends. At most
  one small chip when the backend has a *cost the reader must know about* — the
  Modal GPU endpoint is the only one of the four that qualifies, because it
  needs a deploy and spends money. A `<span class="chip">needs your Modal
  endpoint</span>` on those exercises, and nothing on the other three. The JS
  simulator, Compiler Explorer and WASM Yosys are all invisible-and-free; naming
  them up front is clutter.
- **When you run:** render one `verdict-row` per backend this exercise uses,
  with the backend's real name in `.who` (`simulator`, `godbolt`, `yosys`,
  `modal`), all started in parallel, displayed in a fixed order. The row *is*
  the disclosure. The reader learns which tools exist by watching them answer.
- **Five states, and "unavailable" is not "failed"** — Python's
  `is-wait`/`is-ok`/`is-warn`/`is-bad`/`""`. Compiler Explorer will rate-limit
  and Modal endpoints will be un-deployed; the exercise must still pass on the
  backends that answered, and the row should say `unavailable (…)` in ink 3, not
  red.
- **Narrate the slow ones.** `say?.("fetching Yosys…")`, `say?.("waking your
  Modal endpoint…")`. WASM Yosys is a large download and a cold GPU container is
  tens of seconds; silence reads as a hang.
- **One `data/backends.json`, authored by `build.py`**, exactly like Python's
  `judges.json`, holding CDN URLs, versions, endpoints and per-backend timeouts
  — *"Fetching it rather than restating it here is what stops the browser
  calling something clean that `--validate` would have failed."*
- **Keep `globalThis.__verdict`** so a headless QA run can compare the browser's
  answer to `build.py --validate`'s. With four backends this is the only way to
  know the site and the validator still agree.
- **Steal "Correct, but not clean."** With four backends the interesting state
  is partial agreement — the simulator is happy, Yosys warns about an inferred
  latch. Python's `passed · with notes` stamp and its `Correct, but not clean`
  heading are the right vocabulary.
- **`diagnose` must stop being keyed by error code.** Rust keys readings by
  `E0502`; Python keys by `B006` / `arg-type` / `ValueError`. Four backends have
  four incompatible taxonomies and two of them (a JS simulator, a GPU run) have
  no codes at all. Key by **`backend:key`** with an authored fallback, and keep
  Python's explicit "Not one of this exercise's errors" panel for the misses —
  Rust silently renders nothing there, and at four backends that will happen
  constantly.
- **Two filenames, not line arithmetic.** Voice's runner compiles the learner's
  code and the hidden tests as separate code objects with different filenames so
  every frame declares its origin. Rust does the same job with an `inTests`
  boolean and a `userLines` boundary that has to be recomputed per backend. Use
  filenames — or, for backends that have no notion of a file, have each backend
  adapter return diagnostics already tagged `{ origin: 'user' | 'harness' }`
  rather than a line number the shared layer has to interpret.

#### (c) A contents rail for longer, more technical notes

The rail's job changes at hardware-note length. Concretely:

1. **Two levels are enough, and the family agrees** — Rust and Medical both do
   `h2` part / `h3` sub and stop. Do not add a third; a 3-level rail at this
   density becomes an outline nobody reads.
2. **Per-entry minutes at both levels** (Rust and Medical, not Python). At 122
   units the reader is triaging constantly, and `12m` on a row is the cheapest
   triage signal there is.
3. **Keep Rust's `.read` / "you have scrolled past this" state** — *"what makes
   the rail a record of where you have been rather than only where you are."*
   Python's `.seen` is the same idea; Medical dropped it and its rail is worse
   for it.
4. **Persist the collapse** (Rust `rh-rail`, Python `RAIL_KEY`; Medical has no
   toggle at all). On a technical note the reader wants the width back.
5. **The rail must scroll independently and keep the active entry in view**, and
   must skip that work when collapsed or below the breakpoint. Rust already
   guards both cases and explains why.
6. **Add what nobody has: a rail filter, and a "what this section needs" line.**
   A hardware note's rail will run to 30+ entries. Medical's nine-line
   `data-t` + `style.display` filter works verbatim on rail `<li>`s.
7. **Add prerequisites — the family's biggest unfilled gap.** All four compute a
   dependency order at build time and then throw it away, asserting linearity in
   prose (*"Each unit depends on the ones before it"*). At 19 parts spanning
   transistors to distributed training that assertion will be false, and the
   reader will arrive at a unit from search rather than from unit N−1. Emit the
   edges into the manifest and render them: a `needs:` chip row in the unit head
   linking back, and an `unlocks:` row at the foot. Rust's `projectCard` already
   renders `p.needs.map(n => <span class="chip mono">${n}</span>)` for projects
   — the component exists, it was just never applied to units.
8. **Keep Medical's coverage honesty.** *"Coverage check: … Read those pages
   from the book itself."* A hardware book cannot simulate a fab line or a real
   NVLink fabric. Say so in the same place, in the same voice.

### 7.5 Priority order

**P0 — before any content:** the token file (§7.1 1–4 + §7.2 token fixes); the
regex router; `data/backends.json` + the multi-row verdict panel; the
validator-shares-the-execution-path rule; the split manifest (`track.json` /
`part/<n>.json` / lazy `search.json`).

**P1 — the reading experience:** two-level track with per-part accents and a
live filter; Rust's rail engine + Medical's `jumpTo`; per-entry minutes; the
`.read` state; the focus trap and skip link; `aria-current` everywhere.

**P2 — the practice experience:** hints; "Correct, but not clean"; the
`backend:key` diagnose map with the explicit no-reading fallback; a real drill
interaction (Rust/Python's, not Medical's reveal-only).

**P3 — the polish the family never got to:** prerequisite edges rendered;
per-part progress; a rail filter; empty states with a specific next action;
`--scrim`/`--r-pill` tokens; the build-time lints (unique keyframe names, no
literal colours, no literal durations).

### 7.6 Things I could not determine

- **The Rust compile endpoint's exact host and contract** — `RUSTBOOK-workbench.md`
  §3.1 covers it and I did not re-derive it here.
- **Whether the Voice `api/` endpoint is deployed.** `vercel.json` exists and
  `requirements.txt` is one line, but with zero content files there is nothing to
  run against it, so I could not confirm it works end to end.
- **Python's `#/progress` and `#/projects` views in detail** — `viewProjects`
  reads `m.projects` but `content/projects/` is empty on disk, so the projects
  IA is declared and unbuilt. I could not tell whether that is abandoned or
  pending.
- **Medical's `gate.js`** — there is an access gate over the whole site with a
  video landing page. I read enough to see it exists, gates on a stored flag,
  and calls `window.onUnlocked`; I did not audit what it gates on or why, and
  nothing in the other three has an equivalent.
- **Actual runtime performance at scale.** Every claim in §7.4(a) about the flat
  track and the manifest payload is read off the code and the file sizes
  (Medical's `glossary.json` is 507KB; `audit.json` is 97KB), not measured in a
  browser.
