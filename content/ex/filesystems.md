## When a file actually dies

Write `inode_freed`, reporting whether removing a name frees the file, given how
many names remain and how many processes still have it open.

Removing a name decrements a count. The count is not the only thing keeping a
file alive.

@kind output
@concept A file survives while any name or any open descriptor refers to it,
which is why a deleted log can keep a disk full.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two independent references, and the file dies only when both are gone.
@diagnose assert verdict assert-failed
A check disagrees. A file with no names and an open descriptor still exists, and
it is invisible: nothing in the directory tree names it and the space is not
returned. Freeing on the name count alone would pull the storage out from under a
running process.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after That is the mechanism behind a temporary file that cannot be found and
cannot leak, and behind a disk that stays full after you deleted the log a
running process was writing to. Removing the name did exactly what it says, and
the file is still there.

```starter
int inode_freed(int names_remaining, int open_descriptors) {
    (void)open_descriptors;
    return names_remaining == 0;
}
```

```tests
#include <assert.h>
int inode_freed(int, int);
int main(void) {
    /* Another name still refers to it. */
    assert(inode_freed(1, 0) == 0);
    /* No names, nobody holding it: freed. */
    assert(inode_freed(0, 0) == 1);
    /* No names and a process still writing: alive and invisible. */
    assert(inode_freed(0, 1) == 0);
    assert(inode_freed(2, 3) == 0);
    return 0;
}
```

```solution
int inode_freed(int names_remaining, int open_descriptors) {
    return names_remaining == 0 && open_descriptors == 0;
}
```

## The state that contradicts itself

Write `crash_state`, classifying what a crash leaves after an append that was
interrupted partway: 0 consistent, 1 leaked space, 2 a block in two places.

Stopping after the allocation leaks. Stopping after the inode update is worse.

@kind output
@concept The problem is not losing an update, it is that a partial one leaves a
structure that is self-contradictory rather than merely out of date.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Marked used and belonging to nothing leaks. Belonging to a file and still
free is the dangerous one.
@diagnose assert verdict assert-failed
A check disagrees. A block referenced by an inode while still marked free is
handed out again by the next allocation, so two files share it and each corrupts
the other. That is a different and worse outcome than a block nobody can reach.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Leaked space is recoverable by a scan. A block in two files is not, and by
the time anybody notices, both files have been written. That asymmetry is why
every filesystem has a protocol rather than an ordering convention.

```starter
int crash_state(int marked_used, int in_inode) {
    (void)in_inode;
    return marked_used ? 1 : 0;
}
```

```tests
#include <assert.h>
int crash_state(int, int);
int main(void) {
    /* Nothing happened, or everything did. */
    assert(crash_state(0, 0) == 0);
    assert(crash_state(1, 1) == 0);
    /* Allocated and never attached: leaked. */
    assert(crash_state(1, 0) == 1);
    /* Attached and still free: two files will share it. */
    assert(crash_state(0, 1) == 2);
    return 0;
}
```

```solution
int crash_state(int marked_used, int in_inode) {
    if (marked_used && in_inode) return 0;
    if (!marked_used && !in_inode) return 0;
    return marked_used ? 1 : 2;
}
```

## Replay, or forget

Write `journal_outcome`, reporting what recovery does after a crash: 0 discard
the entry, 1 replay it.

A crash before the log is flushed loses the update entirely, which is fine
because nothing was applied.

@kind output
@concept There is no window where a partial change survives without the
instructions to finish it, which is the entire property a journal buys.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The log being complete and flushed is what makes replaying safe.
@diagnose assert verdict assert-failed
A check disagrees. An entry that was written but not flushed may be partial on
the medium, so replaying it would apply a change nobody has a full description
of. Only a flushed entry is known to be whole.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A completed entry is discarded rather than replayed, because the change
already reached its real locations and replaying it would be harmless but
pointless. The cost of the whole scheme is that everything is written twice, which
is what makes the next exercise's decision worth making.

```starter
int journal_outcome(int entry_flushed, int entry_marked_done) {
    (void)entry_marked_done;
    return entry_flushed;
}
```

```tests
#include <assert.h>
int journal_outcome(int, int);
int main(void) {
    /* Never flushed: nothing was applied, so discard. */
    assert(journal_outcome(0, 0) == 0);
    /* Flushed and not yet applied: replay. */
    assert(journal_outcome(1, 0) == 1);
    /* Flushed and completed: nothing left to do. */
    assert(journal_outcome(1, 1) == 0);
    return 0;
}
```

```solution
int journal_outcome(int entry_flushed, int entry_marked_done) {
    return entry_flushed && !entry_marked_done;
}
```

## Consistent, and wrong

Write `after_crash`, returning two answers: whether the filesystem is consistent
and whether the file's contents are the ones that were written.

A metadata journal protects the structure. The contents are yours.

@kind output
@concept A crash mid-write leaves a valid file, correctly described, containing a
mixture of old and new bytes, and every check the filesystem performs passes.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The journal decides the first answer. The flush decides the second.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the one where the metadata was journalled and
the data was not flushed. The filesystem is consistent, because its own
bookkeeping was protected, and the file contains part of an update. Reporting the
data as intact there is exactly the assumption the unit exists to remove.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The distinction is the whole unit. A filesystem check after a crash
reports no problems, because there are none of the kind it looks for, and your
file is a mixture of two versions. The protocol protects the structure and the
contents are your responsibility.

```starter
void after_crash(int metadata_journalled, int data_flushed,
                 int *fs_consistent, int *data_intact) {
    *fs_consistent = metadata_journalled;
    *data_intact = metadata_journalled;
    (void)data_flushed;
}
```

```tests
#include <assert.h>
void after_crash(int, int, int *, int *);
int main(void) {
    int fs, data;
    /* The ordinary default: metadata journalled, data not flushed. */
    after_crash(1, 0, &fs, &data);
    assert(fs == 1);
    assert(data == 0);
    /* Both: everything survives. */
    after_crash(1, 1, &fs, &data);
    assert(fs == 1 && data == 1);
    /* No journal: the structure itself may be broken. */
    after_crash(0, 1, &fs, &data);
    assert(fs == 0 && data == 1);
    after_crash(0, 0, &fs, &data);
    assert(fs == 0 && data == 0);
    return 0;
}
```

```solution
void after_crash(int metadata_journalled, int data_flushed,
                 int *fs_consistent, int *data_intact) {
    *fs_consistent = metadata_journalled;
    *data_intact = data_flushed;
}
```

## One pointer, and everything changed

Write `cow_visible`, reporting what a reader sees after a copy-on-write update
that was interrupted: 0 the old tree, 1 the new one.

Until the root switches nothing has changed. After it, everything has.

@kind output
@concept The only mutation is one pointer, so there is no partial state to
recover from and no journal to write.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only the root switch matters. Everything before it is invisible.
@diagnose assert verdict assert-failed
A check disagrees. New blocks written and new structures built are all
unreachable until the root points at them, so a crash at any point before the
switch leaves a reader seeing exactly the old tree. That is the property, and
partial progress being invisible is what replaces the journal.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Keeping the old root keeps the whole old tree, which is why snapshots are
almost free. And a block is never modified in place, so its checksum stays valid,
which is why the filesystems that do this are also the ones that check.

```starter
int cow_visible(int new_blocks_written, int new_tree_written,
                int root_switched) {
    (void)root_switched;
    return new_blocks_written && new_tree_written;
}
```

```tests
#include <assert.h>
int cow_visible(int, int, int);
int main(void) {
    /* Nothing done. */
    assert(cow_visible(0, 0, 0) == 0);
    /* Blocks written, unreachable. */
    assert(cow_visible(1, 0, 0) == 0);
    /* The whole new tree built and not yet published. */
    assert(cow_visible(1, 1, 0) == 0);
    /* The switch. */
    assert(cow_visible(1, 1, 1) == 1);
    return 0;
}
```

```solution
int cow_visible(int new_blocks_written, int new_tree_written,
                int root_switched) {
    (void)new_blocks_written;
    (void)new_tree_written;
    return root_switched;
}
```

## Describing a file two ways

Write `map_entries`, returning how many entries a file's block map needs, under a
block list and under extents.

A contiguous file of any size is one extent. A fully fragmented one is worse than
the list it replaced.

@kind output
@concept An extent is a start and a length, so the description is proportional to
the number of runs rather than to the size.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The list needs one entry per block whatever the layout. Extents need one
per run.
@diagnose assert verdict assert-failed
A check disagrees. The block list's size does not depend on the layout at all,
since it names every block regardless, and only the extent count does. Reporting
the same number for both loses the entire distinction.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A contiguous gigabyte is one extent and 262144 list entries. The same
gigabyte in single-block fragments is 262144 of each, and each extent is larger
than a pointer, so the worst case really is worse. That is another reason every
layer in this part rewards long runs.

```starter
void map_entries(unsigned long blocks, unsigned long runs,
                 unsigned long *list, unsigned long *extents) {
    *list = runs;
    *extents = runs;
}
```

```tests
#include <assert.h>
void map_entries(unsigned long, unsigned long, unsigned long *,
                 unsigned long *);
int main(void) {
    unsigned long l, e;
    /* A contiguous gigabyte in 4 KB blocks. */
    map_entries(262144, 1, &l, &e);
    assert(l == 262144);
    assert(e == 1);
    /* Ten runs. */
    map_entries(262144, 10, &l, &e);
    assert(l == 262144 && e == 10);
    /* Every block somewhere different. */
    map_entries(262144, 262144, &l, &e);
    assert(l == 262144 && e == 262144);
    return 0;
}
```

```solution
void map_entries(unsigned long blocks, unsigned long runs,
                 unsigned long *list, unsigned long *extents) {
    *list = blocks;
    *extents = runs;
}
```

## Silently wrong

Write `corruption_detected`, reporting whether a filesystem notices that a block
read back different bytes than were written, given whether it checksums data and
whether the device reported an error.

A device that returns wrong bytes without reporting an error is a case most
filesystems do not detect.

@kind output
@concept The failure a data checksum prevents is undetectable by everything above
it, which is why a backup of corrupted data is a corrupted backup.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Either the device says so, or the filesystem checks. Otherwise nobody
knows.
@diagnose assert verdict assert-failed
A check disagrees. A reported error is noticed whether or not anybody checksums,
and a silent corruption is noticed only by a filesystem that verifies. The case
where neither holds is the interesting one and it returns wrong data with no
indication anywhere.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A cable, a controller bug, or a write that landed at the wrong offset all
produce data that reads back fine and is wrong. The filesystems that checksum
catch it and, given a redundant copy, repair it. The ones that do not hand it to
you, and nothing above them notices.

```starter
int corruption_detected(int checksums_data, int device_reported_error) {
    (void)checksums_data;
    return device_reported_error;
}
```

```tests
#include <assert.h>
int corruption_detected(int, int);
int main(void) {
    /* The device noticed and said so. */
    assert(corruption_detected(0, 1) == 1);
    assert(corruption_detected(1, 1) == 1);
    /* Silent corruption, and the filesystem verifies. */
    assert(corruption_detected(1, 0) == 1);
    /* Silent corruption and nobody checking. */
    assert(corruption_detected(0, 0) == 0);
    return 0;
}
```

```solution
int corruption_detected(int checksums_data, int device_reported_error) {
    return checksums_data || device_reported_error;
}
```

## The rename that was never durable

Write `rename_survives`, reporting whether a file replacement survives a crash
under delayed allocation, given whether the data was flushed and whether
allocation happened to have run before the crash.

Applications had been getting away with it because the old behaviour happened to
write the data first.

@kind output
@concept Delaying allocation widened a window that was always there, and the
pattern that broke had never been guaranteed.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A flush closes the window. Allocation running is luck.
@diagnose assert verdict assert-failed
A check disagrees. Allocation having run means the data reached the medium
without anybody arranging it, which is the behaviour applications had come to
depend on, and a flush is the only version of that anyone promised. Both produce
a surviving file and only one is a guarantee.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The arguments were about whether the applications or the filesystem were
wrong, and both positions were defensible. The resolution was practical: the
filesystem added a special case for that pattern, and the guidance stayed that a
rename without a flush guarantees nothing, because it never did.

```starter
int rename_survives(int data_flushed, int allocation_ran) {
    (void)allocation_ran;
    return data_flushed;
}
```

```tests
#include <assert.h>
int rename_survives(int, int);
int main(void) {
    /* Neither: a correctly named, empty file. */
    assert(rename_survives(0, 0) == 0);
    /* Flushed: guaranteed. */
    assert(rename_survives(1, 0) == 1);
    /* Allocation happened to run, which nobody arranged. */
    assert(rename_survives(0, 1) == 1);
    assert(rename_survives(1, 1) == 1);
    return 0;
}
```

```solution
int rename_survives(int data_flushed, int allocation_ran) {
    return data_flushed || allocation_ran;
}
```
