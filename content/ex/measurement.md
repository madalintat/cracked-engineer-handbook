## The number in the middle is not the answer

Write `percentile`, returning the value at a given percentile of a sorted
sample, using the nearest rank method.

The rank is the percentile times the count, rounded up, and at least 1. The
value returned is the one at that rank, counting from 1. A percentile of 0 gives
the first value, and 100 gives the last.

@kind output
@concept A percentile is a rank rather than an interpolation, and the rounding
decides which of two samples you report at small counts.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Rounding up is what makes the 99th percentile of a hundred samples the
hundredth value rather than the ninety ninth.
@diagnose assert verdict assert-failed
A check disagrees. Rounding down puts the 50th percentile of four samples at the
second value, and it puts the 100th percentile one short of the largest value,
which is the wrong answer for the number people actually look at.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after In anything user facing the high percentile is the number that matters,
because one slow request in a page load makes the page slow.

```starter
unsigned long percentile(const unsigned long *sorted, unsigned n, unsigned p) {
    (void)p;
    if (!n) return 0;
    return sorted[n / 2];
}
```

```tests
#include <assert.h>
unsigned long percentile(const unsigned long *, unsigned, unsigned);
int main(void) {
    unsigned long s[] = {10, 20, 30, 40};
    assert(percentile(s, 4, 0) == 10);
    assert(percentile(s, 4, 25) == 10);
    assert(percentile(s, 4, 50) == 20);
    assert(percentile(s, 4, 75) == 30);
    assert(percentile(s, 4, 100) == 40);
    { unsigned long one[] = {7};
      assert(percentile(one, 1, 99) == 7); }
    assert(percentile(s, 0, 50) == 0);
    return 0;
}
```

```solution
unsigned long percentile(const unsigned long *sorted, unsigned n, unsigned p) {
    if (!n) return 0;
    unsigned long rank = ((unsigned long)n * p + 99) / 100;
    if (rank < 1) rank = 1;
    if (rank > n) rank = n;
    return sorted[rank - 1];
}
```

## The latency that was actually experienced

Write `true_latency`, returning the latency a request really suffered, given when
it was supposed to be sent, when it was actually sent, and when the response
came back.

A tool that measures from the actual send time reports only the service time. A
request that should have gone out earlier was already waiting before it was
sent, and that wait is part of what the world experienced.

@kind output
@concept This one line is the whole of coordinated omission. The tool stopped
asking while the system was struggling, so the waiting never got recorded.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Measure from the moment the request was due, not from the moment the tool
managed to send it.
@diagnose assert verdict assert-failed
A check disagrees. A request due at 100 and sent at 900 was already 800 late
before the service time began, and reporting only the service time is what makes
a tail latency ten times better than the truth.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A request sent on time reports the same number either way, which is why
the bug is invisible until the system is under stress, which is when the
measurement matters.

```starter
unsigned long true_latency(unsigned long due, unsigned long sent,
                           unsigned long done) {
    (void)due;
    return done - sent;
}
```

```tests
#include <assert.h>
unsigned long true_latency(unsigned long, unsigned long, unsigned long);
int main(void) {
    assert(true_latency(100, 100, 105) == 5);     /* sent on time */
    assert(true_latency(100, 900, 905) == 805);   /* delayed by the stall */
    assert(true_latency(0, 1000, 1001) == 1001);
    assert(true_latency(50, 50, 50) == 0);
    return 0;
}
```

```solution
unsigned long true_latency(unsigned long due, unsigned long sent,
                           unsigned long done) {
    (void)sent;
    return done - due;
}
```

## The samples that were never taken

Write `omitted_samples`, returning how many requests a fixed rate load generator
failed to send during a stall, given the length of the stall and the interval
between requests.

The generator should have sent one request per interval throughout the stall. It
sent one, at the start, and then waited. Everything that should have gone out
during the stall was never sent and never recorded.

@kind output
@concept The missing samples are exactly the slow ones, which is why the
percentiles come out true about the sample and wrong about the system.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The one sent at the start was recorded. Count the ones due during the
stall after it.
@diagnose assert verdict assert-failed
A check disagrees. A one second stall at ten milliseconds per request omits
ninety nine samples, not a hundred: the first request is the one that got sent
and measured.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Those ninety nine would each have waited, the first nearly a second and
the last barely at all. Recording one slow sample instead of a hundred is how a
tail latency is reported an order of magnitude too good.

```starter
unsigned long omitted_samples(unsigned long stall, unsigned long interval) {
    if (!interval) return 0;
    return stall / interval;
}
```

```tests
#include <assert.h>
unsigned long omitted_samples(unsigned long, unsigned long);
int main(void) {
    assert(omitted_samples(1000, 10) == 99);
    assert(omitted_samples(10, 10) == 0);      /* the next one was due exactly at the end */
    assert(omitted_samples(25, 10) == 1);
    assert(omitted_samples(0, 10) == 0);
    assert(omitted_samples(1000, 0) == 0);
    return 0;
}
```

```solution
unsigned long omitted_samples(unsigned long stall, unsigned long interval) {
    if (!interval) return 0;
    unsigned long due = stall / interval;
    return due ? due - 1 : 0;
}
```

## What a sampler can expect to see

Write `expected_samples`, returning how many times a sampling profiler running at
a given rate can expect to interrupt an event, given the event's duration in
microseconds and the sample rate in hertz.

Return the expected count in hundredths, so that a fraction of a sample is
visible rather than rounded to nothing. An event shorter than one sampling
interval has an expected count below one, which is the useful answer.

@kind output
@concept Sampling finds hot and never finds rare and expensive, and this is the
arithmetic that says so.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Expected samples are the duration times the rate. Watch the units:
microseconds against samples per second.
@diagnose assert verdict assert-failed
A check disagrees. An event of a hundred microseconds at 999 hertz expects about
a tenth of a sample, which in hundredths is 9. Reporting a whole number here
rounds the interesting cases to zero and hides them.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The consequence is that a hundred microsecond stall that happens once
will almost certainly be missed at any sane rate, whatever it did to the user
who hit it.

```starter
unsigned long expected_samples(unsigned long micros, unsigned long hz) {
    return micros * hz / 1000000UL;
}
```

```tests
#include <assert.h>
unsigned long expected_samples(unsigned long, unsigned long);
int main(void) {
    /* 100 us at 999 Hz is 0.0999 samples, which is 9 hundredths. */
    assert(expected_samples(100, 999) == 9);
    /* One second at 999 Hz is 999 samples. */
    assert(expected_samples(1000000, 999) == 99900);
    /* 10 ms at 1000 Hz is 10 samples. */
    assert(expected_samples(10000, 1000) == 1000);
    assert(expected_samples(0, 999) == 0);
    return 0;
}
```

```solution
unsigned long expected_samples(unsigned long micros, unsigned long hz) {
    return micros * hz / 10000UL;
}
```

## Sampling at a round number

Write `aliases`, deciding whether a sampling rate will alias against a periodic
event in the system, given both frequencies in hertz.

Two frequencies alias when one divides the other exactly, in either direction,
because then the sampler keeps landing at the same point in the event's cycle
and either always sees it or never does. A rate of zero aliases with nothing.

@kind output
@concept This is why the usual default is 999 rather than 1000. A prime offset
from every round number in the system is the entire reason.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Either direction counts, because the sampler being faster or slower than
the event both give a fixed phase relationship.
@diagnose assert verdict assert-failed
A check disagrees. Sampling at 1000 aliases against an event at 100 as well as
one at 1000, because the sampler lands at the same phase every time.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after 999 divides nothing anyone else runs at, which is the whole of the
design decision.

```starter
int aliases(unsigned long sample_hz, unsigned long event_hz) {
    return sample_hz == event_hz;
}
```

```tests
#include <assert.h>
int aliases(unsigned long, unsigned long);
int main(void) {
    assert(aliases(1000, 1000) == 1);
    assert(aliases(1000, 100) == 1);    /* sampler is a multiple */
    assert(aliases(100, 1000) == 1);    /* event is a multiple */
    assert(aliases(999, 1000) == 0);
    assert(aliases(999, 100) == 0);
    assert(aliases(0, 1000) == 0);
    assert(aliases(1000, 0) == 0);
    return 0;
}
```

```solution
int aliases(unsigned long sample_hz, unsigned long event_hz) {
    if (!sample_hz || !event_hz) return 0;
    return sample_hz % event_hz == 0 || event_hz % sample_hz == 0;
}
```

## Walking the frames

Write `stack_depth`, returning how many frames a frame pointer walk recovers,
given each frame's saved pointer to the previous one.

Start at frame `top` and follow the chain. Frame 0 is the outermost frame: it
is counted and the walk ends there. A saved pointer of -1 means that frame kept
none, and the walk stops without counting it, so every frame below it is lost.

Count the frames actually recovered, including the one you started at.

@kind output
@concept Missing one frame pointer does not lose one frame. It loses everything
below it, which is why a profile of a program built without them is a forest of
stumps.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The walk ends in two different ways, and only one of them counts the
frame it ended on.
@diagnose assert verdict assert-failed
A check disagrees. Reaching a frame that kept no pointer ends the walk without
counting it, and everything it would have led to is unreachable. That is the
difference between a stack you can read and one that stops in a library.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A third of your time being inside the system library, with no idea which
of your call paths got there, is what this looks like in practice.

```starter
unsigned stack_depth(const int *prev, int top) {
    unsigned n = 0;
    while (top >= 0) {
        n++;
        if (prev[top] == 0) break;
        top = prev[top];
    }
    return n;
}
```

```tests
#include <assert.h>
unsigned stack_depth(const int *, int);
int main(void) {
    /* frame 3 -> 2 -> 1 -> 0 (outermost) */
    { int p[] = {0, 0, 1, 2};
      assert(stack_depth(p, 3) == 4); }
    /* frame 2 kept no pointer: the walk gets 3 and stops. */
    { int p[] = {0, 0, -1, 2};
      assert(stack_depth(p, 3) == 1); }
    /* starting at the outermost frame */
    { int p[] = {0};
      assert(stack_depth(p, 0) == 1); }
    /* the top frame itself kept none */
    { int p[] = {0, -1};
      assert(stack_depth(p, 1) == 0); }
    return 0;
}
```

```solution
unsigned stack_depth(const int *prev, int top) {
    unsigned n = 0;
    while (top >= 0) {
        if (prev[top] < 0) break;   /* this frame kept no pointer */
        n++;
        if (top == 0) break;        /* the outermost frame, and it counts */
        top = prev[top];
    }
    return n;
}
```

## What the processor profiler cannot see

Write `visible_fraction`, returning what percentage of a program's wall clock a
processor sampling profiler can account for, given the time spent running and
the time spent blocked.

Only the running time produces samples. Return the answer as a whole percentage,
rounded down. A program that never ran at all is reported as 0.

@kind output
@concept A profile that shows an idle machine is not wrong. It is silent, and
the answer is in the half it cannot see.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The denominator is the whole wall clock, which is both parts added
together.
@diagnose assert verdict assert-failed
A check disagrees. A program that runs for one second and waits for nine has ten
percent of its time visible to a processor profiler, not a hundred. Dividing by
the running time alone always gives a hundred, which is the mistake the tool
itself invites.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The fix is to sample the scheduler switching threads out rather than the
processor, which is what an off processor profile is.

```starter
unsigned visible_fraction(unsigned long on_cpu, unsigned long blocked) {
    (void)blocked;
    return on_cpu ? 100 : 0;
}
```

```tests
#include <assert.h>
unsigned visible_fraction(unsigned long, unsigned long);
int main(void) {
    assert(visible_fraction(1000, 9000) == 10);
    assert(visible_fraction(1000, 0) == 100);
    assert(visible_fraction(0, 1000) == 0);
    assert(visible_fraction(1, 2) == 33);
    assert(visible_fraction(0, 0) == 0);
    return 0;
}
```

```solution
unsigned visible_fraction(unsigned long on_cpu, unsigned long blocked) {
    unsigned long total = on_cpu + blocked;
    if (!total) return 0;
    return (unsigned)(on_cpu * 100 / total);
}
```

## Is that a result or is that noise

Write `is_real_change`, deciding whether a difference between two measurements
should be believed, given the two values and the spread of the noise as a
percentage.

Believe the difference when it is larger than the noise, measured as that
percentage of the first value. Anything at or below the noise is a hypothesis
rather than a result.

@kind output
@concept A few percent on a microbenchmark can come from alignment alone, so
the threshold is not a formality.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The comparison is on the size of the difference, in either direction,
against a threshold computed from the baseline.
@diagnose assert verdict assert-failed
A check disagrees. A change is a change whichever way it went, and a difference
exactly equal to the noise is not evidence.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Several regressions blamed on frame pointers turned out to be cache line
and alignment effects, where adding any two instructions would have moved the
number the same way.

```starter
int is_real_change(unsigned long before, unsigned long after,
                   unsigned noise_pct) {
    return after < before && (before - after) * 100 > before * noise_pct;
}
```

```tests
#include <assert.h>
int is_real_change(unsigned long, unsigned long, unsigned);
int main(void) {
    assert(is_real_change(1000, 900, 5) == 1);    /* 10 percent faster */
    assert(is_real_change(1000, 1100, 5) == 1);   /* 10 percent slower */
    assert(is_real_change(1000, 980, 5) == 0);    /* inside the noise */
    assert(is_real_change(1000, 950, 5) == 0);    /* exactly the noise */
    assert(is_real_change(1000, 1000, 0) == 0);
    return 0;
}
```

```solution
int is_real_change(unsigned long before, unsigned long after,
                   unsigned noise_pct) {
    unsigned long diff = after > before ? after - before : before - after;
    return diff * 100 > before * noise_pct;
}
```
