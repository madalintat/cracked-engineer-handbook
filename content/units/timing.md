---
needs: [proving, clock-edge]
minutes: 55
one_idea: The deepest path between two flip-flops sets the clock for the whole chip, and a design that misses it is not slow, it is wrong.
sources: [digital-design-hdl-fpga, transistors-cmos-fabrication]
---

The last unit proved designs correct over every input there is. This one is
about a design that is correct in that sense and cannot be built.

A gate does not switch instantly. It has a delay, that delay depends on how much
it is driving and how far the signal has to travel, and every gate on a path
adds its own. The clock edge does not wait. If the value has not arrived when
the edge comes, the flip-flop captures whatever was on the wire, which is
usually the old value and occasionally neither.

So there is a deadline, it applies to every path in the design at once, and the
worst path decides.

## The budget

One clock period has to contain four things.

The flip-flop that starts the path takes some time to put its stored value on
its output after the edge. Call that the clock to output delay. Then the logic
between the two flops has to settle. Then the flop at the end needs the value to
be stable for a little while before the edge arrives, which is its setup time.
And the two flops do not see the edge at exactly the same instant, because the
clock reaches them through different amounts of wire, which is skew.

Add them and you have the period. Anything left over is called slack, and the
number every hardware engineer watches is the worst slack across every path in
the design. Positive slack means it works at this clock. Negative slack means it
does not, and the process of getting to zero has a name: timing closure. It is
most of the schedule of a real chip.

```figure
{
  "kind": "timing",
  "alt": "A clock with two edges, and beneath it a data signal that leaves the first flop late, settles through logic, and arrives before the setup window of the next edge.",
  "caption": "One period, and everything that has to fit inside it. The logic gets what is left after the flops have taken their share.",
  "signals": [
    { "name": "clk",   "wave": "p...p...", "accent": "gold" },
    { "name": "start", "wave": "0.11111.", "accent": "azure" },
    { "name": "settle","wave": "0.0xx11.", "accent": "copper" },
    { "name": "arrive","wave": "0....11.", "accent": "jade" }
  ]
}
```

## Too slow is not slow

This is the sentence worth keeping.

In software, a slow function makes the program take longer and produce the same
answer. That intuition does not transfer. A path that misses its deadline does
not delay the result: the flop captures the previous value, or a value partway
through changing, and the design computes something wrong from that point on.

There is a worse case. A flip-flop given a value that changes right at the edge
can enter a state that is neither 0 nor 1, and stay there for an unbounded time
before falling one way or the other. That is metastability, and the probability
of it is not zero, it is small, which means a design with a marginal path fails
rarely and unpredictably rather than never or always.

Rarely and unpredictably is the worst failure mode there is. It survives your
tests, it ships, and it comes back as a field return that nobody can reproduce.

## The other deadline, in the other direction

Setup is the deadline you expect. There is a second one that runs the other way
and it catches people because it is not intuitive.

A flip-flop also needs its input to stay still for a short time after the edge,
which is its hold time. If the path between two flops is very short, the new
value can race through the logic and reach the second flop before that window
closes, corrupting the value the second flop was supposed to capture from the
previous cycle.

The asymmetry matters. A setup problem is fixed by slowing the clock down, so a
chip that fails setup can still be sold at a lower speed grade, which is exactly
what binning is. A hold problem is not fixed by slowing the clock, because the
race does not care how long the period is. A chip that fails hold is scrap, and
the fix is another spin of the silicon.

Which is why the tools insert buffers into paths that are too fast. Delay added
on purpose, to make a signal arrive later, in a design where everything else is
a fight to make signals arrive sooner.

## What makes a path deep

Almost always a chain where a tree would do.

The ripple carry adder is the canonical example and you built one. Bit 0's carry
feeds bit 1, whose carry feeds bit 2, and the top bit cannot settle until every
stage below it has. Depth grows with the width, so doubling the width doubles
the delay.

The same shape appears everywhere once you look for it. A maximum computed by
comparing the running best against each candidate in turn is a chain. A
selection written as a ladder of conditions tested one after another is a chain.
An accumulator that adds into a wide register is a chain, and a nasty one,
because its output feeds its own input and there is nowhere to put a register.

The repair is usually the same too. Compare in pairs, then compare the winners:
a tournament of eight is three rounds rather than seven comparisons. Decode a
select in bits rather than in cases: three balanced multiplexers rather than
eight conditions in sequence. Depth proportional to the logarithm of the width
instead of to the width.

It is not free. A tree usually costs more gates than a chain, and area and power
go with gates. Trading one for the other is most of what physical design is.

```figure
{
  "kind": "blocks",
  "alt": "Two arrangements of the same seven comparisons: a chain seven deep on the left and a tournament three deep on the right.",
  "caption": "Same comparisons, same answer, and one of them settles in three gate delays instead of seven. This is the substitution the exercises here keep asking for.",
  "boxes": [
    { "id": "c1", "x": 0,   "y": 0,   "w": 2.4, "h": 1,   "label": "chain", "accent": "bad" },
    { "id": "c2", "x": 0,   "y": 1.3, "w": 2.4, "h": 1,   "label": "then" , "accent": "bad" },
    { "id": "c3", "x": 0,   "y": 2.6, "w": 2.4, "h": 1,   "label": "then" , "accent": "bad" },
    { "id": "c4", "x": 0,   "y": 3.9, "w": 2.4, "h": 1,   "label": "then" , "accent": "bad" },
    { "id": "t1", "x": 6.5, "y": 0.4, "w": 2.4, "h": 1,   "label": "pairs", "accent": "jade" },
    { "id": "t2", "x": 6.5, "y": 1.7, "w": 2.4, "h": 1,   "label": "pairs", "accent": "jade" },
    { "id": "t3", "x": 10,  "y": 1.05,"w": 2.4, "h": 1,   "label": "winner", "accent": "jade" }
  ],
  "arrows": [
    { "from": "c1", "to": "c2" },
    { "from": "c2", "to": "c3" },
    { "from": "c3", "to": "c4" },
    { "from": "t1", "to": "t3" },
    { "from": "t2", "to": "t3" }
  ]
}
```

## Cutting the path

When a tree is not available, the other lever is a register in the middle.

Split the logic into two halves and put flip-flops between them. Each half now
has its own clock period to settle in, so the deepest path is roughly halved and
the clock can roughly double. The design produces a result every cycle as
before, and any particular result now takes two cycles to come out.

That is the pipeline trade, and both halves of it are real. Throughput goes up,
which is what you wanted. Latency goes up too, which is a cost somebody pays:
a branch that has to wait for a comparison waits longer, and a control loop that
has to react to a sensor reacts later.

A register at the end of a deep path is not a pipeline stage. The path is still
as deep as it was; you have only given its result somewhere to sit. The cut has
to be in the middle of the logic, and choosing where is the design work.

## How anyone knows before building it

Static timing analysis, and its logic is the one from the last unit.

The tool takes the netlist and a library that says what every cell's delay is,
finds the longest path between every pair of registers, and reports the worst
one. It does this without simulating anything and without any input vectors,
because delay does not depend on the values, only on the structure. Every path
is considered, including the ones no realistic input ever exercises.

That last part is a weakness as well as a strength. A path that no input can
activate still shows up as the critical path and still has to be fixed or
excluded by hand, and those false paths are a recurring nuisance.

The exercises here do not have a cell library, so they measure depth instead:
the number of cells on the deepest path between two flip-flops. It is not
picoseconds, and it is the right shape. A design at depth 42 will not clock at
the speed of the same function at depth 18, whatever library you hand it.

## What to carry forward

Part III is done, and it added three things to the machine you built by hand.

A description that a tool turns into structure. A proof that the structure
computes the right function for every input. And a deadline that decides whether
the structure can be clocked at all.

Part IV steps back from the hardware entirely and asks what any machine can
compute, which turns out not to depend on how deep its adder is.

## Reading the errors you are about to see

`path-too-long` is the verdict this unit is about. The design is correct and its
deepest path is deeper than the exercise allows, and the message reports the
number so you can see the change your fix made.

`sat-fail` still means what it meant: your restructured design no longer computes
the same thing. Restructuring for depth is where that happens most, because it
is exactly the kind of edit that looks safe and reassociates something that
could not be reassociated.
