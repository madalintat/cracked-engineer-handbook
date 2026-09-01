# The Python Handbook: implementation analysis

Reference implementation study for the Hardware Handbook. Companion to the four
`RUSTBOOK-*.md` reports in this directory. The Rust Handbook
(`/Users/madalintat/learning_series/rust_learning`) is the original; the Python
Handbook (`/Users/madalintat/learning_series/python_study`) was written after it,
in a single day (git log: first commit `e6b5fc2` at 2026-09-01 01:43, last
`28a3fcb` at 11:07), by someone who had just finished the Rust one and knew where
it hurt.

## Size, at a glance

| File | Rust | Python | Delta |
|---|---:|---:|---|
| `build.py` | 1391 | 948 | −32% |
| `assets/app.js` | 1406 | 713 | −49% |
| `assets/app.css` | 1827 | 678 | −63% |
| `assets/workbench.js` | 376 | 568 | +51% |
| `assets/vim.js` | 913 | 925 | ~same |
| `index.html` | 98 | 69 | −30% |
| `docs/` | 3 files, 676 lines | 1 file, 212 lines | −69% |

The Python one is smaller everywhere except the workbench, which is where the
whole difference in ambition lives: it runs three separate judges in-browser
instead of POSTing to one remote service. Some of the CSS and JS shrinkage is
scope (39 units against Rust's larger track, fewer decorative views), but a
large part is real: duplicated rules removed, one shared `inline()` renderer
instead of two, ES modules instead of an IIFE-global.

Content state: 10 of 39 units written (00 through 09), all three parts each, 0
of 15 projects. So the *platform* is finished and the *content* is 26% done.
Read it as a platform reference, not a content-volume reference.

---

## 1. The execution backend

### What Rust does

`assets/workbench.js` POSTs to `https://play.rust-lang.org/execute`:

```js
const PLAY = 'https://play.rust-lang.org/execute';
res = await fetch(PLAY, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel: 'stable', mode: 'debug', edition,
    crateType: tests ? 'lib' : 'bin', tests: !!tests, backtrace: false, code: source }),
});
```

One request, one remote service, `{ stdout, stderr, success }` back. The
learner's code leaves the machine. It needs network on every run. The response is
free text that a hand-written parser (`parse(res)`) turns into structured
diagnostics by regex.

### What Python does

Nothing leaves the machine. Three judges, all in the browser, all started
concurrently. From the file header:

```js
/* The workbench: a Python tokenizer, three judges, and the reading of their verdict.

   Everything here runs in the browser. Nothing the learner writes is sent anywhere. */
```

**Judge 1 — ruff (WASM).** `@astral-sh/ruff-wasm-web@0.16.5` from jsDelivr, a
dynamic `import()` of `ruff_wasm.js` then `mod.default(...ruff_wasm_bg.wasm)`. It
constructs a `Workspace` with the exact lint settings `build.py` also uses, and
handles the 0.16 API change defensively:

```js
// 0.16 takes a position encoding; older builds take one argument. Try both.
try { return new mod.Workspace(settings, mod.PositionEncoding.Utf32); }
catch { return new mod.Workspace(settings); }
```

Returns `[{ code, message, line }]` — already structured, no parsing. This is the
single biggest backend win over Rust: the WASM judge hands back objects, so
there is no `RE_DIAG`/`RE_LOC` stderr scraper to maintain.

**Judges 2 and 3 — CPython and mypy, both inside Pyodide 3.14**
(`https://cdn.jsdelivr.net/pyodide/v314.0.6/full/`). One Pyodide instance serves
both. A Python function `_ph_run` is injected at load time and does the actual
execution:

```python
def _ph_run(src, tests):
    def _ph_import():
        mod = {"__name__": "your_code"}
        exec(compile(src, "your_code.py", "exec"), mod)
        return mod

    ns = {"__name__": "__main__", "_ph_import": _ph_import}
    buf = io.StringIO()
    real, sys.stdout = sys.stdout, buf
    try:
        exec(compile(src, "your_code.py", "exec"), ns)
        exec(compile(tests, "hidden_tests.py", "exec"), ns)
        return json.dumps({"ok": True, "out": buf.getvalue(), "exc": None, "msg": "", "tb": ""})
    except BaseException as e:
        tb = "".join(traceback.format_exception(type(e), e, e.__traceback__.tb_next))
        return json.dumps({"ok": False, "out": buf.getvalue(),
                           "exc": type(e).__name__, "msg": str(e), "tb": tb})
    finally:
        sys.stdout = real
```

Three details worth stealing verbatim:

- The learner's code and the hidden tests run in **one namespace**, sequentially,
  so a failing assert in the tests and a crash in the code come back through the
  same channel with the same shape. No separate "did the tests pass" path.
- `__name__` is `"__main__"`, so `if __name__ == "__main__":` guards behave the
  way they do when you type `python your_code.py`. `_ph_import()` is handed to
  the tests so an exercise can ask what would have happened on an *import*
  instead. That is a genuinely hard thing to test and it costs four lines.
- `e.__traceback__.tb_next` drops the `_ph_run` frame, so the traceback the
  learner reads starts at their own code. One attribute access, and it is the
  difference between a traceback that teaches and one that leaks the harness.

The response shape crossing the JS/Python line is a JSON string:
`{ ok, out, exc, msg, tb }`. `exc` is `type(e).__name__` — the bare class name,
which is the diagnose key (see §2).

**mypy** is installed *into* the same Pyodide at first use:

```js
await py.loadPackage(mypy.preload);           // ["micropip", "typing-extensions"]
const micropip = py.pyimport("micropip");
await micropip.install(mypy.install);          // ["mypy_extensions","pathspec","tomli","mypy"]
```

with a comment in `build.py` explaining the odd explicit list:

```python
# micropip does not resolve mypy's transitive dependencies in Pyodide
"install": ["mypy_extensions", "pathspec", "tomli", "mypy"],
# typing-extensions ships inside the Pyodide distribution
"preload": ["micropip", "typing-extensions"],
```

mypy writes to `/tmp/check.py` in the Pyodide FS and calls `mypy.api.run`.
Its text output *is* parsed by regex, but the regex is a single line and is
duplicated deliberately in `build.py` so both sides read mypy identically:

```js
const m = line.match(/^.*?:(\d+):(?:\d+:)?\s*error:\s*(.*?)\s*\[([a-z-]+)\]\s*$/);
```

### Loading strategy and keeping it off the critical path

- **Nothing loads until Run is pressed.** All three `getX()` helpers are lazy and
  memoised. Page load fetches only `app.js`, `workbench.js`, `vim.js` and JSON.
- **All three start at once**, and the comment says why:

```js
// Start all three at once. They are independent downloads on a cold cache,
// and awaiting them in series turned a max into a sum. They are still
// *displayed* in this order, which is what the reader cares about.
const settle = p => p.then(value => ({ value }), error => ({ error }));
const pRuff = settle(judgeRuff(src));
const pRun  = settle(judgeRun(src, ex.tests, say));
const pMypy = settle(judgeMypy(src, say));
```

  `settle()` attaches a handler immediately so a judge failing while another is
  awaited is not an unhandled rejection. Results are then consumed in
  ruff → CPython → mypy order, which is fastest-first for the reader.
- **The three rows render immediately in a waiting state**, with honest copy:
  ruff says "checking…", mypy says "waiting for CPython to load…", cpython says
  "starting…". A progress line (`say()`) writes "fetching CPython…" and
  "fetching mypy…" into the status span.
- **Failure is per-judge, not fatal.** Each `await` is in its own `try`, and a
  dead judge renders `unavailable (message)` in a neutral row while the other two
  still produce a verdict.
- **The memo caches success only**, which is a bug the Rust one has in a
  different form:

```js
// Memoise the success, never the failure. `p ||= f()` caches a rejected promise
// forever, which turns one flaky CDN fetch into a judge that is dead for the session.
const memo = {};
export const cached = (key, make) => {
  memo[key] ||= make().catch(err => { memo[key] = null; throw err; });
  return memo[key];
};
```

**Size cost.** Not measured anywhere in the repo, and no budget is asserted. Real
figures for these exact artifacts: Pyodide 3.14 full distribution is roughly
10 MB for the core `pyodide.asm.wasm` plus the stdlib zip; `ruff-wasm-web` is
around 6 MB; mypy plus its three deps through micropip is several MB more. So a
cold first Run is on the order of 20 MB and tens of seconds. **This is the one
thing the implementation does not honestly confront** — there is no size warning,
no "this will take a moment" beyond a three-word status line, and no
`--validate`-style budget check. Flagging it: if the Hardware Handbook loads
anything WASM-sized, put a number in front of the learner before the download
starts.

### Wrong answer vs crash

Four verdict kinds, declared once in `build.py`:

```python
# The four verdict kinds. `silent` is the one Rust cannot have: every judge is
# happy and the code is still wrong.
VERDICTS = {"ruff", "mypy", "raises", "silent"}
```

That comment is the thesis of the whole port. Rust's model is binary: it compiled
or it did not. Python's model has a fourth state, and the book is built around it.

- **crash** = `@expect raises:TypeError`. `_ph_run` catches, `exc` is set, the
  cpython row goes `is-bad`, the traceback is printed verbatim below the reading.
- **wrong answer** = `@expect silent`. The code runs clean, ruff is clean, mypy
  is clean, and the *hidden tests* fail — which surfaces as an `AssertionError`
  from the test block. The rendering layer disambiguates:

```js
const declaresSilent = ex.expects.some(e => e.judge === "silent");
if (run && run.exc) {
  keys.push(run.exc === "AssertionError" && declaresSilent ? "silent" : run.exc);
}
```

  An `AssertionError` normally means the hidden tests caught a wrong answer, and
  the key is `silent`. But an exercise can legitimately want the learner's own
  code to raise one, in which case `AssertionError` is the key. The declared
  `@expect` decides. This is a subtle, correct piece of design and it is the
  answer to "how do you tell a wrong answer from a crash when both arrive as an
  exception".
- The heading the learner sees for `silent` is chosen by context:

```js
const heading = k !== "silent" ? k
  : (ruff.length || mypy.length) ? "Nothing raised" : "Every judge was happy";
```

- **static complaint** = `@expect ruff:B006` or `@expect mypy:index`. Amber row,
  not red. The code may still run and pass.
- A pass **with** static notes gets its own reading, headed "Correct, but not
  clean", distinct from the all-green "Green".

`build.py --validate` enforces the distinction offline, and this check is the
most valuable single test in either repo:

```python
# 3. the starter must actually FAIL its own hidden tests, or the exercise
#    is already solved and nobody would notice
if not broken["raises"]:
    print(f"FAIL starter  {label}: starter already passes its own tests")
elif any(e["judge"] == "silent" for e in ex["expects"]) \
        and broken["raises"] != "AssertionError":
    print(f"FAIL starter  {label}: @expect silent, so starter+tests should "
          f"fail an assert, but it raised {broken['raises']}")
```

The browser also exports its verdict for cross-checking against the offline one:

```js
// The QA harness reads this to compare the browser's verdict against the one
// build.py --validate reached offline. Nothing in the page uses it.
globalThis.__phVerdict = { ruff, mypy, raises: exec?.exc || "", ok: !!exec?.ok };
```

### The single-source-of-truth trick

The most portable idea in the backend. The judges are configured **once**, in
`build.py`, and shipped as data:

```python
# The one description of the three judges. build.py runs them from here and the
# browser fetches this as data/judges.json, so what --validate calls clean and
# what a reader is told is clean cannot drift apart.
JUDGES = {
    "ruff": {"version": "0.16.5",
             "cdn": "https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web@0.16.5/",
             "select": ["E", "F", "B", "SIM", "UP"],
             "ignore": ["E501"], "lineLength": 88, "targetVersion": "py314"},
    "mypy": {...},
    "cpython": {"version": "3.14", "cdn": "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/"},
}
```

The browser fetches it rather than restating it:

```js
const judges = () => cached("judges", () => fetch("data/judges.json").then(r => r.json()));
```

So the CDN URL, the pinned version, the ruff rule selection and the mypy flags
exist in exactly one place. `--validate` runs the *same* rule set through the
native `ruff` and `mypy` binaries via `uv run`. The offline validator and the
in-browser judge cannot disagree about what "clean" means. For four backends
behind one interface, this pattern is not optional.

---

## 2. Diagnostics without error codes

This is the section that matters most for the Hardware Handbook, and the answer
is simpler and better than the Rust one.

### Rust's model

One `@expect` per exercise, keyed on `E0382`-style codes, with three fallbacks
added later when it became clear not every rustc error has a code:

```python
if not val:                              ex["expect"] = None
elif val in ("test-failure", "none"):    ex["expect"] = {"any": True}
elif re.fullmatch(r"E\d{4}", val):       ex["expect"] = {"code": val}
else:                                    ex["expect"] = {"msg": val.strip('"\'')}
```

The `{"msg": ...}` branch is substring matching on free compiler text — fragile,
and the comment admits it was bolted on. The `diagnose` map is keyed by the same
code string.

### Python's model: key on the exception class name

Python never invented normalised-message matching, because it did not have to.
It found four *stable, structured* key spaces and used them all:

| key space | source | example key |
|---|---|---|
| exception type | `type(e).__name__` in `_ph_run` | `TypeError`, `RuntimeError`, `UnboundLocalError` |
| ruff rule code | ruff WASM `d.code` | `B006`, `SIM110`, `F841` |
| mypy error code | the `[code]` suffix mypy prints | `index`, `attr-defined`, `call-overload` |
| the literal `silent` | absence of all three | `silent` |

Nothing is matched on prose. The full key list actually in use, from
`data/errors.json` (39 entries):

```
attr-defined call-overload index list-item misc name-defined operator return
return-value type-var var-annotated silent B004 B006 B007 B008 B012 B023 B904
B905 E711 E712 E721 E722 F821 F823 F841 SIM107 SIM110 invalid-syntax
AssertionError AttributeError IndexError NameError RuntimeError SyntaxError
TypeError UnboundLocalError ValueError
```

The lesson for a handbook with no stable codes: **do not normalise message text
if you can find a class name, an exit code, a signal number, or a tool's own
rule id instead.** Python's `str(e)` is displayed to the learner (`msg`) but is
never a key. Only `type(e).__name__` is.

### The directive grammar

```python
DIRECTIVE = re.compile(r"^@(expect|hint|diagnose)[ \t]+(.+)$", re.M)
```

Three directives, all single-line, all mandatory-argument. `@expect` takes
`judge` or `judge:code`:

```python
if ":" in value:
    judge, _, code = value.partition(":")
else:
    judge, code = value.strip(), ""
if judge not in VERDICTS:
    die(path, f"exercise {i}: @expect {judge!r} not one of {sorted(VERDICTS)}")
expects.append({"judge": judge, "code": code.strip()})
```

`@diagnose CODE prose` splits on the first space:

```python
code, _, prose = value.partition(" ")
if not prose.strip():
    die(path, f"exercise {i}: @diagnose {code} has no prose")
diagnose[code.strip()] = prose.strip()
```

Real examples, from `content/ex/02-mutability.md`:

```
@expect silent
@diagnose silent Nothing raised. `[[0] * width] * height` built one row and then
made a list holding that same row `height` times, ...

@expect raises:TypeError
@expect mypy:index
@diagnose TypeError Tuples implement no `__setitem__`, so assigning to a slot
fails at runtime. ...
@diagnose index mypy reports this before anything runs, because the annotation
says the parameter is a tuple ...
```

**Multiple `@expect` per exercise** is the second big win over Rust. An exercise
can declare that the same defect is caught by two independent judges, and get two
readings, and the pairing teaches something Rust's one-code model cannot express:
here is the runtime failure, and here is the same thing found statically before
the line ever ran.

### The four cross-checks that make it hold

`build.py` will not let a diagnose map rot. In `parse_exercises`:

```python
if not expects: die(...)             # every exercise declares a verdict
if not hints:   die(...)             # every exercise has at least one hint
for e in expects:
    key = e["code"] or e["judge"]
    if key not in diagnose:
        die(path, f"exercise {i}: @expect {key} has no matching @diagnose")
```

and in `--validate`, against the real judges:

```python
# 2. every code a judge reports has prose explaining it, or the reader
#    meets a coloured row with no reading beside it
for judge in ("ruff", "mypy"):
    for code in starter[judge]:
        if code not in ex["diagnose"]:
            print(f"FAIL starter  {label}: {judge} reported {code} "
                  f"but there is no @diagnose {code}")
```

So the invariant is bidirectional: every declared expectation has prose, and
every code the judges *actually emit* has prose. Rust checks only the first
direction.

### The runtime fallback

When the judges complain about something with no reading, the page says so
rather than showing three coloured rows and silence:

```js
if (!parts.length && (run?.exc || ruff.length || mypy.length)) {
  parts.push(`<div class="reading"><h4>Not one of this exercise's errors</h4>
    <p>The judges are objecting to something the exercise does not have a written
    reading for — usually a typo, or a change further from the starter than the
    exercise expects. Read their messages above; they are the real ones, not a
    simplification. <b>reset</b> restores the starter if you want to begin again.</p></div>`);
}
```

(Note: this string contains an em dash, which the project's own prose standard
forbids. It is one of two in the codebase — see §6.)

### The derived errors index

Every `@diagnose` in the book is harvested into `data/errors.json`, so the
site-wide error reference cannot drift from the readings the workbench shows:

```python
# The errors index is derived from every @diagnose in the book, so it cannot
# drift from the prose the workbench actually shows.
for path, parsed in exercises.items():
    for ex in parsed:
        # The judge travels with the @expect declaration. Guessing it back
        # from the shape of the code was wrong for B006, which looks like an
        # exception name, and would be wrong again for the next such code.
        declared = {e["code"] or e["judge"]: e["judge"] for e in ex["expects"]}
        for code, prose in ex["diagnose"].items():
            judge = JUDGE_GROUP[declared[code]] if code in declared else "runtime"
            entry = errors.setdefault(code, {"code": code, "judge": judge, "seen": []})
            entry["seen"].append({"unit": slug, "n": ex["n"], "title": ex["title"],
                                  "prose": prose})
```

The comment records a real bug and its fix: the judge that owns a key must
**travel with the declaration**, because you cannot infer it from the key's shape.
`B006` looks like an exception name. With four backends this problem is four
times worse, so carry the backend id in the `@expect`, exactly as here.

---

## 3. Content pipeline differences

`build.py` in both repos is a zero-dependency, no-network `content/*.md ->
data/*.json` compiler. Same idea, materially different execution.

### CLI surface

| | Rust | Python |
|---|---|---|
| build | `python3 build.py` | `python3 build.py` |
| check one file | `--check FILE` | `--check FILE` |
| compile every exercise | `--validate` (play.rust-lang.org, network) | `--validate` (local `uv run ruff/mypy` + `sys.executable`, no network) |
| `llms.txt` emitted | yes, ~1200 lines of generated onboarding | **dropped** |
| `BUILD-YOUR-OWN.md` emitted | yes | **dropped** |

Python's `--validate` runs **offline**, against locally-resolved tools through
`uv run --quiet --with ruff ruff ...`. Rust's needs the internet and a third
party's rate limit. For four hardware backends this matters: whatever the
learner's browser runs, the validator should be able to run without a network.

### Directives

| directive | Rust | Python |
|---|---|---|
| `@expect` | one per exercise, `E\d{4}` / free message / `test-failure` / `none` | **many** per exercise, `judge` or `judge:code`, judge validated against a closed set |
| `@hint` | optional | **mandatory, at least one** |
| `@diagnose` | multi-line, prose sink until the next directive | single line, `code` + prose, mandatory prose |
| `@kind`, `@concept` | yes | **dropped** |
| `@after` | yes (post-solution prose) | **dropped** |

`@diagnose` losing its multi-line sink is a real regression in expressive power:
Rust's diagnose prose can contain fenced code blocks; Python's cannot, so the
readings are one dense paragraph. For the hardware book, keep Rust's sink
(diagrams and register tables belong in a diagnose reading) but keep Python's
mandatory-prose check.

### Validation added in Python that Rust does not have

1. **Renderer capability check.** The note is refused if it uses markdown the
   hand-written browser renderer cannot draw. This is the best small idea in the
   file:

```python
# The browser renders these notes with a small hand-written markdown
# subset. Anything it cannot draw would be shown to the reader as raw
# source, so the build refuses it rather than letting it through.
unsupported = {
    "ordered list": r"^\d+\. ", "blockquote": r"^> ", "image": r"!\[",
    "heading deeper than ####": r"^#{5,} ", "setext heading": r"^=+$",
    "html block": r"^<\w+", "footnote": r"^\[\^",
}
for label, pat in unsupported.items():
    if re.search(pat, prose, re.M):
        die(path, f"note uses {label}, which the renderer does not support")
```

   Rust has no equivalent, so an author who writes a numbered list gets it
   rendered as literal `1. text` in the browser and nothing complains.

2. **The vocabulary gate.** An AST-based check that no exercise uses a language
   feature the reader has not met yet. 160 lines, and the standout piece of
   engineering in the repo.

```python
# An exercise must be solvable with what the reader has already met. Relying on
# the author to remember the ordering does not survive contact with 39 units, so
# each unit declares what it introduces and the build refuses any exercise whose
# code uses something from further down the track.
```

   `BASELINE` is what page one assumes. `INTRODUCES` maps slug -> features the
   unit unlocks. `_NODE_FEATURES` / `_NAME_FEATURES` / `_MODULE_FEATURES` are
   the detectors. `features_used()` walks the AST. `gate()` checks starter and
   solution (never the tests: "the reader never writes the tests").

   And then it checks the check, which is the part worth copying:

```python
# INTRODUCES says what each unit unlocks; the tables above say what the detector
# can actually find. Nothing connected the two, so a feature named in INTRODUCES
# but never detected gated nothing, and a detected feature named in no unit gated
# everything forever. Both are now build failures.
def _check_feature_tables() -> None:
    introduced = {f for feats in INTRODUCES.values() for f in feats}
    undetectable = introduced - DETECTABLE - BASELINE
    ungated = DETECTABLE - introduced - BASELINE
    if undetectable:
        raise SystemExit(f"INTRODUCES names features no detector finds: {sorted(undetectable)}")
    if ungated:
        raise SystemExit(f"the detector finds features no unit introduces: {sorted(ungated)}")
    twice = [f for f in DETECTABLE
             if sum(1 for feats in INTRODUCES.values() if f in feats) > 1]
    if twice:
        raise SystemExit(f"features introduced by more than one unit: {sorted(twice)}")
```

   A gate that silently gates nothing is worse than no gate, and this refuses to
   let that happen. A hardware book has the same problem in a harder form: an
   exercise that needs a concept from part 14 in part 3 is invisible to review at
   122 units.

   Failure output is human, not a stack trace:

```
VOCABULARY  01-names #6 One level deep: solution uses comprehension before the reader has met it
```

3. **Prompt-length floor.** `if len(prompt.split()) < 15: die(... "prompt is too
   short to be a prompt")`. Rust checks nothing about the brief.

4. **Glossary definition floor.** `if len(text.split()) < 8: die(... "too short
   to be a definition")`.

5. **Drill shape.** Exactly 15, at least 3 options, exactly one `(x)`, and a
   mandatory `> ` explanation. Rust checks the count; Python checks all four.

6. **Partial-unit detection**, added in commit `09ed866`:

```python
# A unit with some of its three parts but not all of them is a defect, not
# work in progress: it renders links to pages that are not there.
partial = [e["slug"] for e in track
           if any((e["hasNote"], e["hasEx"], e["hasDrills"]))
           and not all((e["hasNote"], e["hasEx"], e["hasDrills"]))]
```

   Prints `INCOMPLETE <slug>: no drills` and returns exit code 1. The build still
   writes the data, so you can preview, but CI fails.

### Bugs fixed in Python that still exist in Rust

**a) Word-count check after the JSON is written.** In Rust `build_units()`:

```python
(OUT / "unit" / f"{slug}.json").write_text(json.dumps(unit))   # line 472
units[slug] = unit
lo, hi = NOTE_WORDS
if not lo <= w <= hi:                                          # line 475
    raise ValueError(f"{path.name}: {w:,} words, ...")
```

The file is on disk before the length is checked, so a failed build leaves a
half-updated `data/` behind. Python checks inside `parse_unit()`, and every unit
is parsed (`units = {p: parse_unit(p) for p in ...}`) before **any** write
happens. **Fixed.**

**b) Guessing the judge from the code's shape.** Documented in the source:

```python
# The judge travels with the @expect declaration. Guessing it back
# from the shape of the code was wrong for B006, which looks like an
# exception name, and would be wrong again for the next such code.
```

**c) Re-parsing content once per consumer.** Rust globs `content/` separately for
each output. Python parses once:

```python
# Parse each file once. The JSON dump, the errors index and the search index
# all want the same parsed result, and re-globbing meant every validation and
# every regex ran two or three times per build.
units = {p: parse_unit(p) for p in sorted(CONTENT.glob("units/*.md"))}
exercises = {p: parse_exercises(p) for p in sorted(CONTENT.glob("ex/*.md"))}
```

**d) Solutions shipped to the browser.** The last commit, `28a3fcb`, "Stop
shipping solutions":

```python
# The book gives hints and never answers. Shipping the solutions to the
# browser would put every one of them a single fetch away, so they stay
# in content/ where --validate can still compile and run them.
shipped = [{k: v for k, v in e.items() if k != "solution"} for e in ex]
```

Rust ships `solution` inside `data/ex/*.json`. Anyone who opens devtools has
every answer. **Fixed in Python, still open in Rust.**

**e) The search index missing half the book.** Python indexes the diagnose prose:

```python
# the diagnose prose is where an exercise's substance is; indexing
# only the prompt makes half the book unsearchable
body = " ".join([ex["prompt"], *ex["hints"], *ex["diagnose"].values()])
```

### The unknown-`@directive` bug: still present in Rust, mitigated in Python

Rust:

```python
DIRECTIVE = re.compile(r"^@(\w+)(?:\s+(.*))?$")
...
d = DIRECTIVE.match(s)
if d:
    key, val = ...
    if key in ("kind", "concept"): ...
    elif key == "expect": ...
    elif key == "hint": ...
    elif key == "diagnose": ...
    elif key == "after": ...
    i += 1        # <- unknown key falls through to here
    continue
```

A typo'd `@dignose` matches the regex, hits no branch, and is silently dropped.
Still a bug in the Rust one.

Python:

```python
DIRECTIVE = re.compile(r"^@(expect|hint|diagnose)[ \t]+(.+)$", re.M)
```

The directive names are baked into the pattern, so `@dignose foo` does not match
and is **not** stripped from the prompt — it survives into `ex["prompt"]` and
renders as visible literal text on the page. Better (you see it), but still not a
build failure. **Fix properly in the new handbook:** match `^@(\w+)` and `die()`
on any name not in the known set.

### Things Rust does that Python dropped, and probably should not have

- **`llms.txt`** and the `for LLMs` copy button. Genuinely useful and cheap.
- **A build-time markdown renderer.** Rust renders markdown to HTML in `build.py`
  and ships HTML. Python ships raw markdown and renders it in `app.js` with a
  100-line `md()`. Python's choice makes the note body directly searchable and
  keeps one renderer, but it means every reader pays the parse. Either is
  defensible; Python's is fewer moving parts.
- **A diagnostic cache.** Rust's `cache_key` / `carry` / `cache_split` machinery
  avoids recompiling unchanged exercises during `--validate`. Python re-runs
  everything, which is affordable at ruff/mypy speed and would not be with four
  hardware backends. **Take Rust's cache design, not Python's absence of one.**
- **`@after`**, the post-solution prose. Worth keeping.

---

## 4. UI differences

### Views the Rust one lacks

| view | route | notes |
|---|---|---|
| **Errors index** | `#/errors` | Every `@diagnose` in the book, grouped by judge, each card linking to the exercise that raises it. Generated, so it cannot drift. Rust has no such page. |
| **Progress** | `#/progress` | Notes read, exercises passed, **hints needed**, drill sets done, day streak with a best. Plus a scoped "Erase all progress". |
| **Glossary with a letter index** | `#/glossary/:letter` | `[[term]]` cross-links become clickable tags. |
| **Search as a route** | `#/search/:q` | Debounced, URL-addressable, scored, with `<mark>` highlighting and a `…`-trimmed excerpt around the first hit. Rust's search is a header box. |

`#/errors` is the one to steal. It converts a per-exercise teaching artifact into
a standalone reference at zero extra authoring cost, and the generated-ness is
the guarantee.

### Interactions the Rust one lacks

- **A collapsible contents rail**, persisted, that keeps the spine and drops the
  words rather than disappearing:

```css
/* Collapsed keeps the spine and loses the words: you keep the map and lose only
   the labels, which is very different from losing the contents entirely. */
.rail.collapsed a { font-size: 0; padding: 0.42rem 0; }
```

- **A soft-wrap toggle** in the editor toolbar, persisted, with the gutter
  correctly hidden when wrapping (a number per logical line stops lining up the
  moment a line takes two rows).
- **Auto-indent on Enter**, Python-aware:

```js
/* Does this line open a block? A colon only counts when it is real code and
   every bracket on the line is closed, so that `# TODO: later` and a dict
   broken across lines do not earn an indent they would choke on. */
const opensBlock = line => {
  const code = line.replace(/(['"])(?:\\.|(?!\1).)*\1/g, "").replace(/#.*$/, "");
  const depth = (code.match(/[([{]/g) || []).length - (code.match(/[)\]}]/g) || []).length;
  return depth <= 0 && /:\s*$/.test(code);
};
```

  Rust's is `/[{([]\s*$/` on the raw line, which indents after a `// {` comment.

- **Backspace to the previous tab stop**, guarded so `cmd`/`alt` Backspace still
  do delete-to-line-start and delete-word.
- **Edits through `execCommand("insertText")` so the native undo stack survives**:

```js
/* Assigning to ta.value from script clears the textarea's native undo stack
   in every browser. Enter happens on every line, so doing that here would
   quietly cost the reader Ctrl+Z. execCommand("insertText") edits through the
   browser's own undo machinery and fires an input event on the way. */
```

  Rust uses `setRangeText`, which preserves undo in Chrome and Firefox but not
  reliably elsewhere; Python's is the more careful choice and the comment names
  the reason.
- **A reset that restores the *starter*, not the opened value:**

```js
// Back to the exercise's starter, NOT to whatever the editor happened to
// open with: after an edit and a reload those are the same value, and reset
// would hand back the edit it was asked to discard.
reset: () => { ta.value = starter; vim.sync(); paint(); },
```

  Rust's `reset() { this.set(starter); }` closes over the value passed at mount,
  which after a `localStorage` restore is the learner's edit. **This is a live bug
  in the Rust one.**
- **Per-exercise code persistence** keyed `ph.code.<slug>.<n>`, restored on
  return. Rust does not save the editor buffer.
- **Vim: `$` sticks to the end of the line** across `j`/`k`, which is real Vim
  behaviour Rust's implementation lacks. Five new tests cover it.

### CSS the Rust one lacks

- **A nine-step fluid type scale** with a hard rule enforced by convention:

```css
/* nine fluid sizes. no font-size ever appears inside a media query. */
--t-micro: clamp(10.5px, 0.1vw + 10.2px, 11.5px);
...
--t-h1: clamp(32px, 3.4vw + 21px, 60px);
```

- **A coarse-pointer media query** for touch targets, keyed on the pointer rather
  than the viewport:

```css
/* Touch targets. A 23px toolbar button is fine to click with a mouse and close
   to unusable with a thumb, so the small controls grow on any coarse pointer.
   Keyed on the pointer rather than the width: a small window on a laptop still
   has a mouse, and a large tablet still has fingers. */
@media (pointer: coarse) { .ed-toolbar .btn { min-height: 40px; ... } }
```

- **`prefers-reduced-motion` honoured globally**, one rule, last in the file.
- **`overflow-x: clip` rather than `hidden`**, with the reason:

```css
/* clip, never hidden: `hidden` makes body a scroll container and every
   sticky descendant then sticks to body, which means it never sticks. */
html, body { overflow-x: clip; }
```

- **`font-size: 16px` on the editor as a functional requirement**, not a style
  choice: "iOS Safari zooms the viewport on focus for anything smaller, and does
  not zoom back."
- **A running indicator that animates only opacity on a pseudo-element**, so the
  compositor handles it without repainting the editor each frame.
- **A scrollable table wrapper**, so a wide table scrolls itself rather than the
  page.
- **Explicit ordering discipline in the responsive block:**

```css
/* a media query adds no specificity, so every rule below must sit after the
   rule it overrides. these are last in the file on purpose. */
```

### The four known Rust bugs, checked here

| bug | status in Python |
|---|---|
| duplicated `@keyframes tick` (Rust `app.css` lines 712 and 1309) | **absent.** No `tick` keyframe, and all five keyframes (`rise`, `breathe`, `washout`, `pulse`, `stamp`) are defined exactly once. |
| unthemed `.btn:hover { background: #ff7a35 }` (Rust line 349) | **fixed.** `.btn:hover { filter: brightness(1.06); }` — accent-agnostic and correct in both themes. The file header states the rule: "Every colour in this file lives in the two `:root` blocks below and nowhere else", and grep confirms it holds. |
| word-count check raising after the JSON is written | **fixed.** See §3(a). |
| unknown `@directive` silently swallowed | **mitigated, not fixed.** See §3. |

### A new bug, introduced in Python's HEAD commit

`assets/app.js` lines 436–457. A paste accident in commit `39bb185` dropped a
copy of the footer-versions block *inside* the "Erase all progress" click
handler:

```js
$("#reset").onclick = () => {
  if (confirm("Erase every note read, exercise passed and saved snippet?")) {
    Object.keys(localStorage)
      .filter(k => k === "ph.progress" || k.startsWith("ph.code."))
      .forEach(k => localStorage.removeItem(k));

// The footer states which judges the book was verified against. Rendered from
// data/judges.json so it cannot claim a version nothing pins.
load("judges").then(j => {
  const el = $("#footversions");
  if (!el) return;
  el.innerHTML = `Built and verified against CPython ${esc(j.cpython.version)} and `
    + `ruff ${esc(j.ruff.version)}, with mypy installed from PyPI at run time.<br>` + el.innerHTML;
}).catch(() => {});

route();
  }
};
```

The block at the bottom of the file (lines 709–718) is byte-identical. Effect:
pressing Erase re-runs the footer render and **prepends the versions sentence a
second time**, so the footer accumulates a duplicate line. The erase itself still
works and `route()` still fires, so it is cosmetic — but it is exactly the class
of thing `test_views.mjs` catches in the Rust repo and Python has no such test.
That is not a coincidence; see §5.

### One more difference: modules instead of a global

Rust loads four plain `<script>` tags and wraps the workbench in an IIFE
assigned to a global, with the reason in the header comment:

```js
 * Exposed as one global, `WB`, because index.html loads plain scripts in order
 * and two files sharing a top-level `const esc` would be a redeclaration error.
```

Python uses ES modules with `modulepreload`, so `esc`, `inline`, `cached`,
`flag` and `setFlag` are imported by name and the redeclaration problem does not
exist. `inline()` in particular is defined once and used by the notes, the
exercise prompts, the diagnose readings, the hints, the drills and the glossary,
with a one-line comment: "One definition: a second copy drifts." No build step
is required for either approach.

---

## 5. Testing

### What exists

| repo | file | lines | covers |
|---|---|---:|---|
| Rust | `test_build.py` | 408 | the fence reader, nested fences, directives, the manifest |
| Rust | `test_views.mjs` | 383 | every view function against a stubbed DOM |
| Rust | `test_vim.mjs` | 323 | vim motions, operators, counts, text objects, undo |
| Rust | `test_workbench.mjs` | 61 | the diagnostic parser |
| Python | `test_frontend.mjs` | 32 | the tokenizer only |
| Python | `test_vim.mjs` | 330 | vim, ported, plus 5 new tests for sticky `$` |

**On unit tests alone Rust is stronger.** Python has no `test_build.py` and no
`test_views.mjs`, and the missing `test_views.mjs` is why the paste bug in §4
shipped.

### What Python has instead

`release.sh` — "Every check this project has, in one command" — is a better
*harness* than anything in the Rust repo:

```
./release.sh --check        everything that runs offline
./release.sh --check --net  the above, plus every starter and solution
                            compiled and run past ruff, mypy and CPython
```

Six steps: build; **assert `data/` is not stale** (`git diff --quiet -- data/`);
tokenizer test; vim test; parse every content file and run the vocabulary gate;
then optionally `--validate`.

The stale-data check is the sharpest idea:

```bash
git diff --quiet -- data/ && echo "   data/ matches content/" || {
  echo "   data/ is out of date; commit the rebuilt JSON with your content change"; fail=1; }
```

Because `data/` is committed (the site is static and needs it), a content change
without a rebuild would ship a site that disagrees with its source. One line of
git makes that impossible.

The batching in step five is also worth copying:

```bash
# One interpreter for every content file: build.py --check per file meant fifty
# starts, each re-importing the whole module and its tables. --check on an
# exercise already runs the vocabulary gate, so there is no second step.
```

And `--validate` batches at the tool level for the same reason:

```python
"""ruff and mypy cost almost nothing per file and a great deal per invocation,
so both run once over the whole set rather than once per snippet. CPython has
to stay one process per snippet, since each one runs arbitrary code, but they
are independent and go through a thread pool."""
```

### The `test_frontend.mjs` philosophy

32 lines, and the header states the standard: "Smallest thing that fails if the
tokenizer breaks." The checks that earn their place are the negative ones:

```js
// a # inside a string is not a comment
assert.ok(!hl('s = "# no"').includes("tk-com"), "# inside a string became a comment");
// html in source must be escaped, never emitted raw
assert.ok(!hl("x = '<script>'").includes("<script>"), "source html was not escaped");
// round trip: stripping tags must give back the source (plus the escaping)
const back = hl(src).replace(/<[^>]+>/g, "")...;
assert.equal(back, src, "tokenizer lost or duplicated characters");
```

The round-trip property test is the single highest-value check in either repo's
frontend tests: it catches any character the tokenizer drops or doubles, for any
input, without enumerating cases.

### Verdict

Python's approach is **stronger where it matters most and weaker where it is
cheapest to fix**. `--validate` proves the *content* is honest — that every
starter really fails, that every judge complaint has prose, that every solution
is clean. That is a class of guarantee Rust's `--validate` only partly reaches
and no amount of unit testing substitutes for. But Python threw away
`test_views.mjs`, and immediately paid for it.

For the new handbook: take Python's `release.sh` and `--validate` design, and
keep Rust's `test_views.mjs` stubbed-DOM approach. They are not alternatives.
