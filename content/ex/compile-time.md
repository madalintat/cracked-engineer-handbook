## Computed before the program exists

Write `factorial` as a `constexpr` function, so that a `static_assert` can check
its value without running anything.

A `static_assert` that fails is a compile error, which is the whole point: the
answer was wrong before the program existed.

@kind compile-error
@concept A `constexpr` function may run during the build when its arguments are
known, which turns a class of test into a compile error.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict compile-error
@hint The keyword goes before the return type.
@diagnose compile verdict compile-error
The compiler says the expression is not a constant. A plain function cannot be
called in a `static_assert`, however simple its body: the permission has to be
stated, and `constexpr` is how you state it.
@diagnose assert verdict assert-failed
It compiles now and a value is wrong. Factorial of 0 is 1.
@after Nothing ran. The value was computed while the compiler was reading the
file, and a wrong answer would have been a compile error rather than a test
failure. That is the appeal, and the cost is that every such value is build time
somebody waits for, once per build, on every machine.

```starter
int factorial(int n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}
```

```tests
#include <cassert>
constexpr int factorial(int);
static_assert(factorial(0) == 1);
static_assert(factorial(1) == 1);
static_assert(factorial(5) == 120);
static_assert(factorial(10) == 3628800);
int main() {
    /* And it still works at run time, with an argument the compiler cannot see. */
    volatile int n = 6;
    assert(factorial(n) == 720);
    return 0;
}
```

```solution
constexpr int factorial(int n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}
```

## Must, rather than may

`constexpr` says a function is allowed to run at compile time. `consteval` says
it has to.

Make `checked_id` refuse to be called with a value the compiler cannot see, so
that a missed opportunity is an error rather than a silent fallback.

@kind compile-error
@concept `consteval` turns a quiet fallback to run time into a diagnostic, which
matters when the whole reason for the function was to move the work.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict compile-error
@hint One keyword, in place of the other.
@diagnose compile verdict compile-error
The compiler rejects a call whose argument is not a constant expression, which is
exactly the behaviour being asked for. If it rejects the definition instead,
check that the body contains nothing that can only happen at run time.
@diagnose assert verdict assert-failed
It compiles and a value is wrong.
@after A `constexpr` function called with a run-time argument quietly becomes an
ordinary call, which is usually fine and is occasionally the opposite of what you
wanted. `consteval` removes the ambiguity, and the cost is that the function can
no longer be used in the run-time case at all.

```starter
constexpr int checked_id(int n) {
    return n;
}
```

```tests
#include <cassert>
consteval int checked_id(int);
static_assert(checked_id(7) == 7);
static_assert(checked_id(0) == 0);
int main() {
    constexpr int k = checked_id(42);
    assert(k == 42);
    return 0;
}
```

```solution
consteval int checked_id(int n) {
    return n;
}
```

## The branch that is not compiled

Write `describe`, returning 1 for integral types and 2 for everything else, using
`if constexpr` so that the branch not taken is discarded rather than compiled.

A runtime `if` compiles both branches, which fails when one of them is not valid
for the type.

@kind output
@concept `if constexpr` discards the untaken branch, which lets one body handle
types for which the other branch would not even compile.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict compile-error
@hint The condition has to be a constant expression, and the keyword goes after
the `if`.
@diagnose compile verdict compile-error
The compiler is compiling the branch that does not apply. With a plain `if`, both
branches must be valid for every type the template is instantiated with, and the
integral-only operation is not valid for a pointer. `if constexpr` discards the
untaken one entirely.
@diagnose assert verdict assert-failed
It compiles and a value is wrong. Integral types report 1.
@after This replaced a large amount of machinery that existed only to express the
same idea: tag dispatch, overloads on enable_if, and specialisations written for
no reason but to keep an invalid expression out of a body. One keyword, and the
compiler stops looking at code that does not apply.

```starter
#include <type_traits>
template <class T>
int describe(T v) {
    if (std::is_integral_v<T>) {
        return v % 2 == 0 ? 1 : 1;
    } else {
        return 2;
    }
}
```

```tests
#include <cassert>
template <class T> int describe(T);
int main() {
    assert(describe(3) == 1);
    assert(describe(4L) == 1);
    assert(describe('a') == 1);
    /* A pointer has no remainder operator, so the other branch must not be
       compiled for it. */
    int x = 0;
    assert(describe(&x) == 2);
    assert(describe(1.5) == 2);
    return 0;
}
```

```solution
#include <type_traits>
template <class T>
int describe(T v) {
    if constexpr (std::is_integral_v<T>) {
        return v % 2 == 0 ? 1 : 1;
    } else {
        return 2;
    }
}
```

## Counting the instantiations

A template is a recipe, and a separate function is produced for every distinct
set of type arguments.

Write `Tag`, whose static member is instantiated once per type, and confirm that
three types give three independent counters.

@kind output
@concept Each instantiation is a separate entity with its own statics, which is
why using a template with many types costs many compilations.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The counter has to be a static member of the template, not a single shared
variable.
@diagnose assert verdict assert-failed
A check disagrees. A namespace-scope variable is one object shared by every
instantiation, so incrementing through three types gives one counter at three. A
static member of the template gives each instantiation its own.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Three types, three functions, three counters, and every translation unit
that uses them compiles all three again. The linker discards the duplicates,
which is why a large project's link step is slower than its size suggests and
why explicit instantiation in one file is worth doing for the templates everybody
uses.

```starter
inline int shared_count = 0;
template <class T>
struct Tag {
    static int &count() { return shared_count; }
};
```

```tests
#include <cassert>
template <class T> struct Tag;
int main() {
    Tag<int>::count() += 1;
    Tag<int>::count() += 1;
    Tag<double>::count() += 1;
    Tag<char>::count() += 1;
    assert(Tag<int>::count() == 2);
    assert(Tag<double>::count() == 1);
    assert(Tag<char>::count() == 1);
    return 0;
}
```

```solution
template <class T>
struct Tag {
    static int value;
    static int &count() { return value; }
};
template <class T> int Tag<T>::value = 0;
```

## Saying what you require

Constrain `sum_all` so it accepts only types that support addition, and rejects
anything else with a message naming the requirement.

Before concepts this meant arranging for a substitution failure, and the
diagnostics were the ones this language is famous for.

@kind compile-error
@concept A named constraint is checked at the call and reported by name, which is
the same expressive power as a substitution failure with an error a person can
act on.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict compile-error
@hint `requires` on an expression, or a concept declared with one.
@diagnose compile verdict compile-error
The compiler reports the constraint that was not satisfied, which is the exercise
succeeding rather than failing if the type really cannot be added. If the
constraint rejects a type that can be added, check that the requires expression
names the operation rather than the type.
@diagnose assert verdict assert-failed
It compiles and a sum is wrong.
@after The old technique worked and produced pages of output whose useful content
was one line. The constraint is not more powerful, it is nameable, and being able
to say which requirement failed is the entire improvement.

```starter
#include <cstddef>
template <class T>
T sum_all(const T *a, size_t n) {
    T acc{};
    for (size_t i = 0; i < n; i++) acc = acc + a[i];
    return acc;
}
```

```tests
#include <cassert>
#include <cstddef>

struct NoPlus { int x; };

/* Asks whether the call itself is well formed, which is true for an
   unconstrained template and false for a properly constrained one. */
template <class T>
concept CanSum = requires(const T *p, size_t n) { sum_all(p, n); };

static_assert(CanSum<int>, "an addable type must still be accepted");
static_assert(!CanSum<NoPlus>, "a type with no addition must be rejected");

int main() {
    int v[3] = {1, 2, 3};
    assert(sum_all(v, 3) == 6);
    double d[2] = {0.5, 0.25};
    assert(sum_all(d, 2) == 0.75);
    return 0;
}
```

```solution
#include <cstddef>
#include <concepts>

template <class T>
concept Addable = requires(T a, T b) { { a + b } -> std::convertible_to<T>; };

template <Addable T>
T sum_all(const T *a, size_t n) {
    T acc{};
    for (size_t i = 0; i < n; i++) acc = acc + a[i];
    return acc;
}
```

## A string measured during the build

Write `length_of`, a `constexpr` function returning the length of a string
literal, so the answer is a constant the compiler already knows.

@kind compile-error
@concept Work done during the build is work not done at run time, and a string
literal's length is known to the compiler whether or not you ask for it.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict compile-error
@hint Walk to the terminating zero, in a function the compiler is allowed to
evaluate.
@diagnose compile verdict compile-error
The compiler says the call is not a constant expression. `strlen` is not usable
in one, because it is an ordinary library function; writing the loop yourself in
a `constexpr` function is.
@diagnose assert verdict assert-failed
It compiles and a length is wrong. The terminator is not counted.
@after The compiler already knew this. Every string literal has a known size at
the point it appears, and the only reason `strlen` costs anything is that the
information was thrown away when the pointer was formed. This is the smallest
example of a general pattern: run-time work that exists because a type lost
something the compiler had.

```starter
#include <cstring>
size_t length_of(const char *s) {
    return std::strlen(s);
}
```

```tests
#include <cassert>
#include <cstddef>
constexpr size_t length_of(const char *);
static_assert(length_of("") == 0);
static_assert(length_of("a") == 1);
static_assert(length_of("hello") == 5);
static_assert(length_of("a longer string here") == 20);
int main() { return 0; }
```

```solution
#include <cstddef>
constexpr size_t length_of(const char *s) {
    size_t n = 0;
    while (s[n] != '\0') n++;
    return n;
}
```

## Fold, rather than recurse

Write `sum_args`, adding a variadic pack of values, using a fold expression
rather than recursion.

A recursive variadic template instantiates one function per argument. A fold is
one expression.

@kind output
@concept Every instantiation is a compilation, so a technique that produces one
of them instead of one per element is a build-time decision as much as a style
one.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict compile-error
@hint The syntax puts the pack, the operator and the ellipsis inside parentheses.
@diagnose compile verdict compile-error
The compiler cannot expand the pack. A fold is written with the pack name, the
operator and an ellipsis inside parentheses, and the empty case needs an initial
value on one side or the pack must be non-empty.
@diagnose assert verdict assert-failed
It compiles and a sum is wrong. Check the initial value.
@after The recursive form instantiates a function per argument and one more for
the base case, so ten arguments is eleven compilations of eleven distinct
functions. The fold is one. On a codebase where variadic helpers are common this
is a measurable share of the build, and the source is shorter as well.

```starter
template <class... Ts>
int sum_args(Ts... vs) {
    return (vs);
}
```

```tests
#include <cassert>
template <class... Ts> int sum_args(Ts...);
int main() {
    assert(sum_args() == 0);
    assert(sum_args(1) == 1);
    assert(sum_args(1, 2, 3) == 6);
    assert(sum_args(1, 2, 3, 4, 5, 6, 7, 8, 9, 10) == 55);
    assert(sum_args(-1, 1) == 0);
    return 0;
}
```

```solution
template <class... Ts>
int sum_args(Ts... vs) {
    return (0 + ... + vs);
}
```

## The keyword that only helps the parser

`Wrapper<T>::type` could be a type or a value, and the compiler cannot tell which
before it knows what `T` is. It assumes value.

Fix `first_element` so it compiles, by telling the parser what kind of name it is
looking at.

@kind compile-error
@concept Two-phase lookup means a dependent name is parsed before it can be
resolved, so the parse needs a keyword where a human needed nothing.
@backend godbolt
@lang cpp
@flags -O2 -Wall -Wextra
@expect verdict compile-error
@hint One keyword, before the dependent name.
@diagnose compile verdict compile-error
The compiler is parsing `C::value_type` as a value and then finding a declaration
where it expected an expression. `typename` in front of it says the name is a
type, which is information the parser needs and a reader did not.
@diagnose assert verdict assert-failed
It compiles and the value is wrong.
@after The keyword adds nothing a human needed. It exists because the compiler
reads one file at a time, in order, with no way to look ahead, and most of what
feels arbitrary in this subject is a consequence of that.

```starter
#include <cstddef>
template <class C>
auto first_element(const C &c) {
    C::value_type v = c[0];
    return v;
}
```

```tests
#include <cassert>
#include <vector>
#include <string>
template <class C> auto first_element(const C &);
int main() {
    std::vector<int> v{7, 8, 9};
    assert(first_element(v) == 7);
    std::vector<double> d{1.5, 2.5};
    assert(first_element(d) == 1.5);
    std::string s = "abc";
    assert(first_element(s) == 'a');
    return 0;
}
```

```solution
#include <cstddef>
template <class C>
auto first_element(const C &c) {
    typename C::value_type v = c[0];
    return v;
}
```
