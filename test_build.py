#!/usr/bin/env python3
"""Tests for the content pipeline. No network, runs in under a second.

Run: python3 test_build.py
"""

import re
import sys

import build
import contrast
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
@lang cpp
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
    if backend == "sim":
        filler = filler.replace("@lang cpp\n", "")
    rest = "".join(filler.replace("{i}", str(i)) for i in range(2, n + 1))
    return "## First\n" + body + rest


GOOD = """A real brief explaining what the reader has to do here.
@kind compile-error
@concept Moving out of a value leaves nothing behind.
@backend godbolt
@lang cpp
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
    body = GOOD.replace("@backend godbolt\n", "").replace("@lang cpp\n", "") + SPEC
    ex = build.parse_exercises(ex_file(body, backend="sim"), "t", "sim")
    assert ex[0]["backend"] == "sim", ex[0]["backend"]
    assert ex[0]["spec"]["chip"] == "Not"


def t_sim_without_a_spec_is_an_error():
    expect_problem(ex_file(GOOD.replace("@backend godbolt", "@backend sim").replace("@lang cpp\n", "")),
                   "needs a ```spec block")


def t_spec_on_a_backend_that_has_none_is_an_error():
    expect_problem(ex_file(GOOD + SPEC),
                   "means something only on the sim and yosys backends")


YSPEC = """```spec
{"top": "m", "cells": {"$_DFF_P_": 2}}
```
"""


def t_yosys_needs_a_spec():
    body = (GOOD.replace("@backend godbolt", "@backend yosys")
                .replace("@lang cpp", "@lang verilog"))
    expect_problem(ex_file(body), "the yosys backend needs a ```spec block")


def t_a_yosys_spec_must_assert_something():
    body = (GOOD.replace("@backend godbolt", "@backend yosys")
                .replace("@lang cpp", "@lang verilog")
            + '```spec\n{"top": "m"}\n```\n')
    expect_problem(ex_file(body), "spec asserts nothing")


def t_yosys_cell_names_are_checked():
    body = (GOOD.replace("@backend godbolt", "@backend yosys")
                .replace("@lang cpp", "@lang verilog")
            + '```spec\n{"top": "m", "cells": {"DFF": 2}}\n```\n')
    expect_problem(ex_file(body), "is not a yosys cell name")


def t_a_good_yosys_spec_parses():
    body = (GOOD.replace("@backend godbolt", "@backend yosys")
                .replace("@lang cpp", "@lang verilog") + YSPEC)
    ex = build.parse_exercises(ex_file(body), "t", "godbolt")
    assert ex[0]["backend"] == "yosys"
    assert ex[0]["lang"] == "verilog"
    assert ex[0]["spec"]["cells"] == {"$_DFF_P_": 2}


def t_spec_table_must_be_exhaustive():
    short = SPEC.replace('"table": [[0,1],[1,0]]', '"table": [[0,1]]')
    body = GOOD.replace("@backend godbolt", "@backend sim").replace("@lang cpp\n", "") + short
    expect_problem(ex_file(body, backend="sim"), "must be exhaustive", default="sim")


def t_spec_row_width_is_checked():
    bad = SPEC.replace('"table": [[0,1],[1,0]]', '"table": [[0,1,1],[1,0,0]]')
    body = GOOD.replace("@backend godbolt", "@backend sim").replace("@lang cpp\n", "") + bad
    expect_problem(ex_file(body, backend="sim"), "want 1 inputs plus 1 outputs",
                   default="sim")


def t_spec_rejects_a_repeated_input_row():
    dup = SPEC.replace('"table": [[0,1],[1,0]]', '"table": [[0,1],[0,0]]')
    body = GOOD.replace("@backend godbolt", "@backend sim").replace("@lang cpp\n", "") + dup
    expect_problem(ex_file(body, backend="sim"), "repeats the input row",
                   default="sim")


def t_spec_rejects_an_impossible_gate_budget():
    imp = SPEC.replace('"minGates": 1', '"minGates": 4, "maxGates": 2')
    body = GOOD.replace("@backend godbolt", "@backend sim").replace("@lang cpp\n", "") + imp
    expect_problem(ex_file(body, backend="sim"), "below minGates", default="sim")


def t_spec_must_be_valid_json():
    body = (GOOD.replace("@backend godbolt", "@backend sim").replace("@lang cpp\n", "")
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
                   "means something only on the modal backend")


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


def t_a_wrapped_drill_question_is_joined_not_dropped():
    """Two questions in the first unit lost half their text this way, and the
    build said nothing."""
    wrapped = """## The checker reports your gate count beside a known minimum.
Why does it not fail you for exceeding it?
- [ ] Because gate counts vary between simulators and are unreliable
- [x] Because correctness and efficiency are separate questions
- [ ] Because the stated minimum is only an estimate
@why Conflating the two teaches the wrong lesson about circuits.
"""
    text = wrapped + "".join(DRILL.replace("{i}", str(i))
                             for i in range(build.N_DRILLS - 1))
    d = build.parse_drills(text, "t")
    assert d[0]["q"].endswith("for exceeding it?"), d[0]["q"]
    assert d[0]["q"].startswith("The checker reports"), d[0]["q"]
    assert len(d[0]["options"]) == 3


def t_a_truncated_question_is_an_error():
    bad = """## This question just stops
- [ ] one wrong option here
- [x] the right option here
- [ ] another wrong option
@why Because it is.
"""
    text = bad + "".join(DRILL.replace("{i}", str(i))
                         for i in range(build.N_DRILLS - 1))
    try:
        build.parse_drills(text, "t")
        raise AssertionError("no error raised")
    except build.BuildError as e:
        assert "probably cut off" in str(e), e


def t_identical_options_are_an_error():
    dup = """## Which is it?
- [ ] the same text
- [x] the right one
- [ ] the same text
@why Because.
"""
    text = dup + "".join(DRILL.replace("{i}", str(i))
                         for i in range(build.N_DRILLS - 1))
    try:
        build.parse_drills(text, "t")
        raise AssertionError("no error raised")
    except build.BuildError as e:
        assert "identical" in str(e), e


def t_the_real_nand_content_builds_strictly():
    """The first unit is the format's reference. If it needs --lax, the format
    is wrong or the content is."""
    import pathlib as _p
    if not (build.CONTENT / "units" / "nand.md").exists():
        return
    manifest, units = build.build(strict=True)
    u = next(x for x in manifest if x["slug"] == "nand")
    assert u["ready"], "nand should be ready"
    assert u["exercises"] == build.N_EXERCISES, u["exercises"]
    assert u["drills"] == build.N_DRILLS, u["drills"]
    assert build.NOTE_WORDS[0] <= u["words"] <= build.NOTE_WORDS[1], u["words"]


def t_lang_is_required_where_a_backend_has_several():
    expect_problem(ex_file(GOOD.replace("@lang cpp\n", "")),
                   "@lang is required on the godbolt backend")


def t_lang_must_belong_to_the_backend():
    expect_problem(ex_file(GOOD.replace("@lang cpp", "@lang verilog")),
                   "is not a language the godbolt backend checks")


def t_lang_is_inferred_where_a_backend_has_only_one():
    body = (GOOD.replace("@backend godbolt\n", "").replace("@lang cpp\n", "")
            + SPEC)
    ex = build.parse_exercises(ex_file(body, backend="sim"), "t", "sim")
    assert ex[0]["lang"] == "netlist", ex[0]["lang"]


def t_the_real_integers_content_builds_strictly():
    if not (build.CONTENT / "units" / "integers.md").exists():
        return
    manifest, _ = build.build(strict=True)
    u = next(x for x in manifest if x["slug"] == "integers")
    assert u["ready"] and u["exercises"] == 8 and u["drills"] == 15, u


# ------------------------------------------------------------- gpu eligibility

def t_compute_capability_eligibility():
    """The picker greys out cards that cannot run an exercise, and getting
    this wrong sends a learner to a cheaper GPU that fails with a PTX error."""
    cases = [
        # the trap: RTX-PRO-6000 is sm_120 at $3.03 against B200 sm_100a at $6.25
        ("sm_100a", "sm_120",  False),
        ("sm_100a", "sm_103a", True),   # compute_100f covers 10.0 and 10.3
        ("sm_103a", "sm_100a", False),  # but not backwards
        ("sm_120",  "sm_121",  True),   # compute_120f covers 12.0 and 12.1
        ("sm_121",  "sm_120",  False),
        # the `a` suffix means that capability and nothing else, ever
        ("sm_90a",  "sm_100a", False),
        ("sm_90a",  "sm_90a",  True),
        # base capabilities JIT forward, including across majors
        ("sm_75",   "sm_90a",  True),
        ("sm_75",   "sm_120",  True),
        ("sm_80",   "sm_100a", True),
        # and never backwards
        ("sm_86",   "sm_80",   False),
        ("sm_89",   "sm_86",   False),
    ]
    for req, av, want in cases:
        got = build.sm_satisfies(req, av)
        assert got == want, f"{req} on {av}: got {got}, want {want}"


def t_the_gpu_catalog_is_well_formed():
    cat = build.load_gpu_catalog()
    assert len(cat["gpus"]) >= 10, len(cat["gpus"])
    prices = [g["price_per_hour"] for g in cat["gpus"]]
    assert prices == sorted(prices), "the catalog should be cheapest first"
    for g in cat["gpus"]:
        assert g["smMin"] in build.SM_ORDER, g
        assert g["vram_gb"] > 0 and g["price_per_hour"] > 0, g
    # the specific card that makes the gate necessary
    rtx = next(g for g in cat["gpus"] if g["id"] == "rtx-pro-6000")
    assert rtx["smMin"] == "sm_120", rtx
    assert not build.sm_satisfies("sm_100a", rtx["smMin"])


def t_a_modal_exercise_must_declare_its_gpu():
    body = (GOOD.replace("@backend godbolt", "@backend modal")
                .replace("@lang cpp", "@lang cuda"))
    expect_problem(ex_file(body), "must declare @gpu")


def t_an_unknown_gpu_target_is_an_error():
    body = (GOOD.replace("@backend godbolt", "@backend modal")
                .replace("@lang cpp", "@lang cuda") + "@gpu sm_999\n")
    expect_problem(ex_file(body), "is not a compute capability")


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


def t_author_markdown_reaches_the_browser_as_html():
    """A hint saying `INT_MAX` must arrive as code, not as backticks."""
    body = GOOD.replace("@concept Moving out of a value leaves nothing behind.",
                        "@concept The `move` leaves nothing behind.")
    body = body.replace("@hint The compiler is telling you where the value went.",
                        "@hint The checks pass `INT_MAX`.")
    ex = build.parse_exercises(ex_file(body), "t", "godbolt")
    assert "<code>move</code>" in ex[0]["concept"], ex[0]["concept"]
    assert "<code>INT_MAX</code>" in ex[0]["hints"][0], ex[0]["hints"]


def t_inline_markup_still_escapes_html():
    """The browser inserts these without escaping, so the build must escape."""
    one = ("## Does `a <= b` hold, and <script>?\n\n- [x] yes <b>\n- [ ] no\n"
           "- [ ] maybe\n@why Because it does, for the reason given here.\n")
    filler = ("## Filler question {i} that ends in a question mark?\n\n"
              "- [x] the right one\n- [ ] a wrong one\n- [ ] another wrong one\n"
              "@why Because that is how it works, as explained here.\n")
    d = build.parse_drills(
        one + "".join(filler.replace("{i}", str(i))
                      for i in range(2, build.N_DRILLS + 1)), "t")
    assert "&lt;script&gt;" in d[0]["q"], d[0]["q"]
    assert "&lt;=" in d[0]["q"]
    assert "<script>" not in d[0]["q"]
    assert "&lt;b&gt;" in d[0]["options"][0]


def t_a_wrapped_prose_directive_keeps_its_second_line():
    body = GOOD.replace("@concept Moving out of a value leaves nothing behind.",
                        "@concept Moving out of a value\nleaves nothing behind.")
    ex = build.parse_exercises(ex_file(body), "t", "godbolt")
    assert ex[0]["concept"] == "Moving out of a value leaves nothing behind.", \
        ex[0]["concept"]
    assert "leaves nothing behind" not in ex[0]["brief"], ex[0]["brief"]


def t_prose_attached_to_nothing_is_an_error():
    """It used to be appended to the description, silently."""
    body = GOOD.replace("@flags -O2 -Wall",
                        "@flags -O2 -Wall\n\nan orphan sentence")
    try:
        build.parse_exercises(ex_file(body), "t", "godbolt")
    except build.BuildError as e:
        assert "attached to nothing" in str(e), str(e)
    else:
        assert False, "orphan prose after a directive was accepted"


def t_the_palette_clears_wcag_aa():
    problems = contrast.check("light") + contrast.check("dark")
    assert not problems, "\n  " + "\n  ".join(problems)


def t_the_contrast_check_can_actually_fail():
    """A check that cannot fail is decoration."""
    saved = contrast.PAIRS
    try:
        contrast.PAIRS = [("--ink-4", "--bg", 99.0)]
        assert contrast.check("light"), "the contrast check passed an impossible bar"
    finally:
        contrast.PAIRS = saved


def t_every_part_has_units_and_a_report():
    for p in track.PARTS:
        assert any(u[1] == p[0] for u in track.TRACK), f"part {p[0]} has no units"
        assert p[4], f"part {p[0]} cites no research"


def t_accent_comes_from_the_phase_and_nowhere_else():
    """A part must not carry its own colour, or the two can disagree."""
    for p in track.PARTS:
        assert len(p) == 5 and isinstance(p[4], list), (
            f"part {p[0]} has an extra field; an accent slot would let a part "
            f"disagree with its phase")
        assert track.accent_of(p[0]) in track.ACCENTS


def t_phases_cover_the_parts_exactly_once_in_track_order():
    listed = [pid for ph in track.PHASES for pid in ph[4]]
    assert listed == [p[0] for p in track.PARTS], (
        "the phases must list the parts in track order")
    assert len({ph[3] for ph in track.PHASES}) == len(track.PHASES), (
        "two phases share an accent")


def t_a_part_in_two_phases_is_an_error():
    saved = track.PHASES
    try:
        first, second, *rest = saved
        track.PHASES = [first,
                        (second[0], second[1], second[2], second[3],
                         second[4] + (first[4][0],))] + rest
        try:
            track.validate()
        except ValueError as e:
            assert "more than one phase" in str(e)
        else:
            assert False, "a part in two phases was accepted"
    finally:
        track.PHASES = saved


def t_needs_must_point_backwards():
    """A prerequisite that comes later is a broken track, not a hint."""
    manifest, _ = build.build(strict=False)
    order = {u["slug"]: u["num"] for u in manifest}
    for u in manifest:
        for n in u.get("needs", []):
            assert order[n] < u["num"], f"{u['slug']} needs later unit {n}"


def t_reverse_edges_match_forward_edges():
    manifest, _ = build.build(strict=False)
    fwd = {u["slug"]: set(u.get("needs", [])) for u in manifest}
    for u in manifest:
        for dep in u["neededBy"]:
            assert u["slug"] in fwd[dep], (
                f"{dep} is listed as needing {u['slug']} but does not")
        expected = {s for s, ns in fwd.items() if u["slug"] in ns}
        assert set(u["neededBy"]) == expected


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
