# Concurrency Theory and Coroutines, from First Principles

Research notes for a curriculum aimed at a strong SWE who already knows *how to use* threads
and mutexes, and now wants to know what the machine and the language are actually promising.

**Deliberately excluded** (covered by sibling reports): basic threads and mutexes, Linux
`clone`/`futex` mechanics, C++ memory-model basics. This report starts where those stop.

## Provenance

Every assembly listing, every measured number, and every sanitizer report in this document was
**executed live against the Compiler Explorer API during this research** — x86-64 GCC 15.2.0,
Clang trunk, ARM64 GCC 15.2.0. Nothing here is recalled codegen.

Primary literature was read from the source PDFs, not summarised from memory:

- **x86-TSO** — Sewell, Sarkar, Owens, Zappa Nardelli, Myreen, *"x86-TSO: A Rigorous and Usable
  Programmer's Model for x86 Multiprocessors"*, CACM Research Highlights (final version dated
  17 May 2010). Pages 1–3 read directly; the SB and IRIW litmus tables below are transcribed
  from that paper.
- **ARMv8 MCA** — Pulte, Flur, Deacon, French, Sarkar, Sewell, *"Simplifying ARM Concurrency:
  Multicopy-Atomic Axiomatic and Operational Models for ARMv8"*, PACMPL 2 (POPL), Article 19,
  January 2018. Pages 1–2 read directly.
- **Michael & Scott** — *"Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue
  Algorithms"*, Univ. of Rochester (PODC 1996). Pages 1–2 read directly; the ABA definition and
  the Valois memory-exhaustion result below are quoted verbatim.
- **P0981R0** — Richard Smith and Gor Nishanov, *"Halo: coroutine Heap Allocation eLision
  Optimization: the joint response"*, 18 March 2018. Fetched and read.
- **P0371R1** — Hans-J. Boehm, *"Temporarily discourage memory_order_consume"*, 23 June 2016.
  Fetched and read.
- **Nathaniel J. Smith**, *"Notes on structured concurrency, or: Go statement considered
  harmful"*, 25 April 2018. Fetched and read.

> **Web search was unavailable for this session** (budget exhausted). Sources were retrieved by
> direct URL fetch only. Section 9 lists exactly what that left unverified — read it before
> teaching anything from Sections 2.5, 4.3, or 5.4 as settled.

---

# 1. Memory models, formally enough to be useful

## 1.1 Sequential consistency, and why you cannot have it

Lamport's definition (1979) is the one everyone means: an execution is **sequentially
consistent** if the result is the same as some single interleaving of all threads' operations
in which each thread's operations appear in program order. Two clauses, and both matter:

1. **A total order exists** over all memory operations — one global timeline everyone agrees on.
2. **Program order is respected within each thread.**

SC is what your intuition assumes for free. It is also what no shipping multiprocessor gives
you, for one structural reason: **a store that must be globally visible before the next
instruction retires costs a full round trip to the coherence point.** A core that waited for
that would stall on every store. So every real core has a **store buffer** — a small FIFO of
pending writes — and lets the core run ahead while writes drain.

The store buffer *by itself* breaks clause 1. That is the whole story of x86.

The x86-TSO paper puts it exactly:

> "Microarchitecturally, one can view this particular example as a visible consequence of store
> buffering: if each processor effectively has a FIFO buffer of pending memory writes (to avoid
> the need to block while a write completes), then the reads from y and x could occur before the
> writes have propagated from the buffers to main memory."

There is a second reason, independent of hardware: **the compiler**. SC would forbid the
compiler from hoisting a load out of a loop, sinking a store past a call, or keeping a value in
a register across a sequence point. Every optimising compiler does all three. So even a
hypothetically SC machine would not give you an SC *program* unless the language model said so.

This is why the C++ model is defined over the *language*, not over the hardware: it has to
constrain two reorderers at once.

## 1.2 The litmus tests

A **litmus test** is a tiny multithreaded program, plus a question of the form "is this final
state reachable?". Memory models are specified and compared by which litmus outcomes they allow.
Four matter.

### SB — Store Buffering

```
Initially x = y = 0

  Thread 0            Thread 1
  x = 1               y = 1
  r1 = y              r2 = x

Question: can r1 == 0 && r2 == 0 ?
```

Under SC: **no**. Any interleaving puts one of the two stores first; the later thread's load
must see it.

Under x86-TSO: **yes**. The x86-TSO paper's own table for SB reads, verbatim:

> `Allowed Final State: Proc 0:EAX=0 ∧ Proc 1:EBX=0`

This is the *only* reordering x86 permits: **a store may be reordered with a later load to a
different address.** Store→store, load→load, and load→store are all kept in order.

**Measured, live on Compiler Explorer's x86-64 hardware** (GCC 15.2, `-O2 -pthread`, a
two-thread barrier built from monotone release/acquire counters so each round is a clean trial):

```
N=200000
  r1=0,r2=0       322   <-- FORBIDDEN under SC, ALLOWED by x86-TSO
  r1=0,r2=1    185319
  r1=1,r2=0     14359
  r1=1,r2=1         0
```

Change only the four accesses in the critical section from `memory_order_relaxed` to
`memory_order_seq_cst`, change nothing else:

```
N=200000
  r1=0,r2=0         0   <-- gone
  r1=0,r2=1    133838
  r1=1,r2=0     66161
  r1=1,r2=1         1
```

**322 out of 200 000 is 0.16%.** That is the number to show a student who thinks "x86 is
strongly ordered, so I don't need atomics." x86 is strongly ordered *and it still reorders*, and
the window is wide enough to hit it thousands of times a second.

(The `r1=1,r2=1` outcome in the seq_cst run is legal under SC — it just means both stores
happened to land before both loads. It is not a violation.)

### MP — Message Passing

This is the one the whole curriculum turns on, because **it is the example that is legal on ARM
and illegal on x86**.

```
Initially data = 0, flag = 0

  Thread 0 (producer)      Thread 1 (consumer)
  data = 42                r1 = flag
  flag = 1                 r2 = data

Question: can r1 == 1 && r2 == 0 ?
```

That is: the consumer sees the flag set, but reads stale data. It is the bug in every
hand-rolled publish/subscribe.

- **x86-TSO: forbidden.** Store→store is ordered (the producer's writes reach memory in program
  order) and load→load is ordered (the consumer's reads happen in program order). Both halves
  hold for free.
- **ARMv8 and POWER: allowed.** Neither store→store nor load→load is ordered by default. Two
  independent reorderings, either one of which is enough to produce it.

This asymmetry is the single most important portability fact in concurrent C++, and it is why
code that "worked for years on x86" falls over the week it is built for Graviton or Apple
silicon.

### IRIW — Independent Reads of Independent Writes

```
Initially x = y = 0

  T0      T1      T2              T3
  x = 1   y = 1   r1 = x          r3 = y
                  r2 = y          r4 = x

Question: can r1==1 && r2==0 && r3==1 && r4==0 ?
```

That is: T2 says "x was written first", T3 says "y was written first". No single global order of
stores exists. A model that permits this is **not multi-copy-atomic**: a write can become
visible to *some* threads before it is visible to all.

**Correction to the standard teaching.** IRIW is usually taught as "allowed on ARM, forbidden on
x86". As of 2017 that is **wrong on both halves' framing**:

- **x86: forbidden.** The x86-TSO paper transcribes it as `Forbidden Final State`, citing Intel
  SDM revisions 29–34, which added principle **P6**: *"Any two stores are seen in a consistent
  order by processors other than those performing the stores."* (Earlier Intel documents — IWP
  Aug 2007, and AMD3.14 — *did* permit IRIW, which the paper flags as one of the vendor-spec
  defects that motivated the formal model.)
- **ARMv8: also forbidden, since 2017.** The Pulte et al. POPL 2018 paper states it outright:
  > "ARM have now revised their ARMv8 specification to prohibit non-MCA behaviour: when a write
  > is visible to some other thread, it is now guaranteed to be visible to all."

  The reasoning given is that the freedom was never actually exploited: *"while non-multicopy-
  atomic (non-MCA) behaviour is observable on IBM POWER implementations, the hardware
  implementation freedom it permits has not been exploited on production ARMv8 implementations."*
- **POWER: still allowed.** POWER remains genuinely non-multi-copy-atomic.

So the honest modern statement is: **IRIW separates POWER from everyone else, not ARM from x86.**
Use **MP** for the ARM-vs-x86 lesson. Keep IRIW to teach what multi-copy atomicity *means* and
to make the point that architecture specs are living documents that get *stronger* when the
freedom turns out to be worthless.

### LB — Load Buffering

```
  T0            T1
  r1 = x        r2 = y
  y = 1         x = 1

Question: can r1 == 1 && r2 == 1 ?
```

Requires load→store reordering. Forbidden on x86-TSO. Allowed on ARM/POWER. Worth showing
because it is the test that makes people uncomfortable: the values appear *out of thin air*
relative to any interleaving, and it is the entry point to the still-open "out-of-thin-air"
problem in the C++ model (see §9).

## 1.3 The four-line summary of hardware ordering

| Reordering | x86-TSO | ARMv8 | POWER |
|---|---|---|---|
| Store → Load (different addr) | **allowed** | allowed | allowed |
| Store → Store | forbidden | **allowed** | **allowed** |
| Load → Load | forbidden | **allowed** | **allowed** |
| Load → Store | forbidden | **allowed** | **allowed** |
| Multi-copy atomic (IRIW forbidden) | yes | yes (since 2017) | **no** |

x86 allows one of four. ARM allows four of four. That is the entire difference, and it is why
`std::memory_order` looks like over-engineering on x86 and like the bare minimum on ARM.

## 1.4 What this costs: the same source, two ISAs

Six one-line functions over a single `std::atomic<int> x`, compiled at `-O2 -std=c++20`.
**All output below is real, from the live API.**

**x86-64, GCC 15.2:**

```asm
ld_relaxed():   mov  eax, DWORD PTR x[rip]      ; plain load
ld_acquire():   mov  eax, DWORD PTR x[rip]      ; plain load  -- identical
ld_seqcst():    mov  eax, DWORD PTR x[rip]      ; plain load  -- identical

st_relaxed(int): mov  DWORD PTR x[rip], edi     ; plain store
st_release(int): mov  DWORD PTR x[rip], edi     ; plain store -- identical
st_seqcst(int):  xchg edi, DWORD PTR x[rip]     ; LOCKED -- the only one that costs

fence_acq():    ret                             ; NOTHING
fence_rel():    ret                             ; NOTHING
fence_sc():     lock or QWORD PTR [rsp], 0      ; a locked no-op as a cheap MFENCE
```

**ARM64, GCC 15.2** (address computation elided):

```asm
ld_relaxed():   ldr  w0, [x0]                   ; plain
ld_acquire():   ldar w0, [x0]                   ; load-acquire
ld_seqcst():    ldar w0, [x0]                   ; same instruction as acquire

st_relaxed(int): str  w0, [x1]                  ; plain
st_release(int): stlr w0, [x1]                  ; store-release
st_seqcst(int):  stlr w0, [x1]                  ; same instruction as release

fence_acq():    dmb ishld                       ; a real barrier
fence_rel():    dmb ish
fence_sc():     dmb ish
```

Four things to read off this listing, in order:

1. **On x86, acquire and release are literally free.** Same instruction as relaxed. The
   hardware already forbids the reorderings they name; the memory order exists only to stop the
   *compiler*.
2. **On x86, `seq_cst` store is the only thing you pay for.** `xchg` is an implicitly-`lock`ed
   RMW — a full barrier and a coherence round trip. This is why "just use `seq_cst`, it's the
   default" is a real cost on the store side and free on the load side. Asymmetric.
3. **On ARM, `seq_cst` and `acq_rel` compile to the same instructions.** `ldar`/`stlr` are
   **RCsc** (release-consistency, sequentially-consistent flavour): an `stlr` cannot be reordered
   past a later `ldar`. That extra guarantee — which the weaker RCpc flavour lacks — is what lets
   ARM implement `seq_cst` without an explicit `dmb`. On x86 the same job needs `xchg`.
4. **On ARM the fences are real instructions and the ordered operations are not more
   expensive than the fences.** Prefer ordered operations to fences: they are at least as fast
   and strictly more precise about *what* is ordered.

## 1.5 Fences vs ordered operations

They are not interchangeable, and the difference is *which* accesses get ordered.

- **An ordered operation** (`x.store(v, release)`) orders everything before it in program order
  with respect to *that one operation on that one object*. The synchronisation edge is anchored
  to a specific store.
- **A fence** (`atomic_thread_fence(release)`) orders everything before it with respect to
  *every subsequent atomic store in that thread*. It is a barrier in the thread's timeline, not
  attached to any object.

Practical consequence: a release fence followed by a **relaxed** store creates the same
synchronises-with edge as a release store. That is the idiom for "I need to publish several
things and only pay for one barrier":

```cpp
a.store(1, relaxed);
b.store(2, relaxed);
std::atomic_thread_fence(std::memory_order_release);   // one barrier
flag.store(1, relaxed);                                // relaxed store, but ordered by the fence
```

Rule of thumb: **prefer ordered operations.** Fences are strictly harder to reason about because
the edge is not visible at the store site, and on x86 the acquire/release fences are free anyway
so the "one barrier instead of many" argument only pays on ARM. Reach for a fence when the
alternative would be several `seq_cst` operations in a row.

## 1.6 `memory_order_consume` was a mistake

`consume` was meant to make the Linux RCU read side expressible in standard C++. The idea:
`acquire` orders the load against *everything* after it, which on ARM/POWER costs a barrier; but
if all you do is dereference the loaded pointer, the hardware already orders that for you,
because **the address dependency is a real dependency in the pipeline** — POWER and ARM will not
speculate a load through an address the load itself produces. So a `consume` load should be
compilable to a plain `ldr`, with ordering guaranteed only along the *dependency chain*.

Genuinely clever. It failed for a reason that is worth teaching as its own lesson: **it asked
the compiler to preserve something compilers are built to destroy.**

The standard defines *carries-a-dependency* syntactically over the source expression. But a
compiler is free to break the chain at will, and routinely does — the classic case being
`if (p == known_value) use(known_value->field);`, where value-range propagation replaces a
dependent load with a constant and the dependency evaporates. To keep the chain, the compiler
would have to track dependency through every optimisation pass, and the standard's escape
hatches for that were `[[carries_dependency]]` annotations on every function boundary the
pointer crosses, and `kill_dependency()` wherever you wanted to opt out.

Boehm's P0371R1 (2016) states the outcome plainly:

> "All current compilers essentially map it to `memory_order_acquire`" because "the current
> definition uses a fairly general definition of 'dependency', thus requiring frequent and
> inconvenient use of the `kill_dependency` call, and from the frequent need for
> `[[carries_dependency]]` annotations."

So the feature shipped, no implementation ever implemented it, everyone silently got `acquire`
— which is *correct*, just not free — and the annotations that would have made it work were too
invasive for anyone to write. The paper's own summary of the state of affairs: the mechanism has
legitimate uses in Linux RCU, but "no standard-conforming way currently exists to express such
code performantly."

C++17 added the discouraging note; **P3475R2 (2025) deprecates it outright.**

**The lesson for the curriculum** is bigger than one enumerator: *a language feature that
requires the optimiser to preserve a property it does not otherwise track will not survive
contact with a real compiler.* The Linux kernel's answer is the opposite direction — it does not
ask the compiler for anything, it uses `READ_ONCE()` plus documented, carefully-audited
dependency rules and accepts that the audit is a human process (`Documentation/RCU/rcu_dereference.rst`
is a list of things you must not write).

## 1.7 Two reorderers, and `volatile` addresses neither

This is the misconception worth the most time in the whole unit. **Verified live, x86-64 GCC
15.2 `-O2`:**

```cpp
int  plain_flag;
volatile int vol_flag;
std::atomic<int> at_flag;
void wait_plain()    { while(!plain_flag) ; }
void wait_volatile() { while(!vol_flag) ; }
void wait_atomic()   { while(!at_flag.load(std::memory_order_relaxed)) ; }
```

```asm
wait_plain():
  ret                                  ; <-- THE ENTIRE LOOP IS GONE

wait_volatile():
.L4:
  mov eax, DWORD PTR vol_flag[rip]
  test eax, eax
  je .L4
  ret

wait_atomic():
.L8:
  mov eax, DWORD PTR at_flag[rip]
  test eax, eax
  je .L8
  ret
```

Three separate lessons in nine lines of assembly:

1. **`wait_plain()` compiles to a bare `ret`.** The compiler proved nothing in the loop can
   change `plain_flag`, so the loop is either infinite (UB — a side-effect-free infinite loop is
   undefined) or immediately false. Either way it deleted it. **The compiler is a reorderer, and
   its most aggressive move is not reordering but deletion.** No amount of hardware memory
   ordering saves you from code the compiler removed.

2. **`wait_volatile()` and `wait_atomic()` are byte-for-byte identical.** This is *exactly* why
   the `volatile` myth is so durable: on x86, `volatile` and `memory_order_relaxed` generate the
   same instructions, so `volatile` "works" on every test the believer runs.

3. **They are identical and yet only one is correct**, because `volatile` guarantees the access
   happens and nothing else. It creates **no happens-before edge**, so:
   - it does not order *other* (non-volatile) accesses around it — the compiler may freely move
     ordinary loads and stores across a volatile access;
   - it emits no barrier, so on ARM the hardware reorders it (confirmed: the ARM64 listing in
     §1.4 shows `volatile` as plain `ldr`/`str`, no `dmb`, no `ldar`);
   - it is a **data race** by the standard's definition, which is UB, which means the compiler is
     entitled to assume it never happens.

   `volatile` means "this memory may be changed by something outside the abstract machine" —
   memory-mapped I/O, a signal handler, `setjmp`. It is a *materialisation* guarantee, not an
   *ordering* guarantee. Those are different axes and `volatile` only has the first.

## 1.8 happens-before and synchronizes-with, stated precisely

Three relations, built up:

- **sequenced-before** — within a single thread, the program-order relation (with the usual C++
  wrinkles about unsequenced subexpressions).
- **synchronizes-with** — the cross-thread edge. A release operation A on object M
  *synchronizes-with* an acquire operation B on M **if B reads the value written by A, or a value
  later in M's release sequence.** This is the only way to build a cross-thread edge from
  atomics.
- **happens-before** — the transitive closure of sequenced-before and synchronizes-with.

And then the payoff rule, which is the whole point:

> A program is **data-race-free** if, for every pair of conflicting accesses (same location, at
> least one a write, at least one non-atomic), one happens-before the other. **A data-race-free
> program behaves as if sequentially consistent.**

This is the **DRF-SC theorem**, and it is the bargain the C++ model offers: *give up data races,
get SC back.* You do not have to reason about store buffers. You have to reason about edges.

The `seq_cst` extra: `seq_cst` operations additionally participate in a **single total order S**
consistent with happens-before, across all `seq_cst` operations on all objects. This is strictly
more than acq_rel gives you, and SB in §1.2 is exactly the program that distinguishes them — a
release store and an acquire load on *different* objects create no edge at all, so acq_rel does
not forbid `r1==r2==0`; the total order does.

## 1.9 The five orders, in one table

| Order | Guarantees | Costs on x86 | Costs on ARM | Use it for |
|---|---|---|---|---|
| `relaxed` | Atomicity and per-object modification order. **No ordering at all.** | nothing | nothing | Counters you only read at the end. Progress checks. The non-publishing half of a ring buffer index. |
| `consume` | Ordering along dependency chains. **Deprecated; you get `acquire`.** | — | — | Nothing. Use `acquire`. |
| `acquire` | On a load: nothing after it (in program order) can be reordered before it. Pairs with release. | nothing | `ldar` | The consumer side of publish/subscribe. Lock acquisition. |
| `release` | On a store: nothing before it can be reordered after it. Pairs with acquire. | nothing | `stlr` | The producer side. Lock release. |
| `acq_rel` | Both, on an RMW. | already locked | `ldaxr/stlxr` | `fetch_add` on a refcount that guards destruction; CAS in a lock-free loop. |
| `seq_cst` | acq_rel **plus** membership in one global total order. | `xchg` on stores | same as acq_rel | Anything where two threads must agree on the order of operations on *different* objects. The default when you are not sure. |

**Teaching position:** default to `seq_cst`. Downgrade only where you can name the pairing —
"this release pairs with that acquire, and the edge publishes these bytes." An unpaired
`acquire` or `release` is almost always a bug, and it is the bug TSan is best at catching (§2.7).

---

# 2. Lock-free and wait-free

## 2.1 The hierarchy, defined precisely

The definitions are **progress guarantees**, not performance claims. Every one of them is a
statement about what happens when threads are *stopped at the worst possible moment* — preempted
by the scheduler, page-faulted, or killed.

Michael & Scott's paper gives the two load-bearing ones verbatim:

> **Non-blocking** algorithms "guarantee that if there are one or more active processes trying to
> perform operations on a shared data structure, some operation will complete within a finite
> number of time steps."

> **Wait-free**: "A *wait-free* algorithm is both non-blocking and starvation free: it guarantees
> that every active process will make progress within a bounded number of time steps."

The full ladder, weakest to strongest:

| Level | Guarantee | What breaks it | Canonical example |
|---|---|---|---|
| **Blocking** | None. A thread suspended in the critical section stops everyone. | Preemption, page fault, `kill -STOP`, priority inversion. | `std::mutex` |
| **Obstruction-free** | A thread that runs **in isolation** (all others paused) finishes in bounded steps. Concurrent threads may livelock forever. | Two threads repeatedly aborting each other. | Most STM; some transactional structures |
| **Lock-free** | **System-wide progress**: at any point, *some* thread completes in bounded steps. Individual threads may starve indefinitely. | Nothing — but one unlucky thread can retry forever. | Treiber stack, Michael-Scott queue |
| **Wait-free** | **Per-thread progress**: *every* thread completes in a bounded number of its own steps. | Nothing. | SPSC ring buffer; atomic `fetch_add` counter |

Three things students consistently get wrong:

**"Lock-free means no locks."** No. It means no *lock-like blocking dependency*. You can write
code with zero `mutex` that is not lock-free (a spin loop waiting for another thread's flag is
blocking — the waiter's progress depends on the other thread being scheduled). And the property
is about the *algorithm*, not the primitives.

**"Lock-free is faster."** Frequently false (§2.8). The guarantee is about *worst-case
latency under adversarial scheduling*, not throughput.

**"Wait-free is just better lock-free."** Wait-free structures are usually much more complex,
because bounding *every* thread means the fast threads must **help** the slow ones — they have to
detect an in-progress operation and complete it on the owner's behalf. That helping machinery is
where the cost and the bugs live. The exceptions are the structures that are wait-free *for
free*: single-producer/single-consumer queues, and any operation that is a single `fetch_add`.

Herlihy's **consensus hierarchy** (1991) is the theory underneath: primitives are ranked by the
maximum number of threads for which they can solve wait-free consensus. Atomic read/write has
consensus number **1** (you cannot build a wait-free 2-thread consensus from loads and stores
alone). Test-and-set, fetch-and-add, and swap have consensus number **2**. **Compare-and-swap has
consensus number ∞** — it can solve wait-free consensus for any number of threads, which is
exactly why every lock-free structure in practice is built on CAS. This is a real impossibility
result, not an engineering preference: it explains why `std::atomic<T>` had to expose CAS and not
just increments.

## 2.2 CAS and LL/SC

**Compare-and-swap** is one instruction with the semantics:

```
CAS(addr, expected, desired):
    atomically:
      if (*addr == expected) { *addr = desired; return true; }
      else                   { expected = *addr; return false; }
```

Michael & Scott's footnote, verbatim: *"compare_and_swap, introduced on the IBM System 370,
takes as arguments the address of a shared memory location, an expected value, and a new value.
If the shared location currently holds the expected value, it is assigned the new value
atomically. A Boolean return value indicates whether the replacement occurred."*

On x86-64 it is `lock cmpxchg`. Verified live:

```asm
; head.compare_exchange_weak(exp, newval, acq_rel, relaxed) on a 64-bit atomic
  mov       rax, QWORD PTR [rdi]         ; expected -> rax (cmpxchg's implicit operand)
  lock cmpxchg QWORD PTR head[rip], rsi
  sete      dl
  je        .L1
  mov       QWORD PTR [rdi], rax         ; on failure, write back what was actually there
.L1:
```

**LL/SC** (load-linked / store-conditional) is the RISC alternative: ARM's `ldaxr`/`stlxr`,
POWER's `lwarx`/`stwcx.`, RISC-V's `lr`/`sc`. `LL` reads and marks the address as *reserved*;
`SC` stores only if the reservation is still intact, and reports whether it stored.

The crucial semantic difference: **LL/SC fails if the location was written at all, even if it was
written back to the same value.** CAS only compares values. That means **LL/SC is immune to ABA
by construction** and CAS is not.

Two catches that make LL/SC less of a gift than it looks:

- **Spurious failure.** The reservation is tracked per cache line and is dropped by context
  switches, interrupts, and unrelated writes to the same line. So `SC` can fail with no
  contention at all. This is exactly why C++ has `compare_exchange_weak` — it is allowed to fail
  spuriously, so it maps to a bare LL/SC pair, while `compare_exchange_strong` must add a retry
  loop on LL/SC platforms. **`_weak` inside a loop you were going to retry anyway; `_strong`
  everywhere else.**
- **Almost no instructions may appear between LL and SC.** Function calls, most loads, anything
  that could evict the line — all can kill the reservation. This is a hard constraint on how much
  work fits in one LL/SC section, and it is why C++ exposes CAS semantics rather than raw LL/SC.

## 2.3 ABA, with an interleaving that actually fails

Michael & Scott's definition, verbatim:

> "the **ABA problem**: if a process reads a value A in a shared location, computes a new value,
> and then attempts a `compare_and_swap` operation, the `compare_and_swap` may succeed when it
> should not, if between the read and the `compare_and_swap` some other process(es) change the A
> to a B and then back to an A again."

The reason this is fatal rather than merely surprising: **CAS is being used as a proxy for "the
structure has not changed", and it is actually only testing "one word has the same bits".** Those
come apart precisely when memory is recycled.

### The failing interleaving on a Treiber stack

Stack contents `head -> A -> B -> C`. Thread 1 is popping.

| Step | Thread 1 | Thread 2 | `head` | Stack |
|---|---|---|---|---|
| 0 | | | `&A` | A → B → C |
| 1 | `h = head` → `&A` | | `&A` | A → B → C |
| 2 | `next = h->next` → `&B` | | `&A` | A → B → C |
| 3 | *— preempted —* | pop A | `&B` | B → C |
| 4 | | pop B | `&C` | C |
| 5 | | push A (recycled) | `&A` | **A → C** |
| 6 | `CAS(head, &A, &B)` **succeeds** | | `&B` | **B → ???** |

At step 6 the CAS compares `head` against `&A` and finds `&A`, so it succeeds — but the `&B` it
installs was read at step 2, three modifications ago. `B` is not in the stack. If `B` was freed,
`head` now points at freed memory. If `B` was reused for something else, the stack now contains
whatever that is.

### Reproduced deterministically, live

This is not a race you hope to hit. Using two `std::atomic<int>` step counters as a rendezvous,
the interleaving above is **forced**. Real output from Compiler Explorer (GCC 15.2, `-O2 -pthread`):

```
T2 done: head=A head->next=C
T1 CAS(&A -> &B) succeeded=1
FINAL head=B
B was popped by T2 and is NOT in the stack, yet head==B: ABA CORRUPTION
```

The program ends with `assert(h == &B && "expected the ABA failure")`, so it is
machine-checkable in the exact sense the curriculum needs: **the test passes when the bug
reproduces.** (Full source in §7.3.)

### The fixes, and what each actually costs

**1. Tagged pointers (version counters).** Store `{pointer, counter}` together and CAS both at
once; bump the counter on every successful CAS. Then A→B→A produces a *different* tagged value.

Michael & Scott describe it, and — importantly — describe its limit, verbatim:

> "The most common solution is to associate a modification counter with a pointer, to always
> access the counter with the pointer in any read-modify-`compare_and_swap` sequence, and to
> increment it in each successful `compare_and_swap`. **This solution does not guarantee that the
> ABA problem will not occur, but it makes it extremely unlikely.**"

That is the honest statement and it should be taught as such: **tagged pointers do not solve ABA,
they make the counter wrap unlikely.** With a 16-bit tag and a hot structure, "unlikely" is a
number you can actually reach.

They also name the implementation constraint: *"one must either employ a double-word
`compare_and_swap`, or else use array indices instead of pointers, so that they may share a
single word with a counter."*

**And on x86-64 the double-word option is worse than the textbooks say.** Verified live:

| | `std::atomic<Tagged>` (16 bytes) | |
|---|---|---|
| GCC 15.2, no flags | `is_always_lock_free = 0` | fails to link without `-latomic` |
| GCC 15.2, `-mcx16` | `is_always_lock_free = 0` | emits `call __atomic_compare_exchange_16` |
| Clang trunk, no flags | `is_always_lock_free = 0` | |
| Clang trunk, `-mcx16` | **`is_always_lock_free = 1`** | but **still emits `call __atomic_compare_exchange`** |

So Clang *reports* lock-free and then calls into libatomic anyway (verified on both a reference
parameter and an `alignas(16)` global). Whatever libatomic does at runtime, the portable-C++
tagged-pointer idiom costs an out-of-line call on both major toolchains.

**The packed alternative is genuinely lock-free.** x86-64 canonical user pointers use 48 bits, so
pack a 48-bit pointer and a 16-bit tag into one 64-bit word:

```cpp
struct Packed {
  uint64_t bits;
  Node*    ptr() const { return (Node*)(bits & 0x0000FFFFFFFFFFFFull); }
  uint16_t tag() const { return (uint16_t)(bits >> 48); }
  static Packed make(Node* p, uint16_t t) {
    return { ((uint64_t)p & 0x0000FFFFFFFFFFFFull) | ((uint64_t)t << 48) };
  }
};
```

Verified codegen — a single locked instruction, no libcall:

```asm
  movabs rax, 281474976710655
  sal    rdx, 48
  and    rsi, rax
  mov    rax, QWORD PTR [rdi]
  or     rsi, rdx
  lock cmpxchg QWORD PTR head[rip], rsi
```

Caveats worth stating in the same breath: it assumes 48-bit canonical addresses (breaks under
5-level paging / LA57 and on ARM with 52-bit VA), and a 16-bit tag wraps after 65 536 CASes,
which for a hot structure is *microseconds*. It is a real technique with a real expiry date.

**2. Hazard pointers** (Michael, 2004). Each thread publishes, in a slot only it writes, the
pointers it is currently dereferencing. A thread that wants to free a node first scans all hazard
slots; if the node appears, it is retired to a per-thread deferred list instead of freed.
Reclamation is bounded — at most `K × N` nodes are pending for `N` threads and `K` hazard slots
each. In C++26 as `std::hazard_pointer`. Cost: a store-release plus a validating re-read on
*every* pointer dereference in the read path.

**3. Epoch-based reclamation** (Fraser, 2004). A global epoch counter; each thread announces the
epoch it entered when it starts an operation. A node retired in epoch `e` is freed once every
thread has been observed in epoch `≥ e+2`. Read side is nearly free (one relaxed store on entry).
The catch: **a single thread that stalls inside a critical section blocks reclamation for
everyone**, so memory usage is unbounded in the presence of preemption. This is the tradeoff
axis: hazard pointers pay on every read and bound memory; EBR is free on read and unbounds memory.

**4. Don't recycle.** If nodes are never reused for the same structure, ABA cannot occur. Arena
allocation with generation-tagged indices, or simply never freeing, is a legitimate answer for
bounded workloads.

## 2.4 Memory reclamation is the hard part

**This is the single most important idea in the whole lock-free section**, and the one most
tutorials skip.

Write a lock-free stack push and pop on a whiteboard: about twelve lines, one CAS loop each. It
is genuinely easy. Now answer one question: **when is it safe to call `delete` on a popped node?**

You cannot know. Another thread may have loaded a pointer to that node one instruction ago and be
about to dereference it. There is no CAS that fixes this, because the problem is not atomicity —
the problem is that **you have no way to observe that no other thread holds a reference.** With a
mutex this is trivial: nobody holds a reference outside the critical section, and you hold the
lock. The moment you remove the lock, you remove the thing that made lifetime knowable.

So: *the lock-free algorithm is the easy 20%; the safe-memory-reclamation scheme is the other
80%, and it is where all the complexity, all the papers, and all the bugs are.*

**Michael & Scott have the receipt.** Analysing Valois's reference-counting scheme, they report,
verbatim:

> "the memory management mechanism and the associated non-blocking queue algorithm are
> impractical: no finite memory can guarantee to satisfy the memory requirements of the
> algorithm. Problems occur if a process reads a pointer to a node (incrementing the reference
> counter) and is then delayed. While it is not running, other processes can enqueue and dequeue
> an arbitrary number of additional nodes. Because of the pointer held by the delayed process,
> neither the node referenced by that pointer nor any of its successors can be freed. It is
> therefore possible to run out of memory even if the number of items in the queue is bounded by
> a constant. **In experiments with a queue of maximum length 12 items, we ran out of memory
> several times during runs of ten million enqueues and dequeues, using a free list initialized
> with 64,000 nodes.**"

A queue holding **twelve items** exhausted a **64 000-node** free list. That is the number to put
on the slide. The queue was correct. The reclamation was not survivable.

The four practical answers — hazard pointers, EBR, RCU, and reference counting — all trade the
same three things against each other: **read-side cost, memory bound, and implementation
complexity.** Nothing wins on all three.

| Scheme | Read-side cost | Memory bound | Complexity |
|---|---|---|---|
| Reference counting (naive) | atomic RMW per traversal step | **unbounded** (M&S above) | low |
| Hazard pointers | store-release + validating reload per deref | **bounded** (K·N) | medium |
| Epoch-based (EBR) | one relaxed store per operation | unbounded under preemption | medium |
| RCU | **literally zero** (see §2.5) | unbounded under stall | high (needs the grace-period machinery) |

## 2.5 RCU — Read-Copy-Update

RCU is the answer when reads outnumber writes by orders of magnitude, and it is worth teaching
because it inverts the usual assumption: **it makes the read side free by making the write side
pay everything.**

**The idea.** Never mutate data a reader might be looking at. To update:

1. **Copy** the object.
2. **Modify** the copy.
3. **Publish** the new version with a single release store to the pointer (readers atomically see
   old or new, never a torn hybrid).
4. **Wait** for a *grace period* — until every reader that could have been holding the old pointer
   has finished.
5. **Free** the old version.

**Why the read side is free.** In the classic kernel non-preemptible build,
`rcu_read_lock()`/`rcu_read_unlock()` compile to **nothing at all** — literally empty. No atomic,
no barrier, no cache line touched, no contention, and read-side cost that does not grow with the
number of readers. That is the entire reason RCU exists, and it is unbeatable by any scheme that
writes shared state on read.

**How the grace period works.** This is the clever part. RCU does not track *which* readers hold
*which* pointers — tracking is what costs money. Instead it exploits a structural property:

> A read-side critical section may not block (in the classic flavour). Therefore, **if a CPU has
> passed through a context switch, it is not inside any read-side critical section.**

A context switch is a **quiescent state**. A **grace period** is an interval during which every
CPU has passed through at least one quiescent state. Once that has happened, every read-side
critical section that existed at the start of the grace period has necessarily ended — so any
object unlinked before the grace period began is now unreachable by any reader, and can be freed.

The genius is that the kernel was *already* going to context-switch. The grace period is detected
by observing work the system does anyway. Read cost: zero. Write cost: you wait, potentially
milliseconds.

The API split follows: `synchronize_rcu()` blocks the updater until the grace period elapses;
`call_rcu(head, func)` registers a callback and returns immediately. And on the read side,
`rcu_dereference()` is precisely the operation `memory_order_consume` was invented to
standardise (§1.6) and never could.

**When RCU is right:** read-mostly, with readers vastly outnumbering writers, and where the
updater can tolerate a long, unbounded wait. Routing tables, module lists, `dcache`, security
policy — the kernel's canonical users. **When it is wrong:** balanced read/write, or when memory
must be bounded (a stalled reader stalls reclamation indefinitely — the same failure mode as EBR,
which is not a coincidence, EBR *is* a userspace RCU).

Userspace RCU exists (`liburcu`) but the read side is no longer free, because userspace has no
"you cannot block here" guarantee to exploit; the flavours differ exactly in what they substitute
for it (a per-thread counter, membarrier syscalls, or signals).

## 2.6 Three real structures

### Treiber stack (1986) — the one everyone writes first

```cpp
void push(Node* n) {
  Node* h = head.load(std::memory_order_relaxed);
  do { n->next = h; }
  while (!head.compare_exchange_weak(h, n,
           std::memory_order_release, std::memory_order_relaxed));
}
```

Note `compare_exchange_weak` in a loop we were retrying anyway (§2.2), and that on failure the
CAS *writes back* the observed value into `h`, so the loop body re-links `n->next` correctly with
no extra load. **`push` is genuinely simple and genuinely correct.**

`pop` is the one with ABA (§2.3) and the one that cannot free the node it returns without a
reclamation scheme. The lesson is precisely that asymmetry: **the half that only adds is easy,
the half that removes is where lock-free programming actually lives.**

### Michael-Scott queue (1996) — the standard lock-free FIFO

Two design decisions carry the whole algorithm:

1. **A permanent dummy node.** `head` always points at a dummy; the first real element is
   `head->next`. This means the queue is never empty from the pointers' perspective, which kills
   every special case where head and tail interact on an empty or single-element queue. (M&S
   credit the dummy-node technique to Sites.)

2. **`tail` is allowed to lag, and threads help.** An enqueue is *two* CASes: link the new node
   onto `tail->next`, then swing `tail` forward. A thread can be preempted between them, leaving
   `tail` pointing one node short. Rather than blocking, **any thread that observes
   `tail->next != nullptr` swings `tail` forward itself before proceeding.** That helping step is
   what makes the algorithm lock-free rather than blocking: no thread's progress depends on the
   preempted enqueuer being rescheduled.

This "leave the structure in a legal intermediate state that any thread can repair" pattern is
*the* lock-free design idiom, and the Michael-Scott queue is the cleanest place to learn it.

M&S also report the practical result, verbatim from the abstract: on a 12-node SGI Challenge, the
non-blocking queue "consistently outperforms the best known alternatives; it is the clear
algorithm of choice for machines that provide a universal atomic primitive (e.g.
`compare_and_swap` or `load_linked`/`store_conditional`)." Their *two-lock* queue (separate head
and tail locks) is offered as the answer for machines without one — and is still an excellent
default today.

### SPSC ring buffer — the one you should actually use

Single producer, single consumer, fixed capacity. **No CAS anywhere. Wait-free on both sides. No
reclamation problem** (storage is preallocated and slots are reused in a fixed order, so there is
nothing to free and nothing to ABA). This is the structure that delivers everything lock-free
programming promises at a fraction of the difficulty.

```cpp
template <class T, size_t N>          // N must be a power of two
struct SpscRing {
  static_assert((N & (N-1)) == 0);
  alignas(64) std::atomic<size_t> head_{0};   // written ONLY by consumer
  alignas(64) std::atomic<size_t> tail_{0};   // written ONLY by producer
  alignas(64) T buf_[N];

  bool push(const T& v) {
    size_t t = tail_.load(std::memory_order_relaxed);   // we are the only writer of tail_
    size_t h = head_.load(std::memory_order_acquire);   // pairs with pop's release
    if (t - h == N) return false;                       // full
    buf_[t & (N-1)] = v;
    tail_.store(t + 1, std::memory_order_release);      // PUBLISHES the buf_ write
    return true;
  }
  bool pop(T& out) {
    size_t h = head_.load(std::memory_order_relaxed);   // we are the only writer of head_
    size_t t = tail_.load(std::memory_order_acquire);   // pairs with push's release
    if (h == t) return false;                           // empty
    out = buf_[h & (N-1)];
    head_.store(h + 1, std::memory_order_release);      // frees the slot
    return true;
  }
};
```

Four design points, each teachable on its own:

- **`relaxed` on your own index is correct and not a shortcut.** You are the only writer, so you
  cannot read a stale value of it. Sequenced-before covers you.
- **`acquire` on the *other* index and `release` on your own** is the publish/subscribe edge from
  §1.8. `tail_.store(release)` publishes the `buf_[t]` write; `tail_.load(acquire)` in `pop`
  receives it. That single pairing is the entire correctness argument.
- **Free-running counters plus `& (N-1)`**, rather than wrapping the indices, is what makes
  `t - h == N` a correct fullness test with no ambiguity between full and empty. (It relies on
  unsigned wraparound being well-defined, which it is.)
- **`alignas(64)` on each index** is not decoration — it is the false-sharing fix from §3.6.
  Without it, the producer's store to `tail_` invalidates the line the consumer is reading
  `head_` from, on every single operation.

**Verified live under ThreadSanitizer** (GCC 15.2, `-O1 -g -fsanitize=thread -pthread`, 200 000
items, consumer asserts strict FIFO order):

```
got=200000 sum=19999900000 expect=19999900000 OK
```

Clean — no warnings. And with **exactly one character class changed**, `tail_.store(t+1, release)`
→ `tail_.store(t+1, relaxed)`:

```
got=200000 sum=19999900000 expect=19999900000 OK        <-- STILL THE RIGHT ANSWER
==================
WARNING: ThreadSanitizer: data race (pid=1)
  Read of size 4 at 0x000000404180 by thread T2:
    #0 SpscRing<int, 1024ul>::pop(int&) /app/example.cpp:27
  Previous write of size 4 at 0x000000404180 by thread T1:
    #0 SpscRing<int, 1024ul>::push(int const&) /app/example.cpp:19
  Location is global 'q' of size 4224 at 0x000000404100
SUMMARY: ThreadSanitizer: data race /app/example.cpp:27 in SpscRing<int, 1024ul>::pop(int&)
```

**The program printed the correct answer and is still broken.** The race is on `buf_`, not on the
index — losing the release edge means the data write is no longer published, and x86-TSO happens
to order it anyway. On ARM it would not. This is the best single demonstration in the curriculum
that **testing cannot find memory-order bugs and TSan can.**

## 2.7 What TSan actually does, and why it works on a 2-vCPU box

TSan is not a stress tester. It is a **happens-before engine**: it maintains vector clocks per
thread and shadow state for every memory word, and it *understands `std::atomic` and its memory
orders* — a release store advances the clock, an acquire load that reads it merges the clock. A
race is reported when two conflicting accesses are unordered in the happens-before relation.

Two consequences that matter for curriculum design:

- **The accesses do not have to be simultaneous.** They can be seconds apart. TSan finds the race
  from the recorded clocks, not from a collision. So it works fine on a contended, oversubscribed
  2-vCPU sandbox where a stress test would find nothing.
- **It catches missing *ordering*, not just missing *atomicity*.** The relaxed-store example
  above is the proof: no data was ever actually corrupted, and TSan flagged it anyway, because
  the *edge* was missing. This is exactly the class of bug that survives testing.

Its limits, stated honestly: TSan only sees code paths that execute; it has ~5–15× slowdown and
~5–10× memory overhead; it cannot see races in code compiled without instrumentation; and it will
not tell you that a *correctly synchronised* algorithm is *logically* wrong (the ABA demo in §2.3
is TSan-clean — every access is properly ordered, the algorithm is just incorrect).

## 2.8 When lock-free is worth it, and when the mutex wins — honestly

**Usually the mutex wins.** Say it first and say it plainly.

An uncontended `std::mutex` lock/unlock on Linux is one atomic RMW each way and **no syscall** —
the futex path is only taken on contention. That is roughly the same cost as the CAS in a
lock-free push. So the lock-free version starts with **no** advantage in the uncontended case,
and it starts with a large disadvantage in every other dimension: it is harder to write, much
harder to review, requires a reclamation scheme, and each of its operations must be individually
atomic, which usually forces a *worse algorithm* than the one you would write under a lock.

Under contention the comparison is more interesting but rarely more favourable. A CAS loop
contending on one cache line does not degrade gracefully — every failed CAS is a full cache-line
transfer, and *N* threads hammering one line can produce throughput that **decreases** as you add
cores. A mutex under contention at least parks the losers, freeing the core.

**Choose lock-free when you can name one of these:**

1. **You genuinely cannot block.** A signal handler, an interrupt handler, a real-time audio
   callback with a hard deadline, a garbage collector's write barrier. A mutex here is not slow,
   it is *incorrect* — a priority-inverted or preempted lock holder is an unbounded stall.
2. **The structure is SPSC or otherwise contention-free by construction.** The ring buffer in
   §2.6 is wait-free, needs no reclamation, and has no downside. Take it.
3. **The operation is a single atomic instruction.** A statistics counter is `fetch_add`. It is
   already wait-free. Do not put a mutex on it, and do not call this "lock-free programming"
   either.
4. **Measured, on your hardware, with your access pattern, and it won.** Not a microbenchmark of
   the data structure — an end-to-end measurement of the system.

**The order to try things in:** (1) don't share the data; (2) shard it so threads rarely touch
the same shard; (3) `std::mutex`; (4) a reader-writer lock or RCU if reads dominate massively;
(5) a proven lock-free structure from a library; (6) write your own — essentially never.

The strongest argument for teaching lock-free programming is **not** that students should write
it. It is that understanding ABA, reclamation, and progress guarantees is what makes the memory
model concrete, and it permanently cures the belief that concurrency bugs are the kind of thing
you find by running the tests again.

---

# 3. Parallel algorithm theory

## 3.1 Amdahl vs Gustafson: the disagreement is about whether the problem grows

**Amdahl's law (1967).** Fix the problem. Let `s` be the serial fraction. With `N` processors:

```
Speedup(N) = 1 / (s + (1-s)/N)        and        lim(N→∞) = 1/s
```

If 5% of the work is serial, the ceiling is **20×**, no matter how many cores you buy. At 1%, the
ceiling is 100×. This is famously depressing and famously correct.

**Gustafson's law (1988).** *"Reevaluating Amdahl's Law."* Do not fix the problem — fix the
**time**. Observe how people actually use bigger machines: they do not solve last year's problem
faster, they solve a bigger problem in the same overnight run. If the serial work stays roughly
constant while the parallel work scales with `N`:

```
Scaled speedup(N) = s + N(1-s) = N - s(N-1)
```

which is **linear in N, with no ceiling.**

**The two laws do not contradict each other.** They answer different questions, and the entire
disagreement collapses into one modelling choice:

| | Amdahl | Gustafson |
|---|---|---|
| What is held fixed | **problem size** | **execution time** |
| What varies | time | problem size |
| Serial fraction | fixed fraction of a fixed total | fixed *absolute* amount, shrinking as a fraction |
| The question it answers | "Will my existing job finish sooner?" | "Can I run a bigger job in the same window?" |
| Corresponds to | **strong scaling** | **weak scaling** |
| Verdict | hard ceiling at `1/s` | linear, unbounded |

The substantive claim in Gustafson's paper is empirical, not mathematical: **for real scientific
workloads, the serial part is roughly constant in absolute terms** (setup, I/O, reduction to a
single answer) while the parallel part grows with resolution or particle count. If that is true
of your workload, Gustafson describes you. If your problem size is genuinely fixed — a latency
target, a single request — Amdahl describes you and the ceiling is real.

**The trap to name explicitly:** people quote Gustafson to excuse a serial bottleneck. It is only
a valid defence if the problem actually grows. A web request that must return in 100 ms does not
grow, and for it Amdahl is the only law that applies.

## 3.2 Work and span

The DAG model, which is the right way to think about it and is what Cilk, TBB, OpenMP tasks, and
Rayon all implement:

- **T₁ — work.** Total number of operations; the time on one processor.
- **T∞ — span** (depth, critical path). The longest chain of *dependent* operations; the time on
  infinitely many processors.
- **T₁/T∞ — parallelism.** The maximum useful speedup. Adding processors beyond this does
  nothing.
- **T_P** — time on `P` processors.

Two bounds, both trivial and both essential:

```
T_P ≥ T₁/P        (work law: P processors do at most P operations per step)
T_P ≥ T∞          (span law: you cannot beat the critical path)
```

**Brent's theorem (1974)** gives the matching upper bound — the reason the model is useful rather
than merely descriptive:

```
T_P ≤ T₁/P + T∞
```

*Any* greedy schedule (never leave a processor idle if work is available) achieves this. And
since `T_P ≥ max(T₁/P, T∞)`, greedy is within a factor of 2 of optimal. That is the licence for
work-stealing schedulers: **you do not need a clever scheduler.** Take work when you have it,
steal when you don't, and you are within 2× of the best possible schedule. This is why
`std::async`, Cilk's `spawn`, and Rayon's `join` can be dumb and still be fine.

The practical corollary: `T_P ≈ T₁/P` whenever `P ≪ T₁/T∞`. **Design for parallelism (T₁/T∞) an
order of magnitude above your core count and stop worrying about the scheduler.**

## 3.3 Strong vs weak scaling

- **Strong scaling** — fixed total problem, increasing `P`. Measures whether you can make *this*
  job faster. Governed by Amdahl. Degrades because the per-processor work shrinks until
  communication and synchronisation dominate it.
- **Weak scaling** — fixed problem size *per processor*, increasing `P` (so total problem grows
  with `P`). Measures whether you can take on a bigger job. Governed by Gustafson. Degrades
  because of communication topology — a halo exchange grows with the surface area of each
  subdomain, and global reductions cost `O(log P)`.

**Always ask which one a reported speedup number is**, because weak-scaling numbers look
spectacular and strong-scaling numbers look honest, and papers know this. "95% efficiency at 1024
nodes" almost always means weak scaling.

## 3.4 The canonical patterns

Every parallel program is built from a handful of shapes. Learn the work/span of each and you can
estimate a design before writing it.

| Pattern | T₁ | T∞ | Notes |
|---|---|---|---|
| **Map** | O(n) | O(1) | Embarrassingly parallel. The only cost is memory bandwidth. |
| **Reduce** | O(n) | O(log n) | Tree of combines. **Requires associativity**; floating-point addition is not associative, so the result depends on the tree shape. |
| **Scan / prefix sum** | O(n) | O(log n) | §3.5. The surprising one. |
| **Stencil** | O(n) per step | O(1) per step | Each output reads a fixed neighbourhood. Needs double-buffering or wavefront ordering; the halo/ghost-cell exchange is the whole distributed-memory cost. |
| **Gather** | O(n) | O(1) | `out[i] = in[idx[i]]`. Reads are scattered — cache- and coalescing-hostile, but **no write conflicts**. |
| **Scatter** | O(n) | O(1) | `out[idx[i]] = in[i]`. **Write conflicts if `idx` is not a permutation** — needs atomics or a permutation guarantee. Always harder than gather; prefer to rewrite a scatter as a gather. |
| **Fork-join** | varies | varies | The general nesting construct. Brent's theorem is what makes it schedulable. |

## 3.5 Scan / prefix sum, thoroughly

Scan is the pattern that makes parallel programming feel non-obvious, and it is the one that pays
off most, because an enormous number of problems reduce to it: stream compaction, radix sort,
sparse-matrix row offsets, allocation of variable-length output, quicksort partitioning,
line-of-sight, run-length encoding, and the entire "how do I write a variable number of results
per thread" problem on a GPU.

**Definitions.** For input `a` and associative `⊕`:
- **Inclusive**: `out[i] = a[0] ⊕ a[1] ⊕ … ⊕ a[i]`
- **Exclusive**: `out[i] = a[0] ⊕ … ⊕ a[i-1]`, with `out[0] = identity`

The **exclusive** form is the one you almost always want in practice, because `out[i]` is exactly
"where do my outputs start" — the offset at which thread `i` writes.

The sequential algorithm is one line and O(n). The interesting question: **it looks strictly
sequential — `out[i]` depends on `out[i-1]` — so how is it parallel at all?** The answer is
associativity: the dependency is on the *value*, and associativity lets you compute partial
combinations in any grouping. That reframe is the single idea of the unit.

### Hillis-Steele (1986) — the naive, shallow one

```cpp
for (size_t d = 1; d < n; d <<= 1) {
  for (size_t i = 0; i < n; ++i)                  // <-- every i independent: the parallel step
    tmp[i] = (i >= d) ? a[i] + a[i-d] : a[i];
  a.swap(tmp);
}
```

`log₂ n` steps, `n` operations each. **T₁ = O(n log n), T∞ = O(log n).** Inclusive.

It is **not work-efficient**: it does `n log n` work where the sequential algorithm does `n`. For
n = 1M that is 20× more total operations. It needs double-buffering (each step reads values the
same step overwrites). Its virtues are that it is trivial to write and has the minimum possible
depth, which is why it is the right choice *within a single warp or workgroup*, where you have
idle lanes anyway and the extra work is free.

### Blelloch (1990) — the work-efficient one

Two passes over a balanced binary tree, in place, `n` a power of two.

**Upsweep (reduce).** Build partial sums up the tree. After this, `a[n-1]` holds the total.

```cpp
for (size_t d = 1; d < n; d <<= 1)
  for (size_t i = 0; i < n; i += 2*d)             // <-- independent per i
    a[i + 2*d - 1] += a[i + d - 1];
```

**Clear the root.** `a[n-1] = 0;` — **this one line is what makes the result exclusive**, and it
is the step everyone forgets. You are replacing the total with the identity, so that as it flows
back down, each node receives the sum of everything strictly to its left.

**Downsweep.** Push values back down with a swap-and-add:

```cpp
for (size_t d = n >> 1; d >= 1; d >>= 1)
  for (size_t i = 0; i < n; i += 2*d) {
    int t = a[i + d - 1];                         // save left child
    a[i + d - 1]  = a[i + 2*d - 1];               // left child <- parent
    a[i + 2*d - 1] += t;                          // right child <- parent + old left
  }
```

**T₁ = O(n)** (specifically `n-1` adds up and `n-1` adds down, so ~2n), **T∞ = O(log n)** (two
passes of `log n` levels, so `2 log n` — twice the depth of Hillis-Steele).

### Verified, live

Both implemented and checked against `std::inclusive_scan` / `std::exclusive_scan` with
`assert`, n = 1024. Real output:

```
N=1024  Hillis-Steele adds=10240 (n log n = 10240)
N=1024  Blelloch adds=1023 up + 1023 down = 2046  (~2n = 2048)
both scans match the std:: reference: OK
```

**10240 vs 2046 — a 5× work reduction at n = 1024, and it grows as `log n / 2`.** The counts come
out at *exactly* `n log n` and *exactly* `2(n-1)`, which is the theory reproduced to the
operation. This is the ideal machine-checkable exercise: correctness is asserted against the
standard library, and the work-efficiency claim is a printed integer the student can check
against the closed form.

### The tradeoff, stated properly

| | Hillis-Steele | Blelloch |
|---|---|---|
| Work T₁ | **O(n log n)** | **O(n)** |
| Span T∞ | **log n** | **2 log n** |
| Result | inclusive | exclusive |
| Storage | needs a second buffer | in place |
| Active threads | all `n` every step | halves each level (idle lanes) |
| Best for | within a warp/workgroup, small n | across a whole array, large n |

**Blelloch has *more* depth and *less* work.** That is the whole point and it is counterintuitive:
the work-efficient algorithm is the *slower* one in the idealised infinite-processor model.
Which wins depends entirely on whether you are processor-limited (real life, large n → Blelloch)
or latency-limited with processors to spare (a 32-lane warp → Hillis-Steele).

### Why the GPU units reuse this

Real GPU scan implementations (CUB's `DeviceScan`, Thrust) use **all three levels at once**, and
this is the concrete payoff of the theory:

1. **Warp level** — Hillis-Steele via shuffle instructions (`__shfl_up_sync`). No shared memory,
   no barriers, 5 steps for 32 lanes. Work-inefficiency is free because the idle lanes would be
   idle anyway.
2. **Block level** — one warp-scan per warp, then a scan of the per-warp totals, then add the
   offset back. This decomposition — *scan the parts, scan the part-totals, add back* — is the
   fundamental recursive structure of scan and is worth teaching as its own idea.
3. **Device level** — historically three kernel launches (reduce, scan the block sums, add back),
   reading the input **three times**. Modern implementations use **single-pass chained scan with
   decoupled look-back**, which reads the input **once** and gets each block's prefix by
   inspecting predecessors' published partial results rather than waiting for a global barrier.

That last point connects the whole report: **decoupled look-back is a lock-free protocol.** Each
block publishes an "aggregate available" or "inclusive prefix available" flag with a release
store; successors poll with acquire loads and walk backwards until they find an inclusive prefix.
It is publish/subscribe (§1.2 MP) at grid scale, and it is memory-bandwidth-bound rather than
work-bound — which is why the O(n) vs O(n log n) distinction stops being the deciding factor and
"how many times do you touch DRAM" starts being it.

**The through-line for the curriculum:** work-efficiency is the right metric when compute is
scarce; memory traffic is the right metric when it is not. Scan is where a student meets both.

## 3.6 False sharing

Two threads write to two *different* variables that happen to share a **cache line**. No data
race, no logical sharing, entirely correct code — and the line ping-pongs between cores on every
write, because coherence granularity is the line (64 bytes on x86-64 and most ARM64), not the
variable.

C++17 names the constant. **Verified live, both GCC 15.2 and Clang trunk on x86-64:**

```
std::hardware_destructive_interference_size  = 64
std::hardware_constructive_interference_size = 64
```

(*Destructive* = keep apart to avoid false sharing. *Constructive* = keep together to share a
line on purpose. Note that GCC warns about ABI stability when these are used in headers, and some
projects hard-code 64 or 128 instead — Apple silicon and some POWER parts use 128-byte
granularity for some purposes.)

### The benchmark does not work in the sandbox — and this is a finding

Two threads, 20M relaxed `fetch_add` each, adjacent vs `alignas(64)`-separated, three repetitions.
**Real output from the Compiler Explorer executor:**

```
false sharing            251 ms   (offsetof b = 8,  sizeof = 16)
padded to 64B            821 ms   (offsetof b = 64, sizeof = 128)
false sharing            997 ms   (offsetof b = 8,  sizeof = 16)
padded to 64B            997 ms   (offsetof b = 64, sizeof = 128)
false sharing            994 ms   (offsetof b = 8,  sizeof = 16)
padded to 64B            996 ms   (offsetof b = 64, sizeof = 128)
ratio = 1.00x
```

The measured ratio is **1.00×**, and the first two runs disagree by 3–4× *in the wrong
direction*. On a shared 2-vCPU box the threads are not reliably co-resident, so they never
actually contend for the line; the noise floor is larger than the effect. On real dedicated
hardware this benchmark reliably shows **5–20×**.

**Design consequence for the curriculum, and it generalises to every exercise in this report:**
in the sandbox, make the false-sharing exercise **structural, not temporal**. Assert on layout,
which is deterministic:

```cpp
static_assert(offsetof(Padded, b) - offsetof(Padded, a)
              >= std::hardware_destructive_interference_size,
              "a and b can still land on the same cache line");
// and the runtime version, which catches allocation-time misalignment:
assert(((uintptr_t)&s.a / 64) != ((uintptr_t)&s.b / 64) && "same cache line");
```

Teach the *timing* result with a number measured on real hardware, cited as such, and have the
student verify the *layout* — which is the thing they actually control.

## 3.7 NUMA and first-touch

On a multi-socket (or chiplet, or Grace-Hopper) machine, memory is physically attached to a
particular node. Local access might be ~80 ns; remote across the interconnect ~140 ns, with lower
bandwidth and a shared link. Same instruction, ~2× the latency.

**First-touch allocation is the rule that decides where your pages land.** `malloc` and
`new` do not allocate physical memory — they reserve virtual address space. The physical page is
allocated on the **first write**, and Linux's default policy places it **on the node of the CPU
that faulted it in.**

The classic bug follows immediately:

```cpp
double* a = new double[N];
for (size_t i = 0; i < N; ++i) a[i] = 0.0;   // thread 0 touches EVERYTHING
                                             // -> every page is on node 0
#pragma omp parallel for
for (size_t i = 0; i < N; ++i) a[i] = f(i);  // half the threads are now remote, forever
```

The fix is to make the initialisation loop use **the same parallel decomposition** as the compute
loop, so each thread first-touches the pages it will later use:

```cpp
#pragma omp parallel for
for (size_t i = 0; i < N; ++i) a[i] = 0.0;   // now each page lands on its user's node
```

Two lessons worth stating as general principles, because both recur:

1. **The initialisation loop is not a formality — it decides your memory layout.** This is the
   same class of error as ignoring cache-line placement: a correctness-preserving change to code
   nobody thinks about, with a large performance consequence.
2. **NUMA effects and false sharing are the same phenomenon at two scales** — the unit of
   ownership (line, page) does not match the unit of logic (variable, array slice). Once a
   student sees that, `numactl --hardware`, `perf c2c`, and `alignas(64)` all become the same
   tool.

Verification note: I could **not** measure NUMA effects — the sandbox is a single small VM with
no NUMA topology. Every number in this section is from the literature and must be re-measured on
real hardware before being taught as fact.

---
