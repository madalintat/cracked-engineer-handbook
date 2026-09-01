## The order you typed it in

Reorder the members of `Rec` so it occupies as few bytes as possible, without
removing anything.

Alignment decides padding: each member starts at the next offset satisfying its
own alignment, and the whole struct is rounded up to a multiple of its own.

@kind output
@concept The compiler is not allowed to reorder members, so field order is
layout order and shrinking a struct is a source edit.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Declare the wide members first and let the narrow ones share the tail.
@diagnose assert verdict assert-failed
A check disagrees on the size. A `char` before a `long` forces seven bytes of
padding so the `long` can start on an eight-byte boundary. Putting the `long`
first lets both `char` members sit next to each other afterwards, and only the
tail padding remains.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after 24 bytes against 16, measured, for the same three members. On an array of
a million of these that is eight megabytes of memory traffic that does nothing,
and unit 024 already said what eight extra bytes per element costs when the unit
of transfer is 64.

```starter
#include <cstddef>
struct Rec {
    char a;
    long b;
    char c;
};
static_assert(sizeof(long) == 8, "this exercise assumes a 64-bit target");
size_t rec_size() { return sizeof(Rec); }
size_t off_b() { return offsetof(Rec, b); }
```

```tests
#include <cassert>
#include <cstddef>
size_t rec_size();
size_t off_b();
int main() {
    assert(rec_size() == 16);
    /* The wide member has to be first for that size to be reachable. */
    assert(off_b() == 0);
    return 0;
}
```

```solution
#include <cstddef>
struct Rec {
    long b;
    char a;
    char c;
};
static_assert(sizeof(long) == 8, "this exercise assumes a 64-bit target");
size_t rec_size() { return sizeof(Rec); }
size_t off_b() { return offsetof(Rec, b); }
```

## Working out the offsets by hand

Write `field_offset`, computing where a member lands given the offset reached so
far and the member's alignment.

This is the whole layout rule: round the current offset up to the next multiple
of the alignment.

@kind output
@concept Layout is one arithmetic rule applied member by member, which is why a
`sizeof` can be predicted rather than looked up.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Round up, not down. An offset already on a boundary does not move.
@diagnose assert verdict assert-failed
A check disagrees. Rounding down puts a member before where the previous one
ended, which overlaps it. The expression that rounds up is the offset plus the
alignment minus one, divided by the alignment, times the alignment.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Apply this member by member and then once more to the total, using the
struct's own alignment, and you have the size the compiler will produce. Every
`sizeof` surprise in C and C++ is this arithmetic performed differently from how
you expected.

```starter
#include <cstddef>
size_t field_offset(size_t so_far, size_t align) {
    return so_far / align * align;
}
```

```tests
#include <cassert>
#include <cstddef>
size_t field_offset(size_t, size_t);
int main() {
    /* Already aligned: no movement. */
    assert(field_offset(0, 8) == 0);
    assert(field_offset(8, 8) == 8);
    assert(field_offset(4, 4) == 4);
    /* A char at 1, then a long: seven bytes of padding. */
    assert(field_offset(1, 8) == 8);
    assert(field_offset(7, 8) == 8);
    assert(field_offset(9, 8) == 16);
    /* Alignment of one never pads. */
    assert(field_offset(5, 1) == 5);
    assert(field_offset(5, 4) == 8);
    return 0;
}
```

```solution
#include <cstddef>
size_t field_offset(size_t so_far, size_t align) {
    return (so_far + align - 1) / align * align;
}
```

## The pointer you did not declare

Add a virtual destructor to `Node` and observe what it costs.

`Node` holds one `int`. Adding a virtual function gives every object a hidden
pointer to a table shared by the class.

@kind output
@concept A virtual function costs eight bytes in every object, once, whatever
the number of virtual functions.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One virtual function is enough. A destructor is the one you want here.
@diagnose assert verdict assert-failed
A check disagrees on the size. Without a virtual function the object is just its
`int`, four bytes. With one it gains an eight-byte pointer, and the `int` plus
four bytes of tail padding brings the total to sixteen.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after One pointer per object, not one per virtual function: the table holds all
of them and the object holds one pointer to the table. That also means a class
with twenty virtual functions costs the same eight bytes as a class with one,
which is why the advice to avoid virtual functions for size reasons is usually
misdirected.

```starter
#include <cstddef>
struct Node {
    int x;
    ~Node() = default;
};
size_t node_size() { return sizeof(Node); }
bool node_polymorphic() { return __is_polymorphic(Node); }
```

```tests
#include <cassert>
#include <cstddef>
size_t node_size();
bool node_polymorphic();
int main() {
    assert(node_polymorphic());
    assert(node_size() == 16);
    return 0;
}
```

```solution
#include <cstddef>
struct Node {
    int x;
    virtual ~Node() = default;
};
size_t node_size() { return sizeof(Node); }
bool node_polymorphic() { return __is_polymorphic(Node); }
```

## The cast that moves the pointer

`Both` inherits from two polymorphic bases. A pointer to the second base cannot
address the start of the object, because the second base's part of it does not
begin there.

Write `second_base_offset`, which builds one and returns how far into it that
pointer points.

@kind output
@concept Casting to a second base changes the pointer's value, so two pointers to
one object can compare unequal until they are brought to a common type.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Cast the address to a byte pointer on both sides and subtract.
@diagnose assert verdict assert-failed
A check disagrees. The first base shares the object's address and the second does
not: its subobject starts after the first one ends, which for two sixteen-byte
polymorphic bases is sixteen bytes in. Returning zero assumes single inheritance.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Sixteen bytes, measured. This is why comparing a pointer to one base
against a pointer to another can be false for the same object, and why calling
through the second base runs a small stub that subtracts the offset before
entering the derived implementation. Neither appears in the source.

```starter
#include <cstddef>
struct A { virtual void f(); virtual ~A() = default; int a; };
struct B { virtual void g(); virtual ~B() = default; int b; };
struct Both : A, B { void f() override; void g() override; int c; };
inline void A::f() {} inline void B::g() {}
inline void Both::f() {} inline void Both::g() {}

ptrdiff_t second_base_offset() {
    Both obj{};
    Both *p = &obj;
    (void)p;
    return 0;
}
size_t both_size() { return sizeof(Both); }
```

```tests
#include <cassert>
#include <cstddef>
ptrdiff_t second_base_offset();
size_t both_size();
int main() {
    assert(both_size() == 32);
    /* The first base shares the address; the second does not. */
    assert(second_base_offset() == 16);
    return 0;
}
```

```solution
#include <cstddef>
struct A { virtual void f(); virtual ~A() = default; int a; };
struct B { virtual void g(); virtual ~B() = default; int b; };
struct Both : A, B { void f() override; void g() override; int c; };
inline void A::f() {} inline void B::g() {}
inline void Both::f() {} inline void Both::g() {}

ptrdiff_t second_base_offset() {
    Both obj{};
    Both *p = &obj;
    B *pb = p;
    return reinterpret_cast<char *>(pb) - reinterpret_cast<char *>(p);
}
size_t both_size() { return sizeof(Both); }
static_assert(sizeof(Both) == 32, "two vptrs and three ints");
```

## Empty, and free

An empty class has size 1, because two objects must have distinct addresses. An
empty base contributes nothing at all.

Change `Holder` so that its empty policy costs no space.

@kind output
@concept The empty base optimisation exists so that a stateless policy does not
cost a byte and its padding in every object that uses one.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Inherit from it rather than holding it.
@diagnose assert verdict assert-failed
A check disagrees on the size. An empty member occupies one byte and then forces
three more of padding before the `int`, giving eight. An empty base occupies
nothing, giving four.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Four bytes against eight, for a class with no data in it. This is why the
standard library's containers inherit from their allocator and their comparator
rather than holding them, and why `[[no_unique_address]]` was added, to get the
same result without inheritance.

```starter
#include <cstddef>
struct Policy {};
struct Holder {
    Policy p;
    int x;
};
size_t holder_size() { return sizeof(Holder); }
size_t policy_size() { return sizeof(Policy); }
```

```tests
#include <cassert>
#include <cstddef>
size_t holder_size();
size_t policy_size();
int main() {
    /* An empty class is still one byte on its own. */
    assert(policy_size() == 1);
    /* And costs nothing inside another. */
    assert(holder_size() == 4);
    return 0;
}
```

```solution
#include <cstddef>
struct Policy {};
struct Holder : Policy {
    int x;
};
size_t holder_size() { return sizeof(Holder); }
size_t policy_size() { return sizeof(Policy); }
```

## Reinterpreting bytes without lying

Write `bits_of`, returning the bit pattern of a `float` as an unsigned integer.

The starter converts rather than reinterprets, which is the commoner confusion.
The other tempting route, reading through an `unsigned*`, is undefined: the
failure there is not a wrong value but the compiler proving, from the aliasing
rule, that nothing could have changed a value it kept in a register.

@kind output
@concept Strict aliasing is an assumption the optimiser works from, so violating
it produces code that is wrong in ways that look like a compiler bug.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint There is a function whose entire job is to copy bytes between unrelated
types.
@diagnose assert verdict assert-failed
A check disagrees, and by a lot. A conversion asks what number this is and gives
1 for `1.0f`; a reinterpretation asks what bytes this is and gives 0x3F800000.
`std::memcpy` between two four-byte objects performs the second, has no aliasing
problem, and compiles to a single move.
@diagnose compile verdict compile-error
Read the line the compiler names. `std::memcpy` needs `<cstring>`.
@after `memcpy` here generates no instructions: the compiler sees a four-byte
copy between two four-byte objects and emits a move. You pay nothing for
following the rule, which is what makes ignoring it a poor trade.

```starter
#include <cstring>
unsigned bits_of(float f) {
    return static_cast<unsigned>(f);
}
```

```tests
#include <cassert>
unsigned bits_of(float);
int main() {
    assert(bits_of(1.0f) == 0x3F800000u);
    assert(bits_of(0.0f) == 0x00000000u);
    assert(bits_of(2.0f) == 0x40000000u);
    /* The nearest float to a tenth. */
    assert(bits_of(0.1f) == 0x3DCCCCCDu);
    assert(bits_of(-1.0f) == 0xBF800000u);
    return 0;
}
```

```solution
#include <cstring>
unsigned bits_of(float f) {
    unsigned u;
    std::memcpy(&u, &f, sizeof u);
    return u;
}
```

## What the library requires

Write `describe`, reporting whether a type is trivially copyable and whether it
is standard layout.

Library constraints are stated in these terms, and a type can lose one of them by
gaining a member.

@kind output
@concept A container that relocates objects by copying bytes requires trivial
copyability, so a type that acquires an owning member stops qualifying and the
change shows up as performance rather than as an error.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The standard library has a trait for each.
@diagnose assert verdict assert-failed
A check disagrees. The two properties are independent: a class with virtual
functions is trivially copyable in neither sense but a class with mixed access
control can be trivially copyable and not standard layout, and one holding a
`std::string` is standard layout and not trivially copyable.
@diagnose compile verdict compile-error
Read the line the compiler names. The traits live in `<type_traits>`.
@after The distinction decides what you may do with the bytes. Trivially copyable
means `memcpy` produces a valid copy. Standard layout means the arrangement
matches what C would produce, which is what lets a struct cross a language
boundary. Only a type with both may be written to a file and read back.

```starter
#include <type_traits>
template <class T>
void describe(bool *trivially_copyable, bool *standard_layout) {
    *trivially_copyable = true;
    *standard_layout = true;
}
template void describe<int>(bool *, bool *);
```

```tests
#include <cassert>
#include <string>
template <class T> void describe(bool *, bool *);

struct Plain { int a; double b; };
struct Owning { std::string s; };
struct Poly { virtual ~Poly() = default; int x; };

template <class T> static void check(bool tc, bool sl) {
    bool a, b;
    describe<T>(&a, &b);
    assert(a == tc);
    assert(b == sl);
}

int main() {
    check<int>(true, true);
    check<Plain>(true, true);
    /* Owns a heap buffer, so copying its bytes would give two owners. */
    check<Owning>(false, true);
    /* A vptr the compiler manages, so neither holds. */
    check<Poly>(false, false);
    return 0;
}
```

```solution
#include <type_traits>
template <class T>
void describe(bool *trivially_copyable, bool *standard_layout) {
    *trivially_copyable = std::is_trivially_copyable_v<T>;
    *standard_layout = std::is_standard_layout_v<T>;
}
```

## Predicting a size

Write `struct_size`, computing what a struct of the given member sizes and
alignments will occupy.

Members are laid out in order, each rounded up to its own alignment, and the
total is rounded up to the largest alignment present.

@kind output
@concept The layout rule is short enough to apply by hand, which turns every
surprising `sizeof` into arithmetic you can check.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Track the running offset and the largest alignment seen, then round the
total once at the end.
@diagnose assert verdict assert-failed
A check disagrees. The tail padding is the step people forget: the total is
rounded up to the struct's own alignment, which is the largest of its members',
so that an array of them keeps every element aligned.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Run it on a `char`, a `long` and a `char` in that order and it gives 24.
Reorder to `long`, `char`, `char` and it gives 16. Those are the numbers the
compiler produces, and this function is the whole reason why.

```starter
#include <cstddef>
size_t struct_size(const size_t *sizes, const size_t *aligns, size_t n) {
    size_t off = 0;
    for (size_t i = 0; i < n; i++) {
        off = (off + aligns[i] - 1) / aligns[i] * aligns[i];
        off += sizes[i];
    }
    return off;
}
```

```tests
#include <cassert>
#include <cstddef>
size_t struct_size(const size_t *, const size_t *, size_t);
int main() {
    /* char, long, char: padding before the long, then tail padding. */
    size_t s1[3] = {1, 8, 1}, a1[3] = {1, 8, 1};
    assert(struct_size(s1, a1, 3) == 24);
    /* long, char, char: no interior padding, six bytes of tail. */
    size_t s2[3] = {8, 1, 1}, a2[3] = {8, 1, 1};
    assert(struct_size(s2, a2, 3) == 16);
    /* Two ints need no padding at all. */
    size_t s3[2] = {4, 4}, a3[2] = {4, 4};
    assert(struct_size(s3, a3, 2) == 8);
    /* One char alone is one byte. */
    size_t s4[1] = {1}, a4[1] = {1};
    assert(struct_size(s4, a4, 1) == 1);
    /* An int then a char: three bytes of tail padding. */
    size_t s5[2] = {4, 1}, a5[2] = {4, 1};
    assert(struct_size(s5, a5, 2) == 8);
    assert(struct_size(s1, a1, 0) == 0);
    return 0;
}
```

```solution
#include <cstddef>
size_t struct_size(const size_t *sizes, const size_t *aligns, size_t n) {
    size_t off = 0, most = 1;
    for (size_t i = 0; i < n; i++) {
        if (aligns[i] > most) most = aligns[i];
        off = (off + aligns[i] - 1) / aligns[i] * aligns[i];
        off += sizes[i];
    }
    return (off + most - 1) / most * most;
}
```
