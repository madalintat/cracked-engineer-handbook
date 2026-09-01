---
needs: [raii]
minutes: 55
one_idea: A header is textual inclusion and a template is not code until it is instantiated, so the work your build does is roughly the number of translation units times what each one drags in.
sources: [numbers-text-numerics, compilers-interpreters-terminals-unix]
---

Builds in this language are slow, and the reason is not that the compiler is bad.
It is that the compilation model asks for an enormous amount of repeated work,
and almost every technique for making a build faster is a way of asking for less
of it.

## What a translation unit is

The compiler sees one file at a time. Preprocessing pastes every included header
into it textually, and the result, a translation unit, is compiled from scratch
with no knowledge of any other.

Measured, on a real compiler:

A two-line program with no includes preprocesses to 9 lines and compiles in about
20 milliseconds. The same program with `#include <vector>` preprocesses to 65766
lines and compiles in about 250 milliseconds. Adding four more common headers
takes it to 74864 lines and about 320 milliseconds.

One include, two lines of your own code, and the compiler now reads sixty five
thousand lines. Multiply by the number of files in a project and the arithmetic
stops being surprising.

```figure
{
  "kind": "plot",
  "alt": "Compile time against preprocessed line count for three small programs, rising from twenty milliseconds at nine lines to over three hundred at seventy five thousand.",
  "caption": "Measured. The source is two lines in every case. What changes is how much of the standard library the preprocessor pasted in front of it.",
  "log": true,
  "xlabel": "preprocessed lines",
  "ylabel": "milliseconds",
  "series": [
    { "label": "one translation unit", "accent": "bad",
      "points": [[9, 20], [65766, 250], [74864, 322]] }
  ]
}
```

## A template is a recipe

A function template is not a function. It is instructions for producing one, and
nothing is produced until somebody uses it with particular types.

Which is why templates live in headers. The compiler needs the body at the point
of use, because that is where it finds out which types to substitute. A template
defined in one source file and used in another does not link, and the error says
undefined reference to something that looks defined.

The consequence is the repeated work. Every translation unit that uses
`vector<int>` instantiates it, compiles it, and emits it. The linker then throws
away all but one copy. Five hundred files using the same three containers means
fifteen hundred instantiations compiled and fourteen hundred and ninety seven
discarded.

## Where the time actually goes

Four costs, in roughly the order they bite.

Parsing what the preprocessor pasted in. This is the 65766 lines above, and it
happens once per translation unit, every build.

Instantiating templates, which means substituting types and compiling the result.
A deeply nested type does this many times, and the error messages people complain
about are a symptom of the same thing: the compiler is reporting a stack of
substitutions because that stack is what it actually did.

Optimising, which is superlinear in function size and is why heavy inlining is
not free at build time.

And linking, which has to deduplicate everything the first two steps produced in
triplicate.

## What to do about it

The techniques all reduce one of those four, and it is worth knowing which.

Include less. A forward declaration is enough when you only need a pointer or a
reference, and replacing an include with one removes that header from this
translation unit's cost entirely. Tools exist that compute this for you and their
output is usually startling.

Move definitions out of headers where the type set is known. An explicit
instantiation in one source file compiles the template once, and the header
declares that it exists, so nothing else instantiates it.

Break the dependency. The pimpl idiom puts a class's members behind a pointer to
an incomplete type, so the header stops mentioning their headers, and changing a
private member stops rebuilding everything downstream. It costs an indirection
and an allocation.

Measure rather than guess. Compilers report where their time went, at the level
of individual template instantiations, and the answer is routinely one header
nobody suspected.

## Computing during the build

The other half of compile time is the part you use deliberately.

`constexpr` marks a function that may run at compile time when its arguments are
known, and at run time otherwise. `consteval` marks one that must run at compile
time, which turns a missed opportunity into an error rather than a silent
fallback.

What is permitted has grown steadily. Loops, local variables, allocation that
does not escape, most of the standard containers. It is close enough to ordinary
code that the interesting question is no longer what can be done but what should
be, since every value computed during the build is build time spent.

`if constexpr` is the related tool and it does something a runtime `if` cannot:
the branch not taken is discarded rather than compiled. That is what lets one
function body handle types for which the other branch would not even be valid,
and it replaced a large amount of machinery that existed only to express the same
idea.

## Two phases, and the keyword nobody expects

One rule of the language exists purely because of when things are looked up, and
it produces an error people find baffling.

A template is checked twice. Names that do not depend on the template parameters
are resolved when the template is defined, and names that do are resolved when it
is instantiated. That is two-phase lookup, and it is what lets a compiler
diagnose a typo in a template nobody ever used.

The awkwardness is that the compiler must parse the template before knowing the
types, so it has to decide what a dependent name means without being able to look
it up. Its default assumption is that a dependent name is a value, not a type,
which is why writing a nested type of a template parameter requires the
`typename` keyword to say otherwise, and why calling a member template requires
the `template` keyword in the same position.

Neither adds information a human needed. They exist so the parse can proceed, and
they are a good illustration of the general shape of this subject: most of what
feels arbitrary is a consequence of the compiler seeing one file at a time, in
order, with no way to look ahead.

## The error messages, and the fix

Before concepts, constraining a template meant arranging for the wrong types to
produce a substitution failure, which removed the candidate from consideration
without an error. It worked and it produced the diagnostics the language is
famous for, because the compiler could report only that nothing matched and then
recite everything it tried.

Concepts state the requirement directly. The constraint is named, checked at the
call, and the error says which requirement was not satisfied. Same expressive
power, an error message a person can act on, and the reason to adopt them is
entirely about the second thing.

## The fix nobody has finished adopting

Modules replace textual inclusion with a compiled artefact. The exporting file is
compiled once, its interface is stored, and importing it costs reading that
rather than reparsing the source.

The saving is exactly the number above: the 65766 lines are read once for the
project rather than once per file. Reported build time reductions are large and
consistent.

Adoption is slow because a module is a build system problem before it is a
language one. The order files compile in now depends on their imports, which
means the build system has to scan sources to discover dependencies before it can
schedule anything, and the tooling for that arrived years after the language
feature.

## The cost that is not the compiler's

One more contributor, because it is usually larger than any of the above and is
nobody's fault in the code.

A build rebuilds what changed and everything downstream of it. Touch a header
that five hundred files include and the build is five hundred translation units
regardless of how small the change was, which is why a one-character edit can
cost as much as a clean build.

So the shape of your include graph decides your incremental build time, and the
lever is the same one as before: fewer edges. A header that includes only what
its own declarations need has fewer files downstream of it, and a change to a
private implementation detail behind a pointer has none at all.

The related lever is caching. A compiler cache keyed on the preprocessed input
turns a rebuild of unchanged translation units into a file copy, which is why it
helps enormously on a branch switch and not at all on the edit you just made.

## What to carry forward

Compilation is per translation unit, headers are pasted in textually, and
templates instantiate everywhere they are used and deduplicate at link time.
Those three facts predict the cost.

One `#include <vector>` costs sixty five thousand lines and a quarter of a
second, measured, before your own code is considered.

And the compile-time computation features are a budget rather than a free lunch:
every value computed during the build is time somebody waits for, once per build,
on every machine.

## Reading the errors you are about to see

These are C++ and several assert things at compile time, using `static_assert`,
which means a wrong answer is a compile error rather than a failed check.

`compile-error` is therefore the interesting verdict in this unit rather than a
sign that something is broken. When an exercise expects it, the failure it
describes was caught before the program existed, which is the entire point of the
technique being demonstrated.
