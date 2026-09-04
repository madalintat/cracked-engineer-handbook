## How does a rasteriser decide whether a pixel is inside a triangle?

- [x] It evaluates three linear edge functions and checks that all three have the same sign
- [ ] It walks each scanline between the left and right edges
- [ ] It tests the distance from the pixel to each vertex
- [ ] It fills from a seed pixel until it reaches a boundary

@why Each edge function is the signed area of the triangle formed by that edge
and the point, so its sign says which side the point is on.

## What does it cost to move an edge function one pixel to the right?

- [x] One addition, because the function is linear and the step is a constant
- [ ] Two multiplications and a subtraction, recomputed from scratch
- [ ] A division, to renormalise the result
- [ ] Nothing; the value only changes between rows

@why Being incremental is half of why this algorithm won. Three edges is three
adds per pixel, and that is the whole inner loop.

## Why can a rasteriser be a wide parallel block rather than a state machine?

- [x] The edge functions have no dependency from one pixel to the next, so any number can be evaluated at once
- [ ] Because the hardware evaluates whole triangles at a time
- [ ] Because coverage is computed before the triangle is transformed
- [ ] Because the depth test removes the ordering requirement

@why A scanline algorithm has a sequential dependency along each span and
cannot be spread across sixty four adders. This is the first place in the part
where independence buys a different machine.

## What do the three edge functions give you besides coverage?

- [x] Normalised by the total area, they are the barycentric coordinates, which are the interpolation weights
- [ ] The depth value at the pixel
- [ ] The triangle's screen area, needed for culling
- [ ] The mipmap level for each texture

@why The same hardware that decides coverage produces the weights for
interpolating every attribute across the triangle, for free.

## What problem does the top left rule solve?

- [x] A pixel exactly on a shared edge belongs to exactly one of the two triangles
- [ ] Triangles are drawn in a consistent order
- [ ] Very small triangles are not dropped entirely
- [ ] The rasteriser starts at a predictable corner of the screen

@why Shade it twice and a blended scene shows a seam; shade it in neither and
there is a hole. The rule assigns it to one of the two.

## Why does the top left rule need fixed point coordinates?

- [x] Exactly on the edge has to be a decision a comparison can make, which floating point cannot give you
- [ ] Fixed point arithmetic is faster in the rasteriser
- [ ] Floating point cannot represent screen coordinates
- [ ] The bias of minus one has no meaning in floating point

@why Watertight rasterisation is impossible in floating point, and that is a
correctness argument for snapping vertices to a grid rather than a performance
one.

## What does the coarse stage of a hierarchical rasteriser do?

- [x] Tests whole tiles against the edge equations, rejecting or accepting them wholesale
- [ ] Rasterises at a lower resolution and upsamples
- [ ] Sorts triangles by depth before any coverage is computed
- [ ] Computes an approximate coverage mask that the fine stage corrects

@why Only tiles straddling an edge reach the per pixel stage, which is most of
what makes the cost proportional to the triangle rather than to the screen.

## Why is a long thin sliver triangle the pathological case?

- [x] It touches many tiles while covering few pixels, so the coarse stage rejects almost nothing and the fine stage finds almost nothing to do
- [ ] Its edge functions overflow the fixed point range
- [ ] It fails the top left rule on both of its long edges
- [ ] It cannot be assigned barycentric coordinates

@why Both stages do work proportional to the tiles touched, and a sliver
maximises tiles per covered pixel.

## Why does the rasteriser emit two by two blocks rather than single pixels?

- [x] So a shader can compute a derivative by differencing against a neighbour, which is what mipmap selection needs
- [ ] Because memory is written in four pixel bursts
- [ ] Because the depth buffer is organised in blocks of four
- [ ] Because four pixels is the width of the blending hardware

@why A shader has no analytic knowledge of its own derivative, and
differentiating arbitrary shader code would be enormously expensive. A finite
difference against the pixel next door is two subtractions.

## Within a two by two block, how does a lane reach its neighbours?

- [x] Exclusive or with one for the horizontal neighbour and with two for the vertical one
- [ ] Add one and add two respectively
- [ ] Through shared memory, using the block's base address
- [ ] By reading the same lane of the previous block

@why Flipping a bit stays inside the block from every lane, where adding falls
out of it at the end of a row.

## What is a helper lane?

- [x] An uncovered pixel in a shaded block that runs the whole shader and has its result thrown away
- [ ] A spare lane used when a warp is not full
- [ ] A lane that computes derivatives on behalf of the others
- [ ] A lane reserved for the depth test

@why It has to run, because the covered pixel in its block needs its
interpolated values to compute a derivative.

## How much shading work is wasted in blocks along a triangle's edge?

- [x] Between a quarter and three quarters of it
- [ ] None; uncovered lanes are masked off before the shader runs
- [ ] Exactly half, by construction
- [ ] It depends only on the shader, not on the geometry

@why The floor is one covered pixel in four, and it is why a triangle's
efficiency runs with its ratio of area to perimeter.

## Why are very small triangles the current crisis in rendering?

- [x] Below the size of a block they approach one covered pixel in four, and per triangle setup starts to dominate as well
- [ ] They fail the top left rule more often
- [ ] They cannot be culled early enough
- [ ] Their edge functions lose precision

@why It is why at least one modern engine rasterises small triangles in
software on the general purpose cores instead, which is graphics work moving
back onto the machine that graphics work created.

## Can quad granularity be switched off for a shader that needs no derivatives?

- [x] No; the rasteriser, the depth test, the attribute storage and the blending hardware all assume it
- [ ] Yes, with a shader flag, at the cost of losing texture sampling
- [ ] Yes, and modern compute shaders do exactly that
- [ ] Only on hardware that supports variable rate shading

@why Removing it would mean redesigning all of those blocks for a modest win.

## Where does the warp size of thirty two come from?

- [x] Eight two by two pixel blocks, grouped to fill one instruction issue slot
- [ ] The width of the memory bus in words
- [ ] The number of registers a shader may use
- [ ] A round number chosen for scheduling convenience

@why Four pixels to a block, eight blocks to a warp. Everyone who has memorised
that a warp is thirty two has memorised a fact about mipmap selection.
