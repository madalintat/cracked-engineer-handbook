#!/usr/bin/env python3
"""Tests for the content pipeline. No network, runs in under a second.

Run: python3 test_build.py
"""

import re
import sys

import build
import prose
import track

FAILED = []


def check(name, fn):
    try:
        fn()
        print(f"  ok    {name}")
    except AssertionError as e:
        FAILED.append(name)
        print(f"  FAIL  {name}: {e}")
    except Exception as e:
        FAILED.append(name)
        print(f"  ERROR {name}: {type(e).__name__}: {e}")


def ex_file(body, n=build.N_EXERCISES, backend="godbolt"):
    """A file with n exercises, the first being `body`."""
    spec = ('```spec\n{"chip": "Not", "inputs": ["a"], "outputs": ["out"], '
            '"table": [[0,1],[1,0]]}\n```\n') if backend == "sim" else ""
    filler = """
## Filler {i}
A brief that says something real about the exercise at hand.
@concept placeholder
@expect match /error: something/
@hint Look at the line the compiler points at.
@diagnose d match /error: something/
The compiler could not find the name you used.
```starter
int main(){}
```
```solution
int main(){return 0;}
```
""" + spec
    rest = "".join(filler.replace("{i}", str(i)) for i in range(2, n + 1))
    return "## First\n" + body + rest


GOOD = """A real brief explaining what the reader has to do here.
@kind compile-error
@concept Moving out of a value leaves nothing behind.
@backend godbolt
@flags -O2 -Wall
@expect match /error: use of moved value/
@hint The compiler is telling you where the value went.
@diagnose moved match /error: use of moved value/
You gave the value away on the line above, so this line has nothing to read.
@diagnose borrow match /error: cannot borrow/
Two names wanted write access to the same value at the same time.
@after Now the value is copied instead of moved.
```starter
int main(){ return oops; }
```
```tests
assert(f() == 3);
```
```solution
int main(){ return 0; }
```
"""


# ------------------------------------------------------------------ the grammar

def t_parses_a_good_exercise():
    ex = build.parse_exercises(ex_file(GOOD), "t", "godbolt")
    assert len(ex) == build.N_EXERCISES, len(ex)
    e = ex[0]
    assert e["title"] == "First"
    assert e["kind"] == "compile-error"
    assert e["backend"] == "godbolt"
    assert e["flags"] == "-O2 -Wall"
    assert e["expect"] == [{"judge": "match", "key": "/error: use of moved value/"}]
    assert len(e["hints"]) == 1
    assert [d["id"] for d in e["diagnose"]] == ["moved", "borrow"]
    assert "gave the value away" in e["diagnose"][0]["prose"]
    assert "oops" in e["starter"]
    assert "assert" in e["tests"]
    assert "return 0" in e["solution"]
    assert "copied instead of moved" in e["after"]


def t_diagnose_order_is_preserved():
    """First match wins, so the authored order is the semantics."""
    ex = build.parse_exercises(ex_file(GOOD), "t", "godbolt")
    ids = [d["id"] for d in ex[0]["diagnose"]]
    assert ids == ["moved", "borrow"], ids


def t_diagnose_prose_does_not_leak_into_the_brief():
    """The reference implementation had this exact bug: a fence inside
    @diagnose leaked into the brief and gave the answer away."""
    body = GOOD.replace(
        "You gave the value away on the line above, so this line has nothing to read.",
        "You gave the value away.\n```\nlet b = a;  // here\n```\nThat is the move.")
    ex = build.parse_exercises(ex_file(body), "t", "godbolt")
    e = ex[0]
    assert "let b = a" in e["diagnose"][0]["prose"]
    assert "let b = a" not in e["brief"], "diagnose fence leaked into the brief"


SPEC = """```spec
{"chip": "Not", "inputs": ["a"], "outputs": ["out"],
 "table": [[0,1],[1,0]], "minGates": 1}
```
"""


def t_backend_defaults_to_the_unit():
    body = GOOD.replace("@backend godbolt\n", "") + SPEC
    ex = build.parse_exercises(ex_file(body, backend="sim"), "t", "sim")
    assert ex[0]["backend"] == "sim", ex[0]["backend"]
    assert ex[0]["spec"]["chip"] == "Not"


def t_sim_without_a_spec_is_an_error():
    expect_problem(ex_file(GOOD.replace("@backend godbolt", "@backend sim")),
                   "needs a ```spec block")


def t_spec_outside_sim_is_an_error():
    expect_problem(ex_file(GOOD + SPEC),
                   "only means something on the sim backend")


def t_spec_table_must_be_exhaustive():
    short = SPEC.replace('"table": [[0,1],[1,0]]', '"table": [[0,1]]')
    body = GOOD.replace("@backend godbolt", "@backend sim") + short
    expect_problem(ex_file(body, backend="sim"), "must be exhaustive", default="sim")


def t_spec_row_width_is_checked():
    bad = SPEC.replace('"table": [[0,1],[1,0]]', '"table": [[0,1,1],[1,0,0]]')
    body = GOOD.replace("@backend godbolt", "@backend sim") + bad
    expect_problem(ex_file(body, backend="sim"), "want 1 inputs plus 1 outputs",
                   default="sim")


def t_spec_rejects_a_repeated_input_row():
    dup = SPEC.replace('"table": [[0,1],[1,0]]', '"table": [[0,1],[0,0]]')
    body = GOOD.replace("@backend godbolt", "@backend sim") + dup
    expect_problem(ex_file(body, backend="sim"), "repeats the input row",
                   default="sim")


def t_spec_rejects_an_impossible_gate_budget():
    imp = SPEC.replace('"minGates": 1', '"minGates": 4, "maxGates": 2')
    body = GOOD.replace("@backend godbolt", "@backend sim") + imp
    expect_problem(ex_file(body, backend="sim"), "below minGates", default="sim")


def t_spec_must_be_valid_json():
    body = (GOOD.replace("@backend godbolt", "@backend sim")
            + "```spec\n{not json}\n```\n")
    expect_problem(ex_file(body, backend="sim"), "not valid JSON", default="sim")


# -------------------------------------------------------------- the error cases

def expect_problem(text, needle, default="godbolt"):
    try:
        build.parse_exercises(text, "t", default)
    except build.BuildError as e:
        assert needle in str(e), f"wanted {needle!r} in:\n{e}"
        return
    raise AssertionError(f"no error raised; expected {needle!r}")


def t_unknown_directive_is_an_error():
    """The reference silently swallows these. This one must not."""
    expect_problem(ex_file(GOOD + "@nosuchthing hello\n"), "unknown directive @nosuchthing")


def t_wrong_exercise_count_is_an_error():
    expect_problem(ex_file(GOOD, n=3), "3 exercises, expected 8")


def t_match_must_be_a_regex():
    expect_problem(ex_file(GOOD.replace("@expect match /error: use of moved value/",
                                        "@expect match error: use of moved value")),
                   "match takes a /regex/")


def t_judge_must_be_named():
    expect_problem(ex_file(GOOD.replace("@expect match /error: use of moved value/",
                                        "@expect /error: use of moved value/")),
                   "judge must be one of")


def t_unknown_verdict_is_an_error():
    """A verdict must exist in its backend's vocabulary."""
    expect_problem(ex_file(GOOD
        .replace("@expect match /error: use of moved value/", "@expect verdict banana")
        .replace("@diagnose moved match /error: use of moved value/",
                 "@diagnose moved verdict banana")),
        "is not a godbolt verdict")


def t_verdict_from_the_wrong_backend_is_an_error():
    """`cycle` is a sim verdict; it means nothing on godbolt."""
    expect_problem(ex_file(GOOD
        .replace("@expect match /error: use of moved value/", "@expect verdict cycle")
        .replace("@diagnose moved match /error: use of moved value/",
                 "@diagnose moved verdict cycle")),
        "is not a godbolt verdict")


def t_silent_is_a_verdict():
    body = (GOOD.replace("@expect match /error: use of moved value/", "@expect silent")
                .replace("@diagnose moved match /error: use of moved value/",
                         "@diagnose moved silent"))
    ex = build.parse_exercises(ex_file(body), "t", "godbolt")
    assert ex[0]["expect"] == [{"judge": "silent", "key": ""}], ex[0]["expect"]


def t_expect_without_a_diagnose_is_an_error():
    """Every way the starter can fail needs prose, or the reader gets an error
    the handbook has nothing to say about."""
    body = GOOD.replace("@diagnose moved match /error: use of moved value/\n"
                        "You gave the value away on the line above, so this line has nothing to read.\n", "")
    expect_problem(ex_file(body), "has no matching @diagnose")


def t_solution_never_reaches_the_browser():
    import json, shutil, pathlib as _p
    manifest, units = build.build(strict=False)
    for f in (build.DATA / "ex").glob("*.json"):
        blob = f.read_text()
        assert '"solution"' not in blob, f"{f.name} ships the solution"


def t_broken_regex_is_caught_at_build_time():
    expect_problem(ex_file(GOOD.replace("/error: use of moved value/", "/error: ([unclosed/")),
                   "does not compile")


def t_diagnose_without_prose_is_an_error():
    body = GOOD.replace(
        "@diagnose borrow match /error: cannot borrow/\n"
        "Two names wanted write access to the same value at the same time.\n",
        "@diagnose borrow match /error: cannot borrow/\n")
    expect_problem(ex_file(body), "has no explanation")


def t_duplicate_diagnose_id_is_an_error():
    expect_problem(ex_file(GOOD.replace("@diagnose borrow", "@diagnose moved")),
                   "duplicate @diagnose id")


def t_missing_solution_is_an_error():
    body = GOOD.replace("```solution\nint main(){ return 0; }\n```", "")
    expect_problem(ex_file(body), "no solution block")


def t_gpu_outside_modal_is_an_error():
    expect_problem(ex_file(GOOD + "@gpu sm_100a\n"),
                   "only means something on the modal backend")


def t_prose_lint_runs_on_the_brief():
    body = GOOD.replace("A real brief explaining what the reader has to do here.",
                        "Let's dive into the vibrant tapestry of moves.")
    expect_problem(ex_file(body), "AI-tell")


# --------------------------------------------------------------------- drills

DRILL = """## What does {i} do to the accumulator when the exponent differs?
- [ ] Nothing at all happens to it
- [x] It is rescaled by the exponent difference
- [ ] It overflows immediately
@why The running maximum changes, so every earlier term needs the same factor.
"""


def t_drills_parse():
    text = "".join(DRILL.replace("{i}", str(i)) for i in range(build.N_DRILLS))
    d = build.parse_drills(text, "t")
    assert len(d) == build.N_DRILLS
    assert d[0]["correct"] == 1
    assert len(d[0]["options"]) == 3
    assert "running maximum" in d[0]["why"]


def t_drill_without_answer_is_an_error():
    text = "".join(DRILL.replace("{i}", str(i)) for i in range(build.N_DRILLS)).replace("[x]", "[ ]")
    try:
        build.parse_drills(text, "t")
        raise AssertionError("no error raised")
    except build.BuildError as e:
        assert "no option marked" in str(e), e


def t_drill_with_two_answers_is_an_error():
    one = DRILL.replace("- [ ] Nothing at all happens to it",
                        "- [x] Nothing at all happens to it")
    text = one.replace("{i}", "0") + "".join(DRILL.replace("{i}", str(i)) for i in range(1, build.N_DRILLS))
    try:
        build.parse_drills(text, "t")
        raise AssertionError("no error raised")
    except build.BuildError as e:
        assert "more than one correct" in str(e), e


# ------------------------------------------------------------------- markdown

def t_render_basics():
    h, heads = build.render(
        "## A heading here\n\nSome *text* with `code`.\n\n"
        "```c\nint x = 1;\n```\n\n- one\n- two\n\n"
        "| a | b |\n|---|---|\n| 1 | 2 |\n")
    assert '<h2 id="a-heading-here">' in h
    assert "<em>text</em>" in h and "<code>code</code>" in h
    assert 'data-lang="c"' in h and "int x = 1;" in h
    assert "<li>one</li>" in h
    assert "<table>" in h and "<td>1</td>" in h
    assert heads == [{"id": "a-heading-here", "text": "A heading here", "level": 2}]


def t_render_escapes_html():
    h, _ = build.render("A < B and `a && b`\n")
    assert "&lt;" in h
    assert "<script>" not in build.render("<script>alert(1)</script>\n")[0]


def t_word_count_includes_code():
    h, _ = build.render("Some prose here.\n\n```\none two three four\n```\n")
    assert build.word_count(h) >= 7, build.word_count(h)


def t_front_matter():
    meta, body = build.split_front_matter(
        "---\nneeds: [nand, feedback]\nminutes: 40\n---\nBody text.\n", "t")
    assert meta["needs"] == ["nand", "feedback"]
    assert meta["minutes"] == "40"
    assert body.strip() == "Body text."


# --------------------------------------------------------------------- track

def t_track_is_clean():
    assert track.validate()


def t_every_part_has_units_and_a_report():
    for p in track.PARTS:
        assert any(u[1] == p[0] for u in track.TRACK), f"part {p[0]} has no units"
        assert p[5], f"part {p[0]} cites no research"


def t_build_emits_a_stub_for_every_track_entry():
    manifest, _ = build.build(strict=False)
    assert len(manifest) == len(track.TRACK)
    assert {u["slug"] for u in manifest} == {u[0] for u in track.TRACK}


def main():
    tests = [(k[2:], v) for k, v in sorted(globals().items())
             if k.startswith("t_") and callable(v)]
    print(f"running {len(tests)} tests\n")
    for name, fn in tests:
        check(name, fn)
    print()
    if FAILED:
        print(f"{len(FAILED)} failed: {', '.join(FAILED)}")
        return 1
    print(f"all {len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
