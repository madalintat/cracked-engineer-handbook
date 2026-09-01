---
needs: [feedback]
minutes: 50
one_idea: A bus works because exactly one thing drives it at a time, and a clock cycle is the agreement about when that is true.
sources: [nand2tetris-eater-scott, digital-design-hdl-fpga]
---

You have registers. A machine needs several of them talking to each other, and
the obvious way to wire that is the way that does not work.

## The wiring that shorts

Take two registers and connect both of their outputs to the same wire, so that
either can send a value to whatever is listening. It looks reasonable and it is
a short circuit.

Each output is a CMOS gate from unit 002, which means a pull-up network to the
supply and a pull-down network to ground, with exactly one of them conducting.
If one register is driving high and the other is driving low, the wire now has a
path from the supply straight to ground through two gates. That is the crowbar
current from Part I, and it destroys the parts.

So a shared wire needs something the gate from unit 002 cannot do: a way to be
connected to neither rail.

## The third state

A tri-state buffer has a data input, an output, and an enable. When the enable
is high it passes its input through as an ordinary gate would. When the enable
is low it disconnects: both networks off, output attached to nothing.

That state has a name, high impedance, and what matters about it is the thing
people assume wrongly. **It is not logic 0.** A wire at high impedance is not
low, it is electrically absent, and something else on the wire is free to drive
it without a fight.

Now several devices can share one wire, and the whole design rests on one rule.

**Exactly one output is ever enabled at once.**

Not usually one. Not one in the normal case. If two are ever enabled at the same
moment, even briefly during a transition, the wire is a short. Ben Eater's
machine has one enable bit per module in its control word, and the thing that
makes it safe is that the control sequence never sets two of them.

That is why a bus is a discipline rather than a component. The wire is just a
wire, and the correctness lives in the rule about who is allowed to drive it.

## What you can build without it

The simulator in this part has no tri-state, because it has no concept of a wire
being absent: every wire has a value. So the exercises build the other
arrangement, which is what you would use inside a chip anyway.

A multiplexer with as many inputs as there are sources does the same job. Each
source is wired to one input, the select lines choose which one reaches the
output, and there is no possibility of two drivers because there is only ever
one wire being read.

```figure
{
  "kind": "blocks",
  "alt": "Two ways to share one wire: three tri-state buffers driving a common line with one enable each, and a three-way multiplexer selecting between the same three sources.",
  "caption": "The same job twice. On a board, three drivers and a rule that only one may be on. Inside a chip, a multiplexer, where the rule is enforced by there being nowhere for a second driver to connect.",
  "boxes": [
    { "id": "a1", "x": 0, "y": 0,   "w": 2.4, "h": 1, "label": "reg A", "accent": "azure" },
    { "id": "b1", "x": 0, "y": 1.3, "w": 2.4, "h": 1, "label": "reg B", "accent": "azure" },
    { "id": "c1", "x": 0, "y": 2.6, "w": 2.4, "h": 1, "label": "reg C", "accent": "azure" },
    { "id": "bus","x": 3.6, "y": 1.3, "w": 2.4, "h": 1, "label": "one wire", "sub": "one enable at a time", "accent": "clay" },
    { "id": "a2", "x": 7.4, "y": 0,   "w": 2.4, "h": 1, "label": "reg A", "accent": "azure" },
    { "id": "b2", "x": 7.4, "y": 1.3, "w": 2.4, "h": 1, "label": "reg B", "accent": "azure" },
    { "id": "c2", "x": 7.4, "y": 2.6, "w": 2.4, "h": 1, "label": "reg C", "accent": "azure" },
    { "id": "mux","x": 11, "y": 1.3, "w": 2.4, "h": 1, "label": "mux", "sub": "select chooses", "accent": "jade" }
  ],
  "arrows": [
    { "from": "a1", "to": "bus" },
    { "from": "b1", "to": "bus" },
    { "from": "c1", "to": "bus" },
    { "from": "a2", "to": "mux" },
    { "from": "b2", "to": "mux" },
    { "from": "c2", "to": "mux" }
  ]
}
```

Both are real and they are used in different places. Between chips on a board,
where the wire is long and you cannot run one per source, tri-state. Inside a
chip, where wires are cheap and a short is fatal, a multiplexer. Modern chips use
multiplexers almost everywhere for exactly that reason.

## The other rule, about time

Enabling one register onto a bus and loading another from it is a transfer, and
the order of two events in that transfer is not optional.

The source is enabled, the wire settles to its value, the destination captures
it, and then the source stops driving. Getting that order wrong is the second
classic bus fault: if the destination is still capturing while the source has
already let go, it captures whatever the wire drifted to.

Scott states the requirement before giving the mechanism, which is the right way
round: the destination's capture must finish before the source's enable goes
away. The mechanism is two derived clocks, one narrow pulse nested inside a
wider one, so that the capture window sits strictly inside the driving window.

You do not need the derivation to take the point. **The enable is wide and the
capture is narrow, and the narrow one lives inside the wide one.** Every bus
transfer in every machine has that shape.

## Where the clock comes from

One aside, because the clock has been treated as given for two units and it is
worth knowing what produces it.

A clock is an oscillator, and the cheap way to build one is a circuit with no
stable state: an arrangement that, whatever it settles to, immediately has to
leave. An odd number of inverters in a ring does it. Each one flips its
neighbour, the loop never agrees with itself, and the output oscillates at a
frequency set by the propagation delay round the ring.

That is a real construction and it is used on real chips to measure how fast a
process is running, which is a nice inversion: a circuit whose whole purpose is
to be unstable is used as a ruler.

For a machine you want a frequency that does not drift with temperature, so the
clock comes from a crystal instead. The relevant point for this part is that the
same physical component can be arranged three ways: as an oscillator with no
stable state, as a one-shot that emits a single pulse when poked, and as a latch
with two stable states. Ben Eater's clock module builds all three from one chip,
and the middle one exists for a reason worth knowing.

A pushbutton does not produce one clean edge. The contacts bounce, mechanically,
for a few milliseconds, and a naive wiring gives a burst of edges per press. A
processor stepped by that button would run several instructions for one press
and look haunted. The one-shot is there to turn a messy press into a single
pulse, and every physical button attached to logic anywhere has something doing
that job.

## What a clock cycle actually promises

Now the sentence this unit is named for.

A clock cycle is a contract about when signals are allowed to be garbage.
Between edges, every wire in the machine is free to be wrong: carries are
rippling, multiplexers are switching, and a bus is settling. None of it means
anything yet. At the edge, everything that is going to be captured must have
settled, and after the edge it may go back to being wrong.

Choosing the cycle length is choosing how much wrongness you are willing to wait
out. It has to exceed the longest path from any flip-flop's output, through
whatever logic, to any flip-flop's input. That path has a name in Part III,
where a tool measures it for you and refuses to sign off a design whose clock is
too fast for it.

Two consequences worth carrying.

Every operation costs the same, because every operation waits for the slowest
one. Adding a faster instruction to a machine buys nothing unless the slow path
gets shorter too.

And a machine can be made faster by shortening the longest path rather than by
adding anything. That is what pipelining does, five parts from here: it does not
make the work smaller, it cuts the path into shorter pieces with flip-flops
between them.

## What to carry into the next unit

One wire can serve every module, and it works because of a rule rather than a
mechanism: exactly one driver at a time, with the capture window nested inside
the driving window.

A clock cycle is permission to be wrong in between, and its length is set by the
worst path in the design.

The next unit puts storage behind an address. You have registers, you have a way
to move values between them, and you have a decoder from unit 006. A memory is
those three things arranged so that one of many registers is selected by a
number, and the counter you already built becomes a program counter as soon as
you give it a way to be loaded rather than incremented.

## Reading the errors you are about to see

Several of these are traces again, and the interesting cycles are the ones where
a control signal changes. Read what the design held coming into the cycle, then
what the controls said during it, then what it holds on the next one.

One exercise asks you to build a checker rather than a circuit that does work,
and its output is 1 when the design is safe. That is not a strange thing to
build: a real design has assertions exactly like it, and Part III runs them
during synthesis rather than during simulation.
