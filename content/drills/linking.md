## What starts first when you run a dynamically linked program?

- [x] The interpreter named inside the executable, which loads the libraries
- [ ] Your entry point
- [ ] The C library's initialiser
- [ ] The kernel's ELF loader, which resolves symbols itself

@why It is a shared library with an entry point, running in your address space
with your privileges, before anything you wrote. Most of this unit follows from
that being true.

## In what order does the loader search for a named library?

- [x] Compiled-in path, then the environment variable, then a system cache, then the defaults
- [ ] The current directory, then the system directories
- [ ] Alphabetically within each directory
- [ ] The order the libraries were linked

@why Every step is a place something can be inserted, which is why the order is
worth knowing rather than merely working.

## Which definition does a symbol resolve to?

- [x] The first one in the ordered list of scopes
- [ ] The nearest one to the reference
- [ ] The one in the same library, if there is one
- [ ] The most recently loaded one

@why Not the nearest. A library calling its own `malloc` gets whichever `malloc`
is first in the global list, which may belong to something else entirely.

## Where do preloaded libraries sit in the resolution order?

- [x] Ahead of the executable itself
- [ ] After the executable and before its libraries
- [ ] At the end, as a fallback
- [ ] In a separate scope consulted on failure

@why Which is what lets them intercept calls the executable makes to its own
dependencies. Placing them after would let them intercept nothing the executable
defines.

## An interposing wrapper needs to call the original. How does it find it?

- [x] A lookup that continues the search from after the current library
- [ ] By opening the real library explicitly and looking inside
- [ ] By taking the address before it installs itself
- [ ] It cannot; interposition can only replace

@why Almost every use of interposition wants to observe rather than replace, so
this is what makes the technique useful rather than merely destructive.

## What happens if a wrapper searches from the front instead?

- [x] It finds itself, calls itself, and the stack runs out
- [ ] It finds the original, since the wrapper is not in the list
- [ ] The loader detects the recursion and returns an error
- [ ] It finds whichever definition the caller belongs to

@why The backtrace is one function repeated four thousand times, and it is the
classic interposition bug.

## Why does a privileged program ignore the preload variable?

- [x] An attacker who can set an environment variable would otherwise choose what every call resolves to
- [ ] Privileged programs are statically linked
- [ ] The variable is cleared by the shell
- [ ] It does not; the restriction is on the library search path only

@why The boundary is drawn at the point the program stops belonging to whoever
started it, which is elevation rather than the resulting privilege level.

## What does a shared library export by default?

- [x] Every symbol with external linkage, which is usually far more than its interface
- [ ] Only symbols declared in its public headers
- [ ] Only symbols marked visible
- [ ] Everything, including internal static functions

@why A larger table means slower lookups and more startup cost, internal names
become things callers can depend on, and any of them can collide.

## Two loaded libraries define the same symbol. What does the loader report?

- [x] Nothing; one is chosen by the ordinary resolution rule
- [ ] An error at load time
- [ ] A warning naming both libraries
- [ ] It refuses to load the second

@why A duplicate at static link time is an error and a duplicate across shared
libraries is a decision, which is why the symptom is behaviour changing when an
unrelated dependency is added.

## What removes the symbol collision category entirely?

- [x] Hiding symbols by default and marking the interface explicitly
- [ ] Prefixing every internal name
- [ ] Loading libraries in a fixed order
- [ ] Static linking everything

@why A prefix reduces the chance and does not remove it. Hiding means the names
are not in the table to collide.

## Can a plugin loaded at run time shadow the host program's functions?

- [x] Yes, unless it is loaded with its symbols kept local
- [ ] No; plugins have their own scope
- [ ] Only if it defines the symbol before the host resolves it
- [ ] Only for functions the host declared weak

@why Local is the sensible default for anything untrusted and it is not the
loader's default.

## What is the larger cost of calling into a shared library?

- [x] The compiler cannot see through it, so nothing can be inlined or assumed
- [ ] The indirect call through the table
- [ ] The relocation applied at load time
- [ ] The extra cache line for the table entry

@why A small accessor that would have vanished entirely becomes a real call with
real argument setup, and that is a bigger number than the call overhead.

## When can a function in a static archive be inlined into your code?

- [x] With link-time optimisation, because the compiler still has the bodies
- [ ] Always
- [ ] Never; archives are linked as objects
- [ ] Only if the archive was built with the same compiler version

@why A shared library's bodies are not present at any point the compiler runs,
whatever the flags.

## Why has static linking become more attractive again?

- [x] Containers ship one process, startup cost matters, and reproducibility is easier
- [ ] Dynamic linking was found to be insecure
- [ ] Disks are larger
- [ ] Compilers got better at whole-program optimisation

@why The sharing rarely happens when a container holds one process, and a static
binary skips thousands of relocations at startup.

## What is the modern position on static against dynamic?

- [x] The trade changed: dynamic for a system with shared, jointly updated libraries; static for a program shipped as a unit
- [ ] Static is now correct in all cases
- [ ] Dynamic is now correct in all cases
- [ ] The choice makes no measurable difference

@why Most software deployed today is shipped as a unit, and the tooling has been
catching up with that for a decade.
