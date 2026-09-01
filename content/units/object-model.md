---
needs: [cache, text]
minutes: 55
one_idea: An object is bytes at an address with a layout the compiler chose, and the field order you wrote is the field order you get.
sources: [numbers-text-numerics, cpu-architectures]
---

C++ has a reputation for hiding what it does. It mostly does not. The layout
rules are simple, they are decidable by hand, and knowing them turns several
recurring puzzles into arithmetic.

This unit is that arithmetic, and it matters more than it used to: unit 024 said
the unit of transfer is 64 bytes, so a struct that is a third larger than it
needs to be is a third more memory traffic on every pass over an array of them.

## Alignment decides padding

Every type has an alignment, which is an address boundary its objects must start
on. A four-byte integer is aligned to four, an eight-byte one to eight. A struct's
alignment is the largest alignment among its members.

Two rules follow and between them they explain every surprising `sizeof`.

Each member starts at the next offset that satisfies its own alignment, so the
compiler inserts padding before a member that would otherwise be misaligned. And
the whole struct is rounded up to a multiple of its own alignment, so that an
array of them keeps every element aligned.

Measured, on a 64-bit target:

A struct of `char`, `long`, `char` in that order is 24 bytes. The `char` sits at
0, seven bytes of padding follow so the `long` can start at 8, the second `char`
is at 16, and seven more bytes bring the total to a multiple of eight.

The same three members declared as `long`, `char`, `char` are 16 bytes. The
`long` is at 0, the two `char` values are at 8 and 9, and six bytes of tail
padding finish it.

Same data, same alignment requirements, one third less memory, from the order you
typed the declarations in.

```figure
{
  "kind": "bits",
  "alt": "Two struct layouts of the same three members: the first spreading over 24 bytes with two padding runs, the second packed into 16.",
  "caption": "Measured. Declaration order is layout order, so putting the wide member first removes an entire run of padding.",
  "bits": 24,
  "groups": [
    { "from": 0,  "to": 0,  "label": "char", "accent": "gold" },
    { "from": 1,  "to": 7,  "label": "padding", "accent": "bad" },
    { "from": 8,  "to": 15, "label": "long", "accent": "azure" },
    { "from": 16, "to": 16, "label": "char", "accent": "gold" },
    { "from": 17, "to": 23, "label": "padding", "accent": "bad" }
  ]
}
```

## Why the compiler does not reorder for you

It is not allowed to. The standard guarantees that members with the same access
control appear in memory in declaration order, and a great deal depends on that:
casting the address of the first member back to the struct, sharing a layout with
C, writing the bytes to a file.

Which means field order is your responsibility. The rule that gets you most of
the way is to declare members in decreasing size, and the rule that gets you the
rest is to read what the compiler produced rather than trusting the first rule.

## The pointer you did not declare

A class with a virtual function gains a hidden pointer.

Measured: a struct holding one `int` and a non-virtual member function is 4
bytes. The same struct with a virtual destructor is 16, which is 8 bytes of
hidden pointer, the `int`, and 4 bytes of tail padding to reach a multiple of the
pointer's alignment.

That pointer is the vptr, and it points at a table of function pointers shared by
every object of the class. Calling a virtual function loads the vptr, indexes the
table, and calls through the result. Two dependent loads and an indirect call
rather than a direct one.

The cost is not the instructions. It is that the target is not known until the
first load returns, so the branch predictor has to guess it, and a call site that
sees many different types guesses wrong often.

## Two bases, two pointers, one object

Inherit from two classes that both have virtual functions and the object gets two
vptrs.

Measured: two base classes of 16 bytes each, and a derived class inheriting both
is 32. Which raises a question the language has to answer. If code holds a
pointer to the second base, that pointer must address something that looks like
the second base, and the second base's subobject does not start at the beginning
of the derived object.

So the pointer changes value when you cast. Measured on the same objects, a
pointer to the derived class and a pointer to its first base are the same
address, and a pointer to its second base is 16 bytes further along.

Two consequences worth carrying. Comparing pointers of different static types can
be false for the same object unless you cast them to a common type first. And
calling a virtual function through the second base has to subtract that offset
before running the derived implementation, which the compiler does with a small
stub, invisible in the source and visible in a disassembly.

## Empty is not free unless you ask

An empty class has size 1, because two distinct objects must have distinct
addresses and a size of zero would break that.

But an empty base class contributes nothing. Measured: a class with an empty
member and an `int` is 8 bytes, and a class with an empty base and an `int` is 4.
The empty base optimisation exists because policy-based design would otherwise
pay a byte and its padding for every stateless policy.

That is why standard library types take their allocator and their comparator as
base classes rather than as members, and it is why `[[no_unique_address]]` was
added, to get the same result for a member.

## The three words the standard uses

Three categories keep appearing in error messages and in library requirements,
and they are nested.

Trivially copyable means the bytes are the object: copying them with `memcpy`
produces a valid copy, and the destructor does nothing. Anything holding a
pointer it owns is not, because copying the bytes would give two owners.

Standard layout means the memory arrangement is predictable and matches what C
would produce. No virtual functions, no mixed access control across the members,
and at most one class in the hierarchy with data. This is what lets a struct
cross a language boundary.

A type that is both is what the older standards called plain old data, and it is
the class of thing you may write to a file, send over a socket, or hand to a
driver.

The reason to know the three names is that library constraints are stated in
them. A container that promises to relocate objects by copying bytes requires
trivial copyability, and a type that quietly acquires a `std::string` member
stops qualifying, which shows up as a performance change rather than an error.

## When does an object exist

A question that sounds philosophical and has a practical answer.

An object's lifetime begins when its storage is obtained and its initialisation
completes, and ends when its destructor runs. Before and after, the storage is
just bytes, and reading through a pointer of the object's type is undefined.

This matters for anything that manages memory by hand. Allocating a buffer and
casting it to a type does not create objects there. Placement new does. The
difference is invisible in practice on most compilers and is exactly the sort of
thing an optimiser is entitled to exploit.

## The rule that punishes clever casts

Strict aliasing is the related rule and it produces the more common bug.

The compiler is allowed to assume that a pointer to one type does not point at an
object of an unrelated type. That assumption is what lets it keep a value in a
register across a store through a different pointer type, which is a real and
frequent optimisation.

So reading a `float` through an `int*` is undefined, and the failure mode is not
a wrong value; it is a load being hoisted out of a loop because the compiler
proved, using the rule, that nothing could have changed it.

`memcpy` is the sanctioned way to reinterpret bytes, and it compiles to nothing
at all when the sizes match. Every exercise in unit 028 that looked at the bits
of a float used it, and that was the reason.

## What to carry forward

Alignment plus declaration order gives layout, and the compiler will not reorder
for you because too much depends on it not doing so.

A virtual function costs eight bytes per object and an indirect call whose target
the predictor has to guess. Multiple inheritance costs a second one and makes a
cast change a pointer's value.

And the rules about lifetime and aliasing are not pedantry: they are the
assumptions the optimiser is working from, and code that violates them fails in
ways that look like the compiler being wrong.

## Reading the errors you are about to see

These are C++, compiled with a real compiler, and most of them assert sizes and
offsets. Those numbers were measured rather than derived, on the same 64-bit
target the checker uses.

`assert-failed` names the size or offset your layout produced. A disagreement
here is a fact about the machine rather than an opinion.
