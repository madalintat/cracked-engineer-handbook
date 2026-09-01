## What does the compiler see at a time?

- [x] One translation unit: your file with every header pasted in textually
- [ ] The whole project, after a dependency scan
- [ ] One function at a time
- [ ] One header at a time, cached between files

@why Each is compiled from scratch with no knowledge of any other, which is the
fact that predicts almost all of the cost.

## A two-line program with `#include <vector>` preprocesses to how many lines?

- [x] About 65766
- [ ] About 500
- [ ] About 5000
- [ ] The same nine lines; headers are cached

@why Measured. It also takes about 250 milliseconds against 20 for the version
with no includes, before any of your own code is considered.

## Why do templates have to live in headers?

- [x] The compiler needs the body at the point of use, to know which types to substitute
- [ ] Headers are compiled first
- [ ] The linker cannot resolve template symbols
- [ ] They do not; it is a convention

@why A template defined in one source file and used in another does not link, and
the error says undefined reference to something that looks defined.

## Five hundred files use `vector<int>`. How many times is it instantiated?

- [x] Five hundred, and the linker discards all but one
- [ ] Once, in the first file compiled
- [ ] Once per distinct member function used
- [ ] Once per library, at link time

@why That repeated work is the reason explicit instantiation in one file is worth
doing for the templates everybody uses.

## Which of these reduces parsing cost rather than instantiation cost?

- [x] Replacing an include with a forward declaration
- [ ] Explicit instantiation in one source file
- [ ] Using `if constexpr` instead of tag dispatch
- [ ] Constraining a template with a concept

@why It removes the header from this translation unit entirely. Knowing which of
the four costs a technique attacks is what makes the technique worth applying.

## What does the pimpl idiom buy?

- [x] The header stops naming the members' headers, so changing a private member stops rebuilding downstream
- [ ] Faster member access
- [ ] Smaller objects
- [ ] Automatic thread safety

@why It costs an indirection and an allocation, and it converts a recompile of
everything downstream into a recompile of one file.

## What is the difference between `constexpr` and `consteval`?

- [x] `constexpr` may run at compile time; `consteval` must
- [ ] `consteval` allows loops and `constexpr` does not
- [ ] `constexpr` is for functions and `consteval` for variables
- [ ] They are synonyms in C++20

@why A `constexpr` function called with a run-time argument quietly becomes an
ordinary call, which is usually fine and occasionally the opposite of what you
wanted.

## What does `if constexpr` do that a runtime `if` cannot?

- [x] Discards the untaken branch rather than compiling it
- [ ] Evaluates the condition faster
- [ ] Guarantees the branch is predicted correctly
- [ ] Allows the condition to be non-boolean

@why That is what lets one body handle types for which the other branch would not
even be valid, and it replaced tag dispatch and a pile of enable_if overloads
that existed only to express the same idea.

## Why are pre-concepts template error messages so long?

- [x] The compiler can only report that nothing matched, then recite everything it tried
- [ ] The standard requires full instantiation backtraces
- [ ] Templates are compiled twice
- [ ] The messages include the preprocessed source

@why Constraining a template meant arranging for a substitution failure, which
removed a candidate silently. Concepts name the requirement, so the error can say
which one was not satisfied.

## What do concepts add over substitution failure?

- [x] A nameable requirement, so the error says which one failed
- [ ] More expressive constraints
- [ ] Faster compilation
- [ ] Run-time type checking

@why Same expressive power. The reason to adopt them is entirely the error
message.

## What is two-phase lookup?

- [x] Non-dependent names resolve at definition and dependent ones at instantiation
- [ ] Headers are parsed twice, once for declarations
- [ ] Templates are compiled once per phase of the build
- [ ] Overload resolution runs before and after instantiation

@why It is what lets a compiler diagnose a typo in a template nobody ever used.

## Why is the `typename` keyword needed before a dependent nested name?

- [x] The parser must decide what the name means before it can look it up, and assumes value
- [ ] To disambiguate between two overloads
- [ ] To force instantiation at that point
- [ ] To make the name visible outside the template

@why It adds nothing a human needed. It exists so the parse can proceed, which is
the general shape of this subject.

## What do modules replace?

- [x] Textual inclusion with a compiled interface read once per project
- [ ] The linker's deduplication step
- [ ] Templates with a compiled generic form
- [ ] The preprocessor entirely

@why The saving is exactly the measured number: the sixty five thousand lines are
read once rather than once per file.

## Why has module adoption been slow?

- [x] Compile order now depends on imports, so the build system must scan sources first
- [ ] Compilers have not implemented them
- [ ] They break existing headers
- [ ] They increase binary size

@why It is a build system problem before it is a language one, and the tooling
arrived years after the language feature.

## Why can one character's edit cost as much as a clean build?

- [x] Everything downstream of the changed header is rebuilt, however small the change
- [ ] The compiler cannot detect small changes
- [ ] Optimisation is rerun across the whole program
- [ ] Link-time deduplication is global

@why The shape of the include graph decides incremental build time, and fewer
edges is the same lever as everything else in this unit.
