## What does pipelining buy?

- [x] Throughput: one instruction finishes per cycle instead of one every four
- [ ] Latency: each instruction completes faster
- [ ] Both, in proportion to the number of stages
- [ ] Lower power, by keeping stages idle

@why Any individual instruction takes as long as it did, or slightly longer. It
is the same trade as the pipelined adder in unit 016 at a different scale.

## What is a control hazard?

- [x] Not knowing which instruction comes next until a branch resolves
- [ ] Two instructions needing the same execution unit
- [ ] An instruction needing a result that is not ready
- [ ] An interrupt arriving mid-instruction

@why By the time the condition is computed, the pipeline would like to have
fetched a dozen more instructions. Guessing is the answer.

## What does register renaming remove?

- [x] False dependencies from reusing register names
- [ ] The need to save registers across calls
- [ ] Cache conflicts between registers and memory
- [ ] The limit on how many registers an instruction may name

@why It is why having only sixteen architectural registers is less crippling
than it sounds: there are far more physical ones underneath.

## Roughly what does a branch misprediction cost?

- [x] About fifteen to twenty cycles, roughly the pipeline depth
- [ ] One cycle
- [ ] About two hundred cycles, like a memory fetch
- [ ] It depends on how many instructions the branch skipped

@why Everything fetched after the branch is discarded and fetching restarts. So
the cost of a branch is the misprediction rate times twenty, not the branch.

## Why does sorting an array before a loop that tests each element make the loop faster?

- [x] The condition becomes predictable, so the branch stops being mispredicted
- [ ] Sorted data has better cache locality
- [ ] The compiler can vectorise sorted loops
- [ ] It does not; the instruction count is identical

@why The instruction count is identical, which is exactly what makes this the
classic demonstration.

## Why does a two-bit counter beat a one-bit one?

- [x] A single exception moves it without flipping the prediction, so a loop exit costs one miss rather than two
- [ ] It can represent four outcomes instead of two
- [ ] It updates faster
- [ ] It tolerates alternating patterns

@why Alternating patterns defeat it entirely. What two bits buy is tolerance of
one unusual iteration in a long run.

## Why does saturation matter in the counter?

- [x] Without it, a long run drives the value far from the threshold and many contrary branches are needed to change its mind
- [ ] Without it the counter overflows and wraps to the opposite prediction
- [ ] It makes the update cheaper in hardware
- [ ] It prevents the predictor from being trained by an attacker

@why Measured: on twelve taken branches followed by six not-taken, a saturating
counter mispredicts three times and an unbounded one mispredicts seven.

## What does speculation leave behind when it is discarded?

- [x] Cache lines it brought in, whose presence is visible through timing
- [ ] Register values that were not restored
- [ ] Memory writes that were committed early
- [ ] Nothing; the rollback is complete

@why That is Spectre. Undoing the architectural state was never the same as
undoing all the state, which is how a 1990s optimisation became a 2018 security
problem.

## Why is a reduction loop written with several accumulators?

- [x] Independent chains let the adder start a new operation every cycle instead of every fourth
- [ ] It reduces the number of additions
- [ ] It improves cache locality of the accumulator
- [ ] It allows the compiler to use wider registers

@why Same arithmetic, different dependency shape. In a loop accumulating a
million values it is typically a factor of four.

## Why can the compiler not split a floating point reduction for you?

- [x] Reassociating changes the rounding and therefore the specified result
- [ ] It cannot prove the accumulators do not alias
- [ ] The standard requires a single accumulator
- [ ] It can, and does, at -O2

@why Three groupings of the same eight values gave 16777224, 16777216 and
16777222 in this unit's exercise. All three are correct arithmetic.

## What does `-ffast-math` grant beyond reassociation?

- [x] Permission to assume no infinities and no not-a-numbers
- [ ] Use of hardware transcendental instructions
- [ ] Lower precision for intermediate results only
- [ ] Automatic vectorisation of every loop

@why It grants rather more than most people intend, which is how it turns some
correct code into wrong code silently.

## How many 32-bit floats fit in a 512-bit vector register?

- [x] Sixteen
- [ ] Eight
- [ ] Four
- [ ] Sixty-four

@why Eight at 256 bits and four at 128. An element count that is not a multiple
of the width leaves a scalar tail.

## Why does a possible pointer overlap prevent vectorisation?

- [x] A write in one iteration could change a read in the next, so the iterations are not independent
- [ ] Overlapping ranges cannot be loaded into vector registers
- [ ] The compiler cannot compute the trip count
- [ ] It does not; overlap only affects correctness, not vectorisation

@why An optimiser needs a proof rather than a probability. `restrict` supplies
the proof, and keeping the promise then becomes yours.

## An instruction has four-cycle latency and one-per-cycle throughput. When does the latency matter?

- [x] Only when the next operation needs the previous answer
- [ ] Always; four cycles is four cycles
- [ ] Never, since the unit is pipelined
- [ ] Only when the operands come from memory

@why A million multiplies into one accumulator is four million cycles. The same
million across four accumulators is one million.

## What keeps the sequential illusion intact under out-of-order execution?

- [x] Retiring instructions in program order, whatever order they executed in
- [ ] Executing only instructions whose operands are ready
- [ ] The reorder buffer's size limit
- [ ] Memory barriers inserted by the compiler

@why The processor keeps a window, executes whatever is ready, and puts the
results back in order so the outside world sees a sequential machine.
