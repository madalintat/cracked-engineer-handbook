# Testing, Fuzzing and Verification — How You Come to Believe Code Is Correct

**Research date: September 2026.** Tool versions and figures are dated inline. The Compiler Explorer API behaviour in §6 was verified by live API calls on 2026-09-01 and the exact request/response shapes are recorded; that is the part most likely to rot, and §6.2 says what to re-check.

Audience: a strong SWE who reads and writes C and C++, has been through the memory-model and UB material in `cpp-linux-systems.md`, the sanitizer and profiler material in `debugging-and-measurement.md`, the memory-safety exploitation material in `hardware-security.md`, and the data-race material in `concurrency-theory-coroutines.md`. This document assumes all of that and never re-explains what a use-after-free is.

**Target end state:** *can look at a piece of code and say what kind of confidence it needs and what technique supplies that kind; can write a property test and read a shrunk counterexample; can write a libFuzzer target that is actually fuzzable and explain why a bad one wastes CPU forever; can explain the coverage-guided loop mechanically, including why sanitizers are not optional company for a fuzzer but the entire point; can read a coverage report as a diagnostic without ever treating the number as a goal; and can say — without overselling — the specific circumstances under which TLA+ or Z3 earns its cost, and the much larger set in which it does not.*

---

## 0. The thesis, stated up front

Everything in this document is one question asked five ways: **what would have to be true for me to believe this code is correct, and what is the cheapest artifact that makes it true?**

The five answers, in increasing order of cost and decreasing order of applicability:

| Technique | What it actually gives you | Cost | Where it stops |
|---|---|---|---|
| **Example tests** | *These specific inputs* behave. Regression net. Design pressure. | Minutes | You only checked what you thought of |
| **Property tests** | *A class of inputs* satisfies a stated law | Hours | You only checked laws you could state, on inputs a generator reaches |
| **Fuzzing** | No input in a very large machine-searched space triggers a *detectable* fault | CPU-hours, cheap human-hours | Only finds what an oracle can see — hence sanitizers |
| **Static analysis** | A *whole-program* property holds, modulo the tool's unsoundness | Minutes, plus a false-positive tax | The tool is wrong about your code in ways you must triage |
| **Formal methods** | A *proof* that a model satisfies a specification | Weeks to years | The model is not the system; the spec might be wrong |

The single most important structural fact — and the reason this document exists in this curriculum — is the line under **Fuzzing**. A fuzzer is a search engine with no idea what "correct" means. It finds bugs only when something *screams*. In C and C++ the thing that screams is a sanitizer. `hardware-security.md` teaches what a heap overflow *is* and how it is turned into control-flow hijack; this document closes the loop by teaching **how those bugs are actually found in the first place**, which in 2026 is overwhelmingly: a coverage-guided mutation loop, running under AddressSanitizer, on a continuous-integration fleet. Not code review. Not unit tests. Not intuition.

### 0.1 The oracle problem, which organizes everything

Every technique above decomposes into two independent halves:

1. **Input generation** — how do you get to an interesting program state?
2. **The oracle** — once you are there, how do you know it is wrong?

Almost all the confusion in this field comes from conflating them. A unit test hand-picks the input and hand-writes the oracle. A property test generates the input and states the oracle as a law. A fuzzer generates the input aggressively and *borrows* the oracle (from a sanitizer, an assertion, a second implementation). A model checker enumerates the inputs exhaustively over a small model and takes the oracle from a temporal-logic formula.

Every time you find yourself asking "why doesn't my fuzzer find anything," the answer is one of exactly two things: it cannot reach the code, or it cannot tell that the code is wrong. Generation or oracle. Keep the two separated in your head and the rest of this document is bookkeeping.

### 0.2 How to read this document

- **§1** is testing stated as an engineering practice rather than a moral position. The parts worth your time are determinism (§1.4), flakiness (§1.5), and the long argument in §1.7 that coverage is a superb diagnostic and a catastrophic target.
- **§2** is property-based testing. The centrepiece is **shrinking** (§2.4) — it is the entire reason the technique is usable by humans, and it is the part everyone hand-waves.
- **§3** is fuzzing and is the longest section by design. §3.2 is the mechanical explanation of the coverage-guided loop; §3.6 is the claim that fuzzing without sanitizers is close to pointless; §3.10 is differential fuzzing, which is how a startling fraction of real cryptography and compiler bugs are found.
- **§4** is static analysis, organized around the soundness/completeness/usability trilemma (§4.4) that explains why every tool you have used behaves the way it does.
- **§5** is formal methods at a dose that is defensible. It contains the AWS record quoted verbatim from the primary source, and an honest statement of what "verified" means for seL4 and for CompCert — which are two quite different things.
- **§6** is the curriculum: three units, and exercises verified against a live Compiler Explorer API.
- **Appendix A** is the verification ledger: exactly what was checked against a primary source and what was not.
- **Appendix B** is a ranked reading list.

### 0.3 Conventions

- Claims not checked against a primary or strong secondary source during this research are marked **[unverified]**. There is a consolidated list in Appendix A; this session ran out of web-search budget partway through, which is recorded honestly rather than papered over.
- All code is teaching code. The fuzz targets in §3 are the exception — those are close to production shape, and where they are not, it says so.

---

## 1. Testing, stated usefully rather than dogmatically

### 1.1 The pyramid, and its honest critiques

The test pyramid comes from Mike Cohn, *Succeeding with Agile* (Addison-Wesley, 2009), where it is drawn as three bands: a wide base of unit tests, a middle of service/integration tests, a narrow cap of UI/end-to-end tests. The intended message is fine and remains correct: **the tests you have most of should be the ones that are fastest, most deterministic, and most precise about where the failure is.**

The critiques are also correct, and you should hold both:

**Critique 1: the axis is never specified.** Is the pyramid's width test *count*, total *runtime*, *confidence purchased*, or *money spent*? Cohn's picture implies count. But the useful ordering is by a three-way cost function, and count is a proxy that sometimes inverts. A codebase can have 40,000 unit tests that collectively verify less than 40 well-chosen integration tests.

**Critique 2: "unit" is undefined and the ambiguity is load-bearing.** If a "unit" is a class, the pyramid pushes you to test every class in isolation, which requires isolating every class, which requires injecting every collaborator, which requires an interface per collaborator, which is how C++ and Java codebases acquire a hundred single-implementation interfaces that exist purely so a mocking framework can reach them. If a "unit" is instead *a unit of behaviour that fails for one reason* — possibly spanning several classes — the pyramid pushes you toward a much better design. Cohn does not say which. The word does the damage.

**Critique 3: it silently encodes the mockist style.** To have many fast isolated tests you must cut the graph somewhere, and mocks are the scissors. The pyramid therefore ships with a design philosophy attached that is nowhere argued for. See §1.3.

**Critique 4: the real distribution is often an ice-cream cone and that is sometimes right.** Systems whose essential complexity is in *integration* — a database engine, a network stack, a build system, a device driver — legitimately concentrate their value in medium and large tests. A B-tree's interesting bugs are not in `split_node()` in isolation; they are in the interaction of split, merge, and crash recovery. See `storage-filesystems-engines.md`.

**The better framing.** Rather than a shape, rank tests on three independent axes and choose deliberately:

| Axis | Question | Why it matters |
|---|---|---|
| **Feedback latency** | Milliseconds, seconds, or minutes to a verdict? | Determines whether it runs on save, on commit, or nightly |
| **Failure locality** | When it goes red, how many lines could be at fault? | A 3-line suspect set is worth 50× a 30,000-line one |
| **Fidelity** | How much of the real system is exercised? | A test of a mock verifies the mock |

Locality and fidelity trade against each other; latency correlates with fidelity. There is no shape that dominates — there is a portfolio. Google's internal framing is worth stealing here: they classify by **test size** (small = single process, no network, no sleeps; medium = single machine, localhost network allowed; large = anything) rather than by scope, because size is what determines whether the test can be run hermetically and in parallel, which is the property the CI system actually cares about. Size is an operational constraint you can enforce mechanically; "unit" is a vibe.

### 1.2 What a unit test is actually for

Three distinct jobs, frequently conflated, and the conflation is why arguments about testing go nowhere.

**Job 1: a regression net.** The dominant job in practice. You are not proving the code right; you are pinning down behaviour so a future change that breaks it is loud. This job is served well by tests that are *coarse* and assert on *observable outputs*. It is served badly by tests that assert on internal call sequences, because those go red on refactors that changed nothing observable — noise that trains the team to ignore red.

**Job 2: design pressure.** Code that is hard to test is usually hard for a reason: it does too many things, it reaches out to the world from deep inside, its dependencies are implicit. The test writing itself is the diagnostic. This is the strongest argument for TDD and it is an argument about *design feedback*, not about correctness. Note the failure mode: if you respond to "hard to test" by adding a mock rather than by fixing the coupling, you have taken the medicine's side effect and thrown away the medicine.

**Job 3: executable specification.** A test that documents intent — especially edge intent ("empty input returns empty, does not throw"). Undervalued. A named test is a durable answer to "was this deliberate?" that a comment is not, because the test rots loudly and the comment rots silently.

Notice that "convince me the code is correct" is not on the list, and cannot be. A finite set of examples cannot establish a universally quantified claim. That is precisely the gap §2 and §3 exist to fill, and it is why a curriculum that stops at unit testing has taught a practice without teaching its limit.

**J.B. Rainsberger's argument** ("Integrated Tests Are A Scam", 2009) is worth internalizing even if you reject its conclusion: integrated tests are attractive because each one *feels* like it buys a lot of confidence, but the number required to cover the combinatorial space of a system grows explosively, so a suite of them ends up covering a vanishing fraction of the space while consuming most of the runtime budget — and, because they are slow and non-local, they do not get run. His prescription (collaboration tests plus contract tests) is more controversial than his diagnosis. The diagnosis is solid.

### 1.3 Test doubles, and exactly when mocking makes tests worse

Gerard Meszaros' taxonomy (*xUnit Test Patterns*, Addison-Wesley, 2007) is the one to use, because the five things are genuinely different and the industry's habit of calling all of them "mocks" destroys the distinction that matters:

| Double | What it does | Verification style |
|---|---|---|
| **Dummy** | Passed to satisfy a signature, never used | none |
| **Stub** | Returns canned answers to queries | state |
| **Spy** | A stub that also records what it was called with, inspected afterward | state (post hoc) |
| **Mock** | Pre-programmed with *expectations*; fails the test if the calls do not match | **behaviour** |
| **Fake** | A real, working, simplified implementation (in-memory DB, in-memory filesystem) | state |

The line that matters is between **state verification** (run the code, then assert on the resulting observable state or return values) and **behaviour verification** (assert that the code made specific calls, in a specific order, with specific arguments). Martin Fowler's "Mocks Aren't Stubs" (2007) names the two camps *classicist* and *mockist*.

**When mocking makes tests worse — the specific mechanism.** A mock encodes the *implementation's interaction pattern* into the test. The test therefore fails when the interaction pattern changes, whether or not behaviour changed. This is not a mild annoyance; it inverts the value of the suite:

- **Refactoring becomes expensive rather than cheap.** The whole point of a regression net is that it lets you restructure internals fearlessly. A behaviour-verifying suite punishes exactly the activity it was supposed to protect. Teams respond by not refactoring.
- **Tests pass while the system is broken.** The classic: a mock `Repository` returns a canned `User`. The real repository's query has a bug. Every test is green. The mock verified the *test author's belief* about the collaborator, and the belief was wrong. The stronger the mock, the more comprehensively it certifies a fiction.
- **Coverage inflates while confidence does not.** Mocked-out collaborators mean the covered lines are executed against unrealistic inputs. See §1.7.

**The rules that survive contact with reality:**

1. **Don't mock what you don't own.** From Freeman and Pryce, *Growing Object-Oriented Software, Guided by Tests* (2009). If you mock a third-party API, you have encoded your guess about its semantics. Its real semantics differ — in error cases, always. Instead, wrap it in a thin adapter you *do* own, mock the adapter, and test the adapter against the real thing (or a vendor-provided fake) in a slower test tier. This is also the pattern that makes the dependency swappable later, which is a real benefit rather than a speculative one.
2. **Prefer a fake to a mock.** An in-memory implementation of the interface, written once, used by hundreds of tests, and — critically — *itself tested against the same contract test suite as the real implementation*. This is the single highest-leverage move in the whole area. SQLite in `:memory:` mode, an in-memory `Clock`, a `MemoryFilesystem`. You get speed and determinism without encoding interaction patterns. The technique's name is **contract tests**: one abstract test suite, run against every implementation including the fake, so the fake cannot silently diverge.
3. **Mock only at genuine trust boundaries, and only for things you cannot otherwise provoke** — a network partition, a disk-full `ENOSPC`, a `malloc` returning null, a signal arriving mid-syscall. Here behaviour verification is not a smell; injecting the failure is the only way to reach the path. This is fault injection, and it is a legitimate and underused technique. (`storage-filesystems-engines.md` covers crash injection specifically.)
4. **Never mock the thing under test.** Partial mocks of the class you are testing mean you are testing a chimera that exists in no deployment.

**The C++ tax.** C++ has no runtime reflection, so a mock must be reached either through a **virtual interface** or through a **template parameter**. This is why C++ codebases accumulate `IFooService` with exactly one production implementation: not because the abstraction was needed, but because GoogleMock needs a vtable. Two better options exist and are underused — (a) template the collaborator (`template <class Clock> class Scheduler`), which costs zero runtime and no interface, and (b) pass a `std::function` or a small callable for the one operation you actually need to control. If you are adding an interface solely to enable a mock, you are paying an architectural cost for a testing convenience; at minimum, notice that you are doing it.

### 1.4 Determinism, and its enemies

A test that can produce different verdicts from the same code is not a test; it is a random number generator with a build step. Determinism is not a nicety, it is the precondition for the whole enterprise — and it is also, note, the precondition for fuzzing (§3.4: libFuzzer explicitly requires the target be deterministic, because otherwise the corpus is garbage).

Enemies, roughly in order of how often they bite:

| Enemy | How it leaks in | Fix |
|---|---|---|
| **Wall-clock time** | `time()`, `now()`, timestamps in output, TTL/expiry logic, tests that behave differently at midnight, on Feb 29, or across a DST boundary | Inject a clock. One interface, `now()`. Every codebase should have exactly one place that reads the real clock. |
| **Time *duration*** | `sleep(100)` then assert the work finished. Passes on your laptop, fails on a loaded CI box. | Never sleep for synchronization. Wait on a condition with a generous timeout, or drive time explicitly through a virtual clock. |
| **Randomness** | `rand()`, `std::random_device`, UUID generation, hash seeds, randomized algorithms (skip lists, treaps) | Seed explicitly from a value the test controls, **and print the seed on failure**. A property test that fails without telling you its seed has wasted your time. |
| **Iteration order** | `std::unordered_map` order is unspecified and varies with insertion history, allocator, and libstdc++/libc++ choice. Go deliberately randomizes map iteration. Python randomizes string hashing unless `PYTHONHASHSEED` is fixed. | Sort before comparing, or use an ordered container in tests, or assert on sets rather than sequences. |
| **Address values** | Anything that hashes or sorts by pointer. ASLR makes this differ per run. `hardware-security.md` covers ASLR itself. | Never let an address escape into observable output or ordering. |
| **Thread scheduling** | The big one. Data races, missing memory fences, lock-order inversions — all schedule-dependent and therefore intermittently invisible. | ThreadSanitizer (`-fsanitize=thread`) turns a *possible* race into a *deterministic* report on any run where the accesses happen at all, which is a categorical improvement. Plus stress: run the test 1,000× under load. |
| **Filesystem** | `readdir` order is not sorted and differs by filesystem; `/tmp` collisions between parallel tests; leftover state from a previous run; umask; case-insensitivity on macOS | Sort directory listings. Give every test a fresh unique directory. Never share a fixed path. |
| **Locale and environment** | `LC_ALL` changes number formatting, collation, `toupper` on non-ASCII, and date parsing. `TZ` changes everything about time. `strtod` respects the decimal separator in some locales. | Pin `TZ=UTC LC_ALL=C` in the test harness. Do not rely on the developer's shell. |
| **Floating point** | FMA contraction (`-ffp-contract=fast` is GCC's default at `-O2` and changes results), x87 80-bit excess precision on 32-bit x86, different `libm` implementations giving different last bits for `sin`/`exp`, `-ffast-math` enabling reassociation | Compare with an explicit tolerance chosen from an error analysis, not from what made the test pass. Or make the computation exactly reproducible and assert bitwise. Do not do both accidentally. |
| **Uninitialized memory** | Reads of uninit stack/heap are UB and produce whatever was there. Behaves one way at `-O0` and another at `-O2`. | MemorySanitizer (`-fsanitize=memory`) — the only tool that reliably catches this, at the cost of needing an MSan-instrumented libc++. |
| **Parallel execution** | Tests sharing a global, a port, a file, a database row, or a singleton | Hermeticity as a hard rule. If the test cannot run concurrently with a copy of itself, it is not hermetic. |
| **Network** | DNS, other people's servers, latency, captive portals | Not a unit test. Move it to a tier that is allowed to be flaky and is not gating. |

**The disciplined form of the fix is always the same: make the nondeterminism an explicit input.** A clock becomes a parameter. A seed becomes a parameter. A schedule becomes a parameter (this is what deterministic-simulation testing does — FoundationDB's is the famous example, where the entire system including the network and disk runs on a single-threaded deterministic simulator seeded by one integer, so any failure is replayable from that integer). Once nondeterminism is an input, the test is a pure function and everything else becomes possible: replay, shrinking, bisection.

### 1.5 Flaky tests, and how to actually handle them

A flaky test is one that passes and fails on the same code. Google's public numbers (Google Testing Blog, John Micco, "Flaky Tests at Google and How We Mitigate Them", May 2016) are the most-cited data point: roughly **1.5% of all test runs** report a flaky result, and **almost 16% of their ~4.2 million tests** show some level of flakiness. *(Figures quoted from memory of the primary source; see Appendix A — the numbers were not re-verified live in this session.)* At that scale flakiness is not a hygiene problem, it is a capacity problem: a large fraction of CI compute and of engineer attention goes to re-running and triaging.

**The thing everyone gets wrong: automatic retry.** Retry-on-failure is irresistible because it makes the board green today. What it does is convert a *loud, reproducible-ish* signal into a *silent* one, and it does so preferentially for the highest-severity class of bug you have. Consider what actually causes flakes:

| Cause | Where the bug is | What retry does |
|---|---|---|
| Test sleeps instead of waiting on a condition | The test | Hides a slow test that will fail harder on a loaded CI machine |
| Test depends on iteration/directory order | The test | Hides it until a library upgrade changes the order permanently |
| Shared state between parallel tests | The test suite | Hides it until it corrupts a result rather than crashing |
| **A real data race in the system** | **The system** | **Hides a memory-corruption bug that will occur in production at scale** |
| **A real time-of-check/time-of-use window** | **The system** | **Hides a correctness or security bug** |
| Resource exhaustion (fds, ports, memory) under parallelism | Somewhere real | Hides a leak |

The bottom rows are why "just retry it" is a bad default. **The base rate of "the flake is telling you about a genuine race" is not small**, and it is exactly the class of bug that is hardest to find any other way — a race that manifests once in 500 runs on CI will manifest thousands of times a day in production.

**The policy that works:**

1. **Detect flakes deliberately, do not wait to notice them.** Re-run the suite against unchanged code on a schedule; anything that changes verdict is flaky by definition, and you learn it before it costs anyone a bisect.
2. **Quarantine, with an owner and an expiry.** A flaky test is removed from the gating set immediately (so it stops corrupting everyone's signal) but *keeps running* in a non-gating lane and is assigned to a human with a date. A quarantine with no expiry is deletion with extra steps and a worse conscience.
3. **Deflake by removing nondeterminism, not by adding tolerance.** Widening a timeout from 100 ms to 5 s is not a fix; it is the same bug with a longer fuse and a slower suite. Go find the thing that is not being waited on.
4. **Run the flaky test under TSan and under stress before assuming the test is at fault.** `--gtest_repeat=1000 --gtest_shuffle` plus `-fsanitize=thread` resolves a large fraction of "mystery flakes" into a specific race with a stack trace for both accesses. This is cheap and almost nobody does it first.
5. **Track flakiness as a first-class metric with a budget**, like error budgets in SRE. If the flake rate exceeds the budget, feature work stops. Without this, flakiness ratchets in one direction, because every individual decision to retry is locally rational.

The cultural point, which is the real one: **the cost of a flaky test is not its own runtime, it is the credibility of every other test.** Once a team learns that red does not mean broken, the suite has stopped functioning as a signal and you are paying for it in full while receiving nothing.

### 1.6 Coverage: what is actually measured

Coverage instruments the program to record which parts executed during a run. The criteria form a hierarchy of strictness:

**Statement / line coverage.** Was this line executed at least once? The weakest useful criterion. It is trivially fooled: `if (p) foo();` reaches 100% line coverage from a single test with `p` true — the `p == false` path is never taken, and if that path had a bug there is nothing to see. Line coverage's other lie is granularity: `a && b` is one line and one statement, but contains two decisions.

**Branch / decision coverage.** Did each branch point go *both* ways? Now `if (p) foo();` requires two tests. This is the first criterion that is worth gating anything on, and the gap between it and line coverage is where an enormous number of real bugs live — because error-handling paths are exactly the branches taken rarely.

**Condition coverage.** Did each atomic boolean subexpression evaluate both true and false? For `if (a && b)`, condition coverage requires `a` both ways and `b` both ways — but note it does not require the *decision* to go both ways, and with short-circuit evaluation `b` may not even be evaluated. Condition coverage alone is a trap; **condition/decision coverage** (both criteria together) is the sane version.

**MC/DC — Modified Condition/Decision Coverage.** The one that matters if you ever touch avionics, and the one worth understanding regardless because it is the criterion that actually captures "does this condition matter". Definition: every condition in a decision must be shown to **independently affect that decision's outcome** — i.e., for each condition *c*, there exists a pair of test cases that differ only in *c* (all other conditions held fixed) and produce different decision outcomes.

For `if (a && b && c)`:

| Test | a | b | c | result |
|---|---|---|---|---|
| T1 | T | T | T | true |
| T2 | F | T | T | false | ← pairs with T1: shows `a` matters |
| T3 | T | F | T | false | ← pairs with T1: shows `b` matters |
| T4 | T | T | F | false | ← pairs with T1: shows `c` matters |

Four tests for three conditions. In general MC/DC requires a **minimum of n+1 tests for n conditions** (and at most 2n), against 2ⁿ for exhaustive multiple-condition coverage — that linear-rather-than-exponential bound is the entire reason the criterion exists. MC/DC was introduced by Chilenski and Miller (*Software Engineering Journal*, 1994) and is mandated by **DO-178C for Level A** software (failure condition: catastrophic) in airborne systems; Level B requires decision coverage, Level C statement coverage. The interesting design consequence: MC/DC makes complex boolean expressions expensive to certify, which is a direct economic pressure toward simple predicates — arguably the criterion's largest real benefit.

**Path coverage.** Every distinct path through the CFG. Infeasible in general: a loop with an unbounded trip count has unbounded paths, and *n* sequential `if`s give 2ⁿ. Not a practical target; useful as the theoretical ceiling that explains why symbolic execution hits path explosion (§3.11).

**Function/region/MC-DC in the tools.** LLVM adds **region coverage** — counters over source regions finer than lines, so that `a && b` on one line reports separate counts. It is the most honest of the commonly available metrics.

#### 1.6.1 How it is measured, concretely

**GCC / gcov.** Compile and link with `--coverage` (equivalent to `-fprofile-arcs -ftest-coverage` plus `-lgcov` at link). The compiler inserts arc counters on CFG edges and emits a **`.gcno`** file at compile time (the static CFG/notes) next to the object file. Running the binary writes a **`.gcda`** file (the dynamic arc counts) on exit. `gcov` merges the two into annotated source; `lcov`/`genhtml` (or `gcovr`) render HTML.

```
g++ --coverage -O0 -g -o t test.cpp lib.cpp
./t
gcov -b lib.cpp          # -b = branch counts, not just lines
lcov --capture --directory . --output-file cov.info
genhtml cov.info --output-directory html
```

Sharp edges: `.gcda` is written by an `atexit` handler, so a crash, `_exit()`, or a signal kill loses the data (`__gcov_dump()` exists for this). Counts accumulate across runs into the same `.gcda`, which is what you want for a test suite and a trap when you forget to clean. Optimization mangles the mapping between source lines and arcs, so coverage builds are conventionally `-O0`, which changes timing and can itself hide races.

**Clang / llvm-cov.** A different and better-designed mechanism. Compile with `-fprofile-instr-generate -fcoverage-mapping`. The compiler embeds a **coverage mapping** section in the binary describing source regions and their counter indices. Running writes a raw profile to the path in `LLVM_PROFILE_FILE` (which supports `%p` for pid and `%m` for a module signature, so parallel runs do not collide). Then:

```
clang++ -fprofile-instr-generate -fcoverage-mapping -O1 -g -o t test.cpp
LLVM_PROFILE_FILE=t-%p.profraw ./t
llvm-profdata merge -sparse t-*.profraw -o t.profdata
llvm-cov report ./t -instr-profile=t.profdata
llvm-cov show   ./t -instr-profile=t.profdata --show-branches=count
```

The `llvm-profdata merge` step is the part that makes parallel and sharded test execution work properly, and is why LLVM's pipeline is the one to teach.

**The fuzzer connection, which is the reason this subsection is here at all.** `-fprofile-instr-generate` is *for humans* — it is precise, it maps to source, and it is slow. `-fsanitize-coverage=` is *for machines* — it is coarse (a byte counter per edge, no source mapping), and it is fast enough to run in the inner loop of a fuzzer executing 100,000 times per second. They are the same idea at two very different operating points. §3.2 picks this up.

### 1.7 Why coverage is an excellent diagnostic and a terrible target

This is the most important paragraph in §1, so it gets stated flatly:

> **Coverage tells you what you definitely have not tested. It tells you almost nothing about what you have.**

The asymmetry is total. Zero coverage on a function is *proof* of the absence of testing — an incontrovertible, actionable fact. 100% coverage on a function is consistent with a test suite containing no assertions whatsoever.

**Four independent reasons the number is not a measure of quality:**

**1. Coverage measures execution, not verification.** This is the fatal one and it is not subtle. The following achieves 100% line, branch, and MC/DC coverage of any function you like:

```cpp
TEST(Anything, Covered) {
  for (auto in : all_the_inputs) (void)function_under_test(in);
  SUCCEED();
}
```

No oracle. Full coverage. Zero information. There exist real test suites shaped like this, generated to satisfy a coverage mandate. Mutation testing (§1.8) exists precisely because this failure mode is invisible to coverage and visible to nothing else.

**2. Coverage cannot see code that is not there.** The most expensive bugs in systems software are *omissions*: the missing bounds check, the unhandled `EINTR`, the error return that is never checked, the integer overflow check that was never written. There is no line to leave uncovered. Coverage is structurally blind to the entire category, and it is the category that produces CVEs.

**3. Covering a branch says nothing about the values that flowed through it.** `memcpy(dst, src, n)` is one line. Covering it with `n = 4` says nothing about `n = SIZE_MAX`. This is exactly the gap that property testing (§2) and fuzzing (§3) are built to close, and it is why "we have 90% coverage" and "we found a heap overflow in the first ten seconds of fuzzing" are routinely true of the same code.

**4. Coverage is not correlated with effectiveness once you control for suite size.** The reference here is Inozemtseva and Holmes, **"Coverage Is Not Strongly Correlated With Test Suite Effectiveness"** (ICSE 2014), which measured coverage against mutant-detection rate across large Java programs. Their finding, roughly: there is a moderate-to-strong correlation between coverage and effectiveness when suite *size* is allowed to vary — but that is largely because bigger suites both cover more and kill more. **Controlling for the number of test cases, the correlation between coverage and effectiveness is low.** In other words, coverage is substantially a proxy for "how many tests did you write", and adding tests that raise coverage without adding assertions raises the number without raising effectiveness. *(Characterization from memory of the paper; the exact correlation coefficients were not re-verified in this session — Appendix A.)*

**Goodhart's law, in its testing form.** "When a measure becomes a target, it ceases to be a good measure." A coverage mandate — "no PR below 80%" — produces, reliably and quickly:

- tests that call functions and assert nothing;
- tests that assert `!= nullptr` on things that cannot be null;
- generated tests, which cover everything and specify nothing;
- exclusion pragmas (`LCOV_EXCL_LINE`, `// GCOVR_EXCL`) sprinkled over the hard parts, which is the pure form of the pathology — the measure is satisfied by editing the measurement;
- deletion of defensive code, because unreachable defensive branches drag the number down. This one is actively harmful: coverage mandates create pressure to *remove* the `default:` case and the "cannot happen" assert, which are the code that turns a silent corruption into a loud crash.

**The right way to use it, which is genuinely valuable.** Do not look at the number. **Read the uncovered report**, line by line, and for each region ask one question: *why does no test reach this?* There are exactly three answers, and all three are useful:

| Answer | Action |
|---|---|
| "It is dead / unreachable" | **Delete it.** Coverage just found you dead code, which is a real and underrated win. |
| "It is an error path nobody tests" | **Write the test, or fault-inject.** This is where the bugs are. |
| "It is reachable only in a configuration we do not build" | Fine — but now you know, and it is a documented gap rather than an unknown one. |

The diagnostic use also has a much better *delta* form: **coverage of the diff**. "Did this change's new lines get executed by this change's new tests?" is a question with a defensible yes/no answer, it does not penalize legacy code, it does not create pressure to delete defensive branches, and it is the only coverage gate I would defend in a review. It is still gameable (see reason 1), but it is gameable in a way a human reviewer can see.

### 1.8 Mutation testing: the sharper instrument, and why it stays niche

Mutation testing directly measures the thing coverage only proxies. The idea (DeMillo, Lipton and Sayward, **"Hints on Test Data Selection: Help for the Practicing Programmer"**, *IEEE Computer*, April 1978) is:

1. Systematically introduce small faults into the program — one at a time — producing **mutants**.
2. Run the test suite against each mutant.
3. If a test fails, the mutant is **killed**. If the whole suite passes, the mutant **survived**.
4. **Mutation score** = killed / (total − equivalent).

A surviving mutant is a precise, actionable statement: *"I changed your code's behaviour and every one of your tests still passed."* That is exactly the question coverage cannot answer, and it directly detects the assert-nothing test suite of §1.7 — such a suite has a mutation score of approximately zero regardless of its 100% coverage.

**Typical mutation operators** (this is the whole vocabulary; it is small on purpose):

| Operator | Example |
|---|---|
| Relational operator replacement | `a < b` → `a <= b`, `a > b`, `a == b` |
| Arithmetic operator replacement | `a + b` → `a - b` |
| Boundary shift | `i < n` → `i <= n` — the off-by-one detector |
| Logical connector | `a && b` → `a \|\| b` |
| Constant replacement | `0` → `1`, `1` → `0`, `n` → `n+1` |
| Statement deletion | remove a call, remove an assignment |
| Return-value mutation | `return x;` → `return 0;` / `return nullptr;` |
| Negate conditional | `if (c)` → `if (!c)` |

**The two theoretical justifications**, both from the original line of work:

- **The competent programmer hypothesis**: real programs are close to correct; real faults are small deviations. So small synthetic faults resemble real ones.
- **The coupling effect**: a test suite that detects all simple faults will, empirically, also detect most complex faults built from them. This is an empirical claim and it has held up reasonably well.

**Why it is not more used.** Four honest reasons, in order of weight:

1. **Cost.** Naively, running M mutants against T tests is M×T executions. A program with 50,000 mutants and a 5-minute suite is 170 CPU-days. The mitigations are real but partial: run only tests that *cover* the mutated line (PIT's key optimization — coverage as a test-selection index, which is a genuinely good use of coverage); stop at the first killing test; mutate bytecode/IR rather than re-running the compiler; sample mutants rather than exhausting them; run mutation nightly on changed files only. With all of these it is affordable. Without them it is not, and most teams meet the naive version first and bounce.
2. **Equivalent mutants.** Some mutants are semantically identical to the original (`i < n` → `i != n` where the loop increments by one and starts below `n`). No test can kill them, and they are indistinguishable from a genuine gap in the suite. Detecting them is **undecidable in general** — it is program equivalence. So every mutation score has an unknown-size ceiling below 100%, which makes the metric awkward to gate on and makes triage tedious. Heuristics (Trivial Compiler Equivalence: if two mutants compile to identical optimized code, they are equivalent) help meaningfully but do not solve it.
3. **Tooling maturity, especially in C++.** Java has **PIT (pitest)**, which is genuinely production-grade, fast, and integrated with build tools. Python has `mutmut` and `cosmic-ray`. C and C++ have **Mull** (LLVM IR-level mutation, mutates at the bitcode level so no recompile per mutant) and **Dextool Mutate**, and `universalmutator` (regex-based, language-agnostic, crude but broadly applicable). The C++ options are usable but not turnkey, and the C++ build/test ecosystem is not standardized enough for a tool to just work.
4. **The output is a to-do list, not a green light.** Coverage produces a number that goes up. Mutation testing produces "here are 340 surviving mutants" — each requiring judgement about whether it is equivalent, whether it matters, and what test would kill it. That is more valuable and much less comfortable, and the incentive structure of most organizations prefers the number.

**Where it earns its keep unambiguously:** small, high-value, pure, algorithmic cores. A parser. A codec. An allocator's free-list logic. A B-tree's split/merge. Precisely the code this curriculum has students write — see §6. On a 500-line pure module, mutation testing runs in seconds and gives you a genuinely rigorous answer about your test suite. Do not try to mutation-test an application; mutation-test the kernel of it.

**The one-line summary worth memorizing:** *coverage grades your test suite on where it went; mutation testing grades it on whether it was paying attention when it got there.*

### 1.9 C++ frameworks, briefly

| Framework | Shape | Notes |
|---|---|---|
| **GoogleTest** (+ GoogleMock) | `TEST(Suite, Name)` macros, xUnit fixtures | The de facto default. `ASSERT_*` returns from the test function on failure (fatal); `EXPECT_*` records and continues (non-fatal) — use `EXPECT_*` unless a later line would crash. Death tests (`EXPECT_DEATH`) fork and check a subprocess dies with a message, which is how you test `assert`/`abort` paths. Value-parameterized (`INSTANTIATE_TEST_SUITE_P`) and typed tests are the parts people underuse and are the closest thing gtest has to property testing. GoogleMock's matchers (`ElementsAre`, `Pointee`, `Field`) are excellent and usable without mocking anything. |
| **Catch2** (v3) | `TEST_CASE` + `SECTION`, single-header historically, now a compiled library | The `SECTION` mechanism is genuinely different and genuinely good: the test body re-executes once per leaf section, so shared setup is written once as plain code with no fixture class. `REQUIRE(a == b)` decomposes the expression to report both operands without needing `REQUIRE_EQ`. `GENERATE()` gives lightweight combinatorial inputs. Compile times are its historical weakness. |
| **doctest** | Catch2-compatible API, radically faster to compile | Designed to be cheap enough to leave tests *in the production translation unit* next to the code. That is a real capability nothing else offers, and it makes the "one runnable check next to non-trivial logic" discipline nearly free. |
| **Boost.Test** | Older, heavyweight | Present in Boost-committed codebases. No reason to choose it new. |

For this curriculum, **doctest or Catch2** for the small exercise modules (fast, header-ish, no build ceremony) and **GoogleTest** when the exercise needs death tests or parameterized suites. Note none of them do property testing or fuzzing; §2 and §3 are separate tools, not framework features — with the partial exception of RapidCheck, which ships a GoogleTest integration (§2.6).

---

## 2. Property-based testing

### 2.1 The shift: from examples to laws

An example test says: *for this input, I expect this output.* A property test says: *for all inputs drawn from this distribution, this relation holds*, and hands the search for a violating input to a machine.

The difference in what you write is small. The difference in what you get is not:

```cpp
// example
TEST(Sort, Works) {
  std::vector<int> v{3, 1, 2};
  sort(v);
  EXPECT_EQ(v, (std::vector<int>{1, 2, 3}));
}

// property
RC_GTEST_PROP(Sort, IsOrderedAndAPermutation, (std::vector<int> v)) {
  auto original = v;
  sort(v);
  RC_ASSERT(std::is_sorted(v.begin(), v.end()));
  RC_ASSERT(std::is_permutation(v.begin(), v.end(),
                                original.begin(), original.end()));
}
```

The example test checks one point. The property test checks a hundred points per run and, more importantly, **states what sorting means** — ordered *and* a permutation. That second clause is the one people forget, and forgetting it is not academic: `v.clear()` passes "is sorted". A great many hand-written sort tests would accept an implementation that returns an empty vector, because they only ever compare against a hand-computed expected output for inputs where the bug would be obvious. The property forces you to write down the specification, and writing down the specification is where most of the value is — even before you run it.

**The reframe that makes it click:** you are not writing more tests. You are writing *fewer, stronger* statements, and delegating the enumeration. The generator replaces your imagination, which is the component of your test suite with the worst coverage of adversarial inputs. Your imagination does not produce `""`, `"\0"`, `INT_MIN`, a 4096-element vector of identical elements, or a string of 300 combining characters. A generator produces all of those before lunch.

**What it costs you.** Property tests are slower per run, they are nondeterministic unless you pin the seed (§1.4 applies with full force), and they require you to actually know what your code is supposed to do — which sounds like a benefit and is, but it is also why a property test is harder to write than an example test for genuinely ad-hoc business logic. Property testing is at its best on code with *laws*: codecs, parsers, data structures, numeric routines, serializers, allocators. That is, on precisely the code this curriculum is made of.

### 2.2 Generators

A generator is a function from a source of randomness to a value of some type, usually with a **size parameter** that the framework grows over the run (start small, get bigger — small failures are found fast and are easier to read).

```
Gen<T> :: (RandomSource, Size) -> T
```

Three things determine whether a generator is any good:

**1. Composition.** You build complex generators from simple ones. Every framework provides `map` (transform the output), `filter`/`suchThat` (reject values — dangerous, see below), `bind`/`flatMap` (let a later choice depend on an earlier one), `oneOf`/`frequency` (weighted choice among alternatives), and container combinators (`vector<T>(gen)`, `optional`, `tuple`). Recursive generators need an explicit size decrement or they diverge — generating a random tree with `oneOf(leaf, node(tree, tree))` and no size control terminates with probability that depends on the branching factor and is often zero in expectation.

**2. Distribution.** This is where naive generators fail silently. `arbitrary<int>()` returning a uniform draw over the full 32-bit range will essentially never produce `0`, `1`, `-1`, `INT_MAX`, or `INT_MIN` — which are, of course, the only values that ever have bugs. Good frameworks bias hard toward edge cases: Hypothesis and RapidCheck both deliberately over-sample boundary values, small magnitudes, and repeated elements. When you write your own generator, **build the bias in explicitly**:

```cpp
// bad: uniform over 2^32, will never find the boundary bug
auto badInt = rc::gen::arbitrary<int32_t>();

// good: mostly small, sometimes extreme, always includes the classics
auto goodInt = rc::gen::weightedOneOf<int32_t>({
    {5, rc::gen::inRange<int32_t>(-16, 16)},
    {2, rc::gen::arbitrary<int32_t>()},
    {3, rc::gen::element<int32_t>(0, 1, -1, INT32_MAX, INT32_MIN, 255, 256, 65535)},
});
```

The same reasoning applies to strings (include `""`, embedded NULs, invalid UTF-8, very long, all-one-character), to containers (include empty, singleton, all-equal, already-sorted, reverse-sorted, one-element-different), and to floats (include `0.0`, `-0.0`, `NaN`, `±inf`, subnormals, `DBL_MAX`, and values whose sum is not associative).

**3. Validity.** If your property only holds for inputs satisfying a precondition, you have two options and one of them is a trap.

- **Trap: `filter`/`suchThat`.** Generate random values and throw away those that fail the precondition. Works when the acceptance rate is high. Collapses when it is low — generating a valid 20-node red-black tree by filtering random trees has an acceptance rate of approximately zero, and the framework gives up with "too many discarded tests". Worse, when the acceptance rate is merely *lowish*, the generator silently produces a badly skewed distribution and you test a narrow corner while believing you tested broadly.
- **Correct: construct valid values by construction.** Write a generator that *builds* a valid red-black tree by generating a sequence of insert operations and applying them. Now every generated value is valid, the distribution is over reachable states (which is the distribution you want), and there is no discard rate. This is also the gateway to model-based testing (§2.5.6).

The general rule: **generate the operations, not the state.** It is nearly always easier to generate a valid sequence of API calls than a valid instance of the invariant-laden structure those calls produce — and it tests the API too.

### 2.3 The failure mode that shrinking exists to fix

Run a property test without shrinking and a real failure looks like this:

```
Falsifiable after 47 tests:
  [-1843029471, 883721, 0, -4, 1729384, ... 213 more elements ...,
   -2147483648, 99123, 7, 7, 7, 88213764, -3]
```

That is a true counterexample and it is useless. You cannot tell which of the 219 elements matters, whether the length matters, whether `INT_MIN` matters, or whether it is the three consecutive `7`s. You will spend twenty minutes deleting elements by hand to find out. Multiply by every property test failure forever.

**Shrinking is the machine doing that deletion for you**, and it is not a convenience feature — it is the difference between property testing being a technique people use and a technique people abandon after two weeks.

### 2.4 Shrinking, properly

The goal: given a value that falsifies the property, find a **locally minimal** value that also falsifies it — one where every "smaller" candidate the shrinker knows how to produce either passes the property or is not smaller.

The algorithm is a greedy descent:

```
shrink(x):
  loop:
    candidates = smaller_variants_of(x)      # ordered: most aggressive first
    found = none
    for c in candidates:
      if property(c) still fails:
        found = c; break                     # greedy: take the first success
    if found == none: return x               # local minimum, report it
    x = found                                # descend and start over
```

Two properties of this loop matter. It is **greedy** (it takes the first improvement rather than the best), which makes it fast and means it lands in a *local* minimum — good enough in practice, and the reason two runs can report different minimal counterexamples. And the candidate ordering matters enormously: try "delete half the list" before "decrement one element", because aggressive moves that succeed collapse the search instantly.

The output of a good shrinker on the example above:

```
Falsifiable after 47 tests, shrunk 31 times:
  [0, 0]
```

Now you know: two equal elements. The bug is in the tie-breaking. That is a fifteen-second diagnosis instead of a twenty-minute one, and it is the whole ballgame.

#### 2.4.1 Three architectures for shrinking, and why they differ

This is the part that is usually skipped, and the differences are consequential.

**(a) Type-directed shrinking — original QuickCheck (Haskell, 2000).**

Each type provides, alongside its generator, an independent shrink function:

```haskell
class Arbitrary a where
  arbitrary :: Gen a
  shrink     :: a -> [a]      -- candidate smaller values, lazily
```

`shrink 100` might yield `[0, 50, 75, 88, 94, 97, 99]` — binary-search-flavoured, aggressive first. `shrink [a,b,c]` yields shorter lists (drop elements, halve the list) and then lists with individually shrunk elements.

Two serious problems:

- **It does not respect invariants.** If your generator produces *sorted* lists, `shrink` — which knows only the type `[Int]`, not your invariant — will happily produce unsorted candidates. Your property then fails for the wrong reason, or the shrinker wanders into inputs the property was never meant to cover. You must write a custom `shrink` that preserves the invariant, in parallel with the generator, and keep the two in sync by hand forever.
- **It does not compose through `bind`.** This is the deep one. If you generate `n <- arbitrary; xs <- vectorOf n arbitrary`, the *value* is just a list; the information that its length came from `n` is gone. Shrinking cannot coordinate the two. In monadic generators generally, the dependency structure that generation used is not available to shrinking, so QuickCheck's shrinking degrades exactly where generators get interesting.

**(b) Integrated shrinking — Hedgehog (Haskell, ~2017), and the model several modern libraries adopted.**

A generator does not produce a value. It produces a **rose tree**: a value at the root, and a lazy forest of shrunk alternatives, each themselves a rose tree.

```
Gen a = Random -> Tree a
Tree a = Node a [Tree a]
```

Because the shrink tree is produced *by the generator*, it composes automatically. `fmap f gen` maps `f` over every node of the tree. `bind` grafts the trees together, so the dependency between `n` and `xs` is preserved and shrinking `n` re-derives a consistent `xs`. And because every node in the tree was produced by the generator, **every shrink candidate satisfies the generator's invariants by construction** — the sorted-list problem disappears without a custom shrinker.

The cost is that the generator must be written monadically and cannot be an arbitrary opaque function; and `filter` still causes trouble because filtered-out branches must be pruned from the tree.

**(c) Internal / byte-stream shrinking — Hypothesis (Python, David R. MacIver).**

The cleverest of the three, and the one with the most direct relevance to §3.

Reframe generation entirely: a generator is a **deterministic function of a stream of bytes** (Hypothesis calls it the *choice sequence*). To generate a value, the framework feeds the generator a buffer of random bytes; the generator consumes as many as it needs. The generated value is therefore *entirely determined* by the buffer.

Now shrinking never touches the value at all. **Shrinking operates on the buffer**: make it shorter, and make it lexicographically smaller. Then re-run the generator on the shrunk buffer to get a new value, and check whether the property still fails.

The consequences are large:

- **Invariants are preserved for free, always.** Every candidate is produced by running the real generator, so it is a value the generator could have produced. There is no way to construct an invalid candidate. This holds no matter how baroque the generator is, including generators the framework has never seen.
- **Shrinking composes through everything**, including `bind`, `filter`, and user-written generators with arbitrary control flow, because the framework never needs to understand the generator's structure.
- **Smaller buffer generally means simpler value**, if generators are written so that low bytes mean small/simple choices — which is a convention the library enforces in its primitives (a length is drawn so that low bytes mean short; a `oneOf` is drawn so byte 0 selects the first, simplest alternative).
- **The shrinker is a reusable, highly optimized component** rather than N per-type functions. Hypothesis's shrinker is a serious piece of engineering: passes that delete contiguous blocks of the buffer, passes that lower individual byte values, passes that reorder, passes that replace a block with a duplicate of another block (to canonicalize repeated structure), and a fixpoint loop over all of them.

**And here is the connection worth flagging loudly:** *this is exactly the architecture of a coverage-guided fuzzer's test-case minimizer.* A fuzz input is a byte buffer; the "generator" is the fuzz target's parsing logic; minimization means finding a shorter, simpler buffer that still triggers the crash. libFuzzer's `-minimize_crash=1` and afl-tmin are doing the same job by the same means. Property testing and fuzzing are not neighbouring techniques; at the shrinking layer they are the *same* technique, and a student who understands Hypothesis's shrinker understands `-minimize_crash` for free. §6 builds a unit on exactly this bridge.

#### 2.4.2 What a good shrunk counterexample looks like

The measure of a shrinker is not "is the value small" but **"does the value name the bug"**. Some examples of the shape you want:

| Property that failed | Shrunk counterexample | What it names |
|---|---|---|
| `decode(encode(cp)) == cp` | `cp = 0xD800` | surrogate handling |
| `decompress(compress(x)) == x` | `x = ""` | the empty-input path |
| `decompress(compress(x)) == x` | `x = "aaaa"` | single-symbol alphabet — the classic Huffman bug, a tree with one node and a zero-length code |
| `is_sorted(sort(v))` | `v = [0, 0]` | tie-breaking / strict-weak-ordering violation |
| `find(insert(t, k), k) != null` | `k = 0` | a sentinel value collides with "not found" |
| `abs(x) >= 0` | `x = INT_MIN` | signed overflow, UB |
| allocator: `blocks don't overlap` | `[alloc(1), alloc(1)]` | alignment padding computed wrong |

Notice that in every row the minimal input is a *named phenomenon* a human can reason about. That is what shrinking buys, and it is why it deserves this much space.

### 2.5 The canonical property shapes

There are, in practice, about six. Learning to recognize which applies to a given function is 80% of the skill.

#### 2.5.1 Round-trip (inverse)

```
decode(encode(x)) == x
```

The single most productive property in systems programming, because so much of systems programming is encoding. Serializers, codecs, compressors, parsers/printers, escaping functions, base64, varints, floating-point formatting.

**The crucial subtlety, and it is the one people get wrong:** the *other* direction is usually **false**.

```
encode(decode(y)) == y     // usually NOT a valid property
```

because encodings are typically non-canonical: multiple byte strings decode to the same value. UTF-8 has overlong encodings; JSON has whitespace and `1.0` vs `1`; DER exists precisely because BER is not canonical; a Huffman stream has trailing padding bits. Asserting the wrong direction produces a test that fails on correct code and teaches students to distrust property testing.

The correct strengthening, when you want it, is **canonicalization**: `encode(decode(y)) == canonicalize(y)`, plus `decode(canonicalize(y)) == decode(y)`. Two properties, both true, and stating them forces you to notice that your format has a canonical form and to define it.

#### 2.5.2 Invariant preservation

```
valid(x)  ⟹  valid(op(x))
```

For every operation `op` in your API. The workhorse for data structures. State the invariant once as a `check_invariant()` function that walks the structure and asserts every structural rule, then assert it after every mutation. This function is also the best debugging tool you will have for that structure, so it pays for itself twice.

The discipline that makes it work: **write the invariant checker before the data structure**, and make it paranoid. If a B-tree invariant checker only verifies "keys are sorted within a node" it will miss almost everything. See §2.7.4.

#### 2.5.3 Idempotence

```
f(f(x)) == f(x)
```

For normalization, canonicalization, deduplication, sorting, path cleaning, `trim`, `absolute()`, `simplify()`, and — importantly — most operations exposed over a network that claim to be safely retryable. A surprising number of "normalize" functions are not idempotent, and it is always a bug: `strip_trailing_slash("//")` and `path_normalize("a/../..")` are the classic offenders. The property costs one line and catches a real class of defect.

#### 2.5.4 Oracle / differential

```
mine(x) == reference(x)
```

The strongest property available, when you can get an oracle. Sources of oracles:

- **A simple, obviously-correct, slow implementation.** Bubble sort against your quicksort. Linear scan against your B-tree. `O(n²)` against your `O(n log n)`. This is nearly always available and nearly always worth writing — the naive version takes ten minutes and grades the fast version forever.
- **A different implementation of the same spec.** Your UTF-8 decoder against ICU or simdutf. Your allocator against the system one (for behaviour, not layout). Your regex engine against `std::regex`.
- **The same implementation at a different optimization level or with a different backend.** Your SIMD path against your scalar path — this is the single most valuable property in any vectorized code, and `algorithms-on-real-hardware.md` should be read alongside it.
- **A model in a different language.** A 30-line Python reference.

This shape scales all the way up: applied to two independent implementations with a *fuzzer* generating the inputs, it becomes differential fuzzing (§3.10), which is how a large fraction of real-world crypto and compiler bugs get found.

#### 2.5.5 Metamorphic relations

Used when **no oracle exists** — you cannot say what the right answer is, but you can say how the answer must *change* when the input changes in a known way. This is the property shape for code where correctness is not independently computable.

| Domain | Metamorphic relation |
|---|---|
| Sorting | `sort(shuffle(xs)) == sort(xs)`; `sort(xs ++ ys)` is a merge of `sort(xs)`, `sort(ys)` |
| Compression | `len(compress(xs ++ xs)) < 2 * len(compress(xs)) + c` for large repetitive `xs` |
| Search / ranking | adding a document that does not match must not change the ranking of matches |
| Shortest path | `dist(a,c) <= dist(a,b) + dist(b,c)`; adding an edge never increases any distance |
| Floating point | `f(x)` and `f(-x)` for an odd function; scaling invariances |
| **Compilers** | **EMI — Equivalence Modulo Inputs.** Run a program, record which statements never executed, delete some of them, recompile. The new program must behave identically on that input. Le, Afshari and Su (PLDI 2014) found hundreds of GCC and LLVM bugs with this and nothing else. It is the cleverest metamorphic relation in the literature and worth studying on its own. |
| Machine learning | permuting input features that the model claims not to use must not change the output |

Metamorphic testing is dramatically underused relative to its power, and it is the right answer whenever a student says "but I can't test this, I don't know what the answer should be."

#### 2.5.6 Model-based / stateful properties

The composite shape, and the one that finds the deepest bugs in stateful code. Instead of generating a *value*, generate a **sequence of commands**, and run it against both the real system and a trivially-correct model, comparing after each step.

```cpp
// sketch: generate a random command sequence over a B-tree
struct Model { std::map<int,int> m; };          // the oracle
// commands: Insert(k,v), Erase(k), Lookup(k), Iterate()
// after each command:
//   - apply to real and to model
//   - assert the return values agree
//   - assert real.check_invariant()
//   - occasionally assert full iteration order agrees
```

Everything from §2.2 applies: generate *valid* sequences by construction (do not filter), bias toward small key spaces (so collisions and re-insertions actually happen — a key space of 2³² produces a tree that is never interesting; a key space of 0–15 produces one that is nothing but interesting), and bias toward long sequences of `Insert` followed by long sequences of `Erase` so that node merges and root collapses actually occur.

Shrinking on command sequences is where the technique becomes magic: a 400-command failure shrinks to *"insert 0, insert 1, erase 0, lookup 1 → returns nothing"*, which is a bug report. RapidCheck has first-class support for this (`rc::state::check`), as do Hypothesis (`RuleBasedStateMachine`), Hedgehog, and PropEr. It is the single highest-value property-testing feature and the least-known.

### 2.6 The tools

| Tool | Language | Shrinking model | Notes |
|---|---|---|---|
| **QuickCheck** | Haskell (Claessen & Hughes, ICFP 2000) | Type-directed | The original. The ICFP 2000 paper is short, readable, and worth reading in full — it invents the whole field in 12 pages. Ports exist for ~every language, most of which inherited the type-directed shrinking and its problems. |
| **Hypothesis** | Python | Internal / byte-stream | The most sophisticated implementation in wide use. Its shrinker is the reason people who try it keep using it. `@given`, `@example` (pin a regression), the `.hypothesis/examples` database that *remembers past failures and replays them first* — which quietly turns every property test into a growing regression suite. `RuleBasedStateMachine` for §2.5.6. |
| **RapidCheck** | **C++11** | Integrated (rose-tree) | The C++ one to use. Header + small library, `rc::check`, `Gen<T>` combinators, GoogleTest and Catch integration (`RC_GTEST_PROP`, `RC_ASSERT`), and `rc::state` for model-based testing. Not heavily maintained but stable and sufficient. |
| **Hedgehog** | Haskell / F# / others | Integrated | Where integrated shrinking was popularized. Explicit generators, no typeclass magic. |
| **proptest** | Rust | Internal-ish (persistent strategies) | Directly Hypothesis-inspired. |
| **fast-check** | JavaScript / TypeScript | Integrated | The best in the JS ecosystem by a distance. |
| **jqwik** | Java | Integrated | JUnit 5 integration. |
| **PropEr** / **QuickCheck (Quviq)** | Erlang | — | Quviq's commercial QuickCheck's stateful testing found real bugs in AUTOSAR automotive components; the Erlang lineage is where model-based property testing was pushed hardest in industry. |

C++ note: RapidCheck is the practical choice, but it is worth telling students that **you do not need a framework**. A property test is a loop, a seeded PRNG, and an assertion. Fifteen lines gets you generation; the thing a framework really buys you is *shrinking*, and a crude shrinker (halve the container, then zero individual elements, repeat until no candidate fails) is another twenty lines and teaches more than importing one. §6 Unit 2 does exactly this.

### 2.7 This curriculum's exercises are property-testing shaped

The prompt for this document is right that the existing exercises are unusually good fits. Concretely:

#### 2.7.1 UTF-8 decoder (see `numbers-text-numerics.md`)

The best single property-testing exercise in the whole curriculum, because the specification is small, total, adversarial, and public.

| Shape | Property |
|---|---|
| Round-trip | For every scalar value `cp` in `[0, 0x10FFFF] \ [0xD800, 0xDFFF]`: `decode(encode(cp)) == (cp, expected_len(cp))` |
| Length law | `len(encode(cp))` is 1/2/3/4 exactly per the range table — a separate property, because a decoder that accepts overlongs will pass round-trip |
| **Totality** | For **every** byte sequence — valid or not — `decode` returns either a scalar value or an error, never reads past the end, and always reports a consumed length ≥ 1. This is the property that matters and the one a fuzzer will destroy you on. |
| Rejection | Overlong encodings (`C0 80`), surrogates encoded in UTF-8 (`ED A0 80`), values > `U+10FFFF` (`F4 90 80 80`), continuation bytes as a lead (`80`), truncated sequences, and the 5- and 6-byte forms must all be rejected |
| Resynchronization | WHATWG's *maximal subpart* rule: an invalid sequence consumes exactly the maximal valid prefix and emits one `U+FFFD`. Getting this wrong is invisible to round-trip testing and visible instantly to a differential test |
| Differential | Against `simdutf`, ICU, or Björn Höhrmann's DFA decoder — three independent implementations, all small enough to vendor |
| Metamorphic | Splitting the input at a code-point boundary and decoding the halves gives the concatenation of the results |

And the payoff: the *same* decoder becomes the §3 fuzz target with a two-line `LLVMFuzzerTestOneInput`, and under ASan the totality property becomes enforceable rather than merely asserted. Same code, three techniques, escalating strength.

#### 2.7.2 Huffman codec (see `information-theory-coding.md`)

| Shape | Property |
|---|---|
| Round-trip | `decompress(compress(x)) == x` for all `x` — including the three inputs that break every first implementation: `""`, `"a"`, and `"aaaaaaaa"` (single-symbol alphabet; the naive tree has one node and assigns a zero-bit code, and the decoder loops forever) |
| Invariant | The code table is prefix-free: no code is a prefix of another. Check it directly by trie insertion. |
| Invariant | **Kraft inequality**: `Σ 2^(-len_i) ≤ 1`, with equality for a complete code. One line, and it catches an entire class of tree-construction bug. |
| Oracle | For alphabets of ≤ 8 symbols, brute-force all code-length assignments and assert the Huffman result achieves the minimum `Σ freq_i × len_i`. This tests *optimality*, which round-trip cannot see. |
| Idempotence | Canonical-Huffman: rebuilding the code table from the code *lengths* must reproduce the same table. |
| Metamorphic | `len(compress(x)) ≤ len(x) * 8 + header` — no expansion beyond a bound. And a doubled input compresses to less than double. |
| Differential | Against a reference DEFLATE-style Huffman, or your own decoder against a table-driven one |

#### 2.7.3 Allocator (see `cpp-linux-systems.md`, `os-and-platforms.md`)

Model-based (§2.5.6) is the right shape. Generate command sequences over `{alloc(size), free(handle), realloc(handle, size)}`, biasing sizes toward `0, 1, 8, 15, 16, 17, alignment-1, page-1, page, page+1`.

| Shape | Property |
|---|---|
| Invariant | Every returned pointer is suitably aligned (`alignof(std::max_align_t)`, or the requested alignment) |
| Invariant | **Live blocks never overlap.** Maintain a shadow map of `[ptr, ptr+size)` intervals in the test and assert disjointness on every `alloc`. |
| Invariant | Every returned block lies within the arena |
| **Memory integrity** | Fill each block with a per-handle byte pattern on allocation; verify the pattern on every subsequent operation. This catches the allocator writing metadata into a live block — the single most common custom-allocator bug and one that no structural invariant sees. |
| `realloc` law | `realloc(p, n)` preserves `min(old_size, n)` bytes |
| Exhaustion | `alloc` returning null must leave the heap fully intact and usable |
| Metamorphic | Free-then-alloc of the same size in a quiescent heap returns to the same total-free-bytes state (tests coalescing) |

Bonus, and it is a beautiful one: instrument the custom allocator with `__asan_poison_memory_region` / `__asan_unpoison_memory_region` so that **ASan enforces the allocator's own contract** — a read of freed memory from your arena becomes a real ASan report with two stack traces. This is a documented ASan feature for exactly this purpose, and it is the moment students see that sanitizers are programmable rather than magic.

#### 2.7.4 B-tree (see `storage-filesystems-engines.md`)

Model-based against `std::map`, with a paranoid invariant checker. The invariants worth checking, all of them, every time:

1. Keys within each node are strictly increasing.
2. For an internal node with keys `k₁..kₙ` and children `c₀..cₙ`: every key in `cᵢ₋₁` is `< kᵢ` and every key in `cᵢ` is `≥ kᵢ` — checked by passing down `(lo, hi)` bounds recursively. **This is the invariant that catches real bugs**; checking only rule 1 catches almost nothing.
3. All leaves are at the same depth.
4. Every node except the root has between `⌈m/2⌉−1` and `m−1` keys (the occupancy bound — violated by buggy delete/merge, and invisible to any lookup test).
5. Child count == key count + 1.
6. The root has ≥ 1 key unless the tree is empty; if the root is internal it has ≥ 2 children.
7. In-order traversal yields exactly the model's keys in order.
8. (If persistent) every page referenced is allocated, and no page is referenced twice — a cheap leak/aliasing check.

Generation bias that makes it work: a **small key space** (0–31, not 0–2³²), so that duplicate inserts, deletes of absent keys, and repeated splits of the same node actually occur; and command sequences long enough (hundreds) to force root splits and root collapses. Delete-heavy phases are where the bugs are, because rebalancing on delete is the hardest part of a B-tree and the part most people never test.

---

## 3. Fuzzing

This is the centre of the document. It is also the section that closes the loop the curriculum currently leaves open: `hardware-security.md` teaches what a heap overflow is and how it becomes arbitrary code execution; this section teaches **how those bugs are found**, which in practice means a coverage-guided mutation loop running under a sanitizer on a continuous fleet.

### 3.1 Three generations, and why the third one changed everything

**Generation 1: random input (1990).** Barton Miller, Lars Fredriksen and Bryan So, **"An Empirical Study of the Reliability of UNIX Utilities"** (*CACM* 33(12), December 1990). The origin story is famous and worth telling: Miller was connected to a UNIX machine over a dial-up line during a thunderstorm; line noise was corrupting the characters he typed, and the utilities were *crashing*. He turned that into a study. They wrote a program called `fuzz` that emitted random characters and piped it into ~90 standard UNIX utilities. **Between 25% and 33% of them crashed or hung.** The paper is three pages of embarrassment for the industry and it invented the field. Repeats of the study in 1995 and 2000 found the rate had improved but not vanished; a 2020 repeat on macOS utilities found it had not vanished either.

The lesson of generation 1 is that programs are much less robust to unexpected input than their authors believe, and that this is discoverable with almost no cleverness. The limit is equally clear: purely random bytes get past a `if (memcmp(buf, "\x89PNG", 4))` check with probability 2⁻³², so generation-1 fuzzing tests input validation and nothing behind it.

**Generation 2: mutation of real inputs (2000s).** Instead of random bytes, take a corpus of *valid* files and randomly corrupt them. Now you start past the magic number. This is how most 2000s-era file-format fuzzing worked, and it found a great deal. Its limit is that it is *blind*: it has no idea whether a mutation made progress, so it spends the same effort on the millionth mutation of a seed as on the first, and it never learns.

**Generation 3: coverage-guided (AFL, 2013 onwards).** Add one feedback signal — *did this input execute a code edge no previous input executed?* — and keep the input in a corpus if so. This one change converts a blind random walk into a **hill climb over the program's control-flow graph**, and it is the entire reason modern fuzzing works. Michał Zalewski's AFL demonstrated the point with a result that is still the best single advertisement for the technique: starting from a corpus containing only the string `"hello"`, AFL synthesized syntactically valid JPEG files, because each incremental step toward a valid header unlocked new coverage and was therefore retained. Nobody told it what a JPEG was.

That is the mechanism to teach. Everything else in this section is engineering around it.

### 3.2 The coverage-guided loop, mechanically

Here is the whole algorithm. It is about fifteen lines, and the rest of the section is elaboration on each one.

```
corpus   = seed_inputs                    # a set of byte strings
coverage = {}                             # global set of edges ever seen

loop forever:
    input  = pick(corpus)                 # weighted by a "power schedule"
    mutant = mutate(input)                # bit flips, splices, dictionary tokens...

    reset(edge_counters)                  # per-execution table, ~64 KB
    result = run_target(mutant)           # instrumented: writes edge_counters

    if result == CRASH or SANITIZER_ABORT or ASSERT or TIMEOUT:
        save_to(crashes, mutant)          # ← this is a bug report
        continue

    new = bucketize(edge_counters) - coverage
    if new is not empty:                  # ← the entire feedback mechanism
        coverage |= new
        corpus.add(mutant)                # the mutant becomes future breeding stock
        maybe_trim(mutant)                # shrink it while preserving its coverage
```

Four things in that loop deserve to be understood properly.

#### 3.2.1 Instrumentation: how `edge_counters` gets written

The compiler inserts a counter update at every **edge** of the control-flow graph. In LLVM this is **SanitizerCoverage** (`-fsanitize-coverage=...`), the same subsystem that backs libFuzzer.

The important variants, roughly in order of increasing sophistication:

| Flag | What the compiler inserts | Used by |
|---|---|---|
| `trace-pc-guard` | A call to `__sanitizer_cov_trace_pc_guard(uint32_t *guard)` at each edge, plus a per-module `__sanitizer_cov_trace_pc_guard_init(start, stop)` call at startup so you can assign IDs. **You supply both functions.** This is the hook for writing your own fuzzer. | hand-rolled fuzzers; §6 Unit 2 |
| `inline-8bit-counters` | An inlined `counter[k]++` — no call at all. Much faster. Exposed via `__sanitizer_cov_8bit_counters_init(start, stop)`. | libFuzzer (default) |
| `pc-table` | A parallel table mapping counter index → program counter, so a crash can be symbolized | libFuzzer, coverage reporting |
| `trace-cmp` | Callbacks at every comparison instruction and switch, carrying **both operands** | libFuzzer value profile; AFL++ cmplog/RedQueen |
| `trace-div`, `trace-gep` | Callbacks on divisions (find div-by-zero) and on GEP (array indexing, find OOB indices) | specialized |
| `no-prune` | Disable the compiler's coverage-point pruning; more counters, more precision, slower | when you want maximum signal |

Note the design: `-fsanitize-coverage` is deliberately **cheap and coarse**. It does not know about source lines. It is a flat array of byte counters indexed by an integer the compiler assigned. That is what lets it run in a loop executing 100,000 times a second. Compare `-fprofile-instr-generate` from §1.6.1, which is precise, source-mapped, and far too slow for this. **Same idea, two operating points, and knowing that they are the same idea is the insight.**

AFL's original (non-LLVM) instrumentation is worth showing because it is three lines and it explains what "edge" means:

```c
cur_location = <COMPILE_TIME_RANDOM>;               // unique per basic block
shared_mem[cur_location ^ prev_location]++;         // ← the edge is the XOR of two blocks
prev_location = cur_location >> 1;                  // >>1 so that A→A and A→B differ
```

The map is 64 KB by default (`MAP_SIZE = 1 << 16`). Two consequences follow immediately and are worth making students derive: (a) edge identity is a *hash*, so **collisions** are possible and a large program will silently lose some edges — which is why AFL++'s LTO mode, which assigns collision-free IDs at link time, is a real improvement; and (b) the `>> 1` exists so that the edge A→B and the edge B→A are distinguishable, and so that a self-loop A→A does not hash to zero.

#### 3.2.2 Bucketing: why hit *counts* are quantized

Naively you would treat "edge executed 41 times" and "edge executed 42 times" as different coverage. That is a disaster: a loop bound that varies with input length would make every input "new", the corpus would explode, and the signal would drown.

Naively the other way, you would treat coverage as a pure bit set: edge hit or not. That loses real information — the transition from "loop executed once" to "loop executed twice" is often exactly the discovery you want.

AFL's answer, adopted nearly universally, is to **bucket the counters** into powers-of-two-ish classes before comparing:

```
1, 2, 3, 4–7, 8–15, 16–31, 32–127, 128+
```

Eight buckets, one byte. A new *bucket* for an edge counts as new coverage; a new count within the same bucket does not. This gives you loop-depth sensitivity while keeping the corpus bounded, and it is a genuinely elegant piece of engineering-by-compromise that students should be shown.

#### 3.2.3 The corpus is a coverage-maximizing set, not a list of test cases

The corpus is not "the inputs we tried". It is a **minimal-ish set of inputs whose union of coverage equals everything the fuzzer has ever reached** — a greedy approximation to a set cover. Every entry is there because at the moment it was added it did something no other entry did.

This is why the corpus is the fuzzer's memory, why it is worth persisting across runs (OSS-Fuzz does exactly this — see §3.12), why it is worth *sharing* between machines in a fleet, and why the single highest-leverage thing you personally control is the *seed* corpus (§3.9).

It is also why the corpus needs periodic **minimization**: as better inputs are found, older entries become redundant, and a bloated corpus wastes time re-executing inputs that teach nothing.

#### 3.2.4 Power schedules: which corpus entry to mutate next

`pick(corpus)` is not uniform. The fuzzer assigns each entry an **energy** — how many mutants to generate from it — based on heuristics: prefer inputs that are small (cheaper to run, and their mutations are more likely to be meaningful), fast, recently-added, and that exercise **rare** edges (an input that is the only one reaching some edge is precious). AFL++ ships several named schedules (`fast`, `coe`, `explore`, `exploit`, `rare`, `seek`); libFuzzer since ~2019 defaults to an **entropic** schedule based on Böhme et al.'s "Entropic: Boosting LibFuzzer Performance" (ESEC/FSE 2020), which weights an input by how much information its mutations are expected to reveal.

This is directly observable. In a live run against the Compiler Explorer API on 2026-09-01 (§6.2), libFuzzer's first line of output was:

```
INFO: Running with entropic power schedule (0xFF, 100).
```

Power scheduling is where a lot of academic fuzzing research lives. For teaching purposes the important point is just that it exists and why: **the corpus is a search frontier, and choosing where to expand it is the search strategy.**

### 3.3 Mutation strategies

`mutate()` is a weighted choice among a small vocabulary of operators. The vocabulary is worth memorizing because it is short and because it explains what fuzzers can and cannot find.

| Operator | What it does | Finds |
|---|---|---|
| **Bit flip** | Flip 1, 2, or 4 adjacent bits | Flag bits, parity, small enum changes |
| **Byte flip** | Flip 1, 2, or 4 adjacent bytes | Larger structural changes |
| **Arithmetic** | Add/subtract a small delta (±1..35) to an 8/16/32-bit field, both endiannesses | **Off-by-one and boundary bugs.** The single most productive operator for length fields. |
| **Interesting values** | Overwrite a field with a value from a hard-coded table: `0, 1, -1, 16, 32, 64, 100, 127, 128, 255, 256, 32767, 32768, 65535, 65536, INT_MAX, INT_MIN`… | Integer overflow, sign confusion, allocation-size bugs |
| **Dictionary token** | Insert or overwrite with a token from a user-supplied `-dict` file (`"SELECT"`, `"\xff\xd8\xff"`, `"</script>"`) | Magic values and keywords random bytes will never produce |
| **Splice / crossover** | Take the first half of one corpus entry and the second half of another | Structural recombination — the genetic-algorithm move |
| **Block delete / duplicate / repeat** | Remove a chunk, clone a chunk, repeat a byte N times | Length-handling bugs, buffer overflows via long fields, nesting-depth blowups |
| **Havoc** | Apply a random *stack* of the above (2–128 of them) in one shot | Escaping local minima; AFL spends most of its time here |

AFL's classic structure was a **deterministic stage** (walk every bit position, every byte position, systematically) followed by a **havoc stage** (random stacking) and a **splice stage**. AFL++ makes the deterministic stage optional and usually off, because empirically havoc dominates on most targets.

libFuzzer's mutator set is directly observable in its logs — each `NEW`/`REDUCE` line reports the mutation chain that produced the input. From the live Compiler Explorer run on 2026-09-01:

```
#12     NEW    cov: 3 ft: 3 corp: 2/5b lim: 4 ... MS: 5 CrossOver-InsertByte-CopyPart-ChangeBit-CrossOver-
#12765  NEW    cov: 4 ft: 4 corp: 3/26b lim: 32 ... MS: 3 ShuffleBytes-ShuffleBytes-InsertRepeatedBytes-
#13100  REDUCE cov: 4 ft: 4 corp: 3/20b lim: 32 ... MS: 1 EraseBytes-
#290028 NEW    cov: 6 ft: 6 corp: 5/17b lim: 32 ... MS: 1 ChangeByte-
```

`MS: n` is the number of stacked mutations, followed by the chain. `cov` is edges covered, `ft` is "features" (edges plus value-profile signals), `corp: 5/17b` is five corpus entries totalling 17 bytes, `lim` is the current length limit (libFuzzer grows it over the run), `L: 4/4` is this input's length and the corpus max. `REDUCE` means the input covers the same features as an existing corpus entry but is *smaller*, so it replaces it — **that is corpus trimming happening continuously and automatically**, and it is the same idea as property-test shrinking from §2.4.

Reading this output is a genuine skill and it should be taught explicitly. `cov` stuck flat for a million executions means the fuzzer is wedged on a comparison it cannot guess — go add a dictionary, or a custom mutator, or check whether the target is even reachable.

### 3.4 libFuzzer

**Model: in-process, persistent.** libFuzzer links into your binary, replaces `main`, and calls your function in a loop inside a *single process*. There is no `fork`, no `exec`, no IPC. This makes it extremely fast — hundreds of thousands of executions per second on a small target is normal — and it is the reason libFuzzer became the default for library fuzzing.

**The contract.** You write exactly one function:

```cpp
extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);
```

and compile with `-fsanitize=fuzzer` (which both instruments and links the driver). The requirements are strict and are consequences of the in-process design — quoting the substance of the LLVM documentation (verified against `llvm.org/docs/LibFuzzer.html`, 2026-09-01):

| Requirement | Why | What breaks if you violate it |
|---|---|---|
| **Must tolerate any input** — empty, huge, malformed, truncated | The fuzzer will produce all of them within seconds | A `assert(size > 0)` at the top makes the fuzzer report a "bug" it created itself, and it will report nothing else ever again |
| **Must not call `exit()`** | It would kill the fuzzer, not the test case | The run ends after one input |
| **Must be deterministic** | Same input must give same coverage, or the corpus is meaningless | Corpus fills with duplicates; coverage signal becomes noise |
| **Must not accumulate global state** | Every execution shares one address space | Memory grows until OOM; and input *N* behaves differently depending on inputs 1..*N*−1, destroying reproducibility |
| **Should be fast** — ideally well under 100 µs | Throughput is the whole game | 10 ms per exec = 100 exec/s = the fuzzer explores nothing |
| **Should join all threads before returning** | Background threads race with the next execution | Nondeterminism and spurious crashes |
| Return `0` normally; `-1` to tell libFuzzer not to add the input to the corpus | | |

The flags worth knowing:

```
-runs=N              stop after N executions (-1 = forever). Essential for CI and for §6.
-max_total_time=S    stop after S seconds
-max_len=N           cap input length (default grows adaptively; capping helps focus)
-seed=N              fix the PRNG seed — determinism for teaching and for bisecting
-dict=FILE           dictionary of tokens (see §3.7)
-jobs=N -workers=N   parallel fuzzing with corpus sharing via the corpus directory
-fork=1              run each batch in a forked child, so an OOM or a hang does not kill the run
-merge=1 NEW OLD...  corpus minimization: fill NEW with the subset of OLD that preserves coverage
-minimize_crash=1    shrink a crashing input while preserving the crash (the §2.4 shrinker again)
-use_value_profile=1 enable value-profile feedback (requires trace-cmp instrumentation)
-print_final_stats=1 summary at exit
-rss_limit_mb=N      OOM threshold (default 2048); -malloc_limit_mb for single allocations
```

**Value profile** (`-use_value_profile=1`) is the mechanism that gets a fuzzer past multi-byte comparisons. With `trace-cmp` instrumentation, every comparison reports both operands, and libFuzzer treats *how many high bits of the two operands match* as a coverage-like feature. So `if (x == 0xDEADBEEF)` produces a gradient: an input where `x == 0xDEAD0000` is "closer" than one where `x == 0x00000000`, gets saved to the corpus, and the search climbs. Without it, a 4-byte equality check is a 2⁻³² wall. It costs roughly 2× throughput and it is usually worth it.

**Extension points.**

```cpp
// one-time setup; use only if you need argc/argv — otherwise prefer a function-local static
extern "C" int LLVMFuzzerInitialize(int *argc, char ***argv);

// structure-aware mutation (§3.7)
extern "C" size_t LLVMFuzzerCustomMutator(uint8_t *data, size_t size,
                                          size_t max_size, unsigned seed);
extern "C" size_t LLVMFuzzerMutate(uint8_t *data, size_t size, size_t max_size);  // call back in
extern "C" size_t LLVMFuzzerCustomCrossOver(const uint8_t *a, size_t na,
                                            const uint8_t *b, size_t nb,
                                            uint8_t *out, size_t max_out, unsigned seed);
```

**When libFuzzer is the wrong tool** — from its own documentation, and worth teaching because knowing a tool's limits is the mark of understanding it:

- targets that legitimately crash or `abort()` on invalid input (a strict validator with `CHECK`s) — the fuzzer cannot distinguish "correctly rejected" from "bug";
- libraries with global state that cannot be reset between runs;
- libraries that spawn persistent background threads;
- targets where a single run takes more than ~100 ms;
- APIs that take a *file path* rather than a buffer (though `LLVMFuzzerTestOneInput` can write a temp file — at a large throughput cost);
- anything using `dlclose`.

**Status note (2026).** libFuzzer is in maintenance mode within LLVM — it receives fixes but not feature work, and Google's own infrastructure has been shifting toward **Centipede** (out-of-process, designed for slower and larger targets) and AFL++. It remains the right thing to *teach*, because it is the simplest complete embodiment of the coverage-guided loop, it is available in every Clang installation with a single flag, and — verified live — it works on Compiler Explorer. But do not tell students it is the future.

### 3.5 AFL++

**Model: out-of-process, with two large optimizations.**

**The fork server** is AFL's foundational trick and it is worth teaching as a systems-programming idea in its own right. The naive approach — `execve` the target once per input — pays for process creation, dynamic linking, libc initialization, and the target's own startup on every single test case. That is milliseconds; it caps you at maybe a thousand executions per second.

Instead, the instrumentation inserts a **fork server** into the target: at the first instrumented point (conceptually, the start of `main`), the target stops and waits on a pipe. For each test case, the *fuzzer* sends a command, and the **stopped target `fork()`s itself**. The child has already paid for `execve`, dynamic linking, and libc init — it inherits all of that copy-on-write — and it simply runs. AFL's documentation claims roughly a **2× improvement** over `execve` per case, and considerably more for targets with heavy startup. The **deferred fork server** (`__AFL_INIT()`) pushes the fork point later still, past *your* expensive initialization — parsing a config, loading a model, building a table — so that work is done once for the whole campaign rather than once per input.

**Persistent mode** goes further and converges on libFuzzer's design:

```c
int main(int argc, char **argv) {
    __AFL_INIT();                              // deferred fork server: fork point is here
    unsigned char *buf = __AFL_FUZZ_TESTCASE_BUF;
    while (__AFL_LOOP(10000)) {                // reuse this process for 10000 inputs
        int len = __AFL_FUZZ_TESTCASE_LEN;
        target_function(buf, len);
    }
    return 0;
}
```

`__AFL_LOOP(N)` runs up to *N* iterations in one process before the process is recycled (recycling bounds the damage from accumulated state and leaks). AFL++ documents this as another **10–20×** on top of the fork server. AFL++ also accepts a plain `LLVMFuzzerTestOneInput` and wraps it, so a libFuzzer target can be fuzzed by AFL++ without modification — which is the practical reason to write libFuzzer-shaped targets even if you intend to run AFL++.

**Instrumentation modes:**

| Mode | Compiler | Notes |
|---|---|---|
| `afl-clang-fast` | LLVM pass | The default. Edge instrumentation via an LLVM pass. |
| `afl-clang-lto` | LLVM + link-time | **Collision-free edge IDs**, assigned at link time when the whole program is visible. Strictly better signal on large targets; requires LTO to work in your build. |
| `afl-gcc-fast` | GCC plugin | For GCC-only builds |
| QEMU mode (`-Q`) | none | **Binary-only targets** — instruments via QEMU user-mode emulation. ~2–5× slower but requires no source. |
| Frida mode (`-O`) | none | Binary-only via Frida; works where QEMU mode does not (including some closed-source libraries on macOS/ARM) |
| Unicorn mode | none | Fuzzing raw firmware blobs / arbitrary architectures |
| `nyx` | hypervisor | Full-system snapshot fuzzing (kernels, hypervisors) |

**AFL++'s distinctive features** (Fioraldi, Maier, Eißfeldt and Heuse, "AFL++: Combining Incremental Steps of Fuzzing Research", USENIX WOOT 2020):

- **CmpLog / RedQueen** — the most important one. Based on the RedQueen paper's insight of **input-to-state correspondence**: if a program compares a variable against a magic value, the *input bytes* that produced that variable very often appear *literally, unchanged* in the input. So: instrument comparisons to log both operands, then for each comparison, search the input for the bytes of operand A and replace them with operand B. This gets you past `if (hdr->magic == 0xCAFEBABE)` and past most length checks **without any solver**, in essentially zero time. It captures the bulk of what symbolic execution promised (§3.11) at a rounding-error fraction of the cost, and it is a large part of why hybrid fuzzing did not take over.
- **laf-intel** — split multi-byte comparisons into byte-at-a-time comparisons at the IR level, so that coverage feedback gives a gradient for each byte instead of an all-or-nothing 32-bit check. A compile-time alternative to value profiling.
- **MOpt** — adapt the mutation-operator probability distribution online based on which operators are producing new coverage.
- **Custom mutators** — a documented plugin API (including a Python interface), which is the AFL++ answer to `LLVMFuzzerCustomMutator`.
- **Multiple power schedules** selectable per-instance, with the intended usage being a heterogeneous fleet: one instance on `explore`, one on `exploit`, one on `rare`, all sharing a corpus directory.

**libFuzzer vs AFL++, honestly:**

| | libFuzzer | AFL++ |
|---|---|---|
| Process model | In-process, one process | Fork server + optional persistent mode |
| Setup cost | One flag, one function | A compiler wrapper, a driver, a corpus dir |
| Raw speed on a small pure function | Highest | Close, with persistent mode |
| Robustness to target OOM/hang/`exit()` | Poor (the whole fuzzer dies) — mitigated by `-fork=1` | Good — the child dies, the fuzzer notices and continues |
| Binary-only targets | No | Yes (QEMU/Frida/Unicorn) |
| Whole-program / CLI targets | Awkward | Native — it was designed for `./target @@` |
| Getting past magic values | Value profile | CmpLog/RedQueen, generally stronger |
| Maintenance status (2026) | Maintenance mode | Actively developed |
| Best for | A library API you own | A binary, a CLI tool, a complex target, a long campaign |

The practical advice: **write the target in libFuzzer shape** (`LLVMFuzzerTestOneInput`), because it is the portable interface — libFuzzer runs it, AFL++ runs it, Honggfuzz runs it, Centipede runs it, and OSS-Fuzz builds it under all of them.

**Honourable mentions.** **Honggfuzz** (Robert Świecki) — a third engine, strong on feedback via hardware performance counters (Intel PT/BTS) and on multi-process targets; one of OSS-Fuzz's three engines. **Centipede** — Google's newer out-of-process engine for large/slow targets. **syzkaller** — not a file-format fuzzer at all but a *system-call* fuzzer for the Linux kernel, which generates and mutates sequences of syscalls with a declarative description of their argument types; its continuous instance **syzbot** has reported thousands of kernel bugs and is arguably the highest-impact deployment of fuzzing anywhere. **FuzzTest** (Google) is worth calling out separately because it explicitly *merges* §2 and §3: you write a property with typed domains (`FUZZ_TEST(Suite, Property).WithDomains(Arbitrary<std::string>(), InRange(0, 100))`) and the same test runs as a fast unit test in CI *and* as a coverage-guided fuzzer in a fuzzing job. That convergence is the direction the field is going and is worth showing students at the end of the unit.

### 3.6 Fuzzing plus sanitizers is the combination that finds bugs

**This is the single most important claim in the document, so it gets its own section and it gets stated bluntly: a fuzzer without a sanitizer finds almost nothing, and a fuzzer with one finds a great deal. The fuzzer is a search engine. The sanitizer is the oracle. Neither half works alone.**

Go back to §0.1. A fuzzer generates inputs; it has no concept of "correct". Its only built-in bug detector is *the process died*. So without additional instrumentation, the only bugs it can find are the ones that happen to crash the process on their own.

Consider what that excludes in C and C++:

| Bug | Does it crash on its own? | What actually happens |
|---|---|---|
| Heap buffer overflow of 3 bytes | **Almost never** | You overwrite the allocator's chunk header or the next object. The program continues. It corrupts data, or crashes ten seconds later somewhere unrelated, or is exploitable. |
| Stack buffer overflow of 16 bytes | Sometimes | If it reaches the saved return address, you may get a wild jump. If it hits other locals, nothing visible. |
| Use-after-free | **Rarely** | The allocator has not returned the page to the OS. The read returns stale data; the write corrupts whatever now lives there. |
| Double free | Sometimes | Modern glibc detects *some* patterns and aborts. Many patterns it does not. |
| Read of uninitialized memory | **Never** | You get whatever was on the stack. Fully deterministic-looking wrong behaviour. |
| Signed integer overflow | **Never** | UB. The optimizer may have already deleted your overflow check because of it. |
| Misaligned load | Never on x86 | UB on ARM in some cases, fine in others |
| Out-of-bounds read of 1 byte | **Never** | Reads adjacent memory. Returns a value. Continues. This is Heartbleed's shape. |
| Memory leak | Never | Grows until OOM, which in a fuzz run looks like a resource problem, not a bug |
| Data race | **Never** | Works fine 999 times out of 1000 |

Roughly: **without a sanitizer, a fuzzer finds the small minority of memory-safety bugs that are severe enough to segfault immediately, and silently walks past the rest** — including, notably, the entire class of small out-of-bounds reads that produce information disclosure, which is the class Heartbleed belonged to.

**With a sanitizer, every one of those becomes an immediate, loud, symbolized abort at the exact instruction that did it, with a second stack trace for the allocation (and a third for the free).** That is the difference between a fuzzing campaign that reports nothing and one that reports a CVE.

#### 3.6.1 Which sanitizer detects what

| Sanitizer | Flag | Detects | Cost | Composes with |
|---|---|---|---|---|
| **AddressSanitizer** | `-fsanitize=address` | Heap/stack/global buffer overflow (read and write), use-after-free, use-after-return (`-fsanitize-address-use-after-scope`, `ASAN_OPTIONS=detect_stack_use_after_return=1`), double free, invalid free, memcpy overlap | ~2× CPU, ~3× RAM | UBSan, LSan |
| **LeakSanitizer** | included in ASan; standalone `-fsanitize=leak` | Memory leaks at exit | small | ASan |
| **UndefinedBehaviorSanitizer** | `-fsanitize=undefined` | Signed overflow, shift overflow, null deref, misaligned access, invalid enum/bool values, invalid casts, unreachable, `float`→`int` overflow, and ~20 more checks selectable individually | ~20% | ASan |
| **MemorySanitizer** | `-fsanitize=memory` | **Reads of uninitialized memory** — nothing else can do this | ~3× | *not* ASan |
| **ThreadSanitizer** | `-fsanitize=thread` | Data races, lock-order inversions, some misuse of `std::atomic` | ~5–15× CPU, ~5–10× RAM | *not* ASan |

Two practical constraints that trip everyone:

1. **ASan and MSan and TSan are mutually exclusive.** They each want the whole address space's shadow. You build *separate binaries* and run *separate campaigns*. OSS-Fuzz builds each target under ASan, MSan and UBSan as three distinct jobs, and this is the right pattern.
2. **MSan requires that every library linked in is also MSan-instrumented**, including libc++ and often libc. Uninstrumented code writing to a buffer looks like it left it uninitialized, producing an avalanche of false positives. This is why MSan is much less used than ASan despite catching a bug class nothing else catches. OSS-Fuzz solves it by building all dependencies from source under MSan.

**The essential flag combination for a fuzz build:**

```
clang++ -std=c++20 -O1 -g -fno-omit-frame-pointer \
        -fsanitize=fuzzer,address,undefined \
        -fno-sanitize-recover=all \
        -fsanitize-address-use-after-scope \
        -UNDEBUG \
        target.cpp -o fuzz_target
```

Three of those are easy to omit and each omission silently costs you bugs:

- **`-fno-sanitize-recover=all`.** By default UBSan *prints and continues*. A fuzzer does not read the log; it only notices process death. Without this flag your UBSan findings scroll past forever and the fuzzer records nothing. This is the most commonly made mistake in the whole area.
- **`-UNDEBUG`** (or simply not passing `-DNDEBUG`). **Assertions are free oracles.** Every `assert(invariant)` in the code under test is a bug detector the fuzzer can trip, and it covers *logic* bugs that no sanitizer can see. A fuzz build with assertions compiled out has thrown away half its oracle for no reason. This is the cheapest possible improvement to any fuzzing setup: build with assertions on, and *add more assertions* to the code specifically because you fuzz it.
- **`-O1`.** Not `-O0` (too slow, and the fuzzer's throughput is its power) and usually not `-O2`/`-O3` (aggressive optimization can delete the very UB you are hunting — see §3.6.3).

And the runtime environment:

```
ASAN_OPTIONS=abort_on_error=1:detect_leaks=1:detect_stack_use_after_return=1:malloc_limit_mb=2048
UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1
```

#### 3.6.2 Sanitizers do not only detect memory errors — you can add your own oracles

The general shape is: **anything that can `abort()` on a violated property is a fuzzing oracle.** The fuzzer does not care where the abort came from. So the full oracle inventory for a fuzz target is:

1. The sanitizers (memory safety, UB, uninitialized reads, races).
2. `assert()` in the library under test — with assertions *enabled*.
3. **Assertions you write inside `LLVMFuzzerTestOneInput` itself** — this is the bridge to §2, and it is underused. A fuzz target can assert a *property*:

```cpp
extern "C" int LLVMFuzzerTestOneInput(const uint8_t *d, size_t n) {
    std::string in(reinterpret_cast<const char *>(d), n);
    auto encoded = encode(in);
    auto decoded = decode(encoded);
    assert(decoded == in);          // ← a round-trip property, driven by a fuzzer
    return 0;
}
```

That is a property test whose generator is a coverage-guided fuzzer. It finds the encoder/decoder mismatch, and ASan simultaneously finds the buffer overflow, in the same run. **This target shape — property assertion plus sanitizer plus coverage guidance — is the strongest single testing artifact available for a pure function in C++, and it is about eight lines of code.** It is what §6 Unit 3 builds toward.

4. A **differential** comparison against a second implementation (§3.10).
5. Timeouts, for algorithmic-complexity DoS bugs (quadratic blowup, regex catastrophic backtracking, hash flooding).
6. `-rss_limit_mb` / `-malloc_limit_mb`, for allocation-size bugs — a length field that becomes a `malloc(0xFFFFFFFF)` is a real bug class and libFuzzer catches it as an OOM.

#### 3.6.3 The gotcha worth planting deliberately: the optimizer deletes your bug

While verifying the exercises for §6 against the live Compiler Explorer API, a fuzz target containing this was written:

```cpp
if (n >= 4 && d[0]=='F' && d[1]=='U' && d[2]=='Z' && d[3]=='Z') {
    int *p = nullptr; *p = 1;      // "obvious" crash
}
```

Compiled at `-O1` with `-fsanitize=fuzzer,address`, libFuzzer ran **200,000 executions, reached full coverage of the function, and reported no crash.** The reason: a store through a null pointer is undefined behaviour, so the optimizer is entitled to assume the branch is unreachable and delete it. Nothing was left to crash.

A second attempt replaced the null store with a genuine stack overflow but ended the function with `return (int)buf[0] & 0;` — and Clang, noticing the result was unconditionally zero, deleted the entire body: libFuzzer reported **"1 inline 8-bit counter"** for the whole target, i.e. the function had been optimized into nothing.

Adding a `static volatile int sink; sink = buf[0];` fixed it, and the same fuzzer found the bug in **1.8 seconds** with a full ASan `stack-buffer-overflow` report.

This is not a footnote; it is one of the best lessons available, and it should be a deliberate exercise:

- **Undefined behaviour is not "a thing that crashes"; it is "a thing the compiler assumes cannot happen".** This is the same lesson as `compilers-interpreters-terminals-unix.md` teaches about `-fdelete-null-pointer-checks` and the notorious Linux `tun` driver null-check removal, arriving from a different direction.
- **A fuzz target must have an observable effect** or it will be optimized away, and the fuzzer will dutifully report full coverage of nothing.
- **This is a real reason to fuzz at `-O1` rather than `-O3`**, and a real reason ASan is not optional — ASan's checks are opaque to the optimizer and cannot be elided, which is exactly why the second version was caught and the first was not.

### 3.7 Structure-aware and grammar-based fuzzing

#### 3.7.1 The problem: fuzz blockers

Random mutation gets you to any input a few bit-flips away from a corpus entry. It does not get you past a *global constraint*. The canonical blockers:

| Blocker | Why mutation cannot pass | Probability of a random hit |
|---|---|---|
| **Checksum / CRC / hash over the payload** | Any mutation to the payload invalidates the checksum, so the parser rejects the input before reaching any interesting code. Coverage feedback then rewards nothing. | 2⁻³² per attempt, and *every* useful mutation is punished |
| **Magic numbers** | `if (memcmp(h, "\x89PNG\r\n\x1a\n", 8))` | 2⁻⁶⁴ — mitigated by dictionaries, value profile, CmpLog |
| **Cryptographic signature / MAC** | Unforgeable by construction | Zero |
| **Compressed container** | Mutating compressed bytes usually produces a decompression error, never interesting structured data | Effectively zero |
| **Deep grammar** | A JS engine's optimizer is behind a parser; random bytes are 99.99% syntax errors | Effectively zero |
| **Length/offset fields that must agree** | Mutating one without the other yields a rejected input | Low but not hopeless (arithmetic mutators help) |

The general remedy is the same in every case: **move the structure into the mutator, so that coverage feedback operates on semantics rather than on the syntax check.**

#### 3.7.2 The remedies, cheapest first

**1. A dictionary (`-dict`).** A flat list of tokens — magic bytes, keywords, tag names, opcodes. The mutator inserts them wholesale. Cost: fifteen minutes reading the format spec. Benefit: often enormous. This is the highest-return-per-effort action in fuzzing and it is skipped constantly. For a SQL parser, the dictionary is the keyword list; for PNG, the chunk names; for a protocol, the message-type constants. libFuzzer, AFL++ and Honggfuzz all consume the same simple format.

**2. Patch out the checksum, deliberately.** In a fuzz build only, replace the CRC verification with `return true`, or recompute the correct CRC over the mutated payload just before parsing. This is not cheating; it is **removing a check you already know works so the fuzzer can test the code behind it**. Every serious fuzzing setup for a checksummed format does this (OpenSSL, libpng, zlib all have such build flags or target-local fixups). The one discipline: keep the checksum path itself under test by a separate, small target.

**3. `FuzzedDataProvider` — the workhorse.** A header shipped with Clang (`<fuzzer/FuzzedDataProvider.h>`) that carves the raw byte buffer into typed values, consuming from opposite ends so that lengths and payloads do not fight:

```cpp
#include <fuzzer/FuzzedDataProvider.h>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    FuzzedDataProvider fdp(data, size);

    auto  capacity = fdp.ConsumeIntegralInRange<size_t>(0, 4096);
    bool  strict   = fdp.ConsumeBool();
    auto  mode     = fdp.ConsumeEnum<Mode>();
    auto  name     = fdp.ConsumeRandomLengthString(64);
    auto  payload  = fdp.ConsumeRemainingBytes<uint8_t>();

    Parser p(capacity, strict, mode);
    p.parse(name, payload);
    return 0;
}
```

This is 90% of practical structure-awareness, it costs nothing, and it composes with everything. Note what it buys you: the fuzzer's *byte-level* mutations now translate into *semantic* changes (a different mode, a different capacity), and coverage feedback rewards them. Note also the resemblance to §2.4.1(c): `FuzzedDataProvider` is a generator that is a deterministic function of a byte stream — **it is Hypothesis's architecture, in C++, driven by a fuzzer instead of a PRNG.** Once a student sees that, the two halves of this document snap together.

**4. `LLVMFuzzerCustomMutator` — mutate the structure, then serialize.** Decode the buffer into your typed structure, mutate the structure, re-encode (recomputing checksums), and hand the bytes back. Now every input the fuzzer produces is well-formed by construction.

**5. `libprotobuf-mutator` (LPM) — the industrial version of (4).** Google's library that mutates **protobuf messages** structurally and then hands you the typed message:

```cpp
#include "src/libfuzzer/libfuzzer_macro.h"
DEFINE_PROTO_FUZZER(const MyFormat &input) {
    std::string serialized = ConvertToRealFormat(input);   // proto → PNG / SQL / JS / …
    parse(serialized);
}
```

You describe the input format as a `.proto` schema. LPM mutates at the message level — add a repeated field, change an enum, delete a submessage, recurse — and never produces a structurally invalid message. The `ConvertToRealFormat` step is yours and is where the schema becomes the actual wire format, checksums and all. Chromium uses this for SQL (a proto grammar for SQLite statements) and for JavaScript; it is the standard answer for any format complex enough that a custom mutator would be a week's work.

Caveat worth teaching: LPM constrains the fuzzer to *your grammar*. Bugs in the code that handles inputs your grammar cannot express — malformed, truncated, adversarial — become unreachable. The correct pattern is **both**: an LPM target for depth and a raw-bytes target for robustness.

**6. Grammar-based fuzzers.** For languages: **Domato** (Google Project Zero — generative DOM/JS fuzzer, responsible for a long run of browser bugs), **Nautilus** (NDSS 2019 — grammar-aware *and* coverage-guided, which is the combination that matters), **Superion** (ICSE 2019 — grammar-aware greybox with tree-based mutation), **Gramatron** (ISSTA 2021 — grammar automata for better-distributed sampling). And **Csmith** (§3.10), which is purely generative — it emits random C programs that are guaranteed free of undefined behaviour, which is a much harder engineering problem than it sounds and is the reason the tool worked.

### 3.8 What a good fuzz target looks like

A checklist, because this is where most fuzzing effort is wasted:

**Do:**

- **Take the raw bytes and get to the interesting code in as few instructions as possible.** Every microsecond of setup is multiplied by hundreds of millions of executions.
- **One target per API surface, not one mega-target.** Splitting `fuzz_parse`, `fuzz_serialize`, `fuzz_roundtrip` into three targets gives three focused coverage frontiers instead of one where the fuzzer wastes 90% of its energy re-deciding which sub-API to invoke. If you must multiplex, use the *first byte* to select — libFuzzer will learn the split — but prefer separate binaries.
- **Assert properties inside the target** (§3.6.2). Free oracle.
- **Build with assertions on.** Free oracle.
- **Keep it deterministic.** No time, no `rand()`, no thread pools, no filesystem, no network. Where the library needs a clock or an RNG, inject a deterministic one — the same dependency-injection discipline as §1.4, arriving for a different reason.
- **Bound the work.** If a length field can request 4 GB, clamp it in the target (`if (n > 1<<20) return 0;`) so the fuzzer spends its time on logic rather than on OOMs — but only after you have confirmed that the unclamped case is handled, ideally with a separate target that *is* looking for allocation bugs.
- **Write a seed corpus** (§3.9). This is where the leverage is.
- **Reject uninteresting inputs early with `return -1`**, so libFuzzer does not add them to the corpus.

**Do not:**

- **Do not validate the input at the top of the target.** `if (size < 4) return 0;` is fine; `assert(is_valid_png(data))` is a catastrophe — the fuzzer's own generated inputs will trip it and you will spend your campaign rediscovering that random bytes are not PNGs.
- **Do not `exit()`, `abort()` on expected-invalid input, or install signal handlers.**
- **Do not leak.** In-process fuzzing means leaks accumulate across millions of executions until OOM. If the library legitimately owns memory for the process lifetime, use a function-local `static` initialized once.
- **Do not accumulate global state.** A cache, a memo table, a counter that changes behaviour — any of these make execution *N* depend on 1..*N*−1 and destroy both reproducibility and the corpus's meaning.
- **Do not log.** `fprintf` to stderr at 100,000 executions per second is the target's dominant cost and produces gigabytes of nothing.
- **Do not fuzz a wrapper that is 10 lines of parse and 10,000 lines of unreachable business logic.** Check your coverage report and confirm the fuzzer is actually *in* the code you care about. This is the single most common reason a campaign finds nothing, and it is diagnosable in five minutes with `llvm-cov` over the corpus.

**The diagnostic ritual when a campaign finds nothing**, in order:

1. Is the target reaching the code? — run `llvm-cov` over the corpus. Usually the answer is no.
2. Is `cov:` still climbing, or has it been flat for hours? Flat means wedged — look for a magic value or a checksum, add a dictionary or CmpLog.
3. Is exec/s reasonable (>10k/s for a small pure target)? If it is 200/s, find the setup cost.
4. Are sanitizers actually on? (`-fsanitize=address` present, `-fno-sanitize-recover=all` present, `NDEBUG` *not* defined.) Check the binary, not the build script.
5. Is the target being optimized away (§3.6.3)? Look at the reported number of counters.
6. Only after all of that: maybe the code is fine.

### 3.9 Corpus: seeds, minimization, and growth

**Seed selection is the highest-leverage decision you make.** A coverage-guided fuzzer is a *local* search; it explores outward from what it has. Starting from an empty corpus, it must synthesize valid structure from nothing (AFL's JPEG demo shows this is possible; it is also slow and unnecessary). Starting from a hundred real, valid, *diverse* files, it starts already inside the interesting code.

Rules for a seed corpus:

- **Valid, real inputs.** The project's own test data files. Files from the format specification's examples. Files scraped from the wild.
- **Small.** A 4 MB seed is executed on every mutation of itself. Ten 2 KB files beat one 20 KB file. Prefer the smallest file that exercises each feature.
- **Diverse in *features*, not in bytes.** One file per format feature (each PNG chunk type, each SQL statement kind, each compression method). Two files that differ only in pixel data are one file.
- **Include the degenerate cases you already know about:** empty, one byte, truncated, maximum nesting.
- **Minimize it before you start** (below), so the fuzzer is not paying to re-execute redundant seeds.

#### 3.9.1 Two different "minimizations", constantly confused

| Operation | Input | Output | Tool |
|---|---|---|---|
| **Corpus minimization** (`cmin`) | Many files | *Fewer files*, same total coverage | `afl-cmin`; `libFuzzer -merge=1 NEW/ OLD/` |
| **Test-case minimization** (`tmin`) | One file | *A smaller file*, same coverage / same crash | `afl-tmin`; `libFuzzer -minimize_crash=1` |

**Corpus minimization** is a greedy set-cover: for each edge, keep the smallest/fastest input that covers it; discard inputs whose coverage is fully subsumed. A corpus of 50,000 files routinely minimizes to 2,000 with identical coverage, which is a 25× throughput improvement for free. Run it periodically; OSS-Fuzz does it as part of its daily cycle.

**Test-case minimization** is §2.4's shrinker again, with "the property still fails" replaced by "the crash still reproduces" or "the coverage is unchanged". `-minimize_crash=1` turns a 3 KB crashing input into a 12-byte one, and the 12-byte one is a bug report a human can read. Always do this before filing.

The symmetry is exact and worth stating to students explicitly: **property-test shrinking, `afl-tmin`, `-minimize_crash`, and `creduce`/`cvise` (for compiler bug reports) are all the same algorithm** — greedy descent over a "smaller" relation, with an oracle predicate that says "still interesting". Learn it once.

#### 3.9.2 Growth, plateaus, and what to do

Coverage over time is a log curve: fast early, then a long plateau. The plateau is not failure; it is the signal to change something:

- add a dictionary;
- enable value profile / CmpLog;
- write a structure-aware mutator;
- add more seeds covering features the coverage report shows are cold;
- split the target;
- check whether the remaining uncovered code is behind a check the fuzzer cannot pass (a signature, a decompression step) and patch it out for the fuzz build;
- accept it and let it run — many real bugs are found after weeks of apparently flat coverage, because the search continues within reached code with new *values*.

The last point deserves emphasis: **fuzzing is a continuous activity, not an event.** A ten-minute fuzz run in CI is a smoke test that the target still builds. Finding bugs is what happens over CPU-months. This is the entire argument for §3.12.

### 3.10 Differential fuzzing

Take one input. Feed it to **two implementations of the same specification**. Compare the outputs. Disagreement is a bug in at least one of them.

This solves the oracle problem completely and without writing a specification, which is why it produces such a disproportionate share of high-value findings. It is §2.5.4 with a fuzzer supplying the inputs, and the shape is trivial:

```cpp
extern "C" int LLVMFuzzerTestOneInput(const uint8_t *d, size_t n) {
    auto a = implementation_one(d, n);
    auto b = implementation_two(d, n);
    if (a != b) __builtin_trap();      // or assert(a == b)
    return 0;
}
```

**Where the second implementation comes from:**

- another library implementing the same standard (OpenSSL vs BoringSSL vs GnuTLS; two JSON parsers; two regex engines);
- your optimized path vs your reference path (**SIMD vs scalar — the single most valuable differential target in any vectorized codebase**, and one this curriculum's `algorithms-on-real-hardware.md` sets up perfectly);
- the same program at two optimization levels, or built by two compilers;
- an old version vs a new version (a *regression* oracle — any behavioural difference is either an intended change or a bug, and enumerating which is a genuinely useful code-review artifact);
- a slow, obviously-correct model you wrote in twenty minutes;
- the same algorithm on two architectures (x86 vs ARM — catches endianness, alignment, and floating-point differences).

**The industrial record.** This is not a boutique technique; it is behind a remarkable number of the field's headline results:

- **Csmith** — Yang, Chen, Eide and Regehr, **"Finding and Understanding Bugs in C Compilers"** (PLDI 2011). Csmith generates random C programs that are *guaranteed free of undefined behaviour* (the hard part — you cannot differential-test compilers with programs whose behaviour is not defined, because the compilers are then both right), compiles each with several compilers at several optimization levels, and compares outputs. The paper's headline finding, worth quoting to any student who believes compilers are trustworthy: **every compiler they tested was found both to crash and to silently generate wrong code from valid input.** They reported over 325 bugs across GCC, LLVM and commercial compilers. *(Bug count from memory of the paper; Appendix A.)*
- **EMI / Orion** — Le, Afshari and Su, **"Compiler Validation via Equivalence Modulo Inputs"** (PLDI 2014). The metamorphic relation of §2.5.5: run a program, note which statements never executed *for that input*, delete some of them, recompile. The new program must behave identically **on that input**. This requires no reference implementation at all — the oracle is the program itself — and it found on the order of 150 confirmed bugs in GCC and LLVM within a year. It is the most elegant idea in the section. *(Count approximate; Appendix A.)*
- **Frankencerts** — Brubaker, Jana, Ray, Khurshid and Shmatikov, **"Using Frankencerts for Automated Adversarial Testing of Certificate Validation in SSL/TLS Implementations"** (IEEE S&P 2014). Synthesize X.509 certificates by recombining fields from real ones, then feed each to OpenSSL, GnuTLS, NSS, PolarSSL, MatrixSSL, CyaSSL and others, and flag any input where they *disagree* about validity. Found a long list of serious flaws, including certificates accepted by some libraries that should have been rejected by all. The insight generalizes: **for any security decision made independently by multiple implementations, disagreement is itself the vulnerability**, regardless of which one is "right".
- **Cryptography generally.** Differential testing of constant-time properties (`dudect`, `ct-fuzz`), of bignum arithmetic against GMP, of AEAD implementations against reference vectors. Google's **Wycheproof** is the adjacent idea — not fuzzing but a curated corpus of test vectors derived from *known attack classes*, run against every library. The two compose: Wycheproof supplies the known-bad seeds, the fuzzer explores around them. `cryptography.md` is the companion here.
- **Consensus systems.** Ethereum runs differential fuzzing across its independent client implementations (Geth, Nethermind, Besu, Erigon) precisely because a consensus divergence is a chain split; this is the highest-stakes deployment of the technique in production anywhere.

**The pitfalls, which are real:**

1. **Distinguishing a genuine bug from permitted variation.** If the spec says "implementation-defined", disagreement is not a bug. Floating-point output, hash-map iteration order, error-message text, and the *choice* among several valid encodings are all legitimate divergences. The fix is to **normalize before comparing** — and the act of writing the normalizer forces you to read the spec carefully, which is itself valuable.
2. **Both implementations sharing a bug.** Common when one was derived from the other (forks!), or when both misread the same ambiguous sentence in the spec. Differential testing finds *divergence*, not *incorrectness*.
3. **Undefined behaviour in the input.** Csmith's central engineering effort. If your generated input has UB, both implementations are permitted to do anything, and every disagreement is a false positive. Generating UB-free inputs is often the hardest part of the whole exercise.
4. **Cost.** Two implementations means half the throughput, plus the integration work of building both into one binary.

### 3.11 Symbolic and concolic execution, in outline

The idea that would solve everything if it scaled, and the reason it does not.

**Symbolic execution.** Instead of running the program on concrete bytes, run it on *symbols*. Every input byte is an unknown variable. As execution proceeds, the interpreter builds:

- a **symbolic state**: each memory location holds an expression over the input symbols, not a value;
- a **path constraint**: the conjunction of the branch conditions taken to get here.

At `if (x * 2 + 1 == 15)`, the executor **forks** into two states: one with path constraint `… ∧ (x*2+1 == 15)` and one with `… ∧ (x*2+1 ≠ 15)`. To produce an actual test input that reaches a given state, hand the path constraint to an **SMT solver** (§5.4) and ask for a satisfying assignment: `x = 7`.

This is a fundamentally different search from fuzzing. A fuzzer *guesses* its way to `x == 7`; a symbolic executor *solves* for it. On a 4-byte magic-value comparison the fuzzer needs 2³² guesses (mitigated by the tricks in §3.3/§3.5) and the solver needs one query.

**Concolic execution** (concrete + symbolic) is the practical hybrid: run the program on a real concrete input while *simultaneously* tracking symbolic constraints. At the end, take the path constraint, **negate one branch condition**, solve, and get a concrete input that goes the other way at that branch. Repeat. This sidesteps the need to model the entire environment symbolically — anything you cannot handle symbolically, you just use the concrete value for.

**KLEE** (Cadar, Dunbar and Engler, **OSDI 2008**) is the reference symbolic executor: it interprets LLVM bitcode, models a POSIX environment (symbolic files, symbolic command-line arguments), and uses STP/Z3 to solve. Its headline result was applying it to the ~90 GNU **COREUTILS** programs and achieving higher line coverage than the developer-written test suites those tools had accumulated over fifteen years, while finding dozens of serious bugs — including memory errors in utilities that had been shipping since the 1990s. *(Characterization from memory of the paper; exact coverage percentages and bug counts not re-verified — Appendix A.)*

**SAGE** (Godefroid, Levin and Molnar, Microsoft; NDSS 2008 and *CACM* 2012) is the industrial one, and the more instructive story. SAGE does **whitebox fuzzing** at the *x86 binary* level — no source needed — using a "generational search" that, from one execution trace, generates many new inputs by negating each branch constraint in turn (rather than depth-first forking). Microsoft ran it on hundreds of machines for years against Windows file parsers. The claim that made the field pay attention: SAGE found roughly **a third of all the bugs discovered by file fuzzing during Windows 7 development** — and it found them *after* the conventional blackbox fuzzers had already been run and their findings fixed. That is the right way to think about symbolic execution: not as a replacement for fuzzing, but as the thing that gets past the wall fuzzing stops at.

**Why it did not take over: path explosion, and four friends.**

1. **Path explosion.** The number of paths is exponential in the number of branches and *unbounded* in the presence of input-dependent loops. A loop `for (i = 0; i < n; i++)` with symbolic `n` forks at every iteration. Mitigations — search heuristics (coverage-guided state selection), state merging, loop summarization, function summaries — all help and none solve it. This is the fundamental barrier.
2. **Solver cost.** Constraints accumulate; queries get large; nonlinear arithmetic, and especially multiplication and division, are hard. Real symbolic executors spend the majority of their wall time inside the SMT solver. Caching and constraint independence (splitting a query into independent subsets) are essential and were among KLEE's main contributions.
3. **Environment modelling.** The program calls `read()`, `mmap()`, `ioctl()`, `gettimeofday()`. Each needs a symbolic model, and each model is an approximation that is either unsound or incomplete. This is a large, unglamorous, never-finished engineering effort, and it is why symbolic executors work well on self-contained algorithmic code and badly on real systems software.
4. **Symbolic memory.** `a[i]` where `i` is symbolic must, in principle, consider every element. Theories of arrays help; performance suffers.
5. **Floating point.** SMT support for IEEE-754 exists (the FP theory) and is slow.

**Where the ideas actually landed.** Not in whole-program symbolic execution but in two much cheaper approximations that captured most of the value:

- **Hybrid fuzzing** — **Driller** (Stephens et al., NDSS 2016) is the canonical design: fuzz normally, and *only when the fuzzer plateaus*, invoke symbolic execution on a corpus input to solve past the specific check that is blocking it, then hand the solved input back to the fuzzer and resume. Symbolic execution used as a lockpick, not as a search.
- **CmpLog / RedQueen / value profile** (§3.4, §3.5) — the observation that you usually do not need a solver at all, because the value being compared against typically appears *verbatim in the input*. Substitute the bytes and move on. This is a hack, it is unsound, it captures a large share of what the solver would have given you, and it costs approximately nothing. It is why AFL++ with CmpLog beats most hybrid fuzzers in practice, and it is a good lesson about the economics of program analysis in general.

### 3.12 OSS-Fuzz as infrastructure, and why continuity is the point

Google's **OSS-Fuzz** launched in December 2016 to run continuous fuzzing for open-source projects. Verified from the project README on 2026-09-01:

> "As of May 2025, OSS-Fuzz has helped identify and fix over **13,000 vulnerabilities** and **50,000 bugs** across **1,000 projects**."

**How it works**, because the shape is the lesson:

1. A project contributes three things: a **Dockerfile** (the build environment), a **`build.sh`** (how to build the project and its fuzz targets), and the **fuzz targets** themselves (`LLVMFuzzerTestOneInput` functions, checked into the project's own repository, next to its code).
2. OSS-Fuzz builds each target under **multiple engines** (libFuzzer, AFL++, Honggfuzz, Centipede) and **multiple sanitizers** (ASan, MSan, UBSan) — the cross product, as separate binaries, exactly as §3.6.1 requires.
3. **ClusterFuzz** runs them continuously on a large fleet, with **persistent corpora** that grow for years and are shared across runs.
4. A crash is automatically **minimized** (§3.9.1), **deduplicated** by stack signature, and **bisected** to a commit range.
5. A bug is filed automatically, with a **90-day disclosure deadline** (or 30 days after a fix lands, whichever is earlier). Fixes are automatically verified by re-running the reproducer.
6. **Coverage reports** are published per project, which is the diagnostic use of coverage from §1.7 applied exactly correctly: they exist so maintainers can see which code their fuzz targets never reach.
7. **OSS-Fuzz-Gen** (2024) adds LLM-generated fuzz targets for projects that have none — the harness-writing bottleneck being, by then, the main limit on coverage rather than CPU.

**The lesson for the curriculum**, and it is the closing point of §3: **fuzzing's value is a function of elapsed CPU time and corpus maturity, not of cleverness at any instant.** The bugs are found by targets that have been running for months against a corpus that has been accumulating for years. A student who fuzzes their parser for ten minutes and finds nothing has learned the mechanism but should be told plainly that they have not run the experiment. The 13,000 vulnerabilities are what the mechanism produces when you leave it on.

The corollary for practice: **the fuzz targets belong in the repository, next to the unit tests, built by CI, run in every developer's `make check` for ten seconds and on a fleet forever.** A fuzz target that lives in a researcher's home directory finds one bug. A fuzz target in `fuzz/` with a seed corpus in `fuzz/corpus/` finds bugs for a decade.

---

## 4. Static analysis

Everything in §1–§3 runs the program. Static analysis reasons about it without running it, which buys one enormous advantage — **it can talk about all inputs at once** — at the cost of one enormous limitation: by Rice's theorem, every non-trivial semantic property of programs is undecidable, so every static analyser is wrong about your code in one direction or the other, deliberately, by design. §4.4 is the organizing idea and the rest of the section is examples of tools choosing their corner.

### 4.1 Compiler warnings are the cheapest static analyser you will ever run

You already have a whole-program static analyser installed, it runs on every build, and it is fast. Most codebases use maybe a third of it.

`-Wall -Wextra` is the starting point, not the destination — the names are a historical joke, `-Wall` is nothing of the kind. The additional flags worth turning on, grouped by what they catch:

**Genuine-bug detectors (turn all of these on):**

| Flag | Catches |
|---|---|
| `-Wreturn-type` | Falling off the end of a non-`void` function. **This is UB, and the generated code is genuinely arbitrary** — the function returns whatever happens to be in `rax`, or the compiler deletes the path entirely. There is no legitimate reason to allow it. |
| `-Wuninitialized` | Reads of definitely-uninitialized variables |
| `-Wimplicit-fallthrough` | Missing `break` in a `switch`. Use `[[fallthrough]]` when deliberate. |
| `-Wformat=2 -Wformat-security` | `printf(user_string)` — format string vulnerabilities, and argument/format mismatches |
| `-Warray-bounds` | Provably out-of-bounds indexing (constant indices, and some inferred ranges) |
| `-Wnull-dereference` | Provable null derefs |
| `-Wshift-overflow` / `-Wshift-count-overflow` | Shifts by ≥ width, which is UB |
| `-Wstringop-overflow`, `-Wstringop-truncation` (GCC) | `strncpy`/`memcpy` size mistakes — a genuinely productive check |
| `-Wnon-virtual-dtor`, `-Woverloaded-virtual` (C++) | Deleting through a base pointer without a virtual destructor; accidentally hiding rather than overriding |
| `-Wvla` | Variable-length arrays — an unbounded stack allocation controlled by input is a security bug |
| `-Wduplicated-cond`, `-Wduplicated-branches`, `-Wlogical-op` (GCC) | Copy-paste errors in conditionals; `&`/`&&` confusion. Cheap, and they catch real things. |

**Style/discipline warnings (valuable, but noisy on existing code):**

`-Wshadow`, `-Wconversion`, `-Wsign-conversion`, `-Wold-style-cast`, `-Wuseless-cast`, `-Wdouble-promotion`, `-Wswitch-enum` (stricter than `-Wswitch`: requires every enumerator listed even with a `default`), `-Wcast-qual`, `-Wmissing-declarations`.

**Which deserve `-Werror`?** The rule: **promote a warning to an error when its false-positive rate is effectively zero and its true positives are always bugs.** That set is roughly the first table above, and `-Wreturn-type` is the least arguable member of it — a codebase that permits `-Wreturn-type` warnings has undefined behaviour in it right now.

Which should *not* be `-Werror`:

- **`-Wmaybe-uninitialized`** (GCC). Famously false-positive-prone, and the false positives *change with optimization level and compiler version*, so `-Werror` on it means a compiler upgrade breaks the build in unrelated files.
- **`-Wconversion`** on legacy code. Thousands of hits, nearly all benign, and the ones that matter drown.

And the meta-rule that matters operationally: **`-Werror` belongs in CI on a pinned compiler, not in developer builds.** A new compiler release invariably adds warnings; if `-Werror` is in the default build, upgrading the compiler bricks everyone's checkout simultaneously and the team's response is to stop upgrading compilers, which costs more than the warnings were worth. Pin the compiler in CI, `-Werror` there, and let developers see warnings without being blocked.

**Adjacent cheap toolchain wins**, which are not warnings but belong in the same "you already own this" bucket (see `build-systems-toolchains.md` and `hardware-security.md`):

```
-D_FORTIFY_SOURCE=3            # compile-time size inference + runtime checks on str/mem functions
-D_GLIBCXX_ASSERTIONS          # libstdc++ bounds checks on vector::operator[], etc.
-fstack-protector-strong       # stack canaries
-fstack-clash-protection
-ftrivial-auto-var-init=pattern  # initialize locals to a poison pattern — kills a UB class outright
-Wl,-z,relro,-z,now            # RELRO + BIND_NOW
```

`_FORTIFY_SOURCE` is worth calling out as a hybrid: it is a *static* analysis (the compiler infers the destination buffer's size) feeding a *dynamic* check (a runtime abort when the size is exceeded), and it costs close to nothing. `-ftrivial-auto-var-init=pattern` is newer and underused, and it makes an entire category of §3.6 bug deterministic instead of environment-dependent.

### 4.2 clang-tidy and the Clang Static Analyzer are two different tools

They are constantly conflated and they work completely differently.

**clang-tidy** is an **AST-matcher-based linter**. It walks the syntax tree looking for patterns. It is fast, it is mostly *syntactic and local* (it does not reason about paths or values across the program), and — its best feature — many checks ship a **fix-it**, so `clang-tidy -fix` mechanically rewrites your code.

Check families worth knowing:

| Family | What it is |
|---|---|
| `bugprone-*` | The highest-value family. Suspicious constructs that are usually bugs: `bugprone-use-after-move`, `bugprone-sizeof-expression`, `bugprone-integer-division`, `bugprone-signed-char-misuse`, `bugprone-branch-clone`, `bugprone-macro-parentheses`. |
| `clang-analyzer-*` | **This family is the static analyzer, hosted inside clang-tidy.** Enabling it makes clang-tidy much slower and much deeper. |
| `cert-*`, `cppcoreguidelines-*`, `hicpp-*` | Guideline conformance. Heavily overlapping with each other; pick one. |
| `performance-*` | `performance-unnecessary-value-param`, `performance-for-range-copy` — often genuinely worth real time |
| `modernize-*` | Mechanical C++ modernization. Excellent as a one-off with `-fix`; noisy as a gate. |
| `readability-*`, `misc-*` | Mostly taste. `misc-unused-parameters`, `readability-implicit-bool-conversion`. |

Configured by a `.clang-tidy` YAML file with a `Checks:` glob list; suppress with `// NOLINT(check-name)` or `// NOLINTNEXTLINE`. Requires a `compile_commands.json` (from CMake's `CMAKE_EXPORT_COMPILE_COMMANDS` or `bear`), because it needs your real compile flags to parse your code.

**The Clang Static Analyzer** (`clang --analyze`, or `scan-build make`, or via `clang-analyzer-*` in clang-tidy) is a **path-sensitive symbolic execution engine**. It walks paths through the CFG, tracks symbolic values and constraints on them, and reports when a path can reach a bad state. It finds null dereferences, use-after-free, leaks, and uninitialized reads **on specific paths**, and its reports come with a **path narrative** — "assuming `p` is null here → taking the true branch here → dereferenced here" — which is essential, because a path-sensitive report is not believable without one.

**Notice what this is: §3.11's symbolic execution, deliberately crippled to be affordable.** It is mostly intraprocedural (with a limited inlining budget), it has a hard node budget per function, it unrolls loops a fixed small number of times, and it gives up rather than exploding. It is unsound (misses bugs beyond its budget) and incomplete (reports paths that are infeasible for reasons it cannot see). Both of those are deliberate, and understanding *why* is the point of §4.4.

**Other tools worth knowing:**

| Tool | Approach | Notes |
|---|---|---|
| **GCC `-fanalyzer`** | Path-sensitive, in-compiler | Since GCC 10. Strongest on C; double-free, use-after-free, leaks, fd misuse. Gives a nice ASCII path diagram. Improving fast. |
| **cppcheck** | Pattern + some flow | Doesn't need your build config, which makes it trivial to try |
| **Coverity** | Interprocedural, path-sensitive, commercial | The subject of §4.5's key paper |
| **CodeQL** | The codebase as a **queryable database**; you write Datalog-ish queries | Powers GitHub code scanning. Different and genuinely powerful mental model: "find me every path from a source of user input to a `memcpy` size argument" is a query you write, not a check you enable. |
| **Infer** (Meta) | **Separation logic + bi-abduction** | Directly relevant to §5.5: Infer is deductive verification, scaled down and automated hard enough to run on every diff at Meta. Its compositional analysis (infer a *specification* for each function independently, then compose) is what makes it scale. The most successful industrial deployment of separation logic by a wide margin. |
| **PVS-Studio**, **SonarQube**, **Klocwork** | Commercial, pattern + flow | |

### 4.3 Abstract interpretation, in outline

The theory that makes *sound* static analysis possible, from Patrick and Radhia Cousot, **POPL 1977**.

**The idea.** Execute the program, but over an **abstract domain** instead of concrete values. Instead of "`x` is 7", the analysis tracks "`x` is in `[0, 10]`", or "`x` is positive", or "`x ≡ 0 (mod 4)`". Abstract operations over-approximate concrete ones: if `x ∈ [0,10]` and `y ∈ [3,5]` then `x+y ∈ [3,15]`. Because the abstraction only ever *widens* the set of possible values, any property the analysis proves about the abstract values holds for the real ones. That is **soundness**, and it is obtained by construction.

The formal machinery is a **Galois connection** between the concrete lattice (sets of states) and the abstract lattice, with an abstraction function α and a concretization function γ satisfying `α(c) ⊑ a ⟺ c ⊆ γ(a)`. You do not need this to use the tools, but you do need it to understand why the guarantee is one-sided.

**Domains, in increasing precision and cost:**

| Domain | Tracks | Cost | Catches |
|---|---|---|---|
| Sign | `x < 0`, `= 0`, `> 0` | trivial | division by zero, sign errors |
| **Interval / box** | `x ∈ [a, b]` per variable | O(n) | array bounds, overflow — the workhorse |
| Congruence | `x ≡ k (mod m)` | cheap | alignment, stride |
| **Octagon** (Miné) | `±x ± y ≤ c` — relations between *pairs* | O(n²) space, O(n³) time | `i < n` loop bounds, the relational facts intervals miss |
| **Polyhedra** (Cousot–Halbwachs) | arbitrary linear inequalities over all variables | exponential worst case | almost everything linear; rarely affordable |

The precision/cost curve here is the whole engineering story of the field. Intervals cannot prove `i < n` inside a loop because they lose the *relationship* between `i` and `n`; octagons can, and cost a hundred times more.

**Fixpoints, widening, and narrowing.** The analysis iterates over the CFG until values stop changing — a least fixpoint. But interval lattices have infinite ascending chains (`[0,0] ⊑ [0,1] ⊑ [0,2] ⊑ …`), so a loop that increments a counter never converges. The fix is a **widening operator ∇**: after a few iterations, jump straight to `[0, +∞]`. This forces termination at the cost of precision. **Narrowing** then walks back down to recover some of what widening threw away. Choosing where to widen and how aggressively is where the craft is, and it is why the same analyzer can be precise on one codebase and useless on another.

**Astrée** is the flagship result and the one worth knowing. Developed by the Cousot group at ENS, commercialized by AbsInt, it **proves the absence of runtime errors** — no overflow, no division by zero, no out-of-bounds access, no invalid pointer arithmetic — in safety-critical C. It was applied to the **Airbus A340 and A380 primary flight control software**, on the order of hundreds of thousands of lines, and the headline claim is **zero false alarms**: not "few", zero, meaning the analysis certified the program with no manual triage at all. *(The specific line counts and aircraft are quoted from memory of the Astrée literature; not re-verified — Appendix A.)*

**And the honest reading of that result, which is the important part.** Astrée achieves zero false alarms because it is *specialized to a narrow family of programs*: synchronous, reactive, control-loop C with statically bounded loops, no dynamic allocation, no recursion, essentially no complex pointer structures. The analyzer was tuned — with custom domains, including a domain specifically for the digital filters that appear in flight control — against that family until the alarms went away. Point it at a web browser and it would produce an unusable ocean of alarms, or fail to terminate.

That is not a criticism of Astrée; it is the general law. **Sound static analysis is achievable at industrial scale exactly when you narrow the domain enough**, and the narrowing is most of the work. It is the same lesson §5.6 draws about formal methods generally.

### 4.4 The trilemma: sound, complete, usable — pick two

The terminology is inverted between communities and the inversion causes real confusion, so define it once, carefully:

- **Sound** (bug-finding sense): *if there is a bug, the tool reports it.* No false negatives. Equivalently, in the verification sense: the tool never certifies a program that is actually broken.
- **Complete**: *every report is a real bug.* No false positives.
- **Usable**: terminates in reasonable time on real programs, and integrates with a real build.

**Rice's theorem** says every non-trivial semantic property of programs is undecidable. Therefore no terminating analyser for a Turing-complete language is both sound and complete. You get to pick two corners:

| Corner | What you give up | Tools |
|---|---|---|
| **Sound + usable** | Completeness → **false positives**. The tool says "I cannot prove this is safe", which the user reads as "bug", and often it is not. | Astrée, Polyspace, Frama-C/EVA, most abstract interpreters, type systems, Rust's borrow checker |
| **Complete + usable** | Soundness → **false negatives**. The tool only reports what it is confident about, and quietly misses the rest. | Coverity, clang-tidy, the Clang Static Analyzer, `-fanalyzer`, cppcheck, Infer, essentially every tool you have used |
| **Sound + complete** | Usability. Does not terminate, or requires human proof effort. | Interactive theorem proving (§5.5) — where the "tool" includes a person |

**The commercially important observation is that nearly every tool a working programmer touches lives in the second row**, and this is the *correct* choice for general-purpose code. A sound analyser on a million-line C++ codebase reports tens of thousands of "cannot prove safe" alarms, and the team ignores all of them. A deliberately unsound one reports two hundred, of which a hundred and fifty are real, and the team fixes them. **A tool that finds 60% of the bugs and gets used beats a tool that finds 100% and gets ignored.** The academic word for this position is *soundiness* (Livshits et al., "In Defense of Soundiness: A Manifesto", *CACM* 2015) — the honest admission that essentially every practical analysis is unsound in documented, deliberate ways (reflection, dynamic loading, `dlopen`, inline assembly, `longjmp`, integer overflow of loop counters) and that pretending otherwise helps nobody.

Note what this implies for the whole document: **static analysis and fuzzing are complementary in exactly the way the trilemma predicts.** Static analysis sees all paths at low fidelity; fuzzing sees a few paths at perfect fidelity. Neither subsumes the other, and a claim that either is "enough" is a claim about which corner of the trilemma the speaker has forgotten.

### 4.5 False positives are what kill adoption

The reference here is **Bessey et al., "A Few Billion Lines of Code Later: Using Static Analysis to Find Bugs in the Real World"** (*CACM* 53(2), February 2010) — the paper the Coverity founders wrote about turning a research analyser into a product. It is the single most useful paper on this topic and it is almost entirely about things that are not analysis.

The findings that matter:

**1. The analysis is the easy part.** Most of the effort went into building integration (intercepting the build to learn the real compile flags — every codebase has a bespoke, hostile build system), parsing dialects (every large C codebase relies on some compiler extension), scaling, and above all *presenting* results.

**2. Users do not believe reports they do not understand.** A report without an explanation of *how* the bad state is reached is dismissed. Path narratives are not a nicety; they are the difference between a fixed bug and an ignored one. And when a report is right but the user cannot follow it, the user concludes the tool is wrong — which is worse than no report, because it damages the tool's credibility for every future finding.

**3. There is a false-positive rate above which the tool is simply abandoned.** The paper's practical rule of thumb is around **30%**: past that, developers stop reading. *(Figure recalled from the paper; not re-verified — Appendix A.)* The dynamic is worse than linear, because it is a *habit*: once a team has learned to ignore the tool's output, they ignore the true positives too, and the tool is now net negative — it consumes CI time and provides an illusion of coverage.

**4. "No bug is too foolish to check for."** The checks that found the most real defects in real code were not the sophisticated interprocedural ones. They were things like "this `if` and its `else` have identical bodies" and "the result of this comparison is always false". Real code contains an astonishing quantity of straightforwardly silly mistakes.

**How to keep the false-positive rate survivable:**

- **Ship high-confidence checks on by default; everything else opt-in.** The default configuration is the product.
- **Rank by confidence and show the top of the list.** A hundred reports sorted by likelihood beats a thousand unsorted.
- **Ratchet, do not gate.** Baseline the existing findings, then require only that the count does not increase — or better, that *changed lines* introduce no new findings. This is the same "diff gate" idea as coverage-of-the-diff in §1.7, and for the same reason: it makes an unusable absolute standard into a usable marginal one, and it is how every large codebase actually adopts a strict analyser.
- **Suppress with a justification, in code, next to the line.** `// NOLINT(bugprone-x): size is validated at line 40` is reviewable. A central suppression file is not.
- **Annotate to buy precision.** Most false positives come from information the tool cannot infer but you know: `[[nodiscard]]`, `__attribute__((nonnull))`, `__attribute__((returns_nonnull))`, `_Nonnull`/`_Nullable`, `[[clang::lifetimebound]]`, `[[gnu::malloc]]`, ownership attributes. Every annotation you add makes the analysis both more precise and more useful to human readers. This is the cheapest precision available and almost nobody does it.

### 4.6 Type systems are the lightweight verification that actually shipped

The framing worth ending §4 on:

> **A static type system is a sound, decidable, whole-program, fully automatic, incremental formal verification, applied to every line of code, by every programmer, on every save — and nobody thinks of it as a formal method.**

It is by many orders of magnitude the most widely deployed formal method in history. It sits in the "sound + usable" corner of §4.4, and it pays for its false positives (programs that are safe but do not typecheck) with a bargain nobody complains about: you change the program until it typechecks. That is the trilemma being resolved *socially* rather than technically, and it is the model to imitate.

**The ladder, in the languages this curriculum touches:**

| Level | What the type carries | Example |
|---|---|---|
| **C** | Almost nothing. Implicit conversions between every arithmetic type; `void*` erases everything; arrays decay to pointers and lose their length. | The bug classes of §3 are *directly downstream* of "a pointer does not know how long its buffer is" |
| **C++, used carelessly** | The same, with more syntax | |
| **C++, used deliberately** | A surprising amount | `enum class` (no implicit conversion); strong typedefs / newtype wrappers so `UserId` and `OrderId` do not interchange; `std::chrono::duration` (the canonical case — a `milliseconds` cannot be passed where `seconds` is expected, and the Mars Climate Orbiter's unit mismatch was, precisely, a type error); `std::span` (a pointer that *carries its length*, which converts a whole family of §3 bugs into a compile error or a bounds check); `std::unique_ptr` (ownership in the type); `const`-correctness; `[[nodiscard]]`; `explicit`; `std::optional` and `std::expected` instead of sentinel returns |
| **Rust** | **Memory safety and data-race freedom, proved at compile time** | Affine types plus lifetimes. The borrow checker is a static analysis so precise that it eliminates, by construction, the exact bug class §3 spends its entire existence hunting. Worth stating plainly to students *and* worth stating the caveats plainly: `unsafe` blocks opt out; leaks are safe; deadlocks are safe; logic bugs are entirely untouched; and the checker is *sound but incomplete* — it rejects correct programs, which is the §4.4 trade-off being paid in developer frustration. |
| **ML / Haskell** | Parametricity — "theorems for free" (Wadler, 1989): a function of type `∀a. [a] → [a]` *cannot* inspect its elements, so a huge number of properties follow from the signature alone. Exhaustive pattern matching turns "did I handle every case" into a compile error. | |
| **Dependent types** (Idris, Agda, Lean, F*) | The type carries an arbitrary proof. `Vec n a` is a list whose length is in its type, so `head` on an empty vector does not compile. | **HACL\*** / **EverCrypt** — cryptographic primitives written and verified in **F\***, compiled to C, and shipping in **Firefox (NSS)**, the **Linux kernel** (WireGuard's Curve25519), and elsewhere. This is verified code you have already run today. See `cryptography.md`. |
| **Gradual typing** (TypeScript, mypy) | Deliberately unsound | TypeScript's type system is *intentionally* unsound (bivariant array parameters, `any`, unchecked casts) and is nonetheless one of the highest-value static analyses ever deployed. A useful data point: usability beat soundness so decisively that the unsound design won the market. |

**The practical discipline to teach**, and it is one sentence: **make illegal states unrepresentable.** Every time you can turn a runtime check into a type — a length into a `span`, a unit into a `chrono` duration, a nullable pointer into an `optional`, a two-field "either an error or a value" into an `expected`, a "must be called after `init()`" into a separate type returned by `init()` — you have converted a test that covers some inputs into a proof that covers all of them, at zero runtime cost, checked by a tool everyone already runs. That is the best trade in the entire document, and it is available in C++ today.

---

## 5. Formal methods, at the right dose

The reason formal methods have a reputation problem is that they are usually advocated at the wrong dose. The interesting question is never "should we verify our software" — it is **"what is the smallest formal artifact that would have caught the specific class of bug that hurts us most?"** For most systems the answer is a two-hundred-line model of a protocol, not a proof of a codebase, and §5.6 says so plainly.

### 5.1 The two things "formal methods" means

They get conflated and they have completely different economics:

| | **Design-level** | **Code-level** |
|---|---|---|
| What you write | A model of the algorithm/protocol, in a specification language | Annotations on real code, plus proofs |
| What is checked | The *model* satisfies properties | The *implementation* satisfies a specification |
| Typical size | 100–1,000 lines | The whole program |
| Typical effort | Days to weeks | Person-years |
| Automation | High (push button, get a counterexample trace) | Low (you write loop invariants and proof scripts) |
| Tools | TLA+/TLC, Alloy, SPIN, Apalache | Coq/Rocq, Isabelle, Dafny, Frama-C, F* |
| Exemplars | AWS (§5.2), Raft, Paxos, Chord | seL4, CompCert, HACL* |
| **Cost/benefit for most teams** | **Often excellent** | Almost never |

Nearly all of the practical value available to a working engineer is in the left column, and nearly all of the field's reputation was set by the right one. Keep them separate.

### 5.2 TLA+ and model checking

**What it is.** TLA+ is Leslie Lamport's specification language, built on the **Temporal Logic of Actions**. A specification is a mathematical formula. A *behaviour* is an infinite sequence of states. The spec describes the set of allowed behaviours, canonically as:

```
Spec  ==  Init  /\  [][Next]_vars  /\  Fairness
```

— start in a state satisfying `Init`; every step either satisfies the `Next` relation or leaves `vars` unchanged (stuttering, which is what makes refinement work); plus fairness conditions to rule out behaviours that just stop.

**PlusCal** is an algorithm language with imperative syntax that compiles to TLA+. Engineers generally find it much easier to start with, and AWS's experience (below) confirms that. You write something that looks like pseudocode with explicit atomicity labels — and the labels are the point, because *the granularity of atomicity is exactly what a design document leaves ambiguous and exactly where concurrency bugs live.*

**TLC** is the model checker: an explicit-state, breadth-first search over the reachable state space of a *finite instance* of the spec (3 nodes, 2 keys, message queues bounded at 2). It checks:

- **Invariants** (safety): "no two nodes ever hold the lock", "the log is a prefix of the committed log". Violated → TLC prints the **shortest state sequence** that reaches the violation.
- **Temporal properties** (liveness): "every request is eventually answered". Requires fairness assumptions; more expensive to check.
- **Refinement**: that a detailed spec implements an abstract one.

**What it catches that testing cannot**, and this is the crux:

1. **It is exhaustive over the model.** Not sampled — *exhaustive*. Every interleaving of every process, every combination of message loss, reorder, duplication and crash, within the finite instance. Testing samples a schedule; TLC enumerates them all. That is a categorical difference, not a quantitative one.
2. **It reasons about the design, before the code exists.** Design bugs are the most expensive class to find, because by the time testing can reach them there is an implementation, an API, and callers.
3. **It produces a minimal counterexample trace.** A step-by-step sequence of states leading to the violation — which is exactly the artifact a distributed-systems bug report normally lacks and desperately needs. (Note the family resemblance to §2.4 shrinking and §3.9.1 minimization: *shortest counterexample* is the recurring deliverable of every good tool in this document.)
4. **It handles failure combinations humans do not enumerate.** The AWS paper's framing is that engineers naturally design the happy path and reason about failures one at a time; the model checker reasons about them in every combination and order.

**The AWS record**, which is the best-documented industrial deployment and which the prompt rightly asks be got right. From Newcombe, Rath, Zhang, Munteanu, Brooker and Deardeuff, *Use of Formal Methods at Amazon Web Services* (29 September 2014; published as "How Amazon Web Services Uses Formal Methods", *CACM* 58(4), April 2015). The table is reproduced **verbatim** from the primary source:

> **Applying TLA+ to some of our more complex systems**
>
> | System | Components | Line count (excl. comments) | Benefit |
> |---|---|---|---|
> | **S3** | Fault-tolerant low-level network algorithm | 804 PlusCal | Found 2 bugs. Found further bugs in proposed optimizations. |
> | | Background redistribution of data | 645 PlusCal | Found 1 bug, and found a bug in the first proposed fix. |
> | **DynamoDB** | Replication & group-membership system | 939 TLA+ | Found 3 bugs, some requiring traces of 35 steps |
> | **EBS** | Volume management | 102 PlusCal | Found 3 bugs. |
> | **Internal distributed lock manager** | Lock-free data structure | 223 PlusCal | Improved confidence. Failed to find a liveness bug as we did not check liveness. |
> | | Fault tolerant replication and reconfiguration algorithm | 318 TLA+ | Found 1 bug. Verified an aggressive optimization. |

Several details in that table deserve to be pointed at:

- **The specs are tiny.** 102 to 939 lines. This is a days-to-weeks artifact, not a research programme. That is the single most important fact for anyone deciding whether to try it.
- **The DynamoDB bug required a 35-step trace.** The paper is explicit about what that means: *"This was a very subtle bug; the shortest error trace exhibiting the bug contained 35 high level steps."* And on whether testing could have found it: the bug *"had passed unnoticed through extensive design reviews, code reviews, and testing, and T.R. is convinced that we would not have found it by doing more work in those conventional areas."* T.R. had already done extensive fault-injection testing with a simulated network, long-running stress tests on real hardware, and hand-written informal proofs — and the informal proofs had themselves found several bugs. The model checker found what all of that missed.
- **The honest negative result is in the table.** The lock manager row reads *"Failed to find a liveness bug as we did not check liveness."* A specification only checks the properties you write down. That row is worth more pedagogically than the successes.
- **Optimizations are the recurring second benefit.** Three of the six rows mention verifying an optimization or catching a bug in a proposed fix. Once the spec exists, it is cheap to ask "is this change safe?" — which is the compounding return that justifies writing it.
- **A fix that did not fix it.** *"The model checker found that the problem still occurred, but via a different execution trace."* Every engineer has shipped a fix for a concurrency bug that did not fix it. This is the tool that tells you.

On adoption, the paper reports two things worth stealing. They stopped saying "formal", "verification" and "proof", and started calling TLA+ **"exhaustively testable pseudo-code"** — the presentation was titled *"Debugging Designs"*, because "engineers think in terms of debugging rather than 'verification'". And engineers who had learned it two weeks earlier successfully taught it to others, which is the property that lets a technique scale in an organization.

And the caveats, in the authors' own words, which are the reason to trust the rest:

> *"On learning about TLA+, engineers usually ask, 'How do we know that the executable code correctly implements the verified design?' The answer is that we don't."*

> *"Formal methods deal with models of systems, not the systems themselves, so the adage applies; 'All models are wrong, some are useful.' The designer must ensure that the model captures the significant aspects of the real system."*

**Other TLA+ deployments** worth naming: Microsoft (Azure Cosmos DB's consistency levels; the XBox 360 memory-model work), MongoDB (replication protocol), Confluent (Kafka's replication), Elasticsearch (cluster coordination), and — the one every distributed-systems student should know — **Raft**, whose authors (Ongaro and Ousterhout) wrote a TLA+ specification of the protocol and later a machine-checked safety proof.

**The limits, stated properly:**

- **State-space explosion.** TLC enumerates reachable states; the count is exponential in the number of processes and the size of the domains. You check 3 nodes and 2 keys, not 300 and 2 million. The justification is the **small scope hypothesis** (§5.3): protocol bugs almost always manifest in small instances. This is an empirical claim, it has held up remarkably well, and it is not a theorem.
- **The model is not the code.** Restated because it is the thing people forget between reading it and using it.
- **A spec can be vacuously satisfied.** If your `Next` relation is subtly unsatisfiable, or your invariant is trivially true, TLC reports success. Sanity-check by deliberately breaking the algorithm and confirming the checker catches it — **the same discipline as a mutation test (§1.8), applied to a specification.** This is the single most-skipped step and it should be taught as mandatory.
- **Liveness is harder and more expensive than safety**, and — per the AWS table — routinely skipped.
- **Apalache** is the modern alternative worth knowing: a *symbolic* model checker for TLA+ that translates to SMT (§5.4) instead of enumerating states, which handles some larger and unbounded domains that defeat TLC.

### 5.3 Alloy, briefly

**Alloy** (Daniel Jackson, MIT) is a specification language based on **first-order relational logic with transitive closure**, plus an analyzer that translates a bounded instance of the model into a **SAT** problem and asks a solver for a counterexample.

Where it differs from TLA+: Alloy is at its strongest on **structure and relations** — "is this data model consistent?", "can this graph invariant be violated?", "does this access-control policy permit a path from an untrusted principal to a secret?" — whereas TLA+ is at its strongest on **behaviour over time**. Alloy's visualizer, which draws the counterexample instance as a graph, is genuinely excellent for building intuition and is a better first exposure for most people. (Alloy 6, 2021, added temporal operators, narrowing the gap considerably.)

**The small scope hypothesis** is Alloy's foundational bet and it is worth stating explicitly because it justifies every bounded technique in this document, including model checking, bounded verification, and arguably the whole practice of testing at small sizes:

> *Most bugs have small counterexamples. If a property is violated at all, it is very likely violated in a small instance.*

Empirically this holds up well. It is why checking a protocol with 3 nodes is nearly as good as checking it with 30, and why a shrunk property-test counterexample of `[0, 0]` is representative rather than a coincidence.

**The showcase result**: Pamela Zave, *"Reasoning About Identifier Spaces: How to Make Chord Correct"* (2017, and earlier work from 2012). Chord is one of the most-cited distributed hash table papers in the field, with a published claim of correctness. Zave modelled it in Alloy and showed that **the published protocol does not maintain its own invariant** — the ring can permanently break under node departures — and that this was true of every version in the literature, then derived a corrected version. Thousands of citations, years of use, an informal proof in the original paper, and a bounded model checker found the flaw. It is the best single argument in the literature for the left column of §5.1.

### 5.4 SAT, SMT, and Z3

**SAT** is boolean satisfiability: given a formula in conjunctive normal form, is there an assignment making it true? It is the canonical NP-complete problem, and one of the great practical embarrassments of complexity theory is that modern SAT solvers routinely dispatch industrial instances with **millions of variables and clauses**.

The algorithmic story is worth knowing because it is a beautiful piece of engineering. DPLL (1962) is backtracking search with unit propagation. **CDCL** — conflict-driven clause learning — is what made it industrial:

- when a conflict is reached, **analyze** it to derive a new clause that explains *why* this region of the search space is unsatisfiable, and add it (learning);
- **backjump non-chronologically** to the decision level the conflict actually depends on, skipping irrelevant intervening decisions;
- choose branching variables by **VSIDS** activity scores that favour variables involved in recent conflicts;
- implement propagation with **two watched literals** per clause, so most clauses cost nothing to maintain;
- **restart** periodically to escape bad early decisions while keeping the learned clauses.

**SMT** is SAT *modulo theories*: the atoms are not booleans but facts in a decidable theory. The `DPLL(T)` architecture runs a SAT solver over the boolean skeleton and consults theory solvers for consistency of the assigned atoms. Theories that matter for software:

| Theory | Used for |
|---|---|
| **EUF** (equality, uninterpreted functions) | Reasoning about functions you do not want to model |
| **Linear integer/real arithmetic** | Loop bounds, indices, resource counts |
| **Bitvectors** | **Machine integers, exactly** — including overflow, shifts, and bitwise operations. The theory that makes SMT useful for real C. |
| **Arrays** | Memory, `select`/`store` |
| **Strings**, **Floating point**, **Datatypes** | |

**Z3** (Leonardo de Moura and Nikolaj Bjørner, Microsoft Research, TACAS 2008) is the default; **CVC5**, **Yices2**, **Bitwuzla**/**Boolector** (bitvector-specialized) and **MathSAT** are the others.

**Practical uses a working engineer might actually reach for:**

- **The backend of every symbolic executor** (§3.11) and of many static analysers — the Clang Static Analyzer can optionally use Z3 to *refute* candidate reports, cutting false positives (§4.5).
- **Verifying peephole optimizations.** **Alive2** encodes LLVM IR transformations as SMT queries — "for all inputs, does the optimized form behave identically to the original, including with respect to undefined behaviour and poison?" — and it has found a long list of real miscompilation bugs in LLVM's InstCombine. If you write compiler optimizations, this is the tool. See `compilers-interpreters-terminals-unix.md`.
- **Superoptimization**: **Souper** (find a shorter equivalent instruction sequence, verified by SMT), **STOKE** (stochastic search plus SMT verification).
- **Policy analysis at scale.** AWS's **Zelkova** encodes IAM and S3 bucket policies into SMT and answers questions like *"is this bucket readable by anyone outside my account?"* — not by testing principals but by proving it for all of them. This is the most widely-used SMT deployment most engineers have unknowingly benefited from, and it is a perfect illustration of the sweet spot: a small, precisely-specified, high-stakes question over an unbounded input space.
- **Network configuration verification** (Batfish, Minesweeper), **scheduling and allocation**, **register allocation**, **test-case generation for constraint-heavy inputs**.

**A concrete exercise-sized use** that fits this curriculum, requiring only `pip install z3-solver`: prove or refute a bit-twiddling identity over all 32-bit values.

```python
from z3 import *
x = BitVec('x', 32)
# claim: x & (x - 1) clears the lowest set bit
#  check it another way: popcount decreases by exactly one when x != 0
prove(Implies(x != 0, x & (x - 1) != x))            # proved

a, b = BitVecs('a b', 32)
# the classic binary-search midpoint bug: is (a+b)/2 == a + (b-a)/2 ?
prove(UDiv(a + b, 2) == a + UDiv(b - a, 2))          # counterexample
```

That is thirty seconds of work and it answers a question no amount of testing settles, over 2⁶⁴ inputs. It is the right first taste of SMT: **not "verify my program", but "answer this one bounded question exhaustively".**

### 5.5 Deductive verification and separation logic, in outline

**Hoare logic** (1969) is the foundation: the triple `{P} C {Q}` asserts that if precondition `P` holds and command `C` terminates, postcondition `Q` holds. Rules compose the triples over sequencing, conditionals and loops; Dijkstra's **weakest precondition** calculus turns this into a mechanical transformation from a program plus a postcondition into a verification condition, which you then discharge with an SMT solver.

The bottleneck was, and remains, **loop invariants**: the calculus cannot infer them, so a human writes them, and writing a strong-enough invariant for a non-trivial loop is genuinely hard intellectual work. (Note the resonance with the AWS paper's point that *"the challenge is to find a good system invariant"* and that formal methods help engineers find one — the invariant is the reusable artifact, whether or not you complete a proof.)

**The frame problem.** Hoare logic drowns on pointers. To prove that `list_insert(l, x)` is correct you must state not only what changed but that *nothing else in the heap changed* — and "everything else" is unbounded. Specifications become dominated by non-interference clauses and reasoning stops being local.

**Separation logic** (John Reynolds, Peter O'Hearn, Hongseok Yang, ~2001–2002) solves this with one new connective. The **separating conjunction** `P * Q` asserts that the heap splits into **two disjoint parts**, one satisfying `P` and the other `Q`. Disjointness is built into the connective rather than stated as a side condition. That makes the **frame rule** sound:

```
        {P} C {Q}
──────────────────────────      (provided C does not modify P's free variables)
    {P * R} C {Q * R}
```

In English: *if `C` is correct operating on the piece of heap described by `P`, it is still correct when the rest of the world `R` is around, and it leaves `R` alone.* That is **local reasoning**, and it is what made verification of pointer-manipulating programs tractable. **Concurrent separation logic** (O'Hearn; Brookes) extends the idea to threads — disjoint heap parcels can be reasoned about independently, and ownership transfers at synchronization points — and won the **2016 Gödel Prize**.

**Tools:** **Frama-C** with the ACSL annotation language and the WP plugin (C); **VeriFast** (C and Java, separation logic, interactive); **Dafny** (a verification-aware language, the best teaching vehicle by a distance); **Why3** (a platform that dispatches to many provers); **Viper**; **Iris** (a Coq framework for higher-order concurrent separation logic, where much of the current research lives); **RefinedC**; and **Infer** (§4.2), whose **bi-abduction** technique *infers* the precondition rather than requiring it, which is what makes it automatic and compositional enough to run on every diff at Meta scale. Infer is the proof that separation logic is not confined to academia — it is just that the industrial version trades completeness for automation, per §4.4.

Interactive proof assistants underneath it all: **Coq/Rocq**, **Isabelle/HOL**, **Lean 4**, **F\***.

### 5.6 seL4 and CompCert: what "verified" means, honestly

These are the two flagship results, they are both real, and they mean **two quite different things**. Getting the difference right is the mark of understanding this area rather than admiring it.

#### 5.6.1 seL4

**What it is.** An L4-family microkernel — roughly **8,700 lines of C plus a few hundred lines of assembly** — with a machine-checked proof in **Isabelle/HOL**. Klein et al., *"seL4: Formal Verification of an OS Kernel"*, SOSP 2009, and a long line of follow-on work.

**What is proven.** *Functional correctness*: a chain of **refinement** proofs showing that the C implementation refines an executable specification, which refines an abstract specification. Everything the abstract spec permits, the code does, and nothing more. On top of that, later work added:

- **Integrity** (a component cannot modify memory it has no authority over) and **confidentiality**/**information-flow non-interference**;
- for some ARM configurations, a **binary-level** proof by translation validation between the compiled binary and the C — which is significant, because it **removes the C compiler from the trusted computing base**.

**Cost.** On the order of **20–25 person-years** for the original effort, producing roughly **200,000 lines of Isabelle proof for ~9,000 lines of C** — a proof-to-code ratio around **20:1**. *(Figures approximate, from memory of the seL4 literature; not re-verified — Appendix A.)*

**What is NOT covered** — the part that must be said, because "verified kernel" gets quoted as though it means "cannot go wrong":

- The **assembly boot code** and a small amount of hand-written assembly are outside the verified chain (assumed correct).
- **Hardware behaves per its model.** If the MMU, the cache, or the memory system deviates from the model — a hardware erratum, a fault, a Rowhammer bit flip, a Spectre-class microarchitectural leak — the proof does not apply. `hardware-security.md` is the companion here: **seL4's proof of confidentiality is a proof about an architectural model, and the transient-execution attacks of the last decade live entirely below that model.**
- **DMA from devices** can violate memory safety unless an IOMMU is configured — the proof assumes it is.
- **Timing channels** were outside the original proofs entirely (the later "time protection" work addresses this deliberately, and its existence is an admission that the original scope did not).
- Most importantly: **"correct" means "refines the specification".** If the specification says something you did not want, the proof holds perfectly and your system is wrong. The proof moves the risk from the implementation to the specification; it does not eliminate it.

#### 5.6.2 CompCert

**What it is.** A formally verified optimizing C compiler (Xavier Leroy et al., INRIA), with its proof in **Coq**.

**What is proven — and this is a much narrower and much more precisely scoped claim than people assume: semantic preservation.**

> *If the source program has well-defined behaviour according to the formal semantics of CompCert C, then the generated assembly has an observably equivalent behaviour.*

Formally, a simulation/refinement between the source and target semantics, composed across every compilation pass. It is a statement about the **compiler**, not about your program.

**What is NOT proven:**

- **It does not say your program is correct.** It says the compiler did not change what your program means.
- **Undefined behaviour voids the theorem.** If your source has UB, the hypothesis is false and the conclusion is vacuous. This is exactly why Csmith had to go to such lengths to generate UB-free C — you cannot differential-test compilers with programs whose behaviour is undefined.
- **The formal semantics of C used is a model.** If the model of C differs from the standard (or from what you believed), the theorem is a true statement about a different language.
- The **preprocessor**, parts of the **front-end**, the **assembler and linker**, and the runtime library are outside the verified core. (The parser has since been given its own validated construction.)
- **Performance.** CompCert generates good code — broadly in the neighbourhood of GCC at `-O1` — but does not compete with `-O2`/`-O3` on aggressively optimizable code. That is the price. *(Comparison approximate; not re-verified — Appendix A.)*

**The empirical vindication, which is the strongest single data point in favour of verification anywhere in the literature.** Yang, Chen, Eide and Regehr's Csmith work (PLDI 2011, §3.10) threw millions of randomly generated, UB-free C programs at every C compiler they could obtain, and found bugs — crashes and silent wrong-code generation — in **every one**, including GCC and LLVM, hundreds of bugs in total. Against CompCert they found bugs only in the **unverified front-end**, and none in the verified back-end. The authors' conclusion was that the middle-end and back-end of CompCert appeared, under this attack, to be qualitatively more reliable than every other compiler tested.

That is worth sitting with, because it is the cleanest experiment the field has: **a fuzzer, the most effective bug-finding technology available, applied at scale to a proof, found nothing inside the proof's scope and found things immediately outside it.** Both halves of that sentence matter. The proof held. The proof's boundary was exactly where the bugs were.

CompCert is used in production in avionics and other safety-critical settings, including at Airbus.

### 5.7 Where formal methods actually pay — plainly

**They pay at the design level, for concurrent and distributed protocols. They almost never pay at the code level for general application software.**

The reasons are structural, not cultural:

**Why the design level pays:**

1. **The bugs are the ones testing is worst at.** Concurrency and partial-failure bugs have a combinatorial state space and a schedule you do not control. Testing samples; a model checker enumerates. The AWS DynamoDB bug needed a 35-step interleaving; no test suite finds that by accident.
2. **The artifact is small and the effort is bounded.** 102 to 939 lines (§5.2). Days to weeks, by one engineer, with two weeks of learning.
3. **The spec is stable.** You do not rewrite your replication protocol weekly. The artifact keeps paying — three of AWS's six rows report verifying a *later optimization*, which is the compounding return.
4. **Design bugs are the most expensive to find late**, because fixing them invalidates code, APIs, on-disk formats and deployed clients.
5. **Writing the spec is valuable even if you never model-check it.** AWS reports refining prose designs into PlusCal and *"often this gives important insights without ever going as far as a full specification or model checking."* Precision is the product; the checker is a bonus.

**Why the code level usually does not pay:**

1. **The cost ratio is 20:1 in proof-to-code** (§5.6.1), against code that changes weekly.
2. **For most application code, the specification is as large as the code.** A CRUD endpoint's spec *is* its implementation; there is nothing to verify against. Verification pays when the specification is dramatically smaller than the implementation — a compiler ("meaning is preserved"), a kernel ("this component cannot touch that memory"), a crypto primitive ("this computes AES-GCM").
3. **The bugs in application code are mostly requirements errors**, and a proof against the wrong requirement is a correct proof of the wrong thing.
4. **Types and assertions already capture most of the affordable win** (§4.6), at a cost everyone already pays.

**The honest dosing ladder**, which is the practical takeaway of this entire document:

| Dose | Cost | When |
|---|---|---|
| **1. Types, `assert`, and compiler warnings** | ~free | Always. Non-negotiable. |
| **2. Property tests on algorithmic cores** | Hours | Any codec, parser, data structure, numeric routine |
| **3. Fuzzing + sanitizers, continuously** | Hours to set up, CPU forever | **Anything that parses untrusted input.** Non-negotiable for that case. |
| **4. Model-check the design of anything concurrent or distributed** | Days | **The most underused item on this list.** A lock-free algorithm, a replication protocol, a cache coherence scheme, a state machine with timeouts. |
| **5. SMT for one specific bounded question** | Hours | "Is this bit-twiddle identity true for all inputs?" "Can this policy leak?" "Is this optimization sound?" |
| **6. Deductive verification of a small critical kernel** | Person-years | A kernel, a compiler, a crypto primitive, and only when the stakes are seL4-shaped |

Steps 1–3 belong in every project in this curriculum. Step 4 belongs in the concurrency and distributed-systems units and nowhere else. Steps 5 and 6 are worth *knowing about* precisely so that a student can recognize the rare situation that calls for them and, far more often, recognize that a situation does not.

The thing to say to students at the end, borrowing AWS's framing because it is the best one available: **TLA+ is exhaustively testable pseudo-code.** Not a proof assistant, not a research programme — a way of writing your design down precisely enough that a machine can try every interleaving before you write any code. At a few hundred lines and a couple of weeks to learn, that is an ordinary engineering tool, and the reason it is not in ordinary use is mostly that it was marketed with the word "formal" attached.

---

## 6. Curriculum

### 6.1 Three units, in dependency order

Each unit has exactly one idea. The ordering is a strict dependency chain: you cannot teach the fuzzing unit before students understand that a fuzzer needs an oracle, and they cannot understand that before they understand that coverage is not an oracle.

| Unit | The ONE idea | Depends on | Prerequisite reports |
|---|---|---|---|
| **T1 — Oracles and coverage** | **A test is an input plus an oracle, and coverage measures only the input half.** 100% coverage with no assertions is 0% verification. | — | `cpp-linux-systems.md` |
| **T2 — Properties and shrinking** | **Stop writing inputs. Write the law, generate the inputs, and make the machine shrink the counterexample to something a human can read.** | T1 (you need to want an oracle before you will write one as a law) | `numbers-text-numerics.md` (UTF-8), `information-theory-coding.md` (Huffman) |
| **T3 — Coverage-guided fuzzing** | **A fuzzer is a search engine over the CFG; a sanitizer is the oracle. Neither half finds anything alone.** | T2 (a fuzzer's oracle is a property or a sanitizer — both introduced in T2), T1 (coverage as feedback, not as a score) | `hardware-security.md` (what the bugs *are*), `debugging-and-measurement.md` (sanitizers) |

A short **coda** after T3, not a full unit: model-checking a design in TLA+ (§5). It has no dependency on T1–T3 and belongs wherever the concurrency material lands — but it should be taught *after* T3, so that students meet it having already learned, viscerally, that testing does not reach concurrent interleavings.

**Unit T1 — Oracles and coverage.** Content: what a test double is and when a mock certifies a fiction (§1.3); the determinism checklist (§1.4); the line/branch/MC-DC hierarchy (§1.6); `gcov` and `llvm-cov` mechanics; and the central exercise (§6.3.1) in which a suite with full line coverage passes on code that is broken, and a one-line addition catches it. Ends with mutation testing (§1.8) as the answer to "so how do I grade my assertions?"

**Unit T2 — Properties and shrinking.** Content: the six property shapes (§2.5); generators and why distribution is the whole game (§2.2); shrinking, taught as an *algorithm students implement themselves* (§2.4), because a hand-rolled twenty-line shrinker teaches more than importing RapidCheck; model-based testing against `std::map` for the B-tree exercise (§2.5.6, §2.7.4). Ends by pointing at `-minimize_crash=1` and saying: you have already written this.

**Unit T3 — Coverage-guided fuzzing.** Content: the loop (§3.2); SanitizerCoverage instrumentation, which students *use directly* by writing the callbacks themselves; the sanitizer-as-oracle argument (§3.6); the UB-deletes-your-bug lesson (§3.6.3); libFuzzer's contract (§3.4); what makes a good target and why campaigns find nothing (§3.8); differential fuzzing (§3.10); and OSS-Fuzz as the argument that this is a continuous activity (§3.12). The centrepiece is §6.3.3, where students build a working coverage-guided fuzzer from scratch in one file.

### 6.2 The Compiler Explorer API — verified mechanics

**Everything in this subsection was verified by live API calls on 2026-09-01.** The headline result, since it determines the shape of the whole unit:

> **libFuzzer works on Compiler Explorer.** `-fsanitize=fuzzer,address` compiles, links, and runs, with full ASan reports on the crashes it finds. A verified run found a planted `stack-buffer-overflow` in **1.8 seconds**.

Because that is true, T3 can use the real tool. Because the hand-rolled version is more instructive, T3 should use **both** — build the fuzzer by hand first (§6.3.3), then replace it with `-fsanitize=fuzzer` (§6.3.4) and observe that the real one is faster and better at the same job.

#### 6.2.1 The request

```
POST https://godbolt.org/api/compiler/<compiler-id>/compile
Content-Type: application/json
Accept: application/json
```

```jsonc
{
  "source": "#include <cstdio>\nint main(){ printf(\"hi\\n\"); }\n",
  "options": {
    "userArguments": "-std=c++20 -O1 -g -fsanitize=address",
    "executeParameters": { "args": ["-runs=100000"], "stdin": "" },
    "compilerOptions": { "executorRequest": true },   // ← required to RUN, not just compile
    "filters": { "execute": true }                    // ← also required
  },
  "lang": "c++",
  "allowStoreCodeDebug": true
}
```

The two fields that matter and are easy to miss are `compilerOptions.executorRequest: true` and `filters.execute: true`. Without both you get assembly back, not program output.

#### 6.2.2 The response

```jsonc
{
  "code": 1,                    // ← the program's exit status. 0 = pass. Use this as the grade.
  "didExecute": true,
  "timedOut": false,
  "okToCache": true,            // ← see §6.2.5
  "execTime": 1766,             // milliseconds, program run
  "stdout": [ { "text": "..." } ],   // array of lines
  "stderr": [ { "text": "..." } ],   // sanitizer reports land here
  "buildResult": {
    "code": 0,                  // ← nonzero means it did not compile; stderr has the diagnostics
    "stderr": [ ... ],
    "execTime": 1143,
    "compilationOptions": [ ... ],
    "defaultExecOptions": { "timeoutMs": 20000, "maxErrorOutput": 5000, ... }
  }
}
```

**Grading is `buildResult.code == 0 && code == 0`**, with `stderr` shown to the student. That is the whole machine-checkable contract, and it is enough for every exercise below.

#### 6.2.3 Verified capabilities

| Capability | Flags | Verified result (2026-09-01) |
|---|---|---|
| **Execution** | `executorRequest`, `filters.execute` | Works. `code`, `stdout`, `stderr`, `execTime` all returned. |
| **AddressSanitizer** | `-fsanitize=address` | **Works.** Full symbolized report: error class, read/write and size, source line, allocation stack, shadow-byte dump. Exit code 1. |
| **UndefinedBehaviorSanitizer** | `-fsanitize=undefined -fno-sanitize-recover=all` | **Works.** `runtime error: signed integer overflow: 2147483647 + 1 …`, exit code 1. Note `-fno-sanitize-recover=all` is what makes it a nonzero exit — without it UBSan prints and returns 0, and the exercise silently always passes. |
| **libFuzzer** | `-fsanitize=fuzzer` or `-fsanitize=fuzzer,address` | **Works.** Full engine output including the entropic power schedule line, `NEW`/`REDUCE` lines with mutation chains, and ASan crash reports. Pass runtime flags through `executeParameters.args`. |
| **SanitizerCoverage** | `-fsanitize-coverage=trace-pc-guard` | **Works**, including user-supplied `__sanitizer_cov_trace_pc_guard{,_init}` — this is what makes the hand-rolled fuzzer possible. |
| **ASan + sancov together** | `-fsanitize=address -fsanitize-coverage=trace-pc-guard` | **Works.** This combination is the hand-rolled exercise. |
| **`__sanitizer_set_death_callback`** | (ASan runtime) | Links and is callable — the mechanism for printing the crashing input after ASan reports. |
| **Compilers** | | `clang2010` (20.1.0) used throughout; `clang1810`…`clang2310`, `clang_trunk`, `g131`…`g144` also present. Pin an explicit version; do not use `trunk` in a course. |

**Not available in the execution sandbox:** `gcov`, `llvm-profdata`, `llvm-cov`. The executor runs one binary; it is not a shell. **This is why the coverage exercise (§6.3.1) counts edges with SanitizerCoverage callbacks inside the program itself rather than shelling out to a coverage tool** — the numbers it reports are genuinely measured, and it works.

#### 6.2.4 Limits

- **20-second execution timeout** (`defaultExecOptions.timeoutMs: 20000`, observed). Every fuzzing exercise must bound itself: `-runs=N` and `-max_total_time=S` for libFuzzer, a bounded iteration count for the hand-rolled loop. A verified 3,000,000-iteration hand-rolled run completed in 319 ms; a verified 2,000,000-`runs` libFuzzer run completed in 1.8 s. There is ample headroom.
- **Single translation unit.** Multi-file projects need the CE "compiler explorer multi-file" flow; for a course, keep every exercise to one file. All exercises below are single-file.
- **`stderr` is truncated** at `maxErrorOutput: 5000` by default, and an ASan report is large. If you need output *after* a sanitizer report (e.g. a death callback), expect to read the tail.
- **stdout is buffered and is LOST when a sanitizer aborts.** This bit three of the verification runs. **Always `setvbuf(stdout, nullptr, _IONBF, 0)` at the top of `main`** in any exercise that is expected to abort, or the student sees an ASan report and none of the program's own narration.

#### 6.2.5 Caching — and the nonce, verified

**Compiler Explorer caches results, and the cache includes timings and program output.** This was verified directly. The same source submitted twice:

```
run 0  wall=0.85s  execTime=83  buildExec=138  okToCache=True  stdout: "t=2643  done"
run 1  wall=0.50s  execTime=83  buildExec=138  okToCache=True  stdout: "t=2643  done"
```

`t` is the program's own `clock()` reading. It is **identical** across runs — the second submission never executed anything; the whole result was replayed from cache. With a per-submission nonce appended as a comment:

```
run 0  wall=0.65s  execTime=89  buildExec=213  stdout: "t=5395  done"
run 1  wall=0.60s  execTime=93  buildExec=196  stdout: "t=4962  done"
```

Different every time — the cache is missed and the program really runs.

**Therefore: append a unique nonce to every submission.** One line, at the end of the source:

```cpp
// nonce: 7f3a9c1e0b2d4856a1c9e3f70d84b2c6
```

This matters for three separate reasons, and only the first is obvious:

1. A fuzzing exercise that is re-submitted unchanged would report the *cached* result, so a student who "runs it again to see if it finds it this time" sees a replay rather than a new random search.
2. Any exercise that reports a timing is reporting a cached timing.
3. Most subtly: **an autograder re-running a submission to check for flakiness would get the cached verdict**, which defeats the check entirely.

#### 6.2.6 What to re-check if these exercises stop working

In rough order of likelihood: (a) compiler IDs — pin one and confirm it still exists via `GET /api/compilers/c++?fields=id,name`; (b) whether `-fsanitize=fuzzer` is still permitted, since it is the most unusual capability being relied on and a sandbox policy change would remove it first; (c) the 20-second timeout value; (d) the request JSON shape, which has been stable but is not a versioned API.

### 6.3 The exercises

All five are **single-file, machine-checkable by exit code, and verified to run on Compiler Explorer on 2026-09-01.** Observed output is quoted for each.

#### 6.3.1 (T1) The 100%-line-coverage test that misses the bug — and the branch test that catches it

*The pairing that teaches coverage better than any lecture.* The trick that makes it work on CE — where no coverage tool is available in the sandbox — is that the program **counts its own edges** using SanitizerCoverage callbacks, so the coverage numbers it prints are measured rather than asserted.

```cpp
// build: clang++ -std=c++20 -O0 -g -fsanitize=address -fsanitize-coverage=trace-pc-guard
#include <cstdio>
#include <cstring>
#include <cstdint>

// ---- edge counting: these callbacks must NOT be instrumented themselves ----
#define NG 4096
static uint8_t hit[NG]; static uint32_t NGU;
extern "C" __attribute__((no_sanitize("coverage")))
void __sanitizer_cov_trace_pc_guard_init(uint32_t *s, uint32_t *e) {
  static uint32_t k = 1; if (s == e || *s) return;
  for (uint32_t *p = s; p < e; p++) *p = k++;
  NGU = k - 1;
}
extern "C" __attribute__((no_sanitize("coverage")))
void __sanitizer_cov_trace_pc_guard(uint32_t *g) { uint32_t i = *g; if (i < NG) hit[i] = 1; }
__attribute__((no_sanitize("coverage"))) static int  cov()   { int c = 0; for (uint32_t i = 1; i <= NGU && i < NG; i++) c += hit[i]; return c; }
__attribute__((no_sanitize("coverage"))) static void reset() { memset(hit, 0, sizeof hit); }

// ================= THE CODE UNDER TEST =================
__attribute__((noinline))
static size_t copy_clamped(char *out, size_t cap, const char *in, size_t len) {
  if (len > cap) len = cap + 1;      // <<< BUG: a typo. Should be `len = cap;`
  memcpy(out, in, len);
  return len;
}
// Both LINES run from one short input. Only ONE DIRECTION of the branch does.
// =======================================================

__attribute__((no_sanitize("coverage")))
int main() {
  setvbuf(stdout, nullptr, _IONBF, 0);          // survive an ASan abort
  printf("instrumented edges in copy_clamped: %u\n\n", NGU);

  printf("SUITE A -- the \"100%% line coverage\" suite\n");
  reset();
  { char b[8]; memset(b, 0, sizeof b);
    size_t r = copy_clamped(b, sizeof b, "abc", 3);
    printf("  copy_clamped(cap=8, len=3) -> %zu, buf=\"%s\"  %s\n",
           r, b, (r == 3 && memcmp(b, "abc", 3) == 0) ? "PASS" : "FAIL"); }
  printf("  >> every line of copy_clamped executed.  EDGE COVERAGE: %d/%u\n\n", cov(), NGU);

  printf("SUITE B -- drive the OTHER direction of the branch\n");
  reset();
  { char b[8]; memset(b, 0, sizeof b);
    size_t r = copy_clamped(b, sizeof b, "abcdefghijklmno", 15);
    printf("  copy_clamped(cap=8, len=15) -> %zu (must be <= 8)  %s\n",
           r, (r <= 8) ? "PASS" : "FAIL  <<< THE BUG"); }
  printf("  >> EDGE COVERAGE: %d/%u\n", cov(), NGU);
  return 0;
}
// nonce: <unique per submission>
```

**Verified output at `-O0`:**

```
instrumented edges in copy_clamped: 3

SUITE A -- the "100% line coverage" suite
  copy_clamped(cap=8, len=3) -> 3, buf="abc"  PASS
  >> every line of copy_clamped executed.  EDGE COVERAGE: 2/3

SUITE B -- drive the OTHER direction of the branch
==1==ERROR: AddressSanitizer: stack-buffer-overflow
WRITE of size 9 at 0x… — copy_clamped(…) at example.cpp:20
```

**The lesson, in three numbers.** Suite A executes **every line** of `copy_clamped` and **passes**. It covers **2 of 3 edges**. The third edge is where the bug lives. Suite B does nothing but take the other direction of one `if`, and the bug is instantaneous and catastrophic.

**The bonus lesson, which is free and excellent.** Re-run at **`-O1`** and the same program reports `instrumented edges in copy_clamped: 1` — the branch is gone, compiled to a `cmov`, and "edge coverage 1/1" is now trivially 100% while the bug is completely untouched. This was observed, not hypothesized. It teaches, in one flag change, that **coverage is a property of the compiled code and not of the source**, that coverage builds are conventionally `-O0` for exactly this reason, and that a coverage percentage is not even a stable number across build configurations — let alone a measure of quality.

**Autograded task.** Given `copy_clamped`, the student must (a) submit a test that fails, and (b) fix the bug so both suites pass. Grade on exit code plus a check that Suite B's assertion is present.

#### 6.3.2 (T2) A property test for a function with a subtle bug, showing the shrunk counterexample

*The exercise that makes shrinking real by making the student write it.* No framework — a generator, a property, and a twenty-line greedy shrinker.

The bug is a classic and it is genuinely easy to write by accident: a merge of two sorted vectors that, when the two heads are **equal**, emits one element but advances **both** cursors — silently dropping a value.

```cpp
// build: clang++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all
#include <cstdio>
#include <cstdint>
#include <vector>
#include <algorithm>
#include <string>
using V = std::vector<int>;

// ============ CODE UNDER TEST ============
static V merge_sorted(const V &a, const V &b) {
  V out; out.reserve(a.size() + b.size());
  size_t i = 0, j = 0;
  while (i < a.size() && j < b.size()) {
    if      (a[i] < b[j]) out.push_back(a[i++]);
    else if (b[j] < a[i]) out.push_back(b[j++]);
    else { out.push_back(a[i++]); j++; }        // <<< BUG: equal heads -> b[j] is dropped
  }
  while (i < a.size()) out.push_back(a[i++]);
  while (j < b.size()) out.push_back(b[j++]);
  return out;
}
// =========================================

// ---- THE PROPERTY: sorted AND a permutation of the concatenation ----
static bool property(const V &a, const V &b) {
  V m = merge_sorted(a, b);
  if (!std::is_sorted(m.begin(), m.end())) return false;    // half the spec
  V all = a; all.insert(all.end(), b.begin(), b.end());
  V ms = m, as = all;
  std::sort(ms.begin(), ms.end()); std::sort(as.begin(), as.end());
  return ms == as;                                          // the half people forget
}

// ---- generator: SMALL key space, so equal elements actually occur ----
static uint64_t s = 0x9E3779B97F4A7C15ULL;
static uint64_t rnd() { s ^= s << 13; s ^= s >> 7; s ^= s << 17; return s; }
static V gen(int maxlen, int keyspace) {
  V v(rnd() % (maxlen + 1));
  for (auto &x : v) x = (int)(rnd() % keyspace);
  std::sort(v.begin(), v.end());
  return v;
}

// ---- THE SHRINKER: greedy descent, most aggressive candidate first ----
static int shrink_steps = 0;
static void shrink(V &a, V &b) {
  bool improved = true;
  while (improved) {
    improved = false;
    for (V *v : {&a, &b})                                   // 1. halve
      if (v->size() > 1) { V save = *v; v->resize(v->size()/2);
        if (!property(a,b)) { shrink_steps++; improved = true; break; } *v = save; }
    if (improved) continue;
    for (V *v : {&a, &b}) {                                 // 2. delete one element
      for (size_t i = 0; i < v->size(); i++) { V save = *v; v->erase(v->begin()+i);
        if (!property(a,b)) { shrink_steps++; improved = true; break; } *v = save; }
      if (improved) break; }
    if (improved) continue;
    for (V *v : {&a, &b}) {                                 // 3. lower one value
      for (size_t i = 0; i < v->size(); i++) { int save = (*v)[i];
        for (int cand : {0, save/2}) { if (cand >= save) continue; (*v)[i] = cand;
          if (!property(a,b)) { shrink_steps++; improved = true; break; } (*v)[i] = save; }
        if (improved) break; }
      if (improved) break; }
  }
}

int main() {
  setvbuf(stdout, nullptr, _IONBF, 0);
  for (int t = 0; t < 2000; t++) {
    V a = gen(12, 40), b = gen(12, 40);
    if (property(a, b)) continue;
    printf("FALSIFIED after %d tests\n", t + 1);
    /* … print raw a, b … */
    shrink(a, b);
    /* … print shrunk a, b, and merge_sorted(a,b) … */
    return 1;
  }
  printf("2000 tests passed\n");
  return 0;
}
// nonce: <unique per submission>
```

**Verified output:**

```
FALSIFIED after 2 tests
  raw counterexample:    a=[0,17,23,23,31,37]
                         b=[3,7,12,13,13,13,15,18,23,29,38]
  shrunk (12 steps):     a=[23]
                         b=[23]
  merge_sorted(a,b) = [23]   (expected a permutation of a++b)
```

**Everything worth teaching is visible in that output:**

- **The raw counterexample is 17 elements and tells you nothing.** The shrunk one is two elements and *names the bug*: two equal values, one survives. That is the entire argument for §2.4, demonstrated rather than asserted.
- **Twelve shrink steps.** Cheap. The shrinker is doing in milliseconds what a human does in twenty minutes.
- **The `is_sorted` half of the property passes.** `[23]` *is* sorted. Only the permutation clause catches the bug. This is the single best illustration of why "state the whole specification" matters — a suite that only checked sortedness would be green forever on a merge that returns the empty vector.
- **The shrunk value is `23`, not `0` — and that is a lesson, not a defect.** The shrinker is a **greedy local** search (§2.4). From `a=[23], b=[23]`, lowering *either* 23 alone makes the heads unequal and the property pass, so no single-element move improves. Reaching `[0],[0]` needs a *simultaneous* move the shrinker does not have. Ask students to add a "lower both" pass, watch it reach `[0],[0]`, and then discuss why real shrinkers (Hypothesis, in particular) have a long list of such passes and a fixpoint loop over all of them.

**Extension tasks**, in increasing order: (a) add a pass that lowers all elements together; (b) print the seed and make the whole run replayable; (c) re-target the same harness at the UTF-8 decoder from `numbers-text-numerics.md` and confirm the shrunk counterexample is `0xD800` (§2.7.1); (d) convert the harness to model-based testing over a B-tree against `std::map` (§2.7.4).

#### 6.3.3 (T3, the centrepiece) A hand-rolled coverage-guided fuzzer over a parser with a planted overflow, watched by ASan

*This is the exercise the whole document builds toward.* In one file, about 90 lines, students build a working coverage-guided fuzzer: real SanitizerCoverage instrumentation, a real corpus, a real mutation loop, real feedback — and watch it climb a magic-number check byte by byte and then find a buffer overflow that ASan reports.

```cpp
// build: clang++ -std=c++20 -O1 -g -fsanitize=address -fsanitize-coverage=trace-pc-guard
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>
#include <string>

// ---------- 1. COVERAGE: the SanitizerCoverage callbacks (you write these) ----------
// They must be marked no_sanitize("coverage") or they call themselves -> stack overflow.
#define NG 65536
static uint8_t  g_hit[NG];       // edges hit during THIS execution
static uint8_t  g_total[NG];     // edges hit EVER
static uint32_t g_nguards;

extern "C" __attribute__((no_sanitize("coverage")))
void __sanitizer_cov_trace_pc_guard_init(uint32_t *start, uint32_t *stop) {
  static uint32_t next = 1;
  if (start == stop || *start) return;
  for (uint32_t *p = start; p < stop; p++) *p = next++;   // assign each edge an id
  g_nguards = next - 1;
}
extern "C" __attribute__((no_sanitize("coverage")))
void __sanitizer_cov_trace_pc_guard(uint32_t *guard) {
  uint32_t id = *guard;
  if (id < NG) g_hit[id] = 1;
}

// ---------- 2. THE TARGET: a binary record parser with a planted overflow ----------
struct Rec { char name[8]; int len; };

__attribute__((noinline))
static int parse(const uint8_t *d, size_t n) {
  static volatile int sink;                  // keeps the work observable; see §3.6.3
  if (n < 4) return -1;
  if (d[0] != 'R' || d[1] != 'E' || d[2] != 'C') return -2;   // magic
  uint8_t nlen = d[3];
  if (n < 4u + nlen) return -3;
  Rec r{};
  memcpy(r.name, d + 4, nlen);   // <<< BUG: nlen may be up to 255; name is 8 bytes
  r.len = nlen;
  sink = r.name[0] + r.len;
  return 0;
}

// ---------- 3. THE FUZZER ----------
static uint64_t rs = 0x2545F4914F6CDD1DULL;
__attribute__((no_sanitize("coverage")))
static uint64_t rnd() { rs ^= rs<<13; rs ^= rs>>7; rs ^= rs<<17; return rs; }

static std::string g_current;                        // for the death callback
extern "C" void __sanitizer_set_death_callback(void (*)(void));
extern "C" void death_callback() {                   // runs after ASan's report
  fprintf(stderr, "\n>>> CRASHING INPUT (%zu bytes): ", g_current.size());
  for (unsigned char c : g_current) fprintf(stderr, "%02x ", c);
  fprintf(stderr, "\n");
}

__attribute__((no_sanitize("coverage")))
static std::string mutate(const std::string &in) {
  std::string s = in;
  int ops = 1 + (int)(rnd() % 4);
  for (int i = 0; i < ops; i++) {
    switch (rnd() % 5) {
      case 0: if (!s.empty()) s[rnd()%s.size()] ^= (char)(1u << (rnd()%8)); break;   // bit flip
      case 1: s.insert(s.begin() + (rnd()%(s.size()+1)), (char)(rnd()&0xff)); break; // insert
      case 2: if (!s.empty()) s.erase(s.begin() + (rnd()%s.size())); break;          // erase
      case 3: if (!s.empty()) {                                                      // interesting value
                static const uint8_t iv[] = {0,1,8,9,16,32,127,128,255};
                s[rnd()%s.size()] = (char)iv[rnd()%(sizeof iv)]; } break;
      case 4: if (!s.empty() && s.size() < 32) s += s; break;                        // duplicate (grow)
    }
  }
  if (s.size() > 64) s.resize(64);
  return s;
}

int main() {
  setvbuf(stdout, nullptr, _IONBF, 0);          // CRITICAL: survive the ASan abort
  __sanitizer_set_death_callback(death_callback);
  printf("guards discovered: %u\n", g_nguards);

  std::vector<std::string> corpus = {""};       // start from literally nothing
  int total_edges = 0;

  for (long iter = 0; iter < 3000000; iter++) {
    std::string in = mutate(corpus[rnd() % corpus.size()]);
    g_current = in;

    memset(g_hit, 0, sizeof g_hit);             // reset per-execution coverage
    parse((const uint8_t*)in.data(), in.size());// ASan may abort inside here

    bool novel = false;                         // ---- THE FEEDBACK ----
    for (uint32_t i = 1; i <= g_nguards && i < NG; i++)
      if (g_hit[i] && !g_total[i]) { g_total[i] = 1; novel = true; total_edges++; }

    if (novel) {                                // new coverage -> keep it as breeding stock
      corpus.push_back(in);
      printf("iter %6ld  NEW COVERAGE  edges=%d  corpus=%zu  input=\"", iter, total_edges, corpus.size());
      for (unsigned char c : in) putchar((c>=32&&c<127)?c:'.');
      printf("\"\n");
    }
  }
  printf("done, no crash; edges=%d/%u\n", total_edges, g_nguards);
}
// nonce: <unique per submission>
```

**Verified behaviour, in two stages.** With a smaller mutation set (no length-growing operator) and 300,000 iterations, the run does **not** crash, but the coverage climb is perfectly visible and is the thing to look at first:

```
guards discovered: 170
iter      0  NEW COVERAGE  edges=5   corpus=2  input=""
iter      1  NEW COVERAGE  edges=6   corpus=3  input="m"
iter    866  NEW COVERAGE  edges=7   corpus=4  input=".%m."
iter  15496  NEW COVERAGE  edges=8   corpus=5  input="R.m."
iter  27983  NEW COVERAGE  edges=9   corpus=6  input="RE..m."
iter  45384  NEW COVERAGE  edges=10  corpus=7  input="REC..m."
iter  45665  NEW COVERAGE  edges=11  corpus=8  input="REC.m."
done, no crash found; edges=11/170
```

**Stop the class here and read that output line by line.** Starting from the empty string, with no knowledge whatsoever of the format, the fuzzer discovered `R`, then `RE`, then `REC` — **one byte at a time, each byte retained because it unlocked one new edge.** That is coverage-guided search, visible, in seven lines of output. It is the JPEG-from-"hello" result at a scale students can read. Nobody told it the magic number.

Then add the length-growing `case 4` mutation and raise the iteration cap, and the same program finds the bug:

```
==1==ERROR: AddressSanitizer: stack-buffer-overflow on address 0x7bf5979d11ac
WRITE of size 16 at 0x7bf5979d11ac thread T0
    #0 __asan_memcpy
    #1 parse(unsigned char const*, unsigned long) /app/example.cpp:43:3
    #2 main /app/example.cpp:96:5
Address 0x7bf5979d11ac is located in stack of thread T0 at offset 44 in frame
  #0 parse(unsigned char const*, unsigned long) /app/example.cpp:36
  This frame has 1 object(s):
    [32, 44) 'r' (line 42)  <== Memory access at offset 44 overflows this variable
```

Total runtime: **319 ms** for three million executions.

**The discussion this exercise is designed to produce**, and every one of these points is now backed by something the students watched happen:

1. **Delete `-fsanitize=address` and re-run.** The overflow still occurs. Nothing is reported. The fuzzer runs to completion and prints "done, no crash". *This is §3.6, and it lands with a force no lecture achieves.*
2. **Delete `-fsanitize-coverage=trace-pc-guard`** (and the feedback). The corpus never grows past the seed; the mutation loop becomes a blind random walk; `REC` is never found. *This is §3.1's generation-2-vs-3 distinction, demonstrated.*
3. **Remove `no_sanitize("coverage")` from the callbacks.** The program dies instantly with a stack overflow inside `__sanitizer_cov_trace_pc_guard`. (Verified: an early version of this exercise did exactly that.) *An instrumented program cannot use instrumented code in its own instrumentation callback — a real, load-bearing constraint that also explains why libFuzzer's runtime is compiled without coverage.*
4. **Remove the `volatile sink`** and watch the optimizer delete the target. *§3.6.3.*
5. **Add hit-count bucketing** (§3.2.2) instead of a coverage bit, and see the corpus behave differently.
6. **Add a `-dict`-style mutation** that inserts the token `"REC"` and watch `edges=10` arrive in tens of iterations rather than tens of thousands. *That is §3.7.2's argument for dictionaries, measured.*

#### 6.3.4 (T3) The same target, handed to the real libFuzzer

Immediately after §6.3.3, delete the fuzzer and keep the target:

```cpp
// build: clang++ -std=c++20 -O1 -g -fsanitize=fuzzer,address
// run args (via executeParameters.args): -runs=2000000 -max_total_time=15 -max_len=32 -seed=1
#include <cstdint>
#include <cstddef>
#include <cstring>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *d, size_t n) {
  static volatile int sink;
  char buf[8] = {0};
  if (n >= 4 && d[0]=='F' && d[1]=='U' && d[2]=='Z' && d[3]=='Z')
    memcpy(buf, d, n);                     // stack-buffer-overflow when n > 8
  sink = buf[0];
  return 0;
}
// nonce: <unique per submission>
```

**Verified output** (abridged; the mutation chains are real):

```
INFO: Running with entropic power schedule (0xFF, 100).
INFO: Seed: 1
INFO: Loaded 1 modules (7 inline 8-bit counters): 7
INFO: A corpus is not provided, starting from an empty corpus
#2      INITED cov: 2 ft: 2 corp: 1/1b
#12     NEW    cov: 3 ft: 3 corp: 2/5b  lim: 4  L: 4/4  MS: 5 CrossOver-InsertByte-CopyPart-ChangeBit-CrossOver-
#12765  NEW    cov: 4 ft: 4 corp: 3/26b lim: 32 L: 21/21 MS: 3 ShuffleBytes-ShuffleBytes-InsertRepeatedBytes-
#13100  REDUCE cov: 4 ft: 4 corp: 3/20b lim: 32 L: 15/15 MS: 1 EraseBytes-
#13465  REDUCE cov: 4 ft: 4 corp: 3/9b  lim: 32 L: 4/4   MS: 1 EraseBytes-
#290028 NEW    cov: 6 ft: 6 corp: 5/17b lim: 32 L: 4/4   MS: 1 ChangeByte-
#290634 NEW    cov: 7 ft: 7 corp: 6/21b lim: 32 L: 4/4   MS: 1 CopyPart-
==1==ERROR: AddressSanitizer: stack-buffer-overflow ... WRITE of size 9
    #1 LLVMFuzzerTestOneInput /app/example.cpp:10:5
```

**1.8 seconds, from an empty corpus, to a symbolized ASan report.**

The teaching points are the diff against §6.3.3: (a) the whole fuzzer collapsed to one function — everything else was the engine, and the engine is a compiler flag; (b) `REDUCE` lines show libFuzzer **shrinking the corpus continuously**, which the hand-rolled version does not do; (c) `MS: n` names the mutation chain, so students can see the vocabulary of §3.3 in use; (d) `cov` vs `ft` distinguishes edges from features. Then have them **read the contract in §3.4** and identify which requirement each of the anti-patterns in §3.8 violates.

**A deliberate failure to assign.** Give students the *first* version that was written during verification of this document — identical, but with `int *p = nullptr; *p = 1;` as the "crash" and no `volatile sink`. It runs 200,000 executions, reports full coverage, and finds nothing, because the optimizer deleted the undefined branch. Ask them why. That single exercise teaches more about undefined behaviour than a chapter about it.

#### 6.3.5 (T3) Differential-test two implementations of one function

*The oracle-free oracle.* Two implementations of the midpoint of two integers — the second being the one everyone "knows" is the overflow-safe rewrite:

```cpp
// build: clang++ -std=c++20 -O1 -g -fsanitize=undefined -fno-sanitize-recover=all
__attribute__((noinline)) static int mid_A(int a, int b) { return (a + b) / 2; }
__attribute__((noinline)) static int mid_B(int a, int b) { return a + (b - a) / 2; }
// … generate a, b biased toward {0, ±1, ±2, INT_MAX, INT_MIN, 1<<30, …} and random …
// … assert mid_A(a,b) == mid_B(a,b), report the first divergence …
```

**Stage 1 — unrestricted inputs. Verified output:**

```
DIVERGENCE after 0 trials: a=2 b=-1  mid_A=0 mid_B=1
```

This is a *far better* result than the one the exercise was designed to produce, and it should be taught as the headline. There is **no overflow here at all**. `(2 + -1)/2 = 1/2 = 0` because C integer division truncates toward zero; `2 + (-1 - 2)/2 = 2 + (-3)/2 = 2 + (-1) = 1`. **The two formulas are not equivalent, and not for the reason anybody expects.** A hand-written unit test with `mid(4, 10)` would never have found it; a differential test found it on the very first trial. That is the argument for §3.10 in one line of output.

**Stage 2 — restrict to `0 <= a <= b` so truncation cannot differ, and the intended lesson appears. Verified output:**

```
STAGE 2: inputs restricted to 0 <= a <= b, so truncation cannot differ.
/app/example.cpp:5:69: runtime error: signed integer overflow:
  1118302135 + 1120727352 cannot be represented in type 'int'
SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior
```

`mid_A` overflows. This is **the** binary-search bug — the one that sat in the JDK's `binarySearch` and in Bentley's *Programming Pearls* for years before Joshua Bloch wrote it up in 2006 — found here by a generator, an oracle, and UBSan, in twenty-two milliseconds.

**The three-way close, which ties the document together.** Take the same question to §5.4's SMT example:

```python
from z3 import *
a, b = BitVecs('a b', 32)
prove(UDiv(a + b, 2) == a + UDiv(b - a, 2))     # counterexample
```

Now the students have answered one question three ways: **a differential test** found a divergence in milliseconds by sampling; **UBSan** proved the mechanism (signed overflow) on a concrete input; **Z3** settled it for all 2⁶⁴ inputs at once. Three techniques, three kinds of confidence, one function. That is the shape of the whole document, in an exercise that fits on one screen.

### 6.4 Coda: model-check a design (§5)

Not a full unit, and not machine-checkable via Compiler Explorer — TLA+ needs the TLA+ Toolbox or `tla2tools.jar` locally. But it belongs at the end of T3, as a two-session appendix, because it is the only technique in this document that reaches concurrent interleavings, and students will just have spent three units learning that testing does not.

The right first exercise is small and it should be one they have already failed at by hand: **specify a two-process mutual-exclusion algorithm in PlusCal (Peterson's, or a naive test-and-set), state the invariant `~(inCS[1] /\ inCS[2])`, and let TLC find the interleaving that violates it.** Then a second: a replication protocol with message loss and reordering, ~80 lines, checked at three nodes.

Two disciplines to enforce from the first minute, both from §5.2:

1. **Break the algorithm deliberately and confirm TLC catches it**, before believing any success. A specification that is vacuously satisfied reports success, and this is the mutation-testing discipline of §1.8 applied to a spec.
2. **Read the counterexample trace as a sequence of states**, not as an error message. It is the artifact — the same "shortest counterexample" deliverable as a shrunk property-test input (§2.4) and a minimized crash (§3.9.1). By this point in the curriculum, students have seen that deliverable three times from three different tools, and naming the pattern is the right note to end on.

---

## Appendix A — Verification ledger

This document was researched in a session whose **web-search budget was exhausted (200/200 calls) early in the process**, before most of the citation-checking could be done. What follows is an honest split. Nothing in the "not verified" list is believed to be *wrong*; all of it is stated from model knowledge (training cutoff May 2026) and should be checked against a primary source before being taught as a number.

### A.1 Verified live during this session (2026-09-01)

**Compiler Explorer API — all verified by direct HTTP calls to `godbolt.org/api`:**

| Claim | Evidence |
|---|---|
| `POST /api/compiler/<id>/compile` with `compilerOptions.executorRequest: true` and `filters.execute: true` runs the program and returns `code`, `stdout`, `stderr`, `execTime` | Ran `printf("hello CE %d", 42)` on `g142`; got `code: 0`, `stdout: "hello CE 42"` |
| Compiler IDs `clang1810`…`clang2310`, `clang_trunk`, `g131`…`g144` exist | `GET /api/compilers/c++?fields=id,name,semver` |
| **libFuzzer works** (`-fsanitize=fuzzer,address`) | Full engine output; found a planted `stack-buffer-overflow` in **1.8 s** / 290,634 executions; exit code 1 |
| **ASan works** | Full symbolized `heap-buffer-overflow` and `stack-buffer-overflow` reports with allocation stacks and shadow-byte dumps |
| **UBSan works**, and needs `-fno-sanitize-recover=all` for a nonzero exit | `runtime error: signed integer overflow: 2147483647 + 1`, exit code 1 |
| **SanitizerCoverage `trace-pc-guard` works with user-supplied callbacks** | Hand-rolled fuzzer ran 3,000,000 iterations in 319 ms and found the overflow |
| **ASan + sancov compose** | The hand-rolled fuzzer exercise |
| `__sanitizer_set_death_callback` links and is callable | Linked successfully in the hand-rolled fuzzer |
| **Execution timeout is 20 s** | `buildResult.defaultExecOptions.timeoutMs: 20000` in every response |
| `maxErrorOutput: 5000` truncates long stderr | Same field |
| **CE caches results including timings AND program output; a nonce defeats it** | Same source twice → identical `execTime` (83), identical `buildResult.execTime` (138), and *identical `clock()` output* (`t=2643`). With a nonce: `t=5395` then `t=4962`, `execTime` 89 then 93. |
| `gcov`/`llvm-cov`/`llvm-profdata` are not available in the execution sandbox | The executor runs one binary; no shell |

**Behaviours discovered by experiment (not from documentation):**

| Finding | How it was found |
|---|---|
| At `-O1`, `if (…) { int *p = nullptr; *p = 1; }` is **deleted** as unreachable UB; libFuzzer ran 200,000 executions with full coverage and reported no crash | First attempt at the §6.3.4 exercise |
| A fuzz target whose result is unconditionally constant (`return (int)buf[0] & 0;`) is **entirely deleted**; libFuzzer reported "1 inline 8-bit counter" for the whole module | Second attempt at the same exercise |
| A sancov callback that itself calls instrumented code (`std::set::insert`) **recurses infinitely** and dies with a stack overflow inside `__sanitizer_cov_trace_pc_guard` | First attempt at §6.3.3 |
| `-O1` compiles `if (len > cap) len = cap + 1;` **branchlessly** — 1 instrumented edge instead of 3, so "edge coverage" becomes trivially 100% | §6.3.1 run at both `-O0` and `-O1` |
| stdout is buffered and **lost** when a sanitizer aborts; `setvbuf(…, _IONBF, …)` is required | Three separate verification runs lost their narration |
| The greedy shrinker in §6.3.2 reaches the local minimum `a=[23], b=[23]` rather than `[0],[0]`, because no single-element move improves from there | §6.3.2 run |

**Primary sources fetched and quoted:**

| Source | What was taken |
|---|---|
| Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff, *Use of Formal Methods at Amazon Web Services* (29 Sept 2014 preprint of the *CACM* April 2015 paper), fetched as PDF and text-extracted | The systems/line-count/benefit table **verbatim**; the 35-step DynamoDB trace; the "we would not have found it by doing more work in those conventional areas" quote; "exhaustively testable pseudo-code"; the "How do we know that the executable code correctly implements the verified design? The answer is that we don't" quote; the "all models are wrong, some are useful" caveat; the failed-first-fix anecdote |
| `github.com/google/oss-fuzz` README | "As of May 2025, OSS-Fuzz has helped identify and fix over 13,000 vulnerabilities and 50,000 bugs across 1,000 projects" |
| `llvm.org/docs/LibFuzzer.html` | The `LLVMFuzzerTestOneInput` contract and its requirements; the flag list; value profile; `LLVMFuzzerInitialize` / `LLVMFuzzerCustomMutator`; the "when not to use libFuzzer" list |

**Verified against the local corpus:** UTF-8 material is in `numbers-text-numerics.md`; Huffman in `information-theory-coding.md`; allocator in `cpp-linux-systems.md`; B-tree in `storage-filesystems-engines.md`. Cross-references in §2.7 and §6.1 were corrected accordingly.

### A.2 NOT verified — stated from model knowledge, check before teaching as fact

Grouped by how much a reader should worry.

**Numbers I would want re-checked before putting them on a slide:**

| Claim | Section | Note |
|---|---|---|
| Google: ~**1.5%** of test runs flaky; ~**16%** of ~4.2 M tests show some flakiness | §1.5 | Attributed to the Google Testing Blog (John Micco, May 2016). Both figures are widely quoted; neither was re-checked. |
| Miller et al. 1990: **25–33%** of UNIX utilities crashed or hung | §3.1 | Confident, but the exact range and the 1995/2000 follow-up figures were not checked |
| Csmith found **over 325** bugs in C compilers | §3.10, §5.6.2 | PLDI 2011. The count grew after publication; the paper's own figure was not re-checked |
| EMI/Orion found **~147** confirmed bugs in GCC and LLVM | §3.10 | PLDI 2014. Order of magnitude is right; the exact figure was not checked |
| SAGE found **~1/3** of the bugs found by file fuzzing during Windows 7 development | §3.11 | The claim appears in Godefroid et al.'s *CACM* 2012 article. Wording and scope not re-checked. |
| KLEE beat 15 years of hand-written COREUTILS tests on line coverage; found dozens of bugs | §3.11 | OSDI 2008. Specific coverage percentages and bug counts deliberately not quoted for this reason. |
| Bessey et al.: developers abandon a tool above roughly a **30%** false-positive rate | §4.5 | *CACM* Feb 2010. The rule of thumb is real; the exact number is recalled, not checked. |
| Inozemtseva & Holmes: coverage/effectiveness correlation is **low once suite size is controlled** | §1.7 | ICSE 2014. The qualitative finding is well established; no correlation coefficients are quoted here because they were not verified. |
| Astrée: Airbus **A340/A380** flight control, **hundreds of thousands** of lines, **zero false alarms** | §4.3 | The result is real and famous; the aircraft, line counts, and the precise scope of "zero" were not re-checked. |
| seL4: **~8,700** lines of C, **~200,000** lines of Isabelle proof, **~20–25** person-years, **~20:1** proof:code | §5.6.1 | All four figures approximate and unverified. The qualitative claims (refinement chain, later binary-level and information-flow proofs, the assumption list) are confident. |
| CompCert generates code "broadly in the neighbourhood of GCC `-O1`" | §5.6.2 | Comparative performance not re-checked; treat as a rough characterization |
| AFL fork server ≈ **2×** over `execve`; persistent mode a further **10–20×** | §3.5 | Figures from AFL/AFL++ documentation as recalled. Directionally certain, numerically unverified. |
| AFL hit-count buckets are exactly `1, 2, 3, 4–7, 8–15, 16–31, 32–127, 128+`; `MAP_SIZE = 1<<16` | §3.2.2, §3.2.1 | High confidence, not re-checked |
| MC/DC needs a **minimum of n+1** tests for n conditions; DO-178C Level A requires MC/DC, Level B decision, Level C statement | §1.6 | Standard results, high confidence, not re-checked against DO-178C itself |

**Citations whose details (year, venue, author list, exact title) were not re-checked:**

Cohn, *Succeeding with Agile* (2009) · Meszaros, *xUnit Test Patterns* (2007) · Fowler, "Mocks Aren't Stubs" (2007) · Freeman & Pryce, *GOOS* (2009) · Rainsberger, "Integrated Tests Are A Scam" (2009) · Chilenski & Miller, MC/DC (*Software Engineering Journal* 1994) · DeMillo, Lipton & Sayward, "Hints on Test Data Selection" (*IEEE Computer*, April 1978) · Claessen & Hughes, QuickCheck (ICFP 2000) · Wadler, "Theorems for Free!" (1989) · Le, Afshari & Su, EMI (PLDI 2014) · Yang, Chen, Eide & Regehr, Csmith (PLDI 2011) · Brubaker et al., Frankencerts (IEEE S&P 2014) · Cadar, Dunbar & Engler, KLEE (OSDI 2008) · Godefroid, Levin & Molnar, SAGE (NDSS 2008; *CACM* 2012) · Stephens et al., Driller (NDSS 2016) · Böhme et al., "Entropic" (ESEC/FSE 2020) · Fioraldi, Maier, Eißfeldt & Heuse, AFL++ (USENIX WOOT 2020) · Aschermann et al., RedQueen (NDSS 2019) · Nautilus (NDSS 2019), Superion (ICSE 2019), Gramatron (ISSTA 2021) · Bessey et al. (*CACM* 53(2), Feb 2010) · Livshits et al., "In Defense of Soundiness" (*CACM* 2015) · Cousot & Cousot (POPL 1977) · Miné, octagons · Cousot & Halbwachs, polyhedra · Reynolds / O'Hearn / Yang, separation logic (~2001–02) · O'Hearn & Brookes, concurrent separation logic, **Gödel Prize 2016** · de Moura & Bjørner, Z3 (TACAS 2008) · Klein et al., seL4 (SOSP 2009) · Zave, "How to Make Chord Correct" (2017) · Jackson, Alloy / small scope hypothesis · Ongaro & Ousterhout, Raft TLA+ spec · Bloch's 2006 write-up of the binary-search overflow.

**Status claims that are time-sensitive and unverified as of September 2026:**

- **libFuzzer is "in maintenance mode" in LLVM**, with Google shifting toward Centipede and AFL++ (§3.4). This is a characterization of project direction, not a documented status; it is the claim in this document most likely to be wrong or out of date.
- **RapidCheck is "not heavily maintained but stable"** (§2.6).
- **OSS-Fuzz-Gen (LLM-generated fuzz targets), 2024** (§3.12) — existence confident, current scope unverified.
- **OSS-Fuzz's engine list** (libFuzzer, AFL++, Honggfuzz, Centipede) and its **90-day disclosure policy** (§3.12) — both recalled, not re-checked.
- **`-D_FORTIFY_SOURCE=3` availability** and **`-ftrivial-auto-var-init=pattern`** semantics (§4.1) — compiler-version dependent.
- **Alloy 6 added temporal operators (2021)** (§5.3).
- **Apalache** as a symbolic TLA+ model checker (§5.2).
- Whether **`-fsanitize=fuzzer` remains permitted on Compiler Explorer** — verified working on 2026-09-01, but it is a sandbox policy decision that could change (§6.2.6).

**Things deliberately not claimed**, because they could not be established: no specific mutation-score figures for any tool; no specific false-positive rates for clang-tidy, Coverity or Infer; no benchmark comparison of libFuzzer vs AFL++ throughput; no claim about which fuzzer is "better" in general.

---

## Appendix B — Reading list, ranked

**Read these four first. They are short and each one changes how you think.**

1. **Claessen & Hughes, "QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs"** (ICFP 2000). Twelve pages that invent property-based testing. Even if you never write Haskell, the framing of "specification as executable law" is the whole of §2.
2. **Newcombe et al., "How Amazon Web Services Uses Formal Methods"** (*CACM* 58(4), April 2015; the 2014 preprint is freely available and slightly longer). The best industrial report on formal methods ever written, and unusual in being candid about what did not work. §5.2 quotes it heavily and it is worth reading whole.
3. **Bessey et al., "A Few Billion Lines of Code Later"** (*CACM* 53(2), February 2010). What actually happens when you try to sell static analysis to real engineers. Almost none of it is about analysis.
4. **Miller, Fredriksen & So, "An Empirical Study of the Reliability of UNIX Utilities"** (*CACM* 33(12), December 1990). Three pages. The origin of fuzzing and still a useful corrective.

**Then, by topic.**

*Testing:*
- Meszaros, *xUnit Test Patterns* (2007) — for the test-double taxonomy in §1.3; skim rather than read.
- Fowler, "Mocks Aren't Stubs" (2007) — the classicist/mockist distinction, stated fairly.
- Inozemtseva & Holmes, "Coverage Is Not Strongly Correlated With Test Suite Effectiveness" (ICSE 2014) — §1.7's evidence base.
- DeMillo, Lipton & Sayward, "Hints on Test Data Selection" (*IEEE Computer*, 1978) — mutation testing's founding paper, still the clearest statement of the idea.

*Property-based testing:*
- The **Hypothesis** documentation, specifically the articles on how its shrinker works — the best available explanation of internal/byte-stream shrinking (§2.4.1c), written by its author.
- Hughes, "How to Specify It!" (2019) — a practical taxonomy of property shapes with worked examples; the best "what property do I write?" guide.
- The **Hedgehog** documentation on integrated shrinking, for the rose-tree model.

*Fuzzing — read in this order:*
- **`llvm.org/docs/LibFuzzer.html`** — short, and the contract in it is the thing to internalize.
- **The libFuzzer tutorial** and **Google's "Fuzzing 101"** material in the OSS-Fuzz repository — practical, current, and free.
- **The AFL++ documentation** (`AFLplusplus/docs`), especially the pages on persistent mode, CmpLog, and custom mutators.
- **Fioraldi et al., "AFL++: Combining Incremental Steps of Fuzzing Research"** (USENIX WOOT 2020) — a good survey of the last decade's fuzzing research in the guise of a tool paper.
- **Zalewski's original AFL technical whitepaper** — still the clearest short explanation of the edge-hashing bitmap and the bucketing scheme (§3.2).
- **Aschermann et al., RedQueen** (NDSS 2019) — for input-to-state correspondence, which is the most useful single idea in modern fuzzing.
- **Yang, Chen, Eide & Regehr, "Finding and Understanding Bugs in C Compilers"** (PLDI 2011) — differential testing done properly, plus the CompCert result.
- **Le, Afshari & Su, "Compiler Validation via Equivalence Modulo Inputs"** (PLDI 2014) — the most elegant metamorphic relation in the literature.

*Static analysis:*
- Cousot & Cousot (POPL 1977) is the foundational paper and is hard going; prefer a survey or a course treatment of abstract interpretation first.
- Livshits et al., "In Defense of Soundiness: A Manifesto" (*CACM* 2015) — three pages, and it names the thing every practitioner already knew.
- The **clang-tidy check list** and the **Clang Static Analyzer** developer docs — read the check *names*; it is a catalogue of the mistakes C++ programmers make.

*Formal methods:*
- **Lamport, *Specifying Systems*** — the TLA+ book, free online. Long. Read Part I and then start writing specs; do not read it end to end first.
- **Hillel Wayne, *Practical TLA+*** and his *Learn TLA+* site — the fastest path from zero to a checked spec, and the right first stop for an engineer.
- **Jackson, *Software Abstractions*** — the Alloy book. Excellent on modelling as a skill, independent of the tool.
- **Zave, "Reasoning About Identifier Spaces: How to Make Chord Correct"** — the single most persuasive case study for lightweight formal methods.
- Klein et al., "seL4: Formal Verification of an OS Kernel" (SOSP 2009) and Leroy's CompCert papers — read for *what is and is not proven* (§5.6), which is the part usually skipped.

*Adjacent, in this curriculum:*
`debugging-and-measurement.md` (sanitizers in depth, and the debugger workflow that follows a fuzzer's crash) · `hardware-security.md` (what the memory-safety bugs of §3 become in an attacker's hands) · `cpp-linux-systems.md` (UB, the memory model, allocators) · `compilers-interpreters-terminals-unix.md` (why the optimizer deletes your bug, §3.6.3) · `concurrency-theory-coroutines.md` (the bugs §5's model checking is for) · `build-systems-toolchains.md` (getting these flags into a real build) · `numbers-text-numerics.md` and `information-theory-coding.md` (the codecs that are the best property-testing targets) · `storage-filesystems-engines.md` (the B-tree, and crash-injection testing).
