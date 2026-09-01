## How many clock cycles does one instruction take on the machine in this unit?

- [x] Several, because fetching and executing cannot both settle in one edge
- [ ] One, that is what a clock edge is for
- [ ] One per gate on the longest path
- [ ] It depends on the opcode alone

@why An edge means everything has settled. A value cannot be read out of memory
and then used in the same settling, so the fetch is its own step and the work
that follows is another.

## Which steps are identical in every instruction?

- [x] The first two, which are always the fetch
- [ ] None, every opcode is its own sequence
- [ ] The last two, which are always the writeback
- [ ] All of them except the one the opcode names

@why Put the counter's value on the address lines and read that location into
the instruction register. Every instruction pays for it, which is what the
caches in Part V are trying to hide.

## What is the stepper made of?

- [x] The same storage bits as a register, arranged to walk a single 1
- [ ] A dedicated sequencer cell that has no equivalent elsewhere
- [ ] A read-only memory addressed by the opcode
- [ ] A shift register clocked at a multiple of the system clock

@why Scott is worth quoting on this: nothing new is added to the machine. The
bits are the same bits, and the arrangement is what makes them a series of
steps rather than a value.

## In the stepper you built, where does step 0 come from?

- [x] It is high when no other step is
- [ ] It is stored in its own flip-flop like the others
- [ ] It is the inverse of the last step
- [ ] It is driven by the reset line

@why That is what makes the ring self-starting. Every flop comes up holding 0,
so if step 0 were stored it would come up low as well, and nothing would ever
be high enough to start the walk.

## What is Eater's control unit physically made of?

- [x] Two read-only memories holding the control words
- [ ] A tree of gates decoding the opcode
- [ ] A programmable logic array
- [ ] A small processor running microcode

@why The address lines are the flags, the opcode, the step and a byte select.
The data lines are the sixteen control bits. No gates decode instructions: you
look up the control word.

## If the decoder is a memory, what is the instruction set?

- [x] The contents of that memory, which can be rewritten
- [ ] A property of the wiring, fixed once the board is soldered
- [ ] A convention the assembler enforces and the hardware ignores
- [ ] The set of opcodes the stepper has enough steps for

@why Adding an instruction is writing new rows into the table. Reflashing it
with a different table makes it a different computer with the same wires, which
is the argument for microcoded control in one demonstration.

## Why does the word firmware exist?

- [x] Something can be data and still behave like wiring
- [ ] Software stored in a place the user cannot reach counts as hardware
- [ ] It names the layer between the driver and the kernel
- [ ] Early machines shipped their software in the same box as the hardware

@why A table of control words is exactly that: contents rather than copper,
but read by the machine at the rate copper is read and changed about as often.

## In a control word, how many of the bits that put something on the bus may be set at once?

- [x] Exactly one
- [ ] Any number, the bus takes the or of them
- [ ] Any number, the last one to settle wins
- [ ] At most two, and only if they agree

@why Two outputs driving one wire to different voltages is a short circuit
through the output transistors of both. This is the constraint the tri-state
buffer exists to enforce.

## How many of the bits that capture from the bus may be set at once?

- [x] Any number, because reading a wire costs the wire nothing
- [ ] Exactly one, for the same reason as the drivers
- [ ] One per clock domain
- [ ] None during a fetch

@why Loading the same value into two registers in one step is legal and
occasionally useful. The asymmetry with the driver bits is electrical, not
logical.

## What happens when a control table sets two driver bits in the same step?

- [x] The bus reads as something and that reading is a fight
- [ ] The simulation halts with a bus contention error
- [ ] The higher-priority driver wins deterministically
- [ ] The bus floats and reads as neither value

@why Nothing obviously fails, which is what makes it hard. The check has to
live in whatever writes the table, because on the wire the fault is heat.

## How is a conditional branch built in this machine?

- [x] The flags address the control memory, so the table has four copies and a few cells differ
- [ ] A comparator drives a dedicated branch unit
- [ ] The stepper skips ahead by a number of steps the flags select
- [ ] The counter is loaded and then rolled back if the condition fails

@why Not a comparator and not a branch unit. Two more address lines, four
copies of the same table, and the load-the-counter bit set in the copies where
the branch should be taken.

## Why is a machine without a data-dependent branch not a computer?

- [x] It can only run a fixed sequence, so it cannot loop for as long as the data says
- [ ] It cannot address memory beyond the instruction stream
- [ ] It has no way to return from a subroutine
- [ ] It cannot be programmed, only configured

@why Loading, adding and printing in a fixed order is a calculator. The moment
the next instruction can depend on a value, the machine is general.

## When are the flags captured?

- [x] Only during the step where the arithmetic happens
- [ ] On every clock edge, so they always show the adder
- [ ] At the end of each instruction
- [ ] Whenever the control word asks the adder for a result

@why By the time a conditional jump executes, the arithmetic that produced its
flags is several steps in the past and the adder's inputs have changed. If the
flags were not stored they would be gone.

## What goes wrong without a way to clear the flags?

- [x] A carry left over from an earlier instruction feeds the next addition
- [ ] The flags saturate and stop responding to the adder
- [ ] A branch taken once is taken every time afterwards
- [ ] The stepper cannot return to step 0

@why Scott's one-line summary of the bug is the best one: you might add two and
two and get five. Nothing reports a fault, because nothing has failed.

## Do NAND gates know what they are doing?

- [x] No, and a million of them together know no more than one
- [ ] Individually no, but the decoder is where knowing begins
- [ ] Yes, in the sense that they implement a decision
- [ ] The question is not answerable from inside the machine

@why A computer remembers, decides and understands in exactly the sense that a
river decides which way to go around a rock. There is nothing wrong with the
vocabulary as long as you know what is under it.
