---
needs: [frame-budget]
minutes: 55
one_idea: Coverage is three linear functions evaluated on a grid, the answer comes out in blocks of two by two because that is the cheapest way to get a derivative, and a warp is eight of those blocks.
sources: [graphics-pipeline]
---

A triangle is three points. A screen is a grid. Turning the first into a set of
the second is rasterisation, and the algorithm everyone uses is worth knowing
exactly, because the shape of the hardware in the next nine units comes out of
it.

The two things to take away are the form of the coverage test and the size of
the block it answers in. The second one turns out to explain a number every
person who has written a GPU kernel has memorised without knowing where it came
from.

## Coverage is three linear functions

For each edge of the triangle, define a function of the position on screen:

```
E(x, y) = (x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)
```

That is the signed area of the triangle formed by the edge and the point, which
is positive on one side of the line and negative on the other. Do it for all
three edges. A point is inside the triangle exactly when all three have the same
sign.

Written out, each one is a constant times x plus a constant times y plus a
constant, with the constants fixed for the whole triangle.

Two properties follow from that form, and they are the entire reason this
algorithm won.

It is incremental. Moving one pixel to the right adds a constant. Moving one
pixel down adds a different constant. So evaluating an edge across a row is one
addition per pixel, not a multiplication.

It is order free. There is no dependency from one pixel to the next, so you can
evaluate sixty four pixels at once with sixty four adders, in any order you
like. A scanline algorithm has a sequential dependency along each span and
cannot do that.

That second property is why the rasteriser is a wide parallel block instead of a
state machine, and it is the first place in this part where independence buys a
different machine.

There is a bonus. Normalise the three edge functions by the total area and they
are the barycentric coordinates of the point, which are exactly the weights you
need to interpolate anything across the triangle. The same hardware that decides
coverage produces the interpolation weights for free.

## The rule that stops seams

Two triangles that share an edge will both contain any pixel whose centre lies
exactly on that edge. Shade it twice and a blended scene shows a bright seam;
shade it in neither and there is a hole.

The specification's answer is the top left rule: a pixel exactly on an edge
belongs to the triangle if that edge is a top edge or a left edge, and not
otherwise. In an implementation it is a bias of minus one applied to the initial
value of every edge that is not top or left.

The part worth noticing is why that works at all. It is exact only because the
coordinates are integers in fixed point, so lying exactly on an edge is a
decision a comparison can make. In floating point, exactly on the line is not a
well defined condition, and watertight rasterisation is impossible. That is the
argument for snapping vertex positions to a fixed point grid, and it is a
correctness argument rather than a performance one.

## Two levels, and why a sliver is pathological

Testing every pixel of the screen against every triangle would be absurd, so
rasterisation happens at two granularities.

A coarse stage tests whole tiles, say eight by eight, against the edge equations
by evaluating them at the tile's corners. A tile entirely outside is rejected
with no per pixel work at all; a tile entirely inside is accepted wholesale; only
the tiles straddling an edge go to the next stage. A fine stage then evaluates
per pixel inside those, producing coverage.

This is why a long thin triangle is the worst case. It touches a great many
tiles while covering very few pixels, so the coarse stage rejects almost nothing
and the fine stage finds almost nothing to do in each tile it was handed.

## The block of four, and the reason for it

The fine rasteriser does not emit single pixels. It emits two by two blocks.

The reason is mipmap selection. Every texture read has to know how fast the
texture coordinate is changing across the screen, so it can pick a level of
detail: a surface seen edge on needs a blurrier version of the texture than one
seen flat, or it aliases horribly. That rate of change is a derivative.

A shader is a program run per pixel. It has no analytic knowledge of its own
derivative, and computing one properly would mean differentiating arbitrary
shader code. The cheap answer is a finite difference against a neighbour, and
that only works if the neighbour is right there:

```
ddx(u) = u[lane ^ 1] - u[lane]     the horizontal neighbour
ddy(u) = u[lane ^ 2] - u[lane]     the vertical neighbour
```

Two subtractions and a read across lanes. So: shade in blocks of four, and the
derivative is free.

```figure
{
  "kind": "blocks",
  "alt": "A two by two block of lanes numbered zero to three, with lane zero's horizontal neighbour reached by flipping the low bit and its vertical neighbour by flipping the second bit.",
  "caption": "The exclusive or is the whole addressing scheme. Flipping the low bit crosses the block horizontally and flipping the next one crosses it vertically, which is why a derivative costs a subtraction.",
  "boxes": [
    { "id": "l0", "x": 0,   "y": 0,   "w": 2.6, "h": 1.1, "label": "lane 0", "accent": "gold" },
    { "id": "l1", "x": 3.4, "y": 0,   "w": 2.6, "h": 1.1, "label": "lane 1", "accent": "azure" },
    { "id": "l2", "x": 0,   "y": 2.2, "w": 2.6, "h": 1.1, "label": "lane 2", "accent": "azure" },
    { "id": "l3", "x": 3.4, "y": 2.2, "w": 2.6, "h": 1.1, "label": "lane 3", "accent": "slate" }
  ],
  "arrows": [
    { "from": "l0", "to": "l1", "label": "xor 1" },
    { "from": "l0", "to": "l2", "label": "xor 2" }
  ]
}
```

This is exposed in every shading language, and every ordinary texture read calls
it for you. The variants that take an explicit derivative exist for the case
where the implicit one would be wrong, inside branchy code, because the hardware
would otherwise difference against a lane that went somewhere else.

## What the block costs

A block is shaded as a unit even when the triangle covers one of its four
pixels. The other three run anyway, as helper lanes: they execute the whole
shader, they issue memory traffic, they occupy arithmetic slots, and their
results are discarded. They have to run, because the covered pixel needs their
values to compute its derivative.

The published figure for blocks generated along triangle edges is that between a
quarter and three quarters of the shading work is wasted. The floor is one
covered pixel in four.

Three consequences follow.

Small triangles are catastrophically inefficient. Count the blocks a triangle
touches and it is roughly its area over four plus half its perimeter, so
efficiency runs with the ratio of area to perimeter. A triangle eight pixels on
a side wastes about two thirds of its shading; at sixty four pixels a side it
wastes under a fifth.

That is why very small triangles are the current crisis in rendering, and why at
least one modern engine rasterises them in software on the general purpose cores
instead. The fixed function path stops paying for itself when the triangle is
smaller than the block it insists on. Graphics work moving back onto the machine
that graphics work created is a good joke and a real engineering decision.

And you cannot switch the block off. Quad granularity is assumed by the
rasteriser, the depth test, the attribute storage and the blending hardware.
Removing it would mean redesigning all of them.

## Where the warp comes from

Here is the payoff.

The block of four pixels is the unit of fragment shading. To fill an instruction
issue slot the hardware groups eight of those blocks together, and schedules
them as one thread of control.

Eight blocks of four is thirty two.

A warp is not a number somebody chose for tidiness. It is the pixel quad,
replicated eight times to fill an issue slot, and the pixel quad exists so that a
shader can compute a derivative by subtracting its neighbour, so that a texture
read can pick a mipmap level. Every person who has memorised that the warp size
is thirty two has memorised a fact about mipmap selection.

## What to carry forward

Coverage is three linear edge functions and a sign test. They are incremental,
so a step is an addition, and order free, so the rasteriser is a wide parallel
block rather than a state machine. Normalised, they are the interpolation
weights as well.

The top left rule makes shared edges watertight, and it is exact only because
the coordinates are fixed point integers.

Rasterisation is hierarchical, which is why a long thin sliver is the pathological
case: many tiles, few pixels.

Shading happens in two by two blocks so that a derivative is a subtraction
against a neighbour, which is what mipmap selection needs. Uncovered pixels in a
block run anyway and are thrown away, so small triangles waste most of their
shading.

And a warp is eight of those blocks.

Next is what that means for the machine underneath: why the streaming
multiprocessor is shaped the way it is, and which of its features were built for
triangles rather than for the kernels people now write.

## Reading the errors you are about to see

These are the rasteriser's own arithmetic: an edge function, the incremental
step, the sign test, the fill rule bias, the lane addressing inside a block, and
the efficiency of a small triangle.

`assert-failed` names the case your model got wrong. Several exercises assert
that a point exactly on an edge is inside, which is the fill rule rather than a
comparison written the wrong way round.
