## What sits between the emulator and your program?

- [x] The line discipline, which is kernel code
- [ ] Nothing; they are connected directly
- [ ] A library in your process
- [ ] The shell

@why It holds a buffer, edits it, echoes it, and turns certain bytes into
signals, and neither program did any of that.

## In canonical mode, when does a read return?

- [x] When a newline reaches the buffer
- [ ] As soon as any byte arrives
- [ ] After a short timeout
- [ ] When the buffer is full

@why Which is why a program asking for one keypress appears to hang. The key was
delivered and it is waiting in a kernel buffer.

## Why does backspace work before your program runs?

- [x] The discipline holds the line and can take a character back off it
- [ ] The emulator deletes the character locally
- [ ] The shell intercepts it
- [ ] The keyboard sends a correction sequence

@why And on this machine the byte it treats as erase is 0x7f, which is delete
rather than backspace.

## A pseudoterminal with no process attached receives four bytes of input. What comes back?

- [x] Four bytes, because ECHO is set and echo does not need a reader
- [ ] Nothing, because nothing is reading
- [ ] Nothing, because nothing printed them
- [ ] Four bytes, but only after a program attaches

@why Measured directly: write abc and a newline into the master and read back
abc, a carriage return, and a newline, with no program in the picture.

## How does a program stop a password appearing on screen?

- [x] It clears ECHO, reads, and sets it back
- [ ] It avoids printing what it read
- [ ] It writes spaces over the characters
- [ ] It reads from a different descriptor

@why It was never printing the password. If it crashes between clearing and
restoring, your shell stays silent until you fix the flag by hand.

## The Enter key sends 0x0D. What does your program read by default?

- [x] 0x0A, because ICRNL translates it
- [ ] 0x0D
- [ ] Both bytes
- [ ] Whichever the emulator was configured for

@why The terminal speaks carriage return and the program speaks newline, and the
kernel translates in both directions without either one knowing.

## A program writes five bytes ending in a newline. How many reach the terminal?

- [x] Six, because ONLCR expands it
- [ ] Five
- [ ] Six, but only if the program asked for it
- [ ] It depends on the emulator

@why And turning the output translation off is what produces the staircase, where
every line starts where the previous one ended.

## Which flag has to be set for ONLCR to do anything?

- [x] OPOST
- [ ] ICANON
- [ ] ISIG
- [ ] IEXTEN

@why Raw mode clears OPOST, so the expansion stops even though ONLCR itself is
still set, which is what a raw pseudoterminal reports when measured.

## What is special about the byte 0x03 to the hardware?

- [x] Nothing; a flag and a table decide what happens to it
- [ ] The keyboard controller raises an interrupt for it
- [ ] The CPU treats it as a trap
- [ ] It is delivered on a separate channel

@why With ISIG set, a child reading a terminal dies of signal 2 when it arrives.
With ISIG clear, the same child reads a byte with value 3.

## Ctrl-C does nothing in an editor. What is the most likely reason?

- [x] The program cleared ISIG, so it receives the byte
- [ ] The emulator did not send anything
- [ ] The signal cannot reach a program in the foreground
- [ ] The terminal was in canonical mode

@why The other possibility is that the signal arrived correctly and the program
ignores SIGINT, which looks identical from outside.

## What is raw mode?

- [x] A name for clearing ICANON, ECHO, ISIG, ICRNL and OPOST together
- [ ] A separate mode in the kernel driver
- [ ] A mode where the emulator stops interpreting bytes
- [ ] Direct access to the keyboard device

@why There is no raw bit. The convenience function clears a set of flags, and
every consequence follows from which ones.

## What does a program owe the terminal once it is in raw mode?

- [x] Echoing, line editing, interpreting 0x03, and emitting carriage returns
- [ ] Nothing extra; the kernel still handles those
- [ ] Only echoing
- [ ] Restoring the flags, and nothing else

@why That is the deal: every keystroke the instant it arrives, in exchange for
doing the discipline's work yourself.

## VMIN and VTIME default to one and zero. What does that mean?

- [x] Return as soon as one byte exists, and never time out
- [ ] Return after one tenth of a second
- [ ] Return when one byte exists or a tenth of a second passes
- [ ] Block until at least one byte and one tenth of a second

@why A VTIME of zero is no timer at all rather than a timer that already expired,
which is why a read with nothing available blocks.

## What are VMIN and VTIME actually used for in a full-screen program?

- [x] Telling an escape key pressed alone from an escape sequence still arriving
- [ ] Throttling how fast input is processed
- [ ] Setting the repeat rate
- [ ] Batching writes to the screen

@why A tenth of a second is long enough for the rest of a sequence and short
enough that a lone escape key does not feel stuck.

## Where does the window size live?

- [x] In the kernel device, readable from either end
- [ ] In an environment variable
- [ ] In the emulator only
- [ ] In the shell's memory

@why A fresh pseudoterminal measures zero by zero. Set 40 by 132 on the master
and the slave reads 40 by 132, because there is one pair of numbers.
