## What does a lexer produce?

- [x] A sequence of tokens, each with a kind and a position
- [ ] A tree, with the operators at the branches
- [ ] A symbol table
- [ ] Machine code for the target

@why The lexer turns characters into words. Structure appears in the next step,
when the parser turns that flat sequence into a tree.

## How does a lexer decide where one token ends and the next begins?

- [x] It takes the longest sequence of characters that forms a valid token
- [ ] It takes the shortest token that lets the whole line parse
- [ ] It asks the parser which token would fit
- [ ] It splits on whitespace

@why Maximal munch, applied at each position with no reference to meaning. It is
the whole of the lexer's decision procedure.

## How does a C lexer split `a+++b`?

- [x] `a`, `++`, `+`, `b`
- [ ] `a`, `+`, `++`, `b`
- [ ] `a`, `+`, `+`, `+`, `b`
- [ ] It is a syntax error before any splitting happens

@why Longest match at each position. The first two plus characters make `++`,
which leaves a single `+` before `b`, so it compiles as `(a++) + b`.

## Why does every C compiler reject `a+++++b`?

- [x] Maximal munch gives `(a++)++`, and `a++` is not an lvalue
- [ ] The expression is ambiguous, so the compiler refuses to choose
- [ ] Five operators in a row exceed the grammar's nesting limit
- [ ] Increment cannot be applied to a variable twice in one statement

@why The lexer produces `++`, `++`, `+` and never reconsiders. A human can see
that `a++ + ++b` would work, and the compiler does not look for it, which is why
the error is about the increment rather than about the tokenization.

## Before C++11, why did a vector of vectors need a space between the closing brackets?

- [x] `>>` is a longer valid token than `>`, so maximal munch produced the shift operator
- [ ] The parser could not nest template arguments
- [ ] Two closing brackets were reserved for the preprocessor
- [ ] The standard library header did not support it

@why The same rule as `a+++b`, in a place people met daily. C++11 fixed it in
the parser rather than the lexer: the token is still `>>`, and the parser is
required to treat it as two brackets inside a template argument list.

## What is `2 - 3 - 4` in C, and why?

- [x] -5, because subtraction groups to the left
- [ ] 3, because subtraction groups to the right
- [ ] -5, because the compiler evaluates arguments left to right
- [ ] Unspecified, because the order of evaluation is not defined

@why Associativity decides the grouping, and grouping decides the answer. Order
of evaluation is a different question and does not change this one.

## After the parser has built the tree, where does precedence live?

- [x] In the shape of the tree
- [ ] In a table the later passes consult
- [ ] In the order of the tokens, which the tree preserves
- [ ] In parentheses, which the tree keeps for that purpose

@why `a + b * c` becomes an addition whose right child is a multiplication. No
later pass has to know the rule, because the grouping is now structure.

## In a precedence climbing parser, what is the difference between a left-associative and a right-associative operator?

- [x] The binding power used for the recursive call, by one
- [ ] A separate function per associativity
- [ ] The direction the token stream is read in
- [ ] Nothing; associativity is fixed up after the tree is built

@why Recurse with the same binding power and the operator leans right; recurse
with one higher and it leans left. That is the whole difference.

## In C, what is `A * B;` at statement level?

- [x] A declaration if `A` is a typedef name, and a multiplication otherwise
- [ ] Always a multiplication, because a declaration needs a storage class
- [ ] Always a declaration, because a bare multiplication has no effect
- [ ] Ambiguous, and the compiler picks either one

@why The same four tokens are two different programs, and which one they are
depends on a declaration that appeared earlier, possibly in a header. This is
what makes the language context sensitive.

## What is the lexer hack?

- [x] Feeding the symbol table back into the front end so a typedef name lexes as its own token kind
- [ ] A workaround for compilers that cannot handle deeply nested parentheses
- [ ] Preprocessing the file twice to resolve macros before parsing
- [ ] Guessing the parse and backtracking when type checking fails

@why The name is unfair, because there is no way to avoid it. The language is
context sensitive, so the parser has to be too.

## What does `Widget w();` declare inside a function?

- [x] A function named `w` taking nothing and returning a `Widget`
- [ ] A default-constructed `Widget` named `w`
- [ ] Nothing; it is a statement with no effect
- [ ] A `Widget` initialised with the result of calling `w`

@why Anything that could be a declaration is a declaration. It is the case that
looks least like one, and it is the one people write by accident.

## Why was `Widget w{};` added in C++11?

- [x] Braces cannot be read as a parameter list, so the construction is unambiguous
- [ ] Braces initialise members in declaration order and parentheses do not
- [ ] Parentheses were deprecated for construction
- [ ] It compiles faster, because the parser has less to consider

@why Giving people an escape from the most vexing parse is a large part of why
the syntax exists.

## Inside a template, how does `T::x * y;` parse without `typename`?

- [x] As a multiplication, because a dependent name is assumed not to be a type
- [ ] As a declaration, because that reading is preferred everywhere in C++
- [ ] It depends on what `T` turns out to be at instantiation
- [ ] It is rejected until the template is instantiated

@why The parse is fixed when the template is parsed, long before any `T` exists,
so the standard picks a default and gives you a keyword to override it.

## Why do C++ compilers have a template instantiation depth limit?

- [x] Instantiation is Turing complete, so deciding validity can require a computation that never finishes
- [ ] The parser's stack is a fixed size
- [ ] Deeper instantiation produces code too large to link
- [ ] The standard specifies an exact maximum depth

@why It is the halting problem arriving from a new direction. The limit is a
compiler choosing to stop rather than run forever on a question with no general
answer.

## What does an abstract syntax tree drop that a parse tree keeps?

- [x] Productions that existed only for the parser, such as parentheses and most punctuation
- [ ] The operators, which move into a separate table
- [ ] Source positions, which are no longer needed after parsing
- [ ] Identifiers, which are replaced by symbol table indices

@why It keeps what carries meaning. Clang deliberately keeps more than that,
including parentheses and every source location, which is what makes
clang-format and clang-tidy possible.
