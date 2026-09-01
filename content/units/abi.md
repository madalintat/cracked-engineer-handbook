---
needs: [addressing, object-model]
minutes: 55
one_idea: The ABI is the agreement two compiled things keep without either seeing the other's source, and it constrains far more of a library's design than its API does.
sources: [x86-64-assembly, cpu-architectures]
---

An API is what a programmer writes against. An ABI is what two already-compiled
things agree on: which register holds an argument, how a struct is returned, what
a symbol is called, what the bytes of an object look like.

Get the first wrong and the compiler tells you. Get the second wrong and nothing
tells you, because both halves compiled and the disagreement is only visible at
run time as nonsense.

## The registers, and the half nobody quotes

On this platform the first six integer arguments go in `rdi`, `rsi`, `rdx`,
`rcx`, `r8`, `r9`, floating point arguments go in the vector registers, and
anything past that goes on the stack. The return value comes back in `rax`.

Unit 022 already noted the one difference in the syscall convention. What is
worth adding here is the other half of the contract: which registers a called
function may destroy.

`rbx`, `rbp` and `r12` through `r15` must be preserved. Everything else may be
overwritten. That split is a negotiation rather than a fact about the hardware:
too many preserved registers and every function pays to save them, too few and
every caller pays to reload. Six of sixteen was somebody's estimate, and it has
outlived the machine the estimate was made for.

Nothing checks it. A routine that uses `rbx` without saving it corrupts a value
its caller was entitled to keep, and the damage appears somewhere else entirely.

## The alignment nobody mentions until it breaks

The stack must be sixteen-byte aligned at the point a `call` executes.

This exists because the vector instructions want aligned operands, and it is
enforced by nothing: get it wrong and most functions work, and then one of them
uses an aligned load and the program dies inside a library you did not write.

The arithmetic catches people. `call` pushes eight bytes, so on entry to a
function the stack is eight past a boundary. A function that pushes one more
register is aligned again; a function that pushes two is not. Every hand-written
assembly routine that crashes only when it calls something else has this bug, and
its own code never needed the alignment at all.

## The hundred and twenty eight bytes below the stack

There is a region just below the stack pointer that a leaf function may use
without adjusting anything. It is the red zone, it is 128 bytes, and signal
handlers are required not to touch it.

The point is to make small leaf functions free: no prologue, no epilogue, just
use the space. It is also why kernel code is compiled with it disabled, since an
interrupt arriving in kernel mode would land on exactly that memory.

```figure
{
  "kind": "bits",
  "alt": "A stack layout showing the return address pushed by call, the saved frame pointer, local variables, and the red zone below the stack pointer.",
  "caption": "What a call leaves behind and what sits below it. The red zone is usable without adjusting the stack pointer, which is what makes a small leaf function free.",
  "bits": 32,
  "groups": [
    { "from": 0,  "to": 7,  "label": "red zone", "accent": "slate" },
    { "from": 8,  "to": 15, "label": "locals", "accent": "azure" },
    { "from": 16, "to": 23, "label": "saved rbp", "accent": "copper" },
    { "from": 24, "to": 31, "label": "return address", "accent": "gold" }
  ]
}
```

## How a struct travels

This is where the ABI stops being a table and becomes an algorithm.

A small structure is passed in registers, field by field, as though its members
had been separate arguments. A structure of two integers goes in one register. A
structure of an integer and a double goes in one integer register and one vector
register, because the classification is per eight-byte chunk and each chunk goes
where its contents belong.

Above sixteen bytes, or containing anything the caller must be able to destroy,
the structure is passed in memory and the caller supplies the storage. Which is a
real argument for keeping a hot value type at or under sixteen bytes: twenty-four
is a different mechanism, not a slightly larger one.

Returning follows the same rule with one addition. A large return value is
written through a hidden pointer the caller passes as an extra first argument, so
a function that appears to take three arguments and return a big structure
actually takes four and returns nothing. That hidden parameter shifts every
declared argument along one register, and it is visible the moment you read the
disassembly of anything returning a container.

## What breaks without telling you

A library keeps binary compatibility when a program compiled against the old
version still runs against the new. The list of changes that break it is longer
than people expect and almost none of them look like breaking changes.

Adding a member to a struct changes its size, so every caller that allocated one
is now allocating the wrong amount. Adding a virtual function changes the table's
layout, so every existing call through it dispatches to the wrong entry.
Reordering members changes offsets. Changing an enum's underlying type changes
its size.

Changing an inline function is the one people miss. Its body was copied into
every caller at their build time, so the new version applies only to code
recompiled since, and a program can end up running two versions of the same
function.

None of those is a source change anybody would call breaking, which is why the
rules for evolving a library are stricter than the rules for writing one, and why
a library that adds a private member in a patch release has shipped a fault that
appears as memory corruption in somebody else's process.

## Designing so that it does not

Two techniques, and both are the same idea.

Put the members behind a pointer to an incomplete type, so the header stops
describing a layout at all and the size never changes. That is the pimpl idiom
from unit 033, applied for stability rather than for build time, and it is the
same edit.

Version the symbols. A library that must change a function's behaviour can keep
both, with the version encoded in the name, so old programs resolve to the old
one and new programs to the new. That is what a symbol version map does, and it
is the mechanism behind a system library staying compatible across a decade of
changes.

The common thread is that anything a caller compiled into itself is frozen, so
the design question is how little to let them compile in.

## The one everybody speaks

The C ABI is the interface every language implements, and the reason is that it
is small enough to.

No name mangling, no exceptions crossing the boundary, no destructors, no
templates, no layout rules beyond the ones the machine already imposes. A
function taking pointers and integers can be called from anything, which is why
`extern "C"` exists, why every foreign function interface targets it, and why
libraries meant to be used from more than one language expose a C surface however
they are implemented.

The C++ ABI, by contrast, is enormous, and it was never standardised: the
implementations converged on one document by agreement. That is why two compilers
can link the same objects today and why the arrangement is a treaty rather than a
specification.

## When the treaty changed

C++11 tightened the requirements on `std::string` in a way the existing
implementation could not satisfy, and the standard library had to change its
layout.

That is a binary-incompatible change to a type appearing in interfaces
everywhere. GCC's answer was to ship both: two versions of the type,
distinguished in the mangled names, selected by a macro, coexisting in one
library. Code compiled against either continues to link, and a program mixing the
two gets an undefined symbol rather than silent corruption.

The undefined symbol is the point. Given a choice between an error at link time
and a program that runs and is wrong, the break was made loud on purpose, and the
resulting error message has confused a decade of people who were being protected
by it.

## What to carry forward

The ABI is the part of an interface a compiler cannot check. Arguments in
registers, sixteen-byte alignment at every call, six registers the callee must
preserve, and a classification algorithm deciding whether a struct travels in
registers or in memory.

Adding a member, adding a virtual function, or changing an inline function all
break binary compatibility while looking like additions, which is why a library
that means to be stable puts its members behind a pointer and its functions
behind a version.

And the C ABI is the universal interface because it is the smallest one worth
agreeing on.

## Reading the errors you are about to see

These are raw x86-64 again, so the convention is not abstract: a function returns
in `rax` because the agreement says so, and a routine that clobbers a preserved
register breaks its caller in a way nothing reports.

`nonzero-exit` means a check disagreed. `signal` usually means the stack
alignment was wrong at a call, which is the failure that appears only when the
callee happens to use an aligned instruction.
