## Misses, not elements

Write `sequential_misses`, returning how many cache lines a sequential walk over
an array touches, given the element count, the element size in bytes and the
line size in bytes.

The elements are contiguous and the walk starts at the beginning of a line.
Every line holding any of them is fetched exactly once.

@kind output
@concept The second cost model counts memory movement, and a sequential walk
moves far fewer lines than it touches elements.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Total bytes over line size, rounded up, because a partly used line was
still fetched whole.
@diagnose assert verdict assert-failed
A check disagrees. Eight bytes of element in a sixty four byte line means eight
elements share a fetch, so a million elements are a hundred and twenty five
thousand misses rather than a million. Rounding down loses the final partial
line.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is the whole reason a contiguous walk is cheap. The operation count
did not change; the number of trips to memory divided by eight.

```starter
unsigned long sequential_misses(unsigned long n, unsigned elem, unsigned line) {
    (void)elem; (void)line;
    return n;
}
```

```tests
#include <assert.h>
unsigned long sequential_misses(unsigned long, unsigned, unsigned);
int main(void) {
    assert(sequential_misses(8, 8, 64) == 1);
    assert(sequential_misses(9, 8, 64) == 2);
    assert(sequential_misses(1048576, 8, 64) == 131072);
    assert(sequential_misses(1000, 4, 64) == 63);   /* 4000 bytes over 64 */
    assert(sequential_misses(0, 8, 64) == 0);
    assert(sequential_misses(10, 64, 64) == 10);    /* one element per line */
    return 0;
}
```

```solution
unsigned long sequential_misses(unsigned long n, unsigned elem, unsigned line) {
    if (!line) return 0;
    unsigned long bytes = n * elem;
    return (bytes + line - 1) / line;
}
```

## Misses when the order is shuffled

Write `chase_misses`, returning how many lines a pointer chase touches, given
the node count, the node size and the line size.

The nodes are shuffled, so each visit lands on a line unrelated to the last one.
When the whole structure fits in the cache the lines are only fetched once each;
when it does not, every visit is a miss.

Given the cache size in bytes, return the number of misses under each case.

@kind output
@concept The order the addresses are visited in is the variable, and it decides
whether the structure's size or its element count sets the cost.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two regimes. Compare the total footprint against the cache before
deciding which one applies.
@diagnose assert verdict assert-failed
A check disagrees. A shuffled walk over a structure that fits in the cache is
not a hundred times slower than a sequential one, because after the first pass
everything is resident. The penalty appears when the footprint stops fitting.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why the measured ratio grows with the input rather than being a
fixed constant: it tracks which level of the hierarchy the structure has fallen
out of.

```starter
unsigned long chase_misses(unsigned long n, unsigned node, unsigned line,
                           unsigned long cache) {
    (void)line; (void)cache; (void)node;
    return n;
}
```

```tests
#include <assert.h>
unsigned long chase_misses(unsigned long, unsigned, unsigned, unsigned long);
int main(void) {
    /* 1000 nodes of 16 bytes is 16 KB, which fits in a 32 KB cache:
       every line is fetched once, and there are 250 of them. */
    assert(chase_misses(1000, 16, 64, 32768) == 250);
    /* The same nodes with a tiny cache: every visit misses. */
    assert(chase_misses(1000, 16, 64, 4096) == 1000);
    /* Exactly filling the cache still fits. */
    assert(chase_misses(256, 16, 64, 4096) == 64);
    assert(chase_misses(0, 16, 64, 4096) == 0);
    return 0;
}
```

```solution
unsigned long chase_misses(unsigned long n, unsigned node, unsigned line,
                           unsigned long cache) {
    if (!line) return 0;
    unsigned long bytes = n * node;
    if (bytes <= cache) return (bytes + line - 1) / line;
    return n;
}
```

## What the misses cost when they overlap

Write `access_time_ns`, returning how long a set of misses takes in nanoseconds,
given the miss count, the latency of one miss, and how many can be in flight at
once.

Independent misses overlap, so the total is the count divided by how many
overlap, times the latency. A dependent chain has one in flight, so nothing
overlaps and the total is the count times the latency.

Round the division up: a partial group still costs a full latency.

@kind output
@concept The difference between bandwidth bound and latency bound is one
division, and it is the whole gap between the two linked list columns.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A chain is the case where the number in flight is one, and it should fall
out of the same formula rather than needing its own branch.
@diagnose assert verdict assert-failed
A check disagrees. Twelve misses in flight makes a thousand misses cost
eighty four latencies, not a thousand. And rounding down charges nothing for the
last partial group.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The hardware can keep about a dozen line fills outstanding. A dependent
chain cannot use any of them, because the address of the next load is the result
of the current one.

```starter
unsigned long access_time_ns(unsigned long misses, unsigned latency_ns,
                             unsigned in_flight) {
    (void)in_flight;
    return misses * latency_ns;
}
```

```tests
#include <assert.h>
unsigned long access_time_ns(unsigned long, unsigned, unsigned);
int main(void) {
    /* A dependent chain: nothing overlaps. */
    assert(access_time_ns(1000, 100, 1) == 100000);
    /* Twelve in flight. */
    assert(access_time_ns(1200, 100, 12) == 10000);
    assert(access_time_ns(1000, 100, 12) == 8400);   /* 84 groups, rounded up */
    assert(access_time_ns(0, 100, 12) == 0);
    assert(access_time_ns(5, 100, 12) == 100);       /* one partial group */
    return 0;
}
```

```solution
unsigned long access_time_ns(unsigned long misses, unsigned latency_ns,
                             unsigned in_flight) {
    if (!in_flight) return 0;
    unsigned long groups = (misses + in_flight - 1) / in_flight;
    return groups * latency_ns;
}
```

## Which of two identical complexities wins

Write `faster`, deciding which of two approaches with the same complexity is
faster, given each one's operation count, its miss count, the cost of an
operation in tenths of a nanosecond, and the cost of a miss in nanoseconds.

Return 0 when the first is faster, 1 when the second is, and 2 when they are
equal.

@kind output
@concept Both models at once, which is what actually predicts a measurement:
the operations are real and the misses are usually what decides.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Put both terms in the same units before adding them, and the smaller
number is the faster one.
@diagnose assert verdict assert-failed
A check disagrees. Comparing operation counts alone picks the approach that does
less arithmetic and more waiting, which is exactly the mistake the unit is
about. A hundred nanosecond miss is worth a thousand tenths of a nanosecond.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Two structures with identical complexity, identical allocation and
identical operation counts measured six hundred times apart, and this is the
arithmetic that saw it coming.

```starter
int faster(unsigned long ops_a, unsigned long miss_a,
           unsigned long ops_b, unsigned long miss_b,
           unsigned op_tenths, unsigned miss_ns) {
    (void)miss_a; (void)miss_b; (void)op_tenths; (void)miss_ns;
    if (ops_a < ops_b) return 0;
    if (ops_b < ops_a) return 1;
    return 2;
}
```

```tests
#include <assert.h>
int faster(unsigned long, unsigned long, unsigned long, unsigned long,
           unsigned, unsigned);
int main(void) {
    /* A does twice the operations and a tenth of the misses: A wins. */
    assert(faster(2000, 100, 1000, 1000, 3, 100) == 0);
    /* Same operations, B misses less: B wins. */
    assert(faster(1000, 500, 1000, 50, 3, 100) == 1);
    /* Identical. */
    assert(faster(1000, 100, 1000, 100, 3, 100) == 2);
    /* No misses at all: the operations decide. */
    assert(faster(2000, 0, 1000, 0, 3, 100) == 1);
    return 0;
}
```

```solution
int faster(unsigned long ops_a, unsigned long miss_a,
           unsigned long ops_b, unsigned long miss_b,
           unsigned op_tenths, unsigned miss_ns) {
    unsigned long a = ops_a * op_tenths + miss_a * miss_ns * 10UL;
    unsigned long b = ops_b * op_tenths + miss_b * miss_ns * 10UL;
    if (a < b) return 0;
    if (b < a) return 1;
    return 2;
}
```

## Reading the hierarchy out of a timing

Write `level_of`, returning which level of the hierarchy a measured access time
belongs to, given the time in tenths of a nanosecond.

Up to 2.0 nanoseconds is the first level, up to 12.0 the second, up to 60.0 the
third, and anything above that is main memory. Return 1, 2, 3 or 4.

@kind output
@concept The knees in a timing curve land on the cache sizes, which is how a
twenty line program reads a machine's hierarchy with no documentation.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The boundaries are inclusive at the top of each level, and the units are
tenths.
@diagnose assert verdict assert-failed
A check disagrees. Exactly at a boundary belongs to the faster level, and 103
nanoseconds is main memory rather than the third level. Working in whole
nanoseconds throws away the resolution that separates the first two.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The knees fall exactly on the sizes the machine reports for its own
caches, which converts the memory hierarchy from something you were told into
something you measured.

```starter
int level_of(unsigned tenths_ns) {
    if (tenths_ns < 20) return 1;
    if (tenths_ns < 120) return 2;
    if (tenths_ns < 600) return 3;
    return 4;
}
```

```tests
#include <assert.h>
int level_of(unsigned);
int main(void) {
    assert(level_of(11) == 1);      /* 1.1 ns */
    assert(level_of(20) == 1);      /* exactly 2.0 ns */
    assert(level_of(21) == 2);
    assert(level_of(48) == 2);      /* 4.8 ns */
    assert(level_of(120) == 2);
    assert(level_of(121) == 3);
    assert(level_of(346) == 3);     /* 34.6 ns */
    assert(level_of(600) == 3);
    assert(level_of(1033) == 4);    /* 103.3 ns */
    return 0;
}
```

```solution
int level_of(unsigned tenths_ns) {
    if (tenths_ns <= 20) return 1;
    if (tenths_ns <= 120) return 2;
    if (tenths_ns <= 600) return 3;
    return 4;
}
```

## The ratio that grows

Write `ratio`, returning how many times slower a chase is than a scan, given the
time each takes in microseconds, truncated.

Return 0 when the scan took no time at all, since there is no ratio to report.

@kind output
@concept The constant factor is a function of the input here, because it tracks
which level of the hierarchy the structure has fallen out of.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One division, guarded, in a type wide enough that a large chase time does
not wrap.
@diagnose assert verdict assert-failed
A check disagrees. A ratio is a division rather than a difference, and the
difference between 1800 and 2.83 milliseconds is not six hundred.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Twelve times, then seventy nine, then three hundred and seventy seven,
then over six hundred. There is no crossing point where the list catches up;
the gap widens.

```starter
unsigned long ratio(unsigned long chase_us, unsigned long scan_us) {
    return chase_us - scan_us;
}
```

```tests
#include <assert.h>
unsigned long ratio(unsigned long, unsigned long);
int main(void) {
    assert(ratio(19600, 1600) == 12);
    assert(ratio(100500, 1270) == 79);
    assert(ratio(714000, 1890) == 377);
    assert(ratio(1800300, 2830) == 636);
    assert(ratio(1000, 0) == 0);
    return 0;
}
```

```solution
unsigned long ratio(unsigned long chase_us, unsigned long scan_us) {
    if (!scan_us) return 0;
    return chase_us / scan_us;
}
```

## Pages, and the walk behind them

Write `tlb_covered`, deciding whether a structure's pages all fit in the
translation cache, given the structure's size in bytes, the page size and how
many pages the translation cache holds.

When they do not fit, most accesses pay for a page walk on top of the miss.

@kind output
@concept It is the second thing the model does not charge for, and it is why the
measured ratio came out higher than the latency arithmetic predicted.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Pages needed is the size over the page size, rounded up, and the question
is whether that number fits.
@diagnose assert verdict assert-failed
A check disagrees. A hundred and twenty eight megabytes at sixteen kilobyte
pages is eight thousand pages, which no translation cache holds, and rounding
the page count down hides the case that only just overflows.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is the reason large pages exist as a tuning option: they do not make
memory faster, they make the translation of an address stop missing.

```starter
int tlb_covered(unsigned long bytes, unsigned page, unsigned entries) {
    if (!page) return 0;
    return bytes / page <= entries;
}
```

```tests
#include <assert.h>
int tlb_covered(unsigned long, unsigned, unsigned);
int main(void) {
    /* 128 MB at 16 KB pages is 8192 pages, against 2048 entries. */
    assert(tlb_covered(134217728UL, 16384, 2048) == 0);
    /* 16 MB is 1024 pages, which fits. */
    assert(tlb_covered(16777216UL, 16384, 2048) == 1);
    /* Exactly filling it. */
    assert(tlb_covered(33554432UL, 16384, 2048) == 1);
    /* One byte more needs one page more. */
    assert(tlb_covered(33554433UL, 16384, 2048) == 0);
    /* Large pages fix the first case. */
    assert(tlb_covered(134217728UL, 2097152, 2048) == 1);
    return 0;
}
```

```solution
int tlb_covered(unsigned long bytes, unsigned page, unsigned entries) {
    if (!page) return 0;
    unsigned long pages = (bytes + page - 1) / page;
    return pages <= entries;
}
```

## When the better complexity actually wins

Write `crossover`, returning the smallest input size at which an algorithm
costing `b` operations per element beats one costing `a` operations per element
squared, or 0 if it wins at every size from 1 upwards.

The first costs `a * n * n` and the second costs `b * n`, so the second wins
once `a * n` exceeds `b`.

Sizes are whole numbers and the search starts at 1.

@kind output
@concept The notation is right about growth, and growth is what decides whether
an approach can work at all. This is the arithmetic of when that starts to bite.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Solve the comparison rather than searching, and be careful about the size
where the two are exactly equal.
@diagnose assert verdict assert-failed
A check disagrees. At the size where the costs are equal, neither wins, so the
crossover is the next one up. And when the linear algorithm already wins at a
size of one, the answer is that there is no crossover to report.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after No amount of constant factor tuning rescues a quadratic algorithm on a
large input, and the notation tells you that before you write anything. What it
does not tell you is which of two linear algorithms to pick.

```starter
unsigned crossover(unsigned a, unsigned b) {
    if (!a) return 0;
    return b / a;
}
```

```tests
#include <assert.h>
unsigned crossover(unsigned, unsigned);
int main(void) {
    /* n*n beats 100n until n exceeds 100. */
    assert(crossover(1, 100) == 101);
    /* Equal at n = 100, so the crossover is 101. */
    assert(crossover(2, 200) == 101);
    /* The linear one wins immediately. */
    assert(crossover(5, 3) == 0);
    assert(crossover(1, 1) == 2);   /* equal at 1, so it wins from 2 */
    assert(crossover(1, 2) == 3);
    return 0;
}
```

```solution
unsigned crossover(unsigned a, unsigned b) {
    if (!a) return 0;
    unsigned n = b / a + 1;
    return n > 1 ? n : 0;
}
```
