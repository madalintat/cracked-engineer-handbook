## What decides where a struct member lands?

- [x] Its own alignment: the offset is rounded up to the next multiple of it
- [ ] The compiler's optimiser, which reorders for density
- [ ] The order of first use in the code
- [ ] The size of the largest member

@why And the whole struct is rounded up to a multiple of its own alignment, so an
array of them keeps every element aligned. Those two rules explain every
surprising `sizeof`.

## A struct of char, long, char occupies how many bytes on a 64-bit target?

- [x] 24
- [ ] 10
- [ ] 16
- [ ] 12

@why Measured. Seven bytes of padding before the long, then seven more of tail
padding. The same three members as long, char, char occupy 16.

## Why does the compiler not reorder members for you?

- [x] The standard guarantees declaration order for members with the same access
- [ ] It would break the debugger
- [ ] Reordering is too expensive to compute
- [ ] It does, at higher optimisation levels

@why Too much depends on it: casting the first member's address back to the
struct, sharing a layout with C, writing the bytes to a file. Field order is your
responsibility.

## What does adding one virtual function cost in every object?

- [x] Eight bytes, once, however many virtual functions there are
- [ ] Eight bytes per virtual function
- [ ] Nothing; the table is shared
- [ ] Four bytes, for a table index

@why The table holds all of them and the object holds one pointer to the table,
which is why a class with twenty virtual functions costs the same as one with a
single virtual destructor.

## What is the real cost of a virtual call?

- [x] The target is unknown until a load returns, so the predictor has to guess it
- [ ] The extra instructions in the dispatch
- [ ] The cache line holding the table
- [ ] The pointer adjustment on entry

@why A call site that sees many different types guesses wrong often, and that is
the misprediction penalty from unit 025 rather than the two extra loads.

## Casting a pointer to a second polymorphic base does what?

- [x] Changes the pointer's value, because that base's subobject starts later
- [ ] Nothing; all base pointers share the object's address
- [ ] Produces a null pointer if the cast is invalid
- [ ] Copies the subobject

@why Measured at sixteen bytes for two sixteen-byte bases, which is why two
pointers to one object can compare unequal until they are brought to a common
type.

## Why is an empty class one byte rather than zero?

- [x] Two distinct objects must have distinct addresses
- [ ] To hold a type tag
- [ ] Alignment requires at least one byte
- [ ] It is zero; the byte comes from padding

@why But an empty base contributes nothing, which is the empty base optimisation
and the reason a class with an empty base and an `int` is four bytes where one
with an empty member is eight.

## Why do standard containers inherit from their allocator rather than holding it?

- [x] To get the empty base optimisation, so a stateless allocator costs nothing
- [ ] To allow the allocator to be overridden virtually
- [ ] Because allocators must be base classes by the standard
- [ ] To reduce template instantiation

@why And `[[no_unique_address]]` was added to get the same result for a member,
without the inheritance.

## When does an object's lifetime begin?

- [x] When its storage is obtained and its initialisation completes
- [ ] When the storage is allocated
- [ ] When its address is first taken
- [ ] When its constructor is declared

@why Allocating a buffer and casting it to a type does not create objects there.
Placement new does, and the difference is exactly the sort of thing an optimiser
is entitled to exploit.

## What is the strict aliasing rule?

- [x] The compiler may assume a pointer to one type does not point at an unrelated type
- [ ] Two pointers to the same object must have the same value
- [ ] Casting between pointer types is forbidden
- [ ] Objects of different types cannot share a cache line

@why That assumption is what lets it keep a value in a register across a store
through a different pointer type, which is a real and frequent optimisation.

## How does violating strict aliasing usually fail?

- [x] A load is hoisted out of a loop, because the compiler proved nothing could change it
- [ ] The program crashes on the cast
- [ ] The value read is byte-swapped
- [ ] A warning is emitted and the code is left alone

@why The failure mode is not a wrong value from the cast itself, and it looks
like the compiler being wrong.

## What is the sanctioned way to reinterpret bytes?

- [x] `memcpy`, which compiles to nothing when the sizes match
- [ ] A union with both types as members
- [ ] `reinterpret_cast` on the address
- [ ] A `volatile` pointer

@why You pay nothing for following the rule, which is what makes ignoring it a
poor trade.

## What does trivially copyable mean?

- [x] Copying the bytes produces a valid copy, and the destructor does nothing
- [ ] The type has no members needing construction
- [ ] The type can be passed in registers
- [ ] The layout matches what C would produce

@why Anything holding a pointer it owns is not, because copying the bytes would
give two owners. A type that acquires a `std::string` member stops qualifying.

## What does standard layout mean?

- [x] The arrangement is predictable and matches what C would produce
- [ ] The members are in declaration order
- [ ] The type has no padding
- [ ] The type is trivially copyable

@why No virtual functions, no mixed access control across members, and at most
one class in the hierarchy with data. It is what lets a struct cross a language
boundary.

## Why do layout questions matter more than they used to?

- [x] The unit of memory transfer is 64 bytes, so an oversized struct is wasted traffic on every pass
- [ ] Compilers have stopped optimising layout
- [ ] Modern CPUs fault on misaligned access
- [ ] Larger structs no longer fit in registers

@why A struct a third larger than it needs to be is a third more memory traffic
over an array of them, which is unit 024's arithmetic applied to a source edit.
