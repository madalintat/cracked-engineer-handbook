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
    "backend", "gpu", "flags",
}

JUDGES = ("verdict", "match", "silent")

# The stable structured keys each backend can emit. Matching on these beats
# matching on wording a toolchain release can change. Anything not listed here
# has to go through `match` with a regex, and --validate then carries the weight
# of noticing when the wording drifts.
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
        "assert-failed", "timeout", "no-endpoint", "ok",
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
        meta[k.strip()] = v
    return meta, body


# ------------------------------------------------------------------- markdown

FENCE = re.compile(r"^```([a-zA-Z0-9_+-]*)\s*$")


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", s)
    s = re.sub(r"\[\[([a-z0-9-]+)\]\]", r'<a class="gl" href="#/glossary#\1">\1</a>', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    return s


def slugify(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[^a-zA-Z0-9\s-]", "", s).strip().lower()
    return re.sub(r"\s+", "-", s)


def render(md):
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
            code = html.escape("\n".join(buf))
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
    """Words in the rendered note, tags stripped. Code and tables count."""
    txt = re.sub(r"<[^>]+>", " ", html_text)
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
                if name in ("kind", "concept", "backend", "gpu", "flags"):
                    ex[name] = arg
                    sink[0] = "brief"
                elif name == "expect":
                    ex["expect"].append(_parse_expect(arg))
                    sink[0] = "brief"
                elif name == "hint":
                    ex["hints"].append(arg)
                    sink[0] = "brief"
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
            else:
                brief.append(line)
            i += 1

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
        p.append(f"{w}: @gpu only means something on the modal backend")
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
    p += prose.lint(re.sub(r"<[^>]+>", " ", ex["brief"]), f"{w} brief")
    for h in ex["hints"]:
        p += prose.lint(h, f"{w} hint")
    return p


# --------------------------------------------------------------------- drills

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
    problems, drills = [], []
    for n, chunk in enumerate(re.split(r"^##\s+", text, flags=re.M)[1:], 1):
        q, _, rest = chunk.partition("\n")
        w = f"{where} drill{n}"
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
        problems += prose.lint(q, f"{w} question")
        drills.append({
            "n": n, "q": q.strip(), "options": opts, "correct": correct,
            "why": render("\n".join(why).strip())[0],
        })
    if len(drills) != N_DRILLS:
        problems.append(f"{where}: {len(drills)} drills, expected {N_DRILLS}")
    fail(problems)
    return drills


# ---------------------------------------------------------------------- build

def build(strict=True):
    track.validate()
    problems, units, manifest = [], {}, []

    for num, (slug, part, title, blurb, backend) in enumerate(track.TRACK):
        pid = track.PART_BY_ID[part]
        entry = {
            "slug": slug, "num": num, "title": title, "blurb": blurb,
            "part": part, "partRoman": pid[1], "partTitle": pid[2],
            "accent": pid[4], "backend": backend, "ready": False,
            "words": 0, "exercises": 0, "drills": 0,
        }
        note_p = CONTENT / "units" / f"{slug}.md"
        if note_p.exists():
            try:
                meta, body = split_front_matter(note_p.read_text(), f"units/{slug}")
                body_html, heads = render(body)
                words = word_count(body_html)
                if strict and not (NOTE_WORDS[0] <= words <= NOTE_WORDS[1]):
                    problems.append(
                        f"units/{slug}: {words} words, want "
                        f"{NOTE_WORDS[0]}..{NOTE_WORDS[1]}")
                problems += prose.lint(re.sub(r"<[^>]+>", " ", body_html),
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

    fail(problems)   # nothing is written until every check has passed

    DATA.mkdir(exist_ok=True)
    for sub in ("unit", "ex", "drills"):
        (DATA / sub).mkdir(exist_ok=True)

    parts = [{"id": p[0], "roman": p[1], "title": p[2], "blurb": p[3],
              "accent": p[4], "reports": p[5]} for p in track.PARTS]
    write(DATA / "manifest.json", {
        "parts": parts, "units": manifest,
        "backends": list(track.BACKENDS),
        "counts": {
            "parts": len(parts), "units": len(manifest),
            "ready": sum(1 for u in manifest if u["ready"]),
            "words": sum(u["words"] for u in manifest),
            "exercises": sum(u["exercises"] for u in manifest),
            "drills": sum(u["drills"] for u in manifest),
        },
    })

    for slug, u in units.items():
        write(DATA / "unit" / f"{slug}.json",
              {k: u[k] for k in ("slug", "num", "title", "blurb", "part",
                                 "partRoman", "partTitle", "accent", "backend",
                                 "meta", "html", "headings", "words")})
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

    write(DATA / "search.json", build_search(manifest, units))
    prune(DATA, units)
    return manifest, units


def build_search(manifest, units):
    idx = []
    for u in manifest:
        idx.append({"t": "unit", "slug": u["slug"], "title": u["title"],
                    "text": u["blurb"], "part": u["partTitle"]})
    for slug, u in units.items():
        for h in u["headings"]:
            idx.append({"t": "section", "slug": slug, "anchor": h["id"],
                        "title": h["text"], "text": "", "part": u["partTitle"]})
        for e in u["exercises"]:
            idx.append({"t": "exercise", "slug": slug, "n": e["n"],
                        "title": e["title"], "text": e["concept"],
                        "part": u["partTitle"]})
    return idx


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

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", metavar="FILE", help="check one exercise file")
    ap.add_argument("--validate", action="store_true",
                    help="compile every starter and solution for real")
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--lax", action="store_true",
                    help="skip word and file-presence checks (scaffolding only)")
    a = ap.parse_args()

    try:
        if a.check:
            p = Path(a.check)
            slug = p.stem
            backend = next((u[4] for u in track.TRACK if u[0] == slug), "godbolt")
            ex = parse_exercises(p.read_text(), p.name, backend)
            print(f"{len(ex)} exercises, {p.name}: clean")
            return 0

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
            print("\n--validate is not wired yet: needs the backend clients")
            return 1
        return 0
    except BuildError as e:
        print(f"build failed:\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
