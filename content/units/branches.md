---
needs: [layout, pipeline]
minutes: 55
one_idea: A branch the machine can guess is free and one it cannot costs the pipeline, the compiler has already removed most of the branches you would have removed by hand, and the fix that helps at one size is a sevenfold loss at another.
sources: [algorithms-on-real-hardware]
---

The most upvoted question on the largest programming site asks why processing a
sorted array is faster than processing an unsorted one. The loop sums the
elements above a threshold, and the answer is branch prediction: sorted data
gives a long run of one outcome and then a long run of the other, and random data
gives a coin flip.

Run it today and it does not reproduce. That failure is a better lesson than the
original result, and this unit is built around it.

## The benchmark that stopped working

Same loop, same threshold, two runs on the same data sorted and unsorted:

```
   unsorted   44.9 ms
   sorted     44.4 ms          1.01x
```

No effect at all. The assembly says why. The compiler turned the loop into
vector instructions: a comparison that produces a per lane mask, and a masked
select. Four elements per instruction and no control flow whatsoever. There is
no branch left to predict.

Turn the vectoriser off and it still does not reproduce. The compiler converts
the scalar loop too, into a compare and a conditional select. The only branch
remaining is the loop back edge, which is taken every iteration but the last.

The compiler already applied the fix that the famous answer tells you to apply
by hand.

## Making the branch real

To see the effect you have to give the compiler a branch it cannot remove: a
call it cannot see through, with a side effect it cannot prove absent.

```
   plain loop, machine A       111.2 ms / 112.4 ms     1.01x
   opaque call, machine A      262.3 ms /  47.5 ms     6.86x
   plain loop, machine B        44.9 ms /  44.4 ms     1.01x
   opaque call, machine B      181.7 ms /  87.9 ms     2.08x
```

Now it is there, and close to the original result on one machine. Notice that
the two machines disagree by a factor of three on the size of the penalty. A
shorter pipeline and a better predictor make a mispredict cheaper, so the cost
of a wrong guess is a parameter of the microarchitecture rather than a constant
of computing.

The order to learn this in is the order above. Run the classic benchmark and see
nothing. Read the assembly and find the conditional select. Defeat the
optimisation and watch the effect appear. Then conclude the useful thing:
compilers do branchless conversion for you on simple loops, and the skill worth
having is knowing when they cannot, which is when the branch body has side
effects, calls something opaque, or is too large to be worth converting.

## The ways to remove a branch

There are five, and they are worth knowing by shape rather than by name.

A conditional move is a single instruction that picks one of two values. You do
not usually write it; you nudge the compiler towards it with a conditional
expression or a minimum.

Arithmetic masking builds the same selection out of bit operations. Turn the
condition into a mask of all ones or all zeros, and the selection is an and, an
and with the complement, and an or. It needs no cooperation from the compiler
and works in any language with integers.

Predication by increment turns a counted branch into arithmetic: adding the
condition itself, since a comparison produces zero or one. This is the trick
inside modern sorting implementations for partitioning.

A table lookup replaces a branch with an index. It trades a possible mispredict
for a possible cache miss, which is usually a bad trade unless the table is
small enough to stay resident.

And per lane masking in vector instructions is the same idea in the register
width: a mask register selects which lanes take effect. It is the reason a loop
with a condition inside it can be vectorised at all.

## Why branchless is not always better

Here is the caveat that decides when to use any of the above.

A conditional move converts a control dependency into a data dependency. A
branch the predictor gets right costs nothing at all, because the machine
continues past it speculatively and is proved correct. A conditional move always
costs its instruction, and worse, it sits in the dependency chain: nothing after
it can proceed until it has resolved.

So the rule is a comparison of two costs. Branchless wins when the branch is
unpredictable, roughly beyond one wrong guess in ten. Branchless loses when the
branch is predictable, because you have replaced something free with something
that lengthens the chain.

This is why compilers sometimes emit a branch where you expected a move, why a
higher optimisation level can occasionally make code slower, and why profile
guided optimisation exists: the compiler is guessing at how often the branch is
wrong, and a profile stops it guessing.

## The perfect storm

Binary search is the worst case for all of this at once.

Every comparison eliminates exactly half the remaining space, which is the
definition of a coin flip, so every branch is maximally unpredictable and there
are about log n of them per query.

Every probe depends on the previous comparison, so the accesses form a dependent
chain and none of them can overlap.

And the probes are maximally spread: the first is the middle, then a quarter,
then an eighth, each landing on a fresh cache line for the first several steps.

Three fixes exist, and their measurements are the point of this unit.

```
   n            branchy   branchless   Eytzinger   Eytzinger + prefetch
   1,024         8.11       7.47         6.47          44.92
   16,384       13.83      12.33        10.76          41.67
   262,144      38.97      37.13        21.90          70.65
   4,194,304    89.31      77.04        45.37          45.41
   16,777,216  360.26     287.87       164.31          75.74
```

Removing the branch alone buys very little, between seven and twenty five
percent. The mispredicts are real and they overlap with the cache misses, which
dominate. Fixing the control flow without fixing the memory barely helps.

Changing the layout buys more than twice. The Eytzinger arrangement stores the
tree breadth first in an array, so the root is at index one and the children of
any node are at twice its index and twice plus one. The search becomes a
branchless loop that multiplies the index by two and adds the comparison. The
gain is locality: the top of the tree, which every query touches, is packed into
the first few cache lines and stays resident forever. In a sorted array the
middle element and its two quarter points are megabytes apart.

## The result worth being changed by

Look at the last column.

Prefetching, on the same code, is a sevenfold loss at a thousand elements, break
even at four million, and a twofold win at sixteen million.

The reason is exactly the two regimes of the previous unit. When the data fits
in cache there is nothing to prefetch, so every prefetch is a wasted instruction
and wasted bandwidth on a line you already have. When it does not fit, the
prefetch converts a serial chain of dependent misses into several misses in
flight at once, which is the only lever available.

Combined, the layout change and the prefetch are nearly five times faster than
the textbook algorithm at sixteen million elements, and the textbook algorithm
is faster than the optimised one at a thousand.

An optimisation that swings from seven times worse to twice as good, on
identical source, with only the input size changing, is the best inoculation
available against applying a technique because it is known to be fast.

## What to carry forward

The branch predictor is part of your cost model. A branch that is guessed right
is free and one that is guessed wrong costs the pipeline, and the size of that
cost differs threefold between machines.

The famous sorted array benchmark does not reproduce because the compiler
already removed the branch. Reading the assembly is how you find that out, and
knowing when the compiler cannot do it is the transferable skill.

Branchless code wins when the branch is unpredictable and loses when it is
predictable, because a conditional move is never free and a predicted branch is.

Binary search is unpredictable branches, dependent misses and maximal spread all
at once. Fixing only the branches barely helps; fixing the layout more than
doubles it; and prefetching is a large loss or a large win depending entirely on
whether the data fits in the cache.

Next is what happens when the work can be spread across many cores: how to
measure a parallel algorithm on two axes rather than one, and the primitive that
turns irregular work into regular work.

## Reading the errors you are about to see

These model the decisions the unit describes: what a mispredict costs, when to
go branchless, the arithmetic that selects without a branch, and the index walk
of a breadth first tree.

`assert-failed` names the case your model got wrong. Several exercises assert
that a perfectly predicted branch costs nothing, which is speculation working
rather than a term missing from the sum.
