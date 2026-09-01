# The Rust Handbook: application architecture and every user flow

Reproduction reference, derived by reading the source at
`/Users/madalintat/learning_series/rust_learning`.

Files that constitute the application:

| Path | Lines | Role |
|---|---|---|
| `index.html` | 98 | Static shell. Chrome, mount points, script order. |
| `assets/app.js` | 1406 | Router, all views, all wiring, progress, search, glossary. |
| `assets/workbench.js` | 376 | `WB` global: Rust tokenizer, playground client, diagnostic parser, editor. |
| `assets/vim.js` | 913 | `Vim` global: optional modal editing inside the editor textarea. |
| `assets/companion.js` | 76 | `Companion` global: the mascot that speaks occasionally. |
| `assets/app.css` | ~1830 | Design tokens, accents, every component. |
| `build.py` | ~1400 | Markdown in `content/` → JSON in `data/` + `llms.txt`. |

There is **no build step for the frontend**. No bundler, no modules, no
framework, no virtual DOM. Views are functions returning HTML strings;
`app.innerHTML = html` is the entire render. Four plain `<script>` tags load in
dependency order at the end of `<body>`, sharing state through three globals
(`WB`, `Vim`, `Companion`) — `app.js` is last and defines nothing global that
the others need.

---

## 1. Bootstrap and routing

### 1.1 Page load to first paint

Ordered exactly:

1. **`<head>` inline script, before any paint** — the only thing that must not
   flash:
   ```js
   try { document.documentElement.dataset.theme = localStorage.getItem('rh-theme') || 'light'; }
   catch (e) {}
   ```
   Light is the default. `data-theme="light"` is also hardcoded on `<html>` in
   the served markup.
2. Google Fonts (`Inter`, `JetBrains Mono`) via `preconnect` + a stylesheet
   link; then `assets/app.css`. Favicon and apple-touch-icon are
   `assets/ferris.png`.
3. The static chrome paints from markup, not from JS: `header.topbar`
   (brand link `#/` with the mascot `<img class="mascot">`, empty `<nav id="nav">`,
   `<button id="llms">`, GitHub link `#gh`, `<label class="searchbox"><input id="q">`,
   `<button id="theme">`), `<main id="app"><div class="loading">loading…</div></main>`,
   empty `<nav class="tabbar" id="tabbar">`, `#scrim` and `#sheet` (both `hidden`),
   and `footer.site` with empty `#footstats` and `#toolchain`.
4. Scripts execute in order: `companion.js`, `vim.js`, `workbench.js`, `app.js`.
   Each is a top-level IIFE assigned to a `const` global. No `defer`/`module`, so
   the DOM already exists when they run.
5. `app.js` top level runs: it resolves `app = $('#app')`, creates the fetch
   `cache = new Map()`, and installs the **permanent, document-level listeners**
   (these are never torn down and never rebound):
   - `document.mouseover` / `document.mouseout` → glossary term popover
   - `window.scroll` → `closePop`
   - `document.click` on `[data-toggle]` → reading toggles
   - `#scrim` click, `#sheetclose` click, `#sheet` click-on-`<a>` → `closeSheet`
   - `window.keydown` Escape → `closeSheet`
   - `#theme` click → theme swap + `localStorage['rh-theme']`
   - `#llms` click → copy `llms.txt`
   - `#q` keydown Enter → `location.hash = '#/search/' + encodeURIComponent(...)`
   - `window.hashchange` → `render`
6. The final IIFE `start()`:
   ```js
   (async function start() {
     loadProgress();
     try { DB = await get('data/manifest.json'); }
     catch (e) {
       app.innerHTML = '<div class="loading">Could not load the handbook data. '
         + 'Run <code>python3 build.py</code> and serve the directory.</div>';
       return;
     }
     await render();
   })();
   ```
   `loadProgress()` is synchronous localStorage. `data/manifest.json` is the
   **only unconditional fetch** and the only hard dependency: if it fails,
   nothing else is attempted.
7. `render()` builds the view string, assigns `app.innerHTML`, sets `CURRENT`,
   calls `paintChrome(hash)`, `syncToggles()`, `scrollTo({top:0,behavior:'instant'})`,
   then the view's `after()` wiring function.
8. `paintChrome` fills `#nav`, `#tabbar` and `#footstats` from `DB.totals`, then
   calls `paintToolchain()`, which is idempotent (`if (el.dataset.done) return`)
   and fires exactly one network call per session:
   `WB.toolchain()` → `https://play.rust-lang.org/meta/versions`.

### 1.2 Fetching and caching

One helper, `get(url)`:

```js
async function get(url) {
  if (!cache.has(url)) {
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
    p.catch(() => cache.delete(url));   // evict rejected promises
    cache.set(url, p);
  }
  return cache.get(url);
}
```

The **promise** is cached, not the result, so two concurrent callers for the
same URL share one request. Rejections are evicted so a transient network blip
does not pin "Not here" onto a unit that exists for the rest of the session.
Cache lives for the session only; there is no service worker, no
`localStorage` caching of JSON, no HTTP cache manipulation.

What is fetched, and when:

| URL | Fetched by | When |
|---|---|---|
| `data/manifest.json` | `start()` | always, once |
| `data/unit/<slug>.json` | `viewUnit` | on `#/unit/<slug>` |
| `data/ex/<slug>.json` | `viewWork` then `wireWork` | on `#/work/<slug>[/n]` (second call is a cache hit) |
| `data/project/<slug>.json` | `viewProject`, `viewWork(...,'project')`, `wireWork` | on `#/project/...` |
| `data/drills/<slug>.json` | `viewDrills` | on `#/drills/<slug>` |
| `data/glossary.json` | `viewGlossary` | first visit to `#/glossary` only (also memoised into `GLOSS`) |
| `data/search.json` | `searchAll` | first search only |
| `llms.txt` | `#llms` click | on demand, `fetch` + `navigator.clipboard.writeText` |
| `https://play.rust-lang.org/meta/versions` | `WB.toolchain()` | once, lazily, promise-cached in `_tc` |
| `https://play.rust-lang.org/execute` | `WB.run()` | per Run press |

**There is no prefetching of any kind.** No `<link rel="prefetch">`, no
hover-intent warming, no speculative fetch of the next unit. The only
pre-emptive work is the font `preconnect` in `<head>`.

### 1.3 The hash router

`render()` is the whole router. It is 60 lines and does no pattern matching:

```js
const hash = location.hash || '#/';
const [, route, a, b] = hash.split('/');
```

`'#/unit/05-ownership/moves'.split('/')` → `['#','unit','05-ownership','moves']`,
so `route`, `a`, `b` are positional segments 1–3. Anything past segment 3 is
silently discarded.

**Full route table:**

| Hash | route / a / b | View | Wire | Data |
|---|---|---|---|---|
| `#/` (or empty hash) | `''` | `viewHome()` | — | manifest only |
| `#/track` | `track` | `viewTrack()` | — | manifest only |
| `#/unit/<slug>` | `unit`/slug | `await viewUnit(a)` | `wireUnit` | `unit/<slug>.json` |
| `#/unit/<slug>/<sectionId>` | `unit`/slug/id | same + `jumpTo(b)` after render | `wireUnit` | same |
| `#/work/<slug>` | `work`/slug | `await viewWork(a, b)` → exercise 1 | `wireWork(a,b)` | `ex/<slug>.json` |
| `#/work/<slug>/<n>` | `work`/slug/n | `await viewWork(a, b)` | `wireWork(a,b)` | same |
| `#/projects` | `projects` | `viewProjects(null)` | — | manifest only |
| `#/projects/<domain>` | `projects`/domain | `viewProjects(a)` | — | manifest only |
| `#/project/<slug>` | `project`/slug | `await viewProject(a)` | `wireUnit` | `project/<slug>.json` |
| `#/project/<slug>/<n>` | `project`/slug/n | `await viewWork(a, b, 'project')` | `wireWork(a,b,'project')` | same |
| `#/drills/<slug>` | `drills`/slug | `await viewDrills(a)` | `wireDrills` | `drills/<slug>.json` |
| `#/progress` | `progress` | `viewProgress()` | `wireProgress` | manifest + localStorage |
| `#/glossary` | `glossary` | `await viewGlossary()` | `wireGlossary` | `glossary.json` |
| `#/search/<encoded>` | `search`/q | `await viewSearch(decodeURIComponent(a \|\| ''))` | — | `search.json` |
| anything else | — | `notFound()` | — | — |

Params are raw string segments. The only decoding is `decodeURIComponent` on
the search query. Exercise numbers are coerced and clamped inside `pickEx`:

```js
function pickEx(data, nRaw) {
  const n = Math.min(Math.max(1, +nRaw || 1), data.exercises.length);
  return data.exercises.find((e) => e.n === n) || data.exercises[0];
}
```

So `#/work/05-ownership/999` silently renders exercise 8, and
`#/work/05-ownership/banana` renders exercise 1. No redirect, the URL stays
wrong.

**Unknown routes** call `notFound()`, which renders a centred card with the
mascot at 120px, "Not here.", "That unit may not be written yet.", and a button
to `#/track`. `notFound()` is also the catch-all for *any* thrown error:

```js
} catch (e) { console.error(e); html = notFound(); }
```

A 404 on `data/unit/xyz.json`, a malformed JSON body, or a bug in a view all
surface as the same "not written yet" page with the real error only in the
console. Individual views also return `notFound()` deliberately for
`!meta`, `!meta.ready`, `!B.count(meta)`, `!meta.drills`.

### 1.4 Mount, teardown, scroll

**Mount** is `app.innerHTML = html`, then `after()`. Wiring is always
*post-paint* and always uses `$`/`$$` against the freshly written DOM.
Where a target is dynamic (drill options, glossary letters) the listener is
**delegated** onto a stable container (`#qs`, `#letters`) rather than bound
per-element.

**Teardown** is implicit: `innerHTML` assignment drops every node and, with
it, every listener bound to those nodes. Three things need explicit cleanup and
get it:

- `railWatch` — an `AbortController` holding the rail's `scroll` and `resize`
  listeners, which are on `window`, not on the discarded subtree:
  ```js
  if (railWatch) railWatch.abort();
  railWatch = new AbortController();
  addEventListener('scroll', onScroll, { passive: true, signal: railWatch.signal });
  addEventListener('resize', onScroll, { passive: true, signal: railWatch.signal });
  ```
  Without the abort, every unit read would leak a handler pinning a detached DOM.
- `closePop()` and `closeSheet()` at the top of `render()`.
- Module-level view state reset by the next mount: `ED` (editor handle),
  `HINTS` (reset to 0 in `wireWork`), `BUSY` (guarded by `try/finally`).

**Scroll restoration: there is none.** Every real navigation does
`scrollTo({ top: 0, behavior: 'instant' })`. Going back from an exercise to a
unit puts you at the top of the unit, not where you were. The one exception is
the in-page jump fast path, which returns before touching scroll:

```js
if (route === 'unit' && b && CURRENT === `unit/${a}`) {
  closePop(); closeSheet(); jumpTo(b); return;
}
```

`CURRENT` is set after every mount as `route ? `${route}/${a ?? ''}` : ''`, so
it identifies the page, not the section. This is why contents links are
full routes (`#/unit/<slug>/<id>`) rather than bare fragments — a bare
`#some-heading` would be parsed by this router as `route === 'some-heading'`
and render the 404.

Arriving at `#/unit/x/y` cold takes the slow path: full render first, then
`jumpTo(b)` at the very end of `render()`, so the target exists and its
ancestor `<details>` can be opened before the smooth scroll.

---

## 2. Every view, in detail

Shared fragments used by more than one view, all in `app.js`:

- `esc` — re-exported `WB.esc`, the HTML escaper. **Every** interpolation of
  author text goes through it *except* fields that are deliberately raw HTML
  from `build.py` (`lead`, `intro`, `html`, `brief`, `after`, `stem`, `why`,
  `diagnose[code]`, option `text`).
- `ico(name, size)` — inline SVG from the `I` map (17 path sets: `book`,
  `track`, `wrench`, `target`, `chart`, `chev`, `clock`, `layers`, `check`,
  `play`, `bulb`, `reset`, `spin`, `book2`, `x`, `wrap`, `flame`).
- `crumbs([{t, href?}])` → `<nav class="crumbs">` with `<a class="btn ghost sm">`
  for linked parts and `<span class="now">` for the last.
- `mins(m)` → `"8m"` / `"1h 20m"`.
- `num(n)` → `Number(n).toLocaleString('en-US')`.
- `ring(slug, total, noun)` → `<div class="ring" style="--p:NN" data-n="D">`; the
  donut is pure CSS off `--p`. Gets `.done` when complete.
- `rail(label, items)` — the contents aside (§2.3).
- `pagenav(prev, next)` — `<nav class="pagenav">` with `← Previous` / `Next →`
  cards; a missing side renders `<span class="pagenav-gap">` so the other side
  stays pinned.
- `unitCard(u, i)` / `projectCard(p, i)` — the grid tiles.
- `afterBox(ex, ok)` — the "Now that it compiles" panel.
- `sectionBlock(id, title, html, m, n, open)` — one `<details class="sect">`.

Every card carries `style="--i:${i}"` and class `stagger` for a CSS-only
staggered entrance, and `data-accent="<name>"` which re-points the `--accent`
custom property for the whole subtree.

Loading states, globally: **there are none per view.** An `await` inside a view
means the *previous* view stays on screen until the JSON resolves. The only
"loading…" is the one baked into `index.html` before the first render.

### 2.1 `viewHome()` — `#/`

**Data:** `DB` only (manifest, already loaded) plus `P._streak` from localStorage.
Synchronous, no fetch, no wiring function.

**DOM:**
```
div.wrap
  section.hero
    div > span.eyebrow ("N of M units written")
          h1 ("Learn Rust by <em>fighting the compiler</em>.")
          p.lede
          div.actions > a.btn.lg  ("Start"/"Continue": <title>)
                        a.btn.quiet.lg ("See the track")
    div.heroart > img assets/ferris.png
  div.statgrid > .stat × 5–7
  [ .section-head "Projects" + .unitgrid of projectCard ]   (if DB.projects.length)
  .section-head "The track" + .unitgrid of unitCard × all units
```

The primary CTA is computed, not fixed:
```js
const next = ready.find((u) => u.exercises && unitDone(u) < u.exercises) || ready[0];
```
— the first ready unit with unfinished exercises, else the first ready unit.
Its label flips between `Start:` and `Continue:` on `unitDone(next)`.

Stat tiles: `words` (localised), `exercises`, `drills`, conditionally
`projects` (rendered as "N / projects, S stages"), `mins` of reading,
conditionally `project_mins` of building, and the streak tile — which appends a
flame icon in `--ferris` when `days > 0` and a "· best N" suffix when
`best > days`.

**Empty states:** the Projects block is omitted entirely when
`DB.projects` is empty. Stub (unwritten) units still render, as `unitCard`'s
`!u.ready` branch: a non-link `<div class="card unitcard stub">` with a "soon"
chip, no ring, no footer chips.

### 2.2 `viewTrack()` — `#/track`

Synchronous, manifest only, no wiring. Breadcrumb, `h1.pagetitle`, one
paragraph of copy quoting `DB.totals.units`, and `DB.units.map(unitCard)` — the
same grid as home, unfiltered and unsorted (manifest order is track order).
No filters, no search, no empty state (the track is never empty).

### 2.3 `viewUnit(slug)` — `#/unit/<slug>` — the reader

**Data:** `DB.units.find(u => u.slug === slug)` for meta; `await get('data/unit/'+slug+'.json')`
for content. Guard: `if (!meta || !meta.ready) return notFound();`

**Neighbours** are computed against *ready* units only, so an unwritten unit in
the middle never becomes a dead Next:
```js
const prev = DB.units.slice(0, idx).reverse().find((x) => x.ready);
const next = DB.units.slice(idx + 1).find((x) => x.ready);
```

**DOM:**
```
div[data-accent]
  div.readerbar > div.inner
      a.btn.ghost.sm.back → #/track
      span.title (unit title)
      button#expandall[data-open=0]
      button#opensheet
      button.toggle.desk-only[data-toggle=hide-terms][data-key=rh-terms]
      a.btn.sm → #/work/<slug>            (only if meta.exercises)
      div.progress#prog                    (the scaleX spine)
  div.wrap.wide > div.readerlayout[data-rail=open|collapsed]
      aside.rail  (see below)
      div.readercol
        header.unithead
          span.eyebrow "Unit NN · k of m written"
          h1
          div.meta: chip.accent(clock, mins) chip(words) chip(layers, parts)
                    [chip(wrench, exercises)] chip.mono × u.concepts
        [div.prose  ← u.lead, raw HTML]
        <body: see below>
        [div.dashed "Now earn it" + a.btn.lg → #/work/<slug>]
        pagenav(prev, next)
```

**Body assembly** — `u.parts.map((p, pi) => ...)`, two shapes:

- A part **with** `subs`: a `<div class="partband" id="${p.id}">` banner
  (`h2` + `.line` + a chip reading `"N topics · Xm"`), then `p.intro` as
  `.prose` if non-empty, then one `sectionBlock` per sub numbered `i+1`.
- A part **without** `subs`: a single `sectionBlock(p.id, p.title, p.intro, p.mins, null, pi===0)`.

`sectionBlock` emits:
```html
<details class="sect" id="ID" [open] data-mins="M">
  <summary><span class="caret">chev</span><span class="n">03</span>
           <h3>Title</h3><span class="chip">Mm</span></summary>
  <div class="body"><div class="prose">…raw html…</div></div>
</details>
```
**Only `pi === 0` is open** — the first part's sections are expanded, everything
below is collapsed. This is why `jumpTo` must walk ancestors and force
`open = true`.

#### The contents rail — how it actually works

Items are flattened from parts, two levels deep:
```js
const railItems = u.parts.flatMap((p) => [
  { href: `#/unit/${slug}/${p.id}`, id: p.id, text: p.title, level: 2, note: `${p.mins}m` },
  ...p.subs.map((sub) => ({ href: `#/unit/${slug}/${sub.id}`, id: sub.id,
                            text: sub.text, level: 3, note: `${sub.mins}m` })),
]);
```

**Headings are not discovered from the DOM.** There is no `querySelectorAll('h2,h3')`
scan and no id generation at runtime. Ids come from `build.py`'s `slug_id()`
(lowercase, non-alphanumerics → `-`, numeric suffix on collision) and are
written into `data/unit/*.json` as `parts[].id` and `parts[].subs[].id`. The
rail and the body read the *same* field, which is why they cannot drift.

`rail()` markup:
```html
<aside class="rail">
  <div class="railhead">
    <span class="eyebrow">In this unit</span>
    <button class="railtoggle" id="railtoggle" aria-expanded="true"
            aria-controls="railol" title="Collapse the contents">chev</button>
  </div>
  <div class="railscroll">
    <div class="railtrack"><div class="railfill" id="railfill"></div></div>
    <ol id="railol">
      <li><a class="h2" href="#/unit/s/id" data-id="id" data-title="…">Text<span class="mins">3m</span></a></li>
      …
    </ol>
  </div>
</aside>
```

`wireUnit()` resolves once:
```js
const links   = $$('a', $('#railol'));
const targets = links.map((a) => document.getElementById(a.dataset.id));
const wide    = matchMedia('(min-width: 1061px)');   // evaluated once, not per scroll
```

**There is no IntersectionObserver.** It is a single rAF-throttled `scroll`
listener doing three jobs in one layout read:

```js
const measure = () => {
  ticking = false;
  const h = document.documentElement;
  const max = h.scrollHeight - h.clientHeight;
  const ratio = max > 0 ? Math.min(1, h.scrollTop / max) : 0;
  if (bar)  bar.style.transform  = `scaleX(${ratio})`;   // #prog in the readerbar
  if (fill) fill.style.transform = `scaleY(${ratio})`;   // #railfill, the spine

  let now = -1;
  for (let i = 0; i < targets.length; i++) {
    if (targets[i] && targets[i].getBoundingClientRect().top < 140) now = i;
  }
  if (now === active) return;
  active = now;
  links.forEach((a, i) => {
    a.classList.toggle('on',   i === active);
    a.classList.toggle('read', i <  active);
  });
  …
};
const onScroll = () => { if (ticking) return; ticking = true; requestAnimationFrame(measure); };
```

Three consequences worth reproducing exactly:

1. **The spine fill is whole-document scroll progress**, not section-count
   progress and not read-state. `scrollTop / (scrollHeight - clientHeight)`,
   clamped to 1. It is applied as a `transform: scaleY(ratio)` on `#railfill`
   and the identical ratio as `scaleX(ratio)` on `#prog` — a transform, not a
   height/width, specifically so neither indicator triggers layout on a frame
   already spent on scrolling. Expanding a `<details>` changes `scrollHeight`
   and therefore instantly changes the fill.
2. **The per-section dots fill by scroll-past.** `active` is the index of the
   *last* target whose `getBoundingClientRect().top < 140` (140px = below the
   sticky readerbar). Every link before it gets `.read` (permanently filled as
   you descend), the one at it gets `.on`, everything after has neither. The
   dots are CSS pseudo-elements on `a.h2` / `a.h3`; JS only toggles the two
   classes. Scrolling back up *un*-fills them — nothing is persisted.
   A collapsed `<details>` still has a rect, so collapsed sections still count.
3. **Rail auto-scroll** keeps the active entry inside the rail's own scroller,
   guarded three ways — only when there *is* an active entry, only above the
   1061px breakpoint (below it the rail has no box and the two rect reads would
   flush layout for nothing), and never while collapsed:
   ```js
   if (active >= 0 && railol && wide.matches && layout?.dataset.rail !== 'collapsed') {
     const r = links[active].getBoundingClientRect(), rr = railol.parentElement.getBoundingClientRect();
     if (r.top < rr.top + 8 || r.bottom > rr.bottom - 8) links[active].scrollIntoView({ block: 'nearest' });
   }
   ```

After the first `measure()`, `requestAnimationFrame(() => $('.rail')?.classList.add('live'))`
adds the class that enables the fill transition — so arriving part-way down a
unit snaps rather than animating up from zero.

**Rail collapse** (`#railtoggle`) flips `layout.dataset.rail` between `'open'`
and `'collapsed'`, updates `aria-expanded` and `title`, writes the `rh-rail`
flag, then forces `active = -1; measure()` on the next frame because the reading
column just changed width and every heading moved.

**Other unit-view interactions:**

- `#expandall` toggles `d.open` on every `.sect` at once, flips its own
  `data-open`, and rewrites both the visible `<span>` label and its
  `aria-label` (below 420px the span is display:none and the aria-label is the
  only name it has).
- `#opensheet` → `openSheet()` (§7).
- The Terms toggle is generic: `data-toggle="hide-terms" data-key="rh-terms"`,
  handled by the global `[data-toggle]` delegate.
- Glossary term popovers: any `.term` span in the prose (emitted by `build.py`
  with `data-t` and `data-g`) shows a `.pop` on `mouseover`, suppressed entirely
  when `body.hide-terms` is set.

`jumpTo(id)`:
```js
function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let n = el; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true;
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('landed');
    setTimeout(() => el.classList.remove('landed'), 2400);
  });
}
```

**Empty/error:** missing or unready unit → `notFound()`. A unit with
`exercises === 0` simply omits the Workbench button and the "Now earn it" block.

### 2.4 `viewWork(slug, nRaw, source)` — `#/work/<slug>/<n>` and `#/project/<slug>/<n>`

One view serves unit exercises and project stages. The only differences are
table-driven, in `BENCH`:

```js
const BENCH = {
  ex: {
    url: (slug) => `data/ex/${slug}.json`,   items: (d) => d.exercises,
    meta: (slug) => DB.units.find((u) => u.slug === slug),
    count: (m) => m && m.exercises,  route: 'work',
    backHref: (slug) => `#/unit/${slug}`,  backLabel: 'Back to the note',
    crumbRoot: { t: 'Track', href: '#/track' },  noun: 'Exercise',
  },
  project: {
    url: (slug) => `data/project/${slug}.json`, items: (d) => d.stages,
    meta: (slug) => (DB.projects || []).find((p) => p.slug === slug),
    count: (m) => m && m.stages,  route: 'project',
    backHref: (slug) => `#/project/${slug}`,  backLabel: 'Project overview',
    crumbRoot: { t: 'Projects', href: '#/projects' },  noun: 'Stage',
  },
};
```

**DOM:**
```
div.wrap[data-accent]
  div.wblayout
    aside
      div.eyebrow  "<title> · done/total"
      nav.exlist > a[.on][.passed] × N   (span.st = "✓" or the number; span.nm = title)
      a.btn.quiet.sm → backHref
      [a.btn.quiet.sm → #/drills/<slug>]      (only if meta.drills)
    div.wb
      crumbs(crumbRoot, meta.title, "Exercise N")
      div.wbhead > h1 + div.meta
          chip.accent = ex.kind
          [chip.mono  = ex.concept]
          [chip.mono  = "expect " + (ex.expect.code || ex.expect.msg)]
          [chip.ok    = "✓ passed"]
      div.wbbrief   ← ex.brief (raw HTML)
      div.editor#ed[.softwrap]
      div.runbar#runbar[hidden]
      div.wbbar
        button#run  button#hint  button#reset  button#wrap[aria-pressed]
        button#vim.desk-only[aria-pressed]
        span.kbd#toolchain-wb   span.kbd "⌘ ↵ to run"
      div#hints
      div.out#out
      div#after  ← afterBox(ex, passed)
      pagenav(prev exercise, next exercise)
```

**`wireWork(slug, nRaw, source)`** re-`get`s the same URL (cache hit, resolves
on a microtask), re-picks the exercise, resets `HINTS = 0`, then
`ED = WB.mountEditor(host, ex.starter, doRun)`.

Interactive elements:

- **`#run`** and `⌘/Ctrl + Enter` (bound inside `mountEditor`) → `doRun()`.
- **`#hint`** reveals hints cumulatively — `HINTS++`, rewrite `#hints` with
  `hs.slice(0, HINTS)` as `.hintbox` divs labelled `Hint i of N`, and disable
  the button once exhausted. Hint text is `esc`aped (plain text, not HTML).
- **`#reset`** → `ED.reset()` (restores `ex.starter`) and clears `#out`. It does
  **not** clear `#hints`, `#after`, or the recorded attempt count.
- **`#wrap`** → toggles the `rh-wrap` flag, `host.classList.toggle('softwrap')`
  via `ED.wrap(on)`, repaints `aria-pressed`, refocuses. Persisted globally,
  not per exercise.
- **`#vim`** → `ED.vim.toggle()`, repaints `.on`/`aria-pressed`, refocuses.
  Persisted as `rh-vim`. `desk-only`.
- **`#toolchain-wb`** is filled asynchronously with `rustc <version>` from
  `WB.toolchain()`; if that fetch fails the badge simply stays empty.
- The sidebar `a.exlist` entries are plain links; on a pass the current one is
  mutated in place (`.passed` + `st.textContent = '✓'`) so the list updates
  without a re-render.

**`doRun()` — the run flow**, guarded end to end:

```js
if (BUSY) return; BUSY = true;
const btn = $('#run'), out = $('#out'), afterEl = $('#after'), bar = $('#runbar');
const stale = () => !out.isConnected;         // resolved BEFORE the await
```
Every node is captured before the network call and re-checked afterwards, so a
compile that lands after the reader has navigated writes nothing. `try/finally`
guarantees `BUSY`, the button state, `#runbar` and `host.running` are released
on every path — leaving `BUSY` stuck true would disable Run for the session.

Loading state: `btn.disabled`, `btn.classList.add('running')`, button innerHTML
swapped to `ico('spin') + ' Running'`, `#runbar` unhidden, `host` gets
`.running` and loses `.passed`, `#out` cleared.

Then:
1. `res = await WB.run(code, { tests: ex.tests })`.
   On throw: verdict card. `'offline'` gets the specific line *"Could not reach
   the compiler. The workbench needs a network connection. This is not your
   code."*; anything else is `esc(e.message)` (e.g. `playground returned 503`).
2. `d = WB.parse(res)` → `{errors, warnings, tests}`.
3. `ED.mark(...)` underlines the error lines that are in the reader's own code
   (`!e.inTests`).
4. Verdict logic:
   ```js
   const testsRan = d.tests.length > 0;
   const testsOk  = testsRan && d.tests.every((t) => t.ok || t.ignored);
   const ok = res.success && (!ex.tests || testsOk);
   ```
   With no hidden tests, "it compiles" *is* the whole task (a `fix` exercise).
   With tests, compiling is necessary and not sufficient.
5. `rec = markAttempt(slug, ex.n, ok, HINTS)` (§3).
6. `out.innerHTML = renderOutput({res, d, ex, code, rec, ok, testsRan})`.
7. `afterEl.innerHTML = afterBox(ex, ok)`.
8. On pass: `host` flashes `.passed` for 950ms, the sidebar row is mutated, and
   `Companion.cheer(doneCount(slug, total), total)` fires.

**`renderOutput(...)` is pure** — data in, string out, no DOM — explicitly so it
can be unit-tested (`test_views.mjs`). It emits, in order:

- `div.verdict.landing[.pass|.fail]` with `✓`/`✕`, a verdict sentence
  (`'Compiles, and every test passes.'` / `'It compiles.'` /
  `'It compiles, but the tests disagree.'` / `'rustc said no.'`) and
  `span.sub` = `attempt N · k hints`.
- one `div.diag.landing` per error: header with `span.code` (E-number),
  `span.msg`, `span.where` ("line N · hidden tests"); then either a
  hidden-tests explainer or `WB.snippet(code, e.line, e.col)` (the offending
  line re-highlighted with a caret under the column); then
  `ex.diagnose[e.code]` as the "What that actually means" panel if present;
  then `<details class="raw">` holding rustc's verbatim block.
- after each coded, non-test error: an `.errlink` chip to
  `https://doc.rust-lang.org/error_codes/<CODE>.html`.
- `div.testrow.landing[.ok|.no]` per test when tests ran, with the first line of
  any panic.
- `div.stdout.landing` with the program output when tests did **not** run and
  `res.stdout` is non-empty.
- `div.testrow.warn.landing` per warning.

Every block carries an incrementing `style="--i:N"` driving a CSS cascade-in.

**Empty/error states:** `!meta || !B.count(meta)` → `notFound()`.
`#out` starts empty and stays empty until a run. `#hints` starts empty.
`#after` is populated at render only when the exercise is already passed.

#### The editor (`WB.mountEditor`)

A `<textarea>` with transparent text laid exactly over a highlighted `<pre>`:
```html
<div class="gutter"></div>
<div class="stack">
  <pre class="hl" aria-hidden="true"></pre>
  <textarea spellcheck="false" autocapitalize="off" autocomplete="off"
            autocorrect="off" wrap="off" aria-label="Rust source"></textarea>
</div>
<div class="vimbadge" hidden></div>
```
Alignment is asserted in CSS (font, size, line-height, padding, tab-size, wrap);
the one metric CSS cannot settle — width, because a textarea cannot size to its
longest line — is pushed across after each paint in a rAF:
`ta.style.width = pre.scrollWidth + 'px'`.

`paint()` is memoised twice: it re-highlights only when `v !== lastHl`, and
rebuilds the gutter only when the line count or the error/relative-number key
changed. Keydown handling: `⌘/Ctrl+Enter` runs; `Tab`/`Shift+Tab` indents or
dedents every line the selection touches (4 spaces); `Enter` carries the current
indentation and adds a level after `{`, `(` or `[`.

Returned handle: `{ value, set, reset, focus, mark, wrap, vim }`.

### 2.5 `viewDrills(slug)` — `#/drills/<slug>`

See §5 for the full interaction. Structurally: breadcrumb (Track / unit /
Drills), `h1.pagetitle` = `"<unit title> · drills"`, a line of copy quoting
`d.questions.length`, and `<div id="qs">` of `questionCard(q)`. Guard:
`if (!meta || !meta.drills) return notFound();`

### 2.6 `viewProjects(filter)` — `#/projects` and `#/projects/<domain>`

Synchronous, manifest only, no wiring function (all navigation is links).

**Grouping** is by tier in fixed order `['mini','core','deep']`, each rendered
as a `.section-head` (name + note from `DB.tiers`) followed by a `.unitgrid`.
An empty tier renders nothing. Within a tier, order is whatever `build.py`
sorted the manifest into: tier index, then how far into the track the
prerequisites reach, then title — so top-to-bottom is a sensible order to do
them in without anyone being told an order.

**Filter chips**: `<div class="letters">` with an "All N" pill plus one pill per
distinct `p.domain` (sorted), labelled through `DOMAIN_LABEL`:
```js
const DOMAIN_LABEL = { ai:'AI', systems:'Systems', languages:'Languages',
  network:'Networking', graphics:'Graphics', data:'Data', crypto:'Cryptography',
  games:'Games', tools:'Tools', embedded:'Embedded' };
```
The filter is a **route**, not local state: `#/projects/crypto`. Unknown domain →
`groups` is empty → `'<p>Nothing in that domain yet.</p>'`.

`projectCard(p)` shows a wrench glyph instead of a unit number, the duration
chip, the domain chip, a `ring(p.slug, p.stages, 'stages')`, title, blurb, a
stage-count chip and one `chip.mono` per prerequisite slug.

### 2.7 `viewProject(slug)` — `#/project/<slug>`

**Data:** manifest entry + `await get('data/project/<slug>.json')`.
Guard: `if (!meta) return notFound();` — note it does *not* guard the fetch, so a
manifest/data mismatch throws into `render`'s catch and shows `notFound()`.

Reuses the reader layout and **`wireUnit` as its wiring function**, so it gets
the same rail spine, the same collapse toggle and the same persisted rail state.
Rail items are stages:
```js
rail('Stages', pj.stages.map((st) => ({
  href: `#/project/${slug}/${st.n}`, id: `stage-${st.n}`,
  text: `${st.n}. ${st.title}`, level: 3,
  note: passed(slug, st.n) ? '✓' : '',
})))
```
The `id`s (`stage-1`…) correspond to **no element in the DOM**, so
`targets` is all-null, `active` stays `-1`, and no rail entry ever gets `.on` or
`.read` here. The spine still fills on scroll ratio. Rail links are real routes
into the workbench, not in-page jumps.

Body: crumbs, `header.unithead` with eyebrow `"Project · done/total stages"`,
title, chips (duration, stage count, and one `chip.mono` per prerequisite
linking to `#/unit/<slug>`), then `pj.intro` as raw `.prose`, then a dashed CTA:
```js
<a class="btn lg" href="#/project/${slug}/${Math.min(done + 1, meta.stages)}">
  ${done ? 'Continue' : 'Start'} at stage ${Math.min(done + 1, meta.stages)}</a>
```
`done` is `doneCount(slug, meta.stages)` — count of passed, not furthest
reached, so a skipped stage keeps sending you back to it.

There is no `pagenav` and no drills link on this view.

### 2.8 `viewProgress()` — `#/progress`

**Data:** manifest + the whole `P` object. Synchronous. See §3.3 for the
aggregation. Interactive element: one `#wipe` button wired by `wireProgress`,
gated behind a native `confirm('Erase all recorded progress in this browser?')`,
which resets `P` to `{ _streak: { last: null, days: 0, best: 0 } }`, saves, and
re-`render()`s in place.

The heat strip per row is a grid of links:
```js
`<a href="#/${r.route}/${r.slug}/${i + 1}"><span class="${passed(r.slug, i+1) ? 'on' : ''}" title="${i+1}"></span></a>`
```
so every square is a direct jump to that exercise or stage.

Footer note, verbatim: *"Progress lives in this browser's local storage and is
never sent anywhere. Clearing site data clears it."*

**Empty state:** with no progress the numbers read `0/total`, `0`, `0`, `0` and
every heat square is off. There is no "nothing here yet" copy.

### 2.9 `viewGlossary()` — `#/glossary`

**Data:** `data/glossary.json`, fetched once and memoised in the module-level
`GLOSS` (in addition to the `cache` promise). The selected letter is
module-level too: `let glossLetter = 'A'` — **not** in the URL and **not**
persisted, so it survives navigation within the session and resets on reload.

```js
function glossList(q) {
  return q ? GLOSS.filter((t) => t.t.toLowerCase().includes(q.toLowerCase()))
           : GLOSS.filter((t) => letterOf(t.t) === glossLetter);
}
const letterOf = (t) => { const c = t[0].toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; };
```
Filtering lives in one function so the initial render and the live filter cannot
disagree about what counts as a match. A non-empty query **overrides the
letter** and searches the whole glossary; it matches term names only, never
definitions.

DOM: crumbs, `h1.pagetitle`, a count line, an `#gq` filter input, a
`#letters` row of buttons (only letters that actually occur, sorted; `glossLetter`
is snapped to `letters[0]` if the current one has no terms), and `#gcards`.

`glossCards(list)` → `.gcard` per term with `.t` (name), optional `.x` (the
one-clause gloss), `.p` (the full sentence), and an `.in` row of chips linking to
each place it is taught — `#/project/<s>` when `u.k === 'project'`, else
`#/unit/<s>`. All fields are `esc`aped.

`wireGlossary`: delegated click on `#letters` sets `glossLetter`, clears `#gq`
and calls `render()` (a full re-render — the letter is not in the URL, so this
re-runs `viewGlossary`); `#gq` `input` is debounced 120ms and rewrites only
`#gcards.innerHTML`.

**Empty state:** `'<p>Nothing matches.</p>'` from `glossCards` when the list is
empty.

### 2.10 `viewSearch(q)` — `#/search/<encoded>`

See §4. No wiring function — results are plain links. Empty state is
`'<p style="padding:20px">Nothing found.</p>'` inside the results card.

### 2.11 `notFound()` — the error view

```js
function notFound() {
  return `<div class="wrap" style="padding:70px 20px;text-align:center">
    <img src="assets/ferris.png" alt="" width="120" style="opacity:.55">
    <h1 …>Not here.</h1>
    <p …>That unit may not be written yet.</p>
    <a class="btn" href="#/track">See the track</a></div>`;
}
```
Used for: unknown route, missing/unready unit, missing project, unit with no
exercises reached at `#/work/...`, unit with no drills, and **any thrown
exception in any view**.

### 2.12 Chrome, painted on every render

`paintChrome(hash)` rewrites `#nav` and `#tabbar` from one table:
```js
const NAV = [
  { t: 'Track',    href: '#/track',    i: 'track'  },
  { t: 'Projects', href: '#/projects', i: 'wrench' },
  { t: 'Progress', href: '#/progress', i: 'chart'  },
  { t: 'Glossary', href: '#/glossary', i: 'book2'  },
];
const active = (href) => hash.startsWith(href)
  || (href === '#/projects' && hash.startsWith('#/project/'));
```
The tabbar is the same list with `Home` prepended (icon `book`) and icons at
19px; Home matches only on exact `#/`. `#footstats` gets
`"R/U units · W words · E exercises"`. Then `paintToolchain()`.

`paintToolchain()` runs at most once (`el.dataset.done`) and compares two
versions that are genuinely different questions — the rustc that last
*validated* the content (`DB.audit.toolchain`) and the rustc the playground is
running *today* (`WB.toolchain()`):
- `pending = DB.audit.unvalidated_count` > 0 → *"N exercises added since the last
  validation run and not yet compiled"* and a `<span class="drift">!</span>`.
- else drift (`live.version !== built.version`) → *"Validated on rustc X; the
  playground is now on Y"* + the drift marker.
- else → `"rustc X, released D"`.
The badge links to `https://releases.rs` and reads
`rustc <v> [!] · edition <DB.edition || '2024'>`.

---

## 3. State and persistence

Nothing leaves the browser. There is no account, no sync, no analytics, no
cookies. Six `localStorage` keys, all prefixed `rh-`.

### 3.1 The key table

| Key | Shape | Written by | Read by | Default when absent |
|---|---|---|---|---|
| `rh-theme` | `"light"` \| `"dark"` | `#theme` click handler (`app.js`) | inline script in `<head>`, before first paint | `"light"` |
| `rh-progress` | JSON object (below) | `saveProgress()` — from `markAttempt`, `touchStreak`, `#wipe` | `loadProgress()` at `start()` | `{ _streak: {last:null, days:0, best:0} }` |
| `rh-rail` | `"1"` \| `"0"` | `#railtoggle` via `setFlag` | `railCollapsed()` at every reader render | `false` (rail open) |
| `rh-terms` | `"1"` \| `"0"` | global `[data-toggle]` delegate | `syncToggles()` after every render | `false` (terms shown) |
| `rh-wrap` | `"1"` \| `"0"` | `#wrap` button via `setFlag` | `wrapOn()` at workbench render and mount | `false` (no soft wrap) |
| `rh-vim` | `"1"` \| `"0"` | `vim.js` `setOn()` on enable/disable | `Vim.isOn()` at editor mount | `false` |

The four boolean flags share one pair of helpers, because localStorage
*throws* rather than returning null in a locked-down browser and each
preference used to carry its own `try/catch`:

```js
const flag    = (k)     => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } };
const setFlag = (k, on) => { try { localStorage.setItem(k, on ? '1' : '0'); } catch (e) {} };
```

**Off is the safe default for all of them**, and every read and write in the
whole app is wrapped in `try/catch` — private-mode Safari and storage-blocked
browsers degrade to a working app with no memory, never to a crash.

### 3.2 The progress model

One key, `rh-progress`, one flat object. Two kinds of entry share the keyspace:

```jsonc
{
  "_streak": { "last": "2026-08-30", "days": 4, "best": 11 },
  "05-ownership/1": { "passed": true,  "tries": 3, "hints": 1, "at": 1756500000000 },
  "05-ownership/2": { "passed": false, "tries": 5, "hints": 3 },
  "sha256/1":       { "passed": true,  "tries": 1, "hints": 0, "at": 1756500900000 }
}
```

- The key is `` `${unit}/${n}` `` from `const exKey = (unit, n) => `${unit}/${n}`;`
  where `unit` is a **unit slug or a project slug** and `n` is the 1-based
  exercise or stage number. Units and projects deliberately write into the same
  namespace so one set of helpers serves both.
- `passed` — has ever compiled-and-passed. **Latched**: once true it is never
  set back to false, and `at` is stamped only on the transition.
- `tries` — every Run press that reached the compiler, incremented on both
  outcomes.
- `hints` — `Math.max` of hints revealed in any single attempt, never decremented.
- `at` — `Date.now()` at first pass. Written but **never read anywhere** in the
  app; it exists for future use.
- `_streak` — the one reserved key, distinguished from exercise records by the
  leading underscore and filtered out by name wherever `P` is enumerated.

```js
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

Read helpers:
```js
const passed    = (unit, n) => !!P[exKey(unit, n)]?.passed;
const doneCount = (slug, total) => { let n = 0; for (let i = 1; i <= (total||0); i++) if (passed(slug,i)) n++; return n; };
const unitDone  = (u) => doneCount(u.slug, u.exercises);
const projDone  = (p) => doneCount(p.slug, p.stages);
```
`doneCount` is keyed on **slug and total** rather than on a unit-shaped object —
three near-copies of it used to exist (one reading `.exercises`, one reading
`.stages`, one fabricating a fake unit object), which is why the project
workbench sidebar read `0 of 8` forever.

**Streak:**
```js
function touchStreak() {
  const s = P._streak, t = today();
  if (s.last === t) return;                       // same day does nothing
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  s.days = s.last === yesterday ? s.days + 1 : 1; // gap > 1 day resets to 1
  s.last = t;
  s.best = Math.max(s.best || 0, s.days);
  saveProgress();
}
```
`today()` is `new Date().toISOString().slice(0, 10)` — **UTC**, not local, so the
day boundary is midnight UTC regardless of the reader's timezone. `touchStreak`
is called from exactly two places: `markAttempt` (any Run, pass or fail) and
`wireDrills` (any answered drill question).

**Migration / absence:** there is no version field and no migration code. The
whole strategy is one spread:
```js
function loadProgress() {
  try { const raw = localStorage.getItem(PKEY); if (raw) P = { ...P, ...JSON.parse(raw) }; }
  catch (e) {}
}
```
A stored object merges over the default, so a stored blob missing `_streak`
keeps the default `_streak`, and a malformed blob is caught and silently
ignored (leaving the in-memory default and overwriting the bad value on the
next save). Unknown extra keys survive round-trips untouched. Stale keys for
deleted units are never garbage-collected; they are simply never read, because
every read is driven from the manifest, not from `Object.keys(P)` — with one
exception, the hint tally in §3.3.

### 3.3 How the progress view aggregates

```js
const rows = [
  ...DB.units.filter((u) => u.ready && u.exercises)
    .map((u) => ({ slug: u.slug, title: u.title, accent: u.accent, total: u.exercises, route: 'work' })),
  ...(DB.projects || [])
    .map((p) => ({ slug: p.slug, title: p.title, accent: p.accent, total: p.stages, route: 'project' })),
];
const total = rows.reduce((n, r) => n + r.total, 0);
const done  = rows.reduce((n, r) => n + doneCount(r.slug, r.total), 0);
```

Four stat tiles:
1. `done/total` "exercises passed" — units **and** projects summed. (Walking
   `DB.units` alone meant every project stage passed was recorded and then never
   shown anywhere.)
2. `_streak.days` "day streak".
3. `_streak.best` "best streak".
4. `Object.keys(P).filter((k) => k !== '_streak' && P[k].hints).length` —
   "needed a hint". This is the **only** read that enumerates `P` directly, so
   it counts orphaned records for units that no longer exist, and it counts an
   exercise once regardless of how many hints were taken.

Then one `.section-head` + `.heat` strip per row, in manifest order (all units
first, then all projects).

### 3.4 In-memory-only state

Never persisted, lost on reload:

| Variable | Scope | Meaning |
|---|---|---|
| `DB` | module | the parsed manifest |
| `cache` | module | `Map<url, Promise<json>>` |
| `P` | module | the live progress object (mirrored to localStorage) |
| `CURRENT` | module | `"route/param"` of what is painted, for the in-page-jump fast path |
| `GLOSS` | module | memoised `glossary.terms` |
| `glossLetter` | module | selected glossary letter, defaults `'A'` |
| `ED` | module | the mounted editor handle |
| `HINTS` | module | hints revealed on the exercise on screen; reset to 0 on every `wireWork` |
| `BUSY` | module | a run is in flight |
| `railWatch` | module | `AbortController` for the rail's window listeners |
| `pop` | module | the live glossary popover node |
| `_tc` | `WB` | the promise for the playground's version metadata |
| `START`, `lastSpoke`, `node` | `Companion` | session start, last utterance, live bubble |
| editor buffer | closure in `mountEditor` | **the reader's code is never saved.** Navigating away and back restores `ex.starter`. |

That last row is the significant one: hint counts and pass/fail survive a
reload, but **the code you typed does not**.

---

## 4. Search

### 4.1 How `data/search.json` is built and shaped

Emitted at the end of `build_manifest()` in `build.py`:

```python
(OUT / "search.json").write_text(json.dumps({
    "units": [{
        "slug": slug,
        "sections": [p["title"] for p in units[slug]["parts"]],
        "concepts": units[slug]["concepts"],
    } for slug, *_ in TRACK if slug in units],
}))
```

It exists as a **separate document purely as a payload optimisation**: section
titles and concept lists were 45% of a manifest that every page view downloads,
and only this one function reads them. `get()` caches, so it costs at most one
fetch per session, and only if someone actually searches.

Shape:
```json
{ "units": [
  { "slug": "00-toolchain",
    "sections": ["The three programs", "What `cargo run` actually does",
                 "Debug and release", "Editions", "Dependencies and versions",
                 "When a crate needs to run code to build",
                 "The commands you actually type"],
    "concepts": ["rustc","cargo","crate","edition","profile","semver","cargo check","clippy"] }
] }
```

Note what it does **not** contain: only top-level `parts[].title`, not the
`subs[].text` sub-headings, and no body prose at all. Projects, drills and
glossary terms are absent entirely.

### 4.2 The matching algorithm

```js
async function searchAll(qs) {
  const q = qs.toLowerCase();
  const index = await get('data/search.json');
  const extra = Object.fromEntries(index.units.map((u) => [u.slug, u]));
  const hits = [];

  for (const u of DB.units) {
    if (!u.ready) continue;
    if (u.title.toLowerCase().includes(q) || u.blurb.toLowerCase().includes(q)) {
      hits.push({ k: 'Unit', t: u.title, s: u.blurb, href: `#/unit/${u.slug}` });
    }
    const e = extra[u.slug];
    if (!e) continue;
    for (const sec of e.sections) {
      if (sec.toLowerCase().includes(q))
        hits.push({ k: `${u.title} · section`, t: sec, s: '', href: `#/unit/${u.slug}` });
    }
    for (const c of e.concepts) {
      if (c.toLowerCase().includes(q))
        hits.push({ k: `${u.title} · concept`, t: c, s: u.blurb, href: `#/unit/${u.slug}` });
    }
  }
  return hits.slice(0, 60);
}
```

It is a **case-insensitive substring scan**, nothing more. No tokenising, no
stemming, no fuzzy matching, no scoring function, no inverted index, no
`Intl.Collator`. The query is used raw, so a multi-word query only matches a
literal contiguous run.

### 4.3 Ranking

**There is no ranking.** Results come out in traversal order: manifest unit
order, and inside each unit, the unit hit, then its section hits in document
order, then its concept hits in document order. `slice(0, 60)` truncates — and
because the traversal is ordered, an over-60 result set silently drops the
*later* units entirely rather than the least relevant hits.

Unready units are skipped. Projects, glossary terms, drills and exercise titles
are never searched.

### 4.4 Result rendering

```js
async function viewSearch(q) {
  const hits = await searchAll(q);
  return `… <h1>${hits.length} result${hits.length === 1 ? '' : 's'} for “${esc(q)}”</h1>
    <div class="card" style="margin-top:16px;padding:0;overflow:hidden">
      ${hits.map((h) => `<a class="hit" href="${h.href}">
        <div class="k">${esc(h.k)}</div>
        <div class="t">${hl(h.t, q)}</div>
        ${h.s ? `<div class="s">${hl(h.s.slice(0, 150), q)}</div>` : ''}
      </a>`).join('') || '<p style="padding:20px;color:var(--ink-3)">Nothing found.</p>'}
    </div></div>`;
}
```

One flat card of `<a class="hit">` rows: a kind label (`Unit`,
`<Unit title> · section`, `<Unit title> · concept`), the matched text with the
query highlighted, and a snippet truncated to 150 characters. **Every hit —
including a section hit — links to `#/unit/<slug>`, not to the section anchor**,
even though the router supports `#/unit/<slug>/<id>`; the section id is not
carried in `search.json`.

Highlighting is deliberately ordered:
```js
function hl(text, q) {
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return String(text).split(re).map((part, i) =>
    (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}
```
Split on the match in the **raw** string, escape each piece, then join. Running
the regex over already-escaped text would let a search for `amp` match inside
the `&amp;` entity and render as literal broken markup. The query is
regex-escaped before use, so `c++` or `[T]` cannot throw.

### 4.5 The URL round-trip

```js
qbox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && qbox.value.trim())
    location.hash = '#/search/' + encodeURIComponent(qbox.value.trim());
});
```
→ `hashchange` → `render()` → `route === 'search'` →
`viewSearch(decodeURIComponent(a || ''))`.

Consequences:
- Search runs **only on Enter**. No live/as-you-type results, no debounce, no
  dropdown.
- The query is the URL, so results are linkable, bookmarkable and back/forward
  navigable.
- `encodeURIComponent` escapes `/`, which is what keeps a query containing a
  slash from being split into `a` and `b` by the router.
- The `#q` input is **never repopulated** from the URL. Landing on
  `#/search/borrow` from a bookmark shows the results with an empty search box.
- An empty or missing segment yields `viewSearch('')`, whose empty `q` makes
  `.includes('')` true for everything — so `#/search/` renders 60 hits for the
  empty string.

---

## 5. Drills

Route `#/drills/<slug>`, reached from the workbench sidebar (only rendered when
`meta.drills > 0`). There is no link from the unit reader.

### 5.1 Presentation

```js
async function viewDrills(slug) {
  const meta = DB.units.find((u) => u.slug === slug);
  if (!meta || !meta.drills) return notFound();
  const d = await get(`data/drills/${slug}.json`);
  return `<div class="wrap" data-accent="${meta.accent}" style="…max-width:860px">
    ${crumbs([{t:'Track',href:'#/track'}, {t:meta.title, href:`#/unit/${slug}`}, {t:'Drills'}])}
    <h1 class="pagetitle">${esc(meta.title)} · drills</h1>
    <p>Answer, then read why. ${d.questions.length} questions.</p>
    <div id="qs">${d.questions.map(questionCard).join('')}</div>
  </div>`;
}
```

All questions are rendered at once as a single scrolling page — there is no
pagination, no one-at-a-time stepper, no timer, no shuffle. Order is the
authored order.

```js
function questionCard(q) {
  return `<div class="qcard" data-n="${q.n}" data-answer="${esc(q.answer)}">
    <div class="qtop"><span class="qn">${String(q.n).padStart(2, '0')}</span>
      ${q.answer.length > 1 ? '<span class="chip">choose all that apply</span>' : ''}</div>
    <div class="stem">${q.stem}</div>
    <div class="opts">${q.options.map((o) =>
      `<button class="opt" data-k="${o.key}"><span class="k">${o.key}</span><span>${o.text}</span></button>`
    ).join('')}</div>
    <div class="why" hidden><div class="lbl">Why</div>${q.why}</div>
  </div>`;
}
```

The correct answer is **in the DOM before the reader answers**, as
`data-answer` on the card. Same for `option.correct` in the JSON. This is a
study tool, not an exam; there is no attempt to hide the key.

`q.stem`, `q.why` and each `o.text` are injected as **raw HTML** (they contain
`<code>`, `<div class="codeblock">` and `.term` spans from `build.py`). Only
`q.answer` is escaped, into an attribute.

Multi-answer questions are signalled by `q.answer.length > 1` — the answer is a
string of option keys such as `"ACD"` — and get a "choose all that apply" chip.

### 5.2 Answering, feedback and scoring

One delegated listener on `#qs`:

```js
function wireDrills() {
  const host = $('#qs');
  if (!host) return;
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    const card = btn.closest('.qcard');
    if (card.classList.contains('done')) return;      // one shot, no retry
    const answer = card.dataset.answer;
    btn.classList.add('picked');
    if (card.querySelectorAll('.picked').length < answer.length) return;  // accumulate
    card.classList.add('done');
    $$('.opt', card).forEach((o) => {
      const right = answer.includes(o.dataset.k);
      if (right) o.classList.add('right');
      else if (o.classList.contains('picked')) o.classList.add('wrong');
    });
    card.querySelector('.why').hidden = false;
    touchStreak();
  });
}
```

- **Single-answer:** one click resolves the card immediately.
- **Multi-answer:** clicks accumulate `.picked` until the count equals
  `answer.length`, then the card resolves. A picked option cannot be un-picked,
  and picking the same option twice does not double-count (`classList.add` is
  idempotent, so the length check would never advance — a real edge case).
- **Feedback:** every correct option gets `.right` (so the reader sees the full
  key, not just their own mistake); every *picked and wrong* option gets
  `.wrong`. Unpicked wrong options stay neutral. The `.why` block is unhidden.
- **Retry:** none. `card.classList.contains('done')` short-circuits every
  further click. The only way to retry is to re-navigate, which re-renders the
  page from the cached JSON with a clean slate.

### 5.3 What is stored

**Nothing.** Drill scores are never written to `localStorage`, never counted,
never shown on `#/progress`, and never aggregated anywhere. The single
persistent side effect of answering a question is `touchStreak()` — answering a
drill counts as activity for the day streak, exactly like pressing Run.

Correct/incorrect state lives only in CSS classes on the current DOM and is lost
on the next navigation.

---

## 6. The companion / mascot

`assets/companion.js`, 76 lines, one global `Companion` exposing
`{ cheer, say, hide }`.

### 6.1 When it appears and how often

Called from exactly **one** place in the whole app — the pass branch of
`doRun()` in `app.js`:

```js
const total = BENCH[source].count(BENCH[source].meta(slug));
Companion.cheer(doneCount(slug, total), total);
```

So: only in the workbench, only on a genuine pass (compiles *and* tests green),
for both unit exercises and project stages. Never on failure, never on the
reader, never on drills, never on a timer.

Frequency is gated twice:

```js
function cheer(done, total) {
  const hours = (Date.now() - START) / 36e5;
  if (hours > 1.6) return say(pick(REST), 12000);   // session > ~96 min
  if (done === 1)        return say(pick(FIRST));
  if (done >= total)     return say(pick(LAST), 11000);
  if (done % 3 === 0)    return say(pick(MID));
}                                                    // otherwise: silence
```
```js
function say(text, ttl = 9000) {
  if (Date.now() - lastSpoke < 120000) return;       // hard cap: 1 line / 2 min
  lastSpoke = Date.now();
  hide();
  node = document.createElement('div');
  node.className = 'companion';
  node.innerHTML = `<img src="assets/ferris.png" alt="">
    <div class="bubble">${text}</div>`;
  node.addEventListener('click', hide);
  document.body.appendChild(node);
  setTimeout(hide, ttl);
}
```

`START` is the module-eval time, i.e. page load, and `lastSpoke` is
module-scoped — both reset on reload, neither persists. The two-minute floor
applies across *all* utterances, so the trigger rules are the ceiling and the
floor is absolute.

`total` is passed by the caller precisely because it varies: it was once
hardcoded as seven, which fired five stages early on the twelve-stage projects
and could never fire at all on the four-stage ones.

### 6.2 What it says

Four arrays, picked from uniformly (`pick = (a) => a[Math.floor(Math.random() * a.length)]`).
Two voices: a **coach** that names what was actually learned (a bare "well done"
is worth nothing), and a **realist** that tells you to stop.

- `FIRST` (2 lines, on `done === 1`) — e.g. *"First one down. The compiler is not
  your adversary here. It is the only reviewer that reads every line."*
- `MID` (3 lines, every third pass) — e.g. *"Halfway. The errors should be
  starting to look like sentences rather than noise."*
- `LAST` (2 lines, on `done >= total`, ttl 11s) — e.g. *"That is the last one.
  Every one of them compiled on real rustc, so you know it works rather than
  hoping."*
- `REST` (2 lines, session > 1.6h, ttl 12s, **overrides everything else**) —
  e.g. *"You have been at this a while. Reading a borrow error at hour two is a
  different skill from writing one at hour one. A break is not a loss."*

Text is inserted as raw HTML into `.bubble`; all strings are author-controlled
literals.

### 6.3 Dismissal

Three ways, all in `say`/`hide`:
- click anywhere on the bubble (`node.addEventListener('click', hide)`)
- the TTL timer (`setTimeout(hide, ttl)` — 9s default, 11s / 12s for LAST / REST)
- the next `say()`, which calls `hide()` first so only one bubble ever exists

```js
function hide() { if (node) { node.remove(); node = null; } }
```
There is no "don't show again", no mute setting, no persistence of dismissal,
and no keyboard dismissal (Escape closes only the mobile sheet).

Styling: `.companion` is `position: fixed; right: 18px; bottom: 18px; z-index: 300`,
`max-width: min(340px, calc(100vw - 36px))`, with a `pop` keyframe entrance and
`bottom: 68px` below 900px so it clears the mobile tabbar. The image is
`width: 46px; height: auto`.

### 6.4 Every hardcoded mascot reference — the swap list

**Image path `assets/ferris.png`, 6 occurrences:**

| File | Line | Context |
|---|---|---|
| `index.html` | 12 | `<link rel="icon" type="image/png" href="assets/ferris.png">` |
| `index.html` | 13 | `<link rel="apple-touch-icon" href="assets/ferris.png">` |
| `index.html` | 16 | `<meta property="og:image" content="assets/ferris.png">` |
| `index.html` | 31 | `<img class="mascot" src="assets/ferris.png" alt="" width="30" height="20">` in `.brand` |
| `assets/companion.js` | 52 | `node.innerHTML = \`<img src="assets/ferris.png" alt="">…\`` |
| `assets/app.js` | 245 | `<div class="heroart"><img src="assets/ferris.png" alt="Ferris, the Rust mascot"></div>` |
| `assets/app.js` | 1160 | `<img src="assets/ferris.png" alt="" width="120" style="opacity:.55">` in `notFound()` |

Note the topbar mascot is the only one with explicit `width="30" height="20"` —
a crab's aspect ratio. A different mascot needs those numbers changed or
removed, plus `.brand .mascot { width: 30px }` (`app.css:220`) and its 26px
mobile override (`app.css:1601`).

**Name "Ferris", 4 occurrences:**

| File | Line | Context |
|---|---|---|
| `assets/app.js` | 245 | `alt="Ferris, the Rust mascot"` — the only user-visible one |
| `assets/companion.js` | 1 | `/* Ferris, occasionally.` (comment) |
| `assets/companion.js` | 9 | comment |
| `assets/app.css` | 9 | comment ("with Ferris's orange in it") |

**Colour token `--ferris`, defined `app.css:15` (`#f74c00`, "the crab"), used at:**
`app.css:72` (`--accent` default), `100` (`[data-accent="ferris"]`), `148`
(`:focus-visible` outline), `256` (search input focus border), `308` (`.llms .a1`
avatar), `466` (`.hero h1 em`), `1163` (editor `caret-color`), `1184` (vim insert
caret), and `app.js:258` (the streak flame's inline colour).

**`"ferris"` as an accent name** is also a `build.py` TRACK value on five units
(`05-ownership`, `06-borrowing`, `07-slices`, `15-lifetimes`, `25-diagnostics`),
so it flows through `manifest.json` into every `data-accent` attribute. Renaming
the token means renaming it in `build.py`'s TRACK, the CSS `[data-accent]` rule,
and the `:root` variable together.

Also note `assets/rust-logo.svg`, referenced once (`index.html`, footer
`<img class="rustmark">`), and the `.brand` text "Rust Handbook" (`index.html:32`).

---

## 7. Accessibility and keyboard

An honest inventory: the app is careful about several things and has real gaps
in others. Both are documented, because the reproduction should keep the first
and can fix the second.

### 7.1 Focus management

- **`:focus-visible` is styled globally** (`app.css:147`):
  `outline: 2px solid var(--ferris); outline-offset: 2px; border-radius: var(--r-sm);`
  — keyboard focus is always visible, mouse focus never draws a ring.
- **No focus is moved on navigation.** `render()` replaces `app.innerHTML` and
  never calls `.focus()` on the new content or on a heading. After a hash change
  the focused element has been destroyed, so focus falls back to `<body>` and
  the next Tab restarts from the top of the document — including the whole
  topbar — on every page.
- **No skip link.** There is no `<a href="#main" class="skip">`. Reaching the
  reading column by keyboard means tabbing past brand, four nav links, the LLM
  button, the GitHub link, the search input, the theme button, then the reader
  bar's own five controls.
- **No `aria-live` region anywhere.** Compile results, hint reveals, drill
  feedback and the companion bubble are all injected silently; a screen reader
  is told nothing when Run finishes.
- Focus *is* deliberately returned inside the workbench: the wrap and vim
  toggles both end with `ED.focus()` so the caret goes back to the editor rather
  than being stranded on a button.
- `prefers-reduced-motion: reduce` kills `scroll-behavior: smooth` and disables
  every transition and animation globally (`app.css:120`), including the
  companion's entrance, the card stagger and the rail fill.
- `html { scroll-padding-top: 116px }` so a jump target clears the 56px topbar
  plus the reader bar rather than landing underneath the chrome.

### 7.2 ARIA usage

Complete list of ARIA in the app:

| Attribute | Where |
|---|---|
| `role="dialog" aria-modal="true" aria-label="Contents"` | `#sheet` (`index.html`) |
| `aria-label="Sections"` | `#tabbar` (`index.html`) |
| `aria-label="Source on GitHub"`, `title` | `#gh` |
| `aria-label="Toggle theme"`, `title="Light / dark"` | `#theme` |
| `aria-label="Close"` | `#sheetclose` |
| `aria-expanded` + `aria-controls="railol"` | `#railtoggle`, kept in sync on every toggle |
| `aria-label="Expand all"` → rewritten to `"Collapse all"` | `#expandall`, because below 420px its `<span>` is hidden and the aria-label is the only name it has |
| `aria-pressed` | `#wrap` and `#vim`, repainted by `paintWrapBtn` / `paintVimBtn` |
| `aria-label="Rust source"` | the editor `<textarea>` |
| `aria-hidden="true"` | the highlighted `<pre class="hl">` overlay, and every decorative inline SVG (`ico()` output is *not* aria-hidden, but sits inside a labelled control) |
| `alt=""` | the topbar mascot, the footer rustmark, the companion image, the 404 mascot — all decorative |
| `alt="Ferris, the Rust mascot"` | the hero image only |

Semantics that carry weight without ARIA: `<details>/<summary>` for every
section (native disclosure, keyboard-operable, announced correctly), `<nav>` for
crumbs / pagenav / rail / tabbar, real `<a href>` for every navigation (no
`onclick` divs), real `<button>` for every action, `<ol>` for the contents,
`<h1>`/`<h2>`/`<h3>` in document order.

Gaps worth naming: the drill option buttons carry no `aria-pressed` or
`aria-describedby`, so their correct/incorrect state is colour and glyph only;
the `.ring` progress donut has a `title` but no `role="progressbar"`; the search
results list is a `<div>` of `<a>`s with no landmark or result count announcement.

### 7.3 Keyboard shortcuts

Deliberately few — everything else is standard Tab / Enter / Space:

| Key | Scope | Effect |
|---|---|---|
| `Enter` | `#q` search input | `location.hash = '#/search/' + encodeURIComponent(value.trim())`; no-op on empty |
| `⌘/Ctrl + Enter` | the editor textarea | run the exercise (`onRun`) |
| `Tab` | the editor textarea | insert 4 spaces; with a selection, indent every touched line |
| `Shift + Tab` | the editor textarea | dedent every touched line (`/^ {1,4}/`) |
| `Enter` | the editor textarea | newline carrying the current indent, +1 level after `{`, `(`, `[` |
| `Escape` | window, global | `closeSheet()` — and nothing else; it does not close the term popover |

There is **no** global command palette, no `/` to focus search, no `j`/`k`
navigation, no arrow-key movement in the contents rail or the exercise list.

**Vim mode** (`assets/vim.js`, `#vim` toggle, `desk-only`, persisted as
`rh-vim`) layers a full modal editor over the same textarea: normal / insert /
visual modes, motions, operators, counts, `jk` to leave insert, undo, and a
`.vimbadge` showing the current mode. It intercepts keys *before* the handlers
above, so Tab and Enter are normal in insert mode and Vim's in normal mode. It
also drives relative line numbering through the editor's `gutter(line)` callback.
It is entirely opt-in and off by default.

### 7.4 The mobile sheet — trap and release

The sheet is the mobile stand-in for the contents rail, opened by `#opensheet`
in the reader bar.

```js
function openSheet() {
  const src = $('#railol');
  if (src) $('#sheetbody').innerHTML = `<ol>${src.innerHTML}</ol>`;
  $('#sheet').hidden = false;
  $('#scrim').hidden = false;
  document.body.classList.add('sheetopen');
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#scrim').hidden = true;
  document.body.classList.remove('sheetopen');
}
```

- Content is copied from `#railol` **at open time, not at wire time**. A copy
  taken once at render froze the read/active marks at the top of the unit; taking
  it at open means the sheet reflects where the rail's scroll watcher currently
  thinks you are. The `<ol>` wrapper is re-added and the decoration is left
  behind in CSS — the sheet is a plain jump list, not the spine.
- **It does not trap focus.** There is no focus-sentinel pair, no
  `inert`/`aria-hidden` on the background, no `focus()` on open and no focus
  restore on close, despite `role="dialog" aria-modal="true"`. Tab from inside
  the sheet walks straight out into the page behind it. This is the app's
  largest accessibility gap and the one thing worth fixing in a reproduction.
- What it *does* do is **scroll-lock**: `body.sheetopen { overflow-y: hidden }`
  freezes the page behind, and `.sheet-body { overscroll-behavior: contain }`
  stops a flick that reaches the end of the contents from scrolling the page
  underneath — otherwise you close the sheet onto somewhere you did not pick.
- **Release** happens four ways: the scrim click, `#sheetclose`, `Escape`
  (window-level `keydown`), and a click on any `<a>` inside the sheet
  (`$('#sheet').addEventListener('click', e => { if (e.target.closest('a')) closeSheet(); })`)
  — which is what makes it a jump list rather than a panel you dismiss twice.
  `render()` also calls `closeSheet()` unconditionally at the top of every
  navigation, so it can never survive a route change.
- Because `[hidden]` is a bare attribute selector in the UA stylesheet, any class
  rule setting `display` outranks it; `app.css` carries an explicit note about
  this, learned on a transparent scrim at `inset: 0` that stayed clickable.

### 7.5 Touch and mobile chrome

- `.tabbar` is a thumb-reachable fixed bottom bar (Home + the four NAV entries,
  icons at 19px) shown below the desktop breakpoint instead of the topbar nav row.
- `.desk-only` hides the terms toggle, the vim button and the two `.kbd` hints on
  small screens.
- The glossary term popover is `mouseover`-driven only, so it is effectively
  desktop-only; there is no tap-to-reveal equivalent.

---

## 8. The data contract

Everything the frontend knows comes from `data/`. This is the contract a new
`build.py` must satisfy. All files are minified JSON (`json.dumps` with no
indent). Nothing is versioned; there is no schema field and no compatibility
check — a shape mismatch surfaces as `notFound()`.

Directory layout:
```
data/
  manifest.json          # the registry, loaded on every page view
  search.json            # section titles + concepts, loaded only on a search
  glossary.json          # all terms, loaded only on #/glossary
  unit/<slug>.json       # one per ready unit
  ex/<slug>.json         # one per unit with exercises
  drills/<slug>.json     # one per unit with drills
  project/<slug>.json    # one per project
  .validate-cache.json   # build-time only, never fetched by the app
```

Slugs are `NN-name` for units (`00-toolchain` … `27-no-std`) and bare names for
projects (`sha256`, `json-parser`). The numeric prefix is convention only —
ordering comes from `manifest.units` array order, not from parsing the slug.

### 8.1 `manifest.json`

The single required document. Loaded once at boot into `DB`.

| Field | Type | Meaning |
|---|---|---|
| `title` | string | site title; **currently read by nothing in `app.js`** (the `<title>` and brand are hardcoded in `index.html`) |
| `units` | `Unit[]` | the track, in reading order |
| `projects` | `Project[]` | pre-sorted by tier, then prerequisite depth, then title |
| `tiers` | `{ [id]: {name, note} }` | tier display names; keys must cover `mini`/`core`/`deep` |
| `totals` | object | the home and footer stat tiles |
| `audit` | object | validation provenance for the footer badge |
| `edition` | string | shown in the footer badge; defaults to `'2024'` if absent |

**`Unit`** (`manifest.units[]`):

| Field | Type | Meaning | Used by |
|---|---|---|---|
| `slug` | string | file key and route param | everywhere |
| `num` | int | display number, zero-padded to 2 | `unitCard`, `viewUnit` header |
| `title` | string | | cards, crumbs, headers, search |
| `accent` | string | one of `rust\|ferris\|amber\|clay\|moss\|slate\|plum` | `data-accent` |
| `blurb` | string | one sentence | cards, search |
| `ready` | bool | false renders the "soon" stub and 404s the route | `unitCard`, `viewUnit` guard |
| `words` | int | | totals only |
| `mins` | int | reading minutes | `unitCard` chip |
| `exercises` | int | count; 0 hides the workbench entirely | `ring`, `unitDone`, `viewWork` guard |
| `drills` | int | count; 0 hides the drills link | `viewDrills` guard, sidebar |

```json
{"slug":"00-toolchain","num":0,"title":"The toolchain","accent":"slate",
 "blurb":"What rustc, cargo and an edition actually are, and what `cargo run` does to your file between you pressing enter and the program starting.",
 "ready":true,"words":1910,"mins":8,"exercises":8,"drills":15}
```

**`Project`** (`manifest.projects[]`) — a projection of `project/<slug>.json`
plus a computed `stages` count:

```json
{"slug":"sha256","title":"SHA-256 from the spec","accent":"slate",
 "blurb":"Implement the hash behind TLS certificates, git objects and Bitcoin exactly as FIPS 180-4 writes it, and check it against the published test vectors.",
 "tier":"mini","domain":"crypto","needs":["02-types","07-slices"],
 "mins":30,"words":1101,"stages":4}
```
`tier` ∈ `mini|core|deep`. `domain` is a key into `DOMAIN_LABEL` in `app.js`
(unknown domains fall back to the raw string). `needs` is a list of **unit
slugs**, rendered as chips linking to `#/unit/<slug>`. `mins` here is *build*
time, not reading time.

**`tiers`**:
```json
{"mini":{"name":"Mini","note":"four stages, one idea, about twenty minutes"},
 "core":{"name":"Core","note":"eight stages, a real program end to end"},
 "deep":{"name":"Deep","note":"twelve stages or more, a weekend, something you would use"}}
```

**`totals`** — every field is read by `viewHome`, `viewTrack` or `paintChrome`:
```json
{"units":28,"ready":28,"words":72572,"unit_words":50818,"mins":316,
 "project_mins":835,"exercises":224,"drills":420,"projects":13,"stages":92}
```
`words` = unit words + project words. `mins` = unit reading minutes + minutes
derived from project word counts (deliberately *not* `project_mins`, which is
build time — adding it would put "17 hours of reading" under a 72,000-word
count). `projects` and `project_mins` are the two fields whose absence/zero
hides a stat tile.

**`audit`** — only three fields are read by the app
(`toolchain`, `unvalidated_count`); the rest are build diagnostics:
```json
{"checked":0,"cached":316,"findings":[],"unvalidated":[],"unvalidated_count":0,
 "ran":true,"toolchain":{"version":"1.98.0","date":"2026-08-18","hash":"88d9e12ae"}}
```

### 8.2 `unit/<slug>.json`

```
{ slug, num, title, blurb, concepts: string[], words, mins, lead: html,
  parts: Part[] }

Part = { id, title, intro: html, subs: Sub[], words, mins }
Sub  = { id, text, html, words, mins }
```

| Field | Type | Meaning |
|---|---|---|
| `slug`, `num`, `title`, `blurb` | | must agree with the manifest entry (`build.py` asserts this) |
| `concepts` | string[] | rendered as `chip.mono` in the unit header **and** searched |
| `words`, `mins` | int | header chips |
| `lead` | HTML string | optional intro prose above the first part; `''` renders nothing |
| `parts[].id` | string | **the anchor id.** Becomes `#/unit/<slug>/<id>` and the DOM id of the `.partband` or `.sect`. From `slug_id()`: lowercased, non-alphanumerics → `-`, numeric suffix on collision |
| `parts[].title` | string | rail entry (level 2) and `<h2>` / `<summary>` text; also the *only* thing in `search.json.sections` |
| `parts[].intro` | HTML string | prose under the band, or — when `subs` is empty — the part's entire body |
| `parts[].subs` | Sub[] | may be empty (56 of 185 parts are). Empty ⇒ the part renders as a single collapsible section instead of a band |
| `subs[].id` | string | anchor id, same rules |
| `subs[].text` | string | rail entry (level 3) and `<summary>` heading |
| `subs[].html` | HTML string | the section body |
| `mins` on part/sub | int | the `Xm` chip in the rail and on the summary |

Real example (truncated bodies):
```json
{"slug":"00-toolchain","num":0,"title":"The toolchain",
 "blurb":"What rustc, cargo and an edition actually are…",
 "concepts":["rustc","cargo","crate","edition","profile","semver","cargo check","clippy"],
 "words":1910,"mins":8,
 "lead":"<p class=\"lede\">Rust has a reputation for a slow, opinionated compiler…</p>",
 "parts":[
   {"id":"the-three-programs","title":"The three programs","intro":"",
    "subs":[{"id":"rustc-compiles-a-crate","text":"rustc compiles a crate",
             "html":"<p><code>rustc</code> is the compiler…</p>","words":211,"mins":1}],
    "words":383,"mins":2},
   {"id":"debug-and-release","title":"Debug and release",
    "intro":"<p>One flag, two completely different programs.</p><table>…</table>",
    "subs":[],"words":195,"mins":1}
 ]}
```

The HTML fields may contain `<code>`, `<pre>`, `<table>`,
`<div class="codeblock" data-lang="rust">` blocks with a `.cb-head`, and
`<span class="term" data-t="…" data-g="…">` glossary spans (which drive the
hover popover and respond to the terms toggle). All of it is injected raw.

### 8.3 `ex/<slug>.json` and `project/<slug>.json`

Both hold a list of the **same item type**; only the wrapper differs.

`ex/<slug>.json`:
```
{ unit: "<slug>", exercises: Item[] }
```
`project/<slug>.json`:
```
{ slug, title, accent, blurb, tier, domain, needs: string[], mins, words,
  intro: html, stages: Item[] }
```
(the first nine fields are exactly what `build_manifest` copies into
`manifest.projects[]`, plus `stages` length.)

**`Item`** — 13 fields, all present on all 316 items in the corpus:

| Field | Type | Meaning |
|---|---|---|
| `n` | int | 1-based ordinal; **the progress key** and the route param |
| `title` | string | `<h1>` and the sidebar entry |
| `kind` | string | `fix` (304) \| `fill` (6) \| `write` (4) \| `predict` (2). Rendered verbatim as `chip.accent`; **the app has no per-kind behaviour** |
| `concept` | string | one word, `chip.mono` |
| `expect` | `{code}` \| `{msg}` \| `{any:true}` \| `null` | the diagnostic the *starter* is expected to produce. `chip.mono "expect E0382"`. Enforced only at build time by `expect_findings`; the runtime never checks it |
| `starter` | string | the code the editor opens with, and what Reset restores |
| `tests` | string \| falsy | hidden test module, **appended** to the reader's source. Falsy ⇒ compiling is the whole task |
| `solution` | string | the reference answer. **Never read by the frontend** — build-time validation only |
| `hints` | string[] | revealed one at a time, escaped as plain text. 1–3 in practice |
| `diagnose` | `{ [errorCode]: html }` | the "What that actually means" panel, looked up by the code rustc actually emitted. 0–3 entries |
| `brief` | HTML string | the task statement above the editor |
| `after` | HTML string | the "Now that it compiles" panel, shown only once passed |
| `mins` | int | authored estimate; **read by nothing in the frontend** |

Real example (`data/ex/05-ownership.json`, exercise 1, bodies truncated):
```json
{"unit":"05-ownership","exercises":[{
  "n":1,
  "title":"The function ate your string",
  "kind":"fix",
  "concept":"move",
  "expect":{"code":"E0382"},
  "starter":"pub fn describe(s: String) -> usize {\n    s.len()\n}\n\npub fn run() -> String {\n    let s = String::from(\"ferris\");\n    let n = describe(s);\n    format!(\"{s} has {n} bytes\")\n}",
  "tests":"#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn keeps_the_string() {\n        assert_eq!(run(), \"ferris has 6 bytes\");\n    }\n}",
  "solution":"pub fn describe(s: &str) -> usize {\n    s.len()\n}\n…",
  "hints":["`describe` never modifies the string and never needs to keep it. It only reads it.", "…", "…"],
  "diagnose":{"E0382":"<p>Read the three underlines rustc gave you…</p>"},
  "brief":"<p><code>describe</code> only wants to know how long the string is…</p>",
  "after":"<p>The fix you want is <code>&amp;str</code>, not <code>&amp;String</code>…</p>",
  "mins":2
}]}
```

`expect` variants observed in the corpus: `{"code":"E0382"}` ×312,
`{"any":true}` ×2 (the starter fails a test rather than the compiler), `null` ×2
(both `kind: "predict"`, where nothing is expected to fail).

Project stages use the identical `Item` shape — the same `n`, `starter`, `tests`,
`diagnose` — and their `starter` is written so that stages **accumulate**: you
are editing one growing file across the stages, not eight unrelated snippets.

### 8.4 `drills/<slug>.json`

```
{ unit: "<slug>", questions: Question[] }
Question = { n, stem: html, options: Option[], answer: string, why: html }
Option   = { key: "A".."E", text: html, correct: bool }
```

| Field | Type | Meaning |
|---|---|---|
| `n` | int | display ordinal, zero-padded to 2 |
| `stem` | HTML | the question, usually a `codeblock` div plus a sentence |
| `options` | Option[] | 4 (×378) or 5 (×42) in the corpus |
| `options[].key` | string | single uppercase letter, shown in `span.k` and used as `data-k` |
| `options[].text` | HTML | injected raw |
| `options[].correct` | bool | **redundant with `answer` and never read by the frontend** |
| `answer` | string | concatenated correct keys, e.g. `"B"` or `"ACD"`. Its **length** drives the multi-select flow |
| `why` | HTML | the explanation revealed after answering |

Answer-length distribution across 420 questions: 1 key ×347, 2 ×31, 3 ×34, 4 ×8.

```json
{"unit":"05-ownership","questions":[{
  "n":1,
  "stem":"<p>Does this compile?</p><div class=\"codeblock \" data-lang=\"rust\"><div class=\"cb-head\"><span>rust</span></div><pre><code>let a = String::from(\"hi\");\nlet b = a;\nprintln!(\"{a}\");</code></pre></div>",
  "options":[
    {"key":"A","text":"Yes, <code>a</code> and <code>b</code> both point at the string","correct":false},
    {"key":"B","text":"No, <code>a</code> was moved into <code>b</code>","correct":true},
    {"key":"C","text":"…","correct":false},
    {"key":"D","text":"…","correct":false}],
  "answer":"B",
  "why":"<p><code>String</code> is not <code>Copy</code>, so <code>let b = a;</code> <span class=\"term\" data-g=\"Transferring ownership…\">moves</span>…</p>"
}]}
```

### 8.5 `glossary.json`

```
{ terms: Term[] }
Term = { t, p, x?, in: Ref[] }
Ref  = { s, n, k }
```

| Field | Type | Meaning |
|---|---|---|
| `t` | string | the term. Its first character drives the A–Z index (`letterOf`: non-A–Z ⇒ `#`) |
| `p` | string | the definition, one plain sentence. Rendered escaped |
| `x` | string | optional short gloss, one clause. Rendered as `.x` above the definition |
| `in` | Ref[] | where it is taught; may be empty |
| `in[].s` | string | unit or project slug |
| `in[].n` | string | display name for the chip |
| `in[].k` | `"unit"` \| `"project"` | picks `#/unit/<s>` vs `#/project/<s>` — anything not `"project"` routes to `unit` |

218 terms in the corpus.
```json
{"terms":[
 {"t":"adapter",
  "p":"A method such as map or filter that returns a new iterator wrapping the old one and does no work at all until something asks it for an element.",
  "x":"an iterator that wraps an iterator","in":[]},
 {"t":"aliasing",
  "p":"Having more than one path to the same piece of memory, which is harmless on its own and dangerous the moment one of those paths can write.",
  "x":"two ways to reach one value",
  "in":[{"s":"06-borrowing","n":"Borrowing and references","k":"unit"}]}
]}
```

The same definitions are also inlined into the prose as
`<span class="term" data-t="…" data-g="…">` at build time, so the hover popover
does **not** read this file.

### 8.6 `search.json`

```
{ units: [ { slug, sections: string[], concepts: string[] } ] }
```
Only ready units appear. `sections` are top-level `parts[].title` **only** —
sub-headings are not indexed. `concepts` is a copy of the unit's `concepts`.
See §4.1 for the emitting code and §4.2 for how it is consumed.

### 8.7 `.validate-cache.json`

Build-time only. Keyed by a hash of `starter`/`tests`/`solution`/`expect`
(`json.dumps(ex["expect"], sort_keys=True)` is part of the key) so that
re-running `build.py --validate` only recompiles items whose content actually
changed. Never fetched by the browser. `manifest.audit.cached` /
`audit.checked` report how it split.

### 8.8 Contract invariants a new `build.py` must hold

1. `manifest.units[i].slug` must have a matching `data/unit/<slug>.json`
   whenever `ready` is true — otherwise the route throws into `notFound()`.
2. `manifest.units[i].exercises` must equal `data/ex/<slug>.json.exercises.length`,
   and `.drills` must equal `questions.length`. The counts drive the progress
   rings, the `doneCount` loops and the workbench guard; a mismatch silently
   mis-reports progress.
3. `manifest.projects[i].stages` must equal `project/<slug>.json.stages.length`.
4. `n` must be a dense 1..N sequence. `pickEx` clamps into that range and
   `doneCount` iterates `1..total`, so a gap permanently reads as unfinished.
5. Anchor ids (`parts[].id`, `subs[].id`) must be unique within a unit — they
   are DOM ids and route params.
6. `accent` must be one of the seven names with a `[data-accent]` rule, or the
   subtree silently inherits the default.
7. `needs` entries must be real unit slugs; they are rendered as links with no
   existence check.
8. `answer` keys must exist among `options[].key`, and `answer.length` must equal
   the number of correct options, or the multi-select never resolves.
9. Every HTML-typed field is injected unescaped. `build.py` is the only trust
   boundary; the frontend does no sanitisation of authored content.

---

## 9. What is subject-specific vs generic

### 9.1 Already generic — reuse as-is

These carry no knowledge of Rust and transplant unchanged:

- The router (`render`, `CURRENT`, `paintChrome`, `NAV`), `get()`/`cache`.
- The progress model: `PKEY`, `exKey`, `passed`, `markAttempt`, `doneCount`,
  `touchStreak`, `loadProgress`/`saveProgress`, `flag`/`setFlag`.
- Every shared fragment: `crumbs`, `pagenav`, `ring`, `rail`, `sectionBlock`,
  `unitCard`, `projectCard`, `mins`, `num`, `ico`/`I`.
- The `BENCH` table — the unit-exercise / project-stage duality is a content
  shape, not a language feature.
- The contents rail and its scroll watcher, `jumpTo`, the mobile sheet, the
  `[data-toggle]` mechanism, the glossary popover.
- `viewHome`, `viewTrack`, `viewProjects`, `viewProject`, `viewProgress`,
  `viewGlossary`, `viewSearch`, `viewDrills`, `wireDrills`, `wireProgress`,
  `wireGlossary` — all of them modulo copy strings.
- `assets/vim.js` in its entirety (it edits text, not Rust).
- The accent system, the type scale, the whole of `app.css` except four tokens.
- `data/` shapes for `unit/*`, `drills/*`, `glossary.json`, `search.json`,
  `manifest.units/projects/tiers/totals`.

### 9.2 Branding and copy — every hardcoded string

**`index.html`**

| Line | String |
|---|---|
| 6 | `<title>Rust Handbook</title>` |
| 7 | meta description: *"Learn Rust by fighting the compiler. Every exercise compiles for real… what the borrow checker actually saw."* |
| 12–13, 16 | `assets/ferris.png` ×3 (icon, apple-touch-icon, og:image) |
| 14 | `og:title` = `Rust Handbook` |
| 15 | `og:description` = *"Learn Rust by fighting the compiler."* |
| 18–19 | `theme-color` `#efebe4` / `#1c1917` (palette, must track the CSS `--bg`) |
| 23 | `localStorage.getItem('rh-theme')` — the `rh-` key prefix, ×6 keys |
| 31–32 | brand `<img class="mascot" src="assets/ferris.png" width="30" height="20">` + text `Rust Handbook` |
| 49 | `#gh` href `https://github.com/madalintat/rust-handbook` |
| 82 | footer `<img class="rustmark" src="assets/rust-logo.svg">` |
| 83 | footer text `Rust Handbook` |
| 89 | *"Compiled for real by [play.rust-lang.org](https://play.rust-lang.org)."* |

**`assets/app.js` — user-visible copy naming Rust**

| Line | String |
|---|---|
| 235 | `<h1>Learn Rust by <em>fighting the compiler</em>.</h1>` |
| 236–238 | lede: *"…When rustc rejects your code, you get its actual diagnostic, and next to it a plain-English reading of what the borrow checker saw and why it cared."* |
| 245 | `alt="Ferris, the Rust mascot"` |
| 250 | stat label `compiled exercises` |
| 258 | `color:var(--ferris)` on the streak flame |
| 482 | *"N exercises, compiled for real."* |
| 702 | `<span class="kbd">⌘ ↵ to run</span>` (generic) |
| 730–731 | verdicts: `'Compiles, and every test passes.'`, `'It compiles.'`, `'It compiles, but the tests disagree.'`, **`'rustc said no.'`** |
| 749–752 | hidden-tests explainer (mentions *signature*, *return type*) |
| 757 | `<details class="raw"><summary>rustc's own output</summary>` |
| 760–763 | **`https://doc.rust-lang.org/error_codes/${code}.html`** + *"in the error index ↗"* |
| 871 | offline copy: *"Could not reach the compiler. The workbench needs a network connection. This is not your code."* |
| 1264–1268 | toolchain notes: *"…added since the last validation run and not yet compiled"*, *"Validated on rustc X; the playground is now on Y"*, *"rustc X, released D"* |
| 1270–1273 | `https://releases.rs`, `rustc ${version} · edition ${DB?.edition || '2024'}` |
| 1160–1162 | 404: mascot image + *"That unit may not be written yet."* |
| 806–807 | `el.textContent = \`rustc ${tc.version}\`` — the `#toolchain-wb` badge (element at 701) |

**`assets/companion.js`** — 4 of 9 lines name Rust concepts:
*"it was a compile error, so it could never have shipped"*, *"the errors should be
starting to look like sentences"*, **"Every one of them compiled on real rustc"**,
**"Reading a borrow error at hour two"**, *"The compiler will still be here."*

**`assets/app.css`** — `--rust: #ce422b` ("rust-lang.org's own red-orange"),
`--ferris: #f74c00` ("the crab"), `[data-accent="rust"]`, `[data-accent="ferris"]`,
plus the header comment. Everything else is neutral.

**`build.py`** — `TRACK` (28 Rust unit titles/blurbs/accents), `TIERS`,
`"title": "Rust Handbook"`, `"edition": "2024"`, the `@expect E0382` authoring
directive, the llms.txt onboarding prose.

### 9.3 Route names and data fields

Route names are **already subject-neutral**: `unit`, `track`, `work`, `drills`,
`projects`, `project`, `progress`, `glossary`, `search`. Nothing says `rust`.
Slugs (`05-ownership`) are content, not code.

Data fields that encode Rust:

| Field | Where | Assumption |
|---|---|---|
| `expect.code` | `Item` | the value is a rustc `E\d{4}` code |
| `diagnose` | `Item` | **keyed by rustc error code**, so the whole explanation-lookup mechanism assumes stable, enumerable, string-identified diagnostics |
| `manifest.edition` | manifest | a Rust edition; forwarded verbatim into the playground request |
| `manifest.audit.toolchain` | manifest | **one** `{version, date, hash}` — a single compiler |
| `manifest.audit.unvalidated_count` | manifest | one validation run against one backend |
| `data-lang="rust"` | build-emitted codeblocks | present in the HTML, **never read by the app** |
| `unit.concepts` | unit | Rust nouns, but structurally free-form |

### 9.4 The single-backend assumptions, exhaustively

Everything below lives in `assets/workbench.js` unless noted. This is the list a
four-backend build has to break open.

**Lexing — one tokenizer, called unconditionally**
- `KW` (32 words), `KW2` (13 modifiers: `mut`, `ref`, `move`, `dyn`…), `PRIM`
  (18 primitive types) are Rust vocabulary sets.
- `TOK`, one regex with 8 ordered alternations, encodes Rust *lexical* rules:
  `r#"…"#` raw strings, `b"…"` byte strings, `'a'` char literals **before**
  `'a` lifetimes (the ordering is the whole correctness argument), `#[…]` /
  `#![…]` attributes, `0x_`/`0b_`/`0o_` literals with `i32`/`u8`/`f64` suffixes,
  `name!` macros.
- `hlRust(src)` is called by `mountEditor.paint()` **and** by `snippet()`. Both
  are hard-wired: there is no `highlight` parameter anywhere.
- `TAB = '    '` (4 spaces) and the Enter auto-indent rule `/[{([]\s*$/` are
  Rust/C-family conventions — wrong for a Python or assembly backend.
- The token CSS classes (`t-kw`, `t-kw2`, `t-type`, `t-life`, `t-attr`, `t-mac`,
  `t-num`, `t-str`, `t-cmt`, `t-fn`) are named for Rust categories.
- `aria-label="Rust source"` on the textarea.

**Execution — one endpoint, one request shape**
```js
const PLAY     = 'https://play.rust-lang.org/execute';
const VERSIONS = 'https://play.rust-lang.org/meta/versions';

async function run(code, { tests = null, edition = '2024' } = {}) { … }
```
- `run()` takes **no backend argument**. `edition` is the only knob, and it
  defaults to a Rust edition.
- The POST body is playground-specific:
  `{ channel:'stable', mode:'debug', edition, crateType: tests ? 'lib' : 'bin', tests: !!tests, backtrace:false, code }`.
- `assemble(code, tests)` **appends** the test module with `'\n\n'` and returns
  `userLines = code.split('\n').length`. Two language assumptions: that a test
  module is valid appended source, and that appending preserves the line numbers
  of the reader's own code (which is what makes `inTests` detection work at all).
- `toolchain()` memoises **one** `_tc` promise reading `d.stable.rustc`.

**Diagnostics — three regexes, all rustc/cargo/libtest**
```js
const RE_DIAG = /^(error|warning)(?:\[(E\d{4})\])?: (.+)$/;
const RE_LOC  = /^\s*-->\s+src\/\w+\.rs:(\d+):(\d+)/;
const RE_TEST = /^test (\S+) \.\.\. (ok|FAILED|ignored)$/;
```
- `RE_LOC` hardcodes the playground's virtual path `src/<name>.rs`.
- Cargo bookkeeping is filtered by literal English:
  `/^aborting due to|^could not compile|previous error|generated \d+ warning/`.
- Panic extraction assumes libtest's `---- <name> stdout ----` sections and the
  `panicked at …` line, with `note: run with` as the terminator.
- Stream split is fixed: **diagnostics on stderr, test results on stdout**.
  (`parse` takes the whole result object rather than a string precisely because
  getting this backwards silently produces a run that "passed" because no test
  was found.)
- Error identity is a `E\d{4}` string, and three separate consumers key on it:
  `diagnose[e.code]`, the `doc.rust-lang.org/error_codes/` chip, and the
  `expect` chip in the workbench header.

**Presentation (`app.js`)**
- `renderOutput` names rustc in the verdict and in the raw-output disclosure, and
  builds the Rust error-index URL inline.
- `paintToolchain` renders *one* version pair and *one* edition.
- `#toolchain-wb` shows `rustc <version>` for whatever exercise is open.

**Schema**
- `Item` has **no `backend`, `lang` or `runner` field.** Nothing in `data/`
  distinguishes one execution target from another.

### 9.5 What a four-backend build has to change

The seams are narrow because everything Rust-aware is already funnelled through
`WB` and through five strings in `app.js`. Minimum viable shape:

1. **Schema.** Add `backend: "<id>"` to `Item` (exercise *and* stage), optional,
   defaulting per-unit or globally. Add `manifest.backends`:
   ```json
   {"backends": {
      "<id>": {"label":"…","lang":"…","docs":"https://…/{code}","edition":"…"}}}
   ```
   and make `manifest.audit.toolchain` a **map keyed by backend id** rather than
   a single object (`paintToolchain` and `unvalidated_count` follow).
   Keep `expect.code` and `diagnose`'s keys as opaque strings — they already are;
   only the *namespace* becomes per-backend.

2. **`WB` becomes a registry, not a singleton.** Each backend supplies the same
   seven-member interface that `workbench.js` already implements once:
   `{ id, label, highlight(src), tab, indentAfter, run(code, {tests}), parse(res), toolchain(), docsUrl(code) }`.
   `hlRust`, `run`, `parse`, `toolchain` become one entry in that table; the
   shared parts (`esc`, `snippet`, `mountEditor`, the assemble/`userLines`
   contract, the `{errors, warnings, tests}` return shape) stay backend-agnostic.
   `snippet(code, line, col)` needs a `highlight` argument; `mountEditor(host,
   starter, onRun)` needs one too, plus `tab` and the indent rule.

3. **Resolve the backend once, in `wireWork`/`viewWork`**, next to `pickEx`:
   ```js
   const B  = BENCH[source];
   const bk = BACKENDS[ex.backend || meta.backend || DB.defaultBackend];
   ```
   and thread `bk` into `mountEditor`, `doRun`, and `renderOutput`. `renderOutput`
   is already pure and already takes a bag of params — add `bk` and replace
   `'rustc said no.'` with `bk.failVerdict` and the error-index URL with
   `bk.docsUrl(e.code)`.

4. **The selector.** `.wbbar` already holds five controls in a flex row; a
   segmented control or `<select>` slots in beside `#wrap`. Two behaviours worth
   deciding up front:
   - if `ex.backend` is **pinned** by the data, render it as a read-only
     `chip.mono` in `.wbhead` beside `ex.kind` (it is a property of the exercise,
     not a preference), and
   - if the exercise is backend-*agnostic*, make the selector a persisted flag
     (`hb-backend`, same `flag`/`setFlag` pattern) so it survives navigation, and
     re-mount the editor on change (`ED = WB.mountEditor(...)` with the new
     `highlight`) rather than trying to re-highlight in place.
   Progress keys must **not** include the backend, or the same exercise solved on
   two backends would count twice.

5. **`paintToolchain`** becomes per-backend: either show the backend of the
   current view, or render one badge per backend in the footer. `WB.toolchain()`'s
   `_tc` single-promise cache becomes a `Map<backendId, Promise>` with the same
   "cache the promise, not the result" rule.

6. **Copy.** Replace the strings in §9.2 with backend-neutral wording
   ("the compiler said no" → `bk.failVerdict`), and the companion's four
   Rust-specific lines. The mascot swap list is §6.4.

Everything else — router, progress, rail, drills, glossary, search, sheet, the
whole of `app.css` and `vim.js` — is untouched by the backend question.
