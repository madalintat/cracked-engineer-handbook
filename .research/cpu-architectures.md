# CPU Architectures and Microarchitecture — Curriculum Research

Audience: a strong SWE who has just learned to read and write x86-64 assembly (see `x86-64-assembly.md`) and now needs the map underneath it — what CPUs exist, how they differ, and which of those differences change the code they write.

Target end state: **can look at an unfamiliar CPU's spec sheet and predict how their code will behave on it; can name the three or four hardware facts that dominate a program's performance; and knows why a concurrent program that passes every test on x86 may be broken on ARM.**

Research date: **September 2026.** Anything about parts announced but not shipping is flagged inline.

Backend for exercises: **Compiler Explorer** (<https://godbolt.org>). Its API compiles *and executes* x86-64, and cross-compiles to AArch64, ARM32, RISC-V, POWER and ~20 other targets (assembly output only — cross targets report `supportsExecute: false`). Every assembly listing in this document was **compiled live against that API during this research**, with the exact compiler IDs and flags given inline. See §4.2 for the verified backend notes.

### How to read this document

- **§1** is the ISA landscape: what instruction sets exist and what is in them. Reference material; skim it, come back to it.
- **§2** is microarchitecture — the pipeline, caches, coherence, and memory ordering. **This is the section that explains performance**, and §2.8 (memory ordering) is the single highest-value thing in the document.
- **§3** is real shipping families with real numbers, so the abstractions in §2 have names attached.
- **§4** ranks what actually matters and gives eight machine-checkable exercises.

### Conventions and caveats

- **Latencies are given in cycles where the quantity is a fixed pipeline property, and in nanoseconds where it is not.** DRAM latency is ~70–90 ns on every current part; expressed in cycles that is 210 cycles on a 3 GHz server core and 400 on a 5.7 GHz desktop core. Quoting "DRAM is 300 cycles" without a clock is the most common error in this material.
- Microarchitectural internals (ROB sizes, BTB entries, mispredict penalties) are **almost never published by the vendor**. Nearly every such number below comes from *measurement* — Chips and Cheese, 7-cpu.com, uops.info, Agner Fog, Dougall Johnson. Treat them as accurate to within a few percent and specific to the part measured, not as datasheet values.
- Where a claim could not be verified against a primary or reputable secondary source, it is marked **[unverified]**.

---

## 1. The ISA landscape

An **ISA** (instruction set architecture) is the contract between software and silicon: the instructions, the registers, the addressing modes, the memory model. A **microarchitecture** is one particular implementation of that contract. Zen 5 and Golden Cove implement the *same* ISA and are completely different machines; that separation is the single most useful idea in this document.

### 1.1 x86-64

#### History

| Date | What |
|---|---|
| **8 June 1978** | **8086** — 16-bit, segmented memory, 8 registers. Everything after is backward-compatible with this. |
| Feb 1982 | 80286 — protected mode, ~134K transistors |
| Oct 1985 (samples) / **June 1986** (production) | **80386** — 32-bit, flat memory via paging. This is **IA-32**, and it is what "x86" meant for 18 years. Chief architect **John H. Crawford**. |
| Nov 1995 | **Pentium Pro (P6)** — out-of-order, and the first x86 to decode into micro-ops |
| **Oct 1999** | **Fred Weber** announces AMD's 64-bit extension at Microprocessor Forum, under the deliberately bland title *"An Athlon-Family Processor for Workstations and Servers."* |
| **4 Sept 2000** | *Microprocessor Report*: **"AMD Drops 64-Bit Hammer on x86."** The programmer's overview is public. AMD expects silicon "at the end of 2001". |
| **29 May 2001** | Intel ships **Itanium / IA-64** — a *radically different* VLIW/EPIC architecture, binary-incompatible with IA-32. |
| **22 April 2003** | AMD ships the **Opteron**. (An ~18-month slip from AMD's own projection — worth noting against the tidy "Intel was late, AMD was on time" narrative.) |
| 23 Sept 2003 | Athlon 64 — "the first 64-bit processor targeted at the average consumer" |
| Oct 2003 | Intel ships Prescott with **disabled, non-AMD64-compatible** 64-bit extensions |
| **17 Feb 2004** | Intel concedes at IDF, framing it as *"memory extension technology"* and leaving "number crunching to Itanium". Named **EM64T** in March, **Intel 64** in late 2006. |
| **7 April 2004** | MPR's Tom Halfhill, after comparing the documentation: *"In every case, we found Intel had patterned its 64-bit x86 architecture after AMD64 in almost every detail."* |

The architect of AMD64 was **Kevin J. McGrath**, who had come to AMD via NexGen and led microcode for the K6 and K7 before designing the 64-bit extensions; he presented them at Stanford's EE380 colloquium in September 2000 and is a named author of the definitive Opteron paper (*IEEE Micro*, March–April 2003). **Fred Weber** ran AMD's CPU engineering and made the announcement. (Dirk Meyer is often miscredited — his documented work is DEC's Alpha and leading the K7 team, not the 64-bit extensions.)

**Why AMD64 won and IA-64 lost** is the most instructive story in ISA design. Itanium was technically ambitious: it moved instruction scheduling from hardware to the compiler (EPIC), betting that a sufficiently smart compiler could extract more parallelism than an out-of-order core. It failed on four fronts:

1. **The compiler bet never paid.** Static scheduling cannot know which loads will miss cache; out-of-order hardware finds out at runtime. The expected EPIC compiler breakthroughs simply never arrived.
2. **It could not run x86 well.** Itanium carried a *second* hardware decoder for IA-32, selected by a mode bit. It was notoriously slow; Intel replaced it with a software IA-32 Execution Layer, and then **dropped x86 hardware emulation entirely at Montecito in 2006.** *(The often-repeated "ran like a Pentium-100" figure could not be verified — don't print a number.)*
3. **It was chronically late.** Merced targeted 1997/98 and shipped in **May 2001**. Within hours of the name "Itanium" being announced in October 1999, Usenet had coined **"Itanic."**
4. **Volume never came.** In 2007 Gartner counted roughly **55,000 Itanium servers against 8.4 million x86 servers**; IDC put total Itanium systems from 2001–2007 at 184,000. HP was ~95% of Itanium revenue by 2008 — and court documents in *HP v. Oracle* revealed **HP paid Intel $440M to keep producing Itanium through 2014, then $250M more to manufacture through 2017.** By the end, Itanium existed because a customer was paying Intel to keep making it. Microsoft announced its exit in April 2010; the last Itanium shipped 29 July 2021.

AMD64's proposition was the opposite and much duller: keep every 32-bit binary running at full speed, add a 64-bit mode, double the registers — and, per AMD's own estimate at the time, spend **"5% or less" of additional die area** doing it. Compatibility beat elegance, and Intel had to adopt its competitor's ISA.

**The irony to hand a class:** John Crawford, architect of the 386 — the chip that made 32-bit x86 the world's default — later led Intel's side of the joint HP/Intel team building IA-64 to replace it.

**What AMD64 added over IA-32:**

- **16 general-purpose registers** instead of 8 (RAX…RDI, R8–R15), and 16 XMM registers instead of 8. Doubling the register file is the biggest single performance change; IA-32's 8 registers forced constant stack spilling. Why exactly 16, in AMD's own words at the time: code traces showed the first 8 extra registers produced "the lion's share of performance benefit", and going beyond 16 "would provide diminishing returns at the cost of significant additional complexity". (For contrast, MPR noted IA-64 specified **128** integer and 128 FP registers, and MIPS/PowerPC/Alpha all had 32.)
- **It quietly killed the x87 stack.** AMD64 mandates SSE2, whose XMM registers are a **flat register file**, in place of x87's awkward 8-deep stack. Every x86-64 compiler emits SSE for floating point and the SysV ABI passes floats in XMM. x87 survives only for 80-bit `long double`.
- **The REX prefix** (`0100WRXB`, bytes `0x40`–`0x4F`) — one byte carrying the 64-bit operand-size flag (W) and the extra register-number bits (R extends ModRM.reg, X extends SIB.index, B extends ModRM.rm/SIB.base). It sits after the legacy prefixes, immediately before the opcode, and `REX.W` overrides the `66h` operand-size prefix. Two consequences the SDM spells out and learners hit: **some `INC`/`DEC` register forms are no longer encodable in 64-bit mode** because their one-byte opcodes were reassigned as REX prefixes (so they cost 2 bytes now), and **an instruction cannot reference a legacy high byte (`AH`,`BH`,`CH`,`DH`) and one of the new byte registers at once** — the presence of a REX prefix reinterprets those encodings as `SPL`/`BPL`/`SIL`/`DIL`. In 64-bit mode the default address size is 64 bits, the default *operand* size is still 32, and 16-bit addressing is gone entirely.
- **RIP-relative addressing** — address data relative to the instruction pointer. IA-32 had no equivalent, so position-independent code needed the `call/pop` trick to discover its own address. RIP-relative is why modern x86-64 assembly is full of `[rip + label]` and why PIE executables are nearly free.
- **The NX bit** — mark pages non-executable. The foundation of W^X and every modern exploit mitigation.

#### CISC decoded to RISC micro-ops

The mental model most people carry — "x86 is CISC, ARM is RISC, CISC is slow" — has been wrong since **1995**, when the Pentium Pro (P6) introduced micro-op decoding. Every x86 core since works like this:

1. The **decoders** translate each x86 instruction into one or more internal **micro-ops** (µops) with a fixed, regular, RISC-like format: three operands, one operation, register-register only.
2. Everything downstream — rename, schedule, execute, retire — sees only µops. **The out-of-order engine of a modern x86 core is a RISC machine.**
3. Complex instructions that expand to many µops are handled by a **microcode ROM** (MSROM) rather than the fast decoders. `rep movsb`, `cpuid`, far calls and gather instructions all take this slow path. Intel's own P6 manual is refreshingly plain about what microcode is: *"This microcode is just a set of preprogrammed sequences of normal µops."*

The P6's decoder is the origin of a rule that still shapes compiler output. It had three decoders — **D0, D1, D2** — where only D0 could handle complex instructions (up to 4 µops), while D1 and D2 took one-µop instructions of at most 8 bytes. Instructions arriving in a **4-1-1** pattern hit peak throughput (6 µops/clock); a **2-2-2** pattern collapsed to 2 µops/clock, because every 2-µop instruction had to queue for D0. Thirty years later, Intel P-cores still have one "complex" decoder and several simple ones.

Concretely, measured on uops.info: `add rax, rbx` is 1 µop everywhere. `add rax, [mem]` is 1 fused / 2 unfused on Intel, **1 µop on Zen**. `add [mem], rax` is **2 fused / 4 unfused on Intel** (load, add, store-address, store-data) and **1 µop on Zen 2/Zen 3**.

That Intel-vs-AMD gap is largely a **bookkeeping convention**, and saying so is worth a minute of a learner's time. Agner Fog on the AMD design: *"Even read-modify and read-modify-write instructions generate only one macro-operation which is split into micro-operations only in the execute stage… The AMD design has no strict limitation to the number of input dependencies on a single macro-operation"*, whereas on Intel *"a micro-operation can have no more than two input dependencies, including the condition flags."* Both machines do the same four things; they count them differently. So "one x86 instruction does more than one ARM instruction" is a fact about *encoding density*, not about work per cycle — and even the µop counts you read are partly a naming choice.

Two optimisations that push back the other way:

- **Micro-op fusion** — a load and its consuming ALU op are kept as one µop through the front end and split only at execution, so they consume one ROB slot instead of two.
- **Macro-op fusion** — a `cmp`/`test` immediately followed by a conditional jump is fused by the *decoder* into a single compare-and-branch µop. This is the reason a C `for` loop's bounds check is often genuinely free, and it is a good thing to point a learner at in real compiler output. It has grown steadily: Core 2 could fuse `cmp`/`test` but **only in 32/16-bit mode**; Nehalem made it work in 64-bit mode and added signed branches; Sandy Bridge added `add`/`sub`/`inc`/`dec` but fused only **one pair per cycle**; Skylake does **two pairs per cycle** across all four decoders. It is also not universal — `adc`/`sbb`, `or`/`xor`, and shifts fuse with nothing on Intel (AMD *does* fuse `or` and `xor`), and Agner notes fusion can even *reduce* decode throughput on Sandy Bridge, because a fusable ALU op landing in the last decoder is postponed a cycle to check whether a branch follows.

  **Redwood Cove (2023) added something genuinely new**: `MOV`+`OP` and `LOAD`+`OP` fusion, out of the µop cache only. `mov rax, rbx` followed by `sub rax, rcx` fuses into one µop computing `rax = rbx - rcx` — **a non-destructive three-operand form that x86 cannot even encode.** Intel's own footnote on the load case concedes that "only `sub reg, [mem]` is encodable within the x86 instruction set." The hardware is quietly implementing the ISA it wishes it had, which is also exactly what APX proposes to do openly.

**The tension worth teaching: RIP-relative addressing defeats fusion.** A RIP-relative operand with an immediate does not micro-fuse (Intel's manual advises compilers to reach global data another way), and it **blocks macro-fusion entirely** — Agner's example is `cmp eax,[mem]` + `jg L5`, which fuses in 32-bit mode and does *not* in 64-bit mode, because the assembler emits a RIP-relative operand. It also disqualifies a load from Redwood Cove's LOAD+OP fusion. **The feature added to make position-independent code cheap is the feature that makes fusion impossible.** Very few architectural additions are free.

So: **x86's CISC-ness is confined to the front end.** It costs decode width (which is why x86 needed µop caches and clustered decode while ARM did not) and it costs power. It does not cost execution throughput.

#### The SIMD lineage

| Extension | Year | Width | Registers | What it added |
|---|---|---|---|---|
| **MMX** | 1997 | 64-bit | MM0–MM7 (aliased onto the **x87 FP stack** — a design mistake; you could not use MMX and x87 in the same function without `emms`) | packed integers only |
| 3DNow! | 1998 | 64-bit | AMD-only | packed single-precision float; dead |
| **SSE** | 1999 (Pentium III) | 128-bit | **XMM0–7**, own register file | packed single-precision float |
| **SSE2** | 2001 (Pentium 4) | 128-bit | XMM | packed double + all integer types. **This is the x86-64 baseline** — every x86-64 CPU has SSE2, which is why the SysV ABI passes floats in XMM and compilers never emit x87. |
| SSE3 / SSSE3 | 2004 / 2006 | 128-bit | XMM | horizontal ops; shuffles (`pshufb`) |
| SSE4.1 / 4.2 | 2007 / 2008 | 128-bit | XMM | blends, dot product, `popcnt`, string compare |
| **AVX** | 2011 (Sandy Bridge) | **256-bit** | **YMM0–15** | VEX encoding, **3-operand non-destructive** form (`c = a + b` instead of `a += b`), float only |
| **AVX2** + **FMA3** | 2013 (Haswell) | 256-bit | YMM | integer ops at 256-bit, gather, and fused multiply-add — the single biggest FP throughput jump in the series |
| **AVX-512** | 2016 (Knights Landing) / 2017 (Skylake-SP) | **512-bit** | **ZMM0–31** (32 registers) + **8 mask registers k0–k7** | EVEX encoding, per-lane predication via masks, embedded broadcast and rounding |
| **AVX10** | 2023 spec; silicon 2027 | 512-bit | ZMM | a *versioned* consolidation of AVX-512 |
| **APX** | 2023 spec; silicon 2027 | n/a | **32 GPRs** | see below |

AVX-512's real innovation is not the width — it is the **mask registers**. Every instruction can be predicated per lane, which makes it possible to vectorise loops with branches inside them without the mask-blend gymnastics SSE/AVX required. That idea is now everywhere: SVE's predicate registers and RVV's mask registers are the same idea.

#### AVX-512's fragmentation — the cautionary tale

AVX-512 is not one extension. It is **a foundation plus a dozen independently-implementable subsets**, and vendors shipped different combinations:

`F` (foundation), `CD` (conflict detection), `VL` (apply AVX-512 semantics at 128/256-bit), `DQ` (32/64-bit int), `BW` (8/16-bit int), `IFMA`, `VBMI`, `VBMI2`, `VNNI` (int8 dot products for inference), `BF16`, `FP16`, `BITALG`, `VPOPCNTDQ`, `VP2INTERSECT`, plus `ER`/`PF` (Knights Landing only) and `4VNNIW`/`4FMAPS` (Knights Mill only).

| Part | Year | Subsets |
|---|---|---|
| Knights Landing | 2016 | F, CD, ER, PF |
| Skylake-SP / Skylake-X | 2017 | F, CD, VL, DQ, BW |
| Cannon Lake | 2018 | + IFMA, VBMI |
| Cascade Lake | 2019 | + VNNI |
| Ice Lake | 2019 | + VBMI2, VPOPCNTDQ, BITALG, VPCLMULQDQ, GFNI, VAES |
| Cooper Lake | 2020 | + BF16 (but not the Ice Lake set) |
| Tiger Lake | 2020 | + VP2INTERSECT |
| Rocket Lake | 2021 | = Ice Lake |
| **Alder Lake** | 2021 | **present in P-core silicon, then fused off** |
| Sapphire Rapids | 2023 | + FP16, − VP2INTERSECT |
| **AMD Zen 4** | 2022 | F, CD, VL, DQ, BW, IFMA, VBMI, VBMI2, VNNI, VPOPCNTDQ, BITALG, BF16, GFNI, VAES, VPCLMULQDQ |
| **AMD Zen 5** | 2024 | Zen 4 + VP2INTERSECT |

Note the shape: **Cooper Lake and Ice Lake shipped in the same era with non-overlapping subsets.** A binary compiled for one would not run on the other. This is why runtime dispatch (`__builtin_cpu_supports`, GCC function multiversioning) is not optional on x86 if you want to use AVX-512 at all.

Two more scars:

- **Frequency licensing.** On Skylake-SP and Cascade Lake, executing 512-bit instructions dropped the core (and sometimes the whole socket) into a lower frequency "license" for hundreds of microseconds. A single stray AVX-512 `memcpy` could slow down unrelated scalar code. It was bad enough that **GCC and Clang still default to 256-bit vectors on Intel targets** (`-mprefer-vector-width=256`) unless told otherwise. Ice Lake and later substantially fixed it, and AMD's implementations never had it.
- **AMD's implementations.** Zen 4 implements AVX-512 by **double-pumping**: a 512-bit op stays one µop through most of the pipeline and is split into two 256-bit halves as late as possible. Half throughput, but full compatibility, no frequency penalty, and — importantly — **AMD got the ISA right and the fragmentation wrong-footed nobody**, because Zen 4 shipped a single coherent superset. Zen 5 on desktop and server has a **full 512-bit datapath**.

#### AVX10 and APX — the reset

**AVX10** replaces the subset alphabet soup with a **version number**. A CPU reports "AVX10.1" or "AVX10.2" and that single number implies a defined, cumulative feature set. The original 2023 plan had two flavours — 512-bit for servers, 256-bit-max for hybrid client parts — which would have reintroduced exactly the fragmentation it was meant to fix. **Intel withdrew the 256-bit-only variant**; all AVX10 implementations now support up to 512-bit (and the 128/256-bit forms). That reversal is worth teaching on its own: the ecosystem pushed back hard enough that Intel changed a published ISA plan.

**APX** (Advanced Performance Extensions) is the bigger change: **32 general-purpose registers** instead of 16, via a new REX2/extended-EVEX prefix. Also three-operand non-destructive forms for integer ops (`add r1, r2, r3`), new conditional instructions (`CFCMOV` — a `cmov` that also suppresses faults, so the compiler can use it where it currently cannot), and `PUSH2`/`POP2`. The expected payoff is fewer spills to stack — Intel's cited figures are in the region of 10% fewer loads and 20% fewer stores.

**Which silicon has them.** As of September 2026: **neither has shipped.** Both are slated for **Diamond Rapids (Xeon 7)**, disclosed at Hot Chips on 24 August 2026 and launching in **2027** on Intel 18A-P. GCC's Diamond Rapids target confirms **AVX10.2-512 and APX**. Panther Lake (Core Ultra 300, January 2026) does **not** carry them.

### 1.2 ARM

#### Architecture versions

| Version | Year | What defines it |
|---|---|---|
| **ARMv7-A** | 2007 | 32-bit only. 16 registers (R0–R15, with **PC as R15** — you can `mov pc, lr`). Thumb-2 mixed 16/32-bit encoding for density. Conditional execution on *every* instruction. |
| **ARMv8-A** | Oct 2011 | Introduces **AArch64** (the A64 instruction set) alongside AArch32. This is a genuinely new ISA, not an extension: 31 GPRs, fixed 32-bit encoding, no general conditional execution, PC is not a register. |
| **ARMv9-A** | Mar 2021 | Baseline = ARMv8.5 + **SVE2** + Confidential Compute Architecture (realms) + TME. |

Point releases matter more than the major numbers, because they are how features actually arrive:

- **v8.1** — **LSE atomics** (`ldadd`, `swp`, `cas`). See §2.7; this is the most performance-relevant point release ever.
- **v8.2** — FP16 arithmetic, RAS.
- **v8.3** — **Pointer Authentication (PAC)**: sign a return address into its unused high bits and check it on return. Apple shipped it in the A12 and it is why ROP is hard on iOS.
- **v8.4** — dot product, crypto.
- **v8.5** — **BTI** (branch target identification) and **MTE** (memory tagging — hardware use-after-free detection).
- **v8.6** — bf16 and int8 matmul.
- **v8.9 / v9.x** — SME2, memory system enhancements. The series runs to **ARMv9.7-A (announced October 2025)**.

#### The AArch64 register file

| Register(s) | Role |
|---|---|
| **X0–X30** | 31 general-purpose 64-bit registers. `W0–W30` are the low 32 bits (writing a W register **zeroes the upper 32**, like x86's 32-bit writes). |
| **XZR / WZR** | The zero register. Reads as 0, writes are discarded. Encoded as register 31 in most instructions. |
| **SP** | Stack pointer. *Also* encoded as register 31, but in the instructions where 31 means SP rather than XZR. Must be **16-byte aligned** at any public interface. |
| **PC** | **Not a general-purpose register** (unlike ARMv7). Only reachable via `adr`/`adrp` and branches. |
| **V0–V31** | 32 × 128-bit SIMD/FP registers. Addressable as `Bn` (8-bit), `Hn` (16), `Sn` (32), `Dn` (64), `Qn` (128), or as vectors (`v0.4s`, `v0.16b`, …). |
| **NZCV** | Condition flags, in a system register — not a general register. |

There is **no flags-carrying arithmetic by default**: `add` does not set flags, `adds` does. And conditional execution is gone except for `b.cond`, the `cset`/`csel`/`csinc` family, and a few others — a deliberate reversal of ARMv7's fully-predicated design, because predication is expensive to rename in an out-of-order core.

#### AAPCS64 vs System V AMD64

| | **System V AMD64** (Linux/macOS x86-64) | **AAPCS64** (AArch64) |
|---|---|---|
| Integer args | **6**: RDI, RSI, RDX, RCX, R8, R9 | **8**: X0–X7 |
| Integer return | RAX (RDX:RAX for 128-bit) | X0 (X0–X1 for 128-bit) |
| Indirect result (sret) | hidden first arg in RDI | **X8**, a dedicated register |
| FP/SIMD args | XMM0–XMM7 (8) | V0–V7 (8) |
| Caller-saved (volatile) | RAX, RCX, RDX, RSI, RDI, R8–R11 | X0–X17 (X9–X15 are pure temporaries) |
| Callee-saved | **RBX, RBP, R12–R15** | **X19–X28** |
| Linker/veneer scratch | — | **X16, X17** (IP0/IP1) — a PLT stub may clobber these across *any* call |
| Platform register | — | **X18** — reserved by the OS; Apple and Windows both use it, Linux does not |
| Frame pointer | RBP (by convention; `-fomit-frame-pointer` frees it) | **X29**, architecturally blessed |
| Return address | **on the stack**, pushed by `call` | **X30 (LR)**, in a register — leaf functions never touch memory |
| SIMD callee-saved | none | **V8–V15, lower 64 bits only** |
| Stack alignment | 16 bytes at `call` | 16 bytes at any public interface |
| **Red zone** | **128 bytes below RSP**, usable by leaf functions without adjusting RSP | **None.** AAPCS64 defines no red zone. |
| Varargs | AL holds the number of vector registers used | separate register/stack save areas |

The two rows that change code: **eight register arguments instead of six** (verified in §4.2 Exercise 3 — a 9-argument function spills three arguments to the stack on x86-64 and one on AArch64), and **the return address lives in a register**, which is why AArch64 leaf functions frequently have no prologue at all and why the `stp x29, x30, [sp, -16]!` / `ldp` pair is the AArch64 equivalent of `push rbp` / `pop rbp`.

#### NEON vs SVE vs SVE2

- **NEON (Advanced SIMD)** — **fixed 128-bit**, 32 registers, mandatory in ARMv8-A. Directly analogous to SSE: you write code for a known width and hand-roll the scalar remainder loop.
- **SVE (Scalable Vector Extension)** — **vector-length agnostic**. The hardware implements *some* width between 128 and 2048 bits in 128-bit steps, and **the binary does not know which**. Instead of `for (i += 4)`, you write a loop that asks the hardware how many lanes it has: `whilelo` builds a predicate covering "as many lanes as remain", `incw` advances the index by the actual vector length, and the loop runs until the predicate is empty. **There is no scalar tail.** Adds 16 **predicate registers** P0–P15, gather/scatter, and *first-fault* loads (load what you can without faulting — which is what makes it safe to vectorise `strlen`).
- **SVE2** — SVE plus the integer/DSP/crypto operations NEON had that SVE lacked, making it a genuine NEON replacement rather than an HPC-only extension. Baseline in ARMv9.

Vector lengths in real silicon: **Fujitsu A64FX 512-bit** (the first SVE part, in Fugaku), **AWS Graviton 3 256-bit**, Neoverse V1/V2 and Graviton 4 256-bit, Neoverse N2 128-bit. **No Apple silicon implements SVE** — Apple ships NEON plus its own matrix units.

**SME / SME2** (Scalable Matrix Extension) adds an outer-product engine and a "streaming SVE" mode with its own vector length, aimed at the matmul inner loop.

You can see the whole distinction in one compile — §4.2 Exercise 2 compiles the same C++ loop to NEON's `fmla` and to SVE's `whilelo`/`ptrue`/`incw`/`ld1w`.

#### Cortex-A / Cortex-R / Cortex-M

| Family | Profile | Memory | Used for |
|---|---|---|---|
| **Cortex-A** ("Application") | ARMv7-A / v8-A / v9-A | **MMU**, virtual memory | Anything running a general-purpose OS: phones, servers, laptops, Raspberry Pi. Out-of-order superscalar at the high end (Cortex-X, Neoverse V). |
| **Cortex-R** ("Real-time") | ARMv7-R / v8-R | **MPU** (protection, not translation) | Hard-real-time with bounded worst-case latency: storage controllers, automotive braking/steering, 5G modem basebands. Often lockstep dual-core for fault detection. |
| **Cortex-M** ("Microcontroller") | ARMv6-M / v7-M / v8-M | MPU optional, no MMU | Microcontrollers. **Thumb-only** (no A32/A64 at all), hardware interrupt stacking, deterministic. M0/M0+ (tiny), M3/M4 (M4 adds DSP+FPU), M7 (pipelined, cache), M23/M33 (TrustZone-M), **M55/M85 (Helium / MVE — SIMD for microcontrollers)**. |

The one-line version: **A runs Linux, R must not miss a deadline, M fits in a coin cell.** A Cortex-M does not have virtual memory, so nothing in §2.5 applies to it.

### 1.3 RISC-V

RISC-V is an *open standard* ISA — no licence, no royalty, anyone may implement it. That is its political interest; its technical interest is the **modularity**.

#### The base

**RV32I** (40 instructions) and **RV64I** (52) are the base integer ISAs, plus **RV32E**, an embedded subset with only 16 registers. The base is deliberately minimal — no multiply, no floating point, no atomics.

**32 registers x0–x31**, with **x0 hardwired to zero** (reads 0, writes discarded). That one decision buys a surprising amount: `mv rd, rs` is `addi rd, rs, 0`, `nop` is `addi x0, x0, 0`, `j label` is `jal x0, label`, a comparison-and-discard is a write to x0. Many "instructions" are pseudo-instructions built from the base plus x0.

**There is no flags/condition-code register.** Branches compare two registers directly (`blt a0, a1, label`). This is the deepest divergence from x86 and ARM: no flags means no partial-flag dependencies, no flag renaming, and no serialising hazard between a compare and its branch — but it also means no `adc`-style carry chains, so multi-precision arithmetic is more verbose.

#### The extension model

| Letter | What |
|---|---|
| **I** | base integer (mandatory) |
| **M** | multiply / divide |
| **A** | atomics — `lr`/`sc` (load-reserved/store-conditional) **and** AMOs (`amoadd`, `amoswap`, …), each with `.aq`/`.rl` ordering bits |
| **F** | single-precision float |
| **D** | double-precision float |
| **C** | **compressed** — 16-bit encodings of the most common instructions, typically ~25–30% code-size reduction |
| **V** | vector (RVV 1.0) — vector-length agnostic like SVE, with `vsetvli` |
| **Zicsr / Zifencei** | control/status registers; instruction-fetch fence |
| **G** | shorthand for `IMAFD_Zicsr_Zifencei` — the general-purpose bundle |

So `rv64gc` = 64-bit, general-purpose, compressed. That string is the de-facto Linux baseline.

**Why modularity matters.** A microcontroller vendor implements RV32IC and pays no area for a divider or an FPU it will never use; a server vendor implements RV64GCV. One ISA, one toolchain, one ABI, from a 10-cent MCU to a datacentre part — where ARM needs three separate architecture profiles (M/R/A) to span the same range.

**And why it is also the problem.** If every vendor picks a different subset, "RISC-V Linux" means nothing. The answer is **profiles**: a profile names a mandatory set that software can assume. **RVA23, ratified 21 October 2024, makes the vector extension AND the hypervisor extension mandatory** — the first time an application-class RISC-V binary can assume vectors exist. RVA23 is the target that matters; RVA22 (its predecessor) left V optional, which was precisely the fragmentation everyone feared.

#### Real silicon, honestly

Shipping today: **SiFive** (IP, U-series and P-series cores), **T-Head / Alibaba XuanTie C910 / C920**, **StarFive JH7110** (the VisionFive 2 board), **SpacemiT K1/M1** (Banana Pi BPI-F3, Milk-V Jupiter), plus a very large volume of embedded RISC-V that nobody counts — Western Digital and Seagate controllers, Nvidia's own on-die management cores (Nvidia has shipped RISC-V microcontrollers inside GPUs for years), ESP32-C3 and similar.

Announced / in development at the high end: **Ventana Veyron**, **Tenstorrent Ascalon**, **Rivos**, and various Chinese server efforts. There are RISC-V laptops (the DeepComputing / Framework mainboard).

**The honest assessment: as of September 2026 there is no RISC-V application core shipping in volume that is competitive with a current Zen, Cove, Neoverse or Apple core on single-thread performance.** The best available parts are roughly in the performance class of an older mid-range ARM Cortex-A. The ISA is not the limitation — RVA23 is a perfectly reasonable modern ISA — the limitation is that designing and validating a 500-entry-ROB out-of-order core takes a decade and a billion dollars, and the companies attempting it started recently. Teach RISC-V because **it is the cleanest ISA to read and the best one to learn on**, not because production software is about to run on it.

### 1.4 The others, briefly

**POWER / PowerPC (IBM).** Big-endian by tradition, bi-endian since POWER7 and used little-endian in Linux (`ppc64le`). Very wide cores with aggressive **SMT — up to SMT8** on POWER8/9/10, aimed at throughput on commercial workloads. The Power ISA was **opened in 2019** under the OpenPOWER Foundation. Two reasons it appears in a curriculum: it is the mainstream architecture with the **weakest memory model** — weaker than ARM, not multi-copy-atomic, so it permits the IRIW outcome ARMv8 forbids, making it the standard worst case for memory-ordering reasoning — and it is still deployed in IBM Z-adjacent enterprise and in some HPC (Summit/Sierra were POWER9 + Volta).

**MIPS.** The teaching ISA of the 1990s — Patterson & Hennessy is built on it, so a generation learned pipelining from MIPS diagrams. Commercially: DEC workstations, SGI graphics workstations, the N64 and PlayStation 1/2, then a long decline into embedded and router SoCs. **In 2021 MIPS the company abandoned the MIPS ISA and pivoted to RISC-V.** That single fact is the tidiest available summary of what happened to the proprietary-RISC business.

**SPARC.** Sun Microsystems, 1987. Notable for **register windows** — a large physical register file rotated on each call so most functions never spill — which was clever and turned out to be a mistake, because it makes context switches and out-of-order renaming expensive. Open-sourced as OpenSPARC. Oracle bought Sun in 2010 and wound SPARC development down by 2017. Fujitsu, the other major SPARC implementer, built SPARC64 supercomputers (the K computer) and then **abandoned SPARC for ARM** — the A64FX in Fugaku is a Fujitsu design with ARM SVE. Both surviving SPARC lineages ended by moving to somebody else's ISA.

Sources: [x86-64 (Wikipedia)](https://en.wikipedia.org/wiki/X86-64) · [AVX-512 (Wikipedia)](https://en.wikipedia.org/wiki/AVX-512) · [Intel AVX10 technical paper](https://cdrdv2-public.intel.com/849709/356368-003-intel-avx10-technical-paper.pdf) · [Phoronix: Diamond Rapids GCC patch confirms AVX10.2-512 and APX](https://www.phoronix.com/news/Intel-Diamond-Rapids-APX-AVX10) · [Phoronix: AVX10.2 256-bit rounding dropped in GCC 15](https://www.phoronix.com/news/Intel-AVX10.2-256-Merged-GCC-15) · [Tom's Hardware: AVX10 brings AVX-512 to E-cores](https://www.tomshardware.com/news/intels-new-avx-10-brings-avx-512-capabilities-to-e-cores) · [Agner Fog's forum: AVX10 & APX announcement](https://www.agner.org/forum/viewtopic.php?t=115) · [AArch64 (Wikipedia)](https://en.wikipedia.org/wiki/AArch64) · [ARM AAPCS64 (ARM-software/abi-aa)](https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst) · [ARM: Large System Extensions](https://learn.arm.com/learning-paths/servers-and-cloud-computing/lse/intro/) · [RISC-V (Wikipedia)](https://en.wikipedia.org/wiki/RISC-V) · [RISC-V International: RVA23 ratification](https://riscv.org/blog/2024/10/risc-v-announces-ratification-of-the-rva23-profile-standard/) · [ServeTheHome: Diamond Rapids at Hot Chips 2026](https://www.servethehome.com/intel-diamond-rapids-the-2027-intel-xeon-at-hot-chips-2026/) · [Intel SDM Vol. 1, 253665-092 (June 2026)](https://cdrdv2-public.intel.com/922477/253665-092-sdm-vol-1.pdf) — §3.2.4 (IA-32e modes), §3.4.1.1 (zero-extension), §3.6.1 (REX), §7.3.2.3 (INC/DEC) · [Intel P6 Family Hardware Developer's Manual, 244001-001](https://download.intel.com/design/PentiumII/manuals/24400101.pdf) §2.2.1 · [*Microprocessor Report*, "AMD Drops 64-Bit Hammer on x86", 4 Sept 2000](https://www.cecs.uci.edu/~papers/mpr/MPR/2000/20000904/143601.pdf) · [Keltcher, McGrath, Ahmed & Conway, "The AMD Opteron Processor for Multiprocessor Servers", *IEEE Micro*, Mar–Apr 2003](https://pds.ucdenver.edu/document/hardware/opteron-IEEE-Micro-2003.pdf) · [Stanford EE380: McGrath, "x86-64: Extending the x86 architecture to 64-bits" (2000)](https://web.stanford.edu/class/ee380/Abstracts/O00927.html) · [Stephen Morse on designing the 8086](https://stevemorse.org/pcw40.html) · [Smotherman, EPIC/IA-64 history](https://mark.people.clemson.edu/epic.html) · [Bendersky, PIC on x64](https://eli.thegreenplace.net/2011/11/11/position-independent-code-pic-in-shared-libraries-on-x64)

---

## 2. Microarchitecture — the part that explains performance

The ISA is a contract. The microarchitecture is the machine that honours it. Two CPUs implementing identical ISAs can differ by 3× in performance on the same binary, and *all* of that difference lives here.

### 2.1 The pipeline: fetch, decode, rename, schedule, execute, retire

A modern high-performance core is an **out-of-order superscalar** machine. The stages, and what each is actually solving:

**Fetch.** Pull bytes from L1i, guided by the branch predictor. Bandwidth is the constraint: Skylake fetches 16 B/cycle, Golden Cove 32 B/cycle, Skymont 48 B/cycle. Note the fetch unit is driven *by the branch predictor*, not the other way round — the predictor runs ahead and tells fetch where to go, which is why a mispredict starves the whole machine.

**Decode.** Turn instruction bytes into **micro-ops (µops)**. On x86 this is genuinely hard, because instructions are 1–15 bytes and you cannot find instruction boundaries in parallel without first decoding. Three answers have been deployed:

- *More decoders*: Skylake 4 (1 complex + 3 simple), Golden Cove 6, Lion Cove 8.
- *A micro-op cache* (Intel's DSB, AMD's op cache): cache the *decoded* µops so a hot loop skips decode entirely.

  | Core | µop cache entries | Delivery |
  |---|---|---|
  | Sandy Bridge / Skylake | **1536** (32 sets × 8 ways × 6) | 6 µops/cycle |
  | Ice Lake / Sunny Cove | **2304** | ≤5 µops/cycle downstream |
  | Golden Cove | **4096** | **8 µops/cycle** |
  | Lion Cove | **5250** | **12 µops/cycle** |
  | Zen 4 | **6912** | 9 µops/cycle (renamer limits to 6) |
  | Zen 5 | **6144**, **16-way** | 2 pipes × 6 instructions = 12/cycle |

  Zen 5's op cache *shrank* in entries while getting denser and more associative — and Chips and Cheese measured "basically no difference in micro-op cache hitrate despite the lower capacity", which is a nice lesson in why a capacity number alone tells you little.

  **Capacity is also not usable capacity.** Intel's optimization manual (§3.4.2.5) caps the DSB at **18 µops per 32-byte aligned chunk**, at most **three unconditional branches** per chunk, and at most two branches per way. Intel names read-modify-write instructions as a prime cause of blowing the 18-µop limit — so dense, branchy, memory-heavy code can fall out of the µop cache and back onto the legacy decoders.
- *Clustered decode*: several narrow decoders each working on a different branch-delimited stretch of code. Skymont does **3 clusters × 3-wide = 9 instructions/cycle** with no µop cache at all; Zen 5 does 2 clusters × 4-wide.

ARM and RISC-V skip this whole problem: fixed 32-bit instructions mean boundaries are free, which is why Apple could go 8-wide in 2020 and why no ARM core needs a µop cache.

**Rename / allocate.** *This is the stage that makes everything else possible.* The ISA gives you 16 architectural registers. The core has ~180–250 **physical** registers (Skylake: 180 integer + 168 vector, per Intel via Agner Fog). The Register Alias Table maps architectural names onto physical ones, assigning a **fresh physical register on every write**.

Why this matters: consider

```asm
mov eax, [mem1]     ; A
mov ebx, [mem2]     ; B  (misses cache)
add ebx, eax        ; C  needs B
imul eax, 6         ; D  writes eax
```

`D` writes `EAX` while `C` still needs the old `EAX`. Without renaming, `D` must wait for `C` — a **false dependency** created purely by the reuse of a register name. With renaming, `D` gets a brand-new physical register and executes immediately, while `C` reads the old one. As Agner Fog puts it, the multiplication can start before the addition.

So: **renaming eliminates WAR (write-after-read) and WAW (write-after-write) hazards entirely, leaving only true RAW (read-after-write) data dependencies.** Out-of-order execution is only possible because renaming removes the artificial ordering that a 16-name register file would otherwise impose. Everything downstream — the scheduler, the ROB, speculation — is built on that.

Rename also does free work:

- **Move elimination** — `mov rax, rbx` becomes a pure RAT update: zero latency, no execution port. Introduced on **Ivy Bridge** (*not* Sandy Bridge), succeeding in >80% of eligible cases, and Zen 5 does six per cycle. **But it is not a monotonic story**: Agner measured that on **Ice Lake and Tiger Lake, general-purpose register moves are *not* eliminated** — only vector moves of 128 bits and up. A "free" instruction stopped being free for two generations. And an eliminated move still consumes decoder bandwidth.
- **Zero-idiom recognition** — `xor eax, eax`, `sub rax, rax`, `pxor`, `xorps`, `andnps` and the `psub`/`pcmpgt` families are recognised as "produce zero, depend on nothing." No execution unit, four per cycle on Skylake. This is exactly why compilers emit `xor eax, eax` rather than `mov eax, 0`: the latter is a longer encoding *and* not a dependency-breaker. `cmp` and `sbb` get no such treatment, and `pcmpeq` (set all ones) breaks the dependency but *does* use a port.

**Both tricks stop at 32 bits, and the reason is the whole point of the stage.** In 64-bit mode a 32-bit write **zero-extends** into the full 64-bit register (SDM Vol. 1 §3.4.1.1), so it *fully defines* the physical destination — the renamer needs no dependency on the old value. An 8- or 16-bit write leaves the upper bits unmodified, so it is a **partial write**: the new value must be merged with the old one, which means a real dependency and, for the high-byte registers, an extra merging µop and a cycle of latency. That is why zero idioms and move elimination are documented as working on 32/64-bit registers only, and it is why compilers write `mov eax, ...` when they only need 32 bits — the shorter encoding is a bonus; breaking the dependency is the point.

**Schedule / issue.** µops sit in a scheduler (Intel calls it a *reservation station* — 97 entries on Skylake; AMD uses split integer and FP schedulers) and issue to an execution port the moment their operands are ready, **regardless of program order**. Golden Cove has 12 ports, Lion Cove 18, Skymont 8 integer ports + 7 AGUs. Port count is the real ceiling on ILP: five ALUs means at most five independent integer ops per cycle no matter how good your code is.

**Execute.** Typical latencies (cycles), stable across modern x86: integer `add`/`sub`/`and` 1; `lea` 1 (3 for complex forms); `imul` 3; integer `div` 20–40 and *variable*; FP add 2–3 (Golden Cove 2, Zen 4 3, Zen 5 2); FP mul 3–4; FMA 4; `vdivps` 10–15 and poorly pipelined; L1 hit 4–5.

**Retire / commit.** µops leave **in program order**, in the order they entered. This is not an implementation convenience — it is what makes precise exceptions possible. The core needs to be able to say "the machine state is exactly as if everything up to instruction N had run and nothing after", so a page fault or a signal has a well-defined program point. In-order retirement is the price of that, and the **reorder buffer** is the structure that pays it.

**The reorder buffer** holds every in-flight µop from allocate to retire, in order. Its size is the single best proxy for how far ahead a core can look for independent work — i.e. how much of a 300-cycle DRAM miss it can hide behind other work.

| Core | ROB | Core | ROB |
|---|---|---|---|
| Core 2 | 96 | Zen 1 | 192 |
| Nehalem | 128 | Zen 2 | 224 |
| Sandy Bridge | 168 | Zen 3 | 256 |
| Haswell | 192 | Zen 4 | **320** |
| **Skylake** | **224** | Zen 5 | **448** |
| Sunny Cove | ~352 | Gracemont | 256 |
| **Golden Cove** | **512** | **Skymont** | **416** |
| Lion Cove | +12.5% vs Redwood Cove | Tremont | 208 |
| **Apple M1 Firestorm** | **~630** | Goldmont | 78 |

Read that table as a 25-year trend: **cores hide latency by getting deeper, not just wider.** Golden Cove can have 512 µops in flight; at 4 µops/cycle that is ~128 cycles of runway — still less than one DRAM miss, which is why a cache miss stalls even the biggest core.

### 2.2 Superscalar width

"N-wide" is ambiguous and people mean different stages by it. Be specific:

| Core | Decode | Allocate/rename | Ports | Retire |
|---|---|---|---|---|
| Skylake | 4 decoders, **5 µops/cycle** | 4 | 8 | 4 |
| Golden Cove | 6 (8 from µop cache) | 6 | 12 | 8 |
| Lion Cove | 8 | 8 | 18 | — |
| Skymont | 9 (3×3) | 8 | 8 int + 7 AGU | 8 |
| Zen 4 | 4 (9 from op cache) | 6 | — | 6 |
| Zen 5 | 8 (2×4, clustered) | 8 | — | 8 |
| Apple M1 Firestorm | **8** | 8 | ~13 | 8 |

The narrowest stage is the ceiling. Zen 4's 4-wide decoder is why its op cache matters so much: sustained 6-wide throughput is only reachable from cache, never from cold decode.

### 2.3 Branch prediction — the biggest cliff you can build by accident

**Why it dominates.** A modern pipeline is roughly 15–20 stages from fetch to execute — where anyone publishes at all. **Skylake and Sunny Cove are documented at 14–19 stages and Zen 1/2/3 at 19; Golden Cove, Redwood Cove, Zen 4, Zen 5, Apple's Firestorm and Neoverse V2 publish no stage count.** For those, the measured mispredict penalty *is* the proxy for depth, and Intel says so: a misprediction "incurs a penalty that is largely related to **pipeline depth of the underlying micro-architecture**."

When the core reaches a conditional branch it does not know which way to go until the branch *executes*, dozens of cycles later. So it guesses and runs ahead speculatively. If the guess was wrong, everything fetched since is discarded and the front end restarts. In Agner Fog's words: **"the number of wasted clock cycles is approximately equal to the length of the pipeline."**

**Misprediction penalties.** Two independent sets of numbers, and it is worth showing both — AMD publishes first-party figures in its Software Optimization Guides, and Agner Fog measures them:

| Core | AMD SOG (first-party) | Agner Fog (measured) |
|---|---|---|
| Pentium M | — | 13 |
| Core 2 | — | ≥15 |
| Nehalem | — | ≥17 |
| Sandy Bridge / Ivy Bridge | — | 15+ |
| **Haswell → Skylake → "the Lakes"** | — | **15–20** |
| Silvermont / Goldmont / Atom | — | 11–13 |
| **Zen 1** | **12–18, common case 16** | ~18 avg |
| **Zen 2** | **12–18, common case 16** | ~18 avg |
| **Zen 3** | **11–18** | ~18 avg |
| **Zen 4** | **11–18, common case 13** | 15–18 |
| **Zen 5** | *(SOG 58455 not locatable)* | 15–25 |
| Qualcomm Oryon | — | 13 |

*(AMD no longer serves these SOG PDFs from amd.com under any URL; the Zen 1–4 documents are reachable only through the Wayback Machine, and the Zen 5 guide could not be found at all — every first-party Zen 5 figure in this document comes from AMD's Hot Chips 2024 deck.)*

Call it **~13–20 cycles.** Now do the arithmetic that makes this the headline number of the whole document: a loop body that does 5 cycles of useful work, with one 50/50-unpredictable branch in it, spends ~18 cycles per iteration recovering and 5 doing work. **You have built a 4× slowdown out of one `if`.** No other single mistake available to a programmer is this cheap to make or this expensive to have.

**How modern predictors work.** Two families, both of which learn *correlations between a branch's outcome and the recent history of other branches*:

- **Perceptron predictors** (Jiménez & Lin, HPCA 2001) keep a vector of weights per branch, one per bit of global history, and predict on the sign of the dot product with the history vector. The training rule is three lines: if the prediction was wrong, or if `|y_out|` was below a threshold θ, add `t·x_i` to every weight. Their measured result at a 4 KB budget was **6.89% misprediction, a 10.1% improvement over gshare** — for scale, the bi-mode predictor of the day improved on gshare by only 2.1%. The reason is the whole point of the design: *"hardware resources for our method scale **linearly** with the history length. By contrast, other purely dynamic schemes require **exponential** resources."* At equal budget, the usable history length is 8 (gshare) / 11 (bi-mode) / **28** (perceptron) at 4 KB, and 18 / 19 / **62** at 512 KB. And **training time is independent of history length**. Crippled to gshare's 18 bits of history, the perceptron *loses* — the long history is the entire advantage.
- **TAGE** (TAgged GEometric history length) keeps several tagged tables, each indexed by a hash of the branch PC with a *different* history length, growing geometrically. On a lookup every table is probed; the matching entry using the **longest** history wins and becomes the *provider*, with the next-longest as the *alternate*. On a mispredict, an entry is allocated in a table with a longer history than the one that got it wrong, so the predictor **discovers for itself the minimum history length each branch needs**.
- **ITTAGE** applies TAGE to indirect branch *targets*, and the differences are instructive. Seznec: *"ITTAGE relies on the same principles as the TAGE predictor… The counters representing predictions in TAGE are **replaced by the target addresses**."* Two refinements carry most of the benefit: a `USE_ALT_ON_NA` switch for newly-allocated entries cuts mispredictions ~2%, and — the big one — **the history vector records 10 bits per indirect branch and 5 bits per call, mixing target address with PC, instead of one taken/not-taken bit**, which cuts mispredictions by **nearly 16%**. Indirect branches carry far more information per occurrence than a binary outcome, so the history should store more than a bit.

**What real cores use** — and this is the part most summaries get wrong:

| Core | Conditional predictor |
|---|---|
| **Zen 1** | **Hashed perceptron** (AMD's own Hot Chips 28 block diagram says exactly that) |
| **Zen 2 – Zen 4** | **Hashed-perceptron L1 overridden by a TAGE L2.** Zen 2's Hot Chips slide highlights "New TAGE branch predictor" and labels the two levels "L1 Perceptron" / "L2 TAGE", targeting a **30% lower mispredict rate** |
| **Zen 5** | Larger TAGE + **2-ahead** prediction |
| **Intel, Ivy Bridge → Alder Lake** | **TAGE-like**, reverse-engineered in detail (below) |
| **Neoverse V2** | **8-component TAGE**, 12K-entry BTB |
| **Apple** | Cascaded — simple counter for easy branches, TAGE for correlated, ITAGE for indirects |

So the correct one-liner for AMD is **"Zen 1 perceptron, Zen 2 onwards perceptron *plus* TAGE"**, not "AMD uses perceptrons." Note also that AMD's *manuals* never say either word — they describe only "an advanced conditional branch direction predictor [using] a global history scheme." The algorithm names come from AMD's conference slides.

Intel publishes nothing, but the Half&Half work (IEEE S&P 2023) reverse-engineered the structure across Ivy Bridge through Alder Lake: a **base predictor of 8192 entries indexed directly by PC[12:0]**, plus **three 4-way pattern-history tables of 2048 entries each**, indexed by 9 bits — 8 folded global-history bits and **one raw PC bit** (PC[5] from Skylake onward). The Path History Register is **194×2 bits on Ice/Tiger/Alder Lake** and **93×2 on Skylake**, i.e. Skylake tracks "the history footprint of the last 93 taken branches." That single unmixed PC[5] bit is a security hole: aligning two domains' branches to opposite values of PC[5] **fully partitions the predictor**, for 1.2–8.8% overhead — and the follow-on work recovers full control flow of libjpeg routines and performs transient AES key recovery. The same global-history dependence is what Spectre-BHB/BHI exploits to get around eIBRS.

The practical consequence of all of it: **a branch is predictable if its outcome is a function of recent control flow, however complicated that function is.** Real predictors handle nested loops, repeating patterns of essentially unbounded period, and correlated branches. What they cannot predict is a branch whose outcome depends on *data* uncorrelated with history — `if (a[i] > threshold)` over random data.

**Accuracy, with real numbers.** State of the art on the CBP-5 traces is **4.991 MPKI at an 8 KB budget and 3.986 MPKI at 64 KB** (TAGE-SC-L, which carries a 1000-bit global history at the larger size). On SPEC CPU2017 integer with an 8 KB TAGE-SC-L, mean accuracy is **95.2%** — and **98.4% once systematically hard-to-predict branches are excluded**, because those H2Ps cause **55.3% of all mispredictions** on average (96.9% in `mcf`). The top five "heavy hitter" static branches account for **37% of dynamic mispredictions**.

Two numbers to open a lecture with, both from Lin & Tarsa (Intel), IISWC 2019:

- **"Mispredictions represent an 18.5% IPC opportunity at baseline… This gain grows with pipeline scale, e.g., to 55.3% at 4× scaling, a magnitude on par with advancing to the next process technology node."**
- **"Increasing TAGE-SC-L storage eight-fold to 64KB returns just 2.7% additional IPC."**

Better predictors are nearly exhausted; the remaining wins are in the *code*.

And the number that should worry anyone writing server software: on **large-code-footprint production workloads** (a game, an RDBMS, a NoSQL store, a real-time analytics engine, a streaming server) the same predictor averages **0.85 accuracy, not 0.952** — the game measures **0.73**. In those traces **85% of static branch IPs execute fewer than 100 times** per 30M-instruction slice, so the predictor never gets to learn them. Google's warehouse-scale study found the same shape from the other direction: front-end waste is **15–30% of execution slots (2–3× typical SPEC)** and L2 *instruction* misses run **5–20 MPKI, an order of magnitude worse than the worst case in SPEC CPU2006**, with "binaries of 100s of MB." **SPEC-derived intuitions about branch prediction do not transfer to big server binaries**, and that gap is precisely why AutoFDO and BOLT exist.

**Structures around the predictor:**

- **BTB** (branch target buffer) — caches *where* a taken branch goes. Multi-level on modern cores. Zen 2: 16 / 512 / 7168 entries at 0 / 1 / 4 cycles of latency. Zen 3: 1024 + 6656. Zen 4: 2×1536 + 2×7168. **Zen 5: 16K L1 BTB + 8K L2.** Golden Cove has three levels. A branch can be correctly predicted *taken* but still cost ~7 cycles if the BTB has no target for it — a distinct failure mode from a mispredict, and the reason very large amounts of straight-line branchy code (interpreters, big switch dispatch) run poorly.
- **Return address stack / RSB** — a small hardware stack that predicts `ret` targets:

  | Core | Entries |
  |---|---|
  | Pentium Pro → Nehalem | 16 |
  | Haswell / Broadwell / **Skylake** | **16** |
  | Ice Lake / Tiger Lake | **22** |
  | Golden Cove | *unpublished* — but C&C found it "rather slow at handling returns" beyond two deep |
  | AMD K8 / K10 | 12 / 24 |
  | **Zen 1–4** | **32** (Zen 2: one entry unusable, and only **15 per thread** with SMT on) |
  | **Zen 5** | **52** |
  | Neoverse V2 | ~31 measured |

  Intel turns the depth straight into advice — *"Assembly/Compiler Coding Rule 6. If there are more than 16 nested calls and returns in rapid succession; consider transforming the program with inline to reduce the call depth."* Anything that pushes a return address the hardware never sees, or consumes one it did, desynchronises the stack and every subsequent `ret` mispredicts until it refills. Agner's rule: **"Never jump out of a subroutine without a return and never use a return as an indirect jump."** The Spectre mitigations made this structure famous: Linux **stuffs the RSB on context switch** precisely because underflow behaviour is undefined — Google's retpoline documentation says *"behavior with exhausted return stack predictors is not well-specified… the hardware [may] instead turn to another predictor"* — and the kernel carries `#define RSB_CLEAR_LOOPS 32` plus software call-depth tracking on Skylake. *(`setjmp`/`longjmp` and fiber/coroutine stack switching are mechanically the same class of unmatched push/pop, but no primary source naming them was located — present that as reasoning, not citation.)*
  *(One conflict to present honestly: AMD's Zen 4 SOG states the L2 BTB costs **3 prediction bubbles**; Chips and Cheese measured **1 cycle**. Show both.)*
- **Zen 5's "2-ahead" predictor** predicts two branches per cycle and can decode *both* sides of a 2-way branch simultaneously, reaching 2 taken or 3 not-taken branches per clock. The idea is 30 years old — Seznec et al., "Multiple-block ahead branch predictors," ASPLOS 1996. The implementation detail worth knowing: the L1 BTB is dual-ported (hence 16K entries), the **L2 BTB at only 8K acts as a victim cache** for L1 evictions, and Zen 5 keeps three prediction windows with a 5-bit length field on the second so it does not oversubscribe the decoders.

**What to do about it.**

1. **Make the branch predictable** — sort the data, or hoist the condition out of the loop.
2. **Delete the branch.** `cmov` on x86, `csel`/`csinc` on AArch64, or arithmetic masking. **The tradeoff is real and measurable.** The accepted answer to the famous sorted-array question benchmarks all four combinations on a Core i7 920:

   | | Branchy | Branchless (`t = (data[c]-128)>>31; sum += ~t & data[c];`) |
   |---|---|---|
   | Random data | **11.777 s** | **2.564 s** |
   | Sorted data | **2.352 s** | **2.587 s** |

   Read the second column: **branchless is flat**, and it *slightly loses* on sorted data. That table is the entire `cmov` argument. Intel states the rule directly — *"Use the SETCC and CMOV instructions to eliminate unpredictable conditional branches where possible. **Do not do this for predictable branches**… converting a conditional branch to SETCC or CMOV **trades off control flow dependence for data dependence and restricts the capability of the out-of-order engine**… Use these instructions only if the increase in computation time is less than the expected cost of a mispredicted branch."* Linus Torvalds put the same point more bluntly on LKML: *"assuming the branch is AT ALL predictable (and 95+% of all branches are)… branches can be predicted, and when they are predicted they basically go away… In contrast, if you use a predicated instruction, ALL of it is on the critical path."* — with the caveat that matters: *"if you KNOW the branch is totally unpredictable, cmov is often good for performance. **But a compiler almost never knows that.**"*

   Which is exactly why LLVM ships a pass that turns `cmov` **back into branches**, with a documented threshold: it considers a CMOV profitable only *"if the cost of its condition is higher than the average cost of its true-value and false-value by 25% of branch-misprediction-penalty… this assures no degradation even with 25% branch misprediction"*, and only in innermost loops. Compilers are conservative here on purpose, and they will refuse outright if either side has a side effect or could fault.
3. **Tell the compiler — but know what the hint actually does.** `[[likely]]`/`[[unlikely]]` and `__builtin_expect` (**GCC's default assumed probability is 90%**, tunable) do **not** emit any branch-hint instruction. They attach branch weights that drive **block layout, inlining and register allocation** — the hot path becomes fall-through and occupies fewer I-cache lines. That is the benefit. GCC's own documentation is unusually candid: *"programmers are notoriously bad at predicting how their programs actually perform."* And Clang's is explicit that **"these attributes have no effect on the generated code when using PGO… or at optimization level 0"** — profile data overrides the annotation entirely.

   So the real answer is **PGO**, which measures instead of guessing. Google's AutoFDO paper: sampling-based profiling recovers **84.8% of the benefit of instrumented FDO** (mean 10.5% vs 12.4% speedup across nine production workloads) at **under 1% profiling overhead**, and — the operationally important part — **a 3-week-old profile costs only 2–3%, and a 6-month-old profile still delivers 50% of the gains.** Profile staleness is far less of a problem than people assume, which removes the usual excuse for not doing it.

   *(The one place a source-level hint does reach the hardware is Redwood Cove's `3EH` branch hint prefix, and only when the predictor has no entry for that branch at all.)*

Sources: [Agner Fog, *The Microarchitecture of Intel, AMD and VIA CPUs*](https://www.agner.org/optimize/microarchitecture.pdf) (§3 branch prediction, §8/§11 pipelines — ROB, RS and register-file counts, and every mispredict-penalty figure above) · [Agner Fog, *Instruction Tables*](https://www.agner.org/optimize/instruction_tables.pdf) · [uops.info](https://uops.info/) · [C&C: Golden Cove](https://chipsandcheese.com/p/popping-the-hood-on-golden-cove) · [C&C: Lion Cove](https://chipsandcheese.com/p/lion-cove-intels-p-core-roars) · [C&C: Skymont](https://chipsandcheese.com/p/skymont-intels-e-cores-reach-for-the-sky) · [C&C: Zen 4 frontend](https://chipsandcheese.com/p/amds-zen-4-part-1-frontend-and-execution-engine) · [C&C: Zen 5 desktop](https://chipsandcheese.com/p/amds-ryzen-9950x-zen-5-on-desktop) · [C&C: Strix Point / Zen 5 mobile](https://chipsandcheese.com/p/amds-strix-point-zen-5-hits-mobile) · [C&C: Zen 5's 2-Ahead Branch Predictor](https://chipsandcheese.com/p/zen-5s-2-ahead-branch-predictor-unit) · [Intel Optimization Reference Manual, 248966-050](https://cdrdv2-public.intel.com/821612/248966-Optimization-Reference-Manual-V1-050.pdf) — §2.4 (Golden Cove), §2.1.1.3 (Redwood Cove MOV+OP/LOAD+OP fusion), §3.4.2 (DSB limits, micro-/macro-fusion), §4.1.4 (E-core clustered decode) · [AMD Hot Chips 2024: Zen 5](https://hc2024.hotchips.org/assets/program/conference/day2/24_HC2024.AMD.Cohen.Subramony.final.pdf) · [C&C: Disabling Zen 5's op cache](https://chipsandcheese.com/p/disabling-zen-5s-op-cache-and-exploring) · [C&C: Gracemont](https://chipsandcheese.com/p/gracemont-revenge-of-the-atom-cores) · [C&C: Intel details Skymont](https://chipsandcheese.com/p/intel-details-skymont) · [Jiménez & Lin, "Dynamic branch prediction with perceptrons", HPCA 2001](https://www.cs.utexas.edu/~lin/papers/hpca01.pdf) · [Seznec & Michaud, "A case for (partially) TAgged GEometric history length branch prediction", JILP vol. 8, 2006](http://www.jilp.org/vol8/v8paper1.pdf) · [Seznec, "A 64-Kbytes ITTAGE indirect branch predictor", JWAC-2 2011](https://www.jilp.org/jwac-2/program/cbp3_07_seznec.pdf) · [Seznec, TAGE-SC-L, CBP-5 2016](https://www.jilp.org/cbp2016/paper/AndreSeznecLimited.pdf) · [Lin & Tarsa (Intel), "Branch Prediction Is Not A Solved Problem", IISWC 2019](https://arxiv.org/pdf/1906.08170) · [Kanev et al., "Profiling a Warehouse-Scale Computer", ISCA 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/44271.pdf) · [Yavarzadeh et al., "Half&Half", IEEE S&P 2023](https://cseweb.ucsd.edu/~dstefan/pubs/yavarzadeh:2023:half.pdf) · [Yavarzadeh et al., "Pathfinder", ASPLOS 2024](https://cseweb.ucsd.edu/~dstefan/pubs/yavarzadeh:2024:pathfinder.pdf) · [VUSec, BHI / Spectre-BHB](https://www.vusec.net/projects/bhi-spectre-bhb/) · [Mike Clark, "A New x86 Core Architecture" (Zen 1), Hot Chips 28, 2016](https://old.hotchips.org/wp-content/uploads/hc_archives/hc28/HC28.23-Tuesday-Epub/HC28.23.90-High-Perform-Epub/HC28.23.930-X86-core-MikeClark-AMD-final_v2-28.pdf) · [AMD Zen 2, Hot Chips 31, 2019](https://old.hotchips.org/hc31/HC31_1.1_AMD_ZEN2.pdf) · AMD Software Optimization Guides 55723 / 56305 / 56665 / 57647 §2.8 (Wayback only) · [SO #11227809: "Why is processing a sorted array faster?"](https://stackoverflow.com/questions/11227809/) · [Torvalds on cmov, LKML 2007](https://yarchive.net/comp/linux/cmov.html) · LLVM `X86CmovConversion.cpp` · [Chen et al., "AutoFDO", CGO 2016](https://research.google/pubs/pub45290/)

### 2.4 The cache hierarchy — the numbers everyone should know

Start with the ladder. Memorise it as **orders of magnitude, not exact values**, because the exact values move every generation and the *ratios* do not.

| Level | Latency (cycles) | Rough size |
|---|---|---|
| Register | 0 (bypassed) | ~200 physical, 16 architectural GPRs |
| L1d hit | **4–5** | 32–48 KB (128 KB on Apple) |
| L2 hit | **12–19** | 256 KB → 4 MB |
| L3 / LLC hit | **~40–60** | 8 MB → 96 MB (X3D) → 1.28 GB (Diamond Rapids) |
| DRAM | **200–400** | GBs |

The single most important caveat, and one almost every "latency numbers" table gets wrong: **DRAM latency is roughly constant in nanoseconds and therefore variable in cycles.** Chips and Cheese measured just over **70 ns** on a Ryzen 9 9950X with DDR5-6000, and spelled the consequence out: *"70 ns of DRAM latency is nearly 400 cycles at 5.7 GHz, but only 210 cycles at 3 GHz."* The same DIMM is a 400-cycle stall on a desktop core and a 210-cycle stall on a server core. Teach the ns; derive the cycles.

#### Measured, per part

| Part | L1d | L1d lat | L1i | L2 | L2 lat | L3/LLC | L3 lat | DRAM |
|---|---|---|---|---|---|---|---|---|
| Skylake (i7-6700) | 32 KB, 8-way | **4 cyc** | 32 KB, 8-way | 256 KB, 4-way | **12 cyc** | 8 MB, 16-way | **42 cyc** | 42 cyc + **51 ns** |
| Golden Cove (Alder Lake) | 48 KB | **5 cyc** | 32 KB | 1.25 MB | **15 cyc** | 30 MB (12 slices) | higher than Zen 3 | DDR5 |
| Raptor Cove | 48 KB | 5 cyc | 32 KB | **2 MB** | **16 cyc** | 36 MB | — | DDR5 |
| Lion Cove (Arrow/Lunar Lake) | 48 KB "**L0**" | **4 cyc** | 64 KB | **192 KB "L1"** @ **9 cyc**, then 2.5–3 MB L2 | — | 12 MB (4×3 MB) | improved vs Meteor Lake | DDR5/LPDDR5X |
| Zen 3 | 32 KB, 8-way | 4 cyc | 32 KB | 512 KB | **12 cyc** | 32 MB per CCX | ~46 cyc | DDR4 |
| Zen 5 (9950X) | **48 KB**, 12-way | **4 cyc** | 32 KB | 1 MB, **16-way** | **14 cyc** | 32 MB per CCD (96 MB X3D) | — | **~70 ns** (≈400 cyc @ 5.7 GHz) |
| Skymont (E-core) | 48 KB | **4 cyc** | 64 KB | **4 MB** per cluster | **19 cyc** | 8 MB memory-side | **~214 cyc** | — |
| **Apple M1 Firestorm** | **128 KB** | **3 cyc** | **192 KB** | **12 MB** per 4-core cluster | **18 cyc** | 8 MB SLC | 18 cyc + 10–15 ns | 18 cyc + **91 ns** |
| Apple M1 Icestorm | 64 KB | — | 128 KB | 4 MB per cluster | — | shared SLC | — | — |

Three things in that table are worth a whole lesson each:

1. **Golden Cove traded a cycle of L1d latency for 16 KB of capacity** (32 KB @ 4 cyc → 48 KB @ 5 cyc). Lion Cove then bought the cycle back by demoting 48 KB to an "L0" and inserting a *new* 192 KB / 9-cycle level. Cache design is a latency-vs-capacity negotiation and you can watch it happen product to product.
2. **Apple's L1d is 128 KB at 3 cycles** — four times an x86 L1d, and *faster*. This is not magic; see §3.3 on the 16 KB page size, which is what makes it possible.
3. **Skymont's "L3" is 214 cycles.** On a hybrid Intel part an E-core's view of memory is completely different from a P-core's. Any latency number you quote for "an Intel CPU" is meaningless without saying which core.

#### Cache lines, associativity, and the pathologies

- **Line size is 64 bytes** on all x86-64 and most ARM. **Apple M-series uses 64-byte lines in L1 but 128-byte lines in L2 and the SLC** — this is why `sysctl` on macOS reports 128 while `CTR_EL0` on Asahi Linux reports 64, and why "just pad to 64" is not portable advice.
- **N-way set associative**: an address maps to exactly one *set*, and the set holds N lines. A 48 KB, 12-way, 64 B-line L1d has 48K/(12×64) = 64 sets, so bits 6–11 of the address pick the set. The pathology: iterate an array with a **stride that is a large power of two** and every access lands in the same set, so you thrash a 12-entry set no matter how big the cache is. The classic symptom is a matrix transpose or an FFT whose performance collapses at exactly power-of-two dimensions — the standard fix is to pad the row stride by one line.
- **4K aliasing**: Intel's load/store units compare only the low 12 bits of an address to detect a possible store-forward dependency. Two accesses exactly 4096 bytes apart look aliased even when they are not, and the load is falsely serialised behind the store. Symptom: copying between two buffers whose addresses differ by an exact multiple of 4096 is measurably slower than the same copy at any other offset.
- **Inclusivity**: Intel client L3 was *inclusive* through Skylake (every line in L1/L2 also present in L3 — simplifies coherence, wastes capacity). Skylake-SP and later server parts moved to *non-inclusive*. AMD's L3 is a **victim cache** — a line only enters L3 when evicted from L2, so the L3's capacity is genuinely additive.

#### Prefetchers

Modern cores have several, running concurrently:

- **L1 DCU next-line** — fetch the line after the one you just touched.
- **L1 IP-stride** — remembers, per *instruction pointer*, the constant stride that instruction has been walking, and runs ahead of it. This is why `for (i) sum += a[i*7]` is prefetched fine.
- **L2 streamer** — detects ascending/descending streams and pulls up to ~20 lines ahead.
- **L2 adjacent-line ("spatial")** — fetches the 64-byte buddy, so the *effective* transfer granularity on Intel is often **128 bytes**. This is the reason false-sharing padding on x86 should frequently be 128 bytes rather than 64.

The rule to teach: **hardware prefetchers recognise linear and constant-stride patterns, and nothing else.** A linked list, a hash table probe, a tree walk, or a pointer-chasing graph traversal defeats every one of them, which is why the same number of bytes touched can be 10× slower in a `std::list` than in a `std::vector`. Software prefetch (`__builtin_prefetch`, `prefetcht0/1/2/nta`) exists for exactly the pointer-chasing case where you can compute the *next* address well before you need it, and it hurts whenever the hardware prefetcher already had it — because it burns a load slot and can evict something live.

### 2.5 Virtual memory: TLBs, page walks, huge pages

Every load goes through address translation first. The TLB caches virtual→physical mappings.

| Part | L1 dTLB | L2 / STLB | Miss penalty |
|---|---|---|---|
| Skylake, 4 KB pages | 64 entries, 4-way | 1536 entries, 12-way | 9 cyc dTLB miss, **17 cyc STLB miss** |
| Skylake, 2 MB pages | 32 entries, 4-way | 1536 entries, 12-way | 9 cyc |
| Skylake, 1 GB pages | 4 entries | 16 entries | — |
| Apple M1 Firestorm | **160 entries** | **3072 entries** | 6 cyc L1 miss, **26 cyc L2 miss** |

On x86-64 the standard configuration is **4-level paging**: a 48-bit virtual address split into four 9-bit indices plus a 12-bit page offset. A full TLB miss is therefore **up to four dependent memory accesses** — each of which can itself miss to DRAM. Worst case, a single load costs four serialised DRAM round trips before the data access even starts. Cores mitigate this with *paging-structure caches* that cache the upper levels of the walk. **5-level paging (LA57)** extends this to 57-bit virtual addresses and a fifth level, available on Ice Lake-SP and later; Linux only hands out addresses above 2^47 if you explicitly ask via `mmap` hint.

**Huge pages** attack the problem by making each TLB entry cover more memory. x86-64 supports 2 MB and 1 GB pages; a 1536-entry STLB covers 6 MB with 4 KB pages and **3 GB** with 2 MB pages. For a database or a JVM with a multi-gigabyte heap this is often a several-percent-to-double-digit win for free. Linux offers *transparent* huge pages (THP, automatic, `madvise`/`always`) and *explicit* hugetlbfs (reserved at boot, never swapped). THP's cost is latency variance: `khugepaged` and direct compaction can stall an allocation while the kernel defragments physical memory, which is exactly why many latency-sensitive services set THP to `madvise` or `never`.

### 2.6 Store buffers and memory disambiguation

Stores are not written to cache when they execute. They go into a **store buffer** and drain in order at retirement. This is what makes a store cheap (fire and forget) and it is *also* the physical reason x86's memory model permits StoreLoad reordering — see §2.8.

- **Store-to-load forwarding**: a later load whose address matches a pending store gets the value straight out of the store buffer, ~5 cycles, never touching cache.
- **Forwarding failure**: when the load only *partially* overlaps the store, or is misaligned relative to it, forwarding fails and the core must wait for the store to commit to L1 and then re-load — roughly a **10–15 cycle penalty**. The classic trigger is type punning: store a `double`, load the low 4 bytes as an `int`.
- **Memory disambiguation**: when a load is ready but an older store's *address* is not yet computed, the core has a choice — stall, or predict that they don't alias and execute the load speculatively. Modern cores predict. When the prediction is wrong the core takes a **memory ordering machine clear**, which is a full pipeline flush and costs on the order of a branch mispredict or worse.

### 2.7 Cache coherence, false sharing, and what atomics cost

**MESI** gives every cached line one of four states — Modified, Exclusive, Shared, Invalid — and the protocol guarantees that at most one core holds a line in M or E. AMD adds **O**wned (MOESI): a dirty line can be shared without first writing back to memory. Intel adds **F**orward (MESIF): one designated sharer answers requests, so N sharers don't all reply. Small parts snoop a bus; big parts use a directory or snoop filter (Intel's mesh CHAs, AMD's IOD).

**False sharing** is what happens when two threads write to two *different* variables that live on the same 64-byte line. There is no data race and no correctness bug — but every write invalidates the other core's copy, so the line ping-pongs across the interconnect on every iteration. The fix is padding:

```cpp
struct alignas(std::hardware_destructive_interference_size) Counter { std::atomic<long> v; };
```

except that `hardware_destructive_interference_size` is not the same number everywhere. **Verified against Compiler Explorer with GCC 15.2:**

| Target | `std::hardware_destructive_interference_size` |
|---|---|
| x86-64 | **64** |
| AArch64 | **256** |
| RISC-V (rv64gc) | **32** |

That single fact is a better argument for cross-ISA testing than any prose. Portable padding is not a constant. (GCC also warns `-Winterference-size` that the value is ABI-sensitive and shouldn't cross a translation-unit boundary in a public struct layout.)

**What atomics actually cost.** Measured on a Skylake i7-6700HQ (Travis Downs, "A Concurrency Cost Hierarchy"):

| Operation | Cost |
|---|---|
| Plain increment of a thread-local | **~2 ns** |
| Uncontended `atomic.fetch_add` (1 thread) | **~7 ns** |
| Uncontended CAS loop | ~12 ns |
| Uncontended `std::mutex` lock/unlock | ~21 ns |
| **Contended** `atomic.fetch_add`, 2 threads | **~110 ns** |
| Contended mutex, 2 threads | ~125 ns |
| Contended with a blocking syscall path | **>1,000 ns** |

The shape is what matters: **uncontended atomic ≈ 3× a plain store; contended atomic ≈ 15× an uncontended one.** The cost is not the `lock` prefix — it's the cache line moving between cores. Cross-CCD on a Zen 5 desktop that transfer is ~75 ns of pure interconnect latency (and was ~180 ns before the AGESA 1.2.0.2 microcode fix); cross-socket it is worse still. This is why sharded counters exist, and why Downs measured a **9× speedup on 4 cores** just from giving each thread its own counter.

**On ARM the atomic instruction itself changed.** ARMv8.0 only had load-linked/store-conditional (`ldxr`/`stxr`) — a retry loop, which livelocks under contention. ARMv8.1 **LSE** added single-instruction atomics (`ldadd`, `swp`, `casal`). GCC's default on AArch64 is `-moutline-atomics`, which emits a *call* to a runtime-dispatched helper so one binary works on both. Verified on Compiler Explorer with `arm64g1520`, the same `fetch_add` compiles three ways:

```asm
; default (-moutline-atomics): runtime dispatch
bl      __aarch64_ldadd4_relax

; -march=armv8.1-a  (LSE)
ldadd   w0, w0, [x1]

; -march=armv8-a -mno-outline-atomics  (LL/SC retry loop)
.L3:  ldxr  w0, [x1]
      add   w2, w0, 1
      stxr  w3, w2, [x1]
      cbnz  w3, .L3
```

Under multi-threaded contention LSE can be up to an order of magnitude faster than the LL/SC loop on recent ARM server cores; single-threaded, LL/SC can win. This is a real, checkable, one-flag performance decision that has no analogue on x86.

### 2.8 Memory ordering: x86-64 TSO vs ARM weak ordering

This is the section that changes how people write code.

**x86-64 is Total Store Order.** Intel SDM Vol 3A §8.2 states the rules; the practical summary is that of the four possible reorderings, hardware performs exactly one:

| Reordering | Allowed on x86-64? | Allowed on AArch64? |
|---|---|---|
| Load → Load | **No** | **Yes** |
| Store → Store | **No** | **Yes** |
| Load → Store | **No** | **Yes** |
| **Store → Load** | **Yes** | **Yes** |

Store→Load reordering is permitted because of the store buffer (§2.6): a store sits in the buffer while a later, independent load goes straight to cache. That is the *only* window x86 leaves open, and closing it costs an `mfence` or a `lock`-prefixed instruction.

**AArch64 is weakly ordered.** Absent explicit barriers or acquire/release instructions, the hardware may perform *any* of the four reorderings. It is "other-multi-copy-atomic", which means all cores agree on the order stores become visible — a guarantee POWER does not give, and which is why ARMv8 forbids the IRIW outcome that POWER allows.

Barriers and ordered accesses on AArch64: `dmb ish` (full barrier, inner-shareable), `dmb ishld` (load barrier), `dsb`, `isb` (instruction-stream sync), and — much cheaper than a barrier — the ordered load/store instructions `ldar` (load-acquire), `stlr` (store-release), and from ARMv8.3 `ldapr` (load-acquire-**RCpc**, weaker and cheaper than `ldar`'s RCsc).

#### The concrete consequence: code that is accidentally correct on x86

This is the canonical message-passing bug. Two threads, a flag, and a payload:

```cpp
int data;  std::atomic<int> flag;
void producer() { data = 42; flag.store(1, std::memory_order_relaxed); }
int  consumer() { while (!flag.load(std::memory_order_relaxed)) {} return data; }
```

`memory_order_relaxed` promises **nothing** about the ordering of `data` relative to `flag`. The code is wrong twice over by the standard: the relaxed pair establishes no happens-before edge, so the plain `data` accesses are a data race and therefore undefined behaviour. (Keeping `data` a plain `int` is deliberate — it is exactly what the bug looks like in real code, and it is what makes the emitted assembly readable.) But here is the emitted assembly, verified on Compiler Explorer (GCC 15.2, `-O2`), with the correct `release`/`acquire` version compiled alongside:

**x86-64 (`g152`)** — the two versions are *byte-identical*:

```asm
producer_relaxed():                     producer_rel():
  mov DWORD PTR data[rip], 42             mov DWORD PTR data[rip], 42
  mov DWORD PTR flag[rip], 1              mov DWORD PTR flag[rip], 1
  ret                                     ret

consumer_relaxed():                     consumer_acq():
.L4:                                    .L9:
  mov  eax, DWORD PTR flag[rip]           mov  eax, DWORD PTR flag[rip]
  test eax, eax                           test eax, eax
  je   .L4                                je   .L9
  mov  eax, DWORD PTR data[rip]           mov  eax, DWORD PTR data[rip]
  ret                                     ret
```

**AArch64 (`arm64g1520`)** — they are *not*:

```asm
producer_relaxed():           producer_rel():
  str  w2, [x1, ...]  ; data    str  w2, [x1, ...]  ; data
  str  w1, [x0]       ; flag    stlr w1, [x0]       ; flag   <-- store-release
  ret                           ret

consumer_relaxed():           consumer_acq():
.L4:                          .L9:
  ldr  w0, [x1]       ; flag    ldar w0, [x1]       ; flag   <-- load-acquire
  cbz  w0, .L4                  cbz  w0, .L9
  ldr  w0, [x2, ...]  ; data    ldr  w0, [x2, ...]  ; data
  ret                           ret
```

**That is the whole lesson in eight lines.** On x86-64 the bug produces the same machine code as the correct program, so it can pass every test on every x86 machine forever. On AArch64 it produces `str`/`str` and `ldr`/`ldr`, and the hardware is free to make the consumer see `flag == 1` and `data == 0`. The bug is not merely latent on x86 — it is *invisible*, because there was never an instruction to look for. It becomes both visible and real the moment the code is cross-compiled.

The corollary is the one that actually costs money: **passing your test suite on x86 is not evidence that your concurrent code is correct.** The x86 memory model is strong enough to hide a large class of missing-barrier bugs, and the first time you learn about them is when the service is running on Graviton or an M-series laptop.

#### The full mapping, verified

Compiled on Compiler Explorer, GCC 15.2, `-O2`, from one `std::atomic<int>`:

| C++ operation | x86-64 | AArch64 | RISC-V (rv64gc) |
|---|---|---|---|
| `load(relaxed)` | `mov` | `ldr` | `lw` |
| `load(acquire)` | `mov` | **`ldar`** | `lw; fence r,rw` |
| `load(seq_cst)` | `mov` | `ldar` | `fence rw,rw; lw; fence r,rw` |
| `store(relaxed)` | `mov` | `str` | `sw` |
| `store(release)` | `mov` | **`stlr`** | `fence rw,w; sw` |
| `store(seq_cst)` | **`xchg`** | `stlr` | `fence rw,w; sw; fence rw,rw` |
| `fetch_add(seq_cst)` | `lock xadd` | `bl __aarch64_ldadd4_acq_rel` (or `ldaddal`) | `amoadd.w.aqrl` |
| seq_cst fence | `mfence` | `dmb ish` | `fence rw,rw` |

Read the x86 column top to bottom: **five of the seven rows are a plain `mov`.** Acquire and release are *free* on x86 — they cost zero instructions, because the hardware already provides them. Only `seq_cst` *stores* cost anything (a `lock`-prefixed `xchg`, ~20 cycles), because only they need to close the StoreLoad window. On AArch64 every ordering level has its own instruction and each one costs something. This is the mechanical reason x86 code "accidentally works" and the mechanical reason ARM code has to be right.

(The reference mapping tables are Sewell et al.'s *C/C++11 mappings to processors*, Cambridge — the canonical source, and consistent with what GCC 15.2 actually emits above.)

#### The two patterns that break

- **`volatile` is not atomic.** It suppresses compiler caching of a value in a register. It emits no barriers, provides no ordering, and does not make read-modify-write atomic. In the Java memory model `volatile` *does* mean acquire/release; in C and C++ it does not. This confusion is the source of a large fraction of broken lock-free code.
- **Double-checked locking** without atomics is the classic. The unsynchronised first read of the pointer can observe a non-null pointer whose pointee's constructor stores have not yet become visible. On x86 the store-store ordering makes this nearly impossible to hit; on ARM it is reachable. Since C++11 the fix is `std::atomic` with acquire/release, or just a function-local `static` (guaranteed thread-safe initialisation).

#### Litmus tests worth knowing by name

| Test | What it probes | x86-64 | AArch64 |
|---|---|---|---|
| **MP** (message passing) | Store→Store + Load→Load | forbidden (safe) | **allowed (broken)** |
| **SB** (store buffering / Dekker) | Store→Load | **allowed (broken)** | allowed |
| **LB** (load buffering) | Load→Store | forbidden | allowed |
| **IRIW** (independent reads of independent writes) | multi-copy atomicity | forbidden | forbidden (ARMv8 is other-MCA) — but **allowed on POWER** |

SB is the useful contrast: it is the one litmus test x86 *also* fails, which is why `std::atomic` seq_cst stores are the only thing that costs an instruction on x86, and why a hand-rolled Dekker's algorithm needs an `mfence` even there.

**RISC-V** uses RVWMO (RISC-V Weak Memory Ordering) — weak like ARM, with a `fence` instruction that takes explicit predecessor/successor sets (`fence rw,w` = "all prior reads and writes before all subsequent writes"). It also defines `.aq`/`.rl` bits directly on its atomic instructions (`amoadd.w.aqrl` above). **POWER is weaker than ARM**: it is not multi-copy-atomic, so two observers can disagree about the order two other cores' stores became visible — the IRIW outcome ARMv8 forbids.

Sources: [Intel SDM Vol 3A §8.2 (Memory Ordering)](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html) · [Sewell et al., C/C++11 mappings to processors](https://www.cl.cam.ac.uk/~pes20/cpp/cpp0xmappings.html) · [Travis Downs, A Concurrency Cost Hierarchy](https://travisdowns.github.io/blog/2020/07/06/concurrency-costs.html) · [7-cpu Skylake](https://www.7-cpu.com/cpu/Skylake.html) · [7-cpu Apple M1](https://www.7-cpu.com/cpu/Apple_M1.html) · [C&C Zen 5 desktop](https://chipsandcheese.com/p/amds-ryzen-9950x-zen-5-on-desktop) · [C&C Golden Cove caches](https://chipsandcheese.com/2022/02/11/going-armchair-quarterback-on-golden-coves-caches/) · [C&C Skymont](https://chipsandcheese.com/p/skymont-intels-e-cores-reach-for-the-sky) · [ARM: Large System Extensions](https://learn.arm.com/learning-paths/servers-and-cloud-computing/lse/intro/) · [NVIDIA Grace atomics guide](https://nvidia.github.io/grace-cpu-benchmarking-guide/developer/atomics.html) · all assembly listings verified live against <https://godbolt.org> (GCC 15.2: `g152`, `arm64g1520`, `rv64-gcc1520`)

### 2.9 SMT / Hyper-Threading — what is actually shared

One physical core presents itself to the OS as two logical CPUs. The premise is stated plainly by Agner Fog: *"the throughput of each core is so high that it will rarely be fully utilized by a single thread."* SMT sells the leftovers.

The division of resources, in three categories:

- **Replicated** (each thread has its own): architectural register state, the RAT/rename map, the program counter, the interrupt controller. This is the only part that *must* be duplicated for two threads to exist at all — and it is small, which is why SMT costs Intel roughly 5% die area for a claimed 15–30% throughput.
- **Statically partitioned** (each thread gets half, whether it uses it or not): the µop queues and load/store buffers on most Intel designs, and the front-end queueing generally. Agner: *"the queueing of µops is equally distributed between the two threads so that each thread gets half of the maximum throughput."* Consequence: **a single thread running alone on a core with SMT enabled may have access to less buffering than on a core with SMT off.**
- **Competitively shared** (whoever asks first): all caches (L1i, L1d, L2, L3), all TLBs, the branch predictor and BTBs, and every execution port. Agner: *"the caches, branch predictors, execution units, and most other resources are shared competitively."*

**When SMT helps and when it hurts.** The rule follows directly from that list. Agner Fog states it exactly: *"the only situations where it is advantageous to run multiple threads in each core are when the performance is limited by memory access, branch mispredictions, or long dependency chains"* — i.e. when thread A is stalled and its ports are idle anyway. Conversely, *"simultaneous multithreading is not advantageous if a shared resource is a bottleneck… for example instruction decoding or cache."*

So:

- **Helps**: pointer-chasing, branchy code, database and web-serving workloads, anything latency-bound.
- **Hurts**: well-optimised HPC and numerical kernels that already saturate the FP ports and whose working set already exactly fills L2 — a second thread halves the effective cache per thread and wins nothing on ports. This is why supercomputing sites routinely disable SMT, and why `OMP_NUM_THREADS` is usually set to the *physical* core count.

Two more practical points:

- **It corrupts your measurements.** Agner: a mass of low-priority threads *"can easily consume most of the CPU resources so that high priority threads are running at a quarter of the possible speed. Current operating systems are not good at preventing this problem."* Benchmark on a machine with SMT off, or pin to one logical CPU per physical core.
- **Security.** Because the two threads share caches, TLBs and predictors, they can observe each other. L1TF (2018) and the MDS family (2019) were exploitable across hyperthread siblings, and several cloud providers and OpenBSD responded by disabling SMT outright. This remains a live reason to turn it off in multi-tenant environments.

**SMT width.** x86 stopped at SMT2. IBM POWER goes to **SMT8** (POWER8/9/10), which is coherent for a design targeting many-threaded commercial workloads on a very wide core with a lot of latency to hide. And Intel has now gone the other way: **Lion Cove (Lunar Lake / Arrow Lake, 2024) removed hyper-threading entirely** from the P-core, on the argument that in a hybrid part the transistors are better spent on additional E-cores. AMD retains SMT2 throughout Zen 1–5.

Sources: [Agner Fog, *The Microarchitecture of Intel, AMD and VIA CPUs*](https://www.agner.org/optimize/microarchitecture.pdf) §§18.11, 22.19, 25.19 · [C&C: Lion Cove](https://chipsandcheese.com/p/lion-cove-intels-p-core-roars)

---

## 3. Real families — what shipped, and what changed

### 3.1 Intel

#### The Core lineage to Skylake

| Year | Core | Node | The one thing that changed |
|---|---|---|---|
| 2006 | Core 2 (Conroe) | 65nm | Ends NetBurst. Wide, short pipeline, 4-wide decode. |
| 2008 | Nehalem | 45nm | Memory controller moves **on-die**; QPI replaces the FSB; SMT returns; inclusive L3 shared across cores. |
| 2011 | Sandy Bridge | 32nm | **Micro-op cache** (1.5K uops), ring bus, AVX, physical register file (moves from the ROB-as-register-file design). |
| 2013 | Haswell | 22nm | AVX2 + FMA3, 4 ALUs, 8 ports, TSX (later disabled by errata). |
| 2015 | **Skylake** | 14nm | 4-wide decode, **224-entry ROB**, 97-entry scheduler, 5-wide allocate/retire. |
| 2016–2020 | Kaby / Coffee / Comet / Rocket Lake | 14nm+…+++ | **Nothing microarchitecturally new on the desktop for five years.** Cores and clocks only. Rocket Lake (2021) is a *backport* of the 10nm Sunny Cove design to 14nm — hence 8 cores max and high power. |

Skylake matters disproportionately because it is the baseline every optimisation guide written between 2015 and 2021 assumes, and because `-march=skylake` / `x86-64-v3` is still a common deployment target.

#### The "Cove" P-cores

| Core | First product | Year | Decode | ROB | L1d | Notes |
|---|---|---|---|---|---|---|
| Sunny Cove | Ice Lake | 2019 | 4-wide | ~352 | 32→**48 KB** | 5-wide allocate; first 10nm to ship in volume; AVX-512 on client |
| Willow Cove | Tiger Lake | 2020 | 4-wide | ~352 | 48 KB | L2 1.25 MB, redesigned cache hierarchy |
| Cypress Cove | Rocket Lake | 2021 | 4-wide | ~352 | 48 KB | 14nm backport of Sunny Cove |
| **Golden Cove** | Alder Lake | 2021 | **6-wide** | **512** | 48 KB / 5 cyc | 4K-entry uop cache, 12 ports, 5 ALUs, 32 B/cyc L1i fetch |
| Raptor Cove | Raptor Lake | 2022 | 6-wide | 512 | 48 KB | L2 grows to 2 MB; L2 latency 16 cyc (one worse than Golden Cove's 15) |
| Redwood Cove | Meteor Lake | 2023 | 6-wide | 512 | 48 KB | First disaggregated tile design (Foveros) |
| **Lion Cove** | Lunar/Arrow Lake | 2024 | **8-wide** | +12.5% | 48 KB "L0" | **Hyper-Threading removed.** 18 ports. New L0/L1/L2 naming: 48 KB L0 @ 4 cyc, **192 KB "L1" @ 9 cyc**, 2.5–3 MB L2. Split integer and FP schedulers. |
| Cougar Cove | Panther Lake | 2026 | 8-wide | — | — | Intel 18A. Better memory disambiguation, larger TLBs, improved multi-level branch predictor. |

Two details worth teaching:

- **Golden Cove raised L1d latency from 4 to 5 cycles** when it grew the cache from 32 KB to 48 KB. That is the capacity/latency tradeoff made visible in a shipping product. Lion Cove got back to 4 cycles by making 48 KB an *L0* and inserting a new 192 KB 9-cycle level above it — a genuinely new cache level in a mainstream x86 core.
- **Lion Cove dropped SMT.** Intel's argument was that in a hybrid part the area spent on SMT is better spent on more E-cores. This is the first mainstream x86 P-core without hyper-threading since Nehalem reintroduced it.

#### E-cores (the Atom lineage)

| Core | Product | Decode | ROB | Notes |
|---|---|---|---|---|
| Tremont | Lakefield | 2×3-wide clustered | ~208 | First clustered decode |
| Gracemont | Alder Lake | 2×3-wide | 256 | ~Skylake IPC at a fraction of the area |
| Crestmont | Meteor Lake | 2×3-wide | 256 | |
| **Skymont** | Lunar/Arrow Lake | **3×3-wide = 9/cyc** | **416** | 8 ALU ports, 7 AGUs, 4 MB L2 @ 19 cyc, 48 KB L1d @ 4 cyc. 8-wide rename. +15.7% SPEC FP vs Crestmont |
| Darkmont | Panther Lake | wider Skymont | — | |

Clustered decode is the interesting idea: rather than build one very wide x86 decoder (hard, because instructions are variable-length so you cannot find instruction boundaries in parallel), build *three narrow decoders* and give each a different branch-delimited region of the instruction stream. Skymont reaches 9 instructions/cycle of decode without a micro-op cache at all. AMD used the same trick in Zen 5 (two 4-wide clusters), and it is the current answer to x86's oldest front-end problem.

#### The hybrid P/E design, and what it does to schedulers

Alder Lake (2021) was the first mainstream x86 part with two different core types on one die. The consequences a programmer actually hits:

1. **The ISA had to be made uniform, by subtraction.** P-cores had AVX-512; Gracemont E-cores did not. Because a thread can migrate between them and `CPUID` must not change under a running thread, Intel **fused AVX-512 off on the P-cores** on consumer Alder Lake. This is the single clearest lesson in the whole report about why ISA fragmentation is expensive: a feature present in the silicon of every P-core shipped was made permanently unreachable because a *different* core on the same die lacked it. AVX10 exists largely to prevent a repeat.
2. **Thread Director** — marketing name for Intel's **Enhanced Hardware Feedback Interface** — is a hardware telemetry block that classifies running threads by their observed execution characteristics into a table the OS polls (roughly every 30 ms), folding in non-CPU signals such as whether a process's window is in the foreground. It **degrades gracefully**: it still functions, to a lesser extent, with little or no OS cooperation. Windows 11 consumes it; Windows 10 largely did not, which is why early Alder Lake reviews showed erratic results. Linux support merged in 5.18 but needs userspace hints to be worth much. *[Several Intel primary whitepaper URLs for this are now dead; the description rests on secondary sources.]*

   The contrast with Apple (§3.3) is the useful frame: **Apple's QoS scheme costs zero silicon and is entirely predictable, but is only as good as the programmer's labels. Thread Director needs no application cooperation and corrects for what the programmer never anticipated — a thread that starts memory-bound and turns compute-bound — but costs real area and power and deep, version-specific OS integration.**
3. **Benchmark noise becomes structural.** The same thread run twice can land on cores with different clocks, different L2 (E-cores share one L2 per cluster of 4; P-cores have a private L2), and different IPC. Any measurement on a hybrid part without `taskset`/`sched_setaffinity` pinning is measuring the scheduler, not the code.
4. Early Alder Lake broke some DRM and anti-cheat systems that fingerprinted the machine by core topology or timing.

#### Current parts (as of Sept 2026)

- **Client**: Core Ultra 200V (Lunar Lake, Lion Cove + Skymont, on-package LPDDR5X), Core Ultra 200S (Arrow Lake desktop), **Core Ultra 300 / Panther Lake — launched at CES January 2026** on Intel 18A (RibbonFET + PowerVia backside power), up to 16 cores, Cougar Cove P-cores + Darkmont E-cores, Xe3 graphics. U-series 15 W first; 28 W H-series rolling out through Q2–Q3 2026.
- **Server**: **Xeon 6** — Granite Rapids (P-cores, up to 128 cores, 12 memory channels, MRDIMM support) and Sierra Forest (E-cores, density). Xeon 600 series brings Granite Rapids to workstations (up to 86 cores, 128 PCIe 5.0 lanes).
- **Announced, not shipping**: **Diamond Rapids (Xeon 7)**, disclosed at Hot Chips on 24 August 2026, launching 2027 on 18A-P: up to **256 P-cores**, 1.28 GB of last-level cache, 16 memory channels at up to 12,800 MT/s MRDIMM (~1,638 GB/s theoretical vs Granite Rapids' ~845 GB/s), PCIe 6.0, UCIe-S instead of EMIB. **This is the first silicon to carry both APX and AVX10.2-512.**

Sources: [C&C Golden Cove](https://chipsandcheese.com/p/popping-the-hood-on-golden-cove) · [C&C Golden Cove caches](https://chipsandcheese.com/2022/02/11/going-armchair-quarterback-on-golden-coves-caches/) · [C&C Lion Cove](https://chipsandcheese.com/p/lion-cove-intels-p-core-roars) · [C&C Skymont](https://chipsandcheese.com/p/skymont-intels-e-cores-reach-for-the-sky) · [C&C Raptor Lake L2](https://chipsandcheese.com/p/a-preview-of-raptor-lakes-improved-l2-caches) · [Panther Lake (Wikipedia)](https://en.wikipedia.org/wiki/Panther_Lake_(microprocessor)) · [igor'sLAB Panther Lake CES 2026](https://www.igorslab.de/en/intel-panther-lake-core-ultra-300-launches-worldwide-for-ces-2026-with-18a-and-xe3-in-position/) · [Tom's Hardware Diamond Rapids](https://www.tomshardware.com/pc-components/cpus/intel-xeon-7-diamond-rapids-comes-with-up-to-256-p-cores-1-28-gb-of-last-level-cache-next-gen-18a-p-cpu-also-brings-avx-10-2-and-uses-ucie-s-instead-of-emib) · [ServeTheHome Diamond Rapids at Hot Chips 2026](https://www.servethehome.com/intel-diamond-rapids-the-2027-intel-xeon-at-hot-chips-2026/) · [Phoronix: Xeon 6 MRDIMM scaling](https://www.phoronix.com/review/intel-xeon-mrdimm-scaling)

---

### 3.2 AMD

#### Zen 1 → Zen 6

| Gen | Year | Node | Decode | ROB | The change that mattered |
|---|---|---|---|---|---|
| Zen 1 | 2017 | GF 14nm | 4-wide | 192 | Competitive x86 core again. CCX of 4 cores + 8 MB L3. **Infinity Fabric** debuts. |
| Zen+ | 2018 | GF 12nm | 4-wide | 192 | Cache latency tuning, clocks |
| Zen 2 | 2019 | TSMC 7nm | 4-wide | 224 | **Chiplets**: compute CCDs on 7nm + a separate I/O die on 12nm. 4K op cache. 256-bit FPU datapath. |
| Zen 3 | 2020 | 7nm | 4-wide | 256 | **Unified 8-core CCX with 32 MB L3** — halves the "which core am I on" problem inside a CCD. ~19% IPC. |
| Zen 4 | 2022 | 5nm | 4-wide | **320** | AVX-512 (double-pumped), 6.75K op cache, L1 BTB 3072 / L2 BTB 8192 entries, AM5 + DDR5 |
| Zen 5 | 2024 | 4nm | **2×4-wide clustered** | 448 | Full **512-bit** FP datapath on desktop/server; 48 KB L1d with 2×512-bit loads/cycle; store queue 64→104; L1 BTB 16K entries; FP add latency 3→2 cycles |
| Zen 6 | 2026 | TSMC 2nm | — | — | Launched with **EPYC "Venice"**, up to **256 cores**, SP7 socket, 16 memory channels (~1.6 TB/s), PCIe 6.0. Desktop ("Olympic Ridge", Ryzen 10000) expected late 2026 / early 2027. |

Zen 4c and Zen 5c are **density-optimised, ISA-identical** variants: same instruction set, smaller L3 slice, lower clock ceiling. They exist so a server part can have 128–192 cores. Critically, unlike Intel's hybrid, **there is no ISA asymmetry** — a thread can migrate between a Zen 5 and a Zen 5c core with no CPUID change.

#### Chiplets, CCDs, and Infinity Fabric

The vocabulary, because it is used inconsistently everywhere:

- **CCX** (Core Complex): a group of cores sharing an L3 slice. 4 cores on Zen 1–2, **8 cores** from Zen 3.
- **CCD** (Core Complex Die): the physical compute chiplet. One CCX on Zen 3+; two on Zen 2.
- **IOD** (I/O Die): holds the memory controllers, PCIe, and the fabric. All DRAM traffic from every CCD goes through it.
- **Infinity Fabric**: the interconnect. `FCLK` (fabric), `UCLK` (memory controller) and `MCLK` (memory) are separately clocked; the well-known tuning rule is to keep UCLK:MCLK at 1:1, because a 2:1 divider adds real latency.

The consequence for programmers: **a single-socket AMD desktop chip has NUMA-like behaviour.** Two threads on the same CCD share an L3 and talk fast. Two threads on different CCDs must go out through the IOD.

Measured core-to-core latency on Ryzen 9 9950X (2 CCDs):

| Path | Latency |
|---|---|
| Within a CCX/CCD | fast cache-to-cache transfer (tens of ns) |
| Cross-CCD, launch firmware | ~180 ns average, >200 ns worst case |
| Cross-CCD, after AGESA 1.2.0.2 microcode fix | **~75 ns** |
| 7950X (Zen 4) cross-CCD, for reference | ~76 ns |

That launch-day Zen 5 regression is a good teaching artefact in itself: cross-cluster latency "wasn't far off from cross-socket latencies on a server platform" until a firmware fix cut it by 58%. A producer/consumer queue whose two threads landed on different CCDs would have measured 2.4× worse than the same code with `taskset` pinning.

#### 3D V-Cache

AMD stacks an extra L3 die on top of (Zen 3/Zen 4) or **underneath** (Zen 5) the compute die, using TSMC's hybrid bonding. 32 MB base L3 + 64 MB stacked = **96 MB L3 per CCD**.

| Part | Year | Note |
|---|---|---|
| 5800X3D | 2022 | First. Cache on top → thermally constrained, lower clocks, no overclocking |
| 7800X3D / 7950X3D | 2023 | Same thermal compromise |
| **9800X3D / 9950X3D** | 2024 | Cache die moved **below** the compute die → the cores are on top, next to the heatspreader. Full clocks *and* the cache. Overclockable. |
| EPYC Milan-X / Genoa-X / Turin-X | 2022– | Server versions |

Measured 9800X3D vs 9700X (same 8 Zen 5 cores, the cache is the only difference):

| Workload | Uplift |
|---|---|
| 1080p gaming, average | ~11% |
| Star Wars Jedi: Survivor | ~45% |
| Flight Simulator 2020 | ~40% |
| Corona render benchmark | ~20% |
| Adobe Premiere Pro | ~11% |
| Most well-blocked HPC / streaming workloads | ~0% |

**Why the spread is the lesson.** 3D V-Cache does exactly one thing: it moves the working-set cliff from ~32 MB to ~96 MB. A workload whose hot set was 40 MB goes from streaming out to DRAM every iteration to living in L3, and picks up 40%. A workload whose hot set is 4 MB, or 4 GB, sees nothing — in one case it already fit, in the other it still doesn't. This is the single most legible real-world demonstration that **cache capacity is a step function, not a dial**, and it is why measuring your working set is worth more than most micro-optimisation.

The **dual-CCD asymmetry** (7950X3D, 9950X3D) is a scheduling hazard: only *one* of the two CCDs carries the stacked cache. The other has higher clocks. AMD ships a chipset driver that cooperates with the Windows Xbox Game Bar to guess whether the foreground process is a game and park the wrong CCD accordingly. On Linux you pin by hand. A benchmark that ignores this can differ by 30%+ run to run.

#### EPYC

| Gen | Codename | Cores | Notes |
|---|---|---|---|
| 1st | Naples | 32 | Zen 1, 4 dies, genuinely NUMA within a socket |
| 2nd | Rome | 64 | Zen 2, central IOD |
| 3rd | Milan | 64 | Zen 3, unified 8-core CCX |
| 4th | Genoa | 96 | Zen 4, 12 channel DDR5, SP5 |
| 4th | Bergamo | 128 | Zen 4c |
| 5th | Turin | 128 (Zen 5) / 192 (Zen 5c) | |
| 6th | **Venice** | **up to 256** | Zen 6, TSMC 2nm, SP7, 16 channels, PCIe 6.0 |

Sources: [C&C Zen 4 frontend](https://chipsandcheese.com/p/amds-zen-4-part-1-frontend-and-execution-engine) · [C&C Zen 4 memory](https://chipsandcheese.com/p/amds-zen-4-part-2-memory-subsystem-and-conclusion) · [C&C Ryzen 9950X / Zen 5](https://chipsandcheese.com/p/amds-ryzen-9950x-zen-5-on-desktop) · [Tom's Hardware: AGESA 1.2.0.2 cross-CCD fix](https://www.tomshardware.com/pc-components/cpus/amd-microcode-improves-cross-ccd-latency-on-ryzen-9000-cpus-ryzen-9-9900x-and-ryzen-9-9950x-cross-ccd-latency-cut-in-half-to-match-previous-gen-models) · [TechSpot 9800X3D review](https://www.techspot.com/review/2915-amd-ryzen-7-9800x3d/) · [Tom's Hardware 9800X3D review](https://www.tomshardware.com/pc-components/cpus/amd-ryzen-7-9800x3d-review-devastating-gaming-performance) · [videocardz: Zen 6 / EPYC Venice launch](https://videocardz.com/newz/amd-confirms-zen-6-launches-in-less-than-two-weeks-starting-with-epyc-venice) · [Tom's Hardware AMD enterprise roadmap](https://www.tomshardware.com/pc-components/cpus/amds-enterprise-cpu-and-gpu-roadmap-venice-verano-zen-6-helios-and-cdna)

### 3.3 Apple Silicon

#### The lineup

| Chip | Released | Node | P-cores | E-cores | Memory bandwidth | NPU |
|---|---|---|---|---|---|---|
| **M1** | Nov 2020 | TSMC N5 | 4 (**Firestorm**) | 4 (**Icestorm**) | 68.25 GB/s | 11 TOPS |
| M1 Pro | Oct 2021 | N5 | 6–8 | 2 | 200 GB/s | 16-core |
| M1 Max | Oct 2021 | N5 | 8 | 2 | 400 GB/s | 16-core |
| M1 Ultra | Mar 2022 | N5 (2 dies, UltraFusion) | 16 | 4 | 800 GB/s | 32-core |
| M2 | Jun 2022 | N5P | 4 (Avalanche) | 4 (Blizzard) | 100 GB/s | 15.8 TOPS |
| M2 Pro / Max / Ultra | Jan 2023 / Jun 2023 | N5P | 6–8 / 8 / 16 | 4 / 4 / 8 | 200 / 400 / 800 GB/s | |
| M3 family | Oct 2023 | **N3B** | 4–16 | 4–8 | 100–800 GB/s | 18 TOPS |
| **M4** | May 2024 | **N3E** | 3–4 | 4–6 | 120 GB/s | **38 TOPS** |
| M4 Pro | Nov 2024 | N3E | 8–10 | 4 | 273 GB/s | 38 TOPS |
| M4 Max | Nov 2024 | N3E | 10–12 | 4 | 410–546 GB/s | 38 TOPS |
| **M5** | **Oct 15, 2025** | TSMC 3rd-gen 3nm | — | — | 153.6 GB/s | **42 TOPS** |
| **M5 Pro / Max / Ultra** | **Mar 3, 2026** | 3rd-gen 3nm | — | — | 307 / 460–614 / **1,228.8** GB/s | *(none published)* |

**Yes, M5 exists.** The base M5 shipped 15 October 2025 (iPad Pro, 14" MacBook Pro, Vision Pro); M5 Pro, Max and Ultra followed on 3 March 2026, with the Ultra reaching **512 GB of unified memory at ~1.23 TB/s**. The M5 generation also adds a **Neural Accelerator inside every GPU core** and Memory Integrity Enforcement built on ARM's Enhanced MTE. The M5 generation also **renames the core tiers**: Apple now markets "super cores" alongside "performance cores", and the high-end M5 parts drop the efficiency-core tier from the marketing entirely. *[The per-variant core splits for M5 are reported inconsistently and are **unverified**; the release dates, memory bandwidths and node are solid.]*

**A caveat on the NPU column that a curriculum should carry.** Apple's TOPS figures *are* internally consistent — M1 Ultra is exactly 2× M1 (32 cores/22 TOPS vs 16/11), and Apple's own M4 material does the cross-generation arithmetic ("60× the first Neural Engine in A11", and 0.6 × 60 ≈ 38). So they are one unit, not a silent unit switch. But they are unaudited, methodology-free, and **not uniformly published**: Apple never quoted a figure for A13; the widely-cited **35 TOPS for A17 Pro and A18 appears only in keynote slides and is absent from Apple's written press releases**; and for **M5 Apple publishes no ANE number at all**, having moved its headline AI metric to the GPU's per-core Neural Accelerators ("over 4× peak GPU compute for AI vs M4"). Cite them as vendor marketing figures, consistent but unverifiable.

#### What actually makes Apple's design unusual

This is the part worth teaching, because Apple made four choices no x86 vendor could make.

**1. Very wide decode — 8-wide, in 2020.** Firestorm decodes **8 instructions per cycle** at a time when Skylake did 4 and Golden Cove would do 6. This is not Apple being cleverer; it is **the ISA**. AArch64 instructions are all exactly 4 bytes, so the boundaries of the next 8 instructions are known the instant the bytes arrive — you can decode all of them in parallel with no dependency between decoders. x86 instructions are 1–15 bytes, so finding instruction N+1 requires having decoded instruction N. That single encoding decision is why x86 needed µop caches (Sandy Bridge, 2011) and clustered decode (Tremont/Skymont, Zen 5) to reach widths ARM got for free — and it is the most concrete answer available to "does RISC vs CISC still matter?" **Yes, in exactly one place: the front end.**

**2. An enormous reorder buffer — ~630 entries on Firestorm**, at a time when Skylake had 224 and Golden Cove would have 512. Combined with 8-wide decode, that is a machine designed to keep looking for independent work very far ahead of a stalled load.

**3. Enormous, fast L1 caches — 128 KB L1d at 3 cycles, and 192 KB L1i.** Compare Golden Cove: 48 KB at 5 cycles. Apple has 4× the capacity at lower latency, which looks impossible.

The reason is the **16 KB page size**. L1 caches are virtually-indexed, physically-tagged (VIPT): the set index must be computable from the virtual address *before* translation finishes, which means **the index bits must lie entirely within the page offset**, or the same physical line could land in two different sets. With 4 KB pages the offset is 12 bits, so `sets × line_size ≤ 4096` — with 64-byte lines that is 64 sets, and an 8-way cache tops out at 32 KB. To go bigger, x86 must raise associativity (expensive: more tag comparators, more latency — this is exactly the 48 KB/12-way/5-cycle trade Golden Cove made). **Apple's 16 KB page gives a 14-bit offset**, so the same 8-way structure supports 128 KB with no extra associativity and no extra latency. The huge, fast L1 is a *consequence of the page size*, not of better circuit design.

The costs of 16 KB pages are real and visible: Rosetta and every x86 program assuming 4 KB granularity needs care, `getpagesize()` returns 16384, `mmap` alignment differs, and Asahi Linux must run a 16K-page kernel (which in turn means some Linux distributions' 4K-page binaries can't be used unmodified).

**4. Unified Memory Architecture.** LPDDR sits on the SoC package, and CPU, GPU, Neural Engine and media engines share **one physical address space with coherent caches**. A texture or a tensor is not copied from host to device — there is no host and device. What it buys: zero-copy handoff between CPU and GPU (huge for ML inference and video pipelines), enormous bandwidth for the GPU (up to 1.23 TB/s on M5 Ultra) without a discrete card, and an LLM's weights sitting in "VRAM" up to 512 GB. What it costs: memory is soldered and non-upgradeable, capacity is priced by Apple, and CPU and GPU **contend for the same bandwidth** — a GPU-saturating workload measurably starves the CPU.

**5. Matrix acceleration, twice over — and both at once.** M1–M3 have **AMX**, an undocumented, non-architectural matrix coprocessor with its own register file, reachable only through Apple's Accelerate/BNNS libraries and known publicly only through reverse engineering (Dougall Johnson, corsix). The M4 is **ARMv9.2-A and adds the standard ARM SME** (Scalable Matrix Extension) — **but it did not remove AMX.** The M4 runs *both*, and AMX is still being reverse-engineered on M4 Max hardware. What Apple has never adopted is **SVE**: no Apple chip, through M5, implements it. So Apple SIMD means NEON, and Apple matmul means AMX (M1–M3), or AMX *and* SME (M4+).

That is worth stating carefully because the usual framing has it backwards: **Qualcomm's Oryon Gen 3 has SVE/SVE2 and Apple has none.** The vendor with the most vertically-integrated silicon is the one declining ARM's standard vector extension, because it already has software targeting its own units.

**6. The Rosetta 2 TSO bit — and why the popular story about it is contested.** Apple's cores have a **hardware toggle (a bit in `ACTLR_EL1`) that switches the core into x86-style Total Store Ordering.** Rosetta 2 sets it for translated processes. Without it, a translator must conservatively fence *every* memory access, because it cannot know which of the original program's accidental-on-x86 orderings the program actually relied on.

Two corrections to the version of this story that circulates:

- **TSO mode is not an Apple invention or an Apple exclusive.** NVIDIA's Denver and Carmel cores and Fujitsu's A64FX have equivalent facilities. Apple was not the only vendor to conclude the x86 memory model was worth a bit in a system register.
- **"Rosetta 2 is fast *because of* TSO" is contested on the record** — at least one engineer who has worked on Windows-on-ARM emulation argues the TSO bit is a "red herring" and that Rosetta's advantage comes overwhelmingly from ahead-of-time translation and other hardware assists (see below). Treat the TSO bit as *evidence that the memory-model gap is real and expensive*, which is the §2.8 point, and **not** as a proven single cause of Rosetta's performance.

Rosetta's other, less-discussed hardware assist is more clearly load-bearing: Apple's cores implement x86's **parity and auxiliary-carry flags** natively. Emulating PF/AF in software costs roughly **5× the instructions** of the plain subtract that sets them. And that assist is **unavailable inside a Linux VM on Apple Silicon**, because a guest cannot touch the host's `ACTLR_EL1` — which is a satisfying, concrete answer to "why is Rosetta slower in a VM than natively?" (See §4.2, optional exercise.)

Rosetta's design is otherwise worth one paragraph because it is a good systems story: it is **ahead-of-time**, not JIT. It translates the binary's entire text segment up front and caches the result in `/var/db/oah/`, so each x86 instruction is translated exactly once. Dougall Johnson's framing: *"Other interpreters typically translate code in execution order, which can allow faster startup times, but doesn't preserve code locality."* The cost is a slower first run and about **1.64× instruction-count expansion**; the payoff is I-cache locality that a translate-per-branch JIT cannot match. *[The often-quoted "70–80% of native" figure could **not** be verified — the AnandTech section it traces to is not recoverable. Attributable instead: Howard Oakley finds performance "comparable in most cases with that on an equivalent Intel Mac, sometimes even better," and Johnson notes that for at least one real application there "isn't much of a speedup going from Rosetta 2 to native ARM."]* Apple has announced Rosetta's deprecation in macOS 27.

**Other properties**: no SMT anywhere in the line; 64-byte L1 lines but **128-byte L2/SLC lines** (hence macOS `sysctl` reporting 128 for the cache line size while `CTR_EL0` reports 64); P/E core selection is driven by **macOS QoS classes** (`pthread_set_qos_class_self_np`; six classes from `userInteractive` down to `background`) rather than by a hardware hinting block — the opposite of Intel's Thread Director, and much more explicit for the programmer.

But it is a **preference, not a pin.** Apple's own wording is that the system is *"more likely"* to run background work on the efficiency cores. Howard Oakley's controlled measurement of one compression task shows how strong the preference is in practice — **QoS 33 (`userInteractive`): 7.4 seconds; QoS 9 (`background`): 114.7 seconds. Over 15×.** His caveat matters as much as the number: *"That isn't guaranteed, and there are circumstances when all threads are allocated to E cores alone, for example when a laptop's battery is very low."* And the obvious trap: a single-threaded tool crawls at any QoS, because QoS is a placement hint, not a speed dial.

Sources: [Apple silicon (Wikipedia)](https://en.wikipedia.org/wiki/Apple_silicon) · [Apple M4 (Wikipedia)](https://en.wikipedia.org/wiki/Apple_M4) · [Apple M5 (Wikipedia)](https://en.wikipedia.org/wiki/Apple_M5) · [7-cpu: Apple M1](https://www.7-cpu.com/cpu/Apple_M1.html) · [C&C: Golden Cove's caches (M1 Max comparison)](https://chipsandcheese.com/2022/02/11/going-armchair-quarterback-on-golden-coves-caches/) · [corsix, Apple AMX documentation](https://github.com/corsix/amx) · [Asahi Linux](https://asahilinux.org/docs/) · [Eclectic Light: Command tools, threads and QoS](https://eclecticlight.co/2025/09/10/command-tools-threads-and-qos/) · [Eclectic Light: Explainer — Rosetta 2](https://eclecticlight.co/2022/12/10/explainer-rosetta-2/) · [Koh Nakagawa, Project Champollion](https://ffri.github.io/ProjectChampollion/) · [Apple, Deploying Transformers on the Apple Neural Engine](https://machinelearning.apple.com/research/apple-neural-engine)

### 3.4 ARM in the server room

#### AWS Graviton

| Gen | GA | Core | Cores | Clock | Memory | SVE |
|---|---|---|---|---|---|---|
| Graviton 1 | Nov 2018 | Cortex-A72 | 16 | 2.3 GHz | — | no |
| **Graviton 2** | Dec 2019 | **Neoverse N1** | 64 | 2.5 GHz | 8ch DDR4 | no |
| **Graviton 3** | May 2022 | **Neoverse V1** | 64 | 2.6 GHz | 8ch DDR5 | **yes, 2×256-bit** |
| Graviton 3E | Nov 2022 | Neoverse V1 | 64 | 2.6 GHz | 8ch DDR5 | yes |
| **Graviton 4** | Jul 2024 | **Neoverse V2** | **96** | 2.8 GHz | **12ch DDR5** | yes (SVE2) |
| **Graviton 5** | **Jun 2026** | **Neoverse V3** | **192** | 3.3 GHz | 12ch DDR5 | yes (SVE2) |

Graviton 5 is on a 3 nm process, supports PCIe Gen 6, and has **more than 5× the L3 cache of Graviton 4**, for a claimed ~25% compute uplift over Graviton 4 (which itself claimed ~30% over Graviton 3). Graviton 2's headline was 7× Graviton 1 with 4× the cores.

The reason Graviton matters to a curriculum has nothing to do with the specs: **it is why a working server-side programmer will meet AArch64 whether or not they intended to.** Graviton instances are the default cheap tier on AWS, and the standard migration story is "it just recompiled" — right up until the first missing-barrier bug from §2.8.

#### Ampere

- **Altra** (2020): 80 Neoverse N1 cores.
- **Altra Max** (2021): 128 N1 cores.
- **AmpereOne** (2023–24): up to 192 cores, on Ampere's own custom core rather than ARM's Neoverse IP, with AmpereOne M/MX variants following. Ampere was **acquired by SoftBank** (announced 2025). *[2026 product status **unverified**.]*

Ampere is the merchant-silicon ARM server vendor — you can buy an Altra workstation, which makes it the practical way to have an AArch64 dev machine that is not a Mac.

#### NVIDIA Grace

**72 Neoverse V2 cores** with LPDDR5X on-package (~500 GB/s), designed almost entirely to be the CPU half of an accelerator node: **NVLink-C2C at 900 GB/s** joins it to a Hopper or Blackwell GPU with cache coherence, so the GPU can address CPU memory directly. Shipping as **GH200 (Grace Hopper)** and **GB200/GB300 (Grace Blackwell)** superchips. Successor CPU **"Vera"** (for Vera Rubin) announced. *[Vera's shipping status as of Sept 2026 **unverified**.]*

Grace is the cleanest illustration of why ARM won the accelerator-host role: **on-package LPDDR gives more bandwidth per watt than DDR DIMMs**, and NVIDIA needed a CPU it could bolt to a GPU on its own terms.

#### Neoverse

ARM's server core IP, in two lines: **N** (efficiency/density — N1, N2, N3) and **V** (performance — V1, V2, V3). Sold increasingly as **CSS** (Compute Subsystem) — a pre-integrated cluster + interconnect + memory controllers, so a hyperscaler can tape out a server chip without building the uncore. Graviton 2/3/4/5 are N1/V1/V2/V3; Grace is V2; Microsoft Cobalt and Google Axion are Neoverse-based.

### 3.5 Qualcomm Oryon, briefly

Qualcomm acquired **Nuvia** in 2021 — a startup founded by ex-Apple silicon architects (Gerard Williams III, who led Apple's CPU designs) which had been building a server core codenamed Phoenix. ARM sued over whether Nuvia's architecture licence transferred. The case went to trial in **December 2024**, the jury found substantially for Qualcomm, and a **final judgment followed in September 2025**, leaving the Oryon products free to ship.

**Oryon** is the resulting core. Shipping in:

- **Snapdragon X Elite / X Plus** (2024) — the Windows-on-ARM laptop parts: up to 12 Oryon cores, **no SMT and no little cores** (all 12 are the same big core, unusual for ARM), with a large L2 per cluster.
- **Snapdragon 8 Elite** (Oct 2024) — Oryon in phones, replacing the Cortex-X/A configuration Qualcomm had used for a decade.
- **Snapdragon X2 Elite** and **8 Elite Gen 5** — **Oryon Gen 3**.

Measured branch misprediction penalty on Oryon Gen 1 is **13 cycles**, the same as Zen 4's common case.

Two things here invert the usual framing, and both are worth saying out loud:

- **Oryon Gen 3 implements SVE/SVE2. No Apple chip does.** The vendor with the tightest vertical integration is the one declining ARM's standard vector extension; the vendor competing on the merchant Windows-on-ARM market is the one shipping it. Vertical integration lets you skip a standard; selling into somebody else's ecosystem does not.
- **The popular "Prism is slower than Rosetta because Snapdragon has no TSO bit" story is not established.** It is a reasonable inference — no Qualcomm source asserts a TSO mode exists — but **no primary source states that Qualcomm lacks one**, and an engineer who has worked on Windows-on-ARM emulation has argued on the record that the TSO bit is a "red herring" and that Rosetta's advantage is dominated by ahead-of-time translation and the x86 flag assists (§3.3). Teach the memory-model gap as real and expensive; do not teach a specific causal ranking that the sources do not support. *[Absence of a Snapdragon TSO mode: **unverified**.]*

Sources: [AWS Graviton (Wikipedia)](https://en.wikipedia.org/wiki/AWS_Graviton) · [C&C: Qualcomm's Oryon Core](https://chipsandcheese.com/p/qualcomms-oryon-core-a-long-time-in-the-making) · [NVIDIA Grace CPU Benchmarking Guide](https://nvidia.github.io/grace-cpu-benchmarking-guide/developer/atomics.html)

---

## 4. For a curriculum

### 4.1 Which of these facts change how you write code — ranked

Ranked by *expected value to a working systems programmer*: how often it bites, how badly, and how invisible it is until it does.

**Tier 1 — these change code you write this week**

1. **Memory access pattern beats instruction count.** A DRAM miss is ~200–400 cycles; an `add` is 1. Choosing `std::vector` over `std::list`, struct-of-arrays over array-of-structs, and a linear scan over a pointer-chasing tree is worth more than every micro-optimisation combined. Corollary: the hardware prefetcher understands linear and strided access **and nothing else**.
2. **Unpredictable branches are the cliff you build by accident.** A mispredict is ~13–20 cycles of dead pipeline. A branch that is genuinely 50/50 inside a hot loop costs more than the work in the loop body. Sorting the data, hoisting the branch out, or going branchless (`cmov`, arithmetic masking) are the fixes — and the compiler will often do it for you if the body is short and side-effect-free.
3. **Shared mutable state costs ~15× more when contended.** Uncontended atomic ≈ 7 ns; contended across cores ≈ 110 ns; cross-CCD on a chiplet part adds ~75 ns of pure interconnect on top. Shard your counters. This is a design decision, not a tuning knob.
4. **False sharing is a bug you cannot see in the source.** Two `std::atomic` members in one struct, written by two threads, is a 10×+ slowdown with no data race and no compiler warning. Pad to a cache line — but note the line is 64 B on x86-64, effectively 128 B once Intel's adjacent-line prefetcher is counted, 128 B in Apple's L2, and `hardware_destructive_interference_size` is **64 / 256 / 32** on x86-64 / AArch64 / RISC-V respectively.
5. **x86's memory model hides missing barriers.** `relaxed` where you meant `acquire`/`release` compiles to *identical* x86 machine code and to *different* AArch64 machine code. Your x86 test suite cannot find this class of bug. Use `std::atomic` with explicit orderings, never `volatile`, and cross-compile to AArch64 to look at the emitted `ldar`/`stlr`.

**Tier 2 — these change how you design, and how you benchmark**

6. **The working set is a step function.** 3D V-Cache moves the L3 cliff from 32 MB to 96 MB and produces anywhere from 0% to 45% on the same CPU. Know roughly how big your hot data is relative to L2 and L3; that one number predicts more than any profile percentage.
7. **Heterogeneous cores make naive benchmarking meaningless.** On a hybrid Intel part an E-core sees a 214-cycle last-level cache; a P-core does not. On a chiplet AMD part two threads may be 75 ns apart or 20 ns apart. Pin threads (`taskset`, `sched_setaffinity`) before you measure anything.
8. **SIMD is where the compiler needs help, and the help is portable.** `__restrict`, no loop-carried dependencies, no early exits, and countable trip counts are what let auto-vectorisation fire — and the *same* clean loop then vectorises to SSE, AVX2, AVX-512, NEON, SVE and RVV without you writing intrinsics. Hand-written intrinsics buy the last 20% and cost you every other ISA.
9. **ISA feature levels are a deployment decision.** `-march=native` produces a binary that SIGILLs on the next machine. `x86-64-v2 / v3 / v4` are the useful portable targets; AVX-512 is fragmented enough that runtime dispatch (function multiversioning, `__builtin_cpu_supports`) is the honest answer on x86. On AArch64 the equivalent decision is `-moutline-atomics` vs `-march=armv8.1-a`.
10. **The calling convention is not an implementation detail** once you write assembly, FFI shims, or read a crash dump. x86-64 SysV passes 6 integer args in registers; AArch64 and RISC-V pass 8. The 7th argument of a 9-argument function is a stack load on x86 and a register on both others.

**Tier 3 — know that it exists, reach for it when profiling says so**

11. Huge pages for multi-gigabyte heaps (TLB reach: 6 MB → 3 GB on the same STLB).
12. Store-forwarding stalls from type punning; 4K aliasing between buffers.
13. SMT sharing: two hyperthreads share L1, L2, the ports and the TLBs, so an HPC kernel that already saturates the ports gets *slower* with SMT on.
14. Alignment for SIMD loads, and `alignas` on hot structures.

### 4.2 Machine-checkable exercises

**Backend capabilities — verified live against <https://godbolt.org> during this research:**

- Endpoint `POST https://godbolt.org/api/compiler/{id}/compile`, JSON in, JSON out (as already documented in `x86-64-assembly.md` §6).
- **x86-64 C++ compiles *and executes***: `g152` (GCC 15.2), `clang2110`, etc. — `supportsExecute: true`. Set `"compilerOptions":{"executorRequest":true}` and `"filters":{"execute":true}`; the program's exit status comes back as `code`, stdout as `stdout[].text`. Verified: a C++ program printing to stdout and exiting 0 round-trips correctly.
- **Cross-targets compile but do NOT execute** — `supportsExecute: false` on every one of them. Confirmed IDs: **`arm64g1520`** (ARM64 GCC 15.2), **`armv8-clang2110`**, **`rv64-gcc1520`** (RISC-V 64 GCC 15.2), **`rv64-clang2110`**, `armg1520` (ARM32), `ppc64leg1520` (POWER64LE). There are 88 aarch64, 44 riscv64, 83 arm32 and 58 powerpc C++ compilers available.
- Therefore every exercise below is graded one of two ways: **(a) run it on x86-64 and check the exit status**, or **(b) compile it for two ISAs and pattern-match the emitted assembly.** Both are fully automatable with no human in the loop.
- Useful filters for grading assembly: `{"intel":true,"demangle":true,"directives":true,"commentOnly":true,"labels":true,"trim":true}` strips the noise down to instructions.

---

#### Exercise 1 — The memory-ordering bug that only one ISA can see
*Concept: §2.8. This is the flagship exercise of the whole unit.*

**Task.** You are given the message-passing pattern with `std::memory_order_relaxed` on both the flag store and the flag load. (a) Compile it for x86-64 and for AArch64 and record both outputs. (b) Fix it using the weakest memory orders that make it correct. (c) Compile both versions for both targets again.

**Check.** Four assembly outputs, graded by pattern match:
- x86-64 relaxed vs x86-64 fixed: **must be identical** (the grader diffs them and requires zero differences).
- AArch64 relaxed: must contain `str` for the flag store and `ldr` for the flag load, and must contain **no** `stlr` and **no** `ldar`.
- AArch64 fixed: must contain exactly one `stlr` and at least one `ldar`.

**Why it's the right exercise.** The learner is forced to discover, with their own eyes and an automated grader confirming it, that a real concurrency bug produced *byte-identical* x86 machine code. Nothing else makes "your tests cannot find this" as concrete. Verified working: GCC 15.2 produces exactly this contrast (see §2.8).

---

#### Exercise 2 — Same source, six vector ISAs
*Concept: §1 SIMD lineage, §4.1 point 8.*

**Task.** Write a single `axpy`-style loop (`y[i] = a*x[i] + y[i]`, `__restrict` on both pointers) and compile it, unchanged, at `-O3` for six targets. Report which vector instruction family each produces.

**Check.** The grader compiles once per target and asserts on mnemonics. Verified outputs from GCC 15.2:

| Flags / compiler | Must contain |
|---|---|
| `g152 -O2 -march=x86-64-v2` | `mulps`, `addps` (SSE, 128-bit) |
| `g152 -O3 -march=haswell` | `vfmadd213ps`, `vbroadcastss` (AVX2 + FMA, 256-bit) |
| `g152 -O3 -march=x86-64-v4` | `vextracti32x8`, `vmovdqu32`, `vpternlogd` (AVX-512, 512-bit) |
| `arm64g1520 -O3` | `fmla`, `movi` (NEON, fixed 128-bit) |
| `arm64g1520 -O3 -march=armv8-a+sve` | **`whilelo`, `ptrue`, `incw`, `ld1w`, `st1w`** (SVE) |
| `rv64-gcc1520 -O3 -march=rv64gcv` | **`vsetvli`, `vle32.v`, `vfmacc.vv`, `vse32.v`** (RVV) |

**Why it's the right exercise.** The SVE and RVV rows are the payoff. SVE's `whilelo`/`incw` and RVV's `vsetvli` are *vector-length-agnostic* loops — there is no scalar remainder tail, because the loop asks the hardware each iteration how many lanes it has. Seeing that next to AVX-512's fixed-512-bit code with its separate epilogue teaches the single biggest architectural idea in modern SIMD, from one file the learner wrote.

---

#### Exercise 3 — Count the register arguments
*Concept: AArch64 AAPCS64 vs System V AMD64, §1.*

**Task.** Write `long f(long a, ..., long i)` — nine arguments, summed. Compile for x86-64, AArch64 and RISC-V. Before looking, predict how many arguments each ABI passes in registers.

**Check.** The grader counts memory operands reading from the stack in each output. Verified with GCC 15.2 `-O2`: x86-64 emits **three** `QWORD PTR [rsp+...]` loads (6 register args, 3 spilled); AArch64 emits **one** `ldr x1, [sp]` (8 register args); RISC-V emits **one** `ld a5,0(sp)` (8 register args). Pass condition: `{x86: 3, aarch64: 1, riscv: 1}`.

**Why it's the right exercise.** The ABI table in a textbook is inert. A count of stack loads that the learner predicted, and that a grader confirms, is not.

---

#### Exercise 4 — One flag, three atomic implementations
*Concept: §2.7, LL/SC vs LSE.*

**Task.** Compile a single `std::atomic<int>::fetch_add` for AArch64 three times: with GCC's default flags, with `-march=armv8.1-a`, and with `-march=armv8-a -mno-outline-atomics`. Explain what each output is and which you would ship.

**Check.** Verified with `arm64g1520 -O2`:
- default → must contain `bl __aarch64_ldadd4_` (runtime dispatch)
- `-march=armv8.1-a` → must contain `ldadd` and **no** `bl`, **no** `stxr`
- `-mno-outline-atomics` → must contain `ldxr` **and** `stxr` **and** a backward `cbnz` (the retry loop)

**Why it's the right exercise.** It is the only place in the curriculum where the learner sees a *retry loop* generated for what looks like one operation, and understands viscerally why ARMv8.1 LSE existed. The `bl` in the default output also teaches that "the compiler's default" is often a portability compromise with a real cost.

---

#### Exercise 5 — Padding is not portable
*Concept: §2.7 false sharing.*

**Task.** Emit `std::hardware_destructive_interference_size` as a compile-time constant into a data section (`const std::size_t D = std::hardware_destructive_interference_size;`) and compile for x86-64, AArch64 and RISC-V. Then write a padded counter struct and `static_assert` that `sizeof` it is a multiple of that constant on all three.

**Check.** Verified with GCC 15.2 `-O2 -std=c++20 -Wno-interference-size`. The emitted data must be:

| Target | Value |
|---|---|
| `g152` | `.quad 64` |
| `arm64g1520` | `.xword 256` |
| `rv64-gcc1520` | `.dword 32` |

Grader asserts the three integers are `64`, `256`, `32`.

**Why it's the right exercise.** A learner who has just been told "pad to 64 bytes" gets a three-line program that proves the number is not 64 everywhere — and the `-Winterference-size` warning they must silence tells them *why* the standard library is nervous about it. Two minutes, permanently memorable.

---

#### Exercise 6 — Make the branch predictor visible (runnable, x86-64)
*Concept: §2 branch prediction.*

**Task.** Fill a 32K-element `int` array with pseudo-random values in `[0,256)` using a fixed seed. Time a loop that sums only elements `>= 128`, once on the unsorted array and once after `std::sort`. Print the ratio. Then rewrite the loop branchlessly (`int t = (a[i]-128)>>31; s += ~t & a[i];`) and time that too.

**Reference figures to grade against.** The original Stack Overflow question measured **11.54 s unsorted vs 1.93 s sorted** (~6×) on exactly this shape — 32768 ints of `rand()%256`, 100000 outer iterations. The accepted answer's four-way table on a Core i7 920 is the one to show the learner *after* they run it:

| | Branchy | Branchless |
|---|---|---|
| Random | 11.777 s | **2.564 s** |
| Sorted | 2.352 s | **2.587 s** |

**Check.** Runs natively on `g152` with `executorRequest`. Grade on the **exit status encoding a bucketed answer**: exit with `1` if sorted was faster than unsorted by more than 1.3×, `0` otherwise — and separately assert on the emitted assembly that the branchless version contains **no** conditional jump inside the loop body (or contains `cmov`). Verified: at `-O2 -march=x86-64-v2` GCC already emits `cmovg` for the naive version, which is itself the lesson — so the exercise must use `-O1` or a body the compiler cannot speculate, and the learner must *explain* why `-O2` erased the effect.

**Why it's the right exercise.** It is the famous sorted-array StackOverflow question, but with the twist that a modern compiler defeats it. The learner has to discover that the compiler already went branchless, which teaches both the mispredict cost *and* that `cmov` is the fix — in one experiment. This is one of the few exercises where the runnable x86 backend earns its keep.

---

#### Exercise 7 — Find the cache cliff (runnable, x86-64)
*Concept: §2.4.*

**Task.** Pointer-chase a randomly permuted cyclic linked list of `N` 64-byte nodes, for N from 1 KB up to 64 MB of working set, timing nanoseconds per hop. Print the table.

**Check.** Runnable on `g152 -O2 -std=c++20` with `executorRequest`. **Verified live during this research** — actual output from the Compiler Explorer executor host:

```
    16 KB    1.51 ns/hop      <- L1d
    64 KB    3.71 ns/hop      <- L2
   256 KB    3.72 ns/hop      <- L2
  1024 KB   13.41 ns/hop      <- L3
  4096 KB   15.51 ns/hop      <- L3
 16384 KB  108.04 ns/hop      <- DRAM
 65536 KB  132.79 ns/hop      <- DRAM
```

Grade host-independently: require **ns/hop at 64 MB ≥ 8× ns/hop at 16 KB** (here it is 88×), and require the series to be monotonically non-decreasing. Both hold on every machine. If a tighter grade is wanted, have the program locate its own two largest jumps and encode their log2 sizes in the exit status, accepting a range — the CE executor's host CPU is not pinned, so exact cliff positions vary.

**Why it's the right exercise.** It produces the latency ladder from §2.4 on real silicon rather than from a table, and the random permutation is exactly what defeats the prefetcher — so the learner also discovers, by changing one line to a sequential walk, that the same number of bytes touched becomes almost free.

---

#### Exercise 8 — Prove `volatile` is not a memory barrier
*Concept: §2.8, the `volatile` misconception.*

**Task.** Write three versions of a spin-wait handshake: one with plain `int`, one with `volatile int`, and one with `std::atomic<int>` using acquire/release. Compile all three for x86-64 and AArch64.

**Check.** Assembly pattern match. Verified with GCC 15.2 `-O2`:
- **plain `int`, both targets**: the entire function is `ret`. GCC deleted the loop outright — it proved nothing in the thread can change `p`, and a side-effect-free infinite loop is UB, so it is removable. Grader asserts the function body is exactly one `ret`.
- **`volatile int`, both targets**: the load is back inside the loop — but on AArch64 it is `ldr`, and the grader asserts there is **no `ldar` and no `dmb` anywhere**. `volatile` bought a reload and nothing else.
- **`std::atomic` acquire**: AArch64 must contain `ldar`. (On x86-64 it is the same `mov` as the `volatile` version — which is exactly the §2.8 point again.)

**Why it's the right exercise.** It separates the two things people conflate — "the compiler may cache this in a register" (which `volatile` fixes) and "the hardware may reorder this" (which it does not) — with three assembly listings rather than an argument. And the plain-`int` case collapsing to a bare `ret` is the most alarming three characters in the curriculum: a lesson in how aggressively the optimiser deletes code it believes nothing can change.

---

#### Optional Exercise 9 — Same C++, two ISAs, count the instructions
*Concept: CISC vs RISC, §1.*

**Task.** Compile a small `memcpy`-ish or string-scan function for x86-64 and AArch64 at `-O2`. Count instructions in each. Predict which is longer before looking.

**Check.** Instruction counts within a stated range for each target, plus a required-mnemonic list demonstrating x86's memory-operand ALU forms (`add reg, [mem]`) versus AArch64's mandatory load/op/store separation.

**Why it's the right exercise.** It is the cheapest possible demonstration that "CISC" means *addressing modes and variable length*, not "more powerful instructions" — and it sets up the §2.1 point that the x86 instruction the learner counted becomes 2 micro-ops inside the core anyway.
---

## Appendix A — What could not be verified

Flagged inline as **[unverified]**, collected here:

| Claim | Status |
|---|---|
| Per-variant P-core / E-core counts and core codenames for the **M5 generation** | Sources disagree. Release dates, memory bandwidth and the "super core"/"performance core" renaming are solid; the per-variant splits are not. |
| **Apple ANE TOPS for A17 Pro and A18 (35 TOPS)** | **Keynote slides only** — absent from Apple's written press releases, which say only "up to 2× faster". Apple published no ANE figure for A13 or for M5. Cite all ANE TOPS as unaudited vendor marketing. |
| **Snapdragon has no TSO hardware mode** | Strongly implied by the absence of any Qualcomm statement, but **no primary source asserts it**. A Windows-on-ARM emulation engineer has publicly called the TSO explanation a "red herring". Do not present it as the cause of the Prism/Rosetta gap. |
| **Rosetta 2 at "70–80% of native"** | Could not be verified — the AnandTech section it traces to is not recoverable. Use Oakley ("comparable in most cases with an equivalent Intel Mac, sometimes even better") and Johnson (for at least one real app, little speedup going native) instead of a percentage. |
| **Itanium's x86 hardware emulation ran "at Pentium-100 speed"** | Widely repeated, unverified. That it was "notoriously slow" and was replaced by a software layer, then dropped entirely at Montecito in 2006, **is** sourced. Don't print a number. |
| **Microsoft forced a single 64-bit x86 ABI** | Reported as a rumour by The Register in Oct 2003 (the author was sceptical) and strongly supported by the outcome. The primary account is Kerner & Padgett, *A History of Modern 64-bit Computing* (Microsoft, 2007), now behind a login. Related claim that **Microsoft contributed RIP-relative addressing to AMD64** rests on an uncited secondary retelling — **do not print it**. |
| **Fred Weber's title in Oct 1999** | Sources split between CTO and VP of engineering. Write "ran AMD's CPU engineering and later served as CTO". |
| **Ampere** 2026 product lineup and the state of AmpereOne M/MX post-SoftBank acquisition | Not verified for 2026. |
| **NVIDIA "Vera"** CPU shipping status | Announced; shipping status as of Sept 2026 not verified. |
| **Snapdragon X2 Elite** shipping status | Announced 2025; not verified as shipping. |
| **ARM v. Qualcomm** detailed findings | December 2024 jury verdict substantially for Qualcomm, final judgment September 2025 — both confirmed. The precise findings on each count were not examined. |
| **Pipeline stage counts** for Golden Cove, Redwood Cove, Zen 4/5, Apple Firestorm, Neoverse V2/V3 | Not published by anyone. Only Skylake/Sunny Cove (14–19) and Zen 1/2/3 (19) have figures, and those are WikiChip infoboxes reachable via Wayback. Use measured mispredict penalty as the proxy and say so. |
| **AMD Zen 5 Software Optimization Guide (58455)** | Does not exist at any reachable URL, including the Wayback CDX index. Every first-party Zen 5 number here comes from AMD's Hot Chips 2024 deck. AMD has also stopped serving the Zen 1–4 SOGs from amd.com — those are Wayback-only. |
| **Zen 4 L2 BTB latency** | AMD's SOG says **3 prediction bubbles**; Chips and Cheese measured **1 cycle**. Present both; do not pick one. |
| **Golden Cove RSB depth**; **Ice Lake RSB "24"** | Golden Cove's is unpublished. The commonly-quoted 24 for Ice Lake is unsourced — Agner measures **22**. |
| **Indirect-branch mispredict rates for virtual calls / switch dispatch** | The classic Chang/Hao/Patt (ISCA 1997) and Driesen & Hölzle numbers are behind the ACM DL. **Do not quote the widely-repeated "~24% with a BTB" figure unchecked.** |
| **"Golden Cove has a second MSROM"** | No evidence found. Do not teach it. |
| **Apple M2 / M3 / M4 ROB, decode width, mispredict penalty** | Apple's optimization guide is developer-account-gated; only M1 has solid third-party measurements. |
| **Clang's concrete `likely-branch-weight` constants** (often cited as 2000:1) | Mechanism confirmed (branch-weight metadata, no hint instruction); the constants were not verified in LLVM source. |
| **AMD's rationale for choosing hashed perceptron** | Never published. The storage-scaling argument in §2.3 is inference from Jiménez & Lin, not an AMD statement. |
| **Lion Cove absolute ROB size** | Reported only as "+12.5% over Redwood Cove"; Intel has not published the absolute figure and no measurement was located. |
| **Zen 5 absolute ROB size (448)** | Widely reported, but Chips and Cheese's measurement says only that Zen 5's out-of-order buffer sizes are "quite close to Golden Cove's" (512) without giving a figure. Treat 448 as approximate. |
| **Zen 6 desktop ("Olympic Ridge" / Ryzen 10000)** launch window | Server (EPYC Venice) is confirmed launched; desktop timing is from secondary reporting. |
| **Intel Thread Director mechanism details** | Several Intel primary whitepaper URLs now 404. The uncontested parts (it is the Enhanced Hardware Feedback Interface; ~30 ms OS polling; graceful degradation) rest on secondary sources. |
| Panther Lake's **APX** status | Diamond Rapids is confirmed as carrying APX and AVX10.2-512; Panther Lake is believed not to, but this was not confirmed against a primary source. |
| AVX-512 subset rows for **Emerald Rapids and Granite Rapids** | Not verified; the table stops at Sapphire Rapids on the Intel side. |
| Whether **AArch64 or RISC-V define a red zone** | AAPCS64 confirmed to define **none**. The RISC-V psABI's leaf-function convention was not checked. |
| **EDA / CFD speedups from 3D V-Cache** | AMD markets these; no independent benchmark with numbers was located. Gaming and render figures in §3.2 *are* from independent reviews. |
| Why **GCC reports 256** for `hardware_destructive_interference_size` on AArch64 | The *value* is verified by compilation (§2.7). The rationale — presumably a conservative bound over implementations with 128-byte lines plus prefetch granularity — is inferred, not sourced. |

Two structural caveats that apply to the whole document:

- **Microarchitectural internals are measured, not published.** ROB sizes, BTB entries, scheduler depths and mispredict penalties come from Agner Fog, Chips and Cheese, 7-cpu.com and uops.info running microbenchmarks. They are good to a few percent and specific to the exact part tested. Vendors publish almost none of this.
- **Latency in cycles is not a property of a chip.** It is a property of a chip *at a clock*. Every DRAM figure here should be read in nanoseconds first.

## Appendix B — The reading list, ranked

For a curriculum, in the order a learner should meet them:

1. **[Agner Fog, *The Microarchitecture of Intel, AMD and VIA CPUs*](https://www.agner.org/optimize/microarchitecture.pdf)** — the single most valuable document in this entire area. ~280 pages, free, updated continuously, written from measurement. §3 (branch prediction) is the best explanation of the subject at any price. Its companion **[*Instruction Tables*](https://www.agner.org/optimize/instruction_tables.pdf)** gives per-instruction latency/throughput/port for every x86 microarchitecture.
2. **[Chips and Cheese](https://chipsandcheese.com/)** — the only outlet doing serious independent microarchitecture measurement since AnandTech closed. Every modern core has a deep-dive with measured cache latencies and structure sizes.
3. **[uops.info](https://uops.info/)** — automated, exhaustive per-instruction latency/throughput/port tables. Where you check what an instruction actually costs.
4. **[7-cpu.com](https://www.7-cpu.com/)** — measured cache and TLB latencies in *cycles*, with TLB entry counts. Older parts only, but the methodology is transparent.
5. **[Compiler Explorer](https://godbolt.org)** — the lab bench for every exercise in §4.2.
6. **[Sewell et al., C/C++11 mappings to processors](https://www.cl.cam.ac.uk/~pes20/cpp/cpp0xmappings.html)** (Cambridge) — the normative table of what each `memory_order` compiles to on each ISA.
7. **[Preshing on Programming](https://preshing.com/)** — the best plain-English writing on memory ordering, acquire/release, and lock-free code.
8. **Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?*** and his *Memory Barriers: a Hardware View for Software Hackers* — the kernel-side view, and the source of the litmus-test vocabulary in §2.8.
9. **[Travis Downs, A Concurrency Cost Hierarchy](https://travisdowns.github.io/blog/2020/07/06/concurrency-costs.html)** — the measured cost of sharing, in nanoseconds.
10. **[Ulrich Drepper, *What Every Programmer Should Know About Memory*](https://people.freebsd.org/~lstewart/articles/cpumemory.pdf)** (2007) — dated in its numbers, still unmatched on cache and DRAM *mechanism*. Read it for the physics, not the figures.
11. Primary ISA references: [Intel SDM](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html) (Vol 3A ch. 8 for memory ordering), [AMD64 APM](https://www.amd.com/system/files/TechDocs/40332.pdf), [ARM ARM + AAPCS64](https://github.com/ARM-software/abi-aa), [RISC-V specifications](https://riscv.org/technical/specifications/).
12. **[felixcloutier.com/x86](https://www.felixcloutier.com/x86/)** — already the reference from the assembly unit; still the fastest way to look up an instruction.
