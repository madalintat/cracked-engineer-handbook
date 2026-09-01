## What happens if two ordinary gate outputs drive the same wire?

- [x] If they disagree, there is a path from the supply to ground through both
      gates
- [ ] The stronger one wins
- [ ] The wire settles to an average voltage
- [ ] Nothing, as long as they are never read at once

@why That is the crowbar current from Part I, and it destroys the parts. A
shared wire needs something an ordinary gate cannot do.

## What is the third state of a tri-state buffer?

- [x] Disconnected, with both networks off and the output attached to nothing
- [ ] A voltage halfway between high and low
- [ ] Logic 0 with a weak pull-down
- [ ] An error state the hardware reports

@why High impedance is not a value. A wire at high impedance is electrically
absent, which is exactly what lets something else drive it.

## High impedance is the same as logic 0.

- [ ] True
- [x] False, and confusing the two is the classic bus mistake
- [ ] True only while the clock is low
- [ ] True for NMOS outputs

@why A wire that is absent lets another driver take it. A wire held at 0 fights
anything trying to drive it high, which is the short this whole arrangement
exists to avoid.

## What makes a bus safe?

- [x] A rule that exactly one output is enabled at a time
- [ ] A resistor in series with each driver
- [ ] The clock, which separates the drivers in time
- [ ] Buffers that detect and back off from a conflict

@why The wire is just a wire. A bus is a discipline rather than a component,
and the correctness lives entirely in the rule about who may drive it.

## Inside a chip, a shared wire is usually built as:

- [x] A multiplexer, because wires are cheap and a short is fatal
- [ ] A tri-state bus, as on a board
- [ ] An open-drain wire with a pull-up
- [ ] A crossbar of transmission gates

@why There is nowhere for a second driver to connect, so there is no rule to
get wrong. Between chips on a board, where you cannot run one wire per source,
tri-state is the answer instead.

## In a bus transfer, the correct ordering is:

- [x] The source drives, the wire settles, the destination captures, then the
      source stops
- [ ] The destination captures, then the source drives
- [ ] Both happen on the same edge
- [ ] The order does not matter if the clock is slow enough

@why If the destination is still capturing when the source lets go, it captures
whatever the wire drifted to. The requirement comes before the mechanism.

## The shape of the two windows is:

- [x] A narrow capture window nested inside a wider driving window
- [ ] Two windows of equal width, offset by half a cycle
- [ ] A wide capture window inside a narrow driving window
- [ ] Two windows that do not overlap

@why Every bus transfer in every machine has that shape, and the usual
mechanism is two derived clocks, one nested inside the other.

## A clock cycle is best described as:

- [x] A contract about when signals are allowed to be garbage
- [ ] The time one instruction takes
- [ ] The rate at which gates switch
- [ ] A signal that steps the machine forward

@why Between edges every wire is free to be wrong. At the edge, everything
being captured must have settled. Choosing the length is choosing how much
wrongness you are willing to wait out.

## The clock period must exceed:

- [x] The longest path from any flip-flop output, through logic, to any
      flip-flop input
- [ ] The delay of the slowest single gate
- [ ] The time the slowest instruction takes
- [ ] The propagation delay across the whole chip

@why Part III has a tool that measures exactly that path and refuses to sign
off a design whose clock is too fast for it.

## Why does every operation cost the same in a simple machine?

- [x] They all wait for the same edge, so they all cost what the slowest path
      costs
- [ ] Because the instruction set is designed that way
- [ ] Because memory access dominates
- [ ] They do not; simple machines have variable-length instructions

@why Adding a faster operation buys nothing unless the slow path gets shorter
too, which is why making a machine faster means attacking that path.

## Pipelining makes a machine faster by:

- [x] Cutting the longest path into shorter pieces with flip-flops between them
- [ ] Making each operation do less work
- [ ] Running several clocks at once
- [ ] Executing instructions out of order

@why It does not make the work smaller. It shortens the path that sets the
clock, which is a different thing and the reason it works at all.

## What is an oscillator, structurally?

- [x] A circuit with no stable state, such as an odd number of inversions in a
      loop
- [ ] A circuit with two stable states
- [ ] A counter driven by a crystal
- [ ] An amplifier with positive feedback and a filter

@why Two stable states describes a latch. One stable state describes a
one-shot. A ring of an odd number of inverters never agrees with itself, and
that is the cheapest clock there is.

## Why is a ring oscillator built deliberately onto real chips?

- [x] Its frequency reveals how fast that particular silicon turned out
- [ ] It is the main system clock
- [ ] It generates a reset pulse at power-on
- [ ] It is a manufacturing artefact rather than a choice

@why A circuit whose whole purpose is to be unstable used as a ruler. The
system clock comes from a crystal, because a ring drifts with temperature and
process.

## Why does a pushbutton need a one-shot between it and the logic?

- [x] The contacts bounce for milliseconds, giving a burst of edges per press
- [ ] The voltage is too low without one
- [ ] To convert the level into an edge
- [ ] To protect the logic from static

@why A processor stepped directly by a button would run several instructions
per press and look haunted. Every physical button attached to logic has
something doing that job.

## A design that guarantees one enable by construction beats one that promises it because:

- [x] The guarantee cannot be violated by a later change, where a promise can
- [ ] It uses fewer gates
- [ ] It is faster
- [ ] Promises are not checkable

@why Priority logic makes the bad state unreachable rather than merely
forbidden. Every arbiter and interrupt controller is that shape with more
inputs.
