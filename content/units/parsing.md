---
needs: [languages, compile-time]
minutes: 55
one_idea: A grammar decides what a sentence means only in languages whose meaning does not depend on what has already been declared, and C is not one of them.
sources: [compilers-interpreters-terminals-unix]
---

A compiler's front end turns a file of characters into a tree. It does it in two
steps that are worth keeping apart, because they are different machines solving
different problems, and most of the strange rules in C and C++ live exactly on
the seam between them.

The lexer reads characters and produces tokens: the words of the language, each
with a kind and a position. The parser reads tokens and produces a tree, which is
where structure appears. Neither step needs the other's problem. A lexer does not
know what an expression is, and a parser never sees a space.

Every claim below was checked against gcc and clang through Compiler Explorer,
which is the same service that will mark your work in this unit.

## The lexer takes the longest match it can

Give a C compiler the text `a+++b` and ask what it means. There is more than one
way to cut it up. It could be `a ++ + b`, or `a + ++ b`, and both are sequences of
real C tokens.

The compiler chooses the first, and it does not do so by thinking about which one
type checks. It applies one rule, over and over: at each position, take the
longest sequence of characters that forms a valid token. That is maximal munch,
and it is the whole of the lexer's decision procedure.

So `a+++b` is `a`, `++`, `+`, `b`, and it compiles as `(a++) + b`. If `a` is
declared as a pointer and the result is nonsense, the lexer will not revisit its
decision. It has no idea. It produced tokens and moved on.

The consequence people meet is `a+++++b`, which every C compiler rejects. Maximal
munch gives `a`, `++`, `++`, `+`, `b`, and `(a++)++` is not something you can
write, because `a++` is not an lvalue. A human reading it can see the parse that
would have worked, `a++ + ++b`, and the compiler will not look for it. The error
you get is about the increment, never about the tokenization.

C++ had the same rule bite it in a more visible place. Before C++11, writing two
closing template brackets together, as in a vector of vectors, produced the
shift operator, because `>>` is the longer match. Everyone learned to type a
space. The fix in C++11 was not a change to the lexer: the token is still `>>`,
and the parser is now required to treat it as two brackets when it is parsing a
template argument list. The seam moved rather than closing.

## Precedence is a shape, not a rule

Given the tokens for `a + b * c`, a parser has to decide what groups with what.
The answer is not in the tokens, which are a flat sequence, and it is not
recoverable afterwards.

```figure
{
  "kind": "blocks",
  "alt": "The token sequence a plus b times c on the left, and on the right a tree with Add at the root, a as its left child, and a Mul node holding b and c as its right child.",
  "caption": "The tokens are a sequence and the tree is not. Once the tree exists, precedence is not a rule that has to be remembered any more; it is the shape, and every later pass reads the shape.",
  "boxes": [
    { "id": "t", "x": 0,    "y": 0.15, "w": 3.4, "h": 1.1, "label": "a + b * c", "accent": "slate" },
    { "id": "r", "x": 5.4,  "y": 0.2, "w": 2.4, "h": 1.0, "label": "Add", "accent": "gold" },
    { "id": "l", "x": 4.2,  "y": 2.4, "w": 1.6, "h": 1.0, "label": "a", "accent": "azure" },
    { "id": "m", "x": 7.0,  "y": 2.4, "w": 2.4, "h": 1.0, "label": "Mul", "accent": "gold" },
    { "id": "b", "x": 6.2,  "y": 4.4, "w": 1.6, "h": 1.0, "label": "b", "accent": "azure" },
    { "id": "c", "x": 8.6,  "y": 4.4, "w": 1.6, "h": 1.0, "label": "c", "accent": "azure" }
  ],
  "arrows": [
    { "from": "t", "to": "r" },
    { "from": "r", "to": "l" },
    { "from": "r", "to": "m" },
    { "from": "m", "to": "b" },
    { "from": "m", "to": "c" }
  ]
}
```

Two ways of getting there are worth knowing. The textbook one is a cascade of
functions, one per precedence level, each calling the next tighter one and then
looking for its own operator. C has around fifteen levels, so that is fifteen
functions, most of which do nothing but call the next.

The compact one gives every operator token a binding power, a number, and runs a
single loop: parse something, look at the next operator, and if it binds tighter
than the level you are at, recurse to gather its right side first. Fifteen
functions collapse into one loop and a table. It is usually called precedence
climbing, or Pratt parsing after its author, and it is what most hand-written
parsers do.

Associativity falls out of the same table. Subtraction groups to the left, so
`2 - 3 - 4` is `(2 - 3) - 4` and not `2 - (3 - 4)`, which differ by 8. Assignment
groups to the right, which is why `a = b = c` assigns once and then again rather
than assigning the result of a comparison. In a climbing parser these are one
number apart: recurse with the same binding power to go right, one higher to go
left.

## Two readings, and a rule that is not about grammar

Now the interesting part, and the reason this unit exists.

Take the statement `A * B;` in C. It has two readings that are both perfectly
good C. If `A` is a type, it declares `B` as a pointer to `A`. If `A` is a
variable, it multiplies `A` by `B` and throws the result away.

Nothing in the token sequence distinguishes them. They are the same four tokens
in the same order. The grammar cannot decide, and the difference is not a
subtlety of the grammar that a cleverer grammar would resolve: the two parses
depend on a declaration that appeared earlier in the file, possibly in a header,
possibly a hundred thousand lines away.

Real compilers resolve it by feeding the symbol table back into the front end, so
that an identifier already declared as a `typedef` lexes as a different token
kind from an ordinary identifier. The name for this is the lexer hack, which is
unfair, because there is no way to avoid it. The language is context sensitive
and the parser has to be too.

You can watch it happen. Compile a file where `A` is a `typedef` and the compiler
is happy. Delete the `typedef`, so `A` becomes an `int` variable, and the same
line compiles as a multiplication whose result is unused. Same characters, same
tokens, two different programs, decided by a line somewhere else.

## Anything that could be a declaration is one

C++ took the same ambiguity and wrote down a resolution that catches people daily.

Write `Widget w();` inside a function, meaning a default-constructed widget. It
declares a function named `w` that takes nothing and returns a `Widget`. Nothing
is constructed and nothing runs. The rule is stated as a preference: if a
construct could be a declaration, it is a declaration.

It gets worse with an argument. `Widget w(Gadget());` looks like a widget built
from a temporary gadget, and it declares a function taking a pointer to a
function returning a gadget. This is the most vexing parse, and it is a parse
that the standard requires rather than a compiler being difficult. Clang will
warn about it if you ask, with `-Wvexing-parse`, and the warning exists because
the correct parse is almost never what was meant.

The escape added in C++11 was braces. `Widget w{};` cannot be read as a
declaration, so it constructs. That is most of why the feature exists.

## When the compiler asks you for the parse

Inside a template, the same ambiguity becomes something the compiler cannot
resolve at all, because the deciding declaration has not been chosen yet.

Write `T::x * y;` in a template on `T`. Whether `T::x` names a type depends on
which `T` the template is instantiated with, and at the point the template is
parsed there is no `T`. Both readings stay open.

C++ resolves this by demanding an answer from you. An unqualified dependent name
is assumed not to be a type, so the line parses as multiplication, and if you
meant a declaration you write `typename T::x * y;`. The `typename` keyword is
not decoration and it is not a hint to the reader. It is the parse, supplied by
the programmer, because the front end genuinely cannot work it out.

That is the sharpest statement of this unit's point available. There is a
mainstream language whose syntax is not decidable from its text, and whose
standard therefore includes a keyword whose entire job is to tell the parser
which tree to build.

## Where this stops being a parsing problem

One more step and the ground gives way. Template instantiation in C++ can compute
anything a Turing machine can, so deciding whether a given C++ file is a valid
program can require running an arbitrary computation, which in general does not
finish.

This is why compilers ship an instantiation depth limit, and why gcc's
`-ftemplate-depth` exists at all. A depth limit is not a memory guard. It is a
compiler choosing to stop rather than to run forever on a question that has no
general answer, which is the same result Part IV proved about the halting
problem, arriving from a completely different direction.

## What the tree keeps, and what it drops

The parse tree records every production the grammar took. The abstract syntax
tree keeps what carries meaning and drops what only helped the parser get there.

Parentheses are the clearest case. Once `(a + b) * c` is a tree, the parentheses
have no work left to do, because the grouping they specified is the shape. Most
punctuation goes the same way. A semicolon separated two statements and the tree
has two statements in it.

What gets kept beyond meaning is a design decision with visible consequences.
Clang keeps a great deal: source locations on every node, the `typedef` name you
wrote rather than what it expanded to, explicit nodes for implicit conversions,
and even parenthesized expressions marked as such. That is more than compiling
needs, and it is why clang-format can reprint your code, why clang-tidy can
rewrite it, and why editors can rename a symbol without regular expressions. A
lossy tree compiles just as well and supports none of that.

## What to carry forward

The lexer takes the longest token it can at every position, without ever
consulting meaning, and that single rule explains `a+++++b` and the old
requirement for a space between two closing template brackets.

The parser turns a flat sequence into a tree, and precedence and associativity
stop being rules at that moment and become shape.

A grammar is enough only when meaning does not affect syntax. In C the same four
tokens are a declaration or a multiplication depending on a `typedef` elsewhere,
in C++ anything that could be a declaration is one, and inside a template you
have to supply the parse yourself with `typename`. Deciding validity in general
is undecidable, which is why there is a depth limit.

Next comes what happens to that tree: the middle end turns it into a form built
for analysis rather than for a human, and every optimisation you have ever seen
in an assembly listing happens there.

## Reading the errors you are about to see

These exercises model the front end's decisions rather than calling into a real
one, because a test that shells out to a compiler is a test about your machine.

`assert-failed` names a case your model got wrong, and the checks are written so
the failing case tells you which rule you missed rather than only that something
is wrong. Several exercises assert that a longer token wins even where the
shorter one would have produced a program that compiles. That is maximal munch
working, not the model failing.
