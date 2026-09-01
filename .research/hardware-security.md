# Hardware and Systems Security — Curriculum Research

Audience: a strong SWE who can read and write x86-64 assembly (`x86-64-assembly.md`), understands the pipeline, caches, and memory ordering (`cpu-architectures.md`), and knows the C/Linux systems layer (`cpp-linux-systems.md`). This unit is where all of that pays off, because **the attacks in this document are the strongest possible proof that microarchitecture is physically real and observable from software.** A cache is not an abstraction you can ignore; a misprediction is not free; a DRAM cell is an analog capacitor pretending to be a bit. Security is where the leaks in the abstraction become measurable.

Target end state: **can explain why architectural correctness is not the same as microarchitectural secrecy; can read a mitigation list backwards as a history of the field; can build a Flush+Reload covert channel in one process and see the cache in a timing histogram; and knows, with real numbers, why memory-safe languages exist.**

Research date: **September 2026.** Everything time-sensitive is dated inline. Framing throughout is **defensive and pedagogical** — every construction here is a single-process, self-contained demonstration of a mechanism, the kind used in university systems-security courses. There is no weaponised code, no external target, no exfiltration primitive.

Backend for exercises: **Compiler Explorer** (<https://godbolt.org>) — compiles *and executes* x86-64, and shows the emitted assembly so mitigations can be seen appearing and disappearing under compiler flags. Every exercise is designed to run there or in any local GCC/Clang.

### How to read this document

- **§1** is the one idea the whole unit turns on: architectural state vs microarchitectural state, and the cache as a side channel. Read it first; everything else is an instance of it.
- **§2** is speculative execution — Meltdown, Spectre v1/v2, the follow-ons, and mitigations with honest costs. The centrepiece.
- **§3** is memory-safety exploitation as a way to *learn the stack*: every mitigation is a fossil of an attack.
- **§4** is the physical layer: Rowhammer, cache-timing crypto attacks, power/cold-boot/fault.
- **§5** is defensive infrastructure: memory-safe languages with the real CVE numbers, sanitizers, secure/measured boot, TEEs and their breaks, GPU security.
- **§6** is the curriculum: four units in dependency order, each with its one idea, and the machine-checkable exercises.

### Conventions and caveats

- **Where a claim rests on measurement rather than a datasheet, it says so.** Microarchitectural internals are almost never published; the security literature is built from reverse-engineering.
- **Every leak rate, every performance-cost percentage, is specific to the part and kernel measured.** Treat them as order-of-magnitude, not spec values.
- Claims that could not be verified against a primary or reputable secondary source during this research are marked **[unverified]**. A dedicated verification ledger is in Appendix A.

---

## 1. The one idea: architectural state is rolled back, microarchitectural state is not

Everything in §2 is a corollary of a single sentence, so it is worth stating precisely before any attack.

A modern CPU maintains two kinds of state:

- **Architectural state** is what the instruction-set manual promises exists: the values of the general-purpose registers, the flags, the program counter, the bytes in memory. This is the contract. If a program reads it, the manual tells you exactly what it gets. When an instruction faults, or a branch was mispredicted, the architectural state is **rolled back** as if the offending instructions never ran. This is what "precise exceptions" means, and CPUs have done it since the 1960s.

- **Microarchitectural state** is everything the implementation keeps to go fast: the contents of the caches, the branch-predictor tables, the TLB, the line-fill buffers, the state of the prefetchers. **None of this is in the manual, and none of it is rolled back.** It cannot be — the whole point of a cache is that it survives across instructions.

The gap between these two is the entire attack surface. Speculative and out-of-order execution run instructions that the architecture will later discard — but while they run, they touch the cache. The architecture forgets them; the cache remembers. **A value that was never architecturally read can leave a microarchitectural footprint, and that footprint is measurable from software as timing.**

This is the sentence to make a class memorise:

> The processor rolls back *what you computed*. It does not roll back *what you touched*.

### 1.1 The cache as a side channel

A cache turns *whether data is present* into *how long a load takes*. An L1 hit is a few cycles; a miss to DRAM is ~70–90 ns (see `cpu-architectures.md` §2 — that is 200–400 core cycles depending on clock). That difference is enormous and trivially measurable with `rdtsc` (or `rdtscp`, which serialises). So if an attacker can arrange for a *secret-dependent* address to be brought into the cache, they can later ask "was this address cached?" by timing a load, and thereby learn the secret one address at a time.

This measurement primitive has several forms; the one that underlies almost all of the speculative attacks is **Flush+Reload**.

### 1.2 Flush+Reload, precisely

Flush+Reload (Yarom & Falkner, USENIX Security 2014, *"Flush+Reload: a High Resolution, Low Noise, L3 Cache Side-Channel Attack"*) works on any memory that the attacker and victim **share read-only** — in practice a shared library page, or, in the single-process teaching version, an array the attacker owns. It has three steps:

1. **Flush.** For each address of interest, execute `clflush` (x86 unprivileged instruction) to evict that cache line from *all* levels of the cache hierarchy. After this the line is guaranteed to be in DRAM only.
2. **Wait.** Let the victim run. If the victim accesses one of the flushed lines — even *speculatively* — it gets pulled back into the cache.
3. **Reload.** Time a load of each address with `rdtsc`. A **fast** load (say < ~100 cycles) means the line was cached: the victim touched it. A **slow** load (say > ~200 cycles) means it was not.

The output is bimodal — two clean humps in a timing histogram, one for hits and one for misses — and that bimodality *is* the leaked bit. The threshold between the humps is the decision boundary. **Building this histogram between two functions in one process is the single best lab in the whole unit** (§6, Exercise 1), because it makes an invisible piece of microarchitecture directly visible as a picture.

The reason Flush+Reload is the primitive of choice for Spectre/Meltdown is step 2: the "victim access" can be a *transient* instruction that the architecture is about to throw away. The value is gone from the registers before it can be read — but the *address computed from it* was used to index a load, and that load left a line in the cache. Flush+Reload reads the line's presence back out. This is the **encode-into-cache, decode-by-timing** pattern, and it recurs in every attack below.

Related primitives, in one line each:

- **Prime+Probe** — the attacker fills a cache set with its own lines, lets the victim run, then times its own lines to see which were evicted. Needs no shared memory (works across VMs), but is noisier and lower-resolution than Flush+Reload.
- **Evict+Reload** — Flush+Reload without `clflush`, for architectures (e.g. ARM without a userspace flush) where you must evict by contention instead. This is what makes the JavaScript variants possible (§4.1).
- **Flush+Flush** — times `clflush` itself (which is faster on an uncached line), stealthier because it issues no loads.

---

## 2. Speculative execution attacks — the centrepiece

### 2.0 The mechanism from the architecture up

Recall from `cpu-architectures.md` §2 how a modern core actually runs code:

- It is **out-of-order**: it fetches and decodes instructions in program order, but issues them to execution units as soon as their operands are ready, not in program order. A **reorder buffer (ROB)** — hundreds of entries on current cores — holds instructions after they execute but before they **retire** (commit their results architecturally). Retirement happens *in order*, which is what preserves precise exceptions.
- It is **speculative**: rather than stall at a conditional branch waiting to know the direction, the **branch predictor** guesses, and the core runs down the predicted path immediately. If the guess was right (it usually is — predictors run 95–99% accurate), the work is already done. If wrong, the mispredicted instructions are **squashed**: flushed from the ROB, their register writes discarded, the pipeline restarted on the correct path.

The window between "a speculative instruction executes" and "it is squashed or its fault is delivered at retirement" is the **transient window**. Its width is set by how long the core can keep going before it must resolve the branch or the fault — bounded by the ROB size and by how long the triggering event (a mispredicted branch, a faulting load waiting on a slow permission check) takes to resolve. On current cores that is enough time to execute a dependent chain of a few instructions: **a load of a secret, and a second load whose address depends on the secret.** That is all an attack needs.

The insight from §1 now bites: the squash rolls back the ROB, but the second load already reached the cache. **Transient instructions leave microarchitectural residue.**

### 2.1 Meltdown — the mechanism, in full

*Meltdown* (Lipp, Schwarz, Gruss, Prescher, Haas, Fogh, Horn, Mangard, Kocher, Genkin, Yarom, Hamburg — presented at USENIX Security 2018, CVE-2017-5754) is the simplest and most devastating of the family, and the one to teach the mechanism with, because it does not even need a gadget in the victim — the victim is the kernel's own mapping.

**The setup.** On x86-64 Linux before the fix, the *entire kernel* was mapped into every process's virtual address space, at high addresses, marked supervisor-only in the page tables. This was a deliberate performance choice: a system call could then run kernel code without switching page tables (a page-table switch flushes the TLB and is expensive). The user could not *read* those addresses — the page-table permission bit forbids it — but the mapping was there.

**The attack, step by step.** The attacker writes, in user mode, roughly this transient sequence:

```
char probe[256 * 4096];        // 256 pages, one per possible byte value
// ... flush all 256 probe lines (Flush) ...
char secret = *(char*)kernel_address;   // (1) faulting load of a kernel byte
char dummy  = probe[secret * 4096];     // (2) secret-dependent probe access
// ... fault is delivered here; (1) and (2) are squashed ...
// Reload: time each of the 256 probe lines; the fast one's index == secret
```

Now the crucial question: **how does line (2) ever run, when line (1) is a permission fault?**

Because the permission check and the data fetch happen in *different parts of the pipeline at different times*. On the affected Intel cores, the load unit fetches the data from L1 and **forwards it to dependent instructions before the permission check has resolved**. The fault is not delivered until the load instruction reaches retirement — and retirement is in-order, so it can be many cycles behind. In that gap, instruction (2) executes speculatively using the forwarded secret byte, indexes into `probe`, and pulls one line — `probe[secret*4096]` — into the cache. Then instruction (1) retires, the `#PF` fault fires, and the architecture rolls back: `secret` and `dummy` are discarded, control jumps to the fault handler.

But the cache line is still there. The attacker catches the fault (a signal handler, or Intel TSX to suppress it entirely), then does the Flush+Reload decode: it times all 256 lines of `probe`, finds the one that is fast, and its index *is the secret byte*. Repeat, address by address, and you read the entire kernel — and, because the kernel direct-maps all of physical memory, effectively all of RAM, at reported rates around **the low hundreds of KB/s** with near-perfect accuracy.

**Why Intel and not AMD.** Meltdown depends on the core forwarding load data to dependent µops *before* the permission bit is checked. AMD's cores resolve the permission check earlier in the pipeline, so the dependent transient instruction never sees the secret data — the load simply does not forward a value it is not allowed to. This is not AMD being more careful by luck; it is a genuine microarchitectural difference in *when* the privilege check gates the load result. AMD stated its processors were not affected by Meltdown (Variant 3), and that has held up. (ARM's Cortex-A75 was affected; most other ARM cores were not.) This is the cleanest example in the whole field of an "architecturally identical, microarchitecturally different" outcome — the thesis of `cpu-architectures.md` made into a vulnerability.

**The fix: KPTI / KAISER, and its cost.** The mitigation is to stop mapping the kernel into user space. **KAISER** (Gruss et al., originally a defence against KASLR-breaking side channels, 2017) became **KPTI** (Kernel Page-Table Isolation) in Linux 4.15 (January 2018). Each process now has *two* page tables: a user table with the kernel almost entirely unmapped (only a tiny trampoline stub remains, unavoidably), and a kernel table with everything. Every system call and interrupt must now switch `CR3` on entry and exit — which flushes the TLB (partly mitigated by PCID/ASID tagging on newer CPUs). The cost is real and workload-dependent: **negligible for compute-bound code, but 5–30% for syscall-heavy workloads** (databases, I/O-bound servers), with pathological microbenchmarks worse. PCID support brings the common case down substantially. The teaching point: Meltdown's fix is *architectural surgery on the address space*, and you pay for it on every kernel crossing forever.

### 2.2 Spectre v1 — bounds check bypass (CVE-2017-5753)

*Spectre* (Kocher, Horn, Fogh, Genkin, Gruss, Haas, Hamburg, Lipp, Mangard, Prescher, Schwarz, Yarom — presented S&P 2019, but disclosed January 2018 alongside Meltdown) is subtler and worse, because it does not rely on a permission fault and it is not confined to one vendor. **It works within the victim's own permissions, using the victim's own code as the gadget.** It hit Intel, AMD, and ARM alike.

Variant 1 is *bounds check bypass*. The canonical gadget is ordinary, correct-looking code:

```c
if (x < array1_size)               // bounds check
    y = array2[array1[x] * 4096];  // in-bounds, uses array1[x] as an index
```

Architecturally this is safe: when `x >= array1_size` the body does not run. But consider what the branch predictor does. If the attacker first calls this function many times with *in-bounds* `x`, the predictor learns "this branch is taken" (the bounds check passes). Then the attacker calls it with a large, **out-of-bounds** `x`. The predictor, still trained, **speculates that the check passes** and runs the body before the true comparison resolves. In that transient window:

- `array1[x]` reads *out of bounds* — some secret byte from wherever `array1 + x` points.
- `array2[secret * 4096]` pulls a secret-dependent line into the cache.

Then the comparison resolves, the CPU realises the branch was mispredicted, squashes the body — but `array2`'s line is cached. Flush+Reload on `array2` recovers the secret. The victim read its *own* memory out of bounds, transiently, at the attacker's request.

**Why v1 is essentially unfixable in general.** Meltdown has a clean architectural fix (unmap the kernel). Spectre v1 does not, because the vulnerable pattern is *"a bounds check followed by a data-dependent memory access,"* which is one of the most common shapes in all of software. You cannot unmap the data — it is the program's own data, which it is allowed to read. The only sound fix is to **stop speculation at each dangerous branch**, which means:

- **`lfence` after the bounds check** (a speculation barrier: no later instruction executes until the `lfence` retires). This works but is a serialisation point — you pay it on every guarded access, and you have to *know which accesses are dangerous*.
- **Masking the index** into the array bounds (`x &= (array1_size - 1)` style, or Linux's `array_index_nospec()`), so even a mispredicted access stays in bounds. Cheaper than `lfence`, but again needs manual placement.

Both require **identifying every vulnerable gadget by hand or by imperfect static analysis** — and gadgets can be synthesised even by the JIT compilers in browsers. There is no blanket microcode or kernel fix, because there is nothing single to fix. This is why Spectre v1 is described as a class of bug we now *live with and mitigate case by case*, not one we closed. The lesson for a class: **some vulnerabilities are properties of an optimisation the whole industry depends on, and cannot be patched away without giving up the optimisation.**

### 2.3 Spectre v2 — branch target injection (CVE-2017-5715)

Variant 2 attacks *indirect* branches — `jmp *%rax`, virtual calls, function pointers — whose target the CPU predicts from the **Branch Target Buffer (BTB)**. The BTB is (or was) shared and not fully tagged by privilege level or address-space, so an attacker running in one context can **train it to mispredict a victim's indirect branch to an attacker-chosen address**. The attacker picks a "gadget" already present in the victim's code — a short instruction sequence that loads a secret and leaks it via a cache access, exactly the Flush+Reload encode — and steers the victim's indirect branch there speculatively. The victim then runs the attacker's chosen gadget, on the victim's data, in the transient window. This is cross-privilege (user→kernel) and, in the worst case, cross-VM (guest→host, guest→guest), which is what made it a cloud-provider emergency.

**Mitigations for v2** (this is where the alphabet soup lives):

- **Retpoline** ("return trampoline," Google, 2018) — a software construction that replaces every indirect jump/call with a `ret`-based sequence that traps speculation in an infinite loop (a `pause; lfence` spin) instead of letting the BTB steer it. Because the target is resolved via the return stack, the BTB's poisoned prediction is never used. Retpoline was the first-line fix because it needed only a compiler recompile, no new microcode. **Cost: single-digit percent on most workloads, worse on indirect-call-heavy code.** *Caveat:* retpoline turns indirect calls into returns, which turned out to reopen the door on later cores (Retbleed, §2.5) whose return predictors are themselves poisonable — a fix that became a vulnerability.
- **IBRS** (Indirect Branch Restricted Speculation) — a microcode/MSR control: when set, the CPU does not let predictions made in a less-privileged mode steer branches in a more-privileged mode. Original IBRS had to be toggled on every kernel entry and was *expensive*. **eIBRS** ("enhanced IBRS," on Skylake-successor cores) makes it a set-once mode with much lower cost, and is the default on modern Intel.
- **IBPB** (Indirect Branch Predictor Barrier) — a "flush the predictor now" MSR write, issued on context switches / VM exits so one process's training cannot survive into another's.
- **STIBP** (Single Thread Indirect Branch Predictor) — prevents the *sibling SMT hyperthread* from steering your branch predictions. On by default only in some configurations because it has an SMT-wide cost.

The honest accounting: these are layered, their combination is what you actually run, and the total cost is workload-dependent but real — this is why the phrase "the Spectre tax" entered the vocabulary, with early estimates of low-to-mid single-digit percent for typical workloads and considerably more for syscall- and context-switch-heavy ones.

### 2.4 The measurement primitive, restated

By now the shape is unmistakable and worth stating as the unifying frame for the class: **every one of these attacks is (a) a way to get a secret-dependent memory access to happen transiently, plus (b) Flush+Reload (or a sibling) to read the cache footprint back out.** Meltdown gets (a) from a faulting load's late permission check; Spectre v1 from a mistrained conditional branch; Spectre v2 from a poisoned indirect-branch target. The decode (b) is the same every time. Teach the decode once (Exercise 1), and every attack becomes "a new way to trigger the encode."

### 2.5 The follow-ons, in outline

The families after 2018, each in one or two lines — the point for a curriculum is the *taxonomy*, not exhaustive detail:

- **MDS / RIDL / ZombieLoad / Fallout** (2019, CVE-2018-12126/12127/12130). *Microarchitectural Data Sampling.* Instead of leaking from the cache, these leak from small in-CPU buffers — **line-fill buffers, store buffers, load ports** — that transiently forward stale data to dependent instructions regardless of address. You don't choose *what* leaks (it is whatever passed through the buffer recently), which makes them "sampling" attacks. Mitigation: the **`VERW` instruction** flushes these buffers on kernel/VM exit (microcode repurposed `VERW` to do the clear); `MDS_NO` on fixed silicon.
- **L1TF / Foreshadow** (2018, CVE-2018-3615/3620/3646). *L1 Terminal Fault.* A faulting/`not-present` page-table entry still lets the core speculatively read whatever physical L1 line the stale address bits point at — bypassing SGX enclaves, and, in the VM case, reading across guests. Mitigation: flush L1 on VM entry, and PTE-inversion so a not-present PTE points nowhere valid.
- **Retbleed** (2022, CVE-2022-29900/29901). Return instructions, on Intel Skylake-era and AMD Zen 1–2, are predicted through structures an attacker can poison — so **retpoline itself became exploitable** because retpoline turns indirect calls into returns. Fixes added return-path IBPB/`RSB`-stuffing. **Reported mitigation cost up to ~39% on affected Intel, ~14% on AMD** [per the disclosure].
- **Downfall / GDS** (2023, CVE-2022-40982). Intel Skylake→Rocket Lake. The `gather` instruction transiently leaks data from vector-register / SIMD buffers across boundaries, including across SMT and out of SGX. Microcode mitigation with a notable throughput cost on `gather`-heavy code.
- **Inception / SRSO** (2023, CVE-2023-20569). AMD Zen 1–4. *Speculative Return Stack Overflow* — an attacker overflows the return-address predictor to make a `ret` speculate into a chosen gadget. Microcode + software mitigations.
- **Zenbleed** (2023, CVE-2023-20593). AMD Zen 2. Not strictly transient-cache: a mispredicted vector instruction leaks register file contents directly. Microcode fix.

**Landed more recently (2024–2026), flagged for currency — verify against the vendor advisory before teaching numbers):**

- **Indirector** (July 2024) — high-precision BTB/IBP injection on Intel Alder/Raptor Lake. [secondary sources]
- **TikTag** (June 2024, CVE not central) — speculative oracle that breaks **ARM Memory Tagging Extension (MTE)** by leaking whether a tag check would pass. Undermines a *defence*, which is the interesting part.
- **GhostRace** (2024, CVE-2024-2193) — *speculative race conditions*: speculatively executing past a synchronisation primitive re-opens TOCTOU races. Intel/AMD/ARM; Linux initially declined some patches.
- **Training Solo** (May 2025, incl. CVE-2024-28956 "Indirect Target Selection", CVE-2025-24495) — self-training Spectre-v2 *within the same privilege domain*, defeating some eIBRS assumptions on Intel. [ETH Zürich/VUSec; verify scope]
- **Branch Privilege Injection** (2025, CVE-2024-45332) — a branch-predictor **race condition** on Intel 9th-gen-and-later leaks across the privilege boundary; microcode fix reported at **up to ~8%** cost. [ETH Zürich; secondary]
- **Transient Scheduler Attacks (TSA)** (July 2025, CVE-2024-36348/36349/36350/36357) — AMD Zen 3/4 scheduler timing forwards wrong speculative load data; microcode + Linux `tsa=` tunable. [AMD advisory]
- **VMScape** (Sept 2025, CVE-2025-40300) — Spectre-BTI where **guest branch-predictor training survives into the host** (QEMU/KVM) because BP isolation on VMEXIT was incomplete; AMD Zen 1–5, some Intel. Fix: IBPB on VMEXIT. [secondary; verify]
- **Battering RAM / WireTap** (2025–2026) — physical memory-interposer attacks on SGX/SEV-SNP; covered in §5.4 because they are TEE breaks, not pure transient-execution bugs.
- **RISC-V transient-execution findings** (2026) — Spectre-PHT/BTB/RSB/STL demonstrated on out-of-order RISC-V cores (SiFive P550, T-Head C910/C920); noted because RISC-V **lacks a standard speculation-barrier instruction**, so the x86/ARM mitigations don't port directly. [secondary; verify — treat as "the frontier is moving to RISC-V," not as settled numbers]

The meta-point for the curriculum: **this list has not stopped growing since 2018 and will not.** New microarchitectural structures (schedulers, prefetchers, tag caches, VM predictor state) keep turning out to be observable. That is the thesis restated: microarchitecture is real, and each new optimisation is a new potential channel.

### 2.6 Mitigations, honest accounting

| Mitigation | Defeats | Mechanism | Cost (order of magnitude, workload-dependent) |
|---|---|---|---|
| **KPTI/KAISER** | Meltdown | Unmap kernel from user page tables | ~5–30% on syscall-heavy; ~0 on compute; PCID helps |
| **Retpoline** | Spectre v2 | Replace indirect branch with `ret`-trap | low single-digit %; reopened by Retbleed |
| **eIBRS** | Spectre v2 | HW mode: no cross-privilege BP steering | low, set-once (vs original IBRS: high) |
| **IBPB** | Spectre v2 cross-context | Flush predictor on switch/VMEXIT | per-switch cost; matters on churny servers |
| **STIBP** | Spectre v2 cross-SMT | Isolate sibling-thread predictions | SMT-wide cost; often opt-in |
| **`VERW` clear** | MDS family | Flush fill/store/load buffers on exit | small per-exit |
| **L1 flush + PTE inversion** | L1TF/Foreshadow | Clear L1 on VM entry | per-VM-entry cost |
| **`lfence` / `array_index_nospec`** | Spectre v1 | Stop speculation / mask index at gadget | per-guarded-access; needs manual placement |
| **Microcode (GDS/SRSO/TSA/BPI…)** | the specific bug | vendor-specific internal fixes | ranges from ~0 to double-digit % on the affected instruction |

The blunt instrument behind all of it: **disable SMT (hyperthreading).** Many cross-thread variants simply vanish if two security domains never share a physical core. Some cloud providers and high-security deployments do exactly this and eat the throughput loss. That is the ultimate honest cost: *the safest configuration is measurably slower, and everyone is quietly trading secrecy for performance.*

---

## 3. Memory-safety exploitation as a way to understand the stack

The pedagogical inversion here is the whole point: we are not teaching exploitation to break things, we are teaching it because **overwriting a return address teaches calling conventions better than any diagram**, and because **the list of mitigations, read backwards, is a complete history of the field.** Each defence exists because of a specific attack; naming the attack explains the defence.

### 3.1 The stack, the saved return address, and the overflow

Recall the x86-64 calling convention (`x86-64-assembly.md`): `call` pushes the return address onto the stack and jumps; the callee pushes the saved frame pointer (`%rbp`), then allocates locals by subtracting from `%rsp`; `ret` pops the return address off the stack and jumps to it. The stack grows *down* (toward lower addresses), but arrays are written *up* (toward higher addresses). Those two directions pointing opposite ways is the original sin.

A local buffer `char buf[64]` lives *below* the saved frame pointer and return address in memory. Writing past the end of `buf` — because `gets()`, or `strcpy()`, or any unbounded copy wrote more than 64 bytes — walks *upward* over the saved `%rbp` and then over **the saved return address.** When the function executes `ret`, it pops whatever is now sitting in that slot and jumps there. Control the overflow, control the return address, control the program counter. The classic exposition is Aleph One, *"Smashing the Stack for Fun and Profit,"* Phrack 49 (1996) — still the clearest first read.

Why this teaches architecture: to exploit it you must know *exactly* where the return address sits relative to your buffer, which forces you to internalise frame layout, the direction of stack growth, the size of the saved registers, and endianness (you write the target address little-endian). A student who has overwritten a return address once never again has to look up how the stack frame is laid out. **Exercise 2 does exactly this and stops at the observation, not the exploitation** — overflow a local buffer under `-fno-stack-protector`, watch it crash with `%rip` set to your bytes, then recompile *with* the protector and watch the canary catch it (§6).

### 3.2 The arms race — every mitigation is a fossil of an attack

Read this list **from the bottom up** and it is a chronological history; read it top-down and it is a layered defence. Each row: *the mitigation, and the attack that made it necessary.*

1. **Stack canaries** (StackGuard, 1998; `-fstack-protector`). A random "canary" value is placed between the locals and the saved return address at function entry and checked before `ret`. A linear buffer overflow that reaches the return address *must* overwrite the canary on the way; the mismatch is detected and the program aborts. **Fossil of:** the plain stack smash (§3.1). **Defeated by:** overflows that don't cross the canary (indirect writes), and info-leaks that disclose the canary value.

2. **NX / DEP** (No-eXecute bit, `W^X`). Mark the stack and heap **non-executable**, so even if you place shellcode in your buffer and jump to it, the CPU faults on executing data. **Fossil of:** "jump straight to shellcode on the stack." **Defeated by:** ROP (next).

3. **ASLR / PIE** (Address Space Layout Randomisation; Position-Independent Executables). Randomise the base addresses of the stack, heap, libraries, and (with PIE) the executable itself at each run, so the attacker cannot know where anything is. **Fossil of:** attacks that hardcode addresses (of shellcode, of libc functions). **Defeated by:** information-disclosure bugs that leak a pointer (deriving the base), and, on 32-bit, brute force (too little entropy).

4. **RELRO** (RELocation Read-Only). Make the GOT (Global Offset Table) and other relocation targets read-only after the dynamic linker resolves them ("full RELRO"), so an attacker who gets an arbitrary write cannot redirect a library call by overwriting a GOT entry. **Fossil of:** GOT-overwrite / `.dtors` hijack techniques.

5. **ROP — Return-Oriented Programming** (Shacham, CCS 2007). *This is the attack, not a defence* — it is NX's answer's answer. Since you cannot execute your own code (NX), you instead chain together short instruction sequences (**"gadgets"**) that already exist in the program or libc, each ending in `ret`. By writing a *sequence of addresses* onto the stack, each `ret` jumps to the next gadget; stitched together they perform arbitrary computation (the standard goal being to call `mprotect` to make memory executable, or `execve`). ROP is Turing-complete on any reasonably large binary. **It exists because NX closed the direct path,** and it is why "just make the stack non-executable" was not the end of the story. (Variants: JOP with indirect jumps, ret2libc as the degenerate one-call case.)

6. **CFI, shadow stacks, CET** — the answer to ROP.
   - **CFI (Control-Flow Integrity)** (Abadi et al., 2005; deployed as Clang CFI, Windows CFG): at each indirect call/jump, check at runtime that the target is in the set of *legitimate* targets for that call site. Forward-edge protection — stops calling into the middle of a function or into a gadget.
   - **Shadow stack** — keep a second, protected copy of return addresses; on `ret`, compare the real stack's return address against the shadow copy and abort on mismatch. Backward-edge protection — directly kills ROP, because a ROP chain overwrites return addresses on the normal stack but cannot touch the shadow stack.
   - **Intel CET** (Control-flow Enforcement Technology, shipping since Tiger Lake / 11th-gen) implements both in hardware: a hardware **shadow stack** and **indirect branch tracking** (`ENDBR` landing pads — an indirect branch may only target an `ENDBR64` instruction). ARM's equivalents are **BTI** (Branch Target Identification) and **PAC** (Pointer Authentication, which signs return addresses with a key). **Fossil of:** ROP/JOP.

Reading it backwards, out loud, is the lecture: *shadow stacks exist because of ROP; ROP exists because of NX; NX exists because of stack-smashing shellcode; canaries exist because of the return-address overwrite; the return-address overwrite exists because the stack grows down while arrays are written up.* **Every mitigation is a fossil; the strata are the history of the field.**

### 3.3 Heap exploitation, in outline

The stack is the teaching example; real exploitation moved to the heap once stack defences matured. In outline (the mechanism, not a recipe):

- **Use-after-free (UAF).** A pointer is used after the object it points to is `free()`d. If the attacker can get the freed chunk reallocated with attacker-controlled contents (a "heap spray" / reclaim), the stale pointer now reads/writes attacker data — often including a vtable pointer, giving control flow. **UAF is now the single most common exploited memory-safety bug class** — roughly half of Chromium's memory-safety bugs (§5.1).
- **Double-free.** `free()` the same chunk twice; the allocator's free-list metadata becomes inconsistent, and a later allocation can be steered to return a chunk overlapping something sensitive.
- **glibc structures.** The exploit surface *is* the allocator's own bookkeeping: `malloc` chunks store size and free-list pointers **inline, adjacent to user data**, so a heap overflow corrupts allocator metadata. Classic techniques (fastbin dup, tcache poisoning, unlink) all manipulate these `fd`/`bk` pointers to get an arbitrary-write primitive. The lesson: **the allocator's metadata living next to your data is the heap's version of the stack's return-address-next-to-buffer problem.**

### 3.4 Two more bug classes that teach a concept

- **Format-string bugs.** `printf(user_input)` instead of `printf("%s", user_input)`. Because `printf` reads its format directives and pulls corresponding arguments off the stack/registers, attacker-supplied `%x` walks the stack (info leak — defeats ASLR and reveals the canary), and `%n` **writes** the number of bytes printed so far to a pointed-at address (arbitrary write). One missing `"%s",` turns a log statement into a read/write primitive. Teaches: *data is not format; varargs trusts the format string completely.*
- **Integer overflow → undersized allocation.** `malloc(count * size)` where `count * size` wraps around `SIZE_MAX` to a small value: you allocate a tiny buffer but the code believes it is huge, and the subsequent copy overflows the heap. Teaches: *arithmetic on sizes is a security boundary; `count * size` must be checked for wrap (`__builtin_mul_overflow`, or `calloc`, which does the check for you).* This is the bug behind a large fraction of real-world heap overflows because size calculations are everywhere and wrap is silent in C.

---

## 4. Other physical-layer attacks

§2 and §3 leak *information* through timing and control flow. This section is where software reaches down and changes *physics* — flipping bits it never wrote, reading keys out of power draw, recovering data from cold silicon.

### 4.1 Rowhammer — software that corrupts memory it cannot address

*Rowhammer* (Kim et al., ISCA 2014, *"Flipping Bits in Memory Without Accessing Them"*) is the most conceptually shocking result in the whole unit, and the best proof that DRAM is analog. A DRAM cell is a capacitor holding a charge that *is* the bit; cells are packed into rows; reading a row requires activating it, which disturbs the charge of physically adjacent rows a tiny amount. Normally a periodic **refresh** (every 64 ms) tops the charge back up before it leaks away. But if you **activate one row rapidly and repeatedly** — "hammering" — you can leak charge out of a *neighbouring* row faster than refresh restores it, and flip a bit in a row you never accessed and have no permission to touch.

- **Why shrinking made it possible.** As DRAM process nodes shrank, cells got physically closer and held less charge, so the electrical disturbance from an adjacent activation became proportionally larger. Rowhammer is a *direct consequence of the density scaling* that made DRAM cheap — the physics got worse exactly as capacity got better. Below roughly the 2xnm generation it became reliably triggerable.
- **From a curiosity to an exploit.** Seaborn & Dullien (Project Zero, 2015, *"Exploiting the DRAM rowhammer bug to gain kernel privileges"*) showed the flips are *targetable enough* to matter: flip a bit in a **page-table entry** and you can point a PTE at a physical page you shouldn't own, giving kernel privileges; flip a bit in cached SSH/sudo credentials, etc. Bits flip, and some of those bits are security-critical.
- **The mitigation arms race — and why each failed.**
  - **ECC** (error-correcting codes) corrects single-bit errors and detects double — but Rowhammer can produce *multiple* flips in a word, and *ECCploit* (2018) showed ECC can be bypassed. ECC raises the bar; it is not a fix.
  - **TRR (Target Row Refresh)** — the in-DRAM defence the industry deployed in DDR4: the chip tracks frequently-activated rows and sneaks in extra refreshes of their neighbours. **TRRespass** (Frigo et al., S&P 2020) defeated it with *many-sided* hammering (hammering many rows at once) that overflows TRR's limited tracking table. **Blacksmith** (Jattke et al., S&P 2022) defeated the improved versions with *non-uniform, frequency-tuned* patterns. Most recently **Phoenix** (Jattke et al., CVE-2025-6202, to appear IEEE S&P 2026) **broke TRR on DDR5** from SK Hynix — 15 DIMMs made 2021–2024 all flipped, with a **privilege-escalation exploit in as little as 109 seconds** and ~5 min average. *(This is a verified 2025/26 result — see Appendix A.)* The pattern is relentless: each in-DRAM mitigation was reverse-engineered and bypassed within a couple of years.
  - **Doubling the refresh rate (2x)** — helps, costs power and performance, and does not fully close it.
- **Rowhammer from JavaScript.** *Rowhammer.js* (Gruss, Maurice, Mangard, DIMVA 2016) is the result that makes this a *remote* threat: hammering needs only rapid, cache-missing accesses to specific DRAM rows, and you can arrange those from **JavaScript in a browser**, with no native code and no special instruction — you evict cache lines by access pattern (Evict+Reload style) instead of `clflush`, and use large/huge pages or timing to find rows in the same bank. A web page can, in principle, flip bits in physical memory. This is the moment Rowhammer stopped being a lab curiosity.

The teaching payload: **"read-only" and "no permission" are software abstractions on top of analog charge, and the analog layer does not respect them.**

### 4.2 Cache-timing attacks on crypto, and constant-time programming

The same cache side channel from §1 breaks cryptographic implementations directly, without any speculation. The classic target is **AES using T-tables** — a common fast software AES precomputes lookup tables and indexes them by `plaintext_byte XOR key_byte`. **Which table entries get cached depends on the key.** An attacker sharing the machine (Flush+Reload or Prime+Probe on the table) learns which cache lines were touched, and thus the high bits of `key_byte`, recovering the key with a few thousand encryptions (Osvik–Shamir–Tromer 2006; Bernstein 2005 timed the whole cipher). The vulnerability is **data-dependent memory access**: the address touched depends on the secret.

**Constant-time programming** is the defence, and it is a discipline, not a flag: a routine is constant-time if its **execution time and memory-access pattern are independent of secret data.** That means:

- **No secret-dependent branches** (a branch's timing reveals which way it went).
- **No secret-dependent memory indices** (the cache reveals which line).
- **No secret-dependent variable-latency instructions** (early-terminating multiply/divide on some cores).

In practice: replace `if (secret) a else b` with **branchless masking** (`r = (mask & a) | (~mask & b)`), replace table lookups with either bitsliced computation or scanning the *entire* table every time, and compare secrets with a running-OR loop that always touches every byte (`diff |= a[i]^b[i]`) rather than `memcmp`, which returns early on the first mismatch and thereby **leaks how many leading bytes matched** — the classic timing bug in naive MAC/token comparison. Modern crypto ships hardware AES (**AES-NI**) precisely so the S-box is not a table in cacheable memory. **Exercise 4** compares the emitted assembly of `memcmp` vs a constant-time compare and shows the early-return branch appearing in one and not the other (§6).

### 4.3 Power analysis (DPA/SPA), in outline

CMOS gates draw current when they switch (`transistors-cmos-fabrication.md`), and the amount depends on how many bits flip — so **the power trace of a chip correlates with the data it processes.** *Simple Power Analysis* reads secrets off a single trace (e.g. an RSA square-and-multiply where multiply draws more than square, spelling out the exponent bits). *Differential Power Analysis* (Kocher, Jaffe, Jun, CRYPTO 1999) uses statistics over *many* traces to pull a key out from under the noise, correlating power against a hypothesised intermediate value for each key guess. This is the primary threat model for **smartcards, hardware wallets, and any chip an attacker can hold**, because it needs physical access to the power rail (or EM emanations, a contactless variant). Defences: masking (split every secret into random shares), power-balancing logic, and adding noise — all imperfect. The lesson: *computation costs energy, and energy is data.*

### 4.4 Cold boot and fault injection, briefly

- **Cold-boot attacks** (Halderman et al., USENIX Security 2008). DRAM does not lose its contents instantly on power-off — it **decays over seconds, longer if chilled** (spray the DIMM with canned-air coolant). Cut power, reboot into a tiny memory-dumping OS (or physically transplant the DIMM), and recover the contents — including **disk-encryption keys** — from what was RAM moments ago. Defeats full-disk encryption whose key sat in memory. Mitigations: encrypted RAM, keeping keys only in CPU registers/SGX, scrubbing on boot. The lesson: *"the data was in RAM, which is gone now" is false — RAM is a leaky bucket, not a switch.*
- **Fault injection.** Deliberately push the chip out of spec — a **voltage glitch**, a **clock glitch**, a **laser** or EM pulse on the die, or, in software, *Rowhammer* and *Plundervolt* (§5.4) — to make an instruction skip, a comparison return the wrong result, or a multiply produce a faulty value. A single faulted comparison can skip a signature check ("did the firmware verify? — glitch the branch and it says yes"); a faulted CRT-RSA signature leaks the private key (Boneh–DeMillo–Lipton). This is the bread and butter of console/DRM hacking and secure-element attacks. The lesson: *hardware assumes it runs within spec; force it out of spec and its guarantees dissolve.*

---

## 5. Defensive infrastructure

### 5.1 Memory-safe languages, with the real numbers

The case for memory safety is not aesthetic; it is statistical, and the numbers are remarkably consistent across independent large codebases:

- **Microsoft:** ~**70%** of the CVEs Microsoft assigns each year, over roughly a decade, are memory-safety issues (Matt Miller, MSRC / BlueHat 2019). Consistent year over year.
- **Chromium:** of **912 high/critical severity security bugs since 2015** in stable Chrome, **~70% are memory-unsafety** — and **roughly half of those are use-after-free.** (Chromium security team, "Memory safety.")
- **Android:** memory-safety bugs were **~76% of Android's high-severity vulnerabilities in 2019**, and Google's "safe coding" write-up (Sept 2024) reports that share fell to **~24% in 2024** — *not* by rewriting old code, but by requiring new code to be memory-safe (mostly Rust). Their argument is the load-bearing insight: **vulnerabilities have a half-life and decay exponentially** as code ages (Google cites 5-year-old code having **3.4×–7.4× lower vulnerability density** than fresh code), so making *new* code safe drives the *total* down even while old unsafe code remains and the codebase grows. Old code is already mostly de-bugged by time; new code is where the vulnerabilities are, so that is where safety pays.
- **Apple** (iOS/macOS): **60–70%** memory-safety, per figures cited by Prossimo/others. [secondary]

**Why Rust exists, in these exact terms.** Rust's ownership-and-borrowing model enforces, *at compile time and at zero runtime cost*, the three properties whose absence causes the bugs above: no use-after-free (a value cannot be used after its owner drops it), no data races (aliasing `&mut` is forbidden), no out-of-bounds without a checked panic. It gets C-level performance because the checks are static — the borrow checker proves the program safe rather than inserting runtime guards (bounds checks on indexing remain, but are often elided). The pitch is precisely: *the 70% goes away for any code written in it, without a garbage collector or a slowdown.* That is why Android, Chromium, the Windows kernel, and the Linux kernel are all now admitting Rust for new components. (`unsafe` blocks remain an escape hatch and a residual surface — the guarantee is "safe by default, unsafe explicitly and auditably.")

### 5.2 Sanitizers — memory safety at development time

Before you rewrite in Rust, you can catch the bugs in C/C++ *during testing* with **sanitizers** — compiler instrumentation (`-fsanitize=...`) that turns undefined behaviour into a loud, located crash:

- **ASan (AddressSanitizer)** — shadow memory + red-zones around allocations detect heap/stack/global overflows and use-after-free with a precise report (~2× slowdown). The standard first line.
- **UBSan** — catches undefined behaviour: signed overflow, misaligned access, invalid shifts, etc. (This is where §3.4's integer-overflow bug gets caught.)
- **MSan (MemorySanitizer)** — reads of uninitialised memory.
- **TSan (ThreadSanitizer)** — data races (the concurrency analogue).

They are **development/test-time** tools (too slow and too memory-hungry for production, and ASan itself is not a security boundary), but combined with fuzzing (`libFuzzer`/AFL feeding random inputs) they find memory bugs before shipping. This is the pragmatic middle path between "unsafe C forever" and "rewrite everything."

### 5.3 Secure boot, measured boot, TPM

The chain of trust answers "is the software running on this machine the software we intended?" — a different question from the confidentiality attacks above.

- **Secure Boot** — a **chain of trust from an immutable root.** A hardware root (boot ROM, fused public key) verifies the signature of the first-stage bootloader before running it; that verifies the next stage; and so on up through the kernel. Any unsigned or tampered stage halts the chain. It *enforces* — it refuses to run unsigned code.
- **Measured Boot + TPM.** Instead of (or as well as) refusing, measured boot **records** what ran: each stage hashes the next and extends that hash into a **TPM PCR** (Platform Configuration Register), which can only be extended (`PCR = hash(PCR || new_measurement)`), never set — so the final PCR values are a tamper-evident summary of the entire boot. The **TPM** (Trusted Platform Module — a discrete or firmware secure element) can then **seal** secrets (e.g. a disk-encryption key) to specific PCR values, releasing them *only* if the machine booted the expected software. **Remote attestation** lets a third party verify the PCRs via a TPM-signed quote. Secure Boot says "won't run bad code"; measured boot says "will prove what code it ran."

### 5.4 TEEs — Trusted Execution Environments, and their long list of breaks

A TEE tries to run code *confidentially and with integrity even from a privileged attacker* — a malicious OS, hypervisor, or (in the cloud) the provider itself. Each vendor's design, and why the class should treat TEEs with respect but not faith:

- **Intel SGX** (Software Guard Extensions). Per-application **enclaves**: encrypted memory regions the CPU decrypts only inside the enclave, opaque to the OS and hypervisor. Ambitious threat model (defend against ring 0). **It has been broken repeatedly**, and this is the instructive part: **Foreshadow/L1TF** (2018, read enclave memory via speculative L1 access), **Plundervolt** (2019, undervolt the CPU to fault enclave computation), **CacheOut/SGAxe** (2020, extract the attestation keys), **LVI** (2020, inject values into enclave loads), **ÆPIC Leak** (2022, read stale enclave data straight from the APIC MMIO), and **Downfall** (2023) all pierced it. **Intel deprecated SGX on client/consumer CPUs (11th/12th-gen Core, ~2021)** — which, notably, removed 4K UHD Blu-ray playback — keeping it only on Xeon. The lesson: **SGX explicitly does *not* defend against side channels, and its small trusted-hardware base kept getting undermined by microarchitectural leaks.**
- **AMD SEV-SNP** (Secure Encrypted Virtualization – Secure Nested Paging). A different granularity: encrypt and integrity-protect **whole VMs** against a malicious hypervisor, with **SNP** adding protection against memory-remapping/replay by the host. This is the model cloud confidential-VMs actually use. Earlier SEV generations fell to unauthenticated encryption and replay; SNP closed much of that — but see the physical attacks below.
- **ARM TrustZone** — the oldest and most widely deployed: a **single system-wide split** into "secure world" and "normal world," used on virtually every phone for fingerprint matching, DRM (Widevine), and key storage. Coarser than SGX (one secure world, not per-app enclaves) and the secure-world code (a "trusted OS") is itself a large attack surface that has had plenty of its own bugs.
- **ARM CCA** (Confidential Compute Architecture, Armv9 **Realm Management Extension**) — ARM's newer, SEV-SNP-like answer: hardware-enforced **Realms** isolated from a normal-world hypervisor. Rolling out; the datacenter-ARM confidential-computing story.
- **NVIDIA Confidential Computing** (**Hopper H100** and **Blackwell**). Extends a CPU TEE (AMD SEV-SNP or Intel TDX confidential VM) to the GPU so **AI workloads on the GPU are protected from the host.** Mechanism (verified against NVIDIA's H100 CC documentation): **secure+measured GPU boot**; an **SPDM session** cryptographically binding the GPU to the driver inside the CPU TEE; **all PCIe traffic — command buffers and CUDA kernels — encrypted and signed**, moved through an **encrypted "bounce buffer"** in shared memory; a **hardware firewall** fencing off GPU memory regions; and **device attestation** via a device-unique ECC-384 key with a signed measurement report checked against NVIDIA's CA. **Compute and HBM run at full speed inside the boundary; the overhead is on the encrypted PCIe transfers** — NVIDIA measured CPU-side encryption bandwidth at **~4 GB/s** as the interconnect bottleneck, so the mode suits compute-heavy jobs with modest data movement and hurts transfer-bound ones. Blackwell extends and hardens this (higher-throughput CC, TEE-I/O); *verify Blackwell-specific throughput figures against current NVIDIA docs before quoting — see Appendix A.*
- **The physical break that hits all of them (2025–2026).** **Battering RAM** (De Meulemeester, Oswald, Verbauwhede, Van Bulck; KU Leuven / Birmingham; to appear IEEE S&P 2026) is a **~$50 DRAM interposer** — analog switches between CPU and DIMM — that lies dormant through boot-time checks and then introduces **memory aliases at runtime**, breaking **both Intel SGX (Scalable) and AMD SEV-SNP** as deployed on AWS/Azure/GCP/IBM: for SGX it replays captured ciphertext to get plaintext; for SEV-SNP it spoofs the launch-measurement attestation. The concurrent **WireTap** attack does similar with a commercial interposer. The lesson for a class: **TEEs raise the bar enormously against *software* attackers but assume the DRAM bus is trustworthy — give an attacker $50 and physical access and that assumption fails.** (These are verified 2025/26 results — Appendix A.)

The honest summary to give students: **a TEE is a strong defence against a remote or software-privileged attacker and a routinely-broken one against a determined microarchitectural or physical attacker.** Treat "confidential computing" as raising cost, not as a guarantee.

### 5.5 Hardware RNGs

Cryptography needs unpredictable bits, and software cannot manufacture entropy. Modern CPUs include a **hardware RNG**: a physical entropy source (thermal/shot noise across a metastable circuit, e.g. Intel's), fed through health tests and a cryptographic conditioner (a DRBG). x86 exposes **`RDSEED`** (raw conditioned entropy, for seeding) and **`RDRAND`** (DRBG output, faster). The OS mixes these with other sources (interrupt timing, etc.) into `/dev/urandom` / `getrandom()`. Two cautions worth stating: hardware RNGs have been the subject of trust debates (is the source backdoored? — hence *mixing* rather than trusting `RDRAND` alone), and they can fail silently, which is why standards mandate the on-die health tests. The lesson: *randomness is a physical resource, and where it comes from is a security decision.*

### 5.6 GPU security, briefly

GPUs were designed for throughput, not isolation, and it shows:

- **CUDA context isolation.** Historically weak — the MMU isolates address spaces between contexts *now*, but the GPU was built assuming a cooperative single tenant.
- **Uninitialised memory.** For years **GPU memory (and registers/shared memory) was not zeroed between processes**, so a process could allocate a buffer and read the *previous* tenant's leftover data — a documented leak (`LeftoverLocals`, Trail of Bits 2024, read data out of other processes'/other apps' GPU memory on several vendors). The fix is scrubbing on allocation, now increasingly default but historically not guaranteed. The lesson mirrors cold boot: *memory you didn't write may hold someone else's secret.*
- **MIG (Multi-Instance GPU)** on A100/H100 partitions one physical GPU into up to seven instances with **hardware-level isolation** of compute, memory, and cache — a genuinely stronger boundary than software time-slicing (MPS), intended for multi-tenant serving. The guarantee is spatial partition, not a full security domain against microarchitectural side channels, so treat it as strong isolation for *fault/performance*, and lean on confidential computing (§5.4) for *confidentiality* against a hostile co-tenant.
- **Datacenter confidential computing** — §5.4's NVIDIA CC is exactly the answer to "how do I run a model on a GPU in a cloud without trusting the cloud."

---

## 6. Curriculum — four units in dependency order

Each unit names its **one idea**, states the dependency, and gives machine-checkable exercises. Everything runs on **Compiler Explorer** (godbolt.org — compiles *and executes* x86-64, shows assembly, lets you toggle mitigations by flag) or any local GCC/Clang. **Every exercise is single-process, self-contained, and demonstrative** — no external target, no network, no exfiltration. These are the standard, widely-taught labs.

### Unit 1 — The cache is real and you can see it
**One idea:** *microarchitectural state (the cache) is observable from software as timing, and it is not rolled back by the architecture.* This is the foundation for everything; teach it before any attack.
**Depends on:** `cpu-architectures.md` (cache hierarchy, `rdtsc`), `x86-64-assembly.md`.

- **Exercise 1 (the centrepiece lab): Flush+Reload covert channel between two functions in one process, with a timing histogram.**
  - One function ("sender") reads element `probe[SECRET * 4096]` of an array it shares with a "receiver." The receiver `clflush`es all 256 probe lines, calls the sender, then times a `rdtscp`-bracketed load of each line.
  - **Plot the histogram** of the 256 reload times: you will see a clean **bimodal distribution** — a tight low-latency hump (the one cached line, the transmitted byte) and a high-latency hump (the 255 uncached lines). The gap between the humps *is* the channel; its midpoint is your threshold.
  - **Checkable:** the recovered index equals `SECRET` for every byte value 0–255. Vary the stride (drop below a page and watch prefetching smear the signal). This single lab makes the entire §2 mechanism concrete and is the prerequisite intuition for Meltdown/Spectre. It is a legitimate, standard demonstration — a covert channel *within one process*, transmitting a value the program already owns.

### Unit 2 — Speculation leaks what it computes but not what it touches
**One idea:** *transient instructions run on the wrong path or after a fault, are rolled back architecturally, and leave a cache footprint that Unit 1's primitive reads out.* Meltdown and Spectre are two ways to trigger the transient access; the decode is Unit 1.
**Depends on:** Unit 1; `cpu-architectures.md` §2 (out-of-order, branch prediction, ROB).

- **Exercise 2a: observe misprediction cost.** Time a tight loop over a branch on **sorted vs unsorted** data (the famous StackOverflow example). Sorted data → predictable branch → fast; shuffled → mispredicts → slow, by a large factor. Machine-checkable: the sorted run is measurably faster on identical data. This makes "the predictor exists and misprediction is expensive" tangible — the engine Spectre abuses.
- **Exercise 2b (read + discuss, not build): the Spectre v1 gadget.** Read the canonical `if (x < size) y = array2[array1[x]*4096];` gadget; identify *by inspection* where the mistraining happens and where the leak encodes. Discuss why `array_index_nospec()` / `lfence` fixes it and why you must place the fix by hand — the "essentially unfixable" argument. (Building a working Spectre PoC is out of scope and unnecessary; the mechanism is fully taught by Unit 1's decode plus 2a's engine.)

### Unit 3 — Every mitigation is a fossil of an attack
**One idea:** *reading the memory-safety mitigation list backwards is the history of the field; overwriting a return address teaches the calling convention.*
**Depends on:** `x86-64-assembly.md` (stack frames, `call`/`ret`), `cpp-linux-systems.md`.

- **Exercise 3a: the canary appears and disappears in the assembly.** Compile a function with a `char buf[64]` and a `strcpy` into it, first with `-fno-stack-protector`, then with `-fstack-protector-all`. **Diff the emitted assembly:** with the protector you see the canary load from `%fs:0x28` at entry and the compare-and-`__stack_chk_fail` before `ret`; without it, gone. Machine-checkable: the presence/absence of the `%fs:0x28` sequence. This is the fossil made literally visible in the instructions.
- **Exercise 3b: overflow and watch the crash (self-contained).** Under `-fno-stack-protector`, overflow the local buffer past the saved return address with a recognisable pattern (e.g. `0x4141...`) and run it on Compiler Explorer's executor. Observe the segfault with `%rip` = your bytes — *proving* the return address sits just past the buffer and that you wrote over it. Recompile with the protector: now it aborts with `*** stack smashing detected ***` instead. Machine-checkable: crash signature changes. Teaches frame layout and endianness by necessity, and stops at the observation.
- **Exercise 3c: observe ASLR.** Print the address of a stack variable, a heap allocation, and a libc function (`&printf`) across several runs. **With ASLR on (default), the addresses change every run; with `setarch -R` (disable randomisation), they are fixed.** Machine-checkable: variance across runs, then zero variance under `-R`. Teaches what ASLR randomises and why an info-leak defeats it.

### Unit 4 — Data-dependent timing is a leak; constant-time is the discipline
**One idea:** *if execution time or memory-access pattern depends on a secret, the secret leaks — the defence is to make both independent of secret data.*
**Depends on:** Units 1–2 (why timing leaks); ties back to §4.2.

- **Exercise 4a: constant-time vs variable-time comparison in the assembly.** Compile a naive `memcmp`-style secret compare (early `return` on first mismatch) next to a constant-time compare (`diff |= a[i]^b[i]` over the whole buffer, single final test). **Diff the assembly:** the naive one has a conditional branch *inside* the loop (the early exit — the timing leak); the constant-time one has a straight-line loop and one branch at the end. Machine-checkable: the in-loop conditional branch is present in one and absent in the other.
- **Exercise 4b: measure the leak.** Time the naive compare against inputs that match 0, 1, 2, … leading bytes; plot time vs match-length and see it rise linearly — the leak is now a graph. The constant-time version is flat. Machine-checkable: monotonic slope for naive, flat for constant-time. Connects directly to §4.2's AES/MAC attacks and to why `crypto_verify`/`hmac.compare_digest` exist.

**Suggested optional extensions** (read/discuss, no build): Rowhammer as "software changes physics" (§4.1, watch a public demo, don't reproduce); the CVE-percentage numbers (§5.1) as the empirical case for Unit 3's whole existence; TEEs and their breaks (§5.4) as the ceiling on all of this. If the course wants a fifth unit, it is *"and here is why we now write new code in Rust,"* built entirely on §5.1's numbers.

---

## Appendix A — Verification ledger

**Verified against a primary or reputable source during this research (Sept 2026):**

- Meltdown mechanism, Intel-not-AMD asymmetry, KPTI/KAISER and its origin as an anti-KASLR defence — Meltdown paper (USENIX Security 2018) and the KAISER/KPTI record. Mechanism as stated.
- Spectre v1/v2 mechanism and the "v1 essentially unfixable" framing — Spectre paper (S&P 2019).
- Flush+Reload — Yarom & Falkner, USENIX Security 2014.
- Rowhammer origin (Kim et al., ISCA 2014), Project Zero PTE-exploit (Seaborn & Dullien 2015), Rowhammer.js (DIMVA 2016), TRRespass (S&P 2020), Blacksmith (S&P 2022).
- **Phoenix Rowhammer (CVE-2025-6202):** DDR5, SK Hynix, 15 DIMMs 2021–2024, TRR bypass, **privilege escalation in as little as 109 s / ~5 min avg**, disclosed June 2025 / embargo to 15 Sept 2025, to appear IEEE S&P 2026 — verified against comsec.ethz.ch/Phoenix.
- **CVE-percentage numbers:** Chromium **~70% of 912 high/critical bugs since 2015, ~half use-after-free** (chromium.org). Android **76% (2019) → 24% (2024)**, half-life / 3.4×–7.4× density argument (Google Security Blog, Sept 2024). Microsoft ~70% (MSRC/BlueHat 2019, via memorysafety.org). Apple 60–70% [secondary, memorysafety.org].
- **NVIDIA H100 Confidential Computing:** secure/measured boot, SPDM, encrypted+signed command buffers and kernels, encrypted bounce buffer, HW firewall, ECC-384 device attestation, **~4 GB/s** CPU-encryption interconnect bound, compute/HBM unaffected — verified against NVIDIA's H100 CC developer documentation.
- **Battering RAM:** ~$50 interposer, breaks Intel SGX (Scalable) and AMD SEV-SNP, memory-aliasing at runtime, disclosed Feb 2025, IEEE S&P 2026, KU Leuven/Birmingham authors; concurrent WireTap — verified against batteringram.eu.
- **SGX break list & deprecation:** Foreshadow, Plundervolt, SGAxe/CacheOut, LVI, ÆPIC Leak; deprecated on 11th/12th-gen client Core (~2021) — verified against the SGX Wikipedia summary (secondary but consistent with primary advisories).
- Transient-execution taxonomy (MDS/RIDL/ZombieLoad, L1TF/Foreshadow, Retbleed, Downfall, Inception, Zenbleed) with CVEs — verified against the transient-execution-vulnerability compendium.

**Not fully verified / treat as provisional (flagged inline as [unverified] or [secondary]):**

- **KPTI cost "5–30% syscall-heavy":** widely reported range, workload-dependent; not pinned to one primary benchmark here. Order of magnitude only.
- **Retbleed cost (~39% Intel / ~14% AMD)** and **Branch Privilege Injection (~8%):** from the disclosures/secondary reporting; verify against the specific advisory before quoting.
- **2024–2026 transient-execution items** (Indirector, TikTag, GhostRace, Training Solo, Branch Privilege Injection, TSA, VMScape, RISC-V Spectre variants): dates/CVEs from the compendium and secondary reporting. **The compendium is a strong aggregator but not a primary advisory — verify each CVE's scope and affected-parts list against the vendor before teaching specifics.** The *taxonomy and trajectory* are the durable teaching content; the exact leak rates and part lists are not.
- **NVIDIA Blackwell CC specifics** (throughput, TEE-I/O details): asserted as "extends Hopper CC"; per-number claims not verified against a Blackwell-specific doc — verify before quoting figures.
- **LeftoverLocals / GPU-memory-not-zeroed:** attributed to Trail of Bits 2024 from background knowledge; not re-fetched this session — verify the affected-vendor list.
- **Constant-time / DPA / cold-boot / SGX-attack publication years:** from established background knowledge (Kocher DPA 1999, Halderman cold-boot 2008, Shacham ROP 2007, Aleph One 1996); standard citations, not re-fetched this session.
- Web search was unavailable this session (budget exhausted); all verification above is via direct page fetches. Anything not fetched is marked [secondary] or drawn from established literature.

## Appendix B — Reading list, ranked for a curriculum

1. **Meltdown** (Lipp et al., USENIX Security 2018) and **Spectre** (Kocher et al., S&P 2019) — the two founding papers; read Meltdown first for the clean mechanism.
2. **Yarom & Falkner, Flush+Reload** (USENIX Security 2014) — the measurement primitive under everything.
3. **Aleph One, "Smashing the Stack for Fun and Profit"** (Phrack 49, 1996) — the clearest first read on stack overflow; still accurate on the mechanism.
4. **Shacham, "The Geometry of Innocent Flesh on the Bone"** (CCS 2007) — the ROP paper; why NX was not the end.
5. **Kim et al., Rowhammer** (ISCA 2014) and **Seaborn & Dullien** (Project Zero, 2015) — the physics, then the exploit.
6. **Google Project Zero blog** — the ongoing primary source for real-world exploitation and disclosure; the Rowhammer and Spectre write-ups especially.
7. **Google Security Blog, "Eliminating Memory Safety Vulnerabilities at the Source"** (Sept 2024) — the safe-coding / half-life argument with the Android numbers.
8. **Chromium "Memory safety"** and **Microsoft MSRC (Matt Miller, BlueHat 2019)** — the CVE-percentage evidence.
9. **transient.fail / the transient-execution compendium** — the living taxonomy of every Spectre-class bug with CVEs and affected parts.
10. **Kocher, Jaffe, Jun, "Differential Power Analysis"** (CRYPTO 1999) and **Halderman et al., cold boot** (USENIX Security 2008) — the physical-layer classics.
11. **comsec.ethz.ch (COMSEC) and VUSec** — the two groups producing most of the current Rowhammer and microarchitectural work (Phoenix, Blacksmith, TRRespass, VMScape, Training Solo).
12. **Compiler Explorer (godbolt.org)** — the lab bench for every exercise here.
