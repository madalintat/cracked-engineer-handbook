---
needs: [processes, atomics]
minutes: 55
one_idea: The kernel schedules threads by how much processor time each has already had, and almost every scheduling problem is really a question about who is blocked and what they are waiting for.
sources: [cpu-architectures, compilers-interpreters-terminals-unix]
---

Unit 034 ended by observing that a thread is a process with the sharing flags set
differently. This unit is the consequence: there is one scheduler, it deals in
threads, and processes are not scheduled at all.

## Three states, and only one of them costs anything

A thread is running, runnable, or blocked.

Running means it is on a processor now. Runnable means it could be and is waiting
for a turn. Blocked means it is waiting for something that is not a processor: a
read to complete, a lock to be released, a timer to expire.

The important part is that a blocked thread costs nothing. It is not on any run
queue, it is not considered when choosing what to run, and it consumes no time
until whatever it waited for happens. Ten thousand threads blocked on sockets are
ten thousand stacks of memory and no scheduling cost at all.

Which reframes the usual worry. Threads are expensive in memory, because each
needs a stack, and they are not expensive in scheduling unless they are actually
runnable. A server with too many threads has a memory problem or a contention
problem, and rarely a scheduler problem.

## Fairness as a debt

The obvious scheduler runs the highest priority thread that is ready. The
obvious scheduler starves everything below the top priority, so real ones do not
work that way.

Linux's approach is to track, per thread, how much processor time it has had,
scaled by its weight, and always run whichever has had least. A thread that has
been blocked has fallen behind, so it runs immediately when it wakes, which is
what makes interactive programs feel responsive without anybody classifying them
as interactive.

Priority, spelled as a nice value, is a weight on that accounting rather than an
ordering. A thread at a lower nice value accumulates virtual time more slowly, so
it gets more real time, and everything still runs. The scale is roughly ten
percent of processor share per step, so the difference between adjacent values is
meaningful and no value starves anything.

```figure
{
  "kind": "blocks",
  "alt": "Three threads with different accumulated virtual runtimes, with the scheduler selecting the smallest, and a fourth thread blocked and outside the queue entirely.",
  "caption": "The queue holds runnable threads ordered by time already had. A blocked thread is not in it, which is why blocking costs nothing and why waking puts you at the front.",
  "boxes": [
    { "id": "a", "x": 0,   "y": 0.2, "w": 3.4, "h": 1.1, "label": "vruntime 40", "accent": "azure" },
    { "id": "b", "x": 0,   "y": 1.6, "w": 3.4, "h": 1.1, "label": "vruntime 12", "accent": "jade" },
    { "id": "c", "x": 0,   "y": 3.0, "w": 3.4, "h": 1.1, "label": "vruntime 55", "accent": "azure" },
    { "id": "s", "x": 5,   "y": 1.6, "w": 3.4, "h": 1.1, "label": "run the least", "accent": "gold" },
    { "id": "z", "x": 10,  "y": 3.0, "w": 3.6, "h": 1.1, "label": "blocked", "sub": "not in the queue" }
  ],
  "arrows": [
    { "from": "b", "to": "s" }
  ]
}
```

## What a switch actually costs

Saving registers and loading another set is fast, a few hundred nanoseconds. The
cost that matters is what happens afterwards.

The new thread's data is not in cache, so it runs slowly until it has pulled its
working set back in. Its translations are not in the buffer, so it misses there
too. If it landed on a different core than last time, none of the caches it
warmed are the ones it now has.

So the real cost of a context switch is somewhere between one and several
microseconds of degraded execution, and it is paid by the thread that was
switched to rather than by the one that yielded. That is why it is hard to
attribute and why a system doing hundreds of thousands of switches per second is
slow for reasons no single profile line explains.

## One queue per processor

A single global queue would be a contended lock on every scheduling decision, so
each processor has its own and threads are balanced between them periodically.

Migration is what balancing does, and it is not free: it is the case above where
the caches are somebody else's. So the balancer is deliberately reluctant, which
means a thread can sit runnable on a busy processor while another sits idle, for
a short time, on purpose.

This is also where memory topology enters. On a machine with several memory
controllers, a thread's memory is attached to one of them, and being scheduled far
from it makes every access slower. Pinning a thread and its allocations to the
same node is a real technique with real gains, and it is the kind of thing that
is worth measuring rather than assuming.

## The two ways to wait badly

Most contention problems are one of two shapes.

The first is holding a lock while blocking. A thread that acquires a lock and
then waits for storage has stopped every other thread that wants that lock, for
the duration of a disk access. The rule that follows is short: do not do I/O
inside a lock.

The second is priority inversion. A low priority thread holds a lock, a high
priority thread needs it, and a medium priority thread is happy to run forever and
prevents the low one from finishing. The high priority thread is blocked by the
medium one, transitively, and nothing in the system's stated priorities describes
that.

The fix is priority inheritance: a thread holding a lock temporarily gets the
priority of the highest thread waiting for it. Mars Pathfinder famously shipped
without it enabled and rebooted repeatedly on the surface until the flag was set
remotely.

## Real time, and how to hang a machine

There are scheduling classes above the fair one, and a thread in them runs until
it blocks or yields. That is what real time means here: not fast, but not
preempted by ordinary work.

It is exactly as dangerous as it sounds. A real-time thread with a bug that spins
will occupy a processor forever, and on a single-processor system it will occupy
the only one, including the shell you would use to kill it. Linux reserves a small
fraction of each period for ordinary threads specifically so this is survivable.

The useful version is narrow: a thread with a genuine deadline, doing a bounded
amount of work, that yields promptly. Audio callbacks and motor control loops
qualify. Anything that allocates or takes a lock does not, because both can block
for an unbounded time.

## Waking everybody to disappoint them

One more pattern, because it produces load that looks like the scheduler's fault
and is not.

A condition that many threads wait on, signalled to all of them, wakes all of
them. They each become runnable, each gets scheduled, each discovers that only
one of them can proceed, and the rest go back to sleep. That is a thundering
herd, and its cost is the switches rather than the work.

The two repairs are to wake one rather than all, when the resource genuinely
serves one waiter, and to have the kernel do the choosing when several processes
are waiting on the same descriptor. Accepting connections used to be the standard
example: every process in a pool woke on every connection, and the fix was a flag
that tells the kernel to wake exactly one.

The general shape is worth recognising. When a system is spending its time in the
scheduler, the cause is usually that something is making threads runnable that
have nothing to do, and the fix is upstream of anything the scheduler could
decide.

## Sizing a pool

The rule people remember is one thread per core, and it is right for exactly one
case.

For work that is purely computation, more threads than cores adds context switches
and no throughput, so the core count is the answer. For work that blocks, the
right number is larger, because a blocked thread is not using a core, and the
useful figure is roughly cores times one plus the ratio of waiting to computing.

A pool serving requests that spend ninety percent of their time waiting on a
database wants about ten threads per core, and sizing it to the core count leaves
the machine idle while requests queue.

The measurement that decides it is the fraction of time your threads are runnable
rather than blocked, and it is directly observable.

## What to carry forward

The scheduler deals in threads, and a blocked thread costs nothing, so the
question to ask about a slow system is who is runnable and who is waiting.

Fairness is accounting rather than priority ordering, and a thread that has been
blocked runs first because it has fallen behind, which is what makes interactivity
work without anybody declaring it.

A context switch costs cold caches paid by the thread switched to. Do not block
while holding a lock. And pool size follows from how much your work waits, not
from the core count.

## Reading the errors you are about to see

These model the scheduler's decisions rather than measuring a real one, because a
measurement of scheduling on a shared machine is a measurement of the other
tenants.

`assert-failed` names the decision your model got wrong. The rules being modelled
are the ones above, and every case in the tests corresponds to a situation
described in the prose.
