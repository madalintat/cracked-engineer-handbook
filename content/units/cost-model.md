---
needs: [cache, complexity]
minutes: 55
one_idea: Asymptotic notation counts operations on a machine where every memory access costs the same, real machines charge a hundred times more for some accesses than others, and the gap between those two statements is measured in hundreds.
sources: [algorithms-on-real-hardware]
---

Complexity notation describes how work grows with input size, and it is the most
useful single idea in algorithms. It gets there by throwing things away on
purpose: the constant factors, the lower order terms, and the machine.

The machine is the interesting one. The model underneath the notation says that
memory is a flat array and any access to it costs one unit. That was close
enough to true when it was written down. It has not been true for about thirty
years, and the size of the error is not a rounding difference.

Everything below was measured, on two machines, and the programs are small
enough that you can reproduce them.

## The same complexity, six hundred times apart

Here is the cleanest demonstration available. Sum the same number of 64 bit
integers three ways. Once from an array. Once by walking a linked list whose
nodes sit in an array in order. Once by walking a linked list of exactly the
same nodes in the same array, linked in a shuffled order.

All three are linear. The second and third differ in one thing only: the order
the pointers link the nodes in. Same allocation, same nodes, same number of
loads.

```
   n            array        list, in order      list, shuffled     ratio
   4,096         1.60 ms        5.24 ms             19.6 ms          12x
   65,536        1.27 ms        9.43 ms            100.5 ms          79x
   1,048,576     1.89 ms        8.19 ms            714.0 ms         377x
   8,388,608     2.83 ms        6.59 ms           1800.3 ms         637x
```

Three separate things are worth reading off that table.

The ratio grows with the input, and it does not stop. Twelve times, then
seventy nine, then three hundred and seventy seven, then six hundred and thirty
seven. There is no crossing point at which the list catches up. This is the
cleanest refutation there is of the idea that constants stop mattering once the
input is large: here the constant is a function of the input, because it tracks
which level of the hierarchy you have fallen out of.

The middle column is the explanation. A list walked in memory order costs only a
few times an array, and that ratio does not grow. Same structure, same pointers,
same complexity, same allocations, and a hundred times away from the shuffled
case. So the cost is not that linked lists are slow.

## Prefetchable, or a chain

What the middle column separates is two properties that the model cannot see.

A sequential walk is predictable. The hardware watches the addresses being asked
for, notices that they advance by a fixed stride, and fetches the next line
before it has been asked for. By the time the program wants it, it is there.

A shuffled walk is unpredictable by construction. Worse, the address of the next
load is the result of the current one, so the machine cannot even start the next
one early. Every miss is exposed in full, one at a time.

That is the difference between being limited by bandwidth and being limited by
latency. In the first case a dozen misses are in flight at once and the cost is
shared between them. In the second they happen strictly one after another, and
you pay the full round trip every time.

## The ladder, measured

Here is what an access actually costs, measured by chasing a random cycle of
pointers, which is the standard way to defeat both the prefetcher and any
overlap between misses.

```
   working set       ns per access      what it says
   128 KiB              1.12            still in the first level
   256 KiB              4.77            the first knee
   512 KiB to 8 MiB     6.1 to 10.4     the second level
   16 MiB             103.34            the second knee
   32 to 128 MiB      100.5 to 107.2    main memory
```

The knees land exactly on the sizes the machine reports for its own caches,
which makes this the best small program in this part of the handbook: twenty
lines, no privileges, no documentation, and you read your own memory hierarchy
out of a table of timings.

Normalised to a first level hit, and with the slower devices added:

```
   L1    L2    L3   DRAM    SSD      network      disk seek    intercontinental
    1     5    20    100  50,000     500,000      5,000,000        150,000,000
```

Memorise the shape rather than the digits. Every large gap in that line is a
design boundary in real systems: the hundredfold cliff into main memory is why
tiling exists, and the five hundredfold cliff into storage is why a tree with
thousands of children per node exists.

And one thing has not moved. Clock speeds stopped improving, and main memory
latency has sat between seventy and a hundred nanoseconds for over fifteen
years while its bandwidth went up twentyfold. Latency is the quantity that
stopped improving, which is why almost every technique in this part is a way of
trading it for bandwidth.

## Where the arithmetic goes

Take the last row of the first table. Main memory is about 103 nanoseconds on
that machine and the array scan runs at about a third of a nanosecond per
element, so the ratio should be around three hundred. Measured, it was six
hundred and thirty seven.

The rest comes from two places. There is a second dependent load, because the
value has to be read after the pointer arrives. And eight million nodes of
sixteen bytes is a hundred and twenty eight megabytes, which is far more pages
than the translation cache can hold, so most accesses pay for a page walk as
well.

That last detail is worth keeping, because it is the reason large pages exist as
a tuning option at all.

## What the notation is still for

None of this makes complexity notation wrong. It answers a question that
measurement cannot: how the cost behaves as the input grows without bound,
which is what decides whether an approach can work at all. No amount of constant
factor tuning rescues a quadratic algorithm on a large input, and the notation
tells you that before you write anything.

What it does not tell you is which of two algorithms with the same growth to
choose, or what a data structure costs on a machine with a memory hierarchy. For
that you need a second model, and the second model has one rule: count the
memory movement, not the operations.

```figure
{
  "kind": "blocks",
  "alt": "Two cost models over the same program: one counting operations on a flat memory where every access costs one, and one counting cache line movements where an access can cost a hundred times another.",
  "caption": "Two models, both useful, answering different questions. The first says whether the approach can scale at all. The second says which of two approaches that scale identically will actually be faster.",
  "boxes": [
    { "id": "p", "x": 0,   "y": 1.2, "w": 3.4, "h": 1.1, "label": "the program", "accent": "slate" },
    { "id": "o", "x": 5.2, "y": 0,   "w": 4.8, "h": 1.1, "label": "count operations", "accent": "azure" },
    { "id": "m", "x": 5.2, "y": 2.4, "w": 4.8, "h": 1.1, "label": "count movement", "accent": "gold" }
  ],
  "arrows": [
    { "from": "p", "to": "o" },
    { "from": "p", "to": "m" }
  ]
}
```

## The rule that follows

A linked list is the right structure when you need to splice a sublist in
constant time, or to hold a reference that stays valid while the container
changes. It is never the right structure because inserting into it is cheap.

Insertion is constant time given the node. Finding the node is linear, and it is
the worst kind of linear there is: a dependent chain of cache misses, each one
paying the full trip to memory, with nothing else in flight.

This is why the demonstration that a contiguous array beats a list at inserting
into a sorted sequence keeps surprising people. The array moves half its
elements on every insert and the list moves none, and the array still wins for
essentially every size, because moving a block of memory runs at tens of
gigabytes a second and the list's traversal does not.

## What to carry forward

Complexity notation counts operations on a machine where every memory access
costs the same. Real machines charge about a hundred times more for a main
memory access than a first level hit, and about five hundred thousand times more
for a network round trip.

Two structures with identical complexity, identical allocation and identical
operation counts measured twelve to six hundred and thirty seven times apart,
and the gap grew with the input rather than shrinking.

The variable was the order the addresses were visited in. Sequential is
prefetchable and a pointer chase is a dependent chain, which is the difference
between paying for many misses at once and paying for each one alone.

Latency is what stopped improving. Every technique after this unit is a way of
trading it for bandwidth.

Next is the most direct consequence: two programs with the same operations and
the same complexity, arranged differently in memory, and what the arrangement is
worth.

## Reading the errors you are about to see

These are the two cost models, written out as arithmetic: operations counted
one way, cache lines counted the other, and the times each one predicts.

`assert-failed` names the case your model got wrong. Several exercises assert
that a sequential walk of many elements costs far fewer misses than there are
elements, which is the cache line doing its job rather than a division in the
wrong place.
