---
needs: [selection]
minutes: 50
one_idea: Subtraction is not a second circuit. It is addition with one control bit inverting an operand, and that is a fact about the representation rather than about the hardware.
sources: [nand2tetris-eater-scott, numbers-text-numerics]
---

Two units ago you had one gate. Last unit you built routing. This unit builds
arithmetic, and the interesting part is not that it works. It is how little it
costs, and that the saving comes from a decision about how to write numbers down
rather than from anything clever in the circuit.

## Adding one bit to one bit

Two bits added together give a result that can be 0, 1 or 2, and 2 does not fit
in one bit. So the answer needs two outputs: the low bit of the sum, and a carry
into the next position.

Write the table and read what the two columns are.

```
a  b  |  sum  carry
0  0  |   0     0
0  1  |   1     0
1  0  |   1     0
1  1  |   0     1
```

The sum column is 1 exactly when the inputs differ, which is exclusive or. The
carry column is 1 exactly when both are 1, which is and. Both of those are parts
you have already built, so a half adder is two parts and no new ideas.

It is called a half adder because it cannot take a carry in, and every position
except the first has one arriving from below.

## Adding three bits

A full adder takes two operand bits and a carry in, and produces a sum and a
carry out. Three inputs, and the answer counts how many of them are 1.

The construction is two half adders and an or. Add the two operands, then add
the carry to that result. Each of those additions can produce a carry, and at
most one of them can, so an or gathers them.

```figure
{
  "kind": "gates",
  "alt": "A full adder built from two half adders and an or gate, with the first half adder taking the two operands and the second adding the carry in.",
  "caption": "Two half adders and an or. The second one adds the incoming carry to the first one's sum, and the or gathers whichever carry occurred, because both cannot.",
  "nodes": [
    { "id": "a",   "type": "in",  "x": 0, "y": 0, "label": "a" },
    { "id": "b",   "type": "in",  "x": 0, "y": 1, "label": "b" },
    { "id": "cin", "type": "in",  "x": 0, "y": 3, "label": "cin" },
    { "id": "h1",  "type": "box", "x": 1, "y": 0, "label": "HA" },
    { "id": "h2",  "type": "box", "x": 2, "y": 2, "label": "HA" },
    { "id": "or",  "type": "or",  "x": 3, "y": 1, "label": "" },
    { "id": "s",   "type": "out", "x": 4, "y": 2, "label": "sum" },
    { "id": "co",  "type": "out", "x": 4, "y": 1, "label": "carry" }
  ],
  "wires": [
    { "from": "a", "to": "h1" },
    { "from": "b", "to": "h1" },
    { "from": "h1", "to": "h2", "label": "sum" },
    { "from": "cin", "to": "h2" },
    { "from": "h1", "to": "or", "label": "c1" },
    { "from": "h2", "to": "or" },
    { "from": "h2", "to": "s" },
    { "from": "or", "to": "co" }
  ]
}
```

Now chain them. The carry out of each position is the carry in of the next, and
a row of full adders adds numbers of any width. That arrangement has a name,
ripple carry, and the name is a warning.

## What the ripple costs

Every position has to wait for the carry from the position below it. So the time
to add two numbers is not the delay of one adder, it is the delay of one adder
times the number of bits.

For a wide addition that is the longest path in the machine, and Part III will
find it setting the clock period. nand2tetris is honest about its own version:
the ripple-carry adder it builds "is rather inefficient, due to the long delays
incurred while the carry bit propagates."

There are faster arrangements. They work by computing, for each position,
whether it will generate a carry regardless of what arrives and whether it will
pass one along if it does, and then combining those in a tree rather than a
chain. The result is delay proportional to the logarithm of the width rather
than to the width. That is a real technique with real cost, and it is a Part III
subject rather than a Part II one, because building it needs the gate budget
Part II is deliberately not giving you.

The point for now is that the obvious arrangement works and is slow, and that
you can see why from the shape of the circuit rather than being told.

## The part that is free

Here is the thing this unit exists for.

To subtract, you might expect a second circuit: a row of full subtractors with
borrow instead of carry. You do not need one, and the reason is not a trick in
the wiring.

In two's complement, negating a number is inverting every bit and adding one.
So `a - b` is `a + (not b) + 1`. You already have an adder. Inverting `b` is one
gate per bit. And adding one is free, because the adder already has a carry
input on its lowest position and nothing was using it.

So take an adder, put an exclusive or on each bit of `b` with a control signal,
and wire that same control signal to the carry in. When the control is 0 the
exclusive or passes `b` through and the carry in is 0, so the circuit adds. When
it is 1 the exclusive or inverts `b` and the carry in is 1, so the circuit
subtracts.

One control bit, doing both halves of the job, and no new arithmetic hardware at
all.

## Why that is a fact about numbers

It is worth being precise about where the saving came from, because it is the
first time in this handbook that a choice of representation buys hardware.

Two's complement is not the obvious way to write negative numbers. The obvious
way is a sign bit and a magnitude, which reads well and breaks addition: adding
a positive and a negative number in that representation needs a comparison, a
subtraction and a decision about the sign, which is three circuits where you
wanted one.

Two's complement gives the top bit a negative weight instead of a flag meaning.
Then the same adder handles signed and unsigned operands with no changes, and
subtraction is the identity above. The representation was chosen so the hardware
would be cheap, and it is why every machine you will ever touch uses it.

Part VI takes that further and finds the edges: the asymmetry that leaves one
more negative value than positive, and what that does to the smallest integer.
Here the point is only that the choice bought you a circuit.

## What the same wires can do besides adding

A last observation before the exercises, and it is the one that turns an adder
into an arithmetic unit.

You now have a circuit with two operands, a control bit that decides whether to
invert one of them, and a carry input. Notice how many different operations that
already is, without adding anything.

Hold one operand at zero and the circuit passes the other through. Hold one at
zero, set the invert control and the carry, and the circuit negates. Set the
carry with both operands present and it adds one more than it otherwise would,
which is how an increment falls out of an adder without a separate incrementer.

That is why a real arithmetic unit is built as an adder with a small collection
of control bits in front of it, rather than as a menu of separate circuits. Each
control bit changes what the operands look like on the way in, and the same
adder does the work every time.

nand2tetris takes this to its conclusion: its arithmetic unit has six control
bits, they zero, invert and select the two inputs and the output, and between
them those six bits reach eighteen useful functions from one adder. The negate
control on the output is one exclusive or per bit, which is why it is there:
building both polarities and choosing between them costs far more.

## Comparison, for free as well

One more consequence, and it is the one the machine's branches are built on.

If subtraction is available, comparison is too. Whether `a` equals `b` is
whether `a - b` is zero, which is an or across the result bits, inverted.
Whether `a` is less than `b` is the sign of `a - b`, which is the top bit.

So a machine does not need comparison hardware either. It needs an adder, an
inverter per bit, and somewhere to look at the result. The unit on control uses
exactly that to decide whether a branch is taken, and the flags it looks at are
the leftovers of an addition that already happened.

## What to carry into the next unit

Arithmetic is one part repeated, and the repetition is what makes it slow.
Subtraction is addition plus one control bit, and that is a fact about the
representation. Comparison is subtraction plus a look at the result.

Everything so far has been combinational: outputs are a function of inputs, and
nothing remembers. That is about to stop. The next unit takes the hold-or-load
you built last time, closes the loop the simulator refused to accept, and adds
the one thing that makes the loop legal.

After that the machine can remember, and once it can remember it can count, and
once it can count it can fetch instructions in order.

## Reading the errors you are about to see

The specifications here are wider than the ones you have seen, because adding
two-bit numbers with a carry needs five inputs and therefore thirty-two rows. The
simulator checks all of them and names the first that disagrees.

Read the inputs on the failing row as numbers rather than as bits. A design that
fails only on rows where both operands have their high bit set is failing at the
carry, and a design that fails on exactly half the rows is usually ignoring one
input entirely.
