## Run whoever has had least

Write `pick_next`, returning the index of the thread the scheduler runs: the
runnable one with the smallest accumulated virtual runtime.

Blocked threads are not in the queue at all, which is the whole reason blocking
costs nothing.

@kind output
@concept Fairness is accounting rather than priority ordering, and a thread that
has been blocked has fallen behind, so it runs first when it wakes.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Skip anything not runnable before comparing.
@diagnose assert verdict assert-failed
A check disagrees. A blocked thread with a tiny runtime is not a candidate: it is
waiting for something that is not a processor, so it is not on the queue and must
not be considered. Comparing every thread picks one that cannot run.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A thread that has just woken has the smallest runtime, so it runs
immediately, which is what makes interactive programs feel responsive without
anybody classifying them as interactive. Nothing in the scheduler knows which
programs a person is looking at.

```starter
#include <stddef.h>
int pick_next(const long *vruntime, const unsigned char *runnable, size_t n) {
    (void)runnable;
    int best = -1;
    for (size_t i = 0; i < n; i++)
        if (best < 0 || vruntime[i] < vruntime[best]) best = (int)i;
    return best;
}
```

```tests
#include <assert.h>
#include <stddef.h>
int pick_next(const long *, const unsigned char *, size_t);
int main(void) {
    long v[4] = {40, 12, 55, 3};
    unsigned char r[4] = {1, 1, 1, 0};
    /* Thread 3 has the least time and is blocked, so thread 1 runs. */
    assert(pick_next(v, r, 4) == 1);
    /* Unblock it and it runs immediately, having fallen behind. */
    unsigned char r2[4] = {1, 1, 1, 1};
    assert(pick_next(v, r2, 4) == 3);
    /* Nothing runnable at all. */
    unsigned char none[4] = {0, 0, 0, 0};
    assert(pick_next(v, none, 4) == -1);
    unsigned char one[4] = {0, 0, 1, 0};
    assert(pick_next(v, one, 4) == 2);
    return 0;
}
```

```solution
#include <stddef.h>
int pick_next(const long *vruntime, const unsigned char *runnable, size_t n) {
    int best = -1;
    for (size_t i = 0; i < n; i++) {
        if (!runnable[i]) continue;
        if (best < 0 || vruntime[i] < vruntime[best]) best = (int)i;
    }
    return best;
}
```

## Weight, not order

Write `charge`, returning how much virtual runtime a thread accumulates for a
given amount of real time at a given weight.

A heavier thread accumulates more slowly, so it comes up for selection more often
and gets more real time.

@kind output
@concept Priority is a divisor on the accounting rather than a position in an
ordering, which is why nothing starves whatever its nice value.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Divide by the weight, using the baseline weight as the scale.
@diagnose assert verdict assert-failed
A check disagrees. A thread of twice the baseline weight should accumulate half
the virtual time for the same real time, so the weight divides rather than
multiplies. Getting it the wrong way round gives more processor time to the
threads that asked for less.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Nothing starves, whatever the weights, because everybody's runtime still
grows and the smallest still wins eventually. That is the difference between a
weight and a priority, and it is why a background job at the lowest nice value
still finishes rather than waiting for the machine to go idle.

```starter
long charge(long real_time, long weight, long baseline) {
    return real_time * weight / baseline;
}
```

```tests
#include <assert.h>
long charge(long, long, long);
int main(void) {
    /* Baseline weight: virtual time equals real time. */
    assert(charge(100, 1024, 1024) == 100);
    /* Twice the weight: half the virtual time for the same real time. */
    assert(charge(100, 2048, 1024) == 50);
    /* Half the weight: twice the virtual time, so it comes up half as often. */
    assert(charge(100, 512, 1024) == 200);
    assert(charge(0, 512, 1024) == 0);
    return 0;
}
```

```solution
long charge(long real_time, long weight, long baseline) {
    return real_time * baseline / weight;
}
```

## What a switch really costs

Write `switch_cost`, returning the total cost of a context switch: the fixed
register save and restore, plus the cache and translation misses the incoming
thread pays while warming up.

The second part is larger and is charged to the thread switched to.

@kind output
@concept The cost of a switch is cold caches paid by the incoming thread, which
is why it is hard to attribute and why a system doing many switches is slow for
reasons no profile line explains.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Add the warm-up to the fixed part rather than taking whichever is larger.
@diagnose assert verdict assert-failed
A check disagrees. Both costs are paid: the registers are saved and restored, and
then the incoming thread misses on everything it touches. Reporting only the
larger of the two understates a switch by the amount that is hardest to see.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A few hundred nanoseconds of register work and one to several microseconds
of degraded execution afterwards. Migrating to a different core makes the second
part worse, because none of the caches the thread warmed are the ones it now has,
which is why the load balancer is deliberately reluctant.

```starter
long switch_cost(long fixed_ns, long misses, long miss_ns) {
    long warm = misses * miss_ns;
    return fixed_ns > warm ? fixed_ns : warm;
}
```

```tests
#include <assert.h>
long switch_cost(long, long, long);
int main(void) {
    /* 300 ns of register work plus 40 misses at 80 ns each. */
    assert(switch_cost(300, 40, 80) == 3500);
    /* A thread whose working set is already warm pays only the fixed part. */
    assert(switch_cost(300, 0, 80) == 300);
    /* Migration to a cold core: many more misses. */
    assert(switch_cost(300, 500, 80) == 40300);
    return 0;
}
```

```solution
long switch_cost(long fixed_ns, long misses, long miss_ns) {
    return fixed_ns + misses * miss_ns;
}
```

## Reluctant to move

Write `should_migrate`, deciding whether to move a runnable thread from a busy
processor to an idle one.

Moving costs the cold caches from the previous exercise, so it is worth it only
when the thread would wait longer than the move costs.

@kind output
@concept The balancer is deliberately reluctant, which is why a thread can sit
runnable on a busy processor while another sits idle, on purpose.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Compare what waiting costs against what moving costs.
@diagnose assert verdict assert-failed
A check disagrees. Moving a thread that would only have waited briefly makes it
slower, because the migration cost exceeds the wait it avoided. The comparison
has to be between the two, not a rule that idle processors must always be filled.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Which is why a machine with an idle core and a queued thread is sometimes
behaving correctly. On a system with several memory controllers the reluctance is
stronger still, because a thread scheduled away from its memory pays on every
access rather than only while warming up.

```starter
int should_migrate(long wait_ns, long migrate_ns) {
    (void)wait_ns; (void)migrate_ns;
    return 1;
}
```

```tests
#include <assert.h>
int should_migrate(long, long);
int main(void) {
    /* A long wait avoided by a cheap move. */
    assert(should_migrate(50000, 3000) == 1);
    /* A short wait, and moving costs more than staying. */
    assert(should_migrate(1000, 3000) == 0);
    /* Equal is not worth the disruption. */
    assert(should_migrate(3000, 3000) == 0);
    assert(should_migrate(0, 3000) == 0);
    return 0;
}
```

```solution
int should_migrate(long wait_ns, long migrate_ns) {
    return wait_ns > migrate_ns;
}
```

## Blocked, and holding the lock

Write `blocked_by`, returning how many threads are stopped by one thread that
holds a lock and then blocks on storage.

A thread that does I/O inside a lock has stopped everybody who wants that lock,
for the duration of a disk access.

@kind output
@concept Holding a lock across a blocking operation converts one thread's wait
into everybody's, which is the commoner of the two contention shapes.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only threads wanting this particular lock are affected, and only while the
holder is blocked.
@diagnose assert verdict assert-failed
A check disagrees. A holder that is running rather than blocked will release the
lock shortly, so nobody is stopped for a meaningful time, and threads waiting on
a different lock are unaffected either way. Counting all waiters regardless
overstates the damage and misses which case is the problem.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The rule is short enough to remember: do not do I/O inside a lock. The
duration of the block is a disk access, which unit 024's table prices at tens of
microseconds, and it is multiplied by every thread that wanted the same lock.

```starter
#include <stddef.h>
int blocked_by(const int *wants_lock, size_t n, int held_lock,
               int holder_blocked) {
    (void)held_lock; (void)holder_blocked;
    return (int)n;
}
```

```tests
#include <assert.h>
#include <stddef.h>
int blocked_by(const int *, size_t, int, int);
int main(void) {
    /* Four threads: three want lock 1, one wants lock 2. */
    int wants[4] = {1, 1, 2, 1};
    /* The holder of lock 1 is blocked on storage: three are stopped. */
    assert(blocked_by(wants, 4, 1, 1) == 3);
    /* The holder is running, so it will release shortly. */
    assert(blocked_by(wants, 4, 1, 0) == 0);
    /* A blocked holder of lock 2 stops the one thread that wants it. */
    assert(blocked_by(wants, 4, 2, 1) == 1);
    /* A lock nobody wants stops nobody. */
    assert(blocked_by(wants, 4, 3, 1) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
int blocked_by(const int *wants_lock, size_t n, int held_lock,
               int holder_blocked) {
    if (!holder_blocked) return 0;
    int count = 0;
    for (size_t i = 0; i < n; i++)
        if (wants_lock[i] == held_lock) count++;
    return count;
}
```

## Blocked by somebody unrelated

Write `effective_priority`, implementing priority inheritance: a thread holding a
lock temporarily takes the priority of the highest thread waiting for it.

Without it, a medium priority thread that never blocks prevents a low priority
lock holder from finishing, and the high priority waiter never runs.

@kind output
@concept Priority inversion is a high priority thread blocked transitively by a
medium one, and nothing in the stated priorities describes that relationship.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Take the maximum of the holder's own priority and every waiter's.
@diagnose assert verdict assert-failed
A check disagrees. The holder keeps its own priority when that is already the
highest, and is raised when a waiter outranks it, so the answer is a maximum
rather than a replacement. Lowering a holder to match a waiter makes the problem
worse.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Mars Pathfinder shipped with this disabled and rebooted repeatedly on the
surface, until the flag was set remotely. The bug was not in any thread's logic:
each behaved exactly as designed, and the relationship between them was not
expressible in the priorities they had been given.

```starter
#include <stddef.h>
int effective_priority(int holder_prio, const int *waiter_prio, size_t n) {
    if (n == 0) return holder_prio;
    return waiter_prio[0];
}
```

```tests
#include <assert.h>
#include <stddef.h>
int effective_priority(int, const int *, size_t);
int main(void) {
    /* Nobody waiting: the holder keeps its own priority. */
    assert(effective_priority(3, 0, 0) == 3);
    /* A higher priority waiter raises the holder. */
    int w1[2] = {9, 5};
    assert(effective_priority(3, w1, 2) == 9);
    /* A lower priority waiter does not lower it. */
    int w2[2] = {1, 2};
    assert(effective_priority(7, w2, 2) == 7);
    /* The highest waiter wins, wherever it sits in the list. */
    int w3[3] = {2, 8, 4};
    assert(effective_priority(1, w3, 3) == 8);
    return 0;
}
```

```solution
#include <stddef.h>
int effective_priority(int holder_prio, const int *waiter_prio, size_t n) {
    int best = holder_prio;
    for (size_t i = 0; i < n; i++)
        if (waiter_prio[i] > best) best = waiter_prio[i];
    return best;
}
```

## How many threads

Write `pool_size`, returning how many threads a pool should have, given the core
count and the ratio of time spent waiting to time spent computing.

One thread per core is right for one case, and the case is work that never
blocks.

@kind output
@concept A blocked thread is not using a core, so work that waits needs more
threads than cores in exactly the proportion that it waits.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Cores times one plus the ratio.
@diagnose assert verdict assert-failed
A check disagrees. Work that spends nine tenths of its time waiting has a ratio
of nine, which wants ten threads per core rather than one. Sizing to the core
count leaves the machine idle while requests queue, which is the commonest way a
pool is misconfigured.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The measurement that decides it is the fraction of time your threads are
runnable rather than blocked, and it is directly observable. The rule people
remember, one thread per core, is the special case where that fraction is one.

```starter
int pool_size(int cores, int wait_to_compute_ratio) {
    (void)wait_to_compute_ratio;
    return cores;
}
```

```tests
#include <assert.h>
int pool_size(int, int);
int main(void) {
    /* Pure computation: one per core. */
    assert(pool_size(8, 0) == 8);
    /* Half waiting, half computing. */
    assert(pool_size(8, 1) == 16);
    /* Nine tenths waiting on a database. */
    assert(pool_size(8, 9) == 80);
    assert(pool_size(1, 3) == 4);
    return 0;
}
```

```solution
int pool_size(int cores, int wait_to_compute_ratio) {
    return cores * (1 + wait_to_compute_ratio);
}
```

## Waking everybody to disappoint them

Write `wasted_wakeups`, counting how many threads are woken for a resource that
can serve only some of them.

Every thread woken becomes runnable, is scheduled, discovers there is nothing for
it, and goes back to sleep. The cost is the switches.

@kind output
@concept Load that looks like the scheduler's fault is usually something making
threads runnable that have nothing to do.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Waking one wastes none. Waking all wastes everybody who is not served.
@diagnose assert verdict assert-failed
A check disagrees. Waking all of them wastes the difference between the number
woken and the number the resource can serve, and waking exactly as many as can be
served wastes none. More waiters than the resource can serve is the situation the
pattern is named for.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The repairs are to wake one when the resource serves one, and to let the
kernel choose when several processes wait on the same descriptor. Accepting
connections was the standard example: every process in a pool woke on every
connection, and the fix was a flag telling the kernel to wake exactly one.

```starter
int wasted_wakeups(int waiters, int can_serve, int wake_all) {
    (void)wake_all;
    return waiters - can_serve;
}
```

```tests
#include <assert.h>
int wasted_wakeups(int, int, int);
int main(void) {
    /* Ten waiting, one can proceed, all woken: nine wasted. */
    assert(wasted_wakeups(10, 1, 1) == 9);
    /* Waking exactly one wastes nothing. */
    assert(wasted_wakeups(10, 1, 0) == 0);
    /* Waking all when all can proceed wastes nothing either. */
    assert(wasted_wakeups(10, 10, 1) == 0);
    /* More can be served than are waiting. */
    assert(wasted_wakeups(3, 10, 1) == 0);
    return 0;
}
```

```solution
int wasted_wakeups(int waiters, int can_serve, int wake_all) {
    if (!wake_all) return 0;
    int wasted = waiters - can_serve;
    return wasted > 0 ? wasted : 0;
}
```
