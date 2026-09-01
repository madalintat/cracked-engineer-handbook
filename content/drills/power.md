## In `P = alpha * C * V^2 * f`, which term is squared?

- [x] The supply voltage
- [ ] The capacitance
- [ ] The frequency
- [ ] The activity factor

@why That square is why voltage was the lever everyone pulled, and why the
voltage refusing to fall further is the event this whole unit is about.

## What is the activity factor?

- [x] How often an average node switches per clock cycle
- [ ] The fraction of the chip that is powered on
- [ ] The ratio of dynamic to static power
- [ ] The clock duty cycle

@why Usually between 0.05 and 0.3 for data nodes. A clock line is 1 by
definition, because it switches every cycle, which is why the clock network is
often the largest single consumer on a chip.

## At modern geometries, most switched capacitance is:

- [x] Wire rather than transistor
- [ ] Transistor gate capacitance
- [ ] Junction capacitance
- [ ] Package capacitance

@why Which is why interconnect sets power rather than devices do, and why moving
data is the expensive operation rather than computing on it.

## What does Dennard scaling hold constant?

- [x] The electric field inside the device, and therefore power per unit area
- [ ] The transistor count
- [ ] The clock frequency
- [ ] The supply voltage

@why Scale every dimension and the supply by the same factor and raise the
doping to match, and the field is unchanged. Hence its other name,
constant-field scaling.

## Moore's law and Dennard scaling are:

- [x] Different claims, and only one of them ended
- [ ] Two names for the same observation
- [ ] Both about transistor counts
- [ ] Both about power density

@why Moore's law is an observation about transistor counts doubling. Dennard
scaling is what gave you permission to switch them all on. Transistors kept
arriving; the permission ran out.

## Under Dennard scaling, one generation of 0.7x shrink gave you:

- [x] Twice the transistors, 1.4 times the frequency, and the same watts per
      square millimetre
- [ ] Twice the transistors and half the power
- [ ] The same transistors running twice as fast
- [ ] Twice the transistors at twice the power density

@why Free performance, in the strict sense: the same unmodified binary ran about
forty per cent faster every generation and the chip did not get hotter. From
1975 to 2004 the right answer to a slow program was to wait.

## Why did the supply voltage stop falling?

- [x] The threshold voltage could not keep falling, because leakage is
      exponential in it with a floor set by temperature
- [ ] Manufacturing could not hold tolerances at lower voltages
- [ ] Lower voltages made chips too slow to sell
- [ ] Regulatory limits on power supplies

@why Each link forces the next. The supply must fall, so the threshold must fall
to keep the overdrive, but leakage is exponential in the threshold with a 60 mV
per decade floor, so the threshold stopped, so the supply stopped.

## The supply voltage has sat at roughly what value for two decades?

- [ ] 5 V
- [ ] 3.3 V
- [ ] 1.8 V
- [x] 0.9 to 1.0 V

@why Five volts in the 1980s, 3.3 in the mid-90s, 1.8 in 1999, and then it
stopped. Everything structural about computing since is downstream of that one
number refusing to move.

## Five generations of 0.7x shrink with the voltage frozen multiplies power density by about:

- [ ] 2
- [ ] 5
- [ ] 12
- [x] 35

@why One over 0.49 to the fifth. A chip near 100 watts per square centimetre is
already comparable to a hotplate, and 35 times that is rocket nozzle territory.
No cooling closes that gap.

## Since 2005, clock frequency has:

- [x] Stayed roughly between four and six gigahertz
- [ ] Continued doubling, more slowly
- [ ] Fallen steadily
- [ ] Risen only in datacenter parts

@why Intel's roadmap in 2000 projected ten gigahertz by mid-decade. It cancelled
the four gigahertz Pentium 4 in October 2004, citing power. Nothing else in
computing has been flat for twenty years.

## Why do two cores at 0.75 of the frequency beat one core at full speed?

- [x] Voltage moves with frequency, so power goes roughly as the cube, and two
      at 0.75 draw 0.84 for 1.5 times the throughput
- [ ] Two cores share a cache more efficiently
- [ ] Parallel code is inherently faster
- [ ] It does not; multicore was purely a consolation prize

@why It is arithmetic rather than opinion, and you compute it in the fourth
exercise. This is the real argument for multicore, and it is the same argument
that later favours a GPU over a CPU.

## The end of Dennard scaling is the moment when, for programmers:

- [x] Concurrency stopped being a specialist skill and became table stakes
- [ ] Compilers became able to parallelise automatically
- [ ] Memory became the bottleneck
- [ ] Assembly language stopped being worth learning

@why Every thread pool and async runtime you have used is downstream of
subthreshold leakage having a floor. That is the point at which a hardware fact
becomes a fact about your job.

## Why does a fixed-function matrix unit beat a general-purpose core on energy?

- [x] It pays no instruction fetch, no scheduling and no register file ports per
      operation
- [ ] Its transistors are physically smaller
- [ ] It runs at a higher clock
- [ ] It uses a lower supply voltage

@why A general-purpose core spends most of its transistors and power on control
rather than arithmetic. If power is the budget, the winning move is to stop
paying for control.

## Halving the mantissa width changes multiplier energy by roughly:

- [x] A factor of four, because energy goes as the square of the width
- [ ] A factor of two
- [ ] No change; energy depends on the exponent
- [ ] A factor of eight

@why Which is why narrow floating point is a power optimisation before it is a
memory one, and why anyone would train a model in four bits at all.

## What is dark silicon?

- [x] The fraction of a chip that cannot be powered on at once within the
      thermal budget
- [ ] Transistors that failed during manufacture
- [ ] Circuitry disabled for product segmentation
- [ ] Area occupied by wiring rather than devices

@why Once you accept it, area is cheap and power is expensive, which inverts
fifty years of instinct. Fill the area with specialised units and light up
whichever suits the work. That is why a phone chip is a zoo.
