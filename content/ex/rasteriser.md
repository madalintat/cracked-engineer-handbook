## The edge function

Write `edge`, returning the value of an edge function at a point, given the two
endpoints of the edge and the point.

The value is `(x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)`, which is the signed
area of the triangle formed by the edge and the point. Its sign says which side
of the line the point is on.

@kind output
@concept Coverage is a sign test on three of these, and everything else in the
rasteriser is a consequence of their form.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two products and a subtraction. The order of the subtraction decides which
side comes out positive, and the tests fix it.
@diagnose assert verdict assert-failed
A check disagrees. Swapping the two products flips the sign of every result, so
every point lands on the wrong side of every edge. A point exactly on the line
gives zero either way, which is why that case cannot tell you the sign is wrong.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Each of these is a constant times x plus a constant times y plus a
constant, with the constants fixed for the whole triangle. Everything else
follows from that.

```starter
long edge(long x0, long y0, long x1, long y1, long x, long y) {
    return (y - y0) * (x1 - x0) - (x - x0) * (y1 - y0);
}
```

```tests
#include <assert.h>
long edge(long, long, long, long, long, long);
int main(void) {
    /* Edge from (0,0) to (4,0). Points below have a positive value here. */
    assert(edge(0, 0, 4, 0, 2, -1) == 4);
    assert(edge(0, 0, 4, 0, 2, 1) == -4);
    /* Exactly on the line. */
    assert(edge(0, 0, 4, 0, 2, 0) == 0);
    assert(edge(0, 0, 4, 0, 9, 0) == 0);
    /* A vertical edge from (0,0) to (0,4). */
    assert(edge(0, 0, 0, 4, 1, 2) == 4);
    assert(edge(0, 0, 0, 4, -1, 2) == -4);
    return 0;
}
```

```solution
long edge(long x0, long y0, long x1, long y1, long x, long y) {
    return (x - x0) * (y1 - y0) - (y - y0) * (x1 - x0);
}
```

## One addition per pixel

Write `step_x`, returning how much an edge function changes when the point moves
one pixel to the right, given the edge's endpoints.

The function is linear, so the change is a constant that does not depend on
where you are.

@kind output
@concept Being incremental is half of why this algorithm won: a step across a
row is an addition rather than two multiplications.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Work out the difference between the function at x plus one and at x, and
watch everything except one term cancel.
@diagnose assert verdict assert-failed
A check disagrees. Moving in x changes the term containing x, and the constant
it picks up is the edge's change in y. The other endpoint's x does not appear in
the answer at all.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after One add per pixel per edge, three edges, and that is the whole inner
loop. The vertical step is the same argument with the other sign.

```starter
long step_x(long x0, long y0, long x1, long y1) {
    (void)y0; (void)y1;
    return x1 - x0;
}
```

```tests
#include <assert.h>
long edge(long, long, long, long, long, long);
long step_x(long, long, long, long);
long edge(long x0, long y0, long x1, long y1, long x, long y) {
    return (x - x0) * (y1 - y0) - (y - y0) * (x1 - x0);
}
int main(void) {
    /* The step must be exactly what one pixel of movement adds. */
    assert(step_x(0, 0, 4, 0) == edge(0, 0, 4, 0, 3, 5) - edge(0, 0, 4, 0, 2, 5));
    assert(step_x(1, 2, 7, 9) == edge(1, 2, 7, 9, 4, 4) - edge(1, 2, 7, 9, 3, 4));
    assert(step_x(0, 0, 0, 4) == 4);
    assert(step_x(0, 0, 4, 0) == 0);
    return 0;
}
```

```solution
long step_x(long x0, long y0, long x1, long y1) {
    (void)x0; (void)x1;
    return y1 - y0;
}
```

## Inside, by sign

Write `inside`, deciding whether a point is inside a triangle, given the three
edge function values at that point.

A point is inside when all three have the same sign. A value of zero is on an
edge and counts as inside here, so that the two triangles sharing an edge do not
leave a hole between them.

@kind output
@concept The whole coverage test is a comparison of signs, which is why it can
be done for many pixels at once with no dependency between them.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Zero belongs to both sides, so it must not disqualify a point on its own.
@diagnose assert verdict assert-failed
A check disagrees. Requiring all three to be strictly positive rejects every
triangle wound the other way, and rejecting zero puts a hole along every shared
edge.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Which sign means inside depends on the winding, which is why the test is
about agreement rather than about being positive.

```starter
int inside(long e0, long e1, long e2) {
    return e0 > 0 && e1 > 0 && e2 > 0;
}
```

```tests
#include <assert.h>
int inside(long, long, long);
int main(void) {
    assert(inside(3, 5, 1) == 1);
    assert(inside(-3, -5, -1) == 1);   /* the other winding */
    assert(inside(3, -5, 1) == 0);
    assert(inside(0, 5, 1) == 1);      /* on an edge */
    assert(inside(0, -5, -1) == 1);
    assert(inside(0, 0, 0) == 1);      /* degenerate, but not outside */
    assert(inside(-1, 0, 1) == 0);
    return 0;
}
```

```solution
int inside(long e0, long e1, long e2) {
    int pos = (e0 >= 0) && (e1 >= 0) && (e2 >= 0);
    int neg = (e0 <= 0) && (e1 <= 0) && (e2 <= 0);
    return pos || neg;
}
```

## The rule that stops the seam

Write `fill_bias`, returning the bias to apply to an edge's initial value under
the top left rule, given the edge's change in x and change in y.

An edge is a top edge when it is exactly horizontal and its interior is below,
which for this winding means the change in y is zero and the change in x is
negative. An edge is a left edge when its change in y is positive.

A top or left edge gets a bias of 0. Every other edge gets a bias of -1, so that
a pixel exactly on it is excluded.

@kind output
@concept Without this, a pixel on a shared edge is either shaded twice, which
shows as a seam under blending, or not at all, which shows as a hole.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two conditions, and either one is enough to keep the bias at zero.
@diagnose assert verdict assert-failed
A check disagrees. A left edge and a top edge are two separate cases, and an
edge that is neither is the one that has to give up its boundary pixels to its
neighbour.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is exact only because the coordinates are fixed point integers. In
floating point, exactly on the line is not a decision a comparison can make, and
watertight rasterisation becomes impossible.

```starter
int fill_bias(long dx, long dy) {
    (void)dx;
    return dy > 0 ? 0 : -1;
}
```

```tests
#include <assert.h>
int fill_bias(long, long);
int main(void) {
    assert(fill_bias(0, 5) == 0);     /* left edge */
    assert(fill_bias(-4, 0) == 0);    /* top edge */
    assert(fill_bias(4, 0) == -1);    /* horizontal, but the bottom */
    assert(fill_bias(0, -5) == -1);   /* right edge */
    assert(fill_bias(3, 2) == 0);     /* also a left edge */
    assert(fill_bias(3, -2) == -1);
    return 0;
}
```

```solution
int fill_bias(long dx, long dy) {
    int is_top = (dy == 0 && dx < 0);
    int is_left = (dy > 0);
    return (is_top || is_left) ? 0 : -1;
}
```

## Reaching your neighbour

Write `neighbour`, returning the lane index a shader reads to compute a
derivative, given its own lane index inside a two by two block and which
direction it wants.

Direction 0 is horizontal and direction 1 is vertical. Lanes are numbered 0 to 3
with 0 and 1 the top row and 2 and 3 the bottom.

@kind output
@concept The whole addressing scheme is an exclusive or, which is why a
derivative costs a subtraction rather than a differentiated shader.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One bit crosses the block sideways and the next one crosses it downwards.
@diagnose assert verdict assert-failed
A check disagrees. Adding one moves along the row and falls out of the block at
the end of it. Flipping a bit stays inside the block from every lane, which is
the property the hardware needs.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Every ordinary texture read does this for you, and the variants that take
an explicit derivative exist for when the implicit one would difference against
a lane that took a different branch.

```starter
unsigned neighbour(unsigned lane, int vertical) {
    return vertical ? lane + 2 : lane + 1;
}
```

```tests
#include <assert.h>
unsigned neighbour(unsigned, int);
int main(void) {
    assert(neighbour(0, 0) == 1);
    assert(neighbour(1, 0) == 0);   /* and back again */
    assert(neighbour(2, 0) == 3);
    assert(neighbour(3, 0) == 2);
    assert(neighbour(0, 1) == 2);
    assert(neighbour(2, 1) == 0);
    assert(neighbour(1, 1) == 3);
    assert(neighbour(3, 1) == 1);
    return 0;
}
```

```solution
unsigned neighbour(unsigned lane, int vertical) {
    return lane ^ (vertical ? 2u : 1u);
}
```

## The lanes that run for nothing

Write `helper_lanes`, returning how many lanes of a two by two block execute the
shader and have their results discarded, given the coverage as a four bit mask.

A block with no coverage at all is not shaded, so it has no helper lanes.
Otherwise every uncovered lane in the block runs anyway, because the covered
ones need its values to compute a derivative.

@kind output
@concept The waste is not an oversight. The uncovered lanes have to run, or the
covered one cannot difference against them.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count the zero bits, except in the one case where the block never runs.
@diagnose assert verdict assert-failed
A check disagrees. A block with nothing covered is never dispatched, so it costs
nothing. Counting its four uncovered lanes as helpers charges the shader for
work that never happened.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The published figure for blocks along a triangle's edge is that between a
quarter and three quarters of the shading is wasted, and the floor is one
covered pixel in four.

```starter
unsigned helper_lanes(unsigned mask) {
    unsigned n = 0;
    for (unsigned i = 0; i < 4; i++)
        if (!((mask >> i) & 1u)) n++;
    return n;
}
```

```tests
#include <assert.h>
unsigned helper_lanes(unsigned);
int main(void) {
    assert(helper_lanes(0xF) == 0);   /* fully covered */
    assert(helper_lanes(0x1) == 3);   /* one pixel, three helpers */
    assert(helper_lanes(0x3) == 2);
    assert(helper_lanes(0x7) == 1);
    assert(helper_lanes(0x0) == 0);   /* never dispatched */
    assert(helper_lanes(0x9) == 2);
    return 0;
}
```

```solution
unsigned helper_lanes(unsigned mask) {
    if ((mask & 0xFu) == 0) return 0;
    unsigned n = 0;
    for (unsigned i = 0; i < 4; i++)
        if (!((mask >> i) & 1u)) n++;
    return n;
}
```

## How much of a small triangle is wasted

Write `quad_efficiency`, returning the shading efficiency of a triangle as a
percentage, given its area and perimeter in pixels.

A triangle touches roughly its area over four, plus half its perimeter, blocks
of four pixels. The efficiency is the area over four times the blocks touched,
which simplifies to the area over the area plus twice the perimeter.

Return the percentage, truncated. An area of zero has no efficiency to report,
so return 0.

@kind output
@concept Efficiency runs with the ratio of area to perimeter, so it collapses as
triangles get small, whatever the shader does.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The blocks touched along the edges are what the perimeter contributes, and
they are the term that stops mattering as the triangle grows.
@diagnose assert verdict assert-failed
A check disagrees. Ignoring the perimeter says every triangle is fully
efficient, which is the belief this exercise exists to correct. The edge blocks
are the entire cost being measured.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A triangle eight pixels on a side wastes about two thirds of its shading.
That is why very small triangles are the current crisis in rendering, and why at
least one modern engine rasterises them in software instead.

```starter
unsigned quad_efficiency(unsigned area, unsigned perimeter) {
    (void)perimeter;
    return area ? 100 : 0;
}
```

```tests
#include <assert.h>
unsigned quad_efficiency(unsigned, unsigned);
int main(void) {
    assert(quad_efficiency(0, 10) == 0);
    /* A large triangle: area dominates. */
    assert(quad_efficiency(10000, 400) == 92);
    /* A small one: the perimeter dominates. */
    assert(quad_efficiency(28, 24) == 36);
    /* A long thin sliver: tiny area, large perimeter. */
    assert(quad_efficiency(50, 400) == 5);
    assert(quad_efficiency(100, 0) == 100);
    return 0;
}
```

```solution
unsigned quad_efficiency(unsigned area, unsigned perimeter) {
    if (!area) return 0;
    return area * 100u / (area + 2u * perimeter);
}
```

## Where thirty two comes from

Write `warp_size`, returning how many lanes a warp holds, given how many blocks
of pixels the hardware groups into one instruction issue slot.

A block is two by two, so it is four pixels, and a warp is that many blocks.

@kind output
@concept The number was not chosen for tidiness. It is the pixel block,
replicated enough times to fill an issue slot.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The block is a square of side two, not a pair.
@diagnose assert verdict assert-failed
A check disagrees. A two by two block is four pixels, so eight of them are
thirty two lanes rather than sixteen. That factor is the whole point of the
exercise.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Every person who has memorised that a warp is thirty two has memorised a
fact about mipmap selection, arrived at through the derivative that a two by two
block exists to provide.

```starter
unsigned warp_size(unsigned quads) {
    return quads * 2;
}
```

```tests
#include <assert.h>
unsigned warp_size(unsigned);
int main(void) {
    assert(warp_size(8) == 32);
    assert(warp_size(1) == 4);
    assert(warp_size(16) == 64);   /* the other vendor's width */
    assert(warp_size(0) == 0);
    return 0;
}
```

```solution
unsigned warp_size(unsigned quads) {
    return quads * 4;
}
```
