## What happens to the low twelve bits of a virtual address?

- [x] Nothing; they are the offset and pass through untranslated
- [ ] They index the first page table level
- [ ] They are checked against the page's permissions
- [ ] They select a byte within a cache line

@why Which is why translation happens at page granularity, and why a page is the
unit of permission, residency and faulting.

## Why is the page table a four-level tree rather than one array?

- [x] A flat table would need 2 to the 36 entries per process
- [ ] Trees are faster to search
- [ ] Each level has different permissions
- [ ] To support pages of different sizes

@why Levels describing nothing are simply absent, which is why a process with a
sparse address space costs almost nothing to describe.

## Why nine bits per level?

- [x] 512 eight-byte entries is exactly one page, so every node of the tree is a page
- [ ] It divides 48 evenly
- [ ] It matches the cache line size
- [ ] It is the widest index the hardware can decode

@why Allocating a level costs the same as allocating anything else, which is what
makes the sparse case cheap.

## What does a TLB miss cost?

- [x] A walk of the tree, up to four dependent loads, each of which may miss in cache
- [ ] One extra cycle
- [ ] A trap into the kernel
- [ ] A disk access

@why And it appears in no instruction count, which is why it is invisible unless
you look for it.

## Roughly how much memory does a typical TLB cover with 4 KB pages?

- [x] A few megabytes
- [ ] A few hundred kilobytes
- [ ] A few gigabytes
- [ ] All of physical memory

@why A few thousand entries at 4 KB each. Working sets larger than that miss
regularly, which is the entire argument for huge pages.

## What does asking for a gigabyte of memory consume?

- [x] Nothing; it reserves addresses with no physical pages behind them
- [ ] A gigabyte
- [ ] A gigabyte of swap
- [ ] A page table large enough to describe it

@why The memory appears on first touch, one fault per page, which is why
allocating a gigabyte costs nothing and touching it costs 262144 faults.

## Why is the first pass over a freshly allocated array slower than the second?

- [x] Every page is being faulted in for the first time
- [ ] The cache is cold
- [ ] The prefetcher has not learned the stride
- [ ] The allocator is still zeroing it

@why Both cache and prefetcher effects exist too, and the fault is the larger one
and the one that appears in no instruction count. A benchmark that skips the
warm-up measures the fault handler.

## A program maps a hundred gigabyte file and reads two pages. What is its resident set?

- [x] Eight kilobytes
- [ ] A hundred gigabytes
- [ ] Two pages plus the page tables to describe the mapping
- [ ] Undefined until the pages are written

@why Virtual size and resident set can differ by orders of magnitude and both are
correct, which is why memory profilers disagree with each other and with the
operating system.

## What is overcommit?

- [x] The kernel promising more memory than it has, since allocation is lazy
- [ ] Allocating more than the process requested, for alignment
- [ ] Reserving swap in advance of use
- [ ] Mapping the same page into several processes

@why It is why forking a large process succeeds and why an allocation almost
never fails: the failure was deferred to the moment a page is touched, where there
is no way to report it.

## Why does the OOM killer exist?

- [x] The failure was deferred past the point where it could be returned to the caller
- [ ] To reclaim memory from processes that leak
- [ ] To enforce per-process limits
- [ ] To free swap space

@why Turning overcommit off makes allocations fail honestly and makes a great
deal of ordinary software stop working, which is why almost nobody does.

## What is the difference between a minor and a major fault?

- [x] Minor means the page is in memory somewhere; major means it must be read from storage
- [ ] Minor means read-only, major means write
- [ ] Minor is handled in hardware, major in the kernel
- [ ] Minor is for anonymous memory, major for file mappings

@why High minor counts mean the program is touching new memory, which may be
fine. High major counts mean it is waiting for storage, which almost never is.

## Two processes map the same file shared. What do they see?

- [x] Each other's writes, with no system call involved
- [ ] Private copies, from copy on write
- [ ] The same bytes until either writes, then copies
- [ ] Undefined behaviour

@why It is the fastest inter-process communication there is, and a private
mapping is the copy-on-write case instead.

## What enforces that `.rodata` cannot be written?

- [x] Permission bits in the page table entry, checked in the same lookup that translates
- [ ] The linker, which rejects writes at build time
- [ ] The allocator, which refuses to hand out that range
- [ ] A guard page around the section

@why The linker recorded the intent and the loader set the bits, and the check
costs nothing because it happens inside a lookup that was going to happen anyway.

## Which page can be evicted without writing anything?

- [x] A clean page backed by a file
- [ ] Any clean page
- [ ] Any page that has not been accessed recently
- [ ] A page belonging to a process that is not running

@why Anonymous memory has nothing on disk holding its contents, clean or not, so
even an untouched anonymous page has to go to swap. That is why swapping costs a
write where dropping page cache costs nothing.

## What is swap actually good for?

- [x] Evicting pages that were allocated and never used again, freeing space for page cache
- [ ] Extending memory beyond what was installed
- [ ] Making large allocations succeed
- [ ] Holding memory for suspended processes

@why A working set larger than physical memory means constant major faults and a
system that appears to have stopped. A machine swapping steadily is not using
extra memory, it is dying slowly.
