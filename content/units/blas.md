---
needs: [cost-model, floats]
minutes: 55
one_idea: Only the matrix by matrix level does more work than it moves data, so it is the only one that can ever reach a machine's peak, and that single ratio is why every numerical algorithm has been rewritten to be expressed in terms of it.
sources: [numerical-linear-algebra]
---

The basic linear algebra routines were specified in three waves, and the wave
number is the depth of the loop nest: a vector against a vector, then a matrix
against a vector, then two matrices. That sounds like a filing system. It is
actually the most consequential ratio in numerical computing, and this unit is
one paragraph plus the evidence for it.

The first two levels do work in proportion to their data. The third does work in
proportion to its data times the problem size. So the first two are permanently
limited by memory and no cleverness will ever change that, while the third is
the only one that can approach what the machine can actually compute.

Everything else here is commentary on that.

## The ratio, done honestly

The quantity is arithmetic intensity: floating point operations performed
divided by bytes that must move. Count the traffic as favourably as possible,
reading each operand once and writing each result once, since a real
implementation can only do worse.

Take a vector update of length n at eight bytes per number: multiply one vector
by a scalar and add it to another. That is two operations per element. It reads
both vectors and writes one, so twenty four bytes per element.

```
   2n operations / 24n bytes  =  one twelfth of an operation per byte
```

The n cancels. It is a constant, and it does not improve at any size.

Now a matrix times a vector. The work is two operations per matrix element, so
twice the square of n. The traffic is the matrix itself, which dominates
everything else.

```
   2n^2 operations / 8n^2 bytes  =  a quarter of an operation per byte
```

The n cancels again. And the structural reason is worth stating plainly: every
element of the matrix is used exactly once. It takes part in one multiply and
one add and is never wanted again. You can tile that computation however you
please and there is nothing in the tile to reuse. It is a streaming operation
wearing a matrix costume.

Notice what moving from the first level to the second bought. The work went up by
a factor of n, and the intensity went up by a factor of three, because the extra
data arrived alongside the extra work.

Now a matrix times a matrix. The work is twice the cube of n. The traffic is the
two inputs and the output, so a small multiple of the square.

```
   2n^3 operations / 24n^2 bytes  =  n/12 operations per byte
```

The n does not cancel. It grows without bound.

The structural reason is the mirror of the one above: every element of the first
matrix takes part in n multiplies, once for every column of the second. That
reuse is a property of the operation rather than of any implementation, and this
is the smallest of the three operations for which the work per byte of input is
unbounded.

## The table worth keeping

```
                       vector      matrix-vector     matrix-matrix
   operations            2n            2n^2             2n^3
   bytes                24n            8n^2            24n^2
   intensity            1/12            1/4              n/12
   at n = 1000         0.083           0.25               83
   at n = 10000        0.083           0.25              833
   reuse per element      1              1                 n
   can reach peak?      never          never       yes, for large enough n
```

## What the machine allows

A machine has a peak rate and a memory bandwidth, and the achievable rate is the
smaller of the peak and the intensity times the bandwidth. The intensity at
which those two are equal is the point where an operation stops being limited by
memory and starts being limited by arithmetic.

For real machines that point sits somewhere around ten operations per byte for
double precision on a server processor, about the same on a large accelerator
doing double precision, and around three hundred for the reduced precision modes
the same accelerator advertises.

Put the two together and the conclusion is not a matter of degree.

A vector operation at one twelfth, and a matrix vector operation at a quarter,
are between forty and a thousand times below every one of those thresholds. They
are not slightly memory bound. They are memory bound by orders of magnitude, on
every machine built in the last thirty years, and no implementation effort moves
them, because the ratio is a property of the operation.

A matrix multiply at a thousand on a side sits at eighty three, which is past
the threshold for the double precision cases and short of it for the reduced
precision one. At ten thousand it is over eight hundred and past all of them.

```figure
{
  "kind": "blocks",
  "alt": "Three levels of routine placed against a machine's ridge point: the vector and matrix vector levels far below it and permanently memory bound, and the matrix matrix level crossing it as the problem grows.",
  "caption": "The first two levels sit at a fixed intensity whatever the size, far below where any machine stops being limited by memory. Only the third moves rightwards as the problem grows, and crossing the ridge is what reaching peak means.",
  "boxes": [
    { "id": "l1", "x": 0,    "y": 2.4, "w": 3.6, "h": 1.0, "label": "vector: 1/12", "accent": "clay" },
    { "id": "l2", "x": 4.4,  "y": 2.4, "w": 4.0, "h": 1.0, "label": "matrix-vector: 1/4", "accent": "clay" },
    { "id": "r",  "x": 9.2,  "y": 2.4, "w": 3.2, "h": 1.0, "label": "ridge: ~10", "accent": "slate" },
    { "id": "l3", "x": 5.6,  "y": 0,   "w": 5.6, "h": 1.0, "label": "matrix-matrix: n/12", "accent": "gold" }
  ],
  "arrows": [
    { "from": "l3", "to": "r" }
  ]
}
```

## What the field did about it

Once that is understood, a great deal of the history of numerical software stops
looking like taste.

The first widely used benchmark and library was written in terms of the vector
level. On the machines of the time that was reasonable. When caches arrived it
stopped being reasonable, and the successor library was rewritten around blocked
algorithms whose inner work is a matrix multiply.

The pattern of that rewrite is worth knowing, because it recurs. A factorisation
is split into a panel and the rest. The panel is narrow, is handled by the
unblocked algorithm at the second level, and costs work in proportion to the
square times the block width. The update to everything else is a matrix multiply
and costs work in proportion to the cube. As the problem grows, the cubic term
dominates, so almost all the arithmetic ends up inside the operation that can
run at peak, and the part that cannot is asymptotically negligible.

That is the move: not making the slow level faster, which is impossible, but
arranging for almost none of the work to be in it.

The same reasoning explains why accelerators grew units that do nothing but
multiply small matrices, why a machine learning framework spends its life
turning convolutions into matrix multiplies, and why a numerical library's
performance is so often reported as a fraction of peak on one operation.

## The one place the argument is subtler

There is a caveat that stops this being a slogan, and it is the reason the third
level is described as able to reach peak rather than as fast.

Reaching it requires the reuse to be realised, and that means holding a block of
each operand somewhere fast enough while it is used. How large that block can be
is set by the cache, and the achievable intensity of a matrix multiply grows
only as the square root of the fast memory available. So the operation permits
unbounded reuse and the machine grants you a bounded amount of it, and the next
unit is entirely about arranging the loops so that the amount you get is close
to the amount on offer.

Written badly, a matrix multiply reads its operands from main memory again for
every element of the output, which puts its real intensity back down near the
second level's. The cube of arithmetic is there in either case. Whether the
traffic is the square or the cube is a property of how the loops are written,
which is why the naive three loop version runs at a few percent of peak on
hardware that could run it at ninety.

## What to carry forward

Arithmetic intensity is operations divided by bytes moved, counted as
favourably as possible.

The vector level sits at about a twelfth, the matrix vector level at a quarter,
and both are constants that no size and no implementation will change, because
in both cases every input element is used exactly once.

The matrix multiply level grows as the size over twelve, because every input
element is reused as many times as the matrix is wide. It is the smallest
operation of the three whose work per byte is unbounded, and the only one that
can reach a machine's peak.

Every machine's crossover sits between about ten and three hundred operations
per byte, which puts the first two levels one to three orders of magnitude below
it and the third above it for any serious size.

So numerical algorithms are not written to make the memory bound parts fast.
They are written so that almost all of the work is somewhere else.

Next is that operation itself: five loops written against the memory hierarchy,
and why the same shape appears again on every machine that has ever mattered.

## Reading the errors you are about to see

These are the intensities and the thresholds as arithmetic, in integers scaled
so the fractions survive.

`assert-failed` names the case your model got wrong. Several exercises assert
that an intensity does not change with the problem size, which is the n
cancelling rather than a term dropped from the formula.
