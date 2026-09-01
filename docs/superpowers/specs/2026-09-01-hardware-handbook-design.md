# The Hardware Handbook: design

A learn-by-fighting-the-tool handbook for how computers actually work, from a
transistor to a distributed training run. Same shape as the Rust Handbook:
a static site, authored markdown compiled to JSON once, and every exercise
checked by a real tool that complains specifically.

Status: **awaiting approval.** Nothing is built. 36 research reports (4.4 MB)
in `.research/` feed this document; the two `VERIFIED-*` notes there record
things established by live probe rather than by reading docs.

---

## 1. What this is

The Rust Handbook works because rustc has stable error codes and a free public
service that compiles a snippet and returns structured diagnostics. The bet
here is that the same shape holds for a subject with no single compiler, if you
accept **four** execution backends instead of one and make the exercise declare
which it needs.

The subject is bigger than Rust and the spine is longer. What holds it together
is a single causal chain, which the transistor research handed over intact:

```
subthreshold leakage has a 59.5 mV/decade floor at 300 K
  -> V_th cannot keep falling
    -> V_dd cannot keep falling        (stalled ~1.0 V for twenty years)
      -> power density climbs           (1.0 -> 35.4x over five nodes)
        -> frequency stops              (4-6 GHz since 2005)
          -> multicore
            -> GPUs
              -> tensor cores
                -> FP8, FP4
```

Every arrow is the same move: power is the budget, so stop spending it on
control and spend it on arithmetic. The FP4 units at the end of the course are
the last step of a chain that begins with a physical constant, and the course
can now say so with the arithmetic in hand.

The reader is a strong software engineer who wants to be an AI researcher who
understands the machine. They can already write code; they cannot yet say why
it is slow, and that is the gap.

---

## 2. Architecture

Unchanged from the Rust Handbook in every respect that matters: a static site,
`content/` -> `build.py` -> `data/` -> browser. No framework, no npm, no
bundler, no CDN, no server of our own, no accounts, progress in `localStorage`.
`data/` is committed and CI fails if it disagrees with `content/`.

```
content/         markdown you write
  units/         the notes
  ex/            exercises, one file per unit
  drills/        quiz questions
  projects/      multi-stage builds
  atlas/         the hardware reference data (see 5)
build.py         markdown -> JSON, plus the validator
data/            generated JSON, committed on purpose
index.html       the shell
assets/app.css   every token and rule
assets/app.js    routing, views, progress, search
assets/workbench.js   editor, backend clients, diagnostics parsers
runner/app.py    the Modal runner a learner deploys themselves
```

### 2.1 Four backends, declared per exercise

```
                     @backend directive in the exercise front matter
                                     |
   +---------------+---------------+-+-------------+----------------+
   |               |                 |             |                |
  sim           godbolt            yosys         modal
  in-page JS    public API       WASM in-page   learner's own
   |               |                 |             |
  Part 0        most of the       the HDL       GPU units that
  gates,        course: C, C++,   units         genuinely need
  registers,    asm, CUDA                       silicon
  ALU, CPU      compile-only
```

**sim**: a NAND-and-wires simulator, a few hundred lines of JS. Part 0's
exercises are truth tables, clock traces and static invariants over a control
table. No network, no account, no server. Standing up an HDL service to check
that someone wired an XOR would be building a server to do arithmetic.

**godbolt**: Compiler Explorer's public API. Verified working: structured
diagnostics with line/column/severity, C and C++ **compiled and executed**,
x86-64 assembled and run, cross-compilation to AArch64/ARM/RISC-V, 23 avr-gcc
versions with avr-libc headers resolving under `-mmcu=atmega328p`, 8
arm-none-eabi versions, nvcc + clang-cuda through CUDA 12.9 (compile only,
PTX and SASS out), SystemC 3.0.0/3.0.1 executing, zlib 1.3.1, sanitizers,
loopback TCP, epoll, io_uring, `/proc/self/maps`, `fork`, `SIGKILL`,
`O_DIRECT`. `/tmp` is tmpfs; `/app` is real ext4. Hard 16 MiB `RLIMIT_FSIZE`,
100 fds, ~2 vCPUs, no outbound network, no PMU counters.

**yosys**: `yowasp-yosys`, real Yosys 0.68 compiled to WASM, run in the
learner's browser. Verified: exact latch-inference warnings, cell counts that
distinguish `<=` from `=` in one character, and formal SAT equivalence proofs
that emit a concrete counterexample when the design is wrong. The runtime is a
67 MB fetch, cached once. This is the fourth backend and it costs nothing.

**modal**: the learner deploys a ~60-line runner to their own Modal account
(free tier is **$30/month**, verified) and pastes the URL into settings. Their
credit pays. Used only where a GPU is genuinely required.

### 2.2 The Modal runner, corrected by live probe

Two of Modal's own recommended hardening features are each incompatible with
one half of the obvious design. Both were found by probing a real account, not
by reading docs, and both are recorded in
`.research/VERIFIED-modal-runner-architecture.md`.

- `requires_proxy_auth=True` **breaks every browser caller.** The CORS
  preflight returns `HTTP 401` with zero CORS headers. Preflights are anonymous
  by spec, so the browser never sends the real request. Not fixable from the page.
- `restrict_modal_access=True` **breaks `.spawn()`.** The container runs, then
  fails to report its result with `AuthError: Received :status = '401'`, the
  flag blocks the API the container needs to deliver the answer.
- `block_network=True` is **fine** with `.spawn()` (8 s vs 15 s cold). The
  containment that actually matters is free.

So the architecture is:

```
browser --POST {token, gpu, source}--> CPU web endpoint   (open, CORS works)
                                          | token checked in the BODY
                                          | rejection costs ~0.6 s CPU, no GPU
                                          v
                                       run_<gpu>.spawn()   block_network=True
                                          |                scaledown_window=2
                                          |                single_use_containers
                                          v
browser --POST {token, call_id}------> CPU poll endpoint -> result
```

Security is: an unguessable random app label, a secret in the request body, no
egress from the GPU container, single-use containers, and a `max_containers`
cap. Spawn-and-poll also escapes Modal's hard **150 s HTTP ceiling**, which a
cold start plus nvcc can exceed.

Open item: spawning a GPU function from inside a web-endpoint container did not
complete in the prototype, though standalone spawn works. A hydration detail to
resolve during implementation, not a platform limit.

### 2.3 The GPU picker

`gpu=` is a decoration-time argument, so the runner defines one named function
per catalogue entry. `.research/modal-gpus.json` holds 13 GPUs with
`gpu_string`, VRAM, arch, `sm`, and price per hour, and drives a dropdown
showing all of it. Exercises declare a minimum (`@gpu sm_100a`), and anything
below it is greyed out **with the reason shown**.

This is not cosmetic. `RTX-PRO-6000` is listed under Blackwell at $3.03/hr,
cheaper than B200's $6.25, and it is **compute capability 12.0, not 10.0**.
It has FP4 tensor cores but no `tcgen05` and no `sm_100a` ISA. `sm_120` and
`sm_121` appear in no `tcgen05` target notes. A learner economising on the FP4
unit picks it and gets a PTX error, and Modal documents this nowhere.

`$30` buys **4.8 hours of B200**. The FP4 exercises must be short, and the
picker should show remaining-credit arithmetic.

### 2.4 The diagnose map, and why the validator is load-bearing

Rust keys on `E0382` and that code is a permanent promise. GCC, Clang and nvcc
make no such promise. nvcc has no error codes at all; warnings are numbered
(`#549-D`) and errors are bare prose. So `@expect` is a regex over a normalised
message signature:

```
@expect  /error: identifier "(\w+)" is undefined/
@diagnose deleted-move   The copy constructor is gone because you declared a
                         move constructor. Rule of five, and the compiler is
                         enforcing the half you skipped.
```

`build.py --validate` recompiles every starter and solution against the real
toolchain and **fails the build** if a starter stops producing the message its
explanation describes. Rust's handbook could survive a lazy validator. This one
cannot.

### 2.5 Two platform requirements found the hard way

**Compiler Explorer caches compile-and-execute results, including timings, and
its executor is too noisy for timing assertions even once you defeat the cache.**
Identical source froze `execTime` at 25 ms while wall time collapsed
1.65 s -> 0.21 s; with a nonce, 25/28/26 ms and ~1.6 s each. But the noise floor
is ~6%, and the same GEMM speedup measured **6.04x, 7.15x and 4.63x** across
three nonce'd runs.

So, two rules, not one:

- the workbench MUST send a unique nonce with every submission, **in
  `options.userArguments` as `-DHH_NONCE=<uuid>`, never in the source.** The
  options are part of Compiler Explorer's cache key, so this defeats the cache,
  and unlike a comment it shifts no line numbers. A nonce in the source would
  move every diagnostic by one line and silently break the mapping from error to
  editor line; and
- exercises MUST assert on **values, buffers and hashes**, not on time. Where a
  ratio genuinely is the lesson, set the threshold far below the true value
  (e.g. assert `> 3` for a ratio that measures ~6) and make the learner explain
  the spread. The spread is itself the measurement lesson.

The graphics capstone shows the pattern that works: an FNV-1a hash of the
framebuffer, **bit-identical across GCC 15.2 -O2, Clang 20.1.0 -O2 and GCC -O0**,
which required quantising trig to 2^-20 because libm `sin`/`cos` are not
bit-portable and one ulp changes a pixel.

Two harness gotchas to bake into every generated program: `assert` is live
(`NDEBUG` unset; failure surfaces as exit code 139), and `abort()` does not
flush stdio, so every exercise opens with
`setvbuf(stdout, nullptr, _IONBF, 0)`. There is also a ~10 s wall-clock limit, 
n=1024 GEMM sweeps were SIGKILLed, so exercises are sized to n=512.

**Measure on more than one machine before asserting a constant.** AoS-vs-SoA
gives 1.47x on a 128-byte cache line and 3.66x on a 64-byte line for the same
struct. A single-machine number quoted as a constant is wrong.

**Never assert on output derived from a standard-library random distribution.**
`std::normal_distribution` is not specified across implementations: the same
seeded `mt19937` gives different RMSE on libc++ and libstdc++, while the
model-derived quantity (a Kalman steady-state covariance) came out bit-identical.
So an exercise must either supply its own RNG (an explicit LCG is bit-identical
everywhere) or assert on inequalities and model-derived quantities rather than
on sampled values. The same caution applies to anything touching libm: `sin` and
`cos` are not bit-portable, so a hash-checked exercise must quantise (the
graphics capstone uses 2^-20).

---

## 3. The track

Seventeen parts. Each depends only on what precedes it. Parenthesised names are
the research reports backing each part.

**I. Physics** (transistors-cmos-fabrication)
the switch · the gate is two switch networks · every switch costs energy ·
making the thing is the hard part

**II. Logic** (nand2tetris-eater-scott)
NAND and functional completeness · selection and addressing · arithmetic and
why subtraction is free · feedback and the bit that stays · the clock and the
shared bus · addressable storage and the counter · instruction encoding ·
control and the fetch-execute loop

**III. Silicon** (digital-design-hdl-fpga)
structure not sequence · the clock edge · proving it works · timing and the
chip it runs on

**IV. Theory** (theory-of-computation)
models of computation and the universal machine · formal languages and the
tools built on them · computability and why your linter has false positives ·
complexity as advice

**V. The machine** (x86-64-assembly, cpu-architectures)
registers and the stack · addressing and flags · syscalls · ELF and loading ·
the memory hierarchy · pipelines, prediction, SIMD · atomics and ordering

**VI. Numbers and text** (numbers-text-numerics)
integers and overflow · endianness · IEEE-754 · stability, and the bridge to
low precision · Unicode and UTF-8

**VII. Systems** (cpp-linux-systems, os-and-platforms)
the C++ object model · RAII and moves · compile time · syscalls and processes ·
virtual memory · threads and scheduling · the ABI · linking and interposition

**VIII. Storage** (storage-filesystems-engines)
the device decides everything · getting to the device · the kernel's memory of
the disk · naming bytes · data structures dictated by physics

**IX. Tools** (compilers-interpreters-terminals-unix, build-systems-toolchains,
debugging-and-measurement, testing-fuzzing-verification)
the terminal is a kernel object · the shell forks and the tradition follows ·
source text to syntax tree · SSA and the middle end · the back end and the
linker · interpreters and JITs · the build graph · the debugger and the
sanitizer · measurement methodology · property testing and fuzzing

**X. Algorithms** (algorithms-on-real-hardware, numerical-linear-algebra)
Big-O and the machine it assumes · layout is the algorithm · control flow is
the algorithm · work, depth and the scan · the BLAS levels and why only GEMM
reaches peak · decompositions and conditioning · sparse and iterative

**XI. Concurrency** (concurrency-theory-coroutines)
memory models · lock-free and the reclamation problem · parallel algorithm
theory · coroutines as frames that outlive their call

**XII. Networks** (networking-and-internet)
frames and the link layer · addressing and routing · TCP as a control loop ·
the socket API and how servers scale · DNS, HTTP, TLS · collectives and how
512 GPUs talk

**XIII. Signals** (signals-and-dsp)
the analog boundary · time and frequency · filters

**XIV. Information** (information-theory-coding, cryptography)
information has a measure and it is a floor · removing redundancy · adding
redundancy back · symmetric and asymmetric primitives · crypto and the hardware

**XV. Security** (hardware-security)
the cache is real and you can see it · speculation leaks what it touches ·
every mitigation is a fossil of an attack · constant-time as a discipline

**XVI. Graphics and GPU** (graphics-pipeline, modal-gpu-glossary,
cuda-programming-tuning, nvidia-architectures, amd-and-other-accelerators)
why a screen is an arithmetic problem · how a triangle becomes pixels · why the
SM is shaped like that · the throughput machine · the execution model · the
memory hierarchy · coalescing · shared memory and banks · the resource budget ·
latency hiding · roofline and the three limiters

**XVII. Kernels and AI** (fp4-fp8-blackwell, numpy-pytorch-internals,
ai-systems-distributed-training)
strides and the dispatcher · autograd · naive to tiled GEMM · CuTe layouts ·
the number formats · block scaling · stochastic rounding and Hadamard ·
transformer arithmetic · online softmax and FlashAttention · inference is two
machines · the parallelism taxonomy

**XVIII. Embodied** (embedded-and-sbc, robotics-control-embodied-ai)
the chip with no operating system · the abstraction has a cost · time,
interrupts and volatile · wider machines · where determinism goes to die ·
actuators and FOC · control loops · estimation · planning · physical
intelligence

**XIX. Limits** (limits-of-computation)
the thermodynamic floor · the walls we are hitting · alternative models

### 3.1 The through-line

The same question at every altitude: *how does this thing know what to do next?*
A program counter and a decoder in II. An instruction pointer and an ELF entry
point in V. A vtable and a syscall in VII. A warp scheduler in XVI. A
`tcgen05` descriptor in XVII. Same question, six answers, each startling only
if you already know the previous one.

---

## 4. Exercises the research already proved

Not aspirations, these were compiled and run during research.

| Part | Exercise | The check |
|---|---|---|
| II | control-table bus contention | `popcount(word & OUT_MASK) <= 1` over all 1024 entries, statically |
| III | `<=` vs `=`, one character | Yosys cell count: 2 `$_DFF_P_` vs 1 |
| III | 8-bit ALU equivalence | SAT proof; broken version emits `a=214, b=199` |
| V | signed overflow UB | `-O0` prints 0, `-O2` prints 1, `-fno-strict-aliasing` prints 0 |
| VII | `/proc/self/maps` | five ELF segments, `[heap]`, `libc.so.6`, deterministic |
| VIII | B-tree vs LSM write amplification | 251.8x vs 1.0x, changing only key order |
| VIII | fsync on tmpfs vs ext4 | 0.00 ms vs 413 ms, what a lying device looks like |
| IX | Python specialisation | `RESUME`->`RESUME_CHECK` after 1 call, `BINARY_OP`->`BINARY_OP_ADD_INT` after 2 |
| X | linked list vs vector | 637x at n=2^23, with pool-order as the control |
| X | Blelloch vs Hillis-Steele | exactly 3(n-1) vs n·log2(n) operations |
| X | Gram-Schmidt | classical vs modified orthogonality loss, deterministic |
| XII | Nagle + delayed ACK | 40636.6 us vs 43.2 us, the 40 ms timer, measured |
| XIV | arithmetic coding | 0.47315 bits/symbol on a 0.47315-entropy source |
| XIV | CRC-32 folklore | it does NOT detect all odd-weight errors; one popcount proves it |
| XV | Flush+Reload | bimodal timing histogram, one process, no external target |
| XVI | software rasteriser | SHA-256 of the framebuffer at frames 0/30/60/90 |
| XVII | online softmax | delete `diag(alpha)`; denominator stays right, output goes wrong |
| XVIII | `digitalWrite` vs `PORTB` | 52 cycles vs 2, and the optimiser provably cannot fold it |

---

## 5. The hardware atlas

The breadth material becomes a browsable, data-driven reference rather than
thirty more units, same role as the Rust Handbook's glossary and errors pages.
Units teach depth; the atlas holds the map.

Contents: every NVIDIA generation Tesla 2006 -> Rubin with the complete `sm_XX`
-> architecture -> chips table; AMD GCN/RDNA/CDNA with the CUDA<->AMD
terminology map and the wave64-vs-warp32 consequences; Intel, Apple, TPU,
Cerebras, Groq; CPU families and ISAs; microcontrollers and SBCs; the operating
systems compared; Modal's GPU catalogue with live pricing.

The atlas earns its place by teaching something the units cannot. Example:
**Ada Lovelace added nothing to the programming model**: same per-SM resources
as `sm_86`, no clusters, no TMA, no `wgmma`, yet carries the same "4th-gen
tensor core" label as Hopper. A reader who understands why an RTX 4090 and an
H100 share a marketing generation but not a programming model has understood
that architecture names are a sales artifact and `sm_XX` is the thing that is
real.

---

## 6. Look

Cool graphite and green phosphor. Neutrals rotated cool so the accent does not
go muddy, four inks with the discipline about which is allowed where, the hard
offset button shadow kept, fluid type tokens so no font size appears inside a
media query, one accent variable set per part on a container.

```
--bg      #0e1113 dark / #e8eaec light
--accent  #4ade80 phosphor
--ok      cyan/teal  -- NOT green, see below
```

**`--ok` must move off green.** In the Rust Handbook the accent is orange, so a
green "passed" stamp reads instantly as a different semantic class. With a green
accent, a passing exercise becomes indistinguishable from any ordinary accented
element, the most important state in the interface loses its signal. `--ok`
goes cyan/teal; `--warn` and `--bad` are unaffected.

**Bugs inherited from the reference implementation, to fix rather than copy**
(all verified in `RUSTBOOK-design-system.md`):

- `@keyframes tick` is declared twice (app.css 712 and 1309). The later wins, so
  the contents-rail dot runs the verdict animation instead of its own pulse.
  Rename one.
- Five literal colours sit outside the `:root` blocks, despite the guide saying
  none do. The worst is `.btn:hover { background: #ff7a35 }`, unthemed, so the
  dark-mode button hovers to a light colour. Tokenise all five.
- There are three `:root` blocks, not two, motion tokens are separate. Keep the
  split if it helps, but document it.
- Prose line-height is 1.68 in the stylesheet and 1.75 in the docs.

**Load-bearing arithmetic to preserve.** The rail spine's dot geometry
(`left: 4px` + 8px dot against `left: 7px` + 2px track; h3 dots at `left: 5px` +
6px) must be recomputed together if any of those numbers change. The editor's
two layers share **13 metrics**, twelve declared once on
`.editor pre.hl, .editor textarea` and one (width) settled in JS via
`ta.style.width = pre.scrollWidth + 'px'`; the phone breakpoint changes size,
line-height and padding together and a mismatch there drifts like any other.

Mascot: supplied by the user. Build with a neutral placeholder and a single swap
point.

---

## 7. Build order

Four units first, deliberately one per backend, before any mass writing.

1. **Shell, palette, `build.py`, and the whole track in the manifest**: the
   spine visible and honest from day one.
2. **Part II unit 1, the NAND gate**: complete: note, 8 exercises, 15 drills.
   Proves the in-page simulator.
3. **Part V unit 1, registers and the stack**: complete. Proves the Compiler
   Explorer client, the regex diagnose map, and the caching nonce.
4. **Part III unit 2, the clock edge**: complete. Proves the WASM Yosys
   backend.
5. **Part XVI unit 4, the CUDA execution model**: complete. Proves the Modal
   runner, the GPU picker, and the compile-only fallback.
6. **Then everything else**, which is writing, which is where the years go.

If the shape is wrong, that surfaces after four units rather than after eighty.

---

## 7a. Improvements over the reference implementation

The Rust Handbook is the style guide and the architecture. These are the places
the analysis found genuine gaps, and this handbook fixes them rather than
reproducing them. Sources: `RUSTBOOK-app-architecture.md`,
`RUSTBOOK-design-system.md`, `RUSTBOOK-content-pipeline.md`.

**Reader-facing**

- **Persist the editor buffer.** Pass/fail and hint counts survive a reload
  today; the reader's actual code does not. Save per exercise, debounced, in
  `localStorage`, with an explicit "reset to starter".
- **Rank search, and stop truncating by traversal order.** Today it is a
  substring scan with `slice(0, 60)`, so a large result set drops later units
  entirely. Score by field (title > heading > body), then truncate. Link section
  hits to the section anchor, not just the unit. Repopulate the input from the
  URL.
- **Persist drill results.** Score, attempts and per-question history, surfaced
  in the progress view. Today answering a drill stores nothing at all.
- **Make the contents rail mean something.** Keep the cheap scroll-ratio spine,
  but make the per-section dots reflect *read state*, furthest-reached, latched,
  persisted, instead of un-filling when the reader scrolls back up.
- **Separate the 404 from the error.** `notFound()` currently catches both, so a
  failed fetch is indistinguishable from a bug in a view. Give errors their own
  state with a retry.
- **Scroll restoration** on back-navigation.

**Accessibility**: all currently absent

- `aria-live` on the diagnostics region, so a compile result is announced.
- A focus trap, focus-on-open and focus-restore for the mobile sheet, which
  already claims `role="dialog" aria-modal="true"`.
- A skip link, and focus moved to the view heading on navigation.

**Correctness**

- Rename the duplicated `@keyframes tick`; tokenise the five stray literal
  colours; align the documented and actual prose line-height.
- Raise the note/exercise/drill count violations **before** writing JSON, not
  after, so a failed build cannot leave stale `data/` on disk.
- Give the directive parser an `else`: an unrecognised `@foo` must be an error,
  not silently swallowed.
- Per-backend thread pools, not one shared pool of 4, otherwise 200 local
  simulator checks queue behind 3 Compiler Explorer round-trips.
- Progress keys must NOT include the backend, or one exercise solved twice
  counts twice.

## 8. What is deliberately not built

No accounts, no database, no backend of ours, no login, no npm, no framework,
no cookie banner. Progress in `localStorage`. Hints and no answers, solutions
live in `content/` and the build compiles them, but the reader is never offered
one.

---

## 9. Open questions for the user

1. **Mascot.** Three options, or a direction to take?
2. **Scale of the first push.** The build order above stops after four units and
   asks for a look. Is that the right checkpoint?
3. **The Modal onboarding.** Unresolved and highest-impact: whether a Starter
   account can run anything *without a card on file*. The billing guide says a
   payment method is required; the pricing page advertises $30 free and does not
   mention a card. If a card is required, that is the biggest dropout point and
   it sits at step one. Worth verifying before the onboarding copy is written.
4. **Domain.** The Rust Handbook is `the-rust-handbook.com`. Is there a name
   for this one?

---

## 10. What building it taught, and where the design was wrong

Written after the pipeline, all four backends and five units were finished and
validated. Everything here is a correction to the sections above, not a
restatement of them.

### The design was right about

**One registry.** `track.py` as the sole place a unit exists has held through
122 entries and five written units. Adding a unit is one tuple, and forgetting
its files gets you a stub rather than a silent gap.

**Structured verdicts over regex.** The `verdict` judge carried every exercise
that was written; `match` was needed only where a diagnostic's wording is the
lesson. The prediction that regex would be the fallback rather than the default
was correct.

**Validating with the browser's own client.** Every backend validator imports
the code the page runs. Four of the bugs found this way were in the client
rather than the content, which a validator with its own model of the toolchain
would have missed entirely.

### The design was wrong about

**Accent as a per-part property.** Section 6 assigned a colour to each of the
19 parts from a rotation of seven. At 19 parts a rotation stops meaning
anything: the reader sees amber three times in unrelated places. The parts are
grouped into seven phases now and the phase owns the colour, so a part cannot
write its own. The track validates that the phases list the parts in track
order, which makes a two-level index and the flat spine unable to disagree.

**The track as a grid of cards.** Section 3 pictured the same card grid the
reference implementation uses. That is a wall at 122. Three levels now, with
units as rows.

**"The palette is done."** Section 6 specified colours by name and by feel and
nothing measured them. Two of the four inks could not legally carry body text,
the accent measured 2.9:1 as 12px type, and five of the eight light syntax
colours failed on the panel they sit on rather than on the page they were
chosen against. There are two accent tokens now, one for decoration and one for
text, and `contrast.py` fails the build on a palette that drops below 4.5:1.

The general lesson is the same one the exercises teach: a claim nothing measures
is a claim, and the ones that felt most settled were the ones that were wrong.

### Things only the real tools could have told us

- Compiler Explorer caches results including timings, so a nonce is required in
  `options.userArguments` and never in the source.
- `llvm-mc` rejects `-D` outright, so the nonce flag has to be per language.
  This broke the entire assembly backend and nothing noticed until the first
  assembly exercise existed.
- Compiler Explorer reports SIGSEGV for an assertion failure while its own
  stderr says the assertion failed. Key on the text.
- A link failure arrives with `buildResult.code` 0 and no executable, which
  looks like neither a compile error nor a crash.
- Modal's proxy auth breaks browser CORS, and `restrict_modal_access` breaks
  `.spawn()`, so the runner uses a shared secret and submit-and-poll.
- Yosys prints a message containing "latch inferred" when it did *not* infer
  one, and `-q` suppresses `stat`, which would silently zero every cell count.
- An out-of-bounds CUDA write inside its own managed allocation produces no
  fault, no sanitizer report and no wrong output. An exercise about it needs a
  sentinel, or its starter passes.

### Open question 3 is still open

Whether a Modal Starter account can run anything without a card on file was
never resolved, because the account used for validation already had one. It
remains the highest-impact unknown in the onboarding, and it sits at step one.

### What is still not built

The mascot, which needs the asset. Vim mode, which is listed and is not on the
path to anything. And 117 units.
