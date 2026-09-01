## Two flops in one clocked block, assigned with `<=`. What do you get?

- [x] A shift register: the second flop takes the value the first held before
      the edge
- [ ] One flop, because the optimiser merges them
- [ ] Two flops holding the same value
- [ ] Undefined, because the order of the assignments is not specified

@why Non-blocking assignment evaluates every right side before writing any left
side, so both read pre-edge values. That models real flops, which all sample at
the edge and drive shortly after.

## The same block written with `=` instead synthesises to how many flip-flops?

- [ ] Two, since the code describes two registers
- [x] One, because both would always hold the same value and the optimiser
      removes the redundant one
- [ ] Zero, because blocking assignment is combinational
- [ ] It fails to synthesise

@why Measured: two `$_DFF_P_` with `<=` and one with `=`. Blocking assignment
writes immediately, so the second statement reads the value just written rather
than the value held before the edge.

## Why does the language leave the execution order of two blocks on the same
edge undefined?

- [ ] To give simulators freedom to optimise
- [x] Because real hardware has no such order: the flops are separate devices
      reacting to the same wire
- [ ] Because defining it would break backward compatibility
- [ ] It is defined, and simulators that disagree are non-conforming

@why The undefinedness is descriptive rather than permissive. Non-blocking
assignment does not pick an order; it makes the order irrelevant by splitting
evaluation from assignment into two phases.

## What makes an inferred latch appear?

- [ ] Using `always @(*)` instead of `always_comb`
- [x] A signal that some path through a combinational block leaves unassigned
- [ ] Assigning the same signal in two places
- [ ] Reading a signal before it is assigned

@why A signal not assigned on some path keeps its previous value, and keeping a
value requires storage. The synthesiser supplies storage in the form of a
level-sensitive latch.

## An `always @(*)` block assigns a four-bit output, and a `case` leaves two of
its four selector values unhandled. What does yosys report?

- [ ] One latch for the whole vector
- [x] A latch for each output bit that needed one, named individually
- [ ] A syntax error
- [ ] Nothing, because `case` has an implicit default

@why Measured: two `$_DLATCH_N_` cells for that design. Latches are inferred
per signal, not per block, and the warning names each one.

## Why is an inferred latch usually worse than a flip-flop?

- [ ] It uses more transistors
- [x] It is transparent while its enable is high, so it has no single sampling
      instant and timing analysis becomes much harder
- [ ] It cannot be reset
- [ ] It only works at low clock frequencies

@why The lack of a single sampling edge is the problem. It also makes the
circuit sensitive to glitches on the enable, which a clocked flop would simply
not see.

## What does `always_comb` buy you over `always @(*)`?

- [ ] It generates faster logic
- [ ] It derives the sensitivity list, which `always @(*)` does not
- [x] It states your intent, so a latch inferred inside it is an error rather
      than a warning you might not read
- [ ] It allows non-blocking assignment in combinational logic

@why Both derive the sensitivity list. The difference is that `always_comb`
declares the block is meant to be combinational, which gives the tool something
to check against.

## `if (rst) q <= 0;` inside `always @(posedge clk)` synthesises to which cell?

- [ ] `$_DFF_P_` with extra logic on the data input
- [x] `$_SDFF_PP0_`, a flop with a synchronous reset input
- [ ] `$_DFF_PP0_`, a flop with an asynchronous reset pin
- [ ] `$_DLATCH_P_`

@why A reset checked inside a block that wakes only on the clock is ordinary
data, so it becomes a reset input on the same flop. Measured.

## Moving the reset into the sensitivity list, as `always @(posedge clk or
posedge rst)`, changes what?

- [ ] Nothing, the two are equivalent
- [x] The flop itself: it becomes `$_DFF_PP0_`, a physically different device
      with a separate reset pin
- [ ] Only the simulation behaviour
- [ ] It introduces a latch

@why Measured, and it is the point of the exercise: two correct designs that
synthesise to different devices. You cannot tell them apart by behaviour in a
simulator; you can tell instantly by reading the cell.

## Why does an asynchronous reset still need its release synchronised?

- [x] Because it deasserts at an arbitrary moment, and different flops would
      otherwise leave reset on different cycles
- [ ] Because asynchronous resets are not supported by most FPGAs
- [ ] Because the reset signal is slower than the clock
- [ ] It does not; that is the point of making it asynchronous

@why Asserting without a clock is exactly what you want at power-on.
Deasserting without one is not, because the recovery and removal timing is not
met uniformly across the design.

## `always @(a) y = a & b;` What is the disagreement?

- [ ] The simulator and the synthesiser both build an AND gate
- [x] Simulation leaves `y` stale when only `b` changes; synthesis ignores the
      list and builds the AND gate you meant
- [ ] Synthesis reports an error
- [ ] A latch is inferred for `y`

@why Measured: it synthesises to a single `$_AND_`. The hardware is right and
the simulation is wrong, which produces the worst class of bug: it worked in
simulation and failed on the board.

## Two continuous assignments drive the same wire. Why is that worse than a
double assignment in software?

- [ ] It is not; the second assignment simply wins
- [x] A wire is metal, so two outputs on it fight over the voltage and can
      short the supply to ground
- [ ] It causes a race that resolves randomly at each clock edge
- [ ] It infers a latch to arbitrate between them

@why The failure is physical rather than logical. This is the same rule your
Part II checker enforced when it refused a control word that enabled two
modules onto the bus at once.

## `equiv_simple` proves a design matches a reference. Over what?

- [ ] The test vectors you supply
- [ ] A random sample of the input space
- [x] Every possible input, without enumerating them
- [ ] The inputs reachable from the reset state

@why It is a satisfiability question, not a simulation. The solver looks for
any assignment that makes the two disagree, and failing to find one is a proof
that none exists.

## When the equivalence check fails, what has the tool found?

- [ ] That the design does not synthesise
- [x] At least one input assignment where the two designs produce different
      outputs
- [ ] That the design is slower than the reference
- [ ] That the two use different numbers of cells

@why It reports unproven equivalence cells. Cell count is irrelevant to
equivalence: two designs with wildly different cell counts can be proved
identical in function.

## What single question is behind blocking-versus-non-blocking, the inferred
latch, and the choice of reset?

- [ ] Which optimisation level the synthesiser is using
- [ ] Whether the design meets timing
- [x] Which of the two kinds of logic, combinational or sequential, this code
      describes
- [ ] Whether the code is portable across vendors

@why Each bug is that question answered accidentally rather than deliberately.
Synthesising the design and reading the cells answers it precisely, every time,
and costs nothing.
