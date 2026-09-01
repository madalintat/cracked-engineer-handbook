## Ask the kernel to write

Write `emit`, which writes the bytes at `rsi` for a length in `rdx` to the
descriptor in `rdi`, and returns whatever the kernel returned.

The syscall number for `write` is 1, and it goes in `rax`. The three arguments
are already in the right registers.

@kind output
@concept The syscall number goes in `rax`, the arguments are already where the
convention wants them, and the result comes back in `rax`.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint One instruction to set the number, then `syscall`, then return.
@diagnose wrong verdict nonzero-exit
The kernel returned the wrong thing, or a different call ran. `write` is number
1; the starter sets 60, which is `exit`, and exiting from inside a helper is not
what the checks are waiting for.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after Three arguments, one number, one instruction. Everything libc adds on top
of this, the buffering, the retry on partial writes and the setting of `errno`,
is a decision somebody made rather than something the kernel provides.

```starter
.intel_syntax noprefix
.text
.global emit
emit:
    mov eax, 60
    syscall
    ret
```

```tests
.data
msg: .ascii "hi\n"
.text
.global _start
_start:
    mov rdi, 1
    lea rsi, [rip + msg]
    mov rdx, 3
    call emit
    cmp rax, 3
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
.global emit
emit:
    mov eax, 1
    syscall
    ret
```

## The error is the return value

Write `try_write`, which attempts a write and returns 1 if it failed and 0 if it
succeeded.

There is no `errno` here. A syscall returns a small negative number on failure,
and the checks use a descriptor that is not open.

@kind output
@concept The kernel signals failure by returning a negative value in the same
register as the result, and `errno` is something the C library invented on top of
that.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint A failure is a negative return. The sign flag after a test of `rax` tells
you.
@diagnose wrong verdict nonzero-exit
The check that fails is the one with the bad descriptor. Writing to descriptor
999 returns -9, which is `EBADF`, and that is negative rather than -1. Comparing
against -1 catches one error code out of a hundred and thirty.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after The rule is that anything from -1 to -4095 is an error and everything else
is a result. libc checks that range, puts the magnitude in a thread-local
`errno`, and hands you -1, which is why `errno` is per-thread and why it is not
the kernel's idea.

```starter
.intel_syntax noprefix
.text
.global try_write
try_write:
    mov eax, 1
    syscall
    xor edx, edx
    cmp rax, -1
    sete dl
    mov rax, rdx
    ret
```

```tests
.data
msg: .ascii "x"
.text
.global _start
_start:
    mov rdi, 1
    lea rsi, [rip + msg]
    mov rdx, 1
    call try_write
    cmp rax, 0
    jne fail
    mov rdi, 999
    lea rsi, [rip + msg]
    mov rdx, 1
    call try_write
    cmp rax, 1
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
.global try_write
try_write:
    mov eax, 1
    syscall
    xor edx, edx
    test rax, rax
    sets dl
    mov rax, rdx
    ret
```

## The instruction destroys two registers

The `syscall` instruction puts the return address in `rcx` and the flags in
`r11`. Both are gone when it returns, whatever they held before.

Write `survives`, which keeps the value it is given in `rsi` across a syscall and
returns it. The starter parks it in `rcx`.

@kind output
@concept `syscall` clobbers `rcx` and `r11`, which is a property of the
instruction rather than of the kernel, and it is why the syscall convention
differs from the function one.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Pick a register the instruction does not touch, or use the stack.
@diagnose wrong verdict nonzero-exit
The value came back as an address inside your own function. `syscall` writes the
return address into `rcx`, so anything parked there is destroyed, and what you
read back is where execution was about to resume.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after This is why the syscall convention uses `r10` where the function
convention uses `rcx`. The register the function rules wanted for the fourth
argument is the one the instruction overwrites, so libc's wrappers for calls with
four or more arguments all contain a `mov r10, rcx` that exists only to bridge
the two.

```starter
.intel_syntax noprefix
.data
dot: .ascii "."
.text
.global survives
survives:
    mov rcx, rsi
    push rdi
    mov eax, 1
    mov rdi, 1
    lea rsi, [rip + dot]
    mov rdx, 1
    syscall
    pop rdi
    mov rax, rcx
    ret
```

```tests
.global _start
_start:
    mov rsi, 12345
    call survives
    cmp rax, 12345
    jne fail
    mov rsi, -7
    call survives
    cmp rax, -7
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
.data
dot: .ascii "."
.text
.global survives
survives:
    push rbx
    mov rbx, rsi
    push rdi
    mov eax, 1
    mov rdi, 1
    lea rsi, [rip + dot]
    mov rdx, 1
    syscall
    pop rdi
    mov rax, rbx
    pop rbx
    ret
```

## Count the crossings

Write `emit_bytes`, which writes `rdx` bytes from `rsi` to descriptor 1 and
returns the number of syscalls it performed.

The starter writes one byte at a time, which is one privilege transition per
byte. Write them in a single call instead.

@kind output
@concept The boundary is expensive, so the way to make a program that crosses it
often faster is to cross it less often rather than to make each crossing cheaper.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The kernel takes a length. There is no reason to hand it one.
@diagnose wrong verdict nonzero-exit
The count is wrong. Whatever the length, the whole buffer goes in one call, so
the answer is 1 for a non-empty buffer. The starter loops, which is correct
output and the wrong number of transitions.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after This is the entire reason `printf` is not a syscall. A program writing a
byte at a time performs one transition per byte, and the same program through a
buffered stream performs one per few kilobytes. Nothing about the disk changed.

```starter
.intel_syntax noprefix
.text
.global emit_bytes
emit_bytes:
    xor r12, r12
    mov r13, rsi
    mov r14, rdx
.loop:
    test r14, r14
    jz .done
    mov eax, 1
    mov rdi, 1
    mov rsi, r13
    mov rdx, 1
    syscall
    inc r12
    inc r13
    dec r14
    jmp .loop
.done:
    mov rax, r12
    ret
```

```tests
.data
buf: .ascii "abcdef"
.text
.global _start
_start:
    lea rsi, [rip + buf]
    mov rdx, 6
    call emit_bytes
    cmp rax, 1
    jne fail
    lea rsi, [rip + buf]
    mov rdx, 3
    call emit_bytes
    cmp rax, 1
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
.global emit_bytes
emit_bytes:
    mov eax, 1
    mov rdi, 1
    syscall
    mov rax, 1
    ret
```

## Two conventions, one shuffle

Write `call_by_number`, which performs the syscall whose number is in `rdi`,
using the three arguments in `rsi`, `rdx` and `rcx`, and returns the result.

Your caller used the function convention. The kernel wants the syscall one. Every
argument has to move one place.

@kind output
@concept The syscall convention and the function convention are not the same
convention, so a wrapper is a shuffle rather than a label.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Four moves, and the order matters: do not overwrite a register before you
have read it.
@diagnose wrong verdict nonzero-exit
The kernel saw the wrong arguments. Your first argument arrived in `rsi` and the
kernel reads the first from `rdi`, so all three move down one position, and the
number goes to `rax` first because `rdi` is about to be overwritten.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after A fourth argument would not have been this easy. The function convention
puts it in `rcx` and the `syscall` instruction destroys `rcx`, so the syscall
convention uses `r10` instead. That is why every C library on this platform
contains a `mov r10, rcx` in every wrapper for a call with four or more
arguments, doing nothing except reconciling two conventions that differ in one
slot.

```starter
.intel_syntax noprefix
.text
.global call_by_number
call_by_number:
    mov rax, rdi
    mov rdi, rsi
    mov rsi, rdx
    syscall
    ret
```

```tests
.data
msg: .ascii "ok\n"
.text
.global _start
_start:
    mov rdi, 1
    mov rsi, 1
    lea rdx, [rip + msg]
    mov rcx, 3
    call call_by_number
    cmp rax, 3
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
.global call_by_number
call_by_number:
    mov rax, rdi
    mov rdi, rsi
    mov rsi, rdx
    mov rdx, rcx
    syscall
    ret
```

## Exit is a syscall too

Write `finish`, which ends the process with the status in `rdi`.

There is no return from this one. `exit` is number 60, and the status is its only
argument.

@kind output
@concept Process termination is a request like any other, and a program with no
library underneath has to make it explicitly or run off the end of its own code.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The status is already in the right register. Only the number is missing.
@diagnose wrong verdict nonzero-exit
The process exited with the wrong status, or did not exit at all. The status is
the first argument and stays in `rdi`; only `rax` needs setting, and 60 is the
number.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after A program without a C library has no `main` and nothing that runs after
it. `_start` is where the kernel begins, and returning from it returns to nowhere,
which is why every one of these exercises ends in this call rather than a `ret`.

```starter
.intel_syntax noprefix
.text
.global finish
finish:
    mov eax, 1
    syscall
    ret
```

```tests
.global _start
_start:
    mov rdi, 0
    call finish
    mov edi, 1
    mov eax, 60
    syscall
```

```solution
.intel_syntax noprefix
.text
.global finish
finish:
    mov eax, 60
    syscall
    ret
```

## Advance and retry

A destination that accepts a limited number of bytes at a time is ordinary: a
pipe, a socket, a terminal. The loop that handles it advances the pointer by what
was taken and reduces the count by the same amount.

Write `write_chunks`, which writes `rdx` bytes from `rsi` to descriptor 1 in
chunks of at most `rcx` bytes, and returns the number of write calls it made.

@kind output
@concept A write takes what it can and tells you how much, so correct code
advances by the return value rather than assuming the whole request went.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Each pass writes the smaller of the cap and what is left, then moves the
pointer forward by that much.
@diagnose wrong verdict nonzero-exit
The call count is wrong. Eight bytes in chunks of three is three calls: three,
three, and two. The starter hands the kernel the whole length once, which
produces the right bytes and the wrong number of transitions, and would lose data
against a destination that really did accept less than it was offered.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after On a regular file a short write is rare and on a pipe it is routine, so
this loop is what every correct writer contains. The cap here stands in for the
kernel's own limit, and the shape of the code is identical either way: advance by
what was accepted, never by what was asked.

```starter
.intel_syntax noprefix
.text
.global write_chunks
write_chunks:
    mov eax, 1
    mov rdi, 1
    syscall
    mov rax, 1
    ret
```

```tests
.data
buf: .ascii "abcdefgh"
.text
.global _start
_start:
    lea rsi, [rip + buf]
    mov rdx, 8
    mov rcx, 3
    call write_chunks
    cmp rax, 3
    jne fail
    lea rsi, [rip + buf]
    mov rdx, 8
    mov rcx, 8
    call write_chunks
    cmp rax, 1
    jne fail
    lea rsi, [rip + buf]
    mov rdx, 6
    mov rcx, 2
    call write_chunks
    cmp rax, 3
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
.global write_chunks
write_chunks:
    push rbx
    xor rbx, rbx
    mov r8, rsi
    mov r9, rdx
    mov r10, rcx
.loop:
    test r9, r9
    jz .done
    mov rdx, r9
    cmp rdx, r10
    jbe .go
    mov rdx, r10
.go:
    mov eax, 1
    mov rdi, 1
    mov rsi, r8
    syscall
    test rax, rax
    jle .done
    inc rbx
    add r8, rax
    sub r9, rax
    jmp .loop
.done:
    mov rax, rbx
    pop rbx
    ret
```

## The number never changes

Write `write_number`, returning the syscall number for `write` on Linux x86-64.

One instruction. The point is what the number means rather than what it is.

@kind output
@concept The syscall table is the strongest compatibility guarantee in the
system, because a program compiled a decade ago has these numbers baked into its
instruction stream.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint It is the second entry in the table, and `read` is the first.
@diagnose wrong verdict nonzero-exit
Wrong number. `read` is 0, `write` is 1, `open` is 2, and `exit` is 60. Those
assignments have not moved since the 64-bit port and they are not going to.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after Old calls that turned out badly get a second version beside the first
rather than a change to the original, which is why the table holds several pairs
doing nearly the same thing. That is the cost of the promise, and the benefit is
that this boundary is the one interface in the whole stack you can rely on
absolutely.

```starter
.intel_syntax noprefix
.text
.global write_number
write_number:
    mov eax, 4
    ret
```

```tests
.global _start
_start:
    call write_number
    cmp rax, 1
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
.global write_number
write_number:
    mov eax, 1
    ret
```
