---
needs: [control, encoding]
minutes: 50
one_idea: Verilog does not run. It describes a thing that exists all at once, and the tool's job is to build that thing out of cells.
sources: [digital-design-hdl-fpga, nand2tetris-eater-scott]
---

Part II ended with a computer drawn by hand. Every wire was a line you placed,
every gate was a part you counted, and the reason it worked was that you could
see all of it.

That stops scaling somewhere around a few hundred gates. A real design has
millions, and nobody draws millions of anything. So the drawing gets replaced by
a description, and the description is text.

The text looks like a program. It has modules that look like functions,
assignments that look like assignments, and `for` loops that look like loops. It
is none of those things, and every hour lost in this part is lost to that
resemblance.

## Nothing here happens

Start with the smallest possible example.

```verilog
assign y = a & b;
```

Read it as a program and it says: compute the and of `a` and `b`, store the
result in `y`. Something happens, then it is finished.

That reading is wrong in every part. The line does not run once. It does not
run at all. It says there is a permanent connection between `y` and an AND gate
whose inputs are `a` and `b`, and that connection is as true a nanosecond from
now as it was a year ago. If `a` changes, `y` changes, because the wire is
still there.

The verb is not compute. The verb is is.

## Which means order cannot matter

Take three lines and shuffle them.

```verilog
assign y  = t & c;
assign t  = a & b;
```

In a program this is a use before assignment and would either fail to compile
or read garbage. Here it is fine, and it is fine for a reason worth being
precise about: `t` is not a variable that gets a value at some moment. It is a
node in a circuit, and the second line says what drives it. Whether that
sentence is written above or below the one that reads it changes nothing,
because the circuit does not have a top.

You can reorder every continuous assignment in a module and synthesise
identical hardware. If that feels wrong, the resemblance is still winning.

```figure
{
  "kind": "blocks",
  "alt": "Two boxes of Verilog text with their lines in opposite orders, both feeding an arrow into the same single circuit of two AND gates.",
  "caption": "The same circuit, described twice. Order in the file is not order in time, because there is no time in a continuous assignment.",
  "boxes": [
    { "id": "a", "x": 0, "y": 0.2, "w": 4, "h": 1.6, "label": "t then y", "sub": "one file order", "accent": "azure" },
    { "id": "b", "x": 0, "y": 2.6, "w": 4, "h": 1.6, "label": "y then t", "sub": "the other", "accent": "azure" },
    { "id": "c", "x": 7.5, "y": 1.4, "w": 4.5, "h": 1.6, "label": "two AND gates", "sub": "one netlist", "accent": "jade" }
  ],
  "arrows": [
    { "from": "a", "to": "c" },
    { "from": "b", "to": "c" }
  ]
}
```

## A wire is a node, and a node has one driver

In Part II this was an electrical rule about buses: two outputs driving one wire
is a short, which is why the tri-state buffer exists and why exactly one bit in
a control word may put something on the bus.

Verilog inherits the rule and enforces it earlier. Write two continuous
assignments to the same wire and you have described two gate outputs soldered
together. The tool will tell you so, and the message names the signal.

```verilog
assign y = a & b;
assign y = c | d;      // the same y. This is a fault, not an override.
```

Nothing about the second line replaces the first, because there is no first.
The two statements coexist, which is precisely the problem.

## The tool builds, and then it deletes

What a synthesiser does is worth stating plainly, because the exercises here
report its output and the output surprises people.

It reads the text and works out what the description means, expanding
parameters and unrolling loops until what is left is a flat structure. Then it
maps that structure onto cells: real parts from a real library, an AND cell, a
flip-flop cell, a multiplexer cell. Then it optimises, and this is the step
people are not ready for.

The optimiser removes anything whose value cannot change and anything nothing
reads. Write `a & 1'b1` and no AND gate is built, because the answer is `a` and
a wire is cheaper than a gate. Write a signal nothing uses and it does not
appear in the output at all. Compute something two different ways and the tool
will notice they agree and build one of them.

So a cell count is not a count of what you typed. It is the answer to a
different and better question: how much hardware did you actually ask for.

```figure
{
  "kind": "blocks",
  "alt": "Four boxes left to right showing the synthesis pipeline: text, elaboration into flat structure, mapping onto library cells, and optimisation into a smaller netlist.",
  "caption": "Every exercise in this part reports the last box. The gap between the first and the last is where most of the surprise lives.",
  "boxes": [
    { "id": "src", "x": 0, "y": 1, "w": 3.2, "h": 1.4, "label": "text", "sub": "what you wrote", "accent": "azure" },
    { "id": "ela", "x": 4.1, "y": 1, "w": 3.2, "h": 1.4, "label": "elaborate", "sub": "loops unrolled", "accent": "azure" },
    { "id": "map", "x": 8.2, "y": 1, "w": 3.2, "h": 1.4, "label": "map", "sub": "onto real cells", "accent": "jade" },
    { "id": "opt", "x": 12.3, "y": 1, "w": 3.2, "h": 1.4, "label": "optimise", "sub": "what survives", "accent": "jade" }
  ],
  "arrows": [
    { "from": "src", "to": "ela" },
    { "from": "ela", "to": "map" },
    { "from": "map", "to": "opt" }
  ]
}
```

## A loop is a copy machine

Here is the construct that catches everyone.

```verilog
for (i = 0; i < 4; i = i + 1)
  p = p ^ a[i];
```

There is no counter in the resulting hardware. There is no thing that goes
around four times. The tool unrolls the loop while it is elaborating and emits
four XOR gates side by side, all of which exist at once and all of which settle
together.

The bound has to be known at build time for that reason. A loop whose count
depends on an input is not a loop the tool can unroll, and it cannot be built,
because the amount of hardware would have to change while the chip is running
and silicon does not do that.

This is the first real difference between describing hardware and writing
software, and it is the one that reorganises how you think about cost. In a
program a loop is cheap and the body is what you pay for. Here the loop is the
multiplier: four iterations is four copies of the body, in area, in power, and
in every gate that has to settle before the clock edge.

## Hierarchy is copies too

The same logic applies one level up. Instantiating a module is not calling it.

```verilog
and2 g0 (.a(x), .b(y), .y(t));
and2 g1 (.a(t), .b(z), .y(out));
```

That is two AND gates, not one gate used twice. There is no stack, nothing
returns, and nothing is reused between the instances. Each name is a separate
piece of the chip with its own inputs and its own output, and the only thing
they share is a description.

Which is why a module you instantiate a thousand times costs a thousand times
as much, and why sharing hardware between two uses is something you have to
build on purpose, with a multiplexer to choose the inputs and a register to hold
the result. Part V calls that pipelining and resource sharing. It is never free
and it is never automatic.

## Two audiences, one text

One more source of confusion, and it is worth knowing about before you meet it.

The same Verilog is read by two tools with different jobs. A simulator executes
the text as an event-driven program, one statement at a time, with a notion of
time. A synthesiser ignores time and builds structure. Most of the language
means the same thing to both, and a subset does not.

A delay like `#5` is meaningful to the simulator and simply ignored by the
synthesiser. Initial blocks and file input are simulation only. The disagreement
has its own name, simulation and synthesis mismatch, and it describes a design
that passes every test and then behaves differently as a chip.

The way out is discipline rather than cleverness: write the subset that means
one thing, and let the tool that builds the hardware be the one that decides
whether your description is real. That is what the exercises here do.

## What to carry forward

Three sentences, and the rest of Part III sits on them.

Continuous assignment is a permanent connection, so file order is not time
order. Repetition, whether a loop or an instance, is copies of hardware rather
than passes over one piece of it. And the tool's report of what it built is
worth more than your reading of what you wrote, because it has already deleted
everything you asked for by accident.

The next unit adds the clock, and with it the only construct in this language
where order genuinely does matter.

## Reading the errors you are about to see

Every exercise here is synthesised by Yosys, in this page, and checked either
against a cell count or against a reference module the tool proves you equal to.

`syntax-error` names a line. `multi-driver` names a signal that two things
drive. `cell-budget` means the design is correct and larger than the budget, or
smaller, which usually means the optimiser found something you did not intend to
give it. `sat-fail` means the tool found an input where your module and the
reference disagree, and it will tell you which input, which is the most useful
error message in this handbook.
