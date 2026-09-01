## One cycle of delay

Build `Delay`, which outputs whatever its input was on the previous cycle. Every
flip-flop starts holding 0.

@kind property
@concept The flip-flop is an axiom here, and its whole rule is that its output
this cycle is its input from the last one.
@backend sim
@expect verdict table-mismatch
@hint There is a primitive for exactly this, and it is not built from nand.
@diagnose table-mismatch verdict table-mismatch
The message names the cycle. If cycle 0 is wrong and everything else is right,
your design is passing the input straight through: the point of the part is that
it does not, and the value shows up one cycle later.
@after Nothing else in Part II is given to you. Every other sequential part in
this unit is built from this one and the routing you already have.

```starter
chip Delay(d) -> q {
  q = d
}
```

```spec
{"chip": "Delay", "inputs": ["d"], "outputs": ["q"], "trace": [[1, 0], [0, 1], [1, 0], [1, 1], [0, 1], [0, 0]]}
```

```solution
chip Delay(d) -> q {
  q = dff(d)
}
```

## The invalid design, and the fix

Build `Bit`. When `load` is 1 it captures `in`; when `load` is 0 it holds what it
had. The output shows what it held coming into the cycle.

@kind property
@concept A flip-flop with its output tied to its input can never be loaded. The
multiplexer in the loop is what makes `load` mean anything.
@backend sim
@expect verdict table-mismatch
@hint The multiplexer chooses between the value already here and the value
arriving, and its select is `load`.
@diagnose table-mismatch verdict table-mismatch
Read which cycle disagreed. If the value never changes at all, the flop is being
fed its own output with nothing able to interrupt, which is the design
nand2tetris labels invalid.
@diagnose cycle verdict cycle
The loop has no flip-flop in it. A value may depend on itself through a clock
edge and may not otherwise, so the feedback has to pass through the `dff`.
@after Eight gates and one flip-flop. This is the part every register, counter
and memory in the rest of Part II is made from.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  out = dff(in)
}
```

```spec
{"chip": "Bit", "inputs": ["in", "load"], "outputs": ["out"], "trace": [[1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 0, 0], [0, 0, 0]]}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
```

## Two of them in a row

Build `Shift2`, where the output is the input from two cycles ago.

@kind property
@concept Each flop captures what its neighbour held, not what its neighbour is
becoming, which is why a chain shifts rather than collapsing.
@backend sim
@expect verdict table-mismatch
@hint Two flops in series, and no logic between them.
@diagnose table-mismatch verdict table-mismatch
If the value appears one cycle early, there is only one flop in the path. If it
never appears at all, check that the second flop is fed by the first rather than
by the input.
@after Every flop reads before any flop writes, so the intermediate state cannot
be observed. That is the same discipline Part III calls non-blocking assignment,
and it is the reason a chain of these shifts.

```starter
chip Shift2(d) -> q {
  q = dff(d)
}
```

```spec
{"chip": "Shift2", "inputs": ["d"], "outputs": ["q"], "trace": [[1, 0], [0, 0], [0, 1], [0, 0], [1, 0], [0, 0], [0, 1]]}
```

```solution
chip Shift2(d) -> q {
  a = dff(d)
  q = dff(a)
}
```

## Flipping

Build `Toggle`, which inverts what it holds on every cycle where `t` is 1 and
holds otherwise. The output shows what it held coming into the cycle.

@kind property
@concept A part whose next value depends on its current value is the first
thing you have built that could not exist without the clock.
@backend sim
@expect verdict table-mismatch
@hint The value to load is the inverse of the value held, and `t` decides
whether to load it.
@diagnose table-mismatch verdict table-mismatch
Check the cycles where `t` is 0. The value must not change there, which means
the multiplexer has to select the held value rather than the inverted one.
@diagnose cycle verdict cycle
Inverting the output and feeding it back is still a loop, and it is legal only
because the flop is in it. Make sure the inversion is on the path into the
multiplexer rather than around it.
@after This is a one-bit counter. The next exercise makes it two bits, and at
that point you have built counting out of nothing but routing, an adder and a
clock.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Toggle(t) -> out {
  out = dff(t)
}
```

```spec
{"chip": "Toggle", "inputs": ["t"], "outputs": ["out"], "trace": [[1, 0], [1, 1], [1, 0], [0, 1], [0, 1], [1, 1], [1, 0]]}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Toggle(t) -> out {
  flipped = Not(out)
  out = Bit(flipped, t)
}
```

## Set and reset

Build `SetReset`. When `s` is 1 the stored bit becomes 1; when `r` is 1 and `s`
is 0 it becomes 0; otherwise it holds. Set wins.

@kind property
@concept Priority between two controls is an ordinary multiplexer decision, not
a special arbitration mechanism.
@backend sim
@expect verdict table-mismatch
@hint Decide what to load, then decide whether to load. Set winning is a
multiplexer whose select is `s`.
@diagnose table-mismatch verdict table-mismatch
The cycle where both `s` and `r` are 1 is the one that separates a correct
design from a nearly correct one. Set has to win there.
@after Every priority encoder and every interrupt controller is this shape.
Deciding which of several requests wins is a chain of multiplexers, and the
order of the chain is the priority.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip SetReset(s, r) -> out {
  out = Bit(s, r)
}
```

```spec
{"chip": "SetReset", "inputs": ["s", "r"], "outputs": ["out"], "trace": [[1, 0, 0], [0, 0, 1], [0, 1, 1], [0, 0, 0], [1, 1, 0], [0, 0, 1]]}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip SetReset(s, r) -> out {
  change = Or(s, r)
  value = Mux(s, s, s)
  out = Bit(value, change)
}
```

## A register two bits wide

Build `Reg2`, which loads both bits together when `load` is 1 and holds
otherwise.

@kind property
@concept Width is repetition. A wide register is one-bit registers sharing a
load signal, and nothing else changes.
@backend sim
@expect verdict table-mismatch
@hint Two `Bit` parts, both taking the same `load`.
@diagnose table-mismatch verdict table-mismatch
Read which output bit disagreed. If one bit tracks correctly and the other never
changes, the two are not sharing the load signal.
@after One control wire fanning out to every bit is how every register in every
machine works. There is no such thing as loading half a register.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Reg2(d1, d0, load) -> q1, q0 {
  q1 = Bit(d1, load)
  q0 = Bit(d0, load)
  q0 = q1
}
```

```spec
{"chip": "Reg2", "inputs": ["d1", "d0", "load"], "outputs": ["q1", "q0"], "trace": [[1, 0, 1, 0, 0], [0, 1, 0, 1, 0], [1, 1, 0, 1, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 1], [1, 0, 1, 0, 1]]}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Reg2(d1, d0, load) -> q1, q0 {
  q1 = Bit(d1, load)
  q0 = Bit(d0, load)
}
```

## Counting

Build `Count2`, a two-bit counter that increments when `en` is 1 and holds
otherwise, wrapping from 3 back to 0. The output shows the value coming into the
cycle.

@kind property
@concept Counting is the increment from the last unit wired to a register. It
is not a new mechanism.
@backend sim
@expect verdict table-mismatch
@hint Compute the current value plus one, and load it when `en` is 1.
@diagnose table-mismatch verdict table-mismatch
Check the cycle where the count wraps from 3 to 0. The increment has to carry
out of the top bit and be discarded, and a design that stops at 3 is holding the
carry somewhere it should not.
@diagnose cycle verdict cycle
The next value depends on the current value, which is legal only through the
flops. The increment must sit between the register's output and its input, not
around it.
@after The program counter in unit 010 is this part with one addition: a load
input that overrides the increment. That is what a jump is, and it is why a jump
needs no special machinery.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Count2(en) -> q1, q0 {
  q1 = Bit(en, en)
  q0 = Bit(en, en)
}
```

```spec
{"chip": "Count2", "inputs": ["en"], "outputs": ["q1", "q0"], "trace": [[1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1], [1, 0, 0], [0, 0, 1], [0, 0, 1], [1, 0, 1]]}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Count2(en) -> q1, q0 {
  n0 = Not(q0)
  carry = And(q0, en)
  n1 = Xor(q1, carry)
  d0 = Mux(q0, n0, en)
  q0 = Bit(d0, en)
  q1 = Bit(n1, en)
}
```

## Counting, with a way back to zero

Build `CountReset`, the same counter with a `rst` input that forces the next
value to 0 regardless of `en`.

@kind property
@concept Reset is a multiplexer in front of the register, and it takes priority
by being the last choice made before the value is stored.
@backend sim
@expect verdict table-mismatch
@hint Choose the next value first, then let reset override it.
@diagnose table-mismatch verdict table-mismatch
Read the cycle after the one where `rst` was high. Reset acts on what gets
stored, so the output returns to zero on the following cycle rather than
immediately, which is the same one-cycle delay as everything else here.
@after Every counter in every machine has this input, and it is why a processor
has a reset pin rather than a reset instruction: at power-on there is no
instruction to run yet.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip CountReset(en, rst) -> q1, q0 {
  q1 = Bit(rst, en)
  q0 = Bit(rst, en)
}
```

```spec
{"chip": "CountReset", "inputs": ["en", "rst"], "outputs": ["q1", "q0"], "trace": [[1, 0, 0, 0], [1, 0, 0, 1], [1, 0, 1, 0], [1, 1, 1, 1], [1, 0, 0, 0], [1, 0, 0, 1], [0, 0, 1, 0], [1, 0, 1, 0]]}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip One(a) -> out {
  n = nand(a, a)
  out = nand(a, n)
}
chip Zero(a) -> out {
  o = One(a)
  out = nand(o, o)
}
chip CountReset(en, rst) -> q1, q0 {
  zero = Zero(en)
  one = One(en)
  n0 = Not(q0)
  c0 = Mux(q0, n0, en)
  t1 = Xor(q1, q0)
  c1 = Mux(q1, t1, en)
  d0 = Mux(c0, zero, rst)
  d1 = Mux(c1, zero, rst)
  q0 = Bit(d0, one)
  q1 = Bit(d1, one)
}
```
