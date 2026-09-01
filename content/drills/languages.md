## What storage does a finite automaton have?

- [x] Only which state it is currently in
- [ ] A single counter of unbounded size
- [ ] A stack, bounded by the length of the input
- [ ] One character of lookahead

@why No counter, no stack, nothing else. Running one is a loop with a table
lookup, which is why it costs about as much as reading the input at all.

## What did Kleene prove in 1951?

- [x] Finite automata recognise exactly the languages the regular expression operators describe
- [ ] That regular expressions can be matched in linear time
- [ ] That the subset construction always terminates
- [ ] That context-free languages need a stack

@why The whole industry of pattern matching rests on that equivalence: a pattern
written with alternation, concatenation and repetition is a machine, and the
machine is fast.

## Why can a finite automaton not match nested brackets?

- [x] Knowing which closer matches needs a count with no bound, and it has a fixed number of states
- [ ] Brackets are not in the regular alphabet
- [ ] It can, but only with backtracking
- [ ] Nesting requires lookahead, which automata lack

@why No amount of cleverness inside the class escapes the class. This is where
"you cannot parse HTML with a regular expression" comes from, and it is a fact
rather than a matter of taste.

## What is the shape of the pumping lemma's argument?

- [x] A machine with k states accepting a longer string must repeat a state, so part of it can be looped
- [ ] Any accepted string can be shortened while remaining accepted
- [ ] The number of states grows with the length of the shortest rejected string
- [ ] Two automata accepting the same language have the same number of states

@why Anything in a loop can be repeated, so the machine also accepts the pumped
string. For balanced brackets that repetition unbalances them, and the machine
accepts something it should not.

## What does adding one stack buy you?

- [x] The context-free languages, which include almost every programming language's grammar
- [ ] The ability to match backreferences
- [ ] Linear-time matching for all patterns
- [ ] Nothing a counter could not already do

@why The stack remembers what you are inside. Push on the way in, pop on the way
out, and the discipline of a stack matches the discipline of nesting exactly.

## Why does a compiler split lexing from parsing?

- [x] So the expensive machine only sees the small token stream and the cheap one handles the characters
- [ ] Because the parser cannot read files
- [ ] Because tokens must be interned before parsing
- [ ] To allow the two phases to run on different threads

@why The lexer is regular and fast, the parser is context-free. Splitting them
is not tidiness, it is an allocation of work to the cheapest machine that can do
it.

## How does Thompson's construction match without backtracking?

- [x] It advances every possible current state one character at a time
- [ ] It tries alternatives in order and remembers where to resume
- [ ] It compiles the pattern to machine code
- [ ] It converts the pattern to a deterministic machine first

@why It never backtracks because it never guessed. Work per character is bounded
by the size of the expression, so matching is linear in the input.

## What is catastrophic backtracking?

- [x] A recursive matcher exploring an exponential number of ways to succeed
- [ ] A stack overflow in a recursive descent parser
- [ ] An automaton with exponentially many states after determinisation
- [ ] A pattern that never terminates because of a cycle

@why Every optional element can take its character or leave it. The number of
ways to distribute characters among them is exponential, and the matcher tries
them all.

## Matching 24 characters against the pathological pattern took how many steps?

- [x] 234881023
- [ ] About 24 squared, so around 600
- [ ] About two million
- [ ] It does not terminate

@why Measured, not estimated. At 28 characters it is 4294967295. The automaton
doing the same job at 30 characters does about 900 units of work.

## What happened to Cloudflare on 2 July 2019?

- [x] A firewall rule with a backtracking regular expression took the network down for about half an hour
- [ ] A certificate expired across the edge network
- [ ] A routing leak sent traffic to the wrong datacentres
- [ ] A deploy removed a rate limiter

@why The regular expression was correct and matched what it was supposed to
match. It just did so, on some inputs, in a number of steps with no useful upper
bound.

## Why did the popular engines choose backtracking?

- [x] It gives features an automaton cannot express, such as backreferences
- [ ] It is faster on typical inputs
- [ ] It uses less memory for large patterns
- [ ] Automata cannot handle Unicode

@why Backreferences, lookahead, lookbehind and lazy repetition are convenient,
widely used, and outside the class that has the linear-time guarantee. It is a
trade rather than a mistake.

## What does RE2 refuse to implement, and what does it promise in return?

- [x] Backreferences, in exchange for a linear-time bound
- [ ] Unicode classes, in exchange for a smaller binary
- [ ] Alternation, in exchange for a simpler compiler
- [ ] Anchors, in exchange for streaming input

@why A pattern that requires a captured group to appear again is not a regular
language at all, so an engine built on automata cannot offer it.

## When must you use a non-backtracking engine?

- [x] When the pattern or the input comes from somebody else
- [ ] Whenever the pattern contains repetition
- [ ] For any input longer than a kilobyte
- [ ] Only in kernel code

@why A pattern you wrote, matched against input you control, may use whatever
you like. Anything hostile belongs on an engine that cannot be made to take
exponential time.

## What is a state of a deterministic machine, after the subset construction?

- [x] A set of states of the nondeterministic one
- [ ] A single state, chosen by a heuristic
- [ ] A pair of a state and a lookahead character
- [ ] A position in the original pattern

@why That is also why the number of them can be exponential in the size of the
original machine, which is the catch the construction is famous for.

## How do libraries handle the risk of exponential determinisation?

- [x] They build deterministic states lazily and discard the cache when it grows
- [ ] They reject patterns above a certain size
- [ ] They fall back to backtracking
- [ ] They precompute every subset at build time

@why A pattern that would have blown up runs a little slower instead. The
engineering is arranged so that meeting the worst case costs speed rather than
availability.
