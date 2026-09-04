---
needs: [compile-time, elf]
minutes: 55
one_idea: A build system is a cache, so every build bug is a cache bug, and a timestamp is a cache key that is wrong in at least five ways you will meet.
sources: [build-systems-toolchains]
---

A build is a graph. Object files depend on sources and on the headers they
include, a library depends on its objects, a program depends on its libraries.
Nothing may run before what it depends on, and anything whose inputs have not
changed does not need to run at all.

That is the whole model, and the useful surprise is how little the system knows.
A build system does not know what a compiler is. It knows nodes, edges, and a
command to run for each node. Everything it does well or badly follows from how
it decides that a node is out of date.

The failures below were measured, on a real tree, with a correct dependency
file and a real edit.

## Two ways to be wrong, and only one of them hurts

Over-building means running work that was not needed. It costs time and nothing
else.

Under-building means not running work that was needed. The binary no longer
matches the source, the tests pass here and fail elsewhere, and the symptom is
the sentence everyone has said: it works after a clean build.

```figure
{
  "kind": "blocks",
  "alt": "Two outcomes from a stale decision: over-building wastes time and stays correct, while under-building produces a binary that does not match the source and says nothing.",
  "caption": "The two errors are not symmetric. One is a slow build and the other is a wrong program that no tool reports, which is why a build system may over-build and may never under-build.",
  "boxes": [
    { "id": "d", "x": 0,    "y": 1.2, "w": 3.6, "h": 1.1, "label": "is it stale?", "accent": "gold" },
    { "id": "o", "x": 5.4,  "y": 0,   "w": 4.4, "h": 1.1, "label": "over-build: slow", "accent": "jade" },
    { "id": "u", "x": 5.4,  "y": 2.4, "w": 4.4, "h": 1.1, "label": "under-build: wrong", "accent": "clay" }
  ],
  "arrows": [
    { "from": "d", "to": "o" },
    { "from": "d", "to": "u" }
  ]
}
```

So a clean build is not a fix. It is a diagnosis. If building from scratch gives
a different answer from building incrementally, the graph is missing an edge,
and the useful response is to find the edge rather than to delete everything and
start again.

That gives a definition worth holding onto. A build system is correct when, for
every possible edit to the source tree, the incremental build produces the same
bytes as a build from nothing. Most build systems are not correct in that sense,
and knowing which failures you have is the difference between losing an
afternoon and losing a week.

## What a timestamp cannot tell you

The classic rule is one line: rebuild the output if any input is newer than it.
It costs one system call per file and no reading of contents, which is why a
tree of fifty thousand files can decide it has nothing to do in under a second.

It is also wrong in at least five ways.

The first is granularity. An older make compares whole seconds. Edit a header,
rebuild, and if the object file was written earlier in the same second, the two
truncate to the same number, and equal is not newer. Measured on ten rapid edit
and rebuild cycles, eight produced a binary that did not match the source, in
silence. A build tool with nanosecond timestamps scored zero misses on the same
test.

The second is that time does not only move forwards. Timestamps assume it does.
Extracting an archive, copying with attributes preserved, restoring a backup and
several version control operations all write old times onto new content. Give a
header new content and a timestamp from 2020 and every timestamp based system on
earth says there is nothing to do. This is not a bug in one tool. It is a
property of the model.

The third is that a shared filesystem has more than one clock. When the file
server and the build machine disagree by a couple of hundred milliseconds, the
tool notices a file from the future, warns, and then guesses.

The fourth is the one almost nobody mentions. The command line is not a file.
Change the optimisation level or add a definition on the command line, and a
plain make sees no file newer than any other file and does nothing at all. The
tree is now half built one way and half the other. Tools that record the command
string alongside the output treat a changed command as a changed input, and
rebuild correctly; that is the second good reason to prefer them and it is
rarely the one given.

The fifth is the harmless one. A timestamp says changed, not different. Save a
file without editing it and everything downstream rebuilds.

## Hashing the inputs instead

The other family asks a different question: is the hash of every input, plus the
command, plus the parts of the environment that matter, a key already in the
cache?

That is a cache key rather than a comparison, and it removes all five failures.
Content that did not change hashes the same however its timestamp moved. A
different command is a different key. An identical file restored from a backup
is a hit.

It also buys something a timestamp cannot express. If you edit a comment and
recompile, the object file may come out byte for byte identical. A hashing system
notices that the output did not change and stops there, so nothing downstream
runs. A timestamp system relinks the entire program because a file got newer.
That is early cutoff, and on a large tree it is the difference between a rebuild
you wait for and one you do not notice.

The cost is real. Hashing means reading every input rather than looking at its
size and date, and the cache has to live somewhere. What you are buying is a
build whose answer does not depend on the order things happened to be written
in.

## The edge that is not in the makefile

There is one more way to under-build, and it is the most common of all: the edge
simply is not there.

A source file includes a header. Nothing in the source file's build rule says
so, because the rule was written by a person and the include was added later. So
the object never rebuilds when the header changes.

Compilers solve this by generating the dependency list as a side effect of
compiling. The compiler already found every header it read, so it writes them
out in a form the build system can include, and the graph gains the edges nobody
maintained. If a project's rules do not do this, it has this bug, and the bug
shows up as a header edit that changes nothing until someone builds from clean.

There is a structural version of the same mistake. A build split into one
invocation per directory, each with its own view of the world, gives every
invocation an incomplete graph. Nothing can be scheduled across the boundaries,
because no single process ever holds the whole thing, and a dependency that
crosses a directory is a dependency nobody checks. The fix is the same in
either case: one graph, complete, in one place.

## Where the time actually goes

Two numbers describe a build graph. The total work is the sum of every node's
cost, and it is what a single core takes. The critical path is the longest chain
of nodes that must run in order, and it is what infinitely many cores take.

The gap between them is what parallelism can buy, and it explains why adding
cores stops helping. A tree with one enormous header included everywhere has a
long critical path no matter how wide the machine is, because everything waits
for the same node. Splitting that header does more for build time than any
number of cores.

It also explains why linking is so often the last thing you wait for. Every
object is on the critical path to it, and there is exactly one of it.

## What to carry forward

A build is a graph, and a build system knows only nodes, edges and commands.
Over-building costs time; under-building costs correctness, silently, which is
why a system may do the first and must never do the second.

A timestamp is a cheap and wrong cache key: it fails on granularity, on time
moving backwards, on two clocks, on a changed command line, and it confuses
changed with different. Hashing the inputs, the command and the environment
fixes all five and adds early cutoff.

The most common missing edge is a header nobody declared, and the fix is to let
the compiler write the dependency list, because it is the only party that knows.

The critical path, not the total work, is what a parallel build takes.

Next is what happens when the program that came out of all this does the wrong
thing: the debugger, and the sanitizers that answer questions a debugger cannot.

## Reading the errors you are about to see

These model the decisions a build system makes, staleness, cache keys, early
cutoff and critical paths, on small graphs given as arrays.

`assert-failed` names the case your model got wrong. Several exercises assert
that an input with an equal timestamp counts as stale, which is the granularity
failure being avoided rather than a comparison written the wrong way round.
