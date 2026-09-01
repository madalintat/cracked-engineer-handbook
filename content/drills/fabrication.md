## Under the Poisson model, how does yield change with die area?

- [x] It falls exponentially
- [ ] It falls linearly
- [ ] It falls with the square root of area
- [ ] It is independent of area

@why Doubling the die does not halve the yield, it squares it. That shape is
the reason a large modern part is several dies rather than one.

## What does the defect density `D` measure?

- [x] Fatal defects per unit area of wafer
- [ ] The fraction of dies that fail
- [ ] The number of process steps that can go wrong
- [ ] Impurity concentration in the silicon

@why A particle, a misaligned layer or a random dopant fluctuation kills the die
it lands on. The density is how often that happens per square centimetre.

## Which yield model does the industry use, and why?

- [x] Murphy, because it accounts for defect density varying across the wafer
      and it reproduces published numbers
- [ ] Poisson, because it is the simplest
- [ ] Seeds, because it is the most conservative
- [ ] Whichever gives the best number for a press release

@why Fitted to TSMC's 17.92 mm point, Murphy predicts their 100 mm point to
within a tenth of a percentage point. That is a two-parameter model of where
dust lands predicting a manufacturing outcome to three figures.

## Fitted to the same measurement, Poisson and Seeds predict what at 100 mm squared?

- [x] 28.8 and 41.8 per cent, against a measured 32
- [ ] Both about 32 per cent
- [ ] 32 and 28 per cent
- [ ] They cannot be fitted to a single point

@why The models disagree by a lot at large areas, which is why the choice is not
a detail. Seeds is not a bad model, it is a model of a differently behaved
factory.

## At the reticle limit on a new process, a monolithic die yields roughly:

- [ ] 30 per cent
- [ ] 10 per cent
- [ ] 3 per cent
- [x] under 1 per cent

@why Which is why a chip with two hundred billion transistors cannot be one
piece of silicon. Not "would be expensive". Could not be manufactured.

## Why are chiplets used for large designs?

- [x] Four dies of a quarter the area each yield far better than one die of the
      whole area
- [ ] They are cheaper to design
- [ ] They allow mixing process nodes, and nothing else
- [ ] They reduce power consumption

@why Four 200 mm dies yield 13 per cent each where one 800 mm die yields 1 per
cent. The packaging and the interconnect cost power and latency, and it is still
overwhelmingly the better trade.

## The edge correction in the dies-per-wafer formula accounts for:

- [x] Partial dies around the circular edge of the wafer, which cost
      proportionally more for larger dies
- [ ] Dies damaged during handling
- [ ] The area taken by test structures
- [ ] Wafer thickness variation

@why It is a second penalty on large dies, independent of yield and in the same
direction. A big die is punished twice: fewer fit, and fewer of those work.

## What wavelength does extreme ultraviolet lithography use?

- [x] 13.5 nanometres
- [ ] 193 nanometres
- [ ] 248 nanometres
- [ ] 1.5 nanometres

@why A fourteenfold jump down in one step, and it comes with the problem that
every material absorbs it, so there are no lenses and the whole optical path is
in vacuum.

## How is extreme ultraviolet light produced?

- [x] Tin droplets vaporised into plasma by a two-pulse laser, fifty thousand
      times a second
- [ ] A solid-state laser at that wavelength
- [ ] A synchrotron
- [ ] Filtered output from a mercury arc lamp

@why There is no laser at 13.5 nanometres. The first pulse flattens the droplet
and the second turns it into a plasma at half a million kelvin, which radiates
at the right wavelength.

## Roughly what fraction of generated extreme ultraviolet light reaches the wafer?

- [ ] About 70 per cent
- [ ] About 40 per cent
- [x] About 4 per cent
- [ ] Almost all of it

@why Every mirror returns about 70 per cent and there are eight or more in the
path. That is why the source has to make hundreds of watts to deliver a few, and
why the source is the hardest part of the machine.

## What does a node name like "3 nm" measure?

- [x] Nothing physical; it is a marketing label for a generation
- [ ] The gate length
- [ ] Half the minimum metal pitch
- [ ] The thickness of the gate oxide

@why Until the 1990s the name tracked the gate length. Then they came apart. No
dimension on a modern 3 nm chip is three nanometres, and different
manufacturers' numbers are not comparable.

## What should you compare instead of node names?

- [x] Transistor density, cell area, drive current and leakage, which are
      measurable
- [ ] Marketing generation numbers, normalised per vendor
- [ ] Clock frequency
- [ ] Wafer cost

@why Those are the numbers that decide what a design can do, and they can be
measured rather than announced.

## What is binning?

- [x] Sorting working dies by measured speed, power and functional
      completeness, and selling them as different products
- [ ] Discarding dies that fail test
- [ ] Grouping wafers by manufacturing date
- [ ] Sorting by package type

@why A sixteen-core design with two bad cores becomes a twelve-core part. The
consumer ladder is often not several designs but one design and a test result.

## A flagship graphics die with 192 processing units shipping 170 enabled is:

- [x] Yield harvesting, visible on the specification sheet
- [ ] A power limit
- [ ] A software restriction that can be unlocked
- [ ] A thermal design choice

@why Those disabled units are the answer to a defect that landed somewhere. The
same is true of a datacenter part with 144 units shipping 132.

## Why does the same design get cheaper over a process's life without changing?

- [x] Defect density falls by a factor of ten or more as the process matures,
      and yield is exponential in it
- [ ] Wafer prices fall
- [ ] Designs are re-laid-out for higher density
- [ ] Demand falls, so prices do

@why About 1.27 defects per square centimetre during the ramp, and 0.05 to 0.2
on a mature process. It is also why the first parts on a new node are small
ones: a manufacturer ramps on dies it can afford to throw away.
