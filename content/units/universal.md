---
needs: [control, timing]
minutes: 50
one_idea: Every model of computation anyone has proposed computes the same set of functions, and the bar for joining that club is far lower than it looks.
sources: [nand2tetris-eater-scott, compilers-interpreters-terminals-unix]
---

In the 1930s several people, working separately and for different reasons, tried
to write down what it means for something to be computable.

Alonzo Church defined the lambda calculus, which has functions and application
and nothing else. No numbers, no loops, no memory. Alan Turing defined a machine
with an infinite tape, a head that reads and writes one symbol, and a table of
rules. Kurt Gödel and Jacques Herbrand defined the general recursive functions,
which are arithmetic and a search operator. Emil Post defined something like
Turing's machine and did not know about it.

These look nothing like each other. One is a notation for substituting text, one
is a machine you could build from tin, one is a family of definitions in number
theory.

They compute exactly the same set of functions. Every one of them. And so does
the machine you built in Part II.

## What the equivalence means

Take any Turing machine and you can write a lambda term that computes the same
function. Take any lambda term and you can build a Turing machine for it. The
translations are constructive: somebody wrote them down, and they are tedious
rather than clever.

Every model proposed since has joined the same club. Register machines. Markov
algorithms. Cellular automata. Every programming language anyone has shipped.
None of them can compute a function the others cannot.

That is a surprising empirical fact and it is the basis of the Church-Turing
thesis, which says that this shared set is what we should mean by computable.
The thesis is not a theorem and cannot be one, because it connects a formal
notion to an informal one. It is a claim that has survived ninety years of
people trying to think of an exception.

## You already built one

Part II ended with a machine that fetches an instruction, decodes it through a
table, and executes it. The unit on control made a point of one instruction in
particular: the conditional jump, where the flags become address lines on the
control memory and the table has four copies with a few cells different.

That was the moment the machine became universal, and the reason is worth
stating precisely. Without a data-dependent branch, the sequence of instructions
executed is fixed before the machine starts, so the amount of work is decided in
advance. Loading, adding and printing in a fixed order is a calculator.

With one, the next instruction can depend on a value the machine computed, so a
loop can run until the data says stop. That is the whole difference, and it costs
two address lines and four copies of a table.

The other requirement is memory that is not bounded by the design. A Turing
machine's tape is infinite; a real machine's is not, which technically makes
every real computer a finite-state machine with an enormous number of states.
That distinction is important in a proof and useless in practice, because the
number of states is around 2 to the power of the number of bits in your RAM, and
no argument that depends on running out of them tells you anything about the
program you are writing.

```figure
{
  "kind": "blocks",
  "alt": "Four models of computation, lambda calculus, Turing machines, recursive functions and your Part II machine, all pointing at one set of computable functions.",
  "caption": "Four notations with nothing in common, and one answer. Every model proposed since has landed in the same place.",
  "boxes": [
    { "id": "l", "x": 0, "y": 0,   "w": 3.6, "h": 1.2, "label": "lambda calculus", "sub": "substitution", "accent": "azure" },
    { "id": "t", "x": 0, "y": 1.6, "w": 3.6, "h": 1.2, "label": "Turing machine", "sub": "a tape and a table", "accent": "azure" },
    { "id": "r", "x": 0, "y": 3.2, "w": 3.6, "h": 1.2, "label": "recursive functions", "sub": "arithmetic and search", "accent": "azure" },
    { "id": "m", "x": 0, "y": 4.8, "w": 3.6, "h": 1.2, "label": "your Part II machine", "sub": "fetch and execute", "accent": "gold" },
    { "id": "s", "x": 6.8, "y": 2.4, "w": 4.4, "h": 1.2, "label": "the computable functions", "accent": "jade" }
  ],
  "arrows": [
    { "from": "l", "to": "s" },
    { "from": "t", "to": "s" },
    { "from": "r", "to": "s" },
    { "from": "m", "to": "s" }
  ]
}
```

## A universal machine is an interpreter

Turing's word for it was universal, and the construction behind the word is one
you use every day without calling it that.

Most Turing machines do one job. Their table of rules is the program, and a
machine that adds is a different machine from one that compares. Turing's
contribution was to build a single machine whose input is a description of
another machine, followed by that machine's input, and which then does whatever
the described machine would have done.

That is an interpreter, and the description is a program. Before this
construction, machine and program were the same object; afterwards they were
separate, and one piece of hardware could be sold to people who had not agreed in
advance on what it would do. The stored-program computer is this idea with a
budget.

It also explains something about the exercises here. Writing an interpreter for
a small language inside C is not a toy version of the theory, it is the theory:
your C program is a universal machine, its input is a program for a different
machine, and the fact that this works at all is the result.

And it sets up the trap in unit 018. Once a machine can be handed a description
of a machine, it can be handed a description of itself, and the questions you can
ask by doing that are where computability runs out.


## The bar is embarrassingly low

Here is the part that reorganises how you look at systems.

Universality does not require a rich language. It requires the ability to loop,
the ability to branch on data, and access to unbounded storage. Nothing else.
Whenever those three appear together, whether anybody intended them to or not,
you get a universal machine.

One instruction is enough. There is a machine whose only instruction subtracts
one value from another and jumps if the result is not positive. It has no
addition, no multiplication and no other control flow, and it computes
everything. Compilers for it exist.

The pattern shows up constantly and usually by accident. Conway's Game of Life is
universal, and so is the one-dimensional cellular automaton rule 110, whose
entire definition is a table of eight entries. The x86 `mov` instruction on its
own is universal, which somebody demonstrated by writing a compiler that emits
nothing else. Magic: The Gathering is universal. So are several configuration
formats that were not supposed to be languages at all, and several type systems
whose designers wanted them to terminate.

Accidental universality is a security problem rather than a curiosity. A parser
that can be driven to loop and branch on its own input is a machine an attacker
programs, and a surprising number of file formats, template engines and
build configurations turn out to be exactly that.

## What it does not give you

The equivalence is about which functions are computable and says nothing about
what they cost.

A Turing machine that sorts a million numbers has to shuffle its head back and
forth across the tape, and it takes vastly longer than the same sort on a machine
with random access, because moving to an arbitrary position costs a step per cell
rather than one step. Both machines compute the same function. One of them
finishes.

So "can this system compute it" is almost never the question worth asking. The
answer is yes, and it has been yes since 1936. The questions that matter are how
long it takes, how much memory it needs, whether the answer arrives before the
deadline, and whether anybody can read the program afterwards.

This is why the equivalence, having been established, mostly stops being useful.
Its job was to tell you that the interesting differences between machines are
not about capability, and having done that, it hands the subject over to the two
units that follow: what cannot be computed at all, and what can be computed but
not quickly.

## The one thing it does settle

There is a practical use, and it is a good one.

"Our language cannot express that" is almost always false, and hearing it should
make you ask what is really meant. Usually one of three things. That the
expression would be unreadable. That it would be slow. Or that a library does not
exist and writing it is work nobody wants to do.

Those are real objections, and they are objections about cost, ergonomics and
effort rather than about capability. Naming them correctly changes the
conversation, because a capability problem has no solution and the other three
have prices.

## What to carry forward

Universality is cheap, common and mostly uninformative. Loop, branch on data, and
enough memory is the entire recipe, and systems fall into it accidentally.

The interesting boundaries lie elsewhere, and the next three units draw them.
What a machine can recognise with no memory at all, which turns out to be
exactly the regular languages and is why your lexer is what it is. What no
machine can decide however long it runs. And what is decidable and still out of
reach because the running time grows faster than anyone can wait.

## Reading the errors you are about to see

These exercises are C, compiled and run for real, and they build small machines
rather than reasoning about them.

`assert-failed` means your machine computed the wrong thing on a case the checks
name. `timeout` is the interesting one here: a machine that never halts is a
correct outcome for some inputs and a bug for others, and telling those apart is
the subject of unit 018.
