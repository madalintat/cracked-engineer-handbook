## What are the three fields of a float?

- [x] Sign, biased exponent, and fraction with an implied leading one
- [ ] Sign, magnitude, and scale
- [ ] Mantissa, exponent, and rounding mode
- [ ] Sign, integer part, and fractional part

@why A 32-bit float is 1, 8 and 23, and the implied bit is why twenty-three
stored fraction bits give twenty-four bits of precision.

## Why is the exponent stored with a bias rather than as a signed number?

- [x] So the bit patterns of positive floats increase in the same order as the values
- [ ] To reserve a pattern for zero
- [ ] To make the exponent field unsigned in hardware
- [ ] To leave room for the sign bit

@why Sorting positive floats as integers works, and so does counting the
representable values between two of them, which is what a numerical tolerance
should be measured in.

## Why is 0.1 not representable?

- [x] The fraction is binary, and ten has a prime factor two does not
- [ ] It needs more than 23 bits of fraction
- [ ] The exponent range does not reach that small
- [ ] It is, but printing rounds it

@why In binary it is 0.0001100110011 repeating, exactly as one third repeats in
decimal. No arithmetic will make the stored value one tenth.

## What is `16777216.0f + 1.0f`?

- [x] 16777216, because the gap between floats there is 2
- [ ] 16777217
- [ ] Infinity
- [ ] Undefined behaviour

@why That is two to the 24. A 32-bit float represents every integer exactly up to
there and starts skipping above it.

## Up to what value does a double represent every integer exactly?

- [x] Two to the 53, about nine quadrillion
- [ ] Two to the 64
- [ ] Two to the 32
- [ ] Two to the 24, like a float

@why Which is why using a double as a counter is usually fine and using a float
usually is not. Past sixteen million a float silently stops counting.

## Which comparison is true for a NaN?

- [x] `x != x`
- [ ] `x == x`
- [ ] `x < x`
- [ ] `x == 0.0 / 0.0`

@why Every comparison involving a NaN is false, including equality between two of
them, which is why comparing against a NaN constant does not work.

## Why does a NaN break sorting?

- [x] A comparison built on `<` stops being a valid ordering, and some implementations run off the array
- [ ] NaNs sort to the end and shift the other elements
- [ ] The comparison function returns a trap value
- [ ] Sorting is unaffected; only equality is

@why The sort was promised a consistent ordering and did not get one, and the
failure is not a wrong order but an out-of-bounds access.

## Why does zero have a sign?

- [x] So a reciprocal preserves the direction the value underflowed from
- [ ] To distinguish an uninitialised value from a computed one
- [ ] Because the sign bit has no other meaning at that exponent
- [ ] To allow a comparison against negative values

@why One over negative zero is negative infinity and one over positive zero is
positive infinity, and the two zeros compare equal, so equality cannot tell them
apart.

## What are subnormals for?

- [x] So that subtracting two nearby values cannot give exactly zero unless they were equal
- [ ] To extend the exponent range for very large values
- [ ] To represent values that failed to converge
- [ ] To provide extra precision near one

@why They give up the implied leading one and use the remaining bits as a plain
fraction, representing smaller values at steadily decreasing precision.

## What is the practical problem with subnormals?

- [x] Many processors handle them on a slow path, so code drifting into that range slows down enormously
- [ ] They compare unequal to themselves
- [ ] They cannot be printed accurately
- [ ] They are not portable between architectures

@why Audio filters decaying to silence are the classic case, and the slowdown
appears nowhere in a profile's instruction counts.

## What is the default rounding mode?

- [x] Round to nearest, ties to even
- [ ] Round to nearest, ties away from zero
- [ ] Round toward zero
- [ ] Round toward negative infinity

@why Rounding ties in a fixed direction adds half an unit of last place per tie,
which over a long accumulation is a drift rather than noise. Ties to even goes
each way about equally often.

## Which operation destroys precision rather than merely rounding it?

- [x] Subtracting two nearly equal numbers
- [ ] Multiplication of very large values
- [ ] Division by a small number
- [ ] Repeated addition

@why If both operands are accurate to seven digits and agree in the first six,
the difference has one significant digit and six digits of noise. The information
was never there.

## The textbook quadratic formula on x squared plus 1e8 x plus 1 gives what error on the small root?

- [x] About twenty five percent
- [ ] A few units in the last place
- [ ] None; the formula is exact
- [ ] It returns NaN

@why It gives -7.450580596923828e-09 where the answer is
-1.0000000000000000209e-08, from a formula that is mathematically correct and
implemented without a mistake.

## What does a fused multiply-add do differently?

- [x] Rounds once at the end instead of rounding the product and then the sum
- [ ] Computes the product at double the width
- [ ] Uses a different rounding mode for the multiply
- [ ] Executes on a separate port

@why It is more accurate and faster, and it is why the same source compiled with
and without it produces different numbers, neither of which is wrong.

## How should you compare two floats?

- [x] Absolute tolerance near zero, relative above it, or count the representable steps between them
- [ ] With a fixed epsilon such as 1e-9
- [ ] With a relative tolerance always
- [ ] With equality, since the operations are deterministic

@why An absolute tolerance is wrong for large values and a relative one is
meaningless near zero. Counting steps handles every magnitude with one constant.
