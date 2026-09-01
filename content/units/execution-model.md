---
needs: [sm-shape, throughput]
minutes: 55
one_idea: The warp is the unit of execution and the block is the unit of cooperation. Neither of them is the thread.
sources: [modal-gpu-glossary, cuda-programming-tuning, graphics-pipeline]
---

You launch a kernel with `<<<blocks, threads>>>` and write code that reads as
though each thread runs on its own. That reading is the CUDA programming model,
it is deliberate, and it is not what the hardware does.

Two facts sit underneath it. Threads are executed in groups of 32 called [[warp|warps]],
and warps do not appear in the programming model at all. [[block|Blocks]] are
the unit
within which threads may cooperate, and between blocks there is no cooperation
and no ordering whatsoever.

Almost everything that surprises people about GPU code follows from one of
those two. It is worth having the whole hierarchy in front of you before any
of it, because the level that costs you money is the one your code cannot see.

```figure
{
  "kind": "blocks",
  "alt": "A grid containing blocks, one block expanded into three warps of thirty-two threads each, showing that the warp sits between the block and the thread and appears nowhere in the code you write.",
  "caption": "What you write is the bottom row. What runs is the row above it. The warp is the only level in this picture that the programming model never mentions, and it is the one that decides what your code costs.",
  "boxes": [
    { "id": "grid",  "x": 0, "y": 0, "w": 12, "h": 1, "label": "grid", "sub": "as many blocks as you launched", "accent": "slate" },
    { "id": "b0",    "x": 0, "y": 2, "w": 4,  "h": 1, "label": "block 0", "accent": "jade" },
    { "id": "b1",    "x": 4, "y": 2, "w": 4,  "h": 1, "label": "block 1", "sub": "no ordering between them", "accent": "jade" },
    { "id": "b2",    "x": 8, "y": 2, "w": 4,  "h": 1, "label": "block 2", "accent": "jade" },
    { "id": "w0",    "x": 0, "y": 4, "w": 4,  "h": 1, "label": "warp 0", "sub": "32 threads, one instruction pointer", "accent": "gold" },
    { "id": "w1",    "x": 4, "y": 4, "w": 4,  "h": 1, "label": "warp 1", "accent": "gold" },
    { "id": "w2",    "x": 8, "y": 4, "w": 4,  "h": 1, "label": "warp 2", "accent": "gold" },
    { "id": "t",     "x": 0, "y": 6, "w": 12, "h": 1, "label": "threads", "sub": "the only level your code names" }
  ],
  "arrows": [
    { "from": "grid", "to": "b1" },
    { "from": "b0",   "to": "w0", "label": "96 threads is exactly three warps" },
    { "from": "w1",   "to": "t" }
  ]
}
```

## Where 32 comes from

The number is not a round figure someone chose. Fragments are shaded in 2x2
quads because mipmap selection needs a screen-space derivative and the cheapest
derivative is a difference against a neighbour. NVIDIA's own Tesla paper puts
it plainly: the SM controller groups eight pixel quads into a warp of 32
threads. Eight quads, four pixels each.

So the width of a warp is a fact about texture filtering, inherited by a
compute API that has nothing to do with graphics. It is the clearest single
piece of evidence that a GPU is a rasteriser that got general enough to do
arithmetic.

Two consequences that matter immediately. A block of 33 threads occupies two
warps and wastes 31 lanes of the second. And `warpSize` is a runtime value
rather than a compile-time constant, which matters the moment you read code
written for a different vendor, where the same concept is 64 wide.

## Divergence costs both branches

A warp has one instruction pointer for 32 lanes. When lanes disagree about
which way a branch goes, the hardware does not run two branches at once. It
runs one side with the disagreeing lanes masked off, then the other side with
the mask inverted.

```
if (threadIdx.x % 2 == 0) a();   // 16 lanes active, 16 idle
else                      b();   // 16 lanes active, 16 idle
                                 // total time: a() + b()
```

Both paths cost their full time and half your lanes sit idle through each. That
is why [[divergence]] is described as expensive: not because branching is slow, but
because the work does not overlap.

The important qualifier is that divergence is **spatial**, not statistical. A
branch that 50% of your threads take is free if the split lands on warp
boundaries, and ruinous if it alternates every lane. A CPU cares whether a
branch is predictable in time; a GPU cares whether it is uniform in space.

There is a further wrinkle worth knowing before you read old code. Before
Volta, lanes in a warp shared a program counter and reconverged in lockstep, and
a great deal of code quietly relied on it. From Volta onward each thread has its
own program counter and its own call stack, so lockstep is no longer promised.
This is why the warp intrinsics all carry a `_sync` suffix and an explicit mask:
you now have to say which lanes you are talking about, because the hardware no
longer guarantees they arrive together.

## A block is a promise about cooperation

Threads within a block can see the same shared memory and can wait for each
other at `__syncthreads()`. That is what a block is for.

Between blocks there is nothing. No shared memory, no barrier, and no ordering:
a correct kernel must produce the right answer for every possible interleaving
of its blocks, including one where they run strictly one after another in any
order. A block that waits on another block deadlocks, because the block it is
waiting for may not have been scheduled yet and may not be scheduled until the
waiting block finishes.

This looks like a restriction and it is actually the mechanism that makes your
code portable. Because blocks are independent, the same kernel runs on a GPU
with 20 SMs and on one with 148 without recompilation, and gets faster on the
larger one. Every scheduling decision is the hardware's, and it can only be the
hardware's if you promised not to care about the order.

`__syncthreads()` has a rule people break: every thread in the block must reach
it. Placing it inside a branch that only some threads take is undefined
behaviour, and in practice hangs.

## What the hardware actually keeps

It is worth being concrete about why a GPU can afford to have thousands of
threads in flight, because the answer is not what a CPU background suggests.

On a CPU, switching between threads is expensive: the registers belong to the
core, so the operating system saves them, loads another set, and resumes. That
costs hundreds to thousands of cycles, which is why you keep the number of
runnable threads near the number of cores.

An SM does the opposite. Its register file is large enough that every resident
warp keeps its own registers for as long as it lives, so switching between
warps saves and restores nothing at all. The scheduler picks a different warp
that happens to be ready and issues from it on the next cycle. The cost is one
cycle, and there is no state to move.

That inverts the intuition completely. More threads do not cost more switching
overhead; they are the mechanism by which a stall becomes free. When one warp
is waiting several hundred cycles for a value from memory, the SM issues from
another, and the wait disappears behind work that was going to happen anyway.

The price is paid elsewhere, and you should know where. The register file is
finite, so the registers each thread uses limit [[occupancy]], the number of
warps that can be resident,
and using too many quietly reduces the number of warps available to hide
latency. That trade has its own unit later. For now the point is that the
register file is a context store, not a cache, and it is the reason the whole
model works.

## Talking within a warp without memory

Because a warp executes together, lanes can exchange registers directly, with
no memory and no barrier:

```
val += __shfl_down_sync(0xffffffff, val, 16);
val += __shfl_down_sync(0xffffffff, val, 8);
val += __shfl_down_sync(0xffffffff, val, 4);
val += __shfl_down_sync(0xffffffff, val, 2);
val += __shfl_down_sync(0xffffffff, val, 1);
```

Five steps, and lane 0 holds the sum of all 32. That is log2(32), and it uses no
shared memory at all. The mask `0xffffffff` names all 32 lanes; if some lanes
have already exited, naming them is undefined behaviour, so the mask is a claim
you have to be able to make honestly.

This register-exchange path is a direct descendant of the crossbar built so
fragment shaders could compute derivatives against their quad neighbours. The
same wires, exposed to a different API.

## Indexing, and the loop you should write instead

The idiom every kernel starts with:

```
int i = blockIdx.x * blockDim.x + threadIdx.x;
if (i < n) out[i] = f(in[i]);
```

The guard is not optional. Your grid is a whole number of blocks, so unless `n`
divides `blockDim.x` exactly there are threads past the end of the data, and
they will happily write past the end of your array.

A grid-stride loop is usually better:

```
for (int i = blockIdx.x * blockDim.x + threadIdx.x;
     i < n; i += blockDim.x * gridDim.x) { ... }
```

It decouples the grid size from the problem size, so one launch configuration
works for every `n`, the same kernel can be tuned for occupancy independently of
the data, and it is far easier to debug because you can run it with a single
block and a single thread and get the same answer.

## What to carry into the next units

Three sentences.

The warp is the unit of execution, so ask of any branch whether it divides lanes
or divides warps. The block is the unit of cooperation, so ask of any
communication whether it stays inside one. And the thread is the unit you write,
which is a convenience the hardware provides rather than a description of it.

Every performance idea in the rest of this part is one of those three, examined
more closely.

## Reading what the exercises tell you

These exercises run on a real GPU that you rent, so the failures they report are
the ones you would get on a cluster rather than approximations of them.

A compile error from `nvcc` names a file and a line the way `gcc` does, with one
difference worth knowing now: nvcc has no stable error codes. Its warnings are
numbered, as `#549-D`, and its errors are prose. So an explanation here is keyed
to the shape of the message rather than to an identifier, and the build checks
that the shape still matches whenever the toolkit moves.

A kernel that launches and then misbehaves usually says nothing at all. There is
no exception, no stack trace, and often no wrong output either, because a kernel
that writes out of bounds may corrupt something you are not printing. The exit
status is your first signal and the sanitizer is your second.

The most instructive failure in this unit is the one where everything succeeds.
The compiler is happy, the kernel runs, the program exits 0, and the number is
wrong because a warp did not do what you assumed it did. Those exercises are
marked, and there is prose waiting for exactly that outcome.
