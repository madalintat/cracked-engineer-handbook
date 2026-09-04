---
needs: [rasteriser]
minutes: 55
one_idea: Nothing about a streaming multiprocessor was designed for the kernels people now write; compute was fitted into machinery built to shade triangles, and every feature that seems arbitrary is a graphics decision you are inheriting.
sources: [graphics-pipeline, nvidia-architectures]
---

The previous unit ended on a number: a warp is thirty two because a pixel block
is four and eight of them fill an issue slot. That is not an isolated
curiosity. It is the pattern for the whole machine.

Take each structural feature of a streaming multiprocessor, ask what it was for,
and the answer is a rendering problem. Compute did not get a machine designed
for it. Compute got the machine that already existed, plus four additions that
changed what could be expressed on it.

## Cross lane exchange was already there

To compute a derivative, the lanes of a pixel block have to read each other's
registers. That means a crossbar across the register file, and it was built for
mipmap selection.

Once it exists, it is available for anything. The warp shuffle that a kernel
uses to do a reduction without touching memory is that same crossbar, exposed
under a new name a decade later. The subgroup operations in the graphics
interfaces are the same hardware again, and the block operations even came back
to compute shaders so that a compute shader can take a derivative.

So a fast reduction inside a warp is not a compute feature that happened to
help graphics. It is a graphics feature that happened to help compute, and it
was in the silicon long before anybody asked for it.

## Divergence is a geometric idea

A warp executes one instruction at a time across its lanes. When a branch sends
some lanes one way and the rest another, the hardware runs both sides, with the
inactive lanes switched off for each. Both paths are paid for.

Ask where that penalty came from and the answer is the screen. Two fragments in
a block diverge when a triangle edge runs between them, or when a branch depends
on something that varies across a two by two neighbourhood. Divergence was
originally a spatial property: coherent shading meant spatially coherent
shading, because the lanes were neighbours in the picture.

The advice inherited that shape. Sort your work so that neighbouring threads
take the same path is the same sentence as sort your draws so that neighbouring
pixels take the same path, moved to a domain where the neighbours are indices in
an array rather than points on a screen.

## The masked off lane is the helper lane

There is a question every person learning this asks. If half a warp is switched
off in a branch, does it still cost the full time?

Yes. And the reason the hardware is comfortable with that is that it has been
doing exactly this at every triangle edge for decades. A helper lane runs the
whole shader, issues its memory traffic, occupies its arithmetic slot and has
its result discarded, because the covered pixel next to it needs its values.

A predicated off lane in a divergent warp is that same lane, under a different
name. The semantics were not invented for compute; they were already the cost of
shading a partly covered block.

## The register file is not a cache

Here is the feature that looks most arbitrary, and the one with the cleanest
explanation.

A texture read takes hundreds of cycles. A fragment shader does several of them.
On a machine built for latency that would be a disaster, but a renderer has
millions of independent fragments and none of them talk to each other. So the
design decision was not to make the memory faster. It was to keep so much work
resident that there is always something else ready to run.

That requires every resident thread's registers to exist simultaneously, because
a switch between warps has to cost nothing. Nothing can be saved and restored,
so nothing is: the registers of every resident thread are all physically present
at once.

```figure
{
  "kind": "blocks",
  "alt": "A register file holding the full register state of every resident warp at once, so that switching between warps requires no saving or restoring and costs zero cycles.",
  "caption": "It is a context store rather than a cache. Every resident thread's registers exist at the same time, which is what makes a warp switch free, and it is why the register file is larger than the first level cache beside it.",
  "boxes": [
    { "id": "r", "x": 0,   "y": 1.2, "w": 4.2, "h": 1.1, "label": "register file", "accent": "gold" },
    { "id": "w0", "x": 6.0, "y": 0,   "w": 3.4, "h": 1.0, "label": "warp 0 state", "accent": "azure" },
    { "id": "w1", "x": 6.0, "y": 1.6, "w": 3.4, "h": 1.0, "label": "warp 1 state", "accent": "azure" },
    { "id": "wn", "x": 6.0, "y": 3.2, "w": 3.4, "h": 1.0, "label": "warp 47 state", "accent": "azure" }
  ],
  "arrows": [
    { "from": "r", "to": "w0" },
    { "from": "r", "to": "w1" },
    { "from": "r", "to": "wn" }
  ]
}
```

That is why a modern multiprocessor has a quarter of a megabyte of registers,
which is larger than the cache next to it. The register file is a context store
for hundreds of simultaneous threads, and it is that size because graphics
needed hundreds of fragments in flight to cover texture latency.

## Why occupancy is a number you have to care about

Occupancy is how many warps are resident as a fraction of how many could be. It
has no equivalent on a general purpose processor, and the reason is the section
above.

On this machine, hiding latency is the programmer's job. Use more registers per
thread and fewer threads fit; use more scratchpad per block and fewer blocks
fit. Either way there are fewer warps resident, and when one stalls there is
less chance that another is ready. Occupancy is the latency hiding budget, made
visible.

It follows that the tuning knob here is not latency but arithmetic intensity.
You cannot make a memory access faster. You can only make sure something else is
running while it happens, or arrange to issue fewer of them, which is what
tiling into the scratchpad is for and what every later mechanism for streaming
data into the multiprocessor is for.

## What the machine does not have

The most informative part of the design is what was left out.

There is no meaningful branch predictor. There is no speculation. There is no
out of order execution. All three are ways of hiding latency inside a single
instruction stream, and they are enormous in transistors: a large reorder
buffer, a predictor, the machinery to undo work that should not have happened.

With dozens of warps resident, all of that is redundant. The machine already has
somewhere else to go when a warp stalls, so it deleted the most expensive
apparatus a processor has and spent the budget on registers and arithmetic
units instead. Graphics is what told it that trade was correct.

## Atomics are a different mechanism here

One more inheritance, because it changes how code should be written.

An atomic operation on a general purpose processor works through the cache
coherence protocol: the core takes exclusive ownership of a cache line, does the
operation, and everyone else queues behind it. Two unrelated variables in one
line contend, and the cost depends on how far the line has to travel.

On this machine an atomic is executed by dedicated units out at the shared cache
and memory partitions, and it bypasses the shader cores entirely. The
read modify write happens in place on cached data, with competing accesses to
the same address blocked by hashing the address. The value never comes back to
the multiprocessor at all unless you asked for a return value.

That comes from the output stage, which has always been a read modify write
engine bolted to a memory partition, with the address space split across the
partitions so that two of them never touch the same address and never have to
agree about anything.

## What compute actually added

Given all of the above, what was new when this machine became programmable in
general?

Scatter: the ability to write to an address you computed, rather than to the
pixel you were assigned. That one change is most of the difference between a
shader and a program.

Pointers, and a flat address space to use them in, so that a data structure can
be something other than a texture.

A scratchpad: fast memory under the programmer's control, shared by a block of
threads, rather than a cache that decides for itself. It exists because the
tiling that a renderer got for free from texture locality has to be written by
hand when the access pattern is not two dimensional and coherent.

And permission to stop pretending. Before, every computation had to be dressed
as a picture: your data was a texture, your program was a shader, your output
was a frame. Removing that is why the machine's own history stops being visible
in the interface, and it is exactly why the features in this unit look
arbitrary to somebody who arrived after the change.

## What to carry forward

The warp is the pixel block. Cross lane exchange is the derivative crossbar.
Divergence is spatial coherence, and the masked off lane is the helper lane.

The register file is a context store rather than a cache, sized so that a warp
switch costs nothing, which is why occupancy is a metric and why the tuning knob
is arithmetic intensity rather than latency.

The machine has no predictor, no speculation and no reordering, because with
enough resident work those are wasted transistors.

Atomics are performed by dedicated units at the memory partitions rather than
through coherence, which is the output stage's inheritance.

Compute added scatter, pointers, a scratchpad and permission to stop pretending
to be a picture. Everything else you are using was built for triangles.

Next is that machine measured rather than described: what a throughput processor
is actually good at, stated as numbers rather than as architecture.

## Reading the errors you are about to see

These are the budgets the unit describes, in integers: how many warps a register
file holds, what occupancy that gives, how much a divergent branch costs, and
how many warps it takes to cover a latency.

`assert-failed` names the case your model got wrong. Several exercises assert
that both sides of a divergent branch are paid for in full, which is the
predication being modelled correctly rather than a sum written twice.
