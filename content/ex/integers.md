## The value that has no negative

Write `negate`. The checks include `INT_MIN`, and one of them asserts something
that will look like a typo until you work out why it is not.

@kind output
@concept Two's complement has one more negative value than positive, so one
input has no representable negation.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint There are 2147483648 negative ints and 2147483647 positive ones.
@diagnose assert verdict assert-failed
Read the check that failed. `negate(INT_MIN)` cannot be `2147483648`, because
that value does not exist in an `int`. Every implementation returns `INT_MIN`
unchanged, and on a machine that traps it would trap instead. This is the one
input for which the function has no correct answer.
@diagnose silent silent
The toolchain had nothing to say and a check still failed. That is the ordinary
case for this class of bug: the arithmetic is legal, the types are right, and
one input has no answer.
@after `abs(INT_MIN)` is negative for the same reason, on every machine you
will use. It is not a bug in your standard library.

```starter
int negate(int x) {
    return 0;
}
```

```tests
#include <assert.h>
#include <limits.h>
int main(void) {
    assert(negate(5) == -5);
    assert(negate(-5) == 5);
    assert(negate(0) == 0);
    assert(negate(INT_MIN) == INT_MIN);
    return 0;
}
```

```solution
int negate(int x) {
    return -x;
}
```

## A comparison that is not a comparison

The starter looks obviously true and prints nothing. Compile it with the
warnings on and the compiler will tell you what it is really doing.

@kind property
@concept When a signed and an unsigned operand of the same rank meet, the
signed one converts to unsigned before anything is compared.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict warning
@hint What is `-1` as a 32-bit unsigned value?
@diagnose signcmp match /\[-Wsign-compare\]/
The compiler is naming the conversion. `a` becomes `unsigned` before the
comparison, and `-1` as a 32-bit unsigned value is 4294967295, which is not
less than 1. The comparison is well defined and it does not mean what it says.
@diagnose warning verdict warning
The warning names the rule: two operands of different signedness met, and the
signed one converted. Change the types so both sides agree.
@after `-Wsign-compare` is enabled by `-Wextra`. Turn it on and leave it on.
Every reverse loop written with an unsigned counter is this bug.

```starter
#include <stdio.h>
int main(void) {
    int a = -1;
    unsigned b = 1;
    printf("%d\n", a < b);
    return 0;
}
```

```solution
#include <stdio.h>
int main(void) {
    int a = -1;
    int b = 1;
    printf("%d\n", a < b);
    return 0;
}
```

## Make the sanitizer speak

The flags here turn undefined behaviour from silent into loud. Write an `add`
that overflows and watch what the sanitizer says about it.

@kind output
@concept `-fsanitize=undefined` catches the overflow at the moment it happens
and names the file and line.
@backend godbolt
@lang c
@flags -O1 -fsanitize=undefined -fno-sanitize-recover=all
@expect verdict nonzero-exit
@hint The checks pass `INT_MAX` and `1`.
@diagnose overflow verdict nonzero-exit
Read the runtime error. The sanitizer names the operation, the operands and the
type: `signed integer overflow: 2147483647 + 1 cannot be represented in type
'int'`. That is the whole class made visible.
@diagnose assert verdict assert-failed
A check failed rather than the sanitizer firing. Look at which one, and at what
your function returns for the ordinary inputs.
@after `-fno-sanitize-recover=all` is not optional. Without it the sanitizer
prints its complaint and the program still exits 0, so a test suite reports a
pass over a program that has already broken its contract.

```starter
int add(int a, int b) {
    return 0;
}
```

```tests
#include <limits.h>
int main(void) {
    if (add(2, 3) != 5) return 1;
    return add(INT_MAX, 1) == 0 ? 0 : 0;
}
```

```solution
int add(int a, int b) {
    return a + b;
}
```

## Two midpoints that disagree

Both of these compute a midpoint. Both compile cleanly with every warning
enabled. They do not agree, and the input that separates them does not overflow
anything.

@kind output
@concept Nothing complained, and one of them is still wrong for an input you
would not have thought to try.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The failing input has a negative operand. What does C do when it divides
a negative number?
@diagnose silent silent
No error, no warning, and a check failed. `a + (b - a) / 2` is the form people
reach for to avoid overflow, and for `mid(2, -1)` it gives 1 where `(a + b) / 2`
gives 0. Integer division truncates toward zero, so `(-3) / 2` is `-1` and not
`-2`. The divergence has nothing to do with overflow.
@diagnose assert verdict assert-failed
Work out both expressions by hand for `a = 2, b = -1` before changing anything.
@after The overflow-safe form is still the right one when the operands can be
large. Just know that it is a different function on negative inputs, not the
same function written more carefully.

```starter
int mid(int a, int b) {
    return a + (b - a) / 2;
}
```

```tests
#include <assert.h>
int main(void) {
    assert(mid(2, 4) == 3);
    assert(mid(2, -1) == 0);
    assert(mid(-8, -2) == -5);
    return 0;
}
```

```solution
int mid(int a, int b) {
    return (a + b) / 2;
}
```

## Ask before you add

Write `safe_add` so it reports whether the addition was representable, and
writes the result only when it was.

@kind output
@concept The checked builtins are the honest way to do arithmetic on input you
did not choose.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint `__builtin_add_overflow(a, b, &out)` returns true when it overflowed.
@diagnose assert verdict assert-failed
Read which check failed. The function has to return the opposite of what the
builtin returns, and it must still write the result for the cases that fit.
@diagnose silent silent
Nothing complained and a check failed. Compare what the builtin returns against
what your function returns for the same call.
@after C23 standardises this family as `ckd_add` and friends in `<stdckdint.h>`.
Until then the builtin is available in gcc and clang and compiles to one `add`
and one conditional jump.

```starter
#include <stdbool.h>
bool safe_add(int a, int b, int *out) {
    *out = a + b;
    return true;
}
```

```tests
#include <assert.h>
#include <limits.h>
int main(void) {
    int o = 0;
    assert(safe_add(2, 3, &o) && o == 5);
    assert(safe_add(-7, 4, &o) && o == -3);
    assert(!safe_add(INT_MAX, 1, &o));
    assert(!safe_add(INT_MIN, -1, &o));
    return 0;
}
```

```solution
#include <stdbool.h>
bool safe_add(int a, int b, int *out) {
    return !__builtin_add_overflow(a, b, out);
}
```

## The loop that never ends

Count down from `n - 1` to `0` and sum the array. The starter uses the type
everyone reaches for, and it does not terminate.

@kind output
@concept An unsigned counter cannot go below zero, so a test for that never
fires.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict timeout
@hint What is the smallest value a `size_t` can hold?
@diagnose timeout verdict timeout
The loop does not end. `i >= 0` is always true for an unsigned type, so when
`i` is 0 the decrement wraps it to the largest `size_t` instead of going
negative, and the loop starts again from the top of the address space.
@diagnose assert verdict assert-failed
The loop terminates now but the sum is wrong. Check which elements you visited.
@diagnose silent silent
Nothing complained and a check failed. Count the iterations by hand for a
three-element array.
@after Two fixes are idiomatic: loop from `n` down to `1` and index with
`i - 1`, or use a signed counter. The first is preferred because it keeps the
index type matching the container's.

```starter
#include <stddef.h>
int sum_backwards(const int *a, size_t n) {
    int total = 0;
    for (size_t i = n - 1; i >= 0; i--) total += a[i];
    return total;
}
```

```tests
#include <assert.h>
int main(void) {
    int a[] = {1, 2, 3, 4};
    assert(sum_backwards(a, 4) == 10);
    assert(sum_backwards(a, 1) == 1);
    assert(sum_backwards(a, 0) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
int sum_backwards(const int *a, size_t n) {
    int total = 0;
    for (size_t i = n; i > 0; i--) total += a[i - 1];
    return total;
}
```

## Widening is an instruction

`load` reads one byte and returns it as an `int`. The checks include a byte
whose top bit is set, and the answer depends on a single character in the
declaration.

@kind output
@concept Whether the high bits are copies of the sign bit or zeros is decided
by the type, and it becomes a different instruction.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint `0xFF` as a `signed char` is `-1`. As an `unsigned char` it is 255.
@diagnose assert verdict assert-failed
The failing check uses a byte with its top bit set. Plain `char` is signed on
this target, so the value sign-extends and you get a negative number where the
check wants 255. The compiler emits `movsx` for one and `movzx` for the other.
@diagnose silent silent
Nothing complained and a check failed. The types are all legal; only one of
them means what the checks expect.
@after This is why `char` is the wrong type for a byte. Use `unsigned char` for
data and `char` only for text.

```starter
int load(const char *p) {
    return *p;
}
```

```tests
#include <assert.h>
int main(void) {
    unsigned char bytes[] = {0x01, 0x7F, 0x80, 0xFF};
    assert(load((const char *)&bytes[0]) == 1);
    assert(load((const char *)&bytes[1]) == 127);
    assert(load((const char *)&bytes[2]) == 128);
    assert(load((const char *)&bytes[3]) == 255);
    return 0;
}
```

```solution
int load(const char *p) {
    return *(const unsigned char *)p;
}
```

## Say what you mean instead

Rewrite the overflow check so it asks a question the standard answers. The
starter tests the result of an operation the standard says does not happen.

@kind output
@concept Check the operands before the operation, not the result after it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint `a + b` overflows exactly when `b > INT_MAX - a`, and that comparison is
well defined.
@diagnose assert verdict assert-failed
The check that failed passes two large positive values. `a + b < 0` asks about
a value the standard says cannot exist, so the compiler is entitled to conclude
the test is never true and delete it. Ask about the operands instead.
@diagnose silent silent
Nothing complained and a check failed. The test you wrote is legal C and the
compiler removed it, which is why nothing was reported.
@after Both operands need a guard: positive overflow when `b > INT_MAX - a`,
and negative when `b < INT_MIN - a`.

```starter
#include <stdbool.h>
bool would_overflow(int a, int b) {
    return a + b < 0;
}
```

```tests
#include <assert.h>
#include <limits.h>
int main(void) {
    assert(!would_overflow(2, 3));
    assert(!would_overflow(-5, 2));
    assert(would_overflow(INT_MAX, 1));
    assert(would_overflow(INT_MIN, -1));
    assert(!would_overflow(INT_MAX, INT_MIN));
    return 0;
}
```

```solution
#include <stdbool.h>
#include <limits.h>
bool would_overflow(int a, int b) {
    if (b > 0 && a > INT_MAX - b) return true;
    if (b < 0 && a < INT_MIN - b) return true;
    return false;
}
```
