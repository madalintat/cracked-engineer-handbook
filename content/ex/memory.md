## Four registers behind an address

Build `Mem4`, a memory of four one-bit locations. The two address bits select
one, `load` writes `din` to it, and the output is always whatever that location
held coming into the cycle.

@kind property
@concept A memory is a decoder gating the loads, a row of registers, and a
multiplexer choosing the output. There is no fourth idea.
@backend sim
@expect verdict table-mismatch
@hint The decoder gives four lines. Each register's load is `load` ANDed with
its own line.
@diagnose table-mismatch verdict table-mismatch
Read the address on the failing cycle. Wrong at one address and right at the
others is a decoder problem. Wrong everywhere at once usually means the load
signal reaches every register ungated, so a write to any address writes to all
of them.
@diagnose cycle verdict cycle
Each register's output feeds only the multiplexer, and the multiplexer's output
does not feed back to any register's input. Check what you connected to the
data inputs.
@after Every location costs the same here: the same wires carry a different
pattern into the same gates. That stops being true the moment there is a cache,
and Part V is largely about it stopping.

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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Mem4(a1, a0, din, load) -> out {
  r0 = Bit(din, load)
  r1 = Bit(din, load)
  r2 = Bit(din, load)
  r3 = Bit(din, load)
  out = Mux4(r0, r1, r2, r3, a1, a0)
}
```

```spec
{"chip": "Mem4", "inputs": ["a1", "a0", "din", "load"], "outputs": ["out"], "trace": [[0, 0, 1, 1, 0], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0], [0, 1, 0, 0, 1], [0, 0, 0, 0, 1], [1, 0, 1, 1, 0], [0, 1, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 0, 0, 0], [0, 0, 1, 1, 1], [0, 0, 0, 0, 1]]}
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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Mem4(a1, a0, din, load) -> out {
  l0, l1, l2, l3 = Dec2(a1, a0)
  w0 = And(l0, load)
  w1 = And(l1, load)
  w2 = And(l2, load)
  w3 = And(l3, load)
  r0 = Bit(din, w0)
  r1 = Bit(din, w1)
  r2 = Bit(din, w2)
  r3 = Bit(din, w3)
  out = Mux4(r0, r1, r2, r3, a1, a0)
}
```

## A counter that can be told where to go

Build `PC`, a two-bit program counter. It increments when `en` is high, and
when `jmp` is high it loads the address on `j1` and `j0` instead. The output is
the value it held coming into the cycle.

@kind property
@concept A jump is the load input of a counter you already built, not a
mechanism of its own.
@backend sim
@expect verdict table-mismatch
@hint Compute the incremented value, then choose between it and the jump target
before storing.
@diagnose table-mismatch verdict table-mismatch
Read the cycle after the one where `jmp` was high. A jump takes effect on the
next cycle like every other stored value, so the counter shows the target one
cycle later, not immediately.
@diagnose cycle verdict cycle
The next value depends on the current one, which is legal only through the
flip-flops. The increment and the multiplexer both belong between the
register's output and its input.
@after A jump costs the same as not jumping: both are one edge into the same
register, and the multiplexer decided which value arrived.

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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip PC(en, jmp, j1, j0) -> q1, q0 {
  q1 = Bit(j1, jmp)
  q0 = Bit(j0, jmp)
}
```

```spec
{"chip": "PC", "inputs": ["en", "jmp", "j1", "j0"], "outputs": ["q1", "q0"], "trace": [[1, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 0], [1, 0, 0, 0, 1, 1], [1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1], [1, 1, 0, 1, 0, 1], [1, 0, 0, 0, 0, 1]]}
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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip PC(en, jmp, j1, j0) -> q1, q0 {
  n0 = Not(q0)
  i0 = Mux(q0, n0, en)
  t1 = Xor(q1, q0)
  i1 = Mux(q1, t1, en)
  d0 = Mux(i0, j0, jmp)
  d1 = Mux(i1, j1, jmp)
  one = Or(en, jmp)
  hold = Or(one, one)
  q0 = Bit(d0, hold)
  q1 = Bit(d1, hold)
}
```

## Jumping only if

Build `CondPC`, the same counter where the jump happens only when both `want`
and `flag` are high.

@kind property
@concept A conditional branch is the same load with its enable gated by a flag.
There is no branch hardware.
@backend sim
@expect verdict table-mismatch
@hint One AND in front of the jump control, and everything else is the previous
exercise.
@diagnose table-mismatch verdict table-mismatch
The cycle where `want` is high and `flag` is low is the one that separates a
correct design from one that always jumps. It should carry on counting.
@after Two more wires and a machine can make a decision. The flags those wires
read are the leftovers of an arithmetic operation that already happened, which
is unit 007 arriving where it was going.

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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip CondPC(en, want, flag, j1, j0) -> q1, q0 {
  n0 = Not(q0)
  i0 = Mux(q0, n0, en)
  t1 = Xor(q1, q0)
  i1 = Mux(q1, t1, en)
  d0 = Mux(i0, j0, want)
  d1 = Mux(i1, j1, want)
  one = Or(en, want)
  q0 = Bit(d0, one)
  q1 = Bit(d1, one)
}
```

```spec
{"chip": "CondPC", "inputs": ["en", "want", "flag", "j1", "j0"], "outputs": ["q1", "q0"], "trace": [[1, 0, 0, 0, 0, 0, 0], [1, 1, 0, 1, 1, 0, 1], [1, 1, 1, 1, 1, 1, 0], [1, 0, 0, 0, 0, 1, 1], [1, 0, 0, 0, 0, 0, 0]]}
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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip CondPC(en, want, flag, j1, j0) -> q1, q0 {
  take = And(want, flag)
  n0 = Not(q0)
  i0 = Mux(q0, n0, en)
  t1 = Xor(q1, q0)
  i1 = Mux(q1, t1, en)
  d0 = Mux(i0, j0, take)
  d1 = Mux(i1, j1, take)
  one = Or(en, take)
  q0 = Bit(d0, one)
  q1 = Bit(d1, one)
}
```

## Reading what was there before

Build `ReadBeforeWrite`, a single location that is read and written in the same
cycle. The output must be the value it held coming in, never the value being
written.

@kind property
@concept A read in the same cycle as a write returns the old value, and that is
what makes a whole class of instruction possible rather than being a quirk.
@backend sim
@expect verdict table-mismatch
@hint The register you already have does this. The mistake is routing the input
to the output.
@diagnose table-mismatch verdict table-mismatch
If the output equals the value being written on the same cycle, the input is
reaching the output combinationally. The register's output is what should be
read, and it shows the previous value by construction.
@after A value can be read from a register, sent through an adder, and written
back into the same register in one cycle precisely because the read sees the old
value. Every accumulator instruction in every machine depends on it.

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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip ReadBeforeWrite(din, load) -> out {
  stored = Bit(din, load)
  out = Mux(stored, din, load)
}
```

```spec
{"chip": "ReadBeforeWrite", "inputs": ["din", "load"], "outputs": ["out"], "trace": [[1, 1, 0], [0, 1, 1], [1, 1, 0], [0, 0, 1], [0, 0, 1]]}
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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip ReadBeforeWrite(din, load) -> out {
  out = Bit(din, load)
}
```

## Where the top is

Build `StackPointer`, a two-bit counter that increments on `push`, decrements on
`pop`, and holds otherwise. Push wins if both arrive.

@kind property
@concept A stack is a memory and a register holding a number, plus an agreement
about what the number means.
@backend sim
@expect verdict table-mismatch
@hint Decrementing by one is adding the all-ones value, which for two bits is
adding three.
@diagnose table-mismatch verdict table-mismatch
Read the cycle where `pop` is high. Going down from 0 wraps to 3, the same way
going up from 3 wraps to 0, because nothing is checking the range.
@after There is no stack in the hardware. There is a number and an agreement,
and nothing enforces what it points to, which is where a whole category of
security unit later comes from.

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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip StackPointer(push, pop) -> q1, q0 {
  n0 = Not(q0)
  q0 = Bit(n0, push)
  q1 = Bit(q1, push)
}
```

```spec
{"chip": "StackPointer", "inputs": ["push", "pop"], "outputs": ["q1", "q0"], "trace": [[1, 0, 0, 0], [1, 0, 0, 1], [1, 0, 1, 0], [0, 1, 1, 1], [0, 1, 1, 0], [0, 0, 0, 1], [1, 0, 0, 1]]}
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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip StackPointer(push, pop) -> q1, q0 {
  move = Or(push, pop)
  n0 = Not(q0)
  up1 = Xor(q1, q0)
  dn1 = Xor(q1, n0)
  d1 = Mux(dn1, up1, push)
  d0 = n0
  q0 = Bit(d0, move)
  q1 = Bit(d1, move)
}
```

## The decoder on its own

Build `WriteEnables`, which takes an address and a write signal and produces the
four per-register load lines.

@kind property
@concept The write half of a memory is a decoder ANDed with the write signal,
and separating it out makes the whole arrangement obvious.
@backend sim
@expect verdict table-mismatch
@hint Four lines from the address, each gated by the write signal.
@diagnose table-mismatch verdict table-mismatch
With `write` low every output is 0 whatever the address is, because nothing is
being written. A design that leaves the decoder ungated raises a line even when
nobody asked for a write.
@after One AND per row is the entire difference between a decoder and the write
port of a memory.

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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip WriteEnables(a1, a0, write) -> w0, w1, w2, w3 {
  w0, w1, w2, w3 = Dec2(a1, a0)
}
```

```spec
{"chip": "WriteEnables", "inputs": ["a1","a0","write"],
  "outputs": ["w0","w1","w2","w3"],
  "table": [[0,0,0, 0,0,0,0], [0,0,1, 1,0,0,0],
            [0,1,0, 0,0,0,0], [0,1,1, 0,1,0,0],
            [1,0,0, 0,0,0,0], [1,0,1, 0,0,1,0],
            [1,1,0, 0,0,0,0], [1,1,1, 0,0,0,1]], "maxGates": 30}
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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip WriteEnables(a1, a0, write) -> w0, w1, w2, w3 {
  l0, l1, l2, l3 = Dec2(a1, a0)
  w0 = And(l0, write)
  w1 = And(l1, write)
  w2 = And(l2, write)
  w3 = And(l3, write)
}
```

## The read half

Build `ReadPort`, which selects one of four stored values using the same address
the write half uses.

@kind property
@concept The read half is a multiplexer on the same address, which is why one
number serves both directions.
@backend sim
@expect verdict table-mismatch
@hint You built this in unit 006 under another name.
@diagnose table-mismatch verdict table-mismatch
The address bits have a high one and a low one, and swapping them passes half
the rows. Check which value an address of 2 should select.
@after The same number lights one write line and steers one read path. That is
the whole reason an address works.

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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip ReadPort(v0, v1, v2, v3, a1, a0) -> out {
  out = Mux(v0, v1, a0)
}
```

```spec
{"chip": "ReadPort", "inputs": ["v0","v1","v2","v3","a1","a0"],
  "outputs": ["out"],
  "table": [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 1, 1, 0], [0, 0, 0, 1, 0, 0, 0], [0, 0, 0, 1, 0, 1, 0], [0, 0, 0, 1, 1, 0, 0], [0, 0, 0, 1, 1, 1, 1], [0, 0, 1, 0, 0, 0, 0], [0, 0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 0, 1], [0, 0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 0, 0], [0, 0, 1, 1, 0, 1, 0], [0, 0, 1, 1, 1, 0, 1], [0, 0, 1, 1, 1, 1, 1], [0, 1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 1, 1], [0, 1, 0, 0, 1, 0, 0], [0, 1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 0, 0, 0], [0, 1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 0, 0], [0, 1, 0, 1, 1, 1, 1], [0, 1, 1, 0, 0, 0, 0], [0, 1, 1, 0, 0, 1, 1], [0, 1, 1, 0, 1, 0, 1], [0, 1, 1, 0, 1, 1, 0], [0, 1, 1, 1, 0, 0, 0], [0, 1, 1, 1, 0, 1, 1], [0, 1, 1, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 1, 1, 0], [1, 0, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 1, 0], [1, 0, 0, 1, 1, 0, 0], [1, 0, 0, 1, 1, 1, 1], [1, 0, 1, 0, 0, 0, 1], [1, 0, 1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 1, 0], [1, 0, 1, 1, 0, 0, 1], [1, 0, 1, 1, 0, 1, 0], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 0, 0, 1], [1, 1, 0, 0, 0, 1, 1], [1, 1, 0, 0, 1, 0, 0], [1, 1, 0, 0, 1, 1, 0], [1, 1, 0, 1, 0, 0, 1], [1, 1, 0, 1, 0, 1, 1], [1, 1, 0, 1, 1, 0, 0], [1, 1, 0, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0, 1], [1, 1, 1, 0, 0, 1, 1], [1, 1, 1, 0, 1, 0, 1], [1, 1, 1, 0, 1, 1, 0], [1, 1, 1, 1, 0, 0, 1], [1, 1, 1, 1, 0, 1, 1], [1, 1, 1, 1, 1, 0, 1], [1, 1, 1, 1, 1, 1, 1]],
  "maxGates": 30}
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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip ReadPort(v0, v1, v2, v3, a1, a0) -> out {
  out = Mux4(v0, v1, v2, v3, a1, a0)
}
```

## Splitting the address

Build `TwoLevel`, which selects one of four values using a two-level tree: the
low bit chooses within a pair and the high bit chooses between the pairs.

@kind property
@concept Real memories are trees, because a flat decode of any real width is a
fan-in nobody can build.
@backend sim
@expect verdict table-mismatch
@hint Three two-way multiplexers, and the high bit decides last.
@diagnose table-mismatch verdict table-mismatch
The two halves are chosen by the low bit and the result by the high bit. Doing
it the other way round passes the rows where both bits agree and fails the rest.
@after Depth grows with the logarithm of the size rather than the size, which
is why the address of a byte in a real machine is split into pieces at several
levels before it reaches anything that stores a bit.

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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip TwoLevel(v0, v1, v2, v3, a1, a0) -> out {
  lo = Mux(v0, v1, a1)
  hi = Mux(v2, v3, a1)
  out = Mux(lo, hi, a0)
}
```

```spec
{"chip": "TwoLevel", "inputs": ["v0","v1","v2","v3","a1","a0"],
  "outputs": ["out"],
  "table": [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 1, 1, 0], [0, 0, 0, 1, 0, 0, 0], [0, 0, 0, 1, 0, 1, 0], [0, 0, 0, 1, 1, 0, 0], [0, 0, 0, 1, 1, 1, 1], [0, 0, 1, 0, 0, 0, 0], [0, 0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 0, 1], [0, 0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 0, 0], [0, 0, 1, 1, 0, 1, 0], [0, 0, 1, 1, 1, 0, 1], [0, 0, 1, 1, 1, 1, 1], [0, 1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 1, 1], [0, 1, 0, 0, 1, 0, 0], [0, 1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 0, 0, 0], [0, 1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 0, 0], [0, 1, 0, 1, 1, 1, 1], [0, 1, 1, 0, 0, 0, 0], [0, 1, 1, 0, 0, 1, 1], [0, 1, 1, 0, 1, 0, 1], [0, 1, 1, 0, 1, 1, 0], [0, 1, 1, 1, 0, 0, 0], [0, 1, 1, 1, 0, 1, 1], [0, 1, 1, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 1, 1, 0], [1, 0, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 1, 0], [1, 0, 0, 1, 1, 0, 0], [1, 0, 0, 1, 1, 1, 1], [1, 0, 1, 0, 0, 0, 1], [1, 0, 1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 1, 0], [1, 0, 1, 1, 0, 0, 1], [1, 0, 1, 1, 0, 1, 0], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 0, 0, 1], [1, 1, 0, 0, 0, 1, 1], [1, 1, 0, 0, 1, 0, 0], [1, 1, 0, 0, 1, 1, 0], [1, 1, 0, 1, 0, 0, 1], [1, 1, 0, 1, 0, 1, 1], [1, 1, 0, 1, 1, 0, 0], [1, 1, 0, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0, 1], [1, 1, 1, 0, 0, 1, 1], [1, 1, 1, 0, 1, 0, 1], [1, 1, 1, 0, 1, 1, 0], [1, 1, 1, 1, 0, 0, 1], [1, 1, 1, 1, 0, 1, 1], [1, 1, 1, 1, 1, 0, 1], [1, 1, 1, 1, 1, 1, 1]],
  "maxGates": 20}
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
chip Mux4(a, b, c, d, s1, s0) -> out {
  lo = Mux(a, b, s0)
  hi = Mux(c, d, s0)
  out = Mux(lo, hi, s1)
}
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip TwoLevel(v0, v1, v2, v3, a1, a0) -> out {
  lo = Mux(v0, v1, a0)
  hi = Mux(v2, v3, a0)
  out = Mux(lo, hi, a1)
}
```
