## A machine with no memory

Write `dfa_run`, which walks a transition table one character at a time and
reports whether it ends in an accepting state.

The table is flat: the next state for `(state, symbol)` is at `table[state *
nsym + symbol]`. A symbol is the character minus `'a'`. A negative entry means
there is no transition and the string is rejected.

@kind output
@concept A finite automaton is a loop and a table lookup, which is why lexing
costs about as much as reading the input.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One pass, one lookup per character, then check the final state.
@diagnose assert verdict assert-failed
A check disagrees. Two things have to be right: a negative entry rejects
immediately rather than continuing from a nonsense state, and acceptance is
decided after the last character rather than at any point during the walk.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after No allocation, no backtracking, and one array access per character. This
is what a generated lexer is underneath, and the reason a compiler's first phase
is never the slow one.

```starter
int dfa_run(const int *table, int nsym, const unsigned char *accept,
            const char *s) {
    int st = 0;
    for (const char *p = s; *p; p++) {
        st = table[st * nsym + (*p - 'a')];
    }
    return 1;
}
```

```tests
#include <assert.h>
int dfa_run(const int *, int, const unsigned char *, const char *);
int main(void) {
    /* Accepts strings over {a,b} with an even number of b's. */
    int t[] = { 0, 1,
                1, 0 };
    unsigned char acc[] = { 1, 0 };
    assert(dfa_run(t, 2, acc, "") == 1);
    assert(dfa_run(t, 2, acc, "a") == 1);
    assert(dfa_run(t, 2, acc, "b") == 0);
    assert(dfa_run(t, 2, acc, "bb") == 1);
    assert(dfa_run(t, 2, acc, "abab") == 1);
    assert(dfa_run(t, 2, acc, "abb") == 1);
    assert(dfa_run(t, 2, acc, "abbb") == 0);
    /* A dead transition rejects rather than walking off the table. */
    int t2[] = { 1, -1,
                 1, -1 };
    unsigned char acc2[] = { 0, 1 };
    assert(dfa_run(t2, 2, acc2, "aaa") == 1);
    assert(dfa_run(t2, 2, acc2, "aab") == 0);
    return 0;
}
```

```solution
int dfa_run(const int *table, int nsym, const unsigned char *accept,
            const char *s) {
    int st = 0;
    for (const char *p = s; *p; p++) {
        st = table[st * nsym + (*p - 'a')];
        if (st < 0) return 0;
    }
    return accept[st] != 0;
}
```

## Counting is what it cannot do

Write `count_ab`, which accepts exactly the strings of `n` letter a's followed by
`n` letter b's, for any `n` including zero.

You will use a counter. The point of the exercise is the last two checks, which
are the strings a finite automaton with a fixed number of states gets wrong.

@kind output
@concept Recognising equal counts needs unbounded storage, so this language is
outside the regular class no matter how many states you are given.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count the leading a's, then require exactly that many b's and nothing
after them.
@diagnose assert verdict assert-failed
A check disagrees. Three conditions: every a comes before every b, the counts
match exactly, and nothing follows the b's. The starter checks only that the
string is made of a's and then b's.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Your counter is the memory a finite automaton does not have. Give one
`k` states and it can only distinguish counts up to about `k`, and the pumping
lemma turns that into a proof rather than a suspicion.

```starter
int count_ab(const char *s) {
    const char *p = s;
    while (*p == 'a') p++;
    while (*p == 'b') p++;
    return *p == '\0';
}
```

```tests
#include <assert.h>
int count_ab(const char *);
int main(void) {
    assert(count_ab("") == 1);
    assert(count_ab("ab") == 1);
    assert(count_ab("aabb") == 1);
    assert(count_ab("aaabbb") == 1);
    assert(count_ab("ba") == 0);
    assert(count_ab("abab") == 0);
    /* Right shape, wrong counts. A regular machine cannot tell these apart. */
    assert(count_ab("aab") == 0);
    assert(count_ab("abb") == 0);
    return 0;
}
```

```solution
int count_ab(const char *s) {
    long a = 0, b = 0;
    const char *p = s;
    while (*p == 'a') { a++; p++; }
    while (*p == 'b') { b++; p++; }
    return *p == '\0' && a == b;
}
```

## One stack, and nesting becomes possible

Write `wellformed`, which checks that three kinds of bracket are correctly
nested. A closing bracket must match the most recently opened one.

A counter is not enough here, because the kinds must match as well as the
counts. That is what the stack is for.

@kind output
@concept A stack's discipline is exactly nesting's discipline, which is why a
parser needs one and a lexer does not.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Push the opener, and on a closer compare against the top before popping.
@diagnose assert verdict assert-failed
A check disagrees, and it will be a string where the counts are right and the
kinds are crossed, like `([)]`. Counting brackets of each kind separately
accepts that string; a stack rejects it, because the top of the stack when the
`)` arrives is a `[`.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Three counters would accept `([)]`. One stack does not, and the reason is
that a stack records order and three counters record only totals. That
difference is the whole gap between the first and second rungs of the hierarchy.

```starter
int wellformed(const char *s) {
    int paren = 0, square = 0, curly = 0;
    for (const char *p = s; *p; p++) {
        switch (*p) {
        case '(': paren++;  break;
        case ')': paren--;  break;
        case '[': square++; break;
        case ']': square--; break;
        case '{': curly++;  break;
        case '}': curly--;  break;
        }
        if (paren < 0 || square < 0 || curly < 0) return 0;
    }
    return paren == 0 && square == 0 && curly == 0;
}
```

```tests
#include <assert.h>
int wellformed(const char *);
int main(void) {
    assert(wellformed("") == 1);
    assert(wellformed("()") == 1);
    assert(wellformed("([]{})") == 1);
    assert(wellformed("{[()]}") == 1);
    assert(wellformed("(") == 0);
    assert(wellformed(")(") == 0);
    /* Counts balance, kinds cross. This is what a stack is for. */
    assert(wellformed("([)]") == 0);
    assert(wellformed("{(})") == 0);
    return 0;
}
```

```solution
int wellformed(const char *s) {
    char st[256];
    int sp = 0;
    for (const char *p = s; *p; p++) {
        char c = *p;
        if (c == '(' || c == '[' || c == '{') {
            if (sp == 256) return 0;
            st[sp++] = c;
        } else if (c == ')' || c == ']' || c == '}') {
            if (sp == 0) return 0;
            char open = st[--sp];
            if ((c == ')' && open != '(') ||
                (c == ']' && open != '[') ||
                (c == '}' && open != '{')) return 0;
        }
    }
    return sp == 0;
}
```

## Several states at once

An automaton that can be in more than one state at a time is how Thompson's
construction matches without guessing. Write `nfa_run`, which tracks a set of
current states as a bitmask.

Each entry of the table is itself a bitmask of the states reachable from
`(state, symbol)`. Accept if any current state is accepting after the last
character.

@kind output
@concept Advancing every possibility at once costs work proportional to the
machine's size per character and never backtracks, because nothing was guessed.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The new set is the union of the transitions from every state in the old
set.
@diagnose assert verdict assert-failed
A check disagrees. Build the next mask by taking the union over every state that
is currently set, rather than following only the lowest one. Following a single
state is a guess, and a guess is what backtracking exists to undo.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after At most one pass over the states per character, so the cost is the input
length times the machine size. This bound holds for every pattern and every
input, which is what the next exercise does not have.

```starter
int nfa_run(const unsigned *table, int nsym, unsigned accept, const char *s) {
    unsigned cur = 1u;
    for (const char *p = s; *p; p++) {
        int sym = *p - 'a';
        cur = table[0 * nsym + sym];
    }
    return (cur & accept) != 0;
}
```

```tests
#include <assert.h>
int nfa_run(const unsigned *, int, unsigned, const char *);
int main(void) {
    /* Matches any string over {a,b} ending in "ab". State 0 loops on both
       and on 'a' also reaches 1; state 1 on 'b' reaches the accepting 2. */
    unsigned t[] = { 0x3u, 0x1u,
                     0x0u, 0x4u,
                     0x0u, 0x0u };
    assert(nfa_run(t, 2, 0x4u, "ab") == 1);
    assert(nfa_run(t, 2, 0x4u, "aab") == 1);
    assert(nfa_run(t, 2, 0x4u, "bbab") == 1);
    assert(nfa_run(t, 2, 0x4u, "ba") == 0);
    assert(nfa_run(t, 2, 0x4u, "abb") == 0);
    assert(nfa_run(t, 2, 0x4u, "a") == 0);
    assert(nfa_run(t, 2, 0x4u, "b") == 0);
    assert(nfa_run(t, 2, 0x4u, "") == 0);
    return 0;
}
```

```solution
int nfa_run(const unsigned *table, int nsym, unsigned accept, const char *s) {
    unsigned cur = 1u;
    for (const char *p = s; *p; p++) {
        int sym = *p - 'a';
        unsigned next = 0u;
        for (int st = 0; st < 32; st++)
            if (cur & (1u << st)) next |= table[st * nsym + sym];
        cur = next;
        if (cur == 0u) return 0;
    }
    return (cur & accept) != 0;
}
```

## The matcher that explodes

Write `bt_match`, a backtracking matcher for a pattern of two item kinds: a
literal `a`, and an optional `a`. It counts its own recursive calls into
`*steps`.

Then read the last check, which is the measurement this unit is named after.

@kind output
@concept Backtracking is a search rather than an automaton, and on a pattern
with many ways to succeed it explores an exponential number of them.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint An optional item tries taking the character first, and falls back to
skipping it. A literal must match or fail.
@diagnose assert verdict assert-failed
A check disagrees. Count every entry to the function, including the ones that
fail immediately, and make sure the optional case really tries both branches:
taking the character, and if that whole rest of the match fails, skipping it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after 234881023 recursive calls to match twenty-four characters against a
pattern that fits on one line, and the answer is yes, it matches. On 2 July 2019
this class of behaviour took Cloudflare's network down for about half an hour.
The automaton in the previous exercise does the same job in work proportional to
the input times the pattern, and refuses to implement backreferences in exchange.

```starter
unsigned long long bt_match(const int *pat, int np, const char *s, int ns,
                            unsigned long long *steps) {
    (*steps)++;
    if (np == 0) return ns == 0;
    if (ns > 0 && s[0] == 'a')
        return bt_match(pat + 1, np - 1, s + 1, ns - 1, steps);
    return 0;
}
```

```tests
#include <assert.h>
#include <string.h>
unsigned long long bt_match(const int *, int, const char *, int,
                            unsigned long long *);

static unsigned long long run(int n, int *matched) {
    int pat[80];
    int np = 0;
    for (int i = 0; i < n; i++) pat[np++] = 1;   /* a? */
    for (int i = 0; i < n; i++) pat[np++] = 0;   /* a  */
    char s[64];
    memset(s, 'a', (size_t)n);
    s[n] = '\0';
    unsigned long long steps = 0;
    *matched = (int)bt_match(pat, np, s, n, &steps);
    return steps;
}

int main(void) {
    int m;
    /* A literal that cannot match still costs one call. */
    int lit[] = {0};
    unsigned long long st = 0;
    assert(bt_match(lit, 1, "", 0, &st) == 0 && st == 1);
    /* An optional item can skip. */
    int opt[] = {1};
    st = 0;
    assert(bt_match(opt, 1, "", 0, &st) == 1);
    assert(run(5, &m) == 143 && m == 1);
    assert(run(10, &m) == 7167 && m == 1);
    assert(run(15, &m) == 311295 && m == 1);
    assert(run(20, &m) == 12582911 && m == 1);
    assert(run(24, &m) == 234881023 && m == 1);
    return 0;
}
```

```solution
unsigned long long bt_match(const int *pat, int np, const char *s, int ns,
                            unsigned long long *steps) {
    (*steps)++;
    if (np == 0) return ns == 0;
    if (pat[0] == 1) {
        if (ns > 0 && s[0] == 'a' &&
            bt_match(pat + 1, np - 1, s + 1, ns - 1, steps)) return 1;
        return bt_match(pat + 1, np - 1, s, ns, steps);
    }
    if (ns > 0 && s[0] == 'a')
        return bt_match(pat + 1, np - 1, s + 1, ns - 1, steps);
    return 0;
}
```

## Determinising

Write `subset_step`, one step of the subset construction: given a set of states
as a bitmask, produce the set reachable on one symbol.

This is the operation that turns a machine which can be in several states at
once into one that is always in exactly one, at the cost of having as many
states as there are subsets.

@kind output
@concept A deterministic state is a set of nondeterministic ones, which is why
the construction can produce exponentially many of them.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Union the transitions of every state in the input set. An empty set stays
empty.
@diagnose assert verdict assert-failed
A check disagrees. Every bit that is set in the input contributes its
transitions, and the empty set has no contributors, so it maps to the empty set
rather than to state 0.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Each distinct set you reach becomes one state of the deterministic
machine, and there are 2 to the number of states of them in the worst case. A
lexer generator does this once at build time. A library given a pattern at run
time builds these states lazily and throws the cache away when it grows, so a
pattern that would have exploded costs speed rather than availability.

```starter
unsigned subset_step(const unsigned *table, int nsym, unsigned set, int sym) {
    (void)nsym;
    return table[sym];
}
```

```tests
#include <assert.h>
unsigned subset_step(const unsigned *, int, unsigned, int);
int main(void) {
    /* Three states, two symbols. */
    unsigned t[] = { 0x3u, 0x0u,     /* 0 -a-> {0,1}   0 -b-> {}    */
                     0x4u, 0x1u,     /* 1 -a-> {2}     1 -b-> {0}   */
                     0x0u, 0x6u };   /* 2 -a-> {}      2 -b-> {1,2} */
    assert(subset_step(t, 2, 0x1u, 0) == 0x3u);
    assert(subset_step(t, 2, 0x1u, 1) == 0x0u);
    assert(subset_step(t, 2, 0x3u, 0) == 0x7u);
    assert(subset_step(t, 2, 0x3u, 1) == 0x1u);
    assert(subset_step(t, 2, 0x6u, 1) == 0x7u);
    assert(subset_step(t, 2, 0x0u, 0) == 0x0u);
    assert(subset_step(t, 2, 0x0u, 1) == 0x0u);
    return 0;
}
```

```solution
unsigned subset_step(const unsigned *table, int nsym, unsigned set, int sym) {
    unsigned out = 0u;
    for (int st = 0; st < 32; st++)
        if (set & (1u << st)) out |= table[st * nsym + sym];
    return out;
}
```

## The feature that leaves the class

Write `backref`, which matches a string of the form `xx`, meaning some non-empty
string followed by an exact copy of itself.

No finite automaton recognises this language, and no regular expression in the
original sense describes it. It needs the thing a backtracking engine calls a
backreference.

@kind output
@concept A pattern that refers back to what it already matched is outside the
regular languages, which is what the linear-time engines give up.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The string must have even length, and the two halves must be equal.
@diagnose assert verdict assert-failed
A check disagrees. Two conditions and both are needed: the length has to be even
and non-zero, and the first half has to equal the second character by character.
Checking only that some character repeats accepts strings like `aba`.
@diagnose compile verdict compile-error
Read the line the compiler names. `strlen` needs `<string.h>`.
@after A pumping argument shows no finite automaton does this, so an engine that
promises linear time cannot offer it. That is the trade in one function: RE2
refuses backreferences and guarantees a bound, and the engines that offer them
guarantee nothing.

```starter
#include <string.h>
int backref(const char *s) {
    size_t n = strlen(s);
    return n > 0 && n % 2 == 0;
}
```

```tests
#include <assert.h>
int backref(const char *);
int main(void) {
    assert(backref("abab") == 1);
    assert(backref("aa") == 1);
    assert(backref("xyzxyz") == 1);
    assert(backref("") == 0);
    assert(backref("a") == 0);
    assert(backref("aba") == 0);
    /* Even length, halves differ. */
    assert(backref("abba") == 0);
    assert(backref("abcd") == 0);
    return 0;
}
```

```solution
#include <string.h>
int backref(const char *s) {
    size_t n = strlen(s);
    if (n == 0 || n % 2 != 0) return 0;
    return memcmp(s, s + n / 2, n / 2) == 0;
}
```

## Longest match wins

A lexer does not stop at the first accepting state. It keeps going and remembers
the last position where it was accepting, so that `<=` lexes as one token rather
than as `<` followed by `=`.

Write `longest_match`, which runs a table from the start of the string and
returns the length of the longest accepted prefix, or 0 if there is none.

@kind output
@concept The maximal munch rule is a property of the driver rather than of the
automaton, and it is why keyword and identifier patterns can overlap.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Remember the best length seen so far and carry on walking until the
machine dies or the string ends.
@diagnose assert verdict assert-failed
A check disagrees. Returning as soon as the machine is in an accepting state
gives the shortest match, not the longest. Record the position and keep going;
the answer is the last accepting position reached, not the first.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This one rule decides that `<=` is one token, that `intx` is an
identifier rather than a keyword followed by a name, and that `1.5` is a number
rather than `1` then `.5`. It is four lines, and every lexer you have used has
them.

```starter
int longest_match(const int *table, int nsym, const unsigned char *accept,
                  const char *s) {
    int st = 0;
    for (int i = 0; s[i]; i++) {
        if (accept[st]) return i;
        st = table[st * nsym + (s[i] - 'a')];
        if (st < 0) return 0;
    }
    return 0;
}
```

```tests
#include <assert.h>
int longest_match(const int *, int, const unsigned char *, const char *);
int main(void) {
    /* Accepts "a", "aa" and "aaa" but not "aaaa". Symbol 0 is 'a', 1 is 'b'. */
    int t[] = {  1, -1,
                 2, -1,
                 3, -1,
                -1, -1 };
    unsigned char acc[] = { 0, 1, 1, 1 };
    assert(longest_match(t, 2, acc, "a") == 1);
    assert(longest_match(t, 2, acc, "aa") == 2);
    assert(longest_match(t, 2, acc, "aaa") == 3);
    assert(longest_match(t, 2, acc, "aaaa") == 3);
    assert(longest_match(t, 2, acc, "aab") == 2);
    assert(longest_match(t, 2, acc, "b") == 0);
    assert(longest_match(t, 2, acc, "") == 0);
    return 0;
}
```

```solution
int longest_match(const int *table, int nsym, const unsigned char *accept,
                  const char *s) {
    int st = 0, best = 0;
    for (int i = 0; ; i++) {
        if (st >= 0 && accept[st]) best = i;
        if (!s[i]) break;
        st = table[st * nsym + (s[i] - 'a')];
        if (st < 0) break;
    }
    return best;
}
```
