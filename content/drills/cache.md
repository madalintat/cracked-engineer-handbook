## What is the unit memory moves in?

- [x] A cache line, 64 bytes on every x86-64 machine you will meet
- [ ] A machine word, 8 bytes
- [ ] A page, 4096 bytes
- [ ] Whatever the load instruction asked for

@why Read a single byte from a cold address and the hardware fetches all 64
containing it, evicting something else to make room. Whether the other 63 are
useful is the whole game.

## How many cycles does a main memory fetch cost, roughly?

- [x] A couple of hundred
- [ ] About ten
- [ ] About twenty thousand
- [ ] It depends entirely on the DRAM manufacturer

@why Around eighty nanoseconds, which at a few gigahertz is a couple of hundred
cycles of doing nothing. An L1 hit is about four.

## What is temporal locality?

- [x] Using the same address again soon
- [ ] Using addresses in increasing order
- [ ] Accessing memory at regular time intervals
- [ ] Keeping a variable in a register across a loop

@why Spatial locality is the other one: using an address near one you just used.
Caches handle the first by keeping what was recently used and the second by
fetching whole lines.

## Why is a linked list slow in a way an array is not?

- [x] Each node's address is known only after the previous one arrives, so the prefetcher cannot run ahead
- [ ] Pointer dereferencing costs an extra instruction
- [ ] Nodes are always allocated far apart
- [ ] The nodes are larger than the values

@why It is a fact about the prefetcher rather than about pointer arithmetic, and
it is why the margins look implausible from the instruction counts alone.

## What does the prefetcher need before it can help?

- [x] A constant stride it can detect from the addresses touched
- [ ] A hint instruction from the compiler
- [ ] Sequential ascending addresses specifically
- [ ] A loop the branch predictor has learned

@why A loop walking an array in order rarely waits for memory at all, because the
line arrived before it was asked for.

## Why is a stride of 4096 bytes pathological?

- [x] Every access lands in the same set, so only the ways in that one set are usable
- [ ] It crosses a page boundary every time
- [ ] It defeats the branch predictor
- [ ] It exceeds the maximum prefetch distance

@why A cache is not fully associative. Middle bits of the address choose a set,
and a loop touching a few hundred kilobytes can behave as though the cache were
512 bytes.

## Why do numerical libraries pad row lengths?

- [x] To move the column stride off the period where every access collides
- [ ] To keep rows aligned to page boundaries
- [ ] To leave room for SIMD tails
- [ ] To avoid false sharing between threads

@why An array declared 1024 wide and allocated 1032 wide is not a mistake. The
extra elements turn a loop that used one set back into one that uses the whole
cache.

## Which miss is fixed by adding padding rather than by changing the algorithm?

- [x] A conflict miss
- [ ] A capacity miss
- [ ] A compulsory miss
- [ ] All three

@why Telling capacity from conflict is the difference between rewriting your
algorithm and adding eight bytes to a struct.

## What is a compulsory miss?

- [x] The first touch of a line, which nothing avoids though prefetching can hide it
- [ ] A miss caused by the cache being too small
- [ ] A miss caused by two addresses mapping to the same set
- [ ] A miss on a line another core invalidated

@why Each of the three kinds has a different fix, which is why the classification
earns its place.

## A loop reads one 8-byte field of every element in an array of 64-byte structs. What fraction of each fetched line is used?

- [x] One eighth
- [ ] All of it, since the line is fetched once
- [ ] One sixty-fourth
- [ ] It depends on the prefetcher

@why Splitting the fields into separate arrays lets the loop read only what it
needs and use every byte of every line, which is routinely a factor of several.

## When does a structure of arrays make things worse?

- [x] When the code touches every field of one element
- [ ] When the arrays exceed the cache size
- [ ] When the fields have different sizes
- [ ] It never does

@why There is no correct layout, only a question about which access pattern is
the hot one, and the transformation trades one for the other by the same factor.

## Why does loop order matter for a row-major array?

- [x] Walking by rows uses every byte of each line; walking by columns uses eight of each 64
- [ ] Column order defeats the branch predictor
- [ ] Row order allows vectorisation and column order does not
- [ ] Column order crosses more page boundaries

@why The loops compute identical results and differ in how many lines they ask
for, which is a number you can count without running anything.

## What is false sharing?

- [x] Two threads writing different variables on one line, invalidating each other's copy
- [ ] Two threads reading the same variable without a lock
- [ ] A cache line shared between two levels of the hierarchy
- [ ] A stale copy left after a thread migrates cores

@why Coherence is maintained per line rather than per byte, so two threads
sharing no data behave as though they did. The fix is padding.

## What does blocking a computation change?

- [x] How many times each byte is fetched, from once per use to once per block
- [ ] The total amount of arithmetic
- [ ] The asymptotic complexity
- [ ] The number of instructions executed

@why Doubling the block size halves the traffic, until the block stops fitting in
cache and the benefit disappears at once, which is why a tuned tile size is a
measured constant.

## A profile shows low cache miss rates and poor performance. What should you do?

- [x] Look somewhere other than memory
- [ ] Increase the block size
- [ ] Add prefetch hints
- [ ] Pad the data structures

@why High misses at L1 and low at L3 means thrashing a small cache; high
everywhere means the working set is genuinely large; low everywhere means the
problem is elsewhere and another afternoon on memory is wasted.
