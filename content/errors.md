## sim / ok

@short The truth table matches on every row, using only NAND.

Every input combination in the exercise's table produced the output the table
says it should, and the design used nothing but NAND parts. This is the only
passing verdict the simulator has.

Passing is not the same as minimal. The gate count is reported alongside the
result, and several exercises have a target you can beat.

## sim / table-mismatch

@short The circuit is well formed and computes the wrong function.

The netlist parsed, every wire is driven, and the simulator evaluated it
successfully. The answer is wrong for at least one input row, and the row it
names is the one to reason about first.

Take that row, set the inputs by hand, and walk forward through your gates. The
first gate whose output surprises you is the bug. Reading the table for a
pattern is usually slower than tracing one row.

## sim / non-nand-part

@short You used a part the exercise does not give you.

The point of Part II is that NAND alone is enough, so the simulator refuses any
other primitive until the exercise says otherwise. Writing `and` is not a
shortcut here, it is skipping the thing being demonstrated.

Build the part you want out of NAND, in its own module, then use that. The
exercises are ordered so the part you need was built two exercises ago.

## sim / cycle

@short An output feeds back into its own input with no clock.

The simulator evaluates combinational logic by settling it, and a loop with no
storage in it never settles: the output changes the input which changes the
output. Real silicon does something worse, oscillating at whatever frequency
the propagation delay allows.

The trace names the wires in the loop. Combinational feedback is almost always
a typo in a wire name. Deliberate feedback needs a clocked element, which is
what Part II builds next.

## sim / floating-input

@short A gate input is connected to nothing.

Every input of every part must be driven by something: a circuit input, or
another part's output. An undriven input has no value to compute with, so the
simulator stops rather than guessing zero.

In hardware this is worse than an error, because a floating CMOS input sits at
an undefined voltage, draws current through both halves of the gate at once,
and can read as either level depending on the weather.

## sim / gate-budget

@short The design is correct and uses more gates than the exercise allows.

The answer matches on every row. There is a smaller one, and the budget is
there because finding it is the exercise.

Look for a signal you compute twice. Reusing one NAND output in two places is
almost always where the saving is, and it is the same idea as common
subexpression elimination in a compiler.

## godbolt / ok

@short It compiled, it ran, and every check passed.

The compiler reported no errors, the program exited zero, and the assertions in
the exercise's checks all held.

Where an exercise also asks for something in the generated assembly, that is
judged separately and shown as its own row.

## godbolt / compile-error

@short The compiler rejected the program.

The message names a file and a line, and the line it names is where the
compiler gave up rather than always where the mistake is. A missing semicolon
is reported on the line after it.

C and C++ diagnostics are worth reading to the end rather than to the first
line. The note lines under an error frequently contain the actual answer, and
a template error's first line is usually its least useful.

## godbolt / warning

@short It compiled, and the compiler told you something you should read.

The program was accepted and the exercise treats the warning as the result,
because that is the point: the exercises in Part VI are largely about code that
compiles cleanly under default flags and is still wrong.

Warnings are enabled deliberately per exercise. The flags used are shown with
the result, so you can see which one caught this.

## godbolt / link-error

@short Every file compiled and a name has no definition.

The compiler was satisfied that the name exists, because a declaration promised
it would. The linker went looking for the body and found nothing.

In C++ the name in the message is mangled. The undefined symbol is usually a
function you declared and never defined, a member function defined outside its
class with the wrong signature, or a template instantiated in a translation
unit that cannot see its definition.

## godbolt / nonzero-exit

@short It compiled, it ran, and it reported a wrong result.

Nothing crashed. The program ran to completion and returned a nonzero status,
which for these exercises means one of the checks disagreed with your answer.

This is the most informative failure the toolchain offers, because the output
above the status usually names the input, what your code gave and what was
expected.

## godbolt / assert-failed

@short A check fired, and its text names the condition.

An `assert` in the exercise's checks was false. The message carries the file,
the line, the enclosing function and the source text of the condition itself.

Worth knowing for later: Compiler Explorer reports the process as killed by
signal 6 for an assertion, and its own stderr says the assertion failed. This
handbook keys on the text rather than the number, because the number has moved
before.

## godbolt / signal

@short The program was killed by the operating system.

A segmentation fault means a memory access the kernel refused, usually through
a null or dangling pointer, or past the end of an array. A bus error means a
misaligned access. An abort is usually an uncaught exception or a failed
assertion.

The signal tells you the kind of fault and nothing about where. Compiling with
the sanitizer flags an exercise offers turns most of these into a message that
names the line.

## godbolt / sanitizer

@short The sanitizer caught undefined behaviour as it happened.

This is the good outcome for the exercises that ask for it. Undefined behaviour
is normally silent, and the whole difficulty of it is that the wrong answer
arrives with no complaint. The sanitizer makes the moment visible.

The message names the operation, the operand values and the type. Signed
overflow reports the exact addition that overflowed and the type it did not fit
in, which is far more useful than a wrong number arriving later.

## godbolt / timeout

@short It compiled and did not finish in time.

The executor allows roughly ten seconds of wall clock. A program that exceeds
it is usually in a loop whose condition can never become false.

The classic version of this in Part VI is a loop counting down with an unsigned
index, where the condition `i >= 0` is true for every possible value of the
type. Nothing is wrong with the arithmetic; the loop simply cannot end.

## yosys / ok

@short It synthesised, and the netlist is what the exercise asked for.

The design parsed and synthesised, the cells it produced match what the
exercise specified, and no latch was inferred where none was wanted.

The cell counts are shown with the result. They are the answer to most of the
questions in Part III, and they are worth reading even when the result passes.

## yosys / syntax-error

@short Yosys could not read the design.

The message names a line. Verilog's grammar is unforgiving about a missing
`end`, `endmodule` or semicolon, and the error is often reported some distance
after the omission because the parser only fails once it cannot continue.

Check the construct that opened before the line named, not only the line
itself.

## yosys / latch-inferred

@short A combinational block does not assign its output on every path.

Verilog says a signal that is not assigned on some path keeps its previous
value. Keeping a previous value requires storage, so the synthesiser gives you
storage: a level-sensitive latch you did not ask for.

The fix is to assign a default at the top of the block, or to add the missing
`else` or `default`. This is judged on the cell that appeared rather than on
the warning text, because Yosys prints a message containing the same words when
it did not infer one.

## yosys / multi-driver

@short Two blocks drive the same signal.

A wire has one value at a time. Two sources for it is not a design, it is a
question with no answer, and in silicon it is a short between two outputs.

Combine the logic into one block. If the two blocks are meant to apply in
different situations, that is a condition inside a single block, not two blocks
racing.

## yosys / cell-budget

@short It synthesised correctly and used more cells than the exercise allows.

The design is right. The exercise names a cell count because reaching it is the
exercise, and the count the tool reports is the honest measure rather than a
guess from reading the source.

Read the cell list rather than the total. A flip-flop where you expected none,
or a wide adder where a comparator would do, is usually the whole difference.

## yosys / sat-fail

@short Your design and the reference disagree on some input.

The equivalence check ran and found a counterexample, which it prints. That
counterexample is a specific set of input values where the two circuits produce
different outputs.

This is a stronger statement than a failing test. It is a proof of difference,
found by search rather than by trying cases, so there is no question of whether
you simply missed the input that breaks it.

## modal / ok

@short It compiled, the kernel ran on a real GPU, and the checks passed.

`nvcc` accepted the program, the kernel launched on the GPU you selected, and
the exercise's checks agreed with the result.

The GPU it ran on is named with the result, because a kernel that passes on one
compute capability is not automatically correct on another.

## modal / compile-error

@short nvcc rejected the program.

The message names a file and a line the way a host compiler does, with one
difference worth knowing: `nvcc` has no stable error codes. Its warnings are
numbered, as `#549-D`, and its errors are prose.

The most common cause in these exercises is calling something in device code
that only exists on the host, or the reverse. A `__global__` function cannot
call an ordinary host function, and the error says so without using those
words.

## modal / launch-error

@short The kernel never started.

The launch itself was rejected, before any of your device code ran. An invalid
configuration means the block size exceeds what the device allows, which is
1024 threads for every capability this handbook covers, or the shared memory
requested exceeds what a block can have.

Because a launch is asynchronous, this error is often reported later, at the
next synchronising call rather than at the launch. Checking the error
immediately after the launch is how you find out which launch it was.

## modal / cuda-error

@short The runtime reported a fault during execution.

An illegal memory access means the kernel touched memory outside any valid
mapping. An unspecified launch failure is usually the same thing, reported less
precisely.

Take seriously how little this tells you about where. The fault is reported at
the next synchronisation, not at the instruction that caused it, and a kernel
writing out of bounds inside its own allocation does not produce this error at
all. It produces a wrong answer and no complaint.

## modal / sanitizer

@short compute-sanitizer caught the access as it happened.

This is the outcome worth having. It names the kind of access, the thread and
block that made it, and with `-lineinfo` the line of source it came from.

It costs execution speed, which is why it is not on for every exercise. When
something is wrong and nothing is complaining, it is the first thing to reach
for.

## modal / nonzero-exit

@short The kernel ran, and computed the wrong answer.

Nothing crashed and nothing complained. The program ran to completion and one
of the checks disagreed, which on a GPU usually means a warp did not do what
the code appears to say.

This is the failure to take most seriously. A kernel that faults tells you
where to look; a kernel that quietly computes the wrong number tells you
nothing, and the same bug on a cluster shows up as a model that trains slightly
worse.

## modal / assert-failed

@short A check fired, on the host or inside the kernel.

An `assert` in device code prints the block and thread that failed it, which
narrows the search enormously compared with a host-side check that only sees
the final array.

Device-side assertions stop the kernel and put the context into an unusable
state, so nothing after the failure is meaningful.

## modal / timeout

@short The job did not finish inside its budget.

The runner allows a fixed wall clock per submission, including the time to
start a container and compile. A kernel that exceeds it is usually in a loop
that cannot terminate, or waiting at a barrier some threads never reach.

`__syncthreads()` inside a branch that only some threads take is the classic
version. Every thread in the block has to reach the barrier, so the ones that
skipped it never arrive and the ones that did wait forever.

## modal / no-endpoint

@short There is no GPU runner configured in this browser.

These exercises run on hardware you rent, so there is no shared endpoint and
there should not be one. Nothing here can reach a GPU until you deploy the
runner to your own account and paste its two addresses into settings.

The settings page has the deploy command and explains what the runner does. It
is a single file, it holds no state, and everything else in this handbook keeps
working without it.
