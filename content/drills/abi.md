## What is the difference between an API and an ABI?

- [x] One is what a programmer writes against; the other is what two compiled things agree on
- [ ] One is for libraries and the other for executables
- [ ] One is standardised and the other is not
- [ ] They are the same thing at different layers

@why Get the first wrong and the compiler tells you. Get the second wrong and
nothing tells you, because both halves compiled and the disagreement appears at
run time as nonsense.

## Which registers must a called function preserve on x86-64?

- [x] `rbx`, `rbp` and `r12` through `r15`
- [ ] The six argument registers
- [ ] All of them except `rax`
- [ ] None; the caller saves everything it needs

@why Six of sixteen was somebody's estimate of where the benefit stops paying for
the cost, and nothing checks it: a routine that uses `rbx` without saving it
corrupts a value its caller was entitled to keep.

## What must be true of the stack when a `call` executes?

- [x] It is sixteen-byte aligned
- [ ] It is eight-byte aligned
- [ ] It has at least 128 bytes free
- [ ] The frame pointer has been pushed

@why It exists because the vector instructions want aligned operands, and it is
enforced by nothing until a callee happens to use an aligned load.

## On entry to a function, how is the stack aligned?

- [x] Eight past a boundary, because `call` pushed the return address
- [ ] On a sixteen-byte boundary
- [ ] Unspecified
- [ ] On a boundary determined by the number of arguments

@why Which is why an odd number of further pushes realigns it and an even number
does not, and why hand-written assembly crashes only once it calls something
else.

## What is the red zone?

- [x] 128 bytes below the stack pointer a leaf function may use without adjusting anything
- [ ] Memory reserved for signal handlers
- [ ] The guard page at the end of the stack
- [ ] Space for spilled vector registers

@why It makes small leaf functions free, and it is why kernel code is compiled
with it disabled: an interrupt in kernel mode would land on exactly that memory.

## How is a structure of two integers passed?

- [x] In one register, as though the members were separate arguments
- [ ] In memory, with the caller supplying storage
- [ ] In two registers, one per member
- [ ] By pointer, always

@why The classification is per eight-byte chunk and each chunk goes where its
contents belong, so a structure of an integer and a double takes one integer
register and one vector register.

## Above what size does a structure travel in memory?

- [x] Sixteen bytes
- [ ] Eight bytes
- [ ] Thirty-two bytes
- [ ] It depends on the number of members

@why Which is a real argument for keeping a hot value type at or under sixteen:
twenty-four is a different mechanism rather than a slightly larger one.

## How is a large return value returned?

- [x] Through a hidden pointer the caller passes as an extra first argument
- [ ] In `rax` and `rdx` together
- [ ] In a static buffer the callee owns
- [ ] On the stack, above the return address

@why Which shifts every declared argument along one register, and is visible the
moment you read the disassembly of anything returning a container.

## Which of these breaks binary compatibility?

- [x] Adding a data member to a struct
- [ ] Adding a non-virtual member function
- [ ] Renaming a parameter
- [ ] Adding a comment

@why Every caller that allocated one is now allocating the wrong amount, and the
header change looks exactly like the safe one.

## Why does changing an inline function break binary compatibility?

- [x] Its body was copied into every caller at their build time
- [ ] Inline functions have no symbol to link against
- [ ] The compiler may or may not inline it
- [ ] It does not; inline functions are exempt

@why A program can end up running two versions of the same function, one in code
recompiled since and one in code that was not.

## How does the pimpl idiom help with binary compatibility?

- [x] The header stops describing a layout, so the size never changes
- [ ] It removes the need for virtual functions
- [ ] It moves the type into the library's namespace
- [ ] It forces callers to recompile

@why It is the same edit as the build-time technique from unit 033, applied for
stability instead, and the common thread is letting callers compile in as little
as possible.

## What do versioned symbols allow?

- [x] Keeping both the old and new behaviour, with old programs resolving to the old one
- [ ] Refusing to load an outdated program
- [ ] Choosing an implementation at run time by configuration
- [ ] Compressing the symbol table

@why It is the mechanism behind a system library staying compatible across a
decade of changes.

## Why is the C ABI the universal interface?

- [x] It is small enough for every language to implement
- [ ] It is the oldest
- [ ] It is standardised by ISO
- [ ] It is the fastest

@why No mangling, no exceptions, no destructors, no templates, and no layout
rules beyond the ones the machine already imposes.

## Was the C++ ABI standardised?

- [x] No; the implementations converged on one document by agreement
- [ ] Yes, in C++11
- [ ] Yes, as part of the ELF specification
- [ ] Only for the Itanium architecture, which is unused

@why That is why two compilers can link the same objects today and why the
arrangement is a treaty rather than a specification.

## When `std::string` had to change layout, what did GCC do?

- [x] Shipped both versions, distinguished in the mangled names, so mixing them gives an undefined symbol
- [ ] Broke compatibility and required a recompile
- [ ] Kept the old layout and added a wrapper
- [ ] Made the change only in a new major version of the compiler

@why The undefined symbol is the feature. Given a choice between a link error and
a program that runs and is wrong, the break was made loud on purpose.
