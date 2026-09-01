## Two statements, one circuit

Build `and3`, whose output is the and of all three inputs, using two continuous
assignments and one internal wire. The checker proves it against `a & b & c`.

The starter writes the two lines in the order a program would need. Leave them
in that order. The bug is in one of the expressions, not in where it sits.

@kind property
@concept A continuous assignment is a permanent connection, so the line that
drives a wire may be written after the line that reads it.
@backend yosys
@expect verdict sat-fail
@hint Read what `t` is connected to, then read what `y` is connected to, and
ask which input never reaches the output.
@diagnose sat verdict sat-fail
The solver found inputs where your module and `a & b & c` disagree. One of the
three inputs is not wired into the result at all: follow `y` back through `t`
and see which letter never appears.
@diagnose syntax verdict syntax-error
Read the line the parser names. Every continuous assignment needs `assign`, and
every internal signal needs a `wire` declaration before something drives it.
@after The order of the two lines never mattered. Swap them and synthesise
again: the same two gates, because a circuit has no first line.

```starter
module and3(input a, input b, input c, output y);
  wire t;
  assign y = t & a;
  assign t = a & b;
endmodule
```

```solution
module and3(input a, input b, input c, output y);
  wire t;
  assign y = t & c;
  assign t = a & b;
endmodule
```

```spec
{"top": "and3",
 "gold": "module gold(input a, input b, input c, output y); assign y = a & b & c; endmodule"}
```

## Two things soldered to one wire

The starter drives `y` twice, once from each of the two functions it was meant
to choose between. Synthesise it and read what the tool says.

Fix it by driving `y` once, from a selection between the two, using `s`. When
`s` is 0 the output is the and, and when `s` is 1 it is the or.

@kind property
@concept A wire is a node with one driver, and two continuous assignments to
the same name describe two gate outputs soldered together.
@backend yosys
@expect verdict multi-driver
@hint One assignment, and the choice goes inside the expression.
@diagnose multi verdict multi-driver
The tool names the signal that two things drive. Nothing here is an override:
the second assignment does not replace the first, because there is no first.
Both connections exist at once, which is a short circuit in copper and an
error here.
@diagnose sat verdict sat-fail
One driver now, and it selects the wrong way round. `s` at 0 should give the
and.
@diagnose syntax verdict syntax-error
Read the line the parser names.
@after The rule is the one from the shared bus in Part II, enforced at build
time instead of by smoke. A synthesiser can catch it because it can see every
driver at once, which is exactly what a wire being a node rather than a
variable means.

```starter
module pick(input a, input b, input s, output y);
  assign y = a & b;
  assign y = a | b;
endmodule
```

```solution
module pick(input a, input b, input s, output y);
  assign y = s ? (a | b) : (a & b);
endmodule
```

```spec
{"top": "pick",
 "gold": "module gold(input a, input b, input s, output y); assign y = s ? (a | b) : (a & b); endmodule"}
```

## A swap needs no temporary

Build `swap`, where `x` follows `b` and `y` follows `a`.

In a program this needs a third variable, because the first assignment destroys
what the second one wanted to read. Here it does not, and the starter is what
the programmer's habit produces.

@kind property
@concept Nothing is destroyed by a connection, so the sequencing that a
software swap needs has nothing to sequence.
@backend yosys
@expect verdict sat-fail
@hint Each output is connected to an input. Say which, and write those two
connections.
@diagnose sat verdict sat-fail
Follow the wires. The starter connects `x` to `a`, then connects `y` to `x`,
which is the same node, so both outputs carry `a` and `b` never leaves the
module. Reading a wire does not consume it, and writing one does not happen at
a moment, so the temporary has nothing to protect.
@diagnose syntax verdict syntax-error
Read the line the parser names.
@after Two wires crossing. There is no third gate and no instant at which the
old value is at risk, which is the difference between a connection and an
assignment stated as compactly as it can be.

```starter
module swap(input a, input b, output x, output y);
  assign x = a;
  assign y = x;
endmodule
```

```solution
module swap(input a, input b, output x, output y);
  assign x = b;
  assign y = a;
endmodule
```

```spec
{"top": "swap",
 "gold": "module gold(input a, input b, output x, output y); assign x = b; assign y = a; endmodule"}
```

## What cannot change is not built

Build `mask`, whose output is `a` unchanged. Write it as `a` combined with a
constant, so that the expression contains a gate and the result does not.

The budget is zero cells. Anything that survives the optimiser fails.

@kind property
@concept The optimiser deletes what cannot change, so a cell count reports what
you asked for rather than what you typed.
@backend yosys
@expect verdict sat-fail
@hint Which constant makes an and gate do nothing? Which one makes an or gate
do nothing?
@diagnose sat verdict sat-fail
The output is a constant rather than `a`, so the solver finds an input where
you disagree. `a & 1'b0` is always 0 and `a | 1'b1` is always 1: you picked the
constant that wins the expression instead of the one that yields to it.
@diagnose cells verdict cell-budget
Correct now, and a cell survived. Something in the expression still depends on
more than `a`, so there is real logic left for the optimiser to keep. The
identity you want folds all the way down to a plain wire.
@diagnose syntax verdict syntax-error
Read the line the parser names. A one-bit constant is written `1'b0` or `1'b1`.
@after Zero cells for a line that clearly contains a gate. This is why the
report is worth more than your reading of the source, and it is also why a
design can silently be smaller than intended: the tool deletes an unused output
with exactly the same enthusiasm.

```starter
module mask(input a, output y);
  assign y = a & 1'b0;
endmodule
```

```solution
module mask(input a, output y);
  assign y = a & 1'b1;
endmodule
```

```spec
{"top": "mask", "maxCells": 0,
 "gold": "module gold(input a, output y); assign y = a; endmodule"}
```

## The carry falls out in the middle

Build `add4`, a four-bit adder whose five-bit output holds the sum including the
carry.

The starter computes the sum into an internal wire and then widens it. Both
lines look reasonable. The result is wrong for a third of the input pairs.

@kind property
@concept Width is decided where an expression is evaluated, not where its
result eventually lands.
@backend yosys
@expect verdict sat-fail
@hint The addition has to be five bits wide at the moment it is performed.
@diagnose sat verdict sat-fail
The solver names an input pair where you disagree with `a + b`, and it will be
one where the sum exceeds 15. The starter adds at the width of `t`, which is
four bits, so the carry is discarded before the widening to five bits ever
happens. Widening afterwards cannot recover a bit that was already dropped.
@diagnose syntax verdict syntax-error
Read the line the parser names. A vector is declared as `wire [4:0] name;`.
@after Assigning straight to the five-bit output makes the addition five bits
wide, because the width of a continuous assignment is decided by the widest
thing in it, including the left side. The intermediate wire was not a step
along the way, it was a narrower circuit.

```starter
module add4(input [3:0] a, input [3:0] b, output [4:0] s);
  wire [3:0] t;
  assign t = a + b;
  assign s = t;
endmodule
```

```solution
module add4(input [3:0] a, input [3:0] b, output [4:0] s);
  assign s = a + b;
endmodule
```

```spec
{"top": "add4",
 "gold": "module gold(input [3:0] a, input [3:0] b, output [4:0] s); assign s = a + b; endmodule"}
```

## A loop is four gates, not four passes

Build `parity4`, whose output is the exclusive or of all four bits of `a`.

Write it with a `for` loop. There is no counter in the result: the tool unrolls
the loop while elaborating and emits the gates side by side.

@kind property
@concept A loop bound has to be known at build time because it decides how many
copies of the body exist, and hardware cannot change how much of itself there
is.
@backend yosys
@expect verdict sat-fail
@hint Four bits means four terms. Count how many the starter's bounds actually
produce.
@diagnose sat verdict sat-fail
The solver disagrees with you on an input where the bit you skipped is 1. Count
the iterations: the starter's condition stops one short, so one of the four
gates is never emitted and that bit of `a` reaches nothing.
@diagnose syntax verdict syntax-error
Read the line the parser names. A `for` loop that assigns needs to sit inside
an `always @*` block, and the target has to be declared `reg`.
@after Four XOR gates, all of which exist at once and settle together. Change
the bound to eight and you have eight gates and a longer path to settle, which
is the sense in which a loop here is a multiplier rather than a cost you pay
once.

```starter
module parity4(input [3:0] a, output reg y);
  integer i;
  always @* begin
    y = 1'b0;
    for (i = 0; i < 3; i = i + 1)
      y = y ^ a[i];
  end
endmodule
```

```solution
module parity4(input [3:0] a, output reg y);
  integer i;
  always @* begin
    y = 1'b0;
    for (i = 0; i < 4; i = i + 1)
      y = y ^ a[i];
  end
endmodule
```

```spec
{"top": "parity4",
 "gold": "module gold(input [3:0] a, output y); assign y = ^a; endmodule"}
```

## The carry chain, one stage at a time

Build `ripple4` structurally: four full adder stages, each taking the carry the
previous stage produced.

The starter wires every stage's carry input to the module's `cin`. Each stage is
correct on its own and the whole thing is wrong, which is the failure a
structural description makes easy to write and easy to see.

@kind property
@concept Instances are separate hardware, so what connects them is the only
thing that makes a chain a chain.
@backend yosys
@expect verdict sat-fail
@hint Stage 1 needs the carry that stage 0 produced, not the one the module was
given.
@diagnose sat verdict sat-fail
The solver names inputs where you disagree with `a + b + cin`, and the smallest
one will be a pair that carries out of bit 0. Every stage in the starter is
handed the same carry, so a carry generated inside the adder never travels. The
chain is the wiring, not the stages.
@diagnose syntax verdict syntax-error
Read the line the parser names. An instance is `name inst (.port(signal), ...)`
with a semicolon.
@after This is the adder from Part II with the same carry path and the same
worst case, where bit 0 decides bit 3 and every stage between them has to
settle in order. Unit 016 measures what that costs.

```starter
module fa(input a, input b, input cin, output s, output cout);
  assign s = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));
endmodule

module ripple4(input [3:0] a, input [3:0] b, input cin, output [3:0] s, output cout);
  wire [3:0] c;
  fa s0 (.a(a[0]), .b(b[0]), .cin(cin), .s(s[0]), .cout(c[0]));
  fa s1 (.a(a[1]), .b(b[1]), .cin(cin), .s(s[1]), .cout(c[1]));
  fa s2 (.a(a[2]), .b(b[2]), .cin(cin), .s(s[2]), .cout(c[2]));
  fa s3 (.a(a[3]), .b(b[3]), .cin(cin), .s(s[3]), .cout(c[3]));
  assign cout = c[3];
endmodule
```

```solution
module fa(input a, input b, input cin, output s, output cout);
  assign s = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));
endmodule

module ripple4(input [3:0] a, input [3:0] b, input cin, output [3:0] s, output cout);
  wire [3:0] c;
  fa s0 (.a(a[0]), .b(b[0]), .cin(cin),  .s(s[0]), .cout(c[0]));
  fa s1 (.a(a[1]), .b(b[1]), .cin(c[0]), .s(s[1]), .cout(c[1]));
  fa s2 (.a(a[2]), .b(b[2]), .cin(c[1]), .s(s[2]), .cout(c[2]));
  fa s3 (.a(a[3]), .b(b[3]), .cin(c[2]), .s(s[3]), .cout(c[3]));
  assign cout = c[3];
endmodule
```

```spec
{"top": "ripple4",
 "gold": "module gold(input [3:0] a, input [3:0] b, input cin, output [3:0] s, output cout); assign {cout, s} = a + b + cin; endmodule"}
```

## Instantiating is copying

Build `maj3`, high when at least two of the three inputs are.

Use three instances of `and2`, one per pair, and combine them. The starter uses
one instance and reads its output twice, which is what calling a function would
do and is not what an instance is.

@kind property
@concept An instance is a piece of the chip rather than a call, so using one
twice is not sharing hardware, it is reading one wire twice.
@backend yosys
@expect verdict sat-fail
@hint Three pairs need three gates. There is no way to make one gate produce
two different answers at the same instant.
@diagnose sat verdict sat-fail
The starter feeds `a` and `b` into the single instance and then treats its
output as though it also meant `b & c`. One gate has one output and that output
has one value, so two of the three terms are the same term. Three pairs need
three instances.
@diagnose cells verdict cell-budget
Correct, and larger than three and-gates plus the combining logic. Check that
you have not instantiated more gates than the three pairs need.
@diagnose syntax verdict syntax-error
Read the line the parser names. Every instance needs its own name.
@after Three instances, three gates, three times the area. Sharing one gate
between the pairs is possible, but it costs a multiplexer to choose its inputs
and a register to keep the earlier answer, and it takes three clock cycles.
That trade has a name, and Part V spends most of its time on it.

```starter
module and2(input a, input b, output y);
  assign y = a & b;
endmodule

module maj3(input a, input b, input c, output y);
  wire ab;
  and2 g0 (.a(a), .b(b), .y(ab));
  assign y = ab | ab | (a & c);
endmodule
```

```solution
module and2(input a, input b, output y);
  assign y = a & b;
endmodule

module maj3(input a, input b, input c, output y);
  wire ab, bc, ac;
  and2 g0 (.a(a), .b(b), .y(ab));
  and2 g1 (.a(b), .b(c), .y(bc));
  and2 g2 (.a(a), .b(c), .y(ac));
  assign y = ab | bc | ac;
endmodule
```

```spec
{"top": "maj3",
 "gold": "module gold(input a, input b, input c, output y); assign y = (a & b) | (b & c) | (a & c); endmodule"}
```
