## What does a correctly predicted branch cost?

- [x] Nothing; the machine continues past it speculatively and is proved right
- [ ] One cycle, for the comparison
- [ ] The same as a mispredicted one, but with the work discarded
- [ ] It depends on the length of the loop body

@why That is why replacing a predictable branch with a conditional move makes
code slower: you replaced something free with something that is not.

## Why does the famous sorted array benchmark no longer reproduce?

- [x] The compiler removed the branch, by vectorising or by converting it to a conditional select
- [ ] Modern predictors handle random data as well as sorted
- [ ] The arrays now fit in cache
- [ ] The measurement was always wrong

@why Turn the vectoriser off and it still does not reproduce, because the
scalar loop is if-converted too. The compiler already applied the fix that the
famous answer tells you to apply by hand.

## What do you have to do to see the effect?

- [x] Give the compiler a branch it cannot remove, such as a call it cannot see through
- [ ] Use a larger array
- [ ] Disable optimisation entirely
- [ ] Sort the data differently

@why Then it appears at nearly seven times on one machine, which is close to
the original result.

## Two machines measured 6.86 times and 2.08 times on the same test. What does that say?

- [x] The mispredict penalty is a parameter of the microarchitecture rather than a constant
- [ ] One of the measurements is wrong
- [ ] The compilers differed
- [ ] The data differed

@why A shorter pipeline and a better predictor make a wrong guess cheaper, so
the cost of one is a property of the machine you are on.

## What is the transferable skill from the sorted array story?

- [x] Knowing when the compiler cannot remove a branch for you
- [ ] Sorting your data before processing it
- [ ] Always writing branchless code
- [ ] Avoiding conditionals inside loops

@why It cannot when the body has side effects, calls something opaque, or is
too large to be worth converting.

## What does arithmetic masking do?

- [x] Turns the condition into all ones or all zeros and combines the two values with bit operations
- [ ] Masks off the branch predictor's history
- [ ] Uses a lookup table indexed by the condition
- [ ] Marks lanes of a vector register as inactive

@why It needs no cooperation from the compiler and works in any language with
integers, which is why it is worth knowing by shape.

## What is predication by increment?

- [x] Adding the comparison itself, since it produces zero or one
- [ ] Incrementing a counter inside both sides of the branch
- [ ] Using a saturating counter to predict the branch
- [ ] Unrolling the loop so the branch is taken less often

@why It is the trick inside modern partitioning implementations, and it works
because a comparison is already a number.

## What is the cost of a conditional move that a branch does not have?

- [x] It converts a control dependency into a data dependency and sits in the chain
- [ ] It requires an extra register
- [ ] It cannot be vectorised
- [ ] It flushes the pipeline on every use

@why Nothing after it can proceed until it resolves, where a predicted branch
lets the machine run ahead.

## When does branchless code win?

- [x] When the branch is unpredictable, roughly beyond one wrong guess in ten
- [ ] Always; a branch is never faster
- [ ] When the loop body is small
- [ ] When the data fits in cache

@why It loses when the branch is predictable, which is why a compiler sometimes
emits a branch where you expected a move.

## Why does profile guided optimisation exist, in this context?

- [x] The compiler is guessing at how often a branch is wrong, and a profile stops it guessing
- [ ] It rearranges data layout automatically
- [ ] It selects between vector widths
- [ ] It removes the need for a branch predictor

@why It also explains why a higher optimisation level occasionally makes code
slower: the guess changed.

## Why is binary search the worst case for a predictor?

- [x] Each comparison eliminates exactly half the space, which is a coin flip by construction
- [ ] Its branches are nested too deeply to track
- [ ] It has too many branches per query
- [ ] The predictor cannot see through the indexing arithmetic

@why The algorithm is designed so each answer carries exactly one bit, so a
predictor cannot do better than chance.

## Binary search made branchless, with no other change, bought how much?

- [x] Between seven and twenty five percent
- [ ] Between two and three times
- [ ] Nothing measurable
- [ ] Over four times

@why The mispredicts are real and they overlap with the cache misses, which
dominate. Fixing the control flow without fixing the memory barely helps.

## What does the Eytzinger layout change?

- [x] The tree is stored breadth first, so the top levels that every query touches share the first few cache lines
- [ ] The comparison order, so branches become predictable
- [ ] The number of comparisons per query
- [ ] The element size, so more fit in a line

@why In a sorted array the middle element and its two quarter points are
megabytes apart, and every query touches all three.

## Prefetching in that search measured how?

- [x] Seven times worse at a thousand elements and twice as good at sixteen million
- [ ] Consistently about twice as good
- [ ] Consistently a small loss
- [ ] No measurable difference at any size

@why When the data is resident there is nothing to fetch, so every prefetch is
a wasted instruction. When it is not, the prefetch converts a serial chain of
dependent misses into several in flight.

## What is the general lesson from that swing?

- [x] An optimisation is a claim about a regime, so applying one because it is known to be fast is how you make code slower
- [ ] Prefetching should be avoided
- [ ] Small inputs should use different algorithms
- [ ] Measurements at one size do not transfer to another machine

@why The textbook algorithm is faster than the optimised one at a thousand
elements and nearly five times slower at sixteen million, on identical source.
