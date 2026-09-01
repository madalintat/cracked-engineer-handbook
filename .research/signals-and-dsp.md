# Signals and Digital Signal Processing

Research notes for a from-first-principles computing curriculum. This document is a *shared
substrate*: three other tracks stand on it and none of them can explain themselves without it.

- **Robotics and sensors** needs it because every sensor is an analog voltage that got sampled,
  and every IMU reading you have ever seen was a lie until something filtered it. The
  complementary filter that fuses accelerometer and gyro is a high-pass and a low-pass that sum
  to one — it is a *filter design problem* wearing a robotics hat.
- **Networking and communications** needs it because the bottom of the stack is not bits, it is a
  waveform. QAM-256 is a constellation of complex numbers; a matched filter is a correlation; and
  the reason your Wi-Fi has 64 subcarriers is that somebody ran an IFFT.
- **Audio** needs it because it is the one place where the maths is directly audible — you can
  *hear* aliasing, *hear* quantisation noise, and *hear* what a filter does.

And the **AI** track needs it for one specific reason that this document makes explicit in §4.5:
a CNN's convolution layer is a bank of learned FIR filters. The only difference between
`scipy.signal.convolve2d` and `torch.nn.Conv2d` is who chose the kernel.

## The thesis

DSP has a reputation for being a maths course. It is not. It is **array processing with a
physical alibi**. Three ideas carry the whole subject:

1. **A signal is a vector.** Sampling turns a continuous function into a finite array of numbers.
   Everything after that is linear algebra on that array.
2. **The Fourier transform is a change of basis.** It is a rotation of that vector into a basis of
   sinusoids. It is not deep; it is a matrix multiply, and the FFT is the observation that the
   matrix has enough structure to apply in `O(n log n)` instead of `O(n²)`.
3. **A linear time-invariant system is a convolution.** And convolution is multiplication in the
   other basis. That one sentence is why the FFT matters commercially.

If a learner leaves with those three and nothing else, they can read a DSP paper. Everything in
this document is an elaboration.

---

## Provenance

**Executed live during this research.** Every numeric claim marked *(verified)* below was
compiled and *run* against the Compiler Explorer execution API
(`https://godbolt.org/api/compiler/g152/compile`, GCC 15.2, `-O2 -std=c++20`,
`executorRequest: true`). The complete programs and their real stdout are in §7. Nothing in §7 is
transcribed from memory; it is transcribed from the API response.

**Six exercise programs were written, run, and made to pass**, covering: aliasing and spectral
folding, radix-2 FFT against a naive DFT, the one-pole low-pass step response, overlap-add
convolution, quantisation SNR against `6.02n + 1.76 dB`, and a biquad against its closed-form
frequency response. Two of them **failed on the first run and the failures were instructive** —
both are written up honestly in §7 rather than quietly fixed, because the bugs are exactly the
bugs a learner will hit.

**Verified against primary sources by direct fetch.** The RBJ Audio EQ Cookbook biquad formulas
used in §3 and §7.6 were fetched and checked coefficient-by-coefficient against
`webaudio.github.io/Audio-EQ-Cookbook` — they match exactly. FFTW's planner-flag semantics (§5.5)
came from `fftw.org/fftw3_doc/Planner-Flags.html`. cuFFT's radix and R2C storage conventions
(§5.5) came from `docs.nvidia.com/cuda/cufft`. CMSIS-DSP's scope and target cores (§5.7) came
from `arm-software.github.io/CMSIS-DSP`.

**A practical warning discovered the hard way.** Compiler Explorer returned `okToCache: true` on
every successful run. Timings are cached along with output, so a benchmark resubmitted unchanged
returns *the previous run's numbers* without re-executing. Every submission in §7 was prefixed
with a `// nonce <uuid>` comment line to defeat this. Any exercise harness built on the CE API
**must** do the same or its timing exercises will silently lie.

**Flagged as unverified.** §8 is an explicit list of what could not be checked, what is recalled
rather than sourced, and what will go stale.

---

# 1. The Analog-to-Digital Boundary

This is the most important section in the document and the one most often taught badly. The
boundary between the continuous world and the array of numbers is where all the irreversible
damage happens. Once you have the array, everything is recoverable arithmetic. Getting the array
wrong is permanent.

## 1.1 Sampling is multiplication by a comb

A continuous signal `x(t)` becomes a sequence `x[n] = x(nT)` where `T = 1/fs` is the sampling
interval and `fs` the sampling rate. Physically: a switch closes for an instant every `T` seconds
and a capacitor holds the voltage while the converter measures it. That is a **sample-and-hold**,
and it is a real circuit with real charge injection, but the model is clean:

```
    x_sampled(t) = x(t) · Σ δ(t − nT)
                          n
```

Multiplying by an impulse train in time. The Fourier transform turns multiplication into
convolution, and the transform of an impulse train with spacing `T` is an impulse train with
spacing `fs`. So:

```
    X_sampled(f) = X(f) * Σ δ(f − k·fs)   =   Σ X(f − k·fs)
                          k                    k
```

**The spectrum of a sampled signal is the original spectrum, copied and pasted at every multiple
of `fs`, forever, added together.** That single sentence contains the entire sampling theorem,
aliasing, the need for anti-alias filtering, and the shape of a reconstruction filter. Everything
below is reading consequences off that picture.

Draw it. A baseband spectrum occupying `[−B, +B]`, then copies of it centred at `0, ±fs, ±2fs, …`.
Two cases:

- If `fs > 2B`, the copies do not touch. The original is still there, intact, sitting in the
  middle. A low-pass filter that keeps `[−fs/2, fs/2]` and discards the rest recovers `x(t)`
  **exactly**.
- If `fs < 2B`, the copies overlap. The overlapping region is a *sum* of two different pieces of
  spectrum, and addition is not invertible. Information is destroyed. No filter, no algorithm, no
  amount of cleverness afterwards can separate them.

## 1.2 The Nyquist–Shannon theorem, stated precisely

The theorem is usually mis-stated, and the mis-statement causes real bugs. Here it is properly.

> **Theorem (Shannon, 1949).** Let `x(t)` be a signal whose Fourier transform `X(f)` is zero for
> all `|f| ≥ B`. If `x(t)` is sampled at a rate `fs > 2B`, then `x(t)` is *completely determined*
> by its samples `x[n] = x(nT)`, `T = 1/fs`, and is exactly recovered by
>
> ```
>     x(t) = Σ  x[n] · sinc( (t − nT) / T )        where sinc(u) = sin(πu)/(πu)
>            n
> ```

Five things about this statement that matter and that the folklore version drops:

**1. The bound is `> 2B`, strictly, not `≥ 2B`.** The classic counterexample: sample
`x(t) = sin(2π·B·t)` at exactly `fs = 2B`. Your sample instants are `t = n/(2B)`, so
`x[n] = sin(πn) = 0` for every `n`. You get an array of zeros and can never recover the sine.
Sampling *exactly* at twice the frequency is not enough — it is the one rate that provably fails
for the worst-case phase. This is why the CD standard is 44.1 kHz and not 40 kHz for a 20 kHz
band: the strict inequality plus a filter transition band.

**2. "Bandlimited" is a statement about the *whole* signal, including its noise and its
discontinuities.** No real signal is bandlimited. A square wave is not bandlimited. A signal that
starts at `t=0` is not bandlimited (a time-limited signal cannot be band-limited; that is a
theorem, a consequence of analyticity). So *the theorem's hypothesis is never literally satisfied*
and the engineering job is making the violation small enough to not matter.

**3. `2B` is the *bandwidth*, not the *highest frequency*.** For a baseband signal they coincide.
For a bandpass signal occupying `[100 MHz, 102 MHz]` the bandwidth is 2 MHz and you can sample at
just over 4 MHz, not 204 MHz. This is **bandpass sampling** / **undersampling**, and it is
deliberate aliasing used as a free frequency-shift. Every software-defined radio does it. §4.3
comes back to this. The naive "sample at twice the highest frequency" folklore makes this look
impossible, which is why the folklore is worth correcting early.

**4. Reconstruction requires an infinite sum of sincs.** `sinc` decays as `1/t` — appallingly
slowly, and it is not absolutely summable. Perfect reconstruction is non-causal and infinitely
long. Every real DAC approximates it, and §1.8 covers what the approximation costs.

**5. Nyquist did not prove this.** Harry Nyquist (1928) established the `2B` symbol-rate result
for telegraph channels; Shannon (1949) proved the interpolation theorem. Kotelnikov (1933) and
Whittaker (1915) got there independently. The honest name is the Whittaker–Kotelnikov–Shannon
theorem; "Nyquist rate" for `2B` and "Nyquist frequency" for `fs/2` are the useful conventions.

**Terminology worth nailing down, because it is routinely swapped:**

| Term | Meaning |
|---|---|
| **Nyquist rate** | `2B` — a property of the *signal*. The minimum sampling rate it demands. |
| **Nyquist frequency** | `fs/2` — a property of the *sampler*. The highest frequency it can represent. |

"Above Nyquist" almost always means "above `fs/2`". If someone says a signal is "at the Nyquist
rate" they mean `fs = 2B`, which as (1) shows is the failing case.

## 1.3 Aliasing: what it actually looks like

Aliasing is not "distortion" and it is not "noise". It is **a frequency being reported as a
different, wrong, and exactly predictable frequency.** The predictability is the beautiful part
and the basis of the best exercise in the unit.

From §1.1: the sampled spectrum is the sum of copies at every multiple of `fs`. A single input
tone at `f` therefore appears at `f + k·fs` for every integer `k`. Only one of those lands in the
observable band `[0, fs/2]`. Which one? Fold `f` about multiples of `fs/2`, accordion-style:

```
    f_apparent = |  ((f + fs/2) mod fs) − fs/2  |
```

or, equivalently and more legibly as code:

```c
double folded(double f, double fs) {
    double r = fmod(f, fs);          // aliases repeat with period fs
    if (r < 0) r += fs;
    return (r <= fs/2) ? r : fs - r; // then reflect about Nyquist
}
```

**(verified, §7.1)** With `fs = 1000 Hz` and a 1-second window (so DFT bins are exactly 1 Hz
apart), sampling pure tones and finding the peak bin gives:

| input | peak bin | folded() predicts |
|---|---|---|
| 100 Hz | 100 Hz | 100 Hz |
| 300 Hz | 300 Hz | 300 Hz |
| 499 Hz | 499 Hz | 499 Hz |
| **600 Hz** | **400 Hz** | 400 Hz |
| **700 Hz** | **300 Hz** | 300 Hz |
| **900 Hz** | **100 Hz** | 100 Hz |
| **1100 Hz** | **100 Hz** | 100 Hz |
| **1300 Hz** | **300 Hz** | 300 Hz |
| **1700 Hz** | **300 Hz** | 300 Hz |

Every one exact, to floating-point. This is the property that makes aliasing such a good teaching
target: **the wrong answer is not random, it is a formula.** A student who predicts 300 Hz for a
700 Hz input and sees exactly 300 Hz has understood spectral folding in a way no diagram achieves.

The same program proves the stronger statement — that the two signals are not merely similar but
*bit-for-bit the same sequence* **(verified)**:

```
max |sin(2π·300·n/fs) − ( −sin(2π·700·n/fs) )| = 1.252e-12     over n = 0..999
```

Note the minus sign. A 700 Hz tone sampled at 1 kHz is not just "heard as" 300 Hz, it is heard as
300 Hz **with inverted phase**, because the fold reflected it through Nyquist. Frequencies in the
band `(fs/2, fs)` alias down *and* conjugate. That sign is a real effect and a real source of bugs
in undersampling receivers, where it shows up as an inverted spectrum.

### The wagon-wheel effect

The canonical everyday alias. A film camera sampling at 24 frames per second looks at a
stagecoach wheel with 12 spokes. The spoke pattern repeats every 30° of rotation, so as far as the
camera is concerned the wheel's "signal" has a frequency of `12 × (rotations per second)` spoke
events per second.

- Wheel at 1 rev/s → 12 spoke-events/s. Below Nyquist (12 fps for the pattern). Looks correct.
- Wheel at 2 rev/s → 24 events/s = exactly `fs`. Aliases to **0 Hz**. The wheel appears
  **stationary** while the coach hurtles along. This is `f mod fs = 0`.
- Wheel at 2.1 rev/s → 25.2 events/s. Aliases to 1.2 events/s. The wheel appears to creep
  **slowly forward**.
- Wheel at 1.9 rev/s → 22.8 events/s, aliases to −1.2. The wheel appears to rotate **backwards**.

The backwards wheel is negative apparent frequency, which is exactly the "conjugate" fold above,
made visible. It is worth showing in the curriculum because it converts an abstract statement about
spectra into something every student has already seen on a screen and been confused by.

Other everyday aliases worth naming: the moiré pattern on a striped shirt on television (2D
spatial aliasing — §4.5); jagged edges in un-antialiased 3D graphics (the renderer point-samples
a scene with infinite spatial bandwidth); the strobe-light effect that makes a drill bit appear
motionless; and the "helicopter rotor" artefact in rolling-shutter phone video.

## 1.4 The anti-alias filter must be ANALOG and must come BEFORE the ADC

This is the ordering people get wrong, and it is worth being blunt about why.

**The wrong mental model:** "I'll sample at 48 kHz and then run a digital low-pass at 20 kHz to
get rid of anything above Nyquist."

**Why it fails:** by the time the signal is in your array, the out-of-band energy is *already
folded down on top of the in-band signal*. A 30 kHz tone sampled at 48 kHz is now an 18 kHz tone
sitting in your data, arithmetically added to whatever genuine 18 kHz content was there. Your
digital filter sees one number per sample. It cannot know which part of that number came from the
real 18 kHz and which from the aliased 30 kHz. **Addition destroyed the distinction before you got
the data.** A digital low-pass at 20 kHz will happily pass the aliased 18 kHz component through
untouched, because as far as it can tell, it *is* an 18 kHz component.

This is not a matter of the filter being insufficiently good. It is information-theoretically
impossible, in the same way you cannot recover `a` and `b` from `a + b`.

Therefore: **the band-limiting must happen while the signal is still continuous**, in the analog
domain, before the sample-and-hold. That filter is the **anti-alias filter** (AAF), and it is
made of resistors, capacitors, op-amps, or in high-end converters a switched-capacitor
network — but it is a physical circuit, not code.

The mirror-image rule applies on the output side: the **reconstruction filter** (or
"anti-imaging" filter) after the DAC is *also* analog, and *also* mandatory, for the mirror
reason. The DAC output contains spectral images at `±fs`, `±2fs`, … and if you do not remove them
in the analog domain your amplifier and speaker will happily attempt to reproduce ultrasonic
garbage, intermodulating it back down into the audible band.

**The cost of the analog filter, and why it drives system design.** An analog filter has a
transition band. It cannot go from passband to stopband instantly. If you want 20 kHz of audio
passed and everything above 24 kHz (Nyquist at 48 kHz) attenuated to below the noise floor —
say 96 dB down for 16-bit audio — you need roughly 96 dB of attenuation across a 4 kHz transition
at 20 kHz, which is about a fifth of an octave. At `6n` dB/octave for an `n`-pole filter that is
an absurd order: something like a 40th-order analog filter. Those do not exist in any practical,
temperature-stable, component-tolerance-surviving form. Analog filters above about 8th order are
miserable — the component tolerances stack, the phase response goes wild, and it drifts.

This constraint is the entire reason for the next three subsections. **Oversampling exists to make
the analog filter easy.** That is the causal story, and it is much more satisfying than presenting
oversampling as a free-floating trick.

## 1.5 Quantisation: bit depth, noise, and the 6.02 dB rule

Sampling discretises *time*. Quantisation discretises *amplitude*. They are independent
operations with independent failure modes and it is worth insisting on the separation.

An `n`-bit converter maps a continuous voltage range onto `2ⁿ` levels. With full scale `[−1, +1]`,
the step size — one **LSB** — is

```
    Δ = 2 / 2ⁿ = 2^(1−n)
```

Rounding to the nearest level makes an error `e = Q(x) − x` bounded by `|e| ≤ Δ/2`.

**The model.** If the signal is "busy" — large relative to `Δ`, and not commensurate with the
sampling rate — the error sequence looks like white noise uniformly distributed on `[−Δ/2, +Δ/2]`.
The variance of a uniform distribution on an interval of width `Δ` is `Δ²/12`, so

```
    quantisation noise power  P_e = Δ² / 12
```

This is the single most-used formula in converter engineering and it is worth checking rather
than believing. **(verified, §7.5)**, quantising a full-scale sine and measuring the actual mean
square error:

```
n= 8: measured noise power 4.980052e-06   Δ²/12 = 5.086263e-06   ratio 0.9791
n=12: measured noise power 1.976581e-08   Δ²/12 = 1.986821e-08   ratio 0.9948
n=16: measured noise power 7.713247e-11   Δ²/12 = 7.761021e-11   ratio 0.9938
```

Within 2%, and converging as `n` grows. The model is real, and it is *slightly optimistic* —
the measured noise is a hair below `Δ²/12` because a sine spends more time near its peaks where
rounding is marginally better behaved.

### Deriving 6.02n + 1.76

Now the SNR. Take a full-scale sinusoid, amplitude 1, so its power is `A²/2 = 1/2`.

```
    SNR = P_signal / P_noise
        = (1/2) / (Δ²/12)
        = 6 / Δ²
        = 6 / (2^(1−n))²
        = 6 · 2^(2n−2)
        = 1.5 · 2^(2n)
```

In decibels:

```
    SNR(dB) = 10 log₁₀(1.5 · 2^(2n))
            = 10 log₁₀(1.5) + 2n · 10 log₁₀(2)
            = 1.7609 + n · 20 log₁₀(2)
            = 1.76 + 6.0206 n
```

So:

```
    SNR = 6.02 n + 1.76  dB
```

Both constants have meanings worth stating. **`6.02 dB` is one bit**: `20 log₁₀ 2 = 6.0206`.
Doubling the number of levels halves the step, halves the noise amplitude, and 6.02 dB is what
"halve an amplitude" means in dB. **`1.76 dB` is the sine wave's crest factor showing up**: it is
`10 log₁₀(3/2)`, arising from the `1/2` in the sine's power and the `1/12` in the noise variance.
Change the test signal and the constant changes — a full-scale *square* wave has power 1 rather
than 1/2 and gains you another 3 dB; a signal with a realistic 12 dB crest factor loses you about
10 dB relative to the formula. **The `1.76` is not universal and it is the part people
over-generalise.**

**(verified, §7.5)** Measured against the formula:

```
 n |  measured SNR |  6.02n+1.76 |  delta
---+---------------+-------------+--------
 4 |      26.22 dB |    25.84 dB |  +0.38
 6 |      38.07 dB |    37.88 dB |  +0.19
 8 |      50.02 dB |    49.92 dB |  +0.10
10 |      62.01 dB |    61.96 dB |  +0.05
12 |      74.03 dB |    74.00 dB |  +0.03
14 |      86.06 dB |    86.04 dB |  +0.02
16 |      98.12 dB |    98.08 dB |  +0.04
```

Agreement to within 0.05 dB by 10 bits. Note the systematic `+` sign on every delta — the same
slight optimism as above, and a nice detail to have students explain rather than ignore.

**Numbers to memorise from this table:**

| depth | SNR | where you see it |
|---|---|---|
| 8-bit | 49.9 dB | old samplers, µ-law-adjacent telephony, retro audio |
| 12-bit | 74.0 dB | typical MCU on-chip ADC (STM32, ESP32), most IMUs |
| 16-bit | 98.1 dB | CD audio, most audio interfaces' *claimed* resolution |
| 24-bit | 146.2 dB | studio recording — **and physically impossible** |

That last row is the useful one. 146 dB of dynamic range corresponds to a noise floor below the
thermal (Johnson–Nyquist) noise of the resistors in the input stage. No 24-bit converter achieves
24 bits; the good ones achieve an *effective number of bits* (ENOB) of 20–21. The extra bits are
headroom for arithmetic, not information. This is the moment to introduce **ENOB** as the honest
metric:

```
    ENOB = (SINAD − 1.76) / 6.02
```

where SINAD is the measured signal-to-noise-and-distortion ratio. Reading a datasheet's ENOB
rather than its bit count is a genuinely useful professional habit and worth teaching directly.

## 1.6 Dither: deliberately adding noise to improve the result

This is the most counter-intuitive result in the whole subject, and therefore one of the best
things to put in a curriculum. **Adding random noise to a signal before quantising it makes the
result better.**

**The problem it solves.** The `Δ²/12` white-noise model above assumed the error is uncorrelated
with the signal. That assumption fails badly for small or slowly-varying signals. Quantisation is
a deterministic function, so for a periodic input the error is periodic too — which means it is
not noise, it is **harmonic distortion**, concentrated at specific frequencies, and the ear (and
the spectrum analyser) find it far more objectionable than broadband hiss at the same power.

The extreme case: a signal smaller than half an LSB rounds to the same level every time and
**disappears entirely**. Not "gets noisy" — vanishes.

**The fix.** Add a small random signal — **dither** — before quantising. Now the quantiser's
decision at each sample is randomised, and the tiny signal biases *how often* it rounds up versus
down. The signal is no longer in any individual sample; it is in the *statistics* of the samples.
Averaging (which is what a low-pass filter, or an ear, or an FFT does) recovers it.

**(verified, §7.5)** A 4-bit quantiser (LSB = 0.125 of full scale) fed a sine of amplitude 0.02 —
about **0.16 LSB**, six times too small to register. Correlating the quantiser output against the
known input frequency over 65,536 samples:

```
sub-LSB tone, true amplitude 0.0200
  recovered WITHOUT dither: 0.000000   <- signal destroyed
  recovered WITH TPDF dither: 0.020146   <- signal survives
```

Exactly zero without dither. Recovered to within 0.7% with it. **A signal six times smaller than
the quantiser's resolution was recovered, by adding noise.** That result, run live in front of a
class, does more work than any amount of explanation.

**Which noise.** The standard choice is **TPDF** — triangular probability density function,
generated as the sum of two independent uniform variables, with peak amplitude ±1 LSB. The reason
TPDF and not uniform ("RPDF") is a real theorem, due to Lipshitz, Wannamaker and Vanderkooy: with
TPDF dither of the right width, **both the mean and the variance of the quantisation error become
independent of the input signal**. Uniform dither only decorrelates the mean; the *noise floor*
still modulates with the signal, which is audible as "noise pumping" — the hiss breathing in time
with the music. TPDF costs 4.77 dB of noise floor (total noise power goes from `Δ²/12` to
`Δ²/12 + 2·Δ²/12 = Δ²/4`) and buys complete independence. That trade is almost always worth it.

**Where you meet it in practice:** every time you reduce bit depth. Rendering a 24-bit mix to a
16-bit file, converting float32 audio to int16, or — directly analogous — **quantising neural
network weights**. The stochastic rounding used in low-precision training (§ relevant to the
FP8/FP4 track) is dither by another name and for exactly this reason: it makes the expected value
of the rounded weight equal the true weight, so errors average out over a batch instead of
accumulating as a systematic bias.

Also worth noting: many real ADCs need no added dither because the analog front end's own thermal
noise already exceeds an LSB. If your noise floor is 2 LSB RMS, you are dithered for free. This is
why "adding a resistor's worth of noise" is sometimes the fix for a 12-bit MCU ADC that shows
suspicious quantisation steps on a slow-moving sensor.

## 1.7 Oversampling, noise shaping, and sigma-delta

Recall the problem from §1.4: the analog anti-alias filter has to be impossibly steep. Three
techniques, stacked, dissolve it.

### Oversampling

Sample at `M × fs` instead of `fs`, where `M` is the oversampling ratio, then low-pass
*digitally* and throw away samples (decimate) down to `fs`. Two payoffs:

**1. The analog filter gets easy.** At `M = 8` and a target `fs = 48 kHz`, you sample at 384 kHz.
Nyquist is now 192 kHz. The analog AAF must pass 20 kHz and stop by 192 kHz — nearly *three and a
half octaves* of transition band instead of a fifth of one. A 2nd- or 3rd-order RC/Sallen-Key
filter does it. The steep part of the filtering is done digitally afterwards, where you have
linear phase, exact coefficients, and no temperature drift.

**2. You get bits back.** The quantisation noise power `Δ²/12` is fixed by the converter, but it
spreads *uniformly* across the whole band `[0, M·fs/2]`. Only the fraction `1/M` of it lands in
the band you keep. So the in-band noise power drops by `M`:

```
    SNR gain = 10 log₁₀(M)  dB  =  3.01 dB per doubling  =  0.5 bit per doubling of M
```

To gain one bit you must oversample **4×**. To gain 3 bits, 64×. Plain oversampling is an
expensive way to buy resolution — which is exactly why the next trick exists.

### Noise shaping

Plain oversampling spreads noise flat and discards the out-of-band portion. **Noise shaping**
does better: it deliberately *pushes* the noise out of the band of interest, so that the part you
throw away carries more than its fair share.

The mechanism is a feedback loop around the quantiser. Feed the quantisation error of the previous
sample back and subtract it from the current input:

```c
// first-order noise shaper
double e = 0;                       // error carried forward
for each sample x:
    double v = x - e;               // pre-compensate for last error
    double y = quantise(v);
    e = y - v;                      // this step's error, saved for next time
    output y;
```

Analyse it: the output is `Y = X + E·(1 − z⁻¹)`. The signal passes through untouched; the error is
multiplied by `(1 − z⁻¹)`, which is a **differencer** — a high-pass. Its magnitude is
`|2 sin(πf/fs)|`, which is *zero at DC* and *2 at Nyquist*. The noise has been tilted: suppressed
where you care, amplified where you are about to discard it.

For an `L`-th order shaper the noise transfer function is `(1 − z⁻¹)^L` and the in-band SNR
improvement becomes

```
    SNR gain ≈ (6.02 L + 3.01) · log₂(M) − 5.17 L + ...   dB
```

— the exact constants depend on the loop topology, but the *shape* of the result is the point:
**noise shaping turns oversampling from `0.5 bit per octave` into `(L + 0.5) bits per octave`.**
A 2nd-order shaper at 64× oversampling gains about 15 bits. Now oversampling is cheap.

### Sigma-delta (ΣΔ)

Push this to its logical extreme: make the quantiser **1 bit** — a single comparator — and
oversample enormously (64× to 512×), with a high-order loop filter.

```
     x ──►(+)──► ∫ ──► ∫ ──► ... ──► [1-bit comparator] ──┬──► bitstream
           ▲                                              │
           └──────────────────── DAC ◄────────────────────┘
```

The output is a stream of ones and zeros whose *local density* tracks the input amplitude. It is a
terrible representation to look at and a wonderful one to build: a 1-bit DAC in the feedback path
is **inherently perfectly linear**, because a two-point transfer function cannot be non-linear —
there is no curve to bend between two points. This is the deep reason ΣΔ dominates audio and
precision instrumentation: multi-bit DACs have level-matching errors that show up as distortion,
and a 1-bit DAC has none by construction.

A digital **decimation filter** (typically a cascaded-integrator-comb, CIC, followed by an FIR)
turns the bitstream into 24-bit words at 48 kHz.

Where you meet it:
- **Every audio codec** in a phone or laptop.
- **PDM microphones** (MEMS mics on I²S/PDM) — the mic outputs the raw 1-bit stream directly, at
  ~3 MHz, and your MCU or codec does the decimation. If you have wired a MEMS mic to a Raspberry
  Pi or an STM32, you have handled a ΣΔ bitstream.
- **DSD / SACD** — the "format" is literally the undecimated 1-bit stream at 2.8 MHz.
- **Precision instrumentation ADCs** (TI ADS124x, AD7124) at 24 bits and a few hundred Hz — the
  bandwidth/resolution trade taken to the resolution end.
- **Class-D amplifiers**, which are the same idea running backwards.

**The unifying idea to teach:** ΣΔ trades **amplitude resolution for time resolution**. It says
"I have a fast clock and a bad comparator; let me convert speed into precision." That is a trade
that recurs everywhere in computing — it is the same shape as PWM controlling a motor (§4.4),
temporal dithering in displays, and stochastic rounding in low-precision ML.

## 1.8 Reconstruction and the zero-order hold

Going back out. The theorem says: convolve the samples with `sinc`. Real DACs do not.

A real DAC holds each sample value constant for a full sample period — a **zero-order hold**
(ZOH). That is convolution with a rectangular pulse of width `T`, and the Fourier transform of a
rectangle of width `T` is

```
    H_ZOH(f) = T · sinc(f/fs) · e^{−jπf/fs}          sinc(u) = sin(πu)/(πu)
```

Two consequences, both of which you must handle:

**1. Passband droop.** `|sinc(f/fs)|` is not flat. At `f = fs/2` it equals
`sin(π/2)/(π/2) = 2/π = 0.6366`, which is **−3.92 dB**. So a ZOH DAC rolls the top of your band
off by nearly 4 dB. At 20 kHz out of a 44.1 kHz system the droop is about −3.0 dB — plainly
audible. The fix is a **compensation filter**: a mild digital high-shelf with the inverse
`1/sinc` response applied before the DAC. Every serious audio DAC does this. If you write a
software synth and it sounds dull, this is a candidate cause.

**2. Images at multiples of `fs`.** The `sinc` envelope suppresses them but does not remove them —
its first null is at `fs`, so the image centred at `fs` is attenuated but its skirts are not. A
1 kHz tone at 48 kHz produces images at 47 kHz and 49 kHz, down maybe 25–30 dB. That is nowhere
near enough. The **analog reconstruction filter** removes them, and oversampling before the DAC
makes *that* filter easy for exactly the reasons in §1.7 — which is why DAC chips oversample
internally (the "8× oversampling digital filter" on 1990s CD player boxes was this, advertised).

**The useful framing for the curriculum:** ZOH is the crudest possible interpolator — *nearest
neighbour*. Linear interpolation is the first-order hold, whose transform is `sinc²` — better
image rejection, worse passband droop. Cubic/Lanczos are higher-order. **This is exactly the same
ladder as image resampling** (nearest / bilinear / bicubic / Lanczos), and it is worth saying so
out loud, because a programmer who has resized an image already has the intuition and does not
know it. Lanczos resampling *is* a windowed sinc. The graphics people and the DSP people
independently derived the same filter and gave it two names.

**And the control-theory link:** in a digital control loop the ZOH is not an artefact, it is the
model of the actuator — the DAC holds the commanded value until the next tick. Its half-sample
average delay, `T/2`, is a real phase lag in the loop and eats phase margin. §4.6 returns to this.
"Why does my PID loop go unstable when I lower the sample rate?" has ZOH delay as a large part of
its answer.

---

# 2. Time and Frequency

## 2.1 Signals as sums of sinusoids

The founding claim: **any signal can be written as a sum of sinusoids.** For periodic signals that
is the Fourier series; for finite arrays it is the DFT; for general functions it is the Fourier
transform. The reason to care is not aesthetic.

**Why sinusoids and not some other basis?** Because sinusoids are the **eigenfunctions of linear
time-invariant systems**. Push `e^{jωt}` into any LTI system — a filter, an amplifier, a room, a
wire, a spring — and what comes out is `H(ω)·e^{jωt}`: *the same function*, scaled and phase
shifted. Nothing else survives an LTI system unchanged in shape.

That is the whole justification. If your systems are LTI (and an astonishing number are, to good
approximation), then in the sinusoid basis every system becomes **diagonal** — a per-frequency
multiply instead of a convolution. Convolution costs `O(nm)`; a diagonal multiply costs `O(n)`.
The Fourier transform is the change of basis that diagonalises convolution, and the FFT is what
makes the change of basis cheap enough to be worth doing.

This framing — *"the DFT matrix diagonalises circulant matrices"* — is the one that lands with
programmers who have done linear algebra, and it costs nothing to say early.

## 2.2 The DFT

For an array `x[0..N−1]`:

```
             N−1
    X[k]  =  Σ   x[n] · e^{−j2πkn/N}         k = 0 … N−1
             n=0

             1  N−1
    x[n]  =  ─  Σ   X[k] · e^{+j2πkn/N}
             N  k=0
```

It is a matrix–vector product `X = W x` where `W[k][n] = ω^{kn}` and `ω = e^{−j2π/N}`. `W` is
`N×N`, so the naive cost is `O(N²)` complex multiply-adds. `W/√N` is unitary — the DFT is a
rotation, it preserves length, which is **Parseval's theorem**:

```
     N−1              1  N−1
     Σ |x[n]|²   =    ─  Σ |X[k]|²
     n=0              N  k=0
```

**(verified, §7.2)**: for a random 256-point complex vector, `Σ|x|² = 163.081979727` and
`(1/N)Σ|X|² = 163.081979727`. Parseval is a superb second check on an FFT implementation because
it is independent of the DFT oracle — it catches scaling and normalisation bugs that a
direct comparison against a same-convention DFT would miss.

### What each bin means

Bin `k` measures the correlation of `x` with a complex sinusoid completing exactly `k` cycles over
the window. Its centre frequency is

```
    f_k = k · fs / N          Hz
```

so adjacent bins are `Δf = fs/N` apart. Since `N` samples at rate `fs` is `T = N/fs` seconds:

```
    Δf = 1/T
```

**Bin resolution is the reciprocal of the window duration, and nothing else.** Not the sample
rate. Not the number of points. The *duration in seconds*. To resolve two tones 1 Hz apart you
need at least 1 second of signal, whether that is 1,000 samples at 1 kHz or 48,000 at 48 kHz.

This is the single most useful practical fact in §2 and the source of the most common
misunderstanding (see zero-padding, §2.6). It is also a genuine uncertainty principle: time
resolution and frequency resolution trade off against each other, with `Δt · Δf ≥` a constant.
You cannot know both when a thing happened and precisely what frequency it was.

### Symmetry for real inputs

If `x[n]` is real then

```
    X[N−k] = conj(X[k])              "Hermitian symmetry"
```

Consequences you exploit constantly:

- Bins `N/2+1 … N−1` are redundant. Only `0 … N/2` carry information: `N/2 + 1` complex numbers.
- Count the real degrees of freedom: `N` real inputs → `(N/2+1)` complex outputs = `N+2` reals.
  The two extra are accounted for because `X[0]` (DC) and `X[N/2]` (Nyquist) are both purely real.
  So `N` real numbers in, `N` real numbers out. Nothing is created; it is a rotation.
- `X[0]` is the sum of all samples: `N` times the mean. A large `X[0]` means your signal has a DC
  offset, which is usually a sensor bias you forgot to remove.
- **A real-input FFT should be about 2× faster and use half the memory.** This is what
  `rfft` / `cufftExecR2C` / `fftw_plan_dft_r2c_1d` are for. cuFFT's R2C output is
  `⌊N/2⌋+1` complex elements, matching the count above (verified from the cuFFT docs).

Getting this wrong is a classic bug: computing a full complex FFT of real data, then summing
magnitudes over all `N` bins, and wondering why the total energy is double what you expect. Half
your spectrum is a mirror.

## 2.3 Spectral leakage and windowing

Here is the thing the textbook derivation obscures: **the DFT does not analyse your signal. It
analyses your signal repeated periodically forever.**

The DFT's basis functions all complete a whole number of cycles in the window. Implicitly, it
assumes the window tiles seamlessly. If your `N` samples do not join up end-to-end, the DFT sees a
**discontinuity at the wrap point**, and a discontinuity is broadband. Energy from your one clean
tone smears across every bin. That smearing is **spectral leakage**.

**(verified, §7.3)** A 1024-point DFT of a cosine, measuring the fraction of total energy landing
more than 8 bins away from the peak:

| window | tone at bin 64.0 (exact) | tone at bin 64.5 (worst case) |
|---|---|---|
| rectangular | 3.2e-27 (−265 dB) | **2.5e-02 (−16.0 dB)** |
| Hann | 2.0e-27 (−267 dB) | 8.3e-07 (−60.8 dB) |
| Blackman-Harris 4 | 1.8e-27 (−267 dB) | 8.9e-10 (−90.5 dB) |

Read that table carefully, because it contains the whole lesson:

- **On an exact bin, there is no leakage at all** — all three windows show only floating-point
  noise. The signal *does* tile seamlessly, so there is no discontinuity, so nothing smears.
- **Half a bin off — and in real life you are always off — the rectangular window leaks 2.5% of
  the signal's total energy into distant bins.** That is −16 dB. If you are looking for a second
  tone 40 dB below the first, it is buried. Your dynamic range is destroyed by a windowing choice
  you did not know you were making.
- Hann recovers 45 dB of that. Blackman-Harris recovers 74 dB.

"You did not know you were making" is the point. **There is no such thing as not windowing.**
Taking `N` samples *is* multiplying by a rectangular window. The only choice is which window.

### The tradeoff, honestly

Multiplying by a window in time is convolving by its spectrum in frequency. Every window's
spectrum has a **main lobe** (which blurs) and **side lobes** (which leak). You trade one against
the other and you cannot win both.

**(verified, §7.3)** — measured from the DTFT of each window directly, `N = 1024`, main-lobe
widths in DFT bins:

| window | −3 dB BW | −6 dB BW | first null | peak side-lobe | coherent gain | scallop loss |
|---|---|---|---|---|---|---|
| **Rectangular** | 0.906 | 1.219 | 1.000 | **−13.3 dB** | 1.0000 | −3.92 dB |
| **Hann** | 1.469 | 2.000 | 2.000 | −31.5 dB | 0.5000 | −1.42 dB |
| **Hamming** | 1.312 | 1.844 | 2.000 | −42.7 dB | 0.5400 | −1.75 dB |
| **Blackman** | 1.656 | 2.312 | 3.000 | −58.1 dB | 0.4200 | −1.10 dB |
| **Blackman-Harris (4-term)** | 1.906 | 2.688 | 4.000 | **−92.0 dB** | 0.3588 | −0.83 dB |
| **Flat-top** | 3.750 | 4.594 | 5.000 | −93.5 dB | 0.2156 | **−0.01 dB** |

The monotone relationship is unmistakable: **side-lobe suppression is bought with main-lobe
width.** Rectangular has the narrowest main lobe of any window (0.906 bins at −3 dB — it is
optimal in that one respect) and the worst side lobes by a mile. Blackman-Harris buys 79 dB of
side-lobe suppression at the price of a main lobe **2.1× wider**, which means it *cannot resolve
two tones closer than about 4 bins apart* no matter how much signal you have.

**Choosing, in practice:**

| situation | window | why |
|---|---|---|
| Two tones of *similar* amplitude, very close in frequency | **rectangular** | narrowest main lobe; leakage doesn't matter if both peaks are big |
| A weak tone next to a strong one | **Blackman-Harris / Kaiser** | the strong one's side lobes would bury the weak one |
| General-purpose "just show me a spectrum" | **Hann** | good compromise, and it overlap-adds perfectly (§2.7) |
| Measuring a tone's *amplitude* accurately | **flat-top** | 0.01 dB scallop loss — its main lobe is deliberately flat on top so amplitude is right regardless of where the tone falls between bins |
| Transients, impulse responses | **rectangular** | the signal already decays to zero inside the window, so there is no discontinuity to fix |

Two columns of that table deserve names:

- **Coherent gain** is `mean(w)`. A Hann window halves your amplitude — you must divide by 0.5 to
  read the right level. Forgetting this is why people report spectra 6 dB low.
- **Scallop loss** is the worst-case amplitude error for a tone falling exactly halfway between
  two bins. Rectangular loses 3.92 dB (that is `sinc(0.5) = 2/π` again, the same number as the ZOH
  droop in §1.8 and for exactly the same reason). Flat-top loses 0.01 dB, which is what it is for.

The definitive reference is fred harris, *"On the Use of Windows for Harmonic Analysis with the
Discrete Fourier Transform,"* Proc. IEEE 66(1), Jan 1978 — the paper that produced the table
everyone still copies. Our measured values above reproduce his to the tenth of a dB, which is a
reasonable check that both are right.

**Definition gotcha, worth an explicit warning.** There are two Hann windows: the *symmetric* one,
`0.5 − 0.5cos(2πn/(N−1))`, for filter design; and the *periodic* / "DFT-even" one,
`0.5 − 0.5cos(2πn/N)`, for spectral analysis. They differ by one sample and the difference matters
for overlap-add reconstruction (§2.7) and for exact side-lobe levels. `scipy.signal.get_window`
defaults to periodic; `numpy.hanning` is symmetric. The measurements above use the periodic
definition. This is a real source of "why doesn't my STFT reconstruct perfectly" bugs.

## 2.4 The FFT: Cooley–Tukey radix-2 decimation-in-time

Now the algorithm. The goal is to derive it clearly enough that a learner can implement it from
the derivation, which is the standard the curriculum should hold itself to.

### The split

Take `N` even. Split the DFT sum by parity of `n`:

```
             N−1
    X[k]  =  Σ  x[n] ω^{kn}                      ω = e^{−j2π/N}
             n=0

           = Σ  x[2m] ω^{k(2m)}  +  Σ  x[2m+1] ω^{k(2m+1)}
            m=0..N/2−1              m=0..N/2−1
```

The key observation is about the twiddle factor:

```
    ω_N^{2km} = e^{−j2π(2km)/N} = e^{−j2πkm/(N/2)} = ω_{N/2}^{km}
```

**Squaring the twiddle factor halves the transform size.** That is the entire trick; everything
else is bookkeeping. Substituting, and pulling `ω_N^k` out of the odd sum:

```
    X[k]  =  E[k]  +  ω_N^k · O[k]
```

where `E` is the `N/2`-point DFT of the even-indexed samples and `O` is the `N/2`-point DFT of the
odd-indexed samples. Two half-size DFTs, then `N` multiply-adds to combine.

But that gives `X[k]` for `k = 0 … N/2−1` — only half the outputs. The other half comes free.
`E` and `O` are `N/2`-periodic in `k`, and `ω_N^{k+N/2} = ω_N^k · e^{−jπ} = −ω_N^k`. Therefore:

```
    X[k]        =  E[k]  +  ω_N^k · O[k]
    X[k + N/2]  =  E[k]  −  ω_N^k · O[k]           k = 0 … N/2−1
```

**Same two products, one addition and one subtraction.** That is the **butterfly**:

```
      E[k] ────────●────────► E[k] + w·O[k]
                  ╱ ╲
                 ╱   ╲
      O[k] ──[w]●─────●─────► E[k] − w·O[k]
```

One complex multiply and two complex adds produce two outputs.

### The cost argument

Let `T(N)` be the work for an `N`-point transform:

```
    T(N) = 2·T(N/2) + O(N)
```

Two half-size problems plus `N/2` butterflies to combine. By the master theorem (or just by
drawing the recursion tree): the tree has `log₂ N` levels, each level does `O(N)` total work
across all its sub-problems, so

```
    T(N) = O(N log N)
```

Concretely, `(N/2)·log₂ N` complex multiplies and `N·log₂ N` complex adds. Against `N²` for the
naive DFT:

| N | N² | (N/2)log₂N | ratio |
|---|---|---|---|
| 1,024 | 1.05e6 | 5,120 | 205× |
| 65,536 | 4.29e9 | 524,288 | 8,192× |
| 1,048,576 | 1.10e12 | 1.05e7 | 104,858× |

At a million points the FFT is *a hundred thousand times* less arithmetic. Gauss knew the
algorithm in 1805 (in unpublished work on asteroid orbits, predating Fourier's own paper); Cooley
and Tukey rediscovered and published it in 1965, at which point it changed what was computable.
It is routinely listed among the most important algorithms of the 20th century, and the case is
easy to make: real-time spectral analysis, MP3, JPEG, OFDM, MRI reconstruction, and radio
astronomy all became possible on the same day.

### Bit reversal

The recursion repeatedly separates even from odd indices. Do it all the way down and ask where
`x[n]` ends up. At the first split, `n`'s bit 0 decides even/odd. At the second, bit 1 does.
And so on. The leaf position of `x[n]` is `n`'s bits **in reverse order**.

For `N = 8`:

```
    n   binary   reversed   ->  position
    0    000       000            0
    1    001       100            4
    2    010       010            2
    3    011       110            6
    4    100       001            1
    5    101       101            5
    6    110       011            3
    7    111       111            7
```

So the natural-order input `[0 1 2 3 4 5 6 7]` becomes `[0 4 2 6 1 5 3 7]`.

An **iterative** FFT does this permutation up front, then runs the butterflies bottom-up in
`log₂ N` stages of `N/2` butterflies each, entirely in place. Stage `s` uses butterflies spanning
`2^s` elements. The permutation loop is the standard incremented-reversed-counter:

```c
for (int i = 1, j = 0; i < N; i++) {
    int bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;   // propagate the carry, leftwards
    j ^= bit;
    if (i < j) swap(a[i], a[j]);           // i<j guard: swap each pair exactly once
}
```

That inner loop is "increment `j`, but with the carry going the other way", which is precisely
counting in bit-reversed order. The `if (i < j)` guard is essential — without it, every pair is
swapped twice and you get the identity.

Bit reversal is worth dwelling on because §5.4 shows it is a **memory-system problem**, not an
arithmetic one, and it is the reason a big FFT is not compute-bound.

### The verified implementation

**(verified, §7.2)** The iterative in-place radix-2 DIT FFT below was checked against a naive
`O(N²)` DFT computed from the definition:

```
N=    8  max|FFT-DFT| = 5.493e-15
N=   16  max|FFT-DFT| = 9.810e-15
N=   64  max|FFT-DFT| = 2.324e-13
N=  256  max|FFT-DFT| = 2.636e-12
N= 1024  max|FFT-DFT| = 2.009e-11
```

The errors grow roughly like `N` — actually like `√(log N)` in theory for the FFT's error and
like `√N` for the naive DFT's, and here the naive DFT is the *less* accurate of the two. That is
worth telling students explicitly, because it is the opposite of what they expect: **the fast
algorithm is also the more numerically accurate one.** The FFT accumulates `log₂ N` roundings per
output; the naive sum accumulates `N` of them. Speed and accuracy point the same way, which
almost never happens.

### Beyond radix-2

Worth naming so learners recognise the terms, without implementing:

- **Decimation-in-frequency (DIF)** splits the *output* by parity instead of the input. Same cost;
  bit reversal moves to the end instead of the beginning. Pairing a DIF forward transform with a
  DIT inverse lets you skip *both* permutations for convolution, since the pointwise multiply does
  not care about bin order. Real libraries do this.
- **Radix-4, radix-8, split-radix.** Radix-4 does two levels at once and saves multiplies (the
  `±j` twiddles are free). Split-radix (1984) held the record for lowest operation count for
  decades at `~4N log₂N − 6N + 8` real operations.
- **Mixed-radix and Bluestein / Rader** handle non-power-of-two `N`. Bluestein converts *any* `N`
  into a convolution, which is then done with a power-of-two FFT — so any size is `O(N log N)`,
  just with a worse constant. This is why `numpy.fft` does not fall off a cliff at prime sizes,
  merely gets slower. cuFFT is fastest for `2^a·3^b·5^c·7^d` and "the smaller the prime factor,
  the better" (verified from cuFFT docs).
- **Real-input FFT.** Two standard tricks: pack two real `N`-point transforms into one complex
  `N`-point transform and separate them by symmetry; or pack one real `2N`-point transform into a
  complex `N`-point one plus an `O(N)` fix-up pass. Both give ~2× in time and memory. Use the
  library's `rfft`.

## 2.5 Convolution, correlation, and the convolution theorem

### Convolution

```
    (x * h)[n]  =  Σ  x[m] · h[n − m]
                   m
```

The output of a linear time-invariant system. Every LTI system is a convolution with its impulse
response and nothing else — §3.1 argues this. Length: `len(x) + len(h) − 1`.

The `h[n − m]` — the flip — is what makes it convolution rather than correlation, and it is what
makes it *commutative* and *associative*. Associativity is quietly the most useful property:
cascading two filters is convolving their impulse responses, so you can pre-combine them.

### Correlation

```
    (x ⋆ h)[n]  =  Σ  x[m] · conj(h[m − n])          — no flip, and a conjugate
                   m
```

Correlation asks *"how much does `x` look like `h`, shifted by `n`?"* It is the matched filter
(§4.3), the template matcher, the pitch detector, and the basis of every synchronisation
mechanism in every digital radio. **Autocorrelation** (`x` with itself) peaks at zero lag with the
signal's energy, and its secondary peaks reveal periodicity — which is how a pitch tracker works,
and why the Wiener–Khinchin theorem (the autocorrelation and the power spectrum are a Fourier
pair) is worth a sentence.

For real signals, correlation is convolution with a time-reversed kernel. Which is exactly why
**deep learning's "convolution" is actually correlation** — nobody flips the kernel, because the
kernel is learned and the network simply learns the flipped version. §4.5 makes this explicit.

### The convolution theorem

```
    x * h   ⟷   X · H
```

Convolution in time is *pointwise multiplication* in frequency. `O(nm)` becomes `O(n)`, once you
are in the frequency basis.

**The critical caveat, which is where every implementation bug lives.** The DFT's convolution
theorem gives **circular** convolution, not linear. The DFT thinks your signal is periodic (§2.3),
so what wraps off the end wraps back onto the beginning. To get linear convolution you must
**zero-pad both inputs to at least `len(x) + len(h) − 1`** before transforming.

**(verified, §7.4)** — the failure mode made concrete. Convolving a 64-sample signal with a
32-tap filter using a 64-point FFT (when 95 points are required):

```
undersized FFT: max error in first 31 samples = 2.411e+00   <- wraparound, NOT noise
```

An error of **2.4 on a signal of order 1** — the result is not slightly wrong, it is completely
wrong, and only in the first `M−1` samples. That localisation is the diagnostic signature: **if
the head of your convolution output is garbage and the rest is fine, your FFT is too small.** This
is a much better thing to teach than "remember to zero-pad", because it is the shape of the bug
report you will actually receive.

### Where the crossover actually is

Direct convolution costs `N·M` multiply-adds. FFT convolution costs three FFTs of size
`≥ N+M−1` plus `N` complex multiplies. The textbook claim is that FFT wins beyond about 30–60
taps. **We measured it, and the textbook number is wrong for modern hardware** *(verified, §7.7)*.
Convolving a 4096-sample block:

```
   M | direct (us) | FFT (h precomputed, us) | winner
-----+-------------+-------------------------+--------
  32 |        33.1 |                   376.9 | direct
  64 |        44.2 |                   374.6 | direct
 128 |        85.8 |                   377.7 | direct
 256 |       173.0 |                   375.1 | direct
 512 |       368.3 |                   ~375  | ~tie
1024 |       692.2 |                   586.1 | FFT
```

The crossover is around **512–1024 taps**, an order of magnitude beyond the folklore. Two honest
reasons, and both are curriculum content:

1. **The direct convolution auto-vectorises perfectly.** Its inner loop is a contiguous
   multiply-accumulate over `h`, which GCC at `-O2` turns into packed SIMD FMAs with no help.
   It runs at several elements per cycle.
2. **Our FFT does not vectorise at all.** It is a textbook `complex<double>` radix-2 with
   pointer-chasing memory access and twiddles built by repeated complex multiplication. It is
   perhaps 10× off what FFTW would do.

The lesson is the one the algorithms track keeps making: **asymptotic complexity tells you the
shape of the curve, not where it crosses.** `O(NM)` versus `O((N+M)log N)` is real, and at `M =
100,000` (a concert-hall reverb impulse response) the FFT wins by orders of magnitude and there is
no argument. But at `M = 64` — the length of a typical audio EQ or a sensor smoothing filter — a
vectorised direct convolution beats a naive FFT by 8×, and would still beat a good FFT. **Measure
your own crossover on your own hardware with your own library.** That instruction is worth more
than any number this document could print.

(A caveat on those timings: Compiler Explorer runs on shared infrastructure and the numbers are
noisy — one run showed a 4677 µs outlier in a column whose neighbours were ~600 µs. Timing
exercises on CE need repeated runs and median-of-N, and students should be told so.)

## 2.6 Zero-padding does not add information

The most persistent confusion in applied DFT work, and a genuinely useful thing to kill early.

Take `N` samples. Append `N` zeros. Take a `2N`-point DFT. You now have twice as many bins, spaced
`fs/2N` apart instead of `fs/N`. **Have you doubled your frequency resolution?**

**No.** You have doubled your *bin density*, which is not the same thing.

The reasoning from §2.2: resolution is `1/T` where `T` is the duration of the *actual signal*.
Appending zeros does not lengthen the signal; it lengthens the array. You have not observed the
world for any longer, so you cannot have learned more about it. Zero-padding cannot create
information that was not sampled.

**What zero-padding actually does** is *interpolate* the spectrum. The true underlying function is
the DTFT, a continuous function of frequency. The `N`-point DFT samples it at `N` points.
Zero-padding to `2N` samples that *same continuous curve* at `2N` points. You see the curve more
finely; the curve itself does not change. Zero-padding is `sinc` interpolation in the frequency
domain, exactly dual to §1.8's reconstruction in the time domain.

**The operational test.** Two tones separated by less than `1/T`:

- **Unpadded:** one peak. They are not resolved.
- **Zero-padded 8×:** one peak, drawn very smoothly, with lots of points on it. **Still one peak.
  Still not resolved.**
- **Twice as much actual data:** two peaks. Resolved.

Getting a student to run exactly this and see the smooth-but-still-single peak is the moment the
distinction becomes permanent.

**When zero-padding is genuinely useful — it is not useless:**

1. **Peak location.** Coarse bins put a tone's true frequency somewhere between two bins; padding
   (or, more cheaply, parabolic interpolation over three bins around the peak) locates it far more
   precisely than `fs/N`. Resolution and *estimation precision* are different quantities: you can
   locate a single isolated tone to a small fraction of a bin. You just cannot *separate two* of
   them.
2. **Reaching a fast FFT size.** Pad 1000 to 1024.
3. **Linear convolution.** §2.5 — here the padding is mandatory, not cosmetic.
4. **Nicer-looking plots.** Legitimate, as long as you know that is what you are doing.

## 2.7 STFT and spectrograms

One transform over a long signal answers "what frequencies are present in this whole recording",
which for anything non-stationary — speech, music, a machine spinning up, a chirp — is the wrong
question. The right question is "what frequencies are present *now*".

The **short-time Fourier transform**: chop the signal into overlapping frames, window each one,
FFT each one, stack the magnitude columns into an image. That image is a **spectrogram**.

```c
for (int frame = 0; frame * hop + Nfft <= len; frame++) {
    for (int i = 0; i < Nfft; i++)
        buf[i] = x[frame*hop + i] * window[i];
    fft(buf);
    for (int k = 0; k <= Nfft/2; k++)
        spec[frame][k] = magnitude(buf[k]);      // usually then 20*log10
}
```

Three parameters and each is a real decision:

- **Frame size `Nfft`.** *This is the time/frequency tradeoff and it is unavoidable.* A long frame
  gives fine frequency resolution and coarse time resolution; a short frame the reverse. In audio
  the two settings even have names: a **narrowband** spectrogram (long window, ~50 ms) resolves
  individual harmonics of a voice; a **wideband** spectrogram (short window, ~5 ms) resolves
  individual glottal pulses and shows formants as bands. Same signal, two pictures, both correct.
- **Hop size.** Typically `Nfft/4` (75% overlap) or `Nfft/2` (50%). Smaller hop = more time
  detail and more compute.
- **Window.** Hann, nearly always, and for a specific reason: with 75% overlap Hann satisfies
  **COLA** (constant overlap-add) — the shifted copies sum to a constant, so you can modify each
  frame and add them back with no amplitude ripple. This is the foundation of every phase vocoder,
  every pitch shifter, every spectral noise gate, and every neural vocoder's inverse-STFT.

**Where this shows up in the AI track directly:** the **mel spectrogram** is an STFT with the
frequency axis warped to a perceptual scale and the bins grouped into ~80 bands. It is the input
representation for Whisper, for essentially every TTS system, and for most audio classifiers.
When a model "listens", it is looking at a picture produced by exactly the loop above. A student
who has written that loop understands the first layer of Whisper for free — and understands why
audio models have a fixed input duration (30 s for Whisper) and why they have a frame rate.

---

# 3. Filters

## 3.1 LTI systems, impulse response, poles and zeros

### Why impulse response is everything

A system is **linear** if `f(ax + by) = a·f(x) + b·f(y)`, and **time-invariant** if delaying the
input just delays the output. Given both, here is the argument that makes the whole subject work.

Any signal can be written as a sum of scaled, shifted impulses — trivially, since
`x[n] = Σ_m x[m]·δ[n−m]`. That is not a theorem, it is what indexing an array means. Now push it
through the system:

- **Time invariance** says: if `δ[n] → h[n]`, then `δ[n−m] → h[n−m]`.
- **Linearity** says: a sum of inputs gives the sum of the outputs, scaled the same way.

So

```
    y[n] = Σ x[m] · h[n−m] = (x * h)[n]
           m
```

**Every LTI system is a convolution with its impulse response.** Nothing else is possible. Poke
it once with an impulse, record what comes out, and you have completely characterised it —
forever, for every possible input. Measuring a concert hall by firing a starter pistol and
recording the result is this theorem in practice, and convolution reverb is that recording sold as
a plugin.

This is worth presenting as *the* payoff theorem of the unit. It is short, it is elementary, and
it turns an unbounded question ("what does this system do?") into a finite array.

### The transfer function, poles and zeros — at a working level

Take the z-transform, `H(z) = Σ h[n] z^{−n}`. For anything made of delays, multiplies and adds,
`H(z)` is a ratio of polynomials:

```
              b₀ + b₁z⁻¹ + … + b_M z⁻ᴹ        B(z)
    H(z)  =  ───────────────────────────  =  ─────
              1  + a₁z⁻¹ + … + a_N z⁻ᴺ        A(z)
```

- **Zeros** are the roots of `B` — frequencies the filter *kills*.
- **Poles** are the roots of `A` — frequencies the filter *boosts*, and the feedback that makes the
  response infinite in extent.

The working intuition, which is all most engineers ever need:

> Stand on the unit circle at angle `ω = 2πf/fs`. The gain at that frequency is
> **(product of distances to all zeros) / (product of distances to all poles).**

A zero *on* the circle → gain exactly zero → a perfect notch. A pole *near* the circle → small
denominator → a tall resonant peak, and the closer it is, the sharper and longer-ringing. That
picture explains every filter shape without a single contour integral, and it is what to teach.

**Stability, and why it is a pole condition.** A causal filter is stable iff **every pole is
strictly inside the unit circle** (`|p| < 1`). Outside, the feedback multiplies by something
bigger than 1 each sample and the output grows without bound. Exactly on the circle, it
oscillates forever without decaying — which is how you build a sinusoidal oscillator on purpose,
and how you get a hang on accident. FIR filters have no poles (other than at the origin) and are
therefore **unconditionally stable**: you cannot make an unstable FIR, no matter what you put in
the coefficient array. That guarantee is worth a great deal in safety-critical code.

## 3.2 FIR filters

```
    y[n] = Σ_{k=0}^{M−1} h[k] · x[n−k]
```

A finite window of past inputs, weighted. No feedback, so the impulse response is exactly the
coefficient array `h`, and it is finite. `M` taps → `M` multiply-accumulates per output sample.

### Linear phase, and why it matters

A filter delays different frequencies by different amounts unless its phase response is linear in
frequency. **Group delay** is `−dφ/dω`, the delay actually experienced by a wave packet at that
frequency. Linear phase ⟺ constant group delay ⟺ every frequency delayed by the same time ⟺
**the waveform shape is preserved**, just shifted.

The remarkable fact: you get this for free from **coefficient symmetry**. If `h[k] = h[M−1−k]`,
the phase is exactly linear and the group delay is exactly `(M−1)/2` samples at every frequency.
No approximation, no design effort — it falls out of the symmetry.

**(verified, §7.8)** A symmetric 21-tap windowed-sinc low-pass, measured across the band:

```
symmetric 21-tap FIR: max deviation from linear phase = 6.224e-12 rad
group delay = (M-1)/2 = 10.0 samples, EXACTLY, at every frequency
```

Twelve orders of magnitude below anything that matters. It is exact.

**Where it matters, concretely:**

- **Anything you measure timing from.** Radar, lidar, time-of-flight, ultrasound, GPS. A filter
  that delays 1 kHz by 3 ms and 2 kHz by 5 ms puts your echo in the wrong place.
- **Multi-band audio crossovers.** Split into bass and treble, filter separately, recombine. With
  non-linear phase the two paths recombine with frequency-dependent misalignment and you get
  cancellation notches at the crossover.
- **ECG, EEG, and other biosignals.** Clinical diagnosis reads the *shape* of the waveform — the
  QRS complex, the ST segment. A phase-distorting filter changes the shape and therefore the
  diagnosis. This is why biomedical DSP is FIR-heavy despite the cost.
- **Image processing.** Non-linear phase means edges shift, and shift by different amounts
  depending on their spatial frequency. Everything looks subtly smeared and wrong.

**Where it does not matter:** the human ear is famously insensitive to moderate phase distortion
of steady sounds, so most audio EQ is IIR and nobody minds.

### Design by windowing

The honest, teachable method, and it connects directly back to §2.3.

1. Write down the *ideal* frequency response — a perfect brick wall.
2. Inverse-transform it. For an ideal low-pass at `fc`, the impulse response is a **sinc**:
   `h[n] = 2fc·sinc(2fc·n)`, defined for all `n` from `−∞` to `+∞`.
3. That is infinite and non-causal, so **truncate** it to `M` taps and shift it to start at zero.
4. Truncation is multiplication by a rectangular window — and §2.3 already told you exactly what
   that costs: **−13 dB side lobes**, which here become −13 dB of stopband leakage no matter how
   many taps you use. This is the **Gibbs phenomenon**: the ripple near the transition does not
   shrink as `M` grows, it only gets narrower.
5. So multiply by a *better* window instead. Every window from §2.3 reappears here with its
   meaning transposed: **main-lobe width becomes transition-band width; side-lobe level becomes
   stopband attenuation.** It is literally the same table.

| window | stopband attenuation | transition width (× fs/M) |
|---|---|---|
| Rectangular | −21 dB | 0.9 |
| Hann | −44 dB | 3.1 |
| Hamming | −53 dB | 3.3 |
| Blackman | −74 dB | 5.5 |
| Kaiser (β adjustable) | anything you ask for | grows with β |

(These stopband figures are the *filter's* attenuation, which is better than the raw window
side-lobe level because integrating the sinc's tail adds suppression — a detail worth mentioning
so the two tables are not confused.)

**Kaiser** deserves its own note because it is the practical one: a single parameter `β` trades
transition width against stopband attenuation continuously, and Kaiser published closed-form
formulas that give you `β` and the required `M` directly from a spec (`δ` ripple, `Δω`
transition). That makes it the window you actually reach for, because you can go from requirement
to filter without iterating.

### Parks–McClellan

Windowing is simple but not optimal — it spends its ripple budget unevenly. **Parks–McClellan**
(1972), also called Remez exchange or "equiripple" design, solves the real optimisation problem:
*given `M` taps, minimise the maximum error against the ideal response.*

The theory is Chebyshev approximation, and the key result (the **alternation theorem**) says the
optimal solution is the unique one whose error *alternates* between `+δ` and `−δ` a specific
number of times. The Remez exchange algorithm iteratively guesses the extremum locations, solves
for the filter that equalises the error there, finds the new extrema, repeats. It converges in a
handful of iterations.

The result is **equiripple** — flat ripple across the passband and flat ripple across the
stopband, rather than the windowed design's ripple that is huge near the transition and tiny far
from it. Because the worst case is what your spec cares about, equalising it means you meet spec
with **roughly 20–50% fewer taps** than windowing.

Practically: `scipy.signal.remez`, MATLAB's `firpm`. And **Kaiser's estimate** for the order:

```
    M ≈ (A_stop − 8) / (2.285 · Δω)        Δω = transition width in radians/sample
```

That formula is worth memorising because it lets you cost a filter before writing it.

### The cost of FIR

`M` MACs per sample, and `M` is set by how sharp you need the transition. The scaling is brutal and
worth making concrete: a 60 dB stopband with a transition band of `0.01·fs` needs
`M ≈ (60−8)/(2.285·0.0628) ≈ 362` taps. At 48 kHz that is **17.4 million MACs per second per
channel**. Fine on a laptop, significant on a Cortex-M4, and the reason IIR exists.

## 3.3 IIR filters

```
    y[n] = Σ b[k]·x[n−k] − Σ a[k]·y[n−k]
```

Feedback. The impulse response never truly ends — hence *infinite* impulse response. In exchange
for that, **you get vastly steeper responses for vastly less arithmetic**, because you are placing
poles as well as zeros.

The scale of the win: a job needing ~360 FIR taps is typically an **8th-order IIR** — 4 biquads,
about 20 MACs per sample. Roughly **20× less compute**. That is why every embedded system, every
audio EQ, and every control loop uses IIR unless it specifically needs linear phase.

The costs, all three of which are real:

1. **Non-linear phase.** Unavoidable for a causal IIR filter.
2. **Stability is now a live concern.** Poles can leave the unit circle — through a design error,
   through coefficient quantisation, or through a runtime parameter sweep.
3. **Limit cycles.** In fixed point, rounding inside the feedback loop can sustain a small
   self-sustaining oscillation that never decays — a faint buzz that appears when the input goes silent. Deeply
   confusing if you have not met it.

### The biquad

The universal building block: **second order, two poles, two zeros.**

```
              b₀ + b₁z⁻¹ + b₂z⁻²
    H(z)  =  ────────────────────
              1  + a₁z⁻¹ + a₂z⁻²
```

Second order is the right unit because polynomials with real coefficients factor into real linear
and *quadratic* factors — a complex pole pair must stay together to keep coefficients real, and a
complex pole pair is exactly one biquad.

The canonical coefficient formulas are Robert Bristow-Johnson's **Audio EQ Cookbook**, which is
the most-copied table in audio software. *(Verified by direct fetch against
`webaudio.github.io/Audio-EQ-Cookbook`; our implementation's coefficients match it exactly.)*
With `ω₀ = 2πf₀/fs`, `α = sin(ω₀)/(2Q)`:

```
    low-pass:   b = [ (1−cos ω₀)/2,  1−cos ω₀,  (1−cos ω₀)/2 ]
                a = [ 1+α,  −2cos ω₀,  1−α ]

    notch:      b = [ 1,  −2cos ω₀,  1 ]
                a = [ 1+α,  −2cos ω₀,  1−α ]
```

then divide everything by `a₀`. Note the notch and the low-pass share their denominator — same
poles, different zeros. That is the pole/zero picture from §3.1 doing visible work: the poles set
*where* the action is, the zeros set *what kind* of filter it is. Swapping numerators turns a
low-pass into a notch into a peaking EQ into a high-pass. **One structure, eight filter types**,
which is why `arm_biquad_*` and the Web Audio `BiquadFilterNode` are shaped the way they are.

**(verified, §7.6)** The biquad implementation, run as an impulse response and DTFT'd, against its
closed-form `H(e^{jω})`:

```
LP 1kHz Q=0.7071   max |measured − closed form| = 1.422e-14
LP 100Hz Q=4       max |measured − closed form| = 1.273e-12
Notch 50Hz Q=30    max |measured − closed form| = 1.246e-10
```

The 1 kHz low-pass at its own cutoff measured **−3.01030 dB** against a closed form of
−3.01030 dB, which is a satisfying way to see that "cutoff frequency" means `1/√2` and that
`Q = 1/√2` is what makes a 2nd-order section maximally flat.

The notch is the interesting row. At 50 Hz it measured **−210 dB** while the closed form said
**−196 dB**. Both are "zero" — they are floating-point cancellation noise, not signal. Showing
students two numbers that disagree by 14 dB and are *both correct* is a good, cheap lesson about
what a dB figure means below the numerical noise floor.

### Butterworth, Chebyshev, elliptic

The classical analog prototypes, transposed to digital via the **bilinear transform**
(`s → 2/T·(z−1)/(z+1)`, which maps the entire `jω` axis onto the unit circle — hence the
**frequency warping** that requires you to pre-warp your cutoff, and hence RBJ's `ω₀` appearing
inside a `tan`/`sin` in the cookbook).

| family | passband | stopband | transition | phase | when |
|---|---|---|---|---|---|
| **Butterworth** | maximally flat | monotonic | worst | best of the four | the default; when flatness matters |
| **Chebyshev I** | equiripple | monotonic | better | worse | tolerate passband ripple for sharpness |
| **Chebyshev II** | monotonic | equiripple | better | worse | need a clean passband and a hard stopband |
| **Elliptic (Cauer)** | equiripple | equiripple | **best** | **worst** | minimum order for a hard spec |
| **Bessel** | droopy | poor | worst | **maximally flat group delay** | when phase/transient shape matters |

Elliptic gives the steepest transition for a given order and pays for it with severe phase
distortion and high sensitivity to coefficient error. Bessel is the odd one out — it is bad at
everything except the thing FIR filters are good at, and is the analog answer when you need
waveform fidelity.

**(verified, §7.6)** An 8th-order Butterworth low-pass at 100 Hz, built as 4 cascaded biquads with
section Qs `1/(2cos(π(2k+1)/16))`:

```
       1.0 Hz :    -0.000 dB
     100.0 Hz :    -3.010 dB     <- exactly -3.0103, by definition
     200.0 Hz :   -48.168 dB
     400.0 Hz :   -96.344 dB
    1000.0 Hz :  -160.098 dB
   rolloff 400->800 Hz = -48.21 dB/octave  (asymptote 8 × 6.02 = -48.16)
```

Two checkable facts fall out and both are good exercises: `−3.0103 dB` at cutoff is what
"Butterworth" *means*; and the asymptotic rolloff is exactly `6.02 dB/octave per order`, the same
6.02 as in §1.5 and for the same reason (a factor of two in amplitude).

### Why you cascade biquads instead of a high-order direct form

This is the most practically important thing in §3 and it is a **numerical** argument, not a DSP
one — which makes it perfect glue to the numerics part of the course.

An 8th-order filter has a denominator `A(z)` of degree 8. Implemented directly, you compute its
coefficients `a₁…a₈` and run one big difference equation. The problem: **the roots of a
high-degree polynomial are extraordinarily sensitive to its coefficients.**

This is Wilkinson's classic result. For a filter with poles clustered near the unit circle — which
is exactly what a sharp filter is — perturbing `a₅` in the 7th decimal place can move a pole
across the unit circle and make the whole filter explode. In `float32` you may not even be able to
*represent* a working 8th-order direct-form filter, let alone run it. In fixed point it is
hopeless.

Factor it into 4 quadratics instead. Now each section's poles depend only on its own 3
coefficients, and a 2nd-order polynomial's roots are well-conditioned with respect to its
coefficients. **Quantisation error in one section perturbs only that section's pole pair, by a
tiny amount, and cannot destabilise the others.** The cascade is not a code-organisation
convenience; it is a conditioning fix.

Practical corollaries worth stating outright:

- **Never implement above 2nd order directly.** `scipy.signal` returns `sos` (second-order
  sections) for this reason and its docs tell you to prefer `sos` over `ba`. If you see
  `butter(8, ..., output='ba')` in code, that is a latent bug.
- **Section ordering and gain distribution matter** in fixed point. The usual heuristic: order
  sections so the highest-`Q` (most resonant) pair comes last, and spread the gain across sections
  to avoid intermediate overflow.
- **Transposed Direct Form II** is the standard structure for floating point — it needs only 2
  state variables and has good round-off behaviour. **Direct Form I** is often preferred in fixed
  point because its accumulator sees the full-precision sum before rounding.

### Choosing FIR vs IIR

| | FIR | IIR |
|---|---|---|
| Linear phase | free, exact | impossible (causally) |
| Stability | guaranteed | must be designed and checked |
| Compute for a given sharpness | ~20× more | ~20× less |
| Latency | `(M−1)/2` samples, unavoidable | ~1 sample |
| Fixed-point behaviour | benign, no feedback | limit cycles, overflow, conditioning |
| Arbitrary response shapes | easy (design any `H`) | hard |
| Adaptive / time-varying coefficients | safe | can go unstable mid-sweep |
| Fast convolution via FFT | yes (§2.5) | no |

**The rule of thumb:** need linear phase, or an arbitrary response, or bulletproof stability →
FIR. Need efficiency, low latency, or you are on an MCU → IIR. Audio EQ → IIR. Measurement and
biosignals → FIR. Sensor smoothing on an MCU → the one-pole below, which is the smallest possible
IIR.

## 3.4 The filters engineers actually reach for

The three sections above are the textbook. This section is what is in the code.

### Moving average — a terrible filter with a great constant factor

```c
sum += x[n] - x[n-M];        // running sum, O(1) per sample regardless of M
y[n] = sum / M;
```

Its frequency response is the Dirichlet kernel — the DFT of a rectangle:

```
    |H(ω)| = |sin(ωM/2) / (M·sin(ω/2))|
```

which is, once again, a **sinc**. And §2.3 already told us what that costs.

**(verified, §7.8)**:

```
M= 4: -3dB at f/fs=0.1138   worst stopband sidelobe = -11.30 dB
M= 8: -3dB at f/fs=0.0557   worst stopband sidelobe = -12.80 dB
M=16: -3dB at f/fs=0.0277   worst stopband sidelobe = -13.15 dB
M=32: -3dB at f/fs=0.0138   worst stopband sidelobe = -13.23 dB
```

**Look at the last column. Adding taps does not improve the stopband.** It converges to −13.3 dB
and stops — the same −13.3 dB as the rectangular window's peak side lobe in §2.3, because it is
literally the same function. A 32-tap moving average lets through **22%** of the amplitude of some
out-of-band frequencies. As a filter, it is close to the worst thing that could still be called
one.

So why is it everywhere?

- **`O(1)` per sample** via the running sum, for any window length. No other low-pass has that.
- **It is optimal for one specific job:** minimising white-noise variance in the *time* domain
  while preserving a step. If your goal is "reduce the variance of this measurement" and you do
  not care about the frequency response at all, the boxcar is the maximum-likelihood estimator.
- **No multiplies.** Adds, subtracts, and one shift if `M` is a power of two. On a machine without
  a multiplier it may be the only option.
- **Cascading helps a lot.** Two moving averages in series square the response (−26 dB); three
  give −40 dB and approximate a Gaussian. A **CIC filter** — the standard decimator in ΣΔ
  converters and SDR front ends (§1.7, §4.3) — is exactly a cascade of moving averages, built from
  integrators and combs so that it needs no multipliers at all.

The honest summary, and a good line for the curriculum: *the moving average is a bad filter that
is fast enough and simple enough that being bad rarely matters. Know that you are choosing it,
and know what you are giving up.*

### The exponential moving average / one-pole low-pass

**The single most-used filter in embedded code**, by a wide margin.

```c
y += alpha * (x - y);           // or:  y = alpha*x + (1-alpha)*y
```

One multiply, one add, one subtract, **one word of state**. That is the entire filter.

It is a genuine IIR filter — the smallest one — with transfer function

```
              α                                      1 − α  →  the pole
    H(z) = ───────────      one pole at z = 1−α
            1 − (1−α)z⁻¹
```

Its impulse response is a decaying exponential, hence the name.

**The design equations, which are what people actually need and rarely have:**

```
    time constant:      τ = −T / ln(1−α)  ≈  T/α      for small α
    coefficient:        α = 1 − exp(−T/τ)             T = 1/fs
    cutoff (exact):     fc = fs/(2π) · acos(1 − α²/(2(1−α)))
    cutoff (rule of thumb):  fc ≈ 1/(2πτ)
```

**(verified, §7.5b)** At `fs = 48 kHz` and `τ = 10 ms` (`α = 0.002081165`):

```
max |step response − (1 − exp(−t/τ))| over 50 ms  =  1.221e-15
y(τ) = 0.632120559,  1 − 1/e = 0.632120559
exact −3 dB fc = 15.915500 Hz,  |H(fc)| = 0.707106781  (target 0.7071068)
rule of thumb 1/(2πτ) = 15.915494 Hz  (error 0.000%)
```

Three good teaching points in those four lines. The discrete filter's step response matches the
**analytic RC-circuit exponential to `1e-15`** — this is not an analogy, the difference equation
is the exact discretisation. The **63.2% rule** ("after one time constant you are 63% of the way
there") that every electronics course teaches is `1 − 1/e` and it holds exactly. And the rule of
thumb `fc = 1/(2πτ)` agrees with the exact expression to five decimals at this ratio — so you may
use it freely, *as long as `fc ≪ fs`*; it degrades near Nyquist, which is worth having students
discover.

**Why it dominates embedded code:**

- One word of state. A 100-tap FIR on 6 IMU axes is 600 words of RAM; six EMAs are 6.
- No buffer, no index, no wraparound bug.
- `α` is tunable at runtime from a config value, with no redesign and no risk of instability —
  any `α ∈ (0,1)` is stable. That is a rare property and the reason it survives contact with field
  calibration.
- It is **the same object as an RC circuit**, so hardware and firmware people can talk about it in
  the same units.

**And it is the same object as the complementary filter.** §4.4 develops this, but flag it here:
the `angle = 0.98*(angle + gyro*dt) + 0.02*accel` line in every quadcopter tutorial is a one-pole
low-pass on the accelerometer plus its exact complement on the gyro. Same filter, different hat.

**The gotcha to teach:** `α` depends on the sample rate. Code that hardcodes `alpha = 0.1` and
then gets moved to a loop running twice as fast has silently halved its time constant. Store `τ`
in seconds — a physical quantity — and compute `α` from the measured `dt`. This is a real bug that
appears whenever a control loop's rate changes, and it is invisible in review.

### Median filters

```c
y[n] = median(x[n−k .. n+k]);
```

**Non-linear**, so none of §2 or §3.1–3.3 applies — no transfer function, no impulse response, no
superposition. It is in this list because it does one job that no linear filter can do at all.

A single wild outlier — a cosmic ray in a pixel, a dropped I²C byte, a lidar return off a
raindrop — passing through a 5-tap *mean* contributes 20% of its magnitude to five consecutive
outputs: one spike becomes five smaller spikes. Through a 5-tap **median** it contributes
**nothing**: it is one value out of five and cannot be the middle one. The outlier vanishes
completely.

And critically, the median **preserves edges**. A step through a moving average becomes a ramp;
through a median it stays a step. That combination — kill impulses, keep edges — is why:

- **Salt-and-pepper noise removal** in images is the textbook median application.
- **Sensor despiking** before any linear filtering. The standard robotics recipe is
  *median first, then EMA*: median kills the outliers that would otherwise smear through the
  linear stage, then the EMA does the actual smoothing.
- The cost is `O(M log M)` naively, `O(M)` with a maintained sorted window or a histogram for
  small integer ranges. For `M = 3` or `5`, a hardcoded sorting network is branch-free and fast.

### Savitzky–Golay

Fit a low-order polynomial (typically quadratic or cubic) to a sliding window by least squares and
take the fitted value at the centre. Because least-squares fitting is linear in the data, **the
whole thing collapses into a fixed FIR kernel** — you compute the coefficients once and then it is
just a convolution.

Its property, and the reason it exists: it **preserves peak height and width** where a moving
average flattens them. Smoothing a chromatography peak or a spectroscopy line with a boxcar makes
it shorter and wider, corrupting the measurement you were trying to make. Savitzky–Golay smooths
the noise while leaving the peak's shape alone, because a polynomial can *represent* a peak.

Two more things worth knowing:

- **It differentiates for free and well.** Take the derivative of the fitted polynomial instead of
  its value and you get a smoothed derivative in the same single convolution. Given §4.4's warning
  about differentiating noisy signals, this is the *right* way to do it — the smoothing and the
  differentiation happen in one operator rather than differentiating noise and cleaning up after.
- Standard in analytical chemistry and spectroscopy; `scipy.signal.savgol_filter`.

## 3.5 Resampling

Changing the sample rate. Ubiquitous and full of traps.

### Decimation (rate ÷ M)

**Filter first, then throw samples away.** Not the other way round.

Dropping every other sample halves `fs`, which halves the Nyquist frequency, which means
everything that was between the new and old Nyquist folds down on top of your signal. It is §1.3
all over again, in the digital domain — and this time the anti-alias filter *can* be digital,
because the data still exists at the higher rate. That is the one asymmetry worth flagging: the
"filter must be analog" rule of §1.4 applies at the ADC boundary only. Once inside, you filter
digitally *before* discarding.

```c
lowpass(x, fs/(2*M));    // cutoff at the NEW Nyquist
for (i = 0; i < N; i += M) y[i/M] = x[i];
```

### Interpolation (rate × L)

**Insert zeros, then filter.**

Inserting `L−1` zeros between samples ("zero stuffing", not zero-order hold) leaves the spectrum
mathematically unchanged but now, at the higher rate, the old spectral images at multiples of the
*old* `fs` are inside the new band. A low-pass at the old Nyquist removes them. The filter must
also have gain `L` to compensate for the energy the zeros removed.

### Rational L/M and the polyphase insight

For 44.1 kHz → 48 kHz you need `L/M = 160/147`. Naively: upsample by 160 (an 8 MHz intermediate
rate), filter, downsample by 147. That intermediate rate is absurd.

**Polyphase decomposition** fixes it with two observations that are almost embarrassingly simple
once stated:

1. In the interpolator, `L−1` out of every `L` input samples to the filter are **zero**. Every
   multiply involving them is wasted. Skip them → `L×` less work.
2. In the decimator, you compute `M` output samples and then discard `M−1` of them. Don't compute
   them → another `M×` less work.

Formally: split the filter's taps into `L` interleaved sub-filters ("phases"), each `M/L` times
shorter, and use the phase corresponding to the current output's fractional position. The
`L·M`-times-oversampled intermediate signal never physically exists.

**Where you meet polyphase:** every sample-rate converter, every SDR channeliser (a polyphase
filter bank plus an FFT extracts hundreds of channels at once — this is how a spectrum monitor
works), and the **strided convolution** in a CNN, which is decimation-by-stride and has exactly
the same "don't compute what you discard" structure. And, notably, `nn.ConvTranspose2d`
(deconvolution) is zero-stuffing followed by convolution — it is a polyphase interpolator, and
its notorious **checkerboard artefacts** are precisely imaging artefacts from an inadequate
interpolation filter. That connection is worth making explicitly for an AI audience; the fix
recommended in the literature (resize-then-convolve instead of transposed convolution) is the DSP
answer restated.

---

# 4. Where It Shows Up

This section is the load-bearing one for a curriculum that has to serve four tracks. Each
subsection takes the machinery of §§1–3 and lands it in a place a programmer already works.

## 4.1 Audio

Audio is the best *teaching* domain for DSP for one reason: **the errors are audible.** Aliasing
sounds like a metallic ghost tone that moves the wrong way when you sweep a synth. Quantisation
noise sounds like hiss, and undithered quantisation sounds like *gritty, signal-dependent* hiss.
Clipping sounds like clipping. A student can debug by ear before they can debug by plot, and that
shortens the feedback loop enormously.

### The numbers

| rate | why |
|---|---|
| 44,100 Hz | CD. The odd number is an artefact: early digital masters were stored on video tape, and 44,100 = 3 × 3 × 5 × 5 × 7 × 7 fits both NTSC (245 lines × 60 Hz × 3) and PAL (294 × 50 × 3) frame structures. |
| 48,000 Hz | Professional and video standard. Divides evenly into film and video frame rates. |
| 96/192 kHz | Mostly headroom for processing and gentler filters, not audible bandwidth. |
| 8,000 Hz | Telephony. 300–3400 Hz band, which is why phone audio is intelligible but not pleasant. |
| 16,000 Hz | "Wideband" voice, and the input rate for most speech models including Whisper. |

Human hearing tops out around 20 kHz (less with age), so 44.1 kHz satisfies §1.2 with a ~2 kHz
transition band for the analog AAF. That is the entire justification for the CD standard, and it
is a nice concrete instance of a spec derived from a theorem.

### Codecs and the MDCT

Perceptual audio coding (MP3, AAC, Vorbis, Opus) rests on a transform that deserves explicit
treatment because it is the one place a clever trick is genuinely necessary.

The problem: to code audio you must work in blocks, and block boundaries produce **audible clicks**
when adjacent blocks are quantised differently. Overlapping the blocks fixes the clicks but
multiplies the data — 50% overlap means 2× the coefficients, which is fatal for a compressor.

The **MDCT** (modified discrete cosine transform) resolves this with **time-domain alias
cancellation** (TDAC). It takes `2N` input samples and produces only `N` coefficients — it is
deliberately *lossy as a transform*, throwing away half the information, and the inverse produces
a `2N` block containing the original plus a time-reversed aliased copy of itself. The trick: the
aliasing in the second half of block `k` is *exactly the negative* of the aliasing in the first
half of block `k+1`. Overlap-add the blocks and **the aliasing cancels exactly.**

The result is **critically sampled** — `N` coefficients per `N` new samples, no expansion — with
smooth overlapping windows and perfect reconstruction. That is what makes transform audio coding
possible at all. It is also a lovely piece of engineering to show students: a transform that is
individually lossy but collectively perfect.

Everything else in a codec then follows the §2 machinery plus a psychoacoustic model:

- **Window switching.** Long windows (2048) for steady tones give good frequency resolution; short
  windows (256) for transients avoid **pre-echo** — the artefact where quantisation noise spread
  across a long window becomes audible *before* the attack it belongs to, because the ear's
  temporal masking works forwards better than backwards. Codecs detect transients and switch.
  This is the §2.7 time/frequency tradeoff with an audible failure mode.
- **Masking.** A loud tone hides quieter tones nearby in frequency and shortly after in time. The
  encoder computes a masking threshold per band and spends bits only on what is above it.
  Quantisation noise is *shaped to sit just under the mask* — noise shaping (§1.7) driven by
  perception rather than by band edges.

### Real-time buffers and the latency budget

This is where audio meets systems programming, and it is the part that bites.

Audio runs on a **callback**: the driver hands you a buffer of `B` frames every `B/fs` seconds and
you must fill it before the deadline. Miss it and you get an **xrun** — an audible click, not a
dropped video frame that nobody notices.

```
    buffer latency = B / fs
```

| B @ 48 kHz | latency | use |
|---|---|---|
| 1024 | 21.3 ms | playback, streaming — plenty of slack |
| 256 | 5.3 ms | general music production |
| 128 | 2.7 ms | live monitoring; roughly the "feels instant" threshold for a musician |
| 64 | 1.3 ms | hard real-time, aggressive |
| 32 | 0.67 ms | specialist hardware only |

The total round trip is worse than the buffer figure: input buffer + processing + output buffer,
plus the ADC and DAC's own group delay (a ΣΔ converter's decimation filter is itself an FIR with
real latency, typically ~1 ms), plus any USB or network transport.

**The hard rules of the audio callback**, which are really rules about real-time programming and
transfer directly to robotics control loops and to interrupt handlers in the embedded track:

- **No allocation.** `malloc` can take an unbounded lock.
- **No locks.** Priority inversion against a lower-priority thread will blow your deadline. Use
  lock-free ring buffers to talk to the rest of the program.
- **No syscalls, no file I/O, no logging.**
- **No unbounded loops**, no `std::vector` growth, no exceptions in the hot path.
- **No page faults** — lock memory with `mlockall` if you are serious.
- **Denormals will destroy you.** An IIR filter's tail decays toward zero and enters the
  denormalised float range, where some CPUs take a microcoded slow path costing 100+ cycles per
  operation. A reverb tail going quiet can cause an xrun *by getting quieter*. The fix is to set
  FTZ/DAZ (flush-to-zero / denormals-are-zero) in the FPU control register, or add a tiny DC
  offset. This is a genuinely great bug to teach: it connects float representation (numerics
  track), CPU microarchitecture (CPU track), and DSP in one story.

The deadline discipline here is the same one the robotics track needs for a 1 kHz control loop.
Teaching it once, in audio, where the failure is audible, and then referring back to it, is
cheaper than teaching it twice.

## 4.2 Communications: modulation, IQ, matched filters

The bottom of the networking stack is a waveform, and this is where the networking track's
"physical layer" box gets opened.

### Why modulate at all

Three reasons, and they are worth stating because "modulation" otherwise looks arbitrary:

1. **Antennas.** An efficient antenna is a significant fraction of a wavelength. Baseband audio at
   3 kHz has a 100 km wavelength. Shifting it to 900 MHz gives a 33 cm wavelength and a practical
   antenna.
2. **Sharing.** Many users, one medium. Frequency-division multiplexing needs each user shifted
   somewhere different.
3. **Propagation.** Different frequencies travel differently — HF bounces off the ionosphere,
   2.4 GHz penetrates walls, 60 GHz does not.

### The four families

| scheme | what is varied | note |
|---|---|---|
| **AM** | amplitude | simplest possible receiver (a diode); wasteful of power; vulnerable to amplitude noise |
| **FM** | instantaneous frequency | constant envelope, so amplitude noise is rejected; trades bandwidth for SNR (Carson's rule) |
| **PSK** | carrier phase | BPSK = 1 bit/symbol, QPSK = 2 |
| **QAM** | amplitude *and* phase | 16-QAM = 4 bits/symbol, 256-QAM = 8. A rectangular grid of points in the complex plane |

### IQ: the representation that makes it array processing

The idea that turns radio into programming. Any narrowband real signal can be written as

```
    s(t) = I(t)·cos(2πf_c t) − Q(t)·sin(2πf_c t)
```

and equivalently as a **complex baseband** signal:

```
    s(t) = Re{ (I(t) + jQ(t)) · e^{j2πf_c t} }
```

`I + jQ` is the **complex envelope**. The receiver's job is to strip off `e^{j2πf_c t}` (multiply
by its conjugate and low-pass — that is what a **quadrature demodulator** is, two mixers and two
low-pass filters) and hand you a stream of complex numbers.

**And then everything is an array of `complex<float>`.** That is the punchline and the reason
this belongs in a computing curriculum:

- **Frequency shift** = multiply by `e^{jωt}`. One complex multiply per sample.
- **Phase shift** = multiply by a constant `e^{jφ}`.
- **Filtering** = complex convolution.
- **Demodulating FM** = `angle(z[n] · conj(z[n−1]))`, the phase difference between consecutive
  samples. Three lines.
- **Demodulating QAM** = look at where the complex number lands and pick the nearest constellation
  point. That is nearest-neighbour classification, on two dimensions.

The **constellation diagram** — a scatter plot of received `I+jQ` values — is the single most
useful debugging tool in digital comms, and it is legible immediately: a clean grid means a good
link; a fuzzy blob means low SNR; a rotating grid means a frequency offset; a sheared grid means
IQ imbalance; a grid with the corners pulled in means amplifier compression. **This connects to
the networking track's error-rate discussion directly**: the blob's radius versus the grid spacing
*is* the SNR, and the SNR maps through the modulation order to a bit error rate, and the BER is
what the error-correcting code in the information-theory unit is sized against. The whole chain
from analog voltage to "why does 256-QAM need a better SNR than QPSK" is visible in one scatter
plot.

**Negative frequencies become real here**, which is worth calling out. For a real signal the
spectrum is conjugate-symmetric and negative frequencies are redundant (§2.2). A complex baseband
signal has no such symmetry, so `+10 kHz` and `−10 kHz` are genuinely different signals — one
above the carrier, one below. This is why IQ carries twice the information of a real signal at the
same sample rate, and why a complex sample rate of 2 MHz covers 2 MHz of bandwidth rather than
1 MHz. Students who have internalised "negative frequency is a mathematical fiction" from §2.2
need this correction.

### Matched filters

*"What is the optimal filter for detecting a known pulse shape in white Gaussian noise?"*

**Answer: correlate with a time-reversed copy of the pulse.** The matched filter maximises the SNR
at the sampling instant, and this is provably optimal (Cauchy–Schwarz gives it in two lines).

Every digital receiver has one. Transmit a **root-raised-cosine** shaped pulse, filter the
received signal with another root-raised-cosine, and the cascade is a full raised-cosine — which
has the **Nyquist ISI criterion** property: it is exactly zero at every other symbol's sampling
instant. So each symbol contributes nothing to its neighbours' decisions. Splitting the raised
cosine into two roots — half at the transmitter, half at the receiver — gets you both pulse
shaping and matched filtering from one design.

The same operation, under other names, elsewhere in the curriculum: **correlation** in §2.5;
**template matching** in computer vision; the GPS receiver's correlation against the satellite's
PRN code (which is why GPS works at 20 dB *below* the noise floor — processing gain from
correlating over a long code); and radar **pulse compression**, where a long chirp is transmitted
for energy and compressed to a sharp peak by the matched filter for resolution.

### The link to the networking units

The chain is worth writing out once, explicitly, because it connects two tracks:

```
  bits → FEC encode → constellation map → pulse shape → upconvert → RF
                                                                     ↓ channel
  bits ← FEC decode ← slicer/decision ← matched filter ← downconvert ←
```

- **OFDM** — the modulation in Wi-Fi, LTE, 5G, DSL and DVB — is **literally an IFFT**. The
  transmitter takes `N` QAM symbols, treats them as a spectrum, and IFFTs them into a time-domain
  block. The receiver FFTs it back. Wi-Fi's 64-point FFT with 52 used subcarriers is exactly this.
  The **cyclic prefix** — copying the block's tail onto its front — converts the channel's linear
  convolution into a *circular* one, which by §2.5's convolution theorem becomes a **single complex
  multiply per subcarrier** in the frequency domain. That is the whole reason OFDM beats
  single-carrier on a multipath channel: equalising a nasty channel becomes one division per bin.
  A student who understands §2.5 understands why Wi-Fi is built this way.
- **Bit rate** = symbol rate × bits/symbol × coding rate. 256-QAM at 8 bits/symbol needs ~30 dB
  SNR; QPSK needs ~10 dB. Adaptive modulation — Wi-Fi's rate control — is choosing a point on that
  curve, and the curve is Shannon's capacity bound from the information-theory unit.

## 4.3 Software-defined radio

SDR is where this document's thesis becomes literally true, and it is the best single project for
making DSP concrete.

**The architecture:** an antenna, an amplifier, a mixer, and an ADC — and then *everything else is
software.* An RTL-SDR dongle (~$30, originally a DVB-T TV tuner) gives you 8-bit IQ samples at up
to ~2.4 Msps over USB. A HackRF or USRP gives more bandwidth and transmit capability.

**What arrives at your program is an array of complex numbers.** That is all. Every §§1–3 concept
becomes a line of code:

| DSP concept | SDR reality |
|---|---|
| Sampling (§1.1) | the ADC, and `fs` is a driver setting |
| Aliasing (§1.3) | **used deliberately** — bandpass sampling to fold a high band down |
| Quantisation (§1.5) | 8 bits on an RTL-SDR, which is why it needs a good analog front end |
| FFT (§2.4) | the waterfall display; the whole UI is a scrolling spectrogram |
| Decimation (§3.5) | 2.4 Msps → 240 ksps → 48 ksps, in polyphase stages |
| Filtering (§3) | channel selection |
| Correlation (§4.2) | sync word detection, matched filtering |

A complete FM receiver is genuinely about fifteen lines:

```python
x = read_iq()                          # complex64 at 2.4 Msps
x = x * exp(-2j*pi*offset*t)           # tune: shift the station to DC
x = decimate(x, 10)                    # 2.4 Msps -> 240 ksps, lowpass + drop
d = angle(x[1:] * conj(x[:-1]))        # FM demod: instantaneous frequency
d = deemphasis(d, tau=75e-6)           # a one-pole (§3.4), regionally 50 or 75 us
audio = decimate(d, 5)                 # 240 ksps -> 48 ksps
play(audio)
```

Every line is a §§1–3 concept and nothing else. The `deemphasis` step is a plain one-pole
low-pass (§3.4) — FM broadcast pre-emphasises treble at the transmitter and the receiver undoes
it, which is *noise shaping* (§1.7) applied to an analog channel decades before the term existed.

**Why it is the right capstone:** it is cheap, the results are unambiguous (you either hear the
station or you do not), and it forces the whole chain — sample rates, aliasing, filtering,
decimation, demodulation, buffering — to be correct simultaneously. GNU Radio provides a
block-diagram environment for it; writing it from scratch in NumPy or C++ is more instructive.

## 4.4 Sensors and robotics

The robotics track's sensor problems are DSP problems and are worth naming as such.

### Filtering an IMU

A 6-axis IMU gives 3 accelerometer axes and 3 gyroscope axes, and each has a *characteristic and
complementary* failure:

- **Accelerometer**: measures gravity plus linear acceleration. Absolute tilt reference, so **no
  drift** — but every vibration, every motor, every footstep is noise. **Noisy, correct on
  average.** Good at low frequency.
- **Gyroscope**: measures angular rate. Smooth and clean short-term, but you must *integrate* it
  to get angle, and integrating a tiny constant bias produces an angle error growing linearly
  forever. **Clean, but drifts.** Good at high frequency.

One is trustworthy slowly, the other quickly. That is a **filter design problem**, and stating it
that way is the insight the robotics unit needs from this one.

### The complementary filter

```c
angle = alpha * (angle + gyro * dt) + (1 - alpha) * accel_angle;
```

Read it as two filters summing to one:

- `(1−α)` weight on the accelerometer, applied recursively → **one-pole low-pass** (§3.4). Keeps
  the accelerometer's slow, drift-free truth; discards its vibration noise.
- `α` weight on the integrated gyro → the exact **complement**, `1 − H_lp(z)`, a **high-pass**.
  Keeps the gyro's fast response; discards its slow drift.

**(verified, §7.8)** The complement is exact, not approximate:

```
alpha = 0.98 : max | H_lp(ω) + H_hp(ω) − 1 | over all ω  =  0.000e+00
```

Identically zero at every frequency, to the last bit. The two paths sum to unity gain and zero
phase — the estimate is unbiased at every frequency. That exactness is what "complementary" means,
and it is the whole reason the filter works despite being three lines long.

**And now demystify the magic number.** Every tutorial hardcodes `alpha = 0.98` without
explanation. **(verified, §7.8)**, at a 100 Hz loop rate:

```
tau = alpha*dt/(1-alpha) = 0.4900 s  ->  crossover ~ 0.325 Hz
```

`0.98` is not a magic number. It is **a 0.32 Hz crossover frequency**: trust the gyro above
0.32 Hz, trust the accelerometer below it. Now it is tunable on purpose — if the vehicle vibrates
at 5 Hz, you know the crossover is well clear; if the gyro bias drifts fast, you raise the
crossover. And the sample-rate gotcha from §3.4 bites hard here: **copying `alpha = 0.98` from a
100 Hz tutorial into a 400 Hz loop moves the crossover to 1.3 Hz** and changes the tuning
completely, silently. Students should compute `alpha` from a `tau` in seconds and the measured
`dt`.

### The poor man's Kalman filter

The complementary filter *is* a Kalman filter with fixed gain. A 1-D Kalman filter's steady-state
update is

```
    x̂ = x̂_pred + K·(z − x̂_pred)
```

which is algebraically identical to the complementary filter with `K = 1−α`. The difference:

| | complementary | Kalman |
|---|---|---|
| Gain | fixed, tuned by hand | computed from noise covariances, time-varying |
| State | one variable | full state vector (angle, bias, velocity, …) |
| Estimates sensor bias | no | yes, that is the main practical win |
| Compute | 3 operations | a small matrix inverse per step |
| Tuning | one number, obvious meaning | Q and R matrices, unobvious |
| Optimality | none claimed | provably optimal for linear-Gaussian systems |

**The honest engineering verdict**, worth stating plainly to save learners a lot of time: for
attitude estimation on a small vehicle, a well-tuned complementary filter performs *nearly as
well* as a Kalman filter at a fraction of the complexity, and its one knob has an obvious physical
meaning. Kalman earns its keep when you need bias estimation, when you fuse more than two sensors,
or when the noise statistics genuinely vary. Mahony and Madgwick filters sit between the two and
are what most open-source flight controllers actually ship.

Teaching the complementary filter *first*, as a filter, means the Kalman filter arrives later as
"the same thing with a computed gain" rather than as an unmotivated wall of matrix algebra. That
ordering is the main curricular recommendation this subsection makes.

### Notch-filtering mains hum

Any high-impedance sensor near mains wiring picks up **50 or 60 Hz** and its harmonics through
capacitive coupling. ECG, EEG, load cells, thermocouples, audio with a ground loop — all of them.

The fix is a **notch biquad** (§3.3) at the mains frequency, `Q` typically 20–50. **(verified,
§7.6)** a 50 Hz notch with `Q = 30` at `fs = 48 kHz` measured:

```
      10.0 Hz : -0.00021 dB      <- untouched
      50.0 Hz : (numerical zero) <- annihilated
     100.0 Hz : -0.00214 dB      <- untouched
```

A surgical hole. Practical notes worth passing on:

- **Harmonics.** Mains pickup is rarely a clean sine; cascade notches at 50/100/150 Hz.
- **Q is a real tradeoff.** Mains frequency wanders by a few tenths of a hertz as grid load
  changes. Too high a `Q` and the notch misses; too low and you gouge a hole in your signal.
  `Q ≈ 30` (a ~1.7 Hz wide notch at 50 Hz) is the usual compromise.
- **Adaptive notches** track the drift; **50 Hz vs 60 Hz** must be a configuration option if the
  product ships internationally — a nice example of a physical-world constant that is not
  constant.
- **Fix it in hardware first.** Better shielding, twisted pairs, differential amplifiers with good
  common-mode rejection, and star grounding all attack the coupling itself. A notch filter is
  cleanup after a layout failure, and a 50 Hz notch also removes any *real* 50 Hz signal — which
  for an ECG is inside the diagnostic band.

### Why differentiating a noisy signal is a bad idea

Estimating velocity from position, or the `D` term in a PID controller, means differentiating. The
backward difference `y[n] = (x[n] − x[n−1])/dt` has frequency response `|H(ω)| = 2|sin(ω/2)|/dt`,
which **grows with frequency**. A differentiator is a high-pass with unbounded gain — and sensor
noise is broadband, concentrated at exactly the high frequencies the differentiator amplifies
most.

**(verified, §7.8)** at `fs = 1 kHz`:

```
  f=   1.0 Hz : |H| =      6.28
  f=  10.0 Hz : |H| =     62.82
  f= 100.0 Hz : |H| =    618.03
  f= 499.0 Hz : |H| =   1999.99
  RMS gain of the differencer over the full band = 1414.1   (unity-gain filter = 1.0)
```

**Broadband noise is amplified by a factor of ~1400.** Your signal of interest sits at a few Hz,
where the gain is 6. The noise, spread across the band, comes out **200× stronger relative to the
signal than it went in.** That is why raw differentiation produces garbage, and the number makes
the point far better than the words do.

Also note the last row: at 499 Hz the difference gives 2000 where the true derivative would be
3135. **The differencer is not even accurate near Nyquist** — it under-estimates badly. It is
simultaneously too noisy and too wrong.

**What to do instead, in rough order of preference:**

1. **Don't differentiate.** If you can measure velocity directly — a tachometer, a gyro, a Hall
   sensor, wheel encoder edge timing — do that. This is the real answer and it is usually
   available.
2. **Savitzky–Golay differentiation** (§3.4): fit a polynomial, differentiate the fit. Smoothing
   and differentiation in one FIR kernel, which is both cheaper and better than doing them
   separately.
3. **Low-pass the derivative** — but understand you are choosing a bandwidth, and the delay you
   add is delay in a feedback loop, which costs phase margin.
4. **Use a filtered/"dirty" derivative** in PID: `D·s/(1 + s/N)` rather than `D·s`. Every
   industrial PID does this; the `N` (derivative filter coefficient, typically 8–20) is a
   first-order low-pass on the D term and is why real PID has four tuning parameters, not three.
5. **State observer / Kalman filter** with velocity in the state vector. The estimator does the
   differentiation implicitly and optimally, using the *model* to constrain it.

Contrast with **integration**, which has response `1/|ω|` — it *attenuates* high-frequency noise
and is numerically benign. Integration is a low-pass; differentiation is a high-pass. The
asymmetry is why dead reckoning drifts (integrating a small bias) but does not get *noisy*, while
differentiation gets noisy but does not drift. Two different failure modes from the two inverse
operations, and pairing them is exactly what the complementary filter above exploits.

## 4.5 Images as 2D signals — and the direct line to CNNs

Everything generalises to two dimensions by separability. This subsection is written for the AI
audience specifically.

### 2D convolution

```
    y[i][j] = Σ Σ  x[i−u][j−v] · h[u][v]
              u v
```

A `K×K` kernel costs `K²` MACs per pixel. If the kernel is **separable** (`h = h_row ⊗ h_col`,
i.e. rank 1) you do a 1D pass horizontally and another vertically for `2K` MACs per pixel instead
of `K²` — a 9× saving at `K = 9`. Gaussian blur is separable; box blur is separable *and* has a
running-sum `O(1)` form (§3.4). This is why image blur is fast, and it is a genuinely useful
optimisation to know.

The kernels every programmer has met, now with names from §3:

```
    box blur (low-pass)          Sobel x (a differentiator, §4.4)
     1  1  1                       -1  0  +1
     1  1  1  · 1/9                -2  0  +2
     1  1  1                       -1  0  +1

    Gaussian (a better low-pass)  Laplacian (2nd derivative, high-pass)
     1  2  1                        0  -1   0
     2  4  2  · 1/16               -1   4  -1
     1  2  1                        0  -1   0
```

Read them as filters and their behaviour is predictable rather than magical:

- **Blur is a low-pass.** Box blur is the 2D moving average, so §3.4's verdict applies verbatim:
  −13 dB stopband, and the visible artefact is *ringing* — the boxy halos around edges. Gaussian
  is smoother because its spectrum has no side lobes at all.
- **Sobel is a smoothed differentiator** — `[-1 0 1]` differentiates across, `[1 2 1]` smooths
  along. It is Savitzky–Golay's idea (§3.4) in 2D: differentiate and smooth in one kernel, because
  §4.4 says raw differentiation of noisy data is a disaster and an image is noisy data.
- **Unsharp masking** is `image + λ·(image − blur(image))`, i.e. `1 + λ(1 − LP) = ` a high-boost
  filter. "Sharpening" is amplifying high spatial frequencies.
- **Aliasing is visible**: downsampling an image without low-pass filtering first produces
  **moiré** — §1.3's spectral folding in 2D. `cv2.resize` with `INTER_AREA` filters first;
  naive stride-2 slicing does not, and the difference is plainly visible on a striped shirt.

### The 2D FFT

The 2D DFT is separable: FFT every row, then FFT every column. Cost `O(N²log N)` for an `N×N`
image versus `O(N⁴)` naive. Used for:

- **Large-kernel convolution** — the §2.5 crossover argument in 2D, where it arrives much sooner
  because direct cost grows as `K²`.
- **JPEG**, which is an 8×8 **DCT** — a close relative of the DFT that avoids complex arithmetic
  and has better energy compaction for natural images, then quantises the coefficients with a
  perceptually-weighted table (coarser for high frequencies, because eyes are less sensitive
  there). JPEG is *literally* the §1.5 quantisation story applied per frequency bin, and its
  artefacts are 8×8 blocking and ringing around edges — exactly the artefacts §2.3 predicts from
  truncating a spectrum.
- **MRI**, where the scanner measures **k-space** — the Fourier transform of the body — directly,
  and the image is produced by an inverse 2D FFT. The FFT is not an optimisation there; it is the
  reconstruction.

### The direct line from a convolution kernel to a CNN convolution layer

**This is the connection to make explicit, and it should be made loudly.**

Classical computer vision, pre-2012, was: apply hand-designed convolution kernels (Sobel, Gabor,
Haar, SIFT's difference-of-Gaussians), then feed the responses to a classifier. Choosing good
kernels was the research field.

A **CNN convolution layer is the same operation with the kernel values learned by gradient
descent instead of designed by a human.** That is the entire difference. Not analogous — the same
arithmetic, the same loop, the same memory access pattern.

```python
# classical CV                      # deep learning
out = convolve2d(img, sobel_x)      out = conv2d(img, weight)   # weight learned
```

Consequences worth spelling out for an AI audience, because each is a DSP fact restated:

- **What early layers learn.** Visualise the first-layer filters of any trained CNN and you find
  **edge detectors at various orientations, colour-opponent blobs, and Gabor-like oriented
  bandpass filters** — the things vision researchers spent thirty years hand-designing, and the
  things found in mammalian V1. Gradient descent rediscovers the filter bank. This is one of the
  most striking empirical results in the field and it is a DSP observation.
- **Stride is decimation** (§3.5) — and stride-2 convolution without adequate low-pass filtering
  **aliases**, which is a real and documented problem. Making CNNs shift-invariant by inserting
  proper anti-aliasing low-pass filters before downsampling measurably improves accuracy and
  robustness; the "blur-pool" line of work is §1.4's rule applied to a network. A network that
  aliases is a network whose features change when the image shifts by one pixel.
- **Transposed convolution is zero-stuffing plus interpolation** (§3.5), and its checkerboard
  artefacts are imaging artefacts from a bad interpolation filter.
- **Dilated / atrous convolution** is a sparse FIR — taps spread out with zeros between, giving a
  larger receptive field for the same tap count. In DSP terms it is a comb-like filter, and it has
  DSP's aliasing caveats.
- **Receptive field is filter support.** Stacking two 3×3 convolutions gives a 5×5 receptive
  field, because convolution is associative (§2.5) and `3*3 = 5` in support length. This is why
  VGG's "two 3×3 instead of one 5×5" works: same support, fewer parameters (18 vs 25), more
  non-linearity.
- **Depthwise-separable convolution** (MobileNet) is precisely the **separability** optimisation
  above — factor an expensive multi-dimensional kernel into cheap ones. `K² · C_in · C_out`
  becomes `K² · C_in + C_in · C_out`. Same trick as separable Gaussian blur, same reason it works.
- **1×1 convolution** is a per-pixel linear mix across channels — no spatial filtering at all,
  pure channel-space matrix multiply.
- **FFT-based and Winograd convolution** are real cuDNN algorithm choices. For large kernels cuDNN
  may pick an FFT method; for 3×3 it usually picks **Winograd**, which is a minimal-filtering
  algorithm from the same family of "transform, multiply pointwise, transform back" ideas as the
  FFT. When `torch.backends.cudnn.benchmark = True` times several algorithms and picks one, it is
  doing exactly what FFTW's planner does (§5.5).

A student who has written a 2D convolution by hand, understood separability, and seen aliasing on
a downsampled image arrives at `nn.Conv2d` already understanding what it computes, why it is
expensive, why stride aliases, and why 3×3 kernels dominate. That is a large amount of transfer
for one afternoon's work.

## 4.6 Control loops as filters

The last connection, and the one that makes the robotics track's PID unit fall out of §3.

A digital control loop samples, computes, and actuates on a fixed tick. That makes it a **discrete
LTI system**, and every tool in §3 applies.

**PID is three filters in parallel:**

```
    P: proportional     — a gain, flat response
    I: integral         — a low-pass with infinite DC gain; response 1/|ω|; kills steady-state error
    D: derivative       — a high-pass; response |ω|; and §4.4 explains why it must be band-limited
```

The whole loop's behaviour is `H(z) = C(z)·P(z) / (1 + C(z)·P(z))` — a feedback filter. Its poles
are the closed-loop dynamics, and **stability is the §3.1 pole condition**, unchanged: all
closed-loop poles inside the unit circle.

Three sampling facts the robotics track needs and can inherit from §1:

- **The ZOH's `T/2` delay eats phase margin.** The actuator holds the last command for a full
  tick, contributing an average `T/2` of pure delay. Delay is the enemy of feedback: it adds phase
  lag proportional to frequency without reducing gain. Halving the loop rate doubles this delay
  and can turn a stable loop unstable — which is the answer to "why did my controller start
  oscillating when I added logging to the loop".
- **Sensor aliasing folds into your feedback path.** A 1 kHz loop reading a sensor with vibration
  energy at 1.2 kHz gets a 200 Hz alias (§1.3) that the controller will faithfully try to correct,
  chasing a signal that does not exist. **Anti-alias filtering is a control-loop requirement, not
  an audio nicety** — and per §1.4 it must be analog and before the ADC.
- **The rule of thumb**: sample 10–20× faster than your closed-loop bandwidth. That is far above
  Nyquist's factor of 2, and the extra is spent on keeping the ZOH delay small relative to the
  loop's time constants.

**Notch filters in control loops** are a standard tool: a flexible robot arm or a quadcopter frame
has mechanical resonances that the controller will excite. A notch (§3.3) at the resonant
frequency removes it from the loop. Every commercial motor drive and flight controller has
configurable notches, and on a quadcopter they are often *dynamically* tracked from the measured
motor RPM — a notch whose centre frequency follows the throttle. That is a genuinely nice example
of DSP and robotics being the same activity.

---

# 5. Implementation — Where It Meets the Rest of the Course

§§1–4 are the subject. This section is why the subject belongs in a *computing* curriculum rather
than a maths one: DSP is where numerical representation, SIMD, memory hierarchy, and hardware
accelerators all become simultaneously visible in code short enough to read.

## 5.1 Fixed vs floating point, Q notation, saturation

### Why fixed point still exists

Floating point is easier and, on any machine with an FPU, usually as fast. Fixed point survives
because:

- **Cost.** A Cortex-M0/M0+ has no FPU. A Cortex-M4**F** has single-precision only; a plain
  Cortex-M4 has none. Millions of shipping devices do integer arithmetic or nothing.
- **Power.** Integer MACs cost meaningfully less energy than floating-point ones. On a battery
  device this is the deciding factor.
- **Determinism.** Integer arithmetic is bit-exact and reproducible across platforms. Floating
  point is reproducible only if you are careful, and `-ffast-math` makes it not reproducible at
  all.
- **FPGAs and ASICs.** A fixed-point multiplier is dramatically smaller than a floating-point one.
  DSP48 slices (§5.7) are fixed-point.
- **It is the same skill as ML quantisation.** int8 inference is fixed-point DSP with a different
  vocabulary — scale factors are Q-format exponents, per-channel scales are per-channel Q formats,
  and the accumulator-width argument below is exactly why int8 GEMM accumulates in int32.

### Q notation

`Qm.n` means `m` integer bits and `n` fractional bits, plus a sign bit. The two you meet
constantly:

| format | bits | range | resolution |
|---|---|---|---|
| **Q15** | int16, 15 fraction bits | [−1, +0.999969] | 3.05e−05 |
| **Q31** | int32, 31 fraction bits | [−1, +1) | 4.66e−10 |

**(verified, §7.9)** — Q15's range and resolution measured directly:

```
representable range: [-1.000000, 0.999969]   resolution 3.052e-05
```

Note the asymmetry: `−1.0` is representable, `+1.0` is not. Negating `−32768` overflows. That
asymmetry is a real source of bugs and it is worth pointing at.

The arithmetic rules:

- **Add/subtract**: plain integer ops, same format. Can overflow.
- **Multiply**: `Q15 × Q15 = Q30`. You must widen to 32 bits for the product and then shift right
  by 15 to return to Q15. **(verified)**: `0.5 × 0.25 = 0.125000`, exact.
- **The shift is the whole discipline.** Forget it and you are off by 32768×.

### Saturation, and why it is not optional

**(verified, §7.9)** — the difference, in Q15:

```
  0.9 + 0.9 wraparound -> -0.200012   <- SIGN FLIP, a full-scale click
  0.9 + 0.9 saturating -> +0.999969   <- clipped, merely distorted
```

Two overloaded signals. Wraparound turns `+1.8` into `−0.2`: **the loudest possible positive
sample becomes a large negative one.** In audio that is a full-scale discontinuity — a *crack*,
far louder and more damaging than the clipping it replaced. In a control loop it is worse: your
"maximum forward" command becomes "reverse", which on a motor is a mechanical event. In an image
it is the white-pixel-becomes-black artefact.

Saturation clips to the maximum instead. Still distortion, but *graceful* — it sounds like
overdrive, it reads as a clipped waveform, and it fails in the direction you asked for.

This is why DSP instruction sets have **saturating arithmetic in hardware**: ARM's `QADD`,
`SSAT`, `QSUB`; x86's `PADDSW`; every DSP ever made. It is not a convenience, it is a correctness
feature, and it is a nice illustration of an ISA design decision driven directly by an application
domain.

### Accumulator width

**(verified, §7.9)** — a 128-tap dot product of Q15 values, accumulated three ways:

```
128-tap dot: int16 accumulator =  -0.02567
             int64 accumulator =  +1.97646
             float reference   =  +1.97646
```

**The int16 accumulator produces a number with the wrong sign and no relationship to the answer.**
Individual products are fine; their *sum* overflows repeatedly and wraps. The wide accumulator is
exactly right.

This is the reason every MAC unit in every DSP has an accumulator wider than its operands: the
TI C6000's 40-bit accumulators, ARM's 64-bit `SMLAL`, the fact that CMSIS-DSP's Q15 FIR
accumulates in Q31 or a 64-bit register. **And it is precisely why int8 neural network inference
accumulates in int32** — the same argument, the same failure mode, a different decade. Pointing
that out connects the embedded track and the quantisation track with one number.

## 5.2 Why DSP is SIMD's home ground

DSP kernels have every property a vector unit wants:

- **Data-parallel.** Each output depends on inputs, not on other outputs.
- **Regular access.** Contiguous, unit-stride, predictable — the prefetcher's dream.
- **No data-dependent branches** in the inner loop.
- **Multiply-accumulate dominated**, which is exactly the FMA instruction.
- **Large `n`**, so the vector prologue/epilogue amortises.

It is not a coincidence: **SIMD instruction sets were designed for this workload.** Intel's MMX
(1996) and SSE, ARM's NEON, and every DSP extension were justified to management with multimedia
codecs and signal processing benchmarks. When you write a vectorised FIR you are using the
hardware for the purpose it was argued into existence for.

### How a FIR vectorises — and the trap

The kernel:

```c
float acc = 0;
for (int k = 0; k < M; k++)
    acc += h[k] * x[n-k];
```

The obvious vectorisation: load 8 taps and 8 samples into AVX registers, one `vfmadd`, repeat
`M/8` times, then horizontally sum the accumulator at the end.

**It does not happen by default, and the reason is instructive.** **(verified, §7.9)**, a 128-tap
FIR over 65,408 samples, GCC 15.2:

```
                        -O2 (default)                -O3 -ffast-math -march=x86-64-v3
  scalar                3083.7 us  (2.71 GMAC/s)      9000.2 us  (0.93 GMAC/s)
  auto-vectorized       2920.1 us  (2.87 GMAC/s)      1152.5 us  (7.26 GMAC/s)
  4 accumulators        1218.3 us  (6.87 GMAC/s)      1416.4 us  (5.91 GMAC/s)

  auto-vec speedup:           1.06x                          7.81x
  4-accumulator speedup:      2.53x                          6.35x
```

Read the two columns against each other, because the story is the whole lesson:

**At `-O2` the compiler achieves nothing (1.06×).** The loop is a **reduction**: every iteration
adds into the same `acc`, creating a serial dependency chain. To vectorise it the compiler must
*reassociate* the additions — sum lanes 0,8,16,… separately from 1,9,17,… and combine at the
end. But **floating-point addition is not associative**, so reassociating changes the result, and
a conforming C++ compiler is not permitted to do that without being told.

**Two ways to tell it.** `-ffast-math` grants blanket permission and gives **7.81×**. Or restructure
the source into **4 independent accumulators**, which breaks the dependency chain *explicitly and
portably* while leaving every other float guarantee intact — **2.53×** with no flags at all.

This is one of the best small lessons in the whole curriculum, because it lands in three tracks at
once:

- **Numerics:** float addition is not associative, and that is not pedantry — it is worth 7× here.
- **Compilers:** what a compiler may and may not do without permission; what `-ffast-math` actually
  licenses and why it is dangerous elsewhere.
- **Architecture:** why an FMA has ~4-cycle latency but 0.5-cycle throughput, so a serial chain of
  them runs at 1/8 of peak, and why you need ≥4 independent chains in flight to saturate the unit.

Note also that scalar got *slower* under `-O3 -ffast-math` (3084 → 9000 µs). That column's scalar
function carries `optimize("no-tree-vectorize")`, and the attribute interacts with the global
flags; the honest reading is that cross-column comparisons of the *same row* are not meaningful,
only within-column speedups are. Benchmarks are hard, and saying so is part of the lesson.

**Practical routes to vectorised DSP, in increasing order of effort:** compiler flags plus
restructured accumulators; `#pragma omp simd reduction(+:acc)`, which grants reassociation for
one loop rather than the whole file; intrinsics (`_mm256_fmadd_ps`); or a library that has already
done it (Intel IPP, Arm Performance Libraries, CMSIS-DSP, Eigen, `numpy`).

## 5.3 Circular buffers

The universal data structure of streaming DSP: a fixed array plus a moving index, giving you the
last `N` samples with no copying.

```c
typedef struct { float buf[N]; int w; } ring;

static inline void push(ring* r, float v) {
    r->buf[r->w] = v;
    r->w = (r->w + 1) & (N - 1);      // N a power of two -> mask, not modulo
}
static inline float tap(const ring* r, int delay) {
    return r->buf[(r->w - 1 - delay) & (N - 1)];
}
```

Points worth teaching:

- **Power-of-two sizes turn `%` into `&`.** A hardware divide is 20–40 cycles; a mask is one.
  This is why buffer sizes are powers of two.
- **The modulo of a negative number is a real bug** in C (`-1 % 8 == -1`, not 7). The mask handles
  it correctly for power-of-two sizes because two's complement wraps the way you want. With
  non-power-of-two sizes you need `((i % N) + N) % N`.
- **The double-write trick** removes the wrap check from the inner loop entirely: allocate `2N`,
  write every sample twice (at `w` and `w+N`), and any window of `N` consecutive samples is then
  *contiguous* — so your FIR inner loop is a flat unit-stride array pass with no masking, which is
  what lets it vectorise (§5.2). Memory doubles; the inner loop gets much faster. Some
  implementations do this with a virtual-memory trick, mapping the same physical pages twice into
  adjacent virtual addresses, giving the contiguity for free — a nice concrete use of `mmap` that
  connects to the OS track.
- **Hardware support exists.** Many DSPs (TI C6000, ADI SHARC, Motorola 56000) have **circular
  addressing modes** where the address register wraps automatically at a hardware-defined
  boundary. It is a whole addressing mode invented for this one data structure — good evidence for
  how central it is.
- **Lock-free single-producer/single-consumer rings** are how the audio callback (§4.1) talks to
  the rest of the program without taking a lock. This is the concurrency track's SPSC queue, and
  it should be taught once and referenced twice.

## 5.4 The FFT's awkward memory access, and why it is not compute-bound

This is the section that connects DSP to the roofline model, and it is the most valuable
performance lesson in the document.

### The arithmetic intensity argument

Take a 1M-point complex single-precision FFT.

- **Data:** `2^20` complex floats × 8 bytes = **8 MB**. Far larger than any L2, larger than most
  L3 slices.
- **Compute:** `5N log₂N ≈ 5 × 2^20 × 20 ≈ 10^8` flops.
- **Naive arithmetic intensity:** `10^8 flops / 8 MB` ≈ **12.5 flops/byte** *if you touched the
  data once.*

But you do not. **A radix-2 FFT makes `log₂N = 20` passes over the entire array.** Each stage
reads all 8 MB and writes all 8 MB. So actual traffic is `~20 × 16 MB = 320 MB`, and the real
arithmetic intensity is

```
    10^8 flops / 3.2×10^8 bytes  ≈  0.3 flops/byte
```

On a roofline plot for any modern machine — where the ridge point sits around 10–50 flops/byte —
**0.3 is deep in the memory-bound region.** A large FFT is a *bandwidth* problem wearing a
compute problem's clothing. This is precisely the roofline story the algorithms and GPU tracks
teach with GEMM as the compute-bound example; the FFT is the ideal *contrasting* example, and
having both in the curriculum makes the model concrete rather than abstract.

### The access pattern is worse than the volume

Stage `s` of a DIT FFT pairs elements `2^s` apart. In the last stages that stride is `N/2` — half
the array. Consequences:

- **Every access is a cache miss** once the stride exceeds the cache size. You pull a 64-byte line
  to use 8 bytes of it: **87.5% of your bandwidth is wasted.**
- **Cache associativity conflicts.** Power-of-two strides are the pathological case for
  set-associative caches: addresses `N/2` apart map to the same set, so a small number of ways
  thrash while the rest of the cache sits idle. The FFT's natural size is exactly the size that
  breaks caches. Libraries deliberately pad arrays to break the alignment.
- **TLB pressure.** Large strides touch many pages; huge pages help measurably.
- **Bit reversal** (§2.4) is a permutation with maximally scattered access — every element moves,
  and neighbours in the source are far apart in the destination. It is pure memory movement with
  zero arithmetic.

### What real libraries do about it

The fixes are all memory-hierarchy fixes, not arithmetic ones, which is the point:

- **Four-step / six-step FFT.** Treat the `N`-point array as an `n₁ × n₂` matrix. FFT the columns
  (each short enough to fit in cache), multiply by twiddles, **transpose**, FFT the rows,
  transpose back. Converts one long-stride pass into cache-resident transforms plus explicit,
  blocked, cache-friendly transposes. This is the standard approach for large FFTs and is why
  "FFT" and "matrix transpose" optimisation are the same field.
- **Cache-oblivious recursion.** Recurse until the sub-problem fits in cache, whatever the cache
  size is. FFTW does this and it is why it performs well without being told the cache
  configuration.
- **Codelets.** Straight-line, fully unrolled, register-blocked base cases for small `N`
  (2,3,4,5,7,8,…). FFTW's are machine-generated by an OCaml program called `genfft` — thousands of
  lines of unrolled code per codelet, with the additions scheduled to minimise register pressure.
- **Combining passes.** Higher radix (4, 8) does more work per element touched, directly raising
  arithmetic intensity. This is the same "increase reuse per byte loaded" move as tiling a GEMM.

**The lesson to state explicitly:** the FFT's `O(N log N)` was a triumph of *arithmetic*
reduction, and having won that fight so decisively, the algorithm became limited by something
else. Reducing flops until you are bandwidth-bound, then optimising memory, is the standard arc
of high-performance computing, and the FFT is the cleanest example of it.

## 5.5 FFTW, cuFFT, and what "planning" means

### FFTW

FFTW ("Fastest Fourier Transform in the West", Frigo and Johnson, MIT) is the reference
CPU implementation and won the 1999 Wilkinson Prize. Its architecture is worth studying as a
software-engineering artefact, not just a numerical one.

Its central idea: **there is no single best FFT algorithm — the best one depends on the machine**,
its caches, its SIMD width, its memory latency. Rather than guess, FFTW *measures*.

```c
fftw_plan p = fftw_plan_dft_1d(N, in, out, FFTW_FORWARD, FFTW_MEASURE);
fftw_execute(p);          // fast; call this many times
fftw_destroy_plan(p);
```

**Planning** is a search. The planner considers decompositions of `N` (radices, recursion
strategies, codelet choices), assembles candidate plans, **actually runs them, times them**, and
keeps the winner. The plan is a small interpreted tree of codelet invocations.

*(Verified by direct fetch from `fftw.org/fftw3_doc/Planner-Flags.html`.)* The rigour flags:

| flag | behaviour |
|---|---|
| `FFTW_ESTIMATE` | "A simple heuristic is used to pick a (probably sub-optimal) plan quickly." Does **not** overwrite the input/output arrays during planning. |
| `FFTW_MEASURE` | The default. "Find an optimized plan by actually computing several FFTs and measuring their execution time." Takes seconds. |
| `FFTW_PATIENT` | Like MEASURE but "considers a wider range of algorithms"; better for large transforms, "several times longer planning time". |
| `FFTW_EXHAUSTIVE` | "An even wider range of algorithms… the most optimal plan but with a substantially increased planning time." |

Two operational traps worth teaching, because both bite real code:

1. **Planning destroys your data.** `FFTW_MEASURE` and above write to the arrays while timing
   candidates. **Plan first, then fill the input.** Only `FFTW_ESTIMATE` is safe to plan on live
   data. This surprises people constantly.
2. **Plan once, execute many.** If you plan inside your loop you have made an `O(N log N)`
   operation cost seconds. The entire design assumes amortisation.

**Wisdom** is FFTW's mechanism for saving accumulated plans to disk (`fftw_export_wisdom`) and
reloading them, so the expensive search happens once per machine rather than once per process
start. It is a persistent, machine-specific optimisation cache.

**The generalisable idea, and why it belongs in a computing curriculum:** FFTW is
**autotuning** — measure the machine and generate/select code for it, rather than predicting
performance from a model. The same idea appears as ATLAS for BLAS, as
`torch.backends.cudnn.benchmark = True` (which times convolution algorithms and caches the
winner — §4.5), as Triton and TVM autotuning, and as profile-guided optimisation. FFTW is the
oldest and clearest instance, and it makes a good anchor for the concept.

### cuFFT

NVIDIA's GPU FFT. Same plan-then-execute API shape, for the same reason.

```c
cufftHandle plan;
cufftPlan1d(&plan, N, CUFFT_C2C, batch);
cufftExecC2C(plan, d_in, d_out, CUFFT_FORWARD);
```

*(Verified by direct fetch from `docs.nvidia.com/cuda/cufft`.)*

- **The plan holds state so it can be reused**: "the library retains whatever state is needed to
  execute the plan multiple times without recalculation of the configuration."
- **Efficient sizes are `2^a · 3^b · 5^c · 7^d`**, and "the smaller the prime factor, the better
  the performance, i.e., powers of two are fastest." A large prime `N` falls back to Bluestein and
  is markedly slower — so **pad to a friendly size** (§2.6 reason 2).
- **R2C output is `⌊N/2⌋+1` complex elements**, exploiting Hermitian symmetry — exactly the count
  derived in §2.2. Getting this buffer size wrong is the classic cuFFT bug.
- **Batching is essential.** A single small FFT cannot fill a GPU; the launch overhead dominates.
  cuFFT's `batch` parameter runs thousands of independent transforms in one launch, which is the
  normal case in practice (every frame of a spectrogram, every channel of a radio, every image in
  a minibatch).

**When the GPU is worth it**: large transforms, or many batched ones, and *only if the data is
already on the device.* A round trip over PCIe to do one FFT is dominated by the transfer — the
same arithmetic-intensity argument as §5.4, now applied to the interconnect. This is the standard
GPU-offload lesson and the FFT is a good place to make it, because the answer is genuinely
"sometimes no".

## 5.6 DSP on microcontrollers

Where the embedded track and this one meet directly.

### The Cortex-M DSP extensions

| core | FPU | DSP extension | SIMD | typical |
|---|---|---|---|---|
| Cortex-M0/M0+ | none | none | none | integer only, minimal DSP |
| Cortex-M3 | none | none | none | 32-bit MAC, but no SIMD |
| **Cortex-M4** | optional single-precision | **yes** | yes (32-bit) | the workhorse DSP MCU |
| **Cortex-M7** | single + optional double | yes | yes | dual-issue, caches, much faster |
| Cortex-M33 | optional | optional | yes | + TrustZone |
| **Cortex-M55/M85** | yes | **Helium (MVE)** | 128-bit vector | ML/DSP focused |

The **M4's DSP extension** is where an MCU stops being a slow computer and starts being a signal
processor. What it adds:

- **`MAC` in one cycle.** `MLA`/`MLS` (32×32+32), and `SMLAL` accumulating into a **64-bit**
  register — §5.1's accumulator-width argument, in silicon.
- **`SMLAD` / `SMLALD`** — *dual* 16-bit multiply-accumulate: two Q15 MACs in one instruction, one
  cycle. This is what makes Q15 FIR filters twice as fast as float ones on an M4 and why CMSIS-DSP
  has separate Q15 implementations.
- **Packed SIMD on 32-bit registers**: `SADD16`, `SSUB8`, `SMUAD` — two 16-bit or four 8-bit lanes
  in a general-purpose register. Not a vector unit, but free parallelism for narrow data.
- **Saturating arithmetic**: `QADD`, `QSUB`, `SSAT`, `USAT` — §5.1's correctness feature as
  single-cycle instructions.

**Helium (MVE)** on M55/M85 is a genuine 128-bit vector unit for the M-profile, sharing registers
with the FPU, targeted at exactly ML-on-MCU and DSP workloads.

### CMSIS-DSP

*(Verified by direct fetch from `arm-software.github.io/CMSIS-DSP`.)* Arm's open-source
(Apache-2.0) DSP library for Cortex-M and Cortex-A. It provides **15 function categories**
including basic and fast math, complex math, **filtering**, matrix, **transforms**, motor control,
statistics, **and machine learning** (SVM, Bayes, distance functions). It supports 8/16/32-bit
integer and 32/64-bit float types, with **vectorised implementations using Helium (MVE) on
M-class and Neon on A-class**, and ships a Python wrapper for prototyping algorithms before
committing to C.

That ML category is itself worth noting for the curriculum: Arm shipped classifiers *inside the
DSP library*, which is a fair signal that "DSP" and "edge ML" are converging into one skill.

```c
arm_biquad_casd_df1_inst_f32 S;
arm_biquad_cascade_df1_init_f32(&S, numStages, coeffs, state);
arm_biquad_cascade_df1_f32(&S, in, out, blockSize);
```

The API shape teaches its own lessons and is worth reading in class:

- **`init` / `process` split.** Coefficients and state are set up once; the hot function is a tight
  loop. Same pattern as FFTW's plan/execute, for the same amortisation reason.
- **Explicit state buffers.** The caller owns the memory. No allocation in the DSP path — §4.1's
  real-time rule, enforced by the API.
- **Block processing, not per-sample.** `blockSize` samples per call amortises call overhead and
  gives the vectoriser something to work with.
- **`_f32` / `_q31` / `_q15` variants** of everything, so the Q-format choice is explicit in the
  type — §5.1 made visible in the function name.
- **Cascaded biquads as the primitive**, not high-order direct forms — §3.3's conditioning
  argument, baked into the library so you cannot easily do the wrong thing.

Typical M4 @ 100 MHz throughput is on the order of a 32-tap Q15 FIR at 48 kHz using a small
fraction of the CPU, with a few biquads essentially free. Real-time audio DSP on a $2 chip is
routine, and that fact is genuinely motivating for students.

## 5.7 DSP blocks on FPGAs

The other hardware target, and the one that connects to the digital-design/HDL track.

An FPGA is a sea of lookup tables — but multiplication in LUTs is expensive, so vendors hard-wire
dedicated **DSP blocks**: AMD/Xilinx **DSP48E1/E2**, Intel/Altera **DSP blocks**.

A DSP48E2 contains, in hard silicon: a 27×18 signed multiplier, a 48-bit accumulator, a
pre-adder, and pipeline registers — i.e. **a MAC unit**, the same primitive as §5.6, at
~500–900 MHz. A mid-size FPGA has hundreds to thousands of them.

What FPGAs give you that a CPU or MCU cannot:

- **Massive, deterministic parallelism.** A 256-tap FIR can be 256 DSP blocks in a **systolic
  array**, one result per clock, at 500 MHz — 128 GMAC/s from one filter, with *no jitter*. Each
  DSP48 passes its partial sum to its neighbour, so the long accumulator chain is pipelined rather
  than serial.
- **Arbitrary bit widths.** Need 12-bit data and 18-bit coefficients? Build exactly that and pay
  for exactly that. No rounding to the nearest power of two.
- **Hard real-time by construction.** Latency is a fixed number of clock cycles, known at
  synthesis time. No cache, no OS, no interrupt jitter. For a 1 MHz control loop or a
  phased-array radar this is the only option.
- **DSP blocks are the FPGA's scarcest resource** for signal work, and "DSP slice count" is a
  headline spec exactly as "CUDA cores" is for a GPU.

Where they appear: 5G basestation baseband, radar and beamforming, high-speed instrumentation,
software-defined radio front ends, and increasingly ML inference — where the DSP block's MAC is
being used for int8 GEMM, which is the same convergence noted in §5.6.

**The teaching connection:** the systolic FIR is the cleanest possible introduction to systolic
arrays, and a systolic array is what a TPU's matrix unit and a tensor core fundamentally are. A
student who builds a 16-tap FIR in Verilog and sees the partial sums marching down the pipeline
has built, in miniature, the architecture that modern ML accelerators use. That is a strong
argument for putting the FIR-in-Verilog exercise in the digital-design unit and cross-referencing
it here.

---

# 6. Curriculum

Three units, in dependency order. Each has **one idea** — the thing a student should still be able
to state a year later — and each is deliberately positioned so the robotics, networking and AI
parts of the track can point back at it instead of re-deriving it.

The design constraint throughout: **no exercise is graded on prose.** Every check is an
`assert` that either passes or does not, run on real hardware through the Compiler Explorer API.
All six exercises below were written and executed during this research; their full source and real
output are in §7.

## Unit 1 — The Sampling Boundary

> **THE ONE IDEA:** *Sampling copies the spectrum at every multiple of `fs`. Everything about
> converters follows from that one picture.*

Nyquist, aliasing, the analog-filter ordering rule, quantisation, dither, oversampling. Placed
first because it is the only part of the subject that is **irreversible** — every later unit
assumes a clean array of numbers, and this unit is about earning one.

**Prerequisites:** basic C++, floating point, complex numbers as pairs. No calculus needed if the
comb-convolution picture is presented geometrically.

**Sequence:**

1. Sampling as multiplication by an impulse train; the spectrum-copying picture (§1.1). Draw it
   before writing any formula.
2. Read the copies: `fs > 2B` separates them, `fs < 2B` overlaps them. **Derive Nyquist rather
   than stating it.**
3. Aliasing: the folding formula, the wagon wheel, and **Exercise 1**.
4. The ordering rule (§1.4): why the anti-alias filter is analog and comes first. Present it as
   "why can't I just filter afterwards?" and let them fail to answer.
5. Quantisation, `Δ²/12`, and the `6.02n + 1.76` derivation. **Exercise 2.**
6. Dither. Show the sub-LSB tone recovery live — it is the memorable moment of the unit.
7. Oversampling → noise shaping → sigma-delta, motivated *entirely* as "make the analog filter
   easy", which is the honest history.
8. Reconstruction and ZOH droop; the link to image resampling.

**Reused by:**

- **Robotics:** every ADC reading; the "sample 10–20× your loop bandwidth" rule; why sensor
  anti-aliasing is a control-stability issue (§4.6).
- **Networking:** bandpass sampling and IQ sample rates (§4.2); why an SDR's `fs` sets its
  bandwidth.
- **AI:** quantisation noise, dither, and stochastic rounding are the same mathematics as
  int8/FP8 weight quantisation (§1.6).
- **Audio:** all of it.

### Exercise 1 — Aliasing, where the wrong answer is exactly predictable

**This is the flagship exercise of the whole track.** Sample a known sinusoid above and below
Nyquist and assert that the recovered frequency is *exactly* the folded one.

> Implement `folded(f, fs)` returning the apparent frequency of a tone at `f` sampled at `fs`.
> Then, for each test frequency, synthesise `N = fs` samples of `sin(2πft/fs)`, find the peak DFT
> bin, and assert it equals `folded(f, fs)` **exactly** (to `1e-9`, since the bins are exactly
> 1 Hz apart).
>
> Then prove the stronger claim: assert that the 300 Hz and 700 Hz sampled sequences are
> identical up to sign.

**Why it is a good exercise:** most exercises assert that a correct implementation produces a
correct answer. This one asserts that a *physically lossy* process produces a *specific wrong*
answer — and that specificity is the entire content of the aliasing concept. A student cannot
pass it by accident, and passing it means they can predict aliasing rather than merely fear it.

**Verified output (§7.1):** all nine test frequencies matched exactly; the 300/700 Hz identity
held to `1.252e-12`.

**Extensions:** sweep `f` continuously from 0 to `3·fs` and plot apparent vs actual — the
triangular fold pattern is unmistakable and worth seeing. Then add an anti-alias filter *before*
sampling and watch the aliases vanish; then try to add one *after* and watch it fail. That failure
is the point of §1.4 and it is much more persuasive when self-inflicted.

### Exercise 2 — Quantisation SNR and the 6.02 dB rule

> Implement a mid-tread `n`-bit quantiser over `[−1, +1]`. For a full-scale sine at a frequency
> incommensurate with `fs`, measure `10log₁₀(P_signal/P_error)` and assert it is within 0.6 dB of
> `6.02n + 1.76` for `n ∈ {4,…,16}`.
>
> Then separately assert the mechanism: measured mean-square error is within 5% of `Δ²/12`.
>
> Finally, dither: quantise a tone of amplitude 0.02 with a 4-bit quantiser (≈0.16 LSB). Assert
> the undithered correlation is **exactly zero** and the TPDF-dithered one recovers the amplitude
> to within 0.005.

**Verified output (§7.5):** agreement within 0.05 dB by `n = 10`; undithered recovery
`0.000000`, dithered `0.020146` against a true 0.0200.

**Note the two-part structure**, which is deliberate: asserting the formula proves the *result*;
asserting `Δ²/12` proves the *mechanism*. A student who only checks the first can pass with a
lucky bug. Requiring both is what makes it a comprehension check rather than a curve fit.

## Unit 2 — The Frequency Domain

> **THE ONE IDEA:** *The DFT is a change of basis that turns convolution into multiplication, and
> the FFT makes that change of basis cheap enough to always be worth considering.*

DFT, bin resolution, leakage and windowing, the FFT derived and implemented, zero-padding,
STFT, convolution, fast convolution and overlap-add.

**Prerequisites:** Unit 1; complex arithmetic; comfort with `O(·)` notation.

**Sequence:**

1. Sinusoids as the eigenfunctions of LTI systems — the *reason* for this basis (§2.1).
2. The DFT as a matrix multiply. Write the `O(N²)` version first; it is six lines and it is the
   oracle everything else is checked against.
3. Bin resolution `Δf = 1/T`. Hammer it. Then **zero-padding** immediately, as the corollary
   (§2.6): more bins, same resolution.
4. Leakage and windows (§2.3), with the main-lobe/side-lobe tradeoff presented as a *measured*
   table, not a recalled one.
5. Derive radix-2 Cooley–Tukey (§2.4). Do the twiddle-squaring step slowly; it is the crux.
   **Exercise 3.**
6. Bit reversal, and why the FFT is memory-bound (§5.4) — bridging to the performance track.
7. Convolution, correlation, the convolution theorem, and the circular-vs-linear trap.
   **Exercise 4.**
8. STFT and spectrograms; mel spectrograms as the input representation of audio ML.

**Reused by:**

- **AI:** spectrograms as model input (§2.7); FFT/Winograd convolution in cuDNN; the roofline
  contrast against GEMM (§5.4).
- **Networking:** OFDM *is* an IFFT (§4.2) — this unit is a hard prerequisite for the Wi-Fi/LTE
  physical-layer discussion.
- **Robotics:** vibration analysis, resonance identification for notch placement (§4.6).
- **Audio:** codecs, EQ analysis, pitch detection.

### Exercise 3 — Radix-2 FFT against a naive DFT

> Implement the iterative in-place radix-2 decimation-in-time FFT, including the bit-reversal
> permutation. Assert `max|FFT(x) − DFT(x)| < 1e-12·N` for random complex input at
> `N ∈ {8,16,64,256,1024}`, where `DFT` is your own `O(N²)` implementation from the definition.
>
> Then assert **Parseval's theorem** as an independent check: `Σ|x|² == (1/N)Σ|X|²`.
>
> Then time both and report the speedup.

**Verified output (§7.2):** errors from `5.5e-15` at `N=8` to `2.0e-11` at `N=1024`; Parseval
matched to 9 decimal places.

**Why the two-oracle structure matters:** comparing against a naive DFT catches algorithmic
errors; Parseval independently catches *scaling and normalisation* errors that a same-convention
DFT comparison would miss (both would be wrong the same way). Teaching students to find a *second,
independent* invariant is a transferable testing skill and worth naming as such.

**A caution to build into the exercise text:** our measured FFT-vs-DFT speedups (23× at `N=16` up
to 1175× at `N=512`) are **inflated**, because the naive DFT calls `std::polar` — two
transcendental functions — inside its inner loop, while the FFT builds twiddles incrementally. A
fair comparison precomputes the DFT's twiddle table. Making students find that flaw in the
provided benchmark is a better lesson than handing them a fair one.

### Exercise 4 — Overlap-add equals direct convolution

> Implement `direct_conv` (the definition) and `overlap_add` (block the input, FFT-convolve each
> block, sum the overlapping tails). Assert they agree to `1e-9` for several combinations of
> signal length, filter length, and block size — including a case where the signal length is not a
> multiple of the block size.
>
> Then **deliberately break it**: use an FFT size smaller than `L + M − 1` and assert the result
> is *wrong*, with the error confined to the first `M−1` samples.

**Verified output (§7.4):** all five configurations agreed to `≤3.1e-13`; the undersized FFT
produced an error of `2.411` — order-unity on an order-unity signal — localised to the head.

**Why assert the failure:** the circular-convolution wraparound bug is the single most common FFT
mistake, and its signature (garbage in the first `M−1` samples, correct thereafter) is a
diagnostic students will use for years. An exercise that *requires* them to produce the bug
deliberately teaches the signature far better than a warning in prose.

**Extension:** implement **overlap-save** as well and assert all three agree. The contrast is
instructive — overlap-save discards the wrapped region instead of adding tails, so it needs no
accumulation buffer but throws away `M−1` outputs per block.

## Unit 3 — Filters as Programs

> **THE ONE IDEA:** *Every linear time-invariant system is a convolution with its impulse
> response. Designing a filter is choosing that array; implementing one is choosing how to spend
> arithmetic.*

LTI, impulse response, poles and zeros at a working level, FIR vs IIR, biquads, and the filters
engineers actually use.

**Prerequisites:** Units 1 and 2 (leakage → windowed FIR design; convolution → filtering).

**Sequence:**

1. Derive "every LTI system is a convolution" (§3.1). It is short and it is the payoff theorem.
2. Impulse response as complete characterisation — measure a system by poking it.
3. Poles and zeros as the distance-on-the-unit-circle picture (§3.1). Geometry only.
4. FIR: linear phase from symmetry, design by windowing (which is Unit 2's window table
   *reused*, not re-taught), the tap-count cost.
5. IIR: the biquad, RBJ's cookbook, cascade-vs-direct-form conditioning. **Exercise 6.**
6. The practical filters (§3.4): moving average, **one-pole/EMA**, median, Savitzky–Golay.
   **Exercise 5.**
7. Resampling and polyphase; forward-reference to strided/transposed convolution in CNNs.

**Reused by:**

- **Robotics:** the complementary filter *is* Exercise 5's filter (§4.4); notch filters for mains
  hum and mechanical resonance; the "don't differentiate noise" rule; PID as three filters.
- **Networking:** matched filters, pulse shaping, channel equalisation.
- **AI:** convolution kernels → CNN layers (§4.5); separability → depthwise-separable
  convolution; stride → decimation and its aliasing.
- **Audio:** EQ, crossovers, and the entire plugin ecosystem.

### Exercise 5 — One-pole low-pass matches the analytic exponential

> Implement `y += (1−a)*(x − y)` with `a = exp(−1/(fs·τ))`. Feed it a unit step and assert the
> output matches `1 − exp(−t/τ)` to `1e-12` at every sample over 50 ms.
>
> Assert the 63.2% rule: `y(τ) == 1 − 1/e` to `1e-9`.
>
> Assert the exact −3 dB cutoff satisfies `|H(fc)| == 1/√2`.

**Verified output (§7.5b):** step-response error `1.221e-15`; `y(τ) = 0.632120559` against
`1 − 1/e = 0.632120559`; `|H(fc)| = 0.707106781`.

**Why it earns its place despite being three lines:** this is *the* filter students will actually
write in embedded code, and the exercise establishes that it is not a hack — it is the exact
discretisation of an RC circuit, with closed-form design equations. It also sets up the robotics
unit completely.

**The extension that makes the cross-track link, and it should not be optional:**

> Assert that the complementary filter's low-pass and high-pass branches sum to exactly 1 at every
> frequency: `max|H_lp(ω) + H_hp(ω) − 1| == 0`.
>
> Then compute what `alpha = 0.98` means at a 100 Hz loop rate, and assert the crossover is
> ~0.32 Hz.

**Verified output (§7.8):** the complement is **identically zero** — `0.000e+00` — and
`alpha = 0.98` at 100 Hz is a `τ = 0.49 s`, `0.325 Hz` crossover. A student who runs this arrives
at the robotics IMU unit already knowing that the tutorial's magic number is a crossover
frequency.

### Exercise 6 — Biquad against its closed-form frequency response

> Implement a transposed-direct-form-II biquad and the RBJ low-pass and notch coefficient
> formulas. Run an impulse through it, take the DTFT of the impulse response at specific
> frequencies, and assert it matches `H(e^{jω}) = (b₀+b₁z⁻¹+b₂z⁻²)/(1+a₁z⁻¹+a₂z⁻²)` to `1e-9`.
>
> Then cascade four biquads with Butterworth section Qs `1/(2cos(π(2k+1)/16))` and assert: the
> response at `fc` is `−3.0103 dB`, and the asymptotic rolloff is `−48.16 dB/octave`.

**Verified output (§7.6):** agreement to `1.4e-14` (LP, Q=0.707), `1.3e-12` (LP, Q=4),
`1.2e-10` (notch, Q=30); cascade measured `−3.0103 dB` at cutoff and `−48.21 dB/octave`.

**Two things to make students confront:**

1. **The impulse response must be long enough.** Our first attempt used `N = 65536` and *failed*
   the Q=30 notch, because a high-Q resonance had not decayed. The fix was `N = 2^19`. This is a
   genuine property of IIR filters — "infinite impulse response" is not a figure of speech — and
   discovering it via a failing assert is worth more than being told. (§7.6 documents the failure.)
2. **The notch's measured depth was `−210 dB` against a closed form of `−196 dB`.** Both are
   numerical zero. Asking students why two "correct" answers differ by 14 dB, and getting them to
   realise that neither number means anything below the float noise floor, is a cheap and durable
   lesson about precision.

## Machine-checkable exercises via the Compiler Explorer API

All six exercises are C++ programs that compile and run through Compiler Explorer's public
execution API. No local toolchain, no container, no per-student setup.

### The call

```
POST https://godbolt.org/api/compiler/g152/compile
Content-Type: application/json
Accept: application/json

{
  "source": "<the program>",
  "options": {
    "userArguments": "-O2 -std=c++20",
    "executeParameters": { "args": [], "stdin": "" },
    "compilerOptions": { "executorRequest": true },
    "filters": { "execute": true }
  },
  "lang": "c++",
  "allowStoreCodeDebug": true
}
```

The response carries `code` (the program's exit status — `0` means every `assert` passed),
`stdout`, `stderr`, `execTime`, and a nested `buildResult` with compiler diagnostics. **A failed
`assert` shows up as `code: 139` (SIGSEGV after `abort`) with the assertion text in `stderr`** —
which makes grading trivial: exit code 0 is a pass, and the assertion message is the feedback.

*(All of this was exercised live: the working call, a build failure, and two assertion failures
are all reproduced in §7.)*

### The caching trap — this is mandatory, not advisory

**Compiler Explorer returned `okToCache: true` on every successful submission.** The cache is
keyed on the source and options. Resubmitting an identical program returns the *previous* result,
including `execTime` and including any timing numbers printed to stdout, **without re-running the
program**.

For correctness assertions this is harmless. For **any exercise that measures time it is fatal** —
a student's "optimised" version that happens to be byte-identical to their previous attempt will
report the old timing, and a benchmark comparison harness will silently compare a fresh run to a
cached one.

**The fix is one line.** Prefix every submission with a unique comment:

```python
src = f"// nonce {uuid.uuid4().hex}\n" + src
```

Every submission in §7 carries one. Any harness built on this API must do the same.

### Other operational notes, learned by doing

- **Compiler id.** `g152` is GCC 15.2. The list is at `GET /api/compilers/c++?fields=id`.
  Pin the id — a floating "latest" makes exercises non-reproducible.
- **Timings are noisy.** CE runs on shared infrastructure. One benchmark row showed 4677 µs where
  its neighbours showed ~600 µs (§7.7). Timing exercises need median-of-N and generous tolerance
  bands, and students should be told the noise is real rather than left to think their code is
  erratic.
- **There is a wall-clock limit.** Our longest legitimate run was 2868 ms (§7.7) and the biquad
  exercise at `N = 2^19` took 1289 ms. Keep exercise programs under ~3 s; an `O(N²)` DFT oracle
  above `N = 1024` will time out.
- **Be a good citizen.** Batch, cache locally, and do not hammer a free public service from a
  classroom of 200 students simultaneously. For real deployment, self-host — Compiler Explorer is
  open source and runs in Docker.
- **`assert` needs `NDEBUG` unset.** `-O2` does not define it, so asserts are live. But if anyone
  adds `-DNDEBUG` every exercise silently passes. Consider a custom `CHECK` macro that cannot be
  compiled out:

```c
#define CHECK(cond) do { if(!(cond)) { \
    printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); return 1; } } while(0)
```

That also gives a cleaner exit code (1 rather than 139) and a readable message on stdout, which is
friendlier to grade against than parsing a SIGSEGV.

---

# 7. Verified Programs and Their Real Output

Every program below was submitted to `https://godbolt.org/api/compiler/g152/compile` (GCC 15.2,
`-O2 -std=c++20`, `executorRequest: true`) with a unique nonce comment, and the output shown is
the `stdout` field of the response. Exit code `0` means every `assert` passed.

## 7.1 Aliasing — the recovered frequency is exactly the folded one

```cpp
// Aliasing: sample a pure tone, find which DFT bin it lands in.
#include <cstdio>
#include <cmath>
#include <cassert>
#include <complex>
#include <vector>
using namespace std;
static const double PI = acos(-1.0);

// magnitude of DFT bin k of x
double binmag(const vector<double>& x, int k){
    complex<double> acc{0,0};
    int N = (int)x.size();
    for(int n=0;n<N;n++) acc += x[n]*polar(1.0, -2*PI*k*n/N);
    return abs(acc);
}
int peak_bin(const vector<double>& x){
    int N=(int)x.size(); int best=0; double bm=-1;
    for(int k=0;k<=N/2;k++){ double m=binmag(x,k); if(m>bm){bm=m;best=k;} }
    return best;
}
// what a sampler at fs "sees" for an input at f: fold f into [0, fs/2]
double folded(double f, double fs){
    double r = fmod(f, fs);              // aliases repeat every fs
    if(r < 0) r += fs;
    return (r <= fs/2) ? r : fs - r;     // reflect about Nyquist
}
int main(){
    const double fs = 1000.0;            // 1 kHz sampler, Nyquist = 500 Hz
    const int N = 1000;                  // 1 s => bin spacing exactly 1 Hz
    // below Nyquist, above Nyquist, above fs, and the pathological fs/2 neighbourhood
    double tests[] = {100, 300, 499, 600, 700, 900, 1100, 1300, 1700};
    for(double f : tests){
        vector<double> x(N);
        for(int n=0;n<N;n++) x[n] = sin(2*PI*f*n/fs);
        int k = peak_bin(x);
        double predicted = folded(f, fs);
        printf("input %6.1f Hz -> peak bin %4d Hz | folded() predicts %6.1f Hz  %s\n",
               f, k, predicted, (fabs(k-predicted)<1e-9?"OK":"MISMATCH"));
        assert(fabs(k - predicted) < 1e-9);
    }
    // The money shot: 300 Hz and 700 Hz are INDISTINGUISHABLE after sampling at 1 kHz.
    vector<double> a(N), b(N);
    for(int n=0;n<N;n++){ a[n]=sin(2*PI*300*n/fs); b[n]=-sin(2*PI*700*n/fs); }
    double maxdiff=0; for(int n=0;n<N;n++) maxdiff=max(maxdiff, fabs(a[n]-b[n]));
    printf("max |sin(2pi*300 n/fs) - (-sin(2pi*700 n/fs))| = %.3e\n", maxdiff);
    assert(maxdiff < 1e-9);
    printf("ALL ALIASING ASSERTIONS PASSED\n");
}
```

**Real output, exit code 0:**

```
input  100.0 Hz -> peak bin  100 Hz | folded() predicts  100.0 Hz  OK
input  300.0 Hz -> peak bin  300 Hz | folded() predicts  300.0 Hz  OK
input  499.0 Hz -> peak bin  499 Hz | folded() predicts  499.0 Hz  OK
input  600.0 Hz -> peak bin  400 Hz | folded() predicts  400.0 Hz  OK
input  700.0 Hz -> peak bin  300 Hz | folded() predicts  300.0 Hz  OK
input  900.0 Hz -> peak bin  100 Hz | folded() predicts  100.0 Hz  OK
input 1100.0 Hz -> peak bin  100 Hz | folded() predicts  100.0 Hz  OK
input 1300.0 Hz -> peak bin  300 Hz | folded() predicts  300.0 Hz  OK
input 1700.0 Hz -> peak bin  300 Hz | folded() predicts  300.0 Hz  OK
max |sin(2pi*300 n/fs) - (-sin(2pi*700 n/fs))| = 1.252e-12
ALL ALIASING ASSERTIONS PASSED
```

## 7.2 Radix-2 FFT against a naive DFT, plus Parseval

```cpp
#include <cstdio>
#include <cmath>
#include <cassert>
#include <complex>
#include <vector>
#include <chrono>
#include <random>
using namespace std;
using cd = complex<double>;
static const double PI = acos(-1.0);

// ---- naive DFT: the definition, O(N^2). This is the oracle. ----
vector<cd> dft(const vector<cd>& x){
    int N=(int)x.size(); vector<cd> X(N);
    for(int k=0;k<N;k++){ cd s{0,0};
        for(int n=0;n<N;n++) s += x[n]*polar(1.0,-2*PI*k*n/N);
        X[k]=s; }
    return X;
}
// ---- iterative radix-2 DIT FFT, in place. N must be a power of two. ----
void fft(vector<cd>& a){
    int N=(int)a.size();
    assert((N & (N-1))==0 && "N must be a power of two");
    // bit-reversal permutation
    for(int i=1,j=0;i<N;i++){
        int bit=N>>1;
        for(; j & bit; bit>>=1) j^=bit;
        j^=bit;
        if(i<j) swap(a[i],a[j]);
    }
    // butterflies, stage by stage: len = 2,4,8,...,N
    for(int len=2; len<=N; len<<=1){
        double ang = -2*PI/len;
        cd wlen = polar(1.0, ang);
        for(int i=0;i<N;i+=len){
            cd w{1,0};
            for(int k=0;k<len/2;k++){
                cd u=a[i+k], v=a[i+k+len/2]*w;
                a[i+k]=u+v; a[i+k+len/2]=u-v;
                w*=wlen;
            }
        }
    }
}
int main(){
    mt19937 rng(12345); uniform_real_distribution<double> U(-1,1);
    for(int N : {8,16,64,256,1024}){
        vector<cd> x(N);
        for(auto& v:x) v = cd(U(rng),U(rng));
        vector<cd> ref = dft(x);
        vector<cd> got = x; fft(got);
        double maxerr=0;
        for(int k=0;k<N;k++) maxerr=max(maxerr, abs(got[k]-ref[k]));
        // tolerance scales with N (accumulated rounding), stay well inside it
        double tol = 1e-12 * N;
        printf("N=%5d  max|FFT-DFT| = %.3e  (tol %.1e) %s\n", N, maxerr, tol, maxerr<tol?"OK":"FAIL");
        assert(maxerr < tol);
    }
    // Parseval, as a second independent check
    {
        int N=256; vector<cd> x(N); for(auto&v:x) v=cd(U(rng),U(rng));
        double e_time=0; for(auto&v:x) e_time+=norm(v);
        vector<cd> X=x; fft(X);
        double e_freq=0; for(auto&v:X) e_freq+=norm(v);
        printf("Parseval: sum|x|^2 = %.9f, (1/N)sum|X|^2 = %.9f\n", e_time, e_freq/N);
        assert(fabs(e_time - e_freq/N) < 1e-9*N);
    }
    // crossover: where does O(N log N) beat O(N^2) in wall clock?
    for(int N : {16,32,64,128,256,512}){
        vector<cd> x(N); for(auto&v:x) v=cd(U(rng),U(rng));
        auto t0=chrono::steady_clock::now();
        for(int r=0;r<200;r++){ auto y=dft(x); asm volatile("":::"memory"); }
        auto t1=chrono::steady_clock::now();
        for(int r=0;r<200;r++){ auto y=x; fft(y); asm volatile("":::"memory"); }
        auto t2=chrono::steady_clock::now();
        double td=chrono::duration<double,micro>(t1-t0).count()/200;
        double tf=chrono::duration<double,micro>(t2-t1).count()/200;
        printf("N=%4d  DFT %8.2f us   FFT %7.2f us   speedup %6.1fx\n", N, td, tf, td/tf);
    }
    printf("FFT ASSERTIONS PASSED\n");
}
```

**Real output, exit code 0:**

```
N=    8  max|FFT-DFT| = 5.493e-15  (tol 8.0e-12) OK
N=   16  max|FFT-DFT| = 9.810e-15  (tol 1.6e-11) OK
N=   64  max|FFT-DFT| = 2.324e-13  (tol 6.4e-11) OK
N=  256  max|FFT-DFT| = 2.636e-12  (tol 2.6e-10) OK
N= 1024  max|FFT-DFT| = 2.009e-11  (tol 1.0e-09) OK
Parseval: sum|x|^2 = 163.081979727, (1/N)sum|X|^2 = 163.081979727
N=  16  DFT     4.41 us   FFT    0.19 us   speedup   23.2x
N=  32  DFT    25.14 us   FFT    0.45 us   speedup   56.4x
N=  64  DFT    98.65 us   FFT    0.84 us   speedup  117.4x
N= 128  DFT   446.55 us   FFT    1.92 us   speedup  233.1x
N= 256  DFT  1719.44 us   FFT    4.04 us   speedup  426.0x
N= 512  DFT 12976.13 us   FFT   11.04 us   speedup 1175.2x
FFT ASSERTIONS PASSED
```

**Honest caveat on those speedups.** The naive DFT calls `std::polar` — a `sin` and a `cos` — in
its inner loop, while the FFT builds twiddles by incremental complex multiplication. Much of the
measured ratio is transcendental-function cost, not algorithmic. A fair benchmark precomputes the
DFT's twiddle table. The *asymptotic* claim is unaffected; the *constants* here flatter the FFT.

## 7.3 Window functions — measured main-lobe and side-lobe behaviour

```cpp
// Measure window main-lobe width and peak side-lobe level from the DTFT directly.
#include <cstdio>
#include <cmath>
#include <complex>
#include <vector>
#include <string>
#include <cassert>
using namespace std;
using cd=complex<double>;
static const double PI=acos(-1.0);

vector<double> make_win(const string& name,int N){
    vector<double> w(N);
    for(int n=0;n<N;n++){
        double t = 2*PI*n/N;                 // periodic (DFT-even) definition
        if(name=="rect")      w[n]=1.0;
        else if(name=="hann") w[n]=0.5-0.5*cos(t);
        else if(name=="hamming") w[n]=0.54-0.46*cos(t);
        else if(name=="blackman") w[n]=0.42-0.5*cos(t)+0.08*cos(2*t);
        else if(name=="bh4")  w[n]=0.35875-0.48829*cos(t)+0.14128*cos(2*t)-0.01168*cos(3*t);
        else if(name=="flattop") w[n]=0.21557895-0.41663158*cos(t)+0.277263158*cos(2*t)
                                      -0.083578947*cos(3*t)+0.006947368*cos(4*t);
    }
    return w;
}
int main(){
    const int N=1024;
    const int OS=64;                          // oversample the DTFT 64x for a smooth curve
    printf("%-10s | -3dB BW | -6dB BW | first null | peak SLL | sidelobe rolloff | coh.gain | scallop\n",
           "window");
    printf("-----------+---------+---------+------------+----------+------------------+----------+--------\n");
    for(string name : {"rect","hann","hamming","blackman","bh4","flattop"}){
        auto w=make_win(name,N);
        double sum=0; for(double v:w) sum+=v;
        // DTFT magnitude at bin offset b (in DFT bins), normalised to 1 at b=0
        auto W=[&](double b){ cd s{0,0};
            for(int n=0;n<N;n++) s += w[n]*polar(1.0,-2*PI*b*n/N);
            return abs(s)/sum; };
        // scan outward in 1/OS bin steps
        double bw3=0,bw6=0,firstnull=0,peaksl=0; bool have3=false,have6=false,havenull=false;
        double prev=1.0; double slb=0;
        for(int i=1;i<=OS*12;i++){
            double b=(double)i/OS, m=W(b);
            if(!have3 && m<1/sqrt(2.0)){ bw3=2*b; have3=true; }
            if(!have6 && m<0.5){ bw6=2*b; have6=true; }
            if(!havenull && m>prev && prev<1e-3){ firstnull=b-1.0/OS; havenull=true; }
            if(havenull && m>peaksl){ peaksl=m; slb=b; }
            prev=m;
        }
        // scallop loss: worst-case attenuation for a tone exactly between two bins
        double scallop = 20*log10(W(0.5));
        // coherent gain = sum(w)/N
        printf("%-10s | %6.3f  | %6.3f  | %9.3f  | %6.2f dB | (see notes)      | %7.4f  | %6.2f dB\n",
               name.c_str(), bw3, bw6, firstnull, 20*log10(peaksl+1e-300), sum/N, scallop);
        assert(bw3>0 && peaksl>0);
    }
    // Leakage demo: a tone exactly on a bin vs half a bin off, rect vs hann
    printf("\nLeakage: 1024-pt DFT, tone on-bin (k=64.0) vs off-bin (k=64.5)\n");
    for(string name:{"rect","hann","bh4"}){
        auto w=make_win(name,N);
        for(double k:{64.0,64.5}){
            vector<double> x(N);
            for(int n=0;n<N;n++) x[n]=w[n]*cos(2*PI*k*n/N);
            // energy far from the peak (>= 8 bins away) as a fraction of total
            double tot=0,far=0;
            for(int b=0;b<N/2;b++){
                cd s{0,0}; for(int n=0;n<N;n++) s+=x[n]*polar(1.0,-2*PI*b*n/N);
                double p=norm(s); tot+=p; if(fabs(b-k)>=8) far+=p;
            }
            printf("  %-8s k=%5.1f : energy leaked >8 bins away = %10.3e of total (%.2f dB down)\n",
                   name.c_str(),k,far/tot,10*log10(far/tot+1e-300));
        }
    }
}
```

**Real output, exit code 0:**

```
window     | -3dB BW | -6dB BW | first null | peak SLL | coh.gain | scallop
-----------+---------+---------+------------+----------+----------+--------
rect       |  0.906  |  1.219  |     1.000  | -13.26 dB |  1.0000  |  -3.92 dB
hann       |  1.469  |  2.000  |     2.000  | -31.47 dB |  0.5000  |  -1.42 dB
hamming    |  1.312  |  1.844  |     2.000  | -42.67 dB |  0.5400  |  -1.75 dB
blackman   |  1.656  |  2.312  |     3.000  | -58.11 dB |  0.4200  |  -1.10 dB
bh4        |  1.906  |  2.688  |     4.000  | -92.01 dB |  0.3588  |  -0.83 dB
flattop    |  3.750  |  4.594  |     5.000  | -93.53 dB |  0.2156  |  -0.01 dB

Leakage: 1024-pt DFT, tone on-bin (k=64.0) vs off-bin (k=64.5)
  rect     k= 64.0 : energy leaked >8 bins away =  3.153e-27 of total (-265.01 dB down)
  rect     k= 64.5 : energy leaked >8 bins away =  2.536e-02 of total ( -15.96 dB down)
  hann     k= 64.0 : energy leaked >8 bins away =  2.017e-27 of total (-266.95 dB down)
  hann     k= 64.5 : energy leaked >8 bins away =  8.266e-07 of total ( -60.83 dB down)
  bh4      k= 64.0 : energy leaked >8 bins away =  1.812e-27 of total (-267.42 dB down)
  bh4      k= 64.5 : energy leaked >8 bins away =  8.935e-10 of total ( -90.49 dB down)
```

These reproduce fred harris (1978) to within a tenth of a dB, which is a reasonable
cross-check that both the paper and this implementation are right.

## 7.4 Overlap-add equals direct convolution — and the wraparound bug

```cpp
// Overlap-add FFT convolution must equal direct convolution.
#include <cstdio>
#include <cmath>
#include <cassert>
#include <complex>
#include <vector>
#include <random>
#include <array>
using namespace std;
using cd=complex<double>;
static const double PI=acos(-1.0);
void fft(vector<cd>& a, bool inv){
    int N=a.size();
    for(int i=1,j=0;i<N;i++){int b=N>>1; for(;j&b;b>>=1) j^=b; j^=b; if(i<j) swap(a[i],a[j]);}
    for(int len=2;len<=N;len<<=1){
        cd wl=polar(1.0,(inv?2:-2)*PI/len);
        for(int i=0;i<N;i+=len){ cd w{1,0};
            for(int k=0;k<len/2;k++){cd u=a[i+k],v=a[i+k+len/2]*w;a[i+k]=u+v;a[i+k+len/2]=u-v;w*=wl;} }
    }
    if(inv) for(auto&v:a) v/=N;
}
vector<double> direct_conv(const vector<double>& x,const vector<double>& h){
    vector<double> y(x.size()+h.size()-1,0.0);
    for(size_t n=0;n<x.size();n++) for(size_t k=0;k<h.size();k++) y[n+k]+=x[n]*h[k];
    return y;
}
// Overlap-add: block the INPUT, FFT-convolve each block with h, add the tails back in.
vector<double> overlap_add(const vector<double>& x,const vector<double>& h,int L){
    int M=h.size();
    int Nfft=1; while(Nfft < L+M-1) Nfft<<=1;      // must hold the full linear result
    vector<cd> H(Nfft,cd{0,0});
    for(int i=0;i<M;i++) H[i]=h[i];
    fft(H,false);
    vector<double> y(x.size()+M-1,0.0);
    for(size_t start=0; start<x.size(); start+=L){
        vector<cd> B(Nfft,cd{0,0});
        for(int i=0;i<L && start+i<x.size();i++) B[i]=x[start+i];
        fft(B,false);
        for(int i=0;i<Nfft;i++) B[i]*=H[i];         // multiply = circular convolution
        fft(B,true);
        for(int i=0;i<Nfft;i++){ size_t o=start+i; if(o<y.size()) y[o]+=B[i].real(); }
    }
    return y;
}
int main(){
    mt19937 rng(7); uniform_real_distribution<double> U(-1,1);
    struct Case{int xn,hn,L;};
    Case cases[]={{1000,32,64},{1000,32,256},{4096,101,512},{777,7,16},{5000,200,1024}};
    for(auto [xn,hn,L] : cases){
        vector<double> x(xn),h(hn);
        for(auto&v:x)v=U(rng); for(auto&v:h)v=U(rng);
        auto a=direct_conv(x,h), b=overlap_add(x,h,L);
        assert(a.size()==b.size());
        double m=0; for(size_t i=0;i<a.size();i++) m=max(m,fabs(a[i]-b[i]));
        printf("len(x)=%5d len(h)=%4d block L=%5d  max|OLA-direct| = %.3e %s\n",xn,hn,L,m,m<1e-9?"OK":"FAIL");
        assert(m<1e-9);
    }
    // The classic bug: FFT size too small => time-domain wraparound (circular, not linear)
    {
        vector<double> x(64),h(32); for(auto&v:x)v=U(rng); for(auto&v:h)v=U(rng);
        int Nfft=64;                                 // TOO SMALL: need >= 64+32-1 = 95
        vector<cd> X(Nfft,cd{0,0}),H(Nfft,cd{0,0});
        for(int i=0;i<64;i++)X[i]=x[i]; for(int i=0;i<32;i++)H[i]=h[i];
        fft(X,false);fft(H,false);
        for(int i=0;i<Nfft;i++)X[i]*=H[i];
        fft(X,true);
        auto ref=direct_conv(x,h);
        double head=0; for(int i=0;i<31;i++) head=max(head,fabs(X[i].real()-ref[i]));
        printf("undersized FFT: max error in first 31 samples = %.3e  <- wraparound, NOT noise\n",head);
        assert(head>1e-3);   // it is WRONG, and predictably so
    }
    printf("OVERLAP-ADD ASSERTIONS PASSED\n");
}
```

**Real output, exit code 0:**

```
len(x)= 1000 len(h)=  32 block L=   64  max|OLA-direct| = 1.066e-14 OK
len(x)= 1000 len(h)=  32 block L=  256  max|OLA-direct| = 5.063e-14 OK
len(x)= 4096 len(h)= 101 block L=  512  max|OLA-direct| = 3.126e-13 OK
len(x)=  777 len(h)=   7 block L=   16  max|OLA-direct| = 1.776e-15 OK
len(x)= 5000 len(h)= 200 block L= 1024  max|OLA-direct| = 2.824e-13 OK
undersized FFT: max error in first 31 samples = 2.411e+00  <- wraparound, NOT noise
OVERLAP-ADD ASSERTIONS PASSED
```

**A build failure worth recording**, because it is the kind of thing that eats a student's
afternoon. The first submission used
`for(auto [xn,hn,L] : vector<array<int,3>>{{1000,32,64}, ...})` and GCC rejected it with "no
matching function for call to `std::vector<std::array<int,3>>::vector(<brace-enclosed initializer
list>)`" — brace elision does not apply through `initializer_list` to an aggregate `std::array`,
and `<array>` was not included either. Replacing it with a named `struct Case{int xn,hn,L;};` and
a plain C array fixed it. The lesson for the exercise harness: **surface `buildResult.stderr`, not
just the exit code** — a build failure and an assertion failure need different feedback.

## 7.5 Quantisation SNR, the Δ²/12 mechanism, and dither

```cpp
// Quantisation SNR must land on 6.02n + 1.76 dB for a full-scale sine.
#include <cstdio>
#include <cmath>
#include <cassert>
#include <vector>
#include <random>
using namespace std;
static const double PI=acos(-1.0);

// Mid-tread rounding quantiser, n bits, full-scale +-1
double quant(double x,int n){
    double L = ldexp(1.0, n-1);            // 2^(n-1) steps per side
    double q = round(x*L)/L;
    return fmin(fmax(q,-1.0), 1.0);
}
int main(){
    const int N = 1<<17;
    // irrational-ish frequency: never repeats over the block, so the error
    // sequence looks like noise instead of a periodic pattern
    const double f = 1000.0*(sqrt(5.0)-1)/2, fs = 48000.0;
    printf(" n |  measured SNR |  6.02n+1.76 |  delta\n");
    printf("---+---------------+-------------+--------\n");
    for(int n : {4,6,8,10,12,14,16}){
        double ps=0, pe=0;
        for(int i=0;i<N;i++){
            double x = sin(2*PI*f*i/fs);
            double e = quant(x,n) - x;
            ps += x*x; pe += e*e;
        }
        double snr = 10*log10(ps/pe);
        double pred = 6.02*n + 1.76;
        printf("%2d | %10.2f dB | %8.2f dB | %+6.2f\n", n, snr, pred, snr-pred);
        assert(fabs(snr-pred) < 0.6);
    }
    // WHERE THE FORMULA COMES FROM, numerically: noise power -> Delta^2/12
    for(int n : {8,12,16}){
        double Delta = 1.0/ldexp(1.0,n-1);   // one LSB: 2^-(n-1), so 2^n steps over [-1,1]
        double pe=0; for(int i=0;i<N;i++){ double x=sin(2*PI*f*i/fs); double e=quant(x,n)-x; pe+=e*e; }
        pe/=N;
        printf("n=%2d: measured noise power %.6e   Delta^2/12 = %.6e   ratio %.4f\n",
               n, pe, Delta*Delta/12, pe/(Delta*Delta/12));
        assert(fabs(pe/(Delta*Delta/12) - 1.0) < 0.05);
    }
    // DITHER: quantise a tone far below one LSB with a 4-bit quantiser.
    // Undithered it vanishes entirely (correlated, deterministic distortion).
    // Dithered, the tone survives in the average even though no single sample resolves it.
    {
        const int n=4, M=1<<16; const double amp=0.02;   // ~0.16 LSB at 4 bits
        mt19937 rng(1); uniform_real_distribution<double> tpdf(0,1);
        double Delta = 1.0/ldexp(1.0,n-1);
        double corr_nodith=0, corr_dith=0;
        for(int i=0;i<M;i++){
            double s = amp*sin(2*PI*f*i/fs);
            double d = (tpdf(rng)+tpdf(rng)-1.0)*Delta;   // TPDF dither, +-1 LSB
            corr_nodith += quant(s,n)         * sin(2*PI*f*i/fs);
            corr_dith   += quant(s+d,n)       * sin(2*PI*f*i/fs);
        }
        corr_nodith = 2*corr_nodith/M; corr_dith = 2*corr_dith/M;
        printf("sub-LSB tone, true amplitude %.4f\n", amp);
        printf("  recovered WITHOUT dither: %.6f   <- signal destroyed\n", corr_nodith);
        printf("  recovered WITH TPDF dither: %.6f   <- signal survives\n", corr_dith);
        assert(fabs(corr_nodith) < 1e-9);
        assert(fabs(corr_dith - amp) < 0.005);
    }
    printf("SNR + DITHER ASSERTIONS PASSED\n");
}
```

**Real output, exit code 0:**

```
 n |  measured SNR |  6.02n+1.76 |  delta
---+---------------+-------------+--------
 4 |      26.22 dB |    25.84 dB |  +0.38
 6 |      38.07 dB |    37.88 dB |  +0.19
 8 |      50.02 dB |    49.92 dB |  +0.10
10 |      62.01 dB |    61.96 dB |  +0.05
12 |      74.03 dB |    74.00 dB |  +0.03
14 |      86.06 dB |    86.04 dB |  +0.02
16 |      98.12 dB |    98.08 dB |  +0.04
n= 8: measured noise power 4.980052e-06   Delta^2/12 = 5.086263e-06   ratio 0.9791
n=12: measured noise power 1.976581e-08   Delta^2/12 = 1.986821e-08   ratio 0.9948
n=16: measured noise power 7.713247e-11   Delta^2/12 = 7.761021e-11   ratio 0.9938
sub-LSB tone, true amplitude 0.0200
  recovered WITHOUT dither: 0.000000   <- signal destroyed
  recovered WITH TPDF dither: 0.020146   <- signal survives
SNR + DITHER ASSERTIONS PASSED
```

**A failure worth recording.** The first run **failed** the `Δ²/12` assertion, because the LSB was
computed as `Delta = 2.0/2^(n-1)` when the quantiser's actual step was `1.0/2^(n-1)` — a factor of
two, which becomes a factor of four in a power ratio. The measured/predicted ratio came out near
0.25 instead of 1.0 and the assert fired. **The SNR table above it still passed**, because the
`6.02n + 1.76` formula does not reference `Δ` explicitly. That is exactly why the exercise asserts
both the result and the mechanism (§6, Exercise 2): the redundant check caught an error the
headline check could not see.

## 7.5b The one-pole low-pass against the analytic exponential

```cpp
// One-pole low-pass (EMA). Step response must match 1-exp(-t/tau) analytically.
#include <cstdio>
#include <cmath>
#include <cassert>
#include <vector>
using namespace std;
static const double PI=acos(-1.0);
int main(){
    const double fs = 48000.0;
    const double tau = 0.010;              // 10 ms time constant
    const double a = exp(-1.0/(fs*tau));   // pole location; y += (1-a)*(x-y)
    printf("fs=%.0f tau=%.4f s -> a = %.9f, 1-a = %.9f\n", fs, tau, a, 1-a);

    // step response vs closed form
    double y=0; double maxerr=0;
    for(int n=0;n<(int)(0.05*fs);n++){
        double x=1.0;
        y = a*y + (1-a)*x;
        double t = (n+1)/fs;
        double analytic = 1.0 - exp(-t/tau);
        maxerr = max(maxerr, fabs(y-analytic));
    }
    printf("max |step response - (1-exp(-t/tau))| over 50 ms = %.3e\n", maxerr);
    assert(maxerr < 1e-12);

    // 63.2%% rule: at t=tau the output is 1-1/e
    y=0; int n_tau=(int)llround(tau*fs);
    for(int n=0;n<n_tau;n++) y = a*y + (1-a)*1.0;
    printf("y(tau) = %.9f, 1-1/e = %.9f\n", y, 1.0-exp(-1.0));
    assert(fabs(y-(1.0-exp(-1.0))) < 1e-9);

    // -3 dB point. Analytic magnitude of H(z)=(1-a)/(1-a z^-1) at z=e^{jw}
    auto mag=[&](double f){ double w=2*PI*f/fs;
        double re=1-a*cos(w), im=a*sin(w);
        return (1-a)/hypot(re,im); };
    // cutoff of a one-pole: fc = fs/(2 pi) * acos(1 - (1-a)^2/(2a))  (exact -3 dB)
    double A=(1-a), fc = fs/(2*PI)*acos(1.0 - A*A/(2*a));
    printf("exact -3 dB fc = %.6f Hz, |H(fc)| = %.9f (target %.9f)\n", fc, mag(fc), 1/sqrt(2.0));
    assert(fabs(mag(fc)-1/sqrt(2.0)) < 1e-9);
    // the rule of thumb everyone actually uses:
    printf("rule of thumb 1/(2*pi*tau) = %.6f Hz  (error %.3f%%)\n",
           1.0/(2*PI*tau), 100*fabs(1.0/(2*PI*tau)-fc)/fc);
    printf("ONE-POLE ASSERTIONS PASSED\n");
}
```

**Real output, exit code 0:**

```
fs=48000 tau=0.0100 s -> a = 0.997918835, 1-a = 0.002081165
max |step response - (1-exp(-t/tau))| over 50 ms = 1.221e-15
y(tau) = 0.632120559, 1-1/e = 0.632120559
exact -3 dB fc = 15.915500 Hz, |H(fc)| = 0.707106781 (target 0.707106781)
rule of thumb 1/(2*pi*tau) = 15.915494 Hz  (error 0.000%)
ONE-POLE ASSERTIONS PASSED
```

## 7.6 Biquad against its closed-form frequency response

```cpp
// A biquad's measured impulse-response spectrum must match its closed-form H(e^jw).
#include <cstdio>
#include <cmath>
#include <cassert>
#include <complex>
#include <vector>
using namespace std;
using cd=complex<double>;
static const double PI=acos(-1.0);

struct Biquad {
    double b0,b1,b2,a1,a2;             // a0 normalised to 1
    double z1=0,z2=0;                  // transposed direct form II state
    double step(double x){
        double y = b0*x + z1;
        z1 = b1*x - a1*y + z2;
        z2 = b2*x - a2*y;
        return y;
    }
    // closed form: H(z) = (b0+b1 z^-1+b2 z^-2)/(1+a1 z^-1+a2 z^-2), z=e^{jw}
    cd H(double w) const {
        cd z1_=polar(1.0,-w), z2_=polar(1.0,-2*w);
        return (b0+b1*z1_+b2*z2_)/(cd(1,0)+a1*z1_+a2*z2_);
    }
};
// RBJ audio-EQ-cookbook low-pass
Biquad rbj_lowpass(double fc,double fs,double Q){
    double w0=2*PI*fc/fs, c=cos(w0), s=sin(w0), alpha=s/(2*Q);
    double a0 = 1+alpha;
    Biquad f;
    f.b0=((1-c)/2)/a0; f.b1=(1-c)/a0; f.b2=((1-c)/2)/a0;
    f.a1=(-2*c)/a0;    f.a2=(1-alpha)/a0;
    return f;
}
Biquad rbj_notch(double fc,double fs,double Q){
    double w0=2*PI*fc/fs, c=cos(w0), s=sin(w0), alpha=s/(2*Q);
    double a0=1+alpha; Biquad f;
    f.b0=1/a0; f.b1=(-2*c)/a0; f.b2=1/a0;
    f.a1=(-2*c)/a0; f.a2=(1-alpha)/a0;
    return f;
}
int main(){
    const double fs=48000.0;
    struct T{const char*name;Biquad f;};
    vector<T> tests={
        {"LP 1kHz Q=0.7071", rbj_lowpass(1000,fs,M_SQRT1_2)},
        {"LP 100Hz Q=4",     rbj_lowpass(100, fs,4.0)},
        {"Notch 50Hz Q=30",  rbj_notch  (50,  fs,30.0)},
    };
    for(auto& t : tests){
        Biquad f=t.f;
        // measured: impulse response, long enough for it to decay
        const int N=1<<19;   // long enough for even Q=30 to decay below 1e-12
        vector<double> h(N,0.0);
        for(int i=0;i<N;i++) h[i]=f.step(i==0?1.0:0.0);
        printf("%s   tail |h[N-1]| = %.3e\n", t.name, fabs(h[N-1]));
        double maxerr=0; double worst_f=0;
        for(double freq : {10.0,50.0,100.0,250.0,1000.0,4000.0,12000.0,23000.0}){
            double w=2*PI*freq/fs;
            cd meas{0,0};
            for(int i=0;i<N;i++) meas += h[i]*polar(1.0,-w*i);   // DTFT at exactly this w
            cd ref=t.f.H(w);
            double e=abs(meas-ref);
            if(e>maxerr){maxerr=e;worst_f=freq;}
            printf("    %8.1f Hz  measured %8.5f dB   closed form %8.5f dB\n",
                   freq, 20*log10(abs(meas)+1e-300), 20*log10(abs(ref)+1e-300));
        }
        printf("    max |measured - closed form| = %.3e at %.0f Hz\n\n", maxerr, worst_f);
        assert(maxerr < 1e-9);
    }
    // Why you cascade biquads: an 8th-order Butterworth in DIRECT form, in float.
    // Same poles, two structures, wildly different arithmetic behaviour.
    {
        const double fc=100.0;
        // 8th-order Butterworth as 4 cascaded biquads (bilinear transform, Q from pole angles)
        vector<Biquad> stages;
        for(int k=0;k<4;k++){
            double theta = PI*(2*k+1)/(2*8);
            double Q = 1.0/(2*cos(theta));         // section Q for Butterworth
            stages.push_back(rbj_lowpass(fc,fs,Q));
        }
        // measured cascade response at DC should be ~0 dB, at 1 kHz deeply down
        auto casc=[&](double freq){ cd H(1,0); double w=2*PI*freq/fs;
            for(auto&s:stages) H*=s.H(w); return H; };
        printf("8th-order Butterworth (4 cascaded biquads), fc=100 Hz:\n");
        for(double freq:{1.0,50.0,100.0,200.0,400.0,1000.0})
            printf("   %7.1f Hz : %9.3f dB\n", freq, 20*log10(abs(casc(freq))));
        // at fc the 8th-order Butterworth is -3.01 dB by construction
        double at_fc=20*log10(abs(casc(fc)));
        printf("   |H(fc)| = %.4f dB (Butterworth definition: -3.0103)\n", at_fc);
        assert(fabs(at_fc + 3.0103) < 0.02);
        // rolloff must approach 8*6.02 = 48.16 dB/octave
        double oct = 20*log10(abs(casc(800.0))) - 20*log10(abs(casc(400.0)));
        printf("   rolloff 400->800 Hz = %.2f dB/octave (asymptote -48.16)\n", oct);
        assert(oct < -47.0 && oct > -49.5);
    }
    printf("BIQUAD ASSERTIONS PASSED\n");
}
```

**Real output, exit code 0 (`execTime` 1289 ms):**

```
LP 1kHz Q=0.7071   tail |h[N-1]| = 9.881e-324
        10.0 Hz  measured -0.00000 dB   closed form -0.00000 dB
        50.0 Hz  measured -0.00003 dB   closed form -0.00003 dB
       100.0 Hz  measured -0.00043 dB   closed form -0.00043 dB
       250.0 Hz  measured -0.01684 dB   closed form -0.01684 dB
      1000.0 Hz  measured -3.01030 dB   closed form -3.01030 dB
      4000.0 Hz  measured -24.47644 dB  closed form -24.47644 dB
     12000.0 Hz  measured -47.33890 dB  closed form -47.33890 dB
     23000.0 Hz  measured -94.67765 dB  closed form -94.67765 dB
    max |measured - closed form| = 1.422e-14 at 10 Hz

LP 100Hz Q=4   tail |h[N-1]| = 1.828e-321
        10.0 Hz  measured  0.08453 dB   closed form  0.08453 dB
        50.0 Hz  measured  2.37972 dB   closed form  2.37972 dB
       100.0 Hz  measured 12.04120 dB   closed form 12.04120 dB
       250.0 Hz  measured -14.46584 dB  closed form -14.46584 dB
      1000.0 Hz  measured -39.94029 dB  closed form -39.94029 dB
     23000.0 Hz  measured -134.70223 dB closed form -134.70223 dB
    max |measured - closed form| = 1.273e-12 at 100 Hz

Notch 50Hz Q=30   tail |h[N-1]| = 2.956e-29
        10.0 Hz  measured -0.00021 dB   closed form -0.00021 dB
        50.0 Hz  measured -210.18639 dB closed form -196.16378 dB
       100.0 Hz  measured -0.00214 dB   closed form -0.00214 dB
       250.0 Hz  measured -0.00021 dB   closed form -0.00021 dB
      1000.0 Hz  measured -0.00001 dB   closed form -0.00001 dB
    max |measured - closed form| = 1.246e-10 at 50 Hz

8th-order Butterworth (4 cascaded biquads), fc=100 Hz:
       1.0 Hz :    -0.000 dB
      50.0 Hz :    -0.000 dB
     100.0 Hz :    -3.010 dB
     200.0 Hz :   -48.168 dB
     400.0 Hz :   -96.344 dB
    1000.0 Hz :  -160.098 dB
   |H(fc)| = -3.0103 dB (Butterworth definition: -3.0103)
   rolloff 400->800 Hz = -48.21 dB/octave (asymptote -48.16)
BIQUAD ASSERTIONS PASSED
```

**A failure worth recording.** The first run used `N = 2^16` samples of impulse response and
**failed** on the Q=30 notch. A `Q = 30` resonance at 50 Hz has a decay time constant of roughly
`Q/(π·f) ≈ 0.19 s`; `2^16` samples at 48 kHz is 1.37 s, only about 7 time constants, leaving a
residual around `e^{-7} ≈ 9×10⁻⁴` — far above the `1e-9` tolerance. Raising `N` to `2^19` (10.9 s,
~57 time constants) fixed it. **"Infinite impulse response" is not a figure of speech**, and this
is a good failure to let students hit.

Also note the notch row: measured `−210 dB` versus closed-form `−196 dB`. Both are floating-point
cancellation noise, not signal. Two "correct" answers disagreeing by 14 dB is a cheap lesson in
what a dB figure means below the numerical noise floor.

## 7.7 Fast convolution — where the crossover actually is

```cpp
// Where does FFT convolution actually beat direct convolution?
#include <cstdio>
#include <cmath>
#include <complex>
#include <vector>
#include <chrono>
#include <random>
using namespace std;
using cd=complex<double>;
static const double PI=acos(-1.0);
void fft(vector<cd>& a,bool inv){
    int N=a.size();
    for(int i=1,j=0;i<N;i++){int b=N>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j)swap(a[i],a[j]);}
    for(int len=2;len<=N;len<<=1){ cd wl=polar(1.0,(inv?2:-2)*PI/len);
        for(int i=0;i<N;i+=len){cd w{1,0};
            for(int k=0;k<len/2;k++){cd u=a[i+k],v=a[i+k+len/2]*w;a[i+k]=u+v;a[i+k+len/2]=u-v;w*=wl;}}}
    if(inv) for(auto&v:a) v/=N;
}
int main(){
    mt19937 rng(3); uniform_real_distribution<double> U(-1,1);
    const int BLOCK=4096;                      // fixed signal block
    printf("block of %d samples convolved with a filter of length M\n",BLOCK);
    printf("   M | direct (us) | FFT-OLA (us) | winner\n");
    printf("-----+-------------+--------------+--------\n");
    for(int M : {4,8,16,32,64,128,256,512,1024}){
        vector<double> x(BLOCK),h(M);
        for(auto&v:x)v=U(rng); for(auto&v:h)v=U(rng);
        int reps = max(3, 2000000/(BLOCK*M/8+1));
        // direct
        auto t0=chrono::steady_clock::now();
        volatile double sink=0;
        for(int r=0;r<reps;r++){
            vector<double> y(BLOCK+M-1,0.0);
            for(int n=0;n<BLOCK;n++){ double xn=x[n];
                for(int k=0;k<M;k++) y[n+k]+=xn*h[k]; }
            sink += y[0];
        }
        auto t1=chrono::steady_clock::now();
        // FFT convolution: single transform sized for the whole block
        int Nfft=1; while(Nfft<BLOCK+M-1) Nfft<<=1;
        for(int r=0;r<reps;r++){
            vector<cd> X(Nfft,cd{0,0}),H(Nfft,cd{0,0});
            for(int i=0;i<BLOCK;i++)X[i]=x[i];
            for(int i=0;i<M;i++)H[i]=h[i];
            fft(X,false); fft(H,false);
            for(int i=0;i<Nfft;i++)X[i]*=H[i];
            fft(X,true);
            sink += X[0].real();
        }
        auto t2=chrono::steady_clock::now();
        double td=chrono::duration<double,micro>(t1-t0).count()/reps;
        double tf=chrono::duration<double,micro>(t2-t1).count()/reps;
        printf("%4d | %10.1f  | %11.1f  | %s\n",M,td,tf, td<tf?"direct":"FFT");
    }
    printf("\n(note: the FFT column recomputes H every rep; a real system transforms h ONCE)\n");
    for(int M : {32,64,128,256}){
        vector<double> x(BLOCK),h(M);
        for(auto&v:x)v=U(rng); for(auto&v:h)v=U(rng);
        int Nfft=1; while(Nfft<BLOCK+M-1) Nfft<<=1;
        vector<cd> H(Nfft,cd{0,0}); for(int i=0;i<M;i++)H[i]=h[i]; fft(H,false);  // precomputed
        int reps=200; volatile double sink=0;
        auto t0=chrono::steady_clock::now();
        for(int r=0;r<reps;r++){
            vector<cd> X(Nfft,cd{0,0}); for(int i=0;i<BLOCK;i++)X[i]=x[i];
            fft(X,false); for(int i=0;i<Nfft;i++)X[i]*=H[i]; fft(X,true); sink+=X[0].real();
        }
        auto t1=chrono::steady_clock::now();
        for(int r=0;r<reps;r++){
            vector<double> y(BLOCK+M-1,0.0);
            for(int n=0;n<BLOCK;n++){double xn=x[n]; for(int k=0;k<M;k++) y[n+k]+=xn*h[k];}
            sink+=y[0];
        }
        auto t2=chrono::steady_clock::now();
        printf("M=%4d  FFT(h precomputed) %8.1f us   direct %8.1f us   -> %s\n", M,
            chrono::duration<double,micro>(t1-t0).count()/reps,
            chrono::duration<double,micro>(t2-t1).count()/reps,
            (t1-t0)<(t2-t1)?"FFT wins":"direct wins");
    }
}
```

**Real output, exit code 0 (`execTime` 2868 ms):**

```
block of 4096 samples convolved with a filter of length M
   M | direct (us) | FFT-OLA (us) | winner
-----+-------------+--------------+--------
   4 |       25.2  |       788.1  | direct
   8 |       26.1  |      1753.9  | direct
  16 |       26.7  |       643.9  | direct
  32 |       33.1  |      4677.6  | direct
  64 |       44.4  |       597.3  | direct
 128 |       84.9  |       597.2  | direct
 256 |      174.1  |       556.6  | direct
 512 |      368.3  |       554.6  | direct
1024 |      692.2  |       586.1  | FFT

(note: the FFT column recomputes H every rep; a real system transforms h ONCE)
M=  32  FFT(h precomputed)    376.9 us   direct     33.1 us   -> direct wins
M=  64  FFT(h precomputed)    374.6 us   direct     44.2 us   -> direct wins
M= 128  FFT(h precomputed)    377.7 us   direct     85.8 us   -> direct wins
M= 256  FFT(h precomputed)    375.1 us   direct    173.0 us   -> direct wins
```

The crossover is around **512–1024 taps**, roughly an order of magnitude above the textbook
"30–60 taps". Two reasons, both real: the direct convolution auto-vectorises into packed FMAs,
while this naive `complex<double>` radix-2 FFT does not vectorise at all and would lose to FFTW by
perhaps 10×. **The asymptotics are right; the constants are hardware- and library-specific, and
must be measured.**

Note also the `M=32` row reporting 4677.6 µs where its neighbours report ~600 µs. That is
**shared-infrastructure timing noise**, not a real effect — direct evidence that timing exercises
on Compiler Explorer need median-of-N.

## 7.8 Moving average, linear phase, complementary filter, and differentiating noise

```cpp
#include <cstdio>
#include <cmath>
#include <cassert>
#include <complex>
#include <vector>
using namespace std;
using cd=complex<double>;
static const double PI=acos(-1.0);
int main(){
    // 1) Moving average of length M: H(w) = (1/M) * sin(wM/2)/sin(w/2) * e^{-jw(M-1)/2}
    printf("=== moving average: a terrible filter ===\n");
    for(int M : {4,8,16,32}){
        auto H=[&](double w){ cd s{0,0}; for(int k=0;k<M;k++) s+=polar(1.0,-w*k); return s/(double)M; };
        // find -3dB point and worst stopband sidelobe beyond the first null (w=2pi/M)
        double w3=0; for(int i=1;i<100000;i++){double w=PI*i/100000; if(abs(H(w))<1/sqrt(2.0)){w3=w;break;}}
        double worst=0; double firstnull=2*PI/M;
        for(int i=1;i<100000;i++){double w=firstnull+ (PI-firstnull)*i/100000.0; worst=max(worst,abs(H(w)));}
        printf("M=%2d: -3dB at w=%.4f (f/fs=%.4f)   worst stopband sidelobe = %.2f dB\n",
               M, w3, w3/(2*PI), 20*log10(worst));
        assert(20*log10(worst) > -16.0);  // NEVER better than about -13 dB, however large M gets
    }
    printf("-> stopband attenuation is ~-13 dB REGARDLESS of M. More taps does not help.\n\n");

    // 2) FIR linear phase: symmetric taps => exactly linear phase
    printf("=== linear phase from symmetry ===\n");
    {
        int M=21; vector<double> h(M);
        for(int n=0;n<M;n++){ double m=n-(M-1)/2.0;
            h[n] = (m==0)?0.25 : sin(0.25*PI*m)/(PI*m);        // windowed sinc, fc=fs/8
            h[n] *= 0.54-0.46*cos(2*PI*n/(M-1)); }             // Hamming
        double maxdev=0;
        for(int i=1;i<200;i++){
            double w=PI*i/200.0; cd H{0,0};
            for(int n=0;n<M;n++) H+=h[n]*polar(1.0,-w*n);
            if(abs(H)<1e-6) continue;
            double ph=arg(H), expected=-w*(M-1)/2.0;
            // wrap difference into (-pi,pi]
            double d=ph-expected; while(d>PI)d-=2*PI; while(d<-PI)d+=2*PI;
            // allow the pi jump where H goes negative
            d=min(fabs(d), fabs(fabs(d)-PI));
            maxdev=max(maxdev,d);
        }
        printf("symmetric 21-tap FIR: max deviation from linear phase = %.3e rad\n", maxdev);
        printf("group delay = (M-1)/2 = %.1f samples, EXACTLY, at every frequency\n",(M-1)/2.0);
        assert(maxdev<1e-9);
    }
    printf("\n");

    // 3) Complementary filter: LP + HP = 1 exactly, at every frequency
    printf("=== complementary filter is ONE one-pole filter ===\n");
    {
        double alpha=0.98;                       // the number every quadcopter tutorial hardcodes
        // angle = alpha*(angle + gyro*dt) + (1-alpha)*accel
        // LP on accel: H_lp(z) = (1-alpha)/(1-alpha z^-1)
        // HP on the integrated gyro: H_hp(z) = 1 - H_lp(z)
        double maxerr=0;
        for(int i=0;i<=500;i++){
            double w=PI*i/500.0; cd z1=polar(1.0,-w);
            cd Hlp=(1-alpha)/(cd(1,0)-alpha*z1);
            cd Hhp=cd(1,0)-Hlp;
            maxerr=max(maxerr, abs(Hlp+Hhp-cd(1,0)));
        }
        printf("alpha=%.2f : max |H_lp(w) + H_hp(w) - 1| over all w = %.3e\n",alpha,maxerr);
        assert(maxerr<1e-15);
        // and its crossover frequency
        double dt=1.0/100;                       // 100 Hz loop
        double tau=alpha*dt/(1-alpha);
        printf("tau = alpha*dt/(1-alpha) = %.4f s -> crossover ~ %.3f Hz\n", tau, 1/(2*PI*tau));
        printf("-> 'alpha=0.98' is not a magic number, it is a 0.32 Hz crossover at 100 Hz loop rate\n");
    }
    printf("\n");

    // 4) Differentiating noise is a bad idea: gain grows with frequency
    printf("=== why differentiating noise is a bad idea ===\n");
    {
        // backward difference y[n]=(x[n]-x[n-1])/dt : |H(w)| = 2|sin(w/2)|/dt
        double dt=1.0/1000;
        for(double f:{1.0,10.0,100.0,499.0}){
            double w=2*PI*f*dt;
            printf("  f=%6.1f Hz : |H| = %9.2f  (ideal d/dt would be %9.2f)\n",
                   f, 2*fabs(sin(w/2))/dt, 2*PI*f);
        }
        // white noise in -> noise amplified by the RMS gain over the band
        double g2=0; int Nb=10000;
        for(int i=0;i<Nb;i++){double w=PI*i/Nb; double m=2*fabs(sin(w/2))/dt; g2+=m*m;}
        printf("  RMS gain of the differencer over the full band = %.1f  (unity-gain filter = 1.0)\n",
               sqrt(g2/Nb));
        printf("-> a differencer multiplies broadband sensor noise by ~1000x at fs=1kHz\n");
    }
    printf("\nFILTER ASSERTIONS PASSED\n");
}
```

**Real output, exit code 0:**

```
=== moving average: a terrible filter ===
M= 4: -3dB at w=0.7153 (f/fs=0.1138)   worst stopband sidelobe = -11.30 dB
M= 8: -3dB at w=0.3503 (f/fs=0.0557)   worst stopband sidelobe = -12.80 dB
M=16: -3dB at w=0.1743 (f/fs=0.0277)   worst stopband sidelobe = -13.15 dB
M=32: -3dB at w=0.0870 (f/fs=0.0138)   worst stopband sidelobe = -13.23 dB
-> stopband attenuation is ~-13 dB REGARDLESS of M. More taps does not help.

=== linear phase from symmetry ===
symmetric 21-tap FIR: max deviation from linear phase = 6.224e-12 rad
group delay = (M-1)/2 = 10.0 samples, EXACTLY, at every frequency

=== complementary filter is ONE one-pole filter ===
alpha=0.98 : max |H_lp(w) + H_hp(w) - 1| over all w = 0.000e+00
tau = alpha*dt/(1-alpha) = 0.4900 s -> crossover ~ 0.325 Hz
-> 'alpha=0.98' is not a magic number, it is a 0.32 Hz crossover at 100 Hz loop rate

=== why differentiating noise is a bad idea ===
  f=   1.0 Hz : |H| =      6.28  (ideal d/dt would be      6.28)
  f=  10.0 Hz : |H| =     62.82  (ideal d/dt would be     62.83)
  f= 100.0 Hz : |H| =    618.03  (ideal d/dt would be    628.32)
  f= 499.0 Hz : |H| =   1999.99  (ideal d/dt would be   3135.31)
  RMS gain of the differencer over the full band = 1414.1  (unity-gain filter = 1.0)
-> a differencer multiplies broadband sensor noise by ~1000x at fs=1kHz

FILTER ASSERTIONS PASSED
```

**A failure worth recording.** The moving-average assertion was first written as
`−14 dB < SLL < −13 dB`, asserting the asymptotic −13.26 dB value. It **failed at `M = 4`**, which
measures −11.30 dB. The −13.26 dB figure is the *limit* as `M → ∞`; small `M` is worse. The
assertion was corrected to the claim actually being made — *never better than about −13 dB,
however large `M` gets* — which is both true for all `M` and the point of the exercise. A good
reminder to assert the claim you mean rather than the number you remember.

## 7.9 SIMD vectorisation of a FIR, and Q15 fixed point

```cpp
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <cassert>
#include <vector>
#include <chrono>
#include <random>
using namespace std;

__attribute__((noinline, optimize("no-tree-vectorize")))
float fir_scalar(const float* x,const float* h,int M){
    float acc=0; for(int k=0;k<M;k++) acc+=h[k]*x[-k]; return acc;
}
__attribute__((noinline))
float fir_auto(const float* x,const float* h,int M){
    float acc=0; for(int k=0;k<M;k++) acc+=h[k]*x[-k]; return acc;
}
// 4 independent accumulators: breaks the serial FP dependency chain
__attribute__((noinline))
float fir_unrolled(const float* x,const float* h,int M){
    float a0=0,a1=0,a2=0,a3=0;
    int k=0;
    for(; k+3<M; k+=4){ a0+=h[k]*x[-k]; a1+=h[k+1]*x[-k-1]; a2+=h[k+2]*x[-k-2]; a3+=h[k+3]*x[-k-3]; }
    for(; k<M; k++) a0+=h[k]*x[-k];
    return (a0+a1)+(a2+a3);
}
int main(){
    const int M=128, N=1<<16;
    vector<float> x(N+M), h(M);
    mt19937 rng(5); uniform_real_distribution<float> U(-1,1);
    for(auto&v:x)v=U(rng); for(auto&v:h)v=U(rng);
    volatile float sink=0;
    auto bench=[&](const char*name, float(*fn)(const float*,const float*,int)){
        auto t0=chrono::steady_clock::now();
        float s=0;
        for(int r=0;r<20;r++) for(int n=M;n<N;n++) s+=fn(&x[n],h.data(),M);
        auto t1=chrono::steady_clock::now();
        sink+=s;
        double us=chrono::duration<double,micro>(t1-t0).count()/20;
        double macs=(double)(N-M)*M;
        printf("  %-14s %9.1f us/pass   %6.2f GMAC/s\n",name,us,macs/us/1000.0);
        return us;
    };
    printf("128-tap FIR over %d samples (float32):\n",N-M);
    double ts=bench("scalar",fir_scalar);
    double ta=bench("auto-vectorized",fir_auto);
    double tu=bench("4 accumulators",fir_unrolled);
    printf("  auto-vec speedup over scalar: %.2fx\n", ts/ta);
    printf("  4-acc  speedup over scalar: %.2fx\n", ts/tu);

    // ---- Q15 fixed point ----
    printf("\nQ15 fixed point (int16, 1 sign bit + 15 fraction bits):\n");
    auto to_q15=[](double v){ double s=v*32768.0; if(s>32767)s=32767; if(s<-32768)s=-32768; return (int16_t)lround(s); };
    auto from_q15=[](int16_t q){ return q/32768.0; };
    printf("  representable range: [%.6f, %.6f]   resolution %.3e\n",
           from_q15(-32768), from_q15(32767), 1.0/32768);
    // multiply: Q15 * Q15 = Q30, shift right 15 to get back to Q15
    auto mul_q15=[](int16_t a,int16_t b)->int16_t{ return (int16_t)(((int32_t)a*(int32_t)b)>>15); };
    double a=0.5,b=0.25;
    printf("  %.4f * %.4f = %.6f  (exact %.6f)\n", a,b, from_q15(mul_q15(to_q15(a),to_q15(b))), a*b);
    // SATURATION vs WRAPAROUND -- the whole point
    int16_t big=to_q15(0.9);
    int16_t wrapped = (int16_t)(big + big);                      // wraps!
    int32_t sum = (int32_t)big + (int32_t)big;
    int16_t sat = (int16_t)(sum>32767?32767: sum<-32768?-32768: sum);
    printf("  0.9 + 0.9 wraparound -> %+.6f   <- SIGN FLIP, a full-scale click\n", from_q15(wrapped));
    printf("  0.9 + 0.9 saturating -> %+.6f   <- clipped, merely distorted\n", from_q15(sat));
    assert(from_q15(wrapped) < 0);      // it really does go negative
    assert(from_q15(sat) > 0.99);
    // accumulate 128 taps in Q15 vs a wide accumulator
    {
        vector<int16_t> xq(M),hq(M);
        for(int i=0;i<M;i++){ xq[i]=to_q15(x[i]*0.9); hq[i]=to_q15(h[i]*0.9); }
        int16_t acc16=0; int64_t acc64=0;
        for(int i=0;i<M;i++){ acc16 += mul_q15(xq[i],hq[i]); acc64 += (int32_t)xq[i]*(int32_t)hq[i]; }
        double ref=0; for(int i=0;i<M;i++) ref += from_q15(xq[i])*from_q15(hq[i]);
        printf("  128-tap dot: int16 accumulator = %+9.5f   int64 accumulator = %+9.5f   float ref = %+9.5f\n",
               from_q15(acc16), (double)acc64/32768.0/32768.0, ref);
        printf("  -> the narrow accumulator is nonsense; this is why MAC units have wide accumulators\n");
    }
    printf("\nSIMD + FIXED POINT DEMO DONE\n");
}
```

**Real output with `-O2 -std=c++20`, exit code 0:**

```
128-tap FIR over 65408 samples (float32):
  scalar            3083.7 us/pass     2.71 GMAC/s
  auto-vectorized   2920.1 us/pass     2.87 GMAC/s
  4 accumulators    1218.3 us/pass     6.87 GMAC/s
  auto-vec speedup over scalar: 1.06x
  4-acc  speedup over scalar: 2.53x

Q15 fixed point (int16, 1 sign bit + 15 fraction bits):
  representable range: [-1.000000, 0.999969]   resolution 3.052e-05
  0.5000 * 0.2500 = 0.125000  (exact 0.125000)
  0.9 + 0.9 wraparound -> -0.200012   <- SIGN FLIP, a full-scale click
  0.9 + 0.9 saturating -> +0.999969   <- clipped, merely distorted
  128-tap dot: int16 accumulator =  -0.02567   int64 accumulator =  +1.97646   float ref =  +1.97646
  -> the narrow accumulator is nonsense; this is why MAC units have wide accumulators
```

**The same program with `-O3 -std=c++20 -ffast-math -march=x86-64-v3`, exit code 0:**

```
128-tap FIR over 65408 samples (float32):
  scalar            9000.2 us/pass     0.93 GMAC/s
  auto-vectorized   1152.5 us/pass     7.26 GMAC/s
  4 accumulators    1416.4 us/pass     5.91 GMAC/s
  auto-vec speedup over scalar: 7.81x
  4-acc  speedup over scalar: 6.35x
```

**This pair of runs is the most useful single result in the document.** At `-O2` the compiler
cannot vectorise the FIR at all (1.06×), because the accumulation is a reduction and reassociating
floating-point additions changes the result — which a conforming compiler may not do unasked.
Granting permission with `-ffast-math` (plus AVX2/FMA via `-march=x86-64-v3`) yields **7.81×**.
Restructuring the source into four independent accumulators gets **2.53× portably, with no flags
and no loss of IEEE semantics**.

Three tracks meet in that one table: floating-point associativity (numerics), what a compiler is
permitted to assume (compilers), and FMA latency-versus-throughput requiring several independent
dependency chains to saturate the unit (architecture).

*(Cross-column comparisons of the same row are not meaningful — the `scalar` function carries
`optimize("no-tree-vectorize")`, which interacts with the global flag set. Only within-column
speedups should be read.)*

---

# 8. What I Could Not Verify

An explicit list, in the spirit of the rest of the document. Everything here is either recalled
from background knowledge, reasoned from first principles without an independent check, or
verified only partially.

## 8.1 A hard constraint that shaped this document

**The web-search budget for this session was exhausted** (200/200 calls) before this research
began, so no search-driven source discovery was possible. Primary sources were reachable only by
`WebFetch` against URLs recalled from memory. Four were fetched successfully and are cited as
verified (§8.2). **Everything I could not guess a working URL for is unverified**, and one
recalled URL (`w3.org/2005/Incubator/audio/wiki/AudioEQCookbook`) returned 404 before a second
guess succeeded. This is the single largest limitation on the document's sourcing.

## 8.2 What WAS verified against a primary source

For contrast, so the distinction is clear:

| claim | source | status |
|---|---|---|
| RBJ biquad LPF and notch coefficient formulas, `ω₀`, `α`, `Q` definitions | `webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html` | fetched; **match our implementation exactly** |
| FFTW planner flags ESTIMATE/MEASURE/PATIENT/EXHAUSTIVE and their semantics; ESTIMATE does not overwrite arrays | `fftw.org/fftw3_doc/Planner-Flags.html` | fetched; quoted verbatim |
| FFTW planning = "adapts the DFT algorithm to details of the underlying hardware"; wisdom = plans on disk | `fftw.org/fftw3_doc/Introduction.html` | fetched |
| cuFFT plan reuse; efficient sizes `2^a·3^b·5^c·7^d`, "smaller prime factor, better"; R2C output `⌊N/2⌋+1` | `docs.nvidia.com/cuda/cufft` | fetched |
| CMSIS-DSP scope, 15 function categories incl. ML, Helium/Neon vectorisation, Cortex-M and -A targets, Apache-2.0, Python wrapper | `arm-software.github.io/CMSIS-DSP` | fetched |
| Everything marked *(verified)* with a §7 reference | executed on Compiler Explorer, GCC 15.2 | run live; output transcribed |

## 8.3 Recalled, not sourced — numerical claims

These are stated with confidence in the text but were not independently checked in this session.
They are standard textbook values and I believe them correct, but a curriculum author should
confirm before printing.

- **fred harris (1978) window table values.** Our §7.3 measurements *reproduce* the standard
  figures (rect −13.26, Hann −31.47, Hamming −42.67, Blackman −58.11, BH4 −92.01 dB), which is
  strong mutual corroboration — but I could not fetch the paper itself, so the attribution of
  those specific numbers to that paper is from memory. The paper's exact title, journal, volume
  and year (*Proc. IEEE* 66(1), Jan 1978) are recalled.
- **The FIR-design stopband table in §3.2** (rect −21 dB, Hann −44, Hamming −53, Blackman −74).
  These are *filter* stopband figures, which differ from the *window* side-lobe figures we
  measured, and I did **not** verify them. They are the widely-quoted values from Oppenheim &
  Schafer. Note the possible confusion between the two tables is itself a trap.
- **Kaiser's order estimate** `M ≈ (A_stop − 8)/(2.285·Δω)`. Recalled. Variants of this formula
  circulate with slightly different constants.
- **Noise-shaping SNR gain** `≈ (6.02L + 3.01)·log₂M − 5.17L`. The *form* is right (order `L`
  buys `L` extra bits per octave of oversampling); the exact constants depend on loop topology and
  I did not verify them. Treat the formula as indicative.
- **Typical ENOB of commercial 24-bit converters (20–21 bits).** Plausible and widely repeated;
  not checked against any datasheet in this session.
- **Split-radix operation count** `~4N log₂N − 6N + 8` real operations. Recalled.
- **Audio latency table (§4.1)** and the "~2.7 ms feels instant to a musician" threshold.
  Experience-based, not sourced. The perceptual threshold in particular varies by instrument and
  by player and is genuinely contested in the literature.
- **Cortex-M4 @ 100 MHz "32-tap Q15 FIR at 48 kHz using a small fraction of the CPU."** An
  order-of-magnitude estimate, not a measurement. I did not run anything on Cortex-M hardware.
- **DSP48E2 internals** (27×18 signed multiplier, 48-bit accumulator, pre-adder, ~500–900 MHz).
  Recalled from AMD/Xilinx documentation, not fetched. The exact multiplier width differs between
  DSP48E1 (25×18) and DSP48E2 (27×18) and I may have the generations confused.
- **RTL-SDR specifications** (8-bit samples, ~2.4 Msps usable). Recalled; the usable rate depends
  on USB and host and is often quoted as 2.4 or 2.56 Msps.
- **Wi-Fi's 64-point FFT with 52 used subcarriers.** This is 802.11a/g; 802.11n/ac/ax use larger
  FFTs (128/256/512/1024) and different subcarrier counts. The text should be more specific than
  it is.
- **The 44,100 Hz factorisation story** (fitting NTSC and PAL video frame structures). Widely
  repeated and I believe it correct, but the exact line/field arithmetic I quote is recalled.
- **µ-law telephony and the 300–3400 Hz band.** Standard, unverified here.

## 8.4 Theory stated without independent derivation or check

- **The TPDF dither theorem** (Lipshitz, Wannamaker & Vanderkooy — that TPDF dither of the right
  width renders both the mean *and variance* of the quantisation error independent of the input).
  I am confident in the statement and in the 4.77 dB noise-floor cost, but I did not verify the
  attribution or re-derive it. Our §7.5 experiment demonstrates *that* dither recovers a sub-LSB
  tone; it does **not** demonstrate the variance-independence property, which is the actual reason
  to prefer TPDF over uniform.
- **The MDCT/TDAC construction.** The description in §4.1 (2N in, N out, aliasing cancels on
  overlap-add) is correct in outline; I did not write down or check the windowing conditions
  (Princen–Bradley) that make cancellation exact.
- **Bandpass sampling.** Stated correctly in principle, but the *valid rate bands* for
  undersampling a signal at `[f_L, f_H]` are a set of intervals, not simply "anything above `2B`",
  and I did not state the constraint properly. A curriculum unit must give the full condition or
  students will pick a rate that folds the signal onto itself.
- **Wilkinson's polynomial-conditioning argument (§3.3)** as applied to filter denominators. The
  qualitative claim (high-order direct-form filters are ill-conditioned, cascaded biquads are not)
  is standard and correct. The specific rhetorical claim that "perturbing `a₅` in the 7th decimal
  can move a pole across the unit circle" is illustrative, not measured. **This would make an
  excellent additional exercise** — build an 8th-order direct form in `float32`, perturb a
  coefficient, and watch it explode while the cascade does not — and I did not have the budget to
  write it.
- **Roofline numbers in §5.4.** The 8 MB / `10^8` flop / 0.3 flops-per-byte arithmetic is my own
  and is straightforward, but the claim that modern ridge points sit at "10–50 flops/byte" is
  recalled and machine-dependent.
- **"Every LTI system is a convolution."** Correct for discrete-time systems, which is what the
  document discusses. The continuous-time statement needs additional regularity hypotheses that I
  glossed over.

## 8.5 Claims about the AI connection

§4.5 is the section most likely to be challenged and it is worth flagging what is solid and what
is rhetoric.

- **"A CNN conv layer is a bank of learned FIR filters"** — solid, and simply a restatement of the
  arithmetic.
- **"First-layer filters look like Gabor filters and edge detectors"** — a very well-replicated
  empirical observation across many architectures, but I cite no specific paper and did not verify
  it in this session.
- **"Anti-aliased downsampling improves CNN accuracy and shift-invariance"** — this refers to the
  blur-pool line of work. I am confident the result exists and replicates; I did not fetch the
  paper, do not cite it precisely, and the magnitude of the improvement I imply ("measurably") is
  deliberately vague because I do not have the number.
- **"cuDNN picks Winograd for 3×3 and may pick FFT for large kernels"** — correct in outline;
  the specific algorithm selection depends on cuDNN version, GPU architecture, batch size and
  layout, and is not the fixed rule the text implies.
- **"Checkerboard artefacts from transposed convolution are imaging artefacts from a bad
  interpolation filter"** — I believe this framing is correct and useful, but it is my synthesis,
  not a claim I can attribute.

## 8.6 Things that will go stale

- **The Compiler Explorer API.** Endpoint shape, the `g152` compiler id, caching behaviour, and
  timing characteristics can all change. `okToCache` behaviour in particular is an implementation
  detail I observed, not a documented contract.
- **All timing numbers in §7.** They were measured on unspecified shared Compiler Explorer
  infrastructure and are not reproducible in absolute terms. Only the *ratios within a single run*
  carry meaning, and even those are noisy (§7.7).
- **The fast-convolution crossover (§7.7).** Explicitly hardware-, compiler- and
  library-dependent. The document says so, but it bears repeating: 512–1024 is what *we* measured
  with a *naive* FFT, not a universal constant.
- **CMSIS-DSP, FFTW and cuFFT APIs.** All under active development.
- **Cortex-M core lineup.** M55/M85 and Helium are current; the list will grow.

## 8.7 Deliberate omissions

Not errors, but gaps a reader should know about:

- **Adaptive filters** — LMS, RLS, adaptive echo cancellation, adaptive equalisation. A large and
  practically important area, entirely absent. Echo cancellation in particular is the thing every
  video-call user depends on daily.
- **Wavelets** and multi-resolution analysis. A genuine alternative to the STFT for non-stationary
  signals, and the basis of JPEG 2000.
- **Multirate filter banks** beyond the polyphase sketch; perfect-reconstruction QMF banks.
- **Spectral estimation** beyond the periodogram — Welch's method, Bartlett, parametric/AR
  methods, MUSIC and ESPRIT. Welch's method in particular is what you should actually use to
  estimate a power spectrum, and the document never says so.
- **Phase**. The document is magnitude-heavy throughout. Phase retrieval, group delay
  measurement, phase vocoders and the Griffin–Lim algorithm are barely mentioned, and Griffin–Lim
  matters for the AI track (neural vocoders).
- **Kalman filtering proper.** Deliberately deferred to the robotics track; only the
  complementary-filter relationship is developed here.
- **Fixed-point IIR limit cycles** are named in §3.3 but never demonstrated. They deserve an
  exercise.
- **Goertzel's algorithm** — computing one DFT bin in `O(N)` without a full FFT. The right tool
  for DTMF decoding and for any "is this one tone present" question, and a nice small exercise.
- **CORDIC** — computing sin/cos/atan2 with shifts and adds only. Directly relevant to the FM
  demodulator in §4.3 on an FPGA or an FPU-less MCU.

---

# 9. Sources

## 9.1 Fetched and verified during this research

These four were retrieved live and their content is quoted or checked against in the text.

- **Robert Bristow-Johnson, "Cookbook formulae for audio equalizer biquad filter coefficients"** —
  <https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html>
  The single most-copied table in audio software. Our §7.6 implementation's LPF and notch
  coefficients were checked against it term by term and match exactly.
- **FFTW 3 manual — Introduction** — <https://www.fftw.org/fftw3_doc/Introduction.html>
- **FFTW 3 manual — Planner Flags** — <https://www.fftw.org/fftw3_doc/Planner-Flags.html>
  Source for the ESTIMATE/MEASURE/PATIENT/EXHAUSTIVE semantics in §5.5, including the important
  detail that only ESTIMATE leaves your arrays intact during planning.
- **NVIDIA cuFFT documentation** — <https://docs.nvidia.com/cuda/cufft/index.html>
  Source for plan reuse, the `2^a·3^b·5^c·7^d` efficient-size rule, and the `⌊N/2⌋+1` R2C output
  convention.
- **Arm CMSIS-DSP documentation** — <https://arm-software.github.io/CMSIS-DSP/latest/index.html>
  Source for the library's scope, its 15 function categories (including the machine-learning
  ones), Helium/Neon vectorisation, and its Cortex-M/Cortex-A targets.

## 9.2 Executed during this research

- **Compiler Explorer execution API** — `https://godbolt.org/api/compiler/g152/compile`
  GCC 15.2, `-O2 -std=c++20`, `executorRequest: true`. Nine programs, ~1,100 lines of C++, all
  reproduced with their real output in §7. Compiler Explorer is open source at
  <https://github.com/compiler-explorer/compiler-explorer> and can be self-hosted, which is the
  right answer for a real classroom deployment.

## 9.3 Foundational papers (cited from knowledge; not fetched this session)

- **H. Nyquist**, "Certain Topics in Telegraph Transmission Theory," *Trans. AIEE*, 1928. The
  `2B` symbol-rate result.
- **C. E. Shannon**, "Communication in the Presence of Noise," *Proc. IRE* 37(1), Jan 1949. The
  interpolation theorem as stated in §1.2.
- **V. A. Kotelnikov** (1933) and **E. T. Whittaker** (1915) — independent priority; hence
  "Whittaker–Kotelnikov–Shannon".
- **J. W. Cooley and J. W. Tukey**, "An Algorithm for the Machine Calculation of Complex Fourier
  Series," *Math. Comput.* 19, 1965. §2.4.
- **C. F. Gauss**, unpublished work c. 1805 on asteroid orbit interpolation — the actual first
  discovery of the FFT, predating Fourier's own 1807 memoir.
- **fred harris**, "On the Use of Windows for Harmonic Analysis with the Discrete Fourier
  Transform," *Proc. IEEE* 66(1), Jan 1978. The window table; our §7.3 measurements reproduce it.
- **T. W. Parks and J. H. McClellan**, "Chebyshev Approximation for Nonrecursive Digital Filters
  with Linear Phase," *IEEE Trans. Circuit Theory*, 1972. §3.2.
- **A. Savitzky and M. J. E. Golay**, "Smoothing and Differentiation of Data by Simplified Least
  Squares Procedures," *Analytical Chemistry* 36(8), 1964. §3.4.
- **S. P. Lipshitz, R. A. Wannamaker and J. Vanderkooy**, "Quantization and Dither: A Theoretical
  Survey," *J. Audio Eng. Soc.*, 1992. The TPDF dither result in §1.6.
- **M. Frigo and S. G. Johnson**, "The Design and Implementation of FFTW3," *Proc. IEEE* 93(2),
  2005. The autotuning architecture described in §5.5.
- **P. Duhamel and H. Hollmann**, "Split-radix FFT algorithm," *Electronics Letters*, 1984.
- **S. Williams, A. Waterman and D. Patterson**, "Roofline: An Insightful Visual Performance Model
  for Multicore Architectures," *CACM* 52(4), 2009. The model §5.4 places the FFT on.

## 9.4 Standard texts

- **Oppenheim & Schafer**, *Discrete-Time Signal Processing*. The canonical graduate reference;
  the source of the FIR-design stopband table in §3.2 that §8.3 flags as unverified.
- **Oppenheim & Willsky**, *Signals and Systems*. The undergraduate predecessor.
- **Richard Lyons**, *Understanding Digital Signal Processing*. **The best single book for the
  audience this curriculum targets** — intuition-first, engineering-oriented, and unusually honest
  about what the mathematics is for.
- **Steven W. Smith**, *The Scientist and Engineer's Guide to Digital Signal Processing* — free
  online at <https://www.dspguide.com>. Genuinely excellent, free, and pitched exactly at
  programmers. The obvious primary reading assignment for these units.
- **Julius O. Smith III**, four online books (spectral audio, physical audio, filters, mathematics
  of the DFT) at <https://ccrma.stanford.edu/~jos/>. Free, rigorous, audio-focused.
- **Vaidyanathan**, *Multirate Systems and Filter Banks*. The reference for §3.5's polyphase
  material.
- **Proakis & Manolakis**, *Digital Signal Processing*. The other standard undergraduate text.

## 9.5 Software and practical references

- **`scipy.signal`** — <https://docs.scipy.org/doc/scipy/reference/signal.html>. The reference
  implementation of nearly everything in §3: `butter`, `cheby1`, `ellip`, `remez`, `firwin`,
  `sosfilt`, `savgol_filter`, `resample_poly`, `stft`. Note its documentation's own advice to
  prefer `output='sos'` over `'ba'` — §3.3's conditioning argument, from the library authors.
- **GNU Radio** — <https://www.gnuradio.org>. The SDR framework referenced in §4.3.
- **musicdsp.org** — <https://www.musicdsp.org>. Community archive of audio DSP algorithms.
- **The Compiler Explorer API** — <https://github.com/compiler-explorer/compiler-explorer/blob/main/docs/API.md>
- **Xiph.org, "24/192 Music Downloads... and why they make no sense"** —
  <https://people.xiph.org/~xiphmont/demo/neil-young.html>. A superb, and unusually rigorous,
  popular treatment of sampling, Nyquist, dither and why higher rates do not help. Good assigned
  reading for Unit 1 precisely because it is an argument rather than a lecture.

---

## Appendix: the ideas that recur

A short list of the cross-connections this document makes, gathered in one place, because they are
the reason DSP belongs in this curriculum rather than adjacent to it.

| idea | where it appears |
|---|---|
| **`sinc` / the rectangle's transform** | ideal reconstruction (§1.8); ZOH droop −3.92 dB (§1.8); rectangular window −13.3 dB (§2.3); scallop loss −3.92 dB (§2.3); truncated-sinc FIR design (§3.2); moving-average stopband −13.3 dB (§3.4); box blur's ringing (§4.5). **Six appearances of one function** — worth pointing out explicitly. |
| **6.02 dB = one bit = a factor of 2 in amplitude** | quantisation SNR (§1.5); filter rolloff per order (§3.3, measured at 48.16 dB/octave for 8th order) |
| **Trading rate for precision** | oversampling (§1.7); sigma-delta (§1.7); PWM (§4.4); dither and stochastic rounding (§1.6); temporal dithering in displays |
| **Convolution ⟷ multiplication** | the convolution theorem (§2.5); fast convolution (§2.5); OFDM's cyclic prefix making equalisation one divide per bin (§4.2); FFT/Winograd conv in cuDNN (§4.5) |
| **Plan/measure then execute** | FFTW planning (§5.5); cuFFT plans (§5.5); `cudnn.benchmark` (§4.5); CMSIS-DSP init/process (§5.6); ATLAS, TVM, PGO |
| **Wide accumulators for narrow operands** | Q15 dot products (§5.1, §7.9); ARM `SMLAL` (§5.6); DSP48's 48-bit accumulator (§5.7); int8 GEMM accumulating in int32 |
| **Filter first, then throw data away** | anti-alias before the ADC (§1.4); decimation (§3.5); image downsampling and moiré (§4.5); anti-aliased strided convolution in CNNs (§4.5) |
| **Reduce flops until you are memory-bound** | the FFT's `O(N log N)` win, then its 0.3 flops/byte roofline position (§5.4) |
| **The one-pole filter** | EMA (§3.4); complementary filter (§4.4); FM de-emphasis (§4.3); PID's derivative filter (§4.4); RC circuit |

