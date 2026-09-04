---
needs: [cache, pipeline]
minutes: 55
one_idea: A single timing number tells you almost nothing, every way of finding where time goes is biased in a direction you can name, and the most dangerous measurement is the one that quietly stopped sampling the slow cases.
sources: [debugging-and-measurement]
---

Ask how long something takes and you get one number. Run it again and you get a
different one. The gap between them is not noise to be averaged away; it is the
measurement telling you that the question was underspecified.

This unit is about what to measure, which tool distorts what, and one failure
that makes a system look nine times better than it is while every number on the
dashboard stays true.

The costs quoted below are from published measurements, and the failure modes
were all found by people who trusted a number.

## Two ways to find out, biased in opposite directions

There are exactly two ways to learn where a program spends time.

Instrumenting means inserting code at every function entry and exit. You get
exact call counts and a complete call graph, and you get two biases with them.
The overhead is proportional to how often a function is called rather than to
how long it takes, so a tiny function called a billion times is measured mostly
measuring the measurement. And instrumentation prevents inlining, so the binary
you profiled is not the binary you ship, and the function you were staring at
may not exist at all in the shipped one.

Sampling means interrupting the program many times a second and recording where
it was. The overhead is proportional to the sample rate rather than to the
program's shape, which is why it is what modern profilers do. Its biases are
different and worth knowing individually.

You only see what you sample, so sampling finds hot and never finds rare and
expensive. An event that takes a hundred microseconds and happens once will be
missed at any sane rate.

The recorded address is not exactly the guilty instruction, because the
interrupt arrives some cycles after the event that caused it. Attribution at
instruction granularity is fiction unless the hardware's precise sampling mode
is on.

And sampling at a round rate aliases against everything else in the system that
runs at a round rate: a timer, a scheduler tick, a frame. That is why the usual
default is 999 hertz rather than 1000. A prime offset from every round number is
the entire reason.

The bias that catches people is the last one. A profiler that samples the
processor cannot see time your program was not running. If it is slow because it
is waiting on a lock or a disk, the profile shows an idle machine and tells you
nothing at all.

```figure
{
  "kind": "blocks",
  "alt": "A wall clock interval split into time on the processor, which a sampling profiler sees, and time blocked waiting, which it does not see at all.",
  "caption": "A processor profiler measures the left half. When the answer is in the right half, the profile is not wrong so much as silent, and the fix is to sample the scheduler rather than the processor.",
  "boxes": [
    { "id": "w", "x": 0,   "y": 0,   "w": 3.4, "h": 1.1, "label": "wall clock", "accent": "slate" },
    { "id": "c", "x": 5.0, "y": 0,   "w": 4.4, "h": 1.1, "label": "on cpu: sampled", "accent": "jade" },
    { "id": "b", "x": 5.0, "y": 2.2, "w": 4.4, "h": 1.1, "label": "blocked: invisible", "accent": "clay" }
  ],
  "arrows": [
    { "from": "w", "to": "c" },
    { "from": "w", "to": "b" }
  ]
}
```

## Getting a stack out of a sample

A sample without a stack says what was running. A sample with a stack says why,
and getting the stack is where profiling gets awkward.

The cheap way is to walk the chain of frame pointers: each frame points at the
previous one, with the return address beside it. It costs a few loads, it can be
done in the kernel at interrupt time, and it needs every frame in the stack to
have kept its frame pointer.

Compilers stopped keeping them by default, because the register is worth having
and the exercise looked free. The consequence was that profiles of real programs
filled up with unknown frames: you could see that a third of the time was inside
the system library and nothing whatever about which of your paths got there.

The alternative is to copy a chunk of the stack at every sample and unwind it
later using the tables the compiler emitted for exception handling. It works on
binaries built without frame pointers and needs no rebuild. It also produces
kilobytes per sample instead of tens of bytes, drops samples when the buffer
overflows, silently truncates stacks deeper than the copied chunk, and makes
reporting slow.

So the industry measured the other option and changed its mind. Putting frame
pointers back costs about two and a half percent on a kernel build, two percent
on a rendering benchmark, between one and ten percent on a set of language
benchmarks, and nothing measurable on several widely used servers. Production
reports put it under one percent typically. Two major distributions turned them
back on in 2023 and 2024, having decided that a profile you can read is worth a
percent.

There is a lesson underneath that one. Several microbenchmark regressions blamed
on frame pointers turned out to be alignment and cache line effects, where
adding any two instructions would have moved the number the same way.

## What a profile looks like when it is aggregated

A flame graph takes many thousands of stack samples and merges them. Width is
the fraction of samples containing that frame, so wide means much time, and
height is stack depth rather than time. It is not a timeline, and the left to
right order carries no meaning beyond sorting.

The variant worth reaching for first is the differential one: two profiles,
before and after, with each box coloured by whether it grew or shrank. A regular
flame graph invites you to stare at the widest tower, which is usually something
you already knew about. A differential graph shows you what changed, which is
the question you actually had.

## The average is the least useful number

Report a distribution rather than a number, because the shape is the
information. In anything user facing the number that matters is a high
percentile, since that is the experience a real user has some of the time, and
one request in a page load being slow makes the page slow.

Percentiles have a trap in them that is worth the rest of this unit.

## What coordinated omission hides

Here is the failure. A load generator is meant to send a request every ten
milliseconds. It sends one, and that request takes a second because the system
stalled. During that second it sends nothing, because it is waiting.

Then it resumes, and records one slow sample of one second, plus a great many
fast ones afterwards. But a real world that sends a request every ten
milliseconds sent a hundred requests during that stall, and every one of them
waited: the first for a second, the next for slightly less, and so on. Those
ninety nine slow samples were never recorded, because the measuring tool
coordinated with the system under test and politely stopped asking while it was
struggling.

The result is a set of percentiles that are all true about the samples taken and
badly wrong about the system. The samples that would have been slow are exactly
the ones missing. Reported tail latency can be off by an order of magnitude.

The fix is to record latency from when a request was supposed to be sent rather
than from when it was actually sent. That single change converts one slow sample
into the hundred slow samples the world would have seen, and the percentile
becomes an honest one.

The general form is worth keeping. Any measurement whose sampling rate is
affected by the thing being measured under-reports exactly the cases you care
about most.

## Measuring something the compiler deleted

One more hazard, on the small scale. Write a loop that computes something and
throws it away, and the optimiser is entitled to delete the whole thing. The
timing then measures an empty loop, which is fast and encouraging and worthless.

Benchmark libraries offer a function to stop that, and the caveat is the part
people miss: it prevents the result from being discarded, and it does not stop
the compiler from simplifying the expression that produced it. A constant folded
computation is still constant folded. What you are keeping alive is the answer,
not the work.

Alignment is the other small scale trap, and the frame pointer story above is
the evidence. Two versions of a function that differ by an instruction can differ
by a few percent for reasons that have nothing to do with the change, so a few
percent on a microbenchmark is not a result. It is a hypothesis to test on
something bigger.

## What to carry forward

Instrumenting gives exact counts and over-reports small hot functions, in a
binary that is not the one you ship. Sampling gives an unbiased view of on
processor time and cannot see anything else, which is the most common way a
profile misleads.

The default rate is prime for a reason, the recorded address is not the guilty
instruction without precise sampling, and time spent blocked is invisible until
you sample the scheduler instead.

A stack needs either frame pointers or a slow unwind through exception tables.
The industry measured the tradeoff and put frame pointers back, at around one
percent, because a profile full of unknown frames is not a profile.

Report a distribution. And know coordinated omission by name, because it is the
failure where every number on the page is true and the system is nine times
worse than it says.

Next is the last unit in this part: how to find the inputs that break a program
rather than the ones you thought of, and what it takes to prove that none exist.

## Reading the errors you are about to see

These model the arithmetic behind the tools: percentiles over a sorted sample,
the correction that undoes coordinated omission, how many samples an event of a
given length can expect, and walking a chain of frame pointers.

`assert-failed` names the case your model got wrong. Several exercises assert
that a corrected latency is larger than the one the naive tool recorded, which
is the omission being undone rather than a sign error.
