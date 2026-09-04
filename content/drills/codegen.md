## Why does `x * 5` often compile to an address calculation?

- [x] The address unit computes a base plus a scaled index, and scaling by four then adding the base is a multiply by five
- [ ] The multiply instruction is not available in 32 bit mode
- [ ] The compiler is avoiding a multiply because it sets the flags
- [ ] Address calculations are the only instructions that can take three operands

@why It is one instruction, and it does not touch the flags. It falls out of a
cost model over patterns rather than being a rule written down for the number
five.

## What kind of problem is instruction selection?

- [x] Covering the IR with the cheapest available set of patterns
- [ ] Translating each IR operation into its corresponding instruction
- [ ] Choosing between the instruction sets the target supports
- [ ] Deciding the order instructions are emitted in

@why If it were a translation there would be nothing to decide. The classic
formulation is pattern matching over a grammar of instructions with costs.

## What is an edge in an interference graph?

- [x] Two live ranges overlap, so they cannot share a register
- [ ] One value is computed from the other
- [ ] Two values are copied between each other
- [ ] Two values are used by the same instruction

@why Overlapping means both are live at some point. A copy between two values is
the opposite: it is the reason to try to give them the same register.

## Assigning `k` registers to an interference graph is which problem?

- [x] `k` colouring the graph, which is NP complete in general
- [ ] Topologically sorting the graph
- [ ] Finding a maximum matching
- [ ] Computing the graph's dominance frontier

@why That is why real allocators run a heuristic rather than an exact
algorithm.

## With `k` colours, which node can the simplify step always remove?

- [x] One with strictly fewer than `k` neighbours
- [ ] One with `k` or fewer neighbours
- [ ] One with no neighbours at all
- [ ] The one with the highest degree

@why A node with exactly `k` neighbours can have every colour taken. Strictly
fewer means a colour is guaranteed to be free whatever the neighbours get.

## What does coalescing do?

- [x] Merges two nodes joined by a copy, when the merge cannot make the graph harder to colour
- [ ] Combines two instructions into one during selection
- [ ] Merges adjacent basic blocks with a single edge between them
- [ ] Reuses one stack slot for two spilled values

@why It is where register to register moves go. A move you never see in the
output was usually removed here rather than by a peephole pass.

## Why is the coalescing test conservative?

- [x] A merge that makes the graph uncolourable costs a spill, which is worse than the move it saved
- [ ] The exact test is undecidable
- [ ] The allocator has not built the full graph yet
- [ ] Merging changes the meaning of the program unless it is provably safe

@why Removing one instruction is a small win, and adding memory traffic to a
loop is a large loss, so the test errs towards refusing.

## When an allocator has to spill, how does it choose the victim?

- [x] By cost, weighting uses by loop depth and dividing by degree
- [ ] By the value with the longest live range
- [ ] By the value defined earliest
- [ ] By the value with the fewest uses, without further weighting

@why A use inside a loop is paid every iteration. Ignoring depth spills the one
value the hot loop needs, which is the decision that makes the function slower.

## Which registers does the allocator not get to choose?

- [x] Those fixed by the calling convention, by instructions that clobber specific registers, and by register class
- [ ] None; the allocator chooses all of them
- [ ] Only the stack pointer
- [ ] Only the callee-saved registers

@why It is colouring a graph in which some nodes already have their colour,
which is most of what the textbook version leaves out.

## An x86-64 core renames its sixteen architectural registers onto a much larger physical file. So why does register allocation still matter?

- [x] Because spilling adds real memory traffic and instructions, not because the machine runs out of places
- [ ] It does not; on an out-of-order core the allocator is decorative
- [ ] Because renaming only applies to floating point registers
- [ ] Because the rename table is smaller than the register file

@why The machine can keep far more than sixteen values in flight. What it
cannot do is make a spill and reload disappear.

## Where does instruction scheduling still matter on an out-of-order machine?

- [x] It decides how many values are live at once, which decides what the allocator sees
- [ ] It is the main source of performance, as on an in-order machine
- [ ] It only matters after register allocation, to fix up spill code
- [ ] It has no effect, because the hardware reorders anyway

@why It shapes the problem rather than solving it. The hardware reorders across
a window of a few hundred instructions; it cannot undo a spill.

## Why is `-O1` the level to start reading assembly at?

- [x] Enough has happened to be interesting, and not so much that it cannot be followed
- [ ] It is the level distributions ship
- [ ] It is the only level where the output matches the source line by line
- [ ] It is the last level before undefined behaviour is exploited

@why `-O0` output is mostly stack traffic, because every variable lives in
memory. `-O2` output is dominated by transformations that need explaining first.

## What does strict aliasing, on from `-O2`, permit?

- [x] Assuming two pointers of incompatible types do not refer to the same object
- [ ] Assuming no two pointers alias, whatever their types
- [ ] Reordering floating point operations
- [ ] Assuming a pointer is never null

@why It is what lets a value stay in a register across a store through an
unrelated pointer type, which is why the same program prints a different number
at `-O0` and `-O2`.

## A program prints 0 at `-O0`, 1 at `-O2`, and 0 at `-O2 -fno-strict-aliasing`. What happened?

- [x] At `-O2` the compiler reused a value it had just stored, because the promise said the pointers could not alias
- [ ] The optimiser has a bug that the flag works around
- [ ] The stored value was in a register at one level and in memory at another, by chance
- [ ] Undefined behaviour made the output arbitrary, and it could print anything

@why The middle line is a promise being kept. The third line is the same
program with the promise withdrawn, and it costs a reload.

## What does `-Ofast` add on top of `-O3`?

- [x] Flags that violate the standard, including reassociating floating point
- [ ] Only more aggressive inlining and unrolling
- [ ] Link time optimisation
- [ ] Target-specific instruction selection for the host machine

@why Floating point addition is not associative, so reassociating it changes
results. It can be a large win and it is not something to ship without knowing
which promise was given away.
