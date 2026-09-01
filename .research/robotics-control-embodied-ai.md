# Robotics, Motors, Control and Embodied AI

*Research for the from-first-principles computing curriculum. This is the **capstone**: the
only part of the course where computation moves matter, and where the deadline is set by
physics rather than by a service-level agreement.*

Everything marked **[verified]** was checked against a primary source, or reproduced by
actually running it (Compiler Explorer transcripts in §8 are real API output captured during
this research). Everything marked **[unverified]** is stated on weaker evidence. §9 lists what
I could not confirm.

---

## 0. Why this is the capstone

Every previous unit in this curriculum ends with a number on a screen. If the number is late,
someone waits. Here, if the number is late, a 3 kg arm keeps travelling at the velocity it had
when the loop missed, and the deadline is enforced by momentum.

That single change — a consequence, not a service level — is what makes robotics the place
where every earlier thread has to be *simultaneously* true:

| Earlier unit | What robotics does with it | Where it appears below |
|---|---|---|
| **Microcontroller** (flash-resident code, no MMU, timers, no boot) | The current loop lives on an MCU because it must start in microseconds and never page-fault. | §1.2, §3.6 |
| **Real-time determinism** (WCET, priority inversion, PREEMPT_RT) | 1 kHz is not the specification; 1 kHz *with bounded jitter* is. Jitter is a plant parameter. | §3.7, §5.4 |
| **Sensors and the ADC** (SAR vs ΣΔ, aliasing, ENOB) | Every feedback signal crosses the analog boundary, and the anti-alias filter must be analog because after sampling the damage is unrecoverable. | §2.5 |
| **Numerical estimation** (floating point, conditioning, least squares) | The Kalman filter is recursive least squares, and it loses positive-definiteness in float32 exactly the way the numerics unit predicts. | §4.5 |
| **Planning algorithms** (graph search, heuristics, sampling) | A\* and D\* Lite are the same algorithms, run against a configuration space instead of a road map. | §5.1–§5.2 |
| **The GPU** (SIMT, occupancy, memory bandwidth) | The policy that chooses *what* to do runs on a Jetson at 5–50 Hz while the loop that makes it happen runs at 1–20 kHz on a different processor. | §6.9 |
| **AI systems** (transformers, quantisation, low-precision units) | A vision-language-action model is a VLM with a new action head; deployment is an INT8/FP8 quantisation problem with a hard latency budget. | §6.4, §6.9 |
| **Concurrency** (lock-free queues, priority, shared state) | The bridge between the 50 Hz policy and the 1 kHz servo is a single-producer single-consumer ring buffer, and blocking on it is a safety bug. | §3.6, §5.3 |
| **Networking** (framing, arbitration, latency vs bandwidth) | CAN and EtherCAT are field buses with the same problems as Ethernet and completely different answers. | §5.5 |

The pedagogical claim: **you cannot fake understanding here.** A student can pass a compilers
course with a shaky mental model of memory. A student with a shaky mental model of a
control loop builds something that oscillates, and the oscillation is visible from across the
room.

---

## 1. Actuators — turning current into torque

### 1.1 The brushed DC motor, which is the whole subject in miniature

A brushed DC motor is worth an unreasonable amount of time, because *every* result you need
later — back-EMF as an observer, current as a torque proxy, the stall/no-load duality — is
visible in a device with four parameters.

**The two constitutive equations.**

```
τ  = Kt · i          (torque is proportional to current)
e  = Ke · ω          (back-EMF is proportional to speed)
```

and the electrical loop, with `V` the applied terminal voltage, `R` the winding resistance and
`L` the winding inductance:

```
V = i·R + L·(di/dt) + Ke·ω
```

**The single most useful fact in the whole section: in SI units, `Kt` and `Ke` are the same
number.** [verified — this follows from conservation of energy and is standard in every
machines text] The argument is two lines and every student should be made to do it:

Electrical power consumed by the back-EMF is `P_elec = e·i = Ke·ω·i`.
Mechanical power delivered to the shaft is `P_mech = τ·ω = Kt·i·ω`.
An ideal lossless conversion means these are equal for all `i` and `ω`, so `Ke = Kt`.

The units confirm it: `Kt` is N·m/A, `Ke` is V/(rad/s) = V·s/rad. And
V·s = (J/C)·s = J/A, so V·s/rad = J/(A·rad) = N·m/A. Same dimension, same number.

The reason nobody notices this is that datasheets quote **Kv in RPM per volt**, which is
`1/Ke` in the wrong units. The conversion students must be able to do from memory:

```
Kt [N·m/A] = 60 / (2π · Kv [RPM/V])  ≈  9.5493 / Kv
```

So a 900 KV drone motor has `Kt ≈ 0.0106 N·m/A`. At 30 A that is 0.32 N·m — which, at the
40,000 RPM such a motor never reaches, would be 1.3 kW. This one line is how you sanity-check
a propulsion system in ten seconds, and it is a good exercise precisely because the answer is
checkable against the motor's own current rating.

**The torque–speed curve.** Set `di/dt = 0` (steady state) and solve:

```
i = (V − Ke·ω) / R
τ = Kt·(V − Ke·ω) / R
```

That is a straight line, and it is the whole behaviour of the machine:

- **Stall** (`ω = 0`): `i_stall = V/R`, `τ_stall = Kt·V/R`. Maximum torque, zero output power,
  *all* input power becoming heat in the winding.
- **No load** (`τ = 0`): `ω_nl = V/Ke`. Maximum speed, minimum current (just friction).
- **Peak output power** is at exactly half of each: `ω = ω_nl/2`, `τ = τ_stall/2`,
  `P_max = τ_stall·ω_nl/4`.
- **Peak efficiency** is *not* at peak power. It is much closer to no-load, typically 10–30% of
  stall torque, because copper loss goes as `i²` while output goes as `i`.

The result that hurts people in practice: **stall current is enormous and the motor does not
protect itself.** A small brushed motor might have `R = 0.5 Ω`. At 12 V that is 24 A at stall
against a 2 A continuous rating. Nothing in the motor limits this — the only thing between the
winding and a fire is your current loop, and a current loop is not optional equipment. This is
the first place the course can say honestly: *the software is the safety device.*

**Back-EMF is a free sensor.** Rearranging, `ω = (V − i·R)/Ke`. If you know the applied voltage
and measure the current, you know the speed without an encoder. This is exactly a
single-state observer, it is how cheap fan controllers and sensorless BLDC drives work, and it
is the earliest possible introduction to the idea that *a model plus one measurement can
replace a sensor* — the idea §4.5 turns into the Kalman filter.

Its failure mode is equally instructive: `R` changes with winding temperature by roughly
+0.39%/K for copper, so a hot motor reports the wrong speed, and it is wrong in the direction
that makes the controller push harder, which makes it hotter. First feedback-driven failure
mode of the course.

### 1.2 H-bridges and PWM — where the digital domain touches power

You cannot drive a motor from a GPIO pin. Between the microcontroller and the motor sits a
switching power stage, and its failure modes are the reason this section exists.

**PWM as a synthetic analog voltage.** Switching a transistor on and off at frequency `f` with
duty `D` presents an average voltage `D·V_supply` to the motor. This works — rather than merely
chopping the motor — because the winding inductance `L` acts as a low-pass filter with time
constant `L/R`. The design rule: **switch fast enough that the electrical time constant
averages the ripple.** With `L/R ≈ 1 ms` (typical small motor), 20 kHz gives 50 µs per period,
50× shorter than the time constant, and the current ripple is small. At 500 Hz it is not, and
you get torque ripple, audible whine, and iron loss.

The reason almost every hobby drive runs at or just above 20 kHz is bluntly non-technical: it
is above human hearing. Below that, the motor sings the PWM frequency, because magnetostriction
and Lorentz forces on the windings make the machine a loudspeaker.

**The H-bridge.** Four switches, two per leg. Motor between the midpoints. Diagonal pairs give
the two directions; both low sides on gives a **brake** (the motor's own back-EMF drives current
through a short, dissipating energy in the winding — hard stop); all four off gives **coast**.
That the same hardware gives brake and coast, chosen purely in software, is the cleanest
example available of a mechanical behaviour being a software decision.

**Shoot-through, and why dead time exists.** If the high-side and low-side switch on the same
leg are ever on simultaneously, they form a direct short from rail to ground through two
transistors. Current is limited only by `R_ds(on)` — hundreds of amps — and the failure is
typically in the first microsecond. MOSFETs do not turn off instantly: gate charge takes tens
to hundreds of nanoseconds to remove, and turn-off is generally *slower* than turn-on.

The fix is **dead time**: a mandatory interval, both switches off, inserted between one turning
off and the other turning on. Typical values are 100 ns to 2 µs depending on gate drive
strength and device. This is *the* archetypal hardware-mandated timing constraint for a course
that has spent weeks on timing, and it has three properties worth drawing out:

1. It is enforced in hardware on any serious MCU. STM32 advanced-control timers (TIM1/TIM8)
   have a dedicated dead-time generator register (`BDTR.DTG`) precisely so that a software bug
   cannot produce shoot-through. **Never generate complementary PWM in software.**
2. It is not free. Dead time is time during which neither switch conducts, so the actual
   applied voltage differs from the commanded duty. At 20 kHz (50 µs period) with 1 µs dead
   time, up to 2% of the period is lost, and the error's *sign depends on current direction* —
   which makes it a nonlinearity, a distortion source in FOC, and the reason good drives
   implement dead-time compensation.
3. It is the reason the naïve student instinct ("just drive the two pins with `!x`") is a
   hardware-destroying bug rather than a style problem.

**Flyback and freewheeling.** A motor winding is an inductor, and `v = L·di/dt`. Interrupt the
current abruptly and `di/dt` is huge and `v` is whatever it takes to keep current flowing —
hundreds of volts across a 12 V transistor. The energy `½Li²` has to go somewhere.

- In a single-switch drive, a **flyback diode** across the motor gives the current a loop to
  decay in.
- In an H-bridge, the MOSFETs' intrinsic **body diodes** provide this path, which is why a
  discrete flyback diode is often absent. Body diodes are slow and lossy, so performance
  bridges add Schottky diodes in parallel or use **synchronous rectification** (turning the
  opposite switch on during the freewheel interval to conduct through the low-resistance
  channel instead of the diode) — which is also exactly the thing that makes dead time
  mandatory.
- **Regeneration** is the same physics with the sign flipped: decelerating a load, the motor is
  a generator, current flows back into the supply and the DC-bus voltage *rises*. On a battery
  this charges it. On a bench supply, which cannot sink current, the bus climbs until something
  fails. This is why real drives have a **brake resistor** and a bus-voltage comparator.

**Current sensing** is what turns the power stage into a controllable torque source, and there
are three placements with real trade-offs:

| Placement | How | Pros | Cons |
|---|---|---|---|
| **Low-side shunt** | resistor between bridge and ground | ground-referenced, cheap amplifier | only sees current when the low switch conducts → blind at high duty; needs synchronised sampling |
| **In-line (phase) shunt** | resistor in series with the motor lead | sees true phase current continuously | needs a high-side / differential amplifier with high common-mode rejection at PWM edges |
| **Hall / magnetic (e.g. TMR, fluxgate)** | non-contact | galvanic isolation, no power loss | more expensive, offset drift, lower bandwidth |

The subtle point, and a genuinely good exam question: **when you sample matters more than what
you sample.** During a PWM edge the shunt voltage rings for hundreds of nanoseconds from
parasitic inductance and switching noise. The correct practice is to trigger the ADC from the
timer at the *centre* of the PWM period — centre-aligned PWM with an ADC trigger on the timer
update event — so the sample lands in the quiet middle of the on-time. This is a peripheral
interconnect (timer → ADC trigger, no CPU involvement) and it is the exact same "hardware does
the timing, software does the policy" pattern the microcontroller unit taught. **This is one of
the strongest single connections in the whole curriculum.**

### 1.3 BLDC and PMSM — the same machine, two control philosophies

A brushless motor is a brushed motor with the commutator moved into software. The magnets are
on the rotor, the windings on the stator, and something must decide which coils to energise as
a function of rotor angle. In a brushed motor, carbon brushes and a mechanical commutator do
this. Removing them removes the wear item, the arcing, and the brush voltage drop — and adds
the requirement that you know the rotor angle.

**Terminology, stated once so it stops being confusing:** *BLDC* and *PMSM* usually name the
same physical construction. The distinction that matters is the shape of the back-EMF
waveform, which follows from the winding distribution:

- **Trapezoidal back-EMF (call it BLDC):** concentrated windings. Optimal drive is blocks of
  constant current — six-step commutation.
- **Sinusoidal back-EMF (call it PMSM):** distributed windings. Optimal drive is sinusoidal
  current — FOC.

**Six-step / trapezoidal commutation.** Divide the electrical revolution into six 60° sectors.
In each, energise one phase positive, one negative, leave one floating. Three Hall sensors give
you exactly the 3 bits you need — six valid states of eight, the two all-high/all-low codes
being the fault detection. Commutation is a six-entry lookup table indexed by Hall state.

It is simple, cheap, and it has one dominant flaw: **torque ripple**. Torque is proportional
to the dot product of the current vector with the back-EMF; with six discrete current vectors
the angle between them sweeps ±30°, so torque varies by roughly `1 − cos(30°) ≈ 13.4%` at 6×
electrical frequency. Fine for a fan or a propeller. Not fine for a robot joint, which is why
robotics is a sinusoidal-drive field.

**Sensorless six-step** deserves a mention because it is elegant: with one phase floating, you
can measure its back-EMF directly, and the zero-crossing of that voltage occurs 30° before the
next commutation point. Watch for the zero crossing, wait 30° worth of time, commutate. It is
free (no sensor) and it fails completely at zero speed, because at zero speed there is no
back-EMF. Hence the "open-loop startup ramp" every hobby ESC does, the reason drones cannot
hold position at zero RPM, and the reason robot joints — which must hold torque at standstill —
always have a real position sensor.

### 1.4 Field-Oriented Control, done properly

**FOC is the single most important control algorithm in modern robotics and drones**, and it is
usually taught badly, as a sequence of matrices with no motivating idea. The motivating idea is
one sentence:

> **A rotating machine is a hard control problem in the stator frame and a trivial one in the
> rotor frame, so change frames, control, and change back.**

That is it. Everything else is bookkeeping. It is also *exactly* the change-of-basis argument
from linear algebra, applied to a physical system, which makes it a superb capstone for the
numerical-linear-algebra thread.

**The problem being solved.** Torque in a PMSM is the cross product of the stator current
vector and the rotor flux vector. Maximum torque per amp comes when the current vector is
90 electrical degrees ahead of the rotor flux. But the rotor is spinning, so in the stator
frame the required currents are sinusoids whose frequency, phase and amplitude all change.
A PI controller cannot track a sinusoid with zero steady-state error — a PI controller has
infinite gain only at DC. Try it and you get amplitude attenuation and phase lag that both get
worse with speed. **This is the real reason FOC exists**, and it should be stated in exactly
those terms, because it connects straight to the frequency-domain material in §3.5.

#### Step 1 — the Clarke transform: 3 phases → 2 axes

The three phase currents are not independent. With no neutral connection,
`i_a + i_b + i_c = 0`, so there are only two degrees of freedom. Clarke throws away the
redundancy, mapping three 120°-separated axes onto an orthogonal 2D stationary frame (α, β).

Amplitude-invariant (the usual robotics convention, preserving peak magnitude):

```
i_α = (2/3)·( i_a − ½·i_b − ½·i_c )
i_β = (2/3)·( (√3/2)·i_b − (√3/2)·i_c )
```

and using `i_c = −i_a − i_b` this collapses to the form actually implemented:

```
i_α = i_a
i_β = (i_a + 2·i_b) / √3
```

**[verified — algebraically; this substitution is the standard implementation form and is
checked numerically in Exercise C, §8.3]**

There is a second convention, **power-invariant**, with `√(2/3)` in front instead of `2/3`. It
preserves `p = v_α·i_α + v_β·i_β`. It is a scale factor of `√(3/2) ≈ 1.2247` on the transform,
and mixing conventions between your Clarke and your inverse Clarke is a classic silent bug that
produces a drive that works but delivers the wrong torque constant. **State which convention
you use, in a comment, always.**

Physically: α, β are the real and imaginary parts of the stator current *space vector*. Under
balanced sinusoidal drive, (α, β) traces a circle. We have gone from three sinusoids to a
rotating 2D vector — no information lost, and now the geometry is visible.

#### Step 2 — the Park transform: stationary → rotating

Now rotate the frame with the rotor. Let `θ` be the **electrical** rotor angle (mechanical
angle × number of pole pairs — the factor-of-`p` error here is the most common FOC bug there
is):

```
i_d =  i_α·cos θ + i_β·sin θ
i_q = −i_α·sin θ + i_β·cos θ
```

That is a plain 2D rotation by `−θ`. In the (d, q) frame:

- **d (direct)** is aligned with the rotor magnet flux. Current here pushes magnetically
  *against* the magnets. It produces **no torque** in a surface-mount PM motor. It is pure loss.
- **q (quadrature)** is 90° ahead. Current here produces **all** the torque.

And here is the payoff:

> **In steady state, `i_d` and `i_q` are DC.** The circle in (α, β) becomes a fixed point in
> (d, q). A PI controller regulates DC to zero error perfectly. The hard problem became easy
> by choosing coordinates.

The whole loop then is:

```
measure i_a, i_b (i_c inferred) and θ  →  Clarke  →  Park  →  i_d, i_q
                                                              │
        PI(i_d, ref = 0)  ←──────────────────────────────────┤
        PI(i_q, ref = τ_cmd / (Kt·p)) ←───────────────────────┘
                    │
                 v_d, v_q  →  inverse Park (rotate by +θ)  →  v_α, v_β
                                                                 │
                                                    Space Vector PWM → 6 gate signals
```

**Why `i_d_ref = 0`.** For a surface-mount PM motor, d-axis current makes no torque and only
heat, so command zero. Two exceptions that show the framework's generality:

- **Field weakening**: above base speed, back-EMF approaches the DC-bus voltage and you cannot
  push more current. Commanding **negative** `i_d` opposes the rotor flux, reduces back-EMF,
  and buys speed at the cost of torque. This is how EVs and spindles exceed base speed, and it
  is one line of code — a different setpoint on a loop you already have.
- **Interior PM (IPM) motors** have `L_d ≠ L_q`, adding a reluctance torque term
  `(3/2)·p·(L_d − L_q)·i_d·i_q`. Optimal `i_d` is then nonzero, and "MTPA" (maximum torque per
  ampere) is the search for the best (`i_d`, `i_q`) pair on a constant-current circle.

**Space Vector PWM (SVPWM)**, which the last box hides, is worth one paragraph because the win
is concrete. Naïve sinusoidal PWM can synthesise a peak phase voltage of `V_dc/2`. SVPWM
exploits the fact that only *line-to-line* voltage matters to the motor: you may add any common
signal to all three phases without changing any line-to-line difference. Adding the right
third-harmonic-ish common-mode signal (or equivalently, choosing the two adjacent active
vectors plus zero vectors and splitting the zero time between the two zero states) raises the
achievable peak phase voltage to `V_dc/√3`. That is **2/√3 ≈ 1.1547, a 15.47% increase in
available voltage from arithmetic alone** — a rare free lunch, and a memorable one.

**Practical FOC requirements**, all of which are curriculum callbacks:

- **Angle accuracy is everything.** An angle error `Δθ` scales the useful torque by `cos Δθ`
  and injects `sin Δθ` of the current into the flux-producing axis. 10° costs 1.5% of torque
  and produces 17% wasted current; 30° costs 13% and wastes half the current as `i_d`. This is
  why FOC needs an absolute encoder or a good observer, and why the encoder must be *aligned*
  to the rotor (the "encoder offset calibration" step every FOC firmware has).
- **The delay budget.** Between sampling the current and applying the voltage there is ADC
  conversion, computation, and PWM update latency. During that time the rotor has moved. At
  10,000 RPM with 7 pole pairs, electrical frequency is 1167 Hz; a 100 µs delay is 42
  electrical degrees. Serious drives apply **angle advance** — extrapolating `θ` by
  `ω · t_delay` before the inverse Park — which is an explicit, quantified acknowledgement that
  computation takes time and the world does not wait. *This is the real-time unit's whole
  thesis expressed as a `+=`.*
- **Loop rate.** Current loops typically run at the PWM rate: 10–40 kHz. That is 25–100 µs per
  iteration for two PI controllers, four transcendental-ish operations, and SVPWM. On a
  Cortex-M4F it fits comfortably with hardware FPU and a CORDIC or table-based sin/cos; on an
  M0 without an FPU it does not, which is a beautifully concrete demonstration of why the
  microcontroller unit's discussion of FPUs mattered.
- **Open-source reference implementations worth reading:** **ODrive**, **VESC**, **SimpleFOC**,
  and **moteus**. [unverified as to current feature sets — all four are well-known projects but
  I did not re-confirm their present state in this session.]

### 1.5 Stepper motors and why they lose steps

A stepper is a many-pole machine driven **open-loop**: energise the coils in a fixed pattern and
the rotor follows, one known increment per step. A common hybrid stepper has 200 full steps per
revolution (1.8°), which is why 3D printers and small CNC machines use them — position control
with no encoder, no tuning, and no control loop at all.

The mechanism is a magnetic spring. Rotor torque varies roughly sinusoidally with the angle
between rotor position and commanded position:

```
τ = τ_holding · sin(θ_error · N_steps_per_electrical_cycle)
```

Torque is *zero* at the commanded position (that is the equilibrium), rises to `τ_holding` at
one full step of error, and — critically — **falls back to zero at two steps and then reverses
sign**. Past two full steps of lag the machine actively pulls toward the *next* equilibrium.
That is what "losing steps" is: not slipping, but a bifurcation. And because the controller has
no sensor, it never finds out. It cheerfully reports a position that is wrong by a multiple of
four steps, forever, until a homing cycle.

Why it happens, in order of frequency:

1. **Torque falls with speed.** The winding is inductive; at step rate `f` the available current
   is limited by `L·di/dt`, so torque decays roughly as 1/f above a corner frequency. This is
   why steppers are driven from a **chopper current-mode driver** at a supply voltage many
   times the winding's rated voltage (e.g. 24–48 V into a 2.8 V winding) — high voltage forces
   current into the inductance quickly, and the chopper limits the steady value.
2. **Mid-band resonance.** The magnetic spring plus rotor inertia is a lightly damped
   second-order system, typically resonant somewhere around 100–200 Hz of step rate. Drive at
   the resonant frequency and the oscillation amplitude grows past two steps and the motor
   stalls *even though there is plenty of torque available*. Microstepping is the standard
   mitigation because it smooths the excitation; so is deliberate mechanical damping.
3. **Acceleration exceeding available torque**, i.e. `J·α > τ(ω)`. This is why every motion
   controller has a jerk/accel limit and why trajectory generation (§5.3) is not optional.

Microstepping (driving the two phases with sine/cosine current at fractional angles) improves
smoothness and resonance behaviour a great deal, but improves *accuracy* far less than the
step count suggests: detent torque and magnetic non-idealities mean a 1/256 microstep driver
does not give you 1/256 of a step of positional accuracy. Good honest engineering point.

**The pedagogical value of steppers is that they are the control system's null hypothesis.**
They are open-loop, and they work, until they don't, and when they don't you get no error
signal. Contrast with closed-loop: a servo that cannot reach its target *says so*. Running a
stepper into a hard stop and watching the position report stay confidently wrong is a
five-minute demonstration that justifies the rest of the course.

### 1.6 Gearboxes — the thing that actually determines what your robot can do

Motors make high speed and low torque. Robots need low speed and high torque. Something must
convert, and its properties dominate the machine's behaviour.

**Ratio and the ideal relations.** For ratio `N:1`:

```
ω_out = ω_in / N        τ_out = τ_in · N · η        (η = efficiency)
```

**Reflected inertia is the important one, and it goes as N².** A load inertia `J_load` seen from
the motor shaft is:

```
J_reflected = J_load / N²
```

and, symmetrically, the motor's own inertia seen from the *output* is `J_motor · N²`. This is
the single most important gearbox fact for robotics and it cuts both ways:

- **Good:** a big load becomes invisible. With `N = 100`, a load 10,000× the motor inertia looks
  like a 1:1 match. The motor barely notices external disturbances. This is why industrial arms
  with high-ratio gearboxes have such clean, easily tuned position loops — the gearbox
  *decouples* the motor from the world.
- **Bad:** it is symmetric. The world barely notices the motor, so the motor cannot feel the
  world. **Backdrivability is destroyed.** Push on the end effector of a 160:1 harmonic-drive
  arm and the reflected friction alone stops you. That is fine for welding car bodies in a cage
  and disqualifying for anything that touches a person or takes an impact.

This trade-off — *isolation versus transparency* — is the reason for the entire next subsection
and is the technical fact behind the industrial-arm/legged-robot divide.

**Backlash.** The angular slop between drive and driven sides when torque reverses. In a
spur-gear train it is typically 0.5–2°; precision planetary gearheads reach 3–10 arcmin
(0.05–0.17°). Backlash is a **dead zone**: an interval where commanding motion produces none,
and then motion resumes abruptly. To a linear controller this is a hard nonlinearity, and its
practical consequence is limit cycling — the loop hunts back and forth across the dead zone
forever, because integral action keeps winding up until it crosses. **A student who has fought
a limit cycle caused by backlash understands nonlinearity in a way no lecture achieves.**

**Harmonic drive (strain wave gearing).** Three parts: an elliptical **wave generator**, a
flexible toothed cup (**flexspline**), and a rigid internal ring (**circular spline**) with 2
more teeth than the flexspline. The ellipse pushes the flexspline into mesh at two opposite
points; one input revolution advances the flexspline by exactly the 2-tooth difference. Ratio
is `N_flexspline / 2` — typically 50:1 to 160:1 in a single very compact stage.

- **Pro:** essentially **zero backlash** (teeth are preloaded by the flexspline's elasticity),
  very high ratio in one stage, coaxial, high torque density. This is why almost every
  industrial robot joint and many humanoid joints use them.
- **Con:** expensive; the flexspline is a fatigue part; and it has **nonlinear torsional
  compliance and hysteresis** — it is a soft, lossy spring, so joint torque estimated from motor
  current is systematically wrong under load reversal. Modelling this is a real research topic,
  not a footnote.

**Cycloidal drive.** An eccentric drives a lobed disc rolling inside a pin ring, with one fewer
lobe than pins. Similar high single-stage ratios. Shock-load tolerance is much better than a
harmonic drive (contact is distributed over many rolling lobes rather than concentrated in
flexing teeth), and stiffness is higher; the cost is more moving mass, an inherent eccentric
vibration that needs a balancing second disc, and slightly worse backlash than harmonic.
Common in high-payload industrial robot base joints and increasingly in humanoid designs.

**Planetary.** Sun, planets, ring. Coaxial, load shared over several teeth so torque density is
good, ratios of 3:1 to 10:1 per stage and stackable. Cheap and everywhere. Has real backlash
unless you pay for a precision unit. The default choice when zero backlash is not required.

**Belt/cable and capstan drives** deserve a mention because they solve a different problem: they
let you put the motor *elsewhere*. Moving actuator mass off the distal links reduces the arm's
inertia dramatically, which is why so many fast robots (and the WAM arm, and most tendon-driven
hands) route power through cables. Cable drives are also nearly backlash-free and very
backdrivable, at the cost of stretch, creep, routing complexity, and a maintenance item.

### 1.7 Series-elastic and quasi-direct-drive — why legged robots went there

This subsection answers a question students will actually ask: *why do robot dogs use big
low-ratio motors when industrial arms use small motors with huge gearboxes?* The answer is a
genuinely interesting piece of engineering history and it turns on §1.6's `N²`.

**The problem with a stiff, high-ratio joint.** Three failure modes:

1. **Impact.** A leg hitting the ground delivers a force impulse in milliseconds. Reflected to
   the motor through `N = 100`, the impulse is amplified by the same `N` in torque and the
   motor+gearbox must absorb it structurally. Gear teeth break. No control loop is fast enough
   to help — 1 ms is one sample at 1 kHz.
2. **Force control is bad.** Making a stiff, high-friction, backlash-y transmission produce an
   accurate small force is hard. The friction (also reflected) is a large fraction of the force
   you are trying to command, and it is a nonlinearity you cannot cancel reliably.
3. **You cannot feel anything.** Contact detection through a non-backdrivable transmission
   requires an extra sensor.

**Answer 1 — Series Elastic Actuation (SEA).** Deliberately insert a compliant element (a
spring) between the gearbox output and the load, and measure its deflection.

- Force becomes a *position* measurement: `F = k·Δx`. Position is the thing encoders are
  excellent at, so this converts a hard sensing problem into an easy one. You get a
  high-quality force sensor for the price of a spring and a second encoder.
- The spring is a mechanical low-pass filter for impacts: the shock energy goes into the spring
  rather than the gear teeth, and the peak force seen by the transmission is bounded.
- It gives real energy storage, which matters for legged efficiency.
- **Cost, and it is real:** the spring introduces a resonance and hard-limits the force-control
  bandwidth to roughly `√(k/m)`. Softer spring = better force fidelity and shock tolerance,
  worse bandwidth and position accuracy. You cannot have both, and choosing `k` is *the* design
  decision. [Series elastic actuation is due to Pratt and Williamson, MIT, 1995 — verified as
  the standard attribution; I did not re-check the exact paper title this session.]

**Answer 2 — Quasi-Direct Drive (QDD).** Instead of adding compliance to fix a high-ratio
transmission, **delete most of the transmission.** Use a large-diameter, high-pole-count
"pancake" BLDC motor (high torque directly, because torque scales with rotor radius and active
length) with a low-ratio single-stage planetary — typically 4:1 to 10:1.

Why this suddenly works, when it would not have in 1995:

- Reflected inertia and friction go as `N²`, so at `N = 6` the transmission's contribution is
  36× smaller than at `N = 36`, and the joint is genuinely **backdrivable**.
- Therefore **motor current is a good proxy for joint torque**, with an error of a few percent
  rather than tens of percent. You get force sensing with *no force sensor* — the current sense
  you already needed for FOC (§1.2) *is* the force sensor. This is the elegant part.
- Therefore impacts are absorbed by the motor's own rotor accelerating, not by gear teeth.
- Therefore the control bandwidth is limited by the current loop (tens of kHz), not by a
  mechanical resonance — so **impedance control** in software can synthesise any stiffness and
  damping you like, including a soft one, without a physical spring.

The enabling technologies are exactly the ones this chapter has covered: cheap high-pole-count
brushless motors from the drone industry, cheap FOC-capable MCUs, cheap high-resolution
magnetic encoders, and cheap MOSFETs. The design was popularised by the MIT Cheetah line
(Sangbae Kim's group) and the associated actuator paper, and it is now the standard for legged
robots and increasingly for humanoid arms. [The MIT Mini Cheetah actuator design and its
influence are well documented; **verified** as the standard account. Specific torque-density
figures are **unverified** here.]

**The summary that belongs on a slide:**

| | High-ratio + harmonic | SEA | QDD |
|---|---|---|---|
| Ratio | 50–160:1 | 50–100:1 + spring | 4–10:1 |
| Backdrivable | no | somewhat | yes |
| Torque sensing | needs a torque sensor | spring deflection | motor current |
| Impact tolerance | poor | excellent | good |
| Force bandwidth | high but inaccurate | limited by spring | very high |
| Position accuracy | excellent | moderate | moderate |
| Where used | industrial arms, precision | early humanoids, exoskeletons, cobots | legged robots, modern humanoids |

**The one idea:** a gearbox is not a component you pick after the control design. `N²` decides
whether your robot can feel the world, and therefore decides what control strategy is even
available to you. Mechanism and algorithm are the same decision.

---

## 2. Sensors and the analog boundary

A robot's software lives in a world of exact integers. The world it controls does not. Every
feedback path crosses that boundary, and almost every hard-to-find robotics bug lives at the
crossing.

### 2.1 Encoders and quadrature decoding

**Incremental optical/magnetic encoders** produce two square waves, A and B, 90° out of phase
(hence *quadrature*). Two signals give four states per cycle, and this buys three things at
once:

1. **4× resolution.** A 1000-line disc gives 4000 countable edges per revolution (4000 CPR).
2. **Direction.** The *order* of the state transitions distinguishes CW from CCW. One channel
   alone gives you speed but not sign.
3. **Error detection.** From any state only two transitions are legal. Seeing an illegal
   transition (both channels changing at once) means you missed an edge — you can *count* your
   own failures, which is rare and valuable.

The state machine, which is the whole algorithm:

```
    A ──┐   ┌───┐   ┌───┐
        └───┘   └───┘
    B ────┐   ┌───┐   ┌─
          └───┘   └───┘

    states, forward:  00 → 01 → 11 → 10 → 00
    states, reverse:  00 → 10 → 11 → 01 → 00
```

Implementations, in increasing order of correctness:

- **Polling in a loop.** Works only if you poll faster than twice the maximum edge rate.
  Nyquist, again, and violating it silently loses counts *permanently* — an integrating error,
  not a transient one.
- **Interrupt on both edges of both channels.** Correct at low speed. At 4000 CPR and
  3000 RPM that is 200,000 interrupts per second, each with tens of cycles of entry/exit
  overhead. The MCU spends all its time in the ISR and the control loop starves. **This is the
  single best real-world illustration of interrupt-overhead-dominated design in the entire
  curriculum**, and the arithmetic is a one-line exercise.
- **Hardware quadrature decoder.** Every serious motor-control MCU has one: STM32 timers in
  encoder mode, an ESP32 PCNT unit, a dedicated QEI block. The counter increments in silicon,
  the CPU reads a register when it feels like it, and the interrupt rate drops to zero.
  Same pattern as the timer-triggered ADC in §1.2: *hardware does the timing, software does
  the policy.*

**The index pulse (Z)** fires once per revolution and gives an absolute reference; without it,
an incremental encoder knows only *change*, so every power-up requires a homing sequence.

**Absolute encoders** (magnetic like AS5047/MT6701, or optical) report position directly over
SPI/SSI/BiSS. Robotics wants these, because FOC needs the *rotor* angle at power-on before you
have moved (§1.4), and a joint that must home before it can move is unacceptable on a robot
with a payload in its hand.

Two properties to teach explicitly:

- **Velocity from position is a differentiation, and differentiation amplifies noise.** With a
  quantised position `Δθ = 2π/CPR`, estimating `ω = Δcount/Δt` at 1 kHz gives a velocity
  quantisation of `Δθ/Δt` — at 4000 CPR and 1 ms that is 1.57 rad/s of granularity, which is
  enormous at low speed. The standard fixes are (a) measure *time between edges* instead of
  counts per interval at low speed, (b) filter, accepting the phase lag, or (c) run a
  position+velocity observer (§4.5) that fuses the encoder with the motor model. Every serious
  drive does (c).
- **Latency.** An SPI absolute encoder read at 10 MHz for 24 bits is ~2.4 µs plus overhead, and
  it sits inside your 25 µs current-loop budget. Encoder read time is a real term in the
  real-time analysis.

### 2.2 IMUs — what each sensor actually measures

The near-universal misconception is that an accelerometer measures acceleration. It does not.

**Accelerometer.** A MEMS accelerometer is a proof mass on springs whose displacement is read
capacitively. It measures **specific force**: the non-gravitational force per unit mass, i.e.
`a_measured = a_true − g` in the sensor frame. Consequences:

- **Sitting still on a table, it reads 1 g upward**, not zero. It is measuring the *normal
  force* from the table, not gravity.
- **In free fall it reads zero.** An IMU in a falling robot reports no acceleration.
- Therefore it is simultaneously an accelerometer *and* an inclinometer, and it cannot tell
  which it is being. A stationary tilted sensor and an accelerating level sensor produce
  identical readings. **This ambiguity is the entire reason IMU sensor fusion is hard**, and it
  should be stated on day one, because it is the physical fact that motivates §4.6.
- Roll and pitch are observable from gravity; **yaw is not**, because rotation about the gravity
  vector does not change the gravity vector.

**Gyroscope.** A MEMS gyro is a vibrating structure sensing the Coriolis force; it measures
**angular rate** about each axis, in rad/s or °/s. It has no absolute reference at all, so
attitude requires integration — and integration turns every error into a growing one.

**Magnetometer.** Measures the local magnetic field vector. In principle this gives an absolute
yaw reference from magnetic north. In practice it measures the field of *your robot* plus the
Earth's, and your robot contains high-current motor windings, steel, and ferrite. Calibration
splits the error into **hard-iron** (a constant offset from permanent magnetisation — fit and
subtract a sphere centre) and **soft-iron** (a linear distortion that turns the sphere into an
ellipsoid — fit and invert a 3×3). Both change when someone bolts a new bracket on. Indoors,
rebar and mains wiring make it unreliable enough that many indoor robots simply do not use it.

**The error terms, and what they mean numerically.** Datasheets quote these and students should
be able to convert them into a drift budget:

- **Bias (offset).** A nonzero reading at zero input. A gyro bias `b` integrates directly into
  an angle error `b·t` — **linear** growth. 0.01 °/s (a decent consumer MEMS part) is 36°/hour.
  Bias is the dominant error term and it is why every gyro is zeroed at startup while stationary
  and re-estimated online by the filter (§4.5 — bias as an extra state is the standard trick).
- **Bias instability / random walk.** The bias itself drifts with temperature and time, so
  zeroing at startup is not permanent. Reported via the Allan deviation curve; the minimum of
  that curve is the "bias instability" figure and its location on the time axis tells you the
  optimal averaging window.
- **Noise density**, quoted in units like µg/√Hz or °/s/√Hz. This is the key one for a control
  engineer because **it makes noise a function of your bandwidth**: total RMS noise
  ≈ noise_density × √(bandwidth). A 150 µg/√Hz accelerometer sampled with 100 Hz of bandwidth
  gives 1.5 mg RMS; at 1000 Hz it gives 4.7 mg. *Halving your filter bandwidth buys 3 dB of
  noise and costs you phase margin* — the connection between §2.5, §3.5 and §4.6 in one line.
- **Scale factor error and cross-axis sensitivity.** A percent-level gain error and a
  percent-level leak between axes. Matters for high-accuracy work, calibrated with a rate table.
- **Temperature dependence** of all of the above, which is why better parts include a
  temperature sensor and a factory calibration polynomial.

**The drift arithmetic every student should do once.** Double-integrating accelerometer noise
and bias to get position: a constant accelerometer bias `b_a` gives position error `½·b_a·t²`.
With `b_a = 10 mg = 0.098 m/s²`, after 10 seconds that is 4.9 m. **A consumer IMU alone cannot
navigate.** Not "is inaccurate" — cannot, by orders of magnitude. That is why every real system
fuses the IMU with something that has bounded error (GPS, a camera, wheel odometry, a LiDAR
map), and it is the honest motivation for the entire estimation chapter.

**Tiers, for calibration of expectations** [unverified as to exact current numbers — treat as
order-of-magnitude]: consumer MEMS (phone/drone, ~$5, bias instability tens of °/hr) →
industrial/tactical MEMS ($100–$5k, ~1 °/hr) → fibre-optic and ring-laser gyros ($10k+,
<0.01 °/hr, aircraft-grade). Price spans four orders of magnitude for the same measurement,
which is a good lesson in what precision costs.

### 2.3 Force and torque sensing

Four approaches, and the trend in the field is instructive:

- **Strain-gauge load cells / 6-axis F/T sensors** (ATI, Robotiq and similar). Foil or
  semiconductor gauges in a Wheatstone bridge on a compliant structure; a 6-axis sensor solves
  a calibration matrix from 6+ gauge readings to Fx/Fy/Fz/Tx/Ty/Tz. High accuracy, high cost,
  temperature-drift-prone, and mechanically a weak link you have inserted into your load path.
  Bridge output is millivolts, so this is a low-noise instrumentation-amplifier and
  high-resolution-ADC problem — the strongest possible motivation for §2.5.
- **Joint torque sensors** — the same idea at each joint, as in the DLR/KUKA LBR iiwa lineage.
  Gives torque at every joint rather than only at the wrist, which enables whole-arm compliance
  and contact detection anywhere on the arm.
- **Series elastic (§1.7)** — deflection of a known spring. Cheap, robust, bandwidth-limited.
- **Motor current (§1.7)** — free, but only honest when the transmission is backdrivable, and
  systematically biased by friction, which is itself hysteretic and temperature dependent.

The last two are why the field moved: a QDD leg gets usable force feedback from hardware it
already needed, at a small fraction of the cost and with none of the structural compromise.

**Tactile sensing** is the current frontier: capacitive/resistive skins, and vision-based
tactile sensors (GelSight-style: a camera looking at a deformable gel from the inside, turning
touch into a dense image and therefore into a problem the vision stack already solves).
[unverified as to current state of the art.]

### 2.4 LiDAR and how a point cloud is actually produced

Three ranging principles:

- **Direct time-of-flight (dToF).** Emit a short laser pulse, time the return. `d = c·t/2`.
  Since `c ≈ 0.3 m/ns`, **1 cm of range accuracy requires ~67 ps of timing resolution** — which
  is why LiDAR needs a dedicated time-to-digital converter and cannot be done with a general
  timer peripheral. Excellent long range; this is what automotive and survey units use.
- **AMCW / phase-shift.** Amplitude-modulate a continuous beam, measure the phase shift of the
  return. Precise, but phase wraps, giving an ambiguity interval of `c/(2·f_mod)` — resolved by
  using two modulation frequencies (the same trick as Chinese-remainder ranging in GPS). Most
  cheap indoor ToF sensors (VL53L0X family) work this way.
- **FMCW.** Sweep the optical frequency and beat the return against the outgoing beam. Gives
  range *and* radial velocity per point from the Doppler shift, and is immune to interference
  from other LiDARs because only your own chirp correlates. This is the direction the
  automotive industry has been moving. [unverified as to current market share.]

**Producing the cloud** is a coordinate-transform-and-timing problem, and this is the part that
is usually skipped and shouldn't be:

1. Each measurement yields a range `r` at a known mirror/prism azimuth `φ` and beam elevation
   `θ`, at a timestamp `t`.
2. Spherical → Cartesian in the *sensor* frame:
   `x = r·cos θ·cos φ`, `y = r·cos θ·sin φ`, `z = r·sin θ`.
3. **Motion compensation / de-skewing.** A spinning LiDAR at 10 Hz takes 100 ms per revolution.
   If the robot is moving at 1 m/s, the first and last points of a "single scan" are taken 1 m
   apart. **A LiDAR scan is not a snapshot.** Treating it as one is a real and common bug that
   produces a smeared map. The fix is to transform each point using the robot pose *at that
   point's own timestamp*, interpolated from an IMU or odometry — which requires that the LiDAR
   and the IMU share a time base to sub-millisecond accuracy. **Time synchronisation is a
   first-class robotics problem**, and this is the cleanest example of why (see PTP/gPTP,
   hardware timestamping, and the ROS 2 time model in §5.4).
4. Transform to the robot body frame using the extrinsic calibration, then to the world frame
   using the estimated pose.

Also worth stating: the return carries **intensity**, which is a real signal (retroreflective
tape, lane markings, wet surfaces), and modern units report **multiple returns** per pulse,
which is how you see through foliage, rain and dust — the first return is the leaf, the last is
the ground.

**Solid-state vs mechanical spinning** is the main hardware axis: MEMS mirrors, optical phased
arrays, and flash LiDAR remove the rotating assembly (reliability, cost, form factor) at the
cost of field of view. Cheap 2D spinning units (RPLIDAR class, ~$100) remain the standard entry
point for teaching and for indoor robots.

### 2.5 ADCs — the boundary itself

This is the direct callback to the sensors/ADC unit, and the place where robotics makes it
*consequential*: the ADC choice determines whether your current loop can run at 20 kHz.

**SAR (successive approximation).** A binary search in hardware. A sample-and-hold captures the
input; then, for each bit from MSB down, a DAC produces a trial value and a comparator answers
"higher or lower". `N` bits take `N` comparison cycles.

- **Latency is fixed, short, and known**: one conversion, a handful of microseconds or less.
- 8–18 bits typically, and it can be multiplexed across many channels.
- **This is the ADC in your MCU**, and it is the right one for control, because a control loop
  needs a *recent* sample far more than it needs a quiet one. A 12-bit SAR at 1 Msps converts
  in 1 µs, fits the current-loop budget, and can be triggered by a timer.

**Sigma-delta (ΣΔ).** Massively oversample (64×–1024×) with a coarse (often 1-bit) quantiser
inside a feedback loop that **shapes the quantisation noise** out of the signal band, then
decimate with a digital filter.

- 16–32 bits of resolution, superb DC accuracy and linearity.
- **But the decimation filter is a long FIR, so latency is tens to hundreds of samples.** A
  sinc³ filter settles in 3 output periods. This latency is *phase lag in your control loop*
  (§3.5), and it will eat your phase margin.
- Right for a load cell, a thermocouple, audio, a precision instrument. **Wrong for a current
  loop**, and putting one there is a genuine, common design error — the loop becomes unstable
  and nobody can see why, because the ADC "works fine".

> **The rule worth memorising: SAR for control, ΣΔ for measurement.** Latency versus resolution
> is the trade, and a control loop spends resolution to buy latency.

Also worth naming: **pipelined** ADCs (high speed, high latency in a known number of clocks —
RF and video) and **flash** ADCs (2^N comparators, one clock, low resolution, high power —
oscilloscope front ends).

**Resolution vs ENOB.** Resolution is a marketing number: how many bits come out. **ENOB
(Effective Number Of Bits)** is how many of them are not noise:

```
ENOB = (SINAD_dB − 1.76) / 6.02
```

where SINAD is the measured signal-to-noise-and-distortion ratio. The `6.02` is `20·log10(2)`
— each bit is 6 dB — and the `1.76` is `10·log10(1.5)`, from the quantisation noise of an ideal
converter with a full-scale sine input. A "16-bit" ADC with 11.5 ENOB has 4.5 bits of pure
noise, and the meaningful LSB is 23× larger than the datasheet's front page implies. **Always
find ENOB**, and note that ENOB *falls with input frequency* (aperture jitter), so the ENOB at
DC is not the ENOB at your signal.

**Where the bits actually go, in practice**, which is the useful engineering point: reference
noise, PCB ground bounce, insufficient settling time on the input mux, source impedance too
high for the sampling capacitor, and — most often — the fact that your signal only uses 20% of
full scale. **Signal conditioning gain is free resolution.** Amplifying a ±100 mV signal to
±3.3 V before a 12-bit ADC is worth more than 5 extra bits of ADC.

**Sampling, aliasing, and the one thing that must be analog.**

Nyquist: to represent a signal you must sample above **twice its highest frequency**. Below
that, components above `f_s/2` do not disappear; they **fold** to `|f − k·f_s|` and appear as
lower-frequency signals that are *indistinguishable from real ones*.

> **This is the irreversibility that makes the anti-alias filter analog and mandatory.** After
> sampling, a 9 kHz component sampled at 10 kHz *is* a 1 kHz sample sequence. There is no
> information left that distinguishes it. No digital filter, no oversampling, no clever
> algorithm can recover it, because the distinguishing information was destroyed by the
> sample-and-hold, not hidden. **Therefore the low-pass filter must be analog, and it must be
> physically before the ADC.** This is one of very few genuinely absolute statements in
> engineering and it deserves to be delivered as one.

The practical version: with a 20 kHz PWM stage radiating switching noise, a control loop
sampling at 1 kHz, and no analog filter, the switching harmonics fold into your control band
and appear as a slow disturbance the controller will faithfully and destructively track. Robots
that "mysteriously oscillate at 3 Hz" are frequently a folded 20.003 kHz.

Design guidance students can apply:

- Filter corner around 1/4 to 1/10 of `f_s`, so a simple 1st/2nd-order RC gets useful
  attenuation by Nyquist. Filters are not brick walls, so leave margin.
- **Oversampling relaxes the analog filter**, which is the real reason to oversample: sample at
  10× and the analog filter only needs to attenuate above `5·f_signal`, and the sharp cutoff
  can be done digitally where it is cheap and phase-linear. Then decimate. (This is also
  precisely the ΣΔ trick.)
- Oversampling and averaging `4^n` samples buys `n` bits of resolution — **but only for noise
  that is genuinely random**, and only if there is enough noise to dither the LSB in the first
  place. A perfectly quiet, perfectly DC signal averages to the same wrong code forever.
- **Every filter costs phase.** A 1st-order filter at your loop bandwidth costs 45° of phase
  margin (§3.5), and phase margin is the budget your stability is paid from. **The anti-alias
  filter is a control-loop design parameter, not a signal-conditioning afterthought.** This is
  the sentence that ties §2 to §3.

---

## 3. Control theory at the dose an engineer actually needs

The goal here is not a controls course. It is that a student can build a loop that works, know
*why* it works, and diagnose it when it doesn't. That takes less theory than a controls
department teaches and more than a robotics tutorial gives.

### 3.1 PID, in real depth

```
u(t) = Kp·e(t) + Ki·∫e(τ)dτ + Kd·de/dt          where  e = setpoint − measurement
```

Three terms. Each has a *physical* meaning that is worth insisting on, because the meaning is
what lets you tune by reasoning instead of by flailing.

**Proportional — a spring.** `Kp·e` is a restoring effort proportional to displacement from
target. That is Hooke's law, and `Kp` is literally a stiffness. Its two properties follow
directly:

- More `Kp` = faster response and a stiffer machine.
- **P alone leaves steady-state error**, and this is not a defect, it is arithmetic: if the
  system needs a nonzero `u` to hold position (gravity on an arm, friction, a load), and
  `u = Kp·e`, then `e = u/Kp ≠ 0`. **You cannot have zero error and nonzero output from a pure
  proportional term.** Students should derive this rather than be told it; it makes integral
  action obviously necessary rather than an arbitrary third letter.

**Integral — accumulated history, and the only term that can be right.** `Ki·∫e` grows as long
as any error persists, so the *only* equilibrium is `e = 0`. That is the whole point: integral
action provides the nonzero output that P cannot, at zero error. In frequency terms it is
infinite gain at DC (§3.5).

The costs are real: it adds phase lag (−90° at all frequencies), so it eats stability margin;
it slows the response; and it introduces **windup**.

**Derivative — a damper.** `Kd·de/dt` opposes *rate of change*, so it is viscous damping. It
adds predictive action (it responds to where the error is heading), which buys phase lead and
therefore stability margin, and lets you run higher `Kp`.

Its cost is the reason most industrial loops are PI, not PID: **differentiation amplifies
high-frequency noise linearly with frequency.** A 1 mV, 10 kHz noise component differentiated
becomes `2π·10^4 ≈ 63,000` times larger relative to a 1 Hz signal of the same amplitude. Raw
`Kd` on a noisy sensor gives you a controller that is mostly amplified noise, a motor that
buzzes, and a drive that runs hot.

#### Integral windup and anti-windup

**The failure.** The actuator saturates (PWM hits 100%, the current limit clamps, the valve is
fully open). The output cannot increase, so the error persists, so the integrator keeps
integrating — accumulating a number that corresponds to control effort that was never applied
and never could be. When the setpoint is finally reached, the integrator holds a huge value,
and the controller *keeps pushing* until enough negative error accumulates to unwind it.
Result: massive overshoot and a long, slow, ugly recovery. Classic symptom: a system that
behaves well for small steps and grotesquely for large ones.

**The three standard fixes:**

1. **Conditional integration (clamping).** Simply stop integrating when the output is
   saturated *and* the error would push it further into saturation. Three lines of code, works,
   and is what most embedded implementations do.
   ```c
   float u_unsat = Kp*e + integ + Kd*d;
   float u = clamp(u_unsat, u_min, u_max);
   bool saturated = (u != u_unsat);
   if (!(saturated && (e > 0) == (u_unsat > u_max)))   // don't wind further into the wall
       integ += Ki * e * dt;
   ```
2. **Back-calculation (tracking anti-windup).** Feed the saturation error back into the
   integrator with gain `Kt`: `integ += (Ki*e + Kt*(u − u_unsat)) * dt`. Smoother and tunable;
   `Kt ≈ 1/Kp` or `√(Ki·Kd)` are common starting points. This is what serious drives use.
3. **Integrator clamping.** Bound the integrator's own value. Crude, and the bound is a magic
   number that is wrong at some operating point, but it is better than nothing and it bounds
   the worst case.

**The deeper point, which is the one worth teaching:** windup is what happens when the
controller's model of itself (a linear map from error to effort) diverges from reality (a
saturating actuator). Anti-windup is the controller being *told the truth about what actually
happened*. Every good anti-windup scheme is a feedback path from the real applied output back
into the controller state. Once you see it that way, the same pattern shows up in MPC
(constraint handling), in rate limiting, and in every cascaded loop where the inner loop's limit
must be visible to the outer loop (§3.4).

#### Derivative kick, and filtering the derivative

**Derivative kick.** If `e = r − y` and you compute `de/dt`, then a *step change in the
setpoint* `r` produces an infinite derivative — in discrete time, a single enormous spike in
`u`. The motor slams. Nothing is wrong with the plant; the operator typed a new number.

**The fix is one sign change and it is free:** differentiate the **measurement**, not the error.

```
D = −Kd · dy/dt          instead of          D = Kd · de/dt
```

Since `de/dt = dr/dt − dy/dt`, and `dr/dt = 0` except at setpoint changes, the two are identical
during normal operation and differ only in exactly the case you wanted to fix. This is
sometimes called "derivative on measurement" and **it should simply be the default**; there is
almost no reason to do otherwise. (The same argument leads to "proportional on measurement" for
setpoint-weighted PID, where `P = Kp·(b·r − y)` with `0 ≤ b ≤ 1`, letting you tune
disturbance rejection and setpoint tracking semi-independently.)

**Filtering the derivative.** Even on the measurement, differentiation amplifies noise, so a
real derivative term is always a **filtered derivative**:

```
D(s) = −Kd · s / (1 + s·Tf)          with   Tf = Kd / (N·Kp),  N typically 8–20
```

This is a high-pass that flattens out above `1/Tf` instead of rising forever, so noise gain is
bounded by `N`. The parameter `N` is the *derivative filter ratio* and it is the knob nobody
tells beginners about. Without it, `Kd` is unusable on real hardware; with it, `Kd` is a normal
tuning parameter.

#### Discrete implementation, written correctly

The naïve textbook discretisation has three separate bugs. Here is the version to actually
ship, with each fix noted:

```c
typedef struct {
    float Kp, Ki, Kd;
    float Tf;            // derivative filter time constant
    float integ;         // integral accumulator (stores the *contribution*, not raw sum)
    float y_prev;        // previous measurement  -> derivative on measurement
    float d_filt;        // filtered derivative state
    float u_min, u_max;
} pid_t;

float pid_update(pid_t *c, float r, float y, float dt)
{
    float e = r - y;

    /* Derivative on MEASUREMENT (no kick), low-pass filtered (no noise blowup). */
    float dy   = (y - c->y_prev) / dt;
    float a    = dt / (c->Tf + dt);                 // one-pole IIR coefficient
    c->d_filt += a * (dy - c->d_filt);
    c->y_prev  = y;

    float P = c->Kp * e;
    float D = -c->Kd * c->d_filt;

    float u_unsat = P + c->integ + D;
    float u       = fminf(fmaxf(u_unsat, c->u_min), c->u_max);

    /* Back-calculation anti-windup: the integrator sees what was really applied. */
    c->integ += (c->Ki * e + (1.0f / c->Kp) * (u - u_unsat)) * dt;

    return u;
}
```

Points that matter and are routinely got wrong:

- **`dt` must be the *actual* elapsed time, or it must be genuinely constant.** If you assume
  1 ms and the loop actually runs at 1.2 ms, `Ki` and `Kd` are wrong by 20%. A jittery loop
  gives *time-varying gains*, which is a nonlinear system. **This is the mathematical reason
  jitter is not a nuisance but a change of plant** (§3.7). The best practice is a hard-real-time
  fixed-rate loop with `dt` a compile-time constant; the second best is measuring `dt` from a
  hardware timer and using it. Reading a millisecond-resolution clock in a 1 kHz loop is the
  worst of both.
- **Store the integral *contribution* (`Ki` already multiplied in), not the raw error sum.**
  Otherwise, retuning `Ki` at runtime instantly rescales the accumulated history and the output
  jumps — the classic "bumpless transfer" bug.
- **Sampling is itself a delay.** A zero-order hold contributes an average of `dt/2` of dead
  time, i.e. a phase lag of `ω·dt/2` radians. At a loop rate 10× the closed-loop bandwidth that
  is ~18° of your phase margin, gone, before you tune anything. **This is why the rule of thumb
  is 10–20× oversampling of the closed-loop bandwidth**, and it is a *quantitative* reason, not
  folklore.
- Use `float` deliberately, and know that a `float` integrator accumulating small `Ki·e·dt`
  increments at 20 kHz will stop accumulating once `integ` is ~10^7 times larger than the
  increment. This is the floating-point unit's "absorption" failure in a place where it steers
  a machine. On an MCU without an FPU, fixed-point Q-format with explicit saturation is the
  right answer and the rounding analysis is a genuine exercise.

#### Practical tuning

Analytical methods (Ziegler–Nichols, Cohen–Coon) are worth knowing as history and as a starting
point, but ZN in particular is tuned for aggressive disturbance rejection and typically gives
~25% overshoot, which is unacceptable for most robotics. The procedure that actually gets used:

1. **Set `Ki = Kd = 0`.** Raise `Kp` until the response is fast with a small amount of
   overshoot or the beginnings of oscillation. If it oscillates, back off ~50%.
2. **Add `Kd`** (with the filter, `N ≈ 10`) to damp the overshoot. Raise until the response is
   crisp, then back off when you hear or see high-frequency buzz — that is the noise
   amplification arriving. `Kd` is the term that lets you go back and raise `Kp` further; a
   round or two of `Kp`↔`Kd` is normal.
3. **Add `Ki`** last and sparingly, only as much as needed to remove steady-state error in an
   acceptable time. Excess `Ki` is the most common cause of slow oscillation. **Do not add `Ki`
   before anti-windup exists.**
4. **Test the cases that break it**: a large step (windup), a disturbance push (rejection), a
   different payload (robustness), and a slow ramp (stiction and limit cycling).

The mental model that makes this systematic: `Kp` = stiffness, `Kd` = damping, `Ki` = "eventually
be right." You are choosing a spring and a damper. Ask "is the system too soft or ringing?"
rather than "should I increase the second number?"

### 3.2 Feedforward plus feedback — the actually important idea

**Feedback is fundamentally reactive: it cannot act until there is an error.** If you know
something about the system, do not make the feedback loop rediscover it every time.

```
u = u_ff(desired trajectory)  +  u_fb(error)
```

Common feedforward terms in robotics, and each is a model term you already have:

- **Gravity compensation:** `τ_ff = G(q)`, the joint torques that hold the arm against gravity
  at configuration `q`. Comes straight from the dynamics model (§4.3). Without it, a horizontal
  arm sags by exactly the steady-state error of §3.1 and the integrator has to fight gravity all
  day. **With it, the same arm can be nearly backdrivable.**
- **Velocity/inertia feedforward:** `τ_ff = M(q)·q̈_des + C(q,q̇)·q̇_des`. If you know you are
  about to accelerate, apply the torque now rather than after the error appears. This is
  "computed torque" or "inverse dynamics control".
- **Friction compensation:** add an estimated Coulomb + viscous term, `τ_f = f_c·sign(q̇) + f_v·q̇`.
  Big improvement at low speed, where stiction otherwise causes limit cycles. Note the
  `sign(q̇)` is a discontinuity at zero velocity — the compensation itself can cause chatter, so
  it is normally smoothed.
- **Back-EMF feedforward in a current loop:** `v_ff = Ke·ω`. The current loop's largest
  disturbance is entirely predictable from the measured speed (§1.1), so cancel it directly.
  A current loop with back-EMF feedforward has dramatically better tracking at speed, from one
  extra multiply.

The division of labour: **feedforward does the work, feedback fixes the model error.** With good
feedforward, the feedback signal becomes small, so you can run higher gains without saturating,
and the machine ends up both stiffer and gentler. Nearly every impressive robot demonstration is
mostly feedforward — the learned or planned trajectory produces most of the torque, and the
feedback loop is a comparatively quiet correction. This is also the honest framing of a learned
policy in §6: **the policy is a very sophisticated feedforward term**, and there is still a PID
underneath it.

### 3.3 The frequency domain, stated usefully

The full treatment is a semester. The 20% that pays for itself:

**Any linear system, driven with a sinusoid at frequency ω, outputs a sinusoid at ω with a
different amplitude and phase.** Plot amplitude ratio and phase shift against frequency and you
have a **Bode plot**, which completely characterises the system. Robotics people measure these
for real, by injecting a chirp and computing the transfer function — it is not just theory.

**Why instability happens, in one picture.** Feedback subtracts. If, at some frequency, the loop
delays the signal by 180°, the subtraction becomes an addition — negative feedback becomes
positive feedback. If the loop gain at that frequency is ≥ 1, the oscillation sustains or grows.
So:

- **Gain crossover frequency `ω_c`**: where |loop gain| = 1 (0 dB). Roughly the closed-loop
  **bandwidth** — how fast the system can respond. Everything below it is tracked; everything
  above it is ignored.
- **Phase margin**: how much phase lag is left before −180°, measured at `ω_c`. **This is the
  number that predicts overshoot and ringing.** Rules worth memorising:
  - PM ≥ 60° → well damped, little overshoot, sluggish-feeling.
  - PM ≈ 45° → the usual engineering target: fast with modest overshoot.
  - PM < 30° → ringing, sensitive to plant change.
  - PM ≤ 0° → unstable.
  A useful approximation: **damping ratio ζ ≈ PM/100** for PM below about 70°.
- **Gain margin**: how much the gain could rise before instability at the −180° frequency.
  Target 6–12 dB. Matters when the plant's gain varies — a robot arm's effective inertia
  changes by several times between configurations and payloads, and your gain margin is what
  absorbs that.

**Where phase lag comes from, so you can budget it.** This list is the single most practically
useful thing in the section, because every item is something you chose:

| Source | Phase lag |
|---|---|
| Pure time delay `T` | `−ω·T` radians — **grows without bound with frequency** |
| Sampling at rate `f_s` (ZOH) | ≈ delay of `1/(2 f_s)` |
| Computation delay (sample → actuate) | its own pure delay |
| 1st-order low-pass at corner `ω_f` | −45° at `ω_f`, → −90° |
| Anti-alias filter (§2.5) | as above, at *its* corner |
| Integral term | −90°, at all frequencies |
| Every mechanical resonance | −180° through the resonance |

**Time delay is the villain.** Because its phase lag grows linearly with frequency without
limit, delay imposes a hard ceiling on achievable bandwidth no matter how you tune:
approximately `ω_c < 1/(2T)` for anything with reasonable margin. Ten milliseconds of delay
caps you near 15 Hz, *forever*. You cannot tune your way out of a delay; you can only remove it.

> **This is the frequency-domain statement of why real-time determinism is a control
> requirement.** Latency is not slowness; it is a subtraction from your stability budget. And
> since jitter means the delay is *unknown*, you must budget for the worst case — which makes
> **the tail of your latency distribution, not the mean, the number that sets your gains.**
> Every argument in the real-time unit about p99.9 versus average is here, cashed out as a
> quantity of phase.

### 3.4 Cascade control — and why the rates differ by orders of magnitude

Almost every real motion system is three nested loops:

```
   position_ref                velocity_ref              current_ref            voltage
        │                           │                         │                     │
        ▼                           ▼                         ▼                     ▼
  ┌───────────┐   ω_cmd     ┌────────────┐    i_cmd    ┌───────────┐   duty   ┌──────────┐
  │  POSITION │────────────▶│  VELOCITY  │────────────▶│  CURRENT  │─────────▶│  BRIDGE  │
  │  ~100 Hz  │             │  1–2 kHz   │             │ 10–40 kHz │          │  20 kHz  │
  │  P / PID  │             │  PI        │             │  PI (d,q) │          │          │
  └───────────┘             └────────────┘             └───────────┘          └──────────┘
        ▲                           ▲                         ▲                     │
        │ encoder position          │ velocity estimate       │ phase currents      ▼
        └───────────────────────────┴─────────────────────────┴──────────────── MOTOR
```

**Why cascade at all** — four independent reasons, all good:

1. **The inner loop turns a hard plant into an easy one.** Without a current loop, the position
   controller commands *voltage*, and voltage-to-torque goes through the winding's `L/R`
   dynamics and the back-EMF coupling. With a current loop, the position controller commands
   *torque* directly, and torque-to-position is just `τ = J·θ̈` — a double integrator, the
   easiest plant there is. **The inner loop's job is to make the outer loop's plant simple.**
2. **Disturbances are rejected where they enter.** Supply voltage sag, temperature-driven `R`
   change, back-EMF: all electrical, all rejected by the fast current loop in tens of
   microseconds, and the position loop never sees them.
3. **Limits are enforced at the right level.** A current limit *is* a torque limit *is* a force
   limit. Clamping `i_cmd` gives you a guaranteed, physically meaningful bound on how hard the
   robot can push — this is a **safety** mechanism (§7), and the natural place to implement
   force limits for human-robot contact.
4. **Each loop is tuned separately, inner first.** Three 2-parameter problems instead of one
   6-parameter one.

**Why the rates differ by orders of magnitude — this is the key insight, and it is not
arbitrary.** Two reasons:

*Physics.* Time constants are separated by orders of magnitude, and each loop must be fast
relative to the dynamics it controls:

| Loop | Dominant time constant | Origin | Loop rate |
|---|---|---|---|
| Current | `L/R`, ~0.1–2 ms | winding electrical | 10–40 kHz |
| Velocity | `J/b` and actuator bandwidth, ~10–100 ms | rotor + reflected mechanical inertia | 1–2 kHz |
| Position | trajectory timescale, ~0.1–1 s | the task | 100–1000 Hz |

*Stability.* For the cascade decomposition to be *valid*, each inner loop must look
instantaneous to the loop outside it. If they are close in bandwidth, they interact, the
"simple plant" assumption fails, and the composite system rings in a way that neither loop's
tuning explains. The engineering rule is **each loop 5–10× the bandwidth of the one outside it**,
and since loop rate should be 10–20× loop bandwidth (§3.1), the rates end up a decade apart.
Two decades from current to position. **The orders of magnitude are forced by the physics and
the stability requirement; they are not a convention.**

**The architectural consequence, which is the point for this curriculum:**

```
  Vision-language-action policy      1–10 Hz      GPU (Jetson)         Linux, Python, best effort
  Motion planner / footstep planner  10–100 Hz    CPU                  Linux, C++, soft real-time
  Whole-body controller / MPC        100–1000 Hz  CPU, RT thread       PREEMPT_RT, hard deadline
  Joint position + velocity          1–2 kHz      MCU or RT core       bare metal / RTOS
  FOC current loop                   10–40 kHz    MCU, timer ISR       bare metal, ~25 µs budget
```

Five rates spanning four orders of magnitude, on **different processors, with different
operating systems, different languages, and different failure semantics.** A late VLA inference
means the robot does the previous thing for another 100 ms. A late current-loop iteration means
a phase current spike and possibly a destroyed bridge. **These are not the same kind of "late",
and designing them with the same tools is the most common architectural error in robotics.**

Everything the curriculum said about isolating latency-critical work from best-effort work, and
about communicating across that boundary without blocking, is *load-bearing here*. The interface
between the 1 kHz and the 10 Hz world must be a non-blocking, bounded, lock-free handoff — a
double buffer or an SPSC ring — plus a **timeout on staleness**: if no new command has arrived
in N periods, the fast loop must fall back to a safe behaviour on its own, without asking. That
timeout is the difference between a robot and an incident.

### 3.5 State space and LQR

**Why leave PID.** PID is single-input single-output. A robot arm is not: joints are coupled
through the inertia matrix, and moving joint 2 accelerates joint 3. Independent per-joint PID
treats that coupling as a disturbance, which works, up to the speeds where it doesn't.

```
ẋ = A·x + B·u          x: state vector       u: input vector
y = C·x + D·u          y: measurements
```

For a motor: `x = [θ, ω, i]ᵀ`. For a quadrotor: 12 states (position, velocity, attitude, angular
rate). For a humanoid: dozens.

**Controllability** — can `u` drive `x` anywhere? Test the rank of `[B, AB, A²B, …]`. Physically
meaningful: a differential-drive robot cannot translate sideways, and a quadrotor cannot
translate without tilting first. Uncontrollable states are a *mechanism* problem, and no
controller fixes them.

**Observability** — can you infer `x` from `y`? Rank of `[C; CA; CA²; …]`. This is the question
"do I have enough sensors", and it has a definite answer. (Also, "is the gyro bias observable?"
is the same test, and answering it is what tells you the Kalman filter of §4.5 will converge.)

**LQR.** Choose `u = −K·x` minimising

```
J = ∫ (xᵀQx + uᵀRu) dt
```

`Q` penalises state error, `R` penalises control effort. Solve the algebraic Riccati equation,
get the optimal `K`. What makes LQR pedagogically valuable is that **you tune physically
meaningful weights instead of gains**: "position error matters 100× more than velocity error,
and I have limited torque" is a statement about the task, and the solver turns it into a gain
matrix that handles the cross-coupling correctly. A common practical choice is **Bryson's
rule** — set `Q_ii = 1/(max acceptable x_i)²` and `R_jj = 1/(max acceptable u_j)²` — which
makes the weights dimensionless and gives a sane starting point in one step.

LQR also comes with a guarantee worth knowing: for the full-state-feedback continuous-time
case, the gain margin is infinite upward, 6 dB downward, and the phase margin at least 60°.
That robustness **disappears** when you add an observer (the LQG counterexample), which is a
famous and salutary result: *combining two optimal things does not give you an optimal thing.*

**LQR's limitations, honestly**: it is linear (so it needs linearisation about an operating
point — fine for a quadrotor near hover, poor for an arm across its workspace), it needs the
full state (hence an observer), and — the big one — **it cannot express constraints.** "Do not
exceed 20 A" and "do not hit that wall" are not expressible in a quadratic cost, and clipping
LQR's output destroys its optimality and can destabilise it. That is exactly the gap MPC fills.

### 3.6 MPC, and its computational cost as a real-time problem

**Model Predictive Control** is: at every timestep, solve a *finite-horizon optimal control
problem* over the next `N` steps, apply only the first control, throw the rest away, and
re-solve next step (receding horizon).

```
minimise    Σ_{k=0..N-1} [ (x_k − x_ref)ᵀQ(x_k − x_ref) + u_kᵀR u_k ] + terminal cost
subject to  x_{k+1} = f(x_k, u_k)        dynamics
            u_min ≤ u_k ≤ u_max          actuator limits
            g(x_k) ≤ 0                   state constraints: joint limits, obstacles,
                                          friction cone, ZMP / contact constraints
```

**Why it took over legged robotics and autonomous driving:** it handles constraints *natively*,
it plans ahead (so it can lean into a step before the foot lands), and it handles MIMO coupling
without effort. The constraints are the point: a legged robot's contact forces must lie inside
the friction cone or the foot slips, and that is an inequality no PID can express.

**Why it is a real-time systems problem, which is why it belongs in this curriculum:**

- **You are solving an optimisation problem inside a control period.** A 25-state, 30-step
  horizon QP has hundreds to thousands of variables, and you must solve it in 1–10 ms, **every
  period, worst case**. Not on average. This is a hard-real-time numerical computing problem
  and one of the very few places where those two worlds genuinely collide.
- **Iterative solvers do not have a fixed runtime.** Convergence depends on the data. So real
  implementations use **early termination** (a fixed iteration cap and use whatever you have),
  **warm starting** (seed with the previous solution shifted by one step — usually most of the
  work, and it is why the receding horizon is cheap in practice), and **explicit fallbacks**
  (if the solve fails or times out, use the previous solution's next step, or drop to a
  known-safe controller). *A robotics MPC that has no plan for "the solver did not converge" is
  not finished.*
- **Memory allocation is forbidden** in the loop, so real solvers (OSQP, HPIPM, qpOASES,
  acados, PROXQP) are written to work in preallocated workspaces with no `malloc`, no
  exceptions, and code-generated fixed problem sizes. This is exactly the embedded C++ subset
  the systems unit described, arriving with a reason.
- **The linear algebra is the cost.** MPC is dominated by factorising a structured (banded,
  block-tridiagonal) KKT matrix. Exploiting that structure via a Riccati recursion turns
  `O(N³·n³)` into `O(N·n³)`. **This is the numerical-linear-algebra unit deciding whether a
  robot can walk**, which is about as concrete a payoff as that material ever gets.
- **The cost/frequency trade is explicit.** Longer horizon = better behaviour = slower solve =
  lower control rate = worse behaviour. There is an optimum and you find it empirically. Common
  resolutions: a **hierarchy** — a slow (10–50 Hz) nonlinear MPC over a long horizon for gait
  and footstep planning, feeding a fast (500 Hz–1 kHz) QP-based whole-body controller that only
  solves for instantaneous joint torques given the current contact set.

**Where it runs:** MPC is a CPU workload, not a GPU one — the problems are small, sequential and
latency-bound, and kernel launch overhead alone would blow the budget. It is a good corrective
to the assumption that "compute-heavy" implies "GPU". [Sampling-based MPC (MPPI) *is* a GPU
workload, because it evaluates thousands of independent rollouts — and it is increasingly used
precisely because it parallelises and handles non-differentiable dynamics. **unverified as to
its current share of deployed systems.**]

### 3.7 Loop rate and jitter: 1 kHz with 200 µs of jitter is a different machine

This is the section that connects most directly to the real-time determinism material, and the
claim is stronger than "jitter is bad". The claim is that **jitter changes the plant.**

**Three separate mechanisms, each independently sufficient:**

**(1) The gains become time-varying.** From §3.1, the discrete controller uses `dt`. If the
implementation assumes a fixed `dt` but the true interval varies, then

```
effective Ki = Ki · (dt_actual / dt_assumed)
effective Kd = Kd · (dt_assumed / dt_actual)
```

At 1 kHz nominal with ±200 µs of jitter, `dt` ranges over 0.8–1.2 ms. `Ki` varies by ±20% and
`Kd` by ∓17%, **randomly, every cycle.** You are not controlling with a PID; you are controlling
with a PID whose gains are being dithered by an adversary. In control terms this is a
time-varying system, and the tools that guarantee stability for LTI systems do not apply.
(Measuring `dt` and dividing removes *this* mechanism — and it is the reason to do so — but not
the other two.)

**(2) The delay becomes uncertain, and you must budget for the worst case.** From §3.3, phase
margin is spent on delay. With deterministic delay you can compensate: a Smith predictor, or
just tuning with the delay in your model. With *uncertain* delay you cannot compensate, because
you do not know how much to compensate for. **You must design for the maximum.** So a 1 kHz loop
with 200 µs of jitter has, for stability purposes, the phase margin of a loop with 200 µs of
extra dead time — at a 50 Hz bandwidth that is `2π·50·200e-6 ≈ 3.6°`, which sounds small until
you notice that a system tuned for 45° has just lost 8% of its safety budget for free, and at
200 Hz bandwidth it is 14°, which is a third of it.

**(3) Jitter injects broadband noise, and some of it is in-band.** A periodic sample time that
varies randomly is equivalent to a sampling process with phase noise. The error introduced is
roughly `dx/dt · Δt` — proportional to the *signal's rate of change*. So the faster the robot
moves, the more jitter-induced noise you get, precisely when you need the loop most. And unlike
a clean tone, it is broadband, so filtering it means filtering signal.

**The comparison, made concrete.**

| | 1 kHz, ±20 µs | 1 kHz, ±200 µs |
|---|---|---|
| `dt` spread | 0.98–1.02 ms (±2%) | 0.8–1.2 ms (±20%) |
| Effective gain variation | ±2%, negligible | ±20%, a real parameter uncertainty |
| Worst-case extra phase lag @ 100 Hz BW | 0.7° | 7.2° |
| Achievable bandwidth (rule of thumb) | ~100 Hz | ~30–50 Hz, and it will still feel rough |
| Feels like | a servo | a servo with a loose bearing |
| Reproducible? | yes — tune once, works | no — behaviour changes with system load |

**The last row is the one that actually costs engineering weeks.** With bounded jitter, a gain
set that works today works tomorrow and on the other unit. With unbounded jitter, tuning becomes
non-reproducible: it works, then someone enables logging, or the network stack gets busier, or
a log file rotates, and the robot behaves differently. You cannot debug a control loop whose
plant depends on `dmesg`.

**Where jitter comes from, in the order you should look:**

1. Doing work in the loop that is not bounded: `malloc`, page faults on first touch, file I/O,
   `printf`, taking a mutex held by a lower-priority thread (priority inversion), a `std::vector`
   that grows.
2. Interrupts you did not account for — network, USB, timer ticks, and especially the encoder
   ISR of §2.1.
3. Frequency scaling, C-states, SMT contention, and **SMIs**, which are invisible to the OS and
   can cost hundreds of microseconds. This is a genuinely undebuggable-from-Linux source and
   the reason `hwlatdetect` exists.
4. Cache and TLB misses. A Cortex-M7 with a D-cache reintroduces timing variance that an M4
   simply cannot have — the exact point the microcontroller unit made, now with a consequence.
5. Garbage collection, if someone put a managed runtime in the loop. (Don't.)

**The three-line summary for students:** *Specify jitter, not just rate. Measure it, don't assume
it — histogram the inter-arrival time and look at the maximum, not the mean. And put the fast
loop on a processor where nothing else can preempt it, which is why the current loop lives on
an MCU and not on the Jetson.*

---

## 4. Kinematics, dynamics and estimation

### 4.1 Rigid-body transforms

A rigid body's configuration is a position and an orientation: 6 degrees of freedom. The
standard machinery:

**Homogeneous transforms.** A 4×4 matrix packaging rotation and translation so that composition
is matrix multiplication:

```
      ⎡ R   t ⎤        R ∈ SO(3), 3×3 rotation
 T =  ⎢       ⎥        t ∈ ℝ³,    translation
      ⎣ 0   1 ⎦
```

Then `T_A→C = T_A→B · T_B→C`, and a point transforms as `p' = T·p` with `p` in homogeneous
coordinates. This is why the 4×4 exists at all: it makes an affine map into a linear one so that
chains of frames compose associatively. **Inversion is not the matrix inverse** — you should
never call a general inverse on one:

```
      ⎡ Rᵀ  −Rᵀt ⎤
T⁻¹ = ⎢          ⎥        (because R is orthogonal: R⁻¹ = Rᵀ)
      ⎣ 0    1   ⎦
```

**Notation discipline saves more debugging time than anything else in robotics.** Adopt
`T_target_source` (or the common ROS convention `T_a_b` meaning "the pose of frame b expressed
in frame a"), and then chains type-check visually: `T_world_gripper = T_world_base ·
T_base_link3 · T_link3_gripper` — the adjacent subscripts cancel like units. Half of all
transform bugs are a reversed transform, and this convention makes them visible on the page.
This is exactly the "make illegal states unrepresentable" idea from the type-systems material,
applied with a naming convention because C++ won't do it for you (though it can: a
`Transform<World, Gripper>` template makes the compiler check it, which is a nice exercise).

**Rotation representations**, with the honest trade-offs:

| Representation | Size | Composition | Interpolation | Singularities | Notes |
|---|---|---|---|---|---|
| Rotation matrix | 9 | matmul | poor | none | 6 redundant constraints; drifts from orthogonality |
| Euler angles | 3 | awful | poor | **gimbal lock** | human-readable, 12 conventions, use for display only |
| Axis-angle / rotation vector | 3 | awful | ok | at 0 and π | compact; the Lie algebra `so(3)`; good for *increments* |
| **Quaternion** | 4 | 16 mul, 12 add | **slerp** | none | 1 redundant constraint; double cover (`q` ≡ `−q`) |

### 4.2 Quaternions, Euler angles, and gimbal lock

**Euler angles** express orientation as three successive rotations about coordinate axes. There
are 12 valid conventions (6 Tait–Bryan like ZYX yaw-pitch-roll, 6 proper Euler like ZXZ), and
they are *not* interchangeable. Every Euler bug starts with two pieces of code assuming
different conventions.

**Gimbal lock** is the real problem, and it is a *mathematical* fact, not a mechanical accident.
For ZYX (yaw-pitch-roll), when pitch = ±90°, the yaw and roll axes become parallel. Two of your
three degrees of freedom now do the same thing; you have lost one. The rotation is still
perfectly well defined, but the *representation* has become singular, and:

- The map from angles to rotations is no longer locally invertible — infinitely many (yaw, roll)
  pairs give the same orientation, so any "convert to Euler" function must make an arbitrary
  choice.
- Near the singularity, small changes in orientation require **huge, fast** changes in the
  angles. A controller or interpolator working in Euler angles will command enormous rates.
  **This is a conditioning problem** — the Jacobian of the parameterisation becomes singular and
  its condition number blows up — which is precisely the phenomenon the numerics unit described,
  now with a gimbal in it.
- It is unavoidable: it is a theorem that **no three-parameter representation of SO(3) can be
  globally non-singular.** SO(3) is not homeomorphic to any open subset of ℝ³. So you cannot fix
  gimbal lock by choosing better angles; you can only move where it is, or use more than three
  parameters.

Apollo 11's gimbal-locking IMU is the famous anecdote and it is genuinely the same phenomenon —
there the third gimbal really did become mechanically redundant, and Michael Collins' remark
about wanting a fourth gimbal is a real engineer asking for a redundant parameterisation.

**Quaternions.** A unit quaternion `q = (w, x, y, z)` with `w² + x² + y² + z² = 1` encodes a
rotation of angle `θ` about unit axis `n̂`:

```
q = ( cos(θ/2), n̂ · sin(θ/2) )
```

The half-angle is the thing to actually understand, and it explains everything else:

- A 360° rotation gives `θ/2 = 180°`, so `q = (−1, 0, 0, 0) = −q_identity`. You must rotate
  **720°** to return to the same quaternion. This is the **double cover**: `q` and `−q` represent
  the same rotation, and it is the origin of the "shortest path" fix in slerp (if the dot product
  of the two quaternions is negative, negate one before interpolating, or you take the long way
  round — a real, common bug that makes an arm swing 300° to reach a nearby pose).
- Composition: `q_total = q_2 ⊗ q_1` applies `q_1` then `q_2`. **Non-commutative**, like the
  rotations it represents.
- Conjugate `q* = (w, −x, −y, −z)` is the inverse for unit quaternions. Cheap.
- Rotating a vector: `v' = q ⊗ (0, v) ⊗ q*`.
- **Slerp**: `slerp(q₀, q₁, t) = (sin((1−t)Ω)·q₀ + sin(tΩ)·q₁)/sin Ω` with `cos Ω = q₀·q₁`.
  Constant angular velocity along the shortest geodesic on the 3-sphere. Nothing in Euler space
  does this. (Guard `sin Ω → 0` with a lerp fallback.)
- **Renormalisation.** Numerical integration drifts off the unit sphere. Renormalising is a
  division by the norm — 4 operations. Re-orthogonalising a rotation matrix requires Gram–Schmidt
  or an SVD. This is a real efficiency argument, not just aesthetics.
- Integrating angular velocity: `q̇ = ½ · q ⊗ (0, ω)`, so
  `q_{k+1} ≈ normalize(q_k + ½·dt·(q_k ⊗ (0, ω)))`, or better, the exact exponential map
  `q_{k+1} = q_k ⊗ exp(½·dt·ω)` where `exp` of a pure quaternion is
  `(cos|v|, v̂·sin|v|)`. The exact form matters at high rates.

**The practical rule, which is what a student should leave with:** *store and compute in
quaternions (or rotation matrices), display in Euler angles, never control in Euler angles.*
Nobody wants to read a quaternion, so converting for a UI is fine — but the moment an Euler
angle enters a feedback path or an interpolator, you have introduced a singularity you did not
need. [Also worth mentioning: **6D rotation representations** (Zhou et al., CVPR 2019 — the first
two columns of the rotation matrix, Gram–Schmidt'd back to SO(3)) are now standard for *neural
network outputs*, because quaternions' double cover makes them discontinuous as a regression
target and networks learn discontinuous functions badly. This connects §4 directly to §6.]

### 4.3 Forward and inverse kinematics, DH parameters, dynamics

**Forward kinematics (FK)**: joint angles → end-effector pose. Multiply the transforms down the
chain. Always solvable, always unique, cheap.

**Denavit–Hartenberg parameters** are a minimal convention for describing a serial chain: 4
numbers per joint (`a` link length, `α` link twist, `d` link offset, `θ` joint angle) instead of
the 6 a general transform needs, achieved by constraining how you place each frame (x-axis
along the common normal between consecutive joint axes). Worth teaching because it is
ubiquitous in the literature and in older manuals, worth being honest about because it is
error-prone (there are two incompatible conventions, "standard" and "modified"/Craig, and they
are silently different), degenerate for parallel axes, and modern tooling (URDF, MJCF) just
gives each joint an explicit 6-DOF transform, which is clearer. **Teach DH for literacy, use
URDF for work.**

**Inverse kinematics (IK)**: desired pose → joint angles. This is where it gets interesting,
because IK has **no solution, one solution, several, or infinitely many**:

- **No solution** — the target is outside the reachable workspace, or unreachable in that
  orientation.
- **Multiple solutions** — a 6-DOF industrial arm typically has **8** configurations reaching
  the same pose (shoulder left/right × elbow up/down × wrist flip). Choosing between them is a
  real decision with real consequences (joint limits, collisions, and *continuity* — switching
  branch mid-trajectory means a violent reconfiguration).
- **Infinitely many** — a 7-DOF arm is redundant: one extra DOF means a 1-parameter family of
  solutions (the "elbow nullspace", the self-motion manifold you can see when a human keeps
  their hand still and swings their elbow). Redundancy is what lets you satisfy secondary
  objectives — avoid an obstacle, stay away from joint limits, maximise manipulability — while
  holding the primary task.

**Analytical IK** exists in closed form for arms with structure (e.g. a spherical wrist — three
axes intersecting at a point — decouples position from orientation, which is exactly why almost
every industrial arm is built that way). Fast and complete. **Numerical IK** iterates using the
Jacobian and works for anything; slower, needs a seed, may fail. [**IKFast** generates
analytical solvers from a kinematic description; **TRAC-IK** is a well-known numerical solver
that runs an SQP and a Jacobian method in parallel and takes whichever finishes. **unverified as
to their current maintenance status.**]

**Dynamics.** FK/IK are geometry; dynamics is force.

```
M(q)·q̈ + C(q,q̇)·q̇ + G(q) + F(q̇) = τ + Jᵀ·F_ext
```

- `M(q)` — mass/inertia matrix, symmetric positive definite, **configuration-dependent**. This
  is the coupling: an arm's effective inertia at the wrist varies by several times between
  extended and folded, which is exactly the gain variation your gain margin (§3.3) absorbs.
- `C(q,q̇)·q̇` — Coriolis and centrifugal, quadratic in velocity. Negligible slow, dominant fast.
- `G(q)` — gravity. The gravity-compensation feedforward term of §3.2.
- `Jᵀ·F_ext` — external contact forces mapped to joint torques by the transposed Jacobian.

**Inverse dynamics** (given `q, q̇, q̈`, find `τ`) is solved by the **Recursive Newton–Euler
Algorithm** in `O(n)`. **Forward dynamics** (given `τ`, find `q̈`) by the **Articulated Body
Algorithm**, also `O(n)`. That both are linear in the number of joints, rather than the `O(n³)`
a naïve mass-matrix inversion would cost, is Featherstone's contribution and it is the reason
simulating a humanoid at 1 kHz is feasible at all. Libraries: **Pinocchio**, **RBDL**,
**Drake**, and the ones inside MuJoCo and Isaac.

### 4.4 The Jacobian, and what singularities mean physically

The Jacobian is the linear map from joint velocities to end-effector velocity:

```
ẋ = J(q) · q̇          (6×n for a spatial end-effector, n joints)
```

It is the derivative of forward kinematics, so it is the local linearisation of the robot's
geometry — and it does three jobs at once, which is why it is the central object:

1. **Velocity mapping**: `ẋ = J·q̇`, and inverse velocity: `q̇ = J⁻¹·ẋ` (or `J⁺`, the
   pseudo-inverse). This is the basis of numerical IK and of all resolved-rate control.
2. **Force mapping (the transpose!)**: `τ = Jᵀ·F`. The joint torques that produce a desired
   end-effector force. The transpose appears because of the principle of virtual work:
   `F·ẋ = τ·q̇` for all `q̇`, and substituting `ẋ = J·q̇` gives `Fᵀ J q̇ = τᵀ q̇`, hence
   `τ = JᵀF`. **This is the whole basis of force control and of impedance control**, and the
   derivation is short enough to do on a board. Note it needs no matrix inverse — `Jᵀ` always
   exists, even at a singularity, which is why *force* control degrades gracefully where
   *velocity* control explodes.
3. **Singularity detection**: via `det J` (square case) or the singular values of `J`.

**Singularities, physically.** A singularity is a configuration where `J` loses rank: the robot
**cannot move instantaneously in some direction of task space, no matter what the joints do.**
Not "it is hard"; it is a lost degree of freedom, momentarily.

The three canonical kinds, each with an intuition:

- **Boundary singularity** — the arm is fully extended. It cannot move further out. Obvious once
  seen and completely unavoidable: it is the edge of the workspace.
- **Wrist singularity** — on a spherical wrist, when axes 4 and 6 align (typically joint 5 = 0),
  they rotate about the same line. Two joints, one DOF. This one is nasty because it occurs in
  the *middle* of the workspace, in a perfectly ordinary-looking pose.
- **Elbow/internal singularity** — axes align internally, e.g. the wrist centre passing through
  the shoulder axis.

**Why they are dangerous, and this is the part to make visceral.** Near (not at) a singularity,
`J` is nearly rank-deficient, its smallest singular value `σ_min → 0`, and the inverse has a
term `1/σ_min → ∞`. So a **small, slow, perfectly reasonable end-effector velocity requires an
enormous joint velocity.** The robot does not stop; it *thrashes*, moving joints at maximum rate
to produce a slow Cartesian motion. Industrial arms fault out with a "singularity" alarm at
exactly this point, and operators who do not understand it think the robot is broken.

**This is exactly a matrix conditioning problem.** `κ(J) = σ_max/σ_min` is the condition number,
and everything the numerics unit said about ill-conditioned systems amplifying error applies
literally: near a singularity your IK amplifies both numerical error and sensor noise by
`1/σ_min`. **`σ_min` is a physical quantity you can feel.**

The standard mitigations are exactly the standard numerical ones:

- **Damped least squares (Levenberg–Marquardt)**: `q̇ = Jᵀ(J Jᵀ + λ²I)⁻¹ ẋ`. The `λ²` bounds the
  gain at `1/(2λ)` instead of `1/σ_min`, trading exact tracking for a bounded joint velocity.
  This is **Tikhonov regularisation**, the same tool as ridge regression, doing the same job:
  accept bias to bound variance. A student who sees this connection has understood something
  real about mathematics being reused rather than reinvented.
- **Manipulability index** `w = √(det(J·Jᵀ))` — a scalar that goes to zero at a singularity.
  Maximise it as a nullspace objective on a redundant arm so it *avoids* singularities on its
  own. Yoshikawa, 1985.
- **Plan around them**: at the trajectory level, keep `σ_min` above a threshold.
- **Redundancy**: 7 DOF means the nullspace can be used to escape.

### 4.5 The Kalman filter, derived intuitively

The Kalman filter deserves careful treatment because it is (a) genuinely everywhere, (b) usually
presented as five opaque matrix equations, and (c) actually one idea repeated.

**The one idea:**

> **You have two sources of information about the same quantity, each with a known uncertainty.
> Combine them, weighting each by how much you trust it. The result is more certain than
> either.**

**Start in 1D with no dynamics at all.** Two measurements of the same thing:
`x₁` with variance `σ₁²`, `x₂` with variance `σ₂²`. The minimum-variance unbiased combination is
the inverse-variance weighted mean:

```
x̂ = (x₁/σ₁² + x₂/σ₂²) / (1/σ₁² + 1/σ₂²)
σ̂² = 1 / (1/σ₁² + 1/σ₂²)
```

Two things to point at immediately, because they are the whole intuition:

- The weights are **precisions** (inverse variances). More certain ⇒ more weight. Obvious, once
  written.
- `σ̂² < min(σ₁², σ₂²)` **always**. Combining information always reduces uncertainty, even when
  one source is much worse than the other. Two 1 m measurements give 0.71 m. **This is why you
  fuse a bad sensor with a good one rather than discarding it**, and it is the sentence that
  makes sensor fusion feel worth doing.

Rearranged into the familiar shape:

```
x̂ = x₁ + K·(x₂ − x₁)          with  K = σ₁² / (σ₁² + σ₂²)
σ̂² = (1 − K)·σ₁²
```

**That is the Kalman update.** `K` is the Kalman gain: `K = 0` means ignore the new measurement
(you were already certain), `K = 1` means replace your estimate with it (you knew nothing).
Everything after this is adding dynamics and going to more dimensions.

**Adding dynamics: predict.** Between measurements, propagate the state with a model, and — this
is the part people skip — propagate the *uncertainty*, which always grows:

```
PREDICT
  x̂⁻ = F·x̂ + B·u                       state through the dynamics
  P⁻  = F·P·Fᵀ + Q                      covariance through the dynamics, plus process noise

UPDATE
  ỹ  = z − H·x̂⁻                         innovation: what the measurement said minus what we expected
  S  = H·P⁻·Hᵀ + R                      innovation covariance: how surprised we should be
  K  = P⁻·Hᵀ·S⁻¹                        Kalman gain: exactly σ₁²/(σ₁²+σ₂²), in matrices
  x̂  = x̂⁻ + K·ỹ
  P  = (I − K·H)·P⁻
```

**What the covariance `P` actually represents**, since this is the question students get wrong:

- `P` is the covariance of the *estimation error*, `E[(x − x̂)(x − x̂)ᵀ]`. Diagonal entries are
  the variances of each state's error; **off-diagonals are where the value is.**
- Geometrically it is an **uncertainty ellipsoid** in state space. A GPS fix gives a wide,
  round one; a road-constrained vehicle's is long and thin along the road.
- **The off-diagonal terms are the reason the filter beats an independent filter per state.**
  Suppose you estimate position and gyro bias. They are correlated: a bias produces a growing
  position error in a specific direction. That correlation lives in `P₁₂`. When a position
  measurement arrives, the gain matrix `K = P⁻HᵀS⁻¹` uses `P₁₂` to correct the **bias** — a
  state you never measured directly. *The filter estimates the gyro bias from GPS position
  fixes*, and it can do that only because it tracked the correlation. **This is the moment the
  Kalman filter stops being weighted averaging and becomes remarkable**, and it should be
  presented as the punchline.
- **`Q` and `R` are the tuning knobs and they are ratios.** `R` is measurement noise — often
  genuinely knowable from the datasheet's noise density (§2.2). `Q` is process noise, meaning
  "how wrong is my model", and it is essentially always a fudge factor. Only the ratio matters
  for the gain. Small `Q` = trust the model = smooth but laggy and prone to diverging when the
  model is wrong. Large `Q` = trust measurements = responsive but noisy. **This is exactly the
  bias/variance trade-off**, and it is the same dial as the complementary filter's `α` (§4.6).

**Numerical honesty**, which belongs here because it is where this connects to the numerics
unit: `P = (I − KH)P⁻` is the fast form and it is numerically fragile — round-off can make `P`
lose symmetry or positive-definiteness, at which point the filter produces negative variances
and diverges silently. The fixes are standard and should be named: the **Joseph form**
`P = (I−KH)P⁻(I−KH)ᵀ + KRKᵀ` (more expensive, symmetric by construction, much more stable),
forcing symmetry with `P ← (P + Pᵀ)/2`, or a **square-root / UD factorised** filter that
propagates a Cholesky factor so positive-definiteness is structural. In float32 on an MCU, this
is not academic — it is why your filter worked in Python and diverged on the target. *Same
material, real consequence.*

**The optimality claim, honestly stated:** the Kalman filter is the minimum-mean-square-error
estimator **if** the system is linear, the noise is zero-mean Gaussian and white, and `Q`, `R`
and the model are correct. In robotics, roughly none of these hold. It remains the best *linear*
unbiased estimator regardless of the Gaussian assumption, and in practice it works far outside
its assumptions — but "optimal" should never be said without the conditions attached.

### 4.6 EKF, UKF, complementary and particle filters

**EKF (Extended Kalman Filter).** Real systems are nonlinear (`x_{k+1} = f(x_k, u)`,
`z = h(x)`). The EKF linearises about the current estimate — compute the Jacobians `F = ∂f/∂x`
and `H = ∂h/∂x` at `x̂` each step — and runs the linear equations. It is the workhorse: GPS/INS,
attitude estimation, visual-inertial odometry.

Its failure modes are worth naming because they are what practitioners actually hit: it is
**not optimal**; it **diverges** if the initial estimate is poor enough that the linearisation is
invalid (and the divergence is often abrupt); the Jacobians are error-prone to derive and are a
classic bug source (numerical differentiation or autodiff is a legitimate mitigation); and it is
**inconsistent** in a specific, well-documented way in SLAM, where linearising about different
estimates at different times injects spurious information and the filter becomes overconfident.

**UKF (Unscented Kalman Filter).** Instead of linearising the function, propagate the
*distribution*: deterministically choose `2n+1` **sigma points** that match the mean and
covariance, push each through the *exact* nonlinear function, and recover mean and covariance
from the transformed points. Accurate to 3rd order for Gaussians (EKF is 1st), needs no
Jacobians at all, comparable cost. **The pitch: "it is easier to approximate a distribution than
an arbitrary nonlinear function."** Worth teaching purely for that sentence.

**Complementary filter — the cheap alternative that is often correct.** For attitude:

```
θ = α·(θ_prev + ω_gyro·dt)  +  (1−α)·θ_accel          α ≈ 0.98–0.999
```

The insight is a frequency-domain one and it is exactly §3.3's material: the **gyro** is
accurate short-term but drifts (good high-frequency information, bad low), the **accelerometer**
is noisy and corrupted by linear acceleration but has no drift (bad high, good low). So high-pass
the gyro, low-pass the accel, and choose the filters to sum to exactly 1 at every frequency —
hence "complementary". `α` sets the crossover: `τ = α·dt/(1−α)`, so `α = 0.98` at 100 Hz is a
0.49 s time constant.

Why it deserves respect rather than condescension:
- ~10 floating-point operations versus dozens of matrix operations. Runs on an 8-bit AVR.
- No tuning matrices, no divergence, no positive-definiteness to lose.
- **It is a fixed-gain Kalman filter.** A steady-state Kalman filter has a constant `K`, and for
  this problem the resulting filter *is* the complementary filter. The Kalman filter's extra
  value is (a) the transient while `P` converges, and (b) estimating states you cannot measure,
  like gyro bias. If you do not need those, the complementary filter is not an approximation —
  it is the same answer with less code.
- **Mahony** and **Madgwick** filters are the standard, better-engineered members of this family
  (they work directly on quaternions and add an integral term that estimates gyro bias, which
  recovers most of the Kalman filter's advantage). Madgwick's is what a very large fraction of
  hobby drones and AHRS units actually run.

**Particle filters.** Represent the distribution by a set of weighted samples. Predict by pushing
each particle through the (possibly nonlinear, non-differentiable) dynamics with noise; update by
reweighting each by its measurement likelihood; resample to prevent all the weight concentrating
on one particle.

- Handles **arbitrary distributions**, notably **multi-modal** ones. This is the reason they
  exist: "I am either in corridor A or the identical corridor B" is a perfectly reasonable belief
  that no Gaussian can represent. Watching an AMCL particle cloud collapse from uniform to a
  single mode as a robot drives past a distinguishing feature is *the* demonstration of what
  probabilistic estimation means, and it takes 30 seconds.
- Cost scales badly with dimension — the number of particles needed grows exponentially, so
  they are used for 3-DOF localisation on a known map (**AMCL** in ROS) but not for a 20-state
  navigation filter. **Rao-Blackwellised** particle filters (FastSLAM) mitigate this by sampling
  only the hard part and solving the rest analytically.
- **Particle deprivation** — after resampling, the true state may have no particles near it, and
  the filter can never recover. Mitigated by injecting random particles, adaptively sizing the
  set (KLD sampling), and low-variance resampling.

**Choosing, in one table:**

| | Use when |
|---|---|
| Complementary / Mahony / Madgwick | attitude only, tiny MCU, no bias-observability needs |
| KF | linear, Gaussian, and you want the correlations |
| EKF | mildly nonlinear, good initial estimate, need speed — the default |
| UKF | strongly nonlinear, or Jacobians are painful/unavailable |
| Particle | multi-modal belief, low dimension, non-Gaussian noise |
| Factor graph / smoothing (§4.7) | you can afford to revisit the past — offline or near-real-time |

### 4.7 SLAM in outline

**Simultaneous Localisation And Mapping**: build a map while localising in it. The chicken-and-egg
statement is the right way in — you need a map to localise, and a pose to build a map — and the
resolution is that the *joint* problem is well-posed even though neither half is.

**Front end — data association.** Turn raw sensor data into geometric constraints:

- Extract features (ORB, SIFT, SuperPoint) or use direct photometric methods (DSO, LSD-SLAM), or
  for LiDAR, extract planes/edges and run ICP or NDT scan matching.
- Match across frames, reject outliers (RANSAC), and estimate relative motion.
- Output: "the pose at time 5 relative to time 4 was approximately this, with this covariance."

**This is where SLAM actually fails.** The back end is a well-understood optimisation problem;
the front end is a perception problem in a world with repeated textures, moving people, glass,
darkness, and motion blur. **A single wrong data association can destroy the entire map**,
because the back end will faithfully optimise a lie.

**Back end — pose graph optimisation.** Nodes are poses (and possibly landmarks), edges are
measured relative constraints with covariances. Solve:

```
minimise over all poses:   Σ_ij  e_ij(x_i, x_j)ᵀ · Ω_ij · e_ij(x_i, x_j)
```

`e_ij` is the difference between the measured relative pose and the one implied by the current
estimates; `Ω_ij` is the information matrix (inverse covariance). This is nonlinear least
squares, solved by Gauss–Newton or Levenberg–Marquardt, **and the structure is what makes it
tractable**: each constraint touches two poses, so the Hessian is extremely sparse, and a good
variable ordering makes the Cholesky factorisation nearly linear in the number of poses.
**Sparse linear algebra is the reason real-time SLAM exists** — another direct payoff from the
numerical-linear-algebra thread. Libraries: g2o, GTSAM, Ceres.

Two refinements worth naming: the poses live on the manifold SE(3), not in ℝ⁶, so the
optimisation is done with local perturbations in the Lie algebra and retracted back (this is
where §4.2's exponential map earns its keep); and **robust cost functions** (Huber, Cauchy,
graduated non-convexity) are essential, because a single bad loop closure with a squared cost
has unbounded influence.

**Filtering vs smoothing.** An EKF-SLAM keeps only the current pose and marginalises the past —
constant memory, but errors are baked in permanently. Pose-graph *smoothing* keeps the whole
trajectory and can revise it. Smoothing won, because incremental solvers (**iSAM2**) update only
the part of the factorisation the new measurement actually touches, making a full re-solve
unnecessary. Same idea as incremental compilation, and worth pointing out as such.

**Loop closure — the thing that makes SLAM work.** Without it, odometry drifts unboundedly:
every relative measurement has error, and errors accumulate. A loop closure is the recognition
that *you have been here before*, which adds a constraint between two temporally distant poses
and lets the optimiser redistribute the accumulated drift around the whole loop. **The map
visibly snaps into alignment.** It is the single most satisfying demo in robotics and the moment
the algorithm's purpose becomes obvious.

Detection is a place recognition problem: **bag-of-words** over visual features (DBoW2) or, more
recently, learned global descriptors (NetVLAD and successors); then geometric verification
before accepting. **False positives are catastrophic and false negatives are merely
disappointing**, so the thresholds are deliberately conservative and the geometric check is
non-negotiable — a nice, concrete instance of asymmetric error costs.

**The main families**, for orientation: visual (ORB-SLAM3, DSO), visual-inertial (VINS-Mono,
OKVIS, and the tightly-coupled filters in most drones and headsets), LiDAR (LOAM/LeGO-LOAM,
Cartographer, FAST-LIO), and increasingly **learned or neural-representation** systems (NeRF- and
3D-Gaussian-Splatting-based SLAM, which change what "the map" *is* — from a point cloud to a
differentiable radiance field). [**unverified as to current state of the art**; the
Gaussian-splatting SLAM area was moving very fast as of 2024–2025 and I did not re-check it.]

---

## 5. Planning, and the software/hardware stack

### 5.1 Configuration space — the reframing that makes planning tractable

**Configuration space (C-space)** is the space of all robot configurations. For a 6-DOF arm it
is 6-dimensional; for a mobile base, SE(2); for a humanoid, 30+ dimensions.

The move that makes planning possible: **a robot with a complicated shape moving among obstacles
becomes a *point* moving in C-space among C-obstacles.** The obstacles get complicated (the
C-obstacle for even a simple 2-link arm and a single circular obstacle is a strange curved
region), but the robot becomes a point, and a point is something graph search and sampling can
handle. C-space splits into `C_free` and `C_obs`, and planning is finding a continuous path
through `C_free`.

Why this is the right abstraction to teach: it separates **geometry** (which is horrible and
belongs in a collision checker) from **search** (which is the algorithm). The planner never needs
to know the robot's shape.

Two facts that shape everything downstream:

- **C-obstacles are generally not computable in closed form** for anything realistic. You cannot
  build the map; you can only *ask* whether a specific configuration is free. This single fact is
  why sampling-based planning exists.
- **Dimension kills grids.** A grid with `k` cells per axis in `d` dimensions has `k^d` cells.
  At `k=100`, a 6-DOF arm needs 10¹² cells. Uniform discretisation is dead above about 4
  dimensions, and that is the reason for the next section.

Also worth naming: the C-space topology is not ℝ^n. A revolute joint's C-space is a circle,
so a 2-joint arm's is a **torus**, and a planner that does not know `2π ≡ 0` will happily
travel the long way round. And **non-holonomic** constraints (a car cannot move sideways; a
differential-drive robot cannot either) mean a path through `C_free` is not necessarily
*executable*, which is what separates path planning from **kinodynamic** planning.

### 5.2 Sampling-based planning: PRM, RRT, RRT*

**PRM (Probabilistic Roadmap).** Sample `N` random configurations, discard those in collision,
connect each to its `k` nearest neighbours if the straight-line path between them is
collision-free, then answer queries by connecting start and goal to the roadmap and running A\*
on it. **Multi-query**: build once, query many times. Right for a fixed workspace — a factory
cell where the robot does thousands of motions in an unchanging environment.

**RRT (Rapidly-exploring Random Tree).** Single-query, incremental:

```
tree ← {start}
repeat:
    x_rand ← random sample in C          (with probability p, x_rand ← goal — "goal biasing")
    x_near ← nearest node in tree to x_rand
    x_new  ← step from x_near toward x_rand by at most ε
    if the motion x_near → x_new is collision-free:
        add x_new to the tree with parent x_near
        if x_new is close enough to the goal: return the path
```

The property that gives it its name and makes it work: because a new node's parent is the
*nearest existing node*, the probability of extending from a given node is proportional to the
volume of its Voronoi region. Nodes on the frontier have huge Voronoi regions, so the tree is
strongly biased toward **unexplored space**. It is a Voronoi-biased random walk, and that is why
it fills a space quickly rather than diffusing.

Properties, stated honestly:

- **Probabilistically complete**: if a solution exists, the probability of finding it → 1 as
  samples → ∞. It is *not* complete: it can never report "no solution exists", only "I have not
  found one yet". Every RRT is used with a timeout, and the timeout is a design parameter.
- **Not optimal.** RRT paths are notoriously jagged and can be arbitrarily worse than optimal.
  In fact, it is a known result that RRT converges to a *non-optimal* solution almost surely.
  This is why post-processing (shortcutting: repeatedly pick two random points on the path and
  try to connect them directly) is standard and nearly free.
- **Goal biasing** (5–10%) is the single most important implementation detail; without it, RRT
  explores everywhere and finds the goal slowly.
- **RRT-Connect** grows two trees, one from start and one from goal, alternately extending each
  toward the other's newest node. Typically an order of magnitude faster, and it is what most
  practical planners actually run.

**RRT\*.** Same, plus two changes that buy **asymptotic optimality** (the path cost converges to
the optimum as samples → ∞):

1. **Choose parent**: instead of connecting `x_new` to the nearest node, examine all nodes within
   a radius `r(n)` and pick the one giving the lowest total cost-to-come.
2. **Rewire**: for each node in that radius, check whether routing it *through* `x_new` would be
   cheaper; if so, change its parent.

The radius must shrink as the tree grows, `r(n) ∝ (log n / n)^(1/d)`, which is what balances
optimality against cost. The practical cost is that RRT\* is much slower to find a *first*
solution and does a lot more collision checking, so real systems often run RRT-Connect for
feasibility and then optimise. **Informed RRT\*** restricts sampling to the ellipsoid that could
possibly improve the current solution, which dramatically accelerates convergence once any path
exists. [Karaman & Frazzoli 2011 for RRT\*; Gammell et al. 2014 for Informed RRT\*. **verified**
as the standard attributions; exact venues unchecked this session.]

**Where the time actually goes**, and it is not where students expect: profiling a sampling
planner shows **the collision checker dominates, typically 80–99% of runtime**, followed by
nearest-neighbour queries. Consequences:

- Nearest-neighbour needs a spatial index (k-d tree), and in high dimensions even that degrades —
  another concrete instance of the curse of dimensionality.
- Collision checking is where the engineering goes: broad phase (bounding-volume hierarchies,
  spatial hashing) to reject the 99% of pairs that cannot possibly collide, then narrow phase
  (GJK/EPA for convex shapes, or signed distance fields) only on survivors. **This is exactly the
  same broad-phase/narrow-phase structure as a graphics engine's**, and pointing that out ties
  the graphics unit in.
- **Edge checking is subtler than node checking.** Verifying a *motion* between two
  configurations by sampling it at fixed intervals can miss a thin obstacle. The correct answer
  is *continuous collision detection* or, more commonly, a resolution bound derived from the
  maximum velocity of any point on the robot. Naïve fixed-step edge checking is a real,
  shipped-in-production class of bug.

### 5.3 Grid search: A\* and D\* Lite

For mobile robots on 2D grids, graph search is still the right tool, and it is **the same A\***
the algorithms unit taught.

**A\***: `f(n) = g(n) + h(n)`; expand the lowest `f` first. Optimal if `h` is **admissible**
(never overestimates) and, for the graph-search version with a closed set, **consistent**
(satisfies the triangle inequality). Robotics-specific notes:

- On an 8-connected grid, Euclidean distance is admissible but loose; the **octile** distance
  is the tight admissible heuristic and is noticeably faster.
- A\* on a grid produces paths constrained to 45° increments, which are not optimal in the plane
  and look robotic. **Theta\*** and **Field D\*** relax this by allowing any-angle parent links
  with a line-of-sight check.
- **Weighted A\*** (`f = g + ε·h`, `ε > 1`) is bounded-suboptimal by a factor `ε` and often
  enormously faster — the right trade when replanning at 10 Hz. **ARA\*** runs it with a
  decreasing `ε` to give an anytime planner: it always has *a* plan, and improves it while time
  remains. Anytime behaviour is close to mandatory for a robot with a control loop waiting.

**D\* Lite** is the one that matters for real robots, and the motivating scenario is exact: a
robot is executing a plan when its sensors reveal that an edge it planned through is blocked.
Replanning from scratch is wasteful, because almost the entire search tree is still valid.

D\* Lite searches **backward from the goal** (so that the costs stored are cost-to-*go*, which
do not change as the robot moves) and maintains for each node both an estimate `g` and a
one-step-lookahead `rhs`. A node with `g ≠ rhs` is *inconsistent* — it knows something its
neighbours don't — and is put on the priority queue. When an edge cost changes, only the affected
nodes become inconsistent, and the repair propagates only as far as the change actually matters.
Typical speedups over replanning from scratch are one to two orders of magnitude in cluttered,
partially-known environments. [Koenig & Likhachev, 2002. **verified** as the standard
attribution.]

**This is incremental recomputation, and it is the same idea as incremental compilation, as
iSAM2 in §4.7, and as a reactive UI's dirty-tracking.** Naming that shared structure across
three units is worth a slide by itself.

### 5.4 Trajectory generation — from a path to something executable

A path is a sequence of configurations. A **trajectory** is a path *with time*, and the gap
between them is where robots break.

The requirements: continuity in position, velocity and often acceleration; respect for velocity,
acceleration and jerk limits; and — usually the real constraint — smoothness, because
discontinuous acceleration excites structural resonances and sounds and feels terrible.

**Trapezoidal velocity profile.** Accelerate at `a_max`, cruise at `v_max`, decelerate. Optimal
in time subject to those two limits. But acceleration is discontinuous at the corners, which
means **infinite jerk**, which excites every mode of the structure. Fine for a stepper-driven
gantry, not for anything with compliance.

**S-curve (jerk-limited) profile.** Bound the jerk `j = da/dt` too, giving a 7-segment profile.
Slightly slower, dramatically smoother, far less vibration. This is what CNC machines and good
robot controllers actually run.

**Polynomial splines.** A quintic (5th-order) polynomial per segment has 6 coefficients, exactly
enough to match position, velocity and acceleration at both endpoints — so it gives C² continuity
with a closed-form solution. This is the standard joint-space trajectory representation, and it
is what a ROS `JointTrajectory` message with positions, velocities and accelerations is asking
the controller to interpolate.

**Minimum-snap / minimum-jerk trajectories** deserve a mention because of *why* the objective is
what it is: for a quadrotor, the differential-flatness result (Mellinger & Kumar, 2011) says
that position and yaw are flat outputs — every state and input can be written in terms of them
and their derivatives — and the **thrust and body rates depend on the 4th derivative of
position**. Minimising snap therefore directly minimises actuator effort. **The objective is
chosen from the dynamics, not from aesthetics**, and that is a genuinely deep point about how to
pick a cost function. [Mellinger & Kumar, ICRA 2011. **verified** as the standard attribution.]

**Time-optimal path parameterisation (TOPP).** Given a fixed geometric path, find the fastest
timing that respects joint velocity/acceleration/torque limits. This decouples "where to go"
from "how fast", and is what industrial controllers do to hit their cycle times. TOPP-RA is the
current standard method. [**unverified** as to its present adoption.]

### 5.5 ROS 2 and DDS

**What ROS is.** Not an operating system: a middleware, a build system, and — most importantly —
a **package ecosystem and set of conventions**. Its enduring value is that a driver for your
LiDAR, a URDF for your arm, a working SLAM implementation, a visualiser (RViz) and a simulator
bridge already exist and interoperate. That is worth an enormous amount, and the honest framing
for students is that **ROS is a standard, and standards win on ecosystem, not on merit.**

**ROS 1 → ROS 2, and why.** ROS 1 had a central `roscore` (a single point of failure), a custom
TCP transport, no security, no real-time story, and no useful multi-robot support. ROS 2 was
rebuilt on **DDS (Data Distribution Service)**, an OMG standard from the defence and industrial
world, giving decentralised discovery (no master), a pluggable transport, a real security model
(DDS-Security), and QoS policies.

**The QoS model** is the interesting part, and it is genuinely well-designed. Publishers and
subscribers each declare policies, and communication only happens if they are **compatible**
(the "request vs offered" model — the publisher must offer at least what the subscriber
requests). The ones that matter:

| Policy | Options | What it means in practice |
|---|---|---|
| **Reliability** | `RELIABLE` / `BEST_EFFORT` | Reliable retries lost samples. Right for commands and configuration. **Wrong for sensor streams**: retransmitting a camera frame from 200 ms ago is worse than useless, and the retries add jitter. Sensors should be `BEST_EFFORT`. |
| **Durability** | `VOLATILE` / `TRANSIENT_LOCAL` | Transient-local means late-joining subscribers get the last N samples. This is how `/tf_static` and `/robot_description` work — you can start RViz after the robot and still see the model. |
| **History / Depth** | `KEEP_LAST(n)` / `KEEP_ALL` | `KEEP_LAST(1)` for "only the newest matters" (a state estimate). Deep queues on sensor topics are a **latency bug**: they buy throughput by storing stale data your controller will then act on. |
| **Deadline** | duration | "I promise a sample at least this often." Missing it raises a callback. **This is a first-class liveness watchdog in the middleware** (§7). |
| **Liveliness** | automatic / manual, with a lease | Detects a dead publisher, distinct from a slow one. |
| **Lifespan** | duration | Samples older than this are dropped rather than delivered. Excellent for control commands — a stale command should never be executed. |

**The QoS incompatibility failure mode** is worth flagging because every ROS 2 beginner hits it:
a `BEST_EFFORT` publisher and a `RELIABLE` subscriber simply do not connect, silently, and the
topic looks alive in `ros2 topic list` while no data flows. It is a good example of a
declarative contract system whose diagnostics are worse than its design.

**Honest criticism of ROS 2 / DDS.** This should be said plainly, because uncritical ROS
advocacy is common and students deserve better:

1. **DDS is very heavy for what most robots need.** Discovery is a distributed multicast protocol
   whose traffic grows roughly with the *square* of the number of participants, and on a large
   graph the discovery chatter alone can be a meaningful CPU and network load. Startup can take
   seconds. Many teams end up configuring static discovery peers or running a discovery server —
   i.e. reintroducing the `roscore` they left ROS 1 to escape.
2. **It is not real-time by default, and the defaults fight you.** Default allocators allocate,
   the executor is not priority-aware, and the standard single-threaded executor has known
   scheduling anomalies (it processes callbacks in a fixed category order — timers, then
   subscriptions, then services — within a wait set, which produces starvation patterns that
   surprise people). Serious real-time ROS 2 work uses careful executor configuration, real-time
   safe allocators, and often bypasses ROS for the fastest loop entirely. **In practice the
   1 kHz+ loop is not in ROS**, and this is the single most important architectural fact for a
   student to absorb (see §3.4).
3. **The vendor situation is a real cost.** Multiple DDS implementations (Fast DDS, Cyclone DDS,
   Connext) with different bugs, tuning knobs, and default behaviours; changing `RMW_IMPLEMENTATION`
   can change your system's performance and failure modes substantially. Portability is
   theoretical.
4. **The abstraction leaks.** Shared-memory transport, network interface selection, MTU and
   fragmentation for large messages (a 4K image is fragmented over UDP and one lost fragment
   loses the frame), multicast on Wi-Fi (which is broadcast-rate and terrible) — you end up
   tuning the transport anyway.
5. **Debugging distributed systems is hard**, and ROS 2 gives you a distributed system whether
   or not your robot needed one.

The fair summary: **ROS 2 is the right default because the ecosystem is worth more than the
overhead, and you should know exactly which parts of your system must not be in it.** Zenoh has
emerged as an alternative RMW addressing several of these complaints. [**unverified** as to its
current status in the ROS ecosystem.]

**PREEMPT_RT and its real limits.** The Linux real-time patch set converts most kernel spinlocks
into sleeping mutexes, makes interrupt handlers threaded (and therefore schedulable and
preemptable), and implements priority inheritance, making almost the whole kernel preemptible.
It was merged into mainline Linux in **6.12** (September 2024) for x86, x86_64, arm64 and RISC-V
[**verified** in the embedded unit's research and consistent with reporting at the time].

What it buys: worst-case scheduling latency typically in the tens of microseconds rather than
the milliseconds of a stock kernel. What it does **not** buy, and this list is the honest part:

- **It does not make your code real-time.** A page fault, a `malloc`, a priority inversion on a
  non-PI lock, or an unbounded loop is still unbounded. `mlockall()`, preallocation, and
  stack pre-faulting are still your job.
- **It costs throughput** — typically single-digit percent, sometimes more on interrupt-heavy
  workloads. You are trading average performance for a bounded tail, which is the correct trade
  and should be stated as one.
- **It cannot fix the hardware.** SMIs (System Management Interrupts) run below the OS with
  interrupts disabled and can take hundreds of microseconds; `hwlatdetect` exists to measure
  exactly this. Frequency scaling, deep C-states, thermal throttling and SMT contention all
  inject latency the kernel cannot control. On a Jetson or an x86 industrial PC these must be
  configured in firmware, and it is normal to disable them and lose power efficiency.
- **Tens of microseconds is not hundreds of nanoseconds.** For a 20 kHz current loop with a 50 µs
  period, a 30 µs worst-case scheduling latency is not usable. **This is the quantitative reason
  the current loop is on an MCU and not on Linux**, and it is the cleanest possible justification
  for the microcontroller half of the curriculum.
- The standard measurement tool is `cyclictest`, and the number that matters is the **maximum**
  over hours of running under load — not the average, not the p99. Anyone quoting an average
  latency for a real-time system has misunderstood the problem.

### 5.6 Field buses: CAN, CAN-FD and EtherCAT

**CAN (Controller Area Network).** ISO 11898. A two-wire differential bus, multi-master,
message-oriented — frames carry an **identifier**, not an address, and every node decides what to
receive.

The mechanism worth teaching is **arbitration**, because it is genuinely clever and it solves
collision without loss:

- The bus is wired-AND: dominant (0) beats recessive (1).
- All nodes wanting to transmit start simultaneously and send their identifier bit by bit while
  monitoring the bus.
- A node that transmits recessive but reads dominant has lost arbitration, and **immediately
  stops and becomes a receiver** — with no error, no corruption, and no retransmission needed by
  the winner.
- Therefore **the lowest numeric identifier wins**, arbitration is *non-destructive*, and the
  highest-priority message's latency is deterministic and computable. Contrast with Ethernet
  CSMA/CD, where a collision destroys both frames and both back off randomly.

This is a beautiful piece of design and its consequence is direct: **CAN gives you priority-based
deterministic latency for the highest-priority messages, at the cost of unbounded latency for
the lowest.** The catch, and it is the reason for the next paragraph: arbitration requires every
node to see every bit within one bit time, so **bus length and bit rate trade off** — 1 Mbit/s
is limited to about 40 m, and 125 kbit/s to about 500 m.

CAN's other properties: 8-byte payload (classic), CRC with a 5-bit Hamming distance,
automatic retransmission, and **fault confinement** — a node counts its own transmit and receive
errors and takes itself off the bus (error-passive, then bus-off) if it is malfunctioning. A
self-quarantining node is a genuinely good safety design and worth pointing at in §7.

**CAN-FD** ("flexible data rate", ISO 11898-1:2015) keeps the arbitration phase at the classic
rate — because arbitration fundamentally needs the whole bus to settle — and then **switches to
a higher bit rate for the data phase**, where only one node is transmitting and propagation
delay no longer matters. Payload goes to 64 bytes, data rate to 2–8 Mbit/s. The insight
("arbitration is what limits the speed, and arbitration is over after the identifier") is elegant
and very teachable.

CAN is ubiquitous in robotics for joint controllers: ODrive, moteus and most modern servo drives
speak CAN or CAN-FD, and it is the obvious first bus for a student project because a $3
transceiver and any STM32 gets you on it.

**EtherCAT — and why on-the-fly processing gives microsecond determinism.**

EtherCAT (IEC 61158) is the interesting one, and the mechanism is worth explaining in full
because it is a genuinely different idea from everything else in networking.

**The conventional approach**, which everyone assumes: the master sends a frame to slave 1,
slave 1 receives it, processes it, replies; then slave 2; and so on. With `N` slaves, you pay
`N` full store-and-forward latencies plus `N` frame overheads. Even at gigabit speeds, 100
slaves is milliseconds.

**What EtherCAT does instead.** The master sends **one** Ethernet frame containing a
concatenation of datagrams addressed to the whole ring. Each slave has an ESC (EtherCAT Slave
Controller — an ASIC or FPGA, *not* the slave's CPU) sitting directly in the wire. As the frame
passes through:

- The ESC reads the bits addressed to it **out of the frame as they stream past**, and writes its
  own response bits **into the same frame, in flight**, in the same pass.
- It does **not** buffer the frame, does not wait for the end, does not compute a checksum over
  the whole thing before acting, and does not generate a reply frame.
- The frame continues to the next slave, having been modified on the way through.
- The last slave in the line returns the frame; it travels back through every slave (full duplex,
  the return path) to the master, now carrying all the inputs.

The phrase in the standard is **"processing on the fly"**, and the latency it costs is the ESC's
propagation delay, on the order of **hundreds of nanoseconds per node** (typically quoted around
100–500 ns depending on the ESC) rather than a full frame time.

The consequences:

- **One frame serves the entire network per cycle.** Ethernet's per-frame overhead (preamble,
  header, IFG — about 38 bytes) is paid once instead of `N` times. With 1-byte-per-slave process
  data, EtherCAT achieves >90% payload efficiency where conventional per-node framing would be
  under 5%.
- **Cycle times of 30–100 µs for ~100 servo axes** are routine, with **jitter typically well
  under 1 µs**. That is one to two orders of magnitude better than anything running a software
  network stack, and it is achieved by *not having one in the data path*.
- **Distributed Clocks** synchronise every slave to a reference clock (usually the first slave)
  with **jitter typically under 100 ns**, by measuring propagation delays during startup and
  continuously compensating drift. This is what allows 100 servo drives to sample their encoders
  and apply their outputs *at the same instant* — which is what makes coordinated multi-axis
  motion actually work, and which is exactly the time-synchronisation problem §2.4 raised for
  LiDAR de-skewing.
- **It is standard Ethernet on the wire** — standard cable, standard PHYs, standard 100 Mbit/s
  signalling — so the physical layer is cheap and commodity. The magic is entirely in the ESC.
- The cost: **it needs the ESC hardware in every device**, and the topology is a logical ring.
  You cannot speak EtherCAT from a general-purpose NIC as a slave. As a *master*, however, you
  can, because the master just sends and receives ordinary Ethernet frames — which is why
  open-source masters (SOEM, IgH EtherCAT Master) run on a standard PC NIC with PREEMPT_RT.

**The teaching point, which is the reason this belongs in a computing curriculum:** EtherCAT
achieves determinism by **removing the store-and-forward buffer**, which is precisely the
component that every other network *adds* in order to be general. Buffering is what creates
queueing, and queueing is what creates variable latency. It is the same lesson as
zero-copy I/O, as DMA, and as kernel bypass: **the copy is the latency.** Three units, one idea.

| | CAN | CAN-FD | EtherCAT |
|---|---|---|---|
| Rate | ≤1 Mbit/s | 1 Mbit/s arb + 2–8 Mbit/s data | 100 Mbit/s |
| Payload | 8 B | 64 B | up to ~1486 B/frame, shared |
| Determinism | priority-based; high-priority bounded | same | cyclic, ~µs jitter |
| Sync | none built in | none built in | Distributed Clocks, <100 ns |
| Topology | bus | bus | ring/line (physically) |
| Typical cycle, 100 axes | not feasible | marginal | 50–100 µs |
| Cost per node | ~$3 transceiver | ~$3 | ESC ASIC, more |
| Where | joint drives, vehicles, hobby | modern drives | industrial multi-axis, humanoids |

---

## 6. Physical intelligence — the frontier

**Everything in this section is dated.** This field moves fast enough that an undated claim is
worthless, and a curriculum built on undated claims goes stale invisibly. Dates below are
arXiv v1 submission dates or blog publication dates, verified by fetching the source during this
research (2026-09-01) unless marked otherwise.

### 6.1 The classical pipeline versus learned end-to-end

**The classical pipeline**, which is what essentially every *deployed, revenue-generating* robot
runs today:

```
sense → perceive → model the world → plan → control → actuate
```

Each stage is a separate, individually testable module with a defined interface: a pose, a point
cloud, an occupancy grid, a trajectory. Its virtues are not sentimental — they are the reason it
is what ships:

- **Debuggable.** When it fails you can determine *which stage* failed, look at its input and
  output, and fix that stage. This is worth an enormous amount and is almost impossible to
  overstate.
- **Verifiable.** You can state and check properties of each module. Safety certification (§7)
  essentially requires this decomposition, because you cannot certify something you cannot
  decompose.
- **Sample-efficient in the engineering sense.** It needs no demonstration data at all. It needs
  a model, and models are cheap.
- **Reliable in structured environments** — 99.9%+ success in a fixtured cell.

Its failure mode is equally clear: **it requires the world to be modellable.** Rigid known
objects, good lighting, a fixed workspace. Deformables (cloth, cable, food), transparent and
reflective objects, contact-rich manipulation, and open-ended semantic instructions all break it
— either the perception stage cannot produce the representation, or no such representation
exists.

**Learned end-to-end** maps observations to actions with a single network. No explicit pose, no
explicit plan. Its virtue is exactly the complement: it handles what cannot be modelled, because
it never needed a model. Its costs are: enormous data requirements, no interpretability, no
verifiability, brittle and unpredictable out-of-distribution behaviour, and — the practical
killer — **you cannot fix a specific failure**; you can only collect more data and retrain, and
hope.

**Where each is actually used, as of 2026 — and this is the honest answer students need:**

| Domain | What actually ships |
|---|---|
| Industrial arms (welding, palletising, pick-and-place) | **Classical**, overwhelmingly. Taught paths or model-based planning. |
| Warehouse mobile robots (AMRs/AGVs) | **Classical** navigation (SLAM + A\*/D\* + MPC). Learned perception *within* it. |
| Warehouse picking (bin picking, singulation) | **Hybrid**: learned grasp proposal (a genuine success story) + classical motion planning. |
| Autonomous driving | **Hybrid**, trending end-to-end. Perception is entirely learned; planning is a live argument. |
| Drones (racing, inspection) | **Classical** control (§1–§4) with learned perception. |
| Legged locomotion | **Learned in simulation via RL** — this is where RL genuinely won. |
| General-purpose manipulation | **Learned** — because nothing else works at all. |
| Surgical, aerospace, nuclear | **Classical**, and it will stay classical, because of §7. |

The pattern is legible: **learning wins where modelling fails, classical wins where verification
matters, and the industry is hybrid.** The most useful framing for students is that the modern
architecture is a *cascade in the sense of §3.4* — a slow, learned, semantic layer producing
setpoints for a fast, classical, verifiable layer. **The PID did not go away.** A VLA at 10 Hz
outputs end-effector or joint targets that a 1 kHz impedance controller then tracks; the learned
part decides *what*, the classical part guarantees *how*.

### 6.2 Imitation learning, behaviour cloning and covariate shift

**Behaviour cloning** is supervised learning on (observation, action) pairs from demonstrations.
It is the simplest thing that works, and it works surprisingly well.

**Covariate shift** is why it also fails, and the argument is worth doing carefully because it is
the single most important theoretical idea in the whole area:

- Supervised learning assumes train and test data are drawn from the same distribution.
- In a control problem, **the policy's own actions determine the distribution of states it will
  subsequently see.** Test-time state distribution is a function of the learned policy, not of
  the expert.
- A small error takes the robot slightly off the expert's distribution. Off-distribution, the
  policy is less accurate, so it makes a larger error. Which takes it further off-distribution.
  **The errors compound.**
- The classic result (Ross & Bagnell, 2010): naïve behaviour cloning has regret growing as
  **O(εT²)** in the horizon `T`, where `ε` is the per-step supervised error — quadratic, not
  linear. An expert-matching supervised learner still fails at long horizons.

Concretely: a demonstrator never shows the robot how to recover from a near-drop, because they
never nearly dropped it. So the robot has no idea what to do when it nearly drops something,
which is exactly the state its own small errors will put it in.

**DAgger (Dataset Aggregation)** [Ross, Gordon & Bagnell, 2011 — **verified** as the standard
attribution; venue AISTATS 2011, arXiv 1011.0686, **date unverified this session**] is the
principled fix and it is beautifully simple:

```
π₁ ← behaviour clone on expert data D
for i = 1..N:
    roll out π_i, collecting the states it actually visits
    ask the EXPERT to label those states with the correct action
    D ← D ∪ (new states, expert labels)
    π_{i+1} ← train on D
```

The trick: **run the learner's policy, but train on the expert's labels for the states the
learner actually reaches.** This makes the training distribution equal the test distribution by
construction, and reduces the regret bound from O(εT²) to **O(εT)** — linear.

**Why DAgger is not used much in practice**, which is the honest and interesting part: it
requires an expert who can label arbitrary states *on demand*. For a human teleoperator that
means being asked "what would you do here?" while the robot is in an awkward configuration you
would never have chosen — this is exhausting, slow, ambiguous, and produces inconsistent labels.
The practical descendants are: **HG-DAgger / interactive corrections** (a human takes over only
when the policy is about to fail, which is cheap and natural), **noise injection during
demonstration** (DART — deliberately perturb the expert so recovery states appear in the data),
and **just collect much more data** — which is, honestly, what the field mostly does.

Two other structural limits of behaviour cloning worth naming:

- **Multimodality.** If the demonstration data contains two valid ways to do something (go left
  around the obstacle / go right), an L2-regression policy learns the **average**, which goes
  straight into the obstacle. This is not a training bug, it is exactly what minimising mean
  squared error is *supposed* to do. **This is the single strongest argument for diffusion
  policies (§6.3)** and it should be presented as the motivation, not as an afterthought.
- **Causal confusion.** The policy learns spurious correlates of the action rather than its
  causes — the classic being that a policy given its own previous action as input learns to
  copy it, achieving low training loss and total failure at test time. More data makes this
  *worse*, not better, which is a genuinely counterintuitive and important result.

### 6.3 Diffusion policies — why generating action sequences beats regressing them

**Diffusion Policy** [Chi et al., arXiv 2303.04137, **v1 2023-03-07** — verified] reframed the
problem, and the reframing is the content: **do not regress an action; sample from a learned
distribution over action *sequences*.**

The mechanism: train a denoising diffusion model conditioned on the observation. At inference,
start from Gaussian noise in action space and iteratively denoise (typically 10–100 steps, with
DDIM or consistency distillation used to cut this) to produce an action *chunk* — a short
trajectory, typically 8–16 steps.

**Four distinct advantages, each solving a real, specific failure:**

1. **Multimodality is represented, not averaged.** A diffusion model represents an arbitrary
   distribution. Given left-and-right demonstrations, it *samples* left or right, and both are
   valid. An MSE regressor produces the mean, which is invalid. **This is the core argument**,
   and it generalises: whenever the correct answer is one of several, generative modelling is
   the right tool and regression is the wrong one. The same argument explains why language
   models sample rather than regress.
2. **Action chunking.** Predicting a *sequence* rather than a single step and executing several
   of the predicted steps before re-planning gives temporal consistency, reduces compounding
   error over the chunk, handles idle/pause behaviour (which single-step policies famously
   stall on), and — practically important — **amortises inference cost over multiple control
   steps**, which is what makes a 100 ms model usable in a 10 ms controller. Receding-horizon
   execution of chunks is precisely MPC's structure (§3.6), arrived at from a completely
   different direction. Worth pointing out.
3. **High-dimensional action spaces** are handled naturally, because diffusion scales to
   high-dimensional outputs (as image generation demonstrated). A 35-DOF humanoid upper body
   over a 16-step horizon is a 560-dimensional output.
4. **Training stability.** The diffusion objective is a simple regression on noise, with no
   adversarial game and no mode collapse. This is why it displaced energy-based and GAN-based
   policies almost immediately; those worked in papers and not in labs.

Reported result: **average improvement of 46.9% over prior state of the art** across 15 tasks
from 4 benchmarks [verified from the abstract, 2023-03-07].

**The honest cost:** iterative denoising is expensive. 100 denoising steps of a large network
does not run at 100 Hz. The mitigations — DDIM (fewer steps), consistency models / distillation
(one or few steps), **flow matching** (a continuous-time formulation with a straighter probability
path, so fewer integration steps), and simply chunking so you only infer every N control steps —
are all essentially latency engineering, and they connect directly to the inference-optimisation
material in the AI-systems unit. **π₀ uses flow matching precisely for this reason** (§6.4).

### 6.4 Vision-Language-Action models — the timeline, with dates

The idea: take a pretrained **vision-language model** (which already knows what a mug is, what
"tidy" means, and how objects relate) and give it an **action head**. The bet is that internet-
scale semantic knowledge transfers to physical tasks, so the robot does not have to learn what a
mug is from robot data — which is fortunate, because robot data is roughly six orders of
magnitude scarcer than internet data.

**The timeline** (all dates verified by fetching the source on 2026-09-01 except where noted):

| Date | Model | What it introduced |
|---|---|---|
| **2022-12-13** | **RT-1** (Google, arXiv 2212.06817) | A transformer for real robot control at scale. EfficientNet + FiLM + TokenLearner + transformer; discretised action tokens. Established that scaling *robot* data works. Ran at ~3 Hz. |
| **2023-03-07** | **Diffusion Policy** (Chi et al., 2303.04137) | Generative action-sequence modelling (§6.3). |
| **2023-04-23** | **ACT / ALOHA** (Zhao et al., 2304.13705) | Action Chunking with Transformers; 80–90% success on fine bimanual tasks from **10 minutes** of demonstrations, on cheap hardware. |
| **2023-07-28** | **RT-2** (Google, arXiv 2307.15818) | **The key idea: express robot actions as text tokens** and co-fine-tune a VLM on web data *and* robot data together. Gave emergent semantic generalisation ("pick up the extinct animal") that RT-1 could not do. |
| **2023-10-13** | **Open X-Embodiment** (arXiv 2310.08864) | The dataset that made the field possible: **22 robot embodiments, 527 skills, 160,266 tasks, 21 institutions**, pooled. Plus RT-X models showing positive transfer *across* embodiments. |
| **2024-02-15** | **UMI** (Chi et al., 2402.10329) | Handheld grippers for in-the-wild data collection **without a robot** (§6.7). |
| **2024-05-20** | **Octo** (Berkeley et al., 2405.12213) | Open-source generalist transformer policy, **800k trajectories** from OXE, with a diffusion action head; explicitly designed for cheap finetuning to new robots on consumer GPUs. |
| **2024-06-13** | **OpenVLA** (Stanford et al., 2406.09246) | **7B** open VLA: Llama 2 backbone with a fused **DINOv2 + SigLIP** visual encoder, trained on **970k** OXE episodes. Reported beating the 55B RT-2-X while being open. Made VLA research accessible outside big labs. |
| **2024-10-31** | **π₀** (Physical Intelligence, 2410.24164 + blog) | **Flow matching** action expert on a pretrained VLM (PaliGemma), cross-embodiment (single-arm, dual-arm, mobile). Targeted 50 Hz action generation. Laundry folding as the flagship demo. |
| **2025-02-04** | **π₀ open-sourced** (PI blog) | Weights and code released, plus **π₀-FAST**, an autoregressive variant using a DCT-based action tokenizer. Materially changed what independent labs could do. |
| **2025-02-20** | **Helix** (Figure, figure.ai/news/helix) | Explicit **System 1 / System 2 split**: a **7B** VLM at **7–9 Hz** for understanding, and an **80M** transformer at **200 Hz** for control, on **two onboard low-power GPUs**, one per system. 35-DOF humanoid upper body. **~500 hours** of teleoperation. |
| **2025-03-18** | **GR00T N1** (NVIDIA, 2503.14734) | Open humanoid foundation model, same dual-system structure (VLM System 2 + diffusion transformer System 1), **jointly trained end-to-end**, on real trajectories + human video + synthetic data. |
| **2025-04-22** | **π₀.₅** (PI, 2504.16054 + blog) | **Open-world generalisation**: co-training on heterogeneous tasks with hybrid multimodal examples (images, language, object detections, semantic subtask prediction, low-level actions). Cleaning kitchens **in entirely new homes**. |
| **2025-06-03** | **SmolVLA** (Hugging Face / LeRobot) | **450M** parameters, trained only on ~**10M frames from 487 community-shared LeRobot datasets**; runs on a CPU or a MacBook; reported to beat much larger VLAs and ACT on LIBERO/Meta-World and real SO-100 tasks (~78% success). Async inference for ~30% lower latency and 2× throughput. **The "small model, open data" counterpoint.** |
| **2025-09-25** | **Gemini Robotics 1.5** (Google DeepMind) | Two models: **Gemini Robotics-ER 1.5**, an embodied-reasoning planner that can call tools including web search, and **Gemini Robotics 1.5**, the VLA that "thinks before acting". Claimed SOTA on 15 spatial-reasoning benchmarks; cross-embodiment transfer across ALOHA 2, Apptronik Apollo and Franka **without per-robot specialisation**. ER 1.5 released via Google AI Studio. |
| **2025-11-17** | **π\*₀.₆** (PI blog) | **RL from the robot's own experience** on top of a VLA, rather than imitation only — the first prominent claim that online experience improves a generalist policy in the real world. |
| **2026-02-24** | **The Physical Intelligence Layer** (PI blog) | Positioning piece on foundation models as a deployable layer across partner applications. |
| **2026-03-03** | **VLAs with Long and Short-Term Memory** (PI blog) | "Multi-Scale Embodied Memory", enabling tasks **longer than ten minutes** — an explicit attack on the horizon limitation. |
| **2026-03-19** | **Precise Manipulation with Efficient Online RL** (PI blog) | An "RL Token" extracted from the VLA to make online RL fast enough to be practical. |
| **2026-04-16** | **π₀.₇** (PI blog) | **Steerable** foundation model: unified high-level policy + **world model producing visual subgoals** + action expert. Conditioning on language, execution-speed/quality metadata, control modality (joint vs end-effector), and visual subgoals. Claims compositional generalisation, cross-embodiment transfer without task-specific data, and matching fine-tuned specialists out of the box. |

**Architectural convergence, as of 2026.** Independent groups arrived at the same structure,
which is usually a sign it is right:

```
   ┌──────────────────────────────────────────────┐
   │  SYSTEM 2   pretrained VLM (1B – 10B params) │   1–10 Hz    "what should I do"
   │  images + language → semantic latent / plan  │   GPU, 100s of ms
   └───────────────────┬──────────────────────────┘
                       │  latent tokens / subgoal
   ┌───────────────────▼──────────────────────────┐
   │  SYSTEM 1   action expert (50M – 500M)       │   30–200 Hz  "how do I move"
   │  diffusion / flow matching → action chunk    │   GPU, a few ms
   └───────────────────┬──────────────────────────┘
                       │  joint or end-effector targets
   ┌───────────────────▼──────────────────────────┐
   │  CLASSICAL      impedance / PID / whole-body │   1 kHz+     "make it so"
   └───────────────────┬──────────────────────────┘
   ┌───────────────────▼──────────────────────────┐
   │  FOC CURRENT LOOP                            │   20 kHz     §1.4
   └──────────────────────────────────────────────┘
```

**This is §3.4's cascade, with a neural network in the outer loop.** Same reasoning: each layer
makes the layer outside it face a simpler problem, and the rates separate by roughly an order of
magnitude per layer for exactly the stability and physics reasons given there. Presenting the
2026 frontier as a rediscovery of cascade control is, I think, the single most valuable framing
this curriculum can offer — and it is not a stretch, it is what the papers describe.

**Honest limitations, stated plainly** (this matters because the demo videos are very good and
the failure modes are not visible in them):

- **Success rates are not deployment rates.** Papers report 60–90% on evaluated tasks. A
  warehouse needs 99.9%+, and the gap is not a small engineering push — it is where all the
  remaining difficulty lives. Very few of these systems have public, audited, long-horizon
  reliability numbers under distribution shift.
- **Speed.** Most published VLA demos are slower than a human at the same task, often by
  several times. π₀.₇'s framing of speed/quality as a *conditioning variable* (2026-04-16) is a
  direct response to this and is a notable development.
- **Evaluation is weak and largely non-comparable.** Different labs use different robots,
  scenes, objects and success criteria. Real-robot evaluation is expensive and noisy — tens of
  trials per condition is common, giving confidence intervals wide enough to swallow most
  claimed differences. Simulation benchmarks (LIBERO, SIMPLER, Meta-World, RoboCasa) improve
  comparability but reintroduce the sim-to-real question (§6.6). **Treat cross-paper
  comparisons with real suspicion.**
- **Long horizons remain hard.** That "tasks longer than ten minutes" was a headline result in
  **2026-03** tells you where the ceiling was before it.
- **Recovery and failure detection are underdeveloped.** Policies frequently do not notice they
  have failed, and keep executing.
- **Data is the binding constraint** (§6.7), not architecture, and most groups now say so.
- **Nothing here is safety-certifiable** by the standards of §7. These systems are deployed
  behind classical safety layers, and that is not a temporary situation.

### 6.5 Reinforcement learning for control, and why it lives in simulation

**The success story is legged locomotion, and it is a genuine one.** Learning quadruped and
biped locomotion by RL in simulation and deploying zero-shot is now routine, and it produces
gaits more robust than a decade of hand-engineered controllers. The ANYmal line of work
(Hwangbo et al., ~2019) is the usual landmark [**date and venue unverified this session**], and
by the mid-2020s essentially every quadruped and humanoid locomotion controller shown publicly
was RL-trained in simulation.

**Why it must be in simulation** — the arithmetic is the argument:

- **Sample complexity.** Modern policy-gradient methods (PPO) need 10⁶–10⁹ environment steps.
  At 100 Hz that is 10⁴–10⁷ seconds of real time, i.e. **3 hours to 100+ days of continuous
  robot operation**, per training run, and you need many runs.
- **Exploration is destructive.** Early RL policies flail. A real robot exploring its action
  space breaks itself, and each break costs days.
- **Resets.** RL needs episodes, and each episode needs a reset. In simulation that is a memory
  write. In reality it is a human walking over.
- **Parallelism.** GPU-accelerated simulators run thousands of environments simultaneously
  (Isaac Gym's original contribution, now Isaac Lab). You cannot buy 4096 robots.

The counter-cases are real but narrow: RL on real hardware works for short-horizon, low-risk,
easily-reset tasks, especially when initialised from a good policy — which is exactly the shape
of π\*₀.₆ (**2025-11-17**) and the "RL Token" work (**2026-03-19**): use imitation learning to get
a competent policy, then use a *small* amount of real experience to sharpen it. **That
combination is the current best answer** and it neatly dodges both the sample-complexity problem
and the sim-to-real gap.

**Reward design is the unglamorous hard part.** Locomotion rewards in practice are sums of a
dozen shaped terms — forward velocity tracking, energy, joint limits, foot slip, contact
schedule, orientation, action rate, torque smoothness — each with a weight, and tuning those
weights is where the actual labour goes. **Reward hacking** is constant and often funny: robots
that exploit simulator contact bugs to fly, that vibrate to accumulate a velocity reward, that
fall forward efficiently. Every one of these is the specification-gaming lesson, made physical
and visible.

**Two robustness techniques worth naming** because they do most of the sim-to-real work:
**asymmetric actor-critic** (the critic sees privileged simulator state — friction, mass, contact
forces — while the actor sees only what the real robot can measure, so the value function is
easy to learn but the policy is deployable), and **teacher-student distillation** (train a
teacher with privileged information, then distil into a student that must infer that information
from a history of proprioception — which is how modern locomotion policies estimate terrain and
payload without any explicit estimator). The student is, functionally, a learned observer, and
pointing at §4.5 here closes a nice loop.

### 6.6 Sim-to-real: the reality gap

**What differs**, in roughly decreasing order of how much trouble it causes:

1. **Contact and friction.** Rigid-body contact is a non-smooth, ill-posed problem, and every
   simulator solves a *relaxation* of it (soft constraints, compliant contact, LCP with
   regularisation). Friction is modelled as Coulomb with a single coefficient; reality is
   velocity-, pressure-, temperature- and history-dependent. **This is the biggest gap and it is
   worst exactly where manipulation happens.**
2. **Actuator dynamics.** Simulators often apply commanded torque instantly. Real actuators have
   the electrical dynamics of §1.1, gearbox friction and backlash (§1.6), and a current loop with
   finite bandwidth. **Actuator network** modelling — learning the actuator's real response from
   data and putting *that* in the simulator — was one of the key ANYmal contributions and made a
   large difference.
3. **Sensor characteristics.** Real IMUs have the bias, drift and noise of §2.2. Real cameras
   have rolling shutter, motion blur, exposure lag, and JPEG artefacts. Real encoders quantise.
4. **Latency.** Simulation typically has none. The real system has sensing, computation,
   communication and actuation delay — and from §3.3 we know delay is the thing that destroys
   stability. **Simulating the delay is essential and frequently omitted.**
5. **Mass, inertia, geometry.** CAD is not the built robot. Cable routing, fasteners and
   manufacturing tolerances all differ.
6. **Deformables and fluids.** Cloth, cable, granular media, liquid — simulated poorly and slowly.

**Domain randomisation** (Tobin et al., 2017 [**date unverified this session**]) is the dominant
fix and the idea is one sentence: **randomise the simulation parameters so widely that the real
world looks like just another sample.** Randomise masses, friction coefficients, motor gains,
latencies, sensor noise, textures, lighting, camera pose. The policy cannot overfit to any
particular dynamics, so it learns a policy robust across the whole range — often by implicitly
inferring the parameters from a short observation history, which is *system identification
learned as a side effect*.

The trade-off is real and should be stated: **too little randomisation and you do not transfer;
too much and the policy becomes conservative and mediocre**, because it hedges against worlds it
will never see. The refinement is **automatic domain randomisation** — start narrow and widen the
distribution as the policy succeeds — used in OpenAI's Rubik's-cube-solving hand (~2019
[**unverified this session**]), which remains the canonical extreme example.

**System identification** is the complementary approach: rather than covering your ignorance with
randomisation, **measure the real parameters and put them in the simulator.** Excite the system
(chirps, steps, PRBS), fit a model by least squares, and get real mass, inertia, friction and
motor constants. This is classical, unfashionable, and effective. **The best practice is both:**
identify to centre the distribution, randomise around it to cover the residual error. There is
also *real-to-sim* — build the simulation from scans and video of the actual deployment
environment — which has become much more practical with 3D Gaussian splatting.

**The simulators, as of 2026-09:**

| Simulator | What it is | Verified status |
|---|---|---|
| **MuJoCo** (DeepMind) | The research standard for contact-rich control. Fast, accurate, stable soft-constraint contact solver; **MJX** for GPU-parallel rollouts. Open source (Apache 2.0). | **Latest release 3.12.0, 2026-08-20** [verified — GitHub releases]. Recent releases added a PID actuator with integral action and rate limiting (3.12.0), surface velocity fields and adhesive contact (3.11.0, 2026-07-27), and a 2× speedup on large-mesh convex collision (3.12.0). Actively and rapidly developed. |
| **Isaac Sim / Isaac Lab** (NVIDIA) | GPU-parallel simulation at scale (thousands of environments), photorealistic RTX rendering, USD scene description. Isaac Lab **succeeds Isaac Gym and Orbit** as the unified RL/robot-learning framework, built on Isaac Sim. Recent versions add multi-backend physics (including **Newton**), pluggable renderers, tactile sensors and surface grippers. | Isaac Lab v3.0.0-beta series with Isaac Sim 6.0 support **[the specific release dates returned by my fetch of the GitHub releases page were internally inconsistent and I do not trust them — see §9]**. |
| **Genesis** | Unified multi-physics platform (rigid body, FEM, MPM, PBD/SPH particles, IPC, stable fluid, with an explicit multi-solver coupler), a photorealistic renderer (Nyx) and a cross-platform compiler (Quadrants). Started as an academic project **December 2024**, now supported by Genesis AI. | **Verified from the repository README (fetched 2026-09-01):** started Dec 2024. **Important correction to widely-circulated claims: the current README makes no specific FPS or simulation-speed claims.** The "43 million FPS" figure that circulated at its December 2024 launch should not be repeated without a current, hardware-specified source — it referred to a specific trivial scene on high-end hardware and is not a general throughput number. |
| **PyBullet / Bullet** | Free, easy, widely used for teaching and quick prototypes. Contact fidelity below MuJoCo. | **unverified as to current maintenance.** |
| **Gazebo / Gz** | The ROS-ecosystem simulator: sensor plugins, ROS integration, whole-system simulation. Good for software integration, weaker for contact-rich RL. | **unverified as to current version.** |
| **Drake** (TRI) | Emphasises rigorous multibody dynamics, contact modelling and optimisation-based control; strong on verification. | **unverified as to current version.** |

**The honest summary for a curriculum:** use **MuJoCo** for learning control and RL (it is free,
fast, well documented, and the physics is trustworthy); use **Isaac Lab** when you need thousands
of parallel environments or photorealistic vision; use **Gazebo** when you are testing a ROS
system rather than a controller. And treat any simulator's marketing throughput number with the
same suspicion you would apply to a GPU vendor's peak FLOPS — it is a ceiling for a specific
scene, not a rate you will see.

### 6.7 Teleoperation and data collection — the actual bottleneck

**This is the field's stated bottleneck, and it is a hardware and human-factors problem, not an
algorithms problem.** The comparison that makes it concrete: language models train on ~10¹³
tokens scraped for free. Open X-Embodiment (**2023-10-13**) pooled the field's real-robot data
into ~1M trajectories across 22 embodiments — and that required **21 institutions cooperating**.
The ratio is not close, and robot data does not exist unless someone creates it, in real time,
at 1× speed.

**ALOHA** [Zhao et al., 2304.13705, **2023-04-23**] — "A Low-cost Open-source Hardware System for
Bimanual Teleoperation". Two leader arms and two follower arms; the operator physically
backdrives the leader arms and the followers mirror them. Why it mattered:

- **Joint-space mapping, so there is no IK and no singularity** (§4.4) in the teleoperation path.
  The operator's hands *are* the joint targets.
- **Kinaesthetic** — you feel the arm's configuration directly, which makes fine bimanual work
  possible in a way a 6-DOF mouse or a VR controller does not.
- **Cheap** (order $20–30k for the original system [**exact figure unverified this session**];
  the follow-on SO-100/SO-101 arms in the LeRobot ecosystem are in the low hundreds of dollars),
  and **open source**, so the design propagated.
- The associated result — **80–90% success on fine bimanual tasks from ~10 minutes of
  demonstration** — is the headline, and it says the bottleneck is *good* data, not *much* data.

**Mobile ALOHA** and **ALOHA 2** extended it to a mobile base and improved the hardware
[**dates unverified this session**].

**UMI (Universal Manipulation Interface)** [Chi et al., 2402.10329, **2024-02-15**] attacks the
bottleneck differently and more radically: **collect data without a robot at all.** A handheld
gripper with a wrist camera (plus fisheye mirrors for implicit stereo, an IMU, and careful
latency matching) that a human simply carries around and uses. Then train a policy on that data
and deploy it on a real gripper with the same camera geometry.

- **Data collection becomes as fast as a human doing the task**, anywhere, with no robot, no
  fixture and no lab. This is a step-change in cost per hour.
- The interface design does the work: matching the camera's viewpoint and the gripper's geometry
  between the handheld device and the robot is what makes the transfer possible. **The
  "in-the-wild" claim is the point** — data from kitchens and shops, not from a lab bench.
- The cost is that you get no robot proprioception and no force data, and the dynamics of a
  human hand differ from those of the robot arm — so the *action* label is inferred, not
  measured.

**Other approaches** in the current mix: **VR teleoperation** (Quest-based, cheap and scalable,
but no force feedback and IK-mediated so singularities intrude), **exoskeletons** (accurate
joint-space mapping, expensive), **human video at internet scale** (enormous data, but no action
labels — the field's great unexploited resource, and what π₀.₅/GR00T N1/π₀.₇ all partly attack by
co-training on it), and **autonomous data collection / self-play**, which closes the loop but
needs a policy good enough to generate useful data.

**LeRobot** (Hugging Face) is the ecosystem development that matters most for a curriculum:
standardised dataset formats, cheap open hardware (SO-100/SO-101), pretrained policies (ACT,
Diffusion Policy, π₀ ports, SmolVLA), and community-shared datasets. **SmolVLA (2025-06-03) was
trained entirely on 487 community-shared LeRobot datasets, ~10M frames** [verified] — which is
the first real evidence that *distributed, open* robot data collection can produce a competitive
model. For a student, this is the entry point: a few hundred dollars of hardware plugs into the
same data format and the same training code the research uses.

### 6.8 The compute: latency budgets and quantisation

**NVIDIA Jetson**, the de facto on-robot compute platform [**verified 2026-09-01 from
developer.nvidia.com/embedded/jetson-modules**]:

| Module | AI performance | Power |
|---|---|---|
| Jetson Orin Nano series | up to **67 TOPS** | **7–25 W** |
| Jetson Orin NX series | up to **157 TOPS** | (not stated on that page) |
| Jetson AGX Orin series | up to **275 TOPS** | (not stated on that page) |
| **Jetson AGX Thor** (T5000/T4000) | up to **2070 FP4 TFLOPS**, **128 GB** memory | **40–130 W**, configurable |

NVIDIA states Thor delivers "over **7.5× higher AI compute** than AGX Orin, with **3.5× better
energy efficiency**" [verified, same page]. The generational note that matters for this
curriculum: **the headline number moved to FP4**, which is the low-precision-format material
(§ the FP4/FP8 unit) arriving on a robot. Comparing "275 TOPS" (an INT8 number) with "2070 FP4
TFLOPS" is not a like-for-like comparison, and students should be taught to notice the units
before they believe the ratio.

**The on-robot latency budget** is the thing to make students compute, because it is where all
the previous units cash out at once:

```
For a 10 Hz policy loop:  100 ms total.

  camera exposure + readout          10–33 ms   (rolling shutter matters; §2.4's de-skew again)
  ISP / debayer / resize             2–10 ms
  transfer to GPU                    1–5 ms     (zero-copy on a Jetson's unified memory: ~0)
  vision encoder                     10–30 ms
  LLM/VLM backbone                   20–100 ms  ← usually dominant
  action head (diffusion/flow)       5–50 ms    ← depends heavily on step count
  postprocess + IPC to controller    1–5 ms
  ────────────────────────────────────────────
  total                              50–230 ms
```

Two consequences that are genuinely non-obvious and worth teaching:

- **Latency is not the same as rate**, and the distinction is a control-theory one (§3.3). Action
  chunking decouples them: infer once every 500 ms, execute 16 actions at 30 Hz from the chunk.
  Your *rate* is 30 Hz and your *latency* is 500 ms, and the robot is acting on a 500 ms-old
  view of the world. **This is dead time, and dead time is the thing that caps bandwidth**
  (§3.3). Asynchronous inference — running the next chunk's inference while executing the
  current one, as SmolVLA does for a reported 30% latency reduction and 2× throughput
  [verified, 2025-06-03] — is pipelining, exactly as the CPU-architecture unit described it, and
  it hides latency without reducing it.
- **The cascade is a latency-hiding architecture.** System 1 at 200 Hz (Helix, **2025-02-20**)
  runs while System 2 at 7–9 Hz thinks. The fast model bridges the slow model's latency. This is
  precisely why the two-system split exists, and it is a better explanation of it than "System 1
  / System 2 cognition", which is a metaphor rather than a reason.

**Quantisation for deployment**, connecting directly to the low-precision unit:

- **INT8** post-training quantisation is the standard baseline: ~4× smaller, ~2–4× faster on
  tensor cores, typically ~1% accuracy loss on vision backbones with per-channel scales and a
  calibration set.
- **FP8** (E4M3 for weights/activations, E5M2 where more range is needed) is supported from
  Hopper/Ada onward and on Thor; it keeps more dynamic range than INT8 at the same width, which
  matters for transformer activations with outliers.
- **FP4 / NVFP4 / MXFP4** is what Thor's headline number is quoted in, using microscaling — a
  shared scale per small block of values — to make 4 bits usable. This is exactly the MX-format
  material.
- **What is different about robotics**, and this is the point: the quantisation error is not just
  an accuracy number, it is **a disturbance entering a feedback loop.** A quantised policy whose
  action output is noisier produces control chatter, which excites structure, which the
  controller then fights. And a *chunked* policy's quantisation error is correlated across the
  whole chunk, so it does not average out. The practical guidance is: **quantise the perception
  backbone aggressively, quantise the action head conservatively**, and always evaluate on
  closed-loop task success rather than on open-loop action MSE — because open-loop action error
  systematically under-predicts closed-loop failure, for exactly the covariate-shift reason in
  §6.2.
- **Distillation** is often better than quantisation for the fast path: Helix's 80M System 1 at
  200 Hz [verified, 2025-02-20] is a small model trained to be fast, not a big model squeezed.

**On-robot vs off-robot** is a real architectural decision with a control-theoretic answer: Wi-Fi
adds 10–100 ms of *variable* latency, which from §3.7 is worse than a larger fixed latency, and
a network partition means the robot has no policy at all. The universal answer is that **the
safety-critical and fast loops are always on-robot**, and offloading is acceptable only for the
slow semantic layer, with a defined safe behaviour on timeout.

---

## 7. Safety, seriously

This section is short relative to its importance, but the framing is the part that matters, and
it is a framing most software curricula never deliver:

> **A safety function must not depend on the correctness of your application software.** The
> control loop, the RTOS, the policy, the planner — all of it is assumed to be able to fail
> arbitrarily. Safety is what remains true when it does.

That is a genuinely different design stance from "write correct code, handle errors", and it is
the right note to end an engineering curriculum on.

### 7.1 E-stops are hardware

An emergency stop is a **normally-closed** contact in a **hard-wired** circuit that removes
motive power. It is not a GPIO read. It is not a ROS topic. It is not a message.

The design properties, each with a reason:

- **Normally closed, so it is fail-safe.** A cut wire, a loose connector, a corroded contact or
  a lost supply all *open* the circuit and therefore *stop* the machine. A normally-open button
  fails to a state where pressing it does nothing, silently, and you find out when you need it.
  **This is the single most important idea in the section, and it generalises far beyond
  e-stops**: design so that the failure of a component produces the safe state, rather than
  requiring a working component to reach it.
- **Latching**, so releasing the button does not restart the machine. Restart requires a
  deliberate, separate reset action.
- **Dual-channel** with **cross-monitoring** on anything above the lowest safety category: two
  independent contacts, and a safety relay that checks they agree and that they *change together*.
  This detects a single welded contact or a single broken wire — a fault that would otherwise
  sit latent until the day it matters.
- **Directly wired into a safety relay or safety PLC** that removes power, with the relay's own
  contacts monitored (positively guided/mechanically linked contacts, so a welded output is
  detectable).
- Under **IEC 60204-1** the stop categories are worth knowing because they are frequently
  confused: **Category 0** is immediate removal of power (uncontrolled stop — the machine coasts
  or drops); **Category 1** is a controlled stop *with power available to the actuators*, then
  power removal; **Category 2** is a controlled stop with power maintained. For a robot arm
  holding a load, Category 0 may be *less* safe than Category 1, because removing power to a
  non-backdrivable arm is fine but removing it from a backdrivable one lets it fall. **The
  correct stop category is a function of your mechanism** — which is §1.6 and §1.7 turning into
  a safety decision.

### 7.2 Watchdogs

A **watchdog timer** is a hardware counter that resets the processor if software does not
periodically "kick" it. Its whole value is that it is independent of the thing it monitors.

The rules that separate a real watchdog from a decorative one:

- **Kick it from one place only**, at a point in the code that proves the *whole* system is
  functioning — typically at the end of the main control cycle, after all the work is done.
  Kicking from a timer interrupt is the classic mistake: the interrupt keeps firing while the
  main loop is deadlocked, and the watchdog cheerfully certifies a hung system.
- **A windowed watchdog** (kick too *early* and it also resets) catches a runaway loop that is
  spinning too fast, which a plain watchdog cannot.
- **An independent clock source** (STM32's IWDG runs from its own LSI oscillator) means a PLL
  failure does not disable the watchdog along with everything else.
- **Know what reset means for your machine.** A processor reset with the power stage still
  enabled and the last PWM duty latched in the timer is worse than no reset at all. The reset
  must drive the power stage to a safe state — which is why bridge drivers have a hardware
  enable pin with a pull-down, and why the MCU's GPIOs default to inputs on reset.
- **Watchdogs at every level.** The MCU watches itself; the Linux side watches the MCU with a
  heartbeat; the MCU watches the Linux side (**and this direction is the one people forget**:
  if the Jetson stops sending commands, the joint controller must autonomously enter a safe
  state after N missed periods, not hold the last command forever). ROS 2's **Deadline** QoS
  (§5.5) is exactly this mechanism at the middleware layer.

### 7.3 Safe Torque Off, and the safety functions of IEC 61800-5-2

**STO (Safe Torque Off)** is a hardware input on a motor drive that **removes the gate drive
signals to the power transistors**, so the drive cannot produce torque, *regardless of what the
drive's own processor is doing*. It is typically dual-channel and it does not go through the
firmware.

Why it is better than "set the PWM duty to zero in software":

- It works when the firmware has crashed, when the DSP is executing garbage, or when the
  controller has been compromised.
- It is testable and diagnosable — the drive can report STO status independently.
- It does **not** remove DC-bus power, so the drive stays alive, keeps its encoder position, and
  can restart in milliseconds instead of seconds. **The machine recovers without a homing
  cycle**, which is why STO is used instead of a contactor: it is the safety function that is
  cheap enough to actually use, so people use it, so it makes systems safer in practice.

Important honesty: **STO means "no torque". It does not mean "stopped".** A moving load coasts;
a vertical axis **falls**. A vertical axis therefore needs a mechanical brake, and the brake must
be **spring-applied and electrically released** so that loss of power engages it. (Another
instance of "the failure produces the safe state".)

Related functions from the same standard, worth naming so students recognise them on a datasheet:
**SS1** (safe stop 1: controlled deceleration, then STO), **SS2** (safe stop 2: controlled stop,
holding position under power), **SLS** (safely-limited speed — the function that permits a human
in the workspace during teaching), **SLP** (safely-limited position), and **SBC** (safe brake
control).

### 7.4 The standards, and what they actually say

The point of teaching these is not compliance detail — it is that **safety is quantified**, and
that the quantification changes how you design.

**ISO 13849-1 — Safety of machinery, safety-related parts of control systems.** The one an
engineer meets first. It assigns a required **Performance Level (PL a–e)** to each safety
function, determined by a risk graph over three variables: **S** severity (reversible /
irreversible injury), **F** frequency and duration of exposure, **P** possibility of avoiding
the hazard. You then design a system that *achieves* that PL, which depends on:

- **Category (B, 1, 2, 3, 4)** — the architecture. Cat B/1 is single-channel; Cat 2 adds
  periodic testing; **Cat 3 is dual-channel with single-fault tolerance**; **Cat 4 additionally
  requires that accumulated faults do not cause loss of the safety function.**
- **MTTF_D** — mean time to dangerous failure of each channel.
- **DC** — diagnostic coverage: what fraction of dangerous failures are actually detected.
- **CCF** — common cause failure: the score for whether your two "independent" channels can be
  killed by one event (same power supply, same connector, same EMC, same designer's same
  misconception). **This is the row engineers ignore and it is the row that gets people hurt** —
  redundancy that shares a failure cause is not redundancy.

The important pedagogical content: **redundancy alone is not enough; you must be able to detect
that one channel has failed**, otherwise you are running single-channel and do not know it. That
is what DC measures, and it is why safety systems constantly test themselves.

**IEC 62061** is the sector equivalent using **SIL 1–3** rather than PL; the two systems map
onto each other approximately, and modern practice increasingly uses **ISO 13849-1** for
machinery.

**ISO 26262 — Functional safety for road vehicles.** Uses **ASIL A–D**, derived from **S**
severity × **E** exposure × **C** controllability. The "C" is the interesting axis and does not
appear in the machinery standards: *can a normal driver avoid the harm if the system fails?* Its
practical demands are a full V-model lifecycle, hazard analysis (HARA), safety requirements
traced to code, **freedom from interference** between mixed-criticality software on the same
processor (hence MPU/MMU partitioning, and hypervisors), and rigorous verification. It is also
where the "no dynamic memory allocation, no recursion, MISRA C" style of embedded engineering
comes from, and stating that connection makes those rules feel like consequences rather than
dogma.

**ISO 10218 — Robots and robotic devices, safety requirements for industrial robots**, in two
parts (**-1** the robot, **-2** the robot system and integration). This is *the* industrial-robot
safety standard. The four collaborative-operation modes it defines (elaborated in the technical
specification **ISO/TS 15066** for collaborative robots) are the genuinely interesting content:

1. **Safety-rated monitored stop** — the robot stops when a human enters; it resumes when they
   leave. No power removal, so recovery is instant.
2. **Hand guiding** — the operator moves the robot directly with a guiding device, with
   safely-limited speed and an enabling device.
3. **Speed and separation monitoring** — the robot continuously slows as a human approaches,
   maintaining a protective separation distance computed from both parties' speeds and the
   system's own stopping distance and reaction time. **This is a real-time computation whose
   inputs include your own worst-case latency** — §3.7's jitter budget appearing in a safety
   calculation, which is about as direct a connection as this curriculum can offer.
4. **Power and force limiting** — the robot is *designed* so that a collision cannot injure,
   with per-body-part force and pressure limits given in ISO/TS 15066. This is the mode that
   makes fenceless collaborative robots possible, and it is achieved through mechanism (low
   inertia, rounded surfaces, compliance — §1.7) plus torque sensing plus current limiting
   (§3.4's inner loop **as a safety function**).

[**ISO 10218-1 and -2 were revised, with the revision published in 2025** — I am fairly confident
of this but **could not verify it in this session**; see §9. The four collaborative modes and the
existence of ISO/TS 15066 are long-standing and well established.]

### 7.5 Redundancy and failure modes

**Redundancy patterns**, with the caveats that matter:

- **Dual-channel with cross-checking** — two sensors/paths that must agree. Detects a single
  fault; cannot decide which channel is right, so it fails safe (stops).
- **Triple modular redundancy (TMR) with voting** — three channels, majority wins. Can *continue*
  through a single fault, which is why aerospace uses it and machinery usually does not. Much
  more expensive.
- **Diverse redundancy** — deliberately *different* implementations (different sensor
  technologies, different processors, different teams, different algorithms). This is what
  actually addresses common-cause failure, since two copies of the same design share the same
  design bug. Expensive, and the reason a safety-rated LiDAR scanner and a safety-rated
  light curtain are sometimes both installed.
- **A simple, independent safety monitor** — often the best value in robotics: a small, simple,
  verifiable supervisor (position limits, velocity limits, force limits, deadman) running beside
  a complex, unverifiable main controller, with authority to trigger STO. **This is the only
  practical way to deploy a learned policy in a system that must not hurt anyone**, and it is
  the architectural answer to §6.4's "nothing here is certifiable". The complex system proposes;
  the simple system disposes.

**Failure modes a robotics engineer must have thought about in advance**, each with its designed
response:

| Failure | What must happen |
|---|---|
| Encoder disconnects / gives garbage | Detect (illegal quadrature transition §2.1, out-of-range, no change while commanded) → STO. **A FOC drive with a bad angle produces full current at the wrong angle** — this is a dangerous failure, not a degraded one. |
| Communication link lost | Bounded timeout → each joint autonomously enters its safe state. Never hold the last command indefinitely. |
| Main controller hangs | Watchdog → reset → power stage safe by hardware default. |
| Power loss mid-motion | Vertical axes held by spring-applied brakes; nothing depends on power to be safe. |
| Overcurrent / short | Hardware comparator → gate shutdown in microseconds, **not** a software current check at 20 kHz. |
| Overtemperature | Derate, then STO. Thermal models plus sensors, because the winding is hotter than the sensor. |
| Software bug / policy does something absurd | Independent safety monitor with position, velocity and force limits + STO authority. |
| Sensor drifts slowly (the hard one) | Cross-check against a redundant or model-derived estimate; the Kalman filter's **innovation** (§4.5) is a ready-made, principled fault detector — a persistently large or biased innovation means the model and the sensor disagree, and something is wrong. |
| Operator error | Interlocks, enabling devices (the three-position "deadman" that stops if squeezed *or* released), and mode-dependent speed limits. |

That last row is worth a sentence: **the three-position enable switch is a small design
masterpiece.** Released = stop. Held lightly = permit motion. Squeezed hard = stop. It is
engineered around the startle reflex — a frightened human clenches — and it means the failure
mode of panic is safety. Design for the human you actually have.

---

## 8. Curriculum: six units, in dependency order

**Positioning.** This is the last part of the course, and it should be presented as the part
where everything is due at once. The framing sentence for the unit introduction:

> Every earlier unit had a deadline you set. This one has a deadline physics sets. If your loop
> is late, the arm does not wait — it keeps going at the velocity it had.

Prerequisites from earlier parts, which should be *stated* so students see the debt being
called in: the microcontroller unit (timers, interrupts, no MMU, FPU or its absence), the
real-time unit (WCET, jitter, priority inversion, PREEMPT_RT), sensors and ADCs, floating point
and conditioning, linear algebra, graph search, concurrency (lock-free handoff), the GPU, and
the AI-systems layer (transformers, quantisation).

### The six units

| # | Unit | **The ONE idea** | Depends on |
|---|---|---|---|
| **R1** | **Actuation and the power stage** | *Current is torque.* Everything a robot does mechanically, it does by choosing a current — and the software that chooses it is the safety device. | MCU timers/PWM, transistors |
| **R2** | **The analog boundary** | *After you sample, the damage is unrecoverable — so the anti-alias filter is analog, and it is a control-loop parameter.* | ADC unit, signals |
| **R3** | **Feedback and the loop** | *A control loop is a negotiation with delay: every microsecond of latency is subtracted from your stability budget, and jitter means you must budget the worst case.* | R1, R2, real-time unit |
| **R4** | **Geometry and belief** | *You never know where the robot is; you maintain a distribution, and its off-diagonal terms let you estimate what you cannot measure.* | R3, numerics, linear algebra |
| **R5** | **Deciding and the stack** | *Planning is graph search over configuration space; determinism on the wire comes from removing buffers, not from adding priority.* | R4, algorithms, networking |
| **R6** | **Learned policies and the honest frontier** | *The learned policy is the outer loop of a cascade — it decides what, and a classical, verifiable loop still guarantees how.* | R1–R5, GPU, AI systems |

Safety (§7) is not a seventh unit. It is threaded through R1 (current limit as a force limit),
R3 (watchdog, timeout, safe state), R5 (deadline QoS) and R6 (the independent safety monitor),
because it is a property of the whole system and teaching it as a module invites students to
treat it as one.

#### R1 — Actuation and the power stage
Brushed DC (§1.1), the torque–speed line, `Kt = Ke`, back-EMF as a free observer. H-bridge, PWM,
**shoot-through and dead time**, flyback and regeneration, current sensing and *when* to sample
(§1.2). BLDC vs PMSM, six-step, then **FOC with Clarke and Park done properly** (§1.4). Steppers
as the open-loop null hypothesis (§1.5). Gearboxes and `N²` reflected inertia; SEA vs QDD (§1.6,
§1.7).
*Exercises:* **C** (Clarke/Park), **H** (cross-compile the Park transform to M4F vs M0).

#### R2 — The analog boundary
Encoders and quadrature (§2.1). IMUs: what each sensor actually measures, and the drift
arithmetic that proves an IMU alone cannot navigate (§2.2). Force/torque and the trend toward
current sensing (§2.3). LiDAR and de-skewing (§2.4). **SAR vs ΣΔ, resolution vs ENOB, aliasing
and the analog filter** (§2.5).
*Exercises:* **B** (quadrature decode with error detection), plus a paper exercise computing the
IMU drift budget and the interrupt load of a 4000 CPR encoder at 3000 RPM.

#### R3 — Feedback and the loop
PID in depth, anti-windup, derivative kick and filtering, the correct discrete implementation
(§3.1). Feedforward (§3.2). Bode, phase margin, and the delay budget (§3.3). Cascade control and
why the rates separate (§3.4). State space, LQR (§3.5), MPC as a real-time numerics problem
(§3.6). **Jitter as a change of plant** (§3.7).
*Exercises:* **A** (PID vs a simulated first-order plant, asserting settling time and overshoot),
extended with a jitter injection variant (below).

#### R4 — Geometry and belief
Transforms and notation discipline; **quaternions, Euler angles, gimbal lock** (§4.1, §4.2).
FK/IK, DH, dynamics (§4.3). **The Jacobian and singularities as conditioning** (§4.4). The Kalman
filter derived from inverse-variance weighting; what `P` means; EKF/UKF; the complementary filter
as a fixed-gain Kalman filter; particle filters (§4.5, §4.6). SLAM in outline (§4.7).
*Exercises:* **E** (2-link FK/Jacobian/IK/singularity), **F** (quaternions and gimbal lock),
**D** (1-D Kalman beating the raw sensor).

#### R5 — Deciding and the stack
C-space and why grids die above 4 dimensions (§5.1). RRT/RRT\*/PRM and the fact that collision
checking is 80–99% of the runtime (§5.2). A\*, D\* Lite as incremental recomputation (§5.3).
Trajectory generation (§5.4). ROS 2, DDS QoS, and honest criticism; PREEMPT_RT and its limits
(§5.5). CAN arbitration and **EtherCAT's on-the-fly processing** (§5.6).
*Exercises:* **G** (deterministic RRT with shortcut post-processing).

#### R6 — Learned policies and the honest frontier
Classical vs end-to-end and where each ships (§6.1). Behaviour cloning, covariate shift, DAgger
(§6.2). Diffusion policies and why generative beats regression (§6.3). The dated VLA timeline
and the System 1 / System 2 convergence *as cascade control* (§6.4). RL in sim (§6.5). Sim-to-real
(§6.6). **Data collection as the bottleneck** (§6.7). Compute, latency budgets, quantisation
(§6.8). Then §7 in full.
*Exercises:* a latency-budget calculation for a given robot and model; **a written critique** of
one VLA paper's evaluation methodology (this is the most valuable exercise in R6 and it needs no
hardware); and a LeRobot/SmolVLA finetune if a GPU is available.

---

### 8.1 Machine-checkable exercises — verified against the Compiler Explorer API

Every program below was submitted to the Compiler Explorer API during this research
(**2026-09-01**) and the transcripts are real output. **CE caches by content**, including
timings, so **every submission carried a unique `// ce-nonce: N` first line**; the nonces are
recorded so the results are traceable and so re-running produces a fresh compile rather than a
cached one.

**API recipe** (this is the whole thing; no key, no auth):

```
POST https://godbolt.org/api/compiler/<compiler-id>/compile
Content-Type: application/json
Accept: application/json

{ "source": "// ce-nonce: 1234567890\n#include <cstdio>\nint main(){...}",
  "compiler": "g142",
  "options": {
      "userArguments": "-O2 -std=c++20",
      "executeParameters": { "args": [], "stdin": "" },
      "compilerOptions": { "executorRequest": true },
      "filters": { "execute": true } },
  "lang": "c++",
  "allowStoreCodeDebug": true }
```

The response is JSON with `code` (the *run* exit status), `stdout`, `stderr`, `execTime`,
`okToCache`, and a nested `buildResult` with the compile status. **An `assert` that fires gives a
nonzero `code` and an abort message on `stderr`**, which is exactly the machine-checkable
property we want: *the grader is `code == 0`.*

Set `"executorRequest": false` and `"filters": {"execute": false, "intel": true, ...}` to get the
assembly back in an `asm` array instead — used for exercises H and I.

**Verified compiler ids used here** [fetched from `https://godbolt.org/api/compilers/c++` on
2026-09-01; the endpoint returned **1197** C++ compilers]:

| id | compiler |
|---|---|
| `g142` | x86-64 GCC 14.2.0 |
| `armg1520` | ARM GCC 15.2.0 (arm32) |
| `avrg1520` | AVR gcc 15.2.0 |
| `arm64g1520` | ARM64 gcc 15.2.0 (aarch64) |

---

#### Exercise A — PID against a simulated first-order plant

*Assert settling time < 1.5 s, overshoot < 10%, steady-state error < 1%.*

Plant: `τ·ẏ + y = K·u` with `K = 2.0`, `τ = 0.5 s`, exactly discretised with a zero-order hold at
`dt = 1 ms`. The controller is the correct implementation from §3.1 — derivative on measurement,
filtered derivative, back-calculation anti-windup, output saturation at ±5.

```cpp
struct PID {
    double Kp, Ki, Kd, Tf;
    double integ = 0, y_prev = 0, d_filt = 0;
    double umin, umax;
    bool first = true;
    double update(double r, double y, double dt) {
        double e = r - y;
        if (first) { y_prev = y; first = false; }
        double dy = (y - y_prev) / dt;
        double a  = dt / (Tf + dt);
        d_filt += a * (dy - d_filt);
        y_prev = y;
        double u_unsat = Kp*e + integ - Kd*d_filt;      // derivative on measurement
        double u = std::min(std::max(u_unsat, umin), umax);
        integ += (Ki*e + (1.0/Kp)*(u - u_unsat)) * dt;  // back-calculation anti-windup
        return u;
    }
};
// ... simulate, track ymax and the last time outside the 2% band ...
assert(t_settle > 0.0 && t_settle < 1.5);
assert(overshoot < 10.0);
assert(sserr < 1.0);
```

**Verified transcript** — `g142`, `-O2 -std=c++20`, nonce `2998993042`, build 0, run 0,
execTime 26 ms:

```
settling_time = 0.2560 s
overshoot     = 1.145 %
steady_error  = 0.00012 %
PASS
```

**Variants that make it a real exercise**, in order of difficulty:
1. **Delete the anti-windup** and rerun with a setpoint of 5.0 (which saturates the actuator).
   The overshoot assertion fires. *The student sees windup rather than being told about it.*
2. **Differentiate the error instead of the measurement** and step the setpoint mid-run; observe
   the derivative-kick spike in `u`.
3. **Set `Tf = 0`** and add measurement noise; the derivative term becomes unusable.
4. **Inject jitter** — perturb `dt` by ±20% with a seeded LCG while the controller still assumes
   1 ms — and require the student to find the largest `Kp` that still meets the assertions. This
   is the §3.7 result, measured. Then let the controller *use the true `dt`* and measure how much
   of the loss that recovers (some, not all — mechanism 2 and 3 remain).

#### Exercise B — Quadrature decoding from a captured trace

*Assert a net count of 9 and exactly 1 detected illegal transition.*

The trace is 25 synchronous samples of A and B: 12 counts forward, 4 samples stationary, 5 counts
reverse, one corrupted sample (a missed edge, i.e. both channels changing at once), then 2 counts
forward.

```cpp
// state = (A<<1)|B;  table indexed by (prev<<2)|cur
static const int8_t QTAB[16] = {
   0, +1, -1,  2,
  -1,  0,  2, +1,
  +1,  2,  0, -1,
   2, -1, +1,  0 };          // 2 == illegal

const char *A = "0011001100110000011001011";
const char *B = "0110011001100000001100110";
// ... accumulate count, and errors when QTAB gives 2 ...
assert(count  == 9);
assert(errors == 1);
```

**Verified transcript** — `g142`, nonce `4392124060`, build 0, run 0, execTime 23 ms:

```
count  = 9
errors = 1
PASS
```

**Why this exercise is good:** the table *is* the algorithm, the illegal-transition detection is
free, and the extension is the real lesson — have the student compute how many interrupts per
second a 4000 CPR encoder at 3000 RPM would generate (200,000/s), then look up an STM32 timer's
encoder mode and see the same job done in silicon with zero CPU cost.

#### Exercise C — Clarke and Park against closed-form reference values

*Assert `(α, β) = (−I sin θ, I cos θ)` and `(i_d, i_q) = (0, I)` at every degree, plus the
inverse-Park round trip and the angle-error result.*

```cpp
void clarke(double ia, double ib, double &al, double &be) {
    al = ia;
    be = (ia + 2.0*ib) / SQRT3;               // amplitude-invariant, using ic = -ia-ib
}
void park(double al, double be, double th, double &d, double &q) {
    d =  al*cos(th) + be*sin(th);
    q = -al*sin(th) + be*cos(th);
}
// drive a pure q-axis current: ia = -I sin(th), ib = -I sin(th - 2pi/3), ...
for (int k = 0; k < 360; ++k) {
    // ...
    assert(fabs(ia + ib + ic) < 1e-9);        // balanced
    assert(fabs(al - (-I*sin(th))) < 1e-9);
    assert(fabs(be - ( I*cos(th))) < 1e-9);
    assert(fabs(d - 0.0) < 1e-9);             // THE POINT: d,q are DC
    assert(fabs(q - I  ) < 1e-9);
}
```

**Verified transcript** — `g142`, nonce `4612543552`, build 0, run 0, execTime 24 ms:

```
theta=0   alpha=0.000000 beta=10.000000
theta=0   id=0.000000 iq=10.000000
10deg err  id=-1.736482  iq=9.848078  (I*sin=1.736482, I*cos=9.848078)
checks = 360
PASS
```

The third line is the exercise's real payload: **decoding with a 10° angle error yields exactly
`i_q = I·cos(10°) = 9.848` and `i_d = −I·sin(10°) = −1.736`.** 1.5% of torque lost, 17% of the
current wasted producing nothing. That is §1.4's claim, verified numerically rather than asserted.

**Variants:** implement the power-invariant convention with `√(2/3)` and show the resulting torque
error when it is mixed with an amplitude-invariant inverse transform; add a pole-pair count and
demonstrate the classic mechanical-vs-electrical-angle bug.

#### Exercise D — A 1-D Kalman filter beating the raw measurement

*Assert `rmse_kf < 0.75 · rmse_raw`, and that `P` remains symmetric and positive-definite.*

Constant-velocity model, `x = [pos, vel]`, position measured with `σ = 0.5 m`, white-noise
acceleration process. The update uses the **Joseph form**, so the positive-definiteness assertion
is meaningful rather than decorative.

```cpp
assert(rmse_kf < rmse_raw);                       // fusion beats the raw sensor
assert(rmse_kf < 0.75 * rmse_raw);                // and by a clear margin
assert(P[0][0] > 0.0 && P[1][1] > 0.0);
assert(std::fabs(P[0][1] - P[1][0]) < 1e-12);     // symmetric
assert(P[0][0]*P[1][1] - P[0][1]*P[1][0] > 0.0);  // det > 0
```

**Verified transcript** — `g142`, nonce `9722528264`, build 0, run 0, execTime 27 ms:

```
rmse_raw = 0.490724
rmse_kf  = 0.105277
ratio    = 0.2145
P steady = [0.012948 0.034428; 0.034428 0.185552]
PASS
```

**A genuinely useful finding from actually running this in two places.** The same program on
macOS/libc++ produced `rmse_raw = 0.491295`, `rmse_kf = 0.105066`, but **an identical steady-state
`P`**. The reason is that `std::normal_distribution` is *not* specified to produce the same
sequence across standard library implementations even from an identically seeded `std::mt19937` —
so the noise realisation differs, while `P` (which depends only on `F`, `Q`, `H`, `R`, not on the
data) is bit-identical. **The lesson for exercise design is concrete: assert inequalities and
model-derived quantities, never exact sample statistics, unless you supply your own RNG.**
Exercise G does supply its own, and is bit-identical everywhere.

Notice also that `P[0][1] = 0.0344 ≠ 0`: the filter has learned that position error and velocity
error are correlated, which is *why* a position-only measurement corrects the velocity estimate.
Have the student set the off-diagonals of `P` to zero after every update and watch the RMSE
degrade — that measures what the covariance is worth.

#### Exercise E — 2-link forward kinematics against the closed form

*Assert FK at known configurations, the analytic Jacobian against central finite differences,
`det J = L₁L₂ sin θ₂`, singularity at full extension, and an IK round trip on both branches.*

```cpp
const double L1 = 0.5, L2 = 0.3;
void fk (double t1,double t2,double&x,double&y){
    x = L1*cos(t1) + L2*cos(t1+t2);
    y = L1*sin(t1) + L2*sin(t1+t2); }
void jac(double t1,double t2,double J[2][2]){
    J[0][0] = -L1*sin(t1) - L2*sin(t1+t2);   J[0][1] = -L2*sin(t1+t2);
    J[1][0] =  L1*cos(t1) + L2*cos(t1+t2);   J[1][1] =  L2*cos(t1+t2); }
// analytic Jacobian vs central differences over a 59x59 grid
assert(worst < 1e-6);
// det J = L1*L2*sin(t2) exactly
assert(fabs(det - L1*L2*sin(t2)) < 1e-12);
```

**Verified transcript** — `g142`, nonce `7492844099`, build 0, run 0, execTime 34 ms:

```
fk(0,0)        = (0.800000, 0.000000)
fk(pi/2,0)     = (0.000000, 0.800000)
fk(0,pi/2)     = (0.500000, 0.300000)
max |J - fd|   = 3.826e-10
det J at t2=0  = 0.000e+00  (SINGULAR: arm fully extended)
ik round trip  = (0.600000000, 0.900000000)
other branch   = (1.259636, -0.900000) -> (0.433888968, 0.581569733)
PASS
```

The last line is the pedagogical one: **two completely different joint configurations,
`(0.600, 0.900)` and `(1.260, −0.900)`, reach the identical Cartesian point.** IK is not a
function. That is §4.3, demonstrated in one line of output.

**Variants:** implement damped least squares and plot joint velocity against `σ_min` as the arm
approaches full extension — the student watches `1/σ_min` blow up and then watches `λ` bound it,
which is Tikhonov regularisation experienced rather than defined.

#### Exercise F — Quaternion composition and a gimbal-lock demonstration

*Assert non-commutativity, the double cover, and — the real content — that at pitch = 90° two
different (yaw, roll) pairs produce a bit-identical rotation, while the same difference is
clearly distinguishable at pitch = 1.27 rad.*

```cpp
// Four 90-degree turns about z: identity as a ROTATION, q = -1 as a QUATERNION.
Q q4 = mul(mul(mul(qz,qz),qz),qz);
assert(fabs(q4.w + 1.0) < 1e-12);          // w = -1, not +1
rot(q4, ey, o);                            // yet it still acts as the identity
assert(fabs(o[1] - 1) < 1e-12);
assert(fabs(mul(q4,q4).w - 1.0) < 1e-12);  // 720 degrees to come home

// GIMBAL LOCK: at pitch = pi/2, only (yaw - roll) is identifiable.
Q g1 = zyx(0.0, M_PI/2, 0.0);
Q g2 = zyx(1.0, M_PI/2, 1.0);              // +1 rad yaw AND +1 rad roll
rot(g1,v,r1); rot(g2,v,r2);
for (int i=0;i<3;i++) assert(fabs(r1[i]-r2[i]) < 1e-12);   // indistinguishable
```

**Verified transcript** — `g142`, nonce `7785164296`, build 0, run 0, execTime 24 ms:

```
Rz90 * x = (0.000000, 1.000000, 0.000000)
qz*qy * x = (0.000000, 0.000000, -1.000000)
qy*qz * x = (0.000000, 1.000000, -0.000000)
qz^4 = (-1.000000, 0.000000, 0.000000, 0.000000)
locked  (yaw=0,roll=0)   -> (0.500000000, -0.700000000, -0.300000000)
locked  (yaw=1,roll=1)   -> (0.500000000, -0.700000000, -0.300000000)
pitch=1.271 rad, same delta -> separation 0.339309
pitch=0.00000  d|x|/dyaw = 1.000001e+00   cos(pitch)=1.000000e+00
pitch=1.00000  d|x|/dyaw = 5.403026e-01   cos(pitch)=5.403023e-01
pitch=1.50000  d|x|/dyaw = 7.073724e-02   cos(pitch)=7.073720e-02
pitch=1.57000  d|x|/dyaw = 7.963274e-04   cos(pitch)=7.963267e-04
pitch=1.57079  d|x|/dyaw = 6.326850e-06   cos(pitch)=6.326795e-06
pitch=pi/2  d|x|/dyaw = 5.551126e-11  <- DOF LOST
PASS
```

**This output is the best thing in the exercise set.** The sensitivity of the body x-axis to yaw
tracks `cos(pitch)` to six significant figures all the way down and then collapses to `5.6e-11`
at exactly 90°. **Gimbal lock is not a mechanical anecdote; it is a Jacobian going to zero, and
here it is, going to zero.** A student who runs this understands both gimbal lock and matrix
conditioning, and understands that they are the same phenomenon.

#### Exercise G — RRT on a fixed map with a seeded RNG

*Assert a path is found, every edge is collision-free and within the step bound, the endpoints
are the start and goal, the length is between the straight-line bound and 3.0, and that shortcut
post-processing never lengthens the path.*

The map is the unit square with three fixed circular obstacles. **The RNG is an explicit LCG, not
`std::mt19937` with a `std::*_distribution`**, precisely because of the portability finding in
Exercise D — the result must be bit-identical on every platform for the assertions to be exact.

```cpp
struct LCG {
    uint64_t s;
    explicit LCG(uint64_t seed) : s(seed) {}
    uint32_t next() { s = s*6364136223846793005ULL + 1442695040888963407ULL;
                      return (uint32_t)(s >> 32); }
    double uniform() { return next() / 4294967296.0; }   // [0,1)
};
static const Circle OBS[] = { {0.30,0.30,0.15}, {0.60,0.65,0.18}, {0.75,0.25,0.12} };
// start (0.05,0.05) -> goal (0.95,0.95), STEP 0.05, GOAL_BIAS 0.10, seed 20260901
assert(goal_node >= 0);
assert(seg <= STEP + 1e-9);
assert(free_edge(...));
assert(len > 1.2727 && len < 3.0);        // straight-line bound is hypot(0.9,0.9)
assert(slen <= len + 1e-9);               // shortcutting never lengthens
```

**Verified transcript** — `g142`, nonce `6865744323`, build 0, run 0, execTime 22 ms:

```
nodes      = 154
path_nodes = 33
path_len   = 1.569291
short_len  = 1.390135  (4 waypoints)
PASS
```

**Bit-identical to the local macOS/clang++ run at both `-O0` and `-O2`** — verified during this
research. That is the property the exercise needs.

The numbers teach: 154 nodes for a 33-node path means **79% of sampling effort was discarded**,
which is what "probabilistically complete but not efficient" costs. And shortcutting took the
path from 1.569 to 1.390 against a straight-line lower bound of 1.273 — **a 11.4% improvement for
about six lines of code**, which is why nobody ships raw RRT output.

**A bug worth reproducing deliberately in class.** During development this exercise failed with
`goal_node < 0` after 9535 nodes. The cause: `(uint32_t)(s >> 33)` yields only 31 bits, so
`next()/2^32` produced samples uniform on **[0, 0.5)**, and the goal at (0.95, 0.95) was outside
the sampled region entirely. **The planner was correct and complete over a configuration space
that was silently half the size of the real one.** That is a perfect illustration of a class of
bug — a correct algorithm over a wrong domain — that no amount of testing the *algorithm* would
find, and it comes free with the exercise.

#### Exercise H — Cross-compile the FOC inner loop: Cortex-M4F vs Cortex-M0

This is the exercise that makes the microcontroller unit's FPU discussion concrete, and it is
pure assembly inspection — no execution needed.

```cpp
struct dq { float d, q; };
extern "C" dq park(float ia, float ib, float sin_t, float cos_t)
{
    const float inv_sqrt3 = 0.57735026918962576f;
    float al = ia;
    float be = (ia + 2.0f*ib) * inv_sqrt3;
    return { al*cos_t + be*sin_t, -al*sin_t + be*cos_t };
}
```

**Cortex-M4F** — `armg1520`, `-O2 -std=c++20 -mcpu=cortex-m4 -mfpu=fpv4-sp-d16 -mfloat-abi=hard
-mthumb`, nonce `8327249168`, build 0:

```asm
park:
        vmov.f32        s13, #2.0e+0
        vmov.f32        s15, s0
        vfma.f32        s15, s1, s13
        sub     sp, sp, #16
        vldr.32 s13, .L4
        vmul.f32        s1, s15, s13
        vmov.f32        s14, s0
        vmul.f32        s0, s1, s2
        vmul.f32        s1, s1, s3
        vfma.f32        s0, s14, s3
        vfms.f32        s1, s14, s2
        add     sp, sp, #16
        bx      lr
```

**Cortex-M0** — same compiler, `-O2 -std=c++20 -mcpu=cortex-m0 -mfloat-abi=soft -mthumb`,
nonce `8881376193`, build 0 (excerpt):

```asm
park:
        push    {r4, r5, r6, r7, lr}
        mov     lr, r8
        ...
        bl      __aeabi_fadd
        bl      __aeabi_fadd
        bl      __aeabi_fmul
        bl      __aeabi_fmul
        bl      __aeabi_fmul
        bl      __aeabi_fadd
        bl      __aeabi_fmul
        bl      __aeabi_fmul
        bl      __aeabi_fadd
        ...
        pop     {r4, r5, r6, r7, pc}
```

**The comparison is the whole exercise.** M4F: **13 instructions, zero function calls**, with
`vfma.f32` and `vfms.f32` doing fused multiply-add and multiply-subtract in single instructions —
the Park transform is essentially free. M0: roughly 40 instructions and **nine calls into the
soft-float library** (`__aeabi_fadd`, `__aeabi_fmul`), each of which is itself tens to hundreds of
cycles.

Assignment: look up the cycle counts, estimate the cost of one Park transform on each part, and
determine whether a 20 kHz FOC loop (50 µs, so ~2400 cycles at 48 MHz) is feasible on an M0. Then
rewrite it in Q15 fixed point and re-measure. **This is why §1.4 said "on an M0 without an FPU it
does not fit" — and now the student has established that themselves rather than believed it.**

#### Exercise I — Fixed-point PI current loop for an 8-bit AVR

```cpp
struct PI16 { int16_t Kp_q8, Ki_q8; int32_t integ; int16_t out_min, out_max; };
extern "C" int16_t pi_update(PI16 *c, int16_t setpoint, int16_t measured)
{
    int16_t e = (int16_t)(setpoint - measured);
    int32_t p = ((int32_t)c->Kp_q8 * e) >> 8;       // Q8.8
    int32_t u = p + (c->integ >> 8);
    int16_t out = (u > c->out_max) ? c->out_max : (u < c->out_min) ? c->out_min : (int16_t)u;
    if (!((out == c->out_max && e > 0) || (out == c->out_min && e < 0)))
        c->integ += (int32_t)c->Ki_q8 * e;          // clamp anti-windup
    return out;
}
```

**Verified** — `avrg1520`, `-O2 -std=c++20 -mmcu=atmega328p`, nonce `5291803553`, build 0.
Selected output:

```asm
pi_update:
        push r12 ... push r29
.L__stack_usage = 8
        movw r30,r24
        ...
        call __mulhisi3          ; 16x16 -> 32 multiply
        ...
```

**Teaching points, all visible in the asm:** the AVR has only an 8×8→16 `MUL`, so a 16×16→32
multiply becomes a call to `__mulhisi3`; the `>> 8` on a Q8.8 value compiles to *byte moves*
rather than shifts, which is why Q8.8 rather than Q7.9 was the right format choice on an 8-bit
machine; and `.L__stack_usage = 8` is directly meaningful when you have 2 KB of SRAM. Assignment:
compile the same function with `float` gains instead, compare the code size and the stack usage,
and state the Q-format's worst-case rounding error and its effect on steady-state accuracy.

---

### 8.2 What genuinely needs hardware, and a cheap physical build path

**Be honest with students about this.** Simulation covers more than people expect and less than
would be convenient. The dividing line is: *if the phenomenon is a property of the mathematics,
simulate it; if it is a property of the physical world's refusal to match your model, you need
hardware.*

**Can be fully simulated (no hardware needed):**

| Topic | Why simulation suffices |
|---|---|
| PID tuning, anti-windup, derivative kick | The plant is an ODE. Exercise A. |
| Clarke/Park/FOC mathematics | Pure algebra. Exercise C. |
| Quadrature decode logic | Pure logic. Exercise B. |
| Kalman/EKF/complementary filters | Statistics; you can generate the noise. Exercise D. |
| Kinematics, Jacobians, singularities, quaternions | Pure geometry. Exercises E, F. |
| Path planning, RRT, A\*, D\* Lite | Pure algorithms. Exercise G. |
| MPC formulation and solver behaviour | Numerics. |
| RL for locomotion | Genuinely *better* in simulation (§6.5). |
| VLA policy inference, quantisation accuracy | GPU work, not robot work. |
| Reading a cross-compiler's assembly | Exercises H, I. |

**Genuinely requires hardware**, and each of these teaches something that cannot be faked:

1. **Jitter and its consequences (§3.7).** You can *simulate* jitter, and Exercise A's variant
   does. What you cannot simulate is *discovering* that your loop has 200 µs of jitter because
   of something you did not know was running. Measuring a real loop with a GPIO toggle and an
   oscilloscope or logic analyser — and seeing the histogram's tail — is the lesson.
2. **Noise, EMI and grounding.** Every analog problem in §2.5 is invisible in simulation because
   simulation has no ground plane. Watching a motor's PWM appear on an ADC channel, and watching
   it disappear when the sense wire is routed differently, is not reproducible in software.
3. **Backlash, friction, stiction, compliance (§1.6).** You can model these, but you cannot
   discover them, and the limit cycle a real backlash produces is the thing that teaches.
4. **The sim-to-real gap itself (§6.6).** By definition.
5. **Thermal behaviour.** Winding resistance rising 39% over a 100 K rise, and the back-EMF
   observer of §1.1 drifting because of it.
6. **The visceral safety lesson.** Watching a stall current, or an unbraked axis fall when power
   is cut, changes how someone designs. There is no substitute and there should not be.

**A cheap physical build path**, in four stages, each usable on its own:

**Stage 0 — ~$30. Instrumented open loop.** An STM32 "Blue/Black Pill" or a Raspberry Pi Pico, a
small brushed gearmotor with a quadrature encoder (the yellow "TT" motors with encoders are a few
dollars), and a DRV8833 or L298N H-bridge. Deliverables: hardware PWM at 20 kHz, hardware
quadrature decode via the timer's encoder mode, a velocity estimate, and **a GPIO toggle at the
top of the control loop measured on a $12 logic analyser** to produce a real jitter histogram.
That last item is the highest-value exercise in the whole build path and it costs almost nothing.

**Stage 1 — +~$25. Closed loop and the analog boundary.** Add a current-sense shunt and an
op-amp (or use a DRV8871-class driver with current limiting), and an MPU-6050/ICM-42688 IMU on
I²C or SPI. Deliverables: a cascade of current → velocity → position (§3.4); a timer-triggered
ADC sampling at the PWM centre (§1.2); the complementary filter and a 1-D Kalman filter on real
IMU data; and — the demonstration that pays for the whole stage — **build it once without an
analog anti-alias filter and once with one**, and show the folded PWM noise.

**Stage 2 — +~$50–120. FOC and a real joint.** A gimbal or drone BLDC motor, an AS5600/AS5047
magnetic encoder, and a **SimpleFOC Shield / SimpleFOC Mini** or a cheap 3-phase driver board.
Deliverables: encoder-offset calibration, closed-loop FOC current control, torque control, and
impedance control — and then the demo: **hold the motor's shaft and feel a programmable spring
and damper.** Compare with the same motor driven six-step and hear the torque ripple.
[SimpleFOC is the standard low-cost route here; **unverified as to current hardware availability
and pricing.**]

**Stage 3 — ~$150–500. A robot.** Two options with different lessons:
- **An SO-100/SO-101 arm from the LeRobot ecosystem** — low hundreds of dollars in parts, with
  leader/follower teleoperation, standard datasets, and the ability to train and run ACT,
  Diffusion Policy or SmolVLA on it. This is the *only* affordable path that ends with a student
  having collected their own demonstrations and deployed their own learned policy, and it makes
  §6.7's "data collection is the bottleneck" a felt experience rather than a claim. [**unverified
  as to current cost and availability**; costs vary substantially by region and by 3D-printing
  access.]
- **A differential-drive base with an RPLIDAR A1** (~$100) — ROS 2, SLAM (slam_toolbox),
  Nav2, and a real loop closure. This is the §4.7 and §5.5 path.

**Deliberately excluded:** a full humanoid, a QDD legged robot, or an industrial arm. They are
the right subject matter and the wrong budget; the ideas transfer from Stage 2 and Stage 3, and
§6.5 means the locomotion work is better done in MuJoCo anyway.

---

## 9. Sources, and what I could not verify

### 9.1 Verified during this research (fetched 2026-09-01)

**Embodied AI — papers, with arXiv v1 submission dates confirmed by fetching the abstract page:**

- **RT-1: Robotics Transformer for Real-World Control at Scale** — [arXiv:2212.06817](https://arxiv.org/abs/2212.06817),
  v1 **2022-12-13**. *(The abstract page did not state the dataset size; the 130k-demonstrations /
  700-tasks / 13-robots / 17-months figures commonly quoted are **not verified here** — see §9.2.)*
- **Diffusion Policy: Visuomotor Policy Learning via Action Diffusion** — [arXiv:2303.04137](https://arxiv.org/abs/2303.04137),
  v1 **2023-03-07**. Abstract states an **average improvement of 46.9%**; names receding-horizon
  control, visual conditioning and the time-series diffusion transformer.
- **Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware (ALOHA / ACT)** —
  [arXiv:2304.13705](https://arxiv.org/abs/2304.13705), v1 **2023-04-23**. Abstract states
  **80–90% success on 6 difficult real-world tasks from 10 minutes of demonstrations.** The
  hardware cost is **not** stated in the abstract.
- **RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control** —
  [arXiv:2307.15818](https://arxiv.org/abs/2307.15818), v1 **2023-07-28**. Core idea confirmed:
  actions expressed as text tokens, folded into the VLM's training set.
- **Open X-Embodiment: Robotic Learning Datasets and RT-X Models** — [arXiv:2310.08864](https://arxiv.org/abs/2310.08864),
  v1 **2023-10-13**. **22 robot embodiments, 527 skills, 160,266 tasks, 21 institutions.**
- **Universal Manipulation Interface (UMI)** — [arXiv:2402.10329](https://arxiv.org/abs/2402.10329),
  v1 **2024-02-15**. Hand-held grippers for in-the-wild data collection without robots.
- **Octo: An Open-Source Generalist Robot Policy** — [arXiv:2405.12213](https://arxiv.org/abs/2405.12213),
  v1 **2024-05-20**. Transformer policy, **800,000 trajectories** from Open X-Embodiment;
  finetuning on consumer GPUs in a few hours.
- **OpenVLA: An Open-Source Vision-Language-Action Model** — [arXiv:2406.09246](https://arxiv.org/abs/2406.09246),
  v1 **2024-06-13**. **7B parameters**, Llama 2 backbone, **DINOv2 + SigLIP** visual encoder,
  **970,000** real-world demonstrations from OXE.
- **π₀: A Vision-Language-Action Flow Model for Robot Control** — [arXiv:2410.24164](https://arxiv.org/abs/2410.24164),
  v1 **2024-10-31**. Flow-matching architecture on a pretrained VLM; single-arm, dual-arm and
  mobile manipulators; laundry folding, table cleaning, box assembly.
- **GR00T N1: An Open Foundation Model for Generalist Humanoid Robots** — [arXiv:2503.14734](https://arxiv.org/abs/2503.14734),
  v1 **2025-03-18**. Dual-module: vision-language module (System 2) + diffusion transformer
  (System 1), **jointly trained end-to-end**; real trajectories + human video + synthetic data;
  deployed on the Fourier GR-1.
- **π₀.₅: a Vision-Language-Action Model with Open-World Generalization** — [arXiv:2504.16054](https://arxiv.org/abs/2504.16054),
  v1 **2025-04-22**. Co-training on heterogeneous tasks; hybrid multimodal examples combining
  image observations, language commands, object detections, semantic subtask prediction and
  low-level actions; cleaning kitchens and bedrooms in entirely new homes.

**Embodied AI — company/lab publications, with dates confirmed by fetching the page:**

- **Physical Intelligence blog index** — [pi.website/blog](https://www.pi.website/blog)
  (note: `physicalintelligence.company` now 308-redirects here). Confirmed post list and dates:
  π₀ **2024-10-31**; Open-sourcing π₀ (with **π₀-FAST**) **2025-02-04**; π₀.₅ **2025-04-22**;
  **π\*₀.₆: a VLA that Learns from Experience 2025-11-17**; **The Physical Intelligence Layer
  2026-02-24**; **VLAs with Long and Short-Term Memory ("Multi-Scale Embodied Memory", tasks
  longer than ten minutes) 2026-03-03**; **Precise Manipulation with Efficient Online RL ("RL
  Token") 2026-03-19**; **π₀.₇: a Steerable Model with Emergent Capabilities 2026-04-16**.
- **π₀.₇** — [pi.website/blog/pi07](https://www.pi.website/blog/pi07), **2026-04-16**. Unified
  architecture: high-level policy + **world model producing visual subgoals** + action expert.
  "Diverse conditioning": language, metadata for execution speed and quality, control modality
  (joint vs end-effector), visual subgoals. Claims compositional generalisation, cross-embodiment
  transfer without task-specific data, specialist-level performance out of the box. **Notable
  gap: no quantitative failure-rate analysis or systematic evaluation across task categories;
  the air-fryer result required "language coaching" before autonomous execution.**
- **Helix: A Vision-Language-Action Model for Generalist Humanoid Control** (Figure) —
  [figure.ai/news/helix](https://www.figure.ai/news/helix), **2025-02-20**. **System 2: a 7B VLM
  at 7–9 Hz. System 1: an 80M transformer at 200 Hz.** ~**500 hours** of teleoperation (stated as
  <5% of prior VLA dataset sizes). Runs entirely onboard on **dual low-power embedded GPUs**, one
  per system. **35-DOF** upper-body action space.
- **Gemini Robotics 1.5** (Google DeepMind) —
  [deepmind.google/discover/blog/gemini-robotics-15-...](https://deepmind.google/discover/blog/gemini-robotics-15-brings-ai-agents-into-the-physical-world/),
  **2025-09-25**. Two models: **Gemini Robotics-ER 1.5** (embodied reasoning, high-level planner,
  can call tools including web search; released via Google AI Studio) and **Gemini Robotics 1.5**
  (the VLA, "thinks before acting"; select partners only). Claims SOTA on **15 academic spatial
  reasoning benchmarks** and cross-embodiment transfer across **ALOHA 2, Apptronik Apollo and
  Franka** without model specialisation.
- **SmolVLA** (Hugging Face / LeRobot) — [huggingface.co/blog/smolvla](https://huggingface.co/blog/smolvla),
  **2025-06-03**. **450M parameters**; trained only on compatibly-licensed community data —
  ~**10M frames from 487 curated LeRobot community datasets**, mostly SO-100. Reported to
  outperform much larger VLAs and ACT on LIBERO/Meta-World and real tasks (**~78% success on
  SO-100**). Runs on a single GPU, a CPU, or a MacBook. **Asynchronous inference: ~30% faster
  response, 2× task throughput.**

**Simulators and compute:**

- **MuJoCo releases** — [github.com/google-deepmind/mujoco/releases](https://github.com/google-deepmind/mujoco/releases).
  Latest **3.12.0, 2026-08-20** (unified MJCF grammar; **PID actuator with integral action and
  rate limiting**; redesigned DC motor controller; **2× speedup on large-mesh convex collision**).
  **3.11.0, 2026-07-27** (surface velocity fields for conveyors/treadmills; adhesive contact
  forces; gyroscopic derivatives; CSR mass matrix). **3.10.0 2026-06-22**, **3.9.0 2026-05-27**.
- **Genesis** — [github.com/Genesis-Embodied-AI/Genesis](https://github.com/Genesis-Embodied-AI/Genesis).
  Unified multi-physics (rigid body, FEM, MPM, PBD/SPH, uipc/IPC, SAP coupling, stable fluid, with
  an explicit multi-solver coupler), the **Nyx** renderer, the **Quadrants** cross-platform
  compiler. **"Started as an academic project since Dec 2024"**, now supported by Genesis AI.
  **The current README makes no FPS or simulation-speed claims** — an important correction, since
  the "43 million FPS" number that circulated at launch is widely repeated without qualification.
- **NVIDIA Jetson modules** — [developer.nvidia.com/embedded/jetson-modules](https://developer.nvidia.com/embedded/jetson-modules).
  **Jetson AGX Thor (T5000/T4000): up to 2070 FP4 TFLOPS, 128 GB memory, 40–130 W configurable;
  ">7.5× higher AI compute than AGX Orin, with 3.5× better energy efficiency."**
  **AGX Orin: up to 275 TOPS. Orin NX: up to 157 TOPS. Orin Nano: up to 67 TOPS, 7–25 W.**
- **arXiv cs.RO recent listing** (fetched 2026-09-01, covering **2026-08-28 to 2026-08-31**) —
  confirms the field's current direction. Representative titles: *FlashVLA: Streaming Action
  Decoding for Fast and Asynchronous VLA Inference* (2608.27384), *TemporalFlow-VLA:
  Learning Physically Grounded Execution History for Long-Horizon Robot Manipulation* (2608.26821),
  *Beyond Data Scaling: Representation-Centric Continued Pre-training for VLAs* (2608.27550),
  *PHR-VLA: Planning Horizon Reasoning for VLAs* (2608.27609), *DeicticVLA* (2608.28108),
  *CLAP: Cross-Embodiment Video World Models are Zero-Shot Physical Simulators* (2608.27406),
  *Riemann-1.0: An Embodied World Action Model for Physical AI* (2608.27033). **The pattern —
  inference latency, long horizons, execution history, world models — matches the limitations
  listed in §6.4, which is a useful independent confirmation that those are the live problems.**

**Compiler Explorer:**

- API endpoint, request format and response schema — exercised directly, **2026-09-01**.
  `GET https://godbolt.org/api/compilers/c++?fields=id,name,instructionSet` returned **1197**
  C++ compilers. All nine exercise transcripts in §8.1 are real API output with the nonces
  recorded. Compiler ids `g142`, `armg1520`, `avrg1520`, `arm64g1520` confirmed present.
- **The caching behaviour is real and confirmed:** every response carried `"okToCache": true`,
  and `execTime` is part of the cached payload. **Use a per-submission nonce**, as done here.

### 9.2 Explicitly NOT verified in this session

The web-search budget for this session was exhausted before this research began (200/200 calls
used), so everything above was obtained through direct URL fetches. That worked well for
primary sources with known URLs and not at all for anything requiring discovery. The following
are stated on weaker evidence and **should be checked before they go in front of students**:

**Dates and attributions I am confident of but did not re-confirm:**

1. **DAgger** — Ross, Gordon & Bagnell, AISTATS 2011 (arXiv 1011.0686). The O(εT²) → O(εT) regret
   result and the algorithm are certain; the exact date/venue was not re-checked.
2. **Series Elastic Actuators** — Pratt & Williamson, MIT, 1995. Attribution is standard; the
   exact paper title and venue were not re-checked.
3. **RRT\*** — Karaman & Frazzoli, 2011; **Informed RRT\*** — Gammell et al., 2014;
   **D\* Lite** — Koenig & Likhachev, 2002; **manipulability index** — Yoshikawa, 1985;
   **minimum-snap quadrotor trajectories** — Mellinger & Kumar, ICRA 2011; **6D rotation
   representation** — Zhou et al., CVPR 2019. All standard attributions, none re-checked.
4. **Domain randomisation** — Tobin et al., 2017. **OpenAI's Rubik's cube / automatic domain
   randomisation** — approximately 2019. **ANYmal RL locomotion** — Hwangbo et al., approximately
   2019. Dates approximate.
5. **PREEMPT_RT merged in Linux 6.12 (September 2024)** — verified in the earlier
   embedded-and-sbc research for this curriculum, not independently re-verified here.

**Quantitative claims I could not confirm:**

6. **RT-1's dataset size** (commonly quoted as ~130k demonstrations, 700+ tasks, 13 robots,
   17 months, ~3 Hz inference). The arXiv abstract page does not state these; I did not read the
   full paper. **Do not quote these numbers without checking the paper body.**
7. **ALOHA's hardware cost** (commonly quoted around $20–32k). Not stated in the abstract; not
   verified. Likewise **SO-100/SO-101 costs** (commonly quoted at $100–250 per arm in parts) —
   not verified, and they vary by region and by whether you have a 3D printer.
8. **RT-2-X / RT-2 parameter counts** (55B is commonly quoted for the largest RT-2). Not verified.
9. **IMU performance tiers** (consumer ~tens of °/hr bias instability, tactical ~1 °/hr, FOG/RLG
   <0.01 °/hr, with prices spanning four orders of magnitude). Order-of-magnitude figures, not
   checked against datasheets.
10. **EtherCAT numbers** — per-node ESC propagation delay of ~100–500 ns, cycle times of
    30–100 µs for ~100 axes, Distributed Clocks jitter <100 ns, >90% payload efficiency. These
    are the figures the EtherCAT Technology Group publishes and they are widely cited, but I did
    not fetch a primary source this session. **The mechanism (processing on the fly, one frame
    per cycle, no store-and-forward) is certain; the specific numbers should be checked against
    the ETG's own material.**
11. **CAN bus length/rate figures** (1 Mbit/s ≈ 40 m; 125 kbit/s ≈ 500 m). Standard, not checked.
12. **Jetson Orin NX / AGX Orin power envelopes and memory bandwidth.** The NVIDIA page I fetched
    gave TOPS for all Orin modules but power only for Orin Nano (7–25 W) and Thor (40–130 W), and
    no memory-bandwidth or CPU details for any of them. **Anything I would have said about Orin
    NX/AGX power or bandwidth would have been from memory, so I did not say it.**

**Software and ecosystem status I did not check:**

13. **Isaac Lab release dates.** I fetched the GitHub releases page and the dates it returned were
    internally inconsistent (a v3.0.0-beta2.patch1 dated 2024-07-02 while supporting Isaac Sim
    6.0.1, with earlier v2.3.x releases dated 2023). **I do not trust those dates and have not
    used them.** The *content* — Isaac Lab succeeding Isaac Gym and Orbit, built on Isaac Sim 6.0,
    with multi-backend physics including Newton, pluggable renderers, tactile sensors and surface
    grippers — is consistent and I have reported it without dates.
14. **Current maintenance status and feature sets of:** ODrive, VESC, SimpleFOC, moteus (§1.4,
    and the Stage 2 build path), IKFast, TRAC-IK, PyBullet, Gazebo/Gz, Drake, TOPP-RA, and Zenoh
    as a ROS 2 RMW. All are real and well-known; none were re-checked.
15. **ROS 2 distribution list, release dates and LTS status.** The `docs.ros.org` releases page
    returned an Anubis access-denied page. **I have deliberately not named a current ROS 2
    distribution anywhere in this document.** Check `docs.ros.org` before adding one.
16. **ISO 10218-1/-2 revision.** I believe the standard was revised and republished in **2025**,
    but iso.org returned HTTP 403 and I could not confirm it. The four collaborative-operation
    modes and the existence of **ISO/TS 15066** are long-standing and certain; the edition year
    is not. Likewise I did not re-check the current edition years of **ISO 13849-1**,
    **IEC 62061**, **ISO 26262**, **IEC 61800-5-2** or **IEC 60204-1**. **Never cite a standard's
    year from memory — always check, because engineers act on editions.**
17. **Current state of the art in Gaussian-splatting SLAM, tactile sensing, FMCW LiDAR market
    share, and MPPI/sampling-based MPC adoption.** All were moving fast as of my last reliable
    information and none were checked.

**A judgement call worth flagging rather than hiding:** the **Genesis "43 million FPS"** figure
circulated widely at its December 2024 launch. I fetched the current README and **it makes no
speed claims at all**. I have therefore reported the absence rather than the number. Either the
claim was withdrawn, or it was moved to documentation I did not fetch. **Either way, do not
repeat it without a current, hardware-specified source** — and the general lesson (treat a
simulator's throughput number like a GPU vendor's peak FLOPS) is the more useful thing to teach.

### 9.3 Standing references

- Bruno Siciliano & Oussama Khatib (eds.), *Springer Handbook of Robotics* — the reference work
  for §1–§5.
- Kevin Lynch & Frank Park, *Modern Robotics* — the best free modern treatment of kinematics,
  dynamics and control; the screw-theory formulation is cleaner than DH.
- Roy Featherstone, *Rigid Body Dynamics Algorithms* — RNEA and ABA, and why they are `O(n)`.
- Sebastian Thrun, Wolfram Burgard & Dieter Fox, *Probabilistic Robotics* — the canonical source
  for §4.5–§4.7 and for the particle filter material.
- Steven LaValle, *Planning Algorithms* (free online) — configuration space and sampling-based
  planning, by the author of RRT.
- Karl Åström & Richard Murray, *Feedback Systems* (free online) — the right level of control
  theory for §3, and better written than most textbooks.
- Åström & Hägglund, *Advanced PID Control* — anti-windup, derivative filtering and setpoint
  weighting in the detail §3.1 gestures at.
- Peter Corke, *Robotics, Vision and Control* — good for building intuition with runnable code.
