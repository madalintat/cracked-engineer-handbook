## Checking is the easy half

The definition of NP is about verification. Write `verify_assignment`, which
takes a formula in conjunctive normal form and a proposed assignment, and reports
whether every clause is satisfied.

Clauses are stored flat, terminated by 0. A positive number is a variable, a
negative one is its negation, and variables are numbered from 1.

@kind output
@concept A problem is in NP when a proposed answer can be checked in polynomial
time, and this function is what that sentence means.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A clause is satisfied when at least one of its literals is true. The
formula is satisfied when every clause is.
@diagnose assert verdict assert-failed
A check disagrees. The two quantifiers go in opposite directions: any literal
satisfies a clause, and every clause must be satisfied. The starter requires
every literal in a clause to be true, which is a different formula entirely.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after One pass over the formula, linear in its size, and it works whatever the
assignment came from. Finding the assignment is the other half, and nothing
about this function suggests how hard that is.

```starter
int verify_assignment(const int *cnf, int n, const unsigned char *val) {
    for (int i = 0; i < n; ) {
        while (cnf[i] != 0) {
            int l = cnf[i];
            if (l > 0 ? !val[l] : val[-l]) return 0;
            i++;
        }
        i++;
    }
    return 1;
}
```

```tests
#include <assert.h>
int verify_assignment(const int *, int, const unsigned char *);
int main(void) {
    /* (x1 or x2) and (not x1 or x3) */
    int f[] = {1, 2, 0, -1, 3, 0};
    unsigned char a1[] = {0, 1, 0, 1};   /* x1=1, x2=0, x3=1 */
    assert(verify_assignment(f, 6, a1) == 1);
    unsigned char a2[] = {0, 1, 0, 0};   /* x1=1, x3=0: second clause fails */
    assert(verify_assignment(f, 6, a2) == 0);
    unsigned char a3[] = {0, 0, 1, 0};   /* x2=1 satisfies first, x1=0 second */
    assert(verify_assignment(f, 6, a3) == 1);
    unsigned char a4[] = {0, 0, 0, 0};   /* first clause fails */
    assert(verify_assignment(f, 6, a4) == 0);
    return 0;
}
```

```solution
int verify_assignment(const int *cnf, int n, const unsigned char *val) {
    for (int i = 0; i < n; ) {
        int sat = 0;
        while (cnf[i] != 0) {
            int l = cnf[i];
            if (l > 0 ? val[l] : !val[-l]) sat = 1;
            i++;
        }
        i++;
        if (!sat) return 0;
    }
    return 1;
}
```

## Every assignment, counted

Write `brute_sat`, which tries every assignment of `nv` variables and returns the
number of assignments it examined before finding one that works, or the full
count if none does.

The step counts are exact, because the search order is fixed: assignment `m` sets
variable `i` to bit `i-1` of `m`.

@kind output
@concept An exhaustive search over n variables costs 2 to the n, and that number
stops being a quantity you can wait for somewhere around forty.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count every assignment you examine, including the one that succeeds.
@diagnose assert verdict assert-failed
A check disagrees. The count includes the successful assignment, and an
unsatisfiable formula costs the full 2 to the n. Starting the count at zero and
incrementing before the test gives the numbers the checks want.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Twenty variables is a million and it is instant. Fifty is a quadrillion
and it is not. The next exercise solves the same formulas with a method whose
counts are three orders of magnitude smaller at twenty variables.

```starter
#include <stdlib.h>
long brute_sat(const int *cnf, int n, int nv) {
    unsigned char val[32];
    long tried = 0;
    for (long m = 0; m < (1L << nv); m++) {
        for (int i = 1; i <= nv; i++) val[i] = (m >> (i - 1)) & 1;
        int ok = 1;
        for (int i = 0; i < n; ) {
            int sat = 0;
            while (cnf[i] != 0) {
                int l = cnf[i];
                if (l > 0 ? val[l] : !val[-l]) sat = 1;
                i++;
            }
            i++;
            if (!sat) { ok = 0; break; }
        }
        if (ok) return tried;
    }
    return tried;
}
```

```tests
#include <assert.h>
long brute_sat(const int *, int, int);
int main(void) {
    /* (x1) and (x2): only assignment 3 works, and it is the fourth tried. */
    int f1[] = {1, 0, 2, 0};
    assert(brute_sat(f1, 4, 2) == 4);
    /* (x1) and (not x1): unsatisfiable, so all four are tried. */
    int f2[] = {1, 0, -1, 0};
    assert(brute_sat(f2, 4, 2) == 4);
    /* (not x1) and (not x2): assignment 0 works, and it is the first. */
    int f3[] = {-1, 0, -2, 0};
    assert(brute_sat(f3, 4, 2) == 1);
    /* Three variables, only x1=1 x2=1 x3=1 works: assignment 7, the eighth. */
    int f4[] = {1, 0, 2, 0, 3, 0};
    assert(brute_sat(f4, 6, 3) == 8);
    return 0;
}
```

```solution
#include <stdlib.h>
long brute_sat(const int *cnf, int n, int nv) {
    unsigned char val[32];
    long tried = 0;
    for (long m = 0; m < (1L << nv); m++) {
        tried++;
        for (int i = 1; i <= nv; i++) val[i] = (m >> (i - 1)) & 1;
        int ok = 1;
        for (int i = 0; i < n; ) {
            int sat = 0;
            while (cnf[i] != 0) {
                int l = cnf[i];
                if (l > 0 ? val[l] : !val[-l]) sat = 1;
                i++;
            }
            i++;
            if (!sat) { ok = 0; break; }
        }
        if (ok) return tried;
    }
    return tried;
}
```

## The rule that does the work

Unit propagation is the whole reason solvers beat exhaustive search. If every
literal of a clause but one is already false, that last literal has no choice.

Write `propagate`, which repeatedly applies that rule until nothing changes, and
reports 0 if it reaches a clause with every literal false.

Values are 0 for false, 1 for true, and 2 for unassigned.

@kind output
@concept One forced assignment forces others, so a single decision can settle
many variables and prune an enormous part of the search.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Loop until a full pass changes nothing. A clause with one unassigned
literal and no true literal forces that literal.
@diagnose assert verdict assert-failed
A check disagrees. Two conditions have to be separated: a clause with no
unassigned literals and no true literal is a conflict, and a clause with exactly
one unassigned literal and no true literal is a forced assignment. A clause that
already has a true literal is neither, and skipping that test makes correct
formulas look like conflicts.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after On the pigeonhole formulas this rule alone takes the search from 1048576
assignments to 103 decisions at twenty variables. It is one page of code, it is
what every solver starts from, and everything else a real solver does is about
learning from the conflicts this rule finds.

```starter
int propagate(const int *cnf, int n, unsigned char *val) {
    int changed = 1;
    while (changed) {
        changed = 0;
        for (int i = 0; i < n; ) {
            int unassigned = 0, unit = 0;
            while (cnf[i] != 0) {
                int l = cnf[i];
                if (val[l > 0 ? l : -l] == 2) { unassigned++; unit = l; }
                i++;
            }
            i++;
            if (unassigned == 0) return 0;
            if (unassigned == 1) {
                val[unit > 0 ? unit : -unit] = unit > 0;
                changed = 1;
            }
        }
    }
    return 1;
}
```

```tests
#include <assert.h>
int propagate(const int *, int, unsigned char *);
int main(void) {
    /* (x1) forces x1 = 1, then (not x1 or x2) forces x2 = 1. */
    int f[] = {1, 0, -1, 2, 0};
    unsigned char v[] = {0, 2, 2};
    assert(propagate(f, 5, v) == 1);
    assert(v[1] == 1 && v[2] == 1);
    /* (x1) and (not x1) is a conflict. */
    int f2[] = {1, 0, -1, 0};
    unsigned char v2[] = {0, 2};
    assert(propagate(f2, 4, v2) == 0);
    /* A clause already satisfied is neither a conflict nor a unit. */
    int f3[] = {1, 2, 0};
    unsigned char v3[] = {0, 1, 0};
    assert(propagate(f3, 3, v3) == 1);
    /* Nothing forced: two unassigned literals. */
    int f4[] = {1, 2, 0};
    unsigned char v4[] = {0, 2, 2};
    assert(propagate(f4, 3, v4) == 1);
    assert(v4[1] == 2 && v4[2] == 2);
    return 0;
}
```

```solution
int propagate(const int *cnf, int n, unsigned char *val) {
    int changed = 1;
    while (changed) {
        changed = 0;
        for (int i = 0; i < n; ) {
            int unassigned = 0, unit = 0, sat = 0;
            while (cnf[i] != 0) {
                int l = cnf[i], v = val[l > 0 ? l : -l];
                if (v == 2) { unassigned++; unit = l; }
                else if (l > 0 ? v == 1 : v == 0) sat = 1;
                i++;
            }
            i++;
            if (sat) continue;
            if (unassigned == 0) return 0;
            if (unassigned == 1) {
                val[unit > 0 ? unit : -unit] = unit > 0;
                changed = 1;
            }
        }
    }
    return 1;
}
```

## Reduce it to something with a solver

The second plan. Rather than write an algorithm for your problem, translate it
into satisfiability and hand it over.

Write `encode_colouring`, which turns a graph colouring instance into clauses:
every vertex gets at least one colour, and no edge has both ends the same colour.
Variable for vertex `v` and colour `c` is `v * k + c + 1`.

Return the number of integers written, including the terminating zeroes.

@kind output
@concept Reduction is how a problem reaches a solver somebody else spent a
career on, and it is the option people most often fail to consider.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One clause per vertex with k positive literals, then two negative literals
per edge per colour.
@diagnose assert verdict assert-failed
A check disagrees on the length. Count what you emit: `nv` clauses of `k`
literals plus a zero, and for every edge, `k` clauses of two literals plus a
zero. The starter omits the edge constraints entirely, which encodes a problem
where every vertex may take any colour independently.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The encoding is the design decision. This one uses `nv` times `k`
variables and is the obvious choice; adding clauses that forbid a vertex holding
two colours at once changes nothing about which colourings are legal and can
change the solving time by orders of magnitude. Two correct encodings are not
equally good, and choosing between them is a real skill.

```starter
int encode_colouring(int nv, int k, const int *edges, int ne, int *out) {
    int n = 0;
    for (int v = 0; v < nv; v++) {
        for (int c = 0; c < k; c++) out[n++] = v * k + c + 1;
        out[n++] = 0;
    }
    (void)edges; (void)ne;
    return n;
}
```

```tests
#include <assert.h>
int encode_colouring(int, int, const int *, int, int *);
int main(void) {
    int out[256];
    /* Two vertices, one edge, two colours. */
    int e1[] = {0, 1};
    int n = encode_colouring(2, 2, e1, 1, out);
    /* 2 vertices * (2 literals + 0) = 6, then 1 edge * 2 colours * 3 = 6. */
    assert(n == 12);
    assert(out[0] == 1 && out[1] == 2 && out[2] == 0);
    assert(out[3] == 3 && out[4] == 4 && out[5] == 0);
    assert(out[6] == -1 && out[7] == -3 && out[8] == 0);
    assert(out[9] == -2 && out[10] == -4 && out[11] == 0);
    /* Three vertices, no edges, three colours: 3 * 4 = 12. */
    assert(encode_colouring(3, 3, e1, 0, out) == 12);
    return 0;
}
```

```solution
int encode_colouring(int nv, int k, const int *edges, int ne, int *out) {
    int n = 0;
    for (int v = 0; v < nv; v++) {
        for (int c = 0; c < k; c++) out[n++] = v * k + c + 1;
        out[n++] = 0;
    }
    for (int e = 0; e < ne; e++) {
        int a = edges[e * 2], b = edges[e * 2 + 1];
        for (int c = 0; c < k; c++) {
            out[n++] = -(a * k + c + 1);
            out[n++] = -(b * k + c + 1);
            out[n++] = 0;
        }
    }
    return n;
}
```

## Twice as bad is good enough

The first plan. Minimum vertex cover is NP-hard, and a greedy rule gives an
answer never worse than twice the best, in one pass.

Write `greedy_cover`: for each edge whose endpoints are both uncovered, add both
endpoints. Return the size of the cover.

@kind output
@concept An approximation with a proved factor is often worth more than an exact
answer that arrives too late, and this one is four lines.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Skip an edge if either end is already in the cover.
@diagnose assert verdict assert-failed
A check disagrees. Adding both endpoints is what makes the factor of two
provable: every edge you pick must be in the true optimum's cover somehow, and
you spent two vertices where it spent at least one. Adding only one endpoint is
a different algorithm with no such guarantee.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Never worse than twice the best, and the proof is one sentence: the edges
you picked share no vertices, so any cover needs at least one endpoint from each
of them, and you took two. A guarantee like that turns an intractable problem
into a decision about whether a factor of two matters.

```starter
int greedy_cover(const int *edges, int ne, int nv, unsigned char *in_cover) {
    int size = 0;
    for (int v = 0; v < nv; v++) in_cover[v] = 0;
    for (int e = 0; e < ne; e++) {
        int a = edges[e * 2], b = edges[e * 2 + 1];
        if (!in_cover[a] && !in_cover[b]) {
            in_cover[a] = 1;
            size++;
        }
    }
    return size;
}
```

```tests
#include <assert.h>
int greedy_cover(const int *, int, int, unsigned char *);
int main(void) {
    unsigned char c[8];
    /* A single edge: both ends go in. */
    int e1[] = {0, 1};
    assert(greedy_cover(e1, 1, 2, c) == 2);
    assert(c[0] == 1 && c[1] == 1);
    /* A path 0-1-2: the first edge covers 0 and 1, so 1-2 is already covered. */
    int e2[] = {0, 1, 1, 2};
    assert(greedy_cover(e2, 2, 3, c) == 2);
    assert(c[0] == 1 && c[1] == 1 && c[2] == 0);
    /* Two disjoint edges need four vertices; the optimum is two. */
    int e3[] = {0, 1, 2, 3};
    assert(greedy_cover(e3, 2, 4, c) == 4);
    /* A triangle: the first edge covers two, the rest are already covered. */
    int e4[] = {0, 1, 1, 2, 0, 2};
    assert(greedy_cover(e4, 3, 3, c) == 2);
    return 0;
}
```

```solution
int greedy_cover(const int *edges, int ne, int nv, unsigned char *in_cover) {
    int size = 0;
    for (int v = 0; v < nv; v++) in_cover[v] = 0;
    for (int e = 0; e < ne; e++) {
        int a = edges[e * 2], b = edges[e * 2 + 1];
        if (!in_cover[a] && !in_cover[b]) {
            in_cover[a] = 1;
            in_cover[b] = 1;
            size += 2;
        }
    }
    return size;
}
```

## The structure you already have

The third plan. Subset sum is NP-hard in general and easy when the target is
small, because the table you fill has one entry per reachable total rather than
one per subset.

Write `subset_sum`, which reports whether any subset of `n` values sums to
`target`, using a table of size `target + 1`.

@kind output
@concept Hardness is over all instances, and a parameter you control being small
is one of the commonest ways out of it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint For each value, walk the table downwards so a value is not used twice.
@diagnose assert verdict assert-failed
A check disagrees, and it will be a case where one value was counted twice.
Walking the table upwards lets the same item be reused, which answers a different
question. Walk from the target down to the value.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Work proportional to `n` times `target`, against 2 to the `n` for the
obvious search. That is not a polynomial algorithm, because the target's size in
bits is what counts as input length, and it is nonetheless the reason this
problem is routine whenever the numbers are small. Knowing which parameter your
instance keeps small is most of escaping a hardness result.

```starter
int subset_sum(const int *vals, int n, int target) {
    unsigned char can[1024] = {0};
    can[0] = 1;
    for (int i = 0; i < n; i++)
        for (int t = vals[i]; t <= target; t++)
            if (can[t - vals[i]]) can[t] = 1;
    return can[target];
}
```

```tests
#include <assert.h>
int subset_sum(const int *, int, int);
int main(void) {
    int v[] = {3, 34, 4, 12, 5, 2};
    assert(subset_sum(v, 6, 9) == 1);    /* 4 + 5 */
    assert(subset_sum(v, 6, 30) == 0);
    assert(subset_sum(v, 6, 0) == 1);    /* the empty subset */
    /* One value of 4: 8 needs it twice, which is not allowed. */
    int w[] = {4};
    assert(subset_sum(w, 1, 4) == 1);
    assert(subset_sum(w, 1, 8) == 0);
    int x[] = {2, 3};
    assert(subset_sum(x, 2, 5) == 1);
    assert(subset_sum(x, 2, 4) == 0);
    return 0;
}
```

```solution
int subset_sum(const int *vals, int n, int target) {
    unsigned char can[1024] = {0};
    can[0] = 1;
    for (int i = 0; i < n; i++)
        for (int t = target; t >= vals[i]; t--)
            if (can[t - vals[i]]) can[t] = 1;
    return can[target];
}
```

## The constant that decides it

Asymptotic cost says where an algorithm goes, not where it is. Write
`sort_hybrid`, which uses insertion sort below a threshold and merge sort above
it, and count the comparisons.

The counts are exact, so the crossover is visible in the numbers rather than
argued about.

@kind output
@concept A quadratic algorithm with a small constant beats a linearithmic one
below the crossover, which is why every serious sort in every standard library
is a hybrid.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Below the threshold, insertion sort and nothing else. Above it, split,
recurse on both halves, and merge.
@diagnose assert verdict assert-failed
A check disagrees on a comparison count. Count exactly one comparison per
element comparison: in insertion sort, each test of the element against the one
before it, and in the merge, each choice between the two heads.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The threshold in real libraries is somewhere between 8 and 32 elements
and it was chosen by measuring, not by analysis. Asymptotic reasoning cannot
produce that number, because it is entirely about the constants the notation
throws away.

```starter
static void ins(int *a, int lo, int hi, long *cmp) {
    for (int i = lo + 1; i < hi; i++) {
        int v = a[i], j = i - 1;
        while (j >= lo) { (*cmp)++; if (a[j] <= v) break; a[j + 1] = a[j]; j--; }
        a[j + 1] = v;
    }
}

long sort_hybrid(int *a, int n, int threshold) {
    long cmp = 0;
    ins(a, 0, n, &cmp);
    (void)threshold;
    return cmp;
}
```

```tests
#include <assert.h>
long sort_hybrid(int *, int, int);
int main(void) {
    /* Already sorted: insertion sort does one comparison per element. */
    int a[] = {1, 2, 3, 4};
    assert(sort_hybrid(a, 4, 16) == 3);
    assert(a[0] == 1 && a[3] == 4);
    /* Reversed, four elements, below the threshold: 1 + 2 + 3 = 6. */
    int b[] = {4, 3, 2, 1};
    assert(sort_hybrid(b, 4, 16) == 6);
    assert(b[0] == 1 && b[3] == 4);
    /* The same reversed input, now above the threshold, uses merge sort:
       two halves of 1 comparison each, then 2 to merge. */
    int c[] = {4, 3, 2, 1};
    assert(sort_hybrid(c, 4, 2) == 4);
    assert(c[0] == 1 && c[1] == 2 && c[2] == 3 && c[3] == 4);
    return 0;
}
```

```solution
static void ins(int *a, int lo, int hi, long *cmp) {
    for (int i = lo + 1; i < hi; i++) {
        int v = a[i], j = i - 1;
        while (j >= lo) { (*cmp)++; if (a[j] <= v) break; a[j + 1] = a[j]; j--; }
        a[j + 1] = v;
    }
}

static void ms(int *a, int lo, int hi, int t, long *cmp, int *tmp) {
    if (hi - lo <= t) { ins(a, lo, hi, cmp); return; }
    int mid = lo + (hi - lo) / 2;
    ms(a, lo, mid, t, cmp, tmp);
    ms(a, mid, hi, t, cmp, tmp);
    int i = lo, j = mid, k = lo;
    while (i < mid && j < hi) {
        (*cmp)++;
        tmp[k++] = (a[i] <= a[j]) ? a[i++] : a[j++];
    }
    while (i < mid) tmp[k++] = a[i++];
    while (j < hi) tmp[k++] = a[j++];
    for (int m = lo; m < hi; m++) a[m] = tmp[m];
}

long sort_hybrid(int *a, int n, int threshold) {
    long cmp = 0;
    int tmp[1024];
    ms(a, 0, n, threshold, &cmp, tmp);
    return cmp;
}
```

## Exponential, until you write it down

Memoisation turns a recursion that recomputes into one that does not, and the
difference is exponential rather than a constant factor.

Write `fib_memo`, which returns the nth Fibonacci number and counts how many
times it did real work. The naive version calls itself 2 to the n times; this one
calls itself once per distinct argument.

@kind output
@concept An exponential running time is often an exponential amount of
recomputation, which a table removes entirely.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Check the table first. Count a call only when the answer was not already
there.
@diagnose assert verdict assert-failed
A check disagrees on the work count. Every distinct argument the recursion
reaches is computed exactly once, and a lookup that finds a stored answer is not
work. For an n of 2 or more that comes to n plus 1; for 0 and 1 it is one,
because those return without recursing. The starter has no table at all and does
exponentially more.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after 41 units of work for n equal to 40, against about 300 million calls for
the version without a table. Nothing about the problem changed, and the search
space was never really that large: it only looked that way because the same
subproblem was being solved over and over.

```starter
static long work;
static long fib(int n) {
    work++;
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
}

long fib_memo(int n, long *calls) {
    work = 0;
    long r = fib(n);
    *calls = work;
    return r;
}
```

```tests
#include <assert.h>
long fib_memo(int, long *);
int main(void) {
    long calls;
    assert(fib_memo(0, &calls) == 0 && calls == 1);
    assert(fib_memo(1, &calls) == 1 && calls == 1);
    assert(fib_memo(10, &calls) == 55 && calls == 11);
    assert(fib_memo(40, &calls) == 102334155 && calls == 41);
    assert(fib_memo(80, &calls) == 23416728348467685L && calls == 81);
    return 0;
}
```

```solution
static long memo[128];
static unsigned char have[128];
static long work;

static long fib(int n) {
    if (have[n]) return memo[n];
    work++;
    long r = (n < 2) ? n : fib(n - 1) + fib(n - 2);
    memo[n] = r;
    have[n] = 1;
    return r;
}

long fib_memo(int n, long *calls) {
    for (int i = 0; i < 128; i++) have[i] = 0;
    work = 0;
    long r = fib(n);
    *calls = work;
    return r;
}
```
