---
needs: [cmos-gate, arithmetic]
minutes: 50
one_idea: Signed overflow is not a wrapping operation. It is a promise you made to the compiler, and the compiler will cash it.
sources: [numbers-text-numerics, compilers-interpreters-terminals-unix]
---

Two units ago you built an adder out of NAND gates and discovered that
subtraction came free: invert one operand, set the carry in, and the same
hardware does both. That was a fact about [[twos-complement|two's complement]], and it is the reason
every machine you will ever touch represents signed integers that way.

This unit is about what happens at the edges of that representation, where
[[overflow]] stops being arithmetic and becomes a promise, and it contains the
single most surprising thing in the C family.

## The representation, briefly

An `n`-bit two's complement number represents `-2^(n-1)` through `2^(n-1) - 1`.
The top bit is not a sign flag you consult; it carries a negative weight.

```
 8-bit, unsigned      8-bit, two's complement
 -----------------    -----------------------
 10000000 = 128       10000000 = -128
 11111111 = 255       11111111 = -1
 01111111 = 127       01111111 =  127
```

Three properties fall out of this, and they are the whole reason the scheme won.

There is one zero. Sign-magnitude and ones' complement both have a positive and
a negative zero, and every comparison then has to handle two bit patterns that
mean the same thing.

Addition does not care about sign. The adder you built adds the bit patterns,
and if you interpret the operands as signed the result is correct as signed. No
extra hardware, no separate instruction.

Negation is invert-and-add-one, which is why subtraction is addition with one
operand inverted and the carry in set. One control bit.

The asymmetry is the price. There are 128 negative values and 127 positive ones,
so `-INT_MIN` has no representable answer. `abs(INT_MIN)` is negative on every
machine you will use. That is not a bug in your standard library.

Widen that to 32 bits and the shape is the same. The top bit is not a flag the
hardware inspects; it is a bit with a negative weight, and the ranges follow
from that one fact.

```figure
{
  "kind": "bits",
  "alt": "A 32-bit signed integer showing the top bit as the sign and the remaining 31 bits as magnitude, with the ranges each end holds.",
  "caption": "A 32-bit int. The top bit is not a flag the hardware checks, it is the bit with weight minus two to the thirty-first, which is why the negative range reaches one further than the positive one.",
  "bits": 32,
  "groups": [
    { "from": 31, "to": 31, "label": "s", "accent": "clay" },
    { "from": 0, "to": 30, "label": "the other 31 bits", "accent": "azure" }
  ],
  "brackets": [
    { "from": 0, "to": 30, "label": "0 to 2147483647", "lane": 0, "accent": "azure" },
    { "from": 0, "to": 31, "label": "-2147483648 to 2147483647", "lane": 1, "accent": "clay" }
  ]
}
```

## Widening, and the bit that gets copied

When a narrow value goes into a wider register, the new high bits have to come
from somewhere. For an unsigned value they are zeros. For a signed value they
are copies of the sign bit, which is what keeps the number's value the same.

That is a real instruction. On x86-64 you will meet `movsx` and `movzx`, and
which one appears tells you how the compiler understood the type:

```
signed char c;   int i = c;     ->  movsx eax, byte ptr [rbp-1]
unsigned char c; int i = c;     ->  movzx eax, byte ptr [rbp-1]
```

One quirk of the same instruction set is worth memorising now, because it will
confuse you later. **Writing to a 32-bit register zeroes the upper 32 bits;
writing to a 16-bit or 8-bit one does not.**

```
mov eax, -1     ; rax is now 0x00000000FFFFFFFF
mov ax,  -1     ; the top 48 bits of rax are untouched
```

So `mov eax, eax` is not a no-op. It is a zero-extension, and compilers emit it
on purpose. That asymmetry was a deliberate choice when AMD designed the 64-bit
extension: it removes a dependency on the register's previous value, which lets
the processor's renamer break a chain that would otherwise serialise.

You will see this again in the unit on registers. Here it is enough to notice
that "convert this number to a wider type" is not free and not invisible; it is
an instruction whose choice was made by the type you wrote.

## The surprise

Here is a program. Read it and predict what it prints.

```c
#include <stdio.h>
int main(void) {
    int x = 2147483647;   // INT_MAX
    printf("%d\n", x + 1 > x);
    return 0;
}
```

You will find people who tell you it prints 0 at `-O0` and 1 at `-O2`. Measure
it on current compilers and something more interesting happens. Here is the
whole of `main` at `-O2`, from each:

```
gcc 16.2                       clang 23.1
  sub  rsp, 8                    push rax
  mov  esi, 1                    lea  rdi, [rip + .L.str]
  mov  edi, OFFSET FLAT:.LC0     xor  esi, esi
  xor  eax, eax                  xor  eax, eax
  call printf                    call printf@PLT
```

Both compilers folded the comparison to a constant at compile time. Neither
emitted an addition. And they folded it to **different constants**: gcc passes
1 in `esi`, clang passes 0. The program prints 1 under one and 0 under the
other, at the same optimisation level, on the same machine.

gcc reaches 1 by the argument you would expect: signed overflow cannot happen,
because the standard says it is undefined and undefined things are things the
programmer has promised not to do. Given that promise, `x + 1 > x` holds for
every `x`. Clang reaches 0 by folding the arithmetic first and comparing the
wrapped result. Both are permitted, because the standard imposes no requirement
whatsoever on a program that does this.

Neither compiler is wrong. There is no fact of the matter for them to get right,
and that is the point. Undefined behaviour does not mean the answer is
unpredictable. It means there is no answer, and each compiler is free to pick
whichever one falls out of its own reasoning.

You can see the disagreement in one instruction: `mov esi, 1` against
`xor esi, esi`. Everything else about the two functions is the same shape.

## What undefined behaviour actually is

The word "undefined" invites the reading "unpredictable", and that reading will
mislead you. Undefined behaviour is not a warning that the result might be
strange. It is a **precondition**, stated in the standard, that your program
promises to satisfy.

The optimiser is not being hostile when it exploits one. It is doing exactly
what you would want from a tool that takes your claims seriously. Consider:

```c
for (int i = 0; i <= n; i++) sum += a[i];
```

If signed overflow were defined as wrapping, `i` could wrap to `INT_MIN` and the
loop could run forever, so the compiler would have to keep `i` at 32 bits, check
for wraparound, and recompute the address from scratch each iteration. Because
overflow is undefined, the compiler knows `i` only increases, promotes it to a
64-bit induction variable, strength-reduces the address arithmetic into a
walking pointer, and unrolls.

The research behind this unit measured that difference. The same loop written
with a signed counter gets a 64-bit induction variable, a walking pointer and
two-way unrolling. Written with an unsigned counter it gets none of them, and
recomputes `lea edx,[0+rax*4]` every iteration, because `i * 4` may legally
wrap.

So the rule is not "signed is dangerous, use unsigned". It is closer to the
opposite. Unsigned arithmetic is defined to wrap, and that definition is exactly
what stops the compiler from reasoning about it.

## How this fails in practice

The failure mode that matters is not that you get a wrong number. It is that
the reasoning propagates.

Once the compiler concludes that a path cannot be taken, everything downstream
of that conclusion is fair game. Code on an unreachable path is dead, and dead
code is deleted. If the only exit from a function sits on such a path, the exit
goes with it, and execution runs off the end into whatever bytes follow. That
outcome is documented and reproducible on some compiler versions, though not on
the two pinned here for this program, which is itself worth noticing: the same
undefined construct produces different damage on different releases, and the
damage is not stable enough to learn as a rule.

What is stable is where to look. A debugger stepping through the source shows
you the program you wrote. The optimiser is not working on that program; it is
working on one it derived from your promises. The assembly is the only place
those two are visible at the same time, which is why most of the exercises in
this unit ask you to read it rather than to run anything.

## The trap that has nothing to do with overflow

```c
int  a = -1;
unsigned b = 1;
if (a < b) puts("less");
```

This does not print. `a` is converted to `unsigned` before the comparison, and
`-1` as a 32-bit unsigned value is 4294967295, which is not less than 1.

The rule is the usual arithmetic conversions: when a signed and an unsigned
operand of the same rank meet, the signed one converts to unsigned. It applies
to `<`, to arithmetic, to everything. This is why `for (size_t i = n - 1; i >= 0; i--)`
never terminates: `size_t` is unsigned, so `i >= 0` is always true, and the
counter wraps to a very large number rather than going negative.

`-Wsign-compare`, which `-Wextra` enables, catches most instances. Turn it on
and leave it on.

## Saying what you mean

Three tools, in the order you should reach for them.

**Write it so overflow cannot happen.** Check the operands before the operation
rather than the result after it. `if (a > INT_MAX - b)` is well defined;
`if (a + b < 0)` is a test on a value the standard says does not exist.

**Ask for wrapping explicitly** with `-fwrapv`, which makes signed overflow
defined as two's complement wraparound. The same program that printed 1 at `-O2`
prints 0 again. This costs you the loop optimisations above, and that is the
trade you are making.

**Use the checked builtins** where the language offers them.
`__builtin_add_overflow(a, b, &out)` returns whether the operation overflowed
and is the honest way to write arithmetic on untrusted input. C23 standardises
this family as `ckd_add` and friends.

And during development, `-fsanitize=undefined` turns the whole class from silent
into loud. It costs runtime, catches the overflow at the moment it happens, and
names the file and line. There is no reason not to run your tests under it.

## What to carry forward

Two's complement is why your adder needed no subtractor. That was a gift.

Undefined behaviour is the price of the same bargain at a higher level: the
compiler will generate excellent code on the assumption that you kept your
promises, and it has no way to check. The optimiser is not scanning for
mistakes to punish. It is reading a specification you agreed to and taking you
at your word.

Every exercise in this unit is that idea from a different angle, and most of
them are read by looking at the emitted assembly rather than the program's
output. When a program's behaviour changes with an optimisation flag, the
assembly is where the reason lives.
