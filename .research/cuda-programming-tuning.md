# CUDA Programming & Performance Tuning — Curriculum Research

Research date: 2026-09-01.

## Source notes (read this first — two sources are not what the brief assumed)

| Source | What it actually is | Value |
|---|---|---|
| `docs.nvidia.com/cuda/cuda-c-programming-guide/` | **Restructured in the 2026 edition.** Redirects to `/cuda/cuda-programming-guide/`. The classic chapters "Hardware Implementation" and **"Performance Guidelines" no longer exist as top-level chapters.** New layout is 5 parts (see below). Hardware Implementation is now §3.2.2, buried inside "Advanced Kernel Programming". There is **no performance chapter at all** — that content moved wholesale to the *CUDA C++ Best Practices Guide*. | High. Compute-capability tables (§5.1) are the authoritative numbers. Coalescing + bank conflicts now live in §2.3.4. |
| `digitalocean.com/.../cuda-performance-tuning-workflow` | A ~5000-word systems-oriented CUDA overview, published 2026, authored "Shaoni". Title oversells: it is 70% architecture explainer, 30% workflow. The genuinely workflow-shaped parts are §"Reproducible profiling playbook" (6 rules) and §"Optimization Playbook: Symptom → Cause → Fix" (a 5-row table). | Medium-high. The symptom→cause→fix table is the best single artifact in it. The article body is **not** in the served HTML DOM — it is a JSON-escaped markdown blob in the Next.js payload; plain WebFetch returns only page chrome. |
| `github.com/mikeroyal/CUDA-Guide` | A link farm, last maintained 2024, `master` branch (not `main`). Only ~2 of its 8 sections are CUDA at all ("CUDA Learning Resources", "CUDA Tools"); the remaining ~75% is generic C/C++ and Python tooling with no CUDA relevance. Zero pedagogy, zero performance content. | **Low.** Use it as a link index only. Highest-value links extracted below. |
| `blog.codingconfessions.com/p/seeing-the-matrix` | **Not a GPU article.** It is a first-principles *CPU* architecture piece (transistors → gates → adder → ALU → registers → control unit → instruction encoding → fetch-decode-execute → DRAM/SRAM → buses → compiler → ELF → process memory layout). Part of an x86 assembly series. | Medium, but as **prerequisite** material, not CUDA material. Its thesis — *"the processor does not recognize or care about your abstractions; it only sees bits"* — is exactly the framing Unit 1 needs, and its CPU model is the thing a GPU gets contrasted *against*. Use it before Unit 1, not inside the CUDA sequence. |

### New Programming Guide structure (2026 edition)

```
1. Introduction to CUDA        1.1 Introduction · 1.2 Programming Model · 1.3 CUDA Platform
2. Programming GPUs in CUDA    2.1 Intro CUDA C++ · 2.2 Intro CUDA Python · 2.3 Writing SIMT Kernels
                               2.4 Writing Tile Kernels · 2.5 Asynchronous Execution
                               2.6 Understanding Memory · 2.7 nvcc
3. Advanced CUDA               3.1 Advanced Host Programming · 3.2 Advanced Kernel Programming
                               3.3 Multi-GPU Systems · 3.4 Feature Survey · 3.5 Driver API
4. CUDA Features               async-barriers, async-copies, cluster-launch-control, cooperative-groups,
                               cuda-graphs, dynamic-parallelism, extended-gpu-memory, green-contexts,
                               l2-cache-control, lazy-loading, memory-sync-domains, pipelines,
                               programmatic-dependent-launch, stream-ordered-alloc, unified-memory, VMM
5. Technical Appendices        5.1 Compute Capabilities · 5.2 C++ Language Extensions · 5.3 C++ Language
                               Support · 5.7 CUDA C++ Memory Model · 5.8 CUDA C++ Execution Model ·
                               device-callable APIs · env vars · math functions
```

Performance-relevant pages, in priority order:
1. `05-appendices/compute-capabilities.html` — Tables 28–33. All the hard numbers.
2. `02-basics/writing-cuda-kernels.html` §2.3.4 Memory Performance, §2.3.7 Kernel Launch and Occupancy.
3. `03-advanced/advanced-kernel-programming.html` §3.2.2 Hardware Implementation, §3.2.5 Async Data Copies, §3.2.6 Configuring L1/Shared Memory Balance.
4. `01-introduction/programming-model.html` §1.2.2 GPU Hardware Model (incl. thread block clusters), §1.2.3 GPU Memory.
5. **`docs.nvidia.com/cuda/cuda-c-best-practices-guide/`** — mandatory supplement. Owns APOD, coalescing transaction counts, occupancy calculation, prioritized recommendations.
6. `docs.nvidia.com/nsight-compute/ProfilingGuide/` — owns the actual metrics.

### Highest-value links from mikeroyal/CUDA-Guide

CUDA Toolkit docs · CUDA Quick Start Guide · CUDA on WSL · cuDNN docs · NGC / NGC Containers · CUDA Toolkit downloads · **CUTLASS** (`github.com/NVIDIA/cutlass`) · **CUB** (`github.com/NVIDIA/cub`, now in CCCL) · **Thrust** · Numba · CuPy · cuDF / cuML (RAPIDS) · ArrayFire · Minkowski Engine · NVIDIA Container Toolkit. Everything after §2 is off-topic.

---

# 1. Dependency-ordered unit list

Eight units, "what a GPU is" → "I can name the limiter I am hitting".

### Unit 0 (prerequisite, not counted) — What a processor is
*From `seeing-the-matrix`.* Gates → adder → ALU → register file → control unit → instruction encoding → fetch/decode/execute → DRAM vs SRAM → buses → compiler → ELF. **The one idea:** the hardware only sees bits; your types and abstractions exist only in the compiler. Skip if the learner already has this.

---

### Unit 1 — The throughput machine: why a GPU is not a fast CPU
- **Concept.** A CPU core spends most of its transistor budget *hiding* latency for one instruction stream: out-of-order issue, branch prediction, speculation, deep caches. An SM spends its budget on *tolerating* latency across many streams: in-order issue, **no branch prediction, no speculative execution** (Programming Guide §3.2.2, explicit), a huge register file so that "switching between warps incurs no cost", and 32–64 resident warps to switch among. The CPU minimises time-to-answer for one thread; the GPU maximises answers-per-second across thousands.
- **Prerequisites.** Unit 0 (or equivalent CPU literacy).
- **The one idea.** *A GPU does not make any single instruction stream fast. It makes stalling free.* Every performance decision downstream is a consequence of that trade.

### Unit 2 — The execution model as a contract: grid → block → warp → thread
- **Concept.** Kernel launch specifies a grid of blocks; blocks are partitioned into **warps of 32** by consecutive increasing thread ID (first warp = threads 0–31); the SM schedules warps. Threads in a block can cooperate (`__syncthreads()`, shared memory); **blocks have no ordering guarantee and cannot synchronise** — the model assumes any block order produces the same answer. SIMT: one instruction, 32 threads; a data-dependent branch makes the warp execute *both* paths with the off-path threads disabled. CC 7.0+ adds **independent thread scheduling** (per-thread PC and call stack), which is why implicit warp-synchronous code is now broken and `__syncwarp()` / `*_sync` intrinsics are mandatory. CC 9.0+ adds a fourth level, the **thread block cluster** (co-scheduled blocks on one GPC with distributed shared memory).
- **Prerequisites.** Unit 1.
- **The one idea.** *The warp, not the thread, is the unit of execution — and the block, not the grid, is the unit of cooperation.* Divergence within a warp costs time; independence between blocks buys scalability.

### Unit 3 — The memory hierarchy and the price of a byte
- **Concept.** Registers (per-thread, ~0 latency, 64K 32-bit regs/SM) → shared memory / L1 (per-SM, tens of cycles, one unified cache split configurably) → L2 (device-wide, MB-scale) → global DRAM (hundreds of cycles, hundreds of GB/s to TB/s). Plus: **local memory** is a lie — it is DRAM, and it is where register spills land. Constant memory (64 KB, 8 KB cache/SM, broadcast). Texture/surface. Distributed shared memory (CC 9.0+). Unified/managed memory and its page-fault tax.
- **Prerequisites.** Unit 2.
- **The one idea.** *Latency to DRAM is ~100× latency to shared memory, and "local memory" is DRAM wearing a disguise.* Where a byte lives dominates what the kernel costs.

### Unit 4 — Coalescing: making the 32-byte transaction pay for itself
- **Concept.** Global memory is serviced in **32-byte sectors**. A warp's 32 addresses are coalesced into as few 32-byte transactions as necessary. 32 threads reading adjacent 4-byte words = 128 bytes = **4 transactions, 100% utilisation**. Same threads with stride ≥ 32 bytes = **32 transactions, 1024 bytes moved, 128 used, 12.5% utilisation**. Misaligned-but-sequential = 5 transactions instead of 4 (~4/5 bandwidth; measured ~9/10 on V100 because neighbouring warps reuse the over-fetch). Permutation within the segments is free — only *segment count* matters. `cudaMalloc` guarantees ≥256-byte alignment, so making block size a multiple of 32 keeps every block's warps aligned.
- **Prerequisites.** Units 2, 3.
- **The one idea.** *Coalescing is a ratio, not a rule: maximise bytes-used ÷ bytes-transferred.* Consecutive-thread-consecutive-address is merely the easiest way to hit 1.0.

### Unit 5 — On-chip staging: shared memory, banks, and conflicts
- **Concept.** Shared memory is a programmer-managed scratchpad, **32 banks**, successive 32-bit words → successive banks, each bank 32 bits/cycle. Threads of a warp hitting *different* banks all proceed in one cycle. Threads hitting *different addresses in the same bank* serialise — an N-way conflict costs N replays. Two exceptions: same-address **reads broadcast** (free); same-address **writes** collapse to one undefined winner (also not a conflict). Canonical case: `__shared__ float t[32][32]` accessed column-wise is a **32-way conflict**; padding to `[32][33]` reduces it to zero. Shared memory is the mechanism that converts an uncoalesceable global access pattern (matrix transpose) into two coalesced ones.
- **Prerequisites.** Unit 4.
- **The one idea.** *Shared memory exists to decouple the access pattern you want from the access pattern DRAM rewards* — and it has its own, different, 32-way striping rule that you must not accidentally violate in the process.

### Unit 6 — The resource budget: registers, shared memory, occupancy
- **Concept.** Occupancy = resident warps ÷ max resident warps per SM. It is determined by whichever of three budgets runs out first: registers/SM (64K 32-bit), shared memory/SM (64–228 KB by CC), and hard caps (max blocks/SM, max warps/SM, max threads/block = 1024). Registers are allocated **per block, all at once**, and rounded up to 256 registers per warp — which is why 128-thread blocks at 37 regs/thread give 75% occupancy while 320-thread blocks at the same 37 regs give 63%. Levers: block size, `__launch_bounds__`, `-maxrregcount`, dynamic shared memory size, `--resource-usage` / `-Xptxas -v` to read the actual numbers. **Spilling** (stack frame / spill stores / spill loads in ptxas output) is the failure mode to watch: pushing registers down to raise occupancy can spill to DRAM and lose everything you gained — *or* can win anyway. Only measurement decides.
- **Prerequisites.** Units 3, 5.
- **The one idea.** *Occupancy is a budget outcome, not a goal.* You compute it, you do not chase it.

### Unit 7 — Latency hiding, ILP, and asynchrony
- **Concept.** Why occupancy matters at all: with in-order issue and no speculation, the only way to fill an SM's issue slots while a warp waits on a load is another ready warp. That is thread-level parallelism. The *other* way is instruction-level parallelism inside one warp — unroll, keep several independent loads in flight, and a low-occupancy kernel can fully cover its own latency. Hence the diminishing returns above ~20–40% occupancy. Modern hardware adds a third way: **asynchronous execution** — CC 8.0's `cp.async` / `memcpy_async` global→shared copies that bypass the register round-trip (lowering register pressure *and* hiding latency), CC 8.0 split arrive/wait barriers, CC 9.0's TMA unit and async transaction barriers, plus host-side overlap via streams, `cudaMemcpyAsync`, and CUDA Graphs.
- **Prerequisites.** Unit 6.
- **The one idea.** *Latency is hidden by having something else to issue — warps (TLP), independent instructions (ILP), or an async engine doing the copy for you.* These substitute for each other, which is precisely why 100% occupancy is not the target.

### Unit 8 — Measurement: roofline, the three limiters, the workflow
- **Concept.** Roofline: `achieved ≤ min(peak_FLOPS, arithmetic_intensity × peak_BW)`. Three limiter classes and the metric that names each (see §3). Nsight Systems first (where is the time?), Nsight Compute second (why is this kernel slow?). Speed-of-Light section gives compute% and memory% of peak; whichever is high names the roof you are under; if *neither* is high you are latency-bound and the warp-state stall histogram names the reason. Then the symptom→cause→fix table, then re-measure. Plus the reproducibility discipline that makes the numbers mean anything.
- **Prerequisites.** Units 1–7. (Unit 8 is unteachable earlier: every metric it reports is a fact about a mechanism from Units 2–7.)
- **The one idea.** *There are only three answers — memory-bound, compute-bound, latency-bound — and Speed-of-Light tells you which one in two numbers.* Everything else is deciding what to do about it.

---

# 2. The performance-tuning workflow, as an explicit procedure

Synthesised from the DigitalOcean article (profiling workflow, reproducible-profiling playbook, symptom→cause→fix table), the CUDA C++ Best Practices Guide (APOD, prioritized recommendations), and the Nsight Compute Profiling Guide. Stated as measure → interpret → change → verify at every step.

## Phase 0 — Establish the measurement harness (before any tuning)

You cannot tune what you cannot re-measure. Do all six; skipping any one makes later deltas meaningless.

1. **Warm up.** Run the kernel several times before timing. Cold caches and cold clocks are not your steady state.
2. **Lock clocks.** `nvidia-smi -pm 1` (persistence mode) and `nvidia-smi -lgc <min>,<max>`. Under Nsight Compute, `--clock-control lock` (the default) does this per-profile.
3. **Serialise.** One stream, no concurrent profiling. Nsight Compute serialises kernels itself; other tools do not.
4. **Control the cache state.** `--cache-control all` (default) flushes caches between replay passes so every pass sees the same starting state. Use `none` only when you deliberately want warm-cache numbers.
5. **Freeze the input.** Fixed problem sizes, fixed random seed. Changing N changes arithmetic intensity and access alignment; you will misattribute the delta.
6. **Repeat and report variance.** Mean *and* spread. If your optimisation's effect is inside the noise band, it is not an effect. For lightweight timing outside the profiler, use `cudaEvent` timers, never wall-clock around an async launch.

**How you know Phase 0 worked:** run the *unmodified* kernel twice and the two numbers agree to within a few percent.

## Phase 1 — Is the kernel even the problem? (Nsight Systems)

- **Measure:** `nsys profile ./app`, then read the timeline.
- **What it tells you:** the split between H2D/D2H copies, kernel execution, CPU-side gaps, and idle GPU. Amdahl applies: if kernels are 20% of wall time, a 2× kernel speedup buys you 10%.
- **Decide:**
  - GPU idle much of the timeline → the bottleneck is host code, launch overhead, or synchronisation, **not** the kernel. Go to Phase 1b.
  - Copies dominate → overlap them. Pinned host memory + `cudaMemcpyAsync` on a second stream; validate the overlap *on the timeline*, not by hope. Modern GPUs have up to two copy engines (H2D and D2H), so a well-partitioned pipeline can hide both directions.
  - One or two kernels dominate → those are your targets. Go to Phase 2.
- **Change:** overlap, fuse, batch, or restructure host code.
- **Verify:** the timeline shows the gaps closed and total wall time dropped.

### Phase 1b — Launch-bound
- **Symptom:** many small kernels, or high launch count relative to work per launch.
- **Fix, in order:** fuse adjacent kernels; batch per-element/per-row launches into one grid-strided kernel; use CUDA streams for independent work; use **CUDA Graphs** to amortise launch cost for repeated launch patterns.
- **Verify:** launch count drops on the Nsight Systems timeline and wall time follows.

## Phase 2 — Which of the three roofs is this kernel under? (Nsight Compute, Speed of Light)

- **Measure:** `ncu --set full -k <kernel> ./app`, or minimally `ncu --section SpeedOfLight`.
- **Read exactly two numbers:** Compute (SM) throughput % of peak and Memory throughput % of peak — `sm__throughput.avg.pct_of_peak_sustained_elapsed` and `gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed`.

| Compute % | Memory % | Verdict | Go to |
|---|---|---|---|
| High (≳60–70) | Low | **Compute-bound** | Phase 4 |
| Low | High (≳60–70) | **Memory-bound (bandwidth)** | Phase 3 |
| Low | Low | **Latency-bound** (or occupancy/launch-starved) | Phase 5 |
| High | High | Balanced; you are near the roofline knee. Reduce total work or change algorithm/precision. | — |

This is the fork in the whole workflow. Do not proceed to any fix until you have taken it. The single most common wasted optimisation is tuning occupancy on a bandwidth-saturated kernel.

## Phase 3 — Memory-bound path

- **Measure:** Memory Workload Analysis section. The decisive quantity is **sectors per request** (`l1tex__average_t_sectors_per_request_pipe_lsu_mem_global_op_ld.ratio`, mirrored in the UI as the memory chart's request/sector counts). Compare *requested* bytes against *transferred* bytes.
- **Interpret:**
  - 4 sectors/request for 4-byte loads = perfectly coalesced. 32 sectors/request = fully scattered, 12.5% efficiency.
  - High DRAM throughput *and* good coalescing = you are genuinely at the bandwidth roof. The only remaining move is to move fewer bytes.
- **Change, in priority order (this ordering is the Best Practices Guide's own priority ranking):**
  1. **Coalesce.** Restructure indexing so thread *i* touches element *i* (or a small contiguous run). Prefer struct-of-arrays over array-of-structs. Transpose via shared memory when the natural pattern is column-wise.
  2. **Align.** Block sizes as multiples of 32; pad row strides so each row starts on a 32-byte (ideally 128-byte) boundary.
  3. **Reduce transactions.** Vectorised loads (`float4`, `int4` → `LDG.E.128`) when alignment permits; narrower data types where precision allows.
  4. **Increase reuse.** Stage into shared memory or registers — tiling. This is the move that changes *arithmetic intensity* and therefore moves you along the roofline, not just up to it.
  5. **Cache hints.** `__ldg()` / `const __restrict__` for read-only data (`ld.global.nc`); L2 persistence windows (`cudaAccessPolicyWindow`, CC 8.0+) for hot read-only working sets.
  6. **Eliminate I/O.** Fuse producer/consumer kernels so intermediates never touch DRAM.
- **Verify:** sectors/request falls toward 4; `gpu__dram_throughput` rises (you are now using the bandwidth you were wasting) *or* total DRAM bytes falls; kernel time drops.
- **Then re-run Phase 2** — a fixed memory-bound kernel frequently becomes latency- or compute-bound, and the correct next move changes.

## Phase 4 — Compute-bound path

- **Measure:** Compute Workload Analysis. Which pipe is saturated — FMA, ALU, LSU, FP64, tensor? (`smsp__inst_executed_pipe_*.avg.pct_of_peak_sustained_active`.)
- **Interpret:** a saturated FMA pipe at high SM throughput is the good ending. A saturated **LSU** pipe with low DRAM throughput means you are issue-limited on address arithmetic and shared-memory traffic, not on math — treat it as a memory-*instruction* problem, not a bandwidth one. High ALU with low FMA usually means integer index math is dominating.
- **Change:**
  1. Confirm you are not actually memory-stalled (re-check Phase 2 — "check memory first" is the Best Practices Guide's explicit instruction here).
  2. Reduce instruction count: strength-reduce integer math, hoist loop-invariant address computation, use shifts for power-of-two div/mod, prefer signed loop counters (unsigned overflow semantics block compiler strength reduction).
  3. Use cheaper instructions: `--use_fast_math` or per-call intrinsics (`__fmul_rn`, `__fdividef`, `__sinf`) where precision allows; ensure multiply-add fuses to `FFMA`.
  4. Change the arithmetic: mixed precision, **Tensor Cores** via cuBLAS / cuDNN / CUTLASS rather than hand-rolled `mma`.
  5. Raise ILP: unroll, keep independent chains in flight.
- **Verify:** instruction count per thread drops (visible in `sm__inst_executed.sum`), SM throughput % rises, time drops. Guard with a numerical-accuracy check — fast-math changes results.

## Phase 5 — Latency-bound path (both roofs low)

This is where most novice kernels land and where the most reasoning is required.

- **Measure:** Warp State Statistics — the stall-reason histogram. Read the *top* stall reason (`smsp__average_warps_issue_stalled_<reason>_per_issue_active.ratio`), plus Scheduler Statistics (eligible warps per scheduler per cycle) and `sm__warps_active.avg.pct_of_peak_sustained_active` (achieved occupancy).
- **Interpret by top stall reason:**

| Top stall | Meaning | Fix |
|---|---|---|
| **Long Scoreboard** | waiting on a global/local memory load | coalesce; reduce redundant loads; prefetch; `cp.async`; more independent loads in flight (ILP) |
| **Short Scoreboard** | waiting on shared memory / MIO | bank conflicts; reduce shared traffic |
| **MIO Throttle / LG Throttle** | the memory-instruction queue is full | too many outstanding shared/local ops; vectorise, reduce instruction count |
| **Math Pipe Throttle** | the math pipe is the queue that's full | you are actually compute-bound → Phase 4 |
| **Barrier** | warps waiting at `__syncthreads()` | load imbalance within the block; fewer/looser syncs; smaller blocks |
| **Wait / Execution Dependency** | serial dependency chain inside the warp | unroll; restructure for ILP; break the chain |
| **Not Selected** | plenty of eligible warps, scheduler picked another | *this is healthy* — you are issue-saturated, not stalled |
| **No Instruction** | instruction cache miss / branchy code | reduce code footprint, less aggressive unrolling |
| **Drain / Membar / IMC Miss** | tail effects, fences, constant-cache misses | usually not the main lever |

- **Also check occupancy limiters** (`launch__occupancy_limit_registers`, `launch__occupancy_limit_shared_mem`, `launch__occupancy_limit_blocks`, `launch__occupancy_limit_warps`) — Nsight Compute names which of the four budgets is binding. Do not guess.
- **Change:**
  - Occupancy **< ~10–20%** → raise it. Reduce registers (`__launch_bounds__` preferred over `-maxrregcount`; restructure to shorten live ranges), reduce shared memory per block, retune block size.
  - Occupancy already **≳ 30–40%** → *stop tuning occupancy*. Raise ILP instead, or fix the specific stall the histogram named.
  - Grid too small to fill the device (blocks < SM count × blocks-per-SM) → more parallelism, grid-stride loops, larger batch.
- **Verify:** the named stall's share falls; eligible-warps-per-scheduler rises; kernel time drops. If occupancy rose and time did *not* improve, you have empirically proven this kernel is not occupancy-limited — record that and move on.

## Phase 6 — Prove it, and re-enter the loop

1. Re-measure under the exact Phase 0 conditions. Compare mean and variance against the recorded baseline.
2. **Re-run the correctness check.** Every optimisation in Phases 3–5 can change numerics (fast math, reassociation, precision changes) or introduce races (removed syncs, warp-synchronous assumptions). Run `compute-sanitizer --tool memcheck` and `--tool racecheck` after any shared-memory or synchronisation change.
3. Re-run **Phase 2**. The limiter has probably changed. A fix that moves the bottleneck is a success; a fix that moves nothing is a hypothesis that was wrong — revert it rather than accumulating it.
4. **Deploy the partial win** before starting the next round (APOD's actual point). Then repeat.

### Cheap occupancy-sensitivity experiment (worth teaching explicitly)
Increase the third launch-configuration parameter (dynamic shared memory bytes) *without changing the kernel at all*. This lowers occupancy and nothing else. If the runtime barely moves, the kernel is not occupancy-limited and you have saved yourself an entire tuning cycle. Straight from the Best Practices Guide.

### Symptom → cause → fix summary (DigitalOcean's table, condensed)

| Symptom | Likely cause | Fix |
|---|---|---|
| Low bandwidth *and* low FLOPS | uncoalesced access; excess traffic; no reuse | coalesce; vectorise; stage in shared/registers; cut global I/O per FLOP |
| High Mem Dependency stalls | long-latency loads, cache misses, poor coalescing | fix coalescing; drop redundant loads; `__ldg()` |
| High Execution Dependency stalls | long dependency chains | unroll; increase ILP |
| Divergence | branchy control flow | group work by branch outcome; predication; warp-uniform paths |
| Serialised shared accesses | bank conflicts | pad the tile (`[32][33]`) |
| Many tiny kernels | launch overhead | fuse; batch; streams; CUDA Graphs |
| Low FLOPS on arithmetic-heavy kernel | ALUs starved by memory; poor instruction mix; low ILP | verify it's really compute-bound; intrinsics; Tensor Cores; vector loads; unroll |
| Occupancy limited | register/shared pressure | `__launch_bounds__`; shrink shared footprint; retune block size — but only if occupancy < ~20% |

---

# 3. Roofline / limiter taxonomy

**Roofline:** `achievable ≤ min(peak_FLOPS, arithmetic_intensity × peak_bandwidth)`, where arithmetic intensity = FLOPs ÷ bytes moved from DRAM. The *ridge point* is where the two roofs meet; a kernel's AI places it left (memory) or right (compute) of that point.

| Limiter | Definition | Distinguishing metric | Nsight Compute reading | Typical fix |
|---|---|---|---|---|
| **Memory-bound** | Low arithmetic intensity; DRAM bandwidth saturated before ALUs are | `gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed` **high** (≳60–70%) while `sm__throughput...` low | Speed of Light: Memory bar tall, Compute bar short | Coalesce, vectorise, tile for reuse (raise AI), fuse, reduce precision |
| **Compute-bound** | AI high enough to saturate the functional units | `sm__throughput.avg.pct_of_peak_sustained_elapsed` **high** while DRAM % low; a specific `smsp__inst_executed_pipe_*` at high % of peak | Speed of Light: Compute bar tall; Compute Workload Analysis names the pipe | Cheaper instructions, intrinsics/fast math, Tensor Cores, less redundant math |
| **Latency-bound** | **Both** roofs low. Neither resource is saturated; the SM simply has nothing eligible to issue | *Both* SoL bars low **plus** low eligible-warps-per-scheduler; then read `smsp__average_warps_issue_stalled_*` for the reason and `sm__warps_active.avg.pct_of_peak_sustained_active` for achieved occupancy | Warp State Statistics histogram; Scheduler Statistics | More warps (occupancy) *or* more independent instructions (ILP) *or* async copy — whichever the stall reason indicates |

Two sub-cases worth separating from plain "latency-bound":

- **Occupancy-limited.** Latency-bound *and* `launch__occupancy_limit_registers` / `_shared_mem` / `_blocks` / `_warps` identifies a binding budget. Only then is register/shared tuning the right move.
- **Launch/parallelism-limited.** Latency-bound *and* the grid is too small to fill the device, or launch overhead is comparable to kernel duration. Nsight *Systems*, not Compute, diagnoses this.

**Diagnostic shortcut:** two numbers from Speed of Light classify every kernel. `high memory% → memory-bound`; `high compute% → compute-bound`; `neither → latency-bound`; `both → at the ridge, change the algorithm`.

**The trap:** a kernel with terrible coalescing shows *high* DRAM throughput (it is moving enormous quantities of bytes, 87.5% of them wasted) and reads as "memory-bound at the roof". Always cross-check sectors-per-request before concluding you are bandwidth-limited. Requested bandwidth vs. actual bandwidth is the discriminator.

---

# 4. Concrete numbers

All from Programming Guide §5.1 Tables 28–33 (2026 edition). Note: several rows in the published tables use merged cells; run-to-column mappings below are reconstructed from the merge order and cross-checked against Table 32 and the Best Practices Guide.

### Universal constants (all currently supported compute capabilities)

| Quantity | Value |
|---|---|
| **Warp size** | **32** |
| **Max threads per block** | **1024** |
| Max x- or y-dimension of a block | 1024 |
| Max z-dimension of a block | 64 |
| Max block dimensionality | 3 |
| Max grid dimensionality | 3 |
| Max grid x-dimension | 2³¹ − 1 |
| Max grid y/z-dimension | 65535 |
| Max resident grids per device | 128 |
| **32-bit registers per SM** | **64 K (65,536)** |
| Max 32-bit registers per thread block | 64 K |
| **Max 32-bit registers per thread** | **255** |
| **Shared memory banks** | **32** (one per 32-bit word, 32 bits/clock each) |
| Max local memory per thread | 512 KB |
| Constant memory size | 64 KB |
| Constant cache working set per SM | 8 KB |
| Global memory transaction (sector) size | 32 bytes |
| Endianness | little-endian, all architectures |
| Register allocation granularity | rounded up to 256 registers per warp |

### Per-SM limits by compute capability (Table 30)

| CC | Arch | Max blocks/SM | Max warps/SM | Max threads/SM | FP32:FP64 |
|---|---|---|---|---|---|
| 7.5 | Turing | 16 | 32 | 1024 | 32:1 |
| 8.0 | A100 | 32 | 64 | 2048 | 2:1 |
| 8.6 | GA10x | 16 | 48 | 1536 | 64:1 |
| 8.7 | Orin | 16 | 48 | 1536 | 64:1 |
| 8.9 | Ada | 24 | 48 | 1536 | 64:1 |
| 9.0 | Hopper | 32 | 64 | 2048 | 2:1 |
| 10.0 | Blackwell DC | 32 | 64 | 2048 | 2:1 |
| 10.3 | Blackwell DC | 32 | 64 | 2048 | 2:1 |
| 11.0 | (next DC) | 32 | 64 | 2048 | 2:1 |
| 12.x | Blackwell consumer | 24 | 48 | 1536 | 64:1 |

(CC 7.0 Volta, not in the current table but the canonical teaching example: 65,536 registers/SM, 2048 threads/SM = 64 warps → 100% occupancy requires ≤32 registers/thread.)

### Shared memory / cache by compute capability (Tables 31 & 32)

| CC | Unified data cache (KB) | Max shared mem/SM (KB) | Max shared mem/block (KB) | Selectable SMEM carve-outs (KB) | Texture cache working set |
|---|---|---|---|---|---|
| 7.5 | 96 | 64 | 64 | 32, 64 | 32 or 64 KB |
| 8.0 | 192 | 164 | 163 | 0, 8, 16, 32, 64, 100, 132, 164 | 28–192 KB |
| 8.6 | 128 | 100 | 99 | 0, 8, 16, 32, 64, 100 | 28–128 KB |
| 8.7 | 192 | 164 | 163 | 0, 8, 16, 32, 64, 100, 132, 164 | 28–192 KB |
| 8.9 | 128 | 100 | 99 | 0, 8, 16, 32, 64, 100 | 28–128 KB |
| 9.0 | 256 | 228 | 227 | 0, 8, 16, 32, 64, 100, 132, 164, 196, 228 | 28–256 KB |
| 10.x | 256 | 228 | 227 | 0 … 228 | 28–256 KB |
| 11.0 | 256 | 228 | 227 | 0 … 228 | 28–256 KB |
| 12.x | 128 | 100 | 99 | 0, 8, 16, 32, 64, 100 | 28–128 KB |

**KB here means KiB (1024 bytes).** Shared memory and L1 share one physical unified data cache; the split is the "carve-out" and is programmer-selectable from the list above (`cudaFuncSetAttribute` with `cudaFuncAttributePreferredSharedMemoryCarveout`).

**Critical gotcha:** static `__shared__` declarations are capped at **48 KB per block**. Anything above that must be **dynamic shared memory** *and* requires an explicit opt-in via `cudaFuncSetAttribute(kernel, cudaFuncAttributeMaxDynamicSharedMemorySize, bytes)`. This is a compile-time error otherwise, which makes it a good machine-checkable exercise.

### Feature table — which sm_XX gained what (Table 29)

| Feature | Introduced at |
|---|---|
| Half-precision (FP16) arithmetic | 5.3 (pre-table; all currently listed CCs have it) |
| Tensor Cores, `wmma` warp-matrix API | 7.0 |
| Independent thread scheduling (per-thread PC/call stack) | 7.0 |
| `*_sync` warp intrinsics required (implicit warp-sync deprecated) | 7.0 |
| **Warp reduce functions** (`__reduce_add_sync` etc.) | **8.0** |
| **Bfloat16 arithmetic** | **8.0** |
| **Hardware-accelerated `memcpy_async`** (`cp.async`, pipelines) | **8.0** |
| **Hardware-accelerated split arrive/wait barrier** | **8.0** |
| **L2 cache residency management** (persisting access windows) | **8.0** |
| DPX (dynamic-programming) instructions | 8.x: emulated, multiple instructions · **9.0/10.x/11.0: native** · 12.x: back to multiple instructions |
| **128-bit integer atomics** (shared and global) | **9.0** |
| **`atomicAdd` on `float2` / `float4` in global memory** | **9.0** |
| **Thread block clusters** | **9.0** |
| **Distributed shared memory** (cluster-wide SMEM addressing) | **9.0** |
| **Tensor Memory Accelerator (TMA)** | **9.0** |
| Asynchronous transaction barriers, async MMA (`wgmma`) | 9.0 |
| 128-bit-precision floating-point operations | listed in Table 29; introduced in the Blackwell-era column block (verify against the per-CC subsection for your target before relying on it) |
| **Architecture-specific targets** (`compute_90a` etc., `a` suffix) | **9.0** |
| **Family-specific targets** (`f` suffix, e.g. `compute_100f`) | **10.0** |

Tensor Core input types by CC (Table 33): 7.5 = TF32?/FP16/INT8/INT4 · 8.0 = FP64, TF32, BF16, FP16, INT8, INT4 · 8.6/8.7 = TF32, BF16, FP16, INT8, INT4 · 8.9 = + FP8 · 9.0 = FP64, TF32, BF16, FP16, FP8, INT8 · 10.0 = all incl. **FP6 and FP4** · 10.3/11.0/12.x = TF32, BF16, FP16, FP8, FP6, FP4, INT8.

**Compilation target compatibility (Table 28):** `compute_100f` runs on 10.0 and 10.3 · `compute_103f` on 10.3 · `compute_110f` on 11.0 · `compute_120f` on 12.0 and 12.1 · `compute_121f` on 12.1. An `a`-suffixed target runs **only** on the exact CC it was built for.

### Deriving occupancy — worked, from the guide (CC 10.0 SM)

Given `maxBlocksPerMultiProcessor = 32`, `sharedMemPerMultiprocessor = 233472` B, `regsPerMultiprocessor = 65536`, `maxThreadsPerMultiProcessor = 2048`, `sharedMemPerBlock = 49152` B, `regsPerBlock = 65536`, `maxThreadsPerBlock = 1024`:

- `<<<512, 768>>>` → 2 blocks/SM fit (3 × 768 = 2304 > 2048). Occupancy = (768 × 2) / 2048 = **75%**.
- `<<<512, 32>>>` → thread cap not binding, but block cap is: 32 blocks × 32 threads = 1024. Occupancy = 1024 / 2048 = **50%**.
- Kernel using 100 KB shared/block → 2 blocks/SM (3 × 100 KB > 228 KB).

---

# 5. Occupancy: what it is, how it's computed, and the caveat

**Definition.** Occupancy = (resident warps per SM) ÷ (maximum resident warps per SM). Equivalently, the fraction of the SM's warp-tracking capacity that is in use. Nsight Compute reports both *theoretical* occupancy (what the resource budget permits) and *achieved* occupancy (`sm__warps_active.avg.pct_of_peak_sustained_active`, what actually happened, which is lower whenever blocks finish unevenly or the grid tails off).

**Computation.** Blocks per SM = the minimum of four independent budget quotients:

```
blocks_per_sm = min(
    maxBlocksPerMultiProcessor,                                   // hard cap: 16/24/32 by CC
    floor(maxThreadsPerMultiProcessor / threadsPerBlock),         // thread cap: 1024/1536/2048
    floor(regsPerMultiprocessor / registers_per_block),           // register budget: 65536
    floor(sharedMemPerMultiprocessor / sharedMemPerBlock)         // shared memory budget
)
occupancy = (blocks_per_sm * threadsPerBlock) / maxThreadsPerMultiProcessor
```

with two granularity corrections the naive formula misses:

1. **Registers are allocated per block, atomically.** A block either fits entirely or not at all.
2. **Register allocations round up to 256 registers per warp** (i.e. 8 registers per thread, per warp-granule). This is why identical per-thread register counts give different occupancy at different block sizes: on CC 7.0, 37 regs/thread at 128 threads/block → 12 blocks/SM → 75%; the same 37 regs at 320 threads/block → only 4 blocks/SM → 63%.

**How to get the inputs.** `nvcc --resource-usage` (= `-Xptxas -v`) prints registers/thread, shared bytes, constant bytes, stack frame and spill counts at compile time — no GPU required. At runtime, `cudaOccupancyMaxActiveBlocksPerMultiprocessor` and `cudaOccupancyMaxPotentialBlockSize` compute it for you; Nsight Compute's Occupancy section shows the limiter (`launch__occupancy_limit_registers` / `_shared_mem` / `_blocks` / `_warps`).

**Levers.** Block size (only lever with no downside besides granularity); `__launch_bounds__(maxThreadsPerBlock, minBlocksPerMultiprocessor)` — preferred, because it is per-kernel and tells the compiler the actual constraint; `-maxrregcount` — blunt, per-translation-unit; dynamic shared memory size; the L1/shared carve-out.

## The caveat — when higher occupancy is NOT faster

The purpose of occupancy is *latency hiding*, nothing else. It is a proxy, and the proxy breaks in four distinct ways:

1. **Diminishing returns above the hiding threshold.** Once there are enough warps to cover the average stall, more warps do nothing. In practice this threshold is around **20–40%**; the Best Practices Guide's own example is that going from 66% to 100% "generally does not translate to a similar increase in performance". Past the threshold, occupancy is free but worthless.

2. **Register spilling — the direct inversion.** Raising occupancy means cutting registers per thread. Cut too far and the compiler spills to local memory, which is DRAM. You traded ~0-cycle register accesses for ~hundreds-of-cycles DRAM accesses in order to have more warps waiting on DRAM. This is the classic net loss. (The converse also happens: sometimes spilling a little and gaining a block per SM wins. Only measurement decides — which is the point.)

3. **ILP substitutes for TLP.** A single warp with several independent loads in flight hides latency by itself. A heavily unrolled, register-rich, low-occupancy kernel can beat a high-occupancy one outright. Volkov's classic result; the Best Practices Guide states it as "with a high degree of exposed instruction-level parallelism it is, in some cases, possible to fully cover latency with a low occupancy."

4. **Occupancy is irrelevant to the actual limiter.** If the kernel is bandwidth-saturated, more resident warps only queue up more requests behind the same DRAM roof. If it is compute-saturated, more warps contend for the same already-busy pipe. In both cases occupancy tuning is measurable effort with zero measurable return.

**The disciplined rule:** occupancy is a *diagnostic input*, not an objective. Treat < ~20% as a red flag worth investigating; treat anything ≳ 40% as "sufficient" until an experiment proves otherwise. And run the free experiment: bump the dynamic-shared-memory launch parameter to *lower* occupancy without touching the kernel. If time barely changes, occupancy was never the lever.

---

# 6. Coalescing and shared memory bank conflicts — exact rules

## 6.1 Global memory coalescing (CC 6.0 and later)

**The rule, stated exactly:** *the concurrent accesses of the threads of a warp coalesce into a number of transactions equal to the number of **32-byte** transactions necessary to service all threads of the warp.*

Consequences:
- The **sector is 32 bytes**, and this is true whether or not the access is cached in L1. (On CC 6.0+ L1 caching of global loads is the default; the data access unit remains 32 bytes regardless. On some CC 5.2 devices with L1 caching enabled the unit was instead 128-byte aligned segments — historical only.)
- **Partial use costs nothing extra, but buys nothing.** If only some words of a 32-byte sector are requested — because threads accessed the same word, or some threads were inactive — the full sector is fetched anyway.
- **Permutation is free.** If the warp's addresses are permuted within or across the covering segments, the transaction count is unchanged. Coalescing cares about *which segments*, never about *which lane touches which byte*.

**Transaction counts, 32 threads × 4-byte words:**

| Pattern | 32-byte transactions | Bytes moved | Bytes used | Efficiency |
|---|---|---|---|---|
| Aligned, consecutive (`a[tid]`, base 32B-aligned) | **4** | 128 | 128 | **100%** |
| Consecutive but misaligned (`a[tid + offset]`, offset not a multiple of 8 words) | **5** | 160 | 128 | 80% theoretical |
| Stride 2 (`a[2*tid]`) | **8** | 256 | 128 | **50%** |
| Stride 4 | 16 | 512 | 128 | 25% |
| Stride ≥ 8 words (≥ 32 bytes), i.e. one sector per thread | **32** | 1024 | 128 | **12.5%** (worst case) |
| All 32 threads read the same word | 1 | 32 | 4 (broadcast) | — (cheapest possible) |

Measured behaviour for the misaligned case on V100: no-offset and multiples-of-8-words give 4 transactions and ~790 GB/s; other offsets give 5 sectors, predicting 4/5 of peak but **measuring ~9/10**, because adjacent warps reuse the cache lines their neighbours over-fetched. Teach this: the *cache* softens misalignment, but it does **not** soften large strides — that is why `strideCopy` degrades monotonically to 32 sectors while `offsetCopy` plateaus near 90%.

**Alignment facts you can rely on:** `cudaMalloc` returns memory aligned to **at least 256 bytes**. Therefore if `blockDim.x` is a multiple of 32 and indexing is `blockIdx.x*blockDim.x + threadIdx.x`, every warp in every block starts on a 128-byte boundary. Block sizes that are *not* multiples of the warp size push every subsequent block's warps out of alignment — this is the real reason for the "block size must be a multiple of 32" rule, over and above the wasted lanes in the final partial warp.

**In Nsight Compute:** sectors-per-request. 4 = perfect for 4-byte loads; 32 = fully scattered. Also visible as "Global Memory Load/Store Efficiency" — requested bandwidth ÷ actual bandwidth.

## 6.2 Shared memory bank conflicts

**Bank mapping:** shared memory is divided into **32 banks**; successive **32-bit words** map to successive banks. Bank index = `(byte_address / 4) mod 32`. Each bank sustains 32 bits per clock cycle.

**The rule:**
- Threads of a warp accessing **distinct banks** → all served in one cycle. Full 32-way bandwidth.
- Threads accessing **different addresses in the same bank** → **conflict**. The hardware issues one sub-request per distinct address in that bank and serialises them. An **N-way conflict costs N replays** (N cycles instead of 1) for that instruction.
- **Exception 1 — read broadcast.** Multiple threads reading the *same* word: the word is broadcast. **Not a conflict, costs 1 cycle.**
- **Exception 2 — write collapse.** Multiple threads writing the *same* address: exactly one thread's write lands, which one is undefined. **Not a conflict.**

**Stride table** for `__shared__ float s[]` accessed as `s[stride * threadIdx.x]` by one warp:

| Stride (32-bit words) | Distinct banks touched | Conflict degree | Cycles |
|---|---|---|---|
| 1 | 32 | none | 1 |
| 2 | 16 | **2-way** | 2 |
| 3 | 32 | none (3 is coprime with 32) | 1 |
| 4 | 8 | 4-way | 4 |
| 8 | 4 | 8-way | 8 |
| 16 | 2 | 16-way | 16 |
| **32** | **1** | **32-way — worst case** | **32** |
| any odd stride | 32 | none | 1 |

**General rule: a stride *s* (in 32-bit words) produces a `32 / gcd(s, 32)`-way conflict.** Odd strides are always conflict-free. This one line is the whole theory.

**The canonical case and its fix.**

```cuda
__shared__ float tile[32][32];
// warp has fixed threadIdx.y, threadIdx.x = 0..31

tile[threadIdx.y][threadIdx.x];   // stride 1  -> 0-way, 1 cycle
tile[threadIdx.x][threadIdx.y];   // stride 32 -> 32-way conflict, 32 cycles
```

Fix by padding the minor dimension by one word:

```cuda
__shared__ float tile[32][33];    // stride becomes 33 (odd) -> conflict-free BOTH ways
```

Cost: 32 × 33 × 4 = 4224 bytes instead of 32 × 32 × 4 = 4096 bytes. **128 extra bytes buys a 32× improvement on the column access** — and, usefully for teaching, the change is visible in `ptxas -v` output as a shared-memory byte count, with no GPU needed.

This is exactly the shared-memory matrix-transpose pattern: shared memory converts one uncoalesced global access into two coalesced ones, and then you must pad, or you have simply moved the 32-way serialisation from DRAM into SMEM.

**In Nsight Compute:** `l1tex__data_bank_conflicts_pipe_lsu_mem_shared_op_ld.sum` / `_op_st.sum`, and the "Shared Memory" row of the Memory Workload Analysis chart. Also visible as a **Short Scoreboard / MIO Throttle** stall in Warp State Statistics.

---

# 7. Machine-checkable exercises

**Backend contract:** `nvcc` is available; the checker returns compiler diagnostics, PTX (`-ptx`), SASS (`cuobjdump -sass` / `nvdisasm`), and `-Xptxas -v` resource output. **No GPU executes anything.** Exercises below are designed against that. GPU-required exercises are isolated in §7.9.

Useful invocations for the checker:
```
nvcc -arch=sm_90 -ptx        k.cu -o k.ptx
nvcc -arch=sm_90 -cubin      k.cu -o k.cubin && cuobjdump -sass k.cubin
nvcc -arch=sm_90 -c --resource-usage k.cu       # == -Xptxas -v
nvcc -arch=sm_XX -c k.cu; echo $?               # exit code as the assertion
```

---

### 7.1 — Unit 1: The throughput machine
**Exercise.** Write one `__device__` function containing a data-dependent `if/else` with substantial work in both arms. Compile for `sm_90` and dump SASS. Then rewrite it branch-free using `fminf`/`fmaxf`/ternary select so the compiler emits predication instead of a branch.

**Check.**
- (a) Version 1's SASS contains a `BSSY` … `BSYNC` pair (divergence barrier set/sync) and/or `@!P BRA`.
- (b) Version 2's SASS contains **zero** `BSSY`/`BSYNC`/`BRA` in the function body, and uses predicated instructions (`@P0 FADD`, `FSEL`, `IMNMX`/`FMNMX`).
- (c) Assert version 2's instruction count is lower.

**Teaches.** In-order, no-speculation hardware: divergence is a real, visible, countable cost, and predication is the hardware's answer. Nothing here needs a GPU — the SASS *is* the evidence.

---

### 7.2 — Unit 2: Execution model, warps, sync
**Exercise (three parts, all compiler-checked).**
1. Write a warp-level reduction using the deprecated implicit-warp-synchronous idiom (`__shfl_down` without `_sync`, or `volatile` shared memory with no `__syncwarp`). Compile for `sm_90`.
2. Rewrite with `__shfl_down_sync(0xffffffff, ...)`.
3. Rewrite using `__reduce_add_sync(0xffffffff, v)` and compile for both `sm_75` and `sm_80`.

**Check.**
- (1) produces a deprecation diagnostic / error for the non-`_sync` intrinsic.
- (2) PTX contains `shfl.sync.down.b32` (SASS: `SHFL.DOWN`), and does **not** contain `bar.sync`.
- (3) `-arch=sm_75` **fails to compile** (`__reduce_add_sync` requires CC 8.0); `-arch=sm_80` succeeds and PTX contains **`redux.sync.add.u32`** (SASS: `REDUX`). Assert on exit codes plus the presence of the `redux` opcode.

**Teaches.** The warp is real, `_sync` is mandatory post-Volta, and a compute-capability feature gate is a compiler error you can see. Part 3 doubles as the CC-feature-table exercise.

---

### 7.3 — Unit 3: The memory hierarchy
**Exercise.** Write three variants of the same kernel:
- (a) a large per-thread `float local[64]` array indexed by a runtime-variable index;
- (b) the same with a compile-time-constant index / fully unrolled loop;
- (c) the same data placed in `__shared__`.

Compile all three with `--resource-usage`.

**Check.**
- (a) ptxas reports a non-zero **stack frame** and non-zero **spill stores / spill loads**; PTX contains `ld.local`/`st.local`; SASS contains `LDL`/`STL`.
- (b) stack frame = 0, spills = 0, no `ld.local` — the array was promoted to registers; register count rises.
- (c) ptxas reports the expected `smem` byte count; PTX contains `ld.shared`/`st.shared`; SASS contains `LDS`/`STS`.

**Teaches.** "Local memory" is DRAM, dynamic indexing of a local array forces it there, and the compiler tells you at build time. This is one of the highest-value compile-time-only lessons in CUDA.

---

### 7.4 — Unit 4: Coalescing
**Exercise.** Write `copy(float* out, const float* in, int n)` three ways:
- (a) scalar: `out[i] = in[i]`;
- (b) vectorised via `float4` (with `reinterpret_cast` and an alignment precondition);
- (c) read-only path: `const float* __restrict__ in` plus `__ldg`.

**Check.**
- (b) PTX contains **`ld.global.v4.f32`** and **`st.global.v4.f32`**; SASS contains **`LDG.E.128`** and **`STG.E.128`**. Assert (a) contains only `LDG.E` (32-bit) and that (b)'s instruction count per element is ~1/4 of (a)'s.
- (c) PTX contains **`ld.global.nc.f32`**; SASS contains **`LDG.E.CONSTANT`** (or `.NC` depending on arch). Assert the `.nc` variant appears **only** when both `const` and `__restrict__` are present — removing either must make it disappear. That negative check is the pedagogically important half.

**Teaches.** Vector width and cache-path selection are *instruction selection* decisions visible in the ISA, driven by types and qualifiers you control. The bytes-per-instruction ratio is the static proxy for the transaction count.
*(Sector counts themselves are runtime — see §7.9.)*

---

### 7.5 — Unit 5: Shared memory and bank conflicts
**Exercise.** Implement the shared-memory matrix transpose with `__shared__ float tile[32][32]`, then with `[32][33]`.

**Check.**
- `-Xptxas -v` reports **4096 bytes smem** for the unpadded version and **4224 bytes** for the padded one. Exact-value assertion, fully static.
- SASS `LDS`/`STS` instruction *counts* are identical between the two (the padding changes addressing arithmetic, not instruction count) — assert this, because it makes the point that **the compiler cannot see the conflict**; only the hardware can. That is the whole lesson.
- Bonus static check: assert the padded version's address computation multiplies by 33 (an `IMAD` by 0x21) rather than shifting by 5.
- Second bonus, purely a compiler error: declare `__shared__ float big[16384];` (64 KB static) and assert nvcc fails with "uses too much shared data". Then convert to `extern __shared__` and assert it compiles. Teaches the 48 KB static / dynamic-opt-in boundary from §4.

**Teaches.** The padding trick, its exact byte cost, the 48 KB static ceiling — and, crucially, that bank conflicts are invisible to the toolchain, which is *why* you need a profiler.

---

### 7.6 — Unit 6: Occupancy and the resource budget
**Exercise.** Take a register-hungry kernel (e.g. an 8×8 register-blocked GEMM inner loop). Produce three builds:
- (a) unconstrained;
- (b) `__launch_bounds__(256, 4)`;
- (c) `-maxrregcount=32`.

Then, from the `--resource-usage` numbers alone and the Table 30/31 constants for `sm_90`, hand-compute theoretical occupancy for each and write it in a comment.

**Check.**
- Assert (a) registers/thread > 64 (or whatever the kernel naturally needs).
- Assert (b) registers/thread ≤ 40 — `__launch_bounds__(256, 4)` demands 4 blocks × 256 threads = 1024 threads sharing 65536 registers → ≤ 64 regs/thread; assert the compiler actually honoured it.
- Assert (c) registers/thread ≤ 32 **and** spill stores > 0 — proving the spill/occupancy trade-off *exists*, at compile time.
- Assert the student's occupancy arithmetic matches a reference computation of `min(maxBlocks, floor(2048/T), floor(65536/(regs*T)), floor(232448/smem))`.

**Teaches.** Every input to the occupancy formula is a compile-time constant or a ptxas number. The whole calculation is doable without a GPU — and so is the demonstration that the occupancy-raising lever causes spills.

---

### 7.7 — Unit 7: Latency hiding, ILP, async copy
**Exercise (two parts).**
1. Write a reduction loop with a single serial accumulator; then rewrite with four independent partial accumulators combined at the end. Compile both.
2. Write a global→shared staging loop the classic way (`smem[i] = gmem[i];`) and again with `cooperative_groups::memcpy_async` / `__pipeline_memcpy_async`. Compile for `sm_75` and `sm_80`.

**Check.**
1. Both PTX outputs contain the same number of `fma.rn.f32`; assert the 4-accumulator version's SASS shows ≥ 4 `FFMA` instructions between consecutive dependency-carrying `LDG`s (i.e. measure the longest dependency chain, or simply assert the unrolled version uses ≥ 4 more registers — a static proxy for "more values in flight").
2. `sm_75` build of the async version **fails to compile** (hardware `cp.async` is CC 8.0+); `sm_80` build succeeds and PTX contains **`cp.async.ca.shared.global`** or **`cp.async.cg.shared.global`**, SASS contains **`LDGSTS`**. Assert the synchronous version contains `LDG` followed by `STS` (the register round-trip) and the async one contains **neither an intervening register nor an `STS`** for the staged data.

**Teaches.** ILP is register pressure made useful; async copy is a distinct instruction that eliminates the register round-trip; both are CC-gated and both are plainly visible in the ISA.

---

### 7.8 — Unit 8: Roofline, limiters, and the workflow
**Exercise (the static half).** Given a kernel, compute its **arithmetic intensity** by hand from the ISA, not from the source: count `FFMA`/`FADD`/`FMUL` (2 FLOPs for FFMA, 1 otherwise) and count `LDG`/`STG` with their widths, per thread, per loop iteration. Write the AI and the predicted limiter into a header comment. Then implement a tiled variant and repeat.

**Check.**
- Assert the student's FLOP and byte counts match a reference count extracted from the SASS by the checker (regex over the disassembly, normalised per iteration).
- Assert the tiled variant's `LDG` count per output element is lower by the tile factor while the `FFMA` count is unchanged — i.e. **arithmetic intensity provably increased**, which is exactly the roofline move.
- Assert the predicted limiter string matches the reference given a supplied machine peak (e.g. "H100 SXM: 67 TFLOP/s FP32, 3.35 TB/s → ridge point 20 FLOP/byte"). Comparing AI to the ridge point is pure arithmetic.

**Teaches.** Roofline reasoning is done on instruction counts, and instruction counts are static. This gets the learner 80% of the way to a limiter diagnosis without ever touching hardware — which makes the GPU-required half (§7.9) a confirmation rather than a discovery.

---

## 7.9 Exercises that genuinely require a GPU

Everything below depends on runtime counters and cannot be approximated by nvcc. Flag these as a separate track, gated on GPU access.

| # | Exercise | Why a GPU is unavoidable |
|---|---|---|
| G1 | **Measure sectors-per-request** for the coalesced / strided / misaligned copy kernels. Confirm 4 / 8 / 32 and the 12.5% floor. | `l1tex__average_t_sectors_per_request_*` is a hardware counter. The SASS is *identical* between coalesced and strided variants — only the runtime addresses differ. This is the single most important thing nvcc cannot show you. |
| G2 | **Measure the bank conflict** on `[32][32]` vs `[32][33]` and confirm the 32× serialisation. | `l1tex__data_bank_conflicts_pipe_lsu_mem_shared_op_ld.sum`. As shown in §7.5, the instruction stream is unchanged; the conflict is purely dynamic. |
| G3 | **The occupancy-sensitivity experiment**: vary the dynamic-shared-memory launch parameter without touching the kernel, plot time vs occupancy, find the knee. | The entire point is a timing curve. |
| G4 | **Classify three kernels by Speed of Light** (a `saxpy`, a naive GEMM, a tiny-grid kernel) and confirm memory-bound / compute-bound / latency-bound. | `sm__throughput` and `gpu__dram_throughput` are runtime. |
| G5 | **Read the warp-stall histogram** and match the top stall reason to the injected defect (uncoalesced load → Long Scoreboard; bank conflict → Short Scoreboard/MIO; unbalanced block → Barrier). | Stall counters are runtime-only. |
| G6 | **Verify the ILP result**: show the low-occupancy 4-accumulator kernel beats the high-occupancy 1-accumulator kernel. | This is a wall-clock claim. §7.7 proves the *mechanism* statically; only a GPU proves the *outcome*. |
| G7 | **Stream overlap in Nsight Systems**: confirm copy/compute overlap actually happens. | Timeline. |
| G8 | **Roofline plot** in Nsight Compute; place the naive and tiled kernels from §7.8 on it and confirm the tiled one moved right and up. | Measured AI and measured achieved FLOP/s. |
| G9 | **`compute-sanitizer --tool racecheck`** on a kernel with a removed `__syncthreads()`. | Dynamic race detection. |

**Design note on the split.** The static/dynamic boundary is itself the lesson worth teaching: nvcc can prove *what instructions run*, and it can prove *how many resources they need*, but it cannot prove *what addresses they touch*. Coalescing and bank conflicts live entirely on the far side of that line — which is precisely why the profiler exists and why Unit 8 cannot be replaced by more reading.

---

## Appendix — quick reference commands

```bash
# resource usage (registers, smem, spills) — no GPU needed
nvcc -arch=sm_90 -c --resource-usage kernel.cu

# PTX
nvcc -arch=sm_90 -ptx kernel.cu -o kernel.ptx

# SASS
nvcc -arch=sm_90 -cubin kernel.cu -o k.cubin && cuobjdump -sass k.cubin
nvcc -arch=sm_90 -lineinfo -cubin kernel.cu && nvdisasm -c -g k.cubin   # source-correlated

# feature gate test (assert on exit code)
for a in 75 80 86 89 90 100 120; do nvcc -arch=sm_$a -c k.cu 2>/dev/null && echo "sm_$a ok"; done

# --- GPU required below ---
nsys profile -o timeline ./app
ncu --set full -k mykernel -o report ./app
ncu --section SpeedOfLight --section MemoryWorkloadAnalysis \
    --section WarpStateStats --section Occupancy ./app
ncu --metrics sm__throughput.avg.pct_of_peak_sustained_elapsed,\
gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed,\
sm__warps_active.avg.pct_of_peak_sustained_active,\
launch__registers_per_thread ./app
compute-sanitizer --tool racecheck ./app
nvidia-smi -pm 1 && nvidia-smi -lgc 1200,1200      # lock clocks before timing
```
