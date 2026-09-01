---
needs: [universal]
minutes: 55
one_idea: A pattern language is a machine class, and the machine you pick decides whether matching is linear or exponential.
sources: [compilers-interpreters-terminals-unix, nand2tetris-eater-scott]
---

The last unit said every model of computation is equivalent. This one is about
what happens when you deliberately take capability away, and why doing so is one
of the more useful things in the field.

A machine with no memory beyond its own state can recognise some patterns and
not others. Give it a stack and it recognises more. Give it a tape and it
recognises everything recognisable. Those three steps are a hierarchy, each rung
is a class of machine and a class of language at the same time, and the tools on
your disk are built on the bottom two rungs on purpose.

## No memory at all

A finite automaton is a set of states, a start state, a set of accepting states,
and a table saying which state each input character moves you to. It has no
counter, no stack, and no storage other than which state it is currently in.

Running one is a loop with a table lookup. One pass over the input, one array
access per character, no allocation and no backtracking. It is about as fast as
reading the input at all, which is the point.

The languages a finite automaton can recognise are called regular, and the
question of which those are has a clean answer: exactly the ones expressible by
the original regular expression operators, which are alternation, concatenation
and repetition. Kleene proved that equivalence in 1951, and the whole industry of
pattern matching rests on it.

Your lexer is one of these. Identifiers, numbers, strings and operators are all
regular, so the phase of a compiler that turns characters into tokens can be a
single pass with no memory, and it is.

## What no memory costs

A finite automaton cannot count without bound, because counting to an arbitrary
number needs an arbitrary number of states and it has a fixed number.

That is the whole reason it cannot match nested brackets. To know that a closing
bracket is the right one you have to remember how many are open, and there is no
limit on how many that could be. You built the counter for this in the last
unit; a finite automaton has nowhere to put it.

The formal argument is the pumping lemma, and its shape is simple. If a machine
with `k` states accepts a string longer than `k`, it must have visited some state
twice, so there is a loop in the middle of that string. Anything in a loop can be
repeated, so the machine also accepts the string with that section repeated. For
balanced brackets that repetition unbalances them, and the machine accepts
something it should not.

This is where "you cannot parse HTML with a regular expression" comes from. It is
not a matter of taste or difficulty. Nested tags need a count, regular languages
have no count, and no amount of cleverness inside the class escapes the class.

```figure
{
  "kind": "blocks",
  "alt": "Three nested boxes showing regular languages inside context-free languages inside recursively enumerable languages, each labelled with its machine.",
  "caption": "Each rung is a machine and a class of language at once. Your lexer lives on the first, your parser on the second, and everything else on the third.",
  "boxes": [
    { "id": "r", "x": 0.6, "y": 2.2, "w": 4, "h": 1.3, "label": "regular", "sub": "no memory", "accent": "jade" },
    { "id": "c", "x": 5.6, "y": 2.2, "w": 4.4, "h": 1.3, "label": "context free", "sub": "one stack", "accent": "azure" },
    { "id": "e", "x": 11, "y": 2.2, "w": 4.4, "h": 1.3, "label": "everything else", "sub": "a tape", "accent": "copper" }
  ],
  "arrows": [
    { "from": "r", "to": "c", "label": "add a stack" },
    { "from": "c", "to": "e", "label": "add a tape" }
  ]
}
```

## One stack, and most languages become possible

Add a stack and you have a pushdown automaton, and the languages it recognises
are the context-free ones. Balanced brackets are the standard example, and so is
almost every programming language's grammar.

The stack is doing the obvious thing: it remembers what you are inside. Push on
the way into a construct, pop on the way out, and the discipline of a stack
matches the discipline of nesting exactly.

Which is why a compiler has two front-end phases rather than one. The lexer is
regular and fast and turns characters into tokens. The parser is context-free
and turns tokens into a tree. Splitting them is not tidiness: it means the
expensive machine only ever sees the small stream, and the cheap machine handles
the large one.

## Two ways to run a regular expression

Now the part with the outage in it.

There are two ways to match a regular expression, and the industry mostly picked
the worse one.

The first is to build an automaton and run it. Thompson's construction turns the
expression into a machine with several possible current states, and you advance
all of them one character at a time. The work per character is bounded by the
size of the expression, so matching takes time proportional to the length of the
input times the size of the pattern. It never backtracks because it never
guessed.

The second is to walk the pattern recursively, trying each alternative and
undoing the choice when it fails. This is easy to write, easy to extend, and it
is a search rather than an automaton. On most inputs it is fast. On some it is
catastrophic.

## Where the 235 million steps come from

The pattern is `a?a?a?...a?` repeated `n` times, followed by `a` repeated `n`
times, matched against a string of `n` letter a's. It matches. Every `a?` can
take its character or leave it, and the number of ways to distribute the
characters among the optional parts is exponential in `n`, so a backtracking
matcher explores them all before finding one that works.

Here is the measurement, from the matcher this unit's fifth exercise has you
write. The step count is the number of recursive calls.

```figure
{
  "kind": "plot",
  "alt": "A logarithmic plot of backtracking steps against pattern size, rising from 143 steps at 5 characters to 18 billion at 30.",
  "caption": "Recursive calls to match n characters, measured. The curve is a straight line on a log axis, which is what exponential looks like.",
  "log": true,
  "xlabel": "characters",
  "ylabel": "steps",
  "series": [
    { "label": "backtracking", "accent": "bad",
      "points": [[5, 143], [10, 7167], [15, 311295], [20, 12582911],
                 [25, 486539263], [30, 18253611007]] },
    { "label": "automaton", "accent": "jade",
      "points": [[5, 25], [10, 100], [15, 225], [20, 400], [25, 625], [30, 900]] }
  ]
}
```

Twenty-four characters costs 234881023 steps. Twenty-eight costs 4294967295. The
automaton matching the same pattern does work proportional to `n` squared, which
at 30 characters is 900.

This is not a hypothetical. On 2 July 2019 Cloudflare deployed a rule to its
firewall containing a regular expression that could backtrack this way, and it
took their global network down for about half an hour. The regular expression was
correct. It matched what it was supposed to match. It just did so, on some
inputs, by taking a number of steps with no useful upper bound.

The failure has a name, catastrophic backtracking, and a family of attacks built
on it, where a request is chosen specifically to make a server's own pattern
matching consume its CPU.

## What the backtracking engines bought

They did not choose badly for no reason. Backtracking gives you things an
automaton cannot express.

Backreferences are the main one. A pattern that matches a repeated substring, so
that whatever the first group captured must appear again, is not a regular
language at all, and no finite automaton recognises it. Lookahead, lookbehind and
lazy repetition are in the same category: convenient, widely used, and outside
the class that has the linear-time guarantee.

So the practical position is a trade rather than a mistake. Engines built on
automata, of which RE2 is the well known one, promise linear time and refuse to
implement backreferences. Engines built on backtracking implement everything and
promise nothing. Choosing between them means deciding whether your patterns come
from you or from somebody else.

The rule that follows is short. A pattern you wrote, matched against input you
control, may use whatever you like. A pattern from a user, or any pattern matched
against hostile input, belongs on an engine that cannot be made to take
exponential time.

## Determinising, and why it is not always done

One more piece, because it explains a decision every regex library has made.

Thompson's machine can be in several states at once, which is what a
nondeterministic automaton means. You can convert it to a deterministic one where
each state of the new machine is a set of states of the old, and then matching is
one table lookup per character with no set to track. That is the subset
construction, and it is why a lexer generator emits a table rather than a search.

The catch is that the number of subsets can be exponential in the number of
original states. For a lexer's patterns it never is, and the table is built once
when the tool runs. For a pattern supplied at run time it might be, so libraries
build the deterministic states lazily, caching each one the first time it is
reached and discarding the cache when it grows too large. A pattern that would
have blown up simply runs a little slower.

That is the shape of the whole subject in one design. The theory says the worst
case is bad, the ordinary case is nothing like the worst case, and the
engineering is arranged so that meeting the worst case costs you speed rather
than availability.


## What to carry forward

Restricting a machine is a design tool. The lexer is fast because it was denied
memory, and the parser is possible because it was given exactly one stack and no
more.

The hierarchy also tells you what to expect when a format grows. A configuration
language that acquires references becomes context free, and one that acquires
conditionals and loops becomes universal, at which point nobody can decide
whether a given input terminates. That last claim is the next unit.

## Reading the errors you are about to see

These build automata and matchers in C. `assert-failed` names the string your
machine got wrong, and the strings are chosen so that a plausible wrong answer
fails on one of them rather than on all of them.

`timeout` appears in this unit for a real reason rather than as an accident. A
matcher that backtracks can take longer than the service allows on an input of
two dozen characters, which is the entire point of the exercise it appears in.
