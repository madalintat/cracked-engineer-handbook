## What are the three NAND operations and their units?

- [x] Read a page, program a page, erase a block of hundreds of pages
- [ ] Read, write and delete, all at page granularity
- [ ] Read a sector, write a sector, erase a sector
- [ ] Read a byte, program a page, erase a chip

@why The rule that makes it awkward is that a page cannot be programmed twice, so
changing anything means erasing a unit a hundred times larger than the write you
asked for.

## Can flash overwrite a sector in place?

- [x] No, not at all
- [ ] Yes, exactly as a disk does
- [ ] Yes, but only within an erase block
- [ ] Only if the new value has fewer set bits

@why A disk overwrites a sector in place. Flash has no in-place overwrite, and
the entire translation layer exists to make it look otherwise.

## What does the flash translation layer do on a write?

- [x] Programs a fresh page, updates a map, and marks the old page as garbage
- [ ] Erases the containing block and rewrites it
- [ ] Buffers the write until a whole block is ready
- [ ] Writes directly to the addressed physical page

@why Repeated writes to one sector leave a trail of dead pages and one live one,
and the map is what makes the sector appear to have been overwritten.

## What is inside a flash drive doing all of that?

- [x] A real computer with its own processor, memory and firmware
- [ ] A small state machine in the interface logic
- [ ] The host's driver
- [ ] Fixed wiring in the NAND package

@why Every performance characteristic people attribute to flash is really a
characteristic of that firmware.

## What is write amplification?

- [x] The ratio of bytes the device programmed to bytes the host wrote
- [ ] The ratio of write bandwidth to read bandwidth
- [ ] The factor by which writes are slower than reads
- [ ] The number of retries a write needs on a worn cell

@why Four kilobytes forcing a four megabyte block rewrite is 1024 times, and it
is the number that decides both wear and sustained speed.

## Why is a full drive slower than an empty one?

- [x] The controller has less room to collect garbage into without copying
- [ ] The map becomes larger and slower to search
- [ ] Cells near capacity hold charge less reliably
- [ ] The interface queue fills

@why Space the host never uses is space the controller can work in, which is why
enterprise drives reserve a fraction of their capacity.

## What does the trim command tell the drive?

- [x] That a range of sectors is no longer needed and need not be preserved
- [ ] To erase a block immediately
- [ ] To run garbage collection now
- [ ] To reserve capacity for over-provisioning

@why Without it the controller cannot tell a deleted file from one somebody
wants, so it copies both through every collection.

## A drive got slower over months and recovered after a reformat. What happened?

- [x] It was preserving data deleted long ago by software that never told it
- [ ] The cells wore out and were remapped
- [ ] The map became fragmented
- [ ] The firmware degraded and was reset

@why From the controller's side that data was indistinguishable from a file
somebody still wanted.

## Roughly how many erase cycles does a cell storing three bits tolerate?

- [x] Hundreds to low thousands
- [ ] Tens of thousands
- [ ] A hundred thousand
- [ ] Millions

@why A cell storing one bit lasts on the order of a hundred thousand, and the
difference is why the choice of bits per cell is the largest lever in the design.

## Which workloads actually wear a drive out?

- [x] Constant small writes, where amplification is worst
- [ ] Large sequential writes
- [ ] Read-heavy workloads
- [ ] Any workload, given enough years

@why A database with a badly chosen page size can wear a drive out in a year, and
the fix is a storage design question rather than a hardware one.

## What does storing more bits per cell trade away?

- [x] Speed and endurance, for capacity per gigabyte
- [ ] Only capacity, for reliability
- [ ] Only speed, for capacity
- [ ] Nothing; it is free with modern controllers

@why Distinguishing sixteen charge levels rather than two requires more precise
reading, longer programming, and tolerates far less drift.

## Why does a short benchmark report a write speed the drive cannot sustain?

- [x] A portion of the drive runs at one bit per cell and absorbs the transfer
- [ ] The measurement includes the operating system's cache
- [ ] The drive detects benchmarks and boosts
- [ ] The queue depth is unrealistically high

@why It is not a lie about the hardware. That part really is that fast and the
rest really is not, and a real workload gets the second number.

## When does a drive acknowledge a write?

- [x] When the data is in volatile memory inside the controller
- [ ] When it is programmed into NAND
- [ ] When the erase block has been reclaimed
- [ ] When the map has been persisted

@why Which is what makes writes appear fast, and it means a power loss between
the acknowledgement and the programming loses data the host was told was safe.

## What makes a write durable?

- [x] A completed flush, or a drive with enough stored energy to finish
- [ ] The write returning successfully
- [ ] Writing with a synchronous flag
- [ ] Writing a whole block at once

@why Every database's commit path is arranged around that one call, and the cost
of it is the real programming latency rather than the buffered one.

## Why can one request at a time not reach a drive's advertised throughput?

- [x] The drive contains many independent NAND chips and one request uses one
- [ ] The interface adds per-request overhead
- [ ] The controller batches requests before starting
- [ ] It can; the advertised figure is for a single stream

@why The parallelism is in the medium and exploiting it is a property of the
interface, which is what the next unit exists to explain.
