# Storage, Filesystems & Storage Engines — where bytes live when the power is off

Research note for a from-first-principles hardware curriculum. The track already covers CPU,
memory, GPU and networking; this is the missing layer. It runs bottom-up from the physics of a
charge trap to the choice between a B-tree and an LSM-tree, because that is the actual
dependency order: **every layer above is a workaround for a physical asymmetry below.**

Confidence is marked inline. `[verified]` = checked against a primary or near-primary source
this session, cited in §8. `[measured]` = produced by a program I compiled and ran live on
Compiler Explorer during this research; the program is in this document. `[known]` = standard,
well-documented material I am confident in but did not re-verify. `[uncertain]` = flagged; do
not teach as fact without checking. §9 is the explicit uncertainty list.

Backend for exercises: **Compiler Explorer** (<https://godbolt.org>), which compiles *and
executes* C/C++ on x86-64 Linux. §6.0 documents the sandbox's real capabilities and its three
hard limits, all established empirically this session. Every exercise in §6 was run there and
its output is reproduced verbatim.

---

## 0. The one idea, stated once

A CPU register, an SRAM cell, a DRAM row and a NAND block all store bits. They differ in one
respect that matters more than capacity, price or speed:

> **What is the smallest unit you can change, and is it the same as the smallest unit you can
> read?**

For registers, SRAM and DRAM the answer is "yes, roughly." For NAND flash the answer is a
flat **no**, and the gap between the two granularities is a factor of a thousand. Everything in
this document — the flash translation layer, garbage collection, over-provisioning, TRIM,
log-structured filesystems, LSM-trees, the shape of RocksDB — is downstream of that single
asymmetry. A curriculum that teaches storage as "files and directories" teaches the API and
misses the physics.

---

## 1. Physical devices

### 1.1 The rotating disk, and why random I/O is catastrophic

An HDD is a stack of rigid platters coated in a magnetic film, spinning at a constant rate,
with a read/write head on an actuator arm flying tens of nanometres above the surface. To read
a sector you must do two mechanical things:

1. **Seek** — swing the arm to the right track. `[verified]`
   - ~4 ms average on 2010-era high-end server drives
   - ~9 ms on typical desktop drives
   - ~12 ms on mobile drives
2. **Wait for rotation** — the sector has to come around under the head. Average rotational
   latency is half a revolution: `[verified]`

| Spindle speed | Average rotational latency |
|---|---|
| 5,400 rpm | 5.56 ms |
| 7,200 rpm | 4.17 ms |
| 10,000 rpm | 3.00 ms |
| 15,000 rpm | 2.00 ms |

**The number that teaches the lesson.** A 7,200 rpm desktop drive: 9 ms seek + 4.17 ms
rotational = **~13 ms average access time**. That is `1/0.013 ≈ 77` random I/Os per second.
Seventy-seven. A 2020s enterprise drive sustains **above 500 MB/s sequentially** `[verified]`;
at 4 KiB that is ~128,000 sequential IOPS. `[derived]`

> **The ratio is roughly 1,000:1.** Sequential and random access on the same device, the same
> platter, the same head, differ by three orders of magnitude — because one of them pays a
> mechanical cost and the other does not. This is the single most important number in the
> history of storage software. B-trees, sorted files, defragmentation, the extent, the
> elevator I/O scheduler, `readahead`, and the entire log-structured tradition exist because
> of it.

Consequences worth stating explicitly:

- **Latency did not improve.** Between 1990 and 2020, HDD *bandwidth* rose by ~100x; *seek
  time* improved by perhaps 3x, because it is limited by the mechanics of accelerating an arm.
  Capacity outran latency by orders of magnitude, so the *time to read an entire disk*
  got dramatically worse. This is why RAID rebuild times became a crisis (§4.7). `[known]`
- **Short-stroking.** Restricting a drive to its outer tracks reduces seek distance and raises
  IOPS at the cost of capacity — a practice that tells you how desperate people were. `[known]`
- **Zone bit recording.** Outer tracks are physically longer and hold more sectors, so
  sequential throughput at the outer edge can be ~2x that at the inner edge on the same
  drive. A benchmark that ignores where on the platter the file landed is measuring noise.
  `[known]`
- **SMR (shingled magnetic recording).** Tracks are written overlapping, like roof shingles,
  because a write head is wider than a read head. Rewriting a track corrupts its neighbours,
  so an SMR drive must read-modify-write an entire *zone*. **SMR reinvents the flash erase
  block on a magnetic platter** — same asymmetry, same solution (an indirection layer and
  garbage collection), same pathological random-write behaviour. It is a superb teaching
  parallel. `[known]`

### 1.2 NAND flash: the cell

A flash cell is a MOSFET with an extra, electrically isolated gate between the channel and
the control gate. Put charge on that isolated gate and it shifts the transistor's threshold
voltage; measure the threshold voltage and you recover the stored value. The charge stays put
with no power because it is surrounded by insulator — that is the whole trick of non-volatility.

Two ways to build the isolated storage: `[verified]`

- **Floating gate (FG)** — the storage node is a conductive **polysilicon** island. Classic,
  well-understood. Because it is a conductor, a single defect in the surrounding oxide can
  drain the entire island: all stored charge leaks through one weak spot.
- **Charge trap flash (CTF)** — replaces the polysilicon with an **electrically insulating
  silicon nitride layer** that traps electrons in discrete defect sites. Because the charge is
  immobile within an insulator, a single oxide defect drains only the charge near it. CTF
  therefore permits "smaller cells and higher endurance" and is "less prone to electron
  leakage." `[verified]` Essentially all 3D NAND is charge-trap.

**Writing is not the inverse of erasing.** Programming a cell injects electrons onto the
storage node — a directional operation that can be done to one page. Erasing removes them, and
the erase mechanism (a large field applied through the substrate/well) acts on the entire
physical structure that shares that well. **The well is the block.** This is not a design
choice a firmware engineer could undo; it falls out of the device physics and the fact that
sharing the erase path across many cells is what makes NAND cheap.

### 1.3 The asymmetry — the most important fact in this document

> **NAND flash is read and programmed at page granularity, but erased only at block
> granularity — and a page can only be programmed after its whole block has been erased.**
> `[verified]`

The numbers: `[verified for page size; block size and pages-per-block are [known]]`

| Operation | Granularity | Typical size | Typical latency |
|---|---|---|---|
| Read | page | 4–16 KiB | 25–100 µs (TLC) |
| Program (write) | page | 4–16 KiB | 200–800 µs (TLC) |
| Erase | **block** | **128–1024 pages ≈ 0.5–24 MiB** | **2–10 ms** |

Wikipedia states pages are "typically between 4 KiB and 16 KiB in size, but can only be erased
at the level of entire blocks consisting of multiple pages," and that "when a block is erased,
all the cells are logically set to 1. Data can only be programmed in one pass to a page in a
block that was erased." `[verified]` The write-amplification literature uses **256 KiB** as a
representative erase block. `[verified]` Modern high-capacity TLC/QLC parts are far larger;
treat the specific figures as order-of-magnitude. `[uncertain — varies enormously by part]`

Three facts follow immediately, and every one of them shapes software:

1. **There is no overwrite.** To change one byte of a 16 KiB page you cannot rewrite the page
   in place. You must write the new version *somewhere else* (a page in an already-erased
   block) and mark the old one invalid.
2. **Reclaiming space costs a thousand times more than using it.** Freeing one stale page
   requires erasing a block of hundreds of pages, which first requires relocating every *still
   valid* page in that block.
3. **The latency spread is ~100:1 across the three operations**, and the slow one is on the
   critical path of the reclaim you cannot avoid. A device that must erase before it can
   accept your write will stall.

Add a fourth constraint that surprises people: **within a block, pages must generally be
programmed in order**, and in multi-level cells, programming a page can disturb its neighbours,
so parts impose strict programming sequences. Random-order page programming inside a block is
not permitted. `[known]`

**This is why the log-structured idea is not a clever optimisation but the only sane
response.** If you cannot overwrite in place, then you must append; if you append, you must
eventually reclaim; if reclaim is coarse, you must compact. That sentence describes an SSD's
firmware, a log-structured filesystem, and RocksDB. They are the same algorithm at three
different altitudes, forced by the same physics.

### 1.4 SLC / MLC / TLC / QLC — the density-endurance-speed trilemma

You increase capacity per cell by storing more distinguishable charge levels: `[verified for
bits and levels; endurance figures [known]]`

| Type | Bits/cell | Voltage levels | Typical P/E cycles | Relative program time |
|---|---|---|---|---|
| SLC | 1 | 2 | ~50,000–100,000 | 1x |
| MLC | 2 | 4 | ~3,000–10,000 | ~2–4x |
| TLC | 3 | 8 | ~1,000–3,000 | ~4–8x |
| QLC | 4 | 16 | ~100–1,000 | ~8–16x |
| PLC | 5 | 32 | (research/marginal) | — |

Wikipedia records a specific 2008 Micron/Sun announcement of an SLC part rated for **1,000,000
P/E cycles** `[verified]` — an outlier, not a typical figure; ordinary SLC is tens of
thousands. It explains the mechanism plainly: "Endurance also decreases with the number of bits
in a cell. With more bits in a cell, the number of possible states... in a cell increases and
is more sensitive to the voltages used for programming." `[verified]`

The physics of the trilemma, which is worth deriving with students rather than asserting:

- The usable threshold-voltage window is roughly fixed by the oxide and the supply.
- *n* bits requires 2ⁿ distinguishable levels packed into that fixed window.
- So each level's voltage margin shrinks **exponentially** in *n*: QLC's 16 levels leave each
  one about 1/8 the margin of MLC's 4.
- Every wear mechanism — trapped charge in the tunnel oxide from repeated erases, electron
  detrapping over time, read disturb, temperature — *widens the distribution* of each level.
- Therefore the same absolute amount of wear consumes a far larger fraction of QLC's margin.
  Endurance is not "worse" in QLC by a design choice; it is worse by a geometric argument.
- And *programming* gets slower, because placing charge precisely into a narrow window requires
  incremental step-pulse programming with verify steps between pulses — more levels, more
  pulses, more verifies.

This also explains **SLC caching**, which is why consumer QLC drives benchmark well and then
collapse: the controller operates a region of the TLC/QLC array in *SLC mode* (one bit per
cell, wide margins, fast), absorbs the burst there, and folds it into dense mode later during
idle. A benchmark shorter than the SLC cache measures the cache. Sustained writes past it fall
off a cliff — often 5–10x. Any storage benchmark that does not state its write volume relative
to the SLC cache size is meaningless. `[known]`

### 1.5 3D NAND

Planar NAND ran out of road around the 15–16 nm node: cells got so small they held only
hundreds of electrons, and cell-to-cell interference and retention became unmanageable. The
industry's escape was to **stop shrinking and start stacking**: rotate the string vertical and
build 32, 64, 128, 232, 300+ layers of cells around a vertical channel, etched in one
high-aspect-ratio step. `[known]`

The teaching points:

- **Going 3D let the industry move *back* to a larger, more relaxed cell geometry** while
  increasing density. 3D NAND cells are physically bigger than late planar cells — that is why
  TLC and QLC became viable at all. Density came from the third dimension, so the cell could
  be made *less* marginal. This is the same trade the CPU world made when it stopped scaling
  frequency and went multicore: when one axis saturates, find another.
- Layer count is now the primary scaling axis, and the limits are mechanical/chemical (etching
  a uniform hole through 300+ layers), not lithographic.
- String stacking (building two decks and bonding them) is how counts beyond ~128 are reached.
- **Erase blocks got much bigger.** More layers means more pages sharing an erase structure, so
  the granularity asymmetry of §1.3 has been getting *worse* over time, not better. The
  software problem is growing.

### 1.6 The flash translation layer

Given §1.3, a NAND die cannot present a "disk" interface. Something must sit between the host's
logical block addresses and the physical pages. That is the **FTL**, running on the SSD's own
embedded controller (typically a multi-core ARM complex with its own DRAM).

The FTL "maps host side or file system logical block addresses (LBAs) to the physical address
of the flash memory." `[verified]` Mapping schemes: `[verified]`

- **Page mapping** — a table entry per logical page. Best performance, most flexibility, but
  the table is large: Wikipedia gives a metadata-to-capacity ratio of roughly **1:1000**.
  That is the origin of the industry rule of thumb **~1 GB of controller DRAM per 1 TB of
  flash** (a 4-byte physical page number per 4 KiB page is exactly 1/1024). Used in SSDs.
  This is also why *DRAM-less* SSDs (which keep only a partial map in a small SRAM cache, with
  the rest in flash — HMB borrows host memory over PCIe) fall apart on random workloads: a
  map miss costs an extra flash read before the real one.
- **Block mapping** — an entry per block. Tiny table, poor performance, needs read-modify-write
  of a whole block. Used in cheap USB sticks and SD cards.
- **Hybrid mapping** — block-mapped data blocks plus a small pool of page-mapped "log" blocks
  that absorb updates. The historical middle ground.

The FTL's job list: address translation, **garbage collection**, **wear levelling**, bad block
management, ECC (LDPC on modern parts), read disturb management and refresh, and power-loss
protection of its own metadata. It is a small log-structured filesystem, written by a storage
vendor, that you cannot inspect, running on every drive you own.

**Open-Channel SSDs and ZNS (Zoned Namespaces)** are the counter-movement: expose the zone/block
structure to the host and let the filesystem or database do the placement, since it actually
knows which data is hot and which is cold. ZNS is standardised in NVMe and supported in Linux
(f2fs, btrfs, and zoned block device support). The argument is exactly that two independent
log-structured garbage collectors stacked on each other (RocksDB's compaction on top of the
FTL's GC) fight, and merging them removes an entire multiplication of write amplification.
`[known]`

### 1.7 Garbage collection, write amplification, over-provisioning

**Write amplification** is the accounting of the whole mess: `[verified]`

```
WA = (bytes actually written to flash) / (bytes the host asked to write)
```

Without compression, WA cannot go below 1.0. `[verified]` (Controllers with transparent
compression report WA below 1.0 — as low as 0.5 or even 0.14 on compressible data. `[verified]`
This is why an SSD benchmark using an all-zeroes buffer is worthless.)

**Garbage collection** is the primary driver. `[verified]` A block accumulates a mixture of
valid and stale pages as the host overwrites logical addresses. To reclaim it the controller
must: read every still-valid page, program those pages into a fresh block, update the map, then
erase the victim. Every one of those relocated pages is a flash write the host never asked for.

**Over-provisioning** is the release valve: `[verified]`

```
OP = (physical capacity − user-visible capacity) / user-visible capacity
```

Typical factory values are **7%, 14% or 28%** `[verified]`. The 7% figure is nearly free: it is
the gap between the drive's binary capacity (128 × 2³⁰ bytes) and its decimal marketed capacity
(128 × 10⁹ bytes), which is 7.37%. Enterprise drives sacrifice real capacity to buy more.

**The relationship is violently non-linear, and that is the lesson.** I built a page-mapped FTL
with greedy garbage collection (always erase the block with the fewest valid pages) and ran it
under uniform-random and sequential write workloads at five over-provisioning ratios. Full
source in §6, Exercise 5. `[measured]`

```
OP%    pattern         host wr   flash wr       WA
2      random           204800    6204157    30.29
7      random           204800    1650689     8.06
14     random           204800     869631     4.25
28     random           204800     495534     2.42
50     random           204800     337588     1.65
2      sequential       204800     204800     1.00
7      sequential       204800     204800     1.00
14     sequential       204800     204800     1.00
28     sequential       204800     204800     1.00
50     sequential       204800     204800     1.00
```

Read that table twice. It contains four separate lessons:

1. **Sequential writes have WA = 1.00 at every over-provisioning level.** They cost nothing
   extra, because a block fills with data that dies together, so the whole block goes stale at
   once and GC relocates nothing. Wikipedia states exactly this: sequential writes approach 1.0
   because "if a file is deleted, the entire block can be marked invalid at once." `[verified]`
2. **Random writes cost 8x at 7% OP and 30x at 2%.** Same data volume, same device, same
   controller. Only the *order* changed.
3. **The curve is hyperbolic, not linear.** Going 2% → 7% OP cuts WA by nearly 4x; going
   28% → 50% barely helps. All the value is at the left edge.
4. **This is why an SSD slows down when full**, and it is a quantitative answer, not
   hand-waving. Free user space acts as extra over-provisioning `[verified]`, so a drive at 50%
   capacity is effectively running at ~100% OP and WA near 1; the *same drive* at 98% capacity
   is running at ~2% effective OP and WA above 30. The drive did not degrade. Its GC just has
   nowhere to stand. Keeping ~20% of an SSD free is not superstition; it is buying yourself the
   flat part of this curve.

**Cross-check against theory.** The standard asymptotic result for greedy GC under uniform
random writes is `WA ≈ 1 / (2(1−u))` where `u = 1/(1+OP)` is utilisation. Comparing:

| OP | u | Theory `1/(2(1−u))` | Simulator | Δ |
|---|---|---|---|---|
| 2% | 0.980 | 25.5 | 30.29 | +19% |
| 7% | 0.935 | 7.64 | 8.06 | +5% |
| 14% | 0.877 | 4.07 | 4.25 | +4% |
| 28% | 0.781 | 2.29 | 2.42 | +6% |
| 50% | 0.667 | 1.50 | 1.65 | +10% |

Agreement to within 4–6% through the middle of the range, diverging at the extremes where the
finite block count (200 blocks) and the simulator's specific GC trigger matter. `[measured;
theory formula [known]]` A student who builds this and reproduces a known analytic result has
done real work.

**Wear levelling** distributes P/E cycles so no block dies early. It has a cost the naive
version of the story omits: *static* wear levelling must periodically **relocate cold data that
nobody asked to move**, purely to free up its low-cycle blocks for hot data. `[verified]` So
wear levelling *increases* write amplification in exchange for longevity. Separating hot and
cold data reduces this. `[verified]`

**TRIM** (ATA) / **DEALLOCATE** (NVMe) / `discard` (Linux) closes an information leak. When you
delete a file, the filesystem updates its own metadata; the drive is never told, so the FTL
still believes those pages hold valid data and dutifully relocates them during GC forever.
TRIM tells the device "these LBAs are garbage." `[verified]` Without it, WA rises and stays
risen. Linux has supported it since **2.6.33**, Windows since 7. `[verified]` In practice
Linux prefers periodic batched `fstrim` over the `discard` mount option, because inline discard
puts a device round-trip on the delete path.

**Read disturb** is the counterintuitive one worth teaching precisely because it violates the
naive model. Reading a NAND page requires applying a raised pass-voltage to the *unselected*
word lines in the string so they conduct regardless of their stored charge. That voltage
slightly injects charge into those cells. Read them enough times and neighbours drift into a
different state. Wikipedia: "The method used to read NAND flash memory can cause nearby cells
in the same memory block to change over time (become programmed)... The threshold number of
reads is generally in the hundreds of thousands of reads between intervening erase operations."
`[verified]`

> **A read-only workload can destroy data on an SSD.** The controller must count reads per
> block and pre-emptively rewrite ("refresh") hot-read blocks. So a purely read-only database
> silently generates writes, consumes P/E cycles, and produces write amplification with a host
> write count of zero — making WA formally infinite. This single fact demolishes the mental
> model students arrive with.

**Retention** is the other clock. "Data stored on flash cells is steadily lost due to electron
detrapping. The rate of loss increases exponentially as the absolute temperature increases."
`[verified]` For a 45 nm NOR part at 1000 hours, threshold-voltage loss at 25 °C is about half
that at 90 °C. `[verified]` The JEDEC spec for client SSDs is 1 year of retention at 30 °C
*after* the drive has consumed its rated endurance — and worn cells retain far worse than fresh
ones. An unpowered SSD in a warm room is not an archival medium. `[known]`

### 1.8 Optane / 3D XPoint: what it promised and why it died

Announced by Intel and Micron in **July 2015**, branded Optane in **August 2015**. `[verified]`
It was pitched as a genuinely new tier between DRAM and NAND: byte-addressable, non-volatile,
"less than DRAM but more than flash memory" in price. `[verified]`

What it actually delivered was impressive and is worth quoting: **"500,000 4K sustained IOPS for
both reads and writes, with 3–15 microsecond latencies"** — with a reviewer noting "there is
currently nothing [else] that comes close," and Optane SSDs measuring "consistently around 2.5×
as fast" as Intel's previous datacenter drives. `[verified]` Endurance was orders of magnitude
above NAND, and critically **it had no erase-block asymmetry** — it could be written in place at
fine granularity. In DIMM form (Optane DC Persistent Memory) it sat on the memory bus and could
be `mmap`ed and accessed with ordinary load/store instructions (DAX — direct access, bypassing
the page cache entirely), which triggered a genuine research wave: persistent-memory
programming, `CLWB`/`sfence` durability sequences, PMDK, crash-consistent data structures that
live in the load/store domain.

The timeline of its death: `[verified]`

- **April 2017** — consumer availability.
- **January 2021** — Intel discontinues the consumer Optane line.
- **16 March 2021** — Micron announces it will cease 3D XPoint development to pursue **CXL**
  instead, citing lack of demand. It sells the Lehi, Utah fab to Texas Instruments for **$900
  million**, noting the plant "was never fully utilized."
- **July 2022** — Intel announces it is winding down the Optane division.

**Why it died** is a better lesson than the technology itself, and it is an economics lesson,
not a physics one:

1. **It was stranded between two ruthless cost curves.** NAND kept getting cheaper per bit
   (3D stacking, QLC); DRAM kept being fast enough. Optane had to be much cheaper than DRAM
   *and* much faster than NAND *and* produced at a volume that would amortise a dedicated fab.
   It never won all three at once, and the fab "was never fully utilized" `[verified]` — a
   memory technology that does not reach volume cannot reach a competitive price, which
   prevents it from reaching volume.
2. **Software could not use it without being rewritten.** The DIMM form's value required
   applications to abandon the read/write/fsync model for a load/store persistence model with
   explicit cache-line flushes. That is a rewrite of the storage engine. Almost nobody did it
   for a product with one supplier. Meanwhile in *SSD* form it had to speak NVMe over PCIe,
   where the software stack's own overhead was a meaningful fraction of its 10 µs latency —
   so it threw away much of its advantage to be usable at all.
3. **Single sourcing.** No second supplier meant no one would design a product around it.

> **The curriculum point:** a technology that is better on every physical axis can still lose,
> because the interface it must be adopted through, and the volume economics of the fab, are
> also part of the system. Optane is the best available case study in "the ecosystem is part of
> the engineering."

### 1.9 CXL as the successor idea

**Compute Express Link** runs on the PCIe physical and electrical layer — CXL 1.0/1.1 on PCIe
5.0, CXL 3.0 moving to PCIe 6.0 with PAM-4 for double the bandwidth. `[verified]` Three
protocols multiplexed on that one link: `[verified]`

- **CXL.io** — essentially PCIe: "configuration, link initialization and management, device
  discovery and enumeration, interrupts, DMA, and register I/O access using non-coherent
  loads/stores." The compatibility layer.
- **CXL.cache** — lets a *device* coherently cache *host* memory.
- **CXL.mem** — lets the *host* coherently access *device-attached* memory "with load/store
  commands for both volatile (RAM) and persistent non-volatile (flash memory) storage."

That third one is the point. CXL.mem makes a device's memory appear as ordinary, cache-coherent,
load/store-addressable system memory — typically exposed to Linux as a separate **NUMA node**
with no CPUs attached, so the existing NUMA machinery handles placement and migration. This is
the *same programming model* Optane DIMMs offered, but delivered over an **open, multi-vendor
standard on a link that every server already has**, rather than a proprietary DIMM from one
supplier. Micron said so explicitly when it killed 3D XPoint: it stopped in order to build
CXL products. `[verified]`

Version history: `[verified]`

| Version | Year | Added |
|---|---|---|
| 1.0 / 1.1 | 2019 | Initial spec on PCIe 5.0; device-attached memory |
| 2.0 | 2020 | Switching; memory **pooling** across multiple hosts |
| 3.0 | 2022 | PCIe 6.0, double bandwidth; multi-level switching; enhanced peer-to-peer |
| 3.1 | 2023 | Refinements |
| 4.0 | 2025 | Doubled link rate to 128 GT/s |

**Memory pooling** (2.0+) is the economically motivating feature and belongs in the curriculum
next to the datacentre material: memory is stranded in servers — one machine is at 90% memory
and 20% CPU while its neighbour is the reverse, and you cannot move DIMMs at runtime. Pooling
disaggregates memory into a shared appliance that hosts can attach capacity from dynamically.
Published analyses put stranded DRAM at a substantial fraction of datacentre memory spend,
which is the entire commercial argument for CXL. `[known]`

The honest caveat: **CXL memory is not DRAM-latency memory.** The link adds meaningful latency
(a NUMA hop's worth and more), so it behaves like a far NUMA node — good for capacity and
cold-ish pages, not for a hot working set. Teaching it as "more RAM" is wrong; teaching it as
"a new, slower, larger tier that the NUMA subsystem already knows how to manage" is right.
`[known]`

---

## 2. Interfaces

### 2.1 SATA/AHCI vs NVMe — an interface built for the wrong device

AHCI was designed for spinning rust. Its assumptions are all about hiding mechanical latency
from a device that can do ~100 operations per second. Then flash arrived and could do a million,
and every one of those assumptions became a bottleneck. The contrast is stark: `[verified]`

| | AHCI / SATA | NVMe |
|---|---|---|
| Command queues | **1** | **up to 65,535** |
| Commands per queue | **32** | **up to 65,536** |
| Uncacheable register reads per command | **up to 6** (non-queued), **up to 9** (queued) | **up to 2** |
| Command parameter fetch (4 KiB cmd) | **two serialised host DRAM fetches** | **one 64-byte fetch** |
| Max link bandwidth | ~600 MB/s (SATA 3) | PCIe lanes (see §2.2) |

Wikipedia notes the uncacheable register accesses cost roughly **2000 cycles each** `[verified]`
— so AHCI burns up to 18,000 CPU cycles of pure register-poking per queued command, versus
NVMe's ~4,000, before any data moves.

**Why deep parallel queues are the whole point**, and this is the part that connects back to
§1: an SSD is not one device. It is an array of independent NAND dies, organised into channels
(typically 8–16), with multiple dies per channel, each die having multiple planes. Each die can
be executing its own read, program or erase concurrently. A single 8 KiB read touches one die
and takes ~50 µs; the drive's advertised million IOPS is only reachable by having **hundreds of
operations in flight across dies at once**.

> With one queue of 32 commands, you cannot keep 128 dies busy. The parallelism exists in the
> silicon and the interface cannot express it. NVMe's queue model exists to *let the host
> describe enough concurrency to saturate the internal parallelism of the medium.* This is the
> same argument as SIMT on a GPU: the hardware is wide, and the programming interface's only
> job is to let you say something wide enough to fill it.

The design consequences of NVMe worth teaching:

- **Queues live in host memory, not device registers.** A submission queue and a completion
  queue are ring buffers in the host's DRAM. The host writes a 64-byte command into the SQ and
  rings a **doorbell** — a single MMIO write of the new tail index. That is the *only*
  uncacheable device access on the submit path. The device then DMAs the command out of host
  memory itself.
- **One queue pair per CPU core.** Each core gets its own SQ/CQ, so the submission path needs
  **no locks and no cross-core cache-line contention**. This is why NVMe scales with cores and
  AHCI does not — the single AHCI queue is a single contended cache line. Linux's `blk-mq`
  (§3.2) exists to match this shape.
- **Completions by interrupt with aggregation, or by polling.** At a million IOPS, one
  interrupt per completion is unaffordable — the interrupt overhead alone exceeds the device
  latency. NVMe supports MSI-X vectors per queue (steering the interrupt to the submitting
  core, so the completion is handled on the core whose cache holds the data) and interrupt
  coalescing. For the lowest latency, Linux supports **polled I/O** (`RWF_HIPRI` /
  `io_uring` with `IOPOLL`), where the CPU spins on the completion queue rather than sleeping
  — trading CPU cycles for the ~2–3 µs of interrupt and context-switch overhead, which is a
  good trade when the device responds in 10 µs.
- **Namespaces** partition a controller's capacity into independently addressable units — the
  substrate for SR-IOV, multi-tenancy and ZNS.

### 2.2 PCIe as a protocol

PCIe pays for itself twice in this curriculum: it is how the SSD attaches *and* how the GPU
attaches. Teaching it once, properly, in the storage unit means the GPU unit gets it free.

Despite the name, PCIe is not a bus. It is a **packet-switched, point-to-point network** with
a layered protocol stack, a root complex, switches, and endpoints — architecturally much closer
to Ethernet than to the shared parallel PCI bus it replaced. That framing is the single most
useful thing to give a student, and it connects directly to the networking unit.

**The layers**, bottom-up:

1. **Physical layer** — differential serial pairs. A **lane** is 4 wires (two differential
   pairs: one TX, one RX), giving full duplex. Links are ×1, ×2, ×4, ×8, ×16. An NVMe SSD is
   usually ×4; a GPU is usually ×16. Data is scrambled and line-coded.
2. **Data link layer** — sequence numbers, LCRC, ACK/NAK with replay from a retry buffer, and
   credit-based flow control. It makes the lossy physical layer into a reliable ordered link.
   Again: this is TCP's job list, implemented in hardware, one hop wide.
3. **Transaction layer** — **TLPs** (Transaction Layer Packets), with a header, optional data
   payload, and optional ECRC. Four address spaces: **memory**, **I/O** (legacy),
   **configuration**, and **messages**. Transactions are either *posted* (memory writes —
   fire and forget, no completion) or *non-posted* (memory reads, config accesses — a request
   TLP that is answered later by a separate completion TLP). **A PCIe memory read is a
   request/response round trip over a packet network**, which is exactly why MMIO reads are so
   catastrophically slow (§2.3).

**Bandwidth per generation** `[verified]`:

| Gen | Raw rate | Encoding | Per-lane BW | ×4 (typical SSD) | ×16 (typical GPU) |
|---|---|---|---|---|---|
| 1.0 | 2.5 GT/s | 8b/10b | 0.25 GB/s | 1 GB/s | 4 GB/s |
| 2.0 | 5.0 GT/s | 8b/10b | 0.5 GB/s | 2 GB/s | 8 GB/s |
| 3.0 | 8.0 GT/s | 128b/130b | 0.985 GB/s | 3.94 GB/s | 15.754 GB/s |
| 4.0 | 16.0 GT/s | 128b/130b | 1.969 GB/s | 7.88 GB/s | 31.508 GB/s |
| 5.0 | 32.0 GT/s | 128b/130b | 3.938 GB/s | 15.75 GB/s | 63.015 GB/s |
| 6.0 | 64.0 GT/s | PAM-4 + FEC | 7.563 GB/s | 30.25 GB/s | 121 GB/s |
| 7.0 | 128.0 GT/s | PAM-4 + FEC | 15.125 GB/s | 60.5 GB/s | 242 GB/s |

Two things students should extract from that table rather than memorise it:

- **The encoding change at Gen 3 is a visible 20% efficiency win.** 8b/10b spends 2 bits in
  every 10 on DC balance and clock recovery — a 20% tax. 128b/130b spends 2 in 130, a 1.5%
  tax. So Gen 3 got 1.6x the raw rate of Gen 2 but ~2x the usable bandwidth. Encoding overhead
  is real bandwidth, and this is the cleanest example of it anywhere in the machine.
- **Gen 6's move to PAM-4 changed the nature of the channel.** Instead of two voltage levels
  (NRZ), PAM-4 uses four, carrying 2 bits per symbol — the *same* trick as MLC flash in §1.4,
  with the *same* consequence: less margin per level, so more errors, so PAM-4 **requires**
  forward error correction, which PCIe had never needed before. FEC adds latency. The
  bit-density-versus-margin trade recurs at every level of the machine; naming it once in
  §1.4 and finding it again here is a genuine curriculum payoff.

**Enumeration.** At boot, firmware (and then the OS) performs a depth-first walk of the PCIe
tree. Each function is identified by **Bus:Device.Function (BDF)** and has a 4 KiB
**configuration space** (256 bytes of it is the legacy PCI-compatible header), reachable either
by the legacy `0xCF8`/`0xCFC` port pair or, on modern systems, by **ECAM** — the entire config
space of every device mapped flat into physical memory, so a config read is a normal load.
The header holds Vendor ID and Device ID (how the OS picks a driver), class codes, capability
lists, and the BARs.

**BAR mapping.** A **Base Address Register** is how a device advertises how much address space
it needs and where it ended up. The mechanism is elegant and worth walking through by hand
because it is one of the few places students can *see* how a bus discovers itself:

1. Software writes all 1s to the BAR.
2. The device returns a value with its low bits hardwired to 0 — the number of zeroed low bits
   encodes the **size** of the region it needs (a device needing 1 MiB zeroes the low 20 bits).
   The lowest bits also flag memory-vs-I/O space, 32-vs-64-bit, and prefetchability.
3. Software allocates a suitably aligned range from the system's physical address map and
   writes the base back into the BAR.
4. From then on, CPU physical addresses in that window are routed by the root complex to that
   device as PCIe memory TLPs.

For NVMe, BAR0 exposes the controller's registers — capabilities, admin queue base addresses,
and the **doorbell** array. That is the entire host-to-device control surface.

### 2.3 MMIO and DMA — the asymmetry that shapes every driver

**MMIO** — the CPU reads/writes device registers as if they were memory, through a BAR window
marked uncacheable (UC) or write-combining (WC) in the MTRRs/PAT. A **read** is a non-posted
transaction: a request TLP goes out, the device responds with a completion TLP, and the CPU
core is stalled on an uncacheable load the whole time. The round trip is commonly quoted at
**~1–2 µs**, i.e. thousands of cycles. A **write** is posted and returns quickly, but gives no
confirmation. Hence the universal driver idiom: *never read a device register on a fast path.*
The NVMe doorbell is a write for exactly this reason.

**DMA** — the device is a bus master and moves the data itself, directly to/from host DRAM,
without the CPU touching a byte. This inverts the relationship: instead of the CPU fetching from
the device, the CPU describes a buffer and the device comes and gets it. For NVMe, a command's
data pointer is either a **PRP** (Physical Region Page) list or an **SGL** (Scatter-Gather
List) naming the physical pages the device should read or write.

> **The rule that follows, and that explains the structure of every high-performance driver:
> the control path is MMIO (rare, expensive, CPU-initiated) and the data path is DMA (bulk,
> device-initiated).** A million-IOPS device is only possible because the CPU's involvement per
> I/O is one 64-byte store into a ring plus, amortised across a batch, one doorbell write.

Three second-order concerns that are where the real bugs live:

- **The IOMMU** (Intel VT-d / AMD-Vi / ARM SMMU) sits between device and DRAM and translates
  *device* addresses (IOVAs) to physical, giving memory protection against a malicious or buggy
  device — without it, any DMA-capable device can read all of physical memory, which is the
  entire Thunderbolt/DMA-attack class. It is also what makes device passthrough to VMs safe.
  It costs an address-translation step per DMA, with its own TLB (IOTLB).
- **Cache coherence.** On x86 and modern ARM server parts, DMA is coherent — the interconnect
  snoops, and DMA'd data invalidates the relevant cache lines automatically. On many embedded
  ARM systems it is **not**, and the driver must explicitly clean/invalidate caches around every
  DMA. This is exactly what Linux's DMA mapping API (`dma_map_single`, `dma_sync_*`) abstracts.
  A student who has only used x86 will assume coherence is a law of nature; it is a
  platform property. (Ties directly to the embedded unit.)
- **Ordering.** Posted writes may be reordered relative to each other. Ringing the doorbell
  before the command data is visible to the device is a classic, painful bug; drivers need a
  write barrier (and often a `wmb()` plus a WC-buffer flush) between filling the SQ entry and
  writing the doorbell. This is the memory-ordering material from the CPU unit, appearing in
  its natural habitat.

---

## 3. The kernel storage stack

### 3.1 The path of a read

```
     read() / mmap fault / io_uring SQE
                 |
            VFS  (dentry cache, inode cache, per-fs ops)
                 |
      +-- PAGE CACHE ------- hit -> memcpy to user, done (~1 µs)   <-- the common case
      |          |
      |        miss
      |          v
      |    filesystem: map file offset -> block number (extent tree / inode block pointers)
      |          v
      |    BLOCK LAYER: bio -> request, merge, blk-mq staging queues, I/O scheduler
      |          v
      |    driver (NVMe): build 64-byte command + PRP list, insert into SQ, ring doorbell
      |          v
      |    PCIe TLPs -> SSD controller -> FTL map lookup -> NAND die read
      |          v
      |    DMA into the page-cache page; MSI-X interrupt; completion; wake the waiter
```

The single most important thing to convey: **the fast path does not reach the device at all.**
Measured on the Compiler Explorer sandbox's ext4 volume, a 4 KiB `pread` costs **~0.6–1.4 µs**
when the page is cached and **~218–343 µs** when it is not `[measured]` — a factor of **203–433x**
depending on the run. Storage performance is, first and foremost, a **cache hit rate** question.

### 3.2 The block layer and I/O schedulers

The block layer turns filesystem requests into device requests. Its unit is the **bio** (a
vector of page/offset/length segments plus a target device and sector), which is merged into a
**request** and dispatched.

**blk-mq** replaced the old single-queue design for the reason given in §2.1: one lock and one
request queue per device is a hard scalability wall at millions of IOPS. blk-mq has
**per-CPU software staging queues** feeding **hardware dispatch queues** that map onto the
device's real queues (for NVMe, one per core). No shared lock on the submit path. The legacy
single-queue path was removed entirely in Linux 5.0. `[known]`

**Schedulers**, and — this is the point — why the right answer is now usually *none*:
`[known]`

| Scheduler | Idea | Right for |
|---|---|---|
| `none` | FIFO, no reordering | **NVMe SSDs** — the default |
| `mq-deadline` | Deadline per request, prevents starvation, modest merging | SATA SSDs, mixed workloads, latency guarantees |
| `bfq` | Budget Fair Queueing; per-process fairness and low latency for interactive work | Desktops, slow devices |
| `kyber` | Two queues (read/write), tunes depth to hit target latencies | Fast multi-queue devices |

The historical **elevator** algorithms (and CFQ, and the old anticipatory scheduler) existed to
minimise *seek distance* — sorting requests by sector so the arm sweeps the platter once
instead of thrashing. On a device with an actuator arm this was worth 10x. **On an SSD it is
worth nothing and costs latency**, because there is no arm, the FTL has already scrambled the
LBA-to-physical mapping anyway, and reordering just delays commands the device could already be
executing in parallel. Hence `none`.

> That is a clean, self-contained lesson: **a piece of software that was unambiguously correct
> for thirty years became unambiguously wrong when the physics underneath it changed.** The
> code did not rot. The device did.

### 3.3 The page cache

The page cache is the kernel's unified cache of file contents, keyed by (inode, offset), held
in page-sized units, and sized to *whatever RAM is otherwise idle*. On Linux it is unified with
the virtual memory system: a page-cache page and an `mmap`ed page of that file are the *same
physical page*. There is no separate "buffer cache" to keep coherent — a lesson learned the
hard way in the 1990s and a common source of confusion for people who learned Unix from older
books.

**On the read side**: a miss allocates a page, issues the I/O, fills it, and marks it up to date.
Eviction is an LRU approximation — Linux uses two lists, **active** and **inactive**, and a page
must be referenced while on the inactive list to be promoted. This two-list structure exists to
resist the classic pathology in which one large sequential scan evicts a carefully warmed
working set. (Modern kernels use **MGLRU**, multi-generational LRU, which generalises this.)
You can see the split directly in `/proc/meminfo` — I read it on the sandbox: `Active(file):
1179040 kB`, `Inactive(file): 4453924 kB`. `[measured]`

**On the write side**, and this is where durability lives: a `write()` copies data into a page,
marks it **dirty**, and returns. **The data is in volatile RAM and the syscall has already
reported success.** Dirty pages are later flushed by per-backing-device **writeback threads**
(`kworker`/flusher threads, historically `pdflush`/`bdflush`). The policy knobs, read live from
the sandbox's `/proc/sys/vm/` `[measured — and matching the documented defaults]`:

| Tunable | Value | Meaning |
|---|---|---|
| `dirty_background_ratio` | **10** | % of available memory dirty at which **background** flusher threads start writing out |
| `dirty_ratio` | **20** | % at which a **writing process is made to block and do writeback itself** |
| `dirty_expire_centisecs` | **3000** | dirty data older than **30 s** is eligible for writeout |
| `dirty_writeback_centisecs` | **500** | flusher threads wake every **5 s** |
| `dirty_bytes` / `dirty_background_bytes` | **0** | absolute-byte alternatives; 0 = use the ratios |
| `vfs_cache_pressure` | **100** | tendency to reclaim dentry/inode caches |

The `dirty_ratio` mechanism is worth dwelling on because it explains a real production
phenomenon: when dirty pages exceed the limit, the kernel applies **writeback throttling** — the
writing process is forced to do writeback synchronously. Applications see write latency go from
nanoseconds to hundreds of milliseconds with no code change and no error. On a machine with
128 GB of RAM, `dirty_ratio=20` permits **25 GB of dirty data** to accumulate before this hits,
which is why the "sudden multi-second stall" is such a common and mystifying report. Tuning
`dirty_background_bytes` down to something the device can absorb in a second is a standard fix.

**Readahead** is the page cache's other half, and it is what produced the largest measured
effect in this entire research session. On a sequential read the kernel detects the pattern and
issues I/O for pages ahead of the application, growing the window as the pattern holds
(`/sys/block/*/queue/read_ahead_kb`, commonly 128 KiB). Applications can steer it explicitly
with `posix_fadvise(POSIX_FADV_SEQUENTIAL | RANDOM | WILLNEED | DONTNEED)` and `madvise()`.

Measured on ext4 on the sandbox, 4 KiB `pread`s over a 16 MiB file, page cache dropped with
`POSIX_FADV_DONTNEED` before each pass, three independent runs: `[measured]`

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| cold **sequential** | 5.70 µs/op | 11.51 µs/op | 12.05 µs/op |
| cold **random** | 218.24 µs/op | 340.15 µs/op | 342.95 µs/op |
| **ratio (random ÷ sequential)** | **38.3x** | **29.6x** | **28.5x** |
| warm sequential | 0.94 | 1.03 | 0.64 |
| warm random | 1.07 | 1.35 | 0.79 |

**Both passes read exactly the same 4096 pages from exactly the same file.** Only the order
differs. The 28–38x is readahead: sequential access lets the kernel fetch in large batches ahead
of demand and amortise per-request cost, while random access defeats prediction and pays full
device latency per page. On a *rotating* disk this ratio would be far larger still (§1.1) —
here the backing store is a network-attached AWS volume with no seek penalty, so what we are
measuring is purely the batching win, not mechanics. That the effect is this large even
*without* mechanics is the surprise.

### 3.4 `fsync`, `fdatasync`, and what durability actually guarantees

`write()` returning success guarantees **nothing about persistence**. It guarantees the kernel
has taken responsibility for the bytes. Those bytes are in the page cache, and if the machine
loses power they are gone.

- **`fsync(fd)`** — flush this file's dirty data *and* its metadata, and (on a correctly
  implemented stack) instruct the device to flush its own volatile write cache to stable media.
  Returns when done.
- **`fdatasync(fd)`** — flush data plus only the metadata *required to read the data back*
  (notably the file size if it changed), skipping e.g. mtime updates. Cheaper when appending is
  not extending metadata that matters.
- **`sync()` / `syncfs(fd)`** — everything / everything on one filesystem.
- **`O_SYNC` / `O_DSYNC`** — make every `write()` behave as if followed by `fsync`/`fdatasync`.

**The cost is not subtle.** I measured 200 appends of a ~16-byte record to an ext4 file, with
and without `fdatasync` after each: `[measured]`

```
NO fsync     200 appends:     0.15 ms  (  0.001 ms/append)
WITH fsync   200 appends:   413.39 ms  (  2.067 ms/append)
```

**A factor of ~2,000.** That number is the entire reason storage engines exist in the shape they
do: a database that called `fsync` per row would do 480 transactions per second on this
hardware. Group commit, write-ahead logging and asynchronous commit are all strategies for
amortising this one syscall.

**The `fsync` durability chain has five links, and every one has been broken in shipping
systems:**

1. Application actually calls `fsync` and **checks its return value**.
2. The kernel flushes all the file's dirty pages.
3. The filesystem also persists the metadata needed to *find* those bytes after a crash — the
   directory entry, the inode, the extent map.
4. The block layer issues a **cache flush** (`REQ_OP_FLUSH`) to the device.
5. The device actually commits its volatile DRAM write cache to media before acknowledging.

Failure modes at each link, all of which are real:

- **(1) The `fsync` error is lost — "fsyncgate."** This is the one to teach. PostgreSQL assumed
  a successful `fsync` meant the data was safe. But when buffered writeback fails, Linux (and
  other kernels) **discard the affected dirty pages and mark them clean, without notifying the
  application**; a later `fsync` then reports **success** because there is nothing dirty left,
  "enabling silent corruption of the database." `[verified]` Worse, the error status is
  consumed by whoever calls `fsync` first — background writeback, or another process's `sync()`
  — so the process that cared may never see it. And because PostgreSQL's checkpointer closes
  and reopens files, "the checkpointer will not see any errors that happened before it opened
  the file." `[verified]`

  The kernel developers' justification is worth quoting because it reframes the whole issue as a
  design trade rather than a bug: the most common cause of I/O errors "by far, is a user pulling
  out a USB drive at the wrong time," and retaining failed dirty pages indefinitely risks memory
  exhaustion. `[verified]` The fallout: Linux 4.13+ improved per-file error reporting, PostgreSQL
  chose to **`PANIC` on `fsync` failure** rather than retry (because a retry can succeed against
  a page whose contents were dropped), and PostgreSQL developers concluded that direct I/O is
  "the best long-term solution" but requires "a metric ton of work." `[verified]`

  > **The teachable law: `fsync` may return an error exactly once, to exactly one caller, and
  > retrying it after failure is not safe.** "I called fsync and checked the return code" is
  > necessary and not sufficient.

- **(2)/(3) Metadata ordering.** Persisting a file's *data* is useless if the directory entry
  pointing at it is not also persisted — after a crash you have durable bytes nobody can name.
  Correct atomic-replace is: write temp file → `fsync(tempfd)` → `rename()` → **`fsync` the
  containing directory**. The last step is the one everyone forgets.
- **(4) Barriers and FUA.** Since the device has its own volatile cache and reorders freely, the
  block layer needs a way to say "everything before this must be on media before anything
  after." Linux originally implemented this with heavyweight **write barriers**, which drained
  the entire queue and were so slow they were often disabled. Modern Linux replaced them
  (around 2.6.37) with the lighter **`REQ_PREFLUSH` / `REQ_FUA`** pair: `PREFLUSH` flushes the
  device cache before the request; **FUA (Force Unit Access)** makes *this one write* go to
  media before it is acknowledged, without flushing the entire cache. FUA is the important
  primitive for journalling — you need the journal commit block durable, not the whole cache.
  Note that mounting ext4 with `nobarrier` / `barrier=0` (still occasionally advised in stale
  tuning guides) **disables this and makes journalling unable to guarantee ordering**. It is
  safe only with a battery-backed write cache.
- **(5) Devices that lie.** Consumer drives have shipped that acknowledge a cache-flush command
  without performing it, because it benchmarks better. Enterprise drives have **power-loss
  protection**: onboard capacitors holding enough energy to drain the write cache to NAND after
  power is cut, which is precisely what makes it *safe* for them to acknowledge quickly. That
  capacitor is a meaningful fraction of the price difference between a consumer and a
  datacentre SSD, and it is the physical embodiment of a durability guarantee.

**The negative control I measured makes link (5) vivid.** The same 200-append loop with
`fdatasync` after every append, on **tmpfs** instead of ext4: `[measured]`

```
WITH fsync   200 appends:     0.22 ms  (tmpfs: fsync has nothing to flush)
```

0.22 ms versus 413.39 ms — nearly 2,000x cheaper, for *identical code making identical
syscalls that all return success*. `fsync` on tmpfs returns 0 and does nothing, because there
is no device beneath it. This is exactly what a lying device looks like from userspace, and it
is a perfect demonstration that **you cannot verify durability from inside the process**. It
also indicts a very common benchmarking mistake: running a database benchmark in a container
with its data directory on a tmpfs or overlay volume and reporting the throughput.

**What crash-consistency `fsync` does *not* give you**: `fsync` is not atomic. If you `write()`
8 KiB and crash midway through writeback, you can get 4 KiB of new data and 4 KiB of old.
Only a single sector (512 B, or arguably a 4 KiB physical block) is plausibly atomic, and even
that is a device property, not a standard. This is the **torn write** problem, and it is why
PostgreSQL writes **full page images** into the WAL after each checkpoint (`full_page_writes`),
and why InnoDB has the **doublewrite buffer** — both are paying double the write volume to buy
page-level atomicity the hardware does not provide.

### 3.5 `O_DIRECT`

`O_DIRECT` bypasses the page cache entirely: DMA goes straight between the device and the
application's buffer. Requirements are strict — buffer address, file offset and length must all
be aligned to the device's logical block size (use `posix_memalign`).

Why a database wants it: the database already has a **buffer pool** with domain-specific
replacement, prefetch and write-ordering policy. The page cache underneath is a *second* cache
holding the same pages — double the memory for the same data, and two replacement policies
fighting. `O_DIRECT` also gives explicit control over exactly when a write reaches the device,
sidestepping the fsyncgate class of problem entirely (which is why PostgreSQL considers it the
long-term answer `[verified]`).

Why it is not free, measured on the sandbox — random 4 KiB reads on ext4: `[measured]`

| Access | µs/op |
|---|---|
| warm page cache (buffered) | 0.6 – 1.4 |
| **`O_DIRECT` random** | **559.9 – 592.8** |
| cold page cache (buffered, random) | 218 – 343 |

`O_DIRECT` is consistently the slowest, and *that is the correct result*: it never benefits from
a cache hit, and it does no readahead. It is a transfer of responsibility, not an optimisation.
If your application does not have a better caching policy than the kernel's, `O_DIRECT` will
simply make it slower. Linus Torvalds's famous objections to `O_DIRECT` are essentially this
point, expressed with less patience.

### 3.6 `mmap` for files

`mmap` maps file pages into the process's address space; access faults them in through the same
page cache. It is seductive — no syscall per access, no copy — and it is a trap for a database,
which is why it is worth teaching as a case study in "the fast path is not the whole story."

Advantages: zero-copy reads, no syscall overhead on hits, the OS handles caching and eviction,
and shared read-only mappings share physical pages across processes.

The problems, which the LMDB-vs-everyone-else debate and the "Are You Sure You Want to Use MMAP
in Your DBMS?" paper (CIDR 2022) lay out:

- **You cannot control eviction or writeback ordering.** The kernel may write a dirty mapped
  page to disk at any moment. For a database that must write its WAL before the corresponding
  data page, this is fatal — you cannot express the ordering constraint. (`msync` is the only
  lever and it is coarse.)
- **Page faults are invisible stalls.** A load instruction can take a major fault and block for
  hundreds of microseconds, inside a lock, with no syscall in sight. Your profiler shows a
  memory access; your latency shows a disk.
- **Error handling becomes SIGBUS.** An I/O error on a mapped page arrives as a signal, not an
  `errno`. Handling that correctly is miserable.
- **TLB shootdowns.** Unmapping in a multithreaded process forces IPIs to every core.
- **The 32-bit address space limit** historically capped mapped file size (mostly moot now).

Measured: random single-byte touches across a 16 MiB mapped ext4 file with the cache dropped
cost **40.0–41.2 µs per page** `[measured]` — much faster than the 218–343 µs of cold `pread`
(the fault path does some readaround, and the kernel's fault handling is efficient), but note
that this is *per page fault*, occurring at an unpredictable point inside ordinary-looking code.
On tmpfs the same loop is **0.13–0.19 µs/page** `[measured]`, because there is no I/O at all.

### 3.7 `io_uring`

Adopted in **Linux 5.1 (2019)** `[verified]`. Two shared-memory ring buffers between the
application and the kernel: a **submission queue (SQ)** and a **completion queue (CQ)**, with
the discipline that "the SQ buffer is writable only by consumer applications, and the CQ buffer
is writable only by the kernel," which avoids data races without locks. `[verified]`

The application fills SQEs and, in the general case, makes **one** `io_uring_enter` syscall to
submit a whole batch and optionally reap completions. With **SQPOLL** a kernel thread polls the
submission ring, and steady-state I/O requires **zero syscalls**. Add **registered buffers and
files** (pre-pinning the memory and pre-resolving the fds, so the kernel skips the per-operation
`get_user_pages` and fd lookup) and the per-I/O overhead becomes very small.

Why it exists, in one line: **at NVMe speeds, the syscall is a significant fraction of the
I/O.** When the device answers in 10 µs, and Spectre/Meltdown mitigations pushed syscall entry
costs to hundreds of nanoseconds, per-I/O syscalls stop being free. This is the exact same
argument as NVMe's doorbell batching in §2.1, one layer up — and, again, the same argument as
kernel-bypass networking (DPDK, AF_XDP) in the networking unit. Three different subsystems
independently concluded that the syscall boundary had to be amortised.

It also fixed real limitations of Linux AIO, which "only worked with O_DIRECT flag, didn't
support the page cache, and couldn't multiplex network and disk I/O together." `[verified]`
`io_uring` is general: buffered and direct file I/O, sockets, `openat`, `statx`, timeouts, and
chained (linked) operations that execute in order without a userspace round trip.

The sandbox has it: `io_uring_setup(8, &params)` returned a valid fd with
`features = 0x3ffff`. `[measured]`

Worth mentioning honestly: `io_uring` has been a significant source of kernel security
vulnerabilities, to the extent that Google disabled it on Android and ChromeOS and some
hardened distros restrict it. Its attack surface is large because it is, in effect, a
programmable syscall engine.

---

## 4. Filesystems

### 4.1 The core objects

- **Superblock** — describes the filesystem: block size, total/free counts, inode count, feature
  flags, UUID, mount state, journal location. Replicated across the volume, because losing the
  only copy loses everything.
- **Inode** — everything about a file *except* its name and its data: mode, uid/gid, size,
  timestamps, link count, and the map from file offsets to disk blocks. Fixed-size, in a table
  (ext) or a B-tree (XFS, btrfs). The **name is not in the inode** — that is the fact that makes
  hard links, `rename()`, and "deleting an open file frees nothing until the last fd closes"
  all comprehensible at once. `unlink()` removes a *directory entry* and decrements a *link
  count*; the inode dies when both link count and open count hit zero.
- **Directories are files.** A directory is a file whose contents are (name → inode number)
  pairs. Older ext used a linear list — O(n) lookup, which is why directories with 100,000
  files used to be pathological. Modern filesystems use hashed B-trees: ext4's **htree**, XFS's
  B+trees. This is a genuinely satisfying realisation for students: *there is no separate
  directory mechanism.* It is files all the way down, plus a type bit in the inode.
- **Data blocks** and the free-space map (bitmaps in ext4; **B+trees of free extents** in XFS,
  which is why XFS handles very large volumes better — a bitmap for a 100 TB filesystem is
  itself enormous).

### 4.2 Extents vs block pointers

**Block pointers** (classic Unix / ext2 / ext3): the inode holds ~12 direct block numbers, then
a single-indirect, a double-indirect, and a triple-indirect pointer. Elegant, and terrible for
large files: a 1 GiB file at 4 KiB blocks needs 262,144 pointers spread across a tree of
indirect blocks, so reading the file means reading a lot of metadata, and `truncate` or
`unlink` on a huge file means walking all of it. (The reason deleting a large file on ext3 was
noticeably slow.)

**Extents** (ext4, XFS, btrfs, NTFS, APFS): a single record says "file logical block 0, physical
block 918273, length 32768." One 12-byte-ish record can describe a 128 MiB contiguous run. The
metadata for a contiguous 1 GiB file collapses from a quarter-million pointers to a handful of
records. ext4 keeps four extents inline in the inode and spills to an extent tree beyond that.

> Extents are how a filesystem *expresses* contiguity — and contiguity is what §1.1 and §3.3
> proved is worth 30–1000x. The data structure exists to make the physics visible to the layer
> that can exploit it.

### 4.3 Allocation and fragmentation

Allocation policy is where a filesystem earns its performance:

- **Delayed allocation** (ext4, XFS) — do not choose physical blocks at `write()` time; hold the
  data dirty in the page cache and choose at writeback, when the *total* size is known. This
  turns many small appends into one big contiguous allocation. It is the single biggest reason
  ext4 outperformed ext3.
- **`fallocate()`** — the application declares the final size up front, letting the allocator
  find one contiguous run and avoiding fragmentation entirely. Every serious database and
  torrent client does this.
- **Block groups / allocation groups** — the volume is divided into regions, each with its own
  inode table and free-space map, and the allocator keeps a file's inode near its data and a
  directory's files near each other. On an HDD this minimises seeks; it also gives XFS
  parallelism, since each allocation group can be allocated from concurrently by a different
  CPU without contention.

**Fragmentation** matters in proportion to how much the device cares about locality — which is
to say, it mattered enormously on HDDs (§1.1) and matters much less on SSDs. But "much less" is
not "not at all": a fragmented file means more, smaller I/O requests, more extent-tree metadata,
and less readahead effectiveness. And on an SSD there is a second, sneakier kind — **FTL-level
fragmentation**, where logically contiguous LBAs are scattered across physical blocks by the
history of writes, which is invisible to the filesystem and cannot be defragmented by it.

**Copy-on-write filesystems (btrfs, ZFS) fragment aggressively by construction**, because every
overwrite goes somewhere new. For a database file or a VM image — random 8–16 KiB overwrites
inside one large file — this is pathological, and the standard mitigation is to disable COW for
those files (`chattr +C` on btrfs, `nodatacow`) at the cost of losing checksums and snapshot
integrity for them. This is a genuinely instructive trade to put in front of students: the
feature that gives you free snapshots is the same feature that shreds your database file.

### 4.4 Journalling — and exactly what each mode guarantees

The problem: a single logical operation (append a block to a file) requires several independent
disk writes — allocate the block in the bitmap, update the inode's size and extent map, write
the data. A crash between them leaves the filesystem **inconsistent**: a block marked in use
that no inode references (a leak), or worse, a block referenced by an inode but also marked
free (which will be handed out again — corruption).

The pre-journalling answer was `fsck`: scan the entire filesystem at boot and repair. This
became untenable as capacity grew — hours of downtime, and `fsck` can only restore
*consistency*, not your data.

**Journalling** applies write-ahead logging to filesystem metadata: write your intent to a log,
mark it committed, then apply it. On crash, replay the committed entries and discard the
incomplete ones. Recovery time is proportional to the journal size (seconds), not the volume
size (hours).

**Physical vs logical journals** `[verified]`:

- A **physical journal** logs "an advance copy of every block that will later be written to the
  main file system" — safest, and the data is written **twice**.
- A **logical journal** stores "only changes to file metadata," which is faster but "risks data
  corruption when unjournaled file data and journaled metadata desynchronize." `[verified]`

**ext3/ext4's three modes**, and precisely what each buys: `[verified for the mechanism and the
risk; the mode names and defaults are [known]]`

| Mode | Journalled | Guarantee after a crash | Cost |
|---|---|---|---|
| `data=journal` | metadata **and** data | Both metadata and file contents are consistent to the last commit. The strongest guarantee ext4 offers. | Every byte written **twice**. Roughly halves write throughput. |
| `data=ordered` **(default)** | metadata only, but **data blocks are forced to disk before the metadata transaction that references them commits** | Metadata is always consistent, and you never see *stale* data — a file will never expose the previous occupant of a reused block. Recently written data can be **lost**, but not garbled with someone else's old contents. | Modest ordering constraint. |
| `data=writeback` | metadata only, **no ordering** between data and metadata | Metadata is consistent; file contents are not. **Post-crash, a file extended before the crash can contain arbitrary stale block contents** — Wikipedia's example is precise: if the inode size update and block allocation replay but the data write did not land, "the file will be appended with garbage." | Fastest. |

> **The exact lesson: journalling protects the *filesystem*, not your *data*.** `data=ordered`
> guarantees you will never read another file's deleted contents out of your file, and that
> `fsck` will not be needed. It does *not* guarantee that the write you issued one second before
> the power failed is present. Only `fsync` does that (§3.4), and only if all five links in the
> chain hold.

Two additional wrinkles worth teaching:

- **The journal must be ordered against the device's write cache**, which is what barriers/FUA
  (§3.4) are for. "Many mass storage devices have their own write caches, in which they may
  aggressively reorder writes for better performance," and journalling filesystems use barriers
  "to force cache flushes at critical journal points." `[verified]` A journal whose commit block
  reaches media before the entries it commits is worse than no journal, because it will
  confidently replay garbage.
- **ext4's `auto_da_alloc` heuristic.** After delayed allocation shipped, the classic
  `open`/`write`/`close`-then-`rename` idiom (used by essentially every text editor and config
  writer) started producing **zero-length files** after a crash, because the rename's metadata
  committed while the data was still unallocated in the page cache. Technically the applications
  were wrong — they should have called `fsync` before `rename` — but there were too many of them,
  so ext4 added a heuristic to force allocation on rename-over. It is a superb case study in
  the gap between the standard's guarantee and what applications actually depend on.

### 4.5 Copy-on-write: btrfs, ZFS, APFS

COW inverts the update model. Nothing is overwritten in place: "blocks containing active data
are never overwritten in place; instead, a new block is allocated, modified data is written to
it." `[verified]` The change propagates up the tree to a new root, and the switch is a single
atomic pointer update (an **überblock** in ZFS).

This one decision cascades:

- **No journal is needed for consistency.** The on-disk state is always a valid tree; you either
  see the old root or the new one. There is no window in which the filesystem is inconsistent —
  which is a *structurally* stronger property than "we can repair it quickly from a log."
- **Snapshots are nearly free.** Retain the old root and its blocks are preserved automatically,
  sharing all unchanged blocks with the live filesystem. `[verified]` **Clones** are writable
  snapshots that "continue sharing unmodified blocks until changes occur." `[verified]`
- **Checksums become end-to-end.** ZFS stores each block's checksum **in its parent block
  pointer, not with the data** `[verified]`. This is the crucial detail: a checksum stored
  alongside its data validates the data against itself, so a misdirected write (the disk wrote
  a correct block to the *wrong address*) or a phantom write passes the check. Storing it in the
  parent makes the whole pool a **Merkle tree** that "self-validates," and detects misdirected
  and phantom writes that a self-contained checksum cannot. `[verified]` Given redundancy, ZFS
  detects corruption on read and "automatically reconstructs and repairs the corrupted blocks."
  `[verified]` — self-healing.
- **The cost is fragmentation** (§4.3) and read-modify-write amplification for small random
  overwrites inside large files.

**ZFS specifics** `[verified]`:

- **RAID-Z1/Z2/Z3** tolerate one, two and three disk failures.
- **The write hole is eliminated by construction** (see §4.7) via **dynamic stripe width**:
  "every block is its own RAID stripe, regardless of blocksize, resulting in every RAID-Z write
  being a full-stripe write." Combined with COW, writes "either complete fully or not at all."
- **ZIL / SLOG** — the ZFS Intent Log records synchronous writes so they can be acknowledged
  quickly and recovered after a crash. A dedicated **SLOG** device holds it. Critically, "the
  SLOG is never read" in normal operation — it exists purely for crash recovery. This is a
  frequently misunderstood point (people buy an SLOG expecting a write cache; it only helps
  *synchronous* writes, i.e. NFS and databases).
- **ARC** — Adaptive Replacement Cache, in RAM, which adapts between recency and frequency
  rather than being a plain LRU; **L2ARC** extends it onto an SSD. `[verified]` Worth contrasting
  with the Linux page cache's active/inactive lists (§3.3): ZFS deliberately does *not* use the
  page cache, because it wants its own policy — the same argument a database makes for
  `O_DIRECT` (§3.5), made by a filesystem.

**btrfs** — COW, checksums, snapshots, subvolumes, integrated multi-device support, online
resize, and transparent compression, in-tree in Linux (no licence problem, unlike ZFS's CDDL).
Its RAID 5/6 implementation has a long-standing reputation for being unsafe and is widely
advised against; RAID 0/1/10 are considered stable. `[uncertain — status has been evolving;
check current btrfs documentation before teaching a recommendation]`

**APFS** (Apple, 2017, replacing HFS+) — COW, snapshots, clones, space sharing between volumes
in a container, strong crash-safety, native encryption, and designed around flash rather than
rotating media. Notably it **checksums metadata but not user data**, on the stated reasoning
that Apple's storage hardware already provides ECC — a decision widely criticised by people who
have read the ZFS silent-corruption literature. It is a good, concrete example of a real
engineering trade made differently by a vendor who controls the whole stack. `[known]`

### 4.6 Comparison table

| | ext4 | XFS | btrfs | ZFS | APFS |
|---|---|---|---|---|---|
| Model | journalling, in-place | journalling, in-place | COW | COW | COW |
| Metadata structure | htree dirs, extent trees, bitmaps | B+trees throughout | B-trees throughout | B-trees / Merkle tree | B-trees |
| Data checksums | no | metadata only (CRC32c) | yes | yes | **no** (metadata only) |
| Snapshots | no (LVM below it) | no (reflinks yes) | yes | yes | yes |
| Built-in RAID | no | no | yes (5/6 questionable) | yes (RAID-Z) | no |
| Compression | no | no | yes | yes | yes |
| Scaling strength | general, extremely well-tested | **large files, high parallelism, huge volumes** | flexible | integrity + management | flash + Apple integration |
| Best at | the safe default | big-data, streaming, many-core servers | flexible Linux desktop/NAS | data you must not lose | macOS/iOS |

XFS deserves a specific note because its strength has a structural cause: **allocation groups**
allow genuinely parallel metadata operations across cores, and B+trees everywhere (including
free space, indexed *both* by offset and by size) avoid the bitmap scaling problem. That is why
XFS is the default in RHEL and the usual choice under large databases and streaming workloads.
Its historical weakness — very slow metadata-heavy delete workloads — was largely fixed by
delayed logging in 2010. `[known]`

### 4.7 RAID, the write hole, and why RAID is not a backup

| Level | Layout | Capacity | Survives | Write cost per random small write |
|---|---|---|---|---|
| 0 | striping, no redundancy | n | **nothing** | 1 write |
| 1 | mirroring | 1 (of n) | n−1 failures | 2 writes (one per mirror) |
| 5 | striping + **distributed** parity | n−1 | 1 failure | **4 I/Os** (read old data, read old parity, write data, write parity) |
| 6 | striping + dual parity | n−2 | 2 failures | **6 I/Os** (two parity blocks) |
| 10 | mirrors, striped | n/2 | 1 per mirror | 2 writes |

`[verified for layouts, capacities and fault tolerance; the 4-I/O and 6-I/O figures follow from
the read-modify-write cycle Wikipedia describes as the RAID 5 small-write penalty, quoted as a
"theoretical ¼ efficiency factor," RAID 6 as ⅙]`

**The RAID-5 small-write penalty** is the arithmetic consequence of parity. To update one block
you must recompute parity, which means reading the old data and old parity (parity is
`P = D₁ ⊕ D₂ ⊕ ... ⊕ Dₙ`, so `P_new = P_old ⊕ D_old ⊕ D_new`), then writing both. Four I/Os to
write one block. **A RAID-5 array of five disks has roughly the random write IOPS of a single
disk.** Every "why is our RAID-5 database slow" question has this as its answer.

**The write hole.** A stripe update is *not atomic*: the data write and the parity write are
separate operations to separate devices. Lose power in between and the stripe's parity no longer
matches its data. Nothing detects this — the array has no way to know which of the two is stale.
The corruption is silent and dormant. It becomes visible only when a disk later fails and the
array **reconstructs the missing block from the inconsistent parity**, producing data that was
never written by anyone. Wikipedia: RAID 5/6 "face vulnerability during simultaneous parity
updates and data writes." `[verified]`

The mitigations are exactly three, and each is instructive: a battery/flash-backed write cache
on a hardware controller (make the window survivable), a journal of stripe updates (Linux md's
`--write-journal`; pay an extra write), or **eliminate partial-stripe writes entirely** — which
is what RAID-Z does with dynamic stripe width plus COW, so "every RAID-Z write [is] a
full-stripe write" and writes "either complete fully or not at all." `[verified]`

**The URE / rebuild problem.** Manufacturers quote unrecoverable read error rates "around 1 per
10¹⁵ bits" `[verified]`. A rebuild must read **every sector of every surviving disk**. For an
8-disk array of 16 TB drives, a rebuild reads 7 × 16 TB ≈ 8.96 × 10¹⁴ bits — comparable to the
URE interval. On classic RAID-5 an URE during rebuild means the reconstruction fails and the
array is lost, and rebuilds of multi-terabyte drives take **days**, during which the surviving
disks are under sustained full-speed load and are the same age and model as the one that just
died. This is why RAID-5 is considered obsolete for large drives, and why RAID-6 or RAID-Z2 is
the floor. `[verified for the URE rate; the arithmetic is [derived]]`

> **RAID is not a backup, and the reason is a category error worth naming explicitly.** RAID
> protects against exactly one failure mode: *a disk stops working.* It replicates every write
> faithfully and instantly — including `rm -rf /`, including the ransomware encrypting your
> files, including the application bug that wrote nulls over your table, including the
> corruption from a bad controller or bad RAM. It does not protect against fire, theft, flood,
> or the datacentre being unreachable. **RAID is an availability technology; a backup is a
> time machine.** The test is simple: a backup lets you recover the state from *last Tuesday*.
> RAID cannot, by design. (The 3-2-1 rule — three copies, two media, one off-site — and the
> harder discipline: an untested restore is not a backup.) Snapshots (§4.5) sit in between:
> they give you last Tuesday, but they live on the same pool, so they do not survive the pool.

---

## 5. Storage engines: B-trees vs LSM-trees

This is the payoff of the whole document, and the best demonstration in computing that **the
data structure is dictated by the physics of the device beneath it.**

### 5.1 The B+tree and the buffer pool

The B+tree is the data structure of the disk era, and every part of it is an answer to §1.1:

- **Nodes are the size of a disk page** (4–16 KiB), because the device's minimum transfer unit
  is a page and reading less costs the same as reading a page.
- **Fanout is huge** — hundreds of keys per node — so the tree is shallow. A 4 KiB node holding
  ~200 keys indexes 10⁹ records in **four levels**. The design goal was never "minimise
  comparisons"; it was **minimise the number of page reads**, because each one cost 13 ms
  (§1.1). A binary search tree over the same data is ~30 levels deep — 30 seeks, 400 ms.
- **All data is in the leaves**, and leaves are **linked**, so a range scan walks the leaf chain
  without revisiting internal nodes.
- **It stays balanced by splitting.** When a node overflows, split it at the median and push a
  separator up to the parent; if the parent overflows, recurse; if the root splits, the tree
  grows by one level — **at the root**, which is why every leaf is always at the same depth.
  (Deletion merges/rebalances symmetrically, though many real systems just tolerate underfull
  nodes rather than merge, because concurrent merging is hard.)

The **buffer pool** is the engine's own page cache: a fixed set of frames, a hash table from
page id to frame, a replacement policy (LRU-K, CLOCK, or 2Q — not naive LRU, for the
scan-resistance reason in §3.3), **pin counts** so a page in use cannot be evicted, and dirty
flags. Combined with `O_DIRECT` (§3.5) it lets the engine own its caching completely.

**Updates are in place.** That is the defining property, and it is where the trouble starts:
changing one 16-byte row means writing back a whole 4 KiB (or 16 KiB) page.

### 5.2 The LSM-tree

An LSM-tree accepts that random in-place updates are expensive and refuses to do them.
`[verified]`

- **Memtable** — an in-memory sorted structure, "often implemented using a sorted data structure
  such as a Skip list or B+tree." All writes go here. `[verified]`
- **WAL** — because the memtable is volatile, "the write-ahead log (WAL) records all incoming
  writes" first, sequentially, so a crash loses nothing. `[verified]`
- **Flush** — when the memtable fills, it is written out as an **immutable sorted run**
  (an **SSTable**) in one sequential pass. `[verified]`
- **Levels and compaction** — runs accumulate; background **compaction** merges them "using an
  algorithm reminiscent of merge sort." `[verified]`
- **Updates and deletes are just writes.** An update is a new entry that shadows the old; a
  delete is a **tombstone**, "a placeholder indicating that the key has been deleted."
  `[verified]` Nothing is ever modified — only superseded, and reclaimed later by compaction.
  (Note the *exact* structural correspondence with the FTL in §1.7: write elsewhere, mark old
  invalid, reclaim in the background. The LSM-tree is an FTL for your key space.)

**Two compaction policies, and the choice between them is the whole tuning knob:** `[verified]`

- **Leveled** — "only one component exists per level, and merging happens more frequently,
  reducing the total number of components but increasing write amplification." Fewer runs to
  search → **better reads, worse writes, lower space amplification.** (RocksDB's default, and
  LevelDB's.)
- **Tiered / size-tiered** — "multiple components can coexist within a level, and merging occurs
  less frequently, reducing write amplification but increasing read costs because more
  components need to be searched." **Better writes, worse reads, higher space amplification.**
  (Cassandra's default.)

**Bloom filters** are what make LSM reads viable at all. A point lookup must, in principle,
check every run. A Bloom filter per SSTable answers "is this key definitely absent?" in O(1)
with a small false-positive rate and a few bits per key, "reducing zero-result lookups"
dramatically. `[verified]` So a lookup that misses in *k* runs pays *k* cheap in-memory filter
probes and ~1 real I/O. Complexity: point lookups are O(L) without filters, ~O(1) for existing
keys with them; range queries are O(L) for short ranges. `[verified]` **Bloom filters do not
help range scans** — you cannot ask a Bloom filter about an interval — which is the LSM's real
remaining weakness and the honest reason B-trees still dominate OLTP with range predicates.

**MVCC** (multi-version concurrency control) is a natural fit and worth connecting here: readers
see a consistent snapshot by reading the version of each row valid at their timestamp, so
readers never block writers and writers never block readers. In an LSM this falls out almost for
free (old versions are *already* lying around in older runs until compaction removes them; a
snapshot is just "ignore entries newer than T"). In a B-tree engine it has to be built
deliberately — PostgreSQL keeps old row versions **in the heap itself** and needs `VACUUM` to
reclaim them (the source of table bloat and transaction-ID wraparound); InnoDB keeps them in a
separate **undo log** and purges them in the background. Same abstraction, three different
implementations, each with a distinctive operational failure mode.

### 5.3 The tradeoff, measured

The RUM conjecture states you can optimise for at most two of **R**ead, **U**pdate and **M**emory
(space) amplification. B-trees and LSM-trees pick different corners.

I built the comparison as an executable model: a bounded LRU **buffer pool** over 4 KiB pages,
1,000,000 records of 16 bytes (16 MB of user data, 3,907 leaf pages), counting **bytes actually
written to the device**. Full source in §6, Exercise 4. `[measured]`

```
workload: 1000000 records x 16 B = 16.0 MB user data; 3907 leaf pages of 4096 B

index        order       page writes  bytes written  write amp
B-tree/64p   random           983671     4029116416     251.8x
B-tree/64p   sequential         3907       16003072       1.0x
B-tree/512p  random           868917     3559084032     222.4x
B-tree/512p  sequential         3907       16003072       1.0x
B-tree/4096p random             3907       16003072       1.0x
B-tree/4096p sequential         3907       16003072       1.0x

LSM leveled  any                7812       32000000       2.0x  (2 levels, fanout 10)
LSM tiered   any                4687       19200000       1.2x
```

Four conclusions, each independently valuable:

1. **A B-tree with random keys and a buffer pool smaller than the working set writes 251.8x more
   bytes than the user asked for.** Four gigabytes written to store sixteen megabytes. The
   mechanism is simple and brutal: each insert dirties a 4 KiB page for a 16-byte record, and
   the page is evicted before another record lands on it, so the full 4 KiB is written for each
   16 bytes. **4096/16 = 256** — the measured 251.8 is that bound, less the few pages that got
   a second hit before eviction.
2. **The same B-tree with sequential keys is 1.0x.** Identical data structure, identical data,
   identical pool. **Only the key order changed, and the write volume changed 250-fold.** This
   is why choosing a random UUID as a primary key instead of a monotonic one is one of the most
   expensive one-line decisions available in database design — and why UUIDv7 (time-ordered)
   exists.
3. **The same B-tree with a pool that holds the whole tree is also 1.0x.** So the amplification
   is not a property of the B-tree; **it is a property of the B-tree *relative to the amount of
   memory you gave it*.** Performance cliffs when a working set outgrows the buffer pool are
   not gradual.
4. **The LSM is 2.0x regardless of key order, and every write it issues is sequential.** It
   converts a random workload into a sequential one by construction. That is the entire value
   proposition, and it is exactly the trade the FTL in §1.7 was making — WA 8–30x for random,
   1.0x for sequential — which means an LSM sitting on an SSD *also* reduces the FTL's
   amplification underneath it. **The two log-structured layers compound in your favour on
   writes** (and this is precisely why ZNS wants to merge them).

The honest caveats on that table: my LSM model has only 2 levels because 16 MB of data over a
2 MB memtable barely needs any. Real deployments (terabytes over a ~64 MB memtable, fanout 10)
have 5–7 levels, and published RocksDB write amplification is more like **10–30x**, not 2x. The
B-tree's 251.8x is likewise a worst case — real engines fight it hard with group commit,
larger pages, fill factors, and by *not* using random keys. **The direction and the mechanism
are the lesson; the magnitudes are workload-specific.** `[measured, with modelling assumptions
stated]`

The summary that should end the unit:

| | B+tree | LSM-tree |
|---|---|---|
| Write pattern | **random**, in-place, page-granular | **sequential**, append-only |
| Write amplification | 1x sequential; up to ~(page/record) for random keys | ~2x per level; 10–30x total in practice |
| Read amplification | low and predictable — ~tree height | higher — must check multiple runs (Bloom filters mitigate point reads) |
| Space amplification | fragmentation, half-full pages (~1.3x typical) | stale versions until compaction (leveled ~1.1x, tiered much worse) |
| Range scans | **excellent** — linked leaves | good but must merge across runs; Bloom filters do not help |
| Latency profile | steady | **spiky** — background compaction steals I/O and CPU |
| Wins when | reads and range scans dominate; the working set fits in memory | writes dominate; data ≫ memory; the medium punishes random writes |

### 5.4 Real systems

- **InnoDB** (MySQL) — B+tree, **clustered index**: the primary key *is* the table, so rows are
  stored inside the leaves in primary-key order. This makes primary-key range scans superb and
  makes secondary indexes store the primary key (so a secondary lookup is two traversals), and
  it makes the choice of primary key enormously consequential — see point 2 above; a random
  UUID primary key in InnoDB is the textbook worst case for §5.3. Its **change buffer** defers
  secondary-index maintenance for pages not in the pool (a small LSM bolted onto a B-tree),
  and its **doublewrite buffer** solves torn pages (§3.4).
- **PostgreSQL** — B+tree indexes over a **heap** (rows are not stored in index order).
  Append-friendly, but MVCC old versions live in the heap and need `VACUUM`. Uses a WAL with
  **full page images** after each checkpoint to survive torn writes, and relies on the OS page
  cache alongside its own `shared_buffers` (the double-caching §3.5 complains about — a
  deliberate historical choice, with `O_DIRECT` support arriving only recently via async I/O).
- **RocksDB** (and LevelDB, from which it forks) — the reference LSM. Memtable + WAL + leveled
  compaction + per-SSTable Bloom filters. Embedded in an enormous number of systems (MySQL's
  MyRocks, CockroachDB's Pebble is a Go reimplementation, TiKV, Kafka Streams, Flink) precisely
  because "make random writes sequential" is the universal need on flash.
- **SQLite** — B-tree, single file, and pedagogically the best one to read: a rollback journal
  or (better) WAL mode, and a codebase small enough to actually study.
- **LMDB** — B+tree, COW, `mmap`-based, single-writer. The counterexample that makes the §3.6
  `mmap` debate concrete and non-obvious.
- **WiredTiger** (MongoDB) — supports both B-tree and LSM, so the same engine lets you switch
  the structure under the same API. The cleanest existence proof of this section's thesis.

---

## 6. Curriculum — five units in dependency order

### 6.0 The exercise backend: verified capabilities and hard limits

**Every fact in this subsection was established empirically against
`POST https://godbolt.org/api/compiler/cg152/compile` during this research.** Compiler ID
`cg152` = GCC 15.2 for C; use `g152` for C++. Request shape:

```json
{"source": "...", "lang": "c", "allowStoreCodeDebug": true,
 "options": {"userArguments": "-O2 -std=gnu11",
             "executeParameters": {"args": [], "stdin": ""},
             "compilerOptions": {"executorRequest": true},
             "filters": {"execute": true}}}
```

**What works** `[measured]`:

| Capability | Status |
|---|---|
| Kernel / arch | Linux **7.0.0-1011-aws**, x86-64 |
| Writing files to `/tmp` | **yes** — but `/tmp` is **tmpfs** (`f_type=0x1021994`), ~21 MB free |
| Writing files to `/app` (the cwd) | **yes** — real **ext4** (`f_type=0xEF53`), ~10.6 GB free, **network-backed** |
| `fsync` / `fdatasync` | yes, and on `/app` they genuinely cost 14–22 ms for 16 MiB |
| `O_DIRECT` | yes — open, read and write all succeed |
| `posix_fadvise(POSIX_FADV_DONTNEED)` | **yes, and it genuinely evicts** on `/app` (this is what makes cold-cache exercises possible) |
| `mmap` of a file | yes |
| `fork()` + `waitpid()` + `raise(SIGKILL)` | **yes** — real crash simulation |
| `io_uring` | **yes** — `io_uring_setup(8,&p)` returns a valid fd, `features=0x3ffff` |
| `/proc/sys/vm/*`, `/proc/meminfo`, `/proc/mounts` | readable |
| Runtime | at least 6.5 s of wall time observed successfully |

**Three hard limits that constrain every exercise** `[measured]`:

1. **`RLIMIT_FSIZE` = 16 MiB, soft *and hard*.** `setrlimit` to the hard limit "succeeds" and
   changes nothing; writes past 16 MiB fail with `EFBIG` ("File too large") on both `/tmp` and
   `/app`. **No exercise may create a file larger than 16 MiB.**
2. **`RLIMIT_NOFILE` = 100.** An exercise that opens one fd per SSTable must stay well under
   100.
3. **`/sys/block` is not exposed and `popen`/`system` appear to be blocked** — no shelling out,
   no reading device queue parameters.

**The trap that cost me a wrong result, and which any grader must handle: Compiler Explorer
caches compile-and-execute results by request hash.** Three identical submissions of a timing
program returned **byte-identical output including every microsecond figure**, and an identical
`execTime` of 6465 ms. The first (uncached) run of that program happened to catch a cold
container and reported cold-sequential *slower* than cold-random — the opposite of the truth.
Only after perturbing the source with a unique comment per submission did three genuinely
independent runs appear, all agreeing with each other and reversing the conclusion.

> **Any timing exercise must inject a nonce into the source on every submission**, and a grader
> must run ≥3 trials and compare against a *ratio* threshold, never an absolute duration.
> Correctness exercises (Units 4–5) are deterministic and unaffected.

**A consequence for pedagogy, stated honestly:** the sandbox cannot show HDD physics. There is
no seek, no rotational latency, and the backing device is network-attached with no random-access
penalty (cold random reads are sometimes *faster* than cold sequential in absolute per-op terms
before readahead kicks in). §1.1's 1,000:1 ratio must be taught by **calculation from published
mechanical specifications**, not measurement. What the sandbox *can* demonstrate, and does
spectacularly, is: readahead (28–38x), page-cache hit vs miss (203–433x), `fsync` cost
(~2,000x), and — through simulation — write amplification and the B-tree/LSM tradeoff. The
exercises below are built around what is genuinely measurable there.

---

### Unit 1 — The device decides everything

**The ONE idea:** *NAND flash is read and written in pages but erased only in blocks, and every
piece of storage software you will ever meet is a consequence of that one asymmetry.*

**Covers:** HDD mechanics and the 1,000:1 sequential/random ratio; the floating gate and charge
trap; the page/block asymmetry; SLC→QLC as a margin argument; 3D NAND; the FTL; garbage
collection, write amplification, over-provisioning, wear levelling, TRIM; read disturb and
retention; why an SSD slows when full; Optane's promise and its economic death; CXL.

**Prerequisite:** the memory unit (DRAM, the cache hierarchy).

#### Exercise 1.1 — Compute the ratio you cannot measure

**Task.** From published specifications only, compute for (a) a 7,200 rpm HDD with 9 ms average
seek and 200 MB/s sequential transfer, and (b) a 15,000 rpm HDD with 4 ms seek: the average
access time, the random 4 KiB IOPS, the sequential 4 KiB IOPS, and the ratio. Then compute how
long a full-surface read of a 16 TB drive takes at 250 MB/s, and state the implication for RAID
rebuild.

**Check.** Grader compares five numbers per drive against a closed form with 5% tolerance.
Reference for (a): 9 + 4.17 = **13.17 ms**; **75.9 random IOPS**; 200 MB/s ÷ 4 KiB = **51,200
sequential IOPS**; ratio **674x**. Full read of 16 TB at 250 MB/s = **17.8 hours**.

**Why this one.** It is the only honest way to teach mechanical latency in this environment, and
deriving 76 IOPS by hand lands harder than reading it. The 17.8-hour figure sets up §4.7.

#### Exercise 1.2 — Write amplification of your own FTL *(the flagship)*

**Task.** Implement a page-mapped FTL with greedy garbage collection: 256 pages per block, a
logical-to-physical map, per-block valid-page counts, an append point, and a GC that selects the
block with the fewest valid pages, relocates the survivors and erases it. Fill the device, then
issue 4× the device size in host writes under (a) uniform-random and (b) sequential LBAs, at
over-provisioning ratios of 2, 7, 14, 28 and 50%. Report write amplification for all ten
combinations.

**Check.** Ten numbers. Grader asserts: every sequential row is exactly **1.00**; the random row
at 7% OP is in **[6.5, 9.5]**; at 28% OP in **[2.0, 3.0]**; the random sequence is strictly
decreasing in OP; and random-at-2% exceeds random-at-50% by more than 10x. Additionally, assert
each random result is within 25% of `1/(2(1−u))`, `u = 1/(1+OP)`.

**Verified output** (complete source in §7, program `ex_wa.c`) `[measured]`:

```
OP%    pattern         host wr   flash wr       WA
2      random           204800    6204157    30.29
7      random           204800    1650689     8.06
14     random           204800     869631     4.25
28     random           204800     495534     2.42
50     random           204800     337588     1.65
2      sequential       204800     204800     1.00   (and 1.00 at every other OP)
```

**Why this one.** The learner writes ~120 lines and out falls (i) why sequential writes are free,
(ii) why an SSD slows when full, (iii) why enterprise drives sacrifice capacity, and (iv) a
result that matches a published analytic formula they can look up afterwards. Nothing else in
the unit converts "erase granularity ≠ write granularity" into a number the student produced
themselves.

#### Exercise 1.3 — The read-only workload that wears out the drive

**Task.** Extend the FTL with a read-disturb counter per block and a refresh threshold of 200,000
reads, forcing a relocate-and-erase when exceeded. Run a workload of **zero host writes** and
10⁸ reads concentrated on 1% of the LBA space. Report flash writes, erases, and the write
amplification.

**Check.** Assert `host_writes == 0`, `erases > 0`, and that the program prints that WA is
undefined/infinite rather than dividing by zero.

**Why this one.** It destroys the model students arrive with — that reads are free and writes
wear the device — in a way a paragraph cannot.

---

### Unit 2 — Getting to the device

**The ONE idea:** *The interface must be able to express as much parallelism as the medium
physically contains, or the medium's speed is unreachable.*

**Covers:** SATA/AHCI's single 32-deep queue versus NVMe's 65,535 × 65,536; the SSD's internal
channel/die/plane parallelism as the reason; PCIe as a packet-switched network — lanes, the
per-generation bandwidth table, TLPs, posted vs non-posted, enumeration, BDF, config space,
BAR sizing; MMIO vs DMA; doorbells; PRP/SGL; MSI-X and polled completion; the IOMMU.

**Prerequisite:** Unit 1 (you must know the medium is internally parallel before the queue depth
means anything). **Pays forward directly into the GPU unit** — the same enumeration, the same
BARs, the same DMA, the same bandwidth table.

#### Exercise 2.1 — Decode a real BAR

**Task.** Given a struct modelling a PCI configuration space header, implement the BAR sizing
algorithm: write all-1s, read back, decode from the returned value the region **size**, whether
it is memory or I/O space, 32- vs 64-bit, and prefetchability. Run it against six supplied
encoded BAR values including one 64-bit BAR spanning two registers.

**Check.** Six exact (size, type, width, prefetchable) tuples. Deterministic, no timing.

**Why this one.** BAR sizing is the one place a student can *watch* a bus discover itself, and
it is pure bit manipulation — perfectly gradeable and genuinely how the machine boots.

#### Exercise 2.2 — Why the doorbell is a write

**Task.** Given measured costs (MMIO read = 1.5 µs round trip, MMIO write = 100 ns posted,
DMA setup = 200 ns, NAND page read = 50 µs, 8 dies), compute the maximum achievable IOPS for
three driver designs: (a) AHCI-style with 6 uncacheable register reads per command and queue
depth 1; (b) NVMe-style with one doorbell write per command, queue depth 1; (c) NVMe-style with
one doorbell write per batch of 32, queue depth 128 across 8 dies. Report all three and the
speedup.

**Check.** Three numbers within 5% of the closed form, plus an assertion that (c)/(a) > 100.

**Why this one.** It makes "deep queues matter" arithmetic rather than assertion, and it forces
the student to notice that design (b) is still limited by device latency — the queue *depth*,
not the doorbell, is what unlocks the parallelism.

#### Exercise 2.3 — The bandwidth table, derived

**Task.** Write a function `double lane_bw(int gen)` returning per-lane GB/s from the raw GT/s
and the encoding overhead (8b/10b for gens 1–2, 128b/130b for 3–5, PAM-4 for 6–7). Assert your
computed values match the published table.

**Check.** Assert gen 3 per-lane = 0.985 ± 0.005 GB/s and gen 5 ×4 = 15.75 ± 0.1 GB/s, and that
`lane_bw(3)/lane_bw(2)` > 1.9 despite the raw rate ratio being only 1.6.

**Why this one.** That last assertion is the exercise: the student must discover the 20% → 1.5%
encoding-tax change themselves to make the test pass.

---

### Unit 3 — The kernel's memory of the disk

**The ONE idea:** *Your reads and writes talk to RAM, not to the device; durability is the
separate, expensive, and frequently-broken act of leaving RAM.*

**Covers:** the VFS and the block layer; blk-mq; why `none` is the right I/O scheduler on NVMe;
the page cache, active/inactive lists, dirty pages, writeback threads and the `dirty_ratio`
throttle; readahead; `fsync`/`fdatasync` and the five-link durability chain; fsyncgate; barriers
and FUA; torn writes; `O_DIRECT`; `mmap`'s traps; `io_uring`.

**Prerequisites:** Units 1–2, plus the OS unit's syscall and virtual-memory material.

#### Exercise 3.1 — Cold, warm, direct: the same reads, three ways *(the flagship)*

**Task.** Create a 16 MiB file on the ext4 mount. Read all 4,096 pages with 4 KiB `pread`s, four
ways: (a) sequential order with the cache dropped via `posix_fadvise(DONTNEED)`; (b) sequential
again immediately (warm); (c) random order, cache dropped; (d) random again (warm). Then repeat
(c) with `O_DIRECT`. Report µs/op for each and the three ratios. Run the identical program
against a file on `/tmp` and explain the difference.

**Check.** Grader runs 3 trials with a source nonce and takes the median. Asserts on ext4:
`cold_random / cold_sequential > 10`; `cold_random / warm_random > 50`; `O_DIRECT >
warm_random * 50`. Asserts on tmpfs: **all three ratios < 3**.

**Verified output** (3 independent runs, ext4 on `/app`) `[measured]`:

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| cold sequential | 5.70 µs | 11.51 µs | 12.05 µs |
| cold random | 218.24 µs | 340.15 µs | 342.95 µs |
| **random ÷ sequential** | **38.3x** | **29.6x** | **28.5x** |
| warm random | 1.07 µs | 1.35 µs | 0.79 µs |
| **cold ÷ warm (random)** | **203x** | **252x** | **433x** |
| `O_DIRECT` random | 580.4 µs | 559.9 µs | 592.8 µs |
| mmap random touch | 40.2 µs | 41.2 µs | 40.0 µs |

tmpfs, same program: every ratio between 0.84x and 1.24x. `[measured]`

**Why this one.** One program, one file, one set of reads — and a 250x spread produced purely by
*order* and *cache state*. The tmpfs control is what makes it rigorous: it proves the effect is
the storage stack and not the loop. And the `O_DIRECT` row teaching that "bypass the cache" is
**slower** corrects the most common misconception in the unit.

#### Exercise 3.2 — A write is not durable, and process death is not power loss *(the subtle one)*

**Task.** (a) `fork()` a child that writes 5,000 records **without** `fsync` and then `_exit()`s
— no `close`, no flush. In the parent, count how many records are readable. Repeat with `fsync`.
(b) Then time 200 appends with and without `fdatasync` per append, on ext4 and on tmpfs.
Explain, in writing, why part (a) shows what it shows.

**Check.** Assert both variants in (a) recover **5,000/5,000**. Assert in (b) that ext4
`fsync`/no-`fsync` > 500x and that tmpfs-with-`fsync` is within 5x of ext4-without-`fsync`.

**Verified output** (source in §7, `ex_durab.c`) `[measured]`:

```
NO fsync     after process death: 5000/5000 records readable
WITH fsync   after process death: 5000/5000 records readable
NO fsync     200 appends:     0.15 ms  (  0.001 ms/append)
WITH fsync   200 appends:   413.39 ms  (  2.067 ms/append)
WITH fsync   200 appends:     0.22 ms  (tmpfs: fsync has nothing to flush)
```

**Why this one is designed the way it is.** The naive version of this exercise ("show a write
without fsync is not durable") **cannot be done honestly in a sandbox** — you cannot cut power
to a shared VM, and any attempt produces a misleading result. So the exercise inverts: part (a)
proves that **killing the process loses nothing**, because the page cache belongs to the kernel,
not the process. The student's model must then split into two failure modes it previously
conflated:

> **`write()` survives process death. Only `fsync` survives *power* death.**

Part (b) then prices the difference at **~2,000x**, and the tmpfs line shows what a device that
lies about flushing looks like from userspace — indistinguishable, all syscalls returning 0.
That is a stronger and more honest lesson than a faked crash, and it directly motivates
fsyncgate.

#### Exercise 3.3 — Find the writeback cliff

**Task.** Read `dirty_ratio`, `dirty_background_ratio` and `MemAvailable` from `/proc`. Compute
the byte thresholds at which background writeback starts and at which a writing process is
throttled. Then write in 1 MiB chunks, timing each, and plot/report the per-chunk latency
distribution and its maximum.

**Check.** Assert the program correctly reports `dirty_ratio=20`, `dirty_background_ratio=10`,
`dirty_expire_centisecs=3000`, `dirty_writeback_centisecs=500` `[measured — these are the
sandbox's live values]`, and that computed thresholds match `MemAvailable × ratio / 100`.

**Note the honest limitation:** the 16 MiB `RLIMIT_FSIZE` means the student **cannot actually
reach** the throttle threshold (which is gigabytes). The exercise therefore grades the
*calculation* and has the student state how much data would be required. Do not promise a
measured stall.

---

### Unit 4 — Naming bytes: filesystems and crash consistency

**The ONE idea:** *A filesystem is a crash-consistency protocol that happens to store files —
and the protocol protects its own metadata, not your data.*

**Covers:** superblock, inode, directories-as-files, hard links and the link count; extents vs
indirect blocks; delayed allocation, `fallocate`, block groups, fragmentation; journalling,
physical vs logical, `data=journal`/`ordered`/`writeback` and their exact guarantees; barriers
and FUA; COW, Merkle-tree checksums, snapshots; ext4/XFS/btrfs/ZFS/APFS; RAID levels, the
small-write penalty, the write hole, URE-during-rebuild, and why RAID is not a backup.

**Prerequisites:** Units 1 and 3.

#### Exercise 4.1 — Extents vs block pointers, in metadata bytes

**Task.** For a file of size S at 4 KiB blocks, compute the metadata bytes required by (a) the
ext2 scheme (12 direct + single + double + triple indirect, 4-byte block numbers, 1024 pointers
per indirect block) — counting indirect blocks as metadata — and (b) an extent scheme with
12-byte extents each covering up to 32,768 blocks. Report both for S = 4 KiB, 1 MiB, 1 GiB and
100 GiB, assuming perfect contiguity. Then repeat (b) for a file fragmented into 4 KiB pieces.

**Check.** Eight exact integers. Assert extents beat pointers by >1000x at 1 GiB contiguous, and
that **fragmented extents are *worse* than pointers** — the trap that teaches the real lesson.

**Why this one.** The last assertion is the point: extents are not unconditionally better, they
are a bet on contiguity, which is a bet on the allocator, which is why §4.3 exists.

#### Exercise 4.2 — Simulate the three journalling modes

**Task.** Model a filesystem as (data blocks, inode size, allocation bitmap) plus an ordered
list of pending writes. Implement `data=writeback`, `data=ordered` and `data=journal` as three
different orderings/duplications of those writes. For each mode, inject a crash at **every**
possible point in the write sequence and classify the resulting state as: consistent+current,
consistent+stale, consistent+**garbage** (inode says N bytes, blocks hold another file's old
contents), or **inconsistent** (bitmap disagrees with inode).

**Check.** Assert across all crash points: `writeback` produces ≥1 *garbage* outcome and 0
inconsistent; `ordered` produces 0 garbage and 0 inconsistent, but ≥1 stale; `journal` produces
0 garbage, 0 inconsistent and 0 stale-past-commit. Also assert `journal` issues ~2x the write
volume of `ordered`.

**Why this one.** "Ordered mode prevents stale data exposure" is a sentence students nod at and
do not absorb. Enumerating every crash point and *finding the garbage outcome themselves* in
writeback mode makes the distinction permanent — and the 2x write-volume assertion prices the
strongest mode.

#### Exercise 4.3 — The RAID-5 write hole, and why parity cannot detect it

**Task.** Model a 4-disk RAID-5 stripe with `P = D₁⊕D₂⊕D₃`. (a) Perform a partial-stripe update
of `D₂`, counting the I/Os (assert 4). (b) Crash between the data write and the parity write.
(c) Verify that the array cannot detect the inconsistency from parity alone when all disks are
present. (d) Now fail `D₃` and reconstruct it from the stale parity; compare the reconstructed
block with what `D₃` actually held. (e) Implement RAID-Z's fix: full-stripe writes only, and
show the inconsistent state is now unreachable.

**Check.** Assert: (a) exactly 4 I/Os; (c) the corruption is undetectable with all disks
present; (d) the reconstructed `D₃` **differs from the true `D₃`** — silent, invented data;
(e) no crash point in the RAID-Z version produces a mismatched stripe.

**Why this one.** Step (d) manufactures data that no one ever wrote, from a crash that happened
long before, revealed only by an unrelated later failure. Producing that with your own code is
the most memorable possible argument for checksums, COW, and "RAID is not a backup."

---

### Unit 5 — Data structures dictated by physics

**The ONE idea:** *The access-cost asymmetry of the device below chooses the data structure
above — this is the cleanest example in all of computing that hardware dictates software.*

**Covers:** B+trees — page-sized nodes, fanout, splits, linked leaves; the buffer pool, pinning
and replacement; in-place update and its cost; LSM-trees — memtable, WAL, SSTables, leveled vs
tiered compaction, tombstones, Bloom filters; read/write/space amplification and the RUM
conjecture; MVCC; WAL and group commit; InnoDB, PostgreSQL, RocksDB, SQLite, LMDB.

**Prerequisites:** all four preceding units. This unit's headline result is meaningless without
Unit 1's write amplification and Unit 3's page cache.

#### Exercise 5.1 — B+tree node split with invariant checking

**Task.** Implement a B+tree of order 8 with insertion and node splitting: split at the median,
**copy** the separator up for leaf splits and **move** it up for internal splits, grow the tree
at the root. Maintain the leaf sibling chain. Insert 200,000 keys in random order and again in
sequential order. After each build, run a full invariant check.

**Check.** The verifier asserts: keys sorted within every node; no node over-full; every
non-root node at least half-full; **all leaves at identical depth**; every separator correctly
bounds its subtrees; the total key count in leaves equals N; and walking the leaf sibling chain
yields all N keys in sorted order.

**Verified output** (source in §7, `ex_btree.c`) `[measured]`:

```
RANDOM     N=200000 height=7 keys-in-leaves=200000 leaf-chain=200000 invariant-failures=0
SEQUENTIAL N=200000 height=8 keys-in-leaves=200000 leaf-chain=200000 invariant-failures=0
```

**Why this one.** The leaf-vs-internal split asymmetry (copy up vs move up) is where every
from-scratch B+tree implementation breaks, and only a full invariant sweep catches it — a
partially-wrong tree still answers most queries correctly, which is exactly the failure mode
worth teaching students to distrust.

#### Exercise 5.2 — B-tree vs LSM write amplification *(the flagship of the entire track)*

**Task.** Model a bounded LRU buffer pool over 4 KiB pages. Insert 1,000,000 16-byte records
into a B-tree-shaped index, in random and in sequential key order, at pool sizes of 64, 512 and
4,096 pages. Count **bytes actually written to the device** (dirty evictions plus final flush).
Then compute the same figure for a leveled and a tiered LSM under the identical workload.
Produce the full 8-row table.

**Check.** Assert: random @ 64 pages > 200x; sequential @ any pool size == 1.0x; random @ 4,096
pages (pool ≥ whole tree) == 1.0x; LSM within [1.0x, 5.0x] and **identical for random and
sequential key order**. Additionally assert `random@64 / sequential@64 > 100`.

**Verified output** (source in §7, `ex_amp.c`) `[measured]`:

```
index        order       page writes  bytes written  write amp
B-tree/64p   random           983671     4029116416     251.8x
B-tree/64p   sequential         3907       16003072       1.0x
B-tree/512p  random           868917     3559084032     222.4x
B-tree/512p  sequential         3907       16003072       1.0x
B-tree/4096p random             3907       16003072       1.0x
B-tree/4096p sequential         3907       16003072       1.0x
LSM leveled  any                7812       32000000       2.0x
LSM tiered   any                4687       19200000       1.2x
```

**Why this is the flagship.** Three variables — key order, buffer pool size, index structure —
and the student discovers that the *first two* move write volume by 250x while the third makes
the workload immune to both. It closes the loop with Unit 1: the LSM's sequential writes are
exactly the pattern that gave the FTL write amplification 1.00 in Exercise 1.2. The physics of
the erase block, four units later, has chosen the data structure.

#### Exercise 5.3 — A log-structured store that survives a real crash

**Task.** Build an append-only key-value store: CRC32C-guarded records (`crc, klen, vlen`, key,
value), tombstones for deletes, and recovery by scanning the log and stopping at the first
record whose CRC fails or whose length runs past EOF. Write 500 keys, overwrite 100, delete 50,
and `fsync`. Then **`fork()` a child that appends a deliberately truncated record and
`raise(SIGKILL)`s itself.** Recover in the parent. Finally, compact: rewrite only live records
to a temp file, `fsync`, and `rename()` over the original.

**Check.** Six assertions: the torn record is detected; **no committed record is lost**;
the recovered live-key set is identical to the pre-crash set; compaction preserves every live
key; the log shrinks; and the post-compaction log scans clean with zero torn records.

**Verified output** (source in §7, `ex_log.c`) `[measured]`:

```
clean log:    650 records, torn=0, live keys=450, bytes=18950
child killed by signal 9; log now 18972 bytes (grew by 22)
after crash:  650 records replayed, torn=1, live keys=450
CHECK torn-detected      : PASS
CHECK no-record-lost     : PASS (650 == 650)
CHECK state-identical    : PASS (450 == 450)
after compact:450 records, torn=0, live keys=450, bytes=13650 (72.0% of original)
CHECK compaction-lossless: PASS
CHECK log-shrank         : PASS
```

**Why this one.** The crash is **real** — an actual `SIGKILL` mid-record, verified by the parent
observing signal 9 and the file growing by 22 bytes of garbage. The student builds, in under 200
lines, the four mechanisms that every one of RocksDB, the ext4 journal, PostgreSQL's WAL and the
SSD's own FTL is built from: **append-only writes, checksums to detect torn tails, replay to
rebuild state, and compaction to reclaim.** It is the single best capstone available for this
material.

#### Exercise 5.4 — Bloom filters and the read cost of an LSM

**Task.** Implement a Bloom filter with k hash functions over m bits. For n = 100,000 keys,
compute and then **measure** the false-positive rate at m/n = 4, 8, 12 and 16 bits per key,
using the optimal `k = (m/n)·ln2`. Then model an LSM point lookup across 7 runs and report the
expected number of real I/Os with and without filters.

**Check.** Assert measured FP rate is within 20% of `(1−e^(−kn/m))^k` at every point (reference:
~2.4% at m/n=8 with k=6), and that modelled I/Os per lookup fall from 7 to under 1.2 with
filters at 10 bits/key.

**Why this one.** It supplies the missing half of §5.3: the LSM's write advantage is paid for
with read amplification, and the Bloom filter is what makes that price affordable. Without this
exercise a student concludes LSMs simply dominate B-trees, which is wrong.

---

## 7. Verified exercise sources

All four programs below were compiled with `cg152` (GCC 15.2) at `-O2 -std=gnu11` and executed
on Compiler Explorer during this research; the outputs quoted in §6 are verbatim. They are
written to be given to students with sections removed, and each is self-checking.

- **`ex_wa.c`** — the FTL / write-amplification simulator (Exercise 1.2). Page-mapped FTL, 256
  pages/block, greedy GC, five OP ratios × two access patterns. Exit code 0; prints the 10-row
  table.
- **`ex_durab.c`** — the durability demonstration (Exercise 3.2). `fork` + `_exit` recovery
  test, then `fdatasync` timing on ext4 and tmpfs. Requires `/app` (ext4) to be writable.
- **`ex_btree.c`** — B+tree with splitting and the full invariant verifier (Exercise 5.1).
- **`ex_amp.c`** — bounded-LRU buffer pool, B-tree vs LSM byte-level write amplification
  (Exercise 5.2). ~2.3 s runtime at 1M records; stays well within the sandbox's time budget.
- **`ex_log.c`** — the crash-surviving log-structured store with CRC32C, tombstones, `SIGKILL`
  crash injection, recovery and compaction (Exercise 5.3). Requires `fork` and `/app`.

All five are saved alongside this document in
`.research/storage-exercises/` (`ex_wa.c`, `ex_durab.c`, `ex_btree.c`, `ex_amp.c`, `ex_log.c`).

Two operational notes for whoever builds the grader:

1. **Inject a per-submission nonce comment** into every timing program's source, or Compiler
   Explorer will return a cached result with cached timings (§6.0).
2. **Grade timing exercises on ratios across ≥3 trials**, never on absolute microseconds — the
   sandbox is a shared VM on network-attached storage and absolute numbers move by 2x between
   runs while the ratios hold.

---

## 8. Sources

**Primary / near-primary, fetched and read this session:**

1. [PCI Express — Wikipedia](https://en.wikipedia.org/wiki/PCI_Express) — per-generation
   transfer rates, encoding schemes, per-lane and ×16 bandwidth table (§2.2).
2. [NVM Express — Wikipedia](https://en.wikipedia.org/wiki/NVM_Express) — AHCI vs NVMe queue
   counts, register-access counts, command-fetch behaviour (§2.1).
3. [3D XPoint — Wikipedia](https://en.wikipedia.org/wiki/3D_XPoint) — Optane performance
   figures, full commercial timeline, Micron's CXL pivot and the Lehi fab sale (§1.8).
4. [Flash memory — Wikipedia](https://en.wikipedia.org/wiki/Flash_memory) — floating gate vs
   charge trap, page/block granularity, the erase-before-program rule, cell types and voltage
   levels, read disturb thresholds, retention and temperature dependence (§1.2–1.5, §1.7).
5. [Write amplification — Wikipedia](https://en.wikipedia.org/wiki/Write_amplification) — the
   WA and OP formulas, garbage collection, TRIM (incl. Linux 2.6.33), wear levelling costs,
   sequential vs random behaviour, the 7/14/28% OP figures (§1.7).
6. [Flash translation layer — Wikipedia](https://en.wikipedia.org/wiki/Flash_translation_layer)
   — page/block/hybrid mapping and the ~1:1000 metadata ratio (§1.6).
7. [Compute Express Link — Wikipedia](https://en.wikipedia.org/wiki/Compute_Express_Link) —
   CXL.io/.cache/.mem, version history, pooling, PCIe generation dependencies (§1.9).
8. [Journaling file system — Wikipedia](https://en.wikipedia.org/wiki/Journaling_file_system) —
   physical vs logical journals, the "appended with garbage" failure mode, device write caches
   and barriers (§4.4).
9. [Standard RAID levels — Wikipedia](https://en.wikipedia.org/wiki/Standard_RAID_levels) —
   layouts, capacities, fault tolerance, the RAID-5 small-write penalty, the write hole, and
   the ~1-per-10¹⁵-bits URE rate (§4.7).
10. [ZFS — Wikipedia](https://en.wikipedia.org/wiki/ZFS) — COW, checksums stored in the parent
    block pointer, self-healing, snapshots/clones, RAID-Z dynamic stripe width and write-hole
    elimination, ZIL/SLOG, ARC/L2ARC (§4.5, §4.7).
11. [Log-structured merge-tree — Wikipedia](https://en.wikipedia.org/wiki/Log-structured_merge-tree)
    — memtable, SSTables, leveled vs tiered compaction, tombstones, Bloom filters, WAL,
    complexity bounds (§5.2).
12. [io_uring — Wikipedia](https://en.wikipedia.org/wiki/Io_uring) — SQ/CQ rings, the
    single-writer discipline, Linux 5.1, and the Linux AIO limitations it fixed (§3.7).
13. [Hard disk drive performance characteristics — Wikipedia](https://en.wikipedia.org/wiki/Hard_disk_drive_performance_characteristics)
    — seek times, the rotational-latency table, sequential transfer rates (§1.1).
14. [LWN: "PostgreSQL's fsync() surprise"](https://lwn.net/Articles/752063/) — fsyncgate: dirty
    pages discarded on writeback failure, the once-only error report, the reopen problem, the
    kernel developers' USB-drive rationale, and PostgreSQL's response (§3.4).
15. [Linux kernel documentation — `admin-guide/sysctl/vm`](https://www.kernel.org/doc/html/latest/admin-guide/sysctl/vm.html)
    — semantics of `dirty_ratio`, `dirty_background_ratio`, `dirty_bytes`,
    `dirty_expire_centisecs`, `dirty_writeback_centisecs`, `vfs_cache_pressure`, `drop_caches`
    (§3.3). *Defaults were not stated in the doc and were instead measured live (below).*
16. **[Compiler Explorer](https://godbolt.org)** — every `[measured]` figure in this document,
    via `POST /api/compiler/cg152/compile` with `executorRequest`. Sandbox capabilities,
    rlimits, filesystem types, `/proc/sys/vm` defaults and all five exercise programs were run
    there during this research (§6.0, §7).

**Recommended for the curriculum but not re-read this session** `[known]`: Bruce Jacob et al.,
*Memory Systems*; Andrew Tanenbaum, *Modern Operating Systems* (filesystem chapters);
Arpaci-Dusseau, *Operating Systems: Three Easy Pieces* (the persistence section is the single
best free treatment of this material); Martin Kleppmann, *Designing Data-Intensive
Applications* ch. 3 (the canonical B-tree vs LSM comparison); Pavlo & Crotty, "Are You Sure You
Want to Use MMAP in Your DBMS?" (CIDR 2022); Athanassoulis et al., "Designing Access Methods:
The RUM Conjecture" (EDBT 2016); Pillai et al., "All File Systems Are Not Created Equal"
(OSDI 2014) — the crash-consistency testing paper that found bugs in every filesystem and
application it examined; the RocksDB and SQLite documentation.

---

## 9. Explicit uncertainty list

Things I could **not** verify this session, or verified only partially. Do not teach these as
fact without checking.

1. **WebSearch was unavailable** — the session's 200-search budget was exhausted before this
   task began. All verification was done via direct WebFetch of URLs I could name, which biased
   sources toward Wikipedia and a small number of known-good pages. **No vendor datasheets, no
   USENIX/FAST papers, no SNIA specifications were consulted**; `usenix.org` returned HTTP 403
   to WebFetch. The FAST/ATC literature on FTL design, garbage-collection policy and SSD
   performance modelling is the obvious gap, and someone should close it before this becomes
   teaching material.
2. **NAND block sizes and pages-per-block are `[known]`, not verified.** Wikipedia verified the
   4–16 KiB page size and the write-amplification article uses a 256 KiB erase block, but the
   "128–1024 pages per block" and "0.5–24 MiB blocks" ranges in §1.3 are from memory. Modern
   high-layer-count TLC/QLC parts vary enormously. Get a current datasheet.
3. **P/E cycle endurance figures for MLC/TLC/QLC are `[known]`, not verified.** Wikipedia
   verified only the bits-per-cell and voltage-level columns, plus one specific 2008 SLC
   announcement of 1,000,000 cycles (an outlier). The 3,000/1,000/100-cycle figures are
   industry rules of thumb that have shifted with 3D NAND — modern 3D TLC is generally better
   than late planar TLC. Treat the table's *ordering* as solid and its *magnitudes* as
   approximate.
4. **NAND operation latencies (25–100 µs read, 200–800 µs program, 2–10 ms erase) are
   `[known]`.** The 100:1 ratio between them is the load-bearing claim and is robust; the
   absolute numbers vary by part and cell type.
5. **The write-amplification simulator's absolute values depend on my modelling choices** —
   greedy GC, 256 pages/block, 200 blocks, a specific GC trigger, uniform-random LBAs with no
   hot/cold skew. Real workloads are skewed, which *reduces* WA substantially, and real FTLs use
   cost-benefit victim selection rather than pure greedy. The agreement with `1/(2(1−u))` to
   4–6% mid-range validates the mechanism, not the applicability to any real drive.
6. **The B-tree vs LSM amplification model is a model, not a database.** The 251.8x is a
   clean worst case (random keys, pool < working set, one record per page write). My LSM figure
   of 2.0x is low because 16 MB over a 2 MB memtable needs only 2 levels; **published RocksDB
   write amplification is more like 10–30x** and I did not verify that figure this session.
   The direction, mechanism and the three-way contrast are sound; the magnitudes are
   parameter-dependent and should be labelled as such to students.
7. **`btrfs` RAID 5/6 status is `[uncertain]`.** It has long been considered unsafe and the
   situation has been slowly improving. Check the current btrfs status page before making any
   recommendation.
8. **The ext3/ext4 journalling mode names, defaults and `auto_da_alloc` behaviour are
   `[known]`.** Wikipedia verified the *mechanism* (physical vs logical journals, the "appended
   with garbage" failure) but not ext4's specific mode names or that `data=ordered` is the
   default. Confirm against `mount(8)` / `ext4(5)`.
9. **The RAID small-write I/O counts (4 for RAID-5, 6 for RAID-6) are derived** from the
   read-modify-write cycle Wikipedia describes; Wikipedia itself states the penalty as
   "theoretical ¼ efficiency" and "⅙" rather than as I/O counts. The derivation is standard and
   I am confident, but it is a derivation.
10. **MMIO read latency (~1–2 µs) and syscall costs are `[known]`** order-of-magnitude figures
    used in Exercise 2.2's arithmetic. They vary by platform, and post-Spectre mitigation state
    matters a lot. The exercise supplies them as givens, so it is self-consistent regardless.
11. **`/sys/block` was not readable in the sandbox**, so I could **not** verify the default
    `read_ahead_kb` (commonly 128) or the default I/O scheduler on any real device. The
    readahead *effect* was measured (28–38x); the tunable's default value is `[known]`.
12. **The sandbox's ext4 volume is network-attached (AWS)**, not a local NVMe SSD. Its absolute
    latencies (218–343 µs cold random) are **not** representative of a local NVMe drive
    (~80–100 µs) and are wildly unrepresentative of an HDD. The *ratios* — readahead, cold vs
    warm, `O_DIRECT` — are the transferable results; the absolute numbers are not.
13. **I did not verify the exact execution timeout** of the Compiler Explorer executor. 6.5 s of
    wall time succeeded; the ceiling is unknown. Keep exercises well under 10 s.
14. **APFS's lack of user-data checksums is `[known]`** from Apple's documentation and
    contemporaneous reporting, not verified this session.
15. **CXL latency figures were deliberately not stated numerically** because I could not verify
    them. The qualitative claim (a NUMA-hop-plus, not DRAM-equivalent) is well established; a
    specific nanosecond figure should be sourced before teaching.
