## A page for a hundred bytes

Write `btree_write_amp`, returning how many bytes a B-tree writes per byte of
update, scaled by 100.

Changing one record means reading its page, modifying it, and writing the whole
page back.

@kind output
@concept A structure that keeps everything ordered in place pays for every update
by rewriting the neighbourhood, whatever the update's size.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The page is written whatever the record's size, so the ratio is the page
over the record.
@diagnose assert verdict assert-failed
A check disagrees. The amount written does not depend on the update's size, so
the ratio grows as the update shrinks: a hundred-byte change to a four-kilobyte
page is forty times, and a four-kilobyte change to the same page is one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Forty times, before the device's own amplification is applied on top of
it. Unit 039 said what a small random write does to a block-erased medium, and
this is a structure that produces one per update by construction.

```starter
unsigned long btree_write_amp(unsigned long record_bytes,
                              unsigned long page_bytes) {
    (void)page_bytes;
    return 100;
}
```

```tests
#include <assert.h>
unsigned long btree_write_amp(unsigned long, unsigned long);
int main(void) {
    /* A hundred bytes into a four kilobyte page. */
    assert(btree_write_amp(100, 4096) == 4096);
    /* A full page: no amplification at all. */
    assert(btree_write_amp(4096, 4096) == 100);
    /* Half a page. */
    assert(btree_write_amp(2048, 4096) == 200);
    return 0;
}
```

```solution
unsigned long btree_write_amp(unsigned long record_bytes,
                              unsigned long page_bytes) {
    return page_bytes * 100 / record_bytes;
}
```

## How deep the tree is

Write `btree_levels`, returning how many levels a B-tree needs to hold a given
number of keys at a given fanout.

A fanout of a few hundred means a billion keys in four or five levels.

@kind output
@concept The tree is shallow because the fanout is large, which is why a point
lookup is a handful of page reads and in practice one device access.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Multiply the capacity by the fanout until it reaches the key count,
counting levels.
@diagnose assert verdict assert-failed
A check disagrees. One level holds `fanout` keys, two hold `fanout` squared, and
so on, so the answer is how many times you multiply before covering the count.
Dividing the key count by the fanout once gives the number of leaves rather than
the depth.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Four levels at a fanout of 256 covers four billion keys. The upper levels
stay cached because they are small and every lookup touches them, so the device
access is the leaf, and that is why reads are close to optimal.

```starter
int btree_levels(unsigned long keys, unsigned long fanout) {
    if (keys <= 1) return 1;
    return (int)(keys / fanout) + 1;
}
```

```tests
#include <assert.h>
int btree_levels(unsigned long, unsigned long);
int main(void) {
    assert(btree_levels(1, 256) == 1);
    assert(btree_levels(256, 256) == 1);
    assert(btree_levels(257, 256) == 2);
    assert(btree_levels(65536, 256) == 2);
    assert(btree_levels(65537, 256) == 3);
    /* Four billion keys in four levels. */
    assert(btree_levels(4294967296UL, 256) == 4);
    return 0;
}
```

```solution
int btree_levels(unsigned long keys, unsigned long fanout) {
    int levels = 1;
    unsigned long capacity = fanout;
    while (capacity < keys) { capacity *= fanout; levels++; }
    return levels;
}
```

## Rewritten once per level

Write `lsm_write_amp`, returning how many times a record is rewritten over its
life in a log-structured tree, given the number of levels and the merge fan.

The merging is the write amplification, deferred and batched.

@kind output
@concept The amplification does not disappear, it moves: from small random writes
at update time to large sequential ones at a time of the system's choosing.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Once written into each level, plus the initial flush from memory.
@diagnose assert verdict assert-failed
A check disagrees. A record is written once when the memory table is flushed and
once more as it passes into each subsequent level, so seven levels is eight
writes rather than seven. The merge fan affects how much is read per merge rather
than how many times a record is written.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Eight times over its life, in large sequential runs, against the B-tree's
forty in one small random write at the moment of the update. The totals are not
far apart and the shapes are completely different, and the shape is what the
device cares about.

```starter
unsigned long lsm_write_amp(unsigned long levels, unsigned long merge_fan) {
    return levels * merge_fan;
}
```

```tests
#include <assert.h>
unsigned long lsm_write_amp(unsigned long, unsigned long);
int main(void) {
    /* One flush and no levels below. */
    assert(lsm_write_amp(0, 10) == 1);
    /* Seven levels: the flush plus one write per level. */
    assert(lsm_write_amp(7, 10) == 8);
    assert(lsm_write_amp(3, 4) == 4);
    return 0;
}
```

```solution
unsigned long lsm_write_amp(unsigned long levels, unsigned long merge_fan) {
    (void)merge_fan;
    return levels + 1;
}
```

## Looking in several places

Write `files_read`, returning how many files a lookup must actually read, given
how many exist, whether the key is present, and the summary filter's false
positive rate as a percentage.

A negative answer from a summary skips the file with no device access at all.

@kind output
@concept The filter trades memory for reads and only helps for keys that are
absent, which is why it is worth far more to a workload checking existence than
to one fetching known keys.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A present key is read from its own file whatever the filters say. Absent
keys are read only on a false positive.
@diagnose assert verdict assert-failed
A check disagrees. A key that exists is in exactly one file and that file's
filter says possibly, so it is read, and the others contribute false positives on
top. Treating a present key as costing nothing ignores the read that answers the
question.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after One percent across seven files means a lookup for an absent key reads
about none of them rather than all seven. That is the mitigation, and it costs a
few bits per key held in memory, which is the third amplification paying for the
first.

```starter
unsigned long files_read(unsigned long file_count, int key_present,
                         unsigned long false_positive_pct) {
    (void)key_present; (void)false_positive_pct;
    return file_count;
}
```

```tests
#include <assert.h>
unsigned long files_read(unsigned long, int, unsigned long);
int main(void) {
    /* Absent, perfect filters: nothing is read. */
    assert(files_read(7, 0, 0) == 0);
    /* Absent, filters useless: everything is read. */
    assert(files_read(7, 0, 100) == 7);
    /* Present: the one holding it, plus false positives among the rest. */
    assert(files_read(7, 1, 0) == 1);
    assert(files_read(7, 1, 100) == 7);
    /* Absent, one file, a filter that always says possibly. */
    assert(files_read(1, 0, 100) == 1);
    return 0;
}
```

```solution
unsigned long files_read(unsigned long file_count, int key_present,
                         unsigned long false_positive_pct) {
    if (!key_present) return file_count * false_positive_pct / 100;
    unsigned long others = file_count - 1;
    return 1 + others * false_positive_pct / 100;
}
```

## Deleting is another append

Write `space_after_delete`, returning how many records a log-structured engine
still holds after a deletion, given the live records and how many deletion
markers are outstanding.

Nothing is modified in place, so a deletion cannot remove anything.

@kind output
@concept In one structure a delete is an update and in the other it is another
append, which is the clearest single example of the family difference.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The old record is still there and the marker is there too, until a merge
removes both.
@diagnose assert verdict assert-failed
A check disagrees. Deleting adds a marker without removing the record it hides,
so the storage held goes up rather than down until a merge passes over both.
Subtracting the deletions models a structure that can modify in place, which is
the other family.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A workload that inserts and deletes the same keys repeatedly accumulates
markers faster than merging removes them, and a range that was emptied still has
to be walked past. A B-tree has no equivalent, because a delete removes the
record from its page and the space is immediately reusable.

```starter
unsigned long space_after_delete(unsigned long live_records,
                                 unsigned long deleted_records) {
    return live_records - deleted_records;
}
```

```tests
#include <assert.h>
unsigned long space_after_delete(unsigned long, unsigned long);
int main(void) {
    /* Nothing deleted. */
    assert(space_after_delete(1000, 0) == 1000);
    /* A hundred deleted: the records remain and the markers are added. */
    assert(space_after_delete(1000, 100) == 1100);
    /* Everything deleted and nothing merged yet. */
    assert(space_after_delete(1000, 1000) == 2000);
    return 0;
}
```

```solution
unsigned long space_after_delete(unsigned long live_records,
                                 unsigned long deleted_records) {
    return live_records + deleted_records;
}
```

## Which the device picks

Write `prefer_log_structured`, deciding which family a device suits, given the
cost of a random read and the eventual cost of a small random write.

The log structure is a response to a device whose write path is the expensive
one.

@kind output
@concept On a spinning disk the two costs are about equal and the B-tree fits;
on flash they are not, and small random writes are what the medium is worst at.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The asymmetry is the input, not the absolute speed.
@diagnose assert verdict assert-failed
A check disagrees. A slow device with symmetric costs suits the B-tree exactly as
a fast one does, because what matters is the ratio between a read and a write
rather than either number. Comparing the write cost against a threshold makes the
answer depend on the device's speed instead of its shape.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Change the device again and the answer changes again. That is the whole
argument, and it is why this is not a taste question: the same structure is right
on one medium and wrong on another with nothing about the software having
changed.

```starter
int prefer_log_structured(unsigned long read_ns, unsigned long write_ns) {
    (void)read_ns;
    return write_ns > 100000;
}
```

```tests
#include <assert.h>
int prefer_log_structured(unsigned long, unsigned long);
int main(void) {
    /* A disk: a seek either way, so the costs are symmetric. */
    assert(prefer_log_structured(8000000, 8000000) == 0);
    /* Flash: reads are cheap and small random writes are not. */
    assert(prefer_log_structured(50000, 500000) == 1);
    /* A hypothetical fast device with symmetric costs. */
    assert(prefer_log_structured(1000, 1000) == 0);
    /* And one where writes are somehow cheaper. */
    assert(prefer_log_structured(500000, 50000) == 0);
    return 0;
}
```

```solution
int prefer_log_structured(unsigned long read_ns, unsigned long write_ns) {
    return write_ns > read_ns * 2;
}
```

## Reading a range

Write `range_scan_cost`, returning how many sequential runs a range scan reads,
under a B-tree and under a log-structured tree with a given number of files.

Leaves are already in order in one and must be merged on the fly in the other.

@kind output
@concept Range scans favour the ordered structure, because the log-structured one
must read from every file that overlaps the range and combine them.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The ordered structure reads one run whatever the range. The other reads one
per overlapping file.
@diagnose assert verdict assert-failed
A check disagrees. A B-tree's leaves for a contiguous range are contiguous, so it
is one sequential run however wide the range, and the log structure needs one per
file the range touches. Reporting the same for both loses the distinction the
exercise is about.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Which is why a workload dominated by scans favours the B-tree even on
flash, since a scan is sequential and sequential writes were the thing the log
structure existed to produce. The device narrows the choice and the workload
picks within it.

```starter
void range_scan_cost(unsigned long overlapping_files,
                     unsigned long *btree_runs, unsigned long *lsm_runs) {
    *btree_runs = overlapping_files;
    *lsm_runs = overlapping_files;
}
```

```tests
#include <assert.h>
void range_scan_cost(unsigned long, unsigned long *, unsigned long *);
int main(void) {
    unsigned long b, l;
    range_scan_cost(1, &b, &l);
    assert(b == 1 && l == 1);
    range_scan_cost(7, &b, &l);
    assert(b == 1);
    assert(l == 7);
    range_scan_cost(20, &b, &l);
    assert(b == 1 && l == 20);
    return 0;
}
```

```solution
void range_scan_cost(unsigned long overlapping_files,
                     unsigned long *btree_runs, unsigned long *lsm_runs) {
    *btree_runs = 1;
    *lsm_runs = overlapping_files;
}
```

## Flushes per second

Write `commit_rate`, returning how many durable updates a second a system
achieves, given the flush latency and how many commits are grouped into one
flush.

The structure decides what the steady state costs; the log decides what a crash
costs.

@kind output
@concept One flush per commit limits a system to flushes per second, and grouping
trades a little latency for a great deal of throughput.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The flushes per second is fixed, and each one commits a group.
@diagnose assert verdict assert-failed
A check disagrees. Grouping does not make the flush faster, it makes one flush
serve several commits, so the rate is flushes per second times the group size.
Ignoring the group size models a system that flushes once per commit, which is
the case the grouping exists to escape.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The durability mechanism is the same whichever structure you chose,
because it is the only durability the layers below offer. Both families write to
a log and flush it before acknowledging, for the reason unit 041 gave: a write
that returned is only a dirty page.

```starter
unsigned long commit_rate(unsigned long flush_us, unsigned long group_size) {
    (void)group_size;
    return 1000000 / flush_us;
}
```

```tests
#include <assert.h>
unsigned long commit_rate(unsigned long, unsigned long);
int main(void) {
    /* A one millisecond flush, one commit each. */
    assert(commit_rate(1000, 1) == 1000);
    /* Grouping a hundred commits into each flush. */
    assert(commit_rate(1000, 100) == 100000);
    /* A faster device. */
    assert(commit_rate(100, 1) == 10000);
    return 0;
}
```

```solution
unsigned long commit_rate(unsigned long flush_us, unsigned long group_size) {
    return 1000000 / flush_us * group_size;
}
```
