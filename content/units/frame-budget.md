---
needs: [pipeline, cache]
minutes: 55
one_idea: Rendering is huge, deadlined and independent, and once you do the arithmetic the shape of a graphics processor stops being a design choice and becomes the only answer that fits in the time.
sources: [graphics-pipeline]
---

A screen is an arithmetic problem before it is anything else. Work out how much
has to happen and how long there is to do it in, and most of what a graphics
processor looks like follows from the numbers rather than from anybody's taste.

Three properties make this workload what it is. It is huge: millions of outputs
per frame. It is deadlined: late is the same as wrong, because a frame that
misses its slot is a stutter somebody sees. And it is independent: no pixel
needs to know what any other pixel decided.

That last one is the rare property. Almost nothing else in this handbook has it,
and everything about the machine in the next ten units is built on it.

## One nanosecond per pixel

Take a display of 3840 by 2160 at 120 frames a second.

That is 8,294,400 pixels per frame, and just under a billion pixels a second.
The frame budget is one hundred and twentieth of a second, which is 8.333
milliseconds. Divide one by the other:

```
8.333 ms / 8,294,400 px  =  about 1.0 nanoseconds per pixel
```

One nanosecond, per pixel, for everything: transforming the geometry, working
out which pixels a triangle covers, running the shader, fetching the textures,
testing the depth, blending the result. On a five gigahertz core a nanosecond is
five clock cycles.

That number is the whole unit. Every design decision downstream is an answer to
it.

## Except each pixel is not drawn once

Geometry is submitted before anything knows what will end up visible, so a pixel
is written, then covered by something nearer, then covered again. The ratio of
fragments produced to pixels finally shown is overdraw, and for opaque geometry
a factor of two to four is normal. Transparency is worse: particles, foliage and
interface layers can push a local region to ten or more.

Take three as a working figure and the arithmetic moves:

```
8,294,400 px x 3       =  24,883,200 fragments per frame
x 120 frames           =  about 3 billion fragment shader runs per second
```

Now attach a shader to each one. A cheap textured fragment is tens of arithmetic
operations. A modest one with a few lights, a normal map and a reflectance model
is a few hundred. At two hundred operations per fragment:

```
24,883,200 x 200       =  about 5 billion operations per frame
x 120 frames           =  about 600 billion operations per second
```

That is fragment shading alone, at a shader nobody would call expensive. A
serious deferred lighting pass at a thousand operations per fragment puts it at
three trillion. Then add vertex work, shadow maps, which redo the geometry once
per light, and every post-processing pass.

## Where the rest of the silicon goes

Two more budgets are worth doing, because each one explains a piece of hardware
that would otherwise look arbitrary.

Texturing first. Say eight samples per fragment, which is unremarkable: colour,
normal, roughness, metalness, ambient occlusion, a couple of shadow taps and an
environment probe. Each of those, filtered smoothly, reads eight texels.

```
24,883,200 x 8 x 8     =  about 1.6 billion texel reads per frame
x 120 frames           =  about 190 billion per second
```

Every one of those needs an address computed with wrapping, a format decoded and
a weighted blend across the neighbours. Nobody writes that as shader code at 190
billion a second, which is why filtering is fixed function silicon and has been
since the beginning.

Then the framebuffer. Per fragment the output stage reads the depth, usually
writes it, and writes a colour, and for anything blended reads the colour too.
Call it twelve bytes:

```
24,883,200 x 12 B      =  about 300 MB per frame
x 120 frames           =  about 36 GB per second
```

That is the framebuffer alone, with no textures in it at all. Add texture
traffic and you are into hundreds of gigabytes per second, which is what the
memory on a discrete card is built to deliver. A phone has a small fraction of
that and shares it with the processor, which is the entire reason mobile
graphics hardware is built differently.

## The honest comparison with a processor

The unfair version of this argument compares a graphics part with one processor
core and declares a thousandfold gap. Do it properly instead.

A sixteen core processor at five gigahertz with two wide fused multiply add
units per core peaks at roughly five trillion operations a second. A large
graphics card is about eighty. The gap is around sixteen times, not a thousand.
A processor is not hopeless at raw arithmetic.

It is hopeless at this job, for four reasons that have nothing to do with peak
arithmetic.

The first is the per pixel budget. That same processor has sixteen times five
billion times 8.333 milliseconds, which is 666 million core cycles in a frame.
Spread over the pixels:

```
666,000,000 / 8,294,400  =  about 80 cycles per pixel
with 3x overdraw         =  about 27 cycles per fragment
```

Twenty seven cycles. One smoothly filtered texture read is four dependent loads,
each likely to miss a cache and cost tens to hundreds of cycles, plus the blends
between them. A single texture sample spends the entire per fragment budget, and
a real shader wants eight of them, before any of the triangle setup, coverage,
interpolation, depth test or blend has happened.

```figure
{
  "kind": "blocks",
  "alt": "A per fragment budget of twenty seven processor cycles set against the cost of one filtered texture read, which is four dependent memory loads plus blending and exceeds the whole budget by itself.",
  "caption": "The budget is not tight, it is already spent. One filtered texture read costs more than the whole per fragment allowance, and a real shader asks for eight of them.",
  "boxes": [
    { "id": "b", "x": 0,   "y": 0,   "w": 4.6, "h": 1.1, "label": "27 cycles per fragment", "accent": "gold" },
    { "id": "t", "x": 6.4, "y": 0,   "w": 5.0, "h": 1.1, "label": "1 filtered sample", "accent": "clay" },
    { "id": "l", "x": 6.4, "y": 2.2, "w": 5.0, "h": 1.1, "label": "4 dependent loads", "accent": "clay" }
  ],
  "arrows": [
    { "from": "b", "to": "t" },
    { "from": "t", "to": "l" }
  ]
}
```

The second is that everything the graphics hardware does in fixed function costs
a processor tens of instructions. Filtering is a pipelined array producing a
result per clock; in software it is address arithmetic, four gathers, format
conversion and a blend tree. A depth test and blend is one read modify write in
a dedicated unit; in software it is a load, a compare, a branch, a blend and a
store, with the next fragment hitting the same pixel right behind it.

The third is that the memory system is built for the wrong thing. A processor
cache hierarchy exists to make one thread's next access fast, and to keep shared
data coherent between cores. A renderer wants aggregate throughput over an
access pattern with almost no reuse, and no two fragments share anything, so the
coherence machinery is pure cost.

The fourth is the deepest. A processor hides memory latency by being clever
about one instruction stream: out of order execution, a large reorder buffer,
branch prediction, an enormous transistor investment to find a handful of
independent instructions inside a sequence written to be sequential. A renderer
does not have one stream. It has millions of them, already independent, sitting
in a queue. The right answer is not cleverness about one; it is to keep hundreds
of them resident and switch between them for nothing.

So the answer to why a processor cannot render is not that it lacks arithmetic.
It is that it spends its transistors on a problem this workload does not have,
because it was designed for work where independence is scarce, and here
independence is free.

## What to carry forward

Rendering is huge, deadlined and independent, and the last of those is what
makes a different machine possible.

At four thousand pixels wide and 120 frames a second there is about one
nanosecond per pixel for everything, which is five cycles of a fast core.
Overdraw multiplies the work by three or more before a shader has run once.

Texture filtering is fixed function because nobody executes 190 billion filtered
reads a second as instructions. Framebuffer traffic alone is tens of gigabytes
per second, which is why compression of depth and colour is mandatory rather
than clever, and why a phone with shared memory needs a different architecture.

A processor is about sixteen times slower at peak arithmetic and infinitely
worse at this job, because eighty cycles per pixel does not buy one texture
sample, and because it hides latency with a mechanism that assumes parallelism
is scarce.

Next is where those fragments come from: how three edges and a grid turn a
triangle into pixels, and why the answer arrives in blocks of four.

## Reading the errors you are about to see

These are the arithmetic of the unit, done in integers. Rates are large, so the
tests use 64 bit types throughout and the intermediate values matter.

`assert-failed` names the case your model got wrong. Several exercises assert
results that overflow a 32 bit integer, which is the point rather than an
accident: a billion pixels a second does not fit in the type most people reach
for first.
