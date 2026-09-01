# Mascot

The mascot is an eagle in a hard hat and overalls, with a laptop reading "the
handbook series". It arrived as a 1408px JPEG on solid black.

## What is in assets/img

    mascot-512.png       the whole figure, for the 404 and social previews
    mascot-128.png       the whole figure, smaller
    mascot-64.png        the whole figure, smaller again
    mascot-head-128.png  head and shoulders, for the apple touch icon
    mascot-head-64.png   head and shoulders, the header mark and the favicon

The header uses the head rather than the whole figure because the whole figure
is a blob at 30px, and the brief for the mascot said it has to read at that
size. The 404 is the one place the whole thing fits.

## Regenerating it

The source is a JPEG on black, which is fine on the dark theme and a black
square on the light one, so the background is keyed out. There is no
ImageMagick or Pillow here, so `tools/keyout.py` does it with `zlib` alone.

    sips -s format png source.jpg --out raw.png
    sips -Z 512 raw.png --out 512.png

    python3 tools/keyout.py 512.png assets/img/mascot-512.png \
        --key 000000 --tol 34
    python3 tools/keyout.py 512.png head.png \
        --key 000000 --tol 34 --crop 0.32,0.085,0.50,0.45

    sips -Z 128 head.png --out assets/img/mascot-head-128.png
    sips -Z 64  head.png --out assets/img/mascot-head-64.png

Alpha is feathered across the tolerance band rather than switched at a
threshold. A hard cut on antialiased line art leaves a fringe of the old
background around every edge, and against a light page that fringe is the first
thing you see.

## Where it appears

The header mark, the favicon, the apple touch icon, the social preview, and the
404. Nowhere else. A mascot that turns up on every page is one you stop seeing,
and then it cannot do the one job it has.

The header image is decorative and carries an empty `alt`, because the brand
link is already named by the words beside it and repeating them to a screen
reader is noise. The 404 image describes itself, because there it is the only
thing on the page that is not an error message.
