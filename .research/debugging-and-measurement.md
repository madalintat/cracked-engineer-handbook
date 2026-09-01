# Debugging, Observability & Performance Measurement — Curriculum Research

Research date: 2026-09-01. Counterpart to the compiler-diagnostics material: that unit taught
*reading what the compiler tells you at build time*; this one teaches *reading what the machine
tells you at run time*, and — the part almost every course skips — **the methodology that makes a
measurement mean anything at all**.

---

## 0. Verification status — read this first

I ran **live probes against the Compiler Explorer (godbolt.org) execution sandbox** via its public
API rather than trusting documentation. Everything in the table below was executed, not assumed.
Raw probe transcripts are in §8.

### VERIFIED to work in the CE sandbox (probed 2026-09-01)

| Capability | Result | Notes |
|---|---|---|
| **ASan** (`-fsanitize=address`) | ✅ Full report incl. shadow-byte dump and legend | gcc 15.2 and clang 21.1 both |
| **UBSan** (`-fsanitize=undefined`) | ✅ Runtime-error lines with file:line:col | `-fno-sanitize-recover=all` gives non-zero exit |
| **TSan** (`-fsanitize=thread`) | ✅ Names both accesses + both thread creation stacks | exit code 66 |
| **MSan** (`-fsanitize=memory`) | ✅ incl. `-fsanitize-memory-track-origins=2` | clang only |
| **LSan** (`-fsanitize=leak`, and inside ASan) | ✅ exit code 23 standalone | on by default under ASan on Linux |
| **Threads** (`std::thread`, `-pthread`) | ✅ | 2 CPUs online |
| **`fork()` + `ptrace()`** | ✅ **PTRACE_TRACEME / PEEKTEXT / POKETEXT / GETREGS / SETREGS / SINGLESTEP / CONT all work** | a real 60-line INT3 debugger runs |
| **x86 hardware debug registers** (DR0–DR7 via `PTRACE_POKEUSER`) | ✅ **hardware watchpoints work** | DR6 correctly reports which register fired |
| **`rdtsc` / `rdtscp`** | ✅ not trapped | `aux`(CPU id)=0 |
| **`clock_gettime`** | ✅ `clock_getres` = **1 ns** for both `CLOCK_MONOTONIC` and `CLOCK_PROCESS_CPUTIME_ID` | |
| **`getrusage`** | ✅ maxrss, utime, stime, minflt, majflt, nvcsw, nivcsw all populated | |
| **`/proc/self/*`, `/proc/cpuinfo`** | ✅ readable | |
| **ASLR** | ✅ live — PIE stack/heap/code addresses differ every run | but see the caching gotcha below |
| **`llvm-dwarfdump` as a CE "tool"** | ✅ **arbitrary args accepted** — `--debug-info`, `--debug-line`, `--eh-frame`, `--name=X --show-children` | this makes the whole DWARF unit machine-checkable |
| **`readelf`, `nm`, `pahole`, `strings`, `ldd`, `bloaty`** | ✅ available as tools | |
| **`llvm-mca`, `osaca`** | ✅ available — *static* pipeline simulation, the only microarchitectural analysis CE offers | |
| Execution budget | ~**20 s wall**, then `SIGKILL` — "Killed - processing time exceeded" | a 5.7 s run passed cleanly |

### VERIFIED **not** to work in the CE sandbox

| Capability | Result |
|---|---|
| **`perf_event_open(2)`** | ❌ **`-1 EACCES`**. `/proc/sys/kernel/perf_event_paranoid` = **4** (stricter than upstream max of 3). **No PMU counters, no `perf`, no `toplev`, no top-down analysis, no cache-miss counts, no cycles/instructions.** |
| `perf` / `gdb` / `lldb` / `rr` / `valgrind` as CE tools | ❌ not in the tool list for gcc or clang |
| cpufreq control | ❌ `/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor` does not exist |
| `personality(ADDR_NO_RANDOMIZE)` | ❌ returns 0/ineffective — cannot disable ASLR from inside |
| Network | ❌ documented: "the compilation nodes have no internet access" |

### The CE gotcha that will silently ruin a measurement exercise

**Compiler Explorer caches results for an identical (compiler, source, options) triple.** Pressing
Run again returns the *cached* output, not a new execution. Probed directly: three identical PIE
runs returned byte-identical stack/heap/code addresses; adding a `// nonce N` comment produced four
different address sets. **Consequence for the curriculum: every repetition must happen inside a
single program run.** "Run it 10 times and compare" is not an available exercise on CE. This is
worth teaching explicitly — it is a miniature of the real lesson (your measurement harness has
behaviour of its own).

### Hardware the exercises actually land on

`Intel(R) Xeon(R) CPU E5-2686 v4 @ 2.30GHz` (Broadwell-EP), 2 vCPUs, Linux `7.0.0-1011-aws`,
PID namespace (the program is always PID 1). This is a **shared, virtualised, frequency-uncontrolled
AWS instance** — which makes it a genuinely honest place to teach measurement variance, because the
noise is real rather than simulated.

### What I could not verify

- `rr` internals: I could not fetch `rr-project.org/rr.html` (404) or the rr wiki technical
  overview (GitHub served an editor shell). rr claims below come from the README, the abstract of
  the OOPSLA/arXiv paper, and are marked where uncertain.
- Intel's own VTune top-down cookbook page returned **403**; the top-down description below comes
  from Andi Kleen's `pmu-tools`/`toplev` documentation instead, which implements the same method.
- bpftrace's exhaustive probe-type list: the man page defers to separate stdlib docs I did not fetch.
  The probe types listed below are from general knowledge, marked as such.
- I did **not** verify `compute-sanitizer` by running it (no GPU available here); its behaviour is
  from NVIDIA's documentation only.

---

## 1. Sources

| Source | What it is | Value here |
|---|---|---|
| `clang.llvm.org/docs/{Address,Thread,Memory,Undefined*}Sanitizer.html` | The authoritative overhead numbers and instrumentation requirements | **Highest.** Every slowdown figure in §3 is quoted from these. |
| `github.com/google/sanitizers/wiki/AddressSanitizerAlgorithm` | The 8:1 shadow-memory formula and shadow-byte encoding | Highest — this is the one page that makes ASan's report legible. |
| `github.com/google/sanitizers/wiki/AddressSanitizerFlags` | `ASAN_OPTIONS` defaults, incl. `quarantine_size_mb=256` | High. |
| `valgrind.org/docs/manual/mc-manual.html` | Memcheck's V-bits/A-bits model, limitations | High — the contrast case for ASan. |
| `docs.nvidia.com/compute-sanitizer/` | memcheck / racecheck / initcheck / synccheck | High. Also states the tools **cannot be combined**. |
| `dwarfstd.org/doc/DWARF5.pdf` (3.5 MB, fetched) | Section list, line-number state machine, DIE model | High. |
| `man7.org/linux/man-pages/man1/perf-record.1.html` | `--call-graph fp\|dwarf\|lbr` and their trade-offs | High. |
| `brendangregg.com/blog/2024-03-17/the-return-of-the-frame-pointers.html` | The frame-pointer argument, overhead data, distro timeline | **Highest** for §4's central claim. |
| `fedoraproject.org/wiki/Changes/fno-omit-frame-pointer` | The Fedora 38 change proposal with measured costs | High — primary source for the numbers. |
| `github.com/andikleen/pmu-tools` + its `toplev-manual` wiki | Top-Down Microarchitecture Analysis as implemented | High (Intel's own cookbook page 403'd). |
| `brendangregg.com/flamegraphs.html` | How to read a flame graph; differential graphs | High. |
| `infoq.com/presentations/latency-response-time/` (Gil Tene) | Coordinated omission | Medium as fetched (abstract-level), but the concept is well-established; §5 reconstructs it fully. |
| `github.com/google/benchmark/blob/main/docs/user_guide.md` | `DoNotOptimize` / `ClobberMemory` semantics and their limits | High — including the important caveat that `DoNotOptimize` does **not** protect the expression. |
| `sourceware.org/gdb/current/onlinedocs/` | watchpoints, hardware vs software | High. |
| `man7.org/.../core.5.html` | core_pattern, RLIMIT_CORE, coredump_filter, systemd-coredump | High. |
| `github.com/rr-debugger/rr` README + `arxiv.org/abs/1705.05937` | rr requirements and claims | Medium — the deep technical page was unreachable. |
| **Live CE API probes** | 20+ programs compiled and executed on godbolt.org | **Highest.** Everything in §0 and §8. |

---

# 2. Debuggers, and how they work

## 2.1 The one primitive: `ptrace`

Everything a Unix debugger does is `ptrace(2)` plus bookkeeping. There is no debugger kernel
subsystem; there is a single multiplexed syscall and a lot of userspace.

```c
long ptrace(enum __ptrace_request request, pid_t pid, void *addr, void *data);
```

The requests that matter, and what each is actually for:

| Request | What it does | Used to implement |
|---|---|---|
| `PTRACE_TRACEME` | *The child* volunteers to be traced by its parent | `gdb ./prog` (fork, child TRACEMEs, execs) |
| `PTRACE_ATTACH` / `SEIZE` | *The debugger* grabs a running process | `gdb -p PID` |
| `PTRACE_PEEKTEXT` / `POKETEXT` | Read/write one word of the tracee's memory | **installing a breakpoint**; `print`; `set var` |
| `PTRACE_PEEKUSER` / `POKEUSER` | Read/write the kernel's `struct user` — **including the x86 debug registers** | **hardware watchpoints** |
| `PTRACE_GETREGS` / `SETREGS` | Whole register file in/out | `info registers`; unwinding; backing RIP up after a trap |
| `PTRACE_CONT` | Resume | `continue` |
| `PTRACE_SINGLESTEP` | Execute exactly one instruction, then `SIGTRAP` | `stepi`; **stepping over a breakpoint**; software watchpoints |
| `PTRACE_SYSCALL` | Resume, stop at next syscall entry *and* exit | `strace`, `catch syscall` |
| `PTRACE_GETSIGINFO` | Why did we stop? | distinguishing a breakpoint trap from a real `SIGSEGV` |

The control flow is always the same shape: the debugger calls `waitpid()` and blocks; the tracee
runs; when the tracee stops (signal, trap, syscall, exit) `waitpid` returns and the debugger
inspects. **A debugger is a `waitpid` loop.**

The key mental correction for students: `ptrace` gives you *no* notion of a line, a variable, a
type, or a stack frame. It gives you bytes and registers. Everything human-shaped is reconstructed
by the debugger from **DWARF** (§2.5).

## 2.2 How a breakpoint is implemented: `0xCC`

On x86, `INT3` is a one-byte instruction, opcode **`0xCC`**, whose entire purpose is to raise a
debug trap. Setting a breakpoint at address `A`:

1. `PEEKTEXT` the word at `A`, save the original first byte.
2. `POKETEXT` the same word back with byte 0 replaced by `0xCC`.
3. `CONT`.
4. When the CPU executes `0xCC` it raises `#BP`; the kernel turns that into `SIGTRAP` to the
   tracee; the tracer's `waitpid` returns.
5. **`RIP` is now `A + 1`** — the trap byte has already been consumed. The debugger must
   `GETREGS`, decrement `RIP` by one, `SETREGS`.
6. To resume: restore the original byte, `SINGLESTEP` one instruction, re-write `0xCC`, `CONT`.
   That restore/step/re-arm dance is why a breakpoint in a hot loop is so expensive: every hit is
   four syscalls and two context switches.

This is **verified running on Compiler Explorer** — see §8.1 for the full 55-line program and its
output. Its transcript is the single best teaching artefact in this whole document:

```
[dbg] child stopped, installing breakpoint at 0x401176
[dbg] original word = 0x10ec8348e5894855  (first byte 0x55)     <- 0x55 = push rbp
[dbg] patched  word = 0x10ec8348e58948cc   <- low byte replaced by 0xCC
[dbg] SIGTRAP #1  rip=0x401177 (bp+1)  rdi=0                    <- RIP is one PAST the trap
[dbg] SIGTRAP #2  rip=0x401177 (bp+1)  rdi=1
[dbg] SIGTRAP #3  rip=0x401177 (bp+1)  rdi=2
[dbg] child exited=1 status=0, breakpoint hit 3 times
```

Note `rdi` = 0, 1, 2 across the three hits: that is the function argument, read straight out of the
register file per the System V AMD64 calling convention. The student has just implemented `bt`'s
argument display with no library at all.

Corollaries worth stating explicitly:

- **Breakpoints modify your program's text.** A checksum over `.text`, or an anti-debug check, will
  notice. So will an instruction-cache-sensitive measurement.
- **Breakpoints are not free and not transparent.** Timing under a debugger is meaningless.
- On a read-only, shared, or `mmap`ed-file text page, `POKETEXT` triggers a private
  copy-on-write — the kernel does this for the tracer.

## 2.3 Watchpoints: the four hardware registers, and the cliff behind them

x86-64 has **four** debug address registers `DR0`–`DR3`, plus `DR6` (status: which one fired) and
`DR7` (control: enable bits, read/write/execute mode, and length 1/2/4/8). A hardware watchpoint
costs *zero* runtime overhead — the memory-access check is in the load/store path already.

Verified on CE (§8.2): writing `DR0 = &watched` and `DR7 = 0xd0001` (`L0` | `RW0=01` write-only |
`LEN0=11` four bytes) produces a `SIGTRAP` on **every write**, with `DR6 = 0xffff0ff1` — bit 0 set,
meaning DR0 was the one that fired:

```
[dbg] DR0<-0x404054 rc=0  DR7<-0xd0001 rc=0  errno=0 (Success)
[dbg] watch hit #1 rip=0x4011fb dr6=0xffff0ff1 value now=10
[dbg] watch hit #2 rip=0x4011fb dr6=0xffff0ff1 value now=20
[dbg] watch hit #3 rip=0x4011fb dr6=0xffff0ff1 value now=30
```

The teaching point is the **cliff**. Four registers, each covering at most 8 bytes. Ask GDB to
`watch` a 4 KB struct, or a fifth variable, and it silently falls back to a **software watchpoint**,
which GDB's own manual describes as single-stepping the entire program and re-evaluating the
expression at every instruction — *"hundreds of times slower than normal execution."* A student who
does not know this will conclude their program "hangs under the debugger."

- `watch expr` — break on write-and-value-changed
- `rwatch expr` — break on read (hardware only)
- `awatch expr` — break on either
- `set can-use-hw-watchpoints 0` — force software, useful to prove the cliff exists
- Hardware watchpoints watch **all threads**; software ones only the current thread.

## 2.4 Single-stepping and the trap flag

`PTRACE_SINGLESTEP` is implemented by the kernel setting **`EFLAGS.TF`** (bit 8, the Trap Flag)
before returning to userspace. With TF set the CPU raises a debug exception *after* the next
instruction retires. The kernel clears TF, converts the exception to `SIGTRAP`, and stops the
tracee. So "step one instruction" is one bit in a flags register, and `stepi` costs a full
stop/resume round trip — again, several microseconds per instruction.

`step` (source-level step) is *not* a primitive. GDB implements it as: look up the current line's
address range in the DWARF line table, single-step (or set temporary breakpoints) until `RIP`
leaves that range and lands on an address marked `is_stmt`. **Which is exactly why stepping goes
insane at `-O2`** — see §2.6.

## 2.5 DWARF: the map from bytes back to source

DWARF is the debug-information format. It is not "symbols"; it is a full description of the
program's types, scopes, variable locations, and line mapping, stored in ELF sections that are not
loaded at runtime.

### Sections (DWARF 5)

| Section | Contents |
|---|---|
| `.debug_info` | The DIE tree — the bulk of everything |
| `.debug_abbrev` | Abbreviation table; DIEs reference it so each DIE need not repeat its attribute list |
| `.debug_str`, `.debug_line_str` | String pools |
| `.debug_str_offsets`, `.debug_addr` | Indirection tables (DWARF 5 split-dwarf machinery) |
| `.debug_line` | The line-number program (a bytecode!) |
| `.debug_loclists` (`.debug_loc` pre-5) | **Location lists** — where a variable lives, *as a function of PC* |
| `.debug_rnglists` (`.debug_ranges`) | Address ranges for non-contiguous functions |
| `.debug_frame` | Call frame info for unwinding (the non-`.eh_frame` variant) |
| `.debug_names` (`.debug_pubnames`/`pubtypes` pre-5) | Accelerated name lookup index |
| `.debug_macro` | Preprocessor macro definitions (needed for `print SOME_MACRO`) |
| `.eh_frame` / `.eh_frame_hdr` | **Loaded at runtime**; used by C++ exceptions *and* by profilers/unwinders |

The critical distinction: `.debug_*` is stripped-and-forgotten metadata; **`.eh_frame` is a
loadable, allocated section that ships in production binaries** because C++ exception unwinding
needs it. That is why `perf --call-graph dwarf` can work on a binary with no `-g`.

### DIEs

`.debug_info` is a tree of **Debugging Information Entries**. Each DIE has a `DW_TAG_*` (what kind
of thing) and a list of `DW_AT_*` attributes (its properties), and may have children. This is the
whole model. Live from CE (`llvm-dwarfdump --debug-info`, gcc 15.2 `-O2 -g`):

```
0x0000000c: DW_TAG_compile_unit
              DW_AT_producer  ("GNU C++17 15.2.0 -mtune=generic -march=x86-64 -g -g -O2")
              DW_AT_language  (DW_LANG_C_plus_plus_14)
              DW_AT_name      ("/app/example.cpp")
              DW_AT_comp_dir  ("/app")
              DW_AT_ranges    (0x0000000c [0x401040, 0x40105c))
              DW_AT_stmt_list (0x00000000)          <- offset into .debug_line
0x0000003b:   DW_TAG_base_type
                DW_AT_byte_size (0x08)
                DW_AT_encoding  (DW_ATE_unsigned)
                DW_AT_name      ("long unsigned int")
```

Note `DW_AT_producer` records the **exact command line**, including `-O2`. When a debugging session
is going badly, that attribute is the first thing to read: it tells you what the compiler actually
did, not what your build system claims it did.

The common tags a student will meet: `DW_TAG_compile_unit`, `subprogram` (function),
`formal_parameter`, `variable`, `lexical_block`, `base_type`, `pointer_type`, `const_type`,
`structure_type`, `member`, `typedef`, `inlined_subroutine`, `array_type`, `subrange_type`.

### The line-number program

`.debug_line` is not a table; it is a **bytecode program for a state machine** that *emits* a table.
Registers include `address`, `op_index`, `file`, `line`, `column`, `is_stmt`, `basic_block`,
`end_sequence`, `prologue_end`, `epilogue_begin`, `discriminator`. Opcodes come in three kinds:

- **Standard** — `DW_LNS_copy` (emit a row), `DW_LNS_advance_pc`, `DW_LNS_advance_line`,
  `DW_LNS_set_file`, `DW_LNS_negate_stmt`, `DW_LNS_set_prologue_end`, …
- **Extended** — `DW_LNE_set_address` (the only way to load an absolute address; this is where
  relocations apply), `DW_LNE_end_sequence`, …
- **Special** — a single byte that advances *both* address and line by amounts derived from the
  header's `line_base`/`line_range`/`opcode_base` and emits a row. This is the compression trick:
  the common case "next instruction, next line" is one byte.

It is encoded this way because a naive address→line table for a large binary would be enormous.
Teaching it as *a program that generates a table* rather than *a table* is the thing that makes
`DW_AT_stmt_list` and `llvm-dwarfdump --debug-line` legible.

## 2.6 What optimisation does to DWARF — the `-O2 -g` problem

This is the section that earns the unit. Two DWARF facts, both captured live from CE, explain
essentially every frustrating debugging session on optimised code.

### Fact 1: a variable's *location* becomes a function of PC — or ceases to be a location at all

Same source, `int scaled = a * 4; int shifted = scaled + b; int result = shifted ^ 0x55;`

At **`-O0 -g`** every local has a stack slot:

```
DW_TAG_variable  DW_AT_name ("scaled")   DW_AT_location (DW_OP_fbreg -20)
DW_TAG_variable  DW_AT_name ("shifted")  DW_AT_location (DW_OP_fbreg -24)
DW_TAG_variable  DW_AT_name ("result")   DW_AT_location (DW_OP_fbreg -28)
```

At **`-O2 -g`**, `scaled` has no storage anywhere:

```
DW_TAG_variable  DW_AT_name ("scaled")
  DW_AT_location (0x00000029:
     [0x401160, 0x401167): DW_OP_breg5 RDI+0, DW_OP_lit2, DW_OP_shl, DW_OP_stack_value)
```

Read that expression: *"push RDI, push 2, shift left, and the result **is the value** — it is not
stored anywhere."* `DW_OP_stack_value` is DWARF saying "this variable does not exist in memory or in
a register; here is a recipe to recompute it." GDB will happily `print scaled` and be correct, and
you cannot `set var scaled = 5`, because there is nowhere to put it.

And `shifted` gets a **location list** — three different answers depending on where RIP is:

```
DW_AT_location (0x00000040:
   [0x401160, 0x401163): DW_OP_breg5 RDI+0, DW_OP_lit2, DW_OP_shl, DW_OP_breg4 RSI+0,
                         DW_OP_plus, DW_OP_stack_value
   [0x401163, 0x401166): DW_OP_reg0 RAX
   [0x401166, 0x401167): DW_OP_breg0 RAX+0, DW_OP_const1u 0x55, DW_OP_xor, DW_OP_stack_value)
```

For 3 bytes it is a computed value; for the next 3 bytes it genuinely lives in RAX; for the last
byte it is again a recipe. **This is what "optimised out" means.** When the location list has *no*
entry covering the current PC — because at that point the value is provably dead and the register
has been reused — GDB prints `<optimized out>`. It is not a bug and not missing information; it is
DWARF accurately reporting that the variable has no representation at this instant. The value was
never wrong; it stopped existing.

At `-O0`, `DW_OP_fbreg -20` is valid for the entire function, which is why `-O0` debugging feels
sane. The comfort of `-O0` is precisely the cost of `-O0`.

### Fact 2: the line table becomes many-to-many

Same source at `-O2 -g`, `llvm-dwarfdump --debug-line`:

```
Address            Line   Column File  Flags
0x0000000000401160      3     50      1   is_stmt
0x0000000000401160      4      5      1   is_stmt
0x0000000000401160      5      5      1   is_stmt
0x0000000000401160      6      5      1   is_stmt
0x0000000000401160      7      5      1   is_stmt
0x0000000000401160      5      9      1
0x0000000000401163      6      9      1
0x0000000000401166      8      1      1
```

**Five different source lines are all marked `is_stmt` at the identical address `0x401160`.** There
is no "the address of line 5". `break file.cpp:5` has to pick one of many candidates; stepping
appears to jump backwards (line 7 → line 5 → line 6); and the instruction the CPU is executing
genuinely belongs to several lines at once because the optimiser interleaved them. Later in the same
dump, `main` shows `discriminator 1` on two rows at line 9 — that is the compiler distinguishing two
different inlined/duplicated instances of the same source location.

### The practical consequences to teach

| Symptom | DWARF cause | Mitigation |
|---|---|---|
| `<optimized out>` | Location list has no entry for this PC | `-Og`; or `volatile`; or accept it and read registers |
| Stepping jumps around | Many-to-many line↔address mapping | `-Og`; step by instruction (`stepi`/`layout asm`) |
| Breakpoint "not hit" | Function inlined; the symbol has no `low_pc` | `break` on the *call site*, or use `info inline` / `-fno-inline` for the one function |
| Frame missing from `bt` | Inlined; needs `DW_TAG_inlined_subroutine` handling | modern GDB does this; older ones and most profilers do not |
| `Cannot access memory` in `bt` | Unwinding failed — see §2.7 | `--call-graph dwarf`, or frame pointers |

**`-Og`** is the intended compromise: GCC/Clang's "optimise, but do not do the transformations that
destroy debug info." It is not `-O0` and not `-O2`; teach it as a real, distinct third answer.

## 2.7 Stack unwinding and `.eh_frame` CFI

To print a backtrace you must answer, for each frame: *given RIP and RSP now, where is the caller's
return address, and what were the caller's RSP/RBP?* With frame pointers this is a linked list walk.
Without them, the answer is in **Call Frame Information**.

CFI is, again, a bytecode. For each PC range it defines the **CFA** (Canonical Frame Address — a
fixed anchor in the frame, conventionally the value RSP had just before the `call`) and, relative
to it, where each saved register lives. Live from CE (`llvm-dwarfdump --eh-frame`, `-O2 -g`):

```
CIE  Version: 1  Augmentation: "zR"
  Code alignment factor: 1
  Data alignment factor: -8
  Return address column: 16
  DW_CFA_def_cfa: RSP +8
  DW_CFA_offset: RIP -8
  CFA=RSP+8: RIP=[CFA-8]                       <- on function entry, ret addr is at CFA-8

FDE cie=00000000 pc=00401160...004014cc
  DW_CFA_advance_loc: 2 to 0x401162
  DW_CFA_def_cfa_offset: +16
  DW_CFA_offset: R15 -16                        <- after `push r15`, CFA moved and r15 is at CFA-16
  DW_CFA_advance_loc: 2 to 0x401164
  DW_CFA_def_cfa_offset: +24
  DW_CFA_offset: R14 -24
```

Read it as a running commentary on the prologue: *"two bytes in, we pushed something, so CFA is now
RSP+16 and R15 is at CFA−16."* A **CIE** (Common Information Entry) holds the shared defaults; each
**FDE** (Frame Description Entry) covers one function's PC range and records the deltas.

The dump also contains this, in `_start`'s FDE, which is worth showing students for its own sake:

```
DW_CFA_def_cfa_expression: DW_OP_breg7 RSP+8, DW_OP_breg16 RIP+0, DW_OP_lit15, DW_OP_and,
                           DW_OP_lit11, DW_OP_ge, DW_OP_lit3, DW_OP_shl, DW_OP_plus
```

That is a conditional: *"CFA is RSP+8, plus 8 more if (RIP & 15) >= 11."* — hand-written assembly
whose stack layout depends on where in the instruction you are. CFI is Turing-adjacent, and the
unwinder is an interpreter.

Also note `DW_CFA_undefined: RIP` in one FDE: that is a function declaring *"the backtrace stops
here"* — the outermost frame, so the unwinder does not walk off into garbage.

Key point for §4: **`.eh_frame` is in the loaded binary even without `-g`.** That is why
`perf record --call-graph dwarf` is possible at all; it also explains why that mode is expensive
(perf must copy a chunk of the user stack into the trace buffer at every sample and unwind it later
in userspace).

## 2.8 Practical GDB/LLDB

Presented as *what problem does this command solve*, not as a command list.

**Conditional breakpoints and the cost model.**
```
break foo.c:42 if n > 1000 && p != 0
break foo.c:42                       # then:
condition 1 n > 1000
ignore 1 500                         # skip the first 500 hits
tbreak foo.c:42                      # one-shot
```
A condition is evaluated **in the debugger**, after a full stop/inspect/resume cycle. A conditional
breakpoint in a loop that runs 10⁶ times and matches once still costs 10⁶ round trips — often
minutes. This is exactly the case where a `printf` or a `__builtin_trap()` guarded by an `if` beats
the debugger, and it is the honest answer to "why is printf debugging still alive."
(GDB can compile simple conditions to native code with the `compile`/agent-expression machinery,
which helps — but only sometimes, and it is not the default.)

**Watchpoints.** `watch x`, `rwatch x`, `awatch x`. See §2.3. The one thing to internalise: check
whether you got a hardware or software watchpoint, because the difference is 10⁴ in speed.

**`x` — examine memory.** `x/NFU addr` where N = count, F = format, U = unit.
```
x/16xb &buf      # 16 hex bytes    -- what is actually in this buffer
x/8xg $rsp       # 8 hex giants    -- read the raw stack when the unwinder has failed
x/s p            # string
x/16i $rip       # 16 instructions -- the ground truth when line info lies
x/4dw &arr       # 4 decimal words
```
`x/16i $rip` is the escape hatch for §2.6: when DWARF says something absurd, disassemble and
believe the machine.

**`info frame`** — dumps the unwinder's *reasoning*, not just its answer: the CFA, where the saved
RIP is, which registers this frame saved and where. When a backtrace is wrong, `info frame` shows
you *why* — usually "caller of frame at 0x… (unreliable)" meaning it fell back to heuristics.
Companions: `info registers`, `info locals`, `info args`, `info line *0x401160`,
`info symbol 0x401160`, `info sharedlibrary`, `maint info sections`.

**Pretty printers.** Without them, `print myMap` on a `std::unordered_map` prints the raw node
struct. GDB pretty printers are **Python classes** registered against a type regex, exposing
`to_string()` and `children()`. libstdc++ and libc++ ship them; they are why `print v` on a
`std::vector` shows elements. Teaching point: the debugger's understanding of your types is
*programmable*, and for any nontrivial in-house data structure, writing a 30-line printer pays for
itself in the first hour. (LLDB's equivalent: data formatters / synthetic children.)

**Scripting.** GDB embeds Python (`python-interactive`, `gdb.execute()`, `gdb.parse_and_eval()`,
breakpoint subclasses with `stop()` returning True/False). This is the right tool when the condition
you want is not expressible in the target language — "break when this hash table has more than 3
collisions in a bucket." LLDB embeds Python too and has a cleaner object model.

**Non-stop and reverse.** `set non-stop on` lets you stop one thread and leave others running.
GDB's built-in `record full` gives *software* reverse execution by logging every instruction's
effects — correct, but ~10³× slowdown, and it cannot replay most syscalls. This is why `rr` exists.

## 2.9 Core dumps and post-mortem analysis

A core dump is the process's memory image plus register state, written by the kernel when a fatal
signal (`SIGSEGV`, `SIGABRT`, `SIGFPE`, `SIGBUS`, `SIGILL`, `SIGQUIT`) terminates it. It is the only
debugging you get for a crash that already happened, on a machine you do not control.

The mechanics, each of which is a place students get stuck:

- **`RLIMIT_CORE`.** If the soft limit is 0 — a very common default — **no core is written and
  nothing tells you.** `ulimit -c unlimited`. Exception: if `core_pattern` pipes to a program,
  `RLIMIT_CORE` is ignored.
- **`/proc/sys/kernel/core_pattern`.** Template with `%p` pid, `%e` exe name, `%u` uid, `%s` signal,
  `%t` timestamp, `%h` hostname. Max 128 bytes. May contain `/` to place cores in a directory.
- **Piping.** If `core_pattern` starts with `|`, the rest is an **absolute path** to a program that
  receives the core on stdin. This is how `systemd-coredump` and every container crash-collector
  work. The handler runs as root. In a container this bites: `core_pattern` is a **host-wide**
  setting, not namespaced, so a containerised app's cores go wherever the host says.
- **`/proc/PID/coredump_filter`.** Bitmask choosing which mappings to include (anonymous private/
  shared, file-backed private/shared, ELF headers, huge pages). Default excludes file-backed
  mappings — which is why a core is much smaller than RSS, and also why you must have the exact
  same binaries to make sense of it.
- **systemd.** `coredumpctl list`, `coredumpctl info <pid>`, `coredumpctl gdb <pid>`, cores in
  `/var/lib/systemd/coredump/` (compressed).

Analysis: `gdb ./prog core`, then `bt`, `info registers`, `thread apply all bt`, `x/…`. The three
things that make a core useless — teach all three as a checklist:

1. The binary is **stripped** and you do not have the matching unstripped one. Solution: build with
   `-g`, ship stripped, keep the debug objects, match by **Build ID** (`readelf -n`), serve them
   from a `debuginfod` server.
2. The binary is **PIE** and you did not record the load base. Modern GDB reads it from the core's
   NT_FILE note; older tooling does not.
3. **Optimised code** — you get §2.6's problems with no ability to re-run.

`gcore <pid>` takes a core of a *live* process without killing it: the right move for a hung
process in production, because it captures state in milliseconds and lets the process continue.

## 2.10 `rr`: record once, debug backwards forever

The premise: most hard bugs are hard because they are **nondeterministic**. You cannot form a
hypothesis and test it if the next run behaves differently. `rr` removes that variable entirely.

**What it does.** `rr record ./prog` produces a trace. `rr replay` re-executes it **bit-identically**
— same addresses, same malloc results, same thread interleaving, same signal delivery points, same
"random" values — under a GDB session that additionally supports `reverse-continue`,
`reverse-step`, `reverse-stepi`, `reverse-finish`, and **reverse watchpoints**.

**Why that is transformative.** The canonical workflow becomes:

1. `watch -l some_corrupted_field`
2. `reverse-continue`
3. You are now stopped at the instruction that wrote the bad value.

Reverse-continue on a watchpoint answers "who corrupted this?" — the single hardest question in
systems debugging — in one command, instead of a week of bisecting print statements. Combined with
`rr pack` the trace is portable: a colleague can replay *your* crash on *their* machine.

**How it works** (from the README and the arXiv paper abstract; the deep technical page was
unreachable, so treat the mechanism sketch as high-confidence-but-secondhand):

- Entirely **userspace** — no kernel patch, no VM, no recompilation, stock compilers/runtimes.
- **All threads are serialised onto one core.** rr chooses the schedule and records it, so the
  interleaving is part of the recording. Consequence: rr is for **low-parallelism** workloads; it
  does not scale, and it will not reproduce races that require true simultaneity on two cores. It
  reproduces the *interleaving-order* races, which is most of them.
- Nondeterminism is recorded at its sources: syscall results are logged and replayed from the log
  rather than re-executed; `RDTSC` and `CPUID` are trapped and replayed; signals must be delivered
  at exactly the same point in the instruction stream.
- **"Exactly the same point" is the hard part, and the answer is the PMU.** rr counts *retired
  conditional branches* with a hardware performance counter to build a deterministic clock, then
  uses that count plus the program counter to identify a point in execution uniquely. This is
  precisely why rr needs a working PMU and specific microarchitectures.
- Reverse execution is **not** backwards execution: rr takes periodic checkpoints (process forks)
  and implements `reverse-continue` as *"jump to the last checkpoint before here, replay forward
  looking for the last occurrence of the condition."* Backwards is forwards, done cleverly.

**Requirements and limits** (from the README):

- Intel **Nehalem (2010) or later**; certain **AMD Zen or later**; certain AArch64 including
  **ARM Neoverse N1 and Apple Silicon M-series**.
- Linux kernel ≥ 4.7. VM guests work **only if the hypervisor virtualises the PMU** — VMware, KVM,
  AWS, GCP known to work; **Xen not supported**.
- Requires PMU access: `perf_event_paranoid` low enough. **This is why rr cannot run on Compiler
  Explorer** (verified: `perf_event_open` → `EACCES`, paranoid = 4) and typically not in a default
  Docker container without `--privileged` or a relaxed seccomp profile.
- Shared memory with processes *outside* the recording is not handled.
- Overhead: the paper claims "low overhead" for "real-world low-parallelism workloads"; commonly
  reported figures are ~1.2–2× for typical single-threaded programs. **I could not verify a specific
  number** — the paper's body was not fetchable.

Adjacent tools worth a mention: **UndoDB / Undo LiveRecorder** (commercial, similar model, supports
more parallelism), **WinDbg TTD** (Time Travel Debugging on Windows), and **`gdb record full`**
(built in, correct, unusably slow).

---

# 3. Sanitizers, precisely

The framing to teach: a sanitizer is **a compiler pass plus a runtime library**. The compiler
rewrites your program to check things; the runtime maintains the metadata those checks consult. This
is why (a) they need recompilation, (b) uninstrumented code is invisible to them, and (c) they are
far faster than Valgrind, which has to work out the same facts from the binary alone.

## 3.1 AddressSanitizer

**What it instruments.** Every load and store gets a shadow-memory check inserted before it. Every
stack frame with address-taken locals is rewritten to include redzones. Globals are given redzones.
`malloc`/`free`/`new`/`delete` are replaced by ASan's own allocator.

**The shadow mapping — the one formula.** Eight application bytes map to one shadow byte:

```
Shadow = (Mem >> 3) + 0x7fff8000;      // x86-64
```

Shadow byte encoding (this is the whole thing):

- `0` — all 8 bytes addressable
- `1..7` — the **first k** bytes are addressable, the remaining `8-k` are not (this works because
  malloc returns 8-byte-aligned memory, so a partial qword can only be partial at the *end*)
- **negative** (`0x80`–`0xff`) — all 8 poisoned, and the specific value says *why*

The "why" values are what you read off an ASan report, and they are printed in the legend of every
report (verified live on CE, full transcript in §8.3):

| Byte | Meaning |
|---|---|
| `fa` | Heap **left** redzone |
| `fd` | **Freed** heap region |
| `f1` `f2` `f3` | Stack left / mid / right redzone |
| `f5` | Stack **use after return** |
| `f8` | Stack **use after scope** |
| `f9` | Global redzone |
| `f6` | Global **init order** (static init order fiasco) |
| `f7` | Poisoned by user (`__asan_poison_memory_region`) |
| `fc` | **Container overflow** (`std::vector` capacity vs size) |
| `ac` / `bb` | Array cookie / intra-object redzone |
| `fe` | ASan internal |
| `ca` / `cb` | Left / right alloca redzone |

**The instrumentation, concretely.** For an 8-byte aligned 8-byte access ASan emits roughly:

```c
if (*ShadowAddr(a) != 0) ReportError(a, 8, is_write);
```

For a smaller or unaligned access it must also check whether the access falls in the addressable
prefix:

```c
byte last = (a & 7) + kAccessSize - 1;
if (shadow != 0 && last >= shadow) ReportError(...);
```

Two branches, well-predicted, on every memory operation — hence the modest 2× and not 20×.

**Quarantine — how use-after-free is caught at all.** A freed block is *not* returned to the
allocator. It is poisoned to `fd` and put on a FIFO **quarantine** whose default size is
`quarantine_size_mb=256`. Only when the quarantine overflows is the oldest block actually recycled.
This is a **probabilistic** detector with a knob: the bigger the quarantine, the longer the window
in which a use-after-free is still detected, at the cost of memory. Beyond that window, the address
gets reused and the bug becomes silent. **Teach this as a first-class limitation:** ASan does not
prove absence of UAF; it catches UAFs that happen within ~256 MB of subsequent allocation traffic.

**Cost** (Clang docs): **~2× slowdown**; substantial memory overhead, "stack memory usage can
increase up to 3×"; ~1/8 of the address space reserved for shadow (mostly untouched virtual memory).

**Catches:** heap/stack/global out-of-bounds, use-after-free, use-after-return
(`detect_stack_use_after_return`, on by default on Linux), use-after-scope
(`-fsanitize-address-use-after-scope`), double-free, invalid free, memory leaks (via LSan),
`std::vector` container-overflow, static init order fiasco.

**Misses:** uninitialised reads (that is MSan); data races (TSan); integer/arithmetic UB (UBSan);
intra-object overflows by default (writing past a struct member into a sibling member — needs
`-fsanitize-address-field-padding`, which changes ABI); anything in **uninstrumented libraries**
(a bad access inside an uninstrumented `.so` is invisible unless it hits a redzone in *your*
memory); OOB by a huge stride that jumps clean over the redzone into another valid object.

**Flags worth teaching:** `ASAN_OPTIONS=detect_leaks=0|1`, `halt_on_error=0` (keep going, find more),
`abort_on_error=1` (get a core dump), `malloc_context_size=N` (frames in the alloc/free stacks),
`quarantine_size_mb`, `log_path=/tmp/asan`, `symbolize=1` + `ASAN_SYMBOLIZER_PATH=/path/llvm-symbolizer`
— **an unsymbolised report is the single most common ASan complaint and it is always this**.
`ASAN_OPTIONS=help=1` prints everything.

## 3.2 UndefinedBehaviorSanitizer

Not one tool. **A family of independent checks**, each a small inline test emitted at a specific
construct. `-fsanitize=undefined` turns on a curated subset; the rest are opt-in.

**In `-fsanitize=undefined`:** `alignment`, `bool` (a `bool` holding neither 0 nor 1), `builtin`
(e.g. `__builtin_clz(0)`), `bounds` (array index, where the bound is statically known),
`enum` (value outside the enumeration's range), `float-cast-overflow`, `function` (calling through a
function pointer of the wrong type), `integer-divide-by-zero`, `nonnull-attribute`, `null`
(dereferencing/binding a null), `object-size` (uses `__builtin_object_size`),
`pointer-overflow`, `return` (falling off the end of a value-returning function),
`returns-nonnull-attribute`, `shift`/`shift-base`/`shift-exponent`, **`signed-integer-overflow`**,
`unreachable` (reaching `__builtin_unreachable`), `vla-bound`.

**Deliberately NOT in `-fsanitize=undefined`** — this list is the teaching point:

| Check | Why excluded |
|---|---|
| `float-divide-by-zero` | Not UB in IEEE-754; produces ±Inf/NaN |
| **`unsigned-integer-overflow`** | **Well-defined** (wraps) — it is often intentional (hashing, checksums). UBSan can flag it, but flagging it is a *style* choice, not a UB check |
| `implicit-conversion` group (`implicit-integer-truncation`, `-sign-change`, …) | Legal C++, frequently unintentional |
| `local-bounds` | Higher cost, more false positives |
| **`vptr`** | Calling a member function on an object of the wrong dynamic type. Excluded because it needs RTTI and full instrumentation of the class hierarchy |
| `nullability-*` | Attribute violations, not UB |

Convenience groups: `-fsanitize=integer`, `-fsanitize=implicit-integer-conversion`,
`-fsanitize=nullability`.

**Cost.** "Small runtime cost and no impact on address space layout or ABI." In practice a few
percent to ~20% depending on which checks. Two production-viable modes:

- **`-fsanitize-trap=undefined`** — emit a `ud2` trap instead of calling the runtime. No diagnostic
  text, no runtime library, essentially zero size cost beyond the trap. You get a `SIGILL` at the
  exact instruction; combine with a core dump.
- **`-fsanitize-minimal-runtime`** — basic logging + deduplication, small attack surface, intended
  for production. Excludes `vptr`.

By default UBSan **recovers**: it prints and continues. `-fno-sanitize-recover=all` makes the first
finding fatal — **essential for CI**, because otherwise the build passes with a warning nobody reads.
Verified on CE: without it, exit code 0 and a diagnostic; with it, non-zero exit.

**Catches:** the specific constructs listed. **Misses:** everything not on the list — notably strict
aliasing violations, most lifetime/dangling issues, data races, uninitialised reads, and any UB the
optimiser already exploited *before* the sanitizer pass ran. That last one is the subtle killer:
UBSan instruments the IR, and if an earlier pass already deleted the branch that would have been
checked (because "it would be UB, therefore it can't happen"), there is nothing left to check. This
is why **UBSan at `-O0`/`-O1` finds things `-O2` does not.**

## 3.3 ThreadSanitizer

**The model: happens-before, via vector clocks.** TSan maintains, for each memory word (in 8-byte
granules), a small set of **shadow cells** recording recent accesses: which thread, what clock value,
read or write, what size. Each thread carries a **vector clock** — its own view of every other
thread's logical time. Synchronisation operations (mutex lock/unlock, atomic ops with the right
ordering, thread create/join, condvar signal/wait) **join** vector clocks: after `B` locks a mutex
`A` unlocked, B's clock absorbs A's, and everything A did before the unlock now *happens-before*
everything B does after the lock.

A **race** is reported when two accesses to the same address, at least one a write, from different
threads, are **not** ordered by happens-before. Verified live on CE:

```
WARNING: ThreadSanitizer: data race (pid=1)
  Write of size 4 at 0x58637879f758 by thread T2:
    #0 bump() /app/example.cpp:5:49
  Previous write of size 4 at 0x58637879f758 by thread T1:
    #0 bump() /app/example.cpp:5:49
  Location is global 'g' of size 4 at 0x58637879f758
  Thread T2 (tid=4, running) created by main thread at: ...
  Thread T1 (tid=3, finished) created by main thread at: ...
```

Note what the report contains: **both** accesses with their sizes and stacks, the *identity* of the
location (`global 'g'`, or `heap block of size N allocated at …`), and the **creation stack of both
threads**. That is four stack traces for one bug. Nothing else gives you that.

**Cost** (Clang docs): **5×–15× slowdown, 5×–10× memory**. Requires PIE (or a compatible mapping);
32-bit is unsupported and unplanned.

**The critical property: happens-before is not "did it actually interleave badly."** TSan reports a
race even if the two accesses were seconds apart in wall-clock time, because the *ordering* is
missing. Conversely — and this is the false-negative story — **TSan only sees code paths that
actually executed.** It is a dynamic analysis. A race on a branch you did not take is invisible.
Modern TSan mitigates this with adaptive delays (`TSAN_OPTIONS` has flags to inject scheduling
perturbations) to widen windows, but it cannot manufacture coverage.

**"Needs all code instrumented" — what that actually means.** The docs: *"ThreadSanitizer generally
requires all code to be compiled with `-fsanitize=thread`. If some code (such as pre-compiled dynamic
libraries) is not compiled with the flag, TSan may fail to detect races or may report false
positives."* Both directions matter:

- **False negatives:** a race where one access is inside an uninstrumented library is not seen.
- **False positives:** if an uninstrumented library performs the *synchronisation* (its own
  spinlock, its own atomics), TSan never learns about the happens-before edge and reports a race
  that is not one.

Interestingly, in the CE probe TSan also reported a **heap-use-after-free** (it intercepts the
allocator, so it gets some memory-error detection for free) — worth mentioning, but do not rely on it.

**Misses:** races in uninstrumented code; races on paths not executed; races that require a specific
interleaving that never occurred *and* whose synchronisation is genuinely absent only in that
interleaving; lock-order-inversion deadlocks unless `detect_deadlocks=1`; anything below the
synchronisation abstractions it knows (hand-rolled `asm` fences, `volatile`-based "synchronisation").

**Runtime flags:** `TSAN_OPTIONS=halt_on_error=1`, `history_size=N` (bigger = deeper stacks for the
*previous* access, at memory cost — this is the flag that turns "previous write by thread T1: [no
stack]" into a usable report), `detect_deadlocks=1`, `second_deadlock_stack=1`,
`suppressions=file`, `report_atomic_races=0`.

## 3.4 MemorySanitizer

**What it instruments.** Every value gets a parallel **shadow value** of the same width, bit-for-bit,
where a 1 bit means "this bit is uninitialised." Every arithmetic operation gets a shadow operation
that propagates uninitialisedness. The check fires not on *reading* uninitialised memory — that is
allowed and propagates — but on **using it in a way that becomes observable**: as a branch condition,
as an address, as an argument to a syscall or an interceptor, or on output.

That distinction is important and non-obvious. `int x; int y = x + 1;` is fine to MSan. `if (y)` is
the error. This models the language rule correctly and drastically cuts false positives.

**Origin tracking.** `-fsanitize-memory-track-origins=2` additionally records *where the
uninitialised value came from*. Verified live on CE:

```
==1==WARNING: MemorySanitizer: use-of-uninitialized-value
    #0 0x... in main /app/example.cpp:4
  Uninitialized value was created by a heap allocation
    #0 0x... in malloc .../msan_interceptors.cpp:1047:3
    #1 0x... in main /app/example.cpp:4:32
```

Without origins you get "you used something uninitialised, here." With origins you get "…and it was
born at *that* `malloc`." The second is usually the whole answer. `=1` records only allocation
points (cheaper); `=2` records the full propagation chain.

**Cost** (Clang docs): **~3× slowdown**; origin tracking adds a further **1.5×–2× on top**.

**The killer requirement.** *"MemorySanitizer requires that all program code is instrumented. This
also includes any libraries that the program depends on, even libc."* An uninstrumented function
that writes to a buffer leaves MSan believing the buffer is still uninitialised → **false positive**.
The runtime ships 70+ interceptors for common libc functions to paper over this, which is why the CE
probe worked at all with a stock glibc. But for real use with C++ you must build an instrumented
libc++ (`-stdlib=libc++` + a separately-built MSan libc++), and every third-party `.so` is a
liability. **This is why MSan is the least-deployed of the four despite being the most valuable
per-bug** — uninitialised-read bugs are miserable to find any other way.

Related but different: **`-ftrivial-auto-var-init=pattern|zero`** (Clang/GCC) does not *detect*
uninitialised reads, it *eliminates* them by initialising everything. `pattern` fills with a
recognisable poison (0xAA…) so bugs are loud; `zero` is cheap and makes them silent-but-safe.
Chrome, the Linux kernel and Windows all ship `zero` in production. Teach the pair together: MSan
finds the bug in testing, `-ftrivial-auto-var-init` defangs the ones you did not find.

## 3.5 LeakSanitizer

The simplest of the family: at process exit (or on demand via `__lsan_do_leak_check()`), stop the
world, treat registers, stacks, globals and thread-local storage as a root set, and do a
**conservative mark-and-sweep** over the allocator's live blocks. Anything unreachable is reported
with its allocation stack.

- It is **part of ASan** and on by default on Linux — verified: an ASan build with an unfreed
  `malloc` reports `SUMMARY: AddressSanitizer: 1234 byte(s) leaked in 1 allocation(s)`.
- It can also be used **standalone** with `-fsanitize=leak`, which has near-zero runtime cost
  (allocator interposition only, no shadow memory) — verified on CE, exit code 23.
- **Conservative** means: an integer that happens to look like a pointer keeps a block alive
  (false negative). This is why "still reachable at exit" is not the same as "not leaked."
- Categories: *definite* / *indirect* / *possible*. Suppress with `LSAN_OPTIONS=suppressions=file`
  and `print_suppressions=1`.
- A leak that is *reachable* at exit (a global cache) is not reported by default — which is
  correct for leak-detection and wrong for "did I free everything," a distinction worth stating.

## 3.6 Valgrind / Memcheck — the other approach entirely

Memcheck does not need recompilation because it does not compile anything: it **disassembles your
binary at runtime, translates it to an IR (VEX), instruments the IR, recompiles it to native code,
and runs that** — dynamic binary translation. Your original instructions never execute.

**The shadow model.** For every byte of memory Memcheck maintains:

- **A bits** ("addressable") — 1 bit per byte: may this byte be accessed?
- **V bits** ("valid-value") — **1 bit per bit**: is this bit initialised?

V bits propagate through arithmetic exactly like MSan's shadow, and errors are reported only when an
undefined value affects observable behaviour (a branch, an address, a syscall) — the same rule,
independently arrived at.

**Cost.** Commonly 10×–50× slowdown (Valgrind's own docs quote ~25% *memory* overhead thanks to
compression, but the CPU cost is the famous part). `--track-origins=yes` "halves Memcheck's speed"
again.

**How it differs from ASan/MSan, and when to reach for it:**

| | Memcheck | ASan + MSan |
|---|---|---|
| Recompile needed | **No** | Yes |
| Sees uninstrumented libraries, plugins, `dlopen`ed `.so`s | **Yes — everything** | No |
| Sees inline assembly, JITted code | Yes | Partially / no |
| Uninitialised reads | **Yes** (bit-precise) | MSan only, needs instrumented world |
| Heap OOB | Yes (redzones) | Yes |
| **Stack** and **global** OOB within a frame/object | **No** | **Yes** (ASan) |
| Use-after-return / use-after-scope | No | Yes |
| Data races | No (that's Helgrind/DRD) | TSan |
| Slowdown | 10–50× | 2× / 3× |
| Combines with the program's own allocator | Needs `--soname-synonyms` etc. | Replaces it |

The honest summary: **ASan is faster and finds more stack/global bugs; Memcheck needs no build
system cooperation and sees the whole process.** For a binary you cannot rebuild — a vendor library,
a released binary, a plugin — Memcheck is the only option. Valgrind's other tools: **Helgrind** and
**DRD** (races), **Cachegrind**/**Callgrind** (simulated cache and call profiling — deterministic,
which is a real advantage for A/B comparison, at the price of simulating an idealised CPU that is
not yours), **Massif** (heap profiling), **DHAT** (heap access patterns).

## 3.7 `compute-sanitizer` — the CUDA family

NVIDIA's equivalent, four separate tools, invoked as
`compute-sanitizer --tool <name> ./app`. **Only one tool per invocation** — they cannot be combined,
and NVIDIA recommends running memcheck first and fixing everything it finds before trusting the
others. (Not verified by me — no GPU in this environment. From NVIDIA's docs.)

| Tool | Detects | Explicitly does **not** |
|---|---|---|
| **memcheck** | Out-of-bounds and misaligned accesses to **global, local and shared** memory; hardware exceptions; `malloc`/`free` errors on the device heap; CUDA API errors; **leaks** (with `--leak-check full`) | Uninitialised reads; shared-memory races. Imprecise hardware exceptions may not be attributable to a source line |
| **racecheck** | **Shared-memory** hazards: WAW, WAR, RAW; deadlocks; async-copy synchronisation violations | Any memory-access error checking; anything in **global or local** memory |
| **initcheck** | **Uninitialised device memory** reads in global or shared memory; unused allocations | Memory-access errors (run memcheck first) |
| **synccheck** | Invalid use of `__syncthreads()`, `__syncwarp()`, cooperative-groups barriers — divergent threads reaching a barrier, invalid arguments | Memory-access errors |

Mapping to the CPU family, which is the pedagogically useful move:
memcheck ≈ ASan (bounds + allocator), initcheck ≈ MSan (uninitialised), racecheck ≈ TSan (races, but
**shared memory only** — a much narrower scope than TSan's), synccheck has **no CPU analogue**
because CPUs have no lockstep barrier that threads can diverge across.

The `--tool memcheck` path now also supports **compile-time instrumentation** via
`-fdevice-sanitize=memcheck`, which NVIDIA says gives "significant performance improvements" over
runtime binary instrumentation — i.e. CUDA is converging on the same compiler-pass architecture the
CPU sanitizers have always used.

## 3.8 What combines with what — VERIFIED

I compiled every pair on Compiler Explorer with clang 21.1. Results:

| Combination | Result |
|---|---|
| `-fsanitize=address,undefined` | ✅ **works** |
| `-fsanitize=thread,undefined` | ✅ **works** |
| `-fsanitize=memory,undefined` | ✅ **works** |
| `-fsanitize=address,leak` | ✅ works (LSan is already inside ASan) |
| `-fsanitize=address,thread` | ❌ **`error: invalid argument '-fsanitize=address' not allowed with '-fsanitize=thread'`** |
| `-fsanitize=address,memory` | ❌ **`error: invalid argument '-fsanitize=address' not allowed with '-fsanitize=memory'`** |

The rule, and the reason: **ASan, TSan and MSan each claim the address space for their own shadow
mapping and each replace the allocator. They are mutually exclusive — pick one per build.** UBSan
is compatible with all three because it inserts only local inline checks and carries no shadow
memory. HWASan (`-fsanitize=hwaddress`, AArch64 top-byte-ignore tagging) is another ASan-class tool
and likewise exclusive with the others; it has far lower memory overhead than ASan and is what
Android ships.

The practical CI recipe that falls out of this:

```
build A:  -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer
build B:  -O1 -g -fsanitize=thread,undefined  -fno-sanitize-recover=all
build C:  -O1 -g -fsanitize=memory,undefined  -fsanitize-memory-track-origins=2   (if you can)
```

`-O1` rather than `-O0` because sanitizers at `-O0` are slow enough to change test behaviour, and
`-O1` keeps stack traces sane. `-fno-omit-frame-pointer` because otherwise the reports have holes.

## 3.9 THE SANITIZER COMPARISON TABLE

| | **ASan** | **UBSan** | **TSan** | **MSan** | **LSan** | **Valgrind Memcheck** | **cuda memcheck** | **cuda racecheck** | **cuda initcheck** | **cuda synccheck** |
|---|---|---|---|---|---|---|---|---|---|---|
| **Flag** | `-fsanitize=address` | `-fsanitize=undefined` | `-fsanitize=thread` | `-fsanitize=memory` | `-fsanitize=leak` (or in ASan) | none (run under `valgrind`) | `--tool memcheck` | `--tool racecheck` | `--tool initcheck` | `--tool synccheck` |
| **Mechanism** | Shadow memory 1:8, redzones, own allocator | Inline checks at specific constructs | Vector clocks + per-word shadow cells | Bit-for-bit shadow of *every value* | Conservative mark-sweep at exit | Dynamic binary translation, A-bits + V-bits | Device binary/compile-time instrumentation | Shared-memory access tracking | Device shadow for initialisedness | Barrier-participation tracking |
| **Recompile?** | Yes | Yes | Yes | Yes (**incl. libc/libc++**) | Only to interpose (or `LD_PRELOAD`) | **No** | No (runtime) / opt. compile-time | No | No | No |
| **Catches** | Heap/stack/global OOB, UAF, UA-return, UA-scope, double/invalid free, container-overflow, init-order | Signed overflow, shift UB, null deref, misaligned, bad enum/bool, div-by-zero, bad function-ptr cast, OOB (static bounds), `unreachable` | Data races (missing happens-before), lock-order deadlocks (opt-in) | Uninitialised value used in a branch/address/syscall, **with origin** | Unreachable heap blocks at exit | Heap OOB, UAF, uninit reads (bit-precise), bad free, overlapping memcpy, leaks | Device OOB (global/local/shared), misaligned, device-heap errors, API errors, leaks | Shared-memory WAW/WAR/RAW, deadlocks, async-copy sync violations | Uninitialised global/shared device memory reads | Divergent/invalid `__syncthreads`, `__syncwarp`, CG barriers |
| **Misses** | Uninit reads, races, arithmetic UB, intra-object overflow (default), uninstrumented libs, huge-stride OOB past redzone | Everything not on its list: aliasing, lifetime, races; and UB the optimiser already exploited | Untaken paths, uninstrumented libs (both FN **and FP**), hand-rolled sync | Anything an uninstrumented function wrote (→ **false positives**) | Reachable-but-dead memory; anything a fake pointer keeps alive | **Stack and global** OOB, races, use-after-return | Uninit reads, shared-mem races | All memory errors; **global/local** memory | Memory-access errors | Memory-access errors |
| **Slowdown** | **~2×** | few % – ~20% | **5–15×** | **~3×** (+1.5–2× with origins) | ~0 standalone | **10–50×** | not documented | not documented | not documented | not documented |
| **Memory** | ~3× stack, large virtual reservation | none | **5–10×** | ~2–3× (more with origins) | negligible | ~25% (compressed shadow) | — | — | — | — |
| **Combines with** | UBSan, LSan | **everything** | UBSan | UBSan | ASan | — (own process model) | — | — | — | — |
| **Conflicts with** | **TSan, MSan, HWASan** | — | **ASan, MSan** | **ASan, TSan** | — | — | all other cuda tools | all other cuda tools | all other cuda tools | all other cuda tools |
| **Production-viable?** | Rarely (2× + memory) | **Yes** — `-fsanitize-trap` or `-fsanitize-minimal-runtime` | No | No | Yes (standalone, cheap) | No | No | No | No | No |
| **Verified on CE?** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ not available | ❌ no GPU | ❌ | ❌ | ❌ |

---

# 4. Profiling

## 4.1 Sampling vs instrumenting, and the bias each introduces

There are exactly two ways to find out where time goes, and they lie in opposite directions.

**Instrumenting** — insert code at every function entry/exit (`-pg` / gprof, `-finstrument-functions`,
Callgrind, most language-level profilers). You get **exact call counts** and a complete call graph.

Its biases:
- **Overhead is proportional to call frequency, not to time spent.** A tiny function called 10⁹
  times gets 10⁹ instrumentation hits; its measured cost is dominated by the measurement. Small
  hot functions are systematically *over*-reported.
- Instrumentation **inhibits inlining** — the profiled binary is not the shipped binary. The
  function you measured may not exist at `-O2`.
- gprof specifically: its call-graph attribution assumes every call to `f` costs the same, which is
  false for anything data-dependent, and it does not handle recursion or shared libraries well.

**Sampling** — interrupt the program N times a second and record the stack (`perf record`, VTune,
most modern profilers). You get a **statistical estimate** of where time goes, and the overhead is
proportional to the sample rate, not the program's structure.

Its biases:
- **You only see what you sample.** At 999 Hz, an event that takes 100 µs and happens once will
  almost certainly be missed entirely. Sampling finds *hot*, never *rare-and-expensive*.
- **Skid.** The interrupt fires some cycles after the event that triggered it; the recorded RIP is
  not the guilty instruction. On Intel this is fixed by **PEBS** (Precise Event Based Sampling) and
  in `perf` by the `:p`/`:pp`/`:ppp` precision suffixes (`cycles:pp`). Without precision, attribution
  at instruction granularity is fiction.
- **Correlated sampling.** Sample at exactly 1000 Hz and you will alias against anything else
  running at 1000 Hz (a timer, a tick, a frame). This is why `perf` defaults to **999 Hz** — a prime
  offset from every round number in the system.
- Sampling with a fixed *event count* (`-c`) rather than frequency biases toward whatever generates
  the event.
- **Off-CPU time is invisible** to a CPU-cycles profiler. If your program is slow because it is
  blocked on a mutex or a disk, a CPU flame graph shows an idle machine and tells you nothing. This
  is the single most common way a profile misleads a beginner. The fix is off-CPU profiling
  (§4.5) — sample the *scheduler* switching threads out, not the CPU.

The one-line teaching version: **instrumenting answers "how many times", sampling answers "how
often on CPU", and neither answers "why is my wall clock slow" unless you also measure off-CPU.**

## 4.2 `perf`: the PMU and the events

The **PMU** (Performance Monitoring Unit) is a small block of hardware in every modern core: a
handful of programmable counters (typically 4–8 general-purpose per core, plus fixed counters for
cycles/instructions/ref-cycles) that increment on architectural events, and can raise an interrupt
on overflow. Everything `perf` does with hardware is: program a counter, set an overflow threshold,
handle the interrupt, record RIP + stack.

**The counter budget is the constraint students trip over.** Ask for more events than there are
counters and the kernel **multiplexes** them — time-slicing the counters and scaling the results up.
`perf stat` reports this as a percentage in brackets (`[75.00%]`). Scaled numbers are estimates; on a
non-uniform workload they can be badly wrong. This is the same fact that limits `toplev -l4` (§4.6).

**Event taxonomy:**

- **Hardware events** — from the PMU: `cycles`, `instructions`, `branch-instructions`,
  `branch-misses`, `cache-references`, `cache-misses`, `stalled-cycles-frontend`,
  `stalled-cycles-backend`.
- **Hardware cache events** — `L1-dcache-loads`, `L1-dcache-load-misses`, `LLC-loads`,
  `LLC-load-misses`, `dTLB-load-misses`, `iTLB-load-misses`.
- **Raw events** — `-e r04c4` etc., the vendor-specific encodings from the SDM. Where the real
  microarchitectural detail lives.
- **Software events** — from the kernel, no PMU needed: `task-clock`, `cpu-clock`, `page-faults`,
  `context-switches`, `cpu-migrations`, `minor-faults`, `major-faults`. **These work in
  virtualised/restricted environments where hardware events do not** — a practical fallback.
- **Tracepoints** — static kernel instrumentation: `sched:sched_switch`, `block:block_rq_issue`,
  `syscalls:sys_enter_*`, thousands of them (`perf list tracepoint`).
- **`perf_event_paranoid`** gates all of this: `-1` everything, `0` no tracepoints for unprivileged,
  `1` no kernel profiling, `2` (common default) no kernel *or* CPU-wide, `3`+ nothing. **CE has 4 —
  verified — hence nothing at all.**

**The four commands:**

```
perf stat ./prog                       # counters for the whole run. START HERE, ALWAYS.
perf stat -e cycles,instructions,branch-misses,cache-misses ./prog
perf stat -r 20 ./prog                 # 20 runs, reports mean +- stddev  <- underrated
perf record -F 999 -g ./prog           # sample at 999 Hz with call graphs
perf report                            # interactive tree
perf report --stdio --sort=dso,symbol
perf annotate -s hot_function          # per-instruction attribution over the disassembly
perf script                            # raw samples, for piping into flamegraph tooling
perf top                               # live, system-wide
perf diff perf.data.old perf.data      # A/B two profiles  <- the profiling analogue of a diff
```

`perf stat` first is not a style preference. It is a **hypothesis-forming** step: IPC below ~1.0 on a
wide core means stalls, not work; a branch-miss rate above ~2–3% means control flow, not data; a
high `cache-misses`/`instructions` ratio means memory. You then `perf record` to find *where*. Going
straight to `record` skips the question "what kind of slow is this?"

`perf annotate` is where the compiler-diagnostics unit and this one meet: it overlays sample counts
on the disassembly, so the student reads exactly the assembly the compiler-explorer unit taught them
to read, now with a cost attached to each line. **This is the single best bridge between the two
halves of the curriculum.** (Caveat: skid means the hot line is often one or two instructions after
the guilty one, unless the event is precise.)

## 4.3 Call-graph collection: the three methods, and why one of them broke

A sample without a stack tells you *what* is running. A sample with a stack tells you *why*. There
are three ways to get the stack, and the choice has large consequences.

### `--call-graph fp` (default for user space)

Walk the `RBP` chain: `RBP` points to the saved caller `RBP`, and the return address is at `RBP+8`.
Cost: a few loads per sample. Can be done **in the kernel, at interrupt time**, so the sample is a
compact list of addresses.

**Requires that every frame in the stack has a frame pointer.** Miss one and the walk either stops
or, worse, follows garbage.

### `--call-graph dwarf`

Copy a chunk of the user stack (default **8192 bytes**, tunable: `--call-graph dwarf,4096`) into the
perf ring buffer at every sample, along with the registers, and unwind it **later in userspace**
using `.eh_frame` CFI (§2.7).

- Works on binaries built with `-fomit-frame-pointer`, and needs no rebuild since `.eh_frame` ships.
- **Enormously more data** — kilobytes per sample instead of tens of bytes. Trace files balloon;
  the ring buffer overflows and drops samples at high frequencies.
- Truncates: a stack deeper than the dump size is silently cut off.
- Unwinding is slow (it is an interpreter, §2.7), so `perf report` takes a long time.

### `--call-graph lbr`

Use the **Last Branch Record** — a hardware ring buffer of the most recent taken branches.
Zero software cost, needs no compiler flags at all, requires Haswell or later Intel.

- **Depth is 16–32 entries** (32 on Skylake+). Real application stacks are deeper. You get the top
  of the stack, not the whole thing.
- User-space call chains only, without extra configuration.
- Also the basis for `perf record -b` branch profiling and for AutoFDO.

### The crucial point: `-fomit-frame-pointer` breaks stack sampling

`RBP` is a general-purpose register. In 2004 GCC made `-fomit-frame-pointer` the default at `-O`
levels on x86 to free it up — a defensible call on **i386**, which had four usable GPRs. It was then
inherited by **x86-64, which has 16**, where the win is far smaller.

The consequence took twenty years to be understood as a systemic problem: because distributions
built *everything* — glibc, libstdc++, OpenSSL, Python, the JVM's native parts — without frame
pointers, **a profile of any real application is full of `[unknown]` frames**, and the flame graph is
a forest of disconnected stumps. You can see that 30% of time is in `libc`, and nothing about which
of *your* call paths got there. Off-CPU analysis and eBPF-based tracing, which must walk stacks in
kernel context where DWARF unwinding is not practical, are hit hardest.

The measured cost of putting frame pointers back (Fedora's change proposal, primary source):

| Benchmark | Cost of `-fno-omit-frame-pointer` |
|---|---|
| Kernel compilation | 2.4% slower |
| Blender rendering | 2% slower |
| Python benchmarks | 1–10% depending on test |
| OpenSSL, Botan, Zstd, Redis | minimal / insignificant |

Brendan Gregg's production data: **typically under 1%, often unmeasurable**, with outliers to ~10%
on microbenchmarks. Meta builds everything with frame pointers and reports no significant impact.
Gregg's additional point is worth teaching for its own sake: microbenchmark regressions attributed to
frame pointers are frequently **cache-line and alignment effects** — adding *any* two instructions
would produce a similar shift (see §5.3).

**The distro shift back:**

| Distro | Release |
|---|---|
| **Fedora** | **38** (2023), via `-fno-omit-frame-pointer -mno-omit-leaf-frame-pointer` in the default flags, evaluated through F40 |
| **Ubuntu** | **24.04 LTS** |
| **Arch Linux** | enabled |

The framing for students: **this is an observability-vs-performance trade made at the distribution
level, and the industry changed its mind.** A ~1% CPU cost bought back the ability to profile
production, and profiling production routinely finds 10%+ wins. That is a *methodology* lesson
dressed up as a compiler flag.

**The alternatives, and why none has replaced frame pointers yet:**

| Method | Why it is not the answer (yet) |
|---|---|
| DWARF `.eh_frame` | Built for debuggers, not for interrupt context; expensive; huge traces |
| LBR | 16–32 frames; Intel-only; recent CPUs only |
| **ORC** | The kernel's own lightweight unwind format — fast, simple, works. Historically **kernel-only** |
| **SFrame** | An ORC-like lightweight format for userspace. The likely long-term answer; Gregg speculates ~2029 for real adoption |
| Shadow stacks (CET) | A security feature that happens to hold return addresses; theoretically usable |
| Per-runtime eBPF walkers | Work for JITs (Java, Python) where no native format applies; expensive |

## 4.4 Flame graphs

A flame graph aggregates thousands of stack samples into one picture.

**How to read it:**
- **y-axis = stack depth.** Bottom is the root (usually `main` or `_start`); each box sits on its
  caller.
- **x-axis = the sampled population, sorted alphabetically.** **It is NOT time.** This is the single
  most common misreading. Alphabetical sorting exists so identical adjacent frames merge into wide
  boxes; it deliberately destroys temporal order to reveal aggregate structure.
- **Width = how often that stack appeared in the samples**, i.e. proportion of total.
- **The top edge is what was on CPU.** Everything below it is ancestry. A wide box with nothing on
  top of it *is* the hot code. A wide box with many narrow children is a hot *path* whose cost is
  spread out.
- Colours are usually meaningless (random, for visual separation), *except* in differential graphs.

**A flame *chart* is a different thing**: x-axis IS time, no merging. Good for one thread's timeline
(browser devtools, Chrome tracing), bad for aggregate analysis, terrible for many threads.

**Varieties:**
- **CPU flame graph** — `perf record -F 999 -a -g` → `perf script` → `stackcollapse-perf.pl` →
  `flamegraph.pl`. (Modern perf: `perf script report flamegraph`.)
- **Off-CPU flame graph** — sample `sched:sched_switch` with stacks, weight by blocked time. Answers
  "why is wall time so much larger than CPU time?" Pair with the CPU one; together they account for
  100% of wall clock.
- **Memory flame graph** — weight by bytes allocated rather than samples (conventionally green).
- **Differential (red/blue) flame graph** — the important one. Two profiles, before and after; boxes
  are coloured **red where the second profile spent more** and **blue where it spent less**. This is
  `diff` for performance, and it turns "the release got 8% slower" from a research project into a
  glance. `difffolded.pl` + `flamegraph.pl --negate`.

**Pitfalls to teach:** broken stacks from missing frame pointers show as a flat forest (§4.3);
inlined functions vanish unless the tooling reads `DW_TAG_inlined_subroutine`; recursion produces
towering spikes that are usually not interesting; and a flame graph of a *multi-threaded* program
merges all threads unless you split by TID, which can hide that one thread is the bottleneck.

## 4.5 `ftrace`, kprobes/uprobes, and eBPF/bpftrace

Below the profiler is the kernel's tracing infrastructure — the answer when "where is the time" is
not enough and you need "what actually happened, in order."

**`ftrace`** — the in-kernel function tracer, driven entirely through `/sys/kernel/debug/tracing/`
(or via `trace-cmd` / `perf ftrace`). Every kernel function has a mcount/fentry hook that ftrace can
enable. `function` tracer logs every kernel function entry; `function_graph` gives a call tree with
durations; there are also latency tracers (`irqsoff`, `preemptoff`, `wakeup_rt`). Zero cost when
disabled, meaningful cost when on. This is how you answer "what is the kernel doing during my
syscall".

**kprobes / kretprobes** — dynamic instrumentation of *any* kernel instruction address. A kprobe
patches a breakpoint (or, optimised, a jump) at the target; the handler runs; execution resumes. A
kretprobe additionally hijacks the return address to fire on exit. This is `0xCC` patching (§2.2)
applied to the running kernel — the same idea, the same trade-offs, and worth making that connection
explicit for students.

**uprobes / uretprobes** — the same for userspace. Attach to any address in any binary or library by
file+offset. This is how you trace a function inside a running production process without restarting
it, and without it having been built for tracing.

**USDT** — statically-defined tracepoints compiled into userspace programs (`SDT_PROBE`, the
`dtrace -h` heritage). Zero cost when unattached (a `nop` plus an ELF note). Python, Node, the JVM,
PostgreSQL and MySQL all ship them.

**eBPF** — the modern unifying layer. A restricted, verified bytecode VM in the kernel. You attach a
small program to a kprobe/uprobe/tracepoint/perf-event; it runs in kernel context on every hit; it
aggregates into **maps** (hash tables, histograms) that userspace reads. The crucial architectural
advantage: **aggregation happens in the kernel**, so you are not shipping millions of events to
userspace to be counted. That is what makes it viable in production.

**bpftrace** is the awk of eBPF. Probe types: `kprobe`/`kretprobe`, `uprobe`/`uretprobe`,
`tracepoint`, `usdt`, `profile` (timed sampling), `interval`, `software`, `hardware` (PMU), and
`watchpoint` (memory). Builtins include `pid`, `comm`, `nsecs`, `arg0..argN`, `retval`, `kstack`,
`ustack`, `curtask`; map functions include `count()`, `hist()`, `lhist()`, `sum()`, `avg()`, `min()`,
`max()`, `stats()`. *(Probe-type list from general knowledge; the man page defers to separate stdlib
docs I did not fetch — flagged.)*

Three one-liners that show what it is for:

```
# syscall latency distribution, as a log2 histogram, for one process
bpftrace -e 'tracepoint:raw_syscalls:sys_enter /pid==1234/ { @t[tid]=nsecs; }
             tracepoint:raw_syscalls:sys_exit  /@t[tid]/ { @us=hist((nsecs-@t[tid])/1000); delete(@t[tid]); }'

# who is calling malloc, by user stack, aggregated in-kernel
bpftrace -e 'uprobe:/lib/x86_64-linux-gnu/libc.so.6:malloc { @[ustack] = count(); }'

# off-CPU time by stack -- the data behind an off-CPU flame graph
bpftrace -e 'kprobe:finish_task_switch { @[kstack] = count(); }'
```

The distinction from `perf` worth teaching: `perf` samples and asks *"where was I?"*; eBPF hooks
events and asks *"what happened, and how long did it take?"* Latency distributions are eBPF's home
turf and sampling's blind spot.

## 4.6 Top-Down Microarchitecture Analysis — the CPU's Speed of Light

**This is the section to teach as the direct analogue of Nsight Compute's Speed of Light**, which the
CUDA unit already covers. Make the parallel explicit and early; it is the same idea applied to a
different machine, and a student who has internalised one gets the other for free.

*(Intel's own VTune cookbook page returned 403; this description is from Andi Kleen's `pmu-tools` /
`toplev` documentation, which implements the method, plus the widely-published methodology.)*

**The model: pipeline slots.** A modern superscalar core can issue a fixed number of µops per cycle
— call it 4 (Skylake) or 6 (Golden Cove). Over N cycles the machine had `N × width` **issue slots**.
Every one of those slots ended up in exactly one of four states. That partition **sums to 100%**,
which is what makes it a *top-down* method rather than a pile of counters:

```
                        all pipeline slots
                                |
        +---------------+-------+-------+---------------+
        |               |               |               |
  Frontend Bound   Bad Speculation   Retiring     Backend Bound
  (no uop was      (a uop issued     (a uop       (a uop was ready
   delivered)       but was later     issued and   but no resource
                    cancelled)        retired)     accepted it)
```

- **Retiring** — useful work. Counter-intuitively, high Retiring is not automatically good: if you
  are retiring 60% of slots executing an algorithm that does 10× too much work, the microarchitecture
  is not your problem, the algorithm is. Top-down answers "is the CPU being used well", not "is the
  program correct."
- **Frontend Bound** — the machine wanted to issue but had no µops. Level 2 splits it into
  **Frontend Latency** (i-cache miss, iTLB miss, branch resteers) vs **Frontend Bandwidth**
  (decoder throughput, µop-cache misses, MITE/DSB switching). Big code, cold code, huge switch
  statements, over-inlining.
- **Bad Speculation** — slots were issued and then thrown away. Level 2: **Branch Mispredicts** vs
  **Machine Clears** (memory ordering violations, self-modifying code, FP assists). Unpredictable
  data-dependent branches. The fix is usually branchless code or better data layout.
- **Backend Bound** — µops were available but could not be accepted. Level 2: **Memory Bound**
  (further split L1/L2/L3/DRAM/Store Bound) vs **Core Bound** (execution-port contention, divider,
  long dependency chains). This is where most real programs live.

**Deeper levels** subdivide further, to level 4–6 in toplev. **The cost is counter multiplexing**:
the deeper you go the more events you need, and once you exceed the PMU's counter budget the kernel
time-slices them. `toplev`'s manual is explicit that accuracy degrades in proportion to how
non-repetitive the workload is, and that **level 1 without extra metrics typically avoids
multiplexing entirely**. So: start at `-l1`, descend only into the bucket that is actually large.

**Thresholds.** Both Intel's method and toplev suppress nodes below a threshold, because a bucket at
5% is not your problem. The rule of thumb usually given is ~15–20% for a level-1 bucket to be worth
descending into; toplev applies per-node thresholds automatically and hides the rest unless you pass
verbose mode.

**Usage:**
```
toplev -l1 ./prog                 # the four buckets. start here, always.
toplev -l2 --no-multiplex ./prog  # descend, refusing to multiplex
toplev -l3 -I 1000 -a ./prog      # time series, system-wide
toplev --all --xlsx out.xlsx ./prog
perf stat --topdown ./prog        # kernel's built-in top-down on supporting CPUs
```

**The explicit parallel to draw:**

| | **Nsight Compute (GPU)** | **Top-Down / toplev (CPU)** |
|---|---|---|
| The headline view | **Speed of Light**: % of peak compute and % of peak memory | **Level 1**: Retiring / Frontend / Backend / Bad Speculation |
| The question it answers | Which roof am I under? | Which pipeline resource is losing my slots? |
| "Neither number is high" | → latency-bound; read the warp-stall histogram | → the slots are split across buckets; descend into the largest |
| The drill-down | Memory Workload Analysis, Scheduler Statistics, Warp State | Level 2/3/4: Memory Bound → L3 Bound → …|
| The trap | 100% occupancy is not the goal | 100% Retiring is not the goal |
| The measurement hazard | replay passes, cache control, clock locking | counter multiplexing, `perf_event_paranoid` |

Both are the same intellectual move: **partition a fixed resource into mutually exclusive buckets
that sum to 100%, then descend only into the big one.** That is a transferable methodology, not a
tool. Teach it as such; the specific counters will change with every microarchitecture, the method
will not.

**Intel VTune** packages this with a GUI, plus Memory Access analysis, Threading analysis (lock
contention, imbalance), HPC Characterization, and roofline. **AMD's equivalent is uProf**; ARM's is
Streamline / `topdown-tool`. `perf stat --topdown` gives the level-1 breakdown natively on CPUs that
expose the required events.
