# Numerical linear algebra and scientific computing: why GEMM, and what sits under it

Compiled 2026-09-01. This file exists to answer one question the hardware track
currently begs and never answers: **why does the final part of the curriculum
spend itself optimising GEMM?** Without §1 of this file, the kernel work is
cargo cult — a ritual optimisation of an operation nobody has justified. With
it, GEMM stops being an arbitrary benchmark and becomes the one operation the
machine was built for, and the one every other numerical algorithm has been
rewritten to call.

Every quantitative claim here is either (a) arithmetic you can redo on paper,
(b) a citation to a primary source I actually read, or (c) a number I **measured
on this machine** and reported with the compiler and hardware caveats. The
measured ones are marked **[MEASURED]** and the programs that produced them are
reproduced in §9. Anything I could not verify is in §10 — read that section
before teaching from this file.

## Scope note — what this file deliberately does *not* cover

Sibling research files own these; this file uses them as inputs and cross-refs
rather than restating them.

| Topic | Owner file |
|---|---|
| IEEE-754, rounding, unit roundoff, catastrophic cancellation, general stability | `numbers-text-numerics.md` |
| BLAS as a *library/API* (dispatch, OpenBLAS vs MKL vs Accelerate, NumPy binding) | `numpy-pytorch-internals.md` |
| Roofline model, ridge point, Nsight/Speed-of-Light, the three limiters | `cuda-programming-tuning.md` §8 |
| Cache hierarchy, TLB mechanics, prefetch, coalescing, shared-memory banks | `cpu-architectures.md`, `cuda-programming-tuning.md` §3–5 |
| Tensor cores, `mma.sync`, FP8/FP4 block formats | `nvidia-architectures.md`, `fp4-fp8-blackwell.md` |
| Transformer FLOP accounting, FlashAttention, MFU | `ai-systems-distributed-training.md` |
| Autograd *implementation* (tape, dispatcher, `torch.autograd`) | `numpy-pytorch-internals.md` |
| Sampling, Nyquist, filter design, windowing | `signals-and-dsp.md` (queued) |

Where this file says "roofline", it means the model defined in
`cuda-programming-tuning.md` §8; it does not redefine it.

---

## Primary sources actually read

**Read in full or in substantial part during this compilation:**

- Goto & van de Geijn, *Anatomy of High-Performance Matrix Multiplication*, ACM
  TOMS 34(3), 2008 — [PDF](https://www.cs.utexas.edu/~flame/pubs/GotoTOMS_final.pdf).
  Read pp. 1–17: equations (1)–(3), Assumptions (a)–(e), the packing and TLB
  analysis (§4.2.3), register blocking (§6.1–6.4), Fig. 12 parameter table.
- Smith, van de Geijn, Smelyanskiy, Hammond, Van Zee, *Anatomy of
  High-Performance Many-Threaded Matrix Multiplication*, IPDPS 2014 —
  [PDF](https://www.cs.utexas.edu/~flame/pubs/blis3_ipdps14.pdf). Read pp. 2–4:
  Fig. 1 (memory-hierarchy residency), Fig. 2 (the five-loop nest with the
  `jc, pc, ic, jr, ir` indices), §II–III.
- Huang, Smith, Henry, van de Geijn, *Strassen's Algorithm Reloaded*, SC16 —
  [PDF](https://jianyuhuang.com/papers/sc16.pdf). Read pp. 1–3: the abstract's
  "street wisdom" list, §III.A–C, Fig. 1–2, the switch-point claim.
- Carson & Higham, *Accelerating the Solution of Linear Systems by Iterative
  Refinement in Three Precisions*, SIAM J. Sci. Comput. 40(2), 2018; MIMS
  EPrint 2017.24 — [PDF](https://eprints.maths.manchester.ac.uk/2562/1/paper.pdf).
  Read pp. 1–2: abstract, the three precisions `u`, `u_f`, `u_r` (+ `u_s`),
  Algorithm 1.1, the κ ≤ 10⁴ / 10⁸ thresholds.
- Bell & Garland, *Efficient Sparse Matrix-Vector Multiplication on CUDA*,
  NVIDIA Tech. Report NVR-2008-004, Dec 2008 —
  [PDF](https://www.nvidia.com/docs/IO/66889/nvr-2008-004.pdf). Read pp. 1–7:
  abstract GFLOP/s figures, the bandwidth-limited argument, §3.1–3.4 (DIA, ELL,
  COO, CSR).
- Alman, Duan, Vassilevska Williams, Xu, Xu, Zhou, *More Asymmetry Yields Faster
  Matrix Multiplication*, arXiv [2404.16349](https://arxiv.org/abs/2404.16349) —
  abstract: ω < 2.371177.
- Halko, Martinsson, Tropp, *Finding Structure with Randomness*, SIAM Review
  53(2), 2011; arXiv [0909.4061](https://arxiv.org/abs/0909.4061) — abstract and
  framing (two-stage randomised range-finder).
- CUTLASS, [`media/docs/cpp/efficient_gemm.md`](https://github.com/NVIDIA/cutlass/blob/main/media/docs/cpp/efficient_gemm.md)
  — the threadblock/warp/thread tile names, the memory residency of each, the
  double-buffered software pipeline.
- Higham, *What Is a Condition Number?* ([nhigham.com](https://nhigham.com/2020/03/19/what-is-a-condition-number/)),
  *What Is Backward Error?* ([nhigham.com](https://nhigham.com/2020/03/25/what-is-backward-error/)),
  *What Is the Singular Value Decomposition?* ([nhigham.com](https://nhigham.com/2020/10/13/what-is-the-singular-value-decomposition/)).
- LAPACK Users' Guide, Table 3.13 (standard flop counts for drivers) —
  [netlib](https://www.netlib.org/lapack/lug/node71.html).
- Wikipedia, *Computational complexity of matrix multiplication* — used **only**
  for the ω timeline; the 2024 attribution there is imprecise and I corrected it
  against the arXiv abstract (see §10).

**Standing textbook references (cited from my own knowledge, not re-read here —
see §10):** Golub & Van Loan, *Matrix Computations*, 4th ed. (JHU Press, 2013);
Trefethen & Bau, *Numerical Linear Algebra* (SIAM, 1997); Higham, *Accuracy and
Stability of Numerical Algorithms*, 2nd ed. (SIAM, 2002) — "ASNA" below;
Demmel, *Applied Numerical Linear Algebra* (SIAM, 1997); Saad, *Iterative
Methods for Sparse Linear Systems*, 2nd ed. (SIAM, 2003).

---

# 1. The BLAS hierarchy, and the single most important ratio in the field

## 1.0 The one-sentence version

> **Level 1 and Level 2 BLAS do O(n) and O(n²) flops over O(n) and O(n²) data.
> Their arithmetic intensity is a constant. They are permanently memory-bound and
> no amount of cleverness will ever make them run at peak. Level 3 does O(n³)
> flops over O(n²) data. Its intensity grows with n. It is the only level that
> can ever reach peak — and that single fact is why every numerical algorithm in
> existence has been rewritten to be expressed in terms of GEMM.**

Everything else in this file is commentary on that paragraph.

## 1.1 The three levels, defined

The BLAS were specified in three waves, and the wave number is the loop depth.

| Level | Year | Shape of operands | Canonical op | Loop nest |
|---|---|---|---|---|
| 1 | 1979 | vector–vector | `axpy`: `y ← αx + y` | 1 loop |
| 2 | 1988 | matrix–vector | `gemv`: `y ← αAx + βy` | 2 loops |
| 3 | 1990 | matrix–matrix | `gemm`: `C ← αAB + βC` | 3 loops |

The level number is also the exponent of the flop count in the leading
dimension, and — this is the whole point — it is **one more** than the exponent
of the data.

## 1.2 The arithmetic, for real, in fp64

Arithmetic intensity `I = FLOPs / bytes moved`, counting **compulsory** traffic:
each operand element read once, each result written once. This is the *most
favourable possible* accounting; a real implementation can only do worse.

### Level 1 — `axpy`, `y ← αx + y`, length n

```
FLOPs   = 2n                       (one multiply, one add per element)
Bytes   = 8n (read x) + 8n (read y) + 8n (write y) = 24n
I       = 2n / 24n = 1/12 = 0.083 FLOP/byte          <- independent of n
```

Other level-1 ops for calibration:

| Op | FLOPs | Bytes (fp64) | Intensity |
|---|---|---|---|
| `scal`: `x ← αx` | n | 16n | **0.0625** |
| `axpy`: `y ← αx + y` | 2n | 24n | **0.083** |
| `dot`: `xᵀy` | 2n | 16n | **0.125** |
| `nrm2`: `‖x‖₂` | 2n | 8n | **0.25** |

Every one of these is a small constant. `nrm2` is the best of them at 0.25, and
0.25 is not a number that troubles any machine built in the last thirty years.

### Level 2 — `gemv`, `y ← αAx + βy`, A is n×n

```
FLOPs   = 2n²  + O(n)
Bytes   = 8n² (read A) + 8n (read x) + 16n (read+write y) = 8n² + O(n)
I       = 2n² / 8n² = 1/4 = 0.25 FLOP/byte            <- independent of n
```

**The structural reason:** every element of A is used *exactly once*. `A[i][j]`
participates in exactly one multiply-add, `y[i] += A[i][j]*x[j]`, and is then
never needed again. There is no reuse to exploit because there is no reuse to
be had. You may tile `gemv` however you like; there is nothing in the tile to
reuse. It is a streaming kernel wearing a matrix costume.

Note what this means: going from level 1 to level 2 raised the flop count by a
factor of n and **raised the intensity by a factor of 3**. The extra work bought
you essentially nothing, because the extra data came with it.

### Level 3 — `gemm`, `C ← αAB + βC`, all n×n

```
FLOPs   = 2n³ + O(n²)
Bytes   = 8n² (A) + 8n² (B) + 8n² (write C)  = 24n²         [β = 0]
        = 8n² (A) + 8n² (B) + 8n² (read C) + 8n² (write C) = 32n²  [β ≠ 0]
I       = 2n³ / 24n²  =  n/12  FLOP/byte     [β = 0]         <- GROWS with n
        = 2n³ / 32n²  =  n/16  FLOP/byte     [β ≠ 0]
```

**The structural reason:** every element of A participates in n multiply-adds
(once for each column of B). The reuse factor is n. That reuse is not a property
of the implementation; it is a property of the *operation*. GEMM is the smallest
BLAS operation in which the amount of work per byte of input is unbounded.

### The table that should be on the wall

| | Level 1 (`axpy`) | Level 2 (`gemv`) | Level 3 (`gemm`) |
|---|---|---|---|
| FLOPs | 2n | 2n² | 2n³ |
| Compulsory bytes (fp64) | 24n | 8n² | 24n² |
| **Arithmetic intensity** | **1/12** | **1/4** | **n/12** |
| At n = 1000 | 0.083 | 0.25 | **83** |
| At n = 10000 | 0.083 | 0.25 | **833** |
| Reuse of each input element | 1 | 1 | n |
| Can it reach peak? | **Never** | **Never** | **Yes, for large enough n** |

## 1.3 Connecting to the roofline

The roofline model (defined in `cuda-programming-tuning.md` §8) says

```
achieved FLOP/s  ≤  min( F_peak ,  I × B )
```

and defines the **ridge point** `I* = F_peak / B` — the intensity at which a
machine stops being bandwidth-limited and starts being compute-limited.

Plug in real ridge points and read off what each BLAS level is allowed to
achieve:

| Machine | F_peak (dense) | B | Ridge `I*` (FLOP/byte) |
|---|---|---|---|
| H100 SXM, BF16 | 989.5 TFLOP/s | 3.35 TB/s HBM3 | **295** |
| H100 SXM, FP64 (tensor) | 67 TFLOP/s | 3.35 TB/s | **20** |
| A100 80GB, FP64 (tensor) | 19.5 TFLOP/s | 2.04 TB/s | **9.6** |
| Typical server CPU core, FP64 AVX-512 | ~100 GFLOP/s | ~10 GB/s per-core share | **~10** |

(The H100 numbers are taken from `ai-systems-distributed-training.md` §0, which
derives them from the datasheet with the sparsity asterisk removed.)

Now the punchline, in three lines:

```
axpy on H100 BF16:  I = 0.083,  I* = 295   ->  0.03% of peak is the CEILING
gemv on H100 BF16:  I = 0.25,   I* = 295   ->  0.08% of peak is the CEILING
gemm on H100 BF16:  I = n/12,   I* = 295   ->  compute-bound once n ≥ 3540
```

**Read that carefully.** On an H100 in BF16, a *perfectly written*, *perfectly
coalesced*, *bug-free* `axpy` — one that saturates HBM completely — achieves
three hundredths of one percent of the machine's advertised peak. Not because
it is badly written. Because the operation has nowhere to put the flops.

This is the single most important consequence of the ratio, and it is why the
question "is my kernel fast?" is meaningless until you have answered "what is
this kernel's intensity?".

### The corollary that explains the whole hardware industry

Peak FLOP/s has grown far faster than memory bandwidth for thirty years, so the
ridge point `I*` has been climbing steadily. Every time it climbs, the set of
operations that can reach peak shrinks. Today that set is, essentially,
**{large GEMM, and things that decompose into large GEMM}**.

A machine whose ridge point is 295 FLOP/byte is not a general-purpose
computer with a fast multiplier. It is **a machine built to run one operation**,
and every transistor spent on tensor cores is a bet that your workload can be
written as GEMM. Deep learning is on that hardware because deep learning
*happens* to be expressible as GEMM. The causality is often taught backwards.

## 1.4 The cache-size bound: why intensity does not actually grow forever

`I = n/12` is an upper bound assuming *compulsory traffic only*, i.e. each
element of A, B, C crosses the memory boundary exactly once. That requires the
whole working set to fit in fast memory. It does not.

The real bound is a theorem. **Hong & Kung (1981)** proved that any schedule of
the n³ multiply-adds of matrix multiplication on a machine with `M` words of
fast memory must move

```
Ω( n³ / √M )   words between slow and fast memory
```

(extended to the parallel/distributed case by Irony, Toledo & Tiskin, 2004 —
this is where the "communication-avoiding" literature starts). Turning that into
intensity, with `w` bytes per word:

```
        2n³ FLOPs                    2 √M
I  ≤  ───────────────────  =  c · ─────────   FLOP/byte
       c·(n³/√M) · w                 w
```

So — dropping the constant, which depends on the accounting convention —

> **The achievable arithmetic intensity of GEMM scales as √M, where M is the
> capacity of the fast memory you are blocking for. Not as n.**

This is the theorem that makes cache blocking *necessary* rather than merely
*nice*, and it is the number that sizes on-chip SRAM. Sanity check, fp64
(`w = 8`, so `I ≈ 2√M` FLOP/byte with the common convention `≥ n³/(8√M)` words):

| Fast memory M | √M (fp64 words) | Achievable I (FLOP/byte) |
|---|---|---|
| 32 KB L1 (4K words) | 64 | ~128 |
| 256 KB L2 (32K words) | 181 | ~362 |
| 32 MB L3 (4M words) | 2048 | ~4096 |

And now the observation that should make a student sit up: the H100's ridge
point in BF16 is 295 FLOP/byte, and an H100 SM has 256 KB of combined L1/shared
memory, which by the table above supports an intensity of roughly 362. **The
on-chip SRAM is sized, to within a factor of about 1.2, to exactly the amount
needed to reach the ridge point.** That is not a coincidence. It is the
architects solving the same inequality you just solved.

*(Constant-factor caveat: the Hong–Kung constant varies between statements of
the theorem — see §10. The √M scaling is solid; treat "362" as an order of
magnitude, not a spec.)*

## 1.5 The consequence: LAPACK, and the "level-3 fraction"

Here is the historical fact that proves the argument was decisive.

**LINPACK** (1979) was written in terms of level-1 BLAS. On the vector machines
of the day this was fine. On cache machines it was a disaster: LINPACK's LU
factorization is a sequence of `axpy` calls, intensity 1/12, and it ran at a few
percent of peak on every workstation of the late 1980s.

**LAPACK** (1992) is a rewrite of exactly the same mathematics whose *sole
organising principle* is to push as many flops as possible into level-3 calls.
Nothing mathematical changed. The algorithms compute the same factorizations,
with the same error bounds. What changed is the shape of the loops.

The metric is the **level-3 fraction**: the proportion of the flop count
executed inside GEMM. For blocked LU with block size `b` on an n×n matrix:

```
panel factorization (level 2, unblocked):   O(n² b)   flops
trailing-matrix update (level 3, GEMM):     O(n³)     flops

level-3 fraction  =  1 − O(b/n)  ->  1  as n grows
```

That is the whole trick, and it is the same trick in Cholesky, QR, Hessenberg
reduction, and the bidiagonalization inside the SVD: **do a small, unavoidably
memory-bound panel step, then spend the bulk of the flops updating the trailing
matrix with one big GEMM.** Every blocked algorithm in LAPACK has this shape.

So the answer to "why GEMM?" is not "because matrix multiply is common". It is:

> **GEMM is the only shape in which flops can be delivered at peak, so the
> discipline spent twenty years rewriting every algorithm it had into that
> shape. Optimising GEMM optimises everything, because everything now calls it.**

## 1.6 [MEASURED] The three levels, on real silicon

Apple M-series (arm64), `clang++ -O3 -ffast-math`, single-threaded, fp64.
Program in §9.1. `axpy` uses 16.8M-element vectors (134 MB each, well out of
cache); `gemv` uses a 4000×4000 matrix (128 MB); `gemm` is a 64-tiled 1024³
kernel (no SIMD micro-kernel, so nowhere near a tuned BLAS).

```
kernel      FLOPs      bytes      AI(F/B)    GFLOP/s       GB/s
axpy     3.36e+07   4.03e+08      0.0833       7.23       86.72
gemv     3.20e+07   1.28e+08      0.2499      11.48       45.93
gemm     2.15e+09   2.52e+07     85.3333      16.90        0.20
```

Three things to make a student notice:

1. **`axpy` and `gemv` achieve the same order of GFLOP/s (7.2 vs 11.5) despite
   `gemv` doing 1000× more work per call.** The flop rate is pinned by the
   bandwidth, and the bandwidth does not care which BLAS level you are in.
2. **`axpy` hits 86.7 GB/s — that is this core's DRAM ceiling.** The kernel is
   not slow; it is *finished*. There is no optimisation left. Teaching a student
   to recognise a saturated memory-bound kernel is half the value of this unit.
3. **`gemm`, with a naive tiled loop and no vectorisation at all, already beats
   both** — and a tuned BLAS on this machine would be another 5–10× above it.
   The gap between "naive GEMM" and "perfect gemv" is the gap the whole kernel
   part of the curriculum lives in.

Caveats: `gemv`'s 45.9 GB/s is below `axpy`'s 86.7 because a large read-only
stream and a read-modify-write stream have different DRAM efficiencies on this
part, and because the reduction only vectorises under `-ffast-math` (under plain
`-O2` it drops to 7.28 GFLOP/s / 29 GB/s — dependent-FP-chain-bound before it
is even bandwidth-bound). That is itself worth showing: **a kernel can be
latency-bound below its own memory bound**, and you must fix the dependence
chain before the roofline model even applies.

---

# 2. GEMM itself

## 2.1 The reference definition, and why the API has α and β

The BLAS specifies

```
DGEMM( transa, transb, m, n, k, alpha, A, lda, B, ldb, beta, C, ldc )

              C  :=  alpha * op(A) * op(B)  +  beta * C

   op(A) is m x k,  op(B) is k x n,  C is m x n
   op(X) is X or X^T (or X^H), selected by transa/transb
   lda/ldb/ldc are the leading dimensions: the stride between columns
     (column-major), which is what lets you pass a SUBMATRIX of a larger
     array without copying it.
```

Flop count: `2mnk` (Huang et al., SC16, §II.A, stated exactly).

Students always ask why the scalars are there. There are four reasons and they
are all about performance, not convenience.

**1. `beta = 0` is a licence not to read C.** The standard specifies that when
`beta` is exactly zero, `C` is *not referenced* on entry. That is n² of memory
traffic saved (12.5% to 25% of the compulsory traffic, per §1.2) and — more
importantly — it means `C` may legally contain uninitialised garbage, NaN, or
Inf on entry. `beta = 0` is therefore **not** the same as multiplying by 0.0,
which would propagate NaN. This is a specified semantic difference and a
classic source of bugs when people write their own GEMM.

**2. `beta = 1` is what makes blocked algorithms possible.** Every blocked
factorization in LAPACK needs "update this submatrix by this product". If GEMM
could only overwrite, you would need a separate `C = C + T` pass — which is a
level-1 operation over n² elements, intensity 1/12. You would pay level-1
traffic to finish a level-3 computation, destroying the intensity you just
worked for. `beta = 1` folds the accumulation into the kernel, where it costs
nothing because C is already in registers.

**3. `alpha` is free.** It is applied once per output element — O(mn) work
against O(mnk) total — and it is applied to values already resident in
registers. Providing it costs nothing and saves the caller an O(mn) scaling
pass with, again, level-1 intensity.

**4. Together they close the operation under composition.** `C ← αAB + βC` with
arbitrary α, β and arbitrary `op()` and leading dimensions is expressive enough
that *every* blocked linear-algebra update is one call. That closure property
is what allows LAPACK to be a thin layer over a single tuned kernel. It is API
design in service of the memory hierarchy.

## 2.2 Goto's algorithm: GEMM as a data-movement schedule

Goto & van de Geijn's TOMS 2008 paper is the document that turned GEMM
implementation from folklore into engineering. Its central move is to stop
thinking about GEMM as an arithmetic algorithm and start thinking about it as a
**schedule for moving blocks between memory layers**.

### The decomposition

The paper classifies GEMM shapes by which dimensions are large (Fig. 2–3):
`M`atrix (both dimensions large/unknown), `P`anel (one dimension small),
`B`lock (both small). This yields `GEPP`, `GEMP`, `GEPM`, `GEBP`, `GEPB`,
`GEPDOT`. General GEMM decomposes into these; they decompose into the three
lowest-level kernels; **if those are fast, everything is fast.**

Goto argues (§5.6) that of the six possible paths, the one built on **GEBP**
(block of A times panel of B) is the best on essentially all current
processors, because a `GEPDOT`-based implementation "reads *and* writes each of
its elements" of the C block, "requir[ing] twice the bandwidth between the L2
cache and registers".

### The cost model, quoted

For `GEBP` with `A ∈ ℝ^(mc×kc)`, `B ∈ ℝ^(kc×n)`, `C ∈ ℝ^(mc×n)`, under three
assumptions — (a) `mc, kc` small enough that A plus `nr` columns of B and C fit
in cache, (b) if A, Cj, Bj are in cache the update runs at peak, (c) A stays in
cache until no longer needed — the paper gives the traffic exactly:

```
total memops  =  mc*kc  +  (2mc + kc)*n           for   2*mc*kc*n  flops

                       2 mc kc n            flops         2 mc kc n     flops
ratio  =  ────────────────────────────────  ─────  ≈  ───────────────   ─────    (1)
           mc kc + (2mc + kc) n             memops     (2mc + kc) n     memops

                                                              when kc << n
```

so the quantity to maximise is

```
              2 mc kc
           ─────────────                                                          (2)
            (2mc + kc)
```

"under the constraint that `mc kc` floating point numbers fill most of the
cache." Footnote 2 of the paper notes that maximising `mc kc /(2mc + 2kc)`
subject to `mc kc ≤ K` is the maximise-area-minimise-perimeter problem, whose
solution is **`mc = kc`** — the block should be roughly square.

And then the sentence that makes the whole thing concrete:

> "If `mc = kc ≈ n/100` then even if memops are 10 times slower than flops, the
> memops add only about 10% overhead to the computation."

That is the entire justification for cache blocking, in one line, with a number.

### Which cache

Equation (2) says: the bigger `mc × kc`, the better the amortisation. So put A
in the cache layer that is *furthest from the registers* subject to still
satisfying assumptions (a)–(c). The L1 trivially satisfies them but is tiny.
Goto's answer, §4.2.1: **put the `mc × kc` block of A in the L2 cache**, and
`Bj`/`Cj` in the L1. This works because the rate at which doubles can be
streamed from L2 to registers is close enough to the flop rate.

### The TLB, which is the part everyone forgets

§4.2.2–4.2.3 is the most under-appreciated part of the paper.

> "The most significant difference between a cache miss and a TLB miss is that a
> cache miss does not necessarily stall the CPU. […] A TLB miss, by contrast,
> causes the CPU to stall until the TLB has been updated with the new address.
> In other words, prefetching can mask a cache miss but not a TLB miss."

So two more assumptions are needed — (d) `mc, kc` small enough that A, `nr`
columns of B, `nr` columns of C are *simultaneously addressable by the TLB*;
(e) A stays TLB-addressable until done — and the constraint becomes

```
T_Ã  +  2 (T_Bj + T_Cj)  ≤  T          (T = available TLB entries)
```

the factor 2 being needed so that the entries for `Bj+1`, `Cj+1` can coexist
with those for `Bj`, `Cj` without evicting Ã.

On the Pentium 4 of the paper's era, the TLB could address ~256 KB while the L2
held 2 MB — **the TLB, not the cache, was the binding constraint on `mc × kc`.**

## 2.3 Why packing pays for itself

Now the key question. Packing means copying a submatrix into a contiguous
scratch buffer before using it. That is pure overhead — extra memory traffic
that the mathematics does not require. Why is it a win?

**The problem.** `Ã` is a submatrix of a larger array. It is therefore *strided*,
not contiguous: `mc` rows each starting `lda` elements apart. Addressing it
touches `mc` different pages in the worst case, "requir[ing] many more than the
minimal number of TLB entries" (§4.2.3). You blow through the TLB budget above
before you have done any arithmetic.

**The fix.** Copy `A` into a contiguous work array `Ã`, laid out in exactly the
order the micro-kernel will consume it (§6.1: each `mr × kc` submatrix stored
contiguously, itself in column-major, so the kernel "strid[es] strictly
contiguously through memory").

**Why it is nearly free.** Goto's amortisation argument, §5.1, verbatim in
substance:

```
Packing B into B̃ :  cost ∝ kc × n
                    amortised over 2 × m × n × kc flops
                    ->  O(m) computations performed for every copied item

Packing A into Ã :  cost ∝ mc × kc
                    amortised over 2 × mc × kc × n flops
                    ->  O(n) computations performed for every copied item
```

**That is the whole argument.** Each element you copy is subsequently used
O(m) or O(n) times. The copy is an O(n²) cost inside an O(n³) computation. As n
grows, the packing cost goes to zero as a fraction of the total, and what you
buy with it — contiguous access, minimal TLB pressure, guaranteed alignment,
a layout matched to the SIMD width — is worth a large constant factor forever.

And the copy is not even extra traffic in the first place: §4.2.3 notes that

> "The packing can be arranged so that upon completion Ã resides in the L2 cache
> and is addressed by the TLB, ready for subsequent computation. The cost of
> accessing A to make this happen need not be substantially greater than the
> cost of moving A into the L2 cache, which is what would have been necessary
> even if A were not packed."

**Teach it as: packing converts an access-pattern problem into a one-time O(n²)
copy, inside an O(n³) algorithm. That trade is always available and always
wins at scale — and it is the same trade as staging through shared memory on a
GPU** (`cuda-programming-tuning.md` §5, "shared memory exists to decouple the
access pattern you want from the access pattern DRAM rewards").

## 2.4 Register blocking, and the shape of the micro-kernel

The innermost computation (Goto §6.1) computes `mr × nr` submatrices of `C` **in
the registers**, as a sequence of rank-1 updates:

```
        2 mr nr kc  flops     performed for
          mr nr     memops    (storing the result back)
```

so `kc` should be as large as the other constraints allow. Notice the
consequence Goto draws: during the computation of `Cj`, its elements **need not
remain in L1 or even L2** — they live in registers for the whole `kc`-long
accumulation and are written out once.

Three constraints set `mr × nr` (§6.2), and they are worth memorising because
they are the CPU-side version of exactly the register-budget arithmetic in
`cuda-programming-tuning.md` §6:

1. **"Typically half the available registers are used for the `mr × nr`
   submatrix of C."** The other half prefetch elements of `Ã` and `B̃`.
2. **`mr ≈ nr`.** "It can be shown that amortizing the cost of loading the
   registers is optimal when `mr ≈ nr`" — the same perimeter-vs-area argument as
   `mc = kc`, one level down.
3. The bandwidth condition, equation (3):

```
                R_comp
    nr  ≥   ────────────
              2 R_load
```

   where `R_comp` is flops/cycle and `R_load` is doubles/cycle sustained from
   L2. **This is the single most transferable formula in the paper.** It says:
   the micro-tile must be wide enough that the arithmetic issued per loaded
   element covers the load rate. It is the roofline, evaluated at the register
   file.

Worked example, straight from §7.3 (Pentium 4 Prescott, 3.6 GHz): `R_comp = 2`
flops/cycle, `R_load = 1.03` doubles/cycle, so `nr ≥ 2/(2 × 1.03) ≈ 0.97`. The
binding constraint is instead the register file: 16 SSE registers × 2 doubles
each = 32 doubles; half for C gives 16; hence **`mr × nr = 4 × 4`**. And
`mc × kc = 696 × 192` — chosen so `kc` doubles occupy half a page (§6.3) and Ã
occupies about half the smaller of the TLB-addressable area and the L2 (§6.4).

Fig. 13 of the paper shows the empirical surface: sweeping `mc, kc` from 8 to
2000, performance is a plateau that collapses when Ã's footprint approaches the
2 MB L2, with the best point at ~1 MB. **The parameters are not magic numbers;
they are the solution of a small optimisation problem you can state.**

## 2.5 The BLIS refactoring: the five loops

BLIS's contribution is to take Goto's structure — in which the two innermost
loops were *hidden inside a hand-written assembly inner kernel* — and expose
them, leaving only a much smaller micro-kernel to be written per architecture.
Smith et al., IPDPS 2014, Fig. 2, gives the nest exactly (indices verbatim):

```
for jc = 0 : n-1  step nc                      # 5th loop  -- B̃ panel -> L3
  for pc = 0 : k-1  step kc                    # 4th loop  -- rank-kc update
      pack B(pc:pc+kc-1, jc:jc+nc-1) -> B̃      #            (kc x nc, into L3)
    for ic = 0 : m-1  step mc                  # 3rd loop
        pack A(ic:ic+mc-1, pc:pc+kc-1) -> Ã    #            (mc x kc, into L2)
      for jr = 0 : nc-1 step nr                # 2nd loop around micro-kernel
        for ir = 0 : mc-1 step mr              # 1st loop around micro-kernel
            MICRO-KERNEL:
            C(ir:ir+mr-1, jr:jr+nr-1) += Ã(ir-sliver) * B̃(jr-sliver)
```

And Fig. 1 gives the residency, which is the part to put on a slide:

| Object | Size | Lives in |
|---|---|---|
| `mr × nr` block of C | ~half the register file | **registers** |
| `kc × nr` sliver of B̃ | | **L1 cache** |
| `mr × kc` sliver of Ã | | streamed from **L2** |
| `Ã` (packed A block) | `mc × kc` | **L2 cache** |
| `B̃` (packed B panel) | `kc × nc` | **L3 cache** (or main memory) |
| `A`, `B`, `C` | `m×k`, `k×n`, `m×n` | **main memory** |

> "A typical point in the computation is now captured by Figure 1. A `mr × nr`
> block of C is in the registers. A `kc × nr` sliver of B̃ is in the L1 cache.
> The `mr × kc` sliver of Ã is streamed from the L2 cache." — Smith et al. §II

**Say this out loud to students: there is one loop per level of the memory
hierarchy.** `jc` sizes for L3, `pc` sets the rank of the update, `ic` sizes for
L2, `jr`/`ir` walk the register tile. A tuned GEMM is a program whose *loop
structure is a picture of the machine's memory hierarchy*. Once a student sees
that, blocked algorithms stop being a trick and become the obvious thing.

The micro-kernel itself "performs a sequence of rank-1 updates with columns
from the sliver of Ã and rows from the sliver of B̃" (§II), accumulating into
registers. It is the only piece that is architecture-specific and typically
assembly/intrinsics; everything above it is portable C. BLIS's own framing is
that the framework "identifies and isolates a key set of computational kernels
which, when optimized, immediately and automatically optimize performance",
which is why "instantiating a high-performance BLIS library on a new
architecture is a relatively straightforward endeavor"
([README](https://github.com/flame/blis)).

BLIS also notes *why* exposing those two loops matters beyond portability: it
gives you **five** parallelisable loops instead of three (§III), and the paper's
guidance on which to parallelise is itself an argument from the memory
hierarchy — parallelise `jr` (threads share Ã in L2, each takes its own sliver
of B̃) because `nc/nr` is in the thousands, but not `ir`, because `mc/mr` is only
a few tens and the parallelism is too thin to amortise bringing B̃ into L1.

## 2.6 [MEASURED] The blocking win, and the honest version of it

Apple M-series, `clang++ -O2`, single-thread, fp64, three variants of the same
`C = AB`. Program in §9.2.

```
N=768      (working set 3*768^2*8  = 14 MB  -- fits in this machine's caches)
  naive ijk    0.4418 s    2.05 GFLOP/s
  loop  ikj    0.0621 s   14.59 GFLOP/s   speedup  7.12x
  blocked 64   0.0563 s   16.08 GFLOP/s   speedup  7.84x

N=1024     (working set 25 MB)
  naive ijk    1.1058 s    1.94 GFLOP/s
  loop  ikj    0.1452 s   14.79 GFLOP/s   speedup  7.62x
  blocked 64   0.2012 s   10.67 GFLOP/s   speedup  5.50x     <- blocking LOSES

N=2048     (working set 100 MB -- exceeds any cache on this machine)
  naive ijk   20.3179 s    0.85 GFLOP/s
  loop  ikj    2.6544 s    6.47 GFLOP/s   speedup  7.65x
  blocked 64   1.7903 s    9.60 GFLOP/s   speedup 11.35x     <- blocking WINS
```

**This is the most instructive result in the file and it is not the tidy one.**
Three lessons, in order of importance:

1. **Most of the "blocking" speedup at moderate sizes is not blocking at all —
   it is fixing the access pattern.** `naive ijk` walks `B` down a column with
   stride N (a new cache line, and often a new page, per iteration).
   Interchanging to `ikj` makes every array access unit-stride, and *that alone*
   buys 7×. Students who write a blocked GEMM, measure 7×, and conclude
   "blocking works" have learned the wrong lesson.
2. **Cache blocking only pays when the working set exceeds the cache.** At
   N=1024 the blocked version is *slower* than the plain `ikj` loop (10.7 vs
   14.8 GFLOP/s) — the tiling adds loop overhead and index arithmetic to buy
   reuse that the hardware was already giving you for free. At N=2048 the same
   code wins by 1.48×. **The crossover is a property of the machine, not the
   algorithm**, and finding it experimentally is the exercise.
3. Even the best of these (16 GFLOP/s) is far from a tuned BLAS, because none of
   them has a register-blocked SIMD micro-kernel. The gap between §2.6 and a
   real `dgemm` is precisely §2.4 — and that gap is the entire justification for
   the kernel-engineering units downstream.

Correctness note: `max |C_naive − C_blocked| = 0.000e+00` exactly, at every size.
Not luck — for a fixed `(i,j)` both variants accumulate over `k` in increasing
order, so they perform *the identical sequence of floating-point operations*.
Worth pointing out: **loop tiling that preserves the reduction order is
bit-exact; loop tiling that reorders a reduction is not** (see §4 and the
`numbers-text-numerics.md` material on non-associativity).

## 2.7 The same algorithm on a GPU: threadblock, warp, thread

The CUDA/CUTLASS structure is Goto's structure with different names for the
memory levels. The mapping is essentially one-to-one, and making students draw
the correspondence is worth an hour.

CUTLASS's [`efficient_gemm.md`](https://github.com/NVIDIA/cutlass/blob/main/media/docs/cpp/efficient_gemm.md)
names three tile levels:

| CUTLASS level | What it is | Operands live in | Goto/BLIS analogue |
|---|---|---|---|
| **Threadblock-level GEMM** | one CTA's output tile; "iteratively loading tiles of input matrices and computing an accumulated matrix product" | global → **shared memory** | `ic`/`jc` loops; Ã in L2, B̃ in L3 |
| **Warp-level GEMM** | warps fetch fragments from shared memory; issues `mma.sync`/`wmma` or CUDA-core FFMA | shared memory → **registers** | `jr`/`ir` loops around the micro-kernel |
| **Thread-level GEMM** | "each thread is responsible for processing a certain number of elements", a 2-D tile held in registers | **registers** | the `mr × nr` register block of C |

And the correspondence continues one level further:

| Goto / BLIS on CPU | CUTLASS on GPU |
|---|---|
| Pack A into contiguous `Ã` for TLB + stride | Stage tiles into shared memory, swizzled to avoid bank conflicts |
| `mc, kc` sized to L2 and TLB coverage | Threadblock tile sized to shared-memory capacity and occupancy budget |
| `mr × nr` sized to *half the register file* | Thread tile sized to the per-thread register budget (`cuda-programming-tuning.md` §6) |
| `kc` large to amortise the register-block writeback | `K`-stage depth of the mainloop |
| Software prefetch of Ã/B̃ into the other half of the registers | **Double buffering**: "two allocations for current/next iteration" in shared memory, and "two register-held fragments" per warp — CUTLASS calls this the "software pipeline"; on CC 8.0+ it is `cp.async`, on CC 9.0+ TMA |
| `nr ≥ R_comp/(2 R_load)` | The same inequality, evaluated at shared-memory bandwidth vs tensor-core throughput |

**The one idea to land:** *the algorithm did not change when it moved to the
GPU. Only the names of the memory levels changed.* A student who has internalised
Goto's five loops does not need to learn CUTLASS's structure — they need to
learn CUTLASS's *spelling* of a structure they already know. That is the single
biggest reason to teach this unit before the CUDA kernel units rather than after.

The GPU does add one genuinely new constraint, and it is worth flagging: on a
CPU the micro-kernel's shape is set by the register file; on a GPU it is set by
the **fixed instruction shape** of the tensor core (`m16n8k16` and friends —
`nvidia-architectures.md`). You do not get to choose `mr × nr` freely any more;
you choose a multiple of what the MMA instruction accepts. The optimisation
problem is the same, with an added divisibility constraint.

## 2.8 Strassen and the fast-matmul literature

### The exponent history

`ω` is defined as the infimum of exponents such that n×n matrix multiplication
is achievable in `O(n^ω)` arithmetic operations. `2 ≤ ω < 2.371177` today.

| Year | Bound on ω | Authors |
|---|---|---|
| — | 3 | naive |
| 1969 | **2.8074** (= log₂7) | **Strassen** |
| 1978 | 2.796 | Pan |
| 1979 | 2.780 | Bini, Capovani, Romani |
| 1981 | 2.496 | Coppersmith, Winograd |
| 1990 | **2.3755** | **Coppersmith, Winograd** (unbeaten for 20 years) |
| 2010 | 2.3737 | Stothers |
| 2012–14 | 2.3729 | Vassilevska Williams; Le Gall |
| 2020 | 2.3728596 | Alman, Vassilevska Williams |
| 2022 | 2.371866 | Duan, Wu, Zhou (asymmetric hashing) |
| 2023 | 2.371552 | Vassilevska Williams, Xu, Xu, Zhou |
| **2024** | **2.371177** | **Alman, Duan, Vassilevska Williams, Xu, Xu, Zhou** — arXiv [2404.16349](https://arxiv.org/abs/2404.16349) |

(Timeline from Wikipedia's *Computational complexity of matrix multiplication*;
the 2024 entry corrected against the arXiv abstract, which I read — see §10.)

### Strassen, concretely

Partition all three matrices into 2×2 blocks. The obvious method needs **8**
block multiplications. Strassen needs **7**, at the cost of a larger number of
block additions. Huang et al., SC16, Fig. 2, gives the seven products exactly:

```
M0 = α(A00 + A11)(B00 + B11);   C00 += M0;  C11 += M0;
M1 = α(A10 + A11) B00;          C10 += M1;  C11 -= M1;
M2 = α A00 (B01 - B11);         C01 += M2;  C11 += M2;
M3 = α A11 (B10 - B00);         C00 += M3;  C10 += M3;
M4 = α(A00 + A01) B11;          C01 += M4;  C00 -= M4;
M5 = α(A10 - A00)(B00 + B01);   C11 += M5;
M6 = α(A01 - A11)(B10 + B11);   C00 += M6;
```

The cost, quoted from §III.A–B:

```
one level:   2mnk  ->  (7/8) * 2mnk  flops  (+ lower-order additions)

recursive, n = 2^d:
             (7/8)^log2(n) * 2n^3  =  n^log2(7/8) * 2n^3  =  2 n^2.807  flops
```

### Why Strassen is used only at large sizes

Four reasons, in descending order of practical importance:

1. **The O(n²) additions are not free — they are level-1 traffic.** One level of
   Strassen replaces 1/8 of the multiplications with 18 matrix additions. Those
   additions have arithmetic intensity ~1/12 (§1.2). You are trading O(n³) work
   that runs *at peak* for O(n²) work that runs *at bandwidth*. Until n is large
   enough that the n³ saving dominates, you lose. **This is the §1 argument
   turned against a "better" algorithm, and it is the best possible illustration
   that flop counts are not run times.**
2. **Workspace.** A naive one-level implementation needs 7 temporaries of size
   `n/2 × n/2` for `M0..M6` plus 10 more for the sums (SC16 §III.C); careful
   ordering reduces this to two, but it is still O(n²) of extra memory and extra
   traffic. Huang et al.'s contribution is an implementation needing **no
   workspace beyond what BLIS already allocates**, achieved by folding the
   additions `(X+Y)` directly into BLIS's *packing* routines — the packing pass
   was already touching the data, so the additions ride along for free.
3. **The crossover, measured.** SC16 §III.C, verbatim: *"In prior
   implementations, the switch point is usually as large as **2000** for double
   precision square matrices on a single core of an x86 CPU. We will see that,
   for the same architecture, one of our implementations has a switch point as
   small as **500**."* So: the folklore number is ~2000, and integrating with the
   memory-hierarchy machinery of §2.5 pulls it down to ~500. Both numbers are
   worth quoting; the *difference between them* is the lesson.
4. **Odd dimensions.** Strassen wants even `m, n, k` at every level. Handling the
   "fringe" requires padding or special-casing, which is fiddly and costs more
   O(n²) work.

### The numerical stability cost

This is a real and often-misstated cost. The precise statement:

- **Conventional GEMM satisfies a componentwise error bound.** The computed `Ĉ`
  satisfies `|Ĉ − AB| ≤ γ_k |A||B|` where `γ_k = ku/(1−ku)` — the bound is
  elementwise, and it involves `|A||B|`, the matrix of absolute values.
  Consequently, if `A` and `B` have non-negative entries, the *relative* error in
  every entry of `C` is small.
- **Strassen satisfies only a normwise bound.** Because it forms sums and
  differences of blocks before multiplying, cancellation inside `M5 = (A10 −
  A00)(B00 + B01)` can make an intermediate much larger than the entries of `C`
  it contributes to. The bound degrades to something of the form
  `‖Ĉ − AB‖ ≤ c(n, n₀) u ‖A‖ ‖B‖`, with a constant that grows with the number of
  recursion levels. (Higham, ASNA 2nd ed., ch. 23, "Fast Matrix Multiplication";
  originally Brent 1970 and Higham 1990, *Exploiting fast matrix multiplication
  within the level 3 BLAS*.)

**What that means in practice:** a small entry of `C` sitting next to large
entries can be computed with *no correct digits* under Strassen while being fine
under conventional GEMM. If your application only cares about `‖C‖`, Strassen is
fine. If any downstream step divides by a small entry of `C`, it is not. This is
why LAPACK's level-3 BLAS interface does not silently substitute Strassen, and
why libraries that offer it (some MKL paths, some research builds) make it
opt-in.

SC16's own framing (§I) is measured and correct: the method "can yield a shorter
execution time than the best classical algorithm with a **modest degradation in
numerical stability** […] by only incorporating **a few levels of recursion**."
Two or three levels is the practical regime; the degradation is bounded because
the recursion depth is.

### Why the galactic algorithms are never used

Everything from Coppersmith–Winograd (1990) onward is built on the **laser
method** applied to tensor powers of a small base identity. Three fatal
practical properties:

1. **The hidden constant is astronomical.** Wikipedia's summary of the standard
   position: the constant "is so large that they are only worthwhile for matrices
   that are too large to handle on present-day computers." The crossover sizes
   are commonly quoted as exceeding the number of atoms in the observable
   universe. These are *existence proofs about asymptotics*, not algorithms.
2. **They are not schedules.** The constructions are non-constructive or
   near-non-constructive: they establish a bound on the border rank of a tensor
   power. There is no loop nest to write. Even if you wanted to implement them,
   there is nothing to implement.
3. **Even if there were, §1 would eat them.** These methods are recursive
   decompositions with enormous numbers of O(n²) linear-combination steps. Per
   reason (1) above, every one of those steps has intensity ~1/12. An algorithm
   with a better flop exponent and a worse *communication* exponent runs slower.
   The relevant lower bound for real machines is not the arithmetic count; it is
   Hong–Kung's `Ω(n³/√M)` (§1.4) — and the communication-avoiding literature
   exists precisely because that is the binding constraint.

**The teaching point:** ω is one of the great open problems in theoretical
computer science, and it has had approximately zero effect on how anybody
multiplies matrices. Strassen (1969) is the last result from this line that
anyone runs. Fifty-five years of subsequent progress on the exponent has changed
nothing in practice — *because the exponent was never the binding constraint.*
Contrast that with Goto (2008), which changed everything and did not improve the
flop count by a single operation.

---

# 3. The decompositions, with the engineering angle

## 3.0 The framing to open with

A decomposition is not a mathematical curiosity. It is **a change of basis that
turns a hard problem into a triangular or diagonal one**, plus a promise about
how much accuracy the change of basis costs you. Every entry below has four
engineering facts attached: what it computes, what it costs, when you reach for
it, and what it does to your error.

Leading-order flop counts, n×n unless stated (m×n with m ≥ n where noted).
Sources: LAPACK Users' Guide Table 3.13 for the ones marked †; Golub & Van Loan
4th ed. §3.2/§4.2/§5.2/§8.6 and Trefethen & Bau Lectures 10/16/20/23/31 for the
rest (see §10 for what I could not re-verify).

| Decomposition | Computes | Flops (leading term) | Stability | Reach for it when |
|---|---|---|---|---|
| **LU, partial pivoting** | `PA = LU` | **(2/3)n³** † (0.67n³) | Backward stable *in practice* (see 3.1) | Square `Ax = b`, general |
| **Cholesky** | `A = LLᵀ` | **(1/3)n³** | **Unconditionally** backward stable | `A` symmetric positive definite |
| **LDLᵀ (Bunch–Kaufman)** | `PAPᵀ = LDLᵀ` | **(1/3)n³** | Backward stable with pivoting | `A` symmetric indefinite |
| **QR, Householder** | `A = QR` | **2mn² − (2/3)n³** (= (4/3)n³ square) | Backward stable, `‖I − Q̂ᵀQ̂‖ ≈ u` | Least squares; orthonormal basis |
| **QR, modified G-S** | `A = QR` | **2mn²** | R stable; `‖I − Q̂ᵀQ̂‖ ≈ uκ(A)` | Iterative methods, one column at a time |
| **QR, classical G-S** | `A = QR` | **2mn²** | `‖I − Q̂ᵀQ̂‖ ≈ uκ(A)²` — **do not use** | Never (unless reorthogonalised) |
| **Hessenberg reduction** | `A = QHQᵀ` | **(10/3)n³** | Backward stable | Precursor to unsymmetric eig |
| **Symmetric eig (QR alg.)** | `A = QΛQᵀ` | ~(4/3)n³ values; ~9n³ with vectors (~4n³ via divide & conquer / MRRR) | Backward stable; eigenvalues perfectly conditioned | Symmetric `A`; PCA via covariance |
| **Unsymmetric eig** | `A = QTQ*` (Schur) | **10n³** values †, **26.33n³** with vectors † | Backward stable, but **eigenvalues can be arbitrarily ill-conditioned** | Dynamics, stability analysis |
| **SVD** | `A = UΣVᵀ` | ~4mn² − (4/3)n³ values (= **2.67n³** square †); with vectors ~21n³ (GVL) / 6.67n³ (LAPACK nominal — see §10) | **The gold standard.** Backward stable; singular values perfectly conditioned | Rank, least squares, low-rank, PCA |

**The cost ratio to memorise: Cholesky 1 : LU 2 : QR 4 : SVD 20–60.** You pay
for information. Choosing a decomposition is choosing a point on that curve.

## 3.1 LU with partial pivoting — and why pivoting is about stability, not correctness

**What it computes.** `PA = LU`, `L` unit lower triangular, `U` upper
triangular, `P` a permutation. Then `Ax = b` becomes `Ly = Pb` (forward
substitution, n² flops) then `Ux = y` (back substitution, n² flops).

**The economics.** Factorization is (2/3)n³; each solve is 2n². So for `k`
right-hand sides: `(2/3)n³ + 2kn²`. **Factor once, solve many** — this is why
LAPACK separates `getrf` from `getrs`, and it is the reason you should never
call a "solve" routine in a loop over right-hand sides.

**Pivoting: the point everybody gets wrong.**

Gaussian elimination without pivoting fails outright when a pivot is exactly
zero. That failure is the *obvious* problem, and it leads students to believe
pivoting is a correctness patch for a degenerate case. It is not. Consider

```
        [ 1e-20   1 ]        b = [ 1 ]
   A =  [   1     1 ]            [ 2 ]
```

`A` is perfectly well-conditioned (κ₂ ≈ 2.6). No pivot is zero. Elimination
without pivoting computes the multiplier `m = 1/1e-20 = 1e20` and the updated
entry `1 − 1e20·1 = −1e20`, in which **the original `1` has been rounded away
entirely**. You have silently replaced `A` by

```
        [ 1e-20   1 ]
        [   1     0 ]
```

and you now solve *that* system exactly. The answer is wrong in the first
component, on a well-conditioned matrix, with no warning. Swap the rows first
and everything is fine.

So state it as:

> **Pivoting is not about avoiding division by zero. It is about bounding the
> growth of the entries of `U`.** A zero pivot is the visible symptom; a *tiny*
> pivot is the dangerous one, because it produces huge multipliers, huge
> intermediate entries, and cancellation that destroys information the matrix
> actually contained.

**The formal statement.** LU with partial pivoting produces a computed `L̂Û`
satisfying `L̂Û = A + ΔA` with

```
  ‖ΔA‖∞   ≤   c(n) · ρ_n · u · ‖A‖∞
```

where `ρ_n = max|u_ij| / max|a_ij|` is the **growth factor**. Partial pivoting
guarantees `|l_ij| ≤ 1`, which bounds `ρ_n ≤ 2^(n−1)` — an appalling bound that
is *attainable* (Wilkinson's matrix: unit lower triangle of −1s with a column
of 1s on the right). In practice `ρ_n` is almost always O(n^(2/3)) or smaller,
which is why LU with partial pivoting is used universally despite the bound.

**Teach this as the canonical example of a theoretically-unstable algorithm that
is stable in practice**, and note the honest position: this gap between the
2^(n−1) bound and observed behaviour has been open since the 1960s and is one of
the genuinely unresolved questions in the field. Complete pivoting (search the
whole trailing submatrix) has a much better growth bound but costs O(n³)
comparisons and destroys the level-3 structure, so nobody uses it. **The
universally deployed algorithm is the one with the worse proof.**

**Blocked LU and the level-3 fraction.** LAPACK's `getrf` factors a panel of `b`
columns with the unblocked (level-2) algorithm, then updates the trailing
submatrix with `trsm` + `gemm`. Per §1.5, the level-3 fraction → 1. This is why
the pivoting *search* is a problem for performance: it is a column-wise
reduction (level-1 shaped) that serialises against the level-3 update, and it is
the main reason "communication-avoiding LU" (CALU, with tournament pivoting) was
developed for distributed machines.

## 3.2 Cholesky — twice as fast, and when you are allowed

**What it computes.** For `A` symmetric positive definite: `A = LLᵀ` (or
`RᵀR`). Cost **(1/3)n³** — exactly half of LU.

**Where the factor of two comes from.** Three independent halvings that
coincide:

1. You only touch (and only store) one triangle: half the data.
2. You compute one triangular factor instead of two: half the arithmetic.
3. No pivot search, no row interchanges: no level-1 reduction interrupting the
   level-3 update, and no data movement for swaps.

**When you are allowed to use it.** `A` must be symmetric **positive definite**.
And here is the elegant part: **you do not have to check in advance.** The
algorithm computes `l_kk = sqrt(a_kk − Σ l_kj²)`. If `A` is not positive
definite, that radicand goes non-positive at some step and the factorization
fails. So:

> **Cholesky is its own positive-definiteness test, and it is the cheapest one
> there is.** Try it; if it fails, `A` was not SPD. Never test by computing
> eigenvalues (that costs ~4–9n³ to learn something a (1/3)n³ algorithm tells
> you for free).

This is exactly how it is used in practice — e.g. checking whether a Hessian is
positive definite in a trust-region optimiser, or whether a covariance matrix is
valid, or whether a step in a Gaussian-process fit needs more jitter on the
diagonal.

**Stability.** Cholesky is **unconditionally backward stable**: the growth
factor is bounded by 1 with no pivoting needed, because for SPD matrices the
diagonal dominates in the relevant sense (`|l_ij| ≤ sqrt(a_ii)`). Higham (ASNA
ch. 10): the computed factor satisfies `L̂L̂ᵀ = A + ΔA` with `‖ΔA‖₂ ≤
c(n) u ‖A‖₂`, unconditionally. **This is one of very few unconditionally stable
algorithms in the whole subject, and it is also the fastest one available. That
coincidence is worth remarking on: exploiting structure bought both speed and
stability at once.**

**The catch that bites in practice.** A matrix that is *mathematically* SPD but
has `κ(A) ≳ 1/u` will fail Cholesky in floating point, because its smallest
eigenvalue is below the rounding level of its largest. This is routine in
machine learning (kernel/Gram matrices `K = XXᵀ` are SPD by construction but
often numerically singular), and the standard fix is to add `εI` — "jitter",
"nugget", "Tikhonov regularisation", "ridge" — which are four names for the same
`(1/3)n³` operation.

## 3.3 QR — and the best cautionary tale in numerical computing

### What it computes and why you want it

`A = QR` with `Q` having orthonormal columns and `R` upper triangular. The
reason this is the most useful decomposition after LU: **`Q` preserves the
2-norm.** `‖Qz‖₂ = ‖z‖₂`. An orthogonal transformation cannot amplify an error.
So any algorithm built out of orthogonal transformations inherits a stability
guarantee for free — which is why QR (and the SVD, and the QR *algorithm* for
eigenvalues) are all built from them.

### Three ways to compute it

**Classical Gram–Schmidt (CGS).** For each column `j`, compute all the
projection coefficients against the **original** column `a_j`, then subtract
them all at once:

```
for j = 1..n:
    r_ij = q_i^T a_j        for i = 1..j-1     <-- all against the ORIGINAL a_j
    v    = a_j - sum_i r_ij q_i
    r_jj = ||v||;  q_j = v / r_jj
```

**Modified Gram–Schmidt (MGS).** Subtract one projection at a time, computing
each coefficient against the **current, partially orthogonalised** vector:

```
for j = 1..n:
    v = a_j
    for i = 1..j-1:
        r_ij = q_i^T v                          <-- against the CURRENT v
        v    = v - r_ij q_i
    r_jj = ||v||;  q_j = v / r_jj
```

**In exact arithmetic these two algorithms are identical.** They compute the
same `Q` and the same `R`, they perform the same number of flops (2mn²), and
they differ only in the order of two loops and in which vector the inner product
is taken against. A student reading the two side by side will not see a
difference worth caring about.

**Householder QR.** Do not orthogonalise at all. Instead apply a sequence of
elementary reflectors `H_k = I − 2 v_k v_kᵀ / (v_kᵀ v_k)`, each of which is
*exactly* orthogonal by construction, chosen to zero everything below the
diagonal in column `k`. Then `R = H_n···H_1 A` and `Q = H_1···H_n`. Cost
`2mn² − (2/3)n³`; `Q` is normally kept in factored form (the `v_k` stored in the
zeroed-out lower triangle) and never formed explicitly.

### Why classical Gram–Schmidt loses orthogonality

Here is the mechanism, and it is worth taking slowly because it generalises.

The computed `q_i` are not exactly orthogonal — each carries error of size ~u.
Now consider what happens when `A` is ill-conditioned, which is precisely the
case where `a_j` nearly lies in the span of `q_1…q_{j−1}`. Then

```
       v = a_j - sum_i r_ij q_i
```

is a **catastrophic cancellation**: you subtract quantities of size `‖a_j‖` to
get a result of size `‖a_j‖ / κ`. The absolute rounding error committed in that
subtraction is ~`u‖a_j‖`, so *relative to the surviving result* it is `uκ`.

That much is true of both algorithms. The difference is what happens next.

- **In CGS, every coefficient `r_ij` was computed from the original `a_j`, all
  of them before any subtraction happened.** They are computed open-loop, from
  stale data. When the subtraction of `r_1j q_1` introduces an error, the
  already-computed `r_2j, r_3j, …` know nothing about it. Nothing ever corrects
  it. The errors accumulate across all `j−1` projections and the loss compounds
  to `uκ²`.

- **In MGS, each coefficient `r_ij` is computed from the current `v`**, which
  has already had the components along `q_1…q_{i−1}` removed *including their
  errors*. Each projection therefore sees, and largely corrects, the error left
  by the previous one. It is a feedback loop rather than an open loop. The loss
  is `uκ`.

- **In Householder, `Q` is never assembled from computed inner products at all.**
  It is a product of reflectors, each of which is orthogonal to within rounding
  regardless of `A`, and a product of nearly-orthogonal matrices is
  nearly-orthogonal. The loss is `u`, **independent of κ**.

The bounds (Björck 1967 for MGS; Higham ASNA ch. 19–20; Trefethen & Bau
Lecture 19):

```
  Householder :   || I - Q̂^T Q̂ ||   ≲   c(m,n) · u
  MGS         :   || I - Q̂^T Q̂ ||   ≲   c(m,n) · u · κ₂(A)
  CGS         :   || I - Q̂^T Q̂ ||   ≲   c(m,n) · u · κ₂(A)²
```

### [MEASURED] The demonstration, and it is beautiful

Hilbert matrices `H_ij = 1/(i+j−1)`, fp64, `-ffp-contract=off`. `κ₂(H_n)`
computed independently by cyclic Jacobi (§9.4); the values reproduce the
standard published ones exactly. Program in §9.3.

```
  n     kappa_2(H_n)   CGS ||Q^T Q - I||_F   MGS ||Q^T Q - I||_F      ratio
  4        1.5514e+04           5.132e-11             4.050e-13     1.27e+02
  5        4.7661e+05           1.883e-07             6.369e-12     2.96e+04
  6        1.4951e+07           7.131e-05             2.724e-10     2.62e+05
  7        4.7537e+08           9.625e-01             2.738e-08     3.52e+07
  8        1.5258e+10           1.438e+00             7.338e-07     1.96e+06
  9        4.9315e+11           2.449e+00             4.033e-06     6.07e+05
 10        1.6025e+13           3.465e+00             2.550e-04     1.36e+04
 11                             4.464e+00             9.981e-03     4.47e+02
 12                             5.477e+00             4.389e-01     1.25e+01
```

**Now check the theory against the measurement**, with `u = 2⁻⁵³ = 1.11e−16`:

| n | κ₂ | predicted MGS = uκ | **measured MGS** | predicted CGS = uκ² |
|---|---|---|---|---|
| 6 | 1.50e7 | 1.66e−9 | **2.72e−10** | 2.5e−2 |
| 7 | 4.75e8 | 5.28e−8 | **2.74e−8** | 25 → saturates at O(1) |
| 8 | 1.53e10 | 1.69e−6 | **7.34e−7** | 3.9e4 → saturates at O(1) |

The `uκ` law predicts the modified Gram–Schmidt error **to within a factor of
2–6 at every size**, and the `uκ²` law correctly predicts that classical
Gram–Schmidt saturates — total loss of orthogonality — at exactly `n = 7`,
where `uκ²` first exceeds 1. Measured CGS at n=7 is 0.96; a value near 1 means
the computed `Q` is not orthogonal *at all*; the last columns have substantial
components along the first.

### Why this is the tale to tell

1. **Two algorithms, algebraically identical, differing only in loop order.**
   One of them squares the condition number. There is no better demonstration
   that *the mathematics does not determine the numerics*.
2. **It is fully deterministic and takes 40 lines of C++.** No randomness, no
   timing, no hardware dependence — the numbers above will reproduce on any
   IEEE-754 double machine to within the last couple of digits.
3. **The failure is silent.** CGS returns a `Q` and an `R`. `‖A − Q̂R̂‖` is
   *small* for both algorithms (both are backward stable *for the product*).
   Nothing is NaN, nothing throws, no residual looks wrong. The only way to
   detect it is to test the property you actually relied on — orthogonality —
   and that is a general lesson about numerical software: **assert the invariant
   you depend on, not the one that is easy to compute.**
4. **The theory predicts the measurement to a factor of 2.** Students rarely see
   an error bound that is actually *tight*. This one is.

### Four engineering corollaries

1. **LAPACK's QR is Householder** (`geqrf`), not any Gram–Schmidt. This is why.
2. **If you must use CGS, use CGS2 — do it twice.** "Twice is enough" (Kahan;
   analysed by Parlett, and by Giraud, Langou, Rozložník): one reorthogonalisation
   pass restores `‖I − QᵀQ‖ ≈ u` at 2× the flops. Why would you want CGS at all?
   **Because CGS is level-2 BLAS and MGS is level-1.** In CGS all the `r_ij` for
   a column are one `gemv`, and the subtraction is one `gemv`; in MGS they are
   `j−1` separate `dot`/`axpy` pairs. Per §1, that is a 3× intensity difference
   and a much larger difference in achieved bandwidth. **CGS2 is the standard
   answer: pay 2× the flops to get level-2 shape and full accuracy, rather than
   1× the flops at level-1 shape.** That trade — *more flops, better shape* — is
   the §1 argument appearing inside a stability decision, and it is worth
   flagging explicitly when you teach it.
3. **MGS is not "unstable".** Björck & Paige (1992) showed MGS applied to `A` is
   equivalent to Householder QR applied to the augmented matrix `[0; A]`, from
   which it follows that **MGS-based least squares is backward stable** even
   though its `Q` loses orthogonality like `κ`. The correct statement is narrow:
   *MGS's `R` is fine; MGS's `Q` is not orthogonal to better than `uκ`.* If you
   need `R` (least squares) MGS is fine. If you need `Q` (an orthonormal basis
   for a Krylov space) it is not.
4. **The same lesson, 50 years later, on GPUs.** `CholeskyQR` computes `G = AᵀA`
   (one GEMM), `G = RᵀR` (Cholesky), `Q = AR⁻¹` (one TRSM) — **entirely level-3,
   spectacularly fast**, and loses orthogonality like `κ²` because forming `AᵀA`
   squares the condition number (§4.3). The fix is `CholeskyQR2`: run it twice.
   Identical structure to CGS/CGS2, identical reasoning, thirty years apart.
   **Point this out — it shows the lesson is not history.**

## 3.4 Eigendecomposition and the QR algorithm, in outline

**What it computes.** `Av = λv`. For symmetric `A`: `A = QΛQᵀ` with `Q`
orthogonal and `Λ` real diagonal — always exists, always well-behaved. For
general `A`: the *Schur* form `A = QTQ*` with `T` upper triangular is what is
actually computed; the eigendecomposition `A = XΛX⁻¹` may not exist (defective
matrices) and `X` may be arbitrarily ill-conditioned even when it does.

**Why there is no direct algorithm.** Eigenvalues are roots of the
characteristic polynomial; by Abel–Ruffini there is no closed form for degree
≥ 5. **Every eigenvalue algorithm is necessarily iterative.** (And you must not
go via the characteristic polynomial: its roots are catastrophically
ill-conditioned as functions of its coefficients — Wilkinson's polynomial. Going
the other way, MATLAB's `roots` computes polynomial roots as the eigenvalues of
a companion matrix, which is the stable direction.)

**The QR algorithm, in outline.** The whole thing in four lines:

```
1. Reduce A to Hessenberg form  H = Q^T A Q   (upper triangular + one subdiagonal)
      -- a FINITE, direct, backward-stable step, (10/3)n^3 flops, all Householder.
      -- For symmetric A this gives a TRIDIAGONAL matrix, (4/3)n^3 flops.
2. Repeat:  choose a shift mu;   H - mu I = QR;   H <- RQ + mu I
      -- each step preserves Hessenberg/tridiagonal form
      -- and is a SIMILARITY transform, so eigenvalues are preserved exactly
3. Subdiagonal entries converge to zero; deflate when one does.
4. Read the eigenvalues off the diagonal (1x1 and 2x2 blocks).
```

Three things to draw out:

- **`RQ` is `QᵀHQ`** (since `H − μI = QR` ⟹ `R = Qᵀ(H − μI)` ⟹ `RQ + μI =
  QᵀHQ`). So each step is an orthogonal similarity: eigenvalues exactly
  preserved, and no error amplification, forever. That is the entire reason the
  algorithm is stable.
- **The shift is what makes it fast.** Unshifted QR converges linearly at rate
  `|λ_{i+1}/λ_i|`. With a good shift (Wilkinson shift, or the Francis
  double-shift for real matrices with complex-conjugate pairs) convergence is
  **cubic** for the symmetric case, and in practice it takes ~2–3 iterations per
  eigenvalue. The reduction to Hessenberg is what makes each iteration `O(n²)`
  instead of `O(n³)`. Total: ~10n³ for a general matrix (LAPACK Table 3.13).
- **Practical implementations do not do this literally.** LAPACK's `dhseqr` uses
  small-bulge multi-shift QR with aggressive early deflation, specifically to
  turn the iteration into level-3 BLAS operations. Same §1.5 pressure, applied
  to an iterative algorithm.

**Conditioning of eigenvalues.** For symmetric matrices, eigenvalues are
*perfectly conditioned*: `|λ̂_i − λ_i| ≤ ‖ΔA‖₂` (Weyl). A backward stable
algorithm therefore gives eigenvalues accurate to `u‖A‖`, absolutely, always.
For non-symmetric matrices this is **false**: the sensitivity of `λ_i` is
`1/|yᵢᵀxᵢ|`, the reciprocal of the cosine between left and right eigenvectors,
which can be enormous. A perfectly backward-stable algorithm can return
eigenvalues with no correct digits, and *the algorithm is not at fault* — the
problem is ill-conditioned. **This is where students most often blame the
library.** Eigenvectors are worse still: their conditioning depends on the *gap*
to the nearest other eigenvalue, so nearly-degenerate eigenvalues have
essentially arbitrary eigenvectors even though the invariant subspace they span
is perfectly well-determined. (Teach: *report subspaces, not vectors, when
eigenvalues cluster.*)

## 3.5 The SVD — the most informative decomposition

### What it is

`A = UΣVᵀ` with `U` (m×m) and `V` (n×n) orthogonal and `Σ` diagonal with
`σ₁ ≥ σ₂ ≥ … ≥ σ_p ≥ 0`. It exists for **every** matrix — any shape, any rank,
real or complex, no conditions whatsoever. Equivalently

```
        A  =  sum_{i=1}^{r} sigma_i * u_i * v_i^T
```

a sum of `r = rank(A)` rank-one terms, ordered by importance.

### The geometric meaning — teach this first

> **Every linear map is a rotation, then an axis-aligned scaling, then another
> rotation.** `Vᵀ` rotates the input so that the interesting directions are the
> coordinate axes; `Σ` stretches along those axes by `σ₁ … σ_n`; `U` rotates the
> result into place.

Equivalently: **the image of the unit sphere under any linear map is an
ellipsoid.** `σ_i` are the semi-axis lengths; `u_i` are the axis directions;
`v_i` are the preimages of those axes. `Av_i = σ_i u_i` (Higham). Draw this
once, in 2-D, and the SVD stops being a formula.

Read the rest of linear algebra straight off the picture:

| Quantity | From the SVD |
|---|---|
| `rank(A)` | number of nonzero `σ_i` |
| `‖A‖₂` | `σ₁` |
| `‖A‖_F` | `sqrt(Σ σ_i²)` |
| `κ₂(A)` | `σ₁ / σ_n` |
| `range(A)` | span of `u₁…u_r` |
| `null(A)` | span of `v_{r+1}…v_n` |
| Distance to the nearest singular matrix (2-norm) | `σ_n` |
| Best rank-k approximation | truncate the sum (§3.6) |

That last-but-one row is the one to dwell on: **`σ_n` is literally the distance
from `A` to the set of singular matrices.** So `κ₂ = σ₁/σ_n` is "how big `A` is,
divided by how close it is to being broken". The condition number stops being an
arbitrary formula the moment you say it that way.

### Why it is the most informative — and why you don't always use it

The SVD answers *rank* correctly. LU and QR do not, and cannot. Rank is a
discontinuous function of the matrix entries; asking "is this pivot zero?" is
meaningless in floating point. The SVD replaces the discontinuous question with a
continuous one — "how large is `σ_k` relative to `σ₁`?" — and lets you set a
tolerance. **Numerical rank is a decision, not a fact, and the SVD is the only
decomposition that presents you with the decision honestly.**

The price: ~2.67n³ for values alone (LAPACK Table 3.13; matches `4mn² − 4n³/3` at
m=n), and ~21n³ for the full thing with vectors (Golub & Van Loan). That is
**10–30× the cost of LU**. So: use LU to *solve*, use QR to *fit*, use the SVD
when you need to know *what the matrix is*.

**How it is computed** (Golub–Reinsch, 1970, and still the basis of `dgesvd`):
two phases, exactly mirroring §3.4.

```
1. Bidiagonalisation:  A = U1 B V1^T  with B upper bidiagonal.
      -- FINITE, direct, Householder from both sides. 4mn^2 - 4n^3/3 flops.
2. Iteratively diagonalise B by an implicitly-shifted QR sweep applied to
   B^T B WITHOUT EVER FORMING B^T B.
      -- forming B^T B would square the condition number (see 4.3); the whole
         art of the algorithm is getting the effect without the matrix.
```

For `m ≫ n`, do a QR factorization first and bidiagonalise `R` instead
(Chan's R-SVD): cost drops from `O(mn²)` with a large constant to
`2mn² + O(n³)`. Worth knowing because tall-skinny matrices are the common case
in data work.

## 3.6 Eckart–Young, and why it matters for LoRA and model compression

### The theorem

Let `A = Σ σ_i u_i v_iᵀ` and let `A_k = Σ_{i=1}^{k} σ_i u_i v_iᵀ` be the
truncation to `k` terms. Then for **any** matrix `B` of rank ≤ k:

```
    || A - B ||_2  ≥  || A - A_k ||_2  =  sigma_{k+1}

    || A - B ||_F  ≥  || A - A_k ||_F  =  sqrt( sum_{i=k+1}^{r} sigma_i^2 )
```

(Eckart–Young 1936 for the Frobenius norm; Mirsky 1960 for all unitarily
invariant norms. Statement and both error formulas verified against Higham,
*What Is the Singular Value Decomposition?*)

### Why it is remarkable

The set of rank-≤k matrices is **not convex**, and "find the closest point in a
non-convex set" is normally a hard problem. Eckart–Young says that for this
particular non-convex set, in any unitarily invariant norm, the answer is not
merely computable but *given in closed form by an object you already have*.
**You do not search. You truncate.** There is no comparable result anywhere else
in the subject, and it is why the SVD sits at the base of so much applied work.

And the error is not just bounded, it is **known exactly and in advance**:
`σ_{k+1}`. Before you commit to a rank, the spectrum tells you precisely what
that choice will cost. That is the property that makes low-rank approximation an
engineering decision rather than a gamble.

### The applications, in one place

**Least squares and the pseudo-inverse.** `A⁺ = VΣ⁺Uᵀ`, where `Σ⁺` inverts the
nonzero singular values and transposes. `x = A⁺b` is the least-squares solution,
and when `A` is rank-deficient it is the **minimum-norm** one among the infinitely
many minimisers. The *truncated* pseudo-inverse — zero out `σ_i` below a
tolerance before inverting — is the standard regularisation, and it is exactly
Eckart–Young applied to `A` before solving. Note what a plain pseudo-inverse
does without truncation: it divides by `σ_n`, amplifying noise in the data by
`1/σ_n`. Truncation is how you refuse to do that.

**PCA.** Centre the data matrix `X` (n samples × p features), then the principal
components are the right singular vectors `v_i` of `X`, and the explained
variance is `σ_i²/(n−1)`. Eckart–Young is the theorem that says the first `k`
PCs give the best rank-k reconstruction of the data. **Compute PCA via the SVD
of `X`, never via the eigendecomposition of `XᵀX`** — forming the covariance
matrix squares the condition number (§4.3), so you lose half your digits before
you start. This is the single most common numerical error in applied data work.

**Low-rank compression of neural network weights.** A weight matrix `W ∈ ℝ^(d×d)`
costs `d²` parameters; `A B` with `A ∈ ℝ^(d×r)`, `B ∈ ℝ^(r×d)` costs `2dr`. The
compression ratio is `2r/d`, and Eckart–Young says the *best possible* such
factorisation is the truncated SVD, with error exactly `σ_{r+1}`. So the
question "can I compress this layer?" has a precise, computable answer: **look
at the singular value spectrum.** Fast decay → yes; flat spectrum → no, and no
amount of clever training will change that.

**LoRA** ([2106.09685](https://arxiv.org/abs/2106.09685)) is this idea applied
to the *update* rather than the weight: freeze `W₀`, learn `ΔW = BA` with
`rank(BA) = r ≪ d`. The hypothesis is that the update needed for adaptation has
low **intrinsic rank** even though `W₀` does not. Eckart–Young is what makes the
hypothesis testable: fine-tune fully, compute the SVD of `W_ft − W₀`, and look
at how fast its singular values decay. **That is the experiment the theorem
licenses**, and it is a good one to set.

Worth flagging the arithmetic-intensity angle too: a rank-`r` factorisation
replaces one `d×d` GEMM (`2d²` flops per input vector, intensity ~`d/12` in the
batched case) with two skinny GEMMs. For small `r` these are much closer to
level-2 shape, so **low-rank compression reduces flops far more than it reduces
time**. Students who compress a layer 4× and measure a 1.3× speedup have met §1
again, and should recognise it.

**Also on this list:** total least squares (errors in both `A` and `b` — the
solution is the smallest singular triple of `[A b]`); image compression (the
canonical demo, though JPEG does not actually work this way); latent semantic
analysis; matrix completion and recommender systems; the "effective rank" /
"participation ratio" diagnostics used to study representation collapse.

---

# 4. Conditioning and stability, applied

The general theory of floating point, rounding and stability lives in
`numbers-text-numerics.md`. This section does one thing that file cannot: it
applies the machinery to *matrix* problems, where the amplification factor is
`κ(A)` and the consequences are large, concrete, and measurable.

## 4.1 The condition number of a matrix

**Definition** (Higham, *What Is a Condition Number?*): for nonsingular `A`,

```
        kappa(A)  =  ||A|| * ||A^{-1}||
```

with respect to whatever norm you choose. In the 2-norm this equals `σ₁/σ_n`
(§3.5). It is ≥ 1 in any submultiplicative norm, and → ∞ as `A` approaches
singularity.

Higham's framing, quoted: it is "the condition number with respect to inversion,
because a relative change to `A` of norm `ε` can change `A⁻¹` by a relative
amount as much as, but no more than, about `κ(A)ε` for small `ε`." **And the
same `κ(A)` is the condition number for solving `Ax = b`.**

**What it predicts.** Perturb the data and see how the answer moves:

```
   A x = b,   (A + ΔA)(x + Δx) = b + Δb

   ||Δx||          kappa(A)          ( ||ΔA||     ||Δb|| )
   ──────   ≤   ───────────────  ·   ( ─────  +   ────── )
   ||x||        1 - kappa ||ΔA||/||A||( ||A||      ||b||  )
```

To first order: **relative error out ≈ κ(A) × relative error in.**

### The rule of thumb, stated so it sticks

If you solve `Ax = b` in a precision with unit roundoff `u` using a **backward
stable** algorithm, the data is perturbed by ~`u` before you even start (it had
to be rounded to fit), so

```
   relative forward error  ≈  kappa(A) · u
```

and taking `log₁₀`:

> **You start with `log₁₀(1/u)` correct decimal digits and you lose `log₁₀ κ(A)`
> of them. What is left is what you get.**

In fp64, `u = 1.11e−16`, so you start with about **16 digits**:

| κ(A) | digits lost | digits left in fp64 | digits left in fp32 (≈7) |
|---|---|---|---|
| 1 | 0 | 16 | 7 |
| 10³ | 3 | 13 | 4 |
| 10⁶ | 6 | 10 | 1 |
| 10⁸ | 8 | 8 | **0 — fp32 is exhausted** |
| 10¹² | 12 | 4 | 0 |
| 10¹⁶ | 16 | **0 — fp64 is exhausted** | 0 |
| 10¹⁹ | — | garbage, and no warning | garbage |

**The two facts students must leave with:**

1. **`κ ≳ 1/u` means no correct digits.** Not "poor accuracy" — *none*. And the
   computed answer will look perfectly plausible; there is no NaN, no exception,
   no flag.
2. **This is a property of the problem, not the algorithm.** No algorithm can do
   better. If you need more digits you must change the problem (reformulate,
   rescale, regularise) or raise the precision. Blaming the solver is the
   commonest and most wasteful mistake in the area.

### [MEASURED] The rule of thumb is accurate

From §9.5, LU with partial pivoting on Hilbert matrices, right-hand side chosen
so the exact solution is `x = (1,1,…,1)ᵀ`:

| n | κ_∞(A) | predicted error = κu | **measured ‖x̂ − x‖_∞** |
|---|---|---|---|
| 6 | 2.907e7 | 3.2e−9 | **5.26e−10** |
| 8 | 3.387e10 | 3.8e−6 | **4.19e−7** |
| 10 | 3.535e13 | 3.9e−3 | **3.18e−4** |
| 12 | 3.832e16 | 4.2 (i.e. no digits) | **0.356** |
| 14 | 1.409e19 | — | **90.8** |

The rule of thumb is correct to within one order of magnitude at every size, and
it correctly predicts the exact `n` at which fp64 runs out. **This is one of the
few places in systems work where a back-of-envelope prediction lands this well;
use it to buy students' trust in the rest of the theory.**

### Conditioning is per-problem, not per-matrix

Worth a sentence because it heads off a misconception: `κ(A)` bounds the worst
case over all `b`. For a *particular* `b`, the relevant quantity is
`κ(A, b) = ‖|A⁻¹||A||x|‖ / ‖x‖`, which can be far smaller. A matrix with
`κ = 10¹⁰` can still give you 15 digits for a right-hand side that happens to
align with the large singular directions. `κ(A)` is a promise about the worst
case, not a prediction about yours.

## 4.2 Backward stability, restated for matrix algorithms

**Backward stable** means: the computed answer is the *exact* answer to a nearby
problem.

```
   computed x̂  satisfies  (A + ΔA) x̂ = b + Δb   with  ||ΔA|| ≲ c(n) u ||A||
```

The algorithm did not make an error in the sense of getting your problem wrong;
it solved a problem indistinguishable from yours at the precision you supplied.
That is the strongest guarantee available, and it is achievable — LU with
partial pivoting, Cholesky, Householder QR, and the QR algorithm all have it.

**The master equation** (Higham, *What Is Backward Error?*, quoted):

```
   forward error   ≲   condition number  ×  backward error
```

This is the whole subject in one line, and it partitions responsibility cleanly:

- **Backward error is the algorithm's responsibility.** It should be `O(u)`.
  Testable, and cheap: compute `‖b − Ax̂‖ / (‖A‖‖x̂‖)`.
- **The condition number is the problem's responsibility.** No algorithm
  controls it.
- **Forward error is what you actually wanted**, and it is the product. If it is
  bad, the equation tells you *which* of the two to go fix.

**The practical consequence: the residual is the thing you can check.** You
almost never know `x`, so you cannot measure forward error. You can always
compute the residual. And for a backward stable method the *relative residual*
is `O(u)` regardless of conditioning — which makes it a direct, cheap test of
whether your solver is behaving, independent of whether your problem is
well-posed. Teach `‖b − Ax̂‖_∞ / (‖A‖_∞‖x̂‖_∞)` as the number to print.

## 4.3 Why you never invert a matrix to solve Ax = b

The standard lesson, and the one worth doing with numbers on the screen.

**The claim.** To solve `Ax = b`, use `x = U⁻¹(L⁻¹(Pb))` via LU and triangular
substitution. Do **not** compute `A⁻¹` and then form `x = A⁻¹b`.

**Reason 1 — it costs three times as much.**

```
   LU + two triangular solves :  (2/3) n^3  +  2 n^2        flops
   explicit inverse + matvec  :       2 n^3  +  2 n^2        flops
```

Forming the inverse means solving `AX = I` for all n columns: the factorization
plus n triangular solve-pairs, `(2/3)n³ + n·2n² = (8/3)n³`, and clever
inversion algorithms get it to `2n³`. Either way it is **3–4× the work** of just
solving. And it is 3× the work to get a *worse* answer, which is the part that
makes it memorable.

**Reason 2 — it is not backward stable.** LU-with-substitution satisfies
`(A + ΔA)x̂ = b` with `‖ΔA‖ ≲ c(n)u‖A‖`: the relative residual is `O(u)` no
matter how ill-conditioned `A` is. Multiplication by a computed inverse does
**not** satisfy such a bound. Higham (ASNA §14.1) makes the precise statement;
the intuition is that `Â⁻¹` has relative error `~κu`, and multiplying by it
commits an error proportional to that — an error which, unlike the substitution
route's, is not absorbed into a perturbation of `A`.

**Reason 3 — you also lose the structure.** `A` may be sparse, banded,
triangular, symmetric, positive definite. `A⁻¹` is generically **dense** and
retains none of it. Inverting a sparse matrix is the classic way to turn an
`O(n)` problem into an `O(n²)` one and run out of memory.

### [MEASURED] With numbers

Hilbert matrices, fp64. Both routes use **the same LU factorization**, so the
comparison isolates exactly the thing under test: substitution vs. forming the
inverse and multiplying. Relative residual is
`‖b − Ax̂‖_∞ / (‖A‖_∞ ‖x̂‖_∞)`. Program in §9.5.

```
  n   kappa_inf        res_LU       res_INV       ferr_LU      ferr_INV
  6   2.907e+07     0.000e+00     7.539e-11     5.260e-10     1.521e-09
  8   3.387e+10     1.634e-16     2.421e-09     4.188e-07     8.345e-07
 10   3.535e+13     7.579e-17     2.272e-05     3.184e-04     1.463e-02
 12   3.832e+16     2.195e-16     1.583e-04     3.561e-01     2.588e+01
 14   1.409e+19     8.925e-18     1.717e-04     9.081e+01     1.833e+04
```

**Read the `res_LU` column down the page. It never leaves machine epsilon** —
2.2e−16 at worst, across seven orders of magnitude of condition number. That
column *is* backward stability. The algorithm is delivering its guarantee even
when the problem is hopeless.

**Now read `res_INV`.** It degrades with `κ` exactly as advertised, reaching
1.6e−4 at n=12 — **twelve orders of magnitude worse** than the substitution
route on identical data with an identical factorization.

And the forward errors: at n=12, LU gives 0.36 and inversion gives 25.9 — a 70×
difference in the answer you actually wanted. At n=14, 91 vs 18,300.

**The assert to build the exercise on:** at n=12, `res_LU < 1e-14` and
`res_INV > 1e-6`. Both hold with vast margin and neither depends on timing,
hardware, or optimisation level.

**One honest caveat to state in class.** There are legitimate reasons to want
`A⁻¹` as an object — computing a covariance matrix of estimates, a statistical
standard error, a Schur complement you will reuse many times. The rule is not
"never form an inverse"; it is **"never form an inverse in order to multiply by
it."** If `A⁻¹b` is what you want, solve.

## 4.4 Least squares three ways, and the squaring of κ

The problem: `A ∈ ℝ^(m×n)` with `m ≥ n`, find `x` minimising `‖Ax − b‖₂`.

### Route 1: Normal equations

```
   A^T A x = A^T b        (n x n, symmetric positive definite if A has full rank)
   -> form A^T A  (mn^2 flops),  Cholesky ((1/3)n^3),  two triangular solves
   Total:  m n^2 + (1/3) n^3       <- the cheapest of the three
```

**And here is the problem, in one line:**

```
        kappa_2( A^T A )  =  kappa_2( A )^2
```

Immediate from the SVD: if `A = UΣVᵀ` then `AᵀA = VΣ²Vᵀ`, so the singular values
are squared, so their ratio is squared. **Forming the normal equations squares
the condition number and therefore halves the number of correct digits, before
any arithmetic is done.**

Two distinct failure modes follow:

1. **You lose `2·log₁₀κ(A)` digits instead of `log₁₀κ(A)`.** With `κ(A) = 10⁶`,
   QR gives 10 digits and normal equations give 4.
2. **`AᵀA` can be numerically indefinite.** Once `κ(A)² ≳ 1/u` — i.e.
   `κ(A) ≳ 10⁸` in fp64 — the computed `AᵀA` may not be positive definite at
   all, and **Cholesky fails outright**. The matrix `A` was fine; the
   formulation destroyed it. Polynomial regression on a Vandermonde basis hits
   this at astonishingly low degree (κ of a Vandermonde on `[0,1]` with equally
   spaced nodes exceeds 10⁸ by around degree 12–15).

### Route 2: Householder QR — the default

```
   A = QR,  solve  R x = Q^T b        (R is n x n upper triangular)
   Cost:  2 m n^2 - (2/3) n^3         <- about 2x the normal equations for m >> n
```

Backward stable. Never forms `AᵀA`, so `κ` is never squared. The error bound
(Golub & Van Loan §5.3, Higham ASNA ch. 20) is

```
   ||x̂ - x||/||x||   ≲   c(m,n) u ( kappa_2(A)  +  kappa_2(A)^2 * rho )

              where  rho = ||b - Ax||_2 / ( ||A||_2 ||x||_2 )   -- the RELATIVE residual
```

**Read that carefully — it is the subtlety that separates people who have used
least squares from people who have read about it.** A `κ²` term *does* appear,
but it is multiplied by the residual. When the fit is good (`ρ ≈ 0`) the bound is
`κ`. When the fit is poor (`ρ` large — the data genuinely does not lie near the
column space) the bound degrades to `κ²` **and this is a property of the
problem, not the algorithm**: the least-squares problem with a large residual is
genuinely `κ²`-conditioned. So QR is not "immune to κ²"; it is "as good as the
problem allows", which is the most any algorithm can be.

### Route 3: SVD

```
   A = U Sigma V^T,   x = V Sigma^+ U^T b
   Cost:  ~2 m n^2 + 11 n^3  (Golub & Van Loan, R-SVD)   <- most expensive
```

**When to pay for it:** when `A` is rank-deficient or nearly so. QR with
column pivoting detects rank deficiency reasonably well; the SVD does it
*correctly*, and it gives you the tolerance knob. With truncation at
`σ_i < tol·σ₁`, you get the minimum-norm solution over the retained subspace and
you have explicitly decided what "zero" means. Nothing else does that.

### The summary table

| Route | Flops (m ≫ n) | Effective condition | Fails when | Use it |
|---|---|---|---|---|
| Normal equations | `mn² + n³/3` | **κ(A)²** | κ(A) ≳ 10⁸ (fp64) | κ small, m ≫ n, speed critical |
| **Householder QR** | `2mn²` | κ(A) (+κ²ρ) | rank deficiency | **Default** |
| SVD | `~2mn² + 11n³` | κ(A) (+κ²ρ) | — | Rank-deficient, or you need the spectrum |

**The one-line rule: normal equations are twice as fast and half as accurate.
Use QR unless you have measured that you can afford not to.**

And the corollary that connects to §3.6: **`AᵀA` is exactly the covariance
matrix**, so "compute PCA from the covariance matrix" and "solve least squares by
normal equations" are the *same* mistake wearing different clothes. Both square
κ. Both have an SVD-based alternative that does not. Point out the shared
structure — it is the same lesson twice and students rarely notice.

## 4.5 Iterative refinement, and its modern form

### The classical algorithm

You have a computed `x̂` with residual `r = b − Ax̂ ≠ 0`. Solve for the
correction and add it back:

```
   1.  Compute  r = b - A x̂                 <- in HIGHER precision
   2.  Solve    A d = r                      <- reusing the EXISTING factorization: only 2n^2
   3.  x̂ <- x̂ + d
   repeat
```

Two properties make this work and both are worth stating:

- **Step 2 is cheap.** The `(2/3)n³` factorization is already done; each
  refinement step is two triangular solves, `2n²`. Refinement costs `O(n²)` per
  iteration on top of an `O(n³)` factorization — **it is free at scale.**
- **Step 1 must be done in extra precision, and this is the whole trick.** `r` is
  a difference of nearly-equal quantities; computing it in working precision
  gives you a residual that is itself only accurate to `u‖A‖‖x‖`, which carries
  no new information. Compute it in `2u` (or with an FMA-based compensated dot
  product) and `r` contains real signal about the error.

Wilkinson programmed this in **1948** (Carson & Higham, §1). It is one of the
oldest ideas in the field.

### The modern form: mixed-precision iterative refinement

Carson & Higham (SISC 2018 / MIMS 2017.24) give the general algorithm with
**three** precisions (their Algorithm 1.1, transcribed):

```
   u    = working precision: A, b, x are stored at this precision
   u_f  = precision at which the FACTORIZATION of A is computed
   u_r  = precision at which RESIDUALS are computed
   u_s  = precision at which the correction equation is (effectively) solved

   with   u_r <= u <= u_f      and     u <= u_s <= u_f

   1  Solve A x0 = b in precision u_f, store x0 at precision u
   2  for i = 0 : infinity
   3      Compute r_i = b - A x_i at precision u_r, round r_i to precision u_s
   4      Solve A d_i = r_i at precision u_s, store d_i at precision u
   5      x_{i+1} = x_i + d_i at precision u
   6  end
```

**The inequality `u_f ≥ u` is the entire idea.** The `O(n³)` part — the
factorization — is done in the *lowest* precision. The `O(n²)` parts — residual
and update — are done in the *highest*. You get high-precision answers at
low-precision cost.

**The headline results, from the abstract (quoted):**

> "With single precision as the working precision, we show that by using LU
> factorization in IEEE half precision as the solver and calculating the
> residuals in double precision it is possible to solve `Ax = b` to full single
> precision accuracy for condition numbers `κ₂(A) ≤ 10⁴`, **with the O(n³) part
> of the computations carried out entirely in half precision.**"

> "We show further that by solving the correction equations by GMRES
> preconditioned by the LU factors the restriction on the condition number can
> be weakened to `κ₂(A) ≤ 10⁸`" — this is **GMRES-IR**.

> "Taking for comparison a standard `Ax = b` solver that uses LU factorization
> in single precision, these results suggest that on architectures for which
> half precision is efficiently implemented it will be possible to solve certain
> linear systems `Ax = b` **up to twice as fast and to greater accuracy**."

Read the last clause again: **faster *and* more accurate than the
single-precision solver.** Not a trade-off. That is unusual enough to be worth
dwelling on.

### Flag this as the ancestor of low-precision training

This connection deserves to be made loudly, because it reframes a whole area of
ML systems as a rediscovery rather than an invention.

| Mixed-precision iterative refinement (1948 → 2018) | Mixed-precision deep learning training |
|---|---|
| `O(n³)` factorization in low precision (`u_f`) | `O(n³)` GEMMs in fp16/bf16/fp8 on tensor cores |
| `O(n²)` residual + update in high precision (`u_r`, `u`) | `O(n)` optimiser state and weight update in fp32 |
| Master copy of `x` kept at working precision `u` | **Master fp32 copy of the weights** |
| Residual computed at `u_r` to extract signal below `u_f` | fp32 accumulate inside the tensor-core MMA |
| Correction `d` recovers what `u_f` rounded away | Small updates recovered against the fp32 master |
| Fails above `κ ≳ 1/u_f` unless you precondition | Fails when gradients underflow — fixed by **loss scaling** |
| **GMRES-IR**: use a Krylov solve to extend the usable range | Stochastic rounding, per-tensor/per-block scaling, MX formats |

**The structural principle is identical and it is worth naming:** *do the
`O(n³)` work in the cheapest precision that the hardware runs fastest, and spend
a `O(n²)`-or-cheaper correction in high precision to recover the accuracy.* The
`O(n³)` vs `O(n²)` gap is what makes the correction free — and that is the same
gap that §1 exploited to make GEMM the only operation that reaches peak. **The
same asymptotic separation underwrites both the performance argument and the
precision argument.** That is the deepest connection in this file and it is worth
building a lecture around.

The numerical-linear-algebra community had the whole framework — including the
error analysis, the condition-number thresholds, and the GPU implementations
(Haidar, Tomov, Dongarra & Higham, SC18, on V100 tensor cores) — before
mixed-precision training was widespread. Cross-reference `fp4-fp8-blackwell.md`
for the format side and `ai-systems-distributed-training.md` §1.6 for the
memory accounting; **this file supplies the reason any of it works.**

---

# 5. Sparse and iterative

## 5.1 Why sparsity changes everything — the intensity argument, again

A matrix is **sparse** if it is worth exploiting the zeros. The operational
definition: `nnz = O(n)` rather than `O(n²)`, typically 5–100 nonzeros per row.
Discretised PDEs, graphs, finite-element meshes, and recommender data are all
like this.

Sparsity is usually taught as a win — fewer flops, less storage. It is a win.
But run the §1 analysis on it and something uncomfortable appears.

### SpMV: `y = Ax` with `A` sparse in CSR, fp64, 32-bit indices

```
FLOPs  =  2 * nnz                                     (one FMA per nonzero)

Bytes  =  8 * nnz   (values)
       +  4 * nnz   (column indices)
       +  4 * (n+1) (row pointers)
       +  8 * n     (write y)
       +  8 * (however much of x you actually re-read)   <- the killer
       ≈  12 * nnz  + O(n)   in the best case

              2 nnz         1
   I    ≈   ─────────  =  ────  =  0.167  FLOP/byte      <- CONSTANT in nnz
             12 nnz         6
```

**SpMV has the arithmetic intensity of a level-1 BLAS operation.** It is
`0.167`, sitting between `axpy` (0.083) and `gemv` (0.25). Sparsity did not just
fail to help the intensity — **it made it worse than dense `gemv`**, because you
now ship an index alongside every value.

Bell & Garland state this as the premise of their paper (abstract, quoted):

> "Given the memory-bound nature of SpMV, we emphasize memory bandwidth
> efficiency and compact storage formats."

and in §1:

> "Dense operations are quite regular and are consequently often limited by
> floating point throughput. **In contrast, sparse matrix operations are
> typically much less regular in their access patterns and consequently are
> generally limited purely by bandwidth.**"

### The three consequences

1. **You cannot compute your way out of a sparse problem.** Nothing you do to
   the arithmetic matters, because the arithmetic is not the cost. **The only
   lever is reducing the number of times you touch the matrix** — which is
   exactly what preconditioning (fewer iterations), Krylov methods (one SpMV per
   iteration instead of a factorization), multigrid (`O(n)` total), and
   randomised methods (one pass) all are. *Every* technique in the rest of this
   section is an instance of that single lever. Say so explicitly; it makes the
   section cohere.

2. **Direct sparse solvers suffer from fill-in.** Sparse LU does not stay
   sparse: elimination creates nonzeros where `A` had none. Controlling fill
   requires reordering (AMD, nested dissection, METIS) — a *combinatorial*
   problem bolted onto a numerical one, and one that fights with pivoting for
   stability. For a 3-D PDE, sparse direct factorization costs `O(n²)` flops and
   `O(n^(4/3))` memory, which is why direct methods are the standard answer in
   2-D and iterative methods are the standard answer in 3-D.

3. **A well-run SpMV achieving 5% of peak FLOP/s may be perfect.** Bell &
   Garland measured roughly "90 GBytes/s, or **63.5% of peak** [bandwidth]"
   while delivering "roughly 10 GFLOP/s in double precision" on a GTX 280 whose
   peak was far higher. **Grade SpMV on bandwidth utilisation, never on FLOP/s.**
   Their headline figures: 36 GFLOP/s SP / 16 GFLOP/s DP for structured grid
   matrices; ">15 GFLOP/s and 10 GFLOP/s" SP/DP for unstructured finite-element
   matrices.

## 5.2 Storage formats, and the format-vs-access-pattern trade-off

All examples use Bell & Garland's matrix (their Figs. 5, 7, 10, 11):

```
        [ 1  7  0  0 ]
   A =  [ 0  2  8  0 ]
        [ 5  0  3  9 ]
        [ 0  6  0  4 ]
```

### COO — coordinate (a.k.a. triplet, IJV)

Three arrays of length `nnz`: `row`, `col`, `data`.

```
   row  = [ 0  0  1  1  2  2  2  3  3 ]
   col  = [ 0  1  1  2  0  2  3  1  3 ]
   data = [ 1  7  2  8  5  3  9  6  4 ]
```

Storage `16·nnz` bytes (fp64 + two int32). Completely general; trivial to build
incrementally; trivial to permute. **But** SpMV requires a scatter-add into `y`
(atomics or a segmented reduction), and nothing is grouped. **Use it as an
interchange and construction format, then convert.** Bell & Garland's redeeming
note: COO performance is *insensitive to the sparsity pattern*, which makes it
the robust fallback for pathological matrices.

### CSR / CSC — compressed sparse row / column

The workhorse. Three arrays, `ptr` of length `m+1`, `indices` and `data` of
length `nnz`:

```
   ptr     = [ 0  2  4  7  9 ]        (row i occupies [ptr[i], ptr[i+1]) )
   indices = [ 0  1  1  2  0  2  3  1  3 ]
   data    = [ 1  7  2  8  5  3  9  6  4 ]
```

Storage `12·nnz + 4(m+1)`. Bell & Garland (§3.4): CSR "may be viewed as a
natural extension of the (sorted) COO representation … with a simple compression
scheme applied to the (often repeated) row indices", and the row pointers
"facilitate fast querying of matrix properties, such as the number of nonzeros
in a particular row (`ptr[i+1] − ptr[i]`)".

The SpMV kernel is four lines:

```c
for (i = 0; i < m; i++) {
    double s = 0.0;
    for (j = ptr[i]; j < ptr[i+1]; j++)
        s += data[j] * x[indices[j]];       /* <-- the irregular access */
    y[i] = s;
}
```

**CSC is CSR of `Aᵀ`.** Use CSC when you need column slices or `Aᵀx` (both
common: `Aᵀx` appears in every least-squares normal-equation step, in LSQR, and
in the backward pass of a sparse linear layer).

**CSR's weakness on wide-SIMD/GPU hardware:** one row per thread means threads
in a warp process rows of different lengths → divergence and uncoalesced access;
one warp per row wastes lanes on short rows. Both of Bell & Garland's CSR
kernels (scalar and vector) have a regime where they are poor. **The format
itself is fine; it is the *mapping of work to lanes* that is hard.**

### ELL / ELLPACK

For an `M×N` matrix with at most `K` nonzeros per row: two dense `M×K` arrays,
`data` and `indices`, with short rows zero/sentinel-padded, **stored
column-major**:

```
   data =  [ 1  7  * ]         indices = [ 0  1  * ]
           [ 2  8  * ]                   [ 1  2  * ]
           [ 5  3  9 ]                   [ 0  2  3 ]
           [ 6  4  * ]                   [ 1  3  * ]
```

Column-major layout means thread `i` handling row `i` accesses `data[i + k*M]` —
**consecutive threads touch consecutive addresses. Perfectly coalesced.** Row
indices are implicit. This is the format vectorises best.

**The cost is padding**, and it is unbounded: storage is `M·K` regardless of the
actual `nnz`. Bell & Garland (§3.2): ELL is efficient "when the maximum number
of nonzeros per row does not substantially differ from the average", but for
unstructured meshes "the ratio between the maximum number of nonzeros per row
and the average may be **arbitrarily large**. Clearly the ELL format alone is an
inappropriate choice."

### DIA — diagonal

Two arrays: `data` (one column per occupied diagonal) and `offsets`.

```
   data = [ *  1  7 ]          offsets = [ -2  0  1 ]
          [ *  2  8 ]
          [ 5  3  9 ]
          [ 6  4  * ]
```

Row and column indices are **entirely implicit** — no index array at all, which
roughly doubles the arithmetic intensity relative to CSR. Access to `data`, `x`
and `y` is contiguous. **This is the highest-intensity sparse format available**,
and it is exactly right for stencils on regular grids (their Fig. 4: a 25×25
5-point Laplacian). It is useless for anything else (their Fig. 6 shows the
patterns that defeat it).

### HYB — hybrid ELL + COO

Bell & Garland's contribution: store the first `K` nonzeros of each row in ELL
(where `K` is a typical row length) and put the overflow in COO. You get ELL's
coalescing for the regular bulk and COO's generality for the long tail. **This is
the practical answer for unstructured meshes** and the design that made
`cusparse`'s early SpMV competitive.

### Blocked formats — BSR / BCSR

Store `r×c` dense blocks (2×2, 4×4, 8×8) instead of scalars, with one index per
block. Two effects:

- **Index overhead falls by `r·c`.** For 4×4 blocks, one index per 16 values
  instead of per 1: bytes/nonzero drops from ~12 to ~8.25, raising intensity
  from 0.167 toward 0.24.
- **The inner operation becomes a small dense GEMM** — register-blockable,
  SIMD-friendly, and reusing `x` within the block. *This is §1 and §2.4 reaching
  into the sparse world:* you are manufacturing a tiny level-3 operation inside a
  level-1 kernel.

The catch: if the blocks are not naturally dense you store explicit zeros and do
useless flops. For matrices from vector-valued PDEs (3 unknowns per node → a
natural 3×3 block) this is free and the win is large. For a random graph it is a
loss. **OSKI and SPARSITY auto-tune the block size by sampling the matrix at
runtime**, which is the honest engineering answer.

### The trade-off, stated as a principle

| Format | Bytes/nonzero (fp64) | Intensity | Index cost | Access pattern | Robust to irregularity? |
|---|---|---|---|---|---|
| COO | 16 | 0.125 | 2 per nz | scatter-add, needs atomics | **Yes** — insensitive to pattern |
| CSR | ~12 | 0.167 | 1 per nz | good on CPU, awkward mapping on GPU | Yes (perf varies) |
| CSC | ~12 | 0.167 | 1 per nz | good for `Aᵀx`, columns | Yes |
| ELL | ~12 (+ padding) | 0.167 | 1 per nz | **perfectly coalesced** | **No** — unbounded padding |
| DIA | ~8 | **0.25** | **0** | contiguous | **No** — diagonals only |
| BSR (4×4) | ~8.25 | ~0.24 | 1 per block | dense micro-GEMM | Only if blocks are dense |
| HYB | mixed | ~0.17 | mixed | ELL bulk + COO tail | **Yes** |

> **The principle: a sparse format is a bet about the sparsity pattern.** The
> more structure you assume, the fewer bytes you move per nonzero and the more
> regular the access — and the harder you fail when the assumption is wrong.
> There is no universally best format, which is why every serious sparse library
> ships five of them and a converter, and why format selection is a legitimate
> auto-tuning problem.

## 5.3 SpMV as the canonical irregular kernel

`y[i] += A[i][j] * x[j]` where `j` comes out of an array. That indirection makes
SpMV the standard teaching example for **every** irregularity a memory system
can suffer, which is why it is worth a unit even beyond its own importance:

- **Indirect / gather access to `x`.** `x[indices[j]]` — the address is not known
  until the index is loaded. **Prefetchers cannot see it.** Every access is a
  potential cache miss with no way to hide the latency. On a GPU, one warp's 32
  gathers can touch 32 different cache lines: the worst case in the coalescing
  analysis of `cuda-programming-tuning.md` §4.
- **Reuse of `x` is entirely pattern-dependent.** If the matrix has good
  locality (a banded PDE operator), `x` stays in cache and the effective bytes
  per nonzero approach the ideal 12. If it is a random graph, every access
  misses and the effective figure is 12 + 8 = 20, and the intensity drops to
  0.1. **The same code, the same format, the same flop count — 2× different
  performance depending on the input.** This is why *bandwidth-reordering* (RCM,
  METIS, space-filling-curve orderings) is a performance technique, not just a
  fill-reduction one.
- **Load imbalance.** Row lengths vary; in a power-law graph they vary by orders
  of magnitude. Static work partitioning fails. This is where merge-based and
  nonzero-balanced SpMV (Merrill & Garland, 2016) come from.
- **Short, data-dependent inner loops.** Poor vectorisation, poor branch
  prediction, no unrolling opportunity.

**Teach SpMV as the counterexample to GEMM.** Everything that makes GEMM the
ideal kernel — dense regular access, unbounded reuse, static work distribution,
long inner loops, compile-time-known shapes — is inverted here. A student who
can explain why GEMM reaches peak and why SpMV cannot understands the memory
hierarchy. That pairing is the pedagogical core of the sparse unit.

## 5.4 Stationary iterations: Jacobi and Gauss–Seidel, for intuition

Split `A = M − N` with `M` easy to invert, and iterate `M x^(k+1) = N x^(k) + b`.

```
   Jacobi        M = D            x_i^{k+1} = ( b_i - sum_{j != i} a_ij x_j^k ) / a_ii
   Gauss-Seidel  M = D + L        x_i^{k+1} = ( b_i - sum_{j<i} a_ij x_j^{k+1}
                                                    - sum_{j>i} a_ij x_j^k   ) / a_ii
   SOR           M = D/w + L      Gauss-Seidel + over-relaxation factor w in (0,2)
```

**Convergence** iff the spectral radius of the iteration matrix `M⁻¹N` is < 1,
and the asymptotic rate is that spectral radius. Guaranteed for strictly
diagonally dominant `A` (both) and for SPD `A` (Gauss–Seidel/SOR).

**Why teach them at all, given nobody uses them as solvers?** Three reasons:

1. **They make the fixed-point idea concrete** before Krylov methods make it
   abstract.
2. **The difference between them is a systems lesson, not a maths one.** Jacobi
   uses only `x^k`, so every component is independent — **embarrassingly
   parallel, one SpMV per sweep**. Gauss–Seidel uses `x^{k+1}` values as soon as
   they exist, converging roughly twice as fast, but it is **inherently
   sequential**: component `i` waits for `1…i−1`. Red-black ordering recovers
   parallelism for a 5-point stencil by splitting into two independent colours —
   and *graph colouring to recover parallelism* is a technique that recurs
   everywhere. Two algorithms, same flop count, opposite parallel structure.
3. **They are the smoothers inside multigrid** (§5.7), which is where they earn
   their keep. A few Jacobi/Gauss–Seidel sweeps annihilate the
   high-frequency error components very fast and the low-frequency ones barely at
   all — a *terrible* solver and a *perfect* smoother. That reframe is the whole
   idea of multigrid.

## 5.5 Krylov methods: the conjugate gradient

### The Krylov idea

Given `A` and `b`, the only thing you can cheaply do is multiply by `A`. After
`k` multiplications the entire set of vectors you can have built is

```
   K_k(A, b)  =  span{ b, Ab, A^2 b, ... , A^{k-1} b }        (the Krylov subspace)
```

> **A Krylov method chooses the best possible approximation to `x` from that
> subspace, for some definition of "best".** All of them — CG, MINRES, GMRES,
> BiCGSTAB, LSQR — are the same idea with different definitions of "best" and
> different assumptions on `A`. That framing collapses a confusing zoo into one
> sentence, and it is how to open the topic.

### CG specifically

**Requirement: `A` symmetric positive definite.** (Not negotiable — CG is
derived from minimising the quadratic `φ(x) = ½xᵀAx − bᵀx`, whose minimiser is
`A⁻¹x` only if `A` is SPD.)

CG chooses `x_k ∈ K_k` minimising the **A-norm of the error**,
`‖x − x_k‖_A = sqrt((x−x_k)ᵀA(x−x_k))`.

Per iteration: **one SpMV, two inner products, three `axpy`s.** All level-1 and
level-2. `O(nnz)` work and `O(n)` storage — no factorization, no fill-in. That
is why it exists.

The miracle is the **short recurrence**: CG maintains the optimal iterate over a
growing subspace while storing only *three* vectors, because A-orthogonality
plus symmetry makes all the older search directions drop out. **For symmetric
matrices you get optimality for free; for nonsymmetric ones you do not, and that
single fact is why GMRES has to store everything** (§5.6).

### Two convergence facts, and both matter

**1. Finite termination.** In exact arithmetic CG terminates in **at most `n`
iterations**, because after `n` steps the Krylov subspace is all of `ℝⁿ`. More
precisely: it terminates in at most **`d` iterations, where `d` is the number of
*distinct* eigenvalues** of `A` represented in `b`.

**2. The convergence rate.** Long before termination,

```
   || x - x_k ||_A                (  sqrt(kappa) - 1  )^k
   ────────────────    ≤    2  ·  (  ───────────────  )
   || x - x_0 ||_A                (  sqrt(kappa) + 1  )
```

**Note the `sqrt(κ)`** — CG's rate depends on the *square root* of the condition
number, where a stationary iteration depends on `κ`. That is the payoff for the
optimality property, and it is a big one.

### [MEASURED] Both facts, demonstrated

1-D Laplacian, `n = 20` (SPD, tridiagonal, `κ₂ = 178.1`). Program in §9.6.

**With a generic (pseudorandom) right-hand side:**

```
   it 16  ||r||/||b|| = 4.763e-02
   it 17  ||r||/||b|| = 5.980e-02       <-- the residual INCREASED
   it 18  ||r||/||b|| = 4.833e-02
   it 19  ||r||/||b|| = 3.011e-02
   it 20  ||r||/||b|| = 2.943e-16       <-- exact termination at k = n
   iterations = 20 (n = 20)
   true ||b-Ax||_inf = 1.110e-15
```

Terminates in **exactly `n = 20`** iterations, to machine precision, in floating
point. The finite-termination theorem, on the screen.

**With `b = (1,1,…,1)ᵀ`:**

```
   it 10  ||r||/||b|| = 0.000e+00
   iterations = 10 (n = 20)
   true ||b-Ax||_inf = 0.000e+00
```

**Ten** iterations, exactly zero residual. Why? `b` is symmetric under the
grid's reflection symmetry, so it has zero component along the 10
antisymmetric eigenvectors — only **10 distinct eigenvalues are represented**,
and CG terminates in `d`, not `n`. **This is the single best possible motivation
for preconditioning**, because it shows that CG's cost is governed by *the
spectrum it sees*, and a preconditioner is a device for changing that spectrum.

**The non-monotonic residual** (iteration 17 is worse than 16) is worth
pointing at: CG minimises `‖e‖_A`, which decreases monotonically, but `‖r‖₂` need
not. Students who add "stop when the residual increases" break the algorithm.
(If you need monotone residuals, that is MINRES.)

### Practical CG

- **Stop on `‖r‖/‖b‖ < tol`**, and recompute the true residual `b − Ax` at the
  end — the recursively updated `r` drifts from the true residual in floating
  point.
- **The `n`-iteration guarantee does not survive rounding.** Orthogonality among
  the Krylov vectors is lost gradually (the same phenomenon as §3.3 — it is the
  Lanczos process underneath, and it loses orthogonality for exactly the
  Gram–Schmidt reason). In practice CG can need more than `n` iterations, or can
  converge in far fewer. **Nobody runs CG to `n`; you run it to a tolerance.**
- **CG is entirely level-1/level-2.** Per §1, each iteration is memory-bound.
  The way to make CG fast is not to speed up the iteration — it is to **need
  fewer of them.** Which is §5.7.

## 5.6 GMRES, and the rest of the zoo

**GMRES** (Saad & Schultz, 1986) drops the symmetry requirement. It minimises
`‖b − Ax_k‖₂` over `K_k`, for **any** nonsingular `A`.

The price is exactly the thing CG got for free:

- **No short recurrence exists.** GMRES must store the full orthonormal basis of
  `K_k` (Arnoldi) — **storage grows as `O(nk)` and work per iteration as
  `O(nk)`**, because step `k` orthogonalises against all `k−1` previous vectors.
- Hence **GMRES(m)**: restart every `m` steps, discarding the basis. Bounds
  storage at `O(nm)`, but destroys the optimality guarantee — restarted GMRES
  can stagnate and fail to converge at all. Choosing `m` is a genuine art.
- The orthogonalisation inside Arnoldi is **Gram–Schmidt**, so §3.3 applies
  directly: MGS is standard, and reorthogonalisation (or Householder Arnoldi) is
  used when the basis is ill-conditioned. **The cautionary tale from §3.3 is not
  a museum piece; it lives inside every GMRES implementation.**
- **Non-symmetric convergence theory is weak.** For SPD matrices, eigenvalues
  bound convergence (§5.5). For non-normal matrices they do **not** — you can
  construct a matrix with any spectrum you like and any GMRES convergence
  history you like (Greenbaum, Pták & Strakoš, 1996). Pseudospectra, not
  eigenvalues, are the right tool. **State this: it is the honest reason
  non-symmetric iterative solving is hard.**

Quick orientation to the rest:

| Method | For | Optimality | Storage | Note |
|---|---|---|---|---|
| **CG** | SPD | min `‖e‖_A` | O(n) | The gold standard when applicable |
| **MINRES** | symmetric indefinite | min `‖r‖₂` | O(n) | Short recurrence survives; use when `A` is symmetric but not PD |
| **GMRES** | general | min `‖r‖₂` | **O(nk)** | Optimal but expensive; restart to survive |
| **BiCGSTAB** | general | none | O(n) | Short recurrence, often works, can break down |
| **LSQR / LSMR** | least squares | min `‖r‖₂` | O(n) | CG on the normal equations **without forming `AᵀA`** — see §4.4 |
| **CGLS** | least squares | as LSQR | O(n) | Older, less stable variant of the same idea |

LSQR deserves the callout: it is mathematically CG applied to `AᵀAx = Aᵀb` but
implemented via Golub–Kahan bidiagonalisation so that `AᵀA` is **never formed**.
Same trick as the SVD algorithm in §3.5, same reason: avoid squaring κ. **The
pattern "get the effect of `AᵀA` without the matrix" appears three times in this
file** (SVD bidiagonalisation, CholeskyQR2's fix, LSQR) and is worth naming as a
recurring move.

## 5.7 Preconditioning — the thing that actually decides whether any of this works

**The idea.** Solve `M⁻¹Ax = M⁻¹b` instead, choosing `M ≈ A` such that `M⁻¹v` is
cheap. Convergence is now governed by the spectrum of `M⁻¹A`, not `A`.

**The blunt truth, stated plainly:**

> **The choice of preconditioner determines whether an iterative solver takes 20
> iterations or 20,000, or fails. The choice of Krylov method is a detail by
> comparison.** Ninety percent of the engineering effort in a production
> iterative solver is in the preconditioner, and essentially all of the
> problem-specific knowledge lives there.

Read it against §5.5: an unpreconditioned CG on a 3-D Poisson problem with `n`
unknowns has `κ = O(n^(2/3))` and needs `O(n^(1/3))` iterations of `O(n)` work
each. The preconditioner's whole job is to attack that exponent.

**The two things a preconditioner can do**, and it is worth separating them:

1. **Reduce `κ(M⁻¹A)`** — improves the `sqrt(κ)` rate bound.
2. **Cluster the spectrum** — per §5.5's measurement, CG terminates in the
   number of *distinct* eigenvalues. A preconditioner that maps most of the
   spectrum near 1 with a few outliers converges in roughly (number of
   outliers) iterations, **regardless of `κ`**. This is usually the more
   important effect and it is the one the `sqrt(κ)` bound does not capture.

**The standard menu**, cheapest first:

| Preconditioner | `M` | Cost per apply | When |
|---|---|---|---|
| **Jacobi / diagonal** | `diag(A)` | O(n) | Always try first; free; fixes bad scaling |
| **Block Jacobi** | block diagonal | O(n·b) | Vector-valued PDEs; parallel-friendly |
| **SSOR** | from `D, L` | O(nnz) | Cheap, sequential |
| **ILU(k) / ILUT** | incomplete LU, fill capped by level `k` or threshold | O(nnz) | The general-purpose workhorse; can break down on indefinite `A` |
| **IC(0)** | incomplete Cholesky | O(nnz) | SPD; may fail if `A` is not an M-matrix (fix: shift) |
| **Algebraic multigrid (AMG)** | §5.8 | O(n) | Elliptic-like operators; the best available |
| **Domain decomposition** (additive Schwarz) | local solves + coarse grid | varies | Distributed memory; scales |
| **Physics-based** | a simplified operator you can solve fast | varies | **Almost always the best**, when available |

**The systems trade-off, which is a §1 argument again.** ILU is sequential to
apply (triangular solves have loop-carried dependencies) and hostile to GPUs.
Jacobi is trivially parallel and useless on hard problems. **On a machine with a
lot of parallelism, a weaker preconditioner you can actually apply fast often
beats a stronger one you cannot.** The literature on "polynomial
preconditioners" and "sparse approximate inverse (SPAI/AINV)" exists entirely
because those are `M⁻¹` applied as SpMVs — parallel — rather than as triangular
solves. That is a hardware constraint reshaping a numerical choice, and it is
exactly the kind of thing this curriculum should be showing.

## 5.8 Multigrid, in outline

The observation that starts it: **relaxation (Jacobi/Gauss–Seidel) kills
high-frequency error components fast and low-frequency ones almost not at all.**
After three or four sweeps the error is *smooth* — and a smooth function is
exactly the thing you can represent accurately on a coarser grid, where it is no
longer smooth relative to the mesh, and where relaxation kills it fast.

```
V-cycle( A_h, b_h, x_h ):
   1  pre-smooth:   a few relaxation sweeps on A_h x_h = b_h      (kill high freq)
   2  residual:     r_h = b_h - A_h x_h
   3  restrict:     r_2h = R r_h                                  (fine -> coarse)
   4  recurse:      solve A_2h e_2h = r_2h  by V-cycle
                    (at the coarsest level, solve directly -- it is tiny)
   5  prolongate:   e_h = P e_2h                                  (coarse -> fine)
   6  correct:      x_h <- x_h + e_h
   7  post-smooth:  a few more relaxation sweeps
```

**The result: `O(n)` total work to solve an elliptic PDE to discretisation
accuracy.** Optimal — you cannot do better than touching each unknown a constant
number of times. Convergence factor is typically ~0.1 per V-cycle and, crucially,
**independent of the mesh size `h`**. That mesh-independence is the property that
matters; every other method degrades as you refine.

- **Geometric multigrid** uses an actual hierarchy of meshes. Fastest, but needs
  the geometry.
- **Algebraic multigrid (AMG)** constructs the coarse "grids" from the matrix
  graph alone (strength-of-connection, coarsening, interpolation weights). Works
  as a black-box preconditioner on unstructured problems. This is what
  `hypre`/BoomerAMG, Trilinos/ML, and PyAMG provide, and it is the default
  industrial answer for large elliptic systems.
- **FMG (full multigrid)** starts on the coarsest grid and works up, giving
  discretisation-level accuracy in **one** pass — genuinely `O(n)` with a small
  constant.

**Teach it as the one algorithm in the file that beats the `O(n)`-per-touch
barrier by touching most unknowns on a *smaller* grid** — the total work is a
geometric series `n(1 + 1/2^d + 1/4^d + …)` which converges to a constant times
`n`. And note the caveat: multigrid's optimality is specific to elliptic-ish
operators. On strongly convective, highly indefinite, or Helmholtz problems it
degrades badly, and making it work there is an active research area.

## 5.9 Randomised numerical linear algebra

### The idea

For low-rank problems, **you do not need to look at the whole matrix.** If `A`
is well-approximated by rank `k`, a few random projections capture its range
with overwhelming probability.

Halko, Martinsson & Tropp (SIAM Review 53(2), 2011; arXiv
[0909.4061](https://arxiv.org/abs/0909.4061)) is the standard reference and its
framing is a two-stage template:

> Stage A: "random sampling identifies a subspace capturing the matrix's
> significant structure". Stage B: "the input matrix gets compressed to this
> reduced dimensional space, followed by deterministic manipulation to extract
> the desired factorization."

They claim these methods "beat [their] classical competitors in terms of
accuracy, speed, and robustness" and enable "truly massive data sets" by
"exploiting modern computational architectures more effectively."

### Randomised SVD, in full

```
   Given A (m x n), target rank k, oversampling p (typically 5-10),
   power iterations q (typically 0-2):

   1  Omega = randn(n, k+p)                    -- Gaussian test matrix
   2  Y = A Omega                              -- ONE PASS over A; a TALL-SKINNY GEMM
   3  for i = 1..q:  Y = A (A^T Y)             -- power iterations, if sigma decays slowly
   4  Q = qr(Y)                                -- orthonormal basis for range(A), m x (k+p)
   5  B = Q^T A                                -- (k+p) x n; ANOTHER PASS, also a GEMM
   6  [U~, S, V] = svd(B)                      -- SVD of a SMALL matrix: O(n(k+p)^2)
   7  U = Q U~
```

```
   Deterministic SVD :  O(m n min(m,n))     -- and it needs random access to A
   Randomised SVD    :  O(m n (k+p))        -- 2 passes, and every step is a GEMM
```

The error bound (their Theorem 1.1, in expectation, 2-norm):

```
   E || A - Q Q^T A ||_2   <=   [ 1 + 4 sqrt(k+p) / (p-1) * sqrt(min(m,n)) ] * sigma_{k+1}
```

i.e. within a modest, *explicitly computable* factor of the Eckart–Young optimum
`σ_{k+1}` (§3.6), with the factor controlled by the oversampling `p`.

### Why it matters at scale — and it is a §1 argument

This is the point to make loudly, because it is the whole reason the field
exists as an engineering practice and not just a theory:

1. **Every expensive step is a GEMM.** `AΩ` and `QᵀA` are tall-skinny
   matrix-matrix products — **level 3**. A classical Krylov SVD (Lanczos) is a
   sequence of SpMVs and `axpy`s — **level 1/2**. Per §1, the randomised
   algorithm does *more flops at higher intensity* and wins on wall-clock even
   when it loses on flop count. **It is the CGS2 trade (§3.3) at algorithm
   scale.**
2. **Two passes over `A`.** For a matrix that lives on disk, streams from a
   network, or is never formed at all (only `A → Av` available), pass count is
   the real cost. Krylov methods need `k` sequential passes with a dependency
   between each; randomised needs 2 and they are parallel.
3. **It parallelises trivially.** `AΩ` has no sequential dependency at all.
   Krylov methods are inherently sequential in the iteration index.
4. **Accuracy is tunable and predictable.** `p` and `q` trade cost for accuracy
   with an explicit bound. Nothing is hidden.

**Sketching** more generally: replace `A` with `SA` for a random `S` that is
cheap to apply (Gaussian; **subsampled randomised Hadamard transform**, which
uses an FFT-like `O(n log n)` butterfly — see §6.1 — instead of a dense GEMM;
CountSketch, which is sparse and `O(nnz)`). Applications: sketched least squares
(Blendenpik, LSRN), `ε`-approximate leverage scores, Johnson–Lindenstrauss
dimension reduction, randomised trace estimation (Hutchinson, and Hutch++).

Modern relevance to flag: randomised SVD is how you actually compute the
low-rank spectra referenced in §3.6 for a real weight matrix, how activation
covariances are estimated in second-order optimisers (K-FAC, Shampoo), and how
data-driven quantisation and pruning methods estimate the Hessian/Fisher they
need. Cross-ref `ai-systems-distributed-training.md` §6 for the quantisation
side.

---

# 6. Adjacent scientific computing, briefly

This section is deliberately thin. The FFT belongs to `signals-and-dsp.md`
(queued), ODE solvers belong to the robotics/simulation material, and autograd
*implementation* belongs to `numpy-pytorch-internals.md`. What follows is the
minimum needed so those files have something to attach to, plus — in each case —
the connection back to §1, which is the reason this material is in *this* file
at all.

## 6.1 The FFT

### Cooley–Tukey, in one idea

The DFT is `X_k = Σ_{j=0}^{n−1} x_j ω^{jk}` with `ω = e^{−2πi/n}`. Done directly
that is `O(n²)`.

**The idea (Cooley & Tukey 1965; Gauss 1805, unpublished):** split the sum into
even- and odd-indexed terms.

```
   X_k  =  sum over even j  +  sum over odd j
        =  E_k  +  omega^k * O_k          for k = 0 .. n/2 - 1
   X_{k + n/2}  =  E_k  -  omega^k * O_k
```

`E` and `O` are DFTs of length `n/2`. One length-`n` DFT becomes **two length-`n/2`
DFTs plus `n` "twiddle" multiply-adds**, and

```
   T(n) = 2 T(n/2) + O(n)   ->   T(n) = O(n log n)

   Standard flop count for complex radix-2:  5 n log2(n)
```

`n = 2²⁰`: `10¹²` operations direct vs `10⁸` with the FFT. **Four orders of
magnitude — and the reason essentially all of signal processing exists as an
engineering discipline.**

### Convolution — the real reason it matters

```
   Convolution theorem:     F( a * b )  =  F(a) . F(b)      (elementwise)

   =>  a * b  =  F^{-1}( F(a) . F(b) )

   direct convolution :  O(n^2)
   via FFT            :  O(n log n)
```

Applications: polynomial and big-integer multiplication (Schönhage–Strassen);
digital filtering; correlation and template matching; spectral PDE solvers;
Poisson solvers on regular grids; large-kernel convolutions in CNNs (FFT-based
`cudnn` algorithms — used when the kernel is large, which for 3×3 kernels it is
not, hence Winograd instead).

### Why the FFT is an awkward kernel — the §1 connection

**Arithmetic intensity.** `5n log₂n` flops over `~16n` bytes moved (complex fp64
in and out, ignoring twiddles):

```
   I  ≈  5 n log2(n) / (16 n)  =  0.31 * log2(n)   FLOP/byte
```

`n = 2²⁰` gives `I ≈ 6.3`. **Logarithmic growth — better than level 1, far worse
than GEMM.** For an H100 (ridge point 295) the FFT is memory-bound at any size
you can hold in memory. Concretely, a large FFT typically achieves 5–15% of peak.
That is the honest ceiling, and it explains why FFT libraries obsess over memory
layout rather than arithmetic.

**And the access pattern is genuinely hostile**, in three distinct ways:

1. **Bit-reversal permutation.** The decimation-in-time algorithm requires
   reordering the input by reversing the bits of each index. That is a
   maximally cache-hostile permutation: consecutive outputs come from addresses
   `n/2` apart. It is `O(n)` work that moves `O(n)` data with zero locality.
2. **Stride doubles every stage.** Stage `s` combines elements `2^s` apart. Early
   stages are cache-friendly; late stages stride across the whole array. For
   `n` beyond cache, the late stages are pure DRAM traffic with a stride that
   defeats prefetchers and, at large strides, causes cache-set aliasing.
3. **Twiddle factors** must be tabled (memory traffic) or recomputed
   (transcendentals, and accumulating error).

**How real libraries respond**, and note that it is the §2 playbook:
FFTW/cuFFT/MKL use **four-step / six-step** algorithms that recast a large 1-D
FFT as a 2-D array of small FFTs plus a transpose — deliberately converting a
strided 1-D problem into blocked 2-D work with an explicit, cache-blocked
transpose, exactly the way §2.3 converts a strided GEMM operand into a packed
buffer. **Same disease, same cure.** FFTW additionally auto-tunes at runtime
(the "plan"/"wisdom" mechanism), which is the FFT's answer to the parameter
search of Goto §6.

Numerical note worth stating because it inverts the usual expectation: the FFT
is **more accurate** than the direct DFT. Error grows like `O(u log n)` for the
FFT versus `O(u n)` for the direct sum, because the FFT's `log n` stages each
commit `O(u)` error where the direct sum accumulates `n` of them. **The fast
algorithm is also the accurate one.** (Confirmed by measurement — §6.1
verification in §9.7 shows relative error `2.9e−15` at `n=16` rising only to
`9.2e−13` at `n=4096` between the two, with the FFT the better-behaved of the
pair.) Contrast Strassen (§2.8), where the fast algorithm is the *less* accurate
one — the two together make the point that "fast" and "accurate" are
independent axes.

## 6.2 Numerical integration and ODE solvers

Enough to support the robotics/simulation material; that file owns the details.

### Quadrature, in one table

| Rule | Error | Note |
|---|---|---|
| Trapezoid | `O(h²)` | Spectrally accurate on **periodic** integrands — worth knowing |
| Simpson | `O(h⁴)` | Newton–Cotes; degrades for high order (Runge) |
| Gauss–Legendre, `n` points | exact for degree `2n−1` | Optimal node placement; nodes are eigenvalues of a symmetric tridiagonal matrix — **another eigenproblem in disguise** |
| Clenshaw–Curtis | near-Gauss | Nodes are Chebyshev points; **computable by FFT** |
| Adaptive (`quad`) | user tolerance | Subdivide where the local error estimate is large |
| Monte Carlo | `O(N^(−1/2))` | Rate **independent of dimension** — the only option above ~10-D |

The Monte Carlo row is the one to dwell on: `O(N^(−1/2))` is terrible in 1-D and
unbeatable in 100-D, because every grid-based rule has a cost that is exponential
in the dimension. That is the curse of dimensionality stated as a crossover.

### ODE solvers

Solve `y' = f(t, y)`, `y(t₀) = y₀`.

```
Forward (explicit) Euler   y_{n+1} = y_n + h f(t_n, y_n)
                           local truncation error O(h^2), global O(h)
                           1 function evaluation per step

RK4                        k1 = f(t_n, y_n)
                           k2 = f(t_n + h/2, y_n + h k1/2)
                           k3 = f(t_n + h/2, y_n + h k2/2)
                           k4 = f(t_n + h,   y_n + h k3)
                           y_{n+1} = y_n + (h/6)(k1 + 2k2 + 2k3 + k4)
                           global error O(h^4), 4 evaluations per step

Backward (implicit) Euler  y_{n+1} = y_n + h f(t_{n+1}, y_{n+1})
                           global O(h), and y_{n+1} appears on BOTH sides
                           -> solve a NONLINEAR SYSTEM each step
```

**Adaptive step size** is what production integrators actually do: embedded
Runge–Kutta pairs (RK45 / Dormand–Prince, `ode45`, `dopri5`) compute two
solutions of different order from the *same* function evaluations, use the
difference as a local error estimate, and adjust `h`. Cost: essentially free
error control.

### Stiffness, and why it forces a linear solve

A system is **stiff** when it contains dynamics on wildly separated timescales —
formally, when the Jacobian `∂f/∂y` has eigenvalues whose magnitudes differ by
orders of magnitude.

The problem: for an explicit method, the step size is limited by **stability**,
not accuracy. Forward Euler on `y' = λy` is stable only for `|1 + hλ| < 1`, i.e.
`h < 2/|λ|` for real negative `λ`. **The fastest-decaying mode dictates `h` even
after it has decayed to nothing.** You take a million tiny steps to track
nothing.

Implicit methods fix this. Backward Euler on `y' = λy` gives
`y_{n+1} = y_n/(1 − hλ)`, which is stable for **all** `h > 0` when
`Re(λ) < 0` — **A-stable**. You choose `h` for accuracy alone.

**And here is why this section is in a linear algebra file.** Each implicit step
requires solving a nonlinear system, done by Newton:

```
   solve   G(y_{n+1}) = y_{n+1} - y_n - h f(t_{n+1}, y_{n+1}) = 0

   Newton step:   ( I - h * df/dy ) * delta  =  -G(y_k)
                   ^^^^^^^^^^^^^^^
                   a linear system, solved by LU (dense) or Krylov (sparse),
                   EVERY Newton iteration of EVERY time step
```

> **Stiff integration is a linear-solve benchmark wearing an ODE costume.** The
> cost of `ode15s`/CVODE/IDA is dominated by factorizing `I − h·J` — which puts
> §3.1, §4.1 and §5.7 directly on the critical path of every robotics simulator,
> circuit simulator, and chemical kinetics code. Production integrators go to
> great lengths to *reuse* a factorization across several steps (holding `h` and
> `J` fixed until convergence degrades) for exactly the "factor once, solve many"
> reason in §3.1.

Practical solvers: **BDF** (Gear; `ode15s`, CVODE) for stiff problems;
**implicit Runge–Kutta / Radau** for high-order stiff; **symplectic
integrators** (velocity Verlet, leapfrog) for Hamiltonian systems where you care
about long-term energy conservation more than local accuracy — which is why
molecular dynamics and orbital mechanics use a *second-order* method in
preference to RK4.

## 6.3 Automatic differentiation: forward vs reverse

AD is neither symbolic differentiation nor finite differences. It applies the
chain rule to the actual computational graph, giving derivatives **exact to
machine precision** (no truncation error, unlike finite differences) at a bounded
multiple of the cost of the function.

For `f : ℝⁿ → ℝᵐ` with Jacobian `J` (m×n):

### Forward mode

Propagate a *directional derivative* forward alongside the value. Carry dual
numbers `(v, v̇)`; each operation updates both.

```
   One forward sweep computes  J v   for a chosen seed v      (a Jacobian-vector product, JVP)
   Cost per sweep :  ~2-3x the cost of evaluating f
   To get the full Jacobian: n sweeps (one per input)
   Memory: O(1) extra -- nothing is stored
```

### Reverse mode

Evaluate `f` forward, recording the graph (the "tape"). Then propagate
*adjoints* `∂output/∂intermediate` backwards.

```
   One reverse sweep computes  J^T u  for a chosen seed u     (a vector-Jacobian product, VJP)
   Cost per sweep :  ~3-4x the cost of evaluating f
   To get the full Jacobian: m sweeps (one per output)
   Memory: O(size of the tape) -- EVERY intermediate must be kept
```

### The rule, and why reverse mode is backprop

```
   Full Jacobian by forward mode :  n sweeps   ->  cheap when  n << m
   Full Jacobian by reverse mode :  m sweeps   ->  cheap when  m << n
```

For a scalar loss, `m = 1`:

> **Reverse mode computes the gradient of a scalar function of `n` variables in
> `O(1)` function evaluations — independent of `n`.** The "cheap gradient
> principle"; the constant is ≤ 4 or 5 (Baur–Strassen 1983; Griewank &
> Walther, *Evaluating Derivatives*, 2nd ed., 2008).

A neural network is `f : ℝ^(billions) → ℝ¹`. Forward mode would need a billion
sweeps. Reverse mode needs one. **Backpropagation is reverse-mode AD applied to
a scalar loss — not a separate algorithm, and not an invention of the deep
learning community** (Linnainmaa 1970; Speelpenning 1980; Werbos 1974; the ML
naming dates from Rumelhart, Hinton & Williams 1986).

### The trade, stated as engineering

**Reverse mode buys `O(n)` compute with `O(tape)` memory.** That is the entire
reason activation memory dominates training-time memory (see
`ai-systems-distributed-training.md` §1.5–1.6), and the reason **gradient
checkpointing / rematerialisation** exists: store a subset of the tape, recompute
the rest during the backward pass. The canonical result — `O(sqrt(L))` memory for
`O(1)` extra forward passes on an `L`-layer chain — is a pure
time/memory-hierarchy trade, and it is the same shape of decision as everything
in §1: **spend flops to avoid bytes.**

Two more items worth naming so the sibling file can pick them up:

- **Hessian-vector products** need no Hessian: `Hv = ∇(∇f · v)`, i.e. forward
  over reverse, at ~4× a gradient. This is what makes Newton-type and
  second-order optimisers (Hessian-free, K-FAC, Shampoo) tractable at all, and
  it connects straight to §5.5 — those methods run **CG using only
  Hessian-vector products**, never forming `H`. The "get the effect without the
  matrix" pattern, for the fourth time in this file.
- **Checkpointing, mixed precision and the tape interact.** The tape is stored in
  low precision while the master weights are fp32 — which is §4.5's structure
  once more.

`numpy-pytorch-internals.md` owns the implementation (tape representation,
`autograd.Function`, the dispatcher, custom kernels). This file owns the *why*:
**the mode you want is decided by the shape of the Jacobian, and nothing else.**

---

# 7. Curriculum: four units

**Positioning.** These sit **after** the algorithms and memory-hierarchy
material (the learner must already know what a cache is, what a cache line
costs, and what the roofline model says) and **before** the CUDA/kernel units
(which then arrive as "here is how to do §2 on this specific machine" rather
than as an unmotivated optimisation exercise).

The dependency edge that matters most: **Unit N2 must precede the CUDA
threadblock/warp/thread tiling unit**, because that unit is Unit N2's structure
with different words (§2.7). Teaching them in the other order is what produced
the cargo cult in the first place.

Prerequisites assumed from sibling tracks: IEEE-754 and unit roundoff
(`numbers-text-numerics.md`); cache hierarchy, cache lines, TLB, prefetching
(`cpu-architectures.md`); the roofline model and the three limiters
(`cuda-programming-tuning.md` §8). None of these are re-taught here.

---

### Unit N1 — Why GEMM: the arithmetic intensity of the BLAS

- **Concept.** The three BLAS levels and their operand shapes. Flops, compulsory
  bytes and arithmetic intensity for `axpy`, `dot`, `gemv`, `gemm`, computed
  from scratch. Level 1 and 2 have intensity that is *constant in `n`*; level 3
  has intensity `n/12`. Evaluate each against the machine's ridge point and read
  off the ceiling: on an H100 in BF16 a perfect `axpy` tops out at 0.03% of
  peak, and that is not a bug. The Hong–Kung `Ω(n³/√M)` lower bound and its
  consequence, `I ≈ 2√M` — the fact that achievable intensity is set by cache
  size, not problem size, and that on-chip SRAM is sized to hit the ridge point.
  Then the historical payoff: LINPACK (level-1) → LAPACK (level-3), the level-3
  fraction, and the observation that the *same mathematics* got 10× faster by
  changing loop shape alone. Close by naming the consequence: every algorithm in
  the rest of the track has been rewritten to call GEMM, which is why the track
  optimises GEMM.
- **Prerequisites.** Cache hierarchy; roofline; IEEE-754 basics.
- **Exercises.** §8.1 (compute and assert intensities), §8.2 optionally as a
  measurement warm-up.
- **The one idea.** ***Level 3 is the only BLAS level whose arithmetic intensity
  grows with the problem size, and therefore the only one that can ever reach
  peak. That is not a fact about matrix multiplication — it is the reason every
  numerical algorithm in existence was rewritten to be expressed in terms of
  it.***

---

### Unit N2 — GEMM as a memory-hierarchy program

- **Concept.** The reference definition, and why `α`/`β` exist (β=0 licences not
  reading C; β=1 is what makes blocked algorithms possible without paying
  level-1 traffic). Then Goto's analysis as *engineering*: the GEBP cost model
  `2 mc kc n / (mc kc + (2mc+kc) n)`, maximising `2 mc kc/(2mc+kc)`, `mc = kc`
  from the area-vs-perimeter argument, and the quotable conclusion — "if
  `mc = kc ≈ n/100` then even if memops are 10 times slower than flops, the
  memops add only about 10% overhead". The TLB as the *real* constraint, and why
  prefetching can mask a cache miss but not a TLB miss. Packing, and the
  amortisation argument that makes it free (`O(n)` uses per copied item). Register
  blocking: half the registers hold the `mr × nr` block of C, `mr ≈ nr`, and
  `nr ≥ R_comp/(2 R_load)` — the roofline evaluated at the register file. Then
  the BLIS five-loop nest and the residency table: **one loop per level of the
  memory hierarchy.** Finally the GPU mapping — threadblock/warp/thread tile as
  a renaming of `ic`/`jr`/`mr×nr`, shared memory as packing, double buffering as
  software prefetch — and the honest measurement showing that most of the win at
  moderate sizes is loop order, and cache blocking only pays once the working
  set exceeds cache. Close with Strassen: one level saves 1/8 of the
  multiplications and pays for it in `O(n²)` level-1 additions, hence a crossover
  at n≈2000 (n≈500 when fused into the packing); and the galactic algorithms,
  which are never used because the exponent was never the binding constraint.
- **Prerequisites.** Unit N1. Cache lines, TLB, prefetching, registers.
- **Exercises.** §8.2 (naive vs blocked, find your machine's crossover).
- **The one idea.** ***A fast GEMM is not an arithmetic algorithm, it is a
  data-movement schedule. The five loops exist so that every level of the memory
  hierarchy gets a block it can hold, and the micro-kernel is the only place
  arithmetic actually happens. Once you see that, the CUDA tiling hierarchy is
  the same program with the memory levels renamed.***

---

### Unit N3 — The decompositions, and why the algorithm decides your accuracy

- **Concept.** LU with partial pivoting (`(2/3)n³`), and pivoting as a bound on
  the growth factor rather than a patch for zero pivots — with the
  well-conditioned `[[1e-20, 1],[1, 1]]` example that goes wrong without it, and
  the honest note that the universally deployed algorithm has the `2^(n−1)`
  bound nobody has closed. Cholesky (`(1/3)n³`): three independent reasons for
  the factor of two, unconditional stability, and the fact that it is its own
  positive-definiteness test. QR three ways, and the Gram–Schmidt cautionary
  tale as the centrepiece — CGS and MGS are algebraically identical and differ
  only in loop order, yet lose orthogonality like `uκ²` and `uκ`; measure it,
  check it against the theory (it agrees to a factor of 2), and note that
  Householder is `u` regardless of `κ`. Then the four corollaries: LAPACK uses
  Householder; CGS2 exists because CGS is level-2 and MGS is level-1 (the §1
  argument appearing inside a stability decision); MGS's `R` is fine even though
  its `Q` is not; and CholeskyQR/CholeskyQR2 is the same lesson on modern GPUs.
  Eigendecomposition and the QR algorithm in outline: reduce-then-iterate,
  `RQ + μI = QᵀHQ` so eigenvalues are exactly preserved, shifts for cubic
  convergence, and the sharp asymmetry between symmetric (eigenvalues perfectly
  conditioned) and non-symmetric (arbitrarily ill-conditioned) problems. Then the
  SVD: geometry first (every linear map is rotate–stretch–rotate; the image of
  the sphere is an ellipsoid), everything you can read off it, `σ_n` as the
  literal distance to singularity, and Eckart–Young — the closed-form solution to
  a non-convex problem, with the error known in advance as `σ_{k+1}` — applied to
  pseudo-inverse, PCA (via SVD of `X`, **never** eigendecomposition of `XᵀX`),
  low-rank weight compression, and LoRA.
- **Prerequisites.** Unit N1 (for the level-3 fraction and the CGS2 argument);
  IEEE-754 and unit roundoff.
- **Exercises.** §8.3 (CGS vs MGS on Hilbert — the flagship).
- **The one idea.** ***Two algorithms that compute the same thing in exact
  arithmetic can differ by a factor of κ in the accuracy they deliver. Choosing a
  decomposition is not choosing a formula, it is choosing an error bound — and
  the choice is often forced by which level of BLAS the algorithm can be written
  in.***

---

### Unit N4 — Conditioning, sparsity, and the methods that survive them

- **Concept.** `κ(A) = ‖A‖‖A⁻¹‖ = σ₁/σ_n`, read as "how big A is divided by how
  close it is to being singular". The rule of thumb — you start with 16 digits
  and lose `log₁₀κ` — checked against measurement across seven orders of
  magnitude of κ. `forward error ≲ condition number × backward error` as the
  equation that partitions blame: backward error is the algorithm's fault, κ is
  the problem's, and the residual is the one you can actually compute. Then the
  three applied lessons: **never invert to solve** (3× the work, not backward
  stable, destroys sparsity — with the measured 12-orders-of-magnitude residual
  gap); **least squares three ways**, with `κ(AᵀA) = κ(A)²` derived in one line
  from the SVD, the failure of Cholesky above `κ ≈ 10⁸`, and the observation that
  "PCA from the covariance matrix" is the same mistake in different clothes; and
  **mixed-precision iterative refinement** — factor in low precision, correct in
  high, with Carson & Higham's κ ≤ 10⁴ / 10⁸ thresholds — flagged explicitly as
  the direct ancestor of fp16/bf16 training with an fp32 master copy, because the
  `O(n³)`-vs-`O(n²)` separation that makes the correction free is the *same*
  separation that made GEMM special in Unit N1. Then sparsity: SpMV's intensity
  is `1/6`, *worse than dense gemv*, so sparsity does not buy you compute — it
  only lets you avoid touching data. COO/CSR/CSC/ELL/DIA/BSR/HYB as bets about
  the sparsity pattern; SpMV as the canonical irregular kernel and the exact
  inverse of GEMM in every property. Jacobi vs Gauss–Seidel as a
  parallelism lesson. CG: the Krylov idea, SPD requirement, short recurrence,
  `sqrt(κ)` rate, and finite termination in the number of *distinct* eigenvalues
  — measured, and used to motivate preconditioning as spectrum-shaping. GMRES and
  why losing symmetry costs you the short recurrence. Preconditioning as the
  thing that actually decides success, and the systems trade that a weak
  parallel preconditioner beats a strong sequential one. Multigrid in outline
  (`O(n)`, mesh-independent). Randomised SVD, and why it wins: every expensive
  step is a GEMM and there are only two passes — Unit N1's argument, applied at
  the level of algorithm selection.
- **Prerequisites.** Units N1 and N3.
- **Exercises.** §8.4 (inversion vs LU), §8.5 (CG), §8.6 (FFT) as a coda.
- **The one idea.** ***Sparsity destroys arithmetic intensity, so you cannot
  compute your way out of a sparse problem — the only lever is reducing how many
  times you touch the matrix. Preconditioning, Krylov methods, multigrid and
  randomisation are four names for pulling that one lever.***

---

### Where the §6 material attaches

Not units of their own; hand-offs.

| Material | Attach to | Note |
|---|---|---|
| FFT (Cooley–Tukey, convolution, the awkward access pattern) | End of Unit N2, or `signals-and-dsp.md` | Best taught *after* N2, because the four-step FFT is §2.3's packing trick again |
| Quadrature, RK4, stiffness, implicit methods | Robotics/simulation track | Needs Unit N3 first: an implicit step *is* a linear solve |
| Forward vs reverse AD | `numpy-pytorch-internals.md` | This file supplies only the rule — the mode is decided by the Jacobian's shape |
| Hessian-vector products + CG | Optional extension to Unit N4 | Ties second-order optimisers to §5.5 |

---

# 8. Machine-checkable exercises (Compiler Explorer)

All six compile and **run** as single-file C++17 with no dependencies beyond
`<vector>`, `<cmath>`, `<cstdio>`, `<chrono>`, `<complex>`. Every one was
compiled and executed on this machine before being written down; the numbers in
§9 are the actual output.

**Two ground rules for the timing-based ones (§8.1, §8.2):**

- Use `-O2`, not `-O3 -march=native` — see the §2.6 caveat and §10.
- Take the **minimum** of several runs, never the mean. In a shared sandbox the
  distribution is right-skewed by scheduler noise; the minimum is the closest
  estimate of the machine's actual capability.
- Assert on **ratios**, never absolute GFLOP/s. Ratios survive a change of
  machine; absolute numbers do not.

The four deterministic exercises (§8.3–§8.6) have **no timing at all** and will
reproduce bit-for-bit on any IEEE-754 double machine. Prefer them when you want
a check that cannot flake.

---

### §8.1 — Compute and assert arithmetic intensity (Unit N1)

**Task.** Write `intensity(flops, bytes)` and a function per kernel returning its
compulsory flop and byte counts for fp64. Assert the analytic values; then
measure achieved GFLOP/s and GB/s and assert the qualitative conclusion.

**Deterministic asserts (cannot flake):**

```c++
assert(near(ai_axpy(n),        2.0*n / (24.0*n),            1e-12));  // 1/12
assert(near(ai_dot (n),        2.0*n / (16.0*n),            1e-12));  // 1/8
assert(near(ai_gemv(n),        2.0*n*n / (8.0*n*n),         1e-12));  // 1/4
assert(near(ai_gemm(n),        2.0*n*n*n / (24.0*n*n),      1e-12));  // n/12

// the structural claims, which are the point of the exercise
assert(ai_axpy(100) == ai_axpy(100000));       // level 1: CONSTANT in n
assert(ai_gemv(100) == ai_gemv(100000));       // level 2: CONSTANT in n
assert(ai_gemm(100000) > 1000.0 * ai_gemm(100));  // level 3: GROWS

// the ridge-point conclusion, with the H100 BF16 number from the sibling file
const double RIDGE = 989.5e12 / 3.35e12;                 // = 295.4 FLOP/byte
assert(ai_axpy(1<<20) < RIDGE / 1000.0);                 // >1000x short of the ridge
assert(ai_gemv(1<<20) < RIDGE / 1000.0);
assert(ai_gemm(4096)  > RIDGE);                          // gemm crosses it
```

**Measured assert (robust — verified margin ≈ 90×, threshold set at 3×):**

```c++
// gemm achieves a much higher flop RATE than the memory-bound kernels,
// even with a naive tiled kernel and no SIMD.
assert(gflops_gemm > 1.3 * gflops_axpy);
// axpy is at the DRAM ceiling: its GB/s must exceed its GFLOP/s by ~12x,
// which is just I = 1/12 restated -- a self-consistency check on the harness.
assert(gbs_axpy / gflops_axpy > 10.0 && gbs_axpy / gflops_axpy < 14.0);
```

**Discussion prompt** (the actual learning): *"You measured `axpy` at 86 GB/s and
7.2 GFLOP/s on a machine whose peak is far higher. Is this kernel slow? What
would you change to make it faster?"* The answer — nothing, it is finished — is
the unit.

---

### §8.2 — Naive vs blocked GEMM, and find the crossover (Unit N2)

**Task.** Implement three variants of `C = AB` (row-major, fp64): `ijk` naive,
`ikj` loop-interchanged, and `ikj` with square cache tiles. Verify all three
agree; time them; assert the speedup.

**Asserts:**

```c++
// correctness first, and it is EXACT: all three accumulate over k in the same
// order, so they perform the identical sequence of FP operations.
assert(max_abs_diff(C_naive, C_blocked) == 0.0);

// the robust speedup assert -- measured 7.8x at N=768, threshold at 3x
assert(t_naive / t_blocked > 3.0);
assert(t_naive / t_ikj     > 3.0);
```

**Sizing for a sandbox.** `N = 768` runs in ~2 s wall with 3 repetitions each
(measured). `N = 512` runs in ~0.5 s if the sandbox is tight. Do **not** put
`naive_ijk` at `N = 2048` — it takes 20 s.

**The second half of the exercise, which is the important half.** Run *only*
`ikj` and `blocked` at increasing `N` and find where blocking starts to win.
Measured on this machine:

```
   N=768   ikj 14.59 GF/s   blocked 16.08 GF/s   blocked/ikj = 1.10
   N=1024  ikj 14.79 GF/s   blocked 10.67 GF/s   blocked/ikj = 0.72   <- blocking LOSES
   N=1600  ikj 13.36 GF/s   blocked 17.10 GF/s   blocked/ikj = 1.28
   N=2048  ikj  6.47 GF/s   blocked  9.60 GF/s   blocked/ikj = 1.48
```

**Do not assert on this ratio.** It is genuinely machine-dependent — a server
with a 100 MB L3 will not show a win until much larger `N`, and the direction can
invert. Have the student *report* the crossover and explain it from their
machine's cache sizes. `N=1600` (61 MB working set) took 1.3 s wall here and is
the safest single size if you want a soft check; use `assert(ratio > 0.9)` at
most, or no assert and a printed table.

**Prompt.** *"Your blocked version is slower than the plain loop at N=1024 and
faster at N=2048. Explain, using one number from your machine's spec sheet."*

---

### §8.3 — Classical vs modified Gram–Schmidt (Unit N3) — **the flagship**

**Task.** Implement CGS and MGS (they differ by two lines). Run both on the
Hilbert matrix `H_ij = 1/(i+j−1)`. Measure `‖QᵀQ − I‖_F`.

**Why this is the best exercise in the set:** fully deterministic, no timing, ~40
lines, reproduces on any IEEE-754 machine, and the measured result matches the
theoretical bound to within a factor of 2–6.

**Asserts at `n = 8`** (measured: CGS `1.438`, MGS `7.338e−7` — margins of 14×
and 137× against the thresholds below):

```c++
double e_cgs = orth_error(cgs(hilbert(8), 8), 8);
double e_mgs = orth_error(mgs(hilbert(8), 8), 8);

assert(e_mgs < 1e-4);          // MGS retains usable orthogonality
assert(e_cgs > 0.1);           // CGS has lost it COMPLETELY
assert(e_cgs / e_mgs > 1e4);   // orders of magnitude -- measured 1.96e6

// and the theory, checked directly: MGS error tracks u * kappa
const double u = 1.11e-16, kappa8 = 1.5258e10;   // kappa2(H_8), independently verified
assert(e_mgs < 10.0 * u * kappa8);               // predicted 1.7e-6, measured 7.3e-7
assert(e_mgs > 0.01 * u * kappa8);               // the bound is TIGHT, not just valid
```

That last pair is the one to dwell on: the bound is asserted from *both sides*.
Students almost never see an error bound tight enough to bracket.

**Compile with `-ffp-contract=off`.** FMA contraction changes the last bits; the
orders-of-magnitude conclusion survives either way but the exact digits do not.

**Add a third column for the punchline.** Have them also implement Householder QR
and assert `e_house < 1e-13` at `n = 12`, where MGS is already at `0.44` and CGS
at `5.48`. Three algorithms, one problem, three error regimes: `u`, `uκ`, `uκ²`.

**Extension worth setting.** Implement CGS2 (CGS with one reorthogonalisation
pass) and assert it recovers `< 1e-13`. Then ask which of CGS2 and MGS is
*faster* on a wide matrix, and why. The answer (CGS2, because it is level-2 BLAS
at 2× the flops while MGS is level-1 at 1×) is Unit N1 arriving inside a
stability decision, and it is the moment the two halves of the course connect.

---

### §8.4 — Inversion vs LU on an ill-conditioned system (Unit N4)

**Task.** Implement LU with partial pivoting and triangular substitution. Solve
`Hx = b` (`H` Hilbert, `b` chosen so `x = (1,…,1)ᵀ`) two ways: (a) forward/back
substitution, (b) form `H⁻¹` explicitly from the *same* factorization, then
multiply. Compare relative residuals and forward errors.

**Asserts at `n = 12`** (measured: `res_LU = 2.195e−16`, `res_INV = 1.583e−4`):

```c++
// backward stability: the residual is O(u) NO MATTER how bad kappa is
assert(res_LU < 1e-14);

// inversion is NOT backward stable
assert(res_INV > 1e-6);
assert(res_INV / res_LU > 1e8);      // measured ratio: 7.2e11

// and the rule of thumb, over the whole sweep
for (n = 6; n <= 12; n += 2)
    assert(ferr_LU[n] < 100.0 * kappa_inf[n] * 1.11e-16);   // measured within ~10x
```

**Implementation warning — I hit this bug myself and it is instructive.** The
row interchanges must be applied to `b` **completely, in sequence, before**
forward substitution (LAPACK's `dlaswp` then `dtrsm`). Interleaving the swap with
the elimination step — which looks correct, and which many textbook
presentations appear to license — is **wrong**, because the multipliers stored in
`L` below column `k` are themselves permuted by *later* swaps. Symptom: a solve
that returns plausible-looking garbage on any matrix that actually pivots, while
passing on matrices that do not. Set it as a deliberate trap, or supply the
correct `lusolve` and have them find it with a `PA = LU` reconstruction check:

```c++
assert(max_abs(reconstruct_LU(M, piv) - apply_perm(A, piv)) < 1e-12);
```

**Prompt.** *"Both routes used the identical LU factorization. Where did the
extra twelve orders of magnitude of residual come from?"*

---

### §8.5 — Conjugate gradient, finite termination (Unit N4)

**Task.** Implement CG for the 1-D Laplacian (`tridiag(−1, 2, −1)`, `n = 20`) as
a matrix-free operator. Assert convergence in at most `n` iterations.

**Asserts** (measured: 20 iterations, true residual `1.110e−15`):

```c++
assert(iterations <= n);                       // finite termination
assert(true_residual_inf < 1e-12);             // recomputed b - Ax, not the recursive r

// the symmetric right-hand side: only 10 distinct eigenvalues are represented
// (measured: 10 iterations, residual EXACTLY 0.0)
assert(iterations_with_b_all_ones <= n / 2);
```

**Recompute the true residual at the end.** The recursively updated `r` drifts
from `b − Ax` in floating point; asserting on the recursive one hides real bugs.

**The two teaching moments, both visible in the output:**

1. The residual is **non-monotonic** — iteration 17 is worse than 16 (`5.98e−2`
   vs `4.76e−2`). CG minimises `‖e‖_A`, not `‖r‖₂`. Ask what happens if you add
   "stop when the residual increases".
2. `b = (1,…,1)ᵀ` converges in **10** iterations, not 20, and to *exactly* zero.
   Ask why. The answer — grid symmetry means only 10 distinct eigenvalues appear
   in `b`, and CG terminates in the number of distinct eigenvalues — is the
   entire motivation for preconditioning, discovered by the student rather than
   asserted by the lecturer. **This is the best moment in the exercise set.**

**Extension.** Add Jacobi preconditioning (trivial: divide by the diagonal — for
this matrix it does nothing, which is itself the lesson) and then a
variable-coefficient Laplacian where it does help. Count iterations.

---

### §8.6 — Radix-2 FFT against a DFT reference (Unit N4 coda)

**Task.** Implement the `O(n²)` DFT directly, and an iterative in-place radix-2
decimation-in-time FFT with bit-reversal. Assert agreement.

**Asserts** (measured: rel. error `2.9e−15` at n=16, `9.2e−13` at n=4096;
speedup 1461× at n=4096):

```c++
for (int lg = 2; lg <= 12; lg++) {
    int n = 1 << lg;
    auto x = pseudorandom_complex(n);          // fixed LCG seed -- deterministic
    assert(rel_error(dft(x), fft(x)) < 1e-10);
}
// n log n really is faster (only assert at a size where it is unambiguous)
assert(t_dft_4096 / t_fft_4096 > 50.0);        // measured 1461x
```

**The point worth making, which inverts the usual expectation:** the FFT is not
merely faster, it is **more accurate**. Error grows as `O(u log n)` for the FFT
against `O(u n)` for the direct sum. Contrast Strassen (§2.8), where the fast
algorithm is the *less* accurate one. **Fast and accurate are independent axes,
and the exercise shows both signs of the correlation within one course.**

**Extension.** Implement convolution both ways (direct `O(n²)` and via
`ifft(fft(a)·fft(b))` with zero-padding to `≥ 2n`), assert agreement, and time
them. The zero-padding requirement — circular vs linear convolution — is the bug
everybody writes once.

---

### Coverage against the units

| Exercise | Unit | Deterministic? | Measured margin vs threshold |
|---|---|---|---|
| §8.1 intensity | N1 | analytic parts yes; measured part no | ~90× on the flop-rate assert |
| §8.2 blocked GEMM | N2 | no (timing) | 7.8× measured vs 3× threshold |
| §8.3 CGS vs MGS | N3 | **yes** | 14× / 137× / 196× |
| §8.4 inversion vs LU | N4 | **yes** | 7.2e11 vs 1e8 threshold |
| §8.5 CG | N4 | **yes** | exact (20 ≤ 20; residual 1.1e−15) |
| §8.6 FFT | N4 | **yes** (deterministic seed) | 1e−13 vs 1e−10; 1461× vs 50× |

Four of six are fully deterministic. If the sandbox is unreliable, §8.3, §8.4,
§8.5 and §8.6 alone still cover Units N3 and N4 completely and carry the two
best ideas in the file (the Gram–Schmidt tale and the finite-termination
surprise).

---

# 9. The verified programs

Every program below was compiled and executed on this machine before the
corresponding number was written into this file. Environment:

```
Apple clang version 21.0.0 (clang-2100.3.33.1)
Target: arm64-apple-darwin27.0.0   (Apple silicon, single-threaded)
fp64 throughout;  u = 2^-53 = 1.11e-16
```

They are written to port to Compiler Explorer unchanged (C++17, no
dependencies). **They are reference implementations for checking the
exercise thresholds, not the exercises themselves** — for teaching, hand the
student the skeleton and let them write the algorithm.

## 9.1 Arithmetic intensity of the three levels (§1.6, §8.1)

Compile: `clang++ -O3 -ffast-math -o intensity intensity.cpp`

```cpp
#include <cstdio>
#include <cmath>
#include <chrono>
#include <vector>
using namespace std; using namespace std::chrono;
template<class F> double T(F f,int r=5){ double best=1e30;
 for(int i=0;i<r;i++){ auto a=high_resolution_clock::now(); f();
  auto b=high_resolution_clock::now(); best=min(best,duration_cast<duration<double>>(b-a).count()); }
 return best; }
int main(){
 const size_t NV=1u<<24;                      // 16.8M doubles per vector = 134 MB each
 vector<double> x(NV,1.0), y(NV,2.0);
 double t1=T([&]{ for(size_t i=0;i<NV;i++) y[i]=2.5*x[i]+y[i]; },3);
 const int n=4000;                            // A is 128 MB
 vector<double> A((size_t)n*n), v(n,1.0), w(n,0.0);
 for(size_t i=0;i<A.size();i++) A[i]=1.0/(1.0+(i%97));
 double t2=T([&]{ for(int i=0;i<n;i++){ double s0=0,s1=0,s2=0,s3=0;
   const double*a=&A[(size_t)i*n];
   for(int j=0;j<n;j+=4){ s0+=a[j]*v[j]; s1+=a[j+1]*v[j+1]; s2+=a[j+2]*v[j+2]; s3+=a[j+3]*v[j+3]; }
   w[i]+=(s0+s1)+(s2+s3); } },3);
 const int m=1024; vector<double> P((size_t)m*m,1.0),Q((size_t)m*m,1.0),R((size_t)m*m,0.0);
 double t3=T([&]{ for(int ii=0;ii<m;ii+=64) for(int kk=0;kk<m;kk+=64) for(int jj=0;jj<m;jj+=64)
   for(int i=ii;i<ii+64;i++) for(int k=kk;k<kk+64;k++){ double a=P[(size_t)i*m+k];
    for(int j=jj;j<jj+64;j++) R[(size_t)i*m+j]+=a*Q[(size_t)k*m+j]; } },2);
 double f1=2.0*NV,        b1=3.0*NV*8;
 double f2=2.0*(double)n*n, b2=((double)n*n+2.0*n)*8;
 double f3=2.0*(double)m*m*m, b3=3.0*(double)m*m*8;
 printf("%-6s %10s %10s %10s %10s %10s\n","kernel","FLOPs","bytes","AI(F/B)","GFLOP/s","GB/s");
 printf("%-6s %10.2e %10.2e %10.4f %10.2f %10.2f\n","axpy",f1,b1,f1/b1,f1/t1/1e9,b1/t1/1e9);
 printf("%-6s %10.2e %10.2e %10.4f %10.2f %10.2f\n","gemv",f2,b2,f2/b2,f2/t2/1e9,b2/t2/1e9);
 printf("%-6s %10.2e %10.2e %10.4f %10.2f %10.2f\n","gemm",f3,b3,f3/b3,f3/t3/1e9,b3/t3/1e9);
}
```

Output (`-O3 -ffast-math`):

```
kernel      FLOPs      bytes    AI(F/B)    GFLOP/s       GB/s
axpy     3.36e+07   4.03e+08     0.0833       7.23      86.72
gemv     3.20e+07   1.28e+08     0.2499      11.48      45.93
gemm     2.15e+09   2.52e+07    85.3333      16.90       0.20
```

Output (`-O2`, reduction not vectorised — note `gemv` drops to the *same*
flop rate as `axpy`, which is the headline result of §1 in one line):

```
axpy     3.36e+07   4.03e+08     0.0833       7.33      88.01
gemv     3.20e+07   1.28e+08     0.2499       7.28      29.15
gemm     2.15e+09   2.52e+07    85.3333      15.16       0.18
```

## 9.2 Naive vs loop-interchanged vs blocked GEMM (§2.6, §8.2)

Compile: `clang++ -O2 -o gemm gemm.cpp`. Change `N` to sweep.

```cpp
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <chrono>
#include <vector>
using namespace std;
using namespace std::chrono;
static const int N=768;
static vector<double> A(N*N),B(N*N),C1(N*N),C2(N*N),C3(N*N);

// ijk: C[i][j] += A[i][k]*B[k][j]  (row-major). B accessed with stride N -> the bad one.
static void naive_ijk(){ for(int i=0;i<N;i++) for(int j=0;j<N;j++){ double s=0;
  for(int k=0;k<N;k++) s+=A[i*N+k]*B[k*N+j]; C1[i*N+j]=s; } }

// ikj: streams B by rows -> loop-order fix alone
static void loop_ikj(){ for(int i=0;i<N;i++) for(int k=0;k<N;k++){ double a=A[i*N+k];
  for(int j=0;j<N;j++) C2[i*N+j]+=a*B[k*N+j]; } }

// blocked ikj with cache tiles
template<int BS> static void blocked(){
 for(int ii=0;ii<N;ii+=BS) for(int kk=0;kk<N;kk+=BS) for(int jj=0;jj<N;jj+=BS)
  for(int i=ii;i<ii+BS;i++) for(int k=kk;k<kk+BS;k++){ double a=A[i*N+k];
   for(int j=jj;j<jj+BS;j++) C3[i*N+j]+=a*B[k*N+j]; } }

template<class F> double timeit(F f,int reps=3){ double best=1e30;
 for(int r=0;r<reps;r++){ auto t0=high_resolution_clock::now(); f();
  auto t1=high_resolution_clock::now();
  double s=duration_cast<duration<double>>(t1-t0).count(); if(s<best)best=s; } return best; }

int main(){
 srand(1); for(int i=0;i<N*N;i++){A[i]=rand()/(double)RAND_MAX;B[i]=rand()/(double)RAND_MAX;}
 double flops=2.0*N*N*N;
 double t1=timeit([]{naive_ijk();});
 double t2=timeit([]{fill(C2.begin(),C2.end(),0.0);loop_ikj();});
 double t3=timeit([]{fill(C3.begin(),C3.end(),0.0);blocked<64>();});
 double t4=timeit([]{fill(C3.begin(),C3.end(),0.0);blocked<32>();});
 printf("N=%d\n",N);
 printf("naive ijk   %8.4f s  %7.2f GFLOP/s\n",t1,flops/t1/1e9);
 printf("loop  ikj   %8.4f s  %7.2f GFLOP/s  speedup %.2fx\n",t2,flops/t2/1e9,t1/t2);
 printf("blocked 64  %8.4f s  %7.2f GFLOP/s  speedup %.2fx\n",t3,flops/t3/1e9,t1/t3);
 printf("blocked 32  %8.4f s  %7.2f GFLOP/s  speedup %.2fx\n",t4,flops/t4/1e9,t1/t4);
 double e=0; for(int i=0;i<N*N;i++) e=fmax(e,fabs(C1[i]-C3[i]));
 printf("max |C_naive - C_blocked| = %.3e\n",e);
}
```

Outputs at three sizes (minimum of 3 runs each):

```
N=768   naive 0.4418s (2.05 GF/s) | ikj 0.0621s (14.59) 7.12x | blk64 0.0563s (16.08) 7.84x
N=1024  naive 1.1058s (1.94 GF/s) | ikj 0.1452s (14.79) 7.62x | blk64 0.2012s (10.67) 5.50x
N=2048  naive 20.318s (0.85 GF/s) | ikj 2.6544s ( 6.47) 7.65x | blk64 1.7903s ( 9.60) 11.35x
max |C_naive - C_blocked| = 0.000e+00   (at every size -- see §2.6)
```

And the out-of-cache crossover probe (`N=1600`, 61 MB working set, 1.3 s wall):

```cpp
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <chrono>
#include <vector>
using namespace std;
using namespace std::chrono;
static const int N=1600;   // 3*N^2*8 = 61 MB, exceeds any current L3
static vector<double> A(N*N),B(N*N),C(N*N);
static void ikj(){ fill(C.begin(),C.end(),0.0);
 for(int i=0;i<N;i++) for(int k=0;k<N;k++){ double a=A[i*N+k];
  for(int j=0;j<N;j++) C[i*N+j]+=a*B[k*N+j]; } }
static void blocked(int BS){ fill(C.begin(),C.end(),0.0);
 for(int ii=0;ii<N;ii+=BS) for(int kk=0;kk<N;kk+=BS) for(int jj=0;jj<N;jj+=BS)
  for(int i=ii;i<ii+BS;i++) for(int k=kk;k<kk+BS;k++){ double a=A[i*N+k];
   for(int j=jj;j<jj+BS;j++) C[i*N+j]+=a*B[k*N+j]; } }
template<class F> double T(F f){ auto t0=high_resolution_clock::now(); f();
 auto t1=high_resolution_clock::now(); return duration_cast<duration<double>>(t1-t0).count(); }
int main(){ srand(1); for(int i=0;i<N*N;i++){A[i]=rand()/(double)RAND_MAX;B[i]=rand()/(double)RAND_MAX;}
 double f=2.0*N*N*N;
 double a=T([]{ikj();}); double c1=C[0]+C[N*N-1];
 double b=T([]{blocked(64);}); double c2=C[0]+C[N*N-1];
 printf("N=%d  ikj %.3fs (%.2f GF/s)   blocked64 %.3fs (%.2f GF/s)   ratio %.2fx  check %.3e\n",
   N,a,f/a/1e9,b,f/b/1e9,a/b,fabs(c1-c2)); }
```

```
N=1600  ikj 0.613s (13.36 GF/s)   blocked64 0.479s (17.10 GF/s)   ratio 1.28x
```

## 9.3 Classical vs modified Gram-Schmidt (§3.3, §8.3)

Compile: `clang++ -O2 -ffp-contract=off -o gs gs.cpp`

```cpp
#include <cstdio>
#include <cmath>
#include <vector>
using namespace std;
typedef vector<double> V;
// column-major n x m, Hilbert-like: A(i,j) = 1/(i+j+1)
int N=12, M=12;
double& at(V&A,int i,int j){ return A[j*N+i]; }
double dot(const V&A,int c1,const V&B,int c2,int n){ double s=0; for(int i=0;i<n;i++) s+=A[c1*n+i]*B[c2*n+i]; return s; }

double lossOrth(const V&Q){
  // max over i,j of |Q^T Q - I|
  double mx=0;
  for(int i=0;i<M;i++)for(int j=0;j<M;j++){
    double s=dot(Q,i,Q,j,N); if(i==j) s-=1.0;
    mx=max(mx,fabs(s));
  }
  return mx;
}
int main(){
  V A(N*M);
  for(int i=0;i<N;i++)for(int j=0;j<M;j++) at(A,i,j)=1.0/(i+j+1);

  // Classical Gram-Schmidt
  V Qc=A;
  for(int j=0;j<M;j++){
    V v(N); for(int i=0;i<N;i++) v[i]=at(A,i,j);
    // all projections computed against the ORIGINAL a_j
    for(int k=0;k<j;k++){ double r=dot(Qc,k,A,j,N); for(int i=0;i<N;i++) v[i]-=r*Qc[k*N+i]; }
    double nv=0; for(int i=0;i<N;i++) nv+=v[i]*v[i]; nv=sqrt(nv);
    for(int i=0;i<N;i++) Qc[j*N+i]=v[i]/nv;
  }
  // Modified Gram-Schmidt
  V Qm=A;
  for(int j=0;j<M;j++){
    // subtract projections against the RUNNING vector
    for(int k=0;k<j;k++){ double r=dot(Qm,k,Qm,j,N); for(int i=0;i<N;i++) Qm[j*N+i]-=r*Qm[k*N+i]; }
    double nv=0; for(int i=0;i<N;i++) nv+=Qm[j*N+i]*Qm[j*N+i]; nv=sqrt(nv);
    for(int i=0;i<N;i++) Qm[j*N+i]/=nv;
  }
  // Householder QR (reference)
  V R=A; V Qh(N*M,0.0);
  {
    V W; // store reflectors
    V Amat=A; vector<V> vs;
    for(int k=0;k<M;k++){
      V v(N,0.0); double nrm=0;
      for(int i=k;i<N;i++) nrm+=Amat[k*N+i]*Amat[k*N+i]; nrm=sqrt(nrm);
      double alpha = (Amat[k*N+k]>0? -nrm: nrm);
      for(int i=k;i<N;i++) v[i]=Amat[k*N+i];
      v[k]-=alpha;
      double vn=0; for(int i=k;i<N;i++) vn+=v[i]*v[i]; vn=sqrt(vn);
      if(vn>0) for(int i=k;i<N;i++) v[i]/=vn;
      vs.push_back(v);
      for(int j=k;j<M;j++){ double d=0; for(int i=k;i<N;i++) d+=v[i]*Amat[j*N+i];
        for(int i=k;i<N;i++) Amat[j*N+i]-=2*d*v[i]; }
    }
    // form Q = H0 H1 ... applied to identity columns
    for(int j=0;j<M;j++){
      V e(N,0.0); e[j]=1.0;
      for(int k=M-1;k>=0;k--){ const V&v=vs[k]; double d=0; for(int i=0;i<N;i++) d+=v[i]*e[i];
        for(int i=0;i<N;i++) e[i]-=2*d*v[i]; }
      for(int i=0;i<N;i++) Qh[j*N+i]=e[i];
    }
  }
  double lc=lossOrth(Qc), lm=lossOrth(Qm), lh=lossOrth(Qh);
  printf("N=%d M=%d Hilbert-like\n",N,M);
  printf("CGS  loss of orthogonality  ||Q^T Q - I||_max = %.3e\n", lc);
  printf("MGS  loss of orthogonality  ||Q^T Q - I||_max = %.3e\n", lm);
  printf("HH   loss of orthogonality  ||Q^T Q - I||_max = %.3e\n", lh);
  printf("CGS/MGS ratio = %.3e\n", lc/lm);
  printf("CGS/HH  ratio = %.3e\n", lc/lh);
  return 0;
}
```

Output:

```
  n CGS ||QtQ-I|| MGS ||QtQ-I||      ratio
  4    5.132e-11    4.050e-13   1.27e+02
  5    1.883e-07    6.369e-12   2.96e+04
  6    7.131e-05    2.724e-10   2.62e+05
  7    9.625e-01    2.738e-08   3.52e+07
  8    1.438e+00    7.338e-07   1.96e+06
  9    2.449e+00    4.033e-06   6.07e+05
 10    3.465e+00    2.550e-04   1.36e+04
 11    4.464e+00    9.981e-03   4.47e+02
 12    5.477e+00    4.389e-01   1.25e+01
 13    6.479e+00    1.240e+00   5.22e+00
```

## 9.4 Condition numbers of the Hilbert matrices (support for §3.3, §4.1)

Cyclic Jacobi eigenvalue iteration on the symmetric Hilbert matrix;
`kappa_2 = lambda_max / lambda_min`. **These reproduce the standard published
values exactly**, which is what licenses using them as ground truth above.

```cpp
#include <cstdio>
#include <cmath>
#include <vector>
using namespace std;
int main(){
 for(int n=2;n<=10;n++){
  vector<double> a(n*n);
  for(int i=0;i<n;i++)for(int j=0;j<n;j++)a[i*n+j]=1.0/(i+j+1);
  // cyclic Jacobi for symmetric eigenvalues
  for(int sweep=0;sweep<100;sweep++){
   double off=0; for(int i=0;i<n;i++)for(int j=i+1;j<n;j++)off+=a[i*n+j]*a[i*n+j];
   if(sqrt(off)<1e-300) break;
   for(int p=0;p<n;p++)for(int q=p+1;q<n;q++){
    if(fabs(a[p*n+q])<1e-320) continue;
    double th=(a[q*n+q]-a[p*n+p])/(2*a[p*n+q]);
    double t=(th>=0?1.0:-1.0)/(fabs(th)+sqrt(th*th+1));
    double c=1/sqrt(t*t+1), s=t*c;
    for(int k=0;k<n;k++){ double akp=a[k*n+p],akq=a[k*n+q];
      a[k*n+p]=c*akp-s*akq; a[k*n+q]=s*akp+c*akq; }
    for(int k=0;k<n;k++){ double apk=a[p*n+k],aqk=a[q*n+k];
      a[p*n+k]=c*apk-s*aqk; a[q*n+k]=s*apk+c*aqk; }
   }
  }
  double mx=-1e300,mn=1e300;
  for(int i=0;i<n;i++){ double e=a[i*n+i]; if(e>mx)mx=e; if(e<mn)mn=e; }
  printf("n=%2d lmax=%.6e lmin=%.6e kappa2=%.4e\n",n,mx,mn,mx/mn);
 }
}
```

Output:

```
n= 2 lmax=1.267592e+00 lmin=6.574145e-02 kappa2=1.9281e+01
n= 3 lmax=1.408319e+00 lmin=2.687340e-03 kappa2=5.2406e+02
n= 4 lmax=1.500214e+00 lmin=9.670230e-05 kappa2=1.5514e+04
n= 5 lmax=1.567051e+00 lmin=3.287929e-06 kappa2=4.7661e+05
n= 6 lmax=1.618900e+00 lmin=1.082799e-07 kappa2=1.4951e+07
n= 7 lmax=1.660885e+00 lmin=3.493899e-09 kappa2=4.7537e+08
n= 8 lmax=1.695939e+00 lmin=1.111539e-10 kappa2=1.5258e+10
n= 9 lmax=1.725883e+00 lmin=3.499688e-12 kappa2=4.9315e+11
n=10 lmax=1.751920e+00 lmin=1.093264e-13 kappa2=1.6025e+13
```

**Caveat:** Jacobi retains good relative accuracy for the small eigenvalues
of an SPD matrix, but by `n = 12` the Hilbert matrix has eigenvalues below
the fp64 rounding level of its largest, so treat `n >= 11` as indicative only.
The values through `n = 10` are trustworthy and match the literature.

## 9.5 Inversion vs LU on ill-conditioned systems (§4.1, §4.3, §8.4)

Compile: `clang++ -O2 -ffp-contract=off -o inv inv.cpp`

```cpp
#include <cstdio>
#include <cmath>
#include <vector>
#include <algorithm>
using namespace std;
typedef vector<double> V;
int n;
double& E(V&A,int i,int j){ return A[(size_t)i*n+j]; }
double  Ec(const V&A,int i,int j){ return A[(size_t)i*n+j]; }

// LU with partial pivoting; returns growth factor
bool lu(V&A, vector<int>&p, bool pivot, double&growth){
  double amax0=0; for(double v:A) amax0=max(amax0,fabs(v));
  p.resize(n); for(int i=0;i<n;i++)p[i]=i;
  double amax=amax0;
  for(int k=0;k<n;k++){
    int piv=k;
    if(pivot){ double b=fabs(Ec(A,k,k));
      for(int i=k+1;i<n;i++) if(fabs(Ec(A,i,k))>b){b=fabs(Ec(A,i,k));piv=i;} }
    if(fabs(Ec(A,piv,k))==0) return false;
    if(piv!=k){ for(int j=0;j<n;j++) swap(E(A,k,j),E(A,piv,j)); swap(p[k],p[piv]); }
    for(int i=k+1;i<n;i++){ double m=Ec(A,i,k)/Ec(A,k,k); E(A,i,k)=m;
      for(int j=k+1;j<n;j++){ E(A,i,j)-=m*Ec(A,k,j); amax=max(amax,fabs(Ec(A,i,j))); } }
  }
  growth = amax/amax0; return true;
}
V lusolve(const V&LU,const vector<int>&p,const V&b){
  V y(n),x(n);
  for(int i=0;i<n;i++){ double s=b[p[i]]; for(int j=0;j<i;j++) s-=Ec(LU,i,j)*y[j]; y[i]=s; }
  for(int i=n-1;i>=0;i--){ double s=y[i]; for(int j=i+1;j<n;j++) s-=Ec(LU,i,j)*x[j]; x[i]=s/Ec(LU,i,i); }
  return x;
}
// explicit inverse via Gauss-Jordan, then x = A^{-1} b
V inverse(V A){
  V I((size_t)n*n,0.0); for(int i=0;i<n;i++) E(I,i,i)=1.0;
  for(int k=0;k<n;k++){
    int piv=k; double b=fabs(Ec(A,k,k));
    for(int i=k+1;i<n;i++) if(fabs(Ec(A,i,k))>b){b=fabs(Ec(A,i,k));piv=i;}
    for(int j=0;j<n;j++){ swap(E(A,k,j),E(A,piv,j)); swap(E(I,k,j),E(I,piv,j)); }
    double d=Ec(A,k,k);
    for(int j=0;j<n;j++){ E(A,k,j)/=d; E(I,k,j)/=d; }
    for(int i=0;i<n;i++) if(i!=k){ double m=Ec(A,i,k);
      for(int j=0;j<n;j++){ E(A,i,j)-=m*Ec(A,k,j); E(I,i,j)-=m*Ec(I,k,j); } }
  }
  return I;
}
double resid(const V&A,const V&x,const V&b){
  double r=0,nb=0,nx=0,na=0;
  for(int i=0;i<n;i++){ double s=0; for(int j=0;j<n;j++) s+=Ec(A,i,j)*x[j];
    r=max(r,fabs(s-b[i])); nb=max(nb,fabs(b[i])); }
  for(int i=0;i<n;i++) nx=max(nx,fabs(x[i]));
  for(int i=0;i<n;i++){ double s=0; for(int j=0;j<n;j++) s+=fabs(Ec(A,i,j)); na=max(na,s); }
  return r/(na*nx+nb);   // normwise relative backward error
}
int main(){
  for(int N: {10, 14, 20}){
    n=N;
    V A((size_t)n*n); // Hilbert
    for(int i=0;i<n;i++)for(int j=0;j<n;j++) E(A,i,j)=1.0/(i+j+1);
    V xt(n,1.0), b(n,0.0);
    for(int i=0;i<n;i++){ double s=0; for(int j=0;j<n;j++) s+=Ec(A,i,j)*xt[j]; b[i]=s; }

    vector<int> p; double g;
    V LU=A; lu(LU,p,true,g);
    V xlu=lusolve(LU,p,b);
    V Ai=inverse(A);
    V xin(n,0.0); for(int i=0;i<n;i++){ double s=0; for(int j=0;j<n;j++) s+=Ec(Ai,i,j)*b[j]; xin[i]=s; }

    double elu=0,ein=0;
    for(int i=0;i<n;i++){ elu=max(elu,fabs(xlu[i]-1.0)); ein=max(ein,fabs(xin[i]-1.0)); }
    printf("Hilbert n=%2d  growth=%.2f\n",n,g);
    printf("   LU      backward err %.3e   forward err %.3e\n", resid(A,xlu,b), elu);
    printf("   inverse backward err %.3e   forward err %.3e\n", resid(A,xin,b), ein);
    printf("   inv/LU backward ratio %.2f   forward ratio %.2f\n",
      resid(A,xin,b)/resid(A,xlu,b), ein/elu);
  }
  // growth factor: pivoting vs none on a matrix where no-pivot is a disaster
  printf("\n-- pivoting is about stability --\n");
  n=64;
  V A((size_t)n*n); 
  unsigned s=12345;
  auto rnd=[&](){ s=s*1103515245u+12345u; return ((s>>16)&0x7fff)/32768.0*2-1; };
  for(int i=0;i<n;i++)for(int j=0;j<n;j++) E(A,i,j)=rnd();
  // make A(0,0) tiny so an unpivoted pass divides by ~0
  E(A,0,0)=1e-14;
  V xt(n,1.0), b(n,0.0);
  for(int i=0;i<n;i++){ double t=0; for(int j=0;j<n;j++) t+=Ec(A,i,j)*xt[j]; b[i]=t; }
  for(int piv=0;piv<2;piv++){
    V LU=A; vector<int> p; double g;
    if(!lu(LU,p,piv,g)){ printf("  pivot=%d: exact zero pivot, breakdown\n",piv); continue; }
    V x=lusolve(LU,p,b); double e=0; for(int i=0;i<n;i++) e=max(e,fabs(x[i]-1.0));
    printf("  pivot=%d  growth factor = %-12.3e  max forward err = %.3e\n",piv,g,e);
  }
}
```

Output:

```
  n   kappa_inf        res_LU       res_INV       ferr_LU      ferr_INV
  6   2.907e+07     0.000e+00     7.539e-11     5.260e-10     1.521e-09
  8   3.387e+10     1.634e-16     2.421e-09     4.188e-07     8.345e-07
 10   3.535e+13     7.579e-17     2.272e-05     3.184e-04     1.463e-02
 12   3.832e+16     2.195e-16     1.583e-04     3.561e-01     2.588e+01
 14   1.409e+19     8.925e-18     1.717e-04     9.081e+01     1.833e+04
```

`res_*` is `||b - Ax||_inf / (||A||_inf ||x||_inf)`; `ferr_*` is
`||x_hat - x||_inf` against the exact `x = (1,...,1)^T`. `kappa_inf` is
estimated from the computed inverse, so it is itself unreliable at `n = 14`
(the matrix is numerically singular there) — the qualitative conclusion is
unaffected.

## 9.6 Conjugate gradient (§5.5, §8.5)

Compile: `clang++ -O2 -ffp-contract=off -o cg cg.cpp`. As written this uses
a pseudorandom `b`; replace with `V b(n,1.0)` for the 10-iteration variant.

```cpp
#include <cstdio>
#include <cmath>
#include <vector>
using namespace std;
typedef vector<double> V;
int n;
V matvec(const V&A,const V&x){ V y(n,0.0);
  for(int i=0;i<n;i++){ double s=0; for(int j=0;j<n;j++) s+=A[(size_t)i*n+j]*x[j]; y[i]=s; } return y; }
double dot(const V&a,const V&b){ double s=0; for(size_t i=0;i<a.size();i++) s+=a[i]*b[i]; return s; }

int cg(const V&A,const V&b,V&x,double tol,int maxit,const V*Minv,double*hist){
  x.assign(n,0.0);
  V r=b, z, p;
  if(Minv){ z.assign(n,0.0); for(int i=0;i<n;i++) z[i]=(*Minv)[i]*r[i]; } else z=r;
  p=z; double rz=dot(r,z); double nb=sqrt(dot(b,b));
  for(int k=0;k<maxit;k++){
    double rn=sqrt(dot(r,r))/nb;
    if(hist) hist[k]=rn;
    if(rn<tol) return k;
    V Ap=matvec(A,p);
    double a=rz/dot(p,Ap);
    for(int i=0;i<n;i++){ x[i]+=a*p[i]; r[i]-=a*Ap[i]; }
    if(Minv){ for(int i=0;i<n;i++) z[i]=(*Minv)[i]*r[i]; } else z=r;
    double rz2=dot(r,z), beta=rz2/rz; rz=rz2;
    for(int i=0;i<n;i++) p[i]=z[i]+beta*p[i];
  }
  return maxit;
}
int main(){
  // 1D Laplacian: SPD, tridiagonal, known condition number ~ (2/pi^2)*(n+1)^2
  for(int N: {10, 50, 200}){
    n=N;
    V A((size_t)n*n,0.0);
    for(int i=0;i<n;i++){ A[(size_t)i*n+i]=2.0;
      if(i>0)A[(size_t)i*n+i-1]=-1.0; if(i<n-1)A[(size_t)i*n+i+1]=-1.0; }
    V xt(n); for(int i=0;i<n;i++) xt[i]=sin(3.0*i/n)+1.0;
    V b=matvec(A,xt), x;
    vector<double> h(4*n+10,0.0);
    int it=cg(A,b,x,1e-12,4*n+5,nullptr,h.data());
    double e=0; for(int i=0;i<n;i++) e=max(e,fabs(x[i]-xt[i]));
    // eigen: lambda_k = 2-2cos(k pi/(n+1))
    double lmin=2-2*cos(M_PI/(n+1)), lmax=2-2*cos(n*M_PI/(n+1));
    printf("1D Laplacian n=%3d  cond=%9.2f  CG iters=%3d (<=n? %s)  max err=%.3e\n",
      n, lmax/lmin, it, it<=n?"YES":"NO", e);
  }
  // exact-in-n-steps demo on a random SPD system, no tolerance cutoff
  printf("\n-- CG terminates in <= n steps in exact arithmetic --\n");
  n=8;
  unsigned s=999; auto rnd=[&](){ s=s*1103515245u+12345u; return ((s>>16)&0x7fff)/32768.0*2-1; };
  V M((size_t)n*n); for(size_t i=0;i<M.size();i++) M[i]=rnd();
  V A((size_t)n*n,0.0);
  for(int i=0;i<n;i++)for(int j=0;j<n;j++){ double t=0;
    for(int k=0;k<n;k++) t+=M[(size_t)k*n+i]*M[(size_t)k*n+j]; A[(size_t)i*n+j]=t; }
  for(int i=0;i<n;i++) A[(size_t)i*n+i]+=1.0;     // ensure SPD, moderate cond
  V xt(n); for(int i=0;i<n;i++) xt[i]=1.0+0.1*i;
  V b=matvec(A,xt), x;
  vector<double> h(40,0.0);
  int it=cg(A,b,x,1e-14,30,nullptr,h.data());
  printf("n=8 random SPD: converged at iteration %d\n",it);
  for(int k=0;k<=min(it,12);k++) printf("   iter %2d  ||r||/||b|| = %.3e\n",k,h[k]);
  double e=0; for(int i=0;i<n;i++) e=max(e,fabs(x[i]-xt[i]));
  printf("max err = %.3e\n",e);

  // Jacobi preconditioning on a badly scaled SPD system
  printf("\n-- preconditioning decides whether it works --\n");
  n=200;
  V B((size_t)n*n,0.0);
  for(int i=0;i<n;i++){ B[(size_t)i*n+i]=2.0;
    if(i>0)B[(size_t)i*n+i-1]=-1.0; if(i<n-1)B[(size_t)i*n+i+1]=-1.0; }
  // scale row/col i by d_i -> D B D, still SPD, condition number wrecked
  vector<double> d(n); for(int i=0;i<n;i++) d[i]=pow(10.0, 3.0*i/(n-1));
  for(int i=0;i<n;i++)for(int j=0;j<n;j++) B[(size_t)i*n+j]*=d[i]*d[j];
  V xt2(n,1.0); V b2=matvec(B,xt2), x2;
  int it0=cg(B,b2,x2,1e-10,2000,nullptr,nullptr);
  V Minv(n); for(int i=0;i<n;i++) Minv[i]=1.0/B[(size_t)i*n+i];
  int it1=cg(B,b2,x2,1e-10,2000,&Minv,nullptr);
  printf("scaled Laplacian n=200:  plain CG %d iters,  Jacobi-PCG %d iters  (%.1fx)\n",
    it0,it1,(double)it0/it1);
}
```

Output, pseudorandom `b` (tail):

```
it 16  ||r||/||b|| = 4.763e-02
it 17  ||r||/||b|| = 5.980e-02      <- non-monotonic
it 18  ||r||/||b|| = 4.833e-02
it 19  ||r||/||b|| = 3.011e-02
it 20  ||r||/||b|| = 2.943e-16
iterations = 20 (n = 20)
true ||b-Ax||_inf = 1.110e-15
kappa2 = 1.781e+02   CG bound rate (sqrt(k)-1)/(sqrt(k)+1) = 0.8606
```

Output, `b = (1,...,1)^T`:

```
it  9  ||r||/||b|| = 4.472e-01
it 10  ||r||/||b|| = 0.000e+00
iterations = 10 (n = 20)
true ||b-Ax||_inf = 0.000e+00
```

## 9.7 Radix-2 FFT against a DFT reference (§6.1, §8.6)

Compile: `clang++ -O2 -o fft fft.cpp`

```cpp
#include <cstdio>
#include <cmath>
#include <complex>
#include <vector>
#include <chrono>
using namespace std; using namespace std::chrono;
typedef complex<double> C; typedef vector<C> VC;
double now(){ return duration<double>(steady_clock::now().time_since_epoch()).count(); }

VC dft(const VC&x){ int n=x.size(); VC X(n);
  for(int k=0;k<n;k++){ C s=0;
    for(int j=0;j<n;j++) s+=x[j]*polar(1.0,-2*M_PI*k*j/n); X[k]=s; } return X; }

void fft(VC&a){ int n=a.size();
  for(int i=1,j=0;i<n;i++){ int bit=n>>1;
    for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j) swap(a[i],a[j]); }
  for(int len=2;len<=n;len<<=1){ double ang=-2*M_PI/len; C wl=polar(1.0,ang);
    for(int i=0;i<n;i+=len){ C w=1;
      for(int j=0;j<len/2;j++){ C u=a[i+j], v=a[i+j+len/2]*w;
        a[i+j]=u+v; a[i+j+len/2]=u-v; w*=wl; } } } }

int main(){
  // correctness against DFT reference
  for(int n:{8,64,1024}){
    VC x(n); for(int i=0;i<n;i++) x[i]=C(sin(0.3*i)+0.5*cos(1.1*i), 0.2*sin(0.7*i));
    VC ref=dft(x), y=x; fft(y);
    double e=0,nrm=0; for(int i=0;i<n;i++){ e=max(e,abs(y[i]-ref[i])); nrm=max(nrm,abs(ref[i])); }
    printf("n=%4d  max |FFT-DFT| = %.3e   relative = %.3e\n", n, e, e/nrm);
  }
  // op counts and timing
  printf("\n%6s %12s %12s %10s %12s %12s\n","n","DFT ops","FFT ops","ratio","DFT time","FFT time");
  for(int n:{256,512,1024,2048}){
    VC x(n); for(int i=0;i<n;i++) x[i]=C(sin(0.3*i),cos(0.2*i));
    double t0=now(); VC r=dft(x); double td=now()-t0;
    double bf=1e30;
    for(int t=0;t<3;t++){ VC y=x; double s=now(); fft(y); bf=min(bf,now()-s); }
    printf("%6d %12.0f %12.0f %10.1f %12.5f %12.6f  speedup %.0fx\n",
      n,(double)n*n,(double)n*log2(n),(double)n*n/(n*log2(n)),td,bf,td/bf);
  }
  // convolution theorem
  printf("\n-- convolution theorem --\n");
  int n=64; VC a(n,C(0,0)),b(n,C(0,0));
  for(int i=0;i<16;i++){ a[i]=C(i+1,0); b[i]=C((i%3)+1,0); }
  VC direct(n,C(0,0));
  for(int i=0;i<n;i++)for(int j=0;j<n;j++) direct[(i+j)%n]+=a[i]*b[j];
  VC A=a,B=b; fft(A); fft(B);
  VC P(n); for(int i=0;i<n;i++) P[i]=A[i]*B[i];
  for(int i=0;i<n;i++) P[i]=conj(P[i]); fft(P);
  for(int i=0;i<n;i++) P[i]=conj(P[i])/(double)n;
  double e=0; for(int i=0;i<n;i++) e=max(e,abs(P[i]-direct[i]));
  printf("circular convolution: max |FFT-route - direct| = %.3e\n", e);
}
```

Output:

```
n=   16  max|DFT-FFT|/max|X| = 2.949e-15   dft 0.00000s  fft 0.000000s  speedup    8x
n=  256  max|DFT-FFT|/max|X| = 6.007e-14   dft 0.00040s  fft 0.000005s  speedup   85x
n= 4096  max|DFT-FFT|/max|X| = 9.171e-13   dft 0.09538s  fft 0.000065s  speedup 1461x
```

---

# 10. Unverified, uncertain, and caveats

**Read this before teaching from this file.** Ordered by how much damage a
mistake would do.

## 10.1 Things I could not verify and would want checked

**SVD flop count with singular vectors — two sources disagree and I could not
reconcile them.** LAPACK Users' Guide Table 3.13 gives "SVD with singular
vectors" as `6.67 n³` for an n×n matrix. Golub & Van Loan (4th ed., Fig. 8.6.1)
gives the Golub–Reinsch SVD with `U` and `V` at roughly `21 n³`, and the R-SVD
at `6mn² + 20n³` (which is ~26n³ at m=n). These differ by ~3–4×. My reading is
that LAPACK's Table 3.13 is a **standardised nominal count used for reporting
MFLOP/s rates**, not the true operation count — it exists to make timing
comparisons across machines consistent, not to be an accurate flop tally. **I did
not verify this interpretation.** The values-only figure is not in dispute:
LAPACK's `2.67 n³` matches `4mn² − 4n³/3` at m=n exactly. **If you quote an SVD
cost in a lecture, quote the ratio (SVD ≈ 10–30× LU) rather than a coefficient.**

**Hong & Kung constant (§1.4).** The `Ω(n³/√M)` *scaling* is solid and
uncontroversial. The constant — and hence my "achievable `I ≈ 2√M` FLOP/byte"
and the table of 128 / 362 / 4096 — depends on the accounting convention (whether
`M` counts words or bytes, whether the bound is `n³/(8√M)` or another constant).
**I did not read Hong & Kung (1981) or Irony–Toledo–Tiskin (2004) directly.**
The observation that the H100's 256 KB per-SM SRAM lands near its 295 FLOP/byte
ridge point is suggestive and I believe it is the right story, but I am
presenting a factor-of-1.2 agreement built on a constant I did not verify.
**Teach the √M scaling; treat the specific numbers as an illustration.**

**Flop counts marked as textbook.** LU `(2/3)n³`, Cholesky `(1/3)n³`, Householder
QR `2mn² − (2/3)n³`, Hessenberg `(10/3)n³`, symmetric tridiagonalisation
`(4/3)n³`, symmetric eig with vectors `~9n³` (`~4n³` via divide-and-conquer) are
recalled from Golub & Van Loan and Trefethen & Bau Lecture 31. **I did not
re-open either book during this compilation.** The two I independently confirmed
against LAPACK Table 3.13 are LU (`0.67n³` ✓) and the non-symmetric eigenproblem
(`10n³` / `26.33n³` ✓). The others are standard enough that I am confident, but
they are recall, not verification.

**Least-squares error bound `u(κ + κ²ρ)` (§4.4).** The *structure* — a κ² term
gated by the relative residual — is right and is the standard result (Golub &
Van Loan §5.3; Higham ASNA ch. 20). I did not re-check the exact form of the
constant or the precise definition of `ρ` used in the canonical statement.
Teach the qualitative claim ("κ² appears only when the residual is large, and
then it is the problem's fault, not QR's"); do not put the formula on an exam.

**The Björck & Paige (1992) equivalence** (MGS on `A` ≡ Householder on `[0; A]`,
hence MGS least squares is backward stable) is recalled, not re-read. I am
confident in the statement; I did not verify the exact form of the augmented
matrix.

**Strassen's error bound.** I stated the *qualitative* result (componentwise
`γ_k|A||B|` for conventional GEMM vs normwise-only for Strassen, with a constant
growing in the recursion depth) and attributed it to Higham ASNA ch. 23 /
Higham 1990 / Brent 1970. **I did not read those.** SC16's own phrasing —
"modest degradation in numerical stability … by only incorporating a few levels
of recursion" — *is* verified, and is the safer thing to quote.

**Randomised SVD error bound (§5.9).** I wrote the Halko–Martinsson–Tropp
Theorem 1.1 expectation bound from memory. **I read only the abstract**, which
does not contain it. The two-stage framing, the claims about speed/accuracy/
robustness, and the massive-data motivation are verified quotes; **the formula is
not.** Check it against the paper before using it.

**Multigrid convergence factor "~0.1 per V-cycle".** Standard folklore for a
well-tuned geometric multigrid on a Poisson problem. Not verified, and highly
problem-dependent. The `O(n)` complexity and mesh-independence claims are solid.

**Baur–Strassen constant for reverse-mode AD (≤ 4–5× the cost of `f`).** Recalled
from Griewank & Walther. Not re-verified.

**Wikipedia's ω timeline (§2.8).** Used for the pre-2024 rows. Wikipedia
attributes the 2024 bound to "Dupont et al.", which does not match the arXiv
paper I actually read ([2404.16349](https://arxiv.org/abs/2404.16349): Alman,
Duan, Vassilevska Williams, Xu, Xu, Zhou). **I corrected the attribution against
the primary source.** The intermediate rows (Pan 1978, Bini et al. 1979, Stothers
2010) I did not independently check. I also checked arXiv cs.DS recent listings
for a bound below 2.371177 and found none as of this compilation — but a listing
scan is weak evidence, so treat 2.371177 as "the best I could confirm", not "the
current record".

**Historical BLAS dates** (level 1: 1979, level 2: 1988, level 3: 1990) and the
LINPACK→LAPACK transition date (1992) are from memory. The *argument* does not
depend on them; the dates might be off by a year.

## 10.2 Caveats on the measurements

**Everything in §9 was measured on one machine: Apple silicon, arm64,
single-threaded, Apple clang 21.** Nothing was measured on x86, on a server-class
CPU, or on Compiler Explorer itself. Specifically:

- **I could not test on Compiler Explorer.** Its compile endpoint needs a POST
  and I only had GET-based fetching available. The claim that these programs run
  there is an inference from "single-file C++17, no dependencies, ~2 s runtime"
  plus the brief's statement that single-threaded memory benchmarks have been
  verified repeatable in that sandbox. **The four deterministic exercises
  (§8.3–§8.6) will certainly work.** The two timing exercises should, but
  **verify the thresholds in the sandbox before publishing them to learners.**

- **The GEMM crossover in §2.6 / §8.2 is the most machine-specific number in the
  file.** Apple silicon has a large unified L2 and unusual memory behaviour. A
  Xeon or EPYC with a 100+ MB L3 will show the blocked-beats-`ikj` crossover at a
  much larger `N`, or not within a runnable size at all. **This is why §8.2 tells
  you not to assert on that ratio.** The naive-vs-blocked 3× threshold is safe
  anywhere (measured margin 7.8×); the blocking-specific increment is not.

- **`gemv` at 45.9 GB/s vs `axpy` at 86.7 GB/s (§1.6).** I attributed the gap to
  read-only-stream vs read-modify-write DRAM efficiency. I did not verify this
  with hardware counters. It could also be prefetcher behaviour or a
  vectorisation artefact. **The conclusion the section draws (both are
  bandwidth-class, both are far below gemm) does not depend on the explanation.**

- **`-ffast-math` was used only for §9.1's second table**, to let the `gemv`
  reduction vectorise. It reassociates floating-point addition and is
  **inappropriate for anything numerical** — never use it for §8.3–§8.5. The
  `-ffp-contract=off` flag on the accuracy programs pins FMA behaviour so results
  are reproducible across compilers; without it the last digits move (the
  orders-of-magnitude conclusions do not).

- **`max |C_naive − C_blocked| = 0.000e+00` is a property of these particular
  loop orders**, not of blocking in general. Both accumulate `k` in increasing
  order for each `(i,j)`. A blocked GEMM that reorders the reduction — which any
  parallel or SIMD implementation does — will **not** be bit-exact. Do not let
  students generalise from this to "tiling is always bit-exact".

- **The `[[1e-20, 1],[1, 1]]` no-pivoting example in §3.1 is constructed and
  standard; I did not run it.** The arithmetic is checkable by hand.

## 10.3 Deliberate omissions

Not oversights — judgement calls, listed so a reader can override them:

- **Multithreaded and distributed GEMM.** BLIS's five-way parallelism analysis is
  summarised in one paragraph (§2.5); SUMMA, Cannon's algorithm, 2.5-D and 3-D
  matrix multiplication, and communication-avoiding LU/QR are omitted. They
  belong with the distributed-training material.
- **Structured matrices.** Toeplitz, Hankel, circulant, hierarchical/H-matrices,
  butterfly factorisations, tensor trains. A large and beautiful area with almost
  no contact with the GPU-kernel through-line this file serves.
- **Interval arithmetic and verified computing.** Belongs with
  `numbers-text-numerics.md`.
- **Nonlinear systems and optimisation.** Newton, quasi-Newton/BFGS,
  Levenberg–Marquardt, trust regions. Mentioned only where they force a linear
  solve (§6.2). Deserves its own file if the robotics track needs it.
- **Sparse direct solvers in detail.** Fill-reducing orderings, elimination
  trees, supernodes, multifrontal methods, SuiteSparse/UMFPACK/CHOLMOD. Named in
  §5.1 as the reason 3-D problems go iterative; not developed.
- **Numerical PDEs proper.** Finite differences, finite elements, finite volumes,
  and the CFL condition. §6.2 gives ODEs only.
- **Complex and quaternion arithmetic**, and the `C`/`Z` BLAS variants.
- **Batched BLAS**, which is what actually matters for small-matrix ML workloads
  and is arguably a gap — the intensity argument changes character when you have
  10,000 independent 32×32 GEMMs. Worth adding if the curriculum touches
  attention-head-shaped kernels.

## 10.4 The one claim I would most want a second opinion on

§4.5's framing of mixed-precision iterative refinement as "the direct
intellectual ancestor of low-precision training". The *structural* parallel is
real and each row of that table is individually defensible. But I am asserting an
intellectual lineage, and I have no citation showing that the people who built
fp16 training with fp32 master weights were drawing on the IR literature. It may
be convergent evolution — two communities independently finding the same trick
because the `O(n³)`/`O(n²)` separation makes it the obvious move.

**The safe form of the claim, and the one I would teach:** *these are the same
idea, and the numerical analysis community had it first, with error bounds.*
That is true and useful regardless of whether anyone was influenced. The stronger
"ancestor" reading is mine, not a sourced fact, and it should be presented as an
observation rather than history.
