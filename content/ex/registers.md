## Return a value in the right place

Write `answer`, a function taking no arguments that returns 42. The checks call
it and compare what comes back.

@kind output
@concept A function returns its value in `rax` because the calling convention
says so, and nothing in the hardware enforces that.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The return value goes in `rax`. The starter puts it somewhere else.
@diagnose wrong verdict nonzero-exit
The checks read `rax` after calling you, because that is where the System V
convention says a return value lives. Putting 42 in another register is not
wrong in any way the processor can detect, which is exactly the point: the
convention is a contract, and both sides have to keep it.
@diagnose asm verdict compile-error
Read the line the assembler names. Intel syntax puts the destination first,
and every instruction here needs a comma between its two operands.
@after Notice there is no type, no signature and no declaration. The agreement
that `rax` holds the answer exists only in a document.

```starter
.intel_syntax noprefix
.text
.global answer
answer:
    mov rbx, 42
    ret
```

```tests
.global _start
_start:
    call answer
    cmp rax, 42
    jne fail
    mov edi, 0
    mov eax, 60
    syscall
fail:
    mov edi, 1
    mov eax, 60
    syscall
```

```solution
.intel_syntax noprefix
.text
.global answer
answer:
    mov rax, 42
    ret
```

## The width that clears the top

`clear_top` is given a 64-bit value in `rdi` with every bit set. Return a value
whose upper 32 bits are zero and whose lower 32 bits are 5, using a single move
into the right name.

@kind output
@concept Writing a 32-bit register name zero-extends into the full 64 bits.
Writing a 16-bit name does not.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The starter uses `ax`. There is a wider name for the same register.
@diagnose wrong verdict nonzero-exit
Writing through `ax` changes 16 bits and leaves the other 48 exactly as they
were, so the upper half of `rdi` survives into your answer. Writing through
`eax` clears the upper 32 bits as a side effect. That asymmetry is the whole
exercise, and it exists because zero-extension breaks the dependency on the
register's previous value, which lets the processor start the instruction
immediately.
@after The 8-bit and 16-bit forms behave the old way because code from 1985
depended on it. The 32-bit form was new in 2000 and could be defined freshly.

```starter
.intel_syntax noprefix
.text
.global clear_top
clear_top:
    mov rax, rdi
    mov ax, 5
    ret
```

```tests
.global _start
_start:
    mov rdi, -1
    call clear_top
    cmp rax, 5
    jne fail
    mov edi, 0
    mov eax, 60
    syscall
fail:
    mov edi, 1
    mov eax, 60
    syscall
```

```solution
.intel_syntax noprefix
.text
.global clear_top
clear_top:
    mov eax, 5
    ret
```

## Two values through the stack

`swap_diff` takes two values in `rdi` and `rsi`. Push both, then pop them into
the opposite registers, and return the first minus the second. With 30 and 12
the answer is negative 18.

@kind output
@concept A stack reverses order, so pushing two values and popping two values
swaps them.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The last thing pushed is the first thing popped.
@diagnose wrong verdict nonzero-exit
Work the stack by hand. After `push rdi` then `push rsi`, the top of the stack
holds what was in `rsi`. So the first `pop` takes that one. The starter pops
them back into the registers they came from, which swaps nothing.
@after `push` and `pop` are not stack instructions in any deep sense. They are
`sub rsp, 8` with a store, and a load with `add rsp, 8`.

```starter
.intel_syntax noprefix
.text
.global swap_diff
swap_diff:
    push rdi
    push rsi
    pop rsi
    pop rdi
    mov rax, rdi
    sub rax, rsi
    ret
```

```tests
.global _start
_start:
    mov rdi, 30
    mov rsi, 12
    call swap_diff
    cmp rax, -18
    jne fail
    mov edi, 0
    mov eax, 60
    syscall
fail:
    mov edi, 1
    mov eax, 60
    syscall
```

```solution
.intel_syntax noprefix
.text
.global swap_diff
swap_diff:
    push rdi
    push rsi
    pop rdi
    pop rsi
    mov rax, rdi
    sub rax, rsi
    ret
```

## Which way is up

`second_from_top` pushes three values and returns the middle one by reading it
directly off the stack rather than popping. Clean the stack up before you
return.

@kind output
@concept The stack grows toward lower addresses, so the item below the top is
at a higher address.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint After three pushes, `[rsp]` is the last one pushed. Count upward from
there.
@diagnose wrong verdict nonzero-exit
Draw the addresses. Each push subtracts 8 from `rsp` first, so after pushing
`a`, `b`, `c` in that order, `c` is at `[rsp]`, `b` is at `[rsp + 8]` and `a`
is at `[rsp + 16]`. Subtracting from `rsp` reads memory the stack has not
claimed yet.
@diagnose fault verdict signal
The address you computed is not mapped. Reading below `rsp` by a large amount
leaves the region the kernel gave you, which is a fault rather than garbage.
@after Reading past the end of a structure gives you whatever is next in memory
and no complaint. Here it happened to be another value you had pushed.

```starter
.intel_syntax noprefix
.text
.global second_from_top
second_from_top:
    push rdi
    push rsi
    push rdx
    mov rax, [rsp - 8]
    add rsp, 24
    ret
```

```tests
.global _start
_start:
    mov rdi, 100
    mov rsi, 200
    mov rdx, 300
    call second_from_top
    cmp rax, 200
    jne fail
    mov edi, 0
    mov eax, 60
    syscall
fail:
    mov edi, 1
    mov eax, 60
    syscall
```

```solution
.intel_syntax noprefix
.text
.global second_from_top
second_from_top:
    push rdi
    push rsi
    push rdx
    mov rax, [rsp + 8]
    add rsp, 24
    ret
```

## A name that is not there

`use_helper` should return twice its argument by calling `double_it`, which the
checks define for you. The starter calls something else. Read what the linker
says rather than what the assembler says.

@kind output
@concept An assembler accepts any name you write. The linker is what decides
whether that name exists.
@backend godbolt
@lang asm
@expect verdict link-error
@hint The helper the checks provide is called `double_it`.
@diagnose link verdict link-error
Every line of your code assembled without complaint, because to an assembler a
name it has not seen is just a name it has not seen yet. The linker went
looking for the body and found nothing, and the message it gives names the
symbol and the section offset that referred to it.

This failure looks different from a compile error in the tooling: nothing
reports a build failure, and the result is simply that no executable was
produced.
@diagnose wrong verdict nonzero-exit
The name resolves now and the answer is wrong. `double_it` expects its argument
in `rdi` and returns in `rax`, like everything else here.
@after Undefined symbols are the single most common build failure in C and C++
too, and they mean the same thing there: something promised a definition and
nothing supplied one.

```starter
.intel_syntax noprefix
.text
.global use_helper
use_helper:
    call twice_it
    ret
```

```tests
.global double_it
double_it:
    mov rax, rdi
    add rax, rax
    ret

.global _start
_start:
    mov rdi, 21
    call use_helper
    cmp rax, 42
    jne fail
    mov edi, 0
    mov eax, 60
    syscall
fail:
    mov edi, 1
    mov eax, 60
    syscall
```

```solution
.intel_syntax noprefix
.text
.global use_helper
use_helper:
    call double_it
    ret
```

## Put it back the way you found it

`uses_rbx` may use `rbx` for its own working, and must leave it holding
whatever it held on entry. Return the argument plus one.

@kind output
@concept Callee-saved registers are the half of the file a function has to
preserve, and nothing checks that it did.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint `rbx` is callee-saved. There is a two-instruction way to borrow it.
@diagnose wrong verdict nonzero-exit
The checks put a known value in `rbx`, call you, and look at `rbx` afterwards.
The starter overwrites it and never restores it. Push it on entry and pop it
before the `ret`, and mind that the pop has to happen before the return rather
than after it.
@diagnose fault verdict signal
The stack is unbalanced. A `push` with no matching `pop` leaves `rsp` pointing
at your saved value, so `ret` jumps to that value instead of to your caller.
@after This is why a compiler prefers caller-saved registers for short-lived
values. Using `rbx` costs two instructions before you have done any work.

```starter
.intel_syntax noprefix
.text
.global uses_rbx
uses_rbx:
    mov rbx, rdi
    add rbx, 1
    mov rax, rbx
    ret
```

```tests
.global _start
_start:
    mov rbx, 0x1234
    mov rdi, 41
    call uses_rbx
    cmp rax, 42
    jne fail
    cmp rbx, 0x1234
    jne fail
    mov edi, 0
    mov eax, 60
    syscall
fail:
    mov edi, 1
    mov eax, 60
    syscall
```

```solution
.intel_syntax noprefix
.text
.global uses_rbx
uses_rbx:
    push rbx
    mov rbx, rdi
    add rbx, 1
    mov rax, rbx
    pop rbx
    ret
```

## Six arguments, in order

`sum_six` takes six integers and returns their sum. The checks pass 1 through 6,
so the answer is 21. Getting this wrong tells you which register you had in the
wrong place.

@kind output
@concept The first six integer arguments go in a fixed order, and the order is
not alphabetical or numerical.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The order is `rdi`, `rsi`, `rdx`, `rcx`, `r8`, `r9`.
@diagnose wrong verdict nonzero-exit
Add the registers you used and see which sum you got. The starter stops after
four, so it returns 10 rather than 21, which tells you exactly how many
arguments it read.

The order is worth memorising because it is not guessable. `rcx` is the fourth
argument for an ordinary call and is not used at all by the syscall interface,
which puts `r10` in its place, because the `syscall` instruction overwrites
`rcx` with the return address.
@after Beyond six, arguments go on the stack, which is why a function with many
parameters is measurably slower to call than one with few.

```starter
.intel_syntax noprefix
.text
.global sum_six
sum_six:
    mov rax, rdi
    add rax, rsi
    add rax, rdx
    add rax, rcx
    ret
```

```tests
.global _start
_start:
    mov rdi, 1
    mov rsi, 2
    mov rdx, 3
    mov rcx, 4
    mov r8, 5
    mov r9, 6
    call sum_six
    cmp rax, 21
    jne fail
    mov edi, 0
    mov eax, 60
    syscall
fail:
    mov edi, 1
    mov eax, 60
    syscall
```

```solution
.intel_syntax noprefix
.text
.global sum_six
sum_six:
    mov rax, rdi
    add rax, rsi
    add rax, rdx
    add rax, rcx
    add rax, r8
    add rax, r9
    ret
```

## Ending a program that has nowhere to return

`_start` is the entry point and nothing called it, so there is no return
address on the stack and `ret` has nothing to return to. Write the exit
sequence yourself. A program that ends cleanly here exits with status 0.

@kind output
@concept Without a C runtime underneath, a program ends by asking the kernel
to end it.
@backend godbolt
@lang asm
@expect verdict signal
@hint Syscall 60 is `exit`, and its one argument goes where the first argument
always goes.
@diagnose fault verdict signal
Running off the end of your code is a fault, and so is `ret` at `_start`,
because the value it pops is whatever the kernel left on the stack rather than
a return address. Neither is a bug in your logic; both are what happens when a
program does not end deliberately.
@diagnose wrong verdict nonzero-exit
It exited, with a nonzero status. The number in `rax` selects the syscall and
the number in `rdi` is the status, so check you have not swapped them.
@after The status is one byte. Exit with 256 and the kernel reports 0, which
has confused a great many test scripts.

```starter
.intel_syntax noprefix
.text
.global _start
_start:
    mov edi, 0
    ret
```

```tests
```

```solution
.intel_syntax noprefix
.text
.global _start
_start:
    mov edi, 0
    mov eax, 60
    syscall
```
