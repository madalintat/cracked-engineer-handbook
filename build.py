#!/usr/bin/env python3
"""Content pipeline: authored markdown in content/, JSON out in data/.

Usage:
    python3 build.py                  build everything
    python3 build.py --check FILE     check one exercise file, no network
    python3 build.py --validate       compile every starter and solution for real
    python3 build.py --stats          what exists, what is still a stub

Design notes worth knowing before you edit this:

* track.py is the only registry. A unit file whose slug is absent from TRACK is
  a hard error. A slug in TRACK with no file is emitted as a `ready: false`
  stub, so the whole spine shows on the site from the first day.

* Every count and prose check runs BEFORE anything is written. The reference
  implementation this is modelled on raises after writing, which leaves stale
  JSON on disk after a failed build.

* Verdicts are structured keys first and regexes only as a fallback. Rust has
  E0382 forever; gcc, clang and nvcc give you prose. But every backend still
  exposes SOME stable structured key, and matching on those beats matching on
  wording that a compiler release can change underneath you:

      sim      verdicts the checker itself emits, so they are exact
      godbolt  exit codes, signals, warning flags, sanitizer report kinds
      yosys    inference warnings, SAT results, cell counts
      modal    exit codes, CUDA error names, compute-sanitizer report kinds

  So `@expect` always names its judge: `verdict`, `match`, or `silent`. The
  judge travels with the declaration and is never inferred from the key's
  shape, because a key can look like more than one kind of thing.

* `silent` is a first-class verdict: every judge happy and the answer still
  wrong. An exercise whose starter is meant to compile cleanly and produce the
  wrong number declares `@expect silent`, and --validate checks that its
  starter really does fail on the tests rather than on the toolchain.

* The solution never reaches the browser. The reference implementation ships it
  in the JSON and simply does not render it, which is not the same thing.

* An unknown @directive is an error. Not a warning, not silence.
"""

import argparse
import html
import json
import os
import re
import sys
from pathlib import Path

import contrast
import figures
import prose
import track

ROOT = Path(__file__).parent
CONTENT = ROOT / "content"
DATA = ROOT / "data"

NOTE_WORDS = (1400, 2200)
N_EXERCISES = 8
N_DRILLS = 15

DIRECTIVES = {
    "kind", "concept", "expect", "hint", "diagnose", "after",
    "backend", "gpu", "flags", "lang",
}

# Which source languages each backend can actually check. The editor also picks
# its tokenizer from this, so an unknown value would silently fall back to the
# wrong highlighter.
BACKEND_LANGS = {
    "sim": {"netlist"},
    "godbolt": {"c", "cpp", "asm", "cuda"},
    "yosys": {"verilog"},
    "modal": {"cuda", "cpp"},
}

JUDGES = ("verdict", "match", "silent")

# The stable structured keys each backend can emit. Matching on these beats
# matching on wording a toolchain release can change. Anything not listed here
# has to go through `match` with a regex, and --validate then carries the weight
# of noticing when the wording drifts.
# The toolchain each backend actually uses. Pinned, never "trunk": an exercise
# whose explanation describes a specific diagnostic is a claim about a specific
# compiler version. This dict is emitted to data/judges.json and the browser
# reads it from there, so the page cannot call a configuration --validate has
# never checked.
JUDGES_CONFIG = {
    "godbolt": {
        "endpoint": "https://godbolt.org/api/compiler/{id}/compile",
        "nonceFlag": "-DHH_NONCE",
        "timeoutMs": 30000,
        "langs": {
            "c":    {"id": "cg162", "name": "x86-64 gcc 16.2",
                     "flags": "-O2 -Wall -Wextra -std=c17"},
            "cpp":  {"id": "g162",  "name": "x86-64 gcc 16.2",
                     "flags": "-O2 -Wall -Wextra -std=c++23"},
            # llvm-mc is an assembler, not a compiler driver, and rejects -D
            # outright: "Unknown command line argument '-DHH_NONCE'". The
            # backend-wide nonce flag therefore failed every assembly exercise
            # before an assembly exercise existed to notice. --defsym defines
            # an assembler symbol that nothing references.
            "asm":  {"id": "llvmas2310", "name": "x86-64 clang 23.1.0",
                     "flags": "", "nonceFlag": "--defsym HH_NONCE"},
            "cuda": {"id": "nvcc133", "name": "NVCC 13.3.0",
                     "flags": "-O2 -arch=sm_90 -lineinfo"},
        },
    },
    "sim": {"name": "in-page logic simulator", "timeoutMs": 5000},
    "yosys": {"name": "yowasp-yosys", "timeoutMs": 60000},
    "modal": {"nonceFlag": "-DHH_NONCE", "timeoutMs": 300000,
              "pollMs": 1500, "catalog": "data/modal-gpus.json"},
}

# Compute-capability families, from the NVIDIA architecture research.
#
# This is not an ordering. A cubin built for sm_100a does NOT run on sm_120,
# even though 120 is a larger number and the card is newer and cheaper: 10.x
# and 12.x are different majors and nothing crosses between them except PTX
# JIT. Modal lists RTX-PRO-6000 (sm_120) at $3.03/hr against B200 (sm_100a) at
# $6.25, so a learner economising on an FP4 exercise picks the cheap Blackwell
# and gets a PTX error. Modal documents this nowhere.
SM_FAMILIES = {
    "sm_75":   ["sm_75"],
    "sm_80":   ["sm_80"],
    "sm_86":   ["sm_86"],
    "sm_89":   ["sm_89"],
    "sm_90a":  ["sm_90a"],
    "sm_100a": ["sm_100a", "sm_103a"],   # compute_100f covers 10.0 and 10.3
    "sm_103a": ["sm_103a"],
    "sm_120":  ["sm_120", "sm_121"],     # compute_120f covers 12.0 and 12.1
    "sm_121":  ["sm_121"],
}

# Newer cards run older code, within the limits above.
SM_ORDER = ["sm_75", "sm_80", "sm_86", "sm_89", "sm_90a",
            "sm_100a", "sm_103a", "sm_120", "sm_121"]


def sm_satisfies(required, available):
    """Can a GPU reporting `available` run code built for `required`?

    Three rules, in order:

    1. An `a` suffix means architecture-specific: that compute capability and
       nothing else, ever. sm_90a code does not run on a Blackwell card. The
       family table lists the exceptions, which are the `f` family groupings.
    2. 10.x and 12.x are different majors and nothing crosses between them.
       This is the rule that stops a cheap sm_120 card being offered for an
       FP4 exercise that needs sm_100a.
    3. Otherwise a later card runs earlier code.
    """
    if required == available:
        return True
    if available in SM_FAMILIES.get(required, []):
        return True

    if required.endswith("a"):
        return False              # rule 1: nothing outside the family table

    def major(sm):
        # sm_75 is major 7 minor 5; sm_100a is major 10 minor 0. The digit
        # count decides, which is why this cannot be a string comparison.
        d = "".join(c for c in sm.split("_")[1] if c.isdigit())
        return int(d[:-1]) if d else 0

    if major(required) >= 10 and major(required) != major(available):
        return False              # rule 2: majors do not cross at 10.x / 12.x

    try:
        return SM_ORDER.index(available) >= SM_ORDER.index(required)
    except ValueError:
        return False


VERDICTS = {
    "sim": {
        "table-mismatch",     # output disagreed with the specification
        "non-nand-part",      # referenced a gate that is not built from nand
        "cycle",              # combinational loop, illegal without a clock
        "floating-input",     # a gate input was never connected
        "gate-budget",        # over the allowed gate count
        "ok",
    },
    "godbolt": {
        "compile-error", "link-error", "timeout", "signal", "nonzero-exit",
        "warning", "sanitizer", "assert-failed", "ok",
    },
    "yosys": {
        "syntax-error", "latch-inferred", "multi-driver", "sat-fail",
        "cell-budget", "ok",
    },
    "modal": {
        "compile-error", "launch-error", "cuda-error", "sanitizer",
        "assert-failed", "nonzero-exit", "timeout", "no-endpoint", "ok",
    },
}


class BuildError(Exception):
    """Raised with every problem found, not just the first."""


def fail(problems):
    if problems:
        raise BuildError(f"{len(problems)} problem(s):\n  " + "\n  ".join(problems))


# ---------------------------------------------------------------- front matter

def split_front_matter(text, where):
    if not text.startswith("---\n"):
        raise BuildError(f"{where}: missing front matter")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise BuildError(f"{where}: front matter is not closed")
    raw, body = text[4:end], text[end + 5:]
    meta = {}
    for line in raw.splitlines():
        line = line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            raise BuildError(f"{where}: front matter line without a colon: {line!r}")
        k, v = line.split(":", 1)
        v = v.strip()
        if v.startswith("[") and v.endswith("]"):
            v = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
        else:
            v = v.strip("'\"")
        k = k.strip()
        # `minutes` is arithmetic downstream: a path totals it into an hour
        # count. A string that looks like a number would concatenate instead
        # of adding, so it is converted here and rejected here.
        if k == "minutes" and isinstance(v, str):
            if not v.isdigit():
                raise BuildError(f"{where}: minutes must be a whole number, "
                                 f"not {v!r}")
            v = int(v)
        meta[k] = v
    return meta, body


# ------------------------------------------------------------------- markdown

FENCE = re.compile(r"^```([a-zA-Z0-9_+-]*)\s*$")


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", s)
    # [[term]] links and shows the term; [[term|words]] links and shows words,
    # so a sentence does not have to bend around a slug.
    s = re.sub(r"\[\[([a-z0-9-]+)\|([^\]]+)\]\]",
               r'<a class="gl" href="#/glossary#\1">\2</a>', s)
    s = re.sub(r"\[\[([a-z0-9-]+)\]\]",
               r'<a class="gl" href="#/glossary#\1">\1</a>', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    return s


def slugify(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[^a-zA-Z0-9\s-]", "", s).strip().lower()
    return re.sub(r"\s+", "-", s)


def render(md, where="note"):
    """Markdown to HTML. Returns (html, headings).

    Deliberately small. Supports what the notes actually use: headings, code
    fences, paragraphs, unordered and ordered lists, blockquotes, tables and a
    horizontal rule. Anything else is a paragraph.
    """
    out, heads, i = [], [], 0
    lines = md.split("\n")
    while i < len(lines):
        line = lines[i]

        m = FENCE.match(line)
        if m:
            lang = m.group(1) or "text"
            i += 1
            buf = []
            while i < len(lines) and not FENCE.match(lines[i]):
                buf.append(lines[i]); i += 1
            i += 1
            body = "\n".join(buf)
            # A figure is data, not code. It is a fence because that is where
            # an author already expects to write something the renderer will
            # not touch.
            if lang == "figure":
                try:
                    out.append(figures.render(body, where))
                except figures.FigureError as e:
                    raise BuildError(str(e)) from e
                continue
            code = html.escape(body)
            out.append(f'<pre class="cb" data-lang="{lang}"><code>{code}</code></pre>')
            continue

        if not line.strip():
            i += 1
            continue

        if line.startswith("#"):
            lvl = len(line) - len(line.lstrip("#"))
            txt = line[lvl:].strip()
            sid = slugify(txt)
            if lvl in (2, 3):
                heads.append({"id": sid, "text": txt, "level": lvl})
            out.append(f'<h{lvl} id="{sid}">{inline(txt)}</h{lvl}>')
            i += 1
            continue

        if line.strip() in ("---", "***"):
            out.append("<hr>"); i += 1; continue

        if line.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip("> ").rstrip()); i += 1
            out.append(f"<blockquote><p>{inline(' '.join(buf))}</p></blockquote>")
            continue

        if line.lstrip().startswith("|") and i + 1 < len(lines) and \
                set(lines[i + 1].replace("|", "").replace(" ", "")) <= set("-:"):
            def cells(r):
                return [c.strip() for c in r.strip().strip("|").split("|")]
            head = cells(line); i += 2
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append(cells(lines[i])); i += 1
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            tb = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>"
                         for r in rows)
            out.append(f'<div class="tw"><table><thead><tr>{th}</tr></thead>'
                       f"<tbody>{tb}</tbody></table></div>")
            continue

        m = re.match(r"^(\s*)([-*]|\d+\.)\s+", line)
        if m:
            ordered = m.group(2)[0].isdigit()
            tag = "ol" if ordered else "ul"
            items = []
            while i < len(lines):
                mm = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", lines[i])
                if not mm:
                    break
                items.append(mm.group(3)); i += 1
            li = "".join(f"<li>{inline(x)}</li>" for x in items)
            out.append(f"<{tag}>{li}</{tag}>")
            continue

        buf = []
        while i < len(lines) and lines[i].strip() and not lines[i].startswith(("#", ">", "|")) \
                and not FENCE.match(lines[i]) \
                and not re.match(r"^(\s*)([-*]|\d+\.)\s+", lines[i]):
            buf.append(lines[i].strip()); i += 1
        out.append(f"<p>{inline(' '.join(buf))}</p>")

    return "\n".join(out), heads


def word_count(html_text):
    """Words in the rendered note, tags stripped. Code and tables count.

    A figure's own labels do not. Axis labels and gate names are not prose, and
    counting them would let a unit reach its word target by drawing.
    """
    txt = re.sub(r"<svg\b.*?</svg>", " ", html_text, flags=re.S)
    txt = re.sub(r"<[^>]+>", " ", txt)
    return len(txt.split())


# ------------------------------------------------------------------ exercises

def _parse_expect(arg):
    """`verdict <key>` | `match /regex/` | `silent`.

    The judge is always written out. Inferring it from the key's shape is how
    the Python handbook broke on a lint code that looked like an exception
    name, and the same trap exists here: `warning` is a godbolt verdict and
    also a plausible regex.
    """
    arg = (arg or "").strip()
    if arg == "silent":
        return {"judge": "silent", "key": ""}
    judge, _, key = arg.partition(" ")
    return {"judge": judge.strip(), "key": key.strip()}


def parse_exercises(text, where, default_backend):
    """One file, N exercises, separated by a level-2 heading.

    Grammar:
        ## Title
        prose brief...
        @kind      compile-error | output | codegen | property
        @concept   one line, what this exercise is about
        @backend   sim | godbolt | yosys | modal        (defaults to the unit's)
        @gpu       sm_75 ...        minimum compute capability, modal only
        @flags     extra compiler arguments
        @expect    /regex/          the starter must fail this way
        @hint      one line
        @diagnose  <id> /regex/     ordered, first match wins
        ...prose for that diagnose, until the next directive or heading
        @after     prose shown once the exercise passes
        ```starter ... ```   ```tests ... ```   ```solution ... ```
    """
    problems = []
    chunks = re.split(r"^##\s+", text, flags=re.M)[1:]
    exercises = []

    for n, chunk in enumerate(chunks, 1):
        title, _, rest = chunk.partition("\n")
        title = title.strip()
        w = f"{where} ex{n} ({title})"
        ex = {
            "n": n, "title": title, "brief": "", "kind": "compile-error",
            "concept": "", "backend": default_backend, "gpu": None,
            "flags": "", "expect": [], "hints": [], "diagnose": [],
            "after": "", "starter": "", "tests": "", "solution": "",
            "spec": None, "lang": "",
        }

        sink = ["brief"]          # where free prose currently goes
        brief, after, dbuf = [], [], None
        i, lines = 0, rest.split("\n")

        while i < len(lines):
            line = lines[i]
            m = FENCE.match(line)
            if m:
                name = m.group(1)
                i += 1
                buf = []
                while i < len(lines) and not FENCE.match(lines[i]):
                    buf.append(lines[i]); i += 1
                i += 1
                body = "\n".join(buf)
                if name in ("starter", "tests", "solution"):
                    ex[name] = body
                elif name == "spec":
                    try:
                        ex["spec"] = json.loads(body)
                    except json.JSONDecodeError as e:
                        problems.append(f"{w}: spec block is not valid JSON: {e}")
                elif sink[0] == "diagnose" and dbuf is not None:
                    dbuf["prose"].append(f"```\n{body}\n```")
                elif sink[0] == "after":
                    after.append(f"```\n{body}\n```")
                else:
                    brief.append(f"```\n{body}\n```")
                continue

            dm = re.match(r"^@(\w+)\s*(.*)$", line)
            if dm:
                name, arg = dm.group(1), dm.group(2).strip()
                if name not in DIRECTIVES:
                    problems.append(f"{w}: unknown directive @{name}")
                    i += 1
                    continue
                if name in ("kind", "backend", "gpu", "flags", "lang"):
                    ex[name] = arg
                    sink[0] = "machine"
                elif name == "concept":
                    # Prose, so it may wrap. Before this it could not, and a
                    # wrapped @concept silently dropped its second line into
                    # the exercise description.
                    ex[name] = arg
                    sink[0] = "concept"
                elif name == "expect":
                    ex["expect"].append(_parse_expect(arg))
                    sink[0] = "machine"
                elif name == "hint":
                    ex["hints"].append(arg)
                    sink[0] = "hint"
                elif name == "diagnose":
                    did, _, pat = arg.partition(" ")
                    dbuf = {"id": did, **_parse_expect(pat.strip()), "prose": []}
                    ex["diagnose"].append(dbuf)
                    sink[0] = "diagnose"
                elif name == "after":
                    if arg:
                        after.append(arg)
                    sink[0] = "after"
                i += 1
                continue

            if sink[0] == "diagnose" and dbuf is not None:
                dbuf["prose"].append(line)
            elif sink[0] == "after":
                after.append(line)
            elif sink[0] == "concept" and line.strip():
                ex["concept"] += " " + line.strip()
            elif sink[0] == "hint" and line.strip():
                ex["hints"][-1] += " " + line.strip()
            elif sink[0] in ("concept", "hint") and not line.strip():
                sink[0] = "loose"       # a blank line ends the continuation
            elif sink[0] == "brief":
                brief.append(line)
            elif line.strip():
                # Prose that belongs to nothing. Before this it was appended to
                # the description, where a wrapped directive looked like an
                # extra sentence the author had written on purpose.
                problems.append(
                    f"{w}: {line.strip()[:48]!r} follows a directive but is "
                    f"attached to nothing. Put it on the directive's line, or "
                    f"move it above the directives.")
            i += 1

        ex["concept"] = inline(ex["concept"])
        ex["hints"] = [inline(h) for h in ex["hints"]]
        ex["brief"], _ = render("\n".join(brief).strip())
        ex["after"], _ = render("\n".join(after).strip())
        for d in ex["diagnose"]:
            d["prose"], _ = render("\n".join(d["prose"]).strip())

        problems += _check_exercise_shape(ex, w)
        exercises.append(ex)

    if len(exercises) != N_EXERCISES:
        problems.append(f"{where}: {len(exercises)} exercises, expected {N_EXERCISES}")
    fail(problems)
    return exercises


def _check_exercise_shape(ex, w):
    p = []
    if ex["backend"] not in track.BACKENDS:
        p.append(f"{w}: unknown backend {ex['backend']!r}")
    if ex["gpu"] and ex["backend"] != "modal":
        p.append(f"{w}: @gpu means something only on the modal backend")
    if ex["gpu"] and ex["gpu"] not in SM_ORDER:
        p.append(f"{w}: {ex['gpu']!r} is not a compute capability this "
                 f"handbook knows. One of: {', '.join(SM_ORDER)}")
    if ex["backend"] == "modal" and not ex["gpu"]:
        p.append(f"{w}: a modal exercise must declare @gpu, so the picker can "
                 f"grey out cards that cannot run it")
    langs = BACKEND_LANGS.get(ex["backend"], set())
    if not ex["lang"]:
        # one language per backend means no ambiguity; more means say which
        ex["lang"] = next(iter(langs)) if len(langs) == 1 else ""
        if not ex["lang"]:
            p.append(f"{w}: @lang is required on the {ex['backend']} backend "
                     f"(one of {', '.join(sorted(langs))})")
    elif ex["lang"] not in langs:
        p.append(f"{w}: {ex['lang']!r} is not a language the {ex['backend']} "
                 f"backend checks. Known: {', '.join(sorted(langs))}")

    if ex["backend"] == "sim":
        p += _check_sim_spec(ex.get("spec"), w)
    elif ex["backend"] == "yosys":
        p += _check_yosys_spec(ex.get("spec"), w)
    elif ex.get("spec") is not None:
        p.append(f"{w}: a spec block means something only on the sim and "
                 f"yosys backends")
    if not ex["starter"].strip():
        p.append(f"{w}: no starter block")
    if not ex["solution"].strip():
        p.append(f"{w}: no solution block")
    if not ex["hints"]:
        p.append(f"{w}: no hints")
    if not ex["concept"]:
        p.append(f"{w}: no @concept")
    if not ex["expect"]:
        p.append(f"{w}: no @expect; say how the starter is meant to fail")
    for e in ex["expect"]:
        p += _check_judged(e, ex["backend"], f"{w} @expect")
    seen = set()
    for d in ex["diagnose"]:
        if not d["id"]:
            p.append(f"{w}: @diagnose with no id")
        if d["id"] in seen:
            p.append(f"{w}: duplicate @diagnose id {d['id']!r}")
        seen.add(d["id"])
        p += _check_judged(d, ex["backend"], f"{w} @diagnose {d['id']!r}")
        if not d["prose"].strip():
            p.append(f"{w}: @diagnose {d['id']!r} has no explanation")

    # Every expectation must have prose to show for it, or the reader hits a
    # failure the handbook has nothing to say about.
    covered = {(d["judge"], d["key"]) for d in ex["diagnose"]}
    for e in ex["expect"]:
        if (e["judge"], e["key"]) not in covered:
            p.append(f"{w}: @expect {e['judge']} {e['key']!r} has no matching "
                     f"@diagnose, so the reader gets the error with no explanation")
    p += prose.lint(re.sub(r"<[^>]+>", " ", prose.strip_code(ex["brief"])),
                    f"{w} brief")
    for h in ex["hints"]:
        p += prose.lint(h, f"{w} hint")
    return p


# --------------------------------------------------------------------- drills

def _check_sim_spec(spec, w):
    """The simulator's contract, checked at build time rather than in the
    browser. A malformed spec would otherwise surface as a confusing runtime
    error in front of the learner."""
    p = []
    if spec is None:
        p.append(f"{w}: the sim backend needs a ```spec block")
        return p
    for k in ("chip", "inputs", "outputs"):
        if k not in spec:
            p.append(f"{w}: spec has no {k!r}")
    if "table" not in spec and "trace" not in spec:
        p.append(f"{w}: spec needs a 'table' for combinational logic or a "
                 f"'trace' for anything with a dff in it")
    if "table" in spec and "trace" in spec:
        p.append(f"{w}: spec has both a table and a trace. A table cannot "
                 f"express state and a trace already covers what one does.")
    if p:
        return p
    if not isinstance(spec["inputs"], list) or not spec["inputs"]:
        p.append(f"{w}: spec inputs must be a non-empty list")
    if not isinstance(spec["outputs"], list) or not spec["outputs"]:
        p.append(f"{w}: spec outputs must be a non-empty list")
    if p:
        return p

    n_in, n_out = len(spec["inputs"]), len(spec["outputs"])

    if "trace" in spec:
        # A trace is a table over time, so it is not exhaustive and must not be
        # checked for exhaustiveness. What it must be is long enough to show
        # the state doing something, and rectangular.
        tr = spec["trace"]
        if not isinstance(tr, list) or len(tr) < 3:
            p.append(f"{w}: a trace needs at least three cycles, or it cannot "
                     f"show a value being held")
            return p
        for i, row in enumerate(tr):
            if not isinstance(row, list) or len(row) != n_in + n_out:
                p.append(f"{w}: trace cycle {i} has "
                         f"{len(row) if isinstance(row, list) else '?'} values; "
                         f"{n_in} inputs and {n_out} outputs means "
                         f"{n_in + n_out}")
            elif any(v not in (0, 1) for v in row):
                p.append(f"{w}: trace cycle {i} has a value that is not 0 or 1")
        return p

    want_rows = 2 ** n_in
    if not isinstance(spec["table"], list):
        p.append(f"{w}: spec table must be a list of rows")
        return p
    if len(spec["table"]) != want_rows:
        p.append(f"{w}: spec table has {len(spec['table'])} rows; "
                 f"{n_in} inputs means {want_rows} rows, and the table must "
                 f"be exhaustive")
    seen = set()
    for i, row in enumerate(spec["table"]):
        if not isinstance(row, list) or len(row) != n_in + n_out:
            p.append(f"{w}: spec table row {i} has {len(row) if isinstance(row, list) else '?'} "
                     f"values; want {n_in} inputs plus {n_out} outputs")
            continue
        if any(v not in (0, 1) for v in row):
            p.append(f"{w}: spec table row {i} has a value that is not 0 or 1")
        key = tuple(row[:n_in])
        if key in seen:
            p.append(f"{w}: spec table repeats the input row {list(key)}")
        seen.add(key)
    for k in ("minGates", "maxGates"):
        if k in spec and not isinstance(spec[k], int):
            p.append(f"{w}: spec {k} must be a whole number")
    if "minGates" in spec and "maxGates" in spec and spec["maxGates"] < spec["minGates"]:
        p.append(f"{w}: spec maxGates is below minGates, so nothing can pass")
    return p


def _check_yosys_spec(spec, w):
    """What the synthesiser needs, checked here rather than in the browser."""
    p = []
    if spec is None:
        p.append(f"{w}: the yosys backend needs a ```spec block")
        return p
    if not spec.get("top"):
        p.append(f"{w}: spec has no 'top' module name")
    has_check = any(k in spec for k in ("cells", "forbid", "gold", "maxCells"))
    if not has_check:
        p.append(f"{w}: spec asserts nothing. Give it cells, forbid, gold or "
                 f"maxCells, or the exercise passes whatever is written.")
    for k in ("cells",):
        if k in spec and not isinstance(spec[k], dict):
            p.append(f"{w}: spec {k} must be a map of cell name to count")
    if "forbid" in spec and not isinstance(spec["forbid"], list):
        p.append(f"{w}: spec forbid must be a list of cell names")
    for name in list(spec.get("cells", {})) + list(spec.get("forbid", [])):
        if not str(name).startswith("$"):
            p.append(f"{w}: {name!r} is not a yosys cell name; they start "
                     f"with a dollar sign, like $_DFF_P_")
    if "maxCells" in spec and not isinstance(spec["maxCells"], int):
        p.append(f"{w}: spec maxCells must be a whole number")
    return p


def _check_judged(e, backend, w):
    """One @expect or @diagnose, checked against its backend's vocabulary."""
    p = []
    judge, key = e.get("judge", ""), e.get("key", "")
    if judge not in JUDGES:
        p.append(f"{w}: judge must be one of {', '.join(JUDGES)}, got {judge!r}")
        return p
    if judge == "silent":
        if key:
            p.append(f"{w}: silent takes no key, got {key!r}")
        return p
    if judge == "verdict":
        known = VERDICTS.get(backend, set())
        if key not in known:
            p.append(f"{w}: {key!r} is not a {backend} verdict. "
                     f"Known: {', '.join(sorted(known))}")
        return p
    # judge == "match"
    if not (key.startswith("/") and key.endswith("/") and len(key) > 2):
        p.append(f"{w}: match takes a /regex/, got {key!r}")
    else:
        try:
            re.compile(key[1:-1])
        except re.error as err:
            p.append(f"{w}: regex does not compile: {err}")
    return p


def parse_drills(text, where):
    """One file, N drills.

        ## The question, which may wrap across lines
        - [ ] a wrong option
        - [x] the right one
        - [ ] another wrong option
        @why why the right one is right, and what the wrong ones confuse

    A wrapped question is joined rather than dropped. The first version of this
    parser took only the heading's first line, and two questions in the first
    unit lost half their text without the build saying anything.
    """
    problems, drills = [], []
    for n, chunk in enumerate(re.split(r"^##\s+", text, flags=re.M)[1:], 1):
        w = f"{where} drill{n}"
        lines = chunk.split("\n")
        qparts, i = [], 0
        while i < len(lines):
            line = lines[i]
            if re.match(r"^\s*[-*]\s*\[[ xX]\]", line) or line.startswith("@"):
                break
            if line.strip():
                qparts.append(line.strip())
            i += 1
        q = " ".join(qparts)
        rest = "\n".join(lines[i:])
        opts, correct, why = [], None, []
        sink = None
        for line in rest.split("\n"):
            m = re.match(r"^\s*([-*])\s*(\[[ xX]\])\s*(.*)$", line)
            if m:
                opts.append(m.group(3).strip())
                if m.group(2).lower() == "[x]":
                    if correct is not None:
                        problems.append(f"{w}: more than one correct option")
                    correct = len(opts) - 1
                sink = None
                continue
            if line.startswith("@why"):
                why.append(line[4:].strip()); sink = "why"; continue
            if sink == "why":
                why.append(line)
        if len(opts) < 3:
            problems.append(f"{w}: {len(opts)} options, want at least 3")
        if correct is None:
            problems.append(f"{w}: no option marked [x]")
        if not "".join(why).strip():
            problems.append(f"{w}: no @why explanation")
        if not q.strip():
            problems.append(f"{w}: no question")
        elif not q.rstrip().endswith(("?", ".", ":")):
            problems.append(f"{w}: question does not end in punctuation, so it "
                            f"is probably cut off: {q!r}")
        if len(set(opts)) != len(opts):
            problems.append(f"{w}: two options are identical")
        for o in opts:
            if not o.strip():
                problems.append(f"{w}: an option is empty")
        problems += prose.lint(q, f"{w} question")
        for o in opts:
            problems += prose.lint(o, f"{w} option")
        drills.append({
            # `why` has always rendered markdown. The question and its options
            # did not, so every `identifier` in them showed its backticks.
            "n": n, "q": inline(q.strip()),
            "options": [inline(o) for o in opts], "correct": correct,
            "why": render("\n".join(why).strip())[0],
        })
    if len(drills) != N_DRILLS:
        problems.append(f"{where}: {len(drills)} drills, expected {N_DRILLS}")
    fail(problems)
    return drills


# ---------------------------------------------------------------------- build

# Everything whose contents can change what lands in data/. If a file here
# changes and the build is not rerun, the site serves stale JSON, and nothing
# about the page would look wrong.
INPUT_GLOBS = ("content/**/*.md", "content/**/*.json",
               "build.py", "track.py", "prose.py", "contrast.py",
               "assets/app.js")


def input_files():
    root = Path(__file__).parent
    out = []
    for pattern in INPUT_GLOBS:
        out.extend(sorted(root.glob(pattern)))
    return [p for p in out if p.is_file()]


def input_digest():
    """One hash over every input, path included so a rename counts."""
    import hashlib
    h = hashlib.sha256()
    root = Path(__file__).parent
    for f in input_files():
        h.update(str(f.relative_to(root)).encode())
        h.update(b"\0")
        h.update(f.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def stale():
    """Why data/ does not match content/, or [] if it does."""
    stamp = DATA / "build.json"
    if not stamp.exists():
        return ["data/build.json is missing, so nothing records what data/ was "
                "built from. Run build.py."]
    try:
        recorded = json.loads(stamp.read_text()).get("inputs")
    except json.JSONDecodeError:
        return ["data/build.json is not valid JSON"]
    now = input_digest()
    if recorded != now:
        return [f"data/ was built from different inputs than are on disk "
                f"({str(recorded)[:12]} vs {now[:12]}). Run build.py, and "
                f"commit data/ with the change that caused it."]
    return []


def build(strict=True):
    track.validate()
    # The palette is content too. A grey nudged to taste can put body text
    # under the legal floor, and nothing else in the pipeline would notice.
    problems, units, manifest = contrast.check("light") + contrast.check("dark"), {}, []

    for num, (slug, part, title, blurb, backend) in enumerate(track.TRACK):
        pid = track.PART_BY_ID[part]
        entry = {
            "slug": slug, "num": num, "title": title, "blurb": blurb,
            "part": part, "partRoman": pid[1], "partTitle": pid[2],
            "phase": track.PHASE_OF[part],
            "accent": track.accent_of(part), "backend": backend, "ready": False,
            "words": 0, "exercises": 0, "drills": 0,
        }
        note_p = CONTENT / "units" / f"{slug}.md"
        if note_p.exists():
            try:
                meta, body = split_front_matter(note_p.read_text(), f"units/{slug}")
                problems += check_gloss_links_render(
                    note_p.read_text().split("---")[1] if "---" in note_p.read_text() else "",
                    body, f"units/{slug}")
                problems += check_figures_are_introduced(body, f"units/{slug}")
                body_html, heads = render(body, f"units/{slug}")
                words = word_count(body_html)
                if strict and not (NOTE_WORDS[0] <= words <= NOTE_WORDS[1]):
                    problems.append(
                        f"units/{slug}: {words} words, want "
                        f"{NOTE_WORDS[0]}..{NOTE_WORDS[1]}")
                problems += prose.lint(
                    re.sub(r"<[^>]+>", " ", prose.strip_code(body_html)),
                    f"units/{slug}")
                ex_p = CONTENT / "ex" / f"{slug}.md"
                dr_p = CONTENT / "drills" / f"{slug}.md"
                exercises = parse_exercises(ex_p.read_text(), f"ex/{slug}", backend) \
                    if ex_p.exists() else []
                drills = parse_drills(dr_p.read_text(), f"drills/{slug}") \
                    if dr_p.exists() else []
                if strict and not exercises:
                    problems.append(f"ex/{slug}.md is missing")
                if strict and not drills:
                    problems.append(f"drills/{slug}.md is missing")
                entry.update(ready=True, words=words,
                             exercises=len(exercises), drills=len(drills))
                units[slug] = {
                    **entry, "meta": meta, "html": body_html, "headings": heads,
                    "exercises": exercises, "drills": drills,
                }
            except BuildError as e:
                problems.append(str(e))
        manifest.append(entry)

    # The dependency edges. Every handbook in this family writes `needs:` into
    # the front matter, computes an ordering from it at build time and throws
    # the graph away. At 122 units "each unit depends on the ones before it"
    # stops being true, so the graph is the only honest answer to "what do I
    # have to have read first", and its reverse is the only answer to "where
    # does this go next" -- which nothing else in the site can tell you.
    by_slug = {e["slug"]: e for e in manifest}
    order = {e["slug"]: e["num"] for e in manifest}
    for slug, u in units.items():
        needs = list(u["meta"].get("needs") or [])
        clean = []
        for n in needs:
            if n not in by_slug:
                problems.append(
                    f"units/{slug}: needs {n!r}, which is not a unit in the "
                    f"track")
            elif order[n] >= order[slug]:
                problems.append(
                    f"units/{slug}: needs {n!r}, which comes later in the "
                    f"track ({order[n]} vs {order[slug]})")
            else:
                clean.append(n)
        clean.sort(key=lambda sl: order[sl])   # read them in track order
        by_slug[slug]["needs"] = clean
        u["needs"] = clean

    for e in manifest:
        e.setdefault("needs", [])
        e["neededBy"] = sorted(
            (o["slug"] for o in manifest if e["slug"] in o.get("needs", [])),
            key=lambda sl: order[sl])
    for slug, u in units.items():
        u["neededBy"] = by_slug[slug]["neededBy"]

    fail(problems)   # nothing is written until every check has passed

    DATA.mkdir(exist_ok=True)
    for sub in ("unit", "ex", "drills"):
        (DATA / sub).mkdir(exist_ok=True)

    # Minutes live in each note's front matter and never reached the
    # manifest, because the track shows a part's total rather than a unit's.
    # A path is a plan, and a plan without an hour count is a wish.
    for slug, u in units.items():
        by_slug[slug]["minutes"] = u["meta"].get("minutes")
    paths = build_paths(by_slug)
    atlas = build_atlas()
    glossary = build_glossary(units)
    errors = build_errors()

    # Inline every glossary definition into the link that points at it. The
    # reader gets the definition where they met the word, with no fetch and no
    # navigation away from the sentence they were in the middle of. The gate
    # that rejects a link to an undefined term already ran, so every link here
    # has something to carry.
    gloss_by_slug = {g["slug"]: g for g in glossary}
    for u in units.values():
        u["html"] = attach_glossary(u["html"], gloss_by_slug)

    parts = [{"id": p[0], "roman": p[1], "title": p[2], "blurb": p[3],
              "phase": track.PHASE_OF[p[0]], "accent": track.accent_of(p[0]),
              "reports": p[4]} for p in track.PARTS]
    phases = [{"id": ph[0], "title": ph[1], "blurb": ph[2], "accent": ph[3],
               "parts": list(ph[4])} for ph in track.PHASES]
    write(DATA / "manifest.json", {
        "phases": phases, "parts": parts, "units": manifest,
        "backends": list(track.BACKENDS),
        "counts": {
            "atlas": len(atlas), "glossary": len(glossary),
            "paths": len(paths),
            "errors": len(errors),
            "phases": len(phases),
            "parts": len(parts), "units": len(manifest),
            "ready": sum(1 for u in manifest if u["ready"]),
            "words": sum(u["words"] for u in manifest),
            "exercises": sum(u["exercises"] for u in manifest),
            "drills": sum(u["drills"] for u in manifest),
        },
    })

    write(DATA / "build.json", {
        "inputs": input_digest(),
        "files": len(input_files()),
        "counts": {"units": len(manifest), "errors": len(errors)},
    })

    for slug, u in units.items():
        write(DATA / "unit" / f"{slug}.json",
              {k: u[k] for k in ("slug", "num", "title", "blurb", "part",
                                 "partRoman", "partTitle", "phase", "accent",
                                 "backend", "meta", "html", "headings",
                                 "words", "needs", "neededBy")})
        # The solution never leaves the build. The reference implementation
        # ships it and declines to render it, which is not the same thing.
        # `tests` must ship: a static site has to run the check in the browser,
        # so write tests worth not cheating on rather than pretending they are
        # hidden.
        public = [{k: v for k, v in e.items() if k != "solution"}
                  for e in u["exercises"]]
        write(DATA / "ex" / f"{slug}.json",
              {"slug": slug, "backend": u["backend"], "exercises": public})
        write(DATA / "drills" / f"{slug}.json",
              {"slug": slug, "drills": u["drills"]})

    write(DATA / "judges.json", JUDGES_CONFIG)
    write(DATA / "modal-gpus.json", load_gpu_catalog())
    write(DATA / "atlas.json", {"tables": atlas})
    write(DATA / "paths.json", {"paths": paths})
    write(DATA / "glossary.json", {"terms": glossary})
    write(DATA / "errors.json", {"entries": errors,
                                 "backends": list(VERDICTS)})
    search_index = build_search(manifest, units)
    fail(check_search_examples(search_index))
    write(DATA / "search.json", search_index)
    prune(DATA, units)
    return manifest, units


GL_LINK = re.compile(r'<a class="gl" href="#/glossary#([a-z0-9-]+)">')


GLOSS_LINK_RE = re.compile(r"\[\[[a-z0-9-]+(\|[^\]]+)?\]\]")


def check_gloss_links_render(meta_text, md, where):
    """A glossary link only works in body prose.

    In front matter it is a YAML string that nothing renders, and in a heading
    it corrupts the anchor the contents rail links to. Both look right in the
    source and do nothing on the page, which is the worst combination.
    """
    problems = []
    if GLOSS_LINK_RE.search(meta_text):
        problems.append(
            f"{where}: a glossary link in the front matter. Nothing renders "
            f"front matter as prose, so the link does nothing.")
    for line in md.split("\n"):
        if line.startswith("#") and GLOSS_LINK_RE.search(line):
            problems.append(
                f"{where}: a glossary link in the heading {line.strip()[:44]!r}. "
                f"It corrupts the anchor the contents rail points at.")
    return problems


def check_figures_are_introduced(md, where):
    """A figure must have a sentence in front of it.

    A diagram dropped straight under a heading reads as decoration, and the
    reader does not know what they are being asked to look at. Every one of the
    first five figures written here was unannounced until something checked.
    """
    problems, lines = [], md.split("\n")
    for i, line in enumerate(lines):
        if not line.startswith("```figure"):
            continue
        j = i - 1
        while j >= 0 and not lines[j].strip():
            j -= 1
        prev = lines[j].strip() if j >= 0 else ""
        if not prev or prev.startswith("#") or prev.startswith("```"):
            problems.append(
                f"{where}: a figure follows "
                + ("a heading" if prev.startswith("#")
                   else "a code block" if prev.startswith("```")
                   else "nothing")
                + ". Say what the reader is about to look at, or it reads as "
                  "decoration.")
    return problems


def attach_glossary(html_text, by_slug):
    """Put each definition on the link that points at it.

    A second pass rather than doing it in inline(), because a note is rendered
    before the glossary is built: the glossary is assembled from what the notes
    linked to, so at render time the definition does not exist yet.
    """
    def sub(m):
        g = by_slug.get(m.group(1))
        if not g:
            return m.group(0)
        return (f'<a class="gl" href="#/glossary#{m.group(1)}" '
                f'data-g="{html.escape(g["html"], quote=True)}">')
    return GL_LINK.sub(sub, html_text)


def build_errors():
    """Every verdict every backend can report, with prose.

    The gate is the point: VERDICTS is what the browser is allowed to judge
    against, so a verdict that exists in code and not here would reach a reader
    as a bare slug with no explanation, and one here that no backend can emit
    is a page nobody will ever land on.
    """
    path = CONTENT / "errors.md"
    if not path.exists():
        raise BuildError("content/errors.md is missing, so every verdict the "
                         "workbench reports would be an unexplained slug")
    problems, entries, seen = [], [], set()

    for chunk in re.split(r"^##\s+", path.read_text(), flags=re.M)[1:]:
        head, _, rest = chunk.partition("\n")
        head = head.strip()
        m = re.fullmatch(r"([a-z]+)\s*/\s*([a-z0-9-]+)", head)
        if not m:
            problems.append(f"errors.md: heading {head!r} is not "
                            f"'<backend> / <verdict>'")
            continue
        backend, verdict = m.group(1), m.group(2)
        w = f"errors.md {backend}/{verdict}"
        if backend not in VERDICTS:
            problems.append(f"{w}: unknown backend")
            continue
        if verdict not in VERDICTS[backend]:
            problems.append(
                f"{w}: {backend} cannot report {verdict!r}. It reports "
                + ", ".join(sorted(VERDICTS[backend])))
            continue
        if (backend, verdict) in seen:
            problems.append(f"{w}: documented twice")
        seen.add((backend, verdict))

        short, body = "", []
        for line in rest.split("\n"):
            dm = re.match(r"^@(\w+)\s*(.*)$", line)
            if dm:
                if dm.group(1) != "short":
                    problems.append(f"{w}: unknown directive @{dm.group(1)}")
                elif short:
                    problems.append(f"{w}: two @short lines")
                else:
                    short = dm.group(2).strip()
                continue
            body.append(line)
        if not short:
            problems.append(f"{w}: no @short, so the table has no summary")
        html_body, _ = render("\n".join(body).strip())
        if not html_body:
            problems.append(f"{w}: no prose. A slug and a one-liner is what "
                            f"the reader already had")
        problems += prose.lint(
            re.sub(r"<[^>]+>", " ", prose.strip_code(html_body)), w)
        problems += prose.check_summary(short, f"{w} @short")
        entries.append({"backend": backend, "verdict": verdict,
                        "id": f"{backend}-{verdict}",
                        "short": inline(short), "html": html_body})

    for backend, verdicts in VERDICTS.items():
        for v in sorted(verdicts):
            if (backend, v) not in seen:
                problems.append(
                    f"errors.md: {backend} can report {v!r} and it is not "
                    f"documented, so a reader would get the bare slug")
    problems += unreachable_verdicts()
    problems += lint_docs()
    fail(problems)
    order = list(VERDICTS)
    entries.sort(key=lambda e: (order.index(e["backend"]), e["verdict"]))
    return entries


# The client files that decide a verdict. A verdict no client names is one no
# reader can ever see.
CLIENT_FILES = ("assets/workbench.js", "assets/sim.js", "assets/yosys-check.js")


# Markdown outside content/ that is still prose someone reads. The design doc
# carried 48 em dashes because nothing looked at it.
DOC_GLOBS = ("docs/*.md", "docs/superpowers/specs/*.md", "README.md")


def lint_docs():
    root = Path(__file__).parent
    out = []
    for pattern in DOC_GLOBS:
        for f in sorted(root.glob(pattern)):
            text = f.read_text()
            text = re.sub(r"```.*?```", " ", text, flags=re.S)   # fenced code
            text = re.sub(r"^    .*$", " ", text, flags=re.M)    # indented code
            text = re.sub(r"`[^`]*`", " ", text)                 # inline code
            out += prose.lint(text, str(f.relative_to(root)))
    return out


def unreachable_verdicts():
    """Verdicts that are declared and documented and cannot happen.

    Documenting a verdict nothing emits is the quieter half of the same
    problem as emitting one nothing documents, and only the second half was
    checked. `link-error` was declared, had an entry on the errors page, and no
    code path returned it, for exactly as long as nothing looked.
    """
    root = Path(__file__).parent
    text = "\n".join((root / f).read_text() for f in CLIENT_FILES
                      if (root / f).exists())
    out = []
    for backend, verdicts in VERDICTS.items():
        for v in sorted(verdicts):
            if v == "ok":
                continue      # every backend has one and they are all trivial
            if f"'{v}'" not in text and f'"{v}"' not in text:
                out.append(
                    f"{backend} declares the verdict {v!r} and no client names "
                    f"it, so nothing can ever report it. Implement it or "
                    f"remove it from VERDICTS")
    return out


def build_glossary(units):
    """Terms, and the check that keeps them honest.

    Two rules, and the first is the one that matters:

    * Every [[term]] written in a note must resolve to a defined term. A
      glossary link that goes nowhere is worse than no link, because the reader
      trusts it. This is the same shape as the Python handbook's feature-table
      self-check: the gate is only a gate if it proves it gates.
    * Every @see must name a term that exists, so the graph has no dead edges.

    An unreferenced term is fine. A reference book may define more than the
    current text happens to use.
    """
    d = CONTENT / "gloss"
    problems, terms = [], {}
    for f in sorted(d.glob("*.md")) if d.exists() else []:
        w = f"gloss/{f.name}"
        for chunk in re.split(r"^##\s+", f.read_text(), flags=re.M)[1:]:
            slug, _, rest = chunk.partition("\n")
            slug = slug.strip()
            if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug):
                problems.append(f"{w}: {slug!r} is not a clean kebab-case term")
                continue
            if slug in terms:
                problems.append(f"{w}: {slug!r} is defined twice")
            body, sees = [], []
            for line in rest.split("\n"):
                if line.startswith("@see"):
                    sees += [x.strip() for x in line[4:].split(",") if x.strip()]
                else:
                    body.append(line)
            text = "\n".join(body).strip()
            if not text:
                problems.append(f"{w}: {slug!r} has no definition")
            problems += prose.lint(text, f"{w} {slug}")
            html, _ = render(text)
            terms[slug] = {"slug": slug, "html": html, "see": sees,
                           "text": re.sub(r"\s+", " ", text)[:400], "file": f.stem}

    for slug, t in terms.items():
        for other in t["see"]:
            if other not in terms:
                problems.append(f"gloss: {slug!r} points at {other!r}, "
                                f"which is not defined")

    # the rule that earns the glossary its place
    used = {}
    for slug, u in units.items():
        for m in re.finditer(r'href="#/glossary#([a-z0-9-]+)"', u["html"]):
            used.setdefault(m.group(1), set()).add(slug)
    for term, where in used.items():
        if term not in terms:
            problems.append(
                f"units/{sorted(where)[0]}: links to the glossary term "
                f"[[{term}]], which is not defined. A link that goes nowhere is "
                f"worse than no link.")

    fail(problems)
    for slug, t in terms.items():
        t["usedBy"] = sorted(used.get(slug, []))
    return sorted(terms.values(), key=lambda t: t["slug"])


def build_paths(by_slug):
    """Named routes through the track, for a reader with one goal.

    A hundred and twenty two units in one line answers "what comes next" and
    never answers "what do I need for this". A path answers the second, and it
    is worth having a gate because a route that skips a prerequisite is worse
    than no route: it sends someone into a unit that assumes something they
    were never shown, and the unit will not say so.

    So the rule is the one the track already enforces on itself. Every unit's
    `needs` must appear earlier in the same path, or be listed in `assumes`,
    which is the path saying out loud what it expects you to bring.
    """
    d = CONTENT / "paths"
    if not d.exists():
        return []
    problems, out = [], []
    for f in sorted(d.glob("*.json")):
        w = f"paths/{f.name}"
        try:
            t = json.loads(f.read_text())
        except json.JSONDecodeError as e:
            problems.append(f"{w}: not valid JSON: {e}")
            continue
        for k in ("id", "title", "blurb", "who", "stages", "order"):
            if t.get(k) in (None, "", []):
                problems.append(f"{w}: missing {k!r}")
        if any(w in p for p in problems):
            continue
        if t["id"] != f.stem:
            problems.append(f"{w}: id {t['id']!r} does not match the filename")
        problems += prose.check_blurb(t["blurb"], f"{w} blurb")
        problems += prose.lint(t["who"], f"{w} who")

        seen, minutes, ready = [], 0, 0
        assumed = set(t.get("assumes") or [])
        for si, stage in enumerate(t["stages"]):
            for k in ("title", "why", "units"):
                if not stage.get(k):
                    problems.append(f"{w}: stage {si} is missing {k!r}")
            if not stage.get("units"):
                continue
            problems += prose.lint(stage.get("why", ""), f"{w} stage {si} why")
            for slug in stage["units"]:
                u = by_slug.get(slug)
                if not u:
                    problems.append(f"{w}: {slug!r} is not a unit in the track")
                    continue
                if slug in seen:
                    problems.append(f"{w}: {slug!r} appears twice")
                    continue
                for n in u.get("needs", []):
                    if n not in seen and n not in assumed:
                        problems.append(
                            f"{w}: {slug!r} comes before {n!r}, which it needs. "
                            f"Put {n!r} earlier in the path, or list it in "
                            f"'assumes' to say the reader is expected to know it.")
                seen.append(slug)
                minutes += u.get("minutes") or 0
                ready += 1 if u.get("ready") else 0
        for slug in assumed:
            if slug not in by_slug:
                problems.append(f"{w}: assumes {slug!r}, which is not a unit")
        out.append({**t, "unitCount": len(seen), "readyCount": ready,
                    "minutes": minutes})
    fail(problems)
    seen_order = {}
    for t in out:
        if t["order"] in seen_order:
            fail([f"paths: {t['id']} and {seen_order[t['order']]} both claim "
                  f"order {t['order']}"])
        seen_order[t["order"]] = t["id"]
    out.sort(key=lambda t: t["order"])
    return out


def build_atlas():
    """The reference tables, checked the way exercises are checked.

    An atlas is data pretending to be authoritative, so it needs its own gate.
    Three rules, all of which the research turned up as real failure modes:

    * Every table cites its sources and carries the date they were checked. A
      hardware table with no provenance is a rumour with columns.
    * Every row has exactly the declared columns. A ragged table renders as a
      confident lie with cells shifted one to the left, which is precisely how
      Wikipedia's CUDA specs table produces "128 K registers/SM at CC 8.0".
    * A table may declare what it could not verify, and those notes are shown
      to the reader rather than dropped.

    A row may also carry a `detail` object, which is everything a hover card
    shows and the table does not have room for. It is a declared key rather
    than a smuggled one, so the ragged-row check still means what it says.
    """
    d = CONTENT / "atlas"
    if not d.exists():
        return []
    problems, tables = [], []
    for f in sorted(d.glob("*.json")):
        w = f"atlas/{f.name}"
        try:
            t = json.loads(f.read_text())
        except json.JSONDecodeError as e:
            problems.append(f"{w}: not valid JSON: {e}")
            continue
        for k in ("id", "title", "blurb", "columns", "rows", "sources", "checked"):
            if not t.get(k):
                problems.append(f"{w}: missing {k!r}")
        if problems and any(w in p for p in problems):
            continue
        if t["id"] != f.stem:
            problems.append(f"{w}: id {t['id']!r} does not match the filename")
        keys = [c["key"] for c in t["columns"]]
        if len(set(keys)) != len(keys):
            problems.append(f"{w}: duplicate column keys")
        for i, row in enumerate(t["rows"]):
            extra = set(row) - set(keys) - {"detail"}
            missing = set(keys) - set(row)
            det = row.get("detail")
            if det is not None:
                if not isinstance(det, dict):
                    problems.append(f"{w}: row {i} detail is not an object")
                elif not det.get("summary"):
                    problems.append(
                        f"{w}: row {i} has a detail with no summary. A hover "
                        f"card that only repeats the row is worse than none.")
                else:
                    problems += prose.check_summary(
                        det["summary"], f"{w} row {i} detail summary", 5, 32)
            if extra:
                problems.append(f"{w}: row {i} has columns the table does not "
                                f"declare: {', '.join(sorted(extra))}")
            if missing:
                problems.append(f"{w}: row {i} is missing {', '.join(sorted(missing))}. "
                                f"Use an empty string rather than omitting a cell, "
                                f"or the table renders shifted.")
        if not isinstance(t["sources"], list) or not t["sources"]:
            problems.append(f"{w}: sources must be a non-empty list")
        else:
            # A source may be a bare title or a title with a link. Both are
            # normalised here so the renderer has one shape to draw, and a
            # link the reader can follow is always better than one they have
            # to search for.
            norm = []
            for i, src in enumerate(t["sources"]):
                if isinstance(src, str):
                    norm.append({"title": src})
                elif isinstance(src, dict) and src.get("title"):
                    if src.get("url", "").startswith(("http://", "https://")) \
                            or "url" not in src:
                        norm.append({k: src[k] for k in ("title", "url")
                                     if k in src})
                    else:
                        problems.append(f"{w}: source {i} has a url that is "
                                        f"not http or https")
                else:
                    problems.append(f"{w}: source {i} is neither a title nor "
                                    f"an object with a title")
            t["sources"] = norm
        problems += prose.check_blurb(t["blurb"], f"{w} blurb")
        if t.get("note"):
            problems += prose.lint(t["note"], f"{w} note")
        if not isinstance(t.get("order"), int):
            problems.append(f"{w}: needs an integer 'order'. Tab order is a "
                            f"pedagogical choice, and alphabetical is not one.")
        tables.append({**t, "rowCount": len(t["rows"])})
    fail(problems)
    seen_order = {}
    for t in tables:
        if t["order"] in seen_order:
            fail([f"atlas: {t['id']} and {seen_order[t['order']]} both claim "
                  f"order {t['order']}"])
        seen_order[t["order"]] = t["id"]
    tables.sort(key=lambda t: t["order"])
    for t in tables:
        for row in t["rows"]:
            if row.get("detail"):
                row["detail"]["html"] = atlas_card(row, t)
    return tables


# Every numeric format a tensor core can be asked for, in the order they
# arrived. The strip shows all of them every time, because "this one does not
# have FP4" is the answer as often as "this one does".
TENSOR_FORMATS = ("tf32", "bf16", "fp16", "fp8", "fp4", "int8")

GEN_LABEL = {
    0: "no tensor cores",
    1: "1st generation tensor cores",
    2: "2nd generation tensor cores",
    3: "3rd generation tensor cores",
    4: "4th generation tensor cores",
    5: "5th generation tensor cores",
}


def atlas_card(row, table):
    """The hover card for one atlas row, rendered at build time.

    Rendered here rather than in the browser for the reason the reference
    handbook inlines its glossary definitions: the card is already in the
    document when the pointer arrives, so there is no fetch, no spinner and
    nothing to get wrong on a slow connection.

    Every table gets the same card: an eyebrow naming the row, the summary,
    then the columns the table itself declares. A row that also carries a
    `tensor` block gets the two things only a GPU row can have, the format
    strip and what it costs to rent. Nothing else in the atlas has to know
    that GPUs exist.
    """
    det = row["detail"]
    name = str(row.get(table["columns"][0]["key"]) or "")
    strip, rent_html = "", ""
    if det.get("tensor"):
        strip, rent_html = _tensor_card_parts(row, det["tensor"], name)

    rows_html = "".join(
        f"<dt>{html.escape(c['label'])}</dt>"
        f"<dd{' class=\"mono\"' if c.get('mono') else ''}>"
        f"{html.escape(str(row.get(c['key']) or '')) or '&mdash;'}</dd>"
        for c in table["columns"][1:])

    note = det["tensor"].get("note") if det.get("tensor") else None
    note_html = (f'<p class="acard-note">{inline(note)}</p>' if note else "")

    return (f'<div class="acard">'
            f'<p class="eyebrow">{html.escape(name)}</p>'
            f'<p class="acard-sum">{inline(det["summary"])}</p>'
            f'{strip}'
            f'<dl class="acard-dl">{rows_html}{rent_html}</dl>'
            f'{note_html}</div>')


def _tensor_card_parts(row, t, name):
    """The format strip and the rental line, for a row that describes a GPU."""
    gen = int(t.get("gen", 0))
    fmts = set(t.get("formats") or [])

    cells = [{"label": f, "on": f in fmts,
              "accent": "jade" if f in ("fp4", "fp8") else "azure"}
             for f in TENSOR_FORMATS]
    strip = figures.render(json.dumps({
        "kind": "strip",
        "alt": (f"Numeric formats the tensor cores of {name} support: "
                + (", ".join(sorted(fmts)) if fmts
                   else "none, this generation has no tensor cores")),
        "caption": GEN_LABEL.get(gen, ""),
        "cells": cells,
    }), f"atlas card {name}")

    # What a learner can actually rent, joined from the Modal catalogue, so the
    # card answers "can I run this" rather than only "does it exist".
    offered = [g for g in load_gpu_catalog()["gpus"]
               if g.get("smMin") == row["sm"] or g.get("sm") == row["sm"]]
    # Modal spells "this exact part, no substitution" as a trailing !, and
    # "this or better" as a trailing +. Those are the same silicon at the same
    # price, so listing both reads as two products rather than one.
    seen, distinct = set(), []
    for g in sorted(offered, key=lambda g: (g["price_per_hour"],
                                            len(g["gpu_string"]))):
        k = (g["price_per_hour"], g["vram_gb"])
        if k in seen:
            continue
        seen.add(k)
        distinct.append(g)
    if distinct:
        rent = ", ".join(
            f"{g['gpu_string']} at ${g['price_per_hour']:.2f} an hour, "
            f"{g['vram_gb']} GB"
            for g in distinct)
        rent_html = f"<dt>To rent</dt><dd>{html.escape(rent)}</dd>"
    else:
        rent_html = ("<dt>To rent</dt><dd class=\"none\">Not offered by the "
                     "GPU runner this handbook uses.</dd>")
    return strip, rent_html


def load_gpu_catalog():
    """The GPU list the picker renders, checked on the way through.

    Sourced from the Modal platform research. Every entry needs an sm target,
    because an exercise that declares a minimum is meaningless against a card
    whose capability is unknown.
    """
    src = ROOT / ".research" / "modal-gpus.json"
    if not src.exists():
        raise BuildError("modal-gpus.json is missing from .research/")
    rows = json.loads(src.read_text())
    if isinstance(rows, dict):
        rows = rows.get("gpus", [])
    problems, out = [], []
    for r in rows:
        w = f"modal gpu {r.get('id', '?')}"
        for k in ("id", "gpu_string", "name", "vram_gb", "sm", "price_per_hour"):
            if not r.get(k):
                problems.append(f"{w}: missing {k!r}")
        sm = r.get("sm", "")
        # "sm_100a or sm_103a" describes a pool that could hand you either, so
        # the conservative member is the one an exercise can rely on.
        first = sm.split(" or ")[0].strip()
        if first and first not in SM_ORDER:
            problems.append(f"{w}: {first!r} is not a known compute capability")
        out.append({**r, "smMin": first, "pool": " or " in sm})
    fail(problems)
    out.sort(key=lambda r: r["price_per_hour"])
    return {"gpus": out, "families": SM_FAMILIES, "order": SM_ORDER}


def build_search(manifest, units):
    """The search index.

    Section entries carry the prose under that heading, not only the heading
    itself, because a reader searching for "latch" wants the paragraph that
    explains it and not merely a heading that happens to contain the word.

    Code is stripped: a search for "int" should not return every C exercise,
    and identifiers are better found by reading the unit than by matching them
    here.

    Loaded only when the search view opens. The Rust Handbook's own analysis
    found its index was 45% of a payload every page view downloaded.
    """
    idx = []
    for u in manifest:
        idx.append({"t": "unit", "slug": u["slug"], "title": u["title"],
                    "text": u["blurb"], "part": u["partTitle"]})

    for slug, u in units.items():
        # split the rendered note at its headings so each section carries its
        # own prose
        html = prose.strip_code(u["html"])
        chunks = re.split(r'<h[23] id="([^"]+)">(.*?)</h[23]>', html)
        # chunks: [before, id1, title1, body1, id2, title2, body2, ...]
        for i in range(1, len(chunks) - 2, 3):
            hid, htitle, body = chunks[i], chunks[i + 1], chunks[i + 2]
            text = re.sub(r"<[^>]+>", " ", body)
            text = re.sub(r"\s+", " ", text).strip()
            idx.append({
                "t": "section", "slug": slug, "anchor": hid,
                "title": re.sub(r"<[^>]+>", "", htitle),
                "text": text[:1200], "part": u["partTitle"],
            })
        for e in u["exercises"]:
            brief = re.sub(r"<[^>]+>", " ", prose.strip_code(e["brief"]))
            idx.append({
                "t": "exercise", "slug": slug, "n": e["n"], "title": e["title"],
                "text": (e["concept"] + " " + re.sub(r"\s+", " ", brief).strip())[:600],
                "part": u["partTitle"],
            })
        for d in u["drills"]:
            idx.append({
                "t": "drill", "slug": slug, "n": d["n"], "title": d["q"],
                "text": re.sub(r"<[^>]+>", " ", d["why"])[:400],
                "part": u["partTitle"],
            })
    return idx


def check_search_examples(index):
    """The search page offers example queries. They have to actually return
    something, or the first thing a reader does on that page is get nothing."""
    src = (Path(__file__).parent / "assets" / "app.js").read_text()
    m = re.search(r"const SEARCH_EXAMPLES = \[(.*?)\];", src, re.S)
    if not m:
        return ["assets/app.js: SEARCH_EXAMPLES is gone, so nothing checks the "
                "example queries on the search page"]
    examples = re.findall(r"'([^']+)'", m.group(1))
    if not examples:
        return ["assets/app.js: SEARCH_EXAMPLES is empty"]
    problems = []
    for q in examples:
        needle = q.lower()
        hits = sum(1 for d in index
                   if needle in (d["title"] + " " + d.get("text", "")).lower())
        if not hits:
            problems.append(
                f"assets/app.js: the search page offers {q!r} as an example "
                f"query and it returns nothing")
    return problems


def prune(data, units):
    """Delete emitted JSON whose source is gone, so the staleness gate works."""
    for sub, keep in (("unit", units), ("ex", units), ("drills", units)):
        d = data / sub
        if not d.exists():
            continue
        for f in d.glob("*.json"):
            if f.stem not in keep:
                f.unlink()


def write(path, obj):
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------------- main

# ------------------------------------------------------------------ validate

def validate_sim(exercises, where):
    """Run every sim starter and solution through the real simulator.

    Two round trips per exercise. The starter must fail in the way its @expect
    declares, and the solution must pass. Without this, a change to the
    simulator silently turns an exercise into one that teaches nothing, and
    nobody finds out until a learner is confused by it.

    Uses node, which the simulator already targets so its tests can run.
    """
    import subprocess, tempfile
    payload = [{
        "n": e["n"], "title": e["title"],
        "want": [x["key"] for x in e["expect"] if x["judge"] == "verdict"],
        "starter": e["starter"], "solution": e["solution"], "spec": e["spec"],
    } for e in exercises if e["backend"] == "sim"]
    if not payload:
        return []

    driver = r"""
const SIM = require(process.argv[2]);
const items = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const out = items.map(e => {
  const s = SIM.check(e.starter, e.spec);
  const sol = SIM.check(e.solution, e.spec);
  return { n: e.n, title: e.title, want: e.want,
           starter: s.verdict, starterMsg: s.message,
           solution: sol.verdict, solutionMsg: sol.message, gates: sol.gates };
});
console.log(JSON.stringify(out));
"""
    with tempfile.TemporaryDirectory() as d:
        dp, jp = Path(d) / "d.js", Path(d) / "p.json"
        dp.write_text(driver)
        jp.write_text(json.dumps(payload))
        try:
            r = subprocess.run(
                ["node", str(dp), str(ROOT / "assets" / "sim.js"), str(jp)],
                capture_output=True, text=True, timeout=120)
        except FileNotFoundError:
            return [f"{where}: --validate needs node on PATH"]
        if r.returncode != 0:
            return [f"{where}: the simulator driver failed: {r.stderr.strip()[:400]}"]
        results = json.loads(r.stdout)

    problems = []
    for res in results:
        w = f"{where} ex{res['n']} ({res['title']})"
        if res["want"] and res["starter"] not in res["want"]:
            problems.append(
                f"{w}: starter gives {res['starter']!r}, @expect declares "
                f"{' or '.join(res['want'])!r}. The explanation the reader will "
                f"see does not describe the error they will get.")
        if res["solution"] != "ok":
            problems.append(
                f"{w}: solution does not pass: {res['solution']} "
                f"({res['solutionMsg']})")
    return problems


def validate_godbolt(exercises, where):
    """Compile every godbolt starter and solution for real.

    Runs through assets/workbench.js, the same client the browser uses. A
    validator that models the client rather than being the client will
    eventually disagree with it, and the disagreement gets found by a learner.
    """
    import subprocess, tempfile
    items = [{
        "n": e["n"], "title": e["title"], "lang": e["lang"] or "cpp",
        "kind": e["kind"], "flags": e["flags"], "tests": e["tests"],
        "starter": e["starter"], "solution": e["solution"],
        "want": [x["key"] for x in e["expect"] if x["judge"] == "verdict"],
        "wantMatch": [x["key"] for x in e["expect"] if x["judge"] == "match"],
        "wantSilent": any(x["judge"] == "silent" for x in e["expect"]),
    } for e in exercises if e["backend"] == "godbolt"]
    if not items:
        return []

    with tempfile.TemporaryDirectory() as d:
        jp = Path(d) / "p.json"
        jp.write_text(json.dumps({"judges": JUDGES_CONFIG, "items": items}))
        try:
            r = subprocess.run(
                ["node", str(ROOT / "validate_godbolt.mjs"), str(jp)],
                capture_output=True, text=True, timeout=600, cwd=ROOT)
        except FileNotFoundError:
            return [f"{where}: --validate needs node on PATH"]
        except subprocess.TimeoutExpired:
            return [f"{where}: the compiler service did not answer in ten minutes"]
        if r.returncode != 0:
            return [f"{where}: the validator failed: {r.stderr.strip()[:500]}"]
        results = json.loads(r.stdout)

    by_n = {i["n"]: i for i in items}
    problems = []
    for res in results:
        w = f"{where} ex{res['n']} ({res['title']})"
        item = by_n[res["n"]]

        if res["starterUnavailable"] or res["solutionUnavailable"]:
            problems.append(
                f"{w}: the compiler service could not be reached after three "
                f"tries. This is the service, not the content, so treat it as "
                f"a skip rather than a failure.")
            continue

        got = res.get("starterVerdicts") or [res["starterVerdict"]]
        if res["want"] and not (set(got) & set(res["want"])):
            problems.append(
                f"{w}: starter emits {got}, @expect declares "
                f"{' or '.join(res['want'])!r}.")
        if item["wantSilent"] and not res["starterPass"]:
            problems.append(
                f"{w}: @expect silent, but the starter failed the toolchain "
                f"({res['starterVerdict']}). A silent exercise must compile and "
                f"run cleanly and still be wrong.")
        for pat in item["wantMatch"]:
            rx = re.compile(pat[1:-1])
            hay = "\n".join(s2["key"] for s2 in res["starterSignals"]
                             if s2["judge"] == "match")
            if not rx.search(hay):
                problems.append(
                    f"{w}: @expect match {pat} did not match what the compiler "
                    f"actually said. Got: {hay[:200]!r}")

        if not res["solutionPass"]:
            problems.append(
                f"{w}: solution does not pass: {res['solutionVerdict']} "
                f"({res['solutionTitle']})")
        elif res["solutionClean"] is False:
            problems.append(
                f"{w}: solution passes but is not clean. Fix the warnings or "
                f"say so in the exercise.")
    return problems


def validate_yosys(exercises, where):
    """Synthesise every yosys starter and solution for real.

    Runs assets/yosys-check.js, which the browser worker also imports. One
    implementation of what counts as a latch, not two that can drift.
    """
    import subprocess, tempfile
    items = [{
        "n": e["n"], "title": e["title"], "spec": e["spec"],
        "starter": e["starter"], "solution": e["solution"],
        "want": [x["key"] for x in e["expect"] if x["judge"] == "verdict"],
    } for e in exercises if e["backend"] == "yosys"]
    if not items:
        return []

    with tempfile.TemporaryDirectory() as d:
        jp, op = Path(d) / "p.json", Path(d) / "out.json"
        jp.write_text(json.dumps({"items": items}))
        try:
            r = subprocess.run(
                ["node", str(ROOT / "validate_yosys.mjs"), str(jp), str(op)],
                capture_output=True, text=True, timeout=900, cwd=ROOT)
        except FileNotFoundError:
            return [f"{where}: --validate needs node on PATH"]
        except subprocess.TimeoutExpired:
            return [f"{where}: synthesis did not finish in fifteen minutes"]
        if r.returncode != 0 or not op.exists():
            tail = (r.stderr.strip() or r.stdout.strip())[-500:]
            return [f"{where}: the synthesiser failed: {tail}"]
        results = json.loads(op.read_text())

    problems = []
    for res in results:
        w = f"{where} ex{res['n']} ({res['title']})"
        if res["starterVerdict"] == "unavailable" or res["solutionVerdict"] == "unavailable":
            problems.append(f"{w}: the synthesiser could not run: "
                            f"{res['starterMessage'][:200]}")
            continue
        if res["want"] and res["starterVerdict"] not in res["want"]:
            problems.append(
                f"{w}: starter gives {res['starterVerdict']!r}, @expect declares "
                f"{' or '.join(res['want'])!r}. "
                f"({res['starterMessage'][:120]})")
        if res["solutionVerdict"] != "ok":
            problems.append(
                f"{w}: solution does not pass: {res['solutionVerdict']} "
                f"({res['solutionMessage'][:160]})")
    return problems


def validate_modal(exercises, where):
    """Compile and run every modal starter and solution on a real GPU.

    Needs a runner in the environment (HH_MODAL_SUBMIT, HH_MODAL_POLL,
    HH_MODAL_TOKEN). Without one the exercises are reported as SKIPPED and
    never as passing: a validation that silently passes what it did not check
    is worse than one that does not run.
    """
    import subprocess, tempfile
    items = [{
        "n": e["n"], "title": e["title"], "kind": e["kind"], "flags": e["flags"],
        "tests": e["tests"], "gpu": e["gpu"],
        "starter": e["starter"], "solution": e["solution"],
        "want": [x["key"] for x in e["expect"] if x["judge"] == "verdict"],
    } for e in exercises if e["backend"] == "modal"]
    if not items:
        return [], 0

    with tempfile.TemporaryDirectory() as d:
        jp, op = Path(d) / "p.json", Path(d) / "out.json"
        jp.write_text(json.dumps({"judges": JUDGES_CONFIG, "items": items}))
        try:
            r = subprocess.run(
                ["node", str(ROOT / "validate_modal.mjs"), str(jp), str(op)],
                capture_output=True, text=True, timeout=1800, cwd=ROOT)
        except FileNotFoundError:
            return [f"{where}: --validate needs node on PATH"], 0
        except subprocess.TimeoutExpired:
            return [f"{where}: the GPU runner did not finish in thirty minutes"], 0
        if r.returncode != 0 or not op.exists():
            return [f"{where}: the runner failed: "
                    f"{(r.stderr or r.stdout).strip()[-400:]}"], 0
        results = json.loads(op.read_text())

    if results and results[0].get("skipped"):
        return [], 0

    problems = []
    for res in results:
        w = f"{where} ex{res['n']} ({res['title']})"
        if res["starterUnavailable"] or res["solutionUnavailable"]:
            problems.append(f"{w}: the GPU runner could not be reached. "
                            f"That is the runner, not the content.")
            continue
        got = res["starterVerdicts"]
        if res["want"] and not (set(got) & set(res["want"])):
            problems.append(
                f"{w}: starter emits {got}, @expect declares "
                f"{' or '.join(res['want'])!r}. ({res['starterTitle'][:120]})")
        if not res["solutionPass"]:
            problems.append(f"{w}: solution does not pass: "
                            f"{res['solutionVerdicts']} ({res['solutionTitle'][:160]})")
    return problems, len(results)


def run_validate():
    """Every backend, every exercise. Per-backend pools, not one shared pool:
    a single pool of four would queue hundreds of local simulator checks behind
    three network round trips."""
    track.validate()
    by_backend, total = {}, 0
    for slug, part, title, blurb, backend in track.TRACK:
        f = CONTENT / "ex" / f"{slug}.md"
        if not f.exists():
            continue
        exercises = parse_exercises(f.read_text(), f"ex/{slug}", backend)
        total += len(exercises)
        for e in exercises:
            by_backend.setdefault(e["backend"], []).append((f"ex/{slug}", e))

    problems, checked = [], 0
    for backend, items in sorted(by_backend.items()):
        if backend == "sim":
            for where in {w for w, _ in items}:
                group = [e for w, e in items if w == where]
                problems += validate_sim(group, where)
                checked += len(group)
            print(f"  sim      {len(items):3} exercises checked")
        elif backend == "modal":
            ran = 0
            for where in sorted({w for w, _ in items}):
                group = [e for w, e in items if w == where]
                probs, n = validate_modal(group, where)
                problems += probs
                ran += n
            checked += ran
            print(f"  modal    {len(items):3} exercises "
                  + (f"checked on a real GPU" if ran
                     else "SKIPPED (no runner in the environment)"))
        elif backend == "yosys":
            for where in sorted({w for w, _ in items}):
                group = [e for w, e in items if w == where]
                problems += validate_yosys(group, where)
                checked += len(group)
            print(f"  yosys    {len(items):3} exercises checked (yosys 0.68)")
        elif backend == "godbolt":
            for where in sorted({w for w, _ in items}):
                group = [e for w, e in items if w == where]
                problems += validate_godbolt(group, where)
                checked += len(group)
            # Name every toolchain that actually ran. This said "gcc 16.2" for
            # all of them, which stopped being true the moment eight of them
            # were assembled by llvm-mc.
            langs = JUDGES_CONFIG["godbolt"]["langs"]
            used = sorted({langs[e["lang"]]["name"] for _, e in items
                           if e["lang"] in langs})
            print(f"  godbolt  {len(items):3} exercises checked "
                  f"({', '.join(used)})")
        else:
            print(f"  {backend:<8} {len(items):3} exercises skipped "
                  f"(backend client not wired yet)")
    print(f"\n{checked} of {total} exercises validated against a real tool")
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", metavar="FILE", help="check one exercise file")
    ap.add_argument("--validate", action="store_true",
                    help="compile every starter and solution for real")
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--stale", action="store_true",
                    help="exit nonzero if data/ is older than content/")
    ap.add_argument("--lax", action="store_true",
                    help="skip word and file-presence checks (scaffolding only)")
    a = ap.parse_args()

    try:
        if a.check:
            # The directory says which kind of file this is, so use it rather
            # than parsing every file as exercises and reporting 15 mysteries.
            p = Path(a.check)
            if p.parent.name == "drills":
                d = parse_drills(p.read_text(), p.name)
                print(f"{len(d)} drills, {p.name}: clean")
            else:
                slug = p.stem
                backend = next((u[4] for u in track.TRACK if u[0] == slug),
                               "godbolt")
                ex = parse_exercises(p.read_text(), p.name, backend)
                print(f"{len(ex)} exercises, {p.name}: clean")
            return 0

        if a.stale:
            problems = stale()
            for p in problems:
                print(p, file=sys.stderr)
            if not problems:
                print("data/ is current with content/")
            return 1 if problems else 0

        manifest, units = build(strict=not a.lax)
        c = json.loads((DATA / "manifest.json").read_text())["counts"]
        print(f"{c['parts']} parts, {c['units']} units "
              f"({c['ready']} written, {c['units'] - c['ready']} stubs)")
        print(f"{c['words']} words, {c['exercises']} exercises, {c['drills']} drills")

        if a.stats:
            for u in manifest:
                mark = "ok  " if u["ready"] else "  . "
                print(f"  {mark}{u['partRoman']:<5} {u['slug']:<24} {u['backend']}")
        if a.validate:
            print("\nvalidating against real tools:")
            problems = run_validate()
            if problems:
                print(f"\n{len(problems)} problem(s):", file=sys.stderr)
                for p in problems:
                    print(f"  {p}", file=sys.stderr)
                return 1
            print("every checked starter fails as declared, "
                  "every checked solution passes")
        return 0
    except BuildError as e:
        print(f"build failed:\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
