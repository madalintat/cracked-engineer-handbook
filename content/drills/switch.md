## What does the oxide in a MOSFET do?

- [x] It insulates the gate from the silicon, so no current flows through the gate
- [ ] It conducts current from the gate into the channel
- [ ] It protects the silicon from contamination during manufacture
- [ ] It sets the threshold voltage

@why The gate is not connected to what it controls. That is the structural fact
every convenient property of CMOS logic follows from, and it is why one gate can
drive another at no static cost.

## With the gate at zero volts, why does no current flow from source to drain?

- [ ] The channel has too much resistance
- [x] The path crosses two junctions back to back, and one of them blocks
      whichever way you push
- [ ] The oxide blocks it
- [ ] The source and drain are not connected to anything

@why Two islands of one doping in a body of the other make two junctions in
series facing opposite ways. There is no direction you can push that both will
allow.

## What is the threshold voltage?

- [x] The gate voltage at which the surface of the body inverts and a channel forms
- [ ] The maximum voltage the gate can take before the oxide breaks down
- [ ] The voltage across the channel when the transistor is on
- [ ] The supply voltage of the circuit

@why Below it, no bridge. Above it, a bridge. It is the voltage at which the
gate's field has pulled enough minority carriers to the surface that the surface
behaves like the islands on either side of it.

## Below the threshold voltage, the drain current is:

- [ ] Exactly zero
- [x] Small and falling exponentially, never reaching zero
- [ ] Constant at a small value set by the process
- [ ] Rising, but too slowly to matter

@why This is the whole difficulty. The switch does not open, it becomes very
resistive, and how quickly it does that is measured in millivolts of gate
voltage per decade of current.

## What sets the floor on the subthreshold slope?

- [x] Thermal energy divided by charge, so it is physics rather than
      manufacturing
- [ ] The thickness of the gate oxide
- [ ] The purity of the silicon
- [ ] The width of the transistor

@why It is `kT/q` times the natural log of ten, about 60 millivolts per decade
at room temperature. No process improvement moves it, which is why the responses
have all been structural.

## At 60 mV per decade, lowering the threshold by 100 mV multiplies off-current by roughly:

- [ ] 1.7
- [ ] 10
- [x] 46
- [ ] 100

@why A hundred divided by sixty is 1.67 decades, and ten to that is about 46.
Computing this is the second exercise, and the number is why lowering the supply
voltage stopped being possible.

## An NMOS transistor passes which level cleanly?

- [x] A low
- [ ] A high
- [ ] Both equally
- [ ] Neither, without a pull-up resistor

@why Trying to pass a high, its source terminal rises with the output, so its
own gate-to-source voltage falls, and it shuts itself off a threshold short of
the supply.

## Why are pull-up networks built from PMOS rather than NMOS?

- [ ] PMOS is faster
- [ ] It is a convention inherited from older logic families
- [x] An NMOS pull-up cannot deliver a full high, because it turns itself off
      on the way up
- [ ] PMOS uses less area

@why It is the transistor refusing rather than a designer choosing. PMOS is in
fact the slower of the two, and it is used for pull-up anyway because it is the
one that can finish the job.

## Why must a PMOS transistor be made wider than an NMOS one for the same drive?

- [x] Its carriers move more slowly, so it needs more width to pass the same current
- [ ] It has a higher threshold voltage
- [ ] Its oxide is thicker
- [ ] To balance the layout visually

@why And a wider transistor presents more capacitance to whatever drives it, so
stacking PMOS in series costs twice: once in speed and once in load. That is the
fact that makes NAND cheap and AND expensive.

## Charging a gate capacitance to V and discharging it again takes about:

- [ ] `C*V`
- [x] `C*V*V`
- [ ] `C*V*V/2`
- [ ] `V*V/C`

@why The supply moves a charge of `C*V` through a drop of `V`. Half of that ends
up stored in the capacitor and the other half is dissipated in the transistor
doing the charging, which is why the stored energy is half the delivered energy.

## Why did gate oxide tunnelling force a change of material?

- [x] At about a nanometre the insulator was five atoms thick and electrons
      passed straight through it
- [ ] Silicon dioxide melts at the temperatures modern chips reach
- [ ] Thinner oxide made the threshold voltage unstable
- [ ] The material was too expensive at scale

@why A physically thicker layer of a higher dielectric constant gives the same
capacitance with far less tunnelling. The switch to hafnium oxide with a metal
gate is a leakage fix, not a speed improvement.

## The fin, and later the gate wrapped around the channel, exist mainly to:

- [ ] Increase drive current
- [x] Give the gate more control of the channel so the transistor turns off properly
- [ ] Reduce manufacturing cost
- [ ] Allow higher supply voltages

@why All of the structural changes since 45 nm are about restoring electrostatic
control. They improve speed as a side effect and they were adopted because
transistors had stopped switching off.

## Leakage and temperature interact how?

- [x] Leakage rises with temperature, and leakage is power, which raises
      temperature further
- [ ] Leakage falls with temperature as carriers scatter more
- [ ] They are independent
- [ ] Leakage rises only above the rated junction temperature

@why It is a feedback loop. Within what the package can remove it settles at
some temperature. Outside that, it does not settle.

## First-order, the propagation delay of a gate is proportional to:

- [ ] Its width
- [x] Its on-resistance times the capacitance it drives
- [ ] The supply voltage
- [ ] The number of inputs it has

@why About `ln(2)` times `R` times `C`, to the halfway point. Making a
transistor wider lowers its resistance and raises the capacitance it presents,
so speed moves from this gate to the one driving it.

## Static power is different from dynamic power because:

- [ ] It is larger
- [x] It is spent whether or not the chip is doing any work
- [ ] It depends on the clock frequency
- [ ] It only occurs during transitions

@why Dynamic power is paid per transition and stops when the clock stops. Static
power is the leakage of every transistor all the time, which is why a chip that
is idle still has to be cooled.
