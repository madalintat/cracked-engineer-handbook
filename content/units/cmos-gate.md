---
needs: [switch]
minutes: 50
one_idea: A CMOS gate is structurally inverting, so inversion is free and non-inversion costs an extra stage.
sources: [transistors-cmos-fabrication]
---

The last unit ended with two facts about the transistor. One flavour carries a
low cleanly, the other carries a high cleanly. Put those together and there is
only one sensible way to build a gate, and it turns out to have a consequence
nobody would guess from a Boolean algebra textbook.

## Two networks and one rule

Every static CMOS gate is exactly two networks. A pull-up network of PMOS
transistors between the supply and the output, and a pull-down network of NMOS
transistors between the output and ground. Each is built from the flavour that
delivers the level it is responsible for, which is the only arrangement that
works.

The rule connecting them is the whole discipline:

**For every input combination, exactly one network conducts.**

Never both. Both conducting is a direct path from the supply to ground through
your gate, which is a short circuit that gets a name, crowbar current, and a
smell. Never neither, either: that leaves the output connected to nothing,
holding whatever charge happens to be on the wire, drifting toward whatever the
leakage from the last unit decides.

Exactly one. Which means the two networks are complements of each other, and
that has a precise wiring consequence: series in one is parallel in the other.
You have seen this rule before as a Boolean identity called De Morgan's law.
Here it is not an identity. It is an instruction about where to put wires.

## The cheapest gate there is

Two transistors. One of each flavour, gates tied together, drains tied together.

```figure
{
  "kind": "gates",
  "alt": "An inverter drawn as one gate with a single input and a bubbled output, standing for a PMOS pull-up above an NMOS pull-down.",
  "caption": "One PMOS above one NMOS. When the input is low the pull-up conducts and the output goes high; when the input is high the pull-down conducts and the output goes low. Two transistors, and the output is the opposite of the input.",
  "nodes": [
    { "id": "a",   "type": "in",  "x": 0, "y": 0, "label": "a" },
    { "id": "inv", "type": "not", "x": 1, "y": 0, "label": "" },
    { "id": "y",   "type": "out", "x": 2, "y": 0, "label": "y = NOT a" }
  ],
  "wires": [ { "from": "a", "to": "inv" }, { "from": "inv", "to": "y" } ]
}
```

Drive the input low and the PMOS conducts while the NMOS is off, so the output
is pulled to the supply. Drive it high and the reverse happens. Exactly one
network conducts in each case, as required, and once the output has settled
neither network is passing current at all. The only cost is the transition,
which is the `C·V²` from the last unit.

That is the cheapest possible logic gate, and it is an inverter. That is not a
coincidence, and the rest of this unit is about why.

## Counting NAND, and counting AND

For NAND the output should be low only when both inputs are high. Low means the
pull-down conducts, and "only when both" means the two NMOS transistors are in
series: current has to get through both, so both gates must be high.

The pull-up is then the complement, which by the series-parallel rule means two
PMOS transistors in parallel. Either one being on is enough to pull the output
high, and either one is on whenever its input is low. Four transistors, one
stage.

Now try to build AND the same way. The output should be high only when both
inputs are high. High means the pull-up conducts. So you would need a pull-up
network that conducts only when both inputs are high, which means PMOS
transistors that turn on when their gates are high.

There are none. PMOS turns on when its gate is low. That is what the device is.

```figure
{
  "kind": "strip",
  "alt": "A row comparing gate costs in transistors: inverter two, NAND four, NOR four, AND six, OR six, XOR eight or more.",
  "caption": "Transistor counts for the standard cells. The inverting gates are the cheap ones, and every non-inverting gate is an inverting gate with an inverter bolted on.",
  "cells": [
    { "label": "NOT 2",  "on": true,  "accent": "gold" },
    { "label": "NAND 4", "on": true,  "accent": "gold" },
    { "label": "NOR 4",  "on": true,  "accent": "copper" },
    { "label": "AND 6",  "on": false },
    { "label": "OR 6",   "on": false },
    { "label": "XOR 8+", "on": false }
  ]
}
```

So you build NAND and put an inverter on the end. Six transistors instead of
four, and two stages of delay instead of one.

## The sentence this handbook is built on

A static CMOS gate made from a PMOS pull-up and an NMOS pull-down is
structurally, unavoidably inverting. There is no arrangement of the two flavours
in this configuration that produces a non-inverting gate directly.

Read that again with the transistor in mind. The pull-down conducts when its
gate is high and drives the output low. The pull-up conducts when its gate is
low and drives the output high. Both of them invert. A network of them inverts.

So in silicon, NAND and NOR are primitives, and AND and OR are derived: 50% more
transistors and twice the delay. The Boolean algebra ordering, where AND and OR
are fundamental and NAND is a compound called not-and, is exactly backwards
relative to the material.

That is the engineering reason the next part builds everything from NAND, and it
is a better reason than the mathematical one. NAND is universal, and so is NOR,
so universality alone does not choose between them. Cheapness does.

## What this predicts

A claim is worth more when it predicts something you would otherwise find
strange, and this one predicts three things.

Real cell libraries are full of inverted-output gates, and a synthesised netlist
contains far more NANDs and NORs than the source ever mentioned. Moving an
inversion across a De Morgan boundary can delete two transistors and a gate
delay, which is a real optimisation with a real name, bubble pushing.

Real logic often looks inside out. Somebody who needs four inputs ANDed together
builds a tree of NANDs and NORs whose inversions cancel, rather than three ANDs
in a row.

And a control bit that inverts a result is nearly free. Adding an "invert the
output" input to a unit costs one XOR gate, where building both polarities and
selecting between them costs a great deal more. When you meet an arithmetic unit
with a negate-output control, that is why it is there.

## One gate can be more complicated than a gate

The duality does not stop at two inputs, and this is where a synthesised netlist
starts looking nothing like the expression you wrote.

Any function of the shape "not a sum of products" is one CMOS gate. Take
`NOT((a AND b) OR c)`. The pull-down conducts when `a` and `b` are both high or
when `c` is, which is two NMOS in series, that pair in parallel with a third.
Three NMOS. The pull-up is the dual: `a` and `b` in parallel, that pair in
series with `c`. Three PMOS.

Six transistors, and one gate delay. Building the same function from an AND, an
OR and an inverter costs fourteen transistors and three delays.

There is a limit, and it is the series stack. Every transistor in series adds
resistance, so a stack deeper than about four is too slow to be worth having.
That is why gates have a maximum fan-in of roughly four, and why an eight-input
NAND is not one gate: it is a tree of smaller ones.

## When you want a switch rather than a gate

One more arrangement, because you will meet the thing it builds in Part II and
the version built from NAND will look wasteful afterwards.

Sometimes what you want is not a gate driving a level but a switch that passes
whatever is on one side through to the other. A single NMOS cannot do it,
because of the weak high from the last unit, and a single PMOS has the mirror
problem. Put one of each in parallel, with complementary signals on their gates,
and each covers the other's weakness. That is a transmission gate: two
transistors, plus an inverter to make the complement if you do not already have
one.

A two-way multiplexer built this way is two transmission gates and an inverter,
about six transistors. The version Part II builds from NAND gates alone is
around fourteen. Both are correct. Only one of them is what anybody actually
puts on a chip, and it is worth knowing that while you build the other one.

## Why NOR is worse than NAND

They are both four transistors and one stage, so the table above makes them look
equivalent. They are not, and the reason is the second asymmetry from the last
unit.

In NAND, the series transistors are the NMOS ones and the parallel transistors
are the PMOS ones. In NOR it is the other way round: two PMOS in series.

PMOS is the slower flavour, and to get equal drive it has to be made wider. Two
of them in series means twice the resistance to overcome and twice the width to
pay for, so a NOR is slower and larger than a NAND with the same input count.
That is why standard-cell libraries lean on NAND, and why a synthesis tool
reaching for a default two-input gate reaches for that one.

## What to carry into the next part

Inversion is free and non-inversion costs a stage. Series in one network is
parallel in the other. And the gate that CMOS hands you for nothing is the one
with a bubble on it.

Part II takes that gate, treats it as the only thing you are allowed to use, and
builds arithmetic, memory and a processor out of it. When it asks you to build
AND from NAND and an inverter and notes that this costs two gates rather than
one, the count you are paying is the one in this unit.

## Reading the errors you are about to see

The exercises are the counting made executable: transistor counts, delays, and
the series-parallel duality, written in C. The point is not the arithmetic, it
is that the numbers come out the way the argument says they do.

A failure exits nonzero and prints what it wanted against what it got. Where an
exercise is about the duality, the check runs your function over every input
combination rather than a sample, because a network that is right on three of
four rows is a short circuit on the fourth.
