## The node that can always be coloured

Write `simplifiable`, returning how many nodes of an interference graph can be
removed by the simplify step, given each node's degree and the number of
available registers.

A node with fewer neighbours than there are colours can always be coloured
later, whatever its neighbours get. This counts only the first round, before any
removal changes another node's degree.

@kind output
@concept The condition is strictly fewer, not fewer or equal, because a node
with exactly as many neighbours as there are colours can have every colour taken.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint With three colours, a node of degree three is not safe. Its neighbours
could hold all three.
@diagnose assert verdict assert-failed
A check disagrees. Degree equal to the number of registers is the case the rule
excludes, and including it is the off by one that makes an allocator produce an
uncolourable graph and then colour it anyway.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Removing these nodes lowers the degree of their neighbours, which is why
a real simplify step repeats until nothing is left to remove.

```starter
unsigned simplifiable(const unsigned *degree, unsigned n, unsigned k) {
    unsigned c = 0;
    for (unsigned i = 0; i < n; i++)
        if (degree[i] <= k) c++;
    return c;
}
```

```tests
#include <assert.h>
unsigned simplifiable(const unsigned *, unsigned, unsigned);
int main(void) {
    unsigned d[] = {0, 1, 2, 3, 4};
    assert(simplifiable(d, 5, 3) == 3);   /* degrees 0, 1, 2 */
    assert(simplifiable(d, 5, 1) == 1);   /* degree 0 only */
    assert(simplifiable(d, 5, 5) == 5);
    assert(simplifiable(d, 0, 3) == 0);
    { unsigned e[] = {3, 3, 3};
      assert(simplifiable(e, 3, 3) == 0); }
    return 0;
}
```

```solution
unsigned simplifiable(const unsigned *degree, unsigned n, unsigned k) {
    unsigned c = 0;
    for (unsigned i = 0; i < n; i++)
        if (degree[i] < k) c++;
    return c;
}
```

## Simplify, until nothing moves

Write `simplify_all`, returning how many nodes the simplify step removes in
total, given the graph as an adjacency matrix.

Removing a node lowers the degree of each of its neighbours, which can make them
removable in turn. Repeat until no node of degree below `k` is left. Return how
many were removed; anything left over is a candidate for spilling.

`adj` is `n` by `n`, row major, with `adj[i * n + j]` non-zero when `i` and `j`
interfere. It is symmetric and has no self edges.

@kind output
@concept The heuristic is cheap because removal is monotone: taking a node out
never makes another node harder to colour.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Recompute degrees over the nodes still present, and go round again
whenever something was removed.
@diagnose assert verdict assert-failed
A check disagrees. One pass over the nodes is not enough: a chain of four nodes
with two colours empties completely, because each removal exposes the next, and
a single pass finds only the ends.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Whatever is left when this stops is where a real allocator picks a victim
to spill, and then starts the whole thing again.

```starter
unsigned simplify_all(const char *adj, unsigned n, unsigned k) {
    unsigned removed = 0;
    for (unsigned i = 0; i < n; i++) {
        unsigned d = 0;
        for (unsigned j = 0; j < n; j++) d += adj[i * n + j] ? 1 : 0;
        if (d < k) removed++;
    }
    return removed;
}
```

```tests
#include <assert.h>
unsigned simplify_all(const char *, unsigned, unsigned);
int main(void) {
    /* A chain 0-1-2-3. With k = 2 the whole thing peels away. */
    { char a[16] = {0};
      a[0*4+1]=a[1*4+0]=1; a[1*4+2]=a[2*4+1]=1; a[2*4+3]=a[3*4+2]=1;
      assert(simplify_all(a, 4, 2) == 4); }
    /* A triangle. With k = 3 every degree is 2, so all three go. */
    { char a[9] = {0};
      a[0*3+1]=a[1*3+0]=1; a[1*3+2]=a[2*3+1]=1; a[0*3+2]=a[2*3+0]=1;
      assert(simplify_all(a, 3, 3) == 3); }
    /* The same triangle with two colours: nothing can be removed. */
    { char a[9] = {0};
      a[0*3+1]=a[1*3+0]=1; a[1*3+2]=a[2*3+1]=1; a[0*3+2]=a[2*3+0]=1;
      assert(simplify_all(a, 3, 2) == 0); }
    /* No edges at all. */
    { char a[9] = {0};
      assert(simplify_all(a, 3, 1) == 3); }
    return 0;
}
```

```solution
unsigned simplify_all(const char *adj, unsigned n, unsigned k) {
    char gone[32] = {0};
    if (n > sizeof gone) return 0;
    unsigned removed = 0;
    for (int changed = 1; changed; ) {
        changed = 0;
        for (unsigned i = 0; i < n; i++) {
            if (gone[i]) continue;
            unsigned d = 0;
            for (unsigned j = 0; j < n; j++)
                if (!gone[j] && adj[i * n + j]) d++;
            if (d < k) { gone[i] = 1; removed++; changed = 1; }
        }
    }
    return removed;
}
```

## Which value goes to memory

Write `spill_victim`, returning the index of the value a colouring allocator
should spill, given how many times each value is used and the loop depth of each
use site.

The cost of spilling a value is its use count weighted by loop depth, ten to the
power of the depth, divided by its degree in the interference graph. Spill the
lowest cost. On a tie, spill the lower index.

Every value here has a degree of at least one.

@kind output
@concept A use inside a loop is paid every iteration, so weighting by depth is
what stops the allocator spilling the one value the hot loop needs.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two uses at depth two cost far more than ten uses at depth zero. Compare
with multiplication rather than division to keep it in integers.
@diagnose assert verdict assert-failed
A check disagrees. Ignoring depth spills the value used twice inside a loop
rather than the one used ten times outside it, which is the decision that makes
the whole function slower.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Real heuristics add live range splitting, so that only the cold part of a
range goes to memory rather than all of it.

```starter
unsigned spill_victim(const unsigned *uses, const unsigned *depth,
                      const unsigned *degree, unsigned n) {
    (void)depth;
    unsigned best = 0;
    for (unsigned i = 1; i < n; i++)
        if (uses[i] * degree[best] < uses[best] * degree[i]) best = i;
    return best;
}
```

```tests
#include <assert.h>
unsigned spill_victim(const unsigned *, const unsigned *, const unsigned *,
                      unsigned);
int main(void) {
    /* Value 0 is used ten times outside any loop; value 1 twice at depth 2.
       Weighted, value 1 costs 200 and value 0 costs 10, so 0 is spilled. */
    { unsigned u[] = {10, 2}, d[] = {0, 2}, g[] = {1, 1};
      assert(spill_victim(u, d, g, 2) == 0); }
    /* Same uses, same depth: the higher degree is the cheaper spill. */
    { unsigned u[] = {4, 4}, d[] = {1, 1}, g[] = {1, 4};
      assert(spill_victim(u, d, g, 2) == 1); }
    /* A tie goes to the lower index. */
    { unsigned u[] = {3, 3}, d[] = {0, 0}, g[] = {2, 2};
      assert(spill_victim(u, d, g, 2) == 0); }
    { unsigned u[] = {1}, d[] = {3}, g[] = {5};
      assert(spill_victim(u, d, g, 1) == 0); }
    return 0;
}
```

```solution
static unsigned long weight(unsigned uses, unsigned depth) {
    unsigned long w = uses;
    for (unsigned i = 0; i < depth; i++) w *= 10;
    return w;
}

unsigned spill_victim(const unsigned *uses, const unsigned *depth,
                      const unsigned *degree, unsigned n) {
    unsigned best = 0;
    for (unsigned i = 1; i < n; i++) {
        unsigned long a = weight(uses[i], depth[i]) * degree[best];
        unsigned long b = weight(uses[best], depth[best]) * degree[i];
        if (a < b) best = i;
    }
    return best;
}
```

## The move that disappears

Write `can_coalesce`, deciding whether two nodes joined by a copy may be merged,
using the conservative test: the merged node is safe when it has fewer than `k`
neighbours of significant degree, where significant means degree at least `k`.

You are given how many neighbours of significant degree each node has, and how
many of those they share.

@kind output
@concept Coalescing is where register to register moves go, and the test has to
be conservative because a merge that makes the graph uncolourable costs a spill.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A shared neighbour is one neighbour of the merged node, not two. Subtract
the overlap before comparing.
@diagnose assert verdict assert-failed
A check disagrees. Adding the two counts double counts every neighbour the two
nodes share, which refuses merges that are perfectly safe and leaves moves in
the output that should have gone.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A `mov` you never see in the assembly was usually removed here rather
than by any peephole pass.

```starter
int can_coalesce(unsigned sig_a, unsigned sig_b, unsigned shared, unsigned k) {
    (void)shared;
    return sig_a + sig_b < k;
}
```

```tests
#include <assert.h>
int can_coalesce(unsigned, unsigned, unsigned, unsigned);
int main(void) {
    /* Two significant neighbours each, both shared: two in the merge. */
    assert(can_coalesce(2, 2, 2, 3) == 1);
    /* Nothing shared: four in the merge, which is not fewer than three. */
    assert(can_coalesce(2, 2, 0, 3) == 0);
    assert(can_coalesce(0, 0, 0, 1) == 1);
    assert(can_coalesce(1, 1, 0, 2) == 0);
    assert(can_coalesce(3, 3, 3, 4) == 1);
    return 0;
}
```

```solution
int can_coalesce(unsigned sig_a, unsigned sig_b, unsigned shared, unsigned k) {
    return sig_a + sig_b - shared < k;
}
```

## Live ranges that cannot share

Write `interferes`, deciding whether two live ranges overlap, given each as a
half open interval of instruction numbers.

A range covers `[start, end)`. Two ranges interfere when they share at least one
instruction. A range that ends exactly where another begins does not interfere,
which is what lets a value die into the register the next one is about to use.

@kind output
@concept An edge in the interference graph is exactly this question, asked for
every pair, and the half open convention is what makes the common case free.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two intervals overlap when each one starts before the other ends.
@diagnose assert verdict assert-failed
A check disagrees. Touching ranges do not interfere. Treating them as if they
did adds an edge for every value that dies exactly where the next is defined,
which is most of them, and makes the graph far harder to colour than it is.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A linear scan allocator never builds the graph at all: it sorts the
ranges by start point and sweeps, which is much faster and slightly worse, and
is why compilers that run inside a running program use it.

```starter
int interferes(unsigned a_start, unsigned a_end,
               unsigned b_start, unsigned b_end) {
    (void)a_end; (void)b_end;
    return a_start == b_start;
}
```

```tests
#include <assert.h>
int interferes(unsigned, unsigned, unsigned, unsigned);
int main(void) {
    assert(interferes(0, 5, 3, 9) == 1);   /* overlapping */
    assert(interferes(3, 9, 0, 5) == 1);   /* the same, other order */
    assert(interferes(0, 3, 3, 6) == 0);   /* touching */
    assert(interferes(3, 6, 0, 3) == 0);
    assert(interferes(0, 9, 3, 4) == 1);   /* one inside the other */
    assert(interferes(0, 2, 7, 9) == 0);   /* disjoint */
    return 0;
}
```

```solution
int interferes(unsigned a_start, unsigned a_end,
               unsigned b_start, unsigned b_end) {
    return a_start < b_end && b_start < a_end;
}
```

## Selecting the cheapest cover

Write `mul_cost`, returning how many instructions a back end needs to multiply
by a small constant, using only the address unit and shifts.

One instruction covers a multiply by 1, 2, 3, 4, 5, 8 or 9, because the address
unit computes a base plus an index scaled by 1, 2, 4 or 8. A power of two is one
shift. Anything else needs two. A multiply by 0 needs one instruction to produce
zero.

@kind output
@concept The instruction you read is the output of a cost model over patterns,
not a translation of the operator you wrote.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The one instruction cases are the powers of two, plus the ones that are a
power of two plus one.
@diagnose assert verdict assert-failed
A check disagrees. Five is one instruction, because the address unit can scale
by four and add the base. Seven is not, because there is no scale of six.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Ask a compiler for `x * 5` and it emits an address calculation that
nobody dereferences. Change the constant to 7 and the shape of the answer
changes, for exactly this reason.

```starter
unsigned mul_cost(unsigned c) {
    return c <= 1 ? 1 : 2;
}
```

```tests
#include <assert.h>
unsigned mul_cost(unsigned);
int main(void) {
    assert(mul_cost(0) == 1);
    assert(mul_cost(1) == 1);
    assert(mul_cost(2) == 1);
    assert(mul_cost(3) == 1);
    assert(mul_cost(4) == 1);
    assert(mul_cost(5) == 1);
    assert(mul_cost(8) == 1);
    assert(mul_cost(9) == 1);
    assert(mul_cost(6) == 2);
    assert(mul_cost(7) == 2);
    assert(mul_cost(10) == 2);
    assert(mul_cost(11) == 2);
    return 0;
}
```

```solution
unsigned mul_cost(unsigned c) {
    switch (c) {
        case 0: case 1: case 2: case 3:
        case 4: case 5: case 8: case 9:
            return 1;
        default:
            return 2;
    }
}
```

## What the level lets the compiler believe

Write `reload_needed`, deciding whether a compiler must reload a value from
memory after a store through a pointer of a different type, given the
optimisation level and whether strict aliasing was turned off.

Strict aliasing is on from level 2 upwards, unless it was explicitly disabled.
When it is on, the two pointers are assumed not to refer to the same object, so
the value already in a register may be reused and no reload is needed.

@kind output
@concept An optimisation level does not change what the program means. It
changes how much of what you already promised the compiler is allowed to use.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The flag only matters at the levels where the assumption is on in the
first place.
@diagnose assert verdict assert-failed
A check disagrees. At level 0 the value is always reloaded, whatever the flag
says, and at level 2 the flag is the whole difference. Reading the level alone
gets the first case right and the second wrong.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The same program prints 0 at `-O0`, 1 at `-O2`, and 0 again at
`-O2 -fno-strict-aliasing`. The middle line is not a bug: it is a promise being
kept.

```starter
int reload_needed(unsigned level, int no_strict_aliasing) {
    (void)no_strict_aliasing;
    return level < 2;
}
```

```tests
#include <assert.h>
int reload_needed(unsigned, int);
int main(void) {
    assert(reload_needed(0, 0) == 1);
    assert(reload_needed(1, 0) == 1);
    assert(reload_needed(2, 0) == 0);
    assert(reload_needed(3, 0) == 0);
    assert(reload_needed(2, 1) == 1);   /* the promise withdrawn */
    assert(reload_needed(0, 1) == 1);
    return 0;
}
```

```solution
int reload_needed(unsigned level, int no_strict_aliasing) {
    if (no_strict_aliasing) return 1;
    return level < 2;
}
```

## The last sweep

Write `peephole`, returning how many instructions are left after a peephole pass
removes moves whose source and destination are the same register.

Each instruction is given as an opcode and two registers. Opcode 0 is a move,
from `src` to `dst`. Any other opcode is left alone whatever its registers are.

@kind output
@concept It is the last chance to remove something the earlier passes could not
see, and it is local by construction.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only a move counts. An add whose operands happen to be the same register
is doing arithmetic.
@diagnose assert verdict assert-failed
A check disagrees. Removing every instruction whose two registers match deletes
an add of a register to itself, which is a doubling, and the program stops being
the same program.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Most redundant moves are gone before this pass ever runs, removed by
coalescing during register allocation. What reaches here is what the allocator
could not merge.

```starter
unsigned peephole(const int *op, const int *dst, const int *src, unsigned n) {
    (void)op;
    unsigned kept = 0;
    for (unsigned i = 0; i < n; i++)
        if (dst[i] != src[i]) kept++;
    return kept;
}
```

```tests
#include <assert.h>
unsigned peephole(const int *, const int *, const int *, unsigned);
int main(void) {
    /* mov a,a  mov a,b  add c,c */
    { int op[] = {0, 0, 1}, d[] = {0, 0, 2}, s[] = {0, 1, 2};
      assert(peephole(op, d, s, 3) == 2); }
    /* nothing to remove */
    { int op[] = {0, 1}, d[] = {0, 1}, s[] = {1, 1};
      assert(peephole(op, d, s, 2) == 2); }
    /* all self moves */
    { int op[] = {0, 0}, d[] = {3, 4}, s[] = {3, 4};
      assert(peephole(op, d, s, 2) == 0); }
    { int op[] = {2}, d[] = {1}, s[] = {1};
      assert(peephole(op, d, s, 1) == 1); }
    return 0;
}
```

```solution
unsigned peephole(const int *op, const int *dst, const int *src, unsigned n) {
    unsigned kept = 0;
    for (unsigned i = 0; i < n; i++)
        if (!(op[i] == 0 && dst[i] == src[i])) kept++;
    return kept;
}
```
