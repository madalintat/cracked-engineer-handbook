"""Contrast of the palette, computed from assets/app.css rather than asserted.

The colours in app.css are the single source of truth, so this reads them back
out and measures them. It catches the regression that matters: someone nudges
a grey to taste and quietly drops body text below the legal floor.

What it cannot see is which ground a token is used on. That is what the
browser audit in tools/audit-contrast.js is for; this file locks the pairs we
already know about so the browser pass has less to find.
"""

import re
from pathlib import Path

CSS = Path(__file__).parent / "assets" / "app.css"

# WCAG 2.1 contrast minima.
AA_TEXT = 4.5      # normal-size text
AA_LARGE = 3.0     # >=24px, or >=18.66px bold


def _srgb(v):
    v /= 255.0
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def luminance(hex_colour):
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _srgb(r) + 0.7152 * _srgb(g) + 0.0722 * _srgb(b)


def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def blend(fg, bg, alpha):
    """fg laid over bg at alpha, which is what color-mix(..., transparent) is."""
    f = [int(fg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    b = [int(bg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    return "#%02x%02x%02x" % tuple(
        round(b[i] + (f[i] - b[i]) * alpha) for i in range(3))


def _block(css, selector):
    """The declarations of one rule, as {name: value}, var() unresolved."""
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\n\}", css, re.S)
    if not m:
        raise AssertionError(f"no {selector} block in app.css")
    body = re.sub(r"/\*.*?\*/", "", m.group(1), flags=re.S)
    return dict(re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", body))


def palette(theme="light"):
    """Every custom property for a theme, with var() chains resolved."""
    css = CSS.read_text()
    out = _block(css, ":root")
    if theme == "dark":
        out.update(_block(css, ':root[data-theme="dark"]'))
    for _ in range(6):                      # resolve var() chains
        changed = False
        for k, v in list(out.items()):
            m = re.fullmatch(r"var\((--[a-z0-9-]+)\)", v.strip())
            if m and m.group(1) in out:
                out[k], changed = out[m.group(1)], True
        if not changed:
            break
    return {k: v.strip() for k, v in out.items()
            if re.fullmatch(r"#[0-9a-f]{3,8}", v.strip(), re.I)}


# (token, ground, minimum). The ground is the surface the token is used on;
# where a token sits on several, the darkest one in light mode and the
# lightest in dark mode is the one that has to pass.
PAIRS = [
    ("--ink",       "--bg",       AA_TEXT),
    ("--ink-2",     "--bg",       AA_TEXT),
    ("--ink-3",     "--bg",       AA_TEXT),
    ("--ink-4",     "--bg",       AA_TEXT),
    ("--ink-2",     "--raised",   AA_TEXT),   # badges
    ("--ink-2",     "--surface",  AA_TEXT),   # cards
    ("--ink-3",     "--surface",  AA_TEXT),
    ("--accent-ink", "--bg",      AA_TEXT),   # links
    ("--accent-ink", "--surface", AA_TEXT),
    ("--btn-ink",   "--accent-ink", AA_TEXT), # a button's label on its ground
    ("--code-ink",  "--code-bg",  AA_TEXT),
    ("--tok-kw",    "--code-bg",  AA_TEXT),
    ("--tok-str",   "--code-bg",  AA_TEXT),
    ("--tok-num",   "--code-bg",  AA_TEXT),
    ("--tok-com",   "--code-bg",  AA_TEXT),
    ("--tok-fn",    "--code-bg",  AA_TEXT),
    ("--tok-type",  "--code-bg",  AA_TEXT),
    ("--tok-punc",  "--code-bg",  AA_TEXT),
    ("--tok-pre",   "--code-bg",  AA_TEXT),
]

# Badges tint their own colour over the page at a fixed alpha, so the ground
# is a blend and has to be computed rather than looked up.
TINTED = [
    ("--ok-ink",  "--ok",  0.16, "--bg", AA_TEXT),
    ("--ok-ink",  "--ok",  0.14, "--bg", AA_TEXT),
    ("--bad-ink", "--bad", 0.14, "--bg", AA_TEXT),
]

# Each phase owns an accent, and every one of them is used for text.
ACCENT_INKS = ["--gold-ink", "--copper-ink", "--clay-ink", "--azure-ink",
               "--violet-ink", "--jade-ink", "--slate-ink"]


def check(theme):
    p = palette(theme)
    problems = []
    for fg, bg, need in PAIRS:
        if fg not in p or bg not in p:
            problems.append(f"{theme}: {fg} or {bg} is not a literal colour")
            continue
        r = ratio(p[fg], p[bg])
        if r < need:
            problems.append(
                f"{theme}: {fg} ({p[fg]}) on {bg} ({p[bg]}) is {r:.2f}:1, "
                f"want {need}")
    for ink in ACCENT_INKS:
        for bg in ("--bg", "--surface"):
            r = ratio(p[ink], p[bg])
            if r < AA_TEXT:
                problems.append(
                    f"{theme}: {ink} ({p[ink]}) on {bg} is {r:.2f}:1, "
                    f"want {AA_TEXT}")
    for fg, tint, alpha, over, need in TINTED:
        ground = blend(p[tint], p[over], alpha)
        r = ratio(p[fg], ground)
        if r < need:
            problems.append(
                f"{theme}: {fg} ({p[fg]}) on {tint} at {alpha:.0%} over {over} "
                f"({ground}) is {r:.2f}:1, want {need}")
    return problems


def report():
    problems = check("light") + check("dark")
    for line in problems:
        print("  " + line)
    return problems


if __name__ == "__main__":
    import sys
    bad = report()
    if bad:
        print(f"\n{len(bad)} contrast problem(s)")
        sys.exit(1)
    for theme in ("light", "dark"):
        p = palette(theme)
        print(f"{theme}: {len(PAIRS) + len(ACCENT_INKS) * 2 + len(TINTED)} "
              f"pairs pass, ink scale "
              + " ".join(f"{k[2:]}={ratio(p[k], p['--bg']):.1f}"
                         for k in ("--ink", "--ink-2", "--ink-3", "--ink-4")))
