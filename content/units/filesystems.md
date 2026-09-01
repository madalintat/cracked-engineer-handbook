---
needs: [page-cache, processes]
minutes: 55
one_idea: A filesystem is a crash-consistency protocol that by default protects its own bookkeeping and not your data, and knowing which is which decides what you have to do yourself.
sources: [compilers-interpreters-terminals-unix, cpu-architectures]
---

A filesystem does two things that people conflate. It maps names to bytes, which
is the part everyone thinks about. And it survives being interrupted halfway
through an update, which is the part it was actually hard to build and the part
that decides whether your data is there afterwards.

## The name is not the file

A file is an inode: a record holding the size, the permissions, the timestamps
and where the blocks are. It has no name. A directory is a file whose contents
are a list of names paired with inode numbers, and that is where names live.

Which makes several familiar things follow. Two names can refer to one inode, and
neither is the original, because there is nothing in the inode saying which came
first. Removing a name is not deleting a file; it decrements a count, and the
inode is freed when the count reaches zero.

And the count is not the whole condition. A file whose last name is removed while
a process still has it open continues to exist, invisibly, until that descriptor
is closed. That is the mechanism behind a temporary file that cannot be found and
cannot leak, and behind a disk that stays full after you deleted the log a
running process was writing to.

```figure
{
  "kind": "blocks",
  "alt": "Two directory entries in different directories both pointing at one inode, which points at data blocks, with an open descriptor also referring to the inode.",
  "caption": "Names point at the inode and the inode owns the blocks. Removing a name decrements a count, and the count is not the only thing keeping a file alive.",
  "boxes": [
    { "id": "n1", "x": 0,   "y": 0.2, "w": 3.2, "h": 1.1, "label": "a/report", "accent": "azure" },
    { "id": "n2", "x": 0,   "y": 1.6, "w": 3.2, "h": 1.1, "label": "b/backup", "accent": "azure" },
    { "id": "fd", "x": 0,   "y": 3.0, "w": 3.2, "h": 1.1, "label": "open fd", "accent": "copper" },
    { "id": "i",  "x": 4.6, "y": 1.6, "w": 3.2, "h": 1.1, "label": "inode", "accent": "gold" },
    { "id": "b",  "x": 9,   "y": 1.6, "w": 3.2, "h": 1.1, "label": "blocks", "accent": "jade" }
  ],
  "arrows": [
    { "from": "n1", "to": "i" },
    { "from": "n2", "to": "i" },
    { "from": "fd", "to": "i" },
    { "from": "i", "to": "b" }
  ]
}
```

## Why any of this is difficult

Consider appending to a file. The filesystem must allocate a block, mark it used
in the free map, add it to the inode's list, and update the size. Four writes to
four different places, and a crash can happen between any two.

Stop after the allocation and the block is marked used and belongs to nothing,
which leaks space. Stop after adding it to the inode and the block is in a file
and also in the free list, which is far worse: a later allocation hands it to
another file and two files share a block.

So the problem is not losing the update. It is that a partial update leaves a
structure that is not merely out of date but self-contradictory, and every
filesystem is a scheme for making sure that cannot happen.

## Writing down what you are about to do

The common answer is a journal. Write a description of the whole change to a
dedicated log, flush it, then apply the change to its real locations, then mark
the log entry done.

A crash before the flush loses the update entirely, which is fine: nothing was
applied. A crash after it means the log holds a complete description, so recovery
replays it and the change completes. There is no window where a partial change
survives without the instructions to finish it.

The cost is that everything is written twice. Which leads directly to the
decision that matters.

## What the journal actually covers

By default, most filesystems journal metadata only.

The inode, the free map, the directory entries: all protected. Your file's actual
contents: not in the journal at all. They are written to their final location and
ordered relative to the metadata, and that ordering is the only guarantee.

The default ordering does buy something real. Data blocks are written before the
metadata that references them, so a crash cannot leave an inode pointing at
blocks that still hold a previous file's contents, which would be a security
problem as much as a correctness one.

What it does not buy is your update being complete. A crash mid-write leaves a
file that is a valid file, correctly described, containing a mixture of old and
new bytes. The filesystem is consistent and your data is not, and every check the
filesystem performs afterwards passes.

That distinction is the whole unit. The protocol protects the structure; the
contents are yours.

## Not writing anything twice

The other approach never overwrites anything. A change writes new blocks
somewhere free, then writes new versions of the structures pointing at them, up to
a root pointer, and the last step is switching that root from the old tree to the
new one.

Until the root switches, nothing has changed. After it, everything has. There is
no partial state because the only mutation is one pointer.

That buys snapshots almost free, since keeping the old root keeps the whole old
tree, and it buys checksums naturally, since a block is never modified in place so
its checksum stays valid. It costs fragmentation, because updating one block in
the middle of a file puts the new version somewhere else entirely, and it costs
the space held by anything still referenced by an old root.

## Describing where the blocks are

A small design decision worth knowing, because it decides how large a file can be
before the bookkeeping costs more than the data.

The old scheme lists every block a file uses, with the list itself spilling into
blocks of pointers once it grows. That is exact and it means a large file's
description is proportional to its size, and reading a byte in the middle needs
several lookups to find which block it is in.

The modern scheme records extents: a starting block and a length. A contiguous
file of any size is one extent, so the description is tiny and the lookup is
immediate. A fragmented file needs one extent per run, and in the worst case,
where every block is somewhere different, it is worse than the list it replaced.

Which is another reason the layers below care about contiguity, and the same
reason as everywhere else in this part: a description proportional to the number
of runs rewards writing in long ones.

## Knowing the bytes are the bytes you wrote

Most filesystems do not check. They trust the device to return what was stored,
and a device that returns wrong bytes without reporting an error is a case they
do not detect.

That case is real. A cable, a controller bug, a cosmic ray in a buffer, or a
write that landed at the wrong offset all produce data that reads back fine and is
wrong. The filesystems that checksum data catch it and, given a redundant copy,
repair it. The ones that do not will hand it to you.

Which is worth knowing when choosing, because the failure it prevents is
undetectable by everything above it. A backup of corrupted data is a corrupted
backup, and nothing in the stack notices.

## The optimisation that surprised everyone

One more mechanism, because it caused a public argument that clarified the whole
subject.

Delaying allocation until writeback lets the filesystem see the whole file and
choose contiguous blocks, which is a large win. It also widens the window between
a write returning and anything being decided about where the data goes.

Applications that had been replacing files by writing and renaming without
flushing had been getting away with it, because the old behaviour happened to
write the data first. Under delayed allocation the rename could reach the disk
while the contents had not been allocated, so a crash left a correctly named,
empty file where a complete one used to be.

The arguments were about whether the applications or the filesystem were wrong.
Both positions were defensible and the resolution was practical: the filesystem
added a special case for that pattern, and the guidance to applications remained
that a rename without a flush guarantees nothing, because it never did.

## What to carry forward

A name is a directory entry, an inode is the file, and removing a name decrements
a count that an open descriptor also holds.

A journal makes multi-part updates atomic and by default covers metadata only, so
after a crash the filesystem is consistent and your file may contain a mixture of
old and new bytes.

Copy on write replaces the journal with one pointer switch and gets snapshots and
checksums out of it. Most filesystems do not verify your data. And a rename
without a flush has never been durable, whatever it happened to do.

## Reading the errors you are about to see

These model the protocols rather than crashing a real filesystem, because a test
that depends on when a crash happens is a test that mostly does not reproduce.

`assert-failed` names the outcome your model got wrong. Several of the exercises
assert that data was lost while the filesystem stayed consistent, which is the
distinction the unit is about rather than a bug in the model.
