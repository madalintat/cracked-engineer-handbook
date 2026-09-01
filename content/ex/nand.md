## Inversion, from one gate

Tie both inputs of a nand together and it inverts. Work out why from the truth
table before you write it: when both inputs carry the same value, only two rows
of the table are reachable.

The starter reaches for a built-in. There is no built-in.

@kind property
@concept The only primitive is nand, and inversion costs one of them.
@expect verdict non-nand-part
@hint A nand has two inputs. Nothing says they have to be different wires.
@diagnose non-nand-part verdict non-nand-part
There is no `not` to call. The checker walks your design down to its leaves and
the only leaf it accepts is `nand`. That restriction is the whole point of the
unit: if you could reach for a gate you had not built, the claim that everything
comes from one primitive would be untested.
@diagnose table verdict table-mismatch
Your circuit builds, but it computes the wrong function. Check the row the
table names against what a nand does when both its inputs are the same.
@after One gate, and you have inversion. Two of the three constructions in the
proof are now within reach.

```starter
chip Not(a) -> out {
  out = not(a)
}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
```

```spec
{"chip": "Not", "inputs": ["a"], "outputs": ["out"],
 "table": [[0, 1], [1, 0]], "minGates": 1, "maxGates": 2}
```

## And, the expensive way round

A nand is an and with the answer inverted. You already have an inverter. Put
them together.

Notice what this costs: two gates for AND against one for NAND. That ratio is
not an accident of this exercise, it is what CMOS charges, and it is why the
part you are building everything from is the inverted one.

@kind property
@concept AND is not a primitive. It is NAND with an inverter bolted on.
@expect verdict table-mismatch
@hint You are one inversion away. The starter gives you the nand already.
@diagnose table-mismatch verdict table-mismatch
Compare your output column against the specification's. If yours is the exact
opposite on every row, you have built the nand and stopped one gate early.
@diagnose floating verdict floating-input
A wire in your design is never driven by anything. Every name you read from
must be either an input of the chip or the target of an assignment.
@after Two gates. On silicon this is six transistors against four, and slower,
which is exactly why the primitive is nand.

```starter
chip And(a, b) -> out {
  out = nand(a, b)
}
```

```solution
chip And(a, b) -> out {
  n = nand(a, b)
  out = nand(n, n)
}
```

```spec
{"chip": "And", "inputs": ["a", "b"], "outputs": ["out"],
 "table": [[0,0,0], [0,1,0], [1,0,0], [1,1,1]], "minGates": 2, "maxGates": 4}
```

## Or, by De Morgan

This is the one that surprises people. `a OR b` is `NOT(NOT a AND NOT b)`, and
written in nands that is: invert both inputs, then nand them.

Read that again and count. Inverting twice and nanding once gives OR, in three
gates, with no OR anywhere in the construction.

The starter leaves a wire dangling.

@kind property
@concept De Morgan turns an OR into a NAND of two inversions.
@expect verdict floating-input
@hint The starter inverts `a` and never inverts `b`.
@diagnose floating-input verdict floating-input
The wire named in the message is read but never written. An unconnected wire is
not 0. It has no value at all, and a simulator that quietly called it 0 would
let you ship a design that behaves differently on real silicon.
@diagnose table-mismatch verdict table-mismatch
Both inputs need inverting before the final nand. Inverting one of them gives
you something else entirely.
@after Three gates for OR. Notice you never needed an OR gate to build one.

```starter
chip Or(a, b) -> out {
  na = nand(a, a)
  out = nand(na, nb)
}
```

```solution
chip Or(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  out = nand(na, nb)
}
```

```spec
{"chip": "Or", "inputs": ["a", "b"], "outputs": ["out"],
 "table": [[0,0,0], [0,1,1], [1,0,1], [1,1,1]], "minGates": 3, "maxGates": 5}
```

## A loop is not a shortcut

The starter looks clever. It feeds a wire back into the gate that produces it,
which in a language with statements would be an ordinary assignment.

Here it is not. Run it and read what the checker says.

@kind property
@concept Nothing in this part has a clock, so a value cannot depend on itself.
@expect verdict cycle
@hint Follow `x` backwards. What has to be known before it can be computed?
@diagnose cycle verdict cycle
The wires named in the message form a loop, so the value of each one depends on
itself. That is not a function of the inputs, it is a function of time, and
nothing here has a clock yet to say when. Feedback is exactly what makes a bit
stay put, and you get it four units from now. It needs a clock first.
@diagnose table-mismatch verdict table-mismatch
Your design has no loop now, but it computes the wrong function. Two nands in
series invert twice, which gets you back where you started.
@after The restriction lifts in the unit on feedback, and the moment it lifts
is the moment you get memory.

```starter
chip Not(a) -> out {
  x = nand(a, x)
  out = nand(x, x)
}
```

```solution
chip Not(a) -> out {
  out = nand(a, a)
}
```

```spec
{"chip": "Not", "inputs": ["a"], "outputs": ["out"],
 "table": [[0, 1], [1, 0]], "minGates": 1, "maxGates": 3}
```

## Exclusive or

True when the inputs differ. Build it however you can get it working first,
then look at the gate count the checker reports.

The obvious route is to write out the sum of products and translate it gate by
gate. That works and it costs five or six. A four-gate solution exists.

@kind property
@concept Correctness and efficiency are separate questions, and this unit
separates them.
@expect verdict table-mismatch
@hint There are two rows where the answer is 1. Handle each, then combine.
@diagnose table-mismatch verdict table-mismatch
The failing row is named in the message. XOR is 1 when the inputs differ and 0
when they agree, so check both agreeing rows and both differing rows against
what you built.
@diagnose cycle verdict cycle
A wire in your design feeds itself. Follow the name in the message backwards
through your assignments until you reach it a second time.
@after Whatever you found, it is correct. The next exercise asks for it in four.

```starter
chip Xor(a, b) -> out {
  out = nand(a, b)
}
```

```solution
chip Xor(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  t1 = nand(a, nb)
  t2 = nand(na, b)
  out = nand(t1, t2)
}
```

```spec
{"chip": "Xor", "inputs": ["a", "b"], "outputs": ["out"],
 "table": [[0,0,0], [0,1,1], [1,0,1], [1,1,0]], "minGates": 4}
```

## Exclusive or, in four

Same function, and now there is a budget. Five gates will be rejected.

The trick is that the sum-of-products route computes `nand(a, b)` twice without
noticing. Compute it once and feed it to both branches.

@kind property
@concept The same function has many circuits, and on a chip with billions of
gates the difference between them is the whole game.
@expect verdict gate-budget
@hint Start with `n1 = nand(a, b)`. Then ask what `nand(a, n1)` gives you.
@diagnose gate-budget verdict gate-budget
Correct, and over budget. Look for a value you compute twice. In the
sum-of-products version, inverting both inputs separately does work that a
single shared `nand(a, b)` already does.
@diagnose table-mismatch verdict table-mismatch
The row named in the message is wrong. Four gates is achievable, but not by
dropping one from a five-gate design at random.
@after Four gates. Both versions are correct; only one of them is what you
would put on silicon.

```starter
chip Xor(a, b) -> out {
  na = nand(a, a)
  nb = nand(b, b)
  t1 = nand(a, nb)
  t2 = nand(na, b)
  out = nand(t1, t2)
}
```

```solution
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}
```

```spec
{"chip": "Xor", "inputs": ["a", "b"], "outputs": ["out"],
 "table": [[0,0,0], [0,1,1], [1,0,1], [1,1,0]], "minGates": 4, "maxGates": 4}
```

## Choosing between two wires

A multiplexer passes one of its data inputs through, chosen by a third. When
`sel` is 0 the output follows `a`; when it is 1 it follows `b`.

This is the first circuit whose behaviour depends on a control signal rather
than only on data, and there is no difference in the hardware between the two.
A control wire is an ordinary wire routed into selector logic.

@kind property
@concept Control is data. A control signal is an ordinary input, routed
somewhere that changes what the rest of the circuit does.
@expect verdict table-mismatch
@hint Gate each input with `sel` in the polarity you want, then combine the two.
@diagnose table-mismatch verdict table-mismatch
The message names a row where `sel` picked the wrong input. Check the two rows
where `a` and `b` disagree, since those are the only rows where `sel` matters
at all.
@diagnose floating verdict floating-input
A wire is read but never written. Inverting `sel` needs its own assignment
before you can use the inverted value.
@after Every addressed memory you build from here on is this circuit, repeated
and given more select bits.

```starter
chip Mux(a, b, sel) -> out {
  out = nand(a, sel)
}
```

```solution
chip Mux(a, b, sel) -> out {
  ns = nand(sel, sel)
  ta = nand(a, ns)
  tb = nand(b, sel)
  out = nand(ta, tb)
}
```

```spec
{"chip": "Mux", "inputs": ["a", "b", "sel"], "outputs": ["out"],
 "table": [[0,0,0,0], [0,0,1,0], [0,1,0,0], [0,1,1,1],
           [1,0,0,1], [1,0,1,0], [1,1,0,1], [1,1,1,1]],
 "minGates": 4, "maxGates": 8}
```

## The last of the sixteen

There are exactly sixteen functions of two bits. You have built five of them.
This one is true when the inputs agree, which makes it the inverse of the one
you built two exercises ago.

You may use any chip you have already defined in this file. Define it above and
call it by name, and the checker counts the nands inside it.

@kind property
@concept Every one of the sixteen two-input functions is reachable, and you now
have the machinery to reach any of them.
@expect verdict table-mismatch
@hint You built XOR already. What does inverting it give you?
@diagnose table-mismatch verdict table-mismatch
The named row disagrees. XNOR is 1 on the two rows where the inputs are equal,
which is exactly the rows where XOR is 0.
@diagnose non-nand-part verdict non-nand-part
You called a part that is neither `nand` nor a chip defined in this file.
Define it above the chip that uses it.
@after Five gates. That is XOR plus an inverter, and it completes the argument:
one primitive, arranged carefully, reaches everything.

```starter
chip Xnor(a, b) -> out {
  out = nand(a, b)
}
```

```solution
chip Xor(a, b) -> out {
  n1 = nand(a, b)
  n2 = nand(a, n1)
  n3 = nand(b, n1)
  out = nand(n2, n3)
}

chip Xnor(a, b) -> out {
  x = Xor(a, b)
  out = nand(x, x)
}
```

```spec
{"chip": "Xnor", "inputs": ["a", "b"], "outputs": ["out"],
 "table": [[0,0,1], [0,1,0], [1,0,0], [1,1,1]], "minGates": 5}
```
