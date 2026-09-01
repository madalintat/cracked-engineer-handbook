## Released on every path

Write `Guard`, whose destructor increments a counter, and confirm it runs on all
three ways out of a scope.

You write the release once. The compiler emits a call at every point control
leaves.

@kind output
@concept A destructor is a release scheduled at every exit including the ones
exceptions take, which is the path a manual release always gets wrong somewhere.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A destructor with a body, and nothing else.
@diagnose assert verdict assert-failed
A check disagrees on the count. The default destructor does nothing, so the
counter never moves. Give the class a destructor that increments it and the
compiler will call it at the closing brace, at the return, and while an exception
unwinds through.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Three exits, one destructor written, three calls emitted. The exception
path is the one that matters: it is the exit nobody writes a release for, and it
is why binding cleanup to a lifetime beat every convention that relied on
remembering.

```starter
struct Guard {
    int *count;
    explicit Guard(int *c) : count(c) {}
};
```

```tests
#include <cassert>
struct Guard;

static int normal_exit() {
    int n = 0;
    { Guard g(&n); }
    return n;
}

static int early_return() {
    int n = 0;
    for (int i = 0; i < 1; i++) {
        Guard g(&n);
        break;
    }
    return n;
}

static int throwing() {
    int n = 0;
    try {
        Guard g(&n);
        throw 1;
    } catch (int) {}
    return n;
}

int main() {
    assert(normal_exit() == 1);
    assert(throwing() == 1);
    assert(early_return() == 1);
    return 0;
}
```

```solution
struct Guard {
    int *count;
    explicit Guard(int *c) : count(c) {}
    ~Guard() { ++*count; }
};
```

## Reverse order, guaranteed

Two objects constructed in a scope are destroyed in the opposite order. Write
`Marker` so it records when it is destroyed.

This is guaranteed rather than incidental: a later object may depend on an
earlier one, so the earlier one must outlive it.

@kind output
@concept Destruction in reverse construction order is what makes it safe for one
object to hold a reference to another declared before it.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Append the marker's own identifier to the log when it is destroyed.
@diagnose assert verdict assert-failed
A check disagrees on the order. The object constructed second is destroyed
first, so a scope declaring 1 then 2 logs 2 then 1. Recording on construction
rather than destruction gives the sequence the other way round.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why an object may safely hold a reference to one declared above
it in the same scope, and why the reverse is a dangling reference waiting for a
destructor to run. The rule is one line in the standard and it decides the
correctness of a great deal of code that never mentions it.

```starter
struct Marker {
    int id;
    int *log;
    int *n;
    Marker(int i, int *l, int *count) : id(i), log(l), n(count) { log[(*n)++] = id; }
};
```

```tests
#include <cassert>
struct Marker;
int main() {
    int log[4] = {0}, n = 0;
    {
        Marker a(1, log, &n);
        Marker b(2, log, &n);
        Marker c(3, log, &n);
    }
    assert(n == 3);
    assert(log[0] == 3);
    assert(log[1] == 2);
    assert(log[2] == 1);
    return 0;
}
```

```solution
struct Marker {
    int id;
    int *log;
    int *n;
    Marker(int i, int *l, int *count) : id(i), log(l), n(count) {}
    ~Marker() { log[(*n)++] = id; }
};
```

## Taking what a dying object held

Write the move constructor for `Buf`, which owns a heap array.

A move transfers the pointer and leaves the source in a state whose destructor is
harmless. Copying the pointer without clearing the source gives two owners and a
double free.

@kind output
@concept A move transfers and leaves the source valid and unspecified, so its
destructor still runs and releases nothing.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Take the pointer and the size, then clear both in the source.
@diagnose assert verdict assert-failed
A check disagrees. The source has to be left with a null pointer and a size of
zero, so that its destructor deletes nothing. Leaving the pointer in place gives
two objects that both believe they own the array.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Valid and unspecified is the standard's phrase and it is worth respecting.
A moved-from object may be destroyed and may be assigned to; reading its value is
allowed and tells you nothing. The library's own types mostly leave themselves
empty, and depending on that is depending on an implementation detail.

```starter
#include <cstddef>
struct Buf {
    int *data = nullptr;
    size_t n = 0;
    Buf() = default;
    explicit Buf(size_t k) : data(new int[k]()), n(k) {}
    Buf(Buf &&o) noexcept : data(o.data), n(o.n) {}
    Buf(const Buf &) = delete;
    Buf &operator=(const Buf &) = delete;
    ~Buf() { delete[] data; }
};
```

```tests
#include <cassert>
#include <cstddef>
#include <utility>
struct Buf;
int main() {
    Buf a(4);
    a.data[0] = 7;
    Buf b(std::move(a));
    assert(b.n == 4);
    assert(b.data != nullptr);
    assert(b.data[0] == 7);
    /* The source must be left owning nothing. */
    assert(a.data == nullptr);
    assert(a.n == 0);
    return 0;
}
```

```solution
#include <cstddef>
struct Buf {
    int *data = nullptr;
    size_t n = 0;
    Buf() = default;
    explicit Buf(size_t k) : data(new int[k]()), n(k) {}
    Buf(Buf &&o) noexcept : data(o.data), n(o.n) { o.data = nullptr; o.n = 0; }
    Buf(const Buf &) = delete;
    Buf &operator=(const Buf &) = delete;
    ~Buf() { delete[] data; }
};
```

## The cast that moves nothing

`std::move` performs no move. Write `count_ops`, which applies it to an object,
binds the result to a reference, and reports how many moves and copies happened.

The answer is none of either.

@kind output
@concept `std::move` is a cast to an rvalue reference, and what performs the move
is the constructor or assignment the cast made eligible.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Binding to a reference constructs nothing. Constructing a new object does.
@diagnose assert verdict assert-failed
A check disagrees. Constructing a second object from the cast result invokes the
move constructor and counts one. Binding a reference to it invokes nothing, and
that is the distinction the exercise exists for.
@diagnose compile verdict compile-error
Read the line the compiler names. `std::move` needs `<utility>`.
@after Which is why `std::move` on a `const` object silently does nothing useful:
the cast produces a `const` rvalue reference, no move constructor accepts one,
the copy constructor wins overload resolution, and you get a copy where you asked
for a move with no diagnostic anywhere.

```starter
#include <utility>
struct Counted {
    static int moves;
    static int copies;
    int v = 0;
    Counted() = default;
    explicit Counted(int x) : v(x) {}
    Counted(const Counted &o) : v(o.v) { ++copies; }
    Counted(Counted &&o) noexcept : v(o.v) { o.v = 0; ++moves; }
};
int Counted::moves = 0;
int Counted::copies = 0;

void count_ops(int *moves, int *copies) {
    Counted::moves = 0;
    Counted::copies = 0;
    Counted a(5);
    Counted b(std::move(a));
    (void)b;
    *moves = Counted::moves;
    *copies = Counted::copies;
}
```

```tests
#include <cassert>
void count_ops(int *, int *);
int main() {
    int m = -1, c = -1;
    count_ops(&m, &c);
    /* A cast, and a reference bound to its result. Nothing was constructed. */
    assert(m == 0);
    assert(c == 0);
    return 0;
}
```

```solution
#include <utility>
struct Counted {
    static int moves;
    static int copies;
    int v = 0;
    Counted() = default;
    explicit Counted(int x) : v(x) {}
    Counted(const Counted &o) : v(o.v) { ++copies; }
    Counted(Counted &&o) noexcept : v(o.v) { o.v = 0; ++moves; }
};
int Counted::moves = 0;
int Counted::copies = 0;

void count_ops(int *moves, int *copies) {
    Counted::moves = 0;
    Counted::copies = 0;
    Counted a(5);
    Counted &&r = std::move(a);
    (void)r;
    *moves = Counted::moves;
    *copies = Counted::copies;
}
```

## The move that never happens

Write `make_direct` and `make_named`, both returning a `Tracked`, and report how
many objects were constructed.

Returning a local costs neither a copy nor a move. The object is built where the
caller wanted it.

@kind output
@concept Since C++17 a returned temporary is constructed directly in the
caller's storage, so there is no second object for a move to happen between.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Return the object plainly. Do not cast it on the way out.
@diagnose assert verdict assert-failed
A check disagrees, and the count will be too high by one. `return std::move(x)`
names a cast where a plain name was expected, which prevents the elision that
would otherwise have happened and adds exactly the move it was trying to avoid.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured: one construction and one destruction, for both the temporary and
the named local, with no move and no copy in either. This is why
`return std::move(local)` is the rule people get backwards. It cannot help,
because there was nothing to elide the move of, and it can hurt.

```starter
#include <utility>
struct Tracked {
    static int ctors, moves, copies, dtors;
    int v = 0;
    Tracked() { ++ctors; }
    explicit Tracked(int x) : v(x) { ++ctors; }
    Tracked(const Tracked &o) : v(o.v) { ++copies; }
    Tracked(Tracked &&o) noexcept : v(o.v) { o.v = 0; ++moves; }
    ~Tracked() { ++dtors; }
};
int Tracked::ctors = 0;
int Tracked::moves = 0;
int Tracked::copies = 0;
int Tracked::dtors = 0;

Tracked make_direct() { return Tracked(7); }
Tracked make_named() { Tracked t(9); return std::move(t); }

int direct_moves() {
    Tracked::moves = 0;
    { Tracked a = make_direct(); (void)a; }
    return Tracked::moves;
}
int named_moves() {
    Tracked::moves = 0;
    { Tracked a = make_named(); (void)a; }
    return Tracked::moves;
}
```

```tests
#include <cassert>
struct Tracked;
int direct_moves();
int named_moves();
Tracked make_direct();
Tracked make_named();
int main() {
    assert(direct_moves() == 0);
    assert(named_moves() == 0);
    return 0;
}
```

```solution
#include <utility>
struct Tracked {
    static int ctors, moves, copies, dtors;
    int v = 0;
    Tracked() { ++ctors; }
    explicit Tracked(int x) : v(x) { ++ctors; }
    Tracked(const Tracked &o) : v(o.v) { ++copies; }
    Tracked(Tracked &&o) noexcept : v(o.v) { o.v = 0; ++moves; }
    ~Tracked() { ++dtors; }
};
int Tracked::ctors = 0;
int Tracked::moves = 0;
int Tracked::copies = 0;
int Tracked::dtors = 0;

Tracked make_direct() { return Tracked(7); }
Tracked make_named() { Tracked t(9); return t; }

int direct_moves() {
    Tracked::moves = 0;
    { Tracked a = make_direct(); (void)a; }
    return Tracked::moves;
}
int named_moves() {
    Tracked::moves = 0;
    { Tracked a = make_named(); (void)a; }
    return Tracked::moves;
}
```

## Assigning to yourself

Write move assignment for `Owner`, which holds a heap value. It must release
what it had, take what the source has, and survive being assigned from itself.

The naive order fails on self-assignment, and it fails in a way you can see
rather than a way that merely reads freed memory.

@kind output
@concept Assignment has a case construction does not, because the target already
holds something and the source may be the target.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Ask whether the source is this object before touching anything.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the self-move. Deleting the pointer, taking the
source's, and then clearing the source clears the pointer you just took, because
the source is the target. The object ends up owning nothing at all.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Copy assignment has the same shape and a nastier version of the same bug:
release then acquire reads freed memory rather than leaving a visible null, which
is why it can appear to work for years. Copy and swap avoids both by building the
new value first and handing the old one to a temporary that dies at the end of the
statement, which also gives the strong exception guarantee for free.

```starter
#include <utility>
struct Owner {
    int *p = nullptr;
    Owner() = default;
    explicit Owner(int v) : p(new int(v)) {}
    Owner(const Owner &) = delete;
    Owner &operator=(const Owner &) = delete;
    Owner(Owner &&o) noexcept : p(o.p) { o.p = nullptr; }
    Owner &operator=(Owner &&o) noexcept {
        delete p;
        p = o.p;
        o.p = nullptr;
        return *this;
    }
    ~Owner() { delete p; }
};

int assign_value(int a, int b) {
    Owner x(a), y(b);
    x = std::move(y);
    return x.p ? *x.p : -1;
}
int self_assign_value(int a) {
    Owner x(a);
    x = std::move(x);
    return x.p ? *x.p : -1;
}
```

```tests
#include <cassert>
int assign_value(int a, int b);
int self_assign_value(int a);
int main() {
    assert(assign_value(1, 2) == 2);
    /* Moving an object from itself must leave it intact. */
    assert(self_assign_value(5) == 5);
    assert(self_assign_value(0) == 0);
    return 0;
}
```

```solution
#include <utility>
struct Owner {
    int *p = nullptr;
    Owner() = default;
    explicit Owner(int v) : p(new int(v)) {}
    Owner(const Owner &) = delete;
    Owner &operator=(const Owner &) = delete;
    Owner(Owner &&o) noexcept : p(o.p) { o.p = nullptr; }
    Owner &operator=(Owner &&o) noexcept {
        if (this != &o) {
            delete p;
            p = o.p;
            o.p = nullptr;
        }
        return *this;
    }
    ~Owner() { delete p; }
};

int assign_value(int a, int b) {
    Owner x(a), y(b);
    x = std::move(y);
    return x.p ? *x.p : -1;
}
int self_assign_value(int a) {
    Owner x(a);
    Owner &r = x;
    x = std::move(r);
    return x.p ? *x.p : -1;
}
```

## What owning costs

Write `sizes`, reporting the size of a raw pointer, a `unique_ptr` and a
`shared_ptr`.

The rule of zero says to own nothing raw. This is what that advice costs.

@kind output
@concept Exclusive ownership is free in space and shared ownership costs a second
pointer plus an atomic on every copy.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint `sizeof` on each of the three.
@diagnose assert verdict assert-failed
A check disagrees. A `unique_ptr` with the default deleter holds nothing but the
pointer, so it is the same eight bytes. A `shared_ptr` holds a second pointer to
the control block that carries the counts.
@diagnose compile verdict compile-error
Read the line the compiler names. The smart pointers live in `<memory>`.
@after Eight bytes against eight, measured, for exclusive ownership. Sixteen for
shared, and its copies cost an atomic increment, which unit 026 already priced as
cheap uncontended and expensive when several cores want the same line. That is
the reason to establish that ownership really is shared before reaching for it.

```starter
#include <cstddef>
#include <memory>
void sizes(size_t *raw, size_t *uniq, size_t *shared) {
    *raw = sizeof(int *);
    *uniq = sizeof(int *) * 2;
    *shared = sizeof(int *) * 2;
}
```

```tests
#include <cassert>
#include <cstddef>
void sizes(size_t *, size_t *, size_t *);
int main() {
    size_t r, u, s;
    sizes(&r, &u, &s);
    assert(r == 8);
    /* Exclusive ownership costs nothing in space. */
    assert(u == 8);
    /* Shared ownership carries a pointer to the counts. */
    assert(s == 16);
    return 0;
}
```

```solution
#include <cstddef>
#include <memory>
void sizes(size_t *raw, size_t *uniq, size_t *shared) {
    *raw = sizeof(int *);
    *uniq = sizeof(std::unique_ptr<int>);
    *shared = sizeof(std::shared_ptr<int>);
}
```

## Nothing escapes a destructor

A destructor runs during exception unwinding, so an exception escaping one meets
an exception already in flight and the program ends.

Write `Safe`, whose cleanup can fail, so that the failure is recorded rather than
thrown.

@kind output
@concept A destructor must offer the no-throw guarantee, because it runs at a
moment when there is no way to report a second failure.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict signal
@hint Catch inside the destructor and record the outcome somewhere the caller can
read.
@diagnose sig verdict signal
The program was killed rather than failing a check, and that is the point. An
exception escaping a destructor calls `std::terminate`, which aborts, so there is
no opportunity to report anything and no way for a caller to recover. Catch it
inside the destructor and leave a flag behind instead.
@diagnose assert verdict assert-failed
The destructor no longer aborts and the flag is wrong. The failing cleanup has to
be attempted and its exception swallowed, so unwinding continues and the caller
can still find out what happened.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why destructors are implicitly `noexcept` and why a cleanup that
can genuinely fail belongs in a named method the caller invokes, with the
destructor as the fallback that tries and gives up quietly. A close that can fail
is the standard example, and the reason file wrappers offer an explicit close.

```starter
struct Safe {
    bool fail;
    int *flag;
    Safe(bool f, int *fl) : fail(f), flag(fl) {}
    ~Safe() noexcept(false) {
        if (fail) throw 1;
    }
};

int run(bool fail) {
    int flag = 0;
    { Safe s(fail, &flag); }
    return flag;
}
```

```tests
#include <cassert>
struct Safe;
int run(bool fail);
int main() {
    /* A cleanup that succeeds leaves the flag alone. */
    assert(run(false) == 0);
    /* One that fails records it and does not propagate. */
    assert(run(true) == 1);
    return 0;
}
```

```solution
struct Safe {
    bool fail;
    int *flag;
    Safe(bool f, int *fl) : fail(f), flag(fl) {}
    ~Safe() {
        try {
            if (fail) throw 1;
        } catch (...) {
            *flag = 1;
        }
    }
};

int run(bool fail) {
    int flag = 0;
    { Safe s(fail, &flag); }
    return flag;
}
```
