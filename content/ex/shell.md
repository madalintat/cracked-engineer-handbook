## Building the vector

Write `argv_count`, returning how many arguments a command receives, given the
words on the line and how many files each glob matched.

A pattern that matched three files contributes three arguments.

@kind output
@concept The expansion is finished before the program starts, so the argument
count is decided by the shell and never by the program.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A quoted word contributes one whatever it looks like. An unquoted pattern
contributes its match count.
@diagnose assert verdict assert-failed
A check disagrees. A pattern that matched three files becomes three separate
arguments rather than one, and a quoted pattern is not expanded at all. Counting
the words on the line gives the shell's view rather than the program's.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Running the argument printer on three text files with a pattern gives
three arguments, and quoting the same pattern gives one. Neither result involved
the program.

```starter
unsigned long argv_count(const int *is_glob, const unsigned long *matches,
                         unsigned long words) {
    (void)is_glob; (void)matches;
    return words;
}
```

```tests
#include <assert.h>
unsigned long argv_count(const int *, const unsigned long *, unsigned long);
int main(void) {
    /* One plain word. */
    { int g[] = {0}; unsigned long m[] = {0};
      assert(argv_count(g, m, 1) == 1); }
    /* A pattern that matched three files. */
    { int g[] = {1}; unsigned long m[] = {3};
      assert(argv_count(g, m, 1) == 3); }
    /* A plain word and a pattern matching two. */
    { int g[] = {0, 1}; unsigned long m[] = {0, 2};
      assert(argv_count(g, m, 2) == 3); }
    /* Two patterns. */
    { int g[] = {1, 1}; unsigned long m[] = {3, 4};
      assert(argv_count(g, m, 2) == 7); }
    return 0;
}
```

```solution
unsigned long argv_count(const int *is_glob, const unsigned long *matches,
                         unsigned long words) {
    unsigned long n = 0;
    for (unsigned long i = 0; i < words; i++)
        n += is_glob[i] ? matches[i] : 1;
    return n;
}
```

## When nothing matches

Write `unmatched_result`, returning what a shell does with a pattern that matched
nothing, given which policy the shell follows.

Return 1 to pass the pattern through as a literal, and 0 to refuse the command.

@kind output
@concept Both behaviours are policy rather than mechanism, decided in the gap,
and the program you were running never had an opinion.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A pattern that did match is expanded under either policy. Only the empty
case differs.
@diagnose assert verdict assert-failed
A check disagrees. When the pattern matched something, both shells expand it
normally and neither refuses, so the policy only decides the empty case.
Returning the policy directly ignores the match count, which is the input the
decision actually depends on.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured on this machine: bash runs the command with the literal pattern
as an argument, and zsh reports no matches found and does not run it at all. A
script looping over log files behaves completely differently under the two, and
neither is wrong. Under the passing-through policy a loop over a pattern with no
matches runs once with a filename that does not exist, which is where the
confusing errors come from.

```starter
int unmatched_result(unsigned long match_count, int passes_through) {
    (void)match_count;
    return passes_through;
}
```

```tests
#include <assert.h>
int unmatched_result(unsigned long, int);
int main(void) {
    /* Nothing matched: the policy decides. */
    assert(unmatched_result(0, 1) == 1);
    assert(unmatched_result(0, 0) == 0);
    /* Something matched: both shells run the command. */
    assert(unmatched_result(3, 1) == 1);
    assert(unmatched_result(3, 0) == 1);
    assert(unmatched_result(1, 0) == 1);
    return 0;
}
```

```solution
int unmatched_result(unsigned long match_count, int passes_through) {
    if (match_count > 0) return 1;
    return passes_through;
}
```

## Substitute, then split

Write `expand_words`, returning how many arguments a variable substitution
produces, given the value and whether the reference was quoted.

Splitting happens after substitution, which is the whole problem.

@kind output
@concept A filename with a space breaks an unquoted script because the shell
substituted the value and then split the result, handing over more arguments than
anyone intended.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Quoted is always one, even when the value is empty. Unquoted is the number
of whitespace-separated runs.
@diagnose assert verdict assert-failed
A check disagrees. An unquoted empty value produces no argument at all rather
than one, which is why a script testing an unset variable without quotes gets a
syntax error instead of a comparison. Counting separators rather than runs also
miscounts a value with repeated spaces.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured: a variable holding three words gives three arguments unquoted
and one quoted. The quoting is the instruction to skip the splitting step, not
a style preference.

```starter
#include <string.h>
unsigned long expand_words(const char *value, int quoted) {
    if (quoted) return 1;
    unsigned long n = 1;
    for (const char *p = value; *p; p++)
        if (*p == ' ') n++;
    return n;
}
```

```tests
#include <assert.h>
unsigned long expand_words(const char *, int);
int main(void) {
    assert(expand_words("x y z", 0) == 3);
    assert(expand_words("x y z", 1) == 1);
    /* An empty value: nothing at all unquoted, one argument quoted. */
    assert(expand_words("", 0) == 0);
    assert(expand_words("", 1) == 1);
    /* Repeated and leading spaces collapse. */
    assert(expand_words("a   b", 0) == 2);
    assert(expand_words("  a b  ", 0) == 2);
    assert(expand_words("  a b  ", 1) == 1);
    return 0;
}
```

```solution
#include <string.h>
unsigned long expand_words(const char *value, int quoted) {
    if (quoted) return 1;
    unsigned long n = 0;
    int in_word = 0;
    for (const char *p = value; *p; p++) {
        if (*p == ' ') in_word = 0;
        else if (!in_word) { in_word = 1; n++; }
    }
    return n;
}
```

## Which words reach the program

Write `strip_redirections`, removing the redirection operators and their targets
from a word list and returning how many arguments are left.

A word is an operator if it is `>`, `<`, `>>` or `2>&1`.

@kind output
@concept The redirection is an instruction to the shell, and instructions to the
shell do not survive into the vector.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A duplication like `2>&1` has no target word. The others consume the word
after them.
@diagnose assert verdict assert-failed
A check disagrees. An operator with a target removes two words and a duplication
removes one, so removing a fixed number for every operator overcounts or
undercounts depending on which kind appeared. The program's own name is always
the first argument and is never removed.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured: the argument printer given one argument and a redirection
reports two arguments, and given two arguments and a descriptor duplication
reports three. Nothing about the redirection is visible from inside.

```starter
#include <string.h>
unsigned long strip_redirections(const char **words, unsigned long n) {
    unsigned long kept = 0;
    for (unsigned long i = 0; i < n; i++) {
        if (strcmp(words[i], ">") == 0 || strcmp(words[i], "<") == 0 ||
            strcmp(words[i], ">>") == 0 || strcmp(words[i], "2>&1") == 0)
            continue;
        kept++;
    }
    return kept;
}
```

```tests
#include <assert.h>
unsigned long strip_redirections(const char **, unsigned long);
int main(void) {
    { const char *w[] = {"prog", "one"};
      assert(strip_redirections(w, 2) == 2); }
    /* An operator and its target both go. */
    { const char *w[] = {"prog", "one", ">", "out.txt"};
      assert(strip_redirections(w, 4) == 2); }
    { const char *w[] = {"prog", "<", "in.txt", "one"};
      assert(strip_redirections(w, 4) == 2); }
    /* A duplication has no target. */
    { const char *w[] = {"prog", "one", "two", "2>&1"};
      assert(strip_redirections(w, 4) == 3); }
    /* Both kinds together. */
    { const char *w[] = {"prog", "a", ">", "f", "2>&1"};
      assert(strip_redirections(w, 5) == 2); }
    return 0;
}
```

```solution
#include <string.h>
unsigned long strip_redirections(const char **words, unsigned long n) {
    unsigned long kept = 0;
    for (unsigned long i = 0; i < n; i++) {
        if (strcmp(words[i], "2>&1") == 0) continue;
        if (strcmp(words[i], ">") == 0 || strcmp(words[i], "<") == 0 ||
            strcmp(words[i], ">>") == 0) { i++; continue; }
        kept++;
    }
    return kept;
}
```

## Truncated before anything ran

Write `file_after`, returning the size of a redirection target after the command
finishes, given its size before, whether the command exists, and how many bytes
it wrote.

The file is opened before the program is launched.

@kind output
@concept That ordering is why a failing command still truncates its output file,
and why reading and writing the same file in one command destroys it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Truncation happens whether or not the command exists, because the shell
opened the file first.
@diagnose assert verdict assert-failed
A check disagrees. A command that does not exist still leaves an empty file,
because the open happened in the child before the failed `execve`. Leaving the
old contents in place models a shell that launches the program first, which is
the opposite order.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured both ways: redirecting into a directory that does not exist fails
before the program runs, and redirecting the output of a command that does not
exist creates the file anyway, empty. One order explains both.

```starter
unsigned long file_after(unsigned long size_before, int command_exists,
                         unsigned long bytes_written) {
    if (!command_exists) return size_before;
    return bytes_written;
}
```

```tests
#include <assert.h>
unsigned long file_after(unsigned long, int, unsigned long);
int main(void) {
    /* A normal run: truncated, then written. */
    assert(file_after(5000, 1, 12) == 12);
    /* The command does not exist: the file is empty anyway. */
    assert(file_after(5000, 0, 0) == 0);
    /* A command that exists and writes nothing. */
    assert(file_after(5000, 1, 0) == 0);
    assert(file_after(0, 0, 0) == 0);
    return 0;
}
```

```solution
unsigned long file_after(unsigned long size_before, int command_exists,
                         unsigned long bytes_written) {
    (void)size_before;
    return command_exists ? bytes_written : 0;
}
```

## The status of a pipeline

Write `pipeline_status`, returning the exit status of a pipeline given each
stage's status.

Every earlier failure is discarded unless you ask for it.

@kind output
@concept A script with a pipeline reports success after the important half
failed, which is the default and not a bug.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The last stage's status is the pipeline's, whatever happened upstream.
@diagnose assert verdict assert-failed
A check disagrees. A failing command into a succeeding one gives zero, because
the status comes from the last stage alone rather than from the worst or the
first failure. Taking the maximum is the behaviour you usually want and not the
behaviour you get.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured: false into true gives 0, true into false gives 1, and exit 7
into exit 9 gives 9. The shells offer an option that reports the first failure
instead, and it is off by default in both.

```starter
int pipeline_status(const int *stages, unsigned long n) {
    int worst = 0;
    for (unsigned long i = 0; i < n; i++)
        if (stages[i] > worst) worst = stages[i];
    return worst;
}
```

```tests
#include <assert.h>
int pipeline_status(const int *, unsigned long);
int main(void) {
    /* false | true */
    { int s[] = {1, 0}; assert(pipeline_status(s, 2) == 0); }
    /* true | false */
    { int s[] = {0, 1}; assert(pipeline_status(s, 2) == 1); }
    /* exit 7 | exit 9 */
    { int s[] = {7, 9}; assert(pipeline_status(s, 2) == 9); }
    /* Three stages, the middle one failing. */
    { int s[] = {0, 3, 0}; assert(pipeline_status(s, 3) == 0); }
    { int s[] = {5}; assert(pipeline_status(s, 1) == 5); }
    return 0;
}
```

```solution
int pipeline_status(const int *stages, unsigned long n) {
    return n ? stages[n - 1] : 0;
}
```

## What has to run in the shell itself

Write `must_be_builtin`, deciding whether a command has to run in the shell's own
process, given what state it modifies.

A program that changed its own copy and exited would achieve nothing.

@kind output
@concept The working directory, the variables and the shell's options are all
state a forked child cannot change on the parent's behalf.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The question is whether the effect has to be visible in the parent after
the command finishes.
@diagnose assert verdict assert-failed
A check disagrees. Something that only reads shell state, like printing the
working directory, works perfectly well as a separate program, so modifying is
the condition rather than touching. That is why one of the two commands in the
tests exists both ways on a real system.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured: a child shell that changes directory reports the new one and the
parent still reports the old one. It is also why a script cannot change your
directory unless you source it, because running it forks and sourcing it does not.

```starter
int must_be_builtin(int reads_shell_state, int modifies_shell_state) {
    (void)modifies_shell_state;
    return reads_shell_state;
}
```

```tests
#include <assert.h>
int must_be_builtin(int, int);
int main(void) {
    /* cd: reads and modifies. */
    assert(must_be_builtin(1, 1) == 1);
    /* export: modifies. */
    assert(must_be_builtin(0, 1) == 1);
    /* pwd: reads only, and exists as a program. */
    assert(must_be_builtin(1, 0) == 0);
    /* ls: neither. */
    assert(must_be_builtin(0, 0) == 0);
    return 0;
}
```

```solution
int must_be_builtin(int reads_shell_state, int modifies_shell_state) {
    (void)reads_shell_state;
    return modifies_shell_state;
}
```

## What the new program starts with

Write `child_sees`, deciding whether a piece of state is visible to a program
after `execve`, given whether it is an exported variable, an unexported one, or an
open descriptor.

Two kinds of state survive and one does not.

@kind output
@concept An unexported variable was never put in the copy handed to the new
program, and an open descriptor survives unless somebody arranged otherwise.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The environment is a copy, and only exported variables are in it.
Descriptors are in the process, and stay open across the replacement.
@diagnose assert verdict assert-failed
A check disagrees. A descriptor stays open across `execve` unless it was marked
close-on-exec, so the default for a plain open is that the child inherits it.
Treating descriptors like unexported variables misses the mechanism every
redirection depends on.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured: a variable set but not exported is empty in a child shell, and
the same variable after exporting has its value. A descriptor opened in the shell
is visible as open in the child. That inheritance is also a real bug class, where
a daemon holds a deleted file or a listening socket it never knew it had.

```starter
int child_sees(int is_variable, int exported, int close_on_exec) {
    (void)close_on_exec;
    return is_variable ? exported : 0;
}
```

```tests
#include <assert.h>
int child_sees(int, int, int);
int main(void) {
    /* An exported variable. */
    assert(child_sees(1, 1, 0) == 1);
    /* An unexported one. */
    assert(child_sees(1, 0, 0) == 0);
    /* A plain descriptor: inherited. */
    assert(child_sees(0, 0, 0) == 1);
    /* One marked close-on-exec. */
    assert(child_sees(0, 0, 1) == 0);
    return 0;
}
```

```solution
int child_sees(int is_variable, int exported, int close_on_exec) {
    if (is_variable) return exported;
    return !close_on_exec;
}
```
