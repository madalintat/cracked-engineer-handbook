## What does the level number of a linear algebra routine tell you?

- [x] The depth of its loop nest, which is also the exponent of its work
- [ ] The order in which the levels were standardised, and nothing else
- [ ] How many operands the routine takes
- [ ] The precision the routine is specified in

@why It is one more than the exponent of the data, and that gap is the entire
argument of the unit.

## What is arithmetic intensity?

- [x] Operations performed divided by bytes that must move
- [ ] Operations performed per second
- [ ] The fraction of peak a routine achieves
- [ ] The ratio of multiplies to additions

@why Count the traffic as favourably as possible, since a real implementation
can only do worse, which makes the result a ceiling.

## What is the intensity of a vector update, and how does it change with size?

- [x] About a twelfth of an operation per byte, and it does not change at all
- [ ] About a quarter, growing slowly with size
- [ ] It depends on the machine's cache size
- [ ] It grows linearly with the vector length

@why Two operations per element over twenty four bytes per element. The length
cancels.

## Why can a matrix vector product not be improved by tiling?

- [x] Every element of the matrix is used exactly once, so there is nothing in a tile to reuse
- [ ] The matrix does not fit in cache
- [ ] The vector access pattern is irregular
- [ ] Tiling only helps operations with three loops

@why It is a streaming operation wearing a matrix costume, and no arrangement
changes that.

## Going from the first level to the second multiplied the work by the size. What did it do to the intensity?

- [x] Multiplied it by three, because the extra data arrived alongside the extra work
- [ ] Multiplied it by the size as well
- [ ] Left it unchanged
- [ ] Reduced it, because matrices are larger than vectors

@why A quarter against a twelfth. The extra work bought essentially nothing.

## Why does a matrix multiply's intensity grow with the problem size?

- [x] Each element of one matrix takes part in one multiply per column of the other, so reuse grows with the size
- [ ] Larger matrices fit better in cache
- [ ] The output is smaller than the inputs
- [ ] Multiplication is cheaper than addition at scale

@why The reuse is a property of the operation rather than of the
implementation, which is why no other level can be rescued into it.

## What is a machine's ridge point?

- [x] The intensity at which it stops being limited by memory and starts being limited by arithmetic
- [ ] The peak rate it can sustain
- [ ] The largest problem that fits in cache
- [ ] The bandwidth of its slowest memory level

@why Peak divided by bandwidth. The comparison between it and an operation's
intensity is the whole prediction.

## Roughly where do real ridge points sit?

- [x] Around ten operations per byte for double precision, and a few hundred for reduced precision on a large accelerator
- [ ] Around one operation per byte on every machine
- [ ] Around a thousand on every machine
- [ ] They vary too much to generalise

@why That range is what puts the first two levels one to three orders of
magnitude below every threshold there is.

## Can a better implementation make a matrix vector product reach peak?

- [x] No, on any machine, because the ratio is a property of the operation
- [ ] Yes, with enough tiling and vectorisation
- [ ] Yes, on a machine with sufficient bandwidth
- [ ] Only in reduced precision

@why It is not slightly memory bound. It is memory bound by orders of
magnitude, on every machine built in the last thirty years.

## What did the field do about the first two levels being permanently slow?

- [x] Rewrote algorithms so that almost none of the work is in them
- [ ] Optimised them harder, with hand written assembly
- [ ] Built machines with far more bandwidth
- [ ] Moved to lower precision so more values fit per byte

@why Not making the slow level faster, which is impossible, but arranging for
the arithmetic to be somewhere else.

## In a blocked factorisation, what is the panel and what is the update?

- [x] The panel is a narrow unblocked step at the second level, and the update to everything else is a matrix multiply
- [ ] The panel is the matrix multiply and the update is a vector operation
- [ ] Both are matrix multiplies of different sizes
- [ ] The panel is a permutation and the update is a scaling

@why The panel costs the square times the block width and the update costs the
cube, so the update dominates as the problem grows.

## Why does that rewrite work asymptotically?

- [x] The cubic term dominates the quadratic one, so the share of work in the fast level approaches everything
- [ ] The panel can be eliminated entirely
- [ ] Blocking removes the memory traffic of the panel
- [ ] The two terms are equal, so half the work is fast

@why The part that cannot reach peak becomes negligible rather than being made
fast, which is a different and more achievable goal.

## Why do accelerators contain units that do nothing but multiply small matrices?

- [x] It is the only operation shape whose work per byte is unbounded, so it is the only one worth building dedicated arithmetic for
- [ ] Small matrices are the most common size in practice
- [ ] Vector operations are already handled by the memory system
- [ ] It simplifies the instruction encoding

@why The same reasoning explains why a machine learning framework spends its
life turning other operations into matrix multiplies.

## A matrix multiply at a thousand a side has what intensity in double precision?

- [x] About eighty three operations per byte
- [ ] About a quarter
- [ ] About a thousand
- [ ] About eight

@why The size over twelve. At ten thousand it is over eight hundred, which is
past every ridge point in the table.

## What is the single sentence to remember from this unit?

- [x] Only the matrix by matrix level can ever reach peak, so every numerical algorithm was rewritten to be expressed in terms of it
- [ ] Always use the highest level routine available
- [ ] Memory bandwidth is the limiting factor in all numerical computing
- [ ] Larger problems are always more efficient

@why The second is a decent rule of thumb that follows from it, and the first
is the reason the rule of thumb is true.
