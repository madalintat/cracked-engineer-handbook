# Low-precision GPU training on NVIDIA Blackwell — research notes

Compiled 2026-09-01. Every numeric claim below carries a source. Anything I could
not verify against a primary source is collected in the **Unverified / uncertain**
section at the end — read that section before teaching from this.

Primary sources actually read (not just cited):

- PTX ISA 9.3, `docs.nvidia.com/cuda/parallel-thread-execution/` (full text pulled locally)
- *FP8 Formats for Deep Learning*, arXiv [2209.05433](https://arxiv.org/abs/2209.05433) (Table 1 read verbatim)
- *Microscaling Data Formats for Deep Learning*, arXiv [2310.10537](https://arxiv.org/abs/2310.10537) (Table 1 read verbatim)
- *Pretraining Large Language Models with NVFP4*, arXiv [2509.25149](https://arxiv.org/abs/2509.25149) (§2, §4, Appendix B/C read verbatim)
- ONNX technical docs [float4.md](https://github.com/onnx/onnx/blob/main/docs/docsgen/source/technical/float4.md),
  [float6.md](https://github.com/onnx/onnx/blob/main/docs/docsgen/source/technical/float6.md),
  [float8.md](https://github.com/onnx/onnx/blob/main/docs/docsgen/source/technical/float8.md) — OCP-aligned tables
- [microsoft/microxcaling](https://github.com/microsoft/microxcaling) `mx/formats.py` — the MX reference implementation,
  written by co-authors of the OCP spec
- NVIDIA/cutlass @ `dc45f979` (CUTLASS 4.8.0), cloned and read

> **Caveat on the OCP MX spec PDF.** `opencompute.org` sits behind a Cloudflare
> JS challenge and I could not fetch the v1.0 PDF directly. Every MX number below
> is therefore corroborated from *two* independent secondary sources that both
> claim OCP conformance (ONNX's format docs and Microsoft's `microxcaling`
> reference implementation), and they agree with each other and with my own
> derivation from the format parameters. I flag this rather than pretend I read
> the PDF.

---

## 1. The number formats

### 1.1 Bit layouts at a glance

`S` = sign, `E` = biased exponent field, `M` = trailing significand ("mantissa").
Value of a normal number is `(-1)^S x 2^(E - bias) x 1.M`; of a subnormal
(`E == 0`) it is `(-1)^S x 2^(1 - bias) x 0.M`.

| Format | Bits | S | E | M | Bias | Max normal | Min normal | Min subnormal | Inf | NaN |
|---|---|---|---|---|---|---|---|---|---|---|
| FP32 (binary32) | 32 | 1 | 8 | 23 | 127 | (2−2⁻²³)·2¹²⁷ ≈ 3.4028235e38 | 2⁻¹²⁶ ≈ 1.1754944e−38 | 2⁻¹⁴⁹ ≈ 1.4012985e−45 | yes | yes |
| TF32 | 19 (in a 32-bit slot) | 1 | 8 | 10 | 127 | (2−2⁻¹⁰)·2¹²⁷ ≈ 3.4025e38 | 2⁻¹²⁶ | 2⁻¹³⁶ | yes | yes |
| BF16 | 16 | 1 | 8 | 7 | 127 | (2−2⁻⁷)·2¹²⁷ ≈ 3.3895314e38 | 2⁻¹²⁶ ≈ 1.1754944e−38 | 2⁻¹³³ ≈ 9.1835e−41 | yes | yes |
| FP16 (binary16) | 16 | 1 | 5 | 10 | 15 | (2−2⁻¹⁰)·2¹⁵ = 65504 | 2⁻¹⁴ ≈ 6.1035156e−5 | 2⁻²⁴ ≈ 5.9604645e−8 | yes | yes |
| FP8 E4M3 | 8 | 1 | 4 | 3 | **7** | `S.1111.110` = 1.75·2⁸ = **448** | `S.0001.000` = 2⁻⁶ | `S.0000.001` = 2⁻⁹ | **no** | `S.1111.111` only |
| FP8 E5M2 | 8 | 1 | 5 | 2 | **15** | `S.11110.11` = 1.75·2¹⁵ = **57344** | `S.00001.00` = 2⁻¹⁴ | `S.00000.01` = 2⁻¹⁶ | `S.11111.00` | `S.11111.{01,10,11}` |
| FP6 E3M2 | 6 | 1 | 3 | 2 | **3** | 1.11₂·2⁴ = **28** | 1.00₂·2⁻² = 0.25 | 0.01₂·2⁻² = 0.0625 | **no** | **no** |
| FP6 E2M3 | 6 | 1 | 2 | 3 | **1** | 1.111₂·2² = **7.5** | 1.000₂·2⁰ = 1.0 | 0.001₂·2⁰ = 0.125 | **no** | **no** |
| FP4 E2M1 | 4 | 1 | 2 | 1 | **1** | 1.1₂·2² = **6.0** | 1.0₂·2⁰ = 1.0 | 0.1₂·2⁰ = 0.5 | **no** | **no** |
| E8M0 (scale) | 8 | 0 | 8 | 0 | 127 | 2¹²⁷ | 2⁻¹²⁷ | n/a (no subnormals) | **no** | `0xFF` only |
| UE4M3 (scale) | 7 in a byte | 0 | 4 | 3 | 7 | 448 | 2⁻⁶ | 2⁻⁹ | **no** | `0x7F` only |

Sources for each row:

- **FP32 / FP16** — IEEE 754-2019 binary32/binary16. Standard, uncontroversial.
- **TF32** — NVIDIA: *"8 exponent bits and 10 bits of mantissa, and one sign bit"*,
  i.e. **19 bits**; it *"covers the same range of values as FP32"* with *"more
  precision than BF16 and the same amount as FP16"*.
  [NVIDIA developer blog, "Accelerating AI Training with NVIDIA TF32 Tensor Cores"](https://developer.nvidia.com/blog/accelerating-ai-training-with-tf32-tensor-cores/).
  TF32 is **not a storage format**: *"all storage in memory and other operations
  remain completely in FP32"* — it is only a tensor-core input rounding mode.
  FP32 inputs are rounded to TF32, products are computed without further loss,
  accumulation is FP32. On A100 that blog reports 8x FP32 throughput for TF32
  vs 16x for FP16/BF16.
- **BF16** — same exponent field as FP32 (8 bits, bias 127), 7 mantissa bits.
  It is FP32 truncated to the top 16 bits, which is exactly why the FP32→BF16
  conversion is a shift and why BF16 needs no loss scaling.
- **FP8 E4M3 / E5M2** — Table 1 of [arXiv 2209.05433](https://arxiv.org/abs/2209.05433),
  read verbatim. Confirmed independently by
  [ONNX float8.md](https://github.com/onnx/onnx/blob/main/docs/docsgen/source/technical/float8.md)
  (`E4M3FN` == OCP E4M3). Two details that matter and are commonly got wrong:
  - E4M3's max is **448, not 240**. The paper: *"Infinities are not represented
    and we retain only one mantissa bit-pattern for NaNs. This modification
    extends the dynamic range by one extra power of 2, from 17 to 18 binades.
    We gain the representation of seven more magnitudes (256, 288, 320, 352,
    384, 416, 448) ... The maximum representable magnitude without this
    modification would be 240."*
  - E4M3 keeps **±0 and ±NaN** rather than reclaiming one more magnitude (480),
    deliberately, to preserve IEEE sign symmetry. The paper says the extra
    magnitude *"is not significant to warrant deviating from IEEE convention."*
  - E5M2 is fully IEEE-shaped: *"can be viewed as IEEE half precision with fewer
    mantissa bits."* It has real infinities and three NaN payloads per sign.
  - NVIDIA's recommendation in that paper: **E4M3 for weights and activations,
    E5M2 for gradients.**
- **FP6 E3M2 / E2M3** — [ONNX float6.md](https://github.com/onnx/onnx/blob/main/docs/docsgen/source/technical/float6.md),
  which states it is *"Based on OCP Microscaling Formats (MX) v1.0 spec"*, and
  gives exactly: E2M3 bias 1, max `1.111·2² = 7.5`, min normal `1.000·2⁰ = 1`,
  min denorm `0.001·2⁰ = 0.125`, no Inf, no NaN; E3M2 bias 3, max `1.11·2⁴ = 28`,
  min normal `1.00·2⁻² = 0.25`, min denorm `0.01·2⁻² = 0.0625`, no Inf, no NaN.
  Corroborated by `microxcaling/mx/formats.py`
  (`fp6_e3m2: ebits=3, emax=2^(3-1)=4, max_norm = 2⁴·(2³−1)/2² = 28`;
  `fp6_e2m3: ebits=2, emax=2, max_norm = 2²·(2⁴−1)/2³ = 7.5`) and by PTX ISA 9.3
  §5.2.3: *"e2m3 ... does not support infinity and NaN"*, *"e3m2 ... does not
  support infinity and NaN"*. Both are packed two-per-`.b16` in PTX with the top
  2 bits of each byte zero.
- **FP4 E2M1** — full table below.
- **E8M0** — PTX ISA 9.3 §5.2.3: *"an 8-bit unsigned floating-point format with 8
  bits for exponent and 0 bits for mantissa. The ue8m0 encoding does not support
  infinity. NaN value is limited to 0xff."* The MX spec fixes bias 127, giving
  encodings 0..254 → 2⁻¹²⁷..2¹²⁷. **It cannot represent zero**, has no
  subnormals and no Inf. Confirmed by the NVFP4 paper: *"an unsigned E8M0 format
  (UE8M0), which encodes a power-of-two value ranging from 2⁻¹²⁷ to 2¹²⁷."*
  PTX requires it packed as `ue8m0x2` in a `.b16`.
- **UE4M3** — PTX ISA 9.3 §5.2.3, verbatim: *"This data format is a **7-bit**
  unsigned floating-point format with 4 bits for exponent and 3 bits for
  mantissa. The ue4m3 encoding does not support infinity. NaN value is limited
  to 0x7f. A register variable containing single ue4m3 value must be declared
  with .b8 type having MSB bit padded with zero."*
  **This is a subtlety worth teaching**: papers and marketing say NVFP4's block
  scale is "FP8 E4M3", but the hardware type is the *unsigned* variant — the
  sign bit position is forced to zero, so the byte holds 7 meaningful bits.
  Magnitudes are identical to E4M3 (max 448, min subnormal 2⁻⁹).

### 1.2 FP4 E2M1 — the complete 16-value table

E2M1 has 1 sign, 2 exponent, 1 mantissa bit; bias 1; no Inf, no NaN; one
subnormal magnitude per sign. Value rule:

- `E != 0`: `(-1)^S · 2^(E-1) · (1 + M·2⁻¹)`
- `E == 0`: `(-1)^S · M · 2⁻¹`

| Encoding `S EE M` | Hex | Class | Value |
|---|---|---|---|
| `0 00 0` | 0x0 | zero | **+0** |
| `0 00 1` | 0x1 | subnormal | **+0.5** |
| `0 01 0` | 0x2 | normal | **+1.0** |
| `0 01 1` | 0x3 | normal | **+1.5** |
| `0 10 0` | 0x4 | normal | **+2.0** |
| `0 10 1` | 0x5 | normal | **+3.0** |
| `0 11 0` | 0x6 | normal | **+4.0** |
| `0 11 1` | 0x7 | normal | **+6.0** |
| `1 00 0` | 0x8 | zero | **−0** |
| `1 00 1` | 0x9 | subnormal | **−0.5** |
| `1 01 0` | 0xA | normal | **−1.0** |
| `1 01 1` | 0xB | normal | **−1.5** |
| `1 10 0` | 0xC | normal | **−2.0** |
| `1 10 1` | 0xD | normal | **−3.0** |
| `1 11 0` | 0xE | normal | **−4.0** |
| `1 11 1` | 0xF | normal | **−6.0** |

Sources: the value table is given encoding-by-encoding in
[ONNX float4.md](https://github.com/onnx/onnx/blob/main/docs/docsgen/source/technical/float4.md)
(`000→0, 001→0.5, 010→1, 011→1.5, 100→2, 101→3, 110→4, 111→6`, sign bit
ignored) and independently in NVFP4 paper §2: *"This allows MXFP4 to encode the
values ±0, ±0.5, ±1, ±1.5, ±2, ±3, ±4, and ±6."*

Facts worth making students derive themselves:

- Dynamic range of E2M1 is `log2(6/0.5) = 3.58` binades. That is the whole
  budget a block scale has to work with.
- Downcast saturating behaviour (ONNX, OCP-aligned): `x > 6 → 6`,
  `x < −6 → −6`, `+Inf → 6`, `−Inf → −6`, `NaN → 6`, otherwise round-to-nearest-even.
- Storage packing: two E2M1 per byte, **first element in the low nibble**
  (`pack(x,y) = y<<4 | x&0x0F`). This nibble order trips people up constantly.
- Bits per value in context: MXFP4 = `4 + 8/32 = 4.25`; NVFP4 = `4 + 8/16 = 4.5`.

---

## 2. Block scaling

### 2.1 What MX (microscaling) is

An MX format is a **block floating-point** format: a run of `k` contiguous
elements shares one scale factor `X`, and element `i` of the block decodes as
`X · P_i` where `P_i` is the stored narrow float. Storage is `d·k + w` bits for
`k` elements of `d` bits plus a `w`-bit scale.

The OCP MX v1.0 spec (Sept 2023; authored by Microsoft, AMD, Arm, Intel, Meta,
NVIDIA, Qualcomm) defines exactly four concrete formats. Table 1 of
[arXiv 2310.10537](https://arxiv.org/abs/2310.10537), read verbatim:

| Format name | Block size | Scale data format | Scale bits | Element data format | Element bit-width |
|---|---|---|---|---|---|
| MXFP8 | **32** | E8M0 | 8 | FP8 (E4M3 / E5M2) | 8 |
| MXFP6 | **32** | E8M0 | 8 | FP6 (E2M3 / E3M2) | 6 |
| MXFP4 | **32** | E8M0 | 8 | FP4 (E2M1) | 4 |
| MXINT8 | **32** | E8M0 | 8 | INT8 | 8 |

Key properties:

- **Block size is always 32** for every OCP-concrete MX format. There is no
  block-16 MX format.
- **The scale is always E8M0** — a bare power of two, 8 bits, bias 127, no
  mantissa, no zero, no Inf, single NaN (`0xFF`). Because it is power-of-two-only,
  applying it is exponent arithmetic: exact, no rounding, no multiplier.
- The scale is chosen so the block's largest element maps onto the element
  format's largest exponent. In practice implementations **round the scale up**
  to the next representable UE8M0 value to avoid saturation — the NVFP4 paper
  cites Mishra et al. (2025) for this: *"it is beneficial to round scale factors
  up to the next representable UE8M0 value to avoid saturations"*, and notes
  *"saturations have been observed to cause convergence issues for MXFP8
  training."*
- MXINT8 elements are two's-complement with an implicit `2⁻⁶` scaling.

### 2.2 What NVFP4 is, and how it differs from MXFP4

NVFP4 is NVIDIA's non-OCP 4-bit block format. Same element type (E2M1), three
differences, all from [arXiv 2509.25149](https://arxiv.org/abs/2509.25149) §2
verbatim:

> *"First, by reducing the block size from 32 to 16 elements, NVFP4 narrows the
> dynamic range within each block, better fitting values into the FP4 range.
> Second, block scale factors are stored in E4M3 rather than UE8M0, trading some
> exponent range for additional mantissa bits. Third, an FP32 scale is applied
> at the tensor level to retain the range of block scales."*

| | MXFP4 | NVFP4 |
|---|---|---|
| Element | E2M1 (4 bit) | E2M1 (4 bit) |
| Block size | **32** | **16** |
| Block scale format | **UE8M0** (power-of-two only) | **UE4M3** (4 exp + 3 mantissa, unsigned) |
| Block scale range | 2⁻¹²⁷ … 2¹²⁷ | 2⁻⁹ … 448 |
| Scale steps per octave | 1 | 8 |
| Second-level scale | **none** | **per-tensor FP32** |
| Bits per element | 4.25 | 4.5 |
| Standard | OCP MX v1.0 | NVIDIA-proprietary |

The per-format/per-scale comparison table is also given independently in
arXiv [2606.09686](https://arxiv.org/abs/2606.09686) Table (MXFP4 vs NVFP4),
which agrees: block 32 vs 16, E8M0 vs FP8 E4M3, scale range `2⁻¹²⁷..2¹²⁷` vs
`≈2⁻⁹..448`, `4+8/32=4.25` vs `4+8/16=4.50` bits/element.

### 2.3 "Two-level block scaling", precisely

This phrase applies to **NVFP4 only**. MX formats are single-level.

From the NVFP4 paper §2, verbatim:

> *"This two-level scaling scheme works as follows: (1) a per-tensor FP32 scale
> remaps all the values within a tensor into representable range of a block
> (FP4 × FP8), then (2) a per-block E4M3 scale moves the values within a block
> into FP4 representable range."*

The reason level 1 exists at all is that level 2's scale format is *narrow*.
UE8M0 spans 254 binades so it never runs out of room; UE4M3 spans only
`2⁻⁹..448`. If a tensor's block amaxes were spread wider than that, the E4M3
scale itself would overflow or underflow. So a global FP32 factor first slides
the whole tensor so that its block scales land inside E4M3's range.

The exact procedure (Appendix B, verbatim equations):

1. **Global encode scale** (level 1), one FP32 number per tensor:
   `s_enc = (6 · 448) / amax_x`, where `amax_x = max_i |x_i|` over the *whole*
   tensor, `6` is E2M1's max magnitude and `448` is E4M3's. Its inverse
   `s_dec = 1/s_enc` is stored in FP32 and applied *after* the GEMM.
2. **Local decode scale** (level 2), one per 16-element block:
   `S_dec,b = amax_b / 6` where `amax_b = max_{i∈b} |x_i|`. Because the
   hardware needs it in FP8, it is first multiplied by the global encode scale
   and then rounded: `s_dec,b,e4m3 = e4m3(S_dec,b · s_enc)`, **round-to-nearest-even**.
3. The *actual* encode scale used on the data is recovered by inverting the
   already-quantized decode scale in high precision:
   `s_enc,b = 1 / (fp32(s_dec,b,e4m3) · s_dec)`. The paper stresses this:
   `s_enc,b · s_dec · s_dec,b,e4m3 ≈ 1`, and *"failing to do so can impact model
   accuracy."*
4. Elements: `x̂_i = q(x_i · s_enc,b)`, `q` = FP4 quantizer.
5. The tensor core applies the *block* scales inside the MMA, on partial
   dot-products over `b` elements:
   `s^x_dec,b,e4m3 · s^y_dec,b,e4m3 · Σ_{k∈b}(x_k·y_k)`.
   The *global* FP32 scales `s^x_dec` and `s^y_dec` are applied to the final
   output, after the GEMM.

So: **level 2 (per-block E4M3) is a hardware operand of the MMA instruction;
level 1 (per-tensor FP32) is an epilogue/software multiply.** That split is the
single most useful thing to make explicit.

### 2.4 Why the E4M3 scale actually buys accuracy — the worked example

The paper's Appendix B.4 argument, which is the best exercise in the whole
topic. Consider a block with `amax = 3+δ`.

- **MXFP4**: the ideal decode scale is `amax/6 = 0.5 + δ/6`, but UE8M0 can only
  represent powers of two, and we round **up** to avoid saturation, giving
  `s = 1`. After scaling, the block amax is still `3+δ`, which quantizes to `3`.
  So *the encodings ±4 and ±6 are never used*, and the utilized dynamic range
  collapses from `log2(6/0.5) = 3.58` binades to `log2(3/0.5) = 2.58` binades.
  In the worst case MXFP4 throws away one whole binade and 2 of its 8 magnitudes.
- **NVFP4**: E4M3 has 3 mantissa bits, so it can represent a scale much closer
  to `0.5 + δ/6`, mapping the block amax nearly exactly onto 6 and using all
  eight magnitudes.

Second benefit, also from §2: *"NVFP4 encodes at least 6.25% of values in a block
(the amax values in each block of 16 elements) at near-FP8 precision, while
storing the remaining values in FP4."* — because the block amax is represented
by an 8-bit scale times an exact FP4 6.0.

### 2.5 What the hardware actually accepts (PTX ISA 9.3, primary)

The block size / scale-type pairing is not a software convention; it is encoded
in the MMA instruction. From PTX ISA 9.3, `tcgen05.mma` Table 60 *"Valid
combinations of scale_vectorsize with types and MMA-Kind"*, verbatim:

| `.kind::*` | Element type | Scale type | `.scale_vectorsize` |
|---|---|---|---|
| `.kind::mxf8f6f4` | E4M3, E5M2, E2M3, E3M2, E2M1 | **UE8M0** | `.scale_vec::1X` / `.block32` |
| `.kind::mxf4` | E2M1 | **UE8M0** | `.scale_vec::2X` / `.block32` |
| `.kind::mxf4nvf4` | E2M1 | **UE8M0** | `.scale_vec::2X`/`.block32`, `.scale_vec::4X`/`.block16` |
| `.kind::mxf4nvf4` | E2M1 | **UE4M3** | `.scale_vec::4X` / `.block16` |

And explicitly: *".block32 is alias for .scale_vec::1X or .scale_vec::2X based on
.kind and K dimension; .block16 is alias for .scale_vec::4X."*

So **NVFP4 == `tcgen05.mma.kind::mxf4nvf4` with UE4M3 scales and `.block16`**, and
that combination is the *only* legal way to get UE4M3 scales. The warp-level
`mma.sync` path (used by consumer Blackwell) carries the same table under the
name `.scale_vec_size` (PTX Table 39), with identical constraints.

Note also: `.kind::mxf8f6f4` puts **FP8, FP6 and FP4 all under one UE8M0
block-32 instruction** — that is how the mixed-format examples (MXFP8 × MXFP4)
in CUTLASS work.

---

## 3. Numerical stability techniques

### 3.1 Stochastic rounding

**Definition.** Let `F` be the representable set, `⌊x⌋ = max{y∈F : y≤x}`,
`⌈x⌉ = min{y∈F : y≥x}`. For `x ∉ F`, stochastic rounding is

```
SR(x) = ⌈x⌉  with probability p = (x − ⌊x⌋)/(⌈x⌉ − ⌊x⌋)
        ⌊x⌋  with probability 1 − p
```

so `E[SR(x)] = p⌈x⌉ + (1−p)⌊x⌋ = x` **exactly**. Writing `SR(x) = x(1+δ)`, this
means `E[δ] = 0`.

Connolly, Higham & Mary call this **mode 2** and are careful to distinguish it
from **mode 1** (round up or down with probability ½ each), which is *not*
unbiased. "SR" in the ML literature always means mode 2.

> Source: Connolly, Higham & Mary, *Stochastic Rounding and Its Probabilistic
> Backward Error Analysis*, SIAM J. Sci. Comput. 43(1) (2021) A566–A585, Lemma 4.4.
> **There is no arXiv version** — it is MIMS EPrint 2020.12,
> <https://eprints.maths.manchester.ac.uk/2778/>.

Gupta et al.'s fixed-point statement, with spacing `ε = 2^−FL`
([arXiv 1502.02551](https://arxiv.org/abs/1502.02551) §3.1):

```
Round(x) = ⌊x⌋      w.p. 1 − (x−⌊x⌋)/ε
         = ⌊x⌋ + ε  w.p. (x−⌊x⌋)/ε
```

**Why SR beats round-to-nearest-even: stagnation.** Connolly–Higham–Mary state
the mechanism verbatim:

> *"If a parameter φ is updated by a quantity h that is less than half the
> spacing of the floating-point numbers around φ then fl(φ+h) = φ with round to
> nearest, so the information in h is lost."*

and for summation:

> *"At some point, the sum becomes so large that the spacing ψ of floating-point
> numbers around s becomes larger than the xᵢ. Specifically, if the xᵢ are less
> than ψ/2, then with round to nearest the computed sum absorbs the xᵢ and no
> longer grows... This leads to **necessarily negative rounding errors**, which
> therefore causes the error to start growing as nu rather than √n·u."*

The point students usually miss: stagnation is not "small terms are lost", it is
that **the lost errors all have the same sign**. That is what destroys the
mean-zero property and drags error growth back to `O(nu)`. Their Figure 5.2
(inner products of vectors uniform on [0,1]) shows RTN stagnating at
**n ≳ 10⁶ in FP32** and **n ≳ 10⁴ in FP16**; SR shows no stagnation.

**The √n result, stated properly.** This is the claim most often stated loosely,
so here is the exact chain:

- Constant: `γ̃ₙ(λ) = exp((λ√n·u + n·u²)/(1−u)) − 1 = λ√n·u + O(u²)`, versus the
  deterministic worst case `γₙ = nu/(1−nu)`.
- The earlier Higham–Mary result required the `δᵢ` to be **independent**, which
  is **false** under SR: in `fl(fl(a+b)+c)`, `δ₂` depends on `δ₁`. Hoeffding does
  not apply.
- **Lemma 4.5**: SR gives the weaker property of **mean independence**,
  `E(δₖ | δ₁,…,δₖ₋₁) = E(δₖ) = 0`.
- **Theorem 4.8** (verbatim): *"Let δ₁,…,δₙ be random variables of mean zero
  with |δₖ| ≤ u ... such that E(δₖ₊₁ | δ₁,…,δₖ) = E(δₖ₊₁) = 0. Then for ρᵢ = ±1
  and any constant λ > 0, ∏ᵢ(1+δᵢ)^ρᵢ = 1 + θₙ, |θₙ| ≤ γ̃ₙ(λ), holds with
  probability at least 1 − 2exp(−λ²/2)."* The proof makes the partial sums a
  **martingale** and applies **Azuma–Hoeffding** instead of Hoeffding — that
  substitution is the whole technical contribution.
- Headline, verbatim: *"for stochastic rounding the rule of thumb that one can
  replace nu in a worst-case error bound by √n·u ... is **unconditionally
  true**."*

Three caveats worth teaching alongside it:

1. **The unit roundoff doubles.** All downstream results use `u ← 2u` because SR
   can round away from the nearest value. Inner products get
   `γ̃⁽ˢ⁾ₙ(λ) = 2λ√n·u + O(u²)`.
2. **Failure probability degrades with problem size.** Theorem 4.9 (inner
   products) holds with probability `Q(λ,n) = 1 − 2n·exp(−λ²/2)`; Theorem 4.10
   (matmul, `m×n` by `n×p`) with `Q(λ, mnp)`. *Inference, not stated in the
   paper*: to hold confidence fixed you need `λ ~ √(2 log n)`, so the honest
   effective constant is `~u√(n log n)`. Still enormously better than `nu`.
3. **Expectation is exact** (Theorem 4.13): under SR, `E[ŷ]` equals the exact
   inner product.

**Origins.** Höhfeld & Fahlman 1992 introduced it to neural networks as
*probabilistic rounding* (Neurocomputing 4(4):291–299, and IEEE TNN 3(4):602–611);
pre-arXiv, no arXiv ID exists. Gupta et al. 2015 is the modern DL reference.
Higham & Pranesh 2019 gives the `chop` simulator. Survey: El Arar, Fasi, Filip &
Mikaitis, *What is New in Stochastic Rounding* ([arXiv 2603.06060](https://arxiv.org/pdf/2603.06060));
earlier survey Croci, Fasi, Higham, Mary & Mikaitis, R. Soc. Open Sci. 2022.

> **Correction to a common citation.** The SR-in-gradient-descent line is
> **Xia, Anthonissen, Hochstenbach & Koren** ([arXiv 2202.12276](https://arxiv.org/abs/2202.12276),
> JOTA 2023), *not* "Xia & Anzt" — Hartwig Anzt works on mixed-precision GPU
> linear algebra, a different line. Their result is interesting and
> counterintuitive: they propose SR variants that **deliberately give up zero
> bias** in exchange for a higher probability of preserving small gradients, and
> prove this *improves* convergence for convex problems.

**Where SR is actually applied — the papers differ sharply.** This is the part to
get right before teaching it.

| Paper | SR applied to |
|---|---|
| Gupta et al. 2015 ([1502.02551](https://arxiv.org/abs/1502.02551)) | Everywhere in a 16-bit fixed-point pipeline: the `Convert()` after MACC accumulation, i.e. weight updates and layer outputs. RTNE at <14 fractional bits fails because *"most of the parameter updates are rounded down to zero"*. LeNet-5/MNIST: RTNE **fails to converge at all**; SR gives 0.83% error at 14 bits. |
| **NVIDIA NVFP4** ([2509.25149](https://arxiv.org/abs/2509.25149)) | **Gradients only.** RTNE for weights and activations. Verbatim: *"applying stochastic rounding to the forward pass tensors is **detrimental**, as it amplifies quantization error relative to nearest rounding."* Their Fig. 10 ablation: SR on activations or weights **causes divergence**. SR must be applied to gradients feeding **both Dgrad and Wgrad**. |
| Tseng, Yu & Park, MXFP4 ([2502.20586](https://arxiv.org/abs/2502.20586)) | Both backward GEMMs (dgrad, wgrad), in MXFP4; forward stays BF16. Implemented as *dithering* — add uniform noise, then round to nearest. |
| Quartet ([2505.14669](https://arxiv.org/abs/2505.14669)) | dgrad and wgrad. Forward uses QuEST (Hadamard + RMSE-optimal clipping), not SR. |

> **Two corrections.** (a) Fishman et al., *Scaling FP8 training to trillion-token
> LLMs* ([2409.12517](https://arxiv.org/abs/2409.12517)) **does not use SR at
> all** — its contribution is *Smooth-SwiGLU* (after ~200B tokens `w₁` and `w₂`
> align under weight decay, the SwiGLU output goes quadratic and outliers exceed
> FP8 range; fixed by per-channel scaling on the linear branch). Its optimizer is
> E4M3 first moment / E5M2 second moment / FP16 master weights, no SR.
> (b) Wang et al., Microsoft FP4 ([2501.17116](https://arxiv.org/abs/2501.17116))
> **uses neither SR nor Hadamard rotations** — it uses a differentiable
> quantization estimator (DGE) and outlier clamping and compensation (OCC).
> Both are frequently miscited as SR papers.

**The synthesis worth teaching**: *SR on gradients, RTNE on the forward pass.*
SR is not free — it strictly **increases** per-element error variance in exchange
for zero bias. That trade pays off exactly where errors accumulate over many
optimizer steps (gradients) and hurts where a single accurate value matters
(forward activations and weights). NVIDIA's ablation showing forward-pass SR
causing divergence is the strongest evidence.

**Implementation — the bit-level recipe.** Croci et al. §7(c), verbatim:

> *"the k bits from the random stream are added to the k bits immediately
> following the first p bits of the normalised mₜ; if this operation leads to a
> carry out, we increment the top p bits of mₜ by 1 and truncate the bits after
> the first p bits ... Implementing SR by adding random bits to the fraction is
> almost universally used in the software and hardware implementations."*

The internal significand must be `p + k + 1` bits wide. Random bits can be
generated **asynchronously** — they don't depend on the operands — which is why
SR is cheap in hardware.

FP32 → BF16 concretely. BF16 is the top 16 bits of FP32, so `k = 16` gives
*exact* mode-2 SR:

```c
uint32_t bits = __float_as_uint(x);
bits += (uint32_t)rng16();               // uniform on [0, 2^16)
uint16_t bf16 = (uint16_t)(bits >> 16);  // truncate
```

The carry into bit 16 fires with probability `(bits & 0xFFFF)/2¹⁶`, which is
exactly the fractional distance to `⌈x⌉`. Caveats: this needs special-casing for
NaN/Inf (the add can carry into the exponent, turning a large finite into Inf)
and for destination subnormals.

FP8/FP4 is harder: for a *normalized* FP32 input, E4M3's 3 mantissa bits are a
prefix of FP32's 23, so you add a 20-bit random number and truncate — but
destination **subnormals need a variable-length shift**, so a fixed random width
is only approximate there. AMD documents exactly this: `CVT_SR_FP8_F32` uses 20
random bits, `CV_SR_BF8_F32` uses 21, giving *"exact SR for normalised binary32
values, but limited-precision SR for subnormals, for which exact SR would require
up to 24 random bits."*

**`cvt.rn` vs `cvt.rs` on Blackwell — verified against PTX ISA 9.3.**
NVIDIA added a hardware stochastic-rounding conversion. From the spec, the
rounding modifier table, verbatim:

> **`.rs`** — *"Stochastic rounding is achieved through the use of the supplied
> random bits. Operation's result is rounded in the direction toward zero or away
> from zero based on the carry out of the integer addition of the supplied random
> bits (`rbits`) to the truncated off (discarded) bits of mantissa from the input."*

Exact syntax (every form takes an extra `.b32` `rbits` operand):

```
cvt.rs{.relu}{.satfinite}.f16x2.f32     d, a, b, rbits;
cvt.rs{.relu}{.satfinite}.bf16x2.f32    d, a, b, rbits;
cvt.rs{.relu}.satfinite.f8x4type.f32    d, {a, b, e, f}, rbits;   // e4m3 / e5m2
cvt.rs{.relu}.satfinite.f6x4type.f32    d, {a, b, e, f}, rbits;   // e2m3 / e3m2
cvt.rs{.relu}.satfinite.f4x4type.f32    d, {a, b, e, f}, rbits;   // e2m1
```

Facts that matter:

- **Source type is always `.f32`.** There is no `.rs` conversion from f16/bf16.
- Destinations: f16, bf16, e5m2, e4m3, e2m3, e3m2, e2m1. The 8/6/4-bit forms are
  **x4-packed only** (four f32 in, four packed out) and `.satfinite` is
  **mandatory** for them.
- **Architecture, and this is the important one.** The doc says plainly:
  *".rs rounding mode is supported on following architectures: **sm_100a,
  sm_103a**"*. **`sm_120a` is NOT listed**, and there is no family-generic
  `sm_100f` fallback for `.rs` (unlike the neighbouring `ue8m0` conversions).
  So hardware SR is **datacentre Blackwell only (B200 / B300) — consumer
  Blackwell does not have it.** A curriculum that assumes a 5090 can do hardware
  SR is wrong.
- Introduced in **PTX ISA 8.7**.
- `rbits` allocation: for `.bf16x2`, the upper 16 bits go to operand `a`, lower
  16 to `b`. For `.f16x2`, 13 LSBs of each half. For the x4 8/6-bit forms,
  *"lower 16-bits are used for operands e, f and upper 16 bits ... for operands
  a, b"*; for `.e2m1x4`, 8 bits per operand. **Consequence: one 32-bit `rbits`
  feeds four outputs, so random bits are reused across pairs within a single
  instruction**, and the ISA does not specify how. NVIDIA's `.rs` therefore uses
  13–16 random bits, versus Graphcore's 13–24 and AMD's 20–21: it is
  **limited-precision SR, not exact SR**, and streams are not reproducible
  across vendors.
- **There is no CUDA C intrinsic for SR.** The FP8 conversion family
  (`__nv_cvt_float_to_fp8`, `__nv_cvt_float2_to_fp8x2`, …) and the FP4 family
  (`cuda_fp4.h`, `__nv_fp4_e2m1`) hard-code round-to-nearest-even. To get SR
  today you emit `cvt.rs` via inline PTX, or use a library that does — NVIDIA's
  Transformer Engine states SR *"is hardware-accelerated using native GPU
  instructions introduced with the Blackwell architecture."*

Other SR hardware, for context: Graphcore IPU (13–24 random bits, SR built into
the arithmetic itself), AMD MI300/CDNA4, Intel Loihi, Google Ironwood TPU,
AWS Trainium (SR via dithering, *"<2% overhead to a BF16 GEMM"*). The first known
SR hardware is Barnes et al. (1951).

### 3.2 Random Hadamard Transforms

**The problem: outliers.** LLM.int8() ([arXiv 2208.07339](https://arxiv.org/abs/2208.07339))
is the canonical reference. Its numbers: outlier features emerge as a **phase
shift between 6B and 6.7B parameters**, tracking *perplexity* rather than
parameter count. At 6.7B, roughly **150,000 outlier instances per 2048-token
sequence concentrate in just 6 feature dimensions**, with magnitudes **up to 20×**
larger than other dimensions (median outlier −44 to −35 against a typical
activation range of [−3.5, 3.5]). They affect all transformer layers and 75% of
sequence dimensions. Removing them costs >20% of the top-1 attention softmax
mass despite being ~0.1% of input features.
*Massive Activations* ([arXiv 2402.17762](https://arxiv.org/abs/2402.17762))
sharpens this: a handful of activations are up to **100,000×** larger than
others, stay near-constant regardless of input, and act as indispensable bias
terms. (This one I read only the abstract of.)

Why this kills 4 bits: the quantization scale is set by the **block max**. With a
16- or 32-element block, one outlier sets a scale under which every other element
rounds to zero. E2M1 has 16 codes and 3.58 binades of range; it cannot absorb a
20× dynamic range inside a block, let alone 10⁵×. The quantity that matters is
the **max/RMS ratio (kurtosis) within a block**, not the raw magnitude.

**Why an orthogonal rotation helps.** QuIP ([arXiv 2307.13304](https://arxiv.org/abs/2307.13304))
introduced *incoherence processing*. Their definition: `W ∈ R^{m×n}` is
**μ-incoherent** if `|W_ij| ≤ μ‖W‖_F/√(mn)` for all `i,j`. Read that carefully —
`‖W‖_F/√(mn)` *is* the RMS entry, so **μ is exactly the max/RMS ratio**, and
"incoherence processing" literally means "bound the max/RMS ratio". QuIP got
`μ = Õ(1)` from Kronecker products of `k` random orthogonal factors.

QuIP# ([arXiv 2402.04396](https://arxiv.org/abs/2402.04396)) replaced that with
the RHT and got a strictly better bound — **Lemma 3.1**:

> *"Let U ∈ R^{m×m} and V ∈ R^{n×n} be orthogonal scaled Hadamard matrices …
> Then V S_V H S_V Vᵀ is μ_H-incoherent … and U S_U W S_V Vᵀ is μ_W-incoherent …
> where **μ_H = √(2 log(2n²/δ))** and **μ_W = 2 log(4mn/δ)**."*

Their stated reasons for switching: incoherence dependence improves from
log-squared to logarithmic; runtime from `Θ(n√n)` to `Θ(n log n)`; and `±1`
entries eliminate floating-point multiplies.

> **Be careful with the "O(√(log n / n))" bound.** It is correct for the
> **vector** case: RMS = `‖x‖₂/√n`, so `μ_H = O(√(log n))` gives
> `max|xᵢ| ≤ O(√(log n / n))·‖x‖₂`. But QuIP#'s **weight** (two-sided) bound is
> `μ_W = 2 log(4mn/δ)` — **O(log n), not O(√log n)**. Do not quote the
> square-root form for the two-sided case.

The intuition: a random rotation makes each output coordinate an approximately
Gaussian mixture of all inputs, and the max of `n` Gaussians grows only like
`√(2 log n)` standard deviations. The outlier's mass is spread across all `n`
coordinates.

**Why Hadamard specifically** — four reasons, all confirmed:

1. **O(n log n)** via the fast Walsh–Hadamard transform for `n` a power of 2.
   A general `n×n` rotation is `O(n²)`, which for a GEMM operand is the same
   order as the GEMM itself — the stabilizer would cost as much as the thing it
   stabilizes.
2. **No multiplies.** Entries are `±1/√n`, so the FWHT is adds and subtracts with
   one scalar at the end.
3. **Self-inverse up to scaling**: `H_n H_nᵀ = I` for
   `H_d = (1/√2) H₂ ⊗ H_{d/2}` (NVFP4 Appendix C).
4. **The "random" part is a random diagonal sign matrix** `S` with `±1` entries;
   the transform is `H·S`.

**Why the random signs matter.** NVFP4 §4.2, verbatim:

> *"Random Hadamard transforms introduce randomness by multiplying with a random
> diagonal sign vector that flips the signs for entire rows or columns. **This
> reduces the chance that 'structured' outliers (e.g., tensor patterns aligned
> with the Hadamard basis) survive the transform.**"*

The adversarial case is concrete: a fixed `H_n` applied to a vector that *is* a
column of `H_n` maps it to a single spike — the transform maximally
**concentrates** instead of spreading. Since activation statistics are learned
and correlated across steps, nothing keeps them away from the fixed Hadamard
basis. The random signs turn a worst-case-over-inputs guarantee into an
in-expectation-over-signs guarantee — which is what makes the QuIP/QuIP#
incoherence lemmas provable at all (every one is "with probability ≥ 1−δ over the
random signs").
Empirical wrinkle from NVFP4: *"At small scales, randomization has no impact on
accuracy ... However, we find that randomization benefits larger models trained
over longer token horizons."*

**Where in the GEMM.** For `C = A·B` with orthogonal `H`,
`(A·H)·(Hᵀ·B) = A·B` exactly. So you rotate `A` and `B` independently along the
**shared (dot-product) dimension** before quantization, compute the scales in the
rotated space, and each operand's transform is undone by the other's during the
contraction. The result is unchanged in exact arithmetic; what changes is that
quantization now happens on a well-conditioned, near-Gaussian tensor.

**NVFP4's exact configuration** (verified verbatim from [2509.25149](https://arxiv.org/abs/2509.25149)):

- **Matrix size `d = 16`**, applied tile-wise: reshape the `m×k` tensor so every
  `16×16` chunk is multiplied by `H`.
- **Applied to Wgrad GEMM inputs only** — *not* Fprop, *not* Dgrad. Verbatim:
  *"we restrict Hadamard transforms to Wgrad inputs."*
- **The reason is structural, not just empirical.** §4.3: *"Random Hadamard
  transforms applied along the dot-product dimension introduce inconsistency
  after quantization (i.e., different transformations will result in different
  quantized values) and, therefore, are **not applied on the weight tensors**.
  As a result, transformed activations and gradients in weight-related GEMMs can
  no longer be inverted by transforming the weight tensor, preventing Fprop and
  Dgrad from benefiting."* The weight tensor must have **one** quantized
  representation shared across all three passes — that is what the 2D scaling is
  for — so it cannot be rotated. Wgrad is the one GEMM whose *both* operands
  (input activations and output gradients) are rotatable.
- **Ablation (Fig. 11, 1.2B / 1T tokens):** RHT on Wgrad improves validation
  loss; RHT on Fprop or Dgrad **degrades** quality.
- **Size ablation (Fig. 12, 12B model):** `4×4` increases loss; `128×128` gives a
  minor benefit; `16×16` chosen on cost/accuracy. At 1.2B there was *"virtually
  no difference"* between 2×2, 4×4, 16×16 and 128×128 — a clean example of a
  small-scale ablation failing to transfer.
- **A single random sign vector, shared across all linear layers, for the whole
  of training.** Verbatim: *"we use a single random sign vector that is shared
  across all linear layers throughout training. Our studies show **no measurable
  impact from increasing the number of random sign vectors**."*
- Their MXFP4 comparison run uses `d = 32` to match the MXFP4 block size.
- **Cost:** `m·k·d` multiply-adds plus `d²` reads, *"a small cost when d is much
  smaller than the tensor dimensions"*; implemented as batched matmuls,
  memory-traffic-bound, fusable with adjacent layers. **The paper gives no
  runtime percentage** — it explicitly says it is about algorithms, not runtime.

**Cost figures from elsewhere** (since NVFP4 gives none):

- MXFP4 ([2502.20586](https://arxiv.org/abs/2502.20586)): on an H100 the RHT adds
  **9.7% for a 7B-sized setup and 1.6% for 70B-sized** (the fixed `d×d` cost
  amortizes over larger GEMMs); end-to-end <5%. Their framing is sharp:
  *"if the RHT is slower than a FP4 matmul, one should just use FP8 instead."*
- QuaRot ([arXiv 2404.00456](https://arxiv.org/abs/2404.00456)) — inference, but
  the best source on *placement*: Hadamards are **fused offline into the weights**
  wherever possible, leaving only ~**1.5 online Hadamards per transformer layer**
  in the forward pass, for **at most 7%** of forward-pass runtime. For
  non-power-of-2 dimensions, factor `d = 2ⁿ·m` and use `H_d = H_{2ⁿ} ⊗ H_m`.
  The whole thing rests on *computational invariance*: RMSNorm divides by the
  norm, a rotation preserves the norm, so `Q` commutes through it.
- SpinQuant ([arXiv 2405.16406](https://arxiv.org/abs/2405.16406)) is the
  counterpoint: *"some random rotations lead to much better quantization than
  others, with an up to **13 points** difference in downstream zero-shot
  reasoning"*, so it **learns** the rotation (Cayley optimization on the Stiefel
  manifold) rather than sampling it. (Abstract only — I did not verify the
  mechanics.)

### 3.3 Why SR and RHT belong together — the one theorem to teach

Tseng, Yu & Park, MXFP4, **Theorem 3.2**, for block size `b` and quantization
step `Δ`:

> Without RHT, the variance of `Q(A)ᵀQ(B)` is `O(b · Δ⁴ · ‖A‖_∞ · ‖B‖_∞)`.
> With RHT, the variance of `Q(HSA)ᵀQ(HSB)` is, with probability ≥ `(1−ε)²`,
> `O(Δ⁴ · ‖A‖ · ‖B‖ · log(2b/ε))`.

That is the entire argument for pairing them. **SR buys unbiasedness and pays in
variance; in a block format that variance is driven by the block max, i.e. by
outliers. RHT converts the variance's dependence on block size from linear (`b`)
to logarithmic (`log b`) and swaps `‖·‖_∞` for `‖·‖`.** SR alone in FP4 is
high-variance; RHT alone is biased; together you get an unbiased, low-variance
gradient estimator.

Their recipe: forward BF16, both backward GEMMs MXFP4, FP32 master weights,
">1/2 of training FLOPs in MXFP4"; RHT block size **g = 64** (mixing across two
MX blocks of 32); operands scaled by **3/4** before quantization to prevent
clipping, accumulator rescaled by **16/9**. NVFP4's Fig. 8 makes the same point
from the other direction: the base method (all-NVFP4, RTNE, 1D scales)
**diverges early**, and *"techniques such as stochastic rounding can improve
training stability, [but] they eventually diverge when used in isolation."*

### 3.4 An open disagreement — flag this to students

[arXiv 2605.09825](https://arxiv.org/abs/2605.09825), *Pretraining Large Language
Models with MXFP4 on Native FP4 Hardware*, claims verbatim:

> *"Stochastic rounding and randomized Hadamard rotations fail to stabilize
> training once Wgrad is quantized, whereas **deterministic** Hadamard rotations
> consistently restore stable optimization."*

Their Table 1 reports **"Does Not Converge"** for both SR-with-full-MXFP4 and
randomized-`H₁₆`-with-full-pipeline, while deterministic `H₁₆` is stable at 8–9%
token overhead, applied across **all three** passes.

This contradicts Tseng et al., NVIDIA and Quartet. **Do not present this as
settled.** Plausible reconciliations (speculation, not stated in any paper): the
format differs (MXFP4/UE8M0 single-level vs NVFP4/UE4M3 two-level), the scale
differs, and NVIDIA themselves report that randomization *"has no impact at small
scales"*. NVIDIA also found SR *in isolation* eventually diverges, which is not
far from the negative result. Two further recent papers I surfaced but did not
read: *Elucidating the Design Space of FP4 training*
([arXiv 2509.17791](https://arxiv.org/abs/2509.17791)) and *Quartet II*
([arXiv 2601.22813](https://arxiv.org/abs/2601.22813)).

---

## 4. The hardware

Sources: PTX ISA 9.3 §9.7.17 *"TensorCore 5th Generation Family Instructions"*,
CUDA Programming Guide §5.1 *"Compute Capabilities"*, NVIDIA's own
[CUDA GPU compute-capability table](https://developer.nvidia.com/cuda-gpus),
the [RTX Blackwell whitepaper](https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf),
the [Blackwell Ultra blog](https://developer.nvidia.com/blog/inside-nvidia-blackwell-ultra-the-chip-powering-the-ai-factory-era/),
and CUTLASS `media/docs/cpp/blackwell_functionality.md`.

### 4.1 The `tcgen05` instruction family

All introduced in **PTX ISA 8.6**; `.kind::mxf4nvf4` in 8.7; `.block16`/`.block32`
in 8.8.

| Instruction | What it does | Issued by |
|---|---|---|
| `tcgen05.alloc` / `.dealloc` / `.relinquish_alloc_permit` | Dynamically allocate / free TMEM columns | **one warp** (one warp in each peer CTA for `cta_group::2`) |
| `tcgen05.mma` / `.mma.sp` / `.mma.ws` / `.mma.ws.sp` | The MMA: `D = A·B + D` | **a single thread** |
| `tcgen05.ld` / `.st` | Async TMEM ↔ registers | one warp reaches only ¼ of TMEM ⇒ a warpgroup for all of it |
| `tcgen05.cp` | Async **smem → TMEM** copy, with optional FP6/FP4 decompression (`.b6x16_p32` / `.b4x16_p64` → `.b8x16`) | single thread |
| `tcgen05.shift` | Async shift all rows of a TMEM matrix down by one (for convolution) | single thread |
| `tcgen05.commit` | Makes an `mbarrier` track completion of prior async tcgen05 ops | single thread |
| `tcgen05.wait::ld` / `::st` | Block until this thread's prior ld/st complete | warp-wide `.sync.aligned` |
| `tcgen05.fence::before_thread_sync` / `::after_thread_sync` | Ordering fences for the async pipeline; also code-motion barriers | per-thread |

### 4.2 `tcgen05.mma` vs Hopper's `wgmma`

**Single-thread issue.** PTX, verbatim:

> *"The instruction `tcgen05.mma` has single thread semantics, unlike the
> collective instructions `mma.sync` or `wgmma.mma_async`. So, a single thread
> issuing the `tcgen05.mma` will result in the initiation of the whole matrix
> multiply and accumulate operation."*

Hopper's `wgmma.mma_async` is `.sync.aligned` across a **warpgroup (128
threads)** and requires `sm_90a`.

**Where the operands live.** `tcgen05.mma`: **A in TMEM or shared memory, B in
shared memory** (of the current CTA and optionally the peer CTA), **D in TMEM**.
Hopper's `wgmma` keeps the accumulator **in registers** distributed across the
warpgroup.

**Shapes.** `wgmma` is fixed at M=64 (`m64nNk16`, N = 8…256). `tcgen05.mma`
supports M ∈ {64,128} for `cta_group::1` and M ∈ {128,256} for `cta_group::2`.

**2-SM (CTA-pair) MMA.** `.cta_group::2` makes one MMA operate on the TMEM of the
issuing CTA **and its peer**. A CTA pair is *"any 2 CTAs within the cluster whose
`%cluster_ctarank` differs by the last bit only"*, and a **single thread in the
pair** initiates it. Constraint: **all** tcgen05 instructions in a kernel must use
the same `.cta_group`. NVIDIA's phrasing: *"dual-thread-block MMA, where paired
SMs cooperate on a single MMA operation, sharing operands and reducing redundant
memory traffic."*

**Extras with no `wgmma` equivalent:** `scale-input-d` (scale the accumulator by
`2⁻ⁿ`, n ∈ [0,15], only for `.kind::tf32` / `.kind::f16`); `.ashift`; and the
`.collector::a::{fill,use,lastuse,discard}` operand-reuse buffer.

### 4.3 Block-scaled MMA variants

PTX §9.7.17.10.7. The instruction computes `(A·scale_A)·(B·scale_B) + D`, and
crucially **`scale_A` and `scale_B` also live in Tensor Memory** — *"scale factors
for A and B matrices need to be duplicated to all 32 lane partitions of tensor
memory."*

The type/size table is reproduced in §2.5 above. Shapes (PTX Table 42):

| `.kind` | `cta_group::1` | `cta_group::2` | K (dense / sparse) |
|---|---|---|---|
| `mxf8f6f4` | `128xNxK`, N = 8,16,…256 step 8 | `128/256xNxK`, N step 16 | 32 / 64 |
| `mxf4` | `128xNxK`, N step 8 | `128/256xNxK`, N step 16 | 64 / 128 |
| `mxf4nvf4` | `128xNxK`, N step 8 | `128/256xNxK`, N step 16 | 64 / 128 |

`K = 96` is **`sm_103a`-only** (Blackwell Ultra), with scale shapes M×6
(`.block16`) and M×3 (`.block32`). `.ws` (weight-stationary) is **invalid** for
all three block-scaled kinds.

### 4.4 TMEM (Tensor Memory)

PTX §9.7.17.1, verbatim:

> *"The 5th generation TensorCore has dedicated on-chip memory that is
> specialized for use by TensorCore operations. This Tensor Memory is organized
> as a two-dimensional matrix where the horizontal rows are called **lanes** and
> the vertical columns are called **columns**."*

- **Size**: *"On architecture `sm_100a` / `sm_100f`, the 5th generation
  TensorCore's Tensor Memory has a two-dimensional structure of **512 columns and
  128 rows per CTA, with each cell being 32-bits in size**."* → 512 × 128 × 4 B =
  **256 KB per SM**, independently stated by NVIDIA's Blackwell Ultra blog as
  *"256 KB of Tensor Memory (TMEM) per SM."*
  ⚠ The spec scopes the 512×128 figure to `sm_100a`/`sm_100f` and does **not**
  restate it for `sm_103`/`sm_110`.
- **Addressing**: 32-bit address, bits 31:16 = lane index, bits 15:0 = column.
- **Allocation**: dynamic, via `tcgen05.alloc`, issued from **a single warp** in
  the CTA. Unit of allocation is **32 columns** (all 128 lanes); `nCols` must be a
  **power of 2 in [32, 512]**; the number of columns allocated *"should not
  increase between any two allocations in the execution order within the CTA"*.
  `tcgen05.alloc` **blocks** until it can be satisfied. **All TMEM allocated in a
  kernel must be explicitly deallocated before the kernel exits.**
- **Access rules** (§9.7.17.8.1), verbatim: *"The Tensor Memory of a CTA is
  divided into 4 equal chunks such that each warp of a warpgroup in the CTA can
  access a chunk… **A lane of the Tensor Memory can be accessed by a single warp
  in the warpgroup.**"*

  | warp id in warpgroup | accessible lanes |
  |---|---|
  | 0 | 0–31 |
  | 1 | 32–63 |
  | 2 | 64–95 |
  | 3 | 96–127 |

  All *columns* are reachable by all four warps, so a **full warpgroup is needed
  to touch the whole TMEM**. Within `tcgen05.ld`/`.st`, every thread in the warp
  must supply the *same* `taddr`.
- **Ld/st shapes**: `.32x32b`, `.16x64b`, `.16x128b`, `.16x256b`, `.16x32bx2`,
  each with `.num` ∈ {x1…x128}, plus optional `.pack::16b`. `tcgen05.ld.red`
  additionally does a `.min`/`.max` reduction during the load.
- **Why it exists.** On Hopper the `wgmma` accumulator lives in the register file,
  so a large tile burns a large fraction of the 64K 32-bit registers per SM and
  caps occupancy and pipelining depth. Moving D (and optionally A, and the scale
  factors) into a separate 256 KB store frees the register file **and** lets a
  single thread launch an MMA that no longer has to match a register distribution
  across 128 threads.

### 4.5 What 5th-gen tensor cores added over Hopper's 4th-gen

1. **Native FP6 and FP4 tensor-core inputs** — `.e2m1`, `.e2m3`, `.e3m2`, first
   appearing at CC 10.0 in the Programming Guide's Table 33.
2. **Block scaling in hardware** — scale factors are first-class instruction
   operands read from TMEM, with UE8M0 and UE4M3 scale types and hardware block
   sizes of 32 and 16.
3. **TMEM** — a whole new addressable memory space with its own instruction set.
4. **Single-thread MMA issue** instead of warpgroup-collective issue.
5. **2-SM (CTA-pair) MMA** — `cta_group::2`.
6. **FP6/FP4 decompression on the smem→TMEM copy path** (`tcgen05.cp`).

**Relative throughput** (CUTLASS, per-instruction vs Hopper):

> *"Blackwell SM100 has 7 new `tcgen05.mma` instructions. These instructions are
> **2x to 4x faster then Hopper Architecture's WGMMA instructions**."*

`kind::tf32`, `kind::f16`, `kind::i8`, `kind::f8f6f4`, `kind::mxf8f6f4` → **2×**
the corresponding Hopper tensor core; `kind::mxf4`, `kind::mxf4nvf4` → **4×
Hopper FP8**.

**Absolute, per GPU** — NVIDIA's Blackwell Ultra blog, **dense | sparse**
explicitly labelled:

| | Hopper | Blackwell (B200) | Blackwell Ultra (B300) |
|---|---|---|---|
| NVFP4 dense \| sparse | – | **10 \| 20 PFLOPS** | **15 \| 20 PFLOPS** |
| FP8 dense \| sparse | **2 \| 4 PFLOPS** | **5 \| 10 PFLOPS** | **5 \| 10 PFLOPS** |
| Attention SFU EX2 | 4.5 TeraExp/s | 5 TeraExp/s | 10.7 TeraExp/s |
| Transistors / dies | 80B / 1 | 208B / 2 | 208B / 2 |
| HBM | 80 GB (H100), 141 GB (H200) | 192 GB HBM3E | 288 GB HBM3E |

Note B300's NVFP4 **sparse rate did not move** from B200 (20 PFLOPS both), so its
sparse is not 2× its dense.

**Consumer**, RTX 5090 (GB202, 170 SMs, 680 5th-gen tensor cores), from the RTX
Blackwell whitepaper Appendix A, **dense / sparse**:

| | RTX 3090 Ti | RTX 4090 | RTX 5090 |
|---|---|---|---|
| FP4 tensor TFLOPS | N/A | N/A | **1676 / 3352** |
| FP8 tensor TFLOPS (FP16 accum) | N/A | 660.6 / 1321.2 | **838 / 1676** |
| FP8 tensor TFLOPS (FP32 accum) | N/A | 330.3 / 660.6 | **419 / 838** |
| FP16 tensor TFLOPS (FP32 accum) | 71.2 / 142.4 | 165.2 / 330.4 | **209.5 / 419** |
| INT8 tensor TOPS | 284.7 / 569.4 | 660.6 / 1321.2 | **838 / 1676** |

Consumer FP4 is exactly 2× its FP8-with-FP16-accumulate rate, and FP8-with-FP32
accumulate is half rate — matching CUTLASS's note that SM120
`mma.sync.kind::f8f6f4` is *"1x Ada Fp8 Tensor Core (2x for FP32 accumulator)"*.

### 4.6 Architecture → compute capability

From NVIDIA's own [CUDA GPU table](https://developer.nvidia.com/cuda-gpus):

| CC | Target | Data centre | Workstation / consumer | Jetson |
|---|---|---|---|---|
| **12.1** | `sm_121` | — | — | **GB10 (DGX Spark)** |
| **12.0** | `sm_120` | RTX PRO 6000 / 4500 Blackwell Server Edition | RTX PRO 6000/5000/4500/4000/2000 Blackwell, **GeForce RTX 5090, 5080, 5070 Ti, 5070, 5060 Ti, 5060, 5050** | — |
| **11.0** | `sm_110` | — | — | **Jetson T5000 / T4000 (Thor)** |
| **10.3** | `sm_103` | **GB300, B300**, GB300 (DGX Station) | — | — |
| **10.0** | `sm_100` | **GB200, B200** | — | — |
| **9.0** | `sm_90` | GH200, H200, **H100** | — | — |
| **8.9** | `sm_89` | L4, L40, **L40S** | RTX Ada series, **GeForce RTX 40-series** | — |
| **8.7** | `sm_87` | — | — | Jetson AGX Orin family |
| **8.6** | `sm_86` | **A40, A10**, A16, A2 | RTX A-series, **GeForce RTX 30-series** | — |
| **8.0** | `sm_80` | **A100**, A30 | — | — |

Confirming the assumptions in the brief: **sm_80 = A100** (and A30) ✓;
**sm_86 = consumer Ampere RTX 30-series + A10/A40** ✓; **sm_89 = Ada Lovelace
(RTX 40-series, L40S)** ✓; **sm_90 / sm_90a = Hopper (H100/H200)** ✓;
**sm_100 = B200/GB200** ✓; **sm_103 = B300 / Blackwell Ultra / GB300** ✓;
**sm_120 = RTX 50-series *and* RTX PRO 6000 Blackwell** (the PRO card is 12.0, it
does not get its own CC) ✓.

Two corrections:

- **`sm_121` is GB10 / DGX Spark, not Thor.** Thor is **CC 11.0 = `sm_110`**, and
  `sm_110` is the CUDA-13 **rename of the old `sm_101`** — PTX repeats throughout:
  *"`sm_101a` (Renamed to `sm_110a` from PTX ISA version 9.0)"*.
- **B100 is absent from NVIDIA's table.** Only GB200 and B200 are listed at 10.0.
  B100 = CC 10.0 is widely reported and almost certainly right (same GB100
  silicon) but is **not** confirmed by an NVIDIA primary source.

Corroborating that `sm_120` really is a different SM: max statically-declarable
shared memory per CTA (PTX §5.1.7) is **228 KB** on `sm_90a`, `sm_100a`,
`sm_103a`, `sm_110a`, but **100 KB** on `sm_120a` / `sm_121a`.

### 4.7 Which precisions each generation added

Verbatim from CUDA Programming Guide Table 33, *"Input Data Types Supported by
Tensor Core Acceleration per Compute Capability"* (`Y` = supported):

```
CC    FP64  TF32  BF16  FP16  FP8  FP6  FP4  INT8  INT4
7.5     .     .     .    Y     .    .    .    Y     Y
8.0     Y     Y     Y    Y     .    .    .    Y     Y
8.6     .     Y     Y    Y     .    .    .    Y     Y
8.7     .     Y     Y    Y     .    .    .    Y     Y
8.9     .     Y     Y    Y     Y    .    .    Y     Y
9.0     Y     Y     Y    Y     Y    .    .    Y     .
10.0    Y     Y     Y    Y     Y    Y    Y    Y     .
10.3    .     Y     Y    Y     Y    Y    Y    Y     .
11.0    .     Y     Y    Y     Y    Y    Y    Y     .
12.x    .     Y     Y    Y     Y    Y    Y    Y     .
```

What each generation **added**:

- **`sm_80` (A100)** — **BF16** and **TF32** tensor cores, **FP64** tensor cores,
  and structured **2:4 sparsity** (`mma.sp`, PTX 7.1). PTX: *"`.bf16` … requires
  `sm_80` or higher"*, *"`.tf32` … requires `sm_80` or higher"*, *"`.f64` …
  `.m8n8k4` … requires `sm_80` or higher"*.
- **`sm_86` / `sm_87` (consumer Ampere, A10/A40, Orin)** — **no new tensor-core
  input type**, and it **loses FP64 tensor cores** relative to `sm_80`.
- **`sm_89` (Ada)** — **FP8 E4M3 / E5M2** via `mma.sync`. PTX: *"`.e4m3` and
  `.e5m2` alternate floating point type mma operation requires `sm_89` or higher."*
- **`sm_90` / `sm_90a` (Hopper)** — the **`wgmma.mma_async` warpgroup MMA**
  (accumulator in registers, M=64, N up to 256), supporting FP8 alongside
  f16/bf16/tf32/s8/b1. PTX: `wgmma.mma_async` *"Requires `sm_90a`."* FP64 tensor
  cores return; INT4 is dropped. `sm_90` also brought clusters, TMA
  (`cp.async.bulk.tensor`) and `.shared::cluster`.
- **`sm_100` (Blackwell datacentre)** — **FP6 (E2M3/E3M2)**, **FP4 (E2M1)**, the
  whole **`tcgen05` family**, **TMEM**, **hardware block-scaled MMA**, and the
  **2-SM CTA-pair MMA**.
- **`sm_103` (Blackwell Ultra)** — same type set as 10.0 minus FP64 tensor cores;
  adds `K=96` block-scaled shapes and doubled SFU EX2 throughput for softmax.
- **`sm_120` (consumer / pro Blackwell)** — the same *type* set, **but a
  completely different instruction path.**

### 4.8 The critical asymmetry: `sm_120` has no `tcgen05` and no TMEM

This is the easiest thing in the whole topic to get wrong, so here is the
evidence, strongest first.

1. **PTX Target ISA Notes.** Extracting the "Target ISA Notes" block from *every*
   `tcgen05.*` section of PTX ISA 9.3 gives:

   ```
   tcgen05.alloc/dealloc/relinquish : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_110f
   tcgen05.ld                       : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_103f, sm_110f
   tcgen05.st                       : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_110f
   tcgen05.wait                     : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_110f
   tcgen05.cp                       : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_110f
   tcgen05.shift                    : sm_100a, sm_101a, sm_103a, sm_110a
   tcgen05.mma                      : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_110f
   tcgen05.mma.sp                   : sm_100a, sm_101a, sm_103a, sm_110a + sm_100f, sm_101f, sm_110f
   tcgen05.mma.ws / .ws.sp          : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_110f
   tcgen05.fence                    : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_110f
   tcgen05.commit                   : sm_100a, sm_101a, sm_110a  + sm_100f, sm_101f, sm_110f
   ```
   **`sm_120` and `sm_121` appear nowhere.** (`sm_103` is covered by "`sm_100f` or
   higher in the same family".)
2. **The Tensor Memory section** scopes TMEM to `sm_100a`/`sm_100f`, and TMEM is
   only addressable through `tcgen05` instructions.
3. **`sm_120` uses warp-level `mma.sync` with block scaling instead.** PTX
   `mma.sync` Target ISA Notes: *"`.e3m2`, `.e2m3` and `.e2m1` alternate floating
   point type mma operation requires **`sm_120a`** … Support for `.kind`,
   `.block_scale`, `.scale_vec_size` qualifier requires **`sm_120a`** …"* and
   *"Qualifiers `.kind::mxf4nvf4` and `.kind::mxf4` are supported on following
   architectures: `sm_120a`, `sm_121a`."* The SM120 block-scaled shapes are
   `m16n8k32` (`kind::mxf8f6f4`) and `m16n8k64` (`kind::mxf4`, `kind::mxf4nvf4`) —
   **warp-level tiles with register-resident C/D**, and the **scale factors arrive
   as register operands** (`scale-a-data`, `scale-b-data`) selected by
   `{byte-id, thread-id}` tuples within a quad, **not from TMEM**. The SM120 path
   also only accepts `.scale_vec::1X/2X/4X` — the `.block16`/`.block32` aliases
   require `sm_100f`/`sm_110f`.
4. **CUTLASS keeps them in separate sections**: "Blackwell SM100 introduces
   `tcgen05.mma` instructions" versus a "Blackwell SM120 GEMMs" section listing
   `mma.sync.aligned.kind::mxf4nvf4.block_scale.scale_vec::[2X|4X]` etc., and
   describing SM120 as *"Similar to Hopper's warp-group GEMM … two groups of 4 MMA
   warps … one group of 8 MMA warps"* — register-based warp scheduling, no TMEM.
5. **The RTX Blackwell whitepaper** describes 5th-gen tensor cores as adding
   *"FP4 and FP6 Tensor Core operations, and the new Second-Generation FP8
   Transformer Engine, similar to our datacenter-class Blackwell GPUs"* — and
   **never mentions tensor memory or 2-SM MMA anywhere**.

> **Honest caveat.** There is no NVIDIA sentence that literally says "sm_120 has
> no Tensor Memory". The conclusion is an inference from (a) no tcgen05
> instruction targets sm_120/121, (b) TMEM is only reachable via tcgen05, and
> (c) CUTLASS routes SM120 through `mma.sync`. Strong, but an inference.

**Practical consequence.** Kernels written against `tcgen05` — most CUTLASS SM100
GEMMs, most Blackwell FP4/FP8 training kernels — **will not compile or run on
RTX 50-series, RTX PRO 6000 Blackwell, or DGX Spark.** Those need the separate
SM120 `mma.sync` path, with different tile shapes, TN-only layouts for the FP4
kinds, and roughly ¼ the per-SM MMA rate of sm_100. **And hardware stochastic
rounding (`cvt.rs`) is sm_100a / sm_103a only** (§3.1) — consumer Blackwell does
not have it either. Plan the curriculum's hardware access around this.

### 4.9 The `a` / `f` / bare target suffixes

CUDA Programming Guide §5.1.2 *"Feature Availability"* and PTX §11.1.2 `.target`.
Three nested feature sets: **baseline ⊂ family-specific (`f`) ⊂
architecture-specific (`a`)**.

- **`sm_100` (bare) — baseline.** Follows the "onion layer model", forward
  compatible with all later CC 10.0+ devices. **No architecture-specific
  features**, therefore **no `tcgen05` and no `wgmma`**.
- **`sm_100f` — family-specific.** Introduced with CC 10.0 / PTX 8.8; runs on any
  device in the same family. PTX Table 61 defines the families:
  `sm_10x` = {`sm_100f`, `sm_103f`}; `sm_11x` = {`sm_110f`, `sm_101f` legacy};
  `sm_12x` = {`sm_120f`, `sm_121f`}. Device side: `compute_100f` runs on CC 10.0
  **and 10.3**; `compute_120f` runs on 12.0 **and 12.1**.
- **`sm_100a` — architecture-specific.** Introduced with CC 9.0. Does *not* follow
  the onion model: *"PTX code generated for such targets cannot be run on later
  generation devices."* `compute_100a` runs on CC 10.0 and nothing else.

**Which you need for `tcgen05`:** `sm_100a` (or `sm_101a`/`sm_103a`/`sm_110a`)
works for everything. From **PTX 8.8 / CUDA 12.9** onward the family targets
`sm_100f` and `sm_110f` (and `sm_103f` by family inclusion) also work for the core
tcgen05 set. Exceptions where `a` is still mandatory:

- *"`.kind::i8` is supported on … `sm_100a`, `sm_101a`, `sm_110a`"* (no f-targets)
- *"Argument `scale-input-d` requires `sm_100a`"*
- *"`.scale_vec::1X`, `.scale_vec::2X`, `.scale_vec::4X` requires `sm_100a`.
  `.block16`, `.block32` requires `sm_100f` or `sm_110f`."* — i.e. **on an
  `f`-target you must use the `.blockN` spellings, not `.scale_vec::NX`.**
- `tcgen05.shift` lists only `a`-targets.

CUTLASS builds with `-DCUTLASS_NVCC_ARCHS=100a` for SM100 and `90a` for Hopper.
`nvcc -arch=sm_90a` expands to
`--gpu-architecture=compute_90a --gpu-code=sm_90a,compute_90,compute_90a`.

---

## 5. CUTLASS and CuTe

Everything in this section was read from a shallow clone of `NVIDIA/cutlass` at
commit `dc45f979ae336a235da1676b311f35efeb30149a` (Aug 2026),
`include/cutlass/version.h` → **CUTLASS 4.8.0**. Paths are repo-relative; prefix
`https://github.com/NVIDIA/cutlass/blob/main/` for a URL. Rendered docs:
<https://docs.nvidia.com/cutlass/latest/>.

### 5.1 CuTe layout algebra — the minimum to teach

The docs were reorganized: CuTe docs now live under **`media/docs/cpp/cute/`**
(older tutorials and blog posts point at `media/docs/cute/`, which no longer
exists). Current files:

| File | Covers |
|---|---|
| `media/docs/cpp/cute/00_quickstart.md` | Setup, library organization, `print` / `print_layout` |
| `media/docs/cpp/cute/01_layout.md` | `IntTuple`, Shape, Stride, **Layout**, Tensor, hierarchical access, compatibility, coordinates, slicing, grouping/flattening |
| `media/docs/cpp/cute/02_layout_algebra.md` | **coalesce, composition, complement, logical_divide, zipped/tiled/flat divide, logical_product** |
| `media/docs/cpp/cute/03_tensor.md` | Engines, tiling, slicing, **`local_tile` / `local_partition`**, thread-value partitioning |
| `media/docs/cpp/cute/04_algorithms.md` | `copy`, `copy_if`, `gemm`, `axpby`, `fill`, `clear` |
| `media/docs/cpp/cute/0t_mma_atom.md` | MMA atoms, traits, TV mappings, **`TiledMMA`** |
| `media/docs/cpp/cute/0x_gemm_tutorial.md` | `sgemm_1.cu`/`sgemm_2.cu` walkthrough, `TiledCopy`, `TiledMMA` |
| `media/docs/cpp/cute/0y_predication.md` | Predication for imperfect tiling |
| `media/docs/cpp/cute/0z_tma_tensors.md` | ArithTuple iterators, "strides aren't just integers", TMA tensors |

The concepts, in the order they build:

- **A `Layout` is a `(Shape, Stride)` pair, and it is a function.** It maps a
  logical coordinate to a linear offset. Shapes and strides are `IntTuple`s, so
  layouts nest arbitrarily — `((_3,2),(2,_5,_2)):((4,1),(_2,13,100))` is a real
  example from `03_tensor.md`.
- **`Tensor = Engine + Layout`.** The engine is the iterator/pointer, tagged with
  its memory space; `gmem`, `smem`, `rmem` and — since 3.8 — **`tmem`** are all
  first-class locales. Slicing with `_` folds the offset into the iterator.
- **`composition(A, B)`** — function composition of layouts. `B` selects
  coordinates out of `A`.
- **`complement(A, cotarget)`** — "the rest": the unique ordered, codomain-disjoint
  layout that fills out `cotarget`. Post-conditions are asserted in
  `test/unit/cute/core/complement.cpp`.
- **`logical_divide(A, tiler)`** — formally `A ∘ (tiler, tiler*)`, and literally
  implemented as `composition(layout, make_layout(tiler, complement(tiler, size(layout))))`.
  Mode 0 = elements inside a tile, mode 1 = the layout of tiles. The four flavours
  (verbatim from `02_layout_algebra.md`):

  ```
  Layout Shape : (M, N, L, ...)     Tiler Shape : <TileM, TileN>
  logical_divide : ((TileM,RestM), (TileN,RestN), L, ...)
  zipped_divide  : ((TileM,TileN), (RestM,RestN,L,...))
  tiled_divide   : ((TileM,TileN), RestM, RestN, L, ...)
  flat_divide    : (TileM, TileN, RestM, RestN, L, ...)
  ```
  Nice identity for exercises: `layout<0>(zipped_divide(a,b)) == composition(a,b)`.
- **`logical_product(A, B)`** = `(A, A* ∘ B)` — mode 0 is `A`, mode 1 replicates
  it. `blocked_product` / `raked_product` are built on it. Note: products are
  defined for `Layout`s, **not** for `Tensor`s (they grow the codomain).
- **`local_tile` / `local_partition`** — the CTA-level and thread-level
  partitioners. `local_tile(T, Tiler, Coord)` is `inner_partition`; 
  `local_partition(T, ThrLayout, Idx)` is `outer_partition` with the thread
  layout inverted to turn a linear thread index into a coordinate.
- **TV (thread-value) layouts** — a `(T, V) -> (M, N)` layout; you `composition`
  it against the data layout and then slice `tv(threadIdx.x, _)`. This is how
  MMA and Copy atoms describe register fragments (`0t_mma_atom.md` §Traits).
- **`TiledMMA` / `TiledCopy`** — an *Atom* is "the smallest collection of threads
  and data that must participate" in one hardware instruction; tiling an atom
  over a larger thread/data shape gives a `TiledMMA` / `TiledCopy`
  (`media/docs/cpp/gemm_api_3x.md` §"Atom API", §"Tiled MMA and Copy").

Raw-CuTe example files (`examples/cute/`): `tutorial/sgemm_1.cu`, `sgemm_2.cu`,
`sgemm_sm70.cu`, `sgemm_sm80.cu`, `tiled_copy.cu`; Hopper:
`tutorial/hopper/wgmma_sm90.cu`, `wgmma_tma_sm90.cu`; **Blackwell ladder**:
`tutorial/blackwell/01_mma_sm100.cu`, `02_mma_tma_sm100.cu`,
`03_mma_tma_multicast_sm100.cu`, `04_mma_tma_2sm_sm100.cu`,
`05_mma_tma_epi_sm100.cu`. Layout unit tests in `test/unit/cute/core/` make good
drills.

### 5.2 The collective mainloop

Doc: **`media/docs/cpp/gemm_api_3x.md`** (also `cutlass_3x_design.md`,
`code_organization.md`). The layering, verbatim from that doc:

| API level | Class / function |
|---|---|
| Device | `cutlass::gemm::device::GemmUniversalAdapter` |
| Kernel | `cutlass::gemm::kernel::GemmUniversal` |
| **Collective** | `cutlass::gemm::collective::CollectiveMma`, `cutlass::epilogue::collective::{DefaultEpilogue, Epilogue}` |
| Tiled | `cute::TiledMma`, `cute::TiledCopy`, `cute::gemm()`, `cute::copy()` |
| Atom | `cute::Mma_Atom`, `cute::Copy_Atom` |

Definitions worth quoting to students:

- A **collective** is *"the largest collection of threads onto which mma atoms and
  copy atoms are tiled"* — the largest group that can cooperate through hardware
  features (async copy, MMA over shared memory, cluster/CTA/warp barriers). The
  **collective mainloop** (`CollectiveMma`) owns the `k_tile` loop: prologue,
  the software-pipelined load/compute loop, and the epilogue handoff. It is where
  mainloop fusions compose.
- The **kernel layer** is *"a collection of all clusters in the grid"*: it orders
  collectives, marshals warp-specialized roles (producer/consumer warps), does
  grid swizzling, and tiles inputs with the cluster tile.

Assembly order matters: **epilogue first, then mainloop**, because the
mainloop's `StageCountAutoCarveout` needs
`sizeof(CollectiveEpilogue::SharedStorage)` to decide how many pipeline stages
fit in shared memory.

Headers: `include/cutlass/gemm/collective/collective_mma.hpp` (dispatches on a
`DispatchPolicy`), `include/cutlass/gemm/collective/collective_builder.hpp`,
`include/cutlass/gemm/collective/builders/` (30 files),
`include/cutlass/gemm/kernel/gemm_universal.hpp`,
`include/cutlass/gemm/device/gemm_universal_adapter.h`,
`include/cutlass/gemm/dispatch_policy.hpp` (all the `KernelSchedule*` tags),
`include/cutlass/epilogue/collective/builders/sm100_builder.inl`.

The builder signature (verbatim):

```cpp
template <class ArchTag, class OpClass,
          class ElementA, class GmemLayoutA, int AlignmentA,
          class ElementB, class GmemLayoutB, int AlignmentB,
          class ElementAccumulator,
          class TileShape_MNK, class ClusterShape_MNK,
          class StageCountType, class KernelScheduleType, class Enable = void>
struct CollectiveBuilder { static_assert(sizeof(ElementA) == 0,
    "Could not build a collective for given parameters."); };
```

> **Stale doc warning**: `gemm_api_3x.md` still closes its builder section with
> *"with 3.0, only SM90 tensorop kernels are supported through the builder API"*.
> That has not been updated for Blackwell and is wrong as of 4.8.

### 5.3 Configuring a block-scaled GEMM

Primary doc: **`media/docs/cpp/blackwell_functionality.md`**. Its section
`## Building a Block Scaled Kernel` and `### Scale Factor Layouts` are the
relevant ones. Companion: `media/docs/cpp/quickstart.md` §"Instantiating a
Blackwell SM100 GEMM kernel".

**The math the kernel computes:** `D = C + (A × SFA)·(B × SFB)` applied along K,
i.e. `D_ij = C_ij + Σ_k (A_ik · SFA_{i,⌊k/SV⌋})(B_jk · SFB_{j,⌊k/SV⌋})` where
`SV` is the scale-factor vector size. An `M×K` A therefore carries an
`M×⌈K/SV⌉` scale tensor. Dense: `SV` is 16 (NVFP4) or 32 (MX). Sparse doubles it
to 32 / 64, because 2:4 sparsity already compresses K by 2.

**Element types** — `include/cutlass/float_subbyte.h` (`float_e2m1_t`,
`float_e2m3_t`, `float_e3m2_t`, `float_ue4m3_t`, `float_ue8m0_t`),
`include/cutlass/float8.h` (`float_e4m3_t`, `float_e5m2_t`),
`include/cutlass/exmy_base.h` (the generic exponent/mantissa base template).
Only `float_ue8m0_t` and `float_ue4m3_t` are legal scale-factor types.

**Config wrappers** — these are trait bundles, not storage types; they exist to
be handed to the builder, which unpacks them:

```cpp
// include/cutlass/float_subbyte.h  /  float8.h
template <class F8Type> struct mx_float8_t { using ScaleFactorType = float_ue8m0_t; using DataType = F8Type; };
template <class F6Type> struct mx_float6_t { using ScaleFactorType = float_ue8m0_t; using DataType = F6Type; };
template <class F4Type> struct mx_float4_t { using ScaleFactorType = float_ue8m0_t; using DataType = F4Type; };
template <class F4Type> struct nv_float4_t { using ScaleFactorType = float_ue4m3_t; using DataType = F4Type; };
```

with `type_erased_dynamic_{mx_float4_t, mx_float6_t, mx_float8_t, nv_float4_t}`
for runtime datatype selection (SM100 only — **SM120/GeForce does not support
dynamic datatypes**).

`SFVecSize` is derived, not spelled — `include/cutlass/gemm/collective/builders/sm1xx_common.inl`:

```cpp
template <class BuilderScheduleTag, class T>
struct blockscaled_type<BuilderScheduleTag, nv_float4_t<T>> {
  using sf_type = cutlass::float_ue4m3_t;
  using data_type = T;
  static constexpr uint32_t SfVectorSize = /* sparse? */ 32 : 16;
};
```

(the `mx_*` specializations are the same shape with `ue8m0` and 64/32). Escape
hatches: `cute::tuple<T,SF>` infers the size from the schedule tag,
`cute::tuple<T,SF,cute::Int<N>>` overrides it.

**Opclass tags** — `include/cutlass/arch/mma.h`: `OpClassTensorOp`,
`OpClassSparseTensorOp`, **`OpClassBlockScaledTensorOp`**,
**`OpClassBlockScaledSparseTensorOp`**. Both the mainloop *and* the epilogue
builder take the same tag.

**Builder specializations** in `include/cutlass/gemm/collective/builders/`:
`sm100_blockscaled_umma_builder.inl` (the main one),
`sm100_blockscaled_sparse_umma_builder.inl`,
`sm100_blockscaled_mixed_tma_cpasync_umma_builder.inl` (MoE: TMA for A,
`cp.async` for B), `sm103_blockscaled_umma_builder.inl`,
`sm120_blockscaled_mma_builder.inl`, `sm120_blockscaled_sparse_mma_builder.inl`.
Matching collectives in `include/cutlass/gemm/collective/`:
`sm100_blockscaled_mma_warpspecialized.hpp`, `sm103_blockscaled_mma_warpspecialized.hpp`,
`sm120_blockscaled_mma_tma.hpp`, and their array/sparse siblings.

**The seven tcgen05 instruction kinds** as CUTLASS enumerates them
(`blackwell_functionality.md`): `kind::tf32`, `kind::f16`, `kind::i8`,
`kind::f8f6f4`, `kind::mxf8f6f4.block_scale`, `kind::mxf4.block_scale`,
`kind::mxf4nvf4.block_scale.scale_vec_size::[2X|4X]`. Only the last two hit the
4×-Hopper-FP8 rate and they are **TN-only**; `mxf8f6f4` allows TN/NT/TT/NN.

**Skeleton** (from the doc, shape verbatim):

```cpp
using CollectiveMainloop = typename cutlass::gemm::collective::CollectiveBuilder<
    cutlass::arch::Sm100, cutlass::arch::OpClassBlockScaledTensorOp,
    ElementA, GmemLayoutA, AlignA,      // e.g. nv_float4_t<float_e2m1_t>, RowMajor, 32
    ElementB, GmemLayoutB, AlignB,
    float,                              // accumulator is ALWAYS float here
    MmaTileShape_MNK, ClusterShape_MNK, // e.g. Shape<_256,_256,_256>, Shape<_2,_4,_1>
    cutlass::gemm::collective::StageCountAutoCarveout<
        static_cast<int>(sizeof(typename CollectiveEpilogue::SharedStorage))>,
    KernelScheduleAuto                  // or KernelTmaWarpSpecialized2SmNvf4Sm100
  >::CollectiveOp;
```

Gotchas the doc calls out: `TileShape_MNK` here is the **MMA instruction tile**
(1SM or 2SM), not a CTA tile; alignments are in **elements**; a `2Sm` schedule
requires `ClusterShape_MNK` mode-0 to be a multiple of 2 and halves M for the
per-SM tile (MMA tile 256×256×128 + 2SM ⇒ per-SM 128×256×128).

**Scale-factor layout** — `include/cutlass/detail/sm100_blockscaled_layout.hpp`.
The atom is a 512-byte block of **128 M/N × 4 SF along K**, blocks arranged
K-major:

```cpp
template<int SFVecSize, UMMA::Major major = UMMA::Major::K>
struct Sm1xxBlockScaledBasicChunk {
  using Blk_MN = _128;  using Blk_SF = _4;
  using SfKMajorAtom  = Layout< Shape< Shape<_32,_4>, Shape<Int<SFVecSize>, _4>>,
                               Stride<Stride<_16,_4>, Stride<           _0, _1>>>;
  ...
};
```

**The stride-0 mode of extent `SFVecSize` is the broadcast of one scale over
`SFVecSize` contiguous K elements, expressed purely in layout algebra.** That is
the single best CuTe teaching moment in the whole block-scaled stack, and Unit 6
of the curriculum is built around it.

`Sm1xxBlockScaledConfig<SFVecSize>` builds the full layout with
`blocked_product(SfAtom{}, ...)` and exposes:

```cpp
using SfConfig = Sm1xxBlockScaledConfig<SFVecSize>;
auto layout_sfa = SfConfig::tile_atom_to_shape_SFA(make_shape(M,N,K,L));
auto layout_sfb = SfConfig::tile_atom_to_shape_SFB(make_shape(M,N,K,L));
auto tensor_sfa = make_tensor(aptr, layout_sfa);
auto val = tensor_sfa(make_coord(m,k,0));   // the SF governing A(m,k)
```

Note it returns a **`Layout`**, not a `Stride` — that asymmetry with the data
tensors surprises people. In practice the examples pull the type off the kernel:
`using LayoutSFA = typename Gemm::GemmKernel::CollectiveMainloop::LayoutSFA;`.

**Block-scaled output** is an epilogue fusion:
`cutlass::epilogue::fusion::LinCombBlockScaleFactor<SFDVectorSize, ElementD,
ElementCompute, ElementSFD, GmemLayoutSFD, ElementC>`
(`include/cutlass/epilogue/fusion/operations.hpp`, visitors in
`sm100_visitor_store_tma_warpspecialized.hpp`), passed as the last template
argument of the epilogue `CollectiveBuilder`. That is how the "NVFP4 in, NVFP4
out" examples generate their output scale tensor.

### 5.4 Where the FP4 / block-scaled examples are

Verified by listing the directories and reading each `.cu` header.

**`examples/72_blackwell_narrow_precision_gemm/` — SM100 dense, the canonical set**

- `72a_blackwell_nvfp4_bf16_gemm.cu` — A/B `nv_float4_t<float_e2m1_t>` (align 32),
  D/C `bfloat16_t`, `Sm100` + `OpClassBlockScaledTensorOp`, MMA tile
  `Shape<_256,_256,_256>`, cluster `Shape<_2,_4,_1>`, `KernelScheduleAuto`.
  **Start here.**
- `72b_blackwell_nvfp4_nvfp4_gemm.cu` — same inputs, NVFP4 *output* via
  `LinCombBlockScaleFactor` (`ElementD = float_e2m1_t`, `ElementSFD = float_ue8m0_t`).
- `72c_blackwell_mixed_mxfp8_bf16_gemm.cu` — A `mx_float8_t<float_e4m3_t>`,
  B `mx_float4_t<float_e2m1_t>` → BF16. (The filename and the CHANGELOG entry
  both describe the operands inaccurately; trust the source.)

**`examples/79_blackwell_geforce_gemm/` — SM120 (RTX 50-series) dense**

- `79a_blackwell_geforce_nvfp4_bf16_gemm.cu` — `arch::Sm120`,
  `OpClassBlockScaledTensorOp`, tile `Shape<_128,_128,_128>`, **cluster must be
  `_1,_1,_1`** (no TMA multicast on GeForce).
- `79b_blackwell_geforce_nvfp4_nvfp4_gemm.cu`
- `79c_blackwell_geforce_mixed_mxfp8_mxfp6_bf16_gemm.cu` —
  `mx_float8_t<e4m3>` × `mx_float6_t<e3m2>` → BF16.
- `79d_blackwell_geforce_nvfp4_grouped_gemm.cu`

79a's header comment is the clearest short statement of the SM100/SM120 split:
SM120 uses `mma.sync.aligned.block_scale` (warp-level), **not** `tcgen05.mma`;
no TMA multicast; no dynamic datatypes.

**Other relevant directories**

- `examples/70_blackwell_gemm/{70_blackwell_fp16_gemm.cu, 70_blackwell_fp8_gemm.cu}` — plain dense tcgen05 baseline.
- `examples/71_blackwell_gemm_with_collective_builder/71_blackwell_gemm_with_collective_builder.cu` — builder + EVT epilogue construction.
- `examples/80_blackwell_geforce_sparse_gemm/{80a_..._mxfp8_bf16_sparse_gemm.cu, 80b_..._nvfp4_nvfp4_sparse_gemm.cu}` — SM120 sparse block-scaled.
- `examples/83_blackwell_sparse_gemm/83_blackwell_sparse_gemm.cu` — SM100 sparse, **not** block-scaled.
- `examples/84_blackwell_narrow_precision_sparse_gemm/{84a_blackwell_nvfp4_bf16_sparse_gemm.cu, 84b_blackwell_mixed_mxfp8_bf16_sparse_gemm.cu}` — SM100 sparse block-scaled.
- `examples/81_blackwell_gemm_blockwise/` — blockwise/groupwise FP32 scalars. **Different thing** from block-*scaled*; do not confuse them in a curriculum.
- `examples/89_sm103_fp4_ultra_gemm/89_sm103_fp4_ultra_gemm.cu` and `examples/90_sm103_fp4_ultra_grouped_gemm/` — `arch::Sm103`, MMA tile K = 768.
- `examples/91_fp4_gemv/91_fp4_gemv.cu` — FP4 GEMV.
- `examples/92_blackwell_moe_gemm/` — 6 files incl. `92_blackwell_moe_gemm_fp4_grouped.cu`, which uses TMA for A + `cp.async` for B to avoid TMA-descriptor churn as MoE expert token counts vary.
- `examples/86_blackwell_mixed_dtype_gemm/`, `examples/87_blackwell_geforce_gemm_blockwise/`.

> **`examples/README.md` is stale** — its list stops at example 84. Descriptions
> for 86–95 must come from the `.cu` file headers.

### 5.5 Versions, and the CuTe Python DSL

- **CUTLASS 3.8.0 (2025-01-25)** introduced Blackwell SM100: tcgen05 MMA atoms
  (`include/cute/atom/mma_traits_sm100.hpp`), **`tmem` as a first-class CuTe
  locale** (`include/cute/pointer.hpp`) with tmem↔rmem/smem copy atoms and
  `make_tmem_copy()`, the NVFP4/MXFP4/MXFP6/MXFP8 types, SM100 pipelines,
  cluster launch control, the block-scaled collectives, `blackwell_functionality.md`,
  and examples 70–78 including 72a/b/c.
- **3.9.0 (2025-04-24)** added SM120 (GeForce) block-scaled dense + sparse and
  examples 79a–d, 80a/b, 83, 84a/b.
- **4.0.0 (2025-06-03)** introduced the **CuTe Python DSL** (`python/CuTeDSL/`).
- **4.8.0 (2026-08-25)** adds Rubin/SM107 (TMEM 512→576 columns, 328 KB smem)
  and `examples/cute/rubin/rubin_fp4_blockscaled.cu`.

For teaching, the DSL is the better on-ramp to the layout algebra — the algebra
is identical to C++ but you get `print` output without compiling:

- `examples/python/CuTeDSL/cute/notebooks/` — `cute_layout_algebra.ipynb`,
  `composed_layout.ipynb`, `tensor.ipynb`, `data_types.ipynb`, `print.ipynb`,
  `async_pipeline.ipynb`, `tour_to_sol_gemm.ipynb`.
- `examples/python/CuTeDSL/cute/blackwell/tutorial/tutorial_gemm/` — a graded
  ladder `fp16_gemm_0.py` … `fp16_gemm_6.py`, then **`nvfp4_gemm_0.py`,
  `nvfp4_gemm_1.py`**.
- `examples/python/CuTeDSL/cute/blackwell/kernel/blockscaled_gemm/dense_blockscaled_gemm_persistent.py`
  and the GeForce equivalents under `cute/blackwell_geforce/`.
- `python/CuTeDSL/cutlass/utils/blackwell_helpers.py` holds the DSL analogue of
  `Sm1xxBlockScaledConfig`.

> The 4.0.0 CHANGELOG's example paths (`examples/python/CuTeDSL/blackwell/...`)
> are now wrong — the tree was reorganized. Use the paths above.

---

## 6. What a curriculum should teach, in dependency order

Six units. Each one delivers exactly one idea and cannot be reordered — each
unit's exercise is impossible without the previous unit's idea.

### Unit 1 — A float format is a sampling of the reals

**The idea.** Exponent bits buy binades (dynamic range); mantissa bits buy
resolution *within* a binade. Every low-precision format is a different point on
that trade, and "how much precision" is meaningless without asking "at what
magnitude". Subnormals, saturation and the absence of Inf/NaN are design choices
with consequences, not trivia.

**Exercise.** Write, in pure Python with no numeric libraries, an
encode/decode pair for E4M3, E5M2, E3M2, E2M3 and E2M1 — handling subnormals,
sign symmetry, round-to-nearest-even and saturating downcast. Verify:
(a) your E2M1 decoder reproduces all 16 values in the table in §1.2 exactly;
(b) round-tripping every one of the 256 E4M3 bit patterns through `ml_dtypes`
or `torch.float8_e4m3fn` agrees bit for bit; (c) your saturating cast maps
`+inf → 6.0` and `nan → 6.0` for E2M1, matching ONNX. Then plot the representable
values of E2M1 and E4M3 on a log axis and *look* at the gaps.

### Unit 2 — A tensor does not fit a format; a scale makes it fit, badly

**The idea.** Quantization error is set by the mismatch between the *tensor's*
dynamic range and the *format's*. A single per-tensor scale can only align the
maximum; everything far below the maximum loses bits, and everything below the
format's min subnormal times the scale becomes exactly zero. Outliers make this
catastrophic. This is *why* block scaling had to be invented, and a student who
skips this unit will treat block scaling as an arbitrary complication.

**Exercise.** Dump the weights, activations and gradients of a small trained
transformer (GPT-2 small via HF is fine — one forward + backward on a batch of
real text). For each tensor: compute the per-tensor amax scale into E4M3 and
into E2M1, then measure signal-to-quantization-noise ratio and the fraction of
values flushed to zero. Plot per-channel amax and find the outlier channels.
Expected finding to argue about in writing: activations are far worse than
weights, and one or two channels dominate.

### Unit 3 — Shrink the scale's scope: MX and NVFP4

**The idea.** Block scaling replaces global dynamic range with *local* dynamic
range: a 32- or 16-element neighbourhood is far more homogeneous than a whole
tensor. But the scale's own format then matters, because the scale must land the
block amax on the element format's max — and a power-of-two-only scale (E8M0)
usually cannot. That is precisely why NVFP4 spends 3 mantissa bits on the scale
and pays for the resulting narrow scale range with a second, per-tensor level.

**Exercise.** Implement two quantizers on top of Unit 1's codec:
(a) MXFP4 — blocks of 32, UE8M0 scale rounded *up*;
(b) NVFP4 — blocks of 16, UE4M3 scale, plus the per-tensor FP32 `s_enc = 6·448/amax`,
following the NVFP4 paper's Appendix B equations exactly, including the
`s_enc,b = 1/(fp32(s_dec,b,e4m3)·s_dec)` re-inversion step.
Then: reproduce the paper's `amax = 3+δ` argument numerically (show ±4 and ±6 are
unreachable under MXFP4 for that block); compare SQNR of both on the Unit 2
tensors; and deliberately *break* the re-inversion step in (b) and measure how
much accuracy it costs — the paper claims it matters, make the student check.
Cross-validate against `torchao`'s or Transformer Engine's reference NVFP4
quantizer.

### Unit 4 — Two orthogonal fixes: unbiased rounding, and benign distributions

**The idea.** Block scaling reduces error but leaves two problems. (1) The
rounding operator is *biased*: round-to-nearest systematically loses small
updates when they fall below half a ULP, and over 10¹² accumulation steps the
loss is systematic, not random. Stochastic rounding makes the operator unbiased
so errors cancel like a random walk instead of accumulating. (2) The
*distribution* is bad: a single outlier in a block forces a large scale and
crushes the other 15 values. A random orthogonal rotation spreads the outlier's
mass across coordinates, and Hadamard is the rotation you can afford because the
fast Walsh–Hadamard transform costs O(n log n) additions and no multiplies.
Crucially, `A·H·(B^T·H)^T = A·B` exactly, so the rotation is free of
mathematical consequence — only of numerical consequence.

**Exercise.** (a) Add stochastic rounding to Unit 1's E2M1 and BF16 casts —
implement it the way hardware does, by adding random bits to the discarded
mantissa bits and truncating. Sum 10⁶ small values into a low-precision
accumulator with RTNE and with SR; plot error vs `n` on log axes and identify the
`O(n)` vs `O(√n)` slopes. Demonstrate stagnation explicitly: an accumulator that
never moves under RTNE and does move under SR.
(b) Implement a 16×16 fast Walsh–Hadamard transform with a random ±1 diagonal.
Apply it to the Unit 2 gradient tensors before NVFP4 quantization; measure the
change in per-block `amax/RMS` and in SQNR. Verify `H Hᵀ = I` numerically, and
verify that a *fixed* (non-randomized) Hadamard has adversarial inputs where it
makes things worse.

### Unit 5 — The hardware contract: what the tensor core will actually accept

**The idea.** The format is only half the story. The MMA instruction fixes the
block size, the scale type, the operand layouts, the tile shapes, and *where the
scale factors must physically live*. Blackwell's tcgen05 moves the accumulator
out of registers into Tensor Memory and moves MMA issue from a warpgroup to a
single thread — that is what makes block-scaled 4-bit math fast, and it is why a
"software format" that doesn't match the table in §2.5 gets no speedup at all.

**Exercise.** Read the PTX ISA sections on `tcgen05.mma`, `tcgen05.alloc/ld/st`
and the scale-factor layouts, and answer in writing: which `.kind` do you need
for NVFP4; what `.scale_vectorsize`; where do SFA/SFB live and how are they laid
out in TMEM; what does the 2-SM mode require of the cluster shape. Then write
(or annotate a provided) minimal CUDA kernel that allocates TMEM, issues one
block-scaled MMA and reads the accumulator back; compile for the right target
and confirm with `cuobjdump -sass` that a tcgen05 instruction was actually
emitted. Without a datacentre Blackwell, compile-only + SASS inspection is a
legitimate deliverable — and the same exercise on `sm_120` using the `mma.sync`
block-scaled path on a consumer 50-series card is the interesting contrast.

### Unit 6 — Making it a real GEMM: CuTe layouts and the collective mainloop

**The idea.** CuTe's layout algebra is a compositional language for "which value
goes where", and a `Layout` is literally a function from logical coordinate to
offset. Once you can read layouts, a block-scaled GEMM stops being magic: the
scale-factor tensor's layout is an ordinary CuTe layout with a stride-0 mode of
extent `SFVecSize` — that stride-0 mode *is* the broadcast of one scale over 16
or 32 elements, expressed in the algebra. And the "collective mainloop" is the
reusable, warp-specialized, pipelined loop you configure with tags rather than
write by hand.

**Exercise.** In three parts.
(a) Layout algebra drills in the CuTe DSL notebooks (`cute_layout_algebra.ipynb`,
`tensor.ipynb`) — compose, complement, `logical_divide`, `local_tile`,
`local_partition`, and a TV layout. Then, on paper and then in code, derive the
scale-factor atom `Sm1xxBlockScaledBasicChunk` yourself and assert it equals
`Sm1xxBlockScaledConfig<16>::tile_atom_to_shape_SFA(...)` for a real problem shape.
(b) Build and run `examples/72_blackwell_narrow_precision_gemm/72a_blackwell_nvfp4_bf16_gemm.cu`
(or `79a` on a GeForce card), then *change* it: swap `nv_float4_t<float_e2m1_t>`
for `mx_float8_t<float_e4m3_t>`, change the MMA tile and cluster shape, switch
`KernelScheduleAuto` to an explicit `KernelTmaWarpSpecialized2SmNvf4Sm100`, and
benchmark each variant. Explain every compile error you hit — most of them are
the constraint table from Unit 5 being enforced at compile time.
(c) **Capstone**: train a small language model end to end in NVFP4 using
Transformer Engine, and run the paper's own ablation — remove stochastic
rounding, remove the Hadamard transform, remove 2D weight scaling, quantize the
last blocks too — and reproduce, at small scale, the ordering of the damage each
one causes.

**Where each unit's prerequisite lies:** 1→2 (you cannot measure scaling error
without a codec), 2→3 (block scaling only makes sense as an answer to per-tensor
failure), 3→4 (SR and RHT are corrections to a *specific* quantizer), 4→5 (the
hardware table only means something once you know what the numbers are for),
5→6 (CUTLASS is a configuration layer over the instruction).

---

## Unverified, uncertain, or contested

Read this before teaching anything above. Grouped by how much it would hurt to be
wrong.

### Would poison the curriculum if wrong

1. **The OCP MX v1.0 spec PDF itself was never read.** `opencompute.org` is
   behind a Cloudflare JS challenge. Every MX number in §1 and §2 is corroborated
   from two independent OCP-conformant secondary sources (ONNX's `float4.md` /
   `float6.md`, and Microsoft's `microxcaling` reference implementation) plus my
   own derivation, and all three agree. But **someone should open the actual PDF
   and re-check the FP6 and E8M0 rows before this is taught.**
2. **`sm_120` having no TMEM is an inference, not a quotation.** No NVIDIA
   sentence says it. See §4.8 for the three-step argument. Very strong, still an
   inference.
3. **TF32's min subnormal (`2⁻¹³⁶` in my table) is my own derivation**, not a
   quoted figure — and I could not confirm that Ampere/Hopper/Blackwell tensor
   cores handle TF32 subnormals at all rather than flushing them. TF32 is an
   internal tensor-core input mode, not a storage format, so "subnormal" may not
   be a meaningful question for it. **Treat that one cell as unverified.**

### Numbers I could not source

4. **B100 and B40 compute capability.** Absent from NVIDIA's own GPU table. Only
   GB200 and B200 are listed at CC 10.0. B100 = 10.0 is widely reported (same
   GB100 silicon) but has no NVIDIA primary source I could find.
5. **TMEM geometry on `sm_103` / `sm_110`.** PTX states 512×128×32-bit only for
   `sm_100a`/`sm_100f` and never restates it for the others. CUTLASS 4.8's
   changelog says Rubin/SM107 extends TMEM from 512 to 576 columns, which implies
   the number *is* per-architecture, so do not assume 256 KB everywhere.
6. **The CUDA Programming Guide's "Throughput of Native Arithmetic Instructions"
   per-CC table** appears to have been removed in the guide's 2026 restructure.
   All absolute throughput figures in §4.5 therefore come from whitepapers and
   blogs, not the Programming Guide.
7. **The CUTLASS `tcgen05_programming` docs page** on docs.nvidia.com renders
   empty (JS-only) and has no markdown counterpart in the GitHub `main` tree. All
   tcgen05 semantics above come from the PTX ISA directly.
8. **The NVFP4 paper gives no runtime cost figure for the Random Hadamard
   Transform.** It says explicitly that it is about algorithms, not runtime. The
   percentages quoted in §3.2 (9.7% / 1.6% / <5% / ≤7%) come from the MXFP4 paper
   and QuaRot, on *different* hardware and different configurations. **Do not
   attribute them to NVFP4.**

### Genuinely contested in the literature

9. **Whether randomized Hadamard beats deterministic Hadamard.**
   [arXiv 2605.09825](https://arxiv.org/abs/2605.09825) reports that SR and
   *randomized* Hadamard both **fail to converge** once Wgrad is quantized in
   MXFP4, and that *deterministic* Hadamard is what stabilizes training. This
   directly contradicts NVIDIA (2509.25149), Tseng et al. (2502.20586) and
   Quartet (2505.14669). I read 2605.09825 only via a summarizing fetch, not a
   full manual read. **Present this as open, not settled.** NVIDIA's own finding
   that randomization "has no impact at small scales" and that SR *in isolation*
   eventually diverges is not far from the negative result, so scale and format
   may explain the divergence.
10. **"HQ" / "Hadamard-Quantized".** I could not find a paper that defines that
    acronym in this literature. The nearest things are Quartet (fixed Hadamard
    forward, randomized backward), HALO ("Hadamard-Assisted Lower-Precision
    Optimization", 2025), and QuIP# . If a specific paper was meant, get the
    citation before asserting anything about it.

### Citation corrections worth propagating

11. **Connolly, Higham & Mary's SR paper has no arXiv version.** It is SIAM
    J. Sci. Comput. 43(1) (2021) A566–A585 / MIMS EPrint 2020.12.
12. **The SR-and-gradient-descent papers are Xia, Anthonissen, Hochstenbach &
    Koren** ([arXiv 2202.12276](https://arxiv.org/abs/2202.12276)), not
    "Xia & Anzt" — Hartwig Anzt works on a different problem.
13. **Fishman et al., "Scaling FP8 training to trillion-token LLMs"
    ([2409.12517](https://arxiv.org/abs/2409.12517)) uses no stochastic
    rounding.** Its contribution is Smooth-SwiGLU. Frequently miscited.
14. **Wang et al., Microsoft FP4 ([2501.17116](https://arxiv.org/abs/2501.17116))
    uses neither SR nor Hadamard rotations.** It uses a differentiable
    quantization estimator and outlier clamping/compensation. Also frequently
    miscited.
15. **The `O(√(log n / n))` incoherence bound is the *vector* form.** QuIP#'s
    two-sided *weight* bound is `μ_W = 2 log(4mn/δ)` — **O(log n)**, not
    O(√log n).
16. **CUTLASS's `examples/README.md` is stale** (stops at example 84), and
    `gemm_api_3x.md` still claims "only SM90 tensorop kernels are supported
    through the builder API", which is wrong as of 4.8. The 4.0.0 CHANGELOG's
    CuTe DSL example paths are also wrong after a tree reorganization.
17. **CUTLASS example 72c's filename is misleading**
    (`72c_blackwell_mixed_mxfp8_bf16_gemm.cu` is actually MXFP8 × MXFP4). Trust
    the source, not the filename or the CHANGELOG.

### Lower-confidence secondary claims

18. *Massive Activations* (2402.17762) numbers (100,000×, near-constant) come
    from the abstract only.
19. **SpinQuant's** Cayley/Stiefel optimization mechanics — abstract only.
20. **QuIP# Lemma 3.1** was quoted via a fetch, not manually re-derived.
21. An early fetch of a secondary blog reported FP8 E4M3 bias as 8 and E5M2 as 16.
    **That is wrong** — the primary paper's Table 1 says **7 and 15**. Mentioned
    only because the incorrect numbers are circulating.
