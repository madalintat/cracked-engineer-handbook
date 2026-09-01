## What does the kernel schedule?

- [x] Threads; processes are not scheduled at all
- [ ] Processes, which then schedule their own threads
- [ ] Whichever the program asked for
- [ ] Processes on one queue and threads on another

@why A thread is a process with the sharing flags set differently, so there is
one scheduler and one kind of object for it to choose between.

## What does a blocked thread cost the scheduler?

- [x] Nothing; it is not on any run queue
- [ ] A slot in the round robin, skipped each pass
- [ ] Its share of the time slice, wasted
- [ ] A periodic check of whether it can proceed

@why Ten thousand threads blocked on sockets are ten thousand stacks of memory
and no scheduling cost. Threads are expensive in memory and not in scheduling
unless they are runnable.

## How does Linux decide which runnable thread to run?

- [x] The one with the least accumulated virtual runtime
- [ ] The highest priority one
- [ ] The one that has been waiting longest
- [ ] Round robin over the run queue

@why A thread that has been blocked has fallen behind, so it runs immediately
when it wakes, which is what makes interactive programs responsive without
anybody classifying them as interactive.

## What is a nice value?

- [x] A weight that divides the virtual runtime accounting
- [ ] A position in a priority ordering
- [ ] A maximum share of the processor
- [ ] A hint the scheduler may ignore

@why A heavier thread accumulates virtual time more slowly and so gets more real
time, and nothing starves at any value because everybody's runtime still grows.

## What is the dominant cost of a context switch?

- [x] Cold caches and translations, paid by the thread switched to
- [ ] Saving and restoring registers
- [ ] The trap into the kernel
- [ ] Updating the run queue

@why A few hundred nanoseconds of register work and one to several microseconds
of degraded execution afterwards, which is why it is hard to attribute.

## Why does each processor have its own run queue?

- [x] A single global queue would be a contended lock on every scheduling decision
- [ ] To keep threads near their memory
- [ ] Because each processor runs its own kernel
- [ ] To allow different scheduling policies per core

@why Threads are balanced between them periodically instead, and the balancer is
deliberately reluctant because migration costs the cold caches above.

## Why might a thread sit runnable while another processor is idle?

- [x] Migrating costs more than the wait it would avoid
- [ ] The scheduler has not noticed yet
- [ ] The thread is pinned by default
- [ ] Idle processors are held in reserve

@why It is on purpose, and on a machine with several memory controllers the
reluctance is stronger still, because a thread scheduled away from its memory
pays on every access rather than only while warming up.

## What is wrong with doing I/O while holding a lock?

- [x] Every thread wanting that lock is stopped for the duration of a disk access
- [ ] The lock cannot be released from an interrupt context
- [ ] The kernel may not schedule the holder again
- [ ] Nothing, as long as the I/O is short

@why It converts one thread's wait into everybody's, multiplied by the number of
threads that wanted the same lock.

## What is priority inversion?

- [x] A high priority thread blocked transitively by a medium one, through a lock a low one holds
- [ ] A scheduler bug that runs low priority threads first
- [ ] Two threads each waiting for the other's lock
- [ ] A thread whose priority is lowered while it runs

@why Nothing in the stated priorities describes that relationship, which is what
makes it hard to see in a design that looks correct.

## What is priority inheritance?

- [x] A lock holder temporarily takes the priority of the highest thread waiting for it
- [ ] Child threads inherit their parent's priority
- [ ] A thread's priority decays while it runs
- [ ] Waiters adopt the holder's priority

@why Mars Pathfinder shipped with it disabled and rebooted repeatedly on the
surface until the flag was set remotely.

## What does a real-time scheduling class mean?

- [x] The thread runs until it blocks or yields, and ordinary work cannot preempt it
- [ ] The thread is guaranteed a maximum latency
- [ ] The thread runs faster
- [ ] The thread gets a dedicated core

@why A real-time thread that spins occupies a processor forever, which is why
Linux reserves a fraction of each period for ordinary threads so the situation is
survivable.

## What kind of work belongs in a real-time thread?

- [x] A bounded amount of work with a genuine deadline, that yields promptly
- [ ] Anything latency sensitive
- [ ] The main loop of a server
- [ ] Anything the user is waiting for

@why Anything that allocates or takes a lock does not qualify, because both can
block for an unbounded time.

## A pool serves requests that spend ninety percent of their time waiting. How many threads per core?

- [x] About ten
- [ ] One
- [ ] Two
- [ ] As many as there are concurrent requests

@why A blocked thread is not using a core, so the figure is cores times one plus
the ratio of waiting to computing. Sizing to the core count leaves the machine
idle while requests queue.

## What is a thundering herd?

- [x] Many threads woken for a resource that can serve one, all but one going back to sleep
- [ ] A burst of requests arriving together
- [ ] Threads migrating between processors in a group
- [ ] A cache line contended by every core

@why The cost is the switches rather than the work, and the repairs are to wake
one, or to let the kernel choose when several processes wait on one descriptor.

## A system is spending its time in the scheduler. What is the usual cause?

- [x] Something is making threads runnable that have nothing to do
- [ ] The run queue is too long
- [ ] Too many cores for the workload
- [ ] The time slice is too short

@why The fix is upstream of anything the scheduler could decide, which is the
general shape of scheduling problems.
