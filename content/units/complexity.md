---
needs: [computability, languages]
minutes: 55
one_idea: NP-hard is advice about which approach to take, and the approaches that work are the reason intractable problems get solved every day.
sources: [compilers-interpreters-terminals-unix, nand2tetris-eater-scott]
---

The last unit drew a line around what no machine can do. This one draws a
different line, around what machines can do and not quickly, and this is the line
you will actually stand on.

It also has the worse reputation of the two. Undecidable is understood as
impossible, which is correct. NP-hard is understood as impossible, which is not,
and the misunderstanding costs real work: people abandon problems that are solved
routinely, and people reach for exact algorithms on problems where an
approximation would have been fine.

## Growth, not speed

Start with what the notation means, because it is often read as a claim about
time and it is not.

Saying an algorithm is O(n log n) says how its cost grows as the input grows. It
says nothing about how long it takes on your input, on your machine, today. A
quadratic algorithm with a small constant beats a linearithmic one with a large
one, and it beats it for every input below the crossover point.

Real libraries are built on exactly that. Almost every serious sort switches to
insertion sort below some threshold, because insertion sort is quadratic and it
is faster at that size. Almost every serious matrix multiply ignores the
asymptotically better algorithms, because their constants are large enough to
lose at every size anyone actually multiplies.

So the first practical rule is that asymptotic analysis tells you where an
algorithm goes and measurement tells you where it is. Both are needed and
neither substitutes.

## Verify against find

Now the class distinction, which is simpler than its reputation.

Some problems are easy to check and appear to be hard to solve. Given a proposed
schedule, you can verify in one pass that no two meetings clash. Finding a
schedule that satisfies every constraint is another matter. Given a factorisation
you can multiply it out; finding one is what a good deal of cryptography depends
on being hard.

P is the problems solvable in time polynomial in the input size. NP is the
problems where a proposed answer is checkable in polynomial time. Every problem
in P is in NP, because solving it is one way to check it. Whether the reverse
holds is the open question, and the honest summary is that after fifty years
nobody has an approach, and almost everyone expects the answer is no.

The word nondeterministic in NP is the source of most of the confusion. It does
not mean random. It means a machine allowed to guess, which is the same as saying
a machine whose answer is easy to check once someone hands you the guess.

## The hardest ones, and why that is useful

Some problems in NP have the property that every other problem in NP reduces to
them: translate any instance of any NP problem into an instance of this one, in
polynomial time, and solve it there. Those are the NP-complete problems, and Cook
and Levin showed in 1971 that Boolean satisfiability is one.

The reduction is the technique that matters, and it runs both ways.

To show your problem is hard, reduce a known hard problem to it. To solve your
problem, reduce it to one somebody has already built a good solver for. That
second direction is done constantly and is the reason this theory earns its
place. Scheduling, register allocation, layout, dependency resolution and
verification all get translated into satisfiability and handed to a solver
somebody else spent a career on.

## The solvers win anyway

Here is the part that makes NP-hard advice rather than a verdict.

Satisfiability is NP-complete, and solvers routinely settle instances with
millions of variables. Not toys. Industrial instances from chip verification,
package management and program analysis, every day.

The measurement below is from a solver simple enough to be an exercise in this
unit: unit propagation and branching, with none of the machinery a real one has.
The instances are the pigeonhole family, `n+1` items into `n` boxes, which is
unsatisfiable and is the standard hard case for this method.

```figure
{
  "kind": "plot",
  "alt": "A logarithmic plot comparing brute force assignments against solver decisions on pigeonhole instances from 6 to 56 variables.",
  "caption": "Measured. At 56 variables the exhaustive search is 2 to the 56, about 72 quadrillion assignments; the solver settles it in 65561 decisions.",
  "log": true,
  "xlabel": "variables",
  "ylabel": "steps",
  "series": [
    { "label": "every assignment", "accent": "bad",
      "points": [[6, 64], [12, 4096], [20, 1048576], [30, 1073741824],
                 [42, 4398046511104], [56, 72057594037927936]] },
    { "label": "propagate and branch", "accent": "jade",
      "points": [[6, 3], [12, 17], [20, 103], [30, 749], [42, 6491], [56, 65561]] }
  ]
}
```

The solver is still exponential. Pigeonhole is provably hard for this family of
methods, and the curve is a straight line on a log axis just like the other one.
It is a straight line with a very different slope, and that difference is what
gets work done.

The reason is the one from unit 015. Real instances are not worst cases. They
have structure, a decision about one variable forces twenty others, and a solver
that records why a branch failed never revisits that region. Worst-case
complexity describes an adversary choosing your input. Most of the time nobody
is.

## What NP-hard actually tells you

It tells you to stop looking for a fast exact algorithm that works on every
input, and to pick one of four other plans instead.

Accept an approximate answer. Many NP-hard problems have algorithms that
guarantee a result within a known factor of the best, and for most purposes a
solution within a few percent, found quickly, is worth more than the best one
found next week.

Use a solver. Reduce to satisfiability or to integer programming and let
somebody else's decades of work run. This is the option people most often fail to
consider, and it is usually the right one.

Exploit the structure you have. Hardness is over all instances. Many problems
become easy on trees, on planar graphs, on bounded widths, or when a parameter
you control is small.

Or note that your instances are small. Exponential in 20 is a million, which is
nothing. A great deal of anxiety about complexity concerns inputs that will never
exceed a few dozen elements.

The bad plan is the fifth one, which is to give up, and the second bad plan is to
write your own exact solver for a problem the world already has one for.

## Where the reduction goes wrong

Two failure modes worth naming, because both are common and both come from
treating a class as a verdict.

The first is calling something NP-hard when it is not. Hardness is a property of
a problem, meaning the general case over all inputs, and it is established by
exhibiting a reduction rather than by the problem feeling difficult. A great deal
of code has been abandoned on the grounds that something resembled the travelling
salesman, when the actual instance had ten nodes or a structure that made it
polynomial.

The second is the opposite: reducing to a solver and then being surprised when it
does not return. A reduction is only useful if it produces instances the solver
is good at, and an encoding that multiplies the variable count by a thousand can
turn a tractable problem into one nothing will finish. Two correct encodings of
the same problem routinely differ by orders of magnitude in solving time, and
choosing between them is a real skill rather than a formality.

Both mistakes share a root. A complexity class is a statement about the worst
case over an infinite family of inputs, and your job concerns a particular finite
input with a particular shape. The class tells you which shelf to look on. It
does not tell you what is on it.

## Beyond NP

Two things worth knowing, because they explain some familiar tools.

Above NP sits PSPACE, the problems solvable with polynomial memory and any amount
of time. Deciding a winning strategy in a two-player game lives here, and so do
several questions in model checking. Above that sits EXPTIME, where some problems
are provably not in P, which is a stronger statement than anything known about
NP.

And the whole tower sits under the line from the last unit. Undecidable is a
different kind of statement from intractable: one says no algorithm exists, the
other says every algorithm is slow. Confusing them is common and leads to the
wrong plan in both directions.

## What to carry into Part V

Part IV has been about what machines can do in principle, and none of it referred
to a cache, a pipeline or a clock.

That is deliberate, and it is also the limit of its usefulness. Two algorithms
with identical asymptotic cost can differ by ten times on a real machine because
one of them walks memory in a way the hardware likes. Part V is about that
machine, and Part X returns to cost with the hardware in the picture.

## Reading the errors you are about to see

These exercises count operations rather than measuring time, because a step count
is reproducible and a wall clock on a shared service is not.

`assert-failed` names the case where your count or your answer is wrong. Several
of the exercises assert an exact number of steps, and those numbers were measured
by running the reference implementation rather than derived from the formula, so
if yours differs the difference is real.
