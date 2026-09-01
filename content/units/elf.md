---
needs: [syscalls]
minutes: 55
one_idea: An object file is sections, symbols and relocations, and linking is filling in addresses that nobody knew when the code was compiled.
sources: [x86-64-assembly, compilers-interpreters-terminals-unix]
---

Something has to happen between the compiler emitting instructions and the kernel
running them. That something is two programs, a linker and a loader, and the
errors they produce are the ones people find most opaque because the objects they
operate on are never seen.

## What is in an object file

Three things, and understanding the three explains most of the errors.

Sections are named blocks of bytes. `.text` holds instructions, `.rodata` holds
constants, `.data` holds initialised variables, `.bss` holds variables that start
at zero and therefore occupy no space in the file at all, only a length. A
section carries permissions: `.text` is executable and not writable, `.rodata` is
neither, `.data` is writable.

Symbols are names with addresses. Each one is either defined here, meaning this
file supplies it, or undefined, meaning this file uses it and somebody else must
supply it. A symbol also has visibility: global means other files may see it, and
local means the name exists only for this file's own use.

Relocations are the interesting part. When the compiler emits a call to a
function in another file, it does not know the address, so it emits a
placeholder and records an entry saying: at this offset, once you know where that
symbol landed, write it here. An object file is full of holes and a list of how
to fill them.

```figure
{
  "kind": "blocks",
  "alt": "An object file containing sections, a symbol table and a relocation list, feeding into a linker that produces an executable with segments.",
  "caption": "The linker's view is sections and symbols. The loader's view is segments and permissions. The same bytes, grouped twice for two different jobs.",
  "boxes": [
    { "id": "o", "x": 0,   "y": 1.2, "w": 4,   "h": 1.6, "label": "object file", "sub": "sections, symbols, holes", "accent": "azure" },
    { "id": "l", "x": 5.2, "y": 1.2, "w": 3.4, "h": 1.6, "label": "linker", "sub": "fills the holes", "accent": "copper" },
    { "id": "e", "x": 9.8, "y": 1.2, "w": 4,   "h": 1.6, "label": "executable", "sub": "segments and permissions", "accent": "jade" }
  ],
  "arrows": [
    { "from": "o", "to": "l" },
    { "from": "l", "to": "e" }
  ]
}
```

## Sections against segments

The same file is grouped twice, for two readers.

The linker cares about sections, because it merges them: every input file's
`.text` becomes part of one output `.text`. The loader does not care about names
at all. It cares about segments, which are contiguous runs of the file to be
mapped into memory with a particular set of permissions.

So several sections with the same permissions end up in one segment. `.text` and
`.rodata` are often mapped together as read and execute, or as two segments if
the linker was told to keep writable and executable strictly apart.

That is why the section headers can be stripped from a binary and it still runs.
The loader never reads them.

## The name is not the name

A symbol name in the object file is not always the name in the source.

C leaves names mostly alone. C++ does not, because it has overloading and
namespaces and a linker that only knows about flat strings, so the argument types
are encoded into the name. That is mangling, and it is why a C++ link error names
something unreadable and why `extern "C"` exists: it says do not do that, because
something outside is going to look for the plain name.

It is also why linking a C++ library into C requires care, and why changing a
function's parameter types is a binary-incompatible change even when every caller
still compiles.

## Static and dynamic

Two things can happen with an undefined symbol.

Static linking resolves it now. The linker finds the definition in another object
file or in an archive, copies the code in, fills the hole with a real address,
and produces an image with no unresolved references. The result is large,
self-contained, and starts instantly.

Dynamic linking defers it. The executable records that it needs a symbol from a
named library, and the resolution happens at load time. The result is smaller,
shares one copy of libc across every process on the machine, and can pick up a
security fix without relinking anything.

The cost of the second is that the addresses are unknown when the code is
compiled, which is the problem the next section is about.

## The two tables

A call to a dynamic function cannot be a direct call, because the address is not
known. Two tables solve it.

The global offset table is an array of addresses, filled in by the loader. Code
that needs a dynamic symbol loads its address from a slot in this table rather
than embedding it, which means the code itself never has to be modified and can
stay shared and read-only across every process using it.

The procedure linkage table is a small stub per function. Calling a dynamic
function calls its stub, and the stub jumps through the corresponding table slot.

Historically the slots started out pointing back into the loader, so the first
call to each function resolved it and patched the slot, and subsequent calls went
straight through. That is lazy binding, and it made startup cheaper for programs
that used a fraction of what they linked.

It is mostly gone now. A table that gets written during execution has to stay
writable, and a writable table full of function pointers is a target. Modern
builds resolve everything at load time and mark the table read-only afterwards,
which costs a little startup time and removes the target.

## Weak, and the archive rule

Two smaller rules that between them explain most confusing link outcomes.

A symbol can be weak, which means it is a definition that yields. If a strong
definition of the same name exists anywhere, the strong one wins and no error is
reported. If none does, the weak one is used. This is how a library ships a
default that an application can replace by simply defining the name, with no
configuration and no registration.

It is also how a program tests whether an optional dependency is present: declare
a weak undefined symbol, and if nothing supplies it the address is zero, which
you can check at run time.

The archive rule is stranger. A static library is not a unit; it is a bag of
object files with an index. When the linker reaches one, it pulls in only the
members that resolve symbols still outstanding at that moment, and it does not
revisit it afterwards.

So link order matters. Put a library before the code that uses it and its members
are considered when nothing needs them yet, so nothing is pulled in, and the
resulting error names symbols that were sitting in a file the linker had already
read and discarded. That is why the convention is objects first and libraries
last, and why circular dependencies between static libraries are sometimes
resolved by naming one of them twice.

## The rule that makes preloading work

When several libraries define the same symbol, the first one found wins, and the
search order can be influenced from outside the program.

That is the whole mechanism behind `LD_PRELOAD`: name a library, it is searched
first, and its definitions displace the ones the program expected. It is how
memory checkers intercept `malloc`, how tracers wrap network calls, and how a
great deal of debugging gets done without recompiling anything.

It is also why a program that runs as another user ignores the variable
entirely, and why the same flexibility appears on every list of ways to
compromise a process.

## What the loader does

Then the last step, which is smaller than people expect.

The kernel maps the segments at the addresses the file asks for, or at a random
offset if the binary was built to allow it. If the binary is dynamic, control
goes first to the interpreter named inside the file, which is itself a shared
library, and which loads the other libraries, applies relocations, and runs each
one's initialisers. Then it jumps to the entry point.

By the time your first instruction runs, several thousand relocations may have
been applied and a dozen constructors may have run. A statically linked binary
skips all of it, which is why it starts in a fraction of the time and why that
matters for anything spawning processes in a loop.

## What to carry forward

An object file is sections, symbols and relocations. A section is bytes with
permissions, a symbol is a name that is either supplied or wanted, and a
relocation is a hole with instructions for filling it.

Undefined symbol means nobody supplied it. Duplicate symbol means two files did.
Both errors name the symbol, and once you know what a symbol is, both say exactly
what happened.

Unit 024 goes back under the software entirely, to what happens when the address
the loader chose turns out to be far away from the last one you touched.

## Reading the errors you are about to see

`link-error` is the new one here and it is the whole subject. It means the
assembler was happy, every instruction was legal, and something the program
refers to has no address. The message names the symbol.

`signal` in this unit usually means a write to a section that is not writable,
which is a permission the linker recorded and the loader enforced.
