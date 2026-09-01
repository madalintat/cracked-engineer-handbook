---
needs: [processes, cache]
minutes: 55
one_idea: Allocation reserves addresses and nothing else, and the memory appears one page at a time in response to faults the hardware raises as you touch it.
sources: [cpu-architectures, x86-64-assembly]
---

Every address your program has ever printed is a lie, in the specific sense that
no wire in the machine carries it. It is translated on the way to memory, by
hardware, using tables the kernel wrote, and almost everything people find
confusing about memory usage is a consequence of that translation being lazy.

## Two addresses for everything

The processor issues a virtual address. Between it and the memory controller
sits the memory management unit, which splits that address into a page number and
an offset, looks the page number up, and produces a physical page number to which
the offset is appended.

Pages are 4096 bytes on x86-64, so the low twelve bits are the offset and never
change during translation. Everything above them is what gets looked up.

The lookup is not one table. A 48-bit address space with 4 KB pages would need a
table of 2 to the 36 entries per process, which is impossible, so the page number
is split into four groups of nine bits and each group indexes one level of a
tree. Levels that describe nothing are simply absent, which is why a process with
a sparse address space costs almost nothing to describe.

```figure
{
  "kind": "bits",
  "alt": "A 48-bit virtual address split into four nine-bit page table indices and a twelve-bit offset.",
  "caption": "Four indices and an offset. Each nine-bit group selects an entry in one level of the tree, and the low twelve bits pass through untouched.",
  "bits": 48,
  "groups": [
    { "from": 0,  "to": 11, "label": "offset", "accent": "gold" },
    { "from": 12, "to": 20, "label": "level 1", "accent": "azure" },
    { "from": 21, "to": 29, "label": "level 2", "accent": "azure" },
    { "from": 30, "to": 38, "label": "level 3", "accent": "azure" },
    { "from": 39, "to": 47, "label": "level 4", "accent": "azure" }
  ]
}
```

## The cache that makes it affordable

Four levels means four memory accesses to resolve one address, before the access
you wanted. That would be catastrophic, so the result is cached.

The translation lookaside buffer holds recent translations, and it is small,
typically a few thousand entries. A hit costs nothing measurable. A miss costs a
walk of the tree, which is up to four dependent loads, each of which may itself
miss in the data cache.

A few thousand entries at 4 KB each covers a few megabytes. A program with a
working set larger than that misses in the TLB regularly, which is a cost that
appears in no instruction count and is invisible unless you look for it.

Huge pages are the answer: map 2 MB at a time, and one entry covers five hundred
times as much. The cost is that the whole 2 MB is committed at once and that
finding contiguous physical memory for it gets hard on a fragmented system.

## Allocation does not allocate

Here is the fact that reorganises how you read memory numbers.

Asking for a gigabyte succeeds immediately and consumes no memory. What you get
is a range of addresses marked as belonging to you, with no physical pages behind
them. The page table entries are absent.

The memory appears when you touch it. The first write to each page traps into the
kernel, which finds a physical page, zeroes it, installs the mapping, and returns
to the instruction that faulted as though nothing happened. One fault per page,
four thousand and ninety six bytes at a time.

That is why the first pass over a freshly allocated array is slower than the
second, why a benchmark that skips the warm-up measures the fault handler, and
why the memory a process is using has two different numbers.

## Two numbers, and which one matters

Virtual size is how much address space the process has reserved. Resident set
size is how much physical memory is actually behind it.

They can differ by orders of magnitude and both are correct. A program that maps
a hundred gigabyte file and reads two pages of it has a virtual size of a hundred
gigabytes and a resident set of eight kilobytes. Nothing is wrong.

Which explains why memory profilers disagree with each other and with the
operating system. They are measuring different things: bytes requested from the
allocator, bytes the allocator obtained from the kernel, address space reserved,
and pages actually resident. All four are legitimate and only the last is memory
in the sense of a resource that runs out.

## Promising what you do not have

Because allocation is lazy, the kernel can promise more than it has, and by
default it does.

This is overcommit, and it is why a fork of a large process succeeds, why a
sparse array is practical, and why almost every program that allocates
optimistically works. It is also why an allocation almost never fails: the
failure has been deferred to the moment the page is touched, at which point there
is no way to report it to the code that asked.

So when the machine genuinely runs out, the kernel picks a process and kills it.
The heuristic prefers large recent allocators, which is usually the culprit and is
occasionally your database. Turning overcommit off makes allocations fail
honestly and makes a great deal of ordinary software stop working, which is why
almost nobody does.

## Faults that are not errors

A page fault is a trap, and most of them are routine.

A minor fault means the page is in memory and this process's table does not point
at it yet: a first touch of allocated memory, a shared library page another
process already loaded, a copy-on-write page being written. It costs a trip into
the kernel and no I/O.

A major fault means the contents have to be read from disk. That costs a disk
access, which unit 024's table priced at tens of microseconds for flash and
milliseconds for a spinning disk, against tens of nanoseconds for a cache miss.

The distinction is the one to look for in a profile. High minor fault counts mean
the program is touching new memory, which may be fine. High major fault counts
mean it is waiting for storage, which is almost never fine.

## Mapping instead of reading

`mmap` puts a file's contents in your address space, so reading it is a load and
the pages arrive on fault.

Private mappings are copy on write: your writes are yours alone. Shared mappings
write through, and two processes mapping the same file shared see each other's
changes with no system call involved, which is the fastest inter-process
communication there is.

The reasons to use it are avoiding a copy through a buffer and letting the kernel
manage what stays resident. The reasons not to are that an I/O error becomes a
signal rather than a return value, that the mapping cost is per page and shows up
as fault latency spread through your code, and that files being written by
somebody else underneath you produce results with no defined behaviour.

## The other thing the table entry holds

A page table entry is not just a physical address. It carries permission bits,
and those are the enforcement behind several things earlier units treated as
given.

Readable, writable and executable are separate bits, which is why unit 023's
exercises could write to `.data` and not `.rodata`, and could execute `.text` and
not a data page. The linker recorded the intent, the loader set the bits, and the
processor checks them on every access with no cost, because the check happens in
the same lookup that produces the address.

There is also a bit saying whether the page has been written since it was last
cleared. That is what lets the kernel know a page is clean and can simply be
dropped rather than written out, which is the difference between evicting a page
of a mapped executable and evicting a page of your heap.

And a bit saying whether it has been accessed at all, which is what the
replacement policy reads to decide what to evict. Nothing tracks how often a page
is used; there is one bit, cleared periodically, and every eviction decision on
your machine is made from that.

## Swap is not extra memory

When physical memory is short, pages that have not been used recently are written
to storage and their table entries cleared. Touching one later takes a major
fault and reads it back.

The important thing is what this is for. Swap does not extend memory in a useful
way, because a working set larger than physical memory means constant major
faults and a system that appears to have stopped. What swap is genuinely good at
is evicting pages that were allocated and never used again, which real programs
have plenty of, and freeing that space for the page cache.

A machine that is swapping steadily is not using extra memory. It is dying
slowly.

## What to carry forward

Addresses are translated by hardware through a tree the kernel wrote, and the TLB
is what makes that affordable.

Allocation reserves addresses. Memory appears one page at a time on first touch,
which is why virtual size and resident set are different numbers and why both are
correct.

Minor faults are routine and major faults are storage. And swap is a way of
reclaiming pages nobody wanted, not a way of having more memory than you bought.

## Reading the errors you are about to see

These compute translations, fault outcomes and coverage arithmetic, which is
exact and reproducible where a measurement of resident set on a shared machine
would be neither.

`assert-failed` names the address or the count your model got wrong. The page
size is 4096 throughout and the huge page size is 2 MB, which are the values on
every x86-64 machine you will meet.
