## Three fields

Write `decompose`, splitting a 32-bit float into its sign, its stored exponent
and its stored fraction.

Copy the bits rather than casting the pointer. Casting a float pointer to an
integer pointer and dereferencing it is undefined behaviour, and the compiler is
entitled to notice.

@kind output
@concept The bits are a sign, a biased exponent and a fraction with an implied
leading one, which is why twenty-three stored bits give twenty-four of precision.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The fraction is the low 23 bits, the exponent the next 8, the sign the top
one.
@diagnose assert verdict assert-failed
A check disagrees. Shift before masking, and mask with the right width: the
exponent is 8 bits after shifting right by 23, and masking before shifting takes
the wrong bits entirely.
@diagnose compile verdict compile-error
Read the line the compiler names. `memcpy` needs `<string.h>`.
@after 1.0f is exponent 127 and fraction 0, because the bias is 127 and the
leading 1 is implied rather than stored. That implied bit is why a format with 23
bits of fraction has 24 bits of precision, and it is free because a normalised
binary number always starts with one.

```starter
#include <string.h>
void decompose(float f, unsigned *sign, unsigned *exp, unsigned *frac) {
    unsigned bits;
    memcpy(&bits, &f, sizeof bits);
    *sign = bits >> 31;
    *exp = bits & 0xFF;
    *frac = bits >> 23;
}
```

```tests
#include <assert.h>
void decompose(float, unsigned *, unsigned *, unsigned *);
int main(void) {
    unsigned s, e, m;
    decompose(1.0f, &s, &e, &m);
    assert(s == 0 && e == 127 && m == 0);
    decompose(-1.0f, &s, &e, &m);
    assert(s == 1 && e == 127 && m == 0);
    decompose(2.0f, &s, &e, &m);
    assert(s == 0 && e == 128 && m == 0);
    decompose(0.5f, &s, &e, &m);
    assert(s == 0 && e == 126 && m == 0);
    decompose(0.0f, &s, &e, &m);
    assert(s == 0 && e == 0 && m == 0);
    /* 0.1f is the nearest float to a tenth, and its bits are 0x3dcccccd. */
    decompose(0.1f, &s, &e, &m);
    assert(s == 0 && e == 123 && m == 0x4ccccd);
    return 0;
}
```

```solution
#include <string.h>
void decompose(float f, unsigned *sign, unsigned *exp, unsigned *frac) {
    unsigned bits;
    memcpy(&bits, &f, sizeof bits);
    *sign = bits >> 31;
    *exp = (bits >> 23) & 0xFF;
    *frac = bits & 0x7FFFFF;
}
```

## The gap at a magnitude

Write `gap_above`, returning the distance from a float to the next larger one.

The exponent scales the whole number, so this distance scales with it. That is
the property behind almost every floating point surprise.

@kind output
@concept The spacing between representable values grows with the values, so the
same absolute error is negligible at one magnitude and catastrophic at another.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The bit patterns of positive floats increase in the same order as the
values, so the next float is the next bit pattern.
@diagnose assert verdict assert-failed
A check disagrees. Adding a constant epsilon gives the gap near 1.0 and nothing
else. Add one to the bit pattern instead: the exponent is biased precisely so
that consecutive bit patterns are consecutive values.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The gap at 2 to the 23 is exactly 1 and at 2 to the 24 it is 2, which is
why a float represents every integer up to 16777216 and starts skipping above it.
That bias in the exponent, which makes the bit patterns ordered, is a deliberate
design decision and this exercise is one of the things it buys.

```starter
#include <string.h>
float gap_above(float f) {
    (void)f;
    return 1.1920929e-07f;
}
```

```tests
#include <assert.h>
float gap_above(float);
int main(void) {
    assert(gap_above(1.0f) == 1.1920929e-07f);
    assert(gap_above(2.0f) == 2.3841858e-07f);
    /* At two to the 23 the gap is exactly one. */
    assert(gap_above(8388608.0f) == 1.0f);
    /* At two to the 24 it is two, so adding one changes nothing. */
    assert(gap_above(16777216.0f) == 2.0f);
    assert(16777216.0f + 1.0f == 16777216.0f);
    assert(gap_above(0.5f) == 5.9604645e-08f);
    return 0;
}
```

```solution
#include <string.h>
float gap_above(float f) {
    unsigned bits;
    memcpy(&bits, &f, sizeof bits);
    bits += 1;
    float next;
    memcpy(&next, &bits, sizeof next);
    return next - f;
}
```

## The value that is not equal to itself

Write `is_nan`, reporting whether a double is not-a-number, without calling any
library function.

There is exactly one comparison the standard defines to be true for a NaN, and it
is the one that looks like a mistake.

@kind output
@concept A NaN compares unequal to everything including itself, which is the only
property that distinguishes it using comparisons alone.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Compare the value with itself.
@diagnose assert verdict assert-failed
A check disagrees. Comparing against a NaN constant does not work, because every
comparison involving a NaN is false, including equality between two NaNs. The
test that works is `x != x`, which is true for a NaN and false for everything
else.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This also breaks sorting. A comparison function built on `<` stops being a
valid ordering the moment a NaN appears, and some sort implementations respond by
running off the end of the array rather than by returning a wrong order.

```starter
int is_nan(double x) {
    return x == 0.0 / 0.0;
}
```

```tests
#include <assert.h>
int is_nan(double);
int main(void) {
    double zero = 0.0;
    double nan = zero / zero;
    double inf = 1.0 / zero;
    assert(is_nan(nan) == 1);
    assert(is_nan(0.0) == 0);
    assert(is_nan(1.5) == 0);
    assert(is_nan(-1.5) == 0);
    assert(is_nan(inf) == 0);
    assert(is_nan(-inf) == 0);
    return 0;
}
```

```solution
int is_nan(double x) {
    return x != x;
}
```

## Two zeros

Positive and negative zero compare equal and are not the same value. Write
`is_negative_zero`, which distinguishes them.

@kind output
@concept Zero has a sign because the reciprocal has to have one, so two values
that compare equal can still be told apart.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Comparison cannot see the difference. Something else can.
@diagnose assert verdict assert-failed
A check disagrees. `x == -0.0` is true for positive zero as well, because the two
compare equal. Either look at the sign bit, or divide: one over negative zero is
negative infinity and one over positive zero is positive infinity.
@diagnose compile verdict compile-error
Read the line the compiler names. `memcpy` needs `<string.h>`.
@after The sign exists so that a computation which underflows to zero from below
still produces a negative infinity when inverted, rather than losing the
direction it came from. It is one of the places the standard chose to preserve
information that equality then hides.

```starter
int is_negative_zero(double x) {
    return x == -0.0;
}
```

```tests
#include <assert.h>
int is_negative_zero(double);
int main(void) {
    assert(is_negative_zero(-0.0) == 1);
    assert(is_negative_zero(0.0) == 0);
    assert(is_negative_zero(1.0) == 0);
    assert(is_negative_zero(-1.0) == 0);
    /* They compare equal, which is why comparison cannot be the test. */
    assert(-0.0 == 0.0);
    return 0;
}
```

```solution
#include <string.h>
int is_negative_zero(double x) {
    if (x != 0.0) return 0;
    unsigned long long bits;
    memcpy(&bits, &x, sizeof bits);
    return (int)(bits >> 63);
}
```

## Ties to even

Write `round_half_even`, rounding a double to the nearest integer and breaking
ties toward the even neighbour.

This is the default mode for every floating point operation, and it is not what
most people would have chosen.

@kind output
@concept Rounding ties in a fixed direction accumulates a bias over a long sum;
rounding to the even neighbour does not, because it goes each way about equally
often.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only exact halves are ties. Everything else rounds to whichever integer is
nearer.
@diagnose assert verdict assert-failed
A check disagrees on a tie. Adding a half and truncating rounds 2.5 to 3 and 3.5
to 4, which is the biased rule. Ties to even sends 2.5 to 2 and 3.5 to 4, so the
direction alternates and the bias cancels.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The bias is invisible in one operation and real over a million. Rounding
always upward on a tie adds half an unit of last place per tie, which over a long
accumulation is a drift in one direction rather than noise around the answer.

```starter
double round_half_even(double x) {
    return (double)(long)(x + (x < 0 ? -0.5 : 0.5));
}
```

```tests
#include <assert.h>
double round_half_even(double);
int main(void) {
    assert(round_half_even(2.4) == 2.0);
    assert(round_half_even(2.6) == 3.0);
    /* Ties go to the even neighbour, in both directions. */
    assert(round_half_even(2.5) == 2.0);
    assert(round_half_even(3.5) == 4.0);
    assert(round_half_even(-2.5) == -2.0);
    assert(round_half_even(-3.5) == -4.0);
    assert(round_half_even(0.5) == 0.0);
    assert(round_half_even(1.5) == 2.0);
    assert(round_half_even(-0.5) == 0.0);
    return 0;
}
```

```solution
double round_half_even(double x) {
    double down = (double)(long)x;
    if (x < 0 && down != x) down -= 1.0;
    double frac = x - down;
    if (frac > 0.5) return down + 1.0;
    if (frac < 0.5) return down;
    /* An exact tie: choose the even neighbour. */
    long d = (long)down;
    return (d % 2 == 0) ? down : down + 1.0;
}
```

## The root that lost its digits

Write `smaller_root`, returning the root of `x` squared times a, plus b x, plus
c, that is closest to zero, for a positive b much larger than a and c.

The textbook formula subtracts two nearly equal numbers. The equivalent form that
multiplies instead does not.

@kind output
@concept Subtracting two nearly equal quantities discards the digits they agree
on, and what is left is whatever noise was underneath them.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -lm
@expect verdict assert-failed
@hint Multiply the numerator and denominator of the textbook formula by the
conjugate. The subtraction becomes an addition.
@diagnose assert verdict assert-failed
A check disagrees, and the discrepancy is enormous rather than small. With b at
1e8, the square root of b squared minus 4ac agrees with b to about fifteen
digits, so subtracting them leaves one significant digit. The stable form is
twice c over minus b minus that square root, which adds two large numbers instead
of subtracting them.
@diagnose compile verdict compile-error
Read the line the compiler names. `sqrt` needs `<math.h>`.
@after The naive answer is -7.450580596923828e-09 where the right one is
-1.0000000000000000209e-08. Twenty five percent wrong, from a formula that is
mathematically correct and implemented without a single mistake. This is the
failure mode worth recognising: nothing was rounded badly, the information was
never there.

```starter
#include <math.h>
double smaller_root(double a, double b, double c) {
    double disc = sqrt(b * b - 4 * a * c);
    return (-b + disc) / (2 * a);
}
```

```tests
#include <assert.h>
#include <math.h>
double smaller_root(double, double, double);
int main(void) {
    /* Well conditioned: both forms agree. */
    double r = smaller_root(1.0, 5.0, 6.0);
    assert(fabs(r - (-2.0)) < 1e-12);
    /* The hard case. The true root is very close to -1e-8. */
    double h = smaller_root(1.0, 1e8, 1.0);
    assert(fabs(h - (-1e-8)) < 1e-20);
    /* The naive form gets this one wrong by a quarter. */
    double naive = (-1e8 + sqrt(1e16 - 4.0)) / 2.0;
    assert(fabs(naive - (-1e-8)) > 1e-9);
    return 0;
}
```

```solution
#include <math.h>
double smaller_root(double a, double b, double c) {
    double disc = sqrt(b * b - 4 * a * c);
    return (2 * c) / (-b - disc);
}
```

## Counting the steps between

Write `ulps_apart`, returning how many representable floats lie between two
values, inclusive of neither endpoint's own position.

Both arguments are positive. Because the exponent is biased, the bit patterns of
positive floats increase in the same order the values do, so this is a
subtraction of integers.

@kind output
@concept A tolerance measured in representable steps handles every magnitude with
one constant, which neither an absolute nor a relative epsilon manages.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Copy both to unsigned integers and subtract, larger minus smaller.
@diagnose assert verdict assert-failed
A check disagrees. Subtracting the values and dividing by an epsilon gives a
different answer at every magnitude, which is the problem this approach exists to
solve. Subtract the bit patterns instead.
@diagnose compile verdict compile-error
Read the line the compiler names. `memcpy` needs `<string.h>`.
@after One constant covers every magnitude, because the question asked is how
many representable values apart these are rather than how far apart they are.
This is what a serious numerical test suite compares against, and it is only
possible because the exponent was stored biased so that the bit patterns sort.

```starter
#include <string.h>
unsigned ulps_apart(float a, float b) {
    float d = a > b ? a - b : b - a;
    return (unsigned)(d / 1.1920929e-07f);
}
```

```tests
#include <assert.h>
unsigned ulps_apart(float, float);
int main(void) {
    assert(ulps_apart(1.0f, 1.0f) == 0);
    /* One step apart, at two very different magnitudes. */
    assert(ulps_apart(1.0f, 1.0f + 1.1920929e-07f) == 1);
    assert(ulps_apart(16777216.0f, 16777218.0f) == 1);
    assert(ulps_apart(8388608.0f, 8388609.0f) == 1);
    /* Order does not matter. */
    assert(ulps_apart(16777218.0f, 16777216.0f) == 1);
    assert(ulps_apart(2.0f, 2.0f + 2 * 2.3841858e-07f) == 2);
    return 0;
}
```

```solution
#include <string.h>
unsigned ulps_apart(float a, float b) {
    unsigned ia, ib;
    memcpy(&ia, &a, sizeof ia);
    memcpy(&ib, &b, sizeof ib);
    return ia > ib ? ia - ib : ib - ia;
}
```

## Where the integers run out

Write `exact_integers_up_to`, returning the largest integer `n` such that every
integer from 0 to `n` is exactly representable in a float of the given precision.

Precision is the number of significant bits, which is 24 for a 32-bit float and
53 for a double.

@kind output
@concept The precision is a bit count, so the exact integer range is a power of
two and it is the number to check a counter against.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Twenty-four bits of significand covers every integer up to two to the
twenty-four.
@diagnose assert verdict assert-failed
A check disagrees. With `p` significant bits, every integer below two to the `p`
fits in the significand, and two to the `p` itself is representable because it
needs only a leading one. The first integer that is not representable is one more
than that.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after 16777216 for a float and about nine quadrillion for a double, which is why
a double is usually acceptable as a counter and a float usually is not. Anything
counting past sixteen million in a 32-bit float silently stops counting, and the
comparison that would have caught it returns true.

```starter
unsigned long long exact_integers_up_to(int precision_bits) {
    return 1ULL << (precision_bits - 1);
}
```

```tests
#include <assert.h>
unsigned long long exact_integers_up_to(int);
int main(void) {
    assert(exact_integers_up_to(24) == 16777216ULL);
    assert(exact_integers_up_to(53) == 9007199254740992ULL);
    assert(exact_integers_up_to(11) == 2048ULL);   /* fp16 */
    assert(exact_integers_up_to(8) == 256ULL);     /* bf16 */
    assert(exact_integers_up_to(1) == 2ULL);
    /* The claim, checked against the hardware. */
    assert(16777216.0f + 1.0f == 16777216.0f);
    assert(16777215.0f + 1.0f == 16777216.0f);
    return 0;
}
```

```solution
unsigned long long exact_integers_up_to(int precision_bits) {
    return 1ULL << precision_bits;
}
```
