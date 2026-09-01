---
needs: [pipeline]
minutes: 55
one_idea: Two cores looking at one address need an agreement about what each may observe, and every atomic operation and every fence is a piece of that agreement being paid for.
sources: [cpu-architectures, x86-64-assembly]
---

Everything in this part so far has assumed one core. This unit removes that
assumption, and almost every intuition built on it.

## The increment that is not one thing

```c
counter++;
```

Three operations: load the value, add one, store it back. Two threads running
that line can both load 7, both compute 8, and both store 8. One increment
disappeared and nothing anywhere reports an error.

This is not a rare interleaving. On two cores running a loop it happens
constantly, and a counter incremented a million times by each of two threads
routinely lands well short of two million.

The fix is an instruction that does all three as one indivisible step. On x86-64
that is a `lock` prefix, and `lock xadd` is an add that no other core can observe
halfway through.

## What lock costs now

The name is historical. On early processors the prefix asserted a signal that
stopped every other core from using the memory bus, which was correct and
extremely expensive.

Modern implementations use the cache coherence protocol instead. To perform an
atomic read-modify-write, a core takes exclusive ownership of the cache line,
which means invalidating every other core's copy, and holds it for the duration.
No bus is locked. One line is owned.

That changes the cost model completely. An atomic operation on a line nobody else
wants is cheap, tens of cycles. The same operation on a line several cores are
fighting over costs the coherence traffic to move the line back and forth, which
is hundreds of cycles per operation and gets worse as you add cores.

So the expensive thing is contention rather than atomicity, and the way to make
an atomic counter fast is to have several of them on separate lines. That is the
false sharing lesson from unit 024 arriving as a design technique rather than as
a bug.

## Compare and swap

One instruction is enough to build everything else.

Compare and swap takes an address, an expected value and a new value. If the
address holds the expected value it is replaced with the new one and the
operation reports success. If not, nothing is written and the operation reports
what it found.

Every lock-free algorithm is a loop around it: read the current value, compute
what it should become, try to swap, and if somebody else got there first, start
again with what they left. The loop is not a spin waiting for a resource; it is a
retry after losing a race, and it makes progress whenever anybody wins.

```figure
{
  "kind": "blocks",
  "alt": "A loop showing read, compute, compare-and-swap, and on failure a branch back to read with the observed value.",
  "caption": "The shape of every lock-free update. Failure is not an error, it is somebody else having succeeded, and the retry starts from what they left.",
  "boxes": [
    { "id": "r", "x": 0,   "y": 1.2, "w": 3,   "h": 1.3, "label": "read", "accent": "azure" },
    { "id": "c", "x": 3.8, "y": 1.2, "w": 3.2, "h": 1.3, "label": "compute", "accent": "azure" },
    { "id": "s", "x": 7.8, "y": 1.2, "w": 3.4, "h": 1.3, "label": "compare and swap", "accent": "gold" },
    { "id": "d", "x": 12,  "y": 1.2, "w": 2.8, "h": 1.3, "label": "done", "accent": "jade" }
  ],
  "arrows": [
    { "from": "r", "to": "c" },
    { "from": "c", "to": "s" },
    { "from": "s", "to": "d" },
    { "from": "s", "to": "r", "label": "lost the race" }
  ]
}
```

## The value that came back

Compare and swap has a famous hole.

It checks that a location still holds a particular value. It cannot check that
the location has not changed. If another thread changes it from A to B and back
to A, your comparison succeeds and your assumption that nothing happened is
wrong.

For a counter this is harmless. For a pointer it is not: a node can be removed,
freed, reallocated for something else, and happen to land at the same address,
and your swap installs a pointer into a structure that has been rebuilt
underneath you.

The standard repair is to widen the value with a counter, so the comparison is
against a pointer and a tag that increments on every change. A double-width
compare and swap does both at once, which is why x86-64 has a sixteen-byte
version of the instruction.

## Nothing happens in the order you wrote it

The second half of the subject, and the harder half.

Both the compiler and the processor reorder memory operations. The compiler does
it to keep a value in a register or to hoist a load out of a loop. The processor
does it because a store goes into a buffer and drains later, so a load issued
after a store can complete before it.

Neither is a bug. Both preserve what a single thread can observe about its own
execution. Neither preserves what another thread sees.

Which means a program with two threads writing and reading two variables can
observe orderings that appear in no interleaving of the source. The standard
demonstration is two threads, each storing to one variable and then loading the
other, where both loads can return the old value even though at least one store
must have happened first.

## x86 is the forgiving one

The rules differ by architecture, and that difference has consequences for how
bugs are found.

x86-64 uses total store order. Loads are not reordered with other loads, stores
are not reordered with other stores, and a store followed by a load is the only
pair that can be seen out of order. That is a strong model, and it means a great
deal of incorrectly synchronised code happens to work.

ARM and POWER are weaker. Almost any pair can be reordered unless you say
otherwise. So code that has run correctly on x86 for years can fail on the first
ARM machine it meets, and the bug was always there.

This is the most common way a memory ordering bug is discovered, and it is why a
port to a different architecture turns up race conditions that were never about
that architecture.

## Saying what you mean

The C and C++ memory model gives you four useful levels, and each costs
something different.

Relaxed guarantees atomicity and nothing about ordering. It is right for a
statistics counter nobody reads until the end, and wrong for almost everything
else.

Release on a store and acquire on a load make a pair. Everything the writing
thread did before the release is visible to any thread that sees that value
through an acquire. This is the ordering a mutex provides and it is what most
code actually needs.

Sequentially consistent is the default, and it additionally guarantees that all
threads agree on one global order of these operations. On x86 that costs a fence
on stores, which is tens of cycles, and it is why the default is not always the
right choice for a hot path.

The reason the default is the strongest one is that it is the only level that
behaves the way people expect. The others are correct and require you to have
thought about it.

## Lock free is not wait free, and neither is free

Three terms get used interchangeably and mean different things.

Lock free means that at any moment some thread makes progress. An individual
thread can retry indefinitely if it keeps losing races, so a lock-free algorithm
guarantees the system advances and promises nothing to any particular
participant.

Wait free is the stronger claim that every thread finishes in a bounded number of
steps regardless of what the others do. It is what a real-time system needs and
it is much harder to build, which is why almost everything called lock free is
not wait free.

And neither is automatically faster than a mutex. An uncontended mutex on Linux
costs an atomic operation and no system call at all, because it only enters the
kernel when it actually has to wait. Under contention the comparison depends
entirely on the workload: a lock-free structure whose threads spend their time
losing races and retrying can do more total work and finish later than one that
queued politely.

The reason to reach for lock free is usually not throughput. It is that a thread
holding a lock can be descheduled, or crash, and everything behind it stops,
where a lock-free structure has no such state. Measure before assuming the other
thing.

## A race is worse than a wrong answer

One thing worth being blunt about.

A data race in C or C++ is undefined behaviour. Not "you might read a stale
value", not "you might get a torn write". Undefined, which means the compiler is
entitled to assume it does not happen and to optimise on that assumption.

A loop reading a non-atomic flag can be turned into a loop reading it once,
because nothing in the program is allowed to change it. The result is an infinite
loop from source that looks like it polls. The fix is not `volatile`, which
controls elision and says nothing about ordering or atomicity between threads. It
is an atomic with an ordering you chose.

## What to carry forward

An atomic instruction is one that no other core can observe halfway through, and
on modern hardware its cost is dominated by who else wants the cache line.

Compare and swap builds everything, retries on losing a race, and cannot tell a
value that never changed from one that changed back.

Ordering is separate from atomicity and is the part that ports badly. x86 forgives
a great deal, weaker machines do not, and the C model exists so you can say what
you need instead of discovering it.

That closes Part V. Part VI goes back to what the bits mean.

## Reading the errors you are about to see

These model the mechanisms rather than racing real threads, because a race that
reproduces on a shared machine is not a race worth writing an exercise about.

`assert-failed` names the interleaving or the ordering your model got wrong. The
compare-and-swap exercises use C11 atomics on a single thread, where the
semantics are exact and the outcome is not a matter of timing.
