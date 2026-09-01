"""Make a flat background transparent, in pure Python.

The mascot arrives as a JPEG on solid black, which is fine on the dark theme
and a black square on the light one. There is no ImageMagick or Pillow here, so
this reads the PNG that `sips` produces, keys out the background, and writes it
back with an alpha channel. `zlib` is the only thing it needs.

    sips -s format png in.jpg --out raw.png
    python3 tools/keyout.py raw.png out.png --key 000000 --tol 34

Alpha is feathered across the tolerance band rather than switched at a
threshold, because a hard cut on a drawing with antialiased edges leaves a
black fringe that is very visible against a light background.
"""

import argparse
import struct
import sys
import zlib


def read_png(path):
    d = open(path, "rb").read()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path}: not a PNG")
    i, idat, hdr = 8, b"", None
    while i + 8 <= len(d):
        ln = struct.unpack(">I", d[i:i + 4])[0]
        typ, body = d[i + 4:i + 8], d[i + 8:i + 8 + ln]
        if typ == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
        i += 12 + ln
    w, h, depth, colour, _, _, interlace = hdr
    if depth != 8 or interlace != 0 or colour not in (2, 6):
        raise SystemExit(
            f"{path}: need 8-bit non-interlaced RGB or RGBA, got depth {depth} "
            f"colour type {colour} interlace {interlace}")
    return w, h, (4 if colour == 6 else 3), zlib.decompress(idat)


def unfilter(raw, w, h, nch):
    """Undo the per-scanline filters. This is the only fiddly part of PNG."""
    stride = w * nch
    out = bytearray(stride * h)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        ft = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        if ft == 1:
            for x in range(nch, stride):
                line[x] = (line[x] + line[x - nch]) & 0xFF
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif ft == 3:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
        elif ft == 4:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                b = prev[x]
                c = prev[x - nch] if x >= nch else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        elif ft != 0:
            raise SystemExit(f"unknown PNG filter {ft}")
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return out


def write_rgba(path, w, h, px):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)                      # filter: none
        raw += px[y * stride:(y + 1) * stride]
    def chunk(t, b):
        return (struct.pack(">I", len(b)) + t + b
                + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF))
    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    out += chunk(b"IEND", b"")
    open(path, "wb").write(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--key", default="000000", help="background colour, hex")
    ap.add_argument("--tol", type=int, default=34,
                    help="distance at which a pixel becomes fully opaque")
    ap.add_argument("--crop", default=None,
                    help="x,y,w,h in fractions of the source, for a detail "
                         "that has to read at a size the whole picture cannot")
    a = ap.parse_args()

    kr, kg, kb = (int(a.key[i:i + 2], 16) for i in (0, 2, 4))
    w, h, nch, comp = read_png(a.src)
    src_w, src_h = w, h
    px = unfilter(comp, w, h, nch)

    out = bytearray(w * h * 4)
    cleared = 0
    for i in range(w * h):
        r = px[i * nch]; g = px[i * nch + 1]; b = px[i * nch + 2]
        d = max(abs(r - kr), abs(g - kg), abs(b - kb))
        if d >= a.tol:
            alpha = 255
        else:
            # Feathered, not switched. A hard cut on antialiased line art
            # leaves a fringe of the background colour around every edge, and
            # against a light page that fringe is the first thing you see.
            alpha = round(255 * d / a.tol)
            cleared += 1
        out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b
        out[i * 4 + 3] = alpha
    if a.crop:
        fx, fy, fw, fh = (float(v) for v in a.crop.split(","))
        cx, cy = int(fx * w), int(fy * h)
        cw, ch = int(fw * w), int(fh * h)
        cropped = bytearray(cw * ch * 4)
        for y in range(ch):
            src = ((cy + y) * w + cx) * 4
            cropped[y * cw * 4:(y + 1) * cw * 4] = out[src:src + cw * 4]
        out, w, h = cropped, cw, ch

    write_rgba(a.dst, w, h, out)
    # Counted over the source, since a crop discards pixels this already
    # decided about and the ratio is about the keying rather than the crop.
    pct = 100 * cleared / (src_w * src_h)
    print(f"{a.dst}: {w}x{h}, {pct:.1f}% of the source keyed out")


if __name__ == "__main__":
    main()
