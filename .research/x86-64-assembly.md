# x86-64 Assembly — Curriculum Research

Audience: strong SWE, high-level languages, has never written a line of assembly.
Target end state: **can read compiler output and write a syscall-only hello world.**

Sources crawled in full:

- UVA CS216 x86 guide — <https://www.cs.virginia.edu/~evans/cs216/guides/x86.html> (32-bit IA-32, Intel/MASM syntax; excellent on addressing modes, instruction semantics, and the caller/callee ritual — but it is *32-bit*, so every register name and the entire calling convention need translating before use)
- shikaan, "A friendly introduction to assembly for high-level programmers" — 3 posts, series is complete as of this crawl (verified against <https://shikaan.github.io/archive.html>; a 4th post on the stack is promised in the conclusion of #3 but was never published):
  1. Hello — <https://shikaan.github.io/assembly/x86/guide/2024/09/08/x86-64-introduction-hello.html>
  2. Conditionals — <https://shikaan.github.io/assembly/x86/guide/2024/09/16/x86-64-conditionals.html>
  3. Functions & Loops — <https://shikaan.github.io/assembly/x86/guide/2024/09/26/x86-64-functions.html>
  - companion repo: <https://github.com/shikaan/x86-64-asm-intro>
- mikeroyal/Assembly-Guide README — <https://github.com/mikeroyal/Assembly-Guide> (93 lines, two sections only: "Assembly Learning Resources", "Assembly Tools & Architectures". It is a flat link list with no x86-64-specific pedagogy. Value extracted below.)

### Highest-value links extracted from mikeroyal/Assembly-Guide

The list is broad (RISC-V, MIPS, IBM z/OS, .NET assemblies, GPU ISAs, PlatformIO, Tock). Only these are relevant to an x86-64 curriculum:

| Link | Why it matters here |
|---|---|
| <https://www.felixcloutier.com/x86/> | **The single best link in the file.** Searchable HTML rendering of the Intel SDM per-instruction pages. This is the reference the learner should live in. |
| <https://software.intel.com/content/www/us/en/develop/articles/intel-sdm.html> | Intel SDM, the actual source of truth. Vol. 2 = instruction set. Heavy; use Cloutier for daily work. |
| <https://cs.lmu.edu/~ray/notes/x86assembly/> | Ray Toal's notes — the best *64-bit* free tutorial in the list; covers both syntaxes and the SysV convention properly. Better starting point than the UVA guide. |
| <https://www.amd.com/system/files/TechDocs/40332.pdf> | AMD64 Programmer's Manual Vol 1-5. AMD invented x86-64; often clearer prose than Intel. |
| <https://nasm.us/> | NASM — Intel-syntax assembler. What the shikaan series uses, and what the exercises below use. |
| <https://www.gnu.org/software/binutils/> | GAS — AT&T-syntax assembler, and what `gcc -S` emits by default. Needed for "read compiler output". |
| <https://docs.oracle.com/cd/E19120-01/open.solaris/817-5477/index.html> | Solaris x86 reference — one of the few free AT&T-syntax instruction references. |
| <https://github.com/unicorn-engine/unicorn> / <https://github.com/keystone-engine/keystone> | CPU emulator / assembler-as-a-library. Only relevant if the curriculum later grows a custom runner. |

Not in that README but needed and worth adding to the curriculum's own link list:

- System V AMD64 psABI (the normative document): <https://gitlab.com/x86-psABIs/x86-64-ABI>
- Linux x86-64 syscall table: <https://filippo.io/linux-syscall-table/> and `arch/x86/entry/syscalls/syscall_64.tbl` in the kernel tree
- `man 2 syscall` — the authoritative statement of the register convention per architecture
- Compiler Explorer: <https://godbolt.org>

---

## 1. Unit list (dependency-ordered)

Seven units. Each states the concept, its prerequisites, and **the one idea it exists to deliver** — the thing that, if the learner takes away nothing else, makes the unit worth having run.

### Unit 1 — The machine model: registers, instructions, and the instruction stream
**Concept.** A CPU is a loop: fetch the instruction at `rip`, execute it, set `rip` to the next one. An instruction is a *mnemonic* plus 0–3 *operands* (`mov rax, rbx`). The only storage the CPU has natively is 16 named 64-bit general-purpose registers plus `rip` and `rflags`. There are no variables, no types, no scopes.
**Prerequisites.** None beyond programming experience.
**The one idea.** *There are no variables — there are sixteen named boxes and a pointer that walks the code.* Everything else in the curriculum is a convention layered on top of that.

### Unit 2 — Assembling and running: sections, labels, `_start`, and the toolchain
**Concept.** A source file has `section .data` (initialized bytes) and `section .text` (code). A label is a name for an address. `global _start` names the entry point. The assembler turns text into an object file, the linker turns object files into an executable. Learn what "assemble", "link", and "load" each mean, and that `_start` is the *raw* entry point — before `main`, before libc, before anything.
**Prerequisites.** Unit 1.
**The one idea.** *A label is just a name for a number (an address), and the assembler's whole job is turning names into numbers.*

### Unit 3 — Talking to the kernel: syscalls and hello world
**Concept.** The `syscall` instruction traps into the kernel. Number in `rax`, arguments in `rdi, rsi, rdx, r10, r8, r9`, result back in `rax`. `write` = 1, `exit` = 60. With just `mov` and `syscall` you can write a complete, libc-free program that prints and exits.
**Prerequisites.** Units 1–2.
**The one idea.** *I/O is not a language feature. It is a register-loading protocol with the kernel, and you now know the whole protocol.*
> This unit already satisfies half the target end state. Everything after it is about *reading* rather than *writing*.

### Unit 4 — Memory and addressing: `[]`, `lea`, sizes, and RIP-relative
**Concept.** Operands can name memory: `[rbx]`, `[rsi + 8]`, `[rsi + 4*rbx + 12]` — up to base + index×{1,2,4,8} + displacement, and nothing else (no register subtraction, no three registers). `lea` computes that address without dereferencing. Sizes must be unambiguous (`byte`/`word`/`dword`/`qword ptr`, or an AT&T `b`/`w`/`l`/`q` suffix). In 64-bit code, references to globals are normally `[rel sym]` / `sym(%rip)` — RIP-relative — not absolute.
**Prerequisites.** Units 1–3 (the hello world already moved an address into `rsi`; this unit explains what that address *was*).
**The one idea.** *`mov` follows the pointer, `lea` computes the pointer* — the arithmetic in the brackets is a free addressing-mode computation the CPU does for you either way.

### Unit 5 — Control flow: `rflags`, `cmp`, and conditional jumps
**Concept.** `cmp a, b` subtracts without storing and sets flags — ZF (result zero), SF (result negative), CF, OF. `jmp` is unconditional; `je/jne/jg/jl/jge/jle/jz/jnz` read the flags. `if`, `while`, and `for` are all the same construct: a compare, a conditional jump forward (if/else) or backward (loop). Signed vs unsigned conditions are *different instructions* (`jg`/`jl` vs `ja`/`jb`) — the CPU does not know which your data is.
**Prerequisites.** Units 1–2 (Unit 4 not strictly required, but reads better after it).
**The one idea.** *A branch is two instructions and a side channel: something sets flags, something else reads them.* The gap between them is where bugs live.

### Unit 6 — Functions and the stack: `call`/`ret`, System V, and the frame
**Concept.** `call` pushes the return address and jumps; `ret` pops it and jumps back — that is the entire difference between a function and a jump, and it is what makes code *caller-independent*. The stack grows downward from high addresses; `push` decrements `rsp` then stores. The System V AMD64 ABI dictates who passes what where and who must preserve which registers. Frame pointer (`push rbp; mov rbp, rsp`) vs. frame-pointer-omitted code. 16-byte stack alignment. The red zone.
**Prerequisites.** Units 1, 2, 4 (memory), 5 (jumps).
**The one idea.** *The calling convention is a contract nothing enforces.* The CPU will happily let you violate it; the ABI is the only reason separately-compiled code composes at all.

### Unit 7 — Reading compiler output
**Concept.** Take small C functions, compile at `-O0` and `-O2`, and read the difference. Recognize the prologue/epilogue, argument registers being consumed in order, `lea` used as three-operand arithmetic, `xor eax, eax` as "zero", `test rax, rax` as "is it zero/null", jump tables from switches, strength reduction, inlining, tail calls, and the vanished frame pointer. This is the unit where the previous six turn into a *reading* skill.
**Prerequisites.** All of Units 1–6.
**The one idea.** *Compiler output is not exotic — it is the same six units' vocabulary, written by something that never gets tired.* Once the idioms are named, most functions read in one pass.

**Dependency graph.** 1 → 2 → 3 → 4 → 6 → 7, with 5 depending on 1–2 and feeding 6 and 7. Units 4 and 5 can be swapped or run in parallel; everything else is a hard chain.

---

## 2. The register file

Sixteen general-purpose registers, 64 bits wide. The first eight carry legacy names from the 8086 lineage; `r8`–`r15` were added with x86-64 and use a uniform naming scheme.

| 64-bit | 32-bit | 16-bit | 8-bit low | 8-bit high | Conventional role |
|---|---|---|---|---|---|
| `rax` | `eax` | `ax` | `al` | `ah` | Return value #1. Implicit operand of `mul`/`div`/`imul`(1-op)/`idiv`, `cdq`/`cqo`. For varargs calls: number of vector registers used. Syscall number, and syscall return value. |
| `rbx` | `ebx` | `bx` | `bl` | `bh` | No architectural role. **Callee-saved.** |
| `rcx` | `ecx` | `cx` | `cl` | `ch` | Argument #4. Implicit shift count (`shl rax, cl`) and `rep` counter. **Clobbered by `syscall`** (holds the return `rip`). |
| `rdx` | `edx` | `dx` | `dl` | `dh` | Argument #3. Return value #2 (128-bit returns). Upper half of the dividend in `idiv` (`rdx:rax`). |
| `rsi` | `esi` | `si` | `sil` | — | Argument #2. Source pointer for string ops (`movs`, `lods`). |
| `rdi` | `edi` | `di` | `dil` | — | Argument #1. Destination pointer for string ops (`movs`, `stos`). |
| `rbp` | `ebp` | `bp` | `bpl` | — | Frame pointer by convention. **Callee-saved.** Free as a GPR when the compiler omits frame pointers (`-fomit-frame-pointer`, default at `-O1`+ on Linux). |
| `rsp` | `esp` | `sp` | `spl` | — | **Stack pointer.** Architecturally special: `push`/`pop`/`call`/`ret`/interrupts all modify it. **Callee-saved** in the trivial sense that it must be balanced. Never use it as scratch. |
| `r8`  | `r8d`  | `r8w`  | `r8b`  | — | Argument #5. |
| `r9`  | `r9d`  | `r9w`  | `r9b`  | — | Argument #6. |
| `r10` | `r10d` | `r10w` | `r10b` | — | Scratch. **Syscall argument #4** (replaces `rcx`, which `syscall` destroys). Also the "static chain" pointer for nested functions. |
| `r11` | `r11d` | `r11w` | `r11b` | — | Scratch. **Clobbered by `syscall`** (holds saved `rflags`). |
| `r12` | `r12d` | `r12w` | `r12b` | — | **Callee-saved.** |
| `r13` | `r13d` | `r13w` | `r13b` | — | **Callee-saved.** |
| `r14` | `r14d` | `r14w` | `r14b` | — | **Callee-saved.** |
| `r15` | `r15d` | `r15w` | `r15b` | — | **Callee-saved.** |

Also relevant, not general-purpose:

- `rip` — instruction pointer. Not writable by `mov`; changed only by jumps, calls, returns, and interrupts. Readable as a base register in RIP-relative addressing.
- `rflags` — status flags. ZF (zero), SF (sign), CF (carry / unsigned overflow), OF (signed overflow), PF, AF, plus DF (direction) which you must leave clear. Written by arithmetic/logic, read by `jcc`/`setcc`/`cmovcc`.
- `xmm0`–`xmm15` — SSE registers. Float/double arguments (`xmm0`–`xmm7`) and float return (`xmm0`). All caller-saved. Compilers also use them to copy struct-sized blobs, so they show up in integer-only code.

### Naming notes

- The high-byte registers `ah`, `bh`, `ch`, `dh` address bits 8–15 and are a legacy oddity. They **cannot be encoded in the same instruction as any of `sil`, `dil`, `spl`, `bpl`, or `r8b`–`r15b`** — those need a REX prefix, and REX reassigns that encoding slot. Practical advice for a beginner: never use `ah`-style registers.
- `sil`, `dil`, `spl`, `bpl` only exist in 64-bit mode; in 32-bit code you could not address the low byte of `esi` at all.
- `r8w`/`r8d`/`r8b`: `w` = word (16), `d` = dword (32), `b` = byte (8).

### The zero-extension gotcha

**Any write to a 32-bit sub-register zeroes the upper 32 bits of the full 64-bit register. Writes to 16-bit and 8-bit sub-registers do not — they merge.**

```nasm
mov rax, 0xFFFFFFFFFFFFFFFF
mov eax, 1      ; rax is now 0x0000000000000001   <- upper half WIPED
```
```nasm
mov rax, 0xFFFFFFFFFFFFFFFF
mov ax,  1      ; rax is now 0xFFFFFFFF00000001   <- upper 32 preserved
mov al,  1      ; rax is now 0xFFFFFFFFFFFF0001   <- merges into low byte
```

Why it exists: AMD chose it deliberately when designing x86-64. Merging into a wider register creates a false dependency on the old value — the CPU must wait for the previous writer of `rax` before it can retire a write to `eax`. Zero-extension breaks that dependency chain, so 32-bit operations are dependency-free and the encoding is shorter (no REX.W prefix needed).

Consequences the learner will actually hit:

1. `xor eax, eax` is the idiomatic "set `rax` to 0" — two bytes, and it zeroes the whole 64-bit register. You will see it constantly in compiler output. `xor rax, rax` also works but is a byte longer for identical effect.
2. `mov eax, 1` is the idiomatic "set `rax` to 1". Compilers emit the 32-bit form for any constant that fits, and it is *not* a bug.
3. **Sign extension is the trap.** Loading a signed 32-bit value into `eax` and then treating `rax` as a signed 64-bit number gives you a garbage huge positive number for any negative input. That is what `movsxd rax, ecx` / `cdqe` are for. Zero-extension is free; sign-extension is an instruction.
4. `mov al, <byte>` inside a loop leaves the upper 56 bits of whatever was in `rax` intact. Beginners writing byte-processing loops routinely poison their counters this way.

---

## 3. System V AMD64 calling convention

The normative document is the x86-64 psABI (<https://gitlab.com/x86-psABIs/x86-64-ABI>). This applies to Linux, macOS, the BSDs, and Solaris. **Windows x64 uses a completely different convention** (`rcx, rdx, r8, r9`, 32-byte shadow space, `rdi`/`rsi` callee-saved) — mention it once so the learner does not get confused by MSDN, then ignore it.

### Integer / pointer arguments, in order

| Position | Register |
|---|---|
| 1 | `rdi` |
| 2 | `rsi` |
| 3 | `rdx` |
| 4 | `rcx` |
| 5 | `r8` |
| 6 | `r9` |
| 7+ | on the stack, **pushed right-to-left**, so argument 7 sits at `[rsp]` at the moment of `call` (and at `[rbp+16]` after a standard prologue) |

Mnemonic in wide circulation: **"Diane's silk dress costs $89"** → **di**, **si**, **d**x, **c**x, **8**, **9**.

- Floating-point arguments go in `xmm0`–`xmm7`, counted *independently* of the integer registers. `f(int a, double b, int c)` puts `a` in `rdi`, `c` in `rsi`, `b` in `xmm0`.
- For **variadic** functions, `al` must hold the number of vector registers used (0–8). This is why `printf` calls in compiler output are preceded by `mov eax, 0` or `mov al, 2` — a genuinely confusing sight until you know.
- Small structs (≤16 bytes) are decomposed and passed in up to two registers by field class; larger ones are copied to the stack. Structs are the messiest corner of the ABI; a beginner curriculum should say "structs are classified field-by-field, look it up when you need it" and move on.

### Return values

| What | Where |
|---|---|
| Integer / pointer | `rax` |
| Second half of a 128-bit integer, or the second field of a two-register struct | `rdx` |
| `float` / `double` | `xmm0` (and `xmm1` for a second field) |
| `long double` | `st0` (x87) |
| Struct too large for registers | Caller allocates space and passes a hidden pointer as argument #0 in `rdi` (shifting all real arguments down one); the callee returns that same pointer in `rax` |

### Register preservation

**Callee-saved** (the callee must restore them before `ret`; the caller may assume they survive a call):

> `rbx`, `rbp`, `rsp`, `r12`, `r13`, `r14`, `r15`

Also callee-saved: the x87 control word and the MXCSR control bits, plus the direction flag DF, which must be clear (`cld`) on both entry and exit.

**Caller-saved / scratch** (the callee may destroy them; the caller must spill anything it still needs):

> `rax`, `rcx`, `rdx`, `rsi`, `rdi`, `r8`, `r9`, `r10`, `r11`, and all of `xmm0`–`xmm15`

Note the pleasant symmetry worth pointing out to learners: **every argument register is caller-saved.** That is not a coincidence — the caller just wrote them, so it obviously knows their values are transient.

> **Source correction.** The shikaan Functions post gives a condensed table listing only `r12`–`r15` as callee-saved and `r10`–`r11` as caller-saved. That is a deliberate simplification for a tutorial; it omits `rbx` and `rbp`, which are also callee-saved. Use the full list above in the curriculum. Likewise, the UVA CS216 guide's caller/callee lists (`eax, ecx, edx` caller-saved; `ebx, edi, esi` callee-saved) are the **32-bit cdecl** convention and do not carry over.

### Stack alignment

**`rsp` must be 16-byte aligned immediately before every `call` instruction.**

Since `call` pushes an 8-byte return address, the equivalent statement from inside a function is: **on entry to a function, `rsp ≡ 8 (mod 16)`**, i.e. `rsp + 8` is 16-byte aligned. After the standard `push rbp`, `rsp` is 16-byte aligned again — which is why the classic prologue keeps things tidy for free.

Why it matters: SSE instructions like `movaps`/`movdqa` fault (`SIGSEGV`) on unaligned memory, and the compiler is entitled to assume 16-byte alignment for stack slots. The symptom of getting this wrong is a segfault deep inside `printf` or `memcpy` — one of the most common and most baffling failures for someone hand-writing assembly that calls libc. If you have pushed an odd number of 8-byte values, `sub rsp, 8` before the call.

For a `_start` entry point specifically: the kernel enters with `rsp` 16-byte aligned and `argc` at `[rsp]` — there is no return address, so `_start` is *not* in the same alignment state as a normal function. Another reliable source of confusion.

### The red zone

The **128 bytes below `rsp`** (`[rsp-128]` .. `[rsp-1]`) are reserved for the current function's use. Signal handlers and interrupts will not clobber them — the kernel skips past the red zone before pushing a signal frame.

A **leaf function** (one that makes no calls) can therefore use scratch space without touching `rsp` at all: no `sub rsp, N` in the prologue, no `add rsp, N` in the epilogue. This is why small leaf functions in compiler output have *no prologue whatsoever* yet still write to `[rsp-4]` — a genuinely startling sight the first time.

Rules and caveats:

- Only valid for leaf functions. Any `call` immediately invalidates the red zone (the callee's own frame lands there).
- Not available in kernel code — Linux builds with `-mno-red-zone` because kernel interrupt frames do land below `rsp`.
- Does not exist on Windows x64.

---

## 4. Linux x86-64 syscall convention

| Slot | Register |
|---|---|
| **Syscall number** | `rax` |
| Argument 1 | `rdi` |
| Argument 2 | `rsi` |
| Argument 3 | `rdx` |
| Argument 4 | **`r10`** |
| Argument 5 | `r8` |
| Argument 6 | `r9` |
| **Instruction** | `syscall` |
| **Return value** | `rax` |
| **Clobbered** | `rcx` and `r11` (plus `rax`) |

Everything else is preserved across the call — unlike a normal function call, the kernel preserves `rdi`, `rsi`, `rdx`, `r8`, `r9`, and all the callee-saved registers.

### The two divergences from the function ABI — flag both explicitly

1. **Argument 4 is `r10`, not `rcx`.** This is forced by the hardware: the `syscall` instruction itself writes the return address into `rcx` and the saved `rflags` into `r11`. Those two registers are destroyed by the instruction, so the kernel ABI routes the fourth argument around `rcx`. A learner who "knows the calling convention" and writes `mov rcx, ...` before a 4-argument syscall gets silent garbage.
2. **Never use `int 0x80` in 64-bit code.** It still exists, but it invokes the *32-bit* syscall table, where the numbers are different (`exit` is 1, `write` is 4) and pointer arguments are truncated to 32 bits. Every stale tutorial on the internet uses it. The 64-bit instruction is `syscall`.

### Errors

There is no `errno` register and no flag. **The kernel returns `-errno` in `rax` on failure.** A return value in the range `[-4095, -1]` is an error; anything else is a success value.

```nasm
    syscall
    cmp  rax, -4095
    jae  .error          ; unsigned compare: catches -4095..-1
```

That is exactly what libc's syscall wrappers do — they test that range, and if it hits, they negate the value, store it in the thread-local `errno`, and return `-1`. When writing raw assembly you have no libc, so **`errno` does not exist for you**; the negative return *is* the error. `write` returning `-9` means `EBADF`, not "wrote negative nine bytes".

Beware also of **short writes**: `write` returns the number of bytes actually written, which may be less than requested. Correct code loops. Hello world can get away with ignoring this; the learner should be told it is a shortcut.

### The numbers

| Syscall | Number | Signature |
|---|---|---|
| `read` | 0 | `read(int fd, void *buf, size_t count)` |
| **`write`** | **1** | `write(int fd, const void *buf, size_t count)` |
| `open` | 2 | `open(const char *path, int flags, mode_t mode)` |
| `close` | 3 | `close(int fd)` |
| **`exit`** | **60** | `exit(int status)` |
| `exit_group` | 231 | `exit_group(int status)` — what libc's `exit()` actually calls; terminates all threads |

File descriptors: 0 = stdin, 1 = stdout, 2 = stderr.

The x86-64 numbers are architecture-specific — 32-bit x86, ARM64, and RISC-V all use different tables. The canonical source is `arch/x86/entry/syscalls/syscall_64.tbl` in the kernel tree; `man 2 syscall` documents the register convention for every architecture in one table.

Complete hello world, with nothing but these two calls:

```nasm
section .data
  msg   db "Hello, World!", 10
  msglen equ $ - msg

section .text
  global _start
_start:
  mov rax, 1            ; write
  mov rdi, 1            ; fd = stdout
  mov rsi, msg          ; buf
  mov rdx, msglen       ; count
  syscall

  mov rax, 60           ; exit
  mov rdi, 0            ; status = 0
  syscall
```

---

## 5. What actually trips up newcomers

### 5.1 AT&T vs Intel syntax

The same machine code, two incompatible spellings. This is the single largest source of beginner confusion, because tutorials mix them without warning and the *same text can be valid in both with different meanings*.

| | Intel (NASM, MASM, `objdump -M intel`, Intel SDM) | AT&T (GAS, `gcc -S`, default `objdump`, gdb default) |
|---|---|---|
| Operand order | `mov dst, src` | `mov src, dst` — **reversed** |
| Register | `rax` | `%rax` |
| Immediate | `42` | `$42` |
| Memory | `[rbx]`, `[rbx+8]` | `(%rbx)`, `8(%rbx)` |
| Scaled index | `[base + index*scale + disp]` | `disp(base, index, scale)` |
| Operand size | directive: `mov qword ptr [rbx], 1` | mnemonic suffix: `movq $1, (%rbx)` |
| Example | `mov eax, DWORD PTR [rbx+rcx*4+8]` | `movl 8(%rbx,%rcx,4), %eax` |
| Jump to indirect | `jmp rax` | `jmp *%rax` |

**Which to teach:** Intel for writing (it is what the Intel SDM and felixcloutier.com use, and it is what the shikaan series uses), but the learner *must* be able to read AT&T, because `gcc -S` emits it and gdb defaults to it. Practical mitigation to teach as a Unit 7 reflex: `objdump -d -M intel`, and `set disassembly-flavor intel` in gdb (or in `~/.gdbinit`). Compiler Explorer has an Intel-syntax toggle, on by default.

### 5.2 `mov` vs `lea`

Both take a memory operand. `mov` **dereferences** it; `lea` (Load Effective Address) **computes the address and stops**.

```nasm
lea rax, [rbx+8]     ; rax = rbx + 8            (arithmetic)
mov rax, [rbx+8]     ; rax = *(uint64_t*)(rbx+8) (a memory load)
```

`lea` never touches memory and never faults — the brackets in `lea` are not a dereference, they are borrowed syntax for the address calculator. Two consequences the learner will meet immediately:

1. In the hello world above, `rsi` needs *the address of* the string, not the first eight bytes of it. NASM's `mov rsi, msg` gets the address because a bare label is its address; `mov rsi, [msg]` would load the characters `"Hello, W"` as an integer. In GAS, `movq $msg, %rsi` is the address and `movq msg, %rsi` is the load — and in position-independent code you need `leaq msg(%rip), %rsi` instead. This one-character difference is a very common first bug.
2. **Compilers use `lea` as a three-operand arithmetic instruction** that does not touch flags. `lea eax, [rdi + rdi*2]` is `x*3`; `lea rax, [rdi + rsi*8 + 16]` is a multiply-add in one instruction with a destination distinct from both sources. When reading compiler output, most `lea`s have nothing to do with addresses. Say this out loud in Unit 7 or the learner will spend an hour looking for a pointer that isn't there.

### 5.3 Why `mov rax, [rbx]` means different things in the two syntaxes

The subtle one. `mov rax, [rbx]` is a syntactically valid line in both assemblers, and they disagree:

- **Intel/NASM:** `rax = *(uint64_t *)rbx` — load 8 bytes from the address in `rbx`.
- **GAS/AT&T:** operands are reversed, so the destination is the second one — this is a *store into* `[rbx]`... except AT&T does not use brackets for indirection at all. GAS parses `[rbx]` as an expression, `rax` (without `%`) as a symbol name, and produces a confusing error or, in `.intel_syntax` mode, silently switches meaning. The GAS spelling of the Intel line is `movq (%rbx), %rax`; the GAS line that *looks* most like it — `movq %rax, (%rbx)` — is the **opposite operation**, a store.

The lesson to deliver: **operand order is not a stylistic difference, it is a semantic inversion.** `mov a, b` copies right-to-left in Intel and left-to-right in AT&T. A learner who half-remembers which is which will write code that assembles cleanly and does the reverse of what they meant. The reliable habit is to check for `%` and `$` sigils — if they are present it is AT&T and the destination is on the right; if operands are bare it is Intel and the destination is on the left.

Compounding it: GAS accepts `.intel_syntax noprefix`, and `objdump` accepts `-M intel`, so the *same tool* can emit either. Always look at the sigils, never at the tool.

### 5.4 Size suffixes and "operation size not specified"

When both operands are registers, the size is implied by the register (`mov eax, ecx` is obviously 32 bits). When one operand is memory and the other an immediate, **nothing determines the size** and the assembler refuses:

```nasm
mov [rbx], 1            ; NASM: error: operation size not specified
mov qword [rbx], 1      ; 8 bytes
mov dword [rbx], 1      ; 4 bytes
mov byte  [rbx], 1      ; 1 byte
```

AT&T solves the same problem with a mnemonic suffix — `b` (1), `w` (2), `l` (4), `q` (8):

```gas
movq $1, (%rbx)
movl $1, (%rbx)
movb $1, (%rbx)
```

This is why compiler output is full of `movl`, `movq`, `addl`, `cmpb`. The suffix is not decoration; it is the operand size, and it is the AT&T equivalent of `dword ptr`.

Related trap: `word` is 16 bits and `dword` is 32 bits, forever, because the terms were fixed when the 8086 was a 16-bit machine. On a 64-bit CPU a "word" is not the machine word. The `d`/`w`/`b` suffixes on `r8d`/`r8w`/`r8b` follow the same legacy scheme.

### 5.5 RIP-relative addressing

In 32-bit code, a global's address was a link-time constant baked into the instruction. In 64-bit code that mostly stopped being true, for two reasons: absolute 64-bit addresses make instructions enormous, and position-independent executables (PIE, the default on every modern Linux distro) load at a randomized base, so no absolute address is known at link time.

The fix is an addressing mode where the base register is `rip`:

```nasm
lea  rsi, [rel msg]      ; NASM
mov  eax, [rel counter]
```
```gas
leaq msg(%rip), %rsi     ; GAS
movl counter(%rip), %eax
```

The encoded displacement is *the distance from the next instruction to the target*, so the whole thing floats wherever the image is loaded. Three practical consequences:

1. Nearly every global access in compiler output has `(%rip)` on it. It is not an exotic mode; it is the normal one.
2. Absolute forms still assemble and will link fine in a non-PIE build, then fail with a relocation error like `relocation R_X86_64_32S against '.data' can not be used when making a PIE object; recompile with -fPIE` in a PIE build. That error message is unusually opaque and worth showing the learner deliberately, because "it worked in the tutorial and fails on my machine" is exactly this.
3. NASM's `default rel` directive at the top of a file makes `[msg]` mean `[rel msg]` throughout, which is what you almost always want. Teach it as boilerplate.

### 5.6 Why the stack grows down

Historical, and now load-bearing. The original reason: on early machines you wanted the program's code and static data at low addresses growing up, and the stack at the top of memory growing down, so that the two regions consumed the single free gap between them from opposite ends and neither had to pre-commit to a size. Modern systems have virtual memory and could do it either way — but the direction is now welded into the instruction set. `push` *is* "decrement `rsp` by 8, then store"; `call` *is* "push the return address"; `pop` *is* "load, then increment". You cannot change it.

Two follow-on facts a beginner needs:

- "Top of the stack" means the **lowest** address in use. Every diagram of a stack frame you will meet is drawn with high addresses at the top, which means the stack visually grows *downward on the page* and "top of stack" is at the bottom of the picture. Say this explicitly; the vocabulary is genuinely inverted.
- Locals are therefore addressed at **negative** offsets from `rbp` (`[rbp-8]`, `[rbp-16]`) while incoming stack arguments are at **positive** offsets (`[rbp+16]` for argument 7, since `[rbp]` holds the saved `rbp` and `[rbp+8]` the return address). Reading a frame layout requires holding both directions in your head at once, which is why Unit 6 should draw the picture rather than describe it.
- And the payoff: this is why buffer overflows are exploitable. A buffer is written upward from a low address, the saved return address sits above it, so overrunning a local array overwrites exactly the thing that decides where `ret` goes.

### 5.7 Smaller ones worth a sentence each

- **Signed vs unsigned conditionals are different instructions.** `jg`/`jl`/`jge`/`jle` are signed; `ja`/`jb`/`jae`/`jbe` are unsigned. The CPU does not know the type of your data; the *instruction you chose* is the type declaration. Getting it wrong produces a bug that works for small values and breaks past 0x7FFF...
- **`cmp a, b` computes `a - b`,** so "jump if greater" means "jump if the *first* operand was greater" — in Intel order. In AT&T order the operands are swapped and `cmpq %rbx, %rax; jg` still means "jump if `rax > rbx`". This trips people constantly when moving between syntaxes.
- **`test rax, rax` / `xor eax, eax`** — idioms, not arithmetic. `test x, x` means "is x zero (or negative)"; `xor r, r` means "r = 0". Name them in Unit 7 or they read as noise.
- **Labels are addresses, not variables.** `msg` is a number. This is the root of the `mov rsi, msg` vs `mov rsi, [msg]` confusion above.
- **`_start` is not `main`.** No libc, no initialized stdio, no `atexit`, and **falling off the end of `_start` does not exit** — execution runs into whatever bytes come next and segfaults. You must call `exit` explicitly. This is a very common first crash.
- **`db "text", 10` and `equ $ - msg`** — computing string length at assembly time with `$` (the current address) is idiomatic NASM and looks like magic until explained once.

---

## 6. Machine-checkable exercises

### Backend notes (verified against the live API)

Compiler Explorer's API assembles **and executes** x86-64. Verified working during this research:

- Endpoint: `POST https://godbolt.org/api/compiler/{id}/compile`, `Content-Type: application/json`, `Accept: application/json`.
- Body: `{"source": "...", "lang": "assembly", "allowStoreCodeDebug": false, "options": {"userArguments": "...", "compilerOptions": {"executorRequest": true}, "executeParameters": {"args": [], "stdin": ""}, "filters": {"execute": true}}}`
- Compiler ids confirmed with `supportsExecute: true`:
  - **NASM** (Intel syntax): `nasm21601` (2.16.01), `nasm300`, `nasm301`. `userArguments: "-f elf64"`.
  - **GAS** (AT&T syntax): `gnuas142` (binutils 2.42), `gnuas151` (2.45). `userArguments: "-nostdlib"`.
  - **clang integrated assembler**: `llvmas1910` etc., also executable.
  - For Unit 7, use `lang: "c"` with `g142`/`clang1910` and no `executorRequest`, reading `asm` from the response.
- Response shape used for checking: `buildResult.code` (0 = assembled+linked), `buildResult.stderr[].text` (the assembler's error messages, with line numbers), `code` (the **program's exit status**, propagated faithfully), `stdout[].text`, `stderr[].text`.
- Empirically confirmed: `_start`-only programs link and run cleanly; `exit(42)` comes back as `code: 42`; and a deliberate error returns `buildResult.code: 1` with `<source>:4: error: operation size not specified`.

Each exercise below is checkable by an automated grader with **no human in the loop** — the pass condition is a build code, an exit status, or an exact stdout string.

---

### Unit 1 — Registers and instructions
**Task.** Write a program using only `mov` and `syscall` that leaves the value **7** in `rdi`, arriving at it *without ever writing the literal 7*: start from `mov rax, 3`, add `mov rcx, 4`, and combine them with `add`. Then exit with that value as the status.

```nasm
section .text
  global _start
_start:
  mov rax, 3
  mov rcx, 4
  add rax, rcx
  mov rdi, rax
  mov rax, 60
  syscall
```
**Check.** `code == 7`.
**How it fails informatively.** Forgetting to reload `rax` with 60 before `syscall` invokes syscall #7 (`poll`) instead of `exit`, and the program hangs or exits nonzero — a memorable first lesson that `rax` is doing double duty.

---

### Unit 2 — Assembling and running
**Task.** Given a source file with three deliberate defects — the entry label spelled `start:` instead of `_start:`, a missing `global` directive, and a stray `section .txt` typo — fix it so it assembles, links, and exits with status 0. Then, as part b, **delete the final `mov rax, 60` / `syscall` pair** and observe the crash.

**Check.** Part a: `buildResult.code == 0` **and** `code == 0`. Part b: `code != 0` (the runner reports a signal/nonzero status).
**Why it's the right exercise.** The failure modes are all *linker and assembler* errors with distinct text — `undefined reference to '_start'`, `symbol '_start' is not global` — which is exactly the vocabulary Unit 2 exists to teach. Part b delivers "falling off the end of `_start` does not exit" as an observed fact rather than a warning.

---

### Unit 3 — Syscalls and hello world
**Task.** Write, from scratch, a program that prints exactly `Hello, World!\n` to **stdout** and exits with status 0. Constraint: no libc, no `printf`, `_start` only. Then modify it to print to **stderr** instead, and to exit with status 3.

**Check.** `stdout` joins to exactly `"Hello, World!\n"` and `code == 0`. Variant: `stdout` empty, `stderr` equal to the string, `code == 3`.
**Why it's the right exercise.** The length field is the trap — a hardcoded `mov rdx, 13` that should be 14 (with the newline) produces output that is *visibly almost right*, and a grader doing an exact string comparison catches it where a human eyeball would not. Teaching `equ $ - msg` is the fix.

---

### Unit 4 — Memory, addressing, `lea`
**Task.** Given `arr dq 10, 20, 30, 40, 50` in `.data`, write code that exits with the status equal to `arr[3]` (= 40), loading it via a **scaled index**: put 3 in `rbx` and use `[arr + rbx*8]`. Then, in a second program, use `lea` to compute the *address* of `arr[3]`, subtract the address of `arr`, and exit with that difference (= 24).

**Check.** Program 1: `code == 40`. Program 2: `code == 24`.
**Bonus check that fails loudly.** Ask for a third version containing the line `mov [arr], 1`. It fails to assemble with `<source>:N: error: operation size not specified` — verified against the live API — teaching the size-directive rule via a real error message rather than a rule.
**Why it's the right exercise.** Exercise 2 is impossible to pass by accident: it only produces 24 if the learner genuinely understands that `lea` yields an address and `mov` yields contents. A learner who confuses them gets 40 or a segfault.

---

### Unit 5 — Control flow
**Task.** Write a loop that sums the integers 1 through 10 and exits with the sum (= 55). Constraint: use `cmp` and a conditional jump; no `mul`, no closed-form. Then write a second program that exits with 1 if `-1 > 0` under a **signed** comparison and 0 otherwise, and a third that does the same under an **unsigned** comparison — the two must disagree.

**Check.** Program 1: `code == 55`. Program 2 (`cmp rax, 0` with `jg`, `rax = -1`): `code == 0`. Program 3 (same values, `ja`): `code == 1`.
**Why it's the right exercise.** The signed/unsigned pair is the whole point: two programs with *identical data and identical `cmp`*, differing by one letter in the jump mnemonic, producing opposite answers. The grader's disagreement between them is the lesson, and it cannot be faked.

---

### Unit 6 — Functions, stack, calling convention
**Task.** Write a function `add3` that takes three arguments in the System V registers and returns their sum in `rax`, plus a `_start` that calls it with (10, 20, 12) and exits with the result (= 42). Constraint: `add3` must use `rbx` as scratch **and must preserve it** — `_start` sets `rbx` to a sentinel before the call and, after the call, exits with 99 if `rbx` was clobbered.

```nasm
section .text
  global _start
add3:
  push rbx              ; callee-saved: must preserve
  mov  rbx, rdi
  add  rbx, rsi
  add  rbx, rdx
  mov  rax, rbx
  pop  rbx
  ret
_start:
  mov  rbx, 0xDEADBEEF
  mov  rdi, 10
  mov  rsi, 20
  mov  rdx, 12
  call add3
  cmp  rbx, 0xDEADBEEF
  jne  .clobbered
  mov  rdi, rax
  jmp  .out
.clobbered:
  mov  rdi, 99
.out:
  mov  rax, 60
  syscall
```
**Check.** `code == 42`. A learner who omits the `push rbx`/`pop rbx` gets `code == 99` — a *specific, diagnosable* wrong answer rather than a crash.
**Second check.** Ask for a variant that also verifies `rsp` is balanced across the call: unbalanced push/pop makes `ret` jump to garbage and the runner reports a segfault (`code` nonzero, `stderr` populated).
**Why it's the right exercise.** 99 vs 42 is the entire callee-saved contract expressed as an integer. Nothing else in the curriculum makes an invisible convention this visible.

---

### Unit 7 — Reading compiler output
**Task.** Two parts, both machine-checked.

*Part a (reading).* Given the exact assembly output of a small C function compiled at `-O2`, answer four multiple-choice questions by **encoding the answers as an exit status**: write a program that exits with `a*27 + b*9 + c*3 + d` where each of a–d is your 0–2 answer to: (1) which register holds argument 1; (2) is the `lea` at line N computing an address or doing arithmetic; (3) what does `xor eax, eax` do; (4) why is there no `push rbp`. The grader checks a single number.

*Part b (writing back).* Reproduce, by hand in NASM, a function equivalent to this C:
```c
long f(long a, long b) { return a * 3 + b; }
```
Constraint: exactly one arithmetic instruction in the body — i.e. you must discover `lea rax, [rdi + rdi*2 + ...]`. Then have `_start` call it with (10, 12) and exit with the result (= 42).

**Check.** Part a: `code == <expected encoding>`. Part b: `code == 42`, plus a source-text assertion that the body contains exactly one of {`add`, `sub`, `imul`, `lea`} — which forces the `lea` solution.
**Setup for part a.** Fetch the reference output live from the same API with `lang: "c"`, compiler `g142`, `userArguments: "-O2"`, so the question text is always consistent with the toolchain the learner can inspect themselves.
**Why it's the right exercise.** Part a makes *reading* gradeable at all, by turning comprehension into an integer. Part b closes the loop: the learner cannot write the answer without having genuinely internalized the "compilers use `lea` as arithmetic" idiom from 5.2, and the single-instruction constraint makes brute force impossible.

---

## Appendix — notes on source quality for curriculum authors

- **UVA CS216** is well-written and its sections on addressing modes and the caller/callee ritual are worth adapting, but **it is a 32-bit document throughout**: eight registers, `EAX`/`ESP`/`EBP`, arguments pushed on the stack, `cdecl` caller/callee lists. Using it unmodified would teach the wrong calling convention. Treat it as a source of *explanations* to be re-expressed in 64-bit terms, not as assignable reading.
- **shikaan's series** is the best pedagogical fit — modern, 64-bit, Intel syntax, explicitly aimed at high-level programmers, with an embedded runnable editor per post. Three posts only; the promised 4th (the stack) does not exist, so Units 6 and 7 need original material. Its one factual simplification (the callee-saved list) is noted in §3.
- **mikeroyal/Assembly-Guide** is a link list, not a guide — no pedagogy, no ordering, and about two-thirds of it is off-topic for x86-64 (RISC-V, MIPS, IBM z/OS, embedded OSes, .NET assemblies). Its value to this curriculum is roughly four links, extracted at the top of this document; `felixcloutier.com/x86` is the one that matters.
- The single most important gap across all three sources: **none of them treats the syscall convention's `r10`-not-`rcx` divergence, the `-errno` return, or the red zone.** Those come from the psABI and `man 2 syscall` and are written up in §3 and §4 above.
