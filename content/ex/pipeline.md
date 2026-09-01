## The chain and the tree

Write `chain_depth`, returning how many additions deep a reduction is, for `n`
values combined either left to right or pairwise.

Left to right is `n - 1` additions in a row. Pairwise halves the count at each
round, so the depth is the number of halvings.

@kind output
@concept Out-of-order execution runs what does not depend on something still
running, so the depth of the dependency chain is the number that decides whether
the machine is busy.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count rounds: pairwise, how many times can you halve `n` before reaching
one?
@diagnose assert verdict assert-failed
A check disagrees. The pairwise depth is the number of halving rounds, which for
8 values is 3 and for 1024 is 10, not 512. The starter returns half the chain
length, which is a different and much larger number.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Both arrangements perform the same `n - 1` additions. Only the shape
differs, and the shape decides whether the adder can start a new operation every
cycle or has to wait for the previous result. In a loop accumulating a million
values that is typically a factor of four.

```starter
#include <stddef.h>
size_t chain_depth(size_t n, int pairwise) {
    if (n <= 1) return 0;
    return pairwise ? (n - 1) / 2 : n - 1;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t chain_depth(size_t, int);
int main(void) {
    assert(chain_depth(1, 0) == 0);
    assert(chain_depth(1, 1) == 0);
    assert(chain_depth(2, 0) == 1);
    assert(chain_depth(2, 1) == 1);
    assert(chain_depth(8, 0) == 7);
    assert(chain_depth(8, 1) == 3);
    assert(chain_depth(1024, 0) == 1023);
    assert(chain_depth(1024, 1) == 10);
    /* Not a power of two: one extra round for the leftover. */
    assert(chain_depth(5, 1) == 3);
    return 0;
}
```

```solution
#include <stddef.h>
size_t chain_depth(size_t n, int pairwise) {
    if (n <= 1) return 0;
    if (!pairwise) return n - 1;
    size_t d = 0;
    while (n > 1) { n = (n + 1) / 2; d++; }
    return d;
}
```

## A two-bit saturating counter

The standard branch predictor per branch is a two-bit counter. It predicts taken
when the value is 2 or 3, increments on a taken branch and decrements on a
not-taken one, and saturates at both ends.

Write `mispredicts`, counting how many times this predictor is wrong on a
sequence, starting from state 1.

@kind output
@concept Two bits rather than one means a single exception does not flip the
prediction, which is what makes a loop with one unusual iteration cheap.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Predict first, compare, then update. The counter saturates rather than
wrapping.
@diagnose assert verdict assert-failed
A check disagrees. Saturation matters: at 3 a taken branch leaves the state at 3
rather than moving to 0, and at 0 a not-taken branch leaves it at 0. Without it a
long run of one outcome eventually predicts the opposite.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Watch the long run with one exception. The not-taken branch costs a
misprediction and moves the counter from 3 to 2, which still predicts taken, so
the very next iteration is right again. One bit would have flipped outright and
been wrong twice. That is the entire reason the counter has two bits and not one,
and it is also why the alternating case is wrong every time: nothing with a
short memory predicts a pattern that changes on every branch.

```starter
#include <stddef.h>
size_t mispredicts(const unsigned char *taken, size_t n) {
    int state = 1;
    size_t wrong = 0;
    for (size_t i = 0; i < n; i++) {
        int predict = state >= 2;
        if (predict != taken[i]) wrong++;
        state = taken[i] ? state + 1 : state - 1;
    }
    return wrong;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t mispredicts(const unsigned char *, size_t);
int main(void) {
    /* Always taken. State 1 predicts not-taken once, then learns. */
    unsigned char always[8] = {1,1,1,1,1,1,1,1};
    assert(mispredicts(always, 8) == 1);
    /* Always not taken: state 1 already predicts not-taken. */
    unsigned char never[8] = {0,0,0,0,0,0,0,0};
    assert(mispredicts(never, 8) == 0);
    /* A long run of taken with one exception near the end. */
    unsigned char loopish[10] = {1,1,1,1,1,1,1,1,0,1};
    assert(mispredicts(loopish, 10) == 2);
    /* Alternating from the initial state is wrong every single time. */
    unsigned char alt[8] = {1,0,1,0,1,0,1,0};
    assert(mispredicts(alt, 8) == 8);
    /* Twelve taken, then six not taken. A counter that keeps climbing takes
       twelve decrements to change its mind; one that saturates takes two. */
    unsigned char turn[18];
    for (int i = 0; i < 12; i++) turn[i] = 1;
    for (int i = 12; i < 18; i++) turn[i] = 0;
    assert(mispredicts(turn, 18) == 3);
    return 0;
}
```

```solution
#include <stddef.h>
size_t mispredicts(const unsigned char *taken, size_t n) {
    int state = 1;
    size_t wrong = 0;
    for (size_t i = 0; i < n; i++) {
        int predict = state >= 2;
        if (predict != taken[i]) wrong++;
        if (taken[i]) { if (state < 3) state++; }
        else          { if (state > 0) state--; }
    }
    return wrong;
}
```

## What a wrong guess costs

Write `branch_cycles`, returning the total cycles a sequence of branches costs,
given that a correct prediction is 1 cycle and a wrong one is 1 plus a penalty.

The predictor is the two-bit counter from the previous exercise.

@kind output
@concept The cost of a branch is not the branch, it is the misprediction rate
times the pipeline depth, which is why a perfectly predicted branch is nearly
free.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Every branch costs one cycle. The mispredicted ones cost the penalty on
top.
@diagnose assert verdict assert-failed
A check disagrees. Every branch costs its cycle whether or not it was predicted,
and a wrong guess adds the penalty rather than replacing the cycle. The starter
charges the penalty and nothing else.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A thousand-iteration loop with a penalty of 20 costs about 1020 cycles for
its branches. The same thousand branches with an unpredictable condition cost
around 11000. That is the same instruction count, and it is why sorting an array
before a loop that tests each element makes the loop several times faster.

```starter
#include <stddef.h>
size_t branch_cycles(const unsigned char *taken, size_t n, size_t penalty) {
    int state = 1;
    size_t cycles = 0;
    for (size_t i = 0; i < n; i++) {
        int predict = state >= 2;
        if (predict != taken[i]) cycles += penalty;
        if (taken[i]) { if (state < 3) state++; }
        else          { if (state > 0) state--; }
    }
    return cycles;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t branch_cycles(const unsigned char *, size_t, size_t);
int main(void) {
    unsigned char always[8] = {1,1,1,1,1,1,1,1};
    /* Eight branches, one mispredicted, penalty 20. */
    assert(branch_cycles(always, 8, 20) == 28);
    unsigned char never[8] = {0,0,0,0,0,0,0,0};
    assert(branch_cycles(never, 8, 20) == 8);
    unsigned char alt[8] = {1,0,1,0,1,0,1,0};
    assert(branch_cycles(alt, 8, 20) == 168);
    /* A penalty of zero makes every branch cost its one cycle. */
    assert(branch_cycles(alt, 8, 0) == 8);
    return 0;
}
```

```solution
#include <stddef.h>
size_t branch_cycles(const unsigned char *taken, size_t n, size_t penalty) {
    int state = 1;
    size_t cycles = 0;
    for (size_t i = 0; i < n; i++) {
        int predict = state >= 2;
        cycles += 1;
        if (predict != taken[i]) cycles += penalty;
        if (taken[i]) { if (state < 3) state++; }
        else          { if (state > 0) state--; }
    }
    return cycles;
}
```

## Three sums, three answers

Floating point addition is not associative, so regrouping a sum changes the
rounding and therefore the result.

Write `sum_pairwise`, which adds `n` values by repeatedly combining adjacent
pairs. The checks compare it against the same values summed left to right, in
both orders, and the three answers differ.

@kind output
@concept The compiler may not reassociate a floating point sum, because the
grouping is part of the specified result rather than an implementation detail.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Combine `t[2i]` and `t[2i+1]` into `t[i]`, halve the width, repeat. An odd
element carries forward untouched.
@diagnose assert verdict assert-failed
A check disagrees. The three expected values are not arbitrary: 16777216 is 2 to
the 24, where a 32-bit float's steps become larger than one, so seven ones added
before it survive and seven ones added after it vanish. Pairwise keeps most of
them and lands closest to the true total of 16777223.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Three groupings, three answers, all correct arithmetic. This is why a
compiler asked to optimise a reduction has to leave it alone, and why
`-ffast-math` grants permission to change results. That flag also permits
assuming no infinities and no not-a-numbers, which turns some correct code into
wrong code silently.

```starter
#include <stddef.h>
float sum_pairwise(const float *a, size_t n) {
    float s = 0.0f;
    for (size_t i = 0; i < n; i++) s += a[i];
    return s;
}
```

```tests
#include <assert.h>
#include <stddef.h>
float sum_pairwise(const float *, size_t);

static float seq(const float *a, size_t n) {
    float s = 0.0f;
    for (size_t i = 0; i < n; i++) s += a[i];
    return s;
}

int main(void) {
    float small_first[8] = {1,1,1,1,1,1,1, 16777216.0f};
    float big_first[8]   = {16777216.0f, 1,1,1,1,1,1,1};
    /* Measured, not derived. The true total is 16777223. */
    assert(seq(small_first, 8) == 16777224.0f);
    assert(seq(big_first, 8) == 16777216.0f);
    assert(sum_pairwise(small_first, 8) == 16777222.0f);
    assert(sum_pairwise(big_first, 8) == 16777222.0f);
    /* On values that need no rounding, every grouping agrees. */
    float exact[4] = {1.0f, 2.0f, 3.0f, 4.0f};
    assert(sum_pairwise(exact, 4) == 10.0f);
    assert(sum_pairwise(exact, 4) == seq(exact, 4));
    return 0;
}
```

```solution
#include <stddef.h>
float sum_pairwise(const float *a, size_t n) {
    float t[64];
    if (n == 0) return 0.0f;
    for (size_t i = 0; i < n; i++) t[i] = a[i];
    while (n > 1) {
        size_t w = n / 2;
        for (size_t i = 0; i < w; i++) t[i] = t[2 * i] + t[2 * i + 1];
        if (n % 2) t[w] = t[n - 1];
        n = w + (n % 2);
    }
    return t[0];
}
```

## Several accumulators

A reduction into one variable is one dependency chain. Splitting it across
several partial sums gives the processor independent work.

Write `sum_split`, which accumulates into `k` partial sums by index and combines
them at the end, over integers where the arithmetic is exact.

@kind output
@concept Independent chains let the adder start a new operation every cycle
instead of waiting for the previous result, and the total arithmetic is unchanged.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Element `i` goes into accumulator `i % k`. Combine the accumulators after
the loop.
@diagnose assert verdict assert-failed
A check disagrees. Every element has to land in exactly one accumulator and every
accumulator has to be added into the total, so the answer equals the plain sum
whatever `k` is. The starter drops everything except the first accumulator.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The answer is identical for every `k`, which is the point: nothing about
the result changed and the dependency structure did. On integers the compiler is
allowed to do this for you. On floats it is not, for the reason the previous
exercise measured.

```starter
#include <stddef.h>
long sum_split(const long *a, size_t n, size_t k) {
    long acc[8] = {0};
    for (size_t i = 0; i < n; i++) acc[i % k] += a[i];
    return acc[0];
}
```

```tests
#include <assert.h>
#include <stddef.h>
long sum_split(const long *, size_t, size_t);
int main(void) {
    long a[8] = {1, 2, 3, 4, 5, 6, 7, 8};
    assert(sum_split(a, 8, 1) == 36);
    assert(sum_split(a, 8, 2) == 36);
    assert(sum_split(a, 8, 4) == 36);
    assert(sum_split(a, 8, 8) == 36);
    /* A count that is not a multiple of k still covers every element. */
    assert(sum_split(a, 5, 4) == 15);
    assert(sum_split(a, 0, 4) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
long sum_split(const long *a, size_t n, size_t k) {
    long acc[8] = {0};
    for (size_t i = 0; i < n; i++) acc[i % k] += a[i];
    long total = 0;
    for (size_t j = 0; j < k; j++) total += acc[j];
    return total;
}
```

## Lanes, and the tail

A vector instruction operates on several values at once. An element count that is
not a multiple of the width leaves a remainder that has to be done one at a time.

Write `vector_plan`, returning how many vector iterations and how many scalar
ones a loop of `n` elements needs at a given width.

@kind output
@concept The vector width divides the work and the remainder is handled rather
than prevented, which is why a vectorised loop has two loops in it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Integer division gives the full vectors and the modulus gives the tail.
@diagnose assert verdict assert-failed
A check disagrees. Rounding the vector count up would process elements past the
end of the array, which is why the tail exists at all. Round down and handle the
remainder separately.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Sixteen floats per instruction at 512 bits, eight at 256, four at 128. A
loop of 100 elements at width 8 is twelve vector iterations and four scalar ones,
and the tail is why a hot loop is often padded to a multiple of the width rather
than left to handle it.

```starter
#include <stddef.h>
void vector_plan(size_t n, size_t width, size_t *vecs, size_t *tail) {
    *vecs = (n + width - 1) / width;
    *tail = 0;
}
```

```tests
#include <assert.h>
#include <stddef.h>
void vector_plan(size_t, size_t, size_t *, size_t *);
int main(void) {
    size_t v, t;
    vector_plan(64, 8, &v, &t);
    assert(v == 8 && t == 0);
    vector_plan(100, 8, &v, &t);
    assert(v == 12 && t == 4);
    vector_plan(7, 8, &v, &t);
    assert(v == 0 && t == 7);
    vector_plan(16, 16, &v, &t);
    assert(v == 1 && t == 0);
    vector_plan(0, 4, &v, &t);
    assert(v == 0 && t == 0);
    return 0;
}
```

```solution
#include <stddef.h>
void vector_plan(size_t n, size_t width, size_t *vecs, size_t *tail) {
    *vecs = n / width;
    *tail = n % width;
}
```

## The pointers that might be the same

A compiler vectorises a loop only when it can prove the iterations are
independent. Two pointers that might overlap defeat that proof, because a write
in one iteration could change a read in the next.

Write `copy_scaled`, which must produce the correct result even when the two
ranges overlap with the destination after the source.

@kind output
@concept An optimiser needs a proof rather than a probability, and two pointers
it cannot separate are two pointers that might be the same.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint When the destination is after the source and they overlap, a forward loop
overwrites values it has not read yet.
@diagnose assert verdict assert-failed
A check disagrees on the overlapping case. Copying forwards writes `dst[0]`
before reading `src[1]`, and when `dst` is `src + 1` those are the same
location. Going backwards reads every element before anything overwrites it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is exactly the case a compiler must assume is possible, which is why
it will not vectorise the forward version. Adding `restrict` to both parameters
promises the ranges do not overlap, the compiler vectorises, and the promise
becomes yours to keep: break it and the result is whatever the vectorised code
happens to do.

```starter
#include <stddef.h>
void copy_scaled(long *dst, const long *src, size_t n, long k) {
    for (size_t i = 0; i < n; i++) dst[i] = src[i] * k;
}
```

```tests
#include <assert.h>
#include <stddef.h>
void copy_scaled(long *, const long *, size_t, long);
int main(void) {
    long a[8] = {1, 2, 3, 4, 5, 6, 7, 8};
    long out[8];
    copy_scaled(out, a, 8, 2);
    for (int i = 0; i < 8; i++) assert(out[i] == (i + 1) * 2);
    /* Overlapping, destination after source by one. */
    long b[6] = {1, 2, 3, 4, 5, 0};
    copy_scaled(b + 1, b, 5, 3);
    assert(b[0] == 1);
    assert(b[1] == 3 && b[2] == 6 && b[3] == 9 && b[4] == 12 && b[5] == 15);
    /* Disjoint again, to confirm nothing was broken for the ordinary case. */
    long c[4] = {2, 4, 6, 8};
    long d[4];
    copy_scaled(d, c, 4, 10);
    assert(d[0] == 20 && d[3] == 80);
    return 0;
}
```

```solution
#include <stddef.h>
void copy_scaled(long *dst, const long *src, size_t n, long k) {
    for (size_t i = n; i > 0; i--) dst[i - 1] = src[i - 1] * k;
}
```

## Latency against throughput

An instruction's latency is how long until its result is usable. Its throughput
is how often a new one can start. They are different numbers, and which matters
depends on whether your next operation needs the previous answer.

Write `issue_cycles`, returning how many cycles `n` operations take: `latency`
each if they form a chain, and `n` times the reciprocal throughput if they are
independent.

@kind output
@concept A four-cycle multiply that accepts a new operand every cycle is either
four times slower or exactly as fast, depending entirely on the dependency
structure.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A chain of `n` operations at latency `L` takes `n` times `L`. Independent
ones are limited by how often a new one can begin.
@diagnose assert verdict assert-failed
A check disagrees. Independent operations are not free: they are limited by
throughput, so `n` of them at one per cycle take `n` cycles and not `n` divided
by the latency. The chain is the one that pays the latency every time.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A million multiplies into one accumulator at four cycles of latency is
four million cycles. The same million split across four accumulators is one
million, because the unit is busy every cycle. The instruction count never
changed, and neither did the arithmetic.

```starter
#include <stddef.h>
size_t issue_cycles(size_t n, size_t latency, size_t recip_tput, int chained) {
    (void)recip_tput;
    return n * latency / (chained ? 1 : latency);
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t issue_cycles(size_t, size_t, size_t, int);
int main(void) {
    /* Four-cycle latency, one per cycle. */
    assert(issue_cycles(100, 4, 1, 1) == 400);
    assert(issue_cycles(100, 4, 1, 0) == 100);
    /* A unit that accepts one every two cycles. */
    assert(issue_cycles(100, 4, 2, 0) == 200);
    assert(issue_cycles(100, 4, 2, 1) == 400);
    /* Latency one is the same either way. */
    assert(issue_cycles(50, 1, 1, 1) == 50);
    assert(issue_cycles(50, 1, 1, 0) == 50);
    assert(issue_cycles(0, 4, 1, 1) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
size_t issue_cycles(size_t n, size_t latency, size_t recip_tput, int chained) {
    return chained ? n * latency : n * recip_tput;
}
```
