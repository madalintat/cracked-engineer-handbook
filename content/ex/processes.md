## The lowest free number

Write `alloc_fd`, returning the descriptor the kernel would hand out next: the
lowest number not currently in use.

This looks like an implementation detail and it is the entire mechanism of shell
redirection.

@kind output
@concept Descriptors are handed out lowest first, so closing 0 and opening a file
puts the file on standard input without the program's cooperation.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Scan upwards from zero for the first free slot.
@diagnose assert verdict assert-failed
A check disagrees. The rule is the lowest free number, not the next one after the
highest in use, so a table with a gap in it fills the gap. That difference is
exactly what redirection depends on.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Close descriptor 0, open a file, and the file is standard input. The
program you then run has no idea anything happened, which is why redirection
works on programs that never considered it and why the rule is specified rather
than left to the implementation.

```starter
#include <stddef.h>
int alloc_fd(const unsigned char *in_use, size_t n) {
    for (size_t i = n; i > 0; i--)
        if (in_use[i - 1]) return (int)i;
    return 0;
}
```

```tests
#include <assert.h>
#include <stddef.h>
int alloc_fd(const unsigned char *, size_t);
int main(void) {
    /* 0, 1 and 2 taken: the next is 3. */
    unsigned char a[8] = {1,1,1,0,0,0,0,0};
    assert(alloc_fd(a, 8) == 3);
    /* A gap at 1 is filled before anything higher. */
    unsigned char b[8] = {1,0,1,1,0,0,0,0};
    assert(alloc_fd(b, 8) == 1);
    /* Standard input closed: the next open lands on 0. */
    unsigned char c[8] = {0,1,1,0,0,0,0,0};
    assert(alloc_fd(c, 8) == 0);
    unsigned char d[4] = {1,1,1,1};
    assert(alloc_fd(d, 4) == -1);
    return 0;
}
```

```solution
#include <stddef.h>
int alloc_fd(const unsigned char *in_use, size_t n) {
    for (size_t i = 0; i < n; i++)
        if (!in_use[i]) return (int)i;
    return -1;
}
```

## Two descriptors, one offset

Write `dup_fd`, which points a second descriptor at the same open file
description as the first.

Descriptors that share a description share an offset. Descriptors on separate
descriptions of the same file do not.

@kind output
@concept The table entry points at a description holding the offset, so
duplicating a descriptor shares the position and opening the file again does not.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Copy which description the source points at, not the offset itself.
@diagnose assert verdict assert-failed
A check disagrees. Copying the offset makes two independent positions that happen
to start equal, so advancing one leaves the other behind. Pointing both entries at
the same description means one offset exists and both see it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why two processes appending to one log file through descriptors
inherited across a fork interleave lines correctly: they share a description, so
they share an offset, and each write lands after the last. Two processes that
each opened the file separately do not, and they overwrite each other.

```starter
#include <stddef.h>
/* table[i] is the description index descriptor i points at, or -1. */
void dup_fd(int *table, long *offset, int from, int to) {
    table[to] = table[from] + 1;
    offset[table[to]] = offset[table[from]];
}
```

```tests
#include <assert.h>
void dup_fd(int *, long *, int, int);
int main(void) {
    int table[8] = {-1,-1,-1,-1,-1,-1,-1,-1};
    long offset[8] = {0};
    /* Descriptor 3 uses description 0, sitting at byte 40. */
    table[3] = 0;
    offset[0] = 40;
    dup_fd(table, offset, 3, 5);
    /* Both descriptors must name the same description. */
    assert(table[5] == 0);
    /* So advancing through one moves the other. */
    offset[table[3]] += 10;
    assert(offset[table[5]] == 50);
    /* And a second, independent description is unaffected. */
    table[6] = 1;
    offset[1] = 0;
    assert(offset[table[6]] == 0);
    return 0;
}
```

```solution
#include <stddef.h>
/* table[i] is the description index descriptor i points at, or -1. */
void dup_fd(int *table, long *offset, int from, int to) {
    (void)offset;
    table[to] = table[from];
}
```

## Redirection, atomically

Write `dup2_fd`, which closes the target descriptor if it is open and then points
it at the source's description, as one indivisible step.

Doing the close and the duplicate separately leaves a window where the process has
no standard input, and a signal arriving in it finds a program that cannot read.

@kind output
@concept `dup2` is atomic because the gap between closing and duplicating is a
state no program is written to survive.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Duplicating a descriptor onto itself must leave it alone rather than
closing it.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the case where the source and the target are the
same descriptor. Closing first destroys the thing about to be duplicated, so the
result is a closed descriptor where the caller expected an unchanged one. The
standard specifies that case explicitly for exactly this reason.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A shell redirecting input opens the file, then does this, then runs the
program. Three steps, none of which the program participates in, and the middle
one has to be atomic because a signal handler that ran between the close and the
duplicate would see a process with no standard input.

```starter
#include <stddef.h>
void dup2_fd(int *table, int from, int to) {
    table[to] = -1;
    table[to] = table[from];
}
```

```tests
#include <assert.h>
void dup2_fd(int *, int, int);
int main(void) {
    int table[8] = {-1,-1,-1,-1,-1,-1,-1,-1};
    table[0] = 5;
    table[3] = 9;
    /* Redirect standard input to whatever descriptor 3 has. */
    dup2_fd(table, 3, 0);
    assert(table[0] == 9);
    assert(table[3] == 9);
    /* Duplicating a descriptor onto itself changes nothing. */
    dup2_fd(table, 3, 3);
    assert(table[3] == 9);
    /* A closed target simply receives the description. */
    dup2_fd(table, 3, 7);
    assert(table[7] == 9);
    return 0;
}
```

```solution
#include <stddef.h>
void dup2_fd(int *table, int from, int to) {
    if (from == to) return;
    table[to] = table[from];
}
```

## What crosses exec

Write `after_exec`, which clears the descriptors marked close-on-exec and leaves
the rest.

A descriptor you forgot about is open in a program you did not write, and that is
how private files have reached subprocesses.

@kind output
@concept Descriptors survive `exec` by default, which is what makes redirection
possible and leaks possible, and the flag is the only control.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only the flagged ones close. Everything else is inherited.
@diagnose assert verdict assert-failed
A check disagrees. The default is inheritance, not closure: standard input,
output and error have to survive or the new program has nowhere to read or write.
Closing everything would break redirection, which is the mechanism this whole
design exists to support.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The default runs the wrong way for safety and the right way for
redirection, and the historical accident is that the flag exists rather than the
default. Modern interfaces let you set it when the descriptor is created, and the
advice is to set it always and clear it deliberately for the few a child is meant
to receive.

```starter
#include <stddef.h>
void after_exec(int *table, const unsigned char *cloexec, size_t n) {
    for (size_t i = 0; i < n; i++) table[i] = -1;
    (void)cloexec;
}
```

```tests
#include <assert.h>
#include <stddef.h>
void after_exec(int *, const unsigned char *, size_t);
int main(void) {
    int table[6] = {10, 11, 12, 13, 14, -1};
    unsigned char cloexec[6] = {0, 0, 0, 1, 0, 0};
    after_exec(table, cloexec, 6);
    /* The standard three survive, which is what redirection depends on. */
    assert(table[0] == 10);
    assert(table[1] == 11);
    assert(table[2] == 12);
    /* The flagged one is gone. */
    assert(table[3] == -1);
    /* An unflagged one is inherited, whether or not that was intended. */
    assert(table[4] == 14);
    assert(table[5] == -1);
    return 0;
}
```

```solution
#include <stddef.h>
void after_exec(int *table, const unsigned char *cloexec, size_t n) {
    for (size_t i = 0; i < n; i++)
        if (cloexec[i]) table[i] = -1;
}
```

## When a read returns nothing

Write `pipe_read`, which reports what a read from a pipe does: the number of
bytes available, 0 for end of file, or -1 to mean it would block.

End of file happens only when no process anywhere still holds the write end.

@kind output
@concept A pipe reports end of file when the last writer closes, so a descriptor
left open in the wrong process turns a finished pipeline into a hang.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint An empty pipe with writers still attached is not finished, it is waiting.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the empty pipe with a writer still open.
Returning end of file there would report a finished stream that is not finished.
The correct answer is that the read blocks, and that is the difference between a
pipeline that completes and one that hangs.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The commonest cause is a reader that forgot to close its own copy of the
write end. It holds the pipe open against itself, the count never reaches zero,
and the read waits forever for data only it could have sent. Nothing in the
program looks wrong, and a great many hangs are exactly this.

```starter
long pipe_read(long bytes_available, int writers_open) {
    (void)writers_open;
    return bytes_available;
}
```

```tests
#include <assert.h>
long pipe_read(long, int);
int main(void) {
    /* Data available: read it, whatever the writers are doing. */
    assert(pipe_read(100, 2) == 100);
    assert(pipe_read(100, 0) == 100);
    /* Empty, and every writer has closed: end of file. */
    assert(pipe_read(0, 0) == 0);
    /* Empty, and somebody could still write: this blocks. */
    assert(pipe_read(0, 1) == -1);
    assert(pipe_read(0, 5) == -1);
    return 0;
}
```

```solution
long pipe_read(long bytes_available, int writers_open) {
    if (bytes_available > 0) return bytes_available;
    return writers_open > 0 ? -1 : 0;
}
```

## Writing into nothing

Write `pipe_write`, reporting what happens when a process writes to a pipe: the
bytes accepted, -1 to mean it would block because the buffer is full, or -2 to
mean the reader has gone and the writer is about to be signalled.

@kind output
@concept A producer whose consumer has gone is signalled rather than allowed to
fill a buffer nobody will drain, which is why a pipeline stage dies quietly when
the next one exits.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The reader being gone is checked before anything about space.
@diagnose assert verdict assert-failed
A check disagrees. A closed read end means the write can never succeed however
much room there is, so it is reported before the buffer is considered. Checking
space first reports a blocking write on a pipe nobody will ever read.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The signal terminates the process by default, which is why a program in a
pipeline dies quietly when the next stage exits and why a server that writes to
sockets has to ignore it explicitly. The default is deliberate: a producer with no
consumer should stop rather than accumulate.

```starter
long pipe_write(long want, long space, int readers_open) {
    (void)readers_open;
    if (space == 0) return -1;
    return want < space ? want : space;
}
```

```tests
#include <assert.h>
long pipe_write(long, long, int);
int main(void) {
    /* Room and a reader: the write succeeds. */
    assert(pipe_write(10, 100, 1) == 10);
    /* A partial write when the buffer is nearly full. */
    assert(pipe_write(100, 10, 1) == 10);
    /* Full, with a reader: this blocks. */
    assert(pipe_write(10, 0, 1) == -1);
    /* No reader: signalled, whatever the space. */
    assert(pipe_write(10, 100, 0) == -2);
    assert(pipe_write(10, 0, 0) == -2);
    return 0;
}
```

```solution
long pipe_write(long want, long space, int readers_open) {
    if (readers_open == 0) return -2;
    if (space == 0) return -1;
    return want < space ? want : space;
}
```

## The record that outlives the process

Write `reap`, modelling what happens to a child's table entry. A child that has
exited holds a record until the parent collects it; a child whose parent has gone
is reparented to init.

Return 0 if the entry is released, 1 if it lingers as a zombie, 2 if it is
reparented.

@kind output
@concept An exit status has to survive until somebody asks for it, so a process
that exits leaves a record and a parent that never asks accumulates them.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Three questions in order: has it exited, is the parent alive, and did the
parent wait.
@diagnose assert verdict assert-failed
A check disagrees. A child whose parent has exited is reparented whether or not it
has finished, and init waits in a loop, so it never lingers. A child of a live
parent that has not waited is the zombie case, and that is the only one that
accumulates.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Killing a zombie does nothing, because it is already dead: the record is
what remains and only the parent can release it. A long-running server that
spawns helpers and ignores their status fills the process table eventually, and
the symptom is that nothing can start any more, several hours after the mistake.

```starter
int reap(int exited, int parent_alive, int parent_waited) {
    (void)parent_alive;
    return exited && !parent_waited ? 1 : 0;
}
```

```tests
#include <assert.h>
int reap(int, int, int);
int main(void) {
    /* Exited, parent alive and waiting: the record is released. */
    assert(reap(1, 1, 1) == 0);
    /* Exited, parent alive and not waiting: a zombie. */
    assert(reap(1, 1, 0) == 1);
    /* Still running under a live parent: nothing to collect. */
    assert(reap(0, 1, 0) == 0);
    /* Parent gone: reparented to init, which always waits. */
    assert(reap(1, 0, 0) == 2);
    assert(reap(0, 0, 0) == 2);
    return 0;
}
```

```solution
int reap(int exited, int parent_alive, int parent_waited) {
    if (!parent_alive) return 2;
    if (!exited) return 0;
    return parent_waited ? 0 : 1;
}
```

## The flags decide what it is

Linux has one call that creates an execution context and a set of flags saying
what to share. `fork` shares nothing; creating a thread shares almost everything.

Write `is_thread`, reporting whether a given set of flags produces something a
programmer would call a thread rather than a process.

@kind output
@concept A thread is not a lighter kind of process, it is the same object with
the sharing flags set differently, which is why the same scheduler handles both.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The address space is the one that decides it. Sharing descriptors alone
does not.
@diagnose assert verdict assert-failed
A check disagrees. Two processes can share a descriptor table without being
threads, and they do after a fork. What makes it a thread is sharing the address
space, so a write by one is visible to the other with no arrangement at all.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Which is why threads appear in the process list, why a thread can be
scheduled independently, and why the next unit's scheduler does not have two
mechanisms. The distinction people draw between threads and processes is a
distinction between two settings of one flag.

```starter
#define SHARE_VM     1
#define SHARE_FILES  2
#define SHARE_SIGNAL 4
#define SHARE_FS     8

int is_thread(int flags) {
    return flags != 0;
}
```

```tests
#include <assert.h>
int is_thread(int);
int main(void) {
    /* fork: nothing shared. */
    assert(is_thread(0) == 0);
    /* A thread shares the address space. */
    assert(is_thread(1) == 1);
    assert(is_thread(1 | 2 | 4 | 8) == 1);
    /* Sharing descriptors without the address space is still two processes. */
    assert(is_thread(2) == 0);
    assert(is_thread(2 | 4 | 8) == 0);
    return 0;
}
```

```solution
#define SHARE_VM     1
#define SHARE_FILES  2
#define SHARE_SIGNAL 4
#define SHARE_FS     8

int is_thread(int flags) {
    return (flags & SHARE_VM) != 0;
}
```
