## What do the lambda calculus, Turing machines and the general recursive functions have in common?

- [x] They compute exactly the same set of functions
- [ ] They were all designed by the same group in the 1930s
- [ ] They all require unbounded memory to be defined
- [ ] They are all equally efficient at any given task

@why They look nothing like each other. One substitutes text, one is a machine
you could build from tin, one is a family of definitions in number theory, and
none can compute a function the others cannot.

## Is the Church-Turing thesis a theorem?

- [x] No, it connects a formal notion to an informal one, so it cannot be proved
- [ ] Yes, Turing proved it in 1936
- [ ] Yes, but only for models with unbounded memory
- [ ] No, it was disproved by quantum computation

@why It claims that this shared set is what we should mean by computable. It has
survived ninety years of people trying to think of an exception, which is
evidence rather than proof.

## Which instruction made your Part II machine universal?

- [x] The conditional jump, because the next instruction can depend on a value
- [ ] The load, because it gave the machine access to memory
- [ ] The add, because arithmetic is the basis of computation
- [ ] The halt, because a machine must be able to stop

@why Without a data-dependent branch the sequence of instructions is fixed
before the machine starts. With one, a loop can run until the data says stop,
and that is the line between a calculator and a computer.

## What are the three ingredients of universality?

- [x] A loop, a branch that depends on data, and unbounded storage
- [ ] Arithmetic, memory addressing, and subroutine calls
- [ ] A stack, a heap, and an instruction pointer
- [ ] Recursion, types, and a garbage collector

@why Nothing else. Whenever those three appear together, whether anybody
intended them to or not, you get a universal machine.

## What was Turing's universal machine?

- [x] A machine whose input is a description of another machine, plus that machine's input
- [ ] The first machine proved to halt on every input
- [ ] A machine that could simulate any physical process
- [ ] The first design with random access memory

@why That is an interpreter, and the description is a program. Before it,
machine and program were the same object; afterwards they were separate.

## What does a real computer's finite memory mean for the theory?

- [x] It is technically a finite-state machine, and the distinction tells you nothing useful
- [ ] It cannot run the same programs a Turing machine can
- [ ] It is universal only for inputs below a certain size
- [ ] The theory does not apply to real computers at all

@why The number of states is about 2 to the power of the number of bits in your
RAM. No argument that depends on running out of them says anything about the
program you are writing.

## Subleq's only instruction subtracts and jumps if the result is not positive. What can it compute?

- [x] Everything any other model can
- [ ] Only functions that do not need multiplication
- [ ] Only functions on bounded integers
- [ ] Nothing useful without at least one more instruction

@why It has no addition, no multiplication and no other control flow, and real
compilers targeting it exist. One instruction supplies the loop, the branch and
the memory access.

## What is rule 110?

- [x] A one-dimensional cellular automaton, defined by eight table entries, that is universal
- [ ] The 110th instruction of the original von Neumann architecture
- [ ] A heuristic for detecting accidental Turing completeness
- [ ] The rule that decides whether a lambda term has a normal form

@why Its entire definition is the number 110. Nothing about it was designed to
compute anything, it was conjectured universal in the 1980s, and it was proved in
2004.

## Why is accidental universality a security problem?

- [x] A system an attacker can drive to loop and branch on its own input is a machine they program
- [ ] Universal systems cannot be sandboxed
- [ ] It always implies a buffer overflow somewhere
- [ ] Universal systems consume unbounded memory by definition

@why A surprising number of file formats, template engines and build
configurations turn out to be exactly that, without anyone deciding they should
be languages.

## What does the equivalence of models say about performance?

- [x] Nothing at all, only which functions are computable
- [ ] That all models run within a constant factor of each other
- [ ] That any model can be made as fast as any other with enough memory
- [ ] That performance differences vanish for large inputs

@why A Turing machine sorting a million numbers shuffles its head across the
tape and takes vastly longer than the same sort with random access. Both compute
the same function; one of them finishes.

## Why can a regular expression not match nested brackets?

- [x] Matching them needs a count with no fixed bound, and a finite-state machine has no such storage
- [ ] Backtracking makes it exponentially slow rather than impossible
- [ ] Bracket characters are reserved in regex syntax
- [ ] It can, but only up to the engine's recursion limit

@why A machine with a fixed number of states can recognise up to some nesting
depth and no further. The pumping lemma turns that into a proof.

## Somebody says "our language cannot express that". What is usually meant?

- [x] That it would be unreadable, slow, or that the library does not exist
- [ ] That the language is not Turing complete
- [ ] That the type system rejects the program
- [ ] That the runtime lacks the necessary primitive

@why Those are objections about cost, ergonomics and effort. Naming them
correctly changes the conversation, because a capability problem has no solution
and the other three have prices.

## How does recursion relate to iteration?

- [x] Each can be written as the other, which is why recursion-only and loop-only models agree
- [ ] Recursion is strictly more powerful, because it can be non-tail
- [ ] Iteration is strictly more powerful, because it needs no stack
- [ ] They agree only for primitive recursive functions

@why A tail call is a jump with arguments. A language with recursion and no
loops is not missing anything, which is a statement about capability rather than
about which one you should write.

## Does the Collatz function terminate for every input?

- [x] Nobody knows; it has been checked to enormous values with no proof
- [ ] Yes, proved in 1976
- [ ] No, a counterexample was found in 2019
- [ ] The question is undecidable, which was proved by Rice

@why It is a concrete example of what the next unit is about: a program whose
halting nobody can decide, sitting in eight lines of C.

## What is the practical upshot of universality?

- [x] "Can it compute this" is settled and uninteresting, so the real questions are elsewhere
- [ ] Any language can be made as fast as any other
- [ ] The choice of programming language does not matter
- [ ] Every system should be designed to be Turing complete

@why The answer has been yes since 1936. What matters is how long it takes, how
much memory it needs, whether it beats the deadline, and whether anybody can read
it afterwards.
