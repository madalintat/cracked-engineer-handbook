## Branch on data, or compute nothing

`run_fixed` executes a tiny program of three opcodes: 0 adds 1, 1 doubles, 2
halts. It has no jump, so the number of steps is decided before it starts.

Write it. The checks confirm what it computes and, in the last case, confirm
what it cannot: a program of this shape cannot loop, so it cannot do work
proportional to its input.

@kind output
@concept Without a data-dependent branch the sequence of operations is fixed in
advance, which is the difference between a calculator and a computer.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Walk the program array once. Stop at opcode 2 or at the end.
@diagnose assert verdict assert-failed
A check disagrees. Run the first program by hand: `{0, 1, 2}` on an accumulator
of 0 gives 1 after the add and 2 after the double, and the halt stops it there.
The starter returns before executing anything.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Every program this machine can run takes at most as many steps as it has
instructions. Adding one instruction, jump backwards if the accumulator is not
zero, would remove that ceiling entirely, and that single addition is the whole
subject of this unit.

```starter
int run_fixed(const int *prog, int n, int acc) {
    (void)prog; (void)n;
    return acc;
}
```

```tests
#include <assert.h>
int main(void) {
    int p1[] = {0, 1, 2};
    assert(run_fixed(p1, 3, 0) == 2);
    int p2[] = {1, 1, 1};
    assert(run_fixed(p2, 3, 1) == 8);
    int p3[] = {2, 0, 0};
    assert(run_fixed(p3, 3, 7) == 7);
    int p4[] = {0, 0, 0, 0};
    assert(run_fixed(p4, 4, 0) == 4);
    return 0;
}
```

```solution
int run_fixed(const int *prog, int n, int acc) {
    for (int i = 0; i < n; i++) {
        if (prog[i] == 0) acc += 1;
        else if (prog[i] == 1) acc *= 2;
        else break;
    }
    return acc;
}
```

## One instruction is enough

Subleq is a machine with a single instruction. Each instruction is three cells:
subtract the value at address `a` from the value at address `b`, store the result
at `b`, and if that result is less than or equal to zero, jump to `c`. Otherwise
continue to the next instruction.

Write `subleq_step`, which executes one instruction and returns the new program
counter. Memory is an array you may modify.

@kind output
@concept Loop, branch on data and unbounded memory is the whole recipe, and one
instruction can supply all three.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Three cells, in order: the source, the destination, and the jump target.
The condition tests the value after the subtraction.
@diagnose assert verdict assert-failed
A check disagrees. The order matters: read `mem[a]` and `mem[b]`, store `mem[b]
- mem[a]` into `mem[b]`, and only then compare that stored result against zero.
Testing the old value of `mem[b]` gives the wrong branch on exactly the cases
the checks pick.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Nothing here can add, multiply, compare or call. Subtraction that jumps
when it goes non-positive is universal, and real compilers targeting this machine
exist. The lesson is not that you should use it: it is how little a system has to
offer before it can be programmed by someone who did not design it.

```starter
int subleq_step(int *mem, int pc) {
    int a = mem[pc], b = mem[pc + 1], c = mem[pc + 2];
    (void)a; (void)b; (void)c;
    return pc + 3;
}
```

```tests
#include <assert.h>
int main(void) {
    /* mem[5] -= mem[4]; 3 - 1 = 2, positive, so fall through. */
    int m1[] = {4, 5, 99, 0, 1, 3};
    assert(subleq_step(m1, 0) == 3);
    assert(m1[5] == 2);
    /* 1 - 3 = -2, non-positive, so jump to 99. */
    int m2[] = {5, 4, 99, 0, 1, 3};
    assert(subleq_step(m2, 0) == 99);
    assert(m2[4] == -2);
    /* Exactly zero also jumps. */
    int m3[] = {4, 5, 12, 0, 3, 3};
    assert(subleq_step(m3, 0) == 12);
    assert(m3[5] == 0);
    return 0;
}
```

```solution
int subleq_step(int *mem, int pc) {
    int a = mem[pc], b = mem[pc + 1], c = mem[pc + 2];
    mem[b] = mem[b] - mem[a];
    return mem[b] <= 0 ? c : pc + 3;
}
```

## The tape

A Turing machine's memory is a tape: it reads and writes the cell under the
head, and it can move one cell left or right and no further.

Write `tape_run`, which executes a rule table until it reaches state 255 or runs
out of steps. A rule is looked up by state and by the symbol under the head, and
it gives a symbol to write, a direction, and the next state.

@kind output
@concept Random access is not part of the definition of computation, and a model
without it computes the same functions at a very different cost.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Write, then move, then change state. The head is an index into the tape.
@diagnose assert verdict assert-failed
A check disagrees. Do the three actions in order and read the rule once: the
symbol written is the rule's, not the one that was there, and the state used to
find the rule is the old state rather than the new one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Everything this machine does costs a step per cell of travel. Sorting a
million numbers on it is not impossible, it is slow in a way that no cleverness
in the rule table repairs, which is the first hint that computable and practical
are different questions.

```starter
/* rules is a flat array of triples: write, move (2 right, 0 left), next state.
   The triple for (state, symbol) starts at (state * nsym + symbol) * 3. */
int tape_run(unsigned char *tape, const unsigned char *rules,
             int nsym, int head, int steps) {
    (void)rules; (void)nsym; (void)tape;
    for (int i = 0; i < steps; i++) { }
    return head;
}
```

```tests
#include <assert.h>
int tape_run(unsigned char *, const unsigned char *, int, int, int);
int main(void) {
    /* Two symbols. State 0 on symbol 0: write 1, move right, stay in state 0.
       State 0 on symbol 1: write 1, move right, go to state 255 and halt. */
    unsigned char rules[] = {
        1, 2, 0,   1, 2, 255,
        0, 0, 0,   0, 0, 0,
    };
    unsigned char tape[8] = {0, 0, 0, 1, 0, 0, 0, 0};
    int end = tape_run(tape, rules, 2, 0, 20);
    assert(end == 4);
    assert(tape[0] == 1 && tape[1] == 1 && tape[2] == 1 && tape[3] == 1);
    assert(tape[4] == 0);
    /* A machine that never reaches state 255 stops when the steps run out. */
    unsigned char spin[] = { 0, 2, 0 };
    unsigned char t2[8] = {0};
    assert(tape_run(t2, spin, 1, 0, 3) == 3);
    return 0;
}
```

```solution
int tape_run(unsigned char *tape, const unsigned char *rules,
             int nsym, int head, int steps) {
    int state = 0;
    for (int i = 0; i < steps && state != 255; i++) {
        const unsigned char *r = &rules[(state * nsym + tape[head]) * 3];
        tape[head] = r[0];
        head += (r[1] == 2) ? 1 : -1;
        state = r[2];
    }
    return head;
}
```

## Eight entries, and it computes everything

Rule 110 is a cellular automaton. Each cell's next value depends on itself and
its two neighbours, and the rule is the eight-bit number 110 read as a lookup
table over those three bits.

Write `rule110_step`. The array wraps at both ends.

@kind output
@concept Universality is not a property of rich systems, it is a property of
systems with a loop and a data-dependent choice, and it arrives uninvited.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Form a three-bit index from left, centre and right, then select that bit
of 110.
@diagnose assert verdict assert-failed
A check disagrees. The index is left times four plus centre times two plus
right, and the answer is bit `index` of the constant 110. Getting the bit order
backwards produces rule 124, which is a different automaton and is not universal.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Rule 110 is universal, which was conjectured in the 1980s and proved in
2004. Its entire definition is the number 110. Nothing about it was designed to
compute anything, and it computes everything, which is the strongest statement of
this unit's point available.

```starter
void rule110_step(const unsigned char *in, unsigned char *out, int n) {
    for (int i = 0; i < n; i++) out[i] = in[i];
}
```

```tests
#include <assert.h>
void rule110_step(const unsigned char *, unsigned char *, int);
int main(void) {
    unsigned char a[8] = {0, 0, 0, 0, 0, 0, 0, 1};
    unsigned char b[8];
    rule110_step(a, b, 8);
    /* The single 1 grows leftwards, which is what rule 110 does. */
    unsigned char want1[8] = {0, 0, 0, 0, 0, 0, 1, 1};
    for (int i = 0; i < 8; i++) assert(b[i] == want1[i]);
    rule110_step(b, a, 8);
    unsigned char want2[8] = {0, 0, 0, 0, 0, 1, 1, 1};
    for (int i = 0; i < 8; i++) assert(a[i] == want2[i]);
    unsigned char z[4] = {0, 0, 0, 0}, zo[4];
    rule110_step(z, zo, 4);
    for (int i = 0; i < 4; i++) assert(zo[i] == 0);
    return 0;
}
```

```solution
void rule110_step(const unsigned char *in, unsigned char *out, int n) {
    for (int i = 0; i < n; i++) {
        int l = in[(i - 1 + n) % n], c = in[i], r = in[(i + 1) % n];
        int idx = (l << 2) | (c << 1) | r;
        out[i] = (110 >> idx) & 1;
    }
}
```

## No memory, no counting

A finite-state machine has a fixed number of states and no storage beyond them.
That is enough to recognise some languages and provably not enough for others.

Write `balanced`, which reports whether a string of brackets is balanced, using a
counter. Then read the last check, which is the point of the exercise.

@kind output
@concept Unbounded storage is the third ingredient, and the language of balanced
brackets is the standard demonstration that no fixed amount of state suffices.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One counter. It must never go negative, and it must be zero at the end.
@diagnose assert verdict assert-failed
A check disagrees. Two conditions, not one: the depth must end at zero, and it
must never drop below zero on the way. A string like `)(` ends at depth zero and
is not balanced.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Your counter is the unbounded memory. A machine with a fixed number of
states can recognise up to some nesting depth and no further, and the pumping
lemma turns that into a proof. It is also why a regular expression cannot match
nested brackets, which is the practical form of the same fact and the subject of
the next unit.

```starter
int balanced(const char *s) {
    int depth = 0;
    for (const char *p = s; *p; p++) {
        if (*p == '(') depth++;
        else if (*p == ')') depth--;
    }
    return 1;
}
```

```tests
#include <assert.h>
int balanced(const char *);
int main(void) {
    assert(balanced("") == 1);
    assert(balanced("()") == 1);
    assert(balanced("(())") == 1);
    assert(balanced("(()(()))") == 1);
    assert(balanced("(") == 0);
    assert(balanced(")") == 0);
    assert(balanced(")(") == 0);
    assert(balanced("(()") == 0);
    return 0;
}
```

```solution
int balanced(const char *s) {
    int depth = 0;
    for (const char *p = s; *p; p++) {
        if (*p == '(') depth++;
        else if (*p == ')') {
            depth--;
            if (depth < 0) return 0;
        }
    }
    return depth == 0;
}
```

## The universal machine, in eighty lines

An interpreter is a machine whose input is a description of another machine.
Write one.

`interp` runs a stack language of five opcodes: 0 pushes the next cell, 1 adds
the top two, 2 multiplies them, 3 duplicates the top, 4 halts. It returns the
value on top of the stack when it halts.

@kind output
@concept A universal machine takes a program as data, which is the construction
that separated hardware from software.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Push takes an operand, so it advances the counter by two. The others
advance by one.
@diagnose assert verdict assert-failed
A check disagrees. Watch the program counter: opcode 0 is followed by its
operand, so after handling it the counter moves two cells, and the arithmetic
opcodes move one. Advancing uniformly makes the interpreter read operands as
opcodes.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is Turing's universal machine with the numbers changed. Your C
program is one machine, the array you handed it describes another, and the fact
that the first can carry out the second is the entire result. Part IX builds this
again with a parser in front of it and calls it a language.

```starter
int interp(const int *prog, int n) {
    int stack[64], sp = 0;
    (void)n;
    stack[sp++] = prog[0];
    return stack[sp - 1];
}
```

```tests
#include <assert.h>
int interp(const int *, int);
int main(void) {
    int p1[] = {0, 2, 0, 3, 1, 4};          /* push 2, push 3, add   */
    assert(interp(p1, 6) == 5);
    int p2[] = {0, 4, 0, 5, 2, 4};          /* push 4, push 5, mul   */
    assert(interp(p2, 6) == 20);
    int p3[] = {0, 7, 3, 1, 4};             /* push 7, dup, add      */
    assert(interp(p3, 5) == 14);
    int p4[] = {0, 2, 3, 2, 3, 2, 4};       /* 2, dup, mul, dup, mul */
    assert(interp(p4, 7) == 16);
    return 0;
}
```

```solution
int interp(const int *prog, int n) {
    int stack[64], sp = 0;
    int pc = 0;
    while (pc < n) {
        switch (prog[pc]) {
        case 0: stack[sp++] = prog[pc + 1]; pc += 2; break;
        case 1: stack[sp - 2] = stack[sp - 2] + stack[sp - 1]; sp--; pc++; break;
        case 2: stack[sp - 2] = stack[sp - 2] * stack[sp - 1]; sp--; pc++; break;
        case 3: stack[sp] = stack[sp - 1]; sp++; pc++; break;
        default: return stack[sp - 1];
        }
    }
    return stack[sp - 1];
}
```

## Recursion and iteration are the same thing

Any loop can be written as a recursive call and any recursive call whose result
is returned directly can be written as a loop. That is not a style preference,
it is why models with only recursion and models with only loops compute the same
functions.

Write `collatz_len` iteratively. The checks include a value whose recursive
version would need thousands of frames.

@kind output
@concept A tail call is a jump with arguments, so a language with recursion and
no loops is not missing anything.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count steps until the value reaches 1. Even halves, odd triples and adds
one.
@diagnose assert verdict assert-failed
A check disagrees. The count is the number of steps taken, so a value that is
already 1 has a length of 0, and each transformation adds exactly one.
@diagnose compile verdict compile-error
Read the line the compiler names. `unsigned long long` needs no header.
@after Nobody knows whether this function terminates for every input. It has
been checked to enormous values and there is no proof, which makes it a concrete
example of the thing unit 018 is about: a program whose halting nobody can
decide, sitting in eight lines of C.

```starter
int collatz_len(unsigned long long n) {
    int steps = 0;
    while (n != 1) {
        n = n / 2;
        steps++;
    }
    return steps;
}
```

```tests
#include <assert.h>
int collatz_len(unsigned long long);
int main(void) {
    assert(collatz_len(1) == 0);
    assert(collatz_len(2) == 1);
    assert(collatz_len(3) == 7);
    assert(collatz_len(6) == 8);
    assert(collatz_len(27) == 111);
    assert(collatz_len(97) == 118);
    return 0;
}
```

```solution
int collatz_len(unsigned long long n) {
    int steps = 0;
    while (n != 1) {
        n = (n % 2 == 0) ? n / 2 : 3 * n + 1;
        steps++;
    }
    return steps;
}
```

## The accident

A configuration format that was not meant to be a language. Each entry either
sets a value or, if its argument names another entry, copies from it. Following
those references is the loop, and the reference itself is the data-dependent
branch.

Write `resolve`, which follows a chain of references and returns the value at the
end. Return -1 if the chain does not terminate within `n` steps.

@kind output
@concept A system with a loop and a data-dependent choice is programmable by
whoever supplies its input, whether or not that was the intent.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A negative entry is a value. A non-negative one is an index to follow.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the cycle. A chain that points back at itself
never reaches a value, so a resolver with no step limit runs forever on input
that is eight bytes long.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is accidental universality in its smallest form, and the bug it
causes is the reason so many parsers have a depth limit that looks arbitrary.
The limit is not arbitrary: without it, the input decides how long the program
runs, and unit 018 proves nobody can write a checker that accepts exactly the
inputs that terminate.

```starter
int resolve(const int *entries, int n, int start) {
    (void)n;
    return entries[start];
}
```

```tests
#include <assert.h>
int resolve(const int *, int, int);
int main(void) {
    /* Negative is a literal value; non-negative is a reference. */
    int a[] = {-5, 0, 1};
    assert(resolve(a, 3, 0) == -5);
    assert(resolve(a, 3, 1) == -5);
    assert(resolve(a, 3, 2) == -5);
    int b[] = {1, 0};                 /* 0 -> 1 -> 0, a cycle */
    assert(resolve(b, 2, 0) == -1);
    int c[] = {3, 2, 3, -9};
    assert(resolve(c, 4, 0) == -9);
    assert(resolve(c, 4, 1) == -9);
    return 0;
}
```

```solution
int resolve(const int *entries, int n, int start) {
    int at = start;
    for (int i = 0; i <= n; i++) {
        if (entries[at] < 0) return entries[at];
        at = entries[at];
    }
    return -1;
}
```
