## Useful bytes per line

Write `useful_per_line`, returning how many bytes of a fetched cache line a loop
actually uses, given the record size, the size of the one field being read, and
the line size.

Records are packed contiguously and the field appears once per record. When the
record is larger than the line, a line carries at most one field, and sometimes
none at all if the field is not on it; count the average by assuming one field
per record's worth of lines.

@kind output
@concept The penalty is the ratio of what arrives to what you use, and this is
the numerator.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint How many whole records fit in a line, times the field size, and a record
larger than a line still yields one field per record.
@diagnose assert verdict assert-failed
A check disagrees. Four records of sixteen bytes fit in a sixty four byte line,
so four four byte fields arrive per line rather than one. A record larger than
the line does not yield a fraction of a field; it yields one, spread over the
lines that record occupies.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This number, over the line size, is the fraction of your memory bandwidth
that did any work.

```starter
unsigned useful_per_line(unsigned record, unsigned field, unsigned line) {
    (void)record; (void)line;
    return field;
}
```

```tests
#include <assert.h>
unsigned useful_per_line(unsigned, unsigned, unsigned);
int main(void) {
    /* Four 16 byte records per 64 byte line, one 4 byte field each. */
    assert(useful_per_line(16, 4, 64) == 16);
    /* One 64 byte record per line. */
    assert(useful_per_line(64, 4, 64) == 4);
    /* A 128 byte record spans two lines, so on average two bytes per line. */
    assert(useful_per_line(128, 4, 64) == 2);
    /* Fields packed contiguously: the whole line is useful. */
    assert(useful_per_line(4, 4, 64) == 64);
    assert(useful_per_line(0, 4, 64) == 0);
    return 0;
}
```

```solution
unsigned useful_per_line(unsigned record, unsigned field, unsigned line) {
    if (!record || !line) return 0;
    if (record <= line) return (line / record) * field;
    return field * line / record;
}
```

## The ratio the arrangement costs

Write `layout_ratio_pct`, returning how many times slower reading one field from
an array of records is than reading it from an array of that field alone, as a
percentage, given the record size, the field size and the line size.

A ratio of 100 means no penalty at all. Truncate towards zero.

@kind output
@concept The penalty is a ratio of useful bytes, so it can be predicted from
three numbers before anything is measured.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Bytes fetched per element against bytes used per element. A record
smaller than a line shares it; a larger one only needs the line the field is on.
@diagnose assert verdict assert-failed
A check disagrees. A record smaller than a line still delivers several fields
per line, so the penalty is smaller than the record to field ratio suggests. The
comparison is between useful bytes per line, not between sizes.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A record of sixteen bytes costs four times on paper and about nothing in
practice, because the loop was bandwidth bound on data it would have fetched
anyway. The effect switches on at the line size.

```starter
unsigned layout_ratio_pct(unsigned record, unsigned field, unsigned line) {
    (void)line;
    if (!field) return 100;
    return record * 100u / field;
}
```

```tests
#include <assert.h>
unsigned layout_ratio_pct(unsigned, unsigned, unsigned);
int main(void) {
    /* 16 byte record, 4 byte field, 64 byte line: 16 useful of 64. */
    assert(layout_ratio_pct(16, 4, 64) == 400);
    /* A 64 byte record on a 64 byte line: one field per line. */
    assert(layout_ratio_pct(64, 4, 64) == 1600);
    /* The same record on a 128 byte line: two records share it, so the
       bytes fetched per element are the same and so is the ratio. */
    assert(layout_ratio_pct(64, 4, 128) == 1600);
    /* A 128 byte record: only the line holding the field is fetched. */
    assert(layout_ratio_pct(128, 4, 64) == 1600);
    /* The same record on a 128 byte line fetches all of it. */
    assert(layout_ratio_pct(128, 4, 128) == 3200);
    /* Field sized records: no penalty. */
    assert(layout_ratio_pct(4, 4, 64) == 100);
    return 0;
}
```

```solution
unsigned layout_ratio_pct(unsigned record, unsigned field, unsigned line) {
    if (!record || !field || !line) return 100;
    /* Bytes fetched per element: the record when several share a line, and
       one line when the record is larger than one. */
    unsigned fetched = record < line ? record : line;
    return fetched * 100u / field;
}
```

## Where the effect switches on

Write `penalty_starts`, deciding whether splitting the fields into separate
arrays can help at all, given the record size and the line size.

It can help only when a line holds fewer records than it has room for useful
fields, which is to say when the record is at least as large as the line. Below
that, both arrangements deliver several records per line.

@kind output
@concept The effect does not exist until the record reaches the line size, and
knowing the boundary stops the technique being applied where it pays nothing.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One comparison, and the record exactly equal to the line is the first case
that hurts.
@diagnose assert verdict assert-failed
A check disagrees. A record exactly the size of a line yields one useful field
per line, which is the worst case rather than the boundary being safe. A record
smaller than a line delivers several either way.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Two machines with different line sizes gave ratios four times apart in
opposite directions on the same source, which is what makes the line size and
not the record size the thing to reason from.

```starter
int penalty_starts(unsigned record, unsigned line) {
    return record > line;
}
```

```tests
#include <assert.h>
int penalty_starts(unsigned, unsigned);
int main(void) {
    assert(penalty_starts(12, 64) == 0);
    assert(penalty_starts(32, 64) == 0);
    assert(penalty_starts(64, 64) == 1);
    assert(penalty_starts(128, 64) == 1);
    assert(penalty_starts(64, 128) == 0);
    assert(penalty_starts(128, 128) == 1);
    return 0;
}
```

```solution
int penalty_starts(unsigned record, unsigned line) {
    return line && record >= line;
}
```

## What the padding costs

Write `struct_size`, returning the size of a record, given its fields' sizes in
declaration order.

Each field starts at an address that is a multiple of its own size, which is its
alignment here, so padding is inserted before a field that would otherwise
straddle. The whole record is then rounded up to a multiple of the largest
field's alignment, so that an array of them keeps every field aligned.

Field sizes are powers of two, and there are at most sixteen of them.

@kind output
@concept The order fields are declared in changes the size of the record, and
the size of the record was the entire independent variable in the measurement.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Advance the offset to a multiple of each field's size before placing it,
then round the total up at the end.
@diagnose assert verdict assert-failed
A check disagrees. Summing the field sizes gives ten for the badly ordered
struct, and the answer is twenty four: seven bytes of padding before the eight
byte field and seven more at the end so the next one starts aligned.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A third of the memory recovered by moving one line, and the rule is to
declare fields in decreasing order of size.

```starter
unsigned struct_size(const unsigned *sizes, unsigned n) {
    unsigned total = 0;
    for (unsigned i = 0; i < n; i++) total += sizes[i];
    return total;
}
```

```tests
#include <assert.h>
unsigned struct_size(const unsigned *, unsigned);
int main(void) {
    /* char, long, char */
    { unsigned f[] = {1, 8, 1}; assert(struct_size(f, 3) == 24); }
    /* long, char, char */
    { unsigned f[] = {8, 1, 1}; assert(struct_size(f, 3) == 16); }
    /* all the same size: no padding anywhere */
    { unsigned f[] = {4, 4, 4}; assert(struct_size(f, 3) == 12); }
    /* one field */
    { unsigned f[] = {8}; assert(struct_size(f, 1) == 8); }
    /* short, int: two bytes of padding in the middle */
    { unsigned f[] = {2, 4}; assert(struct_size(f, 2) == 8); }
    assert(struct_size(0, 0) == 0);
    return 0;
}
```

```solution
unsigned struct_size(const unsigned *sizes, unsigned n) {
    unsigned off = 0, align = 1;
    for (unsigned i = 0; i < n; i++) {
        unsigned a = sizes[i];
        if (a > align) align = a;
        unsigned rem = off % a;
        if (rem) off += a - rem;
        off += a;
    }
    unsigned rem = off % align;
    if (rem) off += align - rem;
    return off;
}
```

## Declaring them the other way round

Write `packed_size`, returning the smallest size a record can have, given its
fields, by choosing the best declaration order.

The fields may be reordered freely. Sizes are powers of two.

@kind output
@concept Decreasing size order is not a heuristic here; it is the order that
removes every internal gap.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint With the largest first, every later field is already aligned, so the only
padding left is at the end.
@diagnose assert verdict assert-failed
A check disagrees. In decreasing order there is no internal padding at all, so
the size is the sum of the fields rounded up to the largest alignment. Ten bytes
of fields with an eight byte alignment is sixteen, not ten and not twenty four.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after C and C++ never do this for you, because the layout is the interface that
separately compiled code agrees on. Some other languages do it unless you ask
them not to, for the same reason in reverse.

```starter
unsigned packed_size(const unsigned *sizes, unsigned n) {
    unsigned total = 0;
    for (unsigned i = 0; i < n; i++) total += sizes[i];
    return total;
}
```

```tests
#include <assert.h>
unsigned packed_size(const unsigned *, unsigned);
int main(void) {
    { unsigned f[] = {1, 8, 1}; assert(packed_size(f, 3) == 16); }
    { unsigned f[] = {8, 1, 1}; assert(packed_size(f, 3) == 16); }
    { unsigned f[] = {4, 4, 4}; assert(packed_size(f, 3) == 12); }
    { unsigned f[] = {2, 4};    assert(packed_size(f, 2) == 8); }
    { unsigned f[] = {1, 1, 1}; assert(packed_size(f, 3) == 3); }
    assert(packed_size(0, 0) == 0);
    return 0;
}
```

```solution
unsigned packed_size(const unsigned *sizes, unsigned n) {
    unsigned total = 0, align = 1;
    for (unsigned i = 0; i < n; i++) {
        total += sizes[i];
        if (sizes[i] > align) align = sizes[i];
    }
    unsigned rem = total % align;
    if (rem) total += align - rem;
    return total;
}
```

## The other direction

Write `shares_line`, deciding whether two variables share a cache line, given
their addresses and the line size.

Two variables on the same line, written by different threads, move that line
between the cores on every write, for no reason that exists in the program.

@kind output
@concept The same fact about lines, pointing the other way: pack for one thread
walking data, and pad apart for several threads writing.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two addresses are on the same line when they have the same line number,
which is the address divided by the line size.
@diagnose assert verdict assert-failed
A check disagrees. Addresses sixty bytes apart can still be on the same line or
on two different ones depending on where they sit, so the distance between them
does not answer the question. The line number does.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why the fix for two threads writing nearby is to pad them apart,
which is the exact opposite of everything else in this unit.

```starter
int shares_line(unsigned long a, unsigned long b, unsigned line) {
    unsigned long d = a > b ? a - b : b - a;
    return d < line;
}
```

```tests
#include <assert.h>
int shares_line(unsigned long, unsigned long, unsigned);
int main(void) {
    assert(shares_line(0, 8, 64) == 1);
    assert(shares_line(0, 63, 64) == 1);
    assert(shares_line(0, 64, 64) == 0);
    /* Sixty bytes apart, but on two different lines. */
    assert(shares_line(60, 120, 64) == 0);
    assert(shares_line(128, 190, 64) == 1);
    assert(shares_line(0, 0, 64) == 1);
    return 0;
}
```

```solution
int shares_line(unsigned long a, unsigned long b, unsigned line) {
    if (!line) return a == b;
    return a / line == b / line;
}
```

## Which loop the layout should serve

Write `prefer_split`, deciding whether to split the fields into separate arrays,
given the record size, the line size, how many of the record's fields the hot
loop reads, and how many fields the record has.

Splitting helps when the record is at least a line and the loop reads fewer than
all of the fields. A loop that reads every field uses the whole line either way.

@kind output
@concept The penalty is a property of the access pattern rather than of the
layout, which is why this is a question about the program.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two conditions, and both have to hold before there is anything to gain.
@diagnose assert verdict assert-failed
A check disagrees. A loop that reads all the fields uses everything the line
brought, so splitting gives it several streams to track and nothing back. And a
record smaller than a line has no penalty to remove in the first place.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The question is never which layout is better. It is which fields are read
together by the loop that runs most often, and that is a fact about the program
rather than a preference.

```starter
int prefer_split(unsigned record, unsigned line, unsigned fields_read,
                 unsigned fields_total) {
    (void)fields_read; (void)fields_total;
    return record >= line;
}
```

```tests
#include <assert.h>
int prefer_split(unsigned, unsigned, unsigned, unsigned);
int main(void) {
    /* Big record, one field of eight read: split. */
    assert(prefer_split(128, 64, 1, 8) == 1);
    /* Big record, every field read: no gain. */
    assert(prefer_split(128, 64, 8, 8) == 0);
    /* Small record: no penalty to remove. */
    assert(prefer_split(16, 64, 1, 4) == 0);
    assert(prefer_split(64, 64, 2, 4) == 1);
    assert(prefer_split(64, 128, 1, 4) == 0);
    return 0;
}
```

```solution
int prefer_split(unsigned record, unsigned line, unsigned fields_read,
                 unsigned fields_total) {
    if (!line || record < line) return 0;
    return fields_read < fields_total;
}
```

## What a loop over objects costs per element

Write `dispatch_overhead`, returning how many extra memory dependent events a
loop over an array of pointers to objects pays per element, compared with a loop
over one contiguous array of values.

Each element costs a pointer chase to reach the object, a load of the dispatch
table pointer, and an indirect call whose target the machine cannot predict when
the types differ. When every object has the same type the call is predictable
and costs nothing extra.

@kind output
@concept The layout argument and the control flow argument are the same
argument, which is why replacing objects with arrays removes three costs at
once.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Three costs, and only one of them goes away when the types all match.
@diagnose assert verdict assert-failed
A check disagrees. A monomorphic loop still chases the pointer and still loads
the dispatch table; what it stops paying for is the unpredictable target. Only
the flat array of values pays none of the three.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A loop over one component array with one body is none of those, which is
also why it can be turned into vector instructions.

```starter
unsigned dispatch_overhead(int is_pointer_array, int types_differ) {
    (void)types_differ;
    return is_pointer_array ? 1 : 0;
}
```

```tests
#include <assert.h>
unsigned dispatch_overhead(int, int);
int main(void) {
    assert(dispatch_overhead(1, 1) == 3);
    assert(dispatch_overhead(1, 0) == 2);
    assert(dispatch_overhead(0, 1) == 0);
    assert(dispatch_overhead(0, 0) == 0);
    return 0;
}
```

```solution
unsigned dispatch_overhead(int is_pointer_array, int types_differ) {
    if (!is_pointer_array) return 0;
    return types_differ ? 3u : 2u;
}
```
