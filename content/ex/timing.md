## The tournament

Build `max4`, the largest of four eight-bit values.

The starter compares the running best against each candidate in turn. It is
correct, and every comparison waits for the one before it. Restructure it as a
tournament: compare in pairs, then compare the winners.

@kind property
@concept A chain has depth proportional to its length and a tree has depth
proportional to the logarithm of it, for the same comparisons and the same
answer.
@backend yosys
@expect verdict path-too-long
@hint Two comparisons can happen at the same time if neither needs the other's
result.
@diagnose depth verdict path-too-long
Correct, and the three comparisons run one after another because each one takes
the previous winner as an input. Nothing forces that order: the winner of the
first pair and the winner of the second pair can be found simultaneously, and
only the final comparison has to wait.
@diagnose sat verdict sat-fail
The restructuring changed the answer. A tournament gives the same maximum as a
chain, so check the pairings and which value each comparison keeps.
@diagnose syntax verdict syntax-error
Read the line the parser names.
@after Three comparisons either way, and two of them now overlap. This
substitution is most of what restructuring for timing consists of, and it is
also why a tree costs more wiring than a chain: the two halves need their own
comparators rather than reusing one.

```starter
module max4(input [7:0] a, input [7:0] b, input [7:0] c, input [7:0] d,
            output [7:0] y);
  wire [7:0] m1 = (a > b)  ? a  : b;
  wire [7:0] m2 = (m1 > c) ? m1 : c;
  assign y      = (m2 > d) ? m2 : d;
endmodule
```

```solution
module max4(input [7:0] a, input [7:0] b, input [7:0] c, input [7:0] d,
            output [7:0] y);
  wire [7:0] l = (a > b) ? a : b;
  wire [7:0] r = (c > d) ? c : d;
  assign y     = (l > r) ? l : r;
endmodule
```

```spec
{"top": "max4", "maxDepth": 20,
 "gold": "module gold(input [7:0] a, input [7:0] b, input [7:0] c, input [7:0] d, output [7:0] y); wire [7:0] p = (a>b)?a:b; wire [7:0] q = (c>d)?c:d; assign y = (p>q)?p:q; endmodule"}
```

## Eight of them, and the chain gets worse

The same shape at eight inputs, where the difference stops being a detail.

Build `min8`, the smallest of eight four-bit values. The starter is a chain of
seven comparisons.

@kind property
@concept Chain depth grows with the number of inputs and tree depth grows with
its logarithm, so the gap widens as the design does.
@backend yosys
@expect verdict path-too-long
@hint Eight values, four pairs, then two, then one. Three rounds.
@diagnose depth verdict path-too-long
Correct, and seven comparisons deep. A tournament of eight is three rounds: four
comparisons that all run at once, then two, then one. The number of comparators
is the same seven and the depth is three.
@diagnose sat verdict sat-fail
Some input disagrees with the reference. Check that every one of the eight
values enters exactly one first-round comparison.
@diagnose syntax verdict syntax-error
Read the line the parser names.
@after Seven comparisons in either version. Only their arrangement changed, and
with it whether the design can be clocked.

```starter
module min8(input [3:0] a0, input [3:0] a1, input [3:0] a2, input [3:0] a3,
            input [3:0] a4, input [3:0] a5, input [3:0] a6, input [3:0] a7,
            output [3:0] y);
  wire [3:0] c1 = (a0 < a1) ? a0 : a1;
  wire [3:0] c2 = (c1 < a2) ? c1 : a2;
  wire [3:0] c3 = (c2 < a3) ? c2 : a3;
  wire [3:0] c4 = (c3 < a4) ? c3 : a4;
  wire [3:0] c5 = (c4 < a5) ? c4 : a5;
  wire [3:0] c6 = (c5 < a6) ? c5 : a6;
  assign y      = (c6 < a7) ? c6 : a7;
endmodule
```

```solution
module min8(input [3:0] a0, input [3:0] a1, input [3:0] a2, input [3:0] a3,
            input [3:0] a4, input [3:0] a5, input [3:0] a6, input [3:0] a7,
            output [3:0] y);
  wire [3:0] b0 = (a0 < a1) ? a0 : a1;
  wire [3:0] b1 = (a2 < a3) ? a2 : a3;
  wire [3:0] b2 = (a4 < a5) ? a4 : a5;
  wire [3:0] b3 = (a6 < a7) ? a6 : a7;
  wire [3:0] c0 = (b0 < b1) ? b0 : b1;
  wire [3:0] c1 = (b2 < b3) ? b2 : b3;
  assign y      = (c0 < c1) ? c0 : c1;
endmodule
```

```spec
{"top": "min8", "maxDepth": 20,
 "gold": "module gold(input [3:0] a0, input [3:0] a1, input [3:0] a2, input [3:0] a3, input [3:0] a4, input [3:0] a5, input [3:0] a6, input [3:0] a7, output [3:0] y); wire [3:0] p0 = (a0<a1)?a0:a1; wire [3:0] p1 = (a2<a3)?a2:a3; wire [3:0] p2 = (a4<a5)?a4:a5; wire [3:0] p3 = (a6<a7)?a6:a7; wire [3:0] q0 = (p0<p1)?p0:p1; wire [3:0] q1 = (p2<p3)?p2:p3; assign y = (q0<q1)?q0:q1; endmodule"}
```

## Shift by a variable amount

Build `shl8`, which shifts an eight-bit value left by `n` places.

The starter shifts by one, `n` times, testing at each step whether it has done
enough. Every step waits for the one before it. Do it in three stages instead:
shift by four or not, then by two or not, then by one or not.

@kind property
@concept Decomposing an amount into its bits turns a chain of small steps into
a fixed number of stages, one per bit of the amount.
@backend yosys
@expect verdict path-too-long
@hint Three bits of `n`, three stages, and each stage either shifts by its
place value or does not.
@diagnose depth verdict path-too-long
Correct, and it is seven shift steps in series. The amount is only three bits
wide, so three stages are enough: one that shifts by four when `n[2]` is set,
one by two when `n[1]` is, and one by one when `n[0]` is. Any amount from 0 to 7
is some combination of those.
@diagnose sat verdict sat-fail
The stages are in the wrong order or shift by the wrong amounts. Each stage's
shift is the place value of the bit that controls it.
@diagnose syntax verdict syntax-error
Read the line the parser names. A concatenation is `{a[6:0], 1'b0}`.
@after This is a barrel shifter and it is why a shift by a variable amount costs
about the same as a shift by a constant. Three multiplexer stages, no iteration,
and the depth does not depend on `n`.

```starter
module shl8(input [7:0] a, input [2:0] n, output reg [7:0] y);
  integer i;
  always @* begin
    y = a;
    for (i = 0; i < 7; i = i + 1)
      if (i < n) y = {y[6:0], 1'b0};
  end
endmodule
```

```solution
module shl8(input [7:0] a, input [2:0] n, output [7:0] y);
  wire [7:0] s2 = n[2] ? {a[3:0],  4'b0} : a;
  wire [7:0] s1 = n[1] ? {s2[5:0], 2'b0} : s2;
  assign     y  = n[0] ? {s1[6:0], 1'b0} : s1;
endmodule
```

```spec
{"top": "shl8", "maxDepth": 4,
 "gold": "module gold(input [7:0] a, input [2:0] n, output [7:0] y); assign y = a << n; endmodule"}
```

## Eight cases, tested one at a time

Build `sel8`, which picks one of eight bytes according to a three-bit select.

The starter is a ladder of eight equality tests. Replace it with three
multiplexer stages, one per bit of the select.

@kind property
@concept A select is a number, and decoding it one bit at a time costs one
multiplexer per bit rather than one comparison per case.
@backend yosys
@expect verdict path-too-long
@hint The top bit of the select chooses between two halves of the input, and
then the problem is the same problem, one bit smaller.
@diagnose depth verdict path-too-long
Correct, and the eighth case cannot be decided until the seventh has been ruled
out. Split on `s[2]` first to narrow 64 bits to 32, then on `s[1]` to narrow to
16, then on `s[0]`. Three stages, whatever the select happens to be.
@diagnose sat verdict sat-fail
The halves are the wrong way round somewhere. `s[2]` set should select the upper
four bytes, which are the high half of the vector.
@diagnose syntax verdict syntax-error
Read the line the parser names. A part select on a wire is `w[31:0]`.
@after Three stages, and one of them is a byte-wide multiplexer rather than a
byte-wide comparison. Every multiplexer with more than two inputs in every chip
is built this way, and it is the same decomposition as the shifter above.

```starter
module sel8(input [63:0] d, input [2:0] s, output [7:0] y);
  assign y = s == 3'd0 ? d[7:0]
           : s == 3'd1 ? d[15:8]
           : s == 3'd2 ? d[23:16]
           : s == 3'd3 ? d[31:24]
           : s == 3'd4 ? d[39:32]
           : s == 3'd5 ? d[47:40]
           : s == 3'd6 ? d[55:48]
           :             d[63:56];
endmodule
```

```solution
module sel8(input [63:0] d, input [2:0] s, output [7:0] y);
  wire [31:0] h = s[2] ? d[63:32] : d[31:0];
  wire [15:0] q = s[1] ? h[31:16] : h[15:0];
  assign      y = s[0] ? q[15:8]  : q[7:0];
endmodule
```

```spec
{"top": "sel8", "maxDepth": 4,
 "gold": "module gold(input [63:0] d, input [2:0] s, output [7:0] y); wire [31:0] h = s[2] ? d[63:32] : d[31:0]; wire [15:0] q = s[1] ? h[31:16] : h[15:0]; assign y = s[0] ? q[15:8] : q[7:0]; endmodule"}
```

## The cut has to be in the middle

Both versions here take two clock cycles to produce a result. They differ in
where the work sits.

The starter registers its inputs, then does the whole sixteen-bit addition in the
second stage. Split the addition instead: add the low halves in the first stage
and the high halves in the second, carrying between them.

@kind property
@concept A register at the end of a deep path is not a pipeline stage, because
the path is still as deep as it was.
@backend yosys
@expect verdict path-too-long
@hint The first stage has a whole clock period doing almost nothing. Give it
half the addition.
@diagnose depth verdict path-too-long
Correct, with the same latency as the reference and none of the benefit. Both
stages exist, and one of them holds the entire carry chain while the other only
copies bits. A pipeline stage is a cut through the logic, not a place to put the
answer once it is finished.
@diagnose syntax verdict syntax-error
Read the line the parser names.
@after Both versions answer after two cycles and one of them can be clocked
roughly twice as fast. Choosing where the cut goes is the design work, and it is
why deciding how many stages a unit has is an architecture decision rather than
a coding one.

This exercise is checked by depth rather than against a reference, and the
reason is the one unit 015 gave. The two pipelines hold different amounts
of state, so the inductive step has to consider starting positions neither design
can actually reach, and it fails on those rather than on any real disagreement.

```starter
module add16p(input clk, input [15:0] a, input [15:0] b, output reg [16:0] s);
  reg [15:0] a1, b1;
  always @(posedge clk) begin
    a1 <= a;
    b1 <= b;
  end
  always @(posedge clk) s <= a1 + b1;
endmodule
```

```solution
module add16p(input clk, input [15:0] a, input [15:0] b, output reg [16:0] s);
  reg [8:0] lo;
  reg [7:0] ah, bh;
  always @(posedge clk) begin
    lo <= a[7:0] + b[7:0];
    ah <= a[15:8];
    bh <= b[15:8];
  end
  always @(posedge clk) s <= {ah + bh + lo[8], lo[7:0]};
endmodule
```

```spec
{"top": "add16p", "maxDepth": 20}
```

## The carry that ripples

Build `add8`, an eight-bit adder with a nine-bit result, at a depth of at most
ten.

The starter uses the `+` operator. It is correct, and on this toolchain the
adder it produces is deeper than a ripple carry chain written out by hand. Build
the chain structurally instead, with a generate loop over eight full adders.

@kind property
@concept What a tool produces from an operator is a choice it made, and the
report is the only way to find out which choice.
@backend yosys
@expect verdict path-too-long
@hint The full adder from unit 013, eight of them, each taking the previous
stage's carry.
@diagnose depth verdict path-too-long
Correct, and deeper than the limit. The operator is not wrong here, it simply
mapped to a structure this library expresses in more levels than the explicit
carry chain needs. Writing the eight stages yourself gives the tool less room to
choose.
@diagnose sat verdict sat-fail
The carry chain is wired wrong. Stage `i` takes the carry that stage `i-1`
produced, and stage 0 takes 0.
@diagnose syntax verdict syntax-error
Read the line the parser names. A generate loop needs `genvar`, a named block,
and `endgenerate`.
@after A ripple chain is still a chain and its depth still grows with the width.
The lesson is narrower than "write it yourself": it is that the depth of an
operator is a fact about your toolchain that you find out by measuring, and
never by reading the source.

```starter
module add8(input [7:0] a, input [7:0] b, output [8:0] s);
  assign s = a + b;
endmodule
```

```solution
module fa(input a, input b, input cin, output s, output cout);
  assign s = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));
endmodule

module add8(input [7:0] a, input [7:0] b, output [8:0] s);
  wire [8:0] c;
  assign c[0] = 1'b0;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin: stage
      fa u (.a(a[i]), .b(b[i]), .cin(c[i]), .s(s[i]), .cout(c[i+1]));
    end
  endgenerate
  assign s[8] = c[8];
endmodule
```

```spec
{"top": "add8", "maxDepth": 10,
 "gold": "module gold(input [7:0] a, input [7:0] b, output [8:0] s); assign s = a + b; endmodule"}
```

## Combinational, by accident sequential

Build `parity8`, the exclusive or of all eight bits of `a`, at a depth of at
most four and with no flip-flops at all.

The starter computes the right value and computes it a cycle late, because the
work sits in a clocked block. Nothing in the source says "this is a register";
the clock in the sensitivity list does.

@kind property
@concept A clocked block is storage whether or not you wanted storage, and a
budget that forbids a cell is how a design says it must be combinational.
@backend yosys
@expect verdict cell-budget
@hint Nothing here needs to remember anything between edges.
@diagnose cells verdict cell-budget
The design contains flip-flops, so it answers one cycle after the inputs
arrive. A parity tree has nothing to remember: the answer is a function of the
inputs and of nothing else. Drive the output with a continuous assignment, or
use `always @*` rather than a clock.
@diagnose depth verdict path-too-long
No flops now, and the exclusive ors run in series. Eight bits pair into four,
then two, then one, which is three levels rather than seven.
@diagnose syntax verdict syntax-error
Read the line the parser names. Reduction exclusive or is a leading `^` on a
vector.
@after Two budgets, and they are independent claims about the same design. This
one is correct, shallow, and holds no state, and a design can fail any of those
three while passing the other two. The rest of Part III has been about the first
two; the third is the one that quietly changes what a unit means to everything
connected to it.

```starter
module parity8(input clk, input [7:0] a, output reg y);
  always @(posedge clk) y <= ^a;
endmodule
```

```solution
module parity8(input clk, input [7:0] a, output y);
  assign y = ^a;
endmodule
```

```spec
{"top": "parity8", "forbid": ["$_DFF_P_"], "maxDepth": 4}
```

## The technique that did not win

Carry select is the textbook answer to a slow adder. Compute the high half
twice, once assuming the carry from the low half is 0 and once assuming it is 1,
then pick the right one when the carry arrives. Both high halves are computed
while the low half is still settling, so the carry costs one multiplexer instead
of eight stages.

The starter is that adder, at sixteen bits, and on this toolchain it is deeper
than the plain ripple chain. Build the ripple chain instead, structurally, from
sixteen full adders.

@kind property
@concept A technique is faster or slower only against a particular library and
a particular tool, and the report is the only place that fact lives.
@backend yosys
@expect verdict path-too-long
@hint The full adder from unit 013, sixteen of them, each taking the previous
stage's carry.
@diagnose depth verdict path-too-long
Correct, and deeper than the limit. The reasoning behind carry select is sound
and the arithmetic inside each half still goes through the `+` operator, which
this tool maps to something deeper than an explicit chain. Two deep halves in
parallel plus a multiplexer beats one deep half, and it loses to sixteen shallow
stages.
@diagnose sat verdict sat-fail
The carry chain is wired wrong. Stage `i` takes the carry that stage `i-1`
produced, and stage 0 takes 0.
@diagnose syntax verdict syntax-error
Read the line the parser names. A generate loop needs `genvar`, a named block,
and `endgenerate`.
@after Carry select is a real technique and it wins on real libraries, where a
gate delay is picoseconds rather than a level count and the multiplexer is
cheaper than eight carries. It does not win here, and no amount of reading about
it would have told you that. This is the habit the unit is for: the timing
report is the fact, and everything else is a prediction about it.

```starter
module add16(input [15:0] a, input [15:0] b, output [16:0] s);
  wire [8:0] lo = a[7:0] + b[7:0];
  wire [8:0] h0 = a[15:8] + b[15:8];
  wire [8:0] h1 = a[15:8] + b[15:8] + 9'd1;
  wire [8:0] hi = lo[8] ? h1 : h0;
  assign s = {hi, lo[7:0]};
endmodule
```

```solution
module fa16(input a, input b, input cin, output s, output cout);
  assign s = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));
endmodule

module add16(input [15:0] a, input [15:0] b, output [16:0] s);
  wire [16:0] c;
  assign c[0] = 1'b0;
  genvar i;
  generate
    for (i = 0; i < 16; i = i + 1) begin: stage
      fa16 u (.a(a[i]), .b(b[i]), .cin(c[i]), .s(s[i]), .cout(c[i+1]));
    end
  endgenerate
  assign s[16] = c[16];
endmodule
```

```spec
{"top": "add16", "maxDepth": 20,
 "gold": "module gold(input [15:0] a, input [15:0] b, output [16:0] s); assign s = a + b; endmodule"}
```
