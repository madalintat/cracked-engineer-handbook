## How many threads are in a warp on an NVIDIA GPU?

- [x] 32
- [ ] 64
- [ ] 16
- [ ] Whatever `blockDim.x` is set to

@why Thirty-two is a fixed property of the hardware, not something you
configure. It comes from graphics: the SM controller grouped eight 2x2 pixel
quads into one warp, and eight quads of four pixels is 32.

## Why is a warp 32 threads wide rather than some other number?

- [ ] It is the widest a scheduler can decode in one cycle
- [x] It is eight 2x2 pixel quads, and quads exist because mipmap selection
      needs a screen-space derivative
- [ ] It matches the 32-bit register width
- [ ] It was chosen to match the cache line size

@why The number is inherited from texture filtering. A derivative is cheapest
as a difference against a neighbour, so fragments are shaded in quads, and the
Tesla paper describes the SM controller grouping eight quads into a warp.

## A block of 33 threads occupies how many warps?

- [ ] One, since 33 is close enough to 32
- [x] Two, and 31 lanes of the second warp are idle
- [ ] Two, and both are fully occupied
- [ ] It fails to launch

@why Warps are allocated whole. The remaining 31 lanes are masked off and
still take their slot in the scheduler, which is why block sizes are almost
always multiples of 32.

## Why prefer `warpSize` over writing the literal 32?

- [ ] The compiler cannot fold the literal
- [x] `warpSize` is a runtime value, and the same concept is 64 wide on other
      vendors' hardware
- [ ] The literal is undefined inside device code
- [ ] It has no effect either way, so it is only a style preference

@why Writing 32 works today on NVIDIA hardware and gives the wrong answer the
moment the same idea is read against a vendor whose warp is wider. Reading
`warpSize` says what you meant rather than what happened to be true.

## Half the threads in a warp take one side of a branch and half take the
other. How long does the warp take?

- [ ] The longer of the two sides
- [x] The sum of both sides
- [ ] Half of each side, since half the lanes are idle
- [ ] The shorter side, because the rest are masked off

@why A warp has one instruction pointer for 32 lanes. It runs one side with
the disagreeing lanes masked, then the other with the mask inverted. Nothing
overlaps, so the costs add.

## A branch that exactly 50% of your threads take is:

- [ ] Always expensive, because half the lanes are idle
- [x] Free if the split lands on warp boundaries, and expensive if it
      alternates lane by lane
- [ ] Always free, because the scheduler regroups the lanes
- [ ] Expensive only on pre-Volta hardware

@why Divergence is spatial rather than statistical. A CPU asks whether a
branch is predictable in time; a GPU asks whether it is uniform in space.

## What changed about warps from Volta onward?

- [ ] Warps became 64 threads wide
- [x] Each thread got its own program counter and call stack, so lockstep
      reconvergence is no longer promised
- [ ] Divergence became free
- [ ] Warps were replaced by blocks as the unit of execution

@why This is why the warp intrinsics carry a `_sync` suffix and an explicit
mask. You now have to name the lanes you mean, because the hardware no longer
guarantees they arrive together.

## Two blocks in the same kernel need to exchange a value. What should you do?

- [ ] Use `__syncthreads()` between them
- [ ] Put the value in shared memory
- [x] Split the work into two kernel launches
- [ ] Spin on a flag in global memory until the other block writes it

@why There is no ordering between blocks and no barrier across them. A block
that waits on another can deadlock, because the block it waits for may not be
scheduled until the waiting block finishes.

## Why is the absence of communication between blocks useful rather than
merely restrictive?

- [ ] It makes kernels shorter to write
- [x] It lets the same kernel run unchanged on a GPU with 20 SMs or 148, and
      get faster on the larger one
- [ ] It removes the need for shared memory
- [ ] It guarantees deterministic output ordering

@why Every scheduling decision belongs to the hardware, and it can only belong
to the hardware because you promised not to care about the order.

## Putting `__syncthreads()` inside a branch that only some threads take is:

- [ ] Fine, as long as the branch is uniform within each warp
- [x] Undefined behaviour, and in practice hangs
- [ ] A compile error
- [ ] Slower, but correct

@why Every thread in the block has to reach the barrier. The threads that
skipped it never arrive, and the ones that did wait forever.

## Why is switching between warps on an SM nearly free, when switching threads
on a CPU is expensive?

- [ ] The GPU has no operating system to involve
- [x] Every resident warp keeps its own registers for as long as it lives, so
      there is no state to save or restore
- [ ] Warps are lighter because they share a program counter
- [ ] The scheduler switches only when a warp finishes

@why The register file is a context store, not a cache. A CPU saves and
restores registers because they belong to the core; an SM has enough of them
to give every resident warp its own.

## More resident warps on an SM means:

- [ ] More switching overhead, as on a CPU
- [x] More chances to hide a stall, since the SM issues from a different warp
      while one waits
- [ ] Slower execution once the count exceeds the number of cores
- [ ] No difference, since only one warp issues per cycle

@why This inverts the CPU intuition. Threads are not a cost to be managed;
they are the mechanism by which a several-hundred-cycle memory wait disappears
behind work that was going to happen anyway.

## What limits how many warps can be resident on an SM?

- [ ] The number of CUDA cores
- [x] Finite resources such as the register file, so the registers each thread
      uses cap the number of resident warps
- [ ] The size of the L2 cache
- [ ] The grid size you launched with

@why This is the price of the register-file-as-context-store design. Using too
many registers per thread quietly reduces the number of warps available to
hide latency.

## `__shfl_down_sync` lets lanes exchange values using:

- [ ] Shared memory and a barrier
- [ ] Global memory
- [x] Registers directly, with no memory and no barrier
- [ ] The L1 cache

@why Because a warp executes together, lanes can hand each other register
contents. Five shuffle steps reduce 32 values to one in lane 0, which is
log2(32).

## Why is a grid-stride loop usually better than one thread per element?

- [ ] It runs faster on every input size
- [x] It decouples the grid from the problem, so one launch configuration
      works for any `n` and the kernel can be debugged with a single thread
- [ ] It removes the need for a bounds check
- [ ] It avoids divergence entirely

@why The property worth having is that the same kernel is debuggable serially
and fast in parallel. One block of one thread still gives the right answer.
