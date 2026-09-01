## Exactly one network

Given the two inputs and a description of which network conducts, return 1 if
the gate is well formed for that row and 0 if it is not. Well formed means
exactly one of the two networks conducts.

@kind output
@concept Both networks conducting is a short circuit, and neither conducting
leaves the output floating. Exactly one is the entire discipline.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint Exactly one is true. There is a single operator for that.
@diagnose wrong verdict nonzero-exit
Read the row the check names. Returning `pu || pd` accepts the case where both
conduct, which is a short from the supply to ground through your gate.
Returning `pu && !pd` is right for one ordering and silently wrong for the
other.
@after Exclusive or is the well-formedness condition for every static CMOS gate
there is. A cell library's verification runs exactly this over every input
combination.

```starter
/* pu: does the pull-up network conduct for this input row?
   pd: does the pull-down network conduct? */
int well_formed(int pu, int pd) {
    return pu || pd;
}
```

```tests
#include <stdio.h>
int main(void) {
    struct { int pu, pd, want; } c[] = {
        {0, 0, 0},   /* output floats */
        {1, 0, 1},   /* pulled high  */
        {0, 1, 1},   /* pulled low   */
        {1, 1, 0},   /* crowbar      */
    };
    for (int i = 0; i < 4; i++) {
        int got = well_formed(c[i].pu, c[i].pd);
        if (!!got != c[i].want) {
            printf("pu=%d pd=%d: got %d want %d\n", c[i].pu, c[i].pd, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
int well_formed(int pu, int pd) {
    return !pu != !pd;
}
```

## The dual of a network

A pull-down network is described as a list of series groups wired in parallel.
Return the depth of the deepest series stack in the pull-up network, which is
its dual.

@kind output
@concept Series in one network is parallel in the other, so the deepest stack
in one is the widest group count in the other.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint The dual swaps series and parallel. What was a count of parallel groups
becomes a depth.
@diagnose wrong verdict nonzero-exit
Duality exchanges the two structures. A pull-down of three groups in parallel
becomes a pull-up of three transistors in series, whatever the sizes of the
groups were, so the answer depends on how many groups there are and not on how
deep any of them is.
@after A stack deeper than about four is too slow to build, which is why gates
have a fan-in limit of roughly four and an eight-input NAND is a tree.

```starter
/* groups: how many series groups the pull-down wires in parallel.
   sizes:  how many transistors are in each of those groups. */
int dual_max_stack(int groups, const int *sizes) {
    int best = 0;
    for (int i = 0; i < groups; i++)
        if (sizes[i] > best) best = sizes[i];
    return best;
}
```

```tests
#include <stdio.h>
int main(void) {
    int a[] = {2, 1};        /* NAND-ish: two in series, parallel with one */
    int b[] = {1, 1, 1};     /* three in parallel */
    int c[] = {3};           /* one group of three in series */
    struct { int n; const int *s; int want; } t[] = {
        {2, a, 2}, {3, b, 3}, {1, c, 1},
    };
    for (int i = 0; i < 3; i++) {
        int got = dual_max_stack(t[i].n, t[i].s);
        if (got != t[i].want) {
            printf("case %d: got %d want %d\n", i, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
int dual_max_stack(int groups, const int *sizes) {
    (void)sizes;
    return groups;
}
```

## Counting a gate

Return the transistor count of a standard cell, given the number of inputs and
whether the gate inverts.

@kind output
@concept An inverting gate costs two transistors per input. A non-inverting one
costs that plus an inverter.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint Two per input, and an inverter is two more.
@diagnose wrong verdict nonzero-exit
Each input needs one transistor in the pull-up and one in the pull-down, so an
inverting gate of `n` inputs is `2n`. A non-inverting gate is that plus an
inverter on the output, which is two more.
@after Two-input NAND is four and two-input AND is six. That fifty per cent is
the whole reason the next part starts where it does.

```starter
int transistors(int inputs, int inverting) {
    return inputs * 2;
}
```

```tests
#include <stdio.h>
int main(void) {
    struct { int n, inv, want; } c[] = {
        {1, 1, 2},   /* NOT  */
        {2, 1, 4},   /* NAND */
        {2, 0, 6},   /* AND  */
        {3, 1, 6},   /* 3-input NAND */
        {3, 0, 8},   /* 3-input AND  */
    };
    for (int i = 0; i < 5; i++) {
        int got = transistors(c[i].n, c[i].inv);
        if (got != c[i].want) {
            printf("%d inputs, inverting=%d: got %d want %d\n",
                   c[i].n, c[i].inv, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
int transistors(int inputs, int inverting) {
    return inputs * 2 + (inverting ? 0 : 2);
}
```

## Stages, and therefore delay

Return the number of gate delays a function costs, given how many inverting
stages it needs and whether the result has to be non-inverting.

@kind output
@concept Delay is counted in stages, and an inversion at the end is a stage.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint The inverter is a stage like any other.
@diagnose wrong verdict nonzero-exit
An output inverter is not free in time any more than it is in area. If the
result has to come out the other way round, that is one more stage between the
input changing and the output settling.
@after This is why a designer builds a tree of NANDs and NORs whose inversions
cancel rather than a chain of ANDs. Cancelling an inversion removes a stage.

```starter
int delay_stages(int inverting_stages, int needs_noninverting) {
    return inverting_stages;
}
```

```tests
#include <stdio.h>
int main(void) {
    struct { int s, n, want; } c[] = {
        {1, 0, 1}, {1, 1, 2}, {3, 0, 3}, {3, 1, 4},
    };
    for (int i = 0; i < 4; i++) {
        int got = delay_stages(c[i].s, c[i].n);
        if (got != c[i].want) {
            printf("stages %d noninv %d: got %d want %d\n",
                   c[i].s, c[i].n, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
int delay_stages(int inverting_stages, int needs_noninverting) {
    return inverting_stages + (needs_noninverting ? 1 : 0);
}
```

## What a complex gate saves

Return the transistor count of `NOT(sum of products)` built as one CMOS gate,
given the number of product terms and how many literals are in each.

@kind output
@concept Any inverted sum of products is one gate, which is why a synthesised
netlist looks nothing like the expression that produced it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint One transistor per literal in the pull-down, and the dual has the same
count in the pull-up.
@diagnose wrong verdict nonzero-exit
Every literal appears once in each network. Count the literals across all the
product terms and double it. Adding an inverter is wrong here: the gate is
already inverting, which is what the NOT in the name is.
@after Six transistors and one delay, against fourteen and three for the same
function built from discrete gates. This is where synthesis earns its keep.

```starter
/* terms: how many product terms are summed.
   widths: how many literals in each term. */
int aoi_transistors(int terms, const int *widths) {
    int n = 0;
    for (int i = 0; i < terms; i++) n += widths[i];
    return n;
}
```

```tests
#include <stdio.h>
int main(void) {
    int a[] = {2, 1};       /* NOT((A AND B) OR C) */
    int b[] = {1, 1};       /* NOR */
    int c[] = {2, 2};       /* NOT((A AND B) OR (C AND D)) */
    struct { int n; const int *w; int want; } t[] = {
        {2, a, 6}, {2, b, 4}, {2, c, 8},
    };
    for (int i = 0; i < 3; i++) {
        int got = aoi_transistors(t[i].n, t[i].w);
        if (got != t[i].want) {
            printf("case %d: got %d want %d\n", i, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
int aoi_transistors(int terms, const int *widths) {
    int n = 0;
    for (int i = 0; i < terms; i++) n += widths[i];
    return n * 2;
}
```

## Why NOR is the slower one

Return the relative resistance of a gate's slow path, given how many
transistors are in series in that path and the mobility penalty of the flavour
they are made from.

@kind output
@concept Series resistance adds, and the PMOS flavour starts higher, so two
PMOS in series is four times the resistance of two NMOS in series.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint Resistances in series add, and each one is already scaled by the penalty.
@diagnose wrong verdict nonzero-exit
The penalty applies to every transistor in the stack, not once to the stack. Two
in series at a penalty of two is four, not three.
@after NAND stacks its NMOS and parallels its PMOS. NOR does the opposite, so
its slow path is two of the slow flavour in series. Same transistor count, worse
gate.

```starter
double slow_path(int in_series, double mobility_penalty) {
    return in_series + mobility_penalty;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { int n; double p, want; } c[] = {
        {2, 1.0, 2.0},   /* NAND: two NMOS in series */
        {2, 2.0, 4.0},   /* NOR:  two PMOS in series  */
        {3, 2.5, 7.5},
        {1, 1.0, 1.0},
    };
    for (int i = 0; i < 4; i++) {
        double got = slow_path(c[i].n, c[i].p);
        if (fabs(got - c[i].want) > 1e-9) {
            printf("%d in series, penalty %.1f: got %.2f want %.2f\n",
                   c[i].n, c[i].p, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double slow_path(int in_series, double mobility_penalty) {
    return in_series * mobility_penalty;
}
```

## Bubble pushing

An inversion can be moved across a De Morgan boundary. Return how many
transistors are saved by turning `NOT(a) OR NOT(b)` into `NOT(a AND b)`.

@kind output
@concept Moving an inversion across a boundary can delete transistors and a
gate delay, which is why real logic looks inside out.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint Count both sides. Two inverters and an OR against one NAND.
@diagnose wrong verdict nonzero-exit
The left side is two inverters at two transistors each plus a two-input OR at
six, which is ten. The right side is a two-input NAND at four. The saving is the
difference.
@after Six transistors and a gate delay, from applying an identity you already
knew as algebra. A synthesis tool does this thousands of times per design.

```starter
/* Returns transistors saved by rewriting NOT(a) OR NOT(b) as NOT(a AND b). */
int bubble_saving(void) {
    return 0;
}
```

```tests
#include <stdio.h>
int main(void) {
    int got = bubble_saving();
    if (got != 6) { printf("got %d, want 6\n", got); return 1; }
    printf("ok\n");
    return 0;
}
```

```solution
int bubble_saving(void) {
    int before = 2 + 2 + 6;   /* two inverters and an OR */
    int after = 4;            /* one NAND */
    return before - after;
}
```

## The mux nobody builds from gates

Return the transistor count of a two-way multiplexer, given whether it is built
from transmission gates or from NAND gates.

@kind output
@concept A transmission gate passes a level rather than driving one, and a
multiplexer built from them is less than half the size.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint Two transmission gates at two transistors each, plus one inverter for the
complement of the select signal.
@diagnose wrong verdict nonzero-exit
The transmission-gate version is two switches of two transistors, plus an
inverter to produce the complementary select, which is six. The gate version is
about fourteen.
@after The version Part II asks you to build is the fourteen-transistor one, and
that is the right thing to build while learning that one primitive reaches
everything. It is worth knowing it is not what goes on a chip.

```starter
int mux2_transistors(int use_transmission_gates) {
    return 14;
}
```

```tests
#include <stdio.h>
int main(void) {
    if (mux2_transistors(1) != 6)  { printf("transmission: got %d want 6\n",  mux2_transistors(1)); return 1; }
    if (mux2_transistors(0) != 14) { printf("gates: got %d want 14\n", mux2_transistors(0)); return 1; }
    printf("ok\n");
    return 0;
}
```

```solution
int mux2_transistors(int use_transmission_gates) {
    return use_transmission_gates ? 2 * 2 + 2 : 14;
}
```
