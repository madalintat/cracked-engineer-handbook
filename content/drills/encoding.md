## What is an instruction, physically?

- [x] A bit pattern whose fields are the values particular wires need
- [ ] A command the processor looks up and interprets
- [ ] A name the decoder translates into operations
- [ ] A sequence of microcode addresses

@why The fields are not descriptions of what to do. They are laid out so the
wires can be cut straight from the instruction register with no logic between.

## Where does a destination register field go?

- [x] Onto the select inputs of the decoder that produces the write enables
- [ ] Into a table that maps numbers to registers
- [ ] Into a comparator against each register's identifier
- [ ] Into the arithmetic unit

@why The field is not a name for a register, it is the number that lights that
register's line. That is unit 006 arriving inside an instruction set.

## Why does keeping a field in the same place across instructions matter?

- [x] It makes the field a wire; moving it needs a multiplexer to find it
- [ ] It makes the instructions easier to read
- [ ] Assemblers require it
- [ ] It has no cost either way

@why And the cost repeats for every field and every instruction, which is why
fixed layouts exist and why the machines designed when decoding cost most have
the most regular ones.

## What pressure pushes against a fixed, regular layout?

- [x] Code size, since variable-length instructions let common operations be
      short
- [ ] Clock frequency
- [ ] The number of registers
- [ ] Power consumption in the decoder

@why It mattered enormously when memory was small and matters again now,
because instruction bytes travel through the same caches as everything else.

## What does one bit splitting the instruction set into families buy?

- [x] Neither half needs to examine the other's fields
- [ ] Twice as many instructions
- [ ] A shorter instruction word
- [ ] Backwards compatibility

@why Nothing else needs examining to know which half of the machine is
involved, and it costs about two gates.

## The decoder for the non-arithmetic half is:

- [x] A small ordinary decoder, gated by the family bit
- [ ] A lookup table in memory
- [ ] A state machine
- [ ] A microcode sequencer

@why Three bits into a decoder is the entire non-arithmetic decode in Scott's
machine. Not a lookup, not an interpretation.

## In a machine whose arithmetic unit has six control bits, the operation field is:

- [x] Those six bits, set directly by the instruction
- [ ] An index into a table of eighteen operations
- [ ] A name the decoder resolves
- [ ] A pointer to microcode

@why The instruction sets switches rather than naming an operation. The
encoding and the circuit were designed together, and the field *is* the control
word.

## What does putting a small memory between instruction bits and control wires buy?

- [x] The instruction set becomes data, so adding an instruction is reflashing
      rather than redesigning
- [ ] Faster decoding
- [ ] Smaller instructions
- [ ] Fewer control wires

@why It costs a lookup. Wiring the bits straight through is cheaper and fixes
the instruction set in copper, and which you choose decides what changing the
machine means.

## Why can a sixteen-bit instruction not carry a fifteen-bit address and an opcode?

- [x] There is one bit left, which is not enough to say what to do with the
      address
- [ ] Addresses must be aligned
- [ ] The instruction register is only fifteen bits
- [ ] It can, using a prefix byte

@why nand2tetris splits instructions into two kinds decided by the top bit, so
addressing a location and operating on it are two instructions. That is why its
assembly reads oddly.

## In `D=D+M`, the plus sign is:

- [x] Part of a single mnemonic that the assembler looks up in a table
- [ ] An operator the assembler evaluates
- [ ] A separator between operands
- [ ] A hint to the optimiser

@why Which is why such an assembler rejects `M+D`. It means the same thing
arithmetically and is not in the table.

## Assembly language is closest to:

- [x] A list of names for bit patterns
- [ ] A programming language with expressions
- [ ] A description of what the hardware should do
- [ ] Machine code with the numbers written differently

@why The last one is nearly right and misses the point: the names exist for
people, and there is no expression parser and no evaluation anywhere.

## The same byte reaching a printer, an instruction register and an adder means:

- [x] A letter, a jump and a number, and nothing in the byte says which
- [ ] Three things the byte encodes at once
- [ ] Whatever a type tag alongside it says
- [ ] The same thing in three notations

@why Each part was built with a code in mind, and once it was built the mind
was gone and the code with it.

## Where is the table that maps byte values to letters?

- [x] Nowhere in the machine. It is an agreement held by people
- [ ] In the printer's firmware
- [ ] In the operating system
- [ ] In a read-only memory on the processor

@why There is a printer wired so certain patterns move certain parts. Calling
those patterns letters is something we do, not something it does.

## Recognising one particular instruction costs:

- [x] An AND of the bits that identify it
- [ ] A comparison against a stored opcode
- [ ] A lookup in the decode table
- [ ] A dedicated comparator per instruction

@why The control unit is a collection of those gates, which is why the next
unit calls it the least clever component in the machine.

## Two parts of a machine reading the same bits differently happens because:

- [x] They are wired differently, and nothing in the bits distinguishes them
- [ ] A tag bit tells each part what to expect
- [ ] The decoder routes the bits to one part at a time
- [ ] Only one part is powered at once

@why Both readings happen at once, all the time, on the same wires. What makes
one of them matter is which result gets captured.
