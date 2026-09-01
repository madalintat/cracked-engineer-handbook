## Why does adding two bits need two output bits?

- [x] Two ones sum to two, which does not fit in one bit
- [ ] One output is the result and the other is an error flag
- [ ] To allow signed as well as unsigned addition
- [ ] Because the inputs are two bits

@why The low bit of the sum and a carry into the next position. That is the
whole reason a half adder has two outputs rather than one.

## In a half adder, the sum output is which function?

- [x] Exclusive or
- [ ] And
- [ ] Or
- [ ] Nand

@why The sum is 1 exactly when the inputs differ. The carry is 1 exactly when
both are 1, which is and. Both are parts already built, so a half adder needs no
new idea.

## Why is it called a half adder?

- [x] It cannot accept a carry coming in, and every position except the lowest
      has one
- [ ] It handles only half the bits of an operand
- [ ] It produces half the outputs of a full adder
- [ ] It is half the size of a full adder

@why A full adder takes three inputs, and a wide adder is full adders chained
with each carry out feeding the next carry in.

## A full adder is built from:

- [x] Two half adders and an or
- [ ] Two half adders and an and
- [ ] Three half adders
- [ ] A half adder and a multiplexer

@why Add the operands, then add the carry to that sum. Both additions can
produce a carry and both cannot at once, so an or gathers them.

## What does "ripple carry" describe?

- [x] Each position waiting for the carry from the position below it
- [ ] Carries arriving from several positions at once
- [ ] A carry that wraps from the top back to the bottom
- [ ] Noise on the carry line

@why So the time to add is one adder's delay times the number of bits, and at
any real width that is the longest path in the machine.

## A faster adder works by:

- [x] Computing per position whether a carry is generated or passed along, then
      combining those in a tree
- [ ] Using faster transistors on the carry path
- [ ] Adding the low and high halves in parallel and correcting afterwards
- [ ] Running the carry chain at a higher clock

@why That gives delay proportional to the logarithm of the width rather than to
the width. It costs gates, which is why it is a Part III subject.

## To subtract in two's complement you:

- [x] Invert one operand and set the carry in
- [ ] Use a row of full subtractors with borrow
- [ ] Negate the result of an addition
- [ ] Compare first, then subtract the smaller from the larger

@why `a - b` is `a + (not b) + 1`. Inverting is one gate per bit, and adding one
is free because the adder already has a carry input nothing was using.

## What makes one control bit enough for both add and subtract?

- [x] It feeds an exclusive or on each bit of one operand and also the carry in
- [ ] It selects between two separate circuits
- [ ] It switches the adder into a different mode
- [ ] It inverts the result afterwards

@why An exclusive or with the control passes the operand through when the
control is 0 and inverts it when it is 1. The same bit supplies the plus one.

## Where does the saving in subtraction actually come from?

- [x] The choice to represent negative numbers in two's complement
- [ ] A clever arrangement of gates
- [ ] The carry input being unused
- [ ] Reusing the adder rather than building a subtractor

@why It is the first time in this handbook that a representation choice buys
hardware. Sign and magnitude needs a comparison, a subtraction and a decision
about the sign: three circuits where you wanted one.

## Why is sign-and-magnitude a worse representation for hardware?

- [x] Adding a positive and a negative number needs comparison and a sign
      decision, so the same adder cannot serve both
- [ ] It cannot represent zero
- [ ] It wastes a bit
- [ ] It is harder for people to read

@why Two's complement gives the top bit a negative weight instead of a flag
meaning, and then one adder handles signed and unsigned operands unchanged.

## How does a machine test whether two values are equal?

- [x] Subtract them and check whether the result is zero
- [ ] Compare them bit by bit in a comparator
- [ ] Look them up in a table
- [ ] Exclusive-or them and count the ones

@why Which is an or across the result bits, inverted. A machine does not need
comparison hardware: it needs an adder and somewhere to look at what came out.

## How does it test whether one value is less than another?

- [x] Subtract and look at the sign, or equivalently at the borrow
- [ ] Compare the high bits and then the low bits
- [ ] Count the set bits in each
- [ ] Repeatedly subtract one until one reaches zero

@why The flags a branch looks at are the leftovers of an arithmetic operation
that already happened, which is what the unit on control is built on.

## An increment costs nothing extra because:

- [x] The adder already has a carry input on its lowest position
- [ ] Adding one is a special case the hardware detects
- [ ] Incrementing is a shift
- [ ] It uses the same gates as a decrement

@why And the counter in unit 010 is that increment with a register round it,
which is also why a jump turns out to be a parallel load rather than special
machinery.

## Why is a real arithmetic unit built as an adder with control bits in front?

- [x] Each control bit changes what the operands look like on the way in, so
      one adder covers many operations
- [ ] Because separate circuits would not fit
- [ ] Because control bits are faster than gates
- [ ] To allow the operations to run in parallel

@why nand2tetris reaches eighteen useful functions from one adder with six
control bits that zero, invert and select the inputs and the output.

## Why is a negate-output control bit nearly free?

- [x] It is one exclusive or per bit, where building both polarities and
      selecting between them costs far more
- [ ] Inversion is free in CMOS
- [ ] It reuses the subtract control
- [ ] The output is already available inverted

@why It is the same argument as unit 002, one layer up: inverting is cheap and
having both polarities available is not.
