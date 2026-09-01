## What are the three levels behind a file descriptor?

- [x] The descriptor, an open file description holding the offset, and the file itself
- [ ] The descriptor, the inode, and the disk block
- [ ] The descriptor, the buffer, and the device
- [ ] There is one level; a descriptor is the file

@why Which of the three two descriptors share decides whether they see one offset
or two, and every question about redirection is really about this picture.

## Which descriptor does the kernel hand out next?

- [x] The lowest number not currently in use
- [ ] One more than the highest in use
- [ ] Any free number, unspecified
- [ ] The one the caller requested

@why It looks like an implementation detail and it is the entire mechanism of
redirection: close 0, open a file, and the file is standard input.

## Why is `dup2` atomic?

- [x] The gap between closing and duplicating is a state no program is written to survive
- [ ] To avoid a race with another thread's `open`
- [ ] Because the kernel cannot interrupt a syscall
- [ ] It is not; the atomicity is a convention

@why A signal handler running between the close and the duplicate would find a
process with no standard input.

## What does `dup2` do when the source and target are the same descriptor?

- [x] Nothing, and the standard specifies that case explicitly
- [ ] Closes it
- [ ] Returns an error
- [ ] Duplicates it onto the next free number

@why Closing first would destroy the thing about to be duplicated, which is why
the case is called out rather than left to the obvious implementation.

## What does `fork` actually copy?

- [x] Nothing: both processes get the same pages marked read-only, and a write faults
- [ ] The whole address space
- [ ] Only the stack and the heap
- [ ] The descriptor table, and shares the memory permanently

@why Copy on write means forking a process using a gigabyte costs a page table
rather than a gigabyte, using the same fault mechanism virtual memory is built
on.

## If the child usually calls `exec` immediately, why make the copy at all?

- [x] Everything a parent wants to arrange for the child happens between the two calls
- [ ] To preserve the parent's registers
- [ ] Because `exec` needs an existing address space
- [ ] For compatibility with older systems

@why Redirect descriptors, change directory, drop privileges, set limits, join a
namespace: all ordinary calls in the child. A single create-and-launch call has
to accept every one as a parameter, and that list is never finished.

## What survives `exec`?

- [x] Descriptors, unless they are marked close-on-exec
- [ ] Nothing; the process is replaced entirely
- [ ] Descriptors and the address space
- [ ] Only the standard three

@why That is what makes redirection work and what makes leaks possible, and the
flag is the only control.

## Why do two processes appending to one log file through inherited descriptors not overwrite each other?

- [x] They share an open file description, so they share an offset
- [ ] The kernel serialises writes to the same inode
- [ ] Append mode seeks to the end before each write in each process
- [ ] They do overwrite each other

@why Two processes that each opened the file separately have independent
descriptions and independent offsets, and those do overwrite.

## Reading an empty pipe whose write end is still open somewhere does what?

- [x] Blocks
- [ ] Returns 0, meaning end of file
- [ ] Returns an error
- [ ] Returns whatever was last written

@why End of file happens only when no process anywhere holds the write end. The
commonest hang is a reader that forgot to close its own copy of the write end.

## Writing to a pipe whose read end is closed does what?

- [x] Delivers `SIGPIPE`, which by default terminates the process
- [ ] Returns 0
- [ ] Blocks until a reader appears
- [ ] Succeeds and discards the data

@why It is deliberate: a producer whose consumer has gone should stop rather than
fill a buffer nobody will drain. It is also why a server writing to sockets has
to ignore the signal explicitly.

## What is a zombie process?

- [x] A record holding an exit status until the parent collects it
- [ ] A process stuck in an uninterruptible system call
- [ ] A process whose parent has exited
- [ ] A process consuming CPU with no controlling terminal

@why Killing one does nothing, because it is already dead. The fix is always in
the parent, and a server that ignores its children's exit statuses fills the
process table eventually.

## What happens to a child whose parent exits first?

- [x] It is reparented to init, which waits in a loop
- [ ] It is killed
- [ ] It becomes a zombie forever
- [ ] It is reparented to the nearest surviving ancestor's parent

@why Which is also the mechanism a daemon uses to detach: fork, let the parent
exit, and the child is inherited by init with no controlling terminal.

## Where does "everything is a file" stop being true?

- [x] Sockets need connect, bind and accept, and terminals need their mode changed
- [ ] For devices, which use a separate namespace
- [ ] For pipes, which have no inode
- [ ] It does not stop; every object accepts read and write

@why `ioctl` is the escape hatch where every operation that did not fit went, and
its existence is the honest measure of how far the abstraction stretches.

## On Linux, what makes a new execution context a thread rather than a process?

- [x] Sharing the address space
- [ ] Using a different system call
- [ ] Sharing the descriptor table
- [ ] Having no separate entry in the process list

@why Two processes share a descriptor table after a fork and are not threads.
There is one call and a set of flags, and the distinction people draw is a
distinction between two settings of one of them.

## Why does the scheduler not need separate machinery for threads?

- [x] A thread is the same kind of object with different sharing flags
- [ ] Threads are scheduled by userspace
- [ ] Threads are always bound to their process's core
- [ ] It does need separate machinery

@why Which is also why threads appear in the process list and can be scheduled
independently.
