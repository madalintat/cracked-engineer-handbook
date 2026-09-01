# The Rust Handbook design system — reproduction reference

Source: `/Users/madalintat/learning_series/rust_learning`
Files of record: `assets/app.css` (1827 lines), `index.html` (98 lines), `docs/BUILD-YOUR-OWN.md`.
Live: the-rust-handbook.com.

Lineage, per the file header comment (lines 1–10): structure lifted from the
Medical Student Handbook, which lifted its palette from PostHog. The single
deliberate deviation is *temperature* — PostHog's tan `#EEEFE9` is faintly
green, and green-grey next to rust orange goes muddy, so every neutral is
rotated warm (`#EFEBE4` light ground, `#1C1917` dark ground rather than a cool
`#1e1f23`). The button keeps PostHog's shape: solid fill on a hard offset
shadow that it drops onto when pressed.

---

## 1. Complete token inventory

There are **three** `:root` blocks, not two. Tokens live in:

- `:root` at lines 12–73 (brand, light ramp, geometry, type, `--accent`)
- `:root[data-theme="dark"]` at lines 75–96 (dark overrides only)
- a second, later `:root` at lines 165–169 (motion: `--ease`, `--fast`, `--med`)
  — deliberately placed in the "motion" section rather than hoisted.

Plus one *derived* token layer: `[data-accent="…"]` attribute selectors (lines
99–105) that rebind `--accent` per container, and component-local rebinds
(`.btn.quiet`, `.btn.ghost`) that rebind the four `--btn-*` tokens inside a
single element's scope.

### 1.1 Brand / accent ramp (light `:root`, lines 14–23)

| Token | Value | Used for |
|---|---|---|
| `--rust` | `#ce422b` | rust-lang.org's own red-orange. `[data-accent="rust"]`. Overridden in dark. |
| `--ferris` | `#f74c00` | The crab orange. **The default `--accent`.** Also `:focus-visible` outline, `.searchbox input:focus` border, `.hero h1 em`, avatar `.a1`. |
| `--amber` | `#e0921a` | `[data-accent="amber"]` |
| `--clay` | `#b4552d` | `[data-accent="clay"]` |
| `--moss` | `#5c7a47` | `[data-accent="moss"]`, avatar `.a3` |
| `--slate` | `#43607a` | `[data-accent="slate"]`, avatar `.a2` |
| `--plum` | `#7b4b72` | `[data-accent="plum"]` |
| `--ok` | `#3f8f4f` → dark `#5fb872` | pass/success: chips, verdict, ring done tick, passed dots |
| `--warn` | `#c98a12` → dark `#e0a53a` | warnings |
| `--bad` | `#cf3b2f` → dark `#ef6558` | errors, failed verdicts |
| `--accent` | `var(--ferris)` | **Derived.** The one token components actually read. |

Seven accents form a rotating palette assigned per unit via `data-accent` on a
container; every descendant reads `--accent` and never names a hue.

### 1.2 Button tokens (lines 25–28, dark overrides 90–91)

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--btn-bg` | `#f7681f` | (inherited) | `.btn` fill |
| `--btn-border` | `#a8380f` | `#8a2f0d` | `.btn` 1.5px border |
| `--btn-shadow` | `#c04a12` | `#9c3b0f` | the hard offset shadow the button sits on |
| `--btn-fg` | `#fff8f3` | (inherited) | `.btn` label |

These four are the *only* component-scoped colour tokens, and that is exactly
what lets `.btn.quiet` / `.btn.ghost` re-skin the button by rebinding them
locally instead of writing new rules.

### 1.3 Neutral ramp — light `:root` (31–42) / dark (76–89)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#efebe4` | `#1c1917` | page ground |
| `--surface` | `#fdfbf6` | `#26211e` | cards, inputs, topbar controls |
| `--raised` | `#e6e1d8` | `#2e2825` | hover fills, chips, ring track |
| `--border` | `#c3bcaf` | `#403833` | the harder border |
| `--border-soft` | `#d8d2c6` | `#342d29` | the default border everywhere |
| `--ink` | `#211d1a` | `#faf9f7` | ink 1 — primary text |
| `--ink-2` | `#4d4640` | `#b8afa6` | ink 2 — secondary/body-in-card |
| `--ink-3` | `#746c64` | `#928980` | ink 3 — labels, meta |
| `--ink-4` | `#9d958b` | `#6b635c` | ink 4 — separators, placeholders, disabled |
| `--shadow` | `rgb(33 29 26 / 0.09)` | `rgb(0 0 0 / 0.42)` | soft elevation shadow colour |
| `--hair` | `rgb(33 29 26 / 0.1)` | `rgb(250 249 247 / 0.1)` | hairline rules over surfaces |
| `--mark` | `rgba(247,104,31,0.24)` | `rgba(247,104,31,0.26)` | `::selection`, `<mark>` |
| `--code-bg` | `#f6f1e8` | `#1f1b19` | code ground |
| `--code-border` | `#e0d8ca` | `#352e29` | code block border |

Note the light `--shadow` and `--hair` are the `--ink` value in rgb space
(`33 29 26` = `#211d1a`), and the dark `--hair` is the dark `--ink`
(`250 249 247` = `#faf9f7`). They are *hand-derived*, not `color-mix`-derived,
so if you change ink you must change both by hand.

`--code-bg` is deliberately a step away from `--surface` (comment at 44–45): "so
a block reads as an object rather than as indented prose."

### 1.4 Geometry (49–56)

| Token | Value | Used for |
|---|---|---|
| `--r-sm` | `4px` | focus ring radius, rail toggle, tiny controls |
| `--r` | `6px` | default: buttons, nav items, inputs |
| `--r-md` | `8px` | cards, code blocks, panels |
| `--r-lg` | `16px` | the bottom sheet's top corners, large surfaces |
| `--drop` | `2px` | the button's hard shadow offset **and** its press translate — one token drives both, which is why they can never disagree |
| `--rail` | `288px` | contents rail grid column width |
| `--measure` | `72ch` | prose measure |

`999px` is used inline for pills (chips, `.llms`) — not tokenised.

### 1.5 Type (58–70)

Stacks:

```css
--sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

Loaded from Google Fonts in `index.html` line 10: Inter at `400;500;600;700;800`,
JetBrains Mono at `400;500;700`.

One fluid scale, nine steps, every one a `clamp()` — full expressions in §2.

### 1.6 Motion (165–169)

| Token | Value | Used for |
|---|---|---|
| `--ease` | `cubic-bezier(0.22, 0.9, 0.28, 1)` | **every** eased transition and keyframe in the file. "Sharp out, soft in." |
| `--fast` | `0.14s` | hover state changes on chrome |
| `--med` | `0.26s` | layout/transform changes, card lift |

### 1.7 Layout widths (not tokenised, but fixed)

| Value | Where |
|---|---|
| `1180px` | `.wrap` max-width; `.readerbar .inner` max-width (must match `.wrap` so the reader bar's contents line up with the page) |
| `1330px` | `.wrap.wide` — the reader frame only, so the rail can sit further left without eating the column |
| `840px` | `.readercol` max-width |
| `20px` | `.wrap` horizontal padding |
| `56px` | topbar height; `.readerbar` sticky `top` |
| `96px` | `.rail` sticky `top` (56 topbar + ~40 reader bar) |
| `116px` | `html { scroll-padding-top }` — must clear topbar + reader bar |

### 1.8 Literal colours outside the `:root` blocks — VERIFIED, the guide is wrong

`BUILD-YOUR-OWN.md`'s claim of zero literals does **not** hold. There are
**five** sites (excluding the header comment):

1. **`.btn:hover { background: #ff7a35; }`** (line 349) — the only hard-coded
   brand colour in a component. A lighter `--btn-bg`. Not themed, so the dark
   button hovers to the same light orange.
2. **Syntax highlighting, lines 966–984** — sixteen literals, eight light and
   eight dark, for the `.t-*` token classes. These are the one intentional
   escape: a syntax theme is its own palette and does not map onto the seven
   accents. Listed in full in §6.
3. **`#fff` on coloured grounds** — line 1063 (`.exlist a.passed .st`),
   line 1306 (`.verdict .ic`), line 1338. Always white-on-accent, never
   white-as-surface, so it survives a palette change.
4. **`#000` in a mask gradient**, lines 650–651 — a `mask-image` alpha stop, not
   a visible colour. Safe.
5. **`rgb(0 0 0 / 0.42)`** at line 1713 — the sheet scrim. Same value as the
   dark `--shadow`, but written out, so a light-theme scrim is also 42% black.

When re-skinning, 1, 2 and 5 must be hunted down by hand. 3 and 4 can stay.

---

## 2. Typography, exactly

### 2.1 The scale — every `clamp()` verbatim (app.css 62–70)

```css
--t-micro: clamp(10.5px, 0.1vw  + 10.2px, 11.5px);
--t-tiny:  clamp(12px,   0.12vw + 11.6px, 13px);
--t-sm:    clamp(13.5px, 0.14vw + 13.1px, 14.5px);
--t-body:  clamp(15px,   0.2vw  + 14.4px, 16.5px);
--t-read:  clamp(16px,   0.34vw + 15px,   18.5px);
--t-lede:  clamp(17.5px, 0.5vw  + 16.3px, 21px);
--t-h3:    clamp(19px,   0.6vw  + 17.6px, 24px);
--t-h2:    clamp(24px,   1.4vw  + 20.5px, 36px);
--t-h1:    clamp(32px,   3.4vw  + 21px,   60px);
```

The shape of the scale is the design: the `vw` coefficient climbs monotonically
(0.1 → 0.12 → 0.14 → 0.2 → 0.34 → 0.5 → 0.6 → 1.4 → 3.4). Small text barely
moves between a phone and a 27-inch display — a label is a label at every width
— while `--t-h1` more than doubles (32→60). Growth ratio min→max: micro 1.10×,
tiny 1.08×, sm 1.07×, body 1.10×, read 1.16×, lede 1.20×, h3 1.26×, h2 1.50×,
h1 1.88×. Reproduce this curve, not the pixel values, if you change the scale.

`--t-body` is set on `body`; `--t-read` is set only on `.prose`. Reading text is
one step larger than UI text, everywhere.

### 2.2 Font stacks

```css
--sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

`body` also sets `font-feature-settings: "cv05" 1, "ss01" 1` — Inter's
single-storey `l` (cv05) and alternate digits/punctuation (ss01). Drop these if
you swap away from Inter; they are no-ops on other faces but the l/1/I
disambiguation is a real reason they are on in a book about code.

`code, kbd, samp, pre` get `font-family: var(--mono); font-variant-ligatures:
none;` — ligatures off so `->`, `=>`, `!=` show their real characters. Essential
in a code-teaching context.

### 2.3 Weights, and where each is used

| Weight | Used for |
|---|---|
| 400 | prose body, `.prose em`, code, table cells |
| 500 | `.nav a` (inactive) — the only 500 in the file |
| 600 | `.nav a.on`, `.rail a.on`, `.chip`, `.crumbs .now`, `.t-kw` / `.t-kw2` / `.t-mac` / `.t-life`, `.btn.quiet`, `.btn.ghost`, collapsed-rail tooltip, `.llms` |
| 700 | `.brand`, `.btn`, all `h2`/`h3`/`h4` in prose, `.sect > summary h3`, `.rail a.h2`, `.prose strong`, `.prose th`, `.codeblock .cb-head`, `.pagenav .lbl` / `.t`, `.term`, `.chip.mono`, `.sect .n` |
| 800 | `.hero h1`, `.unithead h1` / `.pagetitle`, `.prose h1`, `.stat .n`, `.partband h2`, **and every eyebrow** |

There is no 300 and no 900. Inter is loaded at exactly 400/500/600/700/800 and
JetBrains Mono at 400/500/700 — the CSS uses no weight the font request does not
cover, which is worth preserving when you re-skin.

### 2.4 Letter-spacing — tracking is a function of size

The rule: **the bigger the type, the tighter the tracking; the smaller and more
label-like, the looser.** Concretely:

| Size context | `letter-spacing` |
|---|---|
| `--t-h1` (`.hero h1`) | `-0.035em` |
| `--t-h2` (`.unithead h1`, `.pagetitle`, `.prose h1`) | `-0.035em` |
| `--t-h3` (`.partband h2`) | `-0.03em` |
| `--t-h3` (`.prose h2`, `.section-head h2`) | `-0.028em` / `-0.025em` |
| `--t-h3` (`.stat .n`) | `-0.03em` |
| `--t-lede` (`.prose h3`) | `-0.02em` |
| `--t-body` (`.unitcard h3`) | `-0.02em` |
| `--t-sm` (`.brand`, `.sect > summary h3`, `.pagenav .t`) | `-0.02em` |
| `--t-sm` (`.rail a.h2`) | `-0.015em` |
| `.btn` | `-0.01em` |
| `.unitcard .num` (mono) | `+0.02em` |
| `.codeblock .cb-head` (uppercase) | `+0.04em` |
| **all eyebrows** (uppercase micro) | `+0.07em` |
| `.chip.mono` | `0` — an explicit reset, because a mono chip must not inherit tracking |

So the range runs `-0.035em` at 60px through `0` at mono through `+0.07em` at
10.5px uppercase. That monotone relationship is the discipline.

**The eyebrow rule (lines 380–392)** is the single most reusable idea here. One
selector list defines the small-caps label once:

```css
.eyebrow, .callout .ct, .memory .mt, .diag .why .lbl, .stdout .lbl,
.hintbox .lbl, .afterbox .lbl, .qcard .why .lbl {
  font-size: var(--t-micro);
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.eyebrow { color: var(--ink-3); }
```

The comment records why: seven components had each spelled the four
declarations out and the weight and tracking had already drifted, so the app was
shipping two subtly different label styles. **Only colour and spacing vary per
use now.** Any new label-like component joins that selector list rather than
restating the declarations.

### 2.5 Line heights

| Value | Where | Why |
|---|---|---|
| `1.02` | `.hero h1` | display type, near-solid |
| `1.06` | `.unithead h1`, `.pagetitle` | display |
| `1.08` | `.prose h1` | display |
| `1.1` | `.stat .n` | numeral |
| `1.25` | `.unitcard h3` | card title |
| `1.3` | `.sect > summary h3` | row title |
| `1.45` | `.hero p.lede` | lede |
| `1.5` | `.unitcard p`, `.rail a`, `.prose p.lede` (1.5) | secondary text |
| `1.55` | `body` | UI default |
| `1.6` | `.callout` | inside a boxed body |
| `1.62` | `.codeblock pre` | code needs more than prose UI, less than prose |
| `1.68` | `.prose` | **the reading line-height** |

The ladder is consistent: display 1.02–1.1, titles 1.25–1.3, UI 1.5–1.55, code
1.62, reading prose 1.68.

### 2.6 The measure

`--measure: 72ch`, applied only at `.prose { max-width: var(--measure) }`.
`.readercol` caps at `840px` and `.prose` caps again at 72ch inside it, so on a
wide screen the prose is measure-bound and on a narrow one it is column-bound.
`.hero p.lede` uses its own `max-width: 62ch` — a lede is shorter than a
paragraph.

### 2.7 The four-ink discipline — which ink where

This is the rule that makes the design cohere. There are exactly four inks and
each has one job.

**`--ink` (ink 1)** — anything the reader is actually reading, and the *hover*
state of a control.
- `body` colour, so it is the default
- `.prose` body text
- `.nav a:hover`, `.nav a.on`
- `.ghlink:hover`, `.iconbtn:hover`, `.llms:hover`
- `.rail a:hover`, collapsed-rail tooltip text
- `.btn.quiet` label (`--btn-fg: var(--ink)`), `.btn.ghost:hover`

**`--ink-2` (ink 2)** — supporting prose and the *resting* state of an
interactive control.
- `.nav a` at rest, `.iconbtn`, `.llms` at rest, `.btn.ghost` at rest
- `.hero p.lede`, `.prose p.lede`, `.prose blockquote`
- `.unitcard p` — card descriptions
- `.rail a.h2` — top-level contents entries
- `.chip` label
- `.ring::after` numeral

**`--ink-3` (ink 3)** — labels, meta, captions. Text *about* the content.
- `.eyebrow`
- `.readerbar .title`
- `.rail a` at rest (contents entries are meta until you are on one)
- `.stat .l`, `.section-head .more`, `.pagenav .lbl`
- `.crumbs .now`, `.codeblock .cb-head`
- `.ghlink` / `.iconbtn` icon glyph at rest
- `.loading`
- `.t-attr` (syntax: attributes are meta)

**`--ink-4` (ink 4)** — the quietest: separators, placeholders, disabled,
non-semantic ornament. Reads as texture, not as text.
- `.searchbox input::placeholder`, `.searchbox svg` icon
- `.crumbs .sep`
- `.prose li::marker`
- `.sect .caret` at rest, `.sect .n`
- `.mins` (the minute captions in the contents)
- `.railtoggle`
- `.unitcard.stub::before` (a stub unit's accent bar drops to ink-4)
- `.t-cmt` (syntax: **comments are ink-4** — deliberately, so code comments
  recede the same way UI ornament does)

**And the accent replaces ink entirely for state.** `.rail a.on`,
`.prose a:not(.chip)`, `.callout .ct`, `.unitcard .num`, `.sect > summary:hover
.caret` — an element that is *active, linked, or owned by a unit* takes
`var(--accent)`, never a darker ink. That is the whole colour system: four greys
for hierarchy, one accent for state.

---

## 3. Layout and every screen

### 3.0 The page shell (`index.html`)

```
<header class="topbar">      sticky, z-60, 56px
<main id="app">              the only thing a route replaces
<nav class="tabbar">         fixed bottom, z-70, ≤900px only
<div class="sheet-scrim">    fixed inset:0, z-80, [hidden] by default
<div class="sheet">          fixed bottom, z-90, [hidden] by default
<footer class="site">
```

The companion (`.companion`) is z-300 and the glossary popover (`.pop`) z-200,
so both float above sheet and scrim. The full z ladder:
`50` readerbar · `60` topbar · `70` tabbar · `80` scrim · `90` sheet ·
`200` popover · `300` companion. Nothing else in the file sets z-index except
`.readerlayout[data-rail="collapsed"] .rail a:hover::after` at `40` and
`.editor.passed::before` at `2`.

Two container widths only: `.wrap` (1180px, 20px padding) and `.wrap.wide`
(1330px) which is used **only** by the reader and project-overview routes.

### 3.1 The header — `.topbar`

`position: sticky; top: 0; z-index: 60; height: 56px; display: flex;
align-items: center; gap: 8px; padding: 0 16px;`

Ground: `color-mix(in srgb, var(--bg) 88%, transparent)` +
`backdrop-filter: saturate(160%) blur(12px)`, `border-bottom: 1px solid
var(--border-soft)`. The colour-mix is what makes the blur visible — an opaque
bar has nothing to blur.

Flex order: `.brand` (flex:none) · `.nav` (flex row, gap 2px) ·
`.spacer` (flex:1) · `.llms` pill · `.ghlink` · `.searchbox` · `.iconbtn#theme`.

`.searchbox input` is 208px, growing to 280px on focus via
`transition: width 0.16s`. Below 620px it becomes
`flex: 1 1 auto; min-width: 0; max-width: 190px` with `width: 100%` — the
comment records why: an input's intrinsic min-width stops flex shrinking it, so
a fixed width pushed the theme button off a 320px screen.

### 3.2 Home — `#/`

`.wrap` → `.hero` → `.statgrid` → repeated `.section-head` + `.unitgrid`.

- `.hero`: `display: grid; grid-template-columns: 1fr auto; gap: 32px;
  align-items: center; padding: 56px 0 34px`. At ≤760px it becomes `1fr`,
  padding `34px 0 24px`, and `.heroart { display: none }` — the mascot is the
  first thing cut.
- `.statgrid`: `repeat(auto-fit, minmax(150px, 1fr))`, gap 10px. `auto-fit`,
  not `auto-fill` — a short row of stats stretches to fill. At ≤760px it is
  hard-set to `repeat(2, 1fr)`.
- `.unitgrid`: `repeat(auto-fill, minmax(300px, 1fr))`, gap 12px. `auto-fill`
  here, so a single card does not stretch to 1180px. At ≤760px → `1fr`.
- `.section-head`: flex, `align-items: baseline`, gap 12px,
  `margin: 40px 0 16px`, `padding-bottom: 10px`, bottom hairline. `.more` is
  pushed right with `margin-left: auto`.

Cards carry `class="card unitcard stagger" style="--i:N"` and
`data-accent="<name>"`, which is where the per-card accent enters.

### 3.3 The track — `#/track`

`.wrap` with inline `padding-top:26px`, `.crumbs`, `h1.pagetitle`, an intro `p`
at `max-width:70ch`, then the same `.unitgrid`. No rail, no sticky chrome.

### 3.4 Projects — `#/projects`, `#/project/<slug>`

`#/projects` is the track layout plus a `.pill` filter row and three
`.section-head` + `.unitgrid` groups (mini / core / deep tiers).

`#/project/<slug>` (app.js:356) uses `<div class="wrap wide"
data-accent="…"><div class="readerlayout">` — **the same reader layout as a
unit, with the rail**, but no `.readerbar`. That is why `wireUnit()` guards each
block separately: the project overview renders the rail and needs it wired.

### 3.5 The reader — `#/unit/<slug>` and `#/unit/<slug>/<heading>`

The most structured screen. Outer `<div data-accent="…">` scopes the accent to
the whole route.

```
<div data-accent="…">
  <div class="readerbar"><div class="inner">
      <a class="btn ghost sm back">  ← The track
      <span class="title" style="flex:1">
      <button class="btn quiet sm" id="expandall">
      <button class="btn quiet sm" id="opensheet">
      <button class="btn quiet sm toggle desk-only" data-toggle="hide-terms">
      <a class="btn sm" href="#/work/…">Workbench
      <div class="progress" id="prog">
  </div></div>
  <div class="wrap wide"><div class="readerlayout" data-rail="open|collapsed">
      <aside class="rail">…</aside>
      <div class="readercol">
        <header class="unithead">…
        <div class="prose">lead
        (<div class="partband"> + <details class="sect">)×n
        <div class="dashed">   the "now earn it" CTA
        <nav class="pagenav">
      </div>
  </div></div>
</div>
```

**`.readerbar`** — the second sticky bar. `position: sticky; top: 56px;
z-index: 50`, same colour-mix trick at `92%` (slightly more opaque than the
topbar, because it sits on top of it visually). `.inner` is
`max-width: 1180px; margin: 0 auto; padding: 8px 20px` — matching `.wrap` so
the controls line up with the page even though the reader frame is 1330px wide.
`.inner` is `position: relative` purely to host the progress bar.

**`.readerbar .progress`** — `position: absolute; left:0; right:0; bottom:-1px;
height: 2px; background: var(--accent); transform: scaleX(0);
transform-origin: left; will-change: transform`. `bottom: -1px` puts it *on*
the border, not above it. JS sets `style.transform = scaleX(ratio)` — no
transition declared, so it tracks scroll frame-for-frame.

**`.readerlayout`** —
`display: grid; grid-template-columns: var(--rail) minmax(0, 1fr); gap: 44px;
padding: 26px 0 60px; align-items: start;` and, critically,
`transition: grid-template-columns var(--med) var(--ease), gap var(--med) var(--ease)`
— the rail collapse is an animated grid-track change.

`minmax(0, 1fr)` on the content column, not `1fr`: a `1fr` track has
`min-width: auto`, so one wide `<pre>` would blow the grid out sideways.

**`.readercol`** — `max-width: 840px; margin: 0 auto; width: 100%`. The rail
sits hard left in a 1330px frame; centring the column in the remaining space is
what stops the prose hugging the rail with a dead gutter on the right.

**`.rail`** — `position: sticky; top: 96px; max-height: calc(100vh - 120px);
display: flex; flex-direction: column`. 96 = 56 topbar + 40 readerbar.

Rail internals:

- `.railhead` — `flex; gap: 6px; padding: 0 4px 8px 0; flex: none`. Holds
  `.eyebrow` (flex:1, nowrap, overflow hidden) and `.railtoggle` (24×24).
- `.railscroll` — `position: relative; overflow-y: auto;
  overscroll-behavior: contain; scrollbar-width: thin;
  padding: 2px 8px 14px 0`, plus a fade mask:
  `mask-image: linear-gradient(to bottom, transparent, #000 12px, #000 calc(100% - 18px), transparent)`.
  Custom webkit scrollbar at 5px wide. **The spine and the list share this one
  positioning origin**, which is what keeps every dot centred on the line at any
  zoom.
- `.railtrack` — `position: absolute; left: 7px; top: 4px; bottom: 10px;
  width: 2px; border-radius: 2px; background: var(--border-soft)`.
- `.railfill` — inside the track, `position: absolute; left:0; top:0;
  width:100%; height:100%; background: var(--accent); transform: scaleY(0);
  transform-origin: top; will-change: transform`. JS writes
  `scaleY(ratio)` from the same scroll watcher that drives `.readerbar
  .progress`.
- `.rail a` — `display: flex; align-items: baseline; gap: 8px;
  padding: 6px 9px 6px 22px` (the 22px left inset is what clears the spine),
  `font-size: var(--t-tiny)`.
- **The dots** are `.rail a::before`: `position: absolute; left: 4px;
  top: 0.78em; width/height: 8px; border-radius: 50%; background: var(--bg);
  box-shadow: inset 0 0 0 1.5px var(--border)` — hollow, drawn as a ring by an
  inset shadow rather than a border so the geometry never changes.
  `left: 4px` + `width: 8px` centres the 8px dot on the 2px track at `left: 7px`
  (4+4 = 8; 7+1 = 8). **That arithmetic must hold if you change either number.**
  `top: 0.78em` aligns to the first text baseline.
  - `.read` → `background: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent)` (filled)
  - `.on` → filled plus `0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)` halo and `transform: scale(1.15)`
  - `.h3` dots shrink to 6px and shift to `left: 5px` (5+3 = 8 — the centre is preserved)
- `.rail a.h2` — 700, `--t-sm`, `margin-top: 12px`, `letter-spacing: -0.015em`.
  `.rail a.h3` — `padding-left: 34px`.
- `.mins` — `margin-left: auto; flex: none; --t-micro; color: var(--ink-4);
  font-variant-numeric: tabular-nums`. Shared with the sheet; `.rail .mins`
  adds only `padding-left: 6px; opacity: 0.75`.

**The collapsed rail** — `[data-rail="collapsed"]`, written as
`.readerlayout:where([data-rail="collapsed"])` for the grid rule specifically.
`:where()` drops it to one class of weight so the 1060px one-column rule beats
it on source order without having to name the attribute. Grid becomes
`26px minmax(0, 1fr)`, gap 30px. Links go to `height: 0; overflow: hidden;
color: transparent` — **the dots survive because they are absolutely
positioned**, so you keep the map and lose only the words. Hovering a collapsed
dot shows `content: attr(data-title)` in a `::after` tooltip at
`left: 22px; top: -4px; z-index: 40`.

**`.sect`** — each section is a native `<details>`:

```html
<details class="sect" id="…" open data-mins="8">
  <summary><span class="caret">▸</span><span class="n">01</span><h3>…</h3><span class="chip">8m</span></summary>
  <div class="body"><div class="prose">…</div></div>
</details>
```

`overflow: hidden`, `scroll-margin-top: 116px` (matching
`html { scroll-padding-top }`). `summary` has `list-style: none` and
`::-webkit-details-marker { display: none }` — the caret is a real span rotated
90°/-90°. `.sect .body` gets `border-top: 1px solid var(--border-soft)` so the
rule only exists when open.

**`.prose`** — `font-size: var(--t-read); line-height: 1.68;
max-width: var(--measure); color: var(--ink)`. Flow spacing is
`.prose > * + * { margin-top: 1.05em }`, and a second rule gives five boxed
components (`.callout`, `.wbbrief`, `.diag .why`, `.afterbox`, `.qcard .why`)
`margin-top: 0.75em` for their own children — one selector list, because the
same `render()` in `build.py` fills all five.

### 3.6 The workbench — `#/work/<slug>/<n>` and `#/project/<slug>/<n>`

```html
<div class="wrap" data-accent="…">
  <div class="wblayout">
    <aside>
      <div class="eyebrow">Unit title · 3/7</div>
      <nav class="exlist"><a class="on passed"><span class="st">✓</span><span class="nm">…</span></a>…</nav>
      <div>… .btn.quiet.sm back / drills …</div>
    </aside>
    <div class="wb">
      <nav class="crumbs">
      <div class="wbhead"><h1><div class="meta">chips</div></div>
      <div class="wbbrief">
      <div class="editor" id="ed">        ← mounted by workbench.js
      <div class="runbar" id="runbar" hidden>
      <div class="wbbar">                 ← run / hint / reset / wrap / vim
      <div id="hints">                    ← .hintbox stack
      <div class="out" id="out">          ← .verdict, .diag, .testrow, .stdout
      <div id="after">                    ← .afterbox
      <nav class="pagenav">
    </div>
  </div>
</div>
```

`.wblayout` = `grid; grid-template-columns: 236px minmax(0, 1fr); gap: 36px;
padding: 22px 0 60px; align-items: start`. Note the rail here is **236px**, not
`--rail` (288px) — a different, narrower sidebar with its own literal.

`.wblayout > aside` is what sticks, not `.exlist`: `position: sticky;
top: 116px; max-height: calc(100vh - 136px); overflow-y: auto`. The comment
records the bug — sticking only `.exlist` left the two buttons below it in
normal flow, scrolling up and sliding underneath the pinned list.

`.wb` itself is `flex; flex-direction: column; gap: 14px; min-width: 0` — the
`min-width: 0` is the second half of the `minmax(0, 1fr)` defence.

#### The editor: the transparent-textarea-over-highlighted-pre trick

DOM (`workbench.js:253-258`):

```html
<div class="editor" id="ed">
  <div class="gutter"><div class="gl">1</div>…</div>
  <div class="stack">
    <pre class="hl" aria-hidden="true">…coloured spans…</pre>
    <textarea spellcheck="false" autocapitalize="off" autocomplete="off"
              autocorrect="off" wrap="off" aria-label="Rust source"></textarea>
  </div>
  <div class="vimbadge" hidden></div>
</div>
```

The `<pre>` paints every glyph; the `<textarea>` owns the caret and the
selection and is `color: transparent`.

**Every metric that must match between the two layers.** These are declared
**once, on a shared selector**, which is the only safe way to do it:

```css
.editor {                      /* the container owns the inherited metrics */
  font-family: var(--mono);
  font-size: var(--t-sm);
  line-height: 1.62;
}
.editor pre.hl,
.editor textarea {             /* the shared rule — both layers, one place */
  margin: 0;
  padding: 12px 14px;
  border: 0;
  font: inherit;               /* family, size, weight, style, stretch */
  line-height: inherit;
  letter-spacing: normal;      /* explicit reset: must not inherit tracking */
  tab-size: 4;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
}
```

The full checklist of metrics that will cause drift if they differ:

| Metric | Value | Why it drifts |
|---|---|---|
| `font-family` | `var(--mono)` via `font: inherit` | different advance widths → columns diverge |
| `font-size` | `--t-sm` (16px on phones) via `font: inherit` | every column offset scales |
| `font-weight` / `font-style` | inherited by `font: inherit` | bold glyphs are wider in some monos |
| `font-variant-ligatures` | `none`, set globally on `pre` | a ligature collapses two cells into one |
| `line-height` | `1.62` (`1.55` on phones), `inherit` on both | rows diverge cumulatively down the file |
| `padding` | `12px 14px` (`11px 12px` on phones) | a constant x/y offset between layers |
| `margin` | `0` | UA gives `<pre>` a default margin; must be killed |
| `border` | `0` | a border shifts the content box |
| `letter-spacing` | `normal` | inherited tracking would shift every column |
| `tab-size` | `4` | a tab renders at a different width in each layer |
| `white-space` | `pre` / `pre-wrap` in softwrap — **both layers together** | different folding = different line count |
| `overflow-wrap` / `word-break` | `normal` / `anywhere` in softwrap — **both together** | different break points |
| **width** | `ta.style.width = pre.scrollWidth + 'px'` in JS | the one metric CSS cannot settle: a textarea cannot size to its content, so JS measures the `<pre>` and matches |

Positioning: `.editor .stack { position: relative; overflow: auto }` is the
single scroll container — **both layers scroll together because only the stack
scrolls.** `.editor textarea { position: absolute; inset: 0; width: 100%;
height: 100%; overflow: hidden }` (its own overflow off, so it cannot scroll
independently) and `.editor pre.hl { pointer-events: none; min-height: 100% }`
(clicks fall through to the textarea).

Colour: `background: transparent; color: transparent;
caret-color: var(--ferris)` — note the caret is hard-bound to `--ferris`, not
`--accent`, so it is the same colour on every unit. `textarea::selection
{ background: var(--mark) }`.

Softwrap (`.editor.softwrap`) changes four things at once and all four are
required: `pre.hl` and `textarea` both get `white-space: pre-wrap;
overflow-wrap: anywhere`; the grid drops to `minmax(0, 1fr)`; the gutter is
`display: none` (a number per logical line stops lining up the moment a line
takes two rows); `.stack` gets `overflow-x: hidden`. The comment warns: not
`.wrap` as the class name — that is the page container and carries padding.

`.editor .gutter` — `text-align: right; user-select: none;
font-variant-numeric: tabular-nums; white-space: pre;
background: color-mix(in srgb, var(--ink) 3.5%, var(--code-bg))`. Its padding
is `12px 10px 12px 14px` — the *vertical* 12px matches the layers, the
horizontal does not need to. `.gl.err` → `var(--bad)` 700. `.gl.cur` (vim
relativenumber's anchor line) → `var(--accent)` 700, `text-align: left`.

Vim states are attribute-driven on the container:
`[data-vim="vim-normal"]` (caret transparent, `::selection` becomes a solid
`var(--accent)` block with `color: var(--code-bg)` — the block cursor),
`[data-vim="vim-visual"]` (`::selection` 34% accent), `[data-vim="vim-insert"]`
(caret `--ferris`). `.vimbadge` is absolutely positioned `right: 8px;
bottom: 6px`, 10px mono 700, and recolours by mode: accent / `--ok` insert /
`--warn` visual.

At ≤1040px `.wblayout` goes single-column, `> aside` goes `position: static`,
and `.exlist` flips to `flex-direction: row; overflow-x: auto` — the sidebar
becomes a horizontal strip.

### 3.7 Drills — `#/drills/<slug>`

A stack of `.qcard`s. Each: `.qtop` (`.qn` mono number + optional chip),
`.stem`, `.opts` (flex column, gap 6px, of `button.opt` with a mono `.k` key
letter), and a `.why` panel that is `hidden` until answered. States are added by
JS: `.picked` on click, then `.done` on the card and `.right` / `.wrong` on the
options.

### 3.8 Progress — `#/progress`

`.wrap` capped to an inline `max-width: 900px`. `.statgrid` of four, then per
unit a `.section-head` carrying its own `data-accent` and a `.heat` grid:
`repeat(auto-fill, minmax(15px, 1fr))`, gap 3px, `max-width: 420px`, cells
`aspect-ratio: 1; border-radius: 2px`, `.on` filling with `var(--accent)`.
Each cell is wrapped in an `<a>` to its exercise.

### 3.9 Glossary — `#/glossary`

Letter row `.letters` (flex wrap, 30×30 buttons, gap 3px), then `.gridcards`:
`repeat(auto-fill, minmax(280px, 1fr))`, gap 10px, of `.gcard`. A second
`.searchbox` is reused here with inline overrides (`display:block;
max-width:340px`, input `width:100%; padding-left:12px`) — the same component,
re-purposed.

### 3.10 Search — `#/search?q=`

`.wrap` at inline `max-width: 820px`. Results live inside a single
`.card` with inline `padding: 0; overflow: hidden`, so the `.hit` rows'
`border-bottom: 1px solid var(--border-soft)` reads as a divided list inside one
object. Matches are wrapped in `<mark>` which uses `var(--mark)`.

### 3.11 The bottom sheet

Two fixed elements, both `[hidden]` until opened, both rendered in `index.html`
and reused by every route.

```html
<div class="sheet-scrim" id="scrim" hidden></div>
<div class="sheet" id="sheet" hidden role="dialog" aria-modal="true" aria-label="Contents">
  <div class="sheet-grip"></div>
  <div class="sheet-head"><span class="eyebrow">In this unit</span><button class="iconbtn">✕</button></div>
  <div class="sheet-body" id="sheetbody"></div>
</div>
```

- `.sheet-scrim` — `fixed; inset: 0; z-index: 80; background: rgb(0 0 0 / 0.42);
  backdrop-filter: blur(2px)`, `animation: fadein 0.22s var(--ease)`.
- `.sheet` — `fixed; left:0; right:0; bottom:0; z-index: 90; max-height: 74vh;
  flex column; background: var(--surface); border-top: 1px solid var(--border);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: 0 -8px 30px var(--shadow)` (negative y — light from below is
  wrong, so this reads as the sheet lifting off the page),
  `animation: sheetup 0.3s var(--ease)`.
- `.sheet-grip` — the iOS pull handle: `36×4px`, `border-radius: 999px`,
  `background: var(--border)`, `margin: 8px auto 4px`.
- `.sheet-body` — `overflow-y: auto; overscroll-behavior: contain` (without
  which a flick past the end scrolls the page underneath and you close the
  sheet onto somewhere else), padding
  `10px 12px calc(18px + env(safe-area-inset-bottom))`.
- `body.sheetopen { overflow-y: hidden }` — set by JS, the page behind a modal
  does not scroll.

**The sheet renders the same markup as the rail but styles it completely
differently**, and the comments say why: the desktop rail's dots and track are
its own; repeating them at 375px made a column of decoration with the words
squeezed beside it. So:

- `.sheet-body a` — `flex; align-items: baseline; gap: 10px; padding: 11px 10px;
  min-height: 44px; --t-sm; color: var(--ink-2); line-height: 1.4`. No `::before`
  dot at all.
- Hierarchy moves into type: `a.h2` → 700 + `var(--ink)`; `a.h3` →
  `padding-left: 26px`, `--t-tiny`, `var(--ink-3)`.
- Read-but-not-current: `.sheet-body a.read:not(.on) { opacity: 0.6 }` —
  **opacity, not colour**, because colour is already carrying heading level and
  a faded h2 in a colour channel would invert the hierarchy against an h3.
- Current: `a.on { background: color-mix(in srgb, var(--accent) 12%,
  transparent); color: var(--accent) }` — **and deliberately no font-weight**,
  because weight is the heading level and 600 made the current h2 lighter than
  every h2 above it.

That pair of comments is the clearest statement of the whole system's rule:
each visual channel (weight, colour, opacity, tint) carries exactly one meaning,
and a state must use a channel that is still free.

### 3.12 The mobile tab bar

`.tabbar { display: none }` at every width, then turned on inside
`@media (max-width: 900px)`:

```css
position: fixed; left: 0; right: 0; bottom: 0; z-index: 70;
display: flex;
background: color-mix(in srgb, var(--bg) 94%, transparent);
backdrop-filter: saturate(160%) blur(14px);
border-top: 1px solid var(--border-soft);
padding-bottom: env(safe-area-inset-bottom);
```

Items are `flex: 1` columns, icon over a 10px 600 label, `color: var(--ink-3)`,
`.on` → `var(--accent)`. `-webkit-tap-highlight-color: transparent` and
`a:active svg { transform: scale(0.88) }` for the press.

Inside the same block: `body { padding-bottom: calc(58px +
env(safe-area-inset-bottom)) }` reserves the space, and
`.desk-only { display: none !important }` hides the vim toggle, the terms
toggle and the keyboard hints.

### 3.13 Footer

`footer.site` — top hairline, `margin-top: 40px; padding: 20px 0 34px;
font-size: var(--t-micro); color: var(--ink-3)`. `.wrap` inside is
`flex; gap: 8px; align-items: center; flex-wrap: wrap` with a `.spacer` to push
the last item right. `padding-bottom` drops to 20px at ≤900px because the tab
bar already reserves space.

---

## 4. Responsive

Seven breakpoints in total, and **every one is a `max-width` except one**.
Listed in source order, which matters (see 4.7):

| # | Query | Line | What changes |
|---|---|---|---|
| 1 | `(prefers-reduced-motion: reduce)` | 121 | `scroll-behavior: auto`; `* { transition: none !important; animation: none !important }` |
| 2 | `(max-width: 900px)` | 223 | `.nav { display: none }` |
| 3 | `(max-width: 620px)` | 261 | `.searchbox` becomes fluid |
| 4 | `(max-width: 900px)` | 318 | `.llms .lbl` hidden, padding tightens |
| 5 | `(max-width: 620px)` | 319 | `.llms { display: none }` |
| 6 | `(max-width: 760px)` | 457 | `.hero` → one column, `.heroart` gone |
| 7 | `(max-width: 760px)` | 577 | `.readerbar .title { display: none }` |
| 8 | `(max-width: 1060px)` | 794 | **the rail-to-sheet transition** |
| 9 | `(prefers-reduced-motion: reduce)` | 799 | `will-change: auto` on the two scroll-driven bars |
| 10 | `(max-width: 1040px)` | 1022 | `.wblayout` → one column |
| 11 | `(max-width: 1040px)` | 1037 | `> aside` unsticks, `.exlist` goes horizontal |
| 12 | `(max-width: 900px)` | 1559 | **the nav-to-tab-bar transition** |
| 13 | `(min-width: 1061px)` | 1585 | `#opensheet { display: none !important }` |
| 14 | `(max-width: 760px)` | 1591 | the big phone block |
| 15 | `(max-width: 760px), (pointer: coarse)` | 1690 | touch targets |
| 16 | `(max-width: 420px)` | 1701 | `.hero h1` refit, `#expandall` label dropped |
| 17 | `(max-width: 900px)` | 1786 | `.companion { bottom: 68px }` |
| 18 | `(max-width: 900px)` | 1827 | `footer.site { padding-bottom: 20px }` |

So the real ladder is **1060 / 1040 / 900 / 760 / 620 / 420**, plus the
`pointer: coarse` orthogonal axis and `prefers-reduced-motion`.

### 4.1 `overflow-x: clip` vs `hidden` — confirmed and explained

```css
html, body { overflow-x: clip; max-width: 100%; }
```

`overflow-x: hidden` on `html`/`body` makes the body a **scroll container**.
Any `position: sticky` descendant sticks relative to its nearest scrolling
ancestor, so every sticky element in the app — the topbar, the reader bar, the
rail, the workbench aside — would stick to the body box instead of the viewport,
which means it never sticks at all. The comment records the exact symptom: "the
contents rail scrolled away with the prose."

`overflow-x: clip` clips the overflow identically **without establishing a
scroll container**, so sticky keeps working. This is the single most important
line in the file.

The consequence is that nothing can be scrolled sideways at the page level, so
**everything that genuinely overflows must carry its own `overflow-x: auto`**.
The complete list in this stylesheet:

| Selector | Property |
|---|---|
| `.prose table` | `display: block; overflow-x: auto` (a `<table>` cannot scroll without `display: block`) |
| `.codeblock pre` | `overflow-x: auto` |
| `.memory` | `overflow-x: auto` |
| `.editor .stack` | `overflow: auto` |
| `.diag .snip` | `overflow-x: auto` |
| `.diag .raw pre` | `overflow-x: auto` |
| `.stdout pre` | `overflow-x: auto` |
| `.railscroll` | `overflow-y: auto` (+ `overscroll-behavior: contain`) |
| `.wblayout > aside` | `overflow-y: auto` |
| `.sheet-body` | `overflow-y: auto` (+ `overscroll-behavior: contain`) |
| `.exlist` (≤1040px) | `overflow-x: auto` |

The one thing `clip` cannot help with is *inline* content: at ≤760px,
`.prose :not(pre) > code` has to give up its `white-space: nowrap` for
`white-space: normal; overflow-wrap: anywhere`, because a literal wider than the
screen would be clipped rather than scrolled to — "that literal is not scrolled
to, it is gone."

### 4.2 The editor's 16px minimum

```css
@media (max-width: 760px) {
  .editor { font-size: 16px; line-height: 1.55; }
  .editor .gutter { padding: 11px 8px 11px 11px; }
  .editor pre.hl, .editor textarea { padding: 11px 12px; }
}
```

**iOS Safari zooms the viewport when a form control smaller than 16px receives
focus, and it does not zoom back out.** `--t-sm` bottoms out at 13.5px, which
would trigger it. So the editor is the one place in the app that hard-codes a
font size, and it must be `16px` literally, not `--t-body` (which bottoms out at
15px). Note that the fix has to change *three* rules together — size,
line-height and both layers' padding — or the two editor layers drift on phones
exactly as they would from any other mismatch.

`<meta name="viewport" content="width=device-width, initial-scale=1">` alone
does not prevent this; only `user-scalable=no` would, and that breaks pinch
zoom for everyone. 16px is the correct fix.

### 4.3 The 1060px rail-to-sheet transition

```css
@media (max-width: 1060px) {
  .readerlayout { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .rail { display: none; }
}
```

Below 1060 the reader is one column and the contents move into the bottom
sheet. 1060 ≈ 288 (rail) + 44 (gap) + a usable reading column + gutters; below
that the rail starts stealing from the measure.

The `#opensheet` button then has to appear at **exactly** the width the rail
disappears, which is why it uses the only `min-width` query in the file:

```css
@media (min-width: 1061px) { #opensheet { display: none !important; } }
```

The comment records the bug this fixed: the Contents button originally shared
the tab bar's 901px breakpoint, which left **everything between 901px and
1060px with no rail and no button — a unit page with no contents at all**. A
substitute control must be keyed to the breakpoint of the thing it substitutes
for, not to the nearest convenient one.

### 4.4 The 900px nav-to-tab-bar transition

Two halves, 1329 lines apart:

- line 223: `@media (max-width: 900px) { .nav { display: none } }`
- line 1552: `@media (max-width: 900px) { .tabbar { … display: flex … } }`

900px is where a horizontal nav row at the *top* of the screen stops being
reachable by a thumb. The rationale in `BUILD-YOUR-OWN.md`: "a navigation row at
the top of a phone is a row nobody can reach." The tab bar is `position: fixed`
at the bottom with `env(safe-area-inset-bottom)` padding, and `body` gains
`padding-bottom: calc(58px + env(safe-area-inset-bottom))` in the same block so
the footer is never under it.

The `.llms` pill also uses 900px (label off) then 620px (gone entirely) —
a two-stage degradation rather than a single cut.

### 4.5 Touch targets, keyed on pointer not width

```css
@media (max-width: 760px), (pointer: coarse) { … }
```

The `(pointer: coarse)` half is what catches a 1024px tablet in landscape,
which is a wide screen operated by a thumb; the `max-width` half catches a
narrow desktop window, which is not. Four sizes, each with a stated argument:

| Size | What | Why |
|---|---|---|
| 44px | `.btn`, `.exlist a` | the standard, where there is room |
| 40px | `.btn.sm`, `.iconbtn`, `.ghlink`, `.pill` | the two sticky bars — a 44px button row under a 56px topbar is a fifth of a phone given to chrome before a word is read |
| 38px | `.letters button` | 26 letters wrap to four rows at 44 |
| 36px | `a.chip` | chips sit in running text and cannot grow without opening gaps between the lines around them |

`.pill` needs `display: inline-flex; align-items: center` first, because an
inline `<a>` ignores `min-height`.

### 4.6 The 420px block

```css
@media (max-width: 420px) {
  .hero h1 { font-size: clamp(28px, 8.5vw, 38px); }
  .readerbar #expandall span { display: none; }
  .readerbar .inner { padding: 7px 12px; }
}
```

This is the **only font-size inside a media query** in the whole stylesheet, and
it is a deliberate exception: `--t-h1`'s floor of 32px is still too big at
320px. Note it is still a `clamp()`, so it stays fluid within the exception.

The `#expandall` label drop is the second stage of the same trade the back
arrow made at 760px (`.readerbar .back span { display: none }`) — labels go one
at a time, icon-first, and each keeps its `title` and `aria-label`.

### 4.7 Where source order matters

A media query adds **no specificity**. Every one of these depends on sitting
after the rules it overrides:

1. **The 1060px block (line 794)** is placed after the entire `.rail` and
   collapsed-rail section, and the comment spells out both failures: an earlier
   `.rail { display: none }` loses on source order to the later
   `.rail { display: flex }`, so *the rail came back on a phone, sticky, on top
   of the prose*; and `.readerlayout[data-rail="collapsed"]` is an attribute
   selector that outranks a plain `.readerlayout` **wherever it sits**, which is
   why that one rule is written as `:where([data-rail="collapsed"])` — dropping
   it to a single class of weight so the later, plainer media rule can win.
2. **The 1040px workbench block** sits immediately after `.wblayout` and
   `.exlist`, then a second copy after `.wblayout > aside` — the block is split
   in two purely to stay after each rule it overrides.
3. **The 760px phone block (line 1591)** sits near the end of the file, after
   every component it touches.
4. **The touch-target block (1690)** sits after the phone block, so its
   `min-height: 44px` on `.btn` wins over the phone block's `.readerbar .btn
   { padding: 7px 10px }` where they collide.
5. **`#opensheet`** uses `!important` rather than relying on order, because it
   is fighting `.btn`'s `display: inline-flex`.
6. **`[hidden] { display: none !important }`** at line 112 exists for the same
   reason: `[hidden]` is a bare attribute selector in the UA sheet, so any class
   rule setting `display` outranks it. The comment records the cost of learning
   that — "a transparent scrim at inset:0 that sat over an entire phone UI
   swallowing taps while looking fine."

---

## 5. Motion

### 5.1 The rules

One easing token for everything: `--ease: cubic-bezier(0.22, 0.9, 0.28, 1)`.
Sharp out, soft in. The comment: "so the whole interface feels like it was
built by one person." Three exceptions exist and each is justified below.

Two duration tokens: `--fast: 0.14s` (hover state on chrome) and
`--med: 0.26s` (transform, layout, elevation). Everything else names a literal
duration because it is a one-shot animation, not a state change.

**Every transition names its properties. `transition: all` appears nowhere in
the file.** That is a hard rule worth carrying over.

### 5.2 Every transition, by trigger

| Selector | Properties | Duration / easing | Trigger |
|---|---|---|---|
| `.nav a` | `background, color` | `0.12s` (literal) | hover / `.on` |
| `.searchbox input` | `width, border-color` | `0.16s / 0.12s` | focus |
| `.ghlink, .iconbtn` | `background, color` | `var(--fast)` | hover |
| `.llms` | `background, border-color, color` | `var(--fast)` | hover / `.copied` |
| `.llms .av` | `transform` / `border-color` | `var(--med) var(--ease)` / `var(--fast)` | hover — the three marks fan apart ±2px |
| `.btn` | `transform, box-shadow` | `0.07s` | `:active` |
| `.btn` | `background` | `0.12s` | hover |
| `.card` | `border-color` | `var(--med)` | hover |
| `a.card` | `transform, box-shadow` | `var(--med) var(--ease)` | hover → `translateY(-2px)` + `0 5px 16px var(--shadow)` |
| `a.card:active` | (same, `transition-duration: var(--fast)`) | | press returns faster than it lifts |
| `.ring` | `background` | `0.5s var(--ease)` | `--p` changes when an exercise passes — the conic arc sweeps |
| `.rail` | `opacity` | `var(--med)` | — |
| `.railhead .eyebrow` | `opacity` | `var(--fast)` | collapse |
| `.railtoggle` | `background, color` / `transform` | `var(--fast)` / `var(--med) var(--ease)` | hover / collapse (rotate 180°) |
| `.rail a` | `background, color` | `var(--fast)` | hover |
| `.rail a::before` | `box-shadow, background, transform` | `0.32s var(--ease)` | `.read` / `.on` class change from the scroll watcher |
| `.rail .mins` | `opacity` | `var(--fast)` | collapse |
| **`.readerlayout`** | `grid-template-columns, gap` | `var(--med) var(--ease)` | rail collapse — the grid track itself animates |
| `.sect` | `border-color, box-shadow` | `var(--med)` | `[open]` |
| `.sect > summary` | `background` | `var(--fast)` | hover |
| `.sect .caret` | `transform` / `color` | `var(--med) var(--ease)` / `var(--fast)` | `[open]` → rotate 90°→-90° |
| `.pagenav a` | `border-color` | `0.12s` | hover |
| `.exlist a` | `background, border-color, color` | `var(--fast)` | hover / `.on` |
| `.exlist a .st` | `background, border-color, color` | `var(--med)` | `.passed` |
| `.editor` | `border-color, box-shadow` | `var(--med)` | `:focus-within` → 55% accent border + `0 0 0 3px` 11% accent ring |
| `.testrow .dot` | `box-shadow` | `var(--med)` | `.ok` / `.no` / `.warn` → a 3px 18% halo |
| `.errlink a` | `background, border-color, color` | `var(--fast)` | hover |
| `.qcard .opt` | `background, border-color` | `0.1s` | hover |
| `.qcard.done .opt` | `background, border-color` | `var(--med)` | **the transition slows down once answered**, "so the eye has time to notice which one it was" |
| `.pill` | `background, border-color, color` | `var(--fast)` | hover / `.on` |
| `.tabbar a` | `color` | `var(--fast)` | `.on` |
| `.tabbar a:active svg` | `transform` | `var(--fast)` | press → `scale(0.88)` |

Two elements are driven directly by JS with **no transition at all**, on
purpose, so they track the scroll frame-for-frame:
`.readerbar .progress` (`scaleX`) and `.railfill` (`scaleY`). Both carry
`will-change: transform`, and both have that removed under
`prefers-reduced-motion` (line 799).

### 5.3 The three places animation is used

`BUILD-YOUR-OWN.md` claims exactly three. The stylesheet actually contains
**seventeen** `@keyframes`. The guide is describing the three that are
*structural* — the ones a reader notices as part of the system rather than as
feedback on an action. Both readings are worth carrying over: three system
animations, and a set of one-shot feedback animations confined to the workbench.

#### (a) Entrance staggers — three tiers

```css
#app > *      { animation: viewin 0.3s var(--ease) both; }
@keyframes viewin { from { opacity: 0; transform: translateY(8px); } }

.stagger      { animation: risein 0.42s var(--ease) both;
                animation-delay: calc(var(--i, 0) * 28ms); }
@keyframes risein  { from { opacity: 0; transform: translateY(10px); } }

.landing      { animation: landin 0.34s var(--ease) both;
                animation-delay: calc(var(--i, 0) * 55ms); }
@keyframes landin  { from { opacity: 0; transform: translateY(12px) scale(0.995); } }
```

Three deliberate gradations:

- **`viewin`** fires once per navigation on the single child of `#app`. Because
  `#app` is replaced wholesale on every route change, this never needs
  resetting. 8px, 0.3s, no delay.
- **`risein`** is for anything that appears in a list. 10px, 0.42s, `28ms`
  per item. The index comes from markup as `style="--i:N"` because **CSS cannot
  count siblings into a delay**. Applied to `.unitcard`, `.gcard` grids, and
  `.hintbox` (which uses `risein 0.3s` without the delay).
- **`landin`** is compiler output landing. 12px *and* a `scale(0.995)`, 0.34s,
  `55ms` per item — twice the stagger of a card grid. The comment: "slightly
  slower and from further down than the card stagger, because it is the answer
  to something you just asked for." Applied to `.verdict`, `.diag`, `.testrow`,
  `.stdout` (all with `style="--i:N"` written by `renderOutput()`), and to
  `.afterbox` with an extra `0.12s` delay.

Only `from` is declared in all three; the `to` is the element's resting state,
and `both` holds the `from` before the delay elapses. That is what makes
staggered items invisible until their turn rather than flashing.

#### (b) The contents dot tick

```css
.rail.live a.read::before { animation: tick 0.34s var(--ease); }
@keyframes tick {           /* line 712 */
  0%   { transform: scale(1); }
  45%  { transform: scale(1.45); }
  100% { transform: scale(1); }
}
```

The gating is the interesting part. The animation is on `.rail.live`, and
`app.js:585` adds `.live` in a `requestAnimationFrame` **after** the first
paint:

```js
requestAnimationFrame(() => $('.rail')?.classList.add('live'));
```

So on load, every already-read dot renders filled and silent. Only a class
change that happens *after* that frame animates. Without this, opening a unit
you had half-read would fire a dozen ticks at once.

The dot also has a 0.32s `transition` on `box-shadow, background, transform`,
so the colour fill crossfades while the scale pulses — two mechanisms on one
element, deliberately.

> **⚠️ Collision, and it is a real bug.** `@keyframes tick` is declared
> **twice**: at line 712 (the dot pulse above) and again at line 1309 for the
> verdict icon:
> ```css
> @keyframes tick {   /* line 1309 — this one wins */
>   0%   { transform: scale(0.3);  opacity: 0; }
>   60%  { transform: scale(1.12); opacity: 1; }
>   100% { transform: scale(1); }
> }
> ```
> Later `@keyframes` with the same name replaces the earlier one entirely, so
> **the contents dot actually runs the verdict animation**: it pops in from
> `scale(0.3)` at `opacity: 0` rather than pulsing 1 → 1.45 → 1. If you
> reproduce this, rename one of them (`dottick` / `stamptick`). Verify against
> the live site before deciding which behaviour is the intended one.

#### (c) The exercise pass stamp

```css
.exlist a.passed .st { animation: stamp 0.42s var(--ease); }
@keyframes stamp {
  0%   { transform: scale(0.4); }
  55%  { transform: scale(1.18); }
  100% { transform: scale(1); }
}
```

Triggered by `app.js:896` adding `.passed` to the sidebar link on a successful
run. The comment names the reason: "the exercise's dot in the sidebar filling
in is the reward that persists, so it gets a real transition rather than a
swap." The overshoot to 1.18 is what makes it read as a stamp rather than a
grow, and it pairs with the 0.26s `background, border-color, color` transition
on the same element — the green fills in while the disc stamps.

### 5.4 The workbench's feedback animations (the fourth category)

Confined to one screen, all one-shot except the two that indicate a wait.

| Animation | Definition | Trigger |
|---|---|---|
| `spin` | `to { transform: rotate(360deg) }`, `0.7s linear infinite` | `#run.running .ic` — the run button's icon |
| `sweep` | `translateX(-100%) → translateX(330%)`, `1.05s cubic-bezier(0.5,0,0.5,1) infinite` | `.runbar::after`, a 34%-wide bar. **Indeterminate on purpose** — "we cannot know how far along a remote compile is. It sweeps rather than fills, which is the honest shape for that." |
| `breathe` | `0%,100% { opacity: 0 } 50% { opacity: 1 }`, `1.5s ease-in-out infinite` | `.editor.running::after` — a ring on a **pseudo-element whose opacity animates**, because `box-shadow` is a paint property and animating it repaints the whole editor every frame for the two or three seconds a compile takes |
| `passsweep` | `from { opacity: 1 } to { opacity: 0 }`, `0.9s var(--ease) forwards` | `.editor.passed::before` — a 22% `--ok` wash over the editor, again an **overlay whose opacity fades** rather than an inset `box-shadow` repainting the interior |
| `shake` | `0,100% X0 · 22% −5px · 55% +4px · 80% −2px`, `0.34s var(--ease) 0.1s` | `.verdict.fail`, composed with `landin` — the card lands, then shakes once |
| `tick` (1309) | `scale(0.3)/op0 → 1.12/op1 → 1`, `0.45s var(--ease) 0.1s both` | `.verdict.pass .ic` |
| `sectopen` | `from { opacity: 0; transform: translateY(-8px) }`, `0.3s` | `.sect[open] .body`. A `<details>` body is `display: none` while closed so a *transition* has nothing to run from; an *animation* does run, because the element only starts existing in layout at that moment. **Closing snaps** — "nobody notices: the eye follows the thing that appears, not the thing that goes." |
| `land` | `0,40% { box-shadow: 0 0 0 2px var(--accent) } 100% { transparent }`, `2.2s ease-out` | `.sect.landed`, added by `jumpTo()` and removed after 2400ms — a deep link's target announces itself |
| `whyin` | `from { opacity: 0; transform: translateY(-6px) }`, `0.32s` | `.qcard .why` revealing |
| `rightin` | `scale(1) → 1.012 → 1`, `0.4s` | `.qcard.done .opt.right` — a 1.2% nudge, almost subliminal |
| `fadein` | `from { opacity: 0 }`, `0.22s` | `.sheet-scrim` |
| `sheetup` | `from { transform: translateY(100%) }`, `0.3s` | `.sheet` |
| `pop` | `from { translateY(12px) scale(0.96); opacity: 0 }`, `0.26s cubic-bezier(0.2, 0.9, 0.3, 1)` | `.companion` — one of the three easing exceptions, a slightly bouncier curve for the mascot |

The three easing exceptions to `--ease`: `spin` is `linear` (a spinner must
not ease), `sweep` is `cubic-bezier(0.5, 0, 0.5, 1)` (symmetric in-out, so an
indeterminate bar does not appear to accelerate off the end), `breathe` is
`ease-in-out`, and `pop` is a near-`--ease` with more overshoot. `land` is
`ease-out`.

### 5.5 `prefers-reduced-motion`

Two blocks. The first (lines 121–124) is the whole policy in three lines:

```css
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition: none !important; animation: none !important; }
}
```

`* { … !important }` is a blunt instrument and it is the right one here: it
cannot be defeated by a later rule, a component's own transition, or a
specificity accident. It also kills `scroll-behavior: smooth`, which is
motion the media query is specifically about.

The second block (line 799) is the follow-up nobody remembers:

```css
@media (prefers-reduced-motion: reduce) {
  .railfill, .readerbar .progress { will-change: auto; }
}
```

Those two elements are still driven by JS `transform` writes on scroll — the
`!important` rule cannot stop that — so the hint is dropped to release the
compositor layers they would otherwise hold for nothing.

Note this rule sits at line 799, near the rail it refers to, not with the
policy block at 121. Under `prefers-reduced-motion` the site still *works*
entirely: nothing is animation-gated, `both` fill on a disabled animation
leaves the element at its resting state, and the `<details>` open/close is
native.

---

## 6. Component catalogue

Naming convention throughout: **short, lowercase, no BEM.** Blocks are one word
(`.card`, `.chip`, `.rail`, `.sect`, `.diag`, `.verdict`, `.qcard`, `.gcard`);
children are one- or two-letter classes scoped by the parent (`.diag .dh`,
`.diag .why .lbl`, `.gcard .t`, `.stat .n`, `.hit .k`). Modifiers are bare
adjectives composed on (`.btn.quiet.sm`, `.chip.accent`, `.codeblock.bad`,
`.verdict.pass`, `.testrow.warn`). State classes are also bare and added by JS
(`.on`, `.read`, `.passed`, `.done`, `.right`, `.wrong`, `.running`, `.landed`,
`.live`, `.copied`, `.stub`, `.picked`).

### 6.1 Buttons — `.btn`

```html
<button class="btn"><span class="ic">svg</span> Run</button>
<a class="btn quiet sm" href="…">svg Drills</a>
<a class="btn ghost sm back" href="…">svg <span>The track</span></a>
<a class="btn lg" href="…">svg Start: …</a>
```

Base:

```css
.btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 15px;
  background: var(--btn-bg);
  color: var(--btn-fg);
  border: 1.5px solid var(--btn-border);
  border-radius: var(--r);
  box-shadow: 0 var(--drop) 0 0 var(--btn-shadow);   /* the hard offset */
  font-size: var(--t-sm); font-weight: 700; letter-spacing: -0.01em;
  cursor: pointer;
  transition: transform 0.07s, box-shadow 0.07s, background 0.12s;
  white-space: nowrap;
}
.btn:hover  { background: #ff7a35; }              /* the one literal */
.btn:active { transform: translateY(var(--drop)); box-shadow: 0 0 0 0 var(--btn-shadow); }
.btn[disabled] { opacity: 0.55; pointer-events: none; }
```

**The `--drop` press.** `box-shadow: 0 var(--drop) 0 0` draws a solid slab
`--drop` pixels below the button — zero blur, zero spread, so it is a shape and
not a shadow. On `:active` the button translates down by exactly `--drop` and
the shadow collapses to `0 0 0 0`. The same token drives both, so they can never
disagree and the button's outer footprint never changes: nothing around it
shifts. `0.07s` is fast enough to feel mechanical rather than animated.
`BUILD-YOUR-OWN.md` calls this "the only piece of skeuomorphism in the whole
design and it is worth keeping."

Variants re-skin by **rebinding the four `--btn-*` tokens locally**, not by
overriding properties:

| Modifier | Rebinds | Also |
|---|---|---|
| `.quiet` | `--btn-bg: var(--surface); --btn-fg: var(--ink); --btn-border: var(--border); --btn-shadow: var(--border)` | `font-weight: 600`; hover → `var(--raised)`. Keeps the drop, in border grey. |
| `.ghost` | all four to `transparent`, `--btn-fg: var(--ink-2)` | `font-weight: 600`, `box-shadow: none`, `:active { transform: none }` — no drop at all |
| `.sm` | — | `padding: 5px 10px; font-size: var(--t-tiny); gap: 5px` |
| `.lg` | — | `padding: 11px 20px; font-size: var(--t-body)` |

Icon-only buttons are a separate pair, deliberately sharing everything but the
surface:

```css
.ghlink, .iconbtn {                      /* 32×32, grid place-items:center */
  width: 32px; height: 32px; border-radius: var(--r);
  color: var(--ink-3); flex: none;
  transition: background var(--fast), color var(--fast);
}
.ghlink:hover, .iconbtn:hover { background: var(--raised); color: var(--ink); }
.iconbtn { background: var(--surface); border: 1px solid var(--border-soft); cursor: pointer; }
```

The comment: "Same 32px target, same hover: the difference is only that a
button carries a surface and a border."

Toggle-on state, shared by `#vim` and `#wrap`:

```css
#vim.on, #wrap.on {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}
```

`inset` shadow rather than `border`, so the drop-shadow slot stays free and the
geometry does not shift.

### 6.2 Cards

```html
<a class="card unitcard stagger" style="--i:2" href="#/unit/x" data-accent="moss">
  <div class="top">
    <span class="num">03</span>
    <span class="chip accent">18m</span>
    <div class="ring" style="--p:57" data-n="4"></div>
  </div>
  <h3>Title</h3>
  <p>Blurb</p>
  <div class="foot"><span class="chip">…</span><span class="chip">…</span></div>
</a>
```

Base `.card`: `background: var(--surface); border: 1px solid var(--border-soft);
border-radius: var(--r-md); padding: 16px`. Only `a.card` lifts on hover
(`translateY(-2px)`, `0 5px 16px var(--shadow)`, border to
`color-mix(in srgb, var(--accent) 55%, var(--border))`) — a non-link card gets
no hover affordance. At ≤760px `a.card:hover { transform: none; box-shadow:
none }` because a phone has no hover and the lift fires on tap.

`.unitcard` adds `flex column; gap: 9px; position: relative; overflow: hidden`
and a **3px accent spine** as `::before` (`left:0; top:0; bottom:0; width:3px;
background: var(--accent); opacity: 0.85`). `.foot` uses `margin-top: auto` so
it pins to the bottom regardless of blurb length. `.unitcard.stub` →
`opacity: 0.62` and the spine drops to `var(--ink-4)`.

Card variants: `.stat` (statgrid tile), `.gcard` (glossary), `.qcard` (drill),
`.pagenav a` (prev/next), `.testrow`, `.verdict`, `.dashed` — the last being
`1px dashed var(--border)` on `color-mix(in srgb, var(--surface) 60%,
transparent)` for a call-to-action that is not yet an object.

**`.ring`** — the progress ring, one element:

```css
.ring {
  width: 30px; height: 30px; flex: none; border-radius: 50%;
  background: conic-gradient(var(--accent) calc(var(--p) * 1%),
                             var(--raised) calc(var(--p) * 1% + 1deg));
  display: grid; place-items: center; margin-left: auto;
  transition: background 0.5s var(--ease);
}
.ring::after {
  content: attr(data-n);
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--surface);
  display: grid; place-items: center;
  font-size: 9px; font-weight: 800; color: var(--ink-2);
}
.ring.done::after { content: "✓"; color: var(--ok); font-size: 12px; }
```

`conic-gradient` rather than SVG: one element, one custom property `--p` set
inline as a number. The **two stops** (`--p%` and `--p% + 1deg`) rather than one
hard cut are deliberate — a single stop gives a jagged leading edge at 30px.
The `::after` punches the hole with `var(--surface)`, so the ring only reads
correctly on a card, not on the page ground.

### 6.3 Badges — `.chip` and `.pill`

```css
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  background: var(--raised); border: 1px solid var(--border-soft);
  font-size: var(--t-micro); font-weight: 600; color: var(--ink-2);
  white-space: nowrap;
}
```

Modifiers, all built from **one `color-mix` formula** — fill ~15%, border
~40%, text ~75% mixed toward `--ink`:

```css
.chip.accent { background: …accent 14%…; border-color: …accent 38%…; color: …accent 78%, var(--ink); }
.chip.ok     { …ok 15% / 40% / 72%… }
.chip.warn   { …warn 16% / 42% / 72%… }
.chip.mono   { font-family: var(--mono); font-weight: 700; letter-spacing: 0; }
```

Reproduce the formula, not the numbers: **`fill ≈ 15%` on transparent,
`border ≈ 40%` on transparent, `text ≈ 75%` mixed into `--ink`.** The same
three-number shape recurs on `.verdict.pass` (9/45/72), `.verdict.fail`
(8/45/74), `.diag .dh` (9/22/76), `.codeblock.bad` (45/30), `.testrow`
(26/34/18), `.qcard.done .opt.right` (10), `.callout.gotcha` (7),
`.hintbox` (6), `.afterbox` (6/35). Percentages on `transparent` tint; on
`var(--surface)` they wash; on `var(--ink)` they darken text.

`.pill` is the same idea at link scale: `padding: 5px 11px; border-radius:
999px; background: var(--surface); --t-tiny; 600`, and `.pill.on` uses the
*button* tokens (`var(--btn-bg)` / `--btn-border` / `--btn-fg`) rather than the
accent — so a selected filter reads as a pressed control, not as a tinted tag.
`.letters button.on` does the identical thing.

### 6.4 Code

```html
<div class="codeblock bad">
  <div class="cb-head">will not compile</div>
  <pre><span class="t-kw">fn</span> <span class="t-fn">main</span>…</pre>
</div>
```

`.codeblock` — `position: relative; background: var(--code-bg);
border: 1px solid var(--code-border); border-radius: var(--r-md);
overflow: hidden`. `.cb-head` is a bordered strip using the eyebrow treatment
but with its own tracking (`0.04em`, not `0.07em`) because it is 700 not 800.
`.codeblock pre { overflow-x: auto; padding: 12px 14px; font-size: var(--t-sm);
line-height: 1.62 }` — the same 1.62 as the editor.

`.bad` / `.good` tint the border and the head with `--bad` / `--ok` at 45% and
30%.

Inline code: `.prose :not(pre) > code` — `font-size: 0.86em` (relative, so it
tracks the surrounding size), `padding: 0.12em 0.36em`, code ground and border,
`border-radius: var(--r-sm)`, `color: color-mix(in srgb, var(--rust) 70%,
var(--ink))`, `white-space: nowrap`. The `:not(pre) >` guard is what stops it
applying inside a block.

**Syntax token classes** (the sixteen literals):

| Class | Light | Dark | Meaning |
|---|---|---|---|
| `.t-kw` | `#a1442e` | `#ef8f76` | keywords, 600 |
| `.t-kw2` | `#8a5a20` | `#dda45c` | secondary keywords, 600 |
| `.t-str` | `#4a7a3d` | `#91c47c` | strings |
| `.t-num` | `#9a5b12` | `#e0a95f` | numbers |
| `.t-cmt` | `var(--ink-4)` | (token) | comments, italic — **not a literal** |
| `.t-mac` | `#7b4b72` | `#c99ac0` | macros, 600 |
| `.t-life` | `#a03060` | `#eb7fa8` | lifetimes, 600 |
| `.t-type` | `#43607a` | `#86b2d8` | types |
| `.t-attr` | `var(--ink-3)` | (token) | attributes — **not a literal** |
| `.t-fn` | `#2f5f8a` | `#7fb0dd` | function names |

Comment: "Colours are deliberately few: a reader should see structure, not a
fruit salad. Keywords and lifetimes carry the weight." Note two of the ten use
ink tokens, not hues — comments and attributes recede rather than colour.

`kbd` — `font-size: 0.9em; padding: 1px 5px; border: 1px solid var(--border);
border-bottom-width: 2px; border-radius: var(--r-sm); background: var(--raised)`.
The doubled bottom border is the keycap.

### 6.5 Callouts

```html
<div class="callout gotcha"><div class="ct">svg Watch out</div><p>…</p></div>
```

```css
.callout {
  border: 1px solid var(--border-soft);
  border-left: 3px solid var(--accent);      /* the spine */
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  padding: 13px 16px; font-size: var(--t-sm); line-height: 1.6;
}
.callout .ct { color: var(--accent); display: flex; align-items: center; gap: 6px; }
```

Two modifiers: `.gotcha` (left border and title → `--warn`, background
`color-mix(--warn 7%, --surface)`) and `.compare` (→ `--slate`, no background
change). The 3px left border matches `.unitcard::before`, `.afterbox` and
`.qcard .why` — **3px on the left is the app's mark for "this block belongs to
something."**

Siblings in the same family: `.memory` (a stack/heap picture, `--code-bg`
ground, `overflow-x: auto`, `pre` at `--t-tiny`/1.5 in `--ink-2` — "drawn in
monospace because the alignment is the point"); `.hintbox` (dashed border,
amber 6% wash, `--warn` label); `.afterbox` (3px `--ok` left border, ok 6%
wash, `--ok` label); `.stdout` (code ground, `--ink-3` label).

### 6.6 Tables

```css
.prose table { width: 100%; border-collapse: collapse; font-size: var(--t-sm);
               display: block; overflow-x: auto; }
.prose th, .prose td { padding: 7px 11px; border: 1px solid var(--border-soft);
                       text-align: left; vertical-align: top; }
.prose th { background: var(--raised); font-weight: 700; font-size: var(--t-tiny); }
.prose tbody tr:nth-child(even) { background: color-mix(in srgb, var(--raised) 45%, transparent); }
```

`display: block` is the only way to make a `<table>` its own scroll container —
without it the table would blow past the `overflow-x: clip` on body and be
truncated. The cost is that `width: 100%` no longer stretches to the container
on wide screens, which is accepted. Zebra striping is `--raised` at 45%, half
the header's weight.

### 6.7 The progress spine

Three cooperating parts, all reading `--accent`, all driven by one scroll
watcher in `app.js` (`wireUnit`, lines ~516–585):

1. `.readerbar .progress` — 2px, `scaleX(ratio)`, full page width, on the bar's
   bottom border.
2. `.railtrack` / `.railfill` — 2px vertical, `scaleY(ratio)`, the same ratio.
3. `.rail a::before` dots — `.read` / `.on` classes toggled per section.

The horizontal bar and the vertical fill are literally the same number rendered
two ways: `bar.style.transform = 'scaleX(' + ratio + ')'` and
`fill.style.transform = 'scaleY(' + ratio + ')'`. Both use `transform` (not
`width`/`height`) so they are compositor-only, and both declare
`will-change: transform` and `transform-origin: left` / `top`.

The sheet's copy of the contents has **no spine** — see 3.11.

### 6.8 Form controls

`button, input, select, textarea { font: inherit; color: inherit; }` — the
global reset that makes every control inherit the type system rather than
opting in per component.

`:focus-visible { outline: 2px solid var(--ferris); outline-offset: 2px;
border-radius: var(--r-sm); }` — one rule, `--ferris` not `--accent` so the
focus ring is the same colour on every unit and is never confused with a
component's own accent state.

`.searchbox` — `label` wrapper, `position: relative`, an absolutely positioned
14px svg at `left: 9px` with `pointer-events: none`, and an input with
`padding-left: 30px` to clear it. Reused verbatim on the glossary page with
inline overrides.

`.letters button` — 30×30, `var(--r-sm)`, `--t-tiny` 700; `.on` takes the
button tokens.

`.qcard .opt` — `<button>` styled as a row: `display: flex;
align-items: flex-start; gap: 9px; padding: 8px 12px; border: 1px solid
var(--border-soft); border-radius: var(--r); background: transparent;
text-align: left`. `align-items: flex-start` (not `center`) because an option
can wrap to two lines and the key letter must stay on the first.

### 6.9 The diagnostics panel — the most composed component

```html
<div class="diag landing" style="--i:1">
  <div class="dh">
    <span class="code">E0382</span>
    <span class="msg">borrow of moved value: `s`</span>
    <span class="where">line 7 · hidden tests</span>
  </div>
  <div class="snip"><pre>…code…<span class="caret">^^^</span></pre></div>
  <div class="why"><div class="lbl">svg What that actually means</div><p>…</p></div>
  <details class="raw"><summary>rustc's own output</summary><pre>…</pre></details>
</div>
<div class="errlink"><a class="chip mono">E0382 in the error index ↗</a></div>
```

Four horizontal bands inside one `border-radius: var(--r-md); overflow: hidden`
box, each with its own ground so they read as strata:

| Band | Ground | Border below |
|---|---|---|
| `.dh` header | `color-mix(--bad 9%, --surface)` | `color-mix(--bad 22%, --border-soft)` |
| `.snip` | `var(--code-bg)` | `var(--code-border)` |
| `.why` | `var(--surface)` (inherited) | — |
| `.raw` | `var(--surface)` | `border-top: 1px dashed var(--border-soft)` |

The outer border is `color-mix(in srgb, var(--bad) 35%, var(--border-soft))` —
tinted, not saturated, so a page of three errors is not alarming.

`.dh .code` is the error code as a solid `var(--bad)` pill with `#fff` text,
mono `--t-micro` 700. `.dh .msg` is `color-mix(--bad 76%, --ink)` with
`flex: 1; min-width: 0` (the ellipsis guard). `.dh .where` is mono `--ink-3`.
`.snip .caret` is `var(--bad)` 700 — the `^^^` under the offending column.
`.why .lbl` is an eyebrow in `var(--accent)`, which is the deliberate signal
that **the explanation is the book talking, not the compiler**: red for the
tool, accent for the author. `.raw > summary` hides the marker and uses
`content: "▸ "` / `"▾ "` on `::before`.

`.raw` collapses `rustc`'s verbatim output — the real thing is always available
but never the first thing you read.

Sibling: `.testrow` — a mono row with a 7px `.dot` whose halo is a
`box-shadow: 0 0 0 3px color-mix(…18%…)` transitioned over `--med`; states
`.ok` / `.no` / `.warn`, plus `.panic` / `.panic.quiet` for the message.

`.verdict` — a `--t-sm` 700 bar with a 22px round `.ic`, `.sub` pushed right
with `margin-left: auto` at `--t-micro` 600 `--ink-3`. `.pass` / `.fail` /
`.wait`.

### 6.10 Miscellaneous

- `.crumbs` — flex wrap, gap 6px, `--t-tiny`. Links are literally
  `<a class="btn ghost sm">`, separators are `<span class="sep">/</span>` in
  `--ink-4`, the current page is `<span class="now">` in `--ink-3` 600.
- `.pop` — the glossary hover card: `position: absolute; z-index: 200;
  max-width: 330px; box-shadow: 0 8px 26px var(--shadow)`. `display: none` at
  ≤760px, because a hover popover is meaningless on touch and the tap that
  would trigger it is the tap meant for the link underneath.
- `.term` — `border-bottom: 1.5px dotted color-mix(--accent 60%, transparent);
  cursor: help; font-weight: 700`. Toggled off by `.hide-terms .term
  { border-bottom-color: transparent }` — a body-level class, so one toggle
  clears every term on the page.
- `.heat` — see 3.8.
- `.hit` — search result row, `display: block`, bottom hairline, three lines
  (`.k` micro 700 ink-3, `.t` sm 600 ink, `.s` tiny ink-3).
- `.companion` — `fixed; right: 18px; bottom: 18px; z-index: 300;
  max-width: min(340px, calc(100vw - 36px))`, a 46px image plus a `.bubble`
  card at `--t-tiny`.
- `.llms` — the stacked assistant marks: three 19px `.av` discs with
  `border: 1.5px solid var(--surface)` and `margin-left: -7px` on the second and
  third so they overlap, fanning ±2px on hover. `.copied` turns the whole pill
  `--ok`-tinted.

---

## 7. Re-skinning: cool graphite + green phosphor

The target is the inverse temperature of the source: where the Rust Handbook
rotates every neutral **warm** to sit under an orange accent, a green-phosphor
accent needs every neutral rotated **cool**. That single decision, per
`BUILD-YOUR-OWN.md`, "is the one decision that makes a palette swap look
designed rather than recoloured."

Note a structural asymmetry you must plan for: phosphor green is a **dark-native
idiom**. The source is light-first (`index.html` defaults to `light`, with the
comment "a reader who has never chosen gets the book"). A phosphor palette will
look right in dark and needs real work in light — budget the effort there, and
consider defaulting to dark instead. That is a one-line change in
`index.html`'s pre-paint script plus the two `theme-color` metas.

### 7.1 CHANGE — pure palette

Everything in this list is a value swap inside the two `:root` blocks. Nothing
else in the file needs touching for any of it.

**The neutral ramp — rotate cool.** Keep the *steps*, change the hue. The
source's light ramp moves in even lightness increments with a constant warm
hue; mirror that with a cool one.

| Token | Rust (warm) | Graphite (cool) — starting point |
|---|---|---|
| `--bg` light | `#efebe4` | `#e8eaec` |
| `--surface` light | `#fdfbf6` | `#f8fafb` |
| `--raised` light | `#e6e1d8` | `#dcdfe3` |
| `--border` light | `#c3bcaf` | `#b3b9c0` |
| `--border-soft` light | `#d8d2c6` | `#cbd0d6` |
| `--ink` light | `#211d1a` | `#171a1d` |
| `--ink-2` light | `#4d4640` | `#414850` |
| `--ink-3` light | `#746c64` | `#666e77` |
| `--ink-4` light | `#9d958b` | `#8b939c` |
| `--code-bg` light | `#f6f1e8` | `#eef1f4` |
| `--code-border` light | `#e0d8ca` | `#d5dae0` |
| `--bg` dark | `#1c1917` | `#111417` |
| `--surface` dark | `#26211e` | `#191d21` |
| `--raised` dark | `#2e2825` | `#222730` |
| `--border` dark | `#403833` | `#2f363d` |
| `--border-soft` dark | `#342d29` | `#242a30` |
| `--ink` dark | `#faf9f7` | `#e8eef0` |
| `--ink-2` dark | `#b8afa6` | `#9fb0b3` |
| `--ink-3` dark | `#928980` | `#7c8b90` |
| `--ink-4` dark | `#6b635c` | `#57646a` |
| `--code-bg` dark | `#1f1b19` | `#0d1114` |
| `--code-border` dark | `#352e29` | `#242c32` |

Rules that must survive the swap, whatever numbers you land on:

- **The four inks must stay four distinguishable steps** in both themes. Check
  ink-3 against `--surface` and ink-4 against `--bg` for contrast; ink-4 is the
  one that goes illegible first.
- **`--surface` must be lighter than `--bg` in light and *lighter* than `--bg`
  in dark too** (`#26211e` > `#1c1917`). A card is always raised, never sunk.
- **`--code-bg` sits away from `--surface`, on the far side from `--bg`.** In
  light it is *darker* than surface (`#f6f1e8` vs `#fdfbf6`); in dark it is
  *darker* than surface (`#1f1b19` vs `#26211e`). In both themes code recedes.
- **`--shadow` and `--hair` are hand-derived from `--ink`** — recompute them.
  Light: `rgb(<ink as r g b> / 0.09)` and `/ 0.1`. Dark: `rgb(0 0 0 / 0.42)` and
  `rgb(<dark ink> / 0.1)`.

**The seven accents.** The guide's recipe: "one brand colour, one warm, one
earth, one green, one blue, one purple, plus the semantic three." For phosphor,
invert the emphasis — green is the brand, and the other six become the
supporting rotation.

```css
--phosphor: #4ade6a;   /* the brand, replaces --ferris; the default --accent   */
--emerald:  #2f9e5e;   /* the deeper green, replaces --rust                     */
--cyan:     #3aa8b0;
--teal:     #3d8f82;
--olive:    #7f9a3e;
--steel:    #5b7f9e;   /* keep something cool-neutral for .callout.compare      */
--violet:   #7c6fa8;
--accent: var(--phosphor);
```

And the seven `[data-accent="…"]` selectors renamed to match. **They must all
be desaturated enough to sit on the ground without vibrating** — that is the
constraint the source states explicitly, and it is harder with green on
graphite than orange on tan, because green and grey are closer in hue neutrality.
Test each one as a 3px `.unitcard::before` spine and as a `.chip.accent` fill at
14%.

**The semantic three.** `--ok` cannot be green if the accent is green — a
passing exercise would be indistinguishable from a normal accented element. This
is the single biggest structural consequence of a phosphor palette. Options,
in order of preference:

1. Make `--ok` a **cyan/teal** and let the phosphor green mean "current /
   accent" only. Keeps the pass-state distinct.
2. Make the accent a *yellower* phosphor (`#a3e635`-ish) and keep `--ok` a
   true green. Riskier — they still read as the same family.

`--warn` and `--bad` transfer directly (amber and red are unaffected by a cool
rotation, though you may want them a touch cooler:
`--warn: #d4a017` → `#c9a227`, `--bad: #cf3b2f` → `#d94f45`).

**The button tokens.** Keep the *relationship*, change the hue:
`--btn-bg` is the accent at working saturation, `--btn-border` is roughly 35%
darker, `--btn-shadow` sits between them, `--btn-fg` is a near-white tinted
toward the accent. On a phosphor button the foreground should be **dark, not
white** — bright green on white fails contrast:

```css
--btn-bg:     #4ade6a;
--btn-border: #1f7a38;
--btn-shadow: #2b9448;
--btn-fg:     #0b1410;   /* dark ink on a bright fill */
```

Then `.btn:hover { background: … }` at line 349 **must be edited by hand** — it
is the one literal in a component and it will stay orange otherwise. Better:
replace it with `color-mix(in srgb, var(--btn-bg) 88%, white)` so it derives.

**`--mark`.** Currently `rgba(247, 104, 31, 0.24)` — the accent at 24%.
Recompute from the new accent, and check it in dark, where a bright green
selection at 26% can wash out the text under it.

**The scrim.** `rgb(0 0 0 / 0.42)` at line 1713 is a literal. It works either
way, but you may want it cooler.

**Syntax colours.** All sixteen must be re-picked. This is the largest single
piece of palette work and it does not derive from anything. The constraints the
source applies: only eight hues, comments and attributes stay on ink tokens
(`--ink-4` / `--ink-3`), keywords and lifetimes carry weight (600) as well as
colour. On a graphite ground a cool syntax theme works — but do **not** make
every token green, or the highlight disappears into the accent.

**The mascot.** One flat figure that reads at 26px, used in the header
(`.mascot`, 30px → 26px on phones), the footer, the 404, and `.companion`
(46px). Plus the favicon and `og:image`.

**Meta colours in `index.html`.** Two `theme-color` metas hard-code
`#efebe4` / `#1c1917`. They must match the new `--bg` in each theme or the
phone's browser chrome will not match the page.

### 7.2 KEEP — structure

None of this changes for a different subject or palette. It *is* the design.

**The token architecture.**
- Two `:root` blocks plus the motion block. Every colour a token.
- `--accent` as the single indirection, rebound per container by
  `[data-accent="…"]`. No component ever names a hue.
- The four `--btn-*` tokens rebound locally by `.quiet` / `.ghost` — the
  pattern that lets one button rule serve three appearances.
- The `color-mix` formula: fill ~15% / border ~40% / text ~75%-into-ink. This
  is what makes a green chip and a red chip look like siblings.

**The four-ink discipline** and the rules in §2.7 about which ink goes where.
`BUILD-YOUR-OWN.md`: "That single restraint does more for the look than any
other rule here." Also keep the corollary from the sheet's comments — **each
visual channel carries exactly one meaning**, so a new state must use a channel
that is still free (which is why the sheet's current row uses tint and colour
but *not* weight, and read-but-not-current uses opacity).

**The whole type system.** The nine `clamp()` expressions verbatim, the
climbing `vw` coefficient, `--measure: 72ch`, the line-height ladder
(1.02 display → 1.68 prose), the tracking-vs-size relationship, the shared
eyebrow selector list. Swap the two font *stacks* if you like (any neutral
grotesque + readable mono), but keep the scale. Keep `font-variant-ligatures:
none` on code and the 16px editor floor.

**Every geometry token.** `--r-sm/--r/--r-md/--r-lg` at 4/6/8/16, `--drop: 2px`,
`--rail: 288px`, and the button's hard offset shadow. The drop is the only
skeuomorphism and it is load-bearing.

**Every layout number.** 1180 / 1330 / 840 / 288 / 236 / 56 / 96 / 116, the grid
templates, `minmax(0, 1fr)` on every content column, `align-items: start`.

**Every breakpoint and its rationale.** 1060 (rail→sheet, and `#opensheet`'s
matching `min-width: 1061px`), 1040 (workbench columns), 900 (nav→tab bar),
760 (phone), 620 (search box), 420 (h1 refit), plus `(pointer: coarse)` and the
four touch-target sizes.

**Every responsive gotcha.** `overflow-x: clip` on html/body and the per-element
`overflow-x: auto` list. The media-query source-order discipline and the
`:where([data-rail="collapsed"])` specificity trick.
`[hidden] { display: none !important }`.

**The whole motion system.** `--ease`, `--fast`, `--med`, the three entrance
tiers (`viewin` / `risein` / `landin` with their 28ms and 55ms staggers and the
`--i` index-from-markup pattern), the `.rail.live` gate on the dot tick, the
stamp overshoot, and the two `prefers-reduced-motion` blocks. Keep the rule that
**no transition uses `all`**, and keep the two performance decisions —
animating a pseudo-element's `opacity` rather than a `box-shadow`, and driving
the two progress bars with `transform` rather than `width`/`height`.

**Every component's DOM shape and class naming.** Short lowercase blocks, one-
and two-letter scoped children, bare adjective modifiers, bare state classes
added by JS.

**The editor's shared-metric rule.** The `.editor pre.hl, .editor textarea`
selector and every declaration in it, `.stack` as the single scroll container,
`ta.style.width = pre.scrollWidth + 'px'`, and the four-part softwrap change.
This has nothing to do with palette and everything to do with the thing working.

### 7.3 FIX while you are in there

1. **Rename one of the two `@keyframes tick`.** The second silently replaces the
   first, so the contents dot runs the verdict animation (§5.3b).
2. **Derive `.btn:hover`** from `--btn-bg` instead of the `#ff7a35` literal, so
   the dark theme's button hovers correctly.
3. **Tokenise the scrim** (`rgb(0 0 0 / 0.42)` → a `--scrim` token) so it can be
   themed.
4. **Tokenise `999px`** as `--r-pill` if you want the pill radius adjustable.
5. `BUILD-YOUR-OWN.md` says prose is `1.75` line-height; the stylesheet says
   `1.68`. The stylesheet is the truth.
6. `BUILD-YOUR-OWN.md` says nothing uses a literal colour outside the two
   `:root` blocks; five sites do (§1.8).

### 7.4 The one-sentence summary

Four greys for hierarchy, one accent variable for state, nine fluid type steps
with tracking that tightens as size grows, four radii, one easing, one drop
distance — and a hard rule that no component ever names a colour. Change the
temperature and the subject; change nothing else.
