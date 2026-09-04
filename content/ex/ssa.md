## One name per definition

Write `version_at_use`, returning which SSA name a use refers to, given how many
assignments to that variable appear before the use in a straight line of code.

Names are numbered from 1 at the first assignment. Return 0 when the variable
has not been assigned yet, which is a use of an undefined value.

@kind output
@concept A name is a definition, so finding the reaching definition is reading
the name rather than searching backwards for it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint In a straight line there is no choice to make. The use sees the most
recent assignment, and the names count from one.
@diagnose assert verdict assert-failed
A check disagrees. After three assignments the live name is `x3`, not `x1` and
not `x4`. Numbering from zero gives an answer that collides with the case where
nothing has been assigned at all.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after In real IR the name carries the definition with it, which is why reaching
definitions stops being a dataflow problem in SSA and becomes a dereference.

```starter
unsigned version_at_use(unsigned assignments_before) {
    return assignments_before ? 1 : 0;
}
```

```tests
#include <assert.h>
unsigned version_at_use(unsigned);
int main(void) {
    assert(version_at_use(0) == 0);
    assert(version_at_use(1) == 1);
    assert(version_at_use(2) == 2);
    assert(version_at_use(3) == 3);
    assert(version_at_use(17) == 17);
    return 0;
}
```

```solution
unsigned version_at_use(unsigned assignments_before) {
    return assignments_before;
}
```

## Where a phi is needed

Write `needs_phi`, deciding whether a join block needs a phi node for a variable,
given how many predecessors the block has and how many distinct definitions of
that variable reach it.

A phi is needed when more than one distinct definition arrives. One definition
arriving along several edges is still one value, and a block with a single
predecessor never needs one.

@kind output
@concept The dominance condition is about distinct values arriving, not about
the shape of the control flow graph, which is why a join can need no phi at all.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count values, not edges. Two edges carrying the same definition need
nothing.
@diagnose assert verdict assert-failed
A check disagrees. Inserting a phi at every join with two predecessors puts one
where both arms assigned nothing, which costs an instruction and buys no
information. The question is how many distinct definitions arrive.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Real construction computes the dominance frontier to answer this for
every definition at once, and the answer it gives for a single block is exactly
this rule.

```starter
int needs_phi(unsigned predecessors, unsigned distinct_defs) {
    (void)distinct_defs;
    return predecessors > 1;
}
```

```tests
#include <assert.h>
int needs_phi(unsigned, unsigned);
int main(void) {
    assert(needs_phi(1, 1) == 0);   /* straight line */
    assert(needs_phi(2, 1) == 0);   /* both arms carry the same value */
    assert(needs_phi(2, 2) == 1);   /* the classic if-else */
    assert(needs_phi(3, 2) == 1);
    assert(needs_phi(2, 0) == 0);   /* nothing defined on either arm */
    return 0;
}
```

```solution
int needs_phi(unsigned predecessors, unsigned distinct_defs) {
    (void)predecessors;
    return distinct_defs > 1;
}
```

## Dominance, from an immediate dominator array

Write `dominates`, deciding whether block `a` dominates block `b`, given the
immediate dominator of every block.

Block 0 is the entry and its immediate dominator is itself. A block dominates
itself. Otherwise walk up from `b` through immediate dominators and see whether
`a` is on the way.

@kind output
@concept Dominance is what makes SSA construction decidable, and the whole
relation is recoverable from one parent pointer per block.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Walk from `b` upwards. Stop at the entry, whose immediate dominator is
itself, or the walk never ends.
@diagnose assert verdict assert-failed
A check disagrees. Every block dominates itself, and the entry dominates
everything. A walk that does not stop at the entry either loops or reports the
wrong answer for the entry.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The dominator tree is computed once and reused by most of the middle end,
which is why a pass that only reorders instructions inside a block does not
force it to be rebuilt.

```starter
int dominates(const unsigned *idom, unsigned a, unsigned b) {
    (void)idom;
    return a == b;
}
```

```tests
#include <assert.h>
int dominates(const unsigned *, unsigned, unsigned);
int main(void) {
    /* 0 -> 1 -> 2, and 0 -> 3 */
    unsigned idom[] = {0, 0, 1, 0};
    assert(dominates(idom, 0, 0) == 1);
    assert(dominates(idom, 0, 3) == 1);
    assert(dominates(idom, 1, 2) == 1);
    assert(dominates(idom, 2, 2) == 1);
    assert(dominates(idom, 2, 1) == 0);
    assert(dominates(idom, 1, 3) == 0);
    assert(dominates(idom, 3, 0) == 0);
    return 0;
}
```

```solution
int dominates(const unsigned *idom, unsigned a, unsigned b) {
    for (;;) {
        if (a == b) return 1;
        if (b == 0) return 0;
        b = idom[b];
    }
}
```

## The sweep that removes dead code

Write `live_defs`, returning how many definitions survive dead code elimination,
given a use count for each definition and, for each one, which definition it
uses.

A definition is dead when nothing uses it. Removing it removes its own uses, so
a definition that was only used by dead code becomes dead in turn. Keep going
until nothing changes.

`uses[i]` is how many live things currently use definition `i`. `operand[i]` is
the definition that `i` reads, or -1 if it reads nothing. Definitions with a
side effect are marked in `rooted` and are never removed.

@kind output
@concept Dead code elimination in SSA is a sweep with a worklist, not an
analysis, because a definition with no uses is dead with no further argument.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Removing a definition decrements the use count of whatever it read, which
can make that one dead too. One pass is not enough.
@diagnose assert verdict assert-failed
A check disagrees. A chain of three definitions where only the last is unused
collapses entirely: removing it makes the second dead, and removing that makes
the first dead. A single pass finds only the first of the three.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The same shape appears in every mark and sweep collector. What SSA
contributes is that the use count is exact rather than conservative.

```starter
unsigned live_defs(unsigned *uses, const int *operand, const int *rooted,
                   unsigned n) {
    (void)operand;
    unsigned live = 0;
    for (unsigned i = 0; i < n; i++)
        if (uses[i] || rooted[i]) live++;
    return live;
}
```

```tests
#include <assert.h>
unsigned live_defs(unsigned *, const int *, const int *, unsigned);
int main(void) {
    /* 0 <- 1 <- 2, nothing rooted: all three go. */
    { unsigned u[] = {1, 1, 0}; int op[] = {-1, 0, 1}; int r[] = {0, 0, 0};
      assert(live_defs(u, op, r, 3) == 0); }
    /* Same chain, but 2 has a side effect: all three stay. */
    { unsigned u[] = {1, 1, 0}; int op[] = {-1, 0, 1}; int r[] = {0, 0, 1};
      assert(live_defs(u, op, r, 3) == 3); }
    /* A rooted definition and one dead one beside it. */
    { unsigned u[] = {0, 0}; int op[] = {-1, -1}; int r[] = {1, 0};
      assert(live_defs(u, op, r, 2) == 1); }
    /* Nothing to do. */
    { unsigned u[] = {0}; int op[] = {-1}; int r[] = {1};
      assert(live_defs(u, op, r, 1) == 1); }
    return 0;
}
```

```solution
unsigned live_defs(unsigned *uses, const int *operand, const int *rooted,
                   unsigned n) {
    /* One byte per definition. A real pass carries a flag on the instruction
       and a worklist instead of sweeping, which is the same algorithm without
       the fixed ceiling. */
    char gone[64] = {0};
    if (n > sizeof gone) return n;
    unsigned removed = 0;
    for (int changed = 1; changed; ) {
        changed = 0;
        for (unsigned i = 0; i < n; i++) {
            if (gone[i] || rooted[i] || uses[i]) continue;
            gone[i] = 1;
            removed++;
            changed = 1;
            if (operand[i] >= 0 && uses[operand[i]]) uses[operand[i]]--;
        }
    }
    return n - removed;
}
```

## Two computations of the same value

Write `value_number`, assigning a value number to an expression given its
operator and the names of its two operands, using a table of expressions already
numbered.

Two expressions with the same operator and the same operand names are the same
value and get the same number. A new expression gets the next unused number.

Operands are already SSA names, so equal names mean equal values. Commutativity
is not to be assumed: only exact matches count.

@kind output
@concept A name is a definition, so comparing names compares values, which is
what makes global value numbering nearly free in this form.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Scan the table for an exact match on all three fields. Only when there is
none does a new number get handed out.
@diagnose assert verdict assert-failed
A check disagrees. The same operator over different operands is a different
value, and the same operands under a different operator are too. All three
fields have to match.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after In non-SSA form this needs a proof that neither operand was reassigned
between the two computations. Here the names carry that proof.

```starter
unsigned value_number(const char *ops, const unsigned *lhs,
                      const unsigned *rhs, unsigned n,
                      char op, unsigned a, unsigned b) {
    (void)ops; (void)lhs; (void)rhs; (void)op; (void)a; (void)b;
    return n;
}
```

```tests
#include <assert.h>
unsigned value_number(const char *, const unsigned *, const unsigned *,
                      unsigned, char, unsigned, unsigned);
int main(void) {
    char ops[]      = {'+', '*', '+'};
    unsigned lhs[]  = { 1,   2,   3 };
    unsigned rhs[]  = { 2,   3,   4 };
    /* Already in the table: reuse the number. */
    assert(value_number(ops, lhs, rhs, 3, '+', 1, 2) == 0);
    assert(value_number(ops, lhs, rhs, 3, '*', 2, 3) == 1);
    assert(value_number(ops, lhs, rhs, 3, '+', 3, 4) == 2);
    /* New: different operands, or a different operator. */
    assert(value_number(ops, lhs, rhs, 3, '+', 2, 1) == 3);
    assert(value_number(ops, lhs, rhs, 3, '*', 1, 2) == 3);
    assert(value_number(ops, lhs, rhs, 3, '+', 9, 9) == 3);
    return 0;
}
```

```solution
unsigned value_number(const char *ops, const unsigned *lhs,
                      const unsigned *rhs, unsigned n,
                      char op, unsigned a, unsigned b) {
    for (unsigned i = 0; i < n; i++)
        if (ops[i] == op && lhs[i] == a && rhs[i] == b) return i;
    return n;
}
```

## Taking the phi nodes out again

Write `copies_inserted`, returning how many copy instructions phi elimination
adds for one join block, given the number of phi nodes there and the number of
predecessors.

Every phi takes one argument per predecessor, and each argument becomes a copy
at the end of that predecessor. A copy whose source and destination are already
the same register is not emitted, and `same` says how many of the arguments are
in that position.

@kind output
@concept A phi is not an instruction, so it has to become one somewhere, and
where it goes is the edge rather than the join.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One copy per phi per predecessor, less the ones that would copy a
register to itself.
@diagnose assert verdict assert-failed
A check disagrees. Two phis at a join with two predecessors are four copies
before any are elided, not two. Each phi contributes one per incoming edge.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The copies go at the end of each predecessor rather than at the join,
which is where the lost copy and swap problems come from, and why real phi
elimination is longer than it sounds.

```starter
unsigned copies_inserted(unsigned phis, unsigned preds, unsigned same) {
    (void)preds; (void)same;
    return phis;
}
```

```tests
#include <assert.h>
unsigned copies_inserted(unsigned, unsigned, unsigned);
int main(void) {
    assert(copies_inserted(0, 2, 0) == 0);
    assert(copies_inserted(1, 2, 0) == 2);
    assert(copies_inserted(2, 2, 0) == 4);
    assert(copies_inserted(2, 3, 0) == 6);
    assert(copies_inserted(2, 2, 3) == 1);   /* three would be self copies */
    assert(copies_inserted(1, 2, 2) == 0);
    return 0;
}
```

```solution
unsigned copies_inserted(unsigned phis, unsigned preds, unsigned same) {
    unsigned total = phis * preds;
    return same >= total ? 0 : total - same;
}
```

## What a promise buys the optimiser

Write `can_widen`, deciding whether a loop counter may be widened to 64 bits,
given whether the counter is signed and whether the loop is known to run few
enough times that it cannot wrap.

Signed overflow is undefined, so a signed counter may be widened without
checking anything. Unsigned overflow is defined to wrap, so an unsigned counter
may be widened only when the compiler can prove the wrap never happens.

@kind output
@concept The difference between undefined and defined is what the optimiser is
allowed to assume, and it shows up as different machine code for the same loop.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The signed case needs no proof, because the standard already supplied it.
@diagnose assert verdict assert-failed
A check disagrees. An unsigned counter with no bound cannot be widened, because
a wrapping 32 bit sequence and a 64 bit one are different programs. A signed one
can, because the standard says the wrap cannot happen.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Change `int i` to `unsigned i` in a summation loop and the generated code
changes for exactly this reason. Undefined behaviour is not there to trap you;
a defined behaviour is a promise the optimiser then has to keep.

```starter
int can_widen(int is_signed, int bound_known) {
    (void)is_signed;
    return bound_known;
}
```

```tests
#include <assert.h>
int can_widen(int, int);
int main(void) {
    assert(can_widen(1, 0) == 1);   /* signed, no proof needed */
    assert(can_widen(1, 1) == 1);
    assert(can_widen(0, 1) == 1);   /* unsigned, but bounded */
    assert(can_widen(0, 0) == 0);   /* unsigned and unbounded */
    return 0;
}
```

```solution
int can_widen(int is_signed, int bound_known) {
    return is_signed || bound_known;
}
```

## Constants, and the branch that stops existing

Write `reachable_blocks`, returning how many blocks of a small function remain
reachable once constants have been propagated.

The function is a chain of `n` blocks. Block `i` ends in a conditional branch
whose condition is described by `cond[i]`: 1 for a condition folded to true, 0
for one folded to false, and -1 for one that is not constant. A true condition
takes the next block in the chain and a false condition skips it, jumping to the
one after. The last block ends the function.

Count block 0 and every block reachable from it.

@kind output
@concept Constant propagation and unreachable code elimination feed each other,
which is why doing them at once beats doing either alone.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A non-constant condition reaches both successors. A constant one reaches
only the side it selects, and the other side may then have nothing reaching it.
@diagnose assert verdict assert-failed
A check disagrees. A folded condition removes an edge, and a block that has lost
its only incoming edge is unreachable even though the code for it is still
there. Counting every block reaches the answer only when nothing folded.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is sparse conditional constant propagation in miniature. Each folded
condition removes an edge, an unreachable block cannot contribute a value, and
that can fold the next condition, which is why the two passes are one pass.

```starter
unsigned reachable_blocks(const int *cond, unsigned n) {
    (void)cond;
    return n;
}
```

```tests
#include <assert.h>
unsigned reachable_blocks(const int *, unsigned);
int main(void) {
    { int c[] = {-1, -1, -1};  assert(reachable_blocks(c, 3) == 3); }
    /* Block 0 always skips block 1, which nothing else reaches. */
    { int c[] = {0, -1, -1};   assert(reachable_blocks(c, 3) == 2); }
    { int c[] = {1, -1, -1};   assert(reachable_blocks(c, 3) == 3); }
    /* Two skips in a row. */
    { int c[] = {0, -1, 0, -1, -1};
      assert(reachable_blocks(c, 5) == 3); }
    { int c[] = {-1};          assert(reachable_blocks(c, 1) == 1); }
    return 0;
}
```

```solution
unsigned reachable_blocks(const int *cond, unsigned n) {
    char seen[64] = {0};
    if (!n) return 0;
    if (n > sizeof seen) return n;
    seen[0] = 1;
    for (unsigned i = 0; i < n; i++) {
        if (!seen[i]) continue;
        if (cond[i] != 0 && i + 1 < n) seen[i + 1] = 1;
        if (cond[i] != 1 && i + 2 < n) seen[i + 2] = 1;
    }
    unsigned live = 0;
    for (unsigned i = 0; i < n; i++) live += seen[i] ? 1 : 0;
    return live;
}
```
