---
needs: [encoding]
minutes: 50
one_idea: The component that turns a pile of parts into a computer is a lookup table and a counter, and it is the least clever thing in the design.
sources: [nand2tetris-eater-scott]
---

You have every part. Storage behind an address, registers, routing, an adder, a
counter that can be told where to go, and an instruction format whose fields sit
where the wires need them.

What is missing is a reason for the control wires to take particular values in a
particular order. That is this unit, and the answer is smaller than people
expect.

## An instruction is not one thing that happens

The first correction. An instruction does not happen in a clock tick.

Fetching it is a memory read, which takes a cycle. Getting its operands out of
registers is another. Doing the arithmetic and capturing the result is another.
Nothing in the machine can do all of that at one edge, because the whole point
of an edge is that everything must have settled by then, and a value cannot be
read out of memory and used in the same settling.

So an instruction is several steps, and the machine needs something that walks
through them. Eater's machine has five steps per instruction, with the first two
identical in every single instruction: put the counter's value on the address
lines, and read that location into the instruction register while advancing the
counter.

Every instruction pays for the fetch. That is not a design flaw, it is what
fetching means, and it is the constant cost that everything in Part V is trying
to hide.

## The thing that walks

The stepper is a counter, and its output is a set of one-hot lines: step 0, step
1, step 2, and so on. You built the counter in unit 008 and the decoder in unit
006.

Scott is worth quoting on what it is made of: the same memory bits as the
registers, "arranged very differently... We are not going to store anything in
these bits, we are going to use them to create a series of steps." Nothing new
is added. A ring of storage with an arrangement that walks a single 1 along it.

At the end of an instruction the stepper resets to zero and the next fetch
begins. That is the loop.

```figure
{
  "kind": "blocks",
  "alt": "The fetch-execute loop as four boxes in a ring: the counter names an address, memory returns an instruction, the decoder drives control wires, the machine settles and captures, and the counter advances.",
  "caption": "The whole computer. Everything else in Part II is a box in this picture, and the loop is what makes the pile of parts into a machine that runs a program.",
  "boxes": [
    { "id": "pc",   "x": 0,   "y": 1.4, "w": 3, "h": 1.2, "label": "counter", "sub": "names an address", "accent": "gold" },
    { "id": "mem",  "x": 4.4, "y": 1.4, "w": 3, "h": 1.2, "label": "memory", "sub": "returns a pattern", "accent": "copper" },
    { "id": "dec",  "x": 8.8, "y": 1.4, "w": 3, "h": 1.2, "label": "decoder", "sub": "drives the wires", "accent": "azure" },
    { "id": "work", "x": 13.2, "y": 1.4, "w": 3, "h": 1.2, "label": "settle", "sub": "and capture", "accent": "jade" },
    { "id": "step", "x": 6.6, "y": 3.6, "w": 3, "h": 1.2, "label": "stepper", "sub": "then back to zero" }
  ],
  "arrows": [
    { "from": "pc",   "to": "mem" },
    { "from": "mem",  "to": "dec" },
    { "from": "dec",  "to": "work" },
    { "from": "work", "to": "step" },
    { "from": "step", "to": "pc", "label": "advance" }
  ]
}
```

## The decoder is a lookup table

Now the part that disappoints people, and it should.

The control unit's job is: given the instruction and the step, produce the value
of every control wire. That is a function from a small number of bits to a wider
number of bits, and the cheapest way to build such a function is a memory.

Eater's control unit is two read-only memories. The address lines are the flags,
the opcode, the step number and a byte select. The data lines are the sixteen
control bits. No gates decode instructions. You look up the control word.

That is the entire component. It is a table, and the table is the machine's
behaviour.

Which leads somewhere that matters more than it first appears.

## What is actually in a control word

The sixteen bits are not arbitrary. Most of them fall into two groups, and the
groups have opposite rules.

One group says what goes onto the bus. Exactly one of those bits may be set at
a time, and the reason is electrical rather than logical: two outputs driving
the same wire to different voltages is a short circuit through the output
transistors of both. This is the whole purpose of the tri-state buffer from unit
007, and the constraint it enforces is the one a control table can violate
silently. The bus reads as something, so nothing obviously fails, and what it
reads is a fight.

The other group says what captures from the bus. Any number of those may be set,
because reading a wire costs the wire nothing. Loading the same value into two
registers in one step is legal and occasionally useful.

The rest are single-purpose: which operation the arithmetic unit performs, and
whether the flags are captured this step.

So a control word is one selection and a set of loads, and almost every bug in a
handwritten table is one of two shapes. Two drivers in one step, which is the
short. Or a load bit set one step early, which captures the bus before the value
it wanted has arrived on it.

## The instruction set is data

If the decoder is a memory, then the instruction set is the contents of a
memory, and contents can be changed.

Adding an instruction to that machine is writing new rows into the table.
Reflashing it with a different table makes it a different computer with the same
wires. Eater does exactly this on camera, and it is the argument for microcoded
control over hardwired control in one demonstration: hardwired is faster and
fixed in copper, microcoded is slower and is data.

That trade has been made both ways repeatedly, and it is why the word firmware
exists. Something between hardware and software, which is exactly what a table
of control words is.

## A conditional branch, with no branch hardware

Watch how little it takes.

The flags from the arithmetic unit become two more address lines on the control
memory. The table now has four copies of itself, one per flag combination, and
in exactly the copies where the branch should be taken, the cells for the jump
instruction have the load-the-counter bit set.

That is the whole mechanism. Not a comparator, not a branch unit: four copies of
a table with a handful of cells different.

And it is why a machine without a data-dependent branch is not a computer.
Loading, adding and printing in a fixed order is a calculator. The moment the
next instruction can depend on a value, the machine can loop for as long as the
data says, and that is the line that makes it general.

## When flags may be read

A timing detail with real consequences, and it is the reading-before-writing
rule again.

The flags are captured only during the step where the arithmetic happens.
By the time a conditional jump executes, the arithmetic that produced its flags
is several steps in the past and the adder's inputs have long since changed. If
the flags were not stored, they would be gone.

And there is a matching problem in the other direction: a stale carry left over
from a previous instruction feeding into the next addition. Scott's machine has
an explicit clear-flags operation for exactly this, and his description of what
happens without it is the best one-line summary of the bug: you might add two
and two and get five.

## What this machine is not

Worth stating plainly at the end of a part that has built a computer from a
single gate.

Nobody has built this exact machine. Real ones have wider registers, barrel
shifters, hardware multipliers, many more registers, and a state machine where
this has a stepper. The pieces here are the real pieces, simplified until they
fit in a book.

And the answer to the question this part has been circling. NAND gates do not
know what they are doing. If one gate knows nothing, a million of them know
nothing. A computer remembers, decides and understands in exactly the sense that
a river decides which way to go around a rock.

There is nothing wrong with the vocabulary as long as you know what is under it,
and now you do: a switch that leaks, a gate that inverts, a loop with a clock in
it, an address that is a position, and a table of control words being read one
row at a time.

## What to carry into Part III

You built a computer from one gate, and the last component was a counter and a
lookup.

Part III does the same work in a language a synthesiser understands, and finds
out what a clock period actually buys you. The parts will be the same and the
questions will be different: not what does this compute, but how fast can it be
clocked, how much area does it take, and can it be proved equivalent to a
reference rather than merely tested against one.

## Reading the errors you are about to see

These exercises build the stepper, a control lookup, and the branch mechanism.
Several are traces, and the interesting cycle is usually the one after a control
signal changes rather than the one during it.

The control-word exercises are truth tables that look like documentation, and
that is the point: a control unit is a table, so an exercise about one is a
table too. If a row disagrees, read the instruction and the step it names and
ask what should be on the wires at that moment.
