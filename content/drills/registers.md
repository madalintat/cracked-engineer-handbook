## How many general-purpose registers does x86-64 have?

- [x] 16
- [ ] 8
- [ ] 32
- [ ] 64

@why Eight inherited from the 8086 and eight added by AMD64. That number is
the constraint every optimisation above this layer is working against.

## After `mov rax, -1` then `mov eax, 5`, what does `rax` hold?

- [x] 5, because writing a 32-bit name zero-extends into the full 64 bits
- [ ] `0xFFFFFFFF00000005`, because only the low 32 bits were written
- [ ] `-1`, because `eax` is a separate register
- [ ] It depends on the processor

@why Measured. Set `rax` to all ones, write through `eax`, shift right by 32
and the result is zero. A 32-bit write clears the upper half.

## After `mov rax, -1` then `mov ax, 5`, is the upper half of `rax` cleared?

- [x] No. A 16-bit write leaves the other 48 bits exactly as they were
- [ ] Yes, the same rule applies to every narrow write
- [ ] Yes, but only on processors newer than 2010
- [ ] The instruction is invalid

@why This asymmetry is the whole trap. The 16-bit and 8-bit forms had to keep
behaving the way 16-bit code from 1985 expected, so the partial-register
dependency survives in exactly the widths nobody writes on purpose.

## Why does a 32-bit write clear the upper half at all?

- [ ] To save encoding space
- [x] It removes the dependency on the register's previous value, so the
      instruction can be issued immediately
- [ ] To make 32-bit and 64-bit code interchangeable
- [ ] It is an accident of the 8086 encoding

@why If the write preserved the upper bits, the new value of `rax` would depend
on the old one, and the processor could not start the instruction until
whatever last wrote `rax` had finished.

## Why do compilers emit `xor eax, eax` rather than `mov rax, 0`?

- [ ] `mov` cannot take a zero operand
- [x] It is shorter to encode, and the processor recognises it as producing a
      constant without using an execution unit
- [ ] `xor` is faster than `mov` in general
- [ ] To clear the flags at the same time

@why It is idiom recognition rather than arithmetic. The same reasoning is why
you see it everywhere in optimised output and almost nowhere in source.

## Which way does the stack grow on x86-64?

- [x] Downward, toward lower addresses
- [ ] Upward, toward higher addresses
- [ ] Whichever direction the compiler chooses
- [ ] Downward on Linux and upward on Windows

@why It is a layout decision rather than a truth about stacks. The stack
starts high and the heap starts low so the two can grow toward each other
without either having to know in advance how much room the other needs.

## After `push a` then `push b`, where is `a`?

- [ ] At `[rsp]`
- [x] At `[rsp + 8]`
- [ ] At `[rsp - 8]`
- [ ] At `[rsp + 16]`

@why `b` was pushed last so it is on top, at `[rsp]`. Because the stack grows
down, the item below the top is at a higher address, which reads backwards the
first several times.

## By how much does one `push` change `rsp`?

- [x] It subtracts 8
- [ ] It subtracts 4
- [ ] It adds 8
- [ ] It depends on the width of the operand

@why Measured: take `rsp`, push once, and subtract. `push` is `sub rsp, 8`
followed by a store, and `pop` is a load followed by `add rsp, 8`. There is no
stack in the hardware, only a register and an agreement.

## In what order do the first six integer arguments go?

- [x] `rdi`, `rsi`, `rdx`, `rcx`, `r8`, `r9`
- [ ] `rax`, `rbx`, `rcx`, `rdx`, `rsi`, `rdi`
- [ ] `r8` through `r13`
- [ ] Left to right on the stack

@why This is the System V AMD64 convention, and it is not guessable from the
register names. Beyond six, arguments go on the stack.

## Why does the Linux syscall interface use `r10` where a function call uses `rcx`?

- [x] The `syscall` instruction overwrites `rcx` with the return address
- [ ] `rcx` is reserved for the kernel
- [ ] `r10` is faster to access from ring 0
- [ ] Historical accident with no reason behind it

@why The hardware takes `rcx` for its own purposes the moment `syscall`
executes, so the kernel interface cannot use it for an argument. This is the
kind of detail that bites you exactly once.

## Which of these must a function preserve for its caller?

- [x] `rbx`, `rbp` and `r12` through `r15`
- [ ] `rax`, `rcx`, `rdx` and the argument registers
- [ ] All sixteen
- [ ] None; the caller saves everything it cares about

@why Those are the callee-saved half. Everything else, including all the
argument registers and `rax`, may be destroyed freely by a called function.

## Why split the registers into callee-saved and caller-saved at all?

- [ ] To make the encoding smaller
- [x] Either rule alone is wasteful, and splitting lets a compiler pay only for
      the registers it actually uses across a call
- [ ] Because the kernel requires it
- [ ] To leave room for future registers

@why If everything were callee-saved, a leaf function using two registers
would still preserve sixteen. If everything were caller-saved, every call site
would spill everything live.

## What is spilling?

- [ ] Writing past the end of the stack
- [x] Keeping a value in memory because there is no free register for it
- [ ] Losing a value when a called function clobbers a register
- [ ] Overflowing an arithmetic result

@why With sixteen registers and more live values than that, something has to
live in memory and be moved back and forth. It is the most common reason
compiled output is slower than you expected.

## In a program with no C runtime, where does execution begin?

- [ ] At `main`
- [x] At `_start`
- [ ] At the first instruction in the file
- [ ] At whichever label is declared first

@why `main` is a libc idea: the runtime sets things up and then calls it.
Without a runtime the kernel jumps straight to the entry symbol, which is
`_start` by default.

## Why can a program with no C runtime not end with `ret`?

- [x] Nothing called it, so the value `ret` pops is not a return address
- [ ] `ret` is not a valid instruction at the entry point
- [ ] The kernel forbids it
- [ ] It works, but leaks the process

@why There is no caller and no return address. The program has to ask the
kernel to end it, which is syscall 60 with the status in `rdi`.
