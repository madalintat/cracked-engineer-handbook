---
needs: [nand]
minutes: 45
one_idea: A control signal is an ordinary wire, and choosing is the same operation as addressing.
sources: [nand2tetris-eater-scott]
---

You have every two-input function. This unit builds one particular part out of
them, and that part turns out to be most of a computer.

Here is the claim, and it should sound too strong. Choosing between two values,
selecting which register to write, decoding an instruction, and reading a
location out of memory are all the same circuit at different widths. Nothing new
gets invented for any of them.

## The part

A multiplexer passes one of its data inputs through, chosen by a third input.
When `sel` is 0 the output follows `a`; when it is 1 it follows `b`.

```figure
{
  "kind": "gates",
  "alt": "A multiplexer built from an inverter and three NAND gates, with the select signal gating each data input before the two are combined.",
  "caption": "Four gates. The select signal is wired into the logic exactly like the data is, and nothing in the circuit distinguishes them.",
  "nodes": [
    { "id": "a",   "type": "in",   "x": 0, "y": 0, "label": "a" },
    { "id": "s",   "type": "in",   "x": 0, "y": 1, "label": "sel" },
    { "id": "b",   "type": "in",   "x": 0, "y": 2, "label": "b" },
    { "id": "inv", "type": "not",  "x": 1, "y": 1, "label": "" },
    { "id": "ga",  "type": "nand", "x": 2, "y": 0, "label": "" },
    { "id": "gb",  "type": "nand", "x": 2, "y": 2, "label": "" },
    { "id": "out", "type": "nand", "x": 3, "y": 1, "label": "" },
    { "id": "y",   "type": "out",  "x": 4, "y": 1, "label": "out" }
  ],
  "wires": [
    { "from": "s", "to": "inv" },
    { "from": "a", "to": "ga" },
    { "from": "inv", "to": "ga", "label": "not sel" },
    { "from": "b", "to": "gb" },
    { "from": "s", "to": "gb" },
    { "from": "ga", "to": "out" },
    { "from": "gb", "to": "out" },
    { "from": "out", "to": "y" }
  ]
}
```

Gate each input with the select signal in the polarity you want, then combine
the two. Four gates, and you will build it in the first exercise.

Now look at what the circuit thinks `sel` is. It is a wire, into a NAND, like
every other wire. There is no control input on a NAND gate, no separate
mechanism for a signal that means something rather than being something.

That is the sentence to keep. **Control is data.** A control signal is an
ordinary input routed somewhere that changes what the rest of the circuit does,
and the only difference between a control wire and a data wire is what a human
decided to call it.

## Running it backwards

Reverse the multiplexer and you get its dual. A demultiplexer takes one input
and a select signal, and routes the input to one of several outputs while
holding the others at zero.

Same idea, same gates, opposite direction. And between them they are the two
halves of every routing decision in a machine: a multiplexer chooses which value
arrives somewhere, a demultiplexer chooses where a value goes.

When Part II gets to registers, "which register do I write to" is a
demultiplexer on the write-enable signal, and "which register do I read from" is
a multiplexer on the outputs. Not something like them. Those parts.

## The one-line version, and why it is a lie

It is tempting to write the multiplexer as a sentence: if `sel` then `b` else
`a`. That sentence is true about what the circuit computes and false about what
the circuit is, and the difference matters more here than almost anywhere else
in this handbook.

An `if` in a program chooses which code to run. One branch executes and the
other does not. A multiplexer does not choose which gates to run, because
running is not a thing gates do. All four gates are always powered, both data
inputs are always propagating, and both partial results are always being
computed. The select signal decides which of two answers reaches the output, and
the other answer is computed and discarded, every time, at full cost.

That is worth holding onto for two reasons.

It is why a branch on a GPU costs both sides, twelve parts from here. That is
usually presented as a surprising property of graphics hardware, and it is
closer to the default behaviour of logic: computing both and discarding one is
what a circuit does naturally, and a processor that skips work has to be built
specially to do it.

And it is why "the ALU runs when you tell it to" is a misconception worth
naming now. An arithmetic unit is combinational. It is always computing, on
whatever its inputs happen to be, including garbage. A control signal does not
start it. A control signal decides whether anyone reads the answer.

## Widening it

Two data inputs need one select bit. Four need two, eight need three, and in
general `2^k` inputs need `k` bits of select.

That relationship is worth stating deliberately, because it is where the word
address comes from. A four-way multiplexer's select input is a two-bit number,
and that number picks which input is passed through. The number is not a name
for the input. It is a position among them.

Scott's book puts it as sixteen unnumbered streets with sixteen unnumbered
houses. The fourth house on the seventh street still locates a house, and no
plaque is needed on the door. **An address is a position, not a name.**

Nothing in the circuit stores an address. There is no table of addresses
anywhere. There is a tree of multiplexers, and the address bits are the select
signals on that tree.

## Building a wide one

Two ways to build a four-way multiplexer, and they are worth comparing because
the comparison generalises.

Build it from three two-way ones: two of them choose between pairs using the low
select bit, and a third chooses between those two results using the high bit.
Twelve gates and two stages of delay.

Or build it flat, decoding the two select bits into four one-hot lines and
gating each input with its line. That costs more gates and one fewer stage.

Both are correct and they trade the same way as everything in the last part:
gates against delay. The tree scales better, which is why a memory of any real
size is a tree rather than a flat decode.

## Where the address bits go

One more construction, and it is the one that makes memory make sense.

A decoder takes `k` bits and raises exactly one of `2^k` outputs. Two bits in,
four lines out, exactly one of them high. That is a demultiplexer with its data
input held at 1, which is the kind of observation that looks like a trick and is
just the same circuit being used differently.

Every addressed thing in a computer is a decoder driving a set of enables, and a
multiplexer collecting the results. A memory is that pattern with storage
between the two halves, and Part II builds the storage four units from here.
Until then, this is the whole mechanism.

## The other thing a mux is for

There is a second use, and it is the one that makes the next few units
possible at all.

A multiplexer whose two inputs are "the value currently here" and "the value
arriving" is a hold-or-load. Put the select signal on it and call that signal
`load`, and you have described a storage element without having built one: when
`load` is 0 the output is whatever it already was, and when `load` is 1 the
output is the new value.

Read that again, because there is something missing. "Whatever it already was"
is the output feeding back into the input, and a loop with no clock in it is the
error the simulator rejected in the last unit. The circuit is not wrong. It is
incomplete, and what it is missing is a clock edge.

That is the whole content of unit 008, and the diagram is the most valuable one
in nand2tetris: a register is not a flip-flop with its output tied to its input,
because then there is no way to ever load a new value into it. It is a
multiplexer in the loop, and the multiplexer's select bit is what `load` means.

So the part you build in the first exercise here is the part that turns a
flip-flop into a register three units from now. Nothing new gets added. The
routing you build today is the mechanism, and the clock is the permission.

## What this means for what comes next

There is no interpreter anywhere. When the machine reads an instruction and does
what it says, no part of it looks up a meaning. Some bits of the instruction are
wired to select inputs on multiplexers, and different values on those wires
route different things to different places.

That is what a decoder is, and it is why the unit on control ends up being
shorter than you would expect. Scott's answer to the question in his title is
that the machine does not know anything: NAND gates do not know what they are
doing, and a million of them connected together still do not.

The exercises here build the multiplexer, its dual, a wide one both ways, and a
decoder. By the end you will have the routing half of a computer, and it will be
four parts.

## Reading the errors you are about to see

The simulator checks your design against an exhaustive truth table, so a
mismatch names the exact input row that disagreed. That is more useful than it
sounds: with a select signal, the interesting rows are the ones where the two
data inputs differ, because those are the only rows where the select does
anything at all.

A floating input means a wire is read and never driven, and it stays an error
here for the same reason as in the last unit. If your inverted select signal
needs a name, it needs an assignment.
