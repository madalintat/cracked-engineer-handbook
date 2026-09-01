## A NAND gate outputs 0 in how many of its four input combinations?

- [ ] None of them
- [x] Exactly one
- [ ] Exactly two
- [ ] All four

@why Only the row where both inputs are 1. Every other combination gives 1,
which is what makes NAND the inverted form of AND rather than a rearrangement
of it.

## You have NAND gates and wire. Which Boolean functions can you build?

- [ ] Only the ones that can be written without XOR
- [ ] Only functions of at most three inputs
- [x] Every Boolean function there is
- [ ] Every function except those needing feedback

@why Functional completeness. Any function can be written in terms of NOT, AND
and OR by taking its truth table as a sum of products, and NAND builds all
three. The last option confuses combinational logic with sequential: feedback
is a different question, and it needs a clock.

## How many NAND gates does inversion cost?

- [x] One
- [ ] Two
- [ ] Three
- [ ] It cannot be done with NAND alone

@why Tie both inputs to the same wire. Then only the two rows where the inputs
agree are reachable, and on those rows NAND is exactly inversion.

## Building OR from NAND takes three gates. Why three rather than one?

- [ ] OR needs more inputs than NAND provides
- [x] De Morgan turns OR into a NAND of two inverted inputs, so both inputs
      must be inverted first
- [ ] The third gate buffers the output to restore the voltage
- [ ] Two of the three are needed to avoid a race

@why `a OR b` is `NOT(NOT a AND NOT b)`. Each inversion is one gate and the
final NAND is the third. The buffering answer describes a real concern on
silicon but it is not why the count is three here.

## In CMOS, how many transistors does a NAND gate use?

- [ ] Two
- [x] Four
- [ ] Six
- [ ] Eight

@why Two networks that are duals of each other: two PMOS and two NMOS.
Inversion alone is two transistors, and AND is six because it is a NAND
followed by an inverter.

## Which costs more transistors in CMOS, AND or NAND?

- [x] AND, because it is a NAND with an inverter added
- [ ] NAND, because inverting is extra work
- [ ] They are the same, since they compute related functions
- [ ] It depends on the process node

@why Six against four, and AND is also slower because the signal passes through
an extra stage. Inversion is free in CMOS and non-inversion costs a stage,
which is why this course starts at NAND rather than at the gate with the
friendlier name.

## NOR is also functionally complete. So why does this course start at NAND?

- [ ] NOR cannot build XOR without more gates than NAND
- [ ] NAND is the only gate that is functionally complete on its own
- [x] Nothing mathematical. CMOS makes NAND cheap, and the choice is a fact
      about silicon rather than about logic
- [ ] NOR is harder to reason about in a truth table

@why Both are complete and the choice between them is not a theorem. NAND and
NOR are both four transistors, but NOR puts its PMOS devices in series, and
holes move more slowly than electrons, so NOR is the slower of the two.

## How many distinct Boolean functions of two inputs exist?

- [ ] Four
- [ ] Eight
- [x] Sixteen
- [ ] Infinitely many

@why A two-input truth table has four rows, and each row's output is
independently 0 or 1. Two to the power of four. AND, OR, XOR and NAND are four
of them; the other twelve are just as real and mostly have no names.

## What is the smallest number of NAND gates that computes XOR?

- [ ] Three
- [x] Four
- [ ] Five
- [ ] Six

@why The sum-of-products route gives five or six because it computes
`nand(a, b)` twice without noticing. Share that value and the count drops to
four.

## The checker reports your gate count beside a known minimum. Why does it not
fail you for exceeding it?

- [ ] Gate counts vary between simulators, so the number is unreliable
- [x] Correctness and efficiency are separate questions, and conflating them
      teaches the wrong lesson
- [ ] The minimum is only a guess
- [ ] Failing on it would make the exercises too hard

@why A circuit that computes the right function is correct whether it uses four
gates or six. Efficiency is a real and separate concern, so it is reported
rather than enforced, except where an exercise sets a budget on purpose.

## Why is a combinational cycle rejected in this part of the course?

- [ ] Cycles make the netlist ambiguous to parse
- [ ] Real hardware cannot physically contain a loop of wire
- [x] Without a clock, a value that depends on itself is a function of time
      rather than of the inputs
- [ ] Loops always oscillate and damage the simulator

@why A combinational circuit's outputs are a pure function of its inputs, and a
cycle destroys that. The restriction lifts once there is a clock, and feedback
is then exactly the mechanism that makes a bit stay put.

## A gate input is left unconnected. What should a simulator do?

- [ ] Read it as 0, which is what an unpowered wire settles to
- [ ] Read it as 1, so the error shows up as an obviously wrong output
- [x] Report it, because the wire has no value at all
- [ ] Pick a value at random to expose the dependency

@why An unconnected wire is undefined rather than low. A simulator that quietly
substituted 0 would let a design pass that behaves differently on real silicon,
and the bug would surface much later and much further from its cause.

## What does it mean that dominoes and water pipes can compute anything a
computer can?

- [ ] It is a curiosity with no bearing on real machines
- [x] The completeness argument depends only on the gate's truth table and on
      being able to connect gates, not on what the gates are made of
- [ ] Any physical process is inherently computational
- [ ] It shows silicon was an arbitrary choice among equals

@why The proof uses two facts and no physics. What silicon buys is speed and
density, which is a difference of roughly fifteen orders of magnitude, and that
difference is the only reason the machine on your desk is useful.

## Reading a NAND-only design, you find a part named `xor`. What has gone wrong?

- [ ] Nothing, as long as its truth table is correct
- [x] It is a gate that was not built from NAND, so the design assumes
      something the exercise is meant to establish
- [ ] `xor` is a reserved name in the netlist language
- [ ] XOR cannot be expressed in a netlist at all

@why The checker walks the design to its leaves and accepts only `nand`.
Building XOR out of a built-in XOR would leave the central claim untested,
which is the one thing this unit exists to demonstrate.

## Everything above the gate level in a computer is built from what?

- [ ] A small set of primitives that grows as the abstractions get higher
- [ ] Gates at the bottom, then dedicated arithmetic hardware, then a
      programmable core
- [x] The same one primitive, repeated, with wire between the copies
- [ ] Gates for logic and a separate mechanism for storage and control

@why Selection, arithmetic, memory and the instruction decoder are all built
from this component. Storage needs a clock added, not a new primitive, and the
decoder that makes a CPU a CPU is a lookup table made of the same gates.
