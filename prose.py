"""Prose lint for every word a reader sees.

Unit notes, exercise briefs, hints, diagnose explanations, track blurbs and UI
copy all go through `lint()`. The build fails on any finding, which is the point:
a style rule nobody enforces is a style rule nobody follows.

The rules come from the humanizer skill (Wikipedia's "Signs of AI writing"),
narrowed to the ones that can be checked mechanically without false positives on
technical prose. Rules that need judgement, such as rule-of-three overuse or
undue emphasis on significance, are left to the author.

Run `python3 prose.py` for the self-check.
"""

import re

# Words that are near-certain tells in this register. Deliberately short:
# every entry here has been checked against the existing research corpus so it
# does not fire on legitimate technical usage. "key" and "critical" are absent
# because "key schedule" and "critical path" are real terms of art.
AI_WORDS = [
    "delve", "tapestry", "testament", "underscores", "underscoring",
    "showcasing", "showcases", "vibrant", "boasts", "nestled",
    "groundbreaking", "breathtaking", "must-visit", "renowned",
    "seamless", "seamlessly", "leverage the", "robust and", "cutting-edge",
    "in today's", "ever-evolving", "evolving landscape", "at its core",
    "the real question is", "it is important to note",
    "let's dive", "let's explore", "without further ado",
    "i hope this helps", "would you like", "here's what you need to know",
]

# Phrases that announce rather than say.
SIGNPOSTS = [
    "in order to", "due to the fact that", "at this point in time",
    "has the ability to", "it should be noted that",
]

FILLER_FIX = {
    "in order to": "to",
    "due to the fact that": "because",
    "at this point in time": "now",
    "has the ability to": "can",
}


def _repeated_phrase(text, min_words=3):
    """Catch a phrase duplicated close to itself.

    This exists because a careless search-and-replace across a wrapped string
    literal produced 'Everything else is written in else is written in' and it
    took a human read to notice. A machine should notice.

    Digits are part of a word here. Without them, two sentences whose only
    difference is numeric collapse into one repeated phrase, and parallel
    structure like "When a is 0 ... When a is 1 ..." is ordinary technical
    prose. A lint that fires on legitimate writing gets switched off.
    """
    words = re.findall(r"[a-z0-9']+", text.lower())
    for n in range(min_words, min(8, len(words) // 2 + 1)):
        for i in range(len(words) - 2 * n + 1):
            a = words[i:i + n]
            b = words[i + n:i + 2 * n]
            if a != b:
                continue
            # A repeated run of pure numbers is data: a truth table, a column
            # of measurements, a bit pattern. Only a repeat containing real
            # words is evidence of a botched edit.
            if sum(1 for w in a if w[0].isalpha()) < 2:
                continue
            return " ".join(a)
    return None


# Code is not prose. A listing legitimately repeats lines, uses hyphens, and
# contains words the list below would flag. Strip it before linting rather than
# teaching authors to word their code around a style checker.
_CODE = re.compile(r"<pre\b[^>]*>.*?</pre>|<code\b[^>]*>.*?</code>",
                   re.S | re.I)


def strip_code(html):
    return _CODE.sub(" ", html)


def lint(text, where="text", code_is_prose=True):
    """Return a list of findings. Empty list means clean.

    `code_is_prose=False` strips fenced and inline code first, for anything
    rendered from markdown.
    """
    if not code_is_prose:
        text = strip_code(text)
    out = []
    low = text.lower()

    for ch, name in ((chr(0x2014), "em dash"), (chr(0x2013), "en dash")):
        if ch in text:
            out.append(f"{where}: {name} present, use a period, comma or colon")

    for ch, name in ((chr(0x201C), "curly quote"), (chr(0x201D), "curly quote"),
                     (chr(0x2018), "curly apostrophe"), (chr(0x2019), "curly apostrophe")):
        if ch in text:
            out.append(f"{where}: {name} present, use a straight one")

    if re.search(r"[\U0001F300-\U0001FAFF☀-➿]", text):
        out.append(f"{where}: emoji present")

    for w in AI_WORDS:
        if w in low:
            out.append(f"{where}: AI-tell word {w!r}")

    for w in SIGNPOSTS:
        if w in low:
            fix = FILLER_FIX.get(w)
            hint = f", say {fix!r}" if fix else ""
            out.append(f"{where}: filler {w!r}{hint}")

    dup = _repeated_phrase(text)
    if dup:
        out.append(f"{where}: phrase repeated back to back: {dup!r}")

    # A heading that restates itself in the next line, or title case in a heading.
    for line in text.splitlines():
        if line.startswith("#"):
            head = line.lstrip("#").strip()
            words = [w for w in head.split() if w[:1].isalpha()]
            if len(words) > 3 and all(w[0].isupper() for w in words[1:]):
                out.append(f"{where}: title case in heading {head!r}")

    return out


def check_title(title, where):
    """Titles are sentence case: capital on the first word and on names only.

    The heuristic: if more than half the words after the first start with a
    capital and the title is longer than three words, it is title case. Names
    like CUDA, GEMM, FlashAttention and IEEE-754 are common in these titles, so
    a bare "any capital" test would fire constantly. An all-caps token counts as
    an acronym rather than as evidence.
    """
    out = lint(title, where)
    if not title.strip():
        out.append(f"{where}: empty title")
        return out
    if title.rstrip().endswith("."):
        out.append(f"{where}: title ends in a full stop")
    words = [w.strip("(),:") for w in title.split()]
    words = [w for w in words if w and w[0].isalpha()]
    if len(words) > 3:
        rest = words[1:]
        capped = [w for w in rest if w[0].isupper() and not w.isupper()]
        if len(capped) > len(rest) / 2:
            out.append(f"{where}: looks like title case, use sentence case")
    return out


def check_blurb(blurb, where):
    """Track and unit blurbs have extra shape rules."""
    out = lint(blurb, where)
    if not blurb.strip():
        out.append(f"{where}: empty")
        return out
    if not blurb.rstrip().endswith((".", "?", "!")):
        out.append(f"{where}: does not end in a full stop")
    n = len(blurb.split())
    if n < 8:
        out.append(f"{where}: {n} words, too short to say anything")
    if n > 45:
        out.append(f"{where}: {n} words, too long for a blurb")
    if re.search(r"\b(\w+)\s+\1\b", blurb, re.I):
        out.append(f"{where}: doubled word")
    return out


def _selfcheck():
    bad = "This delves into the vibrant tapestry — in order to showcase it."
    got = lint(bad, "t")
    assert any("em dash" in g for g in got), got
    assert any("delve" in g for g in got), got
    assert any("in order to" in g for g in got), got

    dup = "Everything else is written in else is written in."
    assert any("repeated back to back" in g for g in lint(dup, "t")), lint(dup, "t")

    # Parallel structure separated only by numbers is not a repeat.
    parallel = "When a is 0, NAND(0,0) is 1. When a is 1, NAND(1,1) is 0."
    assert lint(parallel, "t") == [], lint(parallel, "t")
    parallel2 = ("The L1 hit costs 4 cycles. The L2 hit costs 14 cycles. "
                 "The DRAM hit costs 300 cycles.")
    assert lint(parallel2, "t") == [], lint(parallel2, "t")

    # A truth table is data, not a botched edit.
    table = "a b NAND 0 0 1 0 1 1 1 0 1 1 1 0"
    assert lint(table, "t") == [], lint(table, "t")
    bits = "The pattern is 1011 1011 1011 repeated across the word."
    assert lint(bits, "t") == [], lint(bits, "t")

    clean = ("A transistor is a switch you close with a voltage instead of a "
             "finger, and it is not a perfect switch. Both halves matter.")
    assert lint(clean, "t") == [], lint(clean, "t")
    assert check_blurb(clean, "t") == [], check_blurb(clean, "t")

    assert any("full stop" in g for g in check_blurb("no full stop here at all ok", "t"))
    assert any("too short" in g for g in check_blurb("Too short.", "t"))
    assert any("doubled word" in g for g in
               check_blurb("The the clock is a contract about garbage timing.", "t"))

    # Code is not prose and must not be linted as such.
    listing = ("<p>Both emit this:</p><pre><code>xor eax, eax\n"
               "xor eax, eax</code></pre><p>Which is the same instruction.</p>")
    assert lint(listing, "t", code_is_prose=False) == [], \
        lint(listing, "t", code_is_prose=False)
    assert any("repeated" in g for g in lint(listing, "t")), \
        "with code_is_prose=True the repeat should still be seen"
    dashy = "<p>Fine.</p><pre><code>a -- b</code></pre>"
    assert lint(dashy, "t", code_is_prose=False) == []
    # but prose around the code is still linted
    bad = "<p>Let's dive in.</p><pre><code>ok</code></pre>"
    assert any("dive" in g for g in lint(bad, "t", code_is_prose=False))

    # Terms of art must not trip the word list.
    assert any("title case" in g for g in
               check_title("A Heading In Title Case Here", "t"))
    for ok in ("The switch", "Online softmax and FlashAttention",
               "Coalescing", "The clock and the shared bus",
               "Naive to tiled GEMM", "DNS, HTTP and TLS"):
        assert check_title(ok, "t") == [], (ok, check_title(ok, "t"))

    for ok in ("the key schedule is derived with HKDF and then used",
               "the critical path sets your maximum clock frequency here",
               "a robust design tolerates a single bit flip without failing"):
        assert lint(ok, "t") == [], (ok, lint(ok, "t"))

    print("prose.py: all self-checks pass")


if __name__ == "__main__":
    _selfcheck()
