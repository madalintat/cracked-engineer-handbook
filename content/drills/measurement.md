## What are the two ways of finding out where a program spends time?

- [x] Instrumenting, which inserts code at every entry and exit, and sampling, which interrupts and records
- [ ] Timing the whole program, and timing each function
- [ ] Reading hardware counters, and reading the system clock
- [ ] Static analysis, and tracing

@why They are biased in opposite directions, which is why knowing which one a
tool is doing matters more than knowing its name.

## What does instrumentation systematically over-report?

- [x] Small functions called very often, because the overhead follows call count rather than time
- [ ] Large functions, because they take longer to enter and leave
- [ ] Functions that allocate memory
- [ ] Recursive functions, because each level is counted twice

@why A tiny function called a billion times is measured mostly measuring the
measurement.

## Why is a profiled instrumented binary not the binary you ship?

- [x] Instrumentation inhibits inlining, so functions exist that would have disappeared at `-O2`
- [ ] It is built without optimisation
- [ ] The profiler rewrites the machine code as it runs
- [ ] Debug information changes the layout of the code

@why The function you spent an afternoon staring at may not exist in the
shipped build at all.

## What can sampling never find?

- [x] Something rare and expensive, because it will not be interrupted while it happens
- [ ] Something hot, because samples merge into the surrounding frames
- [ ] Time spent in the standard library
- [ ] Anything in a function that was inlined

@why An event of a hundred microseconds that happens once will be missed at any
sane rate, whatever it did to the person who hit it.

## Why is the recorded address not the guilty instruction?

- [x] The interrupt arrives some cycles after the event that caused it
- [ ] The profiler records the return address rather than the current one
- [ ] Optimisation reorders instructions after the profile is taken
- [ ] The address is rounded to a cache line

@why Attribution at instruction granularity is fiction unless the hardware's
precise sampling mode is switched on.

## Why do profilers sample at 999 hertz rather than 1000?

- [x] A round rate aliases against everything else in the system that runs at a round rate
- [ ] 999 is the highest rate the kernel permits
- [ ] It leaves one sample per second for bookkeeping
- [ ] It reduces overhead by a measurable amount

@why A prime offset from every round number means the sampler does not keep
landing at the same point in someone else's cycle.

## Your program is slow because it waits on a lock. What does a processor sampling profile show?

- [x] An almost idle machine, and nothing about the waiting
- [ ] The lock function, at the top of the profile
- [ ] The thread holding the lock
- [ ] A warning that most samples were unattributable

@why This is the most common way a profile misleads. The fix is to sample the
scheduler switching threads out rather than the processor.

## What does a frame pointer walk need to work?

- [x] Every frame in the stack to have kept its frame pointer
- [ ] Debug information for every function on the stack
- [ ] The program to be compiled without optimisation
- [ ] The stack to fit inside one page

@why Miss one and the walk either stops or follows garbage, so a single library
built without them truncates every stack that passes through it.

## What does unwinding through the compiler's exception tables cost, compared to a frame pointer walk?

- [x] Kilobytes of copied stack per sample, dropped samples at high rates, silent truncation, and slow reporting
- [ ] Nothing; it is strictly better and needs no rebuild
- [ ] It requires the program to be single threaded
- [ ] It only works on optimised builds

@why It does work without a rebuild, which is its real advantage. The costs are
what sent the industry back to frame pointers.

## Roughly what does compiling with frame pointers cost?

- [x] Around a percent typically, with a few percent on some builds and nothing measurable on many servers
- [ ] Around twenty percent, which is why they were removed
- [ ] Nothing at all under any circumstances
- [ ] It depends entirely on the number of function calls, and is usually over ten percent

@why Two major distributions turned them back on in 2023 and 2024, having
decided that a profile you can read is worth a percent.

## In a flame graph, what does the width of a box mean?

- [x] The fraction of samples that contained that frame
- [ ] How long that call took, on the time axis
- [ ] How many times the function was called
- [ ] How much memory the function allocated

@why It is not a timeline, and left to right order carries no meaning beyond
sorting. A flame chart, where the x axis is time, is a different thing.

## Which flame graph answers the question you usually have?

- [x] The differential one, coloured by what grew and shrank between two profiles
- [ ] The plain one, where you look at the widest tower
- [ ] The off processor one, always
- [ ] The memory one, weighted by bytes

@why The widest tower is usually something you already knew about. What changed
is the question you actually had.

## A load generator sends a request every ten milliseconds. The system stalls for one second. What does a naive tool record?

- [x] One slow sample, because it sent nothing while it was waiting
- [ ] A hundred slow samples, one per interval
- [ ] Nothing, because the requests timed out
- [ ] A hundred samples of ten milliseconds each

@why The requests that would have been slow were never sent. The tool
coordinated with the system under test and stopped asking while it struggled.

## How is coordinated omission corrected?

- [x] Measure latency from when a request was due to be sent, not from when it was actually sent
- [ ] Increase the number of load generator threads
- [ ] Discard the slowest one percent of samples as outliers
- [ ] Sample at a prime frequency

@why That single change turns one slow sample into the many slow samples the
world would have experienced, and makes the percentile honest.

## A benchmark library's function to keep a result alive. What does it not do?

- [x] Stop the compiler from simplifying or folding the expression that produced the result
- [ ] Prevent the result from being discarded
- [ ] Work at any optimisation level
- [ ] Apply to values in registers

@why What you are keeping alive is the answer, not the work. A constant folded
computation is still constant folded, and the timing then measures nothing.
