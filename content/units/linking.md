---
needs: [elf, abi]
minutes: 55
one_idea: The target of a call into a shared library is chosen at load time by an ordered search, and anything that can get in front of that order decides what your program calls.
sources: [x86-64-assembly, compilers-interpreters-terminals-unix]
---

Unit 023 stopped at the point where a symbol is left unresolved for somebody else
to fill in. This unit is about who fills it in, in what order they look, and what
follows from the order being visible and changeable from outside the program.

## The program that runs before yours

A dynamically linked executable names an interpreter inside itself, and the
kernel starts that rather than your code. The interpreter is a shared library
with an entry point, it loads the libraries your program needs and the libraries
those need, applies relocations, runs initialisers, and only then jumps to your
entry point.

So the loader is a program running in your address space with your privileges,
before anything you wrote, driven by a list of names and a search procedure. Most
of what follows is a consequence of that being true.

## Where it looks

The search for a named library is ordered, and every step of the order is worth
knowing because each is a place something can be inserted.

A path compiled into the executable comes first. Then the environment variable,
unless the process is privileged. Then a cache the system maintains, which is
what makes the search fast rather than a directory scan. Then the default
directories.

The compiled-in path exists in two forms, an older one that cannot be overridden
by the environment and a newer one that can, and which of the two a binary uses
changes whether a user can substitute a library at all. That distinction is
invisible in the source and decided by a linker flag.

## First definition wins

Once the libraries are loaded, symbols are resolved against a single ordered
list: the executable first, then its libraries in the order they were loaded.
The first definition found is the one every reference resolves to, everywhere.

Not the nearest one. The first one. A library that calls its own `malloc` gets
whichever `malloc` is first in the global list, which may belong to something
else entirely, and that is not a bug in either library.

```figure
{
  "kind": "blocks",
  "alt": "An ordered list of scopes with a preloaded library at the front, then the executable, then three libraries, with a lookup arrow stopping at the first definition.",
  "caption": "One list, searched in order, first definition wins. Anything inserted at the front decides what every reference in the whole program resolves to.",
  "boxes": [
    { "id": "p", "x": 0,   "y": 0.2, "w": 3.4, "h": 1.1, "label": "preloaded", "accent": "gold" },
    { "id": "e", "x": 0,   "y": 1.6, "w": 3.4, "h": 1.1, "label": "executable", "accent": "azure" },
    { "id": "a", "x": 0,   "y": 3.0, "w": 3.4, "h": 1.1, "label": "libfoo", "accent": "azure" },
    { "id": "b", "x": 0,   "y": 4.4, "w": 3.4, "h": 1.1, "label": "libc", "accent": "azure" },
    { "id": "r", "x": 5.2, "y": 0.2, "w": 3.6, "h": 1.1, "label": "resolves here", "accent": "jade" }
  ],
  "arrows": [
    { "from": "p", "to": "r" }
  ]
}
```

## The variable that puts you first

`LD_PRELOAD` names libraries loaded before everything else, which puts their
definitions at the front of that list. Every reference to a name they define, in
the executable and in every library, resolves to theirs.

This is a feature and a large one. It is how a memory checker intercepts every
allocation without recompiling anything, how a tracer wraps every network call,
how a test replaces a clock, and how a great deal of debugging gets done on
software nobody has the source for.

The technique has one requirement: your replacement usually needs to call the
original. The loader provides a lookup that continues the search from after the
current library, so a wrapper finds the real function and calls it. Without that,
interposition could only replace, and almost every use of it wants to observe.

## Why it stops at a privilege boundary

A program running with elevated privileges ignores the variable entirely, and the
reason is immediate once the mechanism is clear: an attacker who can set an
environment variable would otherwise choose what a privileged program's every
call resolves to.

So the same flexibility that makes interposition useful makes it an attack, and
the boundary is drawn at the point the program stops belonging to whoever started
it. This is also why the compiled-in search paths matter: a binary that trusts a
directory a user can write to has the same problem without needing the variable
at all.

## The symbols nobody meant to export

By default a shared library exports every symbol with external linkage, which is
usually far more than its interface.

Three things follow. The dynamic symbol table is large, so every lookup is
slower and startup costs more. Internal names are visible, so a caller can depend
on something never meant to be stable. And any of them can collide with another
library's, at which point the first-wins rule picks one and neither library is
told.

The fix is to hide everything by default and mark the interface explicitly.
Compilers have a flag for the default and an attribute for the exceptions, and
the resulting library starts faster, has a smaller table, and cannot be broken by
a name it never meant to publish.

## Two definitions, no diagnostic

The collision case deserves stating plainly because it is silent.

Two libraries each define a function with the same name, both are loaded, and
every call anywhere goes to whichever came first. The second library's calls to
its own function go to the other library's version, and nothing reports anything.

This is not hypothetical. It happens with common helper names, with symbols
leaked from statically linked dependencies, and with two versions of one library
loaded through different paths. The symptoms are behaviour changing when an
unrelated dependency is added, and an ordering that differs between machines.

Hiding internal symbols removes the whole category, which is the practical
argument for doing it.

## Loading on purpose

`dlopen` loads a library while the program runs and returns a handle, and
`dlsym` finds a symbol in it. That is how plugins work, and how a program uses an
optional dependency it may not have been built against.

It brings the same rules with it. A plugin's symbols enter the same ordered
scope, so a plugin can shadow the host's functions, and a program loading two
plugins that share a name gets the first-wins behaviour between them. Loading a
library with a flag that keeps its symbols local avoids that and is the sensible
default for anything untrusted.

## The cost you pay at every call

Unit 023 described the two tables. What is worth adding is what they cost, since
it is the other half of the static-against-dynamic decision.

A call into a shared library goes through a stub which jumps through a table
slot, so it is an indirect call rather than a direct one. The processor has to
predict the target, which it does well because the slot rarely changes, and the
extra load is usually in cache. On a hot path it is measurable and small.

The larger cost is that the compiler cannot see through it. A function in another
shared library cannot be inlined, its arguments cannot be propagated into, and
nothing about it can be assumed. A small accessor that would have vanished
entirely if statically linked becomes a real call with real argument setup.

Which is why the same code can be meaningfully faster in a static build, and why
the measurement to make is not the call overhead but the optimisation that did
not happen. Link-time optimisation exists to recover some of it and only works
across things linked together.

## Why static linking came back

For twenty years the trend was towards dynamic linking, for good reasons: one
copy of a library in memory across every process, and a security fix applied
without relinking anything.

The reasons have weakened. A container ships one process and its dependencies, so
the sharing rarely happens. Startup cost matters when a process serves one
request and exits, and a static binary skips thousands of relocations. And
reproducibility is easier when the artefact does not depend on what happened to
be installed.

So the modern position is not that one is right. It is that the trade changed:
dynamic linking is for a system where many programs share libraries and are
updated together, and static linking is for a program shipped as a unit. Most
software deployed today is the second, and the tooling has been catching up with
that for a decade.

## What to carry forward

The loader is a program that runs before yours, and its search order is a list
you can get in front of.

First definition wins, across the whole process, which is what makes interposition
work and what makes symbol collisions silent. Hiding everything a library does
not mean to export removes the collisions, shrinks the table, and speeds up
startup.

And the privilege boundary is where the mechanism stops, because a search order an
attacker controls is a program an attacker controls.

## Reading the errors you are about to see

These model the resolution order rather than loading real libraries, because the
behaviour being modelled is a decision procedure and a test of it should not
depend on what happens to be installed.

`assert-failed` names the lookup your model got wrong. Every case corresponds to
a situation in the prose, including the ones where the correct answer is the one
that produces a bug.
