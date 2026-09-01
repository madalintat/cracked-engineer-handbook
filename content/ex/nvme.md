## Concurrency is throughput times latency

Write `queue_depth_needed`, returning how many requests must be outstanding to
keep a device busy, given the operations per second it can complete and the
microseconds each one takes.

Ask for fewer and the device is idle rather than slow.

@kind output
@concept One relation decides how many requests you keep in flight, and it is not
specific to storage.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Multiply, and mind the units: the rate is per second and the latency is in
microseconds.
@diagnose assert verdict assert-failed
A check disagrees. A million operations per second at a hundred microseconds each
needs a hundred in flight, so the product has to be divided by a million to
reconcile per-second with per-microsecond. Dividing rather than multiplying
inverts the whole relationship.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Which is why a benchmark with one thread issuing one request at a time
reports a tenth of a drive's capability and is not wrong about anything. It
measured latency, correctly, and reported it as though it were throughput.

```starter
unsigned long queue_depth_needed(unsigned long ops_per_sec,
                                 unsigned long latency_us) {
    return ops_per_sec / latency_us;
}
```

```tests
#include <assert.h>
unsigned long queue_depth_needed(unsigned long, unsigned long);
int main(void) {
    /* A million a second at 100 microseconds each. */
    assert(queue_depth_needed(1000000, 100) == 100);
    /* Half the rate, same latency. */
    assert(queue_depth_needed(500000, 100) == 50);
    /* A slow disk: 120 a second at 8 milliseconds. */
    assert(queue_depth_needed(120, 8000) == 0);
    /* Ten microseconds on a fast device. */
    assert(queue_depth_needed(2000000, 10) == 20);
    return 0;
}
```

```solution
unsigned long queue_depth_needed(unsigned long ops_per_sec,
                                 unsigned long latency_us) {
    return ops_per_sec * latency_us / 1000000;
}
```

## What the interface could express

Write `achievable_ops`, returning how many operations per second a device can
actually deliver, given its capability, its latency, and the maximum number of
commands the interface allows outstanding.

Thirty-two is enough for a device with one arm and nowhere near enough for one
with dozens of chips.

@kind output
@concept An interface that cannot hold enough requests outstanding limits the
device regardless of what the medium could do.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The interface caps the concurrency, and concurrency over latency is the
rate.
@diagnose assert verdict assert-failed
A check disagrees. The device's own capability is a ceiling and the interface
imposes another, so the answer is the smaller of the two: a queue of 32 at a
hundred microseconds each cannot exceed 320000 a second whatever the medium can
do.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A fast drive on the old interface was idle most of the time, waiting for a
host that could not ask for enough at once. The bottleneck was not the medium,
the controller or the wire, but the shape of the conversation, which is why the
answer was a new interface rather than a faster one.

```starter
unsigned long achievable_ops(unsigned long device_capability,
                             unsigned long latency_us,
                             unsigned long max_outstanding) {
    (void)latency_us; (void)max_outstanding;
    return device_capability;
}
```

```tests
#include <assert.h>
unsigned long achievable_ops(unsigned long, unsigned long, unsigned long);
int main(void) {
    /* A million-op device, 100 us each, limited to 32 outstanding. */
    assert(achievable_ops(1000000, 100, 32) == 320000);
    /* The same device with a deep queue reaches its own limit. */
    assert(achievable_ops(1000000, 100, 1024) == 1000000);
    /* A disk: one arm, and 32 outstanding is more than enough. */
    assert(achievable_ops(120, 8000, 32) == 120);
    return 0;
}
```

```solution
unsigned long achievable_ops(unsigned long device_capability,
                             unsigned long latency_us,
                             unsigned long max_outstanding) {
    unsigned long by_queue = max_outstanding * 1000000 / latency_us;
    return by_queue < device_capability ? by_queue : device_capability;
}
```

## One queue, or one each

Write `submit_cost`, returning the cost of submitting a command, given whether
the queue is shared between cores and how many cores are contending.

A shared queue needs a lock, and unit 026 priced a contended one.

@kind output
@concept A queue per core has nothing shared, so submitting touches only memory
that core already owns and the cost stops growing with the core count.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint With a private queue the core count does not appear in the answer at all.
@diagnose assert verdict assert-failed
A check disagrees. A private queue costs the same whether one core or sixty-four
are submitting, because nothing is shared. A shared one costs the base plus a
contention term that grows with the number of cores fighting for the line.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The depth was the headline and this is the design. Sixty-five thousand
queues exists so that no two cores need ever touch the same memory to talk to the
device, and it is the reason the per-command cost stopped rising as machines grew
more cores.

```starter
unsigned long submit_cost(int shared, unsigned long cores,
                          unsigned long base_ns, unsigned long contend_ns) {
    (void)shared;
    return base_ns + cores * contend_ns;
}
```

```tests
#include <assert.h>
unsigned long submit_cost(int, unsigned long, unsigned long, unsigned long);
int main(void) {
    /* A private queue: the same cost however many cores exist. */
    assert(submit_cost(0, 1, 50, 200) == 50);
    assert(submit_cost(0, 64, 50, 200) == 50);
    /* A shared queue with one core: no contention. */
    assert(submit_cost(1, 1, 50, 200) == 50);
    /* Shared, with four cores fighting. */
    assert(submit_cost(1, 4, 50, 200) == 650);
    return 0;
}
```

```solution
unsigned long submit_cost(int shared, unsigned long cores,
                          unsigned long base_ns, unsigned long contend_ns) {
    if (!shared) return base_ns;
    return base_ns + (cores - 1) * contend_ns;
}
```

## Ringing once for several

Write `doorbell_cost_per_command`, returning the average cost of reaching the
device per command, given the fixed cost of a doorbell write and how many
commands are placed in the ring before ringing it.

The doorbell is the one part of the path that leaves the processor's own memory.

@kind output
@concept The boundary is expensive, so cross it less often rather than more
cheaply, which is the same move as the buffering in unit 022.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The fixed cost is divided among the batch; the per-command cost is not.
@diagnose assert verdict assert-failed
A check disagrees. Writing the command into the ring costs the same for every
one, and only the doorbell is shared, so the average is the per-command cost plus
the doorbell divided by the batch size. Dividing both understates it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A driver that rings after every command is correct and slow. One that
batches is correct and fast, and the difference is visible only under load, which
is why it is the sort of thing that survives a review and shows up in a
production graph.

```starter
unsigned long doorbell_cost_per_command(unsigned long doorbell_ns,
                                        unsigned long write_ns,
                                        unsigned long batch) {
    return (doorbell_ns + write_ns) / batch;
}
```

```tests
#include <assert.h>
unsigned long doorbell_cost_per_command(unsigned long, unsigned long,
                                        unsigned long);
int main(void) {
    /* Ringing after every command: both costs, every time. */
    assert(doorbell_cost_per_command(400, 20, 1) == 420);
    /* Eight per doorbell. */
    assert(doorbell_cost_per_command(400, 20, 8) == 70);
    /* Sixty-four. */
    assert(doorbell_cost_per_command(400, 20, 64) == 26);
    return 0;
}
```

```solution
unsigned long doorbell_cost_per_command(unsigned long doorbell_ns,
                                        unsigned long write_ns,
                                        unsigned long batch) {
    return write_ns + doorbell_ns / batch;
}
```

## Told, or asked

Write `completion_overhead_ns`, returning the host cost per completion under
three schemes: 0 an interrupt each, 1 coalescing into batches, 2 polling.

Polling costs a core's time whether or not anything completed.

@kind output
@concept The three trade the same quantity three ways, and the right choice
depends on a rate the kernel cannot know.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Coalescing divides the interrupt cost by the batch. Polling replaces it
with the poll's own cost.
@diagnose assert verdict assert-failed
A check disagrees. Coalescing does not remove the interrupt, it shares one among
several completions, so the per-completion cost is the interrupt divided by the
batch. Polling removes it entirely and substitutes the cost of looking.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Polling wins when the completion rate is high enough that the core would
have been busy anyway, and below that it is a core spent on nothing. Coalescing
adds up to the timer's duration to every completion's latency, which is a good
trade for a batch job and a bad one for a request somebody is waiting on.

```starter
unsigned long completion_overhead_ns(int scheme, unsigned long interrupt_ns,
                                     unsigned long batch, unsigned long poll_ns) {
    (void)batch; (void)poll_ns;
    return scheme == 2 ? 0 : interrupt_ns;
}
```

```tests
#include <assert.h>
unsigned long completion_overhead_ns(int, unsigned long, unsigned long,
                                     unsigned long);
int main(void) {
    /* One interrupt each. */
    assert(completion_overhead_ns(0, 2000, 16, 50) == 2000);
    /* Coalesced sixteen at a time. */
    assert(completion_overhead_ns(1, 2000, 16, 50) == 125);
    /* Polling: no interrupt, but the poll itself. */
    assert(completion_overhead_ns(2, 2000, 16, 50) == 50);
    /* A batch of one is the same as not coalescing. */
    assert(completion_overhead_ns(1, 2000, 1, 50) == 2000);
    return 0;
}
```

```solution
unsigned long completion_overhead_ns(int scheme, unsigned long interrupt_ns,
                                     unsigned long batch, unsigned long poll_ns) {
    if (scheme == 0) return interrupt_ns;
    if (scheme == 1) return interrupt_ns / batch;
    return poll_ns;
}
```

## Fixed per request, small per byte

Write `cost_per_byte_ns`, returning the average cost of moving a byte, given the
fixed per-request cost and the transfer size at a given rate.

A command describes where the data is rather than containing it, so asking costs
the same whatever the size.

@kind output
@concept The per-request cost is fixed and the per-byte cost is small, which is
why large requests are cheap per byte and small ones are not.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Total time over total bytes, and the fixed cost is paid once per request
rather than once per byte.
@diagnose assert verdict assert-failed
A check disagrees. The fixed cost is amortised over the whole transfer, so it
divides by the byte count, and the transfer time per byte does not. Adding them
without dividing the first reports the fixed cost as though every byte paid it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A workload doing four-kilobyte reads spends most of its budget on
bookkeeping, and the same bytes read in megabytes spends almost none. That
arithmetic is the reason every layer in this part prefers large sequential
requests, and it is the same reason unit 039's garbage collector does.

```starter
unsigned long cost_per_byte_ns(unsigned long fixed_ns, unsigned long bytes,
                               unsigned long ns_per_byte) {
    return fixed_ns + ns_per_byte;
}
```

```tests
#include <assert.h>
unsigned long cost_per_byte_ns(unsigned long, unsigned long, unsigned long);
int main(void) {
    /* 5000 ns of fixed cost spread over 4 KB, at 1 ns a byte. */
    assert(cost_per_byte_ns(5000, 4096, 1) == 2);
    /* The same fixed cost over a megabyte. */
    assert(cost_per_byte_ns(5000, 1048576, 1) == 1);
    /* One byte pays all of it. */
    assert(cost_per_byte_ns(5000, 1, 1) == 5001);
    /* A slower medium where the transfer dominates. */
    assert(cost_per_byte_ns(5000, 4096, 100) == 101);
    return 0;
}
```

```solution
unsigned long cost_per_byte_ns(unsigned long fixed_ns, unsigned long bytes,
                               unsigned long ns_per_byte) {
    if (bytes == 0) return fixed_ns;
    return ns_per_byte + fixed_ns / bytes;
}
```

## The scheduler that stopped earning its cost

Write `reorder_benefit_ns`, returning how much time reordering requests saves,
given the seek time the reordering avoids and how many requests were reordered.

On a device with no seek time the benefit is zero and the work is not.

@kind output
@concept A layer written to compensate for a constraint becomes overhead when the
constraint disappears, and it takes a long time for anybody to notice.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The saving is the avoided seeks; the cost of sorting is paid regardless.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the case with no seek time. Reordering saves
the seeks it avoided, which on a device with none is nothing, and the sorting
still costs what it costs. The answer can be negative, and that is the situation
the whole block layer was rewritten over.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The best scheduler for a device with no seek time turned out to be barely
a scheduler. The replacement gives each core a software queue and defaults to
doing almost nothing, and the layer it replaced was not wrong, it had just stopped
earning its cost.

```starter
long reorder_benefit_ns(unsigned long seeks_avoided, unsigned long seek_ns,
                        unsigned long sort_ns) {
    (void)sort_ns;
    return (long)(seeks_avoided * seek_ns);
}
```

```tests
#include <assert.h>
long reorder_benefit_ns(unsigned long, unsigned long, unsigned long);
int main(void) {
    /* A disk: twenty seeks avoided at eight milliseconds each. */
    assert(reorder_benefit_ns(20, 8000000, 5000) == 159995000L);
    /* Flash: no seeks to avoid, and the sorting still happened. */
    assert(reorder_benefit_ns(20, 0, 5000) == -5000L);
    assert(reorder_benefit_ns(0, 8000000, 5000) == -5000L);
    return 0;
}
```

```solution
long reorder_benefit_ns(unsigned long seeks_avoided, unsigned long seek_ns,
                        unsigned long sort_ns) {
    return (long)(seeks_avoided * seek_ns) - (long)sort_ns;
}
```

## Where the limit actually is

Write `delivered_ops`, returning how many operations per second a system delivers,
given the device's capability and the host's software cost per operation in
microseconds.

At a million operations per second the software becomes the limit.

@kind output
@concept The bottleneck moved from the medium to the interface and then to the
operating system, and each move made the previous layer's cleverness redundant.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One core can perform only so many operations if each costs a fixed amount
of its time.
@diagnose assert verdict assert-failed
A check disagrees. The host's rate is a million microseconds per second divided
by the cost of one operation, and the answer is whichever of that and the device
is smaller. Reporting the device's capability ignores the half of the system that
is now the constraint.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A drive capable of a million operations per second behind a stack costing
five microseconds each delivers two hundred thousand, and every one of those five
microseconds is software. That is why io_uring exists, why polling exists, and
why some workloads drive the device from userspace entirely.

```starter
unsigned long delivered_ops(unsigned long device_ops,
                            unsigned long host_us_per_op) {
    (void)host_us_per_op;
    return device_ops;
}
```

```tests
#include <assert.h>
unsigned long delivered_ops(unsigned long, unsigned long);
int main(void) {
    /* A million-op device behind five microseconds of software. */
    assert(delivered_ops(1000000, 5) == 200000);
    /* Cheap software: the device is the limit again. */
    assert(delivered_ops(1000000, 1) == 1000000);
    /* A slow device: the software is irrelevant. */
    assert(delivered_ops(120, 5) == 120);
    return 0;
}
```

```solution
unsigned long delivered_ops(unsigned long device_ops,
                            unsigned long host_us_per_op) {
    if (host_us_per_op == 0) return device_ops;
    unsigned long by_host = 1000000 / host_us_per_op;
    return by_host < device_ops ? by_host : device_ops;
}
```
