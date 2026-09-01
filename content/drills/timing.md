## What decides the clock period for the whole design?

- [x] The deepest combinational path between any two flip-flops
- [ ] The average path depth across the design
- [ ] The slowest single gate in the library
- [ ] The number of pipeline stages

@why The deadline applies to every path at once and the worst one decides. That
is why the number engineers watch is the worst slack across the whole design
rather than a typical figure.

## What are the four things one clock period has to contain?

- [x] Clock to output, the logic settling, setup time, and clock skew
- [ ] Fetch, decode, execute, and writeback
- [ ] Rise time, fall time, propagation delay, and hold time
- [ ] Setup, hold, metastability window, and jitter

@why Whatever is left over after those four is slack, and getting the worst
slack to zero is timing closure, which is most of the schedule of a real chip.

## What happens when a path misses its setup deadline?

- [x] The flop captures the old value or a value partway through changing
- [ ] The result arrives one cycle later than expected
- [ ] The clock stretches automatically to accommodate it
- [ ] The design still works but draws more power

@why The intuition from software, that slow means the same answer later, does
not transfer. A missed deadline means a wrong value, and the design computes
from that wrong value onward.

## What is metastability?

- [x] A flop settling to neither 0 nor 1 for an unbounded time before falling one way
- [ ] A signal oscillating between two values at the clock frequency
- [ ] A latch that never resolves after reset
- [ ] Temperature-dependent drift in a gate's switching threshold

@why Its probability is small rather than zero, so a design with a marginal path
fails rarely and unpredictably, which survives testing and comes back as a field
return nobody can reproduce.

## What is a hold time violation?

- [x] A new value races through short logic and reaches the next flop before its input window closes
- [ ] A value arriving too late for the capturing edge
- [ ] A clock edge arriving before the previous one has settled
- [ ] A reset released while the clock is still gated

@why It is the deadline running the other way, and it catches people because it
is caused by a path being too fast rather than too slow.

## Why is a hold violation worse than a setup violation?

- [x] Slowing the clock fixes setup and does nothing for hold
- [ ] Hold violations are harder to detect in analysis
- [ ] Hold violations only appear at high temperature
- [ ] Setup violations are caught by equivalence checking

@why A chip that fails setup can be sold at a lower speed grade, which is what
binning is. A chip that fails hold is scrap, because the race does not care how
long the period is.

## Why do tools insert buffers into paths that are too fast?

- [x] To add delay on purpose, so a signal arrives after the hold window closes
- [ ] To strengthen the drive on a long wire
- [ ] To break up a path that has too much fanout
- [ ] To equalise the clock arrival at both flops

@why Delay added deliberately, in a design where everything else is a fight to
make signals arrive sooner.

## Why is a ripple carry adder's depth proportional to its width?

- [x] Each bit's carry feeds the next, so the top bit waits for every stage below
- [ ] Wider vectors need more buffering to drive
- [ ] The sum output has more bits to settle
- [ ] Wider adders use larger and therefore slower cells

@why Doubling the width doubles the delay. It is the canonical chain, and once
you have seen it the same shape appears in maxima, selections and accumulators.

## A maximum of eight values, as a chain and as a tournament. What differs?

- [x] The arrangement and therefore the depth; the number of comparisons is the same
- [ ] The tournament uses fewer comparators
- [ ] The chain gives a different answer on ties
- [ ] The tournament needs a clock and the chain does not

@why Seven comparisons either way. A chain is seven deep and a tournament is
three, and only the second one can be clocked fast.

## What does a tree cost that a chain does not?

- [x] Gates, and the area and power that go with them
- [ ] Latency, because results arrive a cycle later
- [ ] Correctness on some inputs
- [ ] Nothing, a tree is better in every respect

@why A chain can reuse one comparator across its steps and a tree needs its own
per pair. Trading depth against area is most of what physical design is.

## What does adding a pipeline stage do?

- [x] Roughly halves the deepest path and adds a cycle of latency
- [ ] Halves the path and leaves latency unchanged
- [ ] Doubles throughput and reduces area
- [ ] Removes the need for timing analysis on that path

@why Both halves are real. Throughput goes up, which is what you wanted, and any
particular result now takes an extra cycle, which somebody pays for.

## Why is a register at the end of a deep path not a pipeline stage?

- [x] The path is still as deep as it was; the result just has somewhere to sit
- [ ] Output registers are optimised away
- [ ] It inverts the clock polarity of that path
- [ ] It is, provided the register is wide enough

@why The cut has to be in the middle of the logic. Choosing where is the design
work, and it is why the number of stages a unit has is an architecture decision.

## Why can an accumulator not be pipelined?

- [x] Its output feeds its own input, so a register inside the loop changes what it computes
- [ ] Accumulators are always in a different clock domain
- [ ] The carry chain is not splittable
- [ ] It can be, but the tools do not support it

@why A register in the loop means adding to a value that is a cycle stale, which
is a different function rather than a faster one. The width is the lever that is
left.

## How does static timing analysis know a design's worst path?

- [x] It walks the netlist with a delay library, considering every path without any input vectors
- [ ] It simulates with random stimulus and records the slowest observed path
- [ ] It measures the fabricated chip and back-annotates
- [ ] It estimates from the total cell count

@why Delay does not depend on the values, only on the structure, which is the
same reason the equivalence checker in the last unit needed no vectors either.

## What is a false path, and why is it a nuisance?

- [x] A path no input can activate, which analysis still reports and someone has to exclude by hand
- [ ] A path introduced by the synthesis tool that is not in the source
- [ ] A path that violates hold but not setup
- [ ] A path through a clock gate

@why Considering every path is the strength of the method and also its weakness,
because "every path" includes the ones that cannot happen.
