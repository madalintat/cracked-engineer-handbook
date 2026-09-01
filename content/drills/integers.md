## In 8-bit two's complement, what value does the bit pattern 10000000 represent?

- [ ] 128
- [x] -128
- [ ] -0
- [ ] It is a trap representation

@why The top bit carries a weight of -128 rather than flagging a sign. There is
no negative zero in two's complement, which is one of the three reasons it won.

## Why did two's complement beat sign-magnitude for integers?

- [ ] It represents a wider range of values for the same bit count
- [x] One zero, and addition that works on signed and unsigned alike, so the
      same adder serves both
- [ ] It makes multiplication cheaper in hardware
- [ ] It was the first scheme anyone tried

@why Sign-magnitude has two zeroes and needs a separate signed adder. Two's
complement makes subtraction into addition with one operand inverted and the
carry in set, which is one control bit rather than a second circuit.

## Why has `-INT_MIN` no correct answer?

- [x] There is one more negative value than positive, so its negation is out of
      range
- [ ] Negation is undefined for all values in C
- [ ] The sign bit cannot be cleared without losing the value
- [ ] It has an answer, but only on two's complement machines

@why 32 bits give 2147483648 negative values and 2147483647 positive ones. The
asymmetry is the price of having exactly one zero, and it is why `abs(INT_MIN)`
is negative everywhere.

## What does "undefined behaviour" state about a program?

- [ ] The result is unpredictable and may vary between runs
- [ ] The compiler will produce a diagnostic
- [x] The program broke a precondition the standard requires it to satisfy, so
      the standard imposes no requirement on the result
- [ ] The behaviour depends on the target processor

@why It is a precondition, not a warning about variability. Once it is
violated, the standard says nothing at all about what the implementation must
do, which is why two compilers can produce different answers and both be right.

## The same signed-overflow program compiled by gcc and by clang at -O2 prints
different values. What follows?

- [ ] One of the compilers has a bug worth reporting
- [x] Nothing is wrong. There is no correct answer for either to produce
- [ ] The program depends on the processor rather than the compiler
- [ ] The difference would disappear at -O0

@why Measured: gcc emits `mov esi, 1` and clang emits `xor esi, esi` for the
identical source. Both constant-folded the comparison, using different
reasoning, and neither is obliged to agree with the other.

## Why does an unsigned loop counter often produce worse code than a signed one?

- [ ] Unsigned arithmetic uses more instructions on x86-64
- [x] Unsigned wraparound is defined, so the compiler must preserve it and
      cannot assume the counter only increases
- [ ] Signed values fit in registers more efficiently
- [ ] The optimiser has more passes written for signed types

@why Because signed overflow is undefined, the compiler may promote the counter
to 64 bits, strength-reduce the address arithmetic to a walking pointer and
unroll. With an unsigned counter it must keep recomputing the index, because
the wrap is a behaviour the program is entitled to.

## `int a = -1; unsigned b = 1;` What does `a < b` evaluate to, and why?

- [ ] 1, because -1 is less than 1
- [x] 0, because `a` converts to unsigned first and becomes 4294967295
- [ ] It is undefined behaviour
- [ ] It depends on the optimisation level

@why The usual arithmetic conversions turn the signed operand unsigned when
both have the same rank. The comparison is well defined and it does not mean
what it appears to say. `-Wsign-compare`, from `-Wextra`, names it.

## Why does `for (size_t i = n - 1; i >= 0; i--)` never terminate?

- [ ] `n - 1` overflows when `n` is zero
- [x] `i >= 0` is always true for an unsigned type, and decrementing 0 wraps to
      the largest `size_t`
- [ ] The compiler removes the condition as undefined behaviour
- [ ] It terminates, but only after 2^64 iterations

@why An unsigned value has no negative range for the test to detect. Loop from
`n` down to 1 and index with `i - 1`, which keeps the index type matching the
container's.

## Running with `-fsanitize=undefined` but without `-fno-sanitize-recover=all`,
a program overflows. What happens?

- [ ] The program aborts immediately
- [x] The sanitizer prints a runtime error and the program continues and exits 0
- [ ] Nothing, because the sanitizer only checks memory
- [ ] The compiler refuses to build it

@why Measured: the diagnostic appears on stderr and the exit status is still 0,
so a test suite reports a pass over a program that has already broken its
contract. The recover flag is not optional in a checking harness.

## Which overflow test is well defined?

- [ ] `if (a + b < 0)`
- [x] `if (b > 0 && a > INT_MAX - b)`
- [ ] `if ((long)(a + b) > INT_MAX)`
- [ ] `if (a + b < a)`

@why The others all perform the addition first and then examine a value the
standard says does not exist, so the compiler may conclude the test is never
true and delete it. Checking the operands asks a question the standard answers.

## What does `__builtin_add_overflow(a, b, &out)` return?

- [ ] The sum, or zero if it overflowed
- [x] True when the operation overflowed, having written the wrapped result to
      `out`
- [ ] True when the operation succeeded
- [ ] An error code matching errno

@why It reports the overflow rather than the success, which is the opposite of
what most people guess and the reason a wrapper usually negates it. C23
standardises the same family as `ckd_add`.

## Why is `mov eax, eax` not a no-op on x86-64?

- [x] Writing a 32-bit register zeroes the upper 32 bits of the 64-bit register
- [ ] It flushes the instruction pipeline
- [ ] It is a no-op, and assemblers remove it
- [ ] It sign-extends the value into the full register

@why Writes to 32-bit registers zero-extend; writes to 16-bit and 8-bit ones do
not. AMD chose that when extending the architecture because it breaks the
dependency on the register's previous value, which lets the renamer avoid
serialising.

## Reading one byte through a `char*` on a target where `char` is signed, what
does the byte 0xFF become as an `int`?

- [ ] 255
- [x] -1, because the value sign-extends
- [ ] Implementation-defined and unusable
- [ ] 0xFF, unchanged, since no conversion happens

@why Plain `char` is signed here, so the compiler emits `movsx` and copies the
top bit into the new high bits. Reading through `unsigned char*` emits `movzx`
instead. This is why `char` is the wrong type for a byte of data.

## `mid(2, -1)` gives 0 for `(a + b) / 2` and 1 for `a + (b - a) / 2`. Why?

- [ ] The second form overflows
- [x] Integer division truncates toward zero, so `(-3) / 2` is -1 rather than -2
- [ ] The first form has undefined behaviour for negative operands
- [ ] They are the same function and the difference is a rounding mode

@why No overflow is involved at these values. The two expressions are genuinely
different functions on negative inputs, and the overflow-safe form is not
simply a more careful way of writing the same thing.

## You want the compiler to treat signed overflow as two's complement wraparound.
What do you give up?

- [ ] Nothing, it is purely a safety improvement
- [x] The loop optimisations that depend on assuming a signed counter only
      increases
- [ ] Portability, since the flag changes the meaning of the standard
- [ ] Nothing at compile time, but the program runs slower on every operation

@why `-fwrapv` defines the behaviour, and defining it is exactly what stops the
compiler from promoting induction variables, strength-reducing addresses and
unrolling. The flag is a real trade, not a free check.
