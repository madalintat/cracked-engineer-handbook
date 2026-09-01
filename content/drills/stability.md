## What is conditioning a property of?

- [x] The problem: how much the answer moves when the input moves
- [ ] The algorithm: how much error the method adds
- [ ] The format: how many bits the numbers have
- [ ] The compiler: which optimisations were applied

@why Subtracting two numbers that agree to fifteen digits is catastrophically
ill-conditioned, and no algorithm helps, because the difficulty is in the
question.

## What does a stable algorithm promise?

- [x] An answer that is exact for a slightly perturbed input
- [ ] An answer within a fixed tolerance of the true one
- [ ] That the error does not grow with the input size
- [ ] That the result is reproducible across machines

@why It is the best anyone can promise. A stable algorithm on an ill-conditioned
problem still gives a bad answer, and that is not the algorithm's fault.

## How does summation error grow, left to right?

- [x] Proportionally to the number of terms
- [ ] Proportionally to the logarithm of the number of terms
- [ ] Not at all
- [ ] Proportionally to the square of the number of terms

@why Pairwise grows with the logarithm and compensated does not grow at all.
Measured, 65536 tenths in a 32-bit float drift by four.

## Summing 65536 copies of `0.1f` left to right gave what?

- [x] 6557.646484375, where the true total is 6553.60009765625
- [ ] 6553.6, exactly
- [ ] Infinity, from accumulated overflow
- [ ] 6553.5, one step low

@why Six parts in ten thousand, from nothing but repeated rounding. That does not
sound like much until it is a simulation running for a million steps.

## What does Kahan summation track?

- [x] What the last addition rounded away, subtracted from the next input
- [ ] A running maximum, to rescale the accumulator
- [ ] The number of terms, to correct at the end
- [ ] A second accumulator at double precision

@why Four lines. The compensation is `(t - s) - y`: what the sum actually gained
minus what it should have gained.

## What are Kahan summation's three limits?

- [x] It costs four times the arithmetic, a reassociating compiler deletes it, and it does nothing about conditioning
- [ ] It only works for positive values, needs sorted input, and is slow
- [ ] It requires double precision, extra memory, and a second pass
- [ ] It has none; it is exact

@why The compensation is algebraically zero, which is exactly what
`-ffast-math` is permission to simplify away.

## Kahan summing 1e8, 1, -1e8, 1 in a 32-bit float gives what?

- [x] 1, the same as the naive sum, where the true answer is 2
- [ ] 2, which is why compensation is used
- [ ] 0, because the large terms cancel first
- [ ] 1e8, because the small terms are lost entirely

@why The loss happened when 1e8 and 1 were added, since there is no float between
them. No bookkeeping recovers a value the format could not hold.

## Why do two runs of the same parallel reduction disagree?

- [x] The grouping depends on thread count and arrival order, and addition is not associative
- [ ] The hardware uses a nondeterministic rounding mode
- [ ] Threads race on the accumulator
- [ ] Floating point units differ between cores

@why It is the most common surprise for people arriving at GPU programming, and
there is no bug anywhere.

## What do most people actually do about reduction nondeterminism?

- [x] Accumulate in a wider type until the disagreement stops mattering
- [ ] Fix the reduction tree regardless of scheduling
- [ ] Compare results for exact equality and retry
- [ ] Run single-threaded

@why The alternatives are to accept it and compare with a tolerance, or to fix
the tree at some cost in performance. Widening is the one that requires nothing
of the caller.

## Why can a matrix multiply use eight-bit inputs?

- [x] The products need little precision and the accumulation needs a lot, so only the accumulator has to be wide
- [ ] The values are all small
- [ ] Errors cancel across the sum
- [ ] Because the results are rounded to eight bits anyway

@why Every tensor core is built on that asymmetry: narrow inputs, fp32
accumulator. The narrow format cuts the memory traffic and the wide accumulator
keeps the sum honest.

## When would you choose bf16 over fp16?

- [x] When the values span a wide range, since bf16 keeps fp32's exponent
- [ ] When you need more mantissa bits
- [ ] When the hardware lacks fp16 support
- [ ] When the accumulator is also 16-bit

@why Training gradients span an enormous range and need bf16 or a scaling trick.
Inference activations do not and are fine in fp16 or fp8.

## What does loss scaling do?

- [x] Multiplies the loss by a power of two so small gradients land inside the representable range
- [ ] Reduces the learning rate when gradients overflow
- [ ] Normalises the gradients to unit length
- [ ] Converts gradients to fp32 before the update

@why A power of two is chosen because multiplying and dividing by it is exact, so
the scaling adds range and no error of its own.

## What is the failure mode round-to-nearest has in a narrow accumulator?

- [x] Every increment below half a step rounds away, so the total never moves
- [ ] The accumulator saturates at the maximum value
- [ ] Errors accumulate in one direction
- [ ] Subnormals slow the loop down

@why Measured: a ten-bit accumulator adding one repeatedly stalls at 2048, and an
eight-bit one stalls at 512, however many terms follow.

## What does stochastic rounding buy?

- [x] The expected value is exact, so a long accumulation drifts toward the right answer instead of standing still
- [ ] Individually more accurate results
- [ ] Determinism across runs
- [ ] Fewer operations per addition

@why Any single result is worse. It is why low-precision training works at widths
where deterministic rounding stalls, and it costs a random number per operation,
which is why it lives in hardware.

## How do you tell an ill-conditioned problem from an unstable method?

- [x] Perturb an input in its last bit and rerun at the same precision
- [ ] Compare the result against a higher-precision run
- [ ] Count the operations in the algorithm
- [ ] Check whether the result is reproducible

@why A large change in the answer means the problem amplifies error. A small one
means the problem is fine and the method is adding it, which is something you can
fix. Two runs and a division, instead of an error analysis.
