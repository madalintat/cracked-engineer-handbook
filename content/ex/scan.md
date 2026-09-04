## The bound on parallel time

Write `parallel_time`, returning the upper bound on how long a parallel
algorithm takes, given its work, its depth and the processor count.

The bound is the work spread across the processors, plus the depth, since the
chain cannot be spread. Round the division up, because a partial round still
takes a step.

@kind output
@concept One inequality ties the two axes together, and it says the obvious
thing precisely: you can spread the work out and you cannot spread the chain.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The depth is added rather than compared against, because it is the part
that remains after everything else has been divided.
@diagnose assert verdict assert-failed
A check disagrees. With enough processors the time approaches the depth rather
than approaching zero, so the depth is a term in the sum and not a floor applied
afterwards.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after With one processor this gives the work plus the depth, which is the
sequential time and a little more, and that is the correct behaviour for a bound
rather than an exact cost.

```starter
unsigned long parallel_time(unsigned long work, unsigned long depth,
                            unsigned procs) {
    if (!procs) return 0;
    unsigned long t = (work + procs - 1) / procs;
    return t > depth ? t : depth;
}
```

```tests
#include <assert.h>
unsigned long parallel_time(unsigned long, unsigned long, unsigned);
int main(void) {
    /* 1000 work, depth 10, 10 processors. */
    assert(parallel_time(1000, 10, 10) == 110);
    /* Enough processors that the depth dominates. */
    assert(parallel_time(1000, 10, 1000) == 11);
    /* One processor. */
    assert(parallel_time(1000, 10, 1) == 1010);
    /* A partial round still costs a step. */
    assert(parallel_time(1001, 10, 10) == 111);
    assert(parallel_time(0, 10, 8) == 10);
    return 0;
}
```

```solution
unsigned long parallel_time(unsigned long work, unsigned long depth,
                            unsigned procs) {
    if (!procs) return 0;
    return (work + procs - 1) / procs + depth;
}
```

## How many processors are worth having

Write `useful_procs`, returning the largest processor count that still helps,
given the work and the depth.

Beyond work divided by depth the extra processors have nothing to do, because
the chain is what remains. Truncate towards zero, and a depth of zero means
there is no chain, so report the work.

@kind output
@concept It is the parallelism of the algorithm, and it is a property of the
algorithm rather than of the machine it runs on.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One division, and a guard for the case with no chain at all.
@diagnose assert verdict assert-failed
A check disagrees. An algorithm with a thousand units of work and a depth of ten
can use a hundred processors, not ten and not a thousand. The ratio is the
answer rather than either of its parts.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Adding processors past this number is adding idle cores, which is a
useful thing to be able to compute before buying a machine.

```starter
unsigned long useful_procs(unsigned long work, unsigned long depth) {
    return depth;
}
```

```tests
#include <assert.h>
unsigned long useful_procs(unsigned long, unsigned long);
int main(void) {
    assert(useful_procs(1000, 10) == 100);
    assert(useful_procs(1000, 1000) == 1);
    assert(useful_procs(1048576, 20) == 52428);
    assert(useful_procs(1000, 0) == 1000);
    return 0;
}
```

```solution
unsigned long useful_procs(unsigned long work, unsigned long depth) {
    if (!depth) return work;
    return work / depth;
}
```

## What the depth optimal scan costs

Write `hillis_steele_ops`, returning how many operations the doubling distance
scan performs, given the element count.

Every round touches every element, and there are as many rounds as times the
count can be doubled to reach it. A count of one needs no rounds at all.

@kind output
@concept Its depth is optimal and its work is not, which is the trade the two
axes exist to make visible.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count the rounds first, then multiply by the elements.
@diagnose assert verdict assert-failed
A check disagrees. A million elements take twenty rounds of a million
operations, which is twenty million rather than a million or twenty. The count
and the rounds multiply.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Counted on a real implementation at a million elements, this came to
exactly the count times its logarithm. The theory is not roughly right here; it
is precisely right.

```starter
unsigned long hillis_steele_ops(unsigned long n) {
    unsigned long rounds = 0, d = 1;
    while (d < n) { d <<= 1; rounds++; }
    return rounds;
}
```

```tests
#include <assert.h>
unsigned long hillis_steele_ops(unsigned long);
int main(void) {
    assert(hillis_steele_ops(8) == 24);
    assert(hillis_steele_ops(1024) == 10240);
    assert(hillis_steele_ops(1048576) == 20971520);
    assert(hillis_steele_ops(1) == 0);
    assert(hillis_steele_ops(0) == 0);
    return 0;
}
```

```solution
unsigned long hillis_steele_ops(unsigned long n) {
    unsigned long rounds = 0, d = 1;
    while (d < n) { d <<= 1; rounds++; }
    return rounds * n;
}
```

## What the work efficient scan costs

Write `blelloch_ops`, returning how many operations the two sweep scan performs,
given the element count.

Going up costs one less than the count in combinations. Coming down costs the
same again, plus one exchange per combination. A count of one or zero costs
nothing.

@kind output
@concept Linear work, and the constant is three rather than one, which is why
the comparison between the two algorithms depends on the size.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Three operations for every combination in the tree, and a tree over n
leaves has one fewer internal combination than it has leaves.
@diagnose assert verdict assert-failed
A check disagrees. Eight elements cost twenty one operations rather than seven
or eight: seven going up, and seven adds and seven exchanges coming down.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Counted on a real implementation at a million elements this came to
exactly three times one less than the count, which is the other half of the
table in the note.

```starter
unsigned long blelloch_ops(unsigned long n) {
    return n ? n - 1 : 0;
}
```

```tests
#include <assert.h>
unsigned long blelloch_ops(unsigned long);
int main(void) {
    assert(blelloch_ops(8) == 21);
    assert(blelloch_ops(1024) == 3069);
    assert(blelloch_ops(1048576) == 3145725);
    assert(blelloch_ops(1) == 0);
    assert(blelloch_ops(0) == 0);
    return 0;
}
```

```solution
unsigned long blelloch_ops(unsigned long n) {
    return n ? 3 * (n - 1) : 0;
}
```

## The scan itself

Write `exclusive_scan`, filling an output array with the exclusive prefix sums
of an input array.

The first output is zero, and each later one is the sum of every input before
it. The arrays do not overlap.

@kind output
@concept The sequential version is three lines, and its apparent dependence on
the previous output is exactly what associativity lets you break.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The running total is added to after it is written out, not before.
@diagnose assert verdict assert-failed
A check disagrees. An exclusive scan writes the total so far and then adds the
current element, so the first output is zero and the last input never appears in
the output at all. Adding first gives the inclusive scan, shifted.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The worked example in every reference is this one: three, one, seven,
zero, four, one, six, three becomes zero, three, four, eleven, eleven, fifteen,
sixteen, twenty two.

```starter
void exclusive_scan(const unsigned *in, unsigned *out, unsigned n) {
    unsigned total = 0;
    for (unsigned i = 0; i < n; i++) {
        total += in[i];
        out[i] = total;
    }
}
```

```tests
#include <assert.h>
void exclusive_scan(const unsigned *, unsigned *, unsigned);
int main(void) {
    { unsigned in[] = {3, 1, 7, 0, 4, 1, 6, 3};
      unsigned want[] = {0, 3, 4, 11, 11, 15, 16, 22};
      unsigned out[8];
      exclusive_scan(in, out, 8);
      for (unsigned i = 0; i < 8; i++) assert(out[i] == want[i]); }
    { unsigned in[] = {5}; unsigned out[1];
      exclusive_scan(in, out, 1);
      assert(out[0] == 0); }
    { unsigned in[] = {1, 1, 1}; unsigned want[] = {0, 1, 2}; unsigned out[3];
      exclusive_scan(in, out, 3);
      for (unsigned i = 0; i < 3; i++) assert(out[i] == want[i]); }
    exclusive_scan(0, 0, 0);
    return 0;
}
```

```solution
void exclusive_scan(const unsigned *in, unsigned *out, unsigned n) {
    unsigned total = 0;
    for (unsigned i = 0; i < n; i++) {
        out[i] = total;
        total += in[i];
    }
}
```

## Where each worker writes

Write `output_slot`, returning where a worker's output begins, given each
worker's output count and which worker is asking.

Every worker's outputs land contiguously, in worker order, with no gaps. This is
the scan of the counts, which is the reason the primitive matters.

@kind output
@concept Any time parallel workers produce a variable number of outputs and the
results have to end up packed, the answer is a scan of the counts.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The slot is the sum of everything the earlier workers produce, and the
worker's own count is not part of it.
@diagnose assert verdict assert-failed
A check disagrees. The first worker starts at zero however much it produces, and
including a worker's own count in its own offset leaves a gap the size of its
output before it and overlaps the next one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Filtering a stream, building a sparse matrix, a pass of a radix sort and
expanding a graph frontier are all this function, with a different meaning
attached to the counts.

```starter
unsigned output_slot(const unsigned *counts, unsigned worker) {
    unsigned total = 0;
    for (unsigned i = 0; i <= worker; i++) total += counts[i];
    return total;
}
```

```tests
#include <assert.h>
unsigned output_slot(const unsigned *, unsigned);
int main(void) {
    unsigned c[] = {3, 0, 5, 2};
    assert(output_slot(c, 0) == 0);
    assert(output_slot(c, 1) == 3);
    assert(output_slot(c, 2) == 3);   /* worker 1 produced nothing */
    assert(output_slot(c, 3) == 8);
    return 0;
}
```

```solution
unsigned output_slot(const unsigned *counts, unsigned worker) {
    unsigned total = 0;
    for (unsigned i = 0; i < worker; i++) total += counts[i];
    return total;
}
```

## What limits a scan in practice

Write `scan_time_us`, returning how long a scan takes in microseconds, given the
element count, the bytes per element, how many times the algorithm reads or
writes the whole array, and the bandwidth in megabytes per second.

A scan does almost no arithmetic per element, so the time is entirely the
traffic divided by the bandwidth. Truncate towards zero.

@kind output
@concept At the top level the objective function is bytes moved, which is why
the work efficient algorithm is not the fastest one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Total bytes is the array size times the number of passes over it, and a
megabyte per second is a byte per microsecond.
@diagnose assert verdict assert-failed
A check disagrees. Four passes over the array cost twice what two passes cost,
so the pass count multiplies the traffic rather than being ignored. That factor
is the whole difference between the textbook algorithm and the one libraries
ship.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The tree version touches the array about four times and the single pass
version twice, which is about twice the speed on a memory bound operation, and
no change at all in the operation count.

```starter
unsigned long scan_time_us(unsigned long n, unsigned elem, unsigned passes,
                           unsigned long mb_per_sec) {
    (void)passes;
    if (!mb_per_sec) return 0;
    return n * elem / mb_per_sec;
}
```

```tests
#include <assert.h>
unsigned long scan_time_us(unsigned long, unsigned, unsigned, unsigned long);
int main(void) {
    /* A million 4 byte elements, four passes, 1000 MB/s: 16 MB at 1 B/us. */
    assert(scan_time_us(1000000, 4, 4, 1000) == 16000);
    /* Two passes over the same data. */
    assert(scan_time_us(1000000, 4, 2, 1000) == 8000);
    assert(scan_time_us(1000, 4, 2, 1000) == 8);
    assert(scan_time_us(1000000, 4, 4, 0) == 0);
    return 0;
}
```

```solution
unsigned long scan_time_us(unsigned long n, unsigned elem, unsigned passes,
                           unsigned long mb_per_sec) {
    if (!mb_per_sec) return 0;
    return n * elem * passes / mb_per_sec;
}
```

## Which scan to use where

Write `pick_scan`, choosing a scan algorithm, given how many elements there are
and whether the workers exist regardless of whether they are given work.

Return 0 for the depth optimal version and 1 for the work efficient one. When
the workers exist anyway, the extra work costs nothing and the shallower
algorithm wins. Otherwise the work efficient one wins once there is enough data
for the difference to matter, which here means more than one round's worth.

@kind output
@concept The same problem gets different answers at different levels of the
machine, which is the actual lesson rather than either algorithm.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The first question is whether the extra work is free, and only then does
the size matter.
@diagnose assert verdict assert-failed
A check disagrees. Inside a warp the lanes exist whether or not you use them, so
the work inefficient version is the right one however small the input. Choosing
by size alone gets that case backwards.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Real implementations use the depth optimal version inside a warp, a scan
of the per warp totals inside a block, and neither of them across the device.

```starter
int pick_scan(unsigned long n, int workers_free) {
    (void)workers_free;
    return n > 32;
}
```

```tests
#include <assert.h>
int pick_scan(unsigned long, int);
int main(void) {
    /* Inside a warp: the lanes are there anyway. */
    assert(pick_scan(32, 1) == 0);
    assert(pick_scan(1048576, 1) == 0);
    /* Workers cost something: size decides. */
    assert(pick_scan(1048576, 0) == 1);
    assert(pick_scan(32, 0) == 1);
    assert(pick_scan(1, 0) == 0);
    return 0;
}
```

```solution
int pick_scan(unsigned long n, int workers_free) {
    if (workers_free) return 0;
    return n > 1;
}
```
