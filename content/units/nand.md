---
needs: [cmos-gate]
minutes: 45
one_idea: Every Boolean function is one repeated part. There is no second kind of magic further up.
sources: [nand2tetris-eater-scott, transistors-cmos-fabrication]
---

You have four transistors. Wired as two networks that are duals of each other,
they make a part with two inputs and one output, and that part has one job: its
output is low only when both inputs are high. Every other combination gives you
a high output.

That is a [[nand]] gate. It is the smallest useful thing CMOS hands you for free,
and this unit makes a claim that should sound absurd the first time you read it.

Given enough NAND gates and wire, you can build every Boolean function that
exists. Not most of them. All of them. Including the ones nobody has thought of
yet.

## What a gate actually is

Forget schematics for a moment. A gate is a function from bits to bits, and a
two-input gate has a domain of exactly four points. You can write the whole
function down:

```
 a  b  | NAND
-------+------
 0  0  |  1
 0  1  |  1
 1  0  |  1
 1  1  |  0
```

That [[truth-table]] is the complete specification. There is nothing else to know about a
NAND gate. If you build something whose table matches, you have built a NAND
gate, whether you did it with transistors, relays, water valves, or dominoes.

This matters more than it looks. Once behaviour is a table, checking becomes
mechanical. A two-input function has 4 rows, so there are 2^4 = 16 possible
two-input functions, and you can enumerate all of them. AND, OR, XOR and NAND
are four of the sixteen. The other twelve have no famous names and are no less
real.

## The claim, and why it is true

A set of gates is **[[functional-completeness|functionally complete]]** if you can build every Boolean
function from copies of it. The claim is that {NAND} on its own is functionally
complete.

The proof is short and you can hold all of it in your head at once. Any Boolean
function can be written in terms of NOT, AND and OR: write out its truth table,
take every row that outputs 1, AND the inputs together in the right polarity,
then OR those terms. That is sum of products, and it always works because the
table is finite. So if NAND can make NOT, AND and OR, it can make everything.

**NOT.** Feed the same signal to both inputs. When `a` is 0, `NAND(0,0)` is 1.
When `a` is 1, `NAND(1,1)` is 0. That is inversion, from one gate.

```
a --+
    |>o-- NOT a
a --+
```

**AND.** NAND is AND followed by an inversion, so invert it back. Two gates.

```
a --|>o--+
b --|    |>o-- a AND b
```

**OR.** This is the one that surprises people. De Morgan says
`a OR b == NOT(NOT a AND NOT b)`. Invert both inputs, then NAND them. Three
gates.

That is the whole proof. Three constructions, six gates total, and every
Boolean function is now reachable.

It is worth pausing on how weak the assumption is. Nothing in that argument
said anything about electricity. It used only two facts: that a NAND gate
computes the table above, and that you can connect the output of one to the
input of another. Any physical system with those two properties computes
everything a computer computes. People have built working logic gates from
dominoes, from water in pipes, from crabs, and from a cellular automaton with
four rules. They are all slow and they all work, because the argument above does
not care what the gates are made of.

What silicon buys is not capability. It is speed and density, which is a
difference of about fifteen orders of magnitude, and that difference is the only
reason the machine on your desk is useful rather than a curiosity.

## Why this is a fact about physics, not about mathematics

Here is the part most treatments skip, and it is the reason this course starts
here rather than at AND.

NOR is also functionally complete. So is the pair {AND, NOT}. So is {OR, NOT}.
Mathematically there is nothing special about NAND at all. If completeness were
the only criterion, the choice would be arbitrary and you could start anywhere.

The tiebreaker is silicon. In CMOS, a gate is a pull-up network of PMOS
transistors and a pull-down network of NMOS transistors, and those networks are
duals. Series in one is parallel in the other. Work through what that gives you
and the answer is that **inversion is free and non-inversion costs a stage**:

| gate | transistors |
|---|---|
| NOT | 2 |
| NAND | 4 |
| NOR | 4 |
| AND | 6 |
| OR | 6 |

AND is not a primitive. AND is a NAND with an inverter bolted on, and it is
both larger and slower than the NAND inside it. The same is true of OR. Every
textbook that opens with AND and OR because they are easier to say out loud has
quietly started one storey above the ground floor.

So the reason to start at NAND is not that it is elegant. It is that the physics
hands it to you and charges extra for the alternatives.

```figure
{
  "kind": "gates",
  "alt": "Exclusive or built from four NAND gates, where the output of the first NAND feeds both of the middle two gates.",
  "caption": "XOR in four NANDs. The saving is the wire from n1 into both middle gates: computed once, used twice. The five-gate version inverts each input separately and does that work twice.",
  "nodes": [
    { "id": "a",  "type": "in",   "x": 0, "y": 0, "label": "a" },
    { "id": "b",  "type": "in",   "x": 0, "y": 2, "label": "b" },
    { "id": "n1", "type": "nand", "x": 1, "y": 1, "label": "n1" },
    { "id": "n2", "type": "nand", "x": 2, "y": 0, "label": "n2" },
    { "id": "n3", "type": "nand", "x": 2, "y": 2, "label": "n3" },
    { "id": "n4", "type": "nand", "x": 3, "y": 1, "label": "n4" },
    { "id": "out","type": "out",  "x": 4, "y": 1, "label": "out" }
  ],
  "wires": [
    { "from": "a",  "to": "n1" },
    { "from": "b",  "to": "n1" },
    { "from": "a",  "to": "n2" },
    { "from": "n1", "to": "n2", "label": "shared" },
    { "from": "n1", "to": "n3" },
    { "from": "b",  "to": "n3" },
    { "from": "n2", "to": "n4" },
    { "from": "n3", "to": "n4" },
    { "from": "n4", "to": "out" }
  ]
}
```

## Counting, and why your XOR is probably not minimal

Once you can build anything, the interesting question stops being *can I* and
becomes *how few*. Build XOR from NAND and the obvious route is to write the sum
of products and translate it gate by gate. That works and it costs five or six
gates.

The minimal XOR is four:

```
        +--------+
a --+---|        |
    |   | NAND 1 |--+--+
b --|---|        |  |  |
    |   +--------+  |  |
    |               |  |
    |   +--------+  |  |
a --+---| NAND 2 |--+  |     NAND 2 = NAND(a, out1)
        +--------+     |     NAND 3 = NAND(b, out1)
                       |     NAND 4 = NAND(out2, out3)
    |   +--------+     |
b --+---| NAND 3 |-----+
        +--------+
```

Whether you find four or six, both are correct. The difference is area and
propagation delay, and on a chip with billions of gates that difference is the
whole game. Correctness and efficiency are separate questions, and this course
keeps them separate: the exercises check that your table matches, and they
report your gate count beside a known minimum without failing you for missing
it.

## What you may not do yet

One rule governs every exercise in this unit, and it will be enforced.

**No cycles.** The output of a gate may not, through any path, feed back into
its own input. Not directly, not through nine other gates.

The reason is that nothing in this unit has a clock. A [[combinational]] circuit is
one where the outputs are a pure function of the inputs, and a cycle destroys
that property: the value depends on what it was a moment ago, which means it
depends on time, which means it is no longer a function of the inputs alone. A
cycle here is not a clever trick. It is a circuit whose behaviour the simulator
cannot define.

That restriction lifts in a few units, and the moment it lifts is the moment you
get memory. Feedback is exactly what makes a bit stay. But it needs a clock
first, and you do not have one yet.

## The shape of everything above

It is worth being explicit about what has just been established, because the
rest of this part leans on it constantly.

Selection is built from these gates. Addressing is built from selection.
Arithmetic is built from these gates. Registers are built from these gates plus
a clock. The instruction decoder that makes a CPU a CPU is a lookup table, and a
lookup table is built from these gates.

There is no point further up the stack where a second kind of primitive gets
introduced. No secret ingredient arrives at the CPU level. When you finish Part
II and have a machine that runs a program you wrote, every part of it will be
this one component, repeated, with wire between the copies.

That is the sentence worth carrying out of this unit. A computer is not a pile
of clever mechanisms. It is one stupid mechanism, arranged carefully, an
enormous number of times.

## Reading the errors you are about to see

The checker for these exercises is a simulator running in your browser, and it
reports four kinds of problem. Each one means something specific.

**A truth table mismatch** gives you the exact input row where your circuit
disagreed with the specification, and both values. This is the ordinary failure
and the easiest to fix: the row tells you which case you did not think about.

**A non-NAND part** means you referenced a gate you have not built. The checker
walks your netlist to its leaves and the only leaf allowed is `nand`. Using a
built-in XOR to build XOR is not an answer.

**A combinational cycle** prints the loop it found, gate by gate, so you can see
which wire closed it.

**A [[floating]] input** means a gate input was never connected. An unconnected wire
is not 0. It has no value, and a simulator that quietly treated it as 0 would let
you ship a design that fails on real silicon. This one is the most valuable error
in the set, because it is the one that would otherwise find you much later.
