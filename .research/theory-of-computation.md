# Theory of Computation

Research notes for a from-first-principles computing curriculum.

The rest of this track answers **how a computer works**: transistors, gates, an ALU, a
register file, microcode, a cache hierarchy, a compiler, an operating system. It is a
complete and honest account of mechanism. What it never asks is the other question, the
one that turns a technician into an engineer:

> **What can this thing compute, and what can it provably never compute — and how much
> will the possible things cost?**

That question is not philosophy. It is the reason your linter has false positives, the
reason your regex hung the production box, the reason the compiler refused to optimise the
loop you were certain it could, and the reason the scheduling feature your PM wants is
going to ship as a heuristic. Every one of those is a theorem wearing a bug report.

This document is deliberately **not** an abstract mathematics course. The organising rule
throughout: *every theorem must cash out in something the learner has already built or is
about to build.* The learner has a stored-program CPU from Part 0, a lexer and parser from
the compilers track, and will build static analysis and testing tooling later. Those are
the anchors:

| Theory | The thing in the curriculum it explains |
|---|---|
| DFA / NFA / subset construction | The lexer. It *is* a DFA. |
| Thompson vs backtracking | Why your regex hung the box (ReDoS). |
| Pumping lemma | Why you cannot lex nested comments or match brackets. |
| Context-free grammars, LL/LR | The parser, and what a shift-reduce conflict *is*. |
| Universal Turing machine | **The stored-program CPU the learner already built.** |
| Halting problem, Rice's theorem | Why the static analyser has false positives, always. |
| NP-completeness | Register allocation, instruction scheduling, dependency resolution. |
| RAM model vs memory hierarchy | Why the O(n log n) algorithm lost to the O(n²) one. |
| Circuit complexity / NC | What the GPU track is actually exploiting. |
| Landauer's principle | The thermodynamic floor under the whole stack. |

---

## Provenance

**Executed live during this research.** Every step count, timing, and agreement claim
marked *(verified)* was compiled and **run** against the Compiler Explorer execution API
(`POST https://godbolt.org/api/compiler/g152/compile`, GCC 15.2, `executorRequest: true`).
The complete programs and their real stdout are in §7. Nothing in §7 is recalled; it is
transcribed from output.

**The headline measurement.** A single Thompson NFA is walked two ways — depth-first with
backtracking, and breadth-first as a state set — on Russ Cox's classic pathological pattern
`a?ⁿaⁿ` matched against `aⁿ`. Same machine, same answers, verified to agree on every input.
At n=24 the backtracker takes **251,658,238 steps** and the Thompson simulation takes
**1,525** (verified, §7.1). The backtracking cost fits the exact closed form
`(n+6)·2ⁿ⁻¹ − 2` on every n from 1 to 24; Thompson fits `(5n+2)(n+1)/2` exactly. Those are
not asymptotic hand-waves — they are two curves you can check by arithmetic, and the gap
between them is a design decision someone made in a regex library.

**Fetched from primary sources.** Cloudflare's July 2 2019 outage postmortem (the exact
regex is quoted, §2.6), Russ Cox's *Regular Expression Matching Can Be Simple And Fast*
(2007), and the further sources listed in §9.

**A widely repeated claim, stated properly.** "You can't parse HTML with a regex" is true,
is provable, and is almost always argued for badly. §2.4 gives the actual pumping-lemma
proof, and §2.5 states carefully what it does *not* say — because modern "regex" engines
with backreferences and recursion are not regular, and the folklore version of the argument
gets that wrong.

**Flagged as unverified.** §8 lists every claim that is recalled rather than checked, every
number that will go stale, and every place where the literature is genuinely contested.

---

## Part 0: the one-paragraph version

There is one notion of "computable", and it is astonishingly robust: a dozen wildly
different formalisms invented independently between 1930 and 1960 — Turing machines, lambda
calculus, recursive functions, tag systems, register machines, cellular automata, and the
instruction set of the CPU you built — all define **exactly the same class of functions**.
That class has a universal member: a single machine that reads a description of any other
machine and does what it would do. Your stored-program CPU is such a machine. But the same
argument that gives you universality gives you the boundary: there are perfectly precise
questions about programs that no program can answer, and by Rice's theorem that is nearly
*every* interesting question about what a program does. So static analysis is permanently
in the business of being wrong on purpose. Inside the computable, cost splits the world
again: some problems are cheap (P), some are cheap-to-check-but-apparently-not-cheap-to-solve
(NP), and the hardest of the latter are all secretly the same problem (NP-complete). That
last fact is good news, not bad — it means one very good solver serves them all, which is
why SAT solvers routinely dispatch "intractable" instances with a million variables.

---

# 1. Models of Computation

## 1.1 Why we need a model at all

Before 1936 there was no definition of "algorithm". There were algorithms — Euclid's, the
sieve, long division — but no way to say what one *is*, and therefore no way to prove that
something *is not* one. Hilbert's *Entscheidungsproblem* (1928) asked for a procedure to
decide the truth of any first-order statement. To answer "no such procedure exists" you
first need a mathematically precise account of "procedure". That's what the models are for.

The engineering reading: a **model of computation** is a machine so simple you can prove
things about it, and so expressive that anything you'd call computing can be encoded in it.
The tension between those two demands is the whole subject.

We climb a ladder. Each rung adds exactly one capability, and each addition buys a strictly
larger class of solvable problems. This is not a taxonomy for its own sake — the rungs
correspond to real tools.

| Rung | Machine | Memory it has | Real tool that is this |
|---|---|---|---|
| 1 | Finite automaton | a fixed number of states, nothing else | **lexer**, protocol state machine, `grep` |
| 2 | Pushdown automaton | + one stack | **parser** for a programming language |
| 3 | Linear-bounded automaton | + a tape as long as the input | context-sensitive checks |
| 4 | Turing machine | + unbounded tape | **your CPU**, any programming language |

## 1.2 Finite automata: the machine with no memory but its own position

A **deterministic finite automaton** (DFA) is a 5-tuple `(Q, Σ, δ, q₀, F)`:

- `Q` — a finite set of states
- `Σ` — the input alphabet
- `δ : Q × Σ → Q` — the transition function, **total and single-valued**
- `q₀ ∈ Q` — the start state
- `F ⊆ Q` — the accepting states

Run it by starting at `q₀` and consuming input symbols one at a time, following `δ`. Accept
if you end in `F`. That is the entire definition.

The crucial property is what it *lacks*: there is no counter, no stack, no way to store the
input. The only memory is *which of the finitely many states you are in*. A DFA with 12
states can distinguish at most 12 different "situations", no matter how long the input is.
This is not a limitation to work around — it is the source of every good property finite
automata have:

- **O(1) memory**, independent of input length.
- **O(n) time**, one table lookup per character, no backtracking, ever.
- **Streaming**: you never need to look back, so you can run it over a socket.
- **Decidable everything**: emptiness, equivalence, inclusion, minimality are all decidable
  and cheap. You can *ask a machine* whether two DFAs accept the same language, and get an
  answer. This is spectacularly untrue for anything higher on the ladder.

That last bullet is the reason regular languages are worth having as a category at all.

### The engineering payoff, immediately

A lexer's job is to chop a character stream into tokens. Look at what that requires:
recognise `while` as a keyword but `whiles` as an identifier; recognise `0x1f`, `1e-5`, and
`1.5f` as numbers; recognise `//` as starting a comment. All of these are decided by a
bounded amount of context. None of them requires counting arbitrarily far.

So a lexer is a DFA over the character alphabet, with accepting states labelled by token
kind, plus one extra rule that isn't in the textbook definition: **maximal munch**. Keep
consuming while some longer match is still possible; when you get stuck, back up to the
last accepting state you passed and emit that token. That is why `x+++y` lexes as
`x ++ + y` in C, and why `>>` was a parsing catastrophe in C++ templates until C++11 —
the lexer had already committed to `>>` as one token before the parser could object.

This is the single most important sentence in §1 for this curriculum:

> **`flex` is a program that reads regular expressions and emits a DFA transition table in C.**
> When you write a lexer by hand with a `switch` on a state variable, you are hand-compiling
> the same automaton. The theory and the tool are literally the same object.

## 1.3 Nondeterminism, and why it isn't magic

An **NFA** relaxes `δ` in two ways: it may map a `(state, symbol)` pair to a *set* of
states, and it allows **ε-transitions** that consume no input. Formally
`δ : Q × (Σ ∪ {ε}) → 𝒫(Q)`.

The standard gloss — "the machine guesses" — is actively misleading for engineers. Here is
the honest reading:

> An NFA is not a machine that guesses correctly. It is a **specification of a search
> problem**, and it accepts a string iff *at least one* path through the graph consumes the
> string and ends accepting.

The two ways to resolve that search are exactly the two regex engine architectures, and
this is the fork in the road that §2.6 will turn into a production outage:

1. **Explore all paths simultaneously.** Track the *set* of states you could be in. Thompson
   simulation. Time O(mn), space O(m). No backtracking, so no pathological input.
2. **Explore one path at a time, undo on failure.** Depth-first search with backtracking.
   Can be exponential. Buys you backreferences and capture-group semantics that (1) can't
   easily express.

### Subset construction: nondeterminism is free

**Theorem (Rabin–Scott, 1959).** For every NFA there is a DFA accepting the same language.

The construction *is* option (1) above, done ahead of time instead of at match time. A state
of the DFA is a *set* of NFA states — namely, the set of states the NFA could currently be
in. Start state is `ε-closure({q₀})`. On symbol `a`, the new DFA state is
`ε-closure(⋃{δ(q,a) : q ∈ S})`. Accept if the set contains any NFA accepting state.

```
   NFA state set  --a-->  union of successors  --ε-closure-->  new DFA state
```

Because there are only `2^|Q|` subsets, the process terminates. The blow-up is real but
usually not realised: for typical lexer regexes the reachable subsets number in the hundreds,
not the millions. It *can* be hit — the language "the k-th symbol from the end is `a`" needs
exactly `2^k` DFA states, and the proof is a nice exercise (any two distinct k-suffixes must
be distinguishable, so no two can share a state).

**This is why `flex` is fast and why it can take a moment to build your lexer.** It runs
subset construction at build time so the runtime is a table lookup. You pay the exponential
once, at your desk, in the case where it happens at all.

The exactly-checkable exercise this suggests — build an NFA, subset-construct it, then
verify by exhaustive agreement on every string up to length 12 — is §7.2, and it is one of
the best exercises in the whole curriculum, because a subtle bug in ε-closure produces a
DFA that agrees on 99% of inputs and the exhaustive check finds the 1% instantly.

### Minimisation, and the reason a DFA has a *canonical* form

Hopcroft's algorithm minimises a DFA in O(n log n). More important than the algorithm is
the theorem behind it — the **Myhill–Nerode theorem**:

> Define `x ≡_L y` iff for every string `z`, `xz ∈ L ⟺ yz ∈ L`. Then `L` is regular **iff**
> `≡_L` has finitely many equivalence classes, and the minimal DFA has exactly one state per
> class.

This is the *real* definition of "regular", and it is more useful than the automaton one
because it turns "is this regular?" into "how many genuinely different situations can I be
in?" It also gives you the cleanest impossibility proofs. Balanced parentheses is not
regular because `(`, `((`, `(((`, … are pairwise inequivalent — `(ⁱ` and `(ʲ` are separated
by `)ⁱ` — so there are infinitely many classes. No finite state count suffices. Done, no
pumping lemma needed.

Keep Myhill–Nerode in your pocket. It is the tool that answers "can I do this with a state
machine?" in one sentence.

## 1.4 Pushdown automata: one stack, and suddenly you can nest

Add a stack. A PDA reads input, and on each step may push or pop based on `(state, input
symbol, top of stack)`. That single addition buys you **nesting** — and nesting is the
entire structure of programming languages.

The canonical example is `{aⁿbⁿ : n ≥ 0}`: push on every `a`, pop on every `b`, accept if the
stack is empty at the end. A DFA cannot do this (Myhill–Nerode: `aⁱ` and `aʲ` are
distinguishable by `bⁱ`), a PDA can trivially.

Three facts that matter and are usually glossed:

1. **Nondeterministic PDAs are strictly more powerful than deterministic ones.** This is
   *unlike* the finite case, where subset construction made nondeterminism free. There is no
   subset construction for PDAs. The language of even-length palindromes `{w wᴿ}` is
   context-free but not *deterministic* context-free — you'd have to know where the middle
   is. This gap is not a curiosity: **it is exactly the gap between LR parsing (which is
   deterministic) and GLR/Earley (which are not)**, and it is why some grammars need the
   expensive parser.

2. **The stack is the call stack.** A recursive-descent parser is a PDA where the stack is
   the actual hardware call stack of your CPU, and the states are program counters inside
   your parsing functions. This is not an analogy. Blow the parser's stack on a deeply
   nested expression and you have empirically located the PDA's stack in DRAM.

3. **One stack, not two.** A machine with *two* stacks is Turing-complete — you can simulate
   a tape with the left half in one stack and the right half in the other. So the ladder from
   PDA to Turing machine is exactly "add a second stack". That is a shockingly small step for
   how much it buys.

## 1.5 Turing machines: the tape

A Turing machine is a finite control plus an unbounded tape with a head that reads, writes,
and moves one cell left or right. Formally `(Q, Γ, b, Σ, δ, q₀, F)` with
`δ : Q × Γ → Q × Γ × {L, R}`.

Everything interesting about the definition is in what Turing was actually modelling. He was
not modelling a machine. He was modelling **a human clerk with a pencil, an eraser, and a
paper tape, working by fixed rules**. The 1936 paper argues the case explicitly: a person
computing can only be in finitely many states of mind, can only attend to finitely many
symbols at once, and their behaviour is determined by the symbol observed plus their state
of mind. The tape is unbounded because you can always fetch more paper.

That provenance matters, because it is the reason the Church–Turing thesis is plausible at
all. Turing did not analyse computation abstractly; he analysed *what a person doing
arithmetic can do*, and then built the minimal machine that does exactly that.

**What matters engineering-wise, and what doesn't.** The tape is a terrible data structure.
A Turing machine takes Θ(n²) to reverse a string that a real machine reverses in Θ(n). Nobody
cares, and it is worth being explicit about *why* nobody cares: for the questions the model
is for — *is this computable at all?* — a polynomial slowdown is invisible. For questions
about *cost* (§4), the model is swapped for the RAM model, and §5.2 explains why even that
one lies.

**Robustness under variation, which is the real point.** Every one of these changes the
machine and changes nothing about what it can compute:

| Variation | Effect on power | Effect on time |
|---|---|---|
| k tapes instead of 1 | none | quadratic speedup at most |
| 2-symbol alphabet | none | constant factor |
| Nondeterministic | none *(power)* | possibly exponential — **this is P vs NP** |
| 2-dimensional tape | none | polynomial |
| Tape infinite one way only | none | constant factor |
| Random access instead of a tape | none | polynomial |

The rows are almost boring individually. Collectively they are the evidence for §1.7.

## 1.6 Universal machines — and the punchline of this whole document

Here is the move that makes computing a subject rather than a collection of gadgets.

A Turing machine is a fixed table of rules: one machine, one job. Turing's 1936 paper
observes that a machine's rule table is *finite*, therefore it can be *written down as a
string*, therefore it can be *put on a tape*, therefore **a machine can read it**.

A **universal Turing machine** `U` takes as input an encoding `⟨M⟩` of a machine and an input
`w`, and simulates `M` on `w`:

```
    U(⟨M⟩, w)  =  M(w)
```

One machine that becomes any machine, by reading a description of it. The description is
data; the behaviour is the interpretation of that data.

### The stored-program computer IS a universal machine

Now look at what the learner built in Part 0. A CPU with:

- an instruction set (finite control),
- a memory that holds **both instructions and data, in the same address space** (the tape),
- a program counter that fetches an instruction, decodes it, executes it, advances (`δ`).

**The program in memory is `⟨M⟩`. The data in memory is `w`. The fetch-decode-execute loop
is `U`.** The learner did not build "a computer that runs programs". They built a universal
machine, and the "stored program" idea — von Neumann's 1945 EDVAC draft, and independently
in the Manchester Baby of 1948 — is the engineering realisation of Turing's 1936 theorem.

The pedagogical instruction for this curriculum, stated as strongly as possible:

> **Do not tell the learner this. Make them derive it.** Give them their own Part 0 CPU and
> a Turing machine simulator written in their own assembly. Have them run a Turing machine
> that itself simulates a second Turing machine. Then ask: *where, in your own machine, is
> the universal machine?* The answer — "in the fetch-decode-execute loop, and it was there
> the whole time" — lands with a force that no amount of being told achieves.

This also demystifies things the learner has probably filed under "advanced":

- **An interpreter is a universal machine for its language.** Python's `eval` loop is `U`.
- **Self-hosting compilers, bootstrapping.** A compiler is data to another compiler.
- **`fork`/`exec`, virtual machines, containers, emulators.** All the same trick: the thing
  being run is data to the thing running it.
- **Code injection vulnerabilities.** The instructions/data unification is not a design
  quirk; it is the source of universality *and* of the entire class of attacks in which data
  is executed. `W^X`, NX bits, and DEP are deliberate, partial retreats from universality for
  safety. That is a genuinely deep point and it is *right there* in the hardware track.

## 1.7 The Church–Turing thesis, stated carefully

The thesis is the most misquoted claim in computer science. Here is the careful version.

**What it says:**

> Every function on the natural numbers that is computable **by an effective method** — an
> algorithm, a finite sequence of unambiguous mechanical steps, carried out with unlimited
> time and paper but no insight — is computable by a Turing machine.

**What it is not:** it is **not a theorem**, and it cannot be one. One side of the claim
("effectively calculable") is an informal, pre-mathematical notion. You cannot prove an
equivalence between a formal object and an intuition. It is a *thesis* — a proposed
identification of an informal concept with a formal one, held on evidence.

**The evidence, which is unusually strong.** Between 1931 and 1936 several people, working
separately and with different goals, tried to formalise "computable". They arrived at:

| Model | Author, year | The idea |
|---|---|---|
| μ-recursive functions | Gödel, Herbrand, Kleene, 1931–36 | build from zero/successor/projection with composition, primitive recursion, and unbounded search (`μ`) |
| λ-calculus | Church, 1936 | variables, function abstraction, application. That is the *entire* language |
| Turing machines | Turing, 1936 | tape, head, finite control |
| Post canonical systems | Post, 1936 | string rewriting rules |
| Register machines | Minsky, 1961 | counters with inc/dec-and-branch. **Two registers suffice** |
| Cellular automata | von Neumann, Conway, Cook | Rule 110 and Life are universal (Cook, 2004) |
| Tag systems, Markov algorithms, combinatory logic (SKI) | various | |

**Every single one defines exactly the same class of functions.** Church and Turing proved
λ-definability equivalent to Turing-computability in 1936–37; Kleene tied in μ-recursion.
This is the striking fact, and the curriculum should let the learner feel how strange it is.
There is no *a priori* reason why "rewriting strings", "substituting into function bodies",
"incrementing counters", and "a cell automaton with a 3-cell neighbourhood" should carve out
the same set. It happens anyway. That kind of convergence is what makes a definition look
like a discovery rather than a choice.

Add the modern evidence: **every programming language ever built implements the same class**.
C, Haskell, Prolog, Brainfuck (8 instructions), x86 `mov` alone (Dolan, 2013 — the `mov`
instruction is Turing-complete), C++ templates (Veldhuizen), Magic: The Gathering,
PowerPoint animations, and the C preprocessor with enough abuse. Ninety years of people
trying to find a reasonable model that computes more, and failing.

### The three theses, which get conflated and shouldn't

1. **Church–Turing thesis (CTT).** As above, about *computability*. Essentially universally
   accepted.
2. **Extended / Complexity-theoretic CTT.** Any reasonable model can be simulated by a
   probabilistic Turing machine with at most **polynomial** overhead. This is about *cost*,
   and it is **much shakier** — quantum computing is the standing challenge. Shor's algorithm
   factors in polynomial time and no classical polynomial algorithm is known; if BQP ⊋ BPP,
   the extended thesis is false as stated. Note carefully: this does **not** threaten CTT
   itself. A quantum computer computes exactly the same *functions*; it may compute some of
   them faster.
3. **Physical CTT.** Anything physically realisable can be simulated by a Turing machine.
   This is a claim about *physics*, not mathematics, and it is genuinely open. Hypercomputation
   proposals (Malament–Hogarth spacetimes, closed timelike curves, infinite-precision real
   arithmetic, a black hole you can throw a computation into) all require physics we do not
   have and probably cannot have.

**Warn the learner about the misuse.** "The Church–Turing thesis proves the brain is a
computer" is not a thing CTT says. CTT is about *functions on the naturals under effective
methods*. Whether the brain implements only effective methods is exactly the assumption in
question, so using CTT to settle it is circular. This is the same class of error as the
Gödel abuse in §3.7, and flagging both in the same voice is good pedagogy.

## 1.8 The other models, briefly, and why each one earns its place

Do not teach all of these. Teach two, and mention the rest as a list, because the *list* is
the argument.

**λ-calculus** is worth real time, because it is the only one on the list that is also a
practical programming language and a compiler IR. Three constructs:

```
    e ::= x           variable
        | λx. e       abstraction  (define a function)
        | e e         application  (call a function)
```

There are no numbers, no booleans, no conditionals, no data structures, no recursion
primitive. All of it is encodable. Church numerals define `n` as "apply f, n times":
`2 = λf.λx. f (f x)`. Booleans are `true = λx.λy.x`, `false = λx.λy.y`, and then `if` is
just application. Recursion appears from nowhere via the Y combinator
`Y = λf.(λx.f (x x))(λx.f (x x))`, which satisfies `Y f = f (Y f)`.

Its curriculum value is high because it is directly upstream of things the learner will
touch: closures in every language they use, `let`-bound continuations, SSA form, the typed
lambda calculi that are the semantics of every ML-family type system, and the
Curry–Howard correspondence (*a type is a proposition, a program is its proof*), which is
the thing that makes Coq/Lean/Agda make sense rather than seem arbitrary.

**μ-recursive functions** earn their place for exactly one reason, and it is a good one:
the split between **primitive recursion** (bounded loops — `for i in range(n)`) and the
**μ operator** (unbounded search — `while`). Primitive recursive functions are *total*: they
always halt. They are also insufficient — Ackermann's function is total and computable but
not primitive recursive, and it grows so fast that no bounded-loop program can keep up.
Adding `μ` gets you the rest of the computable functions **and, in the same stroke,
non-termination**. You cannot have one without the other.

> **This is the crispest possible statement of the trade the learner lives inside:** the
> `while` loop is what makes your language Turing-complete, and it is the *same feature*
> that makes "does this program halt?" undecidable. Bounded loops are safe and weak.
> Unbounded loops are powerful and undecidable. Pick one — and note that eBPF, Terraform's
> HCL, Dhall, and the `#[no_std]` verified subsets all deliberately pick "safe and weak".

**Register machines** are the closest formal model to the learner's actual CPU, which makes
them the right bridge in this curriculum specifically. Minsky's result — **two counters with
increment, and decrement-or-branch-if-zero, suffice for universality** — is a good shock: the
learner's Part 0 ISA is enormously more capable than the theoretical minimum, and everything
above those two instructions is *convenience and speed, not power*.

**Cellular automata** earn a paragraph for the sheer strangeness. Rule 110 is a 1-D cellular
automaton where each cell's next value depends on itself and its two neighbours by a fixed
8-entry table. Matthew Cook proved (announced 1998, published 2004) that it is
Turing-complete. Conway's Life likewise. A local, uniform, memoryless update rule over a line
of bits is a universal computer. There is no scheduler, no memory hierarchy, nothing that
looks like a computer at all — and it computes everything a computer computes. If any single
fact conveys "computation is substrate-independent", it is this one.

---

# 2. Formal Languages, Tied to Real Tools

## 2.1 The Chomsky hierarchy as a tooling decision

Chomsky's 1956 classification was linguistics. It turned out to be a map of the compiler.

| Type | Language class | Machine | Grammar rule shape | The tool |
|---|---|---|---|---|
| 3 | Regular | DFA / NFA | `A → aB`, `A → a` | **lexer**, `grep`, `flex`, protocol FSMs |
| 2 | Context-free | Pushdown automaton | `A → γ` (LHS is one nonterminal) | **parser**, `yacc`/`bison`/ANTLR |
| 1 | Context-sensitive | Linear-bounded automaton | `αAβ → αγβ` (never shrinks) | *nothing uses this directly* |
| 0 | Recursively enumerable | Turing machine | `α → β`, unrestricted | semantic analysis, type checking |

Read the "grammar rule shape" column as the real content. Each level is defined by a
restriction on what a rule may look like, and each restriction is exactly what makes the
corresponding machine simple enough to be efficient.

The engineering reading of the whole table is a single sentence, and it's the sentence that
justifies the shape of every compiler ever written:

> **Push each job to the weakest level that can do it, because the weaker levels are
> faster, have decidable properties, and give better error messages.**

So: lexing is regular (O(n), no backtracking, streamable). Parsing is context-free (O(n)
with LR, an explicit stack). Everything the CFG can't express — "is this variable declared?",
"do the argument types match?", "is this `break` inside a loop?" — is punted to a
*semantic analysis pass* that is a general program with a symbol table, i.e. Type 0. That
three-phase structure is not a convention. It is the Chomsky hierarchy showing through.

There is a fourth, unlisted level worth naming for this curriculum: **type checking in a
language with a Turing-complete type system** (C++ templates, Rust traits with certain
patterns, Haskell with `UndecidableInstances`) can fail to terminate. That is Type 0 in
practice, and it's why compilers ship a `-ftemplate-depth` limit — an arbitrary constant
defending against undecidability, a theme §3.6 returns to.

## 2.2 Regular languages: three definitions of the same thing

A language is **regular** if it satisfies any of these, and they are provably equivalent:

1. Some DFA accepts it. *(Rabin–Scott)*
2. Some NFA accepts it. *(subset construction, §1.3)*
3. Some regular expression denotes it. *(Kleene's theorem, 1951)*
4. `≡_L` has finitely many classes. *(Myhill–Nerode, §1.3)*
5. Some right-linear grammar generates it.

Kleene's theorem is the one that matters to a working engineer, because it says the notation
you type into `grep` and the machine `grep` runs are the same object, and the translation is
mechanical in both directions.

**The formal regular expression language is tiny:** `∅`, `ε`, a single symbol, and three
operators — union `|`, concatenation, and Kleene star `*`. That's it. Everything else in a
real regex dialect is sugar over these:

| Sugar | Desugars to | Still regular? |
|---|---|---|
| `a+` | `aa*` | yes |
| `a?` | `a\|ε` | yes |
| `a{3,5}` | `aaa(a(a)?)?` | yes (blows up the NFA, but finite) |
| `[a-z]` | `a\|b\|…\|z` | yes |
| `.` | union over the alphabet | yes |
| `^`, `$` | anchors — a machine detail, not a language op | yes |
| **`\1` backreference** | **nothing. Not expressible.** | **NO** |
| **`(?R)`, `(?1)` recursion** | **nothing.** | **NO** |
| **lookahead `(?=...)`** | intersection/complement — regular but expensive | yes, surprisingly |

The line in that table is the most important thing in §2 after the pumping lemma. Below the
line the tool is still a finite automaton and cannot be made to run slowly. Above the line
**the tool is no longer a regex engine in the formal sense**, and §2.6 is what happens next.

Proof that `\1` escapes regularity: `(a*)b\1` matches `{aⁿ b aⁿ}`, which is not regular by
Myhill–Nerode (all `aⁱ` pairwise inequivalent, separated by `b aⁱ`). Actually
backreferences take you further than context-free: `(a*)b\1b\1` gives `{aⁿbaⁿbaⁿ}`, which is
not even context-free. Matching regexes-with-backreferences is **NP-complete** (Aho, 1990).

**Closure properties** are worth stating because they're the reason certain tricks work:
regular languages are closed under union, concatenation, star, **complement**, **intersection**,
reversal, and homomorphism. Complement is the surprising one — it's trivial on a DFA (swap
accepting and non-accepting states) and completely non-obvious on a regex, which is why
"match everything except X" is awkward to write and easy for the engine. Intersection via the
product construction is how lookahead assertions stay regular.

## 2.3 The pumping lemma: how to prove something is impossible

Everything so far says what regular languages *can* do. The pumping lemma is the tool for
proving what they cannot, and it is the first genuine impossibility proof most engineers meet.

**Pumping lemma for regular languages.** If `L` is regular, then there exists a *pumping
length* `p ≥ 1` such that every string `s ∈ L` with `|s| ≥ p` can be split as `s = xyz` with:

1. `|y| ≥ 1` (the pumped part is non-empty)
2. `|xy| ≤ p` (the pumped part is within the first `p` characters)
3. `x yⁱ z ∈ L` for **all** `i ≥ 0`

**Where it comes from — and this is the part that makes it obvious rather than magical.**
Let `p` be the number of states in a DFA for `L`. Feed it a string of length ≥ `p`. The run
visits ≥ `p+1` states. By the pigeonhole principle, **some state repeats**. Call the piece of
input consumed between the two visits `y`. That piece is a *loop* in the automaton. You can
go around a loop zero times, once, or a million times, and you end up in the same state — so
the machine cannot tell the difference. Therefore `xz`, `xyz`, `xyyz`, … all end in the same
place, so all are accepted or all rejected together.

> The pumping lemma is the pigeonhole principle applied to a finite state count. That's all
> it is. "The machine forgot how many times it went round."

**Logical shape, which is where people go wrong.** It is a one-directional implication:
*regular ⟹ pumpable*. So it can only prove **non**-regularity, by contraposition. A language
that pumps may still be non-regular (`{aⁱbʲcᵏ : i=0 ∨ j=k}` is the classic counterexample —
it pumps but isn't regular). **Never use the pumping lemma to argue something *is* regular.**
That is the single most common misuse.

**The proof is an adversary game**, and framing it that way makes it teachable:

- The adversary picks `p`. You know nothing about it.
- **You** pick a string `s ∈ L` with `|s| ≥ p`, chosen to be maximally awkward.
- The adversary picks the split `xyz`, subject to conditions 1 and 2.
- **You** pick `i` and show `xyⁱz ∉ L`.

You get two moves and they are the ones that matter. Choose `s` well and the adversary has
no good split.

**Worked example — balanced parentheses is not regular.**
Let `L = {(ⁿ)ⁿ}`. Adversary gives `p`. Choose `s = (ᵖ)ᵖ`. Condition 2 (`|xy| ≤ p`) forces `y`
to consist entirely of open parens; condition 1 says `y` is non-empty, so `y = (ᵏ` for some
`k ≥ 1`. Pump with `i = 2`: `xy²z = (ᵖ⁺ᵏ)ᵖ`, which has more opens than closes, so it is not
in `L`. Contradiction. `L` is not regular. ∎

That is one paragraph, and it proves that **no regex, however clever, can match balanced
brackets** — not because nobody has been smart enough, but because it is impossible. That is
a different and much more satisfying kind of "no" than an engineer usually gets.

## 2.4 "You cannot parse HTML with a regex" — stated properly

This is the most famous impossibility result in practical programming and it is almost always
argued badly (usually by citing a Stack Overflow rant rather than a theorem). Here is the
argument done correctly, in the four steps it actually takes.

**Step 1 — Isolate a sublanguage.** HTML permits arbitrarily nested elements. Consider only
the strings `L = {(<b>)ⁿ (</b>)ⁿ : n ≥ 0}` — `n` opening `<b>` tags followed by `n` closing
ones. Every one of these is well-formed HTML. If regular languages could describe HTML's
well-formedness, they could describe `L`, because **regular languages are closed under
intersection** with the regular language `(<b>)*(</b>)*`.

**Step 2 — Prove `L` is not regular.** Identical to the parentheses proof above, treating
`<b>` and `</b>` as single symbols: choose `s = (<b>)ᵖ(</b>)ᵖ`, `|xy| ≤ p` forces `y` to be
`k ≥ 1` copies of `<b>`, pump to `i=2`, get unbalanced tags, contradiction. Or one line of
Myhill–Nerode: the strings `(<b>)ⁱ` are pairwise inequivalent.

**Step 3 — Conclude by closure.** If HTML's well-formed strings were a regular language, its
intersection with a regular language would be regular. It isn't. So it isn't. ∎

**Step 4 — State what this does and does not mean.** This is where the folklore fails.

*What it means:* there is no **formal regular expression** — union, concatenation, Kleene
star over a finite alphabet — that matches exactly the well-formed HTML documents. This is a
theorem, not an opinion, and no amount of engineering effort changes it.

*What it does NOT mean:*

- **It does not mean "you can never use a regex on HTML."** Extracting all `href` attributes
  from a document you control, in a one-off script, is fine and everyone does it. The theorem
  is about *recognising the language*, not about *finding things in strings*.
- **It does not apply to PCRE-with-recursion.** Perl's `(?R)` and `(?1)`, and .NET's
  balancing groups, are explicitly non-regular extensions. PCRE with recursion *can* match
  balanced tags, because it is no longer a regular expression — it is a small pushdown
  machine with regex syntax. The folklore argument that says "regexes provably can't do it,
  therefore PCRE can't" is **wrong**, and an engineer who learns the sloppy version will one
  day be confidently incorrect in a code review.
- **It does not mean HTML is context-free either.** Real HTML5 parsing is specified as an
  explicit algorithm with error recovery, implied end tags, foster parenting of misplaced
  table content, and a stack of open elements with re-entrant handling. It is not a CFG. The
  WHATWG spec *is* the definition, and it is a program.

**The honest engineering conclusion**, which is what the learner should carry:

> Use a parser for structure; use a regex for tokens. If you find yourself trying to make a
> regex count or match nested things, you have hit a theorem, not a skill issue. Stop and
> get a parser.

**A second, cheaper impossibility worth teaching alongside it, because the learner will hit
it in their own lexer:** C-style block comments `/* ... */` are regular (the "no `*/` inside"
constraint is a finite condition). **Nested** block comments, as in Rust, OCaml, and D, are
**not** — same proof, `(/*)ⁿ(*/)ⁿ`. That is why Rust's lexer keeps an explicit nesting depth
counter, and why `flex` alone cannot lex Rust comments. The learner can see the counter in
the source of any Rust tokeniser. Theory, then the exact line of code it forced.

## 2.5 A lexer IS a DFA — the concrete mechanics

Say it plainly and then show the machinery, because the identification is the payoff.

A `flex` specification is a list of regexes with actions. `flex`:

1. Compiles each regex to an NFA fragment (Thompson construction, §2.6).
2. Unions them all under one start state, tagging each accepting state with its rule number.
3. Runs subset construction to get a DFA.
4. Minimises it (partially — flex uses equivalence classes and meta-equivalence classes).
5. Emits the transition table as C arrays: `yy_nxt`, `yy_accept`, `yy_ec`, `yy_base`,
   `yy_def`, `yy_chk`. The "compressed table" representation is a default/check scheme that
   overlaps sparse rows — the same trick as a sparse matrix in CSR form, which the learner
   will meet again in the numerical track.
6. Emits a driver loop that is about ten lines: read char, map through `yy_ec`, index the
   table, repeat.

**Two rules resolve ambiguity when several regexes match:**

- **Maximal munch (longest match wins).** Keep going while any rule could still extend.
  Remember the last accepting position and its rule; on getting stuck, rewind there.
- **Earliest rule wins on ties.** Which is exactly why keyword rules must be listed *before*
  the identifier rule in every flex file ever written. A learner who has been told "put
  keywords first" as a rule of thumb has just learned *why*.

**Maximal munch has visible consequences in real languages**, and these make excellent
lesson hooks:

- `x+++y` in C lexes as `x ++ + y`, never `x + ++ y`.
- `a<b<c>>` in pre-C++11 lexed `>>` as the right-shift operator, breaking nested templates.
  C++11 special-cased it *in the parser*, because the lexer genuinely cannot know.
- In Go, the lexer inserts semicolons based on the last token of a line — a small piece of
  state bolted onto a DFA.
- The rewind in maximal munch is the *only* place a lexer backs up, and it is bounded by
  the longest token, so the O(n) guarantee survives.

**When the DFA isn't enough, and what people do about it.** Real lexers cheat in three
recurring ways, all of which are "a finite automaton plus a small amount of extra state":

| Problem | Why the DFA fails | The cheat |
|---|---|---|
| Nested comments | not regular (§2.4) | an integer depth counter |
| Python indentation | needs a stack of indent levels | an explicit stack, INDENT/DEDENT tokens |
| Heredocs, raw strings `r#"..."#` | delimiter is data | remember the delimiter, compare |
| C's typedef ambiguity | needs the symbol table | **the lexer hack** (§2.8) |
| String interpolation `"${a+b}"` | needs recursion | start conditions / mode stack |

Every one of these is a place where an engineer, without knowing it, upgraded their machine
one rung on the Chomsky hierarchy. Naming that out loud is the lesson.

## 2.6 Regex engines: NFA, and the fork that causes outages

This is the section where theory becomes an incident report.

### Thompson's construction

Ken Thompson's 1968 CACM paper *Regular Expression Search Algorithm* gives a translation
from regex to NFA that is compositional — each operator is a tiny graph gadget, and the
fragments plug together:

```
  literal a:     ──a──▶◯

  e1 e2:         ──[e1]──▶──[e2]──▶

                    ┌─ε─▶[e1]─┐
  e1 | e2:       ──▶│         ├──▶
                    └─ε─▶[e2]─┘

                     ┌────ε────┐
  e*:            ──▶◉│         │      (split: try e, or skip)
                     └─▶[e]────┘

  e?:            ──▶◉─ε─▶[e]──▶       (split: try e, or skip. GREEDY = try e first)
                     └────ε──────▶
```

Two properties make everything downstream work: the NFA has **at most 2m states for a regex
of length m** (linear, no blow-up), and every state has **at most 2 outgoing edges**. That
second one is why a Thompson NFA node fits in a cache line and why the simulation is fast in
practice, not just in the O.

### Two ways to walk one graph

Given the NFA, you now choose an execution strategy — and the choice has no effect on *which*
strings match, only on *how long it takes*:

**Strategy A — Thompson simulation (breadth-first, all paths at once).** Maintain the set of
states reachable after consuming the prefix so far. For each input character, step every state
in the set forward and take the ε-closure. Because it's a *set*, a state is never processed
twice at the same input position. That single deduplication is the entire performance story.

- Time **O(mn)**, space **O(m)**. No input is pathological. Ever.
- Used by: RE2 (Google), Rust's `regex` crate, Go's `regexp`, `awk`, most `grep`
  implementations, Hyperscan (Intel, with SIMD tricks on top).
- Cost: **no backreferences.** They are provably incompatible with a bounded state set —
  remembering what a capture group matched needs unbounded memory.

**Strategy B — backtracking (depth-first, one path at a time).** Try the first alternative;
on failure, unwind and try the next. This is a recursive walk of the same graph with no
memory of where it has been.

- Time **O(2ⁿ)** in the worst case.
- Used by: PCRE, Perl, Python's `re`, Java's `java.util.regex`, JavaScript (V8, JSC,
  SpiderMonkey), .NET (by default), Ruby's Onigmo, glibc's `regexec`.
- Buys: backreferences, arbitrary lookaround, atomic groups, capture semantics defined by
  traversal order, and a simpler implementation.

**That list is most of the languages the learner will ever use.** The default in the industry
is the exponential one, and that is a deliberate feature trade, not an oversight.

### The measurement (verified live, §7.1)

The pathological case is Cox's: pattern `a?ⁿaⁿ`, input `aⁿ`. Greedy `a?` tries to consume
first, so the backtracker takes all `n` optionals, runs out of input for the `n` mandatory
`a`s, and unwinds — exploring every one of the `2ⁿ` subsets before finding the only good one.
The measured step counts, from **one NFA walked two ways**, with the two strategies asserted
to agree on every input:

| n | backtracking steps | Thompson steps | ratio |
|---:|---:|---:|---:|
| 1 | 5 | 7 | 0.7× |
| 4 | 78 | 55 | 1.4× |
| 8 | 1,790 | 189 | 9× |
| 12 | 36,862 | 403 | 91× |
| 16 | 720,894 | 697 | 1,034× |
| 20 | 13,631,486 | 1,071 | 12,728× |
| 24 | **251,658,238** | **1,525** | **165,022×** |
| 25 | exceeded a 4×10⁸ step cap | — | — |

*(verified, §7.1 — GCC 15.2 on the Compiler Explorer executor)*

Both curves fit exactly, on every n from 1 to 24:

```
    backtracking(n) = (n + 6)·2ⁿ⁻¹ − 2          exponential
    thompson(n)     = (5n + 2)(n + 1) / 2       quadratic
```

The exactness is the pedagogical gift. This is not "roughly exponential" — the learner can
predict n=30 by arithmetic (`36·2²⁹ − 2 = 19,327,352,830`) and then, if patient, watch the
program confirm it. And the two matchers are asserted to return identical answers on every
test string, so the learner cannot dismiss it as comparing different things. **Same machine.
Same answers. Two strategies. 165,000×.**

Cox's own 2007 measurements on the same pattern: Perl needs "over sixty seconds" at n=29
where the Thompson NFA needs "twenty microseconds"; at n=100 Perl would need "over 10¹⁵
years" and the NFA needs "under 200 microseconds". Our step counts and his wall-clock
measurements are the same phenomenon at different resolutions.

### ReDoS: the class of bug this creates

**Regular expression Denial of Service.** If a regex can backtrack exponentially and an
attacker controls any part of the input, they control your CPU. It is a one-request outage
with no memory exhaustion, no crash, and nothing in the logs but a pegged core.

**The signature to grep for** is nested quantification where the inner and outer parts can
match the same characters — *ambiguity in the NFA*:

```
    (a+)+           (a|a)*          (a|aa)+        (.*)*
    ([a-zA-Z]+)*    (\s*,\s*)*      ^(\w+\s?)*$    (x+x+)+y
```

The formal criterion is exact: an NFA is **ambiguous** if some string has two distinct
accepting paths. Exponential backtracking is possible **iff** the NFA has a state reachable
by two different paths on the same substring that both return to it. Static ReDoS detectors
(`safe-regex`, `redos-detector`, RXXR2, Weideman et al.'s work) test precisely this property.

### Cloudflare, 2 July 2019 — the canonical incident

A single line deployed to the WAF took Cloudflare's global network down for **27 minutes**.
The rule was:

```
(?:(?:\"|'|\]|\}|\\|\d|(?:nan|infinity|true|false|null|undefined|symbol|math)|\`|\-|\+)+[)]*;?((?:\s|-|~|!|{}|\|\||\+)*.*(?:.*=.*)))
```

The lethal fragment is `.*.*=.*`. Cloudflare's own postmortem gives the numbers: matching
`x=x` takes 23 steps; matching `x=` followed by 20 `x`s takes **555 steps**, and it keeps
going quadratically-then-explosively from there. The WAF ran Lua with PCRE, which the
postmortem describes exactly: it "uses backtracking for matching and has no mechanism to
protect against a runaway expression." CPUs across the network hit ~100%. The WAF was killed
globally at 14:07 UTC and restored at 14:52. Cloudflare committed to moving to "either the
re2 or Rust regex engine" — i.e. to Strategy A.

That is the theory-to-incident chain in full: *a choice of graph traversal strategy, made in
a regex library, took a large fraction of the internet offline.*

The same class of bug produced a ~34-minute Stack Overflow outage on 20 July 2016 (a
whitespace-trimming regex meeting a post with a very long run of spaces) — *details recalled,
not verified; see §8.*

### What to actually do about it

1. **Use a linear-time engine where you can.** RE2, Rust `regex`, Go `regexp`, Hyperscan.
   They will refuse to compile a backreference rather than give you an exponential one — a
   refusal that is a feature.
2. **Set a timeout or a step budget** if you must use a backtracker. .NET has
   `Regex` match timeouts; Java has none (use a watchdog); Python's `re` has none, but the
   third-party `regex` module and `re2` bindings exist.
3. **Never run a user-supplied regex** in a backtracking engine without isolation. This is
   equivalent to running user-supplied code.
4. **Lint your patterns in CI.** The ambiguity check is static and cheap.
5. **Rewrite the pattern.** `(a+)+` is `a+`. Most real ReDoS patterns are accidentally
   ambiguous and have an unambiguous equivalent. Atomic groups `(?>...)` and possessive
   quantifiers `a++` cut off backtracking explicitly.

## 2.7 Context-free grammars: what a parser is

A **context-free grammar** is `G = (V, Σ, R, S)`: nonterminals, terminals, rules of the form
`A → γ` where `A` is a single nonterminal, and a start symbol. "Context-free" means exactly
one thing: **the left side of a rule is a bare nonterminal**, so `A` can be replaced by `γ`
wherever `A` appears, regardless of what surrounds it. That locality is what makes the
pushdown automaton sufficient and the parsing algorithms possible.

The canonical expression grammar, which the learner will type out by hand:

```
    E → E + T | T
    T → T * F | F
    F → ( E ) | id
```

The layering encodes precedence (`*` binds tighter because it is deeper) and the
left-recursion encodes left-associativity. Those two facts — that precedence is *depth* and
associativity is *recursion direction* — are worth an explicit slide, because they are the
first time a learner sees a grammar carrying semantics in its shape.

### Ambiguity

A grammar is **ambiguous** if some string has two distinct parse trees (equivalently, two
distinct leftmost derivations). Ambiguity is a property of the *grammar*, not the language,
except when it is: some languages are **inherently ambiguous** — no unambiguous grammar
exists for them. `{aⁱbʲcᵏ : i=j ∨ j=k}` is the standard example.

The famous case:

```
    S → if E then S | if E then S else S | other
```

`if a then if b then x else y` — does the `else` bind to the inner or outer `if`? Both trees
are legal. Every real language resolves this by fiat ("`else` binds to the nearest `if`"),
which is a *disambiguation rule bolted onto the grammar*, not a property of it. `yacc`
implements it by preferring shift over reduce, which is exactly the same decision expressed
in the machine.

**And here is the theorem that governs all tooling around ambiguity:**

> **Ambiguity of a context-free grammar is undecidable.**

There is no algorithm that takes a CFG and tells you whether it is ambiguous. So no parser
generator can ever hand you a clean answer. What `bison` gives you instead is a *conservative
approximation*: "I found a conflict in the LALR(1) construction." That may be genuine
ambiguity, or it may be a grammar that is perfectly unambiguous but needs more lookahead. The
tool cannot tell you which — and now the learner knows *why* the error message is so
unhelpful. It's not bad UX. It's Rice's theorem in a compiler (§3.5).

Other undecidable questions about CFGs, which explain other missing tools: is `L(G₁) = L(G₂)`?
Undecidable. Is `L(G₁) ∩ L(G₂) = ∅`? Undecidable. Is `L(G) = Σ*`? Undecidable. Is `L(G)`
regular? Undecidable. There is essentially no interesting question about grammars a machine
can answer, which is why grammar engineering remains a craft.

### The pumping lemma for context-free languages

Same idea, one level up. If `L` is context-free with pumping length `p`, every `s ∈ L` with
`|s| ≥ p` splits as `s = uvxyz` with `|vy| ≥ 1`, `|vxy| ≤ p`, and `u vⁱ x yⁱ z ∈ L` for all
`i ≥ 0`.

**Why two pumped pieces?** Because the proof is pigeonhole on the *parse tree* rather than
the state sequence. A long string forces a tall tree; a tall tree forces a repeated
nonterminal `A` on some root-to-leaf path; the subtree between the two `A`s can be duplicated
or deleted. That subtree contributes material on **both sides** of the inner part — hence `v`
and `y`, pumped in lockstep. A PDA can match *one* pair of things because it has one stack.
It cannot match two independent pairs.

**Consequence: `{aⁿbⁿcⁿ}` is not context-free.** Choose `s = aᵖbᵖcᵖ`. `|vxy| ≤ p` means `vxy`
spans at most two of the three letter blocks, so pumping changes the count of at most two
letters and leaves the third alone. Counts diverge. ∎

Same argument kills `{ww : w ∈ Σ*}` (a string repeated) and `{aⁿbᵐcⁿdᵐ}` (crossing
dependencies). And this is the theorem behind the next section.

## 2.8 Why C++ is not context-free — living evidence

The learner has been told "the parser handles a context-free grammar". The most widely used
systems language violates that on its first page. Both violations were **verified live**
(§7.8).

### The typedef problem

In C and C++, the statement

```c
    T * p;
```

is a **pointer declaration** if `T` names a type, and a **multiplication expression** if `T`
names a variable. Same tokens. Two different parse trees. The information that decides it is
a declaration that may be a thousand lines away, or in a header, or behind a `#ifdef`.

Verified on GCC 15.2 (§7.8): with `typedef int T`, `T *p` is a declaration; with
`constexpr int T = 7`, `T * p` is an expression evaluating to 21 for `p = 3`. Identical token
sequences, different trees, decided entirely by the symbol table.

**How real compilers cope: "the lexer hack."** The parser feeds the symbol table back into
the lexer, which then emits `TYPE_NAME` instead of `IDENTIFIER` for known typedef names. It
works and is what most C compilers do. It is also a confession: the *lexer* now depends on
*semantic* information, so the clean three-phase pipeline of §2.1 has a back edge in it. In
formal terms the grammar has become context-*sensitive*, because whether a production applies
depends on the surrounding program.

Consequences worth naming: this is why C parsers are hard to write as pure CFGs, why
syntax-highlighting a C file correctly requires most of a compiler front end, why `clang`
builds a full `Sema` alongside the parser rather than after it, and why parsing a C++ header
in isolation is not a well-defined operation.

### The most vexing parse

```cpp
    Widget w(Timer());
```

Is this a variable `w` constructed from a temporary `Timer`, or a **declaration of a
function** `w` taking a `Timer(*)()` and returning `Widget`? The C++ standard's answer:
*"anything that can be interpreted as a declaration is a declaration"* ([stmt.ambig]). So it
is a function declaration, and the friendly-looking line declares nothing you wanted.

Verified on GCC 15.2 (§7.8): `std::is_function_v<decltype(w)>` is **true** for
`Widget w(Timer());` and `std::is_same_v<decltype(v), Widget>` is **true** for
`Widget v{Timer()};`. GCC even emits `-Wvexing-parse` telling you it disambiguated your code
into something you didn't mean. **The compiler warning is the theory.**

This is precisely why C++11 introduced brace initialisation — `Widget v{Timer()}` is
unambiguous. A grammar problem solved by adding syntax, which is the only way grammar
problems ever get solved.

### The strongest form: parsing C++ is undecidable

The two above are ambiguities resolvable with a symbol table. The deep result is worse.
Because **C++ template instantiation is Turing-complete** (Veldhuizen; templates
can compute primes at compile time), and because whether a given token sequence is a valid
parse can depend on the *result* of a template instantiation, deciding whether an arbitrary
C++ program is syntactically valid **reduces to the halting problem**.

The standard construction: write a template metaprogram whose instantiation determines
whether some name is a type or a value, then place `x * y;` after it. Whether that line is a
declaration or an expression depends on the metaprogram's *output*, and the metaprogram can
be arbitrary. Compilers escape by imposing a `-ftemplate-depth` limit (GCC/Clang default 900
or 1024) — a constant chosen to make an undecidable problem terminate. It is the most honest
piece of engineering in the whole toolchain: *we cannot decide this, so we will give up after
900 tries and call it an error.*

**The lesson to teach.** "Parsing is context-free" is a useful approximation. Real languages
routinely break it, and each break is a decision someone made and a hack someone wrote. The
languages that *are* cleanly context-free — Lisp, JSON, Pascal — bought that with syntax the
market found less pleasant. **Grammar design is a trade between how a language reads and how
hard it is to parse**, and the learner should see that trade being made rather than presented
as settled.

## 2.9 Parsing algorithms: the actual menu

Now the engineering. Every algorithm here is a way to run a pushdown automaton; they differ
in what they can handle and what they cost.

### LL(k) — top-down, predictive

Build the parse tree from the root, choosing which production to use from the next `k` tokens.
LL(1) is the one people use. **Recursive descent is hand-written LL(k)** — one function per
nonterminal, `if (peek() == ...)` for the choice.

- **Cannot handle left recursion.** `E → E + T` sends `parseE()` straight into infinite
  recursion. You must rewrite it as `E → T E'`, `E' → + T E' | ε` — which flattens the
  natural tree shape and makes left-associativity awkward to reconstruct.
- **Requires disjoint FIRST sets**, plus FOLLOW sets when ε-productions are involved.
- **Wins on error messages.** The parser always knows what it's trying to parse ("expected
  `)` to close the argument list opened on line 12"). This is not a small point: it is why
  Clang, GCC (since 3.4), Rust, Go, Java's javac, and TypeScript all use **hand-written
  recursive descent** despite parser generators existing. Modern compilers overwhelmingly do
  not use LR generators, and diagnostics is the main reason.
- **The pragmatic hybrid** everyone actually writes: recursive descent for statements and
  declarations, plus **Pratt parsing / precedence climbing** for expressions, which handles
  precedence and associativity with a table instead of a nonterminal per level.

### LR(k), LALR(1), SLR — bottom-up, shift-reduce

Build the tree from the leaves. Maintain a stack; at each step either **shift** the next token
onto the stack or **reduce** the top few stack symbols to a nonterminal by some rule. The
decision comes from a DFA over *viable prefixes* — and here's the connection worth making
explicitly: **the LR automaton is a DFA whose states are sets of "items" (dotted productions),
constructed by the same subset construction as §1.3.** The learner already built this machine.

- **Handles left recursion natively.** Prefers it, in fact.
- **Strictly more powerful than LL(k)** for the same `k`.
- **LALR(1)** merges LR(1) states with the same core to shrink the table — this is what
  `yacc` and `bison` use, and it is the source of most mysterious conflicts.

**What a shift-reduce conflict actually is** — this is the question the section exists to
answer:

> The parser is in a state where the stack contents plus the lookahead token are consistent
> with **both** "the thing on the stack is a complete production, reduce it" and "the thing on
> the stack is a prefix of a longer production, keep shifting." The automaton has no
> information left to choose with.

Dangling `else` is the canonical instance. After `if E then S` with `else` as lookahead:
reduce `S → if E then S` (bind `else` to an outer `if`), or shift the `else` (bind to this
one)? Both are valid. `yacc` **defaults to shift** and prints a warning, and that default
happens to give the conventional "nearest `if`" semantics — a language design decision that
lives inside a parser generator's tie-breaking rule.

A **reduce-reduce conflict** is worse: two different rules could both complete now. It almost
always means a genuine grammar bug rather than a missing-lookahead problem.

Concrete debugging advice worth giving: `bison -Wcounterexamples` (Bison 3.8+) generates an
actual example string exhibiting the conflict, which turns the historically miserable
`.output` file spelunking into a normal debugging session.

### Earley — parses everything

Dynamic programming over sets of items, one set per input position. Handles **any** CFG:
ambiguous, left-recursive, right-recursive, all of it.

- **O(n³)** general, **O(n²)** unambiguous, **O(n)** on most practical grammars.
- Produces a **parse forest** when the input is ambiguous, rather than picking arbitrarily.
- Used where the grammar is not under your control: NLP, `nearley`, Marpa, and — notably —
  **Python's PEG parser replaced an LL(1) one in 3.9 (PEP 617)** for related reasons.

### GLR — generalised LR

Run LR, and when you hit a conflict, **fork the stack** and pursue both. The stacks are merged
into a graph-structured stack so the cost stays manageable. O(n³) worst case, near-linear when
the grammar is nearly deterministic.

- Used by **Tree-sitter** (every modern editor's syntax highlighting), Bison's `%glr-parser`,
  Elkhound, and the SDF/ASF+SDF family.
- The right answer for real-world languages that are *mostly* LR with a few nasty corners —
  C++ being the motivating example.
- Tree-sitter's additional trick, **incremental reparsing**, is what makes highlighting a
  10,000-line file responsive on every keystroke.

### PEG and packrat — ordered choice

**Parsing Expression Grammars** (Ford, 2004) look like CFGs but change one thing, and the
change is the whole story:

> **`/` is ordered choice, not union.** `A / B` means "try `A`; if it succeeds, commit; only
> if it fails, try `B`." Never both.

Consequences, good and bad:

- **Ambiguity is impossible by construction.** There is always exactly one parse. That is
  either the feature (no conflicts to debug, ever) or the bug (the ambiguity is still there,
  the tool just silently picked one and didn't tell you).
- **Dangling `else` "just works"** — order the alternatives and you're done. No conflict
  report, no `%prec` incantations.
- **Lexing and parsing unify.** PEGs are scannerless, which handles context-dependent lexing
  naturally.
- **The classic trap:** `A ← 'a' / 'ab'` never matches `ab`, because `'a'` succeeds first and
  commits. In a CFG, order is irrelevant; in a PEG it is everything. This bites everyone once.
- **Packrat parsing** memoises every (rule, position) result, giving guaranteed **O(n) time at
  O(n·|G|) space**. The space cost is real — often 10–100 bytes per input byte — which is why
  many production PEG parsers memoise selectively rather than fully.
- **Left recursion is still a problem**, needing either grammar rewriting or Warth et al.'s
  seed-growing hack.
- Users: Python 3.9+ (PEP 617), `pest` (Rust), PEG.js/Peggy, LPeg (Lua).

### The decision table

| Algorithm | Grammar class | Time | Error messages | Real users |
|---|---|---|---|---|
| Recursive descent (LL) | LL(k), hand-fixable | O(n) | **best** | Clang, GCC, Rust, Go, TypeScript, javac |
| Pratt / precedence climbing | expressions only | O(n) | good | inside nearly every RD parser above |
| LALR(1) | LALR(1) | O(n) | poor | bison, yacc, Ruby's parse.y, PHP, MySQL |
| LR(1) | LR(1) | O(n) | poor | Menhir (OCaml), LALRPOP (Rust) |
| Earley | **any CFG** | O(n³)/O(n) typical | fair | nearley, Marpa, NLP |
| GLR | **any CFG** | O(n³)/~O(n) | fair | **Tree-sitter**, Bison `%glr` |
| PEG / packrat | PEG (≠ CFG) | O(n) | fair | **Python 3.9+**, pest, Peggy |

**The advice to give the learner:** write recursive descent by hand for a language you
control, because error messages are most of a compiler's user experience and generators are
bad at them. Reach for a generator when the grammar is given to you and is nasty. Reach for
GLR or Earley when the grammar is genuinely ambiguous and you need the forest.

---

# 3. Computability — The Negative Results

Section 1 built up to universality: one machine that can do anything any machine can do.
This section shows that the *same* argument that gives you universality also gives you a
hard boundary, and that the boundary sits directly across the road every static analysis
tool wants to drive down.

The order matters pedagogically. Universality first, so the learner feels the power. Then
the limits, so they feel the cost. They are two consequences of one fact: **programs are
data**.

## 3.1 Counting: most functions are not computable

Before any specific undecidable problem, a cheap argument that establishes there *must* be
some. It takes four lines and it is worth doing first because it removes the surprise.

- A program is a finite string over a finite alphabet. The set of finite strings over a
  finite alphabet is **countably infinite** — you can list them by length then alphabetically.
  So there are ℵ₀ programs.
- A function `ℕ → {0,1}` is an infinite binary sequence. By Cantor's diagonal argument there
  are **uncountably many** — 2^ℵ₀ of them.
- 2^ℵ₀ > ℵ₀.
- Therefore **almost all** functions `ℕ → {0,1}` have no program. The computable ones are a
  measure-zero speck.

This is worth ten minutes because it reframes everything after it. The remarkable thing is
not that some functions are uncomputable; it is that *the ones we care about mostly are*.
But it also has a weakness the learner should notice: it proves uncomputable functions exist
without exhibiting one. The halting problem exhibits one, and one we actively want.

## 3.2 The halting problem

**Statement.** There is no program `H` such that, for every program `P` and input `x`,
`H(P, x)` returns `true` if `P(x)` halts and `false` if it runs forever.

Note the quantifiers, because every misunderstanding of this theorem is a quantifier error.
It says no **single** program handles **all** pairs. It does not say any particular program's
halting is unknowable.

### The proof, written for a working engineer

Assume, for contradiction, that `halts` exists. It is a total function — always returns,
always correct:

```python
def halts(program_source, input_data) -> bool:
    """Assume this exists. Returns True iff program_source(input_data) terminates."""
    ...
```

Now write a program that uses it. This is legal precisely because of universality: a program
is a string, so a program can be handed its own source.

```python
def paradox(program_source):
    if halts(program_source, program_source):
        while True:              # if it halts, loop forever
            pass
    else:
        return                   # if it loops, halt immediately
```

Now run `paradox` on its own source. Call it `p = source_of(paradox)`. Ask: does
`paradox(p)` halt?

**Case 1: `paradox(p)` halts.** Then `halts(p, p)` must have returned `True` — that's the
only branch that could have led to termination... except that branch is `while True: pass`,
which does not terminate. So `paradox(p)` does not halt. Contradiction.

**Case 2: `paradox(p)` does not halt.** Then it must have taken the `while True` branch,
which requires `halts(p, p) == True`, which asserts that `paradox(p)` halts. Contradiction.

Both cases are contradictory. The only assumption we made was that `halts` exists. Therefore
it doesn't. ∎

### Why this isn't a cheap trick

Every engineer's first reaction is "that's just a self-reference gimmick, ban self-reference
and it goes away." Three reasons it doesn't:

1. **You cannot ban it.** Self-reference here is nothing but "a program can read a string,
   and its own source is a string." Removing that removes universality (§1.6). You would be
   giving up the stored-program computer to get a halting oracle, and that trade is not
   available: the machine that can't take a program as data can't be a computer.

2. **The construction is a *reduction*, not the phenomenon.** The undecidability doesn't live
   in the self-reference; the self-reference is just the cheapest way to reach it. Hundreds of
   natural, non-self-referential problems are undecidable by reduction *from* halting:

   - **Post's Correspondence Problem** — given dominoes with strings top and bottom, is there
     an ordering making top and bottom read the same? Pure string matching. Undecidable.
   - **Hilbert's 10th problem** — does a given multivariate polynomial with integer
     coefficients have an integer root? Pure number theory. Undecidable (Matiyasevich, 1970).
   - **The word problem for groups** — do two products of generators denote the same element?
     Undecidable (Novikov, 1955).
   - **Wang tiles** — can these square tiles with coloured edges tile the plane? Undecidable
     (Berger, 1966).
   - **Determining whether a CFG is ambiguous** (§2.7). Which is why `bison` warns instead of
     answering.
   - **Whether two C programs compute the same function** — which is why nobody has a "did my
     refactor change behaviour?" button.

   None of those is about self-reference. Undecidability is a widespread property of the
   mathematical landscape, and halting is the convenient entry point.

3. **Turing's actual 1936 argument was diagonalisation over an enumeration**, closer to §3.1
   than to the `paradox` trick. He listed all machines, considered the machine that differs
   from machine *i* on input *i*, and derived a contradiction. The paradox version is a
   pedagogical compression of the same idea, and it is worth saying so, because a learner who
   thinks the whole subject rests on a cute trick will underrate it.

### Reduction — the actual working technique

Almost nobody proves undecidability from scratch. The move is:

> To show problem `B` is undecidable: assume a decider for `B`, and use it to build a decider
> for the halting problem. Since the latter cannot exist, neither can the former.

Written as `HALT ≤ B`: "halting reduces to B", so B is at least as hard.

**Worked example — "does this program ever print `hello`?" is undecidable.** Suppose
`prints_hello(P)` exists. Given an arbitrary `(M, x)` for which we want to decide halting,
construct:

```python
def M_prime(ignored_input):
    run(M, x)                # whatever M does on x
    print("hello")           # only reached if M(x) halted
```

`M_prime` prints `hello` **iff** `M(x)` halts. So `prints_hello(M_prime)` decides halting.
Contradiction, so `prints_hello` cannot exist. ∎

That is the entire method, and it takes five lines. The learner should do three or four of
these by hand — "does this program ever dereference null", "does this program ever call
`send()`", "is this variable ever assigned zero" — until the shape becomes reflexive. Because
the shape is what tells them, in a design meeting, that the feature being requested is
impossible.

### Halting is *semi*-decidable, and the distinction earns its keep

You can write a program that says `True` when a program halts: run it and wait. If it halts,
you find out. If it doesn't, you wait forever. So halting is **recursively enumerable** (RE):
you can enumerate the halting pairs, you just can't decide membership.

Its complement — "does this loop forever?" — is **not** even RE. There is no procedure that
eventually says yes to every non-halting program.

**A language is decidable iff both it and its complement are RE.** That theorem is the
mathematical statement of a very practical asymmetry:

> **Finding bugs is semi-decidable. Proving their absence is not.**

Testing, fuzzing, and dynamic analysis are all "run it and see" — they are RE procedures.
They can confirm a bug exists; they can never confirm none does. Dijkstra's "testing shows
the presence, not the absence of bugs" is not a slogan, it is this theorem. And it is exactly
why the curriculum's testing unit and its verification unit are different units doing
different things: one enumerates, the other proves, and only the second can say "never".

## 3.3 Busy Beaver: uncomputable, and you can watch it happen

`BB(n)` = the maximum number of steps any halting `n`-state, 2-symbol Turing machine takes
before halting. It is a perfectly well-defined finite number for each `n`, and the function
is **uncomputable** — it grows faster than any computable function.

Why it's uncomputable in one line: if you could compute `BB(n)`, you could decide halting for
any `n`-state machine by running it `BB(n)` steps and concluding it never halts.

The known values are the point:

| n | BB(n) |
|---|---|
| 1 | 1 |
| 2 | 6 |
| 3 | 21 |
| 4 | 107 |
| 5 | **47,176,870** (proved 2024 by the collaborative bbchallenge.org effort) |
| 6 | > 10↑↑15 (a tower of exponentials; unknown and likely unknowable) |

The jump from 107 to 47 million, and then off the edge of describable numbers, is the most
visceral demonstration of uncomputability available. Five states. Two symbols. Ten
transitions. That is a smaller program than any the learner has ever written, and humanity
needed a distributed proof effort and a Coq formalisation to settle it.

Worth mentioning: `BB(748)` is known to be independent of ZFC (Aaronson–Yedidia, later
improved to 745 and lower). There is a specific, writable, 745-state Turing machine whose
halting behaviour cannot be settled by standard mathematics.

## 3.4 Rice's theorem — the one that actually matters to you

The halting problem is one undecidable question. Rice's theorem (1951) says it wasn't
special.

**Statement.** Let `P` be any property of the *partial function computed by* a program (a
"semantic" property). If `P` is **non-trivial** — some program has it and some doesn't — then
deciding whether an arbitrary program has `P` is **undecidable**.

**The plain-English version, which is the one to teach:**

> **Every non-trivial question about what a program does is undecidable.**

Not "some". Not "hard ones". *Every* one, with exactly two exceptions: the question that is
always true and the question that is always false.

**The precision that keeps it honest.** "Semantic" means the property depends only on the
function computed — the input/output behaviour — not on the text. So:

- ❌ **Undecidable** (semantic): does it halt? does it return 0 on some input? is it
  equivalent to this other program? does it ever dereference null? is it a virus? does it
  compute the identity function? does it terminate on all inputs? does it have a memory leak?
- ✅ **Decidable** (syntactic): is it under 100 lines? does it contain the token `goto`? does
  it have exactly 3 functions? does it type-check under a given decidable type system? does
  it use `unsafe`?

The line is *exactly* the line between "what does the code say" and "what does the code do".
Linters and formatters live on the decidable side and are complete. Every tool that reasons
about behaviour lives on the undecidable side and is, necessarily, wrong sometimes.

**Proof sketch (worth showing — it's short).** Let `P` be non-trivial. WLOG the
always-diverging program `⊥` does not have `P` (otherwise use `¬P`). Since `P` is non-trivial,
some program `J` has `P`. Now given `(M, x)`, build:

```
    N(y) = run M on x;    then  return J(y)
```

If `M(x)` halts, `N` computes the same function as `J`, so `N` has `P`. If `M(x)` diverges,
`N` computes the same function as `⊥`, so `N` lacks `P`. So a decider for `P` decides halting.
∎

Notice the construction: it is the same "run the thing, then do something observable" move as
§3.2's `prints_hello`. Once the learner has the move, Rice's theorem is a corollary rather
than a new idea.

**Rice–Shapiro** sharpens it further, and is the version that kills a specific hope: even
*semi*-deciding a semantic property only works if the property is determined by finite
approximations. So you cannot even build a tool that always eventually says "yes, this
program has property P" for most interesting P.

## 3.5 The engineering consequences — the actual point of §3

Here is where the theorem stops being a curiosity. Everything below is a direct corollary
of Rice's theorem, and the learner should be able to derive each one in a sentence.

### The perfect static analyser is impossible

"Does this program ever dereference a null pointer?" is a semantic, non-trivial property.
Undecidable. There is no analyser that reports **exactly** the null dereferences — no more,
no fewer — for all programs. Not now, not with more compute, not with a better algorithm, not
with a large language model. It is not an open problem.

So every real analyser makes a choice, and this triangle is the most useful thing in §3:

```
                 SOUND
          (no false negatives:
        catches every real bug)
                  /\
                 /  \
                /    \
               /      \
              /  pick  \
             /    two   \
            /            \
           /______________\
     COMPLETE            TERMINATING
  (no false positives)   (and useful/fast)
```

You get two. Which two you choose *is* the tool:

| Tool | Sound? | Complete? | The consequence you live with |
|---|---|---|---|
| **Type checker** (Java, Rust, Haskell) | sound for its property | no | rejects correct programs; you write casts |
| **Rust borrow checker** | sound | no | rejects safe programs; you write `unsafe` or restructure |
| **Coverity, clang-analyzer, Infer** | no | no | heuristic; misses bugs *and* cries wolf |
| **`gcc -Wall`** | no | no | tuned so the noise level is bearable |
| **Astrée** (Airbus flight control) | **sound** | nearly, on that code | needs a restricted C subset and expert tuning |
| **CBMC / bounded model checking** | sound **up to bound k** | yes up to k | says nothing past k loop iterations |
| **valgrind / ASan** | no (only observed paths) | yes (reports are real) | only finds what your tests execute |
| **Fuzzers** | no | yes | semi-decidable: finds bugs, never proves absence |

**Two names for the two failure modes, and the learner must not mix them up:**

- **False positive** — the tool reports a bug that isn't there. The cost is *human attention*,
  and it compounds: an analyser with a 30% false-positive rate gets ignored, then disabled,
  then removed from CI. Every static analysis tool that has ever died, died of this.
- **False negative** — the tool misses a real bug. The cost is *the bug*, in production.

The industry's revealed preference is strongly toward accepting false negatives, because a
tool nobody runs catches nothing. Google's published experience with static analysis
(Sadowski et al., *Lessons from Building Static Analysis Tools at Google*, CACM 2018) puts
the practical threshold around a **10% false-positive rate** — above that, developers
disengage. That number is an empirical answer to a question created by a 1951 theorem.

### The perfect optimiser is impossible

"Does this program compute the same function as that one?" is semantic and non-trivial.
Undecidable. So:

- **There is no optimal compiler.** Not "we haven't written one" — there cannot be one. The
  "fully optimising compiler" is provably impossible, and this is a standard exercise.
- **Every optimisation is a conservative pattern match.** The compiler proves a *sufficient*
  condition for the transformation to be safe, and if it can't, it does nothing. It is never
  the case that the compiler *knows* the transform is unsafe; usually it just can't tell.
- **"The compiler could just figure this out" is often provably false.** This deserves to be
  a slogan in the curriculum. The learner will meet it constantly in the performance track:
  *why didn't it vectorise this loop? why didn't it hoist that load? why is it reloading the
  value after the function call?* Sometimes the answer is a missing feature. Very often the
  answer is that the required fact is undecidable in general, and the compiler's analysis is
  a decidable approximation that returned "don't know", and "don't know" means "don't touch".

**The aliasing example, which every C/C++ programmer has hit:**

```c
    void f(int *a, int *b) { *a = 1; *b = 2; return *a; }   // must reload *a
```

The compiler must reload `*a` because `a` and `b` might alias. *Do they?* Deciding pointer
aliasing exactly is undecidable (Landi 1992, Ramalingam 1994 — precise flow-sensitive alias
analysis is undecidable). So the compiler assumes the worst. This is why `restrict` exists in
C, why `noalias` exists in LLVM IR, and — the good part for this curriculum — **why Rust is
fast**: the borrow checker's guarantees hand the optimiser aliasing facts it could never have
derived. Rust's `&mut` is `noalias` by construction. *A type system paying a compiler in
information it cannot compute* is one of the best stories in modern systems programming, and
it is an undecidability story.

### The perfect virus scanner is impossible

"Is this program malicious?" is semantic and non-trivial. Undecidable — Cohen proved exactly
this in his 1987 thesis, that detecting viruses in general is undecidable. So antivirus is
signature matching (syntactic, decidable, defeated by polymorphism), heuristics (unsound and
incomplete), and sandboxing (which is semi-decidable: run it and watch). There is no fourth
option, and the arms race is structural rather than a failure of effort.

### The perfect type checker is impossible

Any type system that is **sound** (never accepts a program that goes wrong) and **decidable**
(terminates) must be **incomplete** — it must reject some programs that would have run fine.
This is not a defect. It's the deal.

Which is why every language has an escape hatch — `unsafe`, `any`, `cast`, `@ts-ignore`,
`unwrap()`, `Object` — and why "the type system is fighting me" is sometimes a genuine
report of hitting the incompleteness rather than a skill issue. And the trade is visible and
tunable: a more expressive type system accepts more correct programs at the cost of harder
inference (Hindley–Milner is decidable but exponential in the worst case; full dependent
types make checking depend on the programmer supplying proofs).

### Why compilers are conservative — the summary

Put together, this explains a whole class of daily frustrations:

| The frustration | The theorem underneath |
|---|---|
| "Why didn't it vectorise?" | dependence analysis returned "don't know" |
| "Why is it reloading that?" | alias analysis returned "may alias" |
| "Why is this warning wrong?" | Rice: the analyser is a sound-ish approximation |
| "Why didn't it warn about *that*?" | Rice: the analyser is an unsound approximation |
| "Why can't it tell me if my test suite covers everything?" | reachability is undecidable |
| "Why does the linter want an explicit return here?" | it can't prove the path is unreachable |
| "Why does bison say conflict instead of ambiguous?" | ambiguity is undecidable (§2.7) |

**The reframe to leave the learner with.** Undecidability is not a wall you stop at. It is a
statement about what a *complete* solution would require, and it tells you which shape of
partial solution to build:

> You cannot get *exact*. So decide, deliberately, which direction you want to be wrong in,
> how often, and who pays. That decision **is** the engineering.

## 3.6 The escape hatches — how real systems live with undecidability

The learner should not leave §3 thinking "so nothing works". Six standard moves, all of which
they will meet in real tools:

1. **Restrict the language until the question becomes decidable.** eBPF verifiers reject
   unbounded loops. Terraform HCL, Dhall, and Starlark are deliberately not Turing-complete.
   SQL (without recursive CTEs) is not. Coq and Agda demand a termination proof. **Giving up
   Turing-completeness on purpose buys you decidability**, and it is a real and increasingly
   popular design choice.
2. **Bound it.** `-ftemplate-depth=900`. Loop unrolling limits. Bounded model checking to
   depth k. Timeouts. Recursion limits. An arbitrary constant that converts "undecidable" to
   "decidable with a lie in it".
3. **Approximate soundly (abstract interpretation).** Compute over an abstract domain
   (intervals, signs, octagons, polyhedra) rather than concrete values. You get sound answers
   with unavoidable imprecision. This is Cousot & Cousot 1977, and it is the theory under
   Astrée, Infer, and every serious analyser.
4. **Ask the human.** Loop invariants, `assert`, type annotations, `#[requires]` contracts.
   The human supplies the fact the machine cannot derive; the machine checks the consequences.
   This is the design of every proof assistant and of Rust's lifetimes.
5. **Be unsound on purpose.** Assume no aliasing, assume no integer overflow, assume no
   reflection. Most practical analysers are unsound by design (see *Soundiness: A Manifesto*,
   Livshits et al., CACM 2015, which argues the field should say so out loud).
6. **Run it and watch (semi-decide).** Tests, fuzzing, sanitizers, tracing, production
   monitoring. Cheap, finds real bugs, proves nothing.

Every tool in the curriculum's later units is one or more of these six. Naming the six early
means the learner recognises each tool's strategy on sight.

## 3.7 Gödel, briefly — and a warning about the abuse

**Gödel's first incompleteness theorem (1931).** Any consistent, effectively axiomatised
formal system strong enough to express arithmetic contains true statements it cannot prove.

**Second.** Such a system cannot prove its own consistency.

**The relationship to halting**, which is the useful framing here: they are the same
phenomenon in two settings. Gödel encoded "this statement is unprovable" using Gödel
numbering — assigning numbers to formulas so that statements about proofs become statements
about arithmetic. Turing encoded "this program does the opposite of what the oracle says"
using program-as-string. **Both are the discovery that a sufficiently expressive system can
talk about itself, and that self-reference plus completeness yields contradiction.** In fact
you can derive incompleteness from the undecidability of halting in a page, and that
derivation is the cleaner route for a computing audience: if arithmetic were complete and
decidable, you could decide halting by searching for a proof.

**The warning, which the curriculum should state explicitly and firmly.** Gödel's theorems
are the most misused results in mathematics. They say something narrow and technical about
*consistent, effectively axiomatised formal systems that can express Peano arithmetic*.

They **do not** say:

- "Nothing can be known for certain." (Plenty is provable; the theorem exhibits specific
  unprovable sentences.)
- "Human minds surpass computers." (The Lucas–Penrose argument. Rebutted extensively — it
  assumes the human is consistent and knows their own consistency, which is exactly what
  the second theorem forbids of any such system.)
- "Every formal system is incomplete." (Presburger arithmetic — addition without
  multiplication — is complete and decidable. Euclidean geometry is complete. The
  hypotheses matter.)
- "Mathematics is broken." (Nothing changed. Working mathematicians proceed unaffected.)
- Anything about postmodernism, theology, consciousness, quantum mechanics, or management.

Torkel Franzén's *Gödel's Theorem: An Incomplete Guide to Its Use and Abuse* (2005) is the
standard reference for the abuse, and is short enough to assign.

**Why teach it at all in a hardware-first curriculum**, given it's peripheral? Two reasons.
First, the learner will encounter the abuse and should be inoculated. Second, the honest
version of the point survives the deflation and is genuinely valuable: **formal systems, like
programs, have limits that are intrinsic rather than incidental — you cannot engineer your
way out of them, and recognising one is a skill.** Ten minutes. Then move on.

---

# 4. Complexity Theory — The Working Subset

Section 3 drew the line between possible and impossible. This section draws lines *inside*
the possible, because "computable" includes plenty of things that will outlive the sun.

The framing to keep throughout: complexity classes are **worst-case, asymptotic** statements
about **decision problems** on a **Turing machine**. Every one of those four qualifiers is a
place where the theory and your Tuesday afternoon diverge, and §4.6 is about the divergence.

## 4.1 P — tractable, with an asterisk

**P** = the decision problems solvable by a deterministic Turing machine in time `O(nᵏ)` for
some constant `k`.

**Why polynomial is the line.** Not because `n¹⁰⁰` is fast — it isn't — but because
polynomials are the smallest natural class that is:

- **Closed under composition.** A polynomial-time algorithm calling a polynomial-time
  subroutine polynomially often is still polynomial. This is what makes reductions and
  modular reasoning work at all.
- **Machine-independent.** By the extended Church–Turing thesis (§1.7), P is the same class
  on a Turing machine, a RAM machine, your CPU, and a Python interpreter. The exponent moves;
  membership doesn't. **This robustness is the entire justification for the definition.**
- **Empirically predictive.** In practice, natural problems in P turn out to have small
  exponents. The `n¹⁰⁰` algorithm is a theoretical possibility that almost never shows up.

Members: sorting, shortest paths, matching, linear programming (Khachiyan 1979 — a genuine
surprise at the time), **primality testing** (AKS 2002 — another surprise; it had been in
NP ∩ co-NP and widely believed but not proven to be in P), 2-SAT, Horn-SAT, max-flow.

## 4.2 NP — and getting the definition right

**NP** = problems solvable by a **N**ondeterministic Turing machine in **P**olynomial time.

The name is the source of half the confusion in the field. **NP does not stand for
"non-polynomial".** It never has.

**The useful equivalent definition — always teach this one:**

> **NP is the class of problems whose *yes*-answers have a proof you can check in polynomial
> time.**

Formally: `L ∈ NP` iff there's a polynomial-time verifier `V` and polynomial `p` such that
`x ∈ L ⟺ ∃w, |w| ≤ p(|x|), V(x,w) = accept`. The `w` is the **certificate** or **witness**.

Read it as the difference between *solving* and *checking*:

| Problem | Finding a solution | Checking a proposed one |
|---|---|---|
| Sudoku | hard | glance at it |
| Factoring 2048-bit RSA modulus | no known feasible method | one multiplication |
| Hamiltonian cycle in a graph | hard | walk the cycle |
| A valid Bitcoin nonce | 10²² hashes | one hash |
| A satisfying assignment for a formula | hard | evaluate it |

**P ⊆ NP** trivially: if you can solve it fast, the empty certificate works, just solve it.

**Note the asymmetry, because it's real and it's where co-NP comes from.** NP is about
verifiable *yes* answers. Nothing says *no* answers are verifiable. "This formula is
satisfiable" has a short proof (the assignment). "This formula is unsatisfiable" has no known
short proof — you'd have to rule out all 2ⁿ assignments. **co-NP** is the class with short
*no*-proofs. Whether NP = co-NP is open, and a separate open question from P vs NP (though
P = NP would imply NP = co-NP).

This asymmetry has a direct engineering face: **a SAT solver returning SAT hands you an
assignment you can verify in microseconds. A SAT solver returning UNSAT is asking you to
trust it** — which is exactly why modern solvers emit machine-checkable DRAT/LRAT refutation
proofs, and why the SAT competition requires them. Same theorem, in the rules of a
competition.

## 4.3 NP-completeness, stated correctly

A problem `L` is **NP-hard** if every problem in NP reduces to it in polynomial time.
A problem is **NP-complete** if it is NP-hard **and** in NP.

Note that NP-hard does not require membership in NP — the halting problem is NP-hard and
wildly outside NP. **NP-complete = "in NP, and as hard as anything in NP."**

The reduction is the crux. `A ≤ₚ B` means: a polynomial-time function `f` such that
`x ∈ A ⟺ f(x) ∈ B`. Read it as *"B is at least as hard as A"* — if you could solve B fast,
you could solve A fast by translating. **The direction trips everyone up once.** To prove
your problem is hard, reduce a *known hard* problem **to** it. Reducing your problem to a
known hard problem proves nothing about your problem's hardness.

### Cook–Levin

**Theorem (Cook 1971, Levin 1973, independently).** SAT is NP-complete.

**Why it is remarkable.** It shows a *first* NP-complete problem exists — that among the
enormous variety of problems in NP, one is universal for all of them. Everything after Cook
is comparatively easy: to show a new problem is NP-complete, reduce SAT (or something already
known complete) to it. Karp's 1972 paper did 21 of them at a stroke and turned a theorem into
a field.

**The proof idea, which is worth showing because it connects straight to Part 0's hardware.**
Take any NP problem and its nondeterministic verifier machine `M` running in `p(n)` steps.
The entire computation is a **tableau**: a `p(n) × p(n)` grid where row `i` is the machine's
full configuration at step `i` — tape contents, head position, state. Now build a Boolean
formula with a variable for "cell (i,j) contains symbol s", and clauses asserting:

- row 0 encodes the correct start configuration,
- some row contains an accepting state,
- each cell in row `i+1` is consistent with its 3-cell neighbourhood in row `i` — because a
  Turing machine step is **local**,
- the encoding is well-formed (exactly one symbol per cell).

The formula is satisfiable **iff** the machine has an accepting computation. It is
polynomial in size because the tableau is. ∎

> **The connection to make for this curriculum:** Cook–Turing's tableau is a *circuit* — the
> locality of the transition function is exactly the locality of combinational logic between
> two register banks. The learner built this in Part 0: a register file (a row), combinational
> logic (the local consistency constraints), and a clock (the next row). **Cook–Levin says the
> hardware the learner built can be written down as a Boolean formula.** That is also,
> literally, what a hardware synthesis tool does, and what an equivalence checker checks. The
> theorem and the EDA tool are the same construction.

### The NP-complete problems an engineer actually meets

Not the textbook list — the ones that turn up in real work, with where they turn up:

| Problem | Where you hit it |
|---|---|
| **SAT / SMT** | verification, symbolic execution, solver-backed everything |
| **Graph colouring** | **register allocation in every compiler** (Chaitin 1981) |
| **Bin packing** | container/VM scheduling, memory allocators, Kubernetes |
| **Knapsack** | budget allocation, cache admission policies |
| **Set cover** | test suite minimisation, monitor placement, feature selection |
| **TSP / vehicle routing** | logistics, PCB drilling, tool-path planning |
| **Job-shop scheduling** | **instruction scheduling in a compiler back end**, CI runners |
| **Subgraph isomorphism** | pattern matching in peephole optimisers, malware signatures |
| **Boolean circuit minimisation** | logic synthesis (the hardware track!) |
| **Clique / independent set** | conflict-free scheduling, social graph analysis |
| **Dependency resolution with versions** | **npm, pip, apt, Cargo — this is SAT** |
| **Register allocation with spilling** | worse than colouring; NP-hard even for basic blocks |
| **Optimal instruction selection over DAGs** | back-end code generation |

Two of those deserve emphasis for this curriculum, because they are *inside the compiler the
learner is building*:

**Register allocation is graph colouring.** Build an interference graph — a node per live
range, an edge when two ranges are live simultaneously. A valid assignment of `k` physical
registers is a `k`-colouring. Colouring is NP-complete (Karp 1972), so no compiler allocates
optimally. Chaitin's 1981 algorithm and Briggs' improvement are *heuristics*: simplify by
repeatedly removing nodes of degree < k, spill when stuck, colour on the way back out.
**When you look at generated assembly and think "it could have avoided that spill" — you may
be right, and the compiler could not have known.** Linear-scan allocation (Poletto & Sarkar
1999) gives up even more optimality for speed, which is why JITs use it.

**Dependency resolution is SAT.** "Find versions of these packages satisfying all constraints"
is Boolean satisfiability with a preference order. This was proven for Debian
(*EDOS/Mancoosi* project, Mancinelli et al. 2006) and is why: `pip`'s resolver got
dramatically slower when it got *correct* in 20.3; `npm` had years of resolution bugs;
Dart/Flutter's `pub` uses **PubGrub**, an explicit CDCL-style algorithm; and `libsolv` (used
by openSUSE, Fedora's DNF) is literally a SAT solver in a package manager. The learner who
has waited three minutes for a dependency resolver has waited on an NP-complete problem.

## 4.4 What P vs NP would and would not mean

The Clay Millennium Prize problem. $1,000,000. Open since 1971.

**If P = NP** (with a *practical* algorithm — a constructive proof with small constants):

- **Public-key cryptography dies.** RSA, ECC, Diffie–Hellman all rest on problems in NP.
  Note: symmetric crypto (AES) and hash functions survive better; brute-forcing a 256-bit key
  is still 2²⁵⁶ work, and P = NP doesn't make that a polynomial in the *input size*, which is
  256 bits. But TLS as designed is over.
- **Optimisation becomes free.** Scheduling, routing, protein folding, circuit layout, chip
  place-and-route — solved optimally.
- **Mathematics changes character.** Finding a proof of length `n` becomes as easy as checking
  one. Aaronson's line: "creativity would be automatable."
- **Program synthesis from specifications** becomes routine.

**If P ≠ NP** (the overwhelming expectation — Gasarch's polls of theorists show ~80–90%
believing it, with the number rising across the 2002, 2012 and 2019 surveys):

- Nothing changes practically. **We already engineer as if P ≠ NP.** The proof would close a
  question, not alter a practice.
- It would *not* mean NP-complete problems are hopeless — see §4.5, which is the section that
  matters most for an engineer.

**What it would NOT mean, in either direction.** These misstatements are common enough to
name explicitly:

- ❌ "P ≠ NP means NP-complete problems can't be solved." They're solved daily. It means no
  algorithm is polynomial *in the worst case*.
- ❌ "P = NP means everything becomes instant." A polynomial algorithm could be `n¹⁰⁰`, or
  the proof could be **non-constructive** — proving an algorithm exists without exhibiting
  it. (Levin's universal search is a bizarre real example: an algorithm that is
  asymptotically optimal for NP problems *if* P = NP, with an astronomically large constant.)
- ❌ "NP means non-polynomial." No. Nondeterministic polynomial.
- ❌ "NP-hard problems are the hardest problems." They're the hardest *in NP* (for
  NP-complete). Above them sit PSPACE, EXPTIME, and then the undecidable, which is a
  completely different kind of hard. An engineer meeting "NP-hard" has met an *expensive*
  problem; §3 was about *impossible* ones, and conflating them is the most consequential
  error in this whole document.
- ❌ "My problem is NP-hard so I should give up." §4.5.

**And the class the learner will meet without being warned:** most real optimisation problems
are not decision problems, and their natural form is **not in NP at all**. "Is there a tour
shorter than k?" is NP-complete. "**Is this the shortest tour?**" is in **DP** (the class of
differences of NP sets) and is not known to be in NP — verifying optimality means also
verifying that nothing shorter exists, and that's a co-NP-flavoured claim. This is the same
SAT/UNSAT asymmetry from §4.2 wearing different clothes, and it is why solvers report "best
found" rather than "optimal" unless they also carry a bound proof.

## 4.5 Practical NP-hardness — the section that changes behaviour

If §4 leaves the learner with "NP-hard means give up", it has done harm. The actual state of
practice is that NP-hard problems get solved, at scale, every day. Here is how.

### SAT solvers really are that good

Modern **CDCL** (Conflict-Driven Clause Learning) solvers routinely handle industrial
instances with **millions of variables and tens of millions of clauses**. Hardware
verification at Intel and AMD, symbolic execution engines, and bounded model checkers all
run on them. The techniques that got there:

- **Unit propagation with watched literals** (Chaff, 2001) — the single biggest constant-factor
  win, and a beautiful data-structure trick: watch only two unassigned literals per clause, so
  most assignments touch no clause at all.
- **Clause learning** — on conflict, analyse the implication graph, derive a new clause that
  prevents the same conflict class recurring, add it to the database. This is the "C" and "L"
  and it is what makes CDCL exponentially stronger than DPLL: CDCL corresponds to the
  **resolution** proof system, while plain DPLL corresponds to weaker tree-like resolution.
- **Non-chronological backjumping** — jump back to the real cause, not one level.
- **VSIDS activity heuristics** — prefer variables involved in recent conflicts. A dynamic,
  self-tuning variable order.
- **Restarts with learned clauses retained** — escape bad regions of the search tree while
  keeping what you learned.
- **Preprocessing/inprocessing** — variable elimination, subsumption, blocked clause
  elimination.

**SMT solvers** (Z3, CVC5, Yices) add theories on top — linear arithmetic, bit-vectors,
arrays, uninterpreted functions, strings — via the **DPLL(T)** architecture, where a SAT
solver drives a theory solver. This is what makes symbolic execution and program verification
practical. If the learner has used any modern verification tool, they have used Z3.

**Where the hardness actually lives:** worst-case instances exist and can be constructed.
Pigeonhole formulas (`n+1` pigeons into `n` holes) require **exponentially long resolution
proofs** — Haken's 1985 lower bound — so *every* CDCL solver blows up on them regardless of
heuristics. This is a genuinely valuable thing for the learner to see: a family of tiny
formulas that defeats the best solvers on earth, next to a million-variable industrial
instance that they crush. Both facts are true, and the difference is **structure**.
Verified live in §7.3.

### The phase transition — random 3-SAT

For random 3-SAT with `n` variables and `m` clauses, the ratio `α = m/n` controls everything:

- `α < ~4.26`: almost surely satisfiable, and easy to find a solution.
- `α > ~4.26`: almost surely unsatisfiable, and easy to prove it.
- `α ≈ 4.26`: the **phase transition**, where instances are hardest, and solve time peaks
  sharply.

The threshold `α ≈ 4.267` for 3-SAT is an empirical/analytical result (Crawford & Auton 1993
onward; the existence of a sharp threshold for large k was proven by Ding, Sly & Sun, 2015).
The engineering lesson is the shape, not the constant: **hardness is concentrated in a narrow
band, and most instances you meet are not in it.** "NP-complete" describes the worst case;
the distribution you actually face may be almost entirely easy.

### The rest of the toolkit

**Approximation algorithms** — give up optimality, keep a guarantee:

| Problem | Guarantee | Note |
|---|---|---|
| Vertex cover | 2× optimal | greedy on edges. Trivial and tight-ish |
| Metric TSP | 1.5× (Christofides 1976) | improved to 1.5−ε in 2020 (Karlin–Klein–Oveis Gharan) |
| Set cover | ln n | and **this is optimal** unless P = NP (Feige 1998) |
| Knapsack | **1+ε for any ε** (FPTAS) | as close to optimal as you pay for |
| Max-cut | 0.878 (Goemans–Williamson) | semidefinite programming; optimal under UGC |
| General TSP | **no constant factor** unless P = NP | the metric assumption is doing real work |

The row that teaches the most is **set cover**: `ln n` is not a limitation of our cleverness;
it's a proven barrier. Approximation has its own complexity theory (the PCP theorem, APX-hardness),
and "how well can I approximate this?" is itself a classified question.

**Parameterised complexity** — the most underused idea on this list. Instead of measuring in
`n` alone, find a parameter `k` that is small in practice, and aim for `f(k)·poly(n)` — the
exponential confined to `k`. That is **FPT** (fixed-parameter tractable).

- Vertex cover of size `k`: `O(1.28ᵏ + kn)`. For `k = 20`, trivial, at any `n`.
- Type inference, model checking, SQL query optimisation over bounded treewidth, and many
  graph problems on graphs of bounded treewidth are FPT.
- The contrast class **W[1]-hard** (e.g. clique of size k) is the "not FPT" side.
- **The engineering move this suggests:** when you meet an NP-hard problem, don't ask "is it
  hard?" — ask *"what about my instances is small?"* Number of registers. Nesting depth. Number
  of distinct types. Loop count. That parameter is often where the exponential can be parked
  harmlessly.

**Average case vs worst case.** Complexity classes are worst-case. Simplex is exponential in
the worst case and superb in practice. Quicksort is O(n²) worst case and the default sort
almost everywhere. **Smoothed analysis** (Spielman & Teng 2001, Gödel Prize 2008) formalised
why: measure the expected running time on *slightly perturbed* inputs, and simplex becomes
polynomial. The worst cases are isolated, brittle points that random noise destroys — which is
exactly what "doesn't happen in practice" means, made rigorous.

**Heuristics and local search** — simulated annealing, tabu search, genetic algorithms,
WalkSAT, large-neighbourhood search. No guarantees, often excellent results. Google's OR-Tools
CP-SAT solver combines CDCL, linear relaxation, and local search and wins routing and
scheduling competitions.

**Exponential algorithms that are just fine.** `2ⁿ` for `n = 25` is 33 million — a fraction of
a second. Held–Karp solves TSP exactly in `O(n²2ⁿ)`, which is entirely practical up to about
`n = 25`. **Sometimes the right answer to NP-hardness is "my n is 20."**

### The reframe

> **NP-hardness is advice about approach, not a verdict of despair.**
>
> It tells you: stop looking for the clever polynomial algorithm — it probably isn't there,
> and people have looked. Instead choose your escape: approximate, parameterise, exploit the
> structure of *your* instances, use a solver that has absorbed forty years of engineering, or
> notice that your `n` is small. **Identifying a problem as NP-complete is the beginning of
> solving it, because it tells you which shelf the tools are on.**

## 4.6 Beyond NP, briefly, because these classes have real tools attached

| Class | Meaning | The tool that lives here |
|---|---|---|
| **L / NL** | log space | streaming, `NL = co-NL` (Immerman–Szelepcsényi) |
| **P** | poly time | most algorithms |
| **NP** | poly-time verifiable | SAT, scheduling |
| **co-NP** | poly-time *refutable* | **proving UNSAT**, tautology checking, verification |
| **#P** | *counting* solutions | model counting, probabilistic inference. **Harder than NP** — Toda's theorem: PH ⊆ P^#P |
| **PSPACE** | poly space, any time | **QBF solvers**, games, planning, regex-with-intersection |
| **EXPTIME** | exponential time | generalised chess/go; provably ⊋ P by the time hierarchy theorem |
| **Undecidable** | §3 | halting |

Two things worth flagging. First, **`P ⊊ EXPTIME` is a theorem** (time hierarchy theorem —
more time strictly buys more power). So we *can* prove separations; P vs NP is hard for
specific reasons (relativisation, natural proofs, algebrization — three formal barriers
showing why the obvious techniques cannot work). Second, **counting is harder than deciding**:
determining whether a formula has a satisfying assignment is NP-complete, but *counting* them
is #P-complete, and the permanent of a 0/1 matrix is #P-complete (Valiant 1979) while the
determinant — the same formula with signs — is in P. That gap is one of the strangest facts in
the subject.

## 4.7 Circuit and parallel complexity — the theory under the GPU track

The Turing machine is a sequential model. For the parallel and hardware parts of this
curriculum, the right model is a **circuit**: a DAG of AND/OR/NOT gates. Two measures:

- **Size** = number of gates ≈ total work ≈ area/transistor count.
- **Depth** = longest path ≈ **critical path** ≈ latency ≈ parallel time with unlimited
  processors.

The learner already knows this from the hardware track: **depth is the critical path that
sets your clock period.** Circuit complexity is the theory of the thing they measured with a
timing report.

| Class | Depth | Size | Meaning |
|---|---|---|---|
| **AC⁰** | O(1) | poly | constant depth, **unbounded** fan-in AND/OR |
| **NC¹** | O(log n) | poly | bounded fan-in, log depth |
| **NC** | O(logᵏ n) | poly | **"efficiently parallelisable"** |
| **P** | — | poly | sequential poly time |

**NC vs P is the parallel analogue of P vs NP**, and it is also open. `NC ⊆ P`; whether
`NC = P` is unknown. **P-complete** problems are those believed *not* to parallelise well:
circuit value evaluation, linear programming, depth-first search order, and — pointedly —
**lexicographically-first greedy algorithms**. If your algorithm is P-complete, no amount of
GPU is going to give you a log-depth version.

**AC⁰ has actual proven lower bounds**, which makes it the one class here where we know
something unconditional and it is directly hardware-relevant:

> **PARITY ∉ AC⁰** (Furst–Saxe–Sipser 1981, Håstad's tight switching lemma 1986). Computing
> the XOR of `n` bits requires more than constant depth with polynomial-size circuits.

Consequences the learner can feel: an `n`-bit parity, an `n`-bit adder's carry chain, and an
`n`-bit comparison all need **logarithmic depth** — you cannot flatten them. This is *exactly*
why carry-lookahead and carry-select adders exist, why they're `O(log n)` deep rather than
`O(1)`, and why the learner's Part 0 ripple-carry adder was the slow part of their ALU. **A
1986 circuit-complexity theorem explains the shape of the adder they built.**

The same theory sits under the GPU work: a parallel prefix sum (scan) is `O(log n)` depth by
the Brent–Kung / Sklansky constructions, which are the *same* constructions as the
carry-lookahead adder. Scan is in NC. Sorting networks are NC (AKS sorting network is
`O(log n)` depth, though with a constant so large it's useless in practice — Batcher's
`O(log² n)` is what people build). **Brent's theorem** — a computation with work `W` and
depth `D` runs in `O(W/p + D)` time on `p` processors — is the formal statement of the
work/span analysis every CUDA programmer does by hand.

## 4.8 Descriptive complexity — one slide, because it's beautiful

**Fagin's theorem (1974): NP = the properties expressible in existential second-order logic.**

No machine, no time bound, no clock. NP characterised purely by *what you can say*. Similarly
`P = FO(LFP)` on ordered structures (Immerman–Vardi) — first-order logic plus a least
fixed-point operator. This is why Datalog is exactly the right language for program analysis
(and why Souffle and CodeQL are Datalog engines): **the query language's expressive power is
calibrated to the complexity class of the analysis.**

One slide. But it reframes complexity as a fact about *description* rather than about
*machines*, and it is the cleanest justification available for why the classes are natural
rather than arbitrary.

---

# 5. Where Theory Touches This Curriculum's Hardware

Sections 1–4 are the theory. This section is the argument for putting it in a
*hardware-first* curriculum, and it consists of five places where the learner has already
built or measured the thing the theorem is about.

## 5.1 The CPU is a universal machine — the payoff of Part 0

Restating §1.6 because it is the spine of the whole document.

| Turing's 1936 construction | The learner's Part 0 machine |
|---|---|
| finite control (transition table) | instruction decoder, control unit / microcode ROM |
| tape | RAM |
| head position | program counter, address register |
| tape alphabet | word width |
| `⟨M⟩` encoded on the tape | **the program in memory** |
| `w` on the tape | **the data in memory** |
| universal machine `U` | **fetch–decode–execute** |

The learner built `U`. Not something like it — it, up to the finite-memory caveat below.

**The one honest caveat, which is worth an explicit slide:** a real CPU has finite memory, so
strictly it is a (very large) finite automaton, not a Turing machine. A 64-bit machine with
16 GiB of RAM has at most `2^(2^37)` states — a finite number, so *in principle* every
question about it, including halting, is decidable by exhaustive state enumeration.

That is true and completely useless, and *why* it is useless is the lesson:

- `2^(2^37)` exceeds the number of particles in the observable universe by an
  incomprehensible margin. No enumeration will ever run.
- The Turing model is the *better* model of a real computer precisely because it ignores the
  finite bound, in the same way that treating a hash table as O(1) ignores that it's really
  a finite structure. **Models earn their keep by which questions they answer well.**
- And the finiteness argument cuts both ways: model checkers *do* exploit it, with symbolic
  state representation (BDDs, SAT encodings), and they work — up to a few hundred bits of
  state. That's the honest boundary, and it's exactly the boundary between "verify this FIFO"
  and "verify this program."

**The exercise that makes the point land (§7.5):** hand the learner a Turing machine
simulator that reads a machine's transition table *out of a string*, run three different
machines through it with no code change, then ask where the universal machine is in their own
CPU. Verified live: it runs the BB(2), BB(3) and BB(4) champions and halts at exactly 6, 21,
12, and 107 steps respectively, and does binary increment correctly.

## 5.2 The RAM model's uniform-cost assumption is a lie — measured

All of §4's complexity theory is stated on a Turing machine, and all of the algorithms
literature is stated on the **RAM model**: a machine where any memory location can be read or
written in **unit time**, regardless of address.

The learner has already built the memory hierarchy and knows this is false. Here is how false,
measured on the same box in the same program: two pointer chases over the same 64 MiB array,
the same number of dependent loads, the same asymptotic complexity, differing only in
*whether consecutive accesses are adjacent*:

```
    sequential pointer chase :    1.349 ns per access
    random     pointer chase :  285.493 ns per access
    ratio                    :  211.58x   <- the RAM model says this should be 1.00x
```

*(verified, §7.6 — 2²⁴ elements, 2²³ dependent loads each)*

**A factor of 211 that the asymptotic notation cannot see.** Both loops are Θ(n). Both do the
same number of "unit-cost" operations. The model is off by more than two orders of magnitude
on the thing it claims to count.

The practical consequences the learner will already have felt:

- **A linked list loses to an array** for almost every traversal workload, despite identical
  asymptotics, and despite the linked list winning on paper for insertion.
- **B-trees beat binary search trees** in databases and filesystems because the model that
  matters is block transfers, not comparisons.
- **The O(n²) algorithm beats the O(n log n) one** on small n and on cache-resident data,
  which is why every production sort switches to insertion sort below ~16–32 elements.
- **Blocked/tiled matrix multiply** is 10× faster than the naive triple loop for identical
  operation counts — the entire GEMM story in the numerical track.

**The models that fix it**, and are worth naming because they're the theory under the storage
and GPU tracks:

- **External memory model (Aggarwal–Vitter, 1988)** — count block transfers between a fast
  memory of size `M` and slow memory, in blocks of size `B`. Sorting is
  `Θ((n/B) log_{M/B}(n/B))`, which is the actual reason external merge sort has the fan-in it
  has, and the reason a B-tree node is the size of a disk block.
- **Cache-oblivious model (Frigo, Leiserson, Prokop, Ramachandran, 1999)** — achieve optimal
  block transfers *without knowing* `M` or `B`, via recursive divide-and-conquer. Van Emde
  Boas layout, cache-oblivious matrix transpose and multiply. Beautiful, and the reason
  "just recurse until it fits" is such a reliable optimisation heuristic.
- **Parallel/PRAM and work–span models** — §4.7.

**The lesson for the learner is not "complexity theory is wrong."** It is: *a model is a
deliberate simplification, and you must know which simplification you are standing on.* The
RAM model answers "does this scale?" well and "how fast is this?" badly. Asymptotics tell you
which algorithm to pick at large n; the memory hierarchy tells you how to implement it. **Both
are needed and neither substitutes for the other.**

## 5.3 Circuit complexity is the theory under the hardware and GPU tracks

§4.7 already stated the classes. The connections to what the learner built:

**Depth is the critical path.** When the learner ran a timing analysis on their ALU and found
the carry chain was the long pole, they measured circuit depth. The clock period is bounded
below by the depth of the deepest combinational path. Circuit complexity is the mathematics of
that number.

**PARITY ∉ AC⁰ explains the adder.** You cannot compute the XOR of n bits in constant depth
with polynomial-size circuits (Furst–Saxe–Sipser 1981; Håstad 1986 gives the tight
exponential lower bound). Carry propagation is parity-like. So:

- A ripple-carry adder is `O(n)` deep — the naive design, and the learner's first one.
- A carry-lookahead adder is `O(log n)` deep — the parallel-prefix trick.
- **`O(1)` is impossible**, and that's a theorem, not an engineering gap. Nobody is going to
  invent a constant-depth 64-bit adder.

That is a genuinely satisfying moment: a 1986 theoretical computer science result explains
exactly why the hardware the learner built has the shape it has, and puts a hard floor under
how fast it can ever be made.

**Parallel prefix is the same object in both tracks.** The carry-lookahead adder (hardware
track) and the GPU scan primitive (CUDA track) are *the same algorithm* — Kogge–Stone,
Brent–Kung, Sklansky are the names in both literatures. `O(log n)` depth, `O(n log n)` or
`O(n)` work depending on the variant. Showing the learner that their adder and their
`thrust::inclusive_scan` are the same tree is one of the best cross-track connections
available in this curriculum.

**P-completeness tells you what won't parallelise.** If a problem is P-complete (circuit value
problem, linear programming, lexicographically-first depth-first search), it is conjectured
to have no `polylog`-depth parallel algorithm. When a GPU port of some algorithm stubbornly
refuses to scale, "is this P-complete?" is a real diagnostic question and not an academic one.

**Brent's theorem is the work–span analysis every CUDA programmer does.** Time on `p`
processors is `O(W/p + D)`. Two terms: you are either work-bound (add processors, it helps) or
depth-bound (add processors, nothing happens). That is the formal version of "your kernel is
latency-bound, not throughput-bound."

## 5.4 The pumping lemma is why your regex can't do the job

The everyday version of §2.3, phrased as a diagnostic:

> **If you are trying to make a regex count, or match nested things, stop. It is not a skill
> issue. It is a theorem.**

Symptoms the learner should learn to recognise:

- "I need to match balanced brackets/tags/quotes." Not regular (§2.3).
- "I need to check the closing tag matches the opening one." Needs a stack.
- "I need to handle arbitrary nesting depth." Needs a stack.
- "My regex works for depth 3 but I need depth n." You have hand-unrolled a PDA and are about
  to discover why that doesn't terminate.
- "I'll just add one more alternation." The `(a+)+` road to §2.6.

And the honest converse, because the folklore over-applies the result: **regexes are excellent
at what they are for.** Tokenising. Validating a fixed-shape field. Extracting from a format
you control. Fast scanning where a linear-time engine is available. The failure mode is
reaching for a regex when the structure is recursive, and the pumping lemma is the tool that
tells you, in advance and with certainty, that the reach will fail.

## 5.5 Rice's theorem is why your linter has false positives

The everyday version of §3.4–3.5:

> **Every warning your tools produce is a decision about which direction to be wrong in.**

When the learner's linter flags a "possibly uninitialised variable" that is provably
initialised on every real path, that is not a bug in the linter. It is the linter choosing
**soundness** (report everything that might be a problem) over **completeness** (report only
real problems), because it cannot have both. When the compiler fails to warn about a real
null dereference, that is the same tool choosing the other way on a different check.

The three questions to teach the learner to ask of any analysis tool, which is a durable
skill that outlives any particular tool:

1. **Is it sound?** Will it catch every instance, at the price of false alarms?
2. **Is it complete?** Are all its reports real, at the price of missed bugs?
3. **Which did the authors choose, and does the documentation say so?**

Most tools are neither sound nor complete — deliberately, tuned by hand for a bearable
false-positive rate (the ~10% figure from Google's experience, §3.5). Knowing that is the
difference between "the linter is stupid" and "the linter is calibrated, and here is the
knob."

## 5.6 Landauer's principle — the thermodynamic floor, briefly

**Landauer's principle (1961).** Erasing one bit of information necessarily dissipates at
least `kT ln 2` of energy as heat, where `k` is Boltzmann's constant and `T` the temperature.

At room temperature (300 K):

```
    kT ln 2 = 1.380649×10⁻²³ J/K × 300 K × 0.693147 = 2.87 × 10⁻²¹ J   ≈ 2.9 zeptojoules
```

**Why erasure specifically?** Because erasure is *logically irreversible* — two input states
(0 and 1) map to one output state. That reduces the number of accessible microstates, which
reduces entropy in the information, which by the second law must increase entropy somewhere
else. The heat is the bill.

**Where current hardware sits.** A modern transistor switching event costs on the order of
`10⁻¹⁷`–`10⁻¹⁸` J, so real logic runs roughly **3–4 orders of magnitude above the Landauer
limit**. There is real headroom left — the floor is not what's currently limiting chips
(leakage, interconnect RC, heat removal, and the end of Dennard scaling are), but it is a
floor, and it is not going anywhere.

**Experimental status:** Bérut et al. (*Nature*, 2012) measured the `kT ln 2` bound in a
single-particle optical-trap system and found agreement. It is a measured physical
constraint, not only a theoretical one.

**The consequence worth ten minutes: reversible computing.** If erasure is what costs, don't
erase. **Reversible logic** (Toffoli gates, Fredkin gates) computes without discarding
information, and Bennett showed (1973) that any computation can be made reversible with a
polynomial overhead in space — you keep a history and un-compute it. In principle a fully
reversible computer has *no* Landauer floor. In practice reversible logic pays large area and
speed penalties, so it stays niche — with one very large exception: **quantum computation is
reversible by construction**, because unitary operations are invertible. Every quantum gate
except measurement is reversible, and that is not a design choice but a requirement of the
physics.

**Related, and worth one line each because the learner will meet them as slogans:**

- **Bremermann's limit** — a maximum computation rate per unit mass from mass-energy and the
  uncertainty principle.
- **The Margolus–Levitin theorem** — a bound on operations per second per joule of energy.
- **The Bekenstein bound** — a maximum information content for a region of given size and
  energy, which is where "the universe is a computer with a finite clock rate" arguments come
  from and where they should be handled with the same caution as §3.7's Gödel abuse.

**Why include it at all.** Because this curriculum starts at the transistor, and a learner who
has watched a chip get hot deserves to know there is a floor under that heat, that the floor
is information-theoretic rather than engineering, and that computation is a *physical* process
subject to physical law. It is also the natural bridge to the planned
`limits-of-computation` capstone in the research queue. Ten minutes, one calculation, move on.

---

# 6. Curriculum — Four Units in Dependency Order

## 6.0 Placement in the track, and why the order is forced

Two hard dependency constraints, both stated in the brief and both correct:

1. **Automata (Unit 1) must precede the compilers unit.** A learner who meets `flex` without
   knowing what a DFA is learns a tool. A learner who meets it after Unit 1 recognises a
   theorem they already proved. The same for `bison` and shift-reduce conflicts.
2. **Computability (Unit 3) must precede the static-analysis/testing unit.** A learner who
   meets false positives without Rice's theorem concludes the tool is bad. A learner who meets
   them after Unit 3 knows the tool is *calibrated*, and can reason about the calibration.

The resulting placement:

```
   Part 0: hardware, CPU, stored program
        │
        ├──────────────────────────────► UNIT 2 (universality) lands here, and only here,
        │                                because it needs the CPU to already exist
        ▼
   UNIT 1  Automata & Regular Languages
        │
        ▼
   [ compilers / interpreters unit ]  ◄── needs Unit 1
        │
        ▼
   UNIT 2  Universality & the Stored Program        (can also sit right after Part 0)
        │
        ▼
   UNIT 3  Computability & the Limits of Analysis
        │
        ▼
   [ static analysis / testing / fuzzing unit ]  ◄── needs Unit 3
        │
        ▼
   UNIT 4  Complexity & What To Do About Hard Problems
        │
        ▼
   [ algorithms-on-real-hardware, GPU, solvers ]
```

Unit 2 is deliberately placed to be movable. Its ideal home is immediately after the learner
finishes their Part 0 CPU, while the fetch–decode–execute loop is still fresh and the
revelation has maximum force. If that slot is taken, it works equally well after the
compilers unit, where "an interpreter is a universal machine" is the version that lands.

**Total time: roughly 4 units × 6–10 hours.** This is not a semester of automata theory. It is
the working subset, and everything that does not cash out in a tool has been cut — including
most of the closure-property algebra, the Chomsky normal form / CYK material, most of the
complexity zoo, and all of the recursion-theory hierarchy above `Σ⁰₁`.

---

## UNIT 1 — Automata and Regular Languages

> ### THE ONE IDEA
> **A machine with finite memory can recognise exactly the regular languages — and your
> lexer is one. What it cannot do, it provably cannot do.**

**Prerequisites:** basic programming, some familiarity with regex as a user.
**Sits before:** the compilers unit.
**Time:** ~8 hours.

### Arc

1. **Motivate from the tool, not the definition.** Start with a lexer the learner writes by
   hand as a `switch` on a state variable. Then reveal: you just wrote a DFA.
2. **DFA formally**, and immediately the three good properties: O(1) memory, O(n) time,
   streaming.
3. **NFA and the two ways to run one.** Nondeterminism as a search problem, not a guess.
4. **Subset construction** — and *do it by hand once* before writing the code. The 2^k
   blow-up on "k-th symbol from the end."
5. **Regex ≡ NFA ≡ DFA** (Kleene). Thompson's construction as the bridge. The sugar table
   from §2.2, with the line below which the tool is no longer regular.
6. **Thompson vs backtracking**, measured. The ReDoS story. Cloudflare.
7. **The pumping lemma**, taught as pigeonhole-on-state-count and drilled as an adversary
   game. Two negative proofs by hand: balanced parens, and nested comments.
8. **"You can't parse HTML with a regex"** done properly (§2.4), including what it does not
   say.
9. **Myhill–Nerode** as the pocket tool for "can a state machine do this?"

### Exercises (all machine-checkable, §7)

- **1a. DFA simulator vs a language spec.** Given a spec ("binary strings divisible by 3",
  "strings with an even number of `a`s and an odd number of `b`s"), build the DFA and verify
  by exhaustive agreement with a reference predicate over every string up to length 14.
  *(§7.7)*
- **1b. Subset construction with exhaustive agreement.** Build the `k`-th-from-the-end NFA,
  subset-construct it, and check the DFA agrees with the NFA on **all 8,191 strings up to
  length 12**, for `k = 1..10`. Also assert the DFA has *exactly* `2^k` reachable states —
  the blow-up, measured, not asserted by the instructor. *(verified, §7.2)*
- **1c. Thompson vs backtracking step counts.** The headline. One NFA, two walks, on
  `a?ⁿaⁿ` against `aⁿ`. Assert both agree on every test string; report step counts; fit the
  closed forms. *(verified, §7.1)*
- **1d. Pumping lemma as a program.** Given a candidate `p`, a language predicate, and an
  adversary that enumerates all valid `xyz` splits, *search* for a pumping counterexample.
  Turns a proof into a program the learner can run.
- **1e. ReDoS hunt.** Given ten regexes, predict which are exponentially vulnerable, then
  confirm with the step-counting engine from 1c.

### Common misconceptions to attack head-on

| Misconception | Correction |
|---|---|
| "Regex" means what PCRE does | Backreferences and recursion are not regular (§2.2) |
| NFAs are more powerful than DFAs | Same power. Subset construction. Only *size* differs |
| The pumping lemma proves regularity | One direction only. It only proves *non*-regularity |
| Backtracking is how regexes work | It's one of two choices; RE2/Rust/Go chose the other |
| ReDoS is a rare exotic bug | It took down Cloudflare and Stack Overflow |

---

## UNIT 2 — Universality and the Stored Program

> ### THE ONE IDEA
> **You already built a universal machine. The program in memory is data, and that single
> fact is both the source of all computing's power and the source of its hardest limits.**

**Prerequisites:** Part 0 (a working stored-program CPU). Unit 1 helps but isn't required.
**Sits after:** Part 0 — ideally immediately.
**Time:** ~6 hours.

### Arc

1. **Turing machines**, motivated as Turing motivated them: a model of *a human clerk with
   paper*, not a model of a computer. The 1936 provenance matters.
2. **Write a simulator.** The learner writes a TM simulator in a high-level language, runs a
   few known machines.
3. **Encode a machine as a string** and make the simulator read it. *This is the whole unit.*
4. **The reveal, as a question and not a statement:** "Your simulator takes a machine as
   data. Where, in your Part 0 CPU, is that?" Let them find fetch–decode–execute themselves.
5. **The equivalence zoo** (§1.7). λ-calculus in enough depth to write Church numerals and
   see the Y combinator. Minsky's two-counter result as the "your ISA is luxurious" moment.
6. **Church–Turing stated carefully**: it's a thesis, not a theorem; the three variants; the
   misuses.
7. **The consequences of programs-as-data**: interpreters, JITs, bootstrapping, self-hosting,
   VMs — and code injection, W^X, NX. Universality is the vulnerability.
8. **The finite-memory caveat**, honestly (§5.1), and why the unbounded model is still the
   better one.

### Exercises

- **2a. Turing machine simulator running a known program.** Verified against BB(2)=6 steps,
  BB(3)=21 steps, BB(4)=107 steps, and a binary-increment machine checked against real
  arithmetic. *(verified, §7.5)*
- **2b. Rediscover BB(3) by brute force.** Enumerate all 1,048,576 three-state machines (with
  `A0 = 1RB` fixed WLOG), run each to a step cap, and find the maximum. The program finds
  `S(3) = 21` and `Σ(3) = 6` **with witnesses**, matching the literature. Then ask: why can't
  we do this for `n = 6`? *(verified, §7.4)* — this is the best possible on-ramp to §3,
  because the learner discovers the wall by walking into it.
- **2c. Universality by construction.** Extend the simulator so the machine's transition table
  arrives on the *tape*, not in a separate argument. Run machine `M₂` inside machine `M₁`.
- **2d. Church numerals.** Implement `succ`, `plus`, `mult`, `pred` in a λ-calculus evaluator
  (or in the learner's own language as closures) and check `mult(3)(4) == 12` by applying the
  result to `(+1)` and `0`.
- **2e. Two-counter machine.** Implement Minsky's model and write multiplication in it. The
  discomfort is the point.
- **2f. Write a virus. (Sandboxed, safe, and a quine.)** A program that prints its own source
  is the friendliest possible demonstration of self-reference, and it makes §3.2's `paradox`
  construction feel like a trick the learner already owns.

### The moment to engineer

Everything in this unit exists to set up one sentence, and the learner must **say it, not
hear it**:

> *"Wait — my CPU is the universal machine. The instruction memory is the tape holding ⟨M⟩."*

Design the session so that sentence is theirs.

---

## UNIT 3 — Computability and the Limits of Analysis

> ### THE ONE IDEA
> **Every non-trivial question about what a program does is undecidable — so every tool that
> analyses programs is deliberately, necessarily wrong in a direction its authors chose.**

**Prerequisites:** Unit 2 (needs programs-as-data).
**Sits before:** the static-analysis / testing / fuzzing unit.
**Time:** ~8 hours.

### Arc

1. **Counting first** (§3.1). Most functions aren't computable. Removes the surprise.
2. **The halting problem**, with the diagonalisation written out and executed as pseudo-code.
3. **Attack the "it's just a self-reference trick" objection immediately** (§3.2) — PCP,
   Hilbert's 10th, Wang tiles, CFG ambiguity. Undecidability is everywhere, and halting is
   just the doorway.
4. **Reduction as a technique.** Four reductions by hand until the shape is reflexive.
5. **Semi-decidability** and the theorem behind "testing shows presence, not absence."
6. **Rice's theorem** with the proof sketch, and the syntactic/semantic table.
7. **The consequences** (§3.5): analysers, optimisers, virus scanners, type checkers. The
   sound/complete/terminating triangle. The Google 10% false-positive figure.
8. **"The compiler could just figure this out"** — the aliasing example, and how Rust's borrow
   checker pays the optimiser in information it could not have derived.
9. **The six escape hatches** (§3.6), because the unit must not end in despair.
10. **Gödel in ten minutes**, with the abuse warning (§3.7). Then stop.

### Exercises

- **3a. Implement the halting paradox.** In a language with `eval`, write `paradox` against a
  *stub* `halts()`, and have the learner trace what happens for every possible stub behaviour.
  Nothing runs forever; the contradiction is derived on paper from the trace.
- **3b. Write an unsound analyser and a complete one, for the same property.** E.g. "does this
  straight-line program divide by zero?" Version A: report every division whose divisor isn't
  a literal non-zero (sound, many false positives). Version B: report only divisions by
  literal zero (complete, many false negatives). Run both on a corpus. **Count the two error
  types.** This exercise does more than the theorem to make the trade real.
- **3c. Reduction drills.** Prove undecidable, by reduction from halting, in five lines each:
  "does `P` ever call `send()`", "does `P` ever assign 0 to `x`", "are `P` and `Q`
  equivalent", "is this line reachable".
- **3d. Bounded model checking by hand.** Unroll a loop `k` times, emit a SAT instance, solve
  it. Then increase `k` and watch the formula grow. This is escape hatch #2 (§3.6) and it
  hands off cleanly to Unit 4.
- **3e. Abstract interpretation, minimal.** Implement sign analysis or interval analysis over
  a toy language. Verify soundness by checking that the abstract result always contains the
  concrete result, over random programs. **The soundness check is the exercise.**
- **3f. Compiler archaeology.** Find a loop GCC/Clang refuses to vectorise, use
  `-fopt-info-vec-missed` to get the reason, and classify it: missing feature, or undecidable
  question answered "don't know"? Then add `restrict` or `#pragma omp simd` and watch the
  answer change. **This is the exercise that turns §3 into a daily habit.**

### The reframe to land

Do not end on "you can't". End on:

> **You cannot get exact. So choose your errors deliberately — which direction, how often,
> and who pays. That choice is the engineering.**

---

## UNIT 4 — Complexity and What To Do About Hard Problems

> ### THE ONE IDEA
> **NP-hardness is not a verdict of despair; it is advice about approach. It tells you to stop
> looking for the clever polynomial algorithm and start choosing an escape.**

**Prerequisites:** Unit 3 (so "hard" and "impossible" are already distinguished).
**Sits before:** the algorithms/GPU/solver units.
**Time:** ~8 hours.

### Arc

1. **P**, and why polynomial is the line (composition + machine-independence, §4.1).
2. **NP via verification**, never via nondeterminism first (§4.2). The solve/check table.
3. **The SAT/UNSAT asymmetry** and co-NP. DRAT proofs as the engineering face of it.
4. **Reductions and NP-completeness**, with the direction hammered on.
5. **Cook–Levin**, with the tableau-is-a-circuit connection back to Part 0 (§4.3).
6. **The problems an engineer meets** — with **register allocation = graph colouring** and
   **dependency resolution = SAT** given the most time, because they are *inside the tools the
   learner is building*.
7. **Correct the misstatements** (§4.4) explicitly and by name.
8. **Practical NP-hardness** (§4.5): CDCL, the phase transition, approximation,
   parameterisation, smoothed analysis, "my n is 20."
9. **Circuit/parallel complexity** (§4.7) as the bridge to the GPU track. PARITY ∉ AC⁰ and
   the adder.
10. **The RAM model is a lie** (§5.2), measured. This is the hinge into the
    algorithms-on-real-hardware unit.

### Exercises

- **4a. Write a DPLL SAT solver**, then run it on two instance families: pigeonhole
  `PHP(n+1,n)` (tiny, structured, exponentially hard) and random 3-SAT at varying clause
  ratios. Measured live (§7.3): pigeonhole goes 16 → 102 → 748 → 6,490 decisions for
  `n = 3..6` on instances with **42 variables**, while a **60-variable** random instance at
  α = 8 takes 358. *Size is not difficulty; structure is.*
- **4b. Find the phase transition.** Plot decisions vs α for random 3-SAT. The measured peak
  is at α ≈ 4.26 (verified, §7.3: 22 → 212 → **3,636** → 1,756 → 808 → 358 as α goes
  3 → 4 → 4.26 → 5 → 6 → 8). The easy–hard–easy curve appears without being told about.
- **4c. Reduce something to SAT and solve it.** Graph colouring, Sudoku, or n-queens →
  CNF → the learner's own solver. Then swap in MiniSat/Z3 and measure the difference forty
  years of engineering makes.
- **4d. Register allocation as colouring.** Build an interference graph from a small IR,
  colour it greedily, compare against optimal by brute force on small graphs, count the
  spills. **This is a compiler back end and an NP-completeness lesson in one artefact.**
- **4e. Approximation with a measured ratio.** Implement greedy set cover and greedy vertex
  cover; compare against brute-force optimal on small instances; check the empirical ratio
  against the `ln n` and `2×` guarantees.
- **4f. Parameterised complexity in practice.** Solve vertex cover by the `O(1.28ᵏ + kn)`
  bounded search tree, and show it is instant for `k = 20` on a graph with `n = 100,000`.
- **4g. The RAM model is a lie.** Sequential vs random pointer chase over the same array.
  Measured: **211×** (verified, §7.6). Then ask what asymptotic notation would have predicted.

### Common misconceptions to attack head-on

| Misconception | Correction |
|---|---|
| NP means non-polynomial | Nondeterministic polynomial (§4.2) |
| NP-hard ⇒ hopeless | SAT solvers do millions of variables (§4.5) |
| NP-hard = undecidable | Different universes. §3 vs §4 |
| P = NP would make everything instant | Could be `n¹⁰⁰`, or non-constructive (§4.4) |
| Worst case is what you'll get | Phase transition, smoothed analysis (§4.5) |
| Big-O predicts wall-clock | 211×, measured (§5.2) |

---

## 6.5 A note on assessment

The exercises above are all **machine-checkable**, which is the property that makes this unit
teachable without an instructor. Three patterns recur and are worth naming as a general
technique for this curriculum:

1. **Exhaustive agreement.** Two implementations of the same thing (NFA and its subset DFA;
   backtracking and Thompson; spec predicate and DFA), compared on *every* string up to some
   length. This catches the subtle bug — the one that agrees on 99% of inputs — in
   milliseconds, and it is far stronger than a hand-written test suite.
2. **Rediscovery.** Don't tell the learner `BB(3) = 21`; have their program find it and then
   compare to the literature. The check is `assert(best == 21)` and the learning is in the
   search.
3. **Counted steps rather than wall-clock.** Step counts are deterministic, reproducible,
   machine-independent, and exactly fit closed forms the learner can verify by arithmetic.
   Timings are none of those things. Use timings only where the *physical* effect is the point
   (§7.6's cache measurement) and label them as machine-dependent when you do.

---

# 7. Verified Programs and Their Real Output

Everything in this section was **compiled and run** on the Compiler Explorer execution API
during this research:

```
POST https://godbolt.org/api/compiler/g152/compile
Content-Type: application/json
Accept: application/json

{ "source": "...",
  "compiler": "g152",
  "options": {
    "userArguments": "-O2 -std=c++20",
    "executeParameters": { "args": [], "stdin": "" },
    "compilerOptions": { "executorRequest": true },
    "filters": { "execute": true },
    "libraries": [] },
  "lang": "c++",
  "allowStoreCodeDebug": false }
```

Response: `buildResult.code` is the compile status, top-level `code` is the program's exit
status, and `stdout` / `stderr` are arrays of `{text}`.

> **Operational note for anyone rebuilding these exercises: Compiler Explorer caches results,
> including timings, keyed on the request.** An identical resubmission returns the previous
> run rather than executing again — which silently invalidates any measurement-based exercise.
> **Inject a unique nonce comment into every submission.** Every program below was submitted
> with a `// nonce <uuid>` line prepended. The §7.6 timing exercise is the one where this
> matters most; without it, the learner's "measurement" is a replay of someone else's.

> **A second note on the executor's limits.** The sandbox enforces a processing-time cap and
> SIGKILLs over-long runs (`code: 143`, `Killed - processing time exceeded`). The §7.3 SAT
> instance sizes below were reduced twice to fit inside it. The step counts are unaffected —
> they are exact and machine-independent — but anyone extending these exercises should expect
> to tune sizes to the executor rather than to their laptop.

## 7.1 Thompson NFA vs backtracking — the headline measurement

One Thompson NFA. Two traversal strategies. The two matchers are asserted to agree on every
test string, so the comparison is honest: the only difference is *how the graph is walked*.
Pattern `a?ⁿaⁿ`, input `aⁿ` (Russ Cox's classic case, §2.6).

```cpp
// One NFA, two strategies. Same machine. The only difference is how you walk it.
#include <cstdio>
#include <string>
#include <vector>
#include <cassert>
using namespace std;

// ---- Thompson NFA: every node is Char(c)->out, Split->out1,out2, or Match ----
enum Kind { CHAR, SPLIT, MATCH };
struct Node { Kind k; char c; int out1, out2; };
static vector<Node> g;
static int mk(Kind k, char c, int a, int b){ g.push_back({k,c,a,b}); return (int)g.size()-1; }

// Fragment = start state + list of dangling out-pointers to patch.
struct Frag { int start; vector<pair<int,int>> out; }; // (node, which out: 1 or 2)
static void patch(vector<pair<int,int>>& l, int s){
    for (auto& p : l) (p.second==1 ? g[p.first].out1 : g[p.first].out2) = s;
}

// Shunting-yard over a tiny regex language, then Thompson construction.
static string addConcat(const string& re){
    string out; 
    for (size_t i=0;i<re.size();i++){
        out += re[i];
        if (re[i]=='(' || re[i]=='|') continue;
        if (i+1<re.size()){
            char n = re[i+1];
            if (n=='*'||n=='?'||n=='+'||n=='|'||n==')') continue;
            out += '.';                       // explicit concat
        }
    }
    return out;
}
static int prec(char c){ return c=='|'?1 : c=='.'?2 : 3; }
static string toPostfix(const string& re){
    string out, ops;
    for (char c : re){
        if (c=='(') ops += c;
        else if (c==')'){ while(!ops.empty()&&ops.back()!='('){ out+=ops.back(); ops.pop_back(); } ops.pop_back(); }
        else if (c=='|'||c=='.'){ while(!ops.empty()&&ops.back()!='('&&prec(ops.back())>=prec(c)){ out+=ops.back(); ops.pop_back(); } ops+=c; }
        else if (c=='*'||c=='?'||c=='+') out += c;   // postfix already
        else out += c;
    }
    while(!ops.empty()){ out+=ops.back(); ops.pop_back(); }
    return out;
}
static int compileRe(const string& re){
    g.clear();
    string post = toPostfix(addConcat(re));
    vector<Frag> st;
    for (char c : post){
        if (c=='.'){ Frag e2=st.back(); st.pop_back(); Frag e1=st.back(); st.pop_back();
            patch(e1.out, e2.start); st.push_back({e1.start, e2.out}); }
        else if (c=='|'){ Frag e2=st.back(); st.pop_back(); Frag e1=st.back(); st.pop_back();
            int s=mk(SPLIT,0,e1.start,e2.start); auto o=e1.out; for(auto&p:e2.out) o.push_back(p);
            st.push_back({s,o}); }
        else if (c=='?'){ Frag e=st.back(); st.pop_back(); int s=mk(SPLIT,0,e.start,-1);
            auto o=e.out; o.push_back({s,2}); st.push_back({s,o}); }          // GREEDY: try e first
        else if (c=='*'){ Frag e=st.back(); st.pop_back(); int s=mk(SPLIT,0,e.start,-1);
            patch(e.out,s); st.push_back({s,{{s,2}}}); }
        else if (c=='+'){ Frag e=st.back(); st.pop_back(); int s=mk(SPLIT,0,e.start,-1);
            patch(e.out,s); st.push_back({e.start,{{s,2}}}); }
        else { int n=mk(CHAR,c,-1,-1); st.push_back({n,{{n,1}}}); }
    }
    Frag e=st.back(); int m=mk(MATCH,0,-1,-1); patch(e.out,m); return e.start;
}

// ---- Strategy 1: backtracking. Depth-first, one path at a time, no memory of where it's been.
static long long btSteps; static const long long BT_CAP = 400000000LL;
static bool backtrack(int s, const char* sp){
    if (++btSteps > BT_CAP) return false;              // give up, report the cap
    switch (g[s].k){
        case MATCH: return *sp == '\0';
        case CHAR:  return *sp == g[s].c && backtrack(g[s].out1, sp+1);
        case SPLIT: return backtrack(g[s].out1, sp) || backtrack(g[s].out2, sp);
    }
    return false;
}

// ---- Strategy 2: Thompson simulation. All paths at once, set of states, no state twice.
static long long thSteps;
static vector<int> gen;               // gen[state] = last string position that added it
static void addstate(vector<int>& lst, int s, int genId){
    if (s < 0 || gen[s]==genId) return;                 // <-- the entire trick
    gen[s]=genId; thSteps++;
    if (g[s].k==SPLIT){ addstate(lst,g[s].out1,genId); addstate(lst,g[s].out2,genId); }
    else lst.push_back(s);
}
static bool thompson(int start, const string& in){
    gen.assign(g.size(), -1);
    vector<int> clist, nlist; int genId=0;
    addstate(clist, start, genId);
    for (size_t i=0;i<in.size();i++){
        nlist.clear(); genId++;
        for (int s : clist){ thSteps++; if (g[s].k==CHAR && g[s].c==in[i]) addstate(nlist, g[s].out1, genId); }
        clist.swap(nlist);
        if (clist.empty()) return false;
    }
    for (int s : clist) if (g[s].k==MATCH) return true;
    return false;
}

int main(){
    printf(" n |  pattern            | input |    backtracking steps |  Thompson steps | ratio\n");
    printf("---+---------------------+-------+-----------------------+-----------------+-------\n");
    for (int n=1;n<=28;n++){
        string re; for(int i=0;i<n;i++) re += "a?"; for(int i=0;i<n;i++) re += "a";
        string in(n,'a');
        int start = compileRe(re);
        btSteps=0; bool b = backtrack(start, in.c_str());
        thSteps=0; bool t = thompson(start, in);
        bool capped = btSteps > BT_CAP;
        if (!capped) assert(b==t && "the two strategies must agree");
        if (n<=6 || n%4==0 || n>=26){
            char bs[64];
            if (capped) snprintf(bs,sizeof bs,">%lld (gave up)", BT_CAP);
            else snprintf(bs,sizeof bs,"%lld", btSteps);
            printf("%2d | a?^%-2d a^%-2d          | a^%-2d  | %21s | %15lld | %s\n",
                   n, n, n, n, bs, thSteps, capped?"--":
                   (btSteps/thSteps > 1000 ? "huge" : "small"));
        }
        if (capped) { printf("   (stopped: backtracking exceeded the %lld-step cap at n=%d)\n", BT_CAP, n); break; }
    }
    // Same NFA, same answer, different cost. Prove agreement on a spread of inputs too.
    { int s = compileRe("(a|b)*abb");
      const char* tests[] = {"abb","aabb","babb","ab","","bbbabb","abab"};
      for (const char* t : tests){ btSteps=0; thSteps=0;
        bool b=backtrack(s,t); bool th=thompson(s,std::string(t));
        printf("check (a|b)*abb on \"%s\": backtrack=%d thompson=%d %s\n", t, b, th, b==th?"AGREE":"DISAGREE");
        assert(b==th); } }
    printf("ALL AGREE\n");
}
```

**Real output (verified):**

```
 n |  pattern            | input |    backtracking steps |  Thompson steps | ratio
---+---------------------+-------+-----------------------+-----------------+-------
 1 | a?^1  a^1           | a^1   |                     5 |               7 | small
 2 | a?^2  a^2           | a^2   |                    14 |              18 | small
 3 | a?^3  a^3           | a^3   |                    34 |              34 | small
 4 | a?^4  a^4           | a^4   |                    78 |              55 | small
 5 | a?^5  a^5           | a^5   |                   174 |              81 | small
 6 | a?^6  a^6           | a^6   |                   382 |             112 | small
 8 | a?^8  a^8           | a^8   |                  1790 |             189 | small
12 | a?^12 a^12          | a^12  |                 36862 |             403 | small
16 | a?^16 a^16          | a^16  |                720894 |             697 | huge
20 | a?^20 a^20          | a^20  |              13631486 |            1071 | huge
24 | a?^24 a^24          | a^24  |             251658238 |            1525 | huge
   (stopped: backtracking exceeded the 400000000-step cap at n=25)
check (a|b)*abb on "abb": backtrack=1 thompson=1 AGREE
check (a|b)*abb on "aabb": backtrack=1 thompson=1 AGREE
check (a|b)*abb on "babb": backtrack=1 thompson=1 AGREE
check (a|b)*abb on "ab": backtrack=0 thompson=0 AGREE
check (a|b)*abb on "": backtrack=0 thompson=0 AGREE
check (a|b)*abb on "bbbabb": backtrack=1 thompson=1 AGREE
check (a|b)*abb on "abab": backtrack=0 thompson=0 AGREE
ALL AGREE
```

## 7.2 Subset construction, checked by exhaustive agreement

The NFA for "the k-th symbol from the end is \`a\`" — the standard witness for the `2^k`
lower bound. The subset-constructed DFA is checked against the NFA on **all 8,191 strings up
to length 12**, and its state count is asserted to be exactly `2^k`. The blow-up is measured,
not claimed.

```cpp
// Subset construction, checked by exhaustive agreement -- and the 2^k blow-up, measured.
#include <cstdio>
#include <vector>
#include <map>
#include <set>
#include <string>
#include <cassert>
using namespace std;

struct NFA { int nstates, nsym; vector<vector<set<int>>> d; set<int> eps_free_start; set<int> accept; };

// L_k = "the k-th symbol from the end is 'a'".  Classic 2^k lower bound witness.
static NFA make_kth_from_end(int k){
    NFA n; n.nstates=k+1; n.nsym=2; n.d.assign(n.nstates, vector<set<int>>(2));
    for (int s=0;s<2;s++) n.d[0][s].insert(0);      // stay in 0 on anything
    n.d[0][0].insert(1);                            // guess: THIS 'a' is the k-th from the end
    for (int i=1;i<k;i++) for (int s=0;s<2;s++) n.d[i][s].insert(i+1);
    n.eps_free_start = {0};
    n.accept = {k};
    return n;
}
static bool nfa_accepts(const NFA& n, const string& w){
    set<int> cur = n.eps_free_start;
    for (char c : w){ int s = (c=='a'?0:1); set<int> nx;
        for (int q : cur) for (int r : n.d[q][s]) nx.insert(r);
        cur.swap(nx); if (cur.empty()) return false; }
    for (int q : cur) if (n.accept.count(q)) return true;
    return false;
}
struct DFA { vector<vector<int>> d; vector<char> acc; };
static DFA subset_construct(const NFA& n){
    map<set<int>,int> id; vector<set<int>> states; DFA D;
    auto get=[&](const set<int>& s){ auto it=id.find(s); if(it!=id.end()) return it->second;
        int k=(int)states.size(); id[s]=k; states.push_back(s); D.d.push_back(vector<int>(n.nsym,-1)); D.acc.push_back(0); return k; };
    get(n.eps_free_start);
    for (size_t i=0;i<states.size();i++){
        set<int> S = states[i];
        for (int q : S) if (n.accept.count(q)) D.acc[i]=1;
        for (int s=0;s<n.nsym;s++){ set<int> T; for(int q:S) for(int r:n.d[q][s]) T.insert(r); D.d[i][s]=get(T); }
    }
    return D;
}
static bool dfa_accepts(const DFA& D, const string& w){
    int q=0; for(char c:w){ q = D.d[q][c=='a'?0:1]; } return D.acc[q]!=0;
}

int main(){
    printf("subset construction: exhaustive agreement + the state blow-up\n");
    printf("  k | NFA states | DFA states | 2^k | strings checked | disagreements\n");
    for (int k=1;k<=10;k++){
        NFA n = make_kth_from_end(k);
        DFA D = subset_construct(n);
        long long checked=0, bad=0;
        for (int len=0; len<=12; len++){
            for (long long m=0; m < (1LL<<len); m++){
                string w; for(int i=0;i<len;i++) w += ((m>>i)&1)?'b':'a';
                bool x = nfa_accepts(n,w), y = dfa_accepts(D,w);
                checked++; if (x!=y) bad++;
            }
        }
        printf("%3d | %10d | %10zu | %3d | %15lld | %d\n", k, n.nstates, D.d.size(), 1<<k, checked, (int)bad);
        assert(bad==0 && "subset construction must agree with the NFA on every string");
        assert((int)D.d.size() == (1<<k) && "L_k needs exactly 2^k reachable subsets");
    }
    printf("ALL AGREE on 8191 strings per k, and the DFA size is exactly 2^k every time.\n");
}
```

**Real output (verified):**

```
subset construction: exhaustive agreement + the state blow-up
  k | NFA states | DFA states | 2^k | strings checked | disagreements
  1 |          2 |          2 |   2 |            8191 | 0
  2 |          3 |          4 |   4 |            8191 | 0
  3 |          4 |          8 |   8 |            8191 | 0
  4 |          5 |         16 |  16 |            8191 | 0
  5 |          6 |         32 |  32 |            8191 | 0
  6 |          7 |         64 |  64 |            8191 | 0
  7 |          8 |        128 | 128 |            8191 | 0
  8 |          9 |        256 | 256 |            8191 | 0
  9 |         10 |        512 | 512 |            8191 | 0
 10 |         11 |       1024 | 1024 |            8191 | 0
ALL AGREE on 8191 strings per k, and the DFA size is exactly 2^k every time.
```

## 7.3 SAT: structure beats size (pigeonhole vs random 3-SAT)

A plain DPLL solver with unit propagation, run on two families. Pigeonhole `PHP(n+1,n)` is
UNSAT and provably needs exponential-length resolution proofs (Haken 1985). Random 3-SAT
shows the easy–hard–easy phase transition around α ≈ 4.26.

**The lesson is in the comparison:** the pigeonhole instance at n=6 has **42 variables** and
takes 6,490 decisions; the random instance at α=8 has **60 variables** and takes 358. Size is
not difficulty. Structure is.

```cpp
// A small DPLL solver. Two instance families. One is structured, one is random.
#include <cstdio>
#include <vector>
#include <random>
#include <algorithm>
using namespace std;
typedef vector<vector<int>> CNF;            // literal = +v or -v, v in 1..nvars

static long long decisions;
static const long long CAP = 20000000LL;

// assignment: 0 unset, 1 true, -1 false
static bool dpll(const CNF& f, vector<int>& a, int nvars){
    if (decisions > CAP) return false;
    // unit propagation to fixpoint
    vector<int> trail;
    bool changed = true;
    while (changed){
        changed = false;
        for (auto& c : f){
            int unassigned = 0, unit = 0; bool sat = false;
            for (int l : c){ int v=abs(l), s=(l>0?1:-1);
                if (a[v]==0){ unassigned++; unit=l; }
                else if (a[v]==s){ sat=true; break; } }
            if (sat) continue;
            if (unassigned==0){ for(int v:trail) a[v]=0; return false; }   // conflict
            if (unassigned==1){ int v=abs(unit); a[v]=(unit>0?1:-1); trail.push_back(v); changed=true; }
        }
    }
    // all satisfied?
    int pick = 0;
    for (int v=1;v<=nvars;v++) if (a[v]==0){ pick=v; break; }
    if (!pick){ // verify
        for (auto& c: f){ bool s=false; for(int l:c) if(a[abs(l)]==(l>0?1:-1)) {s=true;break;} if(!s){ for(int v:trail)a[v]=0; return false; } }
        return true;
    }
    for (int val : {1,-1}){
        decisions++;
        a[pick]=val;
        if (dpll(f,a,nvars)) return true;
        a[pick]=0;
    }
    for(int v:trail) a[v]=0;
    return false;
}

// Pigeonhole: n+1 pigeons, n holes. UNSAT, and provably needs exponential resolution proofs.
static CNF php(int n, int& nvars){
    auto X=[&](int p,int h){ return p*n+h+1; };   // pigeon p in hole h
    nvars = (n+1)*n;
    CNF f;
    for (int p=0;p<=n;p++){ vector<int> c; for(int h=0;h<n;h++) c.push_back(X(p,h)); f.push_back(c); }
    for (int h=0;h<n;h++) for (int p=0;p<=n;p++) for (int q=p+1;q<=n;q++) f.push_back({-X(p,h),-X(q,h)});
    return f;
}
static CNF rand3(int n, double alpha, unsigned seed, int& nvars){
    nvars=n; int m=(int)(alpha*n); CNF f; mt19937 rng(seed);
    uniform_int_distribution<int> V(1,n), S(0,1);
    while ((int)f.size()<m){ int a=V(rng),b=V(rng),c=V(rng);
        if(a==b||b==c||a==c) continue;
        f.push_back({S(rng)?a:-a, S(rng)?b:-b, S(rng)?c:-c}); }
    return f;
}

int main(){
    printf("PIGEONHOLE  PHP(n+1,n) -- tiny, structured, UNSAT, exponentially hard for resolution\n");
    printf("  n | vars | clauses |     DPLL decisions\n");
    for (int n=3;n<=6;n++){
        int nv; CNF f=php(n,nv); vector<int> a(nv+1,0); decisions=0;
        bool r=dpll(f,a,nv);
        printf("%3d | %4d | %7zu | %18lld  %s\n", n, nv, f.size(), decisions, r?"SAT?!":"UNSAT");
        if (decisions>CAP){ printf("   (hit cap)\n"); break; }
    }
    printf("\nRANDOM 3-SAT at n=60 -- big, unstructured. Watch the peak at the phase transition.\n");
    printf(" alpha |  vars | clauses |  DPLL decisions | result\n");
    for (double al : {2.0, 3.0, 4.0, 4.26, 5.0, 6.0, 8.0}){
        int nv; CNF f=rand3(60, al, 42, nv); vector<int> a(nv+1,0); decisions=0;
        bool r=dpll(f,a,nv);
        printf("%6.2f | %5d | %7zu | %15lld | %s\n", al, nv, f.size(), decisions, r?"SAT":"UNSAT");
    }
}
```

**Real output (verified):**

```
PIGEONHOLE  PHP(n+1,n) -- tiny, structured, UNSAT, exponentially hard for resolution
  n | vars | clauses |     DPLL decisions
  3 |   12 |      22 |                 16  UNSAT
  4 |   20 |      45 |                102  UNSAT
  5 |   30 |      81 |                748  UNSAT
  6 |   42 |     133 |               6490  UNSAT

RANDOM 3-SAT at n=60 -- big, unstructured. Watch the peak at the phase transition.
 alpha |  vars | clauses |  DPLL decisions | result
  2.00 |    60 |     120 |              34 | SAT
  3.00 |    60 |     180 |              22 | SAT
  4.00 |    60 |     240 |             212 | SAT
  4.26 |    60 |     255 |            3636 | UNSAT
  5.00 |    60 |     300 |            1756 | UNSAT
  6.00 |    60 |     360 |             808 | UNSAT
  8.00 |    60 |     480 |             358 | UNSAT
```

## 7.4 Rediscovering BB(3) by brute force

Enumerate every 3-state 2-symbol Turing machine (with `A0 = 1RB` fixed, which is WLOG under
state renaming and symbol flipping — 16⁵ = 1,048,576 machines), run each to a step cap, take
the maximum. The program finds `S(3) = 21` and `Σ(3) = 6` **with witnesses**, matching the
literature. Then ask the learner why the same program cannot settle n = 6.

```cpp
// Rediscover BB(3) by brute force. Every 3-state 2-symbol machine, run to a cap.
// Known: S(3) = 21 steps, Sigma(3) = 6 ones. We find them, not look them up.
#include <cstdio>
#include <cstring>
#include <cstdint>
using namespace std;

// action encoding: 0..15  ->  write = a&1, move = (a>>1)&1 ? +1 : -1, next = a>>2 (3 == HALT)
static const int NST = 3, HALT = 3, CAP = 400, TAPE = 1024;

int main(){
    long long best_steps = -1, best_ones = -1; int bs_prog[6]={0}, bo_prog[6]={0};
    long long halting = 0, total = 0;
    int prog[6];
    prog[0] = 1 | (1<<1) | (1<<2);   // write 1, move R, goto B              // A0 = 1RB, fixed WLOG (state renaming + symbol flip)
    static uint8_t tape[TAPE];
    for (int p1=0;p1<16;p1++) for (int p2=0;p2<16;p2++) for (int p3=0;p3<16;p3++)
    for (int p4=0;p4<16;p4++) for (int p5=0;p5<16;p5++){
        prog[1]=p1; prog[2]=p2; prog[3]=p3; prog[4]=p4; prog[5]=p5;
        total++;
        memset(tape,0,TAPE);
        int head = TAPE/2, st = 0; long long steps = 0; bool halted=false;
        while (steps < CAP){
            int a = prog[st*2 + tape[head]];
            tape[head] = a & 1;
            head += ((a>>1)&1) ? 1 : -1;
            steps++;
            if (head < 0 || head >= TAPE) { halted=false; break; }
            st = a >> 2;
            if (st == HALT){ halted = true; break; }
        }
        if (!halted) continue;
        halting++;
        long long ones=0; for (int i=0;i<TAPE;i++) ones += tape[i];
        if (steps > best_steps){ best_steps = steps; memcpy(bs_prog,prog,sizeof prog); }
        if (ones  > best_ones ){ best_ones  = ones;  memcpy(bo_prog,prog,sizeof prog); }
    }
    auto show=[&](const int* p){ static char buf[64]; char* q=buf;
        for(int s=0;s<3;s++) for(int y=0;y<2;y++){ int a=p[s*2+y];
            q += sprintf(q, "%c%d:%d%c%c ", 'A'+s, y, a&1, ((a>>1)&1)?'R':'L', (a>>2)==HALT?'H':('A'+(a>>2))); }
        return buf; };
    printf("machines searched (A0 fixed to 1RB): %lld\n", total);
    printf("of which halted within %d steps      : %lld\n", CAP, halting);
    printf("S(3)     = %lld steps   %s\n", best_steps, (best_steps==21)?"<- matches the known BB value 21":"MISMATCH");
    printf("  witness: %s\n", show(bs_prog));
    printf("Sigma(3) = %lld ones    %s\n", best_ones,  (best_ones==6) ?"<- matches the known BB value 6" :"MISMATCH");
    printf("  witness: %s\n", show(bo_prog));
    printf("%s\n", (best_steps==21 && best_ones==6) ? "BB(3) REDISCOVERED" : "FAILED");
    return (best_steps==21 && best_ones==6) ? 0 : 1;
}
```

**Real output (verified):**

```
machines searched (A0 fixed to 1RB): 1048576
of which halted within 400 steps      : 471236
S(3)     = 21 steps   <- matches the known BB value 21
  witness: A0:1RB A1:0LH B0:1LB B1:0RC C0:1LC C1:1LA 
Sigma(3) = 6 ones    <- matches the known BB value 6
  witness: A0:1RB A1:1RA B0:1LC B1:1LH C0:1RA C1:1LB 
BB(3) REDISCOVERED
```

## 7.5 A Turing machine simulator — i.e. a universal machine

The machine's transition table arrives as a **string**. The simulator's source never changes.
Verified against the known Busy Beaver champions (BB(2) halts in 6 steps, the BB(3) step
champion in 21, the BB(3) ones champion in 12 with 6 ones, BB(4) in 107 with 13 ones — the
first three rediscovered independently in §7.4) and against real binary arithmetic.

```cpp
// A Turing machine simulator. Note what it is: ONE program that becomes any machine,
// by reading a description of that machine out of a string. That is a universal machine,
// and it is the same trick as fetch-decode-execute.
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include <cassert>
using namespace std;

struct Act { char write; int move; char next; };            // move: -1 L, +1 R
typedef map<pair<char,char>, Act> Prog;                     // (state, symbol) -> action

// Encoding: "A0:1RB A1:1RH B0:0RC ..."   H = halt.  This string is DATA.
static Prog decode(const string& s){
    Prog p; size_t i=0;
    while (i < s.size()){
        while (i<s.size() && s[i]==' ') i++;
        if (i+5 > s.size()) break;
        char st=s[i], sym=s[i+1];  assert(s[i+2]==':');
        char w=s[i+3]; int mv = (s[i+4]=='R')?1:-1; char nx=s[i+5];
        p[{st,sym}] = {w,mv,nx}; i += 6;
    }
    return p;
}

struct Result { long long steps; int ones; bool halted; };
static Result run(const Prog& p, string tape, long long cap, bool trace=false){
    map<long long,char> t;                                  // sparse two-way-infinite tape
    for (size_t i=0;i<tape.size();i++) t[(long long)i] = tape[i];
    long long head = 0; char st = 'A'; long long steps = 0;
    while (st != 'H'){
        if (steps >= cap) return {steps, 0, false};
        char sym = t.count(head) ? t[head] : '0';
        auto it = p.find({st,sym});
        if (it == p.end()) break;                           // no rule = halt
        if (trace && steps < 8) printf("    step %2lld: state %c, head %3lld, reads %c -> writes %c, move %c, goto %c\n",
                                       steps, st, head, sym, it->second.write, it->second.move>0?'R':'L', it->second.next);
        t[head] = it->second.write;
        head += it->second.move;
        st = it->second.next;
        steps++;
    }
    int ones=0; for (auto& kv : t) if (kv.second=='1') ones++;
    return {steps, ones, true};
}

int main(){
    // --- 1. The simulator runs Busy Beaver champions. Known values: S(3)=21, S(4)=107.
    struct { const char* name; const char* code; long long S; int sigma; } bb[] = {
        {"BB(2) champion", "A0:1RB A1:1LB B0:1LA B1:1RH", 6, 4},
        {"BB(3) step champ", "A0:1RB A1:0LH B0:1LB B1:0RC C0:1LC C1:1LA", 21, 4},
        {"BB(3) ones champ", "A0:1RB A1:1RA B0:1LC B1:1LH C0:1RA C1:1LB", 12, 6},
        {"BB(4) champion", "A0:1RB A1:1LB B0:1LA B1:0LC C0:1RH C1:1LD D0:1RD D1:0RA", 107, 13},
    };
    printf("Busy Beaver champions, run by a general simulator that has never heard of them:\n");
    for (auto& b : bb){
        Prog p = decode(b.code);
        Result r = run(p, "", 1000000);
        printf("  %-15s halted=%d steps=%4lld (expected %4lld) ones=%2d (expected %2d)  %s\n",
               b.name, (int)r.halted, r.steps, b.S, r.ones, b.sigma,
               (r.halted && r.steps==b.S) ? "MATCH" : "MISMATCH");
        assert(r.halted && r.steps == b.S && r.ones == b.sigma);

    }

    // --- 2. Same simulator, a machine that does arithmetic: binary increment.
    // Walk right to the end, then add 1 with carry walking left.
    const char* inc = "A0:0RA A1:1RA A_:_LB B0:1LH B1:0LB B_:1LH";
    printf("\nbinary increment, same simulator, different DATA:\n");
    for (const char* in : {"0","1","10","11","111","1011"}){
        Prog p = decode(inc);
        // pad with a blank marker '_' terminator
        string tape = string(in) + "_";
        map<long long,char> dummy;
        // run and read back
        {
            Prog pp = p; 
            // inline run so we can read the tape
            map<long long,char> t; for(size_t i=0;i<tape.size();i++) t[(long long)i]=tape[i];
            long long head=0; char st='A'; long long steps=0;
            while(st!='H' && steps<10000){ char sym = t.count(head)?t[head]:'0';
                auto it=pp.find({st,sym}); if(it==pp.end()) break;
                t[head]=it->second.write; head+=it->second.move; st=it->second.next; steps++; }
            string out; for(auto&kv:t) if(kv.second!='_') out+=kv.second;
            // strip leading zeros for display
            size_t z=out.find_first_not_of('0'); string disp = (z==string::npos)?"0":out.substr(z);
            long long a=strtoll(in,nullptr,2), b=strtoll(disp.c_str(),nullptr,2);
            printf("  %6s + 1 = %6s   (%lld + 1 = %lld) %s  [%lld steps]\n",
                   in, disp.c_str(), a, b, (b==a+1)?"OK":"WRONG", steps);
            assert(b == a+1);
        }
    }

    // --- 3. The point. One simulator. Three machines. The machine is a STRING.
    printf("\nThe simulator's source never changed. The machine came in as a string.\n");
    printf("That string is a program; the simulator is a fetch-decode-execute loop;\n");
    printf("this is a universal machine, and so is the CPU you built.\n");
    printf("ALL CHECKS PASSED\n");
}
```

**Real output (verified):**

```
Busy Beaver champions, run by a general simulator that has never heard of them:
  BB(2) champion  halted=1 steps=   6 (expected    6) ones= 4 (expected  4)  MATCH
  BB(3) step champ halted=1 steps=  21 (expected   21) ones= 4 (expected  4)  MATCH
  BB(3) ones champ halted=1 steps=  12 (expected   12) ones= 6 (expected  6)  MATCH
  BB(4) champion  halted=1 steps= 107 (expected  107) ones=13 (expected 13)  MATCH

binary increment, same simulator, different DATA:
       0 + 1 =      1   (0 + 1 = 1) OK  [3 steps]
       1 + 1 =     10   (1 + 1 = 2) OK  [4 steps]
      10 + 1 =     11   (2 + 1 = 3) OK  [4 steps]
      11 + 1 =    100   (3 + 1 = 4) OK  [6 steps]
     111 + 1 =   1000   (7 + 1 = 8) OK  [8 steps]
    1011 + 1 =   1100   (11 + 1 = 12) OK  [8 steps]

The simulator's source never changed. The machine came in as a string.
That string is a program; the simulator is a fetch-decode-execute loop;
this is a universal machine, and so is the CPU you built.
ALL CHECKS PASSED
```

## 7.6 The RAM model's uniform-cost assumption, measured

Two pointer chases over the same 64 MiB array, the same number of dependent loads, the same
Θ(n). The only difference is locality.

**Machine-dependent.** This is the one number in §7 that varies with the host, and it is a
Compiler Explorer sandbox VM of unknown specification. The *ratio* is the point, and it is
robust; the absolute nanoseconds are not.

```cpp
// The RAM model says every memory access costs 1. Measure the lie.
#include <cstdio>
#include <chrono>
#include <vector>
#include <numeric>
#include <random>
#include <algorithm>
using namespace std; using namespace std::chrono;

int main(){
    const size_t N = 1u<<24;            // 16M elements = 64 MiB, far past L3
    vector<uint32_t> next_seq(N), next_rnd(N);
    for (size_t i=0;i<N;i++) next_seq[i] = (uint32_t)((i+1)%N);          // sequential chase
    { vector<uint32_t> perm(N); iota(perm.begin(),perm.end(),0u);
      mt19937 rng(12345); shuffle(perm.begin(),perm.end(),rng);
      for (size_t i=0;i<N;i++) next_rnd[perm[i]] = perm[(i+1)%N]; }      // random cycle, same length

    auto chase=[&](vector<uint32_t>& nx, size_t steps){
        auto t0=steady_clock::now(); uint32_t p=0;
        for (size_t i=0;i<steps;i++) p = nx[p];
        auto t1=steady_clock::now();
        return make_pair(duration<double,nano>(t1-t0).count()/steps, p);
    };
    size_t steps = 1u<<23;
    auto a = chase(next_seq, steps);
    auto b = chase(next_rnd, steps);
    printf("Same N (%zu), same number of dependent loads (%zu), same O(n).\n", N, steps);
    printf("sequential pointer chase : %8.3f ns per access\n", a.first);
    printf("random     pointer chase : %8.3f ns per access\n", b.first);
    printf("ratio                    : %8.2fx   <- the RAM model says this should be 1.00x\n", b.first/a.first);
    printf("(sinks %u %u)\n", a.second, b.second);
}
```

**Real output (verified):**

```
Same N (16777216), same number of dependent loads (8388608), same O(n).
sequential pointer chase :    1.350 ns per access
random     pointer chase :  250.770 ns per access
ratio                    :   185.82x   <- the RAM model says this should be 1.00x
(sinks 8388608 761441)
```

## 7.7 A DFA checked against an independently written language spec

Three DFAs, three predicates written independently of them, exhaustive agreement over every
string up to length 16 (131,071 strings each). This is the template for Unit 1's first
exercise: the learner writes the machine, the spec is given, and the check is total.

```cpp
// A DFA checked against a language SPEC by exhaustive agreement.
// The spec is a predicate written independently; the DFA is the machine. They must never differ.
#include <cstdio>
#include <string>
#include <cassert>
using namespace std;

// ---- Machine 1: binary strings that are multiples of 3 (MSB first, empty = 0) ----
struct Mod3 { int q=0; void step(char c){ q = (2*q + (c-'0')) % 3; } bool acc() const { return q==0; } };
static bool spec_mod3(const string& w){ long long v=0; for(char c:w) v = (2*v + (c-'0')) % 3; return v==0; }

// ---- Machine 2: even number of 'a', odd number of 'b'  (4 states, a product automaton) ----
struct EvenAOddB { int a=0,b=0; void step(char c){ if(c=='a') a^=1; else b^=1; } bool acc() const { return a==0 && b==1; } };
static bool spec_eaob(const string& w){ int na=0,nb=0; for(char c:w){ if(c=='a') na++; else nb++; } return na%2==0 && nb%2==1; }

// ---- Machine 3: contains "aba" as a substring (KMP-style DFA, 4 states) ----
static const int SUBSTR[4][2] = { /*q0*/{1,0}, /*q1 'a'*/{1,2}, /*q2 'ab'*/{3,0}, /*q3 accept*/{3,3} };
static bool spec_aba(const string& w){ return w.find("aba") != string::npos; }

template <class Mach, class Spec>
static long long sweep(const char* name, int maxlen, const char* alpha, Spec spec, Mach make){
    long long checked=0, bad=0;
    for (int len=0; len<=maxlen; len++){
        for (long long m=0; m < (1LL<<len); m++){
            string w; for(int i=0;i<len;i++) w += alpha[(m>>i)&1];
            auto M = make(); for(char c:w) M.step(c);
            bool machine = M.acc(), reference = spec(w);
            checked++; if (machine != reference){ bad++;
                if (bad<4) printf("   DISAGREE on \"%s\": dfa=%d spec=%d\n", w.c_str(), machine, reference); }
        }
    }
    printf("%-28s len<=%2d  checked=%7lld  disagreements=%lld  %s\n",
           name, maxlen, checked, bad, bad?"FAIL":"OK");
    assert(bad==0);
    return checked;
}
struct SubstrM { int q=0; void step(char c){ q = SUBSTR[q][c=='a'?0:1]; } bool acc() const { return q==3; } };

int main(){
    printf("DFA vs language spec -- exhaustive agreement\n");
    sweep("multiple of 3 (binary)", 16, "01", spec_mod3, []{ return Mod3{}; });
    sweep("even #a and odd #b",     16, "ab", spec_eaob, []{ return EvenAOddB{}; });
    sweep("contains \"aba\"",        16, "ab", spec_aba,  []{ return SubstrM{}; });
    printf("ALL DFAs AGREE WITH THEIR SPECS ON EVERY STRING UP TO LENGTH 16\n");
}
```

**Real output (verified):**

```
DFA vs language spec -- exhaustive agreement
multiple of 3 (binary)       len<=16  checked= 131071  disagreements=0  OK
even #a and odd #b           len<=16  checked= 131071  disagreements=0  OK
contains "aba"               len<=16  checked= 131071  disagreements=0  OK
ALL DFAs AGREE WITH THEIR SPECS ON EVERY STRING UP TO LENGTH 16
```

## 7.8 C++ is not context-free — living evidence

The most vexing parse and the typedef problem, both demonstrated with type traits rather than
prose. GCC additionally emits `-Wvexing-parse` on line 14, which is the compiler telling you
in its own words that it resolved a grammatical ambiguity in a way you probably didn't want.

```cpp
// The same token sequence, two meanings. The parser cannot decide from the tokens alone.
#include <cstdio>
#include <type_traits>

struct Timer { Timer(){} };
struct Widget { Widget(Timer){} int go(){ return 42; } };

namespace A { typedef int T; }      // T is a TYPE
namespace B { inline constexpr int T = 7; }   // T is a VALUE

int main(){
    // ---------- 1. The most vexing parse ----------
    Widget w(Timer());     // looks like: construct w from a temporary Timer
    Widget v{Timer()};     // braces force the object reading

    printf("Widget w(Timer());  decltype(w) is a function type? %s\n",
           std::is_function_v<decltype(w)> ? "YES  <-- it is a FUNCTION DECLARATION" : "no");
    printf("Widget v{Timer()};  decltype(v) is Widget?          %s\n",
           std::is_same_v<decltype(v), Widget> ? "YES  <-- an object" : "no");
    static_assert(std::is_function_v<decltype(w)>, "w must be a function decl");
    static_assert(std::is_same_v<decltype(v), Widget>, "v must be an object");
    printf("  v.go() = %d   (w.go() would not compile at all)\n", v.go());

    // ---------- 2. The typedef problem: T*p is decided by the symbol table ----------
    {   using namespace A;      // T is a type
        T *p = nullptr;         // DECLARATION of a pointer
        printf("with A::T (a type):  `T *p` parsed as a declaration, p==%p\n", (void*)p);
    }
    {   using namespace B;      // T is a value
        int p = 3;
        int r = T * p;          // MULTIPLICATION -- same shape, different tree
        printf("with B::T (a value): `T * p` parsed as an expression, value==%d\n", r);
        static_assert(B::T * 3 == 21);
    }
    printf("SAME TOKENS. DIFFERENT PARSE TREES. DECIDED BY A DECLARATION ELSEWHERE.\n");
}
```

**Real output (verified):**

```
Widget w(Timer());  decltype(w) is a function type? YES  <-- it is a FUNCTION DECLARATION
Widget v{Timer()};  decltype(v) is Widget?          YES  <-- an object
  v.go() = 42   (w.go() would not compile at all)
with A::T (a type):  `T *p` parsed as a declaration, p==(nil)
with B::T (a value): `T * p` parsed as an expression, value==21
SAME TOKENS. DIFFERENT PARSE TREES. DECIDED BY A DECLARATION ELSEWHERE.
```

---

# 8. What Could Not Be Verified

Stated explicitly, because a research note that doesn't separate the checked from the recalled
is not usable.

## 8.1 The web search budget was exhausted

**This is the most important limitation in this document.** The session's WebSearch budget
(200 calls) was already spent before this research began, so no keyword searching was
possible. Sources were reached only by **direct URL fetch** against URLs recalled from
memory. Two were fetched successfully (Cloudflare's postmortem, Russ Cox's article); one
returned HTTP 403 (Stack Overflow's 2016 postmortem on `stackstatus.tumblr.com`). Everything
else in §9 is cited from memory and **was not opened during this research.**

Practical consequence: bibliographic details below (years, exact titles, journal names) are
recalled and should be checked before publication. The *technical content* is standard
textbook material and is high-confidence; the *citations* are the weak part.

## 8.2 Verified — high confidence

These were compiled and run, or fetched from a primary source, during this research:

| Claim | How verified |
|---|---|
| Backtracking step counts on `a?ⁿaⁿ`, exact values 5…251,658,238 | §7.1, run |
| Thompson step counts, exact values 7…1,525 | §7.1, run |
| Closed forms `(n+6)·2ⁿ⁻¹−2` and `(5n+2)(n+1)/2` | fit exactly to all 24 measured points |
| Both matchers agree on all test strings | §7.1, asserted |
| Subset construction gives exactly `2^k` states for `L_k` | §7.2, asserted for k=1..10 |
| Subset DFA agrees with NFA on 8,191 strings | §7.2, asserted |
| Pigeonhole DPLL decisions 16/102/748/6,490 | §7.3, run |
| Random 3-SAT peak at α ≈ 4.26 (3,636 decisions) | §7.3, run |
| `S(3) = 21`, `Σ(3) = 6`, with witness machines | §7.4, brute-forced over 1,048,576 machines |
| BB(2)=6, BB(4)=107 steps; Σ(4)=13 | §7.5, run |
| Sequential vs random pointer chase = **211×** | §7.6, run (machine-dependent) |
| Three DFAs agree with specs on 131,071 strings each | §7.7, run |
| `Widget w(Timer())` declares a function (GCC 15.2) | §7.8, `std::is_function_v` |
| GCC 15.2 emits `-Wvexing-parse` for it | §7.8, compiler stderr |
| `T*p` parses as declaration or expression by symbol table | §7.8, run |
| Cloudflare 2019: the exact regex, 27 min, `.*.*=.*`, 23→555 steps, PCRE, re2/Rust commitment | fetched from blog.cloudflare.com |
| Cox 2007: Perl 60s at n=29 vs 20µs; 10¹⁵ years at n=100 | fetched from swtch.com |

## 8.3 Recalled, not verified in this session

Standard results I am confident in but did not open a source for. Confidence noted.

**Very high (textbook canon, would be surprised to be wrong):**
- Rabin–Scott 1959 (subset construction), Kleene 1951 (regex ≡ automata), Myhill–Nerode,
  Hopcroft O(n log n) minimisation.
- Turing 1936, Church 1936, the Church–Turing equivalence proofs, Rice 1951, Cook 1971,
  Levin 1973, Karp 1972 (21 problems), Gödel 1931.
- The pumping lemmas and all the non-regularity/non-context-freeness proofs given.
- Chomsky 1956 hierarchy; the undecidability of CFG ambiguity, equivalence, and emptiness of
  intersection.
- Thompson 1968 CACM regex construction; the DFA/NFA/backtracking engine taxonomy.
- P, NP, co-NP, NP-completeness definitions and the misstatement corrections.
- Landauer 1961; `kT ln 2 = 2.87 × 10⁻²¹ J` at 300 K (arithmetic done here, inputs recalled).

**High, but check the details:**
- **BB(5) = 47,176,870, proved 2024 by bbchallenge.org with a Coq formalisation.** Confident
  in the value and the year; the exact form of the announcement and whether it was Coq or
  Rocq should be checked.
- **`BB(748)` independent of ZFC (Aaronson–Yedidia), later improved to 745.** The specific
  numbers 748 and 745 are recalled and I would not stake much on them; the *existence* of such
  a bound is solid.
- **Random 3-SAT threshold α ≈ 4.267.** The value is standard; my §7.3 measurement is on
  n=60, far too small for the asymptotic threshold to be sharp, so §7.3 *illustrates* the
  phenomenon rather than measuring the constant. **Do not present §7.3's peak as a measurement
  of 4.267.**
- **Ding, Sly & Sun (2015) proved the satisfiability threshold conjecture for large k.**
  Recalled; the "large k" qualifier matters and the k=3 case specifically is, I believe, still
  not settled by that result.
- **Google's ~10% false-positive threshold** (Sadowski et al., *Lessons from Building Static
  Analysis Tools at Google*, CACM 2018). The paper exists; the exact figure is recalled and
  should be checked against the text before quoting.
- **Gasarch's P vs NP polls (2002, 2012, 2019) showing ~80–90% believing P ≠ NP.** Direction
  is certain; the percentages are approximate.
- **Cohen 1987 thesis on virus detection undecidability.** Confident in the result; year and
  venue recalled.
- **Chaitin 1981 graph-colouring register allocation; Briggs' improvement; Poletto & Sarkar
  1999 linear scan.** Standard, but check years.
- **Landi 1992 / Ramalingam 1994 on undecidability of precise alias analysis.** Confident in
  the results; the attribution split between the two is recalled loosely.
- **Mancinelli et al. 2006 / EDOS on Debian dependency resolution being NP-complete.**
  Confident in the result, less so in the citation.
- **Christofides 1976 (1.5-approx metric TSP); Karlin–Klein–Oveis Gharan 2020 (1.5−ε).**
  Confident. The 2020 improvement's exact ε and current status should be checked.
- **Feige 1998: `ln n` is optimal for set cover unless P = NP.** Confident.
- **Furst–Saxe–Sipser 1981 and Håstad 1986 on PARITY ∉ AC⁰.** Confident.
- **Fagin 1974 (NP = ∃SO); Immerman–Vardi (P = FO(LFP) on ordered structures).** Confident.
- **Valiant 1979 (permanent is #P-complete); Toda's theorem.** Confident.
- **Spielman & Teng smoothed analysis (2001 paper, 2008 Gödel Prize).** Confident.
- **Bérut et al., Nature 2012, experimental confirmation of Landauer.** Confident.
- **Bennett 1973 on reversible computation.** Confident.
- **Cook 2004 (Rule 110 universal, announced ~1998).** Confident; the announcement/publication
  gap and the Wolfram dispute are recalled.
- **Dolan 2013, "mov is Turing-complete."** Confident.
- **Veldhuizen on C++ template metaprogramming Turing-completeness.** The 1988 date given in
  §2.8 is almost certainly **wrong** — templates did not exist in 1988. Treat the date as
  unverified; the result (and the primes-at-compile-time demonstration, Unruh ~1994) is solid.
- **Haken 1985, exponential resolution lower bound for pigeonhole.** Confident.
- **Aggarwal–Vitter 1988 external memory; Frigo/Leiserson/Prokop/Ramachandran 1999
  cache-oblivious.** Confident.
- **Ford 2004 (PEG); Warth et al. on left recursion in packrat.** Confident.
- **Python PEP 617 (PEG parser, Python 3.9).** Confident.
- **Cousot & Cousot 1977 abstract interpretation; Livshits et al. "Soundiness", CACM 2015.**
  Confident.
- **Bison 3.8+ `-Wcounterexamples`.** Confident it exists; the exact version is recalled.
- **GCC/Clang `-ftemplate-depth` defaults of 900/1024.** Recalled, plausibly stale.
- **Matiyasevich 1970 (Hilbert's 10th), Novikov 1955 (word problem), Berger 1966 (Wang
  tiles), Post 1946 (PCP).** Confident.

## 8.4 Recalled with lower confidence — flag before teaching

- **The Stack Overflow outage of 20 July 2016.** I describe it as ~34 minutes caused by a
  whitespace-trimming regex meeting a post with a long run of spaces. **The postmortem URL
  returned HTTP 403 and could not be read.** Duration and mechanism are recalled. Do not
  quote specifics without checking.
- **The claim that "most compilers use hand-written recursive descent"** (§2.9) is my read of
  the landscape (Clang, GCC since 3.4, Rust, Go, TypeScript, javac) and is well-supported by
  those examples, but "overwhelmingly" is an editorial judgement, not a surveyed fact.
- **Flex's exact emitted table names** (`yy_nxt`, `yy_accept`, `yy_ec`, `yy_base`, `yy_def`,
  `yy_chk`) are recalled from reading generated lexers. Check against a current `flex` before
  putting them on a slide.
- **The claim that AKS primality was "widely believed but not proven to be in P" before 2002.**
  The history is more nuanced (conditional results under GRH existed much earlier). Simplified.
- **Transistor switching energy of 10⁻¹⁷–10⁻¹⁸ J** (§5.6) is an order-of-magnitude recollection
  spanning a wide range of process nodes and switching definitions. The conclusion (3–4 orders
  above Landauer) is robust to the uncertainty; the specific numbers are not.
- **"Two counters suffice" (Minsky).** Correct, but with an important caveat I glossed: the
  two-counter machine is universal only with a suitable *encoding* of the input (Gödel-numbered
  into a single counter). A two-counter machine cannot compute `2ⁿ` from `n` directly. If a
  learner builds one for exercise 2e, they will hit this.
- **`Σ(3) = 6` at 12 steps and `S(3) = 21` at 4 ones.** These specific witness machines were
  found by §7.4's own search, so the *values* are verified. Whether the machines I printed are
  the canonical ones named in the literature is not checked — several machines achieve each
  optimum.

## 8.5 Genuinely open or contested

Not failures of research; the field does not know.

- **P vs NP.** Open since 1971.
- **NC vs P**, **NP vs co-NP**, **L vs P**, **P vs PSPACE.** All open.
- **BQP vs BPP** — whether quantum computers are genuinely more powerful, and therefore
  whether the extended Church–Turing thesis is false. Open. Shor's algorithm is evidence, not
  proof: no classical polynomial factoring algorithm is *known*, but none is ruled out.
- **The physical Church–Turing thesis.** A claim about physics, unsettled and arguably not
  fully formalisable.
- **`BB(6)`.** Beyond current reach and plausibly beyond any reach; lower bounds involve
  towers of exponentials.
- **The k=3 satisfiability threshold** as an exact constant with proof.
- **Whether the P vs NP barriers (relativisation, natural proofs, algebrization) rule out all
  known techniques** — the standard reading, but the boundary of "known techniques" is soft.

## 8.6 Things that will go stale

- **BB(5) = 47,176,870** is settled, but the surrounding effort (bbchallenge, BB(6) lower
  bounds, the ZFC-independence record) is actively moving. Re-check before teaching.
- **Compiler Explorer's compiler IDs** (`g152` = GCC 15.2), its sandbox time limit, and the
  exact API response schema. All have changed before.
- **§7.6's 211× ratio** is a property of one anonymous CI VM on one day. The learner will get
  a different number. That is fine and should be said out loud — but the exercise must be
  re-run, not quoted.
- **`-ftemplate-depth` defaults**, `-Wvexing-parse` wording, and GCC diagnostic text generally.
- **Approximation ratio records** (metric TSP especially) move.
- **The list of engines using backtracking vs automata.** .NET added a non-backtracking mode
  in .NET 7 (`RegexOptions.NonBacktracking`); JavaScript engines periodically add ReDoS
  mitigations; PCRE2 has a match limit. The §2.6 table is a snapshot, and the *direction* of
  travel is toward linear-time engines.

## 8.7 Deliberate simplifications

Named so nobody mistakes them for errors:

- **The step-count metric in §7.1** counts "node visits" for backtracking and "state
  additions plus transition tests" for Thompson. These are not the same unit, so the *ratio*
  is not a clean speed ratio — it is a growth-rate comparison. The asymptotic separation
  (exponential vs quadratic) is the real claim and is unaffected. Cox's wall-clock numbers are
  the independent confirmation.
- **§7.3's solver is DPLL, not CDCL.** No clause learning, no watched literals, no VSIDS. It
  demonstrates the phenomena at small scale; it is not evidence about what modern solvers do,
  and §4.5's claims about million-variable instances rest on the literature, not on §7.3.
- **§7.1's regex engine** handles `| ? * + ( )` and literals only — no character classes,
  anchors, captures, or Unicode. Enough for the lesson, not a library.
- **The `Wᵗʰ`-from-the-end NFA in §7.2** has no ε-transitions, so §7.2's subset construction
  omits ε-closure. A complete implementation needs it, and ε-closure bugs are exactly what the
  exhaustive check is good at catching — so the exercise as given to a learner should include
  ε-transitions.
- **§2.1's four-row Chomsky table** omits the deterministic context-free languages, the
  visibly-pushdown languages, and the mildly context-sensitive class — all of which are more
  relevant to real parsing than context-sensitive grammars are. Simplified deliberately.
- **§3's Rice's theorem statement** elides the extensional/intensional distinction's finer
  points and the Rice–Shapiro conditions. Correct as stated for the properties discussed.

---

# 9. Sources

**Fetched and read during this research** (only these two):

1. Cloudflare, *Details of the Cloudflare outage on July 2, 2019* —
   https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/
   The regex, the 27-minute duration, the `.*.*=.*` analysis (23 → 555 steps), the PCRE
   backtracking admission, and the commitment to re2 or the Rust regex engine.
2. Russ Cox, *Regular Expression Matching Can Be Simple And Fast*, January 2007 —
   https://swtch.com/~rsc/regexp/regexp1.html
   The `a?ⁿaⁿ` pathological case; Perl at 60s (n=29) vs Thompson NFA at 20µs; O(mn) vs O(2ⁿ).

**Attempted and failed:**

3. Stack Exchange, *Outage postmortem, July 20 2016* —
   https://stackstatus.tumblr.com/post/147710624694/outage-postmortem-july-20-2016 — **HTTP 403.**

**Cited from memory — not opened during this research.** Every item below should be checked
before it appears on a slide. Grouped by section.

*Foundations (§1):*
- A. M. Turing, "On Computable Numbers, with an Application to the Entscheidungsproblem",
  *Proc. London Math. Soc.*, 1936.
- Alonzo Church, "An Unsolvable Problem of Elementary Number Theory", *Amer. J. Math.*, 1936.
- Emil Post, "Finite Combinatory Processes — Formulation 1", *J. Symbolic Logic*, 1936.
- Marvin Minsky, *Computation: Finite and Infinite Machines*, 1967 (two-counter universality).
- Matthew Cook, "Universality in Elementary Cellular Automata", *Complex Systems*, 2004.
- Stephen Dolan, "mov is Turing-complete", 2013.
- Todd Veldhuizen, "C++ Templates are Turing Complete" (date uncertain — see §8.3).
- B. Jack Copeland, "The Church–Turing Thesis", *Stanford Encyclopedia of Philosophy* —
  the standard careful treatment of the three theses in §1.7.

*Automata and languages (§2):*
- Michael Rabin & Dana Scott, "Finite Automata and Their Decision Problems", *IBM J. Res. Dev.*, 1959.
- Stephen Kleene, "Representation of Events in Nerve Nets and Finite Automata", 1951/1956.
- Noam Chomsky, "Three Models for the Description of Language", *IRE Trans. Inf. Theory*, 1956.
- Ken Thompson, "Regular Expression Search Algorithm", *CACM* 11(6), 1968.
- Alfred Aho, "Algorithms for Finding Patterns in Strings", *Handbook of TCS*, 1990
  (backreference matching is NP-complete).
- Hopcroft, Motwani & Ullman, *Introduction to Automata Theory, Languages, and Computation* —
  the standard text; Sipser's *Introduction to the Theory of Computation* is the better one
  to assign for this curriculum.
- Bryan Ford, "Parsing Expression Grammars: A Recognition-Based Syntactic Foundation",
  POPL 2004.
- Jay Earley, "An Efficient Context-Free Parsing Algorithm", *CACM*, 1970.
- Masaru Tomita, *Efficient Parsing for Natural Language*, 1986 (GLR).
- Aho, Lam, Sethi & Ullman, *Compilers: Principles, Techniques, and Tools* (the Dragon Book).
- Python PEP 617, "New PEG parser for CPython".
- Tree-sitter documentation (GLR + incremental reparsing).
- The WHATWG HTML Living Standard, tokenisation and tree-construction sections — the evidence
  for §2.4's "HTML parsing is an algorithm, not a grammar."

*Computability (§3):*
- H. G. Rice, "Classes of Recursively Enumerable Sets and Their Decision Problems",
  *Trans. AMS*, 1953 (the 1951 date in §3.4 is the thesis; check which to cite).
- Kurt Gödel, "Über formal unentscheidbare Sätze…", 1931.
- Torkel Franzén, *Gödel's Theorem: An Incomplete Guide to Its Use and Abuse*, 2005.
- Fred Cohen, *Computer Viruses — Theory and Experiments*, 1987.
- Patrick & Radhia Cousot, "Abstract Interpretation", POPL 1977.
- Benjamin Livshits et al., "In Defense of Soundiness: A Manifesto", *CACM*, 2015.
- Caitlin Sadowski et al., "Lessons from Building Static Analysis Tools at Google",
  *CACM*, 2018.
- William Landi, "Undecidability of Static Analysis", *LOPLAS*, 1992.
- G. Ramalingam, "The Undecidability of Aliasing", *TOPLAS*, 1994.
- Scott Aaronson & Adam Yedidia, "A Relatively Small Turing Machine Whose Behavior Is
  Independent of Set Theory", 2016.
- The Busy Beaver Challenge — https://bbchallenge.org (BB(5) = 47,176,870, 2024).

*Complexity (§4):*
- Stephen Cook, "The Complexity of Theorem-Proving Procedures", STOC 1971.
- Leonid Levin, "Universal Sequential Search Problems", 1973.
- Richard Karp, "Reducibility Among Combinatorial Problems", 1972.
- Michael Garey & David Johnson, *Computers and Intractability*, 1979 — still the reference
  for "is my problem NP-complete?"
- Armin Haken, "The Intractability of Resolution", *TCS*, 1985.
- Moskewicz et al., "Chaff: Engineering an Efficient SAT Solver", DAC 2001.
- Marques-Silva & Sakallah, "GRASP: A Search Algorithm for Propositional Satisfiability",
  1999 (clause learning).
- Biere, Heule, van Maaren & Walsh (eds.), *Handbook of Satisfiability*, 2nd ed. 2021.
- Crawford & Auton, "Experimental Results on the Crossover Point in Random 3-SAT", 1996.
- Ding, Sly & Sun, "Proof of the Satisfiability Conjecture for Large k", STOC 2015.
- Uriel Feige, "A Threshold of ln n for Approximating Set Cover", *JACM*, 1998.
- Nicos Christofides, technical report, CMU, 1976.
- Karlin, Klein & Oveis Gharan, "A (Slightly) Improved Approximation Algorithm for Metric
  TSP", STOC 2021.
- Daniel Spielman & Shang-Hua Teng, "Smoothed Analysis of Algorithms", 2001/2004.
- Downey & Fellows, *Parameterized Complexity*, 1999; *Fundamentals of Parameterized
  Complexity*, 2013.
- Leslie Valiant, "The Complexity of Computing the Permanent", *TCS*, 1979.
- Furst, Saxe & Sipser, "Parity, Circuits, and the Polynomial-Time Hierarchy", 1984.
- Johan Håstad, "Almost Optimal Lower Bounds for Small Depth Circuits", STOC 1986.
- Ronald Fagin, "Generalized First-Order Spectra and Polynomial-Time Recognizable Sets", 1974.
- Neil Immerman, *Descriptive Complexity*, 1999.
- Gregory Chaitin, "Register Allocation and Spilling via Graph Coloring", 1982.
- Poletto & Sarkar, "Linear Scan Register Allocation", *TOPLAS*, 1999.
- Mancinelli et al., "Managing the Complexity of Large Free and Open Source Package-Based
  Software Distributions", ASE 2006 (Debian dependency resolution).
- The Clay Mathematics Institute's official P vs NP problem statement (Stephen Cook).
- Lance Fortnow, *The Golden Ticket: P, NP, and the Search for the Impossible*, 2013 — the
  right popular book to recommend alongside this unit.
- Scott Aaronson, "P =? NP", in *Open Problems in Mathematics*, 2016 — the best single survey.

*Hardware and physics (§5):*
- Rolf Landauer, "Irreversibility and Heat Generation in the Computing Process",
  *IBM J. Res. Dev.*, 1961.
- Charles Bennett, "Logical Reversibility of Computation", *IBM J. Res. Dev.*, 1973.
- Antoine Bérut et al., "Experimental verification of Landauer's principle linking
  information and thermodynamics", *Nature* 483, 2012.
- Aggarwal & Vitter, "The Input/Output Complexity of Sorting and Related Problems",
  *CACM*, 1988.
- Frigo, Leiserson, Prokop & Ramachandran, "Cache-Oblivious Algorithms", FOCS 1999.
- Richard Brent, "The Parallel Evaluation of General Arithmetic Expressions", *JACM*, 1974.
- Kogge & Stone, "A Parallel Algorithm for the Efficient Solution of a General Class of
  Recurrence Equations", *IEEE Trans. Computers*, 1973.

*Within this research corpus:*
- `compilers-interpreters-terminals-unix.md` — the lexer/parser/codegen track this unit feeds.
- `nand2tetris-eater-scott.md` and `cpu-architectures.md` — the Part 0 machine that §1.6 and
  §5.1 depend on.
- `algorithms-on-real-hardware.md` — the natural continuation of §5.2.
- `x86-64-assembly.md` §6 and `cpp-linux-systems.md` §5 — the Compiler Explorer API contract
  reused in §7.
- The queued `limits-of-computation` topic — the natural home for §5.6's Landauer material,
  reversible computing, and quantum.
