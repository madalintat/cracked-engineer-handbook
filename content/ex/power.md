## The equation itself

Return the dynamic power of a block, given the activity factor, the switched
capacitance in farads, the supply in volts and the clock in hertz.

@kind output
@concept Dynamic power is linear in three of its terms and quadratic in the
fourth, which is the whole reason voltage was the lever everyone pulled.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint One of the four terms is squared.
@diagnose wrong verdict nonzero-exit
Compare the numbers the check printed. A result that is too small by exactly the
supply voltage means `V` appears once rather than twice, which is the term the
next several exercises are all about.
@after A clock line has an activity factor of one, because it switches every
cycle by definition. That is why the clock network is often the single largest
consumer on a chip.

```starter
double dynamic_watts(double alpha, double farads, double volts, double hertz) {
    return alpha * farads * volts * hertz;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double a, c, v, f, want; } t[] = {
        {0.1, 1e-9, 1.0, 1e9, 0.1},
        {1.0, 1e-9, 1.0, 1e9, 1.0},
        {0.1, 1e-9, 2.0, 1e9, 0.4},
        {0.2, 5e-10, 0.9, 2e9, 0.162},
    };
    for (int i = 0; i < 4; i++) {
        double got = dynamic_watts(t[i].a, t[i].c, t[i].v, t[i].f);
        if (fabs(got - t[i].want) > t[i].want * 1e-9) {
            printf("case %d: got %g want %g\n", i, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double dynamic_watts(double alpha, double farads, double volts, double hertz) {
    return alpha * farads * volts * volts * hertz;
}
```

## The bargain, tabulated

Return power density relative to the starting generation, after `n` generations
of Dennard scaling, where every dimension and the supply both scale by 0.7.

@kind output
@concept Under constant-field scaling power per area does not change, which is
what made thirty years of speedup free.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint Work out how power per device scales and how area scales, then divide.
@diagnose wrong verdict nonzero-exit
Capacitance falls by 0.7 and the supply falls by 0.7, so power per device falls
by 0.7 cubed times the frequency rise of 1/0.7, which is 0.49. Area also falls
by 0.49. The ratio is one, at every generation, which is the point of the whole
table.
@after The answer is 1 for every input, and the exercise exists so you get that
by computing it rather than by being told. The next one holds the voltage fixed
and the same arithmetic gives a very different column.

```starter
#include <math.h>

double dennard_density(int generations) {
    return pow(0.7, generations);
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    for (int n = 0; n <= 5; n++) {
        double got = dennard_density(n);
        if (fabs(got - 1.0) > 1e-9) {
            printf("after %d generations got %.4f, want 1.0\n", n, got);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double dennard_density(int generations) {
    double area = pow(0.49, generations);         /* 0.7 x 0.7 */
    double power = pow(0.49, generations);        /* C and V both fall */
    return power / area;
}
```

## The same table with the voltage stuck

Now return power density after `n` generations when dimensions still scale by
0.7 but the supply voltage does not move and power per device stays the same.

@kind output
@concept The whole post-2005 problem is one term refusing to scale while
everything around it continues.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The numerator stopped changing. The denominator did not.
@diagnose wrong verdict nonzero-exit
Power per device is now constant, so the density is one divided by the area, and
the area is 0.49 to the number of generations. An answer that falls rather than
rises means the division is the wrong way round.
@after Five generations gives 35 times. That is the number that ended the
frequency era, and no cooling solution closes a gap of 35.

```starter
#include <math.h>

double frozen_density(int generations) {
    return pow(0.49, generations);
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    double want[] = {1.0, 2.04, 4.16, 8.50, 17.35, 35.40};
    for (int n = 0; n <= 5; n++) {
        double got = frozen_density(n);
        if (fabs(got - want[n]) > want[n] * 0.01) {
            printf("after %d generations got %.2f, want about %.2f\n",
                   n, got, want[n]);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double frozen_density(int generations) {
    return 1.0 / pow(0.49, generations);
}
```

## Two slow cores against one fast one

Return the total power of `n` cores each running at a frequency scaled by `s`,
relative to one core at full speed, taking power to go as the cube of frequency
because voltage moves with it.

@kind output
@concept Voltage and frequency move together, so power goes roughly as the cube
of either, which is what makes many slow cores beat one fast one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The cube applies to each core, and then there are `n` of them.
@diagnose wrong verdict nonzero-exit
Each core costs the scale factor cubed, and the total is that times the number
of cores. Cubing the total instead of each core gives a very different answer,
and cubing `n` as well gives a worse one.
@after Two cores at 0.75 draw 0.84 of the power of one at full speed and deliver
1.5 times the throughput. That is the whole argument for multicore in one line,
and it is arithmetic rather than opinion.

```starter
#include <math.h>

double relative_power(int cores, double freq_scale) {
    return cores * freq_scale;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { int n; double s, want; } t[] = {
        {1, 1.0, 1.0}, {2, 0.75, 0.84375}, {4, 0.5, 0.5}, {8, 0.4, 0.512},
    };
    for (int i = 0; i < 4; i++) {
        double got = relative_power(t[i].n, t[i].s);
        if (fabs(got - t[i].want) > 1e-6) {
            printf("%d cores at %.2f: got %.5f want %.5f\n",
                   t[i].n, t[i].s, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double relative_power(int cores, double freq_scale) {
    return cores * pow(freq_scale, 3.0);
}
```

## How much of the chip can you switch on

Return the fraction of a chip that can be powered at once, given the power a
fully active chip would draw and the budget the package can remove.

@kind output
@concept When transistors keep arriving and the power budget does not grow, a
growing fraction of the chip has to be off.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint A fraction, and it cannot exceed one however generous the budget is.
@diagnose wrong verdict nonzero-exit
The budget divided by what a fully active chip would draw is the fraction that
can be on. A result above one means the budget exceeds the demand, and the right
answer there is one: you cannot switch on more of a chip than it has.
@after The 2011 paper that named dark silicon projected that at 8 nm between
half and four fifths of a chip may be dark. That is not a failure. It is what
makes it worth filling the area with specialised units that are idle most of the
time.

```starter
double lit_fraction(double full_watts, double budget_watts) {
    return budget_watts / full_watts;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double f, b, want; } t[] = {
        {100, 100, 1.0}, {400, 100, 0.25}, {250, 100, 0.4}, {50, 100, 1.0},
    };
    for (int i = 0; i < 4; i++) {
        double got = lit_fraction(t[i].f, t[i].b);
        if (fabs(got - t[i].want) > 1e-9) {
            printf("full %.0f budget %.0f: got %.3f want %.3f\n",
                   t[i].f, t[i].b, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double lit_fraction(double full_watts, double budget_watts) {
    double f = budget_watts / full_watts;
    return f > 1.0 ? 1.0 : f;
}
```

## What halving the voltage buys

Return the factor by which dynamic power changes when the supply is scaled by
`v` and the frequency by `f`, relative to before.

@kind output
@concept Scaling both is what dynamic voltage and frequency scaling does, and
the two effects multiply rather than add.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint Two of the terms in the power equation moved, and one of them is squared.
@diagnose wrong verdict nonzero-exit
Voltage appears squared and frequency appears once, so the factor is `v*v*f`.
Adding the two scalings rather than multiplying them gives a number that is
larger than either and means nothing.
@after Halving both gives an eighth of the power for half the speed, which is
why a phone drops its clock rather than switching cores off, and why a laptop on
battery feels slower rather than dying sooner.

```starter
double dvfs_factor(double v_scale, double f_scale) {
    return v_scale + f_scale;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double v, f, want; } t[] = {
        {1.0, 1.0, 1.0}, {0.5, 0.5, 0.125}, {0.9, 0.8, 0.648}, {0.7, 1.0, 0.49},
    };
    for (int i = 0; i < 4; i++) {
        double got = dvfs_factor(t[i].v, t[i].f);
        if (fabs(got - t[i].want) > 1e-9) {
            printf("v %.2f f %.2f: got %.4f want %.4f\n",
                   t[i].v, t[i].f, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double dvfs_factor(double v_scale, double f_scale) {
    return v_scale * v_scale * f_scale;
}
```

## Where the power actually goes

Return total chip power, given dynamic watts, per-transistor leakage in amps,
the supply, and the transistor count.

@kind output
@concept Total power is both terms, and the second one is paid whether the chip
is working or not.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint The static term is the one you built two units ago.
@diagnose wrong verdict nonzero-exit
Static power is the leakage current times the supply times the transistor count,
and total power is that added to the dynamic term. Returning only the dynamic
term passes the first row and fails the moment leakage matters.
@after The last row is a part where leakage is most of the budget. Notice that
nothing about it depends on what the chip is doing, which is why an idle server
still has to be cooled and still costs money.

```starter
double total_watts(double dynamic_w, double leak_amps, double volts, double n) {
    return dynamic_w;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double d, l, v, n, want; } t[] = {
        {100, 0, 1.0, 1e9, 100.0},
        {100, 1e-8, 1.0, 1e9, 110.0},
        {60, 5e-8, 0.9, 2e9, 150.0},
    };
    for (int i = 0; i < 3; i++) {
        double got = total_watts(t[i].d, t[i].l, t[i].v, t[i].n);
        if (fabs(got - t[i].want) > 0.01) {
            printf("case %d: got %.2f want %.2f\n", i, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double total_watts(double dynamic_w, double leak_amps, double volts, double n) {
    return dynamic_w + leak_amps * volts * n;
}
```

## The cost of a bit you did not need

Return the relative energy of a multiply, given the mantissa widths before and
after, taking energy to go as the square of the mantissa width.

@kind output
@concept Narrower arithmetic is a power optimisation before it is a memory one,
and that is why four-bit floating point exists at all.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The ratio of the widths, and then the square of it.
@diagnose wrong verdict nonzero-exit
The energy goes as the square of the width, so the ratio of energies is the
square of the ratio of widths. Squaring each width and subtracting gives a
difference rather than a factor.
@after From a 24-bit mantissa to a 1-bit one is a factor of 576 in multiplier
energy, before counting the data movement saved. That number is why the last
part of this handbook exists.

```starter
#include <math.h>

double multiply_energy_ratio(int mantissa_before, int mantissa_after) {
    return (double)mantissa_after / mantissa_before;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { int a, b; double want; } t[] = {
        {24, 24, 1.0},
        {24, 8, 0.1111},
        {24, 1, 0.001736},
        {8, 4, 0.25},
    };
    for (int i = 0; i < 4; i++) {
        double got = multiply_energy_ratio(t[i].a, t[i].b);
        if (fabs(got - t[i].want) > t[i].want * 0.01) {
            printf("%d to %d bits: got %g want about %g\n",
                   t[i].a, t[i].b, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
double multiply_energy_ratio(int mantissa_before, int mantissa_after) {
    double r = (double)mantissa_after / (double)mantissa_before;
    return r * r;
}
```
