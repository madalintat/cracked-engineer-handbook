## What is the actual difficulty with releasing resources?

- [x] Releasing on every path out of a function, including the ones you did not write
- [ ] Remembering to release them at all
- [ ] Knowing which resources are scarce
- [ ] Releasing them in the right order

@why A function with two resources and six exits needs the right subset released
at each, and the number of subsets grows with the number of resources.

## Where does the compiler emit a destructor call?

- [x] At every point control leaves the scope, including exception unwinding
- [ ] At the closing brace only
- [ ] Where the programmer writes one
- [ ] At the end of the enclosing function

@why The exception path is the one a defer statement in a language without
exceptions does not have to handle, and the one a manual release always gets
wrong somewhere.

## In what order are objects in a scope destroyed?

- [x] Reverse of construction, guaranteed
- [ ] Declaration order
- [ ] Unspecified
- [ ] By decreasing size, for cache reasons

@why A later object may depend on an earlier one, so the earlier one must
outlive it. That one rule decides the correctness of a lot of code that never
mentions it.

## What is the strong exception guarantee?

- [x] The operation either completes or leaves everything exactly as it was
- [ ] The operation cannot throw
- [ ] Nothing leaks and objects remain usable
- [ ] Exceptions are caught and converted to error codes

@why It usually costs a copy: build the new state beside the old one and swap
only when nothing can throw any more.

## Why must a destructor not throw?

- [x] It runs during unwinding, where a second exception in flight ends the program
- [ ] Throwing from a destructor leaks the object
- [ ] The standard forbids allocation in destructors
- [ ] It would confuse the optimiser

@why Which is why destructors are implicitly `noexcept`, and why a cleanup that
can genuinely fail belongs in a named method with the destructor as a quiet
fallback.

## What does a move leave in the source?

- [x] A valid, unspecified state whose destructor runs harmlessly
- [ ] An empty object, guaranteed
- [ ] The original value, unchanged
- [ ] An object that must not be touched again

@why A moved-from object may be destroyed and may be assigned to. Reading its
value is allowed and tells you nothing, and the library's types mostly leaving
themselves empty is an implementation detail.

## What does `std::move` do?

- [x] Nothing but cast to an rvalue reference
- [ ] Transfers the object's contents
- [ ] Calls the move constructor
- [ ] Marks the object for destruction

@why Measured: applying it and binding the result to a reference performs zero
moves and zero copies. What performs the move is the constructor the cast made
eligible.

## What happens to `std::move` on a `const` object?

- [x] The copy constructor is chosen, silently, with no diagnostic
- [ ] The compiler rejects it
- [ ] The move happens anyway, since the object is dying
- [ ] The `const` is stripped

@why The cast produces a `const` rvalue reference and no move constructor
accepts one, so you get a copy where you asked for a move.

## How many moves does returning a local object cost?

- [x] None, measured, for both a temporary and a named local
- [ ] One
- [ ] One, unless the type is trivially copyable
- [ ] Two: into the return slot and out of it

@why Since C++17 a returned temporary is constructed directly in the caller's
storage, so there is no second object for a move to happen between.

## Why should you not write `return std::move(local)`?

- [x] It cannot help, and it prevents the elision that would otherwise happen
- [ ] It is a compile error in C++17
- [ ] It moves twice
- [ ] It only matters for non-trivial types

@why There was nothing to elide the move of, and naming a cast where a plain name
was expected adds exactly the move it was trying to avoid.

## Why does the naive move assignment break on self-assignment?

- [x] Clearing the source clears the pointer you just took, because they are the same object
- [ ] The delete runs twice
- [ ] The move constructor is called instead
- [ ] It does not; self-move is undefined and never happens

@why The object ends up owning nothing at all, which is visible rather than
merely reading freed memory, and that is why this is the version worth writing an
exercise about.

## What does copy and swap get right for free?

- [x] Self-assignment and the strong exception guarantee, from the ordering alone
- [ ] Move semantics
- [ ] Thread safety
- [ ] Reduced allocation

@why It builds the new value first, so if the allocation throws nothing has been
modified, and the source is never destroyed before it is read.

## What is the rule of five?

- [x] Writing any of the five special members usually means you need all of them
- [ ] Every class needs five members to be complete
- [ ] There are five levels of exception safety
- [ ] Five is the maximum useful inheritance depth

@why If a class owns a raw resource it needs a destructor, and then the generated
copy operations duplicate the pointer and the second destruction is a double
free.

## What is the rule of zero, and what does it cost?

- [x] Own nothing raw and write none of the five; a `unique_ptr` is the same 8 bytes as the pointer
- [ ] Write all five explicitly; it costs nothing
- [ ] Use only value types; it costs a copy per assignment
- [ ] Delete all five; it costs the ability to copy

@why Measured: 8 bytes for exclusive ownership, 16 for shared, and shared copies
cost an atomic increment which unit 026 already priced.

## When is `shared_ptr` the right answer?

- [x] When two independent parts genuinely both need the thing alive and neither decides
- [ ] Whenever more than one function touches the object
- [ ] Whenever the lifetime is not obvious
- [ ] By default, since it is safer

@why With everything shared, nothing has an owner and no lifetime is stated
anywhere. The question is who decides when this dies, and an unclear answer is a
design problem no smart pointer fixes.
