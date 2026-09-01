## Compensated summation

Write `kahan_sum`, which tracks what each addition rounded away and adds it back
on the next iteration.

The checks sum 65536 copies of `0.1f`. Left to right this drifts by four.

@kind output
@concept Keeping the part that was rounded away turns an error that grows with
the term count into one that does not grow at all.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Subtract the compensation from the input before adding, then recompute it
from the difference between what you got and what you expected.
@diagnose assert verdict assert-failed
A check disagrees. The compensation is `(t - s) - y`: what the sum actually
gained, minus what it should have gained. The starter never computes it, so it is
a plain sequential sum with two extra variables.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured, the naive sum of 65536 tenths in a 32-bit float is
6557.6464843750 where the true total is 6553.6000976562. Four out, from nothing
but repeated rounding. Four extra lines removes all of it.

```starter
#include <stddef.h>
float kahan_sum(const float *a, size_t n) {
    float s = 0.0f, c = 0.0f;
    for (size_t i = 0; i < n; i++) {
        s = s + a[i];
        c = 0.0f;
    }
    return s + c;
}
```

```tests
#include <assert.h>
#include <stddef.h>
float kahan_sum(const float *, size_t);
int main(void) {
    static float a[65536];
    for (int i = 0; i < 65536; i++) a[i] = 0.1f;
    /* 0.1f is stored as 0.100000001490116119384765625. */
    assert(kahan_sum(a, 65536) == 6553.60009765625f);
    /* The sequential sum drifts to this, which is four out. */
    float seq = 0.0f;
    for (int i = 0; i < 65536; i++) seq += a[i];
    assert(seq == 6557.646484375f);
    /* Small cases still behave. */
    float b[4] = {1.0f, 2.0f, 3.0f, 4.0f};
    assert(kahan_sum(b, 4) == 10.0f);
    assert(kahan_sum(b, 0) == 0.0f);
    return 0;
}
```

```solution
#include <stddef.h>
float kahan_sum(const float *a, size_t n) {
    float s = 0.0f, c = 0.0f;
    for (size_t i = 0; i < n; i++) {
        float y = a[i] - c;
        float t = s + y;
        c = (t - s) - y;
        s = t;
    }
    return s;
}
```

## What compensation cannot fix

Write `both_sums`, returning the naive and compensated sums of the same values.

The checks use a sequence where two large values cancel. Both methods return the
same wrong answer, and that is the result the exercise is asserting.

@kind output
@concept Compensation fixes accumulated rounding and does nothing about
conditioning, because it cannot recover information that was never representable.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Reuse the compensated sum from the previous exercise. Both outputs are
required.
@diagnose assert verdict assert-failed
A check disagrees. The compensated sum of 1e8, 1, -1e8, 1 is 1 and not 2, which
is what the check expects: adding 1 to 1e8 in a 32-bit float changes nothing,
because there is no float between them, and the compensation term has nothing to
carry.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Both give 1 where the true answer is 2. This is the whole of "Kahan is not
a panacea": the loss happened at the moment 1e8 and 1 were added, and no
bookkeeping afterwards recovers a value the format could not hold. Reordering so the two
large terms cancel each other before the small ones are added does fix it, and
compensation does not. Putting the small terms first does not fix it either: two
plus 1e8 is still 1e8.

```starter
#include <stddef.h>
void both_sums(const float *a, size_t n, float *naive, float *kahan) {
    float s = 0.0f;
    for (size_t i = 0; i < n; i++) s += a[i];
    *naive = s;
    *kahan = s;
}
```

```tests
#include <assert.h>
#include <stddef.h>
void both_sums(const float *, size_t, float *, float *);
int main(void) {
    float nv, kh;
    /* Repeated tenths: compensation wins by four. */
    static float a[65536];
    for (int i = 0; i < 65536; i++) a[i] = 0.1f;
    both_sums(a, 65536, &nv, &kh);
    assert(nv == 6557.646484375f);
    assert(kh == 6553.60009765625f);
    /* Cancellation: both give 1, and the true answer is 2. */
    float b[4] = {1e8f, 1.0f, -1e8f, 1.0f};
    both_sums(b, 4, &nv, &kh);
    assert(nv == 1.0f);
    assert(kh == 1.0f);
    /* Small terms first does not help: 2 plus 1e8 is still 1e8. */
    float c[4] = {1.0f, 1.0f, 1e8f, -1e8f};
    both_sums(c, 4, &nv, &kh);
    assert(nv == 0.0f);
    /* Cancelling the large pair before the small terms does. */
    float d[4] = {1e8f, -1e8f, 1.0f, 1.0f};
    both_sums(d, 4, &nv, &kh);
    assert(nv == 2.0f);
    return 0;
}
```

```solution
#include <stddef.h>
void both_sums(const float *a, size_t n, float *naive, float *kahan) {
    float s = 0.0f;
    for (size_t i = 0; i < n; i++) s += a[i];
    *naive = s;
    float k = 0.0f, comp = 0.0f;
    for (size_t i = 0; i < n; i++) {
        float y = a[i] - comp;
        float t = k + y;
        comp = (t - k) - y;
        k = t;
    }
    *kahan = k;
}
```

## Multiply narrow, accumulate wide

Write `dot_mixed`, which rounds each product to a narrow precision and
accumulates in full precision.

Narrowing is simulated by keeping only the top `bits` of the significand. This is
what every tensor core does: low-precision inputs, wide accumulator.

@kind output
@concept The products in a dot product do not need much precision and the running
total does, which is why an eight-bit multiply with a thirty-two-bit accumulator
is a sensible thing to build.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Narrow the product, then add it to a `double`. Narrowing the accumulator
too is the mistake this exercise is about.
@diagnose assert verdict assert-failed
A check disagrees. The accumulator has to stay wide. Narrowed to ten bits it
stops moving at 2048, because past that point adding one is below half a step
and rounds away, and it stalls at 512 with eight bits. Every product here is
exactly 1 at any width, so the accumulator is the only thing that can be wrong.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Halving the width of the inputs halves the memory traffic, which is what
the whole exercise buys. Keeping the accumulator wide costs one register per
output and keeps the sum honest, and every tensor core in Part XVI is built on
exactly that asymmetry.

```starter
#include <stddef.h>
#include <string.h>

static double narrow(double x, int bits) {
    unsigned long long b;
    memcpy(&b, &x, sizeof b);
    unsigned long long mask = ~0ULL << (52 - bits);
    b &= mask;
    memcpy(&x, &b, sizeof x);
    return x;
}

double dot_mixed(const double *u, const double *v, size_t n, int bits) {
    double acc = 0.0;
    for (size_t i = 0; i < n; i++) {
        acc = narrow(acc + narrow(u[i] * v[i], bits), bits);
    }
    return acc;
}
```

```tests
#include <assert.h>
#include <stddef.h>
#include <math.h>
double dot_mixed(const double *, const double *, size_t, int);
int main(void) {
    /* Exact values: narrowing changes nothing and the answer is exact. */
    double u[4] = {1.0, 2.0, 3.0, 4.0};
    double v[4] = {1.0, 1.0, 1.0, 1.0};
    assert(dot_mixed(u, v, 4, 10) == 10.0);
    /* Four thousand products of one. Every product is exact at any width, so
       the accumulator is the only thing that can go wrong. Narrowed to ten
       bits it stalls at 2048; kept wide it reaches all 4096. */
    static double a[4096], b[4096];
    for (int i = 0; i < 4096; i++) { a[i] = 1.0; b[i] = 1.0; }
    assert(dot_mixed(a, b, 4096, 10) == 4096.0);
    assert(dot_mixed(a, b, 4096, 8) == 4096.0);
    assert(dot_mixed(a, b, 2048, 10) == 2048.0);
    assert(dot_mixed(u, v, 0, 10) == 0.0);
    return 0;
}
```

```solution
#include <stddef.h>
#include <string.h>

static double narrow(double x, int bits) {
    unsigned long long b;
    memcpy(&b, &x, sizeof b);
    unsigned long long mask = ~0ULL << (52 - bits);
    b &= mask;
    memcpy(&x, &b, sizeof x);
    return x;
}

double dot_mixed(const double *u, const double *v, size_t n, int bits) {
    double acc = 0.0;
    for (size_t i = 0; i < n; i++) {
        acc += narrow(u[i] * v[i], bits);
    }
    return acc;
}
```

## The accumulator that stops moving

Round to nearest has a failure mode in a repeated accumulation: if every
increment is smaller than half a step of the accumulator, all of them round away
and the total never changes.

Write `stalled_after`, returning how many additions of `inc` a float accumulator
absorbs before it stops moving, starting from `start`.

@kind output
@concept An increment below half the accumulator's step rounds to nothing, so a
long accumulation in a narrow format can stall entirely.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Add until the value stops changing, with a cap so a growing accumulator
does not run forever.
@diagnose assert verdict assert-failed
A check disagrees. The loop stops when an addition leaves the value unchanged,
which is a comparison against the previous value rather than a fixed count. An
accumulator that keeps growing never stalls and has to be cut off by the cap.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Starting at 16777216 and adding 1, a float never moves at all, because the
step there is 2 and 1 is exactly half of it, which ties to even and stays. This is
what stochastic rounding exists to fix: round up or down with a probability
proportional to the distance, and the expected value is right even though every
individual result is worse.

```starter
#include <stddef.h>
size_t stalled_after(float start, float inc, size_t cap) {
    float x = start;
    for (size_t i = 0; i < cap; i++) x += inc;
    return cap;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t stalled_after(float, float, size_t);
int main(void) {
    /* The step at two to the 24 is 2, and 1 is a tie that stays put. */
    assert(stalled_after(16777216.0f, 1.0f, 1000) == 0);
    /* Below that, one still moves the value. */
    assert(stalled_after(8388608.0f, 1.0f, 10) == 10);
    /* Adding a value far below the step never moves it. */
    assert(stalled_after(1.0f, 1e-9f, 1000) == 0);
    /* Ordinary accumulation runs to the cap. */
    assert(stalled_after(0.0f, 1.0f, 100) == 100);
    return 0;
}
```

```solution
#include <stddef.h>
size_t stalled_after(float start, float inc, size_t cap) {
    float x = start;
    for (size_t i = 0; i < cap; i++) {
        float next = x + inc;
        if (next == x) return i;
        x = next;
    }
    return cap;
}
```

## Different tree, different answer

A parallel reduction's grouping depends on how many threads ran. Write
`reduce_chunks`, which splits the values into `k` chunks, sums each
sequentially, then sums the chunk totals.

The checks use the same input at three chunk counts and get three answers.

@kind output
@concept The result of a parallel reduction depends on the thread count, because
the thread count decides the grouping and addition is not associative.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Every element belongs to exactly one chunk, and the chunk totals are summed
afterwards.
@diagnose assert verdict assert-failed
A check disagrees. Chunks have to partition the input: with `n` not divisible by
`k` the last chunk is short, and dropping or double-counting its tail changes the
answer for reasons that have nothing to do with rounding.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Same input, same machine, no bug, three answers. This is the most common
surprise for people arriving at GPU programming, and the three responses are to
compare with a tolerance, to fix the tree regardless of scheduling, or to widen
the accumulator until the disagreement stops mattering. The third is what almost
everybody does.

```starter
#include <stddef.h>
float reduce_chunks(const float *a, size_t n, size_t k) {
    (void)k;
    float s = 0.0f;
    for (size_t i = 0; i < n; i++) s += a[i];
    return s;
}
```

```tests
#include <assert.h>
#include <stddef.h>
float reduce_chunks(const float *, size_t, size_t);
int main(void) {
    static float a[4096];
    for (int i = 0; i < 4096; i++) a[i] = 0.1f;
    float one = reduce_chunks(a, 4096, 1);
    float four = reduce_chunks(a, 4096, 4);
    float many = reduce_chunks(a, 4096, 256);
    /* One chunk is the plain sequential sum. */
    float seq = 0.0f;
    for (int i = 0; i < 4096; i++) seq += a[i];
    assert(one == seq);
    /* More chunks means shallower partial sums and a different answer. */
    assert(four != one);
    assert(many != one);
    /* On exact values every grouping agrees. */
    float b[8] = {1,2,3,4,5,6,7,8};
    assert(reduce_chunks(b, 8, 1) == 36.0f);
    assert(reduce_chunks(b, 8, 4) == 36.0f);
    assert(reduce_chunks(b, 8, 3) == 36.0f);
    return 0;
}
```

```solution
#include <stddef.h>
float reduce_chunks(const float *a, size_t n, size_t k) {
    float part[512];
    if (k == 0) return 0.0f;
    size_t per = (n + k - 1) / k;
    size_t used = 0;
    for (size_t c = 0; c * per < n; c++) {
        float s = 0.0f;
        size_t lo = c * per;
        size_t hi = lo + per < n ? lo + per : n;
        for (size_t i = lo; i < hi; i++) s += a[i];
        part[used++] = s;
    }
    float total = 0.0f;
    for (size_t c = 0; c < used; c++) total += part[c];
    return total;
}
```

## Scaling the gradients

fp16 runs out of range below about 6e-8. A gradient smaller than that underflows
to zero and the update is lost.

Write `loss_scale`, returning the largest power of two by which a value can be
multiplied without exceeding a maximum. That is what a training loop searches for
each step.

@kind output
@concept Multiplying by a constant moves a whole distribution into the
representable range, and dividing afterwards removes it again exactly, because a
power of two is exact in binary.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Double while the scaled value still fits. Start at one.
@diagnose assert verdict assert-failed
A check disagrees. The answer is the largest power of two whose product with the
value is at or below the maximum, so the loop stops before exceeding it rather
than after. A value already above the maximum admits no scaling at all, which is
a scale of one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A power of two is chosen because multiplying and dividing by one is exact:
the scaling introduces no error of its own, only range. A real training loop
raises the scale when several steps pass without an overflow and halves it the
moment one appears, which is a control loop wrapped around this arithmetic.

```starter
double loss_scale(double value, double maximum) {
    double s = 1.0;
    while (value * s < maximum) s *= 2.0;
    return s;
}
```

```tests
#include <assert.h>
double loss_scale(double, double);
int main(void) {
    assert(loss_scale(1.0, 1024.0) == 1024.0);
    assert(loss_scale(1.0, 1000.0) == 512.0);
    assert(loss_scale(3.0, 24.0) == 8.0);
    assert(loss_scale(3.0, 23.0) == 4.0);
    /* Already at the maximum: no room to scale. */
    assert(loss_scale(1000.0, 1000.0) == 1.0);
    assert(loss_scale(2000.0, 1000.0) == 1.0);
    return 0;
}
```

```solution
double loss_scale(double value, double maximum) {
    double s = 1.0;
    while (value * s * 2.0 <= maximum) s *= 2.0;
    return s;
}
```

## Conditioning, measured

Write `sensitivity`, returning how much the result of subtracting two values
moves, relative to itself, when one input is perturbed in its last bit.

This is the conditioning check, and it distinguishes a bad problem from a bad
algorithm without any error analysis.

@kind output
@concept Perturbing an input and rerunning separates a problem that amplifies
error from a method that adds it, and it takes minutes rather than a proof.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Perturb, recompute, and divide the change in the answer by the answer.
@diagnose assert verdict assert-failed
A check disagrees. The measure is relative to the answer rather than to the
input, which is what makes it large exactly when the two operands nearly cancel.
Dividing by the input instead reports a small number for the case this is
supposed to catch.
@diagnose compile verdict compile-error
Read the line the compiler names. `fabs` needs `<math.h>`.
@after A large number means the problem amplifies error and no amount of care in
the code will help. A small number means the problem is fine and any error you
see is the method's, which is something you can fix. Two runs and a division,
and it answers the question the literature spends chapters on.

```starter
#include <math.h>
double sensitivity(double a, double b, double delta) {
    double base = a - b;
    double moved = (a + delta) - b;
    return fabs(moved - base) / fabs(a);
}
```

```tests
#include <assert.h>
#include <math.h>
double sensitivity(double, double, double);
int main(void) {
    /* Well conditioned: a small input change makes a small relative change. */
    double s1 = sensitivity(10.0, 1.0, 1e-9);
    assert(s1 < 1e-9);
    /* Nearly equal operands: the same perturbation dominates the answer. */
    double s2 = sensitivity(1.0000001, 1.0, 1e-9);
    assert(s2 > 0.009);
    /* Perturbation of zero changes nothing. */
    assert(sensitivity(10.0, 1.0, 0.0) == 0.0);
    return 0;
}
```

```solution
#include <math.h>
double sensitivity(double a, double b, double delta) {
    double base = a - b;
    double moved = (a + delta) - b;
    if (base == 0.0) return 0.0;
    return fabs(moved - base) / fabs(base);
}
```

## The compiler that deletes your compensation

The compensation term computes a quantity that is algebraically zero, which means
an optimiser permitted to reassociate will remove it.

Write `compensation`, returning what one Kahan step recovers, and confirm it is
not zero.

@kind output
@concept An expression that is zero in exact arithmetic and not in floating point
is exactly what a reassociating optimiser is permitted to delete.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The compensation is what the sum actually gained minus what it should have
gained.
@diagnose assert verdict assert-failed
A check disagrees. `(t - s) - y` where `t` is `s + y` is zero only if the
addition was exact. When it rounded, the difference is precisely the part that
was lost, carried with a negative sign, which is why the next iteration
subtracts it rather than adding it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Under `-ffast-math` a compiler may simplify this to zero and delete the
whole mechanism, because it is entitled to assume the arithmetic is associative.
Code that depends on compensated summation has to be compiled without that
permission, and a library shipping it cannot control the flags its callers use.

```starter
float compensation(float s, float y) {
    (void)s; (void)y;
    return 0.0f;
}
```

```tests
#include <assert.h>
float compensation(float, float);
int main(void) {
    /* An exact addition loses nothing. */
    assert(compensation(1.0f, 1.0f) == 0.0f);
    assert(compensation(0.0f, 0.5f) == 0.0f);
    /* Adding one to two to the 24 loses the whole increment, and the
       compensation is what was lost, carried with its sign. */
    assert(compensation(16777216.0f, 1.0f) == -1.0f);
    /* Adding a tenth to ten million loses all of it too. */
    assert(compensation(1e7f, 0.1f) == -0.1f);
    return 0;
}
```

```solution
float compensation(float s, float y) {
    float t = s + y;
    return (t - s) - y;
}
```
