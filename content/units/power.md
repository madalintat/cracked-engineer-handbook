---
needs: [switch, cmos-gate]
minutes: 55
one_idea: Voltage stopped falling in 2005, and every structural change in computing since is a consequence of that one number refusing to move.
sources: [transistors-cmos-fabrication, cpu-architectures]
---

For about thirty years the correct engineering response to "this program is too
slow" was to wait. Not to profile it, not to rewrite it, not to parallelise it.
Wait eighteen months and buy the next machine, and the same binary, unmodified
and unrecompiled, would run about forty per cent faster.

That stopped, in a specific year, for a reason you can compute from the last two
units. This is the unit where it stops.

## What a chip spends

Two terms, and the last unit gave you both.

Dynamic power is the cost of switching. Every transition charges or discharges a
capacitance through the supply, at `C·V²` a time, so multiply by how often it
happens:

```
P = alpha * C * V^2 * f
```

The activity factor `alpha` is how often an average node switches per clock,
usually somewhere between 0.05 and 0.3. A clock line is 1 by definition, which
is why the clock network is one of the largest single power consumers on a chip.
`C` is the capacitance being switched, and at modern geometries most of it is
wire rather than transistor, so interconnect sets power rather than devices do.
`f` is the clock, linearly.

And `V` is squared. Everything hinges on that.

Static power is the cost of existing. It is the leakage from the last unit,
every transistor, all the time, whether the chip is doing anything or not.

## The bargain that held for thirty years

In 1974 Robert Dennard and colleagues published the rule. Scale every dimension
down by the same factor, scale the supply voltage down by that factor too, and
raise the doping to match. Do all three and the electric field inside the device
is unchanged, which is why it is called constant-field scaling.

Work through what that gives you per generation, with each dimension multiplied
by 0.7:

```
area per device      x 0.49      twice as many devices in the same space
capacitance          x 0.7
supply voltage       x 0.7
gate delay           x 0.7       so frequency  x 1.4
power per device     x 0.49      because C falls and V is squared
power per area       x 1.0       unchanged
```

Read the last line again, because that line is the twentieth-century computing
industry. Twice the transistors, each running 1.4 times faster, and the same
watts per square millimetre. Not performance you could buy with a better cooler.
Free.

It is worth separating two things that get said together. Moore's law is an
observation about transistor counts doubling. Dennard scaling is what gave you
permission to switch them all on. They are different claims, and only one of
them ended.

## The chain that broke it

Every link here is forced by the one before it, and the third link is the floor
you computed in unit 1.

The supply voltage has to fall by 0.7 per generation for constant-field scaling
to hold. For gates to stay fast as it falls, the threshold voltage has to fall
with it, because what sets drive current is the overdrive, the amount by which
the supply exceeds the threshold. But leakage is exponential in the threshold
voltage, with a hard floor of about 60 millivolts per decade set by temperature.
So the threshold could not keep falling: below roughly 0.3 volts, the leakage
from a billion off transistors becomes comparable to the whole chip's dynamic
power.

So the threshold stopped falling, so the supply stopped falling. It stalled
around 0.9 to 1.0 volts and has essentially stayed there for twenty years.
Compare five volts in the 1980s, 3.3 in the mid-90s, 1.8 in 1999.

Dimensions kept shrinking. Transistor counts kept doubling. And with the voltage
frozen, the last row of that table stops reading 1.0.

```figure
{
  "kind": "plot",
  "alt": "Power density across five process generations, flat at one under Dennard scaling and rising to thirty-five times when the supply voltage is frozen.",
  "caption": "The same five generations of shrinking, with and without the voltage falling. Under Dennard the lower line is flat for thirty years. With the voltage frozen the upper line reaches 35 times, and nothing can dissipate 35 times more watts per square millimetre.",
  "x": { "label": "process generations of 0.7x shrink", "min": 0, "max": 5 },
  "y": { "label": "power per square millimetre", "log": true, "min": 0.5, "max": 50 },
  "series": [
    { "label": "voltage frozen", "accent": "clay",
      "points": [[0, 1], [1, 2.04], [2, 4.16], [3, 8.5], [4, 17.3], [5, 35.4]] },
    { "label": "Dennard", "accent": "jade",
      "points": [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]] }
  ]
}
```

A chip already running near 100 watts per square centimetre is comparable to a
hotplate. Thirty-five times that is a rocket nozzle. Getting heat out of a
package became the binding constraint on computing, and it has stayed the
binding constraint ever since.

## What happened next, in order

**The frequency wall.** Clock speeds had climbed exponentially: 33 megahertz in
1990, one gigahertz in 2000, and Intel's public roadmap projected ten gigahertz
by the middle of that decade. Instead Intel cancelled the four gigahertz Pentium
4 in October 2004 and killed its successors, citing power. Since 2005 clock
frequency has sat between four and six gigahertz.

Twenty years. Nothing else in the history of computing has been flat for twenty
years.

**Multicore.** If one core cannot go faster, spend the transistors on more of
them. This is not only a consolation prize, and the arithmetic is worth
following. Lowering the voltage lowers the achievable frequency too, so in
practice the two move together and power goes roughly as the cube of either. Two
cores at 0.75 of the frequency deliver 1.5 times the throughput for less power
than one core at full speed.

That is the moment the story stops being about hardware. Concurrency stopped
being a specialist skill and became table stakes, Amdahl's law started mattering
to ordinary programmers, and "wait for next year's machine" stopped being an
answer. Every thread pool and async runtime you have ever used is downstream of
subthreshold leakage having a floor.

**Then accelerators.** Multicore hit its own limits, and a general-purpose core
spends most of its transistors and most of its power on control rather than
arithmetic: branch prediction, reordering, scheduling. If power is the budget,
the winning move is to spend it on arithmetic instead. That gives three moves,
and this handbook spends its second half on all three.

Share one instruction stream across many simple lanes, so the cost of fetching
and decoding is amortised across 32 of them. Build fixed-function units for the
operation that dominates, because a matrix multiply unit does the same work for
one to two orders of magnitude less energy than a general-purpose core, having
no instruction fetch or scheduling to pay for. And carry fewer bits, because
energy per multiply falls roughly with the square of the mantissa width and data
movement falls linearly with it.

The straight line runs: leakage floor, voltage wall, multicore, throughput
cores, tensor cores, four-bit arithmetic. Every step is the same move made
again. When you cannot have more watts, buy more useful work per watt by
specialising.

**Dark silicon.** The terminal form. Transistors keep arriving and the power
budget does not grow, so a growing fraction of the chip has to be switched off
at any moment. The 2011 paper that named it projected that at 8 nm, between half
and four fifths of a chip may be dark.

Once you accept that, something inverts. Area becomes cheap and power becomes
expensive, which is the reverse of fifty years of instinct. If most of the chip
is off anyway, fill it with specialised units and light up whichever one suits
the work in front of you. That is exactly what a phone chip is: processor cores,
a graphics unit, a neural unit, an image processor, video encoders, a signal
processor, cryptography. A drawer of tools, most of them idle.

Dark silicon is why your phone chip is a zoo.

## What to carry forward

The constraint has been power for twenty years, and only the length scale
changes. Transistor, then die, then package, then rack, and now the substation
next to the datacenter.

When a later unit explains why a GPU has thousands of simple cores rather than a
few clever ones, why a tensor core exists, or why anyone would train a model in
four-bit floating point, the answer is always this unit. Not because those are
elegant ideas, but because watts ran out and the only remaining move was to buy
more work per watt.

The next unit is the other half of the story. Power says how much of a chip you
can switch on. Manufacturing says how large a chip you can make at all, and the
answer turns out to be a hard limit rather than a matter of expense.

## Reading the errors you are about to see

The exercises are the arithmetic of this unit, in C, checked by a real compiler.
You will compute the Dennard table, watch it break when the voltage is held
fixed, and work out how many cores at what frequency fit inside a fixed power
budget.

A wrong answer exits nonzero and prints what it wanted beside what it got. Two
of these involve a ratio that is easy to invert, so read which way round the
check states it before assuming the arithmetic is wrong.
