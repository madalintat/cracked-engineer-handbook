# The Floor Under NAND: Transistors, CMOS, Power, and Fabrication

Research notes, 2026-09-01. Written to sit **below** the existing nand2tetris-style Unit 1
("One primitive, all of logic"), which currently begins by handing the learner a NAND gate
as an axiom. nand2tetris says so explicitly — Ch1's Perspective: *"we did not address at
all… the physical implementation of gates and chips using the laws of physics."* This
document is that address.

## Sources actually read

| Source | Used for |
|---|---|
| [Wikipedia: Dennard scaling](https://en.wikipedia.org/wiki/Dennard_scaling) | Scaling table, 1974 citation, breakdown years and mechanism |
| [Wikipedia: CMOS](https://en.wikipedia.org/wiki/CMOS) | Inverter/NAND/NOR transistor counts, pull-up/pull-down duality, NAND-over-NOR argument |
| [Wikipedia: FinFET](https://en.wikipedia.org/wiki/FinFET) | Planar → FinFET → GAA, Intel 22nm tri-gate 2011 |
| [Wikipedia: 3 nm process](https://en.wikipedia.org/wiki/3_nm_process) | Real CPP / metal pitch / density numbers; node-name-as-marketing |
| [Wikipedia: EUV lithography](https://en.wikipedia.org/wiki/Extreme_ultraviolet_lithography) | 13.5 nm, tin LPP source, Mo/Si multilayers, NA, throughput, tool cost |
| [Wikipedia: Semiconductor device fabrication](https://en.wikipedia.org/wiki/Semiconductor_device_fabrication) | 300+ steps, 11+ metal layers, FEOL/BEOL, **the TSMC 5nm yield data point** |
| [Wikipedia: Dark silicon](https://en.wikipedia.org/wiki/Dark_silicon) | Definition, Esmaeilzadeh 2011, 50–80% at 8nm |
| [Wikipedia: Dynamic voltage scaling](https://en.wikipedia.org/wiki/Dynamic_voltage_scaling) | P = αCV²f term definitions, DVFS, race-to-idle, clock/power gating |
| [Wikipedia: High Bandwidth Memory](https://en.wikipedia.org/wiki/High_Bandwidth_Memory) | HBM1→HBM4 bus width, pin rate, bandwidth, stack height |
| [Wikipedia: Wafer (electronics)](https://en.wikipedia.org/wiki/Wafer_(electronics)) | Dies-per-wafer formula with edge correction, wafer sizes |
| [Wikipedia: Chiplet](https://en.wikipedia.org/wiki/Chiplet) | Known-good-die argument, UCIe, who ships chiplets |
| [Wikipedia: Blackwell microarchitecture](https://en.wikipedia.org/wiki/Blackwell_(microarchitecture)) | B200 dual reticle-limit dies, 104B×2 transistors, NV-HBI 10 TB/s, 4NP |
| [Wikipedia: Nvidia DGX](https://en.wikipedia.org/wiki/Nvidia_DGX) | B200 = 1000 W, H100 = 700 W, GB200 NVL72 liquid-cooled |
| [AnySilicon: die-per-wafer](https://anysilicon.com/die-per-wafer-formula-free-calculators/) | Negative-binomial yield model |
| Sibling research files in this directory | `cpu-architectures.md` §3.2 (3D V-Cache, CCD/IOD), `nvidia-architectures.md` (B200 = CoWoS-L, 192 GB HBM3e @ 8 TB/s) |

**Search budget note:** this session's web-search quota was exhausted before this task
started, so everything below came from direct URL fetches of pages I could name in advance,
plus arithmetic I did myself. §10 lists what that left unverified. Nothing in §10 is
load-bearing for the curriculum.

---

# 1. Semiconductor physics, only as deep as needed

The goal of this section is one sentence: **a transistor is a switch you operate with a
voltage instead of a finger.** Everything else here exists to make that sentence non-magical.

## 1.1 Why some materials conduct

An electron in an isolated atom can only sit at certain energy levels. Pack 10²³ atoms into
a crystal and those levels smear into **bands** — continuous ranges of allowed energy. Two
bands matter:

- the **valence band**, where electrons sit when they are busy holding the crystal together;
- the **conduction band**, where an electron is free to move and carry current.

Between them is the **band gap**: a range of energies no electron is allowed to have. To
conduct, an electron must be lifted across the gap.

| Material class | Band gap | Consequence |
|---|---|---|
| Conductor (copper) | none — bands overlap | Electrons are already free. Always conducts. |
| Insulator (SiO₂) | ~9 eV | Nothing available can lift an electron across. Never conducts. |
| Semiconductor (Si) | ~1.1 eV | Room-temperature thermal energy lifts a *few*. Conducts a little — and, crucially, that "little" is something you can control. |

The whole industry lives in that third row. Silicon is not useful because it conducts. It is
useful because it **almost doesn't**, and the amount by which it doesn't is adjustable.

Two teaching points to make explicitly, because both get skipped and both cause confusion
later:

1. **Temperature raises conductivity in a semiconductor and lowers it in a metal.** More
   heat means more electrons kicked across the gap. This is the seed of thermal runaway
   (§4) and it is why leakage gets worse as a chip gets hot, which is why a hot chip leaks
   more, which makes it hotter.
2. **The band gap is why silicon and not something else.** Germanium (0.67 eV) leaks too
   much at room temperature. Diamond (5.5 eV) barely conducts at all. Silicon's gap is in
   the sweet spot — *and* silicon grows a near-perfect native insulator (SiO₂) when you
   expose it to oxygen, which is the single most convenient accident in the history of
   manufacturing. Nobody chose silicon for its electrical properties alone.

## 1.2 Doping: making silicon deliberately impure

Pure silicon has 4 valence electrons per atom, each shared with a neighbour. Every electron
has a job. Nothing is free to move.

Now substitute one silicon atom in ten million with something else:

- **Phosphorus (5 valence electrons).** Four bonds are satisfied; the fifth electron has
  nothing to bond to and wanders off. You have added a **free negative carrier**. This is
  **N-type** silicon.
- **Boron (3 valence electrons).** One bond goes unsatisfied — a **hole**. A neighbouring
  electron can hop in to fill it, which moves the hole one atom over. The hole behaves
  exactly like a free positive carrier. This is **P-type** silicon.

Two framings worth insisting on:

- **A hole is not a particle.** It is a missing electron, and it moves because electrons
  take turns filling it. The reason we bother to name it is that the arithmetic comes out
  identical to a positive charge carrier, so you can stop tracking 10²³ electrons and track
  one hole instead. (This is exactly the same move as tracking "the empty square" in a
  15-puzzle.)
- **Both types are electrically neutral overall.** N-type silicon has extra mobile
  electrons but also extra protons in the phosphorus nuclei. Doping changes *mobility*, not
  net charge. Learners routinely assume N-type is negatively charged; it is not, and the PN
  junction makes no sense if you think it is.

Doping levels are extraordinary: roughly **1 dopant atom per 10⁵ to 10⁸ silicon atoms**
changes conductivity by orders of magnitude. This is why fabs are obsessive about
cleanliness — a stray contaminant at that concentration *is* a dopant.

## 1.3 The PN junction: the first one-way device

Push a P region and an N region together.

At the boundary, free electrons from the N side diffuse into the P side and fall into holes.
Holes diffuse the other way. Both are annihilated. The result is a thin region near the
junction with **no free carriers at all** — the **depletion region**.

But annihilation leaves the dopant *ions* behind, and those are fixed in the crystal
lattice: the N side near the junction is now positively charged (phosphorus nuclei minus
their departed electrons), and the P side near the junction is negatively charged. That
charge separation creates an electric field pointing from N to P, and that field pushes back
against further diffusion. Equilibrium: the depletion region stops growing. The voltage
across it is the **built-in potential**, ~0.7 V for silicon.

Now apply an external voltage:

- **Forward bias** (+ on P, − on N). Your applied field opposes the built-in field. The
  depletion region narrows. Above ~0.7 V it collapses, carriers flood across, **current
  flows**.
- **Reverse bias** (+ on N, − on P). Your applied field *adds* to the built-in field. The
  depletion region widens, pulling even more carriers away from the junction. **No current**
  (a tiny leakage only).

That asymmetry is a diode. It is also the reason a MOSFET's source and drain don't just
short to the substrate: each is a PN junction held in reverse bias by the body connection.

**The key intuition to leave the learner with:** the one-way behaviour is not a property of
either material. It is a property of the *boundary*, and specifically of the fact that the
depletion region can be squeezed or stretched by an applied voltage. A voltage that changes
the width of a non-conducting region is the entire idea behind the transistor.

## 1.4 The MOSFET

**M-O-S-F-E-T** = Metal-Oxide-Semiconductor Field-Effect Transistor, and the name is a
build instruction read from the top down.

Take a slab of P-type silicon (the **body** or **substrate**). Diffuse two N-type islands
into it, a short distance apart: the **source** and the **drain**. Between them, on the
surface, grow a very thin layer of SiO₂ — the **gate oxide**, an insulator. On top of the
oxide, lay a conductor: the **gate**.

    gate  ─────────────█████████─────────────      (conductor)
                       ─────────                   (oxide: INSULATOR, ~1-2 nm)
          ┌─────────┐           ┌─────────┐
          │ N source│           │ N drain │
          └─────────┴───────────┴─────────┘
                     ↑ channel region
          ══════════ P body ══════════════

Note what this structure is *not*: the gate is not connected to anything. It is separated
from the silicon by an insulator. **No current ever flows through the gate.** This is the
single most important structural fact about a MOSFET and it is what makes CMOS possible.

**Off state (gate at 0 V).** Source and drain are two N islands in a P sea. To get from
source to drain you must cross N→P→N, which is two PN junctions back to back — one of them
is always reverse biased whichever way you push. No current.

**On state (gate at +V).** The gate is now a positively charged plate above the P body,
separated by an insulator: a **capacitor**. Its field reaches through the oxide and repels
holes from the surface of the P body while attracting the P body's few free electrons to it.
Raise the gate voltage far enough and the surface layer of the P body accumulates so many
electrons that it stops behaving as P-type and behaves as N-type. This is **inversion**, and
the resulting thin layer is the **channel** — a continuous N-type bridge from source to
drain. Current flows.

The gate voltage at which that bridge forms is the **threshold voltage, V_th**. Below it,
off. Above it, on. This is a switch operated by a voltage.

Two refinements that matter later and cost one sentence each:

- **The switch is not sharp.** Below V_th the current does not stop; it falls off
  exponentially. That residual is **subthreshold leakage**, and how steeply it falls is the
  **subthreshold slope**, measured in mV of gate voltage per decade of current, with a hard
  room-temperature floor of ~60 mV/decade for a conventional MOSFET. This number is the
  villain of §3. Remember it.
- **The gate is a capacitor, so switching it costs energy.** Every time you turn a
  transistor on or off you charge or discharge that capacitor. This is the origin of the
  `C` in P = αCV²f. Also remember this.

## 1.5 NMOS and PMOS

Everything above described an **NMOS** transistor: N-type source/drain in a P body, channel
made of electrons, turns **on when the gate is HIGH**.

Swap every doping type — P-type source/drain in an N body — and you get **PMOS**: channel
made of holes, turns **on when the gate is LOW**. PMOS is drawn with a bubble on the gate
for exactly this reason.

| | NMOS | PMOS |
|---|---|---|
| Turns on when gate is | HIGH | LOW |
| Carriers | electrons | holes |
| Passes cleanly | **0** (strong low) | **1** (strong high) |
| Passes badly | 1 (degraded to V_dd − V_th) | 0 (degraded to \|V_th\|) |
| Carrier mobility | ~2–3× higher | ~2–3× lower |
| Therefore, for equal drive | narrow | must be **~2–3× wider** |

Those last three rows are not trivia. They determine the entire shape of CMOS logic:

1. **NMOS passes a strong 0, PMOS passes a strong 1.** An NMOS trying to pass a HIGH loses
   V_th along the way, because as the source terminal rises toward V_dd, the gate-to-source
   voltage drops below threshold and the transistor shuts itself off. So you build
   pull-*down* networks from NMOS and pull-*up* networks from PMOS, and you never do it the
   other way round.
2. **PMOS is intrinsically slower** because holes move more slowly through silicon than
   electrons do. To get the same current you make PMOS wider, which makes it *bigger* and
   gives it *more capacitance*. So a design that stacks PMOS in series pays twice.

Hold those two facts. They are what makes NAND cheap and AND expensive.

---

# 2. CMOS logic

## 2.1 The complementary idea

"CMOS" = **Complementary** MOS. Every gate is built from exactly two networks:

- a **pull-up network (PUN)** of PMOS transistors, between V_dd and the output;
- a **pull-down network (PDN)** of NMOS transistors, between the output and ground.

And they obey one rule, which is the entire discipline:

> **For every input combination, exactly one of the two networks conducts.**

Never both (that would be a direct short from V_dd to ground — "crowbar current"). Never
neither (that would leave the output floating, remembering its last value on stray
capacitance, drifting). Exactly one.

From Wikipedia's CMOS article, stated precisely: *"the set of all paths to the voltage source
must be the complement of the set of all paths to ground."* The two networks are **duals**:
series in one is parallel in the other. This follows from De Morgan's laws, which is a nice
moment — the learner has probably already met De Morgan as a Boolean identity, and here it
turns out to be a *wiring* instruction.

## 2.2 The inverter is 2 transistors

              V_dd
               │
            ┌──┴──┐
    A ──────┤ PMOS│      on when A = 0
            └──┬──┘
               ├──────── Y
            ┌──┴──┐
    A ──────┤ NMOS│      on when A = 1
            └──┬──┘
              GND

- A = 0: PMOS on (gate low), NMOS off. Output pulled to V_dd. **Y = 1.**
- A = 1: PMOS off, NMOS on (gate high). Output pulled to ground. **Y = 0.**

Two transistors, one wire each. This is the cheapest possible logic gate and it is an
**inverter**. That is not a coincidence and §2.5 is about why.

## 2.3 NAND is 4 transistors

To get NAND(A,B) — output LOW only when both inputs are HIGH — the pull-down must conduct
only when A **and** B are high: **two NMOS in series**. By duality the pull-up is **two PMOS
in parallel**.

              V_dd
               ├──────────┬─────────┐
            ┌──┴──┐    ┌──┴──┐      │
    A ──────┤PMOS │ B──┤PMOS │      │      parallel: either one pulls high
            └──┬──┘    └──┬──┘      │
               └──────────┴─────────┤
                                    ├────── Y
                                 ┌──┴──┐
    A ──────────────────────────┤ NMOS │
                                 └──┬──┘   series: BOTH must be on to pull low
                                 ┌──┴──┐
    B ──────────────────────────┤ NMOS │
                                 └──┬──┘
                                   GND

| A | B | PDN (series NMOS) | PUN (parallel PMOS) | Y |
|---|---|---|---|---|
| 0 | 0 | open | conducting (both) | 1 |
| 0 | 1 | open | conducting (A's) | 1 |
| 1 | 0 | open | conducting (B's) | 1 |
| 1 | 1 | **conducting** | open | **0** |

**4 transistors.** Exactly one network conducts in every row. That is a NAND gate, and it
is the physical object nand2tetris hands you on page one.

## 2.4 NOR is also 4 — and it is worse

Mirror everything: pull-down = two NMOS in **parallel**, pull-up = two PMOS in **series**.
Same transistor count, same truth-table discipline. So why is NAND the industry default?

Because of §1.5's last row. **PMOS must be ~2–3× wider than NMOS for equal drive strength,
and stacking transistors in series multiplies their resistance.** NOR puts the wide, slow
PMOS transistors in the series stack; NAND puts them in parallel and puts the fast, narrow
NMOS in series. For a 2-input gate sized for equal rise and fall times, the NOR is
substantially larger and slower than the NAND. It gets worse with more inputs: a 4-input NOR
has four wide PMOS in series and is genuinely awful.

Wikipedia's CMOS article makes the same argument: NAND is preferred because *"PMOS
transistors (used in pull-up networks) are slower than NMOS transistors due to lower hole
mobility"*, and NAND places them in parallel while NOR places them in series.

So: NAND and NOR are both universal, both 4 transistors, and **NAND wins on physics, not on
logic.** This is a good place to note that the choice of primitive in a logic curriculum is
downstream of hole mobility in silicon — which is exactly the kind of fact this whole
document exists to supply.

## 2.5 The punchline: why AND costs MORE than NAND

Look at the inverter again. The NMOS pull-down conducts when its gate is **HIGH**, and when
it conducts it drives the output **LOW**. The PMOS pull-up conducts when its gate is **LOW**
and drives the output **HIGH**.

That is not a design decision. It is what the devices do. **A static CMOS gate built from a
PMOS pull-up and an NMOS pull-down is structurally, unavoidably inverting.** There is no
arrangement of NMOS and PMOS in the standard configuration that produces a non-inverting
gate directly. You can build NAND, NOR, AND-OR-INVERT, OR-AND-INVERT — every one of them
has an inversion baked in.

To get AND, you build NAND and then invert it:

| Gate | Transistors | Stages | Delay |
|---|---|---|---|
| NOT | **2** | 1 | 1 |
| NAND | **4** | 1 | 1 |
| NOR | **4** | 1 | 1 (but slower per stage) |
| **AND** | **6** (NAND + NOT) | **2** | **2** |
| **OR** | **6** (NOR + NOT) | **2** | **2** |
| XOR | 8–12 depending on style | 2+ | 2+ |

**AND is 50% more transistors and 2× the delay of NAND.** In CMOS, `AND` is a *derived*
gate and `NAND` is a *primitive* one. The Boolean-algebra textbook ordering — where AND and
OR are fundamental and NAND is a compound "NOT-AND" — is exactly backwards relative to the
silicon.

This is the single most important sentence in the whole document for curriculum purposes:

> **nand2tetris starts at NAND because in CMOS, NAND is what you actually get for free.
> Starting at AND would mean starting at something more expensive that is itself built out
> of a NAND.**

A learner who has been told "NAND is universal, so we start there" has been given a
*mathematical* justification. It's true, but so is "NOR is universal." The *engineering*
justification — NAND is the cheapest 2-input gate in the dominant fabrication technology,
and inversion is free while non-inversion costs an extra stage — is the one that explains
why real chips are full of NANDs and why synthesis tools invert things constantly. And it
also predicts a thing the learner will otherwise find baffling: **real standard-cell
libraries deliberately contain inverted-output gates and "bubble pushing" is a real
optimisation technique**, because moving an inversion across a De Morgan boundary can delete
two transistors and a gate delay.

**Corollary worth stating:** this is also why real logic often looks "inside out." A designer
who needs `A AND B AND C AND D` will build it as a tree of NANDs and NORs whose inversions
cancel, not as three ANDs. And it is why the Hack ALU's `no` (negate output) control bit is
free in hardware: it is one XOR, and the alternative — building both polarities — is not.

## 2.6 Complex gates, and why they are cheaper than they look

The PUN/PDN duality generalizes. Any function of the form `NOT(sum of products)` can be
built as **one** CMOS gate:

- `AOI21` = `NOT((A AND B) OR C)`: PDN is (A series B) parallel C — 3 NMOS. PUN is the dual:
  (A parallel B) series C — 3 PMOS. **6 transistors, one gate delay.**

Building the same function from discrete AND/OR/NOT gates would cost 6 + 6 + 2 = 14
transistors and 3 gate delays. Complex CMOS gates are the reason a synthesized netlist looks
nothing like the Boolean expression you wrote.

The limit is the series stack: each transistor in series adds resistance, so stacks beyond
about 3–4 deep get too slow. That constraint — *stack depth is bounded, so gates have a
maximum fan-in of about 4* — is why you cannot build an 8-input NAND as one gate and must
tree it instead.

## 2.7 Transmission gates

Sometimes you want a switch that passes an analog-ish signal both ways rather than driving a
logic level. One NMOS alone won't do it (passes a weak 1). One PMOS alone won't either
(passes a weak 0). Put them **in parallel with complementary gate signals** and each covers
the other's weakness:

    EN  ─────┬── gate of PMOS (via inverter → EN')
             │
    IN ──────┼──[NMOS]──┬── OUT
             └──[PMOS]──┘
    EN  ───────gate of NMOS

- EN = 1: both on. Full-swing conduction in either direction.
- EN = 0: both off. Isolated.

Cost: 2 transistors, plus an inverter (2 more) to generate EN' — unless you already have it.

Transmission gates are how you build a **compact multiplexer**: a 2:1 mux is two
transmission gates and one inverter, ~6 transistors, versus ~14 for the NAND-based version
nand2tetris builds in Project 1. Worth telling the learner: their `Mux.hdl` is correct and
also not how anyone builds a mux. They are also how **latches** are built (a transmission
gate in a feedback loop), which is the connection to nand2tetris Ch3's DFF-as-axiom.

## 2.8 Tri-state buffers and how a real bus works

A normal CMOS output is a **totem pole**: PMOS to V_dd, NMOS to ground, one always on. If
you wire two such outputs together and one drives high while the other drives low, you have
connected V_dd to ground through four transistors. That is a short circuit; it draws
enormous current and can destroy the drivers. This is the failure mode Ben Eater's bus
videos exist to prevent.

A **tri-state buffer** adds a third state: **Hi-Z**, high impedance, meaning *both networks
off, output electrically disconnected*. Simplest construction: put an enable transistor in
series with each network, or gate the driver's inputs so that when OE = 0 the PMOS gate goes
high and the NMOS gate goes low simultaneously.

| OE | IN | PMOS | NMOS | OUT |
|---|---|---|---|---|
| 1 | 0 | on | off | 1 |
| 1 | 1 | off | on | 0 |
| 0 | X | **off** | **off** | **Hi-Z** |

**How a real bus driver works.** Every device on a shared bus has a tri-state output. A
**bus arbiter** or decoder guarantees at most one output enable is asserted at any moment.
The wire itself has no active driver most of the time — it holds its value on parasitic
capacitance, which is why buses need either a **bus keeper** (a weak cross-coupled inverter
pair that holds the last value) or a **pull-up resistor**, and why a floating bus input is a
real hazard: an undriven CMOS input sits near the switching threshold with both its
transistors partly on, drawing crowbar current and possibly oscillating.

Three facts to give the learner, because they are the ones that bite:

1. **Hi-Z is not 0.** It is "not participating." A voltmeter on a floating bus reads
   whatever's left over.
2. **Bus contention is a hardware fault, not a logic error.** A simulator prints `X`. Real
   silicon gets hot.
3. **On-chip, tri-state buses are largely obsolete.** Modern chips use multiplexers instead,
   because a mux is statically verifiable — the tool can *prove* only one input is selected,
   whereas tri-state correctness depends on control logic being right at runtime. This is a
   satisfying justification for nand2tetris' mux-everything approach: it's not a
   simplification, it's what current practice actually does. Tri-state survives at the chip
   *boundary* (DDR data bus, I²C, PCI-legacy) where you genuinely have multiple physical
   chips on one wire.

## 2.9 Timing: what a gate actually costs

nand2tetris Ch3 asserts, without building it, that the clock cycle "must be slightly longer
than the time it takes a bit to travel the longest distance." This section is what that
sentence means.

**Propagation delay (t_pd).** Time from an input crossing 50% to the output crossing 50%.
Physically: the driving gate's transistors must charge or discharge the total capacitance
hanging off its output node through their on-resistance. First-order, `t_pd ≈ 0.69 · R_on ·
C_load`. Two consequences fall straight out:

- **More load ⇒ more delay.** Linear in C_load.
- **Wider transistors ⇒ less delay** (lower R_on) **but more load on whatever drives them**
  (higher input capacitance). You cannot make everything fast by making everything big; you
  push the problem upstream. This trade-off is the whole content of "logical effort" as a
  design method.

**Rise time / fall time (t_r, t_f).** Usually measured 10%→90%. In CMOS these are set by the
pull-up and pull-down strengths respectively; a gate is "balanced" when they're equal, which
is why PMOS gets drawn wider. Slow edges are bad beyond just being slow: during the
transition both transistors are momentarily on, and the resulting **short-circuit current**
is a real power term (typically 5–15% of dynamic power).

**Fan-out.** The number of gate inputs a single output drives. Each adds its gate
capacitance. Delay grows roughly linearly with fan-out. Standard-cell libraries characterise
every cell at several fan-outs, and synthesis tools insert **buffer trees** when a signal
must reach many places — which is why a real netlist contains thousands of buffers that
appear nowhere in the RTL. The classic case is the **clock tree**: a clock reaching a million
flip-flops is a multi-level buffer tree, and it can burn 20–40% of a chip's total dynamic
power all by itself.

**Drive strength.** Standard-cell libraries ship the same logical gate at several sizes —
`NAND2_X1`, `NAND2_X2`, `NAND2_X4`. Same function, wider transistors, more drive, more area,
more input capacitance. Sizing is an optimisation problem, not a design decision.

**Setup time (t_su) and hold time (t_h).** A flip-flop samples its input on a clock edge, but
it needs the input to be *stable* for a window around that edge:

- **Setup:** data must be stable for t_su *before* the edge.
- **Hold:** data must remain stable for t_h *after* the edge.

Violate either and the flop may not capture a clean value. The two constraints fail in
opposite directions, which is what makes them interesting:

    Setup:  t_cq + t_logic(max) + t_su + t_skew  ≤  T_clk      → fix by SLOWING the clock
    Hold:   t_cq + t_logic(min)                  ≥  t_h + t_skew → clock speed IRRELEVANT

**A hold violation cannot be fixed by slowing down.** It means a signal arrived at the next
flop *too early* — it raced through short combinational logic and clobbered the input before
the flop had latched the old value. The fix is to insert delay (buffers) or fix clock skew.
This asymmetry surprises everyone once and then never again, and it is worth a whole exercise.

**Metastability.** If data changes *inside* the setup/hold window, the flip-flop's internal
cross-coupled inverters can be driven to their unstable balance point — sitting at neither 0
nor 1. Wikipedia's definition: *"the ability of a digital electronic system to persist for an
unbounded time in an unstable equilibrium."*

The critical property: **there is no bound on resolution time.** It's exponentially unlikely
to persist, not impossible. The standard model is

    MTBF = e^(t_r / τ) / (T₀ · f_clk · f_data)

where t_r is the time you allow for resolution, τ is the flop's resolution time constant, T₀
is a technology constant, f_clk is the sampling clock and f_data is the rate of asynchronous
input events. The exponential in the numerator is the good news: **every extra bit of
resolution time buys you exponentially more MTBF**, which is why the fix is simply to wait.

The fix is a **two-flop synchronizer**: chain two flip-flops on the destination clock. The
first may go metastable; it gets a full clock period to resolve before the second samples it.
Cost: two cycles of latency. Benefit: MTBF goes from seconds to longer than the age of the
universe. This is why crossing a clock domain is never free and never just a wire — see §7.4.

*(The MTBF equation above is standard and I state it from knowledge; the Wikipedia
metastability article I fetched does **not** contain it. See §10.)*

---

# 3. Power, and the equation that changed computing

This is the section the curriculum most needs and the one most curricula skip. It is the
causal story that explains why the machine on your desk has 16 slow cores instead of one
30 GHz core, why GPUs took over, and why "performance engineering" stopped being optional
around 2006.

## 3.1 Dynamic power

Every time a CMOS gate switches, it charges or discharges the capacitance on its output node
through the supply. Charging a capacitance C to voltage V takes **C·V²** joules from the
supply — half of it stored on the capacitor (½CV²), half dissipated in the pull-up's
resistance. Discharging dumps the stored half into the pull-down. So a **full 0→1→0 cycle
dissipates C·V².**

Multiply by how often that happens:

> **P_dynamic = α · C · V² · f**

| Term | Meaning | Notes |
|---|---|---|
| **α** | activity factor — average switching transitions per node per clock | Dimensionless, typically 0.05–0.3. A clock line has α = 1 (it switches every cycle, by definition). Most data nodes are far lower. |
| **C** | total switched capacitance | Gate capacitance + wire capacitance. **Wire capacitance now dominates** at advanced nodes, which is why interconnect, not transistors, sets power. |
| **V** | supply voltage | **Squared.** This is the term everything hinges on. |
| **f** | clock frequency | Linear. |

*(Term definitions cross-checked against the [dynamic voltage scaling](https://en.wikipedia.org/wiki/Dynamic_voltage_scaling) article.)*

**The V² is the whole story.** Halving V quarters dynamic power at fixed frequency. But
lowering V also lowers the maximum frequency the circuit can run at — a lower gate overdrive
(V_dd − V_th) means less current, means slower charging of C, means longer t_pd. So in
practice V and f are lowered *together*, and power scales close to **V³** — which is why DVFS
(§3.6) works as well as it does, and why running two cores at half speed beats one core at
full speed for the same throughput.

There is a second dynamic term worth naming: **short-circuit power**, dissipated during the
transition window when both PUN and PDN are momentarily conducting. Typically 5–15% of
dynamic power; grows with slow input edges. It is why a badly-buffered net costs power as
well as time.

## 3.2 Static / leakage power, and why it exploded below ~90 nm

An "off" MOSFET is not off. Four leakage paths matter:

1. **Subthreshold leakage** — the big one. Below V_th, drain current does not stop; it decays
   exponentially with gate voltage, at best ~60 mV per decade at room temperature (the
   thermionic limit — this is set by `kT/q` and is not an engineering shortfall, it is
   physics). So dropping V_th by 100 mV multiplies off-current by roughly 10–50×. Leakage
   also rises steeply with temperature, which is the thermal runaway loop from §1.1.
2. **Gate oxide tunneling** — when SiO₂ got to ~1.2 nm (about **five atomic layers**),
   electrons began quantum-mechanically tunneling straight through the "insulator." This is
   what forced the switch to **high-κ dielectrics** (hafnium oxide) plus metal gates at
   Intel's 45 nm in 2007: a physically thicker layer with a higher dielectric constant gives
   the same capacitance with vastly less tunneling. Note the irony — the "MOS" in MOSFET
   went back to being literally *metal*-oxide-semiconductor after decades of polysilicon
   gates.
3. **Junction leakage** — reverse-biased source/drain-to-body diodes.
4. **GIDL** (gate-induced drain leakage) — high field at the drain edge.

**Why it exploded.** Follow the chain, because it is a genuinely tight argument:

- To keep gates fast as V_dd falls, you must keep the overdrive `V_dd − V_th` large.
- So as V_dd came down, V_th had to come down too.
- But subthreshold leakage is *exponential* in V_th, with the 60 mV/decade floor.
- So every 100 mV you took off V_th cost you ~10× the leakage — per transistor, times
  billions of transistors, all the time, whether or not the chip is doing anything.

Around 130–90 nm (roughly 2002–2004) leakage crossed from a rounding error to a
**double-digit percentage of total chip power**, and at some designs approached parity with
dynamic power. It stopped being possible to lower V_th further, which meant it stopped being
possible to lower V_dd further, which is precisely how Dennard scaling died.

The industry's responses were structural, not incremental: high-κ/metal gate (45 nm, 2007),
FinFET (22 nm, 2011), and eventually gate-all-around — **all three are fundamentally about
restoring electrostatic control of the channel so that the transistor turns off properly.**
They are leakage fixes first and speed improvements second.

## 3.3 Dennard scaling — stated precisely

**The paper.** Robert H. Dennard et al., *"Design of ion-implanted MOSFET's with very small
physical dimensions,"* **IEEE Journal of Solid-State Circuits, vol. SC-9, no. 5, October
1974, pp. 256–268.**

**The rule.** Scale *all* dimensions **and the supply voltage** by the same factor, and
increase doping concentration inversely, and the electric field inside the device stays
constant. Hence the name: **constant-field scaling.**

With a scaling factor κ per generation (κ ≈ 1.4, i.e. every dimension multiplied by
1/κ ≈ 0.7):

| Quantity | Scales as | With κ = 1.4 |
|---|---|---|
| Channel length L, width W, oxide thickness t_ox | 1/κ | ×0.7 |
| **Supply voltage V_dd** | **1/κ** | **×0.7** |
| Doping concentration N_A | κ | ×1.4 |
| Device area (W·L) | 1/κ² | **×0.5** |
| Capacitance C | 1/κ | ×0.7 |
| Drive current I | 1/κ | ×0.7 |
| Gate delay (C·V/I) | 1/κ | ×0.7 |
| **Frequency f** | **κ** | **×1.4** |
| Power per device (C·V²·f) | 1/κ² | ×0.5 |
| **POWER DENSITY (P / area)** | **1** | **UNCHANGED** |

*(Relationships confirmed against the [Dennard scaling](https://en.wikipedia.org/wiki/Dennard_scaling) article: L, W, t_ox and V_DD all scale as S⁻¹; doping as S; area as S⁻²; power density as S⁰.)*

**Read the last row again, because that row is the whole 20th-century computing industry.**

Every generation you got:
- **2× the transistors** in the same area (this is Moore's Law, which is an observation about
  *transistor count*),
- each running **1.4× faster**,
- and **the same watts per square millimetre.**

Free performance. Not "performance you could buy with a better cooler" or "performance if you
rewrote your software" — free. **The same single-threaded binary, unmodified and
unrecompiled, ran ~40% faster every 18–24 months, and the chip did not get hotter.** Moore's
Law gave you more transistors; *Dennard scaling gave you permission to turn them all on.*
They are not the same law and the difference is the entire point of this section.

This is why, from roughly 1975 to 2004, the correct engineering response to "this program is
too slow" was **wait**.

## 3.4 Why it ended, precisely, around 2005–2007

Dennard scaling requires V_dd to scale down with dimensions. **V_dd stopped scaling.** Here
is the chain, each link forced by the previous one:

1. **V_dd must fall by 0.7× per generation** for constant-field scaling to hold.
2. **For gates to stay fast, V_th must fall with V_dd**, to preserve the overdrive
   `V_dd − V_th` that sets drive current.
3. **Subthreshold leakage is exponential in −V_th**, with a hard ~60 mV/decade floor set by
   `kT/q` at room temperature. Lowering V_th by 100 mV costs ~10× leakage per transistor.
4. **So V_th could not keep falling.** Below roughly 0.3 V, leakage from a billion "off"
   transistors becomes comparable to the chip's entire dynamic power.
5. **So V_dd could not keep falling** without destroying performance. It stalled at roughly
   **1.0–0.9 V** and has essentially stayed there for two decades. (Compare: 5 V in the
   1980s, 3.3 V in the mid-90s, 1.8 V in 1999.)
6. **Meanwhile dimensions kept shrinking.** Transistor count kept doubling. Moore's Law
   continued.
7. **Therefore power density began rising.** Constant V, shrinking area, more devices per
   mm², all switching — P/area, which had been flat for 30 years, started climbing.

Here is what that looks like arithmetically. Take five generations of 0.7× dimensional
scaling with V frozen — the post-2005 regime:

| Generation | Relative area | Power/device | **Power density** |
|---|---|---|---|
| 0 | 1.000 | 1.000 | **1.0×** |
| 1 | 0.490 | 1.000 | **2.0×** |
| 2 | 0.240 | 1.000 | **4.2×** |
| 3 | 0.118 | 1.000 | **8.5×** |
| 4 | 0.058 | 1.000 | **17.4×** |
| 5 | 0.028 | 1.000 | **35.4×** |

Under true Dennard scaling that last column reads 1.0 all the way down. With V frozen it
reads 35×. **Nothing can dissipate 35× more watts per square millimetre.** A chip already
running near 100 W/cm² — comparable to a hotplate — cannot go to 3.5 kW/cm², which is the
territory of a rocket nozzle. The physics of getting heat out of a package became the binding
constraint on the physics of computing.

**The consequences, in order:**

**(a) The frequency wall.** Clock speeds had been climbing exponentially — 33 MHz in 1990,
1 GHz in 2000, and Intel's public roadmap in 2000 projected **10 GHz** Pentium 4s by the
mid-2000s. That never happened. Intel cancelled the 4 GHz Pentium 4 in October 2004 and
killed the Tejas/Jayhawk NetBurst successors, publicly citing power. Wikipedia's summary:
since 2005 *"clock frequency has stagnated at 4–6 GHz, and the power consumption per CPU at
100 W TDP."* **Twenty years. The number on the box stopped moving in 2005 and has moved
maybe 50% since.** Nothing else in the history of computing has been flat for twenty years.

**(b) The pivot to multicore.** If you cannot make one core faster, you can still spend your
Moore's-Law transistors on *more* cores. And there is a real efficiency argument, not just a
consolation prize: because power goes roughly as V³ and V tracks f, **two cores at 0.75× the
frequency deliver 1.5× the throughput for less power than one core at 1.0×.** Intel's Core
Duo (2006) and AMD's Athlon 64 X2 (2005) mark the turn. Herb Sutter's essay *"The Free Lunch
Is Over"* (Dr. Dobb's, March 2005) is the canonical contemporaneous statement of what this
meant for programmers.

**And this is where it stops being a hardware story.** Dennard scaling was the thing that
made single-threaded performance improve for free. Its end is the moment **concurrency
stopped being a specialist skill and became table stakes**, the moment Amdahl's Law started
mattering to ordinary programmers, and the moment "just wait for next year's CPU" stopped
being a valid answer to a performance problem. Every threading library, every async runtime,
every lock-free data structure, every `rayon`/`tokio`/`std::thread` in your codebase is a
downstream consequence of subthreshold leakage having a 60 mV/decade floor.

**(c) Then GPUs and accelerators.** Multicore hit its own limits — Amdahl's Law caps the
speedup, cache coherence traffic grows superlinearly with core count, and general-purpose
out-of-order cores spend most of their transistors and power on *control* (branch predictors,
reorder buffers, schedulers) rather than arithmetic. If power is the budget, the winning move
is to spend it on arithmetic. That means:

- **throughput cores over latency cores** — many simple in-order lanes sharing one
  instruction stream (SIMT), which amortizes fetch/decode/schedule power across 32 lanes;
- **specialization** — a fixed-function matrix-multiply unit does the same FLOPs for
  1–2 orders of magnitude less energy than a general-purpose core, because it doesn't pay for
  instruction fetch, register file ports, or scheduling per operation. This is exactly what a
  Tensor Core is;
- **lower precision** — energy per operation falls roughly with the square of mantissa width
  for a multiplier, and data movement falls linearly with bit width. FP32 → BF16 → FP8 → FP4
  is a *power* optimisation before it is a memory optimisation.

**The straight line: Dennard's end → multicore → GPUs → Tensor Cores → FP8/FP4.** Every step
is the same move — when you cannot have more watts, buy more useful work per watt by
specializing. The curriculum's later units on CUDA, Tensor Cores and MX formats are all
continuations of *this* paragraph, and saying so out loud is worth more than any of them
individually.

**(d) Dark silicon.** The terminal form. Defined as *"the amount of circuitry of an integrated
circuit that cannot be powered-on at the nominal operating voltage for a given thermal design
power (TDP) constraint."* Moore's Law still delivers transistors; the power budget does not
grow. So a growing fraction of the chip must be off at any instant.

Esmaeilzadeh, Blem, St. Amant, Sankaralingam and Burger, **"Dark Silicon and the End of
Multicore Scaling," ISCA 2011**, projected that at the **8 nm** node **50–80% of a chip may be
dark** depending on architecture, cooling and workload.

What dark silicon *buys* you, once you accept it, is that **area is cheap and power is
expensive** — which inverts fifty years of design instinct. If most of the chip is off anyway,
you may as well fill it with lots of specialized units and light up only whichever one suits
the current workload. A modern SoC is exactly this: CPU cores, GPU, NPU, ISP, video
encode/decode, DSP, crypto — a drawer of tools, most of them idle, each far more efficient
than a general-purpose core at its one job. **Dark silicon is the reason your phone chip is a
zoo.**

## 3.5 The scoreboard

| Era | Constraint | Response |
|---|---|---|
| 1975–2004 | none (Dennard held) | Crank the clock. Free single-thread speedup. |
| 2005–2010 | power density | Multicore. Programmers must parallelize. |
| 2010–2016 | Amdahl + coherence | Heterogeneity, SoCs, dark silicon, turbo/DVFS |
| 2016– | energy per operation | GPUs, systolic arrays, reduced precision, near-memory compute |
| 2022– | **power delivery and cooling at rack and grid scale** | liquid cooling, 800 VDC racks, siting datacenters next to generation |

The constraint has been power for twenty years. Only the length scale changes: transistor →
die → package → rack → substation.

## 3.6 The power-management toolkit

**Clock gating.** Stop the clock to an idle block. Kills α for that block → dynamic power
goes to ~0, leakage remains. Cheap (one AND gate per clock branch, though you use a proper
integrated clock-gating cell to avoid glitches), fine-grained, ubiquitous — synthesis tools
insert it automatically. First thing to reach for, because the clock tree is the highest-α
net on the chip.

**Power gating.** Disconnect a block from V_dd entirely, via large "header"/"footer" sleep
transistors. Kills **leakage** as well as dynamic power. Expensive: the block loses state
(needs retention flops or save/restore), and wake-up takes microseconds to milliseconds
because you must recharge the block's entire power grid without causing a supply droop that
crashes its neighbours. Coarse-grained. This is what "core parking" and C-states are.

**DVFS — Dynamic Voltage and Frequency Scaling.** Because P ≈ V³ when f tracks V, a modest
voltage cut is a large power cut. Implemented as discrete operating points (P-states) with
per-core or per-domain voltage rails. Both *turbo* (boost one core above base while others
idle, inside the same package budget) and *throttling* are DVFS.

**Race to idle.** Given the choice between running slowly for a long time and running fast
then sleeping, which wins? The answer flipped historically and is worth teaching for exactly
that reason:

- **Pure dynamic-power world:** run slow. Energy per operation is lower at lower V, and
  there's no fixed cost to being awake.
- **Real world with significant leakage plus fixed platform power** (memory in self-refresh,
  PLLs, voltage regulators, display, radios): being awake costs watts regardless of what you
  compute. If that fixed cost is large enough, finishing quickly and entering a **deep sleep
  state** wins. Wikipedia states it as *"more efficient to run briefly at peak speed and stay
  in a deep idle state for longer time."*
- **The honest answer: it depends on the ratio of leakage-plus-platform power to dynamic
  power, and on how deep your idle states really are.** Modern schedulers measure. The
  teachable point is that this is a genuine, quantitative crossover — a great exercise, and a
  good antidote to the belief that "efficient" and "slow" are synonyms.

---

# 4. Thermals and delivery

## 4.1 TDP, and what it does not mean

**TDP (Thermal Design Power)** is the heat load, in watts, that the **cooling solution** must
be able to remove for the part to sustain its rated behaviour. It is a *specification to the
thermal engineer*, not a measurement of the chip.

What it is not:
- **Not maximum power draw.** Both Intel (PL2/PL4 turbo power) and AMD (PPT) let a chip
  exceed TDP substantially for bounded windows. A "125 W" desktop part can pull 250 W+.
- **Not typical power draw.** Idle is a tiny fraction.
- **Not comparable across vendors** — the definitions and the reference conditions differ.
- **Not a physical constant of the die.** It's a design target chosen alongside the cooler.

What it *is* useful for: sizing heatsinks, sizing power supplies, and — at datacenter scale —
sizing everything, because at that scale the fleet really does run near TDP continuously.

**Thermal throttling** is the enforcement mechanism. On-die thermal diodes feed a control
loop that drops P-states (DVFS) when junction temperature (T_j) approaches a limit (typically
95–105 °C). Sustained performance is therefore a *cooling* specification, not a silicon
specification — which is why the same laptop chip benchmarks differently in different
chassis, and why "boost clock" is a marketing number and "all-core sustained clock" is a
real one.

## 4.2 Heat density is the actual problem

Total watts are easy. **Watts per square millimetre** is not. Heat must cross:

    junction → die → TIM1 → heat spreader → TIM2 → heat sink → air/liquid

Each interface has a thermal resistance in °C/W, and they add in series. A **hot spot** — a
small, hard-working region such as an FPU or a matrix unit — can be 20–30 °C above the die
average and is what actually trips the throttle. This is why modern chips have dozens of
distributed thermal sensors rather than one.

Rough scale, for calibration:

| | Approx. heat flux |
|---|---|
| Kitchen hotplate | ~10 W/cm² |
| Modern high-end CPU die average | ~50–150 W/cm² |
| Local hot spot on such a die | can exceed 500 W/cm² |
| Nuclear reactor fuel rod surface | ~100 W/cm² |

A high-end processor is, in the small, a harder cooling problem per unit area than a reactor
core. That framing lands with learners and it is not an exaggeration.

**Two things made this worse, both structural:**

1. **Dennard's end** (§3.4) — power density stopped being constant and started climbing.
2. **3D stacking** (§6) — stack dies and you multiply the heat generated per unit of *lateral*
   area while the surface area available to remove it stays the same. Worse, the die in the
   middle of a stack has no path to the heatsink except *through* its neighbours. This is
   exactly the constraint that made AMD's early 3D V-Cache parts clock lower than their
   non-stacked siblings, and why AMD's fix in Zen 5 was to move the cache die *underneath*
   the compute die so the hot cores sit against the lid (see `cpu-architectures.md` §3.2:
   the 9800X3D "cache die moved below the compute die → the cores are on top, next to the
   heatspreader. Full clocks *and* the cache.").

## 4.3 Why a B200 needs liquid cooling

Verified numbers:

| Part | Power | Cooling |
|---|---|---|
| H100 SXM5 | **700 W** | air (marginal) or liquid |
| **B200** | **1000 W** | practically requires liquid |
| GB200 NVL72 (72 GPUs + 36 Grace CPUs in one rack) | — | *"a liquid-cooled, rack-scale solution"* |

*(Per-GPU numbers from [Wikipedia: Nvidia DGX](https://en.wikipedia.org/wiki/Nvidia_DGX); NVL72 liquid-cooling from the same source.)*

Why air stops working, in three steps:

1. **Air is a terrible coolant.** Volumetric heat capacity of water is roughly **3,500× that
   of air**. Removing 1 kW with air requires enormous volumetric flow, which means large
   heatsinks, high fan speeds, high acoustic noise, and significant fan power — which is
   itself part of the datacenter's power bill.
2. **The chip is physically large and the heat is concentrated.** A B200 package carries two
   reticle-limit dies (104 billion transistors each, **208 billion total**, on TSMC 4NP)
   plus 8 HBM3e stacks, all within a package of a few thousand mm². 1000 W across that area
   is a heat flux air-cooling can only serve with a heatsink too tall to fit in a 1U-2U rack
   slot at the required density.
3. **Density is the actual business requirement.** You could air-cool a B200 in a big enough
   box. But an AI training cluster's economics depend on how many GPUs sit within one NVLink
   domain, because the interconnect must be short and fast. GB200 NVL72 puts 72 GPUs in one
   rack specifically so they can share a single NVLink fabric. At 72 × 1 kW plus CPUs,
   networking, and losses, you are at **~100+ kW in one rack** — an order of magnitude past
   what a normal air-cooled datacenter rack (5–15 kW) is designed for. **Liquid cooling is
   not chosen for the chip's sake; it is chosen because the interconnect wants the GPUs close
   together, and if they are close together air cannot get the heat out.**

*(The ~100–120 kW/rack figure for NVL72 is widely reported but I could not verify it from a
primary source in this session — see §10. The 1000 W per B200 and the "liquid-cooled,
rack-scale" description are verified.)*

Direct-to-chip cold plates are the mainstream approach: a water block on the package,
warm-water loops (often 30–45 °C inlet, which allows dry coolers and no chillers), CDUs
(coolant distribution units) per rack or per row. Immersion cooling exists and works but has
serviceability and materials-compatibility problems.

## 4.4 Power delivery: VRMs

Getting 1000 W into a chip at ~0.8 V means **1,250 amperes**. This is a genuinely hard
problem and it is invisible in every logic curriculum.

- The board is fed 12 V (or, increasingly, 48 V, and now 800 VDC at rack scale) precisely
  because current at low voltage is unmanageable over distance. `P_loss = I²R` — halving
  current quarters resistive loss, so you distribute at high voltage and step down as late
  as possible.
- A **VRM** (Voltage Regulator Module) is a multiphase buck converter: N phases, each
  switching at hundreds of kHz to a few MHz, interleaved so their ripple partly cancels. A
  high-end part might have 16–20+ phases. Each phase carries a manageable current; together
  they carry 1,000+ A.
- **Load transients are the hard part.** A GPU can go from idle to full load in nanoseconds
  when a kernel launches — di/dt of hundreds of amps per microsecond. The VRM's control loop
  cannot respond that fast. What bridges the gap is a **decoupling capacitor hierarchy**:
  bulk electrolytics on the board (slow, large), ceramics near the package (faster), package
  capacitors, and finally **on-die capacitance** (fastest, smallest). Each tier covers a
  different frequency band of the transient.
- Fail to do this and you get **voltage droop** — the supply momentarily sags, gates slow
  down, and a path that met timing at 0.80 V misses it at 0.75 V. The mitigations are ugly
  and real: guard-band the voltage upward (costs power, V² everywhere), or detect the droop
  and stretch the clock for a few cycles (Adaptive Frequency Scaling). **This is why
  "power virus" workloads exist as a design corner** — a synthetic load that toggles the
  maximum number of nodes simultaneously, used to find the worst di/dt the VRM must survive.
- VRM efficiency is ~85–93%. At 1000 W of load that is **75–150 W dissipated in the
  regulators alone**, which also must be cooled.

## 4.5 The datacenter consequence

The chain, each link forced by the previous:

1. Dennard ended → performance per watt improves slowly → performance requires watts.
2. AI training and inference demand grows far faster than efficiency improves.
3. Per-rack power goes from ~10 kW to ~100 kW+.
4. **The binding constraint on an AI buildout stops being chips and becomes electricity and
   the ability to reject heat.** Grid interconnect queues run to multiple years in the major
   US markets. Substation and transformer lead times are measured in years.
5. Hence: datacenters sited next to generation (hydro, nuclear, gas), power-purchase
   agreements for entire plants, restarted nuclear units, on-site generation, and 800 VDC
   rack distribution to cut conduction losses.
6. Hence also: **PUE** (Power Usage Effectiveness = total facility power / IT power) as a
   headline metric, and the observation that liquid cooling improves PUE *because it deletes
   the fan and chiller power*, not only because it cools better.

**The teachable sentence:** a modern AI datacenter is a device for converting electricity into
matrix multiplications, and its output is limited by its input. Every architectural decision
above — reduced precision, sparsity, specialized units, chiplets, HBM — is an attempt to move
more FLOPs through a fixed number of watts. *That* is the through-line the whole curriculum
is walking.

*(Specific grid-queue durations, PUE figures and PPA details are from general knowledge; not
verified in this session. See §10.)*

---

# 5. Making a chip

## 5.1 The loop

A chip is not "printed." It is built up in layers, and the process is one loop repeated
**~300 to 1000+ times** for an advanced node. [Wikipedia](https://en.wikipedia.org/wiki/Semiconductor_device_fabrication):
*"Modern chips have up to eleven or more metal levels produced in over 300 or more sequenced
processing steps."*

The loop, in four verbs (the standard taxonomy: deposition, removal, patterning,
modification):

1. **Deposition** — add a layer of something. Oxide, nitride, polysilicon, copper, tungsten.
   Methods: CVD (chemical vapour deposition), PVD (sputtering), **ALD** (atomic layer
   deposition — one atomic monolayer per cycle, which is how you deposit a 2 nm hafnium oxide
   gate dielectric with control), epitaxy (growing crystalline silicon on crystalline
   silicon).
2. **Patterning (photolithography)** — decide *where* that layer stays. §5.2.
3. **Removal (etch)** — take away what the pattern didn't protect. Wet (chemical, isotropic —
   eats sideways) or dry/plasma (anisotropic — cuts straight down, essential for small
   features). Plus **CMP** (chemical-mechanical planarization): grinding the wafer flat again,
   because lithography needs a flat surface and you cannot focus on a bumpy one. CMP is
   underrated — without it you could not stack 15 metal layers.
4. **Modification (doping)** — **ion implantation**: fire dopant ions at the wafer at
   keV–MeV energies, then anneal to repair lattice damage and activate them. Precise dose and
   depth, unlike the older thermal diffusion. The 1974 Dennard paper's title says
   "ion-implanted" for exactly this reason: it was the enabling technique.

**FEOL / BEOL.** *Front-end of line* builds the transistors in and on the silicon: wells,
isolation, gate stack, source/drain, contacts. *Back-end of line* builds the wiring: 11–20
layers of copper interconnect in dielectric, connected by vias, going from very fine local
wires at the bottom to fat power/global wires at the top. **BEOL is most of the layer count
and most of the capacitance** — which loops back to §3.1, where `C` is now dominated by wires
rather than gates. There is more copper than silicon in a modern chip's business end.

## 5.2 Photolithography

The patterning step, which is the whole game.

1. Coat the wafer in **photoresist** (a polymer whose solubility changes on light exposure).
2. Shine light through a **photomask** (also "reticle") — a quartz plate with an opaque
   chrome pattern, drawn at **4× the final size**.
3. A **projection lens** demagnifies 4:1 onto a small area of the wafer. That exposed area is
   one **exposure field**, at most **~26 mm × 33 mm = 858 mm²** — the **reticle limit**.
   Remember this number; §6 is entirely about it.
4. Develop away the exposed (or unexposed) resist.
5. Etch / implant / deposit through the resulting stencil.
6. Strip the resist. **Step to the next field** and repeat across the wafer — hence
   "**stepper**", and "**scanner**" for tools that scan mask and wafer simultaneously.

**Resolution** is governed by the Rayleigh criterion:

    CD = k₁ · λ / NA

- **λ** = wavelength of the light
- **NA** = numerical aperture of the lens
- **k₁** = a process factor, theoretically floored around 0.25 for a single exposure

You improve resolution by shrinking λ, raising NA, or lowering k₁. All three have been pushed
to the wall.

## 5.3 DUV, and multi-patterning

The industry has been on **193 nm ArF excimer laser** light since about 2000 and — this is
the surprising part — *stayed there for two decades*. 157 nm was attempted and abandoned
(no usable lens materials). So instead:

- **Immersion lithography (2007).** Put purified water (n = 1.44) between the final lens and
  the wafer. NA goes from ~0.93 to **1.35**. This buys you an effective λ of 193/1.44 = 134 nm.
  Wikipedia: 193 nm immersion at NA 1.35 achieves **38 nm resolution at k₁ = 0.27** — right at
  the theoretical floor.
- **Multi-patterning.** Once you're at the single-exposure limit, split one layer across
  several exposures. **LELE** (litho-etch-litho-etch) double patterning; **SADP/SAQP**
  (self-aligned double/quadruple patterning), where you deposit spacers on the sidewalls of a
  pattern and then remove the original, halving the pitch each time.

Multi-patterning is how 10 nm and 7 nm were built without EUV. It works, and it is
**brutally expensive**: each extra exposure adds masks, process steps, cycle time, cost, and —
critically — **overlay error**, because two separately-exposed patterns must align to within a
couple of nanometres. Some 7 nm layers needed quadruple patterning. Cost per layer went up
several-fold and yield went down.

This economic pain is the entire justification for EUV.

## 5.4 EUV, and why it is so hard

**λ = 13.5 nm.** A 14× reduction in wavelength in one jump. Verified details, all from the
[EUV lithography article](https://en.wikipedia.org/wiki/Extreme_ultraviolet_lithography):

**The source is absurd.** There is no 13.5 nm laser. You make it as plasma:
- Tin droplets are fired across a vacuum chamber at ~50,000 per second.
- A **dual-pulse CO₂ laser** (λ = 10.6 μm, pulse ~15–25 ns, intensity ~10¹¹ W/cm²) hits each
  droplet: the first pulse flattens it into a pancake, the second vaporizes it into a plasma
  at ~500,000 K.
- That plasma radiates 13.5 nm EUV. Current sources deliver **~250 W in-band**; High-NA wants
  ≥500 W.
- Overall wall-plug efficiency is on the order of a percent. Wikipedia: EUV consumes *"at
  least 10× more energy than immersion tools."*

**Everything absorbs EUV, so there are no lenses.** *"All matter absorbs EUV radiation. Hence,
EUV lithography requires vacuum."* No glass, no air, no transmissive mask. Consequences:
- The entire optical path is in **vacuum**.
- All optics are **reflective**: Mo/Si **multilayer Bragg mirrors**, ~40–50 alternating layer
  pairs each a few nm thick, engineered so reflections add in phase. Peak reflectivity is only
  **~70%**.
- With 8+ mirrors in the system, **~96% of the generated light is absorbed before reaching the
  wafer.** *This* is why you need a 250 W source to deliver a few watts to the resist, and
  why the source is the hardest part of the machine.
- **The mask is reflective too.** Which forces off-axis illumination at ~6°, which causes a
  shadowing asymmetry: *"identically sized horizontal and vertical lines on the EUV mask are
  printed at different sizes on the wafer."* Every mask must be corrected for this.

**The other problems:**
- **Pellicles.** A pellicle is a thin membrane held above a mask so that dust lands
  out-of-focus rather than printing. EUV pellicles must be nearly transparent at 13.5 nm,
  survive the heat, and not contaminate — a materials problem that took years and is still
  awkward.
- **Stochastic effects.** At 13.5 nm each photon carries ~92 eV, so a given dose is delivered
  by far *fewer* photons than at 193 nm. Photon shot noise becomes visible in the pattern.
  Worse, absorption releases secondary electrons that scatter **15+ nm** in the resist — a
  blur comparable to the feature you're trying to print. Result: line-edge roughness and
  random missing/merged contacts, degrading resolution *"below ~20 nm, even when optics
  theoretically permit finer patterning."* Fighting this means higher dose, which means lower
  throughput, which means the source is the bottleneck again.
- **Mirror degradation.** Tin debris costs ~0.1–0.3% reflectivity per billion pulses;
  collector mirrors are replaced roughly annually. Hydrogen gas (1–10 Pa) is flowed to
  chemically clean tin as volatile stannane.

**The machine.** ASML NXE:3400B/C, NXE:3600D at NA 0.33; EXE:5000/5200B at **High-NA 0.55**.
Roughly **200 tonnes**, **~$180 million** for a 0.33 NA tool (High-NA is substantially more),
shipped in multiple 747-loads. Throughput **136–185 wafers/hour** versus DUV's ~296.

**High-NA (0.55).** More resolution, but the optics are anamorphic — 4× demagnification in one
axis and 8× in the other — which **halves the field size to ~26 × 16.5 mm**. That means big
dies must be **stitched** from two exposures. Note where that lands: at exactly the moment the
industry most wants enormous AI accelerator dies, the best lithography tool makes big dies
harder. This is another force pushing toward chiplets (§6).

**One question worth putting to the learner:** ASML is the only company on Earth that makes
EUV scanners. Given the source power problem, the multilayer mirror problem, the vacuum
problem, the pellicle problem, and the stochastic problem — each of which took a decade and
involved a different specialist supplier (Zeiss for the optics, Cymer for the source, Trumpf
for the CO₂ laser) — should we be surprised, or is a monopoly the *expected* outcome of a
20-year, ~$10B+ R&D program with one customer segment?

## 5.5 Masks and layer counts

- A full mask set for an advanced node is **60–100+ masks** at **$100k–$1M each**; a
  leading-edge set runs **tens of millions of dollars**. This is a pure fixed cost, paid
  before a single chip exists.
- **This is why chip design economics are so brutal and why fabless works.** The mask set plus
  design costs (EDA licences, IP, verification, a large team) put NRE for a leading-edge SoC
  in the **hundreds of millions**. You need enormous volume to amortize it, which is why
  leading-edge nodes are dominated by a handful of products: phone SoCs, GPUs, datacenter
  CPUs. It is also why **shuttle/MPW runs** (multiple customers' designs sharing one mask set)
  exist for prototypes and academia.
- Masks are not simple images. **OPC** (optical proximity correction) and **inverse
  lithography** mean the shape on the mask looks nothing like the shape you want on the
  wafer — it's pre-distorted, festooned with serifs and scattering bars, to compensate for
  diffraction. Computing OPC for a full chip is a large HPC workload in itself.

## 5.6 Yield and defect density

A particle, a misaligned layer, or a random dopant fluctuation kills a die. **Yield** is the
fraction of dies that work.

The standard models relate yield `Y` to **defect density D₀** (defects per unit area, usually
per cm²) and **die area A**:

| Model | Formula | Assumption |
|---|---|---|
| **Poisson** | `Y = e^(−D₀A)` | Defects independent and uniformly random |
| **Murphy** | `Y = ((1 − e^(−D₀A)) / (D₀A))²` | Defect density itself varies across the wafer (triangular distribution) |
| **Seeds** | `Y = 1 / (1 + D₀A)` | Heavily clustered defects |
| **Negative binomial / Bose-Einstein** | `Y = (1 + D₀A/α)^(−α)` | α = clustering parameter; α→∞ recovers Poisson |

*(The five-model list — Murphy, Poisson, binomial, Moore, Seeds — is confirmed by the
[fabrication article](https://en.wikipedia.org/wiki/Semiconductor_device_fabrication); the
negative-binomial formula is from [AnySilicon](https://anysilicon.com/die-per-wafer-formula-free-calculators/).
The Poisson, Murphy and Seeds closed forms above are standard textbook results that I state
from knowledge — see §10 — but note the empirical check immediately below, which is strong
evidence they are right.)*

**Dies per wafer** (from the [wafer article](https://en.wikipedia.org/wiki/Wafer_(electronics))),
with the edge correction, for wafer diameter `d` and die area `S`:

    DPW = πd²/(4S) − 0.58 · πd/√S

The second term is the wasted partial dies around the circular edge. For a 300 mm wafer
(70,686 mm² of area) it costs you real dies — and it costs you *proportionally more* the
bigger your die, which is a second, independent penalty on large dies.

### An empirical check that validates the model

TSMC published, for 5 nm test chips:
- die area **17.92 mm²** → yield **~80%** (peak per-wafer >90%)
- die area **100 mm²** → yield **32%**

Fit each model to the first point, then predict the second:

| Model | Fitted D₀ | Predicts Y(100 mm²) | Actual |
|---|---|---|---|
| Poisson | 1.245 /cm² | 28.8% | 32% |
| **Murphy** | **1.269 /cm²** | **32.1%** | **32%** |
| Seeds | 1.395 /cm² | 41.8% | 32% |
| Negative binomial (α = 3) | 1.293 /cm² | 34.1% | 32% |

**Murphy's model reproduces TSMC's published number to within 0.1 percentage points.** That is
a remarkably clean validation and it makes an excellent exercise: give the learner the two
data points, have them fit each model, and let them discover which one industry actually uses.

Two caveats to state, because they matter for §6's arithmetic:
- D₀ ≈ 1.27/cm² is an **early-ramp, test-chip** number for a brand-new node. A mature process
  gets to **0.05–0.2 /cm²**. Yield improvement over a node's life is enormous and is most of
  why a chip gets cheaper without changing.
- Yields quoted publicly are frequently "defect-limited yield" and exclude parametric yield
  (dies that work but miss speed or power targets).

### Extrapolating the same D₀ to big dies

Murphy, D₀ = 0.0127 /mm² (the TSMC 5 nm early-ramp fit):

| Die area | Yield |
|---|---|
| 50 mm² | 54.8% |
| 100 mm² | 32.1% |
| 200 mm² | 13.2% |
| 400 mm² | 3.8% |
| 800 mm² | 1.0% |
| **858 mm² (reticle limit)** | **0.8%** |

A reticle-sized monolithic die on a brand-new node would yield under one percent. **You cannot
build a 208-billion-transistor GPU that way.** §6 is the answer.

## 5.7 Binning

Not every non-working die is scrap. **Binning** sorts working dies by measured speed, power
and functional completeness, and sells them as different products:

- A 16-core die with two defective cores becomes a **12-core** SKU (cores disabled by fuses).
- A die that hits target frequency at low voltage becomes the premium part; one that needs
  more voltage becomes the cheaper, lower-clocked part.
- GPU vendors do this aggressively: NVIDIA's flagship GB202 die has 192 SMs; the RTX 5090
  ships **170 of them** enabled, and 96 MB of the die's 128 MB L2 (per `nvidia-architectures.md`).
  Hopper's H100 SXM5 ships **132 of 144 SMs**. Those disabled units are yield harvesting made
  visible in the spec sheet.

**Binning is why the product line looks the way it does.** The i5/i7/i9 ladder is not three
designs; it is often one design and a test result. It also means "yield" is the wrong single
number — what matters economically is the *distribution* of dies across bins weighted by
price, and the marginal cost of the low bin is roughly zero, which is why cheap SKUs exist.

## 5.8 Why "3nm" measures nothing

**The history.** Until roughly the 1990s, the node name meant something concrete: the **gate
length** of the transistor (or half the minimum metal pitch). "180 nm" meant a ~180 nm gate.
The name and the physics tracked each other.

Then they came apart, for two reasons:

1. **Gate length stopped scaling with everything else.** From ~2000, engineers found gate
   length could be pushed *below* the node name (a "90 nm" process had ~50 nm physical gates)
   for extra speed. Then, from the mid-2000s, gate length scaling largely **stalled** at
   ~20 nm while other dimensions kept shrinking.
2. **Marketing took over.** Once the name no longer denoted a measurable feature, it became a
   generation label. Each foundry names its own nodes relative to its own previous
   generation. Wikipedia is unambiguous: *"3 nanometer has no direct relation to any actual
   physical feature"*; it is *"a marketing term by individual microchip manufacturers"*, and
   *"there is no industry-wide agreement among different manufacturers about what numbers
   would define a '3 nm' node."*

**Look at what a "3 nm" process actually measures:**

| | TSMC N3/N3E | Samsung 3GAE | Intel 3 |
|---|---|---|---|
| **Gate (contacted poly) pitch** | 45–48 nm | 40 nm | 50 nm |
| **Minimum metal pitch** | 23 nm | — | 30 nm |
| **Transistor density** | **197–216 MTr/mm²** | 150–190 MTr/mm² | **143 MTr/mm²** |
| SRAM bit cell | 0.0199–0.021 μm² | — | — |
| Transistor structure | FinFET | **GAA (MBCFET)** | FinFET |

**Nothing on that chart is 3 nm.** The smallest number is a 23 nm metal pitch — nearly 8×
larger. And the three "3 nm" processes differ from each other by **50% in transistor density**
and use two different transistor architectures. Intel's "3" is *denser than nobody's* — it is
less dense than TSMC's N3 by a third. The names are not comparable and were never meant to be.

**The real metrics to teach instead:**

1. **Transistor density (MTr/mm²)** — the honest headline number, though even this is quoted
   as a weighted mix of logic-cell types and can be gamed by choice of cell.
2. **CPP / contacted poly pitch** — centre-to-centre spacing of adjacent transistor gates.
   Sets how tightly transistors pack horizontally.
3. **MMP / minimum metal pitch** — the finest wiring pitch. Sets how densely you can route,
   and (increasingly) sets the real density limit, because you run out of wiring before you
   run out of transistors.
4. **CPP × MMP** ≈ a "unit cell" area, sometimes multiplied by a cell-height track count
   (e.g. "6-track cell") to get a real density figure.
5. **SRAM bit cell area** — a clean, single-number, apples-to-apples comparison, because
   everyone builds essentially the same 6T cell. **SRAM has scaled far worse than logic in
   recent nodes**, which is a big deal: caches are a large fraction of a modern die and they
   are no longer getting cheaper. (This is one of the real motivations for 3D V-Cache in §6.5
   — if you cannot shrink SRAM, stack it.)

Intel's public reaction to all this was to rename its roadmap in 2021 (10nm Enhanced
SuperFin → "Intel 7", then Intel 4, Intel 3, 20A, 18A) explicitly to align its *names* with
TSMC's, which is the most candid possible admission that the numbers are marketing.

**The curriculum point:** "3 nm" is a *product generation name*, like "iPhone 15." Ask for
density and pitch. And notice that a learner who accepts node names at face value will draw a
badly wrong conclusion about how much room is left — because the names imply we're near atomic
limits (a silicon atom is ~0.2 nm, so "3 nm" sounds like 15 atoms), while the actual smallest
pitch is ~23 nm, or roughly 100 atoms. There is more room than the marketing implies, and less
than Moore's Law needs.

## 5.9 Planar → FinFET → GAA → CFET

The structural story, driven end to end by one problem: **as the channel gets shorter, the
gate loses control of it** (short-channel effects — the drain's field starts competing with
the gate's, V_th drops with channel length, and the transistor stops turning off properly).
Leakage, again.

**Planar** (until ~2011). Gate on one side of the channel only.

**FinFET / Tri-gate** (Intel **22 nm, 2011**; shipping 2012 — verified). Stand the channel up
as a thin vertical **fin** and wrap the gate over three sides. Vastly better electrostatic
control for the same footprint: *"significantly faster switching times and higher current
density"*, better subthreshold slope, much less leakage. It also makes width **quantized** —
you get drive strength in whole fins, not continuously — which is a real design constraint.
Everyone moved to FinFET: TSMC/Samsung at 16/14 nm.

**GAA / nanosheet / MBCFET** (Samsung **3 nm, from 2022**; TSMC at N2; Intel at 20A/18A with
RibbonFET). Take the fin and lay it down as horizontal **sheets**, stacked 3–4 high, with the
gate wrapped **completely around** each — all four sides. Maximum electrostatic control. And
because the sheet's *width* is set by lithography rather than quantized by fin count, you get
**continuously tunable drive strength** back, which is a genuine design-productivity win.

**CFET** (research/next). Stack the NMOS and PMOS devices **vertically on top of each other**
instead of side by side. Since every CMOS gate needs both (§2.1), this roughly halves the
footprint of a logic cell. This is the industry's plan for the 2030s.

Read as a sequence, this is one idea applied four times: **surround the channel with more
gate**. Every step is a leakage fix, which means every step is a §3 story, which means the
transistor's shape is downstream of the power equation.

## 5.10 The industry

**Fabless vs IDM.**
- **IDM** (Integrated Device Manufacturer) — designs *and* manufactures. Intel, Samsung, TI,
  Micron. Historically the whole industry.
- **Fabless** — designs only, contracts manufacturing to a foundry. NVIDIA, AMD, Apple,
  Qualcomm, Broadcom, ARM licensees.
- **Foundry** — manufactures other people's designs. TSMC (created the model in 1987), GlobalFoundries, UMC, SMIC.

**Why fabless won.** A leading-edge fab costs **$20–40 billion**. Depreciation is brutal and
the tool set is obsolete in years. To be economic it must run near capacity continuously. Only
a company aggregating *many* customers' volume can fill one. So the industry vertically
disintegrated: TSMC bears the capital risk across all customers, and NVIDIA, Apple and AMD
spend their money on design instead. **AMD's 2009 spin-off of GlobalFoundries and subsequent
move to TSMC is the cleanest natural experiment** — AMD's competitive recovery from 2017
onward is substantially a story of getting access to TSMC's process while Intel's own 10 nm
faltered.

**The players.**
- **TSMC** — the dominant leading-edge foundry by a wide margin. Its customer list is
  effectively the list of important chips: Apple, NVIDIA, AMD, Qualcomm, Broadcom, and
  increasingly Intel.
- **Samsung Foundry** — the only other company shipping a leading-edge logic node. First to
  GAA at 3 nm, which is genuinely ahead architecturally, but has struggled with yield.
- **Intel Foundry** — Intel's attempt to sell capacity externally, betting on 18A (RibbonFET +
  **PowerVia**, backside power delivery — moving the power rails to the *back* of the wafer so
  the front side is free for signal routing; a real architectural first).
- **ASML** — sole supplier of EUV scanners worldwide. Sole. Not "dominant."
- **Applied Materials, Lam Research, Tokyo Electron, KLA** — deposition, etch, and metrology.
  Each near-monopolistic in its niche. The supply chain is a chain of monopolies.
- **Zeiss** (EUV optics), **Trumpf** (the CO₂ laser), **Cymer/ASML** (the source) — ASML's own
  monopoly rests on three more.

**The chokepoint framing worth giving the learner:** every leading-edge chip in the world
passes through an ASML EUV scanner. There are a few hundred of them. Their optics come from
one German company. This is the most concentrated supply chain of any strategically important
technology, and it is why semiconductor manufacturing became a geopolitical instrument. That
concentration is not a policy failure — it is the natural equilibrium when a single tool
requires a 20-year, multi-billion-dollar R&D program with a handful of possible customers.

---

# 6. Packaging, which is now the bottleneck

For fifty years the package was plumbing: get signals and power from the die to the board,
protect it, spread its heat. Nobody cared. **That changed completely,** and today TSMC's
*packaging* capacity — not its wafer capacity — is what rations the supply of AI accelerators.

## 6.1 Why chiplets happened: the yield math

Two hard walls force the issue.

**Wall 1: the reticle limit.** §5.2 — one exposure covers at most ~26 × 33 mm = **858 mm²**.
A monolithic die physically cannot exceed that. (Stitching exists; it is exotic and expensive.
Cerebras does it and is the exception that proves the rule.) High-NA EUV makes this *worse*,
halving the field to ~26 × 16.5 mm.

**Wall 2: yield falls exponentially with area.** This is the one with arithmetic.

### The worked example

Take **D₀ = 0.1 defects/cm² = 0.001 /mm²** — a realistic *mature*-node number — and use the
Poisson model `Y = e^(−D₀A)` for clean arithmetic. A 300 mm wafer, dies-per-wafer with the
edge correction from §5.6. Question: how many complete 800 mm²-equivalent products can we
harvest per wafer?

| Design | Die area | Gross dies/wafer | Yield | Good dies | **Complete products** |
|---|---|---|---|---|---|
| **Monolithic** | 800 mm² × 1 | 69 | **44.9%** | 31.0 | **31.0** |
| 2 chiplets | 400 mm² × 2 | 149 | 67.0% | 99.9 | **49.9** |
| **4 chiplets** | 200 mm² × 4 | 314 | **81.9%** | 257.1 | **64.3** |
| 8 chiplets | 100 mm² × 8 | 652 | 90.5% | 590.0 | **73.7** |

**Splitting one 800 mm² die into four 200 mm² chiplets more than doubles the number of
products per wafer — 31 → 64, a 2.1× improvement — with no change to the design's logic
whatsoever.** Going to eight chiplets gets 2.4×.

**Where the win comes from — this is the intuition to nail:**

A defect kills whatever die it lands in. In the monolithic case, one defect anywhere in
800 mm² destroys all 800 mm² of good silicon. In the 4-chiplet case, that same defect
destroys only 200 mm²; the other three quarters of that area are still sellable. **Chiplets do
not reduce the defect rate. They reduce the blast radius of each defect.** Yield loss goes
from "throw away the whole product" to "throw away a quarter of it."

Formally: for `n` chiplets of area `A/n`, the probability that *all* n are good is
`(e^(−D₀A/n))ⁿ = e^(−D₀A)` — **identical to the monolithic yield.** So where does the gain
come from? Two places, and both are worth making explicit because the algebra above looks
like it says chiplets are useless:

1. **You don't need n specific chiplets — you need any n good ones.** Chiplets are fungible.
   You harvest good dies from the whole wafer and assemble products from the pool. The
   "all n must come from one 800 mm² footprint" constraint is exactly what you deleted.
2. **The edge-loss term.** `0.58 · πd/√S` — smaller dies waste less of the wafer's circular
   edge. In the table above, 800 mm² dies give 69 gross per wafer (55,200 mm² of a
   70,686 mm² wafer used = 78%); 100 mm² dies give 652 gross (65,200 mm² = 92%).

And on a brand-new node the effect is far more violent. With the TSMC 5 nm early-ramp figure
(Murphy, D₀ = 1.27/cm²), an 800 mm² monolithic die yields **1.0%** — under one good die per
wafer — while 100 mm² dies yield **32.1%**, giving ~26 complete 8-chiplet products per wafer
versus **0.7**. On a new node, chiplets are not an optimisation; they are the difference
between shipping and not shipping.

**What chiplets cost, so the picture is honest:**
- **Die-to-die links burn power and area.** An on-die wire costs a fraction of a picojoule per
  bit; crossing packages costs an order of magnitude more. Chiplet interfaces are a
  significant power budget line.
- **Latency.** See `cpu-architectures.md` §3.2: cross-CCD core-to-core latency on a Ryzen
  9950X is **~75 ns** after a microcode fix, versus tens of ns within a CCD — and was ~180 ns
  at launch, *"not far off from cross-socket latencies on a server platform."* Chiplets give a
  single-socket desktop chip NUMA-like behaviour, which is a real programmer-visible cost.
- **Packaging yield is not 1.0.** You can assemble a package from good dies and still lose it.
- **Known-good-die testing is essential and hard.** Wikipedia's chiplet article puts it
  plainly: *"chiplets can be tested before assembly, improving the yield of the final device."*
  If you cannot fully test a bare die before assembly, the whole economic argument collapses —
  you'd be throwing away good dies attached to a bad one. This is why DFT (design for test)
  became a first-class discipline.

**The other reasons chiplets won**, beyond yield:
- **Mixed nodes.** Logic benefits from the newest node; I/O and analog do not shrink well
  (and SRAM increasingly doesn't either). AMD puts compute CCDs on the leading node and the
  I/O die on an older, cheaper one. You buy expensive silicon only where it pays.
- **Reuse.** *"The same chiplet can be used in many different devices."* One Zen CCD design
  goes into desktop Ryzen, Threadripper and EPYC, from 8 cores to 128+, by varying how many
  you attach. That is a colossal reduction in design NRE against §5.5's mask costs.
- **Product laddering.** Core count becomes a packaging decision, not a tapeout.

**UCIe** (Universal Chiplet Interconnect Express) is the industry's attempt to standardize the
die-to-die interface so chiplets from different vendors can interoperate — the PCIe of
packaging. Currently more aspiration than marketplace.

## 6.2 2.5D, 3D, interposers and TSVs

**Standard (2D) packaging.** Die flipped onto an organic substrate via solder bumps,
substrate to board via a ball grid array. Bump pitch ~100–150 μm — coarse, so you get
thousands of connections, not hundreds of thousands.

**2.5D.** Put multiple dies **side by side on a shared interposer**, which is itself a piece of
silicon (or an organic/RDL layer) carrying very fine wiring. Because the interposer is
patterned with real lithography, its wire pitch is ~1 μm rather than ~100 μm — **100× finer**,
so you can run tens of thousands of parallel wires between two dies. Then the interposer
mounts to a normal substrate. "2.5D" because the dies are still in a plane; only the wiring is
special.

**TSVs — Through-Silicon Vias.** Holes etched vertically through a silicon die and filled with
copper, so a signal can enter one face and exit the other. Typical diameters of a few μm.
TSVs are what make both interposers (signals must pass through the interposer to reach the
substrate below) and die stacking (§6.4) possible. They are hard: deep high-aspect-ratio
etching, void-free filling, thinning the wafer to ~50 μm so the vias reach through, and
handling wafers that thin without breaking them.

**3D.** Stack dies **vertically**, face-to-face or face-to-back. Two bonding technologies:
- **Microbumps** — tiny solder balls, ~10–40 μm pitch.
- **Hybrid bonding** — direct copper-to-copper and oxide-to-oxide bonding with **no solder at
  all**. Sub-10 μm pitch and falling, with far lower resistance, capacitance and energy per
  bit. This is the enabling technology for AMD's 3D V-Cache and for the newest HBM.

**The 3D trade-off is thermal and it is fundamental** (see §4.2): stacking multiplies power per
unit of *lateral* area while the heat-removal surface stays constant, and the buried die can
only reach the heatsink through its neighbours.

## 6.3 CoWoS and why it constrains GPU supply

**CoWoS** = **Chip-on-Wafer-on-Substrate**, TSMC's 2.5D platform, and the reason you cannot
buy as many GPUs as you want.

The flow: attach the logic dies and the HBM stacks onto a silicon interposer *at wafer scale*
("chip on wafer"), then mount the assembled interposer onto an organic package substrate
("on substrate").

Variants:
- **CoWoS-S** — a full **silicon** interposer. Finest wiring, most expensive, and itself
  limited by the reticle (an interposer larger than 858 mm² must be stitched).
- **CoWoS-R** — an organic **RDL** (redistribution layer) interposer. Cheaper, larger, coarser.
- **CoWoS-L** — a hybrid: an RDL carrier with small **local silicon interconnect bridges**
  embedded only where fine wiring is actually needed (between a logic die and its HBM stacks).
  Best of both: reticle-class density at the bridges, arbitrary size overall. **This is what
  NVIDIA Blackwell uses** (confirmed in `nvidia-architectures.md`: B200 is *"dual reticle-limit
  dies joined by NV-HBI at 10 TB/s, CoWoS-L"*).

**Why it is the bottleneck.** An AI accelerator needs one or two enormous logic dies *plus*
6–8 HBM stacks, all on one interposer, with the interposer several times reticle area. The
number of organizations on Earth that can do this at volume is approximately one. TSMC can
build the *logic wafers* faster than it can *package* them, so CoWoS capacity — not 4nm wafer
starts — sets how many H100s or B200s exist. Every capacity expansion announcement from TSMC
in this period has been about advanced packaging.

**The lesson worth drawing:** the industry spent fifty years assuming the transistor was the
scarce thing. It isn't any more. **The scarce thing is the ability to wire many large dies
together tightly enough that they behave like one.**

*(CoWoS variant details are from general knowledge — the two URLs I attempted for a primary
source returned 404 and the WikiChip mirror was unreachable. The CoWoS-L/Blackwell association
and the 10 TB/s NV-HBI figure are corroborated by this directory's `nvidia-architectures.md`.
See §10.)*

## 6.4 HBM: why it has the bandwidth it does

Verified specs ([Wikipedia: HBM](https://en.wikipedia.org/wiki/High_Bandwidth_Memory)):

| Gen | Bus width/stack | Rate/pin | **BW/stack** | Channels | Stack | Capacity |
|---|---|---|---|---|---|---|
| HBM1 | 1024 bit | 1.0 Gb/s | 128 GB/s | 8 × 128 | 4-Hi | 4 GB |
| HBM2 | 1024 bit | 2.0 Gb/s | 256 GB/s | 8 × 128 | 8-Hi | 8 GB |
| HBM2E | 1024 bit | 3.6 Gb/s | 461 GB/s | 8 × 128 | 12-Hi | 24 GB |
| HBM3 | 1024 bit | 6.4 Gb/s | 819 GB/s | 16 × 64 | 8–12 Hi | 16–24 GB |
| HBM3E | 1024 bit | 9.8 Gb/s | 1229 GB/s | 16 × 64 | 16-Hi | 48 GB |
| **HBM4** | **2048 bit** | 8.0 Gb/s | **2048 GB/s** | 32 × 64 | 16-Hi | 64 GB |

**The whole trick is in column 2: 1024 bits wide, per stack.** GDDR is 32 bits per device; a
512-bit GDDR graphics card uses 16 devices to get there. One HBM stack is 1024 bits by itself.
Put 6–8 stacks on an interposer and you have a **6,144–8,192-bit** memory interface. Compare
a CPU's DDR5 channel at 64 bits.

**Why you can't just do that with normal packaging: you cannot escape the die.** Bandwidth =
width × rate, and width is limited by how many wires you can physically get off the chip and
across the board. At ~100 μm bump pitch and centimetres of PCB trace, a few hundred
signal pins is the practical ceiling for a high-speed parallel bus, and beyond that skew,
crosstalk and power make it impossible. **HBM's bandwidth is a packaging achievement, not a
DRAM achievement.** The DRAM cells are ordinary; what's new is:

1. **TSV stacking.** *"Within the stack the dies are vertically interconnected by
   through-silicon vias (TSVs) and microbumps."* Vertical connections are micrometres long,
   so thousands of them cost almost nothing in area or energy.
2. **The interposer.** The stack sits *millimetres* from the GPU on a silicon interposer with
   ~1 μm wiring, not centimetres away on a PCB. Short wires mean low capacitance, which means
   you can afford 1024 of them.
3. **Therefore: go wide and slow instead of narrow and fast.** Note the rate column — HBM3E
   runs at 9.8 Gb/s per pin while GDDR7 runs faster per pin. HBM wins on width, and because
   `E ∝ C·V²` per wire and short wires have low C, **HBM delivers far more bandwidth per watt**
   — which is what actually matters when you are power-limited (§3).

The B200 carries **192 GB of HBM3e at 8 TB/s** (per `nvidia-architectures.md`), which is
roughly 8 stacks' worth. For contrast, a fast desktop DDR5 system delivers ~0.1 TB/s. That
~80× gap is the reason GPUs and CPUs have diverged so completely — and it is bought entirely
with packaging.

## 6.5 3D V-Cache, worked

The cleanest small example of 3D packaging in a consumer product, and this directory's
`cpu-architectures.md` §3.2 has measurements.

**What it is.** AMD bonds an extra **64 MB SRAM die** onto a Zen CCD using TSMC hybrid
bonding, on top of the CCD's native 32 MB → **96 MB of L3 per CCD, a 3× increase.**

**Why do it at all?** §5.8's last bullet: SRAM has stopped scaling well with each new node,
while logic keeps shrinking. Cache is becoming *relatively* more expensive in area every
generation. So instead of buying cache in the X-Y plane on an expensive node, buy it in Z on
a cheap one. The cache die does not need a leading-edge node — SRAM is regular and
undemanding — so this is also a mixed-node play (§6.1).

**The thermal lesson, in one product line:**

| Part | Year | Arrangement | Result |
|---|---|---|---|
| 5800X3D | 2022 | cache **on top** of compute die | Cores' heat must cross the cache die to reach the lid. Lower clocks, no overclocking. |
| 7800X3D / 7950X3D | 2023 | same | same compromise |
| **9800X3D** | 2024 | cache **underneath**, cores on top next to the heatspreader | **Full clocks *and* the cache. Overclockable.** |

That is §4.2's principle demonstrated by a controlled experiment AMD ran in public: *same
silicon, same cache, flip the stacking order, recover the clocks.* Nothing else in consumer
hardware teaches 3D thermal constraints so cleanly.

**And the performance result is the best cache lesson available.** 9800X3D vs 9700X — same
8 Zen 5 cores, the cache is the only difference:

| Workload | Uplift |
|---|---|
| Star Wars Jedi: Survivor | ~45% |
| Flight Simulator 2020 | ~40% |
| Corona render | ~20% |
| 1080p gaming, average | ~11% |
| Well-blocked HPC / streaming | **~0%** |

Zero to forty-five percent on the same CPU. As `cpu-architectures.md` puts it: 3D V-Cache
"moves the working-set cliff from ~32 MB to ~96 MB" — a workload whose hot set was 40 MB stops
going to DRAM and gains 40%; one whose hot set is 4 MB or 4 GB gains nothing, because it
already fit or it still doesn't. **Cache capacity is a step function, not a dial.**

There is also a scheduling hazard worth flagging: on dual-CCD parts (7950X3D, 9950X3D) **only
one CCD has the stacked cache**; the other clocks higher. Put a thread on the wrong one and
you can see 30%+ run-to-run variance. Chiplets made the machine heterogeneous, and
heterogeneity leaks into software.

---

# 7. Signal integrity, briefly

Below the gate, and above it, a wire is not a wire.

## 7.1 When a wire becomes a transmission line

A wire behaves as a simple connection only when signals are slow relative to its length. Once
the **signal rise time is comparable to the round-trip propagation time**, the wire is a
**transmission line**: it has a characteristic impedance Z₀ (typically 50 Ω single-ended,
100 Ω differential), and voltage propagates along it as a wave at maybe half the speed of
light in a PCB (~15 cm/ns).

Rule of thumb: treat it as a transmission line when the interconnect delay exceeds roughly a
sixth of the rise time. At a 50 ps edge rate, that's **under a centimetre.** On a modern
board essentially every fast signal is a transmission line.

**Reflections.** If the receiving end's impedance doesn't match Z₀, part of the wave bounces
back. Reflection coefficient `Γ = (Z_L − Z₀)/(Z_L + Z₀)` — an open end (Z_L = ∞) reflects the
full wave, a short reflects it inverted, a matched termination absorbs it. Reflections produce
overshoot, ringing, and false edges. The fixes: **series termination** at the driver,
**parallel termination** at the receiver, controlled-impedance PCB stackups, and avoiding
stubs and abrupt geometry changes (a via is an impedance discontinuity).

**Crosstalk.** Adjacent traces couple capacitively and inductively; energy on one appears on
its neighbour. Worse with tighter spacing, longer parallel runs and faster edges. Fixes:
spacing (the "3W rule"), ground planes, guard traces, and choosing which signals may run
adjacent.

**Loss.** At multi-GHz, copper loss (skin effect — current crowds to the conductor surface,
raising effective resistance as √f) and dielectric loss both grow with frequency. This
**low-pass filters** the signal: sharp edges arrive rounded and, critically, the *previous*
bits are still smearing into the current one — **inter-symbol interference (ISI)**.

## 7.2 Differential signalling and SerDes

**Differential.** Send the signal on two wires as a voltage *difference* rather than one wire
referenced to ground. Any noise coupled into both wires equally (common mode) is cancelled at
the receiver's differential amplifier. Ground bounce, EMI pickup, and reference-plane noise
all become common-mode. Also, the return current is well-defined (the other wire), which makes
routing far more predictable and radiates far less. This is why every fast link on earth —
PCIe, USB3+, SATA, Ethernet, HDMI, DisplayPort, NVLink — is differential.

**SerDes** (Serializer/Deserializer). Why serialize when parallel is obviously faster? Because
**skew**: on a wide parallel bus every wire must arrive within a fraction of a bit period, and
at 10+ Gb/s a bit period is under 100 ps, which is ~1.5 cm of trace. Matching 64 traces to a
millimetre across a board is impossible. So instead: send **one** differential pair very fast,
and recover the clock from the data itself (**CDR** — clock/data recovery, usually with
transitions guaranteed by line coding such as 8b/10b or 128b/130b scrambling). One pair, no
skew problem.

A modern SerDes is a large analog design: transmit **FFE** pre-emphasis (deliberately
distorting the transmitted edge to pre-compensate the channel), receive **CTLE** (continuous-
time linear equalization) and **DFE** (decision-feedback equalization — subtract the known ISI
contribution of previously-decided bits), CDR, and increasingly forward error correction.

**Eye diagrams.** Overlay thousands of received bit periods on one plot, triggered on the
clock. The resulting "eye" opening shows how much voltage margin (vertical) and timing margin
(horizontal) the receiver has. Noise, ISI, reflections and jitter all close the eye. **A closed
eye means the receiver cannot reliably tell 1 from 0.** The eye diagram is the single best
picture in all of digital hardware for showing a learner that "digital" is an abstraction
maintained at considerable expense over an analog substrate.

**Why PCIe generations get harder.** Every generation has roughly doubled the rate: Gen3
8 GT/s, Gen4 16, Gen5 32, Gen6 64, Gen7 128. Channel loss grows with frequency, so at the same
trace length the eye closes further each generation. Consequences, all real:
- Maximum trace length shrinks generation to generation; Gen5 typically needs **retimers** on
  a full-size board where Gen3 needed nothing.
- Better (more expensive) PCB dielectrics become mandatory.
- Equalization complexity, link-training time, and SerDes power all rise.
- **PCIe 6.0 changed the modulation itself** — from NRZ (2 levels) to **PAM4** (4 levels, 2
  bits per symbol), because pushing the *symbol* rate higher was no longer viable. PAM4 gets
  twice the bits at the same symbol rate but each eye is a third the height, so SNR
  requirements jump and FEC becomes mandatory.

**DDR training.** DRAM buses are still parallel and still push a lot of bits, so the timing
margins are too tight to guarantee by design. At every boot the memory controller runs a
**training** sequence: it writes known patterns and sweeps the delay of each data line and its
strobe, finds the passing window for each, and parks in the centre. Per-bit deskew,
per-temperature, per-board. This is why memory initialization takes seconds on a server, and
why "it POSTs but is unstable" is a training problem. **A modern computer literally calibrates
its own wires at every power-on** — that's a good fact to hand a learner who thinks digital
means exact.

## 7.3 Clocks

**Crystal oscillator.** A quartz crystal flexes when a voltage is applied and generates a
voltage when flexed (piezoelectricity), and it has an extremely sharp mechanical resonance.
Put one in an amplifier's feedback loop and the circuit oscillates at that resonance. Accuracy
is measured in **ppm** (parts per million): ±20 ppm is ordinary, ±0.5 ppm for a TCXO, better
still for an OCXO (oven-controlled). Everything in the machine is ultimately timed by a small
piece of vibrating rock, usually at an unglamorous frequency like 25 MHz.

**PLL (Phase-Locked Loop).** You cannot make a crystal that resonates at 5 GHz, and you need
dozens of different frequencies on one chip. A PLL multiplies: a phase detector compares a
reference against a divided-down copy of a voltage-controlled oscillator's output, and drives
the VCO until they match. With a ÷N in the feedback path, `f_out = N × f_ref`. This is how one
25 MHz crystal becomes a 5 GHz core clock, a 2.4 GHz memory clock, and a 100 MHz PCIe
reference. It is also the mechanism behind DVFS frequency changes.

**Jitter.** Real clock edges do not arrive exactly on time. Jitter eats directly into the
timing budget from §2.9 — every picosecond of jitter is a picosecond you cannot spend on logic.
Distinguish:
- **Period jitter** — cycle-to-cycle variation. Matters for setup/hold at a flop.
- **Phase noise** — the frequency-domain view; what matters for RF and for SerDes CDR.
- **Clock skew** — not jitter: a *systematic* arrival-time difference between two points on the
  clock tree. Fixed for a given design, and either budgeted or actively exploited (useful skew).

## 7.4 Clock domain crossing

A real chip has many clock domains: cores at one frequency, memory controller at another, PCIe
at another, and DVFS changing some of them at runtime. Signals must cross.

**Why it is dangerous:** the receiving domain's clock has no fixed relationship to the sending
domain's. Sooner or later a data change lands inside the receiving flop's setup/hold window
(§2.9). The flop goes **metastable** and, per §2.9, there is no bound on how long it takes to
resolve. If a downstream flop samples it while it's still undecided, you get a corrupt value —
and worse, two downstream flops sampling the same metastable output can resolve to *different*
values, which is how a one-hot state machine ends up in two states at once.

**The fixes:**
- **Two-flop synchronizer** for a single-bit level signal. The first flop absorbs the
  metastability; the second samples it a full clock period later, by which time (per the MTBF
  exponential) it has almost certainly resolved. Cost: 2 cycles of latency.
- **Never synchronize a multi-bit bus with parallel two-flop synchronizers.** Each bit resolves
  independently, so a bus changing from `0111` to `1000` can be sampled as any of several
  intermediate values. Use **Gray coding** (only one bit changes per increment, so the worst
  case is reading the old or the new value, both valid) — which is exactly why asynchronous
  FIFO pointers are Gray-coded.
- **Async FIFO** for data streams: dual-port memory, Gray-coded read/write pointers each
  synchronized into the other domain.
- **Handshake** (req/ack, each synchronized) for occasional transfers.

**The curriculum hook:** nand2tetris' entire machine has one clock and no crossings, which is
why it never has to mention any of this. The moment a design has two clocks, timing stops
being "make the period long enough" and becomes a correctness problem with a *probabilistic*
answer. That is a genuinely different mental model and it deserves to be named as such.

---

# 8. Curriculum: four units below the NAND gate

These sit **before** the existing Unit 1 ("One primitive, all of logic"). Each names the ONE
idea it exists to deliver, its hard prerequisite, and machine-checkable exercises.

**Design constraint, stated up front:** there is no SPICE backend, so nothing here can be
verified by simulation. Every exercise below is therefore **arithmetic with a numeric answer a
checker can compare**, or **a structural count over a data structure the learner produces**.
That is a genuine restriction and it shapes what these units can teach — but it also happens
to match what actually matters. The learner does not need to *simulate* a transistor. They
need to be able to *compute a power budget, a yield, and a maximum clock*, which are the three
numbers that decide what a chip can be.

---

## Unit P1 — The switch

**Build:** nothing physical. A worked derivation and a small calculator.

**Requires:** arithmetic. No physics background. Explicitly no calculus.

> ### THE ONE IDEA
> **A transistor is a switch you close with a voltage instead of a finger — and it is not a
> perfect switch.** Everything above this unit is built from that one device and needs no
> other fact from physics. Everything *hard* above this unit comes from the second half of the
> sentence.

**Covers:** band gaps and why silicon; doping, N-type and P-type; the hole as a bookkeeping
device; the PN junction, the depletion region, and one-way conduction; the MOSFET —
source/drain/gate/channel/threshold voltage; the gate is a *capacitor* and no current flows
through it; NMOS vs PMOS, and the three asymmetries (which value each passes cleanly, hole vs
electron mobility, resulting size difference).

**Two things this unit must not skip**, because every later unit depends on them:
1. **The gate is a capacitor.** This is where the `C` in `P = αCV²f` comes from.
2. **"Off" leaks, and how much it leaks is exponential in threshold voltage, with a hard floor
   of ~60 mV/decade.** This is the villain of Unit P3 and the reason Dennard scaling ended.

**Exercises (numeric, checkable):**

| # | Task | Answer |
|---|---|---|
| P1.1 | Compute the thermal voltage `kT/q` at 300 K. Then compute the theoretical minimum subthreshold swing, `ln(10) · kT/q`, in mV/decade. Recompute at 358 K (85 °C, a hot chip). | **25.85 mV**; **59.53 mV/decade**; **71.03 mV/decade** at 85 °C. *(Payoff: the famous "60 mV/decade" is not an engineering shortfall, it is `ln(10)·kT/q` — and it gets 19% worse when the chip is hot, which is one leg of thermal runaway.)* |
| P1.2 | A process has a 60 mV/decade subthreshold swing. Designers want to cut V_th by 100 mV to keep gates fast at a lower supply. By what factor does off-state leakage current rise? What if they cut it by 200 mV? | **46.4×** and **2154×**. *(Payoff: this single calculation is why V_th stopped falling, which is why V_dd stopped falling, which is why Dennard scaling ended. Do this before Unit P3 and P3 needs no persuasion.)* |
| P1.3 | Silicon has ~5.0 × 10²² atoms/cm³. For a channel region modelled as a cube of side L, doped at 10¹⁸ atoms/cm³, compute the number of dopant atoms for L = 1000 nm, 100 nm, and 20 nm. Then compute the statistical fluctuation `100/√N` as a percentage. | 1000 nm: **10⁶** dopants, **0.1%**. 100 nm: **1000** dopants, **3.2%**. 20 nm: **8** dopants, **35%**. *(Payoff: "random dopant fluctuation" is not jargon — at modern dimensions there are single-digit dopant atoms in a channel, so two identical transistors on the same die genuinely have different threshold voltages. This is why V_th is a distribution, why chips must be binned (§5.7), and one reason FinFET/GAA use lightly-doped channels and control the threshold with the gate work function instead.)* |
| P1.4 | Given a table of (material, band gap in eV), classify each as conductor / semiconductor / insulator using a stated threshold rule. | Exact classification, checkable. Low-value on its own; useful as a warm-up that forces the learner to look at the numbers. |

---

## Unit P2 — The gate is two switch networks

**Build:** a transistor-counting tool. Input: a Boolean expression. Output: the static-CMOS
transistor count, the pull-up network, the pull-down network, and the logic depth.

**Requires:** P1 (NMOS/PMOS, which value each passes cleanly). Boolean algebra and De Morgan's
laws — which the learner probably already has, and which this unit reveals to be a *wiring
rule*.

> ### THE ONE IDEA
> **In CMOS, inversion is free and non-inversion costs an extra stage.** A gate made of a PMOS
> pull-up and an NMOS pull-down is structurally, unavoidably inverting. So the cheapest
> 2-input gate in silicon is **NAND at 4 transistors**, and **AND costs 6** because it is a
> NAND plus an inverter. *That* is why the next unit starts at NAND — not because NAND is
> mathematically universal (so is NOR), but because NAND is what the physics hands you for
> free.

**Covers:** the complementary rule (exactly one network conducts, ever); PUN/PDN duality as De
Morgan in copper; the inverter as 2 transistors; NAND as 4; NOR as 4 but slower (PMOS in
series + hole mobility); AND and OR as 6 and 2 stages; complex gates (AOI/OAI) and why a
synthesized netlist looks nothing like the RTL; series-stack depth limits fan-in to ~4;
near-zero static power and why CMOS beat NMOS logic; transmission gates; tri-state and Hi-Z,
bus contention as a *hardware fault*, and why on-chip buses are muxes now.

**Then, the timing half — this is what makes nand2tetris Ch3's clock assertion concrete:**
propagation delay as RC; rise/fall and short-circuit current; fan-out and buffer trees;
drive strength; setup and hold; **why a hold violation cannot be fixed by slowing the clock**;
metastability and the two-flop synchronizer.

**Exercises (numeric, checkable):**

| # | Task | Answer |
|---|---|---|
| P2.1 | For each of NOT, NAND2, NOR2, AND2, OR2, XOR2, NAND3, give static-CMOS transistor count and logic depth. | 2/1, 4/1, 4/1, **6/2**, **6/2**, 8–12/2+, 6/1. *(The AND-vs-NAND row is the unit's whole point.)* |
| P2.2 | Implement `F = A·B·C·D` two ways: (a) a tree of AND2 gates; (b) a NAND/NOR tree using De Morgan so the inversions cancel. Report transistor count and depth for each. | (a) 3 × AND2 = **18 transistors**, depth 3. (b) `NAND2(A,B)`, `NAND2(C,D)`, `NOR2` of those = **12 transistors**, depth 3. **A 33% transistor saving from one application of De Morgan.** |
| P2.3 | Implement `F = NOT((A·B) + C)` as (a) discrete gates and (b) a single complex AOI21 gate. Report both. Then do `F = (A·B) + C`. | (a) AND2 + NOR2 = 10, depth 2. (b) **AOI21 = 6 transistors, depth 1.** Non-inverted version: AOI21 + INV = **8, depth 2** vs AND2 + OR2 = 12, depth 3. |
| P2.4 | **The synthesis exercise.** Given an arbitrary sum-of-products expression, emit the PDN (series = AND, parallel = OR) and the PUN as its exact dual, and count transistors. | Checker verifies transistor count **and** verifies duality structurally: every series group in the PDN must be a parallel group in the PUN and vice versa. This is machine-checkable without any simulator, and it forces the learner to internalise the duality rather than memorise gate counts. |
| P2.5 | **Max clock from logic depth.** Given `t_cq = 30 ps`, `t_setup = 20 ps`, `t_skew = 15 ps` and a per-gate `t_pd = 12 ps`, compute the minimum clock period and `f_max` for critical-path logic depths of 8, 15, 20, and 30 gates. | 161 ps → **6.21 GHz**; 245 ps → **4.08 GHz**; 305 ps → **3.28 GHz**; 425 ps → **2.35 GHz**. *(Payoff: the learner now knows, quantitatively, why a deeply-pipelined design clocks higher — and can see that pipelining is the act of buying frequency with logic depth. This is the missing prerequisite for the CPU unit.)* |
| P2.6 | **The hold-time trap.** Same flop: `t_cq = 30 ps`, `t_hold = 25 ps`, `t_skew = 15 ps`. Check the hold constraint `t_cq + t_logic_min ≥ t_hold + t_skew` for `t_logic_min` = 0 ps and 20 ps. Then: *at what clock frequency does the failing case start working?* | 0 ps: 30 < 40 → **FAILS**. 20 ps: 50 ≥ 40 → passes. Frequency question: **it never works at any frequency — hold has no `T_clk` term.** *(This is the exercise. The trick answer is the lesson, and a checker can grade both the boolean and the "no frequency" answer.)* |
| P2.7 | Given fan-out `n`, per-input load `C_in`, wire capacitance and driver on-resistance, compute `t_pd ≈ 0.69·R_on·C_total` for n = 1, 4, 16. Then compute the delay of a 3-stage buffer tree driving 16 loads and compare. | Arithmetic; exact values depend on the constants chosen. The checkable payoff is that the **buffered** version is faster than the direct drive above some fan-out, which is why synthesis inserts buffers. |

---

## Unit P3 — Every switch costs energy

**Build:** a power model. Given α, C, V, f (and a leakage term), compute power. Then a
Dennard-scaling table generator that takes a scaling factor and a "does V scale?" flag.

**Requires:** P1 (the gate is a capacitor; leakage is exponential in V_th) and P2 (a gate has
a delay, and delay depends on voltage).

> ### THE ONE IDEA
> **`P = α·C·V²·f` — and around 2005, `V` stopped falling.** That single fact ended forty
> years of free single-threaded speedup and is the direct cause of multicore, GPUs,
> accelerators, dark silicon, and the fact that performance engineering is now your job
> instead of Intel's.

**Covers:** switching energy `C·V²` per cycle and where it goes; the four terms of `αCV²f`;
short-circuit power; leakage (subthreshold, gate tunneling, junction, GIDL) and why it exploded
below ~90 nm; **Dennard scaling stated precisely as constant-field scaling, with the table**;
the exact causal chain of its failure; the frequency wall; the pivot to multicore and *why it
is efficient, not just a consolation prize*; the pivot to GPUs, specialization and reduced
precision; dark silicon; then the toolkit — clock gating, power gating, DVFS, race-to-idle;
then TDP, throttling, heat density, and why a 1000 W B200 must be liquid-cooled.

**This is the unit that connects the whole curriculum.** It is the reason the CUDA unit
exists, the reason the FP8/FP4 unit exists, and the reason the concurrency material exists.
Say so explicitly, in this unit, out loud.

**Exercises (numeric, checkable):**

| # | Task | Answer |
|---|---|---|
| P3.1 | A chip has total switched capacitance C = 20 nF, activity factor α = 0.10, V = 1.0 V, f = 3 GHz. Compute dynamic power. Then recompute at V = 0.8 V and V = 0.5 V, holding f. | **6.00 W**, **3.84 W**, **1.50 W**. |
| P3.2 | Compute the energy to switch a 1 pF node once (`E = CV²`) at 1.0 V and 0.5 V. Express the ratio. **Then prove algebraically that halving V quarters dynamic power at fixed f, and state what happens to power if f must also be halved.** | 1.00 pJ; 0.25 pJ; ratio **0.25**. Algebra: `P ∝ V²`, so `P(V/2)/P(V) = 1/4`. With f also halved, `P ∝ V²f` gives **1/8** — the "cubic" relationship. |
| P3.3 | **The multicore argument, quantified.** One core at frequency f and voltage V delivers throughput 1.0 and power 1.0. Assume V scales linearly with f. Compute throughput, power and performance-per-watt for **two** cores at 0.75f, 0.6f, and 0.5f. | 0.75f: throughput **1.50×**, power **0.844×**, perf/W **1.78×**. 0.6f: 1.20× / 0.432× / 2.78×. 0.5f: **throughput 1.00×, power 0.250×** — *the same work for a quarter of the power*. *(Payoff: multicore was not a defeat. Two half-speed cores do the same work for 1/4 the power, or 1.5× the work for 0.84× the power. The learner derives the industry's 2005 decision themselves in four lines of arithmetic.)* |
| P3.4 | **The Dennard table.** Write a generator: given scaling factor κ = 1.4 and N generations, emit relative length, voltage, area, capacitance, delay, frequency, power-per-device and **power density**. Run it for N = 5 with V scaling (true Dennard), then with **V frozen** (post-2005). | With V scaling, power density = **1.000 at every generation** (that is the theorem). With V frozen: **1.0, 2.0, 4.2, 8.5, 17.4, 35.4×**. *(The learner produces the two columns and sees the entire 2005 crisis as the difference between them. Checker compares to 3 decimal places.)* |
| P3.5 | A design targets 100 W. Dynamic power is 70 W and leakage 30 W at 1.0 V / 3 GHz. Management asks for 4 GHz. Assuming V must rise 8% to hit 4 GHz and leakage rises 1.5× with that voltage, compute the new total. How much cooling headroom is needed? | Dynamic: `70 × (1.08)² × (4/3)` = **108.9 W**. Leakage: `30 × 1.5` = 45 W. Total **≈ 153.9 W** — a **54% power increase for a 33% frequency increase.** *(Payoff: the frequency wall in one calculation, and the reason "just clock it higher" stopped being an answer.)* |
| P3.6 | **Race to idle.** A task needs 10⁹ operations. Mode A: 1.0 GHz at 0.8 V. Mode B: 2.0 GHz at 1.0 V. Dynamic energy per op ∝ V². Platform overhead (leakage + memory + regulators) is a fixed **P_fixed** watts while awake and ~0 asleep. Compute total energy for each mode as a function of P_fixed, and find the **crossover P_fixed** at which racing to idle wins. | A: 1.0 s awake. B: 0.5 s awake. Dynamic energy ratio B/A = (1.0/0.8)² = 1.5625. Setting `E_A = E_B`: `E_dyn·1.0 + P_fixed·1.0 = 1.5625·E_dyn + P_fixed·0.5` → **`P_fixed = 1.125 · E_dyn`** (where E_dyn is mode A's dynamic energy in joules). *(Payoff: race-to-idle is not a slogan, it is a crossover with a computable threshold — and the learner finds out that the answer genuinely depends on the platform.)* |
| P3.7 | Given a chip's TDP of 250 W and a die of 600 mm², compute average heat flux in W/cm². Compare to a kitchen hotplate (~10 W/cm²). Then compute the flux for a local hot spot occupying 5% of the area and dissipating 20% of the power. | Average: `250 W / 6.0 cm²` = **41.7 W/cm²**, about **4× a hotplate**. Hot spot: `50 W / 0.30 cm²` = **166.7 W/cm²**, **4× the die average**. *(Payoff: why chips have dozens of thermal sensors and why the average number lies.)* |

---

## Unit P4 — Making the thing is the hard part

**Build:** a yield-and-cost calculator: dies per wafer, yield under four models, cost per good
die, and a monolithic-vs-chiplet comparison.

**Requires:** P3 (why big hot dies are a problem in the first place). Independent of P2.

> ### THE ONE IDEA
> **Yield falls exponentially with die area, so a big chip is not expensive — it is
> *impossible*.** Every structural feature of modern hardware that looks arbitrary — chiplets,
> interposers, HBM stacks, binned SKUs, node names that measure nothing — is a consequence of
> that one exponential and of the 858 mm² reticle limit.

**Covers:** the fabrication loop (deposit / pattern / etch / dope), 300+ steps, 11+ metal
layers, FEOL vs BEOL; photolithography, the 4× reticle and the **858 mm² limit**; DUV
immersion and multi-patterning; EUV — 13.5 nm, tin plasma, all-reflective optics, 96% of the
light absorbed, vacuum, stochastics, $180M, ASML alone; masks and NRE; **yield models,
defect density, and the empirical Murphy fit to TSMC's published 5 nm data**; binning;
**why "3 nm" measures nothing** and what CPP / MMP / MTr/mm² / SRAM cell area measure instead;
planar → FinFET → GAA → CFET as one idea applied four times; fabless vs IDM and why the supply
chain is a chain of monopolies; **chiplets and the yield math**; 2.5D/3D, interposers, TSVs,
hybrid bonding; CoWoS as the actual GPU supply constraint; HBM's bandwidth as a packaging
achievement; 3D V-Cache as a worked thermal-and-cache example. Then, briefly, the signal-
integrity floor: transmission lines, differential pairs, SerDes, eye diagrams, PLLs and jitter,
and clock domain crossing as a *probabilistic* correctness problem.

**Exercises (numeric, checkable):**

| # | Task | Answer |
|---|---|---|
| P4.1 | Implement dies-per-wafer with edge correction, `DPW = πd²/(4S) − 0.58·πd/√S`, for a 300 mm wafer. Evaluate at S = 100, 200, 400, 800 mm². Also report **wafer-area utilisation** for each. | **652, 314, 149, 69** dies. Utilisation **92%, 89%, 84%, 78%**. *(Payoff: big dies waste the wafer edge too — a second, independent penalty on top of yield.)* |
| P4.2 | Implement all four yield models. Fit each to TSMC's published 5 nm point (Y = 80% at A = 17.92 mm²) to extract D₀, then predict yield at A = 100 mm². TSMC published **32%**. Which model wins? | Poisson **28.8%**, **Murphy 32.1%**, Seeds 41.8%, negative-binomial (α=3) 34.1%. **Murphy, to within 0.1 points.** *(This is a real fit to real published data and it is the most satisfying exercise in the set — the learner discovers empirically which model industry uses.)* |
| P4.3 | Using Murphy with the D₀ you just fitted (0.0127/mm²), tabulate yield at 50, 100, 200, 400, 800 and 858 mm². | 54.8%, 32.1%, 13.2%, 3.8%, 1.0%, **0.8%**. *(Payoff: a reticle-limit monolithic die on a new node yields under one percent. The 208-billion-transistor GPU cannot be built that way, and the learner has just proved it.)* |
| P4.4 | **The chiplet exercise.** D₀ = 0.001 /mm² (mature node), Poisson, 300 mm wafer. Compare four ways of building one 800 mm² product: monolithic; 2 × 400; 4 × 200; 8 × 100. For each report gross dies/wafer, yield, good dies, and **complete products per wafer**. | Monolithic: 69, 44.9%, 31.0 → **31.0 products**. 2×400: 149, 67.0%, 99.9 → 49.9. **4×200: 314, 81.9%, 257.1 → 64.3.** 8×100: 652, 90.5%, 590.0 → **73.7**. **Splitting into 4 chiplets gives 2.1× the products per wafer; into 8 gives 2.4×.** |
| P4.5 | Repeat P4.4 with the *new-node* D₀ = 0.0127/mm² (Murphy). | Monolithic 800 mm²: yield **1.0%**, **0.7 products per wafer**. 8 × 100 mm²: yield 32.1%, **26.1 products** — **a 37× difference.** *(Payoff: on a new node, chiplets are not an optimisation, they are the difference between shipping and not shipping.)* |
| P4.6 | **The subtle one.** Show algebraically that for n chiplets of area A/n, the probability that *all n* are good is `(e^(−D₀A/n))ⁿ = e^(−D₀A)` — identical to monolithic. Then explain, in two sentences, where P4.4's 2.1× actually came from. | Identity holds exactly. The gain comes from (a) **chiplets are fungible** — you assemble from the pool of all good dies on the wafer, not from one 800 mm² footprint, and (b) **edge utilisation** rises from 78% to 89%. *(Checker grades the algebra numerically and the explanation by keyword. This exercise exists because the naive "chiplets improve yield" story is subtly wrong, and a learner who can state the correction actually understands it.)* |
| P4.7 | Given a wafer cost of $17,000, compute cost per **good** die for each configuration in P4.4, then add a packaging cost of $X per chiplet assembled and find the packaging cost at which monolithic wins again. | Monolithic: $17,000/31.0 = **$548**. 4-chiplet: $17,000/64.3 = **$264** in silicon. Break-even packaging cost: `(548 − 264)/4` = **$71 per chiplet**. *(Payoff: chiplets are an economic trade, not a free lunch, and the learner can compute where the trade flips.)* |
| P4.8 | Given a table of (foundry, node name, CPP, MMP, MTr/mm²), rank the "3 nm" processes by actual density and compute the **ratio between densest and least dense**. Then compute the ratio of the smallest real feature (23 nm metal pitch) to the node name (3 nm). | TSMC N3 (197–216) > Samsung 3GAE (150–190) > Intel 3 (143). Density ratio **≈ 1.5×** between processes bearing the same "3 nm" name. Feature/name ratio **≈ 7.7×**. *(Payoff: the node name is graded against the physics and loses.)* |
| P4.9 | Compute HBM bandwidth per stack from first principles: `BW = bus_width × rate_per_pin / 8`. Verify against the published figures for HBM2, HBM3, HBM3E and HBM4. Then compute the total bandwidth of an 8-stack accelerator and compare to a 2-channel DDR5-6400 desktop. | HBM3E: `1024 × 9.8e9 / 8` = **1254 GB/s**, but the published figure is **1229 GB/s**. Reconciling them: `1229 × 8 / 1024` = **9.6 Gb/s/pin**, so the published bandwidth corresponds to a 9.6 Gb/s pin rate, not 9.8. *(Payoff: make the learner find the inconsistency and solve backwards for the real pin rate — spec sheets round, and the arithmetic is the check.)* 8 stacks ≈ **8–10 TB/s**, matching the B200's published 8 TB/s. DDR5-6400 ×2 channels ×64 bit = **102 GB/s**. Ratio **≈ 80×**. |
| P4.10 | Compute the maximum PCB trace length at which a signal must be treated as a transmission line, given a rise time and a propagation velocity of 15 cm/ns, using the "delay > t_r/6" rule. Do it for t_r = 1 ns, 100 ps, 50 ps. | 1 ns → **2.5 cm**; 100 ps → **2.5 mm**; 50 ps → **1.25 mm**. *(Payoff: at modern edge rates, essentially every trace on the board is a transmission line — "it's just a wire" stopped being true.)* |

---

## Where these hand off

    P1 The switch ──────┐
                        ├──> P2 The gate ──────> [EXISTING UNIT 1: NAND → all of logic]
                        │         │
    P3 The cost of ─────┘         └───(t_pd, setup/hold)──> [EXISTING UNIT: the clock, Ch3]
       switching │
                 └──> [CUDA / Tensor Core / FP8-FP4 units — all are §3.4(c) continued]
                 └──> [concurrency material — Dennard's end is why it exists]

    P4 Making it ──> [context for everything; also the only place chiplets/HBM/NUMA
                      behaviour in the CPU unit gets explained]

**Three explicit joins to make in the text, because they are what make this a curriculum rather
than a reference:**

1. **P2 → Unit 1.** End P2 with: *"the next unit hands you a NAND gate and asks you to build
   everything from it. You now know that the NAND is 4 transistors, that it is the cheapest
   2-input gate that exists, and that the AND you are about to build from it costs 6 and is
   twice as slow. Watch how often the answer turns out to be 'push the inversion somewhere
   else'."*
2. **P2 → Ch3's clock.** nand2tetris asserts the cycle must be "slightly longer than the time
   it takes a bit to travel the longest distance" and never quantifies it. P2.5 quantifies it.
   Reference it directly.
3. **P3 → everything above.** The GPU, the Tensor Core, FP4, and every thread in the
   concurrency material are consequences of one equation and one year. Say it in P3, then say
   it again in each of those units.

**Ordering note.** P1 → P2 is a hard dependency. P3 depends on P1 and lightly on P2. P4 depends
only on P3 (and only for motivation). So **P3 and P4 can be deferred** and taught after the
NAND/logic units if you want the learner building things sooner — but P1 and P2 must come
first, or the choice of NAND as the primitive remains an unexplained axiom, which is exactly
the gap this document exists to fill.

**On the exercise style.** Note what the checkable exercises above are *not*: they are not
"simulate this circuit." They are power budgets, yield calculations, transistor counts, and
timing budgets — which is what a hardware engineer actually computes on paper before anything
gets simulated. The absence of a SPICE backend turns out to be a mild constraint, because the
numbers that decide what a chip can be are all arithmetic.

---

# 9. The five things a learner should leave with

1. **A transistor is a voltage-controlled switch, and its imperfections — leakage, delay,
   capacitance — are what every later problem is made of.** Nothing above the transistor is
   hard because of logic; it is hard because the switch is not ideal.
2. **In CMOS, inverting is free and non-inverting costs extra. NAND is 4 transistors, AND is
   6.** The choice of NAND as the universal primitive is an engineering fact about hole
   mobility and pull-up networks, not a mathematical convenience.
3. **`P = αCV²f`, and V stopped falling around 2005.** That is the single most consequential
   sentence in modern computer architecture. Multicore, GPUs, accelerators, reduced precision,
   dark silicon, and the fact that your program's performance is now your problem all descend
   from it.
4. **Yield falls exponentially with die area, and the reticle limit is 858 mm².** So chips got
   split up, and packaging — not lithography — became the constraint that rations AI hardware.
5. **"3 nm" measures nothing.** Ask for transistor density, contacted poly pitch, metal pitch,
   and SRAM cell area. The habit of demanding the real metric generalizes far beyond
   semiconductors.

---

# 10. What I could not verify

This session's **web-search quota (200/200) was already exhausted before this task began**, so
everything above came from direct fetches of URLs I could name in advance, plus arithmetic I
performed and checked myself. That worked well for the physics and the fab, less well for
recent commercial specifics. Flagged honestly:

**Stated from knowledge, not verified against a source in this session** (all standard
textbook material; I have high confidence but they should be checked before publication):

- The **Poisson, Murphy and Seeds closed-form yield formulas**. The *existence* of these models
  is confirmed by the Wikipedia fabrication article, and the negative-binomial form is from
  AnySilicon, but the exact expressions for the other three are from memory. **Mitigating
  evidence: the Murphy formula, fitted to TSMC's published 80%-at-17.92 mm² point, predicts
  32.1% at 100 mm² against TSMC's published 32%.** A wrong formula would not do that.
- The **metastability MTBF equation** `MTBF = e^(t_r/τ)/(T₀·f_clk·f_data)`. The Wikipedia
  metastability article I fetched does not contain it.
- **CoWoS variant details** (CoWoS-S / -R / -L construction, interposer reticle multiples,
  HBM stacks per interposer). Both URLs I attempted returned 404 and the WikiChip mirror was
  unreachable. The CoWoS-L↔Blackwell association and the 10 TB/s NV-HBI figure *are*
  corroborated by this directory's `nvidia-architectures.md`.
- The **26 × 33 mm / 858 mm² reticle limit** and the High-NA anamorphic field halving to
  26 × 16.5 mm. Widely known; the EUV article I fetched gives NA and throughput but not field size.
- **Mask set costs** ($100k–$1M per mask, tens of millions per set) and **fab costs**
  ($20–40B). Order-of-magnitude figures from general knowledge.
- **Intel's 4 GHz Pentium 4 cancellation (October 2004)** and the Tejas/Jayhawk cancellations;
  **Herb Sutter's "The Free Lunch Is Over" (Dr. Dobb's, March 2005)**; the **10 GHz roadmap**.
  Dates from memory. The *outcome* — frequency stagnant at 4–6 GHz since 2005 — is verified.
- **High-κ/metal gate at Intel 45 nm in 2007.** The gate-tunneling problem it solved is
  verified; the node and year are from memory.
- **Mature-node defect densities of 0.05–0.2 /cm².** Plausible and widely cited; the only D₀
  I actually derived is 1.27/cm² for TSMC 5 nm test chips early in the ramp.
- **GB200 NVL72 rack power (~100–120 kW)**, datacenter grid-interconnect queue durations, PUE
  figures, and PPA/nuclear-restart specifics. The **B200 = 1000 W**, **H100 = 700 W**, and
  *"liquid-cooled, rack-scale solution"* facts **are** verified.
- **Transmission-line rules of thumb** (t_r/6, 15 cm/ns, the 3W spacing rule), **PCIe
  generation rates**, and **PAM4 in PCIe 6.0**. Standard, but unverified here.
- **UCIe's current adoption state**, and Intel 18A / PowerVia backside power delivery details.
- **Carrier-mobility ratio (electrons ~2–3× holes in silicon).** The *direction* is verified by
  the CMOS article ("lower hole mobility"); the factor is from memory.

**Numbers I computed myself** (reproducible from the formulas and inputs given, and I ran them):
every entry in the Dennard scaling tables, the post-Dennard power-density column, all yield and
dies-per-wafer figures, the four-model fit to TSMC's data, the chiplet comparison, all
`f_max`/hold-time results, the thermal voltage and 59.53 mV/decade subthreshold floor, the
dopant-count calculations, and the DVFS/multicore throughput-per-watt table.

**One judgement call worth surfacing.** §3.4's claim that Dennard's end is *"the single most
important causal story in modern computer architecture"* is an editorial position, not a
sourced fact. I think it is defensible and the curriculum should take it — but it is a stance,
and the causal chain is presented in enough detail above that a learner can evaluate it rather
than take it on trust.
