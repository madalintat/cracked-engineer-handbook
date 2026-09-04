## What a tree costs per operation

Write `tree_dispatches`, returning how many dispatches a tree walking
interpreter performs for a fully parenthesised expression over `n` values.

Every node is visited once and every visit is a dispatch, leaves included. A
bytecode machine walks the tree once at compile time and pays nothing per node
afterwards.

@kind output
@concept The cost of a tree walker is one dispatch per node, which is why it is
slow for reasons that have nothing to do with the arithmetic.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The tree has a node per value and a node per operator joining them.
@diagnose assert verdict assert-failed
A check disagrees. Three values joined by two operators are five nodes, so five
dispatches. Counting only the operators misses that reading a variable is a
dispatch too, and it is the most common node in real code.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The pointer chase matters as much as the count. Each of those nodes was
allocated separately and sits in a different cache line, which is why the
measured gap to a bytecode machine is a factor of ten and not a factor of two.

```starter
unsigned tree_dispatches(unsigned values) {
    return values ? values - 1 : 0;
}
```

```tests
#include <assert.h>
unsigned tree_dispatches(unsigned);
int main(void) {
    assert(tree_dispatches(0) == 0);
    assert(tree_dispatches(1) == 1);
    assert(tree_dispatches(2) == 3);
    assert(tree_dispatches(3) == 5);
    assert(tree_dispatches(8) == 15);
    return 0;
}
```

```solution
unsigned tree_dispatches(unsigned values) {
    return values ? 2 * values - 1 : 0;
}
```

## How deep the operand stack goes

Write `max_depth`, returning the greatest operand stack depth a stack machine
reaches while running a sequence of instructions, or -1 if the sequence ever
pops from an empty stack.

Each instruction is given by how many operands it pops and how many results it
pushes. The stack starts empty. The compiler computes this number once so the
frame can be allocated in one go.

@kind output
@concept The maximum depth is a property the compiler can work out statically,
which is what lets a frame be allocated once rather than grown while running.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Track the running depth and remember the largest it reached, not the depth
it ends at.
@diagnose assert verdict assert-failed
A check disagrees. The depth at the end is usually zero or one, because the
value gets consumed. The number the frame needs is the highest point reached
along the way.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after In a code object this is one field, computed by the compiler and stored
beside the bytecode. Getting it wrong by one is a stack overflow that only some
inputs reach.

```starter
int max_depth(const unsigned *pops, const unsigned *pushes, unsigned n) {
    int depth = 0;
    for (unsigned i = 0; i < n; i++) {
        if ((unsigned)depth < pops[i]) return -1;
        depth -= (int)pops[i];
        depth += (int)pushes[i];
    }
    return depth;
}
```

```tests
#include <assert.h>
int max_depth(const unsigned *, const unsigned *, unsigned);
int main(void) {
    /* push a, push b, add: depth reaches 2 and ends at 1. */
    { unsigned po[] = {0, 0, 2}, pu[] = {1, 1, 1};
      assert(max_depth(po, pu, 3) == 2); }
    /* push, push, push, add, add: reaches 3. */
    { unsigned po[] = {0, 0, 0, 2, 2}, pu[] = {1, 1, 1, 1, 1};
      assert(max_depth(po, pu, 5) == 3); }
    /* nothing at all */
    { unsigned po[] = {0}, pu[] = {0};
      assert(max_depth(po, pu, 1) == 0); }
    /* popping an empty stack */
    { unsigned po[] = {1}, pu[] = {0};
      assert(max_depth(po, pu, 1) == -1); }
    { unsigned po[] = {0, 2}, pu[] = {1, 1};
      assert(max_depth(po, pu, 2) == -1); }
    return 0;
}
```

```solution
int max_depth(const unsigned *pops, const unsigned *pushes, unsigned n) {
    int depth = 0, high = 0;
    for (unsigned i = 0; i < n; i++) {
        if ((unsigned)depth < pops[i]) return -1;
        depth -= (int)pops[i];
        depth += (int)pushes[i];
        if (depth > high) high = depth;
    }
    return high;
}
```

## Two ways to say the same thing

Write `dispatch_count`, returning how many instructions each kind of bytecode
machine executes for a chain of binary operations over `n` values already in
locals.

A stack machine must load each value and then apply each operator, so it runs
one instruction per value plus one per operator. A register machine names its
operands, so it runs one instruction per operator and no loads at all.

Return the stack machine's count when `is_stack` is non-zero, and the register
machine's otherwise.

@kind output
@concept Fewer, fatter instructions mean fewer dispatches for the same work,
which is the whole argument for a register machine.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Three values and two operators are five instructions on a stack and two in
registers.
@diagnose assert verdict assert-failed
A check disagrees. The register machine does not load anything: the operands are
already slots in the frame, and the instruction names them. That is the
difference the two designs are arguing about.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Lua moved from a stack machine to a register machine in version 5, and
it is still the clearest case study of what that costs and buys.

```starter
unsigned dispatch_count(unsigned values, int is_stack) {
    (void)is_stack;
    return values ? 2 * values - 1 : 0;
}
```

```tests
#include <assert.h>
unsigned dispatch_count(unsigned, int);
int main(void) {
    assert(dispatch_count(3, 1) == 5);   /* load, load, load, add, add */
    assert(dispatch_count(3, 0) == 2);   /* add, add */
    assert(dispatch_count(2, 1) == 3);
    assert(dispatch_count(2, 0) == 1);
    assert(dispatch_count(1, 1) == 1);
    assert(dispatch_count(1, 0) == 0);
    assert(dispatch_count(0, 1) == 0);
    assert(dispatch_count(0, 0) == 0);
    return 0;
}
```

```solution
unsigned dispatch_count(unsigned values, int is_stack) {
    if (!values) return 0;
    return is_stack ? 2 * values - 1 : values - 1;
}
```

## One branch site, or many

Write `branch_sites`, returning how many indirect branch sites a dispatch loop
has, given the number of distinct opcodes and which dispatch scheme is used.

A switch compiles to one jump through a table, shared by every opcode. Ending
each opcode's body with its own jump gives one site per opcode.

Scheme 0 is the switch and scheme 1 is the jump per opcode. A loop with no
opcodes has no sites at all.

@kind output
@concept A predictor keyed on one site cannot learn which opcode follows which,
because from that site the target is whatever the program happens to be doing.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The switch has one site however many opcodes there are. That is the
problem with it.
@diagnose assert verdict assert-failed
A check disagrees. The number of opcodes does not change how many branch sites a
switch has, and that is exactly why the predictor has nothing to work with.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The reported gain when CPython adopted the jump per opcode was fifteen to
twenty percent, for a change that computes exactly the same thing in exactly the
same order.

```starter
unsigned branch_sites(unsigned opcodes, int scheme) {
    (void)scheme;
    return opcodes;
}
```

```tests
#include <assert.h>
unsigned branch_sites(unsigned, int);
int main(void) {
    assert(branch_sites(0, 0) == 0);
    assert(branch_sites(0, 1) == 0);
    assert(branch_sites(1, 0) == 1);
    assert(branch_sites(90, 0) == 1);
    assert(branch_sites(1, 1) == 1);
    assert(branch_sites(90, 1) == 90);
    return 0;
}
```

```solution
unsigned branch_sites(unsigned opcodes, int scheme) {
    if (!opcodes) return 0;
    return scheme ? opcodes : 1;
}
```

## When to specialise

Write `should_specialise`, deciding whether an adaptive instruction should
rewrite itself, given how many times it has run and the threshold, and how many
distinct operand shapes it has seen.

Specialise once the counter reaches the threshold, but only when exactly one
shape has been seen. A site that has already seen two different shapes is
polymorphic, and a guard that fails half the time costs more than it saves.

@kind output
@concept The assumption has to be worth making. Specialising a site that has
already contradicted itself buys a guard and no speed.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Both conditions have to hold. Reaching the threshold is not enough on its
own.
@diagnose assert verdict assert-failed
A check disagrees. A site that has seen two shapes is not specialised however
hot it is, because the guard would fail on whichever shape it did not pick.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Real families are finer than this: an attribute load specialises
differently for an instance, a module and a slot, and the routine that decides
looks at the operands that actually turned up.

```starter
int should_specialise(unsigned runs, unsigned threshold, unsigned shapes) {
    (void)shapes;
    return runs >= threshold;
}
```

```tests
#include <assert.h>
int should_specialise(unsigned, unsigned, unsigned);
int main(void) {
    assert(should_specialise(8, 8, 1) == 1);
    assert(should_specialise(9, 8, 1) == 1);
    assert(should_specialise(7, 8, 1) == 0);
    assert(should_specialise(9, 8, 2) == 0);   /* polymorphic */
    assert(should_specialise(9, 8, 0) == 0);   /* nothing seen yet */
    return 0;
}
```

```solution
int should_specialise(unsigned runs, unsigned threshold, unsigned shapes) {
    return runs >= threshold && shapes == 1;
}
```

## The guard that can be taken back

Write `after_miss`, returning a specialised instruction's remaining confidence
after a guard fails, and -1 when it should revert to the adaptive form.

Confidence starts at some value and a miss decrements it. It never goes below
zero by decrementing; instead, a miss at zero means the instruction reverts.

@kind output
@concept Deoptimisation is what makes the assumption safe. Without a way back,
a wrong guess is a wrong program rather than a slow one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One miss is not a reason to give up. Reverting happens when the counter
has already run out.
@diagnose assert verdict assert-failed
A check disagrees. A single miss decrements and keeps the specialisation, which
is what stops one unusual value undoing a site that is right the rest of the
time. Only a miss at zero reverts.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Once reverted, the instruction can specialise again on whatever it sees
next, which is how a site that changes shape halfway through a program ends up
fast for both halves.

```starter
int after_miss(unsigned confidence) {
    return confidence ? (int)confidence - 1 : 0;
}
```

```tests
#include <assert.h>
int after_miss(unsigned);
int main(void) {
    assert(after_miss(3) == 2);
    assert(after_miss(1) == 0);
    assert(after_miss(0) == -1);   /* out of confidence: revert */
    return 0;
}
```

```solution
int after_miss(unsigned confidence) {
    return confidence ? (int)confidence - 1 : -1;
}
```

## Worth compiling, and worth compiling now

Write `tier_action`, deciding what a tiered runtime should do with a code unit,
given how many times it has been entered, how many iterations its loop has run,
the threshold, and whether it is currently executing.

Return 0 to keep interpreting, 1 to compile it for next time, and 2 to compile
it and transfer the running frame into the new code.

A unit crosses the threshold on entries or on loop iterations, whichever comes
first. When it is not currently executing, compiling for next time is enough.
When it is executing, the frame has to be moved, or a loop entered once never
benefits.

@kind output
@concept On stack replacement is not an optimisation on top of tiering. It is
what makes tiering work for the case that most needs it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two questions, in order: has it got hot at all, and is it hot right now
while running.
@diagnose assert verdict assert-failed
A check disagrees. A function entered once whose loop has run ten million times
is hot, and waiting for it to return before compiling means waiting forever.
That is the case that needs the frame moved.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Transferring the frame means moving every live value and the loop counter
into the compiled version's layout, mid flight. It is fiddly and it is not
optional.

```starter
int tier_action(unsigned entries, unsigned iterations, unsigned threshold,
                int executing) {
    (void)iterations; (void)executing;
    return entries >= threshold ? 1 : 0;
}
```

```tests
#include <assert.h>
int tier_action(unsigned, unsigned, unsigned, int);
int main(void) {
    assert(tier_action(2, 0, 10, 0) == 0);          /* cold */
    assert(tier_action(10, 0, 10, 0) == 1);         /* hot by entries */
    assert(tier_action(1, 10000, 10, 1) == 2);      /* hot loop, running now */
    assert(tier_action(1, 10000, 10, 0) == 1);      /* hot, but not running */
    assert(tier_action(1, 2, 10, 1) == 0);          /* still cold */
    assert(tier_action(10, 0, 10, 1) == 2);
    return 0;
}
```

```solution
int tier_action(unsigned entries, unsigned iterations, unsigned threshold,
                int executing) {
    int hot = entries >= threshold || iterations >= threshold;
    if (!hot) return 0;
    return executing ? 2 : 1;
}
```

## A cache of the parse, and nothing else

Write `use_cached`, deciding whether a cached bytecode file may be loaded
instead of parsing the source, given whether the format magic matches, whether
the recorded source stamp matches, and whether the cache records a hash rather
than a timestamp.

The magic must match or the file is from another version and cannot be read at
all. Then the stamp must match the source. A hash based cache is checked the
same way; the difference is what the stamp is, not whether it is checked.

@kind output
@concept The file is a cache of the parse, not an optimisation of the program,
so every check is about whether it is still the same source.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A mismatched magic is fatal on its own. Nothing else is worth looking at
after that.
@diagnose assert verdict assert-failed
A check disagrees. A file whose magic does not match is from a different
bytecode format and is rejected rather than read, whatever its stamp says.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Loading it skips tokenising and parsing and nothing else. The program
does not run faster afterwards; it starts faster.

```starter
int use_cached(int magic_ok, int stamp_ok, int hash_based) {
    (void)magic_ok; (void)hash_based;
    return stamp_ok;
}
```

```tests
#include <assert.h>
int use_cached(int, int, int);
int main(void) {
    assert(use_cached(1, 1, 0) == 1);
    assert(use_cached(1, 1, 1) == 1);
    assert(use_cached(1, 0, 0) == 0);   /* source changed */
    assert(use_cached(0, 1, 0) == 0);   /* wrong bytecode version */
    assert(use_cached(0, 0, 1) == 0);
    return 0;
}
```

```solution
int use_cached(int magic_ok, int stamp_ok, int hash_based) {
    (void)hash_based;
    return magic_ok && stamp_ok;
}
```
