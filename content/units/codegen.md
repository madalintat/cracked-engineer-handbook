---
needs: [ssa, registers]
minutes: 55
one_idea: An optimisation level does not change what your program means; it changes how much of what you already told the compiler it is allowed to believe, which is why two of the biggest jumps are permissions rather than passes.
sources: [compilers-interpreters-terminals-unix, x86-64-assembly]
---

The middle end finishes with IR that is still about values rather than about a
machine. Turning that into instructions is three problems, and none of them is
the one people expect.

Choosing instructions is a pattern matching problem. Choosing registers is a
graph colouring problem. Choosing an order is a scheduling problem. All three
are decided after every optimisation you have heard of has already run.

The listings below are from gcc and clang on Compiler Explorer, which is the
service that marks this unit's exercises.

## Selection is pattern matching, not translation

An IR multiply is not a `mul` instruction, and on x86-64 it usually is not any
multiply at all. Ask a compiler for `x * 5` and you get one instruction:

```
lea  eax, [rdi + rdi*4]
```

The address calculation unit can compute `a + b * s` for a scale of 1, 2, 4 or
8, and it can do it without touching the flags. So a multiply by five becomes an
address that nobody dereferences.

That is not a special case someone wrote down for the number five. The back end
holds a set of patterns over IR shapes, each with a cost, and covers the IR with
the cheapest set of patterns that fits. The classic formulation is tree pattern
matching with dynamic programming over a grammar of instructions. LLVM does it
per block with a directed acyclic graph and a matcher generated from declarative
pattern files, and gcc does the same job with its own machine description.

The consequence worth carrying is that the instruction you see is a consequence
of a cost model, not a translation of what you wrote. Change the constant to 7
and the answer changes shape, because there is no scale of 6 and the cheapest
cover becomes a shift and a subtract.

## Registers are a colouring problem

The IR has as many values as it likes. The machine has sixteen general purpose
registers, some of which are already spoken for. Deciding which value lives in
which register is register allocation, and the classic formulation is exact.

Build an interference graph: one node per live range, and an edge between two
nodes whose live ranges overlap, which is to say they are both live at some
point and therefore cannot share a register. Assigning `k` registers to that
graph is `k` colouring it. That is NP complete in general, so what real
allocators run is a heuristic in four steps.

```figure
{
  "kind": "blocks",
  "alt": "Four stages in a row: simplify removing nodes of low degree onto a stack, coalesce merging copy-related nodes, spill choosing a victim when nothing is removable, and select popping the stack to assign colours.",
  "caption": "Simplify and select are the colouring. Coalesce is why most register to register moves disappear before you ever see the assembly, and spill is the admission that the graph did not fit.",
  "boxes": [
    { "id": "s", "x": 0,    "y": 0, "w": 3.0, "h": 1.1, "label": "simplify", "accent": "azure" },
    { "id": "c", "x": 3.8,  "y": 0, "w": 3.0, "h": 1.1, "label": "coalesce", "accent": "jade" },
    { "id": "p", "x": 7.6,  "y": 0, "w": 3.0, "h": 1.1, "label": "spill", "accent": "clay" },
    { "id": "e", "x": 11.4, "y": 0, "w": 3.0, "h": 1.1, "label": "select", "accent": "gold" }
  ],
  "arrows": [
    { "from": "s", "to": "c" },
    { "from": "c", "to": "p" },
    { "from": "p", "to": "e" }
  ]
}
```

Simplify repeatedly removes any node with fewer than `k` neighbours and pushes
it on a stack. Such a node can always be coloured later, whatever its neighbours
get, because it has fewer neighbours than there are colours.

Coalesce merges two nodes joined by a copy, when merging cannot make the graph
harder to colour. This is where register to register moves go. A `mov` you never
see in the output was usually removed here rather than by a peephole pass.

Spill happens when no node can be simplified. Something has to live in memory,
and which one is a cost decision: uses inside a loop are weighted far more
heavily than uses outside it, because the cost is paid every iteration.

Select pops the stack and gives each node a colour none of its coloured
neighbours has.

What the textbook version leaves out is that many registers are not free to
choose. The calling convention forces arguments into particular registers, a
division instruction clobbers a specific pair, the return value has to end up in
one particular register, and vector values cannot go in general purpose ones at
all. A real allocator is colouring a graph where some nodes already have their
colour.

One thing is worth saying plainly, because it confuses people who know the
microarchitecture. The sixteen registers the allocator fights over are
architectural names, and the processor renames them onto a much larger physical
file, so it is not true that only sixteen values can be in flight. Allocation
still matters enormously, but for the memory traffic that spilling adds and for
the number of instructions, not because the machine ran out of places to put
things.

## Scheduling, and where it stopped mattering

Instruction scheduling reorders instructions to keep the pipeline fed, guided by
a model of how long each instruction takes and which ports it can issue on. It
runs twice: once before allocation, to expose independent work, and once after,
to clean up the code that spilling introduced.

On an in-order machine this is most of the performance. On an out-of-order
machine it matters much less, because the hardware reorders anyway across a
window of a few hundred instructions. What the pre-allocation schedule still
decides is how many values are live at once, which decides what the allocator
sees, which decides how much spilling happens. It shapes the problem rather than
solving it.

## What an optimisation level actually changes

Here is the part that is worth more than the rest of the unit.

At `-O0` almost nothing runs. Every variable lives in memory and is reloaded at
every use, which is exactly what a debugger needs and is why the output is
mostly stack traffic. At `-O1` the cheap local passes run, and this is the level
worth reading first: enough has happened to be interesting, and not so much that
you cannot follow it. `-O2` is what every distribution ships and adds the
expensive interprocedural work, including inlining and, in modern gcc,
vectorisation. `-O3` adds transformations that trade code size for speed. `-Os`
is `-O2` without the parts that grow the binary. `-Og` is `-O1` minus the passes
that most confuse a debugger.

None of that changes what your program means. Two of the jumps do, and they are
not passes at all. They are permissions.

The first is strict aliasing, on from `-O2`. It says that two pointers of
incompatible types do not refer to the same object, so the compiler may keep a
value in a register across a store through an unrelated pointer type. Write
through an `int` pointer, then read through a `float` pointer aliasing the same
memory, and ask what comes back.

```
   -O0                          0
   -O2                          1
   -O2 -fno-strict-aliasing     0
```

The middle line is not a bug. It is the compiler reusing the value it had just
stored, because you promised those two pointers could not be the same object.
The third line is the same program with the promise withdrawn, and it costs a
reload.

The second is signed overflow, which the previous unit met from the other side.
Undefined overflow is what lets a loop counter be widened and lets a comparison
be simplified, and the same loop written with unsigned arithmetic compiles
differently because wrapping is defined and the compiler has to preserve it.

`-Ofast` is the honest name for the end of this road: `-O3` plus flags that
violate the standard, including fast maths, which permits reassociating floating
point that is not associative. It can be a large win, and it is not something to
ship without knowing exactly which promise you gave away.

## The last pass, and one that runs at link time

Peephole optimisation is the final sweep over the instruction stream, rewriting
short local patterns. A move from a register to itself disappears. An add of one
may become an increment, or may not, depending on how the target models the
flags. It is a small pass and it is the last chance to remove something the
earlier passes could not see.

Then the assembler emits object code with relocations where addresses are not
known yet, and the linker resolves them. Two things there are worth knowing now.
Link time optimisation is the middle end running again with every translation
unit visible at once, which is what makes inlining across file boundaries
possible, and that is usually where its win comes from. And the linker is where
the story of this part continues: which definition wins, and what that costs at
every call, is the next unit.

## What to carry forward

Instruction selection covers the IR with the cheapest set of patterns it has, so
the instruction you read is the output of a cost model rather than a translation
of your source.

Register allocation is graph colouring with some nodes pre-coloured by the
calling convention. Simplify, coalesce, spill and select, and the moves you never
see were removed by coalescing.

Scheduling shapes how many values are live at once, which matters more on an
out-of-order machine than the ordering itself does.

An optimisation level is mostly which passes run, but the two changes that alter
what your program can do are permissions: strict aliasing at `-O2`, and undefined
signed overflow. `-Ofast` adds more of them, in exchange for the standard.

## Reading the errors you are about to see

These exercises model the allocator's decisions and the cost questions behind
them, on small graphs given as adjacency and degree arrays, rather than calling
into a real back end.

`assert-failed` names the case your model got wrong. Several exercises assert
that a node with exactly `k` neighbours cannot be simplified, which is the
condition being strict rather than an off by one in the check.
