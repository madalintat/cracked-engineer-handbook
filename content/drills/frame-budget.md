## Which three properties make rendering the workload it is?

- [x] Huge, deadlined, and independent
- [ ] Huge, sequential, and latency sensitive
- [ ] Small, deadlined, and repetitive
- [ ] Huge, deadlined, and shared

@why The third one is the rare property. Almost nothing else in this handbook
has it, and everything about the machine is built on it.

## How many pixels does a 3840 by 2160 display produce at 120 frames a second?

- [x] Just under a billion per second
- [ ] About eight million per second
- [ ] About a hundred million per second
- [ ] About ten billion per second

@why Eight million per frame, and a hundred and twenty of those a second. The
per frame figure is the one people quote and the per second figure is the one
that matters.

## Roughly how long is there per pixel at 4K and 120 hertz?

- [x] About one nanosecond
- [ ] About one microsecond
- [ ] About one millisecond
- [ ] About ten nanoseconds

@why The frame budget is 8.333 milliseconds spread over eight million pixels.
On a five gigahertz core, a nanosecond is five clock cycles.

## What is overdraw?

- [x] The ratio of fragments produced to pixels finally shown
- [ ] Drawing outside the bounds of the display
- [ ] The extra work of drawing at a higher resolution than the display
- [ ] Redrawing the frame when it misses its deadline

@why Geometry is submitted before anything knows what will be visible, so a
pixel is written, covered, and covered again.

## What is a typical opaque overdraw factor?

- [x] Two to four, with transparency pushing local regions to ten or more
- [ ] Exactly one, because a depth test prevents the rest
- [ ] Around one hundred
- [ ] It depends only on the resolution

@why A depth prepass and hierarchical depth testing cut it, and they do not
remove it. Take three as a working figure and the work triples before a shader
has run once.

## Why is texture filtering fixed function silicon rather than shader code?

- [x] It is around 190 billion filtered reads a second, each needing address arithmetic, decode and a blend tree
- [ ] Shader cores cannot do the arithmetic it requires
- [ ] It has to happen before the shader runs
- [ ] It is patented, so it lives in a separate unit

@why Nobody executes that as instructions. It is a pipelined array producing a
result per clock, and it has been separate silicon since the beginning.

## Framebuffer traffic alone, at 4K and 120 hertz with three times overdraw, is roughly what?

- [x] Tens of gigabytes per second, with no texture traffic counted at all
- [ ] A few hundred megabytes per second
- [ ] A few gigabytes per second
- [ ] Over a terabyte per second

@why Around twelve bytes per fragment for the depth read, depth write and
colour write. It is why lossless depth and colour compression is mandatory
hardware rather than a refinement.

## Why are mobile graphics architectures different?

- [x] A phone has a small fraction of the memory bandwidth and shares it with the processor
- [ ] Phones do not need a depth buffer
- [ ] Phone displays refresh too slowly to matter
- [ ] Mobile shaders are written in a different language

@why Hundreds of gigabytes a second is what makes the immediate mode approach
work. Without it the architecture has to change, which is where tile based
rendering comes from.

## How far apart are a large processor and a large graphics card in peak arithmetic?

- [x] Around sixteen times
- [ ] Around a thousand times
- [ ] Around a hundred times
- [ ] They are roughly equal

@why The unfair comparison against a single core loses the argument. A sixteen
core machine is about five trillion operations a second against about eighty,
and the processor is still hopeless at this job for reasons that are not about
arithmetic.

## A sixteen core five gigahertz processor rendering 4K at 120 hertz has how many cycles per pixel?

- [x] About eighty, across all cores
- [ ] About five, across all cores
- [ ] About a thousand
- [ ] About eight hundred

@why 666 million core cycles in a frame, over eight million pixels. With three
times overdraw that is twenty seven cycles per fragment.

## Why does one filtered texture read not fit in twenty seven cycles?

- [x] It is four dependent loads, each paying a full cache or memory latency, plus the blending
- [ ] The filtering arithmetic alone exceeds the budget
- [ ] It needs a system call
- [ ] The texture must be decompressed first

@why Dependent loads do not overlap. One sample spends the whole per fragment
budget, and a real shader wants eight of them.

## Why is a processor's cache hierarchy the wrong shape for rendering?

- [x] It optimises one thread's next access and pays for coherence, where a renderer wants aggregate throughput with almost no reuse or sharing
- [ ] Its caches are too small to hold a framebuffer
- [ ] It cannot prefetch two dimensional patterns at all
- [ ] Rendering does not use memory enough to benefit

@why No two fragments share data, so the coherence protocol is pure cost here.

## How does a processor hide memory latency, and why is that the wrong mechanism here?

- [x] Out of order execution over one instruction stream, when a renderer already has millions of independent streams waiting
- [ ] By prefetching, which graphics workloads defeat
- [ ] By using larger caches, which are too expensive at this scale
- [ ] By running at a higher clock, which costs too much power

@why An enormous transistor investment to find a handful of independent
instructions inside a sequence written to be sequential. The right answer here
is to keep hundreds of streams resident and switch between them for nothing.

## What does deadlined mean for this workload?

- [x] A frame that misses its slot is a stutter somebody sees, so late is the same as wrong
- [ ] The work must complete before the next input arrives
- [ ] The deadline is a target rather than a requirement
- [ ] Frames are dropped in advance when the load is high

@why Missing by a little is the whole problem. At 120 hertz a frame that takes
nine milliseconds instead of eight is not eleven percent worse; it is a dropped
frame.

## Why can a processor not simply be given more cores for this?

- [x] The per pixel cycle budget is what is short, and each core also spends tens of instructions on what is fixed function elsewhere
- [ ] Rendering cannot be parallelised across cores
- [ ] Memory bandwidth is the only limit, and cores do not change it
- [ ] Cores cannot be added without lowering the clock

@why More cores raise the cycle budget linearly and do nothing about the other
three reasons, which is why the answer was a different machine rather than a
bigger one.
