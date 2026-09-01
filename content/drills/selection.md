## What does a multiplexer do?

- [x] Passes one of its data inputs through, chosen by a select input
- [ ] Combines two inputs into one value
- [ ] Routes one input to one of several outputs
- [ ] Stores the selected value

@why Routing one input to one of several outputs is its dual, the
demultiplexer. Between them they are the two halves of every routing decision
in a machine.

## What distinguishes a control wire from a data wire in the circuit?

- [x] Nothing. A control signal is an ordinary input into ordinary gates
- [ ] Control wires carry a different voltage
- [ ] Control wires connect to a special input on the gate
- [ ] Control wires are evaluated before data wires

@why There is no control input on a NAND gate. The only difference is what a
human decided to call it, which is why "control is data" is the sentence to keep
from this unit.

## Writing a multiplexer as "if sel then b else a" is:

- [x] True about what it computes and false about what it is, since both
      branches are always computed
- [ ] Exactly right
- [ ] Wrong, because a multiplexer cannot express a conditional
- [ ] Right only when the inputs are constant

@why All the gates are always powered and both partial results are always being
computed. The select decides which answer reaches the output and the other is
discarded at full cost.

## Why does that matter for a GPU twelve parts from here?

- [x] Computing both sides and discarding one is what logic does naturally, so
      a divergent branch costing both sides is the default rather than a quirk
- [ ] GPUs use multiplexers where CPUs use branches
- [ ] It does not; the cases are unrelated
- [ ] GPUs cannot express conditionals

@why A processor that skips work has to be built specially to do it. Warp
divergence is usually presented as surprising, and it is closer to what a
circuit does if you leave it alone.

## An arithmetic unit with no control signal asserted is:

- [x] Still computing, on whatever its inputs happen to be
- [ ] Idle and drawing no power
- [ ] Holding its previous result
- [ ] Undefined

@why It is combinational. A control signal does not start it, it decides
whether anyone reads the answer. "The ALU runs when you tell it to" is a
misconception worth naming early.

## How many select bits does a multiplexer with 16 inputs need?

- [x] 4
- [ ] 8
- [ ] 15
- [ ] 16

@why `2^k` inputs need `k` bits, and that relationship is where the word
address comes from.

## What is an address?

- [x] A position among things, not a name for one
- [ ] A number stored in the cell it refers to
- [ ] A label the machine looks up in a table
- [ ] A pointer to a name

@why Sixteen unnumbered streets with sixteen unnumbered houses: the fourth
house on the seventh street still locates a house and no plaque is needed.
Nothing in the circuit stores an address.

## Where do the address bits actually go?

- [x] Onto the select inputs of a tree of multiplexers and decoders
- [ ] Into a lookup table of addresses
- [ ] Into a comparator against every stored address
- [ ] Into a register that indexes memory

@why There is no table of addresses anywhere. There is a tree, and the address
bits are the select signals on it.

## A decoder with `k` inputs raises how many of its outputs?

- [x] Exactly one of `2^k`
- [ ] All `2^k`
- [ ] `k` of them
- [ ] It depends on the input pattern

@why Exactly one, which is what makes it useful as a set of enables. It is a
demultiplexer with its data input held at 1.

## Building a four-way multiplexer as a tree of two-way ones costs:

- [x] More stages of delay and fewer gates than building it flat
- [ ] Fewer stages and fewer gates
- [ ] More stages and more gates
- [ ] The same either way

@why It is the same gates-against-delay trade as everything in Part I. The tree
scales better, which is why a memory of any real size is a tree rather than a
flat decode.

## "Which register do I write to" is implemented by:

- [x] A demultiplexer on the write-enable signal
- [ ] A comparator on the register number
- [ ] A lookup table in the control unit
- [ ] A dedicated register-select circuit

@why And "which register do I read from" is a multiplexer on the outputs. Not
parts like those. Those parts.

## A multiplexer whose inputs are "what is here" and "what is arriving" is:

- [x] A hold-or-load, which becomes a register once there is a clock
- [ ] A comparator
- [ ] Already a register
- [ ] An adder

@why It is not yet a register, because "what is here" means the output feeding
back to the input, and that loop is illegal without a clock. The circuit is
incomplete rather than wrong.

## Why is a register not simply a flip-flop with its output tied to its input?

- [x] There would be no way to ever load a new value into it
- [ ] The loop would oscillate
- [ ] Flip-flops cannot drive their own inputs
- [ ] It would work, but use too much power

@why nand2tetris labels that diagram "invalid design" for exactly this reason.
The fix is a multiplexer in the loop, and the multiplexer's select bit is what
`load` means.

## When the machine executes an instruction, what looks up its meaning?

- [x] Nothing. Bits of the instruction are wired to select inputs and route
      different things to different places
- [ ] A microcode interpreter
- [ ] The instruction decoder, which holds a table of meanings
- [ ] The assembler, at compile time

@why NAND gates do not know what they are doing, and a million of them
connected together still do not. That is the answer to the question in Scott's
title.

## A design that ignores one of its inputs is:

- [x] Fine, and costs nothing
- [ ] An error, because every input must be driven
- [ ] Wasteful, because the input still consumes power
- [ ] Only allowed at the top level

@why Leaving an input unused is allowed; reading a wire that nothing drives is
not, and those are different mistakes. Ignoring inputs is how one part serves
several purposes on a shared bus.
