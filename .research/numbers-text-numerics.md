# Numbers and text: data representation and numerical computing

Research notes for a from-first-principles computing curriculum. Compiled 2026-09-01.

**Why this file exists.** The curriculum already has deep coverage of FP8/FP4 block
scaling (`fp4-fp8-blackwell.md`) and of NumPy/PyTorch dtype machinery
(`numpy-pytorch-internals.md`). It had nothing on ordinary integers, ordinary
floating point, or text. That is a roof with no walls: MX block scaling is an
*answer* to a problem — dynamic range and accumulated rounding error — that the
learner has never been shown. This file is the walls.

**Verification policy.** Every executable claim below was run. The runner is the
Compiler Explorer (godbolt.org) HTTP API, which both compiles and *executes* C++
on x86-64 Linux and returns stdout, stderr, exit status and assembly. Each
submission carries a fresh UUID nonce in a leading comment, because CE caches
compile-and-execute results including wall-clock timings; without the nonce a
second run of an identical source returns the *first* run's numbers. Anything I
could not verify is listed in the final section. Assembly is Intel syntax,
x86-64, gcc 15.2 or clang 20.1.0 unless stated.

Primary sources consulted:

- ISO/IEC 9899 (C) working draft **N3220** (C23), read locally — §6.2.5, §6.2.6.2,
  §6.3.1.1, §6.3.1.3, §6.3.1.8, §6.5, Annex F, Annex H.
- IEEE 754-2019, *Standard for Floating-Point Arithmetic* (clause references below;
  see the caveat on paywalled text in the last section).
- David Goldberg, *What Every Computer Scientist Should Know About Floating-Point
  Arithmetic*, ACM Computing Surveys 23(1), 1991.
- Nicholas J. Higham, *Accuracy and Stability of Numerical Algorithms*, 2nd ed.,
  SIAM 2002 — Ch. 4 (Summation), Ch. 1–3 (error analysis).
- Nicholas J. Higham, *The Accuracy of Floating Point Summation*,
  SIAM J. Sci. Comput. 14(4):783–799, 1993.
- Muller et al., *Handbook of Floating-Point Arithmetic*, 2nd ed., Birkhäuser 2018.
- The Unicode Standard 15.1/16.0, Ch. 2–3, and UAX #15 (Normalization),
  UAX #29 (Text Segmentation).
- RFC 3629 (UTF-8), RFC 2781 (UTF-16), RFC 1700/1122 (network byte order).
- GCC and Clang documentation for `-ffast-math`, `-ffp-contract`, `-fwrapv`,
  `-fno-strict-aliasing`.

---

# Part 1 — Integers

## 1.1 Two's complement: one definition, three consequences

An N-bit two's complement integer is defined by one formula:

```
value(b) = -b[N-1] * 2^(N-1)  +  sum over i in [0, N-2] of  b[i] * 2^i
```

That is: the *top bit carries a negative weight*, every other bit carries its
usual positive weight. Nothing else. It is not "sign bit plus magnitude", and it
is not "invert and add one" — invert-and-add-one is a *theorem* about this
definition, not the definition.

For `int8_t`: `0b1000_0000` = −128. `0b1111_1111` = −128+64+32+16+8+4+2+1 = −1.
`0b0111_1111` = +127. The range is `[-2^(N-1), 2^(N-1) - 1]`.

Three consequences fall out, and they are the whole reason every machine built
since the mid-1960s uses this representation rather than sign-magnitude or
ones' complement.

### Consequence 1: subtraction is free, and so is the adder

Work modulo 2^N. Two's complement is just *the residue system mod 2^N with a
different choice of which representatives to call negative*. Unsigned reads the
N bits as residues 0..2^N−1; signed reads them as residues −2^(N−1)..2^(N−1)−1.
Same bits, same ring, different labels on the same equivalence classes.

Addition, subtraction and multiplication are ring operations, so they *commute
with the relabelling*. One `add` instruction is simultaneously correct signed
addition and correct unsigned addition. The hardware does not need to know, and
x86 does not have separate signed and unsigned `add`, `sub` or low-half `mul`
(`imul`'s 2- and 3-operand forms are used for both).

Subtraction reduces to addition: `a - b = a + (~b) + 1`, and the `+1` is free
because the adder already has a carry-in. So a two's-complement ALU is *one*
ripple-carry/carry-lookahead adder plus a row of XOR gates on the second
operand, and a single control line that both inverts `b` and sets carry-in.
This is exactly the ALU built in nand2tetris and in Ben Eater's 8-bit computer
(see `nand2tetris-eater-scott.md`); it is worth teaching the two files together,
because the "why" lives here and the "how" lives there.

Verified — signed and unsigned differ only in *interpretation*, not in the add:

```asm
sub(int, int):            ; a - b, signed
  mov eax, edi
  sub eax, esi
  ret
```

The same `sub` is emitted for `unsigned`.

Where the hardware *does* care is in the **flags**. x86 computes both after
every add/sub:

- **CF** (carry) — the unsigned interpretation overflowed: the true result did
  not fit in `[0, 2^N)`.
- **OF** (overflow) — the signed interpretation overflowed: the true result did
  not fit in `[-2^(N-1), 2^(N-1))`. Computed as `carry-into-MSB XOR carry-out-of-MSB`.

One adder, two overflow verdicts, and the *instruction that consumes them*
(`jb` vs `jl`, `seta` vs `setg`) is what makes the operation signed or unsigned.
Division and right-shift are the exceptions — those genuinely differ, which is
why x86 has both `div`/`idiv` and `shr`/`sar`.

### Consequence 2: exactly one zero

Sign-magnitude and ones' complement both have `+0` and `−0`. That means every
`if (x == 0)` is two comparisons or needs a normalisation step, and it wastes one
of your 2^N codes. Two's complement has a single zero (`0b000...0`) because the
mapping is a bijection onto residues mod 2^N. Which brings us straight to:

### Consequence 3: the range is asymmetric, and `INT_MIN` is the scar

2^N codes, one spent on zero, leaves 2^N − 1 non-zero codes to split between
positive and negative. That is an odd number. It cannot split evenly. Two's
complement gives the extra one to the negatives: `INT_MIN = -2147483648`,
`INT_MAX = 2147483647`, and **`-INT_MIN` is not representable**.

This is not a curiosity. It is a live source of security bugs:

| Expression | What happens |
|---|---|
| `-INT_MIN` | signed overflow → **UB** in C and C++ |
| `abs(INT_MIN)` | UB. C23 N3220, `abs`/`labs`/`imaxabs`: "If the result cannot be represented, the behavior is undefined." |
| `INT_MIN / -1` | UB, and on x86-64 it **traps** |
| `INT_MIN % -1` | mathematically 0, but same `idiv` instruction, same trap |
| `x < 0 ? -x : x` | still UB at `INT_MIN` — the hand-rolled abs is no safer |

Verified, gcc 15.2 `-O2`, x86-64 Linux:

```
about to compute INT_MIN / -1 ...
Program terminated with signal: SIGFPE
```

Exit status 136 = 128 + 8 (SIGFPE). This is not the compiler being clever, it is
the hardware: `idiv` raises **#DE (divide error)** when the quotient does not fit
in the destination register, and `INT_MIN / -1 = 2147483648` does not fit in a
32-bit signed register. The same `idiv` computes both quotient and remainder, so
`INT_MIN % -1` traps too even though its mathematical answer, 0, is perfectly
representable. A "denial of service via integer division" CVE is almost always
this. On AArch64 there is no trap: `SDIV` is defined to return `INT_MIN` for this
input, so the same C program dies on x86 and silently returns a wrong answer on
Arm. Both are UB; neither is portable.

**Safe abs, verified idiom:** cast to the unsigned type first, negate there
(where wraparound is defined), and only then decide.

### Sign extension vs zero extension

Widening a value must preserve its *meaning*, and meaning depends on
signedness. Widening signed replicates the top bit; widening unsigned fills with
zeros. Verified codegen:

```asm
sext(int) -> long:
  movsx rax, edi        ; sign-extend 32->64
  ret
zext(unsigned) -> unsigned long:
  mov eax, edi          ; free: any 32-bit write zeroes bits 63:32 on x86-64
  ret
```

Zero extension to 64 bits is *free* on x86-64 because writing a 32-bit register
implicitly clears the upper half. Sign extension costs a real instruction. That
asymmetry is one small reason `size_t`/`unsigned` indices sometimes generate
tighter loops than `int` ones — and one reason they sometimes generate *worse*
ones (see §1.4).

Verified sign-extension semantics:

```
(int)(int8_t)-1 = -1     (int)(uint8_t)0xFF = 255
```

Same eight bits `0xFF`. Two different 32-bit values. The bits do not carry
their own type; the type is in the instruction that reads them. This is the
single most important idea in the whole file and it recurs at every level: a
byte in memory is not a number until something decides how to read it.

### Signed division is not a shift

A related asymmetry, verified:

```asm
divu_const(unsigned a) -> a / 8:
  mov eax, edi
  shr eax, 3            ; one instruction
  ret

div_const(int a) -> a / 8:
  test edi, edi
  lea eax, [rdi+7]
  cmovns eax, edi       ; if negative, add 7 first
  sar eax, 3
  ret                   ; four instructions
```

C requires integer division to truncate **toward zero** (C23 §6.5.6p6; this was
implementation-defined in C89 and fixed in C99). An arithmetic right shift
truncates toward **negative infinity**. For `-9 / 8`, C demands −1; `-9 >> 3`
gives −2. Hence the `+7` bias correction on negative inputs. Teaching point:
`x / 8` and `x >> 3` are the same operation only for non-negative `x`, and the
compiler knows it even if you don't.

## 1.2 Signed overflow is undefined behaviour — and the optimiser uses it

This is the part that people are told and do not believe until they see it.

C23 N3220 §6.5p5: *"If an exceptional condition occurs during the evaluation of
an expression (that is, if the result is not mathematically defined or not in the
range of representable values for its type), the behavior is undefined."*
Unsigned types are explicitly excluded, because §6.2.5p11 defines unsigned
arithmetic to be modular: *"The range of representable values for the unsigned
type is 0 to 2^N − 1 (inclusive). A computation involving unsigned operands can
never produce an overflow, because arithmetic for the unsigned type is performed
modulo 2^N."*

So the compiler is entitled to assume signed overflow never happens. Watch what
it does with that permission. Source:

```cpp
bool signed_no_overflow(int x)      { return x + 1 > x; }
bool unsigned_wraps(unsigned x)     { return x + 1 > x; }
int  count_signed(int n) { int c = 0; for (int i = 1; i > 0; i *= 2) ++c; return c; }
```

gcc 15.2 `-O2`, verified:

```asm
signed_no_overflow(int):
  mov eax, 1            ; unconditionally true. x is never even read.
  ret

unsigned_wraps(unsigned int):
  cmp edi, -1           ; i.e. compare against UINT_MAX
  setne al              ; true unless x == UINT_MAX
  ret

count_signed(int):
.L5:
  jmp .L5               ; infinite loop. The function has no exit.
```

Three different behaviours from three near-identical sources.

- The signed version folds to `return true` because `x + 1 > x` can only be false
  when `x == INT_MAX`, and that case is UB, so it "cannot happen", so the
  comparison is a tautology.
- The unsigned version compiles to a real runtime test, because wraparound is
  defined and `UINT_MAX + 1 == 0` really is not greater than `UINT_MAX`.
- `count_signed` doubles `i` from 1. In two's complement that eventually reaches
  `0x40000000`, then `0x80000000` = `INT_MIN` < 0, and terminates after 31 trips.
  GCC instead reasons: `i` starts positive, `i *= 2` on a positive int cannot
  overflow (UB), so `i` stays positive, so `i > 0` is invariantly true, so the
  loop never exits — and emits `jmp .L5`, a two-byte infinite loop, and does not
  bother allocating `c` at all.

### The same program, three different answers

Better still, a runnable one:

```cpp
#include <cstdio>
#include <climits>
int __attribute__((noinline)) f(int x) { return x + 1 > x; }
int main() {
    volatile int m = INT_MAX;
    std::printf("INT_MAX+1 > INT_MAX  ->  %d\n", f(m));
    int i = 0, n = 0;
    for (i = INT_MAX - 2; i >= 0; ++i) { if (++n > 10) break; }
    std::printf("loop iterations before break/exit: %d, i=%d\n", n, i);
}
```

Verified on Compiler Explorer, clang 20.1.0, x86-64 Linux, same machine, same run:

| Flags | `INT_MAX+1 > INT_MAX` | loop trips | final `i` |
|---|---|---|---|
| `-O0` | **0** | 3 | −2147483648 |
| `-O2` | **1** | 11 | −2147483641 |
| `-O2 -fwrapv` | **0** | 3 | −2147483648 |

Read that table slowly. At `-O0` clang actually emits the `add` and the `cmp`,
the hardware wraps, and the answer is 0. At `-O2` the constant folder replaces
the comparison with `true` and the answer is 1. `-fwrapv` — which *defines*
signed overflow as wrapping, taking the UB off the table — restores the `-O0`
answer. The loop tells the same story: with wrapping, `i` goes negative after 3
increments and the `i >= 0` test ends the loop; with UB assumed away, the test is
invariantly true and the loop only ends at the `break` on trip 11.

`-O0` is **not** "what the machine really does". It is one more legal choice.
There is no ground truth to appeal to.

### The optimiser can delete your function

gcc 15.2 at `-O2` on the same `main` does something worse. The complete assembly
it emits for `main` is:

```asm
main:
  sub rsp, 24
  mov esi, 1
  mov edi, OFFSET FLAT:.LC0
  mov DWORD PTR [rsp+12], 2147483647
  mov eax, DWORD PTR [rsp+12]
  xor eax, eax
  call printf
```

That is the entire function. There is no `add rsp, 24`, no `ret`, and no second
`printf`. GCC proved the loop cannot terminate normally (same reasoning as
`count_signed`), concluded everything after it is unreachable, deleted it — and
deleted the epilogue and return with it. Execution falls off the end of `main`
into whatever bytes follow. Observed behaviour: the first `printf` repeating
without bound until the sandbox killed it at exit status 143 (SIGTERM).

The lesson is not "compilers are malicious". It is that **UB is not a runtime
event that produces a wrong value; it is a compile-time premise that propagates
backwards and outwards through the whole function.** The corrupted output here
appeared *before* the overflow, on a line that had nothing to do with it.

### What to actually do

| Tool | What it gives you |
|---|---|
| `-fsanitize=signed-integer-overflow` | runtime trap/diagnostic at the exact overflow (UBSan) |
| `-ftrapv` | traps on signed overflow; gcc's implementation is patchy, prefer UBSan |
| `-fwrapv` | *defines* signed overflow as two's-complement wrap; costs you loop optimisations |
| `__builtin_add_overflow(a,b,&r)` | returns `true` on overflow, writes wrapped result; no UB. gcc + clang |
| `std::add_sat` / `std::saturate_cast` | C++26 `<numeric>`; saturating, no UB |
| `ckd_add` / `ckd_sub` / `ckd_mul` | C23 `<stdckdint.h>`, standardised form of the builtins |

Verified:

```
__builtin_add_overflow(INT_MAX,1,&r) = 1, r=0
__builtin_mul_overflow(1<<20,1<<20,&r) = 1
```

## 1.3 Unsigned wraparound: defined, and still a bug

Unsigned arithmetic is modular by definition, so it never invokes UB. Verified:

```
0u - 1 = 4294967295  (== UINT_MAX)
```

Defined does not mean intended. The canonical failure:

```c
if (offset + len > buffer_size) return -1;   // "bounds check"
memcpy(dst, buffer + offset, len);
```

With `size_t offset` and `len`, an attacker-supplied `len` near `SIZE_MAX` makes
`offset + len` wrap to something tiny, the check passes, and `memcpy` reads
whatever it likes. The correct form subtracts instead of adding:
`if (offset > buffer_size || len > buffer_size - offset) return -1;` — every
intermediate stays in range. This shape is behind a long tail of CVEs and it is
worth drilling until it is reflexive.

Second canonical failure, the reverse loop:

```c
for (size_t i = v.size() - 1; i >= 0; --i)   // never terminates
```

`i >= 0` is vacuously true for an unsigned type — and if `v` is empty,
`v.size() - 1` is `SIZE_MAX` on the first trip. Compilers warn
(`-Wtype-limits`, in `-Wextra`). The fix is `for (size_t i = v.size(); i-- > 0;)`.

## 1.4 Integer promotion and the `-1 < 1u` trap

Before *any* arithmetic, C and C++ rewrite your operand types. Two rules, in
order.

**Integer promotions** (C23 §6.3.1.1p2): any type of rank lower than `int` —
`char`, `signed char`, `unsigned char`, `short`, `unsigned short`, `bool`,
bitfields — is converted to **`int`** if `int` can represent all its values,
otherwise `unsigned int`. On every mainstream platform `int` is 32-bit, so
`unsigned short` (16-bit) promotes to **signed** `int`. Unsignedness does not
survive.

**Usual arithmetic conversions** (C23 §6.3.1.8): after promotion, if the two
operands differ, they are brought to a common type. The rule that bites: if the
operands have the *same rank* but differ in signedness, the result type is the
**unsigned** one.

Verified, gcc 15.2 `-O2 -Wall -Wextra`:

```
(-1 < 1u)            = 0        <-- false
(-1 < 1)             = 1        <-- true
(i < u)              = 0        with int i = -1, unsigned u = 1
us 60000*60000 as int: -694967296
char is signed? 1 ; CHAR_MIN=-128
```

`-1 < 1u`: both operands have rank `int`, one is unsigned, so `-1` converts to
`unsigned` and becomes 4294967295, which is not less than 1. The comparison is
*false*. GCC does warn — `-Wsign-compare`, which is included in `-Wextra` but
**not** in `-Wall` for C++ (it is in `-Wall` for C). If you are teaching this,
turn on `-Wextra` from day one.

`60000 * 60000` on two `unsigned short`s: both promote to *signed* `int`, the
product 3,600,000,000 exceeds `INT_MAX`, and you have **signed overflow UB** —
in an expression containing no signed types at all. The observed −694967296 is
3,600,000,000 − 2^32, but per §1.2 that is not a guarantee. This is the trap that
makes people insist "use unsigned types for bit manipulation" and then get bitten
anyway; the fix is to cast *up* explicitly: `(unsigned)a * b` or `(uint32_t)a * b`.

`char` is a **third type**, distinct from both `signed char` and `unsigned char`,
and its signedness is implementation-defined. It is signed on x86-64 Linux and
macOS (verified above: `CHAR_MIN = -128`), unsigned on AArch64 Linux and on most
Arm ABIs. `char c = 0xFF; int i = c;` is −1 on your laptop and 255 on your
Raspberry Pi. Anything that does arithmetic or table indexing on bytes must say
`unsigned char` explicitly — this is why `<ctype.h>` functions are documented as
taking a value "representable as `unsigned char` or equal to `EOF`", and why
`isupper(*p)` with a plain `char*` is a real bug on x86.

## 1.5 Saturating arithmetic and fixed point

**Saturating** arithmetic clamps at the extremes instead of wrapping. It is the
right model for signals: an over-bright pixel should be white, not black; a
too-loud sample should clip, not invert. It is what DSP hardware and SIMD do
natively. Verified, gcc 15.2 `-std=c++26`:

```
add_sat<int8_t>(120,120) = 127   (wrap would give -16)
sub_sat<uint8_t>(3,5)    = 0     (wrap would give 254)
saturate_cast<int8_t>(1000) = 127
```

Scalar saturation costs a branch; the SIMD form is one instruction. Verified:

```asm
add_sat8(int8_t, int8_t):        vaddsat(__m128i, __m128i):
  add sil, dil                     paddsb xmm0, xmm1   ; 16 lanes, saturating
  jo .L3                           ret
  mov eax, esi
  ret
.L3:
  sar dil, 7                     ; -1 if a<0 else 0
  mov eax, edi
  xor eax, 127                   ; -> INT8_MIN or INT8_MAX
  ret
```

This connects forward to quantised inference: INT8 quantised kernels
(`numpy-pytorch-internals.md`, `algorithms-on-real-hardware.md`) accumulate in
INT32 and saturate on the way back down to INT8, and `paddsb`/`vpaddsb`/
`vpmaddubsw` are the instructions doing it.

**Fixed point** is integers with an agreed implied binary point. Qm.n means `m`
integer bits and `n` fraction bits; the stored integer is `round(x * 2^n)`.
Addition is plain integer addition. Multiplication needs a shift, because the
product of two Qm.n values is Q2m.2n. Verified Q16.16:

```
Q16.16: pi=205887 e=178145   pi*e = 8.539688  (true 8.539734)
Q16.16 resolution = 1.52588e-05 ; range = [-32768, 32768]
```

The defining property, and the reason fixed point still matters: **the spacing
between representable values is constant across the whole range**. Floating point
trades that for a spacing proportional to magnitude. Which you want depends on
whether your quantity has a natural scale (money, audio samples, screen
coordinates, sensor counts — fixed point) or spans many orders of magnitude
(physics, gradients, probabilities — floating point). Money in `double` is a
classic error; money in integer cents is fixed point Q_.2 with a decimal rather
than binary point.

**The bridge to the rest of this file:** an MX/NVFP4 block is *fixed point with a
per-block exponent*. The 32 FP4 elements share one E8M0 power-of-two scale; within
a block the spacing is near-uniform, between blocks it tracks magnitude. It is
the fixed-point/floating-point trade made at block granularity instead of per
value. That is the sentence `fp4-fp8-blackwell.md` assumes you already
understand, and this section is where it gets earned.

---

# Part 2 — Endianness

## 2.1 What the question actually is

A 32-bit integer is a *number*; memory is a *sequence of bytes*. Endianness is
the byte-order convention that maps one to the other. There is no deeper truth
to it — it is a coin flip that two designers made differently in the 1970s, and
we have been paying for it ever since.

- **Little-endian**: least-significant byte at the lowest address.
  x86, x86-64, RISC-V, and Arm/AArch64 in every mainstream OS configuration.
- **Big-endian**: most-significant byte at the lowest address. Also called
  "network byte order". SPARC, classic 68k and PowerPC, IBM z/Architecture,
  and the wire format of essentially every internet protocol.

Verified, x86-64 Linux, gcc 15.2:

```
endian::native == little? 1  big? 0
0x01020304 in memory: 04 03 02 01
htonl()      in memory: 01 02 03 04
byteswap(v) = 0x04030201
*(char*)&v  = 0x04
1.0f bytes: 00 00 80 3F          <-- 0x3F800000 stored little-endian
```

Note the last line: floats are not special. On every mainstream ABI, float byte
order follows integer byte order. (Historical mixed-endian FPUs — some Arm
FPA configurations stored `double` as two 32-bit words in swapped order — are
gone from anything a learner will touch, but they are why "float endianness"
gets its own sentence in serialisation specs.)

The name is from Swift's *Gulliver's Travels* by way of Danny Cohen's 1980
memo *On Holy Wars and a Plea for Peace* (IEN 137, later IEEE Computer 14(10),
1981), which is still the clearest short statement of the problem and is worth
assigning directly. Cohen's point was that neither order is better; what costs
money is that both exist.

**Little-endian's real advantages**, since students usually assume it is
arbitrary perversity:

1. A pointer to a wider integer is also a valid pointer to its low half.
   `*(uint8_t*)&x` is `x & 0xFF`; `*(uint16_t*)&x` is `x & 0xFFFF`. Narrowing a
   value is a no-op on the address. On a big-endian machine you must adjust the
   pointer by the size difference. This mattered a lot for 8-bit and 16-bit CPUs
   growing into wider ones, and it is why the 6502→x86 lineage is little-endian.
2. Multi-precision arithmetic proceeds in address order: add the low limbs first,
   carry upward, addresses increasing. Same direction as a memory streamer.

**Big-endian's real advantages:**

1. A hex dump reads left-to-right in the same order you'd write the number.
   Debugging protocol traces is genuinely easier.
2. Comparing two equal-length byte strings lexicographically (`memcmp`) gives the
   same answer as comparing the integers numerically. This is why big-endian
   ("bytewise-comparable") key encoding is standard in every ordered key-value
   store — LMDB, RocksDB, FoundationDB, and the `db` layer in
   `storage-filesystems-engines.md` all encode integer keys big-endian precisely
   so `memcmp` orders them.

## 2.2 Network byte order

"Network byte order" means big-endian, fixed by convention in the earliest
internet RFCs (RFC 1700's Data Notations section; RFC 791 and RFC 1122 depend on
it). The POSIX conversion functions are:

| Function | Meaning |
|---|---|
| `htons` / `htonl` | host → network, 16- / 32-bit |
| `ntohs` / `ntohl` | network → host, 16- / 32-bit |
| `htobe64` / `be64toh` etc. | Linux `<endian.h>`, 64-bit and explicit-direction forms |

On a big-endian host all of these are the identity function, which is exactly
why code that "works" without them ships broken to little-endian and vice versa.

## 2.3 Where endianness actually bites

1. **Anything on a wire or on disk.** Every binary protocol and file format picks
   an order and documents it. TCP/IP headers, DNS, TLS records: big-endian.
   PNG, JPEG (JFIF markers), Java `.class`: big-endian. ELF, PE/COFF, ZIP,
   PCAP, most GPU/ML tensor blobs: little-endian. `.npy` and Arrow carry the
   order *in the format* (NumPy's `<f4` vs `>f4` dtype prefix — see
   `numpy-pytorch-internals.md`).
2. **`fwrite`ing a struct.** The classic sin: it bakes in your endianness *and*
   your padding *and* your `sizeof(long)` *and* your struct layout rules. Three
   portability bugs for the price of one.
3. **Casting a byte buffer to a struct pointer.** Same problem plus alignment UB.
4. **Checksums and hashes.** MD5 and the SHA-2 family specify the byte order of
   their length field and their output; getting it wrong yields a
   perfectly-consistent wrong answer that only fails against other implementations.
5. **Unicode.** UTF-16 and UTF-32 have byte order and therefore need a BOM or an
   out-of-band declaration. UTF-8 does not — see §5.4, this is one of its
   headline advantages.
6. **Bitfields.** C leaves bitfield *allocation order within a unit*
   implementation-defined, separately from byte order. Verified on x86-64
   gcc: `struct { unsigned a:4, b:4; }` with `a=0xA, b=0x5` occupies the first
   byte as `0x5A` — `a` in the *low* nibble. GCC on a big-endian ABI packs the
   first-declared field into the *high* bits instead. Bitfields are therefore
   unusable for describing hardware registers or wire formats portably, no
   matter how tempting they look.

## 2.4 The portable idiom, and it is free

Do not detect endianness. Do not `#ifdef`. **Serialise with shifts and masks**,
which are defined in terms of *values*, not bytes, and therefore identical on
every machine:

```cpp
uint32_t load_le(const unsigned char* b) {
    return (uint32_t)b[0] | (uint32_t)b[1]<<8 | (uint32_t)b[2]<<16 | (uint32_t)b[3]<<24;
}
uint32_t load_be(const unsigned char* b) {
    return (uint32_t)b[0]<<24 | (uint32_t)b[1]<<16 | (uint32_t)b[2]<<8 | (uint32_t)b[3];
}
```

The objection is always "that's four loads and three ORs, it must be slow". It
is not. gcc 15.2 `-O2`, verified:

```asm
load_le(unsigned char const*):
  mov eax, DWORD PTR [rdi]     ; one unaligned 32-bit load
  ret
load_be(unsigned char const*):
  mov eax, DWORD PTR [rdi]
  bswap eax                    ; one load, one byte-swap
  ret
```

Both GCC and Clang pattern-match the shift-and-or idiom back into a native load
plus, if needed, a `bswap`. **The portable code compiles to the optimal code.**
This should be shown to every student who has ever written `#ifdef BIG_ENDIAN`.

Note the cast to `uint32_t` *before* shifting. `b[1] << 8` on a plain
`unsigned char` promotes to `int` (§1.4), and `b[3] << 24` on a value ≥ 0x80
shifts a 1 into the sign bit of `int` — UB. The casts are load-bearing.

C++20 gives you `std::endian` (compile-time query) and C++23 `std::byteswap`.
Both were verified above. There is still no standard "read big-endian integer
from bytes" function; the shift idiom remains the answer.

## 2.5 Type punning: union vs `memcpy`, and C vs C++

You will need to look at a float's bits (Part 3 depends on it). There are four
ways to write it and they are *not* equally legal.

```cpp
uint32_t pun_cast(float f)    { return *reinterpret_cast<uint32_t*>(&f); }  // UB, C and C++
uint32_t pun_memcpy(float f)  { uint32_t u; std::memcpy(&u,&f,4); return u; } // legal, C and C++
union U { float f; uint32_t u; };
uint32_t pun_union(float f)   { U x; x.f = f; return x.u; }  // legal C, UB in C++ (see below)
uint32_t pun_bitcast(float f) { return std::bit_cast<uint32_t>(f); }        // legal, C++20
```

All four produce **identical** code. Verified, gcc 15.2 `-O2`:

```asm
pun_cast(float):     movd eax, xmm0 / ret
pun_memcpy(float):   movd eax, xmm0 / ret
pun_union(float):    movd eax, xmm0 / ret
pun_bitcast(float):  movd eax, xmm0 / ret
```

Same instruction, four times. And GCC still warns on exactly one of them:

```
warning: dereferencing type-punned pointer will break strict-aliasing rules
         [-Wstrict-aliasing]
```

Identical codegen today is not a guarantee. The rules:

**`reinterpret_cast` / pointer-cast punning: UB in both languages.** This is the
*strict aliasing* rule (C23 §6.5p7; C++ [basic.lval]). An object may only be
accessed through an lvalue of its own type, a signed/unsigned variant, a
cv-qualified variant, an enclosing aggregate, or **`char` / `unsigned char` /
`std::byte`**. `float` and `uint32_t` are not on each other's lists. Compilers
*do* exploit this — it is what lets them keep a value in a register across a
store through an unrelated pointer. `-fno-strict-aliasing` turns the assumption
off (the Linux kernel and much of FFmpeg build with it), at a real optimisation
cost.

**`memcpy`: legal everywhere.** `unsigned char` access is always permitted, and
`memcpy` is specified in terms of it. Modern compilers recognise a fixed-size
`memcpy` between scalars and emit zero instructions of copying — verified above.
This is the answer for C.

**Union punning: legal in C, formally UB in C++.**
C23 N3220 footnote 93 (attached to §6.5.3.4, member access): *"If the member
used to read the contents of a union object is not the same as the member last
used to store a value in the object the appropriate part of the object
representation of the value is reinterpreted as an object representation in the
new type as described in 6.2.6 (a process sometimes called type punning). This
may be a non-value representation."*

C++ has no such footnote. In C++, reading a non-active union member is UB by
[class.union]/[basic.life] — only one member is alive at a time. **In practice**
GCC and Clang both document union punning as a supported extension in C++ too
(GCC manual, "Structures unions enumerations and bit-fields implementation:
Type punning"), and MSVC allows it. So it works; it is just not standard C++, and
a UBSan/static-analyser run will say so.

**`std::bit_cast` (C++20, `<bit>`): the right answer in modern C++.** Legal,
`constexpr`, compiles to nothing, and requires both types to be trivially
copyable and the same size — so it catches the mistakes the other forms don't.

Summary table:

| Technique | C | C++ | Notes |
|---|---|---|---|
| `*(T*)&x` | UB | UB | works until it doesn't; `-Wstrict-aliasing` |
| `memcpy` | ✅ legal | ✅ legal | zero-cost, always available |
| union | ✅ legal (fn 93) | ⚠️ UB, but a documented GCC/Clang/MSVC extension | |
| `std::bit_cast` | — | ✅ legal, C++20 | `constexpr`, type-checked |
| `char*` / `std::byte*` traversal | ✅ legal | ✅ legal | the escape hatch the rules explicitly carve out |

One more trap: **all four are still UB if the object representation is not a
valid value of the destination type** (a trap representation, or a padding byte).
For IEEE-754 float ↔ uint32 this cannot happen — every 32-bit pattern is a valid
`float`, including the 16.7 million NaNs — which is why this particular pun is
safe in practice and why it is the one we will use in Part 3.

---

# Part 3 — IEEE-754 floating point

## 3.1 The layout

A binary floating-point number is `(-1)^S × 1.M × 2^(E - bias)`. Three fields,
packed most-significant-first so that **comparing two same-signed floats as
integers gives the same ordering as comparing them as floats** — a deliberate
design property we will use in §3.7.

| Format | Total | S | E | M | bias | mantissa bits (incl. implicit) | decimal digits |
|---|---|---|---|---|---|---|---|
| binary16 (FP16) | 16 | 1 | 5 | 10 | 15 | 11 | ~3.3 |
| bfloat16 | 16 | 1 | 8 | 7 | 127 | 8 | ~2.4 |
| binary32 (`float`) | 32 | 1 | 8 | 23 | 127 | 24 | 6 guaranteed, 9 round-trip |
| binary64 (`double`) | 64 | 1 | 11 | 52 | 1023 | 53 | 15 guaranteed, 17 round-trip |
| x87 80-bit (`long double` on x86-64 SysV) | 80 in 16 bytes | 1 | 15 | 64 **explicit** | 16383 | 64 | 18 / 21 |
| binary128 | 128 | 1 | 15 | 112 | 16383 | 113 | 33 / 36 |

Verified on x86-64 Linux, gcc 15.2:

```
sizeof(long double)=16  LDBL_MANT_DIG=64  LDBL_MAX=1.18973e+4932
DBL_MANT_DIG=53 FLT_MANT_DIG=24 DBL_DIG=15 FLT_DIG=6
DBL_DECIMAL_DIG=17 FLT_DECIMAL_DIG=9 (round-trip digits)
FLT_EVAL_METHOD = 0
```

Two subtleties there. `long double` on x86-64 is the **80-bit x87 format padded
to 16 bytes for alignment** — 64 bits of mantissa, not 113, and `sizeof` lies
about how much of it is real. And `DBL_DIG=15` vs `DBL_DECIMAL_DIG=17`: 15 is how
many *decimal* digits always survive a decimal→binary→decimal round trip; 17 is
how many you must *print* to guarantee a binary→decimal→binary round trip. They
are different questions and this is where `%.17g` comes from.

### The bias, and why it is what it is

The exponent field is stored **biased** (excess-`2^(k-1) - 1`) rather than in
two's complement. Two reasons:

1. **Integer comparison works.** With a biased exponent, the whole
   sign-exponent-mantissa word of a positive float is monotonic in the value:
   `a < b` as floats iff `bits(a) < bits(b)` as unsigned integers, for
   non-negative `a`, `b`. A hardware comparator can be an integer comparator.
   A two's-complement exponent field would break this at the sign boundary.
2. It reserves the all-zeros and all-ones exponent codes for the special cases
   below, at the two ends where they are easiest to detect.

Bias is `2^(k-1) - 1`, one less than the "natural" midpoint. That asymmetry
(exponent range `[-126, +127]` for binary32, not `[-127, +127]` or
`[-128, +127]`) exists so the *reciprocal* of the largest normal doesn't overflow
— the format has slightly more headroom above than below, which matters because
`1/FLT_MIN` must stay finite.

### The implicit leading 1

Every normalised binary number has exactly one leading `1` before the point:
`1.xxxxx × 2^e`. Since it is always 1, storing it is a waste. IEEE-754 does not
store it. `float` therefore has **24 bits of precision in 23 bits of mantissa** —
a free bit, and a 2× improvement in precision for nothing.

The price: you now need a way to represent zero (which has no leading 1), and a
way to express numbers too small to normalise. Both come from the reserved
exponent codes.

### Reading the fields, verified

```
1.0f         1              0x3F800000  s=0 e=127(unb    0) m=0x000000
0.5f         0.5            0x3F000000  s=0 e=126(unb   -1) m=0x000000
0.1f         0.100000001    0x3DCCCCCD  s=0 e=123(unb   -4) m=0x4CCCCD
-0.0f        -0             0x80000000  s=1 e=  0           m=0x000000
inf          inf            0x7F800000  s=0 e=255           m=0x000000
nan          nan            0x7FC00000  s=0 e=255           m=0x400000
FLT_MIN      1.17549435e-38 0x00800000  s=0 e=  1(unb -126) m=0x000000
denorm_min   1.40129846e-45 0x00000001  s=0 e=  0           m=0x000001
FLT_MAX      3.40282347e+38 0x7F7FFFFF  s=0 e=254(unb  127) m=0x7FFFFF
FLT_EPSILON  1.1920929e-07  0x34000000  s=0 e=104(unb  -23) m=0x000000
```

Check `1.0f` by hand: sign 0, exponent field 127 so unbiased 0, mantissa 0, value
= `1.0 × 2^0` = 1. Check `0.1f`: unbiased exponent −4, so `0.1 = 1.6 × 2^-4`;
the stored mantissa `0x4CCCCD` = 5033165, and `1 + 5033165/2^23` = 1.60000002…
The trailing `…CCD` rather than `…CCC` is the round-to-nearest of an infinitely
repeating binary fraction — 0.1 is `0.0001100110011…₂`, and 1/10 in binary
repeats exactly the way 1/3 does in decimal.

### The complete decode table

| Exponent field | Mantissa | Meaning |
|---|---|---|
| all zeros | zero | **±0** (sign bit still meaningful) |
| all zeros | non-zero | **subnormal**: `(-1)^S × 0.M × 2^(1-bias)` — note `0.M`, and the exponent is `1-bias`, *not* `0-bias` |
| 1 … 2^k−2 | any | **normal**: `(-1)^S × 1.M × 2^(E-bias)` |
| all ones | zero | **±∞** |
| all ones | non-zero | **NaN** (quiet if the mantissa's top bit is 1, signalling if 0) |

## 3.2 Subnormals and gradual underflow

Without subnormals, the smallest positive `float` would be `FLT_MIN = 2^-126`,
and the gap between 0 and `FLT_MIN` would be `2^-126` while the gap between
`FLT_MIN` and its successor is `2^-149` — a **cliff of 2^23** right next to zero.
The consequence, and this is the argument Kahan made in the 754 committee:

```c
if (x != y) { z = 1.0f / (x - y); }   // can still divide by zero
```

With abrupt underflow, `x != y` can be true while `x - y` rounds to exactly 0,
because their difference is below `FLT_MIN`. The invariant *"`x != y` implies
`x - y != 0`"* fails. Subnormals restore it: the difference of two distinct
normals is always representable exactly as a subnormal (this is Sterbenz's
theorem territory), so `x - y` is nonzero whenever `x != y`.

Subnormals implement **gradual underflow**: as you go below `FLT_MIN` you lose
one bit of precision per halving, degrading smoothly to zero over 23 more binades,
instead of falling off a cliff. Verified: `denorm_min` = `0x00000001` =
`2^-23 × 2^-126` = `2^-149` = 1.4e−45, and `isnormal()` is false for it.

Note the `2^(1-bias)` in the decode table, not `2^(0-bias)`. That is what makes
the subnormal range join continuously onto the normal range: the largest
subnormal `0.111…1 × 2^-126` is exactly one ulp below the smallest normal
`1.000…0 × 2^-126`. If the exponent were `0-bias = -127` there would be a gap.

### The performance cliff, measured

Subnormals are the one part of IEEE-754 that mainstream hardware handles badly.
The multiplier and adder datapaths assume the implicit leading 1; a subnormal
operand or result needs a variable-length normalising shift that the fast path
does not have. Most x86 implementations take a **microcode assist** — a pipeline
flush and a trap into microcode — costing on the order of 100+ cycles.

Measured on Compiler Explorer's x86-64 execution host, gcc 15.2 `-O2`, in **one
binary on one dataset**, with the only variable being two bits of `MXCSR` flipped
at runtime. Three trials each; the reported ratio uses the minimum of three,
because the host is shared and the maximum is meaningless:

```
MXCSR before = 0x1FA2 (FTZ=0 DAZ=0)
FTZ off (IEEE)     normal 0.0051s  subnormal 0.2911s  RATIO  56.97x
   [trials 0.0051/0.0055/0.0051  vs  0.2913/0.2911/0.3572]
MXCSR after  = 0x9FF2 (FTZ=1 DAZ=1)
FTZ+DAZ on         normal 0.0058s  subnormal 0.0059s  RATIO   1.03x
   [trials 0.0058/0.0058/0.0058  vs  0.0059/0.0061/0.0060]
FTZ off again      normal 0.0051s  subnormal 0.3100s  RATIO  60.86x
   [trials 0.0059/0.0059/0.0051  vs  0.3100/0.8262/0.7829]
```

**57× slower**, and the slowdown disappears entirely when flush-to-zero is
enabled and reappears when it is turned off again. The third block's trial spread
(0.31 / 0.83 / 0.78) is exactly why absolute timings from a shared cloud runner
must never be quoted — but the *ratio within one build* is robust and reproduces.

### FTZ and DAZ

Two separate `MXCSR` bits on x86 SSE:

- **FTZ** (Flush To Zero, bit 15): a subnormal *result* is replaced by zero of
  the same sign.
- **DAZ** (Denormals Are Zero, bit 6): a subnormal *input* is treated as zero
  before the operation.

Together they make the subnormal range simply not exist, which restores full
speed and breaks IEEE-754 conformance. Note they are **CPU state, not compiler
state**: set per-thread, inherited by everything running on that thread including
library code compiled without your flags. This is the mechanism behind the
notorious "linking a library built with `-ffast-math` changed my program's
results" — see §3.9.

Arm/AArch64 has the equivalent `FPCR.FZ` bit; AArch64 in AArch32 compatibility
modes and many older Arm FPUs are *always* flush-to-zero for single precision.
**GPUs**: CUDA compiles with `-ftz=false` by default for `float` (subnormals
supported, and fast — NVIDIA implements them in the datapath, not microcode), but
`__fdividef`, several fast-math intrinsics, and `-use_fast_math` flip it to true.
Tensor Core paths and the FP8/FP4 formats in `fp4-fp8-blackwell.md` handle
subnormals natively at full rate — the E2M1 format's smallest value 0.5 *is* a
subnormal, so an FP4 unit that flushed them would lose a third of its four
positive magnitudes.

## 3.3 Signed zeros

`+0` and `-0` are distinct bit patterns that **compare equal**. Verified:

```
(-0.0 == 0.0) = 1 ; 1/-0.0 = -inf ; 1/0.0 = inf
signbit(-0.0)=1 signbit(0.0)=0
sqrt(-0.0) = -0 ; copysign(1,-0.0) = -1
```

Why keep the sign? Because `-0` records the *direction of an underflow*, and that
information is needed to keep branch cuts and limits consistent. `1/x` as `x`
approaches 0 from below must give `-∞`; if underflow destroyed the sign, `1/x`
would flip discontinuously. The same argument governs `atan2`, `log`, and the
complex functions' branch cuts (Kahan's "Branch Cuts for Complex Elementary
Functions", 1987, is the canonical reference).

The practical traps: `x == 0` is true for `-0`, so you cannot use `==` to detect
it; use `std::signbit`. And `-0` is why "sum a list and check the sign of the
result" can surprise you: `-0.0 + -0.0` is `-0` but `0.0 + -0.0` is `+0`
(verified above) — addition of opposite-signed zeros gives `+0` in round-to-
nearest, because the standard has to pick something.

## 3.4 Infinities

`±∞` are produced by overflow and by division of a finite non-zero by zero, and
they **propagate**: `inf + 1 = inf`, `1/inf = 0`, `inf - inf = NaN`.

Their purpose is closure. Without them, overflow must either trap (killing your
program in the middle of a Monte Carlo run) or return garbage. With them,
overflow returns a value that keeps arithmetic total and that loudly announces
itself downstream. Continued-fraction evaluation is the classic case where
letting a term go to `∞` and the next reciprocal go to `0` gives the *right
answer* with no special-casing.

Verified: `1/0.0` sets `FE_DIVBYZERO` (not `FE_INVALID`) and returns `inf`;
`0.0/0.0` sets `FE_INVALID` and returns NaN.

## 3.5 NaN

### Why `NaN != NaN`

Every comparison involving a NaN except `!=` returns **false**. Verified:

```
NaN==NaN 0   NaN!=NaN 1   NaN<1 0   NaN>=1 0
```

The reason is not philosophical, it is that `<`, `<=`, `>`, `>=`, `==` are all
defined on the **total order of the reals**, and NaN is not in it. IEEE-754
defines four mutually exclusive relations between any two operands: less,
equal, greater, and **unordered**. A NaN is unordered with everything, itself
included. `==` asks "are these *equal*", the answer is "no, they are unordered",
so `false`. `!=` is specified as the negation of `==` — not as "greater or less"
— so it is the one that returns `true`.

The consequence people actually hit: `x != x` is a correct, portable, library-free
NaN test — and it is exactly the test that `-ffast-math` breaks (§3.9). Also,
`std::sort` with a comparator over data containing NaN violates strict weak
ordering and can walk off the end of the array; `std::max(NaN, 1.0)` and
`std::max(1.0, NaN)` give different answers.

Note also that `!(a < b)` is **not** `a >= b` in the presence of NaN. This is why
IEEE-754 specifies both "quiet" and "signalling" comparison predicates, and why
C has `isless`, `islessequal`, `isgreater` (quiet: no `FE_INVALID` on NaN)
distinct from the `<` and `>` operators (which *do* raise `FE_INVALID` on
signalling comparisons in the standard's model).

### Quiet vs signalling

The mantissa's **most significant bit** is the "is_quiet" flag (IEEE-754-2008
onward recommends this encoding; it is what x86, Arm, RISC-V and PowerPC all do —
MIPS historically had it inverted, which is exactly the kind of thing the 2008
revision was written to stop).

- **qNaN**: top mantissa bit **1**. Propagates silently through arithmetic. This
  is what `0/0`, `inf-inf`, `sqrt(-1)` produce.
- **sNaN**: top mantissa bit **0**, remaining mantissa non-zero. Raises
  `FE_INVALID` on *any* arithmetic use and is then **quieted** — the result is a
  qNaN with the payload preserved.

Verified on x86-64:

```
nan("")        0x7FF8000000000000    <- qNaN, top mantissa bit set
qNaN limits    0x7FF8000000000000
sNaN limits    0x7FF4000000000000    <- top mantissa bit CLEAR, payload 0x4...
sNaN + 1.0     0x7FFC000000000000    <- quieted: bit 51 got OR'd in, 0x4 -> 0xC
has_signaling_NaN=1  is_iec559=1
```

Watch that last line carefully: the sNaN's payload `0x4000000000000` became
`0xC000000000000` — the quiet bit was set and **the rest of the payload survived
unchanged**. That is the designed behaviour, and it is the whole point of
payloads.

sNaNs are meant for "uninitialised memory" traps: fill an array with sNaN and any
read-before-write raises `FE_INVALID` at the exact instruction. In practice they
are fragile — a plain assignment or `memcpy` does not touch them (not an
arithmetic operation), and passing one through x87 or through some `float`↔
`double` conversions quiets it. Fortran's `-finit-real=snan` and NumPy debugging
use them anyway.

### Payloads

51 bits of mantissa (in `double`) are free for the producer to use. Verified:

```
nan("1")       0x7FF8000000000001
nan("0x1234")  0x7FF8000000001234
```

`double` therefore has **2^53 − 2 distinct NaN bit patterns**; `float` has
2^24 − 2. IEEE-754 says a NaN result should propagate one of its operands'
payloads but does not say which, so payload propagation is not portable and no
mainstream language exposes it. Where they are actually used: NaN-boxing in
dynamic-language VMs (JavaScriptCore, LuaJIT, SpiderMonkey) packs a 48-bit
pointer or a tagged small value into a qNaN payload so that every value is one
64-bit word and doubles need no boxing at all. That trick is only possible
because the standard reserved this space.

### The x86 "default NaN" has the sign bit set

An oddity worth showing students because it looks like a bug:

```
inf-inf   0xFFF8000000000000   prints as "-nan"
0*inf     0xFFF8000000000000   prints as "-nan"
```

x86's hardware-generated default NaN — Intel calls it the "QNaN floating-point
indefinite" — has **sign = 1**. So `printf("%g")` prints `-nan`, and students
reasonably ask what a negative not-a-number is. Nothing: NaN's sign bit is
meaningless to arithmetic (IEEE-754 says nothing about it), x86 just happens to
set it, Arm's default NaN has sign 0. Never test the sign of a NaN.

## 3.6 The rounding modes

Every operation is defined as: compute the exact mathematical result, then round
it to the destination format. IEEE-754-2019 §4.3 defines **five** rounding-
direction attributes:

| Mode | C `fenv.h` | What it does |
|---|---|---|
| roundTiesToEven | `FE_TONEAREST` | nearest; **exact ties go to the even last bit**. The default. |
| roundTiesToAway | (no C99 macro; C23 `FE_TONEARESTFROMZERO`) | nearest; ties away from zero. Required for decimal, optional for binary. |
| roundTowardPositive | `FE_UPWARD` | toward +∞ |
| roundTowardNegative | `FE_DOWNWARD` | toward −∞ |
| roundTowardZero | `FE_TOWARDZERO` | truncate |

Verified — `1.0 + 2^-53`, whose exact value is precisely halfway between `1.0`
and `1.0 + 2^-52` (the next double):

```
FE_TONEAREST     1                   0x3FF0000000000000
FE_TOWARDZERO    1                   0x3FF0000000000000
FE_UPWARD        1.0000000000000002  0x3FF0000000000001
FE_DOWNWARD      1                   0x3FF0000000000000
```

Ties-to-even picked `1.0` because its last mantissa bit is 0 (even). Verified
that the tie really does go both ways depending on parity:

```
1.0        + ulp/2 = 1                    (tie -> even -> 1.0)
(1.0+ulp)  + ulp/2 = 1.0000000000000004   (tie -> even -> 1.0+2ulp)
1.0+2*ulp          = 1.0000000000000004
```

Same increment, opposite directions. That is the definition working.

### Why ties-to-even is the default

Three reasons, in increasing order of importance:

1. **It is unbiased.** "Round half up" — what everyone learns in school — always
   pushes ties away from zero, so a long chain of roundings drifts systematically
   upward in magnitude. Ties-to-even splits them: half the ties go up, half go
   down, and the errors cancel in expectation rather than accumulating. For a
   summation of *n* terms this is the difference between an error growing like
   *n·u* and one growing like *√n·u*.
2. **It is reversible.** With ties-to-even, `(x/2)*2 == x` and doubling then
   halving round-trips, because the tie always lands on the value with a zero
   last bit, which is the one that survives the halving exactly. Round-half-up
   breaks this.
3. **It is cheap.** The tie case is detected by "guard bit set, all sticky bits
   zero", and the decision is then just "round up iff the LSB is 1" — one AND
   gate on top of the machinery you already needed.

Verified, the visible consequence:

```
v=  0.5  nearbyint=  0.0  rint=  0.0  round=  1.0
v=  1.5  nearbyint=  2.0  rint=  2.0  round=  2.0
v=  2.5  nearbyint=  2.0  rint=  2.0  round=  3.0
v=  3.5  nearbyint=  4.0  rint=  4.0  round=  4.0
v= -2.5  nearbyint= -2.0  rint= -2.0  round= -3.0
```

`nearbyint`/`rint` honour the current mode (default ties-to-even, so 2.5 → 2);
`round()` is specified as ties-away-from-zero regardless of the mode (so 2.5 → 3).
Python's `round()` and NumPy's `np.round` use ties-to-even; C's `round()` and
JavaScript's `Math.round` do not. Every "our totals are off by a cent" bug report
lives in that gap.

### Actually changing the mode

`fesetround` works but is a **thread-wide, non-local** side effect that the
optimiser does not model unless you tell it. You need
`#pragma STDC FENV_ACCESS ON` (which GCC still does not fully implement) or
`-frounding-math`, otherwise constant folding happens at compile time in the
default mode and your `fesetround` is silently ignored for anything foldable.
The tests above used `-frounding-math` and `volatile` operands for exactly this
reason. Directed rounding's main legitimate use is **interval arithmetic**:
compute the lower bound with `FE_DOWNWARD` and the upper with `FE_UPWARD` and you
have a rigorous enclosure of the true answer.

## 3.7 Epsilon, ULP, and comparing floats correctly

**Machine epsilon** (`DBL_EPSILON`, `std::numeric_limits<double>::epsilon()`) is
`2^-52` = 2.22e−16: the gap between 1.0 and the next representable double. It is
*not* "the smallest double" and it is *not* a universal tolerance.

The unit roundoff `u = eps/2 = 2^-53` is the quantity that appears in error
bounds: for round-to-nearest, `fl(x) = x(1+δ)` with `|δ| ≤ u`.

**ULP** (unit in the last place) is the gap between adjacent representable
values *at a given magnitude*. It scales with the exponent. Verified:

```
DBL_EPSILON        = 2.2204460492503131e-16   (2^-52)
nextafter(1,2)-1   = 2.2204460492503131e-16
1 - nextafter(1,0) = 1.1102230246251565e-16   <-- the gap BELOW 1.0 is half as big

ulp(1e+00 ) = 2.22e-16     relative 2.22e-16
ulp(1e+06 ) = 1.164e-10    relative 1.16e-16
ulp(1e+16 ) = 2            relative 2.00e-16
ulp(1e+300) = 1.487e+284   relative 1.49e-16
ulp(1e-300) = 1.658e-316   relative 1.66e-16

1e16 + 1 == 1e16 ? 1   (ulp there is 2)
```

Read the last line twice. **At 1e16, the spacing between doubles is 2. Adding 1
does nothing.** Floating point is not "reals with small errors"; it is a
logarithmically-spaced lattice, and the relative spacing is roughly constant
(~1e−16) while the absolute spacing spans 600 orders of magnitude. Note also the
asymmetry at 1.0: the gap below is half the gap above, because you have just
crossed a binade boundary and the exponent dropped by one. Error bounds are
stated in *relative* terms for this reason.

Related: the largest integer such that all smaller integers are exactly
representable is `2^53` for `double` and `2^24` for `float`. Verified:
`2^53 + 1 == 2^53` and `16777217.0f == 16777216.0f`. This is why JavaScript's
`Number.MAX_SAFE_INTEGER` is 2^53−1, why 64-bit database IDs corrupt when they
pass through JSON, and why a `float32` counter stops incrementing at 16.7 million
— a bug that shows up in training loops that accumulate a step count in fp32.

### Comparing floats

There is no single right answer, but there are wrong ones.

**Wrong: `a == b`** for computed values. `0.1 + 0.2 != 0.3`.

**Wrong: `fabs(a-b) < 1e-9`.** A fixed absolute tolerance is meaningless without
knowing the magnitude. At 1e16 no two distinct doubles are within 1e−9 of each
other, so this is `a == b`. At 1e−20 everything passes.

**Usually right: relative tolerance with an absolute floor.**

```cpp
bool close(double a, double b, double rel = 1e-9, double abs_ = 1e-12) {
    double d = std::fabs(a - b);
    if (d <= abs_) return true;                       // handles a,b near zero
    return d <= rel * std::max(std::fabs(a), std::fabs(b));
}
```

The absolute floor is not optional: near zero, relative comparison divides by
something tiny and everything fails. (This is Python's `math.isclose` and
NumPy's `allclose`, modulo which side the tolerances apply to — `np.allclose`
uses `|a-b| <= atol + rtol*|b|`, which is asymmetric, a real gotcha in test
suites.)

**Sometimes right: ULP distance.** Because of the biased-exponent layout, the
bit patterns of same-signed floats are *consecutive integers*. So the number of
representable values between two floats is an integer subtraction. Verified:

```
ulps(0.1+0.2, 0.3) = 1        <-- they are literally adjacent doubles
ulps(1.0, 1.0+eps) = -1
ulps(0.0, -0.0)    = -9223372036854775808   <-- the trap
```

`0.1 + 0.2` and `0.3` are **one ulp apart** — the smallest possible non-zero
distance. That reframes the famous example: not "floats are broken", but "the
answer is the closest representable double to the true sum, and the true sum
happens to sit on the other side of a lattice point from the closest double to
0.3".

The ULP method needs care: it breaks across the sign boundary (the ±0 case above
gives 2^63), it is undefined for NaN, and it silently treats `1e-300` and
`-1e-300` as astronomically far apart even though both are ~0. Use it in test
frameworks (Google Test's `EXPECT_FLOAT_EQ` is 4 ULPs), not in application logic.

## 3.8 Which operations are correctly rounded

**Correctly rounded** means: the result is exactly what you would get by
computing with infinite precision and then rounding once. IEEE-754 §5.3–5.4
*requires* it for:

- `+`, `−`, `×`, `÷`
- `sqrt`
- `fma`
- remainder, and conversions between formats and to/from integer and decimal strings

That is the whole list. **Everything transcendental is not required to be
correctly rounded.** `sin`, `cos`, `exp`, `log`, `pow`, `atan2` — IEEE-754-2019
clause 9 *recommends* correct rounding for them and defines the operations, but
compliance is optional and glibc does not claim it for all of them. glibc
documents worst-case known errors per function in its manual's "Known Maximum
Errors" table; most double-precision functions are 1–2 ULP on x86-64, a few are
worse.

The practical consequences:

- `exp(1.0)` may differ in the last bit between glibc, musl, Apple's libm, MSVC,
  Intel's SVML and CUDA's libdevice. **A program that computes a `sin` is not
  bit-reproducible across platforms**, even with identical IEEE-754 arithmetic.
  This is a major source of "the model gives different logits on CPU vs GPU".
- `pow(10, 23)` is not `1e23`. Verified: `pow(10.0,23.0) = 9.9999999999999992e+22`
  — because 10^23 is not representable as a double at all (the largest exactly
  representable power of ten is 10^22, verified). Two different correct-ish
  implementations can land on either neighbour.
- The "table maker's dilemma" is why: to round a transcendental correctly you may
  need arbitrarily many extra bits to decide which side of a halfway point the
  true value falls on, and there is no *a priori* bound. The CORE-MATH project
  (core-math.gitlabpages.inria.fr) is producing correctly-rounded implementations
  with proofs; glibc has been adopting them.

`sqrt` being on the required list is worth flagging: it is the only "hard" one
that is required, because unlike `sin` it has a computable exact answer with a
bounded decision procedure, and it is cheap enough in hardware (`sqrtsd` on x86)
to be done right. This is why numerically-careful code prefers `sqrt` over
`pow(x, 0.5)`.

### Floating-point exception flags

IEEE-754 defines five sticky flags. Verified:

```
1/3        -> FE_INEXACT     raised
1/0        -> FE_DIVBYZERO   raised, FE_INVALID not
0/0        -> FE_INVALID     raised, result NaN
DBL_MIN/16 -> 1.39067e-309, FE_UNDERFLOW NOT raised, FE_INEXACT NOT raised
```

That last one is a subtlety people get wrong. `DBL_MIN/16` = `2^-1026` **is**
subnormal, but IEEE-754's default underflow detection requires the result to be
*both* tiny *and* **inexact**. This division is exact (mantissa 1.0 shifted by a
power of two, nothing lost), so no underflow is signalled. Underflow means "you
lost precision because you went subnormal", not "you went subnormal".

## 3.9 FMA — fused multiply-add

`fma(a, b, c)` computes `a×b + c` with **one** rounding, at the end. The
intermediate product `a×b` is kept exactly, in full 2×53-bit width.
`a*b + c` written normally has **two** roundings: one after the multiply, one
after the add.

That single removed rounding is worth a great deal when `c` nearly cancels `a×b`
— which is precisely the situation in dot products, Newton iterations, polynomial
evaluation by Horner's rule, and determinants.

Verified, gcc 15.2 `-O2 -mfma`, `A = 1e8+1`, `B = 1e8`, so `A² − B²` = 200000001
exactly:

```
A*A - B*B naive     200000000     0x41A7D78400000000
fma(A,A,-(B*B))     200000001     0x41A7D78402000000
exact (A-B)*(A+B)   200000001     0x41A7D78402000000
```

The naive form is **wrong by 1** in a result of magnitude 2e8. Why: `A×A` =
10000000200000001 needs 54 bits and gets rounded to 10000000200000000 before the
subtraction; the rounding error is the entire answer's low bit, and subtracting
`B×B` = 10000000000000000 (exact) exposes it. `fma` keeps `A×A` exact through the
subtraction, so the cancellation reveals the true low bits instead of the
rounding noise.

Second demonstration — FMA is the *only* portable way to recover the exact error
of a multiplication:

```
u*v                        2.4494897427831783
fma(u,v,-u*v)             -2.0170264819438053e-16
```

`fma(u, v, -(u*v))` computes `u×v` exactly, subtracts the rounded product, and
returns **the exact rounding error**. Together `(u*v, err)` represent the product
to 106 bits. This "two-product" primitive is the multiplicative counterpart of
the "two-sum" in §4.4, and it is the foundation of double-double arithmetic, of
correctly-rounded libm implementations, and of compensated dot products.

And a third, showing it is not always a mere last-bit affair:

```
p*q + r   (rounded product)   0                          <-- says the answer is zero
fma(p,q,r)(exact product)    -1.6653345369377347e-18     <-- the actual answer
```

with `p=0.1, q=0.2, r=-0.020000000000000004`. Naive says exactly 0. FMA gives the
true residual. If this were a Newton step or a residual check, one form converges
and the other declares premature success.

### FMA is *not* always better, and it is not deterministic across builds

`a*b + c` and `fma(a,b,c)` are **different functions**. FMA is more accurate for
this expression, but it changes results, and that is a problem when you needed
reproducibility. Worse, whether you get one depends on flags. Verified:

| Compile | Codegen for `a*b + c` |
|---|---|
| gcc `-O2` (no FMA in ISA) | `mulsd` + `addsd` — two roundings |
| gcc `-O2 -mfma` | `vfmadd132sd` — **one** rounding, silently |
| gcc `-O2 -mfma -ffp-contract=off` | `vmulsd` + `vaddsd` — two roundings |

GCC's default is `-ffp-contract=fast`: **it will contract `a*b+c` into an FMA
across statements without asking**, whenever the target has the instruction. C's
own rule (C23 §6.5p8 and the `FP_CONTRACT` pragma) permits contraction only
within a single expression and lets you turn it off; C++ has no standard pragma
at all, so this is entirely a compiler switch. Clang's default is
`-ffp-contract=on` (within-statement) since Clang 14 for C++ — so **the same
source compiled by GCC and Clang with the same `-O2 -march=native` can give
different numerical results**, and this is legal in both.

If you need bit-reproducible builds — and anyone comparing training runs across
machines does — you must set `-ffp-contract=off` explicitly, and accept the
accuracy loss. This is one of the biggest single sources of "why does my model
give slightly different numbers on the new cluster".

One more trap: `std::fma` on a target *without* an FMA instruction falls back to
a software emulation in libm that is correct but can be **50–100× slower** than a
multiply and an add. Don't sprinkle `std::fma` into portable code for speed; use
it where you need the accuracy, and let `-mfma`/`-march=` handle the rest.

## 3.10 `-ffast-math`: exactly what it discards

`-ffast-math` is not a single relaxation, it is a bundle. In GCC it implies:

| Sub-flag | What it permits |
|---|---|
| `-fno-math-errno` | libm functions need not set `errno`; lets `sqrt` become one instruction instead of a call plus a branch |
| `-funsafe-math-optimizations` | enables the two below plus reciprocal/`rsqrt` substitution |
| ↳ `-fassociative-math` | **reassociate** `(a+b)+c` → `a+(b+c)`; enables vectorised reductions |
| ↳ `-freciprocal-math` | `x/y` → `x * (1/y)` |
| `-ffinite-math-only` | **assume no NaN and no Inf anywhere** |
| `-fno-signed-zeros` | `+0` and `-0` are interchangeable; `x + 0.0` → `x`, `-x` → `0 - x` |
| `-fno-trapping-math` | no operation raises an FP exception; flags need not be right |
| `-fno-rounding-math` | assume round-to-nearest always; constant-fold freely |
| `-fexcess-precision=fast` | intermediates may keep extra precision |
| plus, when linking a **program**, `crtfastmath.o` | sets FTZ+DAZ in `MXCSR` **at process startup** |

Measured, gcc 15.2, same source, `-O2` vs `-O2 -ffast-math`:

```
                            -O2        -ffast-math
x!=x for NaN            :     1              0        <-- IEEE says 1
std::isnan(NaN)         :     1              0        <-- !!
0.0 + -0.0              :     0              0
-0.0 + -0.0             :    -0             -0
1e308*10 (overflow)     :   inf            inf
DBL_MIN/4               : 5.56268e-309       0        <-- flushed
(1e16 + -1e16) + 1      :     1              0        <-- reassociated
MXCSR                   : 0x1FAA         0x9FF8       FTZ 0->1, DAZ 0->1
__FAST_MATH__           :     0              1
__FINITE_MATH_ONLY__    :     0              1
```

Three of those deserve to be read out loud.

**`std::isnan(NaN)` returns `0`.** `-ffinite-math-only` tells the compiler NaNs
do not exist, so every NaN test folds to `false`. Your defensive check for bad
data is deleted. Note that the NaN itself is still produced and still propagates
— you have removed the ability to *detect* it, not the ability to create it. This
is the single most dangerous item in the bundle for ML code, where checking for
NaN loss is standard practice.

**`(1e16 + -1e16) + 1` becomes `0`.** With reassociation permitted, the compiler
computed `1e16 + (-1e16 + 1)`. At 1e16 the ulp is 2, so `-1e16 + 1` rounds back
to `-1e16`, and the sum is 0. The correct IEEE answer is 1. Floating-point
addition is **not associative** (§4.3) and `-fassociative-math` is precisely the
flag that says "pretend it is".

**`MXCSR` changed from `0x1FAA` to `0x9FF8`.** Linking a *program* with
`-ffast-math` pulls in `crtfastmath.o`, a startup object that sets FTZ and DAZ
before `main` runs. This is process-global. Every shared library in the process,
including ones you compiled carefully without fast-math, now runs with
flush-to-zero. Even worse historically: GCC used to add `crtfastmath.o` when
building a *shared library* with `-ffast-math` too, so merely `dlopen`ing a
third-party `.so` could silently change your program's arithmetic. (GCC 13
restricted this to executables — GCC bug 55522 — but any binary built with an
older toolchain still does it.)

**What `-ffast-math` does *not* buy you here:** notice `1e308*10` still gave
`inf`, and `-0.0 + -0.0` still gave `-0`. The flags are *permissions*, not
obligations. The compiler exploits them when it can see a win; when it cannot,
behaviour is unchanged. That is the worst property of the whole bundle — the
breakage is **input-dependent, optimisation-level-dependent, and
compiler-version-dependent**, so it shows up in production and not in your tests.

### What to use instead

Almost every actual speedup from `-ffast-math` in numerical code comes from
**two** of its members: `-fassociative-math` (which unlocks SIMD reductions) and
FTZ/DAZ. Both are available on their own:

- `-ffp-contract=fast -fno-math-errno` — nearly free, very low risk.
- `#pragma omp simd reduction(+:s)` or `-fassociative-math` **on the specific
  loop**, not the whole program.
- `_MM_SET_FLUSH_ZERO_MODE(_MM_FLUSH_ZERO_ON)` at the top of the hot region,
  restored afterwards — explicit, local, and visible in a code review.
- Never `-ffinite-math-only` in code that checks for NaN. Which is all ML code.

---

# Part 4 — Numerical stability

This is the part that matters for AI, and it is the part that makes the FP4/FP8
material in `fp4-fp8-blackwell.md` make sense rather than merely be true.

## 4.1 `0.1 + 0.2 != 0.3`

The famous one. It is not a bug and it is not specific to floating point; it is
what happens when you write a number in a base that does not divide its
denominator. One third in decimal is 0.3333… forever. One tenth in **binary** is
`0.0001100110011…` forever, because 10 = 2×5 and 5 is not a power of two.

Verified exactly:

```
0.1        0.10000000000000001    0x3FB999999999999A
0.2        0.20000000000000001    0x3FC999999999999A
0.1+0.2    0.30000000000000004    0x3FD3333333333334
0.3        0.29999999999999999    0x3FD3333333333333
0.1+0.2 == 0.3 ? 0    diff = 5.55e-17

0.1     exactly = 0.1000000000000000055511151231257827021181583404541015625
0.1+0.2 exactly = 0.3000000000000000444089209850062616169452667236328125
```

Three things to notice.

1. **The literal `0.1` is already wrong before you do any arithmetic.** It is the
   nearest double to one tenth, which is 0.1000000000000000055511…, and that
   55-digit expansion is *exact* — every binary float is exactly some finite
   decimal, because 2^-n always terminates in base 10. Printing more digits does
   not reveal fuzz; it reveals the precise value you actually have.
2. `0.1 + 0.2` is `0x…334`; `0.3` is `0x…333`. They are **adjacent doubles**
   (verified: ULP distance exactly 1). The addition was correctly rounded — it is
   just that `nearest(nearest(0.1) + nearest(0.2))` and `nearest(0.3)` are two
   different roundings of two different exact quantities, and they landed on
   opposite sides of a lattice point.
3. This is inherent to *binary*, not to floating point. Decimal floating point
   (IEEE-754 decimal64/128, Python's `decimal`, SQL `NUMERIC`) represents 0.1
   exactly and gets 0.3 exactly — and then fails on 1/3 instead. There is no base
   in which every rational is finite. **Use decimal for money** (where the
   quantities *are* decimal by definition) and binary for physics.

## 4.2 Catastrophic cancellation

Rounding error usually stays relatively small. **Cancellation is the mechanism
that promotes tiny absolute errors into enormous relative ones**, and it is the
single most important failure mode to teach.

Subtracting two nearly-equal numbers is *exact* on most hardware (Sterbenz's
lemma: if `y/2 ≤ x ≤ 2y` then `x − y` is computed exactly). The subtraction is
not where the error comes from. The error comes from the fact that `x` and `y`
already carried rounding error in their low bits, and the subtraction **cancels
away all the leading digits they agreed on**, promoting those low garbage bits to
the leading position of the answer.

Verified:

```
(1+1e-13) - 1 = 9.9920072216264089e-14   true 1e-13   rel err 8.0e-4
```

Both inputs were accurate to ~1e−16 relative. The answer is wrong by 8e−4
relative — a loss of **12 decimal digits** in one subtraction.

### Worked case 1: the quadratic formula

`x = (-b ± √(b² − 4ac)) / 2a`. When `b² ≫ 4ac`, `√(b² − 4ac) ≈ |b|`, so one of
the two roots is computed as a difference of near-equal numbers. Verified with
`a=1, b=1e8, c=1` (true roots ≈ −1e−8 and −1e8):

```
naive : -7.4505805969238281e-09 , -100000000
stable: -1e-08                  , -100000000
residual |a·x²+b·x+c|, naive  : 0.255
residual |a·x²+b·x+c|, stable : 1.11e-16
```

The small root is wrong by **25%**. Not the last bit — a quarter of the answer.
The residual test confirms it: plug the naive root back into the polynomial and
you get 0.255 instead of ~0.

The fix is not more precision, it is **algebra that avoids the subtraction**:

```cpp
double d = std::sqrt(b*b - 4*a*c);
double q = -0.5 * (b + std::copysign(d, b));   // ADD same-signed quantities
double x1 = q / a;                             // the well-conditioned root
double x2 = c / q;                             // from Vieta: x1*x2 = c/a
```

`copysign(d, b)` guarantees `b` and `d` have the same sign, so `b + d` is an
addition of like signs — no cancellation possible. The other root then comes from
the product relation instead of the formula. This is the recipe in *Numerical
Recipes* §5.6 and it is the standard example for a reason.

### Worked case 2: variance, two ways

The one-pass "computational formula" `Var = (Σx² − (Σx)²/n)/(n−1)` is in every
statistics textbook, every spreadsheet tutorial, and a great many production
codebases. It is a disaster whenever the mean is large relative to the spread,
because `Σx²` and `(Σx)²/n` are both huge and nearly equal.

Verified: 100 000 samples of `N(1e9, 1)`, so the true variance is ≈ 1.0.

```
one-pass  E[x^2]-E[x]^2 : 13086.35934
two-pass                : 1.00484392
Welford (one pass)      : 1.004843908
```

**13 086 instead of 1.** Four orders of magnitude, from a formula that is
algebraically exact. And note that the naive formula can return a *negative*
variance for tighter data — people then take `sqrt` of it and get NaN, which is
how this bug usually gets discovered.

Two fixes:

- **Two-pass**: compute the mean, then `Σ(x−mean)²`. The subtraction happens once
  per element on quantities that are *supposed* to differ, so no cancellation.
  Costs a second pass over the data.
- **Welford's algorithm** (1962), one pass and stable:
  ```cpp
  double m = 0, M2 = 0; size_t k = 0;
  for (double v : x) { ++k; double d = v - m; m += d/k; M2 += d*(v - m); }
  double var = M2/(k - 1);
  ```
  Note `d*(v - m)` uses `m` *after* the update — that is not a typo, it is what
  makes the increment `(v - m_old)(v - m_new)` and keeps `M2` non-negative.
  Verified above: agrees with two-pass to 8 digits. This is what
  `pandas.std`, `np.var`'s stable paths, and every streaming-statistics library
  use, and it generalises to covariance and to a parallel merge form (Chan,
  Golub & LeVeque 1979) — which is how you compute a distributed batch-norm.

### Worked case 3: the library functions that exist because of this

Verified:

```
1 - cos(1e-8) naive       = 0                        <-- total loss
2*sin(1e-8/2)^2 (stable)  = 5.0000000000000005e-17
exp(1e-10)-1 naive        = 1.000000082740371e-10    <-- 8 digits wrong
expm1(1e-10)  (stable)    = 1.00000000005e-10
```

`expm1`, `log1p`, `sinh`, `atanh`, `hypot`, `fma` and `cbrt` all exist in
`<cmath>` for exactly this reason: each computes something that has a
catastrophic cancellation in its naive form. **If you write `exp(x) - 1` or
`log(1 + x)` you have almost certainly written a bug** for small `x`. In ML this
shows up immediately in `log(1 + exp(x))` (softplus), in log-sum-exp, in the
cross-entropy of a near-1 probability, and in `1 - sigmoid(x)`. Every framework's
`logsumexp` subtracts the max first for exactly this reason, and PyTorch's
`binary_cross_entropy_with_logits` exists so you never form the probability at
all.

## 4.3 Loss of associativity, and why parallel reductions differ run to run

Floating-point addition is **commutative** (`a+b == b+a`, guaranteed — the
rounding depends only on the exact sum) but **not associative**:
`(a+b)+c != a+(b+c)` in general, because each `+` rounds.

Verified — same 10 000 values, only the order changed:

```
forward   -3.3553985422967857e+19
reverse   -3.355398542296789e+19
|asc|     -3.3553985422967882e+19
pairwise  -3.3553985422967886e+19
Neumaier  -3.3553985422967882e+19   <- reference
forward vs reverse differ? 1   relative gap 9.77e-16
```

Now the version that matters for GPUs. Same one million `float`s, same data,
**only the number of chunks changed** — which is exactly what changes when you
change the number of threads, the block size, the GPU, or the cuBLAS/cuDNN
algorithm heuristic:

```
   1 chunks -> 1221.6908
   2 chunks -> 1221.68164
   4 chunks -> 1221.6665
   8 chunks -> 1221.66736
  16 chunks -> 1221.66968
  32 chunks -> 1221.67114
  64 chunks -> 1221.67395
 128 chunks -> 1221.67175
 256 chunks -> 1221.67188
```

Nine different answers. Nothing is wrong; every one of them is a correctly-
rounded evaluation of a different (equally valid) parenthesisation. This is why:

- **`torch.backends.cudnn.deterministic = True` exists**, and why setting it
  costs performance: it forces algorithm choices whose reduction tree does not
  depend on scheduling.
- **`atomicAdd`-based reductions are non-deterministic even on identical
  hardware**, because the order atomics land in is a race. Deterministic GPU
  reductions must use a fixed tree, not atomics.
- **Multi-GPU all-reduce results depend on the ring/tree topology** NCCL picks,
  which can vary with the number of ranks (see
  `ai-systems-distributed-training.md`).
- **"My loss diverged on the new cluster"** is very often this plus a
  `-ffp-contract` difference (§3.9), compounded over 10^5 steps by a chaotic
  optimiser.

Note the numbers *cluster* — spread ~2e−5 on a value of ~1221, i.e. ~2e−8
relative, about `√n · u` for n=10^6 in fp32. That is the expected random-walk
error growth, and it is a useful sanity check: if your reductions disagree by
much more than `√n·u`, something else is wrong.

## 4.4 Compensated summation

### The problem, quantified

Naive left-to-right summation of `n` values has the classic bound (Higham,
*Accuracy and Stability of Numerical Algorithms*, 2nd ed., Ch. 4):

```
|Ŝ - S|  ≤  (n-1)·u·Σ|xᵢ|  +  O(u²)
```

Two things to read off it. The error grows **linearly in n**. And it is
proportional to **Σ|xᵢ|**, the sum of *magnitudes*, not to `|S|`, the magnitude
of the sum. The ratio of those two is the **condition number of summation**:

```
κ = Σ|xᵢ| / |Σxᵢ|
```

If all terms have the same sign, κ = 1 and summation is perfectly conditioned —
you can only lose `n·u` relative. If the terms cancel heavily, κ blows up and no
algorithm can save you (see §4.6). Everything below is about attacking the `n`,
not the κ.

### Kahan summation

The idea: `s + y` throws away the low bits of `y` that did not fit. Recover them
and feed them back in on the next iteration.

```cpp
double kahan(const std::vector<double>& v) {
    double s = 0.0, c = 0.0;          // c = running compensation
    for (double x : v) {
        double y = x - c;             // apply the previous leftover
        double t = s + y;             // the lossy add
        c = (t - s) - y;              // RECOVER what got lost:  (t-s) is y-rounded
        s = t;
    }
    return s;
}
```

The line `c = (t - s) - y` is the whole algorithm. `t - s` is what *actually* got
added (exactly, by Sterbenz, when `|s| ≥ |y|`); subtracting the intended `y`
leaves exactly the discarded part. This is the **two-sum** primitive, and it is
why the code looks like something an optimiser should delete: algebraically
`(s + y - s) - y` is zero. It is not zero in floating point, and
`-fassociative-math` / `-ffast-math` **will** delete it. You must either compile
that translation unit without fast-math, mark the intermediates `volatile` (as
the verified code here does), or use `#pragma float_control` / an explicit
`-ffp-contract=off -fno-fast-math` on the file.

The bound (Higham, Ch. 4) becomes essentially **independent of n**:

```
Ŝ = Σ (1 + μᵢ) xᵢ ,   |μᵢ| ≤ 2u + O(n·u²)
```

You pay ~4× the arithmetic (4 flops per element instead of 1) and buy an error
bound that does not grow with the length of the sum.

### Neumaier's variant, and why Kahan is not enough

Kahan's `(t - s) - y` is exact only when `|s| ≥ |y|`. When a **later term is much
larger than the running sum**, the roles reverse and the compensation captures
the wrong quantity. Neumaier (1974) branches on which is larger and accumulates
the compensation separately, adding it in once at the end:

```cpp
double neumaier(const std::vector<double>& v) {
    double s = 0.0, c = 0.0;
    for (double x : v) {
        double t = s + x;
        if (std::fabs(s) >= std::fabs(x)) c += (s - t) + x;   // low bits of x lost
        else                              c += (x - t) + s;   // low bits of s lost
        s = t;
    }
    return s + c;                     // note: added ONCE, at the end
}
```

Verified on the canonical counterexample `[1, 1e100, 1, -1e100]`, exact answer 2:

```
naive     0
Kahan     0
Neumaier  2
```

Kahan gets it **as wrong as naive**. The `1e100` swamps `s`, the compensation
term captures the wrong side, and both 1s vanish. Neumaier gets it exactly right.
This is Python's `math.fsum` territory (which goes further, using Shewchuk's
exact expansion algorithm to get the *correctly rounded* sum), and it is the
example to show anyone who thinks "compensated summation" is one thing.

### Pairwise summation — what NumPy actually does

Compensated summation costs 4× the flops and defeats vectorisation. **Pairwise
(cascade) summation** costs essentially nothing and gets most of the benefit:
recursively split the array, sum the halves, add. The error bound becomes

```
|Ŝ - S|  ≤  u·⌈log₂ n⌉·Σ|xᵢ|  +  O(u²)
```

`log₂ n` instead of `n`. For n = 10^6 that is 20 instead of 10^6 — a factor of
50 000 — for the same number of additions, just in a different order.

NumPy's `np.sum` does exactly this. From `numpy/_core/src/umath/loops_utils.h.src`
(read verbatim from the numpy `main` branch):

```c
/*
 * Pairwise summation, rounding error O(lg n) instead of O(n).
 * The recursion depth is O(lg n) as well.
 */
static inline @type@
@TYPE@_pairwise_sum(char *a, npy_intp n, npy_intp stride)
{
    if (n < 8) {
        /*
         * Start with -0 to preserve -0 values.  The reason is that summing
         * only -0 should return -0, but `0 + -0 == 0` while `-0 + -0 == -0`.
         */
        @type@ res = -0.0;
        for (i = 0; i < n; i++) res += ...;
        return res;
    }
    else if (n <= PW_BLOCKSIZE) {          /* PW_BLOCKSIZE == 128 */
        @type@ r[8], res;
        /* sum a block with 8 accumulators
         * 8 times unroll reduces blocksize to 16 and allows vectorization with
         * avx without changing summation ordering */
        ...
        res = ((r[0] + r[1]) + (r[2] + r[3])) +
              ((r[4] + r[5]) + (r[6] + r[7]));
        ...
    }
    else {
        npy_intp n2 = n / 2;
        n2 -= n2 % 8;                       /* keep halves unroll-aligned */
        return @TYPE@_pairwise_sum(a, n2, stride) +
               @TYPE@_pairwise_sum(a + n2 * stride, n - n2, stride);
    }
}
```

Three things worth pointing at in that code, because each is a design decision a
student should be able to justify:

- **`res = -0.0` in the base case**, with a comment. Summing only `−0` must give
  `−0`, and `0 + -0 == 0` while `-0 + -0 == -0` (verified in §3.3). Starting the
  accumulator at `+0.0` would silently lose the sign. That is a four-word comment
  guarding a real IEEE-754 property.
- **8 independent accumulators inside a 128-element block.** This is *simultaneously*
  the accuracy fix and the performance fix: 8 accumulators break the loop-carried
  dependency chain (the addition latency of ~4 cycles no longer serialises the
  loop), allow AVX vectorisation, *and* reduce the effective sequential length
  from 128 to 16. Accuracy and speed pointing the same way, which is unusual and
  worth savouring.
- **`n2 -= n2 % 8`** so both halves stay unroll-aligned. Real code.

This is why `np.sum(a)` and `sum(a)` (the Python builtin) give different answers
on the same array, and why `np.sum` is the more accurate one. The behaviour is
documented in the `numpy.sum` docstring's Notes.

### Measured comparison

Crafted input: `1.0` followed by 10^7 copies of `1e-9`. Exact answer 1.01. The
running sum reaches ~1.0 immediately, after which each `1e-9` addend is ~9 orders
of magnitude smaller — right at the edge where fp64 starts dropping bits.

```
exact     1.01
naive     1.0100000008274037   err 8.27e-10
pairwise  1.01                 err 0
Kahan     1.01                 err 0
Neumaier  1.01                 err 0
```

Naive is wrong in the 9th significant digit; all three fixes are **exact**.
Note pairwise cost the same number of flops as naive.

Summary:

| Method | Flops/elem | Error bound | Vectorises | Used by |
|---|---|---|---|---|
| naive | 1 | `n·u·Σ|xᵢ|` | with `-fassociative-math` (which changes it to a different tree) | `sum()` in Python, most hand-written loops |
| pairwise | 1 | `log₂n·u·Σ|xᵢ|` | yes | `np.sum`, `np.mean`, Julia's `sum` |
| Kahan | ~4 | `2u·Σ|xᵢ|` | poorly (serial dependency) | HPC kernels, `-ffast-math`-free TUs |
| Neumaier | ~5 | `2u·Σ|xᵢ|`, robust to magnitude order | poorly | Julia's `sum_kbn`, careful libraries |
| Shewchuk / exact | O(k) per elem, k = expansion length | **correctly rounded** | no | Python `math.fsum` |

## 4.5 Condition number and backward stability, plainly

Two ideas, and the entire field of numerical analysis is the interaction of them.

**Condition number** is a property of the **problem**, not of your code. It asks:
*if I perturb the input by a relative ε, how much does the exact answer move,
relatively?* If the answer is `κ·ε`, the problem has condition number κ.

- Summation: `κ = Σ|xᵢ| / |Σxᵢ|`. Same-signed terms → κ = 1, benign. Massive
  cancellation → κ huge.
- Subtracting `x − y`: `κ = (|x| + |y|)/|x − y|`. For `x ≈ y` this is enormous —
  which *is* §4.2, restated.
- Solving `Ax = b`: `κ(A) = ‖A‖·‖A⁻¹‖`. This is the one everyone has heard of.

A problem with κ = 10^10 loses 10 decimal digits **no matter what algorithm you
use**, because your input already had rounding error in it. Condition number is a
budget, not a bug.

**Backward stability** is a property of the **algorithm**. An algorithm is
backward stable if the answer it computed is the *exact* answer to a *slightly
perturbed* problem:

```
computed answer  =  exact_f(x + Δx)   with  |Δx| / |x|  =  O(u)
```

It does not promise your answer is close to `f(x)`. It promises you did not add
any error beyond what a last-bit wobble in the input would have caused. That is
the strongest promise an algorithm can honestly make, because it cannot know your
input's true value.

The two combine into the rule that runs everything:

```
forward error   ≲   condition number  ×  backward error
```

This is why the residual test in §4.2 is the right diagnostic. The naive
quadratic root had a residual of 0.255 — a *large backward error*, meaning it is
not the exact root of any nearby polynomial, meaning the **algorithm** is
unstable. The stable form's residual was 1.1e−16 — it is the exact root of a
polynomial within one ulp of yours. If it is still not the answer you wanted, the
problem was ill-conditioned and no algorithm would have helped.

Teaching order matters here: **show the residual test before the theory.** "Plug
your answer back in and see if it satisfies the equation" is a thing a beginner
can do on day one, and it is exactly the backward error.

## 4.6 The bridge: why low-precision training needs stochastic rounding and high-precision accumulators

Everything above was fp64 and fp32, where u = 1e−16 or 6e−8 and the effects are
subtle. Drop to bf16 (8 mantissa bits, u ≈ 2e−3) or FP8 E4M3 (4 mantissa bits,
u ≈ 3e−2) or FP4 E2M1 (**2 mantissa bits including the implicit one**, u = 0.125)
and every effect above becomes a first-order phenomenon.

### Stagnation and drift, measured

Two distinct failure modes, both verified in fp32:

**(A) Stagnation — the update is smaller than half an ulp, so `x += d` is a no-op.**

```
acc=100000000.0  ulp=8  step=1  step < ulp/2? 1
after 1e6 adds of 1.0: 100000000.0   (exact would be 101000000.0)  -> ADD IS A NO-OP
```

One million additions. **Zero change.** The accumulator is not "slightly off", it
is frozen. This is exactly what happens to a weight `w` when the learning rate
times the gradient is below half an ulp of `w` — the parameter stops training
while the loop happily keeps running.

**(B) Drift — the step is a large fraction of an ulp, so rounding is biased.**

```
1e7 adds of float(1e-4) -> 1087.724243  (exact 999.999975, drift +8.77%)
ulp at the end = 0.00012207 ; step/ulp = 0.819 ; last add moved it by 0.00012207
```

`step/ulp = 0.819`: the true increment is 82% of an ulp, but round-to-nearest can
only move the accumulator by **whole ulps** (or zero). Here it moves by a full
ulp every time — 22% more than it should — and the error compounds to **+8.8%**
over 10^7 steps. Note this is a *systematic* bias, not a random walk: the error
grows like `n`, not `√n`. This is the mode that quietly ruins a training run,
because the loss still goes down, just to the wrong place.

### Stochastic rounding fixes exactly this

Round up with probability equal to the fraction of the way to the next
representable value:

```
round_stochastic(x) = ⌊x⌋_fp + ulp  with probability  (x - ⌊x⌋_fp)/ulp
                    = ⌊x⌋_fp        otherwise
```

The point is that it is **unbiased**: `E[round_stochastic(x)] = x` exactly.
Round-to-nearest is *deterministic* and therefore, on a correlated stream of
updates, systematically biased. Stochastic rounding trades a *larger* per-step
error for a *zero-mean* one, so errors random-walk (`√n`) instead of accumulating
(`n`) — and crucially, an update below half an ulp still lands sometimes instead
of never.

Verified, 100 000 additions of 0.001 into an accumulator truncated to a 7-bit
mantissa (bf16-like) after every step. Exact answer 100.0:

```
round-to-nearest-even       0.5000     rel err 0.995
stochastic rounding       101.0000     rel err 0.010
```

**Round-to-nearest gives 0.5. Stochastic rounding gives 101.** The nearest-even
accumulator stagnated at 0.5 within the first few hundred steps and never moved
again — a 99.5% error. Stochastic rounding tracks the true value to 1%.
Two orders of magnitude, from changing nothing but the rounding rule.

That is the entire argument for stochastic rounding in low-precision training,
and it is why:

- **Gradient accumulation and the master weights are kept in fp32 or fp16 even
  when the forward and backward passes are FP8/FP4.** The mixed-precision recipe
  (Micikevicius et al., *Mixed Precision Training*, arXiv 1710.03740) keeps an
  fp32 master copy of the weights precisely because the fp16 weight would
  stagnate against a small `lr·grad`. That paper's §3.1 shows a ~10% loss of
  accuracy without it.
- **Tensor Cores accumulate in a wider format than they multiply in.** FP16 in →
  FP32 accumulate; FP8 in → FP32 accumulate; NVFP4 in → FP32 accumulate. The
  accumulator width is not an afterthought, it is *the* design decision, and
  §4.4's error bounds are why: the dot product inside a GEMM is a summation of
  length K, and its error grows with K in the accumulator's precision.
- **Block scaling (MX/NVFP4) is the range half of the same problem.** Stochastic
  rounding and wide accumulators fix *precision* loss; a shared per-32-element
  E8M0 exponent fixes *range* loss, keeping every element inside FP4's tiny
  6-value magnitude ladder so the mantissa bits you do have are all being used.
  Two independent attacks on the two independent failure modes of §3 and §4.
- **Hardware support is now explicit.** Stochastic rounding is a rounding mode on
  Graphcore IPUs and in AMD's MI300 `V_CVT_*_SR_*` instructions; NVIDIA exposes
  it via PTX `cvt.rs` (round-stochastic) conversions on Blackwell, and
  `__nv_cvt_float_to_fp8` variants. It is a hardware feature because doing it in
  software costs an RNG call per element.

Recommended reading for this bridge, in order: Gupta et al., *Deep Learning with
Limited Numerical Precision* (arXiv 1502.02551) — the paper that introduced
stochastic rounding to DL and showed 16-bit fixed point training works *only*
with it; Micikevicius et al. 1710.03740 (mixed precision, loss scaling, master
weights); Croci et al., *Stochastic Rounding: Implementation, Error Analysis, and
Applications* (Royal Society Open Science, 2022) for the error theory — the key
result being that stochastic rounding's error grows like `√n·u` where
round-to-nearest's grows like `n·u` for correlated inputs. Then
`fp4-fp8-blackwell.md`.

---

# Part 5 — Text

Text is the same lesson as Part 1, told again: **bytes are not characters until
something decides how to read them.** The difference is that with numbers the
decision is made by the instruction, and with text it is made by an encoding
declared somewhere else entirely — in an HTTP header, a `<meta>` tag, a filesystem
convention, or nowhere at all.

## 5.1 ASCII

ASCII (ANSI X3.4, 1963, revised 1967) is **7 bits**: 128 codes, 0x00–0x7F.
Not 8. The eighth bit was a parity bit on the teletype lines it was designed for,
and that historical accident is why every 8-bit encoding since has had exactly
128 free slots to fight over.

Structure worth teaching, because it is deliberate and it still shapes code:

| Range | Contents |
|---|---|
| 0x00–0x1F | control characters (NUL, BEL, BS, TAB, LF, CR, ESC…) |
| 0x20 | space |
| 0x21–0x2F, 0x3A–0x40, 0x5B–0x60, 0x7B–0x7E | punctuation |
| 0x30–0x39 | digits `0`–`9` |
| 0x41–0x5A | `A`–`Z` |
| 0x61–0x7A | `a`–`z` |
| 0x7F | DEL (all bits punched out on paper tape) |

Two design choices that pay off constantly:

- **`'0'` is 0x30, so the low nibble of a digit *is* its value.** `c - '0'` works,
  and so does `c & 0x0F`. Digit parsing needs no table.
- **Uppercase and lowercase differ in exactly one bit, 0x20.** `'A'` = 0x41,
  `'a'` = 0x61. So `c | 0x20` lowercases, `c & ~0x20` uppercases, and
  `c ^ 0x20` flips case — for ASCII letters. This is why `tolower` is
  historically a single OR, why case-insensitive ASCII compare is fast, and why
  every "make it case-insensitive" shortcut breaks the moment a byte ≥ 0x80
  appears.

**The ASCII world is the one where `strlen` == character count**, and every
intuition built there is wrong everywhere else.

## 5.2 Code pages: the 128 slots everybody fought over

Once machines used 8-bit bytes there were 128 spare codes, and every language
community claimed them:

| Encoding | Claim |
|---|---|
| ISO-8859-1 (Latin-1) | Western European. 0xA0–0xFF are its accented letters. |
| ISO-8859-5 / KOI8-R | Cyrillic (two incompatible answers; KOI8-R ordered so that stripping bit 8 gives a readable Latin transliteration — a genuinely clever hack) |
| Windows-1252 | Latin-1 **plus** smart quotes and the em dash in 0x80–0x9F, where Latin-1 has controls. Not the same as Latin-1, and mislabelling one as the other is the source of the classic `â€™` for a right single quote. |
| Shift-JIS, EUC-JP, Big5, GBK | East Asian; **multi-byte**, with lead bytes that overlap ASCII punctuation ranges — Shift-JIS second bytes can be `0x5C` (`\`), which is why Japanese Windows paths broke C string parsers for decades |
| CP437 / CP850 | the DOS box-drawing characters |

The failure mode has a name: **mojibake** (文字化け, "character transformation") —
text decoded with the wrong table. It is not corruption; the bytes are intact.
You are reading them with the wrong ruler.

Two consequences that outlived the code pages themselves:

- **There is no way to mix scripts in one document.** A single byte cannot be both
  Cyrillic and Greek. Any multilingual text needed escape sequences (ISO-2022) or
  out-of-band switching.
- **Encoding is metadata that lives outside the data**, and metadata gets lost.
  This is the actual problem Unicode solves.

## 5.3 Unicode: four different things people call "a character"

Unicode's job is to assign one number to every character in every script, so the
encoding question separates from the identity question. But "character" turns out
to be four different concepts, and conflating them is where every text bug lives.

### 1. Code point

An integer in `U+0000` … `U+10FFFF`. That is **1 114 112** values (17 "planes" of
65 536; verified: `17 × 65536 = 1114112`). The upper bound is not principled — it
is **exactly what UTF-16 surrogate pairs can address**, and it was frozen there in
Unicode 2.0 to keep UTF-16 viable forever. Unicode is permanently capped by a
1990s encoding decision.

Planes worth knowing: plane 0 is the **BMP** (Basic Multilingual Plane, everything
you'd call ordinary text); plane 1 is the **SMP** (emoji, historic scripts,
musical notation); plane 2 is CJK extensions; planes 15–16 are private use.

### 2. Unicode scalar value

A code point **excluding the surrogate range** `U+D800`–`U+DFFF` (2048 values).
Verified: **1 112 064** scalar values. Surrogates are not characters; they are
UTF-16 plumbing that leaked into the code point space. They may never appear in
well-formed UTF-8 or UTF-32. This distinction is why Rust's `char` is a *scalar
value* (and `char::from_u32(0xD800)` returns `None`) while Python's `str` will
happily hold a lone surrogate — the two languages picked different sides.

### 3. Grapheme cluster

What a *user* would call a character: one or more code points that render as a
single unit. Defined by **UAX #29** (with "extended grapheme clusters" as the
default). Verified with real byte counts:

```
"hello"                      strlen= 5   codepoints= 5   graphemes=5
"café" (NFC)                 strlen= 5   codepoints= 4   graphemes=4
"café" (NFD, e + U+0301)     strlen= 6   codepoints= 5   graphemes=4
"😀"  U+1F600                strlen= 4   codepoints= 1   graphemes=1
👨‍👩‍👧 family (ZWJ sequence)      strlen=18   codepoints= 5   graphemes=1
🇬🇧 flag (regional indicators) strlen= 8   codepoints= 2   graphemes=1
"नन" U+0928 U+094D U+0928     strlen= 9   codepoints= 3   graphemes=1
```

Read the family emoji row: **18 bytes, 5 code points, 1 thing a user can delete
with one press of Backspace.** A flag is two "regional indicator" letters that
happen to render as a flag — which is why `"🇬🇧"[0]` in most languages gives you
half a flag, and why removing one character from a country list can turn two
flags into one different flag.

### 4. Glyph

What the font actually draws. Not a Unicode concept at all — it is a font/shaping
concept. One grapheme cluster can be several glyphs (a decomposed accent placed by
the shaper), and several graphemes can be **one** glyph (the `fi` ligature, Arabic
contextual joining, Devanagari conjuncts). The mapping is many-to-many and
font-dependent. **You cannot compute text width from Unicode data alone**; you
have to ask the shaper (HarfBuzz, CoreText, DirectWrite).

**The teaching rule:** count in bytes for storage, code points for parsing,
grapheme clusters for anything a user sees (cursor movement, truncation,
"140 characters"), and glyphs for nothing — ask the renderer.

### Surrogate pairs

UTF-16 encodes a code point above `U+FFFF` as two 16-bit units drawn from a
reserved block:

```
high (lead) surrogate: 0xD800 + ((cp - 0x10000) >> 10)     range D800..DBFF
low (trail) surrogate: 0xDC00 + ((cp - 0x10000) & 0x3FF)   range DC00..DFFF
decode:  cp = 0x10000 + (hi - 0xD800) * 0x400 + (lo - 0xDC00)
```

Verified: `U+1F600` → `D83D DE00` → back to `U+1F600`, and the emoji is **2 UTF-16
code units**.

The 20 bits addressable this way (`2^20 = 1048576`) plus the BMP's 65 536 gives
1 114 112 — which is exactly where `U+10FFFF` comes from. The two surrogate ranges
are disjoint and self-identifying, so UTF-16 *is* self-synchronising at the
16-bit-unit level; the design is not stupid, it is just a retrofit onto a format
that promised to be fixed-width and then wasn't.

The lasting damage: **Java, JavaScript, C#, and the Windows API all define
"string length" as UTF-16 code units.** `"😀".length` is **2** in JavaScript.
Java's `String.charAt` can return half a character. `substring` can split a
surrogate pair and produce an unpaired surrogate — a string that is not valid
Unicode and cannot be encoded to UTF-8. This is why JavaScript later added
`String.prototype.codePointAt`, `for...of` iteration over code points, and
`Intl.Segmenter` for graphemes: three successive apologies for one 1993 decision.

**WTF-8** and **CESU-8** exist to carry these broken strings: CESU-8 encodes each
surrogate separately (so an emoji becomes 6 bytes, not 4) and appears in some JVM
and Oracle serialisations; WTF-8 (Simon Sapin's spec) is UTF-8 extended to permit
unpaired surrogates, and is what Rust uses internally on Windows to round-trip
filenames the OS accepted but Unicode does not permit. Both are proof that the
surrogate leak never got cleaned up.

## 5.4 UTF-8, in full

UTF-8 (Ken Thompson and Rob Pike, on a New Jersey diner placemat, September 1992;
standardised as RFC 3629) is a variable-length encoding of scalar values into
1–4 bytes.

### The encoding table

| Scalar range | Bytes | Bit pattern | Payload bits |
|---|---|---|---|
| `U+0000`–`U+007F` | 1 | `0xxxxxxx` | 7 |
| `U+0080`–`U+07FF` | 2 | `110xxxxx 10xxxxxx` | 11 |
| `U+0800`–`U+FFFF` | 3 | `1110xxxx 10xxxxxx 10xxxxxx` | 16 |
| `U+10000`–`U+10FFFF` | 4 | `11110xxx 10xxxxxx 10xxxxxx 10xxxxxx` | 21 |

The code point's bits are written most-significant-first into the `x` positions.

Byte-role table — this is the one to memorise:

| Byte value | Binary | Role |
|---|---|---|
| `00`–`7F` | `0xxxxxxx` | ASCII, standalone |
| `80`–`BF` | `10xxxxxx` | **continuation** byte; never appears first |
| `C0`–`C1` | `1100000x` | **always invalid** (would be an overlong 2-byte form) |
| `C2`–`DF` | `110xxxxx` | lead of a 2-byte sequence |
| `E0`–`EF` | `1110xxxx` | lead of a 3-byte sequence |
| `F0`–`F4` | `11110xxx` | lead of a 4-byte sequence (`F5`–`F7` would exceed `U+10FFFF`) |
| `F5`–`FF` | | **always invalid** |

Verified round trips at every boundary:

```
U+00000 -> 1 bytes: 00
U+0007F -> 1 bytes: 7F
U+00080 -> 2 bytes: C2 80
U+007FF -> 2 bytes: DF BF
U+00800 -> 3 bytes: E0 A0 80
U+0FFFF -> 3 bytes: EF BF BF
U+10000 -> 4 bytes: F0 90 80 80
U+10FFFF -> 4 bytes: F4 8F BF BF
U+020AC -> 3 bytes: E2 82 AC        (the euro sign, the canonical example)
U+1F600 -> 4 bytes: F0 9F 98 80     (grinning face)
round-trip failures: 0
```

### Why it is superbly designed

Five properties, each verified below, and each one a deliberate consequence of
the bit patterns above rather than a happy accident.

**1. ASCII-compatible.** Any valid ASCII file is already a valid UTF-8 file, byte
for byte, with the same meaning. This is why UTF-8 could be deployed
incrementally over 30 years of existing files and protocols while UTF-16 required
a flag day. It is the single most important property, and it is why UTF-8 won.

**2. No ASCII byte appears inside a multi-byte sequence.** Every byte of a
multi-byte sequence has its top bit set. Verified across the whole scalar range:

```
any byte < 0x80 in a multibyte sequence? 0
```

The consequence is enormous: `strchr(s, '/')`, `strtok(s, ",")`, splitting on
newlines, matching `<` and `>` in an XML parser — **every byte-oriented ASCII
algorithm keeps working unmodified on UTF-8 text**, because a `/` byte can only
ever be a real `/`. Contrast Shift-JIS, where a second byte can be `0x5C`, and
every path-splitting routine is a latent bug.

**3. No embedded NULs.** Verified:

```
any 0x00 byte in a non-ASCII encoding? 0
```

`U+0000` is the only thing that encodes to a zero byte. So UTF-8 text is safe in
NUL-terminated C strings, in `execve` arguments, in POSIX filenames — every API
built on `char*`. UTF-16 text is full of zero bytes (every ASCII character has
one) and cannot travel through any of them. This alone made UTF-16 a non-starter
on Unix.

**4. Self-synchronising.** Lead bytes and continuation bytes are distinguishable
from each other by their top bits alone (`10xxxxxx` is *only* ever a
continuation). So from **any** byte offset you can find a character boundary by
scanning at most 3 bytes, in either direction, with no context. Verified —
starting at every offset of `"a£€😀z"`:

```
offset  0 (byte 61): next boundary at  0 (skipped 0)
offset  1 (byte C2): next boundary at  1 (skipped 0)
offset  2 (byte A3): next boundary at  3 (skipped 1)
offset  4 (byte 82): next boundary at  6 (skipped 2)
offset  7 (byte 9F): next boundary at 10 (skipped 3)   <- worst case
offset 10 (byte 7A): next boundary at 10 (skipped 0)
```

Maximum resync distance: 3 bytes. Practical consequences: a corrupted or dropped
byte loses **one** character, not the rest of the file; you can `mmap` a huge
file and start parsing at an arbitrary offset (which is how parallel/chunked
text processing and `grep` on huge inputs work); you can search *backwards*;
and a random seek in a log file recovers immediately. Almost no other
variable-length encoding has this — Shift-JIS does not.

**5. Byte order == code point order.** Sorting UTF-8 byte strings with `memcmp`
gives the same order as sorting by code point. Verified:

```
memcmp order == code point order? 1
```

This is not free — it is why the lead byte encodes the length in its *high* bits
in a monotonically increasing pattern (`0…`, `110…`, `1110…`, `11110…`). It means
a B-tree, a `sort(1)`, a `memcmp`-based index, or an ordered KV store gets
code-point ordering for nothing. (It is **not** linguistically correct
collation — "ä" sorts after "z" — that needs UCA/ICU. But it is a stable, total,
locale-independent order, which is what an index needs.)

Bonus property: **UTF-8 has no byte order**, so no BOM is needed. A UTF-8 BOM
(`EF BB BF`) is legal but discouraged by the Unicode standard, and it breaks
shebang lines, CSV headers, and JSON parsers. Windows tools emit it anyway.

### The validity rules, and why they are security-critical

A decoder must **reject**, not silently accept:

| Rejection | Example | Why |
|---|---|---|
| **Overlong forms** | `C0 AF` for `/` | An encoder must use the *shortest* form. `C0 AF` and `2F` would both mean `/`; if your security filter checks for `2F` and your filesystem accepts `C0 AF`, you have a directory traversal. |
| **Surrogates** | `ED A0 80` for `U+D800` | Not scalar values. Accepting them lets UTF-16-based and UTF-8-based components disagree about what a string is. |
| **> U+10FFFF** | `F4 90 80 80`, or any `F5`–`FF` lead | Outside Unicode. The old 5- and 6-byte forms of the original UTF-8 are prohibited by RFC 3629. |
| **Truncated sequences** | `E2 82` | Incomplete at end of buffer. Must not be treated as a valid 2-byte character. |
| **Bad continuation** | `E2 41 41` | A non-`10xxxxxx` byte where a continuation was required. |
| **Lone continuation** | `80`, `BF` | A continuation byte with no lead. |

The overlong rule is the one with CVEs attached. **MS00-078 / CVE-2000-0884**
(the IIS "Web Server Folder Traversal" bug) was exactly this: IIS checked the URL
for `../` *before* decoding UTF-8, and an overlong encoding of `/` slipped
through and was decoded afterwards. The general lesson — *validate after
canonicalisation, never before* — generalises far past UTF-8.

Verified decoder results, all 22 adversarial cases:

```
[PASS] OVERLONG '/' 2-byte          C0 AF           -> OVERLONG
[PASS] OVERLONG NUL 2-byte          C0 80           -> OVERLONG
[PASS] OVERLONG '/' 3-byte          E0 80 AF        -> OVERLONG
[PASS] OVERLONG '/' 4-byte          F0 80 80 AF     -> OVERLONG
[PASS] OVERLONG max 2-byte          C1 BF           -> OVERLONG
[PASS] SURROGATE U+D800             ED A0 80        -> SURROGATE
[PASS] SURROGATE U+DFFF             ED BF BF        -> SURROGATE
[PASS] CESU-8 pair (1st half)       ED A0 BD        -> SURROGATE
[PASS] TOO BIG U+110000             F4 90 80 80     -> TOO_BIG
[PASS] 5-byte lead                  F8 88 80 80 80  -> BAD_LEAD_BYTE
[PASS] TRUNCATED 3-byte, 2 given    E2 82           -> TRUNCATED
[PASS] TRUNCATED 4-byte, 1 given    F0              -> TRUNCATED
[PASS] BAD CONT (ASCII after lead)  E2 41 41        -> BAD_CONTINUATION  used=1
[PASS] LONE CONTINUATION 0x80       80              -> BAD_LEAD_BYTE
[PASS] LONE CONTINUATION 0xBF       BF              -> BAD_LEAD_BYTE
[PASS] 0xFE / 0xFF                  FE / FF         -> BAD_LEAD_BYTE
adversarial failures: 0
```

Note `used=1` on the bad-continuation case: a correct decoder consumes only up to
the offending byte and resynchronises there, rather than swallowing the whole
malformed sequence. That is the **"maximal subpart"** rule from Unicode 15.1
§3.9, and it is what determines how many `U+FFFD` replacement characters a
lenient decoder emits — WHATWG's encoding spec and Rust's `String::from_utf8_lossy`
follow it; some older decoders emit one `U+FFFD` per malformed *sequence* instead
of per maximal subpart, which is an observable difference between browsers.

The simplest correct implementation shape (verified above, in full):

```cpp
if      (b0 < 0x80)           { cp = b0; return 1; }              // ASCII
else if ((b0 & 0xE0) == 0xC0) { len=2; v=b0&0x1F; lo=0x80;    }   // 110xxxxx
else if ((b0 & 0xF0) == 0xE0) { len=3; v=b0&0x0F; lo=0x800;   }   // 1110xxxx
else if ((b0 & 0xF8) == 0xF0) { len=4; v=b0&0x07; lo=0x10000; }   // 11110xxx
else                          { return BAD_LEAD; }
for (i=1; i<len; ++i) {
    if ((p[i] & 0xC0) != 0x80) return BAD_CONT;   // must be 10xxxxxx
    v = (v << 6) | (p[i] & 0x3F);
}
if (v < lo)                    return OVERLONG;   // <-- the one everyone forgets
if (v >= 0xD800 && v <= 0xDFFF) return SURROGATE;
if (v > 0x10FFFF)              return TOO_BIG;
```

The `lo` variable — the minimum scalar value for this length — is the entire
overlong check, and it is three characters of code. It is left out of a
depressing number of hand-rolled decoders.

## 5.5 Normalisation

The same visible text can have more than one code point sequence, because
Unicode contains both precomposed characters and combining marks.

```
"café" NFC:  63 61 66 E9              4 code points, 5 UTF-8 bytes
"café" NFD:  63 61 66 65 0301         5 code points, 6 UTF-8 bytes
NFC == NFD as strings?  False
NFC(NFD form) == NFC form?  True
```

Two byte sequences, identical on screen, unequal under `==`. This is the bug
behind "I can't log in but my password is definitely right" (macOS's HFS+
stored filenames in NFD, everyone else uses NFC), and behind duplicate rows in
databases that use a binary collation.

The four normalisation forms:

| Form | Operation |
|---|---|
| **NFD** | canonical **D**ecomposition — split precomposed characters into base + combining marks, then apply canonical ordering |
| **NFC** | decompose (NFD) then canonically **C**ompose — the practical default |
| **NFKD** | **k**ompatibility decomposition — also collapses formatting distinctions |
| **NFKC** | compatibility decompose then compose |

Canonical (NFC/NFD) transformations are **lossless**: the forms represent the
same abstract character and you can go back and forth. Compatibility (NFK*) ones
are **lossy** — they discard real information. Verified:

```
'ﬁ'  NFC: 'ﬁ'   NFKC: 'fi'          ligature -> two letters
'①'  NFC: '①'   NFKC: '1'
'Ⅻ'  NFC: 'Ⅻ'   NFKC: 'XII'         Roman numeral -> three letters
'㍿' NFC: '㍿'  NFKC: '株式会社'      one code point -> four
'²'  NFC: '²'   NFKC: '2'           superscript -> digit
```

Use NFC for storage and comparison. Use NFKC only for *matching* — search
indexes, username uniqueness (so `ⅼоɡin` with lookalikes can't impersonate
`login`) — never for storage, because it destroys the user's actual text. (The
identifier-security question has its own document, UTS #39.)

Three subtleties worth showing:

**Canonical ordering of combining marks.** Two combining marks on one base can be
typed in either order. NFD sorts them by *canonical combining class*, so both
normalise to the same thing. Verified: `q` + dot-above + dot-below vs `q` +
dot-below + dot-above are **unequal as strings** but **equal after NFD**, because
dot-above has class 230 and dot-below has class 220, and NFD puts 220 first.

**Singletons.** `U+212B` ANGSTROM SIGN normalises under NFC to `U+00C5`
LATIN CAPITAL LETTER A WITH RING ABOVE — a *different code point*, not a
composition. Verified. So NFC is not "compose everything"; it also collapses
deliberate duplicates that exist for round-tripping with legacy encodings.

**Normalisation does not distribute over concatenation.** Verified:
`NFC("a") + NFC("́b") != NFC("a" + "́b")` — the combining acute at the start of the
second piece composes with the `a` across the join, giving `U+00E1 U+0062`. So
you cannot normalise chunks of a stream independently, which is a real problem
for streaming decoders and is why ICU's normalizer has an explicit
"is this a safe boundary" query.

Related but distinct: **case folding is not lowercasing**. Verified:
`'ß'.upper()` is `'SS'` (one code point becomes two — string length changes under
case mapping), and `'İ'.lower()` is `'i' + U+0307` (two code points). Case
mapping is also **locale-dependent**: in Turkish, `'I'.lower()` is dotless `'ı'`.
The infamous consequence is that `"TITLE".toLowerCase()` differs on a Turkish
locale, which has broken HTML parsers, config readers, and at least one Android
release. Use `casefold` (locale-independent, designed for comparison) rather than
`lower` when comparing.

## 5.6 Why `strlen` isn't character count

`strlen` counts **bytes up to the first NUL**. Nothing more. Verified above:
`strlen("café")` is 5 in NFC and 6 in NFD; the family emoji is 18 bytes and one
user-perceived character.

What every language's "length" actually means:

| Language | `len`/`length`/`count` returns |
|---|---|
| C `strlen`, Go `len(s)`, Rust `s.len()` | **bytes** |
| Python 3 `len(s)` | **code points** |
| Rust `s.chars().count()` | **scalar values** |
| Java, JavaScript, C#, Windows `wcslen` | **UTF-16 code units** (so `"😀".length == 2`) |
| Swift `s.count` | **grapheme clusters** (so `"👨‍👩‍👧".count == 1`) |
| Elixir `String.length/1` | grapheme clusters |

Swift is the only mainstream language whose *default* answer matches user
intuition, and it pays for it: `s.count` is **O(n)**, and Swift has no O(1)
integer subscript on `String` at all — you must use `String.Index`. That is the
honest trade, and it is a good discussion to have with students: **you can have
O(1) indexing, or you can have indices that mean what users think they mean, but
not both**, unless you keep an auxiliary index structure.

Practical rules:

- **Never truncate a string by bytes.** `s[:100]` on UTF-8 bytes can split a
  sequence and produce invalid text. Truncate at a grapheme boundary, or at
  minimum a code point boundary (scan back while `(b & 0xC0) == 0x80`).
- **Never reverse a string by code points.** Reversing "café" in NFD moves the
  combining accent onto the `f`.
- **Database `VARCHAR(n)`** counts different things in different engines:
  PostgreSQL counts code points, MySQL's `utf8mb4` counts code points but
  allocates bytes, Oracle counts bytes or characters depending on
  `NLS_LENGTH_SEMANTICS`. "Max 255 characters" is not a well-defined constraint.
- **Twitter/X's "280 characters"** is defined in terms of a weighted count over
  code point ranges, not `strlen`, not `length`, not graphemes. Every text-length
  limit in a real product ends up with a custom definition, which is itself the
  lesson.

## 5.7 The practical position

Adopt **UTF-8 everywhere** (utf8everywhere.org states the case at length):

- Use UTF-8 for all storage, all interchange, all APIs. Decode at the boundary,
  encode at the boundary, and hold UTF-8 in between.
- Do not use `wchar_t`; it is 16 bits on Windows and 32 on Unix, so it is
  portable in name only. C++20's `char8_t`/`std::u8string` exist but the library
  support around them is thin; `std::string` holding UTF-8 is what real code does.
- On Windows, call the `…W` APIs and convert at the call, or set the process
  code page to UTF-8 via the application manifest (`activeCodePage`, Windows
  10 1903+) and use the `…A` APIs.
- Validate untrusted UTF-8 on input with a decoder that rejects all six malformed
  classes above, and normalise (NFC) at the same boundary.
- Never assume a byte offset is a character offset, and never assume a
  code point is a character.

---

# Part 6 — Curriculum

Four units, in dependency order. Each has **one** idea; everything else in the
unit is evidence for it. The units are deliberately front-loaded: Unit 1's idea
is the same idea as Unit 2's and Unit 4's, applied to progressively harder
material, and by Unit 4 the learner should recognise it without being told.

Placement in the wider curriculum: Unit 1 sits immediately after
`nand2tetris-eater-scott.md` (you have just built an adder; now learn why its
one adder does signed and unsigned both). Units 3 and 4 are hard prerequisites
for `fp4-fp8-blackwell.md` and for the mixed-precision sections of
`ai-systems-distributed-training.md`. Unit 2 is a prerequisite for
`networking-and-internet.md` and `storage-filesystems-engines.md`.

## Unit 1 — Integers

> **The one idea: a byte has no type. The instruction that reads it supplies the
> type, and the language's rules decide which instruction that is.**

Same eight bits `0xFF` are −1 or 255. Same `add` instruction is signed and
unsigned addition. Same C expression is defined or undefined depending on the
declared type of a variable you can't see from the expression. Once a learner
believes this, integer promotion stops being trivia and becomes the obvious
consequence it is.

Sequence: two's complement from the weighted-bit definition → the one-adder
consequence (link back to the ALU they built) → one zero → `INT_MIN`'s asymmetry
→ sign vs zero extension → **signed overflow as UB** → unsigned wraparound bugs →
promotion and the usual arithmetic conversions → saturating arithmetic →
fixed point → forward reference to per-block scaling.

**Do not** teach "invert and add one" as the definition. Teach the weighted-bit
formula; invert-and-add-one is then something the learner can *derive*, and the
derivation is where the understanding is.

### Exercises

**EX1.1 — Two's complement from first principles.** *(verified: `EX1.1 PASS`)*
Implement `long long value(uint32_t bits)` using only the weighted-bit
definition — a loop over bits 0..30 adding `2^i`, then subtracting `2^31` if the
top bit is set. No casts to `int32_t`. The grader asserts:
- agreement with the compiler's own reinterpretation for a set of patterns
  including `0x80000000` and `0xFFFFFFFF`;
- `a - b == a + ~b + 1` for all tested pairs, as `uint32_t` (subtraction is
  addition of the negation);
- exactly **one** bit pattern in `[0, 2^20)` maps to zero.

**EX1.2 — The traps, asserted.** *(verified: `EX1.2 PASS`)*
Write `bool bounds_ok(size_t off, size_t len, size_t size)` that is correct for
*every* `size_t` input. The grader asserts it rejects `(10, SIZE_MAX, 100)` — and
asserts that the naive `off + len <= size` **accepts** it, so the learner sees
the attack land. Plus static assertions on `(-1 < 1u) == false`,
`sizeof(unsigned short * unsigned short) == sizeof(int)`, and
`(int)(int8_t)-1 != (int)(uint8_t)0xFF`.

**EX1.3 — Watch the optimiser use your UB.** *(verified, §1.2)*
Given this program, predict the output, then run it under three builds:

```cpp
int __attribute__((noinline)) f(int x) { return x + 1 > x; }
int main() {
    volatile int m = INT_MAX;
    printf("%d\n", f(m));
    int i, n = 0;
    for (i = INT_MAX - 2; i >= 0; ++i) { if (++n > 10) break; }
    printf("%d %d\n", n, i);
}
```

The harness compiles with clang 20.1.0 at `-O0`, `-O2`, and `-O2 -fwrapv`, and
asserts that **the three outputs are not all equal** (verified: `0/3`, `1/11`,
`0/3`). Then it compiles `bool g(int x){return x+1>x;}` at `-O2` and asserts the
assembly contains `mov eax, 1` — the compiler literally never reads `x`. Then it
re-runs with `-fsanitize=signed-integer-overflow` and asserts a diagnostic is
produced. Grading is on the *prediction* the learner wrote down first.

## Unit 2 — Bytes on the wire: endianness and UTF-8

> **The one idea: a byte stream is a serialisation format, and both numbers and
> text need an explicit, validating decode. Never reinterpret memory — decode it.**

Putting endianness and UTF-8 in one unit is deliberate: they are the same
problem. In both cases someone must decide how a value maps to a byte sequence,
that decision must be written down somewhere outside the bytes, and the decoder
must **reject** byte sequences that do not correspond to any valid value. In both
cases the "obvious" shortcut (cast a pointer / assume one byte is one character)
is the bug.

Sequence: big vs little endian → network byte order → where it bites (wire
formats, `fwrite` of a struct, hashes, bitfields) → the shift-based idiom and its
zero cost → punning: `memcpy` / `bit_cast` legal, pointer cast UB, union legal in
C only → then the same story for text: ASCII → code pages and mojibake → Unicode's
four "characters" → surrogate pairs → **UTF-8 in full** → the five design
properties → the six validity rules and MS00-078 → normalisation → `strlen`.

### Exercises

**EX2.1 — Portable serialisation, and prove it's free.** *(verified: `EX2.1 PASS`)*
Implement `store_be32` / `load_be32` / `store_le32` / `load_le32` using only
shifts and masks. The grader asserts round-trips; asserts the *byte layout* is
fixed (`store_be32(b, 0x01020304)` gives `01 02 03 04` in memory); and asserts
that big-endian keys are `memcmp`-orderable while little-endian ones are not
(`memcmp` on LE-encoded 1 vs 256 returns > 0 — the wrong order). Then the harness
fetches the assembly for `load_le32`/`load_be32` at `-O2` and asserts they are
one `mov` and one `mov` + `bswap` respectively — **the portable code compiled to
the optimal code**. Finally, assert `bit_cast<uint32_t>(1.0f) == 0x3F800000`.

**EX2.2 — A UTF-8 decoder that rejects everything it should.**
*(verified: `EX2.2 PASS`, 16 round trips + 22 adversarial cases, 0 failures)*
Implement `int decode(const uint8_t* p, size_t n, uint32_t* cp, Err* err)`
returning bytes consumed. The grader runs a fixed suite:
- **round trip** every boundary scalar value: `U+0000`, `U+007F`, `U+0080`,
  `U+07FF`, `U+0800`, `U+D7FF`, `U+E000`, `U+FFFF`, `U+10000`, `U+10FFFF`;
- **reject overlong**: `C0 AF`, `C0 80`, `C1 BF`, `E0 80 AF`, `F0 80 80 AF`;
- **reject surrogates**: `ED A0 80`, `ED BF BF`, `ED A0 BD`;
- **reject out of range**: `F4 90 80 80`, and the 5-byte lead `F8 …`;
- **reject truncated**: `E2 82`, `F0`;
- **reject bad continuation**: `E2 41 41` — and assert `used == 1`, so the decoder
  resynchronises at the offending byte rather than swallowing the sequence
  (the Unicode 15.1 §3.9 "maximal subpart" rule);
- **reject lone continuations and never-valid bytes**: `80`, `BF`, `FE`, `FF`.

Then assert the design properties: no encoding of a scalar ≥ `U+0080` contains a
byte < `0x80`; none contains a `0x00`; sorting the encodings with `memcmp` gives
code-point order.

The overlong check is one line — `if (v < lo) return OVERLONG;` — and it is the
line most submissions omit. Grade specifically on it, and show MS00-078
afterwards.

**EX2.3 — Count four ways.** For `"hello"`, `"café"` in NFC and NFD, `"😀"`, a
ZWJ family emoji, and a regional-indicator flag, report bytes / code points /
grapheme clusters. Grader asserts the byte and code point counts (verified:
5/5, 5/4, 6/5, 4/1, 18/5, 8/2). Grapheme counts are *discussed*, not
auto-graded — see the caveat in §7. Then: assert
`NFC("café") != NFD("café")` as byte strings but equal after normalising, and
that `NFC(x) + NFC(y) != NFC(x + y)` for `x = "a"`, `y = U+0301 + "b"`.

## Unit 3 — IEEE-754

> **The one idea: floating point is a logarithmically-spaced lattice, and every
> operation lands on the lattice point nearest the exact answer. Almost all
> surprises follow from the spacing changing with magnitude.**

Not "floats have errors". A learner who holds *lattice + nearest* can predict
`1e16 + 1 == 1e16`, predict that `0.1 + 0.2` is one ulp off `0.3`, predict
stagnation, and predict why FMA helps — instead of memorising each as a
curiosity.

Sequence: sign/exponent/mantissa → bias, and why biased not two's complement →
the implicit leading 1 → the decode table → subnormals and gradual underflow →
the subnormal performance cliff and FTZ/DAZ → signed zeros → infinities →
NaN, quiet vs signalling, payloads, `NaN != NaN` → the five rounding modes and
why ties-to-even → epsilon vs ULP → correct comparison → which ops are correctly
rounded → **FMA** → `-ffast-math` and exactly what it discards.

### Exercises

**EX3.1 — Decode a float by hand.** *(verified: `EX3.1 PASS`)*
Implement `double decode_float(uint32_t bits)` from the decode table alone —
extract `s`, `e`, `m`; handle `e == 0` (subnormal, `0.M × 2^(1-bias)`),
`e == 255` (Inf/NaN), and the normal case (`1.M × 2^(E-bias)`). The grader
asserts **exact** equality (`==`, not a tolerance) with the compiler's own value
for 14 floats including `FLT_MIN`, `denorm_min`, `-0.0` and `0.1f`.

The trap to grade on is the subnormal exponent: it is `2^(1-bias)`, **not**
`2^(0-bias)`. The assertion that catches it is
`decode(0x00800000) - decode(0x007FFFFF) == denorm_min` — the largest subnormal
and the smallest normal must be exactly one ulp apart. Get the exponent wrong by
one and everything else still passes.

Follow-up, no code: hand-decode `0x3DCCCCCD` on paper and explain why it ends in
`CD` and not `CC`.

**EX3.2 — Make FMA change the answer.** *(verified: `EX3.2 PASS`)*
With `A = 1e8 + 1`, `B = 1e8`, assert:
- `A*A - B*B` and `fma(A, A, -(B*B))` have **different bit patterns**;
- the fused one equals `200000001.0` exactly, the naive one `200000000.0`;
- the fused one agrees with the stable algebra `(A-B)*(A+B)`.

Then the two-product primitive: with `u = sqrt(2)`, `v = sqrt(3)`, assert
`fma(u, v, -(u*v)) != 0` and that its magnitude is under one ulp of `u*v` — the
learner has just computed the *exact* rounding error of a multiplication.
Compile with `-ffp-contract=off` so the naive form is genuinely not fused.

Extension: recompile at `-O2 -mfma` **without** `-ffp-contract=off`, fetch the
assembly for `double f(double a,double b,double c){return a*b+c;}`, and assert it
contains `vfmadd`. The compiler fused it without being asked. That is why
cross-machine bit-reproducibility needs `-ffp-contract=off`.

**EX3.3 — The subnormal cliff.** *(verified: `EX3.3 PASS`, three independent
runs: 60.5× / 43.7× / 58.8× IEEE, 0.92× / 0.95× / 1.15× with FTZ)*
One binary, one dataset, one machine. Time `o[i] = a[i]*b[i] + a[i]` over a
normal-valued array and a subnormal-valued array, with `MXCSR`'s FTZ+DAZ off,
then on. Assert:
- `ratio_ieee > 5.0` (the cliff is real);
- `ratio_ftz < 2.0` (FTZ removes it);
- `ratio_ieee > 3.0 * ratio_ftz` (the effect is attributable to those two bits,
  not to noise).

**Platform requirements for this exercise, which apply to any timing exercise on
Compiler Explorer:**

1. **Inject a unique nonce comment into every submission.** Verified directly:
   submitting byte-identical source three times returned `elapsed 0.269293` three
   times — the *same* six decimal places, i.e. a cached result, not a
   re-execution. The same source with a UUID comment prepended returned
   `0.271227`, `0.357243`, `0.268532` on three submissions. Without the nonce a
   student's "before" and "after" measurements are literally the same run.
2. **Assert on ratios, never absolute times.** The runner is shared; the
   observed spread on a single configuration reached 2.7× (0.31 s vs 0.83 s in
   §3.2).
3. **Take the minimum of ≥ 3 trials** for each side of the ratio. Minimum, not
   mean: the noise is one-sided (contention only ever makes it slower).
4. **Warm up once before timing**, and keep the working set small enough to stay
   in cache so the measurement is about the FPU, not the memory system.

## Unit 4 — Numerical stability, and the bridge to low precision

> **The one idea: forward error ≈ condition number × backward error. The
> condition number belongs to the problem and you cannot change it; the backward
> error belongs to your algorithm and you can.**

This reframes "floating point is inaccurate" into two separable questions, and it
is the frame that makes low-precision training comprehensible rather than
alarming. It also gives the learner a tool they can use on day one — the residual
test — before any theory.

Sequence: `0.1 + 0.2` explained properly → catastrophic cancellation (quadratic
formula, variance two ways, `expm1`/`log1p`) → the residual test → loss of
associativity → parallel reductions differ → the error bounds for naive /
pairwise / Kahan / Neumaier → condition number and backward stability → **the
bridge**: stagnation and drift measured in fp32, stochastic rounding, wide
accumulators, block scaling → hand off to `fp4-fp8-blackwell.md`.

Teach the residual test *before* the theory. "Plug your answer back into the
equation" is accessible immediately and it *is* backward error.

### Exercises

**EX4.1 — Beat naive summation, and then break Kahan.**
*(verified: `EX4.1 PASS`; measured errors: naive 8.27e−10, pairwise 0,
Kahan 0, Neumaier 0)*
Input: `1.0` followed by 10^7 copies of `1e-9`; exact answer 1.01. Implement
naive, pairwise, Kahan and Neumaier. Assert:
- `err(naive) > 1e-10` — the naive one is measurably wrong;
- `err(kahan) == err(neumaier) == err(pairwise) == 0` — all three are exact;
- `err(naive) > 1e6 * err(kahan)` — a huge, unambiguous margin.

Then the second input `[1, 1e100, 1, -1e100]`, exact answer 2. Assert
`naive == 0`, **`kahan == 0`**, `neumaier == 2`. Kahan fails *identically to
naive*. This is the point of the exercise: "use Kahan summation" is not a
complete answer, and the learner should be able to say why (the compensation
`(t-s)-y` is only exact when `|s| ≥ |y|`).

Build note: compile this translation unit **without** `-ffast-math` and with the
intermediates `volatile`. `-fassociative-math` deletes the compensation term,
because algebraically it is zero. Have the harness also compile it *with*
`-ffast-math` and assert the Kahan assertions now **fail** — that is the most
memorable possible demonstration of §3.10.

**EX4.2 — Variance two ways.** Generate 100 000 samples of `N(1e9, 1)`.
Implement the one-pass `(Σx² − (Σx)²/n)/(n−1)` formula, the two-pass formula,
and Welford. Assert the one-pass answer is off by more than 1000× (verified:
**13086** vs a true variance of ~1.0) and that Welford agrees with two-pass to
6 significant figures. Then reduce the offset from 1e9 to 0 and assert all three
now agree — the *algorithm* did not change, the *conditioning* did. That
contrast is the whole unit in one exercise.

**EX4.3 — Your reduction tree is an input.** Sum one million `float`s in
`k` chunks for `k` in {1, 2, 4, …, 256}, chunk-first then combine. Assert the
results are **not all equal** (verified: 9 distinct values, spread ~2e−8
relative) and that the spread is under `10 * sqrt(n) * FLT_EPSILON` — i.e. the
disagreement is exactly the expected random-walk size, not a bug. Discussion:
which line of your PyTorch config makes this go away, and what it costs.

**EX4.4 — Stagnation, drift, and stochastic rounding.** *(verified, §4.6)*
Three parts.
1. Assert that `float acc = 1e8f; for (1e6 times) acc += 1.0f;` leaves `acc`
   **exactly** `1e8f` — one million additions, zero effect — and that this is
   predicted by `1.0f < ulp(1e8f)/2 == 4`.
2. Assert that summing 10^7 copies of `1e-4f` gives ~1087.7, not ~1000 — a
   **+8.8% systematic drift**, and that `step/ulp ≈ 0.82` at the end while the
   last addition moved the accumulator by a full ulp.
3. Implement `rn_trunc(x, keep)` (round-to-nearest-even to `keep` mantissa bits)
   and `sr_trunc(x, keep)` (stochastic: round up with probability equal to the
   discarded fraction). Accumulate 100 000 additions of `0.001` through each with
   `keep = 7` (bf16-like). Assert the nearest-even accumulator's relative error
   exceeds 0.5 and the stochastic one's is under 0.05. Verified: **0.5000 vs
   101.0000** against an exact 100.0 — 99.5% error versus 1%.

This is the exercise that earns `fp4-fp8-blackwell.md`. Run it, then read that
file's discussion of E8M0 block scales and NVFP4, and the design will read as
inevitable rather than arbitrary.

## Harness notes

The Compiler Explorer HTTP API is a good grader: it compiles *and runs*, returns
stdout/stderr/exit status *and* assembly, needs no local toolchain, and pins the
compiler version so results are reproducible across students' machines.

```
POST https://godbolt.org/api/compiler/<id>/compile
Content-Type: application/json
Accept: application/json

{
  "source": "// nonce <uuid>\n#include ...",
  "options": {
    "userArguments": "-O2 -std=c++20",
    "executeParameters": { "args": [], "stdin": "" },
    "compilerOptions": { "executorRequest": true, "skipAsm": true },
    "filters": { "execute": true, "intel": true, "labels": true,
                 "directives": true, "commentOnly": true, "demangle": true },
    "tools": [], "libraries": []
  },
  "lang": "c++", "allowStoreCodeDebug": false
}
```

- `GET /api/compilers/c++?fields=id,name,supportsExecute,instructionSet` lists
  compilers. There are 1197 C++ compilers; **441 execute and target amd64**.
  Verified working ids: `g152` (gcc 15.2), `clang2010` (clang 20.1.0), plus the
  whole `g10x`–`g16x` and `clang*` families. There are **no non-amd64 executable
  targets**, so a big-endian demonstration must be reasoned about, not run.
- Set `"executorRequest": true` to run. Set `"skipAsm": false` in the same
  request when you also want the assembly for an assembly assertion.
- **Assertion-based grading**: have the student's program `assert()` and check
  `execResult.code`. A failed `assert` gives a non-zero exit and a message on
  stderr, which is a complete grader with no extra machinery.
- **The nonce is mandatory for anything timed** — see EX3.3's platform note.
  It costs one line and it is the difference between measuring and not.
- Watch the wall-clock limit: a loop of ~2×10^9 iterations gets the request
  killed. Keep exercise workloads to ≲ 10^8 simple operations.
- Compile with `-Wall -Wextra` in the grader and surface the warnings to the
  student. Several of this file's traps (`-Wsign-compare`, `-Wstrict-aliasing`,
  `-Wtype-limits`) are already diagnosed; letting students see the warning fire
  on their own broken code is worth more than the prose.

---

# Part 7 — What I could not verify

Listed honestly. Everything not in this section was executed, compiled, or read
in a primary source.

**Could not run:**

1. **Big-endian behaviour.** Compiler Explorer has no executable non-amd64
   target (verified: zero executable compilers with `instructionSet != amd64`).
   Every big-endian claim in Part 2 — that `htonl` is the identity there, that
   GCC packs the first-declared bitfield into the high bits, that mixed-endian
   FPUs existed — is from documentation and from the ABI specs, not from a run.
   A student who wants to see it needs QEMU (`qemu-s390x`) or a cross-compiler
   plus emulator.
2. **The `-ffast-math` shared-library contamination story.** I verified that
   linking an **executable** with `-ffast-math` sets FTZ+DAZ in `MXCSR` at
   startup (0x1FAA → 0x9FF8). I did **not** build a shared library with
   `-ffast-math`, `dlopen` it from a clean program, and observe the process's
   `MXCSR` change — CE compiles a single translation unit. The historical
   claim (GCC adding `crtfastmath.o` to shared libraries, and GCC bug 55522
   restricting it in GCC 13) is from the GCC bug tracker and changelogs, not
   from my own experiment.
3. **`-ftrapv`'s patchiness.** I asserted GCC's `-ftrapv` is unreliable and
   recommended UBSan instead. This is the widely-reported state of affairs (there
   are long-standing GCC bugs about it) but I did not construct a case where
   `-ftrapv` fails to trap.
4. **GPU subnormal behaviour.** The claims about CUDA's `-ftz` default,
   `__fdividef`, and Tensor Core subnormal handling come from the CUDA
   programming guide and PTX ISA, cross-checked against the notes in
   `cuda-programming-tuning.md` and `fp4-fp8-blackwell.md`. I have no GPU here.
5. **The grapheme cluster counts in §5.3.** The byte counts and code point counts
   were computed by my own decoder and are verified. The **grapheme** counts are
   my assertions from reading UAX #29, not the output of a UAX #29 segmenter — I
   did not link ICU. The ZWJ-family and regional-indicator cases are
   uncontroversial; the Devanagari `U+0928 U+094D U+0928` case (which I claim is
   one cluster) depends on the "extended" vs "legacy" cluster definition and on
   whether the implementation applies the Indic conjunct rules added in
   Unicode 15.1. **Do not auto-grade grapheme counts** — treat them as a
   discussion, or link a real ICU/`unicode-segmentation` implementation.
6. **AArch64 division semantics.** I claim `SDIV` returns `INT_MIN` for
   `INT_MIN / -1` rather than trapping. This is from the Arm Architecture
   Reference Manual's `SDIV` pseudocode, not from a run on Arm hardware — and my
   local machine is arm64 macOS, where I did not test it because the whole
   verification chain is on CE for reproducibility.

**Could not read the primary source:**

7. **IEEE 754-2019 itself** is paywalled (~$100 from IEEE). Every clause
   attribution in Part 3 — the five rounding attributes in §4.3, the
   correctly-rounded operation list in §5.3–5.4, the recommended clause-9
   functions, the quiet-NaN encoding recommendation — is from secondary sources
   that quote it (Muller et al.'s *Handbook of Floating-Point Arithmetic* 2nd ed.,
   Goldberg 1991 for the 1985 version, Kahan's own lecture notes, and the C23
   draft's Annex F which binds C to IEC 60559). These agree with each other and
   with every behaviour I measured, but **I did not read the standard.** Treat
   clause *numbers* as approximate; treat the described *behaviour* as verified,
   because I ran it.
8. **Higham's theorem numbers.** The error bounds in §4.4 — `(n-1)u Σ|xᵢ|` for
   naive, `u⌈log₂n⌉ Σ|xᵢ|` for pairwise, `2u + O(nu²)` for Kahan — are standard
   and I am confident in their *form*. I attribute them to *Accuracy and
   Stability of Numerical Algorithms* 2nd ed. Ch. 4 but **could not re-check the
   exact theorem numbering** (my attempted PDF downloads returned 323-byte error
   pages). Cite the chapter, not a theorem number, until someone checks the book.
9. **The Croci et al. stochastic rounding result** (`√n·u` vs `n·u` growth) is
   cited from memory of the paper's abstract and from the general theory; I did
   not re-read it. My own measurement (§4.6) demonstrates the *effect*
   dramatically but does not verify the *asymptotic constant*.
10. **Cohen's IEN 137 / "On Holy Wars"** — cited from memory of its argument. The
    date (1980 memo, 1981 IEEE Computer) should be double-checked before it goes
    in front of students.

**Verified but worth a warning:**

11. **All timings are from Compiler Explorer's shared cloud runner.** The
    subnormal ratio reproduced across three independent runs (60.5× / 43.7× /
    58.8×) and the FTZ ratio stayed near 1 (0.92× / 0.95× / 1.15×), so the
    *conclusion* is solid. The *magnitude* is not a property of your CPU. On a
    recent Intel or AMD core the penalty for a subnormal result is roughly
    100–200 cycles; on some microarchitectures certain subnormal operations are
    handled at full rate. Students should re-run locally and expect a different
    number.
12. **The gcc `-O2` "deleted `main`'s `ret`" result** (§1.2) is real and
    reproducible on gcc 15.2, but it is a *particular* compiler's *particular*
    choice, not a rule. Do not teach "UB deletes your `ret`"; teach "UB is a
    premise the compiler may reason from, and the consequences are unbounded" —
    and use this as one vivid instance.
13. **NumPy's `pairwise_sum`** was read from the `main` branch at the time of
    writing (`numpy/_core/src/umath/loops_utils.h.src`, `PW_BLOCKSIZE 128`,
    8 accumulators, base case `n < 8`). Check it still matches before quoting it
    at students; NumPy moves.
14. **`std::add_sat` / `<stdckdint.h>`** need very recent toolchains
    (verified working on gcc 15.2 with `-std=c++26`,
    `__cpp_lib_saturation_arithmetic == 202311`). Exercises must not depend on
    them if students bring their own compilers.
