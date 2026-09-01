---
needs: [virtual-memory, flash]
minutes: 55
one_idea: Your reads and writes talk to memory, and durability is a separate act you have to ask for and check.
sources: [cpu-architectures, compilers-interpreters-terminals-unix]
---

A program calls `write`, the call returns, and the program continues. Nothing
reached the disk. Something eventually will, on a schedule nobody in the program
chose, and the gap between those two facts is where a whole category of data loss
lives.

## The cache is the memory system

The kernel keeps file contents in memory, in pages, in the same structures unit
035 described. A file's pages and a process's anonymous pages compete for the
same physical memory under the same replacement policy, which is why a machine
copying a large file evicts a program's data to make room and then appears to
have less memory than it did.

A read consults the cache. A hit is a copy from memory, which is tens of
nanoseconds a page. A miss is a major fault, which is a device access, and unit
039 priced that in tens of microseconds. Three orders of magnitude, decided by
whether somebody read it recently.

A write marks a page dirty and returns. The data is in memory, the call
succeeded, and nothing has been sent anywhere.

```figure
{
  "kind": "blocks",
  "alt": "A write landing in a dirty page in memory, returning immediately, with a separate writeback path to the device and a separate flush the application must request.",
  "caption": "Two paths and only one of them is yours. The write returns when the page is dirty; whether it ever reaches the device is a different question with a different answer.",
  "boxes": [
    { "id": "w", "x": 0,   "y": 1.4, "w": 3,   "h": 1.1, "label": "write", "accent": "azure" },
    { "id": "p", "x": 4,   "y": 1.4, "w": 3.4, "h": 1.1, "label": "dirty page", "accent": "gold" },
    { "id": "b", "x": 8.6, "y": 0.2, "w": 3.6, "h": 1.1, "label": "writeback", "sub": "eventually" },
    { "id": "f", "x": 8.6, "y": 2.6, "w": 3.6, "h": 1.1, "label": "flush", "sub": "when you ask", "accent": "jade" }
  ],
  "arrows": [
    { "from": "w", "to": "p" },
    { "from": "p", "to": "b" },
    { "from": "p", "to": "f" }
  ]
}
```

## Guessing what comes next

The kernel watches the offsets a file is read at, and when they look sequential it
fetches ahead.

This is the same idea as the hardware prefetcher from unit 024 at a different
scale, with the same consequence: sequential access is far faster than the device
latency suggests, because the data arrived before it was asked for, and random
access gets no help at all.

The window grows while the guess keeps being right and collapses when it stops.
So a program that reads a file sequentially and occasionally jumps gets most of
the benefit, and one that jumps constantly disables the mechanism and pays full
latency per access.

Which is worth knowing because it is adjustable. A program that knows it will
read a file straight through can say so, and one that knows its access is random
can say that too and stop the kernel reading pages it will never use.

## When a write finally blocks

Dirty pages accumulate and something has to bound them, because memory full of
unwritten data is memory that cannot be reclaimed and data that cannot be
recovered.

The kernel has two thresholds. Above the first, background writeback starts and
your program notices nothing. Above the second, a process that dirties another
page is made to write some out itself, and at that moment `write` stops returning
immediately and starts taking as long as the device does.

That transition is abrupt and it is the explanation for a common shape: a program
that writes at memory speed for several seconds and then suddenly at device speed
forever. Nothing changed in the program. It filled the allowance.

## The only thing that makes it durable

`fsync` is the primitive, and what it promises is narrow enough to be worth
stating exactly.

It writes back every dirty page of that file and asks the device to flush its own
buffer, which is the flush unit 039 described. When it returns successfully, the
data is on the medium.

It does not make anything else durable. In particular it says nothing about the
directory the file is in, so a newly created file can be fully written and
flushed and still not exist after a power loss, because the directory entry
naming it was itself a dirty page nobody flushed.

The safe pattern for replacing a file is four steps and every one is needed: write
the new contents to a temporary file, flush it, rename it over the original, and
flush the directory. Skip the last and the rename is not durable. Skip the second
and the file exists with the wrong contents, which is worse than not existing.

## The error you only get once

This one is a genuine trap and it cost a well-known database several years of
quiet corruption.

If writeback fails, the kernel has a problem: the failure happened
asynchronously, long after the `write` that caused it returned successfully, and
there is nobody obvious to tell. What it does is record the error and report it to
the next `fsync` on that file, and then clear it.

Which means the error is delivered once, to whoever asks first, and a program that
retries the `fsync` after a failure gets success the second time. Not because
anything was written, but because the error was already reported. Several
databases treated that success as proof of durability and had lost data.

The current guidance is blunt: an `fsync` failure is not retryable and the data
it covered must be assumed lost. Some systems respond by treating it as fatal,
which sounds extreme and is the only interpretation the interface supports.

## Barriers, and the order nobody promised

One more thing the interface does not give you, because assuming it does is a
common design error.

Nothing orders two writes to different files, or even two writes to one file
across a flush boundary. The kernel may write back pages in any order it likes,
and the device may complete them in any order it likes, so a program that writes a
record and then writes a pointer to it can lose the record and keep the pointer.

That is exactly the corruption a journal exists to prevent, which is the next
unit. The mechanism is always the same: write the thing, flush, and only then
write the reference to it, so no crash can leave a reference to something that
does not exist.

The cost is the flush in the middle, which is the real device latency rather than
the buffered one, and it is why a system doing many small durable updates is
limited by flushes per second rather than by bandwidth. Batching several logical
updates into one flush is the standard answer and it is why databases group
commits.

## Going around it

Databases mostly do not want the page cache. They have their own buffer pool,
they know their access pattern, and a second cache underneath theirs wastes
memory holding a copy of what they already have.

Opening a file with the direct flag skips the cache: reads come from the device
and writes go to it. The price is that every transfer must be aligned, in offset,
in length, and in the memory address of the buffer, usually to the device's block
size. Get it wrong and the call fails rather than being slow.

It also means every access pays full device latency, so it is only correct for a
program that manages its own caching and its own read-ahead. For everything else
the page cache is better than what you would write, and the reason to avoid it is
duplication rather than overhead.

## Mapping is not a shortcut

Unit 035 described `mmap`, and it is worth stating what it does and does not
change here.

Mapping a file makes reads faults rather than system calls, which removes the
transition and the copy. That is a real saving for a workload reading the same
data repeatedly.

It does not change durability. A write through a mapping dirties a page exactly
as `write` does, and it needs the same flush. It does not change the eviction
policy either, so a mapped file competes for memory with everything else.

And it introduces a failure mode the read path does not have: an I/O error on a
mapped page is a signal rather than a return value, which almost no program is
prepared to handle.

## What to carry forward

Reads and writes talk to memory, so a write returning means the page is dirty and
nothing more.

Read-ahead makes sequential access fast and random access unhelped, dirty page
limits explain a program that suddenly slows to device speed, and durability is
`fsync` on the file and on the directory.

And an `fsync` error is reported once and then cleared, so a retry that succeeds
proves nothing.

## Reading the errors you are about to see

These model the cache's decisions, which is exact, where a measurement on a shared
machine would depend on what everybody else had recently read.

`assert-failed` names the outcome your model got wrong. Several of the exercises
assert that something is not durable, which is the point of them: a model that
reported durability after a plain write would be modelling a system nobody has.
