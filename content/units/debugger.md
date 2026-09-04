---
needs: [syscalls, elf]
minutes: 55
one_idea: A debugger is one system call and a lot of bookkeeping, a breakpoint is a byte of your program overwritten with a trap, and a sanitizer is a compiler pass that makes a silent bug loud by keeping a second map of what your memory means.
sources: [debugging-and-measurement]
---

There is no debugger subsystem in the kernel. There is one system call,
multiplexed over a dozen requests, and everything a debugger does is built out
of it plus a great deal of bookkeeping in userspace.

That call lets one process control another: read and write its memory, read and
write its registers, resume it, resume it for exactly one instruction, and wait
for it to stop. Nothing in that list mentions a line of source, a variable name
or a type. Every one of those is reconstructed by the debugger from information
the compiler left behind.

The transcripts below are from a small tracer running on Compiler Explorer, and
from gcc and clang with the sanitizers turned on.

## A breakpoint is a byte

On x86 there is a one byte instruction whose only purpose is to raise a debug
trap. Setting a breakpoint at an address means putting that byte there.

Read the word at the address and keep the original first byte. Write the word
back with that byte replaced by the trap. Resume. When control reaches the
address the processor raises the trap, the kernel turns it into a signal, and
the debugger's wait returns.

```figure
{
  "kind": "blocks",
  "alt": "A breakpoint cycle: read the original word, write it back with the first byte replaced by the trap byte, continue, take the trap, then back the instruction pointer up by one before reporting the stop.",
  "caption": "The instruction pointer is one past the breakpoint when the debugger regains control, because the trap byte has already been consumed. Backing it up by one is not a detail; without it the program resumes into the middle of an instruction.",
  "boxes": [
    { "id": "r", "x": 0,    "y": 0, "w": 3.0, "h": 1.1, "label": "read word", "accent": "slate" },
    { "id": "p", "x": 3.8,  "y": 0, "w": 3.4, "h": 1.1, "label": "poke 0xCC", "accent": "gold" },
    { "id": "t", "x": 8.0,  "y": 0, "w": 3.0, "h": 1.1, "label": "trap", "accent": "clay" },
    { "id": "b", "x": 11.8, "y": 0, "w": 3.2, "h": 1.1, "label": "rip minus 1", "accent": "jade" }
  ],
  "arrows": [
    { "from": "r", "to": "p" },
    { "from": "p", "to": "t" },
    { "from": "t", "to": "b" }
  ]
}
```

Here is a real tracer stopping three times on the same function:

```
[dbg] original word = 0x10ec8348e5894855   first byte 0x55, a push
[dbg] patched  word = 0x10ec8348e58948cc   low byte replaced
[dbg] SIGTRAP #1  rip=0x401177 (bp+1)  rdi=0
[dbg] SIGTRAP #2  rip=0x401177 (bp+1)  rdi=1
[dbg] SIGTRAP #3  rip=0x401177 (bp+1)  rdi=2
```

Two things in that transcript are the whole lesson. The instruction pointer is
one past the breakpoint every time, because the trap byte was executed and
consumed, so the debugger has to read the registers, subtract one, and write
them back before it can do anything else. And the register holding the first
argument reads 0, then 1, then 2, straight out of the register file according to
the calling convention. That is a debugger printing a function argument, with no
library involved at all.

Resuming is the awkward part. The original byte has to go back, the processor
has to step exactly one instruction, then the trap byte is written again, and
only then can the program continue. Every hit of a breakpoint is that dance, and
it costs several system calls and a pair of context switches, which is why a
breakpoint in a hot loop feels like a hang.

Two consequences follow directly. A breakpoint modifies your program's
instructions, so anything that checksums its own code notices. And timing under
a debugger means nothing at all.

## Four registers, and the cliff behind them

A watchpoint stops the program when a particular address is written. The
processor can do this in hardware: there are four debug address registers, and
the check happens in the path a load or a store already takes, so it costs
nothing while the program runs.

Four, each covering at most eight bytes. That is the entire budget.

Ask to watch a fifth variable, or a structure larger than eight bytes, and the
debugger does not refuse. It falls back to a software watchpoint, which means
single stepping the whole program and re-evaluating the expression after every
single instruction. The manual's own description is hundreds of times slower
than normal execution, and someone who does not know about the fallback
concludes that the debugger has hung.

Knowing the size of the budget is the useful part. Watch a four byte counter and
you are in hardware. Watch a large structure and you have quietly asked for
something else entirely.

## What turns an address into a name

None of the above knows anything about your source. The mapping from an address
to a file and line, from a stack frame to a function, and from a name to a
location that may be a register at one instruction and a stack slot at the next,
lives in debug information the compiler emitted alongside the code.

That is why an optimised build is harder to debug, and the reason is worth
stating precisely. It is not that the information is missing. It is that the
question has become ambiguous: a variable that was optimised into a register has
no address, an inlined function has no frame, and an instruction can belong to
two source lines because the scheduler interleaved them. The debugger reports
what the tables say, and the tables are telling the truth about a program whose
shape no longer matches the source you are reading.

## The other kind of tool

A debugger watches a program from outside and answers questions when you ask.
That is the wrong shape for a bug that happens once in a thousand runs and
corrupts something quietly.

A sanitizer is the other approach: a compiler pass that rewrites your program to
check itself, plus a runtime library that keeps the metadata those checks
consult. Three consequences follow immediately. It needs a recompile. Code that
was not recompiled is invisible to it. And it is far faster than a tool that has
to work all this out from the binary alone, because the compiler already knew
where every variable was.

## Shadow memory, in one formula

The address sanitizer keeps a second map of memory that says what each byte
means. Eight bytes of your program map to one byte of shadow, and the mapping is
a shift and an add:

```
shadow = (address >> 3) + offset
```

The value in that shadow byte is the whole design. Zero means all eight bytes
are usable. A small positive number `k` means the first `k` bytes are usable and
the rest are not, which works only because allocations are eight byte aligned,
so a partial block can only be partial at its end. A negative value means all
eight are poisoned, and the particular value says why: a redzone before a heap
block, freed memory, a stack redzone, use after return, a global's redzone.

Every load and store in your program gets a check inserted in front of it: look
up the shadow byte, and if it is not clear, report. For an access smaller than
eight bytes there is a second comparison against the addressable prefix. That is
two well predicted branches per memory operation, which is why the cost is
around a factor of two rather than a factor of twenty.

The redzones are the other half. Every allocation is padded on both sides with
poisoned bytes, so an overflow of one element lands in shadow that is already
marked bad, rather than in the next object where it would be silent.

## The limitation to say out loud

Use after free is caught by not really freeing. A freed block is poisoned and
put on a queue rather than returned for reuse, and only when that queue fills
does the oldest block get recycled.

So detection has a window, and the window is a memory budget. Within a few
hundred megabytes of subsequent allocation traffic, a use after free is caught
with a precise report. Beyond it, the address has been handed out again and the
bug is silent once more.

This is worth holding onto because it corrects the usual belief. A clean
sanitizer run does not prove your program has no use after free. It proves that
none happened inside the window, on the paths this run took, in code that was
recompiled. That is a great deal more than nothing and it is not a proof.

## What to carry forward

A debugger is one system call plus bookkeeping. Everything else, lines,
variables, frames, comes from tables the compiler emitted.

A breakpoint is a byte of your program replaced by a trap byte. The instruction
pointer is one past it when you stop, resuming means restore, step and re-arm,
and both facts explain why breakpoints are neither free nor invisible.

There are four hardware watchpoints of eight bytes each. Past that the debugger
silently single steps your whole program.

A sanitizer is a compiler pass plus a runtime. The address sanitizer keeps one
shadow byte per eight bytes of memory, checks it before every access, and pads
allocations with poisoned redzones. It finds use after free by delaying reuse,
which makes it a detector with a window rather than a proof.

Next is the other half of finding out what your program is doing: measuring it,
and why most measurements of fast code are wrong.

## Reading the errors you are about to see

These model the arithmetic a debugger and a sanitizer actually do: patching a
word, correcting the instruction pointer, computing a shadow address, reading a
shadow byte.

`assert-failed` names the case your model got wrong. Several exercises assert
that an access ending exactly at the addressable prefix is allowed, which is the
partial block rule being read correctly rather than an off by one.
