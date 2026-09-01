## Choosing between two wires

Build `Mux`. When `sel` is 0 the output follows `a`; when `sel` is 1 it follows
`b`. Four NAND gates is enough.

@kind property
@concept A control signal is an ordinary wire. Nothing in the circuit
distinguishes it from the data it selects.
@backend sim
@expect verdict table-mismatch
@hint Gate each input with `sel` in the polarity you want, then combine.
@diagnose table-mismatch verdict table-mismatch
The row named in the message tells you which case is wrong. The only rows where
`sel` does anything are the ones where `a` and `b` differ, so check those two
first: everywhere else the answer is the same whichever input is selected.
@diagnose floating verdict floating-input
A wire is read and never driven. Inverting `sel` needs its own assignment
before the inverted value has a name.
@after Four gates, and you have just built the part that selects a register,
decodes an instruction and addresses memory. The rest of this unit is that same
part at different widths.

```starter
chip Mux(a, b, sel) -> out {
  out = nand(a, sel)
}
```

```spec
{"chip": "Mux", "inputs": ["a", "b", "sel"], "outputs": ["out"], "table": [[0, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 1, 1, 1], [1, 0, 0, 1], [1, 0, 1, 0], [1, 1, 0, 1], [1, 1, 1, 1]], "minGates": 4, "maxGates": 6}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
```

## The same part, backwards

Build `Demux`. One input, one select bit, two outputs: the input goes to `a`
when `sel` is 0 and to `b` when it is 1, and the other output is 0.

@kind property
@concept A multiplexer chooses which value arrives somewhere and a
demultiplexer chooses where a value goes. They are the two halves of routing.
@backend sim
@expect verdict table-mismatch
@hint The output that is not selected must be 0, not the input.
@diagnose table-mismatch verdict table-mismatch
Look at the row where the input is 0. Both outputs must be 0 there whatever the
select is, because there is nothing to route. A design that inverts rather than
gates will pass the rows where the input is 1 and fail those.
@after "Which register do I write to" is this part on the write-enable signal.
Not something like it. This part.

```starter
chip Demux(in, sel) -> a, b {
  a = nand(in, sel)
  b = nand(in, sel)
}
```

```spec
{"chip": "Demux", "inputs": ["in", "sel"], "outputs": ["a", "b"], "table": [[0, 0, 0, 0], [0, 1, 0, 0], [1, 0, 1, 0], [1, 1, 0, 1]], "maxGates": 6}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Demux(in, sel) -> a, b {
  nsel = Not(sel)
  a = And(in, nsel)
  b = And(in, sel)
}
```

## Or, which you will need

Build `Or` from NAND. You met De Morgan in the last unit; this is it applied
once.

@kind property
@concept Every gate in this part is reachable, and the ones you build early are
the parts you build the rest from.
@backend sim
@expect verdict table-mismatch
@hint Invert both inputs, then NAND them.
@diagnose table-mismatch verdict table-mismatch
Compare your output column against the specification's. If yours is the exact
opposite on every row you have built NOR and stopped one inversion early.
@after Three gates. Keep it: the next two exercises both use it.

```starter
chip Or(a, b) -> out {
  out = nand(a, b)
}
```

```spec
{"chip": "Or", "inputs": ["a", "b"], "outputs": ["out"], "table": [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]], "maxGates": 4}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip Or(a, b) -> out {
  na = Not(a)
  nb = Not(b)
  out = nand(na, nb)
}
```

## One line at a time

Build `Decoder2`: two select bits in, four outputs, exactly one of them high.
Input `s1` is the high bit.

@kind property
@concept A decoder raises one of `2^k` lines from `k` bits, and every addressed
thing in a machine is one of these driving a set of enables.
@backend sim
@expect verdict table-mismatch
@hint Each output is an AND of the two select bits in the right polarity.
@diagnose table-mismatch verdict table-mismatch
Exactly one output is high in every row. Read which row disagreed and work out
which combination of the two bits it is: output 0 wants both low, output 3 wants
both high, and the middle two want one of each.
@diagnose floating verdict floating-input
Both inverted select signals need names before you can use them, and each is
used twice.
@after This is a demultiplexer with its data input held at 1. That looks like a
trick and it is the same circuit being used differently, which is most of what
Part II is.

```starter
chip Decoder2(s1, s0) -> o0, o1, o2, o3 {
  o0 = nand(s1, s0)
  o1 = nand(s1, s0)
  o2 = nand(s1, s0)
  o3 = nand(s1, s0)
}
```

```spec
{"chip": "Decoder2", "inputs": ["s1", "s0"], "outputs": ["o0", "o1", "o2", "o3"], "table": [[0, 0, 1, 0, 0, 0], [0, 1, 0, 1, 0, 0], [1, 0, 0, 0, 1, 0], [1, 1, 0, 0, 0, 1]], "maxGates": 14}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = Not(n)
}
chip Decoder2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
```

## Four inputs, two select bits

Build `Mux4` from the two-way multiplexer you already have. Two of them choose
between pairs on the low bit, and a third chooses between those results on the
high bit.

@kind property
@concept `2^k` inputs need `k` select bits, and a tree of small multiplexers is
how any real width is built.
@backend sim
@expect verdict table-mismatch
@hint Three `Mux` parts. The high bit selects between the two results.
@diagnose table-mismatch verdict table-mismatch
Read which of the four inputs the failing row should have selected. `s1` is the
high bit, so `s1 s0` of `1 0` selects `c`, the third input. Getting the two
select bits the wrong way round passes half the rows.
@diagnose non-nand-part verdict non-nand-part
You called a part that is not defined in this file. Define `Mux` above the chip
that uses it, along with whatever it needs.
@after Twelve gates and two stages. Built flat instead it is more gates and one
stage, which is the same trade as everything in Part I. The tree scales better,
which is why memory is a tree.

```starter
chip Mux4(a, b, c, d, s1, s0) -> out {
  out = nand(a, s0)
}
```

```spec
{"chip": "Mux4", "inputs": ["a", "b", "c", "d", "s1", "s0"], "outputs": ["out"], "table": [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 1, 1, 0], [0, 0, 0, 1, 0, 0, 0], [0, 0, 0, 1, 0, 1, 0], [0, 0, 0, 1, 1, 0, 0], [0, 0, 0, 1, 1, 1, 1], [0, 0, 1, 0, 0, 0, 0], [0, 0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 0, 1], [0, 0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 0, 0], [0, 0, 1, 1, 0, 1, 0], [0, 0, 1, 1, 1, 0, 1], [0, 0, 1, 1, 1, 1, 1], [0, 1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 1, 1], [0, 1, 0, 0, 1, 0, 0], [0, 1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 0, 0, 0], [0, 1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 0, 0], [0, 1, 0, 1, 1, 1, 1], [0, 1, 1, 0, 0, 0, 0], [0, 1, 1, 0, 0, 1, 1], [0, 1, 1, 0, 1, 0, 1], [0, 1, 1, 0, 1, 1, 0], [0, 1, 1, 1, 0, 0, 0], [0, 1, 1, 1, 0, 1, 1], [0, 1, 1, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 1, 1, 0], [1, 0, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 1, 0], [1, 0, 0, 1, 1, 0, 0], [1, 0, 0, 1, 1, 1, 1], [1, 0, 1, 0, 0, 0, 1], [1, 0, 1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 1, 0], [1, 0, 1, 1, 0, 0, 1], [1, 0, 1, 1, 0, 1, 0], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 0, 0, 1], [1, 1, 0, 0, 0, 1, 1], [1, 1, 0, 0, 1, 0, 0], [1, 1, 0, 0, 1, 1, 0], [1, 1, 0, 1, 0, 0, 1], [1, 1, 0, 1, 0, 1, 1], [1, 1, 0, 1, 1, 0, 0], [1, 1, 0, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0, 1], [1, 1, 1, 0, 0, 1, 1], [1, 1, 1, 0, 1, 0, 1], [1, 1, 1, 0, 1, 1, 0], [1, 1, 1, 1, 0, 0, 1], [1, 1, 1, 1, 0, 1, 1], [1, 1, 1, 1, 1, 0, 1], [1, 1, 1, 1, 1, 1, 1]], "maxGates": 20}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
```

## Are these the same

Build `Eq`, which outputs 1 when its two inputs are equal and 0 when they
differ.

@kind property
@concept Comparison is not a new kind of operation. It is the function that is
true on the rows where the inputs agree.
@backend sim
@expect verdict table-mismatch
@hint This is the opposite of the function that is true when they differ.
@diagnose table-mismatch verdict table-mismatch
Two rows want 1 and two want 0. If your output is high on exactly the rows that
should be low, you have built exclusive or and need one more inversion.
@after A wide comparison is this part on every bit, with the results ANDed
together. The unit on control uses that to decide whether a branch is taken.

```starter
chip Eq(a, b) -> out {
  out = nand(a, b)
}
```

```spec
{"chip": "Eq", "inputs": ["a", "b"], "outputs": ["out"], "table": [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 1]], "maxGates": 6}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
chip Eq(a, b) -> out {
  x = Xor(a, b)
  out = Not(x)
}
```

## Hold or load

Build `HoldOrLoad`, which passes `stored` through when `load` is 0 and `fresh`
through when `load` is 1. It is a multiplexer, and the point is what you call
its inputs.

@kind property
@concept The part that becomes a register is one you have already built. What
it is missing is a clock, not a circuit.
@backend sim
@expect verdict table-mismatch
@hint You built this in the first exercise under a different name.
@diagnose table-mismatch verdict table-mismatch
When `load` is 0 the output must equal `stored`, whatever `fresh` is. Check the
rows where those two disagree, since they are the only rows that test anything.
@after Now imagine wiring the output back round to `stored`. That is a
register, and the simulator will reject it as a loop with no clock in it, which
is exactly the right complaint. Unit 008 supplies the clock.

```starter
chip HoldOrLoad(stored, fresh, load) -> out {
  out = nand(stored, load)
}
```

```spec
{"chip": "HoldOrLoad", "inputs": ["stored", "fresh", "load"], "outputs": ["out"], "table": [[0, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 1, 1, 1], [1, 0, 0, 1], [1, 0, 1, 0], [1, 1, 0, 1], [1, 1, 1, 1]], "maxGates": 6}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip HoldOrLoad(stored, fresh, load) -> out {
  nload = Not(load)
  keep = nand(stored, nload)
  take = nand(fresh, load)
  out = nand(keep, take)
}
```

## Selecting with a spare input

Build `Sel3`, which passes `a` when `s` is 0 and `b` when `s` is 1, and ignores
`c` entirely. The specification includes `c` so that every row appears twice.

@kind property
@concept An input a circuit does not use costs nothing and changes nothing,
which is worth seeing once so that a wide bus with unused lines is not
mysterious later.
@backend sim
@expect verdict table-mismatch
@hint The answer does not depend on `c`. Do not wire it to anything.
@diagnose table-mismatch verdict table-mismatch
Every pair of rows in the table differs only in `c` and wants the same output.
If your two answers differ across such a pair, `c` is reaching the output when
it should not.
@diagnose floating verdict floating-input
Leaving an input unused is allowed. Reading a wire nothing drives is not, and
those are different mistakes.
@after A design does not have to use every input it is given. That is how one
part serves several purposes on a shared bus, which is unit 009.

```starter
chip Sel3(a, b, c, s) -> out {
  out = nand(a, c)
}
```

```spec
{"chip": "Sel3", "inputs": ["a", "b", "c", "s"], "outputs": ["out"], "table": [[0, 0, 0, 0, 0], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 0, 1, 1, 0], [0, 1, 0, 0, 0], [0, 1, 0, 1, 1], [0, 1, 1, 0, 0], [0, 1, 1, 1, 1], [1, 0, 0, 0, 1], [1, 0, 0, 1, 0], [1, 0, 1, 0, 1], [1, 0, 1, 1, 0], [1, 1, 0, 0, 1], [1, 1, 0, 1, 1], [1, 1, 1, 0, 1], [1, 1, 1, 1, 1]], "maxGates": 6}
```

```solution
chip Not(x) -> out {
  out = nand(x, x)
}
chip Sel3(a, b, c, s) -> out {
  ns = Not(s)
  ga = nand(a, ns)
  gb = nand(b, s)
  out = nand(ga, gb)
}
```
