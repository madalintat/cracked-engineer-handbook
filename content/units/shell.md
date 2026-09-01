---
needs: [processes, terminal]
minutes: 55
one_idea: Globbing, word splitting and redirection all happen in the shell before your program runs, in the gap between fork and exec, and knowing what happens in that gap explains every surprise the shell has.
sources: [compilers-interpreters-terminals-unix]
---

A shell reads a line and runs a program. Between those two things it does a
surprising amount of work, and all of it is finished before your program executes
its first instruction. Almost everything people find confusing about shells is a
consequence of where that boundary falls.

The measurements below come from a small C program that prints its own argument
vector, which is the only honest way to see what a shell handed over.

## The program never saw the asterisk

Put three files in a directory, `a.txt`, `b.txt` and `c.txt`, and run
`echo *.txt`. The program receives three arguments: `a.txt`, `b.txt` and `c.txt`.
Quote it, `echo '*.txt'`, and the program receives one argument, the literal
asterisk and suffix.

So the expansion is not a feature of `echo`. The shell read the pattern, listed
the directory, matched, sorted, and built an argument vector out of the results.
By the time `echo` runs there is no pattern left anywhere.

Which explains why every program agrees about globbing without any of them
implementing it, and why a program that wants the pattern itself, like `find`,
makes you quote it. It also explains why a directory with a great many matching
files produces an argument list too long, since the limit is on the vector the
shell is building, not on anything the program does.

## What an unmatched pattern becomes

Now run `echo *.nope` in a directory with no match. Under bash the program
receives one argument, the literal `*.nope`. Under zsh the command does not run
at all: `no matches found`.

Both are defensible and they are policy rather than mechanism. Passing the
pattern through means a script that loops over `*.log` gets one iteration with a
filename that does not exist, which is a well-known source of confusing errors.
Refusing means the same script stops.

The lesson is not which is right. It is that the shell decided, in the gap, and
the program you were running never had an opinion.

## Splitting is separate from quoting

Set a variable to `x y z` and pass it unquoted. The program receives three
arguments. Pass it quoted and the program receives one.

That is word splitting, and it happens after variable substitution, which is why
a filename with a space in it breaks a script that was written without quotes.
The shell substituted the value, then split the result on whitespace, and handed
over more arguments than anyone intended.

Quoting is the instruction to skip that step. `a\ b`, `"c d"` and `'e f'` all
arrive as single arguments with a space inside them, which the argument printer
confirms: four arguments, three of them containing spaces.

## The redirection is not an argument

Run the argument printer with `one` and a redirection of standard output. It
reports two arguments: its own name and `one`. The redirection is nowhere in the
vector.

Two measurements show when the redirection happens. Redirect to a path in a
directory that does not exist and the shell reports the failure and returns a
non-zero status, and the program never runs. Redirect the output of a command
that does not exist and the file is created anyway, empty.

Descriptor duplication behaves the same way. Run the printer with two arguments
and `2>&1` appended, and it still reports three: its name and the two arguments.
The duplication was an instruction to the shell, and instructions to the shell do
not survive into the vector.

So the file is opened first and the program is launched second. That ordering is
the reason `cmd > file` truncates the file even when `cmd` fails, and the reason
reading and writing the same file in one command destroys it: the shell truncated
it before the reader opened it.

## The gap between fork and exec

Everything above happens in one place, and it is the most useful thing to
understand about a shell.

To run a program the shell forks, producing a child that is a copy of itself. The
child is still the shell, running shell code, with the shell's descriptors and
environment. It then rearranges its own world: opens the redirections and moves
them onto descriptors 0, 1 and 2, closes what should not survive, sets its
process group so the terminal knows who is in the foreground, and restores signal
handling to the default. Only then does it call `execve`, which replaces the
program while keeping everything the child just arranged.

```figure
{
  "kind": "blocks",
  "alt": "A shell forking into a child that opens redirections, moves descriptors and sets its process group, and only then calls execve to become the requested program.",
  "caption": "The child is still the shell until execve. Every redirection, every descriptor move and the process group are arranged by shell code running in a process that is about to stop being a shell.",
  "boxes": [
    { "id": "s", "x": 0,    "y": 1.6, "w": 2.8, "h": 1.1, "label": "shell", "accent": "azure" },
    { "id": "f", "x": 3.6,  "y": 1.6, "w": 2.8, "h": 1.1, "label": "fork", "accent": "gold" },
    { "id": "g", "x": 7.2,  "y": 1.6, "w": 3.2, "h": 1.1, "label": "open, dup2, setpgid", "accent": "copper" },
    { "id": "e", "x": 11.2, "y": 1.6, "w": 2.8, "h": 1.1, "label": "execve", "accent": "jade" }
  ],
  "arrows": [
    { "from": "s", "to": "f" },
    { "from": "f", "to": "g" },
    { "from": "g", "to": "e" }
  ]
}
```

That is why redirection does not need cooperation from the program. The program
opens descriptor 1 and writes to it, exactly as it always does, and somebody else
decided what descriptor 1 refers to before it started.

## A pipeline is several processes

Run a three-stage pipeline of sleeps and count the processes while it is
running: three. The shell forked once per stage, created a pipe between each
adjacent pair, and moved the ends onto the right descriptors in each child.

Nothing waits for anything. All three run at once, and the second stage starts
consuming while the first is still producing, which is why a pipeline through a
slow filter still shows output early and why a producer stops when its consumer
stops reading.

The exit status is the surprise. Run a failing command into a succeeding one and
the status is zero. Run a succeeding command into a failing one and the status is
one. Exit 7 into exit 9 and the status is 9. The pipeline's status is the last
stage's, and every earlier failure is discarded unless you ask for it, which is
why a script with a pipeline can report success after the important half failed.

## Why cd cannot be a program

Run a child shell, have it change directory, and print the working directory in
both. The child reports the new directory and the parent reports the old one.

The working directory is per-process state. A program that changed its own and
exited would achieve nothing, and there is no call to change somebody else's. So
`cd` has to run in the shell's own process rather than in a fork, which is what
makes it a builtin.

The same reasoning explains the rest of the list. Setting a variable, exporting
it, defining a function, and changing a shell option all modify the shell, so
they cannot be programs. And it explains one of the oldest confusions, that a
script cannot change your directory unless you source it, because running it
forks and sourcing it does not.

## What crosses into the child

Two kinds of state survive `execve` and it is worth knowing which.

The environment does, but only what was exported. Set a variable and run a child
shell: it sees nothing. Export it and run the same child: it sees the value. The
distinction exists because the environment is a copy handed to the new program,
and an unexported variable was never put in it.

Open descriptors do too. Open descriptor 9 in the shell and a child can see it
open. That is the mechanism behind every redirection, and it is also the source
of a real bug class, where a long-lived daemon inherits a descriptor it never
knew about and holds a deleted file or a listening socket open indefinitely.

## What to carry forward

Globbing, word splitting and quoting are the shell's, finished before your
program starts, which is why the argument vector never contains a pattern.

A redirection is not an argument. The file is opened before the program runs,
which is why a failing command still truncates its output file.

The work happens in the gap between fork and exec, in a child that is still the
shell. A pipeline is one process per stage running concurrently, and its exit
status is the last stage's. And `cd` is a builtin because the working directory
is per-process state, along with everything else that modifies the shell itself.

## Reading the errors you are about to see

These model the expansion and the pipeline rules rather than forking real
processes, because a test that depends on process scheduling is a test that
sometimes fails for no reason.

`assert-failed` names the behaviour your model got wrong. Several exercises
assert that a pattern survives into the argument vector, which is quoting working
rather than expansion failing.
