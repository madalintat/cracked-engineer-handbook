---
needs: [syscalls, processes]
minutes: 55
one_idea: A terminal is a kernel device with settable flags sitting between your keyboard and your program, and every behaviour people call weird is that device obeying its current settings.
sources: [compilers-interpreters-terminals-unix]
---

Everyone treats the terminal as a program: the window, the thing with the font
in it. That is the emulator. The terminal your code talks to is a kernel object
with a driver, a buffer and about thirty flags, and it sits between the keyboard
and your process doing work you did not ask for and cannot see.

Once you know the flags, the behaviour stops being folklore. Every measurement
below came from opening a pseudoterminal and asking it.

## Two ends of one device

A pseudoterminal is a pair. One end, the master, is held by whatever is drawing
the window or carrying the connection. The other, the slave, is the file your
program has on descriptors 0, 1 and 2.

Between them sits the line discipline, which is kernel code, not code in either
program. It holds a buffer, it edits that buffer when you press backspace, it
copies characters back towards the screen, and it turns certain bytes into
signals. None of that is in the emulator and none of it is in your program.

So there are three participants and people usually think there are two. When a
program behaves strangely at the terminal it is almost always the middle one
doing exactly what its flags say.

```figure
{
  "kind": "blocks",
  "alt": "A keyboard feeding the master end of a pseudoterminal, the line discipline in the kernel between master and slave, and a program reading the slave end.",
  "caption": "The line discipline is kernel code between the two ends. It buffers a line, echoes what you type, and converts bytes into signals, none of which either program did.",
  "boxes": [
    { "id": "k", "x": 0,    "y": 1.6, "w": 2.8, "h": 1.1, "label": "keyboard", "accent": "copper" },
    { "id": "m", "x": 3.6,  "y": 1.6, "w": 2.8, "h": 1.1, "label": "master", "accent": "azure" },
    { "id": "d", "x": 7.2,  "y": 1.6, "w": 3.0, "h": 1.1, "label": "line discipline", "accent": "gold" },
    { "id": "p", "x": 11.0, "y": 1.6, "w": 2.8, "h": 1.1, "label": "your read", "accent": "jade" }
  ],
  "arrows": [
    { "from": "k", "to": "m" },
    { "from": "m", "to": "d" },
    { "from": "d", "to": "p" }
  ]
}
```

## Why your read does not return

Open a fresh pseudoterminal and the flag `ICANON` is set. That is canonical
mode, and it means the line discipline collects bytes until it sees a newline
before letting any of them through.

Write `hello` into the master end and then ask whether the slave has anything
readable. It does not. Write one more byte, a newline, and the slave becomes
readable and returns `hello\n`, all six bytes at once.

Which explains the thing every beginner hits. A program that wants a single
keypress writes a read, presses a key, and nothing happens. The read is correct
and the key was delivered. It is sitting in a kernel buffer waiting for a
newline, and the program will not see it until one arrives.

Canonical mode is also where line editing lives. Backspace works before your
program runs because the discipline is holding the line and can take a character
back off it. The byte it treats as erase is 0x7f on this machine, which is
delete rather than backspace, and that mismatch is the origin of a whole genre of
terminal configuration.

## The characters you did not print

Open another pseudoterminal, write `abc\n` into the master, and start no program
at all. Read the master back and you get `abc\r\n`.

Nobody printed that. There is no process on the slave end. The echo is the line
discipline copying input back towards the display because `ECHO` is set, and it
happens whether or not anything is reading.

That is why a password prompt has to turn a flag off rather than avoid printing
something. The program was never printing the password in the first place. It
clears `ECHO`, reads, and sets it back, and if it crashes in between your shell
stays silent until you fix it by hand.

## Enter is not a newline

The key sends carriage return, 0x0D. Programs expect line feed, 0x0A. The
conversion is another flag.

Write 0x0D into the master and read the slave: it returns 0x0A. That is `ICRNL`,
which is on by default, translating input carriage returns to newlines.

The reverse happens on output. A program writes `line\n`, five bytes ending in
0x0A, and the master receives `line\r\n`, six bytes. That is `ONLCR` under
`OPOST`, translating a newline into carriage return and newline on the way out.

So the terminal you are talking to speaks carriage return and your program speaks
newline, and neither of them knows, because the kernel is translating in both
directions. Turn the output side off and every line after the first starts where
the previous one ended, which is the staircase effect people recognise without
knowing its cause.

## The interrupt that is a byte first

Pressing Ctrl-C sends the byte 0x03. Nothing about that byte is special to the
hardware or to your program.

The line discipline holds a table of control characters, and on this machine the
entry for interrupt is 0x03, for end of file 0x04, for suspend 0x1a and for quit
0x1c. When `ISIG` is set and one of those bytes arrives, the discipline raises
the corresponding signal at the foreground process group rather than delivering
the byte.

Both halves are measurable. Give a child a controlling terminal with the default
flags, write 0x03, and the child dies of signal 2, which is `SIGINT`. Clear
`ISIG` on the same terminal, write the same byte, and the child reads it: an
ordinary byte with value 3, and no signal anywhere.

Which is why Ctrl-C does not work in some programs. They cleared the flag, so the
byte reaches them and they decide what it means. And it is why Ctrl-C reaches a
program that ignored `SIGINT` as nothing at all: the discipline raised the signal
correctly and the target threw it away.

## Turning all of it off

Raw mode is not a mode in the kernel. It is a name for clearing the flags above
in one go.

Put a pseudoterminal into raw mode and measure what changed: `ICANON` cleared,
`ECHO` cleared, `ISIG` cleared, `ICRNL` cleared, and `OPOST` cleared, which
disables the output translation as a whole. Write one byte with no newline and
the read returns immediately with that byte. Have the program write `line\n` and
the master receives exactly five bytes, with no carriage return added.

That is the deal an editor or a full-screen program takes. It gets every
keystroke the instant it arrives, and in exchange it owns everything: echoing
what you type, handling backspace, noticing that 0x03 means you want out, and
emitting carriage returns itself. What it draws with that control is escape
sequences, which are ordinary bytes the emulator interprets rather than prints.

Two more settings decide what immediately means. `VMIN` and `VTIME` are one and
zero by default, which says a read returns as soon as one byte exists and never
times out. Raising `VMIN` makes a read wait for that many bytes, and setting
`VTIME` gives it a deadline in tenths of a second, which is how a program
distinguishes an escape key pressed alone from an escape sequence still arriving.

## Where the size of the window lives

The width and height are not the emulator's private business and they are not an
environment variable, whatever your shell suggests. They are fields in the kernel
device.

A fresh pseudoterminal reports zero rows and zero columns, because nothing has
told it. Set 40 rows by 132 columns on the master and ask the slave: it reports
40 by 132. One number, two ends, held between them by the driver.

That is the mechanism behind resizing. The emulator sets the new size on its
end, the kernel stores it and raises `SIGWINCH` at the foreground process group,
and a program that cares asks the device for the new value. A program that does
not care carries on drawing at the old width, which is why some output stays
broken until you rerun it.

## What to carry forward

The terminal your program talks to is a kernel device, and the line discipline
between the two ends is doing the buffering, the echoing, the translation and the
signal generation.

Canonical mode holds your input until a newline, which is why a read for one
keypress does not return. Echo happens with no program involved. Input carriage
returns become newlines and output newlines become carriage return and newline,
in the kernel, in both directions.

Ctrl-C is the byte 0x03 turned into a signal by a flag that can be cleared, and
raw mode is clearing that flag along with the rest. The window size is a pair of
numbers in the driver, and a signal tells you they changed.

## Reading the errors you are about to see

These model the line discipline rather than opening a real terminal, because a
test that needs a controlling terminal is a test that does not run under most
build systems.

`assert-failed` names the behaviour your model got wrong. Several exercises
assert that a read returns nothing, which is the point of canonical mode rather
than a hang in the test.
