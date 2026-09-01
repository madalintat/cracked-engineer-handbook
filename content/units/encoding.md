---
needs: [memory]
minutes: 45
one_idea: An instruction is a bit pattern chosen so that the wires it drives are already in the right places.
sources: [nand2tetris-eater-scott]
---

You have a machine's parts: storage behind an address, registers, a way to move
values between them, an adder, and a counter that can be told where to go. All
of them are controlled by wires, and every wire wants a value each cycle.

An instruction is where those values come from. This unit is about the fact that
choosing the bit patterns is a hardware design problem rather than a naming
exercise.

## What has to be decided

Take a small machine with four registers and an arithmetic unit that can add or
subtract. To do one operation you need to say which operation, which two
registers to read, and which register to write.

That is a handful of small numbers, and an instruction is those numbers written
side by side in a fixed layout.

```figure
{
  "kind": "bits",
  "alt": "An eight-bit instruction divided into a two-bit opcode, a one-bit operation flag, and three two-bit register fields for destination and two sources.",
  "caption": "Eight bits, four fields. Nothing here is a name: each field is a number that goes directly onto the select inputs of a multiplexer or a decoder.",
  "bits": 8,
  "groups": [
    { "from": 6, "to": 7, "label": "op",  "accent": "gold" },
    { "from": 4, "to": 5, "label": "dst", "accent": "azure" },
    { "from": 2, "to": 3, "label": "s1",  "accent": "jade" },
    { "from": 0, "to": 1, "label": "s2",  "accent": "jade" }
  ],
  "brackets": [
    { "from": 0, "to": 5, "label": "three register numbers, straight onto select inputs", "lane": 0 }
  ]
}
```

Now look at where each field goes. The destination number is two bits, and it
goes onto the select inputs of the decoder that produces the write enables. The
two source numbers go onto the select inputs of the two multiplexers that read
the register file. The opcode goes to whatever picks the operation.

The fields are not descriptions of what to do. They are the values those wires
need, laid out so that the wires can be cut straight from the instruction
register with no logic in between.

## Choosing a layout is choosing a circuit

That is why the layout matters and why it is not arbitrary.

Put the destination field in a different place for different instructions and
the decoder needs a multiplexer in front of it to find the right bits. Keep it
in the same place for every instruction and it is a wire. The saving is real and
it repeats for every field.

So an instruction set with a consistent layout is cheaper to build than one
without, and you can see that in real designs: the machines with fixed-width
instructions and fields in the same places are the ones that were designed when
the cost of decoding mattered most.

The opposite pressure is code size. Variable-length instructions let common
operations be short, which mattered enormously when memory was small and matters
again now for a different reason, since instruction bytes travel through the
same caches as everything else. Part V has that argument in full. Here the point
is only that the two pressures are real and pull against each other.

## The bit that splits the world

One trick worth seeing, because it is what makes decoding cheap.

Choose the encoding so that one bit separates two whole families of
instruction. In Scott's machine, bit 0 alone says whether this is an arithmetic
instruction or one of the others. Nothing else needs examining to know which
half of the machine is involved.

When that bit says "not arithmetic", three more bits go into an ordinary
decoder, one line per instruction. When it says "arithmetic", the operation bits
go to the arithmetic unit's controls. Register selection is two more small
decoders on two more fields.

That is the whole decoder. Not a lookup, not an interpreter: a bit that chooses
a half, and a small decoder in each half.

## The half-address problem

A constraint worth meeting now because it explains why some instruction sets
look so strange.

Suppose instructions are sixteen bits and addresses are fifteen. An instruction
that carries an address has one bit left for everything else, which is not
enough to say what to do with it.

nand2tetris resolves that by splitting instructions into two kinds, decided by
the top bit. One kind is nothing but an address, which loads a register. The
other kind is a computation that uses whatever that register is holding. So
addressing a location and operating on it are two instructions, and assembly for
that machine reads oddly for exactly this reason.

Every architecture has some version of this fight. There are never enough bits,
and the resolutions people choose are why one instruction set looks nothing like
another while doing the same work.

## Where the operation bits actually go

It is worth being concrete about the arithmetic half, because it is the clearest
case of an encoding chosen to match a circuit.

Unit 007 built an adder with a control bit that inverts one operand and feeds
the carry, giving add and subtract from one circuit. That control bit is a wire.
An instruction that says "subtract" does not select a subtractor; it puts a 1 on
that wire.

Extend the idea and the pattern is the whole design. Give the arithmetic unit
several control bits, each of which changes what the operands look like on the
way in or what the result looks like on the way out, and the operation field of
the instruction is those bits directly.

That is why nand2tetris's arithmetic unit has six control bits reaching eighteen
useful functions: the instruction does not name an operation from a list, it
sets six switches. The encoding and the circuit were designed together, and the
field in the instruction *is* the control word.

There is a real trade here that the next unit picks up. Wiring instruction bits
straight to control wires is the cheapest possible decoding and it fixes the
instruction set in copper. Putting a small memory between them, so the
instruction is an address into a table of control words, costs a lookup and
makes the instruction set data. Which of those you choose decides whether adding
an instruction means redesigning a chip or reflashing a memory.

## Assembly is not arithmetic

A misconception worth killing here rather than in Part V.

In that machine an instruction is written `D=D+M`, and it looks like an
expression a compiler would parse. It is not. The three characters `D+M` are a
single mnemonic, one entry in a table, and the plus sign plays no algebraic
role. There is no expression parser and no evaluation: the assembler looks up
that exact string and emits the bits it corresponds to.

That is why an assembler for such a machine rejects `M+D`, which means the same
thing arithmetically and is not in the table. Assembly looks like a language
with syntax and is closer to a list of names for bit patterns.

## What the machine understands

The last thing to carry out of this unit, and it is the answer to the question
Scott's book is named for.

The same byte is a letter to a printer, a jump to the instruction register, an
address to the memory, a number to the adder, and three lit pixels to a screen.
Nothing in the byte says which. Each part of the machine was built with a code
in mind, and once it was built, the mind was gone and the code with it.

There is no table of letters anywhere inside a computer. There is a printer
wired so that certain patterns move certain parts, and an agreement, held
entirely by people, that those patterns are letters.

## What to carry into the next unit

An instruction is a bit pattern laid out so its fields are already where the
wires need them. A consistent layout is cheaper to decode than a clever one. One
bit can split the instruction set into halves that share almost no decoding. And
nothing in the machine knows what any of it means.

The next unit is the last in this part, and it is the loop that ties everything
together: fetch the instruction at the counter, put its fields onto the wires,
let the machine settle, capture the results, advance the counter, repeat. That
loop is the computer, and the component that drives it turns out to be the least
clever thing in the design.

## Reading the errors you are about to see

These exercises are field extraction and decoding, which in this simulator means
routing particular input bits to particular outputs and building small decoders
from them.

Read a failing row as an instruction rather than as a list of bits. If a design
is wrong for exactly the rows where one field is nonzero, that field is wired to
the wrong place, and that is a more useful thing to know than which row failed.
