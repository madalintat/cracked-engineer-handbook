## What does the pull-up network of a static CMOS gate consist of?

- [x] PMOS transistors, between the supply and the output
- [ ] NMOS transistors, between the supply and the output
- [ ] A resistor to the supply
- [ ] Whichever flavour gives the fewest transistors

@why Each network is built from the flavour that delivers its level cleanly.
PMOS carries a high, NMOS carries a low, and the reverse arrangement cannot
finish the job.

## For every input combination, how many of the two networks must conduct?

- [x] Exactly one
- [ ] At least one
- [ ] At most one
- [ ] It depends on the gate

@why Both is a direct path from supply to ground through the gate. Neither
leaves the output holding whatever charge is on the wire, drifting under
leakage. Exactly one is the whole discipline.

## Series in the pull-down network corresponds to what in the pull-up?

- [x] Parallel
- [ ] Series
- [ ] It depends on the function
- [ ] Nothing; the networks are designed independently

@why The two networks are complements, so the structures exchange. You already
know this as De Morgan's law. Here it is not an identity, it is an instruction
about where to put wires.

## How many transistors is an inverter?

- [x] 2
- [ ] 4
- [ ] 1
- [ ] 6

@why One of each flavour, gates tied together, drains tied together. It is the
cheapest possible logic gate, and the fact that the cheapest gate inverts is the
subject of the unit.

## Why can you not build AND directly as one static CMOS gate?

- [ ] The truth table has too many rows
- [x] It would need a pull-up that conducts when its inputs are high, and PMOS
      turns on when its gate is low
- [ ] AND needs three inputs
- [ ] You can, but it is slower

@why A pull-up made of PMOS conducts on low inputs, so any gate built this way
inverts. There is no arrangement in the standard configuration that comes out
non-inverting.

## A two-input NAND and a two-input AND cost how many transistors?

- [x] 4 and 6
- [ ] 4 and 4
- [ ] 6 and 4
- [ ] 2 and 4

@why AND is NAND with an inverter on the end: fifty per cent more transistors
and twice the delay. In silicon NAND is the primitive and AND is derived, which
is the reverse of the Boolean algebra ordering.

## Relative to the silicon, the textbook ordering that treats AND and OR as fundamental is:

- [ ] Correct, and NAND is a convenient compound
- [x] Backwards, because the inverting gates are the cheap ones
- [ ] Irrelevant, since all gates cost the same
- [ ] Correct for CMOS and backwards for other technologies

@why Universality alone does not choose NAND over NOR, because both are
universal. Cheapness does, and cheapness is a fact about the fabrication
technology rather than about logic.

## Why is a NOR gate worse than a NAND gate with the same input count?

- [ ] It needs more transistors
- [x] Its series stack is made of the slower flavour, which must also be wider
- [ ] It has more gate delays
- [ ] Its truth table is larger

@why Both are four transistors and one stage. NAND puts its NMOS in series and
NOR puts its PMOS in series, and PMOS is both slower and wider, so a NOR stack
costs twice on both counts.

## What is bubble pushing?

- [x] Moving an inversion across a De Morgan boundary, which can delete
      transistors and a gate delay
- [ ] Removing bubbles from a schematic to make it readable
- [ ] Adding inverters to balance path delays
- [ ] A layout technique for reducing capacitance

@why Rewriting `NOT(a) OR NOT(b)` as `NOT(a AND b)` takes ten transistors down
to four. A synthesis tool does this thousands of times in a design, which is why
a netlist looks nothing like the source.

## Why does a real netlist contain far more NANDs and NORs than the source mentioned?

- [x] Synthesis rewrites logic into whatever the cell library makes cheap, and
      the inverting gates are the cheap ones
- [ ] The synthesiser cannot represent AND
- [ ] NAND simulates faster
- [ ] It is an artefact of the file format

@why It is the same fact seen from the tool's side. A designer needing four
inputs ANDed builds a tree of NANDs and NORs whose inversions cancel, and the
tool does the same thing automatically.

## `NOT((a AND b) OR c)` built as a single CMOS gate costs how many transistors?

- [x] 6
- [ ] 14
- [ ] 8
- [ ] 4

@why Three literals means three in the pull-down and three in the pull-up. Built
from discrete AND, OR and NOT gates the same function costs fourteen and three
gate delays instead of one.

## Why do gates have a maximum fan-in of about four?

- [x] Each transistor in a series stack adds resistance, so deeper stacks get
      too slow
- [ ] The pull-up network runs out of supply voltage
- [ ] Layout rules forbid more
- [ ] Simulation time grows too quickly

@why It is why an eight-input NAND is not one gate but a tree of smaller ones,
and why the fan-in limit shows up as a shape in synthesised logic.

## What problem does a transmission gate solve?

- [ ] It amplifies a weak signal
- [x] It passes a full-swing level in either direction, which neither flavour
      can do alone
- [ ] It reduces leakage
- [ ] It provides isolation between clock domains

@why One NMOS passes a weak high and one PMOS passes a weak low. In parallel
with complementary gate signals, each covers the other's weakness.

## A two-way multiplexer costs roughly how many transistors, built each way?

- [x] Six from transmission gates, fourteen from NAND gates
- [ ] Six either way
- [ ] Fourteen from transmission gates, six from NAND gates
- [ ] Four from transmission gates, eight from NAND gates

@why Both are correct designs and only one is what goes on a chip. Part II
builds the gate version, which is the right thing to build while learning that
one primitive reaches everything.

## Once a static CMOS gate has settled, what current flows through it?

- [x] Only leakage, because exactly one network conducts and it connects the
      output to one rail
- [ ] A steady current set by the pull-up resistance
- [ ] None at all
- [ ] Current proportional to the clock frequency

@why This is why CMOS displaced everything before it. The cost is the
transition, which is the switching energy from the last unit, plus the leakage
that the last unit also warned about.
