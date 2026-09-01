---
needs: [object-model]
minutes: 55
one_idea: A destructor is a release the compiler schedules on every exit path, and a move is permission to take what a dying object was holding.
sources: [numbers-text-numerics, cpu-architectures]
---

Every resource has to be released. Memory, file descriptors, locks, sockets,
graphics contexts. The hard part has never been remembering to release them once;
it is releasing them on every path out of a function, including the ones you did
not write.

## The problem, stated precisely

A function acquires two resources and can leave through six places: four returns,
one exception from a call in the middle, and one exception from a call at the
end. Releasing correctly means the right subset released at each of the six, and
the number of subsets grows with the number of resources.

Every language that solved this solved it by taking the decision away from the
programmer. Some run a collector later. Some use a defer statement executed at
scope exit. C++ ties it to object lifetime, which turns out to be the version
with the fewest gaps, because it composes: an object holding two resources
releases both without anybody writing a release for the pair.

## The destructor is scheduled, not called

The key move is that you never write the release at the exit points. You write it
once, in a destructor, and the compiler emits a call to it at every point control
leaves the scope.

Every point. The returns, the break, the exception unwinding through. That last
one is what a defer statement in a language without exceptions does not have to
handle and what a manual release always gets wrong somewhere.

Destruction happens in reverse order of construction, and this is guaranteed
rather than incidental. It has to be: a later object may depend on an earlier
one, so the earlier one must outlive it.

```figure
{
  "kind": "blocks",
  "alt": "A scope with two objects constructed in order, and four exits from it, each showing both destructors running in reverse order.",
  "caption": "One destructor written, six call sites emitted. The exception path is the one a manual release forgets and the one that matters.",
  "boxes": [
    { "id": "c1", "x": 0,   "y": 0.4, "w": 3.2, "h": 1.1, "label": "construct a", "accent": "jade" },
    { "id": "c2", "x": 0,   "y": 1.8, "w": 3.2, "h": 1.1, "label": "construct b", "accent": "jade" },
    { "id": "r",  "x": 4.6, "y": 0.4, "w": 3,   "h": 1.1, "label": "return" },
    { "id": "t",  "x": 4.6, "y": 1.8, "w": 3,   "h": 1.1, "label": "throw", "accent": "bad" },
    { "id": "d",  "x": 9,   "y": 1.1, "w": 4,   "h": 1.1, "label": "~b then ~a", "accent": "gold" }
  ],
  "arrows": [
    { "from": "c1", "to": "c2" },
    { "from": "r", "to": "d" },
    { "from": "t", "to": "d" }
  ]
}
```

## Three promises a function can make

Once destructors run on the exception path, a function can offer one of three
guarantees, and knowing which one you are offering is most of writing correct
code with exceptions.

The basic guarantee says nothing leaks and every object is still in a usable
state, though not necessarily the one it had. This is the minimum and it is what
RAII gives you almost for free.

The strong guarantee says the operation either completes or leaves everything
exactly as it was. It usually costs a copy: build the new state beside the old
one, and swap only when nothing can throw any more.

The no-throw guarantee says the operation cannot fail. Destructors and swaps must
offer it, because they run during unwinding and an exception escaping there ends
the program.

That last rule is why destructors are implicitly `noexcept` and why a destructor
that can fail is a design problem rather than a coding one.

## What a move actually is

Copying a resource-owning object means duplicating the resource, which is often
expensive and sometimes impossible. A socket cannot be copied.

A move is the alternative: transfer what the source holds and leave the source in
a state that is valid and unspecified, so that its destructor runs harmlessly.
Measured on a type that counts its own operations, moving a value out of an
object leaves the source at zero and the destination holding what it had, with no
copy performed.

Valid and unspecified is the precise phrase and it is worth respecting. A
moved-from object may be destroyed and may be assigned to. Reading its value is
allowed and tells you nothing. The standard library's types mostly leave
themselves empty, and depending on that is depending on an implementation detail.

## The one that has to be handled

Assignment is where the special members get interesting, because the target
already holds something.

Copy assignment has to release what the target had, acquire a copy of what the
source has, and cope with the two being the same object. Writing it as release
then acquire fails on self-assignment: the release destroys the thing about to be
copied. The usual answer is copy and swap, which builds the new value first and
gives the old one to a temporary that dies at the end of the statement.

Move assignment has the same shape and one more case. Self-move must leave the
object usable, and the standard's requirement is only that it be valid, which is
why the library's own types check for it rather than relying on the steal being
harmless.

None of this is an argument for writing them. It is an argument for the rule that
follows: every one of these hazards belongs to a class that owns something raw,
and a class that owns nothing raw has none of them.

## The cast that does not move

`std::move` moves nothing. It is a cast, and its entire body is a
`static_cast` to an rvalue reference.

Measured: calling `std::move` on an object and binding the result to a reference
performs zero moves and zero copies. What performs the move is the constructor or
assignment that the cast made eligible for overload resolution.

Which means `std::move` on a `const` object silently does nothing useful. The
cast produces a `const` rvalue reference, no move constructor accepts one, the
copy constructor is chosen instead, and you get a copy where you asked for a
move, with no diagnostic.

## The move that never happens

Returning a local object looks like it should cost a move. It does not.

Measured on the same counting type: a function returning a temporary performs one
construction and one destruction. A function that names a local and returns it
performs one construction and one destruction. Not a move, not a copy.

Since C++17 this is guaranteed for the temporary case rather than merely allowed:
the object is constructed directly in the caller's storage, and there is no
second object for a move to happen between. The named case is still technically
an optimisation and every compiler performs it.

The practical rule that follows is the one people get backwards. Do not write
`return std::move(local)`. It cannot help, because there was nothing to elide the
move of, and it can hurt, because naming a cast where a plain name was expected
prevents the elision that would otherwise happen.

## Where the scope is not the lifetime

RAII binds a release to a scope, and sometimes the scope is not where the
resource should die. Three answers, in increasing cost.

Move it out. A function that opens something and returns the handle transfers
ownership to the caller, and the release now happens at the caller's scope exit.
This is what the move is for and it costs nothing.

Put it in a container. A vector of owning objects releases all of them when it
goes, and the individual lifetimes are the container's problem.

Share it. When two independent parts genuinely both need the thing alive, a
reference count decides who is last. That is the only case that needs
`shared_ptr`, and reaching for it before establishing that ownership really is
shared is the commonest way a C++ codebase becomes hard to reason about: with
everything shared, nothing has an owner and no lifetime is stated anywhere.

The question worth asking at each resource is who decides when this dies. If the
answer is one place, it is exclusive. If the answer is whoever finishes last, it
is shared. If the answer is unclear, the design is unclear, and no smart pointer
fixes that.

## Zero, or five

If a class owns a raw resource it needs a destructor, and then the compiler's
generated copy operations are wrong: they duplicate the pointer, both objects
destroy it, and the second destruction is a double free.

So the rule of five: if you write any of the destructor, copy constructor, copy
assignment, move constructor or move assignment, you probably need all five.

And the rule of zero, which is the better one: do not own raw resources. Hold a
type that already handles it, and write none of the five, and let the compiler
generate all of them correctly.

Measured, the cost of that advice is nothing. A `unique_ptr` is 8 bytes, the same
as the raw pointer it replaces. A `shared_ptr` is 16, because it also carries a
pointer to the reference counts, and its copies cost an atomic increment, which
unit 026 already priced.

## What to carry forward

A destructor is a release the compiler schedules at every exit, including the
ones exceptions take, and destruction is in reverse construction order because
later objects may depend on earlier ones.

A move transfers and leaves the source valid and unspecified. `std::move` is a
cast that makes a move eligible and performs none itself, and returning a local
performs neither a copy nor a move.

Own nothing raw and you write none of the five special members. That costs zero
bytes for exclusive ownership and one pointer plus an atomic for shared.

## Reading the errors you are about to see

These count constructions, moves and destructions with static counters, which is
exact and reproducible. Every expected count was produced by running the code.

`assert-failed` names the count that disagreed. Several of these exercises assert
that something does not happen, which is the point: an assertion that a move
occurred where the language guarantees elision would be testing the wrong claim.
