## What are the three things in an object file?

- [x] Sections, symbols and relocations
- [ ] Headers, code and data
- [ ] Instructions, constants and debug info
- [ ] Segments, permissions and an entry point

@why A section is bytes with permissions, a symbol is a name that is either
supplied or wanted, and a relocation is a hole with instructions for filling it.
Understanding those three explains most linker errors.

## Why does `.bss` take no space in the file?

- [x] It is all zeroes, so only its length needs recording
- [ ] It is compressed
- [ ] It is stored in the symbol table instead
- [ ] It is allocated lazily by the compiler

@why A program with a ten megabyte zeroed array is not a ten megabyte file. The
loader maps pages that are already zero, which is why touching them costs a page
fault rather than a read.

## What is a relocation?

- [x] A note saying: at this offset, write the address of this symbol once you know it
- [ ] An instruction to move a section to a different address
- [ ] A record of which pages must be moved at load time
- [ ] A remapping applied when address randomisation is enabled

@why The compiler emits a placeholder because it does not know the address. An
object file is full of holes and a list of how to fill them.

## What is the difference between a section and a segment?

- [x] Sections are what the linker merges; segments are what the loader maps with permissions
- [ ] Sections are in object files and segments are in shared libraries
- [ ] A segment is a section that has been relocated
- [ ] They are the same thing under two names

@why The same bytes, grouped twice for two different jobs. It is also why
section headers can be stripped and the binary still runs: the loader never
reads them.

## Why does C++ mangle symbol names?

- [x] It has overloading and namespaces, and the linker only knows flat strings
- [ ] To prevent linking against incompatible compilers
- [ ] To compress the symbol table
- [ ] To hide implementation details from other translation units

@why It is why a C++ link error names something unreadable, and why `extern "C"`
exists to say do not do that.

## Why is changing a function's parameter types a binary-incompatible change in C++?

- [x] The types are encoded in the symbol name, so the old name disappears
- [ ] The calling convention changes with the argument count
- [ ] The virtual table layout shifts
- [ ] It is not; only changing the return type is

@why Every caller still compiles and nothing resolves at link time, which is why
this surprises people.

## What does static linking give up compared to dynamic?

- [x] Sharing one copy of a library across processes, and picking up fixes without relinking
- [ ] The ability to use position-independent code
- [ ] Access to the C library
- [ ] Symbol visibility control

@why What it buys is an image with no unresolved references, which is large,
self-contained and starts instantly.

## What is the global offset table for?

- [x] Holding addresses the loader fills in, so the code itself never has to be modified
- [ ] Storing global variables shared between libraries
- [ ] Recording which symbols each library exports
- [ ] Caching resolved symbol names

@why Code loads an address from a slot rather than embedding it, which is what
lets the code stay shared and read-only across every process using it.

## What was lazy binding, and why is it mostly gone?

- [x] Resolving each function on its first call; a writable table of function pointers is a target
- [ ] Deferring library loading until first use; it broke address randomisation
- [ ] Resolving symbols in a background thread; it was racy
- [ ] Skipping unused relocations; it produced wrong addresses

@why Modern builds resolve everything at load time and mark the table read-only
afterwards, which costs a little startup and removes the target.

## What is a weak symbol?

- [x] A definition that yields to a strong one and is used when none exists
- [ ] A symbol that may be resolved at run time or not at all
- [ ] A symbol visible only within its own shared library
- [ ] A symbol whose address may change during execution

@why It is how a library ships a default an application can replace by simply
defining the name, with no configuration and no registration.

## Why does link order matter for static libraries?

- [x] The linker pulls in only members resolving symbols outstanding at that moment, and does not revisit
- [ ] Later libraries override earlier definitions
- [ ] Section merging depends on the order of inputs
- [ ] Only for libraries built with different compilers

@why Put a library before the code that uses it and nothing needs its members
yet, so nothing is pulled in. That is why the convention is objects first and
libraries last.

## How does `LD_PRELOAD` work?

- [x] The named library is searched first, so its definitions displace the expected ones
- [ ] It replaces the dynamic loader
- [ ] It rewrites the global offset table after loading
- [ ] It patches the symbol table of the executable

@why It is how memory checkers intercept `malloc` and how tracers wrap network
calls without recompiling. It is also why a program running as another user
ignores the variable.

## What happens between the kernel mapping a dynamic binary and your first instruction?

- [x] An interpreter loads the libraries, applies relocations and runs initialisers
- [ ] Nothing; the kernel jumps straight to the entry point
- [ ] The kernel resolves the symbols itself
- [ ] The binary decompresses itself

@why Several thousand relocations may be applied and a dozen constructors may
run. A static binary skips all of it, which is why it starts in a fraction of the
time.

## An assembly label creates a symbol. Is it visible to other files?

- [x] No, not unless declared global
- [ ] Yes, unless declared local
- [ ] Only if it is in `.text`
- [ ] Only in a static link

@why The default runs the opposite way from C, where a function is visible
unless you say otherwise. Both defaults have caused confusion for decades.

## What does `main` mean to the kernel?

- [x] Nothing; it is called by C library code that itself begins at `_start`
- [ ] It is the entry point the kernel jumps to
- [ ] It is the symbol the loader looks for after relocation
- [ ] It is a reserved name in the ELF specification

@why The library sets up the stack and environment, runs constructors, calls
`main`, and passes its return value to `exit`. Remove the library and all of that
is yours to write.
