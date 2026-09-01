---
needs: [integers]
minutes: 55
one_idea: A float is a number written in scientific notation with a fixed budget, so the gap between representable values grows with their size and almost every surprise follows from that.
sources: [numbers-text-numerics, cpu-architectures]
---

Unit 027 was about a representation where every value in range is exact. This one
is about the other kind, where almost nothing is, and where the useful skill is
knowing which operations make that matter.

## Scientific notation, in binary, with a budget

A float is three fields. A sign bit, an exponent, and a fraction. The value is
the fraction times two to the exponent, and the fraction is understood to have a
leading 1 that is not stored, because a normalised binary number always starts
with one and there is no point spending a bit on it.

For a 32-bit float that is 1 sign bit, 8 exponent bits and 23 stored fraction
bits, which gives 24 bits of precision. For a 64-bit double it is 1, 11 and 52,
giving 53.

```figure
{
  "kind": "bits",
  "alt": "A 32-bit float divided into one sign bit, eight exponent bits and twenty-three fraction bits.",
  "caption": "One sign, eight exponent, twenty-three stored fraction bits, and a leading 1 that is implied rather than kept. Twenty-four bits of precision from twenty-three bits of storage.",
  "bits": 32,
  "groups": [
    { "from": 0,  "to": 22, "label": "fraction", "accent": "azure" },
    { "from": 23, "to": 30, "label": "exponent", "accent": "copper" },
    { "from": 31, "to": 31, "label": "sign", "accent": "gold" }
  ]
}
```

The exponent is stored with a bias rather than as a signed number, which makes
comparing two positive floats the same as comparing their bit patterns as
integers. That is a deliberate design decision and a useful one: sorting floats
as integers works, for positives.

## Why 0.1 is not there

The fraction is binary, so a value is representable only if it is a sum of powers
of two.

One tenth is not. In binary it is 0.0001100110011 repeating forever, exactly as
one third is 0.333 repeating in decimal, and for the same reason: ten has a prime
factor the base does not.

So `0.1f` is stored as the nearest float, which is 0.10000000149011611938. And
`0.1` as a double is 0.10000000000000000555. Neither is one tenth, and no
arithmetic will make them one tenth.

This is the whole content of the observation that adding 0.1 three times does not
give 0.3. Nothing is broken. The literal was never 0.1 in the first place.

## The gap grows

Here is the property that explains most of the rest.

The exponent scales the whole number, so the distance between neighbouring
representable values scales with it too. Near 1.0 the gap for a 32-bit float is
about 1.19 times ten to the minus seven. Near 8388608, which is two to the 23,
the gap is exactly 1. Near 16777216, which is two to the 24, the gap is 2.

Which means `16777216.0f + 1.0f == 16777216.0f` is true. There is no float
between those two, so the sum rounds back to where it started.

That number is worth remembering. A 32-bit float represents every integer exactly
up to two to the 24, which is 16777216, and above that it starts skipping. For a
double the limit is two to the 53, about nine quadrillion, which is why using a
double as a counter is usually fine and using a float is usually not.

## The values that are not numbers

Some exponent patterns are reserved.

Infinity is what overflow produces, and it propagates: anything plus infinity is
infinity. Dividing by zero gives infinity with the sign of the zero, which is why
there are two zeros. Positive and negative zero compare equal and are
distinguishable, because one over each gives a different infinity.

Not-a-number is what 0/0 and the square root of a negative produce. It has one
property that catches everyone: it compares unequal to everything, including
itself. `x != x` is the standard test for it, and it is not a trick, it is the
only comparison the standard defines to be true.

That property also breaks sorting. A comparison function that returns "less than"
based on `<` will violate the ordering it promised the moment a NaN appears, and
some sort implementations respond by walking off the end of the array.

## The cliff nobody documents

Below the smallest normal value, floats do not stop. They give up the implied
leading 1 and use the remaining bits as a plain fraction, which lets them
represent much smaller values at steadily decreasing precision. Those are
subnormals, and they exist so that subtracting two nearby values cannot produce
exactly zero unless they were equal.

The problem is speed. On many processors subnormal operands are handled by a slow
path, and code that drifts into that range can run tens of times slower for
reasons that appear nowhere in a profile's instruction counts. Audio filters
decaying to silence are the classic case.

The usual fix is a mode bit that flushes subnormals to zero, which trades a
correctness property for a performance one. It is what most graphics and machine
learning code runs with, and it is not the default in C.

## Rounding, and the surprising default

Every operation rounds, and the standard gives five modes. The default is round
to nearest, ties to even.

The ties-to-even part is the part people ask about. Rounding a tie always upward
introduces a bias that accumulates over a long sum. Rounding to whichever
neighbour has an even last bit has no such bias, because it goes each way about
equally often.

The other modes exist for a reason too. Rounding toward zero is what integer
conversion does. Rounding toward positive and negative infinity are what interval
arithmetic uses, running a calculation twice to get a proven bracket around the
true answer.

## Where precision actually disappears

Multiplication and division are well behaved: the relative error stays small.

Subtraction of two nearly equal numbers is not. If both operands are accurate to
seven digits and they agree in the first six, the difference has one significant
digit and six digits of noise. Nothing was rounded badly; the information simply
was not there.

The quadratic formula is the standard example. Solving one x squared plus 1e8 x
plus 1 with the textbook formula gives a root of -7.450580596923828e-09. The
mathematically equivalent form that avoids subtracting nearly equal numbers gives
-1.0000000000000000209e-08, and that one is right. The naive answer is twenty
five percent wrong, from a formula that is correct.

The lesson is not to avoid subtraction. It is that when two large numbers nearly
cancel, whatever you do next is working with what is left, and there may not be
much of it.

## The multiply that does not round twice

One instruction worth knowing about, because it changes results.

A fused multiply-add computes a times b plus c with a single rounding at the end,
rather than rounding the product and then rounding the sum. It is more accurate
and it is faster, and it is why the same source compiled with and without it
produces different numbers.

That is also why it cannot be applied silently in a language that promises
reproducible results, and why C has a pragma controlling it. A library that
computes a dot product with fused operations and one that does not will disagree
in the last bits, and neither is wrong.

## Comparing them

The advice not to use equality on floats is repeated everywhere and is usually
given without the part that matters, which is what to do instead.

An absolute tolerance is wrong for large values. Two doubles around a billion
differ by more than 1e-9 as a matter of course, so a fixed epsilon rejects
numbers that agree to every digit anyone cares about.

A relative tolerance is wrong near zero. Dividing by a quantity that is nearly
zero makes the comparison meaningless, and it is undefined when both are exactly
zero.

The usable form combines them: accept if the absolute difference is under a small
floor, or if the relative difference is under a tolerance. The floor handles the
region near zero and the ratio handles everything else, and both numbers depend
on the problem rather than on the format.

There is a third approach that is exact rather than heuristic. Because the
exponent is biased, the bit patterns of positive floats increase in the same
order the values do, so the number of representable values between two floats can
be counted directly. Comparing that count against a small budget asks a precise
question: are these within a few steps of each other. It handles every magnitude
with one constant, and it is what a serious numerical test suite uses.


A float is a fixed number of significant bits and a scale, so the gap between
values grows with the values. Every integer up to two to the 24 is exact in a
32-bit float and nothing above it is.

NaN is unequal to itself, zero has a sign, subnormals are slow, and the default
rounding breaks ties toward even to avoid a bias no single operation would show.

And the operation to watch is subtraction of nearly equal quantities, because it
is the one that destroys information rather than merely rounding it.

Unit 029 takes that last point seriously and asks what to do about it, which is
also where this handbook starts moving toward eight and four bit formats.

## Reading the errors you are about to see

These are C, and several of them inspect the bits directly, which is done by
copying rather than by pointer casting, because casting a float pointer to an
integer pointer is undefined behaviour and the compiler is entitled to notice.

`assert-failed` names the case your answer disagreed on. Every expected value in
this unit was produced by running the code rather than derived from the formula.
