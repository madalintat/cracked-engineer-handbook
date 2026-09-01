## Who expands a glob?

- [x] The shell, before the program starts
- [ ] The program, using a library function
- [ ] The kernel, during execve
- [ ] The filesystem, when the path is opened

@why Which is why every program agrees about globbing without any of them
implementing it, and why a program wanting the pattern makes you quote it.

## What does the argument vector contain for a pattern matching three files?

- [x] Three arguments, one per file
- [ ] One argument, the pattern
- [ ] Four arguments, the pattern and the files
- [ ] One argument, the files joined by spaces

@why Measured with a program that prints its own arguments. By the time it runs
there is no pattern anywhere.

## Why does a directory with very many files produce an argument list too long?

- [x] The limit is on the vector the shell is building
- [ ] The program cannot allocate that many strings
- [ ] The filesystem cannot list that many names
- [ ] The kernel refuses to open that many files

@why The program never gets far enough to have an opinion, because the failure is
in handing the vector over.

## A pattern matches nothing. What happens?

- [x] It depends on the shell: one passes the literal through, another refuses to run
- [ ] Every shell passes the literal through
- [ ] Every shell refuses to run
- [ ] The command runs with no argument in its place

@why Measured: bash passes `*.nope` through as an argument and zsh reports no
matches found. Both are defensible policy decided in the gap.

## When does word splitting happen?

- [x] After variable substitution, on the result
- [ ] Before substitution, on the literal text
- [ ] Inside the program, on its arguments
- [ ] Only for values containing a glob character

@why Which is exactly why a filename with a space breaks a script written
without quotes.

## What does quoting a variable reference do?

- [x] Skips the splitting step, so the value arrives as one argument
- [ ] Prevents the substitution
- [ ] Escapes any special characters in the value
- [ ] Nothing, unless the value contains a glob

@why A value of three words gives three arguments unquoted and one quoted, which
the argument printer confirms directly.

## Where does a redirection appear in the argument vector?

- [x] Nowhere
- [ ] As two arguments, the operator and the target
- [ ] As one argument, the whole phrase
- [ ] As an extra entry after the last argument

@why It is an instruction to the shell, and instructions to the shell do not
survive into the vector.

## A command that does not exist is redirected into a file. What happens to the file?

- [x] It is created and left empty, because the open happened first
- [ ] Nothing; the command failed before anything opened
- [ ] It keeps its old contents
- [ ] It is created only if the shell reports no error

@why That ordering is why a failing command still truncates its output file, and
why reading and writing the same file in one command destroys it.

## In the gap between fork and exec, what is the child?

- [x] Still the shell, running shell code
- [ ] Already the requested program
- [ ] A stub the kernel provides
- [ ] An empty process with no code

@why It opens the redirections, moves descriptors, sets its process group and
restores signal handling, and only then calls execve.

## Why does redirection need no cooperation from the program?

- [x] The program writes to descriptor 1 and somebody else decided what it refers to
- [ ] Programs are compiled with redirection support
- [ ] The kernel intercepts writes and reroutes them
- [ ] The shell rewrites the program's output afterwards

@why Which is the whole reason the mechanism composes with every program ever
written, including ones older than the shell you are using.

## How many processes does a three-stage pipeline create?

- [x] Three, running at once
- [ ] One, running the stages in turn
- [ ] Two, since the shell runs the last stage itself
- [ ] Four, one per stage and one to coordinate

@why Counted directly while it ran. The second stage consumes while the first is
still producing, which is why a slow filter still shows output early.

## What is the exit status of a pipeline?

- [x] The last stage's
- [ ] The first failure's
- [ ] The largest of the stages'
- [ ] Zero if any stage succeeded

@why Measured: false into true gives 0 and exit 7 into exit 9 gives 9, so a
script can report success after the important half failed.

## Why can cd not be a separate program?

- [x] The working directory is per-process state and there is no call to change another process's
- [ ] It would be too slow to fork for it
- [ ] The shell needs to update its prompt
- [ ] Programs are not permitted to change directory

@why A child shell that changes directory reports the new one while the parent
still reports the old one.

## Why can a script not change your shell's directory?

- [x] Running it forks, and sourcing it does not
- [ ] Scripts are denied that permission
- [ ] The change is undone when the script exits
- [ ] Only builtins may appear in scripts

@why Same mechanism as the previous one, seen from the other side.

## Which of these does a program see after execve?

- [x] An exported variable and an inherited open descriptor
- [ ] Every shell variable and every open descriptor
- [ ] Only the arguments
- [ ] Exported variables only, since descriptors are closed

@why An unexported variable was never put in the copy handed over. A descriptor
survives unless it was marked close-on-exec, which is the mechanism every
redirection depends on and a real bug class besides.
