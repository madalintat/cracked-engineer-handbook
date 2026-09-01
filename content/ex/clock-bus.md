## Two drivers is a short

Build `Clash`, which outputs 1 when more than one of three enable signals is
high. This is a fault detector: its job is to notice the wiring that destroys
the parts.

@kind property
@concept A bus is a rule rather than a component, and the rule is that exactly
one output drives it at a time.
@backend sim
@expect verdict table-mismatch
@hint Any pair being high at once is a clash. There are three pairs.
@diagnose table-mismatch verdict table-mismatch
Read the row that disagreed. The output is 1 when any two are high together,
which includes the row where all three are, so an answer that is only true for
exactly two misses that one.
@after Two enabled outputs on a shared wire is a path from the supply straight
to ground through two gates. That is the crowbar current from Part I, and it is
why every bus in every machine has a rule about who may drive it.

```starter
chip Clash(a, b, c) -> out {
  out = nand(a, b)
}
```

```spec
{"chip": "Clash", "inputs": ["a", "b", "c"], "outputs": ["out"], "table": [[0, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 1, 1, 1], [1, 0, 0, 0], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 1]], "maxGates": 20}
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
chip Clash(a, b, c) -> out {
  ab = And(a, b)
  ac = And(a, c)
  bc = And(b, c)
  x = Or(ab, ac)
  out = Or(x, bc)
}
```

## Exactly one, not at least one

Build `OneHot3`, which outputs 1 when exactly one of the three enables is high.

@kind property
@concept "At least one" and "exactly one" are different circuits, and a bus
needs the second.
@backend sim
@expect verdict table-mismatch
@hint At least one, and not more than one.
@diagnose table-mismatch verdict table-mismatch
The all-zero row and the all-one row both want 0, for different reasons. An
answer that is high on the all-ones row has built "at least one", which is the
rule that permits a short.
@after A real control unit asserts one enable per cycle and this is the
assertion that says so. Part III runs checks of exactly this shape during
synthesis rather than during simulation.

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
chip OneHot3(a, b, c) -> out {
  x = Or(a, b)
  out = Or(x, c)
}
```

```spec
{"chip": "OneHot3", "inputs": ["a", "b", "c"], "outputs": ["out"], "table": [[0, 0, 0, 0], [0, 0, 1, 1], [0, 1, 0, 1], [0, 1, 1, 0], [1, 0, 0, 1], [1, 0, 1, 0], [1, 1, 0, 0], [1, 1, 1, 0]], "maxGates": 30}
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
chip OneHot3(a, b, c) -> out {
  any1 = Or(a, b)
  any = Or(any1, c)
  ab = And(a, b)
  ac = And(a, c)
  bc = And(b, c)
  m1 = Or(ab, ac)
  more = Or(m1, bc)
  nmore = Not(more)
  out = And(any, nmore)
}
```

## The bus you can actually build here

Build `Bus3`, which puts one of three sources onto a single output, chosen by
two select bits. A select of 3 reads the first source again, because three
sources do not fill four combinations.

@kind property
@concept Inside a chip a shared wire is a multiplexer, because there is nowhere
for a second driver to connect and therefore no rule to get wrong.
@backend sim
@expect verdict table-mismatch
@hint Two multiplexers on the low bit and one on the high bit, and the spare
combination can be anything the specification says.
@diagnose table-mismatch verdict table-mismatch
Read which source the failing row wanted. The select is two bits with `s1` as
the high one, so a select of 2 is `s1` high and `s0` low, which reads the third
source.
@diagnose non-nand-part verdict non-nand-part
Everything you use has to be defined in this file, `Mux` included.
@after On a board you would use three drivers and a rule. Inside a chip you use
this, because wires are cheap and a short is fatal. Modern chips are almost
entirely the second kind.

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
chip Bus3(a, b, c, s1, s0) -> out {
  out = Mux(a, b, s0)
}
```

```spec
{"chip": "Bus3", "inputs": ["a", "b", "c", "s1", "s0"], "outputs": ["out"], "table": [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0], [0, 0, 0, 1, 0, 0], [0, 0, 0, 1, 1, 0], [0, 0, 1, 0, 0, 0], [0, 0, 1, 0, 1, 0], [0, 0, 1, 1, 0, 1], [0, 0, 1, 1, 1, 0], [0, 1, 0, 0, 0, 0], [0, 1, 0, 0, 1, 1], [0, 1, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 1, 1, 0, 0, 0], [0, 1, 1, 0, 1, 1], [0, 1, 1, 1, 0, 1], [0, 1, 1, 1, 1, 0], [1, 0, 0, 0, 0, 1], [1, 0, 0, 0, 1, 0], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 1], [1, 0, 1, 0, 0, 1], [1, 0, 1, 0, 1, 0], [1, 0, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1], [1, 1, 0, 0, 0, 1], [1, 1, 0, 0, 1, 1], [1, 1, 0, 1, 0, 0], [1, 1, 0, 1, 1, 1], [1, 1, 1, 0, 0, 1], [1, 1, 1, 0, 1, 1], [1, 1, 1, 1, 0, 1], [1, 1, 1, 1, 1, 1]], "maxGates": 30}
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
chip Bus3(a, b, c, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, a, s0)
  out = Mux(lo, hi, s1)
}
```

## The capture inside the drive

Build `GatedLoad`, a register that captures its input only when both `en` and
`cap` are high. The output shows what it held coming into the cycle.

@kind property
@concept The capture window sits strictly inside the driving window, so the
destination has finished before the source lets go.
@backend sim
@expect verdict table-mismatch
@hint Both conditions, and then the register you already have.
@diagnose table-mismatch verdict table-mismatch
Read the cycle. A design that loads when either signal is high captures while
the source may already have stopped driving, which is the bus fault this
exercise is about.
@after Every bus transfer in every machine has this shape: the enable is wide
and the capture is narrow, and the narrow one lives inside the wide one.

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
chip GatedLoad(d, en, cap) -> out {
  both = Or(en, cap)
  out = Bit(d, both)
}
```

```spec
{"chip": "GatedLoad", "inputs": ["d", "en", "cap"], "outputs": ["out"], "trace": [[1, 1, 1, 0], [0, 1, 0, 1], [0, 0, 0, 1], [0, 1, 1, 1], [1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 1]]}
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
chip GatedLoad(d, en, cap) -> out {
  both = And(en, cap)
  out = Bit(d, both)
}
```

## Moving a value between two registers

Build `Transfer`. Register A loads `seed` when `load_a` is high. The bus carries
A when `sel` is 0 and `seed` when `sel` is 1. Register B loads the bus when
`load_b` is high. Outputs are A, B and the bus, all as of the start of the
cycle.

@kind property
@concept A transfer is a source enabled onto a wire and a destination capturing
from it, and both halves are ordinary parts you have already built.
@backend sim
@expect verdict table-mismatch
@hint Two registers and a multiplexer between them. The bus is combinational.
@diagnose table-mismatch verdict table-mismatch
Read which of the three outputs disagreed. The bus is not stored, so it changes
in the same cycle its inputs do, while the two registers show what they held
coming in. Mixing those up makes everything look one cycle out.
@diagnose cycle verdict cycle
The bus feeds B and B does not feed the bus, so the loop you have is not the one
the design needs. Check which register the multiplexer is reading.
@after This is a whole datapath in miniature. Add an address to choose which
register, and the next unit has a memory.

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
chip Transfer(seed, load_a, sel, load_b) -> a, b, bus {
  a = Bit(seed, load_a)
  bus = Mux(a, seed, sel)
  b = Bit(bus, load_b)
  bus = a
}
```

```spec
{"chip": "Transfer", "inputs": ["seed", "load_a", "sel", "load_b"], "outputs": ["a", "b", "bus"], "trace": [[1, 1, 1, 0, 0, 0, 1], [0, 0, 0, 0, 1, 0, 1], [0, 0, 0, 1, 1, 0, 1], [0, 0, 0, 0, 1, 1, 1], [0, 0, 0, 0, 1, 1, 1]]}
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
chip Transfer(seed, load_a, sel, load_b) -> a, b, bus {
  a = Bit(seed, load_a)
  bus = Mux(a, seed, sel)
  b = Bit(bus, load_b)
}
```

## An enable that is never two

Build `SafeEnable2`, which takes two requests and produces two enables, with the
first request winning if both arrive at once.

@kind property
@concept Priority is how a design guarantees one driver without needing anyone
to promise it.
@backend sim
@expect verdict table-mismatch
@hint The second enable is its request, and not the first request.
@diagnose table-mismatch verdict table-mismatch
The row where both requests are high is the only interesting one. The first
enable is high there and the second is not, which is what makes the pair
impossible to get wrong.
@after Building the guarantee into the circuit beats writing it in a comment.
Every interrupt controller and every arbiter is this shape with more inputs.

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
chip SafeEnable2(r0, r1) -> e0, e1 {
  e0 = r0
  e1 = r1
}
```

```spec
{"chip": "SafeEnable2", "inputs": ["r0","r1"], "outputs": ["e0","e1"],
  "table": [[0,0, 0,0], [0,1, 0,1], [1,0, 1,0], [1,1, 1,0]], "maxGates": 10}
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
chip SafeEnable2(r0, r1) -> e0, e1 {
  e0 = r0
  n0 = Not(r0)
  e1 = And(r1, n0)
}
```

## A clock you can build from nothing stable

Build `Ring3`, three inverters in a ring, and observe that it never settles. The
specification traces what the simulator computes, which is one flip per cycle
because the loop is broken by a flip-flop.

@kind property
@concept An oscillator is a circuit with no stable state, and the cheapest one
is an odd number of inversions in a loop.
@backend sim
@expect verdict table-mismatch
@hint An odd number of inversions round a loop, with the flip-flop making the
loop legal here.
@diagnose table-mismatch verdict table-mismatch
Three inverters invert an odd number of times, so the value that comes back is
the opposite of the one that left. With the flip-flop in the loop that becomes
one flip per cycle rather than an oscillation at the speed of the gates.
@diagnose cycle verdict cycle
Without a flip-flop this is a genuine combinational loop, and a real one
oscillates rather than settling. That is what makes it useful as a clock and
useless as logic.
@after A ring of inverters on a real chip oscillates at a frequency set by how
fast that silicon happens to be, which is why one is often built in on purpose
as a way of measuring the process.

```starter
chip Ring3(tick) -> out {
  out = dff(tick)
}
```

```spec
{"chip": "Ring3", "inputs": ["tick"], "outputs": ["out"],
  "trace": [[1,0],[1,1],[1,0],[1,1],[1,0]]}
```

```solution
chip Ring3(tick) -> out {
  a = nand(out, out)
  b = nand(a, a)
  c = nand(b, b)
  out = dff(c)
}
```

## What the longest path costs

Build `SlowPath`, a chain of four inversions from input to output, and notice
that its answer is its input while its depth is four gates.

@kind property
@concept The clock period must exceed the longest path between flip-flops, and
that path is measured in gates rather than in operations.
@backend sim
@expect verdict gate-budget
@hint Four inversions return the value unchanged. The exercise is about the
count, not the function.
@diagnose gate-budget verdict gate-budget
Correct, and over the budget. The specification wants exactly the four
inversions, so a design that folds them away is measuring a different circuit
from the one being discussed.
@diagnose table-mismatch verdict table-mismatch
An odd number of inversions gives the opposite of the input. Count them.
@after Every operation in a machine costs what the slowest one costs, because
they all wait for the same edge. Making a machine faster means shortening this
path, which is what pipelining does five parts from here by cutting it into
pieces with flip-flops between them.

```starter
chip SlowPath(a) -> out {
  n1 = nand(a, a)
  n2 = nand(n1, n1)
  n3 = nand(n2, n2)
  n4 = nand(n3, n3)
  n5 = nand(n4, n4)
  out = nand(n5, n5)
}
```

```spec
{"chip": "SlowPath", "inputs": ["a"], "outputs": ["out"],
  "table": [[0,0],[1,1]], "maxGates": 4}
```

```solution
chip SlowPath(a) -> out {
  n1 = nand(a, a)
  n2 = nand(n1, n1)
  n3 = nand(n2, n2)
  out = nand(n3, n3)
}
```
