## Longest token wins

Write `plus_tokens`, returning how many tokens a lexer produces from a run of
`n` consecutive `+` characters.

The rule is maximal munch: at each position take the longest valid token, which
is `++` when two are left and `+` when one is.

@kind output
@concept The lexer decides by length alone, so a run of plus characters splits
the same way whether or not the result is a program that compiles.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Every pair of characters is one token, and an odd character left over is
one more.
@diagnose assert verdict assert-failed
A check disagrees. Counting one token per character is what the lexer would do
if it took the shortest match. It takes the longest, so five characters are
`++`, `++`, `+`, which is three tokens rather than five.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Five plus characters lex as three tokens, and `a+++++b` is therefore
`(a++)++ + b`, which is why every C compiler rejects it. The parse a human sees
is never looked for.

```starter
unsigned plus_tokens(unsigned n) {
    return n;
}
```

```tests
#include <assert.h>
unsigned plus_tokens(unsigned);
int main(void) {
    assert(plus_tokens(0) == 0);
    assert(plus_tokens(1) == 1);   /* + */
    assert(plus_tokens(2) == 1);   /* ++ */
    assert(plus_tokens(3) == 2);   /* ++ + */
    assert(plus_tokens(4) == 2);   /* ++ ++ */
    assert(plus_tokens(5) == 3);   /* ++ ++ + */
    return 0;
}
```

```solution
unsigned plus_tokens(unsigned n) {
    return n / 2 + n % 2;
}
```

## Precedence, before there is a tree

Write `eval3`, evaluating `a op1 b op2 c` for the four operators `+ - * /`,
grouping the way C does rather than the way the characters are ordered.

Operators are given as characters. Division is integer division and no test
divides by zero.

@kind output
@concept Precedence is not a property of the sequence, so a parser that walks
left to right without it produces a different number.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Multiplication and division bind tighter than addition and subtraction.
Decide which of the two operators binds tighter, and do that one first.
@diagnose assert verdict assert-failed
A check disagrees. Folding strictly left to right gives `2 + 3 * 4` as 20, the
answer a calculator without precedence gives. C groups the multiplication first
and gives 14.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The tree the parser builds records this, and every later pass reads the
shape rather than reapplying the rule.

```starter
int eval3(int a, char op1, int b, char op2, int c) {
    int r = a;
    r = op1 == '+' ? r + b : op1 == '-' ? r - b : op1 == '*' ? r * b : r / b;
    r = op2 == '+' ? r + c : op2 == '-' ? r - c : op2 == '*' ? r * c : r / c;
    return r;
}
```

```tests
#include <assert.h>
int eval3(int, char, int, char, int);
int main(void) {
    assert(eval3(2, '+', 3, '*', 4) == 14);
    assert(eval3(2, '*', 3, '+', 4) == 10);
    assert(eval3(20, '-', 3, '*', 4) == 8);
    assert(eval3(20, '/', 4, '-', 1) == 4);
    assert(eval3(1, '+', 2, '+', 3) == 6);
    assert(eval3(8, '/', 4, '/', 2) == 1);
    assert(eval3(2, '+', 8, '/', 4) == 4);
    return 0;
}
```

```solution
static int apply(int x, char op, int y) {
    switch (op) {
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        default:  return x / y;
    }
}
static int tight(char op) { return op == '*' || op == '/'; }

int eval3(int a, char op1, int b, char op2, int c) {
    if (!tight(op1) && tight(op2))
        return apply(a, op1, apply(b, op2, c));
    return apply(apply(a, op1, b), op2, c);
}
```

## Which side the tree leans

Write `fold`, applying one operator across an array of values with the
associativity that operator has in C.

`-` groups to the left, so three values are `(a - b) - c`. `=` groups to the
right; model it as the rightmost value winning, which is what a chain of
assignments leaves behind. Only these two operators are tested.

@kind output
@concept Associativity is one number in a precedence table, and it decides
which of two different answers a chain of the same operator produces.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint For `-`, start from the first value and subtract each of the rest. For
`=`, nothing is computed at all: the last value is the answer.
@diagnose assert verdict assert-failed
A check disagrees. `2 - 3 - 4` is `(2 - 3) - 4`, which is -5, and not
`2 - (3 - 4)`, which is 3. Both are subtraction and only the grouping differs.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after In a precedence climbing parser these two cases differ by one: recurse
with the same binding power to lean right, one higher to lean left.

```starter
int fold(char op, const int *vals, unsigned n) {
    (void)op;
    return n ? vals[0] : 0;
}
```

```tests
#include <assert.h>
int fold(char, const int *, unsigned);
int main(void) {
    { int v[] = {2, 3, 4};       assert(fold('-', v, 3) == -5); }
    { int v[] = {10, 1};         assert(fold('-', v, 2) == 9); }
    { int v[] = {7};             assert(fold('-', v, 1) == 7); }
    { int v[] = {1, 2, 3, 4};    assert(fold('-', v, 4) == -8); }
    { int v[] = {2, 3, 4};       assert(fold('=', v, 3) == 4); }
    { int v[] = {9, 1};          assert(fold('=', v, 2) == 1); }
    { int v[] = {5};             assert(fold('=', v, 1) == 5); }
    return 0;
}
```

```solution
int fold(char op, const int *vals, unsigned n) {
    if (!n) return 0;
    if (op == '=') return vals[n - 1];
    int r = vals[0];
    for (unsigned i = 1; i < n; i++) r -= vals[i];
    return r;
}
```

## The same tokens, two programs

Write `classify`, deciding what `A * B;` is, given whether `A` has been declared
as a `typedef` name and whether `B` has been declared already.

Return 1 for a declaration and 0 for an expression statement. If `A` is a
`typedef` name the statement declares `B`, whatever `B` was before. Otherwise it
is a multiplication, and it is only a valid one if `B` already exists.

Return -1 for the case that is neither: `A` is not a type and `B` is undeclared.

@kind output
@concept The parse of a statement depends on a declaration that is not in the
statement, which is what makes the language context sensitive rather than the
grammar deficient.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Ask about `A` first. Nothing about `B` matters when `A` is a type.
@diagnose assert verdict assert-failed
A check disagrees. When `A` is a `typedef` name the statement is a declaration
even if `B` already exists, because the reading does not depend on `B` at all.
When `A` is an ordinary variable there is nothing to declare, so `B` must
already exist or the line is an error.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Real compilers answer this by feeding the symbol table back into the
lexer, so that a `typedef` name arrives at the parser as a different kind of
token from an identifier. It is called the lexer hack, and there is no way
around it.

```starter
int classify(int a_is_typedef, int b_declared) {
    (void)a_is_typedef;
    return b_declared ? 0 : -1;
}
```

```tests
#include <assert.h>
int classify(int, int);
int main(void) {
    assert(classify(1, 0) == 1);    /* typedef A; A * B; declares B */
    assert(classify(1, 1) == 1);    /* still a declaration */
    assert(classify(0, 1) == 0);    /* int A, B; A * B; multiplies */
    assert(classify(0, 0) == -1);   /* neither reading works */
    return 0;
}
```

```solution
int classify(int a_is_typedef, int b_declared) {
    if (a_is_typedef) return 1;
    return b_declared ? 0 : -1;
}
```

## Anything that could be a declaration

Write `vexing`, deciding whether a C++ construct of the form `T x(...)` declares
a function rather than a variable.

The argument list is described by two counts: how many arguments are written as
a type with no name, like `Gadget()` or `int`, and how many are written as an
expression, like `3` or `y`. An empty list has both counts zero.

Return 1 if the standard reads it as a declaration. Anything that could be a
declaration is one, so a list that is entirely types, including an empty list,
is a function declaration. A single expression argument makes it a variable.

@kind output
@concept The rule is a preference stated in the standard, not a consequence of
the grammar, and it resolves in the direction almost nobody wants.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The empty list is the case people meet first, and it is a declaration.
@diagnose assert verdict assert-failed
A check disagrees. `Widget w();` declares a function taking nothing and
returning a `Widget`. It is the case that looks least like a declaration and it
is the one people write by accident.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Clang warns about this under `-Wvexing-parse`, and C++11 added `{}` as
the escape, because braces cannot be read as a parameter list.

```starter
int vexing(unsigned type_args, unsigned expr_args) {
    (void)expr_args;
    return type_args > 0;
}
```

```tests
#include <assert.h>
int vexing(unsigned, unsigned);
int main(void) {
    assert(vexing(0, 0) == 1);   /* Widget w();          a function */
    assert(vexing(1, 0) == 1);   /* Widget w(Gadget());  a function */
    assert(vexing(2, 0) == 1);   /* two type arguments   a function */
    assert(vexing(0, 1) == 0);   /* Widget w(3);         a variable */
    assert(vexing(1, 1) == 0);   /* one of each          a variable */
    return 0;
}
```

```solution
int vexing(unsigned type_args, unsigned expr_args) {
    (void)type_args;
    return expr_args == 0;
}
```

## The parse you have to supply

Write `dependent`, deciding how `T::x * y;` parses inside a template, given
whether the programmer wrote `typename` in front of it.

Return 1 for a declaration and 0 for a multiplication. Without `typename` a
dependent qualified name is assumed not to be a type.

Also handle the non-dependent case: when the name is not dependent, the compiler
can look it up, so `is_dependent` of 0 means the answer follows whether the name
actually is a type.

@kind output
@concept The keyword is the parse. A mainstream language asks the programmer
which tree to build, because at that point the front end genuinely cannot know.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint When the name is dependent the compiler has no `T` yet, so only the
keyword can decide. When it is not dependent the keyword is not needed.
@diagnose assert verdict assert-failed
A check disagrees. A dependent name with no `typename` is not a type, so the
line is a multiplication, whatever the eventual instantiation turns out to make
`T::x`. That default is why the keyword exists.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is the sharpest form of the unit's argument. The grammar cannot
decide, the symbol table cannot decide yet, so the standard adds a keyword whose
only job is to tell the parser which tree to build.

```starter
int dependent(int is_dependent, int wrote_typename, int name_is_type) {
    (void)is_dependent; (void)wrote_typename;
    return name_is_type;
}
```

```tests
#include <assert.h>
int dependent(int, int, int);
int main(void) {
    /* Dependent: only the keyword decides. */
    assert(dependent(1, 0, 1) == 0);
    assert(dependent(1, 0, 0) == 0);
    assert(dependent(1, 1, 1) == 1);
    /* Not dependent: the compiler can look the name up. */
    assert(dependent(0, 0, 1) == 1);
    assert(dependent(0, 0, 0) == 0);
    return 0;
}
```

```solution
int dependent(int is_dependent, int wrote_typename, int name_is_type) {
    if (is_dependent) return wrote_typename ? 1 : 0;
    return name_is_type;
}
```

## What the tree throws away

Write `ast_nodes`, returning how many nodes an abstract syntax tree holds for a
fully parenthesised chain of binary operators over `n` values.

A parse tree would record every parenthesis. The abstract tree keeps only the
values and the operators, because the grouping the parentheses specified is now
the shape of the tree.

@kind output
@concept Parentheses exist to tell the parser what to build, and once it is
built they have no work left to do.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Every operator is one node and every value is one node. Count how many
operators join `n` values.
@diagnose assert verdict assert-failed
A check disagrees. Three values joined by two operators are five nodes, not
three and not eight. The parentheses that forced the grouping are not nodes.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Clang deliberately keeps more than this, including the parentheses and
every source location, which is what makes clang-format and clang-tidy possible.
A tree that keeps only meaning compiles just as well and supports none of it.

```starter
unsigned ast_nodes(unsigned values) {
    return values;
}
```

```tests
#include <assert.h>
unsigned ast_nodes(unsigned);
int main(void) {
    assert(ast_nodes(0) == 0);
    assert(ast_nodes(1) == 1);   /* a */
    assert(ast_nodes(2) == 3);   /* (a + b) */
    assert(ast_nodes(3) == 5);   /* ((a + b) + c) */
    assert(ast_nodes(4) == 7);
    assert(ast_nodes(10) == 19);
    return 0;
}
```

```solution
unsigned ast_nodes(unsigned values) {
    return values ? 2 * values - 1 : 0;
}
```

## Where the else goes

Write `else_owner`, returning which `if` an `else` attaches to, given a chain of
`n` nested `if` statements with no braces and a single `else` at the end.

Number the `if` statements from 0 at the outermost. An `else` binds to the
nearest `if` that does not already have one.

Return -1 when there is no `if` for it to bind to.

@kind output
@concept The dangling else is ambiguous in the grammar, and every language that
has it resolves the ambiguity by a rule written outside the grammar.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Nearest means innermost, which is the largest number rather than the
smallest.
@diagnose assert verdict assert-failed
A check disagrees. The `else` goes to the innermost `if`, which is why
indentation that suggests otherwise is a real source of wrong programs and why
compilers warn about it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A parser generator reports this as a shift-reduce conflict and resolves
it by shifting, which happens to give the same answer the C standard requires.
Braces make the question go away, which is why the style guides insist on them.

```starter
int else_owner(unsigned ifs) {
    return ifs ? 0 : -1;
}
```

```tests
#include <assert.h>
int else_owner(unsigned);
int main(void) {
    assert(else_owner(0) == -1);
    assert(else_owner(1) == 0);
    assert(else_owner(2) == 1);
    assert(else_owner(3) == 2);
    assert(else_owner(9) == 8);
    return 0;
}
```

```solution
int else_owner(unsigned ifs) {
    return ifs ? (int)ifs - 1 : -1;
}
```
