## What machine does asymptotic notation assume?

- [x] One where memory is flat and every access costs the same
- [ ] One with a two level cache and a prefetcher
- [ ] Whichever machine the algorithm will run on
- [ ] One with a single core and no pipeline

@why It was close enough to true when the model was written down, and it has
not been true for about thirty years.

## Two structures with the same complexity, the same allocation and the same operation count measured how far apart?

- [x] Twelve times at small sizes, growing past six hundred at large ones
- [ ] Within a factor of two, as the notation implies
- [ ] About ten times, at every size
- [ ] They measured the same; the difference is folklore

@why The gap is not a fixed constant. It grows with the input, because it
tracks which level of the hierarchy the structure has fallen out of.

## In that measurement, what was the only variable?

- [x] The order the pointers linked the same nodes in
- [ ] Whether the nodes were heap allocated or not
- [ ] The size of each node
- [ ] Whether the compiler could vectorise the loop

@why Both lists used the same pool with identical allocation, which removes
"linked lists allocate badly" as an explanation and leaves the visiting order.

## A linked list walked in memory order costs how much more than an array?

- [x] A few times, and that ratio does not grow with the input
- [ ] A hundred times, like the shuffled case
- [ ] Nothing measurable
- [ ] It grows in the same way the shuffled case does

@why The middle column of the table is the explanation. The cost is not that
linked lists are slow.

## Why is a sequential walk cheap?

- [x] The addresses advance by a fixed stride, so the hardware fetches the next line before it is asked for
- [ ] The compiler unrolls it
- [ ] It touches fewer elements
- [ ] Sequential loads bypass the cache entirely

@why A fixed stride is trivially predictable, which is the whole of what a
prefetcher needs.

## Why can a pointer chase not overlap its misses?

- [x] The address of the next load is the result of the current one, so it cannot be issued early
- [ ] The cache refuses more than one outstanding miss
- [ ] The nodes are too large to fit in a line fill buffer
- [ ] The compiler serialises pointer arithmetic

@why It is a dependent chain by construction, which is the difference between
paying for a dozen misses at once and paying for each one alone.

## What is the difference between bandwidth bound and latency bound here?

- [x] Whether many misses are in flight at once, sharing the cost, or one at a time paying the full round trip
- [ ] Whether the data is read or written
- [ ] Whether the working set exceeds the last level cache
- [ ] Whether the access pattern is aligned

@why A dozen outstanding line fills is the machine's capacity, and a dependent
chain cannot use any of them.

## Roughly what does a main memory access cost, relative to a first level hit?

- [x] About a hundred times
- [ ] About five times
- [ ] About ten times
- [ ] About a thousand times

@why The shape to memorise is one, five, twenty, a hundred, for the first
level, the second, the third and main memory.

## Roughly what does a same datacentre network round trip cost, relative to a first level hit?

- [x] About five hundred thousand times
- [ ] About a thousand times
- [ ] About fifty thousand times
- [ ] About five million times

@why Each big gap in that ladder is a design boundary. The one before it, at
about fifty thousand, is storage, and it is why trees with thousands of children
per node exist.

## How do you read a machine's cache sizes out of a timing curve?

- [x] Chase a random cycle of pointers over growing working sets and look for the knees
- [ ] Read them from the operating system, which is the only reliable way
- [ ] Time a sequential scan and divide by the line size
- [ ] Measure the bandwidth at each size and find where it halves

@why A random cycle defeats both the prefetcher and any overlap between misses,
which exposes the true load to use latency. The knees land exactly on the
reported sizes.

## Which quantity stopped improving?

- [x] Latency; main memory has sat between seventy and a hundred nanoseconds for over fifteen years while bandwidth went up twentyfold
- [ ] Bandwidth, which has been flat since clock speeds stopped rising
- [ ] Both, at the same rate
- [ ] Neither; both continue to improve with process nodes

@why That is why almost every technique in this part is a way of trading
latency for bandwidth.

## Why was the measured ratio higher than the latency arithmetic predicted?

- [x] A second dependent load, and a working set with far more pages than the translation cache holds
- [ ] The measurement included allocation time
- [ ] The compiler failed to optimise the array case
- [ ] Thermal throttling during the longer run

@why A hundred and twenty eight megabytes at sixteen kilobyte pages is eight
thousand pages, so most accesses pay for a page walk too. It is the reason
large pages exist as a tuning option.

## What is asymptotic notation still the right tool for?

- [x] Deciding whether an approach can work at all as the input grows without bound
- [ ] Choosing between two algorithms with the same growth
- [ ] Predicting the running time on a particular machine
- [ ] Comparing two data structures with the same operation counts

@why No amount of constant factor tuning rescues a quadratic algorithm on a
large input, and the notation tells you that before you write anything.

## When is a linked list the right structure?

- [x] When you need to splice a sublist in constant time, or a reference that stays valid while the container changes
- [ ] When insertions are more common than traversals
- [ ] When the element count is not known in advance
- [ ] When elements are large and expensive to move

@why It is never right because inserting is cheap. Insertion is constant time
given the node, and finding the node is the worst kind of linear there is.

## Why does an array beat a list at inserting into a sorted sequence, despite moving half its elements?

- [x] Moving a block of memory runs at tens of gigabytes a second, and the list's traversal is a chain of full latency misses
- [ ] The array insert is amortised constant time
- [ ] Compilers vectorise the shifting loop
- [ ] The comparison assumes the list is unsorted

@why The array does strictly more work by the operation count and still wins
for essentially every size, which is the whole argument of the unit in one
example.
