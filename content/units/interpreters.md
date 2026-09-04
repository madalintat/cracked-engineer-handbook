---
needs: [parsing, pipeline]
minutes: 55
one_idea: An interpreter gives up the optimisation a compiler does before running in exchange for watching what actually happens, and everything fast about a modern interpreter is a way of spending that knowledge.
sources: [compilers-interpreters-terminals-unix]
---

A compiler decides everything before the program runs, which means it has to be
right about every case that could occur. An interpreter decides while the
program is running, which costs time at every step and buys a fact no compiler
can have: what actually happened this time.

That trade is the whole subject. The three designs below sit at different points
on it, and everything fast in a modern interpreter is a way of turning the
observation into code.

The Python figures here are from CPython, and the C listings are from gcc on
Compiler Explorer.

## Three designs, and what each pays

A tree walking interpreter evaluates the syntax tree directly, with a recursive
function that switches on the node. It is the simplest thing that works and the
right answer for a configuration file or an expression evaluator. It is also
between ten and a hundred times slower than the next design, and the reason is
not arithmetic. Every operation pays a dispatch, and every node visit chases a
pointer into a tree whose parts were allocated at different times and sit in
different cache lines.

A bytecode virtual machine compiles the tree into a flat instruction stream for
an abstract machine, then runs a loop that fetches and dispatches. The tree is
walked once, at compile time, where constant folding and peephole work can
happen. What runs afterwards is a dense array of small instructions with good
locality, and the result can be cached to disk.

A just in time compiler goes further and emits real machine code while the
program runs, using facts it collected: which types actually appeared, which
branches were actually taken, which method the call site actually reached. That
last point is why a JIT can beat an ahead of time compiler on a dynamic
language. Adding two values in Python is a fully general operation, but at this
one site it has been two integers ten thousand times running, so emit an
integer add with a check in front of it.

## Stack or registers

A bytecode machine has to say where operands come from, and there are two
answers.

A stack machine takes operands from an operand stack and pushes results back.
Instructions are tiny, often one byte and one argument, because the operand
locations are implicit. CPython, the Java virtual machine and WebAssembly all
work this way. The cost is that more instructions execute: pushing and popping
are instructions too.

A register machine gives each frame an array of slots and instructions name
their operands by index. Instructions are fewer and fatter, there are fewer
dispatches, and the slots map more directly onto real registers if a compiler
ever gets involved. Lua moved from a stack machine to a register machine in
version 5, and it remains the clearest case study of the change.

Adding two locals and storing the result is four instructions on a stack machine
and one on a register machine. The register machine executes fewer dispatches
for the same work, which matters because dispatch is where the time goes.

## Dispatch, and why the loop is shaped the way it is

The obvious loop reads an opcode and switches on it. That compiles to an
indirect jump through a table, and the important consequence is that every
opcode in the program shares one indirect branch instruction.

```figure
{
  "kind": "blocks",
  "alt": "Two dispatch shapes: on the left a single switch with one indirect branch shared by every opcode, and on the right one indirect jump at the end of each opcode body, so each has its own branch site.",
  "caption": "The same work, arranged so the branch predictor has something to learn. One site cannot tell which opcode is coming next; one site per opcode can learn that a comparison is usually followed by a conditional jump.",
  "boxes": [
    { "id": "s1", "x": 0,   "y": 0,   "w": 4.2, "h": 1.1, "label": "switch (opcode)", "accent": "clay" },
    { "id": "s2", "x": 0,   "y": 2.0, "w": 4.2, "h": 1.1, "label": "one branch site", "accent": "clay" },
    { "id": "c1", "x": 6.4, "y": 0,   "w": 4.6, "h": 1.1, "label": "op body, then jump", "accent": "jade" },
    { "id": "c2", "x": 6.4, "y": 2.0, "w": 4.6, "h": 1.1, "label": "one site per opcode", "accent": "jade" }
  ],
  "arrows": [
    { "from": "s1", "to": "s2" },
    { "from": "c1", "to": "c2" }
  ]
}
```

A branch predictor keyed on a single site cannot learn anything about which
opcode follows which, because from that site's point of view the target is
whatever the program is doing. So interpreters use a compiler extension that
lets a label be taken as a value, and end each opcode's body with its own jump
to the next one. Now there is a branch site per opcode, and the predictor can
learn that a comparison is usually followed by a conditional jump. The reported
gain when CPython adopted it was in the range of fifteen to twenty percent, for
a change that computes exactly the same thing.

CPython 3.14 added a further variant, where each opcode is a separate small
function and dispatch is a tail call to the next one. The reason is not
elegance. A single function of several thousand lines defeats register
allocation, and splitting it lets the compiler allocate registers per opcode.
The measured gain is three to five percent on the standard benchmark suite.

## What the interpreter knows and writes down

Here is where the trade starts paying.

An instruction like an attribute load or a binary operation is general: it must
work for every type. But a given site in a real program is usually not general
at all. It sees the same shapes over and over.

So the interpreter watches. After a code object has run enough times, its
instructions are replaced by adaptive versions carrying a small counter, and
space for a cache is embedded in the instruction stream right after the
instruction itself. When the counter fires, a family specific routine looks at
the operands that actually turned up and rewrites the instruction into a
specialised member of its family. A general binary operation becomes an integer
add, or a float add, or a string concatenation, depending on what it saw.

Every specialised instruction begins with a cheap check: is the type still what
we assumed, is the class still the version we recorded. On a miss it decrements a
counter and does the general thing; if the counter bottoms out the instruction
reverts to the adaptive form and may specialise differently later.

This is the mechanism to remember, because it is the same in every fast dynamic
language runtime under different names. Observe, assume, guard, and be able to
take it back.

## Tiers, and becoming hot while running

A JIT does not compile everything. Compiling costs time, and most code runs
once. So runtimes are tiered: a cheap tier runs immediately and counts, and when
a function or a loop crosses a threshold, an expensive tier compiles it using
what the cheap tier recorded.

Two kinds of hot are worth distinguishing. A function called many times can be
compiled before its next call, which is easy. A function entered once containing
a loop that runs ten million times is hot while it is executing, and waiting for
it to return means waiting forever. The answer is on stack replacement: compile
a new version, then transfer the running frame into it mid flight, with the loop
counter and every live value moved across. It is fiddly and it is not optional,
because the long running loop is exactly the case that most needs compiling.

There are two shapes of JIT. A method JIT compiles a function at a time, like an
ordinary compiler with better information. A tracing JIT records the actual
sequence of operations through one hot loop, following calls as it goes, and
turns that recording into straight line code with a guard at every point where
the recorded path could be left. Tracing gets aggressive inlining and
specialisation for free, and it fails badly when the code is unpredictable,
because then it produces either an explosion of traces or a trace whose guards
keep firing.

## What a cached bytecode file is not

One correction, because the belief is widespread. A compiled bytecode file next
to a source file is a cache of the parse, not an optimisation of the program. It
holds the same code object the compiler would have produced, so loading it skips
tokenising and parsing and nothing else. It carries a magic number that changes
whenever the bytecode format changes, which is why a file from another version is
rejected rather than misread, and either a timestamp or a hash of the source so
that a stale one is not used.

The program does not run faster afterwards. It starts faster.

## What to carry forward

A tree walker is simple and slow because it pays a dispatch and a pointer chase
per node. A bytecode machine walks the tree once and then runs a dense array of
instructions. A JIT emits machine code using facts that only exist at run time.

A stack machine has smaller instructions and executes more of them; a register
machine has fewer and fatter ones. Dispatch is the cost either way, which is why
the shape of the dispatch loop is worth fifteen percent and why the loop is
built to give the branch predictor something it can learn.

Specialisation is observe, assume, guard, deoptimise. A site that has seen two
integers ten thousand times gets an integer add and a check, and the check is
what makes the assumption safe.

Tiering exists because compiling costs time, and on stack replacement exists
because the loop that most needs compiling is the one already running.

Next comes the thing that decides when any of this is rebuilt at all: the build
graph, and why a build system's only real job is knowing what changed.

## Reading the errors you are about to see

These model an interpreter's decisions, counters, caches, stack depth and
dispatch counts, rather than running a real one.

`assert-failed` names the case your model got wrong. Several exercises assert
that a specialised instruction does not immediately give up on its first miss,
which is the saturating counter working rather than a check being wrong.
