---
needs: [flash, atomics]
minutes: 55
one_idea: A medium made of many independent chips is only as fast as the interface's ability to have many requests outstanding, and the old interfaces could not.
sources: [cpu-architectures, compilers-interpreters-terminals-unix]
---

The last unit ended on the observation that a flash drive contains many
independent chips and one request at a time uses one of them. This unit is about
what it took to actually reach them, and why it required throwing away an
interface rather than speeding one up.

## An interface shaped like a disk

The interface flash inherited was designed for a device with one arm. One
command queue, thirty-two entries, and a protocol whose registers were laid out
for a controller that would service them in an order it chose to minimise head
movement.

Thirty-two outstanding commands is enough for a disk, because a disk can only do
one thing at a time and the queue exists so the controller can reorder. It is
nowhere near enough for a device with dozens of independent chips, each capable
of an operation concurrently.

So a fast drive on that interface was idle most of the time, waiting for a host
that could not ask for enough at once. The bottleneck was not the medium, the
controller or the wire. It was the shape of the conversation.

## Many queues, and one per core

The replacement inverts the design. Up to sixty-five thousand queues, each with
up to sixty-five thousand entries, and the intended arrangement is one queue pair
per processor core.

That last part is the important one and it is not about depth. A single shared
queue needs a lock, and unit 026 already priced a contended lock: the cache line
holding it moves between cores and the cost grows with the core count. A queue
per core has no sharing at all, so submitting a command touches only memory that
core already owns.

Each pair is a submission queue and a completion queue, both living in host
memory. The host writes a command into the submission ring and rings a doorbell,
which is a single write to a device register. The device reads the command over
the bus, does the work, and writes an entry into the completion ring.

```figure
{
  "kind": "blocks",
  "alt": "Four cores each with their own submission and completion queue pair in host memory, all feeding one device, with no shared structure between them.",
  "caption": "One pair per core, in host memory, with nothing shared. The absence of a common structure is the design, and it is why the cost per command stopped growing with the core count.",
  "boxes": [
    { "id": "c0", "x": 0,   "y": 0.2, "w": 3.4, "h": 1.1, "label": "core 0 pair", "accent": "azure" },
    { "id": "c1", "x": 0,   "y": 1.6, "w": 3.4, "h": 1.1, "label": "core 1 pair", "accent": "azure" },
    { "id": "c2", "x": 0,   "y": 3.0, "w": 3.4, "h": 1.1, "label": "core 2 pair", "accent": "azure" },
    { "id": "d",  "x": 5.4, "y": 1.6, "w": 3.4, "h": 1.1, "label": "the device", "accent": "jade" }
  ],
  "arrows": [
    { "from": "c0", "to": "d" },
    { "from": "c1", "to": "d" },
    { "from": "c2", "to": "d" }
  ]
}
```

## The arithmetic of keeping it busy

There is one equation that decides how many requests you need outstanding, and it
is not specific to storage.

Concurrency equals throughput times latency. A device that completes a million
operations per second, each taking a hundred microseconds, has a hundred
operations in flight at all times. Ask for fewer and you get less throughput; the
device is not slower, it is idle.

This is why a benchmark with one thread issuing one request at a time reports a
tenth of a drive's capability and is not wrong about anything. It measured
latency, correctly, and reported it as though it were throughput.

It also explains the shape of the two useful measurements. Queue depth one tells
you the latency, which is what an interactive operation waits for. High queue
depth tells you the throughput, which is what a batch job gets. A drive can be
excellent at one and unremarkable at the other, and a single number describes
neither.

## Being told, or asking

A completed command has to reach the host somehow, and there are two ways with
opposite costs.

An interrupt costs a trip into the kernel, which unit 022 priced, and it arrives
promptly. At a million completions a second that is a million interrupts, which
is more work than the requests themselves.

Coalescing waits for several completions or a short timer before interrupting
once. It divides the interrupt cost by the batch size and adds up to the timer's
duration to every completion's latency. Which is a good trade for throughput and
a bad one for a request somebody is waiting on.

Polling removes interrupts entirely: the thread spins reading the completion
queue. That costs a core doing nothing else and it removes both the interrupt and
the wakeup, so it wins when the completion rate is high enough that the core would
have been busy anyway. Below that rate it is a core spent on nothing.

The kernel supports all three because the right choice depends on a ratio the
kernel cannot know.

## The doorbell, and why one write is a lot

Ringing the doorbell is a write to a device register across the bus, and it is
the one part of the submission path that leaves the processor's own memory.

That costs far more than writing the command did. Which is why the ring is a ring:
several commands can be placed in it and one doorbell write announces all of
them, so the per-command cost of reaching the device falls with the batch size.

A driver that rings after every command is correct and slow, and one that batches
is correct and fast, and the difference is visible only under load. It is the
same shape as the buffering in unit 022: the boundary is expensive, so cross it
less often rather than more cheaply.

The completion direction has the same property from the other side, which is what
the next section's coalescing is.

## The layer above had to change too

None of this helps if the operating system funnels everything through one
structure, and for years it did.

The old block layer had a single request queue per device, with a lock, and a
scheduler designed to reorder requests to reduce head movement on a mechanism
that no longer existed. On a machine with many cores that lock was the limit, and
the reordering was work spent optimising for a constraint that had gone away.

The replacement gives each core a software queue, maps those onto the device's
hardware queues, and defaults to doing almost no scheduling at all. That last
part is the interesting one: the best scheduler for a device with no seek time
turned out to be barely a scheduler.

Which is a recurring shape. A layer written to compensate for a constraint
becomes overhead when the constraint disappears, and it takes a long time for
anybody to notice, because the layer is not wrong, it is just no longer earning
its cost.

## What a command carries

One more property, because it decides how much data one request can move.

A command is a fixed-size entry, sixty-four bytes, and it does not contain the
data. It contains a description of where in host memory the data lives, and the
device fetches or deposits it directly without the processor touching any of it.

Which means the size of a transfer is almost independent of the cost of asking
for it. Reading four kilobytes and reading a megabyte cost the same submission,
the same doorbell and the same completion, and differ only in the time the
transfer takes.

That is the arithmetic behind a rule that keeps appearing in this part: large
requests are cheap per byte and small ones are not, because the per-request cost
is fixed and the per-byte cost is small. A workload doing four-kilobyte reads
spends most of its budget on bookkeeping, and the same bytes read in megabytes
spends almost none.

It also means the host's memory layout matters. A transfer scattered across many
non-contiguous pages needs a list of them, which the device reads separately, so
a buffer that is one contiguous run is cheaper to describe than the same bytes in
fragments.

## Where the bottleneck went

Add the pieces up and the result is a device that can complete millions of
operations per second, at which point something else becomes the limit.

At those rates the per-operation cost in the host matters: the system call, the
interrupt, the copy through a buffer, the filesystem's bookkeeping. A drive
capable of a million operations per second attached to a stack costing five
microseconds each will deliver two hundred thousand, and every one of those five
microseconds is software.

That is why io_uring exists, why polling exists, why some workloads bypass the
kernel entirely and drive the device from userspace, and why the interesting
storage engineering of the last decade has been about removing host overhead
rather than making devices faster.

The bottleneck moved from the medium to the interface, and then from the
interface to the operating system, and each move made the previous layer's
cleverness redundant.

## What to carry forward

The medium is parallel and an interface has to express that. One queue of
thirty-two commands cannot, and one queue per core with a deep ring can.

Concurrency is throughput times latency, so the number of requests you keep
outstanding decides which of the two you measure, and a benchmark at queue depth
one reports latency whatever it claims to be reporting.

Interrupts, coalescing and polling trade the same quantity three ways. And the
bottleneck is now in the host, which is why the software above the device has
been getting thinner rather than cleverer.

## Reading the errors you are about to see

These compute queue arithmetic and completion costs, which is exact, where a
measurement of a shared machine's storage stack would be a measurement of the
other tenants.

`assert-failed` names the number your model got wrong. Every one of them follows
from the relationship in the prose rather than from a device's datasheet.
