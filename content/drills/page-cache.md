## What does a successful `write` guarantee?

- [x] The page is dirty in memory and nothing more
- [ ] The data has reached the device
- [ ] The data has reached the device's buffer
- [ ] The data will reach the device within a bounded time

@why Something eventually will send it, on a schedule nobody in the program
chose, and the gap between those two facts is where a whole category of data loss
lives.

## What does the page cache compete with for memory?

- [x] Every process's anonymous pages, under the same replacement policy
- [ ] Nothing; it has a fixed reservation
- [ ] Only other file mappings
- [ ] The kernel's own allocations only

@why Which is why a machine copying a large file evicts a program's data and then
appears to have less memory than it did.

## Roughly how far apart are a page cache hit and a miss?

- [x] Three orders of magnitude
- [ ] A factor of two
- [ ] A factor of ten
- [ ] Six orders of magnitude

@why Tens of nanoseconds for a copy from memory against tens of microseconds for
a device access, decided by whether somebody read it recently.

## What happens to the read-ahead window on a non-sequential access?

- [x] It collapses to one
- [ ] It halves
- [ ] It stays at its current size
- [ ] It grows, on the assumption of a new sequence

@why The evidence for the pattern is gone rather than weakened, and a program
that jumps constantly disables the mechanism entirely and pays full latency per
access.

## What happens when dirty pages cross the first threshold?

- [x] Background writeback starts and the program notices nothing
- [ ] Writes begin to block
- [ ] The kernel drops the oldest dirty pages
- [ ] Reads slow down

@why Only past the second threshold is a process made to write pages out itself,
and that transition is abrupt.

## A program writes at memory speed for several seconds and then at device speed. What changed?

- [x] Nothing in the program; it filled the dirty page allowance
- [ ] The device entered a thermal limit
- [ ] The file grew past an extent boundary
- [ ] The writeback thread was descheduled

@why A benchmark short enough to stay under the threshold reports a number no
sustained workload will ever see, which is the same shape as the write buffer in
unit 039.

## What does `fsync` guarantee?

- [x] That file's dirty pages are written back and the device's buffer is flushed
- [ ] That every dirty page in the system is written back
- [ ] That the file and its directory entry are durable
- [ ] That subsequent writes will also be durable

@why It says nothing about the directory the file is in, so a newly created file
can be fully written and flushed and still not exist after a power loss.

## What are the four steps of safely replacing a file?

- [x] Write the temporary, flush it, rename over the original, flush the directory
- [ ] Write the temporary, rename, flush the directory
- [ ] Write in place and flush
- [ ] Delete the original, write the new one, flush

@why Skip the directory flush and the rename is not durable. Skip the file flush
and the name points at incomplete contents, which is worse than the file not
existing.

## An `fsync` fails and you call it again. What happens?

- [x] It succeeds, because the error was reported once and cleared
- [ ] It fails again
- [ ] It blocks until the write succeeds
- [ ] It returns a different error

@why Not because anything was written. Several databases treated that second
success as proof of durability and lost data for years.

## What is the current guidance on an `fsync` failure?

- [x] It is not retryable and the data must be assumed lost
- [ ] Retry with exponential backoff
- [ ] Reopen the file and retry
- [ ] Fall back to a direct write

@why Some systems treat it as fatal, which sounds extreme and is the only
interpretation the interface supports.

## What orders two writes to different files?

- [x] Nothing, without a flush between them
- [ ] The order the calls were made
- [ ] The kernel's writeback queue
- [ ] The device's completion order

@why A program that writes a record and then a pointer to it can lose the record
and keep the pointer, which is exactly the corruption a journal exists to
prevent.

## Why is a system doing small durable updates limited by flushes rather than bandwidth?

- [x] Each flush costs the real device latency rather than the buffered one
- [ ] Each flush writes the whole file
- [ ] Flushes are serialised across the machine
- [ ] Small writes have high amplification

@why Batching several logical updates into one flush is the standard answer and
it is why databases group commits.

## What must be aligned for a direct transfer?

- [x] The file offset, the length, and the memory buffer's address
- [ ] The file offset only
- [ ] The offset and the length
- [ ] Nothing; alignment affects speed rather than correctness

@why The device transfers whole blocks between the medium and the address you
gave it, with nothing in between to fix a misalignment, so the call fails rather
than being slow.

## Why do databases bypass the page cache?

- [x] They have their own buffer pool, and a second cache underneath duplicates it
- [ ] The page cache is slower than direct access
- [ ] The page cache does not support large files
- [ ] To avoid the kernel's read-ahead

@why The reason is duplication rather than overhead, and for anything that does
not manage its own caching the page cache is better than what you would write.

## Does `mmap` change durability?

- [x] No; a write through a mapping dirties a page and needs the same flush
- [ ] Yes; mapped writes go straight to the device
- [ ] Yes; the mapping is flushed on unmap
- [ ] Only for shared mappings

@why It removes the transition and the copy, and it introduces a failure mode the
read path does not have: an I/O error becomes a signal rather than a return value.
