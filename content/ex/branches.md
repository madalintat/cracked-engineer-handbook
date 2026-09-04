## What a branch costs

Write `branch_cycles`, returning how many cycles a loop spends on one branch,
given the iteration count, the mispredict rate in percent and the penalty of a
mispredict in cycles.

A branch the machine guesses right costs nothing at all, because it continues
past it speculatively and is proved correct. Only the wrong guesses cost
anything.

@kind output
@concept The predictor is part of the cost model, and the free case being
genuinely free is what makes the unpredictable case expensive by comparison.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only the mispredicted fraction of the iterations is charged for.
@diagnose assert verdict assert-failed
A check disagrees. A perfectly predicted branch costs zero rather than one cycle
per iteration, which is the whole reason removing it can make a loop slower.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The penalty differed by a factor of three between the two machines
measured. It is a parameter of the microarchitecture rather than a constant of
computing.

```starter
unsigned long branch_cycles(unsigned long iters, unsigned rate_pct,
                            unsigned penalty) {
    return iters + iters * rate_pct / 100 * penalty;
}
```

```tests
#include <assert.h>
unsigned long branch_cycles(unsigned long, unsigned, unsigned);
int main(void) {
    assert(branch_cycles(1000, 0, 15) == 0);      /* always right: free */
    assert(branch_cycles(1000, 100, 15) == 15000);
    assert(branch_cycles(1000, 50, 15) == 7500);  /* a coin flip */
    assert(branch_cycles(1000, 1, 15) == 150);
    assert(branch_cycles(0, 50, 15) == 0);
    return 0;
}
```

```solution
unsigned long branch_cycles(unsigned long iters, unsigned rate_pct,
                            unsigned penalty) {
    return iters * rate_pct / 100 * penalty;
}
```

## When to remove the branch

Write `go_branchless`, deciding whether replacing a branch with a conditional
move is worth it, given the mispredict rate in percent, the mispredict penalty
in cycles, and the cost of the move in cycles.

The branch costs its mispredict rate times its penalty per iteration. The move
costs its own cycles every iteration, whether or not the condition was
predictable. Choose the cheaper one, and keep the branch when they tie.

@kind output
@concept A conditional move converts a control dependency into a data
dependency, so it is never free and a correctly predicted branch is.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Work in hundredths of a cycle so the rate does not round away.
@diagnose assert verdict assert-failed
A check disagrees. A branch that is right ninety nine times out of a hundred
costs about a sixth of a cycle against a full cycle for the move, so the move
loses. Rounding the branch's cost down to zero cycles makes it win everywhere,
which is the folklore this exercise exists to correct.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why a compiler sometimes emits a branch where you expected a
move, and why profile guided optimisation exists: the compiler is guessing at
the rate, and a profile stops it guessing.

```starter
int go_branchless(unsigned rate_pct, unsigned penalty, unsigned move_cost) {
    (void)penalty; (void)move_cost;
    return rate_pct > 0;
}
```

```tests
#include <assert.h>
int go_branchless(unsigned, unsigned, unsigned);
int main(void) {
    /* A coin flip against a 15 cycle penalty: 7.5 cycles against 1. */
    assert(go_branchless(50, 15, 1) == 1);
    /* Predictable: 0.15 cycles against 1. */
    assert(go_branchless(1, 15, 1) == 0);
    /* Never wrong. */
    assert(go_branchless(0, 15, 1) == 0);
    /* The break even point: 10 percent of 15 is 1.5, which beats 1. */
    assert(go_branchless(10, 15, 1) == 1);
    /* Exactly equal keeps the branch. */
    assert(go_branchless(10, 10, 1) == 0);
    return 0;
}
```

```solution
int go_branchless(unsigned rate_pct, unsigned penalty, unsigned move_cost) {
    unsigned branch_hundredths = rate_pct * penalty;
    unsigned move_hundredths = move_cost * 100u;
    return branch_hundredths > move_hundredths;
}
```

## Selecting without a branch

Write `select_masked`, returning one of two values according to a condition,
using only arithmetic and bit operations.

Turn the condition into a mask of all ones or all zeros, then combine. No
comparison operator that produces control flow, and no conditional expression.

@kind output
@concept The same selection a conditional move makes, built out of operations
that exist in every language, with no cooperation from the compiler.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Negating a zero or one gives all zeros or all ones in two's complement,
and that is the mask.
@diagnose assert verdict assert-failed
A check disagrees. A mask of one selects a single bit rather than a whole value,
so it has to be all ones. Negation is what turns one into all ones.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The compiler usually emits a conditional move for a ternary anyway. This
form matters when it will not, and when the language has no way to ask.

```starter
unsigned long select_masked(int cond, unsigned long a, unsigned long b) {
    unsigned long mask = (unsigned long)(cond != 0);
    return (a & mask) | (b & ~mask);
}
```

```tests
#include <assert.h>
unsigned long select_masked(int, unsigned long, unsigned long);
int main(void) {
    assert(select_masked(1, 111, 222) == 111);
    assert(select_masked(0, 111, 222) == 222);
    assert(select_masked(1, 0, 0xffffffffffffffffUL) == 0);
    assert(select_masked(0, 0, 0xffffffffffffffffUL) == 0xffffffffffffffffUL);
    /* Any non-zero condition is true. */
    assert(select_masked(7, 111, 222) == 111);
    return 0;
}
```

```solution
unsigned long select_masked(int cond, unsigned long a, unsigned long b) {
    unsigned long mask = -(unsigned long)(cond != 0);
    return (a & mask) | (b & ~mask);
}
```

## Counting without branching

Write `count_below`, returning how many elements of an array are below a
threshold, without any conditional control flow in the loop body.

A comparison produces zero or one, so adding it directly is the count.

@kind output
@concept Predication by increment is the trick inside modern partitioning
implementations, and it works because a comparison is already a number.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The comparison is the value to add. There is nothing to test.
@diagnose assert verdict assert-failed
A check disagrees. Adding the element rather than the comparison sums the
values that pass, which is a different question and gives a different number.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Partitioning this way turns the most unpredictable branch in a sort into
arithmetic, and the compiler will vectorise it because there is no control flow
left to convert.

```starter
unsigned count_below(const int *v, unsigned n, int threshold) {
    unsigned c = 0;
    for (unsigned i = 0; i < n; i++) c += (unsigned)v[i] * (v[i] < threshold);
    return c;
}
```

```tests
#include <assert.h>
unsigned count_below(const int *, unsigned, int);
int main(void) {
    { int v[] = {1, 5, 2, 9}; assert(count_below(v, 4, 5) == 2); }
    { int v[] = {1, 1, 1};    assert(count_below(v, 3, 5) == 3); }
    { int v[] = {9, 9, 9};    assert(count_below(v, 3, 5) == 0); }
    { int v[] = {5};          assert(count_below(v, 1, 5) == 0); }
    { int v[] = {0, 0};       assert(count_below(v, 2, 1) == 2); }
    assert(count_below(0, 0, 5) == 0);
    return 0;
}
```

```solution
unsigned count_below(const int *v, unsigned n, int threshold) {
    unsigned c = 0;
    for (unsigned i = 0; i < n; i++) c += (unsigned)(v[i] < threshold);
    return c;
}
```

## How unpredictable a search is

Write `search_mispredicts`, returning how many mispredicted branches a binary
search performs per query on average, given the number of elements.

Each comparison eliminates exactly half the remaining space, so each one is a
coin flip and is wrong half the time. There are as many comparisons as times the
count can be halved.

Return the answer in hundredths of a branch.

@kind output
@concept Every branch being maximally unpredictable is not bad luck. It is the
definition of the algorithm.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count the halvings, then take half of them.
@diagnose assert verdict assert-failed
A check disagrees. A search over a thousand elements makes about ten
comparisons, and half of those are wrong, so it is five mispredicts and not ten.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A predictor cannot do better than chance here, because the algorithm is
designed so that each answer carries exactly one bit.

```starter
unsigned search_mispredicts(unsigned long n) {
    unsigned steps = 0;
    while (n > 1) { n >>= 1; steps++; }
    return steps * 100u;
}
```

```tests
#include <assert.h>
unsigned search_mispredicts(unsigned long);
int main(void) {
    assert(search_mispredicts(1024) == 500);      /* 10 steps, half wrong */
    assert(search_mispredicts(1048576) == 1000);  /* 20 steps */
    assert(search_mispredicts(2) == 50);
    assert(search_mispredicts(1) == 0);
    assert(search_mispredicts(0) == 0);
    return 0;
}
```

```solution
unsigned search_mispredicts(unsigned long n) {
    unsigned steps = 0;
    while (n > 1) { n >>= 1; steps++; }
    return steps * 50u;
}
```

## Walking a breadth first tree

Write `eytzinger_step`, returning the next index in a search over a tree stored
breadth first in a one indexed array, given the current index and whether the
value there is below the key.

The children of index k are at twice k and twice k plus one. Going right means
the stored value was below the key.

@kind output
@concept The comparison is added to the index rather than steering a branch,
which is what makes the loop branchless without any cleverness.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One multiplication and one addition, where the addition is the comparison
itself.
@diagnose assert verdict assert-failed
A check disagrees. The left child is twice the index and the right is one more,
so adding the comparison to twice the index reaches both. Adding it before
doubling reaches neither.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The gain is locality rather than the branch. The root and its first few
levels are packed into the first cache lines and stay resident, where a sorted
array puts the middle element and its quarter points megabytes apart.

```starter
unsigned long eytzinger_step(unsigned long k, int less) {
    return 2 * (k + (unsigned long)(less != 0));
}
```

```tests
#include <assert.h>
unsigned long eytzinger_step(unsigned long, int);
int main(void) {
    assert(eytzinger_step(1, 0) == 2);
    assert(eytzinger_step(1, 1) == 3);
    assert(eytzinger_step(3, 0) == 6);
    assert(eytzinger_step(3, 1) == 7);
    assert(eytzinger_step(7, 1) == 15);
    return 0;
}
```

```solution
unsigned long eytzinger_step(unsigned long k, int less) {
    return 2 * k + (unsigned long)(less != 0);
}
```

## How much of the tree stays resident

Write `resident_levels`, returning how many levels of a breadth first tree fit
in a cache, given the cache size in bytes and the size of one element.

Level zero is the single root. Each level holds twice as many nodes as the one
above it, so the first `L` levels hold two to the power of `L`, minus one,
nodes. Count the levels that fit entirely.

@kind output
@concept The top of the tree is what every query touches, and packing it into
the first few lines is the whole reason the layout wins.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Add levels while the running total of nodes still fits, and stop at the
first one that does not.
@diagnose assert verdict assert-failed
A check disagrees. The levels are cumulative, so fitting the fourth level means
fitting the fifteen nodes above and including it rather than its eight alone.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after In a sorted array there is no such structure. The first probe, the second
and the third are spread across the whole range, so none of them share anything.

```starter
unsigned resident_levels(unsigned long cache_bytes, unsigned elem) {
    if (!elem) return 0;
    unsigned long nodes = cache_bytes / elem;
    unsigned levels = 0;
    while ((1UL << levels) <= nodes) levels++;
    return levels;
}
```

```tests
#include <assert.h>
unsigned resident_levels(unsigned long, unsigned);
int main(void) {
    /* 64 bytes, 4 byte elements: 16 nodes, so levels 0 to 3 (15 nodes). */
    assert(resident_levels(64, 4) == 4);
    /* 4 nodes: the root and one level, which is 3 nodes. */
    assert(resident_levels(16, 4) == 2);
    /* Exactly one node. */
    assert(resident_levels(4, 4) == 1);
    assert(resident_levels(0, 4) == 0);
    /* 32 KB of 4 byte elements is 8192 nodes: 12 levels hold 4095. */
    assert(resident_levels(32768, 4) == 13);
    return 0;
}
```

```solution
unsigned resident_levels(unsigned long cache_bytes, unsigned elem) {
    if (!elem) return 0;
    unsigned long nodes = cache_bytes / elem;
    unsigned levels = 0;
    unsigned long total = 0, width = 1;
    while (total + width <= nodes) { total += width; width *= 2; levels++; }
    return levels;
}
```

## When prefetching pays

Write `prefetch_helps`, deciding whether prefetching ahead in a search is worth
it, given the data size in bytes and the cache size in bytes.

When the data fits in the cache there is nothing to fetch, so every prefetch is
a wasted instruction and wasted bandwidth. When it does not fit, the prefetch
turns a serial chain of dependent misses into several in flight at once.

@kind output
@concept The same optimisation swung from a sevenfold loss to a twofold win on
identical source, with only the input size changing.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One comparison, and data that exactly fills the cache still fits in it.
@diagnose assert verdict assert-failed
A check disagrees. Prefetching is a loss whenever the data is resident, so the
answer for a small array is no rather than yes. Assuming it always helps is
exactly the habit this measurement exists to break.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Seven times worse at a thousand elements, break even at four million,
twice as good at sixteen million. A single optimisation swinging that far on the
same code is the best inoculation there is against applying a technique because
it is known to be fast.

```starter
int prefetch_helps(unsigned long data_bytes, unsigned long cache_bytes) {
    (void)data_bytes; (void)cache_bytes;
    return 1;
}
```

```tests
#include <assert.h>
int prefetch_helps(unsigned long, unsigned long);
int main(void) {
    assert(prefetch_helps(4096, 32768) == 0);          /* fits */
    assert(prefetch_helps(32768, 32768) == 0);         /* exactly fits */
    assert(prefetch_helps(65536, 32768) == 1);
    assert(prefetch_helps(67108864, 8388608) == 1);
    return 0;
}
```

```solution
int prefetch_helps(unsigned long data_bytes, unsigned long cache_bytes) {
    return data_bytes > cache_bytes;
}
```
