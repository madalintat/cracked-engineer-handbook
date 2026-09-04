## The edge, not the block

Write `edge_id`, returning the index a coverage map is updated at, given the
previous block's identifier and the current one, and the size of the map as a
mask.

The index is the exclusive or of the two identifiers, kept inside the map by the
mask.

@kind output
@concept An edge is a pair of blocks, and hashing the pair rather than the
block is what makes the feedback signal about control flow rather than about
which code ran.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Combine the two identifiers, then keep only the bits the map has room
for.
@diagnose assert verdict assert-failed
A check disagrees. Recording the current block alone loses the edge entirely:
arriving at a block from two different places would look identical, and the
whole feedback signal is about which paths were taken.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The map is a fixed size table, so this is a hash. A large program
silently loses some edges to collisions, which is why assigning collision free
identifiers at link time is a real improvement rather than a detail.

```starter
unsigned edge_id(unsigned prev, unsigned cur, unsigned mask) {
    (void)prev;
    return cur & mask;
}
```

```tests
#include <assert.h>
unsigned edge_id(unsigned, unsigned, unsigned);
int main(void) {
    assert(edge_id(0, 0, 0xffff) == 0);
    assert(edge_id(0x1234, 0x00ff, 0xffff) == (0x1234u ^ 0x00ffu));
    assert(edge_id(0xabcd, 0xabcd, 0xffff) == 0);
    /* the mask keeps it inside the map */
    assert(edge_id(0x10000, 0, 0xffff) == 0);
    assert(edge_id(0x12345, 0, 0xffff) == 0x2345);
    return 0;
}
```

```solution
unsigned edge_id(unsigned prev, unsigned cur, unsigned mask) {
    return (prev ^ cur) & mask;
}
```

## Why the identifier is shifted

Write `next_prev`, returning what the fuzzer stores as the previous block after
executing a block with the given identifier.

The stored value is the identifier shifted right by one. That shift is what
makes the edge from A to B different from the edge from B to A, and what stops a
block that jumps to itself hashing to zero.

@kind output
@concept One shift carries two properties, and both of them are about the map
index being an edge rather than an unordered pair.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint It is a single shift, and it happens on the way out rather than on the
way in.
@diagnose assert verdict assert-failed
A check disagrees. Storing the identifier unchanged makes A to B and B to A the
same exclusive or, so the fuzzer cannot tell a loop's two directions apart, and
a self loop indexes zero for every block in the program.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Three lines of the original instrumentation carry the whole idea: an
identifier per block, an exclusive or into the map, and this shift.

```starter
unsigned next_prev(unsigned cur) {
    return cur;
}
```

```tests
#include <assert.h>
unsigned next_prev(unsigned);
/* The map index, spelled out here so this exercise stands alone. */
static unsigned idx(unsigned prev, unsigned cur) {
    return (prev ^ cur) & 0xffffu;
}
int main(void) {
    assert(next_prev(0) == 0);
    assert(next_prev(2) == 1);
    assert(next_prev(0xabcd) == 0x55e6);
    /* A to B and B to A must land in different places. */
    unsigned a = 0x1234, b = 0x5678;
    assert(idx(next_prev(a), b) != idx(next_prev(b), a));
    /* A self loop must not index zero. */
    assert(idx(next_prev(a), a) != 0);
    return 0;
}
```

```solution
unsigned next_prev(unsigned cur) {
    return cur >> 1;
}
```

## Quantising a hit count

Write `bucket`, returning which class a hit count falls into, using the classes
1, 2, 3, 4 to 7, 8 to 15, 16 to 31, 32 to 127, and 128 upwards, numbered from 1.

A count of zero is class 0, meaning the edge was not executed at all.

@kind output
@concept Treating every count as distinct makes every input look novel, and
treating an edge as merely hit or not loses the fact that a loop ran twice
instead of once.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The first three classes are single counts, and the rest are ranges that
roughly double.
@diagnose assert verdict assert-failed
A check disagrees. One, two and three are three separate classes, and four
through seven share one. A pure doubling from the start merges two and three,
which loses the difference between a loop that ran once and one that ran twice.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Eight classes fit in a byte, a new class counts as new coverage, and a
new count inside a class does not. That compromise is what keeps the corpus
bounded.

```starter
unsigned bucket(unsigned count) {
    if (count == 0) return 0;
    unsigned b = 1;
    while (count > 1) { count >>= 1; b++; }
    return b;
}
```

```tests
#include <assert.h>
unsigned bucket(unsigned);
int main(void) {
    assert(bucket(0) == 0);
    assert(bucket(1) == 1);
    assert(bucket(2) == 2);
    assert(bucket(3) == 3);
    assert(bucket(4) == 4);
    assert(bucket(7) == 4);
    assert(bucket(8) == 5);
    assert(bucket(15) == 5);
    assert(bucket(16) == 6);
    assert(bucket(31) == 6);
    assert(bucket(32) == 7);
    assert(bucket(127) == 7);
    assert(bucket(128) == 8);
    assert(bucket(100000) == 8);
    return 0;
}
```

```solution
unsigned bucket(unsigned count) {
    if (count == 0) return 0;
    if (count == 1) return 1;
    if (count == 2) return 2;
    if (count == 3) return 3;
    if (count < 8) return 4;
    if (count < 16) return 5;
    if (count < 32) return 6;
    if (count < 128) return 7;
    return 8;
}
```

## Is this input worth keeping

Write `new_coverage`, returning how many edges of a run are new, given this
run's bucket for each edge and the highest bucket ever seen for it.

An edge is new when this run put it in a class above anything recorded before.
An edge that was not executed contributes nothing.

@kind output
@concept This one comparison is the entire feedback mechanism, and it is what
turns a blind random walk into a hill climb over the program's own structure.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint New means a higher class than has ever been seen for that edge, not
merely a different one.
@diagnose assert verdict assert-failed
A check disagrees. An edge that ran fewer times than before is not a discovery,
so a difference in either direction is the wrong test. And an edge that did not
run at all this time cannot be new.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after An input with anything new joins the corpus and becomes breeding stock.
That is how a corpus containing only the word hello grew into syntactically
valid image files with nobody explaining the format.

```starter
unsigned new_coverage(const unsigned char *run, const unsigned char *seen,
                      unsigned n) {
    unsigned c = 0;
    for (unsigned i = 0; i < n; i++)
        if (run[i] != seen[i]) c++;
    return c;
}
```

```tests
#include <assert.h>
unsigned new_coverage(const unsigned char *, const unsigned char *, unsigned);
int main(void) {
    { unsigned char r[] = {1, 0, 3}, s[] = {1, 0, 3};
      assert(new_coverage(r, s, 3) == 0); }
    { unsigned char r[] = {2, 0, 3}, s[] = {1, 0, 3};
      assert(new_coverage(r, s, 3) == 1); }
    /* Fewer executions than before is not a discovery. */
    { unsigned char r[] = {1, 0, 1}, s[] = {1, 0, 3};
      assert(new_coverage(r, s, 3) == 0); }
    /* An edge reached for the first time. */
    { unsigned char r[] = {1, 1, 3}, s[] = {1, 0, 3};
      assert(new_coverage(r, s, 3) == 1); }
    /* An edge not executed this run. */
    { unsigned char r[] = {0, 0, 0}, s[] = {1, 2, 3};
      assert(new_coverage(r, s, 3) == 0); }
    return 0;
}
```

```solution
unsigned new_coverage(const unsigned char *run, const unsigned char *seen,
                      unsigned n) {
    unsigned c = 0;
    for (unsigned i = 0; i < n; i++)
        if (run[i] && run[i] > seen[i]) c++;
    return c;
}
```

## Saying the whole law

Write `is_permutation`, deciding whether two arrays of small non-negative
integers contain the same values with the same multiplicities.

Values are all below 256. Order does not matter and counts do.

Sorting is ordered and a permutation. This is the half everybody leaves out.

@kind output
@concept A property that states half the specification accepts an
implementation that satisfies half of it, and an empty list is sorted.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Counting each value is enough, and two arrays of different lengths cannot
be permutations of one another.
@diagnose assert verdict assert-failed
A check disagrees. Two arrays containing the same distinct values are not
permutations unless each value appears the same number of times, so a set is
not enough.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Without this clause, a sort that empties the list passes its test suite.
That is not contrived; it is what a suite of hand-picked expected outputs
quietly permits.

```starter
int is_permutation(const unsigned char *a, unsigned na,
                   const unsigned char *b, unsigned nb) {
    if (na != nb) return 0;
    for (unsigned i = 0; i < na; i++) {
        int found = 0;
        for (unsigned j = 0; j < nb; j++) if (a[i] == b[j]) found = 1;
        if (!found) return 0;
    }
    return 1;
}
```

```tests
#include <assert.h>
int is_permutation(const unsigned char *, unsigned,
                   const unsigned char *, unsigned);
int main(void) {
    { unsigned char a[] = {3, 1, 2}, b[] = {1, 2, 3};
      assert(is_permutation(a, 3, b, 3) == 1); }
    { unsigned char a[] = {1, 1, 2}, b[] = {1, 2, 2};
      assert(is_permutation(a, 3, b, 3) == 0); }   /* same values, wrong counts */
    { unsigned char a[] = {1, 2}, b[] = {1, 2, 3};
      assert(is_permutation(a, 2, b, 3) == 0); }
    { unsigned char a[] = {5}, b[] = {5};
      assert(is_permutation(a, 1, b, 1) == 1); }
    { unsigned char a[] = {0}, b[] = {0};
      assert(is_permutation(a, 0, b, 0) == 1); }
    return 0;
}
```

```solution
int is_permutation(const unsigned char *a, unsigned na,
                   const unsigned char *b, unsigned nb) {
    if (na != nb) return 0;
    int count[256] = {0};
    for (unsigned i = 0; i < na; i++) count[a[i]]++;
    for (unsigned i = 0; i < nb; i++) count[b[i]]--;
    for (int v = 0; v < 256; v++) if (count[v]) return 0;
    return 1;
}
```

## The counterexample a person can read

Write `minimal_example`, returning the smallest value in an array that exceeds a
limit, which is what shrinking leaves behind after reducing both the length of
the failing input and the size of the offending value.

Return -1 when nothing in the array exceeds the limit, which means there was no
failure to shrink.

@kind output
@concept A failure found in the middle of a random space is technically a bug
report and practically useless. Shrinking is what makes it a bug report a person
acts on.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Among the values that fail, the useful one is the smallest, not the first
one the generator happened to produce.
@diagnose assert verdict assert-failed
A check disagrees. The first failing value is where the search stopped, and the
smallest failing value is the one that tells you where the boundary is. Those
are usually not the same number.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A two hundred element list becomes a list of one, and the offending value
becomes the smallest one that still breaks it. That is the difference between a
technique people use and one they abandon.

```starter
int minimal_example(const int *v, unsigned n, int limit) {
    for (unsigned i = 0; i < n; i++)
        if (v[i] > limit) return v[i];
    return -1;
}
```

```tests
#include <assert.h>
int minimal_example(const int *, unsigned, int);
int main(void) {
    { int v[] = {900, 101, 5, 400}; assert(minimal_example(v, 4, 100) == 101); }
    { int v[] = {1, 2, 3};          assert(minimal_example(v, 3, 100) == -1); }
    { int v[] = {101};              assert(minimal_example(v, 1, 100) == 101); }
    { int v[] = {5, 5, 5};          assert(minimal_example(v, 3, 4) == 5); }
    assert(minimal_example(0, 0, 100) == -1);
    return 0;
}
```

```solution
int minimal_example(const int *v, unsigned n, int limit) {
    int best = -1;
    for (unsigned i = 0; i < n; i++)
        if (v[i] > limit && (best == -1 || v[i] < best)) best = v[i];
    return best;
}
```

## Two implementations, one specification

Write `first_disagreement`, returning the index of the first input on which two
implementations produce different answers, or -1 when they agree everywhere.

Neither implementation is trusted. A disagreement is a bug in one of them and
you do not have to know which.

@kind output
@concept This is an oracle you can have without a specification, which is why a
startling share of real cryptography and compiler bugs were found with it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The first index where they differ, scanning from the start.
@diagnose assert verdict assert-failed
A check disagrees. Counting disagreements answers a different question. What
makes a bug report is the earliest input on which they diverge, because that is
the case to look at.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Every remaining disagreement after the first is often the same bug seen
again, which is why the first one is the one worth reporting.

```starter
int first_disagreement(const int *a, const int *b, unsigned n) {
    int count = 0;
    for (unsigned i = 0; i < n; i++) if (a[i] != b[i]) count++;
    return count;
}
```

```tests
#include <assert.h>
int first_disagreement(const int *, const int *, unsigned);
int main(void) {
    { int a[] = {1, 2, 3}, b[] = {1, 2, 3};
      assert(first_disagreement(a, b, 3) == -1); }
    { int a[] = {1, 9, 3}, b[] = {1, 2, 3};
      assert(first_disagreement(a, b, 3) == 1); }
    { int a[] = {9, 9, 9}, b[] = {1, 2, 3};
      assert(first_disagreement(a, b, 3) == 0); }
    { int a[] = {1, 2, 9}, b[] = {1, 2, 3};
      assert(first_disagreement(a, b, 3) == 2); }
    assert(first_disagreement(0, 0, 0) == -1);
    return 0;
}
```

```solution
int first_disagreement(const int *a, const int *b, unsigned n) {
    for (unsigned i = 0; i < n; i++)
        if (a[i] != b[i]) return (int)i;
    return -1;
}
```

## What random bytes cannot reach

Write `random_can_pass`, deciding whether random input can plausibly get past a
magic number check within a budget of attempts, given the length of the magic in
bytes and the budget expressed as a power of two.

Each byte that has to match exactly costs eight bits, so the chance of hitting
the magic is one in two to the power of eight times the length. It is plausible
when the budget is at least that many powers of two.

@kind output
@concept This arithmetic is the whole reason the first generation of fuzzing
stopped at input validation, and the whole reason the second generation started
from real files.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Each byte is eight bits, and the comparison is against the budget in the
same units.
@diagnose assert verdict assert-failed
A check disagrees. A four byte magic is thirty two bits, which is about four
billion attempts, so a budget of a million never gets there. Comparing bytes
against a budget in powers of two is comparing different units.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Purely random bytes get past a four byte header with a probability of one
in four billion, so random input tests input validation and nothing whatsoever
behind it.

```starter
int random_can_pass(unsigned magic_bytes, unsigned budget_log2) {
    return magic_bytes <= budget_log2;
}
```

```tests
#include <assert.h>
int random_can_pass(unsigned, unsigned);
int main(void) {
    assert(random_can_pass(4, 20) == 0);   /* 32 bits, a million tries */
    assert(random_can_pass(4, 32) == 1);
    assert(random_can_pass(4, 40) == 1);
    assert(random_can_pass(1, 8) == 1);
    assert(random_can_pass(2, 15) == 0);
    assert(random_can_pass(0, 0) == 1);    /* nothing to match */
    return 0;
}
```

```solution
int random_can_pass(unsigned magic_bytes, unsigned budget_log2) {
    return magic_bytes * 8 <= budget_log2;
}
```
