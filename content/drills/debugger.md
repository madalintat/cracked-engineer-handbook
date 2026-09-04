## What is a Unix debugger built out of?

- [x] One system call, multiplexed over a dozen requests, plus bookkeeping in userspace
- [ ] A kernel debugging subsystem the debugger attaches to
- [ ] A library the traced program has to be linked against
- [ ] A virtual machine the program runs inside

@why There is no debugger subsystem. Read and write memory, read and write
registers, resume, single step, and wait: everything else is built from those.

## How is a breakpoint installed on x86?

- [x] The first byte at the address is replaced with a one byte trap instruction
- [ ] The address is written to a kernel table of breakpoints
- [ ] The page is marked non-executable so access faults
- [ ] The instruction is replaced with a jump to the debugger

@why The trap byte's entire purpose is to raise a debug trap. Installing a
breakpoint is a read of one word and a write of one word.

## Where is the instruction pointer when a breakpoint trap is taken?

- [x] One past the breakpoint, because the trap byte was executed and consumed
- [ ] At the breakpoint address
- [ ] At the start of the next instruction after the original one
- [ ] Wherever the previous jump left it

@why The debugger has to read the registers, subtract one and write them back.
Without that the program resumes into the middle of an instruction.

## What does resuming from an armed breakpoint require?

- [x] Restore the original byte, single step one instruction, write the trap byte again, continue
- [ ] Continue, since the trap has already been consumed
- [ ] Remove the breakpoint and reinstall it at the next hit
- [ ] Rewrite the whole page and flush the instruction cache

@why That dance is several system calls and two context switches on every hit,
which is why a breakpoint in a hot loop feels like a hang.

## Why is timing a program under a debugger meaningless?

- [x] Breakpoints modify the program's instructions and every hit costs system calls and context switches
- [ ] The debugger runs the program at a lower priority
- [ ] Debug information makes the binary larger and slower
- [ ] The kernel disables the cache while a process is traced

@why It also means anything that checksums its own code notices that its text
has changed.

## How many hardware watchpoints does x86-64 have, and how wide is each?

- [x] Four, each covering at most eight bytes
- [ ] Eight, each covering one page
- [ ] One per general purpose register
- [ ] As many as memory allows; they are a kernel structure

@why Small, fixed, and worth remembering, because exceeding it does not produce
an error.

## What happens when you ask to watch something that does not fit in the debug registers?

- [x] The debugger silently falls back to single stepping the whole program and re-checking after every instruction
- [ ] It reports that no watchpoint registers are available
- [ ] It watches the first eight bytes and ignores the rest
- [ ] It sets a breakpoint on every function that could write to it

@why The manual describes the fallback as hundreds of times slower than normal
execution. Someone who does not know about it concludes the debugger has hung.

## Why is optimised code harder to debug?

- [x] The question becomes ambiguous: a variable may be in a register with no address, an inlined function has no frame, and one instruction can belong to two lines
- [ ] The compiler stops emitting debug information above `-O0`
- [ ] Optimised code cannot have breakpoints installed in it
- [ ] The debug tables are compressed and only partly readable

@why The tables are telling the truth about a program whose shape no longer
matches the source you are reading.

## What is a sanitizer?

- [x] A compiler pass that rewrites the program to check itself, plus a runtime that keeps the metadata
- [ ] A library that replaces the allocator at load time
- [ ] A separate process that watches the program's memory
- [ ] A static analysis run before compilation

@why That is why it needs a recompile, why uninstrumented code is invisible to
it, and why it is far faster than a tool working from the binary alone.

## What is the address sanitizer's shadow mapping?

- [x] Eight application bytes map to one shadow byte, found by shifting right three and adding an offset
- [ ] Each byte has a shadow byte, in a parallel region
- [ ] Each allocation has a header describing its state
- [ ] Each page has a descriptor in a side table

@why A shift and an add, which is why the check in front of every load and
store is cheap enough to leave on.

## A shadow byte holds the value 4. What does that mean?

- [x] The first four of those eight bytes are addressable and the last four are not
- [ ] Four of the eight are poisoned, in unspecified positions
- [ ] The block was freed four allocations ago
- [ ] Four bytes of redzone follow

@why The partial case works only because allocations are eight byte aligned, so
a block can be partial at its end and never at its start.

## What does a negative shadow byte encode?

- [x] All eight bytes are poisoned, and the value says why: a redzone, freed memory, use after return, and so on
- [ ] The number of bytes that overflowed
- [ ] A pointer into the allocator's metadata
- [ ] That the region has never been touched

@why Those values are what the legend in a sanitizer report is decoding for
you.

## What is a redzone for?

- [x] Padding around every allocation, poisoned, so a small overflow lands somewhere already marked bad
- [ ] Extra space so the allocator can grow a block in place
- [ ] Memory reserved for the sanitizer's own bookkeeping
- [ ] A region where allocations are deliberately slow, to expose races

@why Without it, an overflow of one element lands in the next object, where it
is silent and corrupts real data.

## How does the address sanitizer catch use after free at all?

- [x] Freed blocks are poisoned and held on a queue instead of being reused immediately
- [ ] Every pointer is checked against a table of live allocations
- [ ] Freed pages are unmapped, so any access faults
- [ ] The compiler proves that no pointer outlives its allocation

@why Not reusing the address is what keeps the shadow byte saying freed rather
than describing whatever was allocated there next.

## What does a clean address sanitizer run prove?

- [x] That no violation happened inside the detection window, on the paths this run took, in code that was recompiled
- [ ] That the program has no memory errors
- [ ] That the program has no use after free, though it may have overflows
- [ ] Nothing at all, since the instrumentation changes the program

@why The quarantine gives a window measured in allocation traffic. Beyond it the
address is handed out again and the bug is silent, so this is a detector rather
than a proof.
