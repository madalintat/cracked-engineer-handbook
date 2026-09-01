## Two bits in, two bits out

Build `HalfAdder`. The `sum` output is the low bit of `a + b` and `carry` is
the high bit.

@kind property
@concept Addition needs two outputs because two bits can sum to two, and two
does not fit in one bit.
@backend sim
@expect verdict table-mismatch
@hint Read the two output columns of the table as functions you have already
built.
@diagnose table-mismatch verdict table-mismatch
The sum column is 1 exactly when the inputs differ and the carry column is 1
exactly when both are 1. Those are two parts you built in the last two units,
and no new idea is needed.
@diagnose floating verdict floating-input
Both outputs need driving. A chip with an output nothing assigns to is not
half finished, it is unbuildable.
@after Two parts and no new ideas. It is called a half adder because it cannot
accept a carry coming in, and every position except the lowest has one.

```starter
chip Not(a) -> out {
  out = nand(a, a)
}
chip HalfAdder(a, b) -> sum, carry {
  sum = nand(a, b)
  carry = nand(a, b)
}
```

```spec
{"chip": "HalfAdder", "inputs": ["a", "b"], "outputs": ["sum", "carry"], "table": [[0, 0, 0, 0], [0, 1, 1, 0], [1, 0, 1, 0], [1, 1, 0, 1]], "maxGates": 10}
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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
```

## Three bits in

Build `FullAdder`, which takes a carry in as well. The two outputs count how
many of the three inputs are 1.

@kind property
@concept One position of any adder is this part, and a wide adder is this part
repeated with the carries chained.
@backend sim
@expect verdict table-mismatch
@hint Two half adders. Add the operands, then add the carry to that sum.
@diagnose table-mismatch verdict table-mismatch
Read the failing row as a count. With inputs summing to 2 the answer is sum 0
and carry 1; with 3 it is sum 1 and carry 1. A design that fails only on the
all-ones row is usually missing the second carry.
@diagnose non-nand-part verdict non-nand-part
You called a part that is not defined in this file. `HalfAdder` and everything
it needs has to be defined above the chip that uses it.
@after Both half adders can produce a carry and they cannot both produce one at
once, so an or gathers them. That is worth checking by hand rather than
believing.

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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  sum, carry = HalfAdder(a, b)
}
```

```spec
{"chip": "FullAdder", "inputs": ["a", "b", "cin"], "outputs": ["sum", "carry"], "table": [[0, 0, 0, 0, 0], [0, 0, 1, 1, 0], [0, 1, 0, 1, 0], [0, 1, 1, 0, 1], [1, 0, 0, 1, 0], [1, 0, 1, 0, 1], [1, 1, 0, 0, 1], [1, 1, 1, 1, 1]], "maxGates": 20}
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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
```

## Two bits plus two bits

Build `Add2`, which adds two two-bit numbers and a carry in. `a1` and `b1` are
the high bits. Outputs are `s1`, `s0` and the carry out.

@kind property
@concept A wide adder is one part repeated, with each position's carry out
feeding the next position's carry in.
@backend sim
@expect verdict table-mismatch
@hint Two full adders. The low one takes the carry in, and its carry out feeds
the high one.
@diagnose table-mismatch verdict table-mismatch
Read the failing row as two numbers. If it fails only where the low position
produces a carry, the chain between the two adders is missing or reversed.
@diagnose cycle verdict cycle
Two wires depend on each other. The carry runs one way only, from the low
position to the high one, so check which adder you connected to which.
@after Notice that the high position cannot finish until the low one has. That
is what ripple means, and at any real width it is the longest path in the
machine.

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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
chip Add2(a1, a0, b1, b0, cin) -> s1, s0, cout {
  s0, cout = FullAdder(a0, b0, cin)
  s1 = nand(a1, b1)
}
```

```spec
{"chip": "Add2", "inputs": ["a1", "a0", "b1", "b0", "cin"], "outputs": ["s1", "s0", "cout"], "table": [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 0], [0, 0, 0, 1, 0, 0, 1, 0], [0, 0, 0, 1, 1, 1, 0, 0], [0, 0, 1, 0, 0, 1, 0, 0], [0, 0, 1, 0, 1, 1, 1, 0], [0, 0, 1, 1, 0, 1, 1, 0], [0, 0, 1, 1, 1, 0, 0, 1], [0, 1, 0, 0, 0, 0, 1, 0], [0, 1, 0, 0, 1, 1, 0, 0], [0, 1, 0, 1, 0, 1, 0, 0], [0, 1, 0, 1, 1, 1, 1, 0], [0, 1, 1, 0, 0, 1, 1, 0], [0, 1, 1, 0, 1, 0, 0, 1], [0, 1, 1, 1, 0, 0, 0, 1], [0, 1, 1, 1, 1, 0, 1, 1], [1, 0, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 1, 1, 1, 0], [1, 0, 0, 1, 0, 1, 1, 0], [1, 0, 0, 1, 1, 0, 0, 1], [1, 0, 1, 0, 0, 0, 0, 1], [1, 0, 1, 0, 1, 0, 1, 1], [1, 0, 1, 1, 0, 0, 1, 1], [1, 0, 1, 1, 1, 1, 0, 1], [1, 1, 0, 0, 0, 1, 1, 0], [1, 1, 0, 0, 1, 0, 0, 1], [1, 1, 0, 1, 0, 0, 0, 1], [1, 1, 0, 1, 1, 0, 1, 1], [1, 1, 1, 0, 0, 0, 1, 1], [1, 1, 1, 0, 1, 1, 0, 1], [1, 1, 1, 1, 0, 1, 0, 1], [1, 1, 1, 1, 1, 1, 1, 1]], "maxGates": 40}
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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
chip Add2(a1, a0, b1, b0, cin) -> s1, s0, cout {
  s0, c0 = FullAdder(a0, b0, cin)
  s1, cout = FullAdder(a1, b1, c0)
}
```

## Adding one

Build `Inc2`, which adds one to a two-bit number and wraps. There is no new
circuit here.

@kind property
@concept An increment is an addition with a constant, and the constant costs
nothing because the adder already has a carry input.
@backend sim
@expect verdict table-mismatch
@hint The adder has a spare input on its lowest position and nothing is using
it.
@diagnose table-mismatch verdict table-mismatch
Adding one is adding zero with the carry in set. Feeding a 1 into the low
operand instead also works, and the wrap at the top is the same either way, so
check the row where the input is already 3.
@after The counter you build in unit 010 is exactly this part with a register
around it, and a jump turns out to be a parallel load into the same register.

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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
chip Inc2(x1, x0) -> s1, s0 {
  s0 = Not(x0)
  s1 = Not(x1)
}
```

```spec
{"chip": "Inc2", "inputs": ["x1", "x0"], "outputs": ["s1", "s0"], "table": [[0, 0, 0, 1], [0, 1, 1, 0], [1, 0, 1, 1], [1, 1, 0, 0]], "maxGates": 40}
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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
chip One(a) -> out {
  n = nand(a, a)
  out = nand(a, n)
}
chip Zero(a) -> out {
  o = One(a)
  out = nand(o, o)
}
chip Inc2(x1, x0) -> s1, s0 {
  z = Zero(x0)
  one = One(x0)
  s0, c0 = FullAdder(x0, z, one)
  s1, c1 = FullAdder(x1, z, c0)
}
```

## Negating

Build `Neg2`, which returns the two's complement negation of a two-bit value:
invert every bit and add one.

@kind property
@concept Negation is an inversion and an increment, which are both things you
already have.
@backend sim
@expect verdict table-mismatch
@hint Invert both bits, then add one to the result.
@diagnose table-mismatch verdict table-mismatch
Check the input 0 first. Its negation is 0, and inverting it gives 3, so the
increment has to wrap all the way round. A design that inverts and stops passes
no rows at all.
@after The value 2 negates to itself, because in two bits it is the most
negative value and there is no positive 2 to be its opposite. Part VI is about
what that asymmetry does to real programs.

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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
chip Neg2(x1, x0) -> s1, s0 {
  s1 = Not(x1)
  s0 = Not(x0)
}
```

```spec
{"chip": "Neg2", "inputs": ["x1", "x0"], "outputs": ["s1", "s0"], "table": [[0, 0, 0, 0], [0, 1, 1, 1], [1, 0, 1, 0], [1, 1, 0, 1]], "maxGates": 40}
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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
chip One(a) -> out {
  n = nand(a, a)
  out = nand(a, n)
}
chip Zero(a) -> out {
  o = One(a)
  out = nand(o, o)
}
chip Neg2(x1, x0) -> s1, s0 {
  i1 = Not(x1)
  i0 = Not(x0)
  z = Zero(x0)
  one = One(x0)
  s0, c0 = FullAdder(i0, z, one)
  s1, c1 = FullAdder(i1, z, c0)
}
```

## One control bit does both

Build `AddSub2`. When `sub` is 0 it adds the two-bit operands; when `sub` is 1
it subtracts `b` from `a`. Both wrap. No second circuit.

@kind property
@concept Subtraction is addition with one operand inverted and the carry in
set, and the same control bit does both halves.
@backend sim
@expect verdict table-mismatch
@hint The control bit goes to an exclusive or on each bit of `b`, and to the
carry in.
@diagnose table-mismatch verdict table-mismatch
An exclusive or with the control passes `b` through when the control is 0 and
inverts it when it is 1, which is what makes one circuit do both jobs. If your
addition rows pass and your subtraction rows do not, the carry in is not wired
to the control.
@diagnose cycle verdict cycle
A wire depends on itself. The control signal fans out to several places and
each of those needs its own name.
@after One control bit, two operations, and no arithmetic hardware added. The
saving came from how negative numbers are written down rather than from
anything in the wiring.

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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
chip AddSub2(a1, a0, b1, b0, sub) -> s1, s0 {
  s0, c0 = FullAdder(a0, b0, sub)
  s1, c1 = FullAdder(a1, b1, c0)
}
```

```spec
{"chip": "AddSub2", "inputs": ["a1", "a0", "b1", "b0", "sub"], "outputs": ["s1", "s0"], "table": [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 1, 0, 0, 1], [0, 0, 0, 1, 1, 1, 1], [0, 0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1, 1], [0, 0, 1, 1, 1, 0, 1], [0, 1, 0, 0, 0, 0, 1], [0, 1, 0, 0, 1, 0, 1], [0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 1, 0, 0], [0, 1, 1, 0, 0, 1, 1], [0, 1, 1, 0, 1, 1, 1], [0, 1, 1, 1, 0, 0, 0], [0, 1, 1, 1, 1, 1, 0], [1, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0, 1, 1, 0], [1, 0, 0, 1, 0, 1, 1], [1, 0, 0, 1, 1, 0, 1], [1, 0, 1, 0, 0, 0, 0], [1, 0, 1, 0, 1, 0, 0], [1, 0, 1, 1, 0, 0, 1], [1, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 0, 1, 1], [1, 1, 0, 0, 1, 1, 1], [1, 1, 0, 1, 0, 0, 0], [1, 1, 0, 1, 1, 1, 0], [1, 1, 1, 0, 0, 0, 1], [1, 1, 1, 0, 1, 0, 1], [1, 1, 1, 1, 0, 1, 0], [1, 1, 1, 1, 1, 0, 0]], "maxGates": 60}
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
chip HalfAdder(a, b) -> sum, carry {
  sum = Xor(a, b)
  carry = And(a, b)
}
chip FullAdder(a, b, cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}
chip AddSub2(a1, a0, b1, b0, sub) -> s1, s0 {
  x1 = Xor(b1, sub)
  x0 = Xor(b0, sub)
  s0, c0 = FullAdder(a0, x0, sub)
  s1, c1 = FullAdder(a1, x1, c0)
}
```

## Is the answer zero

Build `IsZero2`, which outputs 1 when both input bits are 0.

@kind property
@concept Testing a result against zero is an or across its bits, inverted, and
it is how a machine decides whether two values were equal.
@backend sim
@expect verdict table-mismatch
@hint Or the bits together and invert the result.
@diagnose table-mismatch verdict table-mismatch
Exactly one row wants a 1. If three rows come out high you have built the
inverse, which is "any bit set".
@after Equality is this part applied to the result of a subtraction. A machine
does not need a comparator: it needs an adder and somewhere to look at what
came out.

```starter
chip IsZero2(x1, x0) -> out {
  out = nand(x1, x0)
}
```

```spec
{"chip": "IsZero2", "inputs": ["x1", "x0"], "outputs": ["out"], "table": [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 0]], "maxGates": 8}
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
chip IsZero2(x1, x0) -> out {
  any = Or(x1, x0)
  out = Not(any)
}
```

## Which one is smaller

Build `Lt2`, which outputs 1 when the unsigned two-bit value `a` is less than
`b`.

@kind property
@concept Less-than is the borrow out of a subtraction, so it comes from the
adder rather than from comparison hardware.
@backend sim
@expect verdict table-mismatch
@hint Subtract and look at whether the subtraction needed to borrow, which is
the carry out being 0.
@diagnose table-mismatch verdict table-mismatch
Sixteen rows, and six of them want a 1. If your answer is high whenever the two
values differ you have built "not equal" rather than "less than", so check a row
where `a` is the larger.
@diagnose non-nand-part verdict non-nand-part
Whatever you use has to be defined in this file, including the adder if you
build this from a subtraction.
@after You can also read this straight off the bits, and that is a fine answer.
It is worth knowing both, because a real machine takes it from the adder it
already has rather than building a second circuit.

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
chip Lt2(a1, a0, b1, b0) -> out {
  out = nand(a1, b1)
}
```

```spec
{"chip": "Lt2", "inputs": ["a1", "a0", "b1", "b0"], "outputs": ["out"], "table": [[0, 0, 0, 0, 0], [0, 0, 0, 1, 1], [0, 0, 1, 0, 1], [0, 0, 1, 1, 1], [0, 1, 0, 0, 0], [0, 1, 0, 1, 0], [0, 1, 1, 0, 1], [0, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 0, 0, 1, 0], [1, 0, 1, 0, 0], [1, 0, 1, 1, 1], [1, 1, 0, 0, 0], [1, 1, 0, 1, 0], [1, 1, 1, 0, 0], [1, 1, 1, 1, 0]], "maxGates": 60}
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
chip Lt2(a1, a0, b1, b0) -> out {
  hi_lt = nand(a1, a1)
  h = And(hi_lt, b1)
  eq_hi = Xor(a1, b1)
  same_hi = Not(eq_hi)
  lo_lt_n = nand(a0, a0)
  l = And(lo_lt_n, b0)
  both = And(same_hi, l)
  out = Or(h, both)
}
```
