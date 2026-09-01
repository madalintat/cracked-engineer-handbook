---
needs: [virtual-memory, fabrication]
minutes: 55
one_idea: NAND is read in pages and erased in blocks two orders of magnitude larger, and every piece of storage software above it exists to hide that asymmetry.
sources: [transistors-cmos-fabrication, cpu-architectures]
---

A disk had one asymmetry: seeking was slow and sequential reading was fast, so
software was arranged to seek less. Flash replaced it with a different and
stranger set of constraints, and almost none of the resulting software design is
obvious from the outside.

## Three operations, three sizes

NAND supports three things and they operate at three different granularities.

Reading works on a page, which is a few kilobytes, and takes tens of
microseconds. Programming, meaning writing, also works on a page and takes a few
hundred microseconds. Erasing works on a block, which is hundreds of pages, and
takes a few milliseconds.

The rule that makes this awkward is that a page cannot be programmed twice. To
change a byte you must erase the entire block containing it and program the whole
thing back, which is an operation a hundred times larger and a hundred times
slower than the write you asked for.

So flash cannot do what a disk does. A disk overwrites a sector in place. Flash
has no in-place overwrite at all.

```figure
{
  "kind": "bits",
  "alt": "A NAND block divided into many pages, with one page highlighted as the read and program unit and the whole block outlined as the erase unit.",
  "caption": "Read and program one page. Erase hundreds of them. Every storage design decision in this part follows from those two numbers being different.",
  "bits": 32,
  "groups": [
    { "from": 0,  "to": 1,  "label": "page", "accent": "gold" },
    { "from": 2,  "to": 31, "label": "the rest of the erase block", "accent": "slate" }
  ],
  "brackets": [
    { "from": 0, "to": 31, "label": "one erase", "lane": 0 }
  ]
}
```

## The translation layer

The device hides all of it. A flash drive presents an array of numbered sectors
that behave exactly like a disk's, and inside it a controller maintains a mapping
from those numbers to physical pages.

A write does not modify anything. It programs a fresh page somewhere, updates the
map, and marks the old page as garbage. So a sequence of writes to the same
sector leaves a trail of dead pages and one live one, and the map is what makes
the sector appear to have been overwritten.

That controller is a real computer with its own processor, its own memory holding
the map, and firmware more complex than most of the software running above it.
Every performance characteristic people attribute to flash is really a
characteristic of that firmware.

## Reclaiming what was abandoned

Dead pages accumulate, and the space has to come back, which means erasing blocks
that contain a mixture of dead and live pages.

Garbage collection copies the live pages of such a block somewhere else, erases
it, and adds it to the free pool. The copying is real work the drive does on its
own account, and it is why a drive that has been written to heavily behaves
differently from a fresh one: the fresh one has free blocks and the used one has
to make some.

The ratio between what the host wrote and what the device actually programmed is
write amplification, and it is the number that decides both wear and sustained
speed. Writing 4 KB that forces a 4 MB block to be rewritten is an amplification
of a thousand.

Two things reduce it. Space the host never uses gives the controller room to work
without copying, which is why enterprise drives reserve a fraction of their
capacity and why a full drive is slower than an empty one. And writing in large
sequential runs means a block fills with data that will be discarded together,
so collecting it copies nothing.

## Telling the drive what is dead

The controller cannot tell which sectors a filesystem still cares about. From its
side a deleted file's sectors are live data it must preserve through every
collection.

That is what the trim command is for: the filesystem tells the drive that a range
is no longer needed, and the controller can drop those pages instead of copying
them. Without it, a drive that has been written to once has no free space from
its own point of view, however empty the filesystem is, and it collects garbage
that nobody wanted.

The mechanism is worth knowing because it explains a class of complaint. A drive
that got slower over months and recovered after being reformatted was not
wearing out; it was collecting data that had been deleted years earlier by
software that never told it.

## Wearing out is real and mostly not your problem

A NAND cell tolerates a limited number of erase cycles before it stops holding
charge reliably. The number depends on how many bits each cell stores: a cell
holding one bit lasts on the order of a hundred thousand cycles, one holding
three or four lasts hundreds to low thousands.

That sounds alarming and mostly is not. The controller spreads erases evenly
across the device, so no block is worn out while others are fresh, and a
consumer drive rated for a few hundred terabytes of writes will outlast the
machine for almost every workload.

The workloads where it matters are the ones writing constantly in small pieces,
because that is where write amplification is worst and each host byte costs many
device bytes. A database with a badly chosen page size can wear a drive out in a
year, and the fix is a storage design question rather than a hardware one, which
is what unit 043 is about.

## More bits, less everything else

The choice of how many bits to store per cell is the largest lever in the whole
design and it trades three things at once.

One bit per cell is fastest, most durable and most expensive per gigabyte. Three
or four bits are the opposite, and the reason is that distinguishing sixteen
charge levels rather than two requires more precise reading, longer programming,
and tolerates far less drift.

Almost everything sold is three or four bits, with a portion of the drive
operated as one bit per cell and used as a write buffer. Which is why a benchmark
that writes a few gigabytes reports a speed the drive cannot sustain: the buffer
absorbed it, and when the buffer is full the sustained rate is several times
lower.

That is the single most misleading number in consumer storage, and it is not a
lie about the hardware. It is a measurement of the buffer.

## Losing power in the middle

One consequence of the buffer is worth stating on its own, because it decides
what durability means in unit 041.

The drive acknowledges a write once it is in volatile memory inside the
controller, not once it is in NAND. That is what makes writes appear fast. It
also means a power loss between the acknowledgement and the programming loses
data the host was told was safe.

Drives intended for servers carry enough stored energy to finish what they
accepted, usually a capacitor sized for exactly that. Consumer drives mostly do
not, and their answer is to obey a flush command: the host asks, the drive
programs everything outstanding, and only then reports completion.

So durability is not a property of having written. It is a property of having
flushed, and the cost of a flush is the real programming latency rather than the
buffered one. Every database's commit path is arranged around that single call,
and a filesystem that reorders or drops it converts a correct database into an
incorrect one without either of them being wrong.

## What the numbers actually are

Worth holding, because they set the scale for the next three units.

A read is tens of microseconds. A write, from the host's point of view, is
similar because the drive acknowledges it once it is buffered. An erase is
milliseconds and is hidden. A spinning disk's seek is around eight milliseconds,
which is roughly a thousand times a flash read.

And the parallelism is the part people miss. A drive contains many independent
NAND chips, and one request at a time uses one of them. Reaching the advertised
throughput requires many requests outstanding at once, which is a property of the
interface rather than the medium, and it is what unit 040 exists to explain.

## What to carry forward

Read and program a page, erase a block hundreds of times larger, and never
overwrite anything in place. A controller hides that with a map, and the copying
it does to reclaim space is write amplification.

A full drive is slower than an empty one, trim is how the drive learns what to
stop preserving, and the sustained write rate is not the one a short benchmark
reports.

And the device is internally parallel, which nothing above it can exploit without
asking for many things at once.

## Reading the errors you are about to see

These compute the arithmetic of pages, blocks and amplification, which is exact,
where a measurement of a real drive would depend on its history and its
firmware's mood.

`assert-failed` names the count your model got wrong. The page and block sizes
are stated in each exercise, because unlike the cache line they genuinely differ
between devices.
