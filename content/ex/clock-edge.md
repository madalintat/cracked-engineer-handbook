## One character, one flip-flop

The starter is a two-stage shift register with the wrong assignment operator.
Synthesise it and read the cell count, then change the one character that fixes
it.

@kind property
@concept Non-blocking assignment reads pre-edge values, so a chain of flops
shifts instead of collapsing.
@backend yosys
@expect verdict cell-budget
@hint The synthesiser is not confused. It noticed both flops always hold the
same value and removed one.
@diagnose cells verdict cell-budget
One flop, where the design needs two. Blocking assignment writes immediately,
so `q2 = q1` reads the value `q1` was given on the line above rather than the
value it held before the edge. Both flops end up holding `d`, they always
agree, and the optimiser deletes the redundant one.
@diagnose latch verdict latch-inferred
A latch appeared, which means some path through the block leaves a signal
unassigned. Check that both statements are inside the clocked block.
@diagnose syntax verdict syntax-error
Read the line the parser names. Verilog wants a semicolon after each statement
and a matching `end` for every `begin`.
@after Two flops. The blocking version was not misunderstood, it was understood
exactly and found to be redundant, which is why nothing warned you.

```starter
module shifter(input clk, input d, output reg q2);
  reg q1;
  always @(posedge clk) begin
    q1 = d;
    q2 = q1;
  end
endmodule
```

```solution
module shifter(input clk, input d, output reg q2);
  reg q1;
  always @(posedge clk) begin
    q1 <= d;
    q2 <= q1;
  end
endmodule
```

```spec
{"top": "shifter", "cells": {"$_DFF_P_": 2}}
```

## The hole that becomes storage

This block is meant to be combinational. Synthesise it and the tool will tell
you what it actually built.

@kind property
@concept A signal left unassigned on some path keeps its previous value, and
keeping a value requires storage.
@backend yosys
@expect verdict latch-inferred
@hint What is `y` when `a` is 0? The block does not say.
@diagnose latch verdict latch-inferred
Read the warning. When `a` is 0 the block assigns nothing to `y`, so `y` must
hold whatever it had before, and holding a value is storage. The synthesiser
gives you a level-sensitive latch, which has no single sampling instant and
makes timing analysis much harder. Add the missing `else`, or assign a default
at the top of the block.
@diagnose budget verdict cell-budget
The latch is gone. Now check the cell count against the budget: a two-way
choice is a multiplexer, and this one reduces to a single gate.
@after A latch inside `always_comb` is an error rather than a warning, which is
the reason to write `always_comb` instead of `always @(*)`.

```starter
module sel(input a, input b, output reg y);
  always @(*) begin
    if (a) y = b;
  end
endmodule
```

```solution
module sel(input a, input b, output reg y);
  always @(*) begin
    if (a) y = b;
    else   y = 1'b0;
  end
endmodule
```

```spec
{"top": "sel", "forbid": ["$_DLATCH_P_", "$_DLATCH_N_"], "maxCells": 6}
```

## The same hole, in a case statement

A two-bit selector with four possible values, and a `case` that handles two of
them. Count the latches before you run it, then check your count.

@kind property
@concept An unhandled case value is an unassigned path, and every unassigned
output bit becomes its own latch.
@backend yosys
@expect verdict latch-inferred
@hint The output is four bits wide, but only some of them get a latch. Which?
@diagnose latch verdict latch-inferred
The `case` covers `00` and `01` and says nothing about `10` or `11`, so `y`
holds its previous value on those inputs. Note the count: the synthesiser
inferred a latch for each output bit that actually needed one, not one for the
whole vector. A `default` branch closes every path at once.
@diagnose budget verdict cell-budget
No latches now. Check the cell count: a full four-way decode of a two-bit
input should be small.
@after `default` is not a fallback for values you forgot. It is the statement
that makes the block total, and a combinational block must be total.

```starter
module dec(input [1:0] s, output reg [3:0] y);
  always @(*) begin
    case (s)
      2'b00: y = 4'b0001;
      2'b01: y = 4'b0010;
    endcase
  end
endmodule
```

```solution
module dec(input [1:0] s, output reg [3:0] y);
  always @(*) begin
    case (s)
      2'b00:   y = 4'b0001;
      2'b01:   y = 4'b0010;
      2'b10:   y = 4'b0100;
      default: y = 4'b1000;
    endcase
  end
endmodule
```

```spec
{"top": "dec", "forbid": ["$_DLATCH_P_", "$_DLATCH_N_"], "maxCells": 16}
```

## Which flop did you ask for

Both of these counters are correct designs, and they synthesise to different
devices. The starter uses a synchronous reset. The specification wants the
asynchronous one.

@kind property
@concept Where you check the reset decides whether it is one more input on the
flop or a separate pin on a different flop.
@backend yosys
@expect verdict cell-budget
@hint The reset has to be in the sensitivity list, not only in the body.
@diagnose cells verdict cell-budget
Read the cell name in the message. A reset checked inside a block that wakes
only on the clock is ordinary data, and synthesises to `$_SDFF_PP0_`, a flop
with a synchronous reset input. Putting the reset in the sensitivity list makes
it asynchronous, and that is a physically different device with its own reset
pin: `$_DFF_PP0_`.
@diagnose latch verdict latch-inferred
A latch appeared, which means a path through the block assigns nothing to `q`.
Both branches of the `if` must assign it.
@after An asynchronous reset acts without waiting for a clock, which is what
you want at power-on. Its release still has to be synchronised, or different
flops leave reset on different cycles.

```starter
module counter(input clk, input rst, output reg [3:0] q);
  always @(posedge clk) begin
    if (rst) q <= 4'b0;
    else     q <= q + 1;
  end
endmodule
```

```solution
module counter(input clk, input rst, output reg [3:0] q);
  always @(posedge clk or posedge rst) begin
    if (rst) q <= 4'b0;
    else     q <= q + 1;
  end
endmodule
```

```spec
{"top": "counter", "cells": {"$_DFF_PP0_": 4}, "maxCells": 40}
```

## Two drivers, one wire

In software, assigning to a variable twice is fine and the second wins. Here it
is not, and the reason is physical.

@kind property
@concept A wire is a piece of metal, and two outputs connected to it are two
devices fighting over the same voltage.
@backend yosys
@expect verdict multi-driver
@hint Only one of the two assignments should exist. Which one depends on what
the module is supposed to do.
@diagnose driver verdict multi-driver
Read the warning. Two continuous assignments drive `y`, so in hardware two
gate outputs are wired together. If they disagree, one pulls the wire high
while the other pulls it low, and the result is a short from the supply to
ground: undefined logically and destructive physically.
@diagnose budget verdict cell-budget
One driver now. Check the cell count against the budget.
@after This is the same rule your Part II checker enforced when it refused a
control word with two modules enabled onto the bus. It has not changed. It has
only moved into a language that lets you write it.

```starter
module pick(input a, input b, output y);
  assign y = a;
  assign y = b;
endmodule
```

```solution
module pick(input a, input b, output y);
  assign y = a & b;
endmodule
```

```spec
{"top": "pick", "maxCells": 4}
```

## Prove it, do not test it

Write a multiplexer using only AND, OR and NOT. The checker does not run test
vectors against it. It proves that your design and the reference compute the
same function for every possible input.

@kind property
@concept For hardware you can sometimes replace testing with proof, and the
tool that does it ships in the same package as the synthesiser.
@backend yosys
@expect verdict sat-fail
@hint When `s` is 1 the output should follow `b`. Check which input your
starter selects.
@diagnose sat verdict sat-fail
The solver found inputs where your design and the reference disagree, and it
did not need to be told which inputs to try. Work out by hand what your
expression gives for `s = 1`, then compare it against `s ? b : a`.
@diagnose syntax verdict syntax-error
Read the line the parser names. Continuous assignments need `assign` and a
semicolon.
@after This is exhaustive over every input, which for a three-input function is
eight cases and for a 32-bit adder is far more than you could ever enumerate.
The solver does not enumerate them either.

```starter
module mux(input a, input b, input s, output y);
  assign y = (a & s) | (b & ~s);
endmodule
```

```solution
module mux(input a, input b, input s, output y);
  assign y = (a & ~s) | (b & s);
endmodule
```

```spec
{"top": "mux",
 "gold": "module gold(input a, input b, input s, output y); assign y = s ? b : a; endmodule"}
```

## An adder, proved against the operator

Same idea at a width where testing every case would be tedious. Build a 4-bit
adder with a carry out, and the checker proves it against `a + b`.

@kind property
@concept A proof over all 256 input pairs costs the same as a proof over one.
@backend yosys
@expect verdict sat-fail
@hint The sum is five bits wide. Both operands need widening before they are
added, or the carry has nowhere to go.
@diagnose sat verdict sat-fail
Your design disagrees with `a + b` on some inputs. The most common cause is
adding two four-bit values and assigning to a five-bit result: the addition is
performed at four bits and the carry is lost before the widening happens.
Widen the operands first.
@diagnose syntax verdict syntax-error
Read the named line. A concatenation is written with braces, as in
`{1'b0, a}`.
@after Yosys proved this without running a single vector. The same command
scales to designs where exhaustive testing stopped being possible a long time
ago.

```starter
module adder(input [3:0] a, input [3:0] b, output [4:0] s);
  assign s = a ^ b;
endmodule
```

```solution
module adder(input [3:0] a, input [3:0] b, output [4:0] s);
  assign s = {1'b0, a} + {1'b0, b};
endmodule
```

```spec
{"top": "adder",
 "gold": "module gold(input [3:0] a, input [3:0] b, output [4:0] s); assign s = a + b; endmodule"}
```

## The gate you already built, in Verilog

Part II had you build XOR from NAND gates. Write it here in Verilog, structurally,
using only NAND primitives, and the checker proves it against the `^` operator.

@kind property
@concept The netlist you drew by hand in Part II and the netlist the synthesiser
produces are the same kind of object.
@backend yosys
@expect verdict sat-fail
@hint The four-gate solution starts with `n1 = ~(a & b)` and feeds `n1` to both
of the next two gates.
@diagnose sat verdict sat-fail
Your design does not agree with `a ^ b`. Work out the truth table of what you
wrote before changing it. XOR is 1 when the inputs differ and 0 when they agree.
@diagnose budget verdict cell-budget
Correct, and over the cell budget. The four-NAND solution shares one
intermediate value between two gates rather than inverting both inputs
separately.
@diagnose syntax verdict syntax-error
Read the named line. Each `wire` needs declaring before it is assigned.
@after The same four gates you found by hand, now proved rather than checked
against a table you wrote yourself.

```starter
module xorgate(input a, input b, output y);
  assign y = a & b;
endmodule
```

```solution
module xorgate(input a, input b, output y);
  wire n1, n2, n3;
  assign n1 = ~(a & b);
  assign n2 = ~(a & n1);
  assign n3 = ~(b & n1);
  assign y  = ~(n2 & n3);
endmodule
```

```spec
{"top": "xorgate",
 "gold": "module gold(input a, input b, output y); assign y = a ^ b; endmodule"}
```
