# The Real-Time Graphics Pipeline — why a GPU is shaped like a GPU

Research date: 2026-09-01. Written as the **prequel** to the CUDA units of a
from-first-principles computing curriculum.

**The framing this report exists to fix.** Most curricula introduce the GPU as a compute
device that fell from the sky: "it has thousands of cores, they run in warps of 32, there
is a scratchpad called shared memory, divergence is bad, coalescing matters." Every one of
those facts is presented as an arbitrary axiom. None of them is arbitrary. The GPU is a
**rasteriser that got general enough to do arithmetic**, and every structural oddity of a
Streaming Multiprocessor is a fossil of a specific rendering problem. A warp is 32 threads
because it is **eight 2×2 pixel quads**. A quad is 2×2 because that is the cheapest
possible screen-space derivative, and you need a screen-space derivative to pick a mipmap
level. Shared memory is the buffer that held vertex attributes between shader stages. The
read-only `__ldg` path is the texture unit with the filtering switched off. Atomics behave
the way they do because they descend from the ROP, which was a read-modify-write engine
bolted to a memory partition. And CUDA exists at all because in 2006 NVIDIA merged the
vertex and pixel shader units into one core, and NVIDIA's own architects wrote that
"*the generality required of a unified processor opened the door to a completely new GPU
parallel-computing capability*."

Teach the rasteriser first and the CUDA execution model stops being a list of magic
numbers.

**Authority order used throughout:** (1) vendor architecture whitepapers and peer-reviewed
architecture papers — the Lindholm et al. IEEE Micro Tesla paper and the NVIDIA Turing
whitepaper are the two load-bearing primary sources; (2) API specifications and vendor
developer documentation (Khronos, Microsoft, Apple, Arm); (3) Fabian Giesen's *A Trip
Through the Graphics Pipeline 2011*, which is the best public description of GPU
fixed-function internals written by someone who worked on them (Giesen was at RAD Game
Tools and has since worked on GPU hardware); (4) Wikipedia for dates and product timelines
only. §8 records everything that could not be verified.

Two sources are cited often enough to get short names:

- **[TESLA]** — E. Lindholm, J. Nickolls, S. Oberman, J. Montrym, "NVIDIA Tesla: A Unified
  Graphics and Computing Architecture," *IEEE Micro* 28(2), March–April 2008, pp. 39–55.
  Fetched as PDF from
  <https://www.cs.cmu.edu/afs/cs/academic/class/15869-f11/www/readings/lindholm08_tesla.pdf>
- **[GIESEN]** — Fabian Giesen, "A trip through the Graphics Pipeline 2011," parts 1–13,
  index at <https://fgiesen.wordpress.com/2011/07/09/a-trip-through-the-graphics-pipeline-2011-index/>
  Individual parts cited as [GIESEN-4] etc.
- **[TURING]** — *NVIDIA Turing GPU Architecture* whitepaper, WP-09183-001_v01,
  <https://images.nvidia.com/aem-dam/en-zz/Solutions/design-visualization/technologies/turing-architecture/NVIDIA-Turing-Architecture-Whitepaper.pdf>

---

## 0. The shape of the story in one paragraph

A screen is a large array of independent arithmetic problems with a hard deadline. That
one sentence generates everything. Because the problems are independent, you can build a
machine with no coherence protocol and no speculation. Because there are millions of them,
you never run out of work, so you can hide latency by switching to another problem rather
than by predicting your way around it — which means you spend transistors on registers
instead of on out-of-order machinery. Because you must select a mipmap level per pixel and
mipmap selection needs `∂u/∂x`, you shade pixels in 2×2 blocks and take finite differences
between lanes — which makes the lane group a hardware fact and hands you free cross-lane
communication. Because texture access is 2D-coherent rather than linear, you swizzle
memory and build a tiny specialised cache. Because the framebuffer is a read-modify-write
in submission order at full pixel rate, you build address-partitioned atomic units next to
the memory controller. And because in 2006 the vertex and pixel workloads refused to stay
in a fixed ratio, NVIDIA merged the two shader cores into one general processor and — in
the same generation, by the same team, deliberately — shipped CUDA on it. **Nothing was
added for compute. Compute was what was left when you stopped calling it graphics.**

---

# Part 1 — The problem graphics hardware was built to solve

## 1.1 Why rendering is embarrassingly parallel

Three independences stack:

1. **Vertices are independent of each other.** A vertex shader is a pure function from one
   vertex's attributes to one clip-space position plus interpolants. Vertex *i* does not
   read vertex *j*. (Index-buffer reuse is a cache optimisation, not a dependency.)
2. **Triangles are independent during setup and rasterisation.** Edge-equation setup for
   triangle *i* does not consult triangle *j*.
3. **Fragments are independent right up to the last stage.** A fragment shader reads
   interpolated attributes and textures and produces a colour. It cannot see other
   fragments. It cannot write to another fragment's pixel — in the classic pipeline it
   cannot write anywhere at all except its own output register.

The dependency appears exactly once, at the very end: two fragments landing on the same
pixel must be depth-tested and blended **in submission order**. That single ordering
constraint is quarantined into a separate fixed-function block (the ROP) that sits next to
the memory controller, precisely so that the other 99.9% of the work can stay unordered.

[GIESEN-8] names the shape correctly: the pipeline is a **fork/join**. The rasteriser
forks one triangle into up to millions of independent fragments; the ROP joins them back
"into one (correctly ordered) stream of memory operations" [GIESEN-9]. Everything between
the fork and the join is free of ordering, free of communication, and free of coherence.
That is the machine's whole opportunity.

Contrast this with a general parallel program, where you must *prove* independence, and
where the proof usually fails. Graphics hands you independence as a *definition of the
problem*. This is why the GPU could be built at all: nobody had to solve the hard part.

## 1.2 The arithmetic of filling a 4K screen at 120 Hz

**Pixels.** 3840 × 2160 = **8,294,400** pixels per frame.

**Rate.** At 120 Hz that is 8,294,400 × 120 = **995,328,000 pixels/second** — call it
one gigapixel per second, before any overdraw.

**Frame budget.** 1/120 s = **8.333 ms**. Divide by the pixel count:

```
8.333e-3 s / 8,294,400 px = 1.005e-9 s = 1.005 nanoseconds per pixel
```

One nanosecond, per pixel, for *everything*: transform, raster, shade, texture, depth,
blend. On a 5 GHz core that is **five clock cycles**.

**Overdraw.** Real scenes draw each pixel more than once — geometry is submitted before
you know what is visible, so a pixel is written, then covered, then covered again.
A depth-prepass and hierarchical-Z cut this, but a typical opaque overdraw factor of 2–4
is normal and transparency (particles, foliage, UI) can push local overdraw to 10× or
more. Take 3× as a working figure:

```
8,294,400 px × 3 = 24,883,200 fragment shader invocations per frame
× 120 fps         = 2.99 billion fragment invocations per second
```

**Shader arithmetic.** A cheap unlit textured fragment shader is tens of FLOPs. A modest
physically-based shader with a few lights, normal mapping and a BRDF is a few hundred. Take
200 FLOP/fragment:

```
24,883,200 × 200 FLOP = 4.98 GFLOP per frame
× 120 fps             = 597 GFLOP/s — for fragment shading alone
```

At 1000 FLOP/fragment (a serious deferred-lighting shader) that is **3 TFLOP/s**. Add
vertex shading, compute passes, post-processing, and shadow-map rendering (which redoes
geometry once per light) and multi-TFLOP/s is the floor, not the ceiling.

**Texture work.** Say 8 texture samples per fragment (albedo, normal, roughness, metallic,
AO, two shadow taps, an environment probe), each trilinear = 8 texel fetches:

```
24,883,200 frag × 8 samples × 8 texels = 1.59 billion texel fetches per frame
× 120 fps                              = 191 billion texel fetches per second
```

Each of those needs address computation with wrap/clamp, format decode, and a
multiply-accumulate blend tree. That is 191 G *filtering operations* per second, which is
why filtering is fixed-function silicon and not shader code.

**ROP bandwidth.** A 4K RGBA8 colour buffer is 8,294,400 × 4 = **33.2 MB**. A 32-bit depth
buffer is another 33.2 MB. Per fragment the ROP does at minimum a depth read (4 B), often
a depth write (4 B), and a colour write (4 B) — and for blended geometry a colour read too.
Take 12 B/fragment:

```
24,883,200 frag × 12 B = 298 MB per frame
× 120 fps              = 35.8 GB/s — just the framebuffer, uncompressed, no textures
```

That is why lossless depth and colour compression is mandatory hardware [GIESEN-7,
GIESEN-9] and why every GPU has fast-clear tile flags. Add texture bandwidth and you are
into the hundreds of GB/s. Discrete GPUs answer this with 500 GB/s to 1.8 TB/s of GDDR6X
or HBM. **A phone has 30–70 GB/s and shares it with the CPU.** Hold that thought; it is
the entire reason mobile GPUs are architecturally different (§3.6).

**Geometry.** A modern scene is 2–10 million triangles per frame. At 120 Hz and 5 M
triangles that is **600 M triangles/second** of clip, cull, and edge-equation setup, and
roughly 1.5–3 G vertex shader invocations/s after index reuse. Each vertex shader is at
minimum a 4×4 × 4-vector matrix multiply (16 multiplies + 12 adds = 28 FLOP) and in
practice several matrices, a normal transform, and interpolant setup — 100–300 FLOP.

## 1.3 Why a CPU cannot do it

The naive comparison is unfair and also loses the argument, so do the honest one.

A high-end 16-core CPU at 5 GHz with two AVX-512 FMA units per core has a peak FP32
throughput of 16 lanes × 2 (FMA) × 2 units × 5e9 × 16 cores ≈ **5.1 TFLOP/s**. An RTX 4090
is 82.6 TFLOP/s FP32. So the gap is ~16×, not 1000×. The CPU is not hopeless at *raw
FLOPs*. It is hopeless at this *job*, for four separate reasons, and the curriculum should
name all four:

**(a) The per-pixel instruction budget is tiny.** In one 8.333 ms frame a 16-core 5 GHz CPU
has 16 × 5e9 × 8.333e-3 = **666 million core-cycles**. Divide by 8,294,400 pixels:

```
666e6 cycles / 8.29e6 px = 80 core-cycles per pixel, total
with 3× overdraw          = 27 core-cycles per fragment
```

Twenty-seven cycles. A single bilinear texture fetch is four dependent loads (each a
likely L2 or DRAM miss at 20–300 cycles) plus three lerps. **One texture sample blows the
entire per-fragment budget**, and a real shader wants eight of them. And that is before
the triangle setup, the coverage test, the perspective divide, the interpolation, the
depth test, and the blend.

**(b) Everything the GPU does in fixed function costs the CPU tens of instructions.**
Bilinear filtering: hardware does 4 fetch + 3 lerp in a pipelined MAC array at one result
per clock per unit; software does address clamping, swizzle-address computation, four
gathers, format conversion, and a blend tree. Depth test + blend: hardware is a
read-modify-write in a dedicated unit; software is a load, compare, branch, blend, store,
with a store-to-load hazard on the next fragment hitting the same pixel. Mip selection,
sRGB conversion, MSAA resolve, tile compression — all of it becomes instructions.

**(c) The memory system is optimised for the wrong thing.** A CPU cache hierarchy is
optimised to make *one* thread's next access fast (low latency, hardware prefetch of
linear streams, coherence so that shared data is correct). A renderer wants *aggregate*
throughput over a 2D-coherent, effectively-random-across-a-frame access pattern with
almost no reuse between frames. Coherence protocol is pure cost here — no two fragments
share data.

**(d) Latency hiding is the wrong mechanism.** A CPU hides memory latency with
out-of-order execution, deep reorder buffers, and branch prediction — an enormous
transistor investment to find ~4 instructions of parallelism inside *one* instruction
stream. A renderer has millions of independent streams sitting in a queue. The correct
answer is not to be clever about one thread; it is to have 768 of them resident and switch
between them for free — which is exactly what [TESLA] describes the G80 SM doing.

So the answer to "why can't a CPU render?" is not "not enough FLOPs." It is: **the CPU
spends its transistor budget on the wrong problem, because it was built for a workload
where independence is scarce, and rendering is a workload where independence is free.**

---

# Part 2 — The rasterisation pipeline, stage by stage

The logical order below is the API's order. Note [TESLA]'s warning that on real hardware
"*the physical Tesla architecture doesn't resemble the logical order of graphics pipeline
stages*" — the same pool of shader cores executes every programmable stage, and work
flows between them through buffers and fixed-function blocks. Teach the logical order,
then break it in §3.

```
 index buffer + vertex buffers
        │
   [ input assembler ]  ── fixed function: fetch, index, instance
        │
   [ vertex shader ]  ── programmable, 1 in : 1 out
        │
   [ hull → tessellator → domain ]  ── optional, DX11/GL4
        │
   [ geometry shader ]  ── optional, variable amplification, historically slow
        │
   [ primitive assembly, clip/cull, perspective divide, viewport ]  ── fixed function
        │
   [ RASTERISER ]  ── fixed function: coarse tile test → fine test → 2×2 quads
        │
   [ hierarchical Z + early Z/stencil ]  ── fixed function, conditionally skipped
        │
   [ attribute interpolation ]  ── fixed-function barycentrics + shader MADs
        │
   [ fragment/pixel shader ]  ── programmable, shaded in 2×2 QUADS
        │
   [ late Z/stencil, blend, ROP ]  ── fixed function, in API order
        │
   render targets + depth/stencil buffer
```

Or, as of 2018:

```
 [ task shader ] → [ mesh shader ] → [ rasteriser ] → ...
```
which replaces the whole top half with a compute-style program (§2.11).

## 2.1 Vertex fetch and input assembly

The input assembler is fixed-function hardware that "*collects vertex work as directed by
the input command stream*" [TESLA]. It reads the index buffer, applies primitive topology
(triangle list / strip / fan), applies instancing, and gathers each vertex's attributes
from one or more vertex buffers according to an input layout descriptor (stride, offset,
format per attribute).

Two things matter architecturally:

**The post-transform vertex cache.** Indexed drawing exists so that a vertex shared by
six triangles is shaded once, not six times. The hardware keeps a small FIFO of recently
shaded vertices keyed by index; a hit skips the vertex shader entirely. This is why
mesh optimisation (Forsyth / Tipsify vertex-cache-optimising triangle reorderings) is a
real 20–40% win on vertex-bound scenes, and why *strip order matters*. It is also the
thing mesh shaders replace with explicit, programmer-controlled reuse inside a meshlet.

**Format decode is free.** The IA converts `R16G16B16A16_SNORM`, `R10G10B10A2_UNORM`,
half-floats, and packed formats into shader floats in fixed function. This is why vertex
compression is nearly always a win: you halve the bandwidth and pay nothing.

## 2.2 The vertex shader

A program from one vertex to one vertex. Mandatory output: a **clip-space position**
(`gl_Position` / `SV_Position`), a 4-component homogeneous coordinate. Optional outputs:
any set of interpolants (UVs, normals, tangents, vertex colours, world position) that will
be interpolated across the triangle and handed to the fragment shader.

Note the asymmetry [TESLA] names: vertex processors were historically "*designed for
low-latency, high-precision math operations, whereas pixel-fragment processors were
optimized for high-latency, lower-precision texture filtering.*" That asymmetry is the
seed of the unification story in §3.5.

## 2.3 The transform chain

This is the single most teachable piece of the whole pipeline because it is pure linear
algebra with an exactly checkable answer, and because the **perspective divide is the only
non-affine step** — which is where every confusing thing in graphics comes from.

```
 object space  --[ M : model matrix ]-->      world space
 world space   --[ V : view matrix  ]-->      view / camera / eye space
 view space    --[ P : projection   ]-->      CLIP space (homogeneous, 4D)
 clip space    --[ ÷ w ]------------->        NDC (normalised device coordinates)
 NDC           --[ viewport transform ]-->    screen space (pixels) + depth
```

**M, the model matrix.** Object → world. Typically `T · R · S` (translate, rotate, scale,
applied right-to-left). Normals transform by `(M⁻¹)ᵀ`, not `M`, whenever there is
non-uniform scale — a classic bug worth an exercise.

**V, the view matrix.** World → view. This is the *inverse* of the camera's world
transform. For a rigid camera transform `[R|t]`, `V = [Rᵀ | −Rᵀt]`. The standard
"look-at" construction builds an orthonormal basis from forward/up/right and writes the
basis vectors as *rows*, which is the transpose (= inverse) of writing them as columns.
Teaching point: `V` is an inverse, and students who don't see that never understand why
moving the camera right moves the world left.

**P, the projection matrix.** View → clip. The right-handed OpenGL convention (camera
looks down −z, clip z ∈ [−1, 1]), with `f = 1/tan(fovy/2)`, aspect `a`, near `n`, far `fr`:

```
      ⎡ f/a   0        0                 0            ⎤
 P =  ⎢  0    f        0                 0            ⎥
      ⎢  0    0   (fr+n)/(n−fr)   2·fr·n/(n−fr)       ⎥
      ⎣  0    0       −1                 0            ⎦
```

The crucial row is the last: `w_clip = −z_view`. **The projection matrix's real job is to
copy the view-space depth into `w`**, so that the subsequent divide performs the
perspective foreshortening. Direct3D uses `z_clip ∈ [0, w]` instead of `[−w, w]` and a
left-handed convention; Vulkan uses `[0, w]` with y pointing *down* in NDC. These
conventions are a genuine source of bugs and are worth stating explicitly rather than
hand-waving.

**Clip space.** Homogeneous 4D. A point is inside the frustum iff
`−w ≤ x ≤ w`, `−w ≤ y ≤ w`, and (GL) `−w ≤ z ≤ w` or (D3D/Vulkan) `0 ≤ z ≤ w`. Clipping is
done *here*, before the divide, because after the divide a vertex behind the eye
(`w < 0`) has its sign flipped and lands somewhere absurd. This is the answer to "why is
there a clip space at all, why not divide immediately?" — **because you cannot divide by
a negative or zero w and get anything meaningful, and geometry crossing the near plane
does exactly that.**

**Perspective divide.** `ndc = clip.xyz / clip.w`. NDC is the unit cube (with the z range
depending on convention). This is the non-affine step. Consequences that must be taught:

- Linear interpolation in screen space is **not** linear interpolation in world space.
  A UV coordinate interpolated naively across a screen-space triangle produces the famous
  PlayStation 1 texture warping. The fix (§2.5) is to interpolate `attr/w` and `1/w`
  linearly and divide at the end.
- Depth is distributed as `1/z`, not linearly. Substituting `w = −z_view`:

  ```
  z_ndc = (fr+n)/(n−fr) + [2·fr·n/(n−fr)] / (−z_view)
  ```

  which means depth precision is concentrated near the near plane and evaporates far away.
  Halving the near plane halves your usable far-field precision. This is why **reversed-Z**
  (map near → 1.0, far → 0.0, use a float32 depth buffer with `GREATER` comparison and
  clear to 0) is now standard: float32 has its dense mantissa near 0, `1/z` puts the
  precision-hungry region there, and the two errors cancel almost exactly.

**Viewport transform.** NDC → pixels:

```
 x_screen = (ndc.x · 0.5 + 0.5) · width  + x_offset
 y_screen = (ndc.y · 0.5 + 0.5) · height + y_offset      [OpenGL, y up]
 y_screen = (0.5 − ndc.y · 0.5) · height + y_offset      [D3D/Vulkan, y down]
 z_window = ndc.z · (far_range − near_range) + near_range
```

The result is **snapped to a fixed-point subpixel grid** — [GIESEN-5] notes D3D11 uses
8 subpixel bits, i.e. 1/256 pixel. From here on the rasteriser is **pure integer
arithmetic**, which is essential: it makes the fill rule exact, makes shared edges
watertight, and makes the hardware cheap.

**A worked example the curriculum can assert against.** Identity model and view; camera at
the origin looking down −z; fovy = 90° so `f = 1/tan(45°) = 1`; aspect = 1; near = 1;
far = 100; viewport 800×800, OpenGL conventions.

| view-space point | clip (x, y, z, w) | NDC | screen |
|---|---|---|---|
| (0, 0, −10, 1) | (0, 0, 8.181818…, 10) | (0, 0, 0.818181…) | (400.0, 400.0), z_win 0.909090… |
| (10, 0, −10, 1) | (10, 0, 8.181818…, 10) | (1.0, 0, …) | x = 800.0 exactly (right edge) |
| (0, 5, −10, 1) | (0, 5, 8.181818…, 10) | (0, 0.5, …) | y = 600.0 |

Check the arithmetic by hand once: `(fr+n)/(n−fr) = 101/−99 = −1.020202…`,
`2·fr·n/(n−fr) = 200/−99 = −2.020202…`, so `z_clip = (−1.020202)(−10) + (−2.020202) =
8.181818…`, and `w = 10`. The `(10, 0, −10)` case is the geometric sanity check: a 90°
field of view means the frustum's side planes are at 45°, so a point 10 units right and
10 units forward lands exactly on the edge of the screen.

## 2.4 Clipping and culling

There are four distinct rejection mechanisms and they happen at four different places.
Conflating them is a common curriculum error.

**Frustum culling (application level).** Before you even submit a draw, test object
bounding volumes against the frustum planes on the CPU (or in a compute shader) and skip
whole objects. Cheapest possible win; entirely software.

**Clipping (fixed function, pre-divide).** Triangles crossing a frustum plane must be cut
into a polygon and re-triangulated, because you cannot rasterise something with a vertex
behind the eye. In practice **this almost never runs**: [GIESEN-5] describes **guard-band
clipping**, "a straight-forward way of not doing clipping." The rasteriser's fixed-point
coordinate range extends well beyond the viewport, so triangles hanging off the left,
right, top or bottom are simply rasterised with most of their pixels falling outside the
scissor rectangle and discarded for free. Real clipping is reserved for the **near plane**
(where `w` would change sign, which is genuinely unrecoverable) and for the rare triangle
so large it would overflow the fixed-point range. Cohen–Sutherland outcodes are computed
per vertex to test the trivial-reject and trivial-accept cases first.

**Backface culling (fixed function, post-divide, screen space).** Compute the signed area
of the screen-space triangle — equivalently the z-component of the cross product of two
edge vectors, equivalently the sign of the full edge function determinant:

```
 2·Area = (x₁−x₀)(y₂−y₀) − (y₁−y₀)(x₂−x₀)
```

Negative (or positive, depending on the winding convention and the y-axis direction) →
the triangle faces away → discard. This throws away roughly half of a closed mesh's
triangles for the cost of one cross product, which is why it is one of the highest-value
fixed-function blocks in the chip. Note it must be done **after** the perspective divide,
in screen space — winding in view space is not the same thing under perspective.

**Occlusion culling / hierarchical Z (fixed function, per tile).** [GIESEN-7] describes
the hardware: a dedicated on-chip SRAM stores, per screen tile, the **maximum** depth in
that tile (for a `LESS` comparison). Triangle setup computes the **minimum** depth of the
incoming triangle within each tile it touches. If the triangle's minimum exceeds the
tile's stored maximum, the entire tile's worth of fragments is rejected before any of
them is generated. It is "strictly conservative" — it may fail to reject something it
could have, but it never wrongly rejects. Giesen sizes the SRAM at roughly 128 KB for a
2048×2048 target.

The application-level counterpart is **occlusion queries** and **GPU-driven culling**:
render a depth prepass or a coarse depth pyramid, then in a compute shader test each
object's bounding box against the Hi-Z pyramid and compact the surviving draws into an
indirect draw buffer. This is the standard modern technique and it is *pure compute work
serving graphics* — a nice foreshadowing of §5.

## 2.5 The rasteriser — how a triangle becomes fragments

**Edge functions.** The modern algorithm (Pineda, *A Parallel Algorithm for Polygon
Rasterization*, SIGGRAPH 1988 — see §8 on verification) evaluates three linear functions,
one per edge:

```
 E₀₁(x, y) = (x − x₀)(y₁ − y₀) − (y − y₀)(x₁ − x₀)
 E₁₂(x, y) = (x − x₁)(y₂ − y₁) − (y − y₁)(x₂ − x₁)
 E₂₀(x, y) = (x − x₂)(y₀ − y₂) − (y − y₂)(x₀ − x₂)
```

A point is inside iff all three have the same sign (consistent with the triangle's
winding). [GIESEN-6] puts it as: "*the signed distance to a line can be computed with a 2D
dot product (plus an add)*," and each is of the form `E(X,Y) = aX + bY + c` with per-triangle
constants.

**Why this and not scanlines.** Two properties, and they are the whole reason:

1. **It is incremental.** `E(x+1, y) = E(x, y) + a` and `E(x, y+1) = E(x, y) + b`. One add
   per pixel per edge.
2. **It is embarrassingly parallel and order-free.** You can evaluate `E` at 64 pixels
   simultaneously with 64 adders, in any order, with no loop-carried dependency. A scanline
   algorithm has a sequential dependency along each span. **Edge functions are the reason
   the rasteriser can be a wide parallel block instead of a state machine.**

**Barycentric coordinates fall out for free.** The three edge functions, normalised by the
total signed area, *are* the barycentric coordinates:

```
 λ₀ = E₁₂ / E_total,   λ₁ = E₂₀ / E_total,   λ₂ = E₀₁ / E_total,   λ₀+λ₁+λ₂ = 1
```

So the same hardware that determines coverage also produces the interpolation weights.
[GIESEN-8] notes modern hardware computes barycentrics in a dedicated unit and the shader
cores do the per-attribute multiply-adds.

**The top-left fill rule and watertightness.** A pixel centre lying exactly on a shared
edge belongs to exactly one of the two triangles, or you get either a double-shaded seam
(visible with blending) or a hole (visible always). Both D3D and OpenGL specify the
**top-left rule**: a pixel on an edge is covered if that edge is a "top" edge (exactly
horizontal and above the interior) or a "left" edge (going down on the left side). Both
[GIESEN-6] and the D3D spec require this "*to ensure watertight rasterization*." In an
implementation it is one bias of `−1` applied to the initial edge value for non-top-left
edges, in fixed point. **This is only exactly correct because the coordinates are integer
fixed-point.** In floating point, "on the edge" is not a well-defined predicate and
watertightness is impossible. That is a strong argument for the fixed-point snap.

**Hierarchical rasterisation.** [GIESEN-6] describes a two-level scheme:

- **Coarse rasteriser**: test 8×8 (or similar) *tiles* against the edge equations using
  interval arithmetic on the tile corners — reject entirely-outside tiles, accept
  entirely-inside tiles wholesale, and forward only the boundary tiles.
- **Fine rasteriser**: evaluate per-pixel inside promising tiles, produce coverage masks
  and **2×2 quads**.

This is why long thin sliver triangles are pathological: they touch many tiles while
covering few pixels, so the coarse stage rejects almost nothing and the fine stage does
almost no useful work.

## 2.6 Why fragments are shaded in 2×2 QUADS — the load-bearing fact

**The mechanism.** [GIESEN-8]: the fine rasteriser emits **2×2 pixel quads**, and
"*each pixel has both a horizontal and vertical neighbor within the same quad; this can be
used to estimate the derivatives of parameters in the x and y directions using finite
differencing.*"

**The reason.** Every texture sample needs to know how fast the texture coordinate is
changing across the screen, so it can choose a mipmap level (§3.2). That is a derivative
`∂u/∂x`, `∂u/∂y`, `∂v/∂x`, `∂v/∂y`. A shader is a per-pixel program with no analytic
knowledge of its own derivative. The only cheap way to get one is a **finite difference
against your neighbour**:

```
 ddx(u) = u[lane ^ 1] − u[lane]        (horizontal neighbour in the quad)
 ddy(u) = u[lane ^ 2] − u[lane]        (vertical neighbour in the quad)
```

Two subtractions and a cross-lane read. The alternative — computing analytic derivatives
through arbitrary shader arithmetic — would require the shader to carry a dual-number or
be differentiated by the compiler, at enormous cost. So: **shade in 2×2 blocks, and get
derivatives for free.**

This is exposed to the programmer as `ddx`/`ddy` (HLSL), `dFdx`/`dFdy` (GLSL), and
implicitly by every `Sample()` / `texture()` call, which computes the derivatives for you.
The `SampleGrad` / `textureGrad` variants exist for when the implicit derivative is wrong
(inside non-uniform control flow) and you must supply your own — because the hardware
would otherwise finite-difference values from lanes that took a different branch.

**Helper lanes.** A quad is shaded as a unit even when the triangle covers only one of its
four pixels. The three uncovered pixels are executed as **helper lanes** (also "helper
pixels" or "helper invocations"): they run the full shader, they generate memory traffic,
they consume ALU cycles, and their results are thrown away — but they must run, because
the covered pixel needs their interpolated values to compute its derivative.

**The waste.** [GIESEN-8] states it directly: "*between 25–75% of the shading work for
quads generated for triangle edges is wasted.*" The floor is 25% efficiency (one covered
pixel in a quad) and in the pathological straddling case it can be worse. This has three
consequences that a curriculum should draw out:

1. **Small triangles are catastrophically inefficient.** A useful approximate model: for
   a triangle of screen area `A` pixels and perimeter `P` pixels, the number of quads
   touched is roughly `A/4 + P/2`, so shading efficiency ≈ `A / (A + 2P)`. For an
   equilateral triangle of side `s` (`A = 0.433 s²`, `P = 3s`), efficiency ≈ `s/(s + 13.9)`:

   | side s (px) | approx. quad efficiency |
   |---|---|
   | 8 | 0.37 |
   | 16 | 0.54 |
   | 32 | 0.70 |
   | 64 | 0.82 |
   | 128 | 0.90 |

   *(This model is the author's own approximation, not a sourced figure — it is asymptotic
   and breaks down below s ≈ 8 where the discrete quad grid dominates. It is offered as a
   sanity target for the empirical exercise in §7, not as a fact.)*

2. **This is why micro-triangles are the modern rendering crisis.** Once triangles are
   smaller than a quad, you approach 25% efficiency *plus* per-triangle setup cost
   dominating, and this is precisely why Unreal's Nanite **software-rasterises** small
   triangles in a compute shader — the fixed-function rasteriser's quad granularity stops
   paying for itself. That is the full circle: graphics work moving back onto the general
   machine that graphics work created.

3. **You cannot turn quads off.** [GIESEN-8] is explicit: quad granularity "*is part of
   the design of most fixed-function blocks in the pipeline*" — the rasteriser, the depth
   test, the attribute storage, and the blend hardware all assume it. Removing it would
   require redesigning all of them for a modest win.

**And now the compute consequence, which is the whole point of this report.**
[TESLA], on the G80 SM: "*The basic unit of pixel-fragment shader processing is the 2×2
pixel quad. The SM controller groups eight pixel quads into a warp of 32 threads.*"

**A warp is eight quads. 32 = 8 × 4.** The warp is not a number someone picked; it is the
pixel quad, replicated eight times to fill an instruction issue slot. Every CUDA
programmer who has memorised "warp size is 32" has memorised a fact about *mipmap
selection*.

## 2.7 Early-Z vs late-Z, and what disables early-Z

[GIESEN-7] describes the two Z/stencil blocks:

- **Early-Z**: runs immediately after rasterisation, *before* the fragment shader.
  Occluded fragments are killed without ever entering the shader. This is the difference
  between shading 3× overdraw and shading 1× overdraw.
- **Late-Z**: runs after the shader, in the ROP. Always present, because it is where the
  correctly-ordered read-modify-write happens.

Giesen's motivating line is the right one for a lecture: you "*really, really don't want to
completely shade*" a fragment only to discard it.

**Exactly what disables early-Z**, per [GIESEN-7]:

1. **The shader writes depth** (`SV_Depth` / `gl_FragDepth`). The hardware cannot test a
   depth value the shader has not computed yet. *Partial escape hatch:* D3D11's
   `SV_DepthGreaterEqual` / `SV_DepthLessEqual` and GLSL's `layout(depth_greater)` let you
   promise the shader will only push depth in one direction, which keeps a conservative
   early test alive.
2. **The shader can `discard`** (`discard` / `clip()` / `demote`). The fragment might not
   survive, so the depth buffer cannot be *updated* early — though the early *test* can
   often still run (early-Z-test without early-Z-write). This distinction matters: alpha
   -tested foliage still gets early rejection, it just cannot early-write.
3. **Alpha test** — the fixed-function ancestor of `discard`, same reason.
4. **Alpha-to-coverage** — the alpha value modulates the MSAA sample mask, so coverage is
   shader-dependent.
5. Also, in practice: **unordered access writes (UAV/SSBO/`imageStore`) from the fragment
   shader** with side effects the driver must preserve, and some uses of
   `SampleIndex`/per-sample execution. *(This last item is established practice and vendor
   guidance rather than something [GIESEN-7] states; see §8.)*

D3D11.3/D3D12 and Vulkan give you back a manual override:
`[earlydepthstencil]` in HLSL, `layout(early_fragment_tests) in;` in GLSL — "I promise the
discard doesn't matter, run the test early anyway." Using it wrongly produces subtly wrong
depth.

**Ordering.** [GIESEN-7] also notes that for `LESS`/`LEQUAL` comparisons "*it's very
important what order the pixels arrive in*," so primitive order must be preserved from
primitive assembly all the way to the depth/blend units.

## 2.8 The fragment/pixel shader

Inputs: interpolated attributes (perspective-correct by default; `noperspective` and
`flat` qualifiers exist), `SV_Position`/`gl_FragCoord`, front-face flag, sample index.
Outputs: one or more render-target colours, optionally depth, optionally coverage.

**Perspective-correct interpolation.** Because the perspective divide is non-affine, an
attribute cannot be interpolated linearly in screen space. The correct procedure:

```
 during setup, for each vertex: store attr/w and 1/w
 during raster, interpolate both linearly in screen space using barycentrics:
     numer = λ₀·(a₀/w₀) + λ₁·(a₁/w₁) + λ₂·(a₂/w₂)
     denom = λ₀·(1/w₀)  + λ₁·(1/w₁)  + λ₂·(1/w₂)
 per fragment: attr = numer / denom
```

One reciprocal per fragment, shared across all attributes. Omitting this is the PlayStation
1's characteristic swimming textures — the PS1 had no `w` in its rasteriser at all.

**Where the shader runs.** In a unified architecture, on the same SM as everything else,
as a warp of eight quads. The SM does not know or care that it is shading pixels; the
distinction lives in the SM controller that assembles the warps and routes the outputs.
[TESLA]: "*the unified SM concurrently executes different thread programs and different
types of shader programs.*"

## 2.9 Blending and the ROPs

**ROP** = Render Output unit / Raster Operations Processor — [GIESEN-9] notes the name
"*dating back to 2D hardware acceleration and bit-blitting operations*," which is a nice
historical detail: the ROP predates 3D entirely.

The ROP's job [GIESEN-9] is to "*fold that large number of independent computations back
into one (correctly ordered) stream of memory operations*." It performs:

- late Z/stencil test and update,
- blending: `dst = src·srcFactor OP dst·dstFactor` with a fixed menu of factors and ops,
- render target write, with format conversion (sRGB encode, float→unorm),
- MSAA sample handling and compression.

**Why blending is fixed function** [GIESEN-9], three reasons worth teaching:

1. **Area/power**: die spent on a blend ALU only helps the last stage; die spent on shader
   ALUs helps everything.
2. **Latency, not throughput**: this stage runs strictly in order, so you cannot trade
   latency for throughput the way the shader cores do. Short predictable latency is the
   requirement.
3. **Bandwidth**: it is a read-modify-write on every surviving fragment, so it must live
   next to the memory controller.

Giesen also explains why the two obvious "programmable blending" designs fail: letting the
fragment shader read the framebuffer creates hazards against pixels currently in flight
elsewhere (requiring enormous tracking structures or lockstep execution); putting a full
shader core in the ROP costs area and power for modest gain. **The exception proves the
rule: on tile-based GPUs, programmable blending is easy and Metal exposes it** — because
the destination colour is sitting in on-chip tile memory that only this tile's fragments
can touch (§3.6).

**Ordering mechanisms** [GIESEN-9]:

- Shaded quads are **buffered and sorted back into API order** by primitive ID before the
  ROP. Non-overlapping quads from the *same* primitive can never conflict, so the sort key
  is coarse.
- The ROP **prefetches** framebuffer and depth data for a tile as soon as rasterisation
  knows which pixels it will produce, so the read half of the read-modify-write is already
  done when the shader finishes.
- Each ROP **owns a region** of the render target — [TESLA]: "*Each ROP is paired with a
  specific memory partition... so ROP memory traffic originates locally.*" Two ROPs never
  contend for the same address, so no inter-ROP synchronisation is needed at all.

That last point is the ancestor of GPU atomics (§3.4).

**DRAM shapes the tile traversal.** [GIESEN-9]: a DRAM burst of 512 bits holds exactly 16
pixels at 32 bpp, which is why the rasteriser traverses in hierarchical tiles and why
render targets are stored in non-linear (tiled/swizzled) layouts. The pixel visit order is
chosen to keep DRAM pages open.

## 2.10 The depth and stencil buffers

**Depth buffer.** One value per sample, storing `z_window`. Formats: `D16_UNORM`,
`D24_UNORM_S8_UINT`, `D32_FLOAT`, `D32_FLOAT_S8X24_UINT`. The `1/z` distribution (§2.3)
plus reversed-Z plus float32 is the modern standard.

**Compression** [GIESEN-7]: depth is losslessly compressed by storing *plane equations*
for tiles covered by one or few triangles rather than per-pixel values — depth across a
triangle is exactly linear in screen space (unlike attributes!), so a plane equation is
exact. Compression flags (1–3 bits per tile) live in a dedicated SRAM. Fast clears are a
special case: a constant-value plane equation.

**Stencil buffer.** An 8-bit-per-pixel side channel with its own test (compare against a
reference under a mask) and its own update operations (keep / zero / replace /
increment / decrement / invert, separately for stencil-fail, depth-fail, and pass). It is
a general-purpose per-pixel tag, and the classic uses — shadow volumes, portals, decals,
outline rendering, deferred-shading material masks — all boil down to "mark these pixels
now, restrict a later pass to them." Architecturally it shares its memory allocation and
its compression machinery with depth, which is why `D24S8` is a single interleaved surface
on most hardware and why touching stencil can cost you depth compression.

## 2.11 The newer stages: tessellation, geometry shaders, mesh/task shaders

**Tessellation (DirectX 11, 2009; OpenGL 4.0, 2010).** Three pieces:

- **Hull shader** (D3D) / **tessellation control shader** (GL): runs per patch control
  point, and additionally emits per-edge and per-interior **tessellation factors**.
- **Tessellator**: fixed-function. Takes the factors and emits a topology of barycentric
  coordinates (or (u,v) for quad/isoline domains) — a purely combinatorial subdivision
  pattern with no knowledge of the geometry.
- **Domain shader** (D3D) / **tessellation evaluation shader** (GL): runs per generated
  vertex, evaluates the surface (Bézier patch, PN triangle, displacement map) at that
  barycentric coordinate to produce a real position.

The key design decision is that **amplification is done by fixed function, not by a
shader**. The programmable parts are 1-in-1-out; only the fixed-function tessellator has
variable output. This is exactly the mistake the geometry shader made, and the reason
tessellation performs acceptably where geometry shaders do not. Its limitation, as
[TURING] puts it, is that tessellation is "*limited to fixed tessellation patterns*."

**Geometry shaders (DirectX 10, 2006) — and why they were a performance trap.**

A geometry shader runs per primitive and may emit zero, one, or many primitives. That
sounds like the most useful stage in the pipeline. It was a trap, and [GIESEN-10] explains
precisely why:

1. **Variable-size output destroys the buffering model.** A vertex shader is 1-in-1-out, so
   you can allocate output space up front. A GS output count is unknown until it runs, so
   the hardware needs an output buffer of *worst-case* size per invocation, plus an extra
   primitive assembly stage to turn the emitted vertex stream back into primitives. That is
   "two more buffering stages."
2. **Ordering forces a serialising scan.** API order must be preserved: all primitives from
   invocation 0, then all from invocation 1. Since output counts are unknown in advance,
   the hardware must *scan* the output data to find where each invocation's primitives
   start before clipping and setup can proceed.
3. **Occupancy collapses.** GPUs want 16–64 independent jobs per batch; a batch of 11 GS
   invocations each producing ~8 vertices runs "at low utilization" for a long time.
4. **The empirical cost is brutal.** [GIESEN-10]: a *pass-through* GS that does nothing at
   all measured "*between 3x and 7x slower than no GS at all*" in a geometry-limited
   scenario on early D3D10 hardware.

D3D11 added **GS instancing** (multiple GS invocations per input primitive) to recover some
parallelism, but the stage never became a good idea. The lesson generalises far beyond
graphics and is worth stating in the curriculum: **a programmable stage whose output size
is data-dependent is very hard to make fast on a machine whose whole model is
statically-sized, statically-scheduled parallel batches.** The same principle explains why
dynamic parallelism in CUDA is expensive and why persistent-thread work-queue kernels are
usually written by hand.

**Mesh and task shaders (Turing, 2018; DX12 Ultimate; `VK_EXT_mesh_shader`).**

The modern answer. [TURING] and NVIDIA's introductory blog describe the model:

- A **mesh shader** replaces vertex + hull + tessellator + domain + geometry with a single
  **cooperative thread group** — "*instead of using a single-thread program model, it uses a
  cooperative thread model similar to compute shaders*" [TURING]. The workgroup cooperatively
  fetches whatever it likes, computes vertices however it likes, and writes an output block
  of vertices and a primitive index list directly for the rasteriser.
- A **task shader** (amplification shader in DX12) runs ahead of it, also as a cooperative
  workgroup, and decides *how many* mesh shader workgroups to launch — up to 64K per task
  workgroup. This is where LOD selection, cluster culling, and dynamic amplification live.
- **Meshlets** are the unit: pre-baked clusters of "*up to 64 vertices and 126 primitives*"
  with their own local index list, giving ~75% of the original index buffer size and, more
  importantly, a cluster granularity you can cull as a unit (bounding sphere + normal cone
  backface cone test) before fetching any vertex data.

What is removed: the **primitive distributor**, a fixed-function block that "*scanned the
indexbuffer*" and "*created vertex batches*" on every draw "*even if the topology doesn't
change*" [NVIDIA mesh shader blog]. Also removed: fetching vertex attributes for geometry
that is about to be culled anyway, and the CPU draw-call-per-object bottleneck.

**Note the direction of travel.** Tessellation moved amplification into fixed function
because shaders were bad at it. Mesh shaders move it back into a *compute-style* shader,
because by 2018 the shader cores had a cooperative thread group model with shared memory
and barriers — which they got from **compute**, which they got from **CUDA**, which they
got from the unified shader architecture, which they got from graphics. The loop closes.

---

# Part 3 — Where the hardware shape comes from

This is the section the curriculum needs. Each item states the **graphics origin** and the
**compute consequence**, explicitly.

## 3.1 Quad-based fragment shading → the warp, and divergence as a spatial phenomenon

**Graphics origin.** Mipmap selection needs `∂u/∂x`. A shader cannot differentiate itself.
The cheapest derivative is a finite difference against a screen-space neighbour. Therefore
fragments are shaded in 2×2 quads, with uncovered pixels executed as helper lanes purely to
supply the difference [GIESEN-8]. Quad granularity is then baked into the rasteriser, the
depth test, the interpolators and the blend hardware, so it cannot be removed [GIESEN-8].

**Compute consequence, four parts:**

1. **The warp exists because the quad exists.** [TESLA]: "*The SM controller groups eight
   pixel quads into a warp of 32 threads.*" Thirty-two is 8 × 4. The same paper notes the SM
   controller "*similarly groups vertices and primitives into warps and packs 32 computing
   threads into a warp*" — i.e. compute threads were fitted into the *existing* pixel-quad
   batching machinery. Warp size 32 is not a compute design decision. AMD's wave64 is 16
   quads and wave32 is 8; Intel's GPUs dispatch fragment shaders in SIMD8/SIMD16/SIMD32
   modes, which is the same knob made explicit. *(The AMD and Intel mappings are established
   architecture knowledge, not re-verified in this pass — see §8.)*

2. **Free cross-lane communication was already in the hardware.** `ddx`/`ddy` requires the
   lanes of a quad to read each other's registers. That register-file crossbar, built for
   derivatives, is the direct ancestor of `__shfl_sync()` (CUDA, exposed in Kepler, 2012),
   AMD's DPP/`ds_swizzle`, and Vulkan/D3D **subgroup quad operations**
   (`subgroupQuadSwapHorizontal`, `QuadReadAcrossX`). The quad even survived *into compute*:
   Shader Model 6.0 quad intrinsics and `VK_KHR_shader_subgroup` quad ops let a compute
   shader take derivatives, and DirectX SM 6.6 / Vulkan 1.3 expose `ddx`/`ddy` in compute
   for exactly this reason.

3. **Divergence is spatial, and that is why it is modelled the way it is.** In a fragment
   shader, two lanes diverge when a *triangle edge runs between two adjacent pixels*, or
   when a branch keys on a screen-space or texture-space property that varies over a
   2×2 neighbourhood. Coherent shading means *spatially coherent* shading. The whole
   intuition that "divergence is bad and coherence is good" was learned in a domain where
   coherence is a geometric property of the screen. CUDA inherited that penalty structure —
   a warp executes both sides of a branch with lanes predicated off — and inherited the
   optimisation advice ("sort your work so that neighbouring threads take the same path")
   directly from "sort your draws so that neighbouring pixels take the same path."

4. **Helper lanes are the original inactive-but-executing lane.** A helper pixel runs the
   shader, issues memory traffic, occupies an ALU slot, and has its result discarded. That
   is precisely the semantics of a predicated-off lane in a divergent CUDA warp. When a
   student asks "if half the warp is masked off, does it still cost full time?" — yes, and
   the reason the hardware is comfortable with that is that it has been doing it at
   triangle edges since 1999.

## 3.2 Texture units and the texture cache → 2D locality, and the `__ldg` path

**Graphics origin.** Consider the access pattern. A quad's four fragments sample a texture
at four nearby coordinates; each bilinear sample reads a 2×2 texel neighbourhood. So the
access pattern is a small 2D blob, and the blob for the next quad is an adjacent small 2D
blob. It is **2D-coherent, not linearly streaming**. Everything follows:

- **Memory layout is swizzled.** Textures are stored in Morton / Z-order curves or in
  vendor-specific block-tiled layouts so that a 2D neighbourhood lands in one cache line
  and one DRAM page. A linear (row-major) layout would put the pixel above you an entire
  row-stride away — a guaranteed miss.
- **The L1 texture cache is tiny.** [GIESEN-4] gives **4–8 KB per sampler**, and explains
  why bigger doesn't help: with mipmapping at a roughly 1:1 texel-to-pixel ratio you get
  about "*1.25 misses/request*" across a wide range of cache sizes. Mipmapping *normalises
  the working set* — that is its second, less-famous job. The cache only needs to hold the
  immediate 2D neighbourhood.
- **The cache fill path does decompression and format conversion.** BC1–BC7 block-compressed
  blocks are expanded, and sRGB→linear conversion happens, on the way *into* the cache
  [GIESEN-4]. So the cache stores decoded texels; compression saves DRAM bandwidth and
  capacity, not cache capacity.
- **Filtering is fixed-function silicon.** Bilinear: 4 texel fetches, 3 lerps, in a
  multiply-accumulate array. Trilinear: two bilinears plus one lerp between mip levels =
  8 texels. Anisotropic: analyse the gradient vectors, find the major axis of the projected
  pixel footprint, take N samples along it and blend. [GIESEN-4] on aniso: vendors
  "*converge on something pretty damn good at reasonable hardware cost*" after years of
  tuning.
- **The request is fat.** [GIESEN-4] notes a 2D `SampleGrad` request is six floats (u, v,
  plus four gradients), and a cubemap-array gradient sample can be ten values (40 bytes) —
  "*probably more than you thought*."

**Mipmaps, and why they exist.** Two reasons, and the second is the one usually skipped:

1. **Correctness / aliasing.** A pixel is a finite area; the texture signal under it may
   have arbitrarily high frequency. Point-sampling one texel per pixel undersamples and
   aliases — the shimmering crawl on a receding checkerboard floor. A mip chain is a
   prefiltered pyramid: level *k* is a 2^k-box-filtered version. Selecting a level whose
   texel size matches the pixel footprint band-limits the signal before sampling.
2. **Performance / cache behaviour.** Sampling a 4096² texture minified into 10 screen
   pixels touches texels scattered across 64 MB. Sampling the appropriate mip level touches
   a contiguous 2D neighbourhood in a few hundred bytes. **Mipmapping is a bandwidth and
   cache optimisation as much as an antialiasing one**, which is why it is essentially free
   in practice despite adding 33% to texture storage (`1 + 1/4 + 1/16 + ... = 4/3`).

The selection formula (OpenGL specification form), from the quad derivatives, in texel
units (`W`, `H` = texture dimensions at level 0):

```
 ρ = max( sqrt((∂(uW)/∂x)² + (∂(vH)/∂x)²),
          sqrt((∂(uW)/∂y)² + (∂(vH)/∂y)²) )
 λ = log₂(ρ) + lodBias
```

Nearest-mip takes `floor(λ + 0.5)`; trilinear blends `floor(λ)` and `floor(λ)+1` with
weight `frac(λ)`. Anisotropic filtering computes the *ratio* of the major to minor axis of
the footprint ellipse, takes `N = min(ceil(ρ_max/ρ_min), maxAniso)` samples along the major
axis at level `log₂(ρ_max/N)`, and averages — which is why aniso keeps ground textures
sharp at grazing angles where trilinear picks a level based on the worst axis and blurs
everything.

**Compute consequence.** The texture unit is a **second, independent, read-only road to
memory**, with its own cache, that does not go through the shader core's load/store unit
and does not dirty a write-back L1. When NVIDIA exposed it to CUDA it became one of the
more useful tuning tools in the language:

- **`__ldg()`** and the **read-only data cache**. Kepler (2012) exposed the texture cache
  as a general read-only cache for global loads. `__ldg(ptr)` routes a load through it;
  the compiler will do it automatically for pointers marked `const __restrict__` (proving
  the data is neither written nor aliased for the kernel's lifetime, which is exactly the
  guarantee a texture provides by construction). On Maxwell and later the read-only path
  and the L1 were unified, and `__ldg` became more of a hint, but the *reason it existed*
  is that graphics needed a read-only cache and the silicon was sitting there. *(The Kepler
  read-only cache capacity commonly quoted as 48 KB was not re-verified in this pass — §8.)*
- **CUDA texture objects** (`cudaTextureObject_t`, `tex2D<float>()`) give you, for free:
  hardware bilinear interpolation, `wrap`/`clamp`/`mirror`/`border` addressing, normalised
  coordinates, and automatic format conversion. This is why texture-fetch interpolation is
  still standard in medical image registration, CFD interpolation, and any kernel doing
  table lookup with interpolation — the interpolation is free silicon. Note the caveat: the
  hardware bilinear weights are only **9-bit fixed point** (8 fractional bits), so it is a
  low-precision interpolator; that is a graphics tolerance leaking into a compute API.
- **`cudaArray` and `cudaMemcpy2DToArray` exist because the layout is swizzled.** You
  cannot simply point a texture object at linear device memory and get the 2D-locality
  benefit; the driver copies into an opaque, hardware-swizzled layout. This is the clearest
  possible evidence that the texture cache's advantage is *layout*, not size.
- **Surfaces** (`surf2Dwrite`) are the writable counterpart, and are exactly the graphics
  render-target path.

**And a general lesson for the curriculum:** if your compute kernel has 2D or 3D spatial
locality — a stencil, a convolution, an image filter — the memory layout that a GPU wants
is the one the texture unit wants: tiled, not row-major. This is why tiling/blocking a
matrix or a stencil is not just a cache-blocking trick; it is aligning your data with the
shape the machine was built for.

## 3.3 Massive latency hiding → the register file, occupancy, and the whole performance model

**Graphics origin.** [GIESEN-4]: texture sampler pipelines are "*remarkably long*," designed
to sustain memory reads taking "*400–800 cycles*" without stalling. And a fragment shader
does several such fetches. On a latency-oriented machine this would be catastrophic. But
the renderer has an inexhaustible supply of independent fragments: there are millions per
frame and none of them talk to each other. So the design is: **do not reduce the latency,
hide it, by having so much resident work that there is always another warp ready to issue.**

[TESLA] on the G80 SM: it "*manages and executes up to 768 concurrent threads in hardware
with zero scheduling overhead*," with "*lightweight thread creation, zero-overhead thread
scheduling, and fast barrier synchronization.*" And the paper's list of the throughput
workload's defining properties includes, verbatim, "*latency tolerance — performance is the
amount of work completed in a given time.*"

**Compute consequence.** This is the *entire* GPU performance model, and it explains the
things students find most arbitrary:

- **Why the register file is enormous.** A modern SM has a 256 KB register file — larger
  than its L1. It is that large because register state for *every resident thread* must be
  held simultaneously; a warp switch must cost zero cycles, so nothing can be saved and
  restored. The register file is not a cache, it is a **context store for hundreds of
  simultaneous threads**. That design exists because graphics needed hundreds of
  simultaneous fragments in flight to cover texture latency.
- **Why occupancy is a metric at all.** Occupancy = resident warps / maximum resident warps.
  It has no CPU analogue. It exists because latency hiding is *your* job as the programmer:
  use too many registers or too much shared memory per block and fewer blocks fit, fewer
  warps are resident, and there is no longer another warp to switch to when one stalls.
  Occupancy is the graphics latency-hiding budget, exposed.
- **Why the tuning knob is arithmetic intensity, not latency.** You cannot make a memory
  access faster on a GPU. You can only make sure something else is running while it happens,
  or issue fewer of them. Hence the roofline model, hence tiling into shared memory, hence
  `cp.async` and TMA in later generations — every one of which is a way of keeping the
  machine fed rather than making any individual operation quick.
- **Why the GPU has no meaningful branch predictor, no speculation, and no out-of-order
  execution.** All three are latency-hiding mechanisms for a machine with *one* instruction
  stream. When you have 48 warps resident, they are wasted transistors. The GPU deleted a
  CPU's most expensive machinery and spent the budget on registers and ALUs, because
  graphics told it that was the right trade.

## 3.4 Interpolators, ROPs, and why GPU atomics have the character they do

**Graphics origin (interpolators).** Between the rasteriser and the fragment shader,
per-vertex attributes must become per-fragment values, perspective-correctly (§2.8).
[GIESEN-8]: modern hardware computes barycentrics in a dedicated unit and the shader cores
evaluate attributes with multiply-adds. Older hardware had fully fixed-function
interpolators; the trend has been to move the work into the shader (a "pull model" where
the shader fetches barycentrics and does the MADs itself), which is another instance of
fixed function dissolving into the general machine. The residue in modern APIs is
`SV_Barycentrics` / `gl_BaryCoordEXT`, which hands the shader the weights directly.

**Graphics origin (ROPs).** The ROP is a **read-modify-write engine, in submission order, at
full pixel rate, bolted to a memory partition** [GIESEN-9, TESLA]. It reads the depth and
colour at a pixel, computes, writes back. To make that scale, [TESLA]: "*Each ROP is paired
with a specific memory partition... so ROP memory traffic originates locally.*" Address
space is statically partitioned across ROPs, so two ROPs never touch the same address and
no synchronisation between them is required.

**Compute consequence — GPU atomics are not CPU atomics.** [GIESEN-13] draws the contrast
directly:

- A **CPU atomic** works through the cache coherence protocol. The core acquires exclusive
  ownership of the 64-byte cache line, performs the operation, and other cores' accesses to
  that line serialise behind it. Consequences: false sharing (two unrelated variables in one
  line contend), and cost proportional to how far the line has to travel.
- A **GPU atomic** is executed by **dedicated atomic units that bypass the shader cores
  entirely** and sit at the shared cache / memory partition. They perform the
  read-modify-write on cached data in place, hashing by address to block competing accesses
  to the same address [GIESEN-13]. The value never comes to the SM unless you asked for a
  return value.

Everything odd about GPU atomics follows:

1. **No false sharing.** The granularity of contention is the *address*, not the cache line,
   because the operation happens at the cache and is keyed by address hash. [GIESEN-13]
   notes this avoids a problem the application cannot control anyway, since neither the line
   size nor the runtime memory layout is under its control.
2. **They scale with memory partitions.** Independent addresses hash to different atomic
   units and proceed in parallel. Thousands of threads incrementing thousands of different
   counters is nearly free; thousands incrementing *one* counter serialises at one unit —
   which is why **warp-aggregated atomics** (have one lane in the warp do a single
   `atomicAdd` of the warp's total, then `__shfl` the base back) are worth 10–30× on a
   histogram or a compaction, and why NVCC now does this transformation automatically for
   simple cases.
3. **Fire-and-forget is cheaper than fetch-and-op.** PTX distinguishes `atom.global.add`
   (returns the old value) from `red.global.add` (a *reduction*, returns nothing). The
   latter needs no round trip to the SM, so it can be pipelined like any other store. In
   CUDA C++ you get this by ignoring the return value of `atomicAdd` and trusting the
   compiler to emit `red`. This distinction exists because the ROP's blend is a
   fire-and-forget RMW.
4. **Shared-memory atomics are a different animal.** `atomicAdd` on `__shared__` executes
   inside the SM, not at the memory partition, and descends from the compute-shader
   TGSM/UAV design rather than from the ROP. It is much lower latency but contends within
   one SM. Knowing which of the two you are using is a real tuning decision.
5. **Ordering is not free but is cheap.** [GIESEN-13] describes three barrier flavours in a
   compute shader — group sync (wait for all warps), group memory barrier (flush the shared
   pipeline), device memory barrier (stall on external memory, "600+ cycle latencies"). Those
   are `__syncthreads()`, `__threadfence_block()`, and `__threadfence()`.

There is one more graphics fossil worth naming: **raster order groups** /
`VK_EXT_fragment_shader_interlock` / D3D12 ROVs give a fragment shader mutually-exclusive,
API-ordered access to a pixel. That is the ROP's ordering guarantee handed to a programmable
shader, and it is the closest thing the GPU has to a per-address critical section.

## 3.5 The historical arc: fixed function → register combiners → programmable → unified

This is the spine of the curriculum unit. Six rungs.

**(1) Fixed function (through ~1999).** The pipeline is a wiring diagram with knobs. You
set state — a texture, a blend mode, a light — and the hardware runs a fixed formula. The
GeForce 256 (1999) is marketed as the first "GPU" because it moved *transform and lighting*
into hardware; before that the CPU did the vertex maths and the card only rasterised and
textured.

**(2) Register combiners (~1999–2001).** `NV_register_combiners` on GeForce 256/GeForce 2:
a small configurable network of stages, each doing a couple of scaled multiply/add/dot
operations on inputs selected from texture results, interpolated colours, and constants,
feeding into the next stage. It is not a processor — no branching, no loops, no named
registers, a hard stage limit — but it is the first time the *fragment* stage stopped being
a fixed formula and became a *configurable dataflow graph*. ATI's contemporary was
`ATI_fragment_shader`. This is the rung most histories skip, and it is worth teaching
because it names the real transition: from **fixed formula** → **configurable dataflow** →
**program**. *(Register combiner specifics are established knowledge and OpenGL extension
history, not re-verified in this pass — §8.)*

**(3) Programmable shaders (2000–2002).** DirectX 8 (2000) introduces vertex shader 1.0 and
pixel shader 1.0 — assembly, tiny (PS 1.1 allowed 8 instructions), fixed point. DirectX 9
(2002) brings Shader Model 2.0/3.0 with floating point, real instruction counts, and
high-level languages: HLSL from Microsoft and Cg from NVIDIA — Wikipedia notes that "*early
versions of the two languages were considered identical, only marketed differently*." GLSL
arrives with OpenGL 2.0 (2004). [TESLA] marks the hardware milestone: the ATI "*Radeon
9700, introduced in 2002, featured a programmable, floating-point fragment pipeline.*"

**(4) The load-balancing crisis.** Vertex and pixel shader units were *separate hardware*.
[TESLA] lays out the problem in the architects' own words:

> "*Because GPUs typically must process more pixels than vertices, pixel-fragment processors
> traditionally outnumber vertex processors by about three to one. However, typical workloads
> are not well balanced, leading to inefficiency. For example, with large triangles, the
> vertex processors are mostly idle, while the pixel processors are fully busy. With small
> triangles, the opposite is true.*"

Plus: "*The addition of more-complex primitive processing in DX10 makes it much harder to
select a fixed processor ratio.*" And: "*the increased generality also increased the design
complexity, area, and cost of developing two separate processors.*" So three forces —
a workload-dependent ratio you cannot pick, a new stage (the geometry shader) that makes it
worse, and the engineering cost of building two increasingly-similar programmable cores.

**(5) The unified shader architecture.** ATI's **Xenos** in the Xbox 360 (2005) shipped it
first; NVIDIA's **Tesla / G80** (GeForce 8800 GTX, November 2006) shipped it first on the PC.
[TESLA] states the objective:

> "*A primary design objective for Tesla was to execute vertex and pixel-fragment shader
> programs on the same unified processor architecture. Unification would enable dynamic load
> balancing of varying vertex- and pixel-processing workloads and permit the introduction of
> new graphics shader stages, such as geometry shaders in DX10. It also let a single team
> focus on designing a fast and efficient processor and allowed the sharing of expensive
> hardware such as the texture units.*"

The G80 as it shipped [TESLA]: 128 streaming-processor (SP) cores, organised as 16 streaming
multiprocessors (SMs) in 8 texture/processor clusters (TPCs). Each SM: 8 SP cores (each a
scalar MAD unit), 2 special function units, a multithreaded instruction fetch/issue unit, an
instruction cache, a read-only constant cache, and **a 16 KB read/write shared memory**. Up
to 768 concurrent threads. SIMT execution in **32-thread warps**, 24 warps per SM, with the
warp scheduler picking a ready warp each issue cycle at zero cost.

**(6) And this is exactly what made CUDA possible — stated by NVIDIA's own architects.**
[TESLA], immediately after describing the unification:

> "*The generality required of a unified processor opened the door to a completely new GPU
> parallel-computing capability.*"

And on the co-design:

> "*They developed the graphics feature set in coordination with the development of the
> Microsoft Direct3D DirectX 10 graphics API. They developed the GPU's computing feature set
> in coordination with the development of the CUDA C parallel programming language, compiler,
> and development tools.*"

CUDA was not retrofitted. It shipped with the generation whose defining change was the
unification, and the paper describes the shared memory as holding "*graphics input buffers
**or** shared data for parallel computing*" — one structure, two names.

**The translation table.** This is the single most valuable artefact in the report for the
curriculum. Every element of the CUDA execution model, and the graphics thing it is:

| CUDA / compute concept | What it actually is |
|---|---|
| Warp of 32 threads | Eight 2×2 pixel quads [TESLA] |
| Warp-synchronous execution, SIMT | Shading a batch of fragments with one instruction stream |
| Branch divergence & predication | A triangle edge running through a quad |
| `__shfl_sync`, subgroup ops | The `ddx`/`ddy` cross-lane read for mipmap derivatives |
| Inactive lanes still consuming cycles | Helper pixels at triangle edges |
| `__shared__` memory | The SM's per-stage vertex/pixel input–output buffers [TESLA] |
| `__syncthreads()` | The barrier that made the shared buffer usable between stages |
| Huge register file, zero-cost warp switch | Holding hundreds of fragments in flight to cover texture latency |
| Occupancy | The latency-hiding budget, exposed |
| `__ldg` / read-only data cache | The texture cache with filtering disabled |
| `tex2D` bilinear interpolation | The texture filter unit, unchanged |
| `cudaArray` opaque layout | Swizzled/Morton texture layout for 2D locality |
| Global atomics at the L2 | The ROP: address-partitioned read-modify-write [TESLA, GIESEN-13] |
| Coalescing rules | DRAM burst size chosen to match a 16-pixel ROP write [GIESEN-9] |
| PTX as a stable virtual ISA | Shader bytecode: the same idea, for the same reason [TESLA] |
| Thread block scheduled to one SM | A shader batch scheduled to one shader core |
| Grid / block / thread hierarchy | Draw call / shader batch / fragment |

## 3.6 Tile-based deferred rendering vs immediate mode — and why phones are different

**The problem.** Go back to §1.2's bandwidth number. The framebuffer read-modify-write
traffic — depth read, depth write, colour write, colour read for blending, multiplied by
overdraw — is the dominant memory cost of rendering, and on an **immediate-mode renderer
(IMR)** every byte of it goes off-chip to DRAM. A discrete GPU answers this with 500 GB/s
to 1.8 TB/s of dedicated GDDR6X or HBM and a 250–450 W power budget. **A phone has
30–70 GB/s of LPDDR shared with the CPU and a 3–5 W total SoC budget**, and off-chip DRAM
access costs something like two orders of magnitude more energy per bit than on-chip SRAM
access. You cannot brute-force it. So don't put the framebuffer off-chip during the frame.

**The mechanism.** Split rendering into two passes:

1. **Binning / geometry / tiling pass.** Run vertex shaders for the *entire* frame. Take
   the resulting screen-space primitives and **sort them into per-tile lists** written to
   memory (the "polygon list" / "parameter buffer" / "primitive list"). Apple calls this
   the tiling phase; on Apple GPUs "*results stored in tile memory rather than main memory*"
   for the per-tile work.
2. **Fragment / rendering pass.** For each tile independently: load its primitive list,
   rasterise, depth test, shade, and blend entirely inside a small on-chip **tile memory**
   holding that tile's depth and colour. When the tile is finished, write the finished
   colour out to DRAM **once**. Depth need never be written at all.

Tiles are typically **16×16 or 32×32 pixels** [Wikipedia: Tiled rendering]. That is
16×16×4 bytes = 1 KB of colour plus 1 KB of depth — trivially SRAM-sized.

**The "deferred" in TBDR.** Imagination's PowerVR added the crucial extra step: within a
tile, resolve visibility for *all* the tile's primitives *before* shading anything, then
shade only the visible fragment per pixel. Apple's documentation describes this as **hidden
surface removal**: "*depth testing performed before fragment shaders run*," so "*only the
visible fragments execute expensive fragment shaders.*" Consequence: **overdraw costs
essentially nothing in shading work** on a TBDR, which is why mobile developers historically
did not need a depth prepass and desktop developers did.

**History** [Wikipedia: Tiled rendering]: the idea traces to Pixel-Planes 5 (1989);
PowerVR commercialised it from 1996 and it shipped in the Sega Dreamcast and the Kyro
cards. Today ARM Mali, Imagination PowerVR, Qualcomm Adreno and Apple's GPUs are all
tile-based; Apple's are TBDR proper. And notably, desktop parts converged partway: NVIDIA
Maxwell (2014), AMD Vega (2017) and Intel Gen11 (2019) all added **tiled caching** — bin
into an L2-sized tile to improve locality, while keeping immediate-mode semantics. They
took the bandwidth idea without taking the deferred part.

**The costs, which must be taught alongside the benefits:**

- The parameter buffer is proportional to *geometry*, and it is off-chip traffic that an
  IMR does not pay. Geometry-heavy scenes can lose. A triangle spanning multiple tiles is
  processed once per tile it touches [Wikipedia: Tiled rendering].
- Full-frame effects and anything requiring the whole framebuffer at once are awkward.
- **Reading the framebuffer mid-frame is catastrophic.** It forces the tile to be flushed
  to DRAM and reloaded, which is exactly the traffic the architecture exists to avoid.
  This is the single biggest source of "it runs fine on desktop and terribly on mobile."

**The mobile API idioms that only make sense once you know this:**

- Always **clear** (or `loadAction = .clear` / `dontCare`) at the start of a render pass —
  it tells the driver it need not *load* the previous tile contents from DRAM.
- Always **`storeAction = .dontCare`** (or `glInvalidateFramebuffer` / Vulkan
  `STORE_OP_DONT_CARE`) on depth and on any attachment you will not read — it tells the
  driver not to *write* the tile out.
- **Vulkan subpasses / `VK_KHR_dynamic_rendering` local reads** and Metal **imageblocks**
  exist precisely so a multi-pass technique (deferred shading's G-buffer, for instance) can
  keep its intermediates in tile memory and never touch DRAM. This is the single largest
  mobile optimisation available and it is invisible if you do not know the architecture.
- **Programmable blending is easy here.** Metal lets a fragment shader read the current
  colour attachment value directly, which [GIESEN-9] explains is nearly impossible on an
  IMR — because on a TBDR the destination is in tile-local memory that only this tile's
  fragments can touch, so the hazard problem evaporates.

**Compute consequence.** Three:

1. **Tile memory is a scratchpad addressed by screen position** — architecturally a cousin
   of `__shared__`. Metal and OpenCL on Apple/ARM hardware let compute kernels use the same
   threadgroup memory, and Metal's tile shaders let a *compute-like* kernel run over tile
   memory mid-render-pass. The unification story repeats in miniature.
2. It is the cleanest available demonstration that **memory hierarchy design is driven by
   energy, not just latency**. The same shader, the same triangle count, the same output —
   two architectures, because one has 1.8 TB/s at 400 W and the other has 50 GB/s at 4 W.
3. It generalises directly to the compute lesson students actually need: *keep the working
   set on chip and write out once*. A tile is a blocked GEMM tile. The bandwidth argument
   is identical.

---

# Part 4 — The modern additions

## 4.1 Ray tracing hardware

**The algorithm.** Cast a ray, find the nearest triangle it hits. Naively this is O(number
of triangles) per ray, which is hopeless. The standard acceleration structure is a
**Bounding Volume Hierarchy (BVH)**: a tree whose internal nodes are axis-aligned bounding
boxes containing their children and whose leaves hold triangles. Traversal is: test the ray
against a node's child boxes (a "slab test" — six compare-and-select operations), push the
hit children onto a stack ordered by distance, recurse; at a leaf, do a **ray-triangle
intersection** (Möller–Trumbore: ~20 FLOPs and a couple of divides).

**Why it is fixed function.** This workload is *the exact opposite* of what an SM is good
at, on four axes at once:

1. **It is control-flow-dominated, not arithmetic-dominated.** A node visit is a handful of
   compares and a stack push. The arithmetic intensity is near zero.
2. **It is a dependent pointer chase.** You cannot fetch the next node until you have
   compared the current one. The memory latency is fully exposed and cannot be batched
   away.
3. **It diverges almost immediately.** Thirty-two rays in a warp start at the same root, but
   after two or three levels they are in different subtrees taking different numbers of
   steps. Under SIMT this means the warp executes the union of all 32 rays' traversal paths,
   with most lanes masked off most of the time. Divergence approaches total.
4. **The stack is per-ray state.** Each lane needs its own traversal stack, which either
   burns registers or spills to local memory.

Do it in software and, per [TURING], BVH traversal "*would need to be performed by shader
operations and take thousands of instruction slots per ray cast.*" The measured gap:
"*Pascal is spending approximately 1.1 Giga Rays/Sec, or 10 TFLOPS / Giga Ray to do ray
tracing in software, whereas Turing can do 10+ Giga Rays/Sec using RT Cores.*"

**What an RT core is.** [TURING]: one per SM. "*The RT Core includes two specialized units.
The first unit does bounding box tests, and the second unit does ray-triangle intersection
tests.*" Critically, it walks the tree itself: "*RT Cores traverse the BVH autonomously*"
and "*The SM only has to launch a ray probe, and the RT core does the BVH traversal and
ray-triangle tests, and return a hit or no hit to the SM. The SM is largely freed up to do
other graphics or compute work.*"

That is the design pattern to teach: **the RT core is not an accelerator bolted on to make
a good thing faster; it is an amputation.** An irregular, divergent, latency-bound kernel is
removed from the SIMT machine entirely and given to a small state machine with its own
traversal stack that can chase pointers without occupying a warp.

**The division of labour** [TURING] + [DXR]: the **driver** builds and refits the
acceleration structure; the **application** writes ray generation, closest-hit, any-hit,
and miss shaders in HLSL/GLSL; the **hardware** does traversal and intersection. DXR was
announced 19 March 2018 and shipped with Windows 10 version 1809 on 10 October 2018;
**DXR 1.1** (27 May 2020) added *inline* ray tracing — `RayQuery`, which lets any shader
stage (including compute) trace a ray inside its own control flow rather than dispatching
into a separate shader table. Vulkan's equivalents are `VK_KHR_ray_tracing_pipeline` and
`VK_KHR_ray_query`.

**RT cores vs tensor cores — the contrast is the lesson.** They live in the same SM and
have nothing in common:

| | RT core | Tensor core |
|---|---|---|
| Kernel shape | Tree traversal + small geometric tests | Dense matrix multiply-accumulate |
| Arithmetic intensity | Very low | Very high |
| Control flow | Data-dependent, divergent | None |
| Memory pattern | Dependent pointer chase | Streamed from registers/shared/TMEM |
| Bottleneck | Latency and divergence | Feeding the array |
| Why fixed function | The work is **too irregular** for SIMT | The work is **too regular** to waste general ALUs on |
| Interface | Launch a probe, get hit/no-hit back | `mma` / `wmma` instruction over a register fragment |

**Fixed-function hardware appears at both ends of the regularity spectrum, and for
opposite reasons.** That is a genuinely deep point about accelerator design and it belongs
in the curriculum.

## 4.2 DLSS, FSR, XeSS, and temporal upscaling

**Why.** Shading cost scales with pixel count, and pixel count scales with the square of
linear resolution. Rendering at 1920×1080 and presenting at 3840×2160 is 4× fewer fragment
shader invocations, 4× fewer texture samples, 4× less ROP traffic. If you can reconstruct
the 4K image convincingly, you have bought a 4× shading discount. Nothing else in real-time
graphics offers that.

**The algorithmic core is temporal, not neural, and this is the part curricula get wrong.**
The trick:

1. **Jitter the projection matrix by a sub-pixel offset each frame** (a Halton sequence is
   standard). Frame *n* samples the scene at slightly different sub-pixel positions than
   frame *n−1*.
2. **Keep a history buffer** at output resolution.
3. **Reproject** the history into the current frame using per-pixel **motion vectors**
   (which the renderer must produce — the previous frame's clip position minus this
   frame's) so that a moving object's history follows it.
4. **Accumulate**. Over *N* frames you have effectively *N* sub-pixel samples per output
   pixel — real supersampling, spread over time.

That is temporal antialiasing with upsampling (TAAU), and it works. Its failure mode is
entirely in step 3–4: when reprojection is *wrong*, you blend in colour that does not
belong. Wrong reprojection happens at **disocclusion** (background revealed behind a moving
object has no history), on **transparency** (motion vectors describe one surface), on
**shader-animated geometry** (vertex animation the motion vectors do not know about), on
**specular highlights** (which move differently from the surface), and on **thin geometry**
(wires, foliage). The visible artefacts are ghosting, smearing, and shimmer.

**What the neural network actually does.** It is the *history rejection heuristic*. Deciding
per pixel how much of the reprojected history to trust — and, when rejecting it, what to
put there instead — is a hard perceptual judgement that hand-written clamping heuristics
(neighbourhood colour clamping, variance clipping) do adequately and a trained network does
better. That is the whole contribution. The upscaling is temporal; the network improves the
blend weights.

**DLSS generations** [Wikipedia: Deep Learning Super Sampling; TURING]:

| Version | Date | What changed |
|---|---|---|
| DLSS 1.0 | Feb 2019 | Spatial convolutional autoencoder, trained **per game**. Not good. |
| DLSS 2.0 | Apr 2020 | **Temporal**: motion vectors, depth, exposure, jittered samples. Generalised model, no per-game training. This is the one that worked. |
| DLSS 3 | Sep 2022 | Adds **frame generation** — interpolate an entirely new frame between two rendered ones using Ada's Optical Flow Accelerator. RTX 40-series. |
| DLSS 3.5 | Sep 2023 | **Ray reconstruction** — the network replaces the hand-written ray-tracing denoisers. |
| DLSS 4 | Jan 2025 | **Transformer** model instead of a CNN; multi-frame generation on RTX 50-series. |
| DLSS 4.5 | Jan 2026 | Second-generation transformer; dynamic frame generation up to 6× on RTX 50. *(This entry is from Wikipedia only — see §8.)* |

**The interesting fact: this is where tensor cores earn their keep in a consumer part.**
Tensor cores were designed for datacenter training (Volta, 2017). Putting them on a GeForce
die is a large area cost that gamers have no direct use for. [TURING] states the
justification explicitly: "*The introduction of Tensor Cores into Turing-based GeForce
gaming GPUs makes it possible to bring real-time deep learning to gaming applications for
the first time*," and DLSS is the headline application. So the causal chain runs:
datacenter matrix hardware → consumer graphics part → an image reconstruction network → the
ability to render at 1080p and present at 4K. **The consumer GPU now carries AI silicon
because it made the graphics faster, not the other way round.**

The frame budget makes it a tensor-core problem rather than a shader problem: at 120 Hz
the whole frame is 8.3 ms, so the reconstruction network must run in roughly 1–2 ms
including all its memory traffic, every frame, at output resolution. That is not a budget a
general shader can hit for a network of useful size.

**FSR** [Wikipedia: FidelityFX Super Resolution]:

| Version | Date | What it is |
|---|---|---|
| FSR 1 | Jun 2021 | Purely **spatial**: EASU (edge-adaptive spatial upsampling) + RCAS (sharpening). No history, no motion vectors, no ML. Runs on anything. |
| FSR 2 | Mar 2022 | **Temporal**, hand-written. No ML, no dedicated hardware. |
| FSR 3 | Sep 2023 | Adds frame generation via optical flow in **async compute** — software, cross-vendor. |
| FSR 4 / "Redstone" | 2025 | **Machine learning** models for upscaling, frame interpolation, ray denoising and radiance caching; **requires RDNA 4** ML hardware. |

**FSR 2 is the important data point for the curriculum.** It is hand-written, needs no
matrix hardware, and gets most of the way there — which proves that *the temporal
accumulation is doing the heavy lifting and the network is a refinement*. And **Intel XeSS**
(2022) makes the same point from the other direction: it ships **two code paths** — one
using Intel's XMX matrix engines, one using `DP4a` integer dot products available on
essentially any modern GPU — the same algorithm at two hardware tiers. Algorithm and
hardware are separable.

**Honest framing for the curriculum:** temporal reprojection with sub-pixel jitter does
most of the work and is vendor-neutral; a neural network improves the history-rejection
heuristic; matrix hardware makes a useful-sized network fit in the frame budget. All three
statements are true and students should be able to say which is which.

## 4.3 Variable rate shading

[TURING] describes it: VRS decouples the **shading rate** from the **visibility rate**.
"*Every 16-pixel × 16-pixel region of the screen can now have a different shading rate,*"
chosen from up to seven options: 1×1 (per pixel), 1×2, 2×1, 2×2 (one shading result colours
four pixels), 2×4, 4×2, 4×4 (one result for sixteen pixels). The rate is specified spatially
via a screen-space texture and/or per-primitive as an attribute, so a single triangle can be
shaded at multiple rates. Overall a scene can be "*shaded with a mixture of rates varying
between once per visibility sample (super-sampling) and once per sixteen visibility
samples.*"

[TURING] names three applications: **content-adaptive shading** (reduce rate where colour
varies slowly), **motion-adaptive shading** (reduce rate on fast-moving objects, since eye
tracking and motion blur hide the detail anyway), and **foveated rendering** (reduce rate
away from the fovea, in VR with eye tracking).

**The connection back to §2.6 is the point.** VRS is the quad, resized. The pipeline was
already built around shading a fixed-size block of pixels as a unit and broadcasting the
result — depth and coverage are already tracked at finer granularity than shading, because
MSAA does exactly that. VRS generalises the block from 2×2 to 1×1…4×4. The derivative
contract is preserved: derivatives are computed at the coarse rate, which correspondingly
biases mip selection. **You could only build VRS on a machine whose fragment stage already
had a decoupled shading footprint — which it had, because of mipmap derivatives.** Twenty
years apart, same cause.

Vulkan exposes it as `VK_KHR_fragment_shading_rate`; D3D12 as `VRS Tier 1/Tier 2`. And note
the family resemblance to two older ideas: **MSAA** (visibility at 4×, shading at 1×) and
**checkerboard rendering** (shade half the pixels, reconstruct). VRS is the general form.

---

# Part 5 — The APIs, briefly

## 5.1 OpenGL and D3D≤11: the driver-managed era

OpenGL (1992) and Direct3D through version 11 present a **global state machine**. You bind
a texture to a slot, set a blend mode, set a depth function, then issue a draw. Wikipedia's
Vulkan article puts the contrast well: OpenGL maintains "*one single global state
machine*."

What the driver does behind that, at draw time:

- **Validate** the current state combination.
- **Recompile shaders.** The shader you compiled at load time is not the shader that runs;
  the driver specialises it against the current blend state, render target formats, vertex
  layout, and so on. Hit a new combination mid-frame and you get a compile — this is the
  origin of "shader compilation stutter."
- **Manage memory and residency**: allocate, sub-allocate, decide what lives in VRAM,
  migrate.
- **Track hazards and insert synchronisation** by inference from the API calls.
- **Guess.** Vendor drivers historically shipped per-game profiles that patched shaders and
  reordered work for specific titles.

Two consequences killed it. First, **CPU cost**: the driver spent more CPU time preparing
work than the app spent generating it. Second, **it was single-threaded**: one thread owns
the GL context, so submission does not scale with cores — at a moment (2013) when consoles
had eight weak cores and desktops had four to eight. The bottleneck stopped being the GPU.

## 5.2 The explicit era: Mantle → Vulkan, D3D12, Metal

- **AMD Mantle**, 2013 — the first shipping low-overhead API. AMD donated it to Khronos
  "*with the intent of giving Khronos a foundation on which to begin developing a low-level
  API*" [Wikipedia: Vulkan].
- **Apple Metal**, June 2014 (iOS 8, A7 hardware); macOS June 2015. Metal 2 (2017), Metal 3
  (2022), Metal 4 (2025).
- **Direct3D 12**, shipped with Windows 10 (July 2015).
- **Vulkan 1.0**, 16 February 2016. Then 1.1 (7 Mar 2018), 1.2 (15 Jan 2020), 1.3 (25 Jan
  2022), 1.4 (3 Dec 2024) [Wikipedia: Vulkan].

**What changed, mechanism by mechanism:**

**Command buffers.** Instead of calling into the driver on one thread, you *record* commands
into buffers — on as many threads as you like, in parallel — and submit the finished buffers
to a queue. Recording is cheap because there is nothing to validate. **This is the reason
explicit APIs exist**: it is the only way to make submission scale with core count. Metal
calls them command buffers and encoders; D3D12 calls them command lists and allocators.

**Pipeline State Objects.** Every piece of state the driver would have had to re-validate
and re-specialise at draw time — the whole shader set, blend state, depth/stencil state,
rasteriser state, vertex input layout, render target formats — is frozen into a single
immutable object created at load time. The expensive compile happens when you can afford
it, and binding a PSO at draw time is nearly free. This is the direct fix for shader
compilation stutter, and it is why modern engines ship precompiled pipeline caches.

**Descriptor sets / root signatures / argument buffers.** Instead of "bind texture to slot
3" one API call at a time, you build a *table* of resource descriptors (texture views,
buffer views, samplers) in GPU-visible memory and bind the whole table with one call.
Vulkan calls them descriptor sets, D3D12 root signatures and descriptor heaps, Metal
argument buffers. The endpoint is **bindless**: bind one enormous heap once, and pass the
shader an *integer index* into it. At that point a resource handle is just a number a
shader can compute, store in a buffer, or receive as a material parameter — which is
functionally the same thing as passing a pointer to a CUDA kernel, and is what makes
GPU-driven rendering (the GPU choosing its own draws and materials) possible at all.

**Explicit memory and synchronisation.** You allocate heaps and sub-allocate from them; you
place pipeline barriers and image layout transitions yourself; you manage fences and
semaphores across queues. The driver stops inferring and stops guessing. And you can now be
*wrong* — which is why validation layers exist as an opt-in development-time tool, disabled
in release. [Wikipedia: Vulkan]: Vulkan "*requires no runtime error checking — developers
use validation layers instead during development.*"

**The trade, stated honestly for the curriculum:** explicit APIs moved perhaps ten thousand
lines of heuristics out of every vendor's driver and into every engine. For a large engine
that is a win — the engine knows its own frame structure and can do better than an inferring
driver. For a small project it is a large tax, which is why WebGPU, and middleware layers
like `MoltenVK`, `wgpu`, `bgfx` and `Dawn`, exist.

## 5.3 Shader languages and intermediate representations

| Language | Home | Notes |
|---|---|---|
| **GLSL** | OpenGL (2004), Vulkan (as SPIR-V source) | C-like. Historically shipped as *source*, compiled by the driver — every vendor needed a full compiler front end, and they disagreed. |
| **HLSL** | Direct3D 9 (2002) onward | Developed alongside NVIDIA's Cg; "*early versions of the two languages were considered identical, only marketed differently*" [Wikipedia: HLSL]. Now also compiles to SPIR-V, so it is the de facto cross-platform choice. |
| **Cg** | NVIDIA (2002) | Compiled to both D3D and OpenGL. Deprecated, but historically important as the first HLL to target both. |
| **MSL** | Apple Metal | "*a shading language based on C++14, implemented using Clang and LLVM*" [Wikipedia: Metal]; C++17-based as of Metal 4. Real C++ templates and function pointers in a shader. |
| **WGSL** | WebGPU | Rust-like syntax. Originally intended to be trivially translatable to SPIR-V; the working group moved to a conventional shading-language design instead [Wikipedia: WebGPU]. |
| **Slang** | Khronos (adopted 2025) | Modern research-derived language with generics and autodiff, compiling to SPIR-V/HLSL/CUDA. *(Adoption date not verified — §8.)* |

**Intermediate representations, and why they exist.**

- **DXBC → DXIL.** D3D's bytecode. The legacy `FXC` compiler emitted DXBC; the open-source
  `DXC` emits **DXIL** (LLVM-bitcode-based) and can also emit SPIR-V [Wikipedia: HLSL].
- **SPIR-V** (2015). Consumed by Vulkan, OpenCL 2.1+, and OpenGL 4.6. The stated reason
  [Wikipedia: SPIR-V]: "*ingesting SPIR-V removes the need to build a high-level language
  source compiler into device drivers.*" That single sentence contains the whole argument.
  Shipping GLSL source meant every driver contained a full C-like language front end,
  which meant every driver had different bugs, different accepted dialects, and different
  compile times. SPIR-V moves that to the developer's build machine. It also lets you ship
  a shader without shipping its source. SPIR-V 1.0 dropped the LLVM-IR foundation the
  earlier SPIR 1.0–2.0 used; a separate Khronos tool translates between SPIR-V and LLVM IR.
- **PTX** — NVIDIA had the same idea a decade earlier, inside one vendor. [TESLA]: "*PTX
  provides a stable target ISA for compilers and provides compatibility over several
  generations of GPUs with evolving binary instruction set architectures.*" Word for word
  the SPIR-V argument.

Worth stating plainly in the curriculum: **PTX, SPIR-V, DXIL and shader bytecode are the
same design pattern — a virtual ISA that decouples the language front end from the hardware
back end, so the hardware ISA can change every generation without breaking anything.**
That is why `ptxas` runs at driver-install time or JIT time, and why a CUDA binary that
contains PTX runs on a GPU that did not exist when it was compiled.

## 5.4 Compute shaders as the bridge

D3D11 compute shaders (2009), OpenGL 4.3 compute (2012), then Vulkan, Metal and WebGPU.
[GIESEN-13] describes the model and the framing is exactly right: compute shaders "escape
the rigid graphics pipeline hierarchy" — instead of processing a predetermined stream
(vertices → fragments), they "*accept only thread indices as input and democratize output
through UAVs.*"

The pieces [GIESEN-13]:

- **Threads → warps/wavefronts (16–64 in lockstep) → thread groups (1–1024 threads, indexed
  in 3D).**
- **Thread Group Shared Memory (TGSM)** — 32 KB of fast scratchpad per group in D3D11.
  It works "*because all threads within a thread group get executed by the same shader
  unit*," so no coherency protocol is needed.
- **Barriers**, in three flavours: group sync, group memory barrier, device memory barrier
  (the last stalling on "600+ cycle latencies").
- **Unordered Access Views (UAVs)** — random-access read *and write* to arbitrary
  locations, with atomics.

**Now put the CUDA rename table next to it:**

| Compute shader (HLSL/GLSL) | CUDA |
|---|---|
| Thread group | Thread block |
| `numthreads(x,y,z)` / `local_size_x` | `blockDim` |
| `groupshared` / `shared` | `__shared__` |
| `GroupMemoryBarrierWithGroupSync()` / `barrier()` | `__syncthreads()` |
| `DeviceMemoryBarrier()` | `__threadfence()` |
| UAV / SSBO / `image2D` | a `__global__` pointer |
| `SV_DispatchThreadID` | `blockIdx*blockDim + threadIdx` |
| `SV_GroupThreadID` | `threadIdx` |
| `SV_GroupID` | `blockIdx` |
| `Dispatch(x,y,z)` | `<<<grid, block>>>` |
| Wave intrinsics (SM 6.0) / subgroup ops | `__shfl_sync`, `__ballot_sync`, `__any_sync` |
| `InterlockedAdd` | `atomicAdd` |

It is the same machine with different nouns. A student who has done the graphics units
learns the CUDA execution model as a *translation*, not as a new thing.

## 5.5 GPGPU's prehistory — doing maths by pretending it was a texture lookup

This story is worth telling carefully, because it makes concrete exactly what CUDA
contributed — which is *not* what most people assume.

**The situation, c. 2002.** You have hardware that will run a small floating-point program
at every pixel of a quad, a few hundred million times per second. You want to run a small
floating-point program at every element of an array. These are the same thing, if you are
willing to lie about what the words mean.

**The dictionary:**

| What you want | What you say |
|---|---|
| An input array | A **texture** |
| A kernel | A **fragment shader** |
| "for each element" | **Draw a screen-sized quad** covering the output |
| The output array | The **render target** (a floating-point one, once those existed) |
| Reading `a[i]` | A **texture fetch** at coordinate *i* |
| An iteration | **Ping-pong**: render A→B, swap, render B→A |
| A 2D array | A texture. A 1D array of length N | A texture of width √N, or N×1 |
| A parameter | A **uniform** |

**What you gave up — and this is the part that matters:**

- **No scatter.** A fragment shader can only write to *its own pixel*. `gl_FragCoord` is an
  input, not an output. You could do `out = f(gather(...))` but never `a[j] = x` for a
  computed `j`. Every algorithm had to be rephrased in gather-only form. Building a
  histogram — trivially a scatter — required either rendering point primitives with additive
  blending (using the ROP as your scatter unit!) or a sort-then-segment-scan.
- **Reductions cost log N passes.** Summing an array meant rendering to a target half the
  size, each fragment summing four texels, repeatedly, until you reached 1×1. Ten passes
  for N = 1024, with full pipeline setup each time.
- **Sorting meant bitonic networks**, because they are data-independent: the comparison
  partners at each stage are a fixed function of the index, so each pass is a legal gather.
- **No integers, no bit operations.** Early programmable fragment hardware was
  floating-point or fixed-point only, often 16-bit, with no bitwise ops.
- **No debugger, no `printf`.** You debugged by rendering intermediate values as colours
  and looking at them.
- **Readback was brutal.** Getting results back over AGP was slow and often synchronous,
  stalling the pipeline.
- **Precision was a research problem.** Full IEEE FP32 render targets and blending were not
  universally available; early work had to reason about what precision it was actually
  getting.

**The timeline** [Wikipedia: GPGPU; Wikipedia: CUDA; TESLA]:

- **1987** — a Game-of-Life implementation on a blitter is cited as an early general-purpose
  use of graphics hardware.
- **2001–2002** — programmable shaders plus floating point make it practical. The Radeon
  9700 (2002) is the first "*programmable, floating-point fragment pipeline*" [TESLA].
- **2002** — Mark Harris et al., "Physically-Based Visual Simulation on Graphics Hardware"
  (Graphics Hardware 2002) — fluid and cloud simulation entirely in fragment shaders.
  Harris coins **"GPGPU"** and founds gpgpu.org [Wikipedia: GPGPU].
- **2003** — "*two research groups independently discovered GPU-based approaches for linear
  algebra that outperformed CPUs*" [Wikipedia: GPGPU] — sparse matrix solvers and conjugate
  gradient on graphics hardware.
- **2004** — **BrookGPU** (Stanford; Ian Buck et al., SIGGRAPH 2004): a C dialect with
  *streams* and *kernels* that **compiled down to DirectX/OpenGL**, hiding the graphics
  lie. Also **Sh** (Waterloo) → RapidMind, a C++ metaprogramming approach.
- **2006** — ATI ships **Close To Metal (CTM)**, exposing the hardware below the graphics
  API. NVIDIA ships **G80** with the unified shader architecture and announces **CUDA**.
- **15 February 2007** — "*The initial CUDA SDK was made public on 15 February 2007, for
  Microsoft Windows and Linux*" [Wikipedia: CUDA].
- **December 2008** — OpenCL 1.0, the vendor-neutral answer.

**What CUDA actually contributed.** Not "making the GPU compute" — the GPU already
computed, and people had already run fluid simulations and linear solvers on it. CUDA
contributed four specific things, and each maps to a hardware change in G80:

1. **Scatter.** `ptr[i] = x` for an arbitrary computed `i`. This required a general
   load/store path from the shader core to memory, which G80 added. The single largest
   change, and the one that let ordinary algorithms be written ordinarily.
2. **A real memory model.** Pointers, a flat address space, arrays that are arrays.
   No pretending an array is a texture and no worrying about the texture's dimensions.
3. **An explicitly addressable scratchpad.** `__shared__` — 16 KB per SM in G80 [TESLA] —
   that you *index*, rather than a texture you *sample*. And a barrier to make it usable.
4. **A compiler that did not require the algorithm to be phrased as a drawing.** No
   ping-ponging, no quad, no viewport, no framebuffer. Just a function and a launch
   configuration.

Wikipedia's CUDA article makes the accessibility point: CUDA contrasts with "*prior APIs
like Direct3D and OpenGL, which require advanced skills in graphics programming.*"

**And the punchline for the curriculum:** the hardware for general computation was *already
there* by 2003. What was missing was scatter, a pointer model, an addressable scratchpad,
and permission to stop pretending. When the unified shader architecture arrived in 2006 it
made the first three cheap, and CUDA supplied the fourth. That is why the transition looks
sudden from the outside and was completely continuous from the inside.

---

# Part 6 — Curriculum: three units

These sit **at the start of the GPU part of the course, before the CUDA execution model
unit**, as the explanation of why the hardware looks like that. Each has exactly one idea.
Each depends on the previous. All exercises are machine-checkable — they assert against
computed values, reference buffers, or hashes — and all of them run on a CPU in plain C++
or Python, with no GPU required. That is deliberate: the point of these units is that you
can *derive* the GPU's shape by writing a renderer, and a student who has written a
software rasteriser will never again think a warp is an arbitrary number.

> **Five of these exercises exist as working, executed C++ in Appendix A**, compiled and run
> against the live Compiler Explorer API. Appendix A also carries the API recipe, the
> measured proof that CE caches results (so any timing exercise needs a per-submission
> nonce), and **corrections to three of the assertion bounds stated below**, which were
> estimates until the code was actually run. Where this Part and Appendix A disagree,
> Appendix A is the measurement.

---

## Unit G1 — Why a screen is an arithmetic problem

> **THE ONE IDEA.** Rendering is a fixed, enormous, per-pixel arithmetic budget with a
> hard deadline, and every pixel is independent of every other. That combination — huge,
> deadlined, and independent — is what a latency-optimised CPU cannot serve and what makes
> a throughput machine the only possible answer.

**Prerequisites:** basic linear algebra (matrix multiply), the CPU memory hierarchy unit,
floating point.

**Depends on:** nothing in the GPU part. This is the entry point.

### Content

1. The three independences (vertices, triangles, fragments) and the *one* dependency
   (ordered depth+blend at the end). The fork/join shape.
2. Frame budget arithmetic: pixels, rate, ns per pixel, overdraw, FLOP/s, texel rate, ROP
   bandwidth. Do it for 4K/120, 1080p/60, and a phone at 1080p/60 with 50 GB/s.
3. The honest CPU comparison: peak FLOPs are within ~16×, but the per-pixel cycle budget is
   80 cycles, fixed-function work becomes tens of instructions each, the cache hierarchy is
   optimised for the wrong thing, and out-of-order execution is the wrong latency-hiding
   mechanism when you have millions of independent tasks.
4. The transform chain: M, V, P, the perspective divide, the viewport transform. Why
   clipping happens *before* the divide. Why depth is distributed as 1/z and what
   reversed-Z fixes.
5. Why "latency does not matter, throughput does" — and what that sentence licenses you to
   delete from a CPU design.

### Exercises (machine-checkable)

**G1.1 — Frame budget calculator.**
Write a function taking (width, height, refresh Hz, overdraw factor, FLOP per fragment,
texture samples per fragment, bytes per ROP operation) and returning required GFLOP/s,
texel fetch rate, and ROP bandwidth. Assert against hand-computed values:

```
 assert pixels(3840, 2160)                     == 8_294_400
 assert abs(ns_per_pixel(3840,2160,120) - 1.005) < 0.01
 assert abs(gflops(3840,2160,120, overdraw=3, flop_per_frag=200) - 597) < 1.0
 assert abs(cpu_cycles_per_pixel(cores=16, ghz=5.0, hz=120, w=3840, h=2160) - 80.4) < 0.5
```

Then have the student vary overdraw and shader cost until the required TFLOP/s exceeds a
real GPU's peak, and report the crossover. The lesson lands when they discover how little
shader they can afford.

**G1.2 — Implement the transform chain and assert a known vertex maps to a known pixel.**
Implement `mat4`, `perspective(fovy, aspect, near, far)`, `look_at(eye, target, up)`, and
`project(M, V, P, viewport, vertex) -> (x_screen, y_screen, z_window)`. Then, with identity
model and view, fovy = 90°, aspect = 1, near = 1, far = 100, viewport 800×800, OpenGL
conventions:

```
 assert_close(project((0, 0, -10)), (400.0, 400.0, 0.9090909))
 assert_close(project((10, 0, -10))[0], 800.0)      # 90° fov ⇒ frustum edge at 45°
 assert_close(project((0, 5, -10))[1], 600.0)
 assert_close(ndc_z((0,0,-10)), 0.8181818)
```

Then three follow-up assertions that teach the real content:

```
 # (a) the perspective divide is not affine: screen midpoint ≠ world midpoint
 a, b = (-5, 0, -2), (5, 0, -50)
 assert project(midpoint(a,b))[0] != midpoint(project(a), project(b))[0]

 # (b) look_at builds an inverse: V · camera_world_matrix == identity
 assert_close(look_at(eye, target, up) @ camera_world(eye, target, up), identity4())

 # (c) normals need the inverse transpose under non-uniform scale
 M = scale(1, 1, 4)
 n = normalize((M @ vec4(normal,0)).xyz)                  # wrong
 n_correct = normalize((inverse(M).T @ vec4(normal,0)).xyz)
 assert dot(n_correct, tangent_transformed_by(M)) < 1e-6  # correct normal ⊥ tangent
 assert dot(n,         tangent_transformed_by(M)) > 1e-3  # naive normal is not
```

**G1.3 — Depth precision and reversed-Z.**
Compute `z_window(z_view)` for near ∈ {0.01, 0.1, 1.0}, far = 1000. For each, count how many
*distinct float32 values* `z_window` takes over the far half of the view range
`[far/2, far]` (evaluate on a fine sweep and count unique bit patterns). Assert that
near = 0.01 gives dramatically fewer distinct values than near = 1.0. Then implement
reversed-Z (swap near and far in the projection, use `GREATER`, clear to 0) and assert the
distinct-value count in the far half increases by more than an order of magnitude.

*This exercise is worth its weight: it is the clearest demonstration in the whole course
that a numeric format and an algorithm have to be co-designed.*

---

## Unit G2 — How a triangle becomes pixels

> **THE ONE IDEA.** A triangle becomes fragments by evaluating three linear edge functions
> on a pixel grid — and the hardware evaluates them in **2×2 blocks**, because a 2×2 block
> is the cheapest possible screen-space derivative and you need a screen-space derivative
> to choose a mipmap level. That single decision is where the warp comes from.

**Depends on:** G1 (the transform chain feeds the rasteriser).

### Content

1. Edge functions: the formula, the sign test, why they are incremental (`+a` per pixel
   right, `+b` per pixel down), and why that makes the rasteriser parallelisable in a way a
   scanline algorithm is not.
2. Barycentrics fall out of the same three numbers. Perspective-correct interpolation:
   interpolate `attr/w` and `1/w`, divide at the end. Why depth is the exception (linear in
   screen space, hence exactly representable as a plane equation, hence compressible).
3. The top-left fill rule, fixed-point snapping, and watertightness. Why the rule is only
   exactly correct in fixed point.
4. Coarse/fine hierarchical rasterisation. Hierarchical Z. Why slivers are pathological.
5. **Quads.** Derivatives, helper lanes, `ddx`/`ddy`, the 25–75% edge waste, why quads
   cannot be turned off, and the micro-triangle problem.
6. Mipmaps: aliasing *and* cache working-set. The λ formula. Bilinear, trilinear,
   anisotropic. The (i + 0.5) texel-centre convention.
7. Early-Z vs late-Z; the five things that disable early-Z; `[earlydepthstencil]` as the
   manual override.
8. The ROP: read-modify-write in API order, why blending is fixed function, ordering by
   primitive ID, ROPs owning memory partitions.

### Exercises (machine-checkable)

**G2.1 — Edge-function rasteriser, diffed against a reference buffer.**
Rasterise a triangle into an 8-bit coverage buffer using integer fixed-point edge functions
(8 subpixel bits) with the top-left fill rule. Diff byte-for-byte against a supplied
reference buffer.

Then the assertion that justifies the fill rule:

```
 # watertightness: two triangles sharing an edge must tile it exactly
 buf = zeros(W*H, u8)
 raster_increment(buf, tri(A, B, C))       # each covered pixel does buf[p] += 1
 raster_increment(buf, tri(A, C, D))       # shares edge A–C
 assert set(buf.unique()) <= {0, 1}         # no pixel covered twice, no gap in the seam
```

Run it for 1000 random quads. Any implementation without the top-left rule fails.

**G2.2 — Quad overshading waste.**
Extend the rasteriser to emit 2×2 quads (a quad is generated if *any* of its four pixels is
covered). For equilateral triangles of side s ∈ {2, 4, 8, 16, 32, 64, 128}, report
`efficiency = covered_pixels / (4 × quads_emitted)`.

```
 assert efficiency(s=2)   <= 0.35          # tiny triangles are catastrophic
 assert efficiency(s=128) >= 0.85
 assert is_monotonic_increasing([efficiency(s) for s in sizes])
 # compare against the analytic model A/(A + 2P); assert agreement within 15% for s >= 16
```

Then: rasterise a 10,000-triangle sphere at two tessellation levels and report the total
helper-lane fraction. That number *is* the mesh-shader / Nanite motivation, measured.

**G2.3 — Bilinear filtering against reference values.**
Implement `sample_bilinear(tex, W, H, u, v, address_mode)` using the texel-centre
convention (`x = u·W − 0.5`, `i0 = floor(x)`, `fx = x − i0`).

```
 T = [[0, 1],
      [2, 3]]                              # T[v][u]; texel (0,0)=0, (1,0)=1, (0,1)=2, (1,1)=3
 assert_close(sample(T, 0.50, 0.50), 1.5)   # exact centre: mean of all four
 assert_close(sample(T, 0.25, 0.25), 0.0)   # exactly on texel (0,0)'s centre
 assert_close(sample(T, 0.75, 0.75), 3.0)   # exactly on texel (1,1)'s centre
 assert_close(sample(T, 0.75, 0.25), 1.0)
 assert_close(sample(T, 0.50, 0.25), 0.5)   # halfway between texels 0 and 1
 assert_close(sample(T, 1.25, 0.25, WRAP),  sample(T, 0.25, 0.25, WRAP))
 assert_close(sample(T, 1.25, 0.25, CLAMP), sample(T, 1.00, 0.25, CLAMP))
```

The off-by-half-a-texel bug is the single most common texture bug in real code, and this
test catches it.

**G2.4 — Mip selection from quad derivatives.**
Given the four texture coordinates of a quad, compute
`ρ = max(‖∂(uW,vH)/∂x‖, ‖∂(uW,vH)/∂y‖)` and `λ = log₂ ρ`, and implement trilinear sampling
across `floor(λ)` and `floor(λ)+1`.

```
 # a quad whose footprint is exactly 2 texels per pixel in u, 0 in v
 quad_uv = [(0,0), (2/W, 0), (0, 0), (2/W, 0)]
 assert_close(lambda_from_quad(quad_uv, W, H), 1.0)
 # a quad at exactly 1:1 texel:pixel
 assert_close(lambda_from_quad(one_to_one_quad, W, H), 0.0)
 # trilinear at λ = 1.0 must equal the level-1 bilinear result exactly
 assert_close(sample_trilinear(mips, uv, lam=1.0), sample_bilinear(mips[1], uv))
```

Then the payoff: render a receding checkerboard plane with (a) point sampling from level 0,
(b) bilinear from level 0, (c) trilinear with computed λ. Compute the variance of the output
in the far third of the image for each. Assert (c) < (b) < (a) by a wide margin. **That
number is aliasing, measured.**

**G2.5 — Early-Z, measured.**
Add a global fragment-shader invocation counter. Render two overlapping full-screen-ish
triangles at different depths, with early-Z enabled (test before shading):

```
 n_back_to_front = render([far_tri, near_tri], early_z=True)
 n_front_to_back = render([near_tri, far_tri], early_z=True)
 assert n_front_to_back < n_back_to_front            # sorting matters, a lot

 # now make the shader discard: early-Z write must be disabled
 n_fb_discard = render([near_tri, far_tri], early_z=True, shader_discards=True)
 assert n_fb_discard == n_back_to_front              # the saving is gone
```

This is the cheapest possible demonstration of why `discard` in a shader is expensive, and
it is a fact students otherwise memorise without understanding.

**G2.6 — CAPSTONE: software-rasterise a spinning cube, checked by framebuffer hash.**

The complete chain, end to end, in one program:

- 8 vertices, 12 triangles, per-face UVs.
- Model matrix = rotation by a fixed angle `θ_k = k · 2π/120` about a fixed axis.
- View matrix from `look_at`. Projection from `perspective`. Viewport transform.
- Backface cull by the sign of the screen-space signed area.
- Edge-function rasterisation with 8 subpixel bits and the top-left rule.
- Perspective-correct interpolation of UV (interpolate `u/w`, `v/w`, `1/w`, divide).
- A procedurally generated checkerboard texture with a full mip chain, sampled trilinearly
  with λ computed from the quad's derivatives.
- A 32-bit float Z-buffer with a `LESS` test.
- Output RGBA8.

**Check:** for k ∈ {0, 30, 60, 90}, compute the SHA-256 of the raw RGBA8 framebuffer bytes
and compare against a reference hash.

Two notes that make this a real engineering exercise rather than a toy:

- **Determinism is the hard part, and that is the point.** To make the hash reproducible
  across machines and compilers you must pin the arithmetic: do triangle setup in `double`
  or in exact integer fixed-point, specify the rounding of the fixed-point snap, avoid
  `-ffast-math`, and avoid any reduction whose order is unspecified. Students discover that
  "the same program produces the same pixels" is a *design constraint*, not a given. This is
  exactly the constraint that makes GPU cross-vendor image comparison hard, and it is why
  conformance tests specify tolerances rather than hashes.
- **Provide a fallback check** for students whose platform cannot be made bit-exact: assert
  a perceptual metric (mean absolute error < 1/255 per channel against a reference PNG)
  instead of a hash. Give both.

Extensions, each of which is a one-line change that teaches something:
turn off perspective-correct interpolation (watch PS1 warping appear); turn off the mip
chain (watch the checkerboard alias); turn off backface culling and count the extra
fragments; turn off the Z-buffer and render back-to-front instead (the painter's algorithm,
and why it fails on interpenetrating geometry).

---

## Unit G3 — Why the SM is shaped like that

> **THE ONE IDEA.** Every structural feature of a CUDA Streaming Multiprocessor — the warp,
> the scratchpad, the read-only cache, the absurdly large register file, the atomics — was
> built to render triangles. And the moment NVIDIA merged the vertex and pixel shader units
> into one core (Tesla, G80, 2006), that core was a general parallel processor whether or
> not anyone called it one. **CUDA did not make the GPU programmable; unification did, and
> CUDA supplied the missing four things: scatter, pointers, an addressable scratchpad, and
> permission to stop pretending your array was a texture.**

**Depends on:** G2 (you must have felt the quad before this lands).
**Leads directly into:** the CUDA execution model unit, which now reads as a translation
table rather than a list of axioms.

### Content

1. The six rungs: fixed function → register combiners → programmable VS/PS → the load
   balancing crisis → unified shader (Xenos 2005, G80 2006) → CUDA. Read the actual
   [TESLA] quotes aloud; they are better than any paraphrase.
2. The G80 SM as it shipped, with numbers, from [TESLA].
3. **The translation table** (§3.5). This is the artefact of the unit. Students should be
   able to reproduce it from memory by the end.
4. Each of the five connections in §3.1–3.4 and §3.6, stated as origin → consequence.
5. GPGPU prehistory told properly (§5.5): the dictionary, the gather-only constraint, the
   ping-pong, Brook, CTM, and what CUDA actually added.
6. TBDR (§3.6) as the road taken on every phone, with the bandwidth arithmetic.

### Exercises (machine-checkable)

**G3.1 — GPGPU by hand: live under the gather-only constraint.**
Implement a tiny framework where a "kernel" is a function `f(output_index, textures) ->
value` — it may read anywhere but may only write to its own index. Then, under that
constraint:

(a) A 1D 3-tap blur. Easy — it is naturally a gather.

(b) A sum reduction of `N = 1024` floats. It takes ⌈log₂ N⌉ passes, each rendering to a
target half the size.

```
 result, passes = reduce_gather_only(data_1024)
 assert passes == 10
 assert_close(result, sum(data_1024))
 assert total_work(passes) == 1024 + 512 + 256 + ... + 1   # == 2047
```

(c) A 256-bin histogram of 1M values. Under gather-only this is *hard* — the natural
formulation is a scatter. Have the student implement it two ways: the gather formulation
(each output bin scans... which is O(bins × N), catastrophic) and the ROP trick (render one
additive-blended point per input value, letting the blend unit do the scatter). Then
implement it with scatter (`atomicAdd`-equivalent) and compare the work:

```
 assert work_gather_only(N=1_000_000, bins=256) > 100 * work_with_scatter(N=1_000_000)
```

**Twenty lines of code make the entire pre-CUDA era comprehensible.** This is the highest
value-per-line exercise in the report.

**G3.2 — Divergence is spatial.**
Rasterise a triangle into quads (reuse G2.2). Now, for each quad, evaluate two different
branch predicates over its four pixels and count the fraction of quads where the four lanes
do not agree:

```
 # (a) a branch on a screen-space checkerboard — worst case
 assert divergent_fraction(lambda x,y: (x+y) % 2 == 0) == 1.0

 # (b) a branch on which triangle the fragment belongs to — only edges diverge
 f = divergent_fraction_two_triangles()
 assert f < 0.15                              # roughly perimeter/area

 # (c) a branch on a smoothly varying quantity thresholded (e.g. u > 0.5)
 # diverges only along one contour line
 assert divergent_fraction(lambda x,y: u(x,y) > 0.5) < 0.10
```

Then state the transfer explicitly: in CUDA the same structure holds — `if (tid % 2)` is
the checkerboard, and `if (tid < n)` is the contour. Divergence is about *how your
predicate is laid out over the lane index*, and graphics is where that intuition came from
because there the lane index *is* a screen position.

**G3.3 — Texture-cache locality: linear vs Morton layout.**
Implement a 2D array in row-major layout and in Morton/Z-order layout. Simulate a 64-byte
cache line and, for a 5×5 stencil evaluated over each 2×2 output quad, count the number of
*distinct cache lines* touched.

```
 lines_linear = count_lines(layout=ROW_MAJOR, W=1024, H=1024, stencil=5)
 lines_morton = count_lines(layout=MORTON,    W=1024, H=1024, stencil=5)
 assert lines_morton < lines_linear
 assert lines_linear / lines_morton > 1.5     # the exact ratio depends on element size
```

Then run the same two layouts as a real CPU benchmark and observe that the wall-clock ratio
tracks the cache-line ratio. **This is why `cudaArray` is opaque**, and it is why blocking a
GEMM or a stencil is not a trick but an alignment with the machine's shape.

**G3.4 — TBDR bandwidth budget.**
Compute off-chip bytes per frame for a 1920×1080 frame with overdraw *d* and *T* triangles:

```
 IMR:   fragments = 1920*1080*d
        bytes = fragments * (4 depth_read + 4 depth_write + 4 colour_write)
 TBDR:  bytes = 1920*1080*4                       # one colour write per pixel, depth never stored
              + T * bytes_per_binned_primitive    # the parameter buffer — the TBDR tax
```

```
 assert imr_bytes(d=4) / tbdr_bytes(d=4, T=100_000,   b=48) > 5.0   # fragment-heavy: TBDR wins big
 assert imr_bytes(d=1) / tbdr_bytes(d=1, T=2_000_000, b=48) < 1.0   # geometry-heavy: TBDR loses
```

Then find the break-even triangle count for a given overdraw. **The answer is not "TBDR is
better"; the answer is "it depends on your fragment-to-geometry ratio, and that is why the
architectures diverged along the mobile/desktop line."** Students who can compute this
break-even understand mobile GPUs.

**G3.5 — The lineage quiz (assertable as a written test).**
Given each hardware or API feature, name the graphics stage it descends from and the reason.
The answer key is the table in §3.5. Features to cover: warp size 32; `__shared__`;
`__syncthreads()`; `__shfl_sync`; the 256 KB register file; `__ldg`; `cudaArray`'s opaque
layout; the coalescing rules; global `atomicAdd`; PTX; occupancy as a metric; the absence of
a branch predictor.

A student who can answer all twelve has the whole report.

---

# Part 7 — Suggested reading order and the handoff to CUDA

```
 G1 ──► G2 ──► G3 ──► [CUDA execution model] ──► [CUDA memory model] ──► ...
 why      how      why the SM      now it is a
 it is    a tri     is shaped      translation,
 hard     becomes   like that      not a list of
          pixels                   axioms
```

The handoff sentence into the CUDA unit should be, roughly:

> You have now written a rasteriser. You know why fragments come in 2×2 blocks, why there
> is a 32-wide lane group, why there is a small fast scratchpad next to the ALUs, why the
> register file is enormous, why the texture path is separate and read-only, and why
> atomics live at the memory partition. Everything in the CUDA execution model is one of
> those things with the graphics filed off. Here is the table.

---

# Part 8 — What could not be verified, and where sources disagree

> **Appendix A supersedes part of this list.** Five of the Part 6 exercises were
> subsequently implemented in C++ and executed on the live Compiler Explorer API; §A.8 lists
> the three assertion bounds that turned out to be wrong, and §A.9 states what that
> verification does *not* cover. Everything below still stands for Parts 1–5.

### Could not fetch / verify in this pass

1. **The web search budget for this session was exhausted before this research began**
   (200/200 WebSearch calls used by earlier reports in the queue). All sourcing here was
   done by direct `WebFetch` and `curl` of URLs known in advance. This means **no
   independent search was performed to look for contradicting sources**, and topics where I
   did not already know a good URL are less well covered than they should be. Treat this as
   the single largest caveat on the report.
2. **Pineda 1988** — J. Pineda, "A Parallel Algorithm for Polygon Rasterization,"
   *SIGGRAPH '88*, pp. 17–20 — is cited from established knowledge. **The paper itself was
   not fetched.** The edge-function formulation and the incremental-evaluation property are
   independently confirmed by [GIESEN-6]; only the attribution is unverified here.
3. **ARM Mali tile-based rendering documentation could not be retrieved.**
   `developer.arm.com/documentation/102662` and `.../102696` both 301-redirect to
   `support.arm.com`, which serves a JavaScript shell with no content to a scripted fetch.
   The community-blog "Mali GPU: An Abstract Machine" series URL 404s after its redirect.
   **The TBDR section therefore rests on Apple's Metal documentation and Wikipedia's
   *Tiled rendering* article, not on Arm primary sources.** Specifically unverified: Mali's
   exact tile size, the "transaction elimination" mechanism, and Forward Pixel Kill.
4. **The Apple Metal TBDR page returned a thin fetch.** The summary that came back is
   plausible and matches the page's title and Apple's documented model (tiling phase /
   rendering phase, tile memory, hidden surface removal, imageblocks), but the fetched
   content was light on direct quotation. **The Apple TBDR claims should be re-verified
   against the live page before publication.**
5. **The NVIDIA Tesla IEEE Micro paper was fetched from a CMU course mirror**, not from
   IEEE. The PDF's text extraction is two-column and interleaved, so quoted sentences were
   reassembled by reading the extracted columns. I am confident in every quotation used
   (each was read in context), but a publication-grade citation should be checked against
   the IEEE version.
6. **The Turing whitepaper is a 16 MB PDF that exceeded WebFetch's limit**; it was
   downloaded with `curl` and extracted with `pdftotext`. Quotations are from that
   extraction and are clean.
7. **`__ldg` and the Kepler read-only data cache.** The CUDA Programming Guide's texture
   section and the Kepler Tuning Guide both failed to fetch (the guide URL returned only
   the table of contents; the tuning guide 404'd). **The claims about `__ldg`, the
   `const __restrict__` inference, and the commonly-quoted 48 KB read-only cache size are
   from established knowledge and were not verified in this pass.** The *lineage* claim —
   that this path is the texture cache — is architecturally uncontroversial but should be
   sourced properly before printing.
8. **The 9-bit fixed-point precision of CUDA/GPU hardware bilinear interpolation weights**
   is from established knowledge (it appears in the CUDA Programming Guide's texture
   appendix) and was not verified here.
9. **Register combiners** (`NV_register_combiners`, GeForce 256/GeForce 2 era, ~1999–2001)
   and `ATI_fragment_shader` are described from established knowledge and OpenGL extension
   history. No primary source was fetched. The *narrative* rung — fixed formula →
   configurable dataflow → program — is my framing, not a sourced claim.
10. **AMD wave64/wave32 as 16/8 quads, and Intel's SIMD8/16/32 fragment dispatch modes**,
    are established architecture knowledge (AMD GCN/RDNA ISA docs and Intel's Gen
    architecture documents) but were not re-verified in this pass. The [TESLA] statement
    about NVIDIA's 8-quads-per-warp **is** verified and quoted.
11. **Direct3D 12's release date** (with Windows 10, July 2015) is from established
    knowledge; the Wikipedia Vulkan page confirms D3D12 exists as the contemporary explicit
    API but a Microsoft primary source was not fetched.
12. **Slang's adoption by Khronos (2025)** is from established knowledge and is flagged in
    the table. Do not print it without checking.
13. **Nanite's software rasteriser for micro-triangles** is from Epic's published SIGGRAPH
    2021 talk ("A Deep Dive into Nanite Virtualized Geometry") and is widely reported, but
    the talk was not fetched here.
14. **The "UAV writes from a fragment shader disable early-Z" item** in §2.7 is vendor
    guidance and established practice, not something [GIESEN-7] states. Giesen's list is
    shader-depth-write, discard, alpha test, and alpha-to-coverage; those four are sourced,
    the fifth is not.
15. **Energy per bit for off-chip DRAM vs on-chip SRAM** — I said "something like two orders
    of magnitude" in §3.6. The commonly cited figures (Horowitz, ISSCC 2014) support roughly
    that ratio, but the number was not verified here and should be given a real citation or
    softened.

### Figures I computed rather than sourced

16. **All frame-budget arithmetic in §1.2 and §1.3 is my own calculation** from stated
    assumptions (resolution, refresh, overdraw, FLOP/fragment, texture samples/fragment).
    The arithmetic is checkable and the assumptions are stated, but the *assumptions* —
    3× overdraw, 200 FLOP/fragment, 8 samples/fragment — are representative figures, not
    measurements. Do not present them as facts about any particular game.
17. **The quad-efficiency model `A/(A + 2P)`** in §2.6 is my own approximation. It is
    asymptotic and demonstrably wrong below side ≈ 8 pixels. It is offered as a sanity
    target for exercise G2.2, whose real job is to *measure* the true value. [GIESEN-8]'s
    "25–75% wasted at triangle edges" **is** the sourced claim.
18. **The 5.1 TFLOP/s peak-CPU figure** in §1.3 assumes 16 cores, 5 GHz, two AVX-512 FMA
    units per core, and no clock throttling — none of which coexist on a real part
    (AVX-512-heavy code downclocks substantially). Treat it as a generous upper bound that
    makes the argument *harder* for the GPU, which is the point.
19. **The TBDR break-even arithmetic** in exercise G3.4 uses a made-up 48 bytes per binned
    primitive. The real parameter-buffer cost per primitive is vendor-specific and not
    published. The exercise's value is the *shape* of the trade-off, not the crossover
    point.

### Source disagreements and things to double-check

20. **DLSS 4.5 (January 2026)** appears in the Wikipedia summary I fetched but I have no
    corroborating source. Given the report's date (September 2026) this may well be right,
    but **check it against NVIDIA before printing a version table.** The DLSS 1.0 → 4.0
    entries are consistent with the Turing whitepaper and general reporting.
21. **FSR 4 vs "FSR Redstone".** The Wikipedia fetch labelled the 2025 ML generation
    "Redstone" and dated it August 2025+. AMD announced **FSR 4** with RDNA 4 in March 2025,
    and "Redstone" is (as I understand it) the name of a *later* bundle of ML features
    (ray regeneration, neural radiance caching, frame generation) built on FSR 4. **These
    may be two different things and the Wikipedia summary may have conflated them.**
    Verify before printing.
22. **"Xenos was first."** The claim that ATI's Xenos in the Xbox 360 (2005) shipped the
    first unified shader architecture comes from Wikipedia's *Unified shader model* article
    and is consistent with [TESLA]'s remark that "*The XBox 360 introduced an early unified
    [architecture]*." Both agree, so this one is solid; noted only because it is often
    stated the other way round in NVIDIA-centric histories.
23. **[TESLA] gives G80 as 16 SMs / 128 SPs / 8 TPCs.** The `nvidia-architectures.md`
    report in this same research directory flags that "G80 = 16 SMs" came only from
    secondary write-ups there. **It is now primary-sourced**: the IEEE Micro paper states it
    directly. Worth propagating that correction back to §14 note 12 of that report.
24. **`__syncthreads()` semantics vs [GIESEN-13]'s three barrier types.** Giesen describes
    D3D11's three barriers (group sync, group memory, device memory). The CUDA mapping I
    give (`__syncthreads()`, `__threadfence_block()`, `__threadfence()`) is my own and is
    close but not exact — `__syncthreads()` is both a sync *and* a group memory barrier in
    CUDA, whereas D3D11 separates `GroupMemoryBarrier()` from
    `GroupMemoryBarrierWithGroupSync()`. Present the table with that caveat.

### What is solidly sourced and can be stated as fact

- **Warp size 32 = eight 2×2 pixel quads** — [TESLA], direct quotation.
- **Quads exist for screen-space derivatives; 25–75% of edge-quad work is wasted; quads
  cannot be disabled because fixed-function blocks assume them** — [GIESEN-8].
- **The four early-Z disablers** (shader depth write, discard, alpha test,
  alpha-to-coverage) — [GIESEN-7].
- **Hierarchical Z stores per-tile Z-max and is strictly conservative; ~128 KB SRAM at
  2048²** — [GIESEN-7].
- **Texture L1 is 4–8 KB per sampler; ~1.25 misses/request with mipmapping across a wide
  range of cache sizes; memory latency 400–800 cycles** — [GIESEN-4].
- **Blending is fixed function for area/power, latency-ordering, and bandwidth reasons;
  quads are sorted back into API order by primitive ID; ROPs own memory regions** —
  [GIESEN-9] and [TESLA].
- **GPU atomics execute at dedicated units at the cache, hashed by address, bypassing the
  shader cores; no false sharing** — [GIESEN-13].
- **A pass-through geometry shader measured 3–7× slower than no GS at all** — [GIESEN-10].
- **The unified-shader load-balancing argument, verbatim, and "the generality required of a
  unified processor opened the door to a completely new GPU parallel-computing
  capability"** — [TESLA].
- **G80: 128 SPs, 16 SMs, 8 TPCs, 8 SP + 2 SFU + 16 KB shared memory per SM, 768 concurrent
  threads, 32-thread warps, 24 warps per SM** — [TESLA].
- **RT core = two units (bounding-box test, ray-triangle intersection), traverses the BVH
  autonomously, saves "thousands of instruction slots per ray"; Pascal ~1.1 vs Turing 10+
  Giga Rays/s** — [TURING].
- **VRS: seven rates, per 16×16 region, 1×1 through 4×4, spatial texture or per-primitive,
  decoupled from visibility rate** — [TURING].
- **Tensor cores were introduced to GeForce specifically to make real-time deep learning
  (DLSS) possible in games** — [TURING].
- **Mesh shaders use a cooperative thread model like compute shaders; meshlets up to 64
  vertices / 126 primitives; the primitive distributor scanned the index buffer every draw**
  — [TURING] and NVIDIA's mesh shader blog.
- **Vulkan derives from AMD Mantle, donated to Khronos; Vulkan 1.0 on 16 Feb 2016; no global
  state; validation layers instead of runtime error checking** — [Wikipedia: Vulkan].
- **SPIR-V exists so drivers need not contain a high-level source compiler; consumed by
  Vulkan, OpenCL 2.1+, OpenGL 4.6; SPIR-V dropped SPIR's LLVM-IR basis** —
  [Wikipedia: SPIR-V].
- **PTX exists for the same reason, stated by NVIDIA in 2008** — [TESLA].
- **The CUDA SDK was made public on 15 February 2007** — [Wikipedia: CUDA].
- **DXR announced 19 March 2018, shipped 10 October 2018 with Windows 10 1809; DXR 1.1
  27 May 2020** — [Wikipedia: DirectX Raytracing].
- **Metal: June 2014, MSL is C++14-based via Clang/LLVM, C++17 in Metal 4** —
  [Wikipedia: Metal].

---

## Sources

Primary:

- E. Lindholm, J. Nickolls, S. Oberman, J. Montrym, "NVIDIA Tesla: A Unified Graphics and
  Computing Architecture," *IEEE Micro* 28(2), March–April 2008 —
  <https://www.cs.cmu.edu/afs/cs/academic/class/15869-f11/www/readings/lindholm08_tesla.pdf>
- *NVIDIA Turing GPU Architecture* whitepaper, WP-09183-001_v01 —
  <https://images.nvidia.com/aem-dam/en-zz/Solutions/design-visualization/technologies/turing-architecture/NVIDIA-Turing-Architecture-Whitepaper.pdf>
- "Introduction to Turing Mesh Shaders," NVIDIA Developer Blog —
  <https://developer.nvidia.com/blog/introduction-turing-mesh-shaders/>
- "Tailor your apps for Apple GPUs and tile-based deferred rendering," Apple Developer
  Documentation —
  <https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering>

Fabian Giesen, *A trip through the Graphics Pipeline 2011* (index:
<https://fgiesen.wordpress.com/2011/07/09/a-trip-through-the-graphics-pipeline-2011-index/>):

- Part 4, "Texture samplers" — <https://fgiesen.wordpress.com/2011/07/04/a-trip-through-the-graphics-pipeline-2011-part-4/>
- Part 5, "Primitive Assembly, Clip/Cull, Projection, and Viewport transform" — <https://fgiesen.wordpress.com/2011/07/05/a-trip-through-the-graphics-pipeline-2011-part-5/>
- Part 6, "(Triangle) rasterization and setup" — <https://fgiesen.wordpress.com/2011/07/06/a-trip-through-the-graphics-pipeline-2011-part-6/>
- Part 7, "Z/Stencil processing, 3 different ways" — <https://fgiesen.wordpress.com/2011/07/08/a-trip-through-the-graphics-pipeline-2011-part-7/>
- Part 8, "Pixel processing – 'fork phase'" — <https://fgiesen.wordpress.com/2011/07/10/a-trip-through-the-graphics-pipeline-2011-part-8/>
- Part 9, "Pixel processing – 'join phase'" — <https://fgiesen.wordpress.com/2011/07/12/a-trip-through-the-graphics-pipeline-2011-part-9/>
- Part 10, "Geometry Shaders" — <https://fgiesen.wordpress.com/2011/07/20/a-trip-through-the-graphics-pipeline-2011-part-10/>
- Part 13, "Compute Shaders" — <https://fgiesen.wordpress.com/2011/10/09/a-trip-through-the-graphics-pipeline-2011-part-13/>

Dates, timelines and product history (Wikipedia):

- <https://en.wikipedia.org/wiki/Unified_shader_model>
- <https://en.wikipedia.org/wiki/General-purpose_computing_on_graphics_processing_units>
- <https://en.wikipedia.org/wiki/CUDA>
- <https://en.wikipedia.org/wiki/Tiled_rendering>
- <https://en.wikipedia.org/wiki/Vulkan>
- <https://en.wikipedia.org/wiki/Metal_(API)>
- <https://en.wikipedia.org/wiki/Standard_Portable_Intermediate_Representation>
- <https://en.wikipedia.org/wiki/High-Level_Shader_Language>
- <https://en.wikipedia.org/wiki/WebGPU>
- <https://en.wikipedia.org/wiki/Deep_Learning_Super_Sampling>
- <https://en.wikipedia.org/wiki/FidelityFX_Super_Resolution>
- <https://en.wikipedia.org/wiki/DirectX_Raytracing>

---


---

# Appendix A — The exercises, verified on Compiler Explorer

Part 6 specifies the exercises. This appendix contains **working C++ for five of them,
every line of which was compiled and executed on the live Compiler Explorer API on
2026-09-01**, together with the output the API actually returned. Nothing here is
pseudo-code and nothing here is asserted from memory. Where a number in Part 6 was a guess,
this appendix corrects it with the measured value (see A.8).

## A.1 The API recipe

Compiler Explorer will **compile and run** C++ and hand back the program's `stdout`,
`stderr` and exit code. That makes it the right harness for a curriculum whose exercises
must be checkable without the student installing anything.

```
POST https://godbolt.org/api/compiler/<COMPILER_ID>/compile
Content-Type: application/json
Accept: application/json

{
  "source": "<the C++ source>",
  "lang": "c++",
  "allowStoreCodeDebug": true,
  "options": {
    "userArguments": "-O2 -std=c++20",
    "executeParameters": { "args": [], "stdin": "" },
    "compilerOptions": { "executorRequest": true },   <-- REQUIRED: this asks for a RUN
    "filters": { "execute": true }                    <-- REQUIRED
  }
}
```

The response carries `buildResult.code` (compiler exit status), `code` (the **program's**
exit status), `didExecute`, `execTime`, `okToCache`, and `stdout` / `stderr` as arrays of
`{"text": "<one line>"}` objects — **note the per-line objects: join them with newlines, not
with the empty string**, or every table you print collapses onto one line.

Compiler ids verified working for this material:

| id | compiler | verified |
|---|---|---|
| `g152` | GCC 15.2 | build 0, exec 0, all five exercises |
| `clang2010` | Clang 20.1.0 | build 0, exec 0, capstone bit-identical to GCC |

`GET https://godbolt.org/api/compilers/c++` lists the rest.

### Three practical facts, each of which cost a round trip to discover

1. **`assert` is live.** `NDEBUG` is not defined by the harness, at `-O0` or `-O2`. A failed
   assertion shows up as **`code: 139`** (SIGSEGV/abort) with the assertion text in
   `stderr`. That is exactly the pass/fail signal an auto-grader wants.
2. **`abort()` does not flush stdio.** A failing assert therefore *loses every line the
   program printed before it*, which makes debugging the exercise impossible. Every
   exercise below begins with

   ```cpp
   setvbuf(stdout, nullptr, _IONBF, 0);
   ```

   This is worth teaching in its own right — it is the same buffering lesson the
   curriculum's Unix unit makes about `printf` before a crash.
3. **Overload resolution on brace-initialised arguments.** `mul(M, {x,y,z,w})` is ambiguous
   when both `mul(M4,M4)` and `mul(M4,V4)` exist. Name them `mulm`/`mulv` or write
   `V4{...}`. (This was the first build failure of the session.)

## A.2 Compiler Explorer caches results — including `execTime`. Use a nonce.

**Verified, not assumed.** The same source submitted three times with no nonce, then the
same program submitted three times with a random comment line prepended:

```
--- identical source, submitted 3x (NO nonce) ---
 execTime=25  okToCache=True   wall=1.65s
 execTime=25  okToCache=True   wall=0.21s     <-- served from cache
 execTime=25  okToCache=True   wall=0.48s     <-- served from cache
--- same program, per-submission nonce ---
 execTime=25  okToCache=True   wall=1.64s
 execTime=28  okToCache=True   wall=1.59s
 execTime=26  okToCache=True   wall=1.67s
```

The frozen `execTime=25` and the collapse of wall time from 1.65 s to 0.21 s are the cache.
**A timing exercise submitted without a nonce measures nothing** — it replays a number from
CE's cache. The fix is one line:

```python
src = "// ce-nonce %s\n" % uuid.uuid4().hex + source
```

Note the corollary for exercise design: because CE's executor is a shared multi-tenant
sandbox, its timings are noisy even *with* a nonce (25/28/26 ms above is ±6% on an
identical program). **Design the exercises to assert on values, buffers and hashes, never
on wall-clock time.** Every exercise below obeys that rule; the quad-overshading exercise
(A.6), which is the one a student would naively write as a benchmark, instead *counts
lanes*, which is both exactly the quantity of interest and perfectly reproducible.

## A.3 — Exercise 1: the transform chain, asserting a known vertex lands on a known pixel

Maps to Part 6 exercise **G1.2**. The one idea it makes concrete: **the perspective
divide is the whole of perspective**, and it is not an affine operation, which is why `w`
exists and why the pipeline is 4-wide.

Configuration: identity model and view, `fovy = 90°`, aspect 1, near 1, far 100, an 800×800
viewport, OpenGL conventions (clip `z ∈ [−1,1]`, framebuffer origin bottom-left).

```cpp
// CE-G1.2  transform chain: model -> world -> view -> clip -> NDC -> screen
#include <cassert>
#include <cmath>
#include <cstdio>

struct M4 { double m[16]; };                 // column-major, m[col*4+row], like GLSL
static M4 identity(){ M4 r{}; for(int i=0;i<4;i++) r.m[i*4+i]=1; return r; }
static M4 mulm(const M4&A,const M4&B){ M4 r{};
  for(int c=0;c<4;c++) for(int row=0;row<4;row++){ double s=0;
    for(int k=0;k<4;k++) s += A.m[k*4+row]*B.m[c*4+k]; r.m[c*4+row]=s; } return r; }
struct V4 { double x,y,z,w; };
static V4 mulv(const M4&A,const V4&v){ return {
  A.m[0]*v.x+A.m[4]*v.y+A.m[8]*v.z+A.m[12]*v.w,
  A.m[1]*v.x+A.m[5]*v.y+A.m[9]*v.z+A.m[13]*v.w,
  A.m[2]*v.x+A.m[6]*v.y+A.m[10]*v.z+A.m[14]*v.w,
  A.m[3]*v.x+A.m[7]*v.y+A.m[11]*v.z+A.m[15]*v.w }; }

// OpenGL right-handed perspective, clip z in [-1,1], camera looks down -z.
static M4 perspective(double fovy_rad,double aspect,double n,double f){
  double t = 1.0/std::tan(fovy_rad*0.5); M4 r{};
  r.m[0]=t/aspect; r.m[5]=t;
  r.m[10]=(f+n)/(n-f); r.m[11]=-1.0; r.m[14]=2.0*f*n/(n-f);
  return r; }

struct V3{double x,y,z;};
static V3 sub(V3 a,V3 b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
static V3 cross(V3 a,V3 b){return {a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x};}
static double dot(V3 a,V3 b){return a.x*b.x+a.y*b.y+a.z*b.z;}
static V3 norm(V3 a){double l=std::sqrt(dot(a,a));return {a.x/l,a.y/l,a.z/l};}
// gluLookAt: rotation part is the transpose (= inverse) of the camera basis,
// translation part is the negated eye expressed in that basis.
static M4 look_at(V3 eye,V3 center,V3 up){
  V3 f = norm(sub(center,eye)), s = norm(cross(f,up)), u = cross(s,f);
  M4 r = identity();
  r.m[0]=s.x; r.m[4]=s.y; r.m[8]=s.z;
  r.m[1]=u.x; r.m[5]=u.y; r.m[9]=u.z;
  r.m[2]=-f.x;r.m[6]=-f.y;r.m[10]=-f.z;
  r.m[12]=-dot(s,eye); r.m[13]=-dot(u,eye); r.m[14]=dot(f,eye);
  return r; }
static M4 scale(double x,double y,double z){M4 r=identity();r.m[0]=x;r.m[5]=y;r.m[10]=z;return r;}

struct Screen{double x,y,z;};
static Screen project(const M4&MVP,V3 v,double W,double H){
  V4 clip = mulv(MVP,V4{v.x,v.y,v.z,1.0});
  double inv = 1.0/clip.w;                       // THE perspective divide
  double nx=clip.x*inv, ny=clip.y*inv, nz=clip.z*inv;
  return { (nx*0.5+0.5)*W, (ny*0.5+0.5)*H, nz*0.5+0.5 };  // GL viewport (y up)
}
static bool close(double a,double b,double e=1e-6){return std::fabs(a-b)<e;}

int main(){
  const double W=800,H=800;
  M4 M = identity(), V = identity();
  M4 P = perspective(M_PI/2, 1.0, 1.0, 100.0);   // fovy 90deg, aspect 1, n=1, f=100
  M4 MVP = mulm(P, mulm(V,M));

  Screen a = project(MVP, {0,0,-10}, W,H);
  printf("(0,0,-10)  -> screen (%.6f, %.6f)  z_window %.7f\n", a.x,a.y,a.z);
  assert(close(a.x,400.0)); assert(close(a.y,400.0)); assert(close(a.z,0.9090909,1e-6));

  Screen b = project(MVP, {10,0,-10}, W,H);      // 90deg fov => frustum edge at 45deg
  printf("(10,0,-10) -> screen x %.6f\n", b.x);
  assert(close(b.x,800.0));

  Screen c = project(MVP, {0,5,-10}, W,H);
  printf("(0,5,-10)  -> screen y %.6f\n", c.y);
  assert(close(c.y,600.0));

  // (a) the divide is NOT affine: the screen midpoint is not the projected midpoint
  V3 p={-5,0,-2}, q={5,0,-50}, mid={0,0,-26};
  double proj_of_mid  = project(MVP,mid,W,H).x;
  double mid_of_projs = 0.5*(project(MVP,p,W,H).x + project(MVP,q,W,H).x);
  printf("proj(mid)=%.4f  mid(proj)=%.4f  delta=%.4f\n",
         proj_of_mid, mid_of_projs, std::fabs(proj_of_mid-mid_of_projs));
  assert(std::fabs(proj_of_mid-mid_of_projs) > 1.0);

  // (b) look_at IS an inverse: V * (camera world matrix) == identity
  V3 eye={3,4,5}, ctr={0,0,0}, up={0,1,0};
  M4 Vm = look_at(eye,ctr,up);
  V4 o = mulv(Vm,V4{eye.x,eye.y,eye.z,1.0});        // the eye maps to the origin
  printf("V*eye = (%.9f, %.9f, %.9f)\n", o.x,o.y,o.z);
  assert(close(o.x,0)&&close(o.y,0)&&close(o.z,0));
  V4 fwd = mulv(Vm,V4{0,0,0,1.0});                  // the target sits on -z
  printf("V*target z = %.6f (must be negative = in front)\n", fwd.z);
  assert(fwd.z < 0);

  // (c) normals need the inverse transpose under non-uniform scale
  M4 S = scale(1,1,4);
  V3 n={0,1,1}, t={0,1,-1};                      // n . t == 0 in object space
  V3 t2 = { t.x, t.y, 4*t.z };                   // tangents transform by M
  V3 n_naive = norm(V3{ n.x, n.y, 4*n.z });      // WRONG
  V3 n_ok    = norm(V3{ n.x, n.y, n.z/4 });      // inverse-transpose of diag(1,1,4)
  printf("naive n.t = %.6f   inverse-transpose n.t = %.9f\n",
         dot(n_naive,norm(t2)), dot(n_ok,norm(t2)));
  assert(std::fabs(dot(n_ok,norm(t2))) < 1e-9);
  assert(std::fabs(dot(n_naive,norm(t2))) > 1e-2);

  printf("ALL TRANSFORM-CHAIN ASSERTIONS PASSED\n");
}
```

**Verified output** (`build=0 exec=0 didExecute=True execTime=23ms`):

```
(0,0,-10)  -> screen (400.000000, 400.000000)  z_window 0.9090909
(10,0,-10) -> screen x 800.000000
(0,5,-10)  -> screen y 600.000000
proj(mid)=400.0000  mid(proj)=-80.0000  delta=480.0000
V*eye = (0.000000000, 0.000000000, 0.000000000)
V*target z = -7.071068 (must be negative = in front)
naive n.t = -0.882353   inverse-transpose n.t = 0.000000000
ALL TRANSFORM-CHAIN ASSERTIONS PASSED
```

**What each assertion teaches.**

- `(0,0,-10) → (400, 400)` and `z_window = 0.9090909`: the centre of the screen, and a depth
  value that is already 91% of the way to 1.0 at only 10% of the way to the far plane. That
  single number *is* the `1/z` distribution — the motivation for reversed-Z in one line of
  output.
- `(10,0,-10) → x = 800`: with a 90° field of view the frustum edge is at 45°, so a point as
  far sideways as it is deep lands exactly on the screen edge. A student can check this on
  paper, which is the point.
- **`proj(mid) = 400.0` but `mid(proj) = −80.0`, a 480-pixel disagreement.** Linear
  interpolation in screen space is *wrong*, by a lot. This is the whole justification for
  perspective-correct interpolation (interpolate `attr/w` and `1/w`, divide at the end) and
  for the PlayStation 1's swimming textures.
- `V · eye = (0,0,0)`: `look_at` really is an inverse — the camera's own position maps to
  the origin of view space.
- The inverse-transpose assertion: under `scale(1,1,4)` the naively transformed normal has
  `n·t = −0.88` against a tangent it is supposed to be perpendicular to; the
  inverse-transpose normal has `n·t = 0.000000000`. Non-uniform scale breaks normals, and
  this is the two-line proof.

## A.4 — Exercise 2: edge-function rasterisation, diffed against a reference buffer

Maps to Part 6 exercise **G2.1**. The one idea: **a triangle becomes fragments by
evaluating three linear functions on a grid**, in integer arithmetic, and the top-left fill
rule — which is literally `subtract 1 from the constant term` — is what makes adjacent
triangles watertight.

```cpp
// CE-G2.1  edge-function rasterisation in fixed point with the top-left fill rule.
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#include <algorithm>

static const int SUB = 256;                 // 8 subpixel bits (D3D11 mandates 8)
struct P { int64_t x, y; };                 // fixed point, units of 1/256 pixel
static P snap(double x, double y){ return { (int64_t)llround(x*SUB), (int64_t)llround(y*SUB) }; }
static int64_t orient2d(P a, P b, P c){ return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x); }
// y grows downward: a top edge is horizontal going left; a left edge goes down.
static bool is_top_left(P a, P b){ return (a.y == b.y && b.x < a.x) || (b.y > a.y); }

static int raster(std::vector<uint8_t>& buf, int W, int H, P v0, P v1, P v2){
  if (orient2d(v0,v1,v2) < 0) std::swap(v1,v2);
  if (orient2d(v0,v1,v2) == 0) return 0;                 // degenerate, dropped in setup
  int64_t b0 = is_top_left(v1,v2) ? 0 : -1;              // THE ENTIRE FILL RULE:
  int64_t b1 = is_top_left(v2,v0) ? 0 : -1;              // subtract 1 from the constant
  int64_t b2 = is_top_left(v0,v1) ? 0 : -1;              // term of non-top-left edges
  int count = 0;
  for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x){
    P p { (int64_t)x*SUB + SUB/2, (int64_t)y*SUB + SUB/2 };      // pixel centre
    int64_t w0 = orient2d(v1,v2,p)+b0, w1 = orient2d(v2,v0,p)+b1, w2 = orient2d(v0,v1,p)+b2;
    if ((w0|w1|w2) >= 0){ buf[y*W+x]++; ++count; }               // same sign => inside
  }
  return count;
}
static std::string ascii(const std::vector<uint8_t>& b,int W,int H){
  std::string s; for(int y=0;y<H;++y){ for(int x=0;x<W;++x) s += b[y*W+x]?'#':'.'; s+='\n'; } return s; }
static uint64_t st = 0x9E3779B97F4A7C15ull;
static uint64_t rnd(){ st^=st<<13; st^=st>>7; st^=st<<17; return st; }
static double rf(double lo,double hi){ return lo+(hi-lo)*((rnd()>>11)*0x1.0p-53); }

int main(){
  setvbuf(stdout,nullptr,_IONBF,0);   // abort() does not flush stdio: unbuffer so a
                                      // failing assert still shows the output above it
  const int W=40,H=20;
  std::vector<uint8_t> buf(W*H,0);
  int n = raster(buf,W,H, snap(4.0,2.0), snap(35.0,6.0), snap(12.0,18.0));
  printf("covered=%d\n%s---\n", n, ascii(buf,W,H).c_str());

  // watertightness: split a CONVEX quad into two triangles sharing edge A-C.
  // Their union must tile the quad exactly: no pixel covered twice, no gap in the seam.
  int quads=2000, worst=0, seams=0;
  for(int i=0;i<quads;++i){
    std::vector<uint8_t> q(W*H,0);
    double cx=rf(8,W-8), cy=rf(5,H-5), R=rf(2.0,5.0);
    double th[4]; for(int k=0;k<4;++k) th[k]=rf(0,6.283185307179586);
    std::sort(th,th+4);                                   // angular order => convex
    P v[4]; for(int k=0;k<4;++k) v[k]=snap(cx+R*std::cos(th[k]), cy+R*std::sin(th[k]));
    int a=raster(q,W,H,v[0],v[1],v[2]), b=raster(q,W,H,v[0],v[2],v[3]);
    if(a&&b) ++seams;
    for(auto val:q) worst = std::max<int>(worst,val);
  }
  printf("watertight: %d convex quads (%d with both halves non-empty), max coverage/pixel = %d\n",
         quads, seams, worst);
  assert(worst<=1);                         // FAILS without the top-left rule

  // coverage vs analytic area: |covered - area| must be within about half the perimeter
  std::vector<uint8_t> big(W*H,0);
  double x0=2,y0=2,x1=37,y1=3,x2=6,y2=17;
  int nb = raster(big,W,H, snap(x0,y0), snap(x1,y1), snap(x2,y2));
  double area = std::fabs((x1-x0)*(y2-y0)-(y1-y0)*(x2-x0))*0.5;
  double per = std::hypot(x1-x0,y1-y0)+std::hypot(x2-x1,y2-y1)+std::hypot(x0-x2,y0-y2);
  printf("covered=%d  analytic area=%.2f  perimeter=%.2f  |err|=%.2f (bound %.2f)\n",
         nb, area, per, std::fabs(nb-area), per*0.5);
  assert(std::fabs(nb-area) < per*0.5);

  // the fill rule is not cosmetic: disable it and the seam double-covers.
  { std::vector<uint8_t> q(W*H,0);
    P A=snap(20.5,3.0),B=snap(33.0,10.0),C=snap(20.5,17.0),D=snap(8.0,10.0);
    auto naive=[&](P a,P b,P c){                                 // >=0 on every edge, no bias
      if(orient2d(a,b,c)<0) std::swap(b,c);
      for(int y=0;y<H;++y)for(int x=0;x<W;++x){ P p{(int64_t)x*SUB+SUB/2,(int64_t)y*SUB+SUB/2};
        if((orient2d(b,c,p)|orient2d(c,a,p)|orient2d(a,b,p))>=0) q[y*W+x]++; } };
    naive(A,B,C); naive(A,C,D);
    int dbl=0; for(auto v:q) if(v>1) ++dbl;
    printf("without the fill rule, the shared edge double-covers %d pixels\n", dbl);
    assert(dbl>0);
  }
  printf("ALL RASTERISER ASSERTIONS PASSED\n");
}
```

**Verified output** (`build=0 exec=0 didExecute=True execTime=22ms`):

```
covered=232
........................................
........................................
....####................................
.....###########........................
.....##################.................
......#########################.........
......############################......
.......#########################........
.......#######################..........
........####################............
........##################..............
.........###############................
.........##############.................
..........###########...................
..........#########.....................
...........######.......................
...........####.........................
............#...........................
........................................
........................................
---
watertight: 2000 convex quads (1459 with both halves non-empty), max coverage/pixel = 1
covered=261  analytic area=260.50  perimeter=84.55  |err|=0.50 (bound 42.28)
without the fill rule, the shared edge double-covers 14 pixels
ALL RASTERISER ASSERTIONS PASSED
```

**The three checks, and why each one is the right check.**

1. **The reference buffer.** The ASCII dump above is the reference: a student's
   implementation must reproduce it exactly. It is a real regression target, and the
   `covered=232` count is a second, coarser one.
2. **Watertightness over 2000 random convex quads, max coverage per pixel = 1.** This is the
   assertion that actually has teeth. A convex quad split into two triangles along a diagonal
   must tile exactly: every pixel covered once, none twice, no gap along the seam. *This
   test fails for any implementation without the top-left rule* — and the last check proves
   it, by rasterising the same quad with a naive `>= 0` test on every edge and finding
   **14 double-covered pixels** along a seam that runs through a column of pixel centres.
   Note the test must use a **convex** quad; with four random points the two triangles can
   genuinely overlap and the property does not hold. (This was a real bug in the first draft
   of the exercise, and it is worth showing students: the property test was wrong, not the
   rasteriser.)
3. **Coverage against analytic area**: 261 covered pixels against an exact area of 260.50,
   an error of 0.50 against a bound of half the perimeter (42.28). Rasterisation is an
   *unbiased* sampler of area, and the residual is a boundary effect.

**Why fixed point rather than float.** Two adjacent triangles must produce bit-identical
edge functions along their shared edge or the seam cracks. Floating point evaluated from two
different vertex orderings does not guarantee that; integers do. The exercise uses 8
subpixel bits, which is what D3D11 mandates.

## A.5 — Exercise 3: bilinear filtering against reference values

Maps to Part 6 exercise **G2.3**. The one idea: **texel (i,j) has its centre at
`u = (i+0.5)/W`**, so the sample point in texel space is `u·W − 0.5`, and forgetting that
half-texel is the most common texture bug in the industry.

```cpp
// CE-G2.3  bilinear filtering against reference values, texel-centre convention.
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <algorithm>

enum Addr { WRAP, CLAMP };
static int addr(int i, int n, Addr m){
  if (m == CLAMP) return std::min(std::max(i,0), n-1);
  int r = i % n; return r < 0 ? r + n : r;                 // WRAP (GL_REPEAT)
}
static float texel(const float* T,int W,int H,int i,int j,Addr m){
  return T[addr(j,H,m)*W + addr(i,W,m)]; }

// THE convention: texel (i,j) has its CENTRE at u = (i+0.5)/W. So the sample point in
// texel space is u*W - 0.5, and that -0.5 is the single most-forgotten half in graphics.
static float sample_bilinear(const float* T,int W,int H,float u,float v,Addr m){
  float x = u*W - 0.5f, y = v*H - 0.5f;
  int i0 = (int)std::floor(x), j0 = (int)std::floor(y);
  float fx = x - i0, fy = y - j0;
  float t00 = texel(T,W,H,i0,  j0,  m), t10 = texel(T,W,H,i0+1,j0,  m);
  float t01 = texel(T,W,H,i0,  j0+1,m), t11 = texel(T,W,H,i0+1,j0+1,m);
  return (t00*(1-fx) + t10*fx)*(1-fy) + (t01*(1-fx) + t11*fx)*fy;
}
// The common bug: forgetting the half-texel offset.
static float sample_wrong(const float* T,int W,int H,float u,float v,Addr m){
  float x = u*W, y = v*H;
  int i0=(int)std::floor(x), j0=(int)std::floor(y); float fx=x-i0, fy=y-j0;
  float t00=texel(T,W,H,i0,j0,m), t10=texel(T,W,H,i0+1,j0,m);
  float t01=texel(T,W,H,i0,j0+1,m), t11=texel(T,W,H,i0+1,j0+1,m);
  return (t00*(1-fx)+t10*fx)*(1-fy)+(t01*(1-fx)+t11*fx)*fy;
}
// Real texture units do not use float weights. NVIDIA quantises the fraction to 8 bits
// (1/256) before the blend; this is why hardware bilinear is not bit-exact with yours.
static float sample_hw8(const float* T,int W,int H,float u,float v,Addr m){
  float x=u*W-0.5f, y=v*H-0.5f;
  int i0=(int)std::floor(x), j0=(int)std::floor(y);
  float fx=std::round((x-i0)*256.f)/256.f, fy=std::round((y-j0)*256.f)/256.f;
  float t00=texel(T,W,H,i0,j0,m), t10=texel(T,W,H,i0+1,j0,m);
  float t01=texel(T,W,H,i0,j0+1,m), t11=texel(T,W,H,i0+1,j0+1,m);
  return (t00*(1-fx)+t10*fx)*(1-fy)+(t01*(1-fx)+t11*fx)*fy;
}
static bool close(float a,float b,float e=1e-5f){ return std::fabs(a-b)<e; }
#define CHK(expr,want) do{ float g=(expr); printf("%-46s = %.6f  (want %.6f)\n", #expr, g, (double)(want)); assert(close(g,(float)(want))); }while(0)

int main(){
  setvbuf(stdout,nullptr,_IONBF,0);
  const int W=2,H=2;
  float T[4] = { 0.f, 1.f,      // T[j=0]: texel(0,0)=0  texel(1,0)=1
                 2.f, 3.f };    // T[j=1]: texel(0,1)=2  texel(1,1)=3

  CHK(sample_bilinear(T,W,H,0.50f,0.50f,CLAMP), 1.5);   // exact centre: mean of all four
  CHK(sample_bilinear(T,W,H,0.25f,0.25f,CLAMP), 0.0);   // exactly on texel (0,0)'s centre
  CHK(sample_bilinear(T,W,H,0.75f,0.75f,CLAMP), 3.0);   // exactly on texel (1,1)'s centre
  CHK(sample_bilinear(T,W,H,0.75f,0.25f,CLAMP), 1.0);   // texel (1,0)
  CHK(sample_bilinear(T,W,H,0.25f,0.75f,CLAMP), 2.0);   // texel (0,1)
  CHK(sample_bilinear(T,W,H,0.50f,0.25f,CLAMP), 0.5);   // halfway between texels 0 and 1
  CHK(sample_bilinear(T,W,H,0.25f,0.50f,CLAMP), 1.0);   // halfway between texels 0 and 2

  // address modes
  printf("wrap(1.25,0.25)=%.6f  wrap(0.25,0.25)=%.6f\n",
    sample_bilinear(T,W,H,1.25f,0.25f,WRAP), sample_bilinear(T,W,H,0.25f,0.25f,WRAP));
  assert(close(sample_bilinear(T,W,H,1.25f,0.25f,WRAP), sample_bilinear(T,W,H,0.25f,0.25f,WRAP)));
  printf("clamp(1.25,0.25)=%.6f  clamp(1.00,0.25)=%.6f\n",
    sample_bilinear(T,W,H,1.25f,0.25f,CLAMP), sample_bilinear(T,W,H,1.00f,0.25f,CLAMP));
  assert(close(sample_bilinear(T,W,H,1.25f,0.25f,CLAMP), sample_bilinear(T,W,H,1.00f,0.25f,CLAMP)));

  // the half-texel bug is not subtle once you look for it
  float ok = sample_bilinear(T,W,H,0.25f,0.25f,CLAMP);
  float bad = sample_wrong(T,W,H,0.25f,0.25f,CLAMP);
  printf("at a texel centre: correct=%.4f  no-half-texel-offset=%.4f  error=%.4f\n", ok,bad,bad-ok);
  assert(std::fabs(bad-ok) > 0.4f);

  // hardware 8-bit weight quantisation: close, but never bit-exact
  double worst=0; int nq=0;
  for(int a=0;a<997;++a){ float u=(a+0.5f)/997.f;
    for(int b=0;b<101;++b){ float v=(b+0.5f)/101.f;
      double d=std::fabs(sample_bilinear(T,W,H,u,v,CLAMP)-sample_hw8(T,W,H,u,v,CLAMP));
      worst=std::max(worst,d); if(d>0) ++nq; } }
  printf("8-bit weight quantisation: worst |error| = %.6f over %d differing samples\n", worst, nq);
  assert(worst > 0.0 && worst < 0.02);      // small, non-zero: exactly the hardware story

  printf("ALL BILINEAR ASSERTIONS PASSED\n");
}
```

**Verified output** (`build=0 exec=0 didExecute=True execTime=22ms`):

```
sample_bilinear(T,W,H,0.50f,0.50f,CLAMP)       = 1.500000  (want 1.500000)
sample_bilinear(T,W,H,0.25f,0.25f,CLAMP)       = 0.000000  (want 0.000000)
sample_bilinear(T,W,H,0.75f,0.75f,CLAMP)       = 3.000000  (want 3.000000)
sample_bilinear(T,W,H,0.75f,0.25f,CLAMP)       = 1.000000  (want 1.000000)
sample_bilinear(T,W,H,0.25f,0.75f,CLAMP)       = 2.000000  (want 2.000000)
sample_bilinear(T,W,H,0.50f,0.25f,CLAMP)       = 0.500000  (want 0.500000)
sample_bilinear(T,W,H,0.25f,0.50f,CLAMP)       = 1.000000  (want 1.000000)
wrap(1.25,0.25)=0.000000  wrap(0.25,0.25)=0.000000
clamp(1.25,0.25)=1.000000  clamp(1.00,0.25)=1.000000
at a texel centre: correct=0.0000  no-half-texel-offset=1.5000  error=1.5000
8-bit weight quantisation: worst |error| = 0.005714 over 75247 differing samples
ALL BILINEAR ASSERTIONS PASSED
```

**The reference table is chosen so every value is checkable by hand** on the 2×2 texture
`[[0,1],[2,3]]`: the exact centre averages all four, the four texel centres return their
texels exactly, and the midpoints return midpoints. An implementation with the half-texel
bug returns **1.5 where the answer is 0.0** at a texel centre — a 1.5-unit error on a
0-to-3 range, which is why the check catches it immediately.

**The last assertion is the hardware one.** Real texture units do not blend with float
weights; NVIDIA quantises the interpolation fraction to 8 bits before the multiply. The
exercise reproduces that and measures a **worst-case error of 0.005714 across 75,247
differing samples** — small, bounded, and *never zero*. That is the concrete reason GPU
bilinear results are not bit-reproducible against a CPU reference, and it is the reason
graphics conformance tests specify tolerances rather than hashes.

## A.6 — Exercise 4: quad overshading waste, measured

Maps to Part 6 exercise **G2.2**, and this is the exercise that carries the report's
central argument. The rasteriser emits **aligned 2×2 quads**; every lane of an emitted quad
runs the fragment shader; lanes outside the triangle are **helper lanes** whose output is
discarded but which are required for `ddx`/`ddy` and therefore for mipmap selection.
Efficiency is `covered_pixels / (4 × quads_emitted)`.

The measurement is a *count*, not a timing, so it is exactly reproducible (A.2).

```cpp
// CE-G2.2  quad overshading: how much fragment-shader work small triangles waste.
// The rasteriser emits ALIGNED 2x2 quads. Every lane of an emitted quad runs the
// fragment shader; lanes outside the triangle are HELPER lanes whose output is thrown
// away, but which are needed for ddx/ddy (mipmap selection).
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <vector>
#include <set>
#include <algorithm>

static const int SUB=256;
struct P{ int64_t x,y; };
static P snap(double x,double y){ return {(int64_t)llround(x*SUB),(int64_t)llround(y*SUB)}; }
static int64_t o2d(P a,P b,P c){ return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
static bool tl(P a,P b){ return (a.y==b.y && b.x<a.x) || (b.y>a.y); }

// Rasterise into a coverage set and the set of aligned 2x2 quads touched.
struct Res{ long covered=0; long quads=0; };
static void raster_quads(P v0,P v1,P v2,int W,int H,Res& r,std::set<long>* quadset=nullptr){
  if(o2d(v0,v1,v2)<0) std::swap(v1,v2);
  if(o2d(v0,v1,v2)==0) return;
  int64_t b0=tl(v1,v2)?0:-1, b1=tl(v2,v0)?0:-1, b2=tl(v0,v1)?0:-1;
  int64_t mnx=std::min({v0.x,v1.x,v2.x}), mxx=std::max({v0.x,v1.x,v2.x});
  int64_t mny=std::min({v0.y,v1.y,v2.y}), mxy=std::max({v0.y,v1.y,v2.y});
  int x0=std::max(0,(int)(mnx/SUB)-1), x1=std::min(W-1,(int)(mxx/SUB)+1);
  int y0=std::max(0,(int)(mny/SUB)-1), y1=std::min(H-1,(int)(mxy/SUB)+1);
  std::set<long> local;
  for(int y=y0;y<=y1;++y) for(int x=x0;x<=x1;++x){
    P p{(int64_t)x*SUB+SUB/2,(int64_t)y*SUB+SUB/2};
    if((( o2d(v1,v2,p)+b0)|(o2d(v2,v0,p)+b1)|(o2d(v0,v1,p)+b2))>=0){
      r.covered++;
      long q = (long)(y>>1)*W + (x>>1);      // ALIGNED 2x2 quad id: the >>1 is the whole point
      if(quadset) quadset->insert(q); else local.insert(q);
    }
  }
  if(!quadset) r.quads += (long)local.size();
}

int main(){
  setvbuf(stdout,nullptr,_IONBF,0);
  const int W=512,H=512;
  printf("  side |  covered px |  quads | lanes shaded | efficiency | helper lanes\n");
  printf("-------+-------------+--------+--------------+------------+-------------\n");
  double sides[]={2,4,8,16,32,64,128}; double eff[7];
  for(int k=0;k<7;++k){
    double s=sides[k]; Res tot;
    // average over 16 subpixel placements so we measure the triangle, not lucky alignment
    for(int t=0;t<16;++t){
      double ox=200+ (t%4)*0.25, oy=200 + (t/4)*0.25;
      double h=s*std::sqrt(3.0)/2.0;
      raster_quads(snap(ox,oy),snap(ox+s,oy),snap(ox+s/2,oy+h),W,H,tot);
    }
    double lanes = 4.0*tot.quads;
    eff[k] = lanes>0 ? tot.covered/lanes : 0;
    printf(" %5.0f | %11ld | %6ld | %12.0f | %10.3f | %10.1f%%\n",
           s, tot.covered, tot.quads, lanes, eff[k], 100.0*(1.0-eff[k]));
  }
  assert(eff[0] < 0.40);                                   // side 2: catastrophic
  assert(eff[6] >= 0.85);                                  // side 128: amortised
  for(int k=1;k<7;++k) assert(eff[k] > eff[k-1]);          // monotone in triangle size

  // The same effect as geometric detail rises: one fixed screen region, more triangles.
  printf("\ntessellating a fixed 256x256 screen region into an N x N grid of quads:\n");
  printf("   N |  triangles | covered px |  quads | efficiency\n");
  double prev=1e9;
  for(int N : {4,16,64,128,256}){
    std::set<long> qs; Res r;
    double step=256.0/N;
    for(int j=0;j<N;++j) for(int i=0;i<N;++i){
      double x=100+i*step, y=100+j*step;
      raster_quads(snap(x,y),snap(x+step,y),snap(x,y+step),W,H,r,&qs);
      raster_quads(snap(x+step,y),snap(x+step,y+step),snap(x,y+step),W,H,r,&qs);
    }
    // per-triangle quads must be counted per triangle, not deduplicated across the mesh:
    // a quad straddling two triangles is shaded twice. Recount that way.
    Res r2; for(int j=0;j<N;++j) for(int i=0;i<N;++i){
      double x=100+i*step,y=100+j*step;
      raster_quads(snap(x,y),snap(x+step,y),snap(x,y+step),W,H,r2);
      raster_quads(snap(x+step,y),snap(x+step,y+step),snap(x,y+step),W,H,r2);
    }
    double e = r2.covered/(4.0*r2.quads);
    printf(" %3d | %10d | %10ld | %6ld | %9.3f\n", N, 2*N*N, r2.covered, r2.quads, e);
    assert(e < prev); prev=e;                              // finer mesh => worse efficiency
  }
  printf("\nALL QUAD-OVERSHADING ASSERTIONS PASSED\n");
}
```

**Verified output** (`build=0 exec=0 didExecute=True execTime=82ms`):

```
  side |  covered px |  quads | lanes shaded | efficiency | helper lanes
-------+-------------+--------+--------------+------------+-------------
     2 |          24 |     16 |           64 |      0.375 |       62.5%
     4 |         103 |     55 |          220 |      0.468 |       53.2%
     8 |         427 |    166 |          664 |      0.643 |       35.7%
    16 |        1741 |    552 |         2208 |      0.788 |       21.2%
    32 |        7030 |   1994 |         7976 |      0.881 |       11.9%
    64 |       28249 |   7539 |        30156 |      0.937 |        6.3%
   128 |      113255 |  29268 |       117072 |      0.967 |        3.3%

tessellating a fixed 256x256 screen region into an N x N grid of quads:
   N |  triangles | covered px |  quads | efficiency
   4 |         32 |      65536 |  16896 |     0.970
  16 |        512 |      65536 |  18432 |     0.889
  64 |       8192 |      65536 |  24576 |     0.667
 128 |      32768 |      65536 |  32768 |     0.500
 256 |     131072 |      65536 |  65536 |     0.250

ALL QUAD-OVERSHADING ASSERTIONS PASSED
```

**Read the second table again.** In every row the triangles cover the *same* 65,536
pixels of screen. Only the geometric detail changes. At `N = 256` — one-pixel triangles —
the machine shades **262,144 lanes to produce 65,536 pixels**: efficiency exactly **0.250**,
the theoretical floor, three quarters of the fragment shader thrown away.

That single row is:

- the reason **tessellating until triangles are pixel-sized destroys performance**, and why
  the D3D11 tessellation stage never became the revolution it was sold as;
- the motivation for **mesh shaders** and for **Nanite's software rasteriser for
  micro-triangles** — below about a pixel per triangle, the fixed-function path's setup cost
  and 25% shading efficiency lose to a compute shader;
- the motivation for **variable rate shading**, which is precisely the ability to decouple
  the shading rate from the 1-invocation-per-pixel default;
- and the reason **divergence is a spatial concern** on a GPU. The lanes of a warp are
  eight 2×2 tiles of screen. Their fate is decided by geometry, not by the program.

The first table's monotone climb from 0.375 at side 2 to 0.967 at side 128 is the same fact
as a function of triangle size, and it brackets Giesen's stated "25–75% of the shading work
for quads generated for triangle edges is wasted".

## A.7 — Exercise 5 (capstone): a spinning textured cube, checked by framebuffer hash

Maps to Part 6 exercise **G2.6**. The entire chain in one program, with no library: model
/ view / projection matrices, the perspective divide, the viewport transform, backface
culling by the sign of the screen-space signed area, fixed-point edge functions with the
top-left rule, **shading in aligned 2×2 quads with live helper lanes**, perspective-correct
interpolation of UV via `u/w` and `1/w`, mip level selection from the quad's own finite
differences, trilinear filtering over a box-filtered mip chain, a depth buffer with a `LESS`
test, RGBA8 output, and an FNV-1a hash of the framebuffer as the check.

```cpp
// CE-G2.6  CAPSTONE: software-rasterise a spinning textured cube, check by framebuffer hash.
// The whole chain: M/V/P -> perspective divide -> viewport -> backface cull ->
// fixed-point edge functions with the top-left rule -> 2x2 QUAD shading with helper lanes
// -> perspective-correct UV -> mip selection from quad derivatives -> trilinear ->
// Z-buffer -> RGBA8 -> FNV-1a hash.
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>
#include <algorithm>

static const int FBW=96, FBH=96, SUB=256;

// ---- determinism knob: libm sin/cos may differ by an ulp between platforms, and one
// ulp is enough to change a pixel and therefore the hash. Quantise to 2^-20.
static double q20(double x){ return std::round(x*1048576.0)/1048576.0; }

struct M4{ double m[16]; };                       // column-major
static M4 mulm(const M4&A,const M4&B){ M4 r{};
  for(int c=0;c<4;c++)for(int i=0;i<4;i++){ double s=0; for(int k=0;k<4;k++) s+=A.m[k*4+i]*B.m[c*4+k]; r.m[c*4+i]=s; } return r; }
struct V4{ double x,y,z,w; };
static V4 mulv(const M4&A,const V4&v){ return {
  A.m[0]*v.x+A.m[4]*v.y+A.m[8]*v.z+A.m[12]*v.w, A.m[1]*v.x+A.m[5]*v.y+A.m[9]*v.z+A.m[13]*v.w,
  A.m[2]*v.x+A.m[6]*v.y+A.m[10]*v.z+A.m[14]*v.w, A.m[3]*v.x+A.m[7]*v.y+A.m[11]*v.z+A.m[15]*v.w }; }
static M4 ident(){ M4 r{}; for(int i=0;i<4;i++) r.m[i*4+i]=1; return r; }
static M4 persp(double fovy,double a,double n,double f){ double t=1.0/std::tan(fovy*0.5); M4 r{};
  r.m[0]=q20(t/a); r.m[5]=q20(t); r.m[10]=(f+n)/(n-f); r.m[11]=-1; r.m[14]=2*f*n/(n-f); return r; }
static M4 translate(double x,double y,double z){ M4 r=ident(); r.m[12]=x;r.m[13]=y;r.m[14]=z; return r; }
static M4 rot_axis(double ax,double ay,double az,double th){       // Rodrigues
  double l=std::sqrt(ax*ax+ay*ay+az*az); ax/=l;ay/=l;az/=l;
  double c=q20(std::cos(th)), s=q20(std::sin(th)), t=1-c; M4 r=ident();
  r.m[0]=q20(t*ax*ax+c);    r.m[4]=q20(t*ax*ay-s*az); r.m[8] =q20(t*ax*az+s*ay);
  r.m[1]=q20(t*ax*ay+s*az); r.m[5]=q20(t*ay*ay+c);    r.m[9] =q20(t*ay*az-s*ax);
  r.m[2]=q20(t*ax*az-s*ay); r.m[6]=q20(t*ay*az+s*ax); r.m[10]=q20(t*az*az+c);
  return r; }

// ---- procedural checkerboard texture + full box-filtered mip chain -------------------
struct Mip{ int w,h; std::vector<double> c; };     // single channel, 0..1
static std::vector<Mip> make_mips(int N){
  std::vector<Mip> mips; Mip l0{N,N,std::vector<double>(N*N)};
  for(int y=0;y<N;++y)for(int x=0;x<N;++x) l0.c[y*N+x] = (((x>>2)+(y>>2))&1)?1.0:0.05;
  mips.push_back(l0);
  while(mips.back().w>1){ const Mip&p=mips.back(); Mip n{p.w/2,p.h/2,std::vector<double>((p.w/2)*(p.h/2))};
    for(int y=0;y<n.h;++y)for(int x=0;x<n.w;++x)
      n.c[y*n.w+x]=0.25*(p.c[(2*y)*p.w+2*x]+p.c[(2*y)*p.w+2*x+1]+p.c[(2*y+1)*p.w+2*x]+p.c[(2*y+1)*p.w+2*x+1]);
    mips.push_back(n); }
  return mips; }
static double bilin(const Mip&m,double u,double v){
  double x=u*m.w-0.5, y=v*m.h-0.5;                 // texel-centre convention (the -0.5)
  int i0=(int)std::floor(x), j0=(int)std::floor(y); double fx=x-i0, fy=y-j0;
  auto T=[&](int i,int j){ i=((i%m.w)+m.w)%m.w; j=((j%m.h)+m.h)%m.h; return m.c[j*m.w+i]; };
  return (T(i0,j0)*(1-fx)+T(i0+1,j0)*fx)*(1-fy)+(T(i0,j0+1)*(1-fx)+T(i0+1,j0+1)*fx)*fy; }
static double trilin(const std::vector<Mip>&mips,double u,double v,double lam){
  if(lam<=0) return bilin(mips[0],u,v);
  int L=(int)mips.size()-1; if(lam>=L) return bilin(mips[L],u,v);
  int l0=(int)std::floor(lam); double f=lam-l0;
  return bilin(mips[l0],u,v)*(1-f)+bilin(mips[l0+1],u,v)*f; }

struct Vtx{ double sx,sy,z,invw,uow,vow; };        // screen x/y, ndc z, 1/w, u/w, v/w
static int64_t o2d(int64_t ax,int64_t ay,int64_t bx,int64_t by,int64_t cx,int64_t cy){
  return (bx-ax)*(cy-ay)-(by-ay)*(cx-ax); }

int main(){
  setvbuf(stdout,nullptr,_IONBF,0);
  auto mips = make_mips(64);
  printf("mip chain: %zu levels (64x64 down to 1x1)\n", mips.size());

  const double cube[8][3]={{-1,-1,-1},{1,-1,-1},{1,1,-1},{-1,1,-1},{-1,-1,1},{1,-1,1},{1,1,1},{-1,1,1}};
  const int face[6][4]={{4,5,6,7},{1,0,3,2},{0,4,7,3},{5,1,2,6},{3,7,6,2},{0,1,5,4}};
  const double fuv[4][2]={{0,0},{1,0},{1,1},{0,1}};

  long helper_total=0, covered_total=0;
  for(int k : {0,30,60,90}){
    double th = k*2.0*M_PI/120.0;
    M4 M = mulm(translate(0,0,-4.5), rot_axis(1,1,1,th));
    M4 P = persp(M_PI/3.0, 1.0, 1.0, 20.0);
    M4 MVP = mulm(P,M);

    std::vector<uint8_t> fb(FBW*FBH*4, 0);
    std::vector<double> zb(FBW*FBH, 1e30);

    for(int f=0;f<6;++f) for(int t=0;t<2;++t){
      int idx[3] = { face[f][0], face[f][t+1], face[f][t+2] };
      int uvi[3] = { 0, t+1, t+2 };
      Vtx V[3]; bool behind=false;
      for(int i=0;i<3;++i){
        V4 c = mulv(MVP, V4{cube[idx[i]][0],cube[idx[i]][1],cube[idx[i]][2],1.0});
        if(c.w <= 1e-9){ behind=true; break; }          // near-plane clip (not implemented:
        double iw = 1.0/c.w;                            // the cube never straddles it here)
        V[i] = { (c.x*iw*0.5+0.5)*FBW, (0.5-c.y*iw*0.5)*FBH, c.z*iw, iw,
                 fuv[uvi[i]][0]*iw, fuv[uvi[i]][1]*iw };
      }
      if(behind) continue;
      int64_t X[3],Y[3];
      for(int i=0;i<3;++i){ X[i]=(int64_t)llround(V[i].sx*SUB); Y[i]=(int64_t)llround(V[i].sy*SUB); }
      int64_t area = o2d(X[0],Y[0],X[1],Y[1],X[2],Y[2]);
      if(area <= 0) continue;                            // BACKFACE CULL (and degenerate)

      int x0=std::max(0,(int)(std::min({X[0],X[1],X[2]})/SUB)-1);
      int x1=std::min(FBW-1,(int)(std::max({X[0],X[1],X[2]})/SUB)+1);
      int y0=std::max(0,(int)(std::min({Y[0],Y[1],Y[2]})/SUB)-1);
      int y1=std::min(FBH-1,(int)(std::max({Y[0],Y[1],Y[2]})/SUB)+1);
      auto topleft=[&](int a,int b){ return (Y[a]==Y[b] && X[b]<X[a]) || (Y[b]>Y[a]); };
      int64_t b0=topleft(1,2)?0:-1, b1=topleft(2,0)?0:-1, b2=topleft(0,1)?0:-1;
      double inv_area = 1.0/(double)area;

      // ---- shade in ALIGNED 2x2 QUADS ---------------------------------------------
      for(int qy=(y0&~1); qy<=y1; qy+=2) for(int qx=(x0&~1); qx<=x1; qx+=2){
        bool cov[4]; double u[4],v[4],zz[4]; int nc=0;
        for(int l=0;l<4;++l){
          int px=qx+(l&1), py=qy+(l>>1);
          int64_t sx=(int64_t)px*SUB+SUB/2, sy=(int64_t)py*SUB+SUB/2;
          int64_t w0=o2d(X[1],Y[1],X[2],Y[2],sx,sy)+b0;
          int64_t w1=o2d(X[2],Y[2],X[0],Y[0],sx,sy)+b1;
          int64_t w2=o2d(X[0],Y[0],X[1],Y[1],sx,sy)+b2;
          cov[l] = ((w0|w1|w2)>=0) && px<FBW && py<FBH;
          // helper lanes get interpolated too - that is the whole point of the quad.
          double l0=(double)(w0-b0)*inv_area, l1=(double)(w1-b1)*inv_area, l2=(double)(w2-b2)*inv_area;
          double iw = l0*V[0].invw + l1*V[1].invw + l2*V[2].invw;
          double uo = l0*V[0].uow  + l1*V[1].uow  + l2*V[2].uow;
          double vo = l0*V[0].vow  + l1*V[1].vow  + l2*V[2].vow;
          u[l] = uo/iw; v[l] = vo/iw;                    // PERSPECTIVE-CORRECT interpolation
          zz[l] = l0*V[0].z + l1*V[1].z + l2*V[2].z;     // depth IS linear in screen space
          if(cov[l]) ++nc;
        }
        if(nc==0) continue;
        covered_total += nc; helper_total += 4-nc;
        // ---- ddx/ddy by finite difference across the quad: lane^1 and lane^2 --------
        double TW=mips[0].w, TH=mips[0].h;
        double dudx=(u[1]-u[0])*TW, dvdx=(v[1]-v[0])*TH;
        double dudy=(u[2]-u[0])*TW, dvdy=(v[2]-v[0])*TH;
        double rho=std::max(std::sqrt(dudx*dudx+dvdx*dvdx), std::sqrt(dudy*dudy+dvdy*dvdy));
        double lam = rho>0 ? std::log2(rho) : 0.0;
        for(int l=0;l<4;++l){
          if(!cov[l]) continue;                          // HELPER LANE: output discarded
          int px=qx+(l&1), py=qy+(l>>1), o=py*FBW+px;
          if(zz[l] >= zb[o]) continue;                   // depth test, LESS
          zb[o]=zz[l];
          double c = trilin(mips,u[l],v[l],lam);
          double shade = 0.35 + 0.65*c;
          uint8_t g=(uint8_t)std::min(255.0,std::floor(shade*255.0+0.5));
          fb[o*4+0]=g; fb[o*4+1]=(uint8_t)std::min(255.0,std::floor(shade*200.0+0.5));
          fb[o*4+2]=(uint8_t)std::min(255.0,std::floor(shade*150.0+0.5)); fb[o*4+3]=255;
        }
      }
    }
    uint64_t h=1469598103934665603ull;                   // FNV-1a 64
    for(uint8_t b : fb){ h^=b; h*=1099511628211ull; }
    long nz=0; for(size_t i=3;i<fb.size();i+=4) if(fb[i]) ++nz;
    printf("k=%2d theta=%.6f  lit pixels=%4ld  FNV-1a(framebuffer) = 0x%016llx\n",
           k, th, nz, (unsigned long long)h);
  }
  printf("total covered lanes=%ld  helper lanes=%ld  quad efficiency=%.4f\n",
         covered_total, helper_total, (double)covered_total/(covered_total+helper_total));
  assert(covered_total>0 && helper_total>0);
  printf("DONE\n");
}
```

**Verified output** (`build=0 exec=0 didExecute=True execTime=27ms`):

```
mip chain: 7 levels (64x64 down to 1x1)
k= 0 theta=0.000000  lit pixels=2304  FNV-1a(framebuffer) = 0x179da29cd60186c0
k=30 theta=1.570796  lit pixels=2154  FNV-1a(framebuffer) = 0x633011740329e4e3
k=60 theta=3.141593  lit pixels=2327  FNV-1a(framebuffer) = 0x37dedf09da4c691c
k=90 theta=4.712389  lit pixels=2154  FNV-1a(framebuffer) = 0x70a88c5ce105e91e
total covered lanes=8939  helper lanes=1697  quad efficiency=0.8404
DONE
```

**Determinism is the hard part, and that is the pedagogy.** The hashes above are
**bit-identical** across three independently verified configurations:

| configuration | `k=0` hash |
|---|---|
| GCC 15.2, `-O2 -std=c++20` | `0x179da29cd60186c0` |
| Clang 20.1.0, `-O2 -std=c++20` | `0x179da29cd60186c0` |
| GCC 15.2, `-O0 -std=c++20` | `0x179da29cd60186c0` |

All four frame hashes and the lane counts matched exactly in all three. Getting there
required three deliberate decisions that are each a lesson:

1. **Triangle setup and interpolation in `double`, coverage in `int64` fixed point.** The
   coverage test must be exact; the interpolation only has to be consistent.
2. **`libm` is not bit-portable.** `std::sin` and `std::cos` are allowed to differ by an ulp
   between implementations, and one ulp in the rotation matrix is enough to move a pixel and
   change the hash. The exercise quantises every trigonometric result to `2^-20` with
   `std::round(x * 1048576.0) / 1048576.0`. **This is the single most instructive line in the
   program**: reproducibility is a property you *engineer*, not one you receive.
3. **No `-ffast-math`, and no reduction whose order is unspecified.**

That is also the honest reason real GPU conformance suites compare against *tolerances*
rather than hashes: across vendors, none of those three things can be pinned.

**A fallback check for students whose platform cannot be pinned:** assert a mean absolute
error below `1/255` per channel against a reference image instead of a hash. Ship both.

**The `quad efficiency = 0.8404` line is the capstone's payoff.** Without being asked to,
the program has measured its own overshading: 8,939 useful lanes against 1,697 helper lanes
on a cube that is a comfortable fraction of a 96×96 framebuffer. Shrink the cube, or
tessellate it, and watch that number fall toward 0.25 (A.6).

**Extensions, each a one-line change that teaches something:**

| change | what appears |
|---|---|
| interpolate `u`, `v` directly instead of `u/w`, `v/w` | PlayStation 1 texture warping |
| force `lam = 0` (never leave mip 0) | checkerboard aliasing and shimmer |
| remove the `area <= 0` test | backface culling was doing half your work |
| remove the Z-buffer, draw back-to-front | the painter's algorithm, and where it fails |
| shade one lane at a time instead of by quad | `ddx`/`ddy` become uncomputable — the exercise's whole thesis, felt |

## A.8 Corrections to Part 6 from actually running the code

Part 6 was written before the exercises were executed. Three of its stated bounds were
estimates; the measured values are:

| Part 6 claim | Measured on Compiler Explorer | Verdict |
|---|---|---|
| `assert efficiency(s=2) <= 0.35` | **0.375** for an equilateral triangle of side 2, averaged over 16 subpixel placements | **Wrong bound.** Use `< 0.40`. The exercise as written in Part 6 fails. |
| `assert efficiency(s=128) >= 0.85` | **0.967** | Correct, and loose. Could tighten to `>= 0.95`. |
| `assert is_monotonic_increasing(...)` | 0.375, 0.468, 0.643, 0.788, 0.881, 0.937, 0.967 | Correct. |
| The analytic model `A/(A + 2P)` "within 15% for s ≥ 16" | Not tested here; Part 8 item 17 already flags it as an unverified approximation of my own | Still unverified. The measured table above should be the reference, and the model dropped. |
| G2.1 watertightness "for 1000 random quads" | Holds for **2000 random *convex* quads**; **does not hold for four random points**, because two triangles from a non-convex or self-intersecting quad genuinely overlap | **Specification bug.** The exercise must generate convex quads (sort four angles about a centre). |
| G2.6 "compute the SHA-256 of the framebuffer" | FNV-1a 64 used instead — five lines, no dependency, and equally decisive. SHA-256 on Compiler Explorer would need a library or ~80 lines of boilerplate that teaches nothing | Substitution recommended. |

The Part 6 exercises not implemented here (G1.1 frame-budget calculator, G1.3 depth
precision, G2.4 mip selection standalone, G2.5 early-Z counter, G3.1 gather-only GPGPU,
G3.2 spatial divergence, G3.3 Morton locality, G3.4 TBDR budget) are all straightforward in
the same harness — G2.4 and G2.5 are ten-line extensions of A.7's inner loop, and G3.1–G3.4
need no rasteriser at all. **They were not executed and their asserted values should be
treated as unverified until they are.**

## A.9 What this appendix could not verify

1. **Nothing here validates any claim about real GPU hardware.** These programs demonstrate
   that the *algorithms* are what the report says they are, and they measure quantities
   (quad efficiency, watertightness, interpolation error) that are properties of the
   algorithm. They do not measure a GPU. Every hardware number in Parts 1–5 — warp sizes,
   cache sizes, cycle counts, bandwidths — rests on the sources listed in Part 8, not on
   this appendix.
2. **The 8-bit weight quantisation in A.5** is modelled from the commonly quoted figure for
   NVIDIA hardware bilinear interpolation (Part 8, item 8). The *model* is verified to
   behave as described; the *claim that NVIDIA uses 8 fractional bits* is not verified here.
3. **Compiler Explorer's executor is a shared multi-tenant sandbox.** Its `execTime` values
   varied by ±6% on an identical program even with a nonce (A.2). No timing-based exercise
   should be built on it, and none of the exercises above is.
4. **The reference buffer in A.4 and the hashes in A.7 are self-references** — they were
   produced by the implementation shown. They are valid *regression* targets for a student
   reimplementing the exercise, and the watertightness, area, and cross-compiler checks are
   the independent ones. A hash is not a proof of correctness; the three property tests are.
5. **Only two compilers were tested** (GCC 15.2, Clang 20.1.0), both x86-64 Linux on
   Compiler Explorer. The A.7 determinism claim is *not* verified on Arm, on MSVC, or on any
   32-bit target, and `long double`/x87 excess precision on a 32-bit x86 target is a known
   way to break exactly this kind of hash reproducibility.
