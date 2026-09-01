## Base, index, scale, displacement

Write `elem`, which is given the base of an array of eight-byte values in `rdi`
and an index in `rsi`, and returns the element at that index.

One instruction. The address arithmetic is part of the load.

@kind output
@concept The processor computes base plus index times scale as part of the
memory operand, so indexing an array costs nothing beyond the load itself.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The scale goes inside the brackets, next to the index register.
@diagnose wrong verdict nonzero-exit
The checks read the wrong element. Eight-byte values are eight bytes apart, so
the index has to be scaled by 8 before it is added to the base. The starter uses
a scale of 1, which reads the byte at that offset rather than the element at that
index.
@diagnose asm verdict compile-error
Read the line the assembler names. Intel syntax puts the destination first and
the memory operand goes in square brackets.
@after One instruction for what the source spells as a multiply, an add and a
dereference. This is why `a[i]` is not where your time goes, and it is worth
remembering when Part X starts comparing layouts.

```starter
.intel_syntax noprefix
.text
.global elem
elem:
    mov rax, [rdi + rsi]
    ret
```

```tests
.data
arr: .quad 10, 20, 30, 40
.text
.global _start
_start:
    lea rdi, [rip + arr]
    mov rsi, 0
    call elem
    cmp rax, 10
    jne fail
    lea rdi, [rip + arr]
    mov rsi, 2
    call elem
    cmp rax, 30
    jne fail
    lea rdi, [rip + arr]
    mov rsi, 3
    call elem
    cmp rax, 40
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
.global elem
elem:
    mov rax, [rdi + rsi*8]
    ret
```

## Arithmetic, without the memory

`lea` computes an address and does not use it, which makes it a three-operand
arithmetic instruction that leaves the flags alone.

Write `times5`, returning five times the argument in `rdi`, in one `lea`.

@kind output
@concept An addressing mode general enough to be useful is also general enough
to compute things that are not addresses.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Five is one plus four. Both terms can be the same register.
@diagnose wrong verdict nonzero-exit
The result is the wrong multiple. `lea rax, [rdi + rdi*4]` is `rdi` plus four
`rdi`, which is five of them. The starter scales by 8 and adds one more, giving
nine.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after Compilers emit this constantly and almost never for addresses. Three, five
and nine are one instruction each, the destination need not be either input, and
none of it disturbs a comparison in progress.

```starter
.intel_syntax noprefix
.text
.global times5
times5:
    lea rax, [rdi + rdi*8]
    ret
```

```tests
.global _start
_start:
    mov rdi, 0
    call times5
    cmp rax, 0
    jne fail
    mov rdi, 1
    call times5
    cmp rax, 5
    jne fail
    mov rdi, 7
    call times5
    cmp rax, 35
    jne fail
    mov rdi, 100
    call times5
    cmp rax, 500
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
.global times5
times5:
    lea rax, [rdi + rdi*4]
    ret
```

## The letter that decides the interpretation

Write `less_signed`, returning 1 when `rdi` is less than `rsi` treating both as
signed, and 0 otherwise.

The starter uses the unsigned comparison. It is right for half the input space,
and the checks include the other half.

@kind output
@concept One subtraction sets every flag, and the jump you choose afterwards is
the only record of whether you meant signed or unsigned.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint `jb` reads the carry flag. `jl` compares sign against overflow.
@diagnose wrong verdict nonzero-exit
The comparison disagrees on a case involving a negative number. As unsigned, -1
is the largest 64-bit value; as signed it is below everything positive. The `cmp`
is identical in both readings, and `setb` asks the unsigned question where `setl`
asks the signed one.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after This is the bug from unit 015 with the width changed. The processor never
knew which interpretation you wanted, it computed both answers, and one letter in
a mnemonic picked between them.

```starter
.intel_syntax noprefix
.text
.global less_signed
less_signed:
    xor eax, eax
    cmp rdi, rsi
    setb al
    ret
```

```tests
.global _start
_start:
    mov rdi, 1
    mov rsi, 2
    call less_signed
    cmp rax, 1
    jne fail
    mov rdi, 2
    mov rsi, 1
    call less_signed
    cmp rax, 0
    jne fail
    mov rdi, -1
    mov rsi, 1
    call less_signed
    cmp rax, 1
    jne fail
    mov rdi, -5
    mov rsi, -2
    call less_signed
    cmp rax, 1
    jne fail
    mov rdi, 3
    mov rsi, -3
    call less_signed
    cmp rax, 0
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
.global less_signed
less_signed:
    xor eax, eax
    cmp rdi, rsi
    setl al
    ret
```

## Carry is not overflow

Write `add_carried`, which adds `rdi` and `rsi` as unsigned 64-bit values and
returns 1 if the true sum did not fit, 0 otherwise.

The starter reports signed overflow instead. The two flags answer different
questions about the same addition.

@kind output
@concept Carry is unsigned overflow and the overflow flag is signed overflow,
and the processor computes both because it does not know which you meant.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The carry flag is the bit that did not fit. `setc` reads it.
@diagnose wrong verdict nonzero-exit
The check that fails involves two large positive values whose sum wraps, or two
values whose signed interpretation overflows and whose unsigned sum fits. `seto`
reads the overflow flag, which asks whether two operands of one sign produced a
result of the other. Unsigned overflow is the carry out, and `setc` reads that.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after The same addition sets carry and not overflow, or overflow and not carry,
or both, or neither, depending only on the values. The carry flag is also what
makes multi-word addition work: add the low halves, then add the high halves plus
the carry.

```starter
.intel_syntax noprefix
.text
.global add_carried
add_carried:
    xor eax, eax
    add rdi, rsi
    seto al
    ret
```

```tests
.global _start
_start:
    mov rdi, 1
    mov rsi, 2
    call add_carried
    cmp rax, 0
    jne fail
    mov rdi, -1
    mov rsi, 1
    call add_carried
    cmp rax, 1
    jne fail
    mov rdi, -1
    mov rsi, -1
    call add_carried
    cmp rax, 1
    jne fail
    mov rdi, 0x7FFFFFFFFFFFFFFF
    mov rsi, 1
    call add_carried
    cmp rax, 0
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
.global add_carried
add_carried:
    xor eax, eax
    add rdi, rsi
    setc al
    ret
```

## The flags are one register

Write `is_bigger`, returning 1 when `rdi` is greater than `rsi` as signed values.

The starter compares correctly and then does something between the comparison and
the branch. Nothing in the syntax connects those two instructions, so nothing
warns you.

@kind output
@concept The flags are shared state written by almost every arithmetic
instruction, so the distance between setting them and using them is not free.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Look at what sits between the `cmp` and the `setg`, and ask what it does
to the flags.
@diagnose wrong verdict nonzero-exit
The `add` between the comparison and the read overwrote the flags, so `setg`
answers a question about that addition rather than about the comparison. Either
move the clearing of `rax` before the `cmp`, or clear it with something that does
not touch the flags.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after `xor eax, eax` also writes the flags, which is why the fix puts it before
the comparison rather than after. `lea` is the instruction that would let you do
arithmetic in this gap without disturbing anything, and this is the pressure that
made it useful.

```starter
.intel_syntax noprefix
.text
.global is_bigger
is_bigger:
    cmp rdi, rsi
    xor eax, eax
    add eax, 0
    setg al
    ret
```

```tests
.global _start
_start:
    mov rdi, 5
    mov rsi, 3
    call is_bigger
    cmp rax, 1
    jne fail
    mov rdi, 3
    mov rsi, 5
    call is_bigger
    cmp rax, 0
    jne fail
    mov rdi, 4
    mov rsi, 4
    call is_bigger
    cmp rax, 0
    jne fail
    mov rdi, 1
    mov rsi, -1
    call is_bigger
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
.global is_bigger
is_bigger:
    xor eax, eax
    cmp rdi, rsi
    setg al
    ret
```

## A branch that is not a branch

Write `max_signed`, returning the larger of `rdi` and `rsi` as signed values,
using a conditional move rather than a jump.

@kind output
@concept A conditional move reads the flags and takes the same time whichever
way the condition goes, which is why it is used both for unpredictable branches
and for constant-time code.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Put one candidate in the destination, compare, then move the other one in
only if it is larger.
@diagnose wrong verdict nonzero-exit
The wrong value survives. The condition on the `cmov` has to match the order of
the operands in the `cmp`: after `cmp rax, rsi`, `cmovl rax, rsi` overwrites
`rax` exactly when `rax` was the smaller one.
@diagnose asm verdict compile-error
Read the line the assembler names. A conditional move needs a register
destination.
@after No branch means nothing to predict, which is a win when the condition is
unpredictable and a loss when it is not, because a correctly predicted branch is
nearly free and a conditional move always waits for its input. It also takes the
same time either way, which is why Part XV writes comparisons like this on
purpose.

```starter
.intel_syntax noprefix
.text
.global max_signed
max_signed:
    mov rax, rdi
    cmp rax, rsi
    cmovg rax, rsi
    ret
```

```tests
.global _start
_start:
    mov rdi, 3
    mov rsi, 9
    call max_signed
    cmp rax, 9
    jne fail
    mov rdi, 9
    mov rsi, 3
    call max_signed
    cmp rax, 9
    jne fail
    mov rdi, -4
    mov rsi, -9
    call max_signed
    cmp rax, -4
    jne fail
    mov rdi, 7
    mov rsi, 7
    call max_signed
    cmp rax, 7
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
.global max_signed
max_signed:
    mov rax, rdi
    cmp rax, rsi
    cmovl rax, rsi
    ret
```

## Testing without subtracting

Write `is_zero`, returning 1 when `rdi` is zero.

`test` performs a bitwise and and discards the result, keeping only the flags, so
`test rdi, rdi` sets the zero flag exactly when `rdi` is zero.

@kind output
@concept A comparison against zero needs no second operand, because a value
anded with itself is zero only when the value is.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint The zero flag, not the sign flag.
@diagnose wrong verdict nonzero-exit
`sets` reads the sign flag, which is the top bit of the result, so it reports
whether the value is negative rather than whether it is zero. `sete` reads the
zero flag.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after `test rax, rax` is the idiom for a zero check on every x86-64 compiler's
output, and it exists because it is shorter to encode than a comparison against
an immediate. The result of the and is thrown away and only the side effect is
wanted, which is the same shape as `cmp`.

```starter
.intel_syntax noprefix
.text
.global is_zero
is_zero:
    xor eax, eax
    test rdi, rdi
    sets al
    ret
```

```tests
.global _start
_start:
    mov rdi, 0
    call is_zero
    cmp rax, 1
    jne fail
    mov rdi, 1
    call is_zero
    cmp rax, 0
    jne fail
    mov rdi, -1
    call is_zero
    cmp rax, 0
    jne fail
    mov rdi, 0x8000000000000000
    call is_zero
    cmp rax, 0
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
.global is_zero
is_zero:
    xor eax, eax
    test rdi, rdi
    sete al
    ret
```

## The whole operand at once

Write `field`, which reads a field from an array of structs. Each struct is 16
bytes and the field is at offset 8. The base is in `rdi` and the struct index in
`rsi`.

Base, index, scale and displacement, all in one operand.

@kind output
@concept The displacement handles the field offset while the scale handles the
array stride, so a struct member of an array element is one instruction.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Sixteen bytes per struct is a scale of 8 on twice the index, or a scale of
8 with the index doubled first. The field offset is the displacement.
@diagnose wrong verdict nonzero-exit
The address is off. The stride is 16 bytes per struct, and the largest scale the
encoding offers is 8, so the index has to be doubled before it is scaled, or
scaled by 8 after being added to itself. Then the displacement of 8 selects the
field within the struct.
@diagnose asm verdict compile-error
Read the line the assembler names. The scale must be 1, 2, 4 or 8.
@after The scale is limited to those four values because they are the sizes that
matter, and anything else costs an extra instruction. That is the whole reason
struct sizes get rounded up to powers of two in code that indexes them hard, and
Part X returns to it as a layout decision rather than an encoding one.

```starter
.intel_syntax noprefix
.text
.global field
field:
    mov rax, [rdi + rsi*8 + 8]
    ret
```

```tests
.data
recs: .quad 1, 100
      .quad 2, 200
      .quad 3, 300
.text
.global _start
_start:
    lea rdi, [rip + recs]
    mov rsi, 0
    call field
    cmp rax, 100
    jne fail
    lea rdi, [rip + recs]
    mov rsi, 1
    call field
    cmp rax, 200
    jne fail
    lea rdi, [rip + recs]
    mov rsi, 2
    call field
    cmp rax, 300
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
.global field
field:
    lea rcx, [rsi + rsi]
    mov rax, [rdi + rcx*8 + 8]
    ret
```
