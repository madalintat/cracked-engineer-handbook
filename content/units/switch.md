---
needs: []
minutes: 45
one_idea: The gate of a transistor is not connected to anything, and everything else follows from that.
sources: [transistors-cmos-fabrication]
---

Take the name apart, because it is a build instruction read from the top down.
**M-O-S-F-E-T**: metal, oxide, semiconductor, field effect transistor. A
conductor, on an insulator, on silicon.

The middle word is the one that matters. The gate sits on an insulator, so it is
not connected to the thing it controls. No current flows through it, ever. Every
convenient property of the logic in the rest of this handbook is a consequence
of that one structural fact, and so is one very inconvenient one.

## What is actually down there

Start with a slab of silicon doped to have spare positive carriers, called the
body. Diffuse two islands of the opposite doping into its surface, a short
distance apart, and call them the source and the drain. Grow a thin layer of
silicon dioxide over the gap. Lay a conductor on top of that.

```figure
{
  "kind": "blocks",
  "alt": "A cross-section of a MOSFET: a gate conductor on top of a thin oxide layer, above a channel region that lies between a source island and a drain island, all in a body of the opposite doping.",
  "caption": "The gate is the only part not touching the silicon. That gap is about a nanometre of glass, and it is the whole design.",
  "boxes": [
    { "id": "g",   "x": 2.5, "y": 0, "w": 5, "h": 1,  "label": "gate", "sub": "a conductor", "accent": "gold" },
    { "id": "ox",  "x": 2.5, "y": 1.3, "w": 5, "h": 0.7, "label": "oxide: an insulator, about 1 nm", "accent": "copper" },
    { "id": "src", "x": 0, "y": 2.3, "w": 2.4, "h": 1, "label": "source", "accent": "azure" },
    { "id": "ch",  "x": 2.5, "y": 2.3, "w": 5, "h": 1, "label": "channel region" },
    { "id": "drn", "x": 7.6, "y": 2.3, "w": 2.4, "h": 1, "label": "drain", "accent": "azure" },
    { "id": "body","x": 0, "y": 3.6, "w": 10, "h": 1, "label": "body, doped the other way" }
  ],
  "arrows": []
}
```

Now hold the gate at zero volts and try to push current from source to drain.
The path runs from one island, through the body, into the other island, and
those are two junctions back to back. Whichever direction you push, one of them
is blocking. No current. The switch is open.

Raise the gate voltage instead. The gate is a conductor above silicon separated
by an insulator, which is the definition of a capacitor, and its field reaches
through the oxide. It pushes the body's majority carriers away from the surface
and pulls the minority ones toward it. Push hard enough and the surface layer
stops behaving like the body it is made of and starts behaving like the islands
on either side. A bridge appears. Current flows.

The voltage at which the bridge forms has a name, the threshold voltage, and it
is written **V_th**. Below it the switch is open, above it the switch is closed,
and you closed it with a voltage rather than a finger.

## The switch is not a switch

Here is the sentence the rest of this part is about.

Below the threshold, the current does not stop. It falls off exponentially, and
how steeply it falls is called the subthreshold slope, measured in millivolts of
gate voltage per decade of current. Less slope is better: you want the current
to collapse the moment you drop below threshold.

```figure
{
  "kind": "plot",
  "alt": "Drain current against gate voltage on a logarithmic current axis, showing current falling by a decade for every sixty millivolts below the threshold rather than stopping.",
  "caption": "Gate voltage against current, with current on a log axis. Left of the threshold the line does not reach zero, it just keeps going down at a fixed number of millivolts per decade. That slope has a floor, and the floor is what ends Dennard scaling three units from here.",
  "x": { "label": "gate voltage (V)", "min": 0, "max": 1.0 },
  "y": { "label": "drain current (A)", "log": true, "min": 1e-12, "max": 1e-3 },
  "series": [
    { "label": "on", "accent": "gold",
      "points": [[0.0, 1e-11], [0.1, 4.6e-11], [0.2, 2.2e-10], [0.3, 1e-9],
                 [0.35, 2.2e-9], [0.4, 4.6e-9], [0.45, 1.5e-8],
                 [0.5, 2e-7], [0.6, 1.2e-5], [0.7, 8e-5], [0.85, 3e-4], [1.0, 6e-4]] }
  ],
  "marks": [ { "x": 0.45, "label": "V_th" } ]
}
```

The slope has a hard floor, and the floor is not an engineering shortfall that
better manufacturing will fix. It is thermal energy divided by charge, times the
natural log of ten, and at room temperature it works out to about 60 millivolts
per decade. You will compute that number from physical constants in the first
exercise, because it is worth watching it fall out of `k`, `T` and `q` rather
than taking it on trust.

Two consequences follow immediately, and the second one is the whole problem.

Lowering the threshold makes the switch faster, because what makes a transistor
drive current is how far the gate voltage exceeds the threshold. But lowering
the threshold also raises the leakage, exponentially. At 60 millivolts per
decade, taking 100 millivolts off the threshold multiplies the off-current by
about 46.

Now multiply that by the number of transistors on a chip, and note that it is
being spent whether or not the chip is doing anything at all.

There is a loop hiding in that, and it is worth seeing now because it explains
a class of failure later. Leakage rises with temperature, because the floor on
the subthreshold slope is proportional to temperature. Leakage is power, and
power is heat. So a chip that gets hotter leaks more, and leaking more makes it
hotter. Within the range a package can cool, the loop settles. Outside it, the
loop does not settle, and the part destroys itself.

That is why the responses to leakage have been structural rather than
incremental. When the oxide reached about a nanometre, roughly five atoms thick,
electrons began tunnelling straight through the insulator, and the fix was a
physically thicker layer of a different material with a higher dielectric
constant, which gives the same capacitance with far less tunnelling. The fin,
and then the gate wrapped entirely around the channel, are the same kind of
answer: give the gate more grip on the channel so the transistor turns off
properly. Every one of those is a leakage fix first and a speed improvement
second, which is the opposite of how they are usually described.

## Two flavours, and neither is symmetric

Everything above described a transistor that turns on when its gate goes high.
Swap the dopings and you get one that turns on when its gate goes low. The names
are NMOS and PMOS, and PMOS is drawn with a bubble on the gate to say so.

They are not mirror images, and the asymmetries decide the shape of everything
built from them.

**Each one passes one level well and the other badly.** An NMOS transistor
carries a low cleanly, and struggles to carry a high: as the output rises toward
the supply, the gate-to-source voltage falls, and somewhere short of the top the
transistor turns itself off. It delivers a high that is short by a threshold.
PMOS has the mirror problem with lows.

So pull-down networks are built from NMOS and pull-up networks from PMOS, and
never the other way round. That is not a convention. It is the transistor
refusing.

**One of them is intrinsically slower.** Carriers in a PMOS channel move more
slowly than in an NMOS one, by a factor of two or three. To get the same drive
you make the PMOS wider, and a wider transistor presents more capacitance to
whatever drives it. So a design that puts PMOS transistors in series pays twice:
once in speed and once in load.

Hold that. It is the reason the next unit finds that NAND is cheap and AND is
expensive, and the reason the part after that builds everything from NAND.

## The gate is a capacitor, and capacitors cost

The insulator that makes the gate free to hold at a voltage is exactly what
makes it expensive to change one.

Charging a capacitor to a voltage and discharging it again moves a charge of
`C·V` through a drop of `V`, so every full switch costs about `C·V²` of energy
delivered from the supply. Not per second: per switch. A gate of one femtofarad
at one volt costs a femtojoule per transition, which sounds like nothing until
you multiply it by billions of transistors and billions of cycles a second.

That product is the whole subject of unit 3, and the `V²` in it is why the story
turns in 2005.

## What to carry into the next unit

Three things, and you will use all three within two units.

The gate draws no current, which means one gate can drive another with no
static cost, and that is what makes a chain of logic possible at all.

The switch leaks, exponentially, and the exponent has a floor set by
temperature rather than by manufacturing.

And the two flavours are asymmetric in a way that makes inverting cheap and
not-inverting expensive.

The next unit takes two transistors, wires one of each flavour into a
complementary pair, and gets an inverter for four transistors' worth of area and
almost no static power. Then it counts what NAND costs, counts what AND costs,
and finds the answer this handbook is built on.

## Reading the errors you are about to see

The exercises here are arithmetic on the physics, written in C and compiled by a
real compiler. They are not simulations of a transistor; they are the equations
that describe one, evaluated so you can watch the numbers move.

The failures are ordinary C failures. A compile error names a file and a line.
A wrong answer exits nonzero and the check prints what it wanted and what it
got. Where an exercise turns on floating-point behaviour, it says so, and the
comparison is written with a tolerance rather than with `==`.
