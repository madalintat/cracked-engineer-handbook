## What does a build system actually know about compilers?

- [x] Nothing; it knows nodes, edges and a command to run for each node
- [ ] How to invoke each compiler it supports
- [ ] Which files a compiler will read, from the language standard
- [ ] The object file format of the target

@why That is why the whole subject reduces to one question: how does it decide
a node is out of date.

## Which build error is the dangerous one?

- [x] Under-building, because the binary stops matching the source and nothing reports it
- [ ] Over-building, because it wastes the most time
- [ ] Both are equally serious
- [ ] Neither; a clean build fixes both

@why Over-building costs time. Under-building produces a wrong program, and the
symptom is that it works after a clean build.

## What does it mean when a clean build behaves differently from an incremental one?

- [x] The dependency graph is missing an edge
- [ ] The compiler is not deterministic
- [ ] The build directory needs to be recreated regularly
- [ ] Timestamps have drifted and need resetting

@why A clean build is a diagnosis rather than a fix. The useful response is to
find the edge.

## When is a build system correct?

- [x] When every possible edit produces an incremental build with the same bytes as a clean build
- [ ] When it never rebuilds anything unnecessarily
- [ ] When it can build the tree from scratch without errors
- [ ] When every rule declares its dependencies by hand

@why It is a strong definition and most build systems do not meet it. Knowing
which failures you have is what makes it useful.

## Why is a timestamp comparison cheap?

- [x] One system call per file, with no reading of contents
- [ ] The filesystem caches the answer for the whole tree
- [ ] It only checks files that were opened since the last build
- [ ] The comparison is done by the kernel

@why That is how a tree of fifty thousand files decides it has nothing to do in
under a second, and it is the reason the model survives its failures.

## An older make compares timestamps at one second granularity. What goes wrong?

- [x] A header edited in the same second as the build reads as not newer, and nothing rebuilds
- [ ] The build rebuilds everything once a second
- [ ] Files edited in the future are ignored
- [ ] Only files larger than one block are compared correctly

@why Measured over ten rapid edit and rebuild cycles: eight produced a binary
that did not match the source, silently. A tool with nanosecond timestamps
missed none.

## Extracting an archive writes old timestamps onto new content. What does a timestamp based build system do?

- [x] Nothing, because no input looks newer, which is a silent under-build
- [ ] Rebuilds everything, because the timestamps are inconsistent
- [ ] Warns and rebuilds the affected nodes
- [ ] Detects the change through the file size

@why Timestamps assume time only moves forwards. Restoring a backup, copying
with attributes preserved and several version control operations all break that
assumption, and it is a property of the model rather than a bug in one tool.

## You change the optimisation level and run make again. What happens?

- [x] Nothing rebuilds, because no file is newer than any other
- [ ] Everything rebuilds, because the command changed
- [ ] Only the link step reruns
- [ ] Make warns that the flags differ from last time

@why The command line is not a file. Tools that record the command string beside
the output treat a changed command as a changed input, and that is the argument
for them almost nobody makes.

## What is the difference between a timestamp saying changed and a hash saying different?

- [x] A timestamp records that a file was written; a hash records whether the contents differ
- [ ] A hash is only correct for text files
- [ ] A timestamp is exact and a hash can collide
- [ ] There is none, in practice

@why Saving a file without editing it moves the timestamp and changes no
content, which is over-building. The reverse case, new content with an old
timestamp, is the dangerous one.

## What goes into a content addressed build system's cache key?

- [x] The hashes of every input, the command, and the parts of the environment that matter
- [ ] The hash of the output, checked after the fact
- [ ] The hash of each input, and nothing else
- [ ] The input hashes and the modification times

@why Leaving the command out is what lets an object built with different flags
be reused, which is the failure the timestamp model also has.

## What is early cutoff?

- [x] A node whose output came out identical stops the rebuild propagating downstream
- [ ] Stopping a build at the first error rather than continuing
- [ ] Skipping nodes whose inputs are older than a cutoff date
- [ ] Aborting a build that exceeds a time limit

@why Edit a comment, recompile, and the object may be byte identical. A hashing
system notices and does not relink; a timestamp system relinks the program
because a file got newer.

## What does content hashing cost?

- [x] Reading every input rather than looking at its size and date, plus somewhere to keep the cache
- [ ] Correctness in the presence of hash collisions
- [ ] The ability to build in parallel
- [ ] Compatibility with compilers that do not emit dependency files

@why What it buys is a build whose answer does not depend on the order things
happened to be written in.

## Why does the compiler generate the dependency list rather than a person writing it?

- [x] The compiler is the only party that knows which headers were actually read
- [ ] It is faster than parsing the includes separately
- [ ] The build system cannot read the source files
- [ ] Hand written rules cannot express header dependencies

@why A rule written by a person goes stale the moment somebody adds an include,
and the symptom is a header edit that changes nothing until a clean build.

## What limits how much a parallel build can be sped up?

- [x] The critical path, the longest chain of nodes that must run in order
- [ ] The total amount of work in the graph
- [ ] The number of source files
- [ ] The speed of the slowest single compilation

@why The total work is what one core takes. The gap between that and the
critical path is all that parallelism can buy.

## Why does one header included everywhere make a build slow on any machine?

- [x] Everything waits for the same node, so it sits on the critical path and no number of cores shortens it
- [ ] It makes each translation unit larger to parse
- [ ] It defeats the compiler's own caching
- [ ] It forces the linker to run earlier

@why Both effects are real, and only the first one is immune to buying a wider
machine. Splitting that header does more for build time than more cores.
