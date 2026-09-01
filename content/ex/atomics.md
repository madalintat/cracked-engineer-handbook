## The increment that loses

Write `final_count`, which simulates two threads each incrementing a shared
counter, under an interleaving given as a schedule.

Each thread performs load, add, store as three separate steps. The schedule says
which thread runs each step. A thread's loaded value lives in its own register
until it stores.

@kind output
@concept An increment is three operations, and the lost update is what happens
when both threads load before either stores.

@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Each thread needs its own held value. A store writes what that thread
loaded plus one, not what memory currently holds.
@diagnose assert verdict assert-failed
A check disagrees. The whole point is that a thread's add operates on the value
it loaded, which may be stale by the time it stores. Reading memory again at the
store makes every interleaving produce the right answer, which is the bug the
exercise is demonstrating, inverted.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Two increments, one survivor, and nothing anywhere reported an error. On
two cores running a loop this is not a rare interleaving: a counter incremented a
million times by each of two threads routinely lands well short of two million.

```starter
#include <stddef.h>
int final_count(const int *sched, size_t n) {
    int mem = 0;
    int held[2] = {0, 0};
    int step[2] = {0, 0};
    for (size_t i = 0; i < n; i++) {
        int t = sched[i];
        if (step[t] == 0) held[t] = mem;
        else if (step[t] == 1) held[t] = held[t] + 1;
        else mem = mem + 1;
        step[t]++;
    }
    return mem;
}
```

```tests
#include <assert.h>
#include <stddef.h>
int final_count(const int *, size_t);
int main(void) {
    /* Thread 0 runs to completion, then thread 1. Both increments survive. */
    int serial[6] = {0,0,0, 1,1,1};
    assert(final_count(serial, 6) == 2);
    /* Both load before either stores. One increment is lost. */
    int lost[6] = {0, 1, 0, 1, 0, 1};
    assert(final_count(lost, 6) == 1);
    /* Thread 0 finishes before thread 1 loads. */
    int safe[6] = {0,0,0, 1,1,1};
    assert(final_count(safe, 6) == 2);
    /* Interleaved adds, but thread 1 loads after thread 0 stored. */
    int ok2[6] = {0, 0, 0, 1, 1, 1};
    assert(final_count(ok2, 6) == 2);
    return 0;
}
```

```solution
#include <stddef.h>
int final_count(const int *sched, size_t n) {
    int mem = 0;
    int held[2] = {0, 0};
    int step[2] = {0, 0};
    for (size_t i = 0; i < n; i++) {
        int t = sched[i];
        if (step[t] == 0) held[t] = mem;
        else if (step[t] == 1) held[t] = held[t] + 1;
        else mem = held[t];
        step[t]++;
    }
    return mem;
}
```

## Compare and swap, exactly

Write `cas`, which replaces the value at `p` with `desired` only if it currently
equals `*expected`. On failure it writes what it found back into `*expected` and
reports 0.

That last part is what makes the retry loop work: a failed attempt hands you the
value somebody else left.

@kind output
@concept A failed compare and swap is not an error, it is somebody else having
succeeded, and it returns what they left so the retry starts from there.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint On failure, update the expected value before returning.
@diagnose assert verdict assert-failed
A check disagrees. The starter reports failure and leaves `*expected` alone, so a
retry loop would try the same stale value forever. The whole convention is that
failure returns the current contents through the same parameter.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after One instruction and everything else is built from it. The hardware version
is `lock cmpxchg`, and its cost has nothing to do with the comparison: it needs
exclusive ownership of the cache line, which is cheap when nobody else wants it
and expensive when several cores do.

```starter
int cas(int *p, int *expected, int desired) {
    if (*p == *expected) {
        *p = desired;
        return 1;
    }
    return 0;
}
```

```tests
#include <assert.h>
int cas(int *, int *, int);
int main(void) {
    int v = 5, exp = 5;
    assert(cas(&v, &exp, 9) == 1);
    assert(v == 9 && exp == 5);
    /* Now the location no longer holds what we expected. */
    exp = 5;
    assert(cas(&v, &exp, 12) == 0);
    assert(v == 9);
    /* Failure hands back what is actually there, so a retry can use it. */
    assert(exp == 9);
    assert(cas(&v, &exp, 12) == 1);
    assert(v == 12);
    return 0;
}
```

```solution
int cas(int *p, int *expected, int desired) {
    if (*p == *expected) {
        *p = desired;
        return 1;
    }
    *expected = *p;
    return 0;
}
```

## The retry loop

Write `atomic_max`, which raises the value at `p` to `v` if `v` is larger,
leaving it alone otherwise, using only compare and swap.

Return how many attempts it took. The schedule injects an interfering write
before some attempts, which is what makes the loop necessary.

@kind output
@concept A lock-free update is read, compute, try, and start again from what the
winner left, and it makes progress whenever anybody wins.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Recompute the desired value from what the failed swap handed back, not
from what you first read.
@diagnose assert verdict assert-failed
A check disagrees. After a failed attempt the target may already exceed `v`, in
which case the loop must stop rather than lowering it. Recomputing the condition
from the value the failure returned is what makes that work.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The loop is not a spin waiting for a resource. Every iteration is a retry
after losing a race, and every loss means somebody else made progress. That is
what lock free guarantees, and it is also why an individual thread can in
principle retry forever while the system as a whole never stalls.

```starter
#include <stddef.h>

int cas_sim(int *p, int *expected, int desired, int *interfere) {
    if (*interfere) { *p = *interfere; *interfere = 0; }
    if (*p == *expected) { *p = desired; return 1; }
    *expected = *p;
    return 0;
}

int atomic_max(int *p, int v, int *interfere) {
    int seen = *p;
    int tries = 0;
    while (1) {
        tries++;
        if (cas_sim(p, &seen, v, interfere)) return tries;
    }
}
```

```tests
#include <assert.h>
int atomic_max(int *, int, int *);
int main(void) {
    /* No interference: one attempt. */
    int v = 3, none = 0;
    assert(atomic_max(&v, 10, &none) == 1);
    assert(v == 10);
    /* Already larger: no write, one attempt. */
    v = 20; none = 0;
    assert(atomic_max(&v, 10, &none) == 1);
    assert(v == 20);
    /* Somebody writes 7 before the first attempt: retry, then succeed. */
    v = 3;
    int inter = 7;
    assert(atomic_max(&v, 10, &inter) == 2);
    assert(v == 10);
    /* Somebody writes 50 before the first attempt: retry, then give up. */
    v = 3;
    inter = 50;
    assert(atomic_max(&v, 10, &inter) == 2);
    assert(v == 50);
    return 0;
}
```

```solution
#include <stddef.h>

int cas_sim(int *p, int *expected, int desired, int *interfere) {
    if (*interfere) { *p = *interfere; *interfere = 0; }
    if (*p == *expected) { *p = desired; return 1; }
    *expected = *p;
    return 0;
}

int atomic_max(int *p, int v, int *interfere) {
    int seen = *p;
    int tries = 0;
    while (1) {
        tries++;
        if (seen >= v) {
            if (*interfere) { *p = *interfere; *interfere = 0; }
            return tries;
        }
        if (cas_sim(p, &seen, v, interfere)) return tries;
    }
}
```

## A value that came back

Compare and swap checks that a location still holds a value. It cannot check that
the location never changed.

Write `aba_safe`, which compares a tagged value: a pointer and a counter that
increments on every modification. It succeeds only when both halves match, and a
successful swap advances the tag.

@kind output
@concept Widening the comparison with a counter turns "still holds this value"
into "has not been modified", which is the question you actually wanted answered.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Both halves must match, and a successful swap must advance the tag.
@diagnose assert verdict assert-failed
A check disagrees on the case where the value went from A to B and back to A.
Comparing the pointer alone succeeds there, because the pointer really does hold
what you expected. The tag is what records that something happened in between.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after For a counter this problem is harmless. For a pointer it is not: a node
can be removed, freed, reallocated for something else and land at the same
address, and your swap installs a pointer into a structure that was rebuilt
underneath you. This is why x86-64 has a sixteen-byte compare and swap.

```starter
int aba_safe(long *ptr, unsigned long *tag,
             long exp_ptr, unsigned long exp_tag, long desired) {
    (void)exp_tag;
    if (*ptr == exp_ptr) {
        *ptr = desired;
        *tag = *tag + 1;
        return 1;
    }
    return 0;
}
```

```tests
#include <assert.h>
int aba_safe(long *, unsigned long *, long, unsigned long, long);
int main(void) {
    long ptr = 100;
    unsigned long tag = 0;
    /* Nothing happened in between: the swap succeeds and the tag advances. */
    assert(aba_safe(&ptr, &tag, 100, 0, 200) == 1);
    assert(ptr == 200 && tag == 1);
    /* The A to B to A case. Snapshot is (100, 5); somebody cycles it back. */
    ptr = 100; tag = 5;
    long snap_ptr = ptr;
    unsigned long snap_tag = tag;
    ptr = 300; tag = 6;
    ptr = 100; tag = 7;
    /* The pointer matches the snapshot and the tag does not. */
    assert(aba_safe(&ptr, &tag, snap_ptr, snap_tag, 400) == 0);
    assert(ptr == 100 && tag == 7);
    /* Re-reading both halves lets the retry succeed. */
    assert(aba_safe(&ptr, &tag, ptr, tag, 400) == 1);
    assert(ptr == 400 && tag == 8);
    return 0;
}
```

```solution
int aba_safe(long *ptr, unsigned long *tag,
             long exp_ptr, unsigned long exp_tag, long desired) {
    if (*ptr == exp_ptr && *tag == exp_tag) {
        *ptr = desired;
        *tag = exp_tag + 1;
        return 1;
    }
    return 0;
}
```

## What total store order permits

x86-64 reorders exactly one pair: a store followed by a load of a different
address. Everything else keeps its program order.

Write `tso_allows`, which reports whether a given pair of operations may be seen
out of order under that model. Operations are 0 for a load and 1 for a store.

@kind output
@concept A memory model is a list of which reorderings the hardware permits, and
x86's list has one entry.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only one of the four combinations is permitted.
@diagnose assert verdict assert-failed
A check disagrees. Load then load, store then store, and load then store all keep
their order under total store order. Only a store followed by a later load can be
observed the other way round, because the store sits in a buffer while the load
completes.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after ARM and POWER permit almost every pair. That is why code correctly
synchronised for x86 by accident fails on the first ARM machine it meets, and why
a port turns up race conditions that were never about the new architecture. The
bug was always there.

```starter
int tso_allows(int first, int second) {
    return first != second;
}
```

```tests
#include <assert.h>
int tso_allows(int, int);
int main(void) {
    assert(tso_allows(0, 0) == 0);   /* load then load  */
    assert(tso_allows(0, 1) == 0);   /* load then store */
    assert(tso_allows(1, 1) == 0);   /* store then store */
    assert(tso_allows(1, 0) == 1);   /* store then load  */
    return 0;
}
```

```solution
int tso_allows(int first, int second) {
    return first == 1 && second == 0;
}
```

## Both threads read the old value

The standard demonstration of store buffering. Two threads, each storing to one
variable and then loading the other. Under total store order both loads can
return zero.

Write `sb_outcome`, which reports whether a pair of observed values is reachable
when both stores may sit in buffers.

@kind output
@concept The store buffer means a thread's own store is not yet visible to the
other when its load executes, which produces an outcome no interleaving of the
source explains.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint All four combinations are reachable, including the one that looks
impossible.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the pair where both loads return zero. That
outcome appears in no interleaving of the two programs, and the hardware produces
it anyway, because each store is still in its own core's buffer when the other
core's load runs.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is the case a fence exists to forbid. A sequentially consistent store
on x86 costs a fence for exactly this reason, which is tens of cycles, and it is
why the strongest ordering is not always the right choice for a hot path even
though it is the default.

```starter
int sb_outcome(int r1, int r2) {
    return !(r1 == 0 && r2 == 0);
}
```

```tests
#include <assert.h>
int sb_outcome(int, int);
int main(void) {
    assert(sb_outcome(1, 0) == 1);
    assert(sb_outcome(0, 1) == 1);
    assert(sb_outcome(1, 1) == 1);
    /* The one that looks impossible and is not. */
    assert(sb_outcome(0, 0) == 1);
    return 0;
}
```

```solution
int sb_outcome(int r1, int r2) {
    (void)r1; (void)r2;
    return 1;
}
```

## Strong enough, and no stronger

Write `sufficient`, reporting whether a given memory order is strong enough for a
stated need.

The levels are 0 relaxed, 1 acquire or release, 2 sequentially consistent. The
needs are 0 atomicity only, 1 publishing prior writes to a reader, 2 a single
global order all threads agree on.

@kind output
@concept Each level guarantees everything the weaker ones do and costs more, so
the question is always which is the weakest that suffices.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The levels are ordered. So are the needs.
@diagnose assert verdict assert-failed
A check disagrees. Relaxed gives atomicity and nothing else, so it is sufficient
only for the weakest need. Requiring an exact match rejects a stronger ordering
that would have worked, which is the opposite of the mistake people usually make.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Relaxed is right for a statistics counter nobody reads until the end.
Release and acquire is what a mutex provides and what most code actually needs.
Sequential consistency is the default because it is the only level that behaves
the way people expect, and the others are correct and require you to have thought
about it.

```starter
int sufficient(int order, int need) {
    return order == need;
}
```

```tests
#include <assert.h>
int sufficient(int, int);
int main(void) {
    assert(sufficient(0, 0) == 1);
    assert(sufficient(0, 1) == 0);
    assert(sufficient(0, 2) == 0);
    assert(sufficient(1, 0) == 1);
    assert(sufficient(1, 1) == 1);
    assert(sufficient(1, 2) == 0);
    assert(sufficient(2, 0) == 1);
    assert(sufficient(2, 1) == 1);
    assert(sufficient(2, 2) == 1);
    return 0;
}
```

```solution
int sufficient(int order, int need) {
    return order >= need;
}
```

## Striping the counter

An atomic operation on a line nobody else wants is cheap. The same operation on a
line several cores are fighting over costs the coherence traffic to move it.

Write `stripe_lines`, returning how many cache lines a striped counter occupies,
given `n` stripes each padded to avoid sharing, and how many stripes actually fit
per line if they are not padded.

@kind output
@concept The way to make an atomic counter fast is to have several on separate
lines, which is the false sharing lesson arriving as a design technique rather
than as a bug.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Padded, each stripe is a whole line. Unpadded, eight 8-byte counters share
one.
@diagnose assert verdict assert-failed
A check disagrees. Padded stripes occupy one line each, whatever their size,
which is the entire point of padding them. Unpadded, the count is the stripes
divided by how many fit in 64 bytes, rounded up.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Sixty-four bytes per counter looks extravagant until the alternative is
measured. Eight unpadded counters on one line means every core's increment
invalidates every other core's copy, and the structure that was supposed to
remove contention concentrates it.

```starter
#include <stddef.h>
size_t stripe_lines(size_t n, size_t counter_size, int padded) {
    (void)padded;
    return (n * counter_size + 63) / 64;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t stripe_lines(size_t, size_t, int);
int main(void) {
    /* Padded: one line each. */
    assert(stripe_lines(8, 8, 1) == 8);
    assert(stripe_lines(4, 8, 1) == 4);
    assert(stripe_lines(1, 8, 1) == 1);
    /* Unpadded: eight 8-byte counters per line. */
    assert(stripe_lines(8, 8, 0) == 1);
    assert(stripe_lines(9, 8, 0) == 2);
    assert(stripe_lines(16, 8, 0) == 2);
    assert(stripe_lines(0, 8, 1) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
size_t stripe_lines(size_t n, size_t counter_size, int padded) {
    if (padded) return n;
    return (n * counter_size + 63) / 64;
}
```
