---
needs: [cost-model]
minutes: 55
one_idea: A parallel algorithm has two costs rather than one, and the operation that looks most stubbornly sequential turns out to be the primitive that makes variable sized parallel output possible at all.
sources: [algorithms-on-real-hardware]
---

Sequential complexity is one number. Parallel complexity is two, and using one
where two are needed is the most common mistake in the subject.

The first is work: the total number of operations across every processor. It is
what you pay for in energy and in total machine time, and it is the number that
sequential complexity was already measuring.

The second is depth, sometimes called span: the longest chain of operations that
must happen in order. It is what you would take with infinitely many processors,
and no amount of hardware makes it smaller.

## Two numbers, and what they buy

The two are tied together. With a given number of processors the time is bounded
by the work divided by them, plus the depth. That says the obvious thing
precisely: you can spread the work out, and you cannot spread out the chain.

Two quantities fall out of it. Work divided by depth is the most processors that
can be usefully applied, since beyond that they sit idle. And an algorithm is
called work efficient when its work matches the best sequential algorithm, up to
constants.

The classic mistake is now easy to state. It is optimising depth while quietly
multiplying work, which produces an algorithm that looks excellent on the axis
being reported and burns several times the energy to finish no sooner on any
real machine. The next section is that mistake, with numbers.

There is a pessimistic corollary worth knowing by name. If some fraction of the
work is inherently serial, the speedup is capped at one over that fraction
however many processors you add. The rebuttal is that in practice the problem
grows with the machine, so that fraction shrinks. Both are true, and which one
applies depends on whether you have a fixed problem or a fixed time budget.

## The operation that looks sequential

Given an associative operator and a list, a scan produces the running result:
each output is the operator applied to everything up to that point. An inclusive
scan includes the current element and an exclusive one does not.

Written sequentially it is three lines, and every output depends on the one
before it. It looks like the most stubbornly serial thing in the subject.

It is not, and the reason is the only property required of the operator. Being
associative means the brackets can be moved, and moving the brackets is enough
to compute the whole thing in a logarithmic number of rounds. That single move
is behind every parallel reduction, every parallel sort, and every operation on
segments of a list.

## Why it matters more than it looks

Here is the sentence worth keeping.

Any time parallel workers each produce a variable number of outputs, and the
results have to end up packed together, the answer is a scan.

The scan of the counts tells each worker where its own output starts. That is
one idea, and it is all of the following:

```
   filtering a stream         scan the keep-or-drop flags for output indices
   building a sparse matrix   scan the row lengths for the row offsets
   a pass of a radix sort     scan the digit counts for each bucket's base
   expanding a graph frontier scan the neighbour counts for write positions
   partitioning for a sort    scan the below-the-pivot flags
```

Turning data dependent, variable sized output into writes at computed addresses
is what a scan is for, and it is why it appears everywhere in parallel code
rather than as a curiosity.

## The depth optimal version

The first published parallel scan is four lines. For a distance that doubles
each round, every element adds the element that far behind it:

```
   for d = 1, 2, 4, 8, ... < n:
       for all i in parallel:
           b[i] = (i >= d) ? a[i] + a[i-d] : a[i]
       swap(a, b)
```

After each round every element holds the sum of a window twice as wide as
before, so after a logarithmic number of rounds it holds everything before it.

The depth is logarithmic, which is optimal. The work is not: every round touches
every element, so the total is the count times the number of rounds. And it
needs two buffers, because an element is reading a value that another element is
in the middle of writing.

## The work efficient version

The second version builds a balanced tree in the array and sweeps it twice.

Going up, it combines pairs at doubling distances, so that after the last round
the final element holds the total. Going down, it sets the root to the identity
and pushes partial results back down: at each node the left child receives the
node's value, and the right child receives the node's value combined with what
the left child held.

The work is now linear, which is optimal, and the depth is still logarithmic
though it takes twice as many rounds. It needs no second buffer.

Counting the operations of both, on a real implementation with a counter
attached:

```
   n            work efficient    depth optimal      ratio
   8                     21               24         1.14x
   1,024              3,069           10,240         3.34x
   1,048,576      3,145,725       20,971,520         6.67x
```

Those numbers are not approximate. The first column is exactly three times one
less than the count, and the second is exactly the count times its logarithm.
The theory is not roughly right here, it is precisely right, and watching a
counter confirm it is worth doing once.

## What actually runs, and why the ending matters

Most courses stop at the work efficient version, and stopping there leaves you
believing something that the real libraries abandoned a decade ago.

The problem is that work is the wrong objective at the top level. A scan does
almost no arithmetic per element, so it is limited entirely by memory. The tree
version reads and writes the array twice, once going up and once coming down,
plus a pass over the block totals, which is about four times the array in
traffic. At best that reaches half of the available bandwidth.

What the production libraries do instead is a single pass. Each block computes
its own total, publishes it with a flag saying what kind of value it is, and
then looks backwards at the totals its predecessors published, taking a finished
prefix if one is available and otherwise accumulating further back, all while
its own local scan proceeds. The input is read once and the output written once.
Two times the array instead of four, and about twice the speed.

```figure
{
  "kind": "blocks",
  "alt": "Three levels of a real scan: a scan within a warp using register exchange, a scan of the per warp totals within a block, and a single pass across blocks that looks back at published totals.",
  "caption": "The three levels use three different algorithms, each chosen for what is free at that level. Extra work inside a warp costs nothing because the lanes exist anyway; extra traffic across the device costs everything.",
  "boxes": [
    { "id": "w", "x": 0,   "y": 0, "w": 4.0, "h": 1.1, "label": "warp: depth optimal", "accent": "azure" },
    { "id": "b", "x": 5.0, "y": 0, "w": 4.0, "h": 1.1, "label": "block: totals", "accent": "jade" },
    { "id": "d", "x": 10.0, "y": 0, "w": 4.4, "h": 1.1, "label": "device: look back", "accent": "gold" }
  ],
  "arrows": [
    { "from": "w", "to": "b" },
    { "from": "b", "to": "d" }
  ]
}
```

Notice what that hierarchy says. Inside a warp the depth optimal version is
used, and its extra work is free, because those lanes exist whether or not you
give them anything to do. Across the device the objective is not operations at
all; it is bytes moved.

So the arc is: the first version teaches the idea, the second teaches work
efficiency, and the third teaches that at the top level the thing being
minimised is memory traffic. All three are true at different scales, which is
the more useful lesson than any one of them.

## What to carry forward

A parallel algorithm has two costs. Work is the total operations and depth is
the longest dependent chain, time is bounded by work over processors plus depth,
and work over depth is the most processors worth having.

Optimising depth while multiplying work is the standard mistake, and the two
scans are the standard example: a logarithmic depth version that does the count
times its logarithm in work, against a linear work version that takes twice as
many rounds.

A scan turns variable sized output into writes at computed addresses, which is
why filtering, sorting, sparse formats and graph traversal are all scans
underneath.

And the version that runs in production is neither textbook algorithm, because
the real objective function at that level is bytes moved rather than operations
performed.

Next is where that objective becomes the whole subject: three levels of linear
algebra routines, only one of which can ever reach the machine's peak, and why
that single ratio has shaped every numerical library for forty years.

## Reading the errors you are about to see

These are the two axes as arithmetic: the bound on parallel time, the number of
processors worth using, the exact operation counts of both scans, and the
traffic that decides which one is actually faster.

`assert-failed` names the case your model got wrong. Several exercises assert
that the work efficient version is not the fastest one, which is the memory
traffic deciding rather than a comparison written backwards.
