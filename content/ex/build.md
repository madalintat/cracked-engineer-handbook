## Equal is not older

Write `stale_by_time`, deciding whether an output must be rebuilt, given the
output's timestamp and the timestamps of its inputs.

Rebuild when any input is at least as new as the output. Equal counts, because
two files written in the same tick are indistinguishable and the safe reading of
a tie is that the input may have come second.

An output with no inputs is never stale. An output that does not exist yet has a
timestamp of 0 and must be built.

@kind output
@concept The two errors are not symmetric, so a tie is resolved towards
over-building, which costs time, rather than towards under-building, which
costs correctness.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The comparison that looks right is strictly newer, and it is the one that
loses eight builds out of ten.
@diagnose assert verdict assert-failed
A check disagrees. An input whose timestamp equals the output's has to count as
stale. Requiring it to be strictly newer is exactly the granularity failure: two
files written in the same second compare equal and the build declines.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured on ten rapid edit and rebuild cycles with a one second clock,
eight produced a binary that did not match the source, in silence.

```starter
int stale_by_time(unsigned long out, const unsigned long *ins, unsigned n) {
    if (!out) return 1;
    for (unsigned i = 0; i < n; i++)
        if (ins[i] > out) return 1;
    return 0;
}
```

```tests
#include <assert.h>
int stale_by_time(unsigned long, const unsigned long *, unsigned);
int main(void) {
    { unsigned long in[] = {5};   assert(stale_by_time(9, in, 1) == 0); }
    { unsigned long in[] = {12};  assert(stale_by_time(9, in, 1) == 1); }
    { unsigned long in[] = {9};   assert(stale_by_time(9, in, 1) == 1); }
    { unsigned long in[] = {1, 2, 9}; assert(stale_by_time(9, in, 3) == 1); }
    { unsigned long in[] = {1, 2, 3}; assert(stale_by_time(9, in, 3) == 0); }
    { unsigned long in[] = {1};   assert(stale_by_time(0, in, 1) == 1); }
    { unsigned long in[] = {0};   assert(stale_by_time(4, in, 0) == 0); }
    return 0;
}
```

```solution
int stale_by_time(unsigned long out, const unsigned long *ins, unsigned n) {
    if (!out) return 1;
    for (unsigned i = 0; i < n; i++)
        if (ins[i] >= out) return 1;
    return 0;
}
```

## Time that moves backwards

Write `time_model_fails`, deciding whether a timestamp based build system will
under-build, given the previous and current content hashes of an input and its
previous and current timestamps.

The system rebuilds when the timestamp moved forwards. It under-builds when the
content changed and the timestamp did not move forwards, which is what
extracting an archive or restoring a backup does.

Return 1 for an under-build and 0 otherwise.

@kind output
@concept This is not a bug in one tool. Any system whose cache key is a
timestamp has it, because the key is not a function of the content.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two questions: did the content change, and would the timestamp have made
the system notice.
@diagnose assert verdict assert-failed
A check disagrees. Content that changed while the timestamp went backwards, or
stayed the same, is the silent case. Content that did not change is never an
under-build, however the timestamp moved.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Give a header new content and a timestamp from 2020 and every timestamp
based system on earth says there is nothing to do.

```starter
int time_model_fails(unsigned long old_hash, unsigned long new_hash,
                     unsigned long old_time, unsigned long new_time) {
    (void)old_hash; (void)new_hash;
    return new_time < old_time;
}
```

```tests
#include <assert.h>
int time_model_fails(unsigned long, unsigned long, unsigned long,
                     unsigned long);
int main(void) {
    /* New content, older timestamp: the silent case. */
    assert(time_model_fails(111, 222, 900, 100) == 1);
    /* New content, same timestamp: also silent. */
    assert(time_model_fails(111, 222, 900, 900) == 1);
    /* New content, newer timestamp: the system notices. */
    assert(time_model_fails(111, 222, 900, 901) == 0);
    /* Same content, whatever the timestamp did. */
    assert(time_model_fails(111, 111, 900, 100) == 0);
    assert(time_model_fails(111, 111, 100, 900) == 0);
    return 0;
}
```

```solution
int time_model_fails(unsigned long old_hash, unsigned long new_hash,
                     unsigned long old_time, unsigned long new_time) {
    if (old_hash == new_hash) return 0;
    return new_time <= old_time;
}
```

## A key, not a comparison

Write `cache_key_hit`, deciding whether a content addressed build system can
skip a node, given the hash of its inputs, the hash of its command, the hash of
the environment it depends on, and the same three values recorded when the
output was made.

All three have to match. Any difference is a different key, and a different key
is a miss.

@kind output
@concept The command line is not a file, so a timestamp cannot see it change.
A key made from the command can.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Three comparisons, all of which have to hold.
@diagnose assert verdict assert-failed
A check disagrees. Changing the optimisation level changes the command hash and
nothing else, and a system that only compares the inputs happily reuses an
object built with different flags.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A plain make sees no file newer than any other when the flags change, so
it does nothing, and the tree ends up half built one way and half the other.

```starter
int cache_key_hit(unsigned long inputs, unsigned long command,
                  unsigned long env,
                  unsigned long rec_inputs, unsigned long rec_command,
                  unsigned long rec_env) {
    (void)command; (void)rec_command; (void)env; (void)rec_env;
    return inputs == rec_inputs;
}
```

```tests
#include <assert.h>
int cache_key_hit(unsigned long, unsigned long, unsigned long,
                  unsigned long, unsigned long, unsigned long);
int main(void) {
    assert(cache_key_hit(1, 2, 3, 1, 2, 3) == 1);
    assert(cache_key_hit(9, 2, 3, 1, 2, 3) == 0);   /* inputs changed */
    assert(cache_key_hit(1, 9, 3, 1, 2, 3) == 0);   /* flags changed */
    assert(cache_key_hit(1, 2, 9, 1, 2, 3) == 0);   /* environment changed */
    return 0;
}
```

```solution
int cache_key_hit(unsigned long inputs, unsigned long command,
                  unsigned long env,
                  unsigned long rec_inputs, unsigned long rec_command,
                  unsigned long rec_env) {
    return inputs == rec_inputs && command == rec_command && env == rec_env;
}
```

## Stopping when nothing changed

Write `downstream_runs`, returning how many downstream nodes must run in a chain
of `n` nodes, given whether each node's output came out byte identical to what
was there before.

A node runs when the node before it produced something different. If a node's
output is unchanged, nothing after it needs to run, and the propagation stops
there. The first node always runs, because its input is what you edited.

`same[i]` is non-zero when node `i` produced an identical output. Count the
nodes that run, including the first.

@kind output
@concept Early cutoff is what a timestamp cannot express, because a timestamp
records that work happened rather than whether the result differs.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Walk forwards and stop at the first node whose output was unchanged.
@diagnose assert verdict assert-failed
A check disagrees. Editing a comment recompiles the object and produces the same
bytes, so the link does not need to happen. Counting the whole chain is what a
timestamp system does.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after On a large tree this is the difference between a rebuild you wait for and
one you do not notice.

```starter
unsigned downstream_runs(const int *same, unsigned n) {
    (void)same;
    return n;
}
```

```tests
#include <assert.h>
unsigned downstream_runs(const int *, unsigned);
int main(void) {
    /* Everything differs: the whole chain runs. */
    { int s[] = {0, 0, 0}; assert(downstream_runs(s, 3) == 3); }
    /* The first node produced identical output: nothing after it runs. */
    { int s[] = {1, 0, 0}; assert(downstream_runs(s, 3) == 1); }
    /* Cut off in the middle. */
    { int s[] = {0, 1, 0}; assert(downstream_runs(s, 3) == 2); }
    { int s[] = {0, 0, 1}; assert(downstream_runs(s, 3) == 3); }
    { int s[] = {1}; assert(downstream_runs(s, 1) == 1); }
    assert(downstream_runs(0, 0) == 0);
    return 0;
}
```

```solution
unsigned downstream_runs(const int *same, unsigned n) {
    unsigned ran = 0;
    for (unsigned i = 0; i < n; i++) {
        ran++;
        if (same[i]) break;
    }
    return ran;
}
```

## The header nobody declared

Write `edge_missing`, deciding whether a build will under-build after a header
edit, given whether the rule declares the header and whether the compiler
generated a dependency file that does.

The graph has the edge if either the rule names it or a generated dependency
file names it. Without the edge, the object does not rebuild and the binary
stops matching the source.

@kind output
@concept The compiler is the only party that knows which headers were actually
read, which is why the dependency list is a side effect of compiling rather
than something a person maintains.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Either source of the edge is enough. Only having neither is a problem.
@diagnose assert verdict assert-failed
A check disagrees. A generated dependency file supplies the edge just as well as
a hand written rule, which is the entire point of generating it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A project without generated dependencies has this bug today, and it shows
up as a header edit that changes nothing until somebody builds from clean.

```starter
int edge_missing(int rule_declares, int depfile_declares) {
    (void)depfile_declares;
    return !rule_declares;
}
```

```tests
#include <assert.h>
int edge_missing(int, int);
int main(void) {
    assert(edge_missing(1, 1) == 0);
    assert(edge_missing(1, 0) == 0);
    assert(edge_missing(0, 1) == 0);   /* the generated list supplies it */
    assert(edge_missing(0, 0) == 1);
    return 0;
}
```

```solution
int edge_missing(int rule_declares, int depfile_declares) {
    return !(rule_declares || depfile_declares);
}
```

## What infinitely many cores cannot buy

Write `critical_path`, returning the length of the longest chain of work in a
build graph, given each node's cost and the index of the node it depends on.

Node `i` depends on `dep[i]`, or on nothing when `dep[i]` is -1. A node cannot
start until what it depends on has finished. Every node's dependency has a lower
index than the node itself.

@kind output
@concept The total work is what one core takes. The critical path is what
infinitely many take, and the gap is all that parallelism can buy.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The finish time of a node is its own cost plus the finish time of what it
waits for. The answer is the largest finish time.
@diagnose assert verdict assert-failed
A check disagrees. Summing every cost gives what a single core takes, which is
the other number. Two independent chains do not add together on a wide machine.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why a header included everywhere makes a build slow on any
machine: everything waits for the same node, and no number of cores shortens a
chain.

```starter
unsigned long critical_path(const unsigned long *cost, const int *dep,
                            unsigned n) {
    (void)dep;
    unsigned long total = 0;
    for (unsigned i = 0; i < n; i++) total += cost[i];
    return total;
}
```

```tests
#include <assert.h>
unsigned long critical_path(const unsigned long *, const int *, unsigned);
int main(void) {
    /* Two independent nodes: the longer one is the answer. */
    { unsigned long c[] = {3, 5}; int d[] = {-1, -1};
      assert(critical_path(c, d, 2) == 5); }
    /* A chain of three. */
    { unsigned long c[] = {3, 5, 2}; int d[] = {-1, 0, 1};
      assert(critical_path(c, d, 3) == 10); }
    /* Two chains from one root: 4 + 9 beats 4 + 1. */
    { unsigned long c[] = {4, 1, 9}; int d[] = {-1, 0, 0};
      assert(critical_path(c, d, 3) == 13); }
    { unsigned long c[] = {7}; int d[] = {-1};
      assert(critical_path(c, d, 1) == 7); }
    assert(critical_path(0, 0, 0) == 0);
    return 0;
}
```

```solution
unsigned long critical_path(const unsigned long *cost, const int *dep,
                            unsigned n) {
    unsigned long finish[64];
    unsigned long best = 0;
    if (n > 64) return 0;
    for (unsigned i = 0; i < n; i++) {
        unsigned long start = dep[i] >= 0 ? finish[dep[i]] : 0;
        finish[i] = start + cost[i];
        if (finish[i] > best) best = finish[i];
    }
    return best;
}
```

## Which nodes may run now

Write `ready_nodes`, returning how many nodes of a build graph can start
immediately, given for each node how many of its dependencies have not finished
yet, and whether it has already been built.

A node is ready when it has not been built and nothing it depends on is
outstanding. This is the width of the graph at this moment, and it is what
limits how many cores are worth having right now.

@kind output
@concept A build system walks a graph. Everything else it does is a consequence
of which nodes are ready and which are not.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A node that is already built is not ready. It is finished.
@diagnose assert verdict assert-failed
A check disagrees. Counting nodes with no outstanding dependencies includes the
ones already built, which reports work that does not exist and, in a real
scheduler, runs it a second time.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The width changes as the build proceeds, which is why a build that starts
wide can end on one core waiting for a single link.

```starter
unsigned ready_nodes(const unsigned *outstanding, const int *built,
                     unsigned n) {
    (void)built;
    unsigned r = 0;
    for (unsigned i = 0; i < n; i++)
        if (outstanding[i] == 0) r++;
    return r;
}
```

```tests
#include <assert.h>
unsigned ready_nodes(const unsigned *, const int *, unsigned);
int main(void) {
    { unsigned o[] = {0, 0, 1}; int b[] = {0, 0, 0};
      assert(ready_nodes(o, b, 3) == 2); }
    { unsigned o[] = {0, 0, 1}; int b[] = {1, 0, 0};
      assert(ready_nodes(o, b, 3) == 1); }
    { unsigned o[] = {0, 0}; int b[] = {1, 1};
      assert(ready_nodes(o, b, 2) == 0); }
    { unsigned o[] = {2, 3}; int b[] = {0, 0};
      assert(ready_nodes(o, b, 2) == 0); }
    return 0;
}
```

```solution
unsigned ready_nodes(const unsigned *outstanding, const int *built,
                     unsigned n) {
    unsigned r = 0;
    for (unsigned i = 0; i < n; i++)
        if (!built[i] && outstanding[i] == 0) r++;
    return r;
}
```

## Naming the failure

Write `classify`, returning which kind of build failure occurred, given whether
the node was rebuilt and whether its inputs had actually changed.

Return 1 for an under-build, which is a rebuild that should have happened and
did not; 2 for an over-build, which is work that was not needed; and 0 when the
decision was right.

@kind output
@concept The words are worth having, because one of these is a slow build and
the other is a wrong program that no tool reports.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two booleans, four cases, and two of them are correct.
@diagnose assert verdict assert-failed
A check disagrees. Rebuilding something that did not need it is an over-build
and costs only time. Not rebuilding something that did need it is the silent
one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A clean build is not a fix for either. If building from scratch differs
from building incrementally, an edge is missing, and that is the thing to find.

```starter
int classify(int rebuilt, int inputs_changed) {
    (void)rebuilt;
    return inputs_changed ? 1 : 0;
}
```

```tests
#include <assert.h>
int classify(int, int);
int main(void) {
    assert(classify(1, 1) == 0);   /* changed and rebuilt */
    assert(classify(0, 0) == 0);   /* unchanged and skipped */
    assert(classify(0, 1) == 1);   /* under-build */
    assert(classify(1, 0) == 2);   /* over-build */
    return 0;
}
```

```solution
int classify(int rebuilt, int inputs_changed) {
    if (rebuilt == inputs_changed) return 0;
    return inputs_changed ? 1 : 2;
}
```
