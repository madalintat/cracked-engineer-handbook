## Why does parallel complexity need two numbers?

- [x] Work is the total operations and depth is the longest dependent chain, and neither implies the other
- [ ] One counts operations and the other counts memory accesses
- [ ] One is the best case and the other the worst case
- [ ] One is per processor and the other is the total

@why Using one where two are needed is the most common mistake in the subject,
because an algorithm can look excellent on either axis alone.

## What is depth?

- [x] The longest chain of operations that must happen in order, which is the time with infinitely many processors
- [ ] The number of levels of recursion
- [ ] The total work divided by the processor count
- [ ] The size of the largest intermediate result

@why No amount of hardware makes it smaller, which is why it is the term that
survives when everything else is divided.

## What bounds the time on a given number of processors?

- [x] The work divided by the processors, plus the depth
- [ ] The larger of the work divided by the processors, and the depth
- [ ] The work divided by the processors
- [ ] The depth times the processor count

@why With enough processors the time approaches the depth rather than
approaching zero, which is what makes it a term in a sum.

## How many processors are worth applying?

- [x] Work divided by depth
- [ ] As many as the machine has
- [ ] The depth
- [ ] The square root of the work

@why It is a property of the algorithm rather than of the machine, and beyond
it you are adding idle cores.

## What does work efficient mean?

- [x] The total work matches the best sequential algorithm, up to constants
- [ ] The depth is logarithmic
- [ ] Every processor is busy at all times
- [ ] No processor does redundant work

@why It is the axis people forget while reporting the other one, which is how
an algorithm ends up burning several times the energy to finish no sooner.

## What is the classic mistake in parallel algorithm design?

- [x] Optimising depth while quietly multiplying work
- [ ] Using too many processors
- [ ] Ignoring the cost of synchronisation
- [ ] Assuming the input fits in cache

@why The two scans are the standard example of it, and the numbers are exact.

## If a fraction of the work is inherently serial, what caps the speedup?

- [x] One divided by that fraction, however many processors there are
- [ ] The processor count
- [ ] The ratio of work to depth
- [ ] Nothing; the parallel part can always be made to dominate

@why The rebuttal is that in practice the problem grows with the machine, so
the fraction shrinks. Which applies depends on whether you have a fixed problem
or a fixed time budget.

## What property must an operator have for a scan to be parallelisable?

- [x] Associativity, so the brackets can be moved
- [ ] Commutativity, so the order does not matter
- [ ] An inverse, so partial results can be undone
- [ ] Idempotence, so repeated application is safe

@why Moving the brackets is enough to compute the whole thing in a logarithmic
number of rounds, and it is the move behind every parallel reduction and sort.

## What is an exclusive scan's first output?

- [x] The identity, since nothing comes before the first element
- [ ] The first input element
- [ ] The sum of all the inputs
- [ ] Undefined; it depends on the implementation

@why The inclusive version includes the current element and the exclusive one
does not, which is the whole difference between them.

## When is the answer to a parallel problem a scan?

- [x] Whenever workers each produce a variable number of outputs that have to end up packed together
- [ ] Whenever the operation is a sum
- [ ] Whenever the output is the same size as the input
- [ ] Whenever the workers need to communicate

@why The scan of the counts tells each worker where its own output starts, and
that one idea is filtering, sparse formats, radix sort and graph traversal.

## What are the costs of the doubling distance scan?

- [x] Logarithmic depth, which is optimal, and the count times its logarithm in work, which is not
- [ ] Linear work and linear depth
- [ ] Logarithmic depth and linear work
- [ ] Linear work and logarithmic depth, with no buffer needed

@why Every round touches every element, and it needs two buffers because an
element reads a value another element is in the middle of writing.

## What are the costs of the two sweep scan?

- [x] Linear work, and logarithmic depth taking twice as many rounds
- [ ] Linear work and linear depth
- [ ] The count times its logarithm in work, with half the depth
- [ ] Logarithmic work and logarithmic depth

@why It builds a balanced tree in the array, combines upward, then pushes
partial results back down, and it needs no second buffer.

## Counted on a real implementation at a million elements, the two scans differed by how much?

- [x] About six and a half times, with the counts landing exactly on the theory
- [ ] About twice
- [ ] About a hundred times
- [ ] They performed the same number of operations

@why One column came to exactly three times one less than the count and the
other to exactly the count times its logarithm. The theory is precisely right
here, not roughly.

## Why is the work efficient scan not what production libraries use?

- [x] A scan is memory bound, and the two sweeps touch the array about four times where a single pass touches it twice
- [ ] It is too complicated to implement correctly
- [ ] Its depth is too large for modern hardware
- [ ] It cannot handle non commutative operators

@why At the top level the objective function is bytes moved rather than
operations performed, which is the lesson that stopping at the textbook
algorithm hides.

## Inside a warp, which scan is used and why?

- [x] The work inefficient one, because the lanes exist whether or not you give them work
- [ ] The work efficient one, because work is always what matters
- [ ] Neither; a warp scan is a single instruction
- [ ] Whichever the compiler chooses

@why The same problem gets different answers at different levels of the
machine, which is more useful than either algorithm on its own.
