---
needs: [cache]
minutes: 55
one_idea: The processor is pretending to run your instructions one at a time, and every performance surprise in this unit is a place where the pretence costs something.
sources: [cpu-architectures, x86-64-assembly]
---

Your instructions do not execute one after another. They execute several at a
time, out of order, some of them speculatively before anyone knows whether they
should run at all, and the results are put back in order afterwards so that you
never notice.

That machinery is why a modern core is fast. It is also why the same loop can be
four times slower after a change that added no instructions.

## Overlap, and what it buys

A pipeline splits instruction handling into stages: work out what the
instruction is, fetch its operands, do the arithmetic, write the result. Each
stage is separate hardware, so once the first instruction moves to stage two, the
second can start stage one.

The point is throughput rather than latency. Any individual instruction takes as
long as it ever did, or slightly longer. What changes is that one finishes every
cycle instead of one finishing every four.

This is the same trade as the pipelined adder in unit 016, at a different scale
and for the same reason: cutting a long path with registers lets you clock it
faster, and each result now takes more cycles to appear.

## What breaks the overlap

Three things, and they have names.

A data hazard is an instruction needing a result that is not ready. Multiply two
numbers and add to the product on the next line, and the add waits.

A control hazard is not knowing which instruction comes next. A conditional
branch is not resolved until its condition is computed, and by then the pipeline
would like to have fetched a dozen more instructions.

A structural hazard is two instructions wanting the same piece of hardware, such
as two divisions when there is one divider.

Out-of-order execution answers the first. The processor keeps a window of
instructions, executes any whose inputs are ready, and retires them in program
order so the outside world sees a sequential machine. Register renaming removes
the false dependencies that arise from reusing register names, which is why
having only sixteen architectural registers is less crippling than it sounds:
there are far more physical ones underneath.

## Guessing, and what a wrong guess costs

The control hazard is answered by guessing.

A branch predictor watches which way each branch went and predicts accordingly.
Modern ones are very good: on ordinary code they are right well over ninety
percent of the time, and on a loop that runs a thousand times they are wrong
twice.

When the guess is wrong, everything fetched after the branch is discarded and
fetching restarts from the right place. That costs roughly the depth of the
pipeline, which on current parts is somewhere around fifteen to twenty cycles.

So the cost of a branch is not the branch. It is the misprediction rate times
twenty. A perfectly predicted branch is nearly free, and an unpredictable one
costs more than the work it was guarding, which is the entire reason the
branchless techniques in unit 021 exist.

The classic demonstration is a loop over an array with a condition inside it. Sort
the array first and the same loop runs several times faster, because the condition
becomes predictable. The instruction count is identical.

```figure
{
  "kind": "timing",
  "alt": "Four pipeline stages shown across cycles, with instructions overlapping, then a mispredicted branch flushing the following instructions.",
  "caption": "One instruction finishes every cycle while the guessing holds. A wrong guess throws away everything fetched since, which is about twenty cycles of work.",
  "signals": [
    { "name": "fetch",  "wave": "1111x111", "accent": "azure" },
    { "name": "decode", "wave": "01111x11", "accent": "azure" },
    { "name": "exec",   "wave": "0011p1x1", "accent": "gold" },
    { "name": "retire", "wave": "000111.1", "accent": "jade" }
  ]
}
```

## Speculation has a shadow

The processor executes past an unresolved branch, and if the guess was wrong it
undoes the architectural effects. Registers are restored, memory writes never
happen, and your program cannot tell.

Except that the cache can. A speculatively executed load brings a line in, and
the line stays there after the speculation is discarded. Nothing in the program's
visible state changed, and the timing of a later access reveals which line
arrived.

That is Spectre, and it is the reason a hardware optimisation from the 1990s
became a security problem in 2018. Part XV takes it apart properly. The point
here is that speculation is not free even when it is correct, and that undoing
the architectural state was never the same as undoing all the state.

## Chains against trees

Out-of-order execution can only run what does not depend on something still
running.

Summing four values as `((a + b) + c) + d` is three additions in a row, each
waiting for the previous. Summing them as `(a + b) + (c + d)` is the same three
additions with two of them independent, so the chain is two deep rather than
three. At four elements this is noise. In a loop accumulating a million values
into one variable it is the difference between running at the adder's latency
and running at its throughput, which is typically a factor of four.

Which is why a hot reduction loop is written with several accumulators. Four
partial sums that are combined at the end have four independent chains, and the
processor can keep the adder busy every cycle instead of every fourth.

Instruction latency and instruction throughput are different numbers for exactly
this reason. A multiply might take four cycles to produce a result and still
accept a new one every cycle. Whether that matters depends entirely on whether
your next multiply needs the previous answer.

## The order you wrote is the order you get

There is a catch, and it is the reason the compiler cannot make that
transformation for you.

Floating point addition is not associative. Regrouping a sum changes the rounding
and therefore the answer. Here are three ways to add the same eight values, all
of which are correct arithmetic and none of which agree:

The values are seven ones and 16777216, which is 2 to the 24 and the point where
a 32-bit float's steps become larger than one. Summing them small first gives
16777224. Summing them large first gives 16777216. Summing them pairwise gives
16777222, which is also the closest representable value to the true answer of
16777223.

So a compiler asked to optimise a reduction has to leave it alone, because
reassociating would change results the standard says are determined. `-ffast-math`
is the flag that grants permission, and it grants rather more than most people
intend: it also allows assuming no infinities and no not-a-numbers, which turns
some correct code into wrong code silently.

## Many lanes, one instruction

The other way to get more work per cycle is to make each instruction do more.

A vector register holds several values and one instruction operates on all of
them. On x86-64 the widths have gone 128 bits, then 256, then 512, which is four,
eight or sixteen 32-bit floats per instruction.

Compilers will do this automatically when they can prove it is safe, and the
proof is where it usually fails. Two pointers that might overlap mean the writes
of one iteration could affect the reads of the next, so the iterations are not
independent and the loop cannot be vectorised. Telling the compiler they do not
overlap, with `restrict` in C, is often the entire fix.

The other blockers are the same shape: a loop-carried dependency, a call the
compiler cannot see into, an exit condition that depends on the data, or an
element count that is not a multiple of the vector width, which needs a scalar
tail and is handled rather than prevented.

## What to carry forward

The processor pretends to be sequential and is not. The pretence is maintained by
retiring in order, and it costs a misprediction penalty when a guess is wrong and
a security problem when a discarded speculation leaves a trace.

Dependencies are the currency. Independent work fills the machine, a chain
starves it, and the two are often the same arithmetic written differently. What
stops the compiler rearranging it for you is usually either floating point
rounding or a pointer it cannot prove is separate.

Unit 026 is the last in this part, and it is about what happens when two of these
machines look at the same memory.

## Reading the errors you are about to see

These count and model rather than measure, for the reason the last unit gave.
A misprediction count under a stated predictor is reproducible where a timing on
a shared machine is not.

`assert-failed` names the case your model got wrong. One exercise asserts three
different sums of the same eight numbers, and those three values were produced by
running the code rather than reasoned about.
