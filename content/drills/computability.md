## What does the halting proof actually construct?

- [x] A program that asks the decider about itself and then does the opposite
- [ ] A program whose running time exceeds any bound
- [ ] An input on which every decider is slow
- [ ] A machine with infinitely many states

@why If the decider says it halts, it loops forever; if it says it loops, it
returns at once. There is no third option, so the decider does not exist.

## What do Cantor's diagonal, Gödel's theorem, Russell's paradox and the halting problem share?

- [x] Something that can talk about all of its kind is made to talk about itself
- [ ] They all rely on the axiom of choice
- [ ] They were all published in the same decade
- [ ] They all concern infinite sets of real numbers

@why Self-reference plus negation is a contradiction. Any system rich enough to
describe its own descriptions has this hole, and that richness is what made it
universal.

## What does Rice's theorem say?

- [x] Every non-trivial property of a program's behaviour is undecidable
- [ ] Halting is the only undecidable property
- [ ] Undecidable properties are those with no finite description
- [ ] Properties of behaviour are decidable given enough memory

@why Not the hard ones. All of them. If some programs have the property and some
do not, no program decides which.

## Which of these questions is decidable?

- [x] Does the source contain the word `goto`
- [ ] Does the program ever execute a `goto`
- [ ] Does the program ever dereference a null pointer
- [ ] Is this allocation ever freed

@why The condition in Rice's theorem is a property of behaviour rather than of
text, and that distinction is doing all the work.

## Does undecidable mean your compiler cannot prove your loop terminates?

- [x] No, it means no single method works for every program
- [ ] Yes, termination proofs are impossible in practice
- [ ] Only for loops whose bound is not a constant
- [ ] Only in languages with unrestricted recursion

@why Your compiler proves termination all day. It just cannot promise to, and
the difference between doing and promising is the whole of static analysis.

## A sound analysis is one that...

- [x] Answers yes only when it can prove it, and rejects things it cannot prove safe
- [ ] Never rejects a correct program
- [ ] Finds every bug in the program
- [ ] Terminates on every input

@why It never lets a bad program through and it is incomplete as a consequence.
This is why every user of a strict type checker has written a correct program
the compiler refused.

## Where do most linters and bug finders sit?

- [x] Unsound on purpose: usually right, and able to miss things
- [ ] Sound and complete, for the subset of the language they analyse
- [ ] Sound but slow
- [ ] They avoid the problem by only reading syntax

@why A tool that only reported certainties would report almost nothing, which is
why accepting false negatives is the useful choice rather than a compromise.

## Why does the kernel's eBPF verifier reject backward jumps?

- [x] A program with no backward jump cannot loop, so termination is decidable in one pass
- [ ] Backward jumps break the instruction cache
- [ ] They make the bytecode ambiguous to decode
- [ ] They are not expressible in the eBPF instruction set

@why eBPF programs run in the kernel with no timeout and no way to be killed, so
the verifier cannot afford to be wrong. It pays for that with every loop it
refuses.

## What is a timeout, in the terms of this unit?

- [x] Turning an undecidable question into a decidable question about something else
- [ ] An approximation that becomes exact as the limit grows
- [ ] A sound analysis with a configurable precision
- [ ] A way of detecting infinite loops

@why Running for a million steps decides "did it halt within a million steps",
which is a different and answerable question. Fuzzers, sanitizers and test suites
are the same exit wearing different clothes.

## What did Fred Cohen prove in 1987?

- [x] Deciding whether a program is a virus is undecidable
- [ ] That signature scanning has exponential worst-case cost
- [ ] That self-modifying code cannot be disassembled
- [ ] That every antivirus can be evaded by encryption

@why By the same construction: a program that reads the detector's verdict about
itself and does the opposite. So scanners match text and sandbox samples for a
while, and both are approximations.

## Why do scanners have false negatives by construction?

- [x] They answer a decidable question about text, which is not the question anybody wanted
- [ ] Their signature databases are always out of date
- [ ] Sandboxes are too slow to run every sample
- [ ] Heuristics are tuned to avoid false positives

@why The arms race between packers and scanners is a fight over how much text
has to stay recognisable, and it is a consequence of the theorem rather than of
engineering effort.

## Halting is semi-decidable. What does that buy you?

- [x] You can always confirm a program that halts, and never confirm one that does not
- [ ] You can decide it for programs below a known size
- [ ] You can decide it with a bounded probability of error
- [ ] Nothing practical, it is a technical refinement

@why Run it and wait. If it halts you find out. At no point during the waiting
do you learn that waiting is futile.

## A model checker reports no bug found. What do you know?

- [x] Nothing yet
- [ ] The program is correct with respect to the properties checked
- [ ] The program is correct up to the depth explored, which is a proof
- [ ] The properties were too weak to catch anything

@why Knowing which side of an answer is trustworthy is most of knowing how to use
a verification tool. Finding a bug is a proof; not finding one is an absence.

## What is the busy beaver function, and why does it matter here?

- [x] The longest running time among halting programs of a given size, and it is not computable
- [ ] The fastest terminating program for a given task
- [ ] The number of states needed to simulate any machine of size n
- [ ] A benchmark for comparing instruction sets

@why If you could compute it you could decide halting: wait that long and give
up. It grows faster than any function you can write down, which is why no timeout
has a principled value.

## For how many states is the busy beaver value now known?

- [x] Five, settled in 2024 at 47176870 steps
- [ ] Six, settled in 2024
- [ ] Four, and five is believed impossible
- [ ] Ten, using a distributed search

@why Six is unknown and its best lower bound is too large to write in ordinary
notation. Decades of work went into the five-state answer.
