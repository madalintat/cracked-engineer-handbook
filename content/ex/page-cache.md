## Three orders of magnitude apart

Write `read_cost_ns`, returning what a read costs, given whether the page is in
the cache and the two latencies.

A hit is a copy from memory. A miss is a device access.

@kind output
@concept The same call costs tens of nanoseconds or tens of microseconds
depending on nothing the program did, only on whether somebody read it recently.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A miss still has to copy the page to the caller after fetching it.
@diagnose assert verdict assert-failed
A check disagrees. A miss pays the device access and then the same copy a hit
would have paid, since the data still has to reach the caller. Reporting only the
device latency understates a miss by exactly a hit.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Three orders of magnitude, decided by whether the page happened to be
resident. That is why the cache is the single largest factor in a filesystem
workload's performance and why measuring one on a warm machine measures something
different from measuring it on a cold one.

```starter
unsigned long read_cost_ns(int in_cache, unsigned long copy_ns,
                           unsigned long device_ns) {
    return in_cache ? copy_ns : device_ns;
}
```

```tests
#include <assert.h>
unsigned long read_cost_ns(int, unsigned long, unsigned long);
int main(void) {
    /* A hit is the copy alone. */
    assert(read_cost_ns(1, 50, 50000) == 50);
    /* A miss is the device access plus the copy. */
    assert(read_cost_ns(0, 50, 50000) == 50050);
    assert(read_cost_ns(0, 100, 20000) == 20100);
    return 0;
}
```

```solution
unsigned long read_cost_ns(int in_cache, unsigned long copy_ns,
                           unsigned long device_ns) {
    return in_cache ? copy_ns : copy_ns + device_ns;
}
```

## Guessing what comes next

Write `readahead_window`, returning how many pages the kernel fetches ahead,
doubling while its guess keeps being right and collapsing to one when it stops.

The window is capped, and a jump resets it.

@kind output
@concept Read-ahead is the hardware prefetcher's idea at a different scale, with
the same consequence: sequential access is fast and random access gets no help.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Double on a hit up to the cap, and reset rather than halve on a miss.
@diagnose assert verdict assert-failed
A check disagrees. A non-sequential access collapses the window to one rather
than reducing it gradually, because the evidence for the pattern is gone rather
than weakened. Halving it keeps fetching pages the program has stopped wanting.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A program that reads a file straight through and occasionally jumps keeps
most of the benefit. One that jumps constantly disables the mechanism and pays
full latency per access, which is why a program that knows its access is random
should say so and stop the kernel reading pages it will never use.

```starter
unsigned long readahead_window(unsigned long current, int sequential,
                               unsigned long cap) {
    if (sequential) {
        unsigned long next = current * 2;
        return next > cap ? cap : next;
    }
    return current / 2;
}
```

```tests
#include <assert.h>
unsigned long readahead_window(unsigned long, int, unsigned long);
int main(void) {
    /* Growing while the guess holds. */
    assert(readahead_window(1, 1, 32) == 2);
    assert(readahead_window(8, 1, 32) == 16);
    /* Capped. */
    assert(readahead_window(32, 1, 32) == 32);
    assert(readahead_window(24, 1, 32) == 32);
    /* A jump collapses it entirely. */
    assert(readahead_window(32, 0, 32) == 1);
    assert(readahead_window(2, 0, 32) == 1);
    return 0;
}
```

```solution
unsigned long readahead_window(unsigned long current, int sequential,
                               unsigned long cap) {
    if (!sequential) return 1;
    unsigned long next = current * 2;
    return next > cap ? cap : next;
}
```

## When the write starts costing

Write `write_cost_ns`, returning what a write costs, given how many dirty pages
exist and the two thresholds.

Below the second threshold a write is a memory operation. Above it, the process
is made to write some out itself.

@kind output
@concept The transition is abrupt, which is why a program writes at memory speed
for several seconds and then at device speed forever with nothing having changed
in it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Background writeback is invisible to the caller. Only the second threshold
is felt.
@diagnose assert verdict assert-failed
A check disagrees. Crossing the first threshold starts background writeback and
the program notices nothing, so the cost is unchanged there. Only past the second
does the writer do the work itself.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Nothing changed in the program. It filled the allowance, and a benchmark
short enough to stay under the threshold reports a number no sustained workload
will ever see, which is the same shape as the write buffer in unit 039.

```starter
unsigned long write_cost_ns(unsigned long dirty_pages,
                            unsigned long background_at, unsigned long block_at,
                            unsigned long memory_ns, unsigned long device_ns) {
    if (dirty_pages >= background_at) return device_ns;
    (void)block_at;
    return memory_ns;
}
```

```tests
#include <assert.h>
unsigned long write_cost_ns(unsigned long, unsigned long, unsigned long,
                            unsigned long, unsigned long);
int main(void) {
    /* Well below both thresholds. */
    assert(write_cost_ns(100, 1000, 2000, 50, 50000) == 50);
    /* Past the background threshold: still invisible to the writer. */
    assert(write_cost_ns(1500, 1000, 2000, 50, 50000) == 50);
    /* Past the blocking threshold. */
    assert(write_cost_ns(2000, 1000, 2000, 50, 50000) == 50000);
    assert(write_cost_ns(5000, 1000, 2000, 50, 50000) == 50000);
    return 0;
}
```

```solution
unsigned long write_cost_ns(unsigned long dirty_pages,
                            unsigned long background_at, unsigned long block_at,
                            unsigned long memory_ns, unsigned long device_ns) {
    (void)background_at;
    return dirty_pages >= block_at ? device_ns : memory_ns;
}
```

## Written is not there

Write `data_survives`, reporting whether a file's contents survive a power loss,
given whether the data was flushed and whether writeback happened to have run.

A write returning means the page is dirty and nothing more.

@kind output
@concept Durability is something you ask for, and a write that returned
successfully has promised only that the data is in memory.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Either path gets the data to the medium, and neither is guaranteed by the
write.
@diagnose assert verdict assert-failed
A check disagrees. Writeback running is enough for the data to be on the medium
even without a flush, and it is not something the program can rely on because
nobody in the program chose when it happens. A flush guarantees it; luck
sometimes provides it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The unreliable path is the one that makes this hard to catch in testing. A
program with no flush anywhere survives most crashes, because writeback usually
has run, and loses data on the crashes that matter.

```starter
int data_survives(int flushed, int writeback_ran) {
    (void)writeback_ran;
    return flushed;
}
```

```tests
#include <assert.h>
int data_survives(int, int);
int main(void) {
    /* Neither: the data was only ever in memory. */
    assert(data_survives(0, 0) == 0);
    /* Flushed: guaranteed. */
    assert(data_survives(1, 0) == 1);
    /* Writeback happened to run: it is there, and nobody arranged that. */
    assert(data_survives(0, 1) == 1);
    assert(data_survives(1, 1) == 1);
    return 0;
}
```

```solution
int data_survives(int flushed, int writeback_ran) {
    return flushed || writeback_ran;
}
```

## The four steps of replacing a file

Write `replace_is_safe`, reporting whether a file replacement survives a crash,
given which of the four steps were performed.

Write the new contents, flush the file, rename it over the original, flush the
directory.

@kind output
@concept `fsync` on a file says nothing about the directory naming it, so a
fully flushed file can fail to exist after a power loss.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint All four, and the ones that are missing say what goes wrong.
@diagnose assert verdict assert-failed
A check disagrees. Flushing the file without flushing the directory leaves a
correct file that may not be named, and renaming without flushing the file first
leaves a name pointing at contents that may be incomplete. Both are needed and
they are needed for different reasons.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Skipping the directory flush leaves the rename undurable. Skipping the
file flush leaves the file existing with the wrong contents, which is worse than
not existing, because a program that finds the file assumes it is complete.

```starter
int replace_is_safe(int wrote, int flushed_file, int renamed,
                    int flushed_dir) {
    (void)flushed_dir;
    return wrote && flushed_file && renamed;
}
```

```tests
#include <assert.h>
int replace_is_safe(int, int, int, int);
int main(void) {
    /* All four. */
    assert(replace_is_safe(1, 1, 1, 1) == 1);
    /* No directory flush: the rename may not survive. */
    assert(replace_is_safe(1, 1, 1, 0) == 0);
    /* No file flush: the name may point at incomplete contents. */
    assert(replace_is_safe(1, 0, 1, 1) == 0);
    /* Never renamed: the original is still there. */
    assert(replace_is_safe(1, 1, 0, 1) == 0);
    return 0;
}
```

```solution
int replace_is_safe(int wrote, int flushed_file, int renamed,
                    int flushed_dir) {
    return wrote && flushed_file && renamed && flushed_dir;
}
```

## Reported once, then cleared

Write `fsync_result`, returning what a flush reports, given whether an error is
pending. Return 0 for success and -1 for failure, and clear the pending error.

The failure happened asynchronously, long after the write that caused it
returned successfully.

@kind output
@concept The error is delivered once to whoever asks first, so a retry that
succeeds proves nothing about the data.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Report the pending error and clear it, so the next call sees none.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the retry. Reporting the error and leaving it
pending would make every subsequent flush fail, which is arguably better and is
not what happens. It is reported once and cleared, so the second call succeeds
without anything having been written.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Several databases treated that second success as proof of durability and
lost data for years. The guidance now is blunt: a flush failure is not retryable
and the data it covered must be assumed lost. Some systems treat it as fatal,
which sounds extreme and is the only interpretation the interface supports.

```starter
int fsync_result(int *error_pending) {
    return *error_pending ? -1 : 0;
}
```

```tests
#include <assert.h>
int fsync_result(int *);
int main(void) {
    int err = 0;
    /* No error: plain success. */
    assert(fsync_result(&err) == 0);
    assert(err == 0);
    /* An error is reported once. */
    err = 1;
    assert(fsync_result(&err) == -1);
    /* And cleared, so the retry succeeds having written nothing. */
    assert(err == 0);
    assert(fsync_result(&err) == 0);
    return 0;
}
```

```solution
int fsync_result(int *error_pending) {
    if (*error_pending) {
        *error_pending = 0;
        return -1;
    }
    return 0;
}
```

## The reference that outlived the thing

Write `crash_consistent`, reporting whether a crash can leave a reference to data
that was never written, given the order the two writes were issued and whether a
flush separated them.

Nothing orders two writes without one.

@kind output
@concept The kernel and the device may reorder freely, so a program that writes a
record and then a pointer to it can lose the record and keep the pointer.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The order they were issued in is not the order they reach the medium.
@diagnose assert verdict assert-failed
A check disagrees. Issuing the data first is not enough on its own, because
writeback may take the pointer's page and not the data's. Only a completed flush
between them establishes that the data is there before the reference to it can
be.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after That is exactly the corruption a journal exists to prevent, and the
mechanism is always the same: write the thing, flush, write the reference. The
cost is the flush in the middle, which is why a system doing many small durable
updates is limited by flushes per second rather than by bandwidth, and why
databases group commits.

```starter
int crash_consistent(int data_written_first, int flush_between) {
    (void)flush_between;
    return data_written_first;
}
```

```tests
#include <assert.h>
int crash_consistent(int, int);
int main(void) {
    /* Data first and a flush between: safe. */
    assert(crash_consistent(1, 1) == 1);
    /* Data first, no flush: the pointer may reach the medium alone. */
    assert(crash_consistent(1, 0) == 0);
    /* Pointer first, with a flush: the reference is durable and the data is not. */
    assert(crash_consistent(0, 1) == 0);
    assert(crash_consistent(0, 0) == 0);
    return 0;
}
```

```solution
int crash_consistent(int data_written_first, int flush_between) {
    return data_written_first && flush_between;
}
```

## Aligned, or refused

Write `direct_io_ok`, reporting whether a direct transfer is accepted, given the
offset, the length and the buffer address, and the device's block size.

Get it wrong and the call fails rather than being slow.

@kind output
@concept Bypassing the cache means the device sees your buffer directly, so its
alignment requirements become yours.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Three things must be multiples of the block size, not one.
@diagnose assert verdict assert-failed
A check disagrees. The offset in the file, the length of the transfer and the
address of the memory buffer must all be multiples of the block size, because the
device transfers whole blocks between the medium and the address you gave it, with
nothing in between to fix up a misalignment.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after It is only correct for a program that manages its own caching and its own
read-ahead, which is why databases want it and almost nothing else does. For
everything else the page cache is better than what you would write, and the
reason to avoid it is duplication rather than overhead.

```starter
int direct_io_ok(unsigned long offset, unsigned long length,
                 unsigned long buffer_addr, unsigned long block) {
    (void)buffer_addr;
    return offset % block == 0 && length % block == 0;
}
```

```tests
#include <assert.h>
int direct_io_ok(unsigned long, unsigned long, unsigned long, unsigned long);
int main(void) {
    /* All three aligned to 512. */
    assert(direct_io_ok(0, 4096, 4096, 512) == 1);
    assert(direct_io_ok(1024, 512, 8192, 512) == 1);
    /* A misaligned offset. */
    assert(direct_io_ok(100, 4096, 4096, 512) == 0);
    /* A misaligned length. */
    assert(direct_io_ok(0, 100, 4096, 512) == 0);
    /* A misaligned buffer, which is the one people forget. */
    assert(direct_io_ok(0, 4096, 4097, 512) == 0);
    return 0;
}
```

```solution
int direct_io_ok(unsigned long offset, unsigned long length,
                 unsigned long buffer_addr, unsigned long block) {
    return offset % block == 0 && length % block == 0
        && buffer_addr % block == 0;
}
```
