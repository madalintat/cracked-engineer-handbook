# The Hardware Handbook

How computers work, from the transistor up. Nineteen parts and 122 units in one
dependency chain: leakage physics forces the frequency wall, the wall forces
multicore, multicore forces GPUs, and GPUs force four-bit arithmetic.

Every exercise is checked by a tool that complains specifically, and the build
refuses to ship anything it has not checked.

## What is here

    track.py        the table of contents. Nothing exists until it is here
    build.py        content/ to data/, and every gate described below
    figures.py      six kinds of diagram, rendered to inline SVG at build time
    prose.py        the writing rules, enforced mechanically
    contrast.py     the palette, measured against the grounds it is used on
    content/        notes, exercises, drills, glossary, atlas, in markdown
    data/           generated, and committed, so the site needs no build step
    assets/         one stylesheet, one app, one workbench, four backends
    runner/         the GPU runner a learner deploys to their own account
    docs/AUTHORING.md   how to write a unit

No framework, no npm, no bundler. `index.html` and a static directory.

## Running it

    python3 build.py            # content/ to data/
    python3 -m http.server 8731 # then open http://127.0.0.1:8731/

    ./release.sh --check        # verify without changing anything
    python3 build.py --validate # compile every exercise against the real tools

## The four backends

An exercise declares which tool checks it, and the same client code runs in the
browser and in the validator, so what `--validate` proves is what a reader gets.

| Backend | Tool | Runs where |
|---|---|---|
| `sim` | a NAND-and-wires simulator | in the page |
| `godbolt` | Compiler Explorer: gcc, clang, llvm-mc | a public service |
| `yosys` | Yosys 0.68 compiled to WASM | in the page, after consent |
| `modal` | `nvcc` on a real GPU | a runner you deploy to your own account |

There is no shared GPU and there should not be one. `runner/app.py` is a single
file you deploy to your own Modal account, and everything else works without it.

## What the build refuses to do

The gates are the design. Each one exists because the failure it catches
happened, silently, and was found by looking rather than by checking.

- A note outside 1400 to 2200 words, or one that fails the prose rules
- A unit with a note and no exercises, or with other than eight exercises
- Anything but fifteen drills, or a drill with fewer than three options
- A starter that passes, or a solution that fails, against the real tool
- A verdict a backend can emit and the errors page does not document, or an
  entry for a verdict no backend can emit
- A palette where any text drops below 4.5:1 on the ground it sits on
- A figure with no description, or one that follows a heading with nothing
  saying what the reader is about to look at
- A glossary link in front matter or in a heading, where it renders as nothing
- A reference table with a ragged row, or with no sources
- `data/` that does not match `content/`
- A solution reaching `data/`, which ships to the browser

## State

Ten of 122 units written and validated. Part I is complete and Part II
is under way. The other 112 are in the track as
stubs, so the whole spine is visible and no unit is silently missing.

`TODO.md` tracks the rest. `docs/superpowers/specs/` holds the design and, in
section 10, what building it proved wrong about the design.

## Licence

Not yet chosen, so the default applies: all rights reserved. The research notes
under `.research/` are synthesised from cited public sources and are working
material rather than part of the handbook.
