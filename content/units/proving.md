---
needs: [structure, clock-edge]
minutes: 55
one_idea: For a circuit you can often prove correctness over every input at once, and the proof costs about what testing one case costs.
sources: [digital-design-hdl-fpga, nand2tetris-eater-scott]
---

In 1994 Intel shipped a Pentium whose floating point divide was wrong. Not
wrong in general: wrong for a small set of operands, rarely enough that the
part passed its tests and reached customers before a mathematician noticed his
results drifting.

The cause was a lookup table. The design used a table of quotient digit
estimates, five of its entries were never written, and the tool that generated
it had a bug nobody looked for because the table was generated rather than
typed. Intel took a charge of 475 million dollars.

The interesting part is not the bug. It is that the bug was findable, and by a
method that had existed for years and was not yet the default. This unit is
about that method.

## Testing samples, and sampling is the problem

Your 4-bit adder from the last unit has eight input bits, so 256 input
combinations. You could try all of them in a fraction of a second and know.

Widen it to 32 bits and there are two operands of 32 bits each, so 2^64
combinations. At a billion per second that is 584 years. There is no schedule
in which you enumerate them, which means every test you write is a sample, and
a sample tells you about the cases you picked.

The Pentium's table had 1066 entries of which 5 were wrong. A random test has
about one chance in 200 of hitting one, and the operands that reach a bad entry
are not random-looking, so a human writing test cases by hand would have had to
be unlucky in a very particular way to find it.

This is the ordinary situation, not an unusual one. Any interesting circuit has
more states than you can visit.

## What a proof looks like

Here is the whole idea, and it is smaller than the reputation suggests.

Take your design and a reference design. Wire the same inputs into both. Wire
their outputs into a comparator that produces 1 when they disagree. That
combined circuit is called a miter, and it is an ordinary circuit made of
ordinary gates.

Now ask one question about it: is there any assignment of the inputs that makes
that output 1?

If the answer is no, your design and the reference agree on every input there
is, and you have not tried any of them. If the answer is yes, the tool hands you
the assignment, which is a failing test case you did not have to think of.

```figure
{
  "kind": "blocks",
  "alt": "Inputs feeding both a design under test and a reference design, their outputs meeting at a comparator whose single output asks whether they ever disagree.",
  "caption": "The miter. Everything about equivalence checking is this picture plus a solver that answers one question about it.",
  "boxes": [
    { "id": "in",   "x": 0,    "y": 1.6, "w": 2.8, "h": 1.3, "label": "inputs", "sub": "all of them at once" },
    { "id": "dut",  "x": 4.2,  "y": 0.2, "w": 3.4, "h": 1.3, "label": "your design", "accent": "azure" },
    { "id": "ref",  "x": 4.2,  "y": 3,   "w": 3.4, "h": 1.3, "label": "reference", "accent": "copper" },
    { "id": "cmp",  "x": 9,    "y": 1.6, "w": 3.4, "h": 1.3, "label": "differ?", "accent": "jade" },
    { "id": "sat",  "x": 13.4, "y": 1.6, "w": 2.6, "h": 1.3, "label": "ever 1?", "accent": "gold" }
  ],
  "arrows": [
    { "from": "in",  "to": "dut" },
    { "from": "in",  "to": "ref" },
    { "from": "dut", "to": "cmp" },
    { "from": "ref", "to": "cmp" },
    { "from": "cmp", "to": "sat" }
  ]
}
```

## The question is famously hard and answered anyway

Asking whether a circuit of Boolean gates can ever output 1 is Boolean
satisfiability, and it is the problem everything else in Part IV's complexity
unit is measured against. In the worst case it takes time exponential in the
number of inputs, and nobody expects that to change.

It is answered anyway, on circuits with hundreds of thousands of gates, in
seconds. The gap between the worst case and the ordinary case is enormous, and
it is the most useful fact in this unit.

The reason is that real circuits are not worst cases. They have structure: the
same subexpression appears in both designs, a decision about one bit constrains
twenty others, and a solver that learns a contradiction once never revisits that
region of the search. Modern solvers do conflict-driven learning, and on circuits
derived from hardware they cut the search down by many orders of magnitude.

So the practical rule is not "this is exponential, avoid it". It is: try it, and
find out. The failure mode is that the solver runs out of time rather than that
it gives you a wrong answer.

## Combinational is easy, sequential is not

The picture above assumes both designs settle to a function of their inputs. Add
a flip-flop and it stops being true, because now the output depends on state,
and state depends on history.

Two shift registers are equivalent if they produce the same output on every
possible sequence of inputs, and there are infinitely many sequences. You cannot
enumerate those either, and this time you cannot even bound them.

The standard answer is induction, and it is the same induction you already know.
Show that the two designs agree in their reset state. Then show that if they
agree now, and they see the same input, they still agree after the next edge.
Those two facts together cover every sequence of any length.

Yosys spells this as two steps. `equiv_simple` proves the combinational parts
equal where it can, and `equiv_induct` does the inductive argument across the
flip-flops. When a check in this handbook passes, that is what happened.

Induction does not always succeed. The inductive step can fail on states the
design can never actually reach, because the argument as stated allows starting
from any state at all. The repair is to strengthen the claim, which usually
means telling the tool an invariant about which states are reachable, and it is
where formal verification stops being push-button.

## A proof is relative to what you proved against

The uncomfortable part.

Proving your adder equals `a + b` proves your adder equals `a + b`. If the
specification wanted saturating arithmetic and you wrote the reference as
wrapping, the proof is valid and the chip is wrong.

This is not a small caveat. It is where most of the remaining risk lives once
equivalence checking is in place, and it moves the hard question from "is my
implementation right" to "is my reference right", which is a better question but
not a free one.

Two things help. The reference can be written in a different style by a
different person, so that a shared misunderstanding has to survive two
independent expressions of it. Or the property can be stated directly rather
than as a second implementation: rather than compare against a decoder, assert
that exactly one output is ever high. A property has no implementation to be
wrong in the same way twice.

## Properties, and what they are good for

A property is a claim about the design that should hold for every input, written
so a solver can attack it.

Exactly one output of this decoder is high. This counter never exceeds its
bound. These two requests are never granted in the same cycle. This buffer never
reports empty and full at once.

Each of those is a small circuit that computes true or false, and the question
is the same question as before: can it ever be false. Properties are cheaper to
write than a reference model, they catch a different class of bug, and they
survive changes to the implementation that a reference model would have to track.

The exercises here express a property by computing it as an output and proving
that output is always 1, which is the same thing with less machinery.

## What actually changed after 1994

Formal equivalence checking is now routine. Every serious chip is checked for
equivalence between its register transfer description and the gate netlist the
synthesiser produced, and again after the netlist is modified for timing, and
again after clock and test logic are inserted. That is a class of bug, tool
introduced a difference, that essentially no longer reaches silicon.

Property checking is more selective, because writing good properties is real
work and the state spaces that resist induction are the interesting ones. It
gets spent where a bug is expensive: arithmetic units, cache coherence, bus
arbiters, anything with a protocol.

And the thing the Pentium bug specifically taught is now standard practice: a
generated table is verified against the algorithm that was supposed to generate
it, rather than trusted because a program produced it.

## What to carry into the next unit

Correct is not the same as usable, and this unit only settled the first one.

A design can be proved equal to its reference for every input and still be
unshippable, because the proof says nothing about how long the gates take to
settle. That is unit 016, and it is the point where a design stops being a
function and starts being a physical object with a deadline.

## Reading the errors you are about to see

`sat-fail` is the interesting verdict here and it carries the most information
of any error in this handbook: the tool found an input where you and the
reference disagree, and it will name it. Read the counterexample before you read
your code.

`cell-budget` where a design is otherwise correct means the proof passed and the
size assertion did not. Both run now, so a correct design that is larger than
the exercise allows will say exactly that.
