## A ring that starts itself

Build `Ring`, a two-step stepper. `s0` is high on even cycles and
`s1` on odd ones, and while `clear` is high the ring holds at step 0 instead
of advancing.

Only one flip-flop is allowed. The second step is stored; the first is worked
out from it.

@kind property
@concept Step 0 is not stored. It is the condition that no other step is
active, which is what makes the ring start from a cold reset.
@backend sim
@expect verdict table-mismatch
@hint Every flop comes up holding 0, so ask what `s0` has to be when the
stored step is 0.
@diagnose table-mismatch verdict table-mismatch
Both outputs sit at 0 for the whole trace, which means the ring never
started. A flop that comes up at 0 can only be driven high by something that
was already high, and on the first cycle nothing is. That is why `s0` has to
be derived from the absence of `s1` rather than copied from it.
@after Four gates and one flop. A real stepper is the same idea with more
positions, and the self-starting property is why a control unit needs no reset
circuit of its own.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Ring(clear) -> s0, s1 {
  nc = Not(clear)
  keep = And(s0, nc)
  s1 = dff(keep)
  s0 = s1
}
```

```spec
{"chip":"Ring","inputs":["clear"],"outputs":["s0","s1"],"trace":[[0,1,0],[0,0,1],[1,1,0],[0,1,0],[0,0,1],[0,1,0]],"maxGates":7}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Ring(clear) -> s0, s1 {
  nc = Not(clear)
  keep = And(s0, nc)
  s1 = dff(keep)
  s0 = Not(s1)
}
```

## Three steps, one of them at a time

Build `Stepper`, which walks a single 1 across `s0`, `s1` and
`s2` and then returns to `s0`. While `reset` is high the walk is cut short
and the next cycle is step 0 again.

Two flip-flops. As before, step 0 is what is left over.

@kind property
@concept One hot means one, and the cost of getting it wrong is two steps
driving the control wires in the same cycle.
@backend sim
@expect verdict table-mismatch
@hint Step 0 has to be low whenever any other step is high, not just when
the next one is.
@diagnose table-mismatch verdict table-mismatch
Look at the cycle where `s2` is high. If `s0` is high in that same
cycle then two steps are active at once, and a control table addressed by the
step number would be reading two rows and getting the bitwise or of both. Step
0 has to exclude every other step.
@after Nine gates. Extending it to five steps costs one flop and one more
input on the gate that computes step 0, which is why Eater's stepper is a
handful of parts rather than a design problem.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Stepper(reset) -> s0, s1, s2 {
  nr = Not(reset)
  d1 = And(s0, nr)
  d2 = And(s1, nr)
  s1 = dff(d1)
  s2 = dff(d2)
  s0 = Not(s1)
}
```

```spec
{"chip":"Stepper","inputs":["reset"],"outputs":["s0","s1","s2"],"trace":[[0,1,0,0],[1,0,1,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[0,1,0,0],[0,0,1,0],[0,0,0,1]],"maxGates":15}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Stepper(reset) -> s0, s1, s2 {
  nr = Not(reset)
  d1 = And(s0, nr)
  d2 = And(s1, nr)
  s1 = dff(d1)
  s2 = dff(d2)
  s0 = Nor(s1, s2)
}
```

## Two things driving one wire

Build `Drive`. The bus carries `a` while `e0` is asserted, and
`b` while `e1` is. `conflict` goes high exactly when both enables are
set at once.

`conflict` is not a signal any real machine has. It exists here so you can
see the case that a real bus cannot report.

@kind property
@concept A bus with two drivers is a short circuit, and the wire reports a
voltage either way, so nothing about the reading says the fault happened.
@backend sim
@expect verdict table-mismatch
@hint A conflict needs both enables, not either of them.
@diagnose table-mismatch verdict table-mismatch
A single driver is the normal case and it is not a fault. If
`conflict` goes high whenever anything at all is driving the bus, the check
is an or where it should be an and, and it would condemn every correct control
word in the table.
@after In silicon this is what the tri-state buffer enforces, and it enforces
it by being the only thing connected. The check has to live in whatever writes
the control table, because by the time the fault is on the wire it is heat.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Drive(e0, e1, a, b) -> out, conflict {
  ga = And(e0, a)
  gb = And(e1, b)
  out = Or(ga, gb)
  conflict = Or(e0, e1)
}
```

```spec
{"chip":"Drive","inputs":["e0","e1","a","b"],"outputs":["out","conflict"],"table":[[0,0,0,0,0,0],[0,0,0,1,0,0],[0,0,1,0,0,0],[0,0,1,1,0,0],[0,1,0,0,0,0],[0,1,0,1,1,0],[0,1,1,0,0,0],[0,1,1,1,1,0],[1,0,0,0,0,0],[1,0,0,1,0,0],[1,0,1,0,1,0],[1,0,1,1,1,0],[1,1,0,0,0,1],[1,1,0,1,1,1],[1,1,1,0,1,1],[1,1,1,1,1,1]],"maxGates":15}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Drive(e0, e1, a, b) -> out, conflict {
  ga = And(e0, a)
  gb = And(e1, b)
  out = Or(ga, gb)
  conflict = And(e0, e1)
}
```

## The control word, as a table

Build `Control`. The two opcode bits and the step number decide
three control wires.

Step 0 is the fetch and it is the same for every instruction: read memory, load
nothing. Step 1 is the instruction itself. Opcode 00 does nothing, 01 loads A
from memory, 10 loads B from memory, and 11 swaps A and B without touching
memory.

@kind property
@concept Decoding an instruction is looking up a row. The gates here are one
way to build that lookup; a small memory is the other, and it is the one real
machines use.
@backend sim
@expect verdict table-mismatch
@hint Three of the eight rows are the fetch, and the fetch does not care
what the opcode is.
@diagnose table-mismatch verdict table-mismatch
Check the rows where `step` is 0. Every one of them is a fetch and
every fetch reads memory, whatever the opcode says. A design that only asserts
`memOut` during execution has a machine that never gets its instruction, so
nothing at all runs.
@after Twenty seven gates for four instructions and two steps. Eater's
machine has sixteen control bits, sixteen instructions and five steps, and
building that from gates is why he uses a pair of memories instead.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Control(op1, op0, step) -> memOut, aLoad, bLoad {
  n1 = Not(op1)
  n0 = Not(op0)
  lda = And(n1, op0)
  ldb = And(op1, n0)
  swp = And(op1, op0)
  reads = Or(lda, ldb)
  memOut = And(step, reads)
  wa = Or(lda, swp)
  wb = Or(ldb, swp)
  aLoad = And(step, wa)
  bLoad = And(step, wb)
}
```

```spec
{"chip":"Control","inputs":["op1","op0","step"],"outputs":["memOut","aLoad","bLoad"],"table":[[0,0,0,1,0,0],[0,0,1,0,0,0],[0,1,0,1,0,0],[0,1,1,1,1,0],[1,0,0,1,0,0],[1,0,1,1,0,1],[1,1,0,1,0,0],[1,1,1,0,1,1]],"maxGates":44}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Control(op1, op0, step) -> memOut, aLoad, bLoad {
  n1 = Not(op1)
  n0 = Not(op0)
  lda = And(n1, op0)
  ldb = And(op1, n0)
  swp = And(op1, op0)
  ns = Not(step)
  reads = Or(lda, ldb)
  ex = And(step, reads)
  memOut = Or(ns, ex)
  wa = Or(lda, swp)
  wb = Or(ldb, swp)
  aLoad = And(step, wa)
  bLoad = And(step, wb)
}
```

## A flag has to be held

Build `Flag`. When `capture` is high the flag takes whatever
`carry` is showing. Otherwise it keeps what it had, however long that is.

The trace runs eight cycles and `carry` moves several times while
`capture` is low. None of that may reach the flag.

@kind property
@concept The arithmetic that sets a flag is over by the time a conditional
jump reads it, so the flag is storage rather than a wire.
@backend sim
@expect verdict table-mismatch
@hint The flop's input is a choice between the old value and the new one.
@diagnose table-mismatch verdict table-mismatch
Find the cycle where `carry` is high and `capture` is low. The
flag follows it, which means the design is wired straight to the adder and has
no memory of its own. Two instructions later, when a jump wants to know what
the subtraction decided, this flag is showing whatever the last unrelated
addition happened to produce.
@after Eight gates and one flop. The same shape as the load-enabled bit from
unit 009, which is not a coincidence: a flag register is a register.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Flag(carry, capture) -> held {
  held = dff(carry)
}
```

```spec
{"chip":"Flag","inputs":["carry","capture"],"outputs":["held"],"trace":[[0,0,0],[1,1,0],[0,0,1],[0,0,1],[0,0,1],[1,0,1],[0,1,1],[0,0,0]],"maxGates":13}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip Flag(carry, capture) -> held {
  nc = Not(capture)
  keep = And(held, nc)
  take = And(carry, capture)
  d = Or(keep, take)
  held = dff(d)
}
```

## A branch, with no branch hardware

Build `JumpIf`. `pcLoad` is high when a jump-if-zero instruction
meets a set zero flag, and when a jump-if-not-zero meets a clear one.

There is no comparator here and there is not one in the machine either. The
flag is an address line on the control memory, and this chip is the four
copies of one cell that the flag selects between.

@kind property
@concept Branching costs a wire into the table's address, and the table
holds the decision in the copies that flag selects.
@backend sim
@expect verdict table-mismatch
@hint Each instruction bit is gated by the flag in one polarity.
@diagnose table-mismatch verdict table-mismatch
The chip loads the counter whenever a jump instruction is present,
regardless of the flag. That is an unconditional jump, and a machine with only
unconditional jumps loops the same number of times forever, whatever the data
says.
@after Eight gates. This is the entire difference between a calculator and a
computer, and in Eater's design it is not even gates: it is the same table
stored four times with a few cells changed.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip JumpIf(zero, isJZ, isJNZ) -> pcLoad {
  pcLoad = Or(isJZ, isJNZ)
}
```

```spec
{"chip":"JumpIf","inputs":["zero","isJZ","isJNZ"],"outputs":["pcLoad"],"table":[[0,0,0,0],[0,0,1,1],[0,1,0,0],[0,1,1,1],[1,0,0,0],[1,0,1,0],[1,1,0,1],[1,1,1,1]],"maxGates":13}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip JumpIf(zero, isJZ, isJNZ) -> pcLoad {
  nz = Not(zero)
  takeZ = And(isJZ, zero)
  takeN = And(isJNZ, nz)
  pcLoad = Or(takeZ, takeN)
}
```

## Two and two makes five

Build `FlagClear`, which is the flag from the previous exercise
with one more input. `clear` forces the flag to 0 at the end of the cycle,
whatever `carry` and `capture` are doing.

An addition that reads a carry left over from an earlier instruction is off by
one and reports no error at all.

@kind property
@concept State that survives the instruction that set it is the point of a
flag, and also the bug, so something has to be able to throw it away.
@backend sim
@expect verdict table-mismatch
@hint Clearing beats both keeping and capturing.
@diagnose table-mismatch verdict table-mismatch
Follow the cycle where `clear` is high. The flag holds its old value
through it, so the carry from an earlier instruction is still there when the
next addition begins. Scott's description of the symptom is the whole
exercise: two and two makes five, and nothing anywhere reports a fault.
@after Eleven gates. Every instruction set that exposes flags also exposes a
way to clear them, and this is why.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip FlagClear(carry, capture, clear) -> held {
  nc = Not(capture)
  keep = And(held, nc)
  take = And(carry, capture)
  d = Or(keep, take)
  held = dff(d)
}
```

```spec
{"chip":"FlagClear","inputs":["carry","capture","clear"],"outputs":["held"],"trace":[[0,0,0,0],[1,1,0,0],[0,0,0,1],[0,0,1,1],[0,0,0,0],[1,1,0,0],[0,0,0,1],[0,1,0,1],[0,0,0,0]],"maxGates":18}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip FlagClear(carry, capture, clear) -> held {
  nc = Not(capture)
  keep = And(held, nc)
  take = And(carry, capture)
  want = Or(keep, take)
  ncl = Not(clear)
  d = And(want, ncl)
  held = dff(d)
}
```

## Count, or be told where to go

Build `PC`, a two-bit program counter. It counts up by one every
cycle and wraps from 3 back to 0. When `load` is high it takes `v1` and
`v0` instead, and carries on counting from there.

`p1` is the high bit. The loaded value appears on the cycle after `load`,
not during it.

@kind property
@concept The counter and the jump are the same component. A jump is the
counter being loaded rather than incremented.
@backend sim
@expect verdict table-mismatch
@hint Work out the incremented value and the loaded value separately, then
choose between them.
@diagnose table-mismatch verdict table-mismatch
The low bit behaves and the high bit does not, which means the
selection was applied to one of them and not the other. Both bits of the next
value have to pass through the same choice, or a jump moves half the counter
and leaves the other half counting.
@after Twenty one gates and two flops. Widen it to sixteen bits and this is
the component the fetch reads from and the branch writes to, which makes it the
only register in the machine that both halves of the loop touch.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip PC(v1, v0, load) -> p1, p0 {
  i0 = Not(p0)
  i1 = Xor(p1, p0)
  n0 = Mux(load, i0, v0)
  n1 = Mux(load, i1, v1)
  p0 = dff(n0)
  p1 = dff(i1)
}
```

```spec
{"chip":"PC","inputs":["v1","v0","load"],"outputs":["p1","p0"],"trace":[[0,0,0,0,0],[0,0,0,0,1],[0,0,0,1,0],[0,0,0,1,1],[1,1,1,0,0],[0,0,0,1,1],[0,0,0,0,0],[1,0,1,0,1],[0,0,0,1,0]],"maxGates":34}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
chip Nor(a, b) -> out {
  o = Or(a, b)
  out = Not(o)
}
chip Xor(a, b) -> out {
  n = nand(a, b)
  x = nand(a, n)
  y = nand(b, n)
  out = nand(x, y)
}
chip Mux(s, a, b) -> out {
  ns = Not(s)
  ka = And(ns, a)
  kb = And(s, b)
  out = Or(ka, kb)
}
chip PC(v1, v0, load) -> p1, p0 {
  i0 = Not(p0)
  i1 = Xor(p1, p0)
  n0 = Mux(load, i0, v0)
  n1 = Mux(load, i1, v1)
  p0 = dff(n0)
  p1 = dff(n1)
}
```
