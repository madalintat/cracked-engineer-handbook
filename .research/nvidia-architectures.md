# NVIDIA GPU Architecture Lineage — Complete Reference

Research date: 2026-09-01. Written as background/context for a hardware curriculum that
already covers Ampere, Hopper and Blackwell in depth.

**Authority order used throughout:** (1) the CUDA C++ Programming Guide "Compute
Capabilities" appendix and the PTX ISA spec, (2) NVIDIA architecture whitepapers,
(3) NVIDIA developer blog and product pages, (4) third-party databases. Where these
disagree, the disagreement is recorded in §9 rather than silently resolved.

Two canonical tables are cited so often below they get short names:

- **[CC-APP]** — CUDA C++ Programming Guide v13.3, §5.1 Compute Capabilities
  (Tables 28–33): <https://docs.nvidia.com/cuda/cuda-c-programming-guide/> →
  *Technical Appendices → Compute Capabilities*
- **[CC-LIST]** — NVIDIA "CUDA GPU Compute Capability" product list:
  <https://developer.nvidia.com/cuda-gpus> and the legacy page
  <https://developer.nvidia.com/cuda-legacy-gpus>

---

## 0. The shape of the story in one paragraph

Six things happened, in order, and everything else is detail. **Tesla (2006)** made the
GPU programmable at all and handed you a scratchpad. **Fermi (2010)** gave it a real
memory hierarchy and a flat address space, so C++ worked. **Kepler (2012)** made the warp
a first-class programmable object (`__shfl`). **Maxwell/Pascal (2014–16)** were efficiency
and capacity generations — Pascal added demand-paged unified memory and HBM. **Volta
(2017)** did two irreversible things: it added tensor cores, and it gave every thread its
own program counter, which invalidated a decade of warp-synchronous code. **Ampere →
Hopper → Blackwell (2020–2024)** is one continuous arc: move the data movement off the
threads. `cp.async` took the register file out of the global→shared path; TMA took the
threads out of it entirely; tcgen05 took the register file out of the *accumulator* path.
**Rubin (2026)** continues that same arc — it extends `tcgen05` rather than replacing it —
and adds one new idea worth teaching: FP64 is no longer a hardware datapath, it is
emulated on the tensor cores.

---

## 1. Tesla (2006) — the beginning

| | |
|---|---|
| Year | Nov 2006 (G80 / GeForce 8800 GTX); GT200 June 2008 |
| Process | 90 nm (G80), 65 nm (GT200), 55 nm (GT200b) |
| Flagship datacenter | Tesla C870 (G80, 2007, 128 cores, 1.5 GB GDDR3, 76.8 GB/s, 0.346 TFLOPS FP32) → Tesla C1060 (GT200, 2009, 240 cores, 4 GB GDDR3, 102.4 GB/s, 0.622 TFLOPS FP32 / 0.0778 TFLOPS FP64) |
| Flagship consumer | GeForce 8800 GTX (681 M transistors, 128 SPs, 768 MB GDDR3, 384-bit, 86.4 GB/s, 145 W) → GTX 285 |
| Compute capability | **sm_10** = G80; **sm_11** = G84/G86/G92/G94/G96/G98; **sm_12** = GT215/GT216/GT218; **sm_13** = GT200/GT200b |

**Key numbers.** G80 = 16 SMs × 8 SP = 128 cores (8 TPCs × 2 SMs). GT200 = 30 SMs = 240
cores. Registers/SM: **8 K** (sm_10/11) → **16 K** (sm_12/13). Shared memory: **16 KB per
SM, fixed, no L1, no L2, no ECC**. Max 124 registers/thread. Max resident threads/SM 768
(1.0/1.1) → 1024 (1.2/1.3). GDDR3. No NVLink.
Sources: [CC-LIST legacy], <https://en.wikipedia.org/wiki/CUDA>,
<https://www.nvidia.com/docs/IO/55506/GeForce_GTX_200_GPU_Technical_Brief.pdf>,
Fermi whitepaper's G80/GT200 comparison table.

**THE ONE THING: a programmer-managed 16 KB scratchpad plus a barrier, per SM.**
Before this the GPU had no addressable on-chip memory you could plan around. With it,
"stage a tile into shared memory, `__syncthreads()`, compute from shared" becomes the
universal CUDA idiom, and because there is **no cache anywhere**, coalescing rules and
bank conflicts are not an optimisation — they are the entire performance model.

**Precision.** FP32 only on G80/G92. **FP64 arrives with GT200 / sm_13**: one FP64 unit
per SM, **1:8 of FP32** (C1060: 0.6221 / 0.07776 = exactly 8.0). No FP16, no integer
tensor formats, no tensor cores.

**Tensor cores:** none.

---

## 2. Fermi (2010) — the GPU becomes a computer

| | |
|---|---|
| Year | March 2010 (GF100), Nov 2010 (GF110 refresh) |
| Process | TSMC 40 nm |
| Flagship datacenter | Tesla M2090 (GF110, 512 cores, 6 GB GDDR5, 177.6 GB/s, 1.331 TFLOPS FP32 / **0.666 TFLOPS FP64**, 225–250 W); C2050/C2070 = GF100, 448 cores, 144 GB/s |
| Flagship consumer | GTX 480 (GF100, 3.2 B transistors, 480 cores / 15 SMs, 1.5 GB GDDR5, 177.4 GB/s, 250 W) → GTX 580 (GF110, 512 cores / 16 SMs, 192.4 GB/s) |
| Compute capability | **sm_20** = GF100/GF110; **sm_21** = GF104/106/108/114/116/117/119 |

**Key numbers.** Full chip: **16 SMs × 32 cores = 512**, six 64-bit controllers → 384-bit.
**32 K (32,768) 32-bit registers per SM** — but only **63 registers per thread**, a
notorious ceiling. **64 KB configurable on-chip per SM: 48/16 or 16/48 shared/L1**; max
48 KB shared per SM *and* per block. **768 KB unified L2** — the first one NVIDIA ever
shipped. First ECC GPU. Up to 16 concurrent kernels. GDDR5. No NVLink.
Source: <https://www.nvidia.com/content/PDF/fermi_white_papers/NVIDIA_Fermi_Compute_Architecture_Whitepaper.pdf>,
CUDA C Programming Guide v8.0 Table 14.

**THE ONE THING: a unified 64-bit address space plus a real cache hierarchy.**
On Tesla, `__shared__`, `__local__` and global lived in separate, non-interchangeable
address windows, so a pointer was not a pointer — which meant no function pointers, no
virtual dispatch, no `std::`-shaped libraries. Fermi made one flat 64-bit space where the
same pointer resolves anywhere, and put an L1 in front of it. **That is the change that
made C++ on the GPU real**, and it is why "generic" CUDA code dates from 2010, not 2006.
ECC and IEEE 754-2008 FMA in both precisions land here too.

**Precision.** FP64 at **1:2 architecturally** (16 DP FMA/SM/clock, 8× GT200); Tesla parts
ship 1:2, GeForce is **firmware-capped to 1:8** (GTX 480: 1344.96/168.12 = 8.0 exactly).
No FP16, no INT8 dot products, no tensor cores.

**Tensor cores:** none.

---

## 3. Kepler (2012) — the warp becomes programmable

| | |
|---|---|
| Year | March 2012 (GK104) → Nov 2012 (GK110) → Nov 2014 (GK210/K80) |
| Process | TSMC 28 nm |
| Flagship datacenter | Tesla K40 (GK110B, 2880 cores, 12 GB GDDR5, 288 GB/s, 4.29 TFLOPS FP32 / 1.43 TFLOPS FP64) → **Tesla K80** (2× GK210, 4992 cores, 24 GB, 480 GB/s aggregate, 300 W) |
| Flagship consumer | GTX 680 (GK104, 1536 cores / 8 SMX, 192 GB/s) → GTX Titan (GK110, 2688 cores, 288.4 GB/s) → GTX 780 Ti (2880 cores / 15 SMX, 336.5 GB/s) |
| Compute capability | **sm_30** = GK104/GK106/GK107; **sm_32** = GK20A (Tegra K1); **sm_35** = GK110/GK110B/GK208; **sm_37** = GK210 (K80 only) |

**Key numbers.** Full GK110 = **15 SMX**, 7.1 B transistors. SMX = 192 FP32, 64 FP64,
32 SFU, 32 LD/ST, 4 warp schedulers × 2 dispatch.
**65,536 registers/SM (sm_30/32/35); 131,072 on sm_37/GK210** — GK210 is the *only*
NVIDIA GPU ever with a doubled register file, which is the entire reason sm_37 exists as a
separate target. Max registers/thread: **63 on sm_30/32, 255 on sm_35/37**.
Shared/L1: 64 KB per SMX split 48/16, 32/32 or 16/48; **sm_37 adds 64 KB → 80/96/112 KB
shared per SM**, but **max shared per thread block stays 48 KB on every Kepler**. Plus a
48 KB read-only (texture-path) data cache. L2: **1536 KB on GK110**, 512 KB on GK104.
GDDR5. No NVLink.
Sources: GK110 whitepaper
<https://compas.cs.stonybrook.edu/~nhonarmand/courses/sp16/cse502/res/NVIDIA-Kepler-GK110-Architecture-Whitepaper.pdf>,
Kepler Tuning Guide <https://docs.nvidia.com/cuda/archive/11.3.0/kepler-tuning-guide/index.html>.

**THE ONE THING: `__shfl` — warp lanes exchange registers directly, with no shared memory
and no barrier.** Every reduction, scan, transpose and butterfly you had been writing
through a shared-memory staging buffer collapses into a handful of register-to-register
instructions. It also created the *first* warp-level primitive whose correctness depended
on implicit lockstep — a debt Volta collects on five years later. Same generation, same
theme: **dynamic parallelism** (kernels launch kernels, sm_35+ only) and **Hyper-Q**
(32 hardware work queues instead of 1, which is what made multi-stream code stop
falsely serialising). Note the sm_30 / sm_35 split is real, not cosmetic: DP and Hyper-Q
are "No" on CC 3.0 in NVIDIA's own table, and 255 registers/thread is sm_35+ only.

**Precision.** FP64 **1:3** on GK110/GK210 HPC parts, **1:24** on GK104 and GTX 780 Ti;
GTX Titan and Titan Black are driver-switchable 1:3 ↔ 1:24. No FP16, no tensor cores.

**Tensor cores:** none.

---

## 4. Maxwell (2014) — efficiency, and shared memory stops fighting L1

| | |
|---|---|
| Year | Feb 2014 (GM107) → Sept 2014 (GM204) → March 2015 (GM200) |
| Process | TSMC 28 nm (Tegra X1 GM20B is 20 nm) |
| Flagship datacenter | Tesla M40 (GM200, 3072 cores, 12–24 GB GDDR5, 288 GB/s, 6.84 TFLOPS FP32 / **0.214 TFLOPS FP64**); Tesla M60 (2× GM204, VDI) |
| Flagship consumer | GTX 980 (GM204, 5.2 B transistors, 2048 cores / 16 SMM, 224 GB/s, 165 W) → GTX Titan X / 980 Ti (GM200, 3072 / 2816 cores, 336.5 GB/s) |
| Compute capability | **sm_50** = GM107/GM108; **sm_52** = GM200/GM204/GM206; **sm_53** = GM20B (Tegra X1, Jetson TX1, Jetson Nano) |

**Key numbers.** SMM = **128 cores in four 32-core partitions**, each with its own warp
scheduler, instruction buffer and register-file slice; "no shared units" between
partitions. **65,536 registers/SM, 255 max/thread.** Shared memory is now **dedicated
storage, not a carve-out of L1**: **64 KB/SM on sm_50, 96 KB/SM on sm_52**, 64 KB on
sm_53; **per-block limit still 48 KB**. L1 is merged with the texture cache.
L2: **2 MB on GM107 and GM204** (vs 256 KB on GK107 and 512 KB on GK104), **3 MB on
GM200**. GDDR5 only — **no HBM anywhere in Maxwell**. No NVLink.
Sources: Maxwell Tuning Guide
<https://docs.nvidia.com/cuda/archive/12.6.3/maxwell-tuning-guide/index.html>,
GTX 980 whitepaper <https://www.ece.lsu.edu/gp/refs/GeForce-GTX-980-Whitepaper-FINAL.pdf>.

**THE ONE THING: shared memory is decoupled from L1, and shared-memory atomics go
native.** Two consequences you feel in code. First, `cudaFuncCachePreferShared` stops
being a tuning knob you have to think about — capacity no longer trades against cache.
Second, Fermi/Kepler implemented `atomicAdd` on `__shared__` as a lock-update-unlock
loop; Maxwell has **native 32-bit shared-memory integer atomics and 32/64-bit CAS**, which
is why shared-memory histograms and reductions get dramatically faster with no code
change. The SMM partitioning also changes occupancy math: a warp issues to a dedicated
32-wide datapath, so you need fewer resident warps to hide latency.

**Precision.** FP64 **1:32** everywhere (4 DP units per SMM). **sm_53 (Tegra X1) is where
FP16 first appears** as a compute type, with 2× rate packed `half2` — but it is Tegra-only;
no discrete Maxwell has fast FP16. No tensor cores.

**Tensor cores:** none.

---

## 5. Pascal (2016) — HBM, NVLink, and memory that pages

| | |
|---|---|
| Year | April 2016 (GP100) → May 2016 (GP104) |
| Process | TSMC 16 nm FinFET (GP100/GP102/GP104/GP106); Samsung 14 nm (GP107/GP108) |
| Flagship datacenter | **Tesla P100** (GP100, 15.3 B transistors, 610 mm², 3584 cores / 56 SMs, 16 GB **HBM2** @ 732 GB/s SXM2, 10.6 TFLOPS FP32 / **5.3 TFLOPS FP64**, 300 W); Tesla P40 / P4 (GP102/GP104, INT8 inference) |
| Flagship consumer | GTX 1080 Ti (GP102, 3584 cores / 28 SMs, 11 GB GDDR5X, 484 GB/s) / Titan Xp (3840 cores, 547.7 GB/s) |
| Compute capability | **sm_60** = GP100; **sm_61** = GP102/GP104/GP106/GP107/GP108; **sm_62** = GP10B (Tegra X2, Jetson TX2) |

**Key numbers.** GP100 = 60 SMs full / 56 enabled, SM = 64 FP32 + 32 FP64,
**64 KB shared memory per SM**, 4 MB L2. GP104-class SM = 128 FP32,
**96 KB shared memory per SM** (this asymmetry is why sm_60 and sm_61 are separate
targets — same architecture, different SM shape). 65,536 registers/SM, 255/thread
everywhere. **First HBM2 (GP100 only)**; GDDR5X on GP102/GP104.
**First NVLink: NVLink 1.0, 4 links × 40 GB/s bidirectional = 160 GB/s per GPU**, GP100
only.
Sources: <https://developer.nvidia.com/blog/inside-pascal/>, CC-APP.

**THE ONE THING: unified memory with hardware page faulting and a 49-bit virtual address
space.** Kepler/Maxwell "unified memory" was a managed allocation that had to be fully
resident and got bulk-copied at kernel boundaries. Pascal's GPU can **take a page fault**,
so `cudaMallocManaged` becomes real demand paging: you can allocate more than the GPU has,
touch it from either side, and migrate on access — and the CPU and GPU can now hold
pointers into the *same* 49-bit address space, which covers the whole system VA range.
This is what made "just allocate it and run" a legitimate porting strategy. Second-order
but real: **instruction-level compute preemption** ended the class of bug where a long
kernel got killed by the display watchdog.

**Precision.** FP64 **1:2 on GP100**, 1:32 on GP102/104. **FP16 arrives on discrete
silicon**: GP100 does packed `half2` at **2× FP32 rate**; GP102/GP104 have FP16 but at
**1/64 rate** (present for correctness, not speed) — a classic trap. sm_61 adds **`dp4a`
and `dp2a`: 4-way INT8 and 2-way INT16 dot-product-accumulate instructions**, which is the
real ancestor of tensor-core INT8 and why Tesla P4/P40 were sold as inference parts.

**Tensor cores:** none. (`dp4a` is a scalar-pipe instruction, not a matrix unit.)

---

## 6. Volta (2017) — the generation that broke your old code

| | |
|---|---|
| Year | May 2017 |
| Process | TSMC 12 nm FFN |
| Flagship datacenter | **Tesla V100** (GV100, 21.1 B transistors, 815 mm², 5120 cores / 80 SMs, 640 tensor cores, 16 or 32 GB HBM2 @ **900 GB/s**, 15.7 TFLOPS FP32 / **7.8 TFLOPS FP64** / **125 TFLOPS FP16 tensor**, 300 W SXM2) |
| Flagship consumer | Titan V (GV100, 80 SMs, 12 GB HBM2, 652.8 GB/s) — the only consumer-branded Volta |
| Compute capability | **sm_70** = GV100; **sm_72** = GV10B/GV11B (Xavier, Jetson AGX Xavier, DRIVE AGX) |

**Key numbers.** Full GV100 = **84 SMs** (80 enabled on V100). SM is split into four
processing blocks, each with 16 FP32 + 16 INT32 + 8 FP64 + **2 tensor cores** → 8 tensor
cores per SM, 640 per GPU. **65,536 registers/SM.** **Unified 128 KB L1/shared per SM,
of which up to 96 KB is shared** — and the L1 is now fast enough that NVIDIA explicitly
told people to *stop* hand-staging into shared memory for streaming access patterns.
**6 MB L2.** **NVLink 2.0: 6 links × 50 GB/s bidirectional = 300 GB/s per GPU**, plus
CPU-coherent NVLink on POWER9.
Sources: <https://developer.nvidia.com/blog/inside-volta/>, CC-APP,
GV100 whitepaper.

**THE ONE THING: independent thread scheduling. Every thread gets its own program counter
and call stack, so a warp's 32 threads are no longer guaranteed to re-converge or to
execute in lockstep.**
This is the single most consequential compatibility break in CUDA's history. Every kernel
that had ever relied on implicit warp-synchrony — `volatile` shared-memory reductions with
no barrier below 32 threads, `__shfl` without a mask, spin-locks that assumed one lane
could make progress while another waited — became *undefined behaviour that still happens
to pass on pre-Volta hardware*. NVIDIA deprecated the entire non-`_sync` warp intrinsic
family in CUDA 9 (`__shfl` → `__shfl_sync`, `__ballot` → `__ballot_sync`, `__any` →
`__any_sync`) and added **`__syncwarp()`**, which had no reason to exist before. Teach
this one as a story about implicit contracts, not as a feature.

Volta also introduced **tensor cores**, which is the bigger deal commercially and the
smaller deal pedagogically — a kernel author in 2017 reached them only through
`wmma::` fragments, an opaque API with an unspecified register layout.

**Precision.** **FP16 with FP32 accumulate on the tensor core** — this is the format's
debut as a *matrix* type. FP64 1:2, FP32:FP16 vector 1:2. No BF16, no TF32, no INT8 on the
tensor core (INT8 is still `dp4a` in the scalar pipe).

**Tensor cores — 1st generation.** 4×4×4 matrix multiply-accumulate per instruction,
FP16 inputs, FP16 or FP32 accumulator, warp-scoped, reachable only via the
`nvcuda::wmma` C++ API (there was no public `mma` PTX instruction with a documented
fragment layout at launch). 125 TFLOPS on V100 vs 15.7 TFLOPS FP32 — an 8× cliff that
reorganised the entire field around it.

---

## 7. Turing (2018) — tensor cores get integers and an ISA

| | |
|---|---|
| Year | Sept 2018 |
| Process | TSMC 12 nm FFN |
| Flagship datacenter | **Tesla T4** (TU104, 40 SMs, 2560 cores, 320 tensor cores, 16 GB GDDR6 @ 320 GB/s, **70 W**, 65 TFLOPS FP16 / 130 TOPS INT8 / 260 TOPS INT4); Quadro RTX 8000 (TU102, 48 GB) |
| Flagship consumer | RTX 2080 Ti (TU102, 18.6 B transistors, 754 mm², 4352 cores / 68 SMs, 544 tensor cores, 68 RT cores, 11 GB **GDDR6** @ 616 GB/s) / Titan RTX (72 SMs, 24 GB, 672 GB/s) |
| Compute capability | **sm_75** = TU102 / TU104 / TU106 / TU116 / TU117 — one target for the whole family, including the tensor-core-less GTX 16 series |

**Key numbers.** Full TU102 = **72 SMs**. Turing SM = 64 FP32 + 64 INT32 on **separate,
concurrently-issuable datapaths** + 8 tensor cores. **65,536 registers/SM.**
**96 KB unified L1/shared per SM, of which max 64 KB is shared** (carveouts: 32 or 64 KB)
— note this is *less* shared memory than Volta's 96 KB, and it is the one place the
Volta→Turing move can lose you occupancy. **L2 5.5 MB on TU102**, 4 MB on TU104.
First GDDR6. NVLink present only on TU102/TU104 professional parts and the 2080 Ti:
**2 × 25 GB/s per direction = 100 GB/s bidirectional on TU102**, half that on TU104.
Max resident threads/SM drops to **1024** (from Volta's 2048) — the other easy occupancy
surprise. [CC-APP]

**THE ONE THING: `mma.sync` — a documented, warp-scoped matrix instruction in PTX, with a
specified per-lane fragment layout.**
Volta gave you tensor cores behind `wmma`, a black box whose register mapping NVIDIA did
not publish; you could use it, but you could not build a library around it. Turing
published `mma.sync.aligned.m16n8k8` and friends, which is what made CUTLASS-style
open tensor-core GEMMs, hand-written fused epilogues and (later) FlashAttention possible
at all. Everything from `mma.sync` through Hopper's `wgmma` to Blackwell's `tcgen05.mma`
is one evolutionary line that starts here. Secondary but worth teaching: the
**independent INT32 datapath** means address arithmetic and loop bookkeeping stop
stealing FP32 issue slots (NVIDIA measured ~36 integer ops per 100 FP ops in real
shaders), and RT cores appear.

**Precision gained.** **INT8, INT4 and INT1/binary on the tensor core** (INT8 130 TOPS,
INT4 260 TOPS, binary 1040 TOPS on T4). FP16 tensor retained. Still **no BF16, no TF32,
no FP8**. FP64 is 1:32 — Turing has no HPC ambitions.

**Tensor cores — 2nd generation.** Same 4×4×4-per-cycle shape as Volta plus the integer
types, plus the public `mma.sync` PTX path.

**⚠ sm_75 is not a homogeneous target.** TU116 and TU117 (GTX 1650/1660 series) are
sm_75 devices with **no tensor cores and no RT cores**; TU116 substitutes dedicated
2×-rate FP16 units in their place. Code compiled for sm_75 that issues `mma.sync` will
compile and load on a GTX 1660 and then fail or fall off a performance cliff. This is the
first time `sm_XX` stopped being a reliable proxy for "has feature Y" and it is worth
flagging to students, because the same thing recurs at sm_86 (no FP64 tensor) and sm_120.

---

## 8. Ampere (2020) — asynchronous copy

| | |
|---|---|
| Year | May 2020 (A100), Sept 2020 (RTX 30) |
| Process | **GA100: TSMC 7 nm N7** (54.2 B transistors, 826 mm²). **GA10x: Samsung 8 nm "8N NVIDIA Custom"** (GA102 28.3 B, 628.4 mm²). *Two different foundries in one generation.* |
| Flagship datacenter | **A100** (108 of 128 SMs, 40 GB HBM2 @ 1555 GB/s or 80 GB HBM2e @ 2039 GB/s SXM, 19.5 TFLOPS FP32 / 19.5 TFLOPS FP64-tensor / 312 TFLOPS BF16-tensor, 400 W) |
| Flagship consumer | RTX 3090 (GA102, 82 of 84 SMs, 10496 cores, 24 GB GDDR6X @ **936 GB/s**, 6 MB L2, 350 W); RTX 3090 Ti = 84 SMs |
| Compute capability | **sm_80** = GA100 (A100, A30); **sm_86** = GA102/GA104/GA106/GA107 (RTX 30 series, A40, A10, A16, A2, RTX A6000); **sm_87** = Orin iGPU (Jetson AGX Orin, Orin NX, Orin Nano, DRIVE AGX Orin) |

**Key numbers** [CC-APP unless noted]. **65,536 registers/SM on all of 8.0/8.6/8.7** (the
Wikipedia CUDA table's "128 K for 8.0" is wrong — see §9).
Shared memory diverges sharply within the generation:

| CC | Unified L1+smem | Max smem/SM | Max smem/block | Max threads/SM | Max blocks/SM |
|---|---|---|---|---|---|
| 8.0, 8.7 | **192 KB** | **164 KB** | 163 KB | 2048 | 32 |
| 8.6 | **128 KB** | **100 KB** | 99 KB | 1536 | 16 |

L2: **A100 40 MB** (≈7× V100), **GA102 6 MB**. **NVLink 3.0: 600 GB/s per GPU** on A100
(12 links × 25 GB/s/dir); RTX 3090 / A6000 keep a 2-way consumer NVLink.
**MIG**: A100 partitions into up to **7 hardware-isolated instances** with separate paths
through the crossbar, L2 banks, memory controllers and DRAM busses — not time-slicing.
Sources: GA100 whitepaper
<https://images.nvidia.com/aem-dam/en-zz/Solutions/data-center/nvidia-ampere-architecture-whitepaper.pdf>,
GA102 whitepaper
<https://images.nvidia.com/aem-dam/en-zz/Solutions/geforce/ampere/pdf/NVIDIA-ampere-GA102-GPU-Architecture-Whitepaper-V1.pdf>.

**THE ONE THING: `cp.async` — global memory to shared memory without touching the register
file.** From the GA100 whitepaper: the instruction "loads data directly from global memory
into SM shared memory, *eliminating the need for intermediate register file usage*."
Before Ampere, every software-pipelined GEMM burned registers as a staging buffer for the
next tile, and register pressure — not math — set your tile size. `cp.async` (with
`mbarrier` / `cuda::pipeline` / `cuda::memcpy_async` above it) makes the copy a fire-and-
forget transaction you wait on later, which is what turned multi-stage software pipelining
from a heroic trick into the standard shape of a fast kernel. Ampere ships the whole
supporting cast in one go: **`mbarrier` asynchronous split arrive/wait barriers**, and
**L2 residency control** (`cudaStreamAttributeAccessPolicyWindow` with `hitRatio` /
`cudaAccessPropertyPersisting`), which lets you pin a hot window in that huge new L2.

**Precision gained.** **TF32** (19-bit: FP32 range, FP16 mantissa — a drop-in 8× speedup
for FP32 GEMM with no code change, enabled by default in cuBLAS) and **BF16** both debut
here on the tensor core. **Structured 2:4 sparsity** doubles tensor throughput.
**FP64 on the tensor core** (19.5 TFLOPS on A100) — **sm_80 only**. Retains FP16, INT8,
INT4, INT1.

**Tensor cores — 3rd generation.** Wider per-instruction shapes, TF32/BF16/FP64 support,
2:4 sparsity, and `ldmatrix` for efficient fragment loads.

**⚠ sm_86 ≠ sm_80.** GA102 has **two FP64 units per SM** at **1:64** of FP32, "included to
ensure any programs with FP64 code operate correctly" — there is **no FP64 tensor
datapath**. FP64 MMA compiles and runs on sm_86, at 1/64 rate. sm_86 also has 1536
threads/SM and 100 KB shared vs sm_80's 2048 and 164 KB, so an occupancy-tuned A100
kernel routinely fails to fit on a 3090. **sm_87 (Orin) tracks sm_80's memory sizes, not
sm_86's** — an easy thing to get backwards.

---

## 9. Ada Lovelace (2022) — FP8 and a very large L2

| | |
|---|---|
| Year | Oct 2022 |
| Process | TSMC 4N (AD102: 76.3 B transistors, 608.5 mm²) |
| Flagship datacenter | **L40S** / L40 (full AD102, 48 GB GDDR6 @ 864 GB/s, **no NVLink**); L4 (AD104, 24 GB, 300 GB/s, 72 W) |
| Flagship consumer | **RTX 4090** (AD102, 128 of 144 SMs, 16384 cores, 24 GB GDDR6X @ 1008 GB/s, **72 MB L2**, 450 W) |
| Compute capability | **sm_89** = AD102/AD103/AD104/AD106/AD107 (RTX 40 series, RTX 6000 Ada, L40S, L40, L4, L20) |

**Key numbers.** Full AD102 = **144 SMs / 18432 cores**; RTX 4090 = 128 SMs.
Per-SM resources are **identical to sm_86**: 128 FP32, 4 tensor cores, 256 KB register
file (65,536 × 32-bit), **128 KB unified L1/shared with max 100 KB shared per SM**,
1536 threads/SM. Max blocks/SM rises to 24. **L2: 98304 KB (96 MB) on the full AD102 —
but the RTX 4090 ships 73728 KB (72 MB)**, a distinction almost every secondary source
gets wrong. **No NVLink anywhere in Ada** (the word does not appear once in the
whitepaper). Sources: Ada whitepaper
<https://images.nvidia.com/aem-dam/Solutions/geforce/ada/nvidia-ada-gpu-architecture.pdf>,
[CC-APP].

**THE ONE THING — the honest answer: Ada added no new programming model.** It is the one
generation on this list with no architectural change that alters how you write a kernel.
What it actually gives you is (a) **FP8 E4M3/E5M2 on the tensor core** — `mma` with
`.e4m3`/`.e5m2` "requires sm_89 or higher", and `cvt` to/from `e4m3x2`/`e5m2x2` — and
(b) a **16× larger L2** (6 MB → 96 MB on the full die), which changes your blocking
arithmetic but requires no new instruction. Shader Execution Reordering is real and
significant, but it is a graphics feature exposed through NVAPI, not CUDA.

Everything the same-era Hopper got, Ada did **not** get: no thread block clusters, no
distributed shared memory, no TMA, no `wgmma`, no `setmaxnreg`, and **no hardware DPX**
(the CUDA guide's instruction-throughput table reads "Multiple instruct." for DPX at
every CC from 5.0 through 8.9, and gives real rates only at 9.0). This is the cleanest
example in the whole lineage of **"same tensor core generation number, different
programming model"** — worth teaching precisely because the marketing number lies.

**Precision gained.** **FP8 E4M3 and E5M2.** Everything else carried over from Ampere.
Still no FP64 tensor hardware (288 FP64 cores, 2 per SM, 1:64).

**Tensor cores — 4th generation** (NVIDIA's own label; Hopper is *also* 4th generation).

---

## 10. Hopper (2022) — the threads stop doing the copying

| | |
|---|---|
| Year | Announced 22 March 2022 |
| Process | TSMC 4N (GH100: 80 B transistors, 814 mm²) |
| Flagship datacenter | **H100 SXM5** (132 of 144 SMs, 80 GB HBM3 @ **3.35 TB/s**, 67 TFLOPS FP32 / 67 TFLOPS FP64-tensor / 989 TFLOPS TF32 / 1979 TFLOPS BF16 / **3958 TFLOPS FP8**, 700 W) → **H200** (141 GB **HBM3e** @ **4.8 TB/s**) → GH200 Grace Hopper Superchip |
| Flagship consumer | **none** — Hopper is datacenter-only |
| Compute capability | **sm_90** and **sm_90a** = GH100 (H100, H100 NVL, H200, GH200) |

**Key numbers** [CC-APP]. Full GH100 = **144 SMs** (8 GPCs × 9 TPCs × 2); H100 SXM5 = 132,
H100 PCIe = 114. **65,536 registers/SM.** **256 KB unified L1/shared per SM, of which up
to 228 KB is shared** (carveouts 0/8/16/32/64/100/132/164/196/228 KB) — the largest
shared memory NVIDIA has ever shipped, and the reason large-tile FlashAttention fits.
Max smem/block 227 KB. 2048 threads/SM, 32 blocks/SM. **L2: 50 MB.**
**NVLink 4.0: 18 links, 900 GB/s per GPU**; NVLink Switch scales to 256 GPUs.
2nd-gen MIG with per-instance Confidential Computing / TEE.

**THE ONE THING — pick one and it is TMA, but Hopper really shipped three coupled changes:**

1. **TMA (Tensor Memory Accelerator)** — `cp.async.bulk.tensor`. A hardware DMA engine
   driven by a *tensor descriptor* (base pointer, shape, strides, box size, swizzle) that
   copies a multidimensional tile between global and shared memory. One thread issues it.
   From the whitepaper: "*only a small number of CUDA threads are now required to manage
   the full memory bandwidth of H100 … while most other CUDA threads can be computing.*"
   Ampere's `cp.async` still needed every thread to compute its own address; TMA deletes
   the address-generation code entirely and does the swizzling in hardware.
2. **Thread block clusters + distributed shared memory (DSMEM)** — a new level between
   block and grid (`__cluster_dims__`, `cudaLaunchKernelEx`, `cluster.sync()`,
   `barrier.cluster`). Blocks in a cluster are co-scheduled on the same GPC and can
   **load, store and atomically operate on each other's shared memory** via `mapa` and
   `.shared::cluster` addresses — roughly 7× faster than round-tripping through global.
   Portable max is 8 blocks per cluster; hardware max is 16.
3. **Warpgroup MMA (`wgmma.mma_async`)** — an *asynchronous* MMA issued by four warps
   acting as one 128-thread warpgroup, taking **operands directly from shared memory**
   rather than from registers. Combined with **`setmaxnreg`** (dynamically redistribute
   register capacity between producer and consumer warpgroups) this is what makes
   warp-specialised producer/consumer kernels — TMA warp feeds, MMA warps consume — the
   canonical Hopper kernel shape.

Also: **native DPX** dynamic-programming instructions, and an **asynchronous transaction
barrier** where `mbarrier` counts transferred *bytes* as well as thread arrivals, which is
how you wait on a TMA completion.

**`sm_90` vs `sm_90a` — the precise rule.** The `a` suffix debuts here (PTX ISA 8.0 /
CUDA 12.0). Per the PTX spec, `a`-targets "*include architecture-specific features that
are supported on the specified architecture only … such targets do not follow the onion
layer model*", so **`sm_90a` binaries will not run on any later architecture.**
What actually requires `sm_90a`: `wgmma.mma_async`, `setmaxnreg`, static shared memory
above 48 KB per CTA, and TMA's `.multicast::cluster` variant.
What only needs plain `sm_90`: `cp.async.bulk.tensor` (base TMA), `mapa`,
`barrier.cluster`. **"TMA requires sm_90a" is a widespread and incorrect shorthand.**

**Precision gained.** **FP8 E4M3 and E5M2 on the tensor core** plus the **Transformer
Engine**, which per-tensor tracks amax statistics and switches between FP8 and 16-bit
automatically. FP64 tensor is back and fast (67 TFLOPS). **Hopper drops INT4 and binary**
from the tensor core (CC-APP Table 33 lists INT8 but not INT4 for 9.0) — the only time
NVIDIA has removed a tensor input type.

**Tensor cores — 4th generation** (same number as Ada, very different unit: warpgroup
scope, shared-memory operands, real FP64).

---

## 11. Blackwell (2024–2025) — the accumulator leaves the register file

Blackwell is **two architectures under one brand**, and CUDA is explicit about it: the
10.x family (datacenter) and the 12.x family (consumer / workstation / edge) are **not
binary compatible with each other** — a `compute_100f` binary does not run on sm_120 and
vice versa [CC-APP Table 28].

| | Datacenter (10.x) | Consumer / Pro (12.x) |
|---|---|---|
| Year | 2024 (B100/B200/GB200) → 2025 (B300/GB300) | Jan 2025 (RTX 50) |
| Process | **TSMC 4NP**, dual reticle-limit dies (104 B transistors each → **208 B**) joined by **NV-HBI at 10 TB/s**, CoWoS-L, presenting as **one CUDA device** | **TSMC 4N** ("TSMC 4nm 4N NVIDIA Custom Process", RTX Blackwell whitepaper spec table — *not* 4NP), monolithic |
| Flagship | **B200 / GB200** (192 GB HBM3e @ **8 TB/s**, **126 MB L2**, 10 PFLOPS dense NVFP4) → **B300 / GB300 "Blackwell Ultra"** (**160 SMs, 640 tensor cores**, **288 GB HBM3e @ 8 TB/s**, **15 PFLOPS dense NVFP4**) | **RTX 5090** (GB202, 170 of 192 SMs, 21760 cores, 680 tensor cores, 32 GB **GDDR7** @ **1792 GB/s**, 512-bit, **96 MB L2** of the full die's 128 MB, 575 W); RTX PRO 6000 Blackwell (96 GB) |
| Compute capability | **sm_100** = GB100 (B100, B200, GB200); **sm_103** = Blackwell Ultra (B300, GB300, GB300 DGX Station) | **sm_120** = GB202/GB203/GB205/GB206/GB207 (RTX 5050→5090, RTX PRO 2000→6000 Blackwell, RTX PRO Blackwell Server Edition); **sm_121** = GB10 (DGX Spark; 48 SMs, 6144 cores, 50 MB L2, 128 GB LPDDR5X @ 273 GB/s, ~1 PFLOP FP4) |
| Also | **sm_110** = **Jetson Thor** (Jetson T5000, T4000) — Blackwell, CC 11.0, its own family. **`sm_101` was *renamed* to `sm_110` in PTX ISA 9.0**, not deleted; CC 10.1 is deprecated. | |

**Key numbers** [CC-APP; Blackwell Ultra blog
<https://developer.nvidia.com/blog/inside-nvidia-blackwell-ultra-the-chip-powering-the-ai-factory-era/>;
RTX Blackwell whitepaper].

| CC | Unified L1+smem | Max smem/SM | Max smem/block | Regs/SM | Threads/SM | Blocks/SM | FP32:FP64 |
|---|---|---|---|---|---|---|---|
| 10.0, 10.3, 11.0 | **256 KB** | **228 KB** | 227 KB | 64 K | 2048 | 32 | 2:1 (10.0) / **64:1** (10.3, 11.0) |
| 12.0, 12.1 | **128 KB** | **100 KB** | 99 KB | 64 K | 1536 | 24 † | 64:1 |

† NVIDIA's own docs disagree on blocks/SM for 12.x — see §15 item 14. Everything else in
this table is unambiguous, and it is confirmed verbatim by the Blackwell Tuning Guide:
"*For devices of compute capability 10.0 shared memory capacity per SM is 228 KB. For
devices of compute capability 12.0, shared memory capacity per SM is 128 KB*"
(<https://docs.nvidia.com/cuda/blackwell-tuning-guide/index.html>). Cross-checked in the
PTX ISA: extended static shared-memory cap is **228 KB for sm_100a/sm_103a/sm_110a** and
**100 KB for sm_120a/sm_121a**.

Consumer side, from the RTX Blackwell whitepaper (verbatim): full GB202 = **12 GPCs,
192 SMs, 24576 CUDA cores, 768 tensor cores, 512-bit**, and "*the full GB202 GPU includes
128 MB of L2 cache, while the RTX 5090 specifically includes 96 MB of L2*"; RTX 5090 =
170 SMs / 21760 cores / 680 tensor cores. Per SM: "*128 CUDA Cores, one Blackwell
Fourth-Generation RT Core, four Blackwell Fifth-Generation Tensor Cores, 4 Texture Units,
a **256 KB Register File**, and **128 KB of L1/Shared Memory***". GB202 has **384 FP64
cores (2 per SM) at 1:64**, plus "*a very minimal number of FP64 Tensor Cores … included
for program correctness*."

Datacenter: **B200 L2 = 126 MB** ("*The NVIDIA GB200 GPU increases the L2 cache capacity
to 126 MB*", Blackwell Tuning Guide) — versus H100's 50 MB.
**NVLink 5.0 — 1.8 TB/s per GPU** (18 links × 100 GB/s, 2× NVLink 4), NVLink-C2C to Grace
at 900 GB/s, PCIe Gen 6; NVLink Switch scales to 576 GPUs. GB200 NVL72 = 72 GPUs +
36 Grace, 1440 PFLOPS NVFP4 (sparse), 13.4 TB HBM3e, 130 TB/s NVLink.
**Clusters:** portable max is still 8 blocks, but B200 permits **non-portable cluster size
16** via `cudaFuncAttributeNonPortableClusterSizeAllowed`.

**THE ONE THING: `tcgen05` and Tensor Memory (TMEM) — the accumulator moves out of the
register file into a dedicated 256 KB-per-SM address space.**
Through Volta→Hopper, an MMA's accumulator lived in the warp's registers. That capped tile
size at the register file and made every fast GEMM a register-allocation puzzle. Blackwell
adds **Tensor Memory**, a third on-chip address space that only the tensor core and a
handful of new instructions can reach.

**TMEM's exact shape**, from the PTX ISA §9.7.17 "TensorCore 5th Generation Family
Instructions" (verbatim): "*the 5th generation TensorCore's Tensor Memory has a
two-dimensional structure of **512 columns and 128 rows per CTA, with each cell being
32-bits in size***" — 512 × 128 × 4 B = **256 KB per SM**. Addresses are 32-bit: bits
31–16 select the lane (row), bits 15–0 the column. It is **dynamically allocated**: "*the
unit of allocation is **32 columns** and the number of columns being allocated must be a
**power of 2** … All of the Tensor Memory that was allocated in a kernel **must be
explicitly deallocated** before the kernel exits.*"

The instruction family:
- **`tcgen05.alloc` / `.dealloc` / `.relinquish_alloc_permit`** — allocate and free TMEM
  columns. Must be issued by a **single warp**, and the same warp must do both.
- **`tcgen05.mma`** (plus `.sp` sparse and `.ws` weight-stationary) —
  `tcgen05.mma.cta_group.kind [d-tmem], a-desc, b-desc, idesc, …`. **The accumulator D is
  a TMEM address.** A is either a shared-memory descriptor or a TMEM address; B is always
  a shared-memory descriptor. `.kind` ∈ `{f16, tf32, f8f6f4}` or block-scaled
  `{mxf8f6f4, mxf4, mxf4nvf4}`. It is **issued by one thread and is asynchronous**;
  completion is signalled through an mbarrier via `tcgen05.commit`.
- **`tcgen05.ld` / `tcgen05.st`** — the *only* path between TMEM and registers.
  Warp-synchronous, and **each warp of a warpgroup can reach only 32 of the 128 lanes**
  (warp *i* → lanes 32*i* … 32*i*+31).
- **`tcgen05.cp`** (SMEM→TMEM, with optional on-the-fly 4-/6-bit → 8-bit decompression),
  `tcgen05.shift`, `tcgen05.fence`, `tcgen05.wait`.

Consequences for the kernel author:
1. **The accumulator leaves the register file.** A large Hopper `wgmma` tile spent most of
   the 64 K registers on the D fragment; Blackwell's MMA needs none for data. The register
   file is still 64 K/SM and is now free for the epilogue and softmax.
2. **One thread issues the MMA** — the "who issues" progression Volta (warp) → Hopper
   (warpgroup) → Blackwell (single thread) completes here. Warp specialisation stops being
   a technique and becomes the default shape: one warp drives TMA + MMA, the rest consume.
3. **TMEM is a manually managed resource with a lifetime**: alloc/dealloc, power-of-2
   column counts ≥ 32, one owning warp, must be freed before exit. It is a **third budget**
   alongside registers and shared memory, and it is the new occupancy limiter.
4. **The 32-lane-per-warp access rule dictates your epilogue's thread mapping.** You cannot
   read an arbitrary TMEM cell from an arbitrary thread.
5. **CTA-pair / 2-SM MMA** (`.cta_group::2`): two adjacent CTAs in a cluster cooperate on
   one MMA across two SMs' tensor cores and TMEM, doubling the effective tile and halving
   shared-memory traffic for the shared operand. Cluster launch and peer-CTA indexing
   become a **correctness** requirement, not an optimisation.

**⚠ The single most important teaching point about Blackwell: `tcgen05` and TMEM are
10.x-only. VERIFIED.** The PTX ISA "Target ISA Notes" for **every** `tcgen05` instruction
(alloc, dealloc, ld, st, cp, shift, wait, fence, commit, mma, mma.sp, mma.ws) lists
`sm_100a`, `sm_101a` *(renamed `sm_110a` from PTX ISA 9.0)*, and the corresponding `f`
targets — and **`sm_120a` / `sm_121a` appear nowhere in that list**. Compiling `tcgen05`
for sm_120 fails in `ptxas`.

Consumer/workstation Blackwell instead gets the new **data types on the old delivery
mechanism**: warp-level **`mma.sync` with register accumulators**, extended with
block-scaled variants, e.g.
`mma.sync.aligned.m16n8k64.row.col.kind::mxf4nvf4.block_scale.scale_vec::4X.f32.e2m1.e2m1.f32.ue4m3`.
Per the PTX spec, "*.e3m2, .e2m3 and .e2m1 alternate floating point type mma operation
**requires sm_120a***", and the `.kind` / `.block_scale` / `.scale_vec` qualifiers likewise.

**So a Blackwell GEMM is effectively two kernels.** sm_100/103: TMA + `tcgen05` + TMEM +
CTA-pair, 228 KB shared, 64 warps/SM. sm_120/121: TMA + `mma.sync` + registers, 100 KB
shared, 48 warps/SM. CUTLASS carries separate SM100 and SM120 kernel families for exactly
this reason. This, not clock speed, is why "Blackwell support" in a library is never one
checkbox.
Sources: PTX ISA <https://docs.nvidia.com/cuda/parallel-thread-execution/index.html>;
Colfax, *Writing GEMM Kernels Using Tensor Memory for NVIDIA Blackwell GPUs*
<https://research.colfax-intl.com/cutlass-tutorial-writing-gemm-kernels-using-tensor-memory-for-nvidia-blackwell-gpus/>;
Colfax, *NVFP4 Block-Scaled GEMM on RTX PRO Blackwell (SM12x)*
<https://research.colfax-intl.com/cutlass-tutorial-nvfp4-blockscaled-gemm-on-nvidia-rtx-pro-blackwell-gpus-sm12x/>

**Precision gained.** **FP4 and FP6** join the tensor core [CC-APP Table 33]:
- **FP4 E2M1**, in three flavours: raw FP4 (software scaling), **MXFP4** (one shared
  power-of-two scale per 32 values), and **NVFP4** — NVIDIA's own format, **one FP8 E4M3
  scale per 16-value micro-block plus a second-level FP32 per-tensor scalar**. NVFP4 is
  the one with hardware-accelerated two-level scaling and the one that holds accuracy
  within ~1% of FP8 on large models.
  Source: <https://developer.nvidia.com/blog/introducing-nvfp4-for-efficient-and-accurate-low-precision-inference/>
- **FP6** — **E2M3 and E3M2**, MX-style, block of 32 with an E8M0 scale.
- FP8, FP16, BF16, TF32, INT8 all retained. **INT4 stays gone** (dropped at Hopper).

**Tensor-core input types, [CC-APP] Table 33:**

| CC | FP64 | TF32 | BF16 | FP16 | FP8 | FP6 | FP4 | INT8 | INT4 |
|---|---|---|---|---|---|---|---|---|---|
| 9.0 Hopper | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | ✔ | — |
| **10.0** B200 | **✔** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| **10.3** B300 | **—** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| 11.0 Thor | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| **12.x** RTX 50 | **—** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |

- **FP64 tensor core: present on sm_100 only.** Absent on sm_103, sm_110 and all of 12.x.
  Blackwell Ultra deliberately traded FP64 away for NVFP4 throughput — its FP32:FP64 ratio
  is **64:1 versus B200's 2:1**. If your curriculum has an HPC/FP64 thread, **B200 is the
  last FP64-serious NVIDIA part shipping.**
- **Blackwell Ultra also dropped INT8 from the `tcgen05` path**: PTX says `tcgen05.mma`'s
  `.kind::i8` is supported on `sm_100a` and `sm_110a` — **sm_103a is absent** — even though
  Table 33 still lists INT8 as an input type for 10.3 (reachable by other means).
- **NVFP4's `ue4m3` scale path is `sm_120a`-gated on consumer**, and on datacenter the
  `.scale_vec::1X/2X/4X` qualifiers **require `sm_100a`**, while the generalised
  `.block16` / `.block32` replacements need only `sm_100f` / `sm_110f` (family-wide, so
  they cover 10.3). Precision support is not a per-chip yes/no — it is per-instruction and
  per-target-suffix.
- **Blackwell Ultra vs B200 on NVFP4: dense goes 10 → 15 PFLOPS (1.5×), sparse stays at
  20 PFLOPS on both.** Only the dense rate moved.

**Tensor cores — 5th generation**, with the **2nd-generation Transformer Engine**
(FP4-aware, per-block scaling in hardware). Blackwell Ultra additionally **doubles SFU
throughput for `exp2f`**, roughly halving softmax cost in attention.

**Compilation targets.** Blackwell introduces the **`f` (family-specific) suffix** in
CUDA 12.9 alongside the existing `a`. Compatibility, per [CC-APP Table 28]:
`compute_100f` → runs on 10.0 **and** 10.3; `compute_120f` → runs on 12.0 **and** 12.1;
`compute_103f` → 10.3 only; `compute_110f` → 11.0 only; `compute_121f` → 12.1 only.
Feature-set ordering is `baseline ⊂ family (f) ⊂ architecture-specific (a)`.
`sm_100a` runs on 10.0 hardware and nothing else, ever.

---

## 12. Rubin / Vera Rubin (2026) — announced vs rumoured

**Status as of September 2026: shipping. In full production since May 2026. Its CUDA
target is `sm_107`, currently developer-preview only (CUDA 13.4 DP), not GA.**

### ✅ ANNOUNCED AND SHIPPING

- **Full production confirmed twice by NVIDIA.** Press release 31 May 2026 (GTC Taipei),
  "NVIDIA Vera Rubin Ramps Into Full Production to Power Agentic AI Factories Worldwide"
  <https://nvidianews.nvidia.com/news/vera-rubin-full-production-agentic-ai-factory>; and
  Q2 FY2027 earnings, 26 Aug 2026, Jensen Huang: "*Vera Rubin, now in full production, was
  built to power exactly this moment*"
  <https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027>.
  Deployed at CoreWeave, Google Cloud, Azure, OCI, Nebius.
- **Naming:** the shipping rack is **Vera Rubin NVL72** (72 GPU *packages*). The earlier
  GTC-2025 name **NVL144** counted GPU *dies*. Both are NVIDIA's; NVL72 is current.
- **Vera Rubin Superchip** = one **Vera** CPU + **two Rubin GPUs**.
  **Vera** uses NVIDIA's custom Arm-compatible **Olympus** core, **88 cores per CPU**.

**Official spec table**, <https://www.nvidia.com/en-us/data-center/vera-rubin-nvl72/>
(NVIDIA footnotes it "Preliminary information … subject to change"):

| | Vera Rubin NVL72 | Vera Rubin Superchip | **Rubin GPU** |
|---|---|---|---|
| Config | 72 Rubin + 36 Vera | 2 Rubin + 1 Vera | 1 |
| NVFP4 inference | 3,600 PFLOPS | 100 PF | **50 PFLOPS** |
| NVFP4 training (dense) | 2,520 PFLOPS | 70 PF | 35 PF |
| FP8 / FP6 (dense) | 1,260 PFLOPS | 35 PF | 17.5 PF |
| INT8 | 18 POPS | 500 TOPS | 250 TOPS |
| FP16 / BF16 | 288 PFLOPS | 8 PF | 4 PF |
| TF32 | 144 PFLOPS | 4 PF | 2 PF |
| FP32 / FP64 | 9,360 / 2,400 TFLOPS | 260 / 67 TF | **130 / 33 TFLOPS** |
| FP32 SGEMM / FP64 DGEMM (**tensor-core emulated**) | 28,800 / 14,400 TFLOPS | 800 / 400 TF | 400 / 200 TF |
| Memory | 20.7 TB **HBM4** @ 1,580 TB/s | 576 GB @ 44 TB/s | **288 GB HBM4 @ 22 TB/s** |
| **NVLink 6** | 260 TB/s switch | 7.2 TB/s | **3.6 TB/s per GPU** (2× NVLink 5) |
| NVLink-C2C | 65 TB/s | 1.8 TB/s | — |
| CPU | 3,168 Olympus cores, 54 TB LPDDR5X | 88 cores, 1.5 TB | — |

Note the **FP64 story**: native FP64 is only 33 TFLOPS per GPU, but NVIDIA quotes
**200 TFLOPS DGEMM via tensor-core emulation**. FP64 has moved from a hardware datapath to
a software technique built on lower-precision tensor cores. That is a curriculum-relevant
shift, not a footnote.

Also announced: **new Transformer Engine with "adaptive compression"**, 3rd-gen
Confidential Computing, 2nd-gen RAS engine
(<https://www.nvidia.com/en-us/data-center/technologies/rubin/>); ConnectX-9 SuperNIC
1.6 Tb/s; Spectrum-6 102.4 Tb/s; **Vera Rubin NVL4** (MGX, 4 Rubin + 2 Vera).
CoreWeave reports **10× tokens/s/MW versus GB200 NVL72** on DeepSeek-R1
(<https://blogs.nvidia.com/blog/vera-rubin/>).

### ✅ ANNOUNCED, NOT YET SHIPPED — Rubin CPX

Press release 9 Sept 2025
<https://nvidianews.nvidia.com/news/nvidia-unveils-rubin-cpx-a-new-class-of-gpu-designed-for-massive-context-inference>:
a "*cost-efficient, **monolithic die** design*" with **128 GB GDDR7** (not HBM), **up to
30 PFLOPS NVFP4**, integrated video encoders/decoders, and **3× faster attention than
GB300 NVL72**. Its purpose is **disaggregated inference**: CPX runs the compute-bound
*prefill/context* phase, HBM4 Rubin runs the bandwidth-bound *decode* phase.
**Vera Rubin NVL144 CPX** is quoted at **8 exaFLOPS, 100 TB fast memory, 1.7 PB/s**.
"*Expected to be available at the end of 2026*" — as of September 2026 no shipping
announcement has appeared.

### 🎯 Rubin's CUDA target is `sm_107` — not sm_110, not sm_130

**CUDA Toolkit 13.4 Developer Preview** adds **`sm_107` / `sm_107f` / `sm_107a`** and
`compute_107{,f,a}`, labelled verbatim "**Rubin support**" in the nvcc GPU Feature List:
<https://docs.nvidia.com/cuda/developer-preview/13.4/cuda-compiler-driver-nvcc/index.html>.
Release notes: "*CUDA Toolkit preview for RTX Spark and **Rubin** … New and updated PTX
ISA, including some **Rubin capabilities**.*"

**Rubin keeps the `tcgen05` family and extends it** (PTX ISA 9.4):
- `.kind::ti16` for `tcgen05.mma{,.sp,.ws,.ws.sp}`
- **UE5M3** as a third microscaling scale format (alongside `ue8m0` and `ue4m3`), plus
  `.ue5m3x2` conversions and `.scaled::n1::ue8m0`
- **`.decompress::lut::b`** on `tcgen05.mma` — almost certainly the silicon behind the
  marketing phrase "Transformer Engine with adaptive compression"
- `.collector::b::*` (B-operand reuse, mirroring Blackwell's A-collector)
- `.spcompress` on `tcgen05.ld` / `ld.red`; new `spcompress` / `spdecompress`
- `.exclusive` on `tcgen05.alloc` / `.dealloc`
- packed `add`/`sub`/`mul`/`fma` on `.f16x2` / `.bf16x2` / `.f32x2` and ×4 FP8/FP6/FP4
- a `.minperctamemory` directive plus `%perctamemoryoffset` / `%perctamemorysize`
  (a new per-CTA global memory concept)
- **`sm_107a` max static shared memory = 228 KB** — Rubin stays in the "big SMEM" camp
- **Rubin is its own family**: `sm_107f or higher in the same family` appears independently
  of `sm_100f`, so `compute_100f` binaries do **not** cover Rubin.

**In shipping CUDA 13.3 (GA), nvcc stops at sm_121 and the word "Rubin" appears zero
times.** So: Rubin is programmable today only via the developer preview.
**`sm_130` does not exist in any CUDA 13.x document**, and **`sm_110` is Jetson Thor**, not
Rubin — both are common and wrong guesses.

### ⚠️ NOT OFFICIALLY DISCLOSED (widely repeated, still rumour)

- **Process node.** NVIDIA has published none. TSMC N3-family is the well-sourced press
  expectation; Wikipedia's infobox hedges "3NP or 3PN". **Rumour.**
- **Transistor count.** Not published anywhere. The "336 B transistors" figure circulating
  in GTC coverage is **not** from an NVIDIA specification page. The NVL72 table's "12
  NVIDIA + HBM4 chips per Rubin GPU" implies a multi-die package with 8 HBM4 stacks, but
  die count is not stated. **Unverified.**
- **Rack power.** Not on the spec table.
- **"6th-generation tensor core" as a name.** Rubin extends `tcgen05`; NVIDIA has not
  published a `tcgen06`. Do not assert a generation number.

### 📋 ROADMAP ONLY (a slide, not a product)

- **Rubin Ultra — 2H 2027.** The widely cited **NVL576 / HBM4e / 1 TB per package**
  figures come from GTC 2025 keynote **slides only**; they could not be sourced from any
  NVIDIA text page. Treat as roadmap-slide-only.
- **Feynman — 2028.** Confirmed only indirectly, as a name in NVIDIA communications about
  using Blackwell to design it.

---

## 13. §7 deliverable — complete `sm_XX` → architecture reference table

Datacenter and consumer representatives given for every target. Sources: [CC-LIST],
[CC-LIST legacy], [CC-APP], <https://en.wikipedia.org/wiki/CUDA>,
<https://arnon.dk/matching-sm-architectures-arch-and-gencode-for-various-nvidia-cards/>.

| `sm_XX` | CC | Architecture | Chips | Datacenter parts | Consumer / workstation / edge parts | Year | Toolkit status |
|---|---|---|---|---|---|---|---|
| `sm_10` | 1.0 | Tesla | G80 | Tesla C870, D870, S870 | GeForce 8800 GTX / Ultra, Quadro FX 5600 | 2006 | removed (CUDA 7 last) |
| `sm_11` | 1.1 | Tesla | G84, G86, G92, G94, G96, G98 | — | GeForce 9800 GTX, 8800 GT, GTS 250 | 2007–08 | removed |
| `sm_12` | 1.2 | Tesla | GT215, GT216, GT218 | — | GeForce GT 240, GT 220, Quadro FX 380 | 2009 | removed |
| `sm_13` | 1.3 | Tesla | GT200, GT200b | Tesla C1060, S1070, M1060 | GTX 295 / 285 / 280, Quadro FX 5800 | 2008–09 | removed |
| `sm_20` | 2.0 | Fermi | GF100, GF110 | Tesla C2050/C2070/C2075, M2050/M2090 | GTX 580 / 570 / 480, Quadro 6000 | 2010 | removed (CUDA 9 last) |
| `sm_21` | 2.1 | Fermi | GF104/106/108/114/116/117/119 | — | GTX 560 Ti, GTX 460, GTS 450, Quadro 2000 | 2010–11 | removed |
| `sm_30` | 3.0 | Kepler | GK104, GK106, GK107 | Tesla K10 | GTX 770 / 760 / 690 / 680, Quadro K5000 | 2012 | removed (CUDA 10 last) |
| `sm_32` | 3.2 | Kepler | GK20A | — | Tegra K1, Jetson TK1 | 2014 | removed |
| `sm_35` | 3.5 | Kepler | GK110, GK110B, GK208 | Tesla K20, K20X, K40 | GTX Titan / Titan Black, GTX 780 Ti, Quadro K6000 | 2012–13 | removed (CUDA 11 last) |
| `sm_37` | 3.7 | Kepler | GK210 | **Tesla K80** | — | 2014 | removed (CUDA 11 last) |
| `sm_50` | 5.0 | Maxwell | GM107, GM108 | Tesla M10 | GTX 750 Ti / 750, Quadro K2200 | 2014 | removed (CUDA 11 last) |
| `sm_52` | 5.2 | Maxwell | GM200, GM204, GM206 | Tesla M40, M60 | GTX Titan X, GTX 980 Ti / 980 / 970 / 960, Quadro M6000 | 2014–15 | removed (CUDA 11 last) |
| `sm_53` | 5.3 | Maxwell | GM20B | — | Tegra X1, Jetson TX1, **Jetson Nano** | 2015 | removed (CUDA 11 last) |
| `sm_60` | 6.0 | Pascal | GP100 | **Tesla P100**, DGX-1 | Quadro GP100 | 2016 | offline compile removed in CUDA 13 |
| `sm_61` | 6.1 | Pascal | GP102/104/106/107/108 | Tesla P40, P4, P6 | **GTX 1080 Ti**, Titan Xp, GTX 1080/1070/1060, Quadro P6000 | 2016 | offline compile removed in CUDA 13 |
| `sm_62` | 6.2 | Pascal | GP10B | — | Tegra X2, Jetson TX2, DRIVE PX2 | 2017 | offline compile removed in CUDA 13 |
| `sm_70` | 7.0 | **Volta** | GV100 | **Tesla V100** (16/32 GB) | **Titan V**, Quadro GV100 | 2017 | supported |
| `sm_72` | 7.2 | Volta | GV10B / GV11B | — | Jetson AGX Xavier, Xavier NX, DRIVE AGX Xavier | 2018 | supported |
| `sm_75` | 7.5 | **Turing** | TU102/104/106/**116/117** | **Tesla T4** | RTX 2080 Ti, Titan RTX, RTX 2080/2070/2060, Quadro RTX 8000/6000/5000, **GTX 1660/1650 (no tensor cores)** | 2018–19 | supported |
| `sm_80` | 8.0 | **Ampere** | GA100 | **A100** (40/80 GB), A30 | — | 2020 | supported |
| `sm_86` | 8.6 | Ampere | GA102/103/104/106/107 | A40, A10, A16, A2 | **RTX 3090 Ti / 3090**, RTX 3080/3070/3060/3050, RTX A6000/A5000/A4000 | 2020–21 | supported |
| `sm_87` | 8.7 | Ampere | GA10B (Orin) | — | Jetson AGX Orin, Orin NX, Orin Nano, DRIVE AGX Orin | 2022 | supported |
| `sm_89` | 8.9 | **Ada Lovelace** | AD102/103/104/106/107 | **L40S**, L40, L20, L4 | **RTX 4090**, RTX 4080/4070/4060, RTX 6000 Ada, RTX 5000/4500/4000 Ada | 2022–23 | supported |
| `sm_90` / `sm_90a` | 9.0 | **Hopper** | GH100 | **H100** (SXM/PCIe/NVL), **H200**, GH200 | — | 2022–23 | supported |
| `sm_100` / `100a` / `100f` | 10.0 | **Blackwell** (DC) | GB100 | **B200**, B100, **GB200** | — | 2024–25 | CUDA 12.8+ |
| `sm_103` / `103a` / `103f` | 10.3 | **Blackwell Ultra** | GB300-class | **B300**, **GB300 NVL72** | GB300 DGX Station | 2025 | CUDA 12.9+ |
| `sm_110` / `110a` / `110f` | 11.0 | Blackwell (Thor) | T-series | — | **Jetson T5000, Jetson T4000** (Jetson Thor) | 2025 | CUDA 13.0+. **Renamed from `sm_101` in PTX ISA 9.0**; CC 10.1 deprecated |
| `sm_120` / `120a` / `120f` | 12.0 | **Blackwell** (consumer) | GB202/203/205/206/207 | RTX PRO 6000 / 4500 Blackwell **Server Edition** | **RTX 5090**, RTX 5080/5070 Ti/5070/5060 Ti/5060/5050, RTX PRO 6000 / 5000 / 4500 / 4000 / 2000 Blackwell | 2025 | CUDA 12.8+ |
| `sm_121` / `121a` / `121f` | 12.1 | Blackwell (GB10) | GB10 | — | **DGX Spark / RTX Spark**; also DriveOS | 2025 | CUDA 12.9+ |
| `sm_107` / `107a` / `107f` | **10.7** | **Rubin** | Rubin (R200/VR200), Rubin CPX | **Vera Rubin NVL72**, NVL4, NVL144 CPX | — | 2026 | **CUDA 13.4 Developer Preview only** — absent from 13.3 GA |

**Rules to memorise alongside the table:**
- `a` suffix (`sm_90a`, `sm_100a`, `sm_120a`, `sm_107a`) = **architecture-specific**, runs
  on exactly that CC and nothing else, ever. Introduced with CC 9.0 / PTX ISA 8.0 /
  CUDA 12.0.
- `f` suffix (`sm_100f`, `sm_120f`) = **family-specific**, runs on every member of that
  family. Introduced with CC 10.0 / CUDA 12.9. Feature sets nest: `baseline ⊂ f ⊂ a`.
- Bare `sm_XX` follows the onion model — forward-compatible with later CCs via PTX JIT.

**Family membership, [CC-APP] Table 28 (verbatim):**

| Target | Runs on CC |
|---|---|
| `compute_100f` | 10.0 **and** 10.3 |
| `compute_103f` | 10.3 only *(single-member family for now)* |
| `compute_110f` | 11.0 only *(single-member)* |
| `compute_120f` | 12.0 **and** 12.1 |
| `compute_121f` | 12.1 only *(single-member)* |
| `compute_107f` | Rubin — **its own family**, independent of `compute_100f` |

- **10.x and 12.x are different major versions, so no cubin crosses between them.** The
  general rule is same-major / same-or-higher-minor; only embedded PTX (JIT) bridges the
  two Blackwell families. This is not a Blackwell quirk, but it bites hard here because
  both families are marketed under one name.
  <https://docs.nvidia.com/cuda/blackwell-compatibility-guide/>

---

## 14. §8 deliverable — what is still worth teaching

**Teach in depth (live hardware, live code).**
- **Volta (sm_70).** Not for the hardware — for **independent thread scheduling**. It is
  the best available lesson in "implicit contracts eventually get collected," and every
  `_sync` intrinsic in modern CUDA exists because of it. Also the origin of tensor cores.
- **Turing (sm_75).** For **`mma.sync`**: the first documented matrix ISA, ancestor of
  everything. Also the first "same `sm_XX`, different feature set" trap (GTX 16 series).
  T4 is still deployed at scale for inference.
- **Ampere (sm_80/86).** `cp.async`, `mbarrier`, TF32, BF16, 2:4 sparsity, MIG. A100 is
  still everywhere and sm_86/sm_89 is the floor most consumer CUDA code targets.
- **Ada (sm_89).** Teach it *as a counterexample*: a full generation with no new
  programming model. FP8 debuts here, and L40S/RTX 4090 are the most common dev boxes.
- **Hopper (sm_90a).** TMA, clusters, DSMEM, `wgmma`, `setmaxnreg`. Still the reference
  architecture for hand-written high-performance kernels.
- **Blackwell (sm_100a / sm_120).** `tcgen05`, TMEM, NVFP4, and the 10.x/12.x family
  split. This is current.

**Teach as one slide of context, not a chapter.**
- **Pascal (sm_60/61).** Two ideas survive: **HBM** and **demand-paged unified memory**.
  P100 is retired; `sm_60` lost offline compilation in CUDA 13.
- **Kepler (sm_35).** One idea survives and it is a big one: **`__shfl`** and the warp as
  a programmable unit. Also the origin of dynamic parallelism and Hyper-Q. Hardware dead.
- **Maxwell (sm_52/53).** One idea: **shared memory decoupled from L1** and native
  shared-memory atomics. Jetson Nano keeps sm_53 alive in hobbyist land.

**Purely historical — mention, never assign.**
- **Fermi (sm_20).** Historically the most important generation after Tesla (unified
  address space → C++ on GPU, first L2, first ECC), but nothing about writing a 2026
  kernel depends on knowing it. Worth one paragraph on *why* a flat address space matters.
- **Tesla (sm_1x).** One paragraph: this is where `__shared__` and `__syncthreads()` come
  from, and where "there is no cache, coalescing is everything" was literally true.

**Teach as "current, but preview-only." Rubin (`sm_107`).** It is in full production and
deployed, its PTX extensions are published, and its spec table is official — so it belongs
in the handbook now, not on a roadmap slide. Two caveats to state plainly: toolkit support
is **developer-preview (CUDA 13.4 DP), not GA**, and Rubin's **process node and transistor
count are genuinely undisclosed**. The one substantively new teaching point is **FP64 by
tensor-core emulation** — 33 TFLOPS native versus 200 TFLOPS emulated DGEMM per GPU, i.e.
FP64 has moved from a hardware datapath to a software technique layered on lower-precision
tensor cores. Also worth noting for the tensor-core thread: Rubin **extends `tcgen05`**
rather than replacing it, so the Blackwell TMEM model you teach carries forward.

---

## 15. §9 deliverable — what could not be verified, and where sources disagree

### Confirmed errors in widely-cited secondary sources
1. **Wikipedia's CUDA "technical specifications" table extracts with shifted columns.**
   It yields "128 K registers/SM for CC 8.0" and "80/96/112 KiB shared for CC 2.x", both
   wrong. **[CC-APP] Table 31 gives a single merged cell: 64 K 32-bit registers per SM for
   every CC from 7.5 through 12.x.** Cross-checked against the GA102 whitepaper
   (21504 KB register file ÷ 84 SM = 256 KB = 65,536 × 32-bit) and the RTX Blackwell
   whitepaper ("a 256 KB Register File" per SM). Use the CUDA appendix, not Wikipedia.
2. **RTX 4090 L2 is 72 MB (73728 KB), not 96 MB.** 96 MB is the *full* AD102 die (L40 /
   L40S). Ada whitepaper Table 1.
3. **"TMA requires `sm_90a`" is wrong.** Per the PTX ISA spec, `cp.async.bulk.tensor`
   requires plain `sm_90`; `mapa` and `barrier.cluster` likewise. Only `wgmma.mma_async`,
   `setmaxnreg`, >48 KB static shared per CTA, and TMA's `.multicast::cluster` variant
   need `sm_90a`.
4. **Wikipedia's Kepler article says GTX Titan is FP64 1:24.** It is driver-switchable
   1:3 ↔ 1:24. The GeForce 700 series table is the correct one.
5. **NVIDIA's own legacy CC page lists GeForce 9800 GT / 9600 GT under CC 1.0.**
   Those are G92/G94 parts and are CC 1.1. Minor NVIDIA page error.

### Genuine source disagreements, unresolved
6. **A100 40 GB memory type: HBM2 (NVIDIA GA100 whitepaper) vs HBM2e (TechPowerUp).**
   Report follows NVIDIA. The 80 GB parts are unambiguously HBM2e.
7. **H100 SXM bandwidth: "over 3 TB/s" (Hopper whitepaper v1.02) vs 3.35 TB/s (product
   page / whitepaper v1.04).** Not a contradiction — an early figure versus the final one.
   Use 3.35 TB/s.
8. **CUDA guide prose vs whitepapers on FP64 tensor cores at CC 8.6.** The guide's 8.x
   section lists "double precision (fp64)" among third-gen tensor core types for 8.0, 8.6
   *and* 8.7 without qualification. The GA102 and Ada whitepapers, and the guide's own
   throughput table (FP64 per clock per SM: 8.0 → 32, 8.6 → 2, 8.9 → 2, 9.0 → 64), say
   sm_86/sm_89 have only 2 scalar FP64 units per SM at 1:64 and **no FP64 tensor
   datapath**. **The whitepapers are right; the guide's prose is loose.** FP64 MMA will
   compile and run on sm_86 — very slowly.
9. **Wikipedia maps CC 10.3 to die "GB110".** GB110 is more commonly reported as the GPU
   die inside the **GB10** (DGX Spark, CC **12.1**) superchip, not Blackwell Ultra.
   NVIDIA's own [CC-LIST] gives only product names (B300, GB300) for 10.3, no die
   codename. **Treat the 10.3 die codename as unverified.** Report uses "GB300-class".

### Unverified / not found
10. **Launch dates for A100, RTX 3090 and RTX 4090** were not sourced from a primary
    NVIDIA document in this pass (whitepapers carry no dates). Hopper's announcement date
    (22 March 2022) *is* confirmed via NVIDIA newsroom. The 2020/2020/2022 years are
    reliable; exact dates are not sourced here.
11. **Die codenames GA104/GA106/GA107, AD103/AD106/AD107 and especially GA10B (Orin)** are
    from third-party databases; NVIDIA's own Tegra documentation just prints "Orin".
    Board-level compute capabilities are confirmed; die names are not.
12. **G80 = 16 SMs** comes from secondary technical write-ups; no live NVIDIA G80
    whitepaper URL was found.
13. **B200 SM count is genuinely disputed and NVIDIA does not publish it.**
    Chips and Cheese **measured 148 SMs** (74 per die, 80 physical)
    <https://chipsandcheese.com/p/nvidias-b200-keeping-the-cuda-juggernaut>; Wikipedia's
    die table implies **144** (18,432 CUDA cores ÷ 128). Blackwell **Ultra** *is* confirmed
    at **160 SMs / 640 tensor cores** by NVIDIA's own developer blog. Do not state a B200
    SM count as fact.
14. **Max resident blocks per SM at CC 9.0 and 12.x.** The CUDA Programming Guide's
    Table 30 uses merged cells that are ambiguous when scraped, and the **Blackwell Tuning
    Guide contradicts the Programming Guide** for 12.x: the tuning guide says "*the maximum
    number of thread blocks per SM is 32 for devices of compute capability 10.0 and 12.0*",
    while the Programming Guide table reads 24. This report uses 32 for 9.0/10.x/11.0 and
    24 for 12.x, but **verify against the current guide before printing it in a handbook
    table.** The registers/SM (64 K), threads/SM and shared-memory rows are unambiguous.
15. **RTX PRO 6000 Blackwell Server Edition marketed as "B40"** — widely repeated, no
    NVIDIA source found. Unverified.
16. **Rubin's process node and transistor count are undisclosed by NVIDIA.** The
    "TSMC N3 / 3NP" node and the "336 B transistors" figure both come from press coverage
    and Wikipedia editors, not from an NVIDIA specification page. Anyone quoting a Rubin
    transistor count is guessing. Rubin's **compute capability is not a guess** — it is
    `sm_107`, per CUDA 13.4 DP's nvcc feature list.
17. **NVIDIA's own GB300 NVL72 page is internally inconsistent**: it labels 1,080.2 PFLOPS
    FP4 as "with sparsity", but 72 × 15 PF *dense* = 1,080, and NVIDIA marketing elsewhere
    says "1.1 EF dense FP4". Its "37 TB fast memory" also conflicts with "40 TB" in other
    NVIDIA collateral. Pick one and footnote it.
18. **GB110 as a die name.** Wikipedia maps CC 10.3 to "GB110"; other sources use GB110 for
    the DGX Spark GPU die (CC 12.1). No NVIDIA source names either. Wikipedia's own
    Blackwell page calls the Spark die **GB10** / "DGX Spark GB20B". Treat all Blackwell
    die codenames beyond GB100 / GB202-207 as unverified.
19. **B300 FP64 rate.** The ~1.39 TFLOPS figure (vs B200's ~40) is press/third-party
    (Tom's Hardware), not an NVIDIA datasheet line. The **removal of the FP64 tensor core
    on 10.3 is confirmed** by [CC-APP] Table 33 and by the 64:1 FP32:FP64 ratio; only the
    exact number is second-hand.
20. **Pascal, Volta and Turing figures in §5–§7 were not re-verified against primary
    whitepapers in this pass** — the background agent assigned to them did not return
    before writing. The compute capabilities, shared-memory and register figures come from
    [CC-APP] and are solid; SM counts, bandwidths, transistor counts and NVLink figures are
    from established knowledge and should be spot-checked against the GP100 / GV100 /
    TU102 whitepapers before publication. The Turing NVLink figure (100 GB/s bidirectional
    on TU102, 50 on TU104) is the least certain.
21. **TechPowerUp could not be used at all.** Its GPU database returns HTTP 403 to scripted
    fetches and serves a JavaScript bot-check to `curl`; only `og:description` metadata was
    recoverable. **No claim in this report rests on it.** AnandTech is offline (URLs
    redirect to TechRadar) and web.archive.org was unreachable, so the usual deep-dive
    secondary sources for Tesla-through-Maxwell were unavailable; those sections lean on
    NVIDIA whitepapers, the CUDA 8.0 guide PDF and Wikipedia series articles instead.

### Resolved during research — previously-suspected issues that turned out fine
- **RTX 5090's 96 MB L2 is confirmed by NVIDIA**, not just TechPowerUp: the RTX Blackwell
  whitepaper states "*the full GB202 GPU includes 128 MB of L2 cache, while the RTX 5090
  specifically includes 96 MB of L2*."
- **Consumer Blackwell is TSMC 4N, not 4NP.** The RTX Blackwell whitepaper's own spec
  table prints "TSMC 4nm 4N NVIDIA Custom Process" for the RTX 5090 — the same string as
  the RTX 4090. Datacenter Blackwell is 4NP. Press coverage frequently says 4NP for both.
- **sm_120 / sm_121 lacking `tcgen05` and TMEM is now VERIFIED**, not inferred: the PTX
  ISA's Target ISA Notes for every `tcgen05` instruction list `sm_100a` / `sm_110a` and
  their `f` variants, and never `sm_120a` / `sm_121a`.
- **`sm_101` was renamed, not deleted.** PTX ISA says, on every `tcgen05` instruction,
  "*sm_101a (Renamed to sm_110a from PTX ISA version 9.0)*". CC 10.1 is deprecated in
  favour of 11.0.
