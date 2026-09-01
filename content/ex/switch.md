## The floor nobody can lift

Compute the minimum subthreshold slope in millivolts per decade at a given
temperature. It is `(k*T/q) * ln(10)`, and the checks run it at three
temperatures.

@kind output
@concept The 60 mV per decade floor is thermal energy divided by charge. It is
physics rather than a manufacturing limit.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The answer is in volts per decade until you multiply by 1000.
@diagnose wrong verdict nonzero-exit
Read the value the check prints against the one it wanted. At 300 K the answer
is about 59.5, so an answer near 0.0595 means the millivolts are missing, and an
answer near 25.9 means the natural log of ten is.

The reason it has to be `ln(10)` and not `log10` is that the exponential decay
below threshold is in `e`, and you are converting a factor of `e` into a factor
of ten.
@diagnose compile verdict compile-error
Read the line the compiler names. `log` is in `<math.h>`, and on this toolchain
maths functions need `-lm`, which the flags already pass.
@after Notice the temperature dependence. At 85 degrees, a normal junction
temperature under load, the floor is 71 rather than 59.5, so a hot chip leaks
more for two separate reasons.

```starter
#include <math.h>

/* Boltzmann's constant, in joules per kelvin. */
#define K 1.380649e-23
/* The elementary charge, in coulombs. */
#define Q 1.602176634e-19

double min_slope_mv_per_decade(double kelvin) {
    return K * kelvin / Q;
}
```

```tests
#include <stdio.h>
#include <stdlib.h>
static int close_to(double a, double b) { return fabs(a - b) < 0.5; }
int main(void) {
    struct { double t, want; } c[] = {{300, 59.5}, {358, 71.0}, {273, 54.2}};
    for (int i = 0; i < 3; i++) {
        double got = min_slope_mv_per_decade(c[i].t);
        if (!close_to(got, c[i].want)) {
            printf("at %.0f K got %.4f, want about %.1f\n", c[i].t, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

#define K 1.380649e-23
#define Q 1.602176634e-19

double min_slope_mv_per_decade(double kelvin) {
    return 1000.0 * (K * kelvin / Q) * log(10.0);
}
```

## What a hundred millivolts costs

Given a subthreshold slope in millivolts per decade, return the factor by which
off-current grows when the threshold voltage is lowered by some number of
millivolts.

@kind output
@concept Leakage is exponential in threshold voltage, so a small change in
threshold is a large change in power.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint A decade is a factor of ten. How many decades is the drop?
@diagnose wrong verdict nonzero-exit
The drop divided by the slope is a number of decades, and the factor is ten
raised to it. A result of about 1.67 means you returned the number of decades
instead of the factor.
@after At 60 mV per decade, 100 mV of threshold is a factor of 46. That is the
number that ended voltage scaling, and you just computed it.

```starter
#include <math.h>

/* slope_mv: millivolts of gate voltage per decade of current.
   drop_mv:  how far the threshold voltage is lowered, in millivolts. */
double leakage_factor(double slope_mv, double drop_mv) {
    return drop_mv / slope_mv;
}
```

```tests
#include <stdio.h>
int main(void) {
    struct { double s, d, want; } c[] = {
        {60, 100, 46.4}, {60, 60, 10.0}, {90, 100, 12.9}, {60, 0, 1.0},
    };
    for (int i = 0; i < 4; i++) {
        double got = leakage_factor(c[i].s, c[i].d);
        if (fabs(got - c[i].want) > 0.2) {
            printf("slope %.0f drop %.0f: got %.3f want about %.1f\n",
                   c[i].s, c[i].d, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double leakage_factor(double slope_mv, double drop_mv) {
    return pow(10.0, drop_mv / slope_mv);
}
```

## The energy in one transition

Return the energy in joules that a full charge and discharge of a gate
capacitance costs, given the capacitance in farads and the supply in volts.

@kind output
@concept Switching energy goes as the square of the supply voltage, which is
why the supply voltage is the lever everyone reached for.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint The charge moved is `C*V` and it falls through `V`.
@diagnose wrong verdict nonzero-exit
Compare what the check printed against what it wanted. Half of the right answer
means you used the energy stored in the capacitor, which is `CV squared over
two`, rather than the energy taken from the supply to put it there.

Both numbers are real and they are different. The supply delivers `CV squared`;
half of it ends up in the capacitor and the other half is dissipated in the
transistor doing the charging.
@after Five volts to one volt is a factor of 25 in this number, per transition.
That is what made the first thirty years of scaling feel free.

```starter
double switch_energy(double farads, double volts) {
    return farads * volts;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double c, v, want; } t[] = {
        {1e-15, 1.0, 1e-15}, {1e-15, 5.0, 2.5e-14}, {2e-15, 0.8, 1.28e-15},
    };
    for (int i = 0; i < 3; i++) {
        double got = switch_energy(t[i].c, t[i].v);
        if (fabs(got - t[i].want) > t[i].want * 1e-6) {
            printf("C=%g V=%g: got %g want %g\n", t[i].c, t[i].v, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double switch_energy(double farads, double volts) {
    return farads * volts * volts;
}
```

## The high an NMOS cannot deliver

An NMOS transistor passing a high shuts itself off before reaching the supply.
Return the highest output voltage it can deliver, given the supply and the
threshold.

@kind output
@concept A transistor passing the level it is bad at stops when its own
gate-to-source voltage falls to the threshold.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint The gate is held at the supply. What is the gate-to-source voltage when
the source has risen to `v`?
@diagnose wrong verdict nonzero-exit
As the output rises, the source terminal rises with it, so the gate-to-source
voltage is the supply minus the output. The transistor conducts while that
exceeds the threshold, and stops when it does not.

This is why pull-up networks are built from PMOS. Not by convention: an NMOS
pull-up physically cannot finish the job.
@after At a 1 V supply and a 0.4 V threshold the best it can do is 0.6 V, which
the next stage may not read as a high at all. That is a design that works in
simulation and fails on a board.

```starter
double nmos_best_high(double supply, double vth) {
    return supply;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double s, t, want; } c[] = {
        {5.0, 0.7, 4.3}, {1.0, 0.4, 0.6}, {1.8, 0.5, 1.3},
    };
    for (int i = 0; i < 3; i++) {
        double got = nmos_best_high(c[i].s, c[i].t);
        if (fabs(got - c[i].want) > 1e-9) {
            printf("supply %.1f vth %.1f: got %.3f want %.3f\n",
                   c[i].s, c[i].t, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double nmos_best_high(double supply, double vth) {
    return supply - vth;
}
```

## Leakage, times a billion

Return the total static power in watts for a chip, given the off-current of one
transistor in amps, the supply in volts, and how many transistors there are.

@kind output
@concept Static power is spent whether or not the chip is doing anything, which
is what makes it different from every other cost so far.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint Power is current times voltage, and the current is per transistor.
@diagnose wrong verdict nonzero-exit
Read the numbers the check printed. Multiplying by the count is the step that
turns a number too small to care about into a number that decides whether the
part is buildable.
@diagnose overflow verdict nonzero-exit
A count of ten billion in an `int` is not ten billion. Check the type of the
parameter before you check the arithmetic.
@after A nanoamp is nothing. A nanoamp times ten billion is ten amps, and at one
volt that is ten watts of doing nothing at all.

```starter
double static_watts(double amps_per_transistor, double volts, double count) {
    return amps_per_transistor * volts;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double a, v, n, want; } c[] = {
        {1e-9, 1.0, 1e10, 10.0}, {1e-12, 1.0, 1e9, 1e-3}, {5e-9, 0.8, 2e10, 80.0},
    };
    for (int i = 0; i < 3; i++) {
        double got = static_watts(c[i].a, c[i].v, c[i].n);
        if (fabs(got - c[i].want) > c[i].want * 1e-9) {
            printf("%g A, %g V, %g transistors: got %g want %g\n",
                   c[i].a, c[i].v, c[i].n, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double static_watts(double amps_per_transistor, double volts, double count) {
    return amps_per_transistor * volts * count;
}
```

## How long a gate takes

Return the propagation delay of a gate, given its on-resistance in ohms and the
capacitance it drives in farads. Use the first-order estimate.

@kind output
@concept Delay is resistance times capacitance, which is why making a
transistor wider is not free: it drives faster and loads its own driver more.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint The constant is `ln(2)`, which is about 0.69, because the delay is
measured to the halfway point.
@diagnose wrong verdict nonzero-exit
An answer exactly `R*C` means the constant is missing. Delay here is measured
from an input crossing halfway to the output crossing halfway, and an
exponential reaches half in `ln(2)` time constants.
@after Doubling the width halves the resistance and doubles the input
capacitance. The gate gets faster and whatever drives it gets slower, which is
why you cannot make a chip fast by making everything big.

```starter
double prop_delay(double ohms, double farads) {
    return ohms * farads;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double r, c, want; } t[] = {
        {1000, 1e-15, 6.93e-13}, {5000, 2e-15, 6.93e-12}, {200, 1e-14, 1.386e-12},
    };
    for (int i = 0; i < 3; i++) {
        double got = prop_delay(t[i].r, t[i].c);
        if (fabs(got - t[i].want) > t[i].want * 0.01) {
            printf("R=%g C=%g: got %g want %g\n", t[i].r, t[i].c, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double prop_delay(double ohms, double farads) {
    return log(2.0) * ohms * farads;
}
```

## The on to off ratio

Return how many times more current flows at the supply voltage than at zero,
given the threshold, the supply and the subthreshold slope, using only the
subthreshold behaviour extrapolated across the whole range.

@kind output
@concept The number of decades between off and on is the whole gate voltage
divided by the slope, which is why a bigger supply used to buy a better switch.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The exponent is a count of decades, and the answer is ten to it.
@diagnose wrong verdict nonzero-exit
The gate voltage swing is the supply in millivolts. Divide by the slope for a
number of decades and raise ten to it. Returning the exponent instead of the
power gives about 16.7 where the answer is nearly ten to the seventeenth.
@after A one volt supply at 60 mV per decade gives roughly seventeen decades of
range. Halve the supply and you halve the decades, which is not a small change
to a switch: it is the difference between off and nearly off.

```starter
#include <math.h>

double on_off_ratio(double supply_v, double slope_mv) {
    return supply_v * 1000.0 / slope_mv;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double v, s, want_log; } c[] = {
        {1.0, 60, 16.667}, {0.5, 60, 8.333}, {1.8, 90, 20.0},
    };
    for (int i = 0; i < 3; i++) {
        double got = on_off_ratio(c[i].v, c[i].s);
        if (got <= 0 || fabs(log10(got) - c[i].want_log) > 0.02) {
            printf("supply %.1f slope %.0f: got %g, want about 1e%.2f\n",
                   c[i].v, c[i].s, got, c[i].want_log);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double on_off_ratio(double supply_v, double slope_mv) {
    return pow(10.0, supply_v * 1000.0 / slope_mv);
}
```

## Where the heat comes from

Return the fraction of total power that is static, given dynamic watts and
static watts, so the checks can walk it across four process generations.

@kind output
@concept Static power went from a rounding error to a third of the budget in
about four generations, and that is the event the next two units are about.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint A fraction of the total, not a ratio of one to the other.
@diagnose wrong verdict nonzero-exit
The denominator is the total, which is both terms added together. Dividing
static by dynamic gives a number that exceeds one when static wins, and a
fraction cannot.
@diagnose divzero verdict signal
Both inputs were zero, so the total is zero. Decide what a fraction of nothing
should be and say so explicitly rather than dividing and hoping.
@after The last row is a part where leakage is a third of the power before any
work is done. Nothing in the instruction set changed to cause that, and nothing
in the instruction set could fix it.

```starter
double static_fraction(double dynamic_w, double static_w) {
    return static_w / dynamic_w;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double d, s, want; } c[] = {
        {100, 1, 0.0099}, {100, 25, 0.2}, {60, 30, 0.3333}, {50, 50, 0.5},
    };
    for (int i = 0; i < 4; i++) {
        double got = static_fraction(c[i].d, c[i].s);
        if (fabs(got - c[i].want) > 0.002) {
            printf("dynamic %.0f static %.0f: got %.4f want %.4f\n",
                   c[i].d, c[i].s, got, c[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double static_fraction(double dynamic_w, double static_w) {
    return static_w / (dynamic_w + static_w);
}
```
