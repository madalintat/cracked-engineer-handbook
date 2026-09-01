"""Diagrams, authored as data and rendered to inline SVG at build time.

Why not an image: a PNG cannot follow the theme, cannot be searched, cannot be
read by a screen reader, and goes stale the moment the number in it changes.
Why not a runtime library: this is a static site with no build step in the
browser, and a diagram that needs JavaScript to appear is a diagram that is
missing when JavaScript fails.

So a figure is JSON in the note, and the build turns it into SVG that uses the
same custom properties as everything else. It themes, it scales, it selects,
and the accessible description is written by the author rather than generated.

Four kinds, chosen because the written units need exactly these:

    bits    a register or word divided into labelled fields
    gates   a logic circuit, drawn from explicit positions
    timing  a waveform, one row per signal
    blocks  boxes and arrows, for anything structural

Every renderer returns a complete <figure> element. Coordinates are in a
virtual grid; the viewBox is computed, so a figure is resolution independent
and the author never writes a pixel.
"""

import html
import json
import re

# One place for the geometry, so figures of different kinds line up when they
# sit next to each other in a note.
GRID = 22          # one grid step, in user units
PAD = 14           # padding inside the viewBox
FONT = 12          # label size, in user units
FONT_SM = 10


class FigureError(ValueError):
    """A figure that cannot be drawn. Always names the figure and the reason."""


def esc(s):
    return html.escape(str(s), quote=True)


def _need(spec, key, where, kind=type(None)):
    if key not in spec:
        raise FigureError(f"{where}: a {spec.get('kind','?')} figure needs {key!r}")
    v = spec[key]
    if kind is not type(None) and not isinstance(v, kind):
        raise FigureError(
            f"{where}: {key!r} should be {kind.__name__}, got {type(v).__name__}")
    return v


def _accent(name, where):
    """A figure may tint one element. It names a token, never a colour.

    The result is used in a `style` attribute, never as a presentation
    attribute like `fill=` or `stroke=`. A presentation attribute loses to any
    CSS declaration, so `stroke="..."` on an element that also carries a class
    setting `stroke` is silently ignored, and every accented waveform came out
    the same colour.
    """
    if name is None:
        return "var(--accent)"
    if not re.fullmatch(r"[a-z][a-z0-9-]*", str(name)):
        raise FigureError(f"{where}: accent {name!r} is not a token name")
    if name in ("ok", "warn", "bad"):
        return f"var(--{name})"
    return f"var(--{name}-ink, var(--accent))"


def _text(x, y, s, cls="fg", size=FONT, anchor="middle", weight=None, mono=False):
    w = f' font-weight="{weight}"' if weight else ""
    f = ' class="mono"' if mono else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" '
            f'text-anchor="{anchor}" class="fig-{cls}{" mono" if mono else ""}"'
            f'{w}>{esc(s)}</text>')


# ------------------------------------------------------------------- bits

def _bits(spec, where):
    """A word divided into labelled fields, drawn right to left like a number.

    Bit 0 is on the right, because that is where it is in every diagram in
    every manual, and a figure that disagrees with the manuals is worse than
    no figure.
    """
    width = int(_need(spec, "bits", where, int))
    if width < 2 or width > 128:
        raise FigureError(f"{where}: bits is {width}, want 2 to 128")
    groups = _need(spec, "groups", where, list)
    if not groups:
        raise FigureError(f"{where}: a bits figure with no groups shows nothing")

    cell = max(6.0, min(GRID, 640.0 / width))
    W = width * cell
    brackets = spec.get("brackets", [])
    h_top = FONT + 8                      # bit numbers
    h_bar = GRID + 6
    # Only reserve lane space for lanes that carry something. A figure with no
    # notes should not leave a band of empty diagram under the word.
    used = {int(g.get("lane", 0)) for g in groups if g.get("note")}
    used |= {int(b.get("lane", 0)) for b in brackets}
    h_lanes = (max(used) + 1) * (FONT + 14) + 6 if used else 0

    H = h_top + h_bar + h_lanes
    out = [f'<svg viewBox="{-PAD} {-PAD} {W + PAD * 2:.1f} {H + PAD * 2:.1f}" '
           f'class="fig-svg" role="img" preserveAspectRatio="xMidYMid meet">']

    # the word itself
    out.append(f'<rect x="0" y="{h_top}" width="{W:.1f}" height="{h_bar}" '
               f'rx="3" class="fig-panel"/>')

    seen = set()
    for g in groups:
        lo, hi = int(_need(g, "from", where, int)), int(_need(g, "to", where, int))
        if lo > hi:
            lo, hi = hi, lo
        if hi >= width:
            raise FigureError(f"{where}: bit {hi} is outside a {width}-bit word")
        for b in range(lo, hi + 1):
            if b in seen:
                raise FigureError(f"{where}: bit {b} is in two groups")
            seen.add(b)
        # bit 0 on the right
        x = (width - 1 - hi) * cell
        w = (hi - lo + 1) * cell
        col = _accent(g.get("accent"), where)
        out.append(f'<rect x="{x:.1f}" y="{h_top}" width="{w:.1f}" '
                   f'height="{h_bar}" rx="3" class="fig-field" '
                   f'style="fill:{col};stroke:{col}"/>')
        label = g.get("label", "")
        if label:
            out.append(_text(x + w / 2, h_top + h_bar / 2 + FONT * 0.36, label,
                             size=FONT if w > 34 else FONT_SM, mono=True,
                             weight=600))
        note = g.get("note")
        if note:
            lane = int(g.get("lane", 0))
            y = h_top + h_bar + (lane + 1) * (FONT + 12) - 6
            out.append(f'<line x1="{x + w / 2:.1f}" y1="{h_top + h_bar}" '
                       f'x2="{x + w / 2:.1f}" y2="{y - FONT + 2:.1f}" '
                       f'class="fig-rule"/>')
            out.append(_text(x + w / 2, y, note, cls="dim", size=FONT_SM))

    # A bracket spans several fields. Nested names like ax inside eax inside
    # rax are not fields side by side, they are ranges over the same bits, and
    # drawing them as fields says something false about the register.
    for br in brackets:
        lo, hi = int(_need(br, "from", where, int)), int(_need(br, "to", where, int))
        if lo > hi:
            lo, hi = hi, lo
        if hi >= width:
            raise FigureError(f"{where}: bracket ends at bit {hi}, outside a "
                              f"{width}-bit word")
        x = (width - 1 - hi) * cell
        w = (hi - lo + 1) * cell
        lane = int(br.get("lane", 0))
        y = h_top + h_bar + lane * (FONT + 14) + 12
        col = _accent(br.get("accent"), where) if br.get("accent") else None
        st = f' style="stroke:{col}"' if col else ""
        out.append(f'<path d="M{x:.1f} {y - 5:.1f} V{y:.1f} H{x + w:.1f} '
                   f'V{y - 5:.1f}" class="fig-bracket"{st}/>')
        if br.get("label"):
            out.append(_text(x + w / 2, y + FONT + 1, br["label"],
                             cls="dim", size=FONT_SM, mono=bool(br.get("mono"))))

    # Bit numbers at the ends and at every field boundary. Two adjacent bits,
    # 31 and 32 at the edge of a field, land a few pixels apart and print as
    # "3231". Place them right to left and drop any that would collide, which
    # keeps the outermost of each pair: the one that labels the wider field.
    marks = {0, width - 1}
    for g in groups:
        marks.add(int(g["from"])); marks.add(int(g["to"]))
    min_gap = FONT_SM * 1.5
    placed = []
    for b in sorted(marks, reverse=True):          # left to right on screen
        x = (width - 1 - b) * cell + cell / 2
        if placed and x - placed[-1] < min_gap:
            continue
        placed.append(x)
        out.append(_text(x, h_top - 6, b, cls="dim", size=FONT_SM, mono=True))

    out.append("</svg>")
    return "".join(out)


# ------------------------------------------------------------------ gates

_GATE_W, _GATE_H = 46, 34


def _gate_shape(kind, x, y, where):
    """The body of one gate, at its top-left corner."""
    w, h = _GATE_W, _GATE_H
    if kind in ("nand", "and"):
        d = (f"M{x} {y} L{x + w * 0.45} {y} "
             f"A {h / 2} {h / 2} 0 0 1 {x + w * 0.45} {y + h} L{x} {y + h} Z")
    elif kind in ("nor", "or", "xor", "xnor"):
        d = (f"M{x} {y} Q{x + w * 0.55} {y + h / 2} {x} {y + h} "
             f"Q{x + w * 0.5} {y + h * 0.92} {x + w} {y + h / 2} "
             f"Q{x + w * 0.5} {y + h * 0.08} {x} {y} Z")
    elif kind in ("not", "buf"):
        d = f"M{x} {y} L{x + w * 0.78} {y + h / 2} L{x} {y + h} Z"
    elif kind == "box":
        d = None
    else:
        raise FigureError(f"{where}: unknown gate {kind!r}")
    if d is None:
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" '
                f'class="fig-gate"/>')
    return f'<path d="{d}" class="fig-gate"/>'


def _gates(spec, where):
    """A logic circuit on a column grid.

    Routing is the whole difficulty. A wire drawn as "across, down, across" at
    the midpoint puts every wire leaving the same column on the same vertical
    line and through whatever gate is in the way, which produces a picture that
    is technically correct and unreadable. Each wire gets its own vertical
    channel in the gap between columns instead, so parallel runs stay apart and
    nothing crosses a gate body.
    """
    nodes = _need(spec, "nodes", where, list)
    wires = spec.get("wires", [])
    COL, ROW = GRID * 4, GRID * 2
    by_id, maxx, maxy = {}, 0, 0
    for n in nodes:
        nid = _need(n, "id", where, str)
        if nid in by_id:
            raise FigureError(f"{where}: two nodes share the id {nid!r}")
        by_id[nid] = n
        maxx = max(maxx, int(n.get("x", 0)))
        maxy = max(maxy, int(n.get("y", 0)))

    def bubble(t):
        return 7 if t in ("nand", "nor", "not", "xnor") else 0

    def port(nid, side):
        n = by_id.get(nid)
        if n is None:
            raise FigureError(f"{where}: a wire names the unknown node {nid!r}")
        x, y = int(n.get("x", 0)) * COL, int(n.get("y", 0)) * ROW
        t = n.get("type", "box")
        if t in ("in", "out"):
            return (x + (34 if side == "r" else 0), y + _GATE_H / 2)
        if side == "r":
            return (x + _GATE_W + bubble(t), y + _GATE_H / 2)
        return (x, y + _GATE_H / 2)

    # Wires leaving the same column share a gap, so spread them across it.
    lanes = {}
    for w_ in wires:
        src = by_id.get(w_.get("from"))
        if src is None:
            raise FigureError(
                f"{where}: a wire names the unknown node {w_.get('from')!r}")
        lanes.setdefault(int(src.get("x", 0)), []).append(w_)

    W = (maxx + 1) * COL + 12
    H = (maxy + 1) * ROW + 6
    out = [f'<svg viewBox="{-PAD} {-PAD} {W + PAD * 2} {H + PAD * 2}" '
           f'class="fig-svg" role="img" preserveAspectRatio="xMidYMid meet">']

    for col, group in sorted(lanes.items()):
        src_right = col * COL + _GATE_W + 10
        gap = (col + 1) * COL - src_right - 6
        step = gap / (len(group) + 1)
        for k, w_ in enumerate(group, start=1):
            a = port(w_["from"], "r")
            b = port(_need(w_, "to", where, str), "l")
            cx = src_right + step * k
            if abs(a[1] - b[1]) < 0.5:              # straight across
                d = f"M{a[0]:.1f} {a[1]:.1f} H{b[0]:.1f}"
            else:
                d = (f"M{a[0]:.1f} {a[1]:.1f} H{cx:.1f} "
                     f"V{b[1]:.1f} H{b[0]:.1f}")
            out.append(f'<path d="{d}" class="fig-wire"/>')
            # A junction dot where a wire leaves a source that feeds several,
            # which is how a reader tells fan-out from a crossing.
            if len(group) > 1:
                out.append(f'<circle cx="{a[0]:.1f}" cy="{a[1]:.1f}" r="2.4" '
                           f'class="fig-junction"/>')
            if w_.get("label"):
                out.append(_text(cx, min(a[1], b[1]) - 7, w_["label"],
                                 cls="dim", size=FONT_SM, mono=True))

    for n in nodes:
        x, y = int(n.get("x", 0)) * COL, int(n.get("y", 0)) * ROW
        t = n.get("type", "box")
        lbl = n.get("label", n["id"])
        if t in ("in", "out"):
            out.append(_text(x + (0 if t == "in" else 34), y + _GATE_H / 2 + 4,
                             lbl, anchor="start" if t == "in" else "end",
                             mono=True, weight=600))
            continue
        out.append(_gate_shape(t, x, y, where))
        if bubble(t):
            out.append(f'<circle cx="{x + _GATE_W + 3.5}" '
                       f'cy="{y + _GATE_H / 2}" r="3.5" class="fig-gate"/>')
        out.append(_text(x + _GATE_W * 0.42, y + _GATE_H / 2 + 4, lbl,
                         size=FONT_SM, weight=600))
    out.append("</svg>")
    return "".join(out)


# ----------------------------------------------------------------- timing

def _timing(spec, where):
    """One row per signal. A wave is a string, one character per cycle.

        0 low   1 high   . hold the previous level   x unknown   p a clock
    """
    signals = _need(spec, "signals", where, list)
    if not signals:
        raise FigureError(f"{where}: a timing figure with no signals shows nothing")
    n = max(len(s.get("wave", "")) for s in signals)
    if n == 0:
        raise FigureError(f"{where}: every wave is empty")

    cw, rh, lw = GRID * 1.6, GRID * 1.6, 74
    W, H = lw + n * cw, len(signals) * rh
    out = [f'<svg viewBox="{-PAD} {-PAD} {W + PAD * 2:.0f} {H + PAD * 2:.0f}" '
           f'class="fig-svg" role="img" preserveAspectRatio="xMidYMid meet">']

    for c in range(n + 1):
        x = lw + c * cw
        out.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{H:.0f}" '
                   f'class="fig-grid"/>')

    for i, sig in enumerate(signals):
        y0 = i * rh + 4
        hi, lo = y0 + 4, y0 + rh - 12
        name = sig.get("name", f"s{i}")
        out.append(_text(lw - 10, y0 + rh / 2, name, anchor="end",
                         size=FONT_SM, mono=True, cls="dim"))
        wave = sig.get("wave", "")
        col = _accent(sig.get("accent"), where) if sig.get("accent") else None
        style = f' style="stroke:{col}"' if col else ""
        prev, d = None, []
        for c, ch in enumerate(wave):
            if ch == ".":
                ch = prev if prev else "0"
            if ch == "p":
                ch = "1" if c % 2 == 0 else "0"
            if ch not in "01x":
                raise FigureError(
                    f"{where}: {name!r} has {ch!r} in its wave, want 0 1 . x or p")
            x = lw + c * cw
            y = hi if ch == "1" else lo
            if prev is None:
                d.append(f"M{x:.1f} {y:.1f}")
            elif ch != prev:
                d.append(f"L{x:.1f} {hi if prev == '1' else lo:.1f}")
                d.append(f"L{x:.1f} {y:.1f}")
            d.append(f"L{x + cw:.1f} {y:.1f}")
            if ch == "x":
                out.append(f'<rect x="{x:.1f}" y="{hi:.1f}" width="{cw:.1f}" '
                           f'height="{lo - hi:.1f}" class="fig-unknown"/>')
            prev = ch
        out.append(f'<path d="{"".join(d)}" class="fig-wave"{style}/>')

    for mark in spec.get("marks", []):
        c = int(_need(mark, "at", where, int))
        x = lw + c * cw
        out.append(f'<line x1="{x:.1f}" y1="-4" x2="{x:.1f}" y2="{H + 4:.0f}" '
                   f'class="fig-mark"/>')
        if mark.get("label"):
            out.append(_text(x, -8, mark["label"], cls="accent", size=FONT_SM))
    out.append("</svg>")
    return "".join(out)


# ----------------------------------------------------------------- blocks

def _blocks(spec, where):
    boxes = _need(spec, "boxes", where, list)
    arrows = spec.get("arrows", [])
    by_id = {}
    for b in boxes:
        bid = _need(b, "id", where, str)
        if bid in by_id:
            raise FigureError(f"{where}: two boxes share the id {bid!r}")
        by_id[bid] = b

    U = GRID * 2
    def geom(b):
        # Fractional, so a caller can tighten a tall chain without the
        # renderer needing a scale knob. A grid of whole units is a default,
        # not a constraint.
        return (float(b.get("x", 0)) * U, float(b.get("y", 0)) * U,
                float(b.get("w", 3)) * U, float(b.get("h", 2)) * U)

    W = max((geom(b)[0] + geom(b)[2]) for b in boxes)
    H = max((geom(b)[1] + geom(b)[3]) for b in boxes)
    W, H = round(W), round(H)
    out = [f'<svg viewBox="{-PAD} {-PAD - 6} {W + PAD * 2} {H + PAD * 2 + 6}" '
           f'class="fig-svg" role="img" preserveAspectRatio="xMidYMid meet">',
           '<defs><marker id="fig-arrow" viewBox="0 0 10 10" refX="9" refY="5" '
           'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
           '<path d="M0 0 L10 5 L0 10 z" class="fig-head"/></marker></defs>']

    for a in arrows:
        s, t = by_id.get(a.get("from")), by_id.get(a.get("to"))
        if s is None or t is None:
            raise FigureError(
                f"{where}: an arrow names an unknown box "
                f"({a.get('from')!r} to {a.get('to')!r})")
        sx, sy, sw, sh = geom(s)
        tx, ty, tw, th = geom(t)
        if abs((sy + sh / 2) - (ty + th / 2)) < 4:            # side by side
            x1, y1 = (sx + sw, sy + sh / 2) if tx > sx else (sx, sy + sh / 2)
            x2, y2 = (tx, ty + th / 2) if tx > sx else (tx + tw, ty + th / 2)
        else:                                                  # stacked
            x1, y1 = sx + sw / 2, (sy + sh) if ty > sy else sy
            x2, y2 = tx + tw / 2, ty if ty > sy else ty + th
        out.append(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" '
                   f'y2="{y2:.0f}" class="fig-arrow" '
                   f'marker-end="url(#fig-arrow)"/>')
        if a.get("label"):
            # Beside a vertical arrow, above a horizontal one. Centring a label
            # on a vertical line puts half of it on the wrong side of the
            # diagram.
            vertical = abs(x2 - x1) < abs(y2 - y1)
            if vertical:
                out.append(_text(x1 + 8, (y1 + y2) / 2 + 4, a["label"],
                                 cls="dim", size=FONT_SM, anchor="start"))
            else:
                out.append(_text((x1 + x2) / 2, (y1 + y2) / 2 - 6, a["label"],
                                 cls="dim", size=FONT_SM))

    for b in boxes:
        x, y, w, h = geom(b)
        col = _accent(b.get("accent"), where) if b.get("accent") else None
        cls = "fig-box fig-box-tint" if col else "fig-box"
        st = f' style="fill:{col};stroke:{col}"' if col else ""
        out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" '
                   f'height="{h:.1f}" rx="4" class="{cls}"{st}/>')
        label, sub = b.get("label", b["id"]), b.get("sub")
        cy = y + h / 2 + (0 if not sub else -5)
        out.append(_text(x + w / 2, cy + 4, label, size=FONT, weight=600,
                         mono=bool(b.get("mono"))))
        if sub:
            out.append(_text(x + w / 2, cy + FONT + 8, sub, cls="dim",
                             size=FONT_SM))
    out.append("</svg>")
    return "".join(out)


# ------------------------------------------------------------------ strip

def _strip(spec, where):
    """A row of cells, each on or off. What a thing supports, at a glance.

    Used for tensor core formats, where "which numeric types does this
    generation do in hardware" is the question and a list of prose sentences
    is a worse answer than eight boxes.
    """
    cells = _need(spec, "cells", where, list)
    if not cells:
        raise FigureError(f"{where}: a strip with no cells shows nothing")
    cw, ch = 52.0, GRID + 4
    W, H = len(cells) * cw, ch + FONT_SM + 6
    out = [f'<svg viewBox="{-PAD/2} {-PAD/2} {W + PAD:.0f} {H + PAD:.0f}" '
           f'class="fig-svg fig-strip" role="img" '
           f'preserveAspectRatio="xMidYMid meet">']
    for i, c in enumerate(cells):
        x = i * cw
        on = bool(c.get("on"))
        label = _need(c, "label", where, str)
        col = _accent(c.get("accent"), where)
        if on:
            out.append(f'<rect x="{x + 2:.1f}" y="0" width="{cw - 4:.1f}" '
                       f'height="{ch}" rx="3" class="fig-field" '
                       f'style="fill:{col};stroke:{col}"/>')
        else:
            out.append(f'<rect x="{x + 2:.1f}" y="0" width="{cw - 4:.1f}" '
                       f'height="{ch}" rx="3" class="fig-off"/>')
        out.append(_text(x + cw / 2, ch / 2 + 4, label,
                         cls="fg" if on else "dim", size=FONT_SM, mono=True,
                         weight=700 if on else 400))
        if c.get("note"):
            out.append(_text(x + cw / 2, ch + FONT_SM + 1, c["note"],
                             cls="dim", size=FONT_SM - 1))
    out.append("</svg>")
    return "".join(out)


# -------------------------------------------------------------------- plot

def _nice_ticks(lo, hi, n=5):
    """Round tick values covering [lo, hi]. Ugly axes make a chart look wrong
    even when the data is right."""
    import math
    if hi <= lo:
        return [lo]
    raw = (hi - lo) / max(1, n)
    mag = 10 ** math.floor(math.log10(raw))
    step = min((m * mag for m in (1, 2, 2.5, 5, 10)),
               key=lambda c: abs(c - raw))
    start = math.ceil(lo / step) * step
    out, v = [], start
    while v <= hi + step * 1e-9:
        out.append(round(v, 10))
        v += step
    return out


def _fmt(v):
    if v == 0:
        return "0"
    a = abs(v)
    if a >= 1e9:
        return f"{v / 1e9:g}G"
    if a >= 1e6:
        return f"{v / 1e6:g}M"
    if a >= 1e3:
        return f"{v / 1e3:g}k"
    if a >= 0.01:
        return f"{v:g}"
    return f"{v:.0e}".replace("e-0", "e-").replace("e+0", "e")


def _plot(spec, where):
    """A line chart on labelled axes, with an optional log y.

    A handbook about hardware argues with curves as often as with numbers: a
    leakage current against gate voltage, a clock frequency against a year.
    Those are unreadable as a table and obvious as a shape.
    """
    import math
    series = _need(spec, "series", where, list)
    if not series:
        raise FigureError(f"{where}: a plot with no series shows nothing")
    ax, ay = spec.get("x") or {}, spec.get("y") or {}
    logy = bool(ay.get("log"))

    pts = [pt for s_ in series for pt in s_.get("points", [])]
    if not pts:
        raise FigureError(f"{where}: every series is empty")
    for x, y in pts:
        if logy and y <= 0:
            raise FigureError(
                f"{where}: a log axis cannot plot {y}, which is not positive")
    x0 = float(ax.get("min", min(p[0] for p in pts)))
    x1 = float(ax.get("max", max(p[0] for p in pts)))
    y0 = float(ay.get("min", min(p[1] for p in pts)))
    y1 = float(ay.get("max", max(p[1] for p in pts)))
    if x1 == x0 or y1 == y0:
        raise FigureError(f"{where}: an axis has no range to draw")

    L, B, W, H = 58.0, 34.0, 420.0, 200.0    # left gutter, bottom gutter, plot
    ty = (lambda v: H - (math.log10(v) - math.log10(y0))
          / (math.log10(y1) - math.log10(y0)) * H) if logy \
        else (lambda v: H - (v - y0) / (y1 - y0) * H)
    tx = lambda v: (v - x0) / (x1 - x0) * W

    out = [f'<svg viewBox="{-PAD} {-PAD} {L + W + PAD * 2:.0f} '
           f'{H + B + PAD * 2:.0f}" class="fig-svg" role="img" '
           f'preserveAspectRatio="xMidYMid meet">',
           f'<g transform="translate({L},0)">']

    yticks = ([10 ** e for e in range(math.floor(math.log10(y0)),
                                      math.ceil(math.log10(y1)) + 1)]
              if logy else _nice_ticks(y0, y1))
    for v in yticks:
        if not (y0 - 1e-12 <= v <= y1 * (1 + 1e-9)):
            continue
        y = ty(v)
        out.append(f'<line x1="0" y1="{y:.1f}" x2="{W}" y2="{y:.1f}" '
                   f'class="fig-grid"/>')
        out.append(_text(-8, y + 4, _fmt(v), cls="dim", size=FONT_SM,
                         anchor="end", mono=True))
    for v in _nice_ticks(x0, x1):
        if not (x0 - 1e-12 <= v <= x1 + 1e-12):
            continue
        x = tx(v)
        out.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{H}" '
                   f'class="fig-grid"/>')
        out.append(_text(x, H + 16, _fmt(v), cls="dim", size=FONT_SM, mono=True))

    for s_ in series:
        p_ = s_.get("points", [])
        if not p_:
            continue
        col = _accent(s_.get("accent"), where) if s_.get("accent") else None
        st = f' style="stroke:{col}"' if col else ""
        d = " ".join(("M" if i == 0 else "L")
                     + f"{tx(x):.1f} {ty(y):.1f}" for i, (x, y) in enumerate(p_))
        out.append(f'<path d="{d}" class="fig-line"{st}/>')
        if s_.get("label"):
            lx, ly = tx(p_[-1][0]), ty(p_[-1][1])
            out.append(_text(lx - 4, ly - 7, s_["label"], size=FONT_SM,
                             anchor="end",
                             cls="accent" if col else "fg", weight=600))

    for m in spec.get("marks", []):
        x = tx(float(_need(m, "x", where, (int, float))))
        out.append(f'<line x1="{x:.1f}" y1="-4" x2="{x:.1f}" y2="{H}" '
                   f'class="fig-mark"/>')
        if m.get("label"):
            out.append(_text(x, -8, m["label"], cls="accent", size=FONT_SM))

    out.append(f'<line x1="0" y1="{H}" x2="{W}" y2="{H}" class="fig-axis"/>')
    out.append(f'<line x1="0" y1="0" x2="0" y2="{H}" class="fig-axis"/>')
    if ax.get("label"):
        out.append(_text(W / 2, H + B - 2, ax["label"], cls="dim",
                         size=FONT_SM))
    out.append("</g>")
    if ay.get("label"):
        out.append(f'<text x="{-H / 2:.0f}" y="12" font-size="{FONT_SM}" '
                   f'text-anchor="middle" transform="rotate(-90)" '
                   f'class="fig-dim">{esc(ay["label"])}</text>')
    out.append("</svg>")
    return "".join(out)


KINDS = {"bits": _bits, "gates": _gates, "timing": _timing,
         "blocks": _blocks, "strip": _strip, "plot": _plot}


def render(body, where):
    """One ```figure block to one <figure> element."""
    try:
        spec = json.loads(body)
    except json.JSONDecodeError as e:
        raise FigureError(f"{where}: figure is not valid JSON: {e}") from e
    if not isinstance(spec, dict):
        raise FigureError(f"{where}: a figure is a JSON object")

    kind = spec.get("kind")
    if kind not in KINDS:
        raise FigureError(
            f"{where}: unknown figure kind {kind!r}. "
            f"Try one of {', '.join(sorted(KINDS))}")

    # The description is not optional. A diagram that a screen reader cannot
    # convey is a diagram that some readers simply do not get, and generating
    # one from the shapes produces something worse than silence.
    alt = spec.get("alt")
    if not alt or len(str(alt).split()) < 6:
        raise FigureError(
            f"{where}: a figure needs an `alt` of at least six words, saying "
            f"what the diagram shows rather than that it is a diagram")
    caption = spec.get("caption")
    if not caption:
        raise FigureError(f"{where}: a figure needs a `caption`")

    svg = KINDS[kind](spec, where)
    svg = svg.replace('role="img"',
                      f'role="img" aria-label="{esc(alt)}"', 1)

    # A small diagram must stay small. Left to width:100% an SVG scales its
    # user units to whatever column it is in, so a four-box figure rendered at
    # 840px draws boxes the size of buttons. The cap is the drawing's natural
    # size at a legible scale, and the figure shrinks below it on a phone.
    m = re.search(r'viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ', svg)
    if m:
        natural = round(float(m.group(1)) * 1.45)
        svg = svg.replace('class="fig-svg"',
                          f'class="fig-svg" style="max-width:{natural}px"', 1)
    return (f'<figure class="fig" data-kind="{esc(kind)}">{svg}'
            f'<figcaption>{esc(caption)}</figcaption></figure>')


def _selfcheck():
    ok = 0

    def good(spec, must):
        nonlocal ok
        out = render(json.dumps(spec), "t")
        assert must in out, f"{must!r} not in output for {spec['kind']}"
        assert "aria-label" in out and "figcaption" in out
        ok += 1

    def bad(spec, fragment):
        nonlocal ok
        try:
            render(json.dumps(spec), "t")
        except FigureError as e:
            assert fragment in str(e), f"wanted {fragment!r}, got {e}"
            ok += 1
        else:
            raise AssertionError(f"accepted a bad figure: {spec}")

    base = {"alt": "a diagram showing something worth describing here",
            "caption": "A caption."}
    good({**base, "kind": "bits", "bits": 64,
          "groups": [{"from": 0, "to": 31, "label": "eax"},
                     {"from": 32, "to": 63, "label": "high"}],
          "brackets": [{"from": 0, "to": 63, "label": "rax"}]}, "fig-bracket")
    bad({**base, "kind": "bits", "bits": 8,
         "groups": [{"from": 0, "to": 7}],
         "brackets": [{"from": 0, "to": 9}]}, "outside a 8-bit word")
    good({**base, "kind": "gates",
          "nodes": [{"id": "a", "type": "in", "x": 0, "y": 0},
                    {"id": "g", "type": "nand", "x": 1, "y": 0}],
          "wires": [{"from": "a", "to": "g"}]}, "fig-wire")
    good({**base, "kind": "timing",
          "signals": [{"name": "clk", "wave": "pppp"},
                      {"name": "d", "wave": "0.11"}]}, "fig-wave")
    good({**base, "kind": "blocks",
          "boxes": [{"id": "a", "x": 0, "y": 0, "label": "A"},
                    {"id": "b", "x": 4, "y": 0, "label": "B"}],
          "arrows": [{"from": "a", "to": "b"}]}, "fig-arrow")

    good({**base, "kind": "strip",
          "cells": [{"label": "fp16", "on": True, "accent": "jade"},
                    {"label": "fp4", "on": False}]}, "fig-strip")
    bad({**base, "kind": "strip", "cells": []}, "no cells")
    good({**base, "kind": "plot",
          "x": {"label": "volts", "min": 0, "max": 1},
          "y": {"label": "amps", "log": True},
          "series": [{"label": "off", "accent": "clay",
                      "points": [[0, 1e-9], [1, 1e-3]]}]}, "fig-line")
    bad({**base, "kind": "plot", "y": {"log": True},
         "series": [{"points": [[0, 0]]}]}, "not positive")
    bad({**base, "kind": "plot", "series": []}, "no series")
    bad({**base, "kind": "nope"}, "unknown figure kind")
    bad({**base, "kind": "bits", "bits": 8,
         "groups": [{"from": 0, "to": 3}, {"from": 3, "to": 5}]}, "in two groups")
    bad({**base, "kind": "bits", "bits": 8,
         "groups": [{"from": 0, "to": 9}]}, "outside a 8-bit word")
    bad({**base, "kind": "timing",
         "signals": [{"name": "d", "wave": "0q"}]}, "want 0 1 . x or p")
    bad({**base, "kind": "gates", "nodes": [{"id": "a", "type": "in"}],
         "wires": [{"from": "a", "to": "ghost"}]}, "unknown node")
    bad({**base, "kind": "blocks", "boxes": [{"id": "a", "label": "A"}],
         "arrows": [{"from": "a", "to": "ghost"}]}, "unknown box")

    # An accent must reach the element as a style, not a presentation
    # attribute: a presentation attribute loses to the class beside it, which
    # is why every accented waveform once came out the same colour.
    tinted = render(json.dumps({**base, "kind": "timing", "signals": [
        {"name": "a", "wave": "01", "accent": "azure"}]}), "t")
    assert "style=\"stroke:var(--azure-ink" in tinted, tinted[:300]
    assert 'stroke="var(' not in tinted, "accent used a presentation attribute"
    ok += 1
    bad({"kind": "bits", "bits": 8, "groups": [{"from": 0, "to": 7}],
         "caption": "c"}, "at least six words")
    bad({**base, "kind": "bits", "bits": 8, "groups": [{"from": 0, "to": 7}],
         "caption": None}, "needs a `caption`")
    print(f"figures.py: {ok} self-checks pass")
    return True


if __name__ == "__main__":
    _selfcheck()
