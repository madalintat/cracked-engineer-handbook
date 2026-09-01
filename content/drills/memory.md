## A memory is built from which three parts you already had?

- [x] A decoder, a row of registers, and a multiplexer
- [ ] A counter, an adder, and a register
- [ ] A latch array and an address comparator
- [ ] A decoder and a set of tri-state buffers only

@why Plus one AND per row to gate the write. There is no fourth idea in this
unit.

## In a memory, the write signal reaches a register:

- [x] ANDed with that register's own line from the decoder
- [ ] Directly, with the decoder selecting the output only
- [ ] Through a comparator against the address
- [ ] Only when the address changes

@why Exactly one decoder line is high, so exactly one register loads and the
rest hold. Leaving the write ungated writes to every register at once.

## Where is an address stored?

- [x] Nowhere. It is wires into a decoder and into a multiplexer
- [ ] In a tag field alongside each location
- [ ] In a lookup table in the memory controller
- [ ] In the first word of each block

@why No register knows its own number. The number identifies a location only in
the sense that it is the number that lights that location's line.

## Reading location 0 compared to location 1000, in this unit's memory:

- [x] Costs exactly the same
- [ ] Is faster, because the address is smaller
- [ ] Is slower, because the decoder starts at zero
- [ ] Depends on what was read last

@why The same wires carry a different pattern into the same gates. That stops
being true the moment there is a cache, and Part V is largely about it stopping.

## Why are real memories built as trees rather than one flat decode?

- [x] A wide flat decoder is an impossible fan-in and a wide flat multiplexer
      is a long chain
- [ ] Trees use less power
- [ ] Flat decoding cannot address more than 256 locations
- [ ] Trees allow several accesses at once

@why Split the address: high bits choose a block, low bits choose within it.
Depth then grows with the logarithm of the size rather than the size.

## What turns a counter into a program counter?

- [x] A second input path, so it can be loaded from outside instead of
      incremented
- [ ] A wider register
- [ ] A connection to the instruction decoder
- [ ] A reset input

@why The increment path means "carry on" and the load path means "go somewhere
else". A jump is not a mechanism, it is that load input.

## Why does a jump cost the same as not jumping in a simple machine?

- [x] Both are one edge into the same register, with a multiplexer choosing the
      value
- [ ] Because jumps are predicted
- [ ] Because the pipeline is flushed either way
- [ ] It does not; jumps are always slower

@why That stops being true once there is a pipeline, which is Part V, and the
reason it stops is worth knowing precisely because it is free here.

## A conditional jump needs:

- [x] The same load, with its enable ANDed with a flag
- [ ] Dedicated branch hardware
- [ ] A comparison unit
- [ ] A second program counter

@why Two more wires. The flags they read are the leftovers of an arithmetic
operation that already happened.

## If a location is read and written in the same cycle, the read returns:

- [x] The old value, because every register shows what it held coming into the
      cycle
- [ ] The new value
- [ ] Whichever happened first
- [ ] An undefined value

@why That is not a quirk to work around. It is what lets a value be read,
passed through an adder and written back to the same place in one cycle.

## What does static memory store a bit in?

- [x] A feedback loop of transistors, which holds while the power is on
- [ ] A capacitor
- [ ] A magnetic domain
- [ ] A floating gate

@why Several transistors per bit, which is why a processor has kilobytes of it
rather than gigabytes.

## Why must dynamic memory be refreshed?

- [x] Its bit is a charge on a capacitor, and a capacitor leaks
- [ ] The clock drifts
- [ ] Reading it is destructive and must be undone
- [ ] The addresses need periodic remapping

@why Leakage is the same phenomenon from unit 001 arriving somewhere else. The
memory reads and writes back its own contents continuously, forever, just to
keep saying the same thing.

## One bit of dynamic memory costs roughly:

- [x] One transistor and one capacitor
- [ ] Two transistors
- [ ] Six transistors
- [ ] One transistor and one resistor

@why Which is why you can have gigabytes of it. Static memory is a dozen
transistors a bit and correspondingly faster and more expensive.

## A stack in hardware is:

- [x] A memory and a register holding a number, plus an agreement about what
      the number means
- [ ] A dedicated last-in-first-out structure
- [ ] A special addressing mode
- [ ] A region the processor protects

@why Nothing enforces what the number points to, which is where a whole
category of security problem later comes from.

## What does a linked list look like to the hardware?

- [x] Some bits in some locations, with an agreement about what they mean
- [ ] A structure the memory controller follows
- [ ] A sequence of addresses in a special format
- [ ] Nothing; lists are a language feature

@why Nothing in memory knows about lists, and nothing in memory knows about
anything. That is the same answer as every other "how does it know" in this
part.

## Popping from an empty stack, in this unit's stack pointer:

- [x] Wraps around, because nothing is checking the range
- [ ] Raises an error
- [ ] Holds at zero
- [ ] Is prevented by the hardware

@why Going down from 0 wraps to the top the same way going up from the top
wraps to 0. Every check that a real machine has is something added on top, and
each one had to be paid for.
