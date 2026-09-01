---
needs: [floats]
minutes: 55
one_idea: Error comes from two independent places, the problem and the algorithm, and compensating for the second does nothing about the first.
sources: [numbers-text-numerics, cpu-architectures]
---

The last unit was about what a float is. This one is about what happens when you
do a million operations with them, which is the situation every numerical program
and every neural network is actually in.

It is also where this handbook turns toward the low-precision formats the GPU
parts run on, because the reason you can train a model in eight bits is entirely
in this unit.

## Two different quantities

Two things decide how wrong an answer is, and they are independent.

Conditioning is a property of the problem. It says how much the answer moves when
the input moves. Subtracting two numbers that agree to fifteen digits is
catastrophically ill-conditioned: perturb an input in its last bit and the answer
changes by a large fraction of itself. No algorithm helps, because the difficulty
is in the question.

Stability is a property of the algorithm. It says how much error the method adds
on top of what the problem already had. A stable algorithm gives you an answer
that is exact for a slightly perturbed input, which is the best anyone can
promise.

Putting them together: a stable algorithm on a well-conditioned problem gives a
good answer, a stable algorithm on an ill-conditioned problem gives a bad answer
and it is not the algorithm's fault, and an unstable algorithm can ruin a
perfectly well-conditioned problem all by itself.

Knowing which of the two you have is the difference between rewriting your code
and rewriting your model.

## How error grows in a sum

Adding `n` numbers is the simplest interesting case, and the three ways of doing
it have three different error behaviours.

Summing left to right, each partial sum rounds, and the error can grow
proportionally to `n`. Summing pairwise, the depth of the tree is the logarithm
of `n`, and the error grows with that instead. Compensated summation tracks the
part that got rounded away and adds it back, and its error does not grow with `n`
at all.

Here is what that looks like measured. Adding 65536 copies of `0.1f`, where the
true total of the stored value is 6553.6000976562:

Left to right gives 6557.6464843750, which is off by 4.05, a relative error of
about six parts in ten thousand. Pairwise gives the exact answer. Compensated
summation gives the exact answer.

Six parts in ten thousand does not sound like much until it is a physics
simulation running for a million steps, or a loss value used to decide whether
training has converged.

```figure
{
  "kind": "plot",
  "alt": "Absolute error of left-to-right summation against term count on a logarithmic scale, rising from about a thousandth at 1024 terms to four at 65536.",
  "caption": "Measured, summing repeated tenths in 32-bit floats. Pairwise and compensated summation were exact at every one of these sizes, so only the sequential curve has anything to plot.",
  "log": true,
  "xlabel": "terms",
  "ylabel": "absolute error",
  "series": [
    { "label": "left to right", "accent": "bad",
      "points": [[1024, 0.000991821], [4096, 0.0157776],
                 [16384, 0.25293], [65536, 4.04639]] }
  ]
}
```

## Kahan, and what it does not do

Compensated summation, usually called Kahan summation after its author, is four
lines. Keep a running compensation term holding what the last addition lost,
subtract it from the next input before adding, and recompute it afterwards.

It is remarkable and it has three limits worth knowing.

It costs about four times the arithmetic, so it is not free on a hot loop.

A compiler with permission to reassociate will delete it. The compensation
computes `(t - s) - y`, which is algebraically zero, and `-ffast-math` is exactly
the permission to simplify it away. Code that needs it must be compiled without
that flag or must hide the computation from the optimiser.

And it does nothing at all about conditioning. Summing 1e8, 1, -1e8 and 1 in a
32-bit float, the true answer is 2. Naive summation gives 1. Kahan summation also
gives 1. The information was destroyed when 1e8 and 1 were added, because there
is no float between 1e8 and 1e8 plus 1, and no amount of compensation recovers a
value that was never representable.

That is the whole of "Kahan is not a panacea". It fixes accumulated rounding. It
does not fix cancellation.

## Why the same code gives two answers

Run a parallel reduction twice and you can get two different results, from the
same input, on the same machine, with no bug anywhere.

The reason is the previous unit's: floating point addition is not associative, so
the answer depends on the grouping. A parallel reduction's grouping depends on
how many threads ran, how the work was split, and in what order partial results
arrived. Change the thread count and the tree changes. Run it again and the
arrival order changes.

This is the single most common surprise for people arriving at GPU programming,
and the answer is usually one of three things.

Accept it, and compare results with a tolerance rather than for equality. Fix the
tree, by reducing in a fixed order regardless of scheduling, which costs some
performance. Or accumulate in a wider type, which shrinks the disagreement until
it stops mattering at the precision anyone looks at.

The third one is what almost everybody actually does, and it is the bridge to the
rest of this handbook.

## The bridge to low precision

Here is the idea that makes eight-bit arithmetic reasonable.

In a matrix multiply, each output is a sum of many products. The products
themselves do not need much precision: they are inputs times weights, both of
which are known to a few significant digits at best. The accumulation does,
because it adds many values and the running total spans a wide range.

So you multiply in a narrow format and accumulate in a wide one. That is exactly
what every tensor core does: fp16 or bf16 or fp8 inputs, fp32 accumulator. The
narrow format halves or quarters the memory traffic and the wide accumulator
keeps the sum honest.

The choice between narrow formats is the conditioning question again. bf16 keeps
fp32's exponent range and throws away mantissa bits; fp16 keeps more mantissa and
much less range. Training gradients span an enormous range and need bf16 or a
scaling trick; inference activations do not and are fine in fp16 or fp8.

Loss scaling is that scaling trick. Multiply the loss by a large constant before
computing gradients, so small gradients land inside fp16's representable range
instead of underflowing to zero, then divide the gradients back down before
applying them. It is one multiply and one divide and it is the difference between
fp16 training working and not.

## Rounding that is not biased

One more technique, because the GPU part returns to it.

Round to nearest, applied to a repeated accumulation in a narrow format, has a
failure mode: if every increment is smaller than half a step, every one of them
rounds to zero, and the accumulator never moves however many you add.

Stochastic rounding rounds up or down with a probability proportional to how
close the value is to each neighbour. Any individual result is worse, and the
expected value is exactly right, so a long accumulation drifts toward the correct
answer instead of standing still.

It is the reason low-precision training works at widths where deterministic
rounding stalls, and it costs a random number per operation, which is why it
appears in hardware rather than in software.

## Measuring it instead of trusting it

The techniques above are worth nothing if you cannot tell whether you need them,
and the check is cheaper than the reasoning.

Run the computation twice at two precisions. If the answers agree to most of the
narrower one's digits, the problem is well conditioned and your method is stable
enough. If they diverge, one of the two is at fault and the next question is
which.

Perturbing the input distinguishes them. Change an input in its last bit and rerun
at the same precision. A large change in the answer means the problem is
ill-conditioned and no amount of care in the code will help. A small change means
the problem is fine and the method is adding the error, which is something you
can fix.

Both checks take minutes and neither requires an error analysis. The literature on
this subject is large and precise and mostly unnecessary for deciding whether a
particular loop is good enough, which is the question people actually have.


Conditioning belongs to the problem, stability belongs to the algorithm, and
fixing one does nothing for the other.

Summation error grows with `n` sequentially, with the logarithm of `n` pairwise,
and not at all with compensation, and compensation costs four times the work and
can be optimised away.

Parallel reductions disagree because the tree changes, which is a fact about
associativity rather than a bug.

And the multiply-narrow accumulate-wide pattern is why low precision is viable at
all. Everything the GPU parts do with fp8 and fp4 rests on it.

## Reading the errors you are about to see

These implement the methods and compare them, and every expected value was
produced by running the code.

`assert-failed` names the case your method got wrong. Two of the exercises assert
that a technique fails, which is the point of them: a compensated sum that
matched the true answer on a cancellation case would mean the exercise was
measuring something other than what it claims.
