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
- [ ] Fold the findings into the design doc

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
- [ ] `modal` — submit and poll against the learner's own endpoint
- [x] Judged expectations: `verdict` / `match` / `silent`, per-backend vocabulary
- [x] Diagnostics UI: prose beside the real error, ordered first-match
- [x] Pass state, hint counting, editor buffer persisted per exercise
- [ ] Vim mode

## 4. Content

- [x] Unit `nand` complete: note, 8 exercises, 15 drills, all validated
- [x] Unit `integers` complete: note, 8 exercises, 15 drills (proves `godbolt`)
- [ ] Unit `registers` complete (x86-64 asm through `godbolt`)
- [x] Unit `clock-edge` complete: note, 8 exercises, 15 drills (proves `yosys`)
- [ ] Unit `execution-model` complete (proves `modal`)

## 4a. From the family analysis, not yet done

- [x] `data/judges.json` authored by `build.py`, so the browser cannot call a
      backend configuration that `--validate` never checked
- [ ] Label the verdict row per backend rather than badging the exercise; badge
      only Modal, because it is the one with a cost
- [ ] Track view will not survive 122 units as a flat list: two-level index,
      live filter, and stop loading the whole manifest at boot
- [ ] Accent should be a property of the phase, not a 7-colour rotation across
      19 parts, where it stops meaning anything
- [ ] Render the dependency edges. Every handbook in the family computes a
      dependency order at build time and throws it away. At 122 units "each
      unit depends on the ones before it" stops being true, and `needs:` is
      already in the front matter
- [x] Non-binary pass state: "Correct, and not clean"
- [ ] Empty states worth reading, which is the family's weakest copy

## 5. The rest of the site

- [ ] Drills view with results persisted
- [ ] Progress view
- [ ] Search with ranking, no truncation by traversal order
- [ ] Glossary
- [ ] Atlas: data-driven hardware reference tables
- [ ] Errors page

## 6. Ship

- [~] `build.py --validate`: proven for `sim`, `godbolt` and `yosys`; modal pending
- [ ] `release.sh --check`, staleness gate on `data/`
- [ ] `runner/app.py` and the learner onboarding doc
- [ ] `docs/AUTHORING.md`
- [ ] Mascot from the user, wired at its single swap point
