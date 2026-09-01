# Mascot brief

Constraint that decides everything: it must read at 26px in the header, and it
appears rarely, saying one line.

## Candidates, best first

**Nand**: the NAND gate. D-shaped body, the inversion bubble as its nose, two
eyes on the flat left edge where the inputs go. Part II is "one primitive, all
of logic", and Part I proves NAND is four transistors where AND is six. The
bubble-as-nose is a real pun, not decoration.

**Dip**: a DIP-package chip with legs, walking. The package notch becomes a
fringe. At 26px it is a dark rounded rectangle with pin-legs, which is enough.
Structurally the closest analogue to how Ferris works.

**Smoke**: the magic smoke that hardware runs on until it escapes. Most
personality, least legible small, and reads as a failure mascot when the
companion appears on a pass.

**Flip**: a D flip-flop, the bit that stays. Clock triangle on the left edge as
a mouth. Cleanest geometry, least character.

## Generation brief

    flat vector, no gradients, no outline glow
    2 to 3 colours only, from:
      #4ade80  phosphor (accent)     #0e1113  dark ground
      #f2f5f6  light ink             #3fd3e0  cyan (sparingly)
    square canvas, transparent PNG, 512x512
    silhouette must survive scaling to 26x26 and to 1-bit black
    face on the left third so it reads beside the wordmark
    no text, no shadow, no perspective

## Wiring

One file, `assets/mascot.png`, and one CSS token, `--mascot`. Nothing else
references it, so swapping is a single file replacement. The reference
implementation hardcodes its mascot in 7 places across 3 files plus 9 CSS rules
plus 5 entries in its track manifest; that is the mistake being avoided.
