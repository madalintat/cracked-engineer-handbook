---
needs: [power]
minutes: 50
one_idea: Yield falls exponentially with die area, so a big chip is not expensive, it is impossible, and everything about how modern chips are packaged follows from that.
sources: [transistors-cmos-fabrication, nvidia-architectures]
---

The last unit ended with a limit on how much of a chip you can switch on. This
one is about a limit on how large a chip you can make at all, and it is the
harder of the two, because no amount of money moves it.

A modern processor is built by repeating a loop a few hundred times: deposit a
layer, coat it in a light-sensitive resist, project a pattern onto it, develop
away what the light touched, etch, strip, repeat. Everything that follows comes
from one property of that loop. Occasionally it goes wrong in one spot, and when
it does, the die containing that spot is dead.

## The one equation

Defects arrive at some rate per unit area, call it `D`, and a die of area `A`
survives if none of them lands on it. If defects were independent and uniformly
scattered, the fraction of dies that survive would be a straightforward
exponential:

```
Y = exp(-D * A)
```

Read the shape rather than the formula. Yield falls exponentially with area. Not
linearly, not with some awkward power: exponentially. Doubling the die does not
halve the yield, it squares it.

That single fact decides the physical form of every large chip made today.

Real defects are not uniformly scattered, though, and the models that account
for clustering are worth knowing because they disagree with each other by a lot
at large areas. There are four in common use and you will implement all of them.

## Which model is right, settled by measurement

TSMC published two points for its 5 nm process during the ramp. A die of 17.92
square millimetres yielded about 80 per cent, and a die of 100 square
millimetres yielded 32 per cent.

Two points is enough to do something better than argue. Fit each model to the
first point, use the fitted defect density to predict the second, and see which
one lands.

```
model         fitted D        predicts Y(100 mm^2)    actual
Poisson       1.245 /cm^2     28.8%                   32%
Murphy        1.269 /cm^2     32.1%                   32%
Seeds         1.395 /cm^2     41.8%                   32%
negative binomial (a=3)       34.1%                   32%
```

Murphy's model reproduces the published number to within a tenth of a
percentage point. That is not a small thing: it means a two-parameter model of
where dust lands predicts a manufacturing outcome to three significant figures,
and it is why Murphy is what the industry actually uses. You will fit these
yourself in the exercises, and the discovery is the point.

## What that predicts for a big chip

Take Murphy with the defect density fitted above and walk the area up.

```figure
{
  "kind": "plot",
  "alt": "Yield against die area under Murphy's model, falling from about eighty per cent at twenty square millimetres to under one per cent at the reticle limit.",
  "caption": "Yield against die area, using the defect density fitted to TSMC's own published 5 nm points. At the reticle limit, the largest a single exposure can print, fewer than one die in a hundred works.",
  "x": { "label": "die area (mm^2)", "min": 0, "max": 858 },
  "y": { "label": "yield", "log": true, "min": 0.005, "max": 1 },
  "series": [
    { "label": "Murphy", "accent": "clay",
      "points": [[18, 0.80], [50, 0.548], [100, 0.321], [200, 0.132],
                 [400, 0.038], [600, 0.017], [800, 0.010], [858, 0.008]] }
  ],
  "marks": [ { "x": 858, "label": "reticle limit" } ]
}
```

At the reticle limit, which is the largest area a single exposure can print, the
yield is under one per cent on a new process. So a chip with two hundred billion
transistors cannot be one piece of silicon. Not "would be expensive". Could not
be manufactured.

That is where chiplets come from, and it is why a modern high-end part is
several smaller dies packaged together rather than one large one. Four dies of
200 square millimetres yield 13 per cent each; the same area as one monolithic
800 would yield 1 per cent. The packaging is not free and the interconnect
between dies costs power and latency, and it is still overwhelmingly the better
trade.

## How the pattern gets there at all

It is worth one section on the printing itself, because the difficulty explains
both why the defect density is what it is and why there are three companies in
the world doing this.

The pattern is projected optically, and the smallest feature you can print
scales with the wavelength of the light. Modern processes use extreme
ultraviolet at 13.5 nanometres, which is a fourteenfold jump down in one step
and comes with a problem: nothing transmits it.

There is no laser at that wavelength either. The light is made by firing tin
droplets across a vacuum chamber fifty thousand times a second and hitting each
one with two pulses from a carbon dioxide laser: the first flattens the droplet,
the second vaporises it into a plasma at half a million kelvin, and the plasma
radiates at 13.5 nanometres.

Because every material absorbs it, there are no lenses. The whole optical path
is in vacuum and every element is a mirror, built from forty or fifty
alternating layers a few nanometres thick, arranged so their reflections add in
phase. Even so, each mirror returns about 70 per cent of what arrives. With
eight of them in the path, roughly 96 per cent of the light generated never
reaches the wafer, which is why the source has to produce hundreds of watts to
deliver a few.

The mask is a mirror too, which forces the light to arrive at an angle, which
introduces its own distortions to correct.

None of that is a digression. It is why a step in the loop occasionally goes
wrong, and the rest of this unit is about what happens when it does.

## The number in the marketing is not a length

Until roughly the 1990s a node name meant something measurable: the gate length,
or half the minimum metal pitch. "180 nanometres" meant a gate of about 180
nanometres, and the name tracked the physics.

They came apart. Today the name is a marketing label for a generation, and no
dimension on a modern "3 nm" chip is three nanometres. Different manufacturers'
numbers are not comparable with each other, and a given manufacturer's numbers
are not comparable across time either.

What you can compare is transistor density, which is measurable, and the numbers
that actually matter to a design: how much area a standard cell takes, how much
current a transistor drives, and how much it leaks. When a later unit compares
two architectures, it compares those, and it does not compare node names.

## Not every broken die is scrap

A die with a defect in one core is not a dead die. It is a cheaper product.

Binning sorts working dies by measured speed, power and how much of them
functions, and sells them as different things. A sixteen-core design with two
bad cores becomes a twelve-core part with the failures fused off. A die that
reaches its target frequency at a low voltage becomes the premium part, and one
that needs more voltage becomes the cheaper one.

This is not a rare salvage operation, it is the shape of the product line. The
consumer ladder is often not several designs but one design and a test result.
And it is visible in specifications if you know to look: a flagship graphics die
with 192 processing units ships with 170 enabled, and a datacenter part with 144
ships 132. Those disabled units are yield harvesting, printed on the box.

It also means that yield is the wrong single number to care about. What matters
is the distribution of dies across bins weighted by what each bin sells for, and
the marginal cost of the lowest bin is close to zero, which is exactly why cheap
parts exist at all.

## Why a new process gets cheaper without changing

The defect density fitted above, about 1.27 per square centimetre, is an early
number for a process that has just started running. A mature process reaches
0.05 to 0.2. That is a factor of ten or more, and yield is exponential in it.

So the same design, on the same process, with no change whatsoever, yields far
better two years in than at launch. That improvement is most of why chips get
cheaper over their lifetime, and it is why the first parts on a new node are
small ones: a manufacturer ramps a process on dies it can afford to throw away.

## What to carry into Part II

Two limits, from two units. Power says how much of a chip you can switch on at
once. Yield says how large you can make it. Both are exponential, neither is
negotiable, and between them they explain the physical shape of everything you
will meet later: many small cores rather than one large one, several dies rather
than one, and specialised units that sit idle most of the time.

Part II leaves the physics behind and starts building. It takes the gate the
last unit said you get for free, treats it as the only thing you are allowed to
use, and constructs arithmetic, memory and a working processor from it. Nothing
in that part mentions a transistor again.

But when a design there costs two gates rather than one, this is the part of the
book that says what that costs. And when Part XVI asks why a graphics processor
looks the way it does, the answer is in these four units rather than in anything
about graphics.

## Reading the errors you are about to see

The exercises implement the four yield models, fit them to real published data,
and work out the arithmetic of dies on a wafer. They are ordinary C, checked by
a real compiler.

Two of them involve fitting, so they iterate. Where a check compares floating
point it uses a tolerance, and the tolerance is stated in the failure message
along with what was wanted, so a near miss reads as a near miss rather than as a
mystery.
