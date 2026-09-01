# AMD and the Other Accelerators

**A non-CUDA-parochial chapter for a CUDA-deep curriculum.**

Research compiled 2026-09-01. Every factual claim is sourced. Sections marked
**[UNVERIFIED]** or **[CONFLICTING SOURCES]** are exactly that — do not teach them as fact.

The premise of this chapter: you are going deep on CUDA, and that is the right call —
it is where the jobs, the papers and the tooling are. But a person who only knows CUDA
tends to mistake *NVIDIA's design choices* for *how GPUs work*. Warp size 32 is not a
law of physics. It is a number NVIDIA picked. This chapter is the inoculation.

---

## Part 0: The one-paragraph version

AMD is the only vendor with a genuine general-purpose GPU-compute alternative: same
SIMT mental model, same kernel/block/thread hierarchy, a source-compatible C++ dialect
(HIP), and a library stack that mirrors CUDA's name-for-name. Everything else is either
a narrower bet (Intel's is a compiler standard, Apple's is a laptop, Google's is a
different machine entirely) or a startup with a fundamentally different architecture and
a fundamentally smaller software ecosystem. The portable layer that actually won in
practice is **Triton**, and it won not by being the most portable but by being the layer
ML engineers actually wanted to write in.

---

# Part 1: AMD

## 1.1 Architecture lineage: why there are two AMD GPU architectures

Through 2019, AMD had one GPU architecture: **GCN** (Graphics Core Next, 2012–2019,
five generations, gfx6 through gfx9). One design served gaming and compute. GCN's
defining choice was a **64-wide wavefront executed on 16-wide SIMD units over 4 clock
cycles** — great for throughput, bad for the branchy, low-occupancy shaders that games
actually run.

In 2019 AMD forked the line ([Tom's Hardware on the later
re-unification](https://www.tomshardware.com/pc-components/cpus/amd-announces-unified-udna-gpu-architecture-bringing-rdna-and-cdna-together-to-take-on-nvidias-cuda-ecosystem),
[Jon Peddie](https://www.jonpeddie.com/news/amd-to-integrate-cdna-and-rdna-architectures-to-compete-in-ai/)):

| Line | Target | Wavefront | Matrix units | Display/raster hardware |
|---|---|---|---|---|
| **RDNA** (gfx10, gfx11, gfx12) | Consumer gaming, workstation | **32 native**, 64 optional | RDNA3+: "AI Accelerators" (WMMA) | Yes — full raster, RT, display |
| **CDNA** (gfx908, gfx90a, gfx942, gfx950) | Datacenter HPC/AI | **64 only** | Yes — Matrix Cores (MFMA) | **No display outputs, no raster/ROP hardware** |

The rationale AMD gave was per-market micro-optimization: RDNA got a narrower,
lower-latency 32-wide SIMD issuing one instruction per cycle for divergence-heavy game
shaders; CDNA kept the 64-wide, 4-cycle-cadence design and spent the freed die area on
matrix units, HBM controllers, and FP64. CDNA parts literally cannot drive a monitor.

**The cost of that fork is the honest lesson of this section.** A developer with a
Radeon on their desk and an MI300X in the cloud is targeting two different wavefront
widths, two different matrix instruction families (WMMA vs MFMA), and two different
tuning regimes. NVIDIA never split — a 4090 and an H100 both run warp-32 and both run
`mma` instructions with the same PTX shapes. That single-architecture continuity is a
large, underrated component of CUDA's moat, and AMD has effectively conceded the point:
they announced **UDNA**, a re-unification of RDNA and CDNA, at IFA 2024
([TechPowerUp](https://www.techpowerup.com/326442/amd-to-unify-gaming-rdna-and-data-center-cdna-into-udna-singular-gpu-architecture-similar-to-nvidias-cuda)).

> **Teaching note.** "AMD split its architecture and is now un-splitting it because
> developers couldn't follow" is a better story about why software ecosystems are hard
> than any FLOPS chart.

### Generation map

| Arch | LLVM target (`gfx`) | Parts |
|---|---|---|
| GCN 5.0 / Vega | `gfx900` | MI25, Vega 56/64 |
| GCN 5.1 / Vega20 | `gfx906` | MI50, MI60, Radeon VII |
| **CDNA 1** | `gfx908` | MI100 |
| **CDNA 2** | `gfx90a` | MI210, MI250, MI250X |
| **CDNA 3** | `gfx942` | MI300A, MI300X, MI325X |
| **CDNA 4** | `gfx950` | MI350X, MI355X, MI350P |
| RDNA 1 | `gfx1010` | RX 5700 XT |
| RDNA 2 | `gfx1030` | RX 6900 XT, PRO W6800, V620 |
| RDNA 3 | `gfx1100`–`gfx1102` | RX 7900 XTX/XT, PRO W7900 |
| RDNA 3.5 | `gfx1150`, `gfx1151` | Ryzen AI / Strix APUs |
| RDNA 4 | `gfx1200`, `gfx1201` | RX 9070/9070 XT, AI PRO R9700 |

Sources: [ROCm GPU architecture
specs](https://rocm.docs.amd.com/en/docs-7.2.3/reference/gpu-arch-specs.html),
[ROCm 10.0 compatibility matrix](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html).

**[FLAGGED]** One automated read of AMD's compatibility matrix returned a garbled
architecture↔gfx mapping (labelling `gfx1100` as RDNA 2 and `gfx1200` as RDNA 3). The
table above uses the ROCm *hardware specifications* page, which is the authoritative
one. If you see `gfx1100 = RDNA2` anywhere, it is wrong: `gfx1100` is the RX 7900 XTX,
RDNA 3.

---

## 1.2 The parts

### Instinct (datacenter, CDNA)

| Part | Arch | gfx | CUs | Matrix cores | Memory | Bandwidth | LDS/CU |
|---|---|---|---|---|---|---|---|
| MI100 | CDNA 1 | gfx908 | 120 | 480 | 32 GB HBM2 | 1.2 TB/s | 64 KiB |
| MI210 | CDNA 2 | gfx90a | 104 | 416 | 64 GB HBM2e | 1.6 TB/s | 64 KiB |
| MI250 | CDNA 2 | gfx90a | 208 (2 GCD) | 832 | 128 GB HBM2e | 3.2 TB/s | 64 KiB |
| MI250X | CDNA 2 | gfx90a | 220 (2 GCD) | 880 | 128 GB HBM2e | 3.28 TB/s | 64 KiB |
| MI300A | CDNA 3 | gfx942 | 228 | 912 | 128 GB HBM3 (+24 Zen4 cores) | 5.3 TB/s | 64 KiB |
| MI300X | CDNA 3 | gfx942 | 304 | 1216 | 192 GB HBM3 | 5.3 TB/s | 64 KiB |
| MI325X | CDNA 3 | gfx942 | 304 | 1216 | 256 GB HBM3E | 6 TB/s | 64 KiB |
| MI350X | CDNA 4 | gfx950 | 256 | 1024 | 288 GB HBM3E | 8 TB/s | **160 KiB** |
| MI355X | CDNA 4 | gfx950 | 256 | 1024 | 288 GB HBM3E | 8 TB/s | **160 KiB** |

Sources: [ROCm hardware
specs](https://rocm.docs.amd.com/en/docs-7.2.3/reference/gpu-arch-specs.html),
[AMD MI350 series](https://www.amd.com/en/products/accelerators/instinct/mi350.html),
[AMD CDNA 2 whitepaper](https://www.amd.com/content/dam/amd/en/documents/instinct-business-docs/white-papers/amd-cdna2-white-paper.pdf),
[TechPowerUp on MI325X](https://www.techpowerup.com/327553/amd-launches-instinct-mi325x-accelerator-for-ai-workloads-256-gb-hbm3e-memory-and-2-6-petaflops-fp8-compute).

Two structural facts worth teaching:

1. **MI250/MI250X are two GPUs in a package.** Each has two Graphics Compute Dies
   (110 CUs each on the MI250X). They present as **two separate HIP devices** by
   default. A "128 GB" MI250X is two 64 GB devices with a fabric between them — your
   model must be sharded, or you set `HSA_XNACK`/use unified memory and eat the
   traffic. MI300X, by contrast, presents 192 GB as **one** device across 8 XCDs. This
   is the single most common source of "why is my MI250X half as fast as advertised."
2. **CDNA 4 has fewer CUs than CDNA 3** (256 vs 304) and makes it up on clock (2.4 GHz
   vs 2.1 GHz) and per-CU matrix throughput. [Chips and
   Cheese](https://old.chipsandcheese.com/2025/06/17/amds-cdna-4-architecture-announcement/)
   notes AMD "slightly cuts down CU count per XCD, and disables more CUs to maintain
   yields."

### The FLOPS numbers — read the fine print

MI355X peak throughput ([Glenn Lockwood's spec
sheet](https://glennklockwood.com/garden/processors/MI355X), which separates dense from
sparse — most vendor and press tables do not):

| Precision | Dense TFLOPS | With 2:4 structured sparsity |
|---|---|---|
| FP64 | 78.6 | 78.6 |
| FP32 | 157.3 | 157.3 |
| FP16 / BF16 | 2,516.6 | 5,033.2 |
| FP8 | 5,033.2 | 10,066.4 |
| FP6 | 10,066.3 | 20,132.6 |
| FP4 | 10,066.3 | 20,132.6 |

**Three things to challenge here.**

**(a) "20 PFLOPS FP4" is the sparse number.** AMD's headline figure for the MI355X is
20 PFLOPS FP4. The dense figure — the one you get on a normal, unpruned model — is
**10.1 PFLOPS**. 2:4 structured sparsity requires that in every group of 4 weights,
2 are zero. Very few production models ship this way. NVIDIA does exactly the same
thing with Blackwell's headline numbers. When you see any AI FLOPS figure from any
vendor after ~2020, your first question is "dense or sparse," and your second is "at
what precision."

**(b) FP64 went *backwards*.** MI300X: **163.4 TFLOPS FP64 matrix**, 81.7 TFLOPS FP64
vector ([ROCm MI300 microarchitecture
docs](https://rocm.docs.amd.com/en/latest/reference/gpu-arch/mi300.html)). MI355X:
**78.6 TFLOPS**, full stop. That is a >2× regression in FP64 matrix throughput,
generation over generation. AMD's entire historical pitch against NVIDIA in HPC was
FP64 leadership — Frontier and El Capitan are AMD machines — and CDNA 4 traded it away
for FP4/FP6 inference throughput. This is a real strategic fact about where the money
is, and it is invisible in any chart that only plots "AI performance."

**(c) FP6 runs at the FP4 rate on CDNA 4, and this is AMD's one clean per-clock win.**
Chips and Cheese observes CDNA 4 CUs match Nvidia's B200 SMs in FP6, while "B200 SMs
have twice as much per-clock throughput as a CDNA 4 CU across a range of 16-bit and
8-bit data types." AMD closes the gap at the device level by shipping a physically
bigger, higher-clocked chip. Per-CU, they are behind; per-package, they are competitive
and they have more memory. Both statements are true and vendors will each quote one.

### Radeon (consumer, RDNA)

| Part | Arch | gfx | CUs | Shaders | Memory | ROCm status |
|---|---|---|---|---|---|---|
| RX 7900 XTX | RDNA 3 | gfx1100 | 96 | 6,144 | 24 GB GDDR6 | Officially supported |
| RX 7900 XT | RDNA 3 | gfx1100 | 84 | 5,376 | 20 GB GDDR6 | Officially supported |
| RX 9070 XT | RDNA 4 | gfx1201 | 64 | 4,096 | 16 GB GDDR6 | Supported from ROCm 7.1 |
| RX 9070 | RDNA 4 | gfx1201 | 56 | 3,584 | 16 GB GDDR6 | Supported from ROCm 7.1 |
| AI PRO R9700 | RDNA 4 | gfx1201 | 64 | 4,096 | 32 GB GDDR6 | Supported |

The RX 9070 XT has **fewer CUs than the RX 7900 XTX (64 vs 96) but more AI accelerators
(128 vs 96)** ([Tom's
Hardware](https://www.tomshardware.com/pc-components/gpus/amd-radeon-rx-9070-xt-review),
[Digital Trends](https://www.digitaltrends.com/computing/7900xtx-vs-9070-xt/)) — RDNA 4
doubled the matrix units per CU. For a learner buying a card to experiment on: the
**Radeon AI PRO R9700 (32 GB)** is the interesting one, because on consumer AMD cards
VRAM, not FLOPS, is what stops you.

---

## 1.3 The programming model: ROCm, HIP, hipcc

**ROCm** is the whole stack: kernel driver (`amdgpu`), the ROCr runtime and HSA layer,
the LLVM-based compiler, and the libraries. It is the analogue of "the CUDA Toolkit
plus the NVIDIA driver."

**HIP** (Heterogeneous-compute Interface for Portability) is the language and runtime
API. Its design goal is unusual and worth stating plainly: **HIP is deliberately a
near-clone of CUDA**, function for function, with `cuda`→`hip` search-and-replace as the
intended porting path. `cudaMalloc`→`hipMalloc`, `cudaMemcpyAsync`→`hipMemcpyAsync`,
`<<<grid, block, shmem, stream>>>` launch syntax retained verbatim.

`hipcc` compiles the *same* HIP source for either vendor: on an AMD machine it drives
`amdclang++` producing AMDGCN code objects; on an NVIDIA machine it is a thin wrapper
over `nvcc`. So HIP is genuinely portable in the direction that matters commercially —
you can develop on the NVIDIA box you already have.

### The library mirror

ROCm ships each math library **twice**, and this trips people up:

- **`roc*`** (`rocBLAS`, `rocFFT`, `rocSPARSE`, `rocSOLVER`) — the actual AMD
  implementation, AMD-native API.
- **`hip*`** (`hipBLAS`, `hipFFT`, `hipSPARSE`) — a thin *portability shim* with a
  CUDA-shaped API that dispatches to either `roc*` on AMD or cuBLAS/cuFFT on NVIDIA.

Use `hip*` if you need one binary to target both. Use `roc*` if you're AMD-only and want
the direct path. And note the trap SemiAnalysis found: there are **two GEMM backends**,
`rocBLAS` (older, general) and `hipBLASLt` (newer, tuned, the cuBLASLt analogue), and
for a long stretch PyTorch's `torch.matmul` routed to the fast one while `F.linear`
routed to the slow one ([SemiAnalysis MI300X vs H100 vs H200
training](https://semianalysis.com/2024/12/22/mi300x-vs-h100-vs-h200-benchmark-part-1-training/)).
Silent 2× losses that live in library dispatch, not in your kernel, are the
characteristic ROCm failure mode.

### What `hipify` does

Two tools ([ROCm porting
guide](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_porting_guide.html),
[GPUOpen hipify lab
notes](https://gpuopen.com/learn/amd-lab-notes/amd-lab-notes-hipify-readme/)):

- **`hipify-perl`** — regex substitution. No CUDA install needed, works on
  syntactically broken code, misses anything contextual.
- **`hipify-clang`** — parses with Clang into an AST and regenerates. Needs a working
  CUDA install and code that actually compiles. More accurate.

Useful flags: `--examine` (dry-run report), `--inplace` (rewrites, leaving `.prehip`
backups). `hipexamine-perl.sh` walks a tree and reports conversion counts and warnings
before you commit.

### Where `hipify` fails — the honest list

This is the part every tutorial skips.

1. **Inline PTX.** `asm volatile("..." )` blocks containing PTX are not translated at
   all. You must hand-write AMDGCN inline assembly or find a portable intrinsic. Any
   library with hand-tuned PTX (which is most fast ones) needs manual work.
2. **The warp-size-32 assumption.** This is the big one, and hipify cannot detect it,
   because it is semantic, not syntactic. Code that writes `for (int s = 16; s > 0; s >>= 1)`
   for an intra-warp reduction, or `if (tid % 32 == 0)`, or sizes a shared-memory
   scratch array as `blockDim.x / 32` — all of that compiles cleanly and produces
   **wrong or half-speed results** on a wave64 machine. AMD's own porting material warns
   that "wave-aware code that assumes waveSize 32 will run on wave-64 machines but
   utilize only half of the machine resources"
   ([ORNL/AMD porting deck](https://www.olcf.ornl.gov/wp-content/uploads/Porting-Applications-to-HIP.pdf)).
3. **Mask width in the `_sync` shuffle family.** CUDA's `__shfl_down_sync(mask, ...)`
   takes a **32-bit** mask. On a 64-wide wavefront you need 64 bits. HIP's shuffles
   historically dropped the mask argument entirely; the sync-variants that do exist need
   the mask widened. The porting guide's specific gotcha: on GCN/CDNA, **shifting a
   32-bit integer by more than 31 clears the register**, so `1 << lane` silently
   produces zero for lanes 32–63. AMD's recommended fix is an architecture-conditional
   typedef:

   ```c
   #if defined(__GFX8__) || defined(__GFX9__)
   typedef uint64_t lane_mask_t;   // wave64
   #else
   typedef uint32_t lane_mask_t;   // wave32
   #endif
   ```
   …and using `1ull` rather than `1`.
4. **`__launch_bounds__` means something different.** CUDA's second parameter is
   `MIN_BLOCKS_PER_MULTIPROCESSOR`. HIP's is `MIN_WARPS_PER_EXECUTION_UNIT`. Hipify
   copies the number across unchanged and it is now wrong. The documented conversion:
   `MIN_WARPS_PER_EU = (MIN_BLOCKS * MAX_THREADS) / (warpSize * 2)` in CU mode, or
   `/ (warpSize * 4)` in WGP mode.
5. **No `--maxregcount`.** `amdclang++` does not have it. Register-pressure control has
   to go through `__launch_bounds__`.
6. **Nested headers and macros.** `cuda_runtime.h`→`hip_runtime.h` works; a project's
   own `my_cuda_helpers.h` full of `#define`d CUDA calls generally does not.
7. **Genuinely absent features.** Notably **dynamic parallelism** (launching kernels
   from device code) is not supported, and **texture object support is limited**
   ([HIP docs](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html)).
   Cooperative Groups *is* now supported with scan functions reaching CUDA parity as of
   ROCm 10.0, and HIP Graphs exist and mirror CUDA Graphs
   ([ROCm changelog](https://rocm.docs.amd.com/en/latest/release/changelog.html)).

**The practical rule of thumb:** hipify gets you 85–95% of the *lines*, and roughly 0%
of the *performance tuning*. A ported kernel compiles and produces correct output far
more often than it runs fast.

---

## 1.4 THE TERMINOLOGY MAP

The most useful single artefact in this chapter. Note the column headers carefully:
some rows are pure renames, some are renames that hide a real behavioural difference.
The **Δ** column flags the latter.

### Execution model

| CUDA | AMD / HIP | Δ | Note |
|---|---|---|---|
| thread | work-item / lane | | Pure rename |
| **warp** (32 lanes) | **wavefront** (64 on CDNA; 32 or 64 on RDNA) | **YES** | *The* difference. §1.5. |
| `warpSize` (always 32) | `warpSize` (64 or 32 — **query it**) | **YES** | On AMD it is *not* a compile-time constant you may assume |
| thread block | workgroup | | Rename; both cap at 1024 threads |
| grid | grid / NDRange | | Rename |
| **SM** (Streaming Multiprocessor) | **CU** (Compute Unit) — RDNA also groups 2 CUs into a **WGP** (Workgroup Processor) | partial | Not 1:1 comparable in width or scheduling |
| SM sub-partition (4/SM) | SIMD unit (4/CU on CDNA, 2/CU on RDNA) | | |
| CUDA core | **stream processor** / SIMD lane / shader unit | | Both are marketing counts for "FP32 lanes" |
| **Tensor Core** | **Matrix Core** (CDNA) / **AI Accelerator** (RDNA 3/4) | **YES** | Different instruction shapes and fragment layouts. §1.5 |
| occupancy | occupancy | | Same concept, different limiters (AGPRs on CDNA) |
| `blockIdx` / `threadIdx` / `blockDim` | identical, verbatim | | HIP keeps CUDA's names |
| independent thread scheduling (Volta+) | **not present** — hardware lockstep wavefronts | **YES** | §1.5 |

### Memory

| CUDA | AMD / HIP | Δ | Note |
|---|---|---|---|
| **shared memory** (`__shared__`) | **LDS** — Local Data Share (`__shared__` in HIP) | **YES** | 64 KiB/CU on CDNA1–3, **160 KiB/CU on CDNA 4**; bank structure differs |
| registers | **VGPRs** (vector) + **SGPRs** (scalar) + **AGPRs** (accumulation, CDNA) | **YES** | AMD exposes a *scalar* register file NVIDIA does not have |
| local memory (spills) | scratch | | |
| global memory | global memory | | |
| constant memory | constant memory (SGPR-backed uniform loads) | partial | AMD's scalar unit makes uniform loads structurally cheaper |
| L1 / L2 | L1 (vector) / L2 per XCD / **Infinity Cache (MALL)** | partial | CDNA 3+ adds a large last-level cache tier |
| `__syncthreads()` | `__syncthreads()` — **same spelling** | | Workgroup barrier, identical semantics |
| `__syncwarp()` | `__syncwarp()` exists but is a **no-op** | **YES** | AMD wavefronts are hardware-lockstep; nothing to sync |
| `__threadfence()` | `__threadfence()` | | |
| unified/managed memory | HMM / XNACK (`HSA_XNACK=1`), `hipMallocManaged` | partial | Maturity and perf differ substantially |

### Toolchain

| CUDA | AMD / ROCm |
|---|---|
| `nvcc` | **`hipcc`** (driver) → `amdclang++` (real compiler) |
| **PTX** (portable virtual ISA) | ***no equivalent*** — see note below |
| **SASS** (machine ISA, undocumented) | **AMDGCN ISA** — *publicly documented*, per-generation ISA guides |
| `cuobjdump` / `nvdisasm` | `llvm-objdump`, `roc-obj-ls`, `roc-obj-extract` |
| fatbinary / cubin | code object (`.hsaco`), `--offload-arch=gfx942` |
| `-arch=sm_90` | `--offload-arch=gfx942` |
| `nvidia-smi` | **`rocm-smi`** |
| **Nsight Systems** (timeline) | **`rocprof-sys`** (was **Omnitrace**) |
| **Nsight Compute** (kernel counters) | **`rocprof-compute`** (was **Omniperf**) |
| `nvprof` (legacy CLI) | **`rocprofv3`** (replaces `rocprof`, `rocprofv2`) |
| CUPTI | **rocprofiler-SDK** (replaces rocprofiler + roctracer) |
| `compute-sanitizer` | no direct equivalent; ASAN-for-GPU via `-fsanitize=address` |
| CUDA-GDB | ROCgdb |

Profiler naming per [ROCm profiling
docs](https://rocm.docs.amd.com/projects/rocprofiler-sdk/en/latest/how-to/using-rocprofv3.html)
and [GPUOpen profiler lab
notes](https://gpuopen.com/learn/amd-lab-notes/amd-lab-notes-profilers-readme/). AMD
renamed everything in the ROCm 6.2–6.3 window; older tutorials say Omnitrace/Omniperf,
current ROCm says rocprof-sys/rocprof-compute, and `rocprof`/`rocprofv2`/`roctracer` are
in maintenance-only mode from ROCm 6.4.

> **On PTX having no AMD equivalent.** This is a genuine architectural difference in the
> *toolchains*, not a naming one. NVIDIA has two levels: PTX, a stable virtual ISA that
> is forward-compatible and JIT-compiled by the driver, and SASS, the undocumented real
> machine code. AMD compiles LLVM IR straight to AMDGCN machine code, and ships
> per-generation code objects. Consequences: (1) an AMD binary built for `gfx90a` will
> **not** run on `gfx942` — no PTX-style JIT forward compatibility, which is why ROCm
> builds carry long `--offload-arch` lists; (2) conversely, AMD **publishes** its machine
> ISA, so you can read and hand-write the real instructions, which you cannot do with
> SASS. Researchers building bit-accurate models of NVIDIA's `HMMA`/`DMMA` instructions
> have to reverse-engineer them; AMD's `V_MFMA_*` are documented
> ([MMA-Sim, arXiv 2511.10909](https://www.arxiv.org/pdf/2511.10909)).

### Libraries

| CUDA | AMD (portable shim) | AMD (native) |
|---|---|---|
| cuBLAS | hipBLAS | **rocBLAS** |
| cuBLASLt | hipBLASLt | hipBLASLt |
| cuDNN | — | **MIOpen** |
| cuFFT | hipFFT | **rocFFT** |
| cuSPARSE | hipSPARSE | **rocSPARSE** |
| cuSOLVER | hipSOLVER | **rocSOLVER** |
| cuRAND | hipRAND | **rocRAND** |
| Thrust | — | **rocThrust** |
| CUB | hipCUB | **rocPRIM** |
| NCCL | — | **RCCL** |
| CUTLASS | — | **Composable Kernel (CK)** |
| NVSHMEM | — | ROC_SHMEM |
| NVLink / NVSwitch | — | **Infinity Fabric** / Infinity Fabric switches |
| MPS | — | (no direct equivalent) |
| MIG (partitioning) | — | **SPX/DPX/CPX + NPS** compute & memory partitioning modes |

---

## 1.5 The differences that actually change your kernel

Names are the easy part. These five things change the code.

### (1) Wavefront 64 vs warp 32

**What the hardware does.** A CDNA CU has 4 SIMD units, each **16 lanes wide**. A
64-lane wavefront is issued to one SIMD16 and executes over **4 clock cycles**. Contrast
RDNA: 2 SIMD32 units per CU, a 32-lane wave issues in **one** cycle. NVIDIA's SM has 4
sub-partitions each 32 lanes wide, one warp per cycle. So CDNA's 64-wide wave is not
"64 things at once," it is "16 things at once, four times, without re-fetching."
([HIP hardware implementation
docs](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/hardware_implementation.html))

**What it does to reductions.** Your intra-warp shuffle reduction ends at stride 1 after
`log2(32) = 5` steps on NVIDIA and `log2(64) = 6` on CDNA. Every hardcoded `16, 8, 4, 2, 1`
loop is silently one step short:

```c
// CUDA — correct on NVIDIA, WRONG (drops half the data) on wave64
for (int s = 16; s > 0; s >>= 1) v += __shfl_down_sync(0xffffffff, v, s);

// Portable HIP
for (int s = warpSize / 2; s > 0; s >>= 1) v += __shfl_down(v, s);
```

Note the mask too: `0xffffffff` describes 32 lanes. On wave64 you need
`0xffffffffffffffffull`.

The second-order effect is on the **two-stage block reduction pattern**. The classic
CUDA shape is "reduce within each warp, write one partial per warp to shared memory,
then have warp 0 reduce the partials." With a 1024-thread block that is 32 partials on
NVIDIA (exactly one warp — the pattern closes perfectly) and **16 partials on CDNA**.
Sixteen is half a wavefront, so the final reduction wastes half a wave, and any code
that sized the scratch array as `[32]` is now over-allocated and any code that assumed
`numWarps == warpSize` is now broken. Neither is a compile error.

**What it does to divergence.** Divergence granularity doubles. A branch taken by one
lane masks off up to **63** idle lanes on CDNA versus 31 on NVIDIA. For a kernel whose
control flow depends on data — sparse formats, ray traversal, variable-length sequences,
`if (x > threshold)` — the worst-case waste is 2× larger. This is precisely why AMD
built RDNA with wave32 for games; it is also why a divergent kernel that was "fine" on
NVIDIA can be the thing that tanks your MI300X port.

**What it does to occupancy and small blocks.** Block size must be a multiple of 64 to
avoid wasting lanes. A 32-thread block — perfectly natural in CUDA — occupies a full
64-lane wavefront on CDNA at 50% lane utilisation. Sizes like 96, 160, 224 are fine on
NVIDIA and lossy on AMD. **Rule: on CDNA, make block sizes multiples of 64. 256 is a
good default (4 wavefronts).**

**And on RDNA it depends.** RDNA can run wave32 *or* wave64; the compiler picks, and
you can hint it (`-mwavefrontsize64`, or `__attribute__((amdgpu_waves_per_eu))` for
occupancy). RDNA 4 makes this sharper: the `exec` mask register is **32-bit**, and
legacy code that treats `exec` as 64-bit breaks
([StreamHPC RDNA/CDNA comparison](https://streamhpc.com/blog/2026-06-24/rdna-and-cdna-similarities-and-differences/)).
So `warpSize` is genuinely a runtime property on AMD, and code that branches on it
is code that has to be tested on both.

### (2) Lockstep execution — AMD has no independent thread scheduling

Since Volta (SM 7.0), NVIDIA threads each have their **own program counter and call
stack**. Threads in a warp may diverge and reconverge at any instruction, and the
hardware may interleave paths. This is why `__syncwarp()` exists and why the `_sync`
suffix was bolted onto every warp intrinsic in CUDA 9
([Volta tuning guide](https://docs.nvidia.com/cuda/pdf/Volta_Tuning_Guide.pdf)).

AMD wavefronts execute in **hardware lockstep** — one PC, one `exec` mask, guaranteed.
`__syncwarp()` in HIP compiles to nothing
([Modular's GPU warp docs](https://docs.modular.com/mojo/manual/gpu/block-and-warp)).

This cuts both ways, and the direction that bites is counter-intuitive:

- **Porting CUDA → HIP is safe.** Extra syncs are free no-ops.
- **Porting HIP → CUDA, or writing "it works on my MI300X" code, is dangerous.** The
  implicit-lockstep idiom — writing to shared memory from lane A and reading it from
  lane B with no barrier, because "they're in the same wave so they're in step" — is
  *correct on AMD* and *a race on Volta+*. Pre-Volta CUDA code full of this pattern is
  exactly why NVIDIA introduced `__syncwarp()`. AMD hardware will happily let you write
  new code with the same bug.

Teach it as: **AMD's model is the older, simpler one. That makes it more forgiving to
port *to* and less forgiving to port *from*.**

### (3) LDS bank structure

CUDA shared memory: **32 banks × 4 bytes**, and 32 banks exactly matches the 32-lane
warp. A conflict-free access is one where all 32 lanes hit distinct banks; the mental
model is clean because the numbers line up.

AMD LDS: **32 banks × 4 bytes** on CDNA
([Composable Kernel LDS bank conflict
docs](https://rocm.docs.amd.com/projects/composable_kernel/en/latest/conceptual/ck_tile/hardware/lds_bank_conflicts.html)),
bank index `(address / 4) % 32`. But the wavefront is **64 lanes**. The numbers do not
line up, and that is the whole story:

- A 64-lane LDS access **cannot** complete in one bank-conflict-free pass, because there
  are only 32 banks. The hardware splits it into phases (documented as 2 phases of 32
  lanes for `ds_read_b32`, and up to **8 phases** for `ds_read_b128`, where each phase
  covers 8 lanes × 16 bytes = 32 dwords).
- Therefore "conflict-free" on AMD means **conflict-free within each phase**, not across
  the whole wave. The padding trick you learned in CUDA (`__shared__ float tile[32][33]`)
  still works and is still the right instinct, but the arithmetic you do to derive the
  pad is against a 32-bank/phase structure serving 64 lanes.
- Newer CDNA/RDNA parts move to **64 banks** and 512 bytes/clock. **[CONFLICTING
  SOURCES]** The HIP hardware-implementation page's bank-count table and the ROCm
  hardware-spec page's LDS capacity figures did not cleanly reconcile in my reading;
  the capacities (64 KiB/CU CDNA1–3, 160 KiB/CU CDNA 4) are solid and cross-confirmed,
  the per-generation *bank counts* are the part I would verify against the specific ISA
  guide for your target before teaching a number.

The concrete CDNA 4 changes that matter for a GEMM kernel
([Chips and Cheese](https://old.chipsandcheese.com/2025/06/17/amds-cdna-4-architecture-announcement/)):
LDS grew 64 KB → **160 KB** per CU (bigger tiles, deeper pipelining),
`GLOBAL_LOAD_LDS` (the async global→LDS copy, AMD's answer to `cp.async`) went from
32-bit to **128-bit per lane**, and there are new **LDS read-with-transpose**
instructions — which exist specifically because feeding matrix cores requires
transposed fragment layouts and doing that in VGPRs was costing real throughput.

### (4) Matrix cores vs tensor cores

**The fundamental structural difference:** MFMA instructions operate **per-wavefront on
64 lanes**; NVIDIA's `mma`/`wmma` operate **per-warp on 32 lanes**. Every fragment
layout, every "which lane holds which matrix element" mapping, differs. There is no
mechanical translation of a CUTLASS-style fragment layout to CK.

**Instruction shapes.** CDNA MFMA shapes are `M×N×K` with a *blocks* parameter, and are
exposed as compiler builtins
([GPUOpen matrix cores lab notes](https://gpuopen.com/learn/amd-lab-notes/amd-lab-notes-matrix-cores-readme/)):

```c
d = __builtin_amdgcn_mfma_<CDfmt>_<M>x<N>x<K><ABfmt>(a, b, c, cbsz, abid, blgp);
```

Representative CDNA 2 shapes, with per-CU throughput:

| A/B type | C/D type | Shapes | FLOPs/cycle/CU |
|---|---|---|---|
| FP32 | FP32 | 16×16×4, 32×32×2, 4×4×1 | 256 |
| FP16 | FP32 | 16×16×16, 32×32×8, 4×4×4 | 1024 |
| BF16 | FP32 | 16×16×8/16, 32×32×4/8 | 1024 |
| INT8 | INT32 | 16×16×16, 32×32×8 | 1024 |
| FP64 | FP64 | 16×16×4, 4×4×4 | 256 |

Against NVIDIA's `mma.sync` shapes on Ampere/Hopper — `m16n8k16` (FP16),
`m16n8k32` (INT8/FP8), `m8n8k4` (FP64). Note **N=8** on NVIDIA versus AMD's N=16 or
N=32. Different tile granularity means different optimal blocking, different register
pressure, and different tail behaviour on non-multiple sizes.

A worked example of what "per-wavefront" means concretely, from AMD's docs — the
16×16×4 FP32 case, launched as `dim3 block(16, 4, 1)` = one 64-lane wavefront:

```c
float4 dmn = {0};
float amk = A[threadIdx.y + 4 * threadIdx.x];   // lane holds one A element
float bkn = B[threadIdx.x + 16 * threadIdx.y];  // and one B element
dmn = __builtin_amdgcn_mfma_f32_16x16x4f32(amk, bkn, dmn, 0, 0, 0);
for (int i = 0; i < 4; ++i)                      // each lane holds 4 D elements
    D[threadIdx.x + i * 16 + threadIdx.y * 64] = dmn[i];
```

The `cbsz`, `abid`, `blgp` modifiers at the end are lane broadcast/swizzle controls with
no NVIDIA analogue — they let one MFMA reuse operands across blocks without extra LDS
traffic.

**AGPRs.** CDNA adds a *third* register file: Accumulation VGPRs, up to 256 KB per CU,
dedicated to matrix accumulators. NVIDIA has no equivalent — tensor core accumulators
live in the normal register file. AMD's design "massively expanded the register file"
rather than adding a tensor scratchpad the way Hopper's TMA/tensor-memory approach does.
Practical consequence: on CDNA, matrix accumulators do not compete with your vector
registers for occupancy the way they do on NVIDIA, but moving data VGPR↔AGPR takes
explicit instructions (`v_accvgpr_read`/`write`) and shows up in your instruction mix.

**RDNA is different again.** RDNA 3/4 have **WMMA**, not MFMA — a different intrinsic
family with different shapes. Matrix code written for CDNA does not run on Radeon and
vice versa. (NVIDIA's `wmma` API, confusingly, is a *different thing* with a similar
name — a C++ fragment API over `mma`.)

### (5) The scalar unit — AMD has a register file NVIDIA does not

Each AMD CU has a **scalar ALU** with its own **SGPR** file (~12.5 KB/CU) that executes
one instruction for the whole wavefront when a value is uniform across lanes: loop
counters, base pointers, block indices, branch conditions. NVIDIA has uniform datapath
features on recent architectures but nothing exposed as a first-class programmer-visible
register class.

Why you care: when you read AMDGCN assembly (which you can, because it is documented),
`s_*` instructions are the scalar unit, `v_*` are vector. Seeing your loop bounds and
address arithmetic in `s_` registers means the compiler correctly proved they were
uniform — that is free work. Seeing them in `v_` registers means it did not, and you are
burning VGPRs (and therefore occupancy) on 64 copies of the same number. This is a
tuning lever with no CUDA counterpart.

### Quick-reference: things to change when porting a kernel

| Symptom in CUDA source | What to do for CDNA |
|---|---|
| `for (s = 16; s > 0; s >>= 1)` shuffle reduction | `s = warpSize/2` |
| `0xffffffff` shuffle mask | `0xffffffffffffffffull` / `lane_mask_t` typedef |
| `1 << lane` for lane masks | `1ull << lane` (32-bit shift by ≥32 clears the register) |
| `__shared__ T partials[32]` for per-warp partials | size by `blockDim.x / warpSize` |
| block size 32, 96, 160 | round to multiple of 64; default 256 |
| `if (tid % 32 == 0)` for "one thread per warp" | `tid % warpSize == 0` |
| implicit intra-warp lockstep, no `__syncwarp()` | fine on AMD; **add the syncs anyway** so it stays correct on NVIDIA |
| `__launch_bounds__(256, 4)` | recompute second arg as MIN_WARPS_PER_EU |
| inline PTX | rewrite; hipify will not touch it |
| `wmma::fragment` / CUTLASS tiles | rewrite against MFMA builtins or Composable Kernel |
| `cp.async` pipelining | `GLOBAL_LOAD_LDS` (128-bit/lane on CDNA 4, 32-bit before) |
| `--maxregcount` | doesn't exist; use `__launch_bounds__` |
| device-side kernel launch | unsupported — restructure |

---

## 1.6 The honest state of ROCm

### What genuinely works

- **Inference.** vLLM, SGLang, llama.cpp, Ollama and Hugging Face Transformers all run
  on MI300X-class hardware in production, and the 192–288 GB of HBM is a real advantage:
  models that need multiple H100s fit on fewer MI300Xs. This is AMD's strongest position
  and it is not marketing.
- **PyTorch.** Upstream, with ROCm wheels on the standard install matrix. Because HIP
  mirrors CUDA, `torch.cuda.is_available()` returns `True` on ROCm and `.cuda()` works —
  the AMD backend deliberately impersonates the CUDA one. ROCm 10.0 lists PyTorch
  2.11–2.13, JAX 0.10–0.11
  ([ROCm compatibility matrix](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html)).
- **Triton.** AMD upstreamed its backend, passes and layouts into the OpenAI Triton
  repo. A Triton kernel is frequently the *lowest-friction* way to get a custom op onto
  both vendors. See §6.
- **HPC at the top end.** Frontier and El Capitan are AMD. Large FP64 codes on ROCm are
  a solved problem with years of production hours — which makes CDNA 4's FP64 regression
  a strategically loaded decision.
- **AMDGCN ISA is public.** For a learner, being able to read the real machine ISA
  (rather than reverse-engineering SASS) is a genuine pedagogical advantage of AMD.

### What does not

The reference here is [SemiAnalysis's December 2024 MI300X vs H100/H200 training
benchmark](https://semianalysis.com/2024/12/22/mi300x-vs-h100-vs-h200-benchmark-part-1-training/),
still the most detailed public teardown. Their findings, which AMD has been actively
working against since:

- The public stack was "riddled with bugs rendering out of the box training with AMD
  impossible." Their MI300X numbers came **after months of direct AMD engineering
  support**; the H100/H200 numbers were out-of-the-box.
- **MI300X achieved <30% of theoretical FLOPS in training; NVIDIA frequently hit >40%.**
  Peak-FLOPS comparisons between the two vendors are therefore close to meaningless
  without an achieved-utilisation number attached.
- The `rocBLAS` vs `hipBLASLt` dispatch split described in §1.3.
- Multi-node scale-out: RoCEv2 all-reduce performance well behind InfiniBand H100.
  Training is a *networking* problem at scale, and AMD's networking story was the weaker
  half.
- Many ROCm libraries are structurally *forks* of NVIDIA libraries, which means they
  inherit CUDA-shaped assumptions and lag upstream.

**[TIME-SENSITIVE]** That benchmark is from late 2024. ROCm 7.x and now 10.0 have
shipped since, AMD has poured engineering into it, and MI355X/CDNA 4 is a different
chip. Treat the *specific numbers* as historical; treat the *shape* of the problem —
libraries lag, dispatch bugs cost silent 2×, out-of-box ≠ tuned, networking is the
scale-out bottleneck — as still directionally true. Verify current state against
current benchmarks before repeating a number.

### Hardware support: the real matrix

ROCm 10.0 officially supports ([compatibility
matrix](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html)):

- **Instinct:** MI355X/MI350X/MI350P (gfx950), MI325X/MI300X/MI300A (gfx942),
  MI250X/MI250/MI210 (gfx90a), MI100 (gfx908)
- **Radeon/PRO:** RDNA 4 (gfx1201/gfx1200), RDNA 3 (gfx1100–1102), RDNA 2 (gfx1030 for
  W6800/V620), RDNA 3.5 APUs (gfx1151 etc.)
- **OS:** Ubuntu 22.04–26.04, RHEL 8.10–10.2, Debian 12–13, SLES, Rocky, Oracle Linux
- **Windows:** **Radeon AI PRO and Ryzen APUs only** — no Instinct, no consumer Radeon
- **WSL2:** select configurations only

The honest framing for a learner:

1. **The support list is short and it moves.** NVIDIA's CUDA runs on essentially every
   GeForce card sold in a decade. ROCm supports a curated list, drops parts (`gfx906`,
   Vega, has aged out of official support), and adds new ones late — RDNA 4 launched in
   early 2025 and did not get official ROCm support until **ROCm 7.1**. If your card
   isn't listed, you are in `HSA_OVERRIDE_GFX_VERSION` territory: it often works,
   nothing is guaranteed, and nobody will help you.
2. **Linux or nothing, effectively.** For anything Instinct or general compute, ROCm is
   a Linux stack. The Windows story is narrow and new.
3. **Consumer ≠ datacenter.** An RX 7900 XTX is a legitimate ROCm development box, but
   it is RDNA — wave32-capable, WMMA not MFMA. Kernels tuned there are not tuned for
   MI300X. This is the fork from §1.1 charging you rent.

---

# Part 2: Intel

**The status, stated plainly: Intel currently has no competitive high-end datacenter
GPU, and the software is more interesting than the hardware.**

**Ponte Vecchio / Xe-HPC (Max 1550)** — a 47-tile, 100B+ transistor monster that shipped
in Aurora at Argonne and then went essentially nowhere commercially. Intel stopped
promoting it.

**Falcon Shores** — the intended successor merging Gaudi's matrix/Ethernet with Xe GPU
engines. **Cancelled as a commercial product in January 2025**; Intel kept it as an
internal test chip and redirected to **Jaguar Shores** at rack scale
([Tom's
Hardware](https://www.tomshardware.com/tech-industry/artificial-intelligence/intel-cancels-falcon-shores-gpu-for-ai-workloads-jaguar-shores-to-be-successor),
[Phoronix](https://www.phoronix.com/news/Intel-Falcon-Shores-No-Release)). The
announcement came in the first earnings call after Gelsinger's departure. This left
Gaudi 3 as Intel's only datacenter AI product for a multi-year window.

**Gaudi 3** (from the Habana acquisition — not a GPU, a dedicated AI ASIC):
128 GB HBM2e, 3.7 TB/s, 1,835 TFLOPS FP8, 900W, 5nm; 4 MMEs (matrix engines) + 32 TPCs
(tensor processor cores) versus Gaudi 2's 2 and 24; and its distinguishing feature —
**24× 200 GbE ports integrated on-package**, so scale-out uses standard Ethernet rather
than InfiniBand or NVLink
([ServeTheHome](https://www.servethehome.com/intel-gaudi-3-for-ai-training-and-inference/),
[Tom's Hardware](https://www.tomshardware.com/pc-components/cpus/intel-details-guadi-3-at-vision-2024-new-ai-accelerator-sampling-to-partners-now-volume-production-in-q3)).
Sales were, by Intel's own account, disappointing. Programming is via SynapseAI /
Habana's PyTorch bridge, **not** oneAPI or SYCL — a separate stack.

**Arc / Xe2 "Battlemage"** — the consumer line, and where Intel is actually shipping.
The **Arc B580**: 20 Xe-cores, each with 8× 512-bit vector engines and 8× 2048-bit
**XMX** matrix engines (160 of each), 18 MB L2, 12 GB, 190W, ~$249
([TechPowerUp architecture
review](https://www.techpowerup.com/review/intel-arc-b580/2.html),
[HotHardware](https://hothardware.com/reviews/intel-arc-b580-debut-battlemage-discrete-gpus-arrive)).
XMX does 2048 FP16 ops/clock or 4096 INT8 ops/clock. 12 GB at that price makes it a
notable cheap local-LLM card, with caveats about software maturity.

**The software: oneAPI and SYCL — the actually-important part.**

- **SYCL** is a **Khronos open standard**: single-source, standard ISO C++17, no
  language extensions, no custom compiler *required*. Parallelism is expressed with
  `queue`, `buffer`/USM, and `parallel_for` with lambdas.
- **DPC++** is Intel's SYCL implementation (`icpx -fsycl`), the core of oneAPI.
- **oneAPI** is the umbrella: DPC++ plus the libraries — **oneMKL** (BLAS/FFT/etc.),
  **oneDNN** (the cuDNN analogue), **oneCCL** (NCCL analogue), **oneTBB**.
- **Level Zero** is the low-level runtime under it all — the analogue of the CUDA driver
  API, and the layer PyTorch/Ollama actually detect Arc GPUs through.
- **SYCLomatic / `dpct`** is Intel's CUDA→SYCL migration tool — the `hipify` analogue.

The strategic difference from AMD: **AMD's answer to CUDA is "a CUDA clone." Intel's is
"an open standard."** AMD's is far easier to port to. Intel's is not tied to Intel
hardware — SYCL runs on NVIDIA and AMD via Codeplay's plugins and via
**AdaptiveCpp** (formerly hipSYCL/Open SYCL), an independent implementation.

Realistic performance expectation: reasonably-written SYCL lands within **10–20% of
vendor-native code** on NVIDIA, AMD and Intel for image processing, signal processing
and structured stencils ([TechoLynx API decision
framework](https://www.technolynx.com/post/choosing-vulkan-opencl-sycl-or-cuda-for-gpu-compute)).
**[UNVERIFIED — VENDOR-ADJACENT]** That figure is from a consultancy blog, not a
peer-reviewed benchmark; treat it as an order-of-magnitude claim. It is also for
*regular* kernels. For a hand-tuned matrix-core GEMM or a fused attention kernel, the
gap is much larger, and matrix engines are reached only through **vendor-specific SYCL
extensions** — which is portability leaking.

---

# Part 3: Apple

Apple Silicon is not a competitor in the datacenter. It matters here for two reasons: it
is what an enormous fraction of ML practitioners have on their desk, and it is
architecturally the most *different* thing in this chapter that still calls itself a GPU.

### TBDR: the fundamental architectural difference

Every discrete GPU you know — NVIDIA, AMD, Intel — is **immediate-mode (IMR)**. It
processes draw calls in order, shading fragments as they arrive, reading and writing a
framebuffer that lives in VRAM. Overdraw costs bandwidth.

Apple GPUs (inherited from PowerVR lineage) are **Tile-Based Deferred Renderers
(TBDR)**. The screen is split into tiles. All geometry is binned per tile first. Then,
per tile, the GPU resolves visibility **before** shading, and shades only what survives,
into a small block of **on-chip tile memory** — never touching DRAM for intermediate
results
([Apple WWDC20 "Harness Apple GPUs with
Metal"](https://developer.apple.com/videos/play/wwdc2020/10602/),
[Apple vs. Oranges, arXiv 2502.05317](https://arxiv.org/pdf/2502.05317)).

**Why a compute programmer should care.** TBDR gives Apple a memory tier that has no
NVIDIA equivalent: **tile memory**, addressable from *tile shaders* — a shading stage
that exists only on TBDR hardware, with simultaneous access to tile memory, threadgroup
memory and device memory. It is not the same thing as threadgroup memory (Apple's
`__shared__`); it is a persistent per-tile on-chip scratchpad that survives across
draws. Also: `memoryless` render targets that are *allocated but never backed by DRAM*
— a concept that is incoherent on an IMR GPU. If you only know CUDA, "there is a memory
tier whose entire point is that it never has a DRAM address" is a genuinely new idea.

**Unified memory.** CPU and GPU share the same physical DRAM through the same memory
controller. There is no `cudaMemcpy` because there is nothing to copy. This is not
NVIDIA's "unified virtual addressing over PCIe with page migration" — it is one pool,
one address space, zero-copy for real. It is why a 128 GB Mac Studio can hold a model
that needs several discrete GPUs, and simultaneously why it is slow: you get capacity at
LPDDR bandwidth (hundreds of GB/s), not HBM bandwidth (multiple TB/s).

**The Neural Engine (ANE)** is a *separate* fixed-function block from the GPU, ~38 TOPS
on M4. It is reached only through **Core ML** — not Metal, not MLX, not PyTorch. You
cannot write a kernel for it. For a curriculum this is worth stating explicitly: the
ANE's TOPS number is not addressable by general GPU code, so quoting it alongside GPU
FLOPS is an apples-to-oranges comparison Apple's own marketing invites.

**M5 changes the picture.** M5 puts a **Neural Accelerator in every GPU core** — an
on-die matrix engine, the structural analogue of a tensor core, finally inside the GPU
where compute code can reach it. Apple claims **>4× peak GPU AI compute vs M4**
([Apple newsroom](https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/),
[Apple ML research on MLX + M5](https://machinelearning.apple.com/research/exploring-llms-mlx-m5)).
It is reached from MLX via Metal 4's TensorOps / Metal Performance Primitives, or
directly through Metal 4 Tensor APIs. **[UNVERIFIED]** The "4×" is an Apple-published
peak figure with no dense/sparse or precision qualifier that I could confirm; treat it
as a peak-compute claim, not a delivered speedup.

**The software.**

- **Metal / MSL** — the low-level API. Metal Shading Language is C++14-based, with
  `threadgroup` (≈ `__shared__`), `threadgroup_barrier` (≈ `__syncthreads`), and SIMD
  groups (≈ warps, **width 32**, matching NVIDIA rather than AMD).
- **MPS / MPSGraph** — Apple's optimised kernel libraries, the cuDNN analogue.
- **PyTorch MPS backend** — works, and is a CUDA-semantics adaptation bolted onto Metal.
  Notably constrained: research through late 2025 documented a **~4 GB single-tensor cap
  producing OOM past roughly 2,000 tokens**
  ([arXiv 2511.05502](https://arxiv.org/pdf/2511.05502)).
- **MLX** — Apple's from-scratch array framework, designed for unified memory rather
  than adapted to it. Two design choices worth teaching: **arrays live in shared memory
  and are usable from CPU or GPU with no `.to(device)`**, and **evaluation is lazy** —
  operations build a graph, `mx.eval()` runs it, so the runtime can fuse and schedule
  across many ops. Reported ~25–30× faster than PyTorch MPS for LLM inference on the
  same hardware. **[UNVERIFIED]** That multiple comes from a secondary source and is
  almost certainly a specific-workload figure inflated by the MPS memory-cap bug above;
  the direction (MLX > PyTorch-MPS on Apple Silicon for inference) is well-attested, the
  magnitude is not.

---

# Part 4: Google TPU

**The most important thing about a TPU is that it is not a GPU, and the ways it is not
a GPU are instructive about what a GPU actually is.**

### Systolic arrays

A GPU is thousands of independent-ish threads over a cache hierarchy, with a scheduler
hiding memory latency by swapping in other warps. A TPU's core is an **MXU: a 128×128
grid of multiply-accumulate cells wired directly to their neighbours**.

The dataflow is **weight-stationary**: weights are loaded into the cells and held there.
Activations stream in from one edge and propagate across the grid; partial sums
propagate down. Each cell does one MAC and passes its result to its neighbour. Data
moves cell-to-cell, not through a register file and not through a cache
([Telesens on weight-stationary systolic
arrays](https://telesens.co/2018/07/30/systolic-architectures/),
[atlantis-press TPU architecture](https://www.atlantis-press.com/article/126021485.pdf)).

The consequences, which are the real lesson:

- **No cache hierarchy in the compute path, and essentially no register file.** Operands
  are consumed where they land. Reported >95% reduction in DRAM bandwidth demand versus
  cache-based GPU hierarchies for the same matmul. **[UNVERIFIED]** — that specific
  figure comes from a secondary summary; the structural claim (systolic reuse replaces
  cache reuse) is solid, the percentage is not one I would quote.
- **No dynamic scheduler.** Execution is **VLIW packets emitted by the compiler**.
  Everything is statically scheduled. This is why TPU tail latency is tight — reported
  99th-percentile within ~1% of the mean.
- **Therefore the compiler is not optional.** On a GPU you can hand-write a kernel and
  the hardware will schedule it. On a TPU, **XLA** must tile, pad and reshape your
  tensors to fit the MXU's fixed dimensions. If your shapes don't divide nicely by 128,
  XLA pads and you eat the waste invisibly. "Why is my TPU at 20% MFU" is nearly always
  a shape problem, and it is a class of problem GPUs mostly don't have.
- **There is no CUDA-equivalent to learn.** You write JAX (or PyTorch/XLA, or TF), and
  XLA compiles it. **Pallas** is the escape hatch for hand-written TPU kernels — the
  closest thing to a Triton-for-TPU — but it is a block-level tile language, not SIMT.
  **None of your thread/block/warp intuition transfers.** Your *tiling, blocking and
  arithmetic-intensity* intuition transfers completely.

### Generations

| | v5p | v6e (Trillium) | v7 (Ironwood) |
|---|---|---|---|
| Peak BF16 | 459 TFLOPS | 918 TFLOPS | **2,307 TFLOPS** |
| Peak FP8 | 459 TFLOPS | 918 TFLOPS | **4,614 TFLOPS** |
| HBM | 95 GiB | 32 GiB | **192 GB** |
| HBM BW | 2,765 GB/s | 1,638 GB/s | **7,380 GB/s** |
| TensorCores/chip | 2 | 1 | 2 |
| SparseCores/chip | 4 | 2 | 4 |
| Max pod | 8,960 chips | 256 chips | **9,216 chips** |

Source: [Google Cloud TPU7x
docs](https://docs.cloud.google.com/tpu/docs/tpu7x). **[FLAGGED]** One secondary source
described Ironwood as 5nm; that is almost certainly wrong for a 2025-generation part and
I could not confirm a process node from Google — omit the node rather than guess. Also
note v5p and v6e are listed at the same number for BF16 and FP8, which is Google's own
table and implies no FP8 rate advantage on those parts, unlike v7's 2×.

Two structural things: **SparseCores** are dedicated embedding-lookup units, a
recommender-systems feature GPUs handle with generic gather; and the **pod
interconnect** (Inter-Chip Interconnect in a 3D torus, plus optical circuit switching)
is arguably more of the product than the chip — the ability to schedule a coherent
9,216-chip slice is the thing NVLink domains don't match at that scale.

---

# Part 5: The rest, briefly and accurately

### Cerebras — wafer-scale

**WSE-3**: 46,225 mm² (an entire wafer, ~57× a reticle-limited GPU die), ~4 trillion
transistors, **900,000 cores**, **44 GB on-chip SRAM**, ~21 PB/s on-chip memory
bandwidth, 125 PFLOPS FP16; the CS-3 system draws ~27 kW
([Introl WSE-3 guide](https://introl.com/blog/cerebras-wafer-scale-engine-cs3-alternative-ai-architecture-guide-2025)).

**The idea:** if the whole model lives in SRAM on one piece of silicon, you never pay
for off-chip communication, and you never partition. **The catch:** 44 GB is 44 GB.
Anything bigger requires streaming weights from an external memory service
(MemoryX/SwarmX), and the "no communication cost" argument weakens. **[NOTE]** The
125 PFLOPS FP16 figure is a peak; achieved utilisation on a wafer-scale part is
workload-dependent and not publicly comparable to GPU MFU numbers. Cerebras is
commercially real — AWS announced bringing WSE-3 into its cloud in March 2026
([SiliconANGLE](https://siliconangle.com/2026/03/13/aws-will-bring-cerebras-wafer-size-wse-3-chip-cloud-platform/)).

### Groq — the LPU, and determinism

**LPU v1 / TSP**: ~725 mm² on **GlobalFoundries 14nm**, **230 MB on-chip SRAM**,
**no HBM and no external DRAM at all**, ~750 TOPS INT8, fully deterministic VLIW
([Coding Confessions teardown](https://blog.codingconfessions.com/p/groq-lpu-design),
[SemiAnalysis on Groq
tokenomics](https://newsletter.semianalysis.com/p/groq-inference-tokenomics-speed-but)).

**[CONFLICTING SOURCES — IMPORTANT]** Several secondary sources claim the Groq LPU has
"32 GB+ HBM per chip, 5 TB/s" and "7nm." **This is wrong and it inverts the entire
architecture.** The defining property of the LPU is that it has *no* DRAM. Primary
teardowns and SemiAnalysis agree: 14nm, 230 MB SRAM, no external memory. If a source
gives Groq an HBM figure, distrust the whole source.

**Determinism is the actual product.** No caches, no branch prediction, no dynamic
arbitration, no reactive scheduling. The compiler assigns every operation to an exact
clock cycle, chip-wide and across chips. Latency is not "measured," it is *known* at
compile time. **The cost:** at 230 MB per chip, no useful model fits on one — you need
hundreds of chips to hold a large model, which is why Groq's economics are a systems
argument, not a chip argument. SemiAnalysis's critique is exactly this.

Teach it as the extreme end of a real spectrum: **GPUs hide latency dynamically with
many threads; Groq eliminates latency variance statically with a compiler.** Two
opposite answers to the same problem.

### Tenstorrent

**Blackhole**: 752 RISC-V cores, of which 700 are inside **Tensix** cores — each Tensix
bundling **5 "baby" RISC-V cores**, two NoC routers, local SRAM, and matrix + vector
engines ([The Register](https://www.theregister.com/on-prem/2024/08/27/tenstorrent-details-its-risc-v-packed-blackhole-chips/1322990)).
Cores communicate over an explicit on-chip network; you program the data movement.

Software: **TT-Metalium** (low-level, OpenCL-ish C++, direct access to the RISC-V cores,
NoC, FPU/SFPU and SRAM) and **TT-NN** (higher-level op library, Python and C++)
([Tenstorrent](https://tenstorrent.com/en/software/tt-metalium)). Fully open source,
which is the strategic pitch alongside RISC-V licensing.

For a curriculum, the interesting bit is the mental model: **not SIMT at all**. It is a
grid of small general-purpose cores with explicit message passing — closer to an MPI
program on a tiny cluster than to a CUDA grid. Ecosystem is early; treat it as
architecturally instructive rather than practically necessary.

### AWS Trainium / Inferentia

Amazon's in-house silicon: **Inferentia** for inference, **Trainium** for training.
**Trainium3**: 2.52 PFLOPS FP8, 144 GB HBM3e, 4.9 TB/s, with a claimed 30–40% better
price-performance than GPU instances on AWS
([Introl](https://introl.com/blog/ai-accelerators-beyond-gpus-tpu-trainium-gaudi-cerebras-2025)).
**[UNVERIFIED]** Those figures are from a secondary aggregator and the price-performance
claim is AWS-originated; verify against AWS's own current documentation before quoting.

Programming: the **Neuron SDK**, with PyTorch/JAX front ends via XLA, plus **NKI**
(Neuron Kernel Interface) — a Triton-like Python tile language for custom kernels.
**Available only on AWS.** You cannot buy one. That is a fine trade if you are already
on AWS and a hard stop otherwise.

---

# Part 6: The portability layer landscape

Every one of these trades portability for control. The question is always *which control
you gave up*.

### OpenCL

The original open standard (2009). Runs nearly everywhere: NVIDIA, AMD, Intel, Arm
Mali, Qualcomm Adreno, FPGAs, CPUs. Its problems are structural, not incidental:
separate host and device source (kernels as strings, compiled at runtime), C99-based
device language, and — fatally — **NVIDIA never gave it first-class support**, leaving
it stuck at OpenCL 1.2 on NVIDIA hardware for many years while the standard moved on.
It also has no path to tensor/matrix units. **Mature, broad, and rarely the right choice
for greenfield ML.** Where it still lives: embedded, mobile, FPGA, and legacy scientific
code.

### Vulkan compute

Compute shaders in a graphics API, consuming **SPIR-V**. Truly cross-vendor including
Apple (via MoltenVK), Android, and every desktop GPU. Extremely low-level — you manage
descriptor sets, memory barriers, command buffers, queue families by hand.

Reported to reach roughly **80–95% of a vendor's native compute API** for typical
bandwidth- and compute-bound kernels, with OpenCL slightly ahead on kernel execution
because its compilers are more mature than SPIR-V's
([TechnoLynx](https://www.technolynx.com/post/choosing-vulkan-opencl-sycl-or-cuda-for-gpu-compute),
[Sylkan, ACM](https://dl.acm.org/doi/fullHtml/10.1145/3456669.3456683)).
**[UNVERIFIED]** Consultancy-sourced ranges again; directionally reasonable, not a
benchmark.

The matrix-unit question has an answer now: `VK_KHR_cooperative_matrix` exposes tensor
cores / matrix cores / XMX portably. This is why **llama.cpp's Vulkan backend is
genuinely competitive** and is the pragmatic path to running LLMs on an unsupported AMD
card, an Intel iGPU, or anything else with a driver. Vulkan is winning the *consumer
inference* portability fight by default, largely because a Vulkan driver ships on
every machine and ROCm does not.

### SYCL

Khronos standard, single-source, standard ISO C++17 with no language extensions.
Implementations: **DPC++** (Intel/oneAPI), **AdaptiveCpp** (formerly hipSYCL/Open SYCL —
independent, targets CUDA/HIP/OpenMP/SPIR-V), and Codeplay's NVIDIA and AMD plugins.
This is the most credible "one source, three vendors" option for **HPC-style** C++ code,
and it is what the European exascale ecosystem has largely standardised on.

Where portability leaks: matrix engines are reachable only through **vendor-specific
extensions**, so the moment your kernel needs tensor cores you are writing
`#ifdef`-shaped code again, and you are back to per-vendor tuning even though the
language is portable. That distinction — **portable *code* vs portable *performance***
— is the single most important idea in this section.

### Triton

**The one that actually won, and the reason is worth understanding.**

Triton is a Python-embedded DSL and compiler from OpenAI
([OpenAI's introduction](https://openai.com/index/triton/)). Its key move is **raising
the abstraction level from threads to blocks**. You do not write per-thread code with
`threadIdx`. You write operations on **blocks** — small power-of-two-shaped tensors —
and the compiler decides the thread mapping, the memory coalescing, the shared-memory
allocation and staging, and the matrix-unit scheduling.

```python
@triton.jit
def add_kernel(x_ptr, y_ptr, out_ptr, n, BLOCK: tl.constexpr):
    pid = tl.program_id(0)
    offs = pid * BLOCK + tl.arange(0, BLOCK)
    mask = offs < n
    x = tl.load(x_ptr + offs, mask=mask)      # coalescing: compiler's problem
    y = tl.load(y_ptr + offs, mask=mask)
    tl.store(out_ptr + offs, x + y, mask=mask)
```

Note what is *absent*: no `threadIdx`, no `__shared__`, no `__syncthreads()`, no warp
size. **Which is exactly why Triton is portable across NVIDIA and AMD in a way HIP is
not.** Every one of §1.5's kernel-level differences — wave64 reductions, lane masks,
LDS bank phasing, MFMA vs `mma` fragment layouts — is a *thread-level* concern. Triton
does not expose thread level, so it does not expose the differences. The block-level
abstraction is not just ergonomic; it is the mechanism of the portability.

Backends: NVIDIA (→ PTX), **AMD (→ AMDGCN; AMD upstreamed its passes and layouts into
the Triton repo)**, Intel, and experimental CPU/RISC-V targets. NVIDIA has since built a
**CUDA Tile IR backend for Triton**
([NVIDIA developer blog](https://developer.nvidia.com/blog/advancing-gpu-programming-with-the-cuda-tile-ir-backend-for-openai-triton/))
— a strong signal that NVIDIA now treats Triton as a first-class front end to its own
hardware rather than a threat.

**Where Triton fits, honestly.** It is what most ML engineers writing custom kernels
actually write in 2026 — FlashAttention variants, fused MoE dispatch, quantised GEMMs,
custom norms. It is the backend `torch.compile` generates. It gets you to roughly
**80–95% of a hand-tuned CUDA kernel** for the fusion-shaped problems it is designed
for, in a small fraction of the effort, with source-level portability to AMD for free.

**Where it does not.** It does not beat cuBLAS/hipBLASLt at plain GEMM — those are
hand-tuned against instruction-level details Triton deliberately hides. It has no answer
for warp specialisation, producer-consumer pipelines, cluster-level features
(Hopper/Blackwell TMA, distributed shared memory), or anything needing explicit control
of the memory pipeline. Performance across vendors requires **re-autotuning** —
different block sizes, `num_warps`, `num_stages` per target
([GPU Performance Portability needs Autotuning, arXiv
2505.03780](https://arxiv.org/pdf/2505.03780)). The source is portable; the *tuning
configuration is not*, which is the same "portable code, non-portable performance"
result as SYCL, just at a higher and more forgiving level.

### Also worth naming

- **`torch.compile` / TorchInductor** — for most people the *real* portability layer.
  Generates Triton for GPUs, C++/OpenMP for CPUs. Most ML engineers get cross-vendor
  portability without knowing they are using Triton.
- **XLA** — the compiler behind JAX and TPU. The only route to TPU; also targets GPUs.
- **MLIR** — the compiler infrastructure most of the above are built on. Not a
  portability layer you write in, but the thing they share.
- **Mojo** — Modular's language, aiming at SIMT-portable systems programming. Real, and
  early.
- **SCALE / ZLUDA** — projects that run *unmodified CUDA* on AMD. Genuinely interesting,
  legally and practically fragile; do not build a curriculum on them.

### The trade-off summary

| Layer | Abstraction | Portable code | Portable *performance* | Reaches matrix units | Practical niche |
|---|---|---|---|---|---|
| **CUDA** | thread | NVIDIA only | n/a | Yes, fully | The default; deepest tooling |
| **HIP** | thread | AMD + NVIDIA | **No** — wave32/64 retuning | Yes (MFMA/WMMA) | Porting existing CUDA to AMD |
| **SYCL** | thread + queue | NV/AMD/Intel/CPU/FPGA | Partial (~10–20% gap on regular kernels) | Vendor extensions only | HPC C++, European exascale |
| **OpenCL** | thread | Everything | Poor | No | Embedded, FPGA, legacy |
| **Vulkan compute** | thread | Everything incl. Apple/Android | ~80–95% of native | Yes, via `cooperative_matrix` | Shipping inference to unknown hardware |
| **Triton** | **block** | NV/AMD/Intel | Needs re-autotuning; source unchanged | **Yes, compiler-managed** | **What ML people actually write** |
| **XLA** | whole graph | TPU/GPU/CPU | Compiler's problem | Yes | JAX; mandatory for TPU |
| **`torch.compile`** | whole graph | Everything PyTorch supports | Compiler's problem | Yes (via Triton) | The default for most people |

---

# Part 7: What transfers from CUDA

The single table to put in front of a CUDA learner.

| Target | Transfers ~directly | Needs relearning | Does not transfer |
|---|---|---|---|
| **AMD CDNA** (MI300X) | Entire mental model: grid/block/thread, memory hierarchy, coalescing, occupancy, tiling, streams, async copy. API names are ~1:1. Library structure is 1:1. Profiling *concepts* identical. | **Wave 64** → every reduction, mask, block size, divergence estimate. LDS 32 banks serving 64 lanes → different padding arithmetic. MFMA shapes and per-wavefront fragment layouts. `__launch_bounds__` semantics. AGPRs as a third register class. Tool names (all renamed in ROCm 6.2–6.3). | Inline PTX. Dynamic parallelism. `--maxregcount`. CUTLASS (→ Composable Kernel). Nsight-specific workflows. PTX-style forward compatibility — you must build per-`gfx`. |
| **AMD RDNA** (Radeon) | Same as CDNA, plus warp 32 is back (in wave32 mode) so reductions look like CUDA again. | Wave32 **or** 64 depending on compiler choice — must query. WMMA instead of MFMA. RDNA 4's 32-bit `exec`. WGP vs CU mode. | Same as CDNA, plus: **anything tuned on RDNA is not tuned for CDNA.** |
| **Intel Xe / Arc** | SIMT model, work-groups, sub-groups (variable width, commonly 8/16/32), local memory, coalescing intuition. | SYCL's single-source C++ idiom (queues, buffers/USM, lambdas) is a real syntactic shift. Sub-group width varies *per kernel*. XMX via vendor extensions. Level Zero instead of the CUDA driver API. | `nvcc` workflow. cuBLAS/cuDNN (→ oneMKL/oneDNN). Nsight. **Gaudi is a completely separate stack — SynapseAI, not oneAPI.** |
| **Apple Silicon** | Kernel/threadgroup/thread hierarchy. Threadgroup memory ≈ shared memory. SIMD groups are **width 32**, like NVIDIA. Barriers, coalescing, occupancy thinking. | Metal's command-buffer/encoder object model (verbose vs `<<<>>>`). MSL is C++14-based with attribute syntax. **Unified memory means deleting all your transfer code and rethinking what "device memory" means.** MLX's laziness (`mx.eval()`). M5 matrix units via Metal 4 TensorOps. | **TBDR concepts have no CUDA analogue at all** — tile memory, tile shaders, memoryless attachments. The ANE is unreachable except via Core ML. All CUDA libraries. Anything assuming discrete VRAM and a PCIe bus. |
| **Google TPU** | **Only the high-level performance reasoning**: arithmetic intensity, tiling, blocking, roofline, keeping the matmul units fed, minimising HBM traffic, sharding strategy. | Everything is expressed through JAX/XLA. Shapes must suit a 128×128 MXU or you silently eat padding. Sharding via `jax.sharding`/GSPMD instead of manual NCCL. Pallas for custom kernels — block-level, not SIMT. | **The entire SIMT model.** No threads, no blocks, no warps, no shared memory, no occupancy, no dynamic scheduling, no hand-written kernels in the CUDA sense. Debugging and profiling are completely different. |
| **Cerebras** | Dataflow and tiling intuition, loosely. | Weight-streaming execution model; the compiler owns placement across 900k cores. | Essentially all of it. You do not write kernels. |
| **Groq** | Arithmetic-intensity reasoning. | Compiler-scheduled deterministic VLIW; **no dynamic latency hiding at all** — the technique CUDA's whole occupancy model is built on. Model must be sharded across many chips because 230 MB. | The SIMT model. Occupancy. Caches. Anything involving runtime scheduling. |
| **Tenstorrent** | Explicit data-movement thinking; NoC awareness resembles multi-GPU reasoning more than intra-GPU. | Grid of RISC-V cores with explicit message passing. TT-Metalium's OpenCL-ish C++. Kernels target FPU/SFPU/NoC individually. | The SIMT model. Closer to MPI-on-a-chip than to CUDA. |
| **AWS Trainium** | Same as TPU — high-level tiling and sharding reasoning via XLA. | Neuron SDK, `torch_neuronx`, NKI (Triton-like tile language) for custom kernels. | SIMT. Also: **you cannot buy the hardware.** AWS only. |

### The compressed version

- **AMD is the only one where your CUDA knowledge transfers nearly whole.** Every name
  has a counterpart. The gap is wave64, LDS banking, MFMA layouts, and the maturity of
  the software — not the model.
- **Intel and Apple keep the SIMT model and change the language and the memory system.**
  Moderate friction, mostly syntactic, plus one genuinely new idea each (SYCL's
  single-source C++; TBDR tile memory).
- **TPU, Groq, Cerebras and Tenstorrent throw away SIMT.** What survives is the
  *performance reasoning* — arithmetic intensity, tiling, keeping matrix units fed —
  which is the more durable half of what CUDA teaches you anyway. What dies is every
  mechanism: threads, warps, shared memory, occupancy, latency hiding.
- **The one abstraction that spans NVIDIA and AMD in practice is Triton**, and it works
  precisely *because* it refuses to expose the thread level where all the differences
  live.

---

## Appendix: what I could not verify

Listed so nothing here gets taught with false confidence.

1. **CDNA LDS bank counts per generation.** Capacities are solid (64 KiB/CU CDNA 1–3,
   160 KiB/CU CDNA 4, cross-confirmed by ROCm specs and Chips and Cheese). The
   *bank counts* (32 vs 64) and per-cycle bandwidth figures did not reconcile cleanly
   between AMD's HIP hardware-implementation page and the Composable Kernel docs. Check
   the ISA guide for your specific `gfx` target before teaching a number.
2. **The MI300X 2.61 PFLOPS FP8 figure.** Consistent across sources as the *dense*
   number (5.22 PFLOPS sparse), and internally consistent with CDNA 3's 2× FP8-over-FP16
   rate. I could not load AMD's official product page directly (timeout) to read the
   footnotes verbatim.
3. **All performance-portability percentage ranges** in Part 6 (SYCL "10–20%", Vulkan
   "80–95%", Triton "80–95%"). These come from consultancy blogs and secondary
   summaries, not peer-reviewed benchmarks. Directionally useful, not citable.
4. **TPU v7 process node.** One source said 5nm; I do not believe it and could not
   confirm from Google. Omitted from the table rather than guessed.
5. **Apple M5 "over 4× peak GPU compute for AI vs M4."** Apple's own figure, no
   dense/sparse or precision qualifier. Peak, not delivered.
6. **MLX "25–30× faster than PyTorch MPS."** Secondary source, near-certainly a
   workload-specific number inflated by PyTorch MPS's documented ~4 GB tensor cap.
   Direction attested, magnitude not.
7. **Trainium3 specs and the "30–40% better price-performance" claim.** Secondary
   aggregator plus AWS marketing. Verify against AWS docs.
8. **Groq LPU specifications — actively contradicted in the wild.** Multiple sources
   claim 32 GB+ HBM at 5 TB/s and 7nm. Primary teardowns and SemiAnalysis say 14nm
   GlobalFoundries, 230 MB SRAM, **no external DRAM whatsoever**. I am confident in the
   latter, and I am flagging the former as an example of how badly secondary AI-hardware
   coverage propagates errors.
9. **Cerebras 125 PFLOPS FP16 and 21 PB/s.** Peak/aggregate figures with no public
   achieved-utilisation comparison to GPU MFU numbers.
10. **The SemiAnalysis ROCm findings are from December 2024.** ROCm 7.x and 10.0 have
    shipped since. The structural critique is likely still directionally valid; the
    specific numbers are historical. Re-verify before repeating.
11. **AMD compatibility-matrix architecture labels.** One automated read returned
    incorrect gfx↔architecture mappings. The table in §1.1 uses the ROCm *hardware
    specifications* page, which I consider authoritative. Cross-check anything that
    contradicts it.

---

## Sources

**AMD — primary**
- [HIP porting guide](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_porting_guide.html)
- [HIP hardware implementation](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/hardware_implementation.html)
- [HIP C++ language extensions](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html)
- [ROCm GPU hardware specifications](https://rocm.docs.amd.com/en/docs-7.2.3/reference/gpu-arch-specs.html)
- [ROCm 10.0 compatibility matrix](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html)
- [ROCm consolidated changelog](https://rocm.docs.amd.com/en/latest/release/changelog.html)
- [MI300 series microarchitecture](https://rocm.docs.amd.com/en/latest/reference/gpu-arch/mi300.html)
- [Composable Kernel: LDS and bank conflicts](https://rocm.docs.amd.com/projects/composable_kernel/en/latest/conceptual/ck_tile/hardware/lds_bank_conflicts.html)
- [rocprofv3 / ROCprofiler-SDK](https://rocm.docs.amd.com/projects/rocprofiler-sdk/en/latest/how-to/using-rocprofv3.html)
- [GPUOpen: AMD matrix cores](https://gpuopen.com/learn/amd-lab-notes/amd-lab-notes-matrix-cores-readme/)
- [GPUOpen: application portability with HIP](https://gpuopen.com/learn/amd-lab-notes/amd-lab-notes-hipify-readme/)
- [GPUOpen: profiling tools](https://gpuopen.com/learn/amd-lab-notes/amd-lab-notes-profilers-readme/)
- [AMD CDNA 2 whitepaper (PDF)](https://www.amd.com/content/dam/amd/en/documents/instinct-business-docs/white-papers/amd-cdna2-white-paper.pdf)
- [AMD Instinct MI350 series](https://www.amd.com/en/products/accelerators/instinct/mi350.html)
- [ORNL/AMD: Porting Applications to HIP (PDF)](https://www.olcf.ornl.gov/wp-content/uploads/Porting-Applications-to-HIP.pdf)

**AMD — analysis**
- [Chips and Cheese: CDNA 4 architecture](https://old.chipsandcheese.com/2025/06/17/amds-cdna-4-architecture-announcement/)
- [Chips and Cheese: CDNA 3](https://chipsandcheese.com/p/amds-cdna-3-compute-architecture)
- [Chips and Cheese: Testing AMD's Giant MI300X](https://chipsandcheese.com/p/testing-amds-giant-mi300x)
- [SemiAnalysis: MI300X vs H100 vs H200 training](https://semianalysis.com/2024/12/22/mi300x-vs-h100-vs-h200-benchmark-part-1-training/)
- [StreamHPC: RDNA and CDNA compared](https://streamhpc.com/blog/2026-06-24/rdna-and-cdna-similarities-and-differences/)
- [Glenn Lockwood: MI355X](https://glennklockwood.com/garden/processors/MI355X) · [MI250X](https://www.glennklockwood.com/garden/processors/mi250x)
- [MMA-Sim: bit-accurate model of tensor & matrix cores (arXiv 2511.10909)](https://www.arxiv.org/pdf/2511.10909)
- [Tom's Hardware: RX 9070 XT review](https://www.tomshardware.com/pc-components/gpus/amd-radeon-rx-9070-xt-review)
- [Tom's Hardware: UDNA unification](https://www.tomshardware.com/pc-components/cpus/amd-announces-unified-udna-gpu-architecture-bringing-rdna-and-cdna-together-to-take-on-nvidias-cuda-ecosystem)
- [TechPowerUp: MI325X launch](https://www.techpowerup.com/327553/amd-launches-instinct-mi325x-accelerator-for-ai-workloads-256-gb-hbm3e-memory-and-2-6-petaflops-fp8-compute)

**NVIDIA (for contrast)**
- [Volta tuning guide — independent thread scheduling (PDF)](https://docs.nvidia.com/cuda/pdf/Volta_Tuning_Guide.pdf)
- [CUDA Tile IR backend for OpenAI Triton](https://developer.nvidia.com/blog/advancing-gpu-programming-with-the-cuda-tile-ir-backend-for-openai-triton/)

**Intel**
- [Tom's Hardware: Falcon Shores cancelled](https://www.tomshardware.com/tech-industry/artificial-intelligence/intel-cancels-falcon-shores-gpu-for-ai-workloads-jaguar-shores-to-be-successor)
- [Phoronix: Falcon Shores not released](https://www.phoronix.com/news/Intel-Falcon-Shores-No-Release)
- [ServeTheHome: Gaudi 3](https://www.servethehome.com/intel-gaudi-3-for-ai-training-and-inference/)
- [Tom's Hardware: Gaudi 3 details](https://www.tomshardware.com/pc-components/cpus/intel-details-guadi-3-at-vision-2024-new-ai-accelerator-sampling-to-partners-now-volume-production-in-q3)
- [TechPowerUp: Arc B580 architecture](https://www.techpowerup.com/review/intel-arc-b580/2.html)
- [Intel oneAPI Level Zero backend spec](https://www.intel.com/content/www/us/en/docs/dpcpp-cpp-compiler/developer-guide-reference/2024-0/intel-oneapi-level-zero-backend-specification.html)

**Apple**
- [Apple: Harness Apple GPUs with Metal (WWDC20)](https://developer.apple.com/videos/play/wwdc2020/10602/)
- [Apple newsroom: M5](https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/)
- [Apple ML Research: LLMs with MLX and M5 neural accelerators](https://machinelearning.apple.com/research/exploring-llms-mlx-m5)
- [Apple vs. Oranges: M-series for HPC (arXiv 2502.05317)](https://arxiv.org/pdf/2502.05317)
- [Local LLM inference on Apple Silicon: MLX vs llama.cpp vs PyTorch MPS (arXiv 2511.05502)](https://arxiv.org/pdf/2511.05502)

**Google TPU**
- [Google Cloud: TPU7x (Ironwood)](https://docs.cloud.google.com/tpu/docs/tpu7x)
- [Telesens: weight-stationary systolic arrays](https://telesens.co/2018/07/30/systolic-architectures/)
- [Basic TPU architecture and optimization (Atlantis Press PDF)](https://www.atlantis-press.com/article/126021485.pdf)

**Others**
- [Introl: Cerebras WSE-3 / CS-3](https://introl.com/blog/cerebras-wafer-scale-engine-cs3-alternative-ai-architecture-guide-2025)
- [SiliconANGLE: AWS to host Cerebras WSE-3](https://siliconangle.com/2026/03/13/aws-will-bring-cerebras-wafer-size-wse-3-chip-cloud-platform/)
- [Coding Confessions: architecture of Groq's LPU](https://blog.codingconfessions.com/p/groq-lpu-design)
- [SemiAnalysis: Groq inference tokenomics](https://newsletter.semianalysis.com/p/groq-inference-tokenomics-speed-but)
- [The Register: Tenstorrent Blackhole](https://www.theregister.com/on-prem/2024/08/27/tenstorrent-details-its-risc-v-packed-blackhole-chips/1322990)
- [Tenstorrent: TT-Metalium](https://tenstorrent.com/en/software/tt-metalium)
- [Introl: AI accelerators beyond GPUs](https://introl.com/blog/ai-accelerators-beyond-gpus-tpu-trainium-gaudi-cerebras-2025)

**Portability layers**
- [OpenAI: introducing Triton](https://openai.com/index/triton/)
- [GPU performance portability needs autotuning (arXiv 2505.03780)](https://arxiv.org/pdf/2505.03780)
- [Cross-platform fused MoE dispatch in Triton (arXiv 2605.23911)](https://arxiv.org/html/2605.23911v1)
- [Sylkan: a Vulkan compute target for SYCL (ACM)](https://dl.acm.org/doi/fullHtml/10.1145/3456669.3456683)
- [TechnoLynx: choosing Vulkan, OpenCL, SYCL or CUDA](https://www.technolynx.com/post/choosing-vulkan-opencl-sycl-or-cuda-for-gpu-compute)
- [Modular: GPU block and warp operations](https://docs.modular.com/mojo/manual/gpu/block-and-warp)
