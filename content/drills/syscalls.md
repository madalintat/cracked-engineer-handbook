## What does the `syscall` instruction actually do?

- [x] Jumps to an address the kernel set at boot, changing privilege level and stack
- [ ] Calls the address in `rax`
- [ ] Raises an interrupt the kernel has registered a handler for
- [ ] Pushes a return address and jumps to a fixed offset in the kernel

@why You do not choose the destination, and that is the whole point. If the
caller could pick the address, the privilege boundary would not be one.

## Which register differs between the function convention and the syscall convention?

- [x] The fourth argument: `rcx` for functions, `r10` for syscalls
- [ ] The first argument: `rdi` for functions, `rax` for syscalls
- [ ] The return value: `rax` for functions, `rdx` for syscalls
- [ ] None; they are the same convention

@why The `syscall` instruction stores the return address in `rcx` and the flags
in `r11`, so `rcx` cannot carry an argument through the instruction that
delivers it.

## What does a syscall return when it fails?

- [x] A small negative number whose magnitude is the error code
- [ ] -1, with the code left in a kernel-managed `errno`
- [ ] Zero, with the code in `rdx`
- [ ] It raises a signal rather than returning

@why Anything from -1 to -4095 is an error and everything else is a result.
Writing to a closed descriptor gives -9, which is `EBADF`.

## Where does `errno` come from?

- [x] The C library, which checks the return range and stores the magnitude per-thread
- [ ] The kernel, which writes it to a fixed address in the process
- [ ] A register the syscall sets alongside the result
- [ ] The dynamic loader, at process startup

@why It is per-thread because making it global was a bug that took years to
remove, and it is not the kernel's idea at all.

## Why do syscall numbers never change?

- [x] A program compiled a decade ago has the number baked into its instruction stream
- [ ] Renumbering would break the interrupt descriptor table
- [ ] The numbers are defined by the x86-64 architecture
- [ ] They do change, but only across major kernel versions

@why It is the strongest compatibility guarantee in the system, stronger than any
library's, and the cost is a table nobody can tidy.

## How does the kernel handle a syscall that turned out to be badly designed?

- [x] It adds a second version beside the first rather than changing the original
- [ ] It changes the behaviour behind a version flag
- [ ] It removes it after a deprecation period
- [ ] It rejects the old number and returns an error

@why Which is why the table contains several pairs that do nearly the same
thing, and why a working program keeps working.

## What did page table isolation do to syscall cost?

- [x] Roughly doubled or tripled it, because entering the kernel now switches page tables
- [ ] Left it unchanged, since the mitigation is in userspace
- [ ] Reduced it, by removing a permission check
- [ ] Made it unpredictable but not slower on average

@why It gives the kernel a separate set of page tables from the process, so the
crossing involves a page table switch and a translation cache flush. Its arrival
in early 2018 is a visible step in production latency graphs.

## Why is `printf` not a syscall?

- [x] Buffering turns one transition per byte into one per few kilobytes
- [ ] It needs to format, which the kernel cannot do
- [ ] It writes to a stream rather than a descriptor
- [ ] The kernel has no formatting syscall

@why That difference has nothing to do with the disk and everything to do with
the boundary.

## What is the vDSO?

- [x] A page the kernel maps into every process, holding data and code to read it without a transition
- [ ] A shared library that wraps syscalls with error handling
- [ ] A cache of recent syscall results
- [ ] The dynamic loader's symbol table for kernel functions

@why `clock_gettime` on a modern system usually performs no privilege transition
at all. It is a normal function call into a page the kernel wrote.

## What does io_uring change?

- [x] Requests and completions live in shared ring buffers, so a syscall is needed only to wake somebody
- [ ] It makes each syscall faster by skipping validation
- [ ] It runs syscalls on a dedicated core
- [ ] It replaces syscalls with signals

@why A workload doing a million small reads goes from a million transitions to
almost none. It is the same move as buffering and the vDSO: cross less often
rather than more cheaply.

## A program spends most of its time in the kernel. What is the usual cause?

- [x] Its work is split into units that are too small
- [ ] The kernel is misconfigured
- [ ] It is blocked on a lock
- [ ] The disk is slow

@why Reading a file a line at a time through an unbuffered descriptor is the
canonical case, and the repair is a buffer rather than a faster filesystem.

## What is a page fault, in the terms of this unit?

- [x] A crossing into the kernel that your code did not ask for
- [ ] A syscall issued by the memory allocator
- [ ] An error that terminates the process
- [ ] A cache miss handled entirely in hardware

@why It is how memory-mapped files and lazy allocation work, and why the first
pass over a freshly allocated array is slower than the second.

## `write` returned less than you asked for. What does that mean?

- [x] It took that many bytes and you should call again with the rest
- [ ] An error occurred and `errno` holds the reason
- [ ] The descriptor was closed mid-write
- [ ] Nothing; it is not possible for a valid descriptor

@why On a regular file it is rare. On a pipe, a socket or a terminal it is
ordinary, and a loop that advances and retries is what every correct writer
contains.

## Which syscall numbers are `read`, `write` and `exit` on Linux x86-64?

- [x] 0, 1 and 60
- [ ] 1, 2 and 60
- [ ] 3, 4 and 1
- [ ] 0, 1 and 231

@why 231 is `exit_group`, which ends every thread. 60 ends the calling thread,
which for a single-threaded program is the same thing.

## A program without a C library returns from `_start`. What happens?

- [x] It returns to nowhere, because nothing called it
- [ ] The kernel treats the return value as the exit status
- [ ] The loader catches it and exits cleanly
- [ ] It restarts from the entry point

@why `_start` is where the kernel begins execution, not a function anybody
called, which is why every one of these exercises ends with an explicit exit.
