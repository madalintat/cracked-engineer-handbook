## What was the older storage interface shaped for?

- [x] A device with one arm that reorders requests to reduce head movement
- [ ] A device with many independent chips
- [ ] A network attached array
- [ ] Sequential access from tape

@why Thirty-two outstanding commands is plenty for a device that can only do one
thing at a time, and nowhere near enough for one with dozens of chips.

## Why was a fast drive on that interface idle?

- [x] The host could not have enough requests outstanding to reach every chip
- [ ] The wire was too slow
- [ ] The controller could not keep up
- [ ] The medium could not sustain the rate

@why The bottleneck was not the medium, the controller or the wire. It was the
shape of the conversation, which is why the answer was a new interface rather
than a faster one.

## What is the intended queue arrangement in NVMe?

- [x] One submission and completion pair per processor core
- [ ] One deep queue shared by all cores
- [ ] One queue per NAND chip
- [ ] One queue per open file

@why The depth is the headline and this is the design: no two cores need ever
touch the same memory to talk to the device.

## Why does a queue per core matter more than the depth?

- [x] A shared queue needs a lock, and a contended lock's cost grows with the core count
- [ ] Each core gets its own bandwidth allocation
- [ ] It allows different priorities per core
- [ ] It reduces interrupt routing overhead

@why Submitting to a private queue touches only memory that core already owns,
which is why the per-command cost stopped rising as machines grew more cores.

## What decides how many requests must be outstanding to keep a device busy?

- [x] Throughput times latency
- [ ] Throughput divided by latency
- [ ] The number of chips in the device
- [ ] The queue depth the interface allows

@why A million operations a second at a hundred microseconds each means a hundred
in flight. Ask for fewer and the device is idle rather than slow.

## A benchmark issues one request at a time. What did it measure?

- [x] Latency, correctly, and reported it as throughput
- [ ] Throughput, correctly
- [ ] Nothing meaningful
- [ ] The interface's per-command overhead

@why Queue depth one tells you what an interactive operation waits for, and high
queue depth tells you what a batch job gets. A single number describes neither.

## What does the doorbell do, and why does it cost?

- [x] A write to a device register across the bus, which leaves the processor's own memory
- [ ] Signals an interrupt to the host
- [ ] Copies the command to the device
- [ ] Flushes the submission queue to NAND

@why Which is why several commands can be placed in the ring and one doorbell
announces all of them, so the per-command cost of reaching the device falls with
the batch size.

## What does interrupt coalescing trade?

- [x] Latency, up to the timer's duration, for a divided interrupt cost
- [ ] Throughput for latency
- [ ] Correctness for speed
- [ ] Memory for processor time

@why A good trade for a batch job and a bad one for a request somebody is waiting
on.

## When does polling beat interrupts?

- [x] When the completion rate is high enough that the core would have been busy anyway
- [ ] Always, since it removes a kernel transition
- [ ] When latency does not matter
- [ ] On single-core machines

@why Below that rate it is a core spent on nothing, which is why the kernel
supports all three schemes: the right choice depends on a ratio it cannot know.

## Does an NVMe command contain the data?

- [x] No; it describes where in host memory the data lives
- [ ] Yes, for transfers up to 4 KB
- [ ] Yes, always
- [ ] Only for writes

@why Which is why asking for four kilobytes and asking for a megabyte cost the
same submission, the same doorbell and the same completion.

## Why are small requests expensive per byte?

- [x] The per-request cost is fixed and the per-byte cost is small
- [ ] Small requests are more likely to be misaligned
- [ ] The device batches them internally
- [ ] They defeat the read-ahead

@why A workload doing four-kilobyte reads spends most of its budget on
bookkeeping, and the same bytes read in megabytes spends almost none.

## What was wrong with the old block layer?

- [x] One locked queue per device and a scheduler optimising for a constraint that had gone
- [ ] It could not address large devices
- [ ] It lacked support for asynchronous requests
- [ ] It copied every request through a bounce buffer

@why On a machine with many cores the lock was the limit, and the reordering was
work spent on head movement for a mechanism that no longer existed.

## What is the best scheduler for a device with no seek time?

- [x] Barely a scheduler
- [ ] The same one, with a shorter time window
- [ ] One that sorts by logical address
- [ ] One that groups requests by erase block

@why The layer it replaced was not wrong. It had stopped earning its cost, which
is a shape that recurs whenever a constraint disappears.

## A device can do a million operations a second and the software costs five microseconds each. What is delivered?

- [x] Two hundred thousand
- [ ] A million
- [ ] Five million
- [ ] It depends on the queue depth

@why Every one of those five microseconds is software, which is why the
interesting storage engineering of the last decade has been about removing host
overhead rather than making devices faster.

## Where has the storage bottleneck ended up?

- [x] In the operating system, after moving from the medium and then the interface
- [ ] Still in the medium
- [ ] In the PCIe bus
- [ ] In the filesystem's metadata

@why Each move made the previous layer's cleverness redundant, which is why the
software above the device has been getting thinner rather than more capable.
