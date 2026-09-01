## Count the lines, not the bytes

Write `lines_touched`, which reports how many distinct 64-byte cache lines a
range of bytes covers, starting at `addr` and running for `len` bytes.

A range does not have to start on a line boundary, and that is most of the
exercise.

@kind output
@concept The unit of transfer is a line rather than a byte, so the cost of a
range depends on where it starts as well as how long it is.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Find the line containing the first byte and the line containing the last,
and count from one to the other.
@diagnose assert verdict assert-failed
A check disagrees. Dividing the length by 64 ignores where the range starts:
eight bytes beginning at offset 60 span two lines, not one. Round the start down
to a boundary and the end up, then take the difference.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after One byte can cost two lines and 64 bytes can cost one, entirely depending
on alignment. This is why allocators return aligned memory and why a structure
that straddles a boundary is more expensive than the same structure that does
not.

```starter
#include <stddef.h>
size_t lines_touched(size_t addr, size_t len) {
    (void)addr;
    return (len + 63) / 64;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t lines_touched(size_t, size_t);
int main(void) {
    assert(lines_touched(0, 0) == 0);
    assert(lines_touched(0, 1) == 1);
    assert(lines_touched(0, 64) == 1);
    assert(lines_touched(0, 65) == 2);
    /* Eight bytes starting near the end of a line span two. */
    assert(lines_touched(60, 8) == 2);
    assert(lines_touched(63, 1) == 1);
    assert(lines_touched(63, 2) == 2);
    assert(lines_touched(128, 64) == 1);
    assert(lines_touched(129, 64) == 2);
    return 0;
}
```

```solution
#include <stddef.h>
size_t lines_touched(size_t addr, size_t len) {
    if (len == 0) return 0;
    size_t first = addr / 64;
    size_t last = (addr + len - 1) / 64;
    return last - first + 1;
}
```

## Rows against columns

Two loops compute the same sum over the same array. Write `lines_by_column`,
which counts how many line fetches a column-major walk of a row-major array
performs.

The array is `rows` by `cols` of eight-byte values, laid out row by row, and it
is walked one column at a time. Assume nothing stays in cache between columns.

@kind output
@concept Both loops do identical arithmetic and ask for a different number of
lines, and that number is computable without running anything.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Each element in a column is a whole row apart, so consecutive accesses
share a line only when a row is shorter than eight elements.
@diagnose assert verdict assert-failed
A check disagrees. Walking down a column, consecutive elements are `cols` times
8 bytes apart. When that stride is 64 or more, every access is its own line, so
the count is `rows` times `cols`. The starter counts the row-major answer, which
is the total bytes divided by 64.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after For an array of 8-byte values with 8 or more columns, the column walk
fetches eight times as many lines as the row walk for identical arithmetic. That
factor is the entire content of "traverse in the order the memory is laid out",
and it is why the loop order in a matrix routine is not a style question.

```starter
#include <stddef.h>
size_t lines_by_column(size_t rows, size_t cols) {
    return (rows * cols * 8 + 63) / 64;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t lines_by_column(size_t, size_t);
int main(void) {
    /* 8 columns of 8 bytes is a 64-byte stride: every access its own line. */
    assert(lines_by_column(4, 8) == 32);
    assert(lines_by_column(100, 8) == 800);
    /* A wider row is a bigger stride, and still one line per access. */
    assert(lines_by_column(4, 16) == 64);
    /* Four columns is a 32-byte stride, so two consecutive rows share a line. */
    assert(lines_by_column(4, 4) == 8);
    /* Two columns is a 16-byte stride: four rows per line. */
    assert(lines_by_column(8, 2) == 4);
    return 0;
}
```

```solution
#include <stddef.h>
size_t lines_by_column(size_t rows, size_t cols) {
    size_t stride = cols * 8;
    size_t per_line = stride >= 64 ? 1 : 64 / stride;
    size_t lines_per_column = (rows + per_line - 1) / per_line;
    return lines_per_column * cols;
}
```

## Which set does it land in

A cache is not fully associative. Some middle bits of the address choose a set,
and only the ways within that set are available.

Write `set_index`, returning the set an address maps to, for a cache with the
given number of sets and 64-byte lines.

@kind output
@concept The address decides where a line may live, so two addresses can
compete for the same slots while the rest of the cache sits empty.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Drop the bits that select a byte within the line, then take the low bits of
what is left.
@diagnose assert verdict assert-failed
A check disagrees. The low six bits of an address choose a byte inside the line
and play no part in choosing the set, so they have to be shifted away first. The
starter uses the address directly, which makes two addresses in the same line
appear to be in different sets.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Every address in one line maps to one set, which is the point: the set is
a property of the line rather than of the byte. The next exercise is what happens
when a program produces addresses whose set bits keep agreeing.

```starter
#include <stddef.h>
size_t set_index(size_t addr, size_t nsets) {
    return addr % nsets;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t set_index(size_t, size_t);
int main(void) {
    /* 64 sets. Every byte of line 0 maps to set 0. */
    assert(set_index(0, 64) == 0);
    assert(set_index(63, 64) == 0);
    assert(set_index(64, 64) == 1);
    assert(set_index(127, 64) == 1);
    assert(set_index(128, 64) == 2);
    /* 64 sets covers 4096 bytes, so the pattern repeats there. */
    assert(set_index(4096, 64) == 0);
    assert(set_index(4160, 64) == 1);
    return 0;
}
```

```solution
#include <stddef.h>
size_t set_index(size_t addr, size_t nsets) {
    return (addr / 64) % nsets;
}
```

## The stride that collides

Write `distinct_sets`, counting how many distinct sets are touched by `n`
accesses starting at address 0 and separated by `stride` bytes.

A stride that is a multiple of the number of bytes the sets span makes every
access land in the same set, whatever the size of the cache.

@kind output
@concept A conflict miss happens when the working set would have fitted and the
addresses collided, which is a different problem from the cache being too small.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Compute each access's set and count how many different ones appear.
@diagnose assert verdict assert-failed
A check disagrees. With 64 sets and 64-byte lines the mapping repeats every 4096
bytes, so a stride of 4096 puts every access in set 0 no matter how many there
are. The starter assumes every access is a new set, which is true only when the
stride does not divide evenly into that period.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why numerical libraries pad their row lengths. An array declared
1024 wide and allocated 1032 wide is not a mistake: the extra eight elements move
the column stride off the period and turn a loop that behaved as though the cache
were 512 bytes back into one that uses all of it.

```starter
#include <stddef.h>
size_t distinct_sets(size_t n, size_t stride, size_t nsets) {
    (void)stride; (void)nsets;
    return n;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t distinct_sets(size_t, size_t, size_t);
int main(void) {
    /* 64 sets, 64-byte lines: the mapping repeats every 4096 bytes. */
    assert(distinct_sets(10, 4096, 64) == 1);
    assert(distinct_sets(100, 4096, 64) == 1);
    /* A stride of 64 walks the sets one at a time. */
    assert(distinct_sets(10, 64, 64) == 10);
    assert(distinct_sets(100, 64, 64) == 64);
    /* A stride of 2048 alternates between two sets. */
    assert(distinct_sets(10, 2048, 64) == 2);
    /* Within one line, every access is the same set. */
    assert(distinct_sets(8, 8, 64) == 1);
    return 0;
}
```

```solution
#include <stddef.h>
size_t distinct_sets(size_t n, size_t stride, size_t nsets) {
    unsigned char seen[4096] = {0};
    size_t count = 0;
    for (size_t i = 0; i < n; i++) {
        size_t s = ((i * stride) / 64) % nsets;
        if (!seen[s]) { seen[s] = 1; count++; }
    }
    return count;
}
```

## Seven eighths wasted

A loop that reads one field of every element in an array of structures fetches
whole lines and uses a fraction of each.

Write `soa_saving`, returning how many times fewer lines a structure-of-arrays
layout fetches, for `n` elements of a structure `elem_size` bytes wide when the
loop reads one 8-byte field.

@kind output
@concept The lever is what fraction of each fetched line the loop actually
consumes, and splitting the fields is how that fraction becomes one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count lines for each layout and divide. The field-only array is `n` times
8 bytes, contiguous.
@diagnose assert verdict assert-failed
A check disagrees, and it will be one of the short arrays. The ratio is the
structure width over 8 only while both layouts are large enough to fill whole
lines. With few enough elements the split array is a single line however narrow
it is, so the saving is bounded by how many lines the struct array occupied
rather than by the width.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The saving is real and it is not free. Code that touches every field of
one element wants the fields together, and this transformation makes that case
worse by the same factor. There is no correct layout, only a question about which
access pattern is the hot one.

```starter
#include <stddef.h>
size_t soa_saving(size_t n, size_t elem_size) {
    (void)n;
    return elem_size / 8;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t soa_saving(size_t, size_t);
int main(void) {
    /* 64-byte structs: one line each. Split: 8 fields per line. */
    assert(soa_saving(64, 64) == 8);
    assert(soa_saving(64, 32) == 4);
    assert(soa_saving(64, 16) == 2);
    /* 8-byte structs are already the split layout. */
    assert(soa_saving(64, 8) == 1);
    assert(soa_saving(64, 128) == 16);
    /* Few enough elements that the split array is a single line, so the
       ratio is the struct count rather than the struct width over 8. */
    assert(soa_saving(4, 32) == 2);
    assert(soa_saving(4, 128) == 8);
    assert(soa_saving(8, 8) == 1);
    return 0;
}
```

```solution
#include <stddef.h>
size_t soa_saving(size_t n, size_t elem_size) {
    size_t aos = (n * elem_size >= 64) ? (n * elem_size) / 64 : 1;
    if (elem_size >= 64) aos = n * (elem_size / 64);
    size_t soa = (n * 8 + 63) / 64;
    if (soa == 0) soa = 1;
    return aos / soa;
}
```

## Padding, and why it is not waste

Two counters written by two threads. If they share a cache line, every write by
one invalidates the other's copy of the whole line, and two threads that share no
data behave as though they did.

Write `pad_to_line`, returning the size a structure must be padded to so that
consecutive instances never share a line.

@kind output
@concept Coherence is maintained per line rather than per variable, so two
independent variables on one line are one contended variable as far as the
hardware is concerned.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Round up to the next multiple of the line size, and remember that a
structure already a multiple needs no padding.
@diagnose assert verdict assert-failed
A check disagrees. A structure of exactly 64 bytes already occupies whole lines
and needs no padding, so rounding up must leave it alone. Adding a line
unconditionally wastes 64 bytes per element on exactly the case that was already
correct.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Sixty-four bytes per counter looks extravagant until you measure the
alternative. False sharing has produced slowdowns of several times on code where
no variable is shared at all, and the fix is arithmetic on a struct definition.

```starter
#include <stddef.h>
size_t pad_to_line(size_t size) {
    return size + 64;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t pad_to_line(size_t);
int main(void) {
    assert(pad_to_line(8) == 64);
    assert(pad_to_line(1) == 64);
    assert(pad_to_line(63) == 64);
    assert(pad_to_line(64) == 64);
    assert(pad_to_line(65) == 128);
    assert(pad_to_line(128) == 128);
    assert(pad_to_line(0) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
size_t pad_to_line(size_t size) {
    return (size + 63) / 64 * 64;
}
```

## Blocking a matrix multiply

The naive triple loop reads a row and a column for every output element, and at
any interesting size neither survives in cache between uses.

Write `blocked_loads`, counting how many times a blocked multiply reads each
input matrix from memory, for `n` by `n` matrices in blocks of `b`.

@kind output
@concept Blocking does not change the arithmetic, it changes how many times each
byte is fetched, from once per use to once per block.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint There are `n/b` blocks along each dimension, and each block of an input
participates in one full row or column of block multiplications.
@diagnose assert verdict assert-failed
A check disagrees. The blocked algorithm has three nested loops over blocks, so
each input block is read once per iteration of the loop it is not indexed by,
which is `n/b` times. Larger blocks mean fewer passes.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Doubling the block size halves the traffic, until the block stops fitting
in cache and the whole benefit disappears at once. That is why the tile size in
a tuned library is a measured constant rather than a derived one, and Part XVI
does this again on a GPU where the block that has to fit is shared memory.

```starter
#include <stddef.h>
size_t blocked_loads(size_t n, size_t b) {
    (void)b;
    return n;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t blocked_loads(size_t, size_t);
int main(void) {
    /* One block covering everything: each input read once. */
    assert(blocked_loads(64, 64) == 1);
    /* Two blocks per dimension: each input read twice. */
    assert(blocked_loads(64, 32) == 2);
    assert(blocked_loads(64, 16) == 4);
    assert(blocked_loads(64, 8) == 8);
    /* Blocks of one element is the naive algorithm. */
    assert(blocked_loads(64, 1) == 64);
    assert(blocked_loads(1024, 64) == 16);
    return 0;
}
```

```solution
#include <stddef.h>
size_t blocked_loads(size_t n, size_t b) {
    return n / b;
}
```

## The chase the prefetcher cannot see

A hardware prefetcher watches addresses, detects a constant stride, and fetches
ahead. Write `prefetchable`, reporting whether a sequence of addresses has a
constant stride the hardware could detect.

A sequence of fewer than three addresses gives it nothing to detect.

@kind output
@concept The prefetcher hides latency only where it can predict, so a pattern
with no stride pays the full cost at every step.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Compare each gap with the first gap. A backwards stride is still a stride.
@diagnose assert verdict assert-failed
A check disagrees. Every gap has to equal the first, including negative ones,
since a descending walk is as predictable as an ascending one. The starter
requires the addresses to increase, which rejects a perfectly detectable pattern.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A linked list produces no stride at all, because each node's address is
known only after the previous node has arrived. That is why an array of values
beats a list of pointers by margins that look implausible from the instruction
counts, and it is a fact about the prefetcher rather than about pointer
arithmetic.

```starter
#include <stddef.h>
int prefetchable(const long *addrs, size_t n) {
    if (n < 3) return 0;
    for (size_t i = 1; i < n; i++)
        if (addrs[i] <= addrs[i - 1]) return 0;
    return 1;
}
```

```tests
#include <assert.h>
#include <stddef.h>
int prefetchable(const long *, size_t);
int main(void) {
    long up[] = {0, 64, 128, 192};
    assert(prefetchable(up, 4) == 1);
    long down[] = {192, 128, 64, 0};
    assert(prefetchable(down, 4) == 1);
    long jumpy[] = {0, 64, 200, 264};
    assert(prefetchable(jumpy, 4) == 0);
    long two[] = {0, 64};
    assert(prefetchable(two, 2) == 0);
    long same[] = {8, 8, 8};
    assert(prefetchable(same, 3) == 1);
    long chase[] = {4096, 17, 900, 33};
    assert(prefetchable(chase, 4) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
int prefetchable(const long *addrs, size_t n) {
    if (n < 3) return 0;
    long stride = addrs[1] - addrs[0];
    for (size_t i = 2; i < n; i++)
        if (addrs[i] - addrs[i - 1] != stride) return 0;
    return 1;
}
```
