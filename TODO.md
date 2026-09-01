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
- [ ] Python, Voice and Medical handbooks: what the family converged on
- [ ] Fold the findings into the design doc

## 2. The unit view

- [ ] `#/unit/<slug>` route, note rendering, front matter
- [ ] Contents rail: sticky spine, per-section dots that latch on furthest read
- [ ] Read state persisted, unlike the reference which loses it on scroll-up
- [ ] Prev/next within a part, and across parts
- [ ] Mobile: rail collapses to a bottom sheet with a real focus trap

## 3. The workbench

- [ ] Editor: transparent textarea over a highlighted `<pre>`, 15 shared metrics
- [ ] Tokenizers: C/C++, CUDA, Verilog, Python, and a per-line pass for x86-64
- [ ] Backend interface: one shape, four implementations
- [ ] `sim` — in-page logic simulator, in a Worker
- [ ] `godbolt` — Compiler Explorer client, nonce in `userArguments`
- [ ] `yosys` — `yowasp-yosys` in a Worker
- [ ] `modal` — submit and poll against the learner's own endpoint
- [ ] Diagnostics: normalise, ordered rule match, prose beside the real error
- [ ] Pass state, hint counting, editor buffer persisted per exercise
- [ ] Vim mode

## 4. Content

- [ ] Unit `nand` complete: note, 8 exercises, 15 drills (proves `sim`)
- [ ] Unit `registers` complete (proves `godbolt`)
- [ ] Unit `clock-edge` complete (proves `yosys`)
- [ ] Unit `execution-model` complete (proves `modal`)

## 5. The rest of the site

- [ ] Drills view with results persisted
- [ ] Progress view
- [ ] Search with ranking, no truncation by traversal order
- [ ] Glossary
- [ ] Atlas: data-driven hardware reference tables
- [ ] Errors page

## 6. Ship

- [ ] `build.py --validate` against the real toolchains
- [ ] `release.sh --check`, staleness gate on `data/`
- [ ] `runner/app.py` and the learner onboarding doc
- [ ] `docs/AUTHORING.md`
- [ ] Mascot from the user, wired at its single swap point
