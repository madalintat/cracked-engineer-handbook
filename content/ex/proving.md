## Two expressions, one function

De Morgan says the complement of an and is the or of the complements. Prove it
by building `demorgan` as an or of two inverted inputs and letting the solver
prove it equals `~(a & b)`.

The starter inverts one input and forgets the other.

@kind property
@concept An equivalence check compares two descriptions over every input, so
two forms of one function either agree everywhere or the tool names where they
do not.
@backend yosys
@expect verdict sat-fail
@hint Both inputs are complemented. Neither the result nor one of them.
@diagnose sat verdict sat-fail
The solver names the assignment where you and the reference disagree, and here
it is the one input whose complement is missing. Four cases exist and the
starter gets three of them right, which is exactly the kind of near miss a
handful of hand-picked tests would let through.
@diagnose syntax verdict syntax-error
Read the line the parser names. Bitwise not is `~`.
@after Four cases, proved rather than tried. At this width the difference is
academic, and the next exercise is at a width where it is not.

```starter
module demorgan(input a, input b, output y);
  assign y = ~a | b;
endmodule
```

```solution
module demorgan(input a, input b, output y);
  assign y = ~a | ~b;
endmodule
```

```spec
{"top": "demorgan",
 "gold": "module gold(input a, input b, output y); assign y = ~(a & b); endmodule"}
```

## The case a sample would miss

Build `add8`, an eight-bit adder with a nine-bit result. The starter is correct
for 65280 of the 65536 input pairs.

Testing at random has a one in 256 chance of finding the fault per attempt. The
solver finds it every time, and tells you which pair.

@kind property
@concept A design that is right almost everywhere is the normal shape of a
hardware bug, and it is the shape sampling is worst at.
@backend yosys
@expect verdict sat-fail
@hint Look at what the carry input to the addition is, and ask when that value
is not zero.
@diagnose sat verdict sat-fail
Read the counterexample. The starter adds an extra 1 whenever the top bit of
`a` is set, because `a[7]` was used where a carry input of 0 belongs. Every pair
with `a` under 128 is correct, which is 65280 of them, and the fault is in the
remaining 256.
@diagnose syntax verdict syntax-error
Read the line the parser names. A vector output is `output [8:0] s`.
@after 65536 cases decided at once. The Pentium's table was 1066 entries with 5
wrong, which is a rarer fault than this one and was still expensive enough to
change how the industry works.

```starter
module add8(input [7:0] a, input [7:0] b, output [8:0] s);
  assign s = a + b + a[7];
endmodule
```

```solution
module add8(input [7:0] a, input [7:0] b, output [8:0] s);
  assign s = a + b;
endmodule
```

```spec
{"top": "add8",
 "gold": "module gold(input [7:0] a, input [7:0] b, output [8:0] s); assign s = a + b; endmodule"}
```

## A property, with no reference to be wrong

A two to four decoder should raise exactly one output. Rather than compare
against another decoder, `onehot` computes the claim itself: it builds the four
outputs and then reports whether exactly one of them is high.

The reference is the constant 1. Proving your module equal to it proves the
property holds for every input.

@kind property
@concept A property has no second implementation, so a misunderstanding cannot
survive by being made twice.
@backend yosys
@expect verdict sat-fail
@hint The starter's four outputs do not cover all four input combinations.
Write out which value of `sel` lights nothing.
@diagnose sat verdict sat-fail
The solver names a value of `sel` where the claim is false. Decode the four
cases by hand: the starter's third line repeats a condition the second already
covers, so one combination raises two outputs and another raises none.
@diagnose syntax verdict syntax-error
Read the line the parser names. A two-bit input is `input [1:0] sel`.
@after The reference is a constant, so there is nothing in it to get wrong. This
is the cheapest form of formal verification there is and it catches a class of
bug that a reference model, written by the same person on the same afternoon,
tends not to.

```starter
module onehot(input [1:0] sel, output ok);
  wire [3:0] d;
  assign d[0] = (sel == 2'b00);
  assign d[1] = (sel == 2'b01);
  assign d[2] = (sel == 2'b01);
  assign d[3] = (sel == 2'b11);
  assign ok = (d[0] + d[1] + d[2] + d[3]) == 1;
endmodule
```

```solution
module onehot(input [1:0] sel, output ok);
  wire [3:0] d;
  assign d[0] = (sel == 2'b00);
  assign d[1] = (sel == 2'b01);
  assign d[2] = (sel == 2'b10);
  assign d[3] = (sel == 2'b11);
  assign ok = (d[0] + d[1] + d[2] + d[3]) == 1;
endmodule
```

```spec
{"top": "onehot",
 "gold": "module gold(input [1:0] sel, output ok); assign ok = 1'b1; endmodule"}
```

## Never both at once

Build `arbiter`, which grants one of two requests and prefers request 0 when
both arrive. It reports `safe`, which is high when the two grants are not both
high.

The reference is again the constant 1, so what gets proved is that the arbiter
can never grant both in the same cycle, for any request pattern.

@kind property
@concept Mutual exclusion is a property rather than a value, and stating it
directly is cheaper than building a second arbiter to compare against.
@backend yosys
@expect verdict sat-fail
@hint Grant 1 has to know that grant 0 was not given.
@diagnose sat verdict sat-fail
The solver names the request pattern that breaks it, and it will be both
requests high at once. The starter grants each request independently, so the
priority it claims to have does not exist: nothing about grant 1 refers to
request 0.
@diagnose syntax verdict syntax-error
Read the line the parser names.
@after A bus arbiter that grants twice is a short circuit on the shared bus from
Part II, and it is a fault that appears only under a request pattern that may be
rare in traffic and is not rare at all to a solver.

```starter
module arbiter(input r0, input r1, output g0, output g1, output safe);
  assign g0 = r0;
  assign g1 = r1;
  assign safe = ~(g0 & g1);
endmodule
```

```solution
module arbiter(input r0, input r1, output g0, output g1, output safe);
  assign g0 = r0;
  assign g1 = r1 & ~r0;
  assign safe = ~(g0 & g1);
endmodule
```

```spec
{"top": "arbiter",
 "gold": "module gold(input r0, input r1, output g0, output g1, output safe); assign g0 = r0; assign g1 = r1 & ~r0; assign safe = 1'b1; endmodule"}
```

## Unsigned is not signed

Build `lt`, high when `a` is less than `b`, treating both as two's complement
signed values.

The starter compares them as unsigned. Half the input space is correct.

@kind property
@concept Whether a comparison is signed is a property of the operator rather
than of the bits, and the bits look identical either way.
@backend yosys
@expect verdict sat-fail
@hint Verilog compares unsigned unless something in the expression is signed.
Declare the inputs, or cast them.
@diagnose sat verdict sat-fail
The solver names a pair where you disagree, and it will be one where exactly
one operand has its top bit set. As unsigned, a negative number is the large
one; as signed it is the small one. Both readings of the same four bits are
legitimate and the operator has to be told which you meant.
@diagnose syntax verdict syntax-error
Read the line the parser names. A signed vector is `input signed [3:0] a`.
@after The bits never changed. This is the whole content of unit 027 arriving
early: a representation is a decision about how to read a pattern, and nothing
in the pattern records which decision was made.

```starter
module lt(input [3:0] a, input [3:0] b, output y);
  assign y = a < b;
endmodule
```

```solution
module lt(input signed [3:0] a, input signed [3:0] b, output y);
  assign y = a < b;
endmodule
```

```spec
{"top": "lt",
 "gold": "module gold(input signed [3:0] a, input signed [3:0] b, output y); assign y = a < b; endmodule"}
```

## Proving across a clock edge

Two shift registers, one written as a chain of named flops and one as a vector
shift. Prove them equal.

This one needs induction rather than a table: the outputs depend on state, and
the sequences of inputs that could have produced that state are infinite.

@kind property
@concept Induction over one clock edge covers every sequence of any length, and
it is the same induction you already know.
@backend yosys
@expect verdict sat-fail
@hint Count the stages the reference has, then count yours.
@diagnose sat verdict sat-fail
Your design and the reference disagree after some sequence of inputs. Count the
flops: the reference delays by three edges and the starter delays by two, so
they differ from the third cycle onwards and agree before it. A test that ran
for two cycles would have passed.
@diagnose cells verdict cell-budget
The design is correct and the number of flip-flops is not three. A delay of
three edges is exactly three flops, and the optimiser will not remove one
unless two of them always agree.
@diagnose syntax verdict syntax-error
Read the line the parser names. Use non-blocking assignment inside a clocked
block.
@after The inductive argument proves agreement in the reset state, then proves
that agreement survives an edge. Nothing enumerated a sequence, which is
fortunate, because there is no longest one.

```starter
module shift3(input clk, input d, output q);
  reg a, b;
  always @(posedge clk) begin
    a <= d;
    b <= a;
  end
  assign q = b;
endmodule
```

```solution
module shift3(input clk, input d, output q);
  reg a, b, c;
  always @(posedge clk) begin
    a <= d;
    b <= a;
    c <= b;
  end
  assign q = c;
endmodule
```

```spec
{"top": "shift3", "cells": {"$_DFF_P_": 3},
 "gold": "module gold(input clk, input d, output q); reg [2:0] r; always @(posedge clk) r <= {r[1:0], d}; assign q = r[2]; endmodule"}
```

## A counter that must not exceed its bound

Build `count5`, which counts 0 to 4 and wraps to 0. It reports `inrange`, high
when the count is at most 4.

Prove `inrange` is always high. That is a claim about every reachable state
after every sequence of edges, which is the kind of claim testing cannot make.

@kind property
@concept A bound on a state machine is proved by induction over one edge, so it
holds for every run length rather than the ones you simulated.
@backend yosys
@expect verdict sat-fail
@hint What does the counter do after 4?
@diagnose sat verdict sat-fail
The property is false in some reachable state. The starter wraps at the wrong
value, so the count reaches 5 for one cycle before returning to 0. A simulation
that checked the count only on the cycles it printed could easily miss a single
cycle of overshoot.
@diagnose cells verdict cell-budget
Correct, and larger than a three-bit counter with a comparison needs. Three
flops hold values up to 4, and the wrap condition is one equality test. A
counter wider than the range it uses will overshoot this budget.
@diagnose syntax verdict syntax-error
Read the line the parser names.
@after The proof covers a run of any length, including the ones nobody will
ever simulate. The starter's bug is one cycle wide and periodic, which is
precisely the shape that survives a test bench and reaches a customer.

```starter
module count5(input clk, output [2:0] q, output inrange);
  reg [2:0] c = 0;
  always @(posedge clk)
    c <= (c == 3'd5) ? 3'd0 : c + 3'd1;
  assign q = c;
  assign inrange = (c <= 3'd4);
endmodule
```

```solution
module count5(input clk, output [2:0] q, output inrange);
  reg [2:0] c = 0;
  always @(posedge clk)
    c <= (c == 3'd4) ? 3'd0 : c + 3'd1;
  assign q = c;
  assign inrange = (c <= 3'd4);
endmodule
```

```spec
{"top": "count5", "maxCells": 12,
 "gold": "module gold(input clk, output [2:0] q, output inrange); reg [2:0] c = 0; always @(posedge clk) c <= (c == 3'd4) ? 3'd0 : c + 3'd1; assign q = c; assign inrange = 1'b1; endmodule"}
```

## Proved, and too big

Build `eq8`, high when the two eight-bit inputs are equal, in at most fifteen
cells.

The starter subtracts and tests the difference against zero. It is correct, the
solver proves it, and it costs 40 cells because a subtractor is a carry chain
and equality does not need one.

Both checks run here: the proof, and then a real synthesis whose cells are
counted.

@kind property
@concept Correct and shippable are different claims, and a proof of the first
says nothing at all about the second.
@backend yosys
@expect verdict cell-budget
@hint Two vectors are equal when no bit position differs. Nothing about that
needs a carry.
@diagnose cells verdict cell-budget
The proof passed, so this is correct. It is also carrying a subtractor: `a - b`
builds a borrow chain across all eight bits, every stage of which has to settle,
and then the comparison against zero throws almost all of it away. At four bits
the optimiser flattens the difference and at eight it cannot.
@diagnose sat verdict sat-fail
Smaller, and no longer equal to `a == b`. Check the polarity: exclusive or is 1
where the bits differ, so equality is the case where none of them is.
@diagnose syntax verdict syntax-error
Read the line the parser names. Reduction or is a leading `|` on a vector.
@after Fifteen cells against 40, for the same function proved the same way. This
is the pairing the rest of Part III runs on: a proof answers whether the design
computes the right thing and says nothing about what it costs, and the carry
chain the starter dragged in is also the slowest thing in it.

```starter
module eq8(input [7:0] a, input [7:0] b, output y);
  assign y = ((a - b) == 8'd0);
endmodule
```

```solution
module eq8(input [7:0] a, input [7:0] b, output y);
  assign y = ~|(a ^ b);
endmodule
```

```spec
{"top": "eq8", "maxCells": 15,
 "gold": "module gold(input [7:0] a, input [7:0] b, output y); assign y = (a == b); endmodule"}
```
