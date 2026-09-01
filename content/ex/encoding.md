## Cutting the fields out

Build `Fields`, which splits a four-bit instruction into a two-bit opcode and a
two-bit register number. The outputs are, in order, the two opcode bits and the
two register bits.

@kind property
@concept A field is a wire. Extracting one costs nothing, which is the whole
reason a layout is chosen the way it is.
@backend sim
@expect verdict table-mismatch
@hint No gates are needed. The bits are already in the right order.
@diagnose table-mismatch verdict table-mismatch
The instruction bits go straight through: `i3` and `i2` are the opcode and `i1`
and `i0` are the register. A design that inverts or combines them is doing work
that a correct layout means nobody has to do.
@after Zero gates. Every field in every fixed-layout instruction set costs
exactly this, which is why keeping a field in the same place across
instructions is worth designing around.

```starter
chip Fields(i3, i2, i1, i0) -> op1, op0, r1, r0 {
  op1 = nand(i3, i3)
  op0 = i2
  r1 = i1
  r0 = i0
}
```

```spec
{"chip": "Fields", "inputs": ["i3", "i2", "i1", "i0"], "outputs": ["op1", "op0", "r1", "r0"], "table": [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 1, 0, 0, 1, 1], [0, 1, 0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1, 1, 0], [0, 1, 1, 1, 0, 1, 1, 1], [1, 0, 0, 0, 1, 0, 0, 0], [1, 0, 0, 1, 1, 0, 0, 1], [1, 0, 1, 0, 1, 0, 1, 0], [1, 0, 1, 1, 1, 0, 1, 1], [1, 1, 0, 0, 1, 1, 0, 0], [1, 1, 0, 1, 1, 1, 0, 1], [1, 1, 1, 0, 1, 1, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1]], "maxGates": 2}
```

```solution
chip Fields(i3, i2, i1, i0) -> op1, op0, r1, r0 {
  op1 = i3
  op0 = i2
  r1 = i1
  r0 = i0
}
```

## One bit chooses a half

Build `SplitKind`. When `kind` is 1 the instruction is arithmetic, so `arith`
follows `a` and `other` is 0. When `kind` is 0 it is the other family, so
`other` follows `a` and `arith` is 0.

@kind property
@concept One bit separating two families means neither half needs to examine
the other's fields, which is most of what makes decoding cheap.
@backend sim
@expect verdict table-mismatch
@hint Each output is the shared signal gated by the kind bit in one polarity.
@diagnose table-mismatch verdict table-mismatch
Both outputs cannot be high at once, whatever `a` is, because the instruction
is one kind or the other. If a row has both high, the gating is missing on one
of them.
@after Nothing else needs examining to know which half of the machine is
involved. That is the trick, and it costs two gates.

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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip SplitKind(kind, a, b) -> arith, other {
  arith = And(kind, a)
  other = And(kind, a)
}
```

```spec
{"chip": "SplitKind", "inputs": ["kind", "a", "b"], "outputs": ["arith", "other"], "table": [[0, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 1, 0, 0, 1], [0, 1, 1, 0, 1], [1, 0, 0, 0, 0], [1, 0, 1, 0, 0], [1, 1, 0, 1, 0], [1, 1, 1, 1, 0]], "maxGates": 8}
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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip SplitKind(kind, a, b) -> arith, other {
  nk = Not(kind)
  arith = And(kind, a)
  other = And(nk, a)
}
```

## The decoder in the other half

Build `OpDecode`, which raises exactly one of four lines from a two-bit opcode,
but only when `kind` is 0. When `kind` is 1 every line is low.

@kind property
@concept The decoder is an ordinary one from unit 006 with its outputs gated by
the family bit. There is no lookup and no interpretation.
@backend sim
@expect verdict table-mismatch
@hint A decoder, and then one gate per line.
@diagnose table-mismatch verdict table-mismatch
When `kind` is 1 all four outputs are 0, because this half of the machine is
not the one being asked. A design that leaves the decoder ungated raises a line
for an arithmetic instruction, which then does two things at once.
@after Three bits into a small decoder is the entire non-arithmetic decode in
Scott's machine. Not a lookup table, not an interpreter.

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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip OpDecode(kind, o1, o0) -> d0, d1, d2, d3 {
  d0, d1, d2, d3 = Dec2(o1, o0)
}
```

```spec
{"chip": "OpDecode", "inputs": ["kind", "o1", "o0"], "outputs": ["d0", "d1", "d2", "d3"], "table": [[0, 0, 0, 1, 0, 0, 0], [0, 0, 1, 0, 1, 0, 0], [0, 1, 0, 0, 0, 1, 0], [0, 1, 1, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0], [1, 0, 1, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0, 0]], "maxGates": 30}
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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip OpDecode(kind, o1, o0) -> d0, d1, d2, d3 {
  nk = Not(kind)
  a0, a1, a2, a3 = Dec2(o1, o0)
  d0 = And(a0, nk)
  d1 = And(a1, nk)
  d2 = And(a2, nk)
  d3 = And(a3, nk)
}
```

## The destination field becomes write enables

Build `WriteEnable`, which turns the two-bit destination field into four write
lines, all low unless `w` is high.

@kind property
@concept The destination field goes straight onto a decoder's select inputs,
and the write flag gates the result. That is the whole write path.
@backend sim
@expect verdict table-mismatch
@hint You built this in unit 010. The field is the address.
@diagnose table-mismatch verdict table-mismatch
With `w` low nothing is written, so all four are 0 whatever the destination
says. Naming a register is not the same as writing to it.
@after The field is not a name for a register. It is the number that lights
that register's line, which is the same statement as unit 006 arriving in an
instruction set.

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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip WriteEnable(d1, d0, w) -> w0, w1, w2, w3 {
  w0, w1, w2, w3 = Dec2(d1, d0)
}
```

```spec
{"chip": "WriteEnable", "inputs": ["d1", "d0", "w"], "outputs": ["w0", "w1", "w2", "w3"], "table": [[0, 0, 0, 0, 0, 0, 0], [0, 0, 1, 1, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0], [0, 1, 1, 0, 1, 0, 0], [1, 0, 0, 0, 0, 0, 0], [1, 0, 1, 0, 0, 1, 0], [1, 1, 0, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0, 1]], "maxGates": 30}
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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip WriteEnable(d1, d0, w) -> w0, w1, w2, w3 {
  a0, a1, a2, a3 = Dec2(d1, d0)
  w0 = And(a0, w)
  w1 = And(a1, w)
  w2 = And(a2, w)
  w3 = And(a3, w)
}
```

## The operation field is the control word

Build `Control`, which turns a two-bit operation field and an immediate flag
into three control wires: `sub` is the low operation bit, `wide` is high when
the high operation bit is set, and `useimm` passes the immediate flag through.

@kind property
@concept The instruction does not name an operation from a list. It sets
switches, and the field in the instruction is the control word.
@backend sim
@expect verdict table-mismatch
@hint Two of these are wires and one is a comparison against 1, which for a
single bit is also a wire.
@diagnose table-mismatch verdict table-mismatch
Every output here is one of the inputs. If a design needs gates it is deciding
something the encoding already decided, which is the cost that a
circuit-matched encoding exists to avoid.
@after Unit 007's adder had one control bit that gave both add and subtract.
This is that bit arriving from an instruction, and there is nothing between the
two.

```starter
chip Control(op1, op0, imm) -> sub, wide, useimm {
  sub = op1
  wide = op0
  useimm = imm
}
```

```spec
{"chip": "Control", "inputs": ["op1", "op0", "imm"], "outputs": ["sub", "wide", "useimm"], "table": [[0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 1], [0, 1, 0, 1, 0, 0], [0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [1, 1, 0, 1, 1, 0], [1, 1, 1, 1, 1, 1]], "maxGates": 2}
```

```solution
chip Control(op1, op0, imm) -> sub, wide, useimm {
  sub = op0
  wide = op1
  useimm = imm
}
```

## A field in two places costs gates

Build `MovedField`, where the destination register number lives in bits 3 and 2
for one instruction kind and in bits 1 and 0 for the other. Output the two
destination bits.

@kind property
@concept A layout that moves a field needs a multiplexer to find it, and that
cost repeats for every field and every instruction.
@backend sim
@expect verdict table-mismatch
@hint Two multiplexers, selected by the kind bit.
@diagnose table-mismatch verdict table-mismatch
Read the kind bit on the failing row. One kind reads the high pair and the
other reads the low pair, and a design that always reads one of them passes
exactly half the table.
@after Four gates that a consistent layout would not have needed, for one
field. Multiply by every field in every instruction and that is why fixed
layouts exist.

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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip MovedField(kind, i3, i2, i1, i0) -> d1, d0 {
  d1 = i3
  d0 = i2
}
```

```spec
{"chip": "MovedField", "inputs": ["kind","i3","i2","i1","i0"],
  "outputs": ["d1","d0"],
  "table": [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 1, 0, 0, 0], [0, 0, 0, 1, 1, 0, 0], [0, 0, 1, 0, 0, 0, 1], [0, 0, 1, 0, 1, 0, 1], [0, 0, 1, 1, 0, 0, 1], [0, 0, 1, 1, 1, 0, 1], [0, 1, 0, 0, 0, 1, 0], [0, 1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 1, 1, 0], [0, 1, 1, 0, 0, 1, 1], [0, 1, 1, 0, 1, 1, 1], [0, 1, 1, 1, 0, 1, 1], [0, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 1, 0, 1], [1, 0, 0, 1, 0, 1, 0], [1, 0, 0, 1, 1, 1, 1], [1, 0, 1, 0, 0, 0, 0], [1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 1, 0, 1, 0], [1, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 0, 0, 0], [1, 1, 0, 0, 1, 0, 1], [1, 1, 0, 1, 0, 1, 0], [1, 1, 0, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 0, 1, 0, 1], [1, 1, 1, 1, 0, 1, 0], [1, 1, 1, 1, 1, 1, 1]],
  "maxGates": 12}
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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  ga = nand(a, nsel)
  gb = nand(b, sel)
  out = nand(ga, gb)
}
chip MovedField(kind, i3, i2, i1, i0) -> d1, d0 {
  d1 = Mux(i3, i1, kind)
  d0 = Mux(i2, i0, kind)
}
```

## Is this instruction a jump

Build `IsJump`, which is high when the instruction is in the non-arithmetic
family and its opcode is 3.

@kind property
@concept Recognising one instruction is an AND of the bits that identify it,
and nothing looks anything up.
@backend sim
@expect verdict table-mismatch
@hint The family bit low, and both opcode bits high.
@diagnose table-mismatch verdict table-mismatch
Exactly one row of eight wants a 1. If two rows are high, one of the three
conditions is missing from the AND.
@after Every instruction in the machine is recognised by a gate of this shape.
The control unit is a collection of them, which is why the next unit calls it
the least clever component in the design.

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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip IsJump(kind, o1, o0) -> out {
  out = And(o1, o0)
}
```

```spec
{"chip": "IsJump", "inputs": ["kind","o1","o0"], "outputs": ["out"],
  "table": [[0, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 1, 1, 1], [1, 0, 0, 0], [1, 0, 1, 0], [1, 1, 0, 0], [1, 1, 1, 0]],
  "maxGates": 10}
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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip IsJump(kind, o1, o0) -> out {
  nk = Not(kind)
  both = And(o1, o0)
  out = And(both, nk)
}
```

## The same bits mean different things

Build `TwoReaders`, which takes one four-bit pattern and produces both what a
register decoder would make of its low two bits and what an arithmetic unit
would make of its high two bits, at the same time.

@kind property
@concept Nothing in a pattern says what it is. Two parts of the machine read
the same bits differently because they are wired differently.
@backend sim
@expect verdict table-mismatch
@hint Two independent readings of the same input, with no interaction between
them.
@diagnose table-mismatch verdict table-mismatch
The two halves do not affect each other. If changing the high bits moves a
register line, the two readings are sharing a wire they should not.
@after The same byte is a letter to a printer, a jump to an instruction
register and a number to an adder. Nothing in the byte says which, and each
part was built with a code in mind that is no longer anywhere in the machine.

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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip TwoReaders(i3, i2, i1, i0) -> r0, r1, r2, r3, sub, wide {
  r0, r1, r2, r3 = Dec2(i3, i2)
  sub = i1
  wide = i0
}
```

```spec
{"chip": "TwoReaders", "inputs": ["i3","i2","i1","i0"],
  "outputs": ["r0","r1","r2","r3","sub","wide"],
  "table": [[0, 0, 0, 0, 1, 0, 0, 0, 0, 0], [0, 0, 0, 1, 0, 1, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 1, 0, 0, 0], [0, 0, 1, 1, 0, 0, 0, 1, 0, 0], [0, 1, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 0, 1, 0, 1, 0, 0, 1, 0], [0, 1, 1, 0, 0, 0, 1, 0, 1, 0], [0, 1, 1, 1, 0, 0, 0, 1, 1, 0], [1, 0, 0, 0, 1, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1, 0, 0, 0, 1], [1, 0, 1, 0, 0, 0, 1, 0, 0, 1], [1, 0, 1, 1, 0, 0, 0, 1, 0, 1], [1, 1, 0, 0, 1, 0, 0, 0, 1, 1], [1, 1, 0, 1, 0, 1, 0, 0, 1, 1], [1, 1, 1, 0, 0, 0, 1, 0, 1, 1], [1, 1, 1, 1, 0, 0, 0, 1, 1, 1]],
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
chip Dec2(s1, s0) -> o0, o1, o2, o3 {
  n1 = Not(s1)
  n0 = Not(s0)
  o0 = And(n1, n0)
  o1 = And(n1, s0)
  o2 = And(s1, n0)
  o3 = And(s1, s0)
}
chip TwoReaders(i3, i2, i1, i0) -> r0, r1, r2, r3, sub, wide {
  r0, r1, r2, r3 = Dec2(i1, i0)
  sub = i2
  wide = i3
}
```
