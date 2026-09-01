## What are the three quantities that trade against each other?

- [x] Read, write and space amplification
- [ ] Latency, throughput and durability
- [ ] Reads, writes and deletes
- [ ] Memory, disk and network

@why Improving one worsens another, and the choice is which one your workload
can afford to be bad at.

## A hundred-byte update to a B-tree with four kilobyte pages writes how much?

- [x] Four kilobytes, before the device's own amplification
- [ ] A hundred bytes
- [ ] A hundred bytes plus a journal record
- [ ] It depends on how full the page is

@why The page is the unit of update, so the amplification is forty and the
device applies its own on top of that.

## Why is a B-tree lookup usually one device access rather than four?

- [x] The upper levels are small and touched by every lookup, so they stay cached
- [ ] The tree has only one level in practice
- [ ] The leaf holds the whole path
- [ ] Lookups are batched

@why The fanout makes the tree shallow and the interior levels tiny, so the leaf
is the only part the cache cannot hold.

## What happens when a B-tree page fills?

- [x] It splits, rewriting two pages and an ancestor, possibly up to the root
- [ ] It chains an overflow page
- [ ] The tree is rebuilt in the background
- [ ] The record goes to the next page

@why Which is a rare event with a large cost, and it is why write latency in a
B-tree has a long tail.

## In a log-structured tree, what does an update read from the device?

- [x] Nothing
- [ ] The page the key currently lives in
- [ ] The summary filter for that key
- [ ] The most recent file

@why An append to a log and an insertion into memory. Nothing on the device is
read, and nothing on it is modified.

## Where does the log structure's write amplification actually come from?

- [x] Merging, which rewrites each record once per level it passes through
- [ ] The durability log
- [ ] The memory table flush alone
- [ ] The summary filters

@why It is deferred and batched rather than absent, which is the point: large
sequential runs at the system's choosing, not small random writes at update time.

## A summary filter can answer which two ways?

- [x] Definitely not present, or possibly present
- [ ] Definitely present, or possibly present
- [ ] Present or absent, exactly
- [ ] Present, absent, or deleted

@why The one-sided error is what makes it useful and what makes it cheap: a
negative skips the file entirely, and a positive costs a read that may find
nothing.

## Ten bits per key gives roughly a one percent false positive rate. What does that buy across seven files?

- [x] A lookup for an absent key reads about one file rather than seven
- [ ] A lookup reads no files at all
- [ ] Reads become as fast as a B-tree's
- [ ] The merge cost drops by a factor of seven

@why It is the third amplification bought with the first: memory spent to avoid
reads.

## Who does the filter not help?

- [x] A workload whose lookups mostly succeed
- [ ] A workload checking for existence
- [ ] A workload of range scans
- [ ] A write-heavy workload

@why A key that is present has to be read from the file holding it whatever the
filters say, so the filter saves nothing on the path that matters.

## Why is a spinning disk a reasonable fit for a B-tree?

- [x] A random read and a random write both cost a seek, so the costs are symmetric
- [ ] Disks have no write amplification
- [ ] Disks are fast at small writes
- [ ] Disks reorder writes into sequential runs

@why The structure was designed for that machine. What changed was not the
software.

## What is the log-structured design a response to?

- [x] A device whose write path is the expensive one
- [ ] A device that is slow overall
- [ ] Growing dataset sizes
- [ ] The cost of memory

@why It converts many small random writes into few large sequential ones, which
is exactly the transformation that makes a flash controller's garbage collection
cheap.

## What does a deletion do in a log-structured engine?

- [x] Writes a marker; the record stays until a merge removes both
- [ ] Removes the record from its file
- [ ] Marks the record's file for immediate merging
- [ ] Frees the space at the next flush

@why Nothing is modified in place, so a delete is another append. In a B-tree it
is an update, and the space is immediately reusable.

## What does a workload of repeated inserts and deletes of the same keys accumulate?

- [x] Markers, faster than merging removes them
- [ ] Free space
- [ ] Deeper levels
- [ ] Larger summary filters

@why And a range that was emptied still has to be walked past, so scanning a
mostly deleted region reads all the markers.

## Which structure does a range scan favour, and why?

- [x] The B-tree, because its leaves are already in order
- [ ] The log structure, because its files are sorted
- [ ] Neither; the cost is the same
- [ ] The log structure, because scans are sequential there

@why The log structure must read from every file the range overlaps and merge
them on the fly, where the B-tree reads one contiguous run.

## Both families sit on a flushed log. What limits a system doing many small durable updates?

- [x] Flushes per second, which is why commits are grouped
- [ ] The structure's write amplification
- [ ] The size of the memory table
- [ ] The summary filters' false positive rate

@why The structure decides what the steady state costs and the log decides what a
crash costs, and grouping trades a little latency for a great deal of throughput.
