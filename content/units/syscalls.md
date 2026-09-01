---
needs: [addressing]
minutes: 50
one_idea: A syscall is not a function call, it is a controlled change of privilege level, and everything about its cost and its conventions follows from that.
sources: [x86-64-assembly, cpu-architectures]
---

Your program cannot touch the disk. It cannot open a socket, allocate a page, or
find out what time it is. Every one of those is done by asking, and this unit is
about what the asking actually costs and why it is shaped the way it is.

## Not a call

`write(1, buf, n)` looks like a function call in your source, and libc does make
it one. Underneath, the thing that happens is not a call at all.

The processor runs at a privilege level. Your code runs at the least privileged
one, where the instructions that touch page tables, device registers and
interrupt state are simply not available. The kernel runs at the most privileged.
A syscall is the one sanctioned way to cross that line.

The `syscall` instruction does not jump where you tell it. It jumps to an address
the kernel put in a machine register at boot, switches privilege level, and
switches stack. You do not choose the destination. That is the entire point:
if the caller could pick the address, the privilege boundary would not be one.

## A different convention, for a hardware reason

Function calls on this platform pass arguments in `rdi`, `rsi`, `rdx`, `rcx`,
`r8`, `r9`. Syscalls pass them in `rdi`, `rsi`, `rdx`, `r10`, `r8`, `r9`.

One register differs, and the reason is mechanical rather than arbitrary. The
`syscall` instruction stores the return address in `rcx` and the flags in `r11`,
because there is no stack push involved and those two registers were the ones
chosen to hold them. So `rcx` cannot carry an argument: it is destroyed by the
instruction that delivers it.

`r10` takes its place, and the mismatch is why libc's wrappers are not simply
labels. Every wrapper for a syscall with four or more arguments contains a `mov
r10, rcx` that exists purely to bridge two conventions that differ in one slot.

The syscall number goes in `rax`, and the result comes back in `rax`.

## The return value is the error

There is no `errno` at this level. A syscall returns a small negative number to
mean failure, where the magnitude is the error code.

Write to a closed descriptor and you get -9, which is `EBADF`. Read past the end
and you get 0. Ask for memory that is not there and you get -12, `ENOMEM`. The
convention is that anything in the range -1 to -4095 is an error and everything
else is a result.

libc turns that into the interface you know: it checks the range, stores the
magnitude in the thread-local `errno`, and returns -1. Which means `errno` is not
something the kernel sets. It is something your C library invented, and it is
per-thread because making it global was a bug that took years to remove.

```figure
{
  "kind": "blocks",
  "alt": "A program calling libc, which sets up registers and executes the syscall instruction, crossing into the kernel and returning a value that libc converts into a result and errno.",
  "caption": "Two boundaries, not one. The interesting one is the privilege change in the middle; the one you see in your source is a wrapper around it.",
  "boxes": [
    { "id": "p", "x": 0,   "y": 1.4, "w": 3.2, "h": 1.3, "label": "your code", "accent": "azure" },
    { "id": "l", "x": 4,   "y": 1.4, "w": 3.4, "h": 1.3, "label": "libc wrapper", "sub": "sets errno", "accent": "copper" },
    { "id": "s", "x": 8.2, "y": 1.4, "w": 3.4, "h": 1.3, "label": "syscall", "sub": "privilege change", "accent": "gold" },
    { "id": "k", "x": 12.4, "y": 1.4, "w": 3.2, "h": 1.3, "label": "kernel", "accent": "jade" }
  ],
  "arrows": [
    { "from": "p", "to": "l" },
    { "from": "l", "to": "s" },
    { "from": "s", "to": "k" }
  ]
}
```

## The number is a promise

One property of this interface is unusual enough to be worth stating on its own:
the numbers never change.

Syscall 1 is `write` and it will be `write` for as long as the kernel runs
64-bit x86 binaries. Not because renumbering would be difficult, but because a
program compiled ten years ago has the number 1 baked into its instruction
stream, and the kernel's rule is that a working program keeps working.

This is the strongest compatibility guarantee in the system, stronger than any
library's, and it is why static binaries from a decade ago still run. New calls
get new numbers. Old calls that turned out to be badly designed get a second
version beside the first rather than a change to the original, which is why the
table contains several pairs that do nearly the same thing.

The cost of that promise is a table nobody can tidy. The benefit is that the
boundary between your program and the kernel is the one interface in the whole
stack you can rely on absolutely.

## What it costs

A syscall used to be measured in the low hundreds of nanoseconds, most of it
spent saving and restoring state rather than doing the work.

Then Meltdown happened. The mitigation, page table isolation, gives the kernel a
separate set of page tables from the process, so entering the kernel means
switching page tables and flushing translation caches. On the machines that need
it, this roughly doubled or tripled the cost of the cheapest syscalls, and the
patch's arrival in early 2018 is visible as a step in a great many production
latency graphs.

The number matters less than the shape. A syscall is not free, it is not
predictable, and the way to make a program that does many of them faster is
almost never to make each one faster.

## Three ways round it

The first is buffering, and it is why `printf` is not a syscall. A program that
writes one byte at a time through `write` performs one privilege transition per
byte. The same program writing through a buffered stream performs one per few
kilobytes. That difference has nothing to do with the disk and everything to do
with the boundary.

The second is the vDSO. Some kernel information changes rarely and is not
secret: what time it is, which processor you are on. The kernel maps a small
shared page into every process containing both the data and the code to read it,
so `clock_gettime` on a modern system usually performs no privilege transition at
all. It is a normal function call into a page the kernel wrote.

The third is batching, which is what io_uring is. Two ring buffers shared between
the process and the kernel, one for submissions and one for completions. You
write requests into memory, the kernel reads them from memory, and a syscall is
needed only to wake somebody up. A workload doing a million small reads goes from
a million transitions to almost none.

All three are the same move. The boundary is expensive, so cross it less often
rather than more cheaply.

## Where the numbers in your profile come from

This is the unit that explains a class of profile you will meet.

A program spending most of its time in the kernel is usually not doing too much
work. It is doing its work in units that are too small, and the fix is upstream
of anything the kernel is doing. Reading a file a line at a time through an
unbuffered descriptor is the canonical example, and the repair is a buffer rather
than a faster filesystem.

The inverse also happens. A program with almost no system time and poor
throughput is often waiting on a lock or a cache, and looking at syscall counts
will tell you nothing at all.

## Not every crossing is yours

One more source of transitions, because it explains profiles that look
impossible.

A page fault is a crossing you did not ask for. Touch a page that is mapped but
not present and the processor traps into the kernel, which finds the page,
installs it, and returns to the instruction that faulted as though nothing
happened. Your code contains no call and the transition happened anyway.

That is how a memory-mapped file works, how lazy allocation works, and how a
program that never calls `read` can spend most of its time in the kernel. It is
also why the first pass over a freshly allocated array is slower than the second,
and why a benchmark that skips the warm-up measures the fault handler rather than
the algorithm.

Interrupts are the same shape from the other direction: a device wants attention,
the processor saves state and enters the kernel, and your program resumes with no
record of having been interrupted except the time that went missing.

## What to carry forward

A syscall is a privilege transition wearing the syntax of a function call. Its
argument convention differs from the function one in exactly one register,
because the instruction destroys the register the function convention wanted to
use there.

Its cost is dominated by the crossing rather than the work, which means the
useful optimisation is always to cross less. Buffer, share a page, or batch.

Unit 023 asks the next question: where did the code the kernel is running come
from, and what did the loader have to do before your first instruction ran.

## Reading the errors you are about to see

These call the kernel directly with no library underneath. Numbers are the Linux
x86-64 ones: 1 is `write`, 60 is `exit`.

`nonzero-exit` means your program ran and the checks disagreed. `signal` usually
means a pointer handed to the kernel was not valid. A syscall that fails does not
crash: it returns a small negative number, and noticing that is one of the
exercises.
