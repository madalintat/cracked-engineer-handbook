## The ratio itself

Write `intensity_milli`, returning an operation's arithmetic intensity in
thousandths of an operation per byte, given its operation count and the bytes it
must move.

Truncate towards zero. An operation that moves no bytes has no intensity to
report, so return 0.

@kind output
@concept One division decides which side of a machine an operation lives on,
and everything else in this unit is that division applied to three shapes.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Scale before dividing, or every intensity below one operation per byte
rounds to nothing.
@diagnose assert verdict assert-failed
A check disagrees. A twelfth of an operation per byte is 83 thousandths, and
dividing before scaling gives zero for it, which is every interesting case in
this unit.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Count the traffic as favourably as possible, reading each operand once
and writing each result once, because a real implementation can only do worse.

```starter
unsigned long intensity_milli(unsigned long flops, unsigned long bytes) {
    if (!bytes) return 0;
    return flops / bytes * 1000UL;
}
```

```tests
#include <assert.h>
unsigned long intensity_milli(unsigned long, unsigned long);
int main(void) {
    /* A vector update of length 1000: 2000 flops over 24000 bytes. */
    assert(intensity_milli(2000, 24000) == 83);
    /* A matrix vector product at n = 1000. */
    assert(intensity_milli(2000000, 8000000) == 250);
    /* A matrix multiply at n = 1000. */
    assert(intensity_milli(2000000000UL, 24000000UL) == 83333);
    assert(intensity_milli(1000, 0) == 0);
    return 0;
}
```

```solution
unsigned long intensity_milli(unsigned long flops, unsigned long bytes) {
    if (!bytes) return 0;
    return flops * 1000UL / bytes;
}
```

## What each level moves

Write `compulsory_bytes`, returning the smallest number of bytes an operation
must move, given its level, the problem size and the bytes per number.

The vector update reads two vectors and writes one, so three vectors of traffic.
The matrix vector product reads the matrix, which dominates everything else, so
count only the square. The matrix multiply reads two matrices and writes one, so
three squares.

@kind output
@concept The traffic is what the operation requires rather than what an
implementation happens to do, which is why this is a floor and not an estimate.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The second level moves the square and the third moves three of them,
because only the third has anything to write back that is the same shape.
@diagnose assert verdict assert-failed
A check disagrees. A matrix vector product touches one matrix, not three, since
its vectors are smaller than the matrix by a factor of the size. A matrix
multiply touches three.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Counting the vectors in the second level as well would be more precise
and change nothing: they are smaller than the matrix by a factor of n, which is
exactly why the ratio comes out independent of n.

```starter
unsigned long compulsory_bytes(unsigned level, unsigned long n, unsigned wide) {
    if (level == 1) return 3UL * n * wide;
    return 3UL * n * n * wide;
}
```

```tests
#include <assert.h>
unsigned long compulsory_bytes(unsigned, unsigned long, unsigned);
int main(void) {
    assert(compulsory_bytes(1, 1000, 8) == 24000UL);
    assert(compulsory_bytes(2, 1000, 8) == 8000000UL);
    assert(compulsory_bytes(3, 1000, 8) == 24000000UL);
    assert(compulsory_bytes(1, 0, 8) == 0UL);
    return 0;
}
```

```solution
unsigned long compulsory_bytes(unsigned level, unsigned long n, unsigned wide) {
    if (level == 1) return 3UL * n * wide;
    if (level == 2) return n * n * wide;
    return 3UL * n * n * wide;
}
```

## What each level computes

Write `flops`, returning how many floating point operations a level performs,
given its level and the problem size.

Each level does two operations per element of its largest operand: twice the
size, twice the square, twice the cube.

@kind output
@concept The level number is the exponent of the work, and it is one more than
the exponent of the data, which is the whole of the argument.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The exponent is the level, and the cube of a thousand needs a type wide
enough to hold two billion.
@diagnose assert verdict assert-failed
A check disagrees. A matrix multiply at a thousand a side is two billion
operations, which overflows a 32 bit type, so the multiplication has to happen
in the wide one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The work went up by a factor of n from the first level to the second, and
the intensity by a factor of three, because the extra data arrived alongside the
extra work.

```starter
unsigned long flops(unsigned level, unsigned long n) {
    unsigned r = 2;
    for (unsigned i = 0; i < level; i++) r *= (unsigned)n;
    return r;
}
```

```tests
#include <assert.h>
unsigned long flops(unsigned, unsigned long);
int main(void) {
    assert(flops(1, 1000) == 2000UL);
    assert(flops(2, 1000) == 2000000UL);
    assert(flops(3, 1000) == 2000000000UL);
    assert(flops(3, 10000) == 2000000000000UL);
    assert(flops(1, 0) == 0UL);
    return 0;
}
```

```solution
unsigned long flops(unsigned level, unsigned long n) {
    unsigned long r = 2;
    for (unsigned i = 0; i < level; i++) r *= n;
    return r;
}
```

## How often an element is reused

Write `reuse`, returning how many times each element of the largest input takes
part in an operation, given the level and the problem size.

At the first two levels every element is used exactly once. At the third, each
element of one matrix is used once per column of the other.

@kind output
@concept This is the structural fact underneath the ratio, and it is a property
of the operation rather than of any implementation.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two of the three levels give the same answer whatever the size.
@diagnose assert verdict assert-failed
A check disagrees. Every element of a matrix in a matrix vector product takes
part in exactly one multiply and one add and is then never wanted again, so its
reuse is one however large the matrix is. There is nothing in a tile of it to
reuse.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after You can tile the second level however you please and gain nothing. It is
a streaming operation wearing a matrix costume.

```starter
unsigned long reuse(unsigned level, unsigned long n) {
    (void)level;
    return n;
}
```

```tests
#include <assert.h>
unsigned long reuse(unsigned, unsigned long);
int main(void) {
    assert(reuse(1, 1000) == 1);
    assert(reuse(2, 1000) == 1);
    assert(reuse(3, 1000) == 1000);
    assert(reuse(2, 10) == 1);
    assert(reuse(3, 10) == 10);
    return 0;
}
```

```solution
unsigned long reuse(unsigned level, unsigned long n) {
    return level == 3 ? n : 1UL;
}
```

## Where the machine changes its mind

Write `ridge_milli`, returning a machine's crossover intensity in thousandths of
an operation per byte, given its peak rate in billions of operations per second
and its bandwidth in gigabytes per second.

Below that intensity an operation is limited by memory, and above it by
arithmetic.

@kind output
@concept The ridge is a property of the machine and the intensity is a property
of the operation, and the comparison between them is the whole prediction.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Peak over bandwidth, in the same units, scaled so a fractional answer
survives.
@diagnose assert verdict assert-failed
A check disagrees. Bandwidth divided by peak is the reciprocal of the answer,
and for a machine with far more arithmetic than bandwidth it rounds to zero
rather than to the number you wanted.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Around ten for double precision on a server processor, about the same for
double precision on a large accelerator, and around three hundred for the
reduced precision modes the same accelerator advertises.

```starter
unsigned long ridge_milli(unsigned long gflops, unsigned long gb_per_sec) {
    if (!gflops) return 0;
    return gb_per_sec * 1000UL / gflops;
}
```

```tests
#include <assert.h>
unsigned long ridge_milli(unsigned long, unsigned long);
int main(void) {
    /* 100 GFLOP/s against 10 GB/s. */
    assert(ridge_milli(100, 10) == 10000);
    /* 19500 against 2040. */
    assert(ridge_milli(19500, 2040) == 9558);
    /* 989500 against 3350. */
    assert(ridge_milli(989500, 3350) == 295373);
    assert(ridge_milli(100, 0) == 0);
    return 0;
}
```

```solution
unsigned long ridge_milli(unsigned long gflops, unsigned long gb_per_sec) {
    if (!gb_per_sec) return 0;
    return gflops * 1000UL / gb_per_sec;
}
```

## Which side of the ridge

Write `can_reach_peak`, deciding whether an operation can reach a machine's peak
rate, given its intensity and the machine's ridge, both in thousandths.

An operation at or above the ridge is limited by arithmetic and can reach peak.
Below it, it is limited by memory and cannot, however well it is implemented.

@kind output
@concept The word cannot is doing real work here. It is not a statement about
this implementation but about every possible one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Exactly at the ridge the two limits are equal, so peak is reachable there.
@diagnose assert verdict assert-failed
A check disagrees. An operation sitting exactly on the ridge is limited equally
by both and reaches peak, and an operation a thousand times below it does not
get there by being written more carefully.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The first two levels are between forty and a thousand times below every
machine's ridge. They are not slightly memory bound; they are memory bound by
orders of magnitude, on every machine built in the last thirty years.

```starter
int can_reach_peak(unsigned long intensity_milli, unsigned long ridge_milli) {
    return intensity_milli > ridge_milli;
}
```

```tests
#include <assert.h>
int can_reach_peak(unsigned long, unsigned long);
int main(void) {
    /* A vector update against a server processor. */
    assert(can_reach_peak(83, 10000) == 0);
    /* A matrix vector product. */
    assert(can_reach_peak(250, 10000) == 0);
    /* A matrix multiply at n = 1000. */
    assert(can_reach_peak(83333, 10000) == 1);
    /* The same multiply against a reduced precision accelerator. */
    assert(can_reach_peak(83333, 295373) == 0);
    /* Exactly on the ridge. */
    assert(can_reach_peak(10000, 10000) == 1);
    return 0;
}
```

```solution
int can_reach_peak(unsigned long intensity_milli, unsigned long ridge_milli) {
    return intensity_milli >= ridge_milli;
}
```

## How large the problem has to be

Write `min_size`, returning the smallest matrix multiply size that reaches a
machine's peak, given the ridge in thousandths of an operation per byte and the
bytes per number.

The intensity of a matrix multiply is the size divided by three times the bytes
per number, since it moves three matrices. Return the smallest whole size at or
above the ridge.

@kind output
@concept The third level can reach peak, and this says from what size onwards,
which is the honest form of the claim.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Set the intensity equal to the ridge and solve for the size, then round
upwards so the result is at or above it rather than below.
@diagnose assert verdict assert-failed
A check disagrees. Rounding down gives a size whose intensity is just under the
ridge, which is the one size the question was asking you to exclude.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after In double precision on a server processor that is a few hundred on a
side. On an accelerator's reduced precision units it is several thousand, which
is why those machines want problems that size.

```starter
unsigned long min_size(unsigned long ridge_milli, unsigned wide) {
    return ridge_milli * 3UL * wide / 1000UL;
}
```

```tests
#include <assert.h>
unsigned long min_size(unsigned long, unsigned);
int main(void) {
    /* A ridge of 10 operations per byte, 8 byte numbers: n/24 >= 10. */
    assert(min_size(10000, 8) == 240);
    /* A ridge of 295.373, 2 byte numbers. */
    assert(min_size(295373, 2) == 1773);
    /* A ridge that divides exactly. */
    assert(min_size(1000, 8) == 24);
    assert(min_size(0, 8) == 0);
    return 0;
}
```

```solution
unsigned long min_size(unsigned long ridge_milli, unsigned wide) {
    unsigned long num = ridge_milli * 3UL * wide;
    return (num + 999UL) / 1000UL;
}
```

## Where the work ends up

Write `level3_share_pct`, returning what percentage of a blocked factorisation's
work happens in the matrix multiply, given the matrix size and the block width.

The narrow panel costs about the square times the block width, and the update to
everything else costs about the cube. Truncate towards zero.

@kind output
@concept The move is not making the memory bound level faster, which is
impossible, but arranging for almost none of the work to be in it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The two terms are the cube and the square times the width, and the answer
is the first as a fraction of both together.
@diagnose assert verdict assert-failed
A check disagrees. The panel's cost grows as the square and the update's as the
cube, so the share moves towards a hundred percent as the matrix grows rather
than staying fixed. That is the entire reason the rewrite worked.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after As the problem grows the cubic term dominates, so almost all the
arithmetic ends up inside the operation that can run at peak and the part that
cannot becomes negligible.

```starter
unsigned level3_share_pct(unsigned long n, unsigned block) {
    (void)block;
    return n ? 100 : 0;
}
```

```tests
#include <assert.h>
unsigned level3_share_pct(unsigned long, unsigned);
int main(void) {
    /* n = 100, block 10: 1000000 against 100000. */
    assert(level3_share_pct(100, 10) == 90);
    /* Ten times larger. */
    assert(level3_share_pct(1000, 10) == 99);
    /* A wide block at a small size. */
    assert(level3_share_pct(100, 100) == 50);
    assert(level3_share_pct(0, 10) == 0);
    return 0;
}
```

```solution
unsigned level3_share_pct(unsigned long n, unsigned block) {
    if (!n) return 0;
    unsigned long cube = n * n * n;
    unsigned long panel = n * n * (unsigned long)block;
    return (unsigned)(cube * 100UL / (cube + panel));
}
```
