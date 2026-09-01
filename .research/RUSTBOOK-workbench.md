# The Rust Handbook workbench — reproduction & extension reference

Source: `/Users/madalintat/learning_series/rust_learning`

| file | lines | role |
|---|---|---|
| `assets/workbench.js` | 376 | tokenizer, playground client, diagnostics parser, editor. One IIFE, one global `WB`. |
| `assets/vim.js` | 913 | vim keybinding layer over the textarea. One IIFE, one global `Vim`. |
| `assets/app.js` | 1406 | hash router + views. Workbench lives at lines ~600–930. |
| `assets/app.css` | 1827 | editor CSS at 1074–1205, output panel at 1238–1440, tokens at 964–984. |
| `assets/companion.js` | 76 | Ferris mascot, `Companion.cheer(done,total)`. |
| `test_workbench.mjs` | 61 | node, no deps. |
| `test_vim.mjs` | 323 | node, no deps. |

Load order matters and is fixed in `index.html` (plain `<script>`, no modules, no build step):

```html
<script src="assets/companion.js"></script>
<script src="assets/vim.js"></script>
<script src="assets/workbench.js"></script>
<script src="assets/app.js"></script>
```

`workbench.js` references `Vim.attach` at mount time, `app.js` references `WB.*` at
module-eval time (`const esc = WB.esc;` on line 15), so `vim.js` must precede
`workbench.js` must precede `app.js`. The file header explains the single-global
choice: two files sharing a top-level `const esc` would be a redeclaration error in
classic-script scope.

`WB` exports exactly: `{ hlRust, run, parse, snippet, mountEditor, toolchain, esc }`.

---

## 1. The editor

### 1.1 DOM

`WB.mountEditor(host, starter, onRun)` writes this into `host` (which is
`<div class="editor" id="ed">`, already carrying `softwrap` if the preference is on):

```html
<div class="gutter"></div>
<div class="stack">
  <pre class="hl" aria-hidden="true"></pre>
  <textarea spellcheck="false" autocapitalize="off" autocomplete="off"
            autocorrect="off" wrap="off" aria-label="Rust source"></textarea>
</div>
<div class="vimbadge" hidden></div>
```

Three layout facts:

- `.editor` is `display:grid; grid-template-columns: auto 1fr` — gutter, then stack.
- `.stack` is `position:relative; overflow:auto`. **It is the scroll container.**
- `pre.hl` is in normal flow and therefore *defines the scroll extent*; the
  `textarea` is `position:absolute; inset:0; width:100%; height:100%; overflow:hidden`
  and therefore contributes nothing to layout.

That inversion is the trick. The highlight layer sizes the box; the textarea is
painted on top at exactly the box's size with its own scrolling suppressed. There is
only one real scrollbar (`.stack`'s).

`aria-hidden="true"` on the `<pre>` stops screen readers reading every glyph twice;
the textarea carries `aria-label="Rust source"`.

### 1.2 The transparency

```css
.editor textarea {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  background: transparent;
  color: transparent;          /* glyphs invisible */
  caret-color: var(--ferris);  /* caret visible */
  resize: none; outline: none;
  overflow: hidden;
}
.editor textarea::selection { background: var(--mark); }
.editor pre.hl { pointer-events: none; min-height: 100%; }
```

- `color: transparent` hides the textarea's own glyphs. The caret survives because
  `caret-color` is a separate property.
- Selection survives too: `::selection` on transparent text still paints its
  *background*, which is what a selection highlight actually is. This is why the
  selection is a real, native, drag-and-shift-selectable selection and not a
  simulated one — and why vim's normal-mode block cursor can be implemented as a
  one-character selection (§7).
- `pointer-events: none` on the `<pre>` lets every click, drag and double-click
  land on the textarea underneath.
- `min-height: 100%` on the `<pre>` makes a short file still fill the box, so the
  click target is the whole editor.

### 1.3 The metrics that must match — the drift list

Everything below is asserted **in CSS, not in JS**, in one shared rule
(`app.css:1134`) so the two layers cannot be edited apart:

```css
.editor pre.hl,
.editor textarea {
  margin: 0;
  padding: 12px 14px;
  border: 0;
  font: inherit;          /* family, size, weight, style — all from .editor */
  line-height: inherit;   /* .editor sets 1.62 */
  letter-spacing: normal;
  tab-size: 4;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
}
```

and `.editor` itself supplies `font-family: var(--mono); font-size: var(--t-sm);
line-height: 1.62`.

**Every metric that drifts if mismatched.** In rough order of how likely it is to
bite you:

| metric | symptom when mismatched |
|---|---|
| `font-family` | horizontal drift growing along each line. The killer: the webfont (`JetBrains Mono` from Google Fonts) loading *after* first paint changes advance width on both layers — they stay in sync only because both inherit the same stack. Any fallback difference (e.g. `<pre>` inheriting the UA's `monospace` while the textarea inherits the UA's default `font: 400 13.33px Arial`) desyncs instantly. **`font: inherit` on the textarea is mandatory** — a textarea does *not* inherit font by default. `app.css:144` also carries the global `button, input, select, textarea { font: inherit; color: inherit; }` belt-and-braces. |
| `font-size` | same, worse. Note the mobile override at `app.css:1660` sets `.editor { font-size: 16px }` — on the *parent*, so both children move together. Deliberate: iOS Safari zooms the viewport on focusing any input under 16px and never zooms back. |
| `line-height` | vertical drift of one row per N lines. Both use `inherit` from `.editor`. Mobile drops it to 1.55, again on the parent. |
| `padding` | a constant offset in both axes. Both get `12px 14px`; mobile override sets both to `11px 12px` in the same rule. |
| `border` | textarea has a UA border by default; `border: 0` on both. A 1px border on one layer shifts everything 1px. |
| `margin` | `<pre>` has a UA `margin: 1em 0`; `margin: 0` on both. Forgetting this is the classic first bug. |
| `letter-spacing` | cumulative horizontal drift. Explicitly `normal` on both rather than inherited, so an ancestor's tracking cannot leak into one and not the other. |
| `tab-size` | if the source contains a literal tab, `tab-size: 4` must be identical. (The editor inserts `TAB = '    '`, four spaces, so this only matters for pasted code.) |
| `white-space` | `pre` on both; `pre-wrap` on both in softwrap. A mismatch collapses runs of spaces on one layer only. |
| `overflow-wrap` / `word-break` | `normal` on both; `anywhere` on both in softwrap. Different break opportunities = different line counts. |
| `font-weight` / `font-style` | the tokenizer's spans set `font-weight: 600/700` (`.t-kw`, `.t-kw2`, `.t-mac`, `.t-life`) and `font-style: italic` (`.t-cmt`). **In a proportional font this would desync. In a monospace font it does not, because monospace bold and italic keep the same advance width.** This is a load-bearing assumption of the whole design: you may only style tokens with properties that do not change advance width — colour, weight, style. Never `font-size`, `letter-spacing`, `padding`, `text-transform`, `font-family`, or `font-variant` on a token span. |
| direction / bidi | not handled; RTL content in a string literal will drift. Acceptable for source code. |
| scroll position | see §1.4. |
| width | see §1.5. This is the one metric CSS cannot express. |

### 1.4 Scroll synchronisation

Two lines, and they are asymmetric:

```js
ta.addEventListener('scroll', () => { pre.parentElement.scrollLeft = ta.scrollLeft; });
```

- **Vertical**: not synchronised, because it does not need to be. The textarea is
  `height:100%` of `.stack`, `overflow:hidden`, and `.stack` scrolls. The textarea
  cannot scroll vertically at all — it is exactly as tall as its container's
  *client* box, and the `<pre>` is what overflows. Scrolling the mouse wheel scrolls
  `.stack`, moving both layers together as one composited unit. Zero JS.
- **Horizontal**: the textarea *can* still scroll horizontally in one case — the
  browser scrolls an input to reveal the caret, ignoring `overflow:hidden`
  (this is caret-scroll-into-view, not user scroll). So the handler pushes
  `ta.scrollLeft` onto `.stack.scrollLeft` (`pre.parentElement` **is** `.stack`).
  Typing past the right edge therefore drags the highlight layer along.

There is no reverse binding (`.stack` scroll → textarea). None is needed: the
textarea is absolutely positioned *inside* the scrolled content, so it translates
with it.

**Gutter scroll is not synchronised either.** `.gutter` is a grid sibling of
`.stack`, outside the scroll container — so it does not scroll horizontally (correct)
but it also does not scroll vertically. The editor has no fixed height in the CSS,
so the box grows with the content and the page scrolls instead of the editor. That
is why nobody notices. If you give `.editor` a `max-height`, you must add gutter
vertical sync.

### 1.5 Width — the one metric pushed from JS

A `<textarea>` cannot size itself to its longest line; `width:100%` means 100% of
`.stack`'s *client* width, so as soon as a line overflows, the textarea is narrower
than the `<pre>` and the caret cannot reach the end of the line. So, at the end of
every `paint()`:

```js
requestAnimationFrame(() => { ta.style.width = pre.scrollWidth + 'px'; });
```

Three things to note:

1. `pre.scrollWidth` is the widest line's width (plus padding), which is what the
   textarea's content box must be.
2. It is deferred into a `requestAnimationFrame` **on purpose**: reading
   `scrollWidth` immediately after an `innerHTML` write forces a synchronous
   layout, and this runs on every keystroke *and* on every consumed vim key.
3. In softwrap mode this is harmless: `.editor.softwrap .stack { overflow-x:hidden }`
   and `.editor.softwrap { grid-template-columns: minmax(0,1fr) }` cap the box, and
   `pre.scrollWidth` equals the client width, so the inline width is a no-op.
   (The `ED.wrap()` comment calls this out as the reason wrap must repaint.)

### 1.6 `paint()` — the render loop and its two caches

```js
function paint() {
  const v = ta.value;
  if (v !== lastHl) {
    pre.innerHTML = hlRust(v) + (v.endsWith('\n') ? ' ' : '');
    lastHl = v;
  }
  const n = v.split('\n').length;
  const errs = errLines.join(',') + '|' + relTo;
  if (n !== lastLines || errs !== lastErrs) { /* rebuild gutter */ }
  requestAnimationFrame(() => { ta.style.width = pre.scrollWidth + 'px'; });
}
```

Two memo guards, both added for measured reasons stated in the comments:

- **Highlight cache** keyed on the whole text (`lastHl`). `paint()` runs on every
  keystroke *and on every consumed vim key*, and most vim keys are motions that
  change nothing. The comment gives the measurement: on the largest project stage
  the highlight is 1.4 ms of JS plus a 62 KB `innerHTML` parse and ~4000 nodes
  rebuilt, per key.
- **Gutter cache** keyed on `lineCount + '|' + errLines + '|' + relTo`. Rebuilding
  up to 53 `<div>`s per character typed was pure waste.

**The trailing-newline fix.** `pre.innerHTML = hlRust(v) + (v.endsWith('\n') ? ' ' : '')`.
A trailing newline collapses in a `<pre>` (HTML spec: a newline immediately before
the closing tag is dropped), so the last line loses its row, the `<pre>` is one row
shorter than the textarea, and everything below the caret drifts up by one. One
space fixes it. **This is drift metric #14 and the single most commonly missed one.**

### 1.7 The gutter

```js
for (let i = 1; i <= n; i++) {
  const cls = (errLines.includes(i) ? ' err' : '')
    + (relTo !== null && i === relTo + 1 ? ' cur' : '');
  const label = relTo === null || i === relTo + 1 ? i : Math.abs(i - 1 - relTo);
  g += `<div class="gl${cls}">${label}</div>`;
}
```

- One `<div class="gl">` per logical line. Alignment with the code rows comes purely
  from `line-height` inheritance — `.gutter` is inside `.editor`, which sets
  `line-height: 1.62`, and `.gutter` has `padding: 12px 10px 12px 14px`, whose
  *top* padding matches the code layers' `12px`. **Gutter top padding and code top
  padding is drift metric #15.**
- `white-space: pre` and `font-variant-numeric: tabular-nums` keep the numbers from
  reflowing as they gain digits.
- `.gl.err` is red+bold, driven by `ED.mark(lines)`.
- `.gl.cur` is the vim relative-number anchor: the cursor's own line keeps its
  absolute number, and it gets `text-align:left; padding-left:2px` so it reads as
  the anchor rather than as one of the measured distances. `relTo` is set from vim
  via the `gutter(line)` callback in the `Vim.attach` options.
- **The gutter is hidden entirely in softwrap** (`display:none`), because one number
  per logical line cannot line up with lines that occupy two rows. The `ponytail:`
  comment in `app.js` names the upgrade path: per-line numbering that measures
  wrapped height.

### 1.8 Caret and selection behaviour

There is no custom caret and no custom selection. Both are the browser's, on a real
`<textarea>`:

- **Caret**: `caret-color: var(--ferris)` (the Ferris orange). Blink, shape,
  IME composition, mobile handles, spellcheck-free behaviour — all native.
- **Selection**: `::selection { background: var(--mark) }` on transparent text.
  Native drag, shift-arrow, double-click-word, triple-click-line, `Cmd+A`.
- **Vim normal mode** overrides both, keyed off `data-vim` on the host:
  ```css
  .editor[data-vim="vim-normal"] textarea { caret-color: transparent; }
  .editor[data-vim="vim-normal"] textarea::selection { background: var(--accent); color: var(--code-bg); }
  .editor[data-vim="vim-visual"] textarea::selection { background: color-mix(in srgb, var(--accent) 34%, transparent); }
  .editor[data-vim="vim-insert"] textarea { caret-color: var(--ferris); }
  ```
  Note `color: var(--code-bg)` in normal mode: `::selection` *can* set the text
  colour, so the block cursor gets a visible glyph knocked out of the accent block —
  the only place the textarea's own glyphs are ever visible. Normal and visual get
  different colours on purpose: they mean very different things about what the next
  key will do.
- **The `<pre>` is not selectable** (`pointer-events:none`), so a drag can never
  start on it and produce a second, conflicting selection.

### 1.9 Resizing

- `resize: none` on the textarea kills the native grabber (which would break the
  overlay immediately).
- There is no `ResizeObserver` and no window `resize` handler. The editor is
  intrinsically sized: `.editor` is a grid in normal flow, `.stack` grows to the
  `<pre>`'s height, and the page scrolls. A viewport width change reflows `.stack`,
  and the textarea (`width:100%` + the inline `pre.scrollWidth` override) is
  corrected on the next `paint()`.
- **Gap**: if the window is resized without any subsequent `paint()`, the inline
  `ta.style.width` is stale. Harmless in `pre` mode (the width is content-driven,
  not viewport-driven). In `softwrap` mode it would matter, except that the inline
  width is a no-op there. So the omission is safe *given the current CSS* — a
  replacement with a fixed-height, internally-scrolling editor would need the
  observer.
- The one explicit resize hook is `ED.wrap(on)`, which is a class toggle plus a
  forced repaint — see below.

### 1.10 The soft-wrap toggle

Preference lives in `localStorage` under `rh-wrap` via `flag()` / `setFlag()`; it is
a reading preference, not a per-exercise one.

Server-rendered initial state — the class is in the markup, so mount does no extra
work:
```js
`<div class="editor${wrapOn() ? ' softwrap' : ''}" id="ed"></div>`
```
The button only catches up with the markup on mount (`paintWrapBtn(wrapOn())`); the
editor is told nothing, keeping mount to the one `paint()` `mountEditor` already does.

Toggle:
```js
wrapBtn.addEventListener('click', () => {
  const on = !wrapOn();
  setFlag(WRAP_KEY, on);
  paintWrapBtn(on);      // .on class + aria-pressed
  ED.wrap(on);
  ED.focus();
});
```
```js
wrap(on) { host.classList.toggle('softwrap', on); paint(); }
```
The API is `wrap(on)`, not a bare "repaint" hook, and the comment says why: `paint()`
sizes the textarea with an *inline width that CSS cannot express*, so a caller that
toggled the class and forgot the repaint would leave the caret on the old line width
while the glyphs folded to the new one. Wrapping the two operations together makes
that unrepresentable.

CSS side, four rules, all of which must move together:
```css
.editor.softwrap pre.hl,
.editor.softwrap textarea { white-space: pre-wrap; overflow-wrap: anywhere; }
.editor.softwrap { grid-template-columns: minmax(0, 1fr); }  /* gutter column gone */
.editor.softwrap .gutter { display: none; }
.editor.softwrap .stack { overflow-x: hidden; }
```
The comment warns: not `.wrap` — that is the page container, and it carries padding.

`overflow-wrap: anywhere` (not `break-word`) is chosen because it *does* affect
`min-content` sizing, which is what lets `minmax(0,1fr)` actually shrink.

### 1.11 Key handling (non-vim)

Three cases in one `keydown` listener, which runs *after* vim's (vim attaches
first, in `mountEditor`, and consumes keys before these see them):

- **`Cmd/Ctrl+Enter`** → `preventDefault()` + `onRun()`.
- **`Tab`**:
  - shift or a non-empty selection → indent/dedent every touched line. `from` is
    the start of the selection's first line (`v.lastIndexOf('\n', a-1)+1`); the two
    directions differ only by the per-line map function
    (`(l) => TAB + l` vs `(l) => l.replace(/^ {1,4}/, '')`), and the replacement is
    made with `setRangeText(..., 'select')` so the block stays selected for a repeat.
  - collapsed selection → `setRangeText(TAB, a, b, 'end')`, four spaces.
  - Always `preventDefault()`, so Tab never leaves the editor. (Accessibility
    trade-off: escape is via Vim's `<Esc>` or the mouse; there is no Ctrl+M escape
    hatch.)
- **`Enter`** → auto-indent. Copies the current line's leading whitespace
  (`/^[ \t]*/` over `v.slice(from, a)`) and adds one `TAB` if the text before the
  caret ends in an opener (`/[{([]\s*$/`). No auto-closing brackets, no
  dedent-on-`}`.

`setRangeText` is used throughout rather than `value = ...` because it preserves the
native undo stack — Cmd+Z still works.

### 1.12 The returned handle

```js
return {
  value: () => ta.value,
  set(v) { ta.value = v; errLines = []; lastHl = null; paint(); vim.sync(); },
  reset() { this.set(starter); },
  focus() { ta.focus(); },
  mark(ls) { errLines = ls || []; paint(); },
  wrap(on) { host.classList.toggle('softwrap', on); paint(); },
  vim,
};
```
`set()` must clear `lastHl` manually — the highlight cache is keyed on text, and a
programmatic set can legitimately restore text the cache already holds. It also
clears error marks and calls `vim.sync()` so vim's cached cursor/mode does not point
past the end of the new buffer.

---

## 2. The syntax highlighter

### 2.1 Architecture: there is no state machine

`hlRust(src) -> html` is **one pass, one regex, left to right, stateless.** No
tokenizer states, no lookbehind, no backtracking between rules, no AST. The entire
"state" is `TOK.lastIndex`.

```js
const TOK = new RegExp([
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/,                                   // 1 comments
  /(r#"[\s\S]*?"#|r"[^"]*"|b?"(?:\\.|[^"\\])*")/,                    // 2 strings
  /('(?:\\.|[^'\\])')/,                                              // 3 char literals
  /('[a-zA-Z_][a-zA-Z0-9_]*)/,                                       // 4 lifetimes
  /(#!?\[[^\]]*\])/,                                                 // 5 attributes
  /(\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(?:[iuf](?:8|16|32|64|128|size))?)/, // 6 numbers
  /([A-Za-z_][A-Za-z0-9_]*!)/,                                       // 7 macros
  /([A-Za-z_][A-Za-z0-9_]*)/,                                        // 8 identifiers
].map((r) => r.source).join('|'), 'g');
```

Written as an array of eight separate literals so each can be read, commented and
reordered on its own line, then flattened with `.map(r => r.source).join('|')`.
**One capture group per rule; the group index is the token class.** That coupling is
the whole dispatch:

```js
if (m[1]) cls = 't-cmt';
else if (m[2] || m[3]) cls = 't-str';
else if (m[4]) cls = 't-life';
else if (m[5]) cls = 't-attr';
else if (m[6]) cls = 't-num';
else if (m[7]) cls = 't-mac';
else if (m[8]) { /* identifier post-classification, below */ }
```

**Alternation order is the correctness argument**, stated in the source comment: a
char literal must be tried before a lifetime, or `'a'` reads as the lifetime `'a`
followed by a stray quote. The general rule for this family: *longer and more
specific alternatives first*, and rules 7/8 (macro before bare identifier) are the
second instance of it.

### 2.2 Everything between matches survives

```js
out += esc(src.slice(last, m.index));   // gap before the token
out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
last = TOK.lastIndex;
// ... after the loop:
return out + esc(src.slice(last));
```

Operators, punctuation, whitespace, `&`, `::`, `->`, `=>`, `<`, `>` are never
matched by any rule and fall through as escaped plain text. **This is why "nested
generics" is a non-problem.** There is no bracket matching anywhere: `Vec<Vec<T>>`
tokenizes as three identifiers (`Vec`, `Vec`, `T`, all `t-type` by the capital
heuristic) with `<`, `<`, `>>` as inert text. The `>>` shift-vs-close-generic
ambiguity that costs a real Rust parser a lookahead hack costs this nothing.

`esc()` is applied to *both* the gap and the token, so the output is always
XSS-safe regardless of input; the CSS classes are the only markup that ever enters
the string.

### 2.3 Identifier post-classification

```js
if (KW.has(t)) cls = 't-kw';
else if (KW2.has(t)) cls = 't-kw2';
else if (PRIM.has(t) || /^[A-Z]/.test(t)) cls = 't-type';
else if (src[TOK.lastIndex] === '(') cls = 't-fn';
```

Three keyword sets, and the split into two of them is the design's one genuinely
opinionated decision, argued in the source comment:

- `KW` — **structure**: `as break const continue crate else enum extern false fn for
  if let loop match mod return self Self struct super trait true type use while
  macro_rules union yield`. "The words that tell you what kind of thing you are
  looking at."
- `KW2` — **modifiers**: `async await dyn impl in move mut pub ref static unsafe
  where box try`. The comment: *"in Rust [these] carry most of the meaning a
  newcomer misses… Colouring them apart makes `&mut` visibly different from `&`,
  which is the single most useful thing highlighting can do in this language."*
- `PRIM` — the 17 primitive types + `bool char str`.

Two heuristics, both one line and both cheap:

- **Type by capitalisation**: `/^[A-Z]/`. A Rust naming *convention*, not a rule.
  Also catches `Some`, `None`, `Ok`, `Err`, which is arguably the right answer.
- **Call by one-character lookahead**: `src[TOK.lastIndex] === '('`. Raw source
  index, no whitespace skipping — so `foo()` colours, `foo ()` does not. Method
  calls colour correctly (`x.foo()` → `foo` is an identifier followed by `(`).

### 2.4 Known limitations of the tokenizer

Not bugs so much as the price of statelessness. Each matters if you port the design.

| case | behaviour |
|---|---|
| nested block comments `/* /* */ */` | Rust allows them; the lazy `[\s\S]*?\*\/` stops at the first `*/`, so the tail re-tokenizes as code. |
| `r##"…"##` | not matched (only exactly one `#`). Falls through as `r`, `##`, then a normal string. |
| `br"…"` / `br#"…"#` | not matched (`b?` only precedes plain `"`, and the raw alternatives have no `b?`). |
| nested brackets in an attribute | `#[foo(bar[0])]` stops at the inner `]`. |
| attribute interior | never re-tokenized; the whole `#[...]` is one flat `t-attr` grey. |
| `macro_rules!` | rule 7 (macros) precedes rule 8, so it colours `t-mac`, not `t-kw` — even though `macro_rules` is in `KW`. |
| doc comments `///` `//!` | fold into `t-cmt`; no distinct class. |
| a `'` inside a comment or an unterminated string | can start a spurious lifetime, because rules cannot see each other's context. Mitigated in practice by rule order. |
| string interpolation `format!("{x}")` | not tokenized; the whole literal stays `t-str`. |

### 2.5 Tokens to spans, and the CSS contract

Ten classes, defined at `app.css:964–984` with a full dark-theme override set:

```css
.t-kw   { color: #a1442e; font-weight: 600; }   /* structure keywords */
.t-kw2  { color: #8a5a20; font-weight: 600; }   /* modifiers */
.t-str  { color: #4a7a3d; }
.t-num  { color: #9a5b12; }
.t-cmt  { color: var(--ink-4); font-style: italic; }
.t-mac  { color: #7b4b72; font-weight: 600; }
.t-life { color: #a03060; font-weight: 600; }
.t-type { color: #43607a; }
.t-attr { color: var(--ink-3); }
.t-fn   { color: #2f5f8a; }
```
The stylesheet comment states the intent: *"Colours are deliberately few: a reader
should see structure, not a fruit salad."*

**Hard constraint inherited from §1.3**: token spans may only use properties that do
not change advance width — `color`, `font-weight`, `font-style`. Anything else
desyncs the overlay. In monospace, bold and italic keep their advance, which is why
`font-weight: 600` on four classes is safe.

`hlRust` is used in three places: the live editor (`paint()`), the error snippet
(`WB.snippet`), and — per the export comment at the bottom of the file — **outside
the browser**, at build time, by a separate video/clip project, so that a video and
a page tokenize Rust the same way. It was once deleted as unused; the comment exists
to stop that happening again.

### 2.6 Performance and incrementality

- **Complexity**: O(n) in source length, one `exec` loop, string concatenation into
  `out`. No per-token DOM work — the whole thing is one string handed to
  `innerHTML`.
- **No incremental tokenization at all.** Every call retokenizes the whole buffer.
- **The only incrementality is a whole-buffer equality memo** in `paint()`:
  `if (v !== lastHl)`. That is enough because the expensive half is the DOM, not the
  regex.
- **Measured cost** (from the `paint()` comment, largest project stage): 1.4 ms of
  JS, a 62 KB `innerHTML` parse, ~4000 nodes rebuilt — *per key*. Before the memo
  this ran on every consumed vim key, most of which are motions that change nothing.
- **Reentrancy hazard**: `TOK` is a module-level `const` with the `g` flag, so
  `lastIndex` is shared mutable state. `hlRust` resets it (`TOK.lastIndex = 0`) on
  entry and is synchronous, so nested/concurrent calls cannot happen. A port that
  makes tokenization async or generator-based must give each call its own regex.
- **Scaling ceiling**: at ~1000 lines the `innerHTML` reparse becomes the bottleneck
  and you would need line-windowed rendering (only highlight the visible rows).
  Exercise starters are tens of lines, so it never arrives here.

### 2.7 How much is Rust-specific — and the shape of six replacements

**Reusable unchanged (~40 lines, zero Rust in it):**

- `esc()`.
- The `[...].map(r => r.source).join('|')` assembly.
- The exec loop, the gap-preservation, the `out += cls ? span : esc(t)` emit.
- The identifier post-classification *shape*: keyword-set lookups then heuristics.
- All ten CSS classes and both theme palettes. Every language below maps cleanly
  onto them; two (`t-life`, and sometimes `t-attr`) go unused or get repurposed.
- The advance-width constraint on token styling.
- The alternation-ordering discipline.

**Rust-specific (the ~35 lines you replace):**

- The contents of `KW` / `KW2` / `PRIM`.
- Rules 2–5 (raw/byte strings, char-before-lifetime, `#[...]`).
- Rule 7, `ident!` → macro.
- The `/^[A-Z]/` type heuristic — a Rust/C++/Python convention, wrong for C and
  Verilog.

**Recommended refactor before adding six languages.** With one language a factory
would be over-engineering; with six it is the smaller diff. Shape:

```js
function makeHighlighter({ rules, classify }) {
  const RE = new RegExp(rules.map((r) => r.re.source).join('|'), 'g');
  return function hl(src) {
    let out = '', last = 0, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      const i = m.slice(1).findIndex((g) => g !== undefined);
      const cls = classify(rules[i].cls, m[0], src, RE.lastIndex);
      out += cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]);
      last = RE.lastIndex;
    }
    return out + esc(src.slice(last));
  };
}
```
Then one ~25-line spec per language. **Switch to named capture groups**
(`(?<str>…)`) rather than positional ones — the moment a rule needs an internal
group or a backreference (C++ raw strings do; see below) the index↔class coupling
breaks silently, and named groups cost nothing and fix it permanently.

#### C — the easiest; strictly simpler than Rust

| rule | pattern sketch | class |
|---|---|---|
| comments | `/\*[\s\S]*?\*/ \| //[^\n]*` | `t-cmt` |
| preprocessor | `^[ \t]*#[ \t]*\w+(?:\\\n\|[^\n])*` (multiline flag; `\` continuation) | `t-attr` |
| strings & chars | `"(?:\\.\|[^"\\])*" \| '(?:\\.\|[^'\\])*'` | `t-str` |
| numbers | `0[xX][0-9a-fA-F']+ \| \d[\d']*(\.\d*)?([eE][+-]?\d+)?[uUlLfF]*` | `t-num` |
| identifiers | `[A-Za-z_]\w*` | keyword sets |

- **No char-vs-lifetime problem** — `'` means exactly one thing, so rules 3 and 4
  collapse into one and the ordering hazard disappears.
- `KW` = `if else for while do switch case default break continue return goto
  struct union enum typedef sizeof`. `KW2` = `const volatile static extern register
  inline restrict auto _Atomic _Thread_local` — the storage/qualifier words, a
  genuinely faithful analogue of Rust's modifier class.
- `PRIM` = `int char float double void short long signed unsigned _Bool` + the
  `stdint`/`stddef` names.
- **Drop `/^[A-Z]/`.** C types are lowercase. Replace with `\w+_t$` → `t-type`, and
  `^[A-Z][A-Z0-9_]+$` (ALL_CAPS) → `t-mac`, which is the correct C idiom for
  "this is a macro".
- `t-life` unused. Effort: **lower than Rust.**

#### C++ — C plus one real structural problem

Everything from C, plus:

- Keyword set roughly triples (~90 words) and the KW/KW2 split still works:
  `class template namespace using virtual override final constexpr consteval
  noexcept` in KW; `const mutable static inline explicit friend public private
  protected typename` in KW2.
- `::` scope operator, `->`, `<=>`: inert text, fine.
- Templates: **again free** — no bracket matching means nested `<>` and the `>>`
  ambiguity cost nothing. Same argument as Rust generics.
- `[[nodiscard]]`, `[[maybe_unused]]` → `t-attr`, one extra rule
  `\[\[[^\]]*\]\]`.
- **Raw strings `R"delim(...)delim"` are the one thing that breaks the design.**
  They need a backreference to the delimiter:
  `R"(?<rd>[^()\\ ]{0,16})\([\s\S]*?\)\k<rd>"`. A backreference inside a merged
  alternation requires named groups (positional indices shift), which is the direct
  reason to make the named-group refactor before writing C++.
- Keep `/^[A-Z]/` but expect misses: `std::vector` is lowercase, `MyClass` is not.

#### x86-64 assembly — the one that does not fit the mould

Assembly is the only member of the family where **position within the line is
semantic**. A flat global regex cannot express "the first identifier on a line is a
mnemonic". Recommended shape: **split on `\n`, run an anchored per-line regex for
label + mnemonic, then the flat operand regex on the remainder.**

| element | pattern | class |
|---|---|---|
| comment | `;[^\n]*` (NASM/MASM), `#[^\n]*` (GAS), `//[^\n]*` | `t-cmt` |
| label | `^[ \t]*[.\w$]+:` | `t-fn` |
| directive | `^[ \t]*\.[a-z]\w*` (GAS) or `\b(?:section\|global\|db\|dw\|dd\|dq\|equ\|times)\b` | `t-attr` |
| mnemonic | first identifier after optional label | `t-kw` |
| register | closed set: `%?r[a-z]x\|r(8\|9\|1[0-5])[dwb]?\|e[a-z]x\|[a-z]l\|[xyz]mm\d+\|rip\|rsp\|rbp\|k[0-7]` | `t-kw2` |
| immediate / number | `\$?0[xX][0-9a-fA-F]+\|\$?-?\d+` | `t-num` |
| string | `"…"` (for `.asciz`) | `t-str` |

- Register→`t-kw2` is the right mapping: registers are the "modifier"-weight thing
  the eye needs to pick out, exactly as `mut` is in Rust.
- Do **not** try to enumerate ~1000 mnemonics. Position-based classification is both
  shorter and more correct (it handles `vfmadd231ps` for free).
- Memory operands `-8(%rbp)` / `[rbp-8]` need nothing special: the number and the
  register each match, the brackets fall through.
- Two dialects (AT&T `%rax, $1` vs Intel `rax, 1`) — parameterise, or accept one.
- Effort: **highest of the six**, and the only one that needs a different loop.

#### CUDA — a 20-line delta on C++, not a new tokenizer

Build C++ first and extend its spec. The whole delta:

- Qualifiers → straight into `KW2`: `__global__ __device__ __host__ __shared__
  __constant__ __managed__ __restrict__ __forceinline__ __launch_bounds__`.
  **This is precisely the case the two-keyword-class design exists for** — seeing
  `__shared__` at a glance is the CUDA equivalent of seeing `&mut`.
- Execution config `<<<…>>>`: one literal rule `<<<[^>]*>>>` → `t-mac`, or leave the
  chevrons inert and let the contents tokenize (better: the grid/block expressions
  are real code).
- Builtin variables: `threadIdx blockIdx blockDim gridDim warpSize` → `t-type`.
- Vector types: `(?:float|double|int|uint|char|uchar|short|ushort|long|ulong)[1-4]\b|\bdim3\b`
  → `t-type`.
- Intrinsics: `__syncthreads __syncwarp __shfl_\w+ __ballot_sync atomic[A-Z]\w*` →
  `t-mac`. They read like macros and the macro colour is the right weight.

#### Verilog / SystemVerilog — different lexis, same machinery

| rule | pattern | class |
|---|---|---|
| comments | as C | `t-cmt` |
| compiler directive | `` `\w+ `` (`` `define ``, `` `timescale ``, `` `ifdef ``) | `t-attr` |
| attribute | `\(\*[\s\S]*?\*\)` | `t-attr` |
| system task | `\$\w+` (`$display`, `$finish`, `$random`) | `t-mac` — an exact fit |
| **sized literal** | `\d*'[sS]?[bBoOdDhH][0-9a-fA-FxXzZ_?]+` **before** the plain number rule | `t-num` |
| number | `\d[\d_]*(?:\.\d[\d_]*)?` | `t-num` |
| string | `"(?:\\.\|[^"\\\n])*"` | `t-str` |
| escaped identifier | `\\\S+\s` (backslash to the first whitespace) | plain |
| identifiers | `[A-Za-z_]\w*` | keyword sets |

- **The `'` character means a third different thing here.** Rust: lifetime. C/C++:
  char literal. Verilog: literal base prefix. Its rule must be re-derived per
  language and **never copied**; this is the single most transferable warning from
  the Rust ordering comment.
- `KW` = `module endmodule always always_ff always_comb initial begin end if else
  case endcase for generate endgenerate assign function endfunction task endtask
  posedge negedge`. `KW2` = `wire reg logic input output inout parameter localparam
  signed unsigned automatic const` — the *declaration* words, the true `mut`/`ref`
  analogue.
- **Drop `/^[A-Z]/`.** Verilog module and signal names are conventionally lowercase;
  it would colour almost nothing and mis-colour macro names. Either skip type
  colouring entirely, or use "identifier followed by `#(` or by another identifier"
  as an instantiation heuristic.

#### Python — deceptively the trickiest of the six

One reason: **triple-quoted strings**, which are the only construct in the family
that spans lines without a fixed terminator, and whose rule *must* precede the
single-quote rules. Same class of ordering argument as Rust's char-before-lifetime,
and the thing that will bite whoever writes it.

```js
// ORDER IS LOAD-BEARING: triple before single, always.
/([rbfuRBFU]{0,3}"""[\s\S]*?"""|[rbfuRBFU]{0,3}'''[\s\S]*?''')/   // t-str
/([rbfuRBFU]{0,3}"(?:\\.|[^"\\\n])*"|[rbfuRBFU]{0,3}'(?:\\.|[^'\\\n])*')/  // t-str
/(#[^\n]*)/                                                       // t-cmt
/(@[A-Za-z_]\w*(?:\.\w+)*)/                                       // t-attr — decorators
/(\b(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[jJ]?)/  // t-num
/([A-Za-z_]\w*)/                                                  // identifiers
```

- Decorators map onto `t-attr` perfectly — same visual role as Rust's `#[…]`.
- `KW` = `def class return if elif else for while with try except finally raise
  import from pass break continue lambda yield global nonlocal del assert match
  case`. `KW2` = `as async await not in is and or None True False self cls` — `self`
  is not a keyword in Python but colouring it as one is right *for a reader*, which
  is this highlighter's only audience.
- Builtins (`len print range enumerate zip dict list set str int float` …) →
  `t-fn`, or let the existing `next char is '('` heuristic catch them for free.
- **Keep `/^[A-Z]/`** — PEP 8 CapWords makes it the most reliable of the six.
- **Do not tokenize inside f-strings.** Colour the whole literal `t-str`. The
  alternative is a real recursive state machine, and every lightweight highlighter
  makes the same call.
- Indentation needs nothing: `white-space: pre` already renders it, and it is not a
  token.

#### Effort summary

| language | new rules | keyword sets | heuristics to change | fits the single-`TOK` loop? | relative effort |
|---|---|---|---|---|---|
| C | 5 | 3 sets, small | drop `^[A-Z]`; add `_t$`, ALL_CAPS→macro | yes | 0.6× |
| C++ | 7 | 3 sets, large | keep `^[A-Z]` | yes, **but needs named groups** (raw strings) | 1.0× |
| CUDA | C++ + 4 | C++ + ~20 words | none | yes | +0.2× on top of C++ |
| Verilog | 8 | 3 sets, large | drop `^[A-Z]` | yes | 1.1× |
| Python | 6 | 3 sets, medium | keep `^[A-Z]` | yes | 0.9× |
| x86-64 asm | 7 | 1 closed set (registers) | position-based mnemonics | **no — needs a per-line pass** | 1.5× |

Total: roughly 250 lines of specs plus a 40-line shared engine, against 60 lines of
Rust-specific code today. Do C++ first (it forces the named-group refactor and CUDA
falls out of it), assembly last.

---

## 3. The backend client

### 3.1 Endpoints

```js
const PLAY     = 'https://play.rust-lang.org/execute';
const VERSIONS = 'https://play.rust-lang.org/meta/versions';
```

Both are hit directly from the browser, no proxy, no key, no auth. The design spec
records the verification (2026-08-29): `access-control-allow-origin: *`, POST
allowed, full annotated diagnostics with error codes in `stderr`, and `tests: true`
gives per-test pass/fail. 488 crates are whitelisted server-side, so exercises can
use `anyhow`, `thiserror`, `serde`, `clap`.

### 3.2 Assembling the source

```js
function assemble(code, tests) {
  return {
    source: tests ? code + '\n\n' + tests + '\n' : code,
    userLines: code.split('\n').length,
  };
}
```

**Hidden tests are appended, never prepended.** Stated reason: every line number
rustc reports about the reader's own code still points at the line they are looking
at. Anything past `userLines` came from the tests. `userLines` is the *count of the
user's lines*, i.e. the last line index that is theirs (1-based), and it is the only
piece of information the diagnostics parser needs to distinguish "your bug" from
"the tests could not call your code" (§4.4).

Exactly two `\n` between user code and tests, plus a trailing `\n`. The two-newline
gap means `userLines + 1` is blank and `userLines + 2` is the first test line — the
boundary is never ambiguous.

### 3.3 The request

```js
async function run(code, { tests = null, edition = '2024' } = {}) {
  const { source, userLines } = assemble(code, tests);
  let res;
  try {
    res = await fetch(PLAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'stable',
        mode: 'debug',
        edition,
        crateType: tests ? 'lib' : 'bin',
        tests: !!tests,
        backtrace: false,
        code: source,
      }),
    });
  } catch (e) {
    throw new Error('offline');
  }
  if (!res.ok) throw new Error('playground returned ' + res.status);
  const out = await res.json();
  return { ...out, userLines };
}
```

- **Exactly one header**, `Content-Type: application/json`. No `Accept`, no CORS
  preflight-triggering custom headers — `Content-Type: application/json` alone
  *does* trigger a preflight (it is not a CORS-safelisted value), which the
  playground answers with `ACAO: *`. No credentials, no cookies.
- **Body fields**, all seven required by the playground:
  - `channel: 'stable'` — pinned. Never `beta`/`nightly`; error codes and wording
    must match the `diagnose` prose the exercises were written against.
  - `mode: 'debug'` — faster than release and produces the overflow/panic behaviour
    the exercises teach.
  - `edition` — defaults to `'2024'`, overridable per call. No call site currently
    overrides it.
  - `crateType` — `'lib'` when there are tests, `'bin'` otherwise. This is the
    single switch that decides whether the playground wraps a `main` runner or a
    `cargo test` runner.
  - `tests: !!tests` — turns on the test harness.
  - `backtrace: false` — a backtrace would bury the panic message the parser wants.
  - `code` — the assembled source.
- **`userLines` is stitched onto the response object**, not carried separately:
  `return { ...out, userLines }`. That is what lets `parse(res)` take one argument
  and still know the boundary. Cheap and it means the value cannot get separated
  from the run it describes.

### 3.4 The response shape

```ts
{
  success: boolean,     // true iff the compile (and, with tests, the harness) exited 0
  stdout: string,       // program output, OR the test harness report
  stderr: string,       // rustc diagnostics + cargo bookkeeping
  exitDetail?: string,  // present on some failures; unused here
}
```

Two streams, two different jobs, and the parser comment is emphatic that getting
them backwards is silent:

- **`stderr`** — compiler diagnostics. Blocks of `error[E0382]: …` / `warning: …`
  followed by an indented body carrying `--> src/main.rs:L:C`, the source echo, the
  caret line, and `= note:` / `= help:` lines. Also carries cargo's own bookkeeping
  (`aborting due to 1 previous error`, `warning: \`playground\` (lib) generated 1
  warning`).
- **`stdout`** — the *test harness*. `running 2 tests`, then `test t::adds ... FAILED`
  per test, then a `failures:` section with `---- t::adds stdout ----` and the panic
  text, then `test result: FAILED. 1 passed; 1 failed; …`.

> "Compiler diagnostics arrive on stderr; the test harness reports on stdout.
> Getting that backwards silently produces a run that 'passed' because no test was
> found, so this takes the whole result object rather than a string and reads each
> stream from the right place."

That comment is the reason `parse` takes `res`, not `stderr`.

### 3.5 The version badge

```js
let _tc = null;
function toolchain() {
  if (!_tc) {
    _tc = fetch(VERSIONS)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return null;
        const v = d.stable.rustc;
        return { version: v.version, date: v.date, hash: String(v.hash).slice(0, 9) };
      })
      .catch(() => { _tc = null; return null; });
  }
  return _tc;
}
```

Three things worth copying verbatim:

1. **The promise is cached, not the result.** The comment records the bug: caching
   the result meant two callers in flight before it resolved (the footer and the
   workbench) each fetched.
2. **The cache is cleared on failure** (`.catch(() => { _tc = null; ... })`), so a
   transient network blip does not pin "no version" for the session. Same pattern as
   `app.js`'s `get()`, which does `p.catch(() => cache.delete(url))` for the same
   reason, documented there.
3. **It never blocks a run and never throws.** It resolves to `null` on any failure
   and the caller simply does not paint a badge:
   ```js
   WB.toolchain().then((tc) => {
     const el = $('#toolchain-wb');
     if (el && tc) el.textContent = `rustc ${tc.version}`;
   });
   ```

Response shape of `/meta/versions`: `{ stable: { rustc: {version, date, hash}, rustfmt, clippy, miri }, beta: {…}, nightly: {…} }`.

### 3.6 Timeouts, retries, error handling — what is and is not there

**There is no timeout.** No `AbortController`, no `AbortSignal.timeout`, no
`Promise.race`. A hung request hangs the Run button until the browser gives up
(~300 s in Chrome). This is a real gap and the first thing to fix in a port.

**There are no retries.** One shot per click. Deliberate: a free third-party service
is on the path, and silently tripling load on it would be rude. The `test_workbench.mjs`
header makes the same point about not putting the playground on the critical path
of every run.

**Three error surfaces**, and the distinction between them is the whole point:

| condition | where it is caught | what the reader sees |
|---|---|---|
| network unreachable / CORS / DNS | `try/catch` around `fetch` → `throw new Error('offline')` | *"Could not reach the compiler. The workbench needs a network connection. **This is not your code.**"* |
| HTTP non-2xx (500, 502, 429) | `if (!res.ok) throw new Error('playground returned ' + res.status)` | the raw message, escaped, in a fail verdict |
| compile failure / test failure | not an error at all — a normal 200 with `success:false` | the full diagnostics UI (§4) |

The `'offline'` sentinel and its message are the most quietly important lines in the
file. The source comment:

> "Naming the network is the whole point: a silent failure here reads as 'my code is
> so broken it did not even produce an error'."

Call site (`app.js`, inside `doRun`):
```js
try { res = await WB.run(code, { tests: ex.tests }); }
catch (e) {
  if (stale()) return;
  out.innerHTML = `<div class="verdict fail"><span class="ic">!</span>
    ${e.message === 'offline'
      ? 'Could not reach the compiler. The workbench needs a network connection. This is not your code.'
      : esc(e.message)}</div>`;
  return;
}
```

**Concurrency control** is at the call site, not in the client:

- `let BUSY = false;` module-scoped. `doRun` returns immediately if `BUSY`, sets it
  true, and releases it in a `finally`. The comment: *"The whole body is wrapped so
  BUSY and the button are released on every path: leaving BUSY stuck true disables
  Run for the rest of the session."*
- The Run button is `disabled` for the duration too — belt and braces, because
  `BUSY` alone would leave the button looking live.
- `BUSY` is module-scoped, i.e. **global across exercises**, not per-editor. Two
  editors cannot exist at once in this app, so it holds.

**Staleness** — a run takes seconds and the reader can navigate during them:
```js
const out = $('#out');
const stale = () => !out.isConnected;
```
Every node `doRun` touches is resolved *before* the await and checked with
`isConnected` after it. Otherwise a compile that lands after a navigation writes its
verdict into whatever exercise is on screen now. `Node.isConnected` is the exact
right primitive: the router replaces `#app`'s innerHTML, orphaning the old nodes.

**Slow-service UX** (three simultaneous affordances, because a 1–3 s wait with no
feedback reads as a dead button):
- `#run` gets `.running`, its icon swaps to `ico('spin')` and spins
  (`#run.running .ic { animation: spin 0.7s linear infinite }`).
- `#runbar` unhides — an *indeterminate* 2px sweeping bar
  (`@keyframes sweep { translateX(-100%) → translateX(330%) }` over 1.05 s). The CSS
  comment: *"it sweeps rather than fills, which is the honest shape for that"*,
  because we cannot know how far along a remote compile is.
- `.editor.running::after` — a breathing ring. The comment explains the
  optimisation: `box-shadow` is a paint property, so animating it repaints the whole
  editor every frame for the two or three seconds a compile takes; the ring lives on
  a pseudo-element and only its `opacity` animates, which the compositor handles
  without touching paint.

All three are torn down in the same `finally`.

---

## 4. The diagnostics parser

This is the load-bearing part. `WB.parse(res)` turns two text streams into
`{ errors, warnings, tests }`, and `renderOutput()` turns that into the UI.

### 4.1 The three regexes

```js
const RE_DIAG = /^(error|warning)(?:\[(E\d{4})\])?: (.+)$/;
const RE_LOC  = /^\s*-->\s+src\/\w+\.rs:(\d+):(\d+)/;
const RE_TEST = /^test (\S+) \.\.\. (ok|FAILED|ignored)$/;
```

- `RE_DIAG` is anchored at `^`, which is what makes the block-splitting work:
  rustc's headlines start at column 0 and every continuation line is indented.
  The error code is **optional** — `(?:\[(E\d{4})\])?` — because many diagnostics
  (most warnings, and some errors) have no code. `d[2]` is therefore `undefined`
  for those, normalised to `null`.
- `RE_LOC` deliberately matches `src/\w+\.rs` rather than any path: the playground
  compiles into `src/main.rs` (bin) or `src/lib.rs` (lib), and restricting to those
  prevents a `-->` inside a `note:` that points at a *dependency's* source from
  hijacking the location.
- `RE_TEST` requires the exact libtest line shape, three literal dots.

### 4.2 The block walk

rustc's stderr is a stream of blocks: a headline at column 0, then an indented body.
`parse` walks it linearly, one line at a time, and closes each block when the next
headline starts.

```js
let cur = null;
const close = () => {
  if (!cur) return;
  cur.raw = cur.body.join('\n');
  (cur.kind === 'error' ? errors : warnings).push(cur);
  cur = null;
};

for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  const d = RE_DIAG.exec(ln);
  if (d) {
    close();
    if (/^aborting due to|^could not compile|previous error|generated \d+ warning/.test(d[3])) continue;
    cur = { kind: d[1], code: d[2] || null, msg: d[3], line: null, col: null, body: [ln] };
    continue;
  }
  if (cur) {
    cur.body.push(ln);
    if (cur.line === null) {
      const loc = RE_LOC.exec(ln);
      if (loc) {
        cur.line = +loc[1];
        cur.col  = +loc[2];
        cur.inTests = cur.line > userLines;
      }
    }
  }
}
close();
```

The resulting diagnostic object:

```ts
{
  kind: 'error' | 'warning',
  code: 'E0382' | null,
  msg:  string,        // the headline text after the colon
  line: number | null, // 1-based, in the ASSEMBLED source
  col:  number | null, // 1-based
  inTests: boolean,    // only set when a location was found
  body: string[],      // every raw line of the block, headline included
  raw:  string,        // body.join('\n'), set by close()
}
```

Four things this design gets right and a port must keep:

1. **Bookkeeping is filtered, at the headline, before a block is opened.**
   `aborting due to …`, `could not compile …`, `… previous error`, `generated N
   warning(s)`. The comment states the cost of not doing it: *"a reader shown
   'generated 1 warning (run `cargo fix`)' as a numbered finding goes looking for a
   second problem that does not exist."* Note that `continue` after `close()` means
   the bookkeeping line also correctly terminates the preceding block.
2. **First location wins.** `if (cur.line === null)` — a rustc block can contain
   several `-->` lines (the primary span, then secondary spans in notes pointing at
   a trait definition or a previous borrow). The first is the primary. Taking the
   last would point the caret at library code.
3. **Nothing is thrown away.** Every line of the block goes into `body` and out as
   `raw`, because the raw text stays available to the reader in a `<details>`.
   `notes` and `helps` are **not parsed into separate fields** — they live in `raw`
   and are shown verbatim. That is a deliberate simplification and it is why there
   is no `note:`/`help:` regex anywhere in the file. The prose that *does* get
   structured treatment is the handbook's own `diagnose` entry (§4.5).
4. **Warnings and errors share one walk**, split only at `close()` time on
   `cur.kind`.

### 4.3 Test results, off stdout

```js
for (const ln of String(stdout).split('\n')) {
  const t = RE_TEST.exec(ln);
  if (t) tests.push({ name: t[1], ok: t[2] === 'ok', ignored: t[2] === 'ignored', panic: null });
}

const panicRe = /---- (\S+) stdout ----\n([\s\S]*?)(?=\n----|\n\nfailures:|\n\ntest result:|$)/g;
let p;
while ((p = panicRe.exec(stdout)) !== null) {
  const hit = tests.find((x) => x.name === p[1]);
  if (hit) {
    const m = /panicked at [^\n]*\n([\s\S]*?)(?:\nnote: run with|$)/.exec(p[2]);
    hit.panic = (m ? m[1] : p[2]).trim().split('\n').slice(0, 4).join('\n');
  }
}
```

- Two passes: first the verdict lines, then the `failures:` section keyed by test
  name. The panic regex uses a **lookahead-terminated lazy body** with three
  alternative terminators (`\n----`, `\n\nfailures:`, `\n\ntest result:`, or end),
  because libtest does not delimit the section any other way.
- The inner regex strips the `panicked at src/lib.rs:12:9` location line and keeps
  what follows — which for `assert_eq!` is the
  `assertion \`left == right\` failed / left: 0 / right: 4` block, i.e. the useful
  part — and stops before `note: run with RUST_BACKTRACE=1`.
- **Capped at 4 lines** (`.split('\n').slice(0,4).join('\n')`), because a long
  `Debug` dump of a struct would swamp the row.
- `ignored` is tracked as a third state and counts as a pass later (§5).
- Test names carry their module path (`t::adds`), which is why the tests assert on
  `t::adds` and not `adds`.

### 4.4 Mapping spans back to the editor — the `userLines` boundary

`cur.inTests = cur.line > userLines`. One comparison, and everything downstream
hangs off it.

Because the hidden tests are **appended**, a line number rustc reports is either
≤ `userLines` (the reader's own buffer, same numbering, no offset arithmetic
needed at all) or > `userLines` (inside the tests, where the reader has no source
to look at and no way to fix it directly).

Three consequences:

1. **Gutter marks** — only user-side errors get a red line number:
   ```js
   ED.mark(d.errors.filter((e) => !e.inTests).map((e) => e.line).filter(Boolean));
   ```
   `.filter(Boolean)` drops diagnostics that never found a location.
2. **The snippet is only rendered for user-side errors**, because
   `snippet(code, line, col)` indexes `code` — the *user's* buffer — and a
   test-side line number would either be out of range or, worse, silently echo the
   wrong line. `snippet` guards this itself: `if (!line || line > src.length) return '';`
3. **A test-side error gets a different, hand-written explanation** instead of a
   snippet (§4.6).

**This is the design's cleanest idea and it is worth stating as a rule for the
port**: append the harness, never prepend, so that user line numbers need no
translation and the boundary is a single integer comparison. Any backend that
wraps the user's code (a `main()` shim, a testbench module, a header) should
follow the same discipline, or carry an explicit line offset.

### 4.5 The caret/underline rendering: `WB.snippet`

```js
function snippet(code, line, col) {
  const src = code.split('\n');
  if (!line || line > src.length) return '';
  const text = src[line - 1] ?? '';
  const width = String(line).length;
  const pad = ' '.repeat(width);
  const caretPad = ' '.repeat(Math.max(0, (col || 1) - 1));
  return `<div class="snip"><pre><code>${
    `${pad} |\n${line} | ${hlRust(text)}\n${pad} | ${caretPad}<span class="caret">^</span>`
  }</code></pre></div>`;
}
```

Rendered output, three rows, imitating rustc's own frame:

```
  |
5 |     println!("{s}");
  |                ^
```

Mechanics:

- **The line is echoed from the reader's own buffer**, not from rustc's stderr. The
  comment: *"Showing it here rather than making them count lines in the editor is
  most of what a good error display does."* Echoing from `code` rather than parsing
  rustc's echo means it always matches what is on screen, and it gets **syntax
  highlighted** by `hlRust(text)` for free — the same colours as the editor.
- **Gutter alignment** is done with `' '.repeat(String(line).length)`, so `5 |` and
  `12 |` both line up with their own blank rows. This is a per-snippet width, not a
  global one; each snippet only shows one line so that is sufficient.
- **The caret** is `col - 1` spaces then `<span class="caret">^</span>`. One caret,
  no underline span — rustc's `^^^^^` multi-character underline is *not*
  reproduced, because `parse` only extracts the start column from `-->`, not the
  span length. The full underline remains visible in the raw `<details>`.
  (If you want the underline in a port, it must come from the structured
  `--message-format=json` output or from measuring the caret line in `body`.)
- **Alignment relies on `<pre>` + monospace**: `.diag .snip pre { font-size:
  var(--t-tiny); line-height: 1.55 }` and the inherited `--mono` family. The caret
  column is a character count, so this only works because every glyph on the echoed
  line has the same advance — the *same* constraint as the editor overlay (§1.3),
  and the reason `hlRust`'s spans may only set colour/weight/style.
- `caretPad` clamps at 0 (`Math.max(0, (col||1) - 1)`), so a col of 0 or a missing
  col does not produce `' '.repeat(-1)` and throw.
- `.snip` scrolls horizontally on its own (`overflow-x: auto`) so a long line does
  not widen the card.

### 4.6 The rendered DOM

`renderOutput({ res, d, ex, code, rec, ok, testsRan })` is **pure**: takes only data,
touches no DOM, returns a string. Pulled out of `doRun` explicitly so it can be
tested — the comment: *"it is the densest markup in the app and the place a dropped
class silently costs a reader the difference between a passing and a failing test."*

Everything is written into `<div class="out" id="out">`, which is
`display:flex; flex-direction:column; gap:10px`.

**Staggered entrance.** Every top-level block carries `class="… landing"` and
`style="--i:N"` with `N` incrementing through the whole output. The CSS:
```css
.landing { animation: landin 0.34s var(--ease) both; animation-delay: calc(var(--i, 0) * 55ms); }
```
So the verdict lands first, then each diagnostic, then each test row, 55 ms apart.

#### (a) the verdict — always exactly one, always `--i:0`

```html
<div class="verdict landing pass|fail" style="--i:0">
  <span class="ic">✓|✕</span>
  <span>VERDICT TEXT</span>
  <span class="sub">attempt 3 · 2 hints</span>
</div>
```
Verdict text is a three-way choice:
```js
const verdict = ok
  ? (ex.tests ? 'Compiles, and every test passes.' : 'It compiles.')
  : (res.success ? 'It compiles, but the tests disagree.' : 'rustc said no.');
```
`It compiles, but the tests disagree.` is the important one — it distinguishes a
compile failure from a logic failure, which are entirely different problems.

`.sub` shows `attempt ${rec.tries}` and, only if non-zero, `· N hint(s)`.

Styling: `.verdict.pass` gets a green-tinted surface and its `.ic` animates
(`tick 0.45s`); `.verdict.fail` gets red plus a **single** `shake 0.34s` at +0.1 s.

#### (b) one card per error, in order

```html
<div class="diag landing" style="--i:1">
  <div class="dh">
    <span class="code">E0382</span>            <!-- omitted when code is null -->
    <span class="msg">borrow of moved value: `s`</span>
    <span class="where">line 5</span>          <!-- + " · hidden tests" when inTests -->
  </div>

  <!-- exactly ONE of these two: -->
  <div class="why">                            <!-- when e.inTests -->
    <div class="lbl">💡 This one is in the hidden tests</div>
    <p>The tests call into your code and could not. Usually that means a name or a
    signature does not match what they expect — check the exact function name,
    its parameters and its return type.</p>
  </div>
  <div class="snip"><pre><code>…caret frame…</code></pre></div>   <!-- else, when e.line -->

  <!-- the handbook's own prose, when !inTests AND ex.diagnose[e.code] exists -->
  <div class="why">
    <div class="lbl">💡 What that actually means</div>
    …raw HTML from the exercise JSON…
  </div>

  <details class="raw">
    <summary>rustc's own output</summary>
    <pre>ESCAPED e.raw</pre>
  </details>
</div>

<!-- sibling of the card, not a child, and only when e.code && !e.inTests -->
<div class="errlink">
  <a class="chip mono" target="_blank" rel="noopener"
     href="https://doc.rust-lang.org/error_codes/E0382.html">E0382 in the error index ↗</a>
</div>
```

Notes on the branching, all of it in one expression per slot:

- `${e.code ? `<span class="code">…` : ''}` — no empty chip when there is no code.
- `${e.line ? `<span class="where">line ${e.line}${e.inTests ? ' · hidden tests' : ''}</span>` : ''}`
  — the `where` chip carries the tests marker inline.
- The snippet/hidden-tests choice is a single ternary chain:
  ```js
  ${e.inTests ? `<div class="why">…hand-written explanation…</div>`
              : (e.line ? WB.snippet(code, e.line, e.col) : '')}
  ```
  A diagnostic with no location renders neither — just headline, prose and raw.
- `<details class="raw">` is **always** present. The comment in the design spec:
  *"rustc's raw output stays available in a `<details>`, because learning to read it
  is part of the point."* Styled with a custom `▸`/`▾` marker
  (`.raw > summary::-webkit-details-marker { display: none }` plus a `::before`).
- `.errlink` is a **sibling**, appended after the card's closing tag, so it reads as
  a footnote to the card rather than part of it. `margin-top: -4px` pulls it up
  against the card.

#### (c) test rows, when `testsRan`

```html
<div class="testrow landing ok|no" style="--i:N">
  <span class="dot"></span>
  <span class="nm">t::adds</span>
  <span class="panic">assertion `left == right` failed</span>   <!-- first line only -->
  <!-- or, when no panic: -->
  <span class="panic quiet">ok|failed</span>
</div>
```
Only the panic's **first line** is shown inline (`t.panic.split('\n')[0]`); the
4-line cap from §4.3 exists for other consumers. `.dot` gets a coloured core plus a
3px `box-shadow` halo, green/red/amber.

#### (d) program output, only when there were no tests

```js
if (res.stdout && !testsRan) {
  h += `<div class="stdout landing" style="--i:${++i}"><div class="lbl">Program output</div>
    <pre>${esc(res.stdout)}</pre></div>`;
}
```
The `!testsRan` guard is what stops the libtest report being dumped as if it were
the program's output.

#### (e) warnings, last, folded into one-line rows

```html
<div class="testrow warn landing" style="--i:N">
  <span class="dot"></span>
  <span class="nm">warning: unused variable: `x` (line 3)</span>
</div>
```
Warnings get **no snippet, no prose, no raw details** — deliberately quieter than
errors, and last in the panel, so they cannot compete with the thing that actually
failed.

### 4.7 The `diagnose` lookup

`ex.diagnose` is a **plain object on the exercise JSON, keyed by error code**:

```json
"expect": { "code": "E0432" },
"diagnose": {
  "E0432": "<p><code>unresolved import ansi_paint</code> means name resolution walked the crate graph…</p><p>…</p>"
}
```

Lookup is one expression, guarded three ways:

```js
${!e.inTests && ex.diagnose[e.code] ? `<div class="why">
    <div class="lbl">${ico('bulb', 12)} What that actually means</div>
    ${ex.diagnose[e.code]}</div>` : ''}
```

- `!e.inTests` — no handbook prose for an error the reader cannot see the source of.
- `ex.diagnose[e.code]` — `e.code` may be `null`, and `obj[null]` is a safe `undefined`.
- Truthiness — an empty string means no box.
- **The value is interpolated raw, not escaped.** It is author-written HTML from
  the repo's own `data/ex/*.json`, produced by `build.py` from the content source;
  the trust boundary is the build, not the runtime. A port taking prose from
  anywhere less trusted must escape or sanitise here.
- **`ex.diagnose` is assumed to exist.** `ex.diagnose[e.code]` throws on an exercise
  JSON with no `diagnose` key at all. `build.py` guarantees it; a port should use
  `ex.diagnose?.[e.code]`.

**The map is per-exercise, not global**, and the design spec is explicit about why:

> "The map is per-exercise, not global, because 'what E0382 means' is not useful,
> 'what E0382 means *here*' is."

That is the single most important content decision in the whole workbench, and it is
what makes the fallback (rustc's own text plus the error-index link) acceptable
rather than a failure: codes not in the map degrade to the generic resource.

`ex.expect` is a *different* field — `{code}` or `{msg}` — shown as a chip in the
exercise header (`expect E0432`) so the reader knows which error they are supposed
to produce. It is **not** used to judge the run; it is a label.

---

## 5. Checking and pass state

### 5.1 The hidden tests

They live on the exercise JSON as one string of Rust source:

```json
"tests": "#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn brackets_the_name() {\n        assert_eq!(run(), \"== build ==\");\n    }\n}"
```

- **Never shown to the reader.** There is no UI that renders `ex.tests`. The reader
  learns what is expected from the brief and, when a test fails, from the panic
  message (`assertion left == right failed / left: "…" / right: "== build =="`) —
  which is exactly enough to see the expectation without being handed it.
- **Combined by append only** (§3.2): `code + '\n\n' + tests + '\n'`.
- **`crateType` flips to `'lib'`** and `tests: true`, so the playground runs
  `cargo test` instead of `cargo run`. That is why the fixtures use
  `use super::*;` and why the exercises are written as `pub fn`.
- Exercises with `tests: null` (the `fix` kind, where the whole task is *make it
  compile*) run as a `bin` with `tests: false`.

### 5.2 The pass rule

```js
const testsRan = d.tests.length > 0;
const testsOk  = testsRan && d.tests.every((t) => t.ok || t.ignored);
const ok = res.success && (!ex.tests || testsOk);
```

Read it as two clauses:

- `res.success` — the playground exited 0. **Necessary always.**
- `(!ex.tests || testsOk)` — *if* the exercise has hidden tests, they must all have
  passed. The comment: *"With no hidden tests the bar is simply 'it compiles',
  which is the whole task for a `fix` exercise. With tests, compiling is necessary
  and not enough."*

Three details a port must not lose:

1. **`t.ignored` counts as a pass.** `#[ignore]`d tests do not block.
2. **`testsOk` requires `testsRan`.** If the exercise declares tests but *none were
   found in stdout* — the harness never ran, e.g. a compile error — `testsOk` is
   false and `ok` is false. Without the `testsRan` guard, `[].every(…)` is `true`
   and a run that produced no tests at all would pass. This is precisely the
   silent failure the stdout/stderr comment in `parse` warns about, closed here.
3. **`ok` is computed before `markAttempt`**, and `markAttempt` returns the record
   that `renderOutput` prints as `attempt N`, so the attempt count shown is
   post-increment and includes this attempt.

Note that **warnings never block a pass** — `d.warnings` is not consulted.

### 5.3 Recording the pass

```js
const PKEY = 'rh-progress';
let P = { _streak: { last: null, days: 0, best: 0 } };
const exKey = (unit, n) => `${unit}/${n}`;
const passed = (unit, n) => !!P[exKey(unit, n)]?.passed;

function markAttempt(unit, n, ok, hints) {
  const k = exKey(unit, n);
  const rec = P[k] || { passed: false, tries: 0, hints: 0 };
  rec.tries++;
  rec.hints = Math.max(rec.hints, hints || 0);
  if (ok && !rec.passed) { rec.passed = true; rec.at = Date.now(); }
  P[k] = rec;
  touchStreak();
  saveProgress();
  return rec;
}
```

- **One flat `localStorage` object** under `rh-progress`, keyed `"unit-slug/3"`.
  Nothing leaves the browser (the section header in `app.js` says exactly that).
  Load/save are both wrapped in `try {} catch (e) {}` — private mode, quota,
  disabled storage all degrade to "progress does not persist" rather than throwing.
- **`passed` is monotonic**: `if (ok && !rec.passed)` — once true it never goes
  back, and `rec.at` is stamped only on the first pass. A later failed attempt
  increments `tries` but does not un-pass.
- **`hints` is a high-water mark**: `Math.max(rec.hints, hints || 0)`. `HINTS` is
  reset to 0 on every mount, so without the `max` a second visit that used no hints
  would erase the record that help was needed.
- `_streak` is stored in the same object under a reserved key, which is why every
  aggregate has to filter it out (`Object.keys(P).filter(k => k !== '_streak' && …)`).
- `touchStreak()` runs on **every attempt**, pass or fail — the streak measures
  showing up, not succeeding. Same-day is a no-op; next-day increments; any longer
  gap restarts at 1.

`doneCount(slug, total)` counts passes by probing `1..total`. Its comment records a
real bug: three copies of this existed, one reading `.exercises`, one reading
`.stages`, and one call site fabricating a unit-shaped object — *"The project
workbench sidebar read 0 of 8 forever as a result."*

### 5.4 The pass animation, in four places at once

```js
if (ok) {
  host.classList.add('passed');
  setTimeout(() => host.classList.remove('passed'), 950);
  $$('.exlist a').forEach((a) => {
    if (a.getAttribute('href').endsWith(`/${ex.n}`)) {
      a.classList.add('passed');
      const st = a.querySelector('.st');
      if (st) st.textContent = '✓';
    }
  });
  const total = BENCH[source].count(BENCH[source].meta(slug));
  Companion.cheer(doneCount(slug, total), total);
}
```

1. **A green wash over the editor**, one shot, self-removing after 950 ms (the
   animation is 900 ms):
   ```css
   .editor.passed::before {
     content: ""; position: absolute; inset: 0;
     background: color-mix(in srgb, var(--ok) 22%, transparent);
     pointer-events: none; z-index: 2;
     animation: passsweep 0.9s var(--ease) forwards;
   }
   @keyframes passsweep { from { opacity: 1; } to { opacity: 0; } }
   ```
   The CSS comment gives the reason for the pseudo-element: *"an overlay whose
   opacity fades, rather than an inset box-shadow repainting the interior 54
   times."* Same compositor argument as `.editor.running::after`.
   The class is also **removed at the top of every run** (`host.classList.remove('passed')`)
   so a second pass re-triggers the animation.
2. **The sidebar dot stamps in.** The number is replaced by `✓` and the element gets
   `.passed`, which fires `@keyframes stamp { 0% scale(0.4); 55% scale(1.18); 100% scale(1) }`.
   The CSS comment: *"The exercise's dot in the sidebar filling in is the reward
   that persists, so it gets a real transition rather than a swap."* Matching is by
   `href.endsWith('/' + ex.n)` — string matching on the hash route, which is a
   little loose but the hrefs are all `#/work/slug/N`.
3. **The verdict card lands green** with a ticking `.ic` (§4.6a).
4. **`afterBox` appears** below the output:
   ```js
   const afterBox = (ex, ok) => (ok && ex.after
     ? `<div class="afterbox"><div class="lbl">Now that it compiles</div>${ex.after}</div>` : '');
   ```
   Rendered in two places from one function — server-side in `viewWork` when the
   exercise is already passed, and live in `doRun` the moment it passes. The comment:
   *"One wording, one place."*
5. **The companion, rarely.** `Companion.cheer(done, total)` picks a line from
   FIRST/MID/LAST/REST. Rate-limited to **one line every two minutes** globally
   (`if (Date.now() - lastSpoke < 120000) return;`), fires on the 1st, every 3rd,
   and the last, and is pre-empted entirely after 1.6 h of session time by a
   "take a break" line. The header comment: *"A mascot that comments on everything
   is a mascot you close, and then it cannot say the one thing that mattered."*
   Its own comment records a bug worth copying: the total used to be hardcoded as
   seven, *"which fired five stages early on the twelve stage projects and could
   never fire at all on the four stage ones."*

### 5.5 One bench, two content types

`BENCH` is a two-entry table (`ex` and `project`) that parameterises everything that
differs between a unit's exercises and a project's stages:

```js
const BENCH = {
  ex: { url, items: (d) => d.exercises, meta, count: (m) => m.exercises,
        route: 'work', backHref, backLabel, crumbRoot, noun: 'Exercise' },
  project: { url, items: (d) => d.stages, meta, count: (m) => m.stages,
             route: 'project', backHref, backLabel, crumbRoot, noun: 'Stage' },
};
```
*"A unit's exercises and a project's stages are the same thing, so one bench serves
both."* This is the existing precedent for the multi-backend abstraction in §9 —
the codebase already parameterises a view by a small table of accessors rather than
duplicating it.

---

## 6. Hints

### 6.1 The data

```json
"hints": [
  "Nothing in this file can make `ansi_paint` exist. Only a manifest entry could, and there is no manifest.",
  "`format!` builds a `String` from a template. The test says exactly what the output should look like."
]
```

An ordered array of plain strings on the exercise JSON. Typically two. **Escaped at
render time** (`esc(h)`) — unlike `diagnose` and `brief`, which are author HTML.

### 6.2 The interaction — progressive disclosure, one press at a time

```js
let HINTS = 0;   // module-scoped; reset to 0 in wireWork on every mount

$('#hint').addEventListener('click', () => {
  const hs = ex.hints || [];
  if (HINTS >= hs.length) return;
  HINTS++;
  $('#hints').innerHTML = hs.slice(0, HINTS).map((h, i) =>
    `<div class="hintbox"><div class="lbl">Hint ${i + 1} of ${hs.length}</div>${esc(h)}</div>`).join('');
  if (HINTS >= hs.length) $('#hint').disabled = true;
});
```

- **One press reveals exactly one more hint.** There is no "show all".
- **Revealed hints stack and stay** — `hs.slice(0, HINTS)` re-renders the whole
  list, so hint 1 is still on screen when hint 2 appears. `.hintbox + .hintbox
  { margin-top: 8px }`.
- **Each is labelled `Hint 1 of 2`**, so the reader knows how much help remains
  before spending it. That is the disclosure contract: the *count* is free, the
  *content* costs.
- **The button disables itself** at the end rather than silently no-op'ing.
- **`HINTS` resets to 0 on every mount** (`HINTS = 0;` at the top of `wireWork`).
  Hints are not remembered across navigation — you re-earn the reveal. Only the
  *count* survives, in `markAttempt`'s high-water mark.
- Hints are **independent of running**. You can reveal them without ever pressing
  Run, and revealing one does not trigger a run or a record write. The count is only
  committed to `localStorage` when an attempt is made (`markAttempt(slug, ex.n, ok, HINTS)`).

### 6.3 How solutions are withheld

Deliberately, at four levels:

1. **There is a `solution` field in every exercise JSON, and the app never reads it.**
   `grep solution assets/app.js` returns nothing. It exists for `build.py --check`,
   which compiles every starter and solution against the playground to verify the
   exercise is well-formed (per `docs/AUTHORING.md`). It is shipped in the JSON and
   therefore technically reachable via devtools — the barrier is social, not
   cryptographic, which is the correct level of effort for a study tool.
2. **The hints are hints, not steps.** Look at the two above: the first names the
   *cause* (`use` cannot create a dependency), the second names the *tool*
   (`format!`) and points at the test as the spec. Neither writes a line of code.
   The authoring guide's shape is: hint 1 reframes the error, hint 2 names the
   mechanism.
3. **The hidden tests are never displayed**, so the expectation must be inferred
   from the brief and from a failing assertion's `left`/`right` values.
4. **The `diagnose` prose explains the error, not the fix.** Read the E0432 entry in
   §4.7: it explains what name resolution did and whose fault it is, and mentions
   `cargo add` as the general remedy — while the exercise's actual answer (delete
   the import, use `format!`) is left to the reader.

The reward structure reinforces it: `rec.hints` is a permanent high-water mark, the
verdict card prints `attempt 3 · 2 hints`, and the progress page counts *"needed a
hint"* as a headline statistic:
```js
Object.keys(P).filter((k) => k !== '_streak' && P[k].hints).length
```
Hints are free to take and permanently visible in your own record — which is the
whole design: no gate, but no forgetting either.

---

## 7. Vim mode (`assets/vim.js`, 913 lines)

### 7.1 Why hand-written, and the scope statement

The file header states the constraint and the trade explicitly:

> "Hand-written, because this project ships no JavaScript libraries and pulling in
> CodeMirror to get `@codemirror/vim` would mean replacing the editor and breaking
> that rule for one feature. … What it deliberately does not cover is named
> registers, macros, marks, `.` repeat, and ex commands beyond `:w`. Those matter in
> a real editing session and would double the size of this file for a workbench
> where the longest starter is 53 lines. `Vim.UNSUPPORTED` lists them so the UI can
> be honest."

```js
const UNSUPPORTED = ['named registers', 'macros (q)', 'marks', '. repeat', 'ex commands beyond :w'];
```
Exported so the UI can name its own gaps rather than silently swallowing keys.

### 7.2 Architecture: a pure machine plus a thin DOM shim

Three layers, and the boundary between them is the reason the whole thing is
testable without a browser:

1. **Pure text helpers** (lines 24–229). `(text, index) → index`. `lineStart`,
   `lineEnd`, `lineNo`, `col`, `lineAt`, `firstNonBlank`, `wordFwd`, `wordBack`,
   `wordEnd`, `paraFwd`, `paraBack`, `findChar`, `textObject`, `vertical`,
   `toggleComment`, `stepNumber`, `searchFrom`. No DOM, no state.
2. **`create(opts) → machine`** (lines 235–766). Owns `text` (a closure variable)
   and `st` (the state object). Its only interface is
   `key(k, mods) → boolean /* consumed */`, plus `text` get/set, `setCursor(i)`,
   `label()`, and the raw `state`.
3. **`attach(ta, {paint, onRun, badge, gutter}) → handle`** (lines 782–905). The only
   code that touches the textarea.

`Vim` exports `{ create, attach, isOn, setOn, UNSUPPORTED, _t }` — `_t` being the
pure helpers, exported explicitly *for tests*.

### 7.3 The state object

```js
const st = {
  mode: 'normal',   // normal | insert | visual | vline
  cur: 0,           // cursor index into text
  want: 0,          // desired column for j/k
  count: '',        // count typed AFTER the operator
  opCount: '',      // count typed BEFORE the operator
  op: null,         // pending operator: d c y > < S
  anchor: 0,        // visual-mode start index
  reg: { text: '', linewise: false },   // the single unnamed register
  await: null,      // pending argument: f F t T r, 'g', 'gc', 'i', 'a'
  cmd: null,        // the ':' command line buffer, or null
  find: '',         // last '/' pattern, for n and N
  search: null,     // the '/' prompt buffer, or null
  undo: [],         // [{text, cur}], capped at 200
  redo: [],
  status: '',       // one-line message, shown as the badge's title
};
```

Four modes only. **No operator-pending "mode"** — a pending operator is `st.op`
being non-null while `mode` stays `'normal'`, which is why the `done()`/`abandon()`
discipline below is load-bearing.

### 7.4 The command parser — a pending-state cascade, not a grammar

`key(k, mods)` is one function, and its structure is a **strictly ordered cascade of
pending states**, each of which fully consumes the key and returns:

```
1. mode === 'insert'   → only Escape / Ctrl-[ are ours; everything else returns FALSE
                          (the textarea types it)
2. st.search !== null  → the '/' prompt eats every key
3. st.cmd !== null     → the ':' prompt eats every key
4. st.await            → the argument of f/F/t/T/r, or the 2nd key of g/gc/i/a
5. k === 'Escape'      → reset()
6. digit               → accumulate a count ('0' is a motion unless a count is building)
7. st.op && k === st.op → the doubled form: dd, yy, cc, >>, <<
8. st.op && (i|a)      → arm a text object
9. motion(k, n())      → move, or complete a pending operator
10. the big switch     → everything else
```

**`key` returns `true` if it consumed the key.** In insert mode it returns `false`
for ordinary characters, which is how real typing reaches the textarea unmodified
(with all its native undo, IME and autorepeat behaviour intact) — see §7.10.

**Counts multiply, they do not concatenate.** The comment records the bug:

```js
const num = (c) => Math.max(1, parseInt(c || '1', 10));
const n = () => num(st.opCount) * num(st.count);
```
> "Vim multiplies the count before an operator by the count after it, so `2d3w`
> deletes six words. One string cannot hold two numbers: appending the second to the
> first made `2d3w` mean 23."

Hence the two separate fields, and `case 'd'…` doing
`st.op = k; st.opCount = st.count; st.count = '';`.

**Two terminators, and only two.** This is the most instructive part of the file:

```js
const done = () => { st.count = st.opCount = ''; st.op = null; emit(); return true; };
const abandon = (why) => { if (why) st.status = why; reset(); emit(); return true; };
```
> "Every pending-state branch ends one of two ways. Spelling the epilogue out per
> branch is how `r` and `f` came to leave an operator armed after the command was
> over: the next motion then executed an edit nobody asked for."

And at the bottom of the big switch, the same lesson again:
> "done() clears the operator as well. Spelling this epilogue out by hand was the
> third, unnamed terminator: every `break` in the switch above left `d` armed, so
> `d` then `p` then `w` deleted a word nobody asked to delete."

`test_vim.mjs` has a whole section pinning this (§8), including a loop over the six
keys that reached the epilogue.

**`motion()` returning `null` IS the membership test.** No separate `MOTION_KEYS`
string:
> "a separate MOTION_KEYS string was a second copy of the same list and had already
> drifted (it omitted the space motion, which was therefore unreachable)."

### 7.5 Motions

`motion(key, count) → { to, linewise?, inclusive? } | null`. `to` is where the
cursor goes; an operator uses `[min(cur,to), max(cur,to))` with `inclusive` adding
one, and `linewise` expanding to whole lines in `applyOp`.

| key | behaviour | flags |
|---|---|---|
| `h` `l` | clamped to the current line (`lineStart`/`lineEnd`) | — |
| `<Space>` | forward one char, crosses lines | — |
| `j` `k` | `vertical()`, preserves `st.want` | linewise |
| `w` `W` `b` `B` | word / WORD, count-looped | — |
| `e` `E` | word end, count-looped | inclusive |
| `0` `^` `$` | line start / first non-blank / line end | `$` inclusive |
| `{` `}` | paragraph back / forward (blank-line delimited) | linewise |
| `G` | line `count`, or last line with no count | linewise |
| `H` | index 0 (a screen motion approximated as buffer-top) | linewise |

**Word classes** are real Vim: `klass(c, big)` returns 0 for whitespace, and for a
small motion 1 for `[A-Za-z0-9_]` vs 2 for punctuation — so `w` stops at `=` in
`let x = 1;`. A `W` collapses 1 and 2 into one class.

**`st.want` is the sticky column.** `vertical()` takes it and clamps to the target
line's length, so `jj` through a short line lands where you aimed. It is refreshed
after every motion *except* `j`/`k`:
```js
if (k !== 'j' && k !== 'k') st.want = col(text, st.cur);
```

**`clampNormal`** enforces the block cursor's rule — in normal mode the cursor sits
*on* a character and may not rest past the last one, "the difference that makes `$`
behave". Insert mode is exempt via the `st.mode === 'insert' ? 0 : 1` term.

### 7.6 Operators

`applyOp(op, from, to, linewise)`. Six operators: `d c y > < S`.

- **linewise expansion** happens first:
  `from = lineStart(from); to = min(len, lineEnd(to) + 1)`.
- **`y`** yanks into `st.reg` and does *not* snapshot (no edit).
- **`>` / `<`** shift by exactly 4 spaces (`'    ' + l` / `l.replace(/^ {1,4}/, '')`),
  then land on `firstNonBlank`.
- **`S`** is substitute.nvim's `gs`: replace the range with the register and
  **do not clobber the register** — *"That is the whole point of it."*
- **`c` linewise (`cc`)** is special-cased: keeps the line, preserves its indent,
  empties it, and enters insert on it.
- **`d`/`c`** otherwise: yank to register, delete, and `c` enters insert at `from`
  while `d` clamps.

`paste(before)` handles `p`/`P` with a register that knows if it is linewise. Two
recorded bugs, both worth copying:
- **Guard before snapshot**: *"snapshot() clears the redo stack, so snapshotting
  before deciding there is nothing to paste meant a stray `p` after a `u` threw away
  the redo you were about to use."*
- **Linewise `p` inserts `'\n' + body` at `lineEnd`**, not `body + '\n'` after it:
  *"That works whether or not a line follows and whether or not the buffer ends with
  a newline. Appending to it does not."*

### 7.7 Text objects

`textObject(v, i, kind, obj) → [from, to) | null`, `kind` ∈ `{i, a}`.

- **`w` / `W`** — expands over the class run, line-bounded. `aw` "also eats the
  whitespace after the word, or before it if there is none after. That asymmetry is
  real Vim and it is what makes `daw` leave a sentence correctly spaced."
- **`"` `'` `` ` ``** — quotes have no nesting, so it scans the line, collects
  unescaped quote positions (`v[k-1] !== '\\'`), and pairs them off `0-1, 2-3, …`,
  returning the pair the cursor is inside.
- **brackets** `( ) b [ ] { } B < >` via `PAIRS` / `OPENERS` — walks *out* to the
  enclosing pair with a depth counter in both directions, so `di(` on
  `f(g(x), |y)` correctly takes the outer parens (a pinned test case).
- Returns `null` when there is no such object, and the caller **must** `abandon()`
  so the operator is disarmed — the regression the whole "abandoned command" test
  section exists for.

### 7.8 Registers, undo, search, and the extras

- **Registers**: exactly one, unnamed. `st.reg = { text, linewise }`. `"a`-style
  named registers are in `UNSUPPORTED`. The `linewise` flag is what makes `dd`+`p`
  put the line below rather than inline.
- **Undo**: `st.undo` / `st.redo` are arrays of `{ text, cur }` **whole-buffer
  snapshots**, capped at 200 (`if (st.undo.length > 200) st.undo.shift()`).
  `snapshot()` clears `redo`. Simple, and at 53 lines the memory cost is nothing.
  `u` and `<C-r>` (which arrives as `'R'` with `mods.ctrl`) swap between them.
  **This is a second, parallel undo stack to the textarea's native one** — see the
  caveat in §7.11.
- **Search**: `/` opens a prompt (`st.search`), Enter commits, `n`/`N` repeat via
  `st.find`. **smartcase**, matching the author's own nvim config: *"a lower-case
  pattern matches either case, a pattern with any capital in it is taken
  literally."* Both directions **wrap** (`indexOf` from `i+1`, else `indexOf` from 0).
  Plain substring, not regex.
- **`:` command line**: only `:w`, `:x`, `:wq` do anything — **they run the code**,
  *"which is the muscle memory worth honouring here."* `:q` answers *"nothing to
  quit. This is a workbench"*. Anything else: `not a command: :z`. A command never
  edits the buffer (a pinned test).
- **`gc`** (Comment.nvim): `gcc` this line, `Ngcc` N lines, `gc{motion}`, `gc` over a
  visual selection. `toggleComment` is per-block and biased toward commenting:
  *"if every non-blank line is already commented the block is uncommented, otherwise
  all of them are commented, so a half-commented block ends up fully commented
  rather than inverted."* It also computes the **minimum indent** across non-blank
  lines and inserts `// ` there, so a block keeps its shape. Rust `//` only.
- **`gs` / `gS`** (substitute.nvim), see `applyOp('S')`.
- **`<C-a>` / `<C-x>`** → `stepNumber`, mapped through `CTRL = { a: 'A_INC', x: 'A_DEC', r: 'R' }`.
  Finds the first `-?\d+` on the line whose end is past the cursor (so the number
  *under or after* the cursor), and steps it. Handles negatives (`-1` + 1 = `0`).
- **`jk` to leave insert mode** — a personal mapping, not stock Vim, and carefully
  scoped: it only fires when the `j` was typed within 400 ms
  (`Date.now() - lastJ < 400`), because *"`jk` inside a word you are deliberately
  writing must survive."*

### 7.9 Capability table

| area | implemented | not implemented |
|---|---|---|
| **modes** | normal, insert, visual (`v`), visual-line (`V`) | visual-block (`<C-v>`), replace (`R`), select |
| **motions** | `h j k l <Space> w W b B e E 0 ^ $ { } G H` | `E`-variants of `ge`, `L M`, `%`, `(` `)`, `[[` `]]`, `\|`, `_`, `+` `-` |
| **char search** | `f F t T` | `;` and `,` (repeat) |
| **operators** | `d c y > <` + `gs` (substitute), doubled forms `dd yy cc >> <<` | `!`, `=`, `gu` `gU` `g~`, `gq` |
| **counts** | before and after the operator, multiplied | count on `p`, `o`, `i` |
| **text objects** | `iw aw iW aW`, `i" a" i' a' i` `` a` ``, `i( a( i[ a[ i{ a{ i< a<` (with `b`/`B` aliases) | `it at` (tags), `ip ap` (paragraph), `is as` (sentence) |
| **registers** | one unnamed, with a linewise flag | named `"a`–`"z`, numbered `"0`–`"9`, `"+` clipboard, `"_` |
| **undo** | `u`, `<C-r>`, 200 whole-buffer snapshots | undo tree, `g-`/`g+`, undo blocks per insert session |
| **insert entry** | `i I a A o O c s S C` | `gi`, `gI` |
| **line ops** | `x X D C Y s S J ~ p P` | `gJ`, `xp` variants, `&` |
| **search** | `/`, `n`, `N`, smartcase, wrap, substring | `?`, regex, `*` `#`, `:s///`, incremental highlight |
| **ex** | `:w` `:x` `:wq` (run), `:q` (message) | everything else, and it says so |
| **plugins emulated** | Comment.nvim (`gcc`, `gc{motion}`), substitute.nvim (`gs`, `gS`), mini.ai text objects | — |
| **explicitly out** | — | `Vim.UNSUPPORTED`: named registers, macros (`q`), marks, `.` repeat, ex beyond `:w` |
| **screen motions** | `H` approximated as buffer-top | `M`, `L`, `<C-d>` `<C-u>` `<C-f>` `<C-b>`, `zz` `zt` `zb` |

### 7.10 How it hooks the textarea without breaking the highlight layer

This is the part most relevant to a port. Six mechanisms:

**1. Capture-phase listener, so it sees keys first.**
```js
ta.addEventListener('keydown', onKeyDown, true);   // <- capture
ta.addEventListener('input',   onInput);
ta.addEventListener('mouseup', onInput);
```
`mountEditor` registers its own `keydown` on the *same element* in the bubble phase.
Capture wins.

**2. `stopImmediatePropagation`, because `preventDefault` is not enough.**
```js
const consumed = vim.key(k, { ctrl: e.ctrlKey });
if (!consumed) return;
e.preventDefault();
e.stopImmediatePropagation();
```
> "mountEditor has its own keydown listener on this same textarea, and
> preventDefault does not stop a sibling. Without this, Enter in normal mode was
> consumed here and THEN inserted a newline down there."

Same for Tab in normal mode, which is explicitly swallowed so it cannot reach the
editor's indent handler: *"`>>` is how you indent in normal mode."*

**3. In insert mode, `key()` returns `false` and the browser does the typing.**
Only `Escape` / `<C-[>` are consumed. That means insert mode has native IME,
autorepeat, autocorrect-off, mobile keyboard behaviour and the textarea's own undo —
none of it re-implemented. `onInput` then re-syncs the machine
(`vim.text = ta.value; vim.setCursor(ta.selectionStart)`) *"so a later Escape lands
on the right character."*

**4. Bidirectional sync at both ends of every key.** The machine does not own the
buffer between keystrokes:
```js
vim.text = ta.value;             // read the DOM before deciding
vim.setCursor(ta.selectionStart);
… vim.key(k) …
render();                        // write the DOM after
```
`mouseup → onInput` covers click-to-move-cursor. `ED.set()` calls `vim.sync()` for
programmatic buffer replacement.

**5. `render()` writes back through the *same three primitives* the highlight layer
already understands** — `ta.value`, `setSelectionRange`, and then `paint()`:
```js
const render = () => {
  ta.value = vim.text;
  const m = vim.state.mode;
  if (m === 'insert') ta.setSelectionRange(cur, cur);
  else if (m === 'visual' || m === 'vline') { …setSelectionRange(a, b)… }
  else ta.setSelectionRange(c, Math.min(len, c + 1));   // block cursor
  ta.parentElement.parentElement.dataset.vim = on ? 'vim-' + (m === 'vline' ? 'visual' : m) : '';
  if (gutter) gutter(on ? lineNo(vim.text, vim.state.cur) : null);
  if (badge) { badge.hidden = !on; badge.textContent = vim.label(); badge.dataset.mode = m; badge.title = vim.state.status || ''; }
  paint();
};
```
**The highlight layer is never touched directly.** Vim knows nothing about `pre.hl`;
it changes `ta.value` and calls the `paint` callback it was handed. That is the
entire contract, and it is why the two files stay independent.

**6. The block cursor is a one-character selection**, not a rendered element:
> "normal mode's cursor sits ON a character, so show it as a one-character
> selection. Without this you cannot tell `h` from `i`."

Which is only possible because the textarea's text is transparent and `::selection`
still paints its background (§1.2). The mode is exposed as `data-vim` on
`ta.parentElement.parentElement` — i.e. `textarea` → `.stack` → `.editor` — and CSS
does the rest: `caret-color: transparent` in normal, accent background in normal,
a 34%-alpha accent in visual (§1.8).

**Performance note**: `render()` calls `paint()` on *every consumed key*, including
pure motions. That is exactly why `paint()` has the `if (v !== lastHl)` memo — it is
the vim layer that made the highlight cache necessary.

### 7.11 Known rough edges

- **Two undo stacks.** Vim's `u` and the textarea's native Cmd+Z are separate.
  Typing in insert mode goes through the textarea (native undo), but `snapshot()`
  is taken on entering insert, so `u` reverts the whole insert session. Cmd+Z in
  normal mode does something else entirely. Not reconciled.
- **`ta.value = vim.text` in `render()` destroys the native undo stack** for the
  keys vim handles. Unavoidable without `execCommand('insertText')`.
- **`H` is buffer-top, not screen-top** — there is no viewport model.
- **`.` repeat is absent**, which is the one omission a habitual vim user will feel
  most, and it is named in `UNSUPPORTED`.
- **`;`/`,` are absent** despite `f`/`F`/`t`/`T` being present.
- The preference is a bare `localStorage` key `rh-vim`, read/written through
  try/catch (`isOn` returns `false` on a throw — pinned by a test).
- `#vim` is `desk-only` in the markup: the button is hidden on phones.

---

## 8. Tests

Two suites, both **plain node, zero dependencies, no test framework**. CI asserts
that state:
```yaml
- name: Assert there are no dependencies
  run: |
    test ! -f package.json || (echo "package.json appeared" && exit 1)
    test ! -f requirements.txt || (echo "requirements.txt appeared" && exit 1)
```

### 8.1 How they load the code under test

Both files use the same trick to load a classic script that has no exports:

```js
const WB  = eval(fs.readFileSync('assets/workbench.js','utf8') + '\nWB');
const Vim = eval(fs.readFileSync('assets/vim.js', 'utf8') + '\nVim');
```
Read the file, append the global's name as a trailing expression, `eval`. No build,
no bundler, no `module.exports` polluting the browser file. It works precisely
because each asset is one IIFE assigned to one `const`.

Shared 5-line harness in both:
```js
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(…); };
…
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

### 8.2 `test_workbench.mjs` (61 lines) — an integration test against the live compiler

It really compiles Rust on `play.rust-lang.org`. Five programs, and the header
records the optimisation:

> "The five compiles below are independent, so they go out together. Serially this
> suite took 9.7 s, which was forty times the other three combined and put a free
> third-party service on the critical path of every run."

```js
const RUNS = await Promise.all([ …five WB.run(…) calls… ]);
```

| # | program | what it pins |
|---|---|---|
| 1 | use-after-move (`takes(s)` then `println!("{s}")`) | one error; `code === 'E0382'`; `line === 5 && col === 16` |
| 2 | `add(a,b) = a - b` with two tests | 2 tests found; `t::adds` failed, `t::zero` passed; the panic text contains `left: 0` |
| 3 | `add(a,b) = a + b` with one test | `res.success === true`; no errors; the test passed |
| 4 | `fn main(){ let x = 5; }` | **exactly 1 warning** — that cargo's `generated 1 warning` bookkeeping is filtered — and that it is the unused-variable one |
| 5 | valid `f()` with a test calling an undefined `nope()` | `errors[0].inTests === true` (the `userLines` boundary) |

Five assertion groups, sixteen `ok()` calls. Note what it asserts: the **parser's**
output shape, never the rendered HTML. It is the contract test for `WB.run` +
`WB.parse` together, and it is the only test in the repo that touches the network —
which is why it is gated behind `--net` in `release.sh` and behind
`if: github.event_name != 'pull_request'` in CI.

**It does not cover**: the offline path, the `!res.ok` path, `WB.snippet`,
`hlRust`, `mountEditor`, `renderOutput`, or the pass rule in `doRun`. (Note that
`renderOutput` was extracted from `doRun` and made pure explicitly *so it can be
tested* — but the test does not exist yet; `test_views.mjs` covers other views.)

### 8.3 `test_vim.mjs` (323 lines) — a pure unit suite with a readable notation

No DOM, no network, ~150 assertions. The header:

> "The motion and operator logic is pure, so none of this needs a DOM. Each case
> writes the buffer with `|` marking the cursor, sends keys, and compares against
> the expected buffer-with-cursor. That notation is worth the small parser: a
> failing case reads as the edit you meant to make."

The whole harness is three functions:
```js
function parse(s) { const cur = s.indexOf('|'); return { text: s.replace('|',''), cur: cur < 0 ? 0 : cur }; }
const show = (text, cur) => text.slice(0, cur) + '|' + text.slice(cur);

function keys(v, s) {
  const seq = s.match(/<[^>]+>|./gs) || [];
  for (const k of seq) {
    if (k === '<Esc>') v.key('Escape');
    else if (k === '<CR>') v.key('Enter');
    else if (k === '<C-r>') v.key('R', { ctrl: true });
    else if (v.state.mode === 'insert') {   // emulate the textarea typing
      const { cur } = v.state;
      v.text = v.text.slice(0, cur) + k + v.text.slice(cur);
      v.setCursor(cur + 1);
    } else v.key(k);
  }
}

function t(name, start, seq, want) { … got === want … }
```
So a case reads: `t('dw deletes a word', 'let |x = 1;', 'dw', 'let |= 1;')`.

Note the insert-mode branch of `keys()` — it **emulates what the real textarea
does**, because `vim.key()` deliberately returns `false` there (§7.10.3). Getting
that emulation right is what makes the suite faithful.

Coverage by section, in file order:

| section | count | notable cases |
|---|---|---|
| motions | 19 | `l` stops at end of line; `h` stops at start; `j past a short line keeps want`; `2G`; `f reports a miss` |
| counts | 3 | `3l`, `2w`, `2j` |
| insert | 7 | `o keeps indent`, `I inserts at first non-blank` |
| delete and change | 11 | `x stops at line end`, `2dd`, `cc empties the line` |
| yank and put | 4 | `dd then p` (linewise placement), `yw then P` |
| undo | 4 | `u then <C-r> redoes`; **`u at the oldest change is safe`** |
| visual | 3 | `V then d takes the line` |
| indent | 3 | `>> then << round-trips` |
| misc | 6 | `~`, `J`, `J at the last line does nothing`, **`an unknown key is swallowed`** |
| cursor clamp | 2 | `$ on a one-char line`, `l cannot leave the line` |
| text objects | 12 | `daw eats the space`, `di( nests correctly`, `an absent object is safe` |
| `gc` | 5 | `gcc round-trips`, `2gcc takes two lines`, `gcc keeps indent` |
| `gs` | 2 | `gsw pastes the register over a word`; **`gs did not clobber the register`** |
| search | 7 | smartcase both ways, `n`/`N`, wrap, `not found` status, the `/` label |
| `<C-a>`/`<C-x>` | 4 | including `let x = -1;` → `0` and `9` → `10` |
| **abandoned commands** | ~15 | the regression suite, below |
| `:` command line | 11 | `:w` runs exactly once, `:q` message, unknown command named, Backspace on empty closes, **a command never edits the buffer** |
| mode labels | 7 | `NORMAL`/`INSERT`/`VISUAL`/`V-LINE`, a pending count shows, a pending operator shows |
| storage | 6 | writes `rh-vim`, reads back, **and a throwing `localStorage` does not crash** |

**The "abandoned command" section is the most valuable thing in the file** and is
worth reproducing wholesale in any port. It has its own explanatory comment:

> "Regression: a text object that did not match, or an unrecognised `g<key>`, left
> `st.op` armed. The next motion then executed an edit nobody asked for, with no
> error shown and nothing to suggest anything had happened."

It uses a second assertion helper, `tText`, that checks **only the text** — because
the trailing motion is *expected* to move the cursor; what must not happen is an
edit:
```js
tText('failed di( edits nothing',      'let |x = 1;', 'di(w', 'let x = 1;');
tText('failed da" edits nothing',      'let |x = 1;', 'da"w', 'let x = 1;');
tText('unknown g key edits nothing',   '|alpha beta', 'dgzw', 'alpha beta');
tText('unknown gc motion edits nothing','|alpha beta','gcqw', 'alpha beta');
```
plus a loop over the six keys that used to reach the hand-written epilogue:
```js
for (const k of ['p', 'x', 'J', 'u', '~', 'P']) {
  const v = Vim.create(); v.text = 'alpha beta gamma'; v.setCursor(0);
  v.key('d'); v.key(k);
  ok(`d then ${k} leaves no operator armed`, v.state.op === null);
}
```
and assertions that the *reason* is reported (`/no i\(/.test(v.state.status)`),
not just that nothing happened.

The storage section installs a fake `globalThis.localStorage`, then a **throwing**
one, and asserts `Vim.isOn()` returns `false` rather than crashing — the private-window
case.

### 8.4 How they run

```sh
node test_vim.mjs          # offline, ~150 assertions, instant
node test_workbench.mjs    # network, 5 live compiles in parallel
```

`release.sh --check` owns the sequence, *"so that CI and a release cannot disagree
about what 'verified' means"*:

```sh
python3 test_build.py   > /dev/null
node     test_views.mjs > /dev/null
node     test_vim.mjs   > /dev/null

if [ "$net" = "--net" ]; then
  node test_workbench.mjs > /dev/null     # against the live compiler
  python3 build.py --validate | tail -2   # compiles EVERY exercise + solution
fi
```

CI (`.github/workflows/ci.yml`) has two jobs:
- **build** — runs `./release.sh --check` (offline suites only) on every push and PR.
- **compiler** — `if: github.event_name != 'pull_request'`, 25-minute timeout,
  compiles every exercise. The comment: *"it depends on a third party being up. It
  runs on main and on demand, not on every push to a branch, to keep the load on a
  free service proportionate."*

**The four-suite split is itself the lesson for a port**: pure logic offline and
fast, network integration gated and rare, and a separate content validator that
compiles every exercise's starter *and* solution to prove the exercise is
well-formed.

---

## 9. Extension plan: four backends behind one interface

### 9.0 Where the Rust coupling actually lives

Before designing anything, the honest inventory. Ten coupling points, and only four
of them are big:

| # | site | coupling | size |
|---|---|---|---|
| 1 | `WB.run` | endpoint, body shape, response shape, `crateType`/`edition`/`channel` | **big** |
| 2 | `WB.parse` | `RE_DIAG` (E-codes), `RE_LOC` (`src/*.rs`), `RE_TEST` (libtest), cargo bookkeeping filter, panic section format | **big** |
| 3 | `WB.toolchain` | `/meta/versions`, `d.stable.rustc` | small |
| 4 | `hlRust` | the whole tokenizer | **big** (§2) |
| 5 | `renderOutput` | `'rustc said no.'`, the `e.code` chip, `doc.rust-lang.org/error_codes/…`, the hidden-tests paragraph | medium |
| 6 | `doRun` pass rule | `res.success && (!ex.tests || testsOk)` | one line |
| 7 | `WB.snippet` | calls `hlRust` directly | one line |
| 8 | `ex.diagnose` | **an object keyed by error code** | **big — see §9.2** |
| 9 | `assemble` | `code + '\n\n' + tests` | small, and worth keeping |
| 10 | `vim.js` `toggleComment` | `//` hardcoded | one line |

**Everything else is language- and backend-agnostic already** and should be moved
across untouched. That is the headline finding: the workbench is about 200 lines of
Rust-specific code inside ~2000 lines of reusable machinery.

### 9.1 The backend interface

Deliberately small. Four implementations justify an interface; they do not justify a
plugin registry, a lifecycle, or an event bus. One object literal per backend and one
lookup table.

```js
/* A backend is a plain object. No class, no registration, no base. */
const BACKENDS = { sim, godbolt, yosys, modal };

/** @typedef */
const BackendShape = {
  id:      'godbolt',        // key in BACKENDS, and what the exercise JSON names
  lang:    'cpp',            // key into HIGHLIGHTERS (§2.7)
  comment: '//',             // for vim's gcc
  network: true,             // gates the offline message and the CI job

  /** Optional. Warm a WASM module / probe an endpoint. Cached promise, never
   *  throws, never blocks a run. Same discipline as toolchain() (§3.5). */
  async prepare() {},

  /** Optional. The version badge. Resolves to a string or null; never throws. */
  async label() { return 'gcc 13.2'; },

  /** The only required method.
   *  @param req  { source, tests, exercise }
   *  @param ctx  { signal: AbortSignal, progress(text) }
   *  @returns    RunResult
   *  @throws     Error('offline') | Error(<human message>)
   */
  async run(req, ctx) { … },
};
```

**The normalised result** — every backend produces this, and nothing downstream ever
sees a backend-specific shape:

```js
RunResult = {
  built:  boolean,       // did the tool accept the input at all
  diags:  Diag[],        // errors and warnings, in source order
  tests:  Test[],        // [] when the exercise has no tests
  stdout: string,        // program / simulation output, for the "Program output" box
  raw:    string,        // the full unmodified tool output, for the <details>
  userLines: number,     // the §4.4 boundary
  meta:   {},            // backend extras: cell count, timings, container id
}

Diag = {
  severity: 'error' | 'warning' | 'note',
  code:     string | null,   // rustc E-codes; GCC/Clang -W flags; else null
  msg:      string,          // as emitted
  norm:     string,          // normalised for matching — see §9.2
  line:     number | null,   // 1-based, in the ASSEMBLED source
  col:      number | null,   // 1-based
  endLine:  number | null,   // optional, enables a real underline in snippet()
  endCol:   number | null,
  inTests:  boolean,
  raw:      string,          // this diagnostic's own block
}

Test = { name: string, ok: boolean, ignored: boolean, panic: string | null }
```

`Diag` and `Test` are **exactly today's shapes plus three fields** (`severity`,
`norm`, `endLine`/`endCol`). That is deliberate: `renderOutput`, `ED.mark`,
`WB.snippet` and the pass rule all keep working with a one-line change each.

**The judging stays outside the backend**, in one shared function, because it is a
*pedagogical* rule, not a tool rule:

```js
function judge(result, ex) {
  const testsRan = result.tests.length > 0;
  const testsOk  = testsRan && result.tests.every((t) => t.ok || t.ignored);
  const hardFail = result.diags.some((d) => d.severity === 'error');
  return result.built && !hardFail && (!ex.tests || testsOk);
}
```
Identical logic to today (§5.2), with `res.success` replaced by
`built && !hardFail` because three of the four backends have no exit code.

### 9.2 `diagnose` must stop being keyed by error code

**This is the single largest change and it is a data-format change, not a code
change.** Today:

```json
"diagnose": { "E0432": "<p>…</p>" }
```

rustc's `E0432` is a stable, documented, greppable identifier. **Nothing else in the
new set has one.** Compiler Explorer returns severity, line and column but no code.
Yosys emits prose. A JS simulator emits whatever you write. So the lookup must
become an **ordered rule list, first match wins**:

```json
"diagnose": [
  { "code": "E0382", "html": "<p>…</p>" },
  { "match": "^cannot bind non-const lvalue reference of type .* to an rvalue", "html": "<p>…</p>" },
  { "match": "\\bsyntax error, unexpected\\b", "html": "<p>…</p>" },
  { "match": ".", "html": "<p>generic fallback for this exercise</p>" }
]
```
```js
function explain(ex, d) {
  for (const r of ex.diagnose || []) {
    if (r.code && r.code === d.code) return r.html;
    if (r.match && new RegExp(r.match, 'i').test(d.norm)) return r.html;
  }
  return null;
}
```

Ordered, so a specific rule can precede a catch-all. `code` still works, so the
Rust content ports mechanically (`{E0382: html}` → `[{code:'E0382', html}]`).

**Normalisation is the whole ballgame for match-by-message**, because compiler text
embeds things that vary between runs, versions and users. `norm` must be produced
once, in the parser, and both the rule authoring and the matching must use it:

```js
function normalise(msg) {
  return msg
    .replace(/[‘’“”«»]/g, "'")  // GCC's ‘smart’ quotes → '
    .replace(/^<source>:\d+:\d+:\s*/, '')                     // CE's file prefix
    .replace(/^[^\s:]+\.(c|cc|cpp|cu|v|sv|py|s|asm):\d+(:\d+)?:\s*/, '')
    .replace(/\s*\[-W[a-z0-9-]+\]\s*$/, '')                   // the flag suffix (kept separately)
    .replace(/\s+/g, ' ')
    .trim();
}
```

Five things this must handle, learned the hard way by anyone who has done it:

1. **Smart quotes.** GCC emits `‘x’` (U+2018/U+2019); Clang emits `'x'`. A rule
   written against one will never match the other. Fold them all to `'`.
2. **The file:line:col prefix.** CE's `stderr[].text` includes `<source>:5:16: error: …`
   as *text*, while the structured `tag` has the location separately. Strip it from
   the message so the rule is about the message.
3. **`[-Wunused-variable]` suffixes.** These are the **closest thing C/C++ has to a
   stable error code**, and they should be lifted into `Diag.code` before being
   stripped from `norm`:
   ```js
   const wflag = /\[-W([a-z0-9-]+)\]\s*$/.exec(msg);
   diag.code = wflag ? '-W' + wflag[1] : null;
   ```
   That gives warnings a stable key and lets `{code: '-Wreturn-type'}` rules work
   exactly like `{code: 'E0382'}` ones. Errors still get `null`.
4. **Whitespace and template noise.** Collapse runs of whitespace. C++ template
   expansions in messages are unbounded; write rules that anchor on the stable head
   (`^cannot bind non-const lvalue reference`) and never try to match the type.
5. **Anchoring.** Rules should start with `^` where possible. An unanchored `.` in a
   catch-all is fine as an explicit last entry, but an unanchored middle rule will
   swallow later ones.

**The build must validate the rules.** `build.py --check` already compiles every
starter and solution; extend it to assert that **every exercise's starter produces at
least one diagnostic that some `diagnose` rule matches**. Without that, a compiler
upgrade silently reverts every exercise to bare tool output, and nobody notices for
months. This is the mitigation for losing stable error codes, and it is not optional.

### 9.3 Generalising the text parser

Three of the four backends produce **text**, not JSON, and all three want the same
block walk. Extract `parse()` into a spec-driven helper and keep the algorithm
verbatim (§4.2) — the walk, `close()`, the bookkeeping filter, first-location-wins,
and `raw` preservation are all backend-independent:

```js
function parseText({ stderr = '', stdout = '', userLines = Infinity }, spec) {
  // spec = { diag: RegExp, sev(m), code(m), msg(m), loc: RegExp, skip: RegExp, test?: RegExp }
  …exactly today's loop, with spec.diag / spec.loc / spec.skip substituted…
}
```

Specs:

```js
const RUSTC = {
  diag: /^(error|warning)(?:\[(E\d{4})\])?: (.+)$/,
  sev: (m) => m[1], code: (m) => m[2] || null, msg: (m) => m[3],
  loc:  /^\s*-->\s+src\/\w+\.rs:(\d+):(\d+)/,
  skip: /^aborting due to|^could not compile|previous error|generated \d+ warning/,
  test: /^test (\S+) \.\.\. (ok|FAILED|ignored)$/,
};

const YOSYS = {
  diag: /^(ERROR|Warning)\s*:?\s*(.+)$/,
  sev: (m) => (m[1] === 'ERROR' ? 'error' : 'warning'),
  code: () => null, msg: (m) => m[2],
  loc:  /([\w.\/]+\.s?v):(\d+)(?::(\d+))?/,   // yosys inlines the location in the message
  skip: /^Executing |^End of script/,
};
```

Note the shape difference worth calling out: **rustc puts the location on its own
`-->` line; yosys and GCC put it inside the message.** So `loc` must be allowed to
match the headline itself, not only the body — a two-line change to the walk
(`RE_LOC.exec(ln)` also attempted on the headline).

### 9.4 Backend (a) — the in-page JS logic simulator

The easy one, and it should be built first because it forces the interface without
any network.

```js
const sim = {
  id: 'sim', lang: 'js', comment: '//', network: false,
  async run({ source, exercise }, ctx) {
    const t0 = performance.now();
    let mod, diags = [], tests = [];
    try {
      // new Function, not eval: no closure over the app's scope, and a syntax
      // error is thrown at construction with a usable message.
      mod = new Function('"use strict";' + source + '\n;return typeof module!=="undefined"?module:this;')();
    } catch (e) {
      return { built: false, diags: [jsSyntaxDiag(e, source)], tests: [], stdout: '', raw: String(e.stack || e), userLines: … };
    }
    for (const c of exercise.cases) {
      try {
        const got = mod[exercise.entry](...c.in);
        const ok = deepEqual(got, c.out);
        tests.push({ name: c.name, ok, ignored: false,
                     panic: ok ? null : `expected ${fmt(c.out)}, got ${fmt(got)}` });
      } catch (e) { tests.push({ name: c.name, ok: false, ignored: false, panic: String(e.message) }); }
    }
    return { built: true, diags, tests, stdout: '', raw: '', userLines: source.split('\n').length,
             meta: { ms: performance.now() - t0 } };
  },
};
```

Points that matter:

- **`new Function`, not `eval`.** It compiles in global scope, so the exercise cannot
  reach the app's variables, and a `SyntaxError` arrives at *construction* time with
  `e.lineNumber`/`e.stack` you can turn into a `Diag`. `eval` would inherit the local
  scope and leak `P`, `ED`, and everything else. This is **not** a security boundary
  (the user is running their own code in their own tab), it is a hygiene boundary.
- **Line numbers**: `new Function` prepends a wrapper line, so a stack-derived line
  number is off by a fixed amount. Compute it once against a known-bad probe at
  startup rather than guessing per-engine. Or accept `line: null` and lose the
  snippet, which is honest and cheaper.
- **No timeout is possible on the main thread.** An infinite loop in the user's code
  hangs the tab, permanently. Either accept it (a study tool; the reader reloads) or
  run in a Worker with `worker.terminate()` after N seconds. **Recommendation: a
  Worker.** It is ~30 lines, it is the only way to survive `while(true){}`, and the
  same Worker plumbing is needed for yosys anyway (§9.6) — build it once here.
- **Test cases move into the exercise JSON** as data (`cases: [{name, in, out}]`)
  rather than source, which is the sim's version of "hidden tests". Same withholding
  discipline: never rendered, and only the diff on failure is shown.
- Everything else — `judge`, `renderOutput`, `markAttempt` — works unchanged.

### 9.5 Backend (b) — Compiler Explorer

Two hard requirements from the brief: **no stable error codes** (§9.2 solves it) and
**aggressive caching** (below).

```js
const godbolt = {
  id: 'godbolt', lang: 'cpp', comment: '//', network: true,

  async label() { /* GET /api/compilers/c++?fields=id,name,semver → the pinned one */ },

  async run({ source, tests, exercise }, ctx) {
    const { source: full, userLines } = assemble(source, tests);   // §3.2, unchanged
    const nonce = crypto.randomUUID();
    let r;
    try {
      r = await fetch(`https://godbolt.org/api/compiler/${exercise.compiler}/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        signal: ctx.signal,
        body: JSON.stringify({
          source: full,
          lang: exercise.lang || 'c++',
          allowStoreCodeDebug: false,
          options: {
            // THE NONCE. In userArguments, not in the source: the cache key covers
            // options too, so this busts it without shifting a single line number.
            userArguments: `${exercise.flags || '-O1 -std=c++20 -Wall -Wextra'} -DRH_NONCE=${nonce.replace(/-/g,'')}`,
            compilerOptions: { executorRequest: true, skipAsm: true },
            filters: { execute: true },
            executeParameters: { args: [], stdin: '' },
            tools: [], libraries: [],
          },
        }),
      });
    } catch (e) { throw new Error(ctx.signal.aborted ? 'aborted' : 'offline'); }
    if (!r.ok) throw new Error('Compiler Explorer returned ' + r.status);
    const j = await r.json();
    …
  },
};
```

**The nonce.** CE caches a compilation keyed on the full request — source, compiler
id and options — and returns the cached response including its original `timings`.
Two identical submissions therefore look identical, which breaks "attempt 2 took
longer" and, worse, hides the fact that anything ran. Three places the nonce could
go, and only one is right:

| where | verdict |
|---|---|
| appended source comment `// nonce: …` | works, but adds a line to the buffer. Harmless *only* because tests are appended and the nonce goes after them — still, it pollutes the source shown in the raw output. |
| a `#define` in the source | shifts every line number by one. **Never.** |
| **`options.userArguments` as `-DRH_NONCE=…`** | **correct.** The cache key covers options, the user's source is byte-for-byte what they typed, no line shifts, and an unused macro cannot change a diagnostic. |

Use `crypto.randomUUID()` with the hyphens stripped so it is a valid macro token.

**Parsing the response — this backend does *not* use `parseText`.** CE hands you
structured diagnostics already, which is the whole reason to prefer it:

```json
{
  "code": 1,
  "stdout": [{"text": "…"}],
  "stderr": [{
    "text": "<source>:5:16: error: 'x' was not declared in this scope",
    "tag": { "file": "<source>", "line": 5, "column": 16,
             "endline": 5, "endcolumn": 17,
             "severity": 3, "text": "'x' was not declared in this scope" }
  }],
  "execResult": { "didExecute": true, "code": 0,
                  "stdout": [{"text":"…"}], "stderr": [{"text":"…"}],
                  "buildResult": { "code": 0, "stderr": [...] } },
  "timings": [{"step":"Compilation","time":"312"}]
}
```

```js
const SEV = { 1: 'note', 2: 'warning', 3: 'error' };

const diags = j.stderr.filter((l) => l.tag).map((l) => {
  const msg = l.tag.text;
  const w = /\[-W([a-z0-9-]+)\]\s*$/.exec(msg);
  return {
    severity: SEV[l.tag.severity] || 'error',
    code: w ? '-W' + w[1] : null,          // §9.2 point 3
    msg,
    norm: normalise(msg),
    line: l.tag.line ?? null,
    col:  l.tag.column ?? null,
    endLine: l.tag.endline ?? null,        // enables a REAL underline (§9.8)
    endCol:  l.tag.endcolumn ?? null,
    inTests: (l.tag.line ?? 0) > userLines,
    raw: l.text,
  };
});
```

Notes:

- `severity` is Monaco's `MarkerSeverity`: **1 = hint/info, 2 = warning, 3 = error**
  (some compilers also emit 8 for info). Map defensively and default to `'error'`.
- **Lines without a `tag` are still needed for `raw`** — they are the source echo,
  the caret line, the `note: candidate is:` continuations. Keep the whole
  `j.stderr.map(l => l.text).join('\n')` as `RunResult.raw`, exactly as today's
  `cur.body` does.
- **`endcolumn` is the gift.** rustc's parser never captured a span length (§4.5), so
  the snippet shows a single `^`. CE gives you `line/column/endline/endcolumn`, so
  the port can render rustc's *own* `^~~~~~` underline properly. Do it (§9.8).
- **Notes and helps arrive as separate `stderr` entries with `severity: 1` and their
  own tags.** Unlike rustc's format they are not indented under a headline. So the
  port should **attach** them: fold consecutive `severity: 1` entries onto the
  preceding non-note diag as `d.notes[]`, and render them under the message. This is
  a genuine improvement over the Rust version, which leaves notes in `raw`.
- **Execution result is separate**: `j.execResult.didExecute`, `.code`, `.stdout`.
  `built = j.code === 0`. Program output for the "Program output" box comes from
  `execResult.stdout`, not `j.stdout` (which is the *compiler's* stdout).
- **Tests**: CE has no test harness. Two options — (i) append a `main()` that runs
  assertions and prints `test NAME ... ok|FAILED`, so the existing `RE_TEST` walk
  works verbatim over `execResult.stdout`; (ii) judge on exit code alone.
  **Take (i).** It reuses §4.3 unchanged and gives per-test rows for free, and it is
  a ten-line harness in C.
- **Rate limits and etiquette**: CE is a free service, same posture as the playground.
  One request per click, no retries, and the CI job that compiles every exercise runs
  on main only. If it becomes a problem, self-host — CE ships a Docker image, which
  is a strictly better answer than backing off.
- **Pin `exercise.compiler`** (e.g. `g132`, `clang1701`) per exercise. Diagnostics
  wording *is* the content here; a floating compiler id silently rewrites every
  `diagnose` rule's target. Pin it, and let §9.2's build check catch drift.

### 9.6 Backend (c) — `yowasp-yosys` as WASM in the page

Structurally the most different: no network at request time, a large one-time load,
and a synchronous engine that must not run on the main thread.

```js
const yosys = {
  id: 'yosys', lang: 'verilog', comment: '//', network: false,

  // Cached promise, never the result — the §3.5 lesson applies verbatim.
  _worker: null,
  prepare() {
    if (!this._worker) this._worker = spawnYosysWorker();   // resolves when WASM is instantiated
    return this._worker;
  },

  async run({ source, tests, exercise }, ctx) {
    ctx.progress('loading the synthesiser');
    const w = await this.prepare();
    ctx.progress('synthesising');
    const files = {
      'design.v': source,
      'golden.v': exercise.golden || '',        // the hidden reference module
      'run.ys':   exercise.script || DEFAULT_SCRIPT,
    };
    const out = await w.call({ files, args: ['-q', '-s', 'run.ys'] }, ctx.signal);
    …parseText({ stderr: out.stderr, stdout: out.stdout, userLines }, YOSYS)…
  },
};
```

**Loading.**
- `@yowasp/yosys` is an ES module wrapping a multi-megabyte `.wasm`. **Lazy-load it
  on the first Run, never on page load** — the handbook is a reading site first, and
  a 15 MB download on `#/track` is unacceptable.
- Use a dynamic `import()` inside the worker. That is the one place the "no
  dependencies, no build step" rule genuinely has to bend; it should bend *inside
  one file* so the rest of the site stays plain scripts.
- Cache aggressively: the `.wasm` should carry a far-future `Cache-Control` and a
  hashed filename. Add it to `vercel.json`'s headers.
- If the build ever needs `SharedArrayBuffer` (threads), it needs
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
  require-corp` — which would break the Google Fonts `<link>` in `index.html`.
  **Prefer the single-threaded build** and avoid the whole problem.

**Why a Worker is mandatory here.** Yosys synthesis is a synchronous C++ program
compiled to WASM; a nontrivial design takes seconds and there is no yield point. On
the main thread that is a frozen tab — no spinner, no runbar, no `Escape`. The
existing "running" UI is *specifically designed* for an async wait (§3.6) and would
simply not paint. So: worker, `postMessage` in, `postMessage` out,
`worker.terminate()` on abort. This is the same worker plumbing §9.4 wants, so
build one small `runInWorker(url, payload, signal)` helper and use it twice.

**The filesystem shape.** `@yowasp/yosys`'s entry point takes an input file tree and
returns an output tree — it does not have a real FS. So "hidden tests" become
*additional files plus a script*, which is a clean fit for the append-vs-prepend
rule: the user's module is its own file, so **its line numbers are never offset at
all** and `userLines` degenerates to "was the error in `design.v`". Make `inTests`
key on the *filename* rather than the line number for this backend:
```js
inTests: (locFile && locFile !== 'design.v'),
```
That is a strictly better boundary than the integer comparison, and worth noting as
the general rule: **use separate files when the tool supports them, and fall back to
append+`userLines` only when it does not.**

**Judging a hardware exercise.** There is no `cargo test`. Three ladder rungs:

1. **It synthesises.** `built = exit 0 && no ERROR lines`. Enough for early exercises.
2. **Formal equivalence against a hidden golden module** — the right answer for
   combinational and most sequential exercises:
   ```
   read_verilog design.v golden.v
   prep -top top
   miter -equiv -flatten -make_assert gold impl miter
   sat -verify -prove-asserts -show-ports miter
   ```
   The verdict regex is then `/SAT proof finished.*SUCCESS!/` vs `/FAIL/`, which
   slots straight into `spec.test`.
3. **A simulation testbench** via `sim -vcd`, when the exercise is about timing.

Emit one synthetic `Test` row per check so `renderOutput`'s `.testrow` markup is
reused verbatim. `meta` is the natural home for the extras a hardware reader
actually wants — cell count, LUT count, max logic depth from `stat` — and those
deserve a small new block in `renderOutput` beside "Program output".

**Diagnostics.** Yosys writes `ERROR: …` and `Warning: …` with the location inline
(`design.v:12: syntax error, unexpected …`). Use the `YOSYS` spec from §9.3.
`diagnose` rules are all `match`-based; yosys messages are stable across versions in
practice, and anchoring on the head (`^syntax error, unexpected`) is reliable.

### 9.7 Backend (d) — a user-deployed Modal endpoint, submit-then-poll

The only backend with a **user-supplied base URL** and the only one with a
**multi-round-trip protocol**. Both need new machinery.

```js
const modal = {
  id: 'modal', lang: 'cuda', comment: '//', network: true,

  base: () => localStorage.getItem('hh-modal-url') || null,

  async label() {
    const b = this.base(); if (!b) return null;
    const r = await fetch(b + '/health', { signal: AbortSignal.timeout(4000) });
    return r.ok ? (await r.json()).gpu : null;      // e.g. "A10G · CUDA 12.4"
  },

  async run({ source, tests, exercise }, ctx) {
    const b = this.base();
    if (!b) throw new Error('No endpoint configured. Deploy the runner and paste its URL in Settings.');
    const { source: full, userLines } = assemble(source, tests);

    ctx.progress('submitting');
    const sub = await postJSON(b + '/submit',
      { source: full, exercise: exercise.n, kind: exercise.kind }, ctx.signal);

    const deadline = Date.now() + 120000;          // hard cap; Modal cold starts are slow
    let wait = 400;
    for (;;) {
      if (Date.now() > deadline) throw new Error('The runner did not answer in two minutes.');
      await sleep(wait, ctx.signal);
      wait = Math.min(wait * 1.5, 3000);           // capped exponential backoff
      const s = await getJSON(`${b}/status/${sub.job_id}`, ctx.signal);
      if (s.state === 'queued')  { ctx.progress('queued'); continue; }
      if (s.state === 'booting') { ctx.progress('starting a GPU container, this takes about 30 seconds'); continue; }
      if (s.state === 'running') { ctx.progress('running on the GPU'); continue; }
      if (s.state === 'error')   throw new Error(s.message || 'The runner failed.');
      return normaliseModal(s.result, userLines);  // state === 'done'
    }
  },
};
```

What this forces into the shared layer, all of which is **absent today**:

1. **`ctx.progress(text)` and somewhere to show it.** Today the wait is entirely
   indeterminate (§3.6) — a spinner and a sweeping bar and nothing else. A Modal
   cold start is 20–40 s, which is four to ten times longer than a playground
   compile, and an unexplained 30-second wait reads as broken. Add a status line
   under `#runbar` that `ctx.progress` writes into. **The `.runbar` sweep animation
   and the `.editor.running` breathe stay exactly as they are** — they are already
   the honest shape for an unknown duration; they just gain a caption.
2. **A real `AbortController`.** Today there is none anywhere (§3.6). Modal makes it
   mandatory: a poll loop that outlives a navigation is a leak that keeps hitting
   the user's own billed endpoint. Wire it into the existing `stale()` discipline:
   ```js
   const ctl = new AbortController();
   const stale = () => { if (!out.isConnected) ctl.abort(); return !out.isConnected; };
   ```
   and pass `ctl.signal` down. Add a matching abort in the router's teardown.
   **`sleep()` must honour the signal too**, or the loop stalls for up to 3 s after
   an abort.
3. **A settings surface** for the base URL, plus a validation ping on save. Store it
   under its own key, never inside `rh-progress` (which is exported/reset as a unit).
   And **never send it anywhere**: it is the user's own infrastructure.
4. **Backoff with a cap, plus a hard deadline.** 400 ms → ×1.5 → capped at 3 s, with
   a 120 s ceiling. Without the cap a long job polls every 30 s and feels dead;
   without the deadline a stuck job spins forever.
5. **A different offline story.** `Error('offline')`'s message says *"The workbench
   needs a network connection. This is not your code."* For Modal it must instead
   distinguish *no endpoint configured*, *endpoint unreachable*, and *endpoint
   returned an error* — three different actions for the reader. Make the message a
   backend concern: `backend.offlineMessage` or just a thrown `Error` with real text.

`normaliseModal` runs `parseText` over whatever the container captured (`nvcc`
stderr for CUDA, plus a test-harness stdout), using an `NVCC` spec that is the
`GCC` spec with the same shape — `nvcc` diagnostics are GCC-flavoured, so §9.2's
normalisation and `-W` extraction apply unchanged.

### 9.8 What must change in the shared layer

Concrete diff list, in the order it should be done:

| # | change | size |
|---|---|---|
| 1 | `hlRust` → `HIGHLIGHTERS[lang]` via `makeHighlighter(spec)` (§2.7). `mountEditor(host, starter, onRun, hl)` takes the function; `snippet(code, line, col, hl, endCol)` too. | ~40 lines engine + specs |
| 2 | `WB.run` → `BACKENDS[id].run(req, ctx)`; keep `assemble()` and the `userLines` convention as a shared export. | mechanical |
| 3 | `WB.parse` → `parseText(streams, spec)` + per-backend specs; Godbolt bypasses it. | ~20 lines of parameterisation |
| 4 | `WB.toolchain` → `backend.label()`; `#toolchain-wb` prints whatever it returns. | trivial |
| 5 | `ex.diagnose` object → ordered rule list + `explain(ex, d)` + `normalise(msg)`. **Data migration.** | §9.2 |
| 6 | Add `AbortController` + `ctx.signal` end to end, and a hard timeout. | ~15 lines |
| 7 | Add `ctx.progress(text)` and a status caption under `.runbar`. | ~10 lines + CSS |
| 8 | `renderOutput`: verdict wording from `backend.verdict(ok, res, ex)`; the code chip becomes an optional tag (may be `-Wfoo` or absent); `.errlink` href from `backend.docUrl(d)` returning `null` for most. | ~15 lines |
| 9 | `renderOutput`: render `d.notes[]` under the message (CE gives them structured; rustc's stay in `raw`). | new, small |
| 10 | `snippet`: use `endCol` to draw `^~~~~` instead of a lone `^` when the backend supplies it. | 3 lines |
| 11 | `judge(result, ex)` extracted from `doRun`. | 5 lines |
| 12 | `vim.js` `toggleComment` takes the comment token; `attach` gains `comment` in its options. | 3 lines |
| 13 | A `runInWorker(url, payload, signal)` helper, used by the sim and by yosys. | ~30 lines |
| 14 | `build.py --check` asserts every exercise's starter produces a diagnostic that some `diagnose` rule matches. | **not optional** (§9.2) |

### 9.9 What is reused completely unchanged

Worth being explicit, because it is most of the codebase:

- **The whole editor overlay** — the DOM, every CSS metric in §1.3, the scroll sync,
  the `pre.scrollWidth` width push, the trailing-newline space, the two paint memos,
  the gutter, the softwrap toggle, Tab/Enter handling, `setRangeText` for undo
  preservation. Only the `hlRust(v)` call is parameterised. **This is the highest-value
  piece to lift verbatim and the easiest to get subtly wrong from scratch.**
- **All of `vim.js`** except one comment token. Nothing in it knows about Rust; it is
  a text machine. The pure-core / thin-DOM-shim split and the `done()`/`abandon()`
  discipline transfer as-is.
- **The entire progress layer**: `PKEY`, `exKey`, `passed`, `markAttempt` (including
  the monotonic pass and the hints high-water mark), `doneCount`, `touchStreak`,
  and the try/catch'd `localStorage` access.
- **Hints**, entirely (§6) — the one-press-one-hint disclosure, the `Hint i of n`
  label, the disable-at-end, the reset-on-mount, and the withholding discipline.
- **`BENCH`**, `pickEx`, `afterBox`, `pagenav`, `crumbs`, `ring`, `unitCard`.
- **`Companion`**, including the two-minute rate limit and the `cheer(done, total)`
  signature (the hardcoded-seven bug is already fixed).
- **Every line of the output-panel CSS**: `.out`, `.verdict` (+ tick, + shake),
  `.diag`, `.dh`, `.snip`, `.why`, `.raw`, `.testrow`, `.errlink`, `.stdout`,
  `.hintbox`, `.afterbox`, the `.landing` `--i` stagger, `.editor.passed::before`,
  `.runbar` sweep, `#run.running` spin, `.exlist a.passed .st` stamp. All ten `.t-*`
  token classes and both theme palettes.
- **The concurrency discipline**: `BUSY` + `disabled` + `finally`, and `stale()` via
  `isConnected` with every node resolved before the await. Add abort; keep the shape.
- **`assemble()` and the append-never-prepend rule** (§4.4) wherever a backend cannot
  use separate files.
- **The test harness style**: `eval(readFileSync(...) + '\nName')`, the 5-line `ok()`,
  the `|`-marks-the-cursor notation, the offline/network suite split, and
  `release.sh --check` owning the sequence so CI and a release cannot disagree.

### 9.10 Build order

1. **`makeHighlighter` + the C++ spec.** No backend needed; visible immediately; forces
   the named-group decision (§2.7).
2. **The `Backend` interface + the JS simulator + the worker helper.** No network, so
   the interface can be proved and the abort/progress plumbing built and tested
   offline.
3. **The `diagnose` rule-list migration + `normalise()` + the build check.** Do this
   *before* the first message-matched backend, not after — retrofitting it across
   written content is far more expensive.
4. **Compiler Explorer.** The nonce, the structured-diag path, the `-W` pseudo-code,
   the notes attachment, the `endcolumn` underline.
5. **CUDA on Modal.** Reuses CE's normalisation; adds submit-then-poll, the settings
   surface, and the progress caption.
6. **yosys.** Largest asset, most different judging model, best done once the worker
   helper and the file-based `inTests` boundary are proven.
7. **x86-64 assembly highlighting last** — it is the one tokenizer that needs a
   different loop (§2.7), and by then everything else is stable.
