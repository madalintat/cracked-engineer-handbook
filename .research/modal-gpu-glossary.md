# Modal GPU Glossary — Full Crawl & Curriculum Analysis

Source: https://modal.com/gpu-glossary — crawled in full, 78 term pages across 4 sections.
Crawl date: 2026-09-01. Every URL below was fetched individually.

---

## 1. Complete term list, by section, in glossary order

### Section A — Device Hardware (16 terms)
`/gpu-glossary/device-hardware/...`

| # | Term | One-line definition (my words) |
|---|------|-------------------------------|
| 1 | **CUDA (Device Architecture)** `cuda-device-architecture` | The "Compute Unified Device Architecture": the design decision to replace a heterogeneous fixed-function shader pipeline with a grid of identical, general-purpose Streaming Multiprocessors. |
| 2 | **Streaming Multiprocessor (SM)** `streaming-multiprocessor` | The GPU's rough equivalent of a CPU core — an independent scheduling unit with its own registers, caches and cores, but simple (no speculation, no branch prediction) and massively multithreaded. |
| 3 | **Core** `core` | The compute unit *inside* an SM; better thought of as a typed "pipe" that consumes data and instructions and emits results, not as a CPU core. |
| 4 | **Special Function Unit (SFU)** `special-function-unit` | Per-SM hardware for transcendentals (`exp`, `sin`, `cos`, `sqrt`), reached via `MUFU.*` SASS instructions. |
| 5 | **Load/Store Unit (LSU)** `load-store-unit` | Per-SM hardware that issues memory requests to the L1 data cache (directly) and to global RAM (indirectly). |
| 6 | **Warp Scheduler** `warp-scheduler` | The per-SM unit that picks which warp gets an instruction on each clock cycle; the engine of latency hiding. |
| 7 | **CUDA Core** `cuda-core` | The scalar arithmetic pipe — a mixture of INT32/FP32/FP64 units whose exact composition varies by SM architecture. |
| 8 | **Tensor Core** `tensor-core` | The matrix pipe: one instruction consumes whole matrix tiles and performs a multiply-accumulate, at ~100× the FLOP/s of CUDA Cores. |
| 9 | **Tensor Memory Accelerator (TMA)** `tensor-memory-accelerator` | Hopper/Blackwell hardware that computes bulk affine addresses and asynchronously copies multi-dimensional arrays from global memory into shared memory, bypassing registers. |
| 10 | **Streaming Multiprocessor Architecture** `streaming-multiprocessor-architecture` | The `sm_XYz` version number that determines which SASS binary a physical GPU can execute ("physical GPU architecture"). |
| 11 | **Texture Processing Cluster (TPC)** `texture-processing-cluster` | A pair of adjacent SMs; invisible to the programming model until Blackwell made it the "CTA pair" level. |
| 12 | **Graphics/GPU Processing Cluster (GPC)** `graphics-processing-cluster` | A group of TPCs plus a raster engine; since CC 9.0 it backs the thread-block *cluster* level and distributed shared memory. |
| 13 | **Register File** `register-file` | The SM's fastest, largest bank of 32-bit storage slots, statically partitioned across all resident threads by the compiler. |
| 14 | **L1 Data Cache** `l1-data-cache` | Per-SM SRAM that is *mostly programmer-managed* on GPUs (unlike CPUs) and physically holds shared memory. |
| 15 | **Tensor Memory** `tensor-memory` | Blackwell-only SM-local memory dedicated to Tensor Core operands/accumulators, with severely restricted access rules. |
| 16 | **GPU RAM** `gpu-ram` | Off-die (but on-interposer, for datacenter parts) DRAM/HBM that backs global memory and register spills. |

### Section B — Device Software (17 terms)
`/gpu-glossary/device-software/...`

| # | Term | One-line definition |
|---|------|--------------------|
| 17 | **CUDA (Programming Model)** `cuda-programming-model` | The three-abstraction model — thread hierarchy, memory hierarchy, barrier synchronization — designed so programs get faster automatically on bigger GPUs. |
| 18 | **Streaming ASSembler (SASS)** `streaming-assembler` | The actual, architecture-versioned assembly language of NVIDIA GPUs; readable, barely documented, never written by hand. |
| 19 | **Parallel Thread eXecution (PTX)** `parallel-thread-execution` | The forward-compatible virtual ISA / IR that sits between CUDA C++ and SASS, JIT-compiled to SASS by the driver. |
| 20 | **Compute Capability** `compute-capability` | The `compute_XYz` "virtual GPU architecture" version that governs PTX forward compatibility (onion-layer model, plus `a`/`f` escape-hatch suffixes). |
| 21 | **Thread** `thread` | The atom of the CUDA programming model: an instruction stream with private registers and essentially nothing else. |
| 22 | **Warp** `warp` | 32 threads issued the same instruction together — the real unit of execution, and *not* part of the CUDA programming model. |
| 23 | **Warpgroup** `warpgroup` | Four contiguous warps (128 threads) whose first warp-rank is a multiple of 4; the granularity of Hopper `wgmma` and Blackwell tensor-memory ops. |
| 24 | **Cooperative Thread Array (CTA)** `cooperative-thread-array` | The PTX/SASS name for a thread block: the set of warps co-resident on one SM that can share memory and use barriers. |
| 25 | **Kernel** `kernel` | A function launched once from the host and executed many times, once per thread, across a grid spanning the whole device. |
| 26 | **Thread Block** `thread-block` | The programming-model level between grid and thread; the only level with programmer-visible coordination; ≤1024 threads. |
| 27 | **Thread Block Grid** `thread-block-grid` | The 1–3D collection of independent thread blocks produced by one kernel launch; matched to global memory. |
| 28 | **Thread Hierarchy** `thread-hierarchy` | thread → thread block → grid, mapped respectively onto core → SM → device. |
| 29 | **Memory Hierarchy** `memory-hierarchy` | registers → shared memory → global memory, each level shared by the matching thread-hierarchy level, and *programmer*-managed. |
| 30 | **Registers** `registers` | Per-thread memory living in the SM register file; unlimited/virtual in PTX, physical and scarce in SASS, spillable to global memory. |
| 31 | **Shared Memory** `shared-memory` | Per-thread-block scratchpad carved out of the SM's L1 data cache; small, fast, explicitly loaded and stored. |
| 32 | **Global Memory** `global-memory` | Device-wide, program-lifetime memory in GPU RAM; the only memory shared across thread blocks. |
| 33 | **CUDA Tile Programming Model** `cuda-tile-programming-model` | A new (mid-2026) tile-oriented alternative to SIMT CUDA, where each tile block is a single thread operating on structured pointers; surfaced via cuTile Python and Tile IR. |

### Section C — Host Software (22 terms)
`/gpu-glossary/host-software/...`

| # | Term | One-line definition |
|---|------|--------------------|
| 34 | **CUDA (Software Platform)** `cuda-software-platform` | The toolchain + runtime + libraries stack that lets a host language express the CUDA programming model. |
| 35 | **CUDA C++** `cuda-c` | C++ plus `__global__`, `<<<>>>`, `__shared__`, `__syncthreads()`, `blockDim`/`threadIdx`. |
| 36 | **NVIDIA GPU Drivers** `nvidia-gpu-drivers` | Kernel-mode + user-mode software mediating all host↔device interaction; Linux kernel module now open-sourced. |
| 37 | **nvidia.ko** `nvidia-ko` | The privileged Linux kernel module at the base of the driver stack. |
| 38 | **CUDA Driver API** `cuda-driver-api` | The low-level, binary-compatible userspace driver interface (`cuMalloc` etc.); rarely used directly. |
| 39 | **libcuda.so** `libcuda` | The shared object implementing the Driver API; always dynamically linked. |
| 40 | **NVML** `nvml` | The management/monitoring library: power draw, temperature, memory allocation, clocks, power limits. |
| 41 | **libnvml.so** `libnvml` | The shared object implementing NVML. |
| 42 | **nvidia-smi** `nvidia-smi` | The CLI over NVML: identity, live utilization, power/thermal, process listing, plus management (`-pm`, `-pl`, `-ac`, `-r`). |
| 43 | **CUDA Runtime API** `cuda-runtime-api` | The higher-level, more ergonomic wrapper over the Driver API; what nearly everyone actually links. |
| 44 | **libcudart.so** `libcudart` | The shared object implementing the Runtime API; often statically linked in apps, dynamically loaded by PyTorch. |
| 45 | **CUDA Graphs** `cuda-graph` | A captured DAG of kernel launches replayed with one host-side submission, to kill per-launch overhead. |
| 46 | **nvcc** `nvcc` | The CUDA compiler driver producing "fat binaries" containing PTX (`compute_XYz`) and/or SASS (`sm_XYz`). |
| 47 | **NVRTC** `nvrtc` | In-process runtime compiler from CUDA C++ to PTX, avoiding a separate `nvcc` process. |
| 48 | **CUPTI** `cupti` | The profiling API underneath Nsight and the PyTorch profiler; crucially synchronizes host and device timestamps. |
| 49 | **Nsight Systems** `nsight-systems` | GUI profiler/tracer/expert-system for whole-program CUDA performance debugging. |
| 50 | **CUDA Binary Utilities** `cuda-binary-utilities` | `cuobjdump` and `nvdisasm` for extracting and analyzing cubins and SASS. |
| 51 | **cuBLAS** `cublas` | NVIDIA's closed-source BLAS: ready-to-call, heuristically dispatched GEMM kernels — column-major, Fortran-legacy. |
| 52 | **cuDNN** `cudnn` | The deep-learning primitive library (convolution, attention, norms), now graph/fusion-oriented. |
| 53 | **CUTLASS** `cutlass` | A C++ template *toolkit* for building your own peak-performance GEMM kernels, structured as device/kernel/collective layers with mainloops and epilogues. |
| 54 | **CuTe** `cute` | CUTLASS's core header-only library of composable `Layout` and `Tensor` types describing both data and thread arrangements, resolved at compile time. |
| 55 | **CuTe DSL** `cute-dsl` | Python DSL exposing CuTe/CUTLASS with JIT compilation through MLIR → PTX → SASS. |

### Section D — Performance (23 terms)
`/gpu-glossary/perf/...`

| # | Term | One-line definition |
|---|------|--------------------|
| 56 | **Performance Bottleneck** `performance-bottleneck` | The resource that caps throughput; on GPUs almost always compute, memory, or overhead. |
| 57 | **Roofline Model** `roofline-model` | Plot of achievable FLOP/s vs arithmetic intensity, bounded by a flat compute roof and a sloped memory roof meeting at the "ridge point". |
| 58 | **Compute-bound** `compute-bound` | Limited by arithmetic bandwidth; high arithmetic intensity; e.g. LLM prefill, diffusion inference. |
| 59 | **Memory-bound** `memory-bound` | Limited by GPU-RAM↔SM bandwidth; low arithmetic intensity; e.g. LLM decode. |
| 60 | **Arithmetic Intensity** `arithmetic-intensity` | FLOPs per byte moved — the x-axis of the roofline and the single number that decides which roof you hit. |
| 61 | **Overhead** `overhead` | Time the GPU spends *waiting for work* rather than doing it; mostly host-side launch and framework dispatch cost. |
| 62 | **Little's Law** `littles-law` | concurrency = latency × throughput; tells you how many in-flight ops are needed to fully hide latency. |
| 63 | **Memory Bandwidth** `memory-bandwidth` | Peak bytes/s between memory-hierarchy levels; the GPU-RAM↔register-file one sets the roofline's memory roof. |
| 64 | **Arithmetic Bandwidth** `arithmetic-bandwidth` | Peak ops/s of an arithmetic pipe; the compute roof. Tensor Core bandwidth ≈ 100× CUDA Core bandwidth. |
| 65 | **Latency Hiding** `latency-hiding` | Keeping execution units busy by switching to another eligible warp whenever the current one stalls. |
| 66 | **Warp Execution State** `warp-execution-state` | The four non-exclusive adjectives — active, stalled, eligible, selected — describing a warp each cycle. |
| 67 | **Active Cycle** `active-cycle` | A cycle in which an SM has at least one resident active warp. |
| 68 | **Occupancy** `occupancy` | Active warps ÷ maximum active warps; theoretical (launch-config-limited) vs achieved. |
| 69 | **Pipe Utilization** `pipe-utilization` | Per-pipe (`fma`, `tensor`, `lsu`, `adu`) percentage of peak sustained rate while that pipe is active. |
| 70 | **Peak Rate** `peak-rate` | The hardware's "speed of light": SMs × units × ops/unit × clock. |
| 71 | **Issue Efficiency** `issue-efficiency` | Fraction of active cycles on which a scheduler actually issued an instruction. |
| 72 | **SM Utilization** `streaming-multiprocessor-utilization` | Fraction of time *all* SMs are executing instructions — much stricter than nvidia-smi's GPU utilization. |
| 73 | **Warp Divergence** `warp-divergence` | Threads in one warp taking different control-flow paths, handled by predication/masking. |
| 74 | **Scoreboard Stall** `scoreboard-stall` | A warp blocked because a scoreboard bit tracking an in-flight register write hasn't cleared; short (on-SM) vs long (off-SM). |
| 75 | **Branch Efficiency** `branch-efficiency` | Ratio of uniform control-flow decisions to total branches — the absence of warp divergence. |
| 76 | **Memory Coalescing** `memory-coalescing` | Servicing many logical global-memory reads from one physical DRAM burst. |
| 77 | **Bank Conflict** `bank-conflict` | Threads in a warp hitting distinct addresses in the same shared-memory bank, forcing serialization. |
| 78 | **Register Pressure** `register-pressure` | The register file becoming the bottleneck, capping occupancy and therefore latency hiding. |

---

## 2. Dependency order — the teaching spine

Each unit below depends only on units above it. Clusters are named; within a cluster, order matters.

### Unit 0 — Prerequisite framing (no GPU content)
`performance bottleneck` · `peak rate`
> Bottleneck theory (find it, elevate it, repeat) and "speed of light" are pure systems reasoning. Teach them first so every hardware fact afterwards has a slot to land in. Everything in Section D ultimately answers "which bottleneck?".

### Unit 1 — The unification cluster
`CUDA (device architecture)` → `streaming multiprocessor` → `core`
> The whole glossary hangs off one historical fact: NVIDIA replaced heterogeneous shader stages with identical general-purpose SMs. "Core" must be introduced as a *typed pipe inside an SM*, not as a CPU core, or every later analogy misfires.

### Unit 2 — The execution cluster (SM internals)
`warp` → `warp scheduler` → `CUDA core` → `special function unit` → `load/store unit` → `thread`
> **This is the cluster the user named, and it is correctly grouped.** Warp must come *before* warp scheduler (the scheduler's job is defined in terms of warps), and both before CUDA core (a CUDA core executes one thread of a scheduler-issued warp instruction). SFU and LSU are siblings of CUDA Core — same slot, different pipe. `thread` belongs here rather than in the hierarchy unit because a thread is defined operationally as "what one CUDA core executes".
>
> **Tensor Core strictly follows this entire cluster** — it is defined by contrast with CUDA Core (matrix vs scalar) and requires warp (32 threads cooperate on one instruction) and warp scheduler (one Tensor Core per scheduler).

### Unit 3 — The matrix cluster
`tensor core` → `warpgroup` → `tensor memory accelerator (TMA)` → `tensor memory`
> Strict chain. Warpgroup exists because Hopper Tensor Cores needed a 128-thread granularity. TMA exists to feed Tensor Cores without burning registers. Tensor Memory (Blackwell) exists to hold Tensor Core accumulators. Teaching TMA before Tensor Core leaves the student with no reason for it to exist.

### Unit 4 — The physical memory cluster
`register file` → `L1 data cache` → `GPU RAM`
> Order is by speed and by containment (register file feeds cores; L1 feeds register file; RAM feeds L1). Must precede the *software* memory hierarchy, because registers/shared/global are each defined as "lives in X".

### Unit 5 — The chip-topology cluster
`SM architecture` → `texture processing cluster (TPC)` → `graphics processing cluster (GPC)`
> Lowest-value cluster for a beginner; safe to defer. But `SM architecture` is a hard prerequisite for `compute capability`, `nvcc`, `SASS`, cuBLAS/cuDNN dispatch, and every "introduced in Hopper/Blackwell" claim, so teach at least that one term early.

### Unit 6 — The programming-model cluster
`CUDA (programming model)` → `thread hierarchy` (`thread` → `thread block` → `thread block grid`) → `kernel` → `memory hierarchy` (`registers` → `shared memory` → `global memory`)
> The two hierarchies are one idea and must be taught as a pair — each memory level is *defined by* its thread level. `kernel` sits between them: it needs the grid to explain "launched once, executed many times", and it needs the memory hierarchy to explain what it actually does (mutate global memory through pointers).
>
> `cooperative thread array (CTA)` attaches here as the PTX/SASS name of a thread block, but it depends on **both** Unit 2 (it's composed of warps, and it's what occupies an SM) and Unit 6. It's the natural bridge term.

### Unit 7 — The toolchain / compilation cluster
`CUDA C++` → `nvcc` → `PTX` → `compute capability` → `SASS`
> A single pipeline, and the only sane teaching order is source-to-metal. `compute capability` must sit between PTX and SASS: it is precisely the versioning of PTX ("virtual architecture") that mirrors SM architecture ("physical architecture"). Teaching compute capability before PTX makes it an arbitrary number.
> Then: `NVRTC`, `CUDA binary utilities` as leaves.

### Unit 8 — The host-stack cluster
`CUDA software platform` → `NVIDIA GPU drivers` → `nvidia.ko` → `CUDA Driver API` → `libcuda.so` → `CUDA Runtime API` → `libcudart.so` → `CUDA Graphs`
> Strict bottom-up layering; each term is literally "the thing above, one layer up". `NVML` → `libnvml.so` → `nvidia-smi` is a parallel side-branch off the driver and can be taught anywhere after `NVIDIA GPU drivers`. `CUDA Graphs` depends additionally on `kernel` and on `overhead`.
> `CUPTI` → `Nsight Systems` is a second side-branch; both depend on `kernel`.

### Unit 9 — The kernel-library cluster
`cuBLAS` → `cuDNN` → `CUTLASS` → `CuTe` → `CuTe DSL`
> Ordered by "ready-made" → "build-your-own". CUTLASS/CuTe additionally depend on Unit 3 (Tensor Cores) and Unit 6 (shared memory, thread blocks); CuTe DSL depends on all of Unit 7.

### Unit 10 — The roofline cluster
`memory bandwidth` · `arithmetic bandwidth` → `arithmetic intensity` → `roofline model` → `compute-bound` · `memory-bound` · `overhead`
> The two bandwidths are independent leaves that both feed arithmetic intensity and the roofline. Compute-bound and memory-bound are *derived* from the roofline and cannot be taught before it without becoming hand-wavy. `overhead` is the third, off-roofline category and depends on Unit 8 (launch cost) and `CUDA Graphs` for its remedy.
> Depends on Unit 4 (there must be a memory hierarchy for bandwidth to be between levels) and Unit 3 (the 100:1 Tensor:CUDA core ratio is *why* ridge points are so far right).

### Unit 11 — The latency-hiding cluster
`Little's Law` → `latency hiding` → `warp execution state` (active/eligible/stalled/selected) → `active cycle` → `occupancy` → `issue efficiency`
> The tightest chain in the glossary. Little's Law is the theory; latency hiding is the mechanism; warp execution state is the vocabulary; active cycle, occupancy and issue efficiency are the measurements. Every term here requires Unit 2 (warp, warp scheduler) and Unit 10 (bandwidth) as prerequisites.
> `scoreboard stall` attaches to `warp execution state` (it's the *why* behind "stalled") and additionally needs `registers` from Unit 6.

### Unit 12 — The utilization-metrics cluster
`SM utilization` → `pipe utilization`
> Deliberately coarse-to-fine; the glossary itself prescribes checking GPU utilization, then SM utilization, then pipe utilization. Depends on Unit 11 (occupancy/issue efficiency) and `peak rate` (the denominator).

### Unit 13 — The access-pattern cluster
`memory coalescing` (global) · `bank conflict` (shared) · `warp divergence` → `branch efficiency` · `register pressure`
> These are the five concrete, fixable pathologies — the practical payoff of the whole curriculum. Each is a warp-level phenomenon (Unit 2) applied to one memory level or to control flow (Unit 6), and each is diagnosed by Units 11–12. `register pressure` closes the loop back to `register file` and `occupancy`.

### Unit 14 — Frontier / optional
`CUDA Tile programming model`
> Depends on essentially everything: it is defined as a *reaction* to the SIMT model's poor fit for Tensor-Core-dominated hardware. Genuinely last.

### Compressed spine (linear, one valid teaching order)
```
bottleneck → peak rate
→ CUDA arch → SM → core
→ warp → warp scheduler → CUDA core → SFU → LSU → thread
→ tensor core → warpgroup → TMA → tensor memory
→ register file → L1 cache → GPU RAM
→ SM architecture → TPC → GPC
→ CUDA programming model → thread/block/grid → kernel → registers/shared/global → CTA
→ CUDA C++ → nvcc → PTX → compute capability → SASS → NVRTC → binary utilities
→ platform → drivers → nvidia.ko → driver API → libcuda → runtime API → libcudart → CUDA Graphs
   (side: NVML → libnvml → nvidia-smi;  CUPTI → Nsight Systems)
→ cuBLAS → cuDNN → CUTLASS → CuTe → CuTe DSL
→ memory bandwidth + arithmetic bandwidth → arithmetic intensity → roofline → compute/memory-bound → overhead
→ Little's Law → latency hiding → warp execution state → active cycle → occupancy → issue efficiency → scoreboard stall
→ SM utilization → pipe utilization
→ coalescing / bank conflict / warp divergence → branch efficiency → register pressure
→ CUDA Tile
```

---

## 3. Teaching hooks — the most counterintuitive fact per cluster

**Unit 0 (bottleneck/peak rate).** *Power is a real bottleneck, not a footnote.* The glossary cites NVIDIA getting a **4% end-to-end speedup by redirecting power from the L2 cache to the SMs**, and Horace He showing that matmul throughput **varies with the input data values** because different bit patterns switch different numbers of transistors. Two identical kernels on identical shapes can run at different speeds because of what's in the matrices. (`perf/performance-bottleneck`)

**Unit 1 (unification).** *An SM is not a core; it's closer to a whole CPU.* But the counterintuitive half is the reverse direction: an SM is a **weaker** processor than a CPU core — no speculative execution, no branch prediction. GPUs win by deleting the machinery a SWE assumes is table stakes, and spending the transistor budget on threads instead. (`device-hardware/streaming-multiprocessor`)

**Unit 2 (execution).** *A GPU context switch is free.* CPU thread switches cost hundreds-to-thousands of cycles because registers must be saved and restored; a **warp switch takes one clock cycle (~1 ns)** because every resident warp already owns its registers in the register file — nothing moves. A SWE will assume "more threads = more switching overhead" and get the entire performance model backwards. Corollary: warps are *not* part of the CUDA programming model at all; they're an implementation detail, like a cache line. (`device-hardware/warp-scheduler`, `device-software/warp`)

**Unit 3 (matrix).** *A single Tensor Core instruction in a single thread does not compute a matrix multiply.* `HMMA16.16816.F32` performs 16×8×16 = **2,048 MACs, but the 32 threads of a warp cooperatively execute it together** — 64 MACs per thread. There is no "the thread that did the matmul". Second hook: **the Tensor Memory Accelerator does not accelerate Tensor Memory.** The names are unrelated; TMA loads into shared memory/L1, Tensor Memory is a separate Blackwell store. (`device-hardware/tensor-core`, `device-hardware/tensor-memory-accelerator`)

**Unit 4 (physical memory).** *The GPU's L1 cache is mostly programmer-managed.* On a CPU, L1 is invisible hardware policy. On a GPU it is an address space you explicitly load into and out of — this is the single biggest mental-model break for a SWE, and it's also why GPU context switches don't wreck cache hit rates. (`device-hardware/l1-data-cache`)

**Unit 5 (topology).** *"CUDA" stopped being unified.* Blackwell added a `.cta_group::2` PTX field that pairs two SMs in a TPC for one MMA instruction — an explicitly heterogeneous, topology-aware level of the hierarchy inside the "Compute **Unified** Device Architecture". The glossary itself snarks: *"So much for a 'compute-unified' device architecture!"* (`device-hardware/texture-processing-cluster`, `device-hardware/tensor-memory`)

**Unit 6 (programming model).** *Thread blocks must be written so that any interleaving is valid — including fully serial.* A SWE reads "parallel" and assumes concurrency guarantees. There are none across blocks: block execution order is driver-determined and indeterminate, and **blocking one CTA on another easily deadlocks**. The restriction is not a limitation, it's the mechanism that makes your code get faster on next year's GPU. Bonus trap: `__global__` marks *functions*, while "global memory" is *device* memory — the collision was, per CUDA architect Nicholas Wilt, made "for maximum developer confusion". (`device-software/cuda-programming-model`, `device-software/cooperative-thread-array`, `device-software/global-memory`)

**Unit 7 (toolchain).** *PTX is not assembly; it's LLVM-IR.* It is JIT-compiled to SASS **by the driver, at runtime**, which is why a binary built years ago runs on a GPU that didn't exist at build time. And the layer that *is* assembly (SASS) has **publicly listed instructions with no documented semantics** and a completely undocumented binary encoding. The lowest level of the stack is the least documented. (`device-software/parallel-thread-execution`, `device-software/streaming-assembler`)

**Unit 8 (host stack).** *The Runtime API is the normal one; the Driver API is the exotic one.* The naming implies the opposite layering to most SWEs. Also: CUDA Graphs **cannot be serialized or made portable**, because nodes are identified by raw pointers — the only way to "save" one is to checkpoint host and device memory wholesale. (`host-software/cuda-runtime-api`, `host-software/cuda-graph`)

**Unit 9 (libraries).** *cuBLAS is column-major, and you should not transpose to fix it.* The trick is the identity `C^T = B^T @ A^T` plus the fact that **a row-major matrix has the identical memory layout to its column-major transpose** — so you swap the arguments and the M/N dimensions and pass `CUBLAS_OP_N`. Zero data movement. Everyone's first cuBLAS bug is here. (`host-software/cublas`)

**Unit 10 (roofline).** *Latency appears nowhere in the roofline model.* It is a pure bandwidth model, deliberately. The second hook: **ridge points have been moving right for a decade** — A100 BF16 needs 156 FLOPs/byte to be compute-bound, B200 FP4 needs **1,125**. Hardware is getting *harder* to saturate, not easier. Third: the fix for a memory bottleneck is often to **do more arithmetic** (compress data, recompute activations via gradient checkpointing) — deliberately increasing FLOPs to go faster. (`perf/roofline-model`, `perf/arithmetic-intensity`)

**Unit 11 (latency hiding).** *Occupancy is not a target.* Every intuition says "maximize it". The glossary states flatly that once occupancy suffices for latency hiding, more occupancy **degrades** performance by shrinking per-thread resources — and that **high-performance Hopper/Blackwell GEMM kernels often run at single-digit occupancy percentages** because they don't need many warps to saturate the Tensor Cores. Related: **stalled warps are not bad**; a large pool of concurrently stalled warps is exactly what latency hiding requires. And per Volkov, hiding *memory* latency needs barely more warps than hiding *arithmetic* latency (30 vs 24) — because Little's Law multiplies latency by throughput, and memory's much lower throughput cancels its much higher latency. (`perf/occupancy`, `perf/warp-execution-state`, `perf/littles-law`)

**Unit 12 (utilization).** *100% GPU utilization can mean under 1% of the GPU is working.* A kernel with a single thread block occupies one SM, and `nvidia-smi` will happily report 100% utilization while **SM utilization is 1/132 on an H100**. The number every SWE reaches for first is the one that lies hardest. (`perf/streaming-multiprocessor-utilization`)

**Unit 13 (access patterns).** *The compiler deliberately wastes compute to avoid branching.* In the divergence example, SASS executes the `FADD` for the else-branch in **all 32 threads unconditionally**, then overwrites it with a predicated `FMUL` in the threads that took the if-branch — extra arithmetic in every thread, chosen over the "obvious" double-predication. The glossary's rule: *"it's better to waste compute than to add complexity."* Second hook: **a stride of 2 halves your bandwidth** (206 GB/s → 130 GB/s on a T4), and a stride of 32 in shared memory costs **32× latency** — from ~10 cycles to hundreds. Third: CPUs care about branch uniformity **over time** (prediction); GPUs care about uniformity **in space** (within a warp). Same word, orthogonal concern. (`perf/warp-divergence`, `perf/memory-coalescing`, `perf/bank-conflict`, `perf/branch-efficiency`)

**Unit 14 (CUDA Tile).** *NVIDIA is walking back SIMT.* The Tile model exists because "the CUDA programming model is a poor fit for GPUs of the latest SM architectures" — the vendor's own glossary says the abstraction that defined GPU computing no longer matches the hardware. (`device-software/cuda-tile-programming-model`)

---

## 4. Every concrete number the glossary gives

### SM / thread counts
| Figure | Source page |
|---|---|
| H100 SXM: **700 W max**, **132 SMs**, **4 warp schedulers per SM**, 32 threads issued per scheduler per cycle → **128×132 > 16,000 truly parallel threads**, ≈ **5 cW per thread** | `device-hardware/streaming-multiprocessor` |
| AMD EPYC 9965 comparison: **500 W**, **192 cores**, 2 threads/core = **384 parallel threads**, ≈ **1.25 W per thread** | `device-hardware/streaming-multiprocessor` |
| One H100 SM: **up to 2048 concurrent threads** in **64 warps of 32**; across 132 SMs, **> 250,000 concurrent threads** | `device-hardware/streaming-multiprocessor` |
| **Warp size = 32** (technically machine-dependent; 32 in practice and throughout the glossary) | `device-software/warp` |
| **Warpgroup = 4 warps = 128 threads**; first warp-rank must be a multiple of 4 | `device-software/warpgroup` |
| Thread block max **1024 threads** on current devices | `device-software/thread-block` |
| H100 SM has **128 "FP32 CUDA Cores"** — but that is **double** the count of its 32-bit integer or 64-bit float units | `device-hardware/cuda-core` |
| H100 SXM5: **4 Tensor Cores per SM** (one per warp scheduler) vs **hundreds of CUDA Cores** | `device-hardware/tensor-core` |
| Recent datacenter SMs appear to contain **four unnamed subunits**, each with its own warp scheduler and Tensor Core | `device-software/warpgroup` |

### Memory sizes
| Figure | Source page |
|---|---|
| **H100 L1 data cache: 256 KiB per SM** (2,097,152 bits); **33 MiB total** across 132 SMs (242,221,056 bits) | `device-hardware/l1-data-cache` |
| **H100 GPU RAM: 80 GiB** (687,194,767,360 bits) | `device-hardware/gpu-ram` |
| **H100 register file: 65,536 32-bit registers** per SM | `perf/occupancy` |
| **H100 shared memory: 228 KB** per SM | `perf/occupancy` |
| **H100 max warps/SM: 64**; **max blocks/SM: 32** | `perf/occupancy` |
| Register file is **~1 order of magnitude faster than the L1 data cache** | `device-hardware/register-file` |
| L1 data cache is **~1 order of magnitude slower** than the compute units | `device-hardware/l1-data-cache` |
| Register file is split into **32-bit registers**, dynamically reallocatable across data types | `device-hardware/register-file` |
| Shared memories are "roughly kilobyte scale" | `perf/bank-conflict` |

### Worked occupancy example (H100)
Kernel: 32 threads/block, 8 registers/thread, 12 KB smem/block →
`64 > 1 warps/block` · `32 < 256 blocks/register-file` · `32 blocks/SM` · **`19 = blocks/smem = 228 KB ÷ 12 KB`** → limited to **19 blocks/SM = 19 warps**. — `perf/occupancy`

### Latency numbers
| Figure | Source page |
|---|---|
| Warp switch: **one clock cycle, roughly one nanosecond** | `device-hardware/warp-scheduler` |
| CPU thread context switch: **a few hundred to a few thousand clock cycles** (~1 μs) — "over 1000× slower" | `device-hardware/warp-scheduler`, `device-hardware/streaming-multiprocessor` |
| SASS latency example: `LDG.E.SYS` **400 cycles**, `IMUL` **6 cycles**, `IADD` **4 cycles**; sequential total **416 cycles**; hiding it needs **416 concurrent threads = 13 warps** | `perf/latency-hiding` |
| Little's Law example: 1 instr/cycle throughput + 400-cycle memory latency → **400 concurrent memory ops**; at 10 instr/cycle → **4,000** | `perf/littles-law` |
| Volkov: warps needed to hide pure memory latency vs pure arithmetic latency = **30 vs 24** | `perf/littles-law` |
| CUDA API call overhead: **~10 μs per kernel launch**; framework dispatch "many microseconds" | `perf/overhead` |
| Bank conflict penalty: 32-way conflict = **32× latency increase, from ~10 cycles to hundreds** | `perf/bank-conflict` |

### Bandwidth / roofline table (appears identically on three pages)
Source: `perf/arithmetic-intensity`, `perf/memory-bandwidth`, `perf/arithmetic-bandwidth`

| System (Compute / Memory) | Arithmetic BW (TFLOP/s) | Memory BW (TB/s) | Ridge Point (FLOP/byte) |
|---|---|---|---|
| A100 80GB SXM BF16 TC / HBM2e | 312 | 2 | 156 |
| H100 SXM BF16 TC / HBM3 | 989 | 3.35 | 295 |
| B200 BF16 TC / HBM3e | 2250 | 8 | 281 |
| H100 SXM FP8 TC / HBM3 | 1979 | 3.35 | 592 |
| B200 FP8 TC / HBM3e | 4500 | 8 | 562 |
| B200 FP4 TC / HBM3e | 9000 | 8 | 1125 |

Additional: **B200 memory bandwidth 8 TB/s (bidirectional) to HBM3e**; **B200 arithmetic bandwidth 9 PFLOPS at FP4** (`perf/memory-bandwidth`, `perf/arithmetic-bandwidth`). **Tensor Core : CUDA Core arithmetic bandwidth ≈ 100 : 1** as a rule of thumb (`perf/arithmetic-bandwidth`, `device-hardware/tensor-core`).

### Peak rate derivation (H100 FP32)
132 SMs × 128 FP32 cores × 1 FMA (= 2 FLOPs) = **33,792 instructions per clock**; × **1980 MHz** = **66,908 GFLOPS = 66.9 TFLOPS**, matching NVIDIA's advertised non-Tensor FP32 figure. — `perf/peak-rate`

### Arithmetic intensity table
Source: `perf/arithmetic-intensity`

| Kernel | FLOPs | Bytes Moved | Arithmetic Intensity | AI Scaling |
|---|---|---|---|---|
| SAXPY `y = ax + y` | 2N | 12N | 1/6 | O(1) |
| Single-Precision Real FFT | (5/2) N log N | 16N | (5/32) log N | O(log N) |
| SGEMM `C = A@B + C` | 2N³ | 16N² | N/8 | O(N) |

### Memory coalescing micro-benchmark (Tesla T4, SM 75, N = 67,108,864 floats = 256.0 MB, 10 iters)
Source: `perf/memory-coalescing`

| stride | GB/s |
|---|---|
| 1 | 206.0 |
| 2 | 130.5 |
| 4 | 68.8 |
| 8 | 33.8 |
| 16 | 16.8 |
| 32 | 15.2 |
| 64 | 13.6 |
| 128 | 11.2 |

Also: a **single DRAM burst services 128 bytes** — exactly 32 threads × one 32-bit float. — `perf/memory-coalescing`

### Shared memory banking
**32 banks, 4 bytes wide each**; consecutive 32-bit words map to consecutive banks; **addresses differing by 32 × 4 = 128 bytes collide**. — `perf/bank-conflict`

### Tensor Core instruction arithmetic
`HMMA16.16816.F32`: m=16, n=8, k=16 → **16 × 8 × 16 = 2,048 MACs per instruction**, = **64 MACs per thread** across a 32-thread warp. Tensor Cores provide **~100× the FLOP/s of CUDA Cores**. — `device-hardware/tensor-core`

### Scoreboards
A warp has **6 scoreboards**. — `perf/scoreboard-stall`

### LLM inference back-of-envelope
- Compute-bound: 500B params @ 16-bit = **1 TB**; ~**1 TFLOP per batch element per token**; on **1 PFLOP/s** → **1 ms/token/batch element**. To be compute-bound at batch size 1 you'd need **1 PB/s memory bandwidth**; real bandwidths are "in the TB/s range", hence **batches of hundreds** are required. (`perf/compute-bound`)
- Memory-bound: same 1 TB of weights at **10 TB/s → 100 ms** floor on inter-token latency. (`perf/memory-bound`)

---

## 5. Blackwell / sm100-specific vs. Hopper-specific vs. universal

### Blackwell (sm100 / CC 10.x) only
| Term | Why |
|---|---|
| **Tensor Memory** | Explicitly "certain GPUs, like the B200"; SemiAnalysis citation calls it "added in Blackwell". Accessed via `tcgen05.*` PTX. |
| **CTA pair / `.cta_group::2`** (the Blackwell half of `texture-processing-cluster`) | The 5th-gen Tensor Cores added the "CTA pair" PTX hierarchy level mapping onto TPCs; `tcgen05` instructions carry `.cta_group`. TPCs existed before but were invisible to the programming model. |
| **Compute capability `f` suffix** (e.g. `10.0f`) | Introduced with Blackwell; SemVer-like, breaks the onion-layer model across major versions. |
| **FP4 Tensor Core math** | Only B200 rows in the bandwidth table (9000 TFLOP/s, ridge point 1125). |

### Hopper (sm90 / CC 9.0) onward — Hopper + Blackwell
| Term | Why |
|---|---|
| **Tensor Memory Accelerator (TMA)** | "specialized hardware in Hopper and Blackwell architecture GPUs". |
| **Warpgroup** | "introduced in NVIDIA's Hopper SM architecture" for `wgmma.mma_async`. |
| **Thread block clusters / distributed shared memory** (the modern half of `graphics-processing-cluster`) | "Since the introduction of compute capability 9.0 GPUs like H100s". |
| **Compute capability `a` suffix** (e.g. `9.0a`) | Introduced with Hopper; compatibility explicitly not guaranteed. |
| **Inline-PTX-only features** (`wgmma`, `tma`) | As of Sept 2025 the glossary states inline PTX is the *only* way to reach some Hopper features — not expressible in pure CUDA C++. |

### Architecture-conditional but not new (varies by generation)
- **Tensor Core** — introduced in Volta (V100); 5th generation in Blackwell; internals differ per SM architecture and are undocumented.
- **CUDA Core** — composition (INT32/FP32/FP64 mix) varies per SM architecture; the term itself is "slippery".
- **Asynchronous copies** — added in Ampere (per the register-pressure page's SemiAnalysis reference).
- **Independent thread scheduling** — post-Volta; pre-Volta divergent warps were *always fully serialized*.
- **cuDNN emphasis** — Ampere-era CNNs; NVIDIA shifted to CUTLASS for Hopper/Blackwell Transformers.
- **Occupancy norms** — "high-performance GEMM kernels on Hopper and Blackwell often run at single-digit occupancy".
- **Ridge point** — a per-generation constant; has moved rightward Ampere → Hopper → Blackwell.

### Genuinely new / not-yet-settled (2026)
- **CUDA Tile programming model**, **Tile IR**, **cuTile Python / BASIC / Rust** — "at time of writing in mid-2026, the CUDA Tile programming model is new, and to what extent it will replace the existing 'CUDA SIMT' programming model is as yet unclear".

### Universal (every CUDA GPU, any generation)
All of: CUDA device architecture · SM · core · SFU · LSU · warp scheduler · SM architecture (concept) · TPC (as hardware) · GPC (as hardware) · register file · L1 data cache · GPU RAM · CUDA programming model · SASS · PTX · compute capability (concept) · thread · warp · CTA · kernel · thread block · thread block grid · thread hierarchy · memory hierarchy · registers · shared memory · global memory · the entire host-software section except CUDA Graphs' Blackwell example and CuTe DSL's recency · and the entire performance section except the occupancy-norms and ridge-point caveats above.

Note the warp-size caveat: **32 is "technically a machine-dependent constant"** — universal in practice, not in specification (`device-software/warp`).

---

## Appendix — all 78 URLs crawled

Device hardware (16): cuda-device-architecture, streaming-multiprocessor, core, special-function-unit, load-store-unit, warp-scheduler, cuda-core, tensor-core, tensor-memory-accelerator, streaming-multiprocessor-architecture, texture-processing-cluster, graphics-processing-cluster, register-file, l1-data-cache, tensor-memory, gpu-ram

Device software (17): cuda-programming-model, streaming-assembler, parallel-thread-execution, compute-capability, thread, warp, warpgroup, cooperative-thread-array, kernel, thread-block, thread-block-grid, thread-hierarchy, memory-hierarchy, registers, shared-memory, global-memory, cuda-tile-programming-model

Host software (22): cuda-software-platform, cuda-c, nvidia-gpu-drivers, nvidia-ko, cuda-driver-api, libcuda, nvml, libnvml, nvidia-smi, cuda-runtime-api, libcudart, cuda-graph, nvcc, nvrtc, cupti, nsight-systems, cuda-binary-utilities, cublas, cudnn, cutlass, cute, cute-dsl

Performance (23): performance-bottleneck, roofline-model, compute-bound, memory-bound, arithmetic-intensity, overhead, littles-law, memory-bandwidth, arithmetic-bandwidth, latency-hiding, warp-execution-state, active-cycle, occupancy, pipe-utilization, peak-rate, issue-efficiency, streaming-multiprocessor-utilization, warp-divergence, scoreboard-stall, branch-efficiency, memory-coalescing, bank-conflict, register-pressure
