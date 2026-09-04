# The Hardware Handbook: implementation

Branch `feat/handbook-implementation`. Updated before every commit.

Legend: `[x]` done and tested, `[~]` in progress, `[ ]` not started.

## 0. Foundation

- [x] `track.py` — 19 parts, 122 units, validated
- [x] `prose.py` — humanizer rules enforced mechanically, self-tested
- [x] `build.py` — markdown to JSON, four-backend registry, regex `@expect`
- [x] `test_build.py` — 23 tests, no network, sub-second
- [x] `assets/app.css` — phosphor palette, four inks, fluid type
- [x] `index.html` + `assets/app.js` — routing, home, track, theme, tab bar
- [x] Verified in a real browser at three widths

## 1. Reference study

- [x] Rust Handbook: design system, app architecture, workbench, content pipeline
- [x] Python handbook: structured verdicts, the `silent` case, solution leak
- [x] Family analysis: only 3 designs, not 4 (Voice is a fork of Rust, no content)
- [x] Fold the findings into the design doc: section 10 records what the
      design got right, the three things it got wrong, and what only the real
      tools could have said. Every doc is under the prose lint now

## 2. The unit view

- [x] `#/unit/<slug>` route, note rendering, front matter
- [x] Contents rail: sticky spine, per-section dots that latch on furthest read
- [x] Read state persisted, unlike the reference which loses it on scroll-up
- [x] Prev/next within a part, and across parts
- [x] Mobile: rail collapses to a bottom sheet with a real focus trap
- [x] Deep link to a heading: `#/unit/<slug>/<heading>`
- [x] Teardown registry so view listeners do not leak across navigations
- [x] Stub view for a planned unit, so all 122 are reachable

## 3. The workbench

- [x] Editor: transparent textarea over a highlighted `<pre>`, 15 shared metrics
- [x] Tokenizers: netlist, C, C++, CUDA, Verilog, Python, x86-64. 29 tests
- [x] Backend interface: one shape, registry, three distinct non-pass states
- [x] `sim` — in-page logic simulator, 24 tests, Worker-ready
- [x] `godbolt` — Compiler Explorer client, nonce proven to defeat the cache
- [x] `yosys` — yowasp-yosys 0.68 in a module worker, size gate, progress
- [x] `modal` — submit and poll, GPU picker with compute-capability gating
- [x] Judged expectations: `verdict` / `match` / `silent`, per-backend vocabulary
- [x] Diagnostics UI: prose beside the real error, ordered first-match
- [x] Pass state, hint counting, editor buffer persisted per exercise
- [x] Vim mode: `assets/vim.js`, opt-in, off by default, desk only. Normal,
      insert, visual and visual-line modes, counts, the usual motions,
      operators over any motion, an unnamed register, undo and redo, search.
      22 tests against a stub textarea, no browser needed

## 4. Content

- [x] Part I complete: `switch`, `cmos-gate`, `power`, `fabrication`
- [x] Unit `nand` complete: note, 8 exercises, 15 drills, all validated
- [x] Unit `integers` complete: note, 8 exercises, 15 drills (proves `godbolt`)
- [x] Unit `registers` complete: note, 8 exercises, 15 drills, all validated
      against the real assembler (proves `asm` through `godbolt`)
- [x] Unit `clock-edge` complete: note, 8 exercises, 15 drills (proves `yosys`)
- [x] Unit `execution-model` complete: note, 8 exercises, 15 drills,
      all eight checked on a real T4 (proves `modal`)

## 4a. From the family analysis, not yet done

- [x] `data/judges.json` authored by `build.py`, so the browser cannot call a
      backend configuration that `--validate` never checked
- [x] Label the verdict row per backend rather than badging the exercise; badge
      only Modal, because it is the one with a cost
- [x] Track view will not survive 122 units as a flat list: three levels now
      (phase, part, unit), units are rows rather than cards, live filter that
      hides emptied parts and phases. Not splitting the manifest: it is 11.8 KB
      gzipped, and search, progress and prev/next all need all of it
- [x] Accent is a property of the phase. 19 parts in 7 phases, one accent each,
      and a part cannot write its own accent because the tuple has no slot for
      one. Validated: the phases must list the parts in track order
- [x] Render the dependency edges, both directions. `needs:` is validated
      (unknown slug or a forward edge is a build error) and the reverse edge is
      computed, so a planned unit can say which written units already build on
      it. Shown on written units and on stubs
- [x] Non-binary pass state: "Correct, and not clean"
- [x] Empty states worth reading: search idle names what is indexed and offers
      example queries the build proves return something, a missed search or a
      mistyped unit slug names the nearest real one, and progress before any
      work shows where to start rather than a table of zeros

## 4b. Design pass

- [x] Gold-led palette. Green is free for `--ok` now that the brand is not green
- [x] `figures.py`: five diagram kinds rendered to inline SVG at build time
- [x] Hero is two columns, with the argument the lede makes drawn beside it
- [x] Track list: progress ring per part, accent spine, compact rows
- [x] Atlas hover cards: a capability strip, the full row, and what it costs
      to rent, joined from the Modal catalogue
- [x] Glossary hover cards, with the definition inlined at build time
- [x] Touch targets at 390px: 44 / 40 / 38 / 36, and 24 for inline links
- [x] Prose pass over every note, for connection rather than correctness:
      every figure is introduced by the sentence before it, every unit ends
      pointing at the next one, and 17 more glossary terms across numbers,
      the machine and the GPU so terms are hoverable outside Part II

## 5. The rest of the site

- [x] Drills view: marks, explains every answer, persists best and attempts
- [x] Progress view, with a two-press erase that keeps preferences
- [x] Search: ranked, snippets around the match, indexes section bodies
- [x] Glossary, with a gate that rejects a link to an undefined term
- [x] Atlas: data-driven tables with a validation gate, sources and a filter
- [x] Errors page: all 30 verdicts across the four backends, gated both ways
      so a verdict cannot ship undocumented and an entry cannot describe a
      verdict no backend emits. Result rows link to their entry

## 6. Ship

- [x] `build.py --validate`: proven for all four backends, 32 of 32 exercises
- [x] `release.sh --check`, staleness gate on `data/`. Checks freshness,
      tests, palette, syntax, no leaked solution, no leftover TODO, and the
      real tools when the network is there. Reports what it skipped rather
      than passing it, and verifies it changed nothing
- [x] `runner/app.py` with a self-test, and the settings page that explains it
- [x] `docs/AUTHORING.md`, with its commands and its numbers under test
- [x] Mascot wired: header mark, favicon, apple touch icon, social preview and
      the 404. Background keyed out by `tools/keyout.py`, since there is no
      ImageMagick here and the source is a JPEG on solid black

## 7. UI audit, 2026-09-02

- [x] Branch `fix/ui-audit-2026-09`. The list, the measurements and what
      each fix was for are in `docs/superpowers/plans/2026-09-02-ui-audit.md`.
      Phone layout on the unit, workbench and track pages; the skip link;
      hover cards; the render race; the theme flash; scroll memory on Back;
      and `tools/check-css.mjs`, which fails the release on a `var()` that
      nothing defines

## 8. Content, from unit 047

- [x] 047 `parsing`, source text to syntax tree. Note, 8 exercises validated
      against gcc and clang, 15 drills. Its `needs` are `languages` and
      `compile-time`, which the under-the-code path now declares it skips
- [ ] 048 `ssa`, and the rest of Part IX
