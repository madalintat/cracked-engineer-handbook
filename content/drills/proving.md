## What caused the 1994 Pentium divide bug?

- [x] Five entries of a generated lookup table were never written
- [ ] A carry chain that was one bit too short
- [ ] A rounding mode applied in the wrong order
- [ ] A race between two clock domains

@why The table had 1066 entries and the tool that generated it had a bug nobody
looked for, because the table was generated rather than typed. Intel took a
charge of 475 million dollars.

## How many input combinations does a 32-bit adder have?

- [x] About 18 quintillion, which is 584 years at a billion per second
- [ ] About 4 billion, one per value of the result
- [ ] 1024, one per pair of bit positions
- [ ] It depends on the carry chain depth

@why Two operands of 32 bits each is 2^64. There is no schedule in which you
enumerate them, which is why every test you write is a sample.

## What is a miter?

- [x] Your design and a reference sharing inputs, with their outputs feeding a comparator
- [ ] A testbench that drives random stimulus into both designs
- [ ] The intermediate netlist a synthesiser produces before optimisation
- [ ] A constraint file describing which paths may be slow

@why It is an ordinary circuit of ordinary gates, and equivalence checking is
that picture plus a solver answering one question about it.

## What question does the solver ask about the miter?

- [x] Is there any assignment of the inputs that makes its output 1
- [ ] What fraction of inputs make its output 1
- [ ] How long does its longest path take to settle
- [ ] Which input has the greatest influence on the output

@why If the answer is no, the two designs agree on every input and you have
tried none of them. If it is yes, the tool hands you the assignment, which is a
failing test case you did not have to think of.

## Boolean satisfiability is NP-complete. Why is equivalence checking practical anyway?

- [x] Real circuits have structure, and solvers that learn from conflicts exploit it
- [ ] Hardware problems are a special case that is provably polynomial
- [ ] Solvers approximate, accepting a small chance of a wrong answer
- [ ] The miter is always small enough for exhaustive search

@why The gap between the worst case and the ordinary case is enormous. The
practical rule is to try it and find out, and the failure mode is that the
solver runs out of time rather than that it answers wrongly.

## Why does adding a flip-flop break the simple equivalence argument?

- [x] The output depends on state, and state depends on an unbounded history
- [ ] Flip-flops are not representable as Boolean gates
- [ ] The solver cannot handle a clock signal
- [ ] The miter would need two clock domains

@why Two sequential designs are equivalent if they agree on every possible input
sequence, and there are infinitely many. You cannot enumerate them and this time
you cannot even bound them.

## How is sequential equivalence proved instead?

- [x] By induction: agree at reset, and agreement survives one edge
- [ ] By simulating for the longest sequence anyone expects
- [ ] By unrolling the design to a fixed depth and checking that
- [ ] By comparing the state encodings directly

@why Those two facts together cover every sequence of any length. Yosys spells
it as `equiv_simple` for the combinational parts and `equiv_induct` across the
flops.

## Why can an inductive step fail on a design that is actually correct?

- [x] The argument allows starting from any state, including unreachable ones
- [ ] Induction cannot handle designs with more than one clock
- [ ] The solver times out before reaching the base case
- [ ] Reset values are not visible to the prover

@why The repair is to strengthen the claim with an invariant about which states
are reachable, and that is where formal verification stops being push-button.

## You proved your adder equals `a + b`. What have you proved?

- [x] That your adder equals `a + b`, which is right only if the specification wanted that
- [ ] That your adder is correct
- [ ] That your adder is correct for all inputs the tests covered
- [ ] That your adder matches the synthesised netlist

@why If the specification wanted saturating arithmetic and the reference wraps,
the proof is valid and the chip is wrong. Equivalence checking moves the hard
question from your implementation to your reference.

## What makes a stated property safer than a reference model?

- [x] It has no second implementation, so one misunderstanding cannot be made twice
- [ ] It is checked exhaustively while a reference model is sampled
- [ ] It runs faster in the solver
- [ ] It does not require the design to be synthesisable

@why "Exactly one output is high" has nothing in it to be wrong in the same way
the design is wrong. A reference decoder written by the same person on the same
afternoon can easily repeat the mistake.

## How do the exercises here express a property?

- [x] The design computes the claim as an output, and the reference is the constant 1
- [ ] With an `assert property` statement the checker extracts
- [ ] With a coverage file listing the cases to hit
- [ ] By comparing against a reference model of the property

@why It is the same thing as a property checker with less machinery, and it
reuses the equivalence flow that is already there.

## Which class of bug has essentially stopped reaching silicon since 1994?

- [x] The synthesis tool introducing a difference from the source description
- [ ] Arithmetic errors in divide units
- [ ] Deadlock in bus arbiters
- [ ] Timing violations on the critical path

@why Every serious chip now checks equivalence between the register transfer
description and the gate netlist, again after timing changes, and again after
clock and test logic are inserted.

## Where is property checking usually spent?

- [x] Where a bug is expensive: arithmetic units, cache coherence, bus arbiters
- [ ] Uniformly across the whole design
- [ ] On the input and output pads
- [ ] On the clock tree

@why Writing good properties is real work, and the state spaces that resist
induction are the interesting ones, so it goes where a protocol or an algorithm
makes a mistake costly.

## What is the standard practice the Pentium bug specifically produced?

- [x] A generated table is verified against the algorithm meant to generate it
- [ ] Divide units are implemented without lookup tables
- [ ] Every table entry is written by hand and reviewed
- [ ] Floating point is tested against a software reference at runtime

@why The table was trusted because a program produced it, and that is the
assumption that turned out to be the bug.

## A design is proved equal to its reference. What is still unknown?

- [x] Whether its gates settle fast enough to be clocked at the intended rate
- [ ] Whether it computes the same thing on every input
- [ ] Whether the reference and the design use the same encoding
- [ ] Whether the netlist matches the source description

@why A proof says nothing about how long the gates take. That is the next unit,
and it is where a design stops being a function and becomes a physical object
with a deadline.
