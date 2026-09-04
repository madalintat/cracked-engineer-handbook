---
needs: [debugger]
minutes: 55
one_idea: Every way of coming to believe code is correct splits into generating an input and having an oracle that recognises a wrong answer, and almost every complaint about testing turns out to be one of those two halves missing.
sources: [testing-fuzzing-verification]
---

There is one question under this whole unit. What would have to be true for you
to believe this code is correct, and what is the cheapest thing that makes it
true?

The answers form a ladder. Example tests say these inputs behave. Property tests
say a class of inputs obeys a law. Fuzzing says no input in a very large
searched space triggered anything detectable. Static analysis says something
about the whole program, modulo the tool being wrong. Proof says a model
satisfies a specification, and costs weeks.

Each rung costs more and applies to less, and the useful skill is knowing which
one a situation actually needs.

## The split that organises everything

Every technique above is two independent pieces. There is input generation:
how do you reach an interesting state. And there is the oracle: once you are
there, how do you know it is wrong.

Almost all the confusion in this area comes from mixing the two up. A unit test
picks the input by hand and writes the oracle by hand. A property test generates
the input and states the oracle as a law. A fuzzer generates inputs aggressively
and borrows its oracle from somewhere else. A model checker enumerates inputs
over a small model and takes the oracle from a formula.

So when a fuzzing run finds nothing, there are exactly two possibilities. It
could not reach the code, or it could not tell that the code was wrong. Keeping
those apart makes the rest of this bookkeeping.

## From an example to a law

An example test names an input and an expected output. A property test says
something that should hold for every input, and hands the search to a machine.

Take sorting. The example checks that one list comes out in order. The property
says the result is ordered and is a permutation of the input, and that second
clause is the one people leave out. Without it, an implementation that empties
the list passes, because an empty list is sorted. That is not a contrived
failure; it is what a test suite full of hand-picked expected outputs quietly
permits.

The reframe is that you are not writing more tests. You are writing fewer and
stronger statements and delegating the enumeration, because the generator
replaces the part of your test suite with the worst coverage of adversarial
inputs, which is your imagination. Your imagination does not produce the empty
string, a string with an embedded zero byte, the most negative integer, or four
thousand identical elements. A generator produces all of them before lunch.

## Generators, and the two ways they go wrong

A generator turns randomness and a size into a value. Two things decide whether
one is any good.

The first is distribution. A uniform draw over every 32 bit integer will
essentially never produce zero, one, minus one, or either extreme, which are the
only values that ever have bugs in them. A good generator biases hard towards
small magnitudes and known boundaries. When you write your own, put the bias in
on purpose.

The second is validity, and it hides a trap. If your property needs its input to
satisfy a precondition, you can generate values and throw away the ones that
fail. That works while most are accepted, and it collapses when few are: try to
get a valid twenty node balanced tree by discarding random trees and the
acceptance rate is about zero. Worse is the middle case, where enough are
accepted to keep going and the survivors are a narrow, skewed corner of the
space you believed you were testing.

The way out is to generate the operations rather than the state. Build the tree
by generating a sequence of insertions and applying them. Now everything
generated is valid by construction, the distribution is over states the program
can actually reach, and nothing is discarded. It tests the interface as well as
the structure.

## Why shrinking is the whole technique

A property test that fails hands you a counterexample from the middle of the
random space: a list of two hundred numbers, or a string of unprintable bytes.
That is technically a bug report and practically useless.

Shrinking is the search for a smaller input that still fails. Cut the list in
half and see if it still fails. Reduce a number towards zero. Simplify a
character towards a printable one. Repeat until nothing smaller fails.

The two hundred element list becomes a list of two, and the offending value
becomes the smallest one that still breaks it. That is the difference between a
technique people use and one they abandon, and it is the part most descriptions
wave at.

## Three generations of fuzzing

In 1990 a researcher on a dial up line during a thunderstorm noticed that line
noise was corrupting his keystrokes and that the utilities were crashing. He
turned it into a study: feed random characters to about ninety standard system
utilities. Between a quarter and a third of them crashed or hung.

That is the first generation, and its limit is arithmetic. Purely random bytes
get past a four byte magic number check with a probability of one in four
billion, so random input tests input validation and nothing whatsoever behind
it.

The second generation mutates real inputs instead. Start with a corpus of valid
files and corrupt them, and you begin past the magic number. It found a great
deal and it is blind: it has no way to tell whether a mutation made progress, so
the millionth mutation of a seed gets the same effort as the first.

The third generation added one signal, and it changed everything: did this input
execute an edge of the control flow graph that no previous input executed? If
so, keep it in the corpus. That converts a blind random walk into a hill climb
over the program's own structure. The advertisement for it is still the best one
available: starting from a corpus containing only the word hello, the fuzzer
synthesised syntactically valid image files, because each step towards a valid
header unlocked new coverage and was therefore kept. Nobody told it what the
format was.

## The loop, and two pieces of engineering inside it

```
corpus   = seeds
coverage = {}
forever:
    mutant = mutate(pick(corpus))
    reset(counters); run(mutant)
    if crashed or sanitizer fired or timed out:
        save as a bug
    else if bucketize(counters) has anything new:
        coverage |= new
        corpus.add(mutant)
```

The instrumentation is deliberately cheap. The compiler inserts a counter update
at every edge, into a flat array indexed by a number it assigned, with no idea
of source lines. The original formulation is three lines and it explains what an
edge is:

```
cur = <random per basic block>
map[cur ^ prev]++
prev = cur >> 1
```

The identity of an edge is the exclusive or of two block identifiers, which is
what makes it an edge and not a block. The shift is there so that going from A
to B is distinguishable from going from B to A, and so a self loop does not hash
to zero. And because it is a hash into a fixed size table, a large program
silently loses some edges to collisions.

The second piece is bucketing. Treating forty one executions of an edge as
different from forty two would make every input novel and drown the signal;
treating an edge as merely hit or not hit loses the fact that a loop ran twice
instead of once, which is often exactly the discovery you want. So counts are
quantised into about eight classes, roughly powers of two, and a new class
counts as new coverage while a new count inside a class does not. It is a
compromise and it is why the corpus stays bounded.

## The oracle problem, again

A fuzzer has no idea what correct means. It notices a crash. In languages where
a buffer overflow does not crash but quietly corrupts the next object, that
means the search runs for days and finds nothing, while the bugs are there.

This is why fuzzing without a sanitizer is close to pointless in C and C++. The
sanitizer is the thing that turns a silent memory error into an immediate,
loud, reported failure, and it is what the fuzzer's crash detector is actually
detecting. The coverage guided loop is the generator; the sanitizer is the
oracle; neither is much use without the other.

There is a second oracle worth knowing. Run two independent implementations of
the same specification on the same input and compare. Any disagreement is a bug
in one of them, and you do not have to know which. A startling share of real
cryptography and compiler bugs have been found exactly that way.

## Coverage is a diagnostic and a bad target

Coverage tells you what your tests never touched, which is genuinely useful:
uncovered code is untested code and often surprising.

Turn it into a target and it stops meaning anything, because it is easy to
execute a line without checking anything about it. A suite with no assertions at
all can reach full coverage.

The deeper limit is the one to remember. Coverage cannot see code that is not
there. The most expensive defects in systems software are omissions: the missing
bounds check, the error return nobody looked at, the overflow check never
written. There is no line to leave uncovered, so the measurement is blind to the
entire category, and it is the category that produces the security advisories.

## What to carry forward

Every technique is generation plus an oracle. When a search finds nothing, it
either could not reach the code or could not tell it was wrong.

A property states a law and delegates the search. Say the whole law, because
ordered without permuted accepts an implementation that throws your data away.
Generate the operations rather than the state, and never rely on discarding.

Shrinking is what makes a counterexample readable, and it is most of why the
technique survives contact with people.

Coverage guided fuzzing is a hill climb over the control flow graph, using an
edge as the exclusive or of two block identifiers and bucketed counts to keep
the corpus finite. In C and C++ the sanitizer is the oracle, and without it the
loop mostly finds nothing.

Coverage is a superb diagnostic and a catastrophic target, and it is structurally
blind to the missing check.

That closes this part. The next one starts from the other end: not how to find
out whether code is right, but what it costs to run, and where that cost comes
from on a real machine.

## Reading the errors you are about to see

These model the machinery: the edge hash, the bucketing table, a permutation
check, a shrink, and the arithmetic behind why random bytes never reach past a
magic number.

`assert-failed` names the case your model got wrong. Several exercises assert
that going from one block to another is a different edge from going back, which
is the shift in the hash doing its job rather than a stray operation.
