# Writing a unit

Every rule below is enforced by `python3 build.py`. Nothing here is a
convention you have to remember: if you get it wrong the build says so, names
the file, and refuses to write anything. That is deliberate. A handbook that
ships a half-written unit is worse than one that refuses to build.

Run `./release.sh --check` before you commit.

## The four files

A unit called `nand` is four files, and the first one is not optional:

    track.py                    the entry. Nothing exists until it is here.
    content/units/nand.md       the note
    content/ex/nand.md          eight exercises
    content/drills/nand.md      fifteen drills

Adding the entry to `track.py` and nothing else is fine and expected: the unit
appears in the track as a stub, reachable and honest about being unwritten.
Adding a note without exercises is not: the build fails, because a half-written
unit that looks finished is the failure mode this whole pipeline exists to
prevent.

## The entry in track.py

    ("nand", "logic", "One primitive, all of logic",
     "Given enough NAND gates you can build every Boolean function there is. "
     "Not most of them. All of them.", "sim"),

Slug, part id, title, blurb, backend. The slug must be kebab-case and unique.
The backend is one of `sim`, `godbolt`, `yosys`, `modal`.

You do not choose an accent. The part belongs to a phase and the phase owns the
colour, so the two can never disagree. If you add a part, add it to a phase in
the same commit or the build fails.

## The note

    ---
    needs: [cmos-gate]
    minutes: 45
    one_idea: Every Boolean function is one repeated part.
    sources: [nand2tetris-eater-scott]
    ---

    Prose, in Markdown.

Between 1400 and 2200 words. Under it you have not explained anything; over it
you have written two units.

`needs` names units that must be read first. Every slug has to exist in
`track.py` and come earlier in the track, or the build fails. You do not have
to maintain the reverse direction: "units that build on this one" is computed,
and it is the more useful of the two, because the next unit in the track is
often not the one that uses this one.

`one_idea` is the single sentence a reader should still have in a year.

### Inline markup

`` `code` ``, `**bold**`, `*italic*`, `[text](url)`, and `[[term]]` for a
glossary link. `[[term|other words]]` links the term and shows the other words,
so a sentence does not have to bend around a slug.

A `[[term]]` with no definition is a build error. Define it in
`content/gloss/<area>.md`.

### Figures

A diagram is a fenced `figure` block holding JSON, rendered to inline SVG at
build time. Not an image: a PNG cannot follow the theme, cannot be selected or
read aloud, and goes stale the moment a number in it changes.

    ```figure
    {
      "kind": "bits",
      "alt": "What the diagram shows, in a sentence, for a screen reader.",
      "caption": "Shown under the figure. This is prose and it is linted.",
      "bits": 64,
      "groups":   [ { "from": 0, "to": 7, "label": "al", "accent": "gold" } ],
      "brackets": [ { "from": 0, "to": 15, "label": "ax", "lane": 0 } ]
    }
    ```

Four kinds:

    bits    a word divided into fields, with brackets for nested ranges
    gates   a logic circuit, from explicit column and row positions
    timing  waveforms, one row per signal, wave characters 0 1 . x p
    blocks  boxes and arrows, for anything structural

`alt` and `caption` are both required, and `alt` must be at least six words
saying what the diagram shows rather than that it is a diagram. A figure with
no description is a figure some readers simply do not get.

An `accent` names a phase token (`gold`, `azure`, `jade` and so on) or a status
(`ok`, `warn`, `bad`). Never a colour.

A figure's own labels do not count toward the word target and are not linted,
so a unit cannot reach 1400 words by drawing. The caption does count and is
linted like any other prose.

### What the prose linter rejects

Em dashes and en dashes, curly quotes, title case in headings, and a word list.
Run `python3 -c "import prose; print(sorted(prose.AI_WORDS))"` for the current
one. It is the usual set of tells, and it deliberately leaves out `key` and
`critical`, which are terms of art in a handbook about hardware.

It also catches a doubled word and a repeated phrase, which is almost always a
botched search and replace rather than a choice. Pure numbers repeating are
exempt, because a truth table is data, not a botched edit.

It reads prose only. Code inside fences and inline code spans are exempt, so
`xor eax, eax` twice in a listing is fine.

## Exercises

Exactly eight, separated by `##`. Anything else fails the build.

    ## Inversion, from one gate

    A brief, in Markdown, explaining what to do.

    @kind      output | compile-error | codegen | property
    @concept   One line. What this exercise is actually about.
    @backend   sim | godbolt | yosys | modal      (defaults to the unit's)
    @lang      netlist | c | cpp | cuda | verilog | asm
    @gpu       sm_75                              (modal only, required)
    @flags     -O2 -Wall
    @expect    verdict table-mismatch
    @hint      One line. A sentence that makes you see it.
    @diagnose  <id> verdict table-mismatch
    Prose for exactly that failure, until the next directive.
    @after     Shown once the exercise passes.

    ```starter
    ```
    ```tests
    ```
    ```solution
    ```

`@concept`, `@hint` and the prose under `@diagnose` may wrap across lines.
Everything else may not, and prose that follows a directive without belonging
to it is a build error rather than something quietly appended to the brief.

### Simulator specs

A `sim` exercise carries a `spec` block. Combinational logic uses an exhaustive
`table`, which must have `2^n` rows for `n` inputs:

    { "chip": "Xor", "inputs": ["a","b"], "outputs": ["out"],
      "table": [[0,0,0],[0,1,1],[1,0,1],[1,1,0]], "maxGates": 4 }

Anything holding state uses a `trace` instead: one row per cycle, evaluated in
order with the state carried forward. A table cannot express "what it held last
cycle", so the build rejects a spec that has both.

    { "chip": "Bit", "inputs": ["in","load"], "outputs": ["out"],
      "trace": [[1,1,0],[0,0,1],[1,0,1],[0,1,1],[0,0,0]] }

A part with several outputs is assigned to several names:

    sum, carry = FullAdder(a, b, cin)

Without that, a sub-chip's second output is unreachable, which makes every
adder past the first bit impossible to write.

There are two primitives. `nand` is the one everything is built from. `dff` is
an axiom: its output this cycle is its input from the previous one, every flop
starts at 0, and a loop is legal exactly when it passes through one. A `dff` is
not counted against a gate budget, and flip-flops are reported separately,
because combinational cost and how much state a design carries are two
different mistakes.

### The three judges

    @expect verdict <key>     the tool reported this verdict
    @expect match /regex/     the output matched
    @expect silent            every judge was happy and the answer is wrong

`silent` is the interesting one. It is not "nothing happened": it is the case
where the compiler said nothing, the program exited zero, and the number is
still wrong. Those are the exercises worth writing.

Verdict keys are per backend. `python3 -c "import build; print(build.VERDICTS)"`
lists them, and `content/errors.md` explains every one. A verdict a backend
cannot report is a build error, in both directions.

### The starter must fail

`build.py --validate` compiles and runs every starter and every solution
against the real tool. A starter that passes is a broken exercise and the
validator says so. So is a solution that fails.

This is the check that catches the exercise that looks right and is not. It
found a CUDA exercise whose out-of-bounds write landed inside the same managed
page and was therefore completely silent, which is the opposite of what the
exercise claimed to teach.

Validation needs the network, and `modal` needs a runner you deployed. Without
one, those exercises are reported as skipped rather than passed.

### Solutions never ship

The build writes `starter`, `tests` and `spec` to `data/`, and drops
`solution`. `release.sh` checks that it did.

`tests` does ship, and has to: this is a static site, so the check runs in the
reader's browser. Write tests that are worth not cheating on rather than
pretending they are hidden.

## Drills

Exactly fifteen. Three or more options each, one correct.

    ## How many threads are in a warp?

    - [x] 32
    - [ ] 64
    - [ ] Whatever `blockDim.x` is

    @why Thirty-two is a property of the hardware. It comes from graphics:
    eight 2x2 pixel quads to a warp.

A question may wrap across lines; one that does not end in punctuation is a
build error, because that is what a silently truncated question looks like.

`@why` is shown for every answer, right and wrong. Write it as the explanation,
not as a verdict.

## The colours

Do not add a colour. Seven accents exist, one per phase, and `contrast.py`
measures every one of them against the ground it is used on. The build fails if
any text drops below 4.5:1.

If you need a colour for text, use `--accent-ink`, not `--accent`. The first is
measured for type and the second is for rules and dots. In dark mode they are
the same value; in light mode they are not, because a green that reads fine as
a 2px rule is 2.9:1 as 12px type.

Never dim text with `opacity`. It puts text under the floor while devtools
still reports the token you chose. Use the next ink down.

## Before you commit

    ./release.sh --check

It verifies that `data/` matches `content/`, runs every test, checks the
palette, checks no solution leaked, and validates against the real tools if the
network is there. It changes nothing, and it checks that it changed nothing.

`data/` is generated and committed. Commit it with the content change that
produced it, or the site serves stale JSON and nothing about the page looks
wrong.
