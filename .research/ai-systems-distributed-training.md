# AI systems: transformer arithmetic, FlashAttention, inference, distributed training

Compiled 2026-09-01. This is the **payoff layer**: it is where the CPU, GPU,
memory-hierarchy and network material in the sibling notes stops being trivia
and starts predicting wall-clock time. Nearly every claim here is a piece of
arithmetic you can check on paper, and the ones that are citations rather than
derivations carry a link. Anything I could not verify against a primary source
is in the **Unverified / uncertain** section at the end — read it before
teaching from this file.

**Scope note — what this file deliberately does *not* cover**, because sibling
research files already do:

- CUDA programming model, occupancy, shared memory, tensor-core intrinsics →
  `cuda-programming-tuning.md`
- FP8/FP4/MX number formats, block scaling, loss scaling → `fp4-fp8-blackwell.md`
- GPU microarchitecture, SM counts, HBM bandwidth, NVLink generations →
  `nvidia-architectures.md`
- PyTorch dispatcher/autograd/allocator internals → `numpy-pytorch-internals.md`
- NCCL ring/tree algorithms at the wire level, RDMA, InfiniBand → `networking-and-internet.md`

This file uses those as *inputs*. When it needs a bandwidth number it takes it
from the hardware file and does arithmetic with it.

Primary sources actually read (abstract + full text where noted):

- *FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness*,
  Dao, Fu, Ermon, Rudra, Ré — arXiv [2205.14135](https://arxiv.org/abs/2205.14135)
  (ar5iv full text: Theorem 2, Algorithm 1, block sizes read verbatim)
- *FlashAttention-2*, Dao — arXiv [2307.08691](https://arxiv.org/abs/2307.08691)
- *FlashAttention-3*, Shah, Bikshandi, Zhang, Thakkar, Ramani, Dao — arXiv [2407.08608](https://arxiv.org/abs/2407.08608)
- *Online normalizer calculation for softmax*, Milakov & Gimelshein — arXiv [1805.02867](https://arxiv.org/abs/1805.02867)
- *Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism*,
  Shoeybi et al. — arXiv [1909.08053](https://arxiv.org/abs/1909.08053) (ar5iv full text)
- *Efficient Large-Scale Language Model Training on GPU Clusters Using Megatron-LM* (PTD-P),
  Narayanan et al. — arXiv [2104.04473](https://arxiv.org/abs/2104.04473) (ar5iv, incl. FLOPs appendix)
- *Reducing Activation Recomputation in Large Transformer Models*, Korthikanti et al. —
  arXiv [2205.05198](https://arxiv.org/abs/2205.05198) (ar5iv, activation-memory derivation)
- *ZeRO: Memory Optimizations Toward Training Trillion Parameter Models*, Rajbhandari et al. —
  arXiv [1910.02054](https://arxiv.org/abs/1910.02054) (ar5iv, memory + comms tables)
- *PyTorch FSDP*, Zhao et al. — arXiv [2304.11277](https://arxiv.org/abs/2304.11277)
- *Efficient Memory Management for LLM Serving with PagedAttention* (vLLM), Kwon et al.,
  SOSP 2023 — arXiv [2309.06180](https://arxiv.org/abs/2309.06180) (ar5iv, fragmentation figures)
- *Fast Inference from Transformers via Speculative Decoding*, Leviathan, Kalman, Matias —
  arXiv [2211.17192](https://arxiv.org/abs/2211.17192) (ar5iv, the acceptance-rate algebra)
- *GQA: Training Generalized Multi-Query Transformer Models*, Ainslie et al. — arXiv [2305.13245](https://arxiv.org/abs/2305.13245)
- *DeepSeek-V2* (Multi-head Latent Attention) — arXiv [2405.04434](https://arxiv.org/abs/2405.04434) (ar5iv §2.1 + Table 1)
- *SARATHI* (chunked prefill), Agrawal et al. — arXiv [2308.16369](https://arxiv.org/abs/2308.16369)
- *DistServe* (prefill/decode disaggregation), Zhong et al., OSDI 2024 — arXiv [2401.09670](https://arxiv.org/abs/2401.09670)
- *Ring Attention with Blockwise Transformers*, Liu, Zaharia, Abbeel — arXiv [2310.01889](https://arxiv.org/abs/2310.01889)
- *Switch Transformers*, Fedus, Zoph, Shazeer — arXiv [2101.03961](https://arxiv.org/abs/2101.03961) (ar5iv, capacity + aux loss)
- *GPTQ*, Frantar et al. — arXiv [2210.17323](https://arxiv.org/abs/2210.17323)
- *AWQ*, Lin et al. — arXiv [2306.00978](https://arxiv.org/abs/2306.00978)
- *SmoothQuant*, Xiao et al. — arXiv [2211.10438](https://arxiv.org/abs/2211.10438)
- *Scaling Laws for Neural Language Models*, Kaplan et al. — arXiv [2001.08361](https://arxiv.org/abs/2001.08361) (ar5iv §2.1, §6)
- *Training Compute-Optimal Large Language Models* (Chinchilla), Hoffmann et al. — arXiv [2203.15556](https://arxiv.org/abs/2203.15556) (ar5iv, three approaches + fits)
- *Chinchilla Scaling: A replication attempt*, Besiroglu, Erdil, Barnett, You — arXiv [2404.10102](https://arxiv.org/abs/2404.10102)
- *PaLM*, Chowdhery et al. — arXiv [2204.02311](https://arxiv.org/abs/2204.02311) (ar5iv, MFU definition + table)
- *The Llama 3 Herd of Models*, Grattafiori et al. — arXiv [2407.21783](https://arxiv.org/abs/2407.21783) (HTML §3.3, reliability + 4D parallelism)

---

## 0. The one-page mental model

Four numbers decide everything in this file.

| Quantity | Symbol | Where it comes from |
|---|---|---|
| Model FLOPs per token, training | `6N` | 2 FLOPs per parameter per token, ×3 for fwd+bwd |
| Bytes that must move | depends | weights, activations, KV cache, gradients |
| Peak compute of the chip | `F_peak` | vendor spec, dense, in the dtype you actually use |
| Peak bandwidth of the wire | `B` | HBM for on-chip, NVLink intra-node, IB/Ethernet inter-node |

Every performance question in ML systems reduces to comparing
`work / F_peak` against `bytes / B`. The **ridge point** (arithmetic intensity
at which a machine flips from bandwidth-bound to compute-bound) for an H100 SXM
in dense BF16 is

```
F_peak / B_HBM  =  989.5e12 FLOP/s / 3.35e12 B/s  =  295 FLOP per byte
```

Hold that number. Almost everything below is a story about an operation whose
arithmetic intensity is far *below* 295 and what people did about it.

- **Training a transformer** at large batch: intensity in the thousands. Compute-bound.
  Good. Chase MFU.
- **Attention, computed naively**: intensity ~O(head_dim) with an N×N round-trip
  through HBM. Bandwidth-bound. → FlashAttention.
- **Prefill**: compute-bound, like training. Good.
- **Decode, batch size B**: intensity is **exactly B**. At B=1 you are running a
  295-FLOP/byte machine at 1 FLOP/byte, i.e. 0.34% of peak. → everything in §3.
- **Gradient all-reduce**: whether it hides under compute depends on tokens per
  GPU per step, and — surprisingly — *not* on model size at all. → §4.9.

---

## 1. Transformer arithmetic from a systems view

### 1.1 Symbols

Fix a decoder-only, pre-LN transformer.

| Symbol | Meaning | Llama-3-8B | Llama-3-70B |
|---|---|---|---|
| `L` | layers | 32 | 80 |
| `d` | model / hidden dim | 4096 | 8192 |
| `h` | query heads | 32 | 64 |
| `h_kv` | key/value heads (GQA) | 8 | 8 |
| `d_h` | head dim = `d/h` | 128 | 128 |
| `d_ff` | FFN inner dim | 14336 | 28672 |
| `V` | vocabulary | 128256 | 128256 |
| `s` | sequence length | 8192 | 8192 |
| `b` | microbatch (sequences) | — | — |

Everything below is derivable from those eight numbers. That is the point of
the unit: **the architecture card *is* the performance model.**

### 1.2 Parameter count

Per transformer layer:

| Block | Shape | Params |
|---|---|---|
| Q projection | `d × d` | `d²` |
| K projection | `d × h_kv·d_h` | `d · h_kv · d_h` |
| V projection | `d × h_kv·d_h` | `d · h_kv · d_h` |
| O projection | `d × d` | `d²` |
| FFN (ungated, up+down) | `d × d_ff`, `d_ff × d` | `2 · d · d_ff` |
| FFN (SwiGLU: gate+up+down) | 3 matrices | `3 · d · d_ff` |
| 2× RMSNorm | `d` each | `2d` (negligible) |

Plus embeddings `V·d`, and an output head `V·d` if untied.

**The classic identity.** With MHA (`h_kv = h`) and ungated FFN with `d_ff = 4d`:

```
params per layer = 4d² + 2·d·4d = 4d² + 8d² = 12d²
N_nonembed = 12 · L · d²
```

That is exactly Kaplan et al.'s `N ≈ 12 n_layer d_model²`
([2001.08361](https://arxiv.org/abs/2001.08361) §2.1, read verbatim).

**Nice coincidence worth teaching:** SwiGLU keeps the identity. The convention
is `d_ff = (8/3)d` rounded to a hardware-friendly multiple, so the FFN costs
`3 · d · (8/3)d = 8d²` — same as the ungated `2·d·4d`. That is *why* the
`8/3` factor exists: it was chosen to hold parameter count constant so the
SwiGLU-vs-GELU comparison was fair. GQA then *reduces* the `4d²` attention term.

**Worked check — Llama-3-8B:**

```
Q:  4096 × 4096                 = 16,777,216
K:  4096 × (8 × 128 = 1024)     =  4,194,304
V:  4096 × 1024                 =  4,194,304
O:  4096 × 4096                 = 16,777,216
                       attention = 41,943,040
FFN: 3 × 4096 × 14336           = 176,160,768
                     per layer   = 218,103,808
× 32 layers                      = 6,979,321,856
embedding 128256 × 4096          =   525,336,576
output head (untied)             =   525,336,576
                          TOTAL  = 8,029,995,008  ≈ 8.03 B   ✓
```

The published figure for Llama-3-8B is 8.03 B. The arithmetic is exact. Making a
student reproduce this to the digit is the single best first exercise in the
whole curriculum, because it forces them to actually read a config JSON and to
discover GQA, SwiGLU and weight untying by noticing their arithmetic is off.

### 1.3 FLOPs: where 2N and 6N come from

**The base fact.** A matmul `A(m×k) · B(k×n)` costs `m·n·k` multiply-accumulates,
and one MAC is counted as **2 FLOPs** (one multiply, one add). So `2mnk`.

**Forward = 2N.** Take any weight matrix `W` of shape `(k × n)`, i.e. `k·n`
parameters. Pushing one token's activation vector (`1 × k`) through it costs
`2·1·k·n = 2 · (params of W)` FLOPs. Sum over every weight matrix in the model:

```
forward FLOPs per token = 2N
```

That is the whole derivation. Each parameter is touched by exactly one MAC per
token. Note it counts only *weight* matmuls — the token-token attention
interaction has no parameters and is accounted separately (§1.4).

**Backward = 2× forward.** For `Y = XW`, backprop needs two matmuls of the same
shape class:

```
dX = dY · Wᵀ      (2 m k n FLOPs)   — to keep propagating
dW = Xᵀ · dY      (2 m k n FLOPs)   — to update the weight
```

Same `m,n,k`, so `2×` the forward cost. Hence:

```
training FLOPs per token = forward + backward = 2N + 4N = 6N
```

**This is the 6N rule.** It is why a training run's compute budget is quoted as
`C = 6 · N · D` for `D` tokens.

Two corollaries people get wrong:

1. **Inference (forward only) is `2N` per token.** So a token generated costs
   one third of a token trained. This is the basis of every "inference will
   dominate total lifetime compute" argument.
2. **Full activation recomputation adds one more forward**, so the *hardware*
   does `8N` while the *model* still needs `6N`. That gap is exactly the MFU/HFU
   gap in §1.7.

**The exact Megatron formula.** [2104.04473](https://arxiv.org/abs/2104.04473)
Appendix ("Floating-Point Operations") gives, per training iteration, verbatim:

```
96 · B · s · l · h² · ( 1 + s/(6h) + V/(16·l·h) )
```

with `B` = batch, `s` = seq len, `l` = layers, `h` = hidden, `V` = vocab.
Decode it:

- `96 B s l h²` = `8 · (12 l h²) · (B s)` = **`8N × tokens`** — note **8**, not 6:
  Megatron's number includes the extra forward from full activation
  recomputation. Drop it to `72 B s l h²` = `6N × tokens` for pure model FLOPs.
- `s/(6h)` — the attention (token-token) term, relative to the weight term.
- `V/(16·l·h)` — the output-logit projection, relative to the weight term.
- The paper explicitly notes this is "a lower bound for the true FLOP count"
  because it counts matmuls only, and it does **not** halve the attention term
  for causal masking.

### 1.4 Where the FLOPs actually go

Per layer, per token, forward:

| Component | FLOPs | With `d_ff=4d`, MHA |
|---|---|---|
| QKV projections | `2d² + 4·d·h_kv·d_h` | `8d²` (MHA) |
| Attention scores `QKᵀ` | `2 · s · d` (dense) | `2sd` |
| Attention `·V` | `2 · s · d` (dense) | `2sd` |
| Output projection | `2d²` | `2d²` |
| FFN | `4·d·d_ff` (or `6·d·d_ff` gated) | `16d²` |
| **weight matmuls total** | | **`24d² = 2 × 12d²`** ✓ |
| **attention total** | | **`4sd`** dense, **`2sd`** causal-average |

**The ratio that matters:**

```
attention FLOPs      4sd        s
────────────────  =  ────   =  ───    (dense; Megatron's convention)
weight FLOPs         24d²      6d

                                s
                            =  ────   (causal, averaging over positions)
                               12d
```

Two conventions, differing by exactly 2 because a causal mask means the average
query attends to `s/2` keys, not `s`. Megatron uses the dense `s/(6h)` because
that is what an unfused kernel actually executes. FlashAttention *does* skip
masked blocks, so for a FA-based stack the causal `s/(12d)` is the honest number.
**Always say which convention you are using** — this is the single most common
source of "my FLOP count doesn't match yours."

**Concrete: how the balance shifts with sequence length.** Llama-3-8B, `d=4096`,
dense convention (`s/6d`):

| Context `s` | attention / weight FLOPs | attention as % of layer |
|---|---|---|
| 2,048 | `2048/24576` = 0.083 | 7.7% |
| 8,192 | 0.333 | 25% |
| 32,768 | 1.33 | 57% |
| 131,072 | 5.33 | 84% |
| 1,048,576 | 42.7 | 98% |

Read the table as the reason the field exists. At 2k context, attention is
rounding error and nobody optimises it. At 128k, attention **is** the model, and
a 2× kernel speedup on attention is a ~1.7× speedup on the whole forward pass.
The break-even (`s = 6d`, dense) for `d=4096` is `s = 24,576` — this is the
single number that explains why long-context work took off exactly when it did.

Note also that `s/(6d)` is *dimensionless in the wrong way*: it grows with
context but shrinks with model width. A 405B model (`d=16384`) at 128k context
has ratio `131072/98304 = 1.33` — attention is 57% of FLOPs, not 84%. Wide
models are structurally more attention-cheap at a given context.

### 1.5 Activation memory

This is the part everyone underestimates. Activations are what you must keep
alive between forward and backward. From
[2205.05198](https://arxiv.org/abs/2205.05198) (Korthikanti et al., derivation
read verbatim), assuming 16-bit activations and 1-byte dropout masks, **per
transformer layer**:

```
bytes per layer = s · b · h · (34 + 5·a·s/h)
```

with `a` = attention heads, `h` = hidden, `b` = microbatch, `s` = seq len.
Their breakdown:

| Sub-block | Bytes | What it is |
|---|---|---|
| Attention block | `11sbh + 5as²b` | QKV input `2sbh`, `QKᵀ` inputs `4sbh`, softmax out `2as²b`, attn dropout mask `as²b`, attn-over-V `2as²b + 2sbh` |
| MLP block | `19sbh` | linear inputs `2sbh + 8sbh`, GeLU input `8sbh`, dropout mask `sbh` |
| 2× LayerNorm | `4sbh` | `2sbh` each |
| **Total** | `sbh(34 + 5as/h)` | |

**The `5as²b` term is the killer.** It is quadratic in `s` and linear in the
*number of heads*, and it is the softmax output plus dropout mask plus the
attention-weighted values — i.e. **the N×N matrix, stored, per head, per layer.**

Concrete: Llama-3-70B-shaped, `s=8192`, `b=1`, `h=8192`, `a=64`, `L=80`:

```
sbh                = 8192 · 1 · 8192              = 67.1 M
34 · sbh                                          = 2.28 GB per layer
5as²b = 5 · 64 · 8192² · 1                        = 21.5 G elements
     → 5·a·s/h · sbh = 5·64·8192/8192 · 67.1M     = 21.5 GB per layer
per layer                                          ≈ 23.8 GB
× 80 layers                                        ≈ 1.9 TB
```

1.9 TB of activations for a **single** sequence of 8192 tokens. This is the
number that forces every mitigation:

| Mitigation | Formula | Effect |
|---|---|---|
| Tensor parallel, degree `t` | `sbh(10 + 24/t + 5as/(ht))` | LayerNorms/dropout stay replicated — the stubborn `10sbh` |
| TP + **sequence parallel** | `sbh(34 + 5as/h)/t` | full `1/t`; the `10sbh` finally shards |
| **Selective** recompute (attn only) | `34·sbh·L/t` | kills `5as²b` entirely; memory becomes **independent of head count and of `s²`** |
| **Full** recompute | `2sbh` per layer (just the input) | cheapest memory, costs `+2N` FLOPs/token |
| FlashAttention | never materialises the `s²` term | same `5as²b` elimination, at *zero* recompute cost on the forward |

Note the last two rows are the same idea arriving twice: selective
recomputation and FlashAttention both delete the `5as²b` term. FlashAttention
does it better because it also deletes the *bandwidth* cost, not just the
capacity cost. That is the bridge into §2.

### 1.6 Optimizer state, and what mixed precision does to the accounting

Adam keeps two extra tensors the same shape as the parameters:

- `m` — exponential moving average of the gradient (first moment)
- `v` — exponential moving average of the squared gradient (second moment)

Both must persist across steps, both are elementwise, both are `N` elements.
That is the "2 extra copies". SGD-with-momentum keeps 1; plain SGD keeps 0.
This is the entire reason Adam is a memory-systems problem and not just an
optimisation-theory choice.

**Mixed-precision Adam, the canonical 16 bytes/param** (ZeRO
[1910.02054](https://arxiv.org/abs/1910.02054), read verbatim):

| Tensor | dtype | bytes/param |
|---|---|---|
| parameters (compute copy) | fp16/bf16 | 2 |
| gradients | fp16/bf16 | 2 |
| **master** parameters | fp32 | 4 |
| Adam `m` | fp32 | 4 |
| Adam `v` | fp32 | 4 |
| **total** | | **16Ψ** |

ZeRO writes this as `4Ψ + KΨ` with `K = 12` the "memory multiplier of optimizer
states" (master + m + v).

**The trap mixed precision sets.** The naive expectation is "fp16 halves my
memory." It does not, for training. Pure fp32 training is `4 (param) + 4 (grad)
+ 4 (m) + 4 (v) = 16` bytes/param — *identical*. Mixed precision buys you
**speed** (tensor cores) and **activation memory** (activations are the 16-bit
part that dominates), not optimizer-state memory. The master fp32 copy exists
because a bf16 weight has 8 mantissa bits and an Adam update of relative size
1e-4 rounds to zero against it; you must accumulate in fp32.

**Model states for Llama-3-8B:** `8.03e9 × 16 = 128.5 GB`. Does not fit on an
80 GB H100 — before a single activation. That fact alone motivates all of §4.3.

### 1.7 Model FLOPs Utilization, defined precisely

From PaLM ([2204.02311](https://arxiv.org/abs/2204.02311)), MFU is
"the ratio of the observed throughput (tokens-per-second) relative to the
theoretical maximum throughput of a system operating at peak FLOPs", where the
theoretical maximum counts **only forward and backward pass operations, excluding
rematerialization**.

```
                observed_tokens_per_sec × model_FLOPs_per_token
MFU  =  ────────────────────────────────────────────────────────────
              num_accelerators × peak_FLOP/s_per_accelerator

with  model_FLOPs_per_token = 6N   (optionally + the 6·L·s·d attention term)
```

**HFU** (hardware FLOPs utilization) uses the FLOPs the hardware *actually
executed*, i.e. including recomputation. So:

```
HFU ≥ MFU always;   with full activation recompute,  HFU/MFU = 8/6 = 1.33
```

PaLM's argument for preferring MFU: hardware FLOP counts depend on compiler and
implementation choices, and burning extra FLOPs on rematerialization does not
make training faster — so a metric that *rewards* recomputation is measuring the
wrong thing. MFU is implementation-independent and comparable across systems.

**Three rules for quoting MFU honestly:**

1. Use the **dense** peak, not the sparsity-doubled marketing number. NVIDIA's
   H100 datasheet BF16 figure of 1,979 TFLOP/s carries an asterisk meaning
   2:4 structured sparsity; dense is **989.5 TFLOP/s**. (The sibling
   `nvidia-architectures.md` quotes the sparse figures; be careful when
   cross-reading.) An MFU computed against the sparse peak is halved for free.
2. Use the peak **in the dtype you actually ran in**. BF16 MFU and FP8 MFU are
   different denominators.
3. Say whether your `model_FLOPs_per_token` includes the attention term. At
   8k context on an 8B model that is a 25% difference.

**Realistic achieved values** (all from the papers themselves):

| System | Hardware | MFU | Source |
|---|---|---|---|
| GPT-3 175B | V100 | **21.3%** | PaLM Table |
| Megatron-Turing NLG 530B | 2240 A100 | **30.2%** | PaLM Table |
| Gopher 280B | 4096 TPU v3 | **32.5%** | PaLM Table |
| PaLM 540B | 6144 TPU v4 | **46.2%** | PaLM Table |
| Megatron PTD-P 1T | 3072 A100 | **52% of peak**, 163 TFLOP/s/GPU | [2104.04473](https://arxiv.org/abs/2104.04473) |
| Llama-3 405B | 8K H100 | **43%** BF16 | [2407.21783](https://arxiv.org/abs/2407.21783) §3.3 |
| Llama-3 405B | 16K H100 | **41%** BF16 | ibid. |
| FlashAttention-2 training | A100 | **72%** (225 TFLOP/s) | [2307.08691](https://arxiv.org/abs/2307.08691) |

**Read the trend.** 21% → 46% over the V100→TPUv4 era was people getting better
at systems. Then H100-era MFU settles back to ~40% — not because engineers got
worse, but because peak FLOP/s grew faster than HBM bandwidth and interconnect.
The denominator ran away. **MFU is a ratio, and half of what you are measuring
is the hardware's own imbalance.** Teach it as such, otherwise students read 40%
as failure. A sober target for a well-tuned dense BF16 pretraining run on H100
today is **35–50%**; below 30% means something is broken; above 55% means you
should check whether you are counting sparsity or forgetting the attention term.

### 1.8 End-to-end worked example

**Question:** you have 512 H100 SXM. How long to train a Chinchilla-optimal
model on 2T tokens, and what model size?

```
Peak dense BF16 per GPU     = 989.5e12 FLOP/s
Assume MFU                  = 0.40
Effective per GPU           = 395.8e12 FLOP/s
Cluster effective           = 512 × 395.8e12 = 2.027e17 FLOP/s

Chinchilla: D = 20N,  C = 6ND = 120 N²
Given D = 2e12  ->  N = 1e11 = 100 B params
C = 6 · 1e11 · 2e12 = 1.2e24 FLOPs

Time = 1.2e24 / 2.027e17 = 5.92e6 s = 68.5 days
```

Then sanity-check the memory: `N=100e9 × 16 bytes = 1.6 TB` of model state.
Across 512 GPUs with ZeRO-3/FSDP that is 3.1 GB/GPU of model state — fine.
Without sharding it is 1.6 TB on every GPU — impossible. The parallelism
strategy is *forced* by this line, not chosen.

That two-paragraph calculation is the entire skill this section teaches.

---
## 2. Attention as a memory-bound problem, and FlashAttention as the answer

This section is the capstone of the whole hardware curriculum. It is the place
where "arithmetic intensity" stops being a slide and becomes a 2–4× speedup that
every model in the world now uses. Teach it slowly.

### 2.1 What naive attention actually does to memory

For one head, `N` = sequence length, `d` = head dimension:

```
S = Q Kᵀ / √d      Q,K,V : N × d        S : N × N
P = softmax(S)                          P : N × N
O = P V                                 O : N × d
```

A straightforward PyTorch implementation is four kernels, and every arrow below
is a full round-trip through HBM:

| Kernel | reads | writes | FLOPs |
|---|---|---|---|
| `S = Q @ K.T` | `2Nd` | `N²` | `2N²d` |
| `S /= √d`, mask | `N²` | `N²` | `~2N²` |
| `P = softmax(S)` | `N²` (×2–3 passes) | `N²` | `~5N²` |
| `O = P @ V` | `N² + Nd` | `Nd` | `2N²d` |

**HBM traffic: `Θ(Nd + N²)`.** This is Theorem 2 of
[2205.14135](https://arxiv.org/abs/2205.14135), read verbatim.

**Arithmetic intensity.** Total useful FLOPs `≈ 4N²d`. Total bytes at 2 bytes per
element `≈ 2·(4N² + 4Nd) → 8N²` for `N ≫ d`:

```
intensity ≈ 4N²d / 8N² = d/2
```

For `d = 128`: **64 FLOP/byte**, against an H100 ridge point of **295**. Naive
attention can therefore reach at most ~22% of peak *even if every kernel is
perfect*. And that is the optimistic reading — the softmax kernels on their own
do a handful of FLOPs per element they load, i.e. intensity ~1, and they are
where the time actually goes. **The two GEMMs are fine. The elementwise passes
between them are the disaster**, and they exist only because the GEMMs were
forced to hand each other a full `N×N` matrix through HBM.

Notice what is *not* the problem: it is not that attention is `O(N²)` in FLOPs.
Modern GPUs eat `O(N²)` FLOPs happily. The problem is that it is `O(N²)` in
**memory traffic and memory capacity**, and those are the scarce resources.
Every "efficient attention" paper before FlashAttention attacked the FLOPs
(sparsity, low-rank, linear attention) and got little or no wall-clock win,
because they were optimising the resource that was not binding. That is the
lesson, and it is worth stating out loud to a student before showing the fix.

### 2.2 The FlashAttention idea in one sentence

> Tile the computation so that the `N×N` matrix is produced, consumed and
> discarded entirely inside SRAM, and never touches HBM at all.

If you can do that, the traffic drops from `Θ(N² + Nd)` to `Θ(Nd)` — you read
`Q, K, V` and write `O`, and nothing else. Intensity becomes

```
4N²d / (8Nd) = N/2
```

At `N = 8192` that is **4096 FLOP/byte**, thirteen times past the ridge point.
The operation flips from bandwidth-bound to comfortably compute-bound.

The obstacle is **softmax**, which is not local: `softmax(S)[i,j]` depends on the
entire row `i`. You cannot process a tile of `S` without knowing the row's
maximum and the row's sum of exponentials, and you cannot know those until you
have seen every column. Resolving that is the online softmax trick.

### 2.3 Online softmax — the full derivation

**This is the heart of the section. Do not compress it.**

#### 2.3.1 The safe softmax and why it needs three passes

For a vector `x ∈ ℝ^N`, `softmax(x)_i = e^{x_i} / Σ_j e^{x_j}`. Computed
literally this overflows: `e^{x}` for `x > 88` is `inf` in fp32, and for `x > 11`
it is `inf` in fp16. The standard fix subtracts the max, which is exact because

```
  e^{x_i - m}         e^{x_i} e^{-m}        e^{x_i}
─────────────  =  ───────────────────  =  ──────────    for any constant m
Σ_j e^{x_j - m}    Σ_j e^{x_j} e^{-m}     Σ_j e^{x_j}
```

The `e^{-m}` factors cancel. Choosing `m = max_i x_i` makes the largest exponent
exactly `e^0 = 1`, so nothing overflows. This gives the **three-pass** algorithm:

```
pass 1:  m  = max_i x_i
pass 2:  l  = Σ_i exp(x_i - m)
pass 3:  y_i = exp(x_i - m) / l
```

Three full reads of `x` from memory. Pass 2 cannot start until pass 1 finishes,
because it needs `m`. **That serialisation is the enemy** — it is what forces
`S` to be materialised.

#### 2.3.2 Milakov & Gimelshein: fusing passes 1 and 2

[arXiv 1805.02867](https://arxiv.org/abs/1805.02867). Maintain, after having seen
the first `j` elements, a *running* pair:

```
m_j = max(x_1, …, x_j)                      the running max
d_j = Σ_{i=1}^{j} exp(x_i − m_j)            the running sum, w.r.t. the CURRENT max
```

The recurrence:

```
m_j = max(m_{j−1}, x_j)
d_j = d_{j−1} · exp(m_{j−1} − m_j)  +  exp(x_j − m_j)
       └──────────────┬───────────┘
             the rescaling factor
```

**Why the factor is exactly `exp(m_{j−1} − m_j)` — the whole proof:**

```
d_{j−1}  =  Σ_{i<j} exp(x_i − m_{j−1})            by definition

want:       Σ_{i<j} exp(x_i − m_j)                the same sum, new max

exp(x_i − m_j)  =  exp(x_i − m_{j−1} + m_{j−1} − m_j)
                =  exp(x_i − m_{j−1}) · exp(m_{j−1} − m_j)

so       Σ_{i<j} exp(x_i − m_j)  =  exp(m_{j−1} − m_j) · Σ_{i<j} exp(x_i − m_{j−1})
                                 =  exp(m_{j−1} − m_j) · d_{j−1}          ∎
```

The correction is a **single scalar multiply on the accumulator**. It costs one
FLOP per update, not `O(j)`, because the old max factors out of the whole sum.
That is the entire reason this works.

**Two properties to point out explicitly:**

1. `m_j ≥ m_{j−1}` always, so `m_{j−1} − m_j ≤ 0`, so the factor
   `exp(m_{j−1} − m_j) ∈ (0, 1]`. **The correction can only shrink the
   accumulator, never grow it.** Rescaling can therefore never *introduce* an
   overflow. This is what makes the algorithm numerically safe, not merely
   algebraically correct.
2. Base case `m_0 = −∞`, `d_0 = 0`. In code use `m_0 = -inf` with the convention
   `0 · exp(-inf - m) = 0`, or special-case the first block. (Getting `NaN` from
   `inf - inf` here is the classic first bug; a fully-masked row in causal
   attention hits it for real.)

#### 2.3.3 The block form

FlashAttention does not process elements one at a time, it processes **tiles**.
Merging two already-summarised blocks `x⁽¹⁾` (stats `m₁, ℓ₁`) and `x⁽²⁾`
(stats `m₂, ℓ₂`):

```
m  =  max(m₁, m₂)
ℓ  =  e^{m₁ − m} · ℓ₁  +  e^{m₂ − m} · ℓ₂
```

Read verbatim from [2205.14135](https://arxiv.org/abs/2205.14135). This is an
**associative, commutative monoid** on pairs `(m, ℓ)` with identity `(−∞, 0)`.
That is not an aside — it is why the trick composes at every level of the
hierarchy: across elements within a thread, across threads in a warp (via warp
shuffles), across warps in a block (via shared memory), across blocks, and in
Ring Attention (§4.6) **across GPUs**. One reduction operator, five levels.

#### 2.3.4 The part everyone forgets: rescaling the *output*

Fixing up the denominator is easy. The genuinely non-obvious step is that the
**output accumulator** must be rescaled too, because each partial product
`p·v` was computed against a stale maximum.

Maintain, for one block of `B_r` query rows, after processing `j` key/value
blocks:

```
m⁽ʲ⁾ ∈ ℝ^{B_r}     running row-max of all scores seen so far
ℓ⁽ʲ⁾ ∈ ℝ^{B_r}     running sum of exp(score − m⁽ʲ⁾)
O⁽ʲ⁾ ∈ ℝ^{B_r×d}   running UNNORMALISED output = Σ_{seen} exp(s − m⁽ʲ⁾) · v
```

Arrival of key/value block `j+1`, whose scores are the tile `S⁽ʲ⁺¹⁾ ∈ ℝ^{B_r×B_c}`:

```
1.  m̃        = rowmax(S⁽ʲ⁺¹⁾)                         B_r
2.  m⁽ʲ⁺¹⁾   = max(m⁽ʲ⁾, m̃)                           B_r
3.  α        = exp(m⁽ʲ⁾ − m⁽ʲ⁺¹⁾)                     B_r   ← the ONE scalar per row
4.  P̃        = exp(S⁽ʲ⁺¹⁾ − m⁽ʲ⁺¹⁾)                    B_r×B_c
5.  ℓ⁽ʲ⁺¹⁾   = α · ℓ⁽ʲ⁾  +  rowsum(P̃)                 B_r
6.  O⁽ʲ⁺¹⁾   = diag(α) · O⁽ʲ⁾  +  P̃ · V⁽ʲ⁺¹⁾           B_r×d
                └────┬────┘
        the same α that rescales ℓ also rescales O

final:  O = diag(ℓ⁽ᵀ⁾)⁻¹ · O⁽ᵀ⁾
```

**Proof that step 6 is correct (induction).** Inductive hypothesis:
`O⁽ʲ⁾ = Σ_{i ∈ seen} exp(s_i − m⁽ʲ⁾) · v_i`. Then

```
diag(α) O⁽ʲ⁾ = Σ_{i∈seen} exp(m⁽ʲ⁾ − m⁽ʲ⁺¹⁾) · exp(s_i − m⁽ʲ⁾) · v_i
             = Σ_{i∈seen} exp(s_i − m⁽ʲ⁺¹⁾) · v_i
```

and `P̃ V⁽ʲ⁺¹⁾ = Σ_{i ∈ block j+1} exp(s_i − m⁽ʲ⁺¹⁾) · v_i`, so the sum is
`Σ_{i ∈ seen ∪ block j+1} exp(s_i − m⁽ʲ⁺¹⁾) v_i`, which re-establishes the
hypothesis at `j+1`. Base `O⁽⁰⁾ = 0`, `ℓ⁽⁰⁾ = 0`, `m⁽⁰⁾ = −∞`. ∎

**The result is bit-for-bit the same mathematics as full softmax.**
FlashAttention is *exact*, not an approximation — this is the point the paper
title makes and the point that separates it from every preceding "efficient
attention" method. Floating-point rounding differs (different summation order),
but there is no algorithmic error term. An exercise that asserts
`allclose(flash, naive, rtol=1e-3)` and *fails* is almost always a bug in the
student's `-inf` handling, not a real numerical limit.

**The cost of the trick.** Step 6 is `B_r × d` extra multiplies per inner
iteration. Those are **non-matmul FLOPs**: they run on the CUDA cores / MUFU
units, not the tensor cores. On an H100 the tensor cores do BF16 matmul at
989 TFLOP/s while the special-function units do `exp` at roughly 1/250th of
that (FA-3 quotes "~250× lower throughput"). So a non-matmul FLOP is worth
hundreds of matmul FLOPs in wall-clock terms. **Minimising them is the entire
subject of FlashAttention-2.**

### 2.4 The FlashAttention algorithm and its IO complexity

Structure (FA-1, [2205.14135](https://arxiv.org/abs/2205.14135) Algorithm 1):

```
outer loop over K,V blocks j = 1..T_c:
    load K_j, V_j  (B_c × d)  HBM → SRAM
    inner loop over Q blocks i = 1..T_r:
        load Q_i, O_i, ℓ_i, m_i  HBM → SRAM
        S_ij = Q_i K_jᵀ                       (in SRAM, never leaves)
        online-softmax update of m_i, ℓ_i, O_i
        write back O_i, ℓ_i, m_i
```

**Block sizes**, chosen so every tile fits in SRAM of size `M`:

```
B_c = ⌈M / (4d)⌉
B_r = min(⌈M / (4d)⌉, d)
```

(verbatim from Algorithm 1 line 1). The `4d` is "four `d`-wide tiles must be
resident": `Q_i`, `K_j`, `V_j`, `O_i`.

**Theorem 2 — the IO complexity result**, verbatim:

| | HBM accesses |
|---|---|
| standard attention | `Θ(N d + N²)` |
| FlashAttention | `Θ(N² d² M⁻¹)` |

Ratio = `N²d² / (M · N²) = d²/M`. With `d = 64` and `M ≈ 100 KB`,
`d²/M = 4096/100000 ≈ 0.04`, i.e. ~25× fewer accesses; the paper reports up to
**9×** measured. **The `M⁻¹` is the interesting part**: FlashAttention's traffic
is *inversely proportional to the size of on-chip SRAM*. That is a direct,
quantitative reason to care about the 228 KB of shared memory per SM on Hopper
(see `nvidia-architectures.md`) — bigger SRAM is not a nicety, it linearly
reduces the DRAM traffic of the single most important kernel in ML.

The paper also proves FlashAttention is **optimal** for a range of SRAM sizes:
no exact-attention algorithm can do asymptotically better in this model.

**End-to-end wins reported:** BERT-large (seq 512) **15%** faster than the
MLPerf 1.1 record; GPT-2 (seq 1K) **3×**; long-range arena (1K–4K) **2.4×**.
Notice the pattern — the win grows with sequence length, exactly as §1.4's table
predicts.

### 2.5 The backward pass: trading FLOPs for bandwidth on purpose

Backprop through attention needs `S` and `P` (the `N×N` matrices). The whole
point was to not store them. So FlashAttention **recomputes them**.

Stored for backward: only `O` (`N×d`) and the softmax statistics `m, ℓ` — two
`O(N)` vectors. During backward, for each tile, `S_ij` and `P_ij` are rebuilt
from `Q_i, K_j` in SRAM using the saved `m_i, ℓ_i` (no second max/sum pass is
needed — the statistics are already known, so the recomputation is a plain
`exp`, not another reduction).

```
FLOPs:      higher than standard backward (extra QKᵀ)
HBM traffic: dramatically lower (no N² read)
Wall clock:  net faster
```

**This is the cleanest example in all of ML systems of deliberately doing more
arithmetic to do less I/O.** It is the same trade as gradient checkpointing but
applied surgically to the one tensor that is `O(N²)`. Make the student say out
loud: *"I chose to burn FLOPs because FLOPs were not the binding constraint."*

Aside: this generalises. Megatron's **selective activation recomputation**
([2205.05198](https://arxiv.org/abs/2205.05198)) is the same insight in a
different clothing — recompute the attention block because it has "large input
sizes" but "very low" FLOPs per element, and leave the FLOP-dense MLP alone.
Recompute what is cheap in FLOPs and expensive in bytes. That is the rule.

### 2.6 FlashAttention-2: the same algorithm, better scheduled

[arXiv 2307.08691](https://arxiv.org/abs/2307.08691). FA-1 got ~25–40% of peak;
GEMM gets 80–90%. FA-2 closes most of the gap with three changes, **none of
which alter the mathematics**.

**(a) Fewer non-matmul FLOPs.** Two documented tweaks (§3.1, quoted):

1. Keep an **un-scaled** output accumulator and divide by `ℓ` only once, at the
   very end, instead of every iteration:
   `Õ⁽²⁾ = diag(ℓ⁽¹⁾)⁻¹ O⁽¹⁾ + e^{S⁽²⁾−m⁽²⁾} V⁽²⁾` becomes an un-normalised
   recurrence with a single final `diag(ℓ⁽ᵀ⁾)⁻¹`. This removes `T_c − 1`
   divisions per row per head.
2. "We do not have to save both the max `m⁽ʲ⁾` and the sum of exponentials
   `ℓ⁽ʲ⁾` for the backward pass. We only need to store the logsumexp
   `L⁽ʲ⁾ = m⁽ʲ⁾ + log(ℓ⁽ʲ⁾)`." Halves the saved statistics, and the backward
   recomputes `P = exp(S − L)` directly in one step.

**(b) Parallelise over sequence length.** FA-1 assigned one thread block per
(batch, head) — fine when `batch × heads ≥ #SMs`, useless when it is not. Long
context forces small batches, so exactly in the regime you care about, the GPU
sits half-idle. FA-2 swaps the loop order (outer loop over **query** row blocks,
inner over key column blocks), which makes different query blocks completely
independent — no shared accumulator — so it "additionally parallelize[s] over
the sequence length dimension." (The paper credits Triton with doing this first.)

**(c) Split-Q instead of split-K warp partitioning.** Within a thread block:

| | FA-1 "split-K" | FA-2 "split-Q" |
|---|---|---|
| what is split across the 4 warps | `K`, `V` | `Q` |
| what is shared | `Q` | `K`, `V` |
| consequence | each warp has a *partial* result for the same query rows → "all warps need to write their intermediate results out to shared memory, synchronize, then add up" | "There is no need for communication between warps" |

Each warp owns whole query rows, so it owns the whole online-softmax state for
those rows. No cross-warp reduction, no `__syncthreads` in the inner loop.

**Result:** 50–73% of theoretical max FLOP/s on A100 (vs ~25–40% for FA-1),
**≈2× speedup over FlashAttention**, and **225 TFLOP/s per A100 = 72% MFU** for
end-to-end GPT training. That 72% is the highest MFU number in this document,
and it is worth pausing on: it is what happens when the dominant kernel stops
being bandwidth-bound.

### 2.7 FlashAttention-3: Hopper-specific asynchrony

[arXiv 2407.08608](https://arxiv.org/abs/2407.08608). FA-2 on H100 achieved only
~35% utilization, because it was written for a synchronous machine and Hopper is
an asynchronous one. Three techniques:

**(a) Producer–consumer warp specialisation over TMA.** Warps split into
*producer* warps that issue non-blocking **TMA** (Tensor Memory Accelerator)
copies GMEM→SMEM, and *consumer* warps that do the math. A multi-stage circular
SMEM buffer keeps the producer from overwriting a stage the consumer still
needs; consumers signal completion to release a stage. This is a hardware
producer/consumer queue — the memory pipeline runs ahead of the compute pipeline
instead of blocking it. (TMA and the async barrier machinery are described in
`nvidia-architectures.md`; this is the flagship application.)

**(b) Pingpong scheduling — overlapping softmax with GEMM.** The paper's key
observation: `exp` on the multi-function units has **~250× lower throughput**
than matmul on the tensor cores. So *never let the tensor cores wait for a
softmax*. Two warpgroups alternate: while warpgroup A runs its GEMMs on the
tensor cores, warpgroup B runs its softmax on the MUFUs, and vice versa. Plus an
**intra-warpgroup 2-stage pipeline**: issue the *next* block's `QKᵀ` (GEMM₀)
asynchronously while still doing the current block's softmax and `PV` (GEMM₁),
with the scores held in registers. Both are pure scheduling — the arithmetic is
identical.

**(c) FP8.** Two problems and their fixes:

- *Outliers.* **Block quantization**: one scale per `B_r × d` or `B_c × d` block
  rather than per tensor, so a single outlier only poisons its own tile.
  **Incoherent processing**: multiply `Q` and `K` by a random orthogonal matrix
  (random ±1 diagonal composed with a Hadamard transform) before quantizing.
  Since `(QM)(KM)ᵀ = Q M Mᵀ Kᵀ = QKᵀ` for orthogonal `M`, the scores are
  mathematically unchanged, but the outlier energy is spread across all
  coordinates. The transform is `O(d log d)` and is fused into the RoPE kernel,
  so it is nearly free.
- *Layout.* FP8 WGMMA demands k-major operands, but `V` is naturally stored
  head-contiguous. FA-3 does an **in-kernel transpose** with `LDSM`/`STSM`, and
  uses byte-permute instructions to reconcile the FP32 accumulator's register
  layout with the FP8 operand layout. (Cross-reference `fp4-fp8-blackwell.md`
  for the format details; this is what the format costs you in a real kernel.)

**Measured:** FP16 **740 TFLOP/s = 75% utilization** on H100, **1.5–2.0× over
FA-2**; FP8 approaching **1.2 PFLOP/s**; and **2.6× lower RMSE** than baseline
per-tensor FP8 attention.

### 2.8 What the FlashAttention arc teaches

Lay the three papers side by side and the curriculum writes itself:

| | FA-1 (2022) | FA-2 (2023) | FA-3 (2024) |
|---|---|---|---|
| Level of the machine attacked | **memory hierarchy** (HBM vs SRAM) | **execution resources** (warps, SMs, non-matmul units) | **asynchrony + precision** (TMA, warp specialisation, FP8) |
| Change to the maths | tiling + online softmax | none | none |
| Peak achieved | ~25–40% (A100) | 50–73% (A100) | 75% (H100 FP16) |

Three papers, one algorithm, and every improvement after the first is a
scheduling change against a specific hardware feature. **That is the shape of
almost all real ML-systems work**, and it is why a researcher who understands
the machine has an unfair advantage: the algorithmic insight (online softmax)
had existed since 2018 and was sitting unused in a NVIDIA tech report until
someone connected it to the memory hierarchy.

---
## 3. Inference is a different problem from training

### 3.1 The one idea: tokens processed per weight load

Every weight matmul in a transformer has the same structure: load `W` from HBM,
push `T` token-vectors through it. So:

```
FLOPs   = 2 · (params of W) · T
bytes   = (params of W) · (bytes per element)          ← W loaded ONCE
                            2 · params · T
arithmetic intensity  =  ──────────────────  =  T      (at 2 bytes/element)
                              2 · params
```

**Arithmetic intensity of a weight matmul equals the number of tokens processed
per weight load.** That single sentence generates the whole of §3:

| Regime | `T` | Intensity | vs H100 ridge (295) |
|---|---|---|---|
| Training, microbatch `b`, seq `s` | `b·s` | thousands | compute-bound ✔ |
| **Prefill**, one request of length `s` | `s` | `s` | compute-bound for `s > 295` ✔ |
| **Decode**, batch `B`, one token each | `B` | `B` | **memory-bound unless `B > 295`** ✘ |
| Decode + continuous batching | `B` bigger | better | the point of vLLM |
| Decode + speculative, `γ` drafts | `B(γ+1)` | better | the point of §3.6 |
| Chunked prefill mixed with decodes | `chunk + B` | better | the point of §3.7 |

Everything in the serving literature is a scheme for raising `T`. Say that once
and the rest of the section is memorable rather than a list of acronyms.

### 3.2 Prefill vs decode, concretely

| | **Prefill** | **Decode** |
|---|---|---|
| Input | whole prompt, `s` tokens | 1 token per sequence |
| Shape of weight matmuls | GEMM, `M = b·s` | GEMV-ish, `M = B` |
| Bound by | tensor cores | **HBM bandwidth** |
| FLOPs | `2N·s` per request | `2N` per token |
| Attention cost | `O(s²)` — the quadratic bit lives here | `O(s)` per token — read the KV cache |
| Latency metric | **TTFT** (time to first token) | **TPOT** (time per output token) |
| Parallelism that helps | TP, and more FLOPs | more memory bandwidth, bigger batch |
| Typical MFU | 40–60% | **< 5%**, often < 1% |

Decode also reads the **KV cache** each step, which is a second bandwidth term
that grows with context. At long context the KV cache read can exceed the weight
read, and decode becomes KV-bandwidth-bound rather than weight-bandwidth-bound —
which changes which optimisation helps (GQA/MLA, not weight quantisation).

### 3.3 The KV cache

**Size formula.** Per token, per sequence:

```
KV bytes/token = 2 (K and V) × L × n_kv × d_h × bytes_per_element
```

and total `= KV bytes/token × s × batch`. Note `n_kv · d_h = d` only for MHA;
with GQA it is `(h_kv/h)·d`.

| Model | `2·L·n_kv·d_h·2B` | per token | 8k ctx, 1 seq | 128k ctx, 1 seq |
|---|---|---|---|---|
| Llama-3-8B (GQA 8) | `2·32·8·128·2` | **128 KiB** | 1.0 GiB | 16 GiB |
| Llama-3-70B (GQA 8) | `2·80·8·128·2` | **320 KiB** | 2.5 GiB | **40 GiB** |
| Llama-3-70B *if MHA* (64 heads) | `2·80·64·128·2` | 2.5 MiB | 20 GiB | **320 GiB** |

Read the last two rows together: **GQA with 8 groups instead of 64 heads is the
difference between a 128k-context 70B model needing 40 GB of cache and needing
320 GB.** That is not an optimisation, it is the difference between the feature
existing and not existing.

**Why it dominates at long context.** Llama-3-70B weights in BF16 are ~141 GB —
fixed. KV grows linearly in `s × batch`. Crossover for a single sequence is at
`141e9 / 327680 = 430,000` tokens; but with a batch of 32 at 32k context the KV
is `32 × 32768 × 320 KiB ≈ 336 GiB`, already 2.4× the weights. **In production,
KV cache — not weights — is what you run out of.**

**Max-batch arithmetic** (a good exercise). Llama-3-8B BF16 on one 80 GB H100:

```
weights            = 8.03e9 × 2      = 16.1 GB
CUDA ctx + activations + frag        ≈  4 GB
KV budget                            ≈ 60 GB
per-sequence KV at 8k ctx = 8192 × 131072 B = 1.074 GB
max concurrent sequences = 60 / 1.074 = 55
```

55 concurrent sequences → decode intensity `T = 55`, against a ridge point of
295. **Still memory-bound, by 5×, even at maximum batch.** That is why §3.6 and
weight quantisation exist.

**The optimisations, in order of how much they buy:**

| Scheme | KV elements/token | vs MHA | Cost |
|---|---|---|---|
| **MHA** | `2·h·d_h·L` | 1× | — |
| **MQA** (1 KV head) | `2·d_h·L` | `1/h` (e.g. 64×) | measurable quality loss; the GQA paper: "MQA can lead to quality degradation" |
| **GQA** (`g` groups) | `2·g·d_h·L` | `h/g` (e.g. 8×) | near-MHA quality at near-MQA speed; uptrainable from an MHA checkpoint with **5% of original pretraining compute** ([2305.13245](https://arxiv.org/abs/2305.13245)) |
| **MLA** (DeepSeek-V2) | `(d_c + d_hᴿ)·L` | ~57× at their config | extra up-projection FLOPs, and the decoupled-RoPE complication |
| **FP8 KV** | same count, 1 byte | 2× on top | small accuracy cost, needs per-tensor/per-head scales |
| **INT4 KV** | same count, ½ byte | 4× on top | needs care (see caveat below) |

**MLA in detail** ([2405.04434](https://arxiv.org/abs/2405.04434) §2.1). Instead
of caching `K` and `V`, cache a single low-rank **latent** `c_t^{KV} = W^{DKV} h_t`
of dimension `d_c ≪ h·d_h`, and reconstruct at use time with
`k_t^C = W^{UK} c_t^{KV}`, `v_t^C = W^{UV} c_t^{KV}`. At inference `W^{UK}` can
be absorbed into `W^Q` and `W^{UV}` into the output projection, so the
reconstruction is free — **except** that this absorption breaks under RoPE:
"if we apply RoPE for the keys `k_t^C`, `W^{UK}` will be coupled with a
position-sensitive RoPE matrix" and can no longer be commuted past `W^Q`.
The fix is **decoupled RoPE**: carry position information in a small extra
query/key pair of per-head dimension `d_h^R` that is *not* compressed, cached
alongside the latent. Hence the cache size `(d_c + d_h^R)·L`. DeepSeek-V2 uses
`d_c = 4d_h`, `d_h^R = d_h/2`, `n_h = 128`, `d_h = 128`, giving
`(512+64) = 576` elements/layer versus MHA's `2·128·128 = 32,768` — a **56.9×**
reduction, which the paper describes as equivalent to GQA with 2.25 groups while
"outperform[ing]" standard MHA on quality. The overall claim is a **93.3%** KV
cache reduction versus DeepSeek 67B.

*Caveat on quantised KV:* the literature (KIVI and successors) reports that `K`
and `V` want *different* quantisation axes — `K` per-channel, `V` per-token —
because the outlier structure differs. I did not read those papers for this
file; treat the specific recipe as **unverified** and see the closing section.

### 3.4 PagedAttention / vLLM — the virtual-memory analogy is exact

[SOSP 2023, arXiv 2309.06180](https://arxiv.org/abs/2309.06180). Teach this by
drawing the OS diagram from the operating-systems unit and relabelling it.

**The problem.** Pre-vLLM systems allocate KV cache as one **contiguous** buffer
per request, sized for the maximum possible output length. Three wastes,
measured in Figure 2 of the paper: **only 20.4%–38.2% of allocated KV memory
actually holds token state.** 60–80% is pure waste.

| Waste | Cause |
|---|---|
| **Internal fragmentation** | reserved for `max_len` = 2048 but the reply was 30 tokens |
| **External fragmentation** | different requests reserve different-sized chunks, leaving unusable gaps |
| **Over-reservation** | space held for tokens *not yet generated* blocks other requests from using it now |

If you have taught `malloc`, `sbrk`, and the reason we stopped doing contiguous
segment allocation in the 1960s, the student already knows the fix.

**The mapping, one-to-one:**

| Operating system | PagedAttention |
|---|---|
| process | request / sequence |
| virtual address space | logical KV blocks — contiguous, per sequence |
| page (4 KiB) | **KV block** (fixed count of tokens, e.g. 16) |
| physical page frame | physical KV block in HBM |
| page table | **block table** |
| MMU address translation | attention kernel dereferences the block table per block |
| demand paging | allocate a block only when the sequence actually grows into it |
| `fork()` + copy-on-write | parallel sampling / beam search share prompt blocks, COW on divergence |
| shared library pages | **prefix caching** — one physical copy of a shared system prompt |
| swap to disk | preemption: evict a sequence's blocks to CPU RAM, or drop and recompute |
| internal fragmentation | bounded to **≤ 1 block per sequence** (the last, partial block) |
| external fragmentation | **eliminated** — all blocks are the same size |

**The one place the analogy is not free.** An MMU does translation in hardware,
at zero marginal cost. PagedAttention does it in the attention kernel, in
software: the kernel must gather non-contiguous blocks, which costs some
addressing overhead and prevents the neat contiguous strided loads a fused
kernel would prefer. vLLM pays a few percent of kernel throughput to recover
60–80% of memory, and at these ratios that is not a close call. Point this out —
it is a good demonstration that "the OS analogy is exact" does not mean "the
costs are identical."

**Measured wins:** 2–4× throughput at the same latency versus FasterTransformer
and Orca; memory savings from sharing of **6.1–30.5%** for parallel sampling and
**37.6–66.3%** for beam search.

### 3.5 Continuous vs static batching

**Static batching:** form a batch of `B` requests, run them all until the
*longest* finishes, then form the next batch. A request that emits 20 tokens
sits in the batch occupying a KV slot and a GPU lane for the 2000 steps its
neighbour needs. Utilisation collapses as the output-length distribution widens
— and for LLM traffic it is very wide.

**Continuous batching** (iteration-level scheduling, from Orca; what vLLM
implements): the scheduler runs **one decode step at a time** and re-forms the
batch every step. A sequence that emitted EOS is removed immediately and a
queued request takes its slot on the very next iteration. Combined with paging,
admission is cheap because a new sequence needs only its first block, not a
contiguous max-length reservation.

The two ideas are co-dependent: continuous batching without paging keeps hitting
"no contiguous region free"; paging without continuous batching leaves the freed
blocks unused until the batch drains. Together they are the reason a modern
server sustains 10–20× the throughput of a naive `model.generate` loop.

### 3.6 Speculative decoding

[arXiv 2211.17192](https://arxiv.org/abs/2211.17192), Leviathan, Kalman, Matias.

**The systems argument first.** Decode is memory-bound: a forward pass of the
target model costs one full weight read regardless of whether you push 1 token
or 8 through it. So *validating* 8 candidate tokens costs almost exactly what
generating 1 costs. If you can guess the next few tokens cheaply, verification
is free. `T` goes from `B` to `B(γ+1)` at no extra bandwidth.

**The algorithm.** Draft model `q` (small, fast, cost ratio `c` of the target),
target model `p`. Each iteration:

1. Run the draft autoregressively for `γ` steps, sampling `x₁..x_γ ~ q`.
2. Run the target **once** on the whole prefix + `γ` drafts, obtaining
   `p(·|prefix), p(·|prefix,x₁), …` in a single forward pass (this is the trick —
   causal masking means one pass gives all `γ+1` conditional distributions).
3. Walk the drafts left to right. Accept `x_i` with probability
   `min(1, p(x_i)/q(x_i))`. On the first rejection, resample that position from
   the **residual distribution**
   ```
   p'(x) = norm( max(0, p(x) − q(x)) )
   ```
   and stop.
4. If all `γ` are accepted, additionally sample a free token from
   `p(·|prefix, x₁..x_γ)` — the target's own distribution at the last position,
   already computed in step 2.

**Why the output distribution is exactly `p`.** This is modified rejection
sampling. For any token `x`:

```
P(emit x) = P(draw x from q) · P(accept)  +  P(any rejection) · p'(x)
          = q(x) · min(1, p(x)/q(x))  +  (1 − β) · p'(x)
          = min(q(x), p(x))           +  (1 − β) · norm(max(0, p−q))(x)
```

The first term contributes `min(p,q)`, the second exactly makes up the
`max(0, p−q)` shortfall, and the two sum to `p(x)`. **The output is
distributionally identical to sampling from the target model alone** — this is
not an approximation, and it is the reason the technique was adopted instantly.
Same "exactness" selling point as FlashAttention, and worth naming as a pattern:
*the wins that stick are the ones that change nothing about the output.*

**The acceptance rate.** The paper defines `β` as the acceptance probability for
a single draw and `α = E[β]`, with the identity

```
α  =  1 − E[ D_LK(p, q) ]  =  E[ min(p, q) ]
```

i.e. `α` is one minus the expected total-variation-like divergence between draft
and target. **Expected tokens produced per iteration** (a truncated geometric):

```
E[#tokens]  =  (1 − α^{γ+1}) / (1 − α)
```

**Walltime improvement factor**, with `c` = draft cost / target cost:

```
speedup  =  (1 − α^{γ+1}) / ( (1 − α)(γc + 1) )
```

**Worked example.** `α = 0.8`, `γ = 4`, `c = 0.05` (a 1B draft for a 70B target):

```
E[#tokens] = (1 − 0.8⁵)/(0.2) = (1 − 0.32768)/0.2 = 3.36 tokens/iteration
speedup    = 3.36 / (4·0.05 + 1) = 3.36/1.20 = 2.80×
```

**Two things to notice.**

1. **A hard ceiling.** As `γ → ∞`, `E[#tokens] → 1/(1−α)`. At `α = 0.8` that is
   5 tokens no matter how long you draft. Meanwhile the `γc` in the denominator
   grows linearly. So there is an optimal `γ`, usually 3–8, and cranking it up
   makes things *worse*. Have students plot speedup vs `γ` for a few `α` — the
   shape teaches more than the formula.
2. **It stops working when you are compute-bound.** At large batch, decode is no
   longer memory-bound, so the "free" verification stops being free — every
   speculative token you reject is wasted compute. Speculative decoding is a
   *low-batch, latency-oriented* technique. Serving systems disable it under
   load. This is exactly the roofline reasoning from §3.1 applied backwards, and
   it is the kind of judgement that separates someone who understands the
   machine from someone who read a blog post.

Reported: **2×–3×** on T5-XXL with identical outputs, no retraining, no
architecture change.

Variants worth naming (not read in depth for this file): Medusa (extra decoding
heads instead of a separate draft model), EAGLE (drafting in feature space),
n-gram / prompt-lookup decoding (draft by copying from the prompt — free, and
startlingly effective for summarisation and code editing where output repeats
input).

### 3.7 Chunked prefill, prefix caching, disaggregation

**Chunked prefill** ([SARATHI, 2308.16369](https://arxiv.org/abs/2308.16369)).
Problem: a long prefill monopolises a step, stalling every decode in flight
(a latency spike users see as stuttering). Fix: split the prefill into
fixed-size chunks and, in each iteration, run **one prefill chunk plus as many
decodes as fit in the token budget** ("decode-maximal batching"). The decodes
ride along on compute the prefill was going to spend anyway — the paper notes
they "cost up to an order of magnitude less compared to a decode-only batch."
It also equalises the work per pipeline stage, cutting the pipeline bubble
**6.29×** for GPT-3. Reported: LLaMA-13B on A6000, up to **10×** decode
throughput and **1.33×** end-to-end; LLaMA-33B on A100, **4.25×** decode and
**1.25×** end-to-end; GPT-3 with pipeline parallelism, **1.91×** end-to-end.

In §3.1's terms: chunked prefill raises `T` for the decode requests from `B` to
`chunk_size + B` for free.

**Prefix caching.** If two requests share a prefix (system prompt, few-shot
examples, a document being asked several questions), their KV blocks for that
prefix are *identical*. With paging, sharing them is a block-table entry, not a
copy. Implementations hash block contents and keep an LRU pool. For agentic
workloads where a 4k-token system prompt precedes a 100-token query, this
removes ~97% of prefill work on a cache hit. It is the "shared library pages"
row of the §3.4 table, and the highest ratio of benefit to implementation effort
in the whole serving stack.

**Disaggregated prefill/decode** ([DistServe, OSDI 2024](https://arxiv.org/abs/2401.09670)).
Colocating the two phases means they interfere: a prefill blocks decodes (TTFT
work hurting TPOT), and the two phases want *different* parallelism strategies
and *different* amounts of hardware. DistServe puts them on separate GPU pools,
so each can "co-optimize the resource allocation and parallelism plan tailored
for each phase". The cost is shipping the KV cache from the prefill pool to the
decode pool; they mitigate by placing the pools according to cluster bandwidth.
Reported: **7.4× more requests** or **12.6× tighter SLO** with >90% of requests
meeting latency constraints.

Note the tension with chunked prefill: SARATHI says *mix* the phases, DistServe
says *separate* them. Both are right, for different objectives — mixing
maximises throughput on fixed hardware, separating maximises SLO attainment when
you can buy more hardware and specialise it. A good discussion question.

### 3.8 Inference quantisation, and why there are two families

The roofline explains the split, and this is the most useful thing to teach here:

| | **Weight-only** (W4A16) | **Weight+activation** (W8A8) |
|---|---|---|
| Examples | **GPTQ**, **AWQ** | **SmoothQuant** |
| What it fixes | bytes read per weight load | FLOPs and bytes |
| Helps | **decode** (bandwidth-bound) — 4× fewer weight bytes ⇒ up to 4× faster | **prefill** and large-batch decode (compute-bound) — real INT8 tensor-core math |
| Doesn't help | prefill much (you dequantise back to FP16 to feed the tensor cores) | small-batch decode much (activations were never the bottleneck) |

**GPTQ** ([2210.17323](https://arxiv.org/abs/2210.17323)). One-shot post-training
quantisation using approximate second-order information, derived from Optimal
Brain Quantization. Per linear layer, with a calibration set giving a Hessian
proxy `H ∝ XXᵀ`, quantise weights column by column; after fixing each column,
update the *remaining* unquantised columns to compensate for the error just
introduced (the update direction comes from `H⁻¹`, computed once via Cholesky).
3–4 bits with negligible degradation, 2-bit/ternary in the extreme. **175B
quantised in ~4 GPU hours**; inference **~3.25×** faster on A100, **4.5×** on
A6000; first time a 175B model ran on a single GPU for generative inference.

**AWQ** ([2306.00978](https://arxiv.org/abs/2306.00978)). Observation: "protecting
only 1% salient weights can greatly reduce quantization error" — and the salient
channels are identified by **activation** magnitude, not weight magnitude. (The
weights that matter are the ones that get multiplied by large activations. This
is obvious in hindsight and was not obvious before.) Rather than keeping 1% in
FP16 (which makes for an ugly mixed-precision kernel), AWQ applies an equivalent
per-channel **scaling** that protects those channels, with scales derived from
offline activation statistics. Crucially it "does not rely on any
backpropagation or reconstruction", so it does not overfit the calibration set
and generalises across domains better than GPTQ. Their TinyChat runtime reports
**>3×** over HuggingFace FP16 on desktop and mobile GPUs.

**SmoothQuant** ([2211.10438](https://arxiv.org/abs/2211.10438)). The core
insight: "weights are easy to quantize while activations are not" — LLM
activations have systematic per-channel outliers (100× the median in a few fixed
channels) that destroy per-tensor INT8. The fix is a mathematically equivalent
transformation that migrates the difficulty:

```
Y = X W  =  (X · diag(s)⁻¹) · (diag(s) · W)  =  X̂ Ŵ
```

Scaling down the outlier activation channels and scaling up the corresponding
weight rows leaves the product unchanged, but now both operands are quantisable.
The scale is chosen with a knob `α` trading the two off — `s_j = max|X_j|^α /
max|W_j|^{1−α}`, with `α = 0.5` splitting the difficulty evenly (`α` value
recalled, see caveats). Because `diag(s)⁻¹` can be folded into the preceding
LayerNorm, it is free at runtime. W8A8 across OPT/BLOOM/GLM/Llama/Falcon/Mistral
/Mixtral, up to **1.56×** speedup and **2×** memory reduction, and a 530B model
on a single node.

### 3.9 The roofline reason batch-size-1 decode is hopeless

Do this derivation on a whiteboard. It is short and it lands.

At batch 1, generating one token requires reading every weight once and doing
`2N` FLOPs:

```
time     ≥ (bytes_per_param · N) / B_HBM
FLOPs    = 2N
achieved = 2N / (bytes_per_param · N / B_HBM)  =  (2 / bytes_per_param) · B_HBM
```

In BF16 (`bytes_per_param = 2`) that is **exactly `B_HBM`** FLOP/s. So:

```
                  B_HBM         3.35e12               1
MFU at batch 1 = ───────  =  ──────────────  =  ─────────  =  0.34%
                 F_peak        989.5e12            295
```

**`N` cancelled.** Batch-1 decode MFU is `1/ridge_point` — a property of the
*machine*, not of the model. On an H100 it is 0.34% whether you are running a
1B model or a 405B model. There is no clever kernel that fixes this; you are
asking a machine built to do 295 FLOPs per byte to do 1.

Consequences, all of which follow immediately:

- **Peak tokens/s at batch 1** = `B_HBM / (2N)`. Llama-3-8B on one H100:
  `3.35e12 / 16.06e9 = 209 tok/s` — a hard ceiling, ignoring KV reads,
  attention, sampling and kernel launch overhead. Real systems reach 60–70% of
  it. If someone claims 400 tok/s at batch 1 for an 8B BF16 model on an H100,
  they are quantised, speculating, or wrong.
- **To reach 50% MFU you need `T ≈ 148`.** That is the entire justification for
  continuous batching, and it explains why per-token *latency* and system
  *throughput* are in direct opposition in LLM serving in a way they are not for
  most other workloads.
- **The three escapes** are exactly the three levers of §3.1 plus one: raise `B`
  (continuous batching), raise tokens-per-load (speculative decoding, chunked
  prefill), or **reduce the bytes** (weight-only quantisation — 4-bit weights
  quadruple the ceiling to ~836 tok/s, which is why W4A16 dominates local and
  latency-sensitive inference).
- **It is why inference hardware diverges from training hardware.** A chip for
  batch-1 decode wants bandwidth and capacity, not FLOPs. That is the whole
  thesis behind Groq's SRAM-resident design and Cerebras's wafer-scale memory,
  and it is why an H100's FP8 tensor cores are largely idle in a chat session.
  (See `amd-and-other-accelerators.md` for those architectures; this is the
  arithmetic that motivates them.)

---
## 4. Distributed training — the parallelism taxonomy

### 4.1 The taxonomy table

The organising question for every row: **what is split, what must be
communicated, how often, and can it be hidden?**

| Scheme | What is split | Replicated | Collective | When | Volume per step | Hideable? | Memory saved |
|---|---|---|---|---|---|---|---|
| **DDP** | the batch | everything (16 B/param) | all-reduce of gradients | once per step | `2·b_g·N` per rank | **yes**, bucketed + overlapped with backward | none |
| **ZeRO-1** | optimizer states | params, grads | reduce-scatter grads + all-gather params | once per step | `2·b_g·N` (**1×** DP) | yes | `4Ψ + 12Ψ/N_d` |
| **ZeRO-2** | + gradients | params | same | once per step | `2·b_g·N` (**1×** DP) | yes | `2Ψ + 14Ψ/N_d` |
| **ZeRO-3 / FSDP** | + parameters | nothing | all-gather params (fwd), all-gather params (bwd), reduce-scatter grads | per **layer/unit** | `3·b_p·N` (**1.5×** DP) | partly — prefetch, but on the critical path | `16Ψ/N_d` |
| **Tensor (Megatron)** | every weight matrix, and the activations | layer inputs/outputs | **all-reduce of activations** | **2× fwd + 2× bwd per layer** | `4·L·b·s·d·2` bytes | **NO** — on the critical path | `≈1/t` of weights + activations |
| **Sequence (Megatron SP)** | the LN/dropout regions, along `s` | — | reduce-scatter + all-gather (replaces TP's all-reduce) | same as TP | same total as TP | no | activations `/t` including the LN terms |
| **Context / Ring Attention** | the sequence, for attention | weights | ring P2P of K,V blocks | per attention layer | `4·c·d` bytes per ring step | **yes**, by construction | activations and KV `/N` |
| **Pipeline** | layers into stages | — | **P2P** send/recv of boundary activations | per microbatch per boundary | `b·s·d·2` bytes, small | yes, and it is P2P not a collective | weights + activations `/p` |
| **Expert (MoE)** | experts across devices | attention, router | **all-to-all** (dispatch + combine) | 2× per MoE layer | `2·tokens·d·2` bytes | partly | expert weights `/e` |

Two structural observations to state up front:

1. **The collectives get cheaper as you go down the table.** All-reduce of
   activations (TP) is the most punishing: it is on the critical path, happens
   four times per layer, and cannot be overlapped because the next operation
   consumes its result. Pipeline P2P is the cheapest: a single small tensor per
   microbatch boundary, and there is other work to do while it flies.
2. **Therefore the mapping to hardware is forced.** Put the expensive collective
   on the fast wire. TP inside an NVLink domain; DP across the slowest link you
   own. §4.8 makes this precise.

### 4.2 Data parallel / DDP

Each rank holds a full replica and a slice of the batch; after backward, average
gradients across ranks. It is the baseline everything else is measured against.

**The collective.** A ring all-reduce of `D` ranks over a buffer of `S` bytes
moves `2·S·(D−1)/D ≈ 2S` bytes per rank: a reduce-scatter phase
(`S(D−1)/D`) then an all-gather phase (`S(D−1)/D`). This decomposition matters —
ZeRO exploits it directly. (Wire-level detail in `networking-and-internet.md`.)

**Bucketing and overlap** (the reason DDP is fast at all). Gradients become
ready in **reverse layer order** during backward. PyTorch DDP groups parameters
into buckets (default 25 MB) and fires an asynchronous all-reduce as soon as
every gradient in a bucket has been produced. So the all-reduce for the last
layer's weights is already in flight while the first layer's backward is still
running. With enough buckets and enough compute, the communication disappears
entirely under the backward pass. Two failure modes worth teaching:

- **Buckets too small** → many tiny collectives, each paying latency; NCCL
  latency (~10 µs intra-node, ~50 µs+ inter-node) dominates.
- **Buckets too large** → the last bucket has nothing left to hide under, so its
  full duration is exposed.

**Memory:** DDP saves nothing. Every rank still carries `16Ψ` bytes of model
state. For anything above ~2B parameters on 80 GB cards that alone ends the
conversation, which is why ZeRO exists.

### 4.3 ZeRO 1/2/3 and FSDP

[ZeRO, arXiv 1910.02054](https://arxiv.org/abs/1910.02054). The observation: DDP
replicates `16Ψ` bytes on every one of `N_d` ranks, and **most of it is not
needed most of the time**. Optimizer states are touched once per step. Gradients
are needed only at the reduce. Parameters are needed only while their own layer
runs.

Verbatim from the paper, with `Ψ` = parameters, `K = 12` (the optimizer-state
multiplier: fp32 master + `m` + `v`), `N_d` = data-parallel degree:

| Stage | What is sharded | Memory formula | 7.5B model, `N_d=64` | Comm vs DP |
|---|---|---|---|---|
| baseline | nothing | `16Ψ` | **120 GB** | 1× |
| **P_os** (ZeRO-1) | optimizer states | `4Ψ + KΨ/N_d` | **31.4 GB** | **1×** |
| **P_os+g** (ZeRO-2) | + gradients | `2Ψ + 14Ψ/N_d` | **16.6 GB** | **1×** |
| **P_os+g+p** (ZeRO-3) | + parameters | `16Ψ/N_d` | **1.88 GB** | **1.5×** |

**Why stages 1 and 2 are free.** DDP's all-reduce already *is* a reduce-scatter
followed by an all-gather. ZeRO-1/2 just... stops in the middle. Reduce-scatter
the gradients so each rank owns `1/N_d` of them; that rank updates its `1/N_d`
of the parameters using its `1/N_d` of the optimizer state; then all-gather the
updated parameters. Total moved: `Ψ + Ψ = 2Ψ`, **identical to DDP's all-reduce**.
You got a 64× reduction in optimizer memory for exactly zero extra bytes on the
wire. This is the most favourable trade in the whole field and every student
should be made to notice it.

**Why stage 3 costs 1.5×.** Now no rank holds the full parameters, so before
each layer's forward you must all-gather that layer's parameters (`Ψ` total over
the step), free them, all-gather again during backward (`Ψ`), and reduce-scatter
the gradients (`Ψ`). `3Ψ` versus DDP's `2Ψ` = **1.5×**, exactly as the paper
states. The bytes are only part of the cost, though: the parameter all-gathers
sit **on the critical path** of each layer, unlike DDP's gradient all-reduce
which can lag behind. Prefetching layer `i+1`'s all-gather during layer `i`'s
compute recovers most of it, which is precisely what FSDP does.

**PyTorch FSDP** ([2304.11277](https://arxiv.org/abs/2304.11277)) is ZeRO-3
built into the framework. Its distinguishing engineering choice is the
**FlatParameter**: flatten and concatenate all parameters of a wrapped unit into
one 1-D tensor, then shard *that*. Consequence — one large collective per unit
instead of dozens of small ones, which is the difference between being
bandwidth-bound (good) and latency-bound (fatal) on the collective. It
all-gathers before forward and before backward, reduce-scatters gradients, and
overlaps by prefetching the next unit's all-gather.

Practical knobs worth knowing:

- **Wrapping granularity** is the central tuning decision. Too coarse (one unit
  = whole model) and you are back to DDP's memory. Too fine and you pay per-unit
  latency. One transformer block per unit is the standard answer.
- **`HYBRID_SHARD`**: shard within a node, replicate across nodes. Converts the
  expensive inter-node all-gathers into intra-node NVLink ones, at the cost of
  holding `world_size/nodes` replicas. Often the right default on a multi-node
  cluster with a weak inter-node fabric, and a direct application of §4.8's rule.
- **`reshard_after_forward=False`** keeps parameters gathered between forward and
  backward, trading memory for one fewer all-gather.

### 4.4 Tensor parallel (Megatron)

[arXiv 1909.08053](https://arxiv.org/abs/1909.08053). Split each weight matrix
across `t` GPUs so that a single layer's math is done cooperatively.

**The MLP: `Z = GeLU(X A) B`.**

Split `A` **column-wise**, `A = [A₁, A₂]`:

```
[Y₁, Y₂] = [GeLU(X A₁), GeLU(X A₂)]        ← no communication needed
```

Each GPU holds complete *columns* of `A`, so it produces complete columns of the
pre-activation and can apply the elementwise GeLU independently.

Split `A` **row-wise** instead and you would need `GeLU(X₁A₁ + X₂A₂)`, requiring
an all-reduce **before** the nonlinearity, because — the paper spells it out —
`GeLU(X₁A₁ + X₂A₂) ≠ GeLU(X₁A₁) + GeLU(X₂A₂)`. **The nonlinearity is what
determines the split direction.** That is the whole insight, and it is a
beautiful example of an algebraic property (non-additivity) dictating a
hardware-mapping decision.

Then split `B` **row-wise**, `B = [B₁; B₂]`, so `Z = Y₁B₁ + Y₂B₂` — a partial sum
per GPU, resolved by **one all-reduce**. Column-then-row is the canonical pair,
and it means only *one* communication for the entire MLP block.

**Attention.** Split by **head**: `Q, K, V` projections column-parallel so "the
matrix multiply corresponding to each attention head is done locally on one
GPU"; each GPU runs whole heads including its own softmax (no communication);
output projection row-parallel → **one all-reduce**. Note the elegance: attention
is *already* block-diagonal across heads, so it parallelises with zero
algorithmic effort. (This is also why `t` must divide the head count, and why
GQA complicates TP — `h_kv` may be smaller than `t`, forcing KV replication.)

**The `f`/`g` operator pair:**

| | forward | backward |
|---|---|---|
| `f` (at block entry) | identity | **all-reduce** |
| `g` (at block exit) | **all-reduce** | identity |

Conjugates. Per transformer layer: one `g` after attention, one `g` after the
MLP → **2 all-reduces forward**; their `f` conjugates → **2 all-reduces
backward**. The paper confirms "4 total communication operations in the forward
and backward pass of a single model parallel transformer layer."

**Why TP must stay inside a node — the arithmetic.** Take a 70B-class model,
`d = 8192`, `L = 80`, `t = 8`, microbatch of `b·s = 8192` tokens, BF16.

```
one all-reduce buffer  = 8192 tokens × 8192 dim × 2 B      = 134.2 MB
ring all-reduce moves  = 2 × 134.2 MB × (7/8)              = 235 MB per GPU
per layer: 4 of them; × 80 layers                          = 75.2 GB per step per GPU

over NVLink 4 (NCCL bus bw ≈ 400 GB/s):    75.2/400   =  188 ms
over 400 Gb/s InfiniBand (bus bw ≈ 50 GB/s): 75.2/50  = 1504 ms

compute for the same microbatch:
  6 · 70e9 · 8192 = 3.44e15 FLOPs, over 8 GPUs at 50% of 989.5 TFLOP/s
  = 3.44e15 / 3.96e15                                     =  869 ms
```

**Inside the node: 188 ms of communication under 869 ms of compute — 22%
overhead, and none of it hideable, but survivable. Across nodes: 1504 ms of
communication against 869 ms of compute — you would spend most of the run
waiting.** An 8× bandwidth difference turns a 22% tax into a 173% one. That is
the entire content of the rule "TP degree ≤ GPUs per NVLink domain", and it is
worth making a student compute rather than memorise.

**Reported scaling:** 8.3B parameters on 512 GPUs, 15.1 PetaFLOP/s, **76%
scaling efficiency** against a single-GPU baseline of 39 TeraFLOP/s (30% of peak).

### 4.5 Pipeline parallel and the bubble

Split the layers into `p` sequential stages, one per device. Communication is
**point-to-point**: stage `i` sends the boundary activation (`b·s·d` elements)
to stage `i+1`. Small, cheap, and — critically — not a collective, so it does
not synchronise the whole world. This is why PP is the right tool for crossing
slow links.

The cost is not bandwidth, it is **idleness**.

**GPipe.** Split the batch into `m` microbatches; run all `m` forwards through
the pipeline, then all `m` backwards.

```
fill:  p−1 microbatch slots of idle at the start
drain: p−1 at the end
useful: m
                       (p−1)(t_f + t_b)        p − 1
bubble fraction  =  ──────────────────────  =  ───────
                        m(t_f + t_b)             m
```

verbatim from [2104.04473](https://arxiv.org/abs/2104.04473): "the pipeline
bubble consists of `p−1` forward passes at the start of a batch, and `p−1`
backward passes at the end."

**1F1B (one-forward-one-backward).** Same `(p−1)/m` bubble, but the schedule
interleaves: once the pipeline is full, each device alternates a forward and a
backward. The win is **memory**: a stage holds activations for at most `p`
microbatches in flight instead of `m`. Since you want `m ≫ p` to shrink the
bubble, that is a large difference — 1F1B is what makes a small bubble
*affordable*.

**Interleaved 1F1B** (Megatron's contribution). Give each device `v`
non-contiguous **model chunks** instead of one contiguous block of layers
(device 0 gets layers 1–2 and 9–10 and 17–18…). The pipeline is effectively `pv`
stages deep for filling purposes but only `p` devices wide:

```
bubble fraction = (1/v) · (p − 1)/m
```

Cost: communication volume increases by `v` (more boundary crossings). Megatron
mitigates with a scatter/gather optimisation across multiple InfiniBand cards.

**Bubble arithmetic — do these on paper:**

Careful with two definitions in circulation: `(p−1)/m` is *bubble time as a
fraction of useful time*; `(p−1)/(m+p−1)` is *idle time as a fraction of wall
clock*. The table below uses the first (Megatron's), which is the one that
exceeds 100% for a badly-configured pipeline.

| `p` | `m` | `v` | `(p−1)/(mv)` | comment |
|---|---|---|---|---|
| 16 | 16 | 1 | **93.8%** | `m = p` is a disaster — 48% of wall clock idle |
| 16 | 64 | 1 | 23.4% | still bad |
| 16 | 128 | 1 | **11.7%** | acceptable |
| 16 | 128 | 4 | **2.9%** | interleaving earns its complexity |
| 8 | 128 | 1 | 5.5% | shallower pipeline, smaller bubble |
| 64 | 128 | 1 | 49.2% | deep pipelines need huge `m` |

**The design tension.** `m` large shrinks the bubble but requires a large global
batch (`m × microbatch × DP degree`), and global batch size is bounded above by
*optimisation* concerns, not systems ones — past the critical batch size you get
no convergence benefit from more tokens per step. So the pipeline bubble is
ultimately limited by a fact about SGD, not about hardware. Good place to make
the point that these constraints are not all of the same kind.

Also note from §3.7 that **chunked prefill reduces the pipeline bubble 6.29× at
inference** by equalising per-stage work — the same bubble, a different fix.

**Zero-bubble / DualPipe** (recalled, not read for this file — see caveats):
the backward pass splits into `dB` (gradient w.r.t. input, needed immediately by
the previous stage) and `dW` (gradient w.r.t. weights, needed only before the
optimizer step). Deferring `dW` gives the scheduler filler work for the bubble
slots. DeepSeek-V3 reports a variant of this.

### 4.6 Sequence and context parallelism, and Ring Attention

**Megatron sequence parallelism** ([2205.05198](https://arxiv.org/abs/2205.05198)).
TP shards the attention and MLP internals but leaves LayerNorm and dropout
replicated — the stubborn `10sbh` term in §1.5's table. SP shards *those* regions
along the sequence dimension. The TP all-reduce is decomposed into a
reduce-scatter (entering the SP region) and an all-gather (leaving it). Since
`all-reduce = reduce-scatter + all-gather` anyway, this "does not introduce any
communication overhead" — same bytes, different placement — while dropping
activation memory from `sbh(10 + 24/t + 5as/(ht))` to `sbh(34 + 5as/h)/t`, a
**5× reduction**. A free lunch, taken by rearranging when the halves of an
existing collective happen.

**Context parallelism / Ring Attention**
([arXiv 2310.01889](https://arxiv.org/abs/2310.01889), Liu, Zaharia, Abbeel).
SP shards the *pointwise* regions; attention itself still needs every query to
see every key. Ring Attention shards the sequence for attention too:

- Device `i` holds query block `Q_i` and, initially, `K_i, V_i`.
- Arrange devices in a ring. At each of `N` steps, every device computes
  attention of its local `Q_i` against the `K, V` block it currently holds, then
  **passes that block to its neighbour** while receiving the next one.
- After `N` steps every query has seen every key.

**The merge across ring steps is exactly the online-softmax monoid from §2.3.3.**
Each step produces a partial `(m, ℓ, O)` triple and merges it into the running
one with `α = exp(m_old − m_new)`. This is the payoff for having taught §2.3
properly: the *same* associative operator, now composing across GPUs instead of
across SRAM tiles. Ring Attention is FlashAttention with the ring as the outer
loop.

**The overlap condition, derived.** With `c = s/N` tokens per device, per ring
step:

```
compute  = 2·c·c·d (QKᵀ) + 2·c·c·d (PV)  =  4c²d  FLOPs
comm     = send K and V blocks = 2 · c·d · 2 bytes = 4cd bytes

overlap requires   4c²d / F_eff  ≥  4cd / B_net

                                  c  ≥  F_eff / B_net
```

**The per-device sequence chunk must exceed the machine's compute-to-network
ratio, measured in tokens.** With `F_eff = 400` TFLOP/s and NVLink at 400 GB/s,
`c ≥ 1000` tokens per device; over 400 Gb/s InfiniBand (50 GB/s), `c ≥ 8000`.
This is the same ridge-point reasoning as §0, with the network in place of HBM —
and it is a nice demonstration that the roofline concept is scale-free. When the
condition holds, the paper's claim follows: context length scales linearly with
device count, "up to device count times longer", with no attention approximation.

Practical note: naive ring sharding is badly load-imbalanced under **causal**
masking — the device holding the last query block does `N×` the work of the one
holding the first. Real implementations use a zigzag/striped assignment so each
device gets one early and one late block. (Recalled from implementations, not
from the paper — see caveats.)

### 4.7 Expert parallel and MoE

**The point of MoE:** decouple parameter count from FLOPs per token. Route each
token to `k` of `E` experts, so compute scales with `N_active` while capacity
scales with `N_total`. Switch Transformer used `k = 1`.

**Routing.** A small linear router produces a distribution over experts; take the
top-`k`. Each device holds a subset of experts, so tokens must be **sent to
their expert and their results sent back**: two **all-to-all** collectives per
MoE layer.

All-to-all is the least forgiving collective in the catalogue. It is `O(D²)`
distinct messages, its volume does not shrink with a smarter algorithm the way a
ring all-reduce's does, and it is exquisitely sensitive to any topology
asymmetry. This is why expert parallelism wants a flat, fat, uniform fabric and
why MoE training is more fragile than dense training at the same scale.

**Capacity factor.** Experts are compiled for a *fixed* buffer size (static
shapes are required for the fused kernels), so:

```
expert capacity = (tokens per batch / number of experts) × capacity factor
```

If routing were perfectly uniform, a capacity factor of 1.0 would suffice. It is
never uniform, so you over-provision. Consequences:

- **Capacity factor too low** → overflow. Switch Transformer's handling,
  verbatim: "computation is skipped and the token representation is passed
  directly to the next layer through the residual connection." The token is not
  lost, but it gets no expert processing that layer — a silent quality cost.
- **Capacity factor too high** → padded buffers, wasted FLOPs and wasted
  all-to-all bytes on padding.

Typical values are 1.0–2.0. It is a pure systems/quality dial with no clean
optimum, which is why so much MoE engineering is about not needing it.

**Load balancing loss.** Verbatim from
[2101.03961](https://arxiv.org/abs/2101.03961):

```
loss = α · N · Σᵢ fᵢ · Pᵢ
```

with `fᵢ` = fraction of tokens actually dispatched to expert `i`, `Pᵢ` = fraction
of *router probability mass* assigned to expert `i`, `N` = number of experts,
**`α = 0.01`**. The product is minimised when both vectors are uniform at `1/N`.
Note the construction: `fᵢ` is a hard count (not differentiable), `Pᵢ` is the
soft probability (differentiable), and multiplying them gives a differentiable
loss whose gradient pushes the router away from whichever experts are currently
oversubscribed. `α = 0.01` is "sufficiently large to ensure load balancing while
small enough to not overwhelm the primary cross-entropy objective."

**Reported:** up to **7× pre-training speedup** at matched compute, scaling to
**1.6T parameters**, and the first demonstration that large sparse models train
stably in **bfloat16**.

**The inference asymmetry, which people forget.** MoE gives you `6·N_active·D`
training FLOPs but `16·N_total` bytes of model state and `2·N_total` bytes of
weights to hold at inference. A model that trains like a 30B costs like a 600B
to serve. Combined with §3.9 (decode is bandwidth-bound on *total* weights read
— and at batch 1 with top-2 routing you read a nearly random 2/E of the experts,
with poor locality), MoE is a training-economics win that transfers to inference
only if your batch is large enough to amortise the expert loads. Worth stating,
because the papers emphasise the training side.

### 4.8 How they compose: 3D/4D parallelism and the hardware mapping

The dimensions multiply: `world_size = TP × CP × PP × DP × EP`.

**Llama-3 405B, actual production configuration**
([2407.21783](https://arxiv.org/abs/2407.21783) §3.3.2, read verbatim):

```
TP = 8 ,  CP = 1 ,  PP = 16 ,  DP = 128        →  8 × 16 × 128 = 16,384 GPUs
sequence length 8,192 ; batch size 16 per DP group
achieved MFU: 43% BF16 at 8K GPUs,  41% BF16 at 16K GPUs
```

`TP = 8` is exactly one NVLink domain. That is not a coincidence, it is the rule.

**The mapping rule, stated once:**

> Order the parallelism dimensions by how expensive and how unhideable their
> collective is. Assign the most expensive to the fastest, lowest-latency wire.
> The innermost dimension is TP; the outermost is DP.

| Rank in the hierarchy | Dimension | Collective | Frequency | Hideable | Maps to |
|---|---|---|---|---|---|
| innermost | **TP** | all-reduce of activations | 4× per layer | **no** — critical path | NVLink / NVSwitch, inside one node |
| | **CP / SP** | ring P2P, or RS+AG | per attention layer | yes, if `c ≥ F/B` | NVLink, or fastest inter-node tier |
| | **EP** | all-to-all | 2× per MoE layer | partly | NVLink, or a flat fat fabric |
| | **PP** | P2P of one activation tensor | per microbatch boundary | yes, small | inter-node InfiniBand / Ethernet |
| outermost | **DP / FSDP** | all-reduce (or RS+AG) of gradients | once per step, bucketed | **yes**, overlaps the whole backward | the slowest link you own — across racks, pods, even datacentres |

Two corollaries:

- **DP is the dimension you scale to infinity**, because its collective happens
  once per step and hides under an entire backward pass. This is why "just add
  more data parallelism" is the default answer, and why the interesting
  engineering is always in the inner dimensions.
- **PP crosses the slow link because P2P is not a collective.** A pipeline
  boundary involves exactly two ranks; a straggler or a slow link affects a
  local pair rather than barriering the entire world. That structural property,
  not bandwidth, is the real reason PP is the inter-node tool.

### 4.9 When does the network become the bottleneck? The arithmetic

This is the derivation that makes distributed training predictable rather than
mystical. Do it for plain DDP first.

```
communication time per optimizer step  (ring all-reduce of gradients):
     t_comm  ≈  2 · b_g · N / B_bus            b_g = bytes per gradient element

compute time per optimizer step:
     t_comp  ≈  6 · N · T / F_eff              T = tokens per GPU per step

t_comm     2·b_g·N / B          b_g · F_eff
──────  =  ─────────────   =   ─────────────
t_comp     6·N·T / F_eff         3 · B · T
```

**`N` cancels.** Whether the all-reduce hides under compute does **not depend on
model size at all**. This surprises everyone, and it is correct: a bigger model
has proportionally more gradients to move *and* proportionally more compute to
hide them under. The condition to hide the all-reduce is:

```
                b_g · F_eff
        T   >   ───────────          (tokens per GPU per optimizer step)
                  3 · B_bus
```

**Worked values** (`b_g = 2` for BF16 gradients, `F_eff = 400` TFLOP/s achieved):

| Interconnect | `B_bus` | Required tokens/GPU/step |
|---|---|---|
| NVLink 4, intra-node | 400 GB/s | **667** |
| 400 Gb/s InfiniBand (1 NIC) | 50 GB/s | **5,333** |
| 200 Gb/s InfiniBand | 25 GB/s | **10,667** |
| 100 Gb/s Ethernet | 12 GB/s | **22,200** |
| 25 Gb/s Ethernet | 3 GB/s | **88,900** |

Now read the table as engineering advice:

- On a proper cluster (400 Gb/s per GPU), a microbatch of one 8192-token
  sequence per GPU gives `T = 8192 > 5333`. It hides. Comfortably.
- On commodity 25 GbE you need ~89,000 tokens per GPU per step, i.e. eleven
  8k-sequences of gradient accumulation before every step. Which is exactly what
  people do — **gradient accumulation is not only a memory trick, it is a
  communication-hiding trick**, and this inequality is why.
- Halving `b_g` (FP8 or compressed gradients) halves the requirement.
- Note `F_eff` in the numerator: **faster GPUs make the network problem worse.**
  Going from A100 (`F_eff ≈ 150` TFLOP/s) to H100 (`≈ 400`) multiplies the
  required tokens per GPU by 2.7× at unchanged network. This is why every GPU
  generation ships with a matching interconnect upgrade, and why a cluster built
  from new GPUs on an old fabric underperforms badly.

**Adjustments for the other schemes:**

- **ZeRO-3 / FSDP:** volume is `1.5×`, so the threshold is `1.5×` higher — but
  worse, the parameter all-gathers are on the per-layer critical path rather
  than deferred to the end of the step. With good prefetching you approach the
  `1.5×` figure; without it you can be far off. Rule of thumb: budget `2×` the
  DDP threshold and measure.
- **TP:** does not obey this analysis at all, because its all-reduce is *not*
  hideable — the next matmul consumes the result. Use §4.4's direct calculation.
- **PP:** hides trivially, but has the bubble instead. Different failure mode.

**A useful sanity check to teach**: before writing any code, compute
`t_comm/t_comp` for the intended configuration. If it is above ~0.3 the run will
disappoint, and the fix is almost always one of: bigger microbatch, gradient
accumulation, lower-precision gradients, `HYBRID_SHARD`, or a different mapping
of dimensions to the topology.

### 4.10 Failure at 10,000 GPUs

Synchronous SGD means every collective is a barrier, and a barrier across `D`
devices fails if *any* device fails. Reliability is therefore not an ops concern
bolted on at the end — it sets the checkpoint interval, which sets the effective
throughput.

**The measured reality** ([Llama 3, 2407.21783](https://arxiv.org/abs/2407.21783) §3.3):

| | |
|---|---|
| Cluster | up to **16,384 H100** |
| Window | 54 days |
| **Unexpected interruptions** | **419** (plus 47 planned) |
| Hardware-caused | **78%** (confirmed or suspected) |
| GPU-related specifically | **58.7%** — faulty GPUs **30.1%**, **HBM3 failures 17.2%** |
| Effective training time achieved | **> 90%** |

**419 interruptions in 54 days is one every 3.1 hours.** At that rate, an
unprotected run of any useful length never completes. Internalise that number.

**The checkpoint-interval calculation.** This is the Young/Daly result (Daly
2006; classical, applied here by me — not a claim from the Llama 3 paper). With
checkpoint cost `C` and mean time between failures `M`:

```
optimal interval      T_opt   ≈  √(2 · C · M)
fraction of time lost         ≈  √(2C / M)
```

For Llama 3's numbers: `M = 54·86400/419 = 11,133 s`. If a checkpoint costs
`C = 60 s`:

```
T_opt          = √(2 · 60 · 11133) = √1.336e6  ≈  1156 s  ≈  19 minutes
fraction lost  = √(120 / 11133)               ≈  10.4%
```

which lands squarely on the reported ">90% effective training time". That
agreement is a consistency check, not a claim about their actual policy — but it
does show the arithmetic is the right arithmetic, and it is a genuinely
satisfying exercise to hand a student.

**Checkpoint cost itself.** Full state for a 405B model is `405e9 × 16 = 6.5 TB`.
Sharded across 16k ranks that is 400 MB each, which is fine per rank — but the
storage system sees a 6.5 TB write **burst** from 16,384 clients simultaneously,
every 19 minutes. Checkpointing is a storage-system design problem, not a
serialisation problem. The standard mitigations: asynchronous checkpointing
(copy state to pinned host memory, then write in the background while training
continues), sharded/distributed checkpoint formats, and in-memory redundant
checkpointing to a peer node for fast recovery from the common single-node case.

**Stragglers.** Synchronous training runs at the speed of its slowest rank, and
the slowdown is not amortised — one GPU 10% slow makes all 16,384 GPUs 10% slow,
every single step. Real causes, all of which have bitten people:

- thermal throttling on one poorly-seated heatsink or one hot rack position
- a NIC that negotiated a lower link rate after a transient
- a PCIe link that retrained at x8 instead of x16
- ECC correction storms on a marginal HBM stack (correct results, slow)
- one rank with wrong NUMA/CPU affinity, so its host-side work is slower
- filesystem contention from another job on shared storage

The diagnostic is per-rank step-time histograms, not averages. An average hides
exactly the thing you are looking for.

**What actually breaks, ranked by how much pain per incident:**

| Failure | Frequency | Pain |
|---|---|---|
| GPU falls off the bus / Xid error | most common | job dies, restart from checkpoint |
| HBM uncorrectable ECC | 17.2% of interruptions | node out until RMA |
| NIC flap / optical transceiver failure | common at scale | collective hangs, often without a clean error |
| **Silent data corruption** | rare | **the worst** — no error, wrong gradients, loss diverges hours later |
| NCCL hang / deadlock | common | no crash, no progress; needs a watchdog and timeout |
| Loss spike | occasional | may be data, may be fp16 overflow, may be hardware; standard response is skip-the-batch or rewind |
| Storage metadata storm at checkpoint | periodic | all ranks stall together |

**Silent data corruption deserves the emphasis.** A GPU that returns wrong
answers without signalling an error poisons the gradient all-reduce, and every
replica gets the poison. It surfaces as a divergence hours later, by which point
the checkpoint you would roll back to may already be contaminated. Mitigations
are all expensive: periodic deterministic re-execution on a second device and
comparison, per-rank gradient-norm monitoring to catch an outlier rank, and
aggressive checkpoint retention so you can bisect.

**Non-determinism compounds all of this.** NCCL does not guarantee bitwise
reproducible reduction order, and neither do most fused kernels, so "run it
again and see" is not available as a debugging technique. Deterministic modes
exist and cost throughput; the usual compromise is to keep determinism available
behind a flag for the bad days.

---
## 5. Scaling laws, briefly

### 5.1 Kaplan vs Chinchilla

**Kaplan et al. 2020** ([2001.08361](https://arxiv.org/abs/2001.08361)). Loss is
a power law in each of model size, data and compute, over more than seven orders
of magnitude:

| | exponent | constant |
|---|---|---|
| model size `N` | `α_N ≈ 0.076` | `N_c ≈ 8.8e13` |
| dataset size `D` | `α_D ≈ 0.095` | `D_c ≈ 5.4e13` |
| compute `C_min` | `α_C ≈ 0.050` | `C_c ≈ 3.1e8` |

Their compute-allocation conclusion: `N ∝ C^0.73`, `B ∝ C^0.24`, `S ∝ C^0.03`.
Read literally: **spend almost all extra compute on making the model bigger, and
barely increase the number of steps.** GPT-3 (175B on 300B tokens, 1.7
tokens/param) is that advice executed.

**Hoffmann et al. 2022, "Chinchilla"** ([2203.15556](https://arxiv.org/abs/2203.15556)).
Trained **over 400 models**, and concluded that "current large language models
are significantly undertrained" — "model size and the number of training tokens
should be scaled equally". Three independent methods:

| Approach | method | `N_opt ∝ C^a` | `D_opt ∝ C^b` |
|---|---|---|---|
| 1 | minimum of the loss envelope over fixed model sizes × 4 durations | `a = 0.50` | `b = 0.50` |
| 2 | IsoFLOP profiles: 9 fixed FLOP budgets, vary `N` | `a = 0.49` | `b = 0.51` |
| 3 | parametric fit `L(N,D) = E + A/N^α + B/D^β` | `a = 0.46` | `b = 0.54` |

with the reported fit `E = 1.69, A = 406.4, B = 410.7, α = 0.34, β = 0.28`.
The headline heuristic: **`D ≈ 20 · N`**, roughly 20 tokens per parameter.
Chinchilla itself is **70B trained on 1.4T tokens**, beating **Gopher 280B on
300B tokens** at equal training compute.

Their projections, for calibration:

| `N` | training FLOPs | `D` |
|---|---|---|
| 67B | 5.76e23 | 1.5T |
| 175B | 3.85e24 | 3.7T |
| 280B | 9.90e24 | 5.9T |

**Why did the two papers disagree?** The standard account — and the one Hoffmann
et al. discuss — is that Kaplan's runs used a **learning-rate schedule whose
cosine length was not matched to each run's actual duration**. A run stopped
before its schedule completed is at an unfairly high loss, which penalises the
"train longer" arm of every comparison and biases the fit toward "train bigger,
briefly". A second, smaller factor: Kaplan measured non-embedding parameters,
which changes `N` at small scale. Treat "Kaplan was wrong" as too strong:
**Kaplan's methodology was right and one experimental control was wrong**, which
is a far more useful lesson for a researcher than a wrong-answer story.

**And a caveat on Chinchilla itself.** Besiroglu, Erdil, Barnett and You,
*Chinchilla Scaling: A replication attempt*
([2404.10102](https://arxiv.org/abs/2404.10102)), report that Approach 3's
published estimates "are inconsistent with their first two estimation methods,
fail at fitting the extracted data, and report implausibly narrow confidence
intervals" — intervals that would require **over 600,000 experiments** where
fewer than 500 were run. Their re-derivation of Approach 3 gives results
"compatible with the findings from the first two estimation procedures". So:
**the `D ≈ 20N` conclusion stands (approaches 1 and 2 support it independently),
but the specific parametric constants `E, A, B, α, β` should not be quoted as
established.** Excellent material for a discussion of how a field's most-cited
number gets checked, and how long it took.

### 5.2 Converting a GPU-hour budget into a model

The recipe, in five steps.

```
1. compute budget
   C = n_gpus × F_peak_dense × MFU × seconds

2. Chinchilla-optimal split, from C = 6ND and D = 20N:
   C = 120 N²   ⇒   N_opt = √(C/120)      D_opt = 20 · N_opt

3. memory check
   model state = 16·N bytes;  divide by the sharding degree; add
   activations (§1.5) and check it fits.

4. network check
   is tokens-per-GPU-per-step above the §4.9 threshold?

5. inference check
   is Chinchilla-optimal even the objective you want? (§5.3)
```

**Worked: 10,000 H100 for 30 days at 40% MFU.**

```
C = 1e4 × 989.5e12 × 0.40 × (30×86400 = 2.592e6 s)  =  1.026e25 FLOPs

N_opt = √(1.026e25 / 120) = √8.55e22 = 2.92e11   →  292 B parameters
D_opt = 20 × 2.92e11                             →  5.85 T tokens
```

Cross-check against Chinchilla's own table: they list 280B ↔ 9.90e24 FLOPs ↔
5.9T tokens. Our 1.03e25 FLOPs gives 292B and 5.85T. The arithmetic reproduces
their published row, which is the point of doing it this way — a student who
gets this to agree has verified their understanding against the paper, not
against my prose.

Then step 3: `16 × 2.92e11 = 4.7 TB` of model state. On 10,000 GPUs with ZeRO-3
that is 470 MB each — trivially fine. Without sharding, impossible. Step 4: with
`F_eff = 400` TFLOP/s and 400 Gb/s IB you need >5,333 tokens per GPU per step;
a global batch of 4M tokens over 10,000 GPUs gives 400 — **far too few**, so the
DP degree must be smaller than 10,000 and the other dimensions must absorb the
rest. That single line is how the parallelism strategy gets chosen, and it is
why the exercise should always be run to the end rather than stopping at `N_opt`.

### 5.3 Chinchilla-optimal is the wrong objective for a product

Chinchilla minimises loss for a **training** compute budget. It says nothing
about inference. But a deployed model's lifetime cost is

```
total = 6·N·D  (train, once)  +  2·N·D_served  (infer, forever)
```

and `D_served` for a popular model dwarfs `D`. Since inference cost is linear in
`N` and independent of `D`, you should deliberately **overtrain a smaller
model**: pay more training compute now for a permanently cheaper model.

Llama-3-8B was trained on **15T tokens** — about **1,875 tokens per parameter**,
roughly **94×** the Chinchilla ratio. That is not a mistake; it is the
inference-aware optimum for a model that will serve trillions of tokens. Teach
Chinchilla as "the correct answer to a question you may not be asking", which is
a more valuable habit than the ratio itself.

---

## 6. Curriculum — six units in dependency order

Each unit has exactly **one idea**. If a student can state the one idea and
defend it with a calculation, the unit is done. Tooling: a **Modal GPU runner**
for anything that needs real hardware; **Compiler Explorer** for CUDA
compile-only inspection (PTX/SASS, register counts, no execution).

---

### Unit 1 — The arithmetic of a transformer

> **ONE IDEA: a model config file is a complete performance model. Parameters,
> FLOPs, bytes and step time all follow from eight numbers, before you write any
> code.**

Covers: parameter count derivation; `2N` forward and `6N` training; where the
FLOPs go and the `s/(6d)` ratio; activation memory and the `5as²b` term;
optimizer state and the 16-bytes-per-parameter table; MFU defined precisely,
with the sparsity and attention-term traps.

*Prereqs:* the GPU hardware unit (needs peak FLOP/s and HBM bandwidth as inputs).

**Exercises**

1. **(pure arithmetic, checkable to the digit)** From the published
   `config.json` of Llama-3-8B, compute the total parameter count. Target
   8,029,995,008. Getting it wrong is the lesson: you will discover GQA,
   SwiGLU's `3` matrices, and untied embeddings by finding your error.
   Then repeat for Llama-3-70B and Mistral-7B.
2. Compute training FLOPs per token both ways (with and without the attention
   term, causal and dense conventions) at `s` = 2k, 8k, 32k, 128k. Produce the
   table from §1.4 and state at what `s` attention exceeds the weight matmuls.
3. Compute the total memory for training Llama-3-8B with Adam in mixed
   precision on one 80 GB H100, and state precisely which line item makes it
   impossible.
4. **(Modal)** Time a real forward+backward step of a small GPT on one GPU.
   Compute the measured MFU. It will be lower than you predicted. Account for
   the gap.

---

### Unit 2 — Roofline and arithmetic intensity, applied to attention

> **ONE IDEA: performance is set by whichever of FLOPs and bytes is binding.
> Compute the arithmetic intensity, compare it to the machine's ridge point, and
> you know which one before you profile.**

Covers: the roofline model; ridge point `F_peak/B_HBM = 295` for H100 dense
BF16; intensity of a GEMM, an elementwise op, a reduction; why naive attention's
intensity is `d/2` and why the softmax kernels, not the GEMMs, are the problem;
why pre-2022 "efficient attention" work optimised the wrong resource.

*Prereqs:* Unit 1, memory-hierarchy unit.

**Exercises**

1. Compute the ridge point for A100, H100, and one consumer GPU, in BF16 and in
   FP8. Note how it has changed across generations and say what that implies.
2. **(Modal)** Implement naive attention as four separate PyTorch ops. Measure
   achieved TFLOP/s versus `s ∈ {512 … 16384}`. Plot against the roofline.
   Separately time each of the four kernels and confirm that softmax, not the
   GEMMs, dominates.
3. Compute the HBM traffic of naive attention analytically and compare against
   a profiler's measured DRAM bytes (`ncu --metrics dram__bytes`). Explain any
   discrepancy (hint: L2).

---

### Unit 3 — Online softmax and FlashAttention

> **ONE IDEA: reformulating a global reduction as a streaming one with a running
> maximum lets you compute an `N×N` matrix without ever storing it. You trade
> recomputation FLOPs for bandwidth on purpose, because bandwidth was binding.**

Covers: three-pass safe softmax; the Milakov–Gimelshein running-max recurrence
and the proof that the rescale factor is `exp(m_{j−1} − m_j)`; the block-merge
form as an associative monoid; **rescaling the output accumulator**, with the
induction proof; the FlashAttention tiling loop and block sizes; `Θ(N²d²M⁻¹)`
and the `M⁻¹`; backward recomputation; FA-2's three scheduling changes; FA-3's
Hopper asynchrony and FP8.

*Prereqs:* Units 1–2, CUDA unit (shared memory, tiling, warps).

**Exercises**

1. **(numpy, no GPU)** Implement `online_softmax(x)` with the running-max
   recurrence. Assert `allclose` against `scipy.special.softmax` for random
   vectors, and for adversarial ones: all-equal, one huge outlier, all `-inf`
   (a fully masked causal row), values spanning `±1e4`. Then implement the
   block-merge form `merge((m1,l1),(m2,l2))` and **test that it is associative**
   by merging the same blocks in different orders and comparing.
2. **(numpy)** Implement full tiled attention with the `(m, ℓ, O)` accumulator
   and the `diag(α)` output rescale. Assert equivalence to
   `softmax(QK^T/√d) @ V` at `rtol=1e-5`. Then **delete the output rescale in
   step 6** and observe exactly how it fails — the denominator stays right, the
   output is wrong. This is the single most instructive bug in the curriculum.
3. **(CUDA, Modal)** Write a tiled attention forward kernel: load `K_j, V_j`
   tiles to shared memory, keep `m, ℓ, O` in registers, loop. Verify against a
   PyTorch reference. Do not chase performance — correctness plus "it never
   allocates an `N×N` buffer" is the goal. Then benchmark against
   `F.scaled_dot_product_attention` and quantify how far off you are.
4. **(Compiler Explorer)** Compile the kernel and inspect register usage and
   shared-memory allocation in PTX/SASS. Compute the occupancy this implies, and
   relate the shared-memory footprint back to the `M⁻¹` in Theorem 2.
5. Compute, for `d ∈ {64,128}` and `M ∈ {48, 164, 228}` KB, the predicted
   HBM-traffic reduction `M/d²`. Compare with the paper's measured 9×.

---

### Unit 4 — Inference is two different machines

> **ONE IDEA: arithmetic intensity equals tokens processed per weight load.
> Prefill sits above the ridge point and decode sits far below it, and every
> serving technique that exists is a way to raise that number.**

Covers: prefill vs decode; the batch-1 MFU `= 1/ridge_point` result; KV cache
sizing and why it dominates; MQA/GQA/MLA/quantised KV; PagedAttention as virtual
memory (the full mapping table, including where the analogy costs you);
continuous batching; speculative decoding with the acceptance-rate algebra;
chunked prefill, prefix caching, disaggregation; why weight-only and
weight+activation quantisation are two families answering two different
bottlenecks.

*Prereqs:* Units 1–2 (roofline), OS unit (virtual memory, paging, COW).

**Exercises**

1. **(arithmetic)** KV cache bytes per token for Llama-3-8B and -70B. Then: how
   many concurrent 8k-context sequences fit on one 80 GB H100 with Llama-3-8B in
   BF16? Recompute with FP8 KV. Recompute for a hypothetical MHA variant.
2. **(arithmetic)** Show that batch-1 decode MFU equals `B_HBM/F_peak`
   independent of `N`. Compute it for A100, H100, and a 4090. Then compute the
   peak tokens/s for Llama-3-8B at BF16, FP8, and INT4.
3. **(Modal)** Measure real batch-1 decode tokens/s and compare to your ceiling.
   Then sweep batch size 1→256 and plot tokens/s per sequence and total
   throughput. Identify the batch at which the curve bends and compare it to the
   ridge point.
4. **(arithmetic)** Plot speculative-decoding speedup versus `γ` for
   `α ∈ {0.6, 0.7, 0.8, 0.9}` at `c = 0.05`. Find the optimal `γ` for each.
   Explain the ceiling `1/(1−α)` and why the technique is disabled at high load.
5. Write the OS↔PagedAttention mapping table from memory, then name the one row
   where the analogy is not free and explain why.

---

### Unit 5 — The parallelism taxonomy

> **ONE IDEA: each parallelism dimension buys a specific memory saving with a
> specific collective. Rank the collectives by cost and unhideability, and map
> the worst one to the fastest wire.**

Covers: DDP with bucketing/overlap; ZeRO 1/2/3 with the memory and 1×/1×/1.5×
comm table, and why stages 1–2 are free; FSDP's FlatParameter and wrapping
granularity; Megatron TP with the column/row split and why the nonlinearity
dictates it; the `f`/`g` operators and the four all-reduces; the pipeline bubble
and GPipe vs 1F1B vs interleaved; sequence and context parallelism, Ring
Attention and the reappearance of the online-softmax monoid; MoE routing,
all-to-all, capacity factor and the load-balancing loss; 3D/4D composition and
the hardware mapping; **the `t_comm/t_comp` derivation in which `N` cancels**;
failure at scale.

*Prereqs:* Units 1–4, networking unit (collectives, NVLink vs InfiniBand).

**Exercises**

1. **(arithmetic)** Pipeline bubble fraction for `(p,m,v)` = (8,32,1), (16,64,1),
   (16,128,1), (16,128,4), (64,128,1). At what `m` does `p=16` get under 5%?
   What global batch size does that imply at DP=128, microbatch 1, `s=8192` —
   and is that batch size plausible for optimisation?
2. **(arithmetic — the key one)** Derive `t_comm/t_comp = b_g·F_eff/(3·B·T)` for
   DDP and show `N` cancels. Then compute the minimum tokens-per-GPU-per-step to
   hide the all-reduce for: 8×H100 over NVLink; 64×H100 over 400 Gb/s IB; 64×
   A100 over 100 GbE. State for each whether a 4M-token global batch suffices.
3. **(arithmetic)** Repeat §4.4's TP calculation for a 7B model with `d=4096`,
   `L=32`, `t=4`, and decide whether TP over 100 GbE is ever sensible.
4. **(arithmetic)** Ring Attention: derive `c ≥ F_eff/B_net` and compute the
   minimum per-device sequence chunk for NVLink and for 400 Gb/s IB. How many
   devices do you need to reach 1M context at that chunk size?
5. **(Modal, 2+ GPUs)** Run the same small model under DDP and under FSDP.
   Measure peak memory and step time for both. Verify the memory ratio against
   ZeRO's table and explain the step-time difference in terms of the 1.5×.
6. **(arithmetic)** Given the Llama-3 reliability numbers, compute the
   Young/Daly optimal checkpoint interval for checkpoint costs of 30 s, 60 s and
   300 s, and the fraction of time lost in each case.

---

### Unit 6 — Scaling laws and turning a budget into a model

> **ONE IDEA: the GPU-hour budget determines the model size and the token count
> before you choose an architecture — and Chinchilla-optimal answers a training
> question, not a deployment one.**

Covers: Kaplan vs Chinchilla and *why* they differed (the LR-schedule control);
the three approaches and their agreement; `D ≈ 20N`; the replication caveat;
budget → `(N, D)`; the memory and network feasibility checks; the
inference-aware optimum and why Llama-3-8B saw 15T tokens.

*Prereqs:* Units 1 and 5 (you cannot check feasibility without them).

**Exercises**

1. **(arithmetic)** Convert three budgets into `(N, D)`: 1,000 H100-days;
   10,000 H100 × 30 days; 100 A100 × 90 days. Assume 40% MFU. Cross-check the
   middle one against Chinchilla's 280B row.
2. For each result, complete steps 3–5 of the §5.2 recipe: does the model state
   fit under a plausible sharding? Does the all-reduce hide? What parallelism
   configuration does that force?
3. Given a model you expect to serve 100T tokens over its lifetime, set up
   `total = 6ND + 2·N·D_served` and argue for the `N` you would actually pick.
   Compare with Llama-3-8B's 1,875 tokens/parameter.
4. **(discussion)** Read the Besiroglu replication abstract. What would you have
   had to do, as a reviewer in 2022, to catch it? What does the confidence
   interval argument tell you about the fit?

---

### Capstone

Pick a target: *"serve Llama-3-70B at ≤ 50 ms per output token for 64
concurrent users, and separately, train a 30B model in two weeks."* For each,
**on paper before touching a GPU**: choose precision, KV strategy, batch size,
parallelism configuration and hardware count; compute the predicted MFU, KV
memory, TPOT and comm/compute ratio. Then run the closest feasible thing you can
afford on Modal and account for every gap between prediction and measurement.

An ML researcher who understands the machine is exactly someone who can write
that document before the run, and then explain the residuals afterwards. That is
the deliverable the whole curriculum is aimed at.

---

## 7. Reference answers for the arithmetic exercises

So the curriculum can be auto-graded. All at 2 bytes/element unless noted;
H100 SXM dense BF16 `F_peak = 989.5` TFLOP/s, `B_HBM = 3.35` TB/s.

| # | Question | Answer |
|---|---|---|
| 1.1 | Llama-3-8B parameter count | **8,029,995,008** (attn 41,943,040/layer; MLP 176,160,768/layer; ×32 = 6,979,321,856; + 2 × 525,336,576 embeddings) |
| 1.2 | Llama-3-8B training FLOPs/token, weights only | `6 × 8.03e9` = **4.82e10** |
| 1.3 | attention/weight FLOP ratio, `d=4096`, `s=8192`, dense | `s/(6d)` = **0.333** (25% of layer FLOPs) |
| 1.4 | break-even `s` for `d=4096`, dense | `6d` = **24,576** tokens |
| 1.5 | Llama-3-8B Adam mixed-precision model state | `8.03e9 × 16` = **128.5 GB** — exceeds 80 GB before any activation |
| 2.1 | H100 ridge point, dense BF16 | `989.5e12/3.35e12` = **295 FLOP/byte** |
| 2.2 | naive attention intensity, `d_h=128` | `d/2` = **64 FLOP/byte** → ≤22% of peak |
| 2.3 | FlashAttention intensity, `N=8192` | `N/2` = **4096 FLOP/byte** → compute-bound |
| 3.1 | FA HBM-traffic reduction, `d=64`, `M=100 KB` | `M/d² ≈ 100000/4096` ≈ **24×** analytic; paper measures up to **9×** |
| 4.1 | Llama-3-70B KV bytes/token | `2·80·8·128·2` = **327,680 B = 320 KiB** |
| 4.2 | ... at 128k context, one sequence | **40.0 GiB** |
| 4.3 | same model with 64 KV heads (MHA) | **2.5 MiB/token**, **320 GiB** at 128k |
| 4.4 | max 8k-context sequences, Llama-3-8B BF16, 80 GB, ~60 GB KV budget | `60e9/(8192·131072)` = **55** |
| 4.5 | batch-1 decode MFU on H100 | `B_HBM/F_peak` = **0.34%**, independent of `N` |
| 4.6 | batch-1 tokens/s ceiling, Llama-3-8B BF16, 1×H100 | `3.35e12/16.06e9` = **209 tok/s** |
| 4.7 | ... at INT4 weights | ×4 = **836 tok/s** |
| 4.8 | speculative: `α=0.8, γ=4` | `E[tokens]` = **3.36**; at `c=0.05`, speedup = **2.80×** |
| 4.9 | speculative ceiling at `α=0.8` | `1/(1−α)` = **5 tokens/iteration**, for any `γ` |
| 5.1 | bubble, `p=16, m=128, v=1` | **11.7%** |
| 5.2 | bubble, `p=16, m=128, v=4` | **2.93%** |
| 5.3 | all-reduce hiding threshold, `b_g=2`, `F_eff=400e12`, `B=50e9` | `T > b_g F/(3B)` = **5,333 tokens/GPU/step** |
| 5.4 | same over 100 GbE (12 GB/s) | **22,200 tokens/GPU/step** |
| 5.5 | TP=8 all-reduce, 70B, 8192 tokens: NVLink vs IB | **188 ms** vs **1504 ms**, against 869 ms of compute |
| 5.6 | Ring Attention chunk, `F_eff=400e12`, NVLink 400 GB/s | `c ≥ F/B` = **1,000 tokens/device** (8,000 over 400 Gb/s IB) |
| 5.7 | Young/Daly, `M=11,133 s`, `C=60 s` | interval ≈ **1,156 s (19 min)**, time lost ≈ **10.4%** |
| 6.1 | 10,000 H100 × 30 days @ 40% MFU | `C` = **1.03e25 FLOPs** → `N_opt` = **292 B**, `D_opt` = **5.85 T** |
| 6.2 | ... model state | `16 × 2.92e11` = **4.7 TB**, i.e. 470 MB/GPU under ZeRO-3 on 10k GPUs |

---

## Unverified, uncertain, or contested

Read this before teaching from the file.

1. **Hardware peak numbers and the sparsity asterisk.** I use **dense** H100 SXM
   figures: BF16 989.5 TFLOP/s, FP8 1,979 TFLOP/s, HBM3 3.35 TB/s. NVIDIA's
   datasheet headline numbers (1,979 BF16 / 3,958 FP8) include 2:4 structured
   sparsity. The sibling `nvidia-architectures.md` quotes the **sparse** figures.
   Both are "correct"; they are different quantities. Every MFU and ridge-point
   number in this file assumes dense. If you cross-read the two files without
   noticing, every ratio here will look 2× off.

2. **`F_eff = 400 TFLOP/s` is my assumption, not a measurement.** I use it
   throughout §4.9 as "achievable BF16 throughput on an H100 in a real training
   step" (≈40% of dense peak, consistent with Llama-3's reported 41–43% MFU).
   It is a plausible planning figure, not a spec.

3. **NCCL bus bandwidth of 400 GB/s over NVLink 4 and 50 GB/s over 400 Gb/s IB**
   are my planning estimates for §4.4 and §4.9, not measured values from a
   source I read. The *conclusions* (TP inside the node, the ~8× gap) are robust
   to a wide range here, but do not quote the millisecond figures as measurements.

4. **SmoothQuant's `α` formula.** I state
   `s_j = max|X_j|^α / max|W_j|^{1−α}` with `α = 0.5` as a common default. I
   read the abstract, which confirms the migration idea and W8A8 but does not
   give the formula. **Verify against §4 of the paper before teaching the
   formula.** The 1.56× speedup / 2× memory / 530B-on-one-node numbers *are*
   from the abstract.

5. **Quantised KV cache recipe.** I mention that `K` wants per-channel and `V`
   per-token quantisation (the KIVI line of work). **I did not read those
   papers.** Treat as a pointer, not a claim.

6. **Zero-bubble / DualPipe pipeline schedules** (splitting backward into `dB`
   and `dW` to fill bubbles) are recalled from memory, not read for this file.
   The GPipe `(p−1)/m` and interleaved `(p−1)/(mv)` formulas **are** verbatim
   from [2104.04473](https://arxiv.org/abs/2104.04473).

7. **Ring Attention causal load-imbalance and the zigzag/striped fix** is
   recalled from implementations, not from the paper. The overlap condition
   `c ≥ F/B` is **my derivation** from the paper's qualitative statement that
   compute time must roughly equal communication time; the paper does not state
   it in that form.

8. **The Kaplan/Chinchilla discrepancy explanation** (unmatched cosine LR
   schedule length) is the standard account and is discussed in the Chinchilla
   paper, but I did not read the specific passage for this file. The exponents,
   the three approaches, and the projection table **are** verbatim from ar5iv.

9. **Chinchilla's parametric constants `E=1.69, A=406.4, B=410.7, α=0.34,
   β=0.28` are contested** — see [2404.10102](https://arxiv.org/abs/2404.10102).
   The `D ≈ 20N` conclusion is independently supported by their approaches 1
   and 2 and is safe; the constants are not.

10. **Young/Daly checkpoint-interval formula** (`T_opt ≈ √(2CM)`) is a classical
    result (Daly 2006) that I applied to Llama-3's published failure statistics.
    The agreement with their ">90% effective training time" is a *consistency
    check I constructed*, not a claim made in the Llama 3 paper. Do not
    attribute it to them.

11. **Llama 3 power-grid fluctuation.** I have a recollection that the paper
    discusses tens-of-megawatts cluster-wide power swings as GPUs synchronise
    between compute and idle phases. I did **not** verify this; I have left it
    out of the body. Check §3.3 before mentioning it.

12. **Orca** (iteration-level / continuous batching) is described from general
    knowledge and from vLLM's comparison against it; I did not read the Orca
    paper (Yu et al., OSDI 2022).

13. **Medusa, EAGLE, prompt-lookup decoding** are named as pointers only; not read.

14. **The `d_ff = (8/3)d` rationale** (chosen so SwiGLU matches an ungated FFN's
    parameter count) is a well-known account originating with Shazeer's GLU
    variants paper, which I did not read for this file. The arithmetic
    (`3·d·(8/3)d = 8d² = 2·d·4d`) is trivially checkable and correct regardless.

15. **Llama model configurations** (layer counts, hidden sizes, KV head counts,
    vocab, `d_ff`) are from general knowledge of the published configs, not
    fetched for this file. The 8.03B total reproduces the published parameter
    count exactly, which is strong evidence the 8B config is right; the 70B
    config is less directly verified.

16. **The claim that PagedAttention costs "a few percent" of kernel throughput**
    for block-table indirection is my characterisation, not a measured number
    from the paper. The direction is certainly right; the magnitude is a guess.

17. **FA-2's "225 TFLOP/s = 72% MFU"** is quoted from the abstract as reported.
    Note that 225/312 (A100 dense BF16 peak) = 72%, so their MFU denominator is
    the dense A100 peak — consistent with this file's convention, which is worth
    stating since it is the one MFU number here computed by someone else.
