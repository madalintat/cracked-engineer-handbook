# Compilers, Interpreters, Terminals and the UNIX Tradition

Research notes for a from-first-principles computing curriculum. Companion to the
`x86-64-assembly.md`, `cpp-linux-systems.md` and `os-and-platforms.md` notes in this
directory. Where those cover *what the machine does*, this covers *how source text
becomes a process, and how you talk to that process*.

## What was machine-verified for this document

Every assembly listing, LLVM IR listing, Python bytecode listing and program output below
was produced by actually running it, not recalled:

- **Compiler Explorer API** (`https://godbolt.org/api/compiler/<id>/compile`, POST JSON),
  executed live on 2026-09-01. Compilers used: `cg152` (x86-64 gcc 15.2, C),
  `cclang2110` (x86-64 clang 21.1.0, C), `python310` / `python311` / `python313` /
  `python314` (CPython, which on CE emit `dis` output in the "asm" pane).
  The API served 1184 C++ compilers and 14 Python-family compilers at time of writing.
- **Local machine**: Darwin 27.0.0 / arm64, CPython 3.14.7, Apple clang 21.0.0.
  Used for `dis` output and a pipe-capacity probe (measured 65536 bytes).
- **GCC 15.2 manual**, fetched from `gcc.gnu.org/onlinedocs/gcc-15.2.0/gcc/Optimize-Options.html`,
  for the exact per-`-O`-level flag lists.

Things I could **not** verify from here are collected in §7. Read that section before
teaching anything from §3 as settled — the terminal material is the part where confident
folklore is thickest and this environment had no controlling terminal to test against.

---

# Part 1 — The compiler, end to end

## 1.1 The shape of the thing

A compiler is a pipeline of *representations*, not a pipeline of *actions*. Each stage
exists because it makes some class of question cheap to answer:

```
source text
  → lexer        → token stream          (words, not characters)
  → parser       → parse tree / AST      (structure, not sequence)
  → sema         → annotated AST         (meaning: types, symbols, scopes)
  → IR gen       → IR (SSA)              (operations on values, machine-independent)
  → optimizer    → better IR             (same meaning, fewer operations)
  → isel         → machine IR            (target instructions, virtual registers)
  → RA + sched   → machine IR            (physical registers, ordered)
  → emit         → assembly / object     (bytes)
  → linker       → executable / .so
```

The classic division is **frontend** (source-language-specific: lex, parse, sema),
**middle-end** (language- and target-independent: IR optimization) and **backend**
(target-specific: isel, RA, emit). The entire commercial value of LLVM is that this
division is a real API boundary rather than a diagram in a textbook, so N frontends × M
backends costs N + M pieces of work instead of N × M.

## 1.2 Lexing

The lexer turns a character stream into a token stream: `int`, identifier `x`, `=`,
integer-literal `42`, `;`. Each token carries a kind, a source location (for diagnostics)
and sometimes a value.

The theory: token languages are *regular*, so a lexer is a DFA, and tools like `lex`/`flex`
literally compile a set of regexes into one. In practice production lexers are almost
always hand-written, because:

- **Speed.** Clang's lexer is a hand-rolled switch over characters with a fast path for
  identifiers and whitespace; it is one of the hottest pieces of code in the compiler.
- **Error recovery and diagnostics.** A generated DFA does not know that `0x` with no
  digits after it should produce a helpful message.
- **Context.** Real languages leak context into lexing (below).

**Where lexing stops being regular.** C and C++ have a *preprocessor* that runs between
"physical characters" and "tokens" — the standard describes translation phases where
trigraphs, line splicing (`\` at end of line), comment removal, preprocessing-token
formation, macro expansion and string concatenation all happen before the "real" parse.
Python's lexer must track indentation and emit synthetic `INDENT`/`DEDENT` tokens, which
requires a stack, so it is not a DFA either. C++ has the `>>` problem: in
`vector<vector<int>>` the `>>` must lex (or be re-lexed) as two closing angle brackets, not
a shift operator; C++11 made this a parser-level fix-up rather than a lexer hack.

## 1.3 Parsing

The parser turns a token stream into a tree. Two dominant families:

**Recursive descent (LL, top-down).** One function per grammar nonterminal; the function
looks at the next token(s) and decides which production to take, recursing into the
functions for the symbols on the right-hand side. Expression precedence is handled either
by a cascade of functions (`parseAssignment` → `parseTernary` → `parseLogicalOr` → … →
`parsePrimary`) or, much more compactly, by **Pratt parsing / precedence climbing**, where
each token kind carries a binding power and one loop does the whole precedence tower.

- Advantages: readable, debuggable with a stack trace, trivial to attach arbitrary
  side-conditions ("only allow this if we are inside a loop"), excellent error recovery
  (you know exactly which construct you are in the middle of), easy to hand-tune.
- Disadvantages: cannot handle left recursion directly (`expr := expr '+' term` recurses
  forever; you rewrite it as iteration), and it is on you to keep the code and the grammar
  in agreement.
- Who uses it: **clang, GCC (since ~4.1 for C++), rustc, TypeScript, V8, CPython's old
  parser.** Essentially every production compiler for a real language.

**LR (bottom-up), and its practical subsets SLR / LALR / LR(1) / GLR.** The parser is a
pushdown automaton driven by a table: shift tokens onto a stack, and when the top of the
stack matches a production's right-hand side, reduce. LALR(1) is what `yacc`/`bison`
generate.

- Advantages: handles left recursion natively, accepts a strictly larger class of grammars
  than LL(k) for the same k, and the table is derived mechanically from the grammar so the
  grammar *is* the source of truth. Conflicts (shift/reduce, reduce/reduce) are reported at
  table-construction time — a real correctness benefit.
- Disadvantages: the generated automaton is opaque, error messages are famously bad
  ("syntax error") unless you invest heavily in error productions, and encoding
  context-sensitivity means smuggling state through global variables.
- Who uses it: older C compilers, many DSLs, SQL parsers, Ruby (bison), Bash (bison).

**PEG / packrat** is a third family: ordered choice instead of ambiguity, unlimited
lookahead via memoization, linear time at the cost of memory. **CPython moved from an
LL(1) parser to a PEG parser in 3.9 (PEP 617)**, precisely because LL(1) was forcing
awkward grammar contortions.

### Why C++ needs more than a context-free grammar

This is the sharpest teaching example available, so state it precisely. C++ (and C) parsing
is not a function of the token stream alone; it depends on the *symbol table being built
concurrently*.

1. **The "lexer hack" / typedef-name ambiguity.** In C, `A * B;` is a declaration of `B` as
   pointer-to-`A` if `A` is a typedef name, and a multiplication expression statement
   otherwise. The grammar cannot decide. Real compilers feed the symbol table back into the
   lexer or parser so that `A` lexes as `typedef-name` rather than `identifier`. This is a
   genuine context-sensitivity, not a grammar bug.

2. **The most vexing parse.** `T x(Y());` — is `x` a variable initialized with a
   default-constructed `Y`, or a *function* named `x` taking a (pointer to) function
   returning `Y`? The standard resolves it by fiat: "anything that could be a declaration
   is a declaration." `Widget w();` declares a function. `Widget w{};` was added partly to
   give people an escape.

3. **Templates make it worse, and dependent names make it undecidable-in-practice.** Inside
   a template, `T::x * y;` cannot be resolved until `T` is known, which is why C++ requires
   the programmer to disambiguate manually with `typename T::x * y;` (declaration) versus
   the default reading (multiplication). The compiler is asking you for the parse.

4. **Template instantiation is Turing-complete.** Establishing whether a C++ program is
   well-formed can require running an arbitrary computation, so "is this a valid C++
   program?" is undecidable in general. The standard permits implementations to impose
   recursive-instantiation limits (a recommended minimum, not a bound) exactly because of
   this.

The pedagogical point for the learner: **grammars describe syntax; real languages have
semantics that leak into syntax.** A parser for a real language is a parser plus a symbol
table plus a pile of disambiguation rules that exist in the standard's prose, not in its
grammar.

## 1.4 The AST

The parse tree records every grammar production; the **abstract** syntax tree throws away
what only existed for the parser's benefit (parentheses, the precedence cascade, most
punctuation) and keeps meaning-bearing structure. `a + b * c` becomes
`Add(a, Mul(b, c))` — precedence is now a fact about tree shape, not about the grammar.

Design notes worth teaching:

- ASTs are almost always processed with the **visitor pattern** or with pattern matching,
  because you want to add new passes over a fixed node set.
- Clang keeps a *very* faithful AST — it preserves the source location and even the sugar
  (`typedef` names, parenthesized expressions, implicit conversions as explicit
  `ImplicitCastExpr` nodes). That is what makes clang-format, clang-tidy and IDE tooling
  possible, and it is a deliberate departure from GCC's historically more lossy trees.
  `clang -Xclang -ast-dump` prints it; this is a superb thing to make a learner look at.
- Some compilers use a **high-level IR instead of the AST** for early semantic work. Rust
  has HIR then MIR before it reaches LLVM IR. Swift has SIL. The reason is always the same:
  the AST is shaped for the human, and you want something shaped for the analysis.

## 1.5 Semantic analysis and name resolution

Everything between "the shape is legal" and "the meaning is legal":

- **Name resolution / scope binding**: which declaration does this identifier refer to?
  Requires a scope stack, and in C++ requires *overload resolution*, *argument-dependent
  lookup*, *template argument deduction*, *partial ordering of partial specializations*
  and *access control* — collectively the most complicated name lookup in any mainstream
  language.
- **Type checking**: does `f(x)` have a viable candidate? Is this conversion allowed? For
  Hindley–Milner languages this is *inference*, a unification algorithm, not just checking.
- **Constant evaluation**: `constexpr`/`consteval` requires a full interpreter for a subset
  of the language *inside the compiler*, which is why constexpr bugs feel like a different
  compiler entirely.
- **Flow-sensitive checks**: definite assignment, "not all control paths return a value",
  borrow checking in Rust. These need a control-flow graph, which is why they typically
  happen after (or on) an IR rather than the AST.
- **Diagnostics**: the compiler's actual user interface. Clang's reputation was built here.

## 1.6 The intermediate representation

### Three-address code

The canonical teaching IR. Every instruction has at most one operator and up to three
operands: `t1 = a + b`. Compound expressions are flattened into a sequence with temporaries.

```
;  x = (a + b) * (c - d)
t1 = a + b
t2 = c - d
t3 = t1 * t2
x  = t3
```

Grouped into **basic blocks** (maximal straight-line runs, single entry, single exit)
connected into a **control-flow graph (CFG)**. The CFG is the substrate for essentially
every classical dataflow analysis.

### SSA, and why it makes optimization tractable

**Static single assignment**: every variable is assigned exactly once, syntactically. When
control flow merges and a variable could have come from either predecessor, you insert a
**φ (phi) node** that selects based on which edge you arrived on.

```
;  non-SSA                    ;  SSA
if (c) x = 1;                 bb1: br c, bb2, bb3
else   x = 2;                 bb2: x1 = 1 ; br bb4
y = x + 1;                    bb3: x2 = 2 ; br bb4
                              bb4: x3 = phi [x1, bb2], [x2, bb3]
                                   y1 = x3 + 1
```

Why this is the single most important idea in the middle-end:

1. **Def-use chains become explicit and exact.** In non-SSA form, "which definition of `x`
   reaches this use?" is a dataflow problem you must solve, conservatively, and re-solve
   after every transformation. In SSA the answer is *the name itself* — there is exactly
   one definition of `x3`, and it is `x3`'s defining instruction. Reaching-definitions
   analysis collapses from a fixpoint iteration to a pointer dereference.
2. **Most analyses become sparse.** Classical dataflow propagates facts through *every
   program point* (dense). SSA lets you propagate facts along def-use edges only, touching
   only the instructions that could care. Sparse conditional constant propagation (SCCP) is
   the poster child: it does constant propagation and unreachable-code elimination
   *simultaneously* and gets strictly better results than either alone, and it is only
   practical because of SSA.
3. **No false dependencies.** Reusing `x` for unrelated purposes creates an artificial
   ordering constraint. SSA renaming destroys it, which is exactly what enables aggressive
   reordering, and it is the same trick hardware does with register renaming — worth
   pointing at, since the learner already knows out-of-order execution.
4. **Value numbering is nearly free.** Two SSA values with the same operator and the same
   operand names are the same value. GVN falls out.
5. **Dead code elimination is a mark-and-sweep.** A definition with no uses is dead, full
   stop, no analysis required.

Costs: you must *construct* SSA (the standard algorithm computes the **dominance frontier**
to decide where φ nodes go — Cytron et al. 1991) and *destruct* it before register
allocation, where φ nodes become real copies on the incoming edges. Naive destruction has
the "lost copy" and "swap" problems, which is why real compilers do this carefully.

**Verified example — SSA in the wild.** Compiler Explorer, `clang 21.1.0`, C,
`-O1 -emit-llvm -S -fno-discard-value-names`, on:

```c
int sum_signed(int *a, int n){ int s=0; for(int i=0;i<n;i++) s+=a[i]; return s; }
```

produced (debug intrinsics elided):

```llvm
define dso_local i32 @sum_signed(ptr noundef readonly captures(none) %a, i32 noundef %n) {
entry:
  %cmp4 = icmp sgt i32 %n, 0
  br i1 %cmp4, label %for.body.preheader, label %for.cond.cleanup

for.body.preheader:
  %wide.trip.count = zext nneg i32 %n to i64
  br label %for.body

for.cond.cleanup:
  %s.0.lcssa = phi i32 [ 0, %entry ], [ %add, %for.body ]
  ret i32 %s.0.lcssa

for.body:
  %indvars.iv = phi i64 [ 0, %for.body.preheader ], [ %indvars.iv.next, %for.body ]
  %s.05      = phi i32 [ 0, %for.body.preheader ], [ %add, %for.body ]
  %arrayidx  = getelementptr inbounds nuw i32, ptr %a, i64 %indvars.iv
  %0   = load i32, ptr %arrayidx, align 4
  %add = add nsw i32 %0, %s.05
  %indvars.iv.next = add nuw nsw i64 %indvars.iv, 1
  %exitcond.not = icmp eq i64 %indvars.iv.next, %wide.trip.count
  br i1 %exitcond.not, label %for.cond.cleanup, label %for.body
}
```

Everything a learner needs is visible here: the two loop-carried φ nodes, the LCSSA φ on
the exit (`%s.0.lcssa`), **induction variable widening** (`i` was `int`, the IV is now
`i64` — legal only because signed overflow is UB, see §1.12), the `nsw`/`nuw` poison flags
that record that fact in the IR, and `noundef`/`readonly`/`captures(none)` parameter
attributes carrying interprocedural facts.

## 1.7 The classic optimization passes

Roughly in the order a middle-end runs them, though real pipelines interleave and repeat.

**Constant folding.** Evaluate at compile time what is constant: `3 * 4` → `12`. Trivially
local. Subtle only for floating point (must respect rounding mode and NaN payloads unless
`-ffast-math`) and for anything with UB.

**Constant propagation.** Replace uses of a variable known to hold a constant. Combined
with folding it cascades. SCCP (sparse conditional constant propagation) additionally
proves branches unreachable and refuses to merge values from unreachable edges, which finds
constants a separate DCE+CP pass never will.

**Dead code elimination (DCE).** Remove instructions whose results are unused and which
have no side effects. In SSA this is a worklist over the use lists. *Aggressive* DCE
assumes everything is dead until proven live from side-effecting roots, which additionally
kills dead loops.

**Common subexpression elimination / global value numbering.** Compute `a+b` once.

**Inlining.** Replace a call with the callee's body. The single highest-leverage
optimization in real code, not because calls are expensive but because inlining is an
*enabling* transformation: after inlining, constants flow across the old call boundary,
aliasing is known, branches fold, and everything else gets more to work with. The whole
game is the cost model — inline too much and you blow out I-cache and compile time. GCC
enables `-finline-functions` at `-O2` (it moved from `-O3` in GCC 12); clang inlines at
`-O1` and up with a threshold that rises with `-O3`. Recursive functions get partial
inlining/unrolling; `always_inline` and `noinline` are the escape hatches.

**Loop-invariant code motion (LICM).** Hoist computations that do not change across
iterations into the preheader. Requires proving the computation is safe to speculate (no
trap, no side effect) or that the loop body always executes.

**Loop unrolling.** Replicate the body k times to amortize the loop overhead and expose
ILP. Full unrolling for small constant trip counts. Costs code size, so `-Os` disables it;
GCC's `-funroll-loops` is not even in `-O3` by default (it is in `-O3` only via
`-fpeel-loops` and friends; full `-funroll-loops` must be asked for, or comes with
`-fprofile-use`).

**Vectorization.** Turn a scalar loop into SIMD. Two forms: **loop vectorization**
(`-ftree-loop-vectorize`) turns iterations into lanes; **SLP / superword-level parallelism**
(`-ftree-slp-vectorize`) packs adjacent independent scalar operations in straight-line code
into one vector op. Both are at `-O2` in modern GCC (moved from `-O3` in GCC 12, with the
`very-cheap` cost model; `-O3` upgrades to `-fvect-cost-model=dynamic`). Blockers: loop-carried
dependences, unknown aliasing (fixed by `restrict` or by runtime alias checks with a
versioned loop), non-unit stride, function calls in the body, and floating-point
reassociation (illegal without `-ffast-math`, which is why FP reductions often refuse to
vectorize). `-fopt-info-vec-missed` tells you which.

**Strength reduction.** Replace expensive operations with cheap ones, usually in loops:
`i*4` where `i` is an induction variable becomes an added `+4` on a pointer. Visible in the
verified listing in §1.12.

**Tail call optimization.** A call in tail position becomes a jump, reusing the frame.
Mandatory for Scheme, an optimization in C/C++ (`-foptimize-sibling-calls`, at `-O2`).

**Register allocation via graph colouring** (Chaitin 1981; Briggs' improvement 1994).
This is the one to teach properly:

1. Build the **interference graph**: one node per virtual register (SSA value / live range),
   an edge between two nodes whose **live ranges overlap** — i.e. they are simultaneously
   live and therefore cannot share a physical register.
2. Assigning k physical registers is exactly **k-colouring** that graph. NP-complete in
   general, hence heuristics.
3. **Simplify**: repeatedly remove any node with degree < k and push it on a stack. Such a
   node is trivially colourable whatever its neighbours get (Kempe's heuristic).
4. **Coalesce**: merge nodes connected by a copy (`mov`) if the merge does not create an
   uncolourable node — this is how `mov` instructions disappear. Briggs and George give
   conservative safety tests.
5. **Spill**: if no node has degree < k, pick a victim by cost heuristic (spill cost /
   degree, where cost weights uses by loop depth ~10^depth), mark it for spilling, and
   restart. Spilled values live in the stack frame with reloads at each use.
6. **Select**: pop the stack, assigning each node a colour not used by its already-coloured
   neighbours.

Real complications the textbook version hides: **pre-coloured registers** (the ABI forces
arguments into `rdi`/`rsi`/…, `div` clobbers `rdx:rax`, the return value must be in `rax`),
**register classes** (GPR vs XMM vs mask registers), **live range splitting** (better than
spilling a whole range), and **callee-saved vs caller-saved** placement.
Alternatives in production: **linear scan** (Poletto & Sarkar 1999) — much faster, slightly
worse code, which is why JITs use it; LLVM's default `greedy` allocator is a priority-based
allocator with live-range splitting, not classical graph colouring; GCC's is `LRA`
(replacing the ancient `reload`).

Aside worth making explicitly to a learner who knows the microarchitecture: on an
out-of-order x86-64 core, the *architectural* registers the allocator fights over are
themselves renamed onto a much larger physical register file. Register allocation still
matters enormously — but for spill *traffic* to L1 and for instruction count, not because
the machine only has 16 registers.

**Instruction selection.** Map IR operations to target instructions. IR is
machine-independent; `x*5` might become `lea eax,[rdi+rdi*4]`. The classic algorithm is
**tree pattern matching with dynamic programming over a tree grammar** (BURS / iburg,
"maximal munch" as the greedy version). LLVM uses **SelectionDAG** (per-basic-block DAG,
legalize types → legalize operations → select via TableGen-generated matcher), with
**GlobalISel** as the newer replacement that works on a whole function and is faster; and
**FastISel** for `-O0`. The patterns themselves are declarative, written in TableGen in
`*.td` files.

**Instruction scheduling.** Reorder to fill pipeline slots and hide latency, guided by a
machine model of port assignments and latencies. Runs before RA (to expose parallelism) and
after RA (to fix up spill code) — `-fschedule-insns` and `-fschedule-insns2`, both at
`-O2` in GCC. On a modern out-of-order x86 the pre-RA scheduler matters much less than on
an in-order machine, but it still shapes what the allocator sees.

**Peephole optimization.** Local pattern rewrites on the final instruction stream:
`mov eax, eax` → nothing, `add eax, 1` → `inc eax` (or not, depending on the flags model).

## 1.8 What LLVM actually is

Not a compiler. A **library** for building compilers, organised around one data structure.

**LLVM IR** is a typed, SSA-form, RISC-like three-address IR with three isomorphic forms:
in-memory C++ objects, a textual assembly (`.ll`), and a compact bitcode (`.bc`). Key
properties:

- **Strongly typed**, including pointer element types historically — although modern LLVM
  has moved to **opaque pointers** (`ptr` with no pointee type; note the verified listing
  above says `ptr`, not `i32*`), with `getelementptr` carrying the type instead.
- Infinite virtual registers, explicit φ nodes, explicit `alloca` for stack slots.
- Rich **metadata** (`!dbg`, `!tbaa` for type-based alias analysis, `!range`, `!llvm.loop`)
  and **attributes** (`nsw`, `nuw`, `inbounds`, `noalias`, `readonly`, `noundef`) that
  record facts a later pass would not be able to re-derive.
- A defined notion of **`undef` and `poison`** — deferred UB. `poison` propagates through
  most operations and only becomes real UB when it reaches something that observes it
  (a branch condition, a store address). `freeze` converts poison to an arbitrary but fixed
  value. This is the formal machinery behind §1.12.

**The three parts, concretely:**

- **Frontend** — `clang` for C/C++/ObjC, `flang` for Fortran, `rustc` (its own frontend,
  emitting LLVM IR from MIR), `swiftc` (via SIL). A frontend's job is: source → LLVM IR
  plus target-appropriate ABI lowering. Note that ABI lowering leaks: how a struct is
  passed in registers is decided in the frontend, not the backend, because it is a
  *language* ABI question. This is why LLVM IR is not truly target-independent in practice.
- **Middle-end** — the target-independent optimizer, `opt`. A sequence of passes over LLVM
  IR. This is where inlining, SROA, GVN, LICM, loop vectorization, SCCP and DCE live.
- **Backend** — `llc`. Target-specific: SelectionDAG/GlobalISel isel, MachineInstr-level
  passes, register allocation, scheduling, `MC` layer emission to assembly or object bytes.

**The pass manager.** Passes are units of work with declared dependencies on *analyses*
(dominator tree, loop info, alias analysis, scalar evolution). The manager's job is to run
them in a chosen order and to cache/invalidate analyses so a pass that does not disturb the
CFG does not force the dominator tree to be recomputed.

- The **legacy pass manager** classified passes by scope (Module/CGSCC/Function/Loop) and
  used a mutable global-ish analysis cache.
- The **New Pass Manager (NPM)**, default since LLVM 13 for the optimization pipeline, is
  built around explicit `AnalysisManager` objects per IR unit, pass *adaptors* that lift a
  function pass into a module pass, and a declarative pipeline string. This is the reason
  `opt -passes='default<O2>'` and `-passes='inline,instcombine,sroa'` work — you can name a
  pipeline. It gives faster analysis reuse and much better composability.
- The **CGSCC** (call-graph strongly-connected-component) pass manager deserves a mention:
  it visits the call graph bottom-up so callees are optimized before their callers are
  offered the chance to inline them, and re-visits an SCC when inlining changes it. This
  bottom-up order is why inlining works as well as it does.

`opt -print-after-all`, `-print-changed`, and `--print-pipeline-passes` are how you show a
learner the middle-end actually running.

## 1.9 What MLIR adds, and why ML compilers moved to it

The problem MLIR was built for: LLVM IR is at *one* level of abstraction — roughly
"portable assembly with types." Every domain that needs a *higher* level (a machine-learning
graph, a loop nest to be tiled and fused, a hardware description, a database plan) ended up
inventing its own IR from scratch: TensorFlow graphs, XLA HLO, Halide IR, TVM's Relay/TIR,
Swift's SIL, Rust's MIR. Each rebuilt the same infrastructure — printing, parsing,
verification, pass management, location tracking — and each had a lossy one-way lowering
into LLVM IR, after which the high-level structure was gone and the backend had to
*reconstruct* loop structure it had been told and then forgotten ("the lifting problem").

MLIR's answer is **one IR infrastructure with no fixed instruction set**:

- **Operations** are the only concept. An op has operands, results, attributes, and
  **regions**. There is no built-in `add`; `arith.addi` is defined by a dialect.
- **Dialects** are namespaces of ops, types and attributes. `func`, `arith`, `scf`
  (structured control flow), `affine`, `memref`, `tensor`, `vector`, `linalg`, `gpu`,
  `llvm`, `spirv`, plus downstream ones like `tosa`, `stablehlo`, `triton`. Crucially,
  **ops from different dialects coexist in the same module**, which is what makes gradual
  lowering possible.
- **Regions and blocks** let an op contain a body — so a loop nest is *one op with a
  region*, not a scattered CFG that a later pass must re-recognise as a loop. The MLIR
  rationale is explicit that regions replace φ nodes with **block arguments**, noting
  "LLVM PHI nodes always have to be kept at the top of a block, and transformations
  frequently have to manually skip over them. This is defined away with BB arguments."
- **Progressive lowering** is the point. You start in a high-level dialect
  (`linalg.matmul` on `tensor<?x?xf32>`), and each pass lowers a bit: tile and fuse in
  `linalg`, bufferize `tensor`→`memref`, lower to `affine`/`scf` loops, vectorize into
  `vector`, then to `llvm` or `spirv` or `nvvm`. At every stage it is still valid MLIR,
  verifiable and printable, and you can stop and look at it.
- **Types carry shape**, including dynamic dimensions (`tensor<?x128xf32>`), which LLVM IR
  cannot express at all. For ML this is not a nicety; the entire optimization space is
  shape-dependent.

Why the ML world converged on it: an ML compiler's real work — operator fusion, layout
assignment, tiling for a memory hierarchy, mapping to tensor cores/systolic arrays,
quantization — is all *above* LLVM IR's level, and none of it survives lowering to LLVM IR.
MLIR let TensorFlow, IREE, Triton, ONNX-MLIR, Torch-MLIR, CIRCT and a long list of vendor
toolchains share one infrastructure while keeping their own semantics. Given the learner's
CUDA background, **Triton is the most legible example**: a Triton kernel is lowered
Triton dialect → TritonGPU dialect → LLVM/NVVM dialect → PTX, and the tile-level
abstraction that makes Triton pleasant to write only exists because there is an IR level
above LLVM to put it at.

Honest caveat: MLIR is infrastructure, not a compiler. It gives you no optimizations for
free; the dialects and passes are the work.

## 1.10 What the -O levels actually enable

Taken **verbatim from the GCC 15.2 manual** (`Optimize-Options.html`), which lists the
flags each level turns on. Abridged to what a learner should notice; the full lists are in
the manual and are worth showing once in their intimidating entirety.

| Level | What it is | Notable flags it turns on |
|---|---|---|
| `-O0` | Default. "Reduce compilation time and make debugging produce the expected results." Most passes off. Every variable lives in memory, reloaded at every use. | — |
| `-O1` | Cheap, mostly-local optimizations that do not blow up compile time. | `-fdce`, `-fdse`, `-ftree-ccp`, `-ftree-dce`, `-ftree-dominator-opts`, `-ftree-fre`, `-ftree-sra`, `-fforward-propagate`, `-fomit-frame-pointer`, `-finline-functions-called-once`, `-fmove-loop-invariants`, `-fipa-pure-const`, `-fipa-modref`, `-fivopts`, `-fssa-phiopt`, `-fshrink-wrap` |
| `-O2` | The production default. Everything in `-O1`, plus the expensive interprocedural and global work — **but historically nothing that increases code size much**. | `-finline-functions`, `-findirect-inlining`, `-fipa-cp`, `-fipa-sra`, `-fipa-icf`, `-fdevirtualize`, `-fgcse`, `-fcode-hoisting`, `-fexpensive-optimizations`, `-fstrict-aliasing`, `-fdelete-null-pointer-checks`, `-ffinite-loops`, `-fschedule-insns`, `-fschedule-insns2`, `-fstore-merging`, `-foptimize-sibling-calls`, `-fthread-jumps`, `-ftree-vrp`, `-ftree-pre`, **`-ftree-loop-vectorize`**, **`-ftree-slp-vectorize`**, `-fvect-cost-model=very-cheap`, `-fpeephole2`, `-freorder-blocks-and-partition` |
| `-O3` | `-O2` plus transformations that trade code size for speed. | `-fpeel-loops`, `-fsplit-loops`, `-fsplit-paths`, `-floop-interchange`, `-floop-unroll-and-jam`, `-fpredictive-commoning`, `-ftree-loop-distribution`, `-ftree-partial-pre`, `-funswitch-loops`, `-fgcse-after-reload`, `-fipa-cp-clone`, `-fversion-loops-for-strides`, `-fvect-cost-model=dynamic` |
| `-Os` | Optimize for size. All of `-O2` *except* the size-increasing parts, plus size-specific tuning. | Disables `-falign-functions`, `-falign-jumps`, `-falign-labels`, `-falign-loops`, `-fprefetch-loop-arrays`, `-freorder-blocks-algorithm=stc`. (The manual also lists `-finline-functions` as enabled here, tuned for size.) |
| `-Og` | Optimize the *debugging* experience. `-O1` minus the passes that most confuse a debugger. | Removes `-fbranch-count-reg`, `-fdelayed-branch`, `-fdse`, `-fif-conversion`, `-fif-conversion2`, `-finline-functions-called-once`, `-fmove-loop-invariants`, `-fmove-loop-stores`, `-fssa-phiopt`, `-ftree-bit-ccp`, `-ftree-dse`, `-ftree-pta`, `-ftree-sra` |
| `-Ofast` | `-O3` plus **standards violations**. | `-ffast-math`, `-fallow-store-data-races`, `-fno-protect-parens`. Do not ship this without knowing precisely what you gave up. |

Practical notes to hand a learner:

- **`-O2` is the real-world default** for essentially all distributions. `-O3` is not
  reliably faster; it can be slower via I-cache pressure, and the honest advice is "measure."
- **`-O1` is the first level where anything interesting happens**, and it is where the
  learner should start reading assembly, because `-O0` output is dominated by stack traffic
  and `-O2` output is dominated by things they have not learned yet.
- **The two big semantic cliffs are at `-O2`**: `-fstrict-aliasing` and
  `-fdelete-null-pointer-checks`. Both turn latent UB into visible behaviour change.
- Clang's levels are not identical to GCC's. Clang has `-Oz` (more aggressive than `-Os`),
  and it enables inlining earlier. Do not teach GCC's table as universal.

## 1.11 The optimizations that surprise people

### Strict aliasing — verified, with output that changes

C's rule (C23 6.5p7, "effective type") and C++'s equivalent: **an lvalue of one type may not
be used to access an object of an incompatible type**, with a short exemption list
(character types, `unsigned char`/`std::byte`, signed/unsigned variants, and types differing
only in qualification). Violate it and the compiler is entitled to assume the two pointers
never refer to the same object — so it can keep a value in a register across a store
through the other pointer.

**Verified on Compiler Explorer**, gcc 15.2, C, executed:

```c
#include <stdio.h>
int f(int *i, float *g) { *i = 1; *g = 0.0f; return *i; }
int main(void){ int x = 0; printf("%d\n", f(&x, (float*)&x)); return 0; }
```

| flags | program output |
|---|---|
| `-O0` | `0` |
| `-O2` | `1` |
| `-O2 -fno-strict-aliasing` | `0` |

That is the whole lesson in one table. At `-O2` GCC assumes `int*` and `float*` cannot
alias, so `return *i` reuses the `1` it just stored; at `-O0` it reloads and sees the bits
of `0.0f`. **Neither answer is wrong** — the program has no defined behaviour. This is the
single best exercise in this document, and it is in §6.

The legal way to reinterpret bits: `memcpy` (compilers pattern-match it to zero
instructions), C++20 `std::bit_cast`, C23 `memcpy`, or a union (a **GCC/Clang documented
extension** in C++, and legal type-punning in C since C99 TC3).

### Signed overflow is UB, and that is why loops are fast — verified

Signed integer overflow is UB in C and C++; unsigned arithmetic is defined to wrap modulo
2^N. That asymmetry is worth real performance.

**Verified on Compiler Explorer**, gcc 15.2, C, `-O2`, Intel syntax:

```c
int      inc_gt_s(int x)      { return x + 1 > x; }
unsigned inc_gt_u(unsigned x) { return x + 1 > x; }
void stride_s(int *a, int n)        { for (int i=0;i<n;i++)      a[i*4] = 0; }
void stride_u(int *a, unsigned n)   { for (unsigned i=0;i<n;i++) a[i*4] = 0; }
```

```asm
inc_gt_s:                 ; signed: x+1 > x is ALWAYS true, because overflow can't happen
  mov eax, 1
  ret

inc_gt_u:                 ; unsigned: false exactly when x == 0xFFFFFFFF
  xor eax, eax
  cmp edi, -1
  setne al
  ret

stride_s:                 ; 64-bit induction variable, strength-reduced to a pointer,
  test esi, esi           ; unrolled 2x with a peeled iteration
  jle .L4
  movsx rsi, esi
  sal   rsi, 4
  lea   rax, [rdi+rsi]
  and   esi, 16
  je    .L6
  mov   DWORD PTR [rdi], 0
  add   rdi, 16
  cmp   rdi, rax
  je    .L13
.L6:
  mov   DWORD PTR [rdi], 0
  add   rdi, 32
  mov   DWORD PTR [rdi-16], 0
  cmp   rdi, rax
  jne   .L6
.L4:
  ret

stride_u:                 ; 32-bit IV kept, index recomputed every iteration, no unroll:
  test esi, esi           ; i*4 may wrap mod 2^32, so the address sequence is not affine
  je   .L14
  xor  eax, eax
.L16:
  lea  edx, [0+rax*4]
  add  eax, 1
  mov  DWORD PTR [rdi+rdx*4], 0
  cmp  esi, eax
  jne  .L16
.L14:
  ret
```

Three distinct wins visible in one listing:

1. **`x+1 > x` folds to `1`.** The compiler is allowed to reason "if `x` were `INT_MAX`
   this is UB, therefore `x` is not `INT_MAX`, therefore `x+1 > x`."
2. **Induction-variable widening.** On x86-64 an `int` index must be sign-extended to
   64 bits to form an address. Because signed overflow is UB, `i` provably stays in
   `[0, n)` and can be *promoted to `int64_t` once*, eliminating a `movsx` per iteration.
   The `unsigned` version cannot: `i*4` may legally wrap, so the address sequence is not
   monotonic and the IV must stay 32-bit.
3. **Strength reduction + unrolling follow.** Once the IV is a clean 64-bit affine
   sequence, GCC replaces indexing with a walking pointer and unrolls. The unsigned loop
   gets none of it.

The corollary developers hate but should learn: `-fwrapv` (define signed overflow as
two's-complement wrap) makes UB-based bugs disappear *and* costs you the above.
`-fsanitize=undefined` / `-fsanitize=signed-integer-overflow` is the right tool for
finding the bugs; `-fwrapv` is the right tool only if you have decided to depend on wrap.

### Other UB the optimizer cashes in

- **`-fdelete-null-pointer-checks`** (on at `-O2`): if you dereference `p` and *then* test
  `if (p)`, the test is dead — the dereference already asserted `p != NULL`. This produced
  a famous Linux kernel privilege-escalation CVE (CVE-2009-1897, `tun_chr_poll`), which is
  why the kernel builds with `-fno-delete-null-pointer-checks`.
- **`-ffinite-loops`** (on at `-O2` in GCC 12+; C++ has always allowed it, C11 only for
  non-constant conditions): a loop with no side effects and no I/O is assumed to terminate,
  so an infinite empty loop can be deleted — and if control then falls into an unrelated
  function, so be it. This is the source of the notorious "clang compiles an infinite loop
  into a call to an unreferenced function" example.
- **Reaching the end of a non-`void` function** is UB in C++; clang will emit `ud2` or
  simply fall through into whatever follows.
- **Out-of-bounds and `restrict` violations** similarly license reordering.
- **Uninitialized reads** produce `undef`/`poison`, which is *not* "some random value" —
  it can appear to have different values at different uses.

The framing to teach: **UB is not "the compiler is allowed to be evil." UB is a contract
that lets the optimizer treat your program's preconditions as facts.** Every one of these
optimizations is the compiler believing something you told it.

## 1.12 The linker, in detail

The compiler emits one **relocatable object file** per translation unit (ELF `.o` on
Linux, Mach-O on macOS, COFF on Windows). It is incomplete in two ways: it refers to
symbols it does not define, and it does not know its own final addresses.

### Sections and symbols

An ELF `.o` has sections — `.text` (code), `.data` (initialized writable), `.rodata`
(read-only), `.bss` (zero-initialized, occupies no file space), `.symtab`, `.strtab`,
`.rela.text` (relocations for `.text`), `.eh_frame` (unwind info), `.debug_*`. Also
`.init_array`/`.fini_array` (static constructors) and, in C++, COMDAT groups.

The **symbol table** classifies each symbol by binding (`LOCAL`, `GLOBAL`, `WEAK`), type
(`FUNC`, `OBJECT`, `TLS`, `NOTYPE`), visibility (`DEFAULT`, `HIDDEN`, `PROTECTED`,
`INTERNAL`) and section index — with the special `SHN_UNDEF` meaning "I need this from
someone else."

### Symbol resolution

The linker builds one global symbol table and matches every undefined reference to exactly
one definition, with rules that are the source of most linker errors a learner will meet:

- **Multiple strong definitions of the same global → error** ("multiple definition of").
- **Weak symbols** lose to strong ones and can go unresolved (address 0). This is how
  `__attribute__((weak))` overriding and glibc's optional-pthread-stubs trick worked.
- **Archive (`.a`) semantics are order-dependent.** A static archive is a bag of `.o` files;
  the linker pulls in a member *only if* it resolves a currently-undefined symbol, scanning
  left to right. This is why `gcc main.o -lfoo` works and `gcc -lfoo main.o` does not, and
  why circular dependencies need `--start-group`/`--end-group`. Shared libraries are not
  order-dependent in the same way, but link order still determines symbol interposition.
- **C++ needs COMDAT/`section groups`.** An inline function or template instantiation is
  emitted in every TU that uses it; the linker keeps one and discards the rest
  (`SHF_GROUP` + `GRP_COMDAT`, "link once"). Getting this wrong is the ODR violation class
  of bug — and note the linker *cannot* diagnose most ODR violations, it just picks one.
- **Name mangling** exists so that overloads and namespaces get distinct symbol names. On
  Linux/macOS the Itanium C++ ABI mangling: `_Z3fooi` is `foo(int)`. `c++filt` demangles.

### Relocations

A relocation is an instruction to the linker: "at offset X in this section, patch in a
value computed from symbol S, addend A, and the final address P." x86-64 ELF types you will
actually see:

| Type | Computation | Used for |
|---|---|---|
| `R_X86_64_PC32` | `S + A - P` | `call`/`jmp` rel32, RIP-relative data access |
| `R_X86_64_64` | `S + A` | absolute 64-bit pointer in `.data` |
| `R_X86_64_PLT32` | `L + A - P` | call that may go through the PLT |
| `R_X86_64_GOTPCREL` | `G + GOT + A - P` | load an address out of the GOT |
| `R_X86_64_GLOB_DAT` | `S` | dynamic: fill a GOT entry |
| `R_X86_64_JUMP_SLOT` | `S` | dynamic: fill a PLT slot (lazy binding) |
| `R_X86_64_RELATIVE` | `B + A` | PIE/shared-lib self-relocation by load base |
| `R_X86_64_TPOFF64`, `R_X86_64_TLSGD` | — | thread-local storage models |

`readelf -r`, `objdump -dr` and `nm` are the tools. Showing a learner an unlinked `.o` with
`call 0` and a `R_X86_64_PLT32 puts-4` relocation next to it, then the same instruction
after linking, is a ten-second demonstration that lands permanently.

### Static vs dynamic linking

**Static** (`-static`, `.a`): everything is copied into the executable at link time. One
file, no runtime dependency, fastest startup, no PLT indirection. Costs: binary size,
memory not shared between processes, and a security fix in a library requires relinking
every binary. Also: statically linking glibc is problematic because `getaddrinfo`/NSS
`dlopen`s modules at runtime regardless. musl is the usual answer.

**Dynamic** (`.so`, `.dylib`): the link-time linker records a `DT_NEEDED` entry and leaves
the work to the **dynamic linker / loader** (`ld.so`, `/lib64/ld-linux-x86-64.so.2`) at
process start. That loader maps the libraries, performs relocations, resolves symbols, and
runs initializers.

- **PIC and the GOT.** Position-independent code cannot embed absolute addresses, so data
  references go through the **Global Offset Table**, one indirection whose entry the loader
  fills in.
- **The PLT and lazy binding.** Function calls go through the **Procedure Linkage Table**:
  the first call jumps to a stub that calls into the resolver, which patches the GOT entry;
  subsequent calls go straight through. `LD_BIND_NOW=1` / `-z now` forces eager binding
  (required for **RELRO**: `-z relro -z now` makes the GOT read-only after startup, killing
  a whole class of exploit).
- **Symbol interposition** is the reason a shared library's own calls to its own global
  functions still go through the PLT by default — someone might `LD_PRELOAD` a replacement.
  `-fvisibility=hidden` plus explicit exports removes both the indirection and a great deal
  of dynamic symbol table bloat, and is standard practice for C++ libraries.
- **Symbol versioning** (`GLIBC_2.34` etc.) lets one `.so` export several incompatible
  versions of a symbol so old binaries keep working.
- **`ldd`, `LD_DEBUG=all`, `LD_LIBRARY_PATH`, `RPATH`/`RUNPATH`, `dlopen`/`dlsym`** are the
  runtime surface. macOS differs: `dyld`, `DYLD_*`, two-level namespaces, `@rpath`.

### LTO — link-time optimization

The problem: the middle-end optimizes one translation unit at a time, so it cannot inline
across `.c` files, cannot prove a global is never written outside this TU, and cannot do
whole-program devirtualization.

LTO fixes this by **not actually generating machine code at compile time**. With `-flto`,
each `.o` contains serialized IR (LLVM bitcode, or GCC's GIMPLE) instead of (or alongside)
machine code. At link time a **linker plugin** hands all the IR back to the compiler, which
performs the optimization and codegen with the whole program in view.

- **Monolithic LTO** merges everything into one module: best results, but serial, memory
  hungry, and painful on large programs.
- **ThinLTO** (LLVM) does a cheap parallel summary-based pass first: build a global summary
  of the call graph and symbols, decide *cross-module import* decisions from summaries, then
  optimize each module in parallel importing only what it needs. Nearly the quality of full
  LTO at nearly the compile time of non-LTO, and it is what Chrome, Firefox and most large
  C++ projects ship. GCC's equivalent parallel mode is WHOPR-style partitioning.
- Interacts with: **PGO** (profile-guided optimization — `-fprofile-generate`/`-fprofile-use`
  or sampled via `perf` + AutoFDO; profiles change inlining and layout decisions far more
  than any `-O` flag), **BOLT** (post-link binary layout optimization using perf data),
  and `--gc-sections` + `-ffunction-sections -fdata-sections` (dead *section* elimination,
  the linker's own DCE).
- Gotchas: LTO changes what UB does (more inlining ⇒ more cross-TU assumption
  propagation), can break code relying on symbol interposition or on assembly-level
  assumptions, and makes debugging harder.

Modern linkers to name: **GNU ld** (the original, slow), **gold** (ELF-only, faster,
now deprecated), **lld** (LLVM's, very fast, the default in many toolchains), **mold**
(fastest, aggressively parallel). `-fuse-ld=lld` / `-fuse-ld=mold`.

---

# Part 2 — Interpreters and virtual machines

## 2.1 The three designs

**Tree-walking interpreter.** Evaluate the AST directly with a recursive `eval(node)`.
Simplest possible thing that works; this is what a first interpreter in *Crafting
Interpreters* Part II is. Cost: every operation pays for a virtual dispatch, a heap-allocated
node visit, and pointer-chasing through a tree with terrible locality. Typically **10–100×
slower** than a bytecode VM. Used by: early Ruby (pre-1.9 MRI), original PHP, most toy
languages, and most configuration/expression evaluators (where it is the right choice).

**Bytecode virtual machine.** Compile the AST to a linear instruction stream for an
abstract machine, then run a dispatch loop. Wins: compact and cache-friendly code, dispatch
cost paid once per operation rather than per tree node, the compile step can do constant
folding and peephole work, and the bytecode can be cached to disk. Two flavours:

- **Stack machine** — operands come from and go to an operand stack. CPython, the JVM,
  the CLR, WebAssembly (mostly), Lua 4 and earlier. Instructions are tiny (often one byte
  plus one operand) because operand locations are implicit. More instructions executed.
- **Register machine** — operands are indices into a per-frame register array.
  Lua 5+, Dalvik, LuaJIT's IR, BEAM. Fewer, fatter instructions; fewer dispatches; easier to
  map onto real registers later. Lua 5.0's move to registers is the canonical case study.

**JIT compiler.** Compile bytecode (or source) to *native machine code* at runtime, using
information only available at runtime — actual types, actual branch frequencies, actual
receiver classes. That last point is the whole reason a JIT can beat a static compiler on
dynamic languages: `a + b` in Python is a polymorphic call, but at this specific call site
it has been two `int`s ten thousand times in a row, so emit an `add` with a type guard.

## 2.2 CPython, in depth

### `.pyc` and the compile pipeline

`source → tokenizer → PEG parser → AST → symbol table → CFG → bytecode → optimizer → code object`

- The **PEG parser** replaced the old LL(1) parser in **3.9 (PEP 617)**.
- The compiler builds a **symbol table** (which names are local/global/free/cell — this is
  what makes `nonlocal`/closures work and what decides `LOAD_FAST` vs `LOAD_GLOBAL` vs
  `LOAD_DEREF`), then a CFG, then emits bytecode with a small peephole/CFG optimizer.
- The result is a **code object** (`PyCodeObject`): `co_code` (bytecode), `co_consts`,
  `co_names`, `co_varnames`, `co_stacksize` (the compiler computes the maximum stack depth
  so the frame can be allocated once), `co_flags`, and line-number tables. Nested functions
  and comprehensions get their own nested code objects in `co_consts` — visible in the
  verified `dis` output below.
- **`.pyc`** in `__pycache__/mod.cpython-314.pyc` is: a 4-byte magic number (bumped on every
  bytecode format change — this is why a `.pyc` from another version is simply rejected),
  a bit field, then either an mtime+size pair or a source hash (PEP 552 deterministic
  `.pyc`s), then a `marshal`-serialized code object. **`.pyc` is a cache, not a
  distribution format, and it is not an optimization of the code — it only skips parsing.**

### The eval loop

`_PyEval_EvalFrameDefault` in `Python/ceval.c`, ~
a few thousand lines, is the heart. Structurally:

```c
for (;;) {
    opcode  = NEXTOP();
    oparg   = NEXTARG();
    switch (opcode) {
        case LOAD_FAST: { ... goto dispatch; }
        case BINARY_OP: { ... goto dispatch; }
        ...
    }
}
```

with per-instruction state: `next_instr` (the bytecode program counter), `stack_pointer`,
and the frame. The actual case bodies are **generated** — since 3.12 they are written in a
DSL in `Python/bytecodes.c` and a build-time tool emits `ceval.c`'s cases, the Tier-2
micro-op definitions, and the `dis` tables from one source of truth.

**Computed-goto dispatch.** The naive `switch` compiles to a single indirect jump through a
jump table, so *every* opcode's dispatch shares one indirect branch — and an indirect branch
predictor keyed on one site cannot learn anything about bytecode sequences. With GCC/Clang's
**labels-as-values** extension (`&&label`, `goto *ptr`), CPython instead ends every opcode
body with its *own* `goto *opcode_targets[NEXTOPCODE()]`. Now there is one indirect branch
site per opcode, and the predictor can learn correlations like "`COMPARE_OP` is usually
followed by `POP_JUMP_IF_FALSE`." Reported historical speedups are in the **15–20%** range.
Enabled by `--with-computed-gotos` (default where supported); `USE_COMPUTED_GOTOS`.

**The tail-call interpreter (3.14).** Newer approach: each opcode becomes a *separate small
C function*, and dispatch is a **guaranteed tail call** (`__attribute__((musttail))`) to the
next opcode's function. This gets the compiler to allocate registers per-opcode instead of
choking on one enormous function, and avoids the register-allocation cliff that a
3000-line `switch` causes. Python 3.14's release notes state it plainly: *"A new type of
interpreter has been added to CPython. It uses tail calls between small C functions that
implement individual Python opcodes, rather than one large C `case` statement."* Measured:
*"a geometric mean of 3-5% faster on the standard `pyperformance` benchmark suite"*, baseline
being 3.14 built with Clang 19 without it. Requires **Clang 19+ on x86-64 or AArch64**;
opt-in via `--with-tail-call-interp`.

### PyObject and reference counting

Everything in Python is a `PyObject*`. The header:

```c
typedef struct _object {
    Py_ssize_t ob_refcnt;      // reference count
    PyTypeObject *ob_type;     // pointer to the type object
} PyObject;
// variable-size objects add:
typedef struct { PyObject ob_base; Py_ssize_t ob_size; } PyVarObject;
```

Consequences a systems programmer should internalise:

- **Every Python integer is a heap object with a header.** Verified locally on CPython
  3.14.7: `sys.getsizeof(1)` is **28 bytes** and `sys.getsizeof(2**70)` is **36 bytes** —
  because `int` is arbitrary-precision, stored as a `PyVarObject` with a digit array.
  A `list` of a million ints is a million pointers *plus* a million 28-byte objects,
  scattered. This is why NumPy exists.
- **Small integers are cached.** CPython preallocates `-5..256`, so `is` comparisons on
  small ints "work" and on large ones do not, portably speaking. (Caveat: constant folding
  in the compiler makes `257 is 257` true inside one code object anyway — verified locally.
  Never teach `is` on ints.)
- **`ob_type` is the vtable.** `PyTypeObject` holds function pointers (`tp_call`,
  `tp_getattro`, `nb_add`, …). `a + b` is: look at `type(a)->tp_as_number->nb_add`, maybe
  the reflected `nb_radd` on `type(b)`, plus subclass rules. That is a lot of pointer
  chasing for an `add`.
- **Reference counting**: `Py_INCREF`/`Py_DECREF`; at zero, `tp_dealloc` runs immediately.
  Advantages: deterministic destruction (`with` and `__del__` work predictably), no pause
  times, no need to trace. Disadvantages: **every single object touch is a memory write**,
  which destroys cache lines and, critically, makes multithreading expensive; and
  **reference cycles leak**, hence the separate **generational cycle collector** (`gc`
  module, three generations, tracks only container types, uses the "subtract internal
  references" trick to find unreachable cycles).
- `sys.getrefcount(x)` always reads one higher than you expect — verified locally as `2`
  for a fresh object — because passing it as an argument creates a reference.

### The GIL: what it actually protects

The **Global Interpreter Lock** is one mutex held by whichever OS thread is currently
executing Python bytecode. Precisely:

**What it protects:** the consistency of the interpreter's own mutable state under
concurrent access. Specifically the reference counts (`ob_refcnt` is a plain
non-atomic `Py_ssize_t`), and the internal invariants of built-in mutable containers,
type objects, module dicts, the free lists, and the memory allocator (`pymalloc`, which is
not thread-safe on its own).

**What it does not do:** it does not make *your* Python code atomic in any useful sense.
A single bytecode instruction is atomic with respect to other Python threads, but
`x += 1` is several instructions and can interleave. `list.append` happens to be atomic
because it is one C-level call, but that is an implementation detail, not a promise.

**What it costs:** only one thread runs Python bytecode at a time, so pure-Python CPU-bound
code gets **zero** speedup from threads. It does *not* block I/O concurrency: any
well-behaved C call that blocks (file I/O, sockets, `time.sleep`, most of NumPy's heavy
kernels, `zlib`) releases the GIL around the blocking region via
`Py_BEGIN_ALLOW_THREADS` / `Py_END_ALLOW_THREADS`. This is why threads are fine for I/O
and useless for computation.

**How it is released between bytecodes:** historically a "check interval" of N bytecodes;
since 3.2 it is a **time-based switch interval**, default 5 ms (`sys.setswitchinterval`),
with a request-drop protocol so the holder is asked to yield rather than being preempted at
an arbitrary point. The old scheme caused pathological convoying on multicore, documented
in Dave Beazley's much-cited GIL talks.

**Why removing it is hard** — this is the substantive part:

1. **Reference counting is the whole problem.** Making `ob_refcnt` atomic costs a locked
   RMW on *every* object touch. Measured attempts (Larry Hastings' "Gilectomy", 2015–2017)
   found atomic refcounts alone cost roughly **2× single-threaded slowdown**, and the
   result *still* did not scale, because hot shared objects (`None`, `True`, small ints,
   type objects, module globals) become cache-line ping-pong across every core.
2. **Every container needs its own lock**, and fine-grained locking of dicts and lists
   introduces both overhead and deadlock ordering problems.
3. **The C API is the real blocker.** Tens of thousands of C extensions were written
   against a model where "I hold the GIL" means "nothing else is mutating anything."
   Removing the GIL breaks that assumption silently, not loudly.
4. **Single-threaded performance is the acceptance criterion.** Every previous attempt was
   rejected because the vast majority of Python programs are single-threaded, and the core
   team will not make them slower to help the minority.

**PEP 703's answer** (Sam Gross, `nogil`): a combination of
**biased reference counting** (an owner-thread-local non-atomic refcount plus a shared
atomic one, so the common single-threaded case stays cheap), **immortal objects**
(PEP 683 — `None`, `True`, small ints, interned strings get a sentinel refcount and are
never counted at all, killing the worst contention), **deferred reference counting** for
objects reachable from the stack, a **thread-safe allocator** (mimalloc), per-object locks,
and an internal "stop the world" for the cycle collector.

### What changed, version by version

| Version | Change | Detail |
|---|---|---|
| **3.11** | **Specializing adaptive interpreter (PEP 659)**, "Faster CPython" phase 1 | Quickening + inline caches, described below. Also: zero-cost exceptions (no setup cost on the happy path, a side table maps PC to handler), lazily-created frame objects, inlined Python-to-Python calls (a Python function calling a Python function no longer recurses into C). Advertised 1.25× on `pyperformance`. |
| **3.12** | Bytecode DSL, `PEP 669` monitoring, immortal objects (PEP 683), per-interpreter GIL (PEP 684) | `Python/bytecodes.c` becomes the single source for the interpreter, Tier-2 uops and `dis`. **PEP 684** gives each sub-interpreter its own GIL — real parallelism, but with fully isolated interpreters, not shared objects. Comprehensions inlined (PEP 709). |
| **3.13** | **Free-threaded build (PEP 703)** and **experimental JIT (PEP 744)**, both opt-in | Free-threading: `--disable-gil`, binary named `python3.13t`, controllable at runtime with `PYTHON_GIL=0/1` or `-X gil=1`, detectable with `sys._is_gil_enabled()`. Documented as **experimental** with a *"substantial single-threaded performance hit"* and requiring C extensions to be rebuilt. JIT: `--enable-experimental-jit[=yes\|no\|yes-off\|interpreter]`, `PYTHON_JIT` env var, off by default, *"performance improvements are modest."* Also a new PyPy-derived REPL. |
| **3.14** | **Free-threading officially supported (PEP 779)**; **tail-call interpreter**; JIT in Windows/macOS binaries | *"The performance penalty on single-threaded code in free-threaded mode is now roughly 5-10%, depending on the platform and C compiler used."* PEP 659 specialization now works in free-threaded mode too. Tail-call interpreter: 3–5% geomean, Clang 19+, `--with-tail-call-interp`. |

### The specializing adaptive interpreter, concretely

PEP 659's mechanism, in the order it happens:

1. **Quickening.** After a code object has been executed enough times, its bytecode is
   copied into a mutable array and instructions are replaced with *adaptive* variants
   (`LOAD_ATTR` → `LOAD_ATTR_ADAPTIVE`). (In 3.12+ the adaptive form is the default
   emitted form and the separate quickening step is gone; the counter lives in the inline
   cache.)
2. **Inline caches.** Specialized instructions store data in 16-bit **cache entries
   embedded directly in the bytecode array immediately after the instruction**. `dis` shows
   these as `CACHE` entries when you pass `show_caches=True`. The adaptive form uses the
   first entry as its counter.
3. **Specialization.** When the counter fires, a family-specific function inspects the
   actual operands and rewrites the instruction into a specialized member of its **family**:
   `LOAD_ATTR` → `LOAD_ATTR_INSTANCE_VALUE` / `LOAD_ATTR_MODULE` / `LOAD_ATTR_SLOT` / …;
   `BINARY_OP` → `BINARY_OP_ADD_INT` / `BINARY_OP_ADD_FLOAT` / `BINARY_OP_ADD_UNICODE` / …
4. **Guard and deoptimize.** Every specialized instruction begins with a cheap **guard**
   (is the type still `int`? is the class's version tag unchanged?). On a miss it
   *decrements a saturating counter* and falls back to the generic operation; if the counter
   bottoms out, the instruction **de-specializes** back to the adaptive form and may later
   re-specialize differently. PEP 659 states the policy as: on mismatch the counter "will be
   decremented and the generic operation will be performed," and at minimum it reverts.

**Verified live, CPython 3.14.7 on this machine.** Same function, before and after warmup:

```
>>> def hot(a, b): return a + b
>>> dis.dis(hot)                      # cold
  RESUME                   0
  LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
  BINARY_OP                0 (+)
  RETURN_VALUE

>>> for _ in range(1000): hot(1, 2)
>>> dis.dis(hot, adaptive=True)       # hot
  RESUME_CHECK             0
  LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
  BINARY_OP_ADD_INT        0 (+)
  RETURN_VALUE
```

Bisecting the warmup on this build: `RESUME` becomes `RESUME_CHECK` after **1** execution
and `BINARY_OP` becomes `BINARY_OP_ADD_INT` after **2** executions. (PEP 659 quotes ~2000
for the 3.10-era comparison; the modern counters are far more eager. Treat any specific
threshold as version-specific and measure it rather than quoting it.)

**Bytecode drift is itself a lesson.** Same source, four CPython versions, verified on
Compiler Explorer:

| Version | Body of `def add(a, b): return a + b` |
|---|---|
| 3.10 | `LOAD_FAST a` / `LOAD_FAST b` / **`BINARY_ADD`** / `RETURN_VALUE` |
| 3.11 | **`RESUME`** / `LOAD_FAST a` / `LOAD_FAST b` / **`BINARY_OP 0 (+)`** / `RETURN_VALUE` |
| 3.13 | `RESUME` / **`LOAD_FAST_LOAD_FAST (a, b)`** / `BINARY_OP 0 (+)` / `RETURN_VALUE` |
| 3.14 | `RESUME` / **`LOAD_FAST_BORROW_LOAD_FAST_BORROW (a, b)`** / `BINARY_OP 0 (+)` / `RETURN_VALUE` |

Three visible evolutions: the collapse of ~20 type-specific binary opcodes into one generic
`BINARY_OP` that specialization re-splits at runtime (3.11); **superinstructions** fusing
two `LOAD_FAST`s into one dispatch (3.13); and `LOAD_FAST_BORROW`, which pushes a *borrowed*
reference and skips the `Py_INCREF`/`Py_DECREF` pair entirely (3.14) — a direct attack on the
refcounting cost described above. At module level, 3.13 also shows `RETURN_CONST` replacing
`LOAD_CONST`+`RETURN_VALUE`, and 3.11 dropped the separate `LOAD_CONST` of the function
name before `MAKE_FUNCTION` (the name now comes from the code object).

## 2.3 How a JIT actually works

### Method JIT vs tracing JIT

**Method (function-at-a-time) JIT.** The unit of compilation is a function. When a
function's invocation counter or loop back-edge counter crosses a threshold, compile the
whole function to native code with type feedback gathered by the interpreter. Used by:
HotSpot (JVM), V8, SpiderMonkey, .NET, CPython's Tier-2/JIT.

**Tracing JIT.** The unit of compilation is a *hot path*, usually a loop. When a loop
header gets hot, switch into recording mode and record the exact sequence of operations
actually executed for one iteration — **through function calls, inlining everything
automatically**, with every conditional recorded as a **guard**. The result is a straight-line
trace with side exits. Compile that. Used by: LuaJIT, PyPy, TraceMonkey (historical),
Dalvik's early JIT.

The trade: tracing gets aggressive inlining and specialization for free and produces
beautifully simple linear IR, but it is fragile — code with unpredictable branches produces
trace explosion or constant side-exits, and "trace aborts" (on unsupported operations like
calls into C) can leave hot code permanently uncompiled.

### Tiering

Nobody uses one compiler. The economics are: compilation is expensive and most code runs
once, so you want a fast-to-start tier and a slow-to-compile-but-fast-to-run tier, with
promotion driven by measured hotness.

The canonical shape:

```
Tier 0: interpreter          — starts instantly, collects type feedback
Tier 1: baseline/quick JIT   — compile fast, no optimization, no IR
Tier 2: optimizing JIT       — speculate on the collected feedback
(Tier 3: even more optimizing, for the truly hot)
```

**On-stack replacement (OSR)** is the necessary trick: a function may become hot *while it
is executing* (a long-running loop entered once). OSR compiles a new version and transfers
control into it mid-execution, reconstructing the compiled frame's state from the
interpreter frame at a specific bytecode offset. Without OSR, `for i in range(10**9)` in
`main` never gets compiled.

### Deoptimization

Optimized code is only correct *given assumptions* — "this variable is always a small int",
"this call site always targets `Array.prototype.map`", "this class has no subclasses yet",
"this field was never assigned a non-int." Each assumption becomes either a **guard** in
the compiled code or a **dependency** registered against a runtime event.

When an assumption breaks, you must **deoptimize**: abandon the optimized frame and resume
in the interpreter *at exactly the right bytecode offset with exactly the right values*.
That requires the compiler to have recorded, for each deopt point, a **map from machine
state (registers, stack slots) back to interpreter state (bytecode index, locals, operand
stack)**. V8's post on Maglev describes exactly this: the compiler "attaches abstract
interpreter frame state to nodes that can deoptimize." HotSpot's equivalent is
`Deoptimization` with its `ScopeDesc` metadata.

Two flavours:
- **Eager deopt**: a guard fails right here, jump to the deopt handler now.
- **Lazy deopt**: some *other* event invalidates code that is currently on the stack (a
  class was loaded that breaks a monomorphic assumption). The runtime patches the return
  address of the live frame so that when control comes back, it lands in the deopt handler.

**Deopt loops** are the classic pathology: compile, deopt, recompile with the same bad
assumption, deopt. Engines track deopt counts per function and eventually give up
speculating on that site.

### V8, concretely

Verified against the V8 team's own Maglev post:

- **Ignition** — the bytecode interpreter. All JavaScript is compiled to Ignition bytecode
  first and interpreted. It records type feedback into **feedback vectors** (inline caches
  per call site / property access site).
- **Sparkplug** (2021) — a **baseline JIT** that compiles bytecode to machine code
  "almost instantaneously" with **no intermediate representation at all**: it walks the
  bytecode once and emits the machine-code equivalent of each interpreter handler,
  keeping the same frame layout so it can interoperate with the interpreter trivially.
  Reported: **+45% on JetStream and +41% on Speedometer over Ignition alone.**
- **Maglev** (2023) — a mid-tier optimizing JIT using an **SSA-based IR over a control-flow
  graph**. Positioned explicitly between the others: "code that's much faster than Sparkplug
  code, but is generated much faster than TurboFan can" — roughly **10× slower to compile
  than Sparkplug and 10× faster to compile than TurboFan**. It speculates and therefore
  supports deoptimization, reusing TurboFan's deopt machinery.
- **TurboFan** — the top-tier optimizing compiler, historically built on a
  **sea-of-nodes** IR (nodes carry value, effect and control edges; no fixed instruction
  order until scheduling). Peak performance, longest compile times. V8 has been migrating
  its backend to **Turboshaft**, a more conventional CFG-based IR, largely because
  sea-of-nodes proved hard to reason about and to schedule well.

Also worth naming: **hidden classes / shapes / maps** — V8 gives every object a hidden class
describing its layout, and objects that get the same properties in the same order share one.
That is what makes an inline cache possible at all: the guard is "is this object's map the
one I saw before?", a single pointer comparison, after which the property is at a known
fixed offset. Adding properties in a different order to two otherwise-identical objects
gives them different maps and is a real, measurable performance bug in JS.

### LuaJIT, concretely

The reference tracing JIT, and worth studying because it is small enough to read.

- **Interpreter written in hand-tuned assembly** (via DynASM), one file per architecture.
  This is unusual and important: LuaJIT's *interpreter* is competitive with other languages'
  JITs, which raises the bar for when tracing is worth it.
- **Trace recording**: hot loop (back-edge counter) or hot function call triggers recording.
  The recorder emits **SSA IR in a linear, forward-only, typed format** — LuaJIT's IR is
  famously compact (each instruction is 8 bytes) and is built for linear traces, not CFGs.
- **Optimizations on the fly**, during recording: fold/CSE/constant propagation happen as
  instructions are emitted, not as separate passes. Then **loop optimization** (LOOP pass:
  unroll the trace once to separate loop-invariant hoisting from the loop body),
  **allocation sinking** and **store-to-load forwarding**.
- **Guards and side exits**: every branch, type check and bounds check the recorded path
  assumed becomes a guard. A failing guard exits to the interpreter via an **exit stub**
  that restores the interpreter's state from a snapshot. If a side exit itself gets hot,
  LuaJIT records a **side trace** starting from it and links it in, building a trace tree.
- **NaN-boxing** for the value representation, and an FFI that is fast specifically because
  the tracing compiler can inline C struct access into the trace.

Contrast to state: V8/HotSpot spend enormous engineering on profile-guided *method*
compilation with polymorphic inline caches; LuaJIT gets similar effects with far less code
by exploiting the fact that a recorded trace *is already* a specialized, inlined, monomorphic
program. The cost is the fragility described above.

### CPython's own JIT, for completeness

PEP 744, experimental in 3.13. The pipeline the release notes describe:

1. **Tier 1** — the existing specialized bytecode.
2. **Tier 2** — hot regions are translated into a **micro-op (uop) IR**, a lower-level
   linear sequence where one Tier-1 instruction expands to several uops, then optimized
   (redundant guard removal, constant propagation).
3. **Machine code** — generated by **copy-and-patch**: at *build* time, LLVM compiles each
   uop's C body to a machine-code template with holes; at *runtime* the JIT concatenates
   templates and patches in the constants. No LLVM at runtime, compilation is essentially a
   memcpy loop, and the output is roughly baseline-JIT quality. This is why it is fast to
   build and modest in payoff.

Also worth knowing for contrast: **PyPy** is a tracing JIT for Python written *in* RPython,
where the JIT is generated from an interpreter definition rather than written by hand; it
is much faster than CPython on long-running pure-Python workloads and much worse on
C-extension-heavy ones. **Cython**, **Numba** (LLVM-based, type-specializing, ahead-of-time
per-function) and **mypyc** are the AOT alternatives.

---

# Part 3 — The terminal

This is the section where confident folklore is thickest, so it is written to be precise
rather than short. The one-sentence version, to hold onto while reading the rest:

> **A "terminal" is not a program and not a window. It is a kernel object — a character
> device with an attached state machine (the line discipline) and a small amount of
> session bookkeeping — that sits between a keyboard-ish thing and a process. Everything
> people find mysterious about terminals is that state machine doing its job.**

## 3.1 What a TTY is, historically and today

**TTY is short for teletypewriter.** Before video, the operator's console was a
Teletype Model 33 ASR: an electromechanical typewriter with a keyboard, a paper roll, and
a serial current-loop connection. You typed a line, it printed as you typed it, and the
computer printed back. Almost every strange behaviour in the modern subsystem is a fossil
of that machine:

- **Carriage return and line feed are separate** because they were separate mechanical
  actions: CR slammed the carriage back to column 0, LF advanced the paper by one line.
  A "newline" needed both — hence CRLF, hence `ONLCR` translating `\n` to `\r\n` on output,
  hence the staircase effect the first time you put a terminal in raw mode and forget it.
- **The kernel echoes your keystrokes**, because the terminal itself had no idea what you
  typed was worth showing — full-duplex operation meant the *computer* decided what appeared.
  Hence `ECHO`.
- **Backspace is a mess** (`^H` vs `^?` / DEL) because a paper terminal cannot un-print,
  and different vendors picked different erase characters. Hence `stty erase` and hence
  half of all "backspace prints `^?` over ssh" bugs.
- **Flow control with `^S`/`^Q` (XOFF/XON)** existed because the printer physically could
  not keep up with the wire. It is still on by default (`IXON`), which is why an accidental
  Ctrl-S still appears to freeze a terminal in 2026. `stty -ixon` is the cure.
- **Baud rates, parity, stop bits** (`c_cflag`: `CS8`, `PARENB`, `CSTOPB`, `CLOCAL`,
  `CRTSCTS`) are RS-232 serial-line parameters, meaningless on a pty and still in the struct.
- **`SIGHUP` means "hang up"** — the modem dropped carrier because someone put the phone
  down.

Then came **video terminals**: DEC's VT52, then the **VT100** (1978), which is the reason
"ANSI escape codes" are also called "VT100 sequences." A VT100 was a physically separate
machine on a serial cable that interpreted a byte stream and drew characters on a CRT.
Its command set — cursor positioning, erase, scroll regions, attributes — was standardized
as **ANSI X3.64 / ECMA-48**, and is essentially unchanged in what your terminal emulator
speaks today.

**Today** almost nobody has a real terminal. What you have is:

- a **terminal emulator** (iTerm2, Alacritty, GNOME Terminal, Windows Terminal, tmux, or
  VS Code's panel) — an ordinary userspace program that draws a grid of glyphs;
- connected to a **pseudo-terminal (pty)** — a kernel-provided pair of devices that
  *pretends* to be a serial line;
- with the entire **tty subsystem** — line discipline, sessions, process groups, job
  control, termios — running unchanged in the kernel between them.

The subsystem survived because programs depend on it. `bash`, `vim`, `less`, `ssh`, `sudo`'s
password prompt, and every progress bar you have ever seen are written against the tty API.

## 3.2 The kernel tty subsystem

On Linux the pieces are (`drivers/tty/`):

- **`struct tty_struct`** — one per open terminal. Holds the current `termios` settings,
  the input and output queues, the **foreground process group id** (`pgrp`), the **session**
  it belongs to, and the window size (`struct winsize`: rows, cols, pixels).
- **`struct tty_driver`** — the bottom half: how bytes actually get in and out. A UART
  driver for real serial hardware, the virtual-console driver for the Linux text console,
  or the **pty driver** for a pseudo-terminal.
- **`struct tty_ldisc`** — the **line discipline**, the state machine in the middle.
- **`struct tty_port`** — carrier/hangup state, blocking-open bookkeeping.
- **flip buffers** — the lock-free-ish handoff from interrupt context (a UART ISR receiving
  a byte) to process context (where the line discipline can safely run).

**The data path, both directions:**

```
INPUT   keyboard / pty master / UART RX
          → driver pushes bytes into the flip buffer
          → ldisc->receive_buf()      ← ECHO, ERASE, ^C→SIGINT, line assembly happen HERE
          → the ldisc's read queue
          → read(2) from the process's fd 0

OUTPUT  write(2) to fd 1
          → ldisc->write()            ← OPOST / ONLCR translation happens HERE
          → driver->write()
          → UART TX / pty master / screen
```

Line disciplines are pluggable (`TIOCSETD`, `ldattach(8)`): `N_TTY` is the default and the
only one anyone meets; `N_PPP`, `N_SLIP`, `N_HDLC`, `N_GSM` turn a serial line into a
network interface instead. This is the "everything is a file, with a *policy* stacked on
it" pattern in its purest form.

## 3.3 The line discipline: canonical vs raw, and termios

### Canonical (cooked) mode — `ICANON` set

The default. The line discipline **buffers a whole line** and gives the process nothing
until the line is complete. While buffering, it implements a tiny line editor:

| Key | `c_cc` slot | Effect |
|---|---|---|
| Backspace/Delete | `VERASE` | delete previous character (and un-echo it: cursor-left, space, cursor-left) |
| `^W` | `VWERASE` | delete previous word |
| `^U` | `VKILL` | delete the whole line |
| `^R` | `VREPRINT` | redraw the line |
| `^V` | `VLNEXT` | take the next character literally (this is how you type a literal `^C`) |
| `^D` | `VEOF` | **not "EOF"** — see below |
| `^C` | `VINTR` | generate `SIGINT` to the foreground process group |
| `^\` | `VQUIT` | generate `SIGQUIT` (+ core dump) |
| `^Z` | `VSUSP` | generate `SIGTSTP` |
| `^S`/`^Q` | `VSTOP`/`VSTART` | stop/start output (only if `IXON`) |

`read(2)` returns when a line terminator arrives (`\n`, `VEOL`, `VEOF`) — **not** when the
requested byte count is reached, and never with a partial line. Linux caps a canonical line
at `N_TTY_BUF_SIZE` (4096); a longer line without a newline is delivered anyway.

**`^D` is not an end-of-file character.** It is `VEOF`, which means "deliver the current
input buffer to the process *right now*, regardless of whether a newline arrived." If the
buffer is empty, `read()` therefore returns **0 bytes**, which is exactly the syscall-level
signature of end-of-file — and that is the entire trick. This explains two behaviours that
look like bugs: pressing `^D` mid-line submits the partial line instead of ending input,
and you need `^D` twice to exit if you have typed anything.

### Raw mode — `ICANON` cleared, and friends

`read()` returns as soon as data is available, byte by byte, with no editing, no echo, no
signal generation. This is what every full-screen program uses: `vim`, `less`, `htop`,
`tmux`, and your shell's own readline (which needs per-keystroke control to do completion
and history).

**`cfmakeraw(3)` is defined as exactly this set of changes** — worth memorising because it
names every flag that matters:

```c
termios.c_iflag &= ~(IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON);
termios.c_oflag &= ~OPOST;
termios.c_lflag &= ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
termios.c_cflag &= ~(CSIZE | PARENB);
termios.c_cflag |= CS8;
```

In raw mode `read()`'s blocking behaviour is governed by two pseudo-`c_cc` slots:

| `VMIN` | `VTIME` | `read()` behaviour |
|---|---|---|
| >0 | 0 | block until at least `VMIN` bytes |
| 0 | >0 | block up to `VTIME` × 0.1 s, return whatever arrived (possibly 0) |
| >0 | >0 | inter-byte timer: block for the first byte, then `VTIME` between bytes |
| 0 | 0 | **polling** — return immediately with whatever is there |

`VMIN=1, VTIME=0` is what most TUIs want.

### The four flag words

- **`c_iflag` — input processing.** `ICRNL` (translate CR to NL on input: this is why the
  Enter key, which sends `\r` = 0x0D, arrives in your program as `\n`), `INLCR`, `IGNCR`,
  `IXON`/`IXOFF`/`IXANY` (software flow control), `ISTRIP`, `INPCK`/`IGNPAR`/`PARMRK`
  (parity), `BRKINT`/`IGNBRK` (the RS-232 break condition), `IUTF8` (so `VERASE` deletes a
  whole multibyte character).
- **`c_oflag` — output processing.** `OPOST` is the master switch; with it on, `ONLCR`
  translates `\n` to `\r\n`. Turn `OPOST` off (as `cfmakeraw` does) and your output
  staircases down and to the right, because nothing puts the cursor back to column 0.
  This is the single most common "my TUI is broken" symptom, and now it is not mysterious.
- **`c_cflag` — the serial line.** `CS8`, `PARENB`, `CSTOPB`, `CREAD`, `HUPCL` (send SIGHUP
  on last close), `CLOCAL` (ignore modem control lines), `CRTSCTS` (hardware flow control).
  Largely inert on a pty.
- **`c_lflag` — "local", i.e. the line discipline's own behaviour.** `ICANON`, `ECHO`,
  `ECHOE`/`ECHOK`/`ECHOCTL`/`ECHOKE` (echo details), `ISIG` (generate signals from
  `VINTR`/`VQUIT`/`VSUSP`), `NOFLSH` (do *not* flush the queues when generating a signal),
  `TOSTOP` (send `SIGTTOU` when a background job **writes**), `IEXTEN` (enable `VLNEXT`,
  `VDISCARD` and other extensions).

`tcgetattr`/`tcsetattr` read and write the struct. `tcsetattr`'s second argument matters:
`TCSANOW` (immediately), `TCSADRAIN` (after pending output drains — use this when changing
output settings), `TCSAFLUSH` (drain output *and discard* pending input — use this when
entering raw mode, so buffered keystrokes typed before the switch do not leak through with
the wrong interpretation). Also `tcflush`, `tcdrain`, `tcsendbreak`.

From the shell, `stty -a` prints the whole struct in human form, `stty raw -echo` /
`stty sane` / `reset` set it. `stty -a` is the fastest way to make this material concrete.

**Password prompts** are the minimal real example: `sudo` and `getpass(3)` simply clear
`ECHO`, read a line in canonical mode, and restore. That is the whole implementation, and
it explains why a password prompt interrupted at the wrong moment leaves your terminal with
echo off (fix: type `stty sane` blind, or `reset`).

## 3.4 Pseudo-terminals, and what a terminal emulator actually is

A **pty** is a pair of character devices that emulate a serial line:

- the **master** (also "pty" side, `/dev/ptmx` on Linux, `ptmx`/`ptm` generally),
- the **slave** (also "tty" side, `/dev/pts/N` on Linux, in the `devpts` filesystem).

**Bytes written to the master appear as input on the slave**, having gone through the line
discipline; **bytes written to the slave appear as output on the master**, having gone
through output processing. The slave end is a *full* tty: it has termios, a line
discipline, a foreground process group, a session, and can be a controlling terminal.
**The master end has none of that** — it is a plain byte pipe with a couple of ioctls.

### Allocating one (POSIX)

```c
int m = posix_openpt(O_RDWR | O_NOCTTY);   // opens /dev/ptmx, allocates a pair
grantpt(m);                                 // fix ownership/permissions of the slave
unlockpt(m);                                // allow the slave to be opened
char *name = ptsname(m);                    // "/dev/pts/7"
int s = open(name, O_RDWR);
```

or, in one call, `openpty(3)` / `forkpty(3)` from libutil, which is what most software uses.

### What a terminal emulator does, in full

```c
// 1. get a pty pair (above)
pid_t pid = fork();
if (pid == 0) {
    close(master);
    setsid();                       // new session; detaches from any old controlling tty
    ioctl(slave, TIOCSCTTY, 0);     // make the slave THIS session's controlling terminal
    dup2(slave, 0); dup2(slave, 1); dup2(slave, 2);
    if (slave > 2) close(slave);
    execlp("/bin/bash", "-bash", NULL);   // leading '-' => login shell
}
close(slave);
// 2. parent: the emulator proper
//    - poll(master, keyboard_events)
//    - bytes from master  -> feed to an escape-sequence parser -> update a glyph grid
//                            -> render the grid with a font rasterizer / GPU
//    - key/mouse events   -> encode to bytes (incl. escape sequences) -> write(master)
//    - window resized     -> ioctl(master, TIOCSWINSZ, &ws);  kernel then sends SIGWINCH
//                            to the slave's foreground process group
```

That is the entire architecture. **A terminal emulator is a font renderer plus an ECMA-48
state machine plus a pty.** It contains no terminal logic in the kernel sense — the kernel
still owns echo, line editing, signals and job control, which is why running `stty -echo`
affects a GUI terminal exactly as it would a VT100.

### The same shape, everywhere

- **`sshd`** allocates a pty on the *remote* machine and holds the master; the shell runs on
  the slave. Your local emulator holds a different pty locally. Keystrokes traverse:
  local keyboard → local emulator → local pty master → local `ssh` client → network →
  remote `sshd` → remote pty master → remote line discipline → remote shell.
  **Both ends have a line discipline**, which is why the `ssh` client puts the *local* tty
  into raw mode (so `^C` is sent as a byte across the network rather than killing your local
  `ssh`) and why `ssh`'s own escape character is `~.` rather than `^C`.
- **`tmux` / `screen`** allocate a pty per pane, hold the masters, and multiplex. That is
  why processes survive a detach: their controlling terminal is tmux's pty, and tmux is
  still alive holding the master, so no hangup occurs.
- **`script(1)`**, `expect`, `pexpect`, Python's `pty` module, `unbuffer`, and every CI
  system that needs colour output all exist to put a pty in the middle so the program under
  test believes it is talking to a terminal (`isatty(1)` returns 1).
- **`docker run -t`** allocates a pty; without `-t`, the container's stdout is a pipe and
  every program in it will full-buffer and disable colour.

## 3.5 Sessions, process groups, and the controlling terminal

Three nested groupings, and the source of most confusion, so state them exactly:

- **Process** — has a pid.
- **Process group (a "job")** — a set of processes with a common **pgid**, which equals the
  pid of the group leader. All processes in a pipeline are put in one process group by the
  shell. **Signals can be sent to a whole process group** (`kill(-pgid, sig)`,
  `killpg(2)`) — this is the entire point of the abstraction.
- **Session** — a set of process groups with a common **sid**, equal to the pid of the
  session leader. A session has **at most one controlling terminal**, and that terminal
  has **exactly one foreground process group**; all other groups in the session are
  background.

```
session (sid = 1000, leader = bash)
  ├── controlling terminal: /dev/pts/3
  ├── foreground process group 1042:   [ vim ]        ← gets keyboard input & ^C
  ├── background process group 1035:   [ make | tee ] ← SIGTTIN if it reads the tty
  └── background process group 1000:   [ bash ]       ← the shell itself
```

**Rules for acquiring a controlling terminal** (this is where daemons and pty allocation
live):

- `setsid(2)` creates a new session, makes the caller its leader and the leader of a new
  process group, and **detaches it from any controlling terminal**. It fails with `EPERM`
  if the caller is already a process-group leader — hence the standard idiom is
  `fork()` then `setsid()` in the child.
- A **session leader with no controlling terminal** acquires one by `open(2)`ing a terminal
  device without `O_NOCTTY` (on Linux; BSDs require the explicit `TIOCSCTTY` ioctl, which
  is why portable code always calls it).
- `O_NOCTTY` on open, or `TIOCNOTTY`, prevents/removes it. A daemon does
  `fork` → `setsid` → `fork` again (so it is not a session leader and can never
  accidentally reacquire a terminal) → `chdir("/")` → redirect fds to `/dev/null`.
- `/dev/tty` is a magic device that always refers to *the calling process's controlling
  terminal*, whatever it is. This is how `sudo`, `ssh` and `git` read a password even when
  stdin has been redirected — they open `/dev/tty` explicitly rather than trusting fd 0.
  A process with no controlling terminal gets `ENXIO`. (Verified locally: this agent's
  shell has no controlling terminal, and `stty -a < /dev/tty` failed with
  "device not configured" — a live demonstration of the same rule.)
- `tcgetpgrp(fd)` / `tcsetpgrp(fd, pgid)` (ioctls `TIOCGPGRP`/`TIOCSPGRP`) read and set the
  terminal's foreground process group. `tcgetsid(fd)` gets its session.

## 3.6 How SIGINT and SIGHUP are actually delivered

### SIGINT (and SIGQUIT, SIGTSTP)

1. You press Ctrl-C. The **emulator** converts the key event into the byte **0x03** and
   `write()`s it to the **pty master**.
2. The byte enters the slave's **line discipline**.
3. The line discipline checks `ISIG` in `c_lflag`. If clear, 0x03 is ordinary data and is
   delivered to the program. **If set**, it compares the byte to `c_cc[VINTR]`.
4. On a match, the ldisc: **discards the input and output queues** (unless `NOFLSH` is set),
   echoes `^C` if `ECHOCTL`, and calls into the signal machinery to send **`SIGINT` to every
   process in the terminal's foreground process group** — not to "the program," and not to
   the process that happens to own the terminal.

Four consequences that explain almost every Ctrl-C question:

- **`a | b | c` — all three die**, because the shell put all three in one process group and
  made that group the foreground group.
- **A background job (`./x &`) is not affected**, because it is in a different process group.
- **`nohup ./x &` and daemons cannot be Ctrl-C'd at all**, because they have no controlling
  terminal (or ignore SIGHUP), so no group membership applies.
- **`vim` and `emacs` can bind Ctrl-C** because they cleared `ISIG`; the byte reaches them
  as data. Likewise, a program that handles `SIGINT` gets a *signal*, not a keystroke, and
  cannot tell where it came from.

### SIGHUP

Generated in three distinct situations, which people routinely conflate:

1. **Hangup on the terminal.** A real modem drops carrier; on a pty, **the master end is
   closed** (you close the emulator window, or `sshd` dies). The kernel sends **`SIGHUP` to
   the foreground process group**, and to the **session leader**.
2. **The session leader terminates.** When the controlling process (typically the shell)
   exits, the kernel sends `SIGHUP` to the foreground process group of the controlling
   terminal, and disassociates the terminal from the session. This is why closing a
   terminal window kills the jobs you started in it.
3. **Orphaned process groups.** If a process group becomes *orphaned* (no member has a
   parent in a different process group but the same session) **and it contains stopped
   processes**, the kernel sends the group `SIGHUP` followed by `SIGCONT` — otherwise those
   stopped processes could never be resumed by anyone. This rule is genuinely obscure and
   is in POSIX for exactly that reason.

Defences: `nohup` (ignore SIGHUP, redirect output to `nohup.out`), `setsid` (new session, no
controlling terminal), `disown -h` (bash removes the job from its table so it does not
forward the hangup), or — the answer everyone actually uses — **run it inside `tmux`**,
whose pty master outlives your connection.

### SIGTTIN / SIGTTOU

The mechanism that stops background jobs from fighting over the keyboard:

- A **background** process group that **reads** from the controlling terminal gets
  **`SIGTTIN`**, whose default action is to stop it. That is why `cat &` immediately shows
  `[1]+ Stopped`.
- A background process group that **writes** to the controlling terminal gets **`SIGTTOU`**
  — but **only if `TOSTOP` is set in `c_lflag`**, and it usually is not. This is why
  background jobs happily scribble over your prompt by default, and why `stty tostop`
  stops them.
- **`tcsetattr`, `tcsetpgrp`, `tcflush` and friends from a background process group always
  raise `SIGTTOU`, regardless of `TOSTOP`.** This is a trap for shells and TUIs: the
  standard idiom is to block or ignore `SIGTTOU` around the call, otherwise your own job
  control implementation suspends itself.
- If the signal is blocked or ignored, the read fails with `EIO` instead.

## 3.7 Job control, from the shell's side

What `bash` actually does to implement `&`, `^Z`, `fg`, `bg` and `jobs`:

1. At startup, if interactive: loop until it is in the foreground (`tcgetpgrp(0) ==
   getpgrp()`), stopping itself with `SIGTTIN` if not; **ignore** `SIGINT`, `SIGQUIT`,
   `SIGTSTP`, `SIGTTIN`, `SIGTTOU` so the shell itself is immune; put itself in its own
   process group (`setpgid(0,0)`) and take the terminal (`tcsetpgrp(0, shell_pgid)`); save
   its own termios.
2. For each pipeline: `fork` a child per stage. **Both the parent and the child call
   `setpgid(child_pid, pgid_of_first_child)`** — deliberately duplicated, because whichever
   runs first wins and neither ordering can be relied upon. This is a real, documented race.
3. The child **resets the signal dispositions to `SIG_DFL`** before `exec` — otherwise it
   would inherit the shell's ignored `SIGINT` and be un-interruptible. (This is the actual
   cause of the classic "my program can't be Ctrl-C'd when launched from that script" bug.)
4. For a **foreground** job: `tcsetpgrp(0, job_pgid)` to hand over the terminal, then
   `waitpid(-job_pgid, &status, WUNTRACED)`.
5. On stop (`WIFSTOPPED`) or exit: `tcsetpgrp(0, shell_pgid)` to take the terminal back, and
   `tcsetattr` to restore the shell's own termios — **because the job may have left the
   terminal in raw mode.** This is why a crashed TUI wrecks your terminal but a `^Z`'d one
   does not.
6. `bg %1` = `killpg(pgid, SIGCONT)`. `fg %1` = restore the job's saved termios,
   `tcsetpgrp` to it, `killpg(pgid, SIGCONT)`, then wait.

The shell needs `SIGCHLD` handling to keep `jobs` accurate, and it must remember each
stopped job's termios so `fg`ing `vim` returns you to raw mode.

## 3.8 Escape sequences and how TUIs draw

Everything the program can do to the screen it does by writing **bytes into the same stream
as the text**, in-band. There is no second channel.

The families (ECMA-48 / ANSI X3.64):

| Introducer | Name | Examples |
|---|---|---|
| `0x00–0x1F` | **C0 controls** | `\a` bell, `\b` backspace, `\t` tab, `\n` LF, `\r` CR, `\x1b` ESC |
| `ESC [` | **CSI** — Control Sequence Introducer | the workhorse; parameters are `;`-separated decimals |
| `ESC ]` | **OSC** — Operating System Command | string payload, terminated by `BEL` or `ESC \` |
| `ESC P` | **DCS** — Device Control String | Sixel graphics, terminfo queries |
| `ESC (` / `ESC )` | charset designation | the DEC line-drawing set, `ESC ( 0` |

CSI sequences worth knowing by heart:

```
ESC [ row ; col H      CUP   — move cursor (1-based!)
ESC [ n A/B/C/D        CUU/CUD/CUF/CUB — move relative
ESC [ 2 J              ED    — erase display (0=to end, 1=to start, 2=all, 3=+scrollback)
ESC [ K                EL    — erase to end of line
ESC [ n m              SGR   — set graphic rendition: 0 reset, 1 bold, 4 underline,
                               30-37/40-47 basic colours, 90-97 bright,
                               38;5;N 256-colour, 38;2;R;G;B truecolour
ESC [ s / ESC [ u      save / restore cursor
ESC [ n S / T          scroll up / down
ESC [ t ; b r          DECSTBM — set scrolling region
ESC [ ? 25 l / h       DECTCEM — hide / show cursor
ESC [ ? 1049 h / l     alternate screen buffer on / off
ESC [ ? 2004 h / l     bracketed paste on / off
ESC [ ? 1000 h , ? 1006 h   mouse reporting, SGR extended encoding
ESC [ 6 n              DSR — ask the terminal where the cursor is; it *replies* on stdin
```

OSC sequences: `OSC 0 ; title BEL` sets the window title, `OSC 8 ; ; url ST text OSC 8 ; ; ST`
makes a hyperlink, `OSC 52` reads/writes the system clipboard, `OSC 7` reports the cwd.

Two structural facts that surprise people:

- **The terminal talks back.** `ESC[6n` (cursor position report), `ESC[c` (device
  attributes) and the OSC colour queries cause the terminal to *write bytes into your
  stdin*. Programs that query must be in raw mode and must be prepared to parse a reply
  interleaved with real user input. This is how a program discovers truecolour support or
  the current cursor row.
- **Escape sequences are in-band, so they can be injected.** `cat` a hostile binary file and
  it can retitle your window, change your colours, or (with `OSC 52` or terminals that
  implement clipboard *read*) exfiltrate data. This is a real attack class — hence `less`
  escaping control characters by default, and `cat -v`.

### How a TUI is actually built

1. `tcgetattr` to save the terminal state; register an `atexit`/signal handler to restore it.
2. `tcsetattr(TCSAFLUSH)` into raw mode (`~ICANON`, `~ECHO`, `~ISIG`, `~IXON`, `~OPOST`).
3. `ESC[?1049h` to switch to the **alternate screen buffer**, so the user's scrollback is
   untouched and reappears on exit. `ESC[?25l` to hide the cursor.
4. `ioctl(0, TIOCGWINSZ, &ws)` for the size; handle **`SIGWINCH`** to re-read it on resize.
5. Maintain an in-memory **cell grid** (character, fg, bg, attributes). Each frame,
   **diff against the previously drawn grid** and emit only the changed runs, batched into
   one `write()`. This is not an optimization detail — it is the difference between a
   smooth TUI and a flickering one, because every byte is going through a pty and,
   potentially, a network.
6. On exit: `ESC[?1049l`, show the cursor, restore termios.

**`terminfo`** is the database that says which sequences *this* terminal supports, keyed by
the `TERM` environment variable (`xterm-256color`, `screen-256color`, `tmux-256color`).
`tput setaf 1`, `tput cup 5 10`, `infocmp` are the shell-level interface; **ncurses** is the
C library that wraps all of the above including the damage-tracking redraw. `TERM` being
wrong is why colours vanish or arrow keys emit garbage over ssh — you are describing a
terminal you do not have.

## 3.9 What the shell actually does

A shell is a **read → parse → expand → execute** loop, and the vast majority of what people
attribute to "the command" is done by the shell before the command ever starts.

### Execution: fork / exec / wait

```c
pid_t pid = fork();          // clone the process; child gets a copy of everything
if (pid == 0) {
    // child: set up its world, then replace itself
    setpgid(0, pgid);
    // ... redirections, signal resets ...
    execvp("ls", argv);      // REPLACES the image; on success it never returns
    _exit(127);              // exec failed (command not found)
}
waitpid(pid, &status, 0);    // parent collects the exit status
```

The `fork`/`exec` split — rather than a single `spawn` — is *the* distinguishing UNIX design
choice, and its payoff is exactly this: **between `fork` and `exec`, the child is an
ordinary process that can freely rearrange its own file descriptors, signal handlers,
working directory, uid, resource limits and process group using the normal syscalls.**
Redirection needs no special support anywhere; it is just `dup2` in the gap. (`vfork`,
`posix_spawn` and `clone`/`CLONE_VM` exist because `fork` is expensive for large processes;
`fork` itself is cheap on Linux only because of copy-on-write page tables.)

### Redirection and pipes

Redirection is `open` + `dup2` in the child:

```c
// > out.txt
int fd = open("out.txt", O_WRONLY | O_CREAT | O_TRUNC, 0666);
dup2(fd, STDOUT_FILENO);   // fd 1 now refers to the file
close(fd);
```

A pipeline is `pipe(2)` + `dup2` + **closing the ends you do not need**:

```c
int fds[2]; pipe(fds);          // fds[0] = read end, fds[1] = write end
if (fork() == 0) {              // left-hand side: writes
    dup2(fds[1], STDOUT_FILENO);
    close(fds[0]); close(fds[1]);
    execvp("cat", ...);
}
if (fork() == 0) {              // right-hand side: reads
    dup2(fds[0], STDIN_FILENO);
    close(fds[0]); close(fds[1]);
    execvp("grep", ...);
}
close(fds[0]); close(fds[1]);   // ← THE PARENT MUST CLOSE BOTH. See §3.11.
```

Note the ordering of the standard gotcha `2>&1`: `cmd > f 2>&1` redirects stdout to `f`
*then* makes stderr a copy of the (already-redirected) stdout — both go to `f`.
`cmd 2>&1 > f` makes stderr a copy of the *terminal* first, then moves stdout — a different
result. Redirections are processed left to right, and `dup2` copies the *current* target.

### Expansion — done by the shell, not the program

In order, roughly: brace expansion → tilde expansion → parameter and variable expansion →
command substitution → arithmetic expansion → word splitting (on `IFS`) → **pathname
expansion (globbing)** → quote removal.

**Globbing is the shell's job.** `rm *.txt` never passes `*.txt` to `rm`; the shell calls
`glob(3)`/reads the directory and hands `rm` an already-expanded argv. Consequences:

- `rm *` in a directory with a file named `-rf` is a disaster, because `rm` sees a flag.
- **`ls *` in a huge directory fails with "Argument list too long"** — `E2BIG`, because
  `execve` has an `ARG_MAX` limit on the combined argv+envp (on Linux, also limited to
  1/4 of the stack rlimit, and 128 KiB per single argument). `xargs` exists precisely to
  batch below that limit; `find -exec {} +` does the same.
- If nothing matches, `bash` by default passes the pattern **through literally** (POSIX
  behaviour), which is why `ls *.foo` reports "cannot access '*.foo'". `shopt -s nullglob`
  or `failglob` change this.
- Windows programs each do their own globbing because `cmd.exe` does not; UNIX does it once,
  consistently, for every program. This is a genuine design win worth pointing out.

### Builtins vs externals

- **External**: a file on `$PATH`, found by the shell, run via `fork`+`exec`. `/bin/ls`.
- **Builtin**: implemented inside the shell process itself. No fork, no exec.

Some commands **must** be builtins, and this is the clarifying point:

- **`cd`** changes the shell's own working directory. `chdir(2)` affects only the calling
  process, so an external `cd` would change its own cwd and exit, achieving nothing.
  (`sudo cd /root` fails for exactly this reason — there is no `/usr/bin/cd` for `sudo` to
  execute. There *is* a `/bin/cd` on some systems, and it does nothing useful.)
- **`exit`, `export`, `set`, `unset`, `read`, `shift`, `source`/`.`, `ulimit`, `umask`,
  `trap`, `wait`, `jobs`/`fg`/`bg`** — all mutate shell or process state that cannot be
  changed from a child.
- Some are builtins purely for **speed** (`echo`, `test`/`[`, `printf`, `pwd`, `kill`,
  `true`/`false`) even though external versions exist in `/usr/bin`. This is why
  `echo`'s exact behaviour differs between shells and between the builtin and `/bin/echo`.

`type -a cmd`, `command -v`, and `enable` tell you which is which. The **hash table** of
resolved `$PATH` lookups (`hash -r`) is why a freshly installed binary sometimes is not
found until you rehash.

## 3.10 Why Ctrl-C is not sent by the program

Restating §3.6 as the standalone answer, because it is the question:

**The program is not involved.** When you press Ctrl-C:

1. The **terminal emulator** turns the key event into the byte `0x03` and writes it into
   the pty master.
2. The **kernel's line discipline** on the slave end reads it, sees `ISIG` is set and that
   `0x03 == c_cc[VINTR]`, and *swallows the byte*.
3. The **kernel** sends `SIGINT` to every process in the **foreground process group of that
   terminal**.

So the causal chain is keyboard → emulator → kernel → *signal* → process. The program
never receives an "interrupt character." Nothing wrote a byte to it. This is why:

- **You cannot make Ctrl-C work by reading stdin.** There is nothing to read.
- **A program that is blocked in a syscall still gets interrupted**, because signal
  delivery is a kernel mechanism independent of I/O (the syscall returns `EINTR` or is
  restarted per `SA_RESTART`).
- **The whole pipeline dies**, because signals are delivered to a process *group*.
- **A hung program that ignores or blocks `SIGINT` is immune to Ctrl-C** and you need
  `^\` (SIGQUIT, which also dumps core) or `kill -9` from another terminal.
- **Changing the interrupt key is a `stty` operation**, not a program setting:
  `stty intr ^X`.
- **In raw mode the byte is data**, which is precisely why `vim` can map `<C-c>` and why
  `stty -a` inside `vim` would show `-isig`.

## 3.11 Why `cat | grep` "deadlocks"

There are **five separate phenomena** hiding behind this complaint. Teach them apart.

### (a) It is not hanging, it is waiting for you

`cat | grep foo` with no file argument: `cat` reads **stdin**, which is still the terminal.
The pipeline is working perfectly; it is waiting for you to type. Not a bug, not a deadlock.
`^D` ends it.

### (b) The pipe is a fixed-size buffer, and both ends block

A pipe is a kernel ring buffer of finite capacity. **Measured on this machine (Darwin
arm64): 65536 bytes** — the write end accepted exactly 65536 bytes before returning
`EAGAIN` in non-blocking mode. Linux's default is also 65536 (16 pages), tunable per-pipe
with `fcntl(F_SETPIPE_SZ)` up to `/proc/sys/fs/pipe-max-size`.

- **Writer blocks** when the pipe is full.
- **Reader blocks** when the pipe is empty.
- Writes of up to `PIPE_BUF` (4096 on Linux, POSIX minimum 512) are **atomic** — they will
  not be interleaved with another writer's data. Larger writes may be split, which is why
  multiple processes appending to one pipe can produce interleaved garbage.

A **genuine deadlock** needs a *cycle*. The classic is a program that spawns a child with
both stdin and stdout as pipes and then writes a large input before reading any output:
the child's output pipe fills, the child blocks writing, so it stops reading, so the parent's
input pipe fills, so the parent blocks writing. Both are blocked forever. Every
`subprocess` tutorial warns about this, and it is why **`subprocess.communicate()` exists**
(it uses threads or `select` to drain both directions concurrently) and why
`p.stdin.write(huge); p.stdout.read()` is a bug.

### (c) The other real deadlock: not closing the write end

`read()` on a pipe returns **0 (EOF) only when every file descriptor referring to the write
end has been closed.** If a parent forks a child to write into a pipe but **forgets to
close its own copy of the write end**, the reader waits forever — because one write end is
still open, in the parent, which is never going to write anything. This is the number-one
bug in hand-written pipeline code, and it is the reason for the four `close()` calls in the
snippet in §3.9.

### (d) It is not hanging, it is buffered — the most common real cause

The C standard library chooses a buffering mode for `stdout` **based on whether it is a
terminal**:

- **stdout is a tty** → **line buffered**: flush on every `\n`.
- **stdout is anything else (a pipe, a file)** → **fully buffered**, typically 4096 bytes
  or `BUFSIZ`.
- **stderr** → **unbuffered** (POSIX requires it never be fully buffered).

So `slow_producer | grep foo` shows nothing for a long time: `slow_producer`'s libc is
sitting on up to 4 KiB of output waiting for the buffer to fill, and `grep` — which is
itself now writing to a pipe or a terminal — may add another layer. **Nothing is
deadlocked; the data has not been written yet.** The moment the producer exits, everything
appears at once.

Cures, worth knowing all of them:
`stdbuf -oL cmd`, `stdbuf -o0 cmd` (LD_PRELOAD trick, does not work on statically linked or
setuid binaries), `unbuffer cmd` (allocates a pty so libc chooses line buffering),
`grep --line-buffered`, `sed -u`, `awk` + `fflush()`, `python -u` / `PYTHONUNBUFFERED=1`,
or `setvbuf(stdout, NULL, _IOLBF, 0)` in your own code.

*Caveat: I could not demonstrate this one live — this agent's shell has no controlling
terminal, so `isatty(1)` was 0 in both the piped and unpiped cases and both runs
full-buffered identically. The mechanism is well documented (glibc `_IO_file_doallocate`,
BSD libc `__smakebuf`, both of which call `isatty`), but treat my specific claim about
buffer sizes as unverified here and check it on a real terminal.*

### (e) SIGPIPE: the pipeline that dies instead of hanging

`yes | head -1`: `head` prints one line and exits, closing the read end. `yes` then writes
into a pipe with no readers and the kernel sends it **`SIGPIPE`**, whose default action is
to kill it silently. That is the *design*: it is how a pipeline stops early without every
program having to check for it.

If a process **ignores or handles `SIGPIPE`**, the `write()` instead returns `-1` with
`errno == EPIPE`. A program that ignores `SIGPIPE` and does not check `write()`'s return
value will spin forever, and this is a common bug in servers (which must ignore `SIGPIPE`
so a dropped client socket does not kill them). It is also why `cmd | head` sometimes prints
`write error: Broken pipe` from `cmd`'s error handler — Python's `BrokenPipeError` on exit
is the most-seen instance.

---

# Part 4 — UNIX, the tradition

## 4.1 History, compressed but accurate

**Multics (1964–1969).** MIT, GE and Bell Labs build an ambitious time-sharing system:
segmented virtual memory, a hierarchical file system, dynamic linking, rings of protection,
a single-level store. It was genuinely visionary and genuinely late. **Bell Labs withdrew in
1969.** Almost everything good in UNIX is a simplification of a Multics idea, and the
project's failure mode — designing for everything at once — is the negative example the
UNIX people cited for thirty years.

**UNIX (1969).** Ken Thompson, with a cast-off **PDP-7**, wrote a file system, then a
kernel, shell, editor and assembler to support it, partly to have somewhere to run his
*Space Travel* game. **Brian Kernighan named it UNICS**, a pun on Multics (later spelled
UNIX). 1970: ported to a **PDP-11/20**, funded on the pretext of building a text-processing
system for the patent department — which is why `troff` is in the ancestry.

**The C rewrite (1972–1973).** Thompson wrote **B** (a stripped BCPL); Dennis Ritchie
evolved it into **C** by adding types and structures. In **1973, the kernel was rewritten in
C** (Fourth Edition) — roughly 10,000 lines. This is the pivotal event in the history of
systems software: it made an operating system **portable**, which had never meaningfully
been true before. The famous 1974 CACM paper (Ritchie & Thompson, *"The UNIX Time-Sharing
System"*) is short, readable, and worth assigning.

**Pipes (1973).** Doug McIlroy had been pushing since a 1964 memo for a way to
"screw programs together like garden hose." Thompson implemented pipes in one evening,
and — the part people forget — **rewrote the existing tools overnight to be filters**,
reading stdin and writing stdout. The shell syntax `|` followed immediately.

**Diffusion (1975–1979).** The **Sixth Edition (V6, 1975)** shipped to universities with
source, cheaply, because the **1956 AT&T consent decree** barred the Bell System from
selling in the computer business. John Lions' *Commentary on UNIX 6th Edition* — an
annotated listing of the entire kernel — became the most-photocopied document in computing,
and then a legal problem. **V7 (1979)** is the direct ancestor of everything that followed.

**The BSD line.** Berkeley's CSRG, with Bill Joy: **1BSD (1977)** added `ex`/`vi` and a
Pascal compiler; **3BSD (1979)** brought demand-paged virtual memory to the VAX;
**4.2BSD (1983)** is the landmark — **TCP/IP with the sockets API**, the **Fast File
System**, reliable signals, and **job control**. The internet runs on 4.2BSD's API to this
day. **4.4BSD-Lite (1994)** was released after the **USL v. BSDi** lawsuit settled, and is
the legally clean ancestor of FreeBSD, NetBSD, OpenBSD and, indirectly, macOS.

**The System V line.** AT&T commercialised: System III (1982), **System V (1983)**,
**SVR4 (1988)** — a deliberate merge of System V, BSD, SunOS and Xenix. SVR4 gave us STREAMS,
the `/proc` idea in one form, and much of the "modern" administrative layout.

**The UNIX wars and POSIX.** Through the 1980s, incompatible commercial UNIXes (SunOS,
HP-UX, AIX, Ultrix, Xenix, Irix, Digital UNIX) fragmented the market, with rival consortia
(OSF vs UNIX International). The response was standardization: **POSIX (IEEE 1003.1, first
published 1988)** specified the API, and the **Single UNIX Specification** (Open Group, from
1994) plus the trademark defined what may be *called* UNIX. Today the fully certified UNIX
systems are a short list — **macOS**, AIX, HP-UX, and a few others. **Linux is not
certified UNIX**; it is UNIX-like and POSIX-ish.

**GNU (1983–).** Richard Stallman announced the GNU Project — a complete free UNIX-compatible
system — and by 1991 had produced the userland (**gcc, Emacs, bash, coreutils, binutils,
glibc, make**) and the **GPL**, but not a working kernel (**HURD**, a Mach-based
microkernel design, never shipped in usable form).

**Linux (1991).** Linus Torvalds, a student with a 386 and a copy of **MINIX** (Tanenbaum's
teaching microkernel, 1987), posted his "just a hobby, won't be big and professional like
gnu" announcement in August 1991 and released 0.01 in September. **Relicensed to GPL at
0.12 (1992).** The pairing was accidental and decisive: GNU had a userland with no kernel,
Linux had a kernel with no userland. The **Tanenbaum–Torvalds debate (1992)** — monolithic
vs microkernel — is a good primary text on the actual engineering trade-off, and history
has been ambiguous rather than decisive about who was right.

**The "GNU/Linux" question** is exactly this history: the FSF's position is that the system
is GNU with a Linux kernel and should be named accordingly; common usage says "Linux."
Present it as a fact about attribution and history, not a fight to have.

**macOS's BSD lineage.** NeXT built **NeXTSTEP** on the **Mach** microkernel (CMU) with a
**4.3BSD** userland and Objective-C. Apple bought NeXT in 1996; **XNU** ("X is Not Unix") is
the result — a Mach core providing IPC, VM and scheduling, with a **FreeBSD-derived** BSD
layer providing the POSIX personality, all running in one kernel address space (so it is a
hybrid, not a microkernel in practice). Userland is **Darwin**, open-sourced. macOS is
**certified UNIX**, which Linux is not. Practical consequences the learner will hit:
BSD userland tools (`sed -i ''`, no `-r`, different `ps` flags), `dyld` instead of `ld.so`,
`.dylib` instead of `.so`, Mach-O instead of ELF, `DTrace`/`ktrace` instead of `strace`,
`launchd` instead of `systemd`, and `kqueue` instead of `epoll`.

**And downstream of all of it:** iOS/watchOS/tvOS (Darwin), Android (Linux kernel,
non-GNU userland), the PlayStation 4/5 (FreeBSD-derived), essentially all network
infrastructure, and WSL2 (a real Linux kernel in a VM, talking 9P — see §4.6).

## 4.2 The philosophy, stated precisely

The most-quoted version is a paraphrase. Here is the actual text.

**Doug McIlroy, in the Foreword to the UNIX issue of the Bell System Technical Journal
(McIlroy, Pinson & Tague, "UNIX Time-Sharing System: Foreword", *BSTJ* 57(6), July–August
1978, pp. 1902–1903):**

> 1. Make each program do one thing well. To do a new job, build afresh rather than
>    complicate old programs by adding new "features".
> 2. Expect the output of every program to become the input to another, as yet unknown,
>    program.
> 3. Design and build software, even operating systems, to be tried early, ideally within
>    weeks.
> 4. Use tools in preference to unskilled help to lighten a programming task.

Note what points 3 and 4 actually say — they are about **iteration speed** and about
**writing a tool rather than doing it by hand**, and they are routinely dropped from
popularisations. Point 4 in particular is the origin of the whole "software tools" culture:
if a task is repetitive, write a program, even a throwaway one.

**The compressed version** most people quote is Peter H. Salus's 1994 summary in
*A Quarter Century of UNIX*, credited to McIlroy:

> Write programs that do one thing and do it well.
> Write programs to work together.
> Write programs to handle text streams, because that is a universal interface.

Two other primary texts worth naming:

- **Kernighan & Pike, *The UNIX Programming Environment* (1984)** — still the best
  demonstration of the philosophy in practice, ending with the construction of a small
  language.
- **Pike & Kernighan, "Program Design in the UNIX Environment" (1983)** — the "`cat -v`
  considered harmful" paper. Its actual argument is sharper than the slogan: features were
  being bolted onto `cat`, `ls` and friends that belonged in separate programs, and the
  system was decaying because each program was becoming a little empire. It is the best
  single argument against the thing every codebase does.

Later systematisations — **Mike Gancarz, *The UNIX Philosophy* (1994)**, nine tenets; and
**Eric Raymond, *The Art of UNIX Programming* (2003)**, seventeen rules (Modularity,
Clarity, Composition, Separation, Simplicity, Parsimony, Transparency, Robustness,
Representation, Least Surprise, Silence, Repair, Economy, Generation, Optimization,
Diversity, Extensibility) — are useful but secondary. Raymond's **Rule of Silence** ("when
a program has nothing surprising to say, it should say nothing") is the one that
most visibly still governs how UNIX tools behave, and the one most violated by modern CLIs.

## 4.3 "Everything is a file," and where it breaks down

The claim: a small, uniform set of operations — `open`, `read`, `write`, `close`, `lseek`,
`ioctl` — applies to files, directories, devices, pipes and terminals alike, all named in
one hierarchical namespace. So `cat` works on a file, a serial port, a pipe and a keyboard,
and no program needs to know which it has.

**Where it genuinely holds and pays off:**

- Regular files, directories, symlinks.
- Character and block devices (`/dev/null`, `/dev/zero`, `/dev/urandom`, `/dev/sda`,
  `/dev/tty*`) — `dd if=/dev/sda` really is just a read.
- Pipes and FIFOs (`mkfifo`), which get a name in the filesystem.
- UNIX domain sockets have a path.
- `/proc` and `/sys` on Linux — process and kernel state as readable text.
  `cat /proc/self/maps` is a genuinely delightful demonstration.
- Redirection and `dup2` work identically on all of them, which is what makes the shell's
  composition model uniform.

**Where it breaks down** — be precise here, because the exceptions are the interesting part:

1. **`ioctl(2)` is an admission of failure.** It is an untyped, per-device, unstructured
   RPC: `ioctl(fd, REQUEST, void*)`. Everything that does not fit "a stream of bytes" is
   smuggled through it. The tty is the canonical case: `TIOCGWINSZ`, `TIOCSPGRP`,
   `TIOCSCTTY`, and the whole `termios` interface are ioctls, not reads and writes. There
   are thousands of ioctl numbers, none type-checked, all architecture-sensitive.
2. **Sockets are not in the namespace.** You cannot `open("/net/tcp/example.com:80")`. You
   need `socket()`, `bind()`, `connect()`, `listen()`, `accept()`, `setsockopt()`,
   `sendmsg()`/`recvmsg()` — an entirely separate API, added by BSD in 1983, that
   *returns* a file descriptor but is not reached through the filesystem. Network
   interfaces have no path at all.
3. **Processes are not files.** Creation is `fork`, control is `kill`/`ptrace`/`wait`,
   not writes. Linux's `/proc/<pid>/` (an idea imported from Research UNIX 8 / Plan 9)
   exposes *information*, but you still cannot start or stop a process by writing to a
   file. `pidfd_open`/`pidfd_send_signal` are a recent partial retrofit.
4. **SysV IPC has its own parallel universe** — `shmget`, `semget`, `msgget` with integer
   keys and `ipcs`/`ipcrm` to administer it. Widely regarded as a design mistake; the POSIX
   replacements (`shm_open`, `sem_open`) at least live under `/dev/shm`.
5. **Signals, timers and events are not files** — historically. Linux's answer has been to
   retrofit file descriptors onto everything: `signalfd`, `timerfd_create`, `eventfd`,
   `inotify`, `fanotify`, `epoll_create`, `userfaultfd`, `memfd_create`, `pidfd_open`,
   `io_uring`, `bpf`. Note what this tells you: **the durable abstraction turned out to be
   the file *descriptor*, not the file *path*.** "Everything is a file descriptor" is the
   accurate modern statement, and it is a weaker, more useful claim: an fd is a uniform,
   pollable, inheritable, passable (`SCM_RIGHTS`) capability handle.
6. **`mmap` bypasses the stream model entirely**, and is how all the high-performance code
   actually touches files.
7. **Even the filesystem interface leaks**: `O_DIRECT`, `fsync` semantics, extended
   attributes, ACLs, `openat`/`*at` for race-free path resolution, and the fact that a
   "path" is not a stable identifier at all under concurrent renames.

The honest teaching point: **"everything is a file" was never true; it was an aspiration
that got about 70% of the way, and the leftover 30% is `ioctl`, sockets, and a growing pile
of `*fd` syscalls.** Plan 9 is the system that took the aspiration seriously (§4.6).

## 4.4 Text streams as the universal interface

The bet: if every program reads and writes **lines of text**, then any program can be
composed with any other, forever, without either knowing the other exists.

**What it buys:**

- **Composition without coordination.** No shared type definitions, no schema registry, no
  version negotiation. A tool written in 1975 composes with one written in 2026.
- **Inspectability.** You can put `| tee /tmp/x` anywhere in a pipeline and look at the
  intermediate state. Debugging a pipeline is trivial; debugging an object graph is not.
- **A universal, already-known toolkit.** Because the format is text, `grep`, `sed`, `awk`,
  `sort`, `cut` and `join` apply to *everything* — logs, config, program output, source code.
- **The escape from N×M.** Without a universal format, every pair of tools needs a converter.

**Where it hurts, stated fairly:**

- **Parsing is fragile and re-done everywhere.** `ls | grep` breaks on filenames containing
  spaces or newlines (both legal on UNIX). The standard fix — `find -print0 | xargs -0` and
  `IFS=` discipline — is an admission that the interface has no delimiters. Shell quoting
  bugs are the single largest source of shell-script security holes.
- **No types, so no checking.** `sort` on a column of numbers needs `-n` and will silently
  do the wrong thing without it. Nothing catches it.
- **Output formats are UI, not API, and they drift.** `ls -l` is not a specification.
  This is why POSIX mandates specific output for a few tools and why everyone else's
  scripts break on upgrades.
- **Human formatting and machine formatting conflict.** Colour codes, column alignment and
  pagination all corrupt the stream, which is why tools check `isatty(1)` and behave
  differently when piped (see §3.11d) — a violation of the very uniformity being claimed.

**The alternatives, and what they concede:** PowerShell pipes **.NET objects** (typed,
introspectable, no parsing — but now both ends must share a type system and a runtime).
`jq` + JSON is the pragmatic middle ground, and the modern convention of `--json` flags on
CLI tools is text-streams-with-a-schema. `nushell` pipes structured tables. Each buys
safety and pays with coupling. The critique from the other side is collected, entertainingly
and often unfairly, in *The UNIX-HATERS Handbook* (1994).

### The standard toolkit

Worth having a learner actually learn, in this grouping:

- **Filters that transform**: `cat`, `tr`, `sed`, `awk`, `cut`, `paste`, `rev`, `expand`,
  `fold`, `fmt`, `nl`.
- **Filters that select**: `grep` (whose name is literally the `ed` command `g/re/p` —
  *globally* search for a *regular expression* and *print*), `head`, `tail`, `uniq`,
  `comm`, `join`.
- **Filters that reorder/aggregate**: `sort`, `uniq -c`, `wc`, `tac`, `shuf`, `tsort`.
- **Plumbing**: `tee`, `xargs`, `yes`, `true`/`false`, `time`, `nohup`, `env`, `timeout`,
  `stdbuf`.
- **Finding things**: `find`, `locate`, `which`/`type`, `file`, `stat`.
- **Comparing and patching**: `diff`, `patch`, `cmp`, `md5sum`/`sha256sum`.
- **Building**: `make`, `ar`, `nm`, `objdump`, `readelf`, `strings`, `ldd`, `strace`/`dtrace`.
- **Archiving and bytes**: `tar`, `dd`, `od`/`xxd`, `split`, `gzip`.

The classic exercise is still the best one: **McIlroy's six-line word-frequency pipeline**,
written in response to Donald Knuth's several-page literate-programming solution to the same
problem in 1986 —

```sh
tr -cs A-Za-z '\n' | tr A-Z a-z | sort | uniq -c | sort -rn | sed 10q
```

Jon Bentley published both in *Programming Pearls*; Knuth's was a beautiful custom
data structure, McIlroy's was six existing programs. Both are correct; the comparison is the
whole argument of this section in one page.

## 4.5 Why pipes were revolutionary

Not "because they are convenient." Three specific things happened at once:

1. **They made "do one thing well" economically viable.** A tool that does one thing is
   *useless* if combining tools requires temporary files, explicit sequencing, and cleanup.
   Before pipes, the pressure was always toward monoliths — a program had to do everything
   because getting data between programs was expensive. Pipes inverted the incentive.
   McIlroy's principle 1 and principle 2 are only compatible *because* of pipes.
2. **They introduced a general composition operator into an operating system.** Function
   composition existed in mathematics and in Lisp. Putting it in the *shell*, applying to
   *processes*, with a one-character syntax, is what made it a cultural fact rather than a
   language feature. `|` is arguably the most successful piece of syntax ever designed.
3. **They gave concurrency and flow control for free, and nobody noticed.** A pipeline's
   stages run **simultaneously**, as separate processes, on separate cores, with
   **automatic backpressure**: a fast producer blocks when the buffer fills, a fast consumer
   blocks when it empties. That is a bounded-buffer dataflow network with backpressure —
   the thing streaming systems (Akka Streams, Reactive Streams, Kafka consumers, Go
   channels) rediscovered and re-marketed decades later. `cat huge | grep x | sort` is a
   three-stage parallel pipeline, and no one writing it thinks of it as concurrent
   programming. That is the highest compliment an abstraction can be paid.

Also non-obvious: pipes are **anonymous and unnamed**, so there is nothing to clean up,
nothing to collide, and no security surface — compared to the temporary-file approach they
replaced, which had all three problems (and `mktemp` races are still a CVE category).

## 4.6 Plan 9 — the road not taken

Built at Bell Labs from the late 1980s by the people who built UNIX (Rob Pike, Ken Thompson,
Dennis Ritchie, Dave Presotto, Phil Winterbottom, Howard Trickey). Its premise: UNIX's core
idea was right and UNIX itself did not follow it far enough, and the world had moved from
one minicomputer with terminals to **networks of heterogeneous machines**.

**The three ideas:**

1. **Everything really is a file, with no `ioctl`.** Not "mostly." Every resource is
   presented as a small file tree by a **file server**, and control is done by writing
   *text commands to a `ctl` file* while data flows through a `data` file. Concretely:
   - **The network is a filesystem.** To open a TCP connection you `open("/net/tcp/clone")`,
     read your connection number, write `connect 192.168.1.1!80` to `ctl`, and then read
     and write `data`. No `socket()`, no `connect()`, no `setsockopt()`. You can make a
     network connection **from a shell script**, and you can `import` another machine's
     `/net` and make connections *from its network location*.
   - **Processes are a filesystem.** `/proc/<pid>/ctl` accepts `stop`, `start`, `kill`;
     `/proc/<pid>/mem` is the address space; a debugger is an ordinary program that reads
     and writes files, with no `ptrace` at all.
   - **Graphics and input are files.** `/dev/draw`, `/dev/mouse`, `/dev/cons`. The window
     system, `rio`, is a *file server* that serves a private `/dev/cons`, `/dev/mouse` and
     `/dev/draw` to each window — which is why a window and a terminal and a remote
     session are the same object, and why `rio` can run inside `rio`.
2. **Per-process private namespaces.** There is no single global filesystem tree. Every
   process has **its own mount table**, built with `bind` and `mount`, and it inherits and
   can modify it. Combined with **union directories** (`bind -a /arm/bin /bin` overlays one
   directory onto another), this replaces `$PATH`, `chroot`, `LD_LIBRARY_PATH`, and most
   configuration. **Linux mount namespaces — i.e. containers — are this idea, reinvented
   around 2002–2013 and still less general.**
3. **9P: one protocol for everything.** A simple, stateful RPC protocol (`Tversion`,
   `Tattach`, `Twalk`, `Topen`, `Tread`, `Twrite`, `Tclunk`) that any file server speaks.
   Because *all* resources are file servers, **any resource can be exported over the
   network transparently** — `import` a remote machine's `/net`, `/dev`, or `/proc` and use
   it as your own. Distribution is not a feature; it falls out. The security layer
   (`factotum`, `secstore`) is likewise a file server.

**What actually escaped and won:**

- **UTF-8.** Designed by **Ken Thompson and Rob Pike in September 1992** — famously
  sketched on a placemat in a New Jersey diner — specifically so Plan 9 could be
  Unicode-native without breaking C strings. It is self-synchronising, ASCII-compatible, and
  has no byte-order problem. It is now the encoding of the web and of essentially all
  modern software. This alone justifies the project.
- **`/proc`** as a filesystem, into Linux and the BSDs.
- **9P itself**, still very much alive: **WSL2**, **QEMU/KVM virtio-9p**, Docker for Mac's
  early file sharing, and `v9fs` in Linux.
- **Namespaces**, as Linux mount/PID/net namespaces and therefore containers.
- **`rfork`** → Linux's `clone(2)` flags model.
- **The language lineage**: Alef → Limbo → **Go**. Go's CSP concurrency, its interfaces,
  `gofmt`, the fast compiler and the standard-library-first culture all descend directly
  from Plan 9, and several of Go's designers (Pike, Thompson, Griesemer) are the same
  people. Go is arguably Plan 9's most successful product after UTF-8.
- **Content-addressed storage** ideas from Venti, visible in git's object store lineage.

**Why it did not win.** Not for technical reasons, and it is worth being blunt: it arrived
after UNIX had achieved critical mass; the licence was not free until 2000 (Open Source
licence 2002, MIT-licensed 2014, now under the Plan 9 Foundation); it had almost no
applications and would have required rewriting everything; and its own creators said so.
**Rob Pike's 2000 talk "Systems Software Research is Irrelevant"** is the primary document
on this — his argument being that the industry had standardised on UNIX and Windows to the
point where new systems research had no path to users. The lesson for a curriculum is not
"Plan 9 was better" but: **an ecosystem beats an architecture, and good ideas escape from
failed systems one at a time.**

---

# Part 5 — Curriculum: six units in dependency order

Each unit is stated as **the one idea it delivers**. Prerequisites are strict where marked.
The ordering starts with the environment the learner is already sitting in (the terminal),
moves to how programs are launched and composed (the shell, and the tradition that follows
from it), and only then opens the compiler — front, middle, back — and finishes with the
systems that defer compilation to runtime.

### Unit 1 — The terminal is a kernel object
*Prereq: Linux syscalls, signals, processes (already covered elsewhere in this curriculum).*

> **The idea:** the thing between your keyboard and your program is neither the program nor
> the window — it is a kernel state machine with settable flags, and every "weird terminal
> behaviour" is that state machine doing exactly what it was told.

Covers §3.1–3.8: TTY history and why the fossils are still in the struct; the kernel tty
subsystem and its data path; the line discipline; canonical vs raw mode and every `termios`
flag that matters; `^D` is `VEOF`, not EOF; pty master/slave and what a terminal emulator
actually is; sessions, process groups, the controlling terminal and `/dev/tty`; how `SIGINT`,
`SIGHUP` and `SIGTTIN`/`SIGTTOU` are generated and to whom they are delivered; job control;
ANSI/VT100 escape sequences and how a TUI draws.

Deliverable: a ~150-line TUI in C or Python that enters raw mode, switches to the alternate
screen, handles `SIGWINCH`, draws a diffed frame, and **restores the terminal on every exit
path including a crash**.

### Unit 2 — The shell forks, and the tradition follows from that
*Prereq: Unit 1.*

> **The idea:** almost everything you attribute to "the command" — globbing, redirection,
> pipes, job control, `$PATH` lookup — is the **shell** performing syscalls in the gap
> between `fork` and `exec`, before the command has run a single instruction. UNIX's
> philosophy is a *consequence* of that gap being open.

Covers §3.9–3.11 and all of Part 4: `fork`/`exec`/`wait` and why the split exists;
`pipe(2)` + `dup2` and the four closes; redirection order and `2>&1`; the expansion
pipeline and why globbing is the shell's job (`ARG_MAX`, `xargs`, `nullglob`); builtins vs
externals and why `cd` cannot be external; why Ctrl-C is not sent by the program; the five
distinct causes of a "hung" pipeline. Then the history (Multics → the C rewrite → BSD/SysV →
POSIX → GNU/Linux → Darwin), McIlroy's actual four points, "everything is a file" and its
`ioctl`/socket/`*fd` failure modes, text streams and their real costs, why pipes were
revolutionary, and Plan 9 as the completed version.

Deliverable: a shell in ~400 lines that handles pipelines of arbitrary length, `<`/`>`/`>>`,
`&`, and correct job control (`^Z`, `fg`, `bg`) with `setpgid` in both parent and child and
`tcsetpgrp` handover. Then: read `/proc/self/status` for the pgid/sid and confirm the theory
from Unit 1 against a running instance.

### Unit 3 — Source text to syntax tree
*Prereq: C++ (the learner already has it — C++ *is* the motivating example here).*

> **The idea:** a grammar describes syntax; a real language's syntax depends on its own
> semantics, so a production parser is a parser **plus a symbol table** plus a pile of
> disambiguation rules that live in the standard's prose, not in its grammar.

Covers §1.1–1.5: the phase structure and why representations rather than actions; lexing and
where it stops being regular (the C preprocessor's translation phases, Python's
`INDENT`/`DEDENT`, C++'s `>>`); recursive descent and Pratt parsing vs LR/LALR, with the
honest trade-off table; **why C++ needs more than a CFG** — the typedef/lexer hack, the most
vexing parse, dependent names and `typename`, and template instantiation being
Turing-complete; the AST and why clang keeps a sugar-preserving one; semantic analysis, name
resolution, overload resolution, `constexpr` evaluation, flow-sensitive checks.

Deliverable: exercise E3 below (a Pratt parser property-tested against a reference), plus
reading a real `clang -Xclang -ast-dump` of a ten-line C++ file and identifying every
`ImplicitCastExpr` the compiler inserted that the source did not contain.

### Unit 4 — SSA and the middle-end
*Prereq: Unit 3; x86-64 assembly.*

> **The idea:** if every value has exactly one definition, then "where did this value come
> from?" stops being a whole-program dataflow problem and becomes a pointer dereference —
> and that single change is what makes industrial optimization tractable.

Covers §1.6–1.9: three-address code, basic blocks, the CFG; **SSA, φ nodes, dominance
frontiers**, and the five concrete reasons SSA makes analyses sparse and transformations
safe; SSA construction and destruction (and the lost-copy/swap problems); the classic passes
— constant folding and SCCP, DCE, GVN, **inlining as the enabling transformation**, LICM,
unrolling, vectorization (loop vs SLP, and what blocks it), strength reduction; then what
LLVM actually is — LLVM IR's three forms, opaque pointers, metadata and attributes,
`undef`/`poison`/`freeze`, the frontend/middle-end/backend split, the New Pass Manager and
the CGSCC bottom-up inlining order; then **MLIR** — operations/dialects/regions, progressive
lowering, shaped types, and why every ML compiler (Triton, IREE, XLA, Torch-MLIR)
converged on it. Tie directly to the learner's CUDA background via Triton's
`Triton → TritonGPU → NVVM → PTX` lowering.

Deliverable: exercise E5 below — read the LLVM IR for a loop, identify every φ node, and
explain the induction-variable widening.

### Unit 5 — The back end, the contract, and the linker
*Prereq: Unit 4; x86-64 assembly.*

> **The idea:** an optimization level does not change what your program *means* — it changes
> **how much of what you told the compiler it is allowed to believe**. Undefined behaviour
> is not the compiler being malicious; it is the compiler cashing in a promise you made.

Covers §1.10–1.12: instruction selection (tree pattern matching, SelectionDAG vs GlobalISel,
TableGen patterns); instruction scheduling and why it matters less on an out-of-order core;
**register allocation via graph colouring** — interference graph, simplify/coalesce/spill/
select, spill cost heuristics, pre-coloured ABI registers, and why JITs use linear scan
instead; then the exact `-O0/-O1/-O2/-O3/-Os/-Og/-Ofast` flag tables from the GCC manual;
then the UB section — **strict aliasing changing program output**, **signed overflow making
loops faster**, `-fdelete-null-pointer-checks` and CVE-2009-1897, `-ffinite-loops`,
`-fwrapv` vs `-fsanitize=undefined`; then the linker in full — sections, symbol
binding/visibility, archive ordering, COMDAT and the ODR, relocation types, static vs
dynamic, GOT/PLT/lazy binding/RELRO, symbol interposition and `-fvisibility=hidden`,
symbol versioning, and **LTO** (monolithic vs ThinLTO, plus PGO and BOLT).

Deliverable: exercises E1, E2 and E4 below.

### Unit 6 — Interpreters, bytecode and deciding at runtime
*Prereq: Units 4 and 5 (you must understand what a compiler gives up before you can see what
a JIT buys).*

> **The idea:** an interpreter trades away ahead-of-time optimization in exchange for
> knowing what actually happened — and a JIT is the machine that spends that knowledge,
> guarded by checks it can undo.

Covers all of Part 2: tree-walking vs bytecode VM vs JIT; stack vs register VMs; **CPython
in depth** — the PEG parser, code objects, `.pyc` as a parse cache and not an optimization,
the eval loop, computed-goto dispatch and why it helps the branch predictor, the 3.14
tail-call interpreter, `PyObject` and reference counting and what that costs in cache
traffic, the cycle collector; **the GIL** — exactly what it protects, exactly what it does
not, and the four reasons it is hard to remove, with PEP 703's biased refcounting +
immortal objects + deferred refcounting answer; the version-by-version table (3.11 PEP 659,
3.12 bytecode DSL and per-interpreter GIL, 3.13 free-threading + JIT, 3.14 official
free-threading + tail calls); **the specializing adaptive interpreter** mechanism —
quickening, inline caches embedded in the bytecode, families, guards, de-specialization;
then **JIT mechanics** — method vs tracing, tiering, OSR, and **deoptimization with its
machine-state-to-interpreter-state maps**; then V8 (Ignition/Sparkplug/Maglev/TurboFan,
hidden classes and inline caches) and LuaJIT (assembly interpreter, trace recording, guards,
side traces, snapshots).

Deliverable: exercise E6 below, plus a bytecode VM for the expression language from Unit 3 —
compile the AST to a stack machine and write the dispatch loop, then measure it against the
tree-walker.

---

# Part 6 — Machine-checkable exercises

## The harness

Every compiler exercise below runs against the **Compiler Explorer API**, which compiles
*and* runs C/C++, shows assembly at every `-O` level, emits LLVM IR through
`clang -emit-llvm -S`, and disassembles Python bytecode for CPython 3.5–3.14 and PyPy.
This file was verified against it. Save as `ce.py`:

```python
import json, urllib.request

def ce(src, compiler="cg152", args="-O2", execute=False, lang=None):
    """POST to Compiler Explorer. compiler ids: cg152 (gcc 15.2 C), cclang2110
    (clang 21.1.0 C), g152/clang2110 (C++), python310..python314, pypy311.
    lang: 'c', 'c++', 'python', 'rust', 'llvm', 'go'."""
    body = {
        "source": src,
        "options": {
            "userArguments": args,
            "compilerOptions": {"executorRequest": execute, "skipAsm": execute},
            "filters": {"binary": False, "commentOnly": True, "demangle": True,
                        "directives": True, "execute": execute, "intel": True,
                        "labels": True, "libraryCode": True, "trim": True},
            "tools": [], "libraries": [],
        },
        "lang": lang, "allowStoreCodeDebug": True,
    }
    req = urllib.request.Request(
        f"https://godbolt.org/api/compiler/{compiler}/compile",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    return json.load(urllib.request.urlopen(req))

def asm(r):  return "\n".join(l.get("text", "") for l in (r.get("asm") or []))
def out(r):  return "\n".join(x["text"] for x in (r.get("stdout") or []))
def code(r): return r.get("code")
```

Useful endpoints: `GET /api/compilers/<lang>?fields=id,name,semver` lists compiler ids,
`GET /api/languages` lists languages. Everything is plain JSON over HTTPS, no key needed;
be polite about request volume.

---

## E1 ⭐ — Undefined behaviour changes the answer

**Unit 5. This is the single highest-value exercise in the document.**

**Setup.** Give the learner this program and nothing else:

```c
#include <stdio.h>
int f(int *i, float *g) { *i = 1; *g = 0.0f; return *i; }
int main(void) { int x = 0; printf("%d\n", f(&x, (float*)&x)); return 0; }
```

**Task.**
1. *Before running anything*, predict the output. Write the prediction down.
2. Run it at `-O0`, `-O2`, and `-O2 -fno-strict-aliasing`.
3. Explain the difference by reading the assembly at each level: find the instruction that
   is present at `-O0` and absent at `-O2`.
4. Answer: which of the three outputs is correct?
5. Rewrite `f` so it is well defined and still does what was intended, and verify the fixed
   version gives the same answer at all three optimization levels.

**Verified reference answer** (gcc 15.2 via the API, executed):

| flags | output |
|---|---|
| `-O0` | `0` |
| `-O2` | `1` |
| `-O2 -fno-strict-aliasing` | `0` |

The missing instruction at `-O2` is the **reload of `*i`** after the store through `g`; GCC
keeps the `1` in a register because C's effective-type rule says an `int` object cannot be
accessed through a `float` lvalue, so the two pointers are assumed not to alias. **The
correct answer to (4) is "none of them" — the program has undefined behaviour, so no output
is wrong.** The fix is `memcpy` (or C++20 `std::bit_cast`), which compilers pattern-match to
zero instructions.

**Auto-check:**

```python
exp = {"-O0": "0", "-O2": "1", "-O2 -fno-strict-aliasing": "0"}
for flags, want in exp.items():
    r = ce(SRC, "cg152", flags, execute=True, lang="c")
    assert out(r).strip() == want, (flags, out(r))
print("E1 reference behaviour reproduced")
```

**Extension:** repeat with `cclang2110`. If clang agrees, that is a *coincidence of two
implementations*, not a specification — make the learner say that out loud.

---

## E2 ⭐ — Signed overflow is why your loops are fast

**Unit 5.**

**Setup.**

```c
int      inc_gt_s(int x)          { return x + 1 > x; }
unsigned inc_gt_u(unsigned x)     { return x + 1 > x; }
void stride_s(int *a, int n)      { for (int i = 0;      i < n; i++) a[i*4] = 0; }
void stride_u(int *a, unsigned n) { for (unsigned i = 0; i < n; i++) a[i*4] = 0; }
```

**Task.** Compile at `-O2` (gcc 15.2, Intel syntax) and answer, from the assembly alone:
1. How many instructions is `inc_gt_s`? How many is `inc_gt_u`? Why the difference?
2. In `stride_s`, what width is the induction variable, and where did the multiply go?
3. In `stride_u`, why is the index recomputed every iteration with `lea edx,[0+rax*4]`?
4. One of the two loops is unrolled. Which, and why is unrolling *not* legal-and-profitable
   for the other?
5. Re-run `stride_s` with `-O2 -fwrapv` and describe exactly what you lose.

**Verified reference answer** (gcc 15.2, `-O2`):

```asm
inc_gt_s:  mov eax, 1
           ret
inc_gt_u:  xor eax, eax
           cmp edi, -1
           setne al
           ret
```

`inc_gt_s` is **two instructions and always returns 1**: signed overflow is UB, therefore
`x != INT_MAX`, therefore `x+1 > x`. `inc_gt_u` must actually test, because unsigned wraps
and `0xFFFFFFFF + 1 == 0`.

`stride_s` sign-extends `n` once (`movsx rsi, esi`), computes the end pointer, and walks it
with `add rdi, 32` / two stores — a **64-bit induction variable**, the multiply
**strength-reduced into the pointer increment**, and the loop **unrolled 2× with a peeled
iteration** (the `and esi,16` / `je .L6` preamble). All of that requires proving `i` never
wraps, which is only true because signed overflow is UB.

`stride_u` keeps a 32-bit `eax`, recomputes `lea edx,[0+rax*4]` every iteration and is not
unrolled: `i*4` may legally wrap modulo 2³², so the address sequence is not an affine
function of the iteration count and none of the above transformations apply.

**Auto-check:** assert `"mov eax, 1"` appears in `inc_gt_s`'s body and does not appear in
`inc_gt_u`'s; assert `movsx` appears in `stride_s` and not in `stride_u`.

---

## E3 ⭐ — A recursive-descent parser, property-tested against a reference

**Unit 3. No network needed; runs anywhere.**

**Task.** Write a **Pratt (precedence-climbing) parser** — by hand, no parser generator, no
`eval` — for this grammar:

```
expr    := integer | '(' expr ')' | '-' expr | expr op expr
op      := '+' | '-' | '*' | '/' | '%' | '**'
precedence (low → high): + -   <   * / %   <   unary -   <   **
associativity: + - * / % left;  ** right;  unary - prefix
```

It must produce an AST, and a `to_sexpr()` that renders it, e.g.
`1 - 2 - 3` → `(- (- 1 2) 3)` and `2 ** 3 ** 2` → `(** 2 (** 3 2))`.

**Why this grammar:** it is exactly Python's arithmetic precedence, so **Python's own
`ast` module is a free reference implementation** — and it contains the two classic
associativity traps (`-` is left-associative, `**` is right-associative *and binds tighter
than unary minus*, so `-2 ** 2 == -4`).

**Machine check — differential property test:**

```python
import ast, random, operator

def ref_sexpr(src):                      # reference: CPython's own parser
    def go(n):
        if isinstance(n, ast.Expression): return go(n.body)
        if isinstance(n, ast.Constant):   return str(n.value)
        if isinstance(n, ast.UnaryOp):    return f"(neg {go(n.operand)})"
        if isinstance(n, ast.BinOp):
            o = {ast.Add:"+", ast.Sub:"-", ast.Mult:"*", ast.Div:"/",
                 ast.Mod:"%", ast.Pow:"**"}[type(n.op)]
            return f"({o} {go(n.left)} {go(n.right)})"
        raise AssertionError(n)
    return go(ast.parse(src, mode="eval"))

def gen(depth=0):                        # random well-formed expressions
    if depth > 3 or random.random() < 0.3: return str(random.randint(1, 9))
    r = random.random()
    if r < 0.15: return f"-{gen(depth+1)}"
    if r < 0.30: return f"({gen(depth+1)})"
    return f"{gen(depth+1)} {random.choice('+-*/%')} {gen(depth+1)}"

random.seed(0)
for _ in range(2000):
    src = gen()
    assert my_parse(src).to_sexpr() == ref_sexpr(src), src
print("E3 parser agrees with CPython on 2000 random expressions")
```

Structural comparison (not value comparison) is deliberate: it catches an associativity bug
in `1-2-3` even when the two readings happen to evaluate the same, and it catches
precedence bugs that a value test would mask.

**Verified**: I implemented this exercise and ran the checker. A Pratt parser with the
binding-power table

```python
BP = {"+":(10,11), "-":(10,11), "*":(20,21), "/":(20,21), "%":(20,21), "**":(41,40)}
UNARY_BP = 30     # looser than ** on its right, tighter than * on its left
```

agrees with `ast.parse` on **2000/2000** random expressions without `**`, and on
**2000/2000** with `**` included. Note the two asymmetries that make it work and that a
naive implementation gets wrong: `**` has `lbp > rbp` (right associativity), and unary
minus recurses with a binding power *below* `**`'s right power, which is why `-2 ** 2`
parses as `-(2**2)` and not `(-2)**2`.

**Extensions, in order of value:**
1. Add `**` to the generator and watch the naive left-associative loop fail.
2. Add error recovery: on a syntax error report the **column** and the token you expected.
   Compare your message to CPython's for the same broken input.
3. Add a `,`-separated call syntax and discover that you now need a *statement* level.
4. Introduce a `typedef`-like declaration form so that `A * B;` is ambiguous, and implement
   the lexer hack. This is the moment §1.3 stops being abstract.

---

## E4 — The `-O0` → `-O2` delta, explained line by line

**Unit 5.**

**Setup.** A function small enough to read completely at both levels:

```c
int sum3(int *a) {
    int s = 0;
    for (int i = 0; i < 3; i++) s += a[i];
    return s * 2;
}
```

**Task.** Compile at `-O0`, `-O1`, `-O2`, `-O3` and `-Os` with gcc 15.2, then answer:
1. At `-O0`, where do `s` and `i` live? Count the loads and stores. Why does the compiler
   refuse to keep them in registers?
2. At `-O1`, the loop is gone. Name the transformation. Is the trip count known?
3. Where did `* 2` go, and what instruction replaced it?
4. Which level first removes the frame pointer setup (`push rbp; mov rbp, rsp`)? Which
   flag from the §1.10 table is responsible?
5. Diff `-O2` against `-Os`. If they are identical, construct a function where they are not
   (hint: something that would be unrolled or aligned).
6. Now change the loop bound from `3` to a parameter `n`, and re-run all five. What survives?

**Auto-check:**

```python
prev = None
for o in ["-O0", "-O1", "-O2", "-O3", "-Os"]:
    a = asm(ce(SRC, "cg152", o, lang="c"))
    n = len([l for l in a.splitlines() if l.strip() and not l.strip().endswith(":")])
    print(f"{o:5} {n:3} instructions")
    if prev is not None: assert n <= prev, "instruction count should not grow -O0 -> -O1"
    prev = n if o == "-O0" else prev
```

The point of the exercise is item 1: **at `-O0` every variable is a stack slot, reloaded
before every use and stored after every assignment**, because `-O0` must let a debugger stop
anywhere and show correct values. Once the learner sees that, `-O0` assembly stops being
noise and starts being a readable transcript of the source.

---

## E5 — Read the SSA

**Unit 4.**

**Setup.** `cclang2110`, args `-O1 -emit-llvm -S -fno-discard-value-names`, on:

```c
int sum_signed(int *a, int n)      { int s=0; for (int i=0;i<n;i++)      s+=a[i]; return s; }
int sum_unsigned(int *a, unsigned n){ int s=0; for (unsigned i=0;i<n;i++) s+=a[i]; return s; }
```

**Task.** From the emitted IR alone:
1. Find every `phi`. For each, say which variable in the C source it corresponds to and why
   a φ is needed at that exact block.
2. `%s.0.lcssa` is a φ with no loop — what is it for? (Answer: LCSSA form, so that every use
   outside the loop goes through a single definition at the exit, which makes loop
   transformations local.)
3. The C source says `int i`. What type is `%indvars.iv`? Explain the transformation and
   the *language rule* that permits it.
4. What do `nsw`, `nuw`, `zext nneg` and `inbounds` assert? For each, name the C-level
   undefined behaviour that justifies it.
5. What do `noundef`, `readonly` and `captures(none)` on the parameters tell a caller's
   optimizer?
6. Re-run with `-O1 -fwrapv` and diff. Then re-run at `-O3` and find the vector body.

Reference IR for `sum_signed` is reproduced in §1.6 and was produced by exactly this
invocation.

---

## E6 ⭐ — Python bytecode: predict the stack, then watch it specialize

**Unit 6.**

### Part A — predict the stack effects

**Task.** For each snippet, *before running `dis`*, write out the instruction sequence and
the operand-stack depth **after every instruction**. Then check with
`dis.dis(f, show_caches=True)` and `f.__code__.co_stacksize`. Your predicted maximum depth
must equal `co_stacksize`.

```python
def a(x, y):     return x * y + 1
def b(xs):       return [i*i for i in xs if i % 2]
def c(d, k):     d[k] += 1; return d
def e(x):
    try:    return 1 / x
    except ZeroDivisionError: return 0
def g(n):        return sum(i for i in range(n))
```

Things the learner should be forced to explain: why `c` needs `COPY`/`SWAP` instructions
(`d[k] += 1` must evaluate `d` and `k` once but use them twice — the in-place add is not
`d[k] = d[k] + 1`); why `b` creates a **nested code object** and a `MAKE_FUNCTION` on
3.11 and earlier but is *inlined* in 3.12+ (PEP 709); why `e` has **no setup instruction on
the happy path** in 3.11+ (zero-cost exceptions — the handler lives in a side table keyed by
instruction offset, printable with `dis.dis(e, show_caches=True)` and
`e.__code__.co_exceptiontable`); and why `g` produces a generator whose body is a separate
code object.

### Part B — watch specialization happen live

**Verified on CPython 3.14.7:**

```python
import dis
def hot(a, b): return a + b

dis.dis(hot)                          # cold
for _ in range(1000): hot(1, 2)
dis.dis(hot, adaptive=True)           # hot
```

| | body |
|---|---|
| cold | `RESUME` / `LOAD_FAST_BORROW_LOAD_FAST_BORROW (a,b)` / `BINARY_OP 0 (+)` / `RETURN_VALUE` |
| hot | **`RESUME_CHECK`** / `LOAD_FAST_BORROW_LOAD_FAST_BORROW (a,b)` / **`BINARY_OP_ADD_INT`** / `RETURN_VALUE` |

**Tasks.**
1. **Find the warmup threshold** by bisection — the smallest number of calls after which
   `BINARY_OP_ADD_INT` appears. (Measured on 3.14.7: `RESUME_CHECK` after **1** call,
   `BINARY_OP_ADD_INT` after **2**. Do not trust this number on another build; measure it.)
2. **Force a de-specialization**: after warming with ints, call `hot("a", "b")` repeatedly
   and watch the instruction change to `BINARY_OP_ADD_UNICODE` or fall back to the adaptive
   form. Explain the saturating-counter policy from PEP 659 that produced what you saw.
3. **Show that `.pyc` does not contain the specialization.** Delete `__pycache__`, import a
   module, warm a function, then compare `f.__code__.co_code` with the bytes in the `.pyc`.
   Conclude what a `.pyc` actually is.

### Part C — the version archaeology (uses the CE API)

Compile `def add(a, b): return a + b` on `python310`, `python311`, `python313`, `python314`
and explain each change. **Verified reference:**

| Version | body |
|---|---|
| 3.10 | `LOAD_FAST a` / `LOAD_FAST b` / `BINARY_ADD` / `RETURN_VALUE` |
| 3.11 | `RESUME` / `LOAD_FAST a` / `LOAD_FAST b` / `BINARY_OP 0 (+)` / `RETURN_VALUE` |
| 3.13 | `RESUME` / `LOAD_FAST_LOAD_FAST (a,b)` / `BINARY_OP 0 (+)` / `RETURN_VALUE` |
| 3.14 | `RESUME` / `LOAD_FAST_BORROW_LOAD_FAST_BORROW (a,b)` / `BINARY_OP 0 (+)` / `RETURN_VALUE` |

Questions: why did ~20 type-specific binary opcodes collapse into one generic `BINARY_OP`
in 3.11, when that is *more* work at runtime? What is a superinstruction and what does it
save? What does `BORROW` mean and which cost from §2.2 does it attack? At module level,
what happened to `LOAD_CONST 'add'` before `MAKE_FUNCTION` between 3.10 and 3.11?

---

## E7 — Two smaller ones worth including

**E7a — Relocations, before and after the linker (Unit 5).** Compile `int main(){ puts("hi"); }`
to an object file, then `objdump -dr a.o`. Find the `call` with operand `0` and the
`R_X86_64_PLT32 puts-4` relocation beside it. Link it, disassemble again, and find the same
`call` now pointing at a PLT stub. Then `readelf -r a.out` and identify the
`R_X86_64_JUMP_SLOT`. Finally, run with `LD_DEBUG=bindings` and watch lazy binding resolve
`puts` on first call; then relink with `-Wl,-z,now` and watch it happen at startup instead.

**E7b — The pipeline that is not deadlocked (Unit 2).** Write a C program that prints one
line per second forever with `printf`, and a Python one with `print`. Run each (i) straight
to the terminal, (ii) piped to `cat`, (iii) piped to `cat` under `stdbuf -oL`, (iv) piped to
`cat` under `unbuffer`. Explain all sixteen results in terms of `isatty(3)` and libc's
buffering choice, and identify which of the five causes in §3.11 each one is. Then
`strace -e write` one of them and count the actual `write(2)` calls.

---

# Part 7 — What I could not verify

Read this before teaching anything above as settled.

1. **The stdio line-vs-full buffering demonstration (§3.11d).** I wrote and ran a C program
   that prints, sleeps, prints, both directly and through a pipe. **The demo did not
   discriminate**, because this agent's shell has no controlling terminal: `isatty(1)`
   returned **0 in both cases**, so both runs full-buffered identically. The mechanism is
   well documented (glibc `_IO_file_doallocate` and BSD libc `__smakebuf` both call
   `isatty()` and choose `_IOLBF` vs `_IOFBF`), and the fix list is standard, but
   **the specific default buffer sizes I quote (4096 / `BUFSIZ`) are recalled, not measured.**
   Verify on a real terminal before teaching.
2. **Pipe capacity.** Measured **65536 bytes on Darwin 27.0.0 / arm64**. Linux's default is
   also 65536 (16 pages) and tunable with `fcntl(F_SETPIPE_SZ)` up to
   `/proc/sys/fs/pipe-max-size` — but **I did not verify the Linux numbers from here.**
   `PIPE_BUF` (the atomic-write guarantee) is 4096 on Linux and 512 on macOS by POSIX
   minimum; also not verified here.
3. **Everything in Part 3 about kernel internals** (`tty_struct`, `tty_ldisc`, flip buffers,
   `N_TTY_BUF_SIZE = 4096`, the exact hangup and orphaned-process-group rules) is from
   documentation and recall, **not from reading the kernel source in this session**.
   The behaviour claims are solid and well attested; the *structure names and constants*
   should be checked against the kernel you are teaching against, since `drivers/tty/`
   has been refactored several times.
4. **The job-control sequence in §3.7** is the standard idiom (it matches the GNU libc
   manual's "Implementing a Job Control Shell" chapter and every real shell), but I did not
   read bash's `jobs.c` to confirm bash does it in exactly this order.
5. **PEP 659's specialization thresholds.** I measured **1 call** for `RESUME → RESUME_CHECK`
   and **2 calls** for `BINARY_OP → BINARY_OP_ADD_INT` on **CPython 3.14.7 specifically**.
   PEP 659 mentions "~2000" only in a 3.10-era comparison. These counters have changed every
   release. **Do not quote a threshold; measure it.**
6. **The Gilectomy "≈2× single-threaded slowdown" figure** is from Larry Hastings' talks
   (2016–2017) and is recalled, not re-verified. The 3.14 free-threading figure
   ("roughly 5-10%") *is* verbatim from the 3.14 release notes.
7. **The computed-goto 15–20% speedup** is the historically quoted figure from the CPython
   issue that introduced it (bpo-4753, 2009-era). I did not re-measure it, and it will not
   hold on a modern CPU with a better indirect-branch predictor. The 3.14 tail-call figure
   (3–5% geomean) *is* verbatim from the release notes.
8. **V8 numbers** (+45%/+41% for Sparkplug, ~10×/10× compile-speed ratios for Maglev) are
   verbatim from V8's own Maglev blog post, which is a vendor source reporting on its own
   benchmarks. Treat as directional.
9. **LuaJIT internals** (8-byte IR instructions, the LOOP pass, allocation sinking, side
   traces) are from recall of Mike Pall's documentation and the LuaJIT wiki. I did not fetch
   a primary source this session.
10. **The `-Os` row of the GCC table.** The manual's own wording is slightly self-contradictory
    (it says `-Os` "enables all `-O2` optimizations except those that often increase code
    size" and then separately lists `-finline-functions` as enabled). I reproduced what the
    page says; the exact behaviour is version-dependent and best checked with
    `gcc -Q --help=optimizers -Os`, which prints the actual enabled set. **Teach that command
    rather than the table.**
11. **Clang's `-O` levels** are described here only by contrast with GCC's. I did not fetch
    clang's documentation, and clang's `-O1`/`-O2` contents differ meaningfully (and it has
    `-Oz`). Do not present the GCC table as universal.
12. **The `ARG_MAX` details** (128 KiB per argument, 1/4 of the stack rlimit for the total)
    are recalled from `execve(2)`; not verified here. `getconf ARG_MAX` and
    `xargs --show-limits` give the real numbers on the target system.
13. **Historical dates and attributions in Part 4** are from well-established secondary
    sources (Salus, the Ritchie/Thompson CACM paper, the BSTJ issue, standard histories).
    The **McIlroy four-point quotation and its citation, and the Salus three-line summary,
    were verified this session**. The rest — the "one evening" pipe implementation, the
    UTF-8 diner placemat, the 1956 consent decree's role — are the standard accounts and are
    very likely correct, but I did not verify each individually.
14. **MLIR.** The dialect list, progressive-lowering story and the block-arguments-vs-φ
    quotation were verified against `mlir.llvm.org/docs/Rationale/Rationale/`. The claim that
    Triton lowers `Triton → TritonGPU → LLVM/NVVM → PTX` is recalled and not verified here.
15. **Register allocation.** LLVM's default allocator being `greedy` (a priority-based
    allocator with live-range splitting, not classical Chaitin–Briggs) and GCC's being LRA
    are recalled. The graph-colouring algorithm itself is standard and safe to teach.
16. **CVE-2009-1897** (`tun_chr_poll`, `-fdelete-null-pointer-checks`) is the standard
    reference for that class of bug and I am confident in it, but I did not fetch the CVE.

### Verification log for what *was* checked

- Compiler Explorer API, live, 2026-09-01: the strict-aliasing output table (§1.11),
  the signed/unsigned assembly listing (§1.11), the `clang -emit-llvm` SSA listing (§1.6),
  the four-version Python bytecode table (§2.2), and the compiler/language listings.
- Local CPython 3.14.7: `dis` output, `sys.getsizeof` values, `sys.getrefcount`, the live
  specialization transition, and the warmup-threshold bisection.
- Local: pipe capacity probe (65536), and the failed `/dev/tty` open confirming §3.5's
  `ENXIO` rule.
- Local: the E3 Pratt parser and its differential property test against `ast.parse`,
  2000/2000 matching with and without `**`.
- Fetched primary sources: the GCC 15.2 optimize-options page, the Python 3.13 and 3.14
  "What's New" pages, PEP 659, V8's Maglev post, the MLIR rationale, Linus Åkesson's
  "The TTY demystified", and the Unix-philosophy citation of BSTJ 57(6) pp. 1902–1903.

---

# Sources

**Verified this session (fetched or executed):**

- [Compiler Explorer](https://godbolt.org) — API used live; endpoints
  `POST /api/compiler/<id>/compile`, `GET /api/compilers/<lang>`, `GET /api/languages`.
  [API docs](https://github.com/compiler-explorer/compiler-explorer/blob/main/docs/API.md)
- [GCC 15.2 — Options That Control Optimization](https://gcc.gnu.org/onlinedocs/gcc-15.2.0/gcc/Optimize-Options.html)
  — the per-`-O`-level flag lists in §1.10 are taken from this page.
- [PEP 659 — Specializing Adaptive Interpreter](https://peps.python.org/pep-0659/)
- [What's New in Python 3.13](https://docs.python.org/3.13/whatsnew/3.13.html) —
  PEP 703 free-threading, PEP 744 JIT, build flags and caveats.
- [What's New in Python 3.14](https://docs.python.org/3.14/whatsnew/3.14.html) —
  PEP 779, the tail-call interpreter, the 3–5% and 5–10% figures.
- [V8 — Maglev, V8's Fastest Optimizing JIT](https://v8.dev/blog/maglev)
- [MLIR Rationale](https://mlir.llvm.org/docs/Rationale/Rationale/)
- [Linus Åkesson — The TTY demystified](http://www.linusakesson.net/programming/tty/index.php)
- [Unix philosophy](https://en.wikipedia.org/wiki/Unix_philosophy) — used for the McIlroy
  citation; the primary source it cites is McIlroy, Pinson & Tague, "UNIX Time-Sharing
  System: Foreword", *Bell System Technical Journal* 57(6), July–August 1978, pp. 1902–1903.

**Primary and canonical, cited from knowledge (not re-fetched this session):**

*Compilers*
- Aho, Lam, Sethi & Ullman, *Compilers: Principles, Techniques, and Tools*, 2nd ed. ("the
  Dragon Book") — lexing, parsing, dataflow, codegen.
- Cooper & Torczon, *Engineering a Compiler*, 3rd ed. — the better modern textbook; SSA and
  register allocation chapters especially.
- Muchnick, *Advanced Compiler Design and Implementation* — the pass reference.
- Cytron, Ferrante, Rosen, Wegman & Zadeck, "Efficiently Computing Static Single Assignment
  Form and the Control Dependence Graph", *TOPLAS* 13(4), 1991 — the dominance-frontier
  algorithm.
- Wegman & Zadeck, "Constant Propagation with Conditional Branches", *TOPLAS* 13(2), 1991 — SCCP.
- Chaitin et al., "Register Allocation via Coloring", *Computer Languages* 6, 1981;
  Briggs, Cooper & Torczon, "Improvements to Graph Coloring Register Allocation",
  *TOPLAS* 16(3), 1994.
- Poletto & Sarkar, "Linear Scan Register Allocation", *TOPLAS* 21(5), 1999.
- Lattner & Adve, "LLVM: A Compilation Framework for Lifelong Program Analysis &
  Transformation", CGO 2004.
- Lattner et al., "MLIR: Scaling Compiler Infrastructure for Domain Specific Computation",
  CGO 2021.
- [LLVM Language Reference](https://llvm.org/docs/LangRef.html) ·
  [LLVM Passes](https://llvm.org/docs/Passes.html) ·
  [Writing an LLVM Pass (New PM)](https://llvm.org/docs/WritingAnLLVMNewPMPass.html)
- Nuno Lopes et al. on `undef`/`poison`/`freeze` — "Taming Undefined Behavior in LLVM", PLDI 2017.
- Chris Lattner, "What Every C Programmer Should Know About Undefined Behavior"
  (LLVM blog, 3 parts, 2011) — still the best single introduction to §1.11.
- Levine, *Linkers and Loaders* — the linker chapter's source.
- Ulrich Drepper, "How To Write Shared Libraries" — GOT/PLT, visibility, symbol versioning.
- [ELF specification](https://refspecs.linuxfoundation.org/elf/elf.pdf) and the
  [System V x86-64 psABI](https://gitlab.com/x86-psABIs/x86-64-ABI) — relocation types.
- [Itanium C++ ABI](https://itanium-cxx-abi.github.io/cxx-abi/abi.html) — name mangling, COMDAT.
- Teresa Johnson et al., "ThinLTO: Scalable and Incremental LTO", CGO 2017.
- Nikolic et al., "BOLT: A Practical Binary Optimizer for Data Centers", CGO 2019.

*Interpreters and VMs*
- Nystrom, *Crafting Interpreters* (craftinginterpreters.com) — the tree-walker/bytecode-VM
  progression in Units 3 and 6 is essentially this book's structure.
- Smith & Nair, *Virtual Machines: Versatile Platforms for Systems and Processes*.
- CPython source: `Python/ceval.c`, `Python/bytecodes.c`, `Python/specialize.c`,
  `Include/object.h`, `Objects/obmalloc.c`.
- PEPs: [552](https://peps.python.org/pep-0552/) (deterministic `.pyc`),
  [617](https://peps.python.org/pep-0617/) (PEG parser),
  [659](https://peps.python.org/pep-0659/) (specializing interpreter),
  [669](https://peps.python.org/pep-0669/) (monitoring),
  [683](https://peps.python.org/pep-0683/) (immortal objects),
  [684](https://peps.python.org/pep-0684/) (per-interpreter GIL),
  [703](https://peps.python.org/pep-0703/) (free-threading),
  [709](https://peps.python.org/pep-0709/) (inlined comprehensions),
  [744](https://peps.python.org/pep-0744/) (JIT),
  [779](https://peps.python.org/pep-0779/) (free-threading officially supported).
- Brandt Bucher & Larry Hastings on copy-and-patch JIT; Xu & Kjolstad,
  "Copy-and-Patch Compilation", OOPSLA 2021 — the technique PEP 744 uses.
- Dave Beazley, "Understanding the Python GIL" (PyCon 2010) and "Inside the Python GIL".
- V8 blog: [Ignition/TurboFan launch](https://v8.dev/blog/launching-ignition-and-turbofan),
  [Sparkplug](https://v8.dev/blog/sparkplug), [Maglev](https://v8.dev/blog/maglev),
  [Turboshaft](https://v8.dev/blog/holiday-season-2023).
- Mike Pall, LuaJIT documentation and the [LuaJIT wiki](http://wiki.luajit.org/) —
  the IR, trace recording, and the assembly interpreter.
- Bolz et al., "Tracing the Meta-Level: PyPy's Tracing JIT Compiler", ICOOOLPS 2009.
- Hölzle, Chambers & Ungar, "Debugging Optimized Code with Dynamic Deoptimization",
  PLDI 1992 — the origin of deoptimization; and "Optimizing Dynamically-Typed
  Object-Oriented Languages with Polymorphic Inline Caches", ECOOP 1991.

*Terminals*
- Kerrisk, *The Linux Programming Interface*, chapters 34 (Process Groups, Sessions and Job
  Control), 62 (Terminals) and 64 (Pseudoterminals) — the definitive treatment, and already
  cited elsewhere in this curriculum.
- [`termios(3)`](https://man7.org/linux/man-pages/man3/termios.3.html) ·
  [`tty_ioctl(4)`](https://man7.org/linux/man-pages/man4/tty_ioctl.4.html) ·
  [`pty(7)`](https://man7.org/linux/man-pages/man7/pty.7.html) ·
  [`credentials(7)`](https://man7.org/linux/man-pages/man7/credentials.7.html) ·
  [`setsid(2)`](https://man7.org/linux/man-pages/man2/setsid.2.html) ·
  [`pipe(7)`](https://man7.org/linux/man-pages/man7/pipe.7.html)
- POSIX.1-2024 / [Open Group Base Specifications, "General Terminal Interface"](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap11.html)
  — the normative source for canonical mode, `c_cc`, `VMIN`/`VTIME`, and job-control signals.
- [GNU libc manual — "Implementing a Job Control Shell"](https://www.gnu.org/software/libc/manual/html_node/Implementing-a-Shell.html)
  — the §3.7 sequence.
- [ECMA-48, 5th edition](https://ecma-international.org/publications-and-standards/standards/ecma-48/)
  and [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)
  — the escape-sequence reference everyone actually uses.
- Antirez, [`kilo`](https://github.com/antirez/kilo) and Paige Ruten's
  ["Build Your Own Text Editor"](https://viewsourcecode.org/snaptoken/kilo/) — the best
  possible Unit 1 deliverable walkthrough; it teaches every `termios` flag by needing it.
- Linux kernel: `drivers/tty/n_tty.c`, `drivers/tty/tty_io.c`, `drivers/tty/pty.c`.

*UNIX*
- Ritchie & Thompson, "The UNIX Time-Sharing System", *CACM* 17(7), July 1974.
- McIlroy, Pinson & Tague, "UNIX Time-Sharing System: Foreword", *BSTJ* 57(6), 1978,
  pp. 1899–1904.
- Kernighan & Pike, *The UNIX Programming Environment*, 1984.
- Pike & Kernighan, "Program Design in the UNIX Environment", 1983 ("`cat -v` considered harmful").
- Salus, *A Quarter Century of UNIX*, 1994.
- Kernighan, *UNIX: A History and a Memoir*, 2019 — the readable modern account.
- McKusick, Neville-Neil & Watson, *The Design and Implementation of the FreeBSD Operating
  System* — for the BSD lineage and, by extension, Darwin.
- Raymond, *The Art of UNIX Programming*, 2003 (the seventeen rules).
- Bentley, Knuth & McIlroy, "Programming Pearls: A Literate Program" and McIlroy's response,
  *CACM* 29(6), 1986 — the word-frequency comparison in §4.4.
- Pike, Presotto, Dorward, Flandrena, Thompson, Trickey & Winterbottom,
  ["Plan 9 from Bell Labs"](https://9p.io/sys/doc/9.html) and
  ["The Use of Name Spaces in Plan 9"](https://9p.io/sys/doc/names.html).
- Pike & Thompson, ["Hello World"](https://9p.io/sys/doc/utf.html), USENIX 1993 — the UTF-8 paper.
- Rob Pike, ["Systems Software Research is Irrelevant"](https://doc.cat-v.org/bell_labs/utah2000/),
  2000.
- Tanenbaum–Torvalds debate, comp.os.minix, 1992 (reprinted in *Open Sources*, 1999).
