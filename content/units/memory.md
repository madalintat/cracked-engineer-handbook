---
needs: [selection, feedback, clock-bus]
minutes: 50
one_idea: A memory is a decoder, a row of registers and a multiplexer, and a jump is a load into the counter you already built.
sources: [nand2tetris-eater-scott]
---

Four units ago you built a decoder that raises one of several lines from a
number. Two units ago you built a register. Last unit you built the routing that
gets a value from one place to another.

A memory is those three things arranged in one order, and that is the whole
mechanism. There is no fourth idea.

## The arrangement

Take some registers. Run the address bits into a decoder, so exactly one of its
outputs is high. And the two halves fall out.

To write, gate the write signal with the decoder outputs: each register's load
input is the write signal ANDed with its own line. Exactly one line is high, so
exactly one register loads, and the rest hold.

To read, run all the register outputs into a multiplexer with the same address
on its select. Exactly one value comes out.

```figure
{
  "kind": "blocks",
  "alt": "An address feeding a decoder whose one-hot outputs gate the load signal to four registers, with the same address selecting between the register outputs through a multiplexer.",
  "caption": "The decoder chooses who is written and the multiplexer chooses who is read, both from the same address. There is nothing else in a memory.",
  "boxes": [
    { "id": "addr", "x": 0,   "y": 1.6, "w": 2.2, "h": 1, "label": "address", "mono": true, "accent": "gold" },
    { "id": "dec",  "x": 3.2, "y": 1.6, "w": 2.4, "h": 1, "label": "decoder", "sub": "one line high", "accent": "copper" },
    { "id": "r0",   "x": 6.8, "y": 0,   "w": 2.2, "h": 0.9, "label": "reg 0", "accent": "azure" },
    { "id": "r1",   "x": 6.8, "y": 1.1, "w": 2.2, "h": 0.9, "label": "reg 1", "accent": "azure" },
    { "id": "r2",   "x": 6.8, "y": 2.2, "w": 2.2, "h": 0.9, "label": "reg 2", "accent": "azure" },
    { "id": "r3",   "x": 6.8, "y": 3.3, "w": 2.2, "h": 0.9, "label": "reg 3", "accent": "azure" },
    { "id": "mux",  "x": 10.2, "y": 1.6, "w": 2.4, "h": 1, "label": "mux", "sub": "same address", "accent": "jade" },
    { "id": "out",  "x": 13.6, "y": 1.6, "w": 2.0, "h": 1, "label": "out", "mono": true }
  ],
  "arrows": [
    { "from": "addr", "to": "dec" },
    { "from": "dec",  "to": "r1", "label": "load, gated per row" },
    { "from": "r1",   "to": "mux" },
    { "from": "r2",   "to": "mux" },
    { "from": "mux",  "to": "out" }
  ]
}
```

That is a memory. Registers you have, a decoder you have, a multiplexer you
have, and one AND per row.

## What an address is not

It is worth saying again with the circuit in front of you.

Nothing in that picture stores an address. No register knows its own number.
There is no table anywhere mapping numbers to locations. The address bits are
wires into a decoder and wires into a multiplexer, and the number identifies a
register only in the sense that it is the number that lights that register's
line.

Scott's image is sixteen unnumbered streets with sixteen unnumbered houses on
each. "The fourth house on the seventh street" locates a house exactly, and no
house needs a plaque. Address is position.

That has a consequence people find surprising the first time. Reading location
zero is not faster or more special than reading location a thousand: the same
number of wires carry a different pattern into the same decoder, and the same
gates settle. Every location costs the same, which stops being true the moment
there is a cache, and Part V is largely about that stopping.

## Making it bigger

Four registers took a two-bit address. A thousand takes ten bits, and the same
arrangement with a thousand-way decoder and a thousand-way multiplexer would be
enormous and slow, because a wide flat decode is a huge fan-in and a wide flat
multiplexer is a long chain.

So real memories are trees. Split the address: the high bits choose a block and
the low bits choose within it. Each level is a small decoder or multiplexer, and
the depth grows with the logarithm of the size rather than the size.

That is the same gates-against-delay trade from unit 006, and it is why the
address of a byte in a modern machine is split into pieces at several levels
before it reaches anything that stores a bit. Part V takes that apart properly.
The shape is already here.

## The register that counts

Now a small addition that turns out to be the whole of control flow.

You built a counter two units ago: an increment wired to a register, holding the
next value each cycle. Give that register a second way to be loaded, from an
outside value, chosen by a multiplexer, and it becomes a program counter.

Think about what those two inputs mean. The increment path is "carry on to the
next instruction". The load path is "go somewhere else". A jump is not a
mechanism. It is the load input of a register you already had.

That is why a jump costs the same as not jumping, in a simple machine: both are
one edge into the same register, and the multiplexer chose which value arrived.
Eater's machine makes it visible, where the jump instruction is one step and the
control bits for it are the same load line every other register has.

And a conditional jump needs no branch hardware either. It is the same load,
with its enable ANDed with a flag. Two more wires.

## Two kinds of storage, and why both exist

The registers you have built store a bit in a loop: a multiplexer feeding a
flip-flop, which is several transistors, and it holds its value for as long as
the power is on. That is static memory, and it is what a processor's registers
and caches are made of.

There is a cheaper way. Put a charge on a capacitor and a single transistor to
let you at it. One bit becomes one transistor and one capacitor instead of a
dozen transistors, which is why you can have gigabytes of it rather than
kilobytes.

The catch is in the name of the thing storing the value. A capacitor leaks,
which you already know from unit 001, so the charge drains in milliseconds. The
memory has to be read and written back continuously, row by row, forever, just
to keep saying the same thing. That is what the word dynamic means, and it is
why this kind of memory is busy even when nothing is using it.

Neither is better. One is fast and expensive per bit, the other is slow and
cheap, and a real machine has a hierarchy of both. Part V is about what that
hierarchy does to the cost of reading a number, and it starts from the fact that
every location in this unit costs the same.

## What order things happen in

One detail that trips people, and it is the reading-before-writing rule from
unit 008 wearing different clothes.

If a memory is read and written in the same cycle at the same address, what does
the read return? The old value, because every register in the design captures at
the same edge and shows what it held coming into the cycle. The write takes
effect for the next cycle.

That is not a quirk to work around. It is what makes a whole machine possible: a
value can be read out of a register, sent through an adder, and written back
into the same register in one cycle, precisely because the read sees the old
value while the write prepares the new one.

Every accumulator instruction in every machine relies on that.

## The stack, which is not a new part either

One more use of a counter, because it is the last piece of machinery most
people assume is special and is not.

A stack needs somewhere to put things and a way to remember how far up you are.
The first is memory, which you have. The second is a counter with a load input,
which you also have. Point it at a location, increment it on a push, decrement
it on a pop, and read or write memory at wherever it points.

There is no stack in the hardware. There is a register holding a number, and an
agreement that the number means "the top". Everything that follows from that,
including the whole idea of a call frame in Part V and the reason a runaway
recursion damages something it was not pointing at, comes from the number being
ordinary and nothing enforcing what it points to.

The same is true of every data structure you will meet later. A linked list is
an agreement about what some of the bits in a location mean. Nothing in memory
knows about lists, and nothing in memory knows about anything.

## What to carry into the next unit

A memory is a decoder, a row of registers, a multiplexer and one gate per row.
An address is a position rather than a name. A program counter is a counter with
a load input, so a jump is a parallel load and a conditional jump is that load
with its enable gated by a flag.

You now have everything a machine is made of except a reason for the control
signals to take particular values at particular times. The next unit is about
where those values come from: an instruction is a bit pattern chosen so that its
fields line up with the wires that need driving, and the unit after that is the
loop that fetches one and does what it says.

## Reading the errors you are about to see

These exercises are mostly traces, and several of them have an address input, so
the failing cycle tells you both when and where. Read the address first: a
design that is wrong at one address and right at the others has a decoder
problem, and one that is wrong everywhere at once usually has the load signal
ungated.

The memory exercises are small on purpose. Four one-bit registers is enough to
be a memory and small enough that an exhaustive trace still reads as something a
person can follow.
