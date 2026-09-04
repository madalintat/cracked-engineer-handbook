## What was the streaming multiprocessor designed for?

- [x] Shading triangles; compute was fitted into machinery that already existed
- [ ] General purpose parallel computation, with graphics as one application
- [ ] Scientific computing, and graphics adopted it later
- [ ] Neither; it was designed for compute and graphics at the same time

@why Every feature that seems arbitrary is a graphics decision you are
inheriting, and that is the shortest route to understanding the ones that look
strangest.

## Where did the hardware for a warp shuffle come from?

- [x] The register file crossbar built so that lanes of a pixel block could read each other for derivatives
- [ ] A compute feature added in a later generation with no graphics use
- [ ] The shared memory banking network
- [ ] The texture unit's addressing hardware

@why A fast reduction inside a warp is a graphics feature that happened to help
compute, and it was in the silicon long before anybody asked for it.

## What does a warp do when its lanes take different sides of a branch?

- [x] It runs both sides in turn, with the inactive lanes switched off for each
- [ ] It splits into two warps that run independently
- [ ] It predicts the more likely side and rolls back if wrong
- [ ] It serialises to one lane at a time

@why Both sides are paid for in full, which is why one lane going the other way
costs exactly what sixteen do.

## Where does the idea that divergence is bad come from?

- [x] The screen: two fragments diverge when a triangle edge runs between them, so coherent meant spatially coherent
- [ ] Measurements of early compute kernels
- [ ] The cost of flushing a branch predictor
- [ ] The memory system, which cannot serve two addresses at once

@why Sort your work so neighbouring threads take the same path is the same
sentence as sort your draws so neighbouring pixels take the same path, moved to
a domain where the neighbours are array indices.

## A lane predicated off in a divergent warp is the same thing as what?

- [x] A helper lane: an uncovered pixel that runs the shader and has its result discarded
- [ ] An idle core waiting for work
- [ ] A thread blocked on a barrier
- [ ] A lane whose instruction was never issued

@why The hardware is comfortable with running a lane whose result is thrown
away because it has been doing exactly that at triangle edges for decades.

## Why is a multiprocessor's register file larger than its first level cache?

- [x] It holds the full register state of every resident thread at once, so a warp switch costs nothing
- [ ] Registers are slower than cache and so need more of them
- [ ] It doubles as a spill area for shared memory
- [ ] It caches the most recently used values from memory

@why It is a context store rather than a cache. Nothing is saved and restored,
because saving and restoring would make a switch cost something.

## Why did the design choose to hide memory latency rather than reduce it?

- [x] A renderer has millions of independent fragments, so there is always other work to run
- [ ] Reducing latency was too expensive in transistors
- [ ] The memory technology available had a fixed latency floor
- [ ] Latency does not matter when bandwidth is high enough

@why Independence is the property that makes it possible. With enough resident
work the wait costs nothing, which is a different answer from making the wait
shorter.

## What is occupancy?

- [x] Resident warps as a fraction of the maximum the hardware could hold
- [ ] The fraction of arithmetic units busy in a cycle
- [ ] The fraction of the register file in use
- [ ] The fraction of a kernel's threads that have started

@why It has no equivalent on a general purpose processor, because there the
machine hides latency for you and here it is your job.

## Using more registers per thread lowers occupancy. Why?

- [x] Every resident thread's registers must exist at once, so wider threads mean fewer of them fit
- [ ] The compiler spills to memory, which slows every access
- [ ] Registers are allocated from the shared memory budget
- [ ] Wider threads take longer to switch between

@why It is why a kernel that spills a few more registers can lose a large
fraction of its performance in one step rather than gradually.

## If latency cannot be reduced, what is the tuning knob?

- [x] Arithmetic intensity: issue fewer memory accesses, or have more work running while they happen
- [ ] Clock frequency
- [ ] Cache hit rate, through better replacement policies
- [ ] Instruction level parallelism inside one thread

@why It is why tiling into the scratchpad exists and why every later mechanism
for streaming data into the multiprocessor exists: keeping the machine fed
rather than making one operation quick.

## Why does this machine have no branch predictor, speculation or out of order execution?

- [x] All three hide latency inside one instruction stream, and with dozens of warps resident there is already somewhere else to go
- [ ] They are too power hungry at this transistor count
- [ ] Shader code has no branches worth predicting
- [ ] They were removed to make room for tensor units

@why It deleted the most expensive apparatus a processor has and spent the
budget on registers and arithmetic units, and graphics is what told it that
trade was correct.

## How does an atomic operation work on this machine?

- [x] Dedicated units at the shared cache and memory partitions perform it in place, bypassing the shader cores
- [ ] Through the cache coherence protocol, as on a processor
- [ ] By serialising the warp and letting one lane at a time take a lock
- [ ] In the shader core, with the memory system blocking competing accesses

@why The value never comes back to the multiprocessor unless you asked for a
return value, and competing accesses to the same address are blocked by hashing
the address.

## Which part of the graphics pipeline are atomics inherited from?

- [x] The output stage, a read modify write engine bolted to a memory partition
- [ ] The rasteriser, which resolves overlapping coverage
- [ ] The texture unit, which already served many lanes at once
- [ ] The interpolators, which combine per vertex values

@why The address space is split across partitions so that two of them never
touch the same address and never have to agree about anything.

## What did general purpose programmability actually add?

- [x] Scatter, pointers, a scratchpad, and permission to stop dressing computation as a picture
- [ ] Floating point arithmetic and branching
- [ ] The warp and its scheduler
- [ ] Cross lane communication

@why Scatter, writing to an address you computed rather than to the pixel you
were assigned, is most of the difference between a shader and a program.

## Why does a scratchpad exist rather than just a larger cache?

- [x] The tiling a renderer got free from texture locality has to be written by hand when the access pattern is not two dimensional and coherent
- [ ] A cache cannot be shared between threads of a block
- [ ] It is faster than any cache the process can build
- [ ] Caches cannot be made large enough at this transistor budget

@why It is fast memory under the programmer's control rather than memory that
decides for itself, which is what an irregular access pattern needs.
