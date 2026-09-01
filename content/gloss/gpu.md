## warp
Thirty-two threads that execute together with one instruction pointer. It
appears nowhere in the CUDA programming model and decides almost everything
about what a kernel costs. The width comes from graphics: eight 2x2 pixel quads
to a warp.
@see divergence, occupancy

## divergence
Threads within one warp disagreeing about which way a branch goes. The warp
runs one side with the disagreeing lanes masked off and then the other, so both
paths cost their full time. It is spatial rather than statistical: a branch half
the threads take is free if the split lands on a warp boundary.
@see warp, block

## block
The unit within which threads may cooperate, sharing memory and waiting for
each other at a barrier. Between blocks there is no ordering and no
communication, which looks like a restriction and is the mechanism that lets
one kernel run on any number of processors.
@see warp, occupancy

## occupancy
How many warps are resident on a processor at once. More is not faster in
itself; it is what lets a stall disappear behind another warp's work. Registers
per thread cap it, which is why using too many quietly removes the machine's
main way of hiding memory latency.
@see warp, block

## tensor-core
A matrix multiply-accumulate unit, separate from the ordinary arithmetic
pipeline. Which numeric formats it accepts is the difference between one
generation and the next, and it is the reason a kernel written for one
architecture may not carry over to another.
@see warp
