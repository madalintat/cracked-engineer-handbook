## First definition wins

Write `resolve`, returning the index of the scope a symbol resolves to: the first
one in the ordered list that defines it.

Not the nearest. The first. That one rule decides what every reference in the
whole process calls.

@kind output
@concept Symbols resolve against one ordered list, so a library's call to its own
function can land in somebody else's library and neither is told.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Scan from the front and stop at the first hit.
@diagnose assert verdict assert-failed
A check disagrees. Searching backwards, or preferring the scope that asked, gives
the nearest definition rather than the first. The loader does neither: it walks
one list in load order and takes the first match, wherever the reference came
from.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A library calling its own `malloc` gets whichever `malloc` is first in the
global list, which may belong to something else entirely. That is not a bug in
either library, and it is the mechanism the next exercise turns into a tool.

```starter
#include <stddef.h>
int resolve(const unsigned char *defines, size_t n, size_t caller) {
    if (defines[caller]) return (int)caller;
    for (size_t i = n; i > 0; i--)
        if (defines[i - 1]) return (int)(i - 1);
    return -1;
}
```

```tests
#include <assert.h>
#include <stddef.h>
int resolve(const unsigned char *, size_t, size_t);
int main(void) {
    /* Scopes: executable, libfoo, libc. Only libc defines it. */
    unsigned char a[3] = {0, 0, 1};
    assert(resolve(a, 3, 1) == 2);
    /* Two definitions: the earlier one wins, whoever is calling. */
    unsigned char b[3] = {0, 1, 1};
    assert(resolve(b, 3, 2) == 1);
    assert(resolve(b, 3, 1) == 1);
    /* The executable defines it, so everything resolves there. */
    unsigned char c[3] = {1, 1, 1};
    assert(resolve(c, 3, 2) == 0);
    /* Nobody defines it. */
    unsigned char d[3] = {0, 0, 0};
    assert(resolve(d, 3, 0) == -1);
    return 0;
}
```

```solution
#include <stddef.h>
int resolve(const unsigned char *defines, size_t n, size_t caller) {
    (void)caller;
    for (size_t i = 0; i < n; i++)
        if (defines[i]) return (int)i;
    return -1;
}
```

## Getting in front

Write `scope_order`, building the resolution list: preloaded libraries first,
then the executable, then its libraries in load order.

Anything at the front of that list decides what every reference in the program
resolves to.

@kind output
@concept Preloading puts a definition ahead of everything, which is how a memory
checker intercepts every allocation in software nobody has the source for.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The preloads come before the executable, not after it.
@diagnose assert verdict assert-failed
A check disagrees on the order. Preloaded libraries go ahead of the executable
itself, which is what lets them intercept calls the executable makes to its own
dependencies. Placing them after the executable would let them intercept nothing
the executable defines.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A test replaces a clock, a tracer wraps every network call, a checker
counts every allocation, none of it requiring a recompile. The technique needs
one more thing to be useful rather than merely destructive, which is the next
exercise.

```starter
#include <stddef.h>
size_t scope_order(size_t n_preload, size_t n_lib, int *out) {
    size_t k = 0;
    out[k++] = -1;
    for (size_t i = 0; i < n_preload; i++) out[k++] = (int)i;
    for (size_t i = 0; i < n_lib; i++) out[k++] = 100 + (int)i;
    return k;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t scope_order(size_t, size_t, int *);
int main(void) {
    int out[8];
    /* Two preloads, the executable, three libraries. */
    size_t n = scope_order(2, 3, out);
    assert(n == 6);
    assert(out[0] == 0);
    assert(out[1] == 1);
    assert(out[2] == -1);     /* the executable */
    assert(out[3] == 100);
    assert(out[5] == 102);
    /* No preloads: the executable is first. */
    n = scope_order(0, 2, out);
    assert(n == 3);
    assert(out[0] == -1);
    assert(out[1] == 100);
    return 0;
}
```

```solution
#include <stddef.h>
size_t scope_order(size_t n_preload, size_t n_lib, int *out) {
    size_t k = 0;
    for (size_t i = 0; i < n_preload; i++) out[k++] = (int)i;
    out[k++] = -1;
    for (size_t i = 0; i < n_lib; i++) out[k++] = 100 + (int)i;
    return k;
}
```

## Finding the one you replaced

Write `next_definition`, which continues the search from after a given scope: the
first definition strictly later in the list.

An interposing wrapper almost always wants to call the original, and this is how
it finds it.

@kind output
@concept Interposition that could only replace would be far less useful than one
that can observe, and continuing the search is what makes the difference.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Start one past the current scope rather than at the beginning.
@diagnose assert verdict assert-failed
A check disagrees, and it will be the case where the current scope defines the
symbol. Starting from the beginning finds the wrapper itself, which calls itself,
which recurses until the stack is gone. The search has to begin strictly after.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A wrapper that starts the search from the front is the classic
interposition bug: it finds itself, calls itself, and the program dies in a stack
overflow with a backtrace that is one function repeated four thousand times.

```starter
#include <stddef.h>
int next_definition(const unsigned char *defines, size_t n, size_t after) {
    for (size_t i = 0; i < n; i++)
        if (defines[i]) return (int)i;
    return -1;
}
```

```tests
#include <assert.h>
#include <stddef.h>
int next_definition(const unsigned char *, size_t, size_t);
int main(void) {
    /* The preload at 0 and libc at 3 both define it. */
    unsigned char a[4] = {1, 0, 0, 1};
    /* From the wrapper's own scope, the next one is libc. */
    assert(next_definition(a, 4, 0) == 3);
    /* From later than both, nothing follows. */
    assert(next_definition(a, 4, 3) == -1);
    /* Three definitions: each search finds the next. */
    unsigned char b[4] = {1, 1, 0, 1};
    assert(next_definition(b, 4, 0) == 1);
    assert(next_definition(b, 4, 1) == 3);
    return 0;
}
```

```solution
#include <stddef.h>
int next_definition(const unsigned char *defines, size_t n, size_t after) {
    for (size_t i = after + 1; i < n; i++)
        if (defines[i]) return (int)i;
    return -1;
}
```

## Where the mechanism stops

Write `preload_honoured`, reporting whether the loader will act on a preload
request for a process with the given privilege situation.

A program running with elevated privileges ignores the variable entirely.

@kind output
@concept The same flexibility that makes interposition useful makes it an attack,
and the boundary is where the program stops belonging to whoever started it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The question is whether the program gained privileges it was not started
with.
@diagnose assert verdict assert-failed
A check disagrees. A program running as root because root started it is still
under that user's control and honours the variable; one that gained privileges
from its file's permissions is not, and ignores it. The distinction is the
elevation rather than the resulting privilege level.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after An attacker who can set an environment variable would otherwise choose
what a privileged program's every call resolves to. The same reasoning applies to
the compiled-in search paths, which is why a binary trusting a directory a user
can write to has the problem without needing the variable at all.

```starter
int preload_honoured(int running_as_root, int gained_privilege) {
    (void)gained_privilege;
    return !running_as_root;
}
```

```tests
#include <assert.h>
int preload_honoured(int, int);
int main(void) {
    /* An ordinary user's program. */
    assert(preload_honoured(0, 0) == 1);
    /* Root's own shell running a program: still root's choice. */
    assert(preload_honoured(1, 0) == 1);
    /* A program that elevated itself: ignored. */
    assert(preload_honoured(1, 1) == 0);
    assert(preload_honoured(0, 1) == 0);
    return 0;
}
```

```solution
int preload_honoured(int running_as_root, int gained_privilege) {
    (void)running_as_root;
    return !gained_privilege;
}
```

## Exporting less

Write `exported`, reporting whether a symbol appears in a library's dynamic table,
given the default visibility setting and any explicit marking.

A library exports everything by default, which is usually far more than its
interface.

@kind output
@concept Hiding by default and marking the interface removes symbol collisions
entirely, shrinks the table, and speeds up every lookup.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint An explicit marking overrides the default, in both directions.
@diagnose assert verdict assert-failed
A check disagrees. An explicit visibility attribute wins over the default
whichever way each points, so a symbol marked visible is exported from a library
that hides by default, and one marked hidden is not exported from a library that
does not.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A library that hides by default starts faster, has a smaller dynamic
table, and cannot be broken by a name it never meant to publish. The last of
those is the one worth the flag: it removes a whole category of silent failure
rather than making one faster.

```starter
/* explicit: -1 unmarked, 0 marked hidden, 1 marked visible. */
int exported(int default_hidden, int explicit_marking) {
    (void)explicit_marking;
    return !default_hidden;
}
```

```tests
#include <assert.h>
int exported(int, int);
int main(void) {
    /* Default visible, unmarked: exported. */
    assert(exported(0, -1) == 1);
    /* Default hidden, unmarked: not exported. */
    assert(exported(1, -1) == 0);
    /* Marked visible wins over a hiding default. */
    assert(exported(1, 1) == 1);
    /* Marked hidden wins over a visible default. */
    assert(exported(0, 0) == 0);
    return 0;
}
```

```solution
/* explicit: -1 unmarked, 0 marked hidden, 1 marked visible. */
int exported(int default_hidden, int explicit_marking) {
    if (explicit_marking >= 0) return explicit_marking;
    return !default_hidden;
}
```

## Two libraries, one name

Write `collision_reported`, reporting whether the loader tells anybody when two
loaded libraries define the same symbol.

@kind output
@concept The collision is resolved silently by the first-wins rule, which is why
the symptom is behaviour changing when an unrelated dependency is added.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The answer does not depend on how many definitions there are.
@diagnose assert verdict assert-failed
A check disagrees. Nothing is reported at any count, because the rule that picks
one is the ordinary resolution rule rather than an error condition. A duplicate
at static link time is an error; a duplicate across shared libraries is a
decision.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The symptoms are behaviour changing when an unrelated dependency is added
and an ordering that differs between machines, which is a long way from the
cause. Hiding internal symbols removes the category, and it is the practical
argument for doing it.

```starter
int collision_reported(int definition_count) {
    return definition_count > 1;
}
```

```tests
#include <assert.h>
int collision_reported(int);
int main(void) {
    assert(collision_reported(1) == 0);
    /* Two definitions: one is chosen and nothing is said. */
    assert(collision_reported(2) == 0);
    assert(collision_reported(5) == 0);
    assert(collision_reported(0) == 0);
    return 0;
}
```

```solution
int collision_reported(int definition_count) {
    (void)definition_count;
    return 0;
}
```

## Loading with the door shut

Write `plugin_can_shadow`, reporting whether a library loaded at run time can
shadow the host program's functions, given whether it was loaded with its symbols
kept local.

A plugin's symbols enter the same ordered scope unless you say otherwise.

@kind output
@concept A plugin loaded into the global scope participates in first-wins
resolution, which is rarely what a host program intended.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Local symbols are visible only through the handle the loader returned.
@diagnose assert verdict assert-failed
A check disagrees. Keeping the symbols local means nothing outside the plugin can
resolve against them, so it cannot shadow anything however early it was loaded.
Loading into the global scope is what allows the shadowing, and it is the default.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Local is the sensible default for anything untrusted, and it is not the
loader's default. A program loading two plugins that happen to share a helper
name into the global scope gets the first-wins behaviour between them, with the
outcome depending on load order.

```starter
int plugin_can_shadow(int loaded_local, int loaded_before_host) {
    (void)loaded_local;
    return loaded_before_host;
}
```

```tests
#include <assert.h>
int plugin_can_shadow(int, int);
int main(void) {
    /* Global scope: it participates in resolution. */
    assert(plugin_can_shadow(0, 1) == 1);
    /* Local: invisible to everything but the handle. */
    assert(plugin_can_shadow(1, 1) == 0);
    assert(plugin_can_shadow(1, 0) == 0);
    /* Global but loaded after the host resolved its own names. */
    assert(plugin_can_shadow(0, 0) == 0);
    return 0;
}
```

```solution
int plugin_can_shadow(int loaded_local, int loaded_before_host) {
    if (loaded_local) return 0;
    return loaded_before_host;
}
```

## What the compiler could not assume

Write `inlinable`, reporting whether a call can be inlined, given whether the
callee is in the same translation unit, in a static archive linked together, or
in a shared library.

The call overhead is small. The optimisation that did not happen is not.

@kind output
@concept A function in another shared library cannot be inlined and nothing about
it can be assumed, which is a larger cost than the indirect call itself.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Link-time optimisation reaches across things linked together and not across
a shared library boundary.
@diagnose assert verdict assert-failed
A check disagrees. Code in a static archive can be inlined when link-time
optimisation is on, because the compiler still has the bodies at the moment the
program is assembled. A shared library's bodies are not there at any point the
compiler runs.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A small accessor that would have vanished entirely becomes a real call
with real argument setup. That is why the same code can be meaningfully faster in
a static build, and why the measurement to make is the optimisation that did not
happen rather than the call overhead.

```starter
/* where: 0 same unit, 1 static archive, 2 shared library. */
int inlinable(int where, int lto_enabled) {
    (void)lto_enabled;
    return where == 0;
}
```

```tests
#include <assert.h>
int inlinable(int, int);
int main(void) {
    /* Same translation unit: always. */
    assert(inlinable(0, 0) == 1);
    assert(inlinable(0, 1) == 1);
    /* Static archive: only with link-time optimisation. */
    assert(inlinable(1, 0) == 0);
    assert(inlinable(1, 1) == 1);
    /* Shared library: never, whatever the flags. */
    assert(inlinable(2, 0) == 0);
    assert(inlinable(2, 1) == 0);
    return 0;
}
```

```solution
/* where: 0 same unit, 1 static archive, 2 shared library. */
int inlinable(int where, int lto_enabled) {
    if (where == 0) return 1;
    if (where == 1) return lto_enabled;
    return 0;
}
```
