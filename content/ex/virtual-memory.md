## Splitting an address

Write `split_addr`, separating a virtual address into its page number and its
offset within the page.

Pages are 4096 bytes, so the low twelve bits are the offset and never change
during translation.

@kind output
@concept The offset passes through untranslated, which is why translation happens
at page granularity and why a page is the unit everything else in this unit
counts in.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Twelve bits. One shift and one mask.
@diagnose assert verdict assert-failed
A check disagrees. 4096 is two to the twelve, so the page number is the address
shifted right by twelve and the offset is the low twelve bits. Dividing by 4096
and taking the remainder is the same arithmetic, and using a different width is
the mistake this catches.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Two addresses in the same page differ only in the part that is not
translated, which is why a page is the unit of permission, of residency, of
faulting, and of everything else the kernel decides about memory.

```starter
#include <stddef.h>
void split_addr(unsigned long addr, unsigned long *page, unsigned long *off) {
    *page = addr >> 10;
    *off = addr & 0x3FF;
}
```

```tests
#include <assert.h>
void split_addr(unsigned long, unsigned long *, unsigned long *);
int main(void) {
    unsigned long p, o;
    split_addr(0, &p, &o);
    assert(p == 0 && o == 0);
    split_addr(4095, &p, &o);
    assert(p == 0 && o == 4095);
    split_addr(4096, &p, &o);
    assert(p == 1 && o == 0);
    split_addr(4097, &p, &o);
    assert(p == 1 && o == 1);
    split_addr(0x7fff12345678UL, &p, &o);
    assert(o == 0x678);
    assert(p == 0x7fff12345UL);
    return 0;
}
```

```solution
#include <stddef.h>
void split_addr(unsigned long addr, unsigned long *page, unsigned long *off) {
    *page = addr >> 12;
    *off = addr & 0xFFF;
}
```

## Four indices in a row

Write `table_index`, extracting the nine-bit index a given level of the page
table uses.

Level 1 starts at bit 12, and each level above it starts nine bits higher.

@kind output
@concept The page number is split into groups of nine because a 512-entry table
fits exactly in one page, which is why the tree has that shape.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Shift by twelve plus nine times the level number, then mask nine bits.
@diagnose assert verdict assert-failed
A check disagrees. Level 1 is bits 12 to 20, level 2 is 21 to 29, and so on, so
the shift is 12 plus 9 times one less than the level. The mask is 511, which is
nine bits, not eight or ten.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Nine bits is 512 entries, each eight bytes, which is exactly 4096: one
page. The tree has this shape because every node of it is a page, which means
allocating a level costs the same as allocating anything else and levels
describing nothing can simply be absent.

```starter
unsigned table_index(unsigned long addr, int level) {
    return (unsigned)((addr >> (12 + 9 * level)) & 0x1FF);
}
```

```tests
#include <assert.h>
unsigned table_index(unsigned long, int);
int main(void) {
    /* One bit set in each nine-bit group, plus an offset. */
    unsigned long a = (1UL << 12) | (2UL << 21) | (3UL << 30) | (4UL << 39) | 0x321;
    assert(table_index(a, 1) == 1);
    assert(table_index(a, 2) == 2);
    assert(table_index(a, 3) == 3);
    assert(table_index(a, 4) == 4);
    /* The offset never reaches any index. */
    assert(table_index(0xFFF, 1) == 0);
    /* The top of a nine-bit group. */
    assert(table_index(511UL << 12, 1) == 511);
    assert(table_index(511UL << 12, 2) == 0);
    return 0;
}
```

```solution
unsigned table_index(unsigned long addr, int level) {
    return (unsigned)((addr >> (12 + 9 * (level - 1))) & 0x1FF);
}
```

## The pages that appear

Write `pages_faulted`, counting how many first-touch faults a walk over a range
of bytes causes, starting at `addr` for `len` bytes, on memory nothing has
touched yet.

One fault per page, and a range that straddles a boundary touches two.

@kind output
@concept Allocation reserves addresses and the memory appears one page at a time,
so the cost of first use is the number of pages rather than the number of bytes.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The same counting as the cache lines in unit 024, with a different size.
@diagnose assert verdict assert-failed
A check disagrees. Dividing the length by the page size ignores where the range
starts: sixteen bytes beginning four bytes before a boundary touch two pages, not
one. Round the start down and the end up.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why the first pass over a freshly allocated array is slower than
the second and why a benchmark that skips the warm-up measures the fault handler
rather than the algorithm. Allocating a gigabyte costs nothing; touching it costs
262144 faults.

```starter
#include <stddef.h>
size_t pages_faulted(unsigned long addr, size_t len) {
    (void)addr;
    return (len + 4095) / 4096;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t pages_faulted(unsigned long, size_t);
int main(void) {
    assert(pages_faulted(0, 0) == 0);
    assert(pages_faulted(0, 1) == 1);
    assert(pages_faulted(0, 4096) == 1);
    assert(pages_faulted(0, 4097) == 2);
    /* Sixteen bytes straddling a boundary. */
    assert(pages_faulted(4092, 16) == 2);
    assert(pages_faulted(4095, 1) == 1);
    assert(pages_faulted(4095, 2) == 2);
    /* A gigabyte is 262144 pages. */
    assert(pages_faulted(0, 1024UL * 1024 * 1024) == 262144);
    return 0;
}
```

```solution
#include <stddef.h>
size_t pages_faulted(unsigned long addr, size_t len) {
    if (len == 0) return 0;
    unsigned long first = addr / 4096;
    unsigned long last = (addr + len - 1) / 4096;
    return (size_t)(last - first + 1);
}
```

## How much the lookaside buffer covers

Write `tlb_reach`, returning how many bytes a translation buffer of `entries`
covers, at a given page size.

A few thousand entries at 4 KB covers a few megabytes, which is smaller than most
people assume.

@kind output
@concept The buffer's reach is entries times page size, so a working set larger
than that misses regularly, at a cost that appears in no instruction count.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One multiplication, and the page size is a parameter for a reason.
@diagnose assert verdict assert-failed
A check disagrees. Reach is the number of entries times the size each covers, so
a huge page entry covers 512 times as much as a small one. Assuming 4096 makes
the huge page case wrong by exactly that factor.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after 1536 entries at 4 KB is about six megabytes, which many working sets
exceed. The same entries mapping 2 MB pages cover three gigabytes, which almost
none do. That is the entire argument for huge pages, and the cost is committing
the whole 2 MB at once and needing contiguous physical memory to back it.

```starter
#include <stddef.h>
unsigned long tlb_reach(unsigned long entries, unsigned long page_size) {
    (void)page_size;
    return entries * 4096;
}
```

```tests
#include <assert.h>
unsigned long tlb_reach(unsigned long, unsigned long);
int main(void) {
    assert(tlb_reach(1536, 4096) == 6291456UL);
    assert(tlb_reach(64, 4096) == 262144UL);
    /* The same entries mapping huge pages reach 512 times as far. */
    assert(tlb_reach(1536, 2097152) == 3221225472UL);
    assert(tlb_reach(0, 4096) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
unsigned long tlb_reach(unsigned long entries, unsigned long page_size) {
    return entries * page_size;
}
```

## Minor, major, or neither

Write `fault_kind`, classifying an access: 0 for no fault, 1 for a minor fault
where the page is in memory and this process cannot reach it yet, and 2 for a
major fault where the contents have to be read from storage.

@kind output
@concept The distinction is the one to look for in a profile, because one costs a
trip into the kernel and the other costs a disk access.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Three questions: is it mapped here, is it resident anywhere, and does it
need reading.
@diagnose assert verdict assert-failed
A check disagrees. A page already resident somewhere costs a minor fault whether
it is a shared library another process loaded or a copy-on-write page being
written, because no storage is involved. Only a page whose contents are not in
memory at all is major.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after High minor fault counts mean the program is touching new memory, which may
be entirely fine. High major fault counts mean it is waiting for storage, which
unit 024's table prices at tens of microseconds against tens of nanoseconds for a
cache miss, and which is almost never fine.

```starter
int fault_kind(int mapped_here, int resident_somewhere) {
    (void)resident_somewhere;
    return mapped_here ? 0 : 2;
}
```

```tests
#include <assert.h>
int fault_kind(int, int);
int main(void) {
    /* Already mapped in this process: no fault. */
    assert(fault_kind(1, 1) == 0);
    /* Resident but not mapped here: a shared library page, or copy on write. */
    assert(fault_kind(0, 1) == 1);
    /* Not in memory at all: read it from storage. */
    assert(fault_kind(0, 0) == 2);
    return 0;
}
```

```solution
int fault_kind(int mapped_here, int resident_somewhere) {
    if (mapped_here) return 0;
    return resident_somewhere ? 1 : 2;
}
```

## The two numbers

Write `resident_bytes`, returning how much physical memory a process actually
holds, given how many pages of its reservation it has touched.

Virtual size is what was reserved. Resident set is what is behind it.

@kind output
@concept The two differ by orders of magnitude and both are correct, which is why
memory profilers disagree with each other and with the operating system.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only the touched pages have memory behind them.
@diagnose assert verdict assert-failed
A check disagrees. The reservation is address space and costs nothing, so a
process that maps a hundred gigabytes and touches two pages is holding eight
kilobytes. Returning the reserved size reports the number that never runs out.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Four numbers are legitimately called memory usage: bytes asked of the
allocator, bytes the allocator got from the kernel, address space reserved, and
pages actually resident. Only the last is a resource that runs out, and it is the
one the smallest number of tools report by default.

```starter
unsigned long resident_bytes(unsigned long reserved_pages,
                             unsigned long touched_pages) {
    (void)touched_pages;
    return reserved_pages * 4096;
}
```

```tests
#include <assert.h>
unsigned long resident_bytes(unsigned long, unsigned long);
int main(void) {
    /* A hundred gigabytes mapped, two pages read. */
    assert(resident_bytes(26214400UL, 2) == 8192UL);
    assert(resident_bytes(1000, 0) == 0);
    assert(resident_bytes(1000, 1000) == 4096000UL);
    assert(resident_bytes(0, 0) == 0);
    return 0;
}
```

```solution
unsigned long resident_bytes(unsigned long reserved_pages,
                             unsigned long touched_pages) {
    (void)reserved_pages;
    return touched_pages * 4096;
}
```

## The bits beside the address

A page table entry carries permissions as well as an address, and the processor
checks them in the same lookup that produces the address.

Write `access_ok`, reporting whether an access is permitted: 0 is a read, 1 a
write, 2 an execute.

@kind output
@concept Read, write and execute are separate bits, which is the enforcement
behind the read-only section and the non-executable data page from unit 023.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Each kind of access consults its own bit. A writable page is not
necessarily executable.
@diagnose assert verdict assert-failed
A check disagrees. The three permissions are independent, so a page can be
readable and not writable, or writable and not executable, and each access
consults only its own bit. Treating writable as implying readable, or readable as
implying executable, collapses distinctions the hardware keeps.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The linker recorded the intent, the loader set the bits, and the check
costs nothing because it happens inside the lookup that was going to happen
anyway. That is why a page that is both writable and executable is refused on
modern systems, and why a just-in-time compiler has to ask the kernel to change
the bits between writing its code and jumping to it.

```starter
int access_ok(int readable, int writable, int executable, int kind) {
    (void)executable;
    return kind == 0 ? readable : writable;
}
```

```tests
#include <assert.h>
int access_ok(int, int, int, int);
int main(void) {
    /* Read-only data: reads yes, writes no, execute no. */
    assert(access_ok(1, 0, 0, 0) == 1);
    assert(access_ok(1, 0, 0, 1) == 0);
    assert(access_ok(1, 0, 0, 2) == 0);
    /* Writable data: not executable. */
    assert(access_ok(1, 1, 0, 1) == 1);
    assert(access_ok(1, 1, 0, 2) == 0);
    /* Code: readable and executable, not writable. */
    assert(access_ok(1, 0, 1, 2) == 1);
    assert(access_ok(1, 0, 1, 1) == 0);
    return 0;
}
```

```solution
int access_ok(int readable, int writable, int executable, int kind) {
    if (kind == 0) return readable;
    if (kind == 1) return writable;
    return executable;
}
```

## What may simply be dropped

When memory is short the kernel evicts pages, and a page that has not been
written since it was loaded can be discarded rather than written out.

Write `eviction_cost`, returning 0 if the page can be dropped and 1 if it has to
be written to storage first.

@kind output
@concept One bit records whether a page has been modified, and it is the
difference between evicting a page of a mapped executable and evicting a page of
your heap.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A clean page backed by a file already has a copy on disk. An anonymous page
does not, whether or not it was written.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the clean anonymous page. Nothing on disk holds
its contents, since there is no file behind it, so even unmodified it has to go
to swap rather than being discarded. Only a clean file-backed page can simply be
dropped.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why a machine under memory pressure evicts a program's code before
its data, and why a large read-only mapping is a cheap thing to have around. It
is also why swapping is expensive in a way that dropping page cache is not: one
is a write and the other is forgetting.

```starter
int eviction_cost(int file_backed, int dirty) {
    (void)file_backed;
    return dirty;
}
```

```tests
#include <assert.h>
int eviction_cost(int, int);
int main(void) {
    /* Clean and backed by a file: the copy on disk is still good. */
    assert(eviction_cost(1, 0) == 0);
    /* Modified and backed by a file: write it back. */
    assert(eviction_cost(1, 1) == 1);
    /* Anonymous memory has nothing on disk, clean or not. */
    assert(eviction_cost(0, 0) == 1);
    assert(eviction_cost(0, 1) == 1);
    return 0;
}
```

```solution
int eviction_cost(int file_backed, int dirty) {
    if (!file_backed) return 1;
    return dirty;
}
```
