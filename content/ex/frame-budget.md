## Pixels, and pixels per second

Write `pixel_rate`, returning how many pixels a display produces per second,
given its width, height and refresh rate.

The numbers are large. A 4K display at 120 hertz is just under a billion pixels
a second, which does not fit in a 32 bit signed integer.

@kind output
@concept The first thing to notice about this workload is its size, and the
first thing to get wrong is the type you count it in.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The multiplication has to happen in the wide type, not be widened after
it has already overflowed.
@diagnose assert verdict assert-failed
A check disagrees. Multiplying two 32 bit values and assigning the result to a
64 bit variable does the arithmetic in 32 bits first, so the overflow has
already happened before the assignment.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Just under a billion pixels a second, before a single one of them is
drawn twice.

```starter
unsigned long long pixel_rate(unsigned w, unsigned h, unsigned hz) {
    unsigned product = w * h * hz;
    return product;
}
```

```tests
#include <assert.h>
unsigned long long pixel_rate(unsigned, unsigned, unsigned);
int main(void) {
    assert(pixel_rate(3840, 2160, 120) == 995328000ULL);
    assert(pixel_rate(3840, 2160, 1) == 8294400ULL);
    assert(pixel_rate(1920, 1080, 60) == 124416000ULL);
    assert(pixel_rate(7680, 4320, 240) == 7962624000ULL);
    assert(pixel_rate(0, 1080, 60) == 0ULL);
    return 0;
}
```

```solution
unsigned long long pixel_rate(unsigned w, unsigned h, unsigned hz) {
    return (unsigned long long)w * h * hz;
}
```

## How long one pixel gets

Write `picos_per_pixel`, returning how much time there is per pixel, in
picoseconds, given the width, height and refresh rate.

A second is 1,000,000,000,000 picoseconds. Truncate towards zero.

@kind output
@concept The budget per output is the number the whole architecture answers,
and it is around a nanosecond.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Time per frame divided by pixels per frame is the same as one second
divided by pixels per second, and the second form has no rounding in the middle.
@diagnose assert verdict assert-failed
A check disagrees. Computing the frame time in whole picoseconds and then
dividing loses nothing, but computing it in whole nanoseconds first throws away
the precision that makes this answer meaningful.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after About 1005 picoseconds. On a five gigahertz core that is five clock
cycles for everything a pixel needs.

```starter
unsigned long long picos_per_pixel(unsigned w, unsigned h, unsigned hz) {
    unsigned long long per_second = (unsigned long long)w * h * hz;
    if (!per_second) return 0;
    unsigned long long whole_nanos = 1000000000ULL / per_second;
    return whole_nanos * 1000ULL;
}
```

```tests
#include <assert.h>
unsigned long long picos_per_pixel(unsigned, unsigned, unsigned);
int main(void) {
    assert(picos_per_pixel(3840, 2160, 120) == 1004ULL);
    assert(picos_per_pixel(1920, 1080, 60) == 8037ULL);
    assert(picos_per_pixel(3840, 2160, 60) == 2009ULL);
    return 0;
}
```

```solution
unsigned long long picos_per_pixel(unsigned w, unsigned h, unsigned hz) {
    unsigned long long per_second = (unsigned long long)w * h * hz;
    if (!per_second) return 0;
    return 1000000000000ULL / per_second;
}
```

## What overdraw does to the work

Write `fragments_per_second`, returning how many fragment shader runs a frame
needs per second, given the width, height, refresh rate and the overdraw factor
as a percentage.

An overdraw of 100 means each pixel is shaded once; 300 means three times.
Truncate towards zero.

@kind output
@concept Geometry is submitted before anything knows what will be visible, so
the work is a multiple of the pixel count rather than equal to it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The percentage divides at the end, after the multiplication, or the
factor is lost to integer division before it is applied.
@diagnose assert verdict assert-failed
A check disagrees. Dividing the overdraw percentage by 100 first turns 250 into
2 and loses a quarter of the work. Multiply first and divide last.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Three billion fragment shader runs a second, at an overdraw figure
nobody would call unusual.

```starter
unsigned long long fragments_per_second(unsigned w, unsigned h, unsigned hz,
                                        unsigned overdraw_pct) {
    unsigned long long px = (unsigned long long)w * h * hz;
    return px * (overdraw_pct / 100);
}
```

```tests
#include <assert.h>
unsigned long long fragments_per_second(unsigned, unsigned, unsigned, unsigned);
int main(void) {
    assert(fragments_per_second(3840, 2160, 120, 100) == 995328000ULL);
    assert(fragments_per_second(3840, 2160, 120, 300) == 2985984000ULL);
    /* Two and a half times, which a factor of 2 would lose. */
    assert(fragments_per_second(3840, 2160, 120, 250) == 2488320000ULL);
    assert(fragments_per_second(1920, 1080, 60, 400) == 497664000ULL);
    assert(fragments_per_second(3840, 2160, 120, 0) == 0ULL);
    return 0;
}
```

```solution
unsigned long long fragments_per_second(unsigned w, unsigned h, unsigned hz,
                                        unsigned overdraw_pct) {
    unsigned long long px = (unsigned long long)w * h * hz;
    return px * overdraw_pct / 100ULL;
}
```

## The arithmetic a shader asks for

Write `shading_ops`, returning how many arithmetic operations per second
fragment shading needs, given the fragments per second and the operations per
fragment.

Return the answer in millions, truncated, because the raw number is unwieldy and
the comparison people make is against a rate quoted in the same units.

@kind output
@concept Fragment shading alone, at a shader nobody would call expensive,
already asks for hundreds of billions of operations a second.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Multiply in the wide type, then divide by a million once.
@diagnose assert verdict assert-failed
A check disagrees. Dividing the fragment rate by a million before multiplying
throws away everything below a million fragments a second, and the error grows
with the operation count rather than staying fixed.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Six hundred thousand million operations a second is the modest case. A
serious lighting pass is five times that, before any vertex work or shadow map.

```starter
unsigned long long shading_ops(unsigned long long frags_per_sec,
                               unsigned ops_per_frag) {
    return (frags_per_sec / 1000000ULL) * ops_per_frag;
}
```

```tests
#include <assert.h>
unsigned long long shading_ops(unsigned long long, unsigned);
int main(void) {
    /* Three billion fragments at 200 operations each. */
    assert(shading_ops(2985984000ULL, 200) == 597196ULL);
    assert(shading_ops(2985984000ULL, 1000) == 2985984ULL);
    /* A rate that is not a whole number of millions. */
    assert(shading_ops(1500000ULL, 200) == 300ULL);
    assert(shading_ops(999999ULL, 1000000) == 999999ULL);
    assert(shading_ops(0ULL, 200) == 0ULL);
    return 0;
}
```

```solution
unsigned long long shading_ops(unsigned long long frags_per_sec,
                               unsigned ops_per_frag) {
    return frags_per_sec * ops_per_frag / 1000000ULL;
}
```

## What the output stage moves

Write `framebuffer_bytes_per_second`, returning how much framebuffer traffic a
frame rate produces, given the fragments per second and the bytes each fragment
reads and writes.

A fragment reads the depth, may write it, and writes a colour, so the figure is
around twelve bytes even before any blending.

@kind output
@concept This is the framebuffer alone, with no textures in it, and it is
already tens of gigabytes a second.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One multiplication, in a type wide enough to hold the answer.
@diagnose assert verdict assert-failed
A check disagrees. Thirty six thousand million bytes a second does not fit in
32 bits, so the product has to be computed in the wide type rather than widened
afterwards.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after That is why lossless compression of depth and colour is mandatory
hardware rather than a refinement, and why a phone sharing 30 to 70 gigabytes a
second with its processor needs a different architecture entirely.

```starter
unsigned long long framebuffer_bytes_per_second(unsigned long long frags,
                                                unsigned bytes_each) {
    unsigned total = (unsigned)frags * bytes_each;
    return total;
}
```

```tests
#include <assert.h>
unsigned long long framebuffer_bytes_per_second(unsigned long long, unsigned);
int main(void) {
    assert(framebuffer_bytes_per_second(2985984000ULL, 12) == 35831808000ULL);
    assert(framebuffer_bytes_per_second(995328000ULL, 12) == 11943936000ULL);
    assert(framebuffer_bytes_per_second(1000ULL, 4) == 4000ULL);
    assert(framebuffer_bytes_per_second(0ULL, 12) == 0ULL);
    return 0;
}
```

```solution
unsigned long long framebuffer_bytes_per_second(unsigned long long frags,
                                                unsigned bytes_each) {
    return frags * bytes_each;
}
```

## Cycles per pixel, on a processor

Write `cycles_per_pixel`, returning how many core cycles a processor has per
pixel, given the core count, the clock in megahertz, the display size and the
refresh rate.

Every core's cycles count, since the work is independent and can be spread
across all of them. Truncate towards zero.

@kind output
@concept The comparison that matters is not peak arithmetic. It is how much of
the machine's time each output gets.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Total cycles in one frame, divided by the pixels in one frame. The
refresh rate cancels if you work per second instead, which is easier.
@diagnose assert verdict assert-failed
A check disagrees. One core's cycles divided by the pixels gives five, and the
honest figure counts every core, which gives eighty. Both are small; only one is
the right answer to the question asked.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Eighty cycles per pixel, and twenty seven per fragment once overdraw is
counted. One filtered texture read costs more than that on its own.

```starter
unsigned long long cycles_per_pixel(unsigned cores, unsigned mhz,
                                    unsigned w, unsigned h, unsigned hz) {
    unsigned long long cycles = (unsigned long long)mhz * 1000000ULL;
    unsigned long long px = (unsigned long long)w * h * hz;
    return px ? cycles / px : 0;
}
```

```tests
#include <assert.h>
unsigned long long cycles_per_pixel(unsigned, unsigned, unsigned, unsigned,
                                    unsigned);
int main(void) {
    /* 16 cores at 5 GHz, 4K at 120 Hz. */
    assert(cycles_per_pixel(16, 5000, 3840, 2160, 120) == 80ULL);
    /* One core of the same machine. */
    assert(cycles_per_pixel(1, 5000, 3840, 2160, 120) == 5ULL);
    /* The same machine at 1080p60 has far more room. */
    assert(cycles_per_pixel(16, 5000, 1920, 1080, 60) == 643ULL);
    assert(cycles_per_pixel(16, 5000, 0, 1080, 60) == 0ULL);
    return 0;
}
```

```solution
unsigned long long cycles_per_pixel(unsigned cores, unsigned mhz,
                                    unsigned w, unsigned h, unsigned hz) {
    unsigned long long cycles = (unsigned long long)cores * mhz * 1000000ULL;
    unsigned long long px = (unsigned long long)w * h * hz;
    return px ? cycles / px : 0;
}
```

## Does one texture sample fit

Write `sample_fits`, deciding whether a filtered texture read fits inside the
per fragment cycle budget, given the budget and the cost of the read.

A filtered read is four dependent memory loads plus the blending between them.
Each load costs the given latency because it depends on the one before it, so
they do not overlap, and the blends cost their own cycles on top.

@kind output
@concept Dependent loads do not overlap, which is why four of them cost four
latencies rather than one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Four loads, each paying the full latency, and then the blend work.
@diagnose assert verdict assert-failed
A check disagrees. The four loads are dependent, so they serialise. Assuming
they overlap into a single latency makes a texture read look four times cheaper
than it is, which is exactly the mistake this unit exists to prevent.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after At twenty seven cycles per fragment and even an optimistic twenty cycle
cache hit, one sample is eighty cycles before the blending. A real shader asks
for eight.

```starter
int sample_fits(unsigned budget, unsigned load_latency, unsigned blend_cycles) {
    return load_latency + blend_cycles <= budget;
}
```

```tests
#include <assert.h>
int sample_fits(unsigned, unsigned, unsigned);
int main(void) {
    /* 27 cycles of budget, a 20 cycle hit, 3 cycles of blending. */
    assert(sample_fits(27, 20, 3) == 0);
    /* Even a 5 cycle load does not fit four times over plus blending. */
    assert(sample_fits(27, 5, 8) == 0);
    /* A generous budget does fit. */
    assert(sample_fits(200, 20, 3) == 1);
    assert(sample_fits(83, 20, 3) == 1);   /* exactly 80 plus 3 */
    assert(sample_fits(82, 20, 3) == 0);
    return 0;
}
```

```solution
int sample_fits(unsigned budget, unsigned load_latency, unsigned blend_cycles) {
    return 4 * load_latency + blend_cycles <= budget;
}
```

## Whether the frame lands on time

Write `frame_late_us`, returning how many microseconds late a frame is, given
the work it needs in millions of operations and the machine's rate in millions
of operations per second, and the refresh rate.

Return 0 when the frame fits in its budget. Truncate towards zero throughout.

@kind output
@concept Deadlined is the second property of this workload. A frame that
arrives late is not slower output; it is a stutter that somebody sees.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Work over rate gives seconds; the budget is one over the refresh rate.
Compare them in the same units and never report a negative lateness.
@diagnose assert verdict assert-failed
A check disagrees. A frame that finishes early is on time rather than negatively
late, and in an unsigned type the subtraction that says otherwise produces an
enormous number rather than a small one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Missing by a little is the whole problem: at 120 hertz a frame that takes
nine milliseconds instead of eight is not eleven percent worse, it is a dropped
frame.

```starter
unsigned long long frame_late_us(unsigned long long work_mops,
                                 unsigned long long rate_mops_per_sec,
                                 unsigned hz) {
    unsigned long long took = work_mops * 1000000ULL / rate_mops_per_sec;
    unsigned long long budget = 1000000ULL / hz;
    return took - budget;
}
```

```tests
#include <assert.h>
unsigned long long frame_late_us(unsigned long long, unsigned long long,
                                 unsigned);
int main(void) {
    /* 8333 us of budget at 120 Hz. 5000 million operations at 1,000,000
       million per second takes 5000 us: on time. */
    assert(frame_late_us(5000ULL, 1000000ULL, 120) == 0ULL);
    /* 10000 million takes 10000 us: 1667 late. */
    assert(frame_late_us(10000ULL, 1000000ULL, 120) == 1667ULL);
    /* Exactly on the budget is not late. */
    assert(frame_late_us(8333ULL, 1000000ULL, 120) == 0ULL);
    /* At 60 Hz the same work fits. */
    assert(frame_late_us(10000ULL, 1000000ULL, 60) == 0ULL);
    return 0;
}
```

```solution
unsigned long long frame_late_us(unsigned long long work_mops,
                                 unsigned long long rate_mops_per_sec,
                                 unsigned hz) {
    if (!rate_mops_per_sec || !hz) return 0;
    unsigned long long took = work_mops * 1000000ULL / rate_mops_per_sec;
    unsigned long long budget = 1000000ULL / hz;
    return took > budget ? took - budget : 0;
}
```
