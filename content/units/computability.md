---
needs: [universal, languages]
minutes: 55
one_idea: Every interesting question about what a program does is undecidable, so every tool that asks one has already chosen which way to be wrong.
sources: [compilers-interpreters-terminals-unix, nand2tetris-eater-scott]
---

Unit 017 ended with a warning. Once a machine can be handed a description of a
machine, it can be handed a description of itself, and the questions you can ask
by doing that are where computability runs out.

This is that unit. It is the one with a negative result in it, and the negative
result is more useful than it sounds, because it explains the shape of almost
every static analysis tool you have ever used.

## The question

Given a program and its input, does it stop?

That is a perfectly ordinary question. For most programs you can answer it by
looking. The claim is that no program can answer it for every program, and the
proof takes four lines.

Suppose `halts(p, x)` exists and always returns the right answer. Then write:

```c
void trouble(char *p) {
    if (halts(p, p)) for (;;) { }
    else return;
}
```

Now ask what `halts(trouble, trouble)` returns. If it says yes, `trouble` loops
forever, so the answer was wrong. If it says no, `trouble` returns immediately,
so the answer was wrong. There is no third option, so `halts` does not exist.

## Why that is not a trick

The construction looks like a word game and it is not. It is the same argument
as three other famous results, and recognising the shape is worth more than the
result itself.

Cantor showed the real numbers are uncountable by assuming a list of them and
building a number that differs from the first in the first digit, the second in
the second, and so on. Gödel showed that any consistent system strong enough for
arithmetic contains a true statement it cannot prove, by writing down a sentence
that says of itself that it is unprovable. Russell asked whether the set of all
sets that do not contain themselves contains itself.

All four are the same move: something that can talk about all of its kind can be
made to talk about itself, and self-reference plus negation is a contradiction.
Any system rich enough to describe its own descriptions has this hole, and the
richness is exactly what made it universal in the first place.

## The generalisation that hurts

Halting is one question. Rice's theorem says every question of this kind is
undecidable, and the statement is broader than people expect.

Take any property of a program's behaviour rather than its text. If some
programs have it and some do not, then no program can decide which. Not the ones
that are hard. All of them.

So each of these is impossible, in full generality:

Does this program ever print anything. Does it always return the same answer as
that one. Does it ever dereference a null pointer. Does it terminate on every
input. Does it compute the identity function. Is this code dead. Is this
allocation ever freed. Is this a virus.

The condition, a property of behaviour rather than of text, is doing real work.
"Does the source contain the word `goto`" is perfectly decidable. "Does it ever
execute a `goto`" is not.

```figure
{
  "kind": "blocks",
  "alt": "One box for decidable questions about a program's text, and a larger box for undecidable questions about its behaviour, with examples in each.",
  "caption": "The line is not difficulty, it is text against behaviour. Everything on the right is impossible in general and approximated in practice.",
  "boxes": [
    { "id": "t", "x": 0, "y": 1, "w": 5.6, "h": 2.4, "label": "about the text", "sub": "decidable: length, syntax, which names appear", "accent": "jade" },
    { "id": "b", "x": 7.4, "y": 1, "w": 6.6, "h": 2.4, "label": "about the behaviour", "sub": "undecidable: halting, output, null, dead code", "accent": "bad" }
  ],
  "arrows": []
}
```

## What this does not mean

It does not mean the questions are unanswerable for the program in front of you.
Almost every program you meet is easy: the loop is a `for` with a constant bound
and it obviously terminates.

Undecidable is a statement about all programs at once. It says no single method
works for every input, which leaves plenty of room for methods that work for
most of them. The compiler on your machine proves termination of loops all day.
It just cannot promise to, and the difference between doing and promising is the
whole of static analysis.

So the correct reading is not give up. It is: you cannot have a tool that is
always right, so decide in advance which way it will be wrong.

## The four escapes

Every real tool takes one of four exits, and knowing which one a tool took tells
you how to use it.

The first is to be conservative. Answer yes only when you can prove it, and say
no or unknown otherwise. This is sound: it never lets a bad program through. It
is also incomplete: it rejects safe programs it cannot prove safe. Type checkers
work this way, and so does Rust's borrow checker, which is why every user of it
has at some point written a correct program the compiler refused.

The second is to be unsound on purpose. Answer with a heuristic that is usually
right and can miss things. Most linters and most bug finders live here, and they
are useful precisely because a tool that only reported certainties would report
almost nothing.

The third is to restrict the language until the question becomes decidable. If
there are no loops and no recursion, everything terminates. That is why the
kernel's eBPF verifier rejects backward jumps, why some template and
configuration languages are deliberately not universal, and why total functional
languages exist. You give up expressiveness and you get a guarantee.

The fourth is to bound the resources. Run it for a million steps and report
halted, or not yet. This turns an undecidable question into a decidable one about
a different thing, and it is what a timeout is.

Fuzzers, sanitizers and test suites are all the fourth exit wearing different
clothes. They cannot tell you a program is correct. They can tell you it did not
fail in the time you gave it.

## Why the virus scanner works the way it does

Fred Cohen proved in 1987 that detecting whether a program is a virus is
undecidable, by the same construction: a program that reads the detector's
verdict about itself and does the opposite.

So no scanner detects viruses. Scanners match signatures, which is a decidable
question about text, and they run samples in a sandbox for a while, which is the
fourth exit. Both are approximations, both have false negatives by construction,
and the arms race between packers and scanners is a fight over how much text has
to stay recognisable.

The same reasoning explains why your optimiser leaves code you know is dead, why
your leak detector reports things that are not leaks, and why no linter finds
every bug. None of these are engineering failures. They are the shape the
problem has.

## The bound nobody can compute

One more consequence, and it is the one that makes the fourth exit harder than
it looks.

If you are going to run a program for a while and give up, how long should you
wait? For a program of a given size there is some longest running time among the
ones that do eventually halt. Wait that long and you have decided halting for
every program of that size.

So that number cannot be computable, and it is not. It is the busy beaver
function, and it grows faster than any function you can write down. For Turing
machines with five states the answer was settled in 2024 after decades of work:
47176870 steps. For six states nobody knows, and the best known lower bound is a
number too large to write in ordinary notation.

The practical form of this is mundane and constant. Every timeout you have ever
set is a guess, there is no principled value for it, and the reason there is no
principled value is a theorem rather than a gap in the literature. A step limit
that is generous for one input is nowhere near enough for the next, and no
amount of profiling turns that into a rule.

## Semi-decidable, which is not nothing

One refinement, because it is the difference between hopeless and merely
one-sided.

Halting is semi-decidable. You can write a procedure that says yes for every
program that halts: run it and wait. If it halts you find out. What you cannot do
is say no, because at no point during the waiting do you learn that waiting is
futile.

This asymmetry is everywhere. A proof search finds a proof if one exists and
otherwise runs forever. A model checker that finds a bug has found a bug, and one
that has not found a bug has told you nothing yet. Knowing which side of an
answer is trustworthy is most of knowing how to use a verification tool.

## What to carry forward

The boundary drawn here is absolute and it is about capability. The next unit
draws a different one, about cost, and that one is where practical work actually
lives: the questions that are perfectly decidable and take longer than the
universe has.

Both boundaries have the same practical lesson, which is why they sit together.
Neither says stop. Both say pick your compromise deliberately, because the
alternative is a tool that pretends it has none.

## Reading the errors you are about to see

These exercises build the approximations rather than the impossible thing. Three
outcomes rather than two is the recurring shape: yes, no, and not known, where
the third is an honest answer and not a failure.

`assert-failed` names the case you got wrong, and in several of these the case is
deliberately the one where the honest answer is unknown. `timeout` means your
analysis did the thing this unit says no analysis may do, which is wait forever
for an answer that is not coming.
