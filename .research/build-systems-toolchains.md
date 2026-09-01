# Build Systems, Toolchains and Reproducibility

Research notes for a from-first-principles computing curriculum. Companion to
`compilers-interpreters-terminals-unix.md` (which covers *how source text becomes an
object file*), `cpp-linux-systems.md`, `embedded-and-sbc.md` and
`cuda-programming-tuning.md` in this directory.

Those notes cover compilation and linking **as concepts**. This one covers what happens
when you have four thousand of them and a Makefile. That is where engineers actually lose
days: not in understanding what a linker does, but in understanding why `make` produced a
binary that does not match the source on disk, why the CI machine builds something
different from the laptop, and why the build takes eleven minutes when the change was one
line.

The organising claim of this document: **a build system is a cache, and every build bug is
a cache-invalidation bug.** Under-building is a stale cache hit. Over-building is a
spurious cache miss. Every technique below — depfiles, content hashing, hermeticity,
`ccache`, remote caching, reproducible builds — is a way of making the cache key more
honest about what the output actually depends on.

---

## What was machine-verified for this document

Everything with a number in it below was measured on 2026-09-01, not recalled. Sources:

- **Local machine**: Darwin 27.0.0 / arm64 (Apple Silicon, 8 cores), Apple clang 21.0.0
  (clang-2100.3.33.1), GNU Make 3.81, CMake 4.4.3, Ninja 1.13.2, Meson 1.12.0,
  cargo 1.89.0, go 1.27.0.
- **Compiler Explorer API** (`https://godbolt.org/api/compiler/<id>/compile`, POST JSON),
  live. Compilers used: `g153` (x86-64 gcc 15.3), `clang2110` (x86-64 clang 21.1.0),
  `vcpp_v19_44_VS17_14_x64` (MSVC 19.44), `nvcc130u2` (NVCC 13.0.2). The API served 1184
  C++ compilers and 153 CUDA compilers at time of writing.
- **Documentation fetched live**: the Ninja manual, Clang's *Standard C++ Modules* page,
  `reproducible-builds.org`'s SOURCE_DATE_EPOCH spec, Bazel's remote-caching page, mold's
  README, and the ACCU republication of *Recursive Make Considered Harmful*.

Things I could **not** verify from this machine — `ccache`/`sccache` hit rates, mold vs
BFD vs gold head-to-head, distcc/icecream, Bazel remote execution, ELF symbol versioning,
IWYU, ClangBuildAnalyzer — are collected and flagged in **Part 7**. Read that before
teaching any number from those areas as settled.

---

# Part 1 — The build graph

## 1.1 Why building is a DAG problem

A build is a set of **actions**. Each action consumes some inputs and produces some
outputs. `main.c` + headers → `main.o`. `main.o` + `lib.a` → `app`. Because an action's
output can be another action's input, the actions form a directed graph, and because you
cannot build something that (transitively) requires itself, that graph must be acyclic.
Hence: **a build is a DAG**, and a build system is a program that walks it.

Everything a build system does falls out of that shape:

- **Topological order.** You cannot link before you compile. A topological sort of the DAG
  is a valid serial build order.
- **Parallelism for free.** Two nodes with no path between them are independent, so they
  can run at the same time. `-j8` is nothing more than "run up to 8 ready nodes at once",
  where *ready* means all predecessors are done. The maximum useful parallelism is the
  **width** of the DAG; the minimum wall-clock time (with infinite cores) is the **critical
  path** through it. This is why `-j64` on a project whose critical path is
  `generate → compile → archive → link` does not help the last three seconds.
- **Incrementality.** If you know which nodes changed, you only need to re-run their
  transitive successors. That set is the **rebuild set**.

There is a real theorem hiding here, and it is worth saying out loud to students: *the
build system does not know what a compiler is.* It knows nodes, edges, and a command
string per node. Everything language-specific is smuggled in through the edges. When a
build is wrong, it is almost always because an edge that exists in reality does not exist
in the graph.

## 1.2 The two failure modes: under-building and over-building

This is the single most important frame in the whole document.

| | Definition | Symptom | Severity |
|---|---|---|---|
| **Under-build** | The system did *not* rebuild something it should have | Binary does not match source. Tests pass locally and fail in CI, or vice versa. "It works after `make clean`." | **Correctness bug. Silent. Catastrophic.** |
| **Over-build** | The system rebuilt something it did not need to | Build is slower than necessary | Performance bug. Loud. Annoying. |

The asymmetry is total. An over-build costs you minutes. An under-build costs you a day of
debugging a phantom, and in the worst case ships a binary whose behaviour no source tree
explains. **A build system must never under-build; it should try not to over-build.**

The practical corollary that experienced engineers internalise and beginners do not:
`make clean` is not a fix, it is a *diagnosis*. If `make clean && make` behaves differently
from `make`, your dependency graph is missing an edge, and the correct response is to find
the edge, not to add `clean` to your muscle memory.

A useful teaching definition of correctness:

> A build system is **correct** if, for every possible edit to the source tree, the
> incremental build produces byte-identical output to a clean build.

That is a strong property. Almost nothing achieves it. But it is the right target, and it
is what Bazel-style systems are actually trying to buy.

## 1.3 How the system decides: timestamps vs content hashing

To decide whether a node is stale, you need a comparison. There are two families.

### Timestamps (Make, Ninja, most of the world)

> Rebuild `out` if any input's mtime is newer than `out`'s mtime.

Cheap: one `stat(2)` per file, no reading of contents. This is why `make` on a
50,000-file tree can decide "nothing to do" in under a second.

It is also **wrong in at least five distinct ways**, and I measured three of them.

**Failure 1 — timestamp granularity.** Apple ships GNU Make 3.81 (2006; frozen because
later versions are GPLv3). It compares mtimes at **one-second** granularity. Here is a
real, measured, silent wrong build. A correct `-MMD`-based Makefile, a real header edit, a
real rebuild attempt:

```
cfg.h  mtime = 1788215578.948124730     <- edited
a.o    mtime = 1788215578.873284437     <- built 75 ms EARLIER
$ make -f Makefile.dep
make: `prog' is up to date.             <- WRONG
```

The header genuinely *is* newer. Make truncated both to `1788215578`, saw equality, and
declined. Repeating a rapid edit-then-build cycle ten times:

```
10 rapid edits, wrong binary after rebuild: 8 times
```

**Eight out of ten builds silently produced a binary that did not match the source.** This
is not a contrived scenario — it is what happens when a fast editor, a code generator, or
`sed -i` writes a file in the same second a build finishes. On the same machine, Ninja
1.13.2 (which uses nanosecond mtimes) scored **0 misses out of 10** on the identical test.
This is the strongest single argument for Ninja over hand-rolled Make that I can give a
student, and it is reproducible in thirty seconds.

**Failure 2 — mtime can move backwards.** Timestamps assume monotonicity. Version control
does not. `git checkout` of an older branch writes files with the *current* time, which is
fine — but `git stash pop`, `rsync --times`, `tar -x` (preserves archive mtimes),
`cp -p`, and restoring from a backup all write *old* mtimes onto *new* content. Measured:

```
$ printf '#define LIMIT 777\n' > cfg.h
$ touch -t 202001010000 cfg.h        # new content, mtime in 2020
$ make -f Makefile.dep
make: `prog' is up to date.
   header says 777, binary says 2    <- silent under-build
```

Ninja fails this identically (`ninja: no work to do.`, app printed 20 where 84 was
correct). **This is not a Make bug, it is a timestamp-model bug.** Any mtime-based system
has it.

**Failure 3 — clock skew across machines.** On NFS or any shared filesystem, the file
server's clock and the build machine's clock are different clocks. Make 3.81 and later
print `Warning: File 'x' has modification time in the future` and then *guess*. On a
network filesystem with a 200 ms skew, the guess is wrong some of the time.

**Failure 4 — the command line is not a file.** Neither `make` nor a hand-written Makefile
notices when `CFLAGS` changes. Measured:

```
$ make -f Makefile.dep                 # built with default flags
$ CFLAGS=-DEXTRA=1 make -f Makefile.dep
make: `prog' is up to date.            <- WRONG: nothing was rebuilt with -DEXTRA=1
```

Ninja *does* handle this — it stores the command string in `.ninja_log` and treats a change
to it as an implicit dependency. Measured, after re-running CMake with a new
`CMAKE_C_FLAGS`:

```
[1/4] Building C object CMakeFiles/mylib.dir/src/lib.c.o
[2/4] Building C object CMakeFiles/app.dir/src/main.c.o
[3/4] Linking C static library libmylib.a
[4/4] Linking C executable app
```

Full rebuild, correctly. This is the second-strongest argument for Ninja and it is the one
almost nobody mentions.

**Failure 5 — the timestamp says *changed*, not *different*.** `touch foo.c` with no edit
causes a full rebuild of everything downstream. That is over-building — annoying, not
dangerous — but it also means "save file in editor" costs a rebuild even when you undid
your change.

### Content hashing (Bazel, Buck2, Go, ccache, Nix)

> Rebuild `out` if the hash of (all inputs' contents + the command + the environment) is
> not a key already in the cache.

This fixes every failure above. It also enables things timestamps cannot express:

- **Early cutoff.** If you edit a comment in `foo.c`, `foo.o` may come out byte-identical.
  A hash-based system notices, and *stops propagating* — nothing downstream rebuilds. A
  timestamp system happily relinks the whole program. Measured on Go, whose cache is
  content-addressed: editing `main.go` and then reverting the edit produced no measurable
  recompilation (0.263 s, versus 0.141 s for a pure no-op — i.e. it re-hashed and hit).
- **Cross-machine cache sharing.** If the key is a content hash, my `foo.o` and your
  `foo.o` have the same key, so a shared cache works. That is the entire basis of `ccache`,
  `sccache`, and Bazel remote caching. You cannot share an mtime.
- **Correct under `git checkout`.** Content is content.

The cost is that you must read every input on every build. Bazel and Buck2 pay it (and
mitigate with an in-memory file-state cache and OS filesystem watchers); Ninja deliberately
does not.

**The honest middle ground**, and what most real systems do: hash the *cheap and dangerous*
things (the command line, the flags, the compiler version, the environment) and use mtimes
for the *expensive and usually safe* thing (file contents). Cargo does exactly this. Its
fingerprint file, read off disk:

```json
{"rustc": 17575471286409424799,
 "profile": 6675295047989516842,
 "features": ..., "target": ..., "deps": ...,
 "rustflags": [],
 "local": [{"CheckDepInfo": {"dep_info": "...", "checksum": false}}]}
```

Note `"checksum": false` — file freshness is mtime-based by default. But `rustc`,
`profile`, `rustflags`, `features` and `deps` are all *hashes*. Changing `RUSTFLAGS`
produced a **separate fingerprint directory** (I counted 3 after 3 flag configurations),
so the two builds do not clobber each other's artifacts at all. This is the design Make
does not have and CMake+Ninja only half has.

## 1.4 The header-dependency problem

This is the classic. It deserves a full worked example because it is the moment where a
student's model of "the build system knows what depends on what" breaks.

The build system reads `Makefile`. `Makefile` says `main.o: main.c`. But `main.c` says
`#include "config.h"`, and only the *compiler* knows that. The build system cannot know it
without either (a) parsing C, which it must not do, or (b) asking the compiler.

Measured, with the most naive possible Makefile:

```make
prog: a.o main.o
	cc -o $@ a.o main.o
%.o: %.c
	cc -c -o $@ $<
```

```
$ make -f Makefile.naive && ./prog
10
$ sed -i '' 's/10/99/' cfg.h        # a.c does #include "cfg.h"
$ make -f Makefile.naive
make: `prog' is up to date.
$ ./prog
10                                  <- header says 99. Binary says 10.
```

Perfectly silent. The binary and the source now disagree, and nothing warned you.

### The fix: ask the compiler. `-MMD` / `-MD` and depfiles

GCC and Clang will, as a side effect of a normal compile, write a Makefile fragment listing
every file they actually opened.

- `-MM` / `-MMD`: **user headers only** (`"..."` and `-I` paths), skipping system headers.
- `-M` / `-MD`: **everything**, including `/usr/include`.
- The `D` variants mean "do this *as well as* producing the object file" (the non-`D`
  variants write the dependency list to stdout *instead of* compiling — a classic
  time-waster).
- `-MF <file>`: where to write it. `-MT <target>`: what to call the target.
- `-MP`: also emit a *phony rule* for every header (explained below).

Measured output of `cc -MMD -MP -c -o a.o a.c`:

```make
a.o: /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/SDKSettings.json \
  a.c cfg.h
/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/SDKSettings.json:
cfg.h:
```

The first stanza is the real rule. The bare `cfg.h:` lines at the bottom are `-MP`'s work.

The whole trick is one line of Makefile:

```make
%.o: %.c
	cc -MMD -MP -c -o $@ $<
-include $(wildcard *.d)
```

`-include` (leading dash) means "include if it exists, don't error if not", which handles
the first build where no `.d` files exist yet. This is the **bootstrapping paradox** of
depfiles and it is worth naming for students: *you need the dependency information to
decide whether to compile, but you only get it by compiling.* It resolves because if the
`.d` file is missing, the `.o` is missing too, so you build unconditionally, and from then
on the information exists.

For comparison, `-MD` (system headers included) on the same three-line C file produced a
**3468-byte** dependency list. `-MMD` produced 89 bytes. This is why `-MMD` is the default
advice: system headers essentially never change under you, and tracking them multiplies
your `.d` size by ~40× and your stat count with it. The tradeoff is real, though — if you
upgrade your SDK, `-MMD` will under-build. (Ninja's `deps = gcc` mode sidesteps the size
problem by parsing the depfile immediately and compacting it into a binary
`.ninja_deps` log, then deleting the text. Measured on a hello-world-scale TU:
`#deps 42, deps mtime 1788215622859743081 (VALID)` — 42 tracked headers.)

### Why `-MP` exists: the deleted-header problem

Suppose `main.c` includes `old.h`, you build, and the `.d` file now says
`main.o: main.c old.h`. Then you delete `old.h` and remove the `#include`. Now `make`
reads the stale `.d`, sees a prerequisite `old.h` that does not exist and has no rule to
build it, and dies:

```
make: *** No rule to make target `old.h', needed by `main.o'.  Stop.
```

This is a genuinely confusing error — the file you deleted on purpose is blocking the
build, and the only way out is `make clean`, which reinforces the wrong habit. `-MP` emits
`old.h:` — a rule with no prerequisites and no recipe — which makes `make` treat a missing
`old.h` as "fine, it's up to date", rebuild `main.o`, and regenerate a correct `.d`.
**`-MP` costs nothing and prevents a whole class of "just run make clean" folklore.** Always
use it.

### The depfile is a *retroactive* dependency list

Worth stating precisely, because it is the source of the remaining unsoundness: the depfile
describes what the compiler read **last time**. If a new `#include` appears, the build
system does not know about it until *after* it has recompiled — but that is fine, because
the thing that caused the new include is an edit to a file that *was* already a dependency.
The induction closes. Where it does *not* close is when a header appears earlier in the
include path than one that was previously found — the classic "I added `-I../compat` and
now a different `stdio.h` is being picked up" case. Depfiles record the resolved path, so a
*newly created file that shadows an existing one* is invisible to them. Bazel's answer is
to hash the entire declared input set including the search paths; Ninja and Make have no
answer.

## 1.5 What else breaks incremental correctness

A checklist, in rough order of how often it bites:

1. **Generated code with undeclared outputs.** A code generator that writes three files but
   whose rule declares one. The other two are invisible to the graph forever.
2. **Actions that write outside their declared outputs.** A test that writes a fixture into
   the source tree; a compiler wrapper that updates a shared cache file. This makes the
   build order-dependent and therefore `-j`-dependent.
3. **Actions that read undeclared inputs.** Reading `$HOME/.config/something`, or the
   system time, or a file from a sibling directory. The build works until it doesn't.
4. **Flag changes not in the key.** Covered above. `make` does not track them.
5. **Compiler upgrades not in the key.** Your `.o` files were built by GCC 13; you install
   GCC 14; nothing rebuilds; you get ODR violations at link time or, worse, at runtime.
   Bazel and Cargo hash the compiler; Make does not.
6. **`.PHONY` used to force rebuilds.** A workaround for (1)-(3) that guarantees
   over-building and destroys parallelism.
7. **Interrupted builds.** `Ctrl-C` in the middle of a compile leaves a truncated `.o` with
   a *fresh* mtime. Timestamp systems consider it done. Ninja mitigates by only recording
   the log entry after the command exits 0, and by removing the output on failure; naive
   Makefiles do not (`.DELETE_ON_ERROR:` fixes this and almost nobody uses it — put it in
   every Makefile you write).
8. **Recursive make.** Its own section, below.

Rule 7 deserves emphasis because it explains a specific superstition. If your Makefile
lacks `.DELETE_ON_ERROR:`, then any interrupted or failed build leaves poison in the tree,
and "make clean fixes it" becomes *true*, which teaches the wrong lesson permanently.

## 1.6 A worked rebuild-set example

The core exercise for this whole part. Given:

```
util.h  ──> util.o ──┐
                     ├──> libcore.a ──┐
core.h  ──> core.o ──┘                ├──> app
util.h  ──> main.o ───────────────────┘
config.h ─> core.o
```

- Edit `util.h` → rebuild `{util.o, main.o, libcore.a, app}`. Note `main.o` is in the set
  even though `main.c` did not change, and note `core.o` is *not*, even though it is in the
  same library.
- Edit `config.h` → `{core.o, libcore.a, app}`.
- Edit `main.c` → `{main.o, app}`. `libcore.a` is untouched.
- Touch `util.h` with no edit → same set as editing it, under a timestamp system; **empty
  set** under a content-hashing system with early cutoff.
- Change `CFLAGS` → *everything*, under Ninja/Bazel/Cargo; **nothing**, under plain Make.

`ninja -n` prints exactly this set as a dry run, which makes it directly checkable:

```
$ touch ../inc/lib.h && ninja -n
[1/4] Building C object CMakeFiles/mylib.dir/src/lib.c.o
[2/4] Building C object CMakeFiles/app.dir/src/main.c.o
[3/4] Linking C static library libmylib.a
[4/4] Linking C executable app
```

and `ninja -t query <target>` prints one node's in-edges and out-edges:

```
$ ninja -t query app
app:
  input: C_EXECUTABLE_LINKER__app_
    CMakeFiles/app.dir/src/main.c.o
    | libmylib.a
    || libmylib.a
  outputs:
    all
```

(`|` marks implicit dependencies — inputs that affect the output but do not appear on the
command line. `||` marks **order-only** dependencies — things that must exist before this
runs but whose modification does not trigger a rebuild. Order-only is how build systems
express "the directory must exist" and "the generated headers must be generated" without
relinking the world every time a generated header's mtime moves.)

---

# Part 2 — The tools, honestly assessed

## 2.1 Make

### The model

Make is three ideas, and they are genuinely good ideas:

1. **A rule is `target: prerequisites` + a recipe.** Declarative graph, imperative
   actions.
2. **Staleness is mtime comparison.** Cheap and, in 1976, sufficient.
3. **The recipe is shell.** Maximum leverage, zero abstraction cost.

That is the whole language, plus a macro system. Everything else in a Makefile — variable
expansion (`$(VAR)`, `$${SHELL_VAR}`), automatic variables (`$@` target, `$<` first
prerequisite, `$^` all prerequisites, `$*` stem), functions (`$(wildcard)`, `$(patsubst)`,
`$(shell)`, `$(foreach)`) — is machinery for generating rules, because writing them by hand
does not scale.

### Pattern rules

```make
%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<
```

`%` is the **stem**. `foo.o` matches with stem `foo`, so the prerequisite is `foo.c`. This
is the mechanism that turns "one rule per file" into "one rule per file *type*", and it is
what makes Make usable at all.

Two things about pattern rules that trip people up and are worth teaching:

- **Make has built-in rules you did not ask for.** `make foo` in an empty directory
  containing only `foo.c` works, because there is an implicit `%: %.c` chain. This is
  charming in a tutorial and a menace in a real project, where an implicit rule can fire on
  a file you did not intend and produce a mystery. `make -r` (`--no-builtin-rules`) disables
  them; serious Makefiles set `MAKEFLAGS += -r` or use `.SUFFIXES:` with no arguments.
- **Static pattern rules** (`$(OBJS): %.o: %.c`) restrict a pattern to a specific target
  list, which is what you almost always want and almost nobody uses.

### Recursive Make Considered Harmful

Peter Miller's paper (originally AUUG, 1997/98; republished in *Overload* 14(71):20-30,
February 2006) is the single most-cited build-systems document, and it is usually cited by
people who have not read the argument. The argument is not "recursion is inelegant". It is
a **correctness** argument, and it is exactly the under-build framing from §1.2.

The claim: `make` works by constructing a DAG. Recursive make — a top-level Makefile that
runs `$(MAKE) -C subdir` for each subdirectory — **fragments the DAG into disjoint
pieces**. Each submake sees only its own fragment. Therefore each submake's decisions are
made on incomplete information, and Miller's word for the resulting graph is *incomplete*.

The specific failure modes he enumerates:

1. **Build-too-little (the real bug).** A file in module A depends on a generated header in
   module B. When B's generator input changes, B's submake regenerates the header — but A's
   submake, which already ran, or which does not know about B at all, does not rebuild.
   The build *succeeds* and the binary is wrong. Miller's running example is a `parse.y`
   change failing to propagate to object files in other modules.
2. **Wrong build order, hand-maintained.** Because no complete DAG exists, someone must
   write down the traversal order by hand in `SUBDIRS = lib1 lib2 app`. Miller: the project
   "has dictated an order of traversal. An order which ... is plain wrong." Every new
   cross-module dependency requires a human to notice and re-sort the list. It is a
   topological sort maintained by memory.
3. **Multiple passes as a workaround.** Projects respond by running make twice (or in a
   loop until nothing changes), which at best doubles build time and at worst does not
   converge. There is no bound on how many passes suffice, because there is no DAG to
   bound it with.
4. **Build-too-much as the other workaround.** To avoid (1), people mark whole modules
   `.PHONY` so their submakes always run everything. Now the build is correct-ish and
   slow, and incrementality is gone.
5. **Parallelism is unsound.** `make -j` breaks all of the above workarounds
   simultaneously: submakes now run concurrently, so the hand-maintained order no longer
   holds, and the failures become nondeterministic. This is the classic "the build works
   on `-j1` and fails on `-j8`" that every large C project has hit.

Miller's proposed fix is precise and often misquoted: **one `make` *session*, not
necessarily one `Makefile`**. Each directory contains a `module.mk` fragment listing its
own sources with paths relative to the project root; the top-level Makefile `include`s
them all. You keep the modularity (each team owns its fragment) and you get one complete
DAG. This is now called **non-recursive make**, and it is what the Linux kernel's kbuild,
Android's old build system, and most surviving large Make projects converged on.

The counter-argument, which is real: a single-session non-recursive Make on a large tree
parses a *lot* of Makefile text on every invocation, and Make's parser is slow. Projects
that went non-recursive often report a multi-second "do nothing" time. That is a real cost,
and it is one of the reasons the industry ultimately moved to generators (§2.2) that emit a
flat graph in a format designed to be *read* fast rather than *written* comfortably.

### Why Make's dependency model is inadequate for large C++

Beyond recursion, five structural problems:

1. **No flag tracking.** Measured in §1.3: changing `CFLAGS` rebuilds nothing. On a project
   with debug/release/sanitizer/coverage variants sharing an object directory, this is a
   guaranteed source of corrupt builds. The idiomatic workaround — one object directory per
   configuration — is what CMake and Cargo do automatically and what Make makes you invent.
2. **No compiler tracking.** Upgrade the compiler, nothing rebuilds, and C++ ABI changes
   silently. See §5.2.
3. **Second-granularity timestamps in the still-widely-shipped 3.81.** Measured: 8/10
   silent under-builds.
4. **Depfiles are opt-in and easy to get subtly wrong.** `-M` instead of `-MD` (no object
   file), forgetting `-MP` (deleted-header lockup), forgetting `-MT` when the object goes
   into a subdirectory (the depfile says `foo.o` but the target is `obj/foo.o`, so the rule
   never matches and the dependency is silently ignored — a *very* common bug that produces
   under-builds with no error at all).
5. **The recipe is shell, so nothing is inspectable.** Make cannot tell you what a rule
   will read or write, so it cannot sandbox, cache remotely, or verify hermeticity. Every
   modern capability in Part 2's later entries requires the build system to *understand*
   actions, and Make deliberately does not.

**The honest verdict.** Make is a superb tool for a graph you can hold in your head:
100 files, one configuration, one platform. Its transparency is a genuine feature — you can
read a Makefile and know exactly what will run, which is more than can be said for the
alternatives. Above roughly that size, and especially with multiple configurations or
platforms, its failure modes are silent, correctness-affecting, and structurally
unfixable. Teach it as the *model* (targets, prerequisites, DAG), not as the recommendation.

## 2.2 CMake

### The one thing to understand first: CMake is a generator

CMake does not build anything. It *reads* `CMakeLists.txt` and *writes* the input files for
some other build system — Makefiles, `build.ninja`, an Xcode project, a Visual Studio
solution. `cmake -S . -B build -G Ninja` is a compiler whose source language is
CMakeLists and whose target language is Ninja.

Practical consequences that explain most CMake confusion:

- There are **two distinct phases with two distinct languages**: *configure/generate* time
  (the CMake language, running on your machine, `message()` prints here) and *build* time
  (the generated Makefile/ninja, running your compiler). A variable set in a
  `CMakeLists.txt` `if()` is a configure-time value baked into the generated file. A
  **generator expression** — `$<CONFIG:Debug>`, `$<TARGET_FILE:app>`,
  `$<BUILD_INTERFACE:...>` — is the escape hatch for things that are only known at build
  time, which is why they exist and why their syntax is so ugly: they are a second language
  embedded in strings.
- The build directory is a *derived artifact*. `CMakeCache.txt` is genuinely a cache, and
  it is stale-able. "Delete the build directory" is the CMake equivalent of `make clean`
  and, unlike `make clean`, it is often the correct answer, because the cache legitimately
  holds decisions (which compiler, which options) that CMake cannot re-derive.
- CMake re-runs itself automatically when a `CMakeLists.txt` changes — the generated
  `build.ninja` has a rule for it. This is why editing a CMakeLists and running `ninja`
  works; it is also why a broken CMakeLists breaks `ninja` with a CMake error, which
  confuses people who think they are running a build.

### Modern target-based CMake vs the old directory-variable style

This is the single largest source of bad CMake in the world, and the distinction is worth
a full unit of curriculum.

**The old style (CMake < 3.0 idiom, still everywhere):**

```cmake
include_directories(${CMAKE_SOURCE_DIR}/inc)     # affects EVERY target in this dir
add_definitions(-DFOO=1)                          #   and every subdirectory
link_directories(/opt/thing/lib)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall")   # affects everything, globally
add_library(mylib src/lib.c)
target_link_libraries(mylib thing)                # plain signature, no scope
```

Every one of these is **directory-scoped and inherited downward**. There is one global pile
of include paths and one global pile of flags. Consequences: adding a dependency to one
target silently adds its include paths to every other target in the directory; a
subdirectory can be broken by an unrelated edit two levels up; and when two libraries want
incompatible flags, there is nowhere to put them.

**The modern style (CMake ≥ 3.0, "Effective Modern CMake"):**

```cmake
add_library(mylib STATIC src/lib.c)
target_include_directories(mylib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/inc)
target_compile_definitions(mylib PUBLIC LIB_FLAG=1)
target_compile_features(mylib PUBLIC cxx_std_17)
target_link_libraries(mylib PRIVATE ZLIB::ZLIB)

add_executable(app src/main.c)
target_link_libraries(app PRIVATE mylib)
```

Everything hangs off a **target**. Targets carry two sets of properties:

- **build requirements** — what *this* target needs to compile
  (`INCLUDE_DIRECTORIES`, `COMPILE_DEFINITIONS`, …)
- **usage requirements** — what *anything that links this target* needs
  (`INTERFACE_INCLUDE_DIRECTORIES`, `INTERFACE_COMPILE_DEFINITIONS`, …)

and the three keywords choose which set you are writing to:

| Keyword | Build requirement (this target) | Usage requirement (consumers) |
|---|---|---|
| `PRIVATE` | yes | no |
| `INTERFACE` | no | yes |
| `PUBLIC` | yes | yes |

**Measured, not asserted.** Two identical projects differing only in that keyword; the
resulting `compile_commands.json`:

```
=== target_include_directories(mylib PUBLIC ...) ===
   lib.c     ['-DLIB_FLAG=1', '-I.../public/inc']
   main.c    ['-DLIB_FLAG=1', '-I.../public/inc']     <- app got them

=== target_include_directories(mylib PRIVATE ...) ===
   lib.c     ['-DLIB_FLAG=1', '-I.../private/inc']
   main.c    []                                        <- app got nothing
```

and the PRIVATE build then fails exactly where you would expect:

```
.../src/main.c:1:10: fatal error: 'lib.h' file not found
```

**The rule of thumb that makes this decidable:** look at your library's public header. If a
type or macro from a dependency appears *in that header*, the dependency is `PUBLIC` —
your consumers cannot compile without it. If it appears only in your `.cpp` files, it is
`PRIVATE`. If your target has no sources at all (a header-only library, declared
`add_library(foo INTERFACE)`), everything is `INTERFACE`.

This is not cosmetic. `PRIVATE` on a genuinely public dependency produces "works for me,
fails for anyone who uses my library". `PUBLIC` on a genuinely private one leaks your
implementation dependencies into everyone's compile line, which is how a project ends up
with a 40 KB command line and an ABI that nobody can change.

`target_link_libraries` also has the **plain signature** (`target_link_libraries(app foo)`,
no keyword) which is a compatibility shim, and CMake will refuse to let you mix them.
Measured error message:

```
CMake Error at CMakeLists.txt:6 (target_link_libraries):
  The plain signature for target_link_libraries has already been used with
  the target "app".  All uses of target_link_libraries with a target must be
  either all-keyword or all-plain.
```

Also note that `target_link_libraries` does far more than pass `-lfoo`: linking a CMake
target propagates *all* of that target's usage requirements — include dirs, definitions,
compile features, compile options, and its own transitive link libraries. This is why
modern CMake advice is "link the target, not the library file", and why `find_package`
results are expected to be **imported targets** (`ZLIB::ZLIB`, `Threads::Threads`) rather
than path variables (`${ZLIB_LIBRARIES}`). The `Foo::Bar` double-colon convention is not
decoration: CMake treats any name containing `::` as *definitely a target*, so a typo
produces an error at generate time instead of a mysterious `-lFoo::Bar` at link time. Use
it always.

### Toolchain files

A toolchain file is a CMake script passed as `-DCMAKE_TOOLCHAIN_FILE=arm.cmake` that runs
**before** anything else and answers "what machine am I building for". Measured:

```cmake
set(CMAKE_SYSTEM_NAME Generic)          # setting this at all sets CMAKE_CROSSCOMPILING
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER clang)
set(CMAKE_C_COMPILER_TARGET arm-none-eabi)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
set(CMAKE_FIND_ROOT_PATH /path/to/sysroot)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)   # find host tools on the host
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)    # find target libs only in the sysroot
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
```

```
=== native ===              -- SYSTEM=Darwin  PROC=arm64  XC=FALSE
=== with toolchain file === -- SYSTEM=Generic PROC=arm    XC=TRUE
    emitted command: /usr/bin/clang --target=arm-none-eabi -o ... -c ...
```

The `CMAKE_FIND_ROOT_PATH_MODE_*` triple is the part everyone gets wrong and it is the
whole reason toolchain files are more than a compiler path: without it, `find_library` will
happily hand your ARM link line an x86 host library, and you get a link error four hours
into a CI run.

`CMAKE_TRY_COMPILE_TARGET_TYPE` is the embedded gotcha. CMake's very first act is to
compile *and link* a test program to identify the compiler. On a bare-metal target there is
no libc and no `_start`, so that link fails and configuration dies before it begins. Setting
it to `STATIC_LIBRARY` tells CMake to stop at the object file. Measured failure when I
removed that line — note that the error is not "no libc", it is a *linker flag* mismatch,
because CMake's `Generic-arm` assumptions reached for a GNU linker and found Apple's:

```
-- Detecting C compiler ABI info - failed
CMake Error at .../CMakeTestCCompiler.cmake:65 (message):
    FAILED: [code=1] cmTC_f7bfd
    ld: unknown options: -Bstatic -EL --start-group --end-group --target2=rel
```

That error message names none of the three things actually wrong with the setup. It is a
fair representative of the CMake diagnostic experience.

### `find_package` vs `FetchContent`

**`find_package(Foo REQUIRED)`** asks: *is Foo already installed on this machine?* Two
modes:

- **Config mode** (preferred): looks for `FooConfig.cmake` / `foo-config.cmake` — a file
  *shipped by Foo itself* that defines imported targets with correct usage requirements.
  This is the good path; the package author has told you the truth about their
  dependencies.
- **Module mode** (fallback): looks for `FindFoo.cmake` — a file *shipped by CMake or by
  you* that goes hunting for headers and libraries with `find_path`/`find_library` and
  guesses. This is the legacy path, and CMake ships ~150 of these `Find` modules of wildly
  varying quality.

Measured failure message on CMake 4.4.3 (note that it now also searches for `.cps`, the
new Common Package Specification format):

```
CMake Error at CMakeLists.txt:3 (find_package):
  By not providing "FindFooBar.cmake" in CMAKE_MODULE_PATH this project has
  asked CMake to find a package configuration file provided by "FooBar", but
  CMake did not find one.
  Could not find a package configuration file provided by "FooBar" with any
  of the following names:
    FooBar.cps  foobar.cps  FooBarConfig.cmake  foobar-config.cmake
  Add the installation prefix of "FooBar" to CMAKE_PREFIX_PATH or set
  "FooBar_DIR" to a directory containing one of the above files.
```

This message is verbose *and* actually correct, and it is the one CMake error worth reading
in full: it tells you exactly which four filenames it wanted and the two variables that fix
it.

**`FetchContent`** asks a different question: *can I download and build Foo as part of my
own build?*

```cmake
include(FetchContent)
FetchContent_Declare(fmt
  GIT_REPOSITORY https://github.com/fmtlib/fmt.git
  GIT_TAG        11.0.2)            # pin a TAG or SHA, never a branch
FetchContent_MakeAvailable(fmt)
target_link_libraries(app PRIVATE fmt::fmt)
```

The tradeoffs, plainly:

| | `find_package` | `FetchContent` |
|---|---|---|
| Where the dep comes from | the system / a package manager | downloaded at configure time |
| Build time | already built | you build it, every fresh build dir |
| Version control | whatever is installed | exactly what you pinned |
| Works offline | yes | no (first configure) |
| Works in a distro package | yes — required, actually | no; distros forbid network fetches |
| Flag consistency with your code | not guaranteed | guaranteed (same build, same flags) |
| Diamond dependencies | package manager resolves | **you** resolve, by hand |

The last row is the real problem. If your project fetches `fmt` 11.0.2 and also fetches
`spdlog`, which itself fetches `fmt` 10.x, you get two `fmt` targets with the same names
and a generate-time error, or worse, one silently winning. `FetchContent` has no solver.
There is `FIND_PACKAGE_ARGS` on `FetchContent_Declare` (CMake ≥ 3.24) which makes it try
`find_package` first and fall back to downloading — the best available compromise, and
underused.

The honest advice: **`FetchContent` for applications, `find_package` for libraries.** An
application controls its whole world and benefits from pinning. A library that
`FetchContent`s its dependencies makes itself impossible to package and impossible to
integrate.

### Why CMake has the reputation it has

Setting aside taste, the substantive complaints:

1. **The language.** Everything is a string. There are no types; a list is a string with
   `;` in it, which means a path containing `;` is a bug. Quoting rules are surprising
   (`if(FOO)` treats the *value* `FOO` as a variable name; `if("${X}" STREQUAL "")` is
   different from `if(X STREQUAL "")`). Functions have dynamic scope and no return values —
   you return by `set(... PARENT_SCOPE)`. It reads like a shell that never learned about
   `$IFS`.
2. **Two mutually contradictory idioms, both documented, both in every StackOverflow
   answer.** The 2008 style and the 2015 style produce different, incompatible advice for
   the same question, and there is no in-band signal telling a newcomer which era an answer
   is from. This is, I think, the actual root cause of CMake's reputation: not that it is
   hard, but that the *available teaching material is 50% wrong* and looks identical to the
   50% that is right.
3. **Error messages that name the wrong thing.** See the `try_compile` example above.
4. **Generator expressions** are a second, denser language for build-time values, and the
   need for them is not obvious until you hit it.
5. **Everything is global by default unless you opt into targets.** The design's default is
   the wrong one, for backward-compatibility reasons that are now 15 years old.

And the case for it, which is strong and usually left unsaid: CMake is the only tool that
actually solves the problem it set out to solve. It builds C and C++ on Linux, macOS,
Windows/MSVC, Android, iOS, and a dozen embedded targets, with IDE integration, from one
description; it has genuine cross-compilation support; `compile_commands.json` (which it
generates for free with `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`) is now the de-facto interface
for every C++ tool in existence — clangd, clang-tidy, IWYU, sanitizer tooling, IDEs — and
CMake is the reason that file format exists in practice. There is no competitor with
comparable coverage. It is the worst build system except for all the others.

## 2.3 Ninja

Ninja's own manual states the design position better than a summary can:

> "Where other build systems are high-level languages, Ninja aims to be an assembler."

> "Build systems get slow when they need to make decisions... Ninja contains the barest
> functionality necessary to describe arbitrary dependency graphs."

### What it deliberately does not do

Straight from the manual's non-goals:

- **No convenient syntax for hand-writing.** "You should generate your ninja files using
  another program."
- **No built-in rules.** "Out of the box, Ninja has no rules for e.g. compiling C code."
- **No build-time customization.** "Options belong in the program that generates the ninja
  files."
- **No conditionals, no loops, no string functions, no globbing, no search paths.**
  "Making decisions is slow."

There is no `$(wildcard *.c)` in Ninja. There is no `if`. If you want to build a different
set of files in Debug, you re-run the generator. Ninja's job is to take a fully-elaborated
graph and execute it as fast as physically possible.

### Why it is fast

1. **The file is pre-resolved.** Every path is literal, every command is a complete string.
   Ninja does no expansion beyond simple `$var` substitution in rules. Compare: a
   non-recursive Make on a large tree spends seconds re-evaluating `$(patsubst)` and
   `$(wildcard)` calls on every invocation.
2. **Parsing is designed for machines.** The syntax is minimal and the parser is a
   hand-written lexer over a memory-mapped file.
3. **Dependencies live in a binary log, not text.** `deps = gcc` makes Ninja read the
   compiler's `.d` file immediately after the compile, fold it into a compact binary
   `.ninja_deps` database keyed by output, and delete the text. On the next build it does
   not parse thousands of Makefile fragments — it `mmap`s one file. `deps = msvc` does the
   same by scraping `/showIncludes` output.
4. **It stats aggressively and in parallel**, and keeps the whole graph in memory in a
   compact form.
5. **`.ninja_log` records the command string per output**, so a command-line change is a
   rebuild trigger with no extra machinery. (Measured in §1.3 — this is a correctness win
   that also happens to be free.)

`restat = 1` is Ninja's one clever trick and worth teaching because it is *content hashing
in disguise*: after running a command, Ninja re-stats the output; if the mtime did not
change (because the command wrote identical content and the tool was careful enough to not
touch the file), Ninja **prunes the downstream rebuild**. This is early cutoff, implemented
with the only mechanism a timestamp system has. It is how CMake avoids relinking the world
every time it regenerates an unchanged header.

### Verdict

Ninja is not a build system you use; it is a build system you *emit*. That is not a
criticism — it is the correct factoring, and it is why CMake, Meson, GN, gyp, and Kati
(Android's Makefile-to-Ninja converter) all target it. The lesson for students is
architectural: **separating "decide what to build" from "build it" lets each half be good
at one thing.** Make tried to be both and is mediocre at both.

The practical thing every engineer should know: `ninja -n` (dry run), `ninja -t query X`,
`ninja -t deps X`, `ninja -t graph X | dot -Tpng`, `ninja -t browse`, and
`ninja -d explain` (which prints *why* it decided to rebuild each node — the single best
debugging tool in this entire document, and almost nobody knows it exists).

## 2.4 Bazel and Buck2 — the hermetic school

Bazel (Google, open-sourced from Blaze) and Buck2 (Meta, Rust rewrite of Buck) start from
a different axiom: **the build system should know everything about every action, and
nothing should be allowed to happen that it does not know about.**

### The four ideas, in dependency order

**1. Hermeticity.** An action declares *all* its inputs, *all* its outputs, its exact
command line, and its exact environment. Nothing else may influence it. Bazel's docs are
explicit about what this rules out: a different `$PATH` on a different machine, a compiler
at `/usr/bin/gcc` that Bazel does not track, environment variables not whitelisted with
`--action_env`, and input files modified during the build. In a fully hermetic setup the
*compiler itself* is a declared input, downloaded and content-addressed like any other
dependency.

**2. Sandboxing.** Hermeticity is a claim; sandboxing is the enforcement. Bazel runs each
action in a filesystem view containing *only* its declared inputs — implemented with
symlink forests, `mount --bind`/user namespaces on Linux, or `sandbox-exec` on macOS. If
an action reads a file it did not declare, it gets ENOENT and the build fails
**immediately and locally**, instead of succeeding on your machine and failing on CI three
weeks later. This is the mechanism that converts "your build is probably fine" into "your
build is provably closed", and it is the thing Make can never have, because Make does not
know what an action reads.

**3. Remote caching.** Once actions are hermetic, the tuple
`(inputs' content hashes, command line, environment, output names)` is a **complete
description** of the action, so its hash is a valid cache key. Bazel splits the cache in
two:

- the **action cache**: `action hash → action result metadata` (which outputs, and their
  digests);
- the **CAS** (content-addressable store): `content hash → bytes`.

The split matters. If two actions produce identical output — very common, since most
commits touch few files — the CAS stores one copy and both action-cache entries point at
it. And because the key is content, *my* build populates *your* cache. In a 500-engineer
monorepo, a typical developer's build is >95% cache hits, which is the entire economic
argument for the system.

**4. Remote execution.** The same description that lets you *look up* an action lets you
*ship it elsewhere*. Bazel uploads the inputs to the CAS, sends the action description to a
remote worker farm, and downloads the outputs. Thousands-of-core builds from a laptop.
There is a standardised gRPC protocol (the Remote Execution API) implemented by
BuildBarn, BuildBuddy, EngFlow, and Google's own RBE. Buck2 does the same and shares the
protocol.

### The tradeoff, stated fairly

**The wins are enormous at scale**, and they are wins that no amount of Make cleverness can
reach: correct-by-construction incremental builds, cross-machine cache sharing, remote
execution, reliable `-j1000`, and — the underrated one — *the build is now a queryable
database*. `bazel query 'rdeps(//..., //lib:foo)'` tells you every target affected by a
change, which is how you build "only test what this PR could have broken" in CI. That
query is impossible in Make because the DAG does not exist as data.

**The costs at small scale are brutal**, and pretending otherwise is why Bazel evangelism
fails:

- **Everything must be declared.** Every source file, every dependency, every generated
  file, in `BUILD` files that you write and maintain. `glob(["*.cc"])` exists but is
  discouraged because it defeats the point.
- **The ecosystem is not there.** Every third-party C++ library ships a CMakeLists, not a
  BUILD file. You write the BUILD file, or you use `rules_foreign_cc` to shell out to
  CMake, which is exactly as hermetic as it sounds.
- **Learning curve.** Starlark, the `//package:target` label syntax, workspace vs bzlmod
  dependency management (which itself changed twice), toolchain resolution, platforms,
  transitions. Weeks, not days.
- **Sandboxing costs real time on small builds.** Constructing a symlink forest per action
  is a lot of syscalls when the action itself takes 40 ms.
- **The daemon.** Bazel keeps a long-lived JVM server holding the analysis cache. It is
  fast when warm and eats gigabytes; a cold `bazel build` on a small project can be slower
  than `cmake && ninja` end to end.

**Where the line actually is**, in my judgement: Bazel/Buck pays off when you have (a) a
monorepo, (b) more than ~50 engineers or ~1M lines, (c) multiple languages in one
dependency graph, and (d) an existing CI investment to attach remote caching to. Below
that, CMake + Ninja + `ccache` gets you most of the caching benefit for none of the
migration cost. Adopting Bazel for a 50-file project is the build-system equivalent of
Kubernetes for a static site.

## 2.5 Meson, briefly

Meson is CMake's most credible challenger and its design choices are instructive precisely
because they are a *reaction*:

- **The language is deliberately not Turing-complete.** No recursion, no user-defined
  functions in the general case, real types (strings, lists, dicts, booleans — not
  everything-is-a-string). You cannot write clever Meson, which is the point.
- **Ninja-first.** Meson is also a generator, and it targets Ninja as the primary backend
  (VS and Xcode secondary). It inherits Ninja's speed and correctness properties.
- **Batteries included and opinionated**: built-in unit-test runner (`meson test`),
  built-in sanitizer/coverage options (`-Db_sanitize=address`, `-Db_coverage=true`,
  `-Db_lto=true`), built-in precompiled-header support, built-in `subprojects/` with a
  central WrapDB of ready-made build definitions for common C libraries.
- **Genuinely readable.** A Meson file for a shared library plus tests is about a third the
  length of the CMake equivalent and reads like Python.

Where it loses: ecosystem gravity. Almost nothing in the wild ships a `meson.build`, IDE
and vendor toolchain support is thinner, and if you need to integrate with a customer's
CMake tree you are back to CMake. GNOME, systemd, Mesa, GStreamer and QEMU use it and are
happy. For a new self-contained C/C++ project on Linux, Meson is a better tool than CMake;
for a library other people will consume, CMake's ubiquity usually wins. That is an
ecosystem argument, not a technical one, and it is worth being honest with students about
how often ecosystem arguments decide engineering questions.

## 2.6 What the newer ecosystems do differently

The interesting comparison is not "Cargo is nicer than CMake". It is *what structural
decisions made the build problem tractable*, because most of them are language-design
decisions, not build-system decisions.

### Cargo (Rust)

- **The build system and the package manager are the same program.** There is exactly one
  way to declare a dependency (`Cargo.toml`), one resolver, one lockfile
  (`Cargo.lock`), one registry. No `find_package` vs `FetchContent` vs vcpkg vs "just
  vendor it".
- **The compilation unit is the crate, not the file.** `rustc` compiles a whole crate at
  once. There is no `#include`, so there is no `O(headers × sources)` re-parsing, no
  depfile problem for internal code, and no ODR. The cost: a one-line change recompiles
  the whole crate, which is why large Rust projects split into many small crates —
  precisely to recover the parallelism C++ gets for free from separate TUs. Every design
  has a bill.
- **The fingerprint hashes the environment.** Measured above: `rustc` version, profile,
  `rustflags`, features, and resolved deps all contribute to the cache key, and each
  distinct configuration gets its own artifact directory. Changing `RUSTFLAGS` cannot
  corrupt your existing build; it just builds into a different bucket.
- **Feature flags are first-class and unioned across the graph.** This is Cargo's genuine
  innovation *and* its genuine wart: features are additive, so if any crate in your graph
  enables `foo/std`, everyone gets it. It solves the C++ preprocessor-flag-mismatch
  problem (§5.2) by making flags a property of the dependency graph rather than of the
  command line — at the cost of the "feature unification" surprises.

### Go

- **The build cache is content-addressed**, in `$GOCACHE`. No `Makefile`, no build file at
  all: the import graph *is* the dependency graph, derived from the source. This is only
  possible because the language forbids cyclic imports and requires that imports be
  statically determinable.
- **No configuration.** `go build ./...` works. There is no debug/release, no flags to get
  wrong, no per-target include paths. Enormous simplification bought by refusing to offer
  choices.
- **Deliberately fast compilation as a language-design constraint.** No textual inclusion,
  a package's export data is a compact binary summary, unused imports are a compile
  *error* (which keeps the graph minimal by force), and generics were held back for a
  decade partly on compile-time grounds.
- Measured: warm no-op `go build` 0.141 s; after `touch`, 0.153 s; after an edit-and-revert
  (content restored), 0.263 s and no re-link. Early cutoff, working.

### What C++ could actually learn

Not "be Rust". Three transferable lessons:

1. **Put the configuration in the cache key.** This is a pure build-system fix that C++
   tooling can adopt today and mostly has not. Cargo hashes `rustflags`; Make does not hash
   `CFLAGS`. There is no technical obstacle, only inertia.
2. **Make the dependency declaration a single source of truth.** The reason `find_package`
   vs `FetchContent` vs vcpkg vs Conan vs vendoring is a *choice* is that C++ never
   standardised where a dependency comes from. Cargo's real advantage is not its resolver;
   it is that there is only one.
3. **Interface compilation, not textual inclusion.** This is what modules are for (§3.9),
   and it is the one lesson C++ is actually trying to learn — with fifteen years of lead
   time and, as measured in §3.9, incomplete results.

The lesson C++ *cannot* learn is the one that matters most: Rust and Go could design the
build model and the language together. C++ has forty years of headers on disk.

