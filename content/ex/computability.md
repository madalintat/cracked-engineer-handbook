## Three answers, not two

The fourth escape, and the one every timeout is. Write `halts_within`, which
runs a program for at most `budget` steps and reports 1 if it halted, 0 if it
did not halt within the budget, and never runs longer than that.

The machine is the subleq from unit 017. It halts when the program counter goes
negative or past the end of memory.

@kind output
@concept Bounding the resources turns an undecidable question into a decidable
question about something else, and the something else is what you actually get
to know.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict timeout
@hint The loop condition has two parts: steps remaining, and a program counter
still inside memory.
@diagnose timeout verdict timeout
Your analysis did the one thing this unit says no analysis may do. The second
check hands you a program that never halts, and the budget is not advisory: the
loop has to stop counting down whether or not the program is finished.
@diagnose assert verdict assert-failed
The budget is respected now and a boundary is off by one. A program that is
still running when the budget expires reports 0, and a program that halts on its
last permitted step reports 1.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The answer 0 does not mean it never halts. It means it had not halted
yet, and no amount of further waiting turns that into knowledge, because the
next unit's busy beaver argument says there is no budget that would have been
enough for every program.

```starter
int halts_within(int *mem, int n, int budget) {
    int pc = 0;
    (void)budget;
    while (pc >= 0 && pc + 2 < n) {
        int a = mem[pc], b = mem[pc + 1], c = mem[pc + 2];
        mem[b] -= mem[a];
        pc = mem[b] <= 0 ? c : pc + 3;
    }
    return 1;
}
```

```tests
#include <assert.h>
int halts_within(int *, int, int);
int main(void) {
    /* Halts at once: mem[5] -= mem[4] gives -2, so jump to -1. */
    int m1[] = {4, 5, -1, 0, 3, 1};
    assert(halts_within(m1, 6, 100) == 1);
    /* Loops forever: subtracts zero from zero and jumps back to itself. */
    int m2[] = {3, 3, 0, 0};
    assert(halts_within(m2, 4, 1000) == 0);
    assert(halts_within(m2, 4, 1) == 0);
    /* A budget of zero decides nothing about a program that would halt. */
    int m3[] = {4, 5, -1, 0, 3, 1};
    assert(halts_within(m3, 6, 0) == 0);
    return 0;
}
```

```solution
int halts_within(int *mem, int n, int budget) {
    int pc = 0;
    for (int i = 0; i < budget; i++) {
        if (pc < 0 || pc + 2 >= n) return 1;
        int a = mem[pc], b = mem[pc + 1], c = mem[pc + 2];
        mem[b] -= mem[a];
        pc = mem[b] <= 0 ? c : pc + 3;
    }
    return pc < 0 || pc + 2 >= n;
}
```

## Sound, and therefore annoying

The first escape. Write `never_divides_by_zero`, a conservative analysis over a
tiny instruction list: 0 sets a register to a constant, 1 divides register 0 by
register 1, 2 sets register 1 from an unknown source.

Return 1 only when you can prove no division by zero happens. Once a register's
value is unknown, it stays unknown, and a division by an unknown divisor cannot
be proved safe.

@kind output
@concept A sound analysis rejects programs it cannot prove safe, which is a
different thing from programs that are unsafe.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Track two things per register: whether the value is known, and what it is.
@diagnose assert verdict assert-failed
A check disagrees. The last one is the point: a program that reads an unknown
value and then divides is rejected even though the divisor might never be zero
at run time. That is the false rejection a sound analysis is required to make.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is a type checker in miniature, and it is why every user of a strict
one has written a correct program the compiler refused. The rejection is not a
bug in the analysis. Accepting it would require deciding something Rice's
theorem says cannot be decided.

```starter
int never_divides_by_zero(const int *ops, const int *args, int n) {
    int r1 = 0;
    for (int i = 0; i < n; i++) {
        if (ops[i] == 0) r1 = args[i];
        else if (ops[i] == 1 && r1 == 0) return 0;
    }
    return 1;
}
```

```tests
#include <assert.h>
int never_divides_by_zero(const int *, const int *, int);
int main(void) {
    /* set r1 = 3, divide. Provably safe. */
    int o1[] = {0, 1}, a1[] = {3, 0};
    assert(never_divides_by_zero(o1, a1, 2) == 1);
    /* set r1 = 0, divide. Provably unsafe. */
    int o2[] = {0, 1}, a2[] = {0, 0};
    assert(never_divides_by_zero(o2, a2, 2) == 0);
    /* No division at all. */
    int o3[] = {0, 0}, a3[] = {0, 5};
    assert(never_divides_by_zero(o3, a3, 2) == 1);
    /* r1 becomes unknown, then a division. Might be fine. Rejected anyway. */
    int o4[] = {0, 2, 1}, a4[] = {7, 0, 0};
    assert(never_divides_by_zero(o4, a4, 3) == 0);
    /* Unknown, then overwritten with a safe constant, then divide. */
    int o5[] = {2, 0, 1}, a5[] = {0, 4, 0};
    assert(never_divides_by_zero(o5, a5, 3) == 1);
    return 0;
}
```

```solution
int never_divides_by_zero(const int *ops, const int *args, int n) {
    int known = 1, r1 = 0;
    for (int i = 0; i < n; i++) {
        if (ops[i] == 0) { known = 1; r1 = args[i]; }
        else if (ops[i] == 2) { known = 0; }
        else if (ops[i] == 1) { if (!known || r1 == 0) return 0; }
    }
    return 1;
}
```

## Restrict the language until the question is easy

The third escape, and the one the kernel takes. Write `verifier_accepts`, which
accepts a program only if every jump goes forward.

A program with no backward jump cannot loop, so it terminates, and proving that
took one pass rather than a theorem.

@kind output
@concept Removing the ability to loop makes termination decidable, which is a
trade of expressiveness for a guarantee rather than a clever analysis.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A jump target that is less than or equal to the current index is a
backward jump.
@diagnose assert verdict assert-failed
A check disagrees. A jump to the instruction itself is a backward jump and the
tightest possible loop, so the comparison has to reject equality as well as
anything smaller.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after eBPF programs run in the kernel with no timeout and no way to be killed,
so the verifier cannot afford to be wrong. It refuses backward jumps, which
rejects every program with a loop in it, including many that would have been
perfectly safe. That is the price, and the kernel pays it deliberately.

```starter
int verifier_accepts(const int *jump, int n) {
    for (int i = 0; i < n; i++) {
        if (jump[i] >= 0 && jump[i] < i) return 0;
    }
    return 1;
}
```

```tests
#include <assert.h>
int verifier_accepts(const int *, int);
int main(void) {
    /* -1 means no jump. */
    int p1[] = {-1, -1, -1};
    assert(verifier_accepts(p1, 3) == 1);
    int p2[] = {2, -1, -1};
    assert(verifier_accepts(p2, 3) == 1);
    int p3[] = {-1, -1, 0};
    assert(verifier_accepts(p3, 3) == 0);
    /* A jump to itself is the tightest loop there is. */
    int p4[] = {-1, 1, -1};
    assert(verifier_accepts(p4, 3) == 0);
    int p5[] = {1, 2, -1};
    assert(verifier_accepts(p5, 3) == 1);
    return 0;
}
```

```solution
int verifier_accepts(const int *jump, int n) {
    for (int i = 0; i < n; i++) {
        if (jump[i] >= 0 && jump[i] <= i) return 0;
    }
    return 1;
}
```

## The diagonal, in a table you can see

The proof of undecidability is a diagonal argument, and the argument works just
as well on something finite and concrete.

`diagonal_row` is given an `n` by `n` table of zeroes and ones. Produce a row of
`n` entries that differs from every row of the table. It differs from row `i` in
column `i`, so it cannot be any of them.

@kind output
@concept Something that can describe all of its kind can be made to describe
one that is not among them, which is the whole mechanism behind the halting
proof.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Take the diagonal and flip every bit of it.
@diagnose assert verdict assert-failed
A check disagrees. Position `i` of your row has to be the opposite of
`table[i][i]`, so that it differs from row `i` at exactly that column. Copying
the diagonal produces the one row that might match; flipping it produces one
that cannot.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is Cantor's argument, Gödel's sentence and the halting proof in one
loop. The table is the list of all machines, the diagonal is what each machine
says about itself, and flipping it produces a behaviour no machine on the list
has.

```starter
void diagonal_row(const unsigned char *table, int n, unsigned char *out) {
    for (int i = 0; i < n; i++) out[i] = table[i * n + i];
}
```

```tests
#include <assert.h>
void diagonal_row(const unsigned char *, int, unsigned char *);
int main(void) {
    unsigned char t[9] = { 0, 1, 1,
                           1, 1, 0,
                           0, 0, 1 };
    unsigned char out[3];
    diagonal_row(t, 3, out);
    assert(out[0] == 1 && out[1] == 0 && out[2] == 0);
    /* It really does differ from every row. */
    for (int r = 0; r < 3; r++) {
        int same = 1;
        for (int c = 0; c < 3; c++) if (t[r * 3 + c] != out[c]) same = 0;
        assert(!same);
    }
    unsigned char z[4] = { 0, 0, 0, 0 };
    unsigned char o2[2];
    diagonal_row(z, 2, o2);
    assert(o2[0] == 1 && o2[1] == 1);
    return 0;
}
```

```solution
void diagonal_row(const unsigned char *table, int n, unsigned char *out) {
    for (int i = 0; i < n; i++) out[i] = table[i * n + i] ? 0 : 1;
}
```

## Yes is trustworthy, no is not

Halting is semi-decidable: a procedure can say yes for every program that halts,
and can never say no.

Write `search_halting`, which runs a growing budget until the program halts, and
returns the number of steps it took. Return -1 if it exceeds `max_budget`, which
is the concession to running on a real machine.

@kind output
@concept One side of a semi-decidable answer is knowledge and the other is
absence of knowledge, and telling them apart is most of using a verification
tool.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict timeout
@hint Step the machine one instruction at a time and count. Stop when the
counter leaves memory, or when the count reaches the ceiling.
@diagnose timeout verdict timeout
The looping program has no end, so nothing except your own ceiling will stop
this. That is the asymmetry the exercise is about: waiting never turns into
knowledge on its own.
@diagnose assert verdict assert-failed
The ceiling works and a count is off. The answer is the number of instructions
executed before the machine came to rest, so a program that halts on its first
instruction has executed one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A positive answer here is a proof: the program halted, and here is the
witness. A negative answer is not a proof of anything, and no version of this
procedure makes it one. A model checker that finds a bug has found a bug; one
that has not has told you nothing yet.

```starter
int search_halting(int *mem, int n, int max_budget) {
    int pc = 0, steps = 0;
    (void)max_budget;
    while (pc >= 0 && pc + 2 < n) {
        int a = mem[pc], b = mem[pc + 1], c = mem[pc + 2];
        mem[b] -= mem[a];
        pc = mem[b] <= 0 ? c : pc + 3;
        steps++;
    }
    return steps;
}
```

```tests
#include <assert.h>
int search_halting(int *, int, int);
int main(void) {
    int m1[] = {4, 5, -1, 0, 3, 1};
    assert(search_halting(m1, 6, 1000) == 1);
    /* Falls through twice, then off the end. */
    int m2[] = {6, 7, -1, 6, 7, -1, 0, 5};
    assert(search_halting(m2, 8, 1000) == 2);
    /* Never halts. The ceiling is the only thing that stops it. */
    int m3[] = {3, 3, 0, 0};
    assert(search_halting(m3, 4, 500) == -1);
    return 0;
}
```

```solution
int search_halting(int *mem, int n, int max_budget) {
    int pc = 0;
    for (int steps = 0; steps < max_budget; steps++) {
        if (pc < 0 || pc + 2 >= n) return steps;
        int a = mem[pc], b = mem[pc + 1], c = mem[pc + 2];
        mem[b] -= mem[a];
        pc = mem[b] <= 0 ? c : pc + 3;
    }
    return -1;
}
```

## Text is decidable, behaviour is not

Write two functions. `mentions_exec` reports whether a program's text contains a
given instruction opcode, which is a question about text and perfectly
decidable. `reaches_exec` reports whether the instruction is on a path reachable
from the start, which is the beginning of a question about behaviour.

Implement `reaches_exec` as a reachability walk over the jump graph. It is sound
in one direction only, and the last check shows which.

@kind output
@concept The undecidable line is not difficulty, it is text against behaviour,
and a reachability analysis is an approximation of the second built from the
first.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Mark the start, then repeatedly mark whatever a marked instruction can
reach: the next one, and its jump target if it has one.
@diagnose assert verdict assert-failed
A check disagrees. An instruction with a jump can reach both its target and the
instruction after it, because whether the branch is taken depends on values this
analysis does not track. Following only one of the two edges under-approximates
and misses reachable code.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after `mentions_exec` answers exactly. `reaches_exec` answers a weaker question
and answers it conservatively: it says reachable for branches that can never be
taken, because deciding which branches are taken is deciding the behaviour. That
gap is why your optimiser leaves code you know is dead.

```starter
int mentions_exec(const int *ops, int n, int target) {
    for (int i = 0; i < n; i++) if (ops[i] == target) return 1;
    return 0;
}

int reaches_exec(const int *ops, const int *jump, int n, int target) {
    for (int i = 0; i < n; i++) {
        if (ops[i] == target) return 1;
        if (jump[i] >= 0) i = jump[i] - 1;
    }
    return 0;
}
```

```tests
#include <assert.h>
int mentions_exec(const int *, int, int);
int reaches_exec(const int *, const int *, int, int);
int main(void) {
    /* op 9 is the interesting instruction. -1 in jump means no branch. */
    int o1[] = {1, 9, 1}, j1[] = {-1, -1, -1};
    assert(mentions_exec(o1, 3, 9) == 1);
    assert(reaches_exec(o1, j1, 3, 9) == 1);
    /* Not present at all. */
    int o3[] = {1, 2, 3}, j3[] = {-1, -1, -1};
    assert(mentions_exec(o3, 3, 9) == 0);
    assert(reaches_exec(o3, j3, 3, 9) == 0);
    /* Reachable only through a branch. Both edges must be followed. */
    int o4[] = {1, 1, 9}, j4[] = {2, -1, -1};
    assert(reaches_exec(o4, j4, 3, 9) == 1);
    /* Reachable only by falling through past a branch. */
    int o5[] = {1, 9, 1}, j5[] = {2, -1, -1};
    assert(reaches_exec(o5, j5, 3, 9) == 1);
    return 0;
}
```

```solution
int mentions_exec(const int *ops, int n, int target) {
    for (int i = 0; i < n; i++) if (ops[i] == target) return 1;
    return 0;
}

int reaches_exec(const int *ops, const int *jump, int n, int target) {
    unsigned char seen[256] = {0};
    int stack[256], sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
        int i = stack[--sp];
        if (i < 0 || i >= n || seen[i]) continue;
        seen[i] = 1;
        if (ops[i] == target) return 1;
        if (jump[i] >= 0) stack[sp++] = jump[i];
        stack[sp++] = i + 1;
    }
    return 0;
}
```

## The scanner that matches text

Fred Cohen proved that deciding whether a program is a virus is undecidable, so
scanners do the decidable thing instead and match signatures.

Write `scan`, which reports whether any signature appears as a contiguous run
inside the program.

@kind output
@concept A signature match is a question about text, which is why it can be
answered at all, and why it fails the moment the text changes.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Try each signature at each starting position.
@diagnose assert verdict assert-failed
A check disagrees. A signature has to match a run of consecutive bytes starting
somewhere in the program, and a signature longer than what remains from that
position cannot match at all. Checking only position zero finds the first
signature and misses the rest.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The last check is a program that does the same thing with its bytes
reordered, and your scanner does not find it. It is not a weak scanner: no
scanner decides this, so every one of them draws its line on text, and the arms
race between packers and scanners is a fight over how much text has to stay
recognisable.

```starter
int scan(const unsigned char *prog, int n,
         const unsigned char *sigs, const int *siglen, int nsig) {
    for (int s = 0, off = 0; s < nsig; off += siglen[s], s++) {
        int L = siglen[s];
        if (L > n) continue;
        int ok = 1;
        for (int k = 0; k < L; k++) if (prog[k] != sigs[off + k]) ok = 0;
        if (ok) return 1;
    }
    return 0;
}
```

```tests
#include <assert.h>
int scan(const unsigned char *, int, const unsigned char *, const int *, int);
int main(void) {
    unsigned char sigs[] = { 0xDE, 0xAD,        /* signature 0, length 2 */
                             0xBE, 0xEF, 0x01 };/* signature 1, length 3 */
    int len[] = { 2, 3 };
    unsigned char p1[] = { 0xDE, 0xAD, 0x00 };
    assert(scan(p1, 3, sigs, len, 2) == 1);
    /* Not at position zero. */
    unsigned char p2[] = { 0x00, 0x00, 0xDE, 0xAD };
    assert(scan(p2, 4, sigs, len, 2) == 1);
    /* The second signature, also not at zero. */
    unsigned char p3[] = { 0x11, 0xBE, 0xEF, 0x01 };
    assert(scan(p3, 4, sigs, len, 2) == 1);
    unsigned char p4[] = { 0x11, 0x22, 0x33 };
    assert(scan(p4, 3, sigs, len, 2) == 0);
    /* Same bytes, reordered. Same behaviour, and invisible to a scanner. */
    unsigned char p5[] = { 0xAD, 0xDE, 0x01, 0xEF, 0xBE };
    assert(scan(p5, 5, sigs, len, 2) == 0);
    return 0;
}
```

```solution
int scan(const unsigned char *prog, int n,
         const unsigned char *sigs, const int *siglen, int nsig) {
    for (int s = 0, off = 0; s < nsig; off += siglen[s], s++) {
        int L = siglen[s];
        for (int start = 0; start + L <= n; start++) {
            int ok = 1;
            for (int k = 0; k < L; k++)
                if (prog[start + k] != sigs[off + k]) { ok = 0; break; }
            if (ok) return 1;
        }
    }
    return 0;
}
```

## Unsound on purpose

The second escape. A heuristic that is usually right and can miss things, which
is where most linters live.

Write `looks_infinite`, which reports 1 when an instruction jumps to itself with
nothing that could change the condition. It must never report 1 for a program
that terminates, and it is allowed to report 0 for programs that do not.

@kind output
@concept A tool that only reported certainties would report almost nothing, so
useful bug finders accept false negatives and refuse false positives.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A jump to the same index, where the instruction does not modify anything,
is a loop with no way out.
@diagnose assert verdict assert-failed
A check disagrees. The safe direction matters more than the complete one: a
program that terminates must never be reported as infinite, so the pattern has
to be narrow enough that everything it matches really does loop.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The last two checks are programs that never terminate and are not
detected. That is the deal: every real one of these misses things, and the
alternative is not a better heuristic, it is either rejecting working code or
deciding something nobody can decide.

```starter
int looks_infinite(const int *ops, const int *jump, int n) {
    for (int i = 0; i < n; i++) {
        if (jump[i] <= i && jump[i] >= 0) return 1;
    }
    return 0;
}
```

```tests
#include <assert.h>
int looks_infinite(const int *, const int *, int);
int main(void) {
    /* op 0 does nothing. op 1 modifies state. */
    int o1[] = {0, 0, 0}, j1[] = {-1, 1, -1};
    assert(looks_infinite(o1, j1, 3) == 1);
    int o2[] = {0, 0, 0}, j2[] = {-1, -1, -1};
    assert(looks_infinite(o2, j2, 3) == 0);
    /* A backward jump over an instruction that changes state. Terminates for
       all this analysis knows, so it must not be reported. */
    int o3[] = {1, 0, 0}, j3[] = {-1, 0, -1};
    assert(looks_infinite(o3, j3, 3) == 0);
    /* A self-jump on an instruction that does modify state. Not reported. */
    int o4[] = {1, 0, 0}, j4[] = {0, -1, -1};
    assert(looks_infinite(o4, j4, 3) == 0);
    /* Two instructions jumping to each other. Infinite, and missed. */
    int o5[] = {0, 0}, j5[] = {1, 0};
    assert(looks_infinite(o5, j5, 2) == 0);
    return 0;
}
```

```solution
int looks_infinite(const int *ops, const int *jump, int n) {
    for (int i = 0; i < n; i++) {
        if (jump[i] == i && ops[i] == 0) return 1;
    }
    return 0;
}
```
