## Why did the simulator reject a loop before this unit?

- [x] With no clock, a value that depends on its own present value is not a
      function of the inputs
- [ ] Loops always oscillate in real hardware
- [ ] The simulator cannot represent them
- [ ] Loops are legal but slow

@why The circuit is not wrong so much as incomplete. What it is missing is a way
to say when, and that is the whole subject of this unit.

## What is the rule for a D flip-flop?

- [x] Its output this cycle is its input from the previous cycle
- [ ] Its output follows its input while the clock is high
- [ ] It stores whichever input was last to change
- [ ] It inverts its input once per cycle

@why That single rule is all a flip-flop is here. Following the input while the
enable is high describes a latch, which is a different part with a different
failure mode.

## Why is the flip-flop taken as an axiom rather than built from NAND?

- [x] It is a pedagogical choice: real ones are built from gates with feedback,
      and what matters here is what having one lets you build
- [ ] It cannot be built from NAND
- [ ] It needs analogue behaviour
- [ ] It is built into the simulator for speed

@why nand2tetris says so plainly, and this handbook does the same. Part III
builds one properly from the standard cells a synthesiser actually uses.

## Why is a flip-flop with its output tied to its input an invalid design?

- [x] It holds a value and there is no way to ever load a different one
- [ ] It oscillates
- [ ] The output fights the input
- [ ] It works, but only for one cycle

@why nand2tetris labels that figure "invalid design" for exactly this reason,
and it is the most valuable diagram in the book.

## What makes a register out of a flip-flop?

- [x] A multiplexer in the loop, whose select input is the load signal
- [ ] A second flip-flop
- [ ] An enable input on the flip-flop itself
- [ ] A latch in front of it

@why There is no separate loading mechanism anywhere in any machine. There is a
multiplexer in a loop, and its select bit is what `load` means.

## What is a clock?

- [x] A time unit, saying when results are allowed to be believed
- [ ] The thing that makes the computer run
- [ ] A signal that triggers each gate in turn
- [ ] A counter of instructions

@why Everything is computing continuously whether or not a clock runs. The
clock decides when it has settled enough to be trusted.

## Does a faster clock make the logic faster?

- [x] No. The cycle must be long enough for the slowest path, so every
      operation takes as long as the worst one
- [ ] Yes, gates switch faster at higher clock rates
- [ ] Yes, but only for sequential logic
- [ ] Only if the supply voltage rises with it

@why If anything the clock makes things slower, because a fast operation still
waits for the boundary. Choosing the period is choosing how much settling you
are willing to wait out.

## Halfway through a cycle, an adder's output is:

- [x] Allowed to be garbage, and usually is while the carry ripples
- [ ] Guaranteed correct
- [ ] Held at its previous value
- [ ] Undefined only if the inputs changed

@why The design is correct if it has settled by the cycle boundary, and what
happened before that does not matter. A clock cycle is a contract about when
signals are allowed to be wrong.

## In a chain of flip-flops, what does the second one capture at the edge?

- [x] What the first one held before the edge
- [ ] What the first one becomes after the edge
- [ ] Whichever arrives first
- [ ] It depends on propagation delay

@why Every flop reads old values and writes new ones, and nothing can observe
the intermediate state. That is why a chain shifts rather than collapsing to one
value.

## What language feature exists to model that reading-before-writing?

- [x] Non-blocking assignment in Verilog
- [ ] The sensitivity list
- [ ] The reset clause
- [ ] Continuous assignment

@why Getting it wrong is the most common bug in hardware description
languages, and Part III meets it as a language problem after you have met it
here as a circuit property.

## How does a latch differ from a flip-flop?

- [x] A latch is transparent while its enable is high; a flip-flop samples at
      one instant
- [ ] A latch stores two bits
- [ ] A latch cannot be reset
- [ ] There is no difference in behaviour, only in size

@why Put a latch in a loop with its enable high and the value races round as
fast as the gates allow, many times within one pulse, and where it stops depends
on propagation delays.

## How is edge triggering actually built?

- [x] Two latches in series with opposite enables, so no path is ever open all
      the way through
- [ ] A very short enable pulse
- [ ] A comparator on the clock
- [ ] An inverter chain that delays the enable

@why That arrangement is called master-slave. While the first is open the
second is closed, which is what turns a level into an edge.

## A counter is:

- [x] An increment wired to a register
- [ ] A special counting circuit
- [ ] A shift register with feedback
- [ ] A chain of toggles with no register

@why Counting is not a new mechanism. You built the increment last unit and the
register this unit, and the counter is those two connected.

## Reset on a counter is implemented as:

- [x] A multiplexer in front of the register, choosing zero over the computed
      next value
- [ ] A special input on the flip-flop
- [ ] Clearing the clock
- [ ] A separate reset instruction

@why And it takes priority by being the last choice made before the value is
stored. That is why a processor has a reset pin rather than a reset
instruction: at power-on there is no instruction to run yet.

## After `rst` is asserted for one cycle, the output returns to zero:

- [x] On the following cycle, like every other stored value
- [ ] Immediately, within the same cycle
- [ ] After two cycles
- [ ] Only once `en` is also low

@why Reset acts on what gets stored, and stored values appear one cycle later.
Everything sequential in this unit has that same delay, and expecting otherwise
is the most common way to misread a trace.
