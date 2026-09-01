## A name nobody supplies

The starter calls a function that does not exist. Every instruction is legal and
the assembler is happy.

Define `helper` so the reference resolves. It should return 7.

@kind compile-error
@concept An undefined symbol is not a syntax error; the assembler emitted a hole
and a note saying somebody must fill it, and nobody did.
@backend godbolt
@lang asm
@expect verdict link-error
@hint The message names the symbol. Give it a definition in the same file.
@diagnose link verdict link-error
The linker names the symbol it could not find. `call helper` produced a
relocation, which is a request to write an address here once somebody supplies
one, and no file in the link supplied it. Defining the label is enough.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after This is the most common error in this part of the toolchain and it says
exactly what happened once you know what a symbol is. A typo, a missing file, a
library named before the code that uses it: all three produce this message and
all three mean nobody supplied the name.

```starter
.intel_syntax noprefix
.text
.global use_helper
use_helper:
    call helper
    ret
```

```tests
.global _start
_start:
    call use_helper
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
helper:
    mov rax, 7
    ret
.global use_helper
use_helper:
    call helper
    ret
```

## A hole in the data, not the code

Relocations are not only in instructions. A data word can hold the address of a
symbol, and that address is written when the linker knows it.

The starter stores the address of a name nothing defines. Point it at the
function beside it instead.

@kind compile-error
@concept A relocation is a request to write an address somewhere, and the
somewhere can be a data word as easily as an instruction operand.
@backend godbolt
@lang asm
@expect verdict link-error
@hint The linker names the symbol. There is a defined function in the same file.
@diagnose link verdict link-error
The linker names a symbol with no definition, and this time the reference is a
`.quad` rather than a `call`. The mechanism is the same: the assembler wrote
eight zero bytes and a note saying fill these in, and nobody supplied a value.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after This is the shape of every function pointer table, every virtual table and
every entry in the global offset table. A slot with a relocation attached, filled
in by whoever knows the address, which for a static link is the linker and for a
dynamic one is the loader.

```starter
.intel_syntax noprefix
.data
.global slot
slot: .quad nowhere
.text
.global target
target:
    mov rax, 5
    ret
```

```tests
.global _start
_start:
    lea rcx, [rip + slot]
    mov rcx, [rcx]
    call rcx
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
.data
.global slot
slot: .quad target
.text
.global target
target:
    mov rax, 5
    ret
```

## The section decides what you may do

`bump` increments a counter and returns the new value. The counter lives in a
section the starter chose badly.

@kind property
@concept A section carries permissions, and the loader enforces them, so where a
variable lives decides whether writing to it is legal.
@backend godbolt
@lang asm
@expect verdict signal
@hint Constants and variables do not live in the same place.
@diagnose sig verdict signal
The program was killed writing to memory it may read and not modify. `.rodata`
is mapped read-only, and the loader enforces the permission the linker recorded.
A variable that changes belongs in `.data`, or in `.bss` if it starts at zero.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after Nothing in the instruction was wrong and nothing in the assembler
complained. The permission was decided by which section the bytes went into, was
recorded in the file, and was enforced by the processor's page tables at the
moment of the write.

```starter
.intel_syntax noprefix
.section .rodata
counter: .quad 0
.text
.global bump
bump:
    lea rcx, [rip + counter]
    mov rax, [rcx]
    inc rax
    mov [rcx], rax
    ret
```

```tests
.global _start
_start:
    call bump
    cmp rax, 1
    jne fail
    call bump
    cmp rax, 2
    jne fail
    call bump
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
.data
counter: .quad 0
.text
.global bump
bump:
    lea rcx, [rip + counter]
    mov rax, [rcx]
    inc rax
    mov [rcx], rax
    ret
```

## Zero without occupying the file

`.bss` holds variables that start at zero. They take no space in the file, only a
recorded length, and the loader supplies pages of zeroes.

Write `sum_slots`, which adds four values into a `.bss` array and returns the
total. The array must be in `.bss` and must start at zero.

@kind output
@concept A section that is entirely zero needs no bytes on disk, only a length,
which is why a program with a large zeroed array is not a large file.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint `.bss` reserves space with `.space` or `.zero`, not with `.quad`.
@diagnose wrong verdict nonzero-exit
The total is wrong, which means the array did not start at zero or the stride is
off. `.bss` guarantees zeroes; eight-byte slots are eight bytes apart, so the
index scales by 8.
@diagnose asm verdict compile-error
Read the line the assembler names. `.bss` reserves rather than initialises, so
`.space 32` is the form.
@after A program with a ten megabyte zeroed array is not a ten megabyte file.
The section header says how much space is needed and the loader maps pages that
are already zero, which is also why touching them for the first time costs a page
fault rather than a read.

```starter
.intel_syntax noprefix
.bss
slots: .space 32
.text
.global sum_slots
sum_slots:
    lea rcx, [rip + slots]
    xor rax, rax
    mov qword ptr [rcx + 0], 1
    mov qword ptr [rcx + 8], 2
    add rax, [rcx + 0]
    add rax, [rcx + 8]
    ret
```

```tests
.global _start
_start:
    call sum_slots
    cmp rax, 10
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
.bss
slots: .space 32
.text
.global sum_slots
sum_slots:
    lea rcx, [rip + slots]
    mov qword ptr [rcx + 0], 1
    mov qword ptr [rcx + 8], 2
    mov qword ptr [rcx + 16], 3
    mov qword ptr [rcx + 24], 4
    xor rax, rax
    add rax, [rcx + 0]
    add rax, [rcx + 8]
    add rax, [rcx + 16]
    add rax, [rcx + 24]
    ret
```

## A dependency that may not be there

A weak undefined symbol is a reference that is allowed to go unresolved. If
nothing defines it, its address is zero rather than an error, and the program can
check at run time whether the thing exists.

Write `has_optional`, returning 1 when `optional_feature` is defined and 0 when
it is not. Nothing defines it here.

@kind compile-error
@concept A weak reference turns a link error into a run-time question, which is
how a program uses an optional dependency without requiring it.
@backend godbolt
@lang asm
@expect verdict link-error
@hint One directive tells the linker that this reference may go unresolved.
@diagnose link verdict link-error
The linker refuses, because an ordinary undefined reference must be satisfied.
`.weak optional_feature` says this one need not be: if nothing defines it the
address is left at zero, which the code can then test.
@diagnose wrong verdict nonzero-exit
The reference is weak now and the test is backwards. A zero address means absent,
so the answer is 1 exactly when the address is not zero.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after This is how a library detects that an optional component was linked in,
with no configuration file and no registration function. The check is a
comparison against zero, and the answer was decided by whether anything in the
link happened to supply the name.

```starter
.intel_syntax noprefix
.text
.global has_optional
has_optional:
    lea rcx, [rip + optional_feature]
    xor eax, eax
    test rcx, rcx
    setnz al
    ret
```

```tests
.global _start
_start:
    call has_optional
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
.weak optional_feature
.text
.global has_optional
has_optional:
    mov rcx, offset optional_feature
    xor eax, eax
    test rcx, rcx
    setnz al
    ret
```

## Data is not executable

`.text` may be executed and not written. `.data` may be written and not executed.
Both permissions are recorded by the linker and enforced by the processor.

The starter copies a valid `ret` instruction into a data buffer and jumps to it.
Every byte is correct. Run the real function instead.

@kind property
@concept Write and execute are separate permissions on separate pages, and a
region that has one is deliberately denied the other.
@backend godbolt
@lang asm
@expect verdict signal
@hint There is nothing wrong with the bytes. There is something wrong with where
they are.
@diagnose sig verdict signal
The program was killed jumping into a data page. The byte in the buffer really is
a valid `ret`, and the processor refused to fetch it because the page it lives on
is not marked executable. This is the same enforcement that stopped the write in
the previous exercise, applied to the other permission.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after A page that is both writable and executable is what an attacker who can
write bytes wants, so modern systems refuse to map one. A just-in-time compiler
therefore has to write its code into a writable page and then ask the kernel to
change the permission before jumping to it, which is a syscall in the middle of
what looks like ordinary code generation.

```starter
.intel_syntax noprefix
.data
buf: .byte 0xC3
.text
.global run_it
run_it:
    mov rax, 7
    lea rcx, [rip + buf]
    jmp rcx
```

```tests
.global _start
_start:
    call run_it
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
.data
buf: .byte 0xC3
.text
.global run_it
run_it:
    mov rax, 7
    ret
```

## Alignment is a section property too

Write `read_aligned`, returning the eight-byte value stored at `aligned`.

The starter places a byte before the value and does not realign, so the value
does not begin on an eight-byte boundary and the offsets no longer line up.

@kind output
@concept The assembler emits bytes in order, so a declaration's address depends
on everything declared before it, and alignment is something you ask for.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint There is a directive that pads to the next boundary.
@diagnose wrong verdict nonzero-exit
The value read is not the one stored. The stray byte before it shifted
everything by one, so the eight bytes at the label are seven bytes of the value
and one byte of whatever follows. `.align 8` pads to the next boundary before the
label.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after On x86-64 a misaligned load works and costs a little; on several other
architectures it faults. The reason the directive exists at all is that the
assembler lays out bytes in the order you wrote them and has no idea which of
them you intended to be addressable.

```starter
.intel_syntax noprefix
.data
pad:     .byte 1
aligned: .quad 0x1122334455667788
.text
.global read_aligned
read_aligned:
    lea rcx, [rip + aligned]
    mov rax, [rcx]
    ret
```

```tests
.global _start
_start:
    call read_aligned
    mov rcx, 0x1122334455667788
    cmp rax, rcx
    jne fail
    call check_align
    cmp rax, 0
    jne fail
    mov edi, 0
    mov eax, 60
    syscall
fail:
    mov edi, 1
    mov eax, 60
    syscall
.global check_align
check_align:
    lea rax, [rip + aligned]
    and rax, 7
    ret
```

```solution
.intel_syntax noprefix
.data
pad:     .byte 1
.align 8
aligned: .quad 0x1122334455667788
.text
.global read_aligned
read_aligned:
    lea rcx, [rip + aligned]
    mov rax, [rcx]
    ret
```

## The address of a name

Write `pick`, which returns the address of `first` when `rdi` is zero and the
address of `second` otherwise, then calls through it and returns the result.

Both names are functions in this file. Obtaining a symbol's address is a
relocation like any other, and there are two spellings.

@kind output
@concept Taking the address of a symbol is a relocation the linker fills, and it
is the same mechanism whether the target is code or data.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Select the address first, then call through the register.
@diagnose wrong verdict nonzero-exit
The wrong function ran. `lea rcx, [rip + name]` puts the address of `name` into
`rcx` without reading anything; the conditional move then picks between two such
addresses, and the call goes through whichever survived.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after Every virtual dispatch is this: an address selected at run time and called
through a register. What the linker contributed was knowing where `first` and
`second` ended up, which nothing in the compiled instruction stream could have
known.

```starter
.intel_syntax noprefix
.text
first:
    mov rax, 11
    ret
second:
    mov rax, 22
    ret
.global pick
pick:
    lea rcx, [rip + first]
    call rcx
    ret
```

```tests
.global _start
_start:
    mov rdi, 0
    call pick
    cmp rax, 11
    jne fail
    mov rdi, 1
    call pick
    cmp rax, 22
    jne fail
    mov rdi, 99
    call pick
    cmp rax, 22
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
first:
    mov rax, 11
    ret
second:
    mov rax, 22
    ret
.global pick
pick:
    lea rcx, [rip + first]
    lea rdx, [rip + second]
    test rdi, rdi
    cmovnz rcx, rdx
    call rcx
    ret
```
