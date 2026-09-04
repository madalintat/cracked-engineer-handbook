---
needs: [parsing, integers]
minutes: 55
one_idea: Giving every value exactly one definition turns "where did this come from" from a dataflow problem you resolve after every change into the name itself, and almost every optimisation in a modern compiler is downstream of that.
sources: [compilers-interpreters-terminals-unix]
---

The tree the parser built is shaped for a human. It has statements and blocks
and scopes, because that is how the language is written down. An optimiser wants
none of that. It wants to know which values flow where, and the tree makes that
question hard to ask.

So compilers lower the tree into an intermediate representation, and the form
almost all of them use is static single assignment. The idea takes one sentence.
Every value is assigned exactly once, and a name refers to exactly one
definition, forever.

The listings below are LLVM IR from clang, taken from Compiler Explorer at `-O1`
with value names kept.

## One name, one definition

In the source, a variable is a box you write to repeatedly. In SSA it is not a
box at all. Each assignment creates a new name.

```
   source            SSA
   x = 1;            x1 = 1
   x = x + 2;        x2 = x1 + 2
   x = x * 3;        x3 = x2 * 3
```

Nothing has changed about what the program computes. What changed is what a
question costs. Ask "which definition of `x` reaches this use" of the left
column and you have to look backwards through the control flow, conservatively,
and do it again after every transformation that moves anything. Ask it of the
right column and the answer is the name you are already holding. There is one
definition of `x2` and it is the instruction that defines `x2`.

That is the whole trade. Renaming is cheap; the analysis it removes is not.

## What happens where control flow joins

The obvious objection arrives immediately. If a variable is assigned in both
arms of a branch, which name does the code after the branch use?

Neither, and that is what the phi node is for. At a join point, a phi selects a
value according to which edge control arrived on.

```figure
{
  "kind": "blocks",
  "alt": "A branch splitting into two blocks, one assigning x1 equals 1 and the other x2 equals 2, both flowing into a join block whose first instruction is a phi node choosing between x1 and x2.",
  "caption": "The phi is not an instruction the machine runs. It is a record of which predecessor supplied the value, and it exists so that the block after the join can still name exactly one definition.",
  "boxes": [
    { "id": "e", "x": 4.0,  "y": 0,   "w": 3.0, "h": 1.0, "label": "br c", "accent": "slate" },
    { "id": "t", "x": 0.6,  "y": 2.2, "w": 3.4, "h": 1.0, "label": "x1 = 1", "accent": "azure" },
    { "id": "f", "x": 7.0,  "y": 2.2, "w": 3.4, "h": 1.0, "label": "x2 = 2", "accent": "azure" },
    { "id": "j", "x": 3.4,  "y": 4.4, "w": 4.2, "h": 1.0, "label": "x3 = phi(x1, x2)", "accent": "gold" }
  ],
  "arrows": [
    { "from": "e", "to": "t" },
    { "from": "e", "to": "f" },
    { "from": "t", "to": "j" },
    { "from": "f", "to": "j" }
  ]
}
```

A phi is not something the processor executes. There is no phi instruction in any
instruction set. It is bookkeeping that exists only while the program is in SSA
form, and it is removed before registers are allocated, by inserting a copy on
each incoming edge.

Where phi nodes have to go is the one genuinely fiddly part of the construction.
The standard algorithm computes the dominance frontier of each definition, which
is roughly the set of blocks where control could arrive without having passed
through that definition. A block that only ever gets one value needs no phi, and
putting one there anyway costs code without buying anything.

## What it buys

Five things, and they are worth separating, because the reason SSA is
everywhere is that one representation change pays for several passes at once.

Reaching definitions collapses. The question that used to need a fixpoint
iteration over the whole function is now a pointer.

Analyses become sparse. Classical dataflow carries facts through every point in
the program, whether or not anything there cares. With SSA you propagate along
the edges from a definition to its uses, which touches only the instructions
that could be affected. Sparse conditional constant propagation is the example
worth knowing: it does constant propagation and unreachable code elimination at
the same time, and gets strictly better results than running either alone,
because each one feeds the other. It is practical only in this form.

False dependencies disappear. Reusing one variable for two unrelated purposes
creates an ordering constraint that the program does not actually need. Renaming
destroys it. This is the same trick the hardware plays with register renaming, so
by the time the code reaches the processor the idea has been applied twice, once
by the compiler on names and once by the machine on registers.

Value numbering is nearly free. Two values with the same operator and the same
operand names are the same value, and since a name is a definition, comparing
names is comparing definitions.

Dead code elimination becomes a sweep. A definition with no uses is dead. There
is nothing to analyse and no case to be careful about, because a name cannot be
redefined somewhere you did not look.

## Reading a real loop

Here is a summation loop after clang has lowered and optimised it. The source is
four lines and the shape below is what the middle end actually works on.

```
for.body:
  %iv    = phi i64 [ 0, %preheader ], [ %iv.next, %for.body ]
  %s.05  = phi i32 [ 0, %preheader ], [ %add, %for.body ]
  %p     = getelementptr inbounds i32, ptr %a, i64 %iv
  %v     = load i32, ptr %p
  %add   = add nsw i32 %v, %s.05
  %iv.next = add nuw nsw i64 %iv, 1
  %done  = icmp eq i64 %iv.next, %count
  br i1 %done, label %cleanup, label %for.body
```

Two phi nodes carry the loop. Each says the same thing: on the first arrival take
the value from the preheader, and on every later arrival take the value this
block itself computed last time round. That is what a loop variable is, once you
stop having boxes.

The counter is worth a second look. In the source `i` was an `int`, and here the
induction variable is 64 bits wide. The compiler widened it so that the index
arithmetic matches the pointer arithmetic and no sign extension is needed inside
the loop. That is legal only because signed overflow is undefined, which lets the
compiler assume `i` never wraps. The `nsw` flag on the addition is the compiler
writing that assumption into the IR so that later passes can rely on it without
rediscovering it.

Change the loop counter to `unsigned` and the widening becomes illegal, because
unsigned overflow is defined to wrap and a wrapping 32 bit counter is not the
same sequence as a 64 bit one. The generated code is measurably different. This
is the most concrete answer available to why undefined behaviour is in the
language at all: not to trap you, but because a defined behaviour is a promise
the optimiser then has to keep.

## The passes this makes cheap

Constant folding evaluates what is already known, so `3 * 4` becomes `12`. It is
local and almost trivial, except in floating point, where it has to respect
rounding and NaN payloads, and around anything undefined.

Inlining replaces a call with the body of the callee. It is the highest leverage
transformation in real code, and not because calls are expensive. It is an
enabling transformation: once the body is in place, constants from the caller
flow into it, branches become decidable, and every other pass gets a larger
window. Most of what people attribute to other optimisations is inlining making
them possible.

Dead code elimination sweeps definitions nothing uses. Global value numbering
finds two computations of the same thing. Loop invariant code motion hoists work
that does not change out of the loop. All of these are stated in a paragraph
because SSA already did the hard part.

## Getting out again

SSA has to be destroyed before register allocation, because there is no phi
instruction to allocate registers for. Each phi becomes a copy on each incoming
edge, placed at the end of the predecessor block rather than at the join.

Doing that naively is wrong in two known ways, both with names. The lost copy
problem is where the copy is inserted on an edge that is also reached from
somewhere else, and the value is overwritten before it is read. The swap problem
is where two phis at the same join exchange their values, and turning them into
copies in sequence makes the second copy read what the first just wrote. Both are
avoided by inserting the copies carefully, and they are the reason a real
compiler's phi elimination is longer than the two lines it sounds like.

## What to carry forward

SSA gives every value exactly one definition, so a name is a definition. That
single property turns reaching definitions into a dereference, makes analyses
sparse, removes false dependencies, makes value numbering and dead code
elimination nearly free, and is why the middle end of every serious compiler
looks the way it does.

A phi node records which predecessor a value came from. It is not an
instruction, it is removed before register allocation, and where phis belong is
decided by the dominance frontier.

The flags in the IR are promises. Signed overflow being undefined is what lets a
32 bit loop counter become a 64 bit induction variable, and the same loop written
with an unsigned counter compiles differently for that reason alone.

Next is the back end: choosing instructions for this IR, allocating registers
under a fixed budget, and what the linker does with what comes out.

## Reading the errors you are about to see

These exercises work on small models of the structures a middle end uses, an
array of definitions with use counts, an immediate dominator array, a list of
phi arguments, rather than calling into a real optimiser.

`assert-failed` names the case your model got wrong. Several exercises assert
that a block needs no phi where a naive rule would insert one, which is the
dominance condition doing its job rather than a check being wrong.
