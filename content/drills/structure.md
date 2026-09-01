## What does `assign y = a & b;` describe?

- [x] A permanent connection between `y` and an AND gate fed by `a` and `b`
- [ ] A computation that runs once when the module is elaborated
- [ ] A computation that runs every time `a` or `b` changes
- [ ] A value copied into `y` at the next clock edge

@why The verb is not compute, it is is. The connection is as true a nanosecond
from now as it was a year ago, and if `a` changes then `y` changes because the
wire is still there.

## Does the order of continuous assignments in a module matter?

- [x] No, because a circuit has no first line
- [ ] Yes, a signal must be driven before it is read
- [ ] Yes, but only for signals that cross module boundaries
- [ ] Only in simulation, not in synthesis

@why A signal is a node, not a variable that acquires a value at some moment.
Reorder every continuous assignment in a module and the synthesised hardware is
identical.

## What happens when two continuous assignments drive the same wire?

- [x] It is an error, because it describes two gate outputs soldered together
- [ ] The later one wins, as it would in a program
- [ ] The tool builds a multiplexer and picks at random
- [ ] The wire takes the or of the two values

@why Nothing about the second line replaces the first, because there is no
first. Both connections exist at once, which is the same short circuit the
tri-state buffer exists to prevent on a shared bus.

## What does a synthesiser do after mapping a design onto cells?

- [x] Deletes anything whose value cannot change and anything nothing reads
- [ ] Places and routes the cells onto a floorplan
- [ ] Verifies the design against a testbench
- [ ] Inserts flip-flops wherever a path is too slow

@why That is the step people are not ready for. It is also why a cell count is
the answer to a better question than "what did I type": it says how much
hardware you actually asked for.

## How many gates does `assign y = a & 1'b1;` produce?

- [x] None, the output is `a` and a wire is cheaper than a gate
- [ ] One AND gate, as written
- [ ] One buffer cell, to drive the output
- [ ] It depends on whether `a` is an input or an internal wire

@why The optimiser folds the constant away. This is also why a design can
silently be smaller than intended: an unused output is deleted with exactly the
same enthusiasm.

## What is in the hardware after a `for` loop with four iterations is synthesised?

- [x] Four copies of the body, side by side, all settling together
- [ ] A counter and one copy of the body
- [ ] One copy of the body, evaluated four times per clock
- [ ] A state machine with four states

@why The tool unrolls the loop while elaborating. There is no thing that goes
around four times, and there is no counter anywhere in the result.

## Why must a loop bound be known at build time?

- [x] It decides how many copies of the body exist, and silicon cannot change how much of itself there is
- [ ] The simulator needs it to schedule events
- [ ] Otherwise the loop cannot be proved to terminate
- [ ] It does not have to be, the tool infers a maximum

@why A loop whose count depends on an input would need the amount of hardware
to change while the chip is running.

## In software a loop is cheap and the body is what you pay for. What changes here?

- [x] The loop is the multiplier: four iterations is four copies in area and power
- [ ] Nothing, the cost model is the same
- [ ] The body is free and the loop costs a counter
- [ ] Cost depends only on the clock frequency

@why This is the first real difference between describing hardware and writing
software, and it reorganises how you think about what an expression costs.

## What does instantiating a module twice give you?

- [x] Two separate pieces of the chip that share only a description
- [ ] One piece of hardware used twice
- [ ] Two calls to the same logic, resolved at elaboration
- [ ] A single instance, since the tool deduplicates identical modules

@why There is no stack, nothing returns, and nothing is reused between the
instances. A module you instantiate a thousand times costs a thousand times as
much.

## How do you make two uses share one piece of hardware?

- [x] Build it on purpose, with a multiplexer to choose the inputs and a register to hold the result
- [ ] Instantiate the module once and read its output twice
- [ ] Mark the module as shared and let the tool schedule it
- [ ] Put both uses inside the same always block

@why It is never free and never automatic. It also takes more than one clock
cycle, which is the trade Part V spends most of its time on.

## What does a delay like `#5` mean to a synthesiser?

- [x] Nothing, it is ignored
- [ ] It inserts a five gate delay buffer chain
- [ ] It constrains the path to five nanoseconds
- [ ] It is a syntax error outside a testbench

@why It is meaningful to the simulator, which has a notion of time, and invisible
to the tool that builds structure. That gap has a name: simulation and synthesis
mismatch.

## What is a simulation and synthesis mismatch?

- [x] A design that passes every test and behaves differently as a chip
- [ ] A design that synthesises but cannot be simulated
- [ ] A timing violation found after place and route
- [ ] A disagreement between two synthesis tools

@why The same text is read by two tools with different jobs. Most of the
language means the same thing to both, and a subset does not.

## Why is a five-bit sum assigned through a four-bit intermediate wrong?

- [x] The addition happens at four bits, so the carry is gone before the widening
- [ ] The intermediate wire adds a gate delay that breaks the timing
- [ ] Assigning a narrow wire to a wide one sign extends instead of zero extending
- [ ] It is not wrong, the tool widens the operands automatically

@why Width is decided where an expression is evaluated, not where its result
eventually lands. Widening afterwards cannot recover a bit that was already
dropped.

## Why did the drawn schematic have to be replaced by text?

- [x] A real design has millions of gates and nobody draws millions of anything
- [ ] Text can be version controlled and a drawing cannot
- [ ] Schematics cannot express sequential logic
- [ ] Foundries stopped accepting schematic submissions

@why Drawing works up to a few hundred gates, which is where Part II stopped.
The description that replaces it looks like a program, and every hour lost in
this part is lost to that resemblance.

## Which report should you trust about what your design contains?

- [x] The tool's, because it has already deleted everything you asked for by accident
- [ ] Your reading of the source, because it says what you intended
- [ ] The simulator's, because it executes the real behaviour
- [ ] Neither, until the design is placed and routed

@why The gap between what you wrote and what survives is where most of the
surprise in this part lives.
