---
needs: [selection, arithmetic]
minutes: 50
one_idea: Memory is the loop you were forbidden two units ago, made legal by putting a clock edge in it.
sources: [nand2tetris-eater-scott, digital-design-hdl-fpga]
---

Everything you have built so far forgets. Present the same inputs and you get
the same outputs, every time, with no reference to what happened before. That is
what combinational means, and it is the reason the simulator has been rejecting
loops: a value that depends on its own present value is not a function of the
inputs, so there is nothing to compute.

This unit removes that restriction, and the way it removes it is the entire
subject.

## The loop you already wrote

In the last unit but one you built a part called hold-or-load: a multiplexer
whose two inputs are the value that is already here and the value arriving, with
`load` choosing between them.

Then the note said to imagine wiring the output back round to the first input,
and that the simulator would refuse it. Try it and it does, and the complaint is
correct: with no clock, "the value that is already here" has no meaning. The
circuit is not wrong. It is incomplete.

What is missing is a way to say **when**.

## The part that says when

A D flip-flop has one input and one output, and one rule: its output during this
cycle is whatever its input was during the previous one.

That is all. It is not built from NAND here, and that is a deliberate choice
rather than a fact. Real flip-flops are built from gates with feedback loops
inside them, in a master-slave arrangement with two phases, and nand2tetris says
plainly that it abstracts those away. This handbook does the same, for the same
reason: the interesting thing is what having one lets you build, not what one is
made of. Part III builds one properly, from the standard cells a synthesiser
actually uses.

Taking it as given, look at what it does to the loop.

```figure
{
  "kind": "blocks",
  "alt": "A register drawn as a multiplexer feeding a flip-flop, with the flip-flop's output fed back to one input of the multiplexer, and the load signal on the multiplexer's select.",
  "caption": "The invalid design and the valid one. A flip-flop with its output tied to its input can never be loaded with anything. Putting a multiplexer in the loop makes the select bit into a load signal, and that is a register.",
  "boxes": [
    { "id": "in",   "x": 0,   "y": 1,   "w": 2.4, "h": 1, "label": "in", "mono": true },
    { "id": "load", "x": 0,   "y": 2.6, "w": 2.4, "h": 1, "label": "load", "mono": true, "accent": "gold" },
    { "id": "mux",  "x": 3.4, "y": 1.6, "w": 2.4, "h": 1.4, "label": "mux", "sub": "hold or load", "accent": "azure" },
    { "id": "dff",  "x": 6.8, "y": 1.6, "w": 2.4, "h": 1.4, "label": "dff", "sub": "one cycle", "accent": "jade" },
    { "id": "out",  "x": 10.2, "y": 1.6, "w": 2.4, "h": 1.4, "label": "out", "mono": true }
  ],
  "arrows": [
    { "from": "in",   "to": "mux" },
    { "from": "load", "to": "mux" },
    { "from": "mux",  "to": "dff" },
    { "from": "dff",  "to": "out" },
    { "from": "out",  "to": "mux", "label": "the feedback, legal because it passes through the flop" }
  ]
}
```

Now the loop has a delay in it. The multiplexer's first input is not the output
right now, it is the output as of the previous cycle, which is a value that
exists and can be read. The circuit has a defined answer again.

## Why the multiplexer has to be there

It is worth being precise about the invalid version, because it is the most
valuable diagram in nand2tetris and the mistake it prevents is one people make
repeatedly.

The tempting design is a flip-flop with its output wired straight back to its
input. That does hold a value: whatever is in it stays in it, cycle after cycle.
And it is useless, because there is no way to ever put anything else in. The
book labels the figure "invalid design" and says that it is not clear how you
would ever load a new value.

The multiplexer is what fixes it. Its select input decides, each cycle, whether
the flop is fed its own old value or something new, and that select input is
what the word `load` means. There is no separate loading mechanism anywhere in
any machine. There is a multiplexer in a loop.

So a register is a part you already had, plus a part you were just given, and
nothing else.

## What the clock actually is

Three things people believe about the clock, and none of them is right.

It is not what makes the computer go. A clock is a time unit. Everything in the
machine is computing continuously, whether or not a clock is running, and the
clock exists to say when the results are allowed to be believed.

It does not make anything fast. If anything it makes things slower, because the
cycle has to be long enough for the slowest path in the design to settle, so
every operation takes as long as the worst one.

And the machine is not required to be correct in the middle of a cycle. It is
allowed to be, and usually is, showing garbage: an adder's output is not
trustworthy the instant its inputs change, and while a carry is rippling the
output is a sequence of wrong answers. nand2tetris says it directly: until the
output stabilises, the arithmetic unit generates garbage. The design is correct
if it has settled by the cycle boundary and it does not matter what happened
before that.

That is the whole trick. A clock cycle is a contract about when signals are
allowed to be wrong, and choosing its length is choosing how much wrongness you
are willing to wait out.

## What a latch is, and why this is not one

There is a part next to the flip-flop that is worth naming so you can avoid it,
because the two get confused and the difference causes real bugs.

A latch is level-triggered. While its enable is high it is transparent: the
output follows the input continuously, as a wire would. When the enable goes low
it holds whatever was there.

A flip-flop is edge-triggered. It samples at one instant and holds for the whole
cycle regardless of what the input does afterwards.

The difference matters the moment you build a loop. Put a latch in the loop with
its enable high and the value races round it as fast as the gates allow, many
times within one enable pulse, and where it stops depends on propagation delays.
Ben Eater's videos show this directly, with a level-triggered toggle flipping
repeatedly during a single clock pulse rather than once.

The fix, historically and in every real part, is two latches in series with
opposite enables, so that at no moment is there a path all the way through.
While the first is open the second is closed. That arrangement is called
master-slave and it is what makes the sampling happen on the edge.

Part III meets latches again from the other direction: there, the problem is
that a synthesiser will build one for you by accident when a combinational block
forgets to assign its output on some path, and the tool reports it as a warning
that is easy to miss.

## Reading before writing

There is a discipline hiding in the flip-flop's rule, and it is the reason a row
of registers can pass values around without racing.

Every flop reads its input and produces its output at the same instant. So in a
design where flop A's output feeds flop B's input, what B captures at the edge is
what A held *before* the edge, not what A is about to become. Every flop reads
old values and writes new ones, and nothing can observe the intermediate state.

That is why a chain of flip-flops shifts rather than collapsing. Feed a value
into the first and after two cycles it is in the second, because each one
captured what its neighbour held rather than what its neighbour was becoming.

Part III meets this idea again under a different name. Verilog's non-blocking
assignment exists to model exactly this, and getting it wrong is the single most
common bug in hardware description languages. You are meeting the reason first
and the language later, which is the right order.

## What to carry into the next unit

You now have storage. A register is a multiplexer in a loop with a flip-flop
holding the value, the load signal is the multiplexer's select, and the clock
decides when the loop takes a step.

The exercises build that: a bit, a register with a load, a chain that shifts, a
toggle that flips once per cycle, and a two-bit counter. The counter is worth
noticing, because it is the increment from the last unit wired to a register,
which means counting is not a new mechanism either.

The next unit is about what happens when several of these want to talk to each
other over one set of wires, and what has to be true about the timing for that
to work rather than being a short circuit.

## Reading the errors you are about to see

The specifications here are traces rather than truth tables: one row per cycle,
run in order, with the state carrying forward. A mismatch names the cycle it
happened on, which matters because the same inputs appear on many cycles and
mean different things.

Every flip-flop starts holding 0. A design that is right except for cycle 0 is
usually one that expected its output to reflect its input immediately, and the
whole point of the part is that it does not.

The simulator will still reject a loop that has no flip-flop in it, and the
message now says so: a value may depend on itself through a clock edge and may
not otherwise.
