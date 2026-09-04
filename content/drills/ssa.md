## What does static single assignment mean?

- [x] Every value is assigned exactly once, and a name refers to one definition
- [ ] Every variable is assigned once at run time, however many times it appears
- [ ] Assignments are moved to the top of the function
- [ ] Each variable lives in exactly one register

@why It is a property of the text, not of what happens when the program runs.
A loop body can execute a definition many times; there is still one instruction
that defines that name.

## In SSA, what does it cost to find the definition that reaches a use?

- [x] Nothing beyond reading the name, which is the definition
- [ ] A backwards walk through the control flow graph
- [ ] A fixpoint iteration over the whole function
- [ ] A query to the dominator tree

@why This is the trade the whole form exists to make. Renaming is cheap, and it
removes an analysis that otherwise has to be redone after every transformation.

## What is a phi node for?

- [x] Selecting a value according to which predecessor control arrived from
- [ ] Copying a value between registers at a join
- [ ] Marking a variable as live across a branch
- [ ] Comparing two values and branching on the result

@why It exists so that the block after a join can still name exactly one
definition, even though two different values could have arrived.

## Which instruction set has a phi instruction?

- [x] None; it exists only while the program is in SSA form
- [ ] All of them, as a conditional move
- [ ] x86-64 only, as part of the conditional move family
- [ ] Whichever ones support predicated execution

@why It is bookkeeping. Before register allocation it is removed, and it
becomes a copy on each incoming edge.

## A join block has two predecessors, and both arms leave a variable untouched. What does SSA construction insert?

- [x] Nothing, because only one definition arrives
- [ ] A phi with two identical arguments
- [ ] A phi with one argument
- [ ] A copy on each incoming edge

@why The question is how many distinct definitions arrive, not how many edges
there are. A phi with nothing to choose between costs an instruction and buys
no information.

## What decides where phi nodes belong?

- [x] The dominance frontier of each definition
- [ ] The order the blocks appear in the source
- [ ] Every block with more than one predecessor, without exception
- [ ] The register allocator, once it knows the pressure

@why Roughly, the dominance frontier is the set of blocks control can reach
without having passed through the definition, which is exactly where a value
might or might not have been defined.

## Why does SSA make analyses sparse?

- [x] Facts propagate along definition-to-use edges, touching only instructions that could care
- [ ] Fewer instructions survive, so there is less to analyse
- [ ] The dominator tree caches the results of every previous analysis
- [ ] Each block can be analysed independently of the others

@why Classical dataflow carries facts through every program point whether or
not anything there is affected. SSA gives you the edges to follow instead.

## Why does sparse conditional constant propagation beat running constant propagation and unreachable code elimination separately?

- [x] Each one feeds the other, and doing them together reaches conclusions neither reaches alone
- [ ] It runs in one pass, so it is faster for the same result
- [ ] It can fold floating point that the separate passes must leave alone
- [ ] Separate passes cannot be run on SSA form

@why A folded condition removes an edge, which can make a block unreachable,
which removes a value from a phi, which can fold the next condition. Stopping
between the two loses everything after the first step.

## What does renaming remove that helps reordering?

- [x] False dependencies from reusing one variable for unrelated purposes
- [ ] Real data dependencies between a definition and its use
- [ ] Memory aliasing between two pointers
- [ ] The need for a dominator tree

@why It is the same idea hardware applies with register renaming, so by the
time the code runs the trick has been used twice, once on names and once on
registers.

## In SSA, how is a definition known to be dead?

- [x] Nothing uses it, and no further analysis is needed
- [ ] It is not reachable from the entry block
- [ ] It writes a register that is later overwritten
- [ ] It appears after a return

@why A name cannot be redefined somewhere you did not look, so an empty use
list is the whole argument.

## When are two computations the same value, in SSA?

- [x] Same operator, and operand names that are equal
- [ ] Same operator, and operands that hold equal values at run time
- [ ] Same operator, in the same block
- [ ] Same operator, with neither operand reassigned in between

@why The last one is what non-SSA form has to prove. Here the names carry the
proof, which is what makes global value numbering nearly free.

## Why is inlining the highest leverage optimisation in real code?

- [x] It enables the others, by letting constants and branches cross the old call boundary
- [ ] Calls are the most expensive instructions on modern processors
- [ ] It removes the stack frame, which is most of the cost
- [ ] It is the only pass that can run more than once

@why Most of what people attribute to other optimisations is inlining making
them possible.

## A summation loop with an `int` counter compiles to a 64 bit induction variable. Why is that legal?

- [x] Signed overflow is undefined, so the compiler may assume the counter never wraps
- [ ] A 64 bit register is faster to increment than a 32 bit one
- [ ] The array index is 64 bits, so the counter must match
- [ ] The C standard requires loop counters to be widened

@why The `nsw` flag in the IR is the compiler writing that assumption down so
later passes can use it without rediscovering it. Change the counter to
`unsigned` and the widening becomes illegal, because wrapping is defined.

## What happens to a phi node before register allocation?

- [x] It becomes a copy at the end of each predecessor block
- [ ] It becomes a conditional move at the join
- [ ] It is deleted, because the values are already in the right registers
- [ ] It is left in place and the allocator handles it directly

@why There is no phi to allocate a register for. Putting the copies on the
edges rather than at the join is what makes the placement subtle.

## What are the lost copy and swap problems?

- [x] The two ways naive phi elimination places copies wrongly and changes the program
- [ ] Two failure modes of register allocation under high pressure
- [ ] Bugs in dominance frontier computation on irreducible graphs
- [ ] Cases where value numbering merges values that are not equal

@why They are why real phi elimination is longer than the two lines it sounds
like: a copy inserted on an edge reached from elsewhere, and two phis at one
join that exchange values.
