---
needs: [syscalls, elf]
minutes: 55
one_idea: A descriptor is an index into a per-process table, and almost everything surprising about redirection, inheritance and pipes follows from what that table entry actually points at.
sources: [x86-64-assembly, compilers-interpreters-terminals-unix]
---

A process is four things: an address space, a table of open descriptors, a set of
credentials, and at least one thread. Most of what a shell does, and most of what
a container runtime does, is arranging those four before running somebody else's
program.

## Three tables, not one

The phrase file descriptor suggests one object. There are three, and every
confusing thing about descriptors comes from which of the three is shared.

The descriptor is a small integer, and it indexes a table belonging to your
process. That table entry points at an open file description, which holds the
current offset and the access mode. The description points at the underlying
object, an inode for a file, a buffer for a pipe, a socket for a connection.

So two descriptors can point at one description, in which case they share an
offset: read from one and the other has moved. Or two descriptions can point at
one file, in which case they have independent offsets on the same bytes.

```figure
{
  "kind": "blocks",
  "alt": "Two descriptors in a process table pointing at one open file description, which points at an inode, alongside a third descriptor with its own description on the same inode.",
  "caption": "Three levels. Which of them two descriptors share decides whether they see one offset or two, and every question about redirection is really a question about this picture.",
  "boxes": [
    { "id": "fd0", "x": 0,   "y": 0.2, "w": 3,   "h": 1.1, "label": "fd 1", "accent": "azure" },
    { "id": "fd1", "x": 0,   "y": 1.6, "w": 3,   "h": 1.1, "label": "fd 2", "accent": "azure" },
    { "id": "fd2", "x": 0,   "y": 3.0, "w": 3,   "h": 1.1, "label": "fd 3", "accent": "azure" },
    { "id": "d1",  "x": 4.6, "y": 0.9, "w": 3.8, "h": 1.1, "label": "description", "sub": "offset 40", "accent": "copper" },
    { "id": "d2",  "x": 4.6, "y": 3.0, "w": 3.8, "h": 1.1, "label": "description", "sub": "offset 0", "accent": "copper" },
    { "id": "i",   "x": 9.8, "y": 1.9, "w": 3,   "h": 1.1, "label": "the file", "accent": "jade" }
  ],
  "arrows": [
    { "from": "fd0", "to": "d1" },
    { "from": "fd1", "to": "d1" },
    { "from": "fd2", "to": "d2" },
    { "from": "d1", "to": "i" },
    { "from": "d2", "to": "i" }
  ]
}
```

## The lowest free number

One rule decides how redirection works, and it looks like an implementation
detail.

When the kernel hands out a descriptor it always gives the lowest number not
currently in use. So closing descriptor 0 and then opening a file gives you
descriptor 0, which is standard input, which means the next program to read
standard input reads your file.

That is the whole mechanism. A shell redirecting input opens the file, closes 0,
and duplicates the file onto 0, and the program it then runs has no idea anything
happened. `dup2` does the close and the duplicate atomically, which matters
because a signal arriving between them would leave the process without a standard
input.

Nothing about this requires the program's cooperation, which is why redirection
works on programs that never considered it.

## Fork, and why it copies nothing

`fork` creates a process that is a copy of the caller. Same memory, same
descriptors, same instruction about to execute. It returns twice: zero in the
child, the child's identifier in the parent.

Copying an address space would be ruinous, so nothing is copied. Both processes
are given the same physical pages marked read-only, and the first write to a page
traps into the kernel, which makes a private copy and lets the write proceed.
That is copy on write, it is the same page fault mechanism unit 035 is about, and
it means forking a process using a gigabyte costs a page table rather than a
gigabyte.

The child usually then calls `exec`, which throws the address space away and
replaces it with a program from disk. Which raises the obvious question: if the
copy is discarded immediately, why make it.

## Because the gap is where the work happens

The answer is that everything a parent wants to arrange for a child happens
between the two calls.

Redirect the descriptors. Change the working directory. Drop privileges. Set
resource limits. Join a namespace. Every one of those is an ordinary call in the
child, before the new program exists, using the ordinary interface rather than a
parameter to a launch function.

The alternative design, a single call that both creates and launches, has to
accept every one of those as an argument, and the list is never complete. Windows
took that route and its process creation function has ten parameters and a
structure with eighteen fields.

The cost of the Unix design is the wasted copy, which copy on write mostly
removes, and a second call that can fail. `posix_spawn` exists for the cases
where even that is too much.

## What survives each step

Descriptors survive `fork`, and both processes share the same open file
descriptions, offsets included. Two processes appending to one log file through
inherited descriptors interleave lines correctly, because they share an offset,
which is a property people rely on without knowing why it holds.

Descriptors also survive `exec`, and that is the mechanism redirection depends
on. It is also a hazard: a descriptor you forgot about is now open in a program
you did not write, which is how private files have leaked into subprocesses.

The close-on-exec flag is the fix, and the reason it exists as a flag rather than
a default is history. Modern interfaces let you set it at creation, and the
advice is to set it always and clear it deliberately for the few descriptors a
child is supposed to receive.

## Pipes, and the signal nobody expects

A pipe is a kernel buffer with a descriptor at each end. Writes block when it is
full, reads block when it is empty, and the buffer is small, typically sixty four
kilobytes.

Two behaviours follow that surprise people.

Reading from a pipe whose write end is closed everywhere returns zero, which is
end of file. If any process still holds the write end open, including the reader
itself through a descriptor it forgot to close, the read blocks forever. A great
many hangs are a descriptor left open in the wrong process.

Writing to a pipe whose read end is closed delivers `SIGPIPE`, which by default
terminates the process. That is why a program in a pipeline dies quietly when the
next stage exits, and it is deliberate: a producer whose consumer has gone should
stop rather than fill a buffer nobody will drain.

## The child that will not go away

A process that exits does not disappear. Its exit status has to survive until
somebody asks for it, so the kernel keeps a small record and the process shows as
defunct in the process list. That is a zombie, and it is the system working.

The parent collects it with `wait`, which returns the status and releases the
record. A parent that never does accumulates one entry per child until the
process table is full, and the fix is always in the parent rather than in the
children, which is why killing a zombie does nothing: it is already dead.

The opposite case is a child whose parent exits first. It is reparented to the
init process, which waits in a loop for exactly this reason, so an orphan is
always collected by somebody. That is also the mechanism a daemon uses to detach:
fork, let the parent exit, and the child is inherited by init with no controlling
terminal.

Neither of these is exotic. A long-running server that spawns helpers and ignores
their exit status will fill the process table eventually, and the symptom is that
nothing can start any more, several hours after the mistake.

## Where everything stops being a file

The slogan is useful and it is not true.

Files, pipes, devices and sockets all accept `read` and `write`, which is a real
and valuable uniformity. But a socket needs `connect`, `bind` and `accept`, none
of which is a file operation. A terminal needs its mode changed, and there is no
`write` that does that.

`ioctl` is the escape hatch: an operation taking a device-specific number and an
untyped pointer, which is where every operation that did not fit went. Its
existence is the honest measure of how far the abstraction stretches.

## A thread is a process that shared

The last piece, and the one that makes the model coherent.

Linux does not have separate machinery for threads. It has one call that creates
a new execution context and a set of flags saying what to share: address space,
descriptor table, signal handlers, working directory. `fork` shares nothing.
Creating a thread shares almost everything.

So a thread is not a lighter kind of process; it is the same object with the
sharing flags set differently. That explains why threads appear in the process
list, why a thread can be scheduled independently, and why the same scheduler
handles both, which is unit 036.

## What to carry forward

A descriptor indexes a per-process table, that entry points at a description
holding the offset, and the description points at the object. Sharing at each
level means something different.

Descriptors are handed out lowest first, which is the entire mechanism of
redirection. They survive both `fork` and `exec`, which makes redirection possible
and leaks possible, and close-on-exec is the control.

And the gap between `fork` and `exec` is where a parent does everything it wants
to arrange, which is why two calls beat one with a parameter list that is never
finished.

## Reading the errors you are about to see

These model the descriptor table and the pipe rather than forking real processes,
because a test that depends on scheduling is a test that fails intermittently.

`assert-failed` names the case your model got wrong. The rules being modelled are
exactly the ones above, and where a rule looks arbitrary the exercise says which
observable behaviour depends on it.
