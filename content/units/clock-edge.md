---
needs: [structure, feedback, clock-bus]
minutes: 55
one_idea: There are exactly two kinds of logic, and almost every Verilog bug is a confusion between them.
sources: [digital-design-hdl-fpga, nand2tetris-eater-scott]
---

Here are two modules. They differ by one character.

```verilog
always @(posedge clk) begin q1 <= d; q2 <= q1; end
always @(posedge clk) begin q1  = d; q2  = q1; end
```

Synthesise both and count the flip-flops. The first gives two. The second gives
one. Not a different arrangement of the same hardware: a different amount of it.

This unit is about why, and about the fact that most Verilog bugs are the same
bug wearing different clothes.

## Two kinds of logic, and only two

[[combinational]] logic has outputs that are a function of its inputs and nothing
else. Give it the same inputs and it settles to the same outputs, every time,
with no memory of what came before. That is the entire Part II machine up to
the point where you added a clock.

[[sequential]] logic has outputs that depend on the inputs and on a stored value,
and it updates that value at a clock edge. It remembers.

Every construct in Verilog produces one or the other. The trouble is that
Verilog will not stop you writing something that produces the one you did not
want, and the result usually simulates close enough to correct that you find
out much later.

## Why the assignments differ

Both modules describe two flip-flops in the same block, driven by the same
edge. Real flip-flops all sample at the edge and drive their outputs shortly
after, which is the clock-to-Q delay. Because every flop samples before any
flop drives, a chain of them shifts: `q2` gets the value `q1` held *before* the
edge, not the one it is about to take.

[[non-blocking]] assignment models exactly that. The right side is evaluated when
the block runs, the value is set aside, and the left side is not updated until
every block scheduled for this edge has finished evaluating. So both
assignments read the old `q1`, and you get a shift register.

[[blocking]] assignment evaluates and writes immediately, in order. `q1 = d` puts
`d` into `q1` right now, so the next line's `q2 = q1` reads the new value.
Both flops end up holding `d`, the synthesiser notices they always agree, and
it deletes one of them.

The rule is short. **`always_ff` uses `<=`. `always_comb` uses `=`.** Never mix
them in one block, and never drive one signal from two blocks.

## Why the rule exists, rather than just what it is

Two blocks waking on the same edge have no defined execution order. The
language standard deliberately leaves it undefined, because real hardware has
no such order either: the two flops are separate pieces of silicon reacting to
the same wire.

With blocking assignment that undefinedness is visible. Whichever block runs
first decides whether you get one flop or two, and two simulators are both
allowed to be right while disagreeing.

Non-blocking assignment removes the race, and it is worth being precise about
how. It does not pick an order. It makes the order irrelevant, by splitting
every assignment into two events: the right side is evaluated during the active
phase, and the left side is written afterwards in a separate phase, once every
block has finished evaluating. Both blocks read pre-edge values, both write
post-edge values, and no interleaving of the two can produce a different
result.

That two-phase structure is not a quirk of the language. It is the language
describing the setup-and-hold discipline you already met when you built the bus
in Part II.

## Reading it in the cells

You do not have to take any of this on trust, and you should not. Synthesise
both versions and count.

```
q1 <= d; q2 <= q1;        2   $_DFF_P_
q1  = d; q2  = q1;        1   $_DFF_P_
```

That is the whole argument, delivered by the tool in two lines. The exercises
in this unit are built on exactly this: write the design, read the cells, and
let the netlist settle the question rather than arguing about semantics.

It is worth naming what the second number means. The synthesiser did not
misunderstand the blocking version. It understood it perfectly, noticed that
both flops would always hold the same value, and removed the redundant one.
The optimisation is correct. What is wrong is that the design said something
other than what its author meant, and nothing in the language flagged it,
because assigning in order is a completely reasonable thing to want inside a
combinational block.

That is the shape of the whole problem. Blocking assignment in a clocked block
is not always wrong, which is precisely why it fails quietly. Follow the rule
mechanically rather than reasoning case by case about whether this particular
block happens to be safe.

## The latch you did not ask for

The second most common bug has nothing to do with edges.

```verilog
always @(*) begin
    if (a) y = b;
end
```

This is combinational logic with a hole in it. When `a` is 0 the block says
nothing about `y`, and Verilog's rule is that a signal not assigned on some
path keeps its previous value. Keeping a previous value requires storage, so
the synthesiser gives you storage: a level-sensitive latch.

Yosys will tell you, in these words:

```
Warning: Latch inferred for signal `\sel.\y' from process `\sel.$proc$sel.v:1$1'
```

You almost never want that. A latch is transparent while its enable is high, so
it has no single sampling instant, which makes static timing analysis much
harder and makes the circuit sensitive to glitches on the enable. Add the
missing `else`, or assign a default at the top of the block, and the latch
becomes a plain multiplexer.

The same hole opens in a `case` statement that does not cover every value and
has no `default`. Two output bits left unassigned give you two latches, and the
warning names each signal.

This is what `always_comb` is for. It is not decoration: it tells the tool your
intent, so the tool can check it. A block that infers a latch inside
`always_comb` is an error rather than a warning you may not read.

## What the reset style does to the flop

Two counters, differing only in where the reset is checked:

```verilog
always @(posedge clk)                begin if (rst) q <= 0; else q <= q + 1; end
always @(posedge clk or posedge rst) begin if (rst) q <= 0; else q <= q + 1; end
```

Both are correct designs. They synthesise to different cells. The first gives
`$_SDFF_PP0_`, a flop with a synchronous reset, which is one input on the same
flop. The second gives `$_DFF_PP0_`, a flop with an asynchronous reset, which
is a physically different device with a separate reset pin.

The consequence is not aesthetic. An asynchronous reset takes effect the moment
it asserts, without waiting for a clock, which is what you want at power-on
when there may be no clock yet. Its release, though, has to be synchronised, or
different flops will leave reset on different cycles. A synchronous reset needs
a running clock and behaves like ordinary data, which makes timing analysis
straightforward.

You cannot tell which one a design uses by reading its behaviour in a
simulator. You can tell instantly by reading the cell it synthesised to.

## Where simulation and synthesis disagree

One more, because it is the reason people distrust HDL.

```verilog
always @(a) y = a & b;
```

The sensitivity list names `a` and not `b`. In simulation the block runs only
when `a` changes, so a change to `b` alone leaves `y` stale. In synthesis the
tool ignores the list, builds the combinational function you clearly meant, and
produces a single AND gate that responds to both.

So the simulator and the hardware disagree, and the hardware is the one that is
right. Bugs of this shape appear as "it worked in simulation and failed on the
board", which is the worst debugging position to be in. `always @(*)` and
`always_comb` both remove the possibility by deriving the list for you.

## What to take from this

Every bug above is one confusion: which of the two kinds of logic am I
describing? Blocking versus non-blocking is that question at a clock edge. The
inferred latch is that question in a combinational block. The reset style is
that question about what the flop itself is.

The tool answers it precisely, every time, and for free. Synthesise the design
and read the cells. Two flops or one, a latch or a mux, a synchronous reset or
an asynchronous one. The netlist is not a summary of your intent; it is what
you actually said.
