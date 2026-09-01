## The simplest yield model

Return Poisson yield: the fraction of dies that survive when defects of density
`d` per square millimetre land independently and uniformly on a die of area `a`.

@kind output
@concept Yield falls exponentially with area, which is the fact that decides
the physical shape of every large chip.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The chance that none of them lands on the die.
@diagnose wrong verdict nonzero-exit
The expected number of defects on the die is `d*a`, and the chance of none is
`e` to minus that. A result that grows with area has the sign of the exponent
the wrong way round.
@after Doubling the area does not halve the yield, it squares it. Everything
else in this unit is a consequence of that shape.

```starter
#include <math.h>

double poisson_yield(double d, double a) {
    return exp(d * a);
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double d, a, want; } t[] = {
        {0.0127, 0, 1.0}, {0.0127, 100, 0.2808}, {0.0127, 200, 0.0788},
        {0.001, 100, 0.9048},
    };
    for (int i = 0; i < 4; i++) {
        double got = poisson_yield(t[i].d, t[i].a);
        if (fabs(got - t[i].want) > 0.001) {
            printf("d=%g a=%g: got %.4f want %.4f\n",
                   t[i].d, t[i].a, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double poisson_yield(double d, double a) {
    return exp(-d * a);
}
```

## The one industry actually uses

Return Murphy yield, which assumes the defect density itself varies across the
wafer: `((1 - exp(-x)) / x)` squared, where `x` is `d*a`.

@kind output
@concept Clustering matters, and the model that accounts for it predicts real
published numbers where the simple one does not.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The whole bracket is squared, and zero area needs its own answer.
@diagnose wrong verdict nonzero-exit
Compare the values printed. Forgetting the square gives a number that is too
large everywhere, and it is a yield in its own right for a different model, so
it looks plausible.
@diagnose nan verdict nonzero-exit
At zero area the expression divides zero by zero. A yield of 1 is the right
answer there and the formula cannot produce it, so say so explicitly.
@after This model, fitted to one TSMC data point, predicts their second one to
within a tenth of a percentage point. The next exercise does that fit.

```starter
#include <math.h>

double murphy_yield(double d, double a) {
    double x = d * a;
    return (1.0 - exp(-x)) / x;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double d, a, want; } t[] = {
        {0.0127, 0, 1.0}, {0.0127, 17.92, 0.8006}, {0.0127, 100, 0.3213},
        {0.0127, 858, 0.0080},
    };
    for (int i = 0; i < 4; i++) {
        double got = murphy_yield(t[i].d, t[i].a);
        if (!(got == got) || fabs(got - t[i].want) > 0.002) {
            printf("d=%g a=%g: got %.4f want %.4f\n",
                   t[i].d, t[i].a, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double murphy_yield(double d, double a) {
    double x = d * a;
    if (x == 0.0) return 1.0;
    double r = (1.0 - exp(-x)) / x;
    return r * r;
}
```

## Fitting a model to a real number

Given a measured yield at a known die area, return the Murphy defect density
that produces it. Search for it rather than solving in closed form.

@kind output
@concept Fitting a model to one measurement and testing it against another is
how you find out which model is true.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint Yield falls as density rises, so a bisection converges if you move the
bound in the right direction.
@diagnose wrong verdict nonzero-exit
Yield is monotonically decreasing in defect density. If the yield at the midpoint
is above the target, the density must be higher, so the lower bound moves up.
Moving the wrong bound converges to an endpoint rather than to the answer.
@diagnose timeout verdict timeout
The loop is not terminating. A bisection over a fixed number of steps always
finishes; a loop conditioned on exact floating-point equality may not.
@after Fitted to the 17.92 mm point, this gives about 0.0127 per square
millimetre. Feed that back into Murphy at 100 mm and you get 32.1 per cent,
against TSMC's published 32.

```starter
#include <math.h>

static double murphy(double d, double a) {
    double x = d * a;
    if (x == 0.0) return 1.0;
    double r = (1.0 - exp(-x)) / x;
    return r * r;
}

double fit_density(double area, double measured_yield) {
    return measured_yield / area;
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    double d = fit_density(17.92, 0.80);
    if (fabs(d - 0.0127) > 0.0004) {
        printf("fitted %.5f, want about 0.0127\n", d);
        return 1;
    }
    double predicted = murphy(d, 100.0);
    if (fabs(predicted - 0.321) > 0.01) {
        printf("predicts %.3f at 100 mm^2, want about 0.321\n", predicted);
        return 1;
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

static double murphy(double d, double a) {
    double x = d * a;
    if (x == 0.0) return 1.0;
    double r = (1.0 - exp(-x)) / x;
    return r * r;
}

double fit_density(double area, double measured_yield) {
    double lo = 1e-9, hi = 1.0;
    for (int i = 0; i < 200; i++) {
        double mid = 0.5 * (lo + hi);
        if (murphy(mid, area) > measured_yield) lo = mid;
        else hi = mid;
    }
    return 0.5 * (lo + hi);
}
```

## Clustered defects are kinder

Return the Seeds yield, `1 / (1 + d*a)`, which assumes defects cluster heavily,
and the negative binomial yield with clustering parameter `alpha`.

@kind output
@concept How you model clustering changes the answer by a lot at large areas,
which is why the choice of model is not a detail.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The negative binomial raises one plus a scaled term to a negative power.
@diagnose wrong verdict nonzero-exit
Seeds is one over one plus `d*a`. The negative binomial divides `d*a` by alpha
first and raises the result to minus alpha, and as alpha grows it approaches the
Poisson model.
@after At 100 mm Seeds predicts 42 per cent against a measured 32. It is not a
bad model, it is a model of a different factory. The lesson is that you check
against data rather than choosing on elegance.

```starter
#include <math.h>

double seeds_yield(double d, double a) {
    return 1.0 + d * a;
}

double negbin_yield(double d, double a, double alpha) {
    return pow(1.0 + d * a, alpha);
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    if (fabs(seeds_yield(0.0127, 100) - 0.4405) > 0.002) {
        printf("seeds: got %.4f want 0.4405\n", seeds_yield(0.0127, 100));
        return 1;
    }
    if (fabs(seeds_yield(0.0127, 0) - 1.0) > 1e-9) {
        printf("seeds at zero area: got %.4f want 1\n", seeds_yield(0.0127, 0));
        return 1;
    }
    if (fabs(negbin_yield(0.0127, 100, 3.0) - 0.3468) > 0.002) {
        printf("negbin: got %.4f want 0.3468\n", negbin_yield(0.0127, 100, 3.0));
        return 1;
    }
    /* Large alpha should approach Poisson. */
    double nb = negbin_yield(0.0127, 100, 1e6), po = exp(-0.0127 * 100);
    if (fabs(nb - po) > 0.001) {
        printf("negbin with huge alpha: got %.4f, Poisson is %.4f\n", nb, po);
        return 1;
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

double seeds_yield(double d, double a) {
    return 1.0 / (1.0 + d * a);
}

double negbin_yield(double d, double a, double alpha) {
    return pow(1.0 + d * a / alpha, -alpha);
}
```

## How many dies fit on a wafer

Return the number of whole dies on a round wafer, given the wafer diameter and
the die area, including the correction for the partial dies around the edge.

@kind output
@concept The edge waste is a second penalty on large dies, independent of yield
and in the same direction.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint The first term is the area ratio and the second subtracts the edge.
@diagnose wrong verdict nonzero-exit
The area term is `pi*d*d/(4*a)` and the edge correction subtracts
`0.58*pi*d/sqrt(a)`. Leaving the correction out overestimates, and the
overestimate grows with die size, which is the point of including it.
@after A 300 mm wafer is about 70,686 square millimetres. The edge costs you
proportionally more the larger your die, so a big die is punished twice: fewer
of them fit, and fewer of those work.

```starter
#include <math.h>

/* M_PI is a POSIX extension, not standard C, and these exercises compile
   under -std=c17. Declare it rather than relying on the compiler's mood. */
#define PI 3.14159265358979323846

double dies_per_wafer(double diameter_mm, double die_area_mm2) {
    return PI * diameter_mm * diameter_mm / (4.0 * die_area_mm2);
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    struct { double d, a, want; } t[] = {
        {300, 100, 652.0}, {300, 858, 64.0}, {300, 17.92, 3815.0},
    };
    for (int i = 0; i < 3; i++) {
        double got = dies_per_wafer(t[i].d, t[i].a);
        if (fabs(got - t[i].want) > t[i].want * 0.03) {
            printf("%.0f mm wafer, %.2f mm^2 die: got %.0f want about %.0f\n",
                   t[i].d, t[i].a, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

#define PI 3.14159265358979323846

double dies_per_wafer(double diameter_mm, double die_area_mm2) {
    double area_term = PI * diameter_mm * diameter_mm / (4.0 * die_area_mm2);
    double edge = 0.58 * PI * diameter_mm / sqrt(die_area_mm2);
    double n = area_term - edge;
    return n < 0 ? 0 : n;
}
```

## Chiplets, in arithmetic

Return the number of working dies you get from one wafer for a design of a given
total area, built either as one die or as `n` equal pieces.

@kind output
@concept Splitting a design into smaller dies raises yield superlinearly, which
is why a large modern part is several dies rather than one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint Each piece has its own area, its own count per wafer, and its own yield.
@diagnose wrong verdict nonzero-exit
Splitting into `n` pieces means each piece has area `total/n`, and both the
number that fit and the fraction that work are computed at that smaller size.
Using the total area for the yield defeats the whole point of splitting.
@after One 800 mm die yields about one per cent. Four 200 mm dies yield 13 per
cent each. The packaging and the interconnect between them are not free, and it
is still overwhelmingly the better trade.

```starter
#include <math.h>

static double murphy(double d, double a) {
    double x = d * a;
    if (x == 0.0) return 1.0;
    double r = (1.0 - exp(-x)) / x;
    return r * r;
}

#define PI 3.14159265358979323846

static double dpw(double diameter, double a) {
    double n = PI * diameter * diameter / (4.0 * a)
             - 0.58 * PI * diameter / sqrt(a);
    return n < 0 ? 0 : n;
}

double good_dies(double diameter, double total_area, int pieces, double d0) {
    return dpw(diameter, total_area) * murphy(d0, total_area);
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    double one  = good_dies(300, 800, 1, 0.0127);
    double four = good_dies(300, 800, 4, 0.0127);
    if (fabs(one - 0.63) > 0.3) {
        printf("monolithic: got %.2f good dies, want about 0.6\n", one);
        return 1;
    }
    if (four < one * 20) {
        printf("split into four: got %.1f, expected far more than %.1f\n", four, one);
        return 1;
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

static double murphy(double d, double a) {
    double x = d * a;
    if (x == 0.0) return 1.0;
    double r = (1.0 - exp(-x)) / x;
    return r * r;
}

#define PI 3.14159265358979323846

static double dpw(double diameter, double a) {
    double n = PI * diameter * diameter / (4.0 * a)
             - 0.58 * PI * diameter / sqrt(a);
    return n < 0 ? 0 : n;
}

double good_dies(double diameter, double total_area, int pieces, double d0) {
    double each = total_area / pieces;
    return dpw(diameter, each) * murphy(d0, each);
}
```

## What maturity is worth

Return the ratio of yields for the same die area at two defect densities, so you
can see what a process learning curve is worth.

@kind output
@concept The same design on the same process yields far better two years in,
which is most of why chips get cheaper without changing.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17 -lm
@expect verdict nonzero-exit
@hint Two Murphy evaluations and a division, in the order the name suggests.
@diagnose wrong verdict nonzero-exit
Mature over early, so the ratio is greater than one. Dividing the other way
gives the reciprocal, which is a real number about a real thing and not the one
asked for.
@after Going from 1.27 to 0.1 defects per square centimetre multiplies the yield
of a 400 mm die by about fifteen. Nothing about the design changed.

```starter
#include <math.h>

static double murphy(double d, double a) {
    double x = d * a;
    if (x == 0.0) return 1.0;
    double r = (1.0 - exp(-x)) / x;
    return r * r;
}

double maturity_gain(double area, double d_early, double d_mature) {
    return murphy(d_early, area) / murphy(d_mature, area);
}
```

```tests
#include <stdio.h>
#include <math.h>
int main(void) {
    double g = maturity_gain(400, 0.0127, 0.001);
    if (g < 12 || g > 20) {
        printf("400 mm^2, 0.0127 to 0.001: got %.2f, want about 15\n", g);
        return 1;
    }
    double same = maturity_gain(100, 0.005, 0.005);
    if (fabs(same - 1.0) > 1e-9) {
        printf("same density: got %.4f want 1\n", same);
        return 1;
    }
    printf("ok\n");
    return 0;
}
```

```solution
#include <math.h>

static double murphy(double d, double a) {
    double x = d * a;
    if (x == 0.0) return 1.0;
    double r = (1.0 - exp(-x)) / x;
    return r * r;
}

double maturity_gain(double area, double d_early, double d_mature) {
    return murphy(d_mature, area) / murphy(d_early, area);
}
```

## Binning is the product line

Return how many units to enable on a part, given how many the design has, how
many are defective, and the largest count the product ladder offers below the
full one.

@kind output
@concept A die with a defect is not scrap, it is a cheaper product, and the
ladder is often one design and a test result.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra -std=c17
@expect verdict nonzero-exit
@hint The answer is a rung on the ladder, not an arbitrary number.
@diagnose wrong verdict nonzero-exit
A part ships at a rung the ladder offers. With one bad unit out of sixteen you
have fifteen working, and if the ladder's next rung down is twelve you ship
twelve and fuse off three good ones.
@after A flagship graphics die with 192 units ships 170 enabled, and a
datacenter part with 144 ships 132. Those disabled units are yield harvesting,
printed on the specification.

```starter
int ship_with(int designed, int defective, int next_rung) {
    return designed - defective;
}
```

```tests
#include <stdio.h>
int main(void) {
    struct { int d, b, r, want; } t[] = {
        {16, 0, 12, 16},   /* perfect die, full part      */
        {16, 1, 12, 12},   /* one bad, drop to the rung   */
        {16, 4, 12, 12},   /* four bad, still twelve good */
        {192, 22, 170, 170},
    };
    for (int i = 0; i < 4; i++) {
        int got = ship_with(t[i].d, t[i].b, t[i].r);
        if (got != t[i].want) {
            printf("%d designed, %d bad, rung %d: got %d want %d\n",
                   t[i].d, t[i].b, t[i].r, got, t[i].want);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
int ship_with(int designed, int defective, int next_rung) {
    int working = designed - defective;
    if (working >= designed) return designed;
    return working >= next_rung ? next_rung : 0;
}
```
