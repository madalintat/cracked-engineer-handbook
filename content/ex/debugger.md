## Patching one byte of a word

Write `patch_trap`, returning the word to write back when installing a
breakpoint, given the original word read from the program.

Only the lowest byte is replaced, with the trap byte 0xCC. Every other byte of
the word has to survive, because those bytes are the instructions that follow.

@kind output
@concept The unit of a read and a write here is a word, and the unit of the
change is a byte, so the other seven bytes have to be put back exactly.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Clear the low byte, then set it. Anything that touches the upper bytes
corrupts the instructions after the breakpoint.
@diagnose assert verdict assert-failed
A check disagrees. Writing 0xCC into the word without clearing the byte that was
there leaves the original bits set as well, so the byte becomes neither the trap
nor the instruction.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A real transcript: the original word is 0x10ec8348e5894855 and the
patched word is 0x10ec8348e58948cc. Only the last two hex digits differ.

```starter
unsigned long patch_trap(unsigned long word) {
    return word | 0xCCUL;
}
```

```tests
#include <assert.h>
unsigned long patch_trap(unsigned long);
int main(void) {
    assert(patch_trap(0x10ec8348e5894855UL) == 0x10ec8348e58948ccUL);
    assert(patch_trap(0x00UL) == 0xccUL);
    assert(patch_trap(0xffffffffffffffffUL) == 0xffffffffffffffccUL);
    assert(patch_trap(0xaabbccddeeff0011UL) == 0xaabbccddeeff00ccUL);
    return 0;
}
```

```solution
unsigned long patch_trap(unsigned long word) {
    return (word & ~0xFFUL) | 0xCCUL;
}
```

## Putting the instruction back

Write `restore_word`, returning the word to write back when removing a
breakpoint, given the word currently in memory and the original first byte that
was saved when the breakpoint was installed.

Everything except the lowest byte comes from what is in memory now, because the
program may have been modified since, and the lowest byte is the saved one.

@kind output
@concept The debugger saves one byte and restores one byte. Saving the whole
word and writing it back would undo any other change made in the meantime.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The saved byte replaces the trap byte and nothing else moves.
@diagnose assert verdict assert-failed
A check disagrees. Only the lowest byte was ever changed, so only the lowest
byte is restored, and it comes from the saved value rather than from the word in
memory.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Restoring, stepping one instruction and writing the trap byte again is
what every resume costs, which is several system calls and two context switches
per breakpoint hit.

```starter
unsigned long restore_word(unsigned long current, unsigned char saved) {
    (void)saved;
    return current;
}
```

```tests
#include <assert.h>
unsigned long restore_word(unsigned long, unsigned char);
int main(void) {
    assert(restore_word(0x10ec8348e58948ccUL, 0x55) == 0x10ec8348e5894855UL);
    assert(restore_word(0xccUL, 0x90) == 0x90UL);
    assert(restore_word(0xffffffffffffffccUL, 0x00) == 0xffffffffffffff00UL);
    return 0;
}
```

```solution
unsigned long restore_word(unsigned long current, unsigned char saved) {
    return (current & ~0xFFUL) | saved;
}
```

## Where the program actually stopped

Write `report_stop`, returning the address to report to the user when the
program stops, given the instruction pointer at the stop and whether the stop
was a breakpoint trap rather than some other signal.

After a trap byte the instruction pointer is one past the breakpoint, so the
breakpoint's address is one less. Any other kind of stop reports the instruction
pointer as it is.

@kind output
@concept The correction is not cosmetic. The same value has to be written back
to the registers, or the program resumes into the middle of an instruction.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only a trap consumed a byte. A segmentation fault did not.
@diagnose assert verdict assert-failed
A check disagrees. Subtracting one from every stop moves the reported address of
a genuine fault, and a fault is exactly the case where the address matters most.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Distinguishing a breakpoint trap from a real fault is a separate request
to the same system call, and getting it wrong is how a debugger reports a crash
one byte away from where it happened.

```starter
unsigned long report_stop(unsigned long rip, int was_breakpoint) {
    (void)was_breakpoint;
    return rip - 1;
}
```

```tests
#include <assert.h>
unsigned long report_stop(unsigned long, int);
int main(void) {
    assert(report_stop(0x401177, 1) == 0x401176);
    assert(report_stop(0x401177, 0) == 0x401177);
    assert(report_stop(0x1000, 1) == 0x0fff);
    assert(report_stop(0x1000, 0) == 0x1000);
    return 0;
}
```

```solution
unsigned long report_stop(unsigned long rip, int was_breakpoint) {
    return was_breakpoint ? rip - 1 : rip;
}
```

## What a hardware watchpoint can cover

Write `watch_in_hardware`, deciding whether a watchpoint request fits in the
processor's debug registers, given how many are already in use and how many
bytes the request covers.

There are four registers and each covers at most eight bytes. A request larger
than eight bytes does not fit in one, and this model does not split it across
several. Return 1 when it fits and 0 when the debugger will fall back to single
stepping.

@kind output
@concept The budget is small and fixed, and the fallback is not a refusal, so
the difference between fitting and not fitting is the difference between free
and hundreds of times slower.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two limits, both hard: how many are left, and how wide one can be.
@diagnose assert verdict assert-failed
A check disagrees. A four byte counter with all four registers already in use
does not fit, and neither does a sixteen byte structure with every register
free. Both end up single stepping.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Someone who does not know about the fallback concludes that the debugger
has hung, which is the most common way this budget is discovered.

```starter
int watch_in_hardware(unsigned in_use, unsigned bytes) {
    (void)bytes;
    return in_use < 4;
}
```

```tests
#include <assert.h>
int watch_in_hardware(unsigned, unsigned);
int main(void) {
    assert(watch_in_hardware(0, 4) == 1);
    assert(watch_in_hardware(3, 8) == 1);
    assert(watch_in_hardware(4, 4) == 0);   /* no register left */
    assert(watch_in_hardware(0, 16) == 0);  /* too wide */
    assert(watch_in_hardware(0, 9) == 0);
    assert(watch_in_hardware(2, 1) == 1);
    return 0;
}
```

```solution
int watch_in_hardware(unsigned in_use, unsigned bytes) {
    return in_use < 4 && bytes <= 8;
}
```

## Eight bytes to one

Write `shadow_addr`, returning the address of the shadow byte that describes a
given address, using the sanitizer's mapping.

Eight application bytes map to one shadow byte, and the shadow region starts at
a fixed offset.

@kind output
@concept The mapping is a shift and an add, which is why the check in front of
every load and store is cheap enough to leave on.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Eight to one is a shift of three, and it happens before the offset is
added rather than after.
@diagnose assert verdict assert-failed
A check disagrees. Adding the offset before shifting scales the offset too, and
the whole shadow region lands somewhere else. Eight consecutive addresses have
to give the same shadow byte.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after One eighth of the address space is reserved for this, almost all of it
untouched virtual memory, which is the other half of why the technique is
affordable.

```starter
unsigned long shadow_addr(unsigned long addr, unsigned long offset) {
    return (addr + offset) >> 3;
}
```

```tests
#include <assert.h>
unsigned long shadow_addr(unsigned long, unsigned long);
int main(void) {
    assert(shadow_addr(0, 0x7fff8000UL) == 0x7fff8000UL);
    assert(shadow_addr(8, 0x7fff8000UL) == 0x7fff8001UL);
    /* Eight consecutive bytes share one shadow byte. */
    assert(shadow_addr(16, 0x7fff8000UL) == shadow_addr(23, 0x7fff8000UL));
    assert(shadow_addr(16, 0x7fff8000UL) != shadow_addr(24, 0x7fff8000UL));
    assert(shadow_addr(0x1000, 0) == 0x200UL);
    return 0;
}
```

```solution
unsigned long shadow_addr(unsigned long addr, unsigned long offset) {
    return (addr >> 3) + offset;
}
```

## Reading a shadow byte

Write `access_ok`, deciding whether an access is allowed, given the shadow byte
covering it, the offset of the access within those eight bytes, and its size in
bytes.

A shadow byte of 0 means all eight are addressable. A value from 1 to 7 means
the first that many bytes are addressable and the rest are not. Anything else,
which is any value with the top bit set, means all eight are poisoned.

The access runs from the offset for its size, and every byte it touches has to
be addressable.

@kind output
@concept The partial case exists only because allocations are eight byte
aligned, so a block can be partial at its end and never at its start.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The last byte touched is at offset plus size minus one, and it has to be
below the count of addressable bytes.
@diagnose assert verdict assert-failed
A check disagrees. An access of four bytes at offset 0 with a shadow byte of 4
is entirely inside the addressable prefix and is allowed. The same access at
offset 1 is not, because its last byte is the fifth.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is two well predicted branches in front of every memory operation in
your program, and it is why the cost is around a factor of two rather than a
factor of twenty.

```starter
int access_ok(unsigned char shadow, unsigned offset, unsigned size) {
    (void)offset; (void)size;
    return shadow == 0;
}
```

```tests
#include <assert.h>
int access_ok(unsigned char, unsigned, unsigned);
int main(void) {
    assert(access_ok(0, 0, 8) == 1);    /* all eight usable */
    assert(access_ok(0, 4, 4) == 1);
    assert(access_ok(4, 0, 4) == 1);    /* exactly the prefix */
    assert(access_ok(4, 0, 5) == 0);    /* one past it */
    assert(access_ok(4, 1, 4) == 0);
    assert(access_ok(4, 3, 1) == 1);
    assert(access_ok(4, 4, 1) == 0);
    assert(access_ok(0xfd, 0, 1) == 0); /* freed memory */
    assert(access_ok(0xfa, 0, 1) == 0); /* heap redzone */
    return 0;
}
```

```solution
int access_ok(unsigned char shadow, unsigned offset, unsigned size) {
    if (shadow == 0) return 1;
    if (shadow > 7) return 0;
    if (size == 0) return 1;
    return offset + size <= shadow;
}
```

## The window a quarantine buys

Write `uaf_detected`, deciding whether a use after free is caught, given how many
bytes have been allocated since the block was freed and the size of the
quarantine.

A freed block is poisoned and held rather than reused. It is only recycled once
allocation traffic since the free has exceeded the quarantine's size, and after
that the address is handed out again and the access is silent.

@kind output
@concept The detector has a window, and the window is a memory budget, so a
clean run is evidence rather than proof.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Traffic exactly equal to the quarantine has not yet exceeded it.
@diagnose assert verdict assert-failed
A check disagrees. Inside the window the block is still poisoned and the report
is precise. Past it the address has been reused and nothing is reported at all,
which is the case worth knowing about.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A clean sanitizer run does not prove your program has no use after free.
It proves that none happened inside this window, on the paths this run took, in
code that was recompiled.

```starter
int uaf_detected(unsigned long traffic, unsigned long quarantine) {
    (void)traffic; (void)quarantine;
    return 1;
}
```

```tests
#include <assert.h>
int uaf_detected(unsigned long, unsigned long);
int main(void) {
    assert(uaf_detected(0, 1000) == 1);
    assert(uaf_detected(999, 1000) == 1);
    assert(uaf_detected(1000, 1000) == 1);   /* not yet exceeded */
    assert(uaf_detected(1001, 1000) == 0);   /* recycled */
    assert(uaf_detected(5000, 1000) == 0);
    return 0;
}
```

```solution
int uaf_detected(unsigned long traffic, unsigned long quarantine) {
    return traffic <= quarantine;
}
```

## What a breakpoint costs per hit

Write `stops_per_hit`, returning how many times the traced program stops for one
breakpoint hit, given whether the breakpoint has to stay armed afterwards.

Hitting the trap stops it once. Resuming through an armed breakpoint means
restoring the byte and stepping one instruction, which stops it again, before
the trap byte is written back. A breakpoint being removed does not need the
second stop.

@kind output
@concept The cost is not the check. It is the restore, step and re-arm dance,
paid on every hit, in system calls and context switches.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One stop for the trap, and one more only if the byte has to go back.
@diagnose assert verdict assert-failed
A check disagrees. A breakpoint that stays armed costs two stops per hit, not
one, because the single step is a stop of its own.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why a breakpoint inside a hot loop feels like a hang, and why
timing a program under a debugger measures the debugger.

```starter
unsigned stops_per_hit(int stays_armed) {
    (void)stays_armed;
    return 1;
}
```

```tests
#include <assert.h>
unsigned stops_per_hit(int);
int main(void) {
    assert(stops_per_hit(1) == 2);
    assert(stops_per_hit(0) == 1);
    return 0;
}
```

```solution
unsigned stops_per_hit(int stays_armed) {
    return stays_armed ? 2 : 1;
}
```
