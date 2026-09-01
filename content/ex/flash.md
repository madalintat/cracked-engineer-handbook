## What one byte costs

Write `bytes_programmed`, returning how much the device must actually program to
change one byte, given the page and block sizes.

A page cannot be programmed twice, so changing anything means erasing the whole
block and writing it back.

@kind output
@concept There is no in-place overwrite, so the smallest possible change is an
operation the size of an erase block.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The unit of erasure is the block, and everything in it has to be rewritten.
@diagnose assert verdict assert-failed
A check disagrees. Programming a page and erasing a block are different sizes, so
a one-byte change costs the block rather than the page. That gap of two orders of
magnitude is the fact every piece of storage software above the device exists to
hide.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Four kilobytes of page and four megabytes of block means one byte costs
four megabytes if the device really did it that way. It does not, and the next
exercise is why: the controller writes somewhere else entirely and changes a map.

```starter
unsigned long bytes_programmed(unsigned long page, unsigned long block) {
    (void)block;
    return page;
}
```

```tests
#include <assert.h>
unsigned long bytes_programmed(unsigned long, unsigned long);
int main(void) {
    /* 4 KB pages, 4 MB blocks. */
    assert(bytes_programmed(4096, 4194304) == 4194304);
    /* 16 KB pages, 1 MB blocks. */
    assert(bytes_programmed(16384, 1048576) == 1048576);
    /* A device where a block is one page has no asymmetry at all. */
    assert(bytes_programmed(4096, 4096) == 4096);
    return 0;
}
```

```solution
unsigned long bytes_programmed(unsigned long page, unsigned long block) {
    (void)page;
    return block;
}
```

## The map that makes it look like a disk

Write `write_sector`, which models the translation layer: program a fresh page,
point the sector at it, and mark the old page dead.

Nothing is modified in place. The drive presents an array of sectors that behaves
like a disk's, and a map is what makes that true.

@kind output
@concept A write allocates rather than modifies, so repeated writes to one sector
leave a trail of dead pages and one live one.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Update the map to the new page, and mark whatever it pointed at before as
dead.
@diagnose assert verdict assert-failed
A check disagrees. The old page has to be marked dead before the map forgets
where it was, and a sector written for the first time has no old page to mark.
Marking without checking turns page 0 into garbage on the first write to any
sector.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Three writes to one sector leave two dead pages and one live one, and from
outside the drive nothing happened but three writes. Every performance
characteristic people attribute to flash is really a characteristic of this
firmware.

```starter
#include <stddef.h>
/* map[s] is the physical page holding sector s, or -1 if never written.
   dead[p] marks a physical page as garbage. */
void write_sector(int *map, unsigned char *dead, int sector, int new_page) {
    map[sector] = new_page;
}
```

```tests
#include <assert.h>
void write_sector(int *, unsigned char *, int, int);
int main(void) {
    int map[4] = {-1, -1, -1, -1};
    unsigned char dead[8] = {0};
    /* First write: nothing to abandon. */
    write_sector(map, dead, 0, 3);
    assert(map[0] == 3);
    assert(dead[3] == 0);
    /* Nothing else was marked, including page 0. */
    assert(dead[0] == 0);
    /* Second write to the same sector abandons the first page. */
    write_sector(map, dead, 0, 5);
    assert(map[0] == 5);
    assert(dead[3] == 1);
    assert(dead[5] == 0);
    /* And again. */
    write_sector(map, dead, 0, 6);
    assert(dead[5] == 1);
    assert(map[0] == 6);
    return 0;
}
```

```solution
#include <stddef.h>
/* map[s] is the physical page holding sector s, or -1 if never written.
   dead[p] marks a physical page as garbage. */
void write_sector(int *map, unsigned char *dead, int sector, int new_page) {
    if (map[sector] >= 0) dead[map[sector]] = 1;
    map[sector] = new_page;
}
```

## What collecting costs

Write `pages_copied`, returning how many live pages a garbage collection must
move to reclaim a block.

The copying is real work the drive does on its own account, and it is the
difference between a fresh drive and one that has been written to.

@kind output
@concept Reclaiming a block means preserving whatever in it is still live, so a
block of mixed data costs a copy per surviving page.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count the pages that are not dead.
@diagnose assert verdict assert-failed
A check disagrees. A block where everything is dead costs nothing to reclaim,
which is the case the drive is hoping for, and a block where everything is live
cannot usefully be reclaimed at all. Counting the dead pages rather than the live
ones inverts both.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Which is why writing in large sequential runs helps: a block filled with
data that will be discarded together collects with no copying at all. The next
exercise turns this into the number that decides both wear and sustained speed.

```starter
#include <stddef.h>
size_t pages_copied(const unsigned char *dead, size_t pages_per_block) {
    size_t n = 0;
    for (size_t i = 0; i < pages_per_block; i++)
        if (dead[i]) n++;
    return n;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t pages_copied(const unsigned char *, size_t);
int main(void) {
    /* Everything dead: reclaim it for free. */
    unsigned char all_dead[8] = {1,1,1,1,1,1,1,1};
    assert(pages_copied(all_dead, 8) == 0);
    /* Everything live: eight copies to reclaim nothing. */
    unsigned char all_live[8] = {0,0,0,0,0,0,0,0};
    assert(pages_copied(all_live, 8) == 8);
    /* Mixed. */
    unsigned char mixed[8] = {1,0,1,0,1,1,0,1};
    assert(pages_copied(mixed, 8) == 3);
    return 0;
}
```

```solution
#include <stddef.h>
size_t pages_copied(const unsigned char *dead, size_t pages_per_block) {
    size_t n = 0;
    for (size_t i = 0; i < pages_per_block; i++)
        if (!dead[i]) n++;
    return n;
}
```

## The ratio that decides everything

Write `write_amplification`, returning how many bytes the device programs per byte
the host wrote, scaled by 100 so the answer is an integer percentage.

It is the number that decides both wear and sustained speed.

@kind output
@concept Amplification is device bytes over host bytes, and a small write that
forces a block rewrite is amplification in the hundreds.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Device over host, not the other way round, and multiply before dividing.
@diagnose assert verdict assert-failed
A check disagrees. Amplification is at least 1 by definition, since the device
must at minimum program what the host asked for, so a value below 100 means the
ratio is inverted. Dividing before multiplying loses it to integer truncation.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Four kilobytes written forcing a four megabyte block rewrite is 1024
times, or 102400 percent. That is the worst case, and real workloads sit between
two and ten, which is still the difference between a drive lasting five years and
lasting one.

```starter
unsigned long write_amplification(unsigned long host_bytes,
                                  unsigned long device_bytes) {
    return host_bytes * 100 / device_bytes;
}
```

```tests
#include <assert.h>
unsigned long write_amplification(unsigned long, unsigned long);
int main(void) {
    /* Nothing extra: one to one. */
    assert(write_amplification(4096, 4096) == 100);
    /* Twice as much programmed as written. */
    assert(write_amplification(4096, 8192) == 200);
    /* 4 KB forcing a 4 MB block rewrite. */
    assert(write_amplification(4096, 4194304) == 102400);
    assert(write_amplification(1000000, 3000000) == 300);
    return 0;
}
```

```solution
unsigned long write_amplification(unsigned long host_bytes,
                                  unsigned long device_bytes) {
    return device_bytes * 100 / host_bytes;
}
```

## Room to work

Write `spare_blocks`, returning how many erase blocks the controller has to work
with, given the device's physical capacity, the capacity it advertises, and how
much of the advertised space the filesystem has used.

Space the host never uses is space the controller can collect into without
copying.

@kind output
@concept A full drive is slower than an empty one because the controller's
working room is whatever the host has not claimed.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Reserved capacity and unused capacity are both available, and both are
counted in blocks.
@diagnose assert verdict assert-failed
A check disagrees. The controller has the difference between physical and
advertised capacity, which is deliberate over-provisioning, plus whatever of the
advertised capacity is not in use. Counting only the first misses why a
half-empty drive is faster than a full one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A drive advertised at 512 GB with 544 GB of NAND has 32 GB the host cannot
see, and an empty filesystem adds 512 more. Full, it has 32. That is the whole
reason enterprise drives reserve a fraction of their capacity and why filling a
consumer drive to the last gigabyte changes its character.

```starter
unsigned long spare_blocks(unsigned long physical_blocks,
                           unsigned long advertised_blocks,
                           unsigned long used_blocks) {
    (void)used_blocks;
    return physical_blocks - advertised_blocks;
}
```

```tests
#include <assert.h>
unsigned long spare_blocks(unsigned long, unsigned long, unsigned long);
int main(void) {
    /* 1100 physical, 1000 advertised, half used. */
    assert(spare_blocks(1100, 1000, 500) == 600);
    /* Completely full: only the reserve is left. */
    assert(spare_blocks(1100, 1000, 1000) == 100);
    /* Empty: everything is available. */
    assert(spare_blocks(1100, 1000, 0) == 1100);
    /* No over-provisioning at all. */
    assert(spare_blocks(1000, 1000, 900) == 100);
    return 0;
}
```

```solution
unsigned long spare_blocks(unsigned long physical_blocks,
                           unsigned long advertised_blocks,
                           unsigned long used_blocks) {
    return physical_blocks - advertised_blocks + (advertised_blocks - used_blocks);
}
```

## Telling it what is dead

Write `live_after_trim`, counting how many pages the controller must still
preserve, given which pages hold data and which sectors the filesystem has told
it are no longer needed.

Without trim, a deleted file's sectors are live data the drive copies through
every collection.

@kind output
@concept The controller cannot tell which sectors a filesystem still cares about,
so it preserves everything until it is told otherwise.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A page is live when it holds data and has not been trimmed.
@diagnose assert verdict assert-failed
A check disagrees. Trimming a page that was never written changes nothing, and
trimming a live one removes it from the count. Ignoring the trim entirely gives
the behaviour of a drive whose filesystem never tells it anything, which is the
situation the command exists to fix.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A drive that got slower over months and recovered after a reformat was not
wearing out. It was collecting data that had been deleted years earlier by
software that never told it, and from the controller's side that data was
indistinguishable from a file somebody still wanted.

```starter
#include <stddef.h>
size_t live_after_trim(const unsigned char *has_data,
                       const unsigned char *trimmed, size_t n) {
    (void)trimmed;
    size_t live = 0;
    for (size_t i = 0; i < n; i++)
        if (has_data[i]) live++;
    return live;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t live_after_trim(const unsigned char *, const unsigned char *, size_t);
int main(void) {
    unsigned char data[6] = {1, 1, 1, 1, 0, 0};
    /* Nothing trimmed: everything with data is preserved. */
    unsigned char none[6] = {0, 0, 0, 0, 0, 0};
    assert(live_after_trim(data, none, 6) == 4);
    /* Two files deleted and reported. */
    unsigned char some[6] = {1, 0, 1, 0, 0, 0};
    assert(live_after_trim(data, some, 6) == 2);
    /* Trimming pages that held nothing changes nothing. */
    unsigned char empty[6] = {0, 0, 0, 0, 1, 1};
    assert(live_after_trim(data, empty, 6) == 4);
    return 0;
}
```

```solution
#include <stddef.h>
size_t live_after_trim(const unsigned char *has_data,
                       const unsigned char *trimmed, size_t n) {
    size_t live = 0;
    for (size_t i = 0; i < n; i++)
        if (has_data[i] && !trimmed[i]) live++;
    return live;
}
```

## The buffer, and the number after it

Write `bytes_per_second`, returning the rate a drive sustains over a transfer,
given a fast buffer of limited size and a slower rate once it is full.

A benchmark that writes a few gigabytes measures the buffer.

@kind output
@concept The advertised write speed is the buffered one, and the sustained rate
is several times lower, which is the most misleading number in consumer storage.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Time is the buffered part at the fast rate plus the remainder at the slow
one, and the answer is total bytes over total time.
@diagnose assert verdict assert-failed
A check disagrees. A transfer that fits entirely in the buffer runs at the fast
rate, and one that exceeds it runs at a blend weighted by how much fell either
side. Reporting the fast rate always is exactly the benchmark this exercise is
about.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Not a lie about the hardware. Part of the drive is operated at one bit per
cell, which really is that fast, and the rest is at three or four, which really is
not. A short benchmark measures the first and a real workload gets the second.

```starter
unsigned long bytes_per_second(unsigned long total, unsigned long buffer,
                               unsigned long fast_rate, unsigned long slow_rate) {
    (void)total; (void)buffer; (void)slow_rate;
    return fast_rate;
}
```

```tests
#include <assert.h>
unsigned long bytes_per_second(unsigned long, unsigned long,
                               unsigned long, unsigned long);
int main(void) {
    /* Fits in the buffer: the fast rate. */
    assert(bytes_per_second(1000, 2000, 5000, 1000) == 5000);
    assert(bytes_per_second(2000, 2000, 5000, 1000) == 5000);
    /* Far past the buffer: close to the slow rate. */
    assert(bytes_per_second(102000, 2000, 5000, 1000) == 1015);
    /* Exactly twice the buffer. */
    assert(bytes_per_second(4000, 2000, 5000, 1000) == 1666);
    return 0;
}
```

```solution
unsigned long bytes_per_second(unsigned long total, unsigned long buffer,
                               unsigned long fast_rate, unsigned long slow_rate) {
    unsigned long fast_part = total < buffer ? total : buffer;
    unsigned long slow_part = total - fast_part;
    /* Times scaled by a million so integer division keeps the ratio. */
    unsigned long t = fast_part * 1000000 / fast_rate
                    + slow_part * 1000000 / slow_rate;
    if (t == 0) return fast_rate;
    return total * 1000000 / t;
}
```

## Written is not durable

Write `survives_power_loss`, reporting whether data the host was told was written
is still there after the power goes.

The drive acknowledges once the data is in volatile memory inside the controller,
not once it is in NAND.

@kind output
@concept Durability is a property of having flushed rather than of having
written, which is what every database's commit path is arranged around.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two independent ways to survive, and either is enough.
@diagnose assert verdict assert-failed
A check disagrees. A drive with stored energy finishes what it accepted whether
or not anybody flushed, and a flush completing means the data reached NAND
whether or not the drive has a capacitor. Requiring both makes correct
configurations look unsafe.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The cost of a flush is the real programming latency rather than the
buffered one, which is why a commit is slow in a way an ordinary write is not.
And a filesystem that reorders or drops the call converts a correct database into
an incorrect one without either of them being wrong.

```starter
int survives_power_loss(int flushed, int has_power_loss_protection) {
    return flushed && has_power_loss_protection;
}
```

```tests
#include <assert.h>
int survives_power_loss(int, int);
int main(void) {
    /* Written and acknowledged, nothing more: lost. */
    assert(survives_power_loss(0, 0) == 0);
    /* Flushed on a consumer drive: safe. */
    assert(survives_power_loss(1, 0) == 1);
    /* Unflushed on a drive with stored energy: safe. */
    assert(survives_power_loss(0, 1) == 1);
    assert(survives_power_loss(1, 1) == 1);
    return 0;
}
```

```solution
int survives_power_loss(int flushed, int has_power_loss_protection) {
    return flushed || has_power_loss_protection;
}
```
