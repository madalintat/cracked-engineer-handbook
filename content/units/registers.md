---
needs: [universal, clock-bus]
minutes: 50
one_idea: A register is a name the hardware knows, and there are sixteen of them, which is the constraint everything above has to live with.
sources: [x86-64-assembly, cpu-architectures]
---

Two instructions that look like the same instruction:

```
mov rax, -1
mov eax, 5        ; rax is now 5
```

```
mov rax, -1
mov ax, 5         ; rax is now 0xFFFFFFFFFFFF0005
```

Writing the 32-bit name of a register clears the upper half. Writing the
16-bit name of the same register leaves it alone. Both are measured, both are
deliberate, and the reason for the difference is a decision AMD made in 2000
that you now have to know about.

## What a register actually is

Everything you have built so far stores values in something you addressed: a
wire, a flip-flop you wrote to, a location in a memory array. A register is the
same idea with the addressing removed. There are a fixed number of them, they
have names rather than addresses, and those names are part of the instruction
encoding.

That is the whole difference, and it buys the two things that matter. A
register access has no address to compute and no cache to miss, so it takes
zero extra cycles: the value is already inside the core, in the register file
you met as a context store in Part II. And because the name is in the
instruction, the processor knows which values an instruction touches before it
has decoded anything else, which is what lets it start work on several
instructions at once.

The cost is that there are not many of them.

## The sixteen

x86-64 has sixteen general-purpose registers. Eight carry names inherited from
the 8086, which is why they are not `r0` through `r7`:

```
rax rbx rcx rdx rsi rdi rbp rsp      the old eight, extended to 64 bits
r8  r9  r10 r11 r12 r13 r14 r15      added by AMD64
```

The names once meant something. `rax` was the accumulator, `rcx` the counter,
`rsi` and `rdi` the source and destination index for string operations. Almost
none of that is true any more. They are sixteen interchangeable places to put a
value, with two exceptions that still hold: `rsp` is the stack pointer and the
hardware itself uses it, and `rbp` is conventionally the frame pointer, though
optimised code usually declines the convention and uses it as a seventeenth
general register.

Each one has four names, addressing four widths:

```
rax     64 bits
eax     the low 32
ax      the low 16
al      the low 8
```

## The rule about widths

Here is the asymmetry from the top of the page, stated properly.

Writing to a 32-bit name zero-extends into the full 64-bit register. Writing to
a 16-bit or 8-bit name modifies only those bits and leaves the rest untouched.

You can check this rather than believe it, and the exercises will make you.
Set `rax` to all ones, write 5 through `eax`, shift right by 32, and you get
zero. Do the same through `ax` and the upper half is still all ones.

The reason is not consistency, it is dependencies. If `mov eax, 5` left the
upper 32 bits alone, then the new value of `rax` would depend on the old value
of `rax`, and the processor could not begin that instruction until whatever
last wrote `rax` had finished. Zero-extension breaks the chain: the instruction
depends on nothing, so it can be issued immediately.

The 16-bit and 8-bit forms did not get the same treatment because they had to
keep behaving the way 16-bit code from 1985 expected. So the partial-register
dependency survives in exactly the widths nobody writes on purpose any more.

This is also why compilers emit `xor eax, eax` to zero a register rather than
`mov rax, 0`. It is shorter to encode, and the processor recognises it as
producing a constant, so it does not even use an execution unit.

## The stack is a register and a convention

There is no stack instruction in the sense of a stack data structure in the
hardware. There is a register, `rsp`, and two instructions that agree on what
to do with it.

`push rax` subtracts 8 from `rsp` and stores `rax` at the new address. `pop
rbx` loads from `rsp` and adds 8. That is all. Measured: one push moves `rsp`
by exactly 8.

The stack grows **downward**, toward lower addresses. This is not a deep truth
about stacks. It is a layout decision: the stack starts at the top of the
address space and the heap starts low and grows up, so the two can expand
toward each other and neither has to know in advance how much room the other
will need.

The consequence is that `[rsp]` is the top of the stack and `[rsp + 8]` is the
item below it, which reads backwards the first several times.

## The contract nobody enforces

On Linux, x86-64 code follows the System V AMD64 ABI. The first six integer
arguments go in `rdi`, `rsi`, `rdx`, `rcx`, `r8`, `r9`, in that order. The
return value comes back in `rax`. A syscall uses the same idea with a different
list: the number in `rax`, then `rdi`, `rsi`, `rdx`, `r10`, `r8`, `r9`.

Two things are worth being precise about.

First, `rcx` is an argument register for function calls and is not one for
syscalls, because the `syscall` instruction itself overwrites `rcx` with the
return address. The kernel interface uses `r10` in its place. This is the kind
of detail that only bites you once.

Second, the ABI is a convention and nothing checks it. There is no mechanism in
the processor that makes a function read its argument from `rdi`. If you write
both sides of a call yourself, you can pass arguments anywhere you like and it
will work. It stops working the moment one side is code you did not write,
which in practice means the moment you call libc or the kernel.

## Who has to put things back

The sixteen registers are split by who is responsible for preserving them.

**Callee-saved**: `rbx`, `rbp`, `r12` through `r15`. A function that uses these
must leave them holding what it found. If it wants them, it pushes them on
entry and pops them before returning.

**Caller-saved**: everything else, including all the argument registers and
`rax`. A function may destroy these freely, so a caller with something valuable
in `rcx` has to save it before making a call.

The split exists because both rules are wrong on their own. If everything were
callee-saved, a leaf function that uses two registers would still have to
preserve all sixteen. If everything were caller-saved, every call site would
have to spill everything live. Splitting the file lets a compiler put
short-lived values in caller-saved registers and long-lived ones in
callee-saved registers, and pay for saving only what it actually uses.

This is where sixteen starts to feel small. A loop with more live values than
available registers has to keep some of them in memory and move them back and
forth, which is called spilling, and it is the single most common reason a
compiler's output is slower than you expected. Part V returns to it.

## What the exercises run

These exercises assemble real x86-64 and run it, with no C runtime underneath.
That is unusual and it is deliberate: there is no `main`, because `main` is a
libc idea. Execution starts at a label called `_start`, and there is nothing to
return to, so the program has to end by asking the kernel to end it.

```
    mov edi, 0        ; the exit status
    mov eax, 60       ; the syscall number for exit
    syscall
```

Leave that out and the processor runs off the end of your code into whatever
bytes follow, which is a fault.

The exit status is the observable. It is one byte, so it holds 0 to 255, and
the checks read it. Where an exercise needs more than a byte of output, it
writes to standard output with syscall 1.

Three failures you will see, and what each one means.

An assembler error names a line and a column and quotes the text, the way a C
compiler does. A **link** error looks different and is worth recognising: every
line assembled correctly, so nothing complains about your syntax, and the
linker then cannot find a name you referred to. Compiler Explorer reports this
as an executable that was not produced rather than as a build failure, which is
why this handbook keys on the linker's own words.

And a fault, reported as a signal. On this hardware a segmentation fault means
an address the kernel refused. Assembly gives you no bounds checks and no type
errors, so a fault is frequently the first sign that anything is wrong at all.

## What to carry forward

A register is a name, there are sixteen, and that number is the constraint
every optimisation above this layer is working against. The stack is one of
those registers plus an agreement. The calling convention is a contract that
nothing enforces, which is precisely why it has to be written down.

The next unit takes the other half of an instruction: not which register, but
which address, and what the processor remembers about the last comparison you
made.
