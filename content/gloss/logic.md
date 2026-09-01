## nand
A gate whose output is low only when both inputs are high, and high otherwise.
Four transistors in CMOS, against six for AND, which is why this course builds
everything from it rather than from the gate with the friendlier name.
@see functional-completeness, cmos

## functional-completeness
The property of a set of gates that every Boolean function can be built from
copies of it. NAND has it on its own, and so does NOR. The choice between them
is a fact about silicon rather than about logic.
@see nand, de-morgan

## de-morgan
The identity that turns an OR into a NAND of two inverted inputs, and an AND
into a NOR of two inverted inputs. It is what lets a single primitive reach
both, and in CMOS it is visible as the duality between the pull-up and
pull-down networks.
@see nand, functional-completeness

## combinational
Logic whose outputs are a function of its inputs and nothing else. The same
inputs settle to the same outputs every time, with no memory of what came
before. A feedback loop destroys the property, which is why cycles are rejected
before a clock exists.
@see sequential, clock-edge

## sequential
Logic whose outputs depend on the inputs and on a stored value, updated at a
clock edge. Nearly every Verilog bug is a confusion between this and
combinational logic.
@see combinational, clock-edge, latch

## clock-edge
The instant at which sequential logic samples its inputs. Every flip-flop
samples at the edge and drives shortly after, which is the clock-to-Q delay, and
that ordering is what makes a chain of flops shift rather than collapse.
@see sequential, non-blocking

## non-blocking
The Verilog assignment written `<=`, which evaluates its right side when the
block runs and writes its left side only after every block has finished
evaluating. It does not choose an execution order; it makes the order
irrelevant.
@see clock-edge, blocking

## blocking
The Verilog assignment written `=`, which evaluates and writes immediately, in
order. Correct inside a combinational block and a quiet bug inside a clocked
one, where it makes two flops hold the same value so the optimiser deletes one.
@see non-blocking, combinational

## latch
A level-sensitive storage element, transparent while its enable is high. Usually
unwanted: it appears when a combinational block leaves a signal unassigned on
some path, and having no single sampling instant makes timing analysis much
harder.
@see sequential, combinational

## floating
A wire that nothing drives. It has no value, and it is not zero. A simulator
that quietly treated it as zero would let a design pass that behaves differently
on real silicon.
@see combinational

## truth-table
The complete specification of a Boolean function: one row per input
combination. A two-input function has four rows, so there are sixteen distinct
two-input functions, of which AND, OR, XOR and NAND are four.
@see functional-completeness

## cmos
The logic family in which every gate is a pull-up network of PMOS transistors
and a pull-down network of NMOS transistors, each the dual of the other. It
makes inversion free and charges an extra stage for non-inversion.
@see nand, de-morgan
