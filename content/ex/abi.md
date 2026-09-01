## The sixth argument

Write `arg6`, returning its sixth argument.

The first six integer arguments arrive in `rdi`, `rsi`, `rdx`, `rcx`, `r8`, `r9`,
in that order. Nothing in the function's text says so.

@kind output
@concept The argument registers are an agreement two compiled things keep
without either seeing the other's source.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Count along the list. The sixth is the last one that arrives in a register.
@diagnose wrong verdict nonzero-exit
The wrong register was returned. The order is `rdi`, `rsi`, `rdx`, `rcx`, `r8`,
`r9`, so the sixth argument is in `r9` and the fifth is in `r8`. Nothing in the
code names them, which is precisely what makes this the kind of mistake a
compiler cannot catch.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after A seventh argument would have arrived on the stack, above the return
address. Six was somebody's estimate of where the benefit of a register stops
paying for the cost of preserving it, and the estimate has outlived everything
else about the machine it was made for.

```starter
.intel_syntax noprefix
.text
.global arg6
arg6:
    mov rax, r8
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
    call arg6
    cmp rax, 6
    jne fail
    mov rdi, 10
    mov rsi, 20
    mov rdx, 30
    mov rcx, 40
    mov r8, 50
    mov r9, 60
    call arg6
    cmp rax, 60
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
.global arg6
arg6:
    mov rax, r9
    ret
```

## The registers you must give back

Write `uses_rbx`, which needs a scratch register and picks one the caller expects
to survive.

`rbx`, `rbp` and `r12` through `r15` must be preserved. Everything else may be
destroyed.

@kind output
@concept Half the contract is which registers a called function may overwrite,
and breaking it corrupts the caller in a way nothing reports.
@backend godbolt
@lang asm
@expect verdict nonzero-exit
@hint Either save and restore it, or use a register the caller does not expect
back.
@diagnose wrong verdict nonzero-exit
The caller's value in `rbx` came back changed. It is one of the six the callee
must preserve, so a function using it has to push it on entry and pop it before
returning, or use one of the volatile registers instead.
@diagnose asm verdict compile-error
Read the line the assembler names.
@after Nothing checks this. The caller kept a value in a register the agreement
said was safe, the callee used it anyway, and the corruption appears somewhere
else entirely. Six preserved out of sixteen is a negotiation: more and every
function pays to save them, fewer and every caller pays to reload.

```starter
.intel_syntax noprefix
.text
.global uses_rbx
uses_rbx:
    mov rbx, rdi
    add rbx, 100
    mov rax, rbx
    ret
```

```tests
.global _start
_start:
    mov rbx, 12345
    mov rdi, 7
    call uses_rbx
    cmp rax, 107
    jne fail
    /* The caller's rbx must have survived the call. */
    cmp rbx, 12345
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
    add rbx, 100
    mov rax, rbx
    pop rbx
    ret
```

## Sixteen at the call

The stack must be sixteen-byte aligned when a `call` executes. `call` itself
pushes eight bytes, so on entry to a function it is eight out.

Write `aligned_at_call`, returning 1 when the stack it is about to make a call on
would be correctly aligned, given the stack pointer's low bits on entry and how
many eight-byte pushes have happened since.

@kind output
@concept The rule is enforced by nothing, so a routine that gets it wrong works
until the callee uses an aligned instruction.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint On entry the pointer is eight past a boundary. An odd number of pushes
brings it back.
@diagnose assert verdict assert-failed
A check disagrees. On entry the stack is misaligned by eight, because `call`
pushed the return address, so an odd number of further pushes realigns it and an
even number does not. Assuming entry is aligned inverts every answer.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is the bug in every hand-written assembly routine that crashes only
when it calls something else. Its own code never needed the alignment; the
library function it called used one aligned load and died, several frames away
from the mistake.

```starter
int aligned_at_call(int pushes) {
    return pushes % 2 == 0;
}
```

```tests
#include <assert.h>
int aligned_at_call(int);
int main(void) {
    /* No pushes: still eight out from the call that got here. */
    assert(aligned_at_call(0) == 0);
    /* One push realigns. */
    assert(aligned_at_call(1) == 1);
    assert(aligned_at_call(2) == 0);
    assert(aligned_at_call(3) == 1);
    assert(aligned_at_call(4) == 0);
    return 0;
}
```

```solution
int aligned_at_call(int pushes) {
    return pushes % 2 == 1;
}
```

## In registers, or in memory

Write `passed_in_registers`, reporting whether a structure of the given size and
triviality travels in registers.

Up to sixteen bytes and trivially copyable goes in registers, chunk by chunk.
Anything else is passed in memory with the caller supplying the storage.

@kind output
@concept The rule is an algorithm over eight-byte chunks rather than a table,
which is why a structure of an integer and a double occupies one register of each
kind.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two conditions, and both must hold.
@diagnose assert verdict assert-failed
A check disagrees. Size alone is not enough: a sixteen-byte type holding
something with a destructor is passed in memory however small it is, because the
caller has to own storage the callee can destroy. Both conditions have to be
checked.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Two integers go in one register. An integer and a double go in one integer
register and one vector register, because the classification is per eight-byte
chunk and each chunk goes where its contents belong. Twenty-four bytes goes in
memory whatever it contains, which is a real reason to keep a hot value type at
or under sixteen.

```starter
int passed_in_registers(int size_bytes, int trivially_copyable) {
    (void)trivially_copyable;
    return size_bytes <= 16;
}
```

```tests
#include <assert.h>
int passed_in_registers(int, int);
int main(void) {
    /* Two ints: one register. */
    assert(passed_in_registers(8, 1) == 1);
    /* Two longs: two registers, still the limit. */
    assert(passed_in_registers(16, 1) == 1);
    /* Three longs: memory. */
    assert(passed_in_registers(24, 1) == 0);
    /* Small and non-trivial: memory anyway. */
    assert(passed_in_registers(8, 0) == 0);
    assert(passed_in_registers(16, 0) == 0);
    return 0;
}
```

```solution
int passed_in_registers(int size_bytes, int trivially_copyable) {
    return size_bytes <= 16 && trivially_copyable;
}
```

## The argument you did not write

A large return value is written through a hidden pointer the caller passes as an
extra first argument, so every declared argument shifts by one.

Write `register_for_arg`, returning which register a declared argument arrives in,
given whether the return value needs that hidden pointer.

Registers are numbered 0 for `rdi` through 5 for `r9`, and -1 for the stack.

@kind output
@concept A function returning a large structure takes one more argument than it
appears to, and that is visible the moment you read a disassembly.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The hidden pointer takes the first register, so everything else moves along
one.
@diagnose assert verdict assert-failed
A check disagrees. With a hidden return pointer, the first declared argument
arrives in `rsi` rather than `rdi`, and the sixth is pushed to the stack because
only five registers are left. Ignoring the shift puts every argument one place
early.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Which is why a function that looks like it takes three arguments and
returns a container actually takes four and returns nothing, and why the argument
registers in its disassembly do not line up with its declaration. The caller
allocated the storage, passed its address, and the callee filled it in.

```starter
int register_for_arg(int index, int hidden_return_pointer) {
    (void)hidden_return_pointer;
    return index < 6 ? index : -1;
}
```

```tests
#include <assert.h>
int register_for_arg(int, int);
int main(void) {
    /* An ordinary function: argument 0 is in rdi. */
    assert(register_for_arg(0, 0) == 0);
    assert(register_for_arg(5, 0) == 5);
    assert(register_for_arg(6, 0) == -1);
    /* With a hidden return pointer everything shifts by one. */
    assert(register_for_arg(0, 1) == 1);
    assert(register_for_arg(4, 1) == 5);
    /* And the sixth declared argument no longer fits. */
    assert(register_for_arg(5, 1) == -1);
    return 0;
}
```

```solution
int register_for_arg(int index, int hidden_return_pointer) {
    int slot = index + (hidden_return_pointer ? 1 : 0);
    return slot < 6 ? slot : -1;
}
```

## Changes that break silently

Write `breaks_abi`, reporting whether a change to a library breaks binary
compatibility with programs already compiled against it.

The kinds are: 0 adding a non-virtual member function, 1 adding a data member, 2
adding a virtual function, 3 reordering data members, 4 changing the body of an
inline function, 5 renaming a parameter.

@kind output
@concept Almost none of the changes that break binary compatibility look like
breaking changes in the header, which is why evolving a library is stricter than
writing one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Anything that changes a size, an offset, a table layout, or code already
copied into a caller.
@diagnose assert verdict assert-failed
A check disagrees. Adding a non-virtual member function is safe, because it adds
a symbol and changes no layout. Adding a data member is not, because every caller
that allocated one of these is now allocating the wrong amount, and the header
change looks identical in kind.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Changing an inline function is the one people miss. Its body was copied
into every caller at their build time, so the new version applies only to code
recompiled since, and a program can end up running two versions of the same
function. That is why a library meaning to be stable puts its members behind a
pointer and keeps its inline functions trivial.

```starter
int breaks_abi(int change_kind) {
    return change_kind == 1 || change_kind == 3;
}
```

```tests
#include <assert.h>
int breaks_abi(int);
int main(void) {
    /* A new non-virtual member function adds a symbol and changes no layout. */
    assert(breaks_abi(0) == 0);
    /* A new data member changes the size. */
    assert(breaks_abi(1) == 1);
    /* A new virtual function changes the table layout. */
    assert(breaks_abi(2) == 1);
    /* Reordering changes every offset. */
    assert(breaks_abi(3) == 1);
    /* An inline body was already copied into every caller. */
    assert(breaks_abi(4) == 1);
    /* A parameter name appears in no compiled artefact. */
    assert(breaks_abi(5) == 0);
    return 0;
}
```

```solution
int breaks_abi(int change_kind) {
    switch (change_kind) {
    case 1: case 2: case 3: case 4: return 1;
    default: return 0;
    }
}
```

## The interface everything speaks

Write `c_abi_expressible`, reporting whether a construct can cross a C interface.

The kinds are: 0 a pointer, 1 an integer, 2 a struct of plain data, 3 a C++
template, 4 an exception propagating out, 5 a function with a destructor running
on return.

@kind output
@concept The C ABI is the universal interface because it is small enough for
every language to implement, and what it excludes is exactly what makes the C++
one enormous.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Anything that needs the compiler to generate code at the boundary does not
cross it.
@diagnose assert verdict assert-failed
A check disagrees. A struct of plain data crosses fine, because its layout is
decided by the machine rather than by a language. A template does not, because
there is nothing to call until it is instantiated and no name for it that another
language could produce.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after No mangling, no exceptions, no destructors, no templates. That is the
whole of it, and it is why `extern "C"` exists, why every foreign function
interface targets it, and why a library meant to be used from more than one
language exposes a C surface whatever it is written in.

```starter
int c_abi_expressible(int kind) {
    return kind < 4;
}
```

```tests
#include <assert.h>
int c_abi_expressible(int);
int main(void) {
    assert(c_abi_expressible(0) == 1);
    assert(c_abi_expressible(1) == 1);
    assert(c_abi_expressible(2) == 1);
    /* A template has nothing to call until it is instantiated. */
    assert(c_abi_expressible(3) == 0);
    /* Unwinding across the boundary has no defined behaviour. */
    assert(c_abi_expressible(4) == 0);
    /* Nothing runs code on the way out of a C function. */
    assert(c_abi_expressible(5) == 0);
    return 0;
}
```

```solution
int c_abi_expressible(int kind) {
    return kind <= 2;
}
```

## Two versions of one type

When `std::string` had to change layout, GCC shipped both, distinguished in the
mangled names, so mixing them gives an undefined symbol rather than corruption.

Write `link_outcome`, returning 0 when two objects link, 1 when they produce an
undefined symbol, and 2 when they would link and be silently wrong.

@kind output
@concept An incompatible change made loud at link time is better than one that
runs, which is why the mangled name carries the version.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The version is in the name, so a mismatch cannot resolve.
@diagnose assert verdict assert-failed
A check disagrees. Two objects built against different versions of the type have
different mangled names for every function taking it, so the linker finds nothing
and says so. Silent corruption is the outcome the naming scheme exists to
prevent, and it happens only when the layout changed and the name did not.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The undefined symbol is the feature. Given a choice between an error at
link time and a program that runs and is wrong, the break was made loud on
purpose, and the resulting message has confused a decade of people who were being
protected by it.

```starter
int link_outcome(int version_a, int version_b, int name_encodes_version) {
    (void)name_encodes_version;
    return version_a == version_b ? 0 : 2;
}
```

```tests
#include <assert.h>
int link_outcome(int, int, int);
int main(void) {
    /* Same version: links and works. */
    assert(link_outcome(1, 1, 1) == 0);
    assert(link_outcome(2, 2, 1) == 0);
    /* Different versions, encoded in the name: an undefined symbol. */
    assert(link_outcome(1, 2, 1) == 1);
    /* Different versions and the name does not say: links, and is wrong. */
    assert(link_outcome(1, 2, 0) == 2);
    return 0;
}
```

```solution
int link_outcome(int version_a, int version_b, int name_encodes_version) {
    if (version_a == version_b) return 0;
    return name_encodes_version ? 1 : 2;
}
```
