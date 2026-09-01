# The Limits of Computation, and the Alternatives

*Research notes for the closing chapter of a from-first-principles computing curriculum.*

The track this document closes starts at a single MOSFET and ends at a ten-thousand-GPU
training run. Every unit in between answered the question *how does this work?* This one
answers two different questions:

1. **How much further can this go?** Not "what will Nvidia ship next year" — what does
   physics permit, and how far from that ceiling are we actually standing?
2. **Is there another way to build a computer?** Quantum, neuromorphic, analog, optical,
   biological. Each gets an honest assessment, including the ones that are mostly press
   release.

This topic attracts more hype per paragraph than any other in computing. The discipline this
document imposes on itself: **every claim about current hardware carries a date**, demonstrated
results are separated from roadmap announcements, and §12 is an explicit list of what could not
be verified. Where a widely-repeated number is wrong, it is corrected with the arithmetic.

There is also a payoff. The chapter ends by arguing that the single most useful result in it —
*data movement costs more than arithmetic, by two to three orders of magnitude* — is the
physical justification for the arithmetic-intensity and roofline reasoning that the entire GPU
half of this course is built on. The last chapter retroactively explains the middle ones.

---

## Provenance

**Computed live during this research.** Every number in this document tagged *(computed)* was
produced by a C++ program compiled and **run** on the Compiler Explorer execution API
(`https://godbolt.org/api/compiler/g152/compile`, GCC 15.2, `executorRequest: true`). CE caches
by source hash, so every program carries a nonce comment to force a fresh run. The full
programs and their real stdout are in §10.6.

**Corrected during this research.** The figure "2.75 zJ" circulates widely as *the* Landauer
limit at room temperature. It is the value at **287.4 K (14.3 °C)**, which is not room
temperature anywhere people work. The correct values are **2.805 zJ at 20 °C**, **2.853 zJ at
25 °C**, **2.871 zJ at 300 K** *(computed, §1.2)*. The curriculum should teach the formula, not
the folklore number.

**Sibling documents.** The death of Dennard scaling is covered in full in
`transistors-cmos-fabrication.md` §3.3–3.5 (constant-field scaling stated as a theorem, the
V_dd freeze, the subthreshold-swing argument for *why* V_th stopped falling). This document
**references that and does not repeat it**. Shannon entropy, channel capacity and the
source-coding bound are in `information-theory-coding.md`; this document leans on them in §1.6.
Roofline and arithmetic intensity are in `algorithms-on-real-hardware.md` and
`cuda-programming-tuning.md`; §9 is the physical argument underneath them. RSA and ECC are in
`cryptography.md`; §4.4 explains what Shor does to them.

**Fetched from sources during this research.** Wikipedia's Landauer's principle, Bremermann's
limit, Moore's law, list of quantum processors, Willow processor and neuromorphic computing
articles were fetched live (dates in §11). Primary papers are cited where the claim is load-
bearing.

**A budget constraint, stated honestly.** The web-search quota for this session was exhausted
before this document was started; research proceeded via direct page fetches and prior
knowledge with a May 2026 cutoff. That means **§12 is longer than it would otherwise be**, and
in particular *anything dated after mid-2026 is absent rather than checked-and-excluded*.
Treat the quantum hardware numbers in §4.7 as a snapshot with a known staleness date, not as
current.

---

# Part 1 — The thermodynamic floor

## 1.1 The question, posed properly

A logic gate is a physical object. It sits in a heat bath at temperature `T`. Ask: is there a
minimum amount of energy that *must* be spent to compute, set by thermodynamics rather than by
the quality of your engineering?

The answer, and it is one of the genuinely beautiful results in physics, is: **computing is
free; forgetting is not.** There is no lower bound on the energy cost of a computation. There
is a hard lower bound on the energy cost of *erasing information*. Almost all real computation
erases, constantly, which is why the bound bites.

## 1.2 Landauer's principle, stated precisely

Rolf Landauer, IBM, 1961, *"Irreversibility and heat generation in the computing process"*, IBM
Journal of Research and Development 5(3):183–191.

> **Landauer's principle.** Any logically irreversible manipulation of information — any
> operation in which the input cannot be reconstructed from the output — must be accompanied
> by a corresponding entropy increase in the non-information-bearing degrees of freedom of the
> system or its environment. Erasing one bit at temperature `T` dissipates at least
>
> **E ≥ k_B · T · ln 2**

The reasoning is entropy bookkeeping, not electronics. A bit that could be `0` or `1` has two
accessible states. After a RESET-TO-ZERO it has one. The information-bearing degrees of freedom
lost `k_B ln 2` of entropy. The second law forbids total entropy from decreasing, so that
`k_B ln 2` has to appear somewhere else — in the thermal degrees of freedom, i.e. as heat
`T ΔS = k_B T ln 2`.

Three points that are usually fumbled and matter for teaching:

- **`ln 2` is there because the bit had two states**, not because we like binary. Erasing a
  trit costs `k_B T ln 3`. The constant is `ln(states)`.
- **It is a floor on the *average*, over many erasures**, and it is a *quasi-static* floor —
  achieving it requires an infinitely slow erasure. Erase fast and you pay more, with the
  excess growing roughly as `1/τ` for erasure time `τ`. This is the same speed-vs-dissipation
  trade that kills adiabatic circuits in §1.5.
- **It is about logical irreversibility, not about "using energy".** A gate that dissipates
  nothing but is logically irreversible violates it; a gate that is logically reversible can in
  principle dissipate nothing at all. That is Bennett's point (§1.4).

### The number

*(computed, §10.6 program A — `E = k_B T ln 2` with `k_B = 1.380649×10⁻²³ J/K`, exact by SI
definition since the 2019 redefinition)*

| T | | k_B T ln 2 | | |
|---|---|---|---|---|
| 77 K (liquid nitrogen) | | 7.369×10⁻²² J | 0.737 zJ | 4.60 meV |
| **287.4 K** | | 2.750×10⁻²¹ J | **2.750 zJ** | 17.17 meV |
| 293.15 K (20 °C) | | 2.805×10⁻²¹ J | **2.805 zJ** | 17.51 meV |
| 298.15 K (25 °C) | | 2.853×10⁻²¹ J | **2.853 zJ** | 17.81 meV |
| 300 K | | 2.871×10⁻²¹ J | **2.871 zJ** | 17.92 meV |
| 373.15 K (100 °C) | | 3.571×10⁻²¹ J | 3.571 zJ | 22.29 meV |

The zeptojoule (10⁻²¹ J) is the natural unit here. Note the last column: the Landauer energy at
room temperature is about **18 meV**, which is `k_B T` × 0.693 — comfortably below the ~26 meV
thermal voltage `k_B T/q` that governs subthreshold conduction (`transistors-cmos-fabrication.md`
§3.4). These are the same physics showing up in two places, which is a good thing to point out
to a learner: the 60 mV/decade subthreshold-swing wall and the Landauer limit are both `k_B T`
wearing different clothes.

**Cooling helps, linearly, and it is not free.** Running at 77 K cuts the floor by 3.9×. But a
Carnot-limited refrigerator moving heat from 77 K to 300 K costs at least `(300−77)/77 = 2.9 J`
of work per joule pumped, and real cryocoolers are far off Carnot. The floor moves; the
system-level bill usually does not improve. This is the honest answer to "why not just run
everything cold" and it applies with more force to superconducting qubits (§4.7).

## 1.3 Experimental confirmation — with dates

Landauer's principle was theoretical for 51 years. It has now been measured repeatedly.

| Year | Experiment | System | Result |
|---|---|---|---|
| **2012** | **Bérut, Arakelyan, Petrosyan, Ciliberto, Dillenschneider, Lutz**, *Nature* 483:187–189, "Experimental verification of Landauer's principle linking information and thermodynamics" | Single colloidal silica bead in a double-well optical trap | First direct measurement. Heat dissipated per erasure approached `k_B T ln 2` from above as the erasure was slowed; saturated at the bound. |
| **2014** | **Jun, Gavrilov, Bechhoefer**, *Phys. Rev. Lett.* 113:190601, "High-precision test of Landauer's principle in a feedback trap" | Virtual double-well potential via feedback trap on a colloidal particle | Higher precision; confirmed the bound and the `1/τ` approach to it. |
| **2016** | **Hong, Lambson, Dhuey, Bokor**, *Science Advances* 2:e1501492 | Nanomagnetic bit (magnetisation reversal) | Measured ~**0.026 eV** per bit flip, about **44 % above** the `k_B T ln 2` minimum — the first confirmation in a *solid-state, technologically relevant* medium rather than a colloid. |
| **2018** | **Gaudenzi, Burzurí, Maegawa, van der Zant, Luis**, *Nature Physics* 14:565–568 | Molecular nanomagnet (crystal of Fe₄ single-molecule magnets), sub-kelvin | Quantum-regime erasure at cryogenic temperature; dissipation consistent with `k_B T ln 2` down to ~1 K. |

The 2016 nanomagnet result is the one to teach. A colloidal bead in an optical trap is a
beautiful experiment but nobody will build a computer out of it. A magnetic domain is a storage
technology. Measuring 1.44 × `k_B T ln 2` in a nanomagnet says the bound is not just true, it is
*approachable in a real device* — which makes the ~10⁴× gap in CMOS (§1.4) an engineering fact
about CMOS, not a law of nature.

**The dissent, noted.** The principle has persistent philosophical critics — John Earman and
John Norton (1998, 1999), Orly Shenker (2000), and Norton again (2005, 2011) argue that the
standard derivations smuggle in the conclusion or misapply statistical mechanics to single
systems. Charles Bennett (2003) and Sagawa & Ueda (2008, 2009) defend it from
fluctuation-theorem foundations. The experiments settle the practical question — whatever the
derivations' logical status, the heat is measurably there — but a curriculum should not present
this as wholly uncontested philosophy. It is uncontested *physics practice*.

## 1.4 How far above the floor is real hardware? — the interesting number

This is the calculation the chapter exists for. A CMOS gate switching a load capacitance `C`
through a full supply swing `V_dd` dissipates

**E_switch = C · V_dd²**

(half of `CV²` is dumped in the pull-up network charging the node, half in the pull-down
discharging it; the sum over a full 0→1→0 cycle is `CV²`, and per transition it is `½CV²` —
the table below uses the full `CV²` per switching *event pair*, which is the number that
matters for the ratio's order of magnitude. Off by 2× either way changes nothing about the
conclusion.)

*(computed, §10.6 program A; capacitance and voltage figures are representative
order-of-magnitude values per node, not vendor data — see §12)*

| Node | C (fF) | V_dd | E_switch | **Ratio to k_BT ln2 at 300 K** |
|---|---|---|---|---|
| ~1 µm, early 1990s | 50 | 5.0 V | 1.25 pJ | **4.4 × 10⁸** |
| 180 nm | 5 | 1.8 V | 16.2 fJ | **5.6 × 10⁶** |
| 45 nm | 1 | 1.0 V | 1.0 fJ | **3.5 × 10⁵** |
| 7 nm FinFET | 0.15 | 0.75 V | 84 aJ | **2.9 × 10⁴** |
| 3 nm (estimate) | 0.10 | 0.70 V | 49 aJ | **1.7 × 10⁴** |

**Read the last column.** A modern transistor switch dissipates roughly **ten to thirty
thousand times** the thermodynamic minimum for erasing a bit. In 1990 it was **hundreds of
millions of times**. Three decades of scaling closed the gap by about **four and a half orders
of magnitude**, and there are roughly **four left**.

Two conclusions, and they point in opposite directions, which is why this is the right number
to sit with:

- **Landauer is not the wall we are hitting.** Anyone who tells you Moore's law ended because
  of thermodynamics is wrong by four orders of magnitude. The walls are in Part 2 and they are
  all engineering and economics.
- **But the remaining headroom is finite and visible from here.** Four orders of magnitude is
  about what the last twenty-five years bought. There is roughly one more historical era of
  efficiency improvement available in irreversible CMOS-like switching, and then the floor is
  genuinely close.

There is a second, harsher way to see the same thing. The gap is not `CV²` versus `k_BT ln 2`
by accident — it is *noise margin*. To make a bit reliable against thermal fluctuations you
need the energy separating the two states to be many `k_BT`; at `E = k_BT` the bit flips
spontaneously all the time. A rough model: error probability per operation `≈ exp(−E/k_BT)`.
For a bit error rate of 10⁻¹⁸ you need `E ≳ 41 k_BT ≈ 60 k_BT ln 2`. So a *reliable*
irreversible gate has a practical floor around **10²·k_BT ln 2**, not 1×. That is ~0.3 aJ,
still ~150× below a 3 nm gate — the headroom is real but it is two orders of magnitude, not
four.

## 1.5 Reversible computing — the escape hatch, and why nobody uses it

If erasure is what costs, don't erase.

**Bennett's result.** Charles Bennett, IBM, 1973, *"Logical reversibility of computation"*, IBM
Journal of Research and Development 17(6):525–532. Bennett showed that **any computation can be
made logically reversible** with only a modest overhead, by a construction now called the
*Bennett trick*:

1. Run the computation forward, saving every intermediate result on a "history tape" instead of
   overwriting it. Nothing is erased, so nothing must be dissipated.
2. Copy the answer (copying into a known-zero register is reversible).
3. Run the computation **backwards**, un-computing every intermediate and cleanly emptying the
   history tape.

You end with the input and the answer, having erased nothing. The cost is time (roughly 2×) and
space (the history tape). Bennett 1989 (*SIAM J. Comput.* 18:766–776) showed the space blowup
can be traded against time: a reversible simulation of a `T`-step, `S`-space computation is
possible in `O(T^(1+ε))` time and `O(S log T)` space. So reversibility is not
information-theoretically expensive. It is *engineering*-expensive, which is a different thing.

**The gate set.** Ordinary AND is irreversible: output `0` does not tell you which of three
inputs you had. Reversible logic needs bijective gates, which means equal input and output
counts.

- **Toffoli gate** (Tommaso Toffoli, 1980) — CCNOT, 3 bits in, 3 out:
  `(a, b, c) ↦ (a, b, c ⊕ (a ∧ b))`. Set `c = 0` and you get `a ∧ b` in the third wire, with
  `a` and `b` preserved. **Toffoli alone is universal for reversible classical computation.**
- **Fredkin gate** (Edward Fredkin & Toffoli, 1982) — CSWAP: `(c, a, b) ↦ (c, a, b)` if `c=0`,
  `(c, b, a)` if `c=1`. Also universal, and additionally **conservative**: the number of 1s in
  the output equals the number in the input, which matters if your physical carrier is a
  conserved quantity (billiard balls, charge packets, photons).
- Both require **ancilla bits** initialised to a known value, and both produce **garbage bits**
  that must be uncomputed rather than dropped — dropping them is erasure, which is the thing
  you were avoiding. *Reversible computing does not eliminate the accounting; it relocates it.*

The Toffoli gate is also the classical-logic workhorse inside quantum circuits (§4.3), which is
a nice structural point: quantum computing is reversible computing by physical necessity, since
unitary evolution is reversible. Everything in this section is a prerequisite for §4.

**Adiabatic / charge-recovery circuits.** The physical implementation. Instead of dumping
`½CV²` into a resistance every time you charge a node from a stiff supply, charge it **slowly**
through a ramped, resonant supply, and **recover** the charge back into the supply on the way
down. Dissipation in the charging path scales as

**E_diss ≈ (RC/τ) · C V²**

for a ramp of duration `τ`. Take `τ → ∞` and dissipation `→ 0`. Real families: Younis & Knight's
SCRL (1993), Athas et al.'s 2N-2N2P and the Caltech/USC *charge recovery* work (1994), Koller &
Athas' adiabatic switching, quantum-flux-parametron and RQL/AQFP in superconducting logic.

**Why it has never been practical.** Five reasons, all boring, all decisive:

1. **The trade is energy for time, and time is what you wanted.** `E ∝ 1/τ`. To save 10× energy
   you run 10× slower. If you are allowed to run 10× slower you could instead have used 10×
   more parallel conventional hardware at lower voltage — which is exactly what GPUs did, and
   it works today with a normal design flow.
2. **You need a resonant clock, and it is a nightmare.** Adiabatic logic requires multi-phase
   sinusoidal or trapezoidal power-clocks with inductors on-die. On-chip inductors are large,
   lossy (low Q), and do not scale. The clock distribution network's own losses eat the savings.
3. **Leakage does not care.** Adiabatic techniques recover *dynamic* switching energy. Since
   ~90 nm, static leakage is a large fraction of total power (`transistors-cmos-fabrication.md`
   §3.4), and running *slower* means leaking for *longer*. Below some `τ`, total energy goes
   back **up**. There is an optimum, and it is not deep.
4. **Area and complexity overhead is 2–4×**, and every irreversible operation you fail to
   eliminate reintroduces the floor. Amdahl applies to reversibility: leave 1 % of your
   operations irreversible and your best possible saving is 100×.
5. **The gap is 10⁴, not 1.** You do not need reversibility to get 100× better; you need better
   ordinary engineering. Reversible computing is the answer to a question — "how do I beat
   `k_BT ln 2`?" — that no one has yet been forced to ask.

**Where it is not dead:** superconducting adiabatic quantum-flux-parametron (AQFP) logic
demonstrates switching energies genuinely near and below `k_BT ln 2` *at 4 K*, and reversible
logic is mandatory inside quantum computers. Those are the two live niches. Neither is your
laptop.

## 1.6 Maxwell's demon, resolved by information

The 1867 puzzle: a demon watches molecules in a two-chamber gas box and opens a frictionless
door only for fast molecules going right and slow ones going left. Temperature difference
appears from nothing. The second law dies.

The resolution took 115 years and it is the origin of this whole chapter.

- **Szilard (1929)** reduced the demon to a one-molecule engine and showed each measurement
  extracts at most `k_B T ln 2` of work — exactly one bit's worth. He located the cost in
  *measurement*.
- **Brillouin (1951)** elaborated the measurement-cost view: the demon must illuminate the
  molecule, and the photon costs energy.
- **Landauer (1961) and Bennett (1982)** corrected it. Measurement can in principle be done
  reversibly and for free. **The cost is in the demon's memory.** The demon's notebook fills up
  with molecule observations. To run the engine in a cycle — the demon must return to its
  initial state, or it is not a cycle and the second law was never at risk — the notebook must
  be **erased**, and *that* costs `k_B T ln 2` per bit. The work extracted and the erasure cost
  cancel exactly. The second law survives, and the reason it survives is Landauer's principle.

This is why information is physical, in the literal sense: **`k_B T ln 2` per bit is the
exchange rate between the ledger of what you know and the ledger of heat.** Entropy in
Clausius's sense and entropy in Shannon's sense (`information-theory-coding.md` §1.2) are the
same quantity in different units, and the conversion factor is `k_B ln 2` joules per kelvin per
bit.

**Experimentally realised**, which is the modern part of the story: Toyabe, Sagawa, Ueda,
Muneyuki & Sano, *Nature Physics* 6:988–992 (2010), "Experimental demonstration of
information-to-energy conversion and validation of the generalized Jarzynski equality" — a
colloidal particle on a spiral staircase potential, driven uphill purely by feedback from
measurement, converting information into work at ~28 % efficiency against the Szilard bound.
Koski et al. (*PNAS* 2014, *PRL* 2014) built a single-electron "Szilard engine" and a
*autonomous* demon in a single-electron box. The demon is now laboratory equipment.

## 1.7 The other bounds — physics, not engineering targets

Everything below is a real theorem and none of it will ever constrain a product you work on.
They are worth teaching for exactly one reason: **they let you prove that certain things are
impossible forever**, which is a rare and useful kind of certainty — most famously in
cryptography (§4.4). Label them clearly as cosmology-grade, or a learner will mistake them for
a roadmap.

*(all values computed, §10.6 program B)*

### Margolus–Levitin: a speed limit on state change

Norman Margolus & Lev Levitin, 1998, *Physica D* 120:188–195. A quantum system with average
energy `E` above its ground state cannot pass from one state to an **orthogonal** (perfectly
distinguishable) state faster than

**Δt ≥ π ħ / (2E)**, i.e. at most **4E/h** orthogonal transitions per second.

For 1 kg of matter converted entirely to computational energy (`E = mc² = 8.98755×10¹⁶ J`):

**5.4256 × 10⁵⁰ operations per second.** *(computed)*

Note what an "operation" means here: one transition to a distinguishable state. It is not a
FLOP, it has no memory access, and the bound says nothing about whether the transitions compute
anything useful.

### Bremermann: bits per second per kilogram

Hans-Joachim Bremermann, 1962. Combining `E = mc²` with the energy–time uncertainty relation:

**c²/h = 1.3564 × 10⁵⁰ bits per second per kilogram** *(computed: 1.35639×10⁵⁰; Wikipedia
states 1.3563925×10⁵⁰ — agreement to 6 figures)*

Bremermann is the older, looser statement; Margolus–Levitin is the rigorous version, and the
two differ by a factor of 4 for the reason you would expect (`4E/h` vs `E/h`).

**The famous consequence, and it is the one worth teaching.** Take the entire mass of the Earth
(5.972 × 10²⁴ kg), convert all of it to a perfect computer running at the Margolus–Levitin
rate: **3.24 × 10⁷⁵ operations per second** *(computed)*.

| Brute-force task | Time on an Earth-mass ultimate computer |
|---|---|
| 2¹²⁸ operations (128-bit key) | **1.05 × 10⁻³⁷ s** — instant |
| 2²⁵⁶ operations (256-bit key) | **35.7 s** *(computed; ~143 s at the looser Bremermann rate, which is the "about two minutes" figure Wikipedia quotes)* |
| 2⁵¹² operations | ~10⁷² years |

Read that table carefully, because it contains the single most practically useful fact in this
section. **128-bit symmetric keys are not safe against physics** — they are safe against
*economics and engineering*, which is a weaker and more contingent claim. **256-bit keys are
safe against physics** in the strong sense: the *counting* alone, before you even ask where the
energy comes from, exceeds any brute-force attack a universe-sized adversary could mount, and
the margin is another 2²⁵⁶/2¹²⁸ = 2¹²⁸ wide. This is why AES-256 exists and why post-quantum
parameter choices target 256-bit classical security (see `cryptography.md`). Grover's algorithm
(§4.4) halves the exponent — 2²⁵⁶ becomes 2¹²⁸ — which is exactly why "double the symmetric key
length" is the entire quantum mitigation for symmetric crypto.

### Bekenstein: bits per kilogram per metre

Jacob Bekenstein, 1981, *Phys. Rev. D* 23:287. The maximum information that can be contained in
a region of radius `R` with total energy `E`:

**I ≤ 2πRE / (ħ c ln 2)** bits **= 2.5769 × 10⁴³ · M[kg] · R[m] bits** *(computed)*

For 1 kg in a 10 cm sphere: **2.58 × 10⁴² bits** *(computed)*. This is a *holographic* bound —
it scales with `R × E`, and for a system at the black-hole limit it becomes the
Bekenstein–Hawking area law, information proportional to surface area rather than volume. Pack
more information than this into a region and it collapses into a black hole. Storage density,
too, is bounded by general relativity.

### Lloyd's ultimate laptop

Seth Lloyd, 2000, *Nature* 406:1047–1054, "Ultimate physical limits to computation". Lloyd asks
what a computer weighing **1 kg** and occupying **1 litre** could do if every degree of freedom
were used for computation. Such a device is a ball of thermalised energy — in effect a small
fireball.

| Quantity | Value |
|---|---|
| Total energy `mc²` | 8.988 × 10¹⁶ J (≈ 21.5 megatons TNT) |
| Operations per second (Margolus–Levitin) | **5.43 × 10⁵⁰** |
| Effective temperature of the photon gas | **5.87 × 10⁸ K** *(computed)* |
| Memory (max entropy in bits) | **2.13 × 10³¹ bits** *(computed; Lloyd quotes ~2.13 × 10³¹ — exact agreement)* |
| Time to flip every bit once | ~10⁻¹⁹ s |

Two things to notice. First, the ultimate laptop has **10⁵⁰ ops/s and only 10³¹ bits** — its
ratio of compute to memory is astronomically lopsided compared to any real machine, which is
Lloyd's point that serial speed and memory capacity trade against each other at the physical
limit. Second, it is at **588 million kelvin**. The "ultimate laptop" is a nuclear explosion
that you are asking to run Linux. This is a thought experiment about the structure of physical
law, not a device, and presenting it as anything else is precisely the hype this chapter is
written against.

**The honest summary of Part 1:** the thermodynamic floor is real, beautiful, and about
10⁴ times below where we operate. It is not why your laptop is slow.

---

# Part 2 — The engineering limits we are actually hitting

Part 1 established that thermodynamics is 10⁴× away. Everything in this part is between one and
zero orders of magnitude away, which is why it is what architects actually argue about.

## 2.0 The one-line map

Five walls, in the order they were hit:

| Wall | Hit around | What stopped | Consequence |
|---|---|---|---|
| **Power / Dennard** | 2004–2006 | Voltage scaling, therefore constant power density | Clock speeds froze at ~4 GHz; multicore |
| **ILP** | ~2004 | Extractable instruction-level parallelism | Wider superscalar stopped paying |
| **Memory** | growing since ~1990 | DRAM latency improvement | Cache hierarchies, prefetch, roofline |
| **Communication** | ~2010 onward | Wire energy scaling | Data movement dominates the energy bill |
| **Economics / Moore** | ~2014 onward | Cost per transistor falling | Fewer players, chiplets, specialisation |

Dennard is covered in `transistors-cmos-fabrication.md` §3.3–3.5 and is **not repeated here**.
The one-sentence version so this document stands alone: *constant-field scaling kept power per
unit area constant only as long as V_dd shrank with dimensions; V_dd stopped shrinking around
2005 because V_th could not follow it down, because subthreshold swing is stuck at ~60 mV/decade
by k_BT/q; therefore power density began rising with every node.* Read that unit; this one
assumes it.

## 2.1 The end of Moore's law is an economic event, not a physical one

Moore's law was never a law of physics. Gordon Moore's 1965 *Electronics* article and its 1975
revision were about **the number of components per integrated circuit at minimum cost per
component**. The economics was in the original statement and it is the part that broke first.

**What is still true.** Transistors still get smaller. TSMC N5 is ~138 MTr/mm², N4 ~144 MTr/mm²
*(Wikipedia, 5 nm process, fetched 2026-09-01)*; N3 and N2 continue upward. Density has not
stopped.

**What is not true any more.** Three things:

1. **The cadence stretched.** Intel's own admission: former CEO Brian Krzanich, 2015 — "our
   cadence today is closer to two and a half years than two." Pat Gelsinger, 2022 — "we're no
   longer in the golden era of Moore's Law… doubling effectively closer to every three years
   now" *(both via Wikipedia, Moore's law, fetched 2026-09-01)*. Jensen Huang declared it dead
   outright in September 2022; Gelsinger disagreed the same month. The disagreement is itself
   informative: two CEOs looking at the same data, one selling accelerators and one selling
   fabs.
2. **SRAM stopped scaling.** This is the underreported one and it matters enormously for the
   architecture chapters. Logic density keeps improving; **SRAM bitcell area has nearly
   flatlined** from N5 to N3. TSMC's disclosed high-density bitcell went from 0.021 µm² (N5) to
   0.021 µm² (N3, initially) — essentially no shrink for a full node. Since caches are a large
   fraction of a modern die, "the node shrank 1.7×" does not mean "the chip shrank 1.7×". It
   also means **cache per core is not getting cheaper**, which pushes directly on the memory
   wall in §2.2 and is a major reason chiplets and 3D-stacked cache (AMD's V-Cache) exist.
3. **Cost per transistor stopped falling.** This is the claim at the centre of the "Moore's law
   is dead" argument, and it is the hardest one in this document to source rigorously —
   see the warning below.

### The cost-per-transistor claim, handled carefully

The widely circulated story: cost per transistor fell monotonically from the 1960s through
roughly the 28 nm node (~2011–2012), then flattened, and at 5 nm and below may have started
**rising**. The usual citations are International Business Strategies (IBS, Handel Jones) charts
reproduced in trade press, and slides from Nvidia, Marvell and AMD.

**What can be stated with confidence:**

- Wafer prices have risen steeply per node. Figures circulating in trade press for TSMC:
  ~$10k/wafer at N7, ~$17k at N5, ~$20k at N3, and reported quotes around $30k for N2.
- Design cost (NRE) per new chip has risen roughly an order of magnitude across four nodes:
  commonly cited IBS figures are ~$50 M at 28 nm, ~$175 M at 16 nm, ~$300 M at 7 nm, ~$540 M at
  5 nm, ~$650 M–1 B at 3 nm. Masks alone for a leading-edge chip run into the tens of millions.
- EUV lithography scanners (ASML NXE/EXE) cost roughly $150–200 M each, and High-NA EXE:5200
  around $350–400 M. A leading-edge fab is a $20–30 B capital project.
- The number of foundries capable of the leading edge went from ~25 at 130 nm to **three**
  (TSMC, Samsung, Intel) at 5 nm and below, with Samsung's yields widely reported as
  uncompetitive. Consolidation is what a rising cost curve looks like from the outside.

**What could not be verified in this session and is flagged in §12:** the specific
dollar-per-transistor or dollar-per-100-million-gates numbers. IBS's underlying data is
proprietary and the charts are reproduced without methodology. Wikipedia's Moore's law article
*contains no cost-per-transistor figures at all* (fetched 2026-09-01) — it only makes the
general statement that producer costs trend opposite to consumer costs. **Teach the shape of
the curve and the corroborating evidence (foundry consolidation, wafer prices, NRE), not a
specific dollar figure you cannot source.**

The consequence for an engineer is the same either way: **you can no longer assume the next
node makes your design cheaper.** That single change is what makes Part 3 — specialisation —
the rational response rather than a fashion.

## 2.2 The memory wall

Named by Wulf & McKee, 1995, *"Hitting the memory wall: implications of the obvious"*, ACM
SIGARCH Computer Architecture News 23(1):20–24. Their argument was arithmetic and inescapable:
if processor speed improves at rate `p` per year and memory at rate `m` per year with `p > m`,
then average access time is *eventually dominated by memory no matter how good your cache hit
rate is*, because the miss cost grows without bound.

**The empirical gap, and the crucial distinction:**

- **DRAM bandwidth has improved enormously.** DDR (2000) at ~1.6 GB/s per channel to HBM3e in
  2024 at ~1.2 TB/s per stack; an H100 SXM has 3.35 TB/s, an H200 4.8 TB/s, and Blackwell B200
  ~8 TB/s. That is a genuinely good three decades.
- **DRAM *latency* has barely moved.** The `tRC` row cycle time of a DRAM device was ~60–70 ns
  in the SDRAM era and is ~45–50 ns today. Loaded latency to DRAM on a modern server is
  routinely **80–140 ns**, i.e. **250–450 cycles**. Compare: DDR-era 1998, ~100 ns and ~30
  cycles. **The latency did not get worse; the processor got faster around it.** The wall is
  measured in *cycles of nothing happening*.

This is the origin of every structure in the CPU chapters: multi-level caches, hardware
prefetchers, out-of-order execution with large load queues, SMT, non-blocking caches with tens
of outstanding misses. All of it is machinery for **tolerating** a latency nobody can remove.

**The bandwidth version, which is what the GPU chapters care about.** For throughput machines,
latency is hidden by having thousands of threads; what binds is **bytes per second per FLOP per
second**. This ratio has been falling for decades — arithmetic throughput grew faster than
memory bandwidth — and it is what the **roofline model** (Williams, Waterman & Patterson, CACM
2009) exists to express.

*(computed, §10.6 program C)*

| Machine / precision | Peak FLOP/s | Bandwidth | **Ridge point (FLOP/byte)** |
|---|---|---|---|
| H100 SXM, FP16 tensor | 989 TFLOP/s | 3.35 TB/s | **295** |
| H100 SXM, FP64 vector | 34 TFLOP/s | 3.35 TB/s | **10.1** |

That FP16 ridge point of **295 FLOP/byte** is the whole reason the GPU half of this course is
about tiling and reuse. To reach peak on an H100's tensor cores, every byte you load from HBM
must be used in ~300 floating-point operations. A naive matrix multiply reuses each byte O(1)
times and gets ~0.3 % of peak. A well-tiled one reuses it O(tile) times. **Everything in
`cuda-programming-tuning.md` about shared-memory tiling is an attempt to move right along the
roofline until you cross that ridge.**

Notice also that FP64's ridge point is 10 and FP16 tensor's is 295. Tensor cores made the
memory wall **thirty times worse**, because they made arithmetic thirty times cheaper without
making memory any faster. Every generation of AI accelerator has pushed the ridge point right.
That is the memory wall being actively widened by progress.

## 2.3 The power wall and dark silicon

Once V_dd stopped scaling, power density started rising with density. A chip's power budget is
set by what the package and cooling can remove — roughly 100–150 W for a desktop CPU, 300–500 W
for a server CPU, 700 W for an H100 SXM, ~1200 W for a Blackwell B200, and up to ~1 kW/socket
being designed for with direct liquid cooling. That budget is **fixed by thermodynamics of heat
removal**, not by the silicon.

If transistor count per mm² keeps rising and power per transistor stops falling proportionally,
the arithmetic forces a conclusion: **you cannot switch all of them at once.**

**Dark silicon.** Esmaeilzadeh, Blem, St. Amant, Sankaralingam & Burger, ISCA 2011, *"Dark
silicon and the end of multicore scaling"*. Their projection: at an 8 nm node, **50–80 % of the
chip must be left unpowered** at any instant to stay within TDP, depending on architecture,
cooling and workload *(via Wikipedia, Dark silicon, fetched 2026-09-01)*. They also projected
that multicore scaling alone would deliver only ~7.9× speedup over five nodes where ~32× was
"expected".

**Dark silicon is not a disaster; it is a design opportunity, and this is the key reframing.**
If you cannot power all your transistors anyway, transistors are *cheap* and power is
*expensive*. The optimal use of area becomes: fill the die with many **specialised** units, each
of which is idle most of the time, and light up whichever one matches the current workload.
This is exactly what a modern SoC is — an Apple M-series or a phone SoC is mostly accelerators
(ISP, NPU, video codec, display pipeline, secure enclave) that are dark most of the time. The
industry did not resist dark silicon; it **monetised** it. Part 3 is that story.

**The related, deeply practical version: turbo and power management.** AVX-512 frequency
offsets on Intel server parts, GPU clock throttling under sustained load, phone thermal
throttling after 90 seconds of benchmark — all of these are the power wall showing up in
measurements you will personally take. If your benchmark's numbers drift downward over 30
seconds, you have measured dark silicon (see `debugging-and-measurement.md`).

## 2.4 The communication wall — the most important section in Part 2

**The claim:** *moving a word across a chip costs more energy than doing arithmetic on it, by
an order of magnitude or more; moving it to DRAM costs three orders of magnitude more.*

### The arithmetic side

Mark Horowitz's ISSCC 2014 plenary, *"Computing's energy problem (and what we can do about
it)"*, produced the single most reproduced table in computer architecture. At **45 nm, 0.9 V**:

*(computed, §10.6 program C — ratios computed from Horowitz's published figures)*

| Operation | Energy | Multiple of a 32-bit int add |
|---|---|---|
| 32-bit int add | 0.1 pJ | **1×** |
| 32-bit FP add | 0.9 pJ | 9× |
| 32-bit int multiply | 3.1 pJ | 31× |
| 32-bit FP multiply | 3.7 pJ | 37× |
| 32-bit SRAM read (8 KB cache) | 5 pJ | **50×** |
| 32-bit DRAM read | 640 pJ | **6 400×** |

**Read the last two rows against the first.** Fetching the operand from an 8 KB cache costs 50×
more than adding it. Fetching it from DRAM costs **6 400×** more than adding it. The ALU is
free. Everything else is the bill.

### The wire side, derived rather than cited

You do not have to trust a slide for on-chip wire energy — it falls out of capacitance. A
repeated global interconnect wire has roughly **0.2 pF per mm** of total capacitance
(sidewall + fringing + ground, plus repeater input capacitance). Driving it full-swing at 0.8 V
costs `C V²`:

*(computed, §10.6 program C)*

| Distance | Energy to move **one bit** | Energy to move **64 bits** |
|---|---|---|
| 1 mm | 0.128 pJ | **8.2 pJ** |
| 5 mm | 0.64 pJ | **41 pJ** |
| 10 mm | 1.28 pJ | **82 pJ** |
| 20 mm (corner to corner on a big die) | 2.56 pJ | **164 pJ** |

Now put the two tables together, and this is the striking figure the chapter was asked for:

> **Moving a 64-bit word 10 mm across a die costs ~82 pJ. A 64-bit floating-point
> multiply-add at a modern node costs a few pJ. Transporting the operand across the chip costs
> roughly 20–40× more than the arithmetic performed on it.**

And DRAM is worse again: at a representative ~3–4 pJ/bit for HBM, one 64-bit word from HBM is
~250 pJ, and for DDR/LPDDR it is worse still.

**Why this is different in kind from every other wall.** Arithmetic energy falls with each node,
because it is `CV²` on a shrinking `C`. **Wire energy per millimetre does not fall** — as wires
get thinner their resistance per unit length rises (worse with each node, because of surface and
grain-boundary electron scattering in copper at small dimensions), so capacitance per mm stays
roughly constant while the *drive* required goes up. Chips also did not get smaller; they got
denser at constant reticle-limited area. **Therefore the ratio of communication energy to
computation energy gets worse every single node, forever.** There is no version of the future in
which this reverses.

This is the deepest structural fact in the entire document, and §9 is built on it.

### Break-even data reuse — the quantitative form

If a byte from DRAM costs `E_mem` and a FLOP costs `E_flop`, then arithmetic dominates your
energy bill only above an arithmetic intensity of `E_mem / E_flop`:

*(computed, §10.6 program C)*

| System | DRAM energy/byte | Chip-average energy/FLOP at peak | **Energy break-even AI** |
|---|---|---|---|
| H100 SXM, FP16 tensor, HBM3 @ 3.9 pJ/bit | 31.2 pJ/byte | 0.708 pJ/FLOP | **44 FLOP/byte** |
| H100 SXM, FP64 vector | 31.2 pJ/byte | 20.6 pJ/FLOP | **1.5 FLOP/byte** |
| Generic 7 nm SoC + LPDDR5 @ 10 pJ/bit | 80 pJ/byte | 1.5 pJ/FLOP | **53 FLOP/byte** |

**The two ridge points are different numbers and both are worth knowing.** For an H100 in FP16,
the *performance* ridge point is 295 FLOP/byte but the *energy* break-even is 44 FLOP/byte. Below
44, more than half your joules are being spent on DRAM traffic rather than on math. Between 44
and 295 you are energy-dominated by compute but still performance-bound by memory. A kernel with
AI = 10 — which describes an enormous amount of real code, including most element-wise and
normalisation layers — is spending roughly **80 % of its energy on data movement**.

*(Caveat, stated because the number is seductive: "chip-average energy per FLOP at peak"
divides whole-package TDP by peak FLOP/s, so it charges the arithmetic for the memory
controllers, NVLink PHYs, clocks and leakage too. It is an upper bound on true per-FLOP energy,
which makes the true break-even AI **higher** than the table says, not lower. The conclusion is
conservative.)*

## 2.5 Amdahl — the parallelism ceiling

Gene Amdahl, AFIPS Spring Joint Computer Conference, 1967. If a fraction `s` of a program is
inherently serial and `(1−s)` is perfectly parallelisable across `N` processors:

**Speedup(N) = 1 / (s + (1−s)/N)**, and **Speedup(∞) = 1/s**

| Serial fraction | Ceiling, infinite processors | Speedup at N = 1000 |
|---|---|---|
| 10 % | 10× | 9.9× |
| 5 % | 20× | 19.6× |
| 1 % | 100× | 91× |
| 0.1 % | 1000× | 500× |
| 0.01 % | 10 000× | 909× |

Two things a curriculum must say about Amdahl and usually doesn't:

**First, it is a statement about *fixed problem size*, and that assumption is often wrong.**
Gustafson's counter-argument (John Gustafson, CACM 1988, "Reevaluating Amdahl's law") observes
that in practice people do not run the same problem on a bigger machine; they run a **bigger
problem**. If the serial part stays constant while the parallel part grows with `N`, scaled
speedup is `N − s(N−1)`, which is linear in `N`. This is not a refutation — it is a different
question. **Amdahl governs strong scaling (fixed problem, more workers); Gustafson governs weak
scaling (bigger problem, more workers).** Distributed training (`ai-systems-distributed-training.md`)
lives on the Gustafson side, which is precisely why it works at 10 000 GPUs and why the moment
you try to reduce time-to-solution at fixed batch size, Amdahl reappears with teeth.

**Second, the modern serial fraction is mostly communication, not computation.** In a large
training run, `s` is dominated by all-reduce latency, optimiser steps, checkpointing and
stragglers. Amdahl's `s` and §2.4's communication wall are the same problem viewed at different
scales — which is why this document treats "data movement" as one topic that spans from a 1 mm
wire to a 400 Gb/s InfiniBand link.

## 2.6 Wire delay does not scale — and the clock's cone of causality

Two related facts that together explain the shape of every modern chip.

**Wire delay.** Gate delay scales down with dimensions. **Wire delay does not.** For a wire of
length `L`, resistance `R ∝ L/(W·H)` and capacitance `C ∝ L`, so RC delay `∝ L²` for an
unrepeated wire, and `∝ L` for an optimally repeated one — but with a *coefficient that does not
improve*, because shrinking `W` and `H` raises `R` exactly as fast as it lowers `C`. Worse,
below roughly 20 nm wire widths, copper resistivity **rises** above bulk due to electron
scattering off surfaces and grain boundaries.

The consequence, known since Ho, Mai & Horowitz's *"The future of wires"* (Proc. IEEE, 2001):
**the fraction of the die reachable in one clock cycle shrinks with every node.** In the early
1990s a signal could cross the whole die in a cycle. By the mid-2000s it could cross a fraction
of it. Today, crossing a large die takes several cycles, and this is designed for explicitly:
pipelined interconnect, network-on-chip routers, NUMA within a socket, and the entire chiplet
strategy (AMD's Infinity Fabric, Intel's EMIB/Foveros, Nvidia's NVLink-C2C). **A modern
"processor" is a small distributed system with a very good network, and it is that way because
of wire delay.**

**The speed of light, as an actual engineering constraint.** This is not rhetorical; the numbers
are small enough to matter.

- Light in vacuum travels **299.8 mm per nanosecond**. Signals on a PCB trace or in fibre
  travel at roughly **0.5–0.7 c**, so about **150–200 mm/ns**.
- At **5 GHz**, one clock period is 200 ps. In 200 ps light in vacuum covers **60 mm**; a PCB
  signal covers **~30 mm**. A 5 GHz chip cannot be more than a few centimetres across and still
  have a signal cross it in a cycle — and it does not, which is why global clocks became
  clock-*domains* and why "clock skew" became a first-class design problem.
- **This is the real reason clock speeds are not going to 50 GHz** even if you solved power. At
  50 GHz the period is 20 ps and light travels **6 mm**. Your synchronous domain would have to
  fit inside a grain of rice.
- At datacentre scale: a round trip across a 100 m machine room is **~1 µs** minimum, in fibre.
  Across a continent, New York to San Francisco is ~4 000 km, so **~20 ms** one way in fibre,
  ~40 ms round trip, and no amount of money buys it back. Every distributed-systems design
  constraint you have met — why consensus is expensive, why CDNs exist, why gradient all-reduce
  is overlapped with backprop — is downstream of `c` (see `networking-and-internet.md`).

Grace Hopper's nanosecond — the ~30 cm piece of wire she handed out in lectures — is the single
best teaching prop in this entire curriculum, and it belongs here.

---

# Part 3 — Specialisation, the answer we actually chose

## 3.1 The efficiency ladder

If you cannot get more performance per watt from the process, you get it from **throwing away
generality**. The ladder, from most flexible to least:

| | Flexibility | Typical energy efficiency vs. CPU, same task | What it removes |
|---|---|---|---|
| **CPU** | Anything, changed at runtime | **1×** (baseline) | — |
| **GPU** | Data-parallel anything, recompiled | **10–100×** on suitable work | Per-lane control; branch flexibility; low latency |
| **FPGA** | Any dataflow, changed at reconfiguration time | **10–100×** vs CPU; but **~10–20× worse than ASIC** | The instruction stream itself; but pays for programmable routing |
| **ASIC** | One task, fixed at tape-out | **100–1000×+** | Everything not needed for this exact task |

**The load-bearing citations, both with real measurements:**

- **Hameed, Qadeer, Wachs, Azizi, Solomatnikov, Lee, Richardson, Kozyrakis & Horowitz**, ISCA
  2010, *"Understanding sources of inefficiency in general-purpose chips."* They took a 720p
  H.264 encoder and measured the energy gap between a general-purpose four-core CMP and a
  dedicated ASIC: about **500×**. Then — and this is the valuable part — they *decomposed* it,
  adding customisations one at a time. Instruction fetch/decode, register file access and
  pipeline control eat the overwhelming majority; with fused custom datapath units and
  "magic instructions" they closed to within roughly **3×** of the ASIC. The lesson is not
  "ASICs are fast", it is **"instruction supply and register-file traffic are what you are
  paying for in a CPU"** — which is a much more actionable statement.
- **Kuon & Rose**, IEEE TCAD 2007, *"Measuring the gap between FPGAs and ASICs."* For logic-only
  designs on a 90 nm process, an FPGA implementation was on average **~35× larger in area**,
  **~3.4–4.6× slower**, and consumed **~14× more dynamic power** than a standard-cell ASIC. With
  hard blocks (DSPs, block RAM) in play the area gap narrows to ~18×. These are the real numbers
  behind "FPGAs sit between CPUs and ASICs", and they are old but the *ratios* have proved
  durable because both sides use the same process.

### Why each rung buys efficiency by removing flexibility

Trace a single 32-bit add through each machine and count what else happens:

- **On a CPU**, the add is 0.1 pJ (§2.4). Around it: instruction fetch from I-cache, decode
  (on x86, into µops), register rename, scheduling in an out-of-order window, two register-file
  reads and one write, bypass network muxing, branch prediction, retirement in the ROB. Measured
  end-to-end, a single-instruction add on an out-of-order core costs on the order of **50–200
  pJ** — a **500–2000× overhead** on the arithmetic itself. **This overhead is what buys you the
  ability to run any program at all.** It is not waste; it is the price of the abstraction.
- **On a GPU**, the fetch/decode/schedule cost is **amortised across 32 lanes** in a warp. That
  single change is most of the 10–100× — SIMT is fundamentally an *instruction-supply
  amortisation* trick, and everything you know about warp divergence is the amortisation
  breaking down. Tensor cores go further: one instruction triggers hundreds of MACs with
  operands held in a fixed local pattern, so both instruction supply *and* register-file traffic
  amortise.
- **On an FPGA**, there is no instruction stream at all — the program is the wiring. You pay
  instead for programmable interconnect: every "wire" is actually a path through routing
  multiplexers and SRAM configuration cells, which is where Kuon & Rose's 35× area and 14× power
  goes.
- **On an ASIC**, the wire is a wire. Nothing is fetched, nothing is decoded, nothing is
  scheduled, and the operands travel the minimum distance the dataflow requires. §2.4 says
  distance is energy; an ASIC's advantage is substantially a *layout* advantage.

**The unifying statement, and it is the one to teach:** every rung of the ladder buys efficiency
by **moving a decision from run time to design time**. A CPU decides everything per instruction;
a GPU decides once per warp; an FPGA decides at configuration; an ASIC decided at tape-out. The
efficiency you gain is exactly the machinery you no longer need to carry to keep the decision
open.

## 3.2 Why we are in the age of the accelerator

Assemble Part 2 and the conclusion is forced:

1. Dennard's end froze per-core performance (§2.0).
2. Dark silicon made transistors cheap and power expensive (§2.3), so idle specialised area is
   *free* while active general-purpose area is not.
3. The cost curve stopped rewarding "just wait for the next node" (§2.1).
4. Data movement dominates energy (§2.4), and specialised units win largely by *shortening the
   distance operands travel* — which is the one thing that keeps getting relatively worse.
5. One workload — dense low-precision matrix multiply — became simultaneously enormous and
   economically dominant, making the NRE (§2.1) recoverable.

That fifth point is the contingent one. Specialisation is only rational when a workload is
**large enough, stable enough, and valuable enough** to amortise a $500 M design effort. Deep
learning inference and training are the first workload since video codecs and network packet
processing to clear that bar by a wide margin, and by far the largest.

The result is the machine you actually use: an accelerator whose die is mostly systolic or
tensor MAC arrays, wrapped in HBM to feed them, with a general-purpose host reduced to a
scheduler. `nvidia-architectures.md`, `fp4-fp8-blackwell.md` and `amd-and-other-accelerators.md`
are all descriptions of this one conclusion in different vendors' vocabulary.

## 3.3 The open question: what happens when the workload changes?

This is the genuine unresolved risk in the current strategy, and it should be posed as a
question rather than answered.

**The specialisation bet is a bet on workload stability.** A 3 nm accelerator takes ~2–3 years
from architecture freeze to volume, costs $0.5–1 B in NRE, and is expected to sell for 3–5
years. That is a **5–8 year commitment to the shape of a workload**. Consider what has actually
happened inside that window before:

- Tensor cores were introduced in Volta (May 2017) for FP16 dense matmul — the shape of a
  convolutional network. Transformers were published the *same year* (June 2017), and are a
  different shape: much larger matmuls, but with attention's quadratic, memory-bound,
  low-arithmetic-intensity structure attached. The hardware adapted, but attention has needed
  *software* rescue (FlashAttention, 2022) more than hardware rescue, precisely because it is a
  §2.2 problem, not a §3.1 problem.
- Mixture-of-experts turns a dense matmul into a **sparse, dynamically routed, gather-heavy**
  workload. That is a much worse fit for a systolic array, and MoE inference is dominated by
  memory traffic and interconnect, not by MAC throughput.
- Low-precision formats have churned repeatedly: FP32 → FP16 → BF16 → FP8 (E4M3/E5M2) → MXFP4
  and NVFP4, each requiring silicon changes. Hardware that fixed FP16 in 2017 is not
  well-matched to FP4 in 2025. The industry's response — supporting *many* formats — is itself a
  hedge that costs area, i.e. a partial retreat back down the ladder.

**The structural tension:** the accelerator gets its efficiency by removing the ability to
change. The field it accelerates changes annually. So far the resolution has been that the
*innermost* kernel — a dense low-precision matrix multiply — has stayed stable while everything
around it churned, and vendors have hedged by keeping the surrounding hardware programmable
(CUDA cores next to tensor cores; TPUs with a general vector unit next to the MXU).

**The honest position:** nobody knows whether the next model architecture will be
matmul-shaped. If it is not — if something like state-space models, retrieval-dominated
architectures, or sparse dynamic routing became dominant — the response would come from three
directions and it is worth asking a learner to predict which wins: (a) hardware pivots at 3-year
latency and huge cost; (b) the algorithm is reshaped to fit the hardware, which is what usually
happens and is itself a form of hardware determining research direction; (c) the field moves
back up the ladder toward more flexible substrates, at an efficiency cost it can afford because
the alternative is worse. **Historically, (b) has won almost every time.** That is the most
important and least comfortable observation in Part 3: the hardware does not just serve the
algorithms, it selects them.

---

# Part 4 — Alternative models of computation

Five candidates, each assessed on the same three questions: **what is the physical mechanism,
what has actually been demonstrated (with dates), and what is it realistically for?**

---

## 4.1 Quantum computing — the mechanism, stated so the hype cannot survive it

### The one sentence that has to be right

> **A quantum computer is not a machine that tries all answers at once. It is a machine that
> arranges for the wrong answers' amplitudes to cancel.**

Everything else is detail. If a learner leaves with only this, the chapter succeeded.

### Qubits and superposition

A classical bit is in state 0 or 1. A qubit's state is a unit vector in ℂ²:

**|ψ⟩ = α|0⟩ + β|1⟩**, with **α, β ∈ ℂ** and **|α|² + |β|² = 1**

`α` and `β` are **amplitudes**, and they are *complex*. That complexity is the entire story:
complex numbers can cancel. Two amplitudes of `+0.5` and `−0.5` sum to zero; two probabilities
of 0.25 and 0.25 sum to 0.5. Probabilities only add. Amplitudes **interfere**.

`n` qubits have a joint state described by **2ⁿ complex amplitudes**. Three qubits: 8
amplitudes. Fifty qubits: 2⁵⁰ ≈ 10¹⁵ amplitudes, which is why simulating them classically gets
hard. **But you cannot read those amplitudes.** Measurement of an `n`-qubit register returns
exactly `n` classical bits, with basis state `i` appearing with probability `|α_i|²`, and the
state collapses. *You get `n` bits out of 2ⁿ amplitudes.* This is the hard constraint that kills
the naive "exponential parallelism" story, and Holevo's theorem (1973) makes it precise: `n`
qubits can transmit at most `n` classical bits.

### Entanglement

A two-qubit state that cannot be written as a product of two single-qubit states is
**entangled**. The canonical example, the Bell state:

**|Φ⁺⟩ = (|00⟩ + |11⟩)/√2**

There is no pair of single-qubit states whose tensor product gives this. Measuring the first
qubit instantly determines the second's outcome, however far apart they are — and, crucially,
**this transmits no information** (the marginal distribution of each qubit alone is uniform
regardless of what the other did), which is why entanglement does not violate relativity and why
"quantum communication is instantaneous" is false. Entanglement is what makes the state space
genuinely 2ⁿ-dimensional rather than `n` copies of a 2-dimensional space. Without it you have
`n` independent coins.

### Interference — the actual source of speedup

A quantum algorithm is a **unitary matrix** applied to a state vector. Unitary means
norm-preserving and *reversible* — which connects straight back to §1.5: **quantum computing is
reversible computing, mandatorily, because Schrödinger evolution is reversible.** Every gate is
invertible; there is no quantum AND that discards inputs. The Toffoli gate is a standard element
of quantum circuits for exactly this reason.

The algorithm designer's job:

1. Prepare a superposition over all candidate inputs (easy: one Hadamard per qubit).
2. Apply a unitary that computes the function into the phases of the amplitudes.
3. **Arrange a final unitary such that the amplitudes of the wrong answers destructively
   interfere to nearly zero while the right answer's amplitude constructively builds.**
4. Measure. Get the right answer with high probability.

**Step 3 is the entire discipline, and it is savagely hard.** We have known this since 1994 and
the total inventory of problems for which anyone has found such an interference pattern remains
small (§4.5). This is why "quantum computers will solve NP-hard problems" is wrong: nobody has
found the interference pattern for SAT, and there are strong reasons to believe none exists.
The complexity-theoretic statement is **BQP is not known to contain NP**, and it is widely
believed not to. **BQP** (bounded-error quantum polynomial time) is suspected to be a strange
sideways-jutting class, not a superset of NP.

### The demonstration that makes this concrete

**A 3-qubit circuit is just an 8×8 unitary matrix, and you can write it in forty lines of C++.**
This is the single most demystifying exercise in the chapter, and §10.6 program D does it. Run
Grover's algorithm on `N = 8` with the marked item `|101⟩`:

*(computed, §10.6 program D — full 8×8 complex matrix simulation, unitarity of every operator
verified numerically to 1e-9)*

| Grover iterations | P(marked) | P(each of the 7 others) | Σ P |
|---|---|---|---|
| 0 | 0.125000 | 0.125000 | 1.000000 |
| 1 | 0.781250 | 0.031250 | 1.000000 |
| **2** | **0.945313** | 0.007813 | 1.000000 |
| 3 | 0.330078 | 0.095703 | 1.000000 |
| 4 | 0.012207 | 0.141113 | 1.000000 |

Compare against the closed form `P(success) = sin²((2k+1)·θ)` with `sin θ = 1/√N`: the simulated
and analytic values agree **to all six printed digits** *(computed)*.

**Now look at rows 3 and 4 and understand why they destroy the "tries everything at once"
story.** If Grover were checking all eight candidates in parallel, running it *longer* could
never make it *worse*. But it does: at `k = 4` the probability of finding the marked item drops
to **1.2 %**, worse than random guessing. That is because Grover's iteration is a **rotation** in
a 2-D plane — it rotates the state toward the marked item by a fixed angle each step, and if you
keep going you **rotate right past it**. The optimal number of iterations is
`⌊(π/4)√N⌋ = 2` for N = 8 *(computed)*, and you must know when to stop. A parallel search does
not have this property; a rotation does. **Grover is interference, and the over-rotation is the
proof.**

## 4.2 Shor's algorithm — the exponential one

Peter Shor, 1994 (FOCS; expanded in *SIAM J. Comput.* 26:1484–1509, 1997). Factors an `n`-bit
integer in **O(n² log n log log n)** gate operations — polynomial, versus the best known
classical algorithm (the general number field sieve) at roughly `exp(O(n^(1/3) log^(2/3) n))`,
sub-exponential but super-polynomial.

**How it actually works, because the structure matters more than the result.** Shor's algorithm
is *not* mostly quantum. It is a classical reduction plus one quantum subroutine:

1. **Classical.** Factoring `N` reduces to finding the **period** `r` of `f(x) = aˣ mod N` for a
   random `a`. If `r` is even and `a^(r/2) ≢ −1 mod N`, then `gcd(a^(r/2) ± 1, N)` gives a
   non-trivial factor. This step is pure number theory, known long before quantum computing.
2. **Quantum.** Find the period. Prepare a superposition over `x`, compute `aˣ mod N` into a
   second register (this is the expensive part — modular exponentiation as a reversible
   circuit), then apply the **quantum Fourier transform**. The QFT makes amplitudes at
   frequencies that are not multiples of `1/r` cancel, and amplitudes at multiples of `1/r`
   reinforce. Measure, and you read out something close to a multiple of `1/r`; continued
   fractions recover `r` classically.
3. **Classical.** Compute the gcd.

**The quantum part is one thing: period-finding by interference in the Fourier basis.** Almost
every known exponential quantum speedup — Shor, Simon's algorithm, discrete log, and the whole
"hidden subgroup problem" family — is the same trick applied to a different group. That
narrowness is the most important structural fact about quantum algorithms and the reason §4.5
is short.

**What it breaks.** RSA (factoring), Diffie–Hellman and DSA (discrete log in ℤ*_p), and
**elliptic-curve cryptography** (discrete log in an elliptic curve group — and ECC falls
*easier* than RSA, needing fewer qubits for equivalent security, which is the opposite of the
classical situation). See `cryptography.md`. This is why NIST standardised post-quantum
algorithms — ML-KEM (Kyber), ML-DSA (Dilithium), SLH-DSA (SPHINCS+) — as FIPS 203/204/205 in
**August 2024**, and why "harvest now, decrypt later" is a real threat model for data that must
stay secret for decades.

**What it does not break.** AES, SHA-2, SHA-3 and symmetric cryptography generally. Grover gives
a quadratic speedup on brute-force key search, which is handled by doubling key lengths (§4.3).
AES-256 remains ~2¹²⁸-hard against a quantum adversary, and §1.7's table shows 2¹²⁸ is
comfortably beyond an Earth-mass computer.

**What it will actually cost.** This is where the sober framing lives:

- **Gidney & Ekerå, 2019** (arXiv:1905.09749, published *Quantum* 5:433, 2021): factoring RSA-2048
  needs **~20 million noisy physical qubits** running for **~8 hours**, assuming a 10⁻³ physical
  gate error rate and surface-code error correction.
- **Gidney, 2025** (arXiv:2505.15917, May 2025, Google Quantum AI): a substantially improved
  construction — **fewer than 1 million noisy qubits**, running for **~1 week**. A 20× reduction
  in qubit count in six years, from algorithmic and error-correction improvements rather than
  hardware.

**Both numbers should be taught, and so should the trend between them.** The resource estimate
is falling fast, and it is falling because of *theory*, not hardware. Meanwhile the largest
number ever factored by a genuine, un-cheated Shor implementation is **21** (Martín-López et al.,
*Nature Photonics* 2012). Claims of factoring larger numbers on quantum hardware have
consistently used compiled circuits that presuppose the answer, or adiabatic/annealing
formulations that give no asymptotic advantage. **The gap between "under a million qubits
needed" and "hundreds of qubits available" is roughly 3.5 orders of magnitude in qubit count and
about 3 orders in error rate.**

## 4.3 Grover's algorithm — quadratic only, and why that matters so much

Lov Grover, 1996 (STOC). Searches an unstructured space of `N` items in **O(√N)** oracle queries
versus `O(N)` classically. Bennett, Bernstein, Brassard & Vazirani (1997) proved this is
**optimal** — no quantum algorithm can do unstructured search faster than `√N`.

**Why quadratic is so much less exciting than exponential**, stated concretely:

| Search space | Classical | Grover | Verdict |
|---|---|---|---|
| 2⁶⁴ | 1.8 × 10¹⁹ | 4.3 × 10⁹ | Both already feasible classically |
| 2¹²⁸ (AES-128 key) | 3.4 × 10³⁸ | 1.8 × 10¹⁹ | 2⁶⁴ quantum ops. Not free, but no longer "impossible" |
| 2²⁵⁶ (AES-256 key) | 1.2 × 10⁷⁷ | **3.4 × 10³⁸** *(computed)* | Still utterly infeasible |

Three reasons the quadratic speedup is much weaker than it looks:

1. **Doubling the key length restores the margin exactly.** A quadratic speedup is defeated by a
   linear increase in a parameter that costs almost nothing. AES-256 vs AES-128 is roughly a 40 %
   throughput cost on the same hardware. This is the cheapest defence in the history of
   cryptography.
2. **Constant factors are brutal.** Each Grover "query" is a full reversible circuit
   implementing the oracle, run under error correction. A logical operation on an error-corrected
   quantum computer takes microseconds (the surface-code cycle time × code distance), versus
   sub-nanosecond for a classical AES round. Even a 10⁹× algorithmic advantage can be eaten by a
   10⁶–10⁹× per-operation slowdown. **Grover on a real fault-tolerant machine may never beat a
   GPU cluster on the same search**, and several careful analyses (e.g. NIST's own post-quantum
   security-strength framing, and Babbage/Grassl-style resource estimates for AES) reach that
   conclusion.
3. **Grover does not parallelise well.** `M` quantum processors give a `√M` speedup, not `M`.
   Classical brute force parallelises perfectly. This further erodes the advantage at scale.

**Grover's real significance is pedagogical and cryptographic-policy, not computational.** It is
the clean example of interference (§4.1), and it is the reason "double your symmetric key sizes,
and don't panic" is the correct symmetric-crypto response to quantum computing.

## 4.4 Quantum simulation — the likely first real application

Richard Feynman's original 1982 proposal (*Int. J. Theor. Phys.* 21:467) was not about breaking
codes. It was: **nature is quantum, so simulating it on a classical machine costs exponentially;
use a quantum system to simulate a quantum system.**

This remains the most credible near-to-medium-term application, for four reasons that
distinguish it sharply from Shor:

1. **The problem is natively quantum.** No forced translation. Simulating a molecule's electronic
   structure means preparing a state in a Hilbert space that *is* the molecule's Hilbert space.
2. **The classical baseline is genuinely bad.** Exact diagonalisation of a strongly correlated
   electronic system scales exponentially in the number of orbitals. DMRG, coupled cluster,
   quantum Monte Carlo and DFT are all approximations with known failure modes — especially for
   strongly correlated systems (transition-metal catalysis, high-T_c superconductors, the FeMo
   cofactor of nitrogenase).
3. **The resource requirements are far lower than Shor's.** Estimates for chemically useful
   simulations cluster around **hundreds to a few thousand logical qubits**, versus Shor's
   thousands-plus with vastly deeper circuits. Circuit *depth* is what error correction has to
   survive, and simulation circuits are shallower relative to their value.
4. **Approximate answers are useful.** A 1 kcal/mol energy estimate is scientifically valuable.
   A factorisation that is 99 % correct is worthless. Chemistry tolerates noise in a way that
   number theory does not — which is why the NISQ era (§4.6) is not entirely wasted here.

**The honest caveat:** the classical baseline keeps improving too, and several early
"quantum advantage in chemistry" claims have been overturned by better classical methods (the
so-called "dequantisation" pattern, most notably Ewin Tang's 2018 classical algorithm for
recommendation systems, which removed a headline exponential speedup). Anything claiming quantum
advantage should be assumed to be racing a classical algorithm that has not been written yet.

## 4.5 Decoherence and error correction — the actual obstacle

Everything above assumes gates work. They do not.

**The problem.** A qubit is a fragile superposition. Any interaction with its environment —
stray photons, phonons, magnetic field noise, cosmic rays, the control electronics themselves —
**measures** it, collapsing the superposition. This is decoherence, and it is characterised by
two times:

- **T₁ (relaxation / amplitude damping):** the time for |1⟩ to decay to |0⟩. Currently ~50–500 µs
  for good transmons; hundreds of milliseconds to seconds for trapped ions.
- **T₂ (dephasing):** the time for the *relative phase* between |0⟩ and |1⟩ to randomise. Since
  the phase is where the interference lives (§4.1), **T₂ is the one that matters** and it is
  bounded by `T₂ ≤ 2T₁`.

A gate takes ~20–100 ns on a transmon. With T₂ ≈ 100 µs you get on the order of **10³–10⁴ gate
times** before the state is noise — and gate *errors* accumulate faster than that, so useful
circuit depth on unprotected hardware is more like **10²–10³ gates**. Shor on RSA-2048 needs
**~10¹⁰–10¹²** gate operations. The gap is nine or ten orders of magnitude.

**Why classical error correction does not transfer.** Three obstacles, all resolved, but the
resolution is expensive:

1. **No-cloning theorem** (Wootters & Zurek, Dieks, 1982): you cannot copy an unknown quantum
   state, so triple-modular redundancy is impossible.
2. **Measurement destroys.** Reading a qubit to check it collapses it.
3. **Errors are continuous.** A qubit can be rotated by any small angle, not just flipped.

Peter Shor (1995) and Andrew Steane (1996) solved all three. Entangle the logical information
across several physical qubits; measure **stabilisers** — joint parity-like observables that
reveal *whether an error occurred and where* without revealing the encoded state; and rely on
the fact that measuring a stabiliser **discretises** the continuous error into either "X flip",
"Z flip", "both", or "none". You then correct one of four discrete cases. Continuous errors are
digitised by measurement. This is arguably the single most surprising result in the field.

### The threshold theorem

**Aharonov & Ben-Or (1997), Kitaev (1997), Knill, Laflamme & Zurek (1998).**

> If the physical error rate per gate `p` is below a constant threshold `p_th`, then arbitrarily
> long quantum computations can be performed reliably, with only **polylogarithmic** overhead in
> the number of physical qubits per logical qubit.

This is the theorem that makes quantum computing a legitimate engineering programme rather than a
fantasy. Below threshold, adding resources improves reliability *exponentially*; above threshold,
adding resources makes things *worse*, because more qubits means more errors than the code can
fix. **It is a phase transition, and everything depends on which side of it you are.**

Early threshold estimates were ~10⁻⁶ and looked hopeless. The **surface code** (Kitaev 1997;
Fowler, Mariantoni, Martinis & Cleland, *Phys. Rev. A* 86:032324, 2012) raised the threshold to
**~1 %** — Wikipedia's quantum error correction article notes that as of 2004 estimates reached
**1–3 %** *(fetched 2026-09-01)* — while requiring only nearest-neighbour interactions on a 2-D
grid, which is exactly what superconducting chips can build. The surface code is the reason the
field is where it is.

### The overhead, computed

For the rotated surface code: **physical qubits per logical qubit = 2d² − 1** for code distance
`d`, and the logical error rate per correction cycle follows the standard heuristic
`p_L ≈ A(p/p_th)^((d+1)/2)` with `A ≈ 0.1`, `p_th ≈ 1 %`.

*(computed, §10.6 program E)*

| Physical error `p` | Target logical `p_L` | Required `d` | Achieved `p_L` | **Physical qubits per logical qubit** |
|---|---|---|---|---|
| 10⁻³ | 10⁻⁶ | 11 | 1.0 × 10⁻⁷ | **241** |
| 10⁻³ | 10⁻⁹ | 17 | 1.0 × 10⁻¹⁰ | **577** |
| 10⁻³ | 10⁻¹² | 23 | 1.0 × 10⁻¹³ | **1 057** |
| 10⁻³ | 10⁻¹⁵ | 29 | 1.0 × 10⁻¹⁶ | **1 681** |
| 5 × 10⁻⁴ | 10⁻¹² | 17 | 2.0 × 10⁻¹³ | **577** |
| 10⁻⁴ | 10⁻¹² | 11 | 1.0 × 10⁻¹³ | **241** |

Read the last two rows against the third. **Improving the physical error rate by 10× (10⁻³ →
10⁻⁴) cuts the physical-qubit overhead by 4.4×.** Better qubits are worth far more than more
qubits, which is why every serious roadmap leads with fidelity, and why "qubit count" as a
headline number is close to meaningless on its own.

At `p = 10⁻³` and a `10⁻¹²` logical target — roughly what a long algorithm needs — a machine
with 1 000 logical qubits requires **~1.25 million physical qubits for data alone**
*(computed)*, before counting **magic-state factories**, which are needed because the surface
code gives you Clifford gates cheaply but non-Clifford gates (the T gate) must be distilled, and
distillation factories typically consume **more area than the logical data qubits themselves**.
A realistic multiplier on the data-qubit count is **2–10×**.

**qLDPC codes** are the live alternative: quantum low-density parity-check codes with much better
rate (encoding many logical qubits per block rather than one). Bravyi et al. (IBM, *Nature*
627:778, **March 2024**) presented "gross code" [[144,12,12]] constructions claiming roughly a
**10× reduction** in physical-qubit overhead versus the surface code. The catch, and it is a real
one: they require **long-range connectivity** (each qubit coupled to ~6 others, some non-local),
which is hard on a 2-D superconducting chip and is why IBM's roadmap involves new coupler
technology. Neutral-atom platforms, where atoms can be physically *moved*, are a much more
natural fit.

## 4.6 NISQ and variational algorithms — an honest assessment

John Preskill coined **NISQ** — Noisy Intermediate-Scale Quantum — in 2018 (arXiv:1801.00862) to
describe machines with 50–1000 qubits and no error correction. The hope was that shallow circuits
could do something useful before fault tolerance arrived.

The main proposals were **variational**: VQE (variational quantum eigensolver, Peruzzo et al.
2014) for chemistry, and **QAOA** (Farhi, Goldstone & Gutmann 2014) for combinatorial
optimisation. Both use a shallow parameterised quantum circuit whose parameters are tuned by a
*classical* optimiser in a loop.

**The honest state of this, as of the mid-2020s: it has not worked, and the reasons are now
understood well enough to be stated as obstacles rather than setbacks.**

1. **Barren plateaus.** McClean, Boixo, Smelyanskiy, Babbush & Neven, *Nature Communications*
   9:4812 (**2018**): for randomly initialised parameterised circuits, the gradient of the cost
   function vanishes **exponentially in the number of qubits**. The optimisation landscape is
   flat almost everywhere. Later work (Cerezo et al. 2021; Ortiz Marrero et al. 2021) showed
   noise and entanglement induce barren plateaus too. This is not an engineering problem; it is a
   property of the ansatz class.
2. **Measurement cost.** Estimating an expectation value to chemical accuracy requires a number
   of circuit repetitions ("shots") that can run to 10⁶–10⁹ per energy evaluation, times
   thousands of optimiser steps. The wall-clock time becomes prohibitive.
3. **Classical simulability.** Shallow, noisy circuits are increasingly shown to be *classically
   simulable* — noise itself makes them easier to simulate. Several claimed NISQ advantages have
   been matched or beaten classically within months, most publicly IBM's 127-qubit Eagle
   "utility" experiment (*Nature*, June 2023), which was reproduced classically by multiple
   groups (tensor-network and belief-propagation methods) within weeks.
4. **No convincing QAOA advantage.** Despite a decade of effort, QAOA has not been shown to beat
   good classical heuristics on any optimisation problem people care about.

**The field's own conclusion has shifted.** The prevailing view among serious researchers by
2024–2025 was that **fault tolerance is the only path**, and NISQ was a detour that produced
excellent hardware engineering and very little algorithmic value. The people who say this loudest
are inside the field, which is the strongest form of the evidence. A curriculum should say it
plainly: **variational quantum algorithms are, as of now, a research programme with no
demonstrated advantage, facing a proven exponential obstacle.**

## 4.7 Hardware: where it actually is, with dates

**Read this table as a snapshot with a staleness date, not as current.** Research for this
document was constrained (see Provenance); anything after mid-2026 may be missing.

| Platform | Representative device | Qubits | Reported 2-qubit fidelity | Date | Notes |
|---|---|---|---|---|---|
| Superconducting (transmon) | **Google Willow** | **105** | **99.67 %** (1-qubit 99.965 %) | **9 Dec 2024** | The below-threshold result, below |
| Superconducting | **USTC Zuchongzhi 3.0** | 105 | comparable to Willow | **16 Dec 2024** | Chinese RCS demonstration |
| Superconducting | IBM Heron R2 | 156 | ~99.5 % (article lists "96.5" for 2-qubit, apparently a typo for a different metric) | **Nov 2024** | Heavy-hex lattice |
| Superconducting | IBM Condor | 1 121 | — | Dec 2023 | Largest-count transmon chip; **not** a usable-fidelity machine, built to prove wiring scale |
| Superconducting | **IBM Nighthawk** | **120** | — | **5 Jan 2026** | Square lattice, higher connectivity |
| Trapped ion | **Quantinuum Helios** | **98** | historically the best in the field (H-series 2-qubit >99.8 %) | **Nov 2025** | All-to-all connectivity, slow gates |
| Trapped ion | Alpine Quantum Technologies LYNX | — | quantum volume 32 768 | **announced for 5 May 2026** | Roadmap/announcement, treat as such |
| Neutral atom | QuEra / Harvard–MIT | 256–3 000 | — | 2023–2025 | Lukin group, *Nature* Dec 2023: 48 logical qubits from 280 physical, transversal gates |
| Photonic | PsiQuantum, Xanadu | — | — | — | Roadmap-stage for fault tolerance; Xanadu's Borealis (2022) was a sampling demo |
| Topological | Microsoft Majorana 1 | 8 | — | **Feb 2025** | **Heavily contested.** See below |

*(Device list and dates from Wikipedia "List of quantum processors" and "Willow processor",
fetched 2026-09-01.)*

### Google Willow's below-threshold result — stated carefully

**Google Quantum AI, *Nature* 638:920–926, published 9 December 2024**, "Quantum error correction
below the surface code threshold."

**What was demonstrated:** Google ran surface codes at distances 3, 5 and 7 on the 105-qubit
Willow chip and showed that **increasing the code distance decreased the logical error rate**.
The reported error-suppression factor was **Λ ≈ 2.14**, meaning each increase of the code distance
by 2 roughly halved the logical error per cycle. The distance-7 logical qubit achieved a logical
error rate of **~0.143 % per cycle**, and it **outlived its best constituent physical qubit** by
a factor of ~2.4.

**Why it matters, precisely:** this is the first convincing experimental demonstration of being on
the *correct side of the threshold phase transition* in a scalable code. Before this, adding
qubits made things worse. That is a genuine, hard-won, first-of-its-kind result and it deserves
its billing.

**What it is not:** a useful logical qubit. Λ ≈ 2.14 means each distance step costs roughly 2×
the qubits for 2× the reliability — but the target is **10⁻¹⁰ or better**, from 10⁻³. Getting
there at Λ = 2.14 requires roughly `log₂(10⁷) ≈ 23` distance steps, i.e. distance ~50, i.e.
~5 000 physical qubits per logical qubit — considerably worse than the idealised table in §4.5,
which assumed a healthier Λ. **Improving Λ, not adding qubits, is the whole game.** Critics
correctly note the ~0.14 % per-cycle logical rate is far above the ~10⁻⁶ needed for practical
algorithms *(via Wikipedia, Willow processor, fetched 2026-09-01)*.

**The RCS benchmark, separately and more sceptically.** Willow's random circuit sampling result
was reported as **5 minutes** for a task claimed to take a classical supercomputer **10²⁵ years**
*(ibid.)*. Treat this number with great care. RCS is a task designed to be hard for classical
computers and **has no known use whatsoever** — it is a benchmark, not an application. Every
previous RCS advantage claim has been substantially eroded by better classical algorithms:
Google's 2019 Sycamore claim of "10 000 years" was reduced by IBM to ~2.5 days on a
storage-augmented classical simulation, and later tensor-network work brought it to hours. The
prudent statement is: **RCS demonstrates quantum hardware capability, not quantum utility, and
its classical-difficulty estimates historically fall.**

**Google's "Quantum Echoes" (22 October 2025)** was announced as the first *verifiable* quantum
advantage, reported as ~13 000× faster than the best classical supercomputer *(via Wikipedia,
Willow processor, fetched 2026-09-01)*. "Verifiable" is the interesting word — it addresses the
main critique of RCS. **This document has not independently assessed the classical-simulation
claims, and given the history above, expect them to be challenged.** Flagged in §12.

**Microsoft's Majorana 1 (February 2025)** claimed a topological qubit based on Majorana zero
modes, which would in principle be intrinsically protected from decoherence. The result was
published in *Nature* alongside unusually explicit referee scepticism, and multiple groups have
publicly disputed whether the measurements demonstrate Majorana modes at all — this follows a
2018 Nature paper from a Microsoft-affiliated group that was **retracted in 2021**. **Treat
topological qubits as an unproven approach with a troubled evidentiary history.**

### The uncomfortable scaling numbers

- Superconducting qubits require **dilution refrigerators at ~10–20 mK**. Each qubit currently
  needs coaxial control and readout lines running from room temperature into the cold stage.
  **Wiring, not qubits, is the near-term scaling bottleneck** — a million-qubit machine cannot
  have a million coax cables, which is why cryo-CMOS control electronics and multiplexed readout
  are as strategically important as the qubits.
- A dilution refrigerator's cooling power at 10 mK is on the order of **microwatts to a
  milliwatt**. The refrigerator itself draws **~10–25 kW** from the wall. §1.2's Carnot argument
  applies with a vengeance: the efficiency of moving heat from 10 mK to 300 K is catastrophic.
  Quantum computers are not energy-efficient computers and never will be at the system level;
  their case rests entirely on doing things classical machines cannot do at all.

## 4.8 What quantum computers will probably never be good at

Stating this list plainly is the most useful anti-hype service a curriculum can perform.

1. **Being fast at ordinary computation.** Logical gate times on an error-corrected machine are
   microseconds. Classical gates are picoseconds. A quantum computer is **10⁶× slower per
   operation** and only wins where the asymptotics are dramatically better. For anything with a
   good classical algorithm, it loses by a colossal margin.
2. **Big data.** Loading `N` classical values into a quantum state takes `O(N)` operations unless
   you have QRAM, and practical QRAM does not exist and may not be buildable at scale. **Many
   claimed "quantum machine learning" speedups assume free state preparation, and the loading
   cost destroys the advantage.** This is the most common flaw in quantum-ML papers.
3. **Machine learning as currently practised.** Training is dominated by data movement and dense
   low-precision matmul — §2.4's problem, which quantum computing does not address. There is no
   credible path to quantum-accelerated deep learning training.
4. **NP-complete problems in general.** No known interference structure for SAT, TSP, graph
   colouring. Grover gives √N on brute force, which for a 2ⁿ space is still 2^(n/2) —
   exponential. **BQP is not believed to contain NP-complete problems.** Anyone claiming
   "quantum computers will solve optimisation" is either talking about a quadratic speedup or is
   wrong.
5. **Storage.** No-cloning prevents backup. Decoherence gives you microseconds to milliseconds.
   A quantum computer has no persistent memory in any useful sense.
6. **Replacing your CPU.** A quantum computer will be a **coprocessor in a datacentre**, called
   over a network for specific subroutines, in the way a mainframe-era vector unit was. Nobody
   will have one.

**The correct summary:** quantum computing is a legitimate and profound research programme with
one demonstrated exponential algorithm of practical consequence (Shor), one likely useful
domain (simulation), a proven path to reliability (threshold theorem plus surface code, now
experimentally on the right side of the threshold as of December 2024), and a resource gap of
roughly three orders of magnitude in qubit count and error rate remaining. It is neither vapour
nor imminent. Both of those claims are made constantly, and both are wrong.

---

## 5. Neuromorphic computing

### The mechanism

Neuromorphic engineering — the term is Carver Mead's, from the late 1980s — builds hardware whose
*organising principles* are taken from biological neurons rather than from Boolean logic. Four
choices distinguish it from a GPU:

1. **Spikes, not activations.** A neuron communicates with a single-bit event (a spike) at a
   *time*. Information is carried in the timing and rate of spikes, not in a multi-bit value on
   a bus. A spike is 1 bit plus an address, versus a 16-bit activation.
2. **Event-driven, not clocked.** Nothing happens unless a spike arrives. A silent network draws
   near-zero dynamic power. This is a direct assault on §2.3: dark silicon is the *default*
   state, not a problem.
3. **Sparsity as the operating point.** Cortical neurons fire at ~1–10 Hz against a membrane
   time constant of ~10 ms — activity is a few percent. If only 2 % of your units are active,
   you do 2 % of the work. Contrast a dense GEMM, which does 100 % of the work regardless of how
   much of it matters.
4. **Memory co-located with compute.** Synaptic weights are stored in SRAM physically adjacent to
   the neuron circuits that use them. **This is the direct answer to §2.4** — if the operand
   never travels more than a few hundred micrometres, you never pay the 82 pJ.

The **address-event representation (AER)** is the standard communication fabric: when a neuron
fires, its address is put on a shared asynchronous bus. Bandwidth is proportional to activity,
not to network size.

### The real chips, with figures and dates

| Chip / system | Organisation | Date | Figures |
|---|---|---|---|
| **TrueNorth** | IBM | **Aug 2014** (*Science* 345:668) | 28 nm, 5.4 B transistors, 4 096 cores, **1 M neurons, 256 M synapses**, **~70 mW** typical for real-time operation. Inference only — no on-chip learning. |
| **Loihi** | Intel | **Sept 2017** | 14 nm, 128 neuromorphic cores, **131 072 neurons, ~130 M synapses**, on-chip plasticity (programmable learning rules) *(Wikipedia, fetched 2026-09-01)* |
| **Loihi 2** | Intel | **Sept 2021** | Pre-production **Intel 4** node, 128 cores, **~1 M neurons/chip**, graded (multi-bit) spikes, programmable neuron models via a microcode pipeline, ~10× faster spike processing than Loihi 1 |
| **Hala Point** | Intel (Sandia National Labs) | **April 2024** | **1 152 Loihi 2 chips**, 140 544 neuromorphic cores, **1.15 B neurons, 128 B synapses**, **2 600 W**, up to **20 POPS**, plus 2 300+ embedded x86 cores *(Wikipedia, fetched 2026-09-01)*. Largest neuromorphic system built. |
| **SpiNNaker** | Univ. of Manchester (Steve Furber) | million-core milestone **14 Oct 2018** | 57 600 nodes × **18 ARM968 cores = 1 036 800 cores**, ~7 TB RAM, 10 racks, **~100 kW**. Digital simulation of spiking networks in real time; ~1 000 neurons per core *(Wikipedia, fetched 2026-09-01)* |
| **SpiNNaker 2 / SpiNNcloud** | TU Dresden, SpiNNcloud Systems | **operational 2025** | 152 ARM Cortex-M4F cores per chip with per-core accelerators; the commercial SpiNNcloud system targets ~5 M cores and ~10 B neurons *(Wikipedia, fetched 2026-09-01; system-level targets are vendor claims)* |
| **BrainScaleS-1** | Heidelberg / Human Brain Project | ~2016 | **Wafer-scale analog**, 20 cm wafer, ~200 000 neurons, ~40 M synapses; runs **~1 000–10 000× faster than biological real time** because the analog circuits' time constants are set by small on-chip capacitors, not by biology |
| **BrainScaleS-2** | Heidelberg | ~2020 | 65 nm, 512 analog neurons + 130 k synapses per chip, with an embedded digital plasticity processor. Same ~1 000× acceleration. |
| **NorthPole** | IBM (Dharmendra Modha) | **Oct 2023** (*Science* 382:329) | 12 nm, 22 B transistors, 256 cores, **224 MB of on-chip memory and no off-chip memory at all**. Claimed vs a 12 nm GPU on ResNet-50/ImageNet: **~25× better energy efficiency, ~22× lower latency, ~5× better frames/s per transistor** |

**NorthPole deserves a separate note because it is the most instructive of these.** It is barely
"neuromorphic" in the spiking sense — it is a low-precision inference engine. Its entire
architectural thesis is **"put all the memory on the die and never go off-chip"**, which is §2.4
taken to its logical conclusion. That it works so well is strong evidence that *the memory
locality idea is the valuable part of neuromorphic computing and the spiking is optional*. This
is worth stating explicitly, because it is the honest reading of the last decade of results.

### Why it has not displaced GPUs

Five reasons. The first two are decisive.

1. **There is no training story.** This is the whole thing. Backpropagation requires
   differentiating through the network, and a spike is a **discontinuous, non-differentiable
   event** — the derivative of a threshold function is a delta function or zero. The workarounds
   are all compromises:
   - **Surrogate gradients** (Neftci, Mostafa & Zenke, *IEEE Signal Processing Magazine*, 2019):
     replace the spike's derivative with a smooth surrogate during the backward pass. Works, and
     is the current mainstream method, but you are training a *differentiable approximation* of
     your network and deploying something else, and accuracy trails equivalent ANNs.
   - **ANN-to-SNN conversion**: train a normal network, convert it to spikes. This works but
     requires many timesteps to encode activations as rates, which throws away the latency and
     energy advantage that motivated the exercise.
   - **STDP** (spike-timing-dependent plasticity), the biologically plausible local rule: it is
     unsupervised, does not scale to deep networks, and has never produced competitive results on
     any non-toy task.

   **The consequence is stark:** there is no spiking network trained from scratch that is
   competitive with a conventional network on a task anyone cares about. The efficiency argument
   is moot if the accuracy is not there.

2. **The software gap is enormous.** PyTorch and CUDA represent something like 15 years and tens
   of thousands of engineer-years of investment. Loihi's Lava framework, Nengo, snnTorch,
   Norse and BindsNET are excellent research tools with a tiny fraction of that. Every kernel,
   profiler, debugger and distributed-training system in `numpy-pytorch-internals.md` and
   `ai-systems-distributed-training.md` would need rebuilding.

3. **The efficiency comparison is usually rigged.** Neuromorphic energy figures are frequently
   quoted against unoptimised GPU baselines, at batch size 1, on tasks chosen to suit sparsity.
   Against a well-utilised modern accelerator running a quantised INT8 model, the advantage
   shrinks dramatically and sometimes reverses. Some of it is also a *precision* comparison
   dressed up as an architecture comparison.

4. **Sparsity is available classically.** Structured sparsity, mixture-of-experts routing,
   early-exit networks and activation-sparsity kernels capture much of the same win inside the
   existing software stack, which is a far cheaper path than new silicon plus a new framework.

5. **The workloads that suit it are small.** Event cameras (DVS), always-on keyword spotting,
   robotic control loops, closed-loop sensor processing — real applications with real value, but
   collectively a rounding error next to datacentre inference.

**Where it will plausibly land:** ultra-low-power always-on sensing at the edge (milliwatts,
where a GPU is simply not an option), event-camera vision, and neuroscience simulation — which is
SpiNNaker's actual, funded, successful purpose and should not be undersold. **It is not going to
train the next foundation model.**

---

## 6. Analog and in-memory computing

### Why it is efficient: the MAC happens in physics

A matrix–vector product is the inner loop of everything in this curriculum. In a crossbar array
of resistive devices, it is not *computed* — it is *measured*.

- Arrange resistive elements at every crosspoint of a grid of `N` row wires and `M` column wires.
  Set the conductance of the device at row `i`, column `j` to `G_ij ∝ W_ij`.
- Apply voltage `V_i` on row `i`, encoding input vector element `x_i`.
- **Ohm's law** does the multiplication: the current through device `(i,j)` is `I_ij = V_i·G_ij`.
- **Kirchhoff's current law** does the summation: the total current out of column `j` is
  `I_j = Σ_i V_i·G_ij` — which is exactly the dot product `(Wᵀx)_j`.

**The entire `N×M` matrix–vector product happens in one settling time, in O(1) steps, with no
data movement whatsoever.** The weights never leave the array; the inputs travel the length of
one wire. §2.4's communication wall does not apply, because there is no communication.

Reported efficiency figures for analog in-memory macros run to **tens to hundreds of TOPS/W**
against roughly 1–5 TOPS/W for good digital accelerators at similar nodes. If those numbers held
end-to-end, this would be the answer to everything.

### The devices

| Technology | Mechanism | Strengths | Weaknesses |
|---|---|---|---|
| **ReRAM / memristor** | Oxygen-vacancy filament forms/dissolves in a metal oxide | Fast, small, CMOS-compatible BEOL | Cycle-to-cycle and device-to-device variability; stochastic filament formation |
| **PCM (phase-change)** | Chalcogenide (GST) switches between amorphous and crystalline | Many resistance levels, mature (used in Optane/3D XPoint) | **Conductance drift**: resistance rises roughly logarithmically with time after programming, indefinitely. Weights literally decay. |
| **Flash (analog)** | Charge on a floating gate sets threshold voltage | Extremely mature, cheap, non-volatile, good retention | High programming voltages, limited endurance, larger cells |
| **MRAM (STT/SOT)** | Magnetic tunnel junction | Excellent endurance and retention | Low on/off ratio (~2–3×), essentially binary — poor for multi-level analog |
| **SRAM (digital in-memory)** | Ordinary 6T/8T cells with compute in the bitcell periphery | No new device physics, no drift, reliable | Volatile, large area per bit, so limited capacity |

**The "memristor" name.** Leon Chua predicted the memristor as a missing fourth circuit element
in 1971; HP Labs (Strukov, Snyder, Stewart & Williams, *Nature* 453:80, **May 2008**) claimed to
have found one in a TiO₂ device. Whether these devices are "true memristors" in Chua's sense is
disputed in the device-physics literature. The engineering is real regardless of the naming
argument, and a curriculum should avoid taking a side.

### Why it is hard — four problems, and the fourth is the killer

1. **Device variability.** Every crosspoint programs slightly differently, and differently each
   time. Filament formation in ReRAM is a stochastic process. Realistically you get **4–6 bits**
   of weight precision, often less, and you must train the network to tolerate it
   (hardware-aware training / noise injection during training).
2. **Drift and noise.** PCM conductance drifts logarithmically with time, forever. Read noise is
   1/f. A network's accuracy degrades over hours to days after programming unless periodically
   refreshed — which costs energy and endurance.
3. **Array non-idealities.** **IR drop** along the wires means the voltage seen at the far end of
   a row is not the voltage applied, so the effective weight depends on physical position and on
   the *other* inputs. **Sneak paths** through unselected devices corrupt readings unless each
   cell has a selector transistor (1T1R), which triples the area and gives back much of the
   density advantage.
4. **ADC/DAC overhead, which usually dominates.** This is the fundamental one and it must be
   stated plainly. **The analog array is surrounded by digital everything**, so every input needs
   a DAC and every column's output current needs an ADC. ADC energy and area scale roughly as
   `2^bits` for flash converters and at best linearly in resolution for SAR. Published analyses
   of crossbar accelerators repeatedly find the **ADCs consuming 50–85 % of total energy and a
   comparable share of area**. Amortising them across a larger array helps, but larger arrays
   make IR drop and variability worse. **The efficiency of the multiply is real; the efficiency
   of the system is mostly a converter-design problem, and that is a much less exciting problem
   than the press releases suggest.**

There is also a structural constraint: analog crossbars are best when **weights are stationary**.
Programming a resistive device is slow and wears it out (ReRAM endurance is ~10⁶–10⁹ cycles;
SRAM's is unbounded). That makes analog in-memory compute a fit for **inference with fixed
weights** and a poor fit for **training**, which is nothing but weight updates.

### Where it has actually got to

- **IBM's analog AI chip**, Ambrogio et al., *Nature* 620:768 (**August 2023**): 14 nm CMOS with
  **35 million PCM devices** across 34 tiles, running speech recognition (RNN-T) end-to-end at
  accuracy close to digital, at a reported **~12.4 TOPS/W**. Notably a *complete system*
  demonstration rather than a macro benchmark — that is what makes it credible.
- **Mythic** shipped the M1076 analog matrix processor (analog compute in NOR flash), quoted at
  **25 TOPS in ~3 W** with 80 M weights on-chip. The company hit severe financial trouble in 2022
  and restructured — a data point about the commercial difficulty, not about the physics.
- A large academic literature (ISAAC, PRIME, PUMA and successors) with excellent simulated
  results and a persistent gap to silicon.

**Where it plausibly lands:** fixed-weight, low-precision, energy-constrained **edge inference** —
keyword spotting, sensor fusion, anomaly detection on a battery. Possibly as an accelerator
*tile* inside a larger digital SoC rather than as a standalone architecture. **Not** training,
**not** datacentre-scale, and **not** as a general replacement for digital arithmetic. The
strongest version of the idea may turn out to be **digital** in-memory compute (SRAM macros with
compute in the periphery), which keeps the locality win and abandons the analog precision fight.

---

## 7. Optical computing — the distinction the press never makes

**This section exists to separate two things that share a word and share nothing else.**

> **Optical *computation* has failed repeatedly for fifty years and the reasons are physical.
> Optical *interconnect* is real, shipping in volume, and becoming central to AI
> infrastructure.**

Press coverage conflates them constantly. A headline saying "light-based chip is 100× faster"
is almost always about a linear-algebra demonstrator with severe caveats, or about an
interconnect product misdescribed. Learn to tell them apart in one question: **is the light
carrying information from A to B, or is it making a decision?**

### 7.1 Why optical computation keeps failing

The history is long: the 1960s–70s optical Fourier processors for synthetic-aperture radar
(genuinely useful, and genuinely a niche); AT&T Bell Labs' SEED-based "optical computer"
programme in the late 1980s, abandoned; Lenslet's EnLight256 optical DSP (2003), commercially
dead; and the current wave — Lightmatter, Lightelligence, Luminous — which is far more serious
technically and still has not displaced anything.

**The five physical obstacles**, in order of severity:

1. **There is no good optical transistor.** A digital logic family needs a device with **gain**
   (output drives more than one input), **cascadability** (output is a valid input to the next
   stage), **fan-out**, **input–output isolation**, and **standard levels**. Electronics has all
   five in one four-terminal device costing nanometres. Optical nonlinearities are **weak** —
   photons do not interact in vacuum, and in materials the nonlinear coefficients are small, so
   you need high intensities, long interaction lengths, or resonant structures, all of which cost
   power, area or bandwidth. **Fifty years of effort have not produced a cascadable optical
   logic gate that is competitive.** This is the whole story.
2. **Wavelength sets a size floor.** Telecom light is 1.3–1.55 µm; in silicon (n ≈ 3.5) the
   in-material wavelength is ~0.4–0.45 µm. Waveguides, ring resonators and Mach–Zehnder
   interferometers are **micrometres to hundreds of micrometres**. A transistor is tens of
   nanometres. **The density ratio is 10³–10⁶ in area.** You cannot put a billion optical gates
   on a die; you can put a few thousand components.
3. **Light will not hold still.** There is no optical equivalent of a latch or an SRAM cell.
   Storing a bit optically means keeping a photon in a delay line or a cavity, which leaks. **A
   computer without memory is not a computer**, so any optical processor must convert to
   electronics to store anything — and that conversion is the expensive part (see 5).
4. **Precision is poor.** Analog optical computation has the same problems as §6: fabrication
   variation in waveguide dimensions, thermal drift (silicon's thermo-optic coefficient is large,
   so a fraction of a kelvin shifts a resonator off-resonance), and shot noise. Reported
   effective precisions are **4–8 bits**, and getting there requires per-device calibration and
   active thermal control.
5. **The E/O and O/E conversions dominate.** Modulators and photodetectors, plus the DACs and
   ADCs feeding them, cost energy per conversion. If the computation between conversions is
   short, conversion is all you are paying for. **This is exactly §6's ADC problem with an extra
   laser attached.** It also explains why optics wins for *transport* — one conversion pair
   amortised over a long distance — and loses for *computation*, where you convert constantly.

The one place optical computation is genuinely natural is **linear optics**: a mesh of
Mach–Zehnder interferometers implements an arbitrary unitary matrix (Reck et al. 1994; Clements
et al. 2016), and a matrix–vector product happens at the speed of light through the mesh, with
essentially zero energy in the mesh itself. That is a real and elegant advantage. It is
undermined by (2), (4) and (5): small matrices, low precision, and conversion costs at both ends.
Watch this space, but do not hold your breath, and be sceptical of any benchmark that does not
count the converters.

### 7.2 Why optical interconnect is real

Here the physics runs the other way, and the argument is simple: **the loss of an electrical
channel rises with both frequency and distance; the loss of an optical fibre does not.**

Copper at multi-GHz suffers skin effect and dielectric loss that rise with frequency, so as
SerDes rates climb — 25 → 50 → 100 → 200 Gb/s per lane — the reachable distance **shrinks**. A
200 Gb/s electrical lane over a PCB is good for a few tens of centimetres with heavy equalisation.
Optical fibre's attenuation is ~0.2 dB/km at 1550 nm and is **independent of the data rate**.

The consequence: there is a crossover distance beyond which optics wins on energy per bit, and
**that crossover keeps moving closer to the chip** as rates increase. It has now moved inside the
package, which is what "co-packaged optics" means.

**What is actually shipping (with dates):**

- **Long-haul and datacentre fibre** — decades old, entirely unremarkable, and the reason the
  internet exists (`networking-and-internet.md`).
- **Pluggable optical transceivers** (QSFP-DD, OSFP) at 400G/800G/1.6T — the current
  datacentre standard, and a major power consumer: an 800G module draws ~15–20 W, and the optics
  in a large AI cluster can be a substantial fraction of total network power.
- **Co-packaged optics (CPO)** — moving the optical engine from a faceplate module onto the same
  substrate as the switch ASIC, eliminating the electrical run to the faceplate. **Broadcom
  Tomahawk 5-Bailly** (announced 2023) was the first high-volume 51.2 Tb/s CPO switch;
  **Tomahawk 6** followed at 102.4 Tb/s (2025). **Nvidia announced Quantum-X Photonics
  (InfiniBand) and Spectrum-X Photonics (Ethernet) CPO switches at GTC in March 2025**, claiming
  roughly **3.5× better power efficiency** than pluggable-based designs and citing far fewer
  active components. *(Vendor claims; see §12.)*
- **Optical I/O chiplets** — Ayar Labs' TeraPHY and similar, putting optical links directly at
  the die edge for chip-to-chip communication. TSMC's COUPE packaging programme targets the same
  thing.

**Why this matters for the AI half of this curriculum.** A large training run's all-reduce
traffic is §2.4 at rack scale. Scaling to 100 000 accelerators means the network is a first-class
part of the machine, and its **energy per bit and its reach** become architectural constraints on
what topologies and parallelism strategies are affordable. Optical interconnect is the reason
those constraints are loosening. **Optics is winning the data-movement problem, not the
computation problem — which, given Part 2, may be the more valuable of the two.**

---

## 8. Biological and DNA computing — briefly and soberly

**DNA as storage** is the serious idea, and it has one genuinely spectacular property and one
disqualifying one.

**Density.** DNA stores ~2 bits per nucleotide in a molecule a couple of nanometres wide.
Church, Gao & Kosuri (*Science* 337:1628, **Aug 2012**) demonstrated ~5.5 petabits/mm³.
**Erlich & Zielinski** (*Science* 355:950, **March 2017**), "DNA Fountain enables a robust and
efficient storage architecture", achieved **215 petabytes per gram** — about **85 % of the
Shannon capacity** of the DNA channel (1.98 bits/nt theoretical, ~1.83 achieved), using a
fountain-code construction that is a direct application of `information-theory-coding.md`. That
is roughly **six orders of magnitude denser than tape**, and the medium is stable for
**centuries to millennia** in cool, dry, dark conditions — we routinely sequence DNA from
specimens tens of thousands of years old. Nothing else comes close on either axis.

**Latency and cost, which are disqualifying for anything but archival.**

- **Writing** means chemically synthesising oligonucleotides. Cost is on the order of cents per
  base at retail, driven down to fractions of a cent at scale, but synthesising a single
  megabyte means synthesising millions of bases. Throughput is the binding constraint, and it is
  many orders of magnitude short of a hard drive.
- **Reading** means sequencing. Even with nanopore sequencers, latency is **hours**, and the
  process consumes the sample unless amplified by PCR, which introduces errors.
- **Random access** requires PCR primers as addresses; Microsoft/University of Washington
  demonstrated random access over ~200 MB of stored data (2016) and a **fully automated,
  end-to-end write–store–read cycle in 2019 — which stored and retrieved the five bytes "HELLO"
  in about 21 hours.** That figure is the honest state of the art in automation and it should be
  quoted whenever someone says DNA storage is nearly here.
- Error rates in synthesis and sequencing are percent-level, so heavy error-correcting coding is
  mandatory — again, straight out of the coding-theory unit.

**DNA as *computation*** is the weaker idea. **Adleman** (*Science* 266:1021, **Nov 1994**)
famously solved a 7-node Hamiltonian path problem with DNA hybridisation — a beautiful
demonstration of massive molecular parallelism. It does not scale, for a reason that is worth
teaching because it recurs: the approach works by **generating all candidate solutions in
solution**, so the required mass of DNA grows **exponentially** with problem size. Scaling
Adleman's method to a few hundred nodes would require more DNA than there is matter on Earth.
**Molecular parallelism trades an exponential in time for an exponential in mass, which is not a
win.** This is the same category error as the "quantum computers try everything at once"
misconception in §4.1, and pairing them makes both clearer.

Related work that is genuinely promising but is *not* general-purpose computing: **DNA strand
displacement circuits** (Winfree, Qian, Soloveichik) for molecular logic; **molecular
classifiers** that make decisions inside a cell; and **engineered cellular logic** in synthetic
biology. These are compelling because they compute *where a silicon computer cannot go* — inside
a cell, in a droplet, in a body.

**Where it plausibly lands:** cold archival storage on a decades-to-centuries horizon, for data
that is written once, never modified, and read almost never — national archives, scientific
cold storage, cultural preservation. The competition is LTO tape, which is boring, cheap and
already works, so the crossover requires DNA synthesis costs to fall by several orders of
magnitude. **Not a computer. A very good, very slow tape.**

---

# 9. What this means for a working engineer — the closing argument

## 9.1 The single most important consequence: count bytes, not FLOPs

Assemble the chapter's results:

- The thermodynamic floor is 10⁴× away and is not what constrains you (§1.4).
- Arithmetic is nearly free: 0.1 pJ for a 32-bit add at 45 nm (§2.4).
- Moving that operand 10 mm across the die costs **~82 pJ for a 64-bit word** — twenty to forty
  times the arithmetic performed on it (§2.4, computed).
- Fetching it from DRAM costs **6 400× the add** (§2.4, Horowitz).
- Arithmetic energy falls with every node. **Wire energy per millimetre does not.** The ratio
  gets worse, permanently, with no known reversal (§2.4).
- Every successful alternative architecture in Part 4 — NorthPole's 224 MB of on-die memory,
  neuromorphic co-location, analog crossbars, co-packaged optics — wins primarily by **shortening
  the distance data travels**, not by making arithmetic cheaper.

The conclusion is one sentence and it is the closing argument of this entire curriculum:

> **The cost of a computation is dominated by data movement, not by arithmetic. Therefore the
> right first-order model of an algorithm's cost is the number of bytes it moves and how far,
> not the number of operations it performs.**

**This retroactively justifies the arithmetic-intensity reasoning that the whole GPU half of
this course is built on, and that justification should be stated explicitly to the learner.**

When `cuda-programming-tuning.md` insists on tiling a matrix multiply into shared memory, it is
not a CUDA trick. When `algorithms-on-real-hardware.md` computes arithmetic intensity in
FLOP/byte and places a kernel on a roofline, it is not a modelling convenience. When
`ai-systems-distributed-training.md` overlaps gradient all-reduce with backward computation, it
is not an engineering hack. **All three are the same physical fact — `E ∝ C·V²` per millimetre of
wire, and wires do not scale — expressed at three different distance scales.** Arithmetic
intensity is not a heuristic. It is the *dimensionless ratio that determines which side of the
energy and performance rooflines you are on*, and both rooflines exist because of §2.4.

The practical version, which a learner should be able to apply immediately:

1. **Estimate the bytes your algorithm must move, at each level: registers, L1, L2, HBM, network.**
   Multiply each by the appropriate energy per byte. That is your energy budget and usually your
   time budget too.
2. **Compute the arithmetic intensity**, FLOP per byte from the slowest level you touch.
3. **Compare it to the machine's ridge point** (295 FLOP/byte for H100 FP16 tensor, 10 for FP64 —
   §2.2). Below it, you are memory-bound and adding FLOPs is free. Above it, you are compute-bound
   and the only thing that helps is fewer operations or lower precision.
4. **If you are memory-bound, the only useful optimisations increase reuse or reduce precision.**
   Tiling, fusion, recomputation-instead-of-storage, and quantisation all move you right on the
   roofline. Loop unrolling and instruction scheduling do not.
5. **An algorithm with lower asymptotic FLOP count can be slower and less efficient.** This is
   why Strassen's matrix multiply is rarely used, why the O(n log n) FFT is memory-bound at
   large n, and why "fewer operations" and "faster" are different objectives. **Always check
   which one you actually optimised.**

That fifth point is the one that most surprises people trained on classical algorithm analysis,
and it is the strongest reason for a from-first-principles hardware curriculum to exist at all:
**the RAM model of computation, in which every memory access costs 1, has been wrong by three
orders of magnitude since roughly 1990, and every year it gets more wrong.**

## 9.2 What is worth learning when the hardware keeps changing

The specific hardware in this curriculum will be obsolete. H100s will be museum pieces; the
node names will change; some accelerator in Part 3 will be dominant and then will not be. What
survives?

**The invariants — learn these, they are physics or mathematics and will not move:**

1. **Data movement dominates energy, and the gap widens.** Everything in §9.1. This is `CV²` and
   the fact that wires do not shrink usefully. It is the most durable fact in the document.
2. **Latency has a floor set by `c`, and bandwidth costs money.** ~30 cm per nanosecond in
   vacuum, half that in fibre (§2.6). No architecture, protocol or budget changes this. Every
   distributed-systems trade-off you will ever make is downstream of it.
3. **Memory hierarchies exist because of an economic inequality that is not going away**: fast
   memory is expensive per bit and small; cheap memory is slow and large. The *names* of the
   levels change (registers/L1/L2/L3/HBM/SSD/network today; something else in 2040) but the
   shape of the problem — capacity/latency/bandwidth/cost trading against each other, managed by
   locality — is permanent.
4. **Amdahl and Gustafson.** The parallelism ceiling for a fixed problem, and the escape via
   bigger problems (§2.5). These are arithmetic; they cannot expire.
5. **Specialisation buys efficiency by removing flexibility, and the exchange rate is roughly
   one order of magnitude per rung** (§3.1). This is a structural statement about where energy
   goes in a machine, and Hameed et al.'s decomposition explains *why* in terms that outlive any
   specific chip.
6. **Thermodynamics and information are the same subject.** `k_BT ln 2` per bit erased (§1.2), and
   entropy in Shannon's sense equals entropy in Clausius's sense up to units (§1.6). Absolutely
   permanent.
7. **Interference, not parallelism, is what a quantum computer does** (§4.1). This will still be
   true when the hardware is unrecognisable.

**The transferable skills — learn these, they are how you cope with the parts that do move:**

- **Measure, do not assume.** Every number in this document could be wrong for your machine.
  `debugging-and-measurement.md` is the most re-usable unit in the curriculum, because the ability
  to build a microbenchmark that isolates one effect is what lets you re-derive all the constants
  yourself on hardware that does not exist yet.
- **Build the back-of-the-envelope model first.** Bytes moved × energy per byte, or bytes moved ÷
  bandwidth. If your measurement is within 2× of your model, you understand the system. If it is
  off by 10×, you have learned something specific, which is better.
- **Read the numbers, not the marketing.** Vendor TOPS figures assume a precision, a sparsity
  pattern and a utilisation. Neuromorphic and analog efficiency claims usually compare against a
  weak baseline. Quantum "advantage" claims usually estimate the classical difficulty of a task
  designed to be classically hard. The discipline of asking *"compared to what, measured how,
  on what date"* is the single most valuable habit this chapter can leave behind.
- **Know the shape of the ladder** (§3.1), so that when the workload changes you can predict which
  rung the industry will move to and why.

**The honest caution about the age of the accelerator.** §3.3's question has no answer yet. The
current equilibrium — enormous specialised matmul engines, fed by HBM, connected by increasingly
optical networks — is a bet on a workload staying the shape it is. Historically the algorithms
bend to fit the hardware more often than the reverse. **The most useful thing to internalise is
not any of these machines but the reasoning that produces them**, because that reasoning is what
you will need when the machines change.

---

# 10. Curriculum — the final chapter

**Placement.** Last. This chapter is only meaningful after the learner has built a CPU
(`nand2tetris-eater-scott.md`), understands CMOS and Dennard scaling
(`transistors-cmos-fabrication.md`), has profiled a memory-bound kernel
(`algorithms-on-real-hardware.md`, `debugging-and-measurement.md`), has optimised a GPU kernel
against a roofline (`cuda-programming-tuning.md`), and has seen a distributed training run
(`ai-systems-distributed-training.md`). It is the chapter that tells them what all of that was
*for*.

**Three units, ~2–3 sessions.** Every exercise is computational and checkable. Nothing in this
chapter asks the learner to speculate.

---

## Unit L1 — The floor and the walls

**Goal:** the learner can state where the thermodynamic limit is, prove that we are nowhere near
it, and identify which wall actually binds a given piece of code.

**Content:** §1.1–1.4 (Landauer, the experiments, the ratio calculation), §1.5 (reversible
computing and why it stays theoretical), §1.6 (Maxwell's demon), §1.7 as a *quick tour*, clearly
labelled cosmology. Then §2.0–2.6, with Dennard scaling *assigned as revision* from
`transistors-cmos-fabrication.md` rather than re-taught.

**The through-line:** "the limit that matters is not the one you have heard of."

| # | Exercise | Expected answer |
|---|---|---|
| **L1.1** | Compute `k_B T ln 2` at 77 K, 293.15 K, 298.15 K and 300 K. Express each in J, zJ and meV. Then find the temperature at which it equals exactly 2.75 zJ. | **0.737 / 2.805 / 2.853 / 2.871 zJ**; 2.75 zJ occurs at **287.4 K = 14.3 °C**. *(Payoff: the learner discovers by computation that the widely-quoted "2.75 zJ at room temperature" is wrong, and never trusts an unsourced constant again.)* |
| **L1.2** | **The ratio.** For a 7 nm gate with C = 0.15 fF and V_dd = 0.75 V, compute `E = CV²` and divide by `k_B T ln 2` at 300 K. Repeat for a 1990s gate (50 fF, 5 V). | **84.4 aJ, ratio 2.94 × 10⁴**; and **1.25 pJ, ratio 4.35 × 10⁸**. *(Payoff: "we are 30 000× above the floor, and we used to be 400 million× above it." This one number reframes the entire chapter.)* |
| **L1.3** | A reliable bit needs `E ≳ 41 k_BT` for a 10⁻¹⁸ error rate (from `p_err ≈ e^(−E/k_BT)`). Compute that energy at 300 K and the ratio of a 3 nm gate to *it*. | ~**1.70 × 10⁻¹⁹ J = 0.17 aJ**; 49 aJ / 0.17 aJ ≈ **290×**. *(Payoff: the practical floor is 10²·k_BT ln 2, not 1×. The real remaining headroom is two orders of magnitude, not four.)* |
| **L1.4** | **Toffoli and Bennett.** Implement the Toffoli gate on a 3-bit register. Verify by exhaustion that it is a bijection and its own inverse. Build AND from it. Then implement Bennett's compute–copy–uncompute and verify the garbage wire returns to 0 for all inputs. | All four checks pass; garbage is zero for all 4 input pairs *(verified, §10.6 program F)*. *(Payoff: reversible computing stops being a slogan. The learner has written one.)* |
| **L1.5** | An adiabatic circuit dissipates `E ≈ (RC/τ)CV²`. With RC = 10 ps and `CV² = 84 aJ`, tabulate dissipation for τ = 10 ps, 100 ps, 1 ns, 10 ns, 100 ns. Now add a fixed leakage power of 10 nW per gate and find the τ that minimises **total** energy. | Dynamic falls as 1/τ; leakage energy `= 10 nW × τ` rises linearly. Minimum near **τ ≈ 290 ps**, total ≈ **5.8 aJ**, a ~15× saving — not the unbounded saving the formula alone suggests. *(Payoff: §1.5's reason 3, discovered rather than asserted.)* |
| **L1.6** | **Amdahl vs Gustafson.** Tabulate Amdahl speedup for s ∈ {0.1, 0.05, 0.01, 0.001} at N ∈ {1, 8, 64, 1024, ∞}. Then tabulate Gustafson scaled speedup for the same s and N. | Amdahl saturates at 1/s (10, 20, 100, 1000). Gustafson is linear: `N − s(N−1)`, so at N=1024, s=0.01 it gives **~1014×**. *(Payoff: the learner sees that "the parallelism ceiling" depends entirely on whether the problem grows, which is exactly the strong- vs weak-scaling distinction in the distributed-training unit.)* |
| **L1.7** | **Speed of light.** At clock frequencies 1, 5, 10 and 50 GHz, compute how far light travels in vacuum in one period, and how far a signal travels on a PCB at 0.6 c. | 1 GHz: 300 mm / 180 mm. 5 GHz: 60 / 36 mm. 10 GHz: 30 / 18 mm. 50 GHz: **6 / 3.6 mm**. *(Payoff: the learner derives, in three lines, why nobody is shipping a 50 GHz synchronous chip.)* |

---

## Unit L2 — The communication wall and the closing argument

**Goal:** the learner can compute an energy budget for a kernel in bytes-moved terms, derive a
break-even arithmetic intensity, and articulate *why* the GPU chapters were about tiling.

**Content:** §2.4 in full (this is the centre of the chapter), §2.2's roofline connection, Part 3
(the efficiency ladder and the age of the accelerator), and §9 as the explicit closing argument.
**§9.1 should be delivered as a statement to the learner, not left implicit.**

| # | Exercise | Expected answer |
|---|---|---|
| **L2.1** | **Wire energy from first principles.** With global interconnect at 0.2 pF/mm and a 0.8 V swing, compute the energy to move 1 bit 1 mm, then a 64-bit word 1, 5, 10 and 20 mm. | **0.128 pJ/bit/mm**; 64-bit: **8.19 / 40.96 / 81.92 / 163.84 pJ** *(verified, §10.6 program C)*. *(Payoff: the headline figure — 82 pJ to move a word 10 mm — derived, not quoted.)* |
| **L2.2** | Using Horowitz's 45 nm table, express every operation as a multiple of a 32-bit integer add. | add 1×, FP add 9×, int mul 31×, FP mul 37×, **8 KB SRAM read 50×, DRAM read 6 400×** *(verified)*. *(Payoff: the ALU is free; the operand supply is the bill.)* |
| **L2.3** | **★ Break-even data reuse.** DRAM costs `E_mem` per byte, a FLOP costs `E_flop`. Derive the arithmetic intensity at which the two halves of the energy bill are equal. Evaluate for an H100 (HBM3 at 3.9 pJ/bit; 989 TFLOP/s FP16 at 700 W) and for a 7 nm SoC with LPDDR5 at 10 pJ/bit and 10 TFLOP/s at 15 W. | Break-even AI `= E_mem/E_flop`. H100 FP16: 31.2 pJ/byte ÷ 0.708 pJ/FLOP = **44.1 FLOP/byte**. SoC: 80 ÷ 1.5 = **53.3 FLOP/byte** *(verified)*. *(Payoff: a kernel at AI = 10 spends ~80 % of its joules on DRAM traffic. This is the number that makes §9.1 concrete.)* |
| **L2.4** | Compute the H100's **performance** ridge points for FP16 tensor and FP64, and compare to the energy break-even from L2.3. Explain why they differ and what the region between them means. | FP16: 989/3.35 = **295 FLOP/byte**; FP64: **10.1**. Energy break-even is 44. Between 44 and 295 you are energy-dominated by compute but still performance-bound by memory. *(Payoff: two rooflines, not one; the learner must reason about which constraint they are optimising.)* |
| **L2.5** | Take a naive `C = A·B` matmul at n = 1024 (fp32) and a tiled version with tile size T. Compute bytes moved from DRAM in each case and the arithmetic intensity. Plot AI against T. | Naive (no reuse of B): `~2n³·4` bytes → AI ≈ 0.25 FLOP/byte. Tiled: bytes ≈ `2n³·4/T`, AI ≈ **T/4** FLOP/byte. To reach the 295 ridge you need **T ≈ 1180** — impossible in one level, which is exactly why real GEMMs tile at *three* levels (register, shared, L2). *(Payoff: the whole CUDA unit, rederived as an energy argument.)* |
| **L2.6** | Estimate the energy of one all-reduce of a 7 B-parameter model's gradients (fp16, ring all-reduce, 1 024 GPUs) at 5 pJ/bit of network energy, and compare it to the compute energy of one forward-backward pass at 0.7 pJ/FLOP, for per-GPU batches of 1 000 and 100 tokens. | Gradients = 14 GB; ring all-reduce moves `2(N−1)/N × 14 GB ≈ 28 GB` per GPU = 2.24 × 10¹¹ bits → **~1.12 J per GPU per step** on the network. Compute ≈ `6 × 7e9 × tokens × 0.7 pJ`: **~29 J** at 1 000 tokens (network = **3.7 %**) but **~2.9 J** at 100 tokens (network = **28 %**). *(Payoff: the network's share of the energy bill is set by the per-GPU batch size, which is exactly why shrinking batch to reduce time-to-solution runs into a communication wall — Amdahl and §2.4 meeting at cluster scale.)* |

---

## Unit L3 — Alternatives, assessed

**Goal:** the learner can explain what a quantum computer actually does, has *written* one, can
compute error-correction overhead, and can evaluate any future architecture claim with the
right questions.

**Content:** §4 in full, with §4.1's interference framing delivered before anything else; §5–8
at a brisk pace; §4.8 as the closing list.

| # | Exercise | Expected answer |
|---|---|---|
| **L3.1** | **★★ Grover on 3 qubits as an 8×8 matrix.** Build H⊗³, the oracle for a marked state, and the diffusion operator `2\|s⟩⟨s\| − I` as explicit 8×8 complex matrices. Verify each is unitary (`U†U = I` to 1e-9). Apply the Grover iterate to `H⊗³\|000⟩` and print P(marked) after 0–4 iterations. | 0.125 → **0.78125** → **0.945313** → 0.330078 → 0.012207 *(verified, §10.6 program D)*. All operators unitary. *(Payoff: **this is the exercise that demystifies quantum computing.** It is linear algebra. There is no magic and no oracle hand-waving — the student writes the whole thing.)* |
| **L3.2** | Compare your simulated probabilities to the closed form `sin²((2k+1)θ)` with `sin θ = 1/√8`. Then explain rows k=3 and k=4. | Agreement to six decimals; θ = 0.361367 rad. At k=4, P drops to **1.2 %, worse than random guessing (12.5 %)**. *(Payoff: **this kills the "tries everything at once" misconception permanently.** A parallel search cannot get worse by running longer. A rotation can — because it over-rotates past the target.)* |
| **L3.3** | Compute the optimal iteration count `⌊(π/4)√N⌋` for N = 8, 2¹⁰, 2²⁰. Then compute how many iterations Grover needs for a 256-bit key search, and compare to §1.7's Earth-mass-computer budget. | 2, 25, 804. For N = 2²⁵⁶: **2¹²⁸ ≈ 3.4 × 10³⁸ iterations** *(verified)*. *(Payoff: quadratic is not exponential, and AES-256 survives. Connects straight to `cryptography.md`.)* |
| **L3.4** | **★ Physical-qubit overhead.** Using `p_L ≈ 0.1(p/0.01)^((d+1)/2)` and `2d²−1` physical qubits per logical qubit, find the smallest odd `d` and the qubit count for targets `p_L` ∈ {10⁻⁶, 10⁻⁹, 10⁻¹²} at physical error rates p ∈ {10⁻³, 10⁻⁴}. | At p = 10⁻³: d = 11/17/23 → **241 / 577 / 1057** physical per logical. At p = 10⁻⁴: d = 5/7/11 → **49 / 97 / 241** *(verified, §10.6 program E)*. *(Payoff: a 10× better physical error rate cuts overhead ~4.4×. **Fidelity beats qubit count**, which is the single most useful thing to know when reading quantum press releases.)* |
| **L3.5** | Extend L3.4: how many physical qubits for a 1 000-logical-qubit machine at p = 10⁻³, `p_L` = 10⁻¹²? Then multiply by 2–10× for magic-state factories. | ~**1.25 million** data qubits *(verified)*, so **2.5–12.5 million** total. Compare to the ~100–150 physical qubits available in 2024–2026. *(Payoff: the gap, quantified. Neither "it's vapour" nor "it's imminent" survives this number.)* |
| **L3.6** | Given Willow's reported Λ ≈ 2.14 (each +2 in distance halves logical error) and a starting logical error of 1.4 × 10⁻³ at d = 7, estimate the distance needed to reach 10⁻¹⁰, and the physical qubits per logical qubit. | Need ~10⁷ suppression → `log_2.14(10⁷) ≈ 21` distance steps of 2 → d ≈ 49 → `2d²−1 ≈` **4 800 physical qubits per logical qubit**. *(Payoff: the December 2024 milestone is real *and* the remaining road is long. Both, at once, from one calculation.)* |
| **L3.7** | **The claim-evaluation drill.** Give the learner four real headlines — a quantum advantage claim, a neuromorphic efficiency claim, an analog TOPS/W claim, and an "optical chip" claim. For each, ask: compared to what baseline, measured how, on what date, and what is not being counted? | Expected: quantum → is the classical baseline the *best known* algorithm, and is the task useful? neuromorphic → is the GPU baseline quantised and batched? analog → does the figure include ADC/DAC? optical → is this computation or interconnect? *(Payoff: the transferable skill from §9.2, drilled.)* |

---

## 10.4 The one diagram for this chapter

```
                              ENERGY PER OPERATION  (log scale, 45 nm reference)
   10 zJ  ──  k_B T ln 2 at 300 K = 2.87 zJ  ◄── the thermodynamic floor (§1.2)
              (nothing has ever operated here)
                        │
                        │   ~10^2×  reliability margin: E ≳ 41 k_BT for 1e-18 BER (§1.4)
                        ▼
    0.2 aJ  ──  practical floor for a RELIABLE irreversible bit
                        │
                        │   ~10^2×  the headroom that is actually left
                        ▼
     49 aJ  ──  3 nm CMOS gate switch   ◄── where we are (§1.4)
    100 fJ  ──  32-bit int ADD, 45 nm                        1×
    900 fJ  ──  32-bit FP ADD                                9×
      5 pJ  ──  32-bit SRAM read (8 KB)                     50×
      8 pJ  ──  move 64 bits 1 mm on-chip                   82×
     82 pJ  ──  move 64 bits 10 mm on-chip                 820×   ◄── §2.4
    640 pJ  ──  32-bit DRAM read                          6400×   ◄── §2.4
      ~5 nJ ──  move 64 bits across a datacentre network  50000×

   Arithmetic falls with every node.   ─────────►  Wires do not.
   Therefore this ladder gets STEEPER forever.     Therefore: count bytes. (§9.1)
```

## 10.5 Assessment

One question, answered in writing, that requires the whole chapter:

> *"A vendor claims their new accelerator is 100× more energy-efficient than an H100 on
> transformer inference. Without knowing anything else about it, list the five things it could be
> doing to get that number, rank them by how much each is physically capable of contributing,
> and state what measurement you would demand to distinguish them."*

A complete answer should reach: (1) lower precision — up to ~4–8× and legitimate; (2) more
on-die memory / less DRAM traffic — up to ~10–100×, the biggest legitimate lever, per §2.4 and
NorthPole; (3) removing instruction-supply overhead by specialising — up to ~10–100× per §3.1,
but the H100 already did most of this; (4) exploiting sparsity — workload-dependent, easily
overstated; (5) a rigged baseline — batch size 1, unquantised, fp32, or perf/W measured on the
chip rather than the system. The demanded measurement: **end-to-end tokens per second per watt
at the wall, at equal accuracy, on the same model, including memory and host.** A learner who
produces that has understood the chapter.

---

## 10.6 The programs, and their real output

Every program below was compiled with **GCC 15.2** and **executed** via the Compiler Explorer
API. Each carries a nonce comment because CE caches by source hash. The outputs are transcribed
from stdout, not from memory.

### Program A — Landauer's limit and the CMOS ratio

```cpp
#include <cstdio>
#include <cmath>
#include <initializer_list>
int main(){
    const double k = 1.380649e-23;      // J/K, SI exact since 2019
    const double ln2 = std::log(2.0);
    printf("=== Landauer kT ln2 ===\n");
    for (double T : {77.0, 287.4, 293.15, 298.15, 300.0, 373.15}) {
        double E = k*T*ln2;
        printf("T=%7.2f K   kTln2 = %.4e J = %.4f zJ = %.5f meV\n",
               T, E, E*1e21, E/1.602176634e-19*1000.0);
    }
    printf("\n=== CMOS switching energy  E = C*Vdd^2 ===\n");
    struct N { const char* name; double C_fF; double V; };
    N nodes[] = {
        {"1990s 1um-ish gate", 50.0, 5.0}, {"180nm gate", 5.0, 1.8},
        {"45nm  gate", 1.0, 1.0}, {"7nm   FinFET gate", 0.15, 0.75},
        {"3nm   gate (est)", 0.10, 0.70},
    };
    double L300 = k*300.0*ln2;
    for (auto&n : nodes) {
        double E = n.C_fF*1e-15 * n.V*n.V;
        printf("%-22s C=%6.2f fF V=%.2f  E=%.3e J = %8.1f aJ  ratio to Landauer(300K) = %.3e\n",
               n.name, n.C_fF, n.V, E, E*1e18, E/L300);
    }
    printf("\nLandauer at 300K = %.4e J (%.3f zJ)\n", L300, L300*1e21);
}
```

**Real output:**

```
=== Landauer kT ln2 ===
T=  77.00 K   kTln2 = 7.3688e-22 J = 0.7369 zJ = 4.59927 meV
T= 287.40 K   kTln2 = 2.7504e-21 J = 2.7504 zJ = 17.16663 meV
T= 293.15 K   kTln2 = 2.8054e-21 J = 2.8054 zJ = 17.51008 meV
T= 298.15 K   kTln2 = 2.8533e-21 J = 2.8533 zJ = 17.80874 meV
T= 300.00 K   kTln2 = 2.8710e-21 J = 2.8710 zJ = 17.91924 meV
T= 373.15 K   kTln2 = 3.5710e-21 J = 3.5710 zJ = 22.28855 meV

=== CMOS switching energy  E = C*Vdd^2 ===
1990s 1um-ish gate     C= 50.00 fF V=5.00  E=1.250e-12 J = 1250000.0 aJ  ratio to Landauer(300K) = 4.354e+08
180nm gate             C=  5.00 fF V=1.80  E=1.620e-14 J =  16200.0 aJ  ratio to Landauer(300K) = 5.643e+06
45nm  gate             C=  1.00 fF V=1.00  E=1.000e-15 J =   1000.0 aJ  ratio to Landauer(300K) = 3.483e+05
7nm   FinFET gate      C=  0.15 fF V=0.75  E=8.438e-17 J =     84.4 aJ  ratio to Landauer(300K) = 2.939e+04
3nm   gate (est)       C=  0.10 fF V=0.70  E=4.900e-17 J =     49.0 aJ  ratio to Landauer(300K) = 1.707e+04

Landauer at 300K = 2.8710e-21 J (2.871 zJ)
```

### Program B — the physical bounds

*(source in the research scratchpad; the load-bearing lines are `4*E/h`, `c*c/h`, the photon-gas
entropy `S = (4/3)aT³V` with `a = π²k⁴/(15ħ³c³)`, and `I = 2πRE/(ħ c ln2)`)*

**Real output:**

```
mc^2 for 1 kg              = 8.98755e+16 J
Margolus-Levitin 4E/h      = 5.42557e+50 ops/s (orthogonal state transitions)
Bremermann c^2/h           = 1.35639e+50 bit/s per kg
photon-gas T for 1kg in 1L = 5.8708e+08 K
entropy in bits            = 2.1329e+31 bits  (Lloyd quotes ~2.13e31)
Bekenstein I<=2piRE/(hbar c ln2), R=0.10 m, 1 kg = 2.5769e+42 bits
Bekenstein coefficient     = 2.57691e+43 bits per (kg*m)

Earth-mass ultimate computer: 3.2402e+75 ops/s
2^256 ops would take       = 3.5737e+01 s = 1.1324e-06 years
2^128 ops would take       = 1.0502e-37 s = 3.3279e-45 years
```

Cross-check: Lloyd's published memory figure for the ultimate laptop is ~2.13 × 10³¹ bits; this
independent derivation from the photon-gas entropy reproduces it exactly. Bremermann's constant
matches Wikipedia's 1.3563925 × 10⁵⁰ to six significant figures.

### Program C — data movement energy and break-even arithmetic intensity

```cpp
#include <cstdio>
#include <initializer_list>
int main(){
    double Cw = 0.2e-12;      // F/mm, repeated global interconnect
    double V  = 0.8;          // V swing
    double e_bit_mm = Cw*V*V;
    printf("on-chip wire: %.4f pJ per bit per mm  (C=0.2pF/mm, V=0.8V)\n", e_bit_mm*1e12);
    for (int mm : {1,5,10,20})
        printf("  move 64 bits %2d mm across die = %8.2f pJ\n", mm, 64.0*mm*e_bit_mm*1e12);
    struct Op { const char* n; double pJ; };
    Op ops[] = {{"32b int add",0.1},{"32b FP add",0.9},{"32b int mult",3.1},{"32b FP mult",3.7},
                {"32b SRAM read (8KB)",5.0},{"32b DRAM read",640.0}};
    printf("\nHorowitz 45nm table, and each as a multiple of a 32b int add:\n");
    for (auto&o:ops) printf("  %-22s %7.1f pJ   %8.0fx\n", o.n, o.pJ, o.pJ/0.1);
    printf("\n=== energy break-even arithmetic intensity ===\n");
    struct Sys { const char* n; double pJ_per_bit_dram; double flops; double watts; };
    Sys s[] = {
        {"H100 SXM FP16 tensor + HBM3", 3.9, 989.0e12, 700.0},
        {"H100 SXM FP64 (non-tensor)",  3.9,  34.0e12, 700.0},
        {"generic 7nm + LPDDR5",       10.0,  10.0e12,  15.0},
    };
    for (auto&x:s){
        double e_byte = x.pJ_per_bit_dram*8.0;
        double e_flop = x.watts/x.flops*1e12;
        printf("%-30s DRAM %5.1f pJ/byte | %6.3f pJ/FLOP (chip avg at peak) | break-even AI = %6.1f FLOP/byte\n",
               x.n, e_byte, e_flop, e_byte/e_flop);
    }
    printf("\nH100 performance ridge point (FP16 tensor 989 TFLOP/s / 3.35 TB/s) = %.1f FLOP/byte\n",
           989.0e12/3.35e12);
    printf("H100 performance ridge point (FP64 34 TFLOP/s / 3.35 TB/s)          = %.1f FLOP/byte\n",
           34.0e12/3.35e12);
}
```

**Real output:**

```
on-chip wire: 0.1280 pJ per bit per mm  (C=0.2pF/mm, V=0.8V)
  move 64 bits  1 mm across die =     8.19 pJ
  move 64 bits  5 mm across die =    40.96 pJ
  move 64 bits 10 mm across die =    81.92 pJ
  move 64 bits 20 mm across die =   163.84 pJ

Horowitz 45nm table, and each as a multiple of a 32b int add:
  32b int add                0.1 pJ          1x
  32b FP add                 0.9 pJ          9x
  32b int mult               3.1 pJ         31x
  32b FP mult                3.7 pJ         37x
  32b SRAM read (8KB)        5.0 pJ         50x
  32b DRAM read            640.0 pJ       6400x

=== energy break-even arithmetic intensity ===
H100 SXM FP16 tensor + HBM3    DRAM  31.2 pJ/byte |  0.708 pJ/FLOP (chip avg at peak) | break-even AI =   44.1 FLOP/byte
H100 SXM FP64 (non-tensor)     DRAM  31.2 pJ/byte | 20.588 pJ/FLOP (chip avg at peak) | break-even AI =    1.5 FLOP/byte
generic 7nm + LPDDR5           DRAM  80.0 pJ/byte |  1.500 pJ/FLOP (chip avg at peak) | break-even AI =   53.3 FLOP/byte

H100 performance ridge point (FP16 tensor 989 TFLOP/s / 3.35 TB/s) = 295.2 FLOP/byte
H100 performance ridge point (FP64 34 TFLOP/s / 3.35 TB/s)          = 10.1 FLOP/byte
```

### Program D — ★ Grover's algorithm as an 8×8 unitary

**This is the centrepiece exercise of the chapter.**

```cpp
// A 3-qubit quantum circuit IS an 8x8 unitary. Nothing more mystical than that.
#include <cstdio>
#include <complex>
#include <array>
#include <cmath>
using cd = std::complex<double>;
static const int N = 8;                     // 2^3 basis states
using Mat = std::array<std::array<cd,N>,N>;
using Vec = std::array<cd,N>;

Mat mul(const Mat&A, const Mat&B){ Mat C{};
  for(int i=0;i<N;i++)for(int k=0;k<N;k++){ cd a=A[i][k]; if(a==cd(0,0))continue;
    for(int j=0;j<N;j++) C[i][j]+=a*B[k][j]; } return C; }
Vec applyM(const Mat&A, const Vec&v){ Vec w{};
  for(int i=0;i<N;i++){ cd s=0; for(int j=0;j<N;j++) s+=A[i][j]*v[j]; w[i]=s;} return w; }

// H on all three qubits: (1/sqrt(8)) * (-1)^{popcount(i&j)}
Mat H3(){ Mat M{}; double s=1.0/std::sqrt(8.0);
  for(int i=0;i<N;i++)for(int j=0;j<N;j++){ int p=__builtin_popcount(i&j); M[i][j]=s*((p&1)?-1.0:1.0);} return M; }
Mat oracle(int marked){ Mat M{}; for(int i=0;i<N;i++) M[i][i]= (i==marked)? cd(-1,0):cd(1,0); return M; }
// Diffusion: 2|s><s| - I  with |s> the uniform superposition
Mat diffusion(){ Mat M{}; for(int i=0;i<N;i++)for(int j=0;j<N;j++) M[i][j]= 2.0/N - (i==j?1.0:0.0); return M; }
bool isUnitary(const Mat&A){ for(int i=0;i<N;i++)for(int j=0;j<N;j++){ cd s=0;
    for(int k=0;k<N;k++) s+=std::conj(A[k][i])*A[k][j];
    cd e=(i==j)?cd(1,0):cd(0,0); if(std::abs(s-e)>1e-9) return false;} return true; }

int main(){
  const int marked = 5;                       // |101>
  Mat h=H3(), O=oracle(marked), D=diffusion();
  printf("H3 unitary?        %s\n", isUnitary(h)?"yes":"NO");
  printf("oracle unitary?    %s\n", isUnitary(O)?"yes":"NO");
  printf("diffusion unitary? %s\n", isUnitary(D)?"yes":"NO");
  Mat G = mul(D,O);                            // one Grover iteration
  printf("Grover iterate unitary? %s\n\n", isUnitary(G)?"yes":"NO");

  Vec v{}; v[0]=1;                             // |000>
  v = applyM(h,v);                             // uniform superposition
  printf("iter  P(marked=%d)   P(each other)   sum\n", marked);
  for(int k=0;k<=4;k++){
    double pm=std::norm(v[marked]), po=std::norm(v[(marked+1)%N]), sum=0;
    for(int i=0;i<N;i++) sum+=std::norm(v[i]);
    printf(" %d     %.6f       %.6f       %.6f\n", k, pm, po, sum);
    v = applyM(G,v);
  }
  int kopt = (int)std::floor(M_PI/4.0*std::sqrt((double)N));
  printf("\noptimal iterations floor(pi/4*sqrt(8)) = %d\n", kopt);
  double th=std::asin(1.0/std::sqrt((double)N));
  printf("analytic P(success) after k iters = sin^2((2k+1)*theta), theta=%.6f rad\n", th);
  for(int k=0;k<=4;k++) printf("  k=%d -> %.6f\n",k,std::pow(std::sin((2*k+1)*th),2));
  printf("\nGrover on N=2^256 needs ~%.3e iterations (2^128)\n", std::pow(2.0,128));
}
```

**Real output:**

```
H3 unitary?        yes
oracle unitary?    yes
diffusion unitary? yes
Grover iterate unitary? yes

iter  P(marked=5)   P(each other)   sum
 0     0.125000       0.125000       1.000000
 1     0.781250       0.031250       1.000000
 2     0.945313       0.007813       1.000000
 3     0.330078       0.095703       1.000000
 4     0.012207       0.141113       1.000000

optimal iterations floor(pi/4*sqrt(8)) = 2
analytic P(success) after k iters = sin^2((2k+1)*theta), theta=0.361367 rad
  k=0 -> 0.125000
  k=1 -> 0.781250
  k=2 -> 0.945313
  k=3 -> 0.330078
  k=4 -> 0.012207

Grover on N=2^256 needs ~3.403e+38 iterations (2^128)
```

**Three teaching points, all visible in that output.** (1) The simulated and analytic
probabilities match to six decimals — a 3-qubit quantum computer is an 8×8 matrix, exactly and
completely. (2) Every operator is verifiably unitary, i.e. reversible, which is §1.5 showing up
as a physical requirement. (3) **P(marked) goes down after k = 2 and reaches 1.2 % at k = 4** —
worse than the 12.5 % you would get by guessing. A machine "trying all answers at once" cannot
do that. A rotation that overshoots can.

### Program E — surface-code overhead

```cpp
#include <cstdio>
#include <cmath>
#include <initializer_list>
// Rotated surface code:  p_L(d) = A*(p/p_th)^((d+1)/2) per cycle;  qubits = 2d^2 - 1
int main(){
    const double A = 0.1, p_th = 0.01;
    printf("%-10s %-12s %-6s %-14s %-10s\n","p(phys)","target p_L","d","p_L achieved","phys/logical");
    for (double p : {1e-3, 5e-4, 1e-4}) {
        for (double tgt : {1e-6, 1e-9, 1e-12, 1e-15}) {
            int d=3; double pl=0;
            for (; d<=101; d+=2) { pl = A*std::pow(p/p_th,(d+1)/2.0); if (pl<=tgt) break; }
            printf("%-10.0e %-12.0e %-6d %-14.2e %-10d\n", p, tgt, d, pl, 2*d*d-1);
        }
        printf("\n");
    }
    int phys = 2*25*25-1;
    for (int N : {100, 1000, 10000, 100000})
        printf("  %6d logical qubits -> %10d physical qubits (data only)\n", N, N*phys);
}
```

**Real output (abridged to the rows used in the text):**

```
p(phys)    target p_L   d      p_L achieved   phys/logical
1e-03      1e-06        11     1.00e-07       241
1e-03      1e-09        17     1.00e-10       577
1e-03      1e-12        23     1.00e-13       1057
1e-03      1e-15        29     1.00e-16       1681

5e-04      1e-06        7      6.25e-07       97
5e-04      1e-09        13     7.81e-11       337
5e-04      1e-12        17     1.95e-13       577
5e-04      1e-15        21     4.88e-16       881

1e-04      1e-06        5      1.00e-07       49
1e-04      1e-09        7      1.00e-09       97
1e-04      1e-12        11     1.00e-13       241
1e-04      1e-15        15     1.00e-17       449

=== machine size, p=1e-3, target p_L=1e-12 (d=25, 1249 phys/logical) ===
     100 logical qubits ->     124900 physical qubits (data only, no magic-state factories)
    1000 logical qubits ->    1249000 physical qubits (data only, no magic-state factories)
   10000 logical qubits ->   12490000 physical qubits (data only, no magic-state factories)
  100000 logical qubits ->  124900000 physical qubits (data only, no magic-state factories)
```

**Note on the model.** The `p_L ≈ A(p/p_th)^((d+1)/2)` form with `A ≈ 0.1` and `p_th ≈ 1 %` is the
standard textbook heuristic (Fowler et al. 2012), not a fit to any specific device. Real devices
have a worse effective `p_th` and a worse prefactor — Willow's measured Λ ≈ 2.14 implies a much
shallower suppression than this formula's idealised behaviour, which is why exercise L3.6 asks
the learner to redo the calculation with the *measured* Λ and gets a far larger answer
(~4 800 vs 1 057). **Teaching both is the point.**

### Program F — Toffoli, and Bennett's uncompute

```cpp
#include <cstdio>
#include <cassert>
static inline int toffoli(int s,int a,int b,int c){
    int A=(s>>a)&1, B=(s>>b)&1;
    if(A&&B) s ^= (1<<c);
    return s;
}
static inline int cnot(int s,int a,int b){ if((s>>a)&1) s ^= (1<<b); return s; }
int main(){
    bool seen[8]={false}; bool bij=true, invol=true;
    for(int s=0;s<8;s++){ int t=toffoli(s,0,1,2);
        if(seen[t]) bij=false; seen[t]=true;
        if(toffoli(t,0,1,2)!=s) invol=false; }
    printf("Toffoli is a bijection on 3 bits : %s\n", bij?"yes":"NO");
    printf("Toffoli is its own inverse       : %s\n", invol?"yes":"NO");
    printf("\n a b | ancilla after Toffoli | a,b preserved\n");
    for(int a=0;a<2;a++)for(int b=0;b<2;b++){
        int s=(a<<0)|(b<<1)|(0<<2);
        int t=toffoli(s,0,1,2);
        printf(" %d %d |          %d            |   %d,%d\n",a,b,(t>>2)&1,t&1,(t>>1)&1);
        assert(((t>>2)&1)==(a&b));
    }
    int fails=0;
    for(int a=0;a<2;a++)for(int b=0;b<2;b++){
        int s=(a)|(b<<1);                  // ancillas 2..5 zero
        s = toffoli(s,0,1,2);              // forward: garbage = a AND b
        s = cnot(s,2,3);                   // copy result to output wire
        s = toffoli(s,0,1,2);              // UNCOMPUTE: garbage back to 0
        int garbage=(s>>2)&1, out=(s>>3)&1;
        if(garbage!=0 || out!=(a&b) || (s&1)!=a || ((s>>1)&1)!=b) fails++;
    }
    printf("\nBennett compute/copy/uncompute: garbage cleanly zeroed for all inputs: %s\n",
           fails==0?"yes (0 failures)":"NO");
}
```

**Real output:**

```
Toffoli is a bijection on 3 bits : yes
Toffoli is its own inverse       : yes

 a b | ancilla after Toffoli | a,b preserved
 0 0 |          0            |   0,0
 0 1 |          0            |   0,1
 1 0 |          0            |   1,0
 1 1 |          1            |   1,1

Bennett compute/copy/uncompute: garbage cleanly zeroed for all inputs: yes (0 failures)
  -> AND computed with ZERO bits erased. Landauer cost of the logic: 0 J.
  -> (the register must still be reset before reuse; that is where the bill lands)
```

**A gotcha worth passing on to anyone reproducing this.** Naming the matrix-application helper
`apply` in program D breaks the build: argument-dependent lookup finds `std::apply` (dragged in
transitively by `<complex>`) and produces a wall of template errors that never mentions your
function. Renaming it to `applyM` fixes it. Also, GCC 15 requires an explicit
`#include <initializer_list>` for `for (double T : {…})` range-for over a braced list — it is no
longer pulled in transitively. Both cost a build cycle here; both are worth a footnote in the
exercise handout.

---

# 11. Sources

## 11.1 Primary literature — thermodynamics and limits

| Source | Used for |
|---|---|
| R. Landauer, "Irreversibility and heat generation in the computing process", *IBM J. Res. Dev.* 5(3):183–191, **1961** | §1.2, the principle itself |
| C. H. Bennett, "Logical reversibility of computation", *IBM J. Res. Dev.* 17(6):525–532, **1973** | §1.5, the uncompute construction |
| C. H. Bennett, "The thermodynamics of computation — a review", *Int. J. Theor. Phys.* 21:905, **1982** | §1.6, the Maxwell's demon resolution |
| C. H. Bennett, "Time/space trade-offs for reversible computation", *SIAM J. Comput.* 18:766–776, **1989** | §1.5, the space–time trade |
| T. Toffoli, "Reversible computing", ICALP, **1980**; E. Fredkin & T. Toffoli, "Conservative logic", *Int. J. Theor. Phys.* 21:219, **1982** | §1.5, the gate set |
| A. Bérut et al., "Experimental verification of Landauer's principle…", *Nature* 483:187–189, **2012** | §1.3 |
| Y. Jun, M. Gavrilov, J. Bechhoefer, "High-precision test of Landauer's principle in a feedback trap", *Phys. Rev. Lett.* 113:190601, **2014** | §1.3 |
| J. Hong, B. Lambson, S. Dhuey, J. Bokor, *Science Advances* 2:e1501492, **2016** | §1.3, the nanomagnet measurement at 1.44× the bound |
| R. Gaudenzi et al., *Nature Physics* 14:565–568, **2018** | §1.3, quantum-regime erasure |
| S. Toyabe, T. Sagawa, M. Ueda, E. Muneyuki, M. Sano, *Nature Physics* 6:988–992, **2010** | §1.6, information-to-energy conversion realised |
| N. Margolus & L. Levitin, *Physica D* 120:188–195, **1998** | §1.7, the quantum speed limit |
| H.-J. Bremermann, **1962** | §1.7 |
| J. Bekenstein, *Phys. Rev. D* 23:287, **1981** | §1.7 |
| S. Lloyd, "Ultimate physical limits to computation", *Nature* 406:1047–1054, **2000** | §1.7, the ultimate laptop |

## 11.2 Primary literature — architecture

| Source | Used for |
|---|---|
| G. Amdahl, AFIPS Spring Joint Computer Conference, **1967** | §2.5 |
| J. Gustafson, "Reevaluating Amdahl's law", *CACM* 31(5):532, **1988** | §2.5 |
| W. Wulf & S. McKee, "Hitting the memory wall", *ACM SIGARCH CAN* 23(1):20–24, **1995** | §2.2 |
| R. Ho, K. Mai, M. Horowitz, "The future of wires", *Proc. IEEE* 89(4):490, **2001** | §2.6 |
| S. Williams, A. Waterman, D. Patterson, "Roofline: an insightful visual performance model…", *CACM* 52(4):65, **2009** | §2.2 |
| R. Hameed et al., "Understanding sources of inefficiency in general-purpose chips", ISCA, **2010** | §3.1, the 500× gap and its decomposition |
| H. Esmaeilzadeh et al., "Dark silicon and the end of multicore scaling", ISCA, **2011** | §2.3 |
| I. Kuon & J. Rose, "Measuring the gap between FPGAs and ASICs", *IEEE TCAD* 26(2):203, **2007** | §3.1, the 35×/4×/14× figures |
| M. Horowitz, "Computing's energy problem (and what we can do about it)", ISSCC plenary, **2014** | §2.4, the energy table |

## 11.3 Primary literature — quantum

| Source | Used for |
|---|---|
| R. Feynman, "Simulating physics with computers", *Int. J. Theor. Phys.* 21:467, **1982** | §4.4 |
| P. Shor, FOCS **1994**; *SIAM J. Comput.* 26:1484, **1997** | §4.2 |
| L. Grover, STOC **1996** | §4.3 |
| C. Bennett, E. Bernstein, G. Brassard, U. Vazirani, *SIAM J. Comput.* 26:1510, **1997** | §4.3, optimality of √N |
| W. Wootters & W. Zurek, *Nature* 299:802, **1982**; D. Dieks, *Phys. Lett. A* 92:271, **1982** | §4.5, no-cloning |
| P. Shor, *Phys. Rev. A* 52:R2493, **1995**; A. Steane, *Phys. Rev. Lett.* 77:793, **1996** | §4.5, the first QEC codes |
| D. Aharonov & M. Ben-Or, STOC **1997**; A. Kitaev, **1997**; E. Knill, R. Laflamme, W. Zurek, *Science* 279:342, **1998** | §4.5, the threshold theorem |
| A. Fowler, M. Mariantoni, J. Martinis, A. Cleland, "Surface codes: towards practical large-scale quantum computation", *Phys. Rev. A* 86:032324, **2012** | §4.5, the overhead model |
| J. Preskill, "Quantum computing in the NISQ era and beyond", arXiv:1801.00862, **2018** | §4.6 |
| J. McClean, S. Boixo, V. Smelyanskiy, R. Babbush, H. Neven, "Barren plateaus in quantum neural network training landscapes", *Nature Communications* 9:4812, **2018** | §4.6 |
| C. Gidney & M. Ekerå, arXiv:1905.09749 (**2019**), *Quantum* 5:433 (**2021**) | §4.2, the 20 M-qubit RSA-2048 estimate |
| C. Gidney, "How to factor 2048 bit RSA integers with less than a million noisy qubits", arXiv:2505.15917, **May 2025** | §4.2, the revised <1 M-qubit estimate |
| Google Quantum AI, "Quantum error correction below the surface code threshold", *Nature* 638:920–926, **9 December 2024** | §4.7, Willow |
| S. Bravyi et al. (IBM), "High-threshold and low-overhead fault-tolerant quantum memory", *Nature* 627:778, **March 2024** | §4.5, qLDPC "gross code" |
| E. Martín-López et al., *Nature Photonics* 6:773, **2012** | §4.2, factoring 21 |

## 11.4 Primary literature — alternatives

| Source | Used for |
|---|---|
| P. Merolla et al. (IBM), "A million spiking-neuron integrated circuit…" (TrueNorth), *Science* 345:668, **August 2014** | §5 |
| M. Davies et al. (Intel), "Loihi: a neuromorphic manycore processor with on-chip learning", *IEEE Micro* 38(1):82, **2018** | §5 |
| D. Modha et al. (IBM), "Neural inference at the frontier of energy, space, and time" (NorthPole), *Science* 382:329–335, **October 2023** | §5 |
| E. Neftci, H. Mostafa, F. Zenke, "Surrogate gradient learning in spiking neural networks", *IEEE Signal Processing Magazine* 36(6):51, **2019** | §5, the training problem |
| D. Strukov, G. Snider, D. Stewart, R. S. Williams, "The missing memristor found", *Nature* 453:80, **May 2008** | §6 |
| S. Ambrogio et al. (IBM), "An analog-AI chip for energy-efficient speech recognition and transcription", *Nature* 620:768, **August 2023** | §6, 35 M PCM devices, ~12.4 TOPS/W |
| M. Reck, A. Zeilinger, H. Bernstein, P. Bertani, *Phys. Rev. Lett.* 73:58, **1994**; W. Clements et al., *Optica* 3:1460, **2016** | §7.1, MZI meshes as arbitrary unitaries |
| L. Adleman, "Molecular computation of solutions to combinatorial problems", *Science* 266:1021, **November 1994** | §8 |
| G. Church, Y. Gao, S. Kosuri, "Next-generation digital information storage in DNA", *Science* 337:1628, **August 2012** | §8 |
| Y. Erlich & D. Zielinski, "DNA Fountain enables a robust and efficient storage architecture", *Science* 355:950, **March 2017** | §8, 215 PB/g, 85 % of Shannon capacity |

## 11.5 Pages fetched live during this research (all **2026-09-01**)

- `en.wikipedia.org/wiki/Landauer's_principle` — the value, the experiment list, the Earman/Norton/Shenker dissent
- `en.wikipedia.org/wiki/Bremermann's_limit` — 1.3563925 × 10⁵⁰ bit/s/kg, the Earth-mass example
- `en.wikipedia.org/wiki/Moore's_law` — the Krzanich/Gelsinger/Huang quotes and dates; confirmation that **no cost-per-transistor figures appear there**
- `en.wikipedia.org/wiki/Dark_silicon` — Esmaeilzadeh et al. and the 50–80 % at 8 nm projection
- `en.wikipedia.org/wiki/5_nm_process` — N5 138.2 MTr/mm², N4 143.7 MTr/mm²; confirmation that **no cost data appears there**
- `en.wikipedia.org/wiki/Willow_processor` — 105 qubits, 9 Dec 2024, 99.965 %/99.67 % fidelities, ~0.14 % logical error per cycle, the RCS claim, Quantum Echoes 22 Oct 2025
- `en.wikipedia.org/wiki/List_of_quantum_processors` — IBM Nighthawk (120 q, 5 Jan 2026), Quantinuum Helios (98 q, Nov 2025), Zuchongzhi 3.0 (105 q, 16 Dec 2024), AQT LYNX (announced for 5 May 2026)
- `en.wikipedia.org/wiki/Quantum_error_correction` — threshold estimates of 1–3 % as of 2004
- `en.wikipedia.org/wiki/Neuromorphic_computing` — BrainScaleS 864× figure, DYNAP-SE, Neurogrid
- `en.wikipedia.org/wiki/Intel_Loihi` — Loihi/Loihi 2 specs, Hala Point (1 152 chips, 1.15 B neurons, 2 600 W, 20 POPS)
- `en.wikipedia.org/wiki/SpiNNaker` — 1 036 800 cores, ~100 kW, million-core milestone 14 Oct 2018, SpiNNaker 2 operational 2025

## 11.6 Executed live

`https://godbolt.org/api/compiler/g152/compile` (GCC 15.2, `executorRequest: true`), six programs,
all output transcribed in §10.6.

---

# 12. What could not be verified

Stated explicitly, because a chapter about resisting hype has no business hiding its own gaps.

## 12.1 A structural limitation on this document

**The web-search budget for this session was exhausted before research began**, so this document
was built from direct page fetches (§11.5) plus prior knowledge with a **May 2026 cutoff**.
Consequences:

- **Anything published after roughly mid-2026 is absent rather than considered.** In a field
  where the quantum hardware numbers move quarterly, this is a real limitation. The §4.7 table
  should be re-checked before teaching.
- Several claims below are from recall rather than from a source consulted today. They are
  flagged individually.

## 12.2 Numbers taken from recall, not verified today

- **Horowitz's ISSCC 2014 energy table** (§2.4). The figures (0.1 pJ int add, 0.9 pJ FP add,
  5 pJ SRAM, 640 pJ DRAM at 45 nm) are quoted from memory of an extremely widely reproduced
  slide. They are almost certainly right to within the precision used here, and every conclusion
  in §2.4 and §9 survives a 2× error in any of them, **but the primary slide was not consulted.**
- **The 0.2 pF/mm global-interconnect capacitance** used to derive wire energy (§2.4). This is a
  representative order-of-magnitude figure for repeated global wiring, not a datasheet number for
  any process. The derived 82 pJ per 64-bit word per 10 mm should be read as "tens of pJ", not as
  a precise value.
- **Per-node capacitance and V_dd figures** in the §1.4 ratio table. These are representative,
  not vendor data. The *ratios* (10⁴ today, 10⁸ in 1990) are robust to a factor of several in
  either input; the specific aJ values are not.
- **Kuon & Rose's exact multipliers** (35× area, 3.4–4.6× delay, 14× dynamic power) and
  **Hameed et al.'s 500×** — recalled from the papers, not re-read today.
- **NorthPole's 25×/22×/5× claims** (§5) — from the *Science* abstract as recalled. Note these are
  the authors' own comparisons against baselines they chose.
- **Ambrogio et al.'s 12.4 TOPS/W and 35 M PCM devices** (§6) — recalled.
- **Erlich & Zielinski's 215 PB/g and 85 % of capacity** (§8), and **Church's 5.5 Pb/mm³** —
  recalled.
- **The Microsoft/UW "HELLO in 21 hours" automated DNA store-retrieve** (§8) — recalled; the
  underlying publication is *Nature Scientific Reports* 9:4998 (2019), not re-checked.
- **T₁/T₂ ranges, gate times, and dilution-refrigerator power figures** (§4.5, §4.7) — these are
  ranges from general familiarity with the literature, not from a specific measured device.

## 12.3 Claims I could not source and have deliberately hedged

- **Cost per transistor by node.** §2.1 says the shape of the curve is well attested and the
  specific dollar figures are not sourceable here. Wikipedia's Moore's law article contains none
  (verified by fetch). The IBS charts everyone reproduces are proprietary and undocumented. **The
  wafer prices (~$10k N7, ~$17k N5, ~$20k N3, ~$30k N2) and NRE figures ($50 M at 28 nm rising to
  $650 M–1 B at 3 nm) in §2.1 are trade-press figures from recall and should be treated as
  order-of-magnitude only.**
- **TSMC SRAM bitcell areas** (§2.1, "0.021 µm² at both N5 and N3"). Recalled from conference
  disclosures. The *qualitative* claim — SRAM scaling has nearly stopped — is well attested; the
  exact number is not verified.
- **EUV scanner prices** (~$150–200 M NXE, ~$350–400 M High-NA EXE) — trade press, from recall.
- **ADCs consuming 50–85 % of energy in analog crossbar accelerators** (§6). This range comes from
  multiple architecture papers (ISAAC and successors) and is the consensus in that literature,
  but no single citation was verified today. **The qualitative claim — that converters dominate —
  is not in dispute among people who build these.**
- **SpiNNcloud's ~5 M core / ~10 B neuron targets** (§5) — vendor claim, and a target rather than
  a shipped measurement.
- **Nvidia's "3.5× power efficiency" for Quantum-X/Spectrum-X Photonics** (§7.2) — a vendor claim
  from a GTC keynote (March 2025), not an independent measurement.
- **Loihi 2's process node.** Intel described it as built on "Intel 4" (pre-production); the
  Wikipedia page fetched today lists Intel 3 for Hala Point. **These may be describing different
  things (chip vs system generation) or one may be wrong. Not resolved.**
- **IBM Heron R2's 2-qubit fidelity.** The fetched page lists "96.5 (2 qubits)", which is
  implausibly low for a 2024 Heron device and is likely a different metric (or an error in the
  source). **Flagged rather than reported as fidelity.**

## 12.4 Claims that are contested, and are marked as such in the text

- **Google's "Quantum Echoes" verifiable-advantage claim (22 October 2025)** and its ~13 000×
  figure. This document has **not** assessed the classical-simulation baseline. Given that every
  prior random-circuit-sampling advantage claim has been substantially eroded by better classical
  algorithms within 1–3 years, expect this one to be challenged. **Do not teach it as settled.**
- **Willow's "10²⁵ years for a classical supercomputer" RCS figure.** This is an estimate of
  classical difficulty for a task with no application, produced by the same group claiming the
  advantage. Historical precedent (Sycamore's "10 000 years" → ~2.5 days → hours) says treat with
  scepticism.
- **Microsoft's Majorana 1 (February 2025).** Publicly disputed by multiple groups; a
  predecessor result from the same programme was retracted in 2021. Reported here as contested.
- **Landauer's principle itself** has persistent philosophical critics (Earman & Norton, Shenker).
  The experiments settle the practical question; the derivations remain argued over.

## 12.5 Things that will go stale fastest

Ranked, so a future maintainer knows where to look first:

1. **§4.7's quantum hardware table.** Assume it is wrong within six months. Qubit counts,
   fidelities and roadmap milestones all move.
2. **§4.2's Shor resource estimate.** It fell 20× between 2019 and 2025 through theory alone.
   Expect it to keep falling.
3. **§7.2's co-packaged optics products.** Actively shipping and iterating.
4. **§2.2's roofline ridge points.** Every accelerator generation pushes them right.
5. **§2.1's cost figures.** Node economics change with capacity, geopolitics and demand.

**What will not go stale:** §1 (physics), §2.4–2.6 (`CV²`, wire scaling, `c`), §2.5 (arithmetic),
§3.1's structural argument, §4.1's interference framing, and §9. Those are the parts worth
teaching as permanent, and they are deliberately the parts this document spends the most words
on.
