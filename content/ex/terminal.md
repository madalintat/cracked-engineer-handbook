## Nothing until the newline

Write `readable_bytes`, returning how many bytes a read on the slave end can
return, given what is in the line discipline's buffer and whether `ICANON` is
set.

In canonical mode nothing leaves the buffer until a newline arrives.

@kind output
@concept A read for one keypress does not return because the byte is sitting in a
kernel buffer waiting for a newline, not because the key was lost.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Canonical mode returns everything up to and including the first newline,
or nothing at all.
@diagnose assert verdict assert-failed
A check disagrees. With `ICANON` set the answer is zero until a newline is in the
buffer, and then it is the length of the line including that newline. Returning
the buffer length ignores the buffering entirely, which is the behaviour of the
other mode.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Five bytes in the buffer and no newline reads as nothing. Add the newline
and all six arrive at once, which is what a fresh pseudoterminal does when you
measure it.

```starter
#include <string.h>
unsigned long readable_bytes(const char *buf, unsigned long len, int icanon) {
    (void)icanon;
    return len;
}
```

```tests
#include <assert.h>
unsigned long readable_bytes(const char *, unsigned long, int);
int main(void) {
    /* Canonical, no newline: nothing is readable. */
    assert(readable_bytes("hello", 5, 1) == 0);
    /* Canonical, a newline: the whole line including it. */
    assert(readable_bytes("hello\n", 6, 1) == 6);
    /* Only the first line. */
    assert(readable_bytes("ab\ncd\n", 6, 1) == 3);
    /* Not canonical: whatever is there. */
    assert(readable_bytes("hello", 5, 0) == 5);
    assert(readable_bytes("", 0, 0) == 0);
    return 0;
}
```

```solution
#include <string.h>
unsigned long readable_bytes(const char *buf, unsigned long len, int icanon) {
    if (!icanon) return len;
    for (unsigned long i = 0; i < len; i++)
        if (buf[i] == '\n') return i + 1;
    return 0;
}
```

## The erase byte

Write `apply_erase`, applying the discipline's line editing to a buffer, given
the byte it treats as erase.

Editing happens in the kernel before any program sees the line.

@kind output
@concept Backspace works before your program runs because the discipline holds
the line and can take a character off it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint An erase byte removes the previous character and itself. Erasing an empty
buffer removes nothing.
@diagnose assert verdict assert-failed
A check disagrees. The erase byte never appears in the result and neither does
the character before it, so two erases in a row on one character leave nothing
rather than a negative length. Copying the erase byte through models a program
that receives it, which only happens with the flag cleared.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after On this machine the erase byte is 0x7f, which is delete rather than
backspace. That mismatch is why a terminal configured for one and a program
expecting the other produces a key that prints a strange character instead of
deleting.

```starter
unsigned long apply_erase(const char *in, unsigned long len,
                          char erase, char *out) {
    unsigned long n = 0;
    for (unsigned long i = 0; i < len; i++) {
        (void)erase;
        out[n++] = in[i];
    }
    return n;
}
```

```tests
#include <assert.h>
#include <string.h>
unsigned long apply_erase(const char *, unsigned long, char, char *);
int main(void) {
    char out[32];
    unsigned long n;
    n = apply_erase("abc", 3, 0x7f, out);
    assert(n == 3 && memcmp(out, "abc", 3) == 0);
    n = apply_erase("abc\x7f", 4, 0x7f, out);
    assert(n == 2 && memcmp(out, "ab", 2) == 0);
    n = apply_erase("ab\x7f" "\x7f" "c", 5, 0x7f, out);
    assert(n == 1 && memcmp(out, "c", 1) == 0);
    /* Erasing nothing. */
    n = apply_erase("\x7f\x7f", 2, 0x7f, out);
    assert(n == 0);
    return 0;
}
```

```solution
unsigned long apply_erase(const char *in, unsigned long len,
                          char erase, char *out) {
    unsigned long n = 0;
    for (unsigned long i = 0; i < len; i++) {
        if (in[i] == erase) { if (n) n--; }
        else out[n++] = in[i];
    }
    return n;
}
```

## Bytes nobody printed

Write `echo_bytes`, returning how many bytes travel back towards the display when
input arrives, given the input length and whether `ECHO` is set.

There need not be a program on the other end at all.

@kind output
@concept The echo is the line discipline copying input back, which is why a
password prompt clears a flag rather than avoiding a print.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint With the flag set every input byte comes back. With it clear, none do,
whatever a program does.
@diagnose assert verdict assert-failed
A check disagrees. Echo depends only on the flag, not on whether anything is
reading the terminal, so an unattended pseudoterminal still echoes. Making the
answer depend on a reader models the program doing the printing, which it never
was.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Writing three characters and a newline into a pseudoterminal with no
process attached to it returns four bytes on the other end. Nobody printed them.

```starter
unsigned long echo_bytes(unsigned long input_len, int echo_flag,
                         int reader_present) {
    (void)echo_flag;
    return reader_present ? input_len : 0;
}
```

```tests
#include <assert.h>
unsigned long echo_bytes(unsigned long, int, int);
int main(void) {
    /* No reader at all, and the bytes still come back. */
    assert(echo_bytes(4, 1, 0) == 4);
    assert(echo_bytes(4, 1, 1) == 4);
    /* Flag cleared: nothing, whoever is reading. */
    assert(echo_bytes(4, 0, 1) == 0);
    assert(echo_bytes(4, 0, 0) == 0);
    return 0;
}
```

```solution
unsigned long echo_bytes(unsigned long input_len, int echo_flag,
                         int reader_present) {
    (void)reader_present;
    return echo_flag ? input_len : 0;
}
```

## What the key sends and what you read

Write `translate_input`, applying `ICRNL` to a byte arriving from the terminal.

The key sends carriage return and the program expects a newline.

@kind output
@concept The translation is in the kernel, so the terminal speaks carriage return
and the program speaks newline and neither of them knows.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Only 0x0D changes, and only when the flag is set.
@diagnose assert verdict assert-failed
A check disagrees. The flag translates carriage return to newline on input and
leaves every other byte alone, including a newline that was already a newline.
Translating in the other direction is what the output flag does.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Write 0x0D into a pseudoterminal and the program reads 0x0A. Clear the
flag and it reads 0x0D, which is why some programs see a line that never seems
to end.

```starter
int translate_input(int byte, int icrnl) {
    (void)icrnl;
    if (byte == '\n') return '\r';
    return byte;
}
```

```tests
#include <assert.h>
int translate_input(int, int);
int main(void) {
    assert(translate_input('\r', 1) == '\n');
    assert(translate_input('\r', 0) == '\r');
    assert(translate_input('\n', 1) == '\n');
    assert(translate_input('a', 1) == 'a');
    assert(translate_input(0x03, 1) == 0x03);
    return 0;
}
```

```solution
int translate_input(int byte, int icrnl) {
    if (icrnl && byte == '\r') return '\n';
    return byte;
}
```

## What you write and what the screen gets

Write `output_bytes`, returning how many bytes reach the terminal when a program
writes a buffer, given whether `OPOST` and `ONLCR` are set.

Each newline becomes two bytes on the way out.

@kind output
@concept The output translation is the other half of the same mechanism, and
turning it off is what produces the staircase effect.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Both flags have to be set for the expansion to happen, since `ONLCR` acts
under `OPOST`.
@diagnose assert verdict assert-failed
A check disagrees. Raw mode clears `OPOST`, and with it cleared the newline
expansion does not happen even though `ONLCR` is still set in the flags, which is
exactly what a pseudoterminal reports when you measure it.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A program writes five bytes ending in a newline and the terminal receives
six. In raw mode it receives five, and every line after the first starts where
the previous one ended unless the program emits the carriage return itself.

```starter
unsigned long output_bytes(const char *buf, unsigned long len,
                           int opost, int onlcr) {
    (void)opost;
    unsigned long n = len;
    for (unsigned long i = 0; i < len; i++)
        if (buf[i] == '\n' && onlcr) n++;
    return n;
}
```

```tests
#include <assert.h>
unsigned long output_bytes(const char *, unsigned long, int, int);
int main(void) {
    /* Both set: the newline expands. */
    assert(output_bytes("line\n", 5, 1, 1) == 6);
    /* Post-processing off: no expansion, whatever ONLCR says. */
    assert(output_bytes("line\n", 5, 0, 1) == 5);
    assert(output_bytes("line\n", 5, 0, 0) == 5);
    /* Post-processing on, expansion off. */
    assert(output_bytes("line\n", 5, 1, 0) == 5);
    /* Two newlines. */
    assert(output_bytes("a\nb\n", 4, 1, 1) == 6);
    return 0;
}
```

```solution
unsigned long output_bytes(const char *buf, unsigned long len,
                           int opost, int onlcr) {
    unsigned long n = len;
    if (opost && onlcr)
        for (unsigned long i = 0; i < len; i++)
            if (buf[i] == '\n') n++;
    return n;
}
```

## A byte, or a signal

Write `dispatch_byte`, deciding what the line discipline does with an incoming
byte, given the control character table and whether `ISIG` is set.

Return the signal number to raise, or zero to mean deliver the byte.

@kind output
@concept Nothing about 0x03 is special to the hardware or to your program. A flag
decides whether it becomes a signal or arrives as an ordinary byte.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint With the flag clear, every byte is delivered, including the ones in the
table.
@diagnose assert verdict assert-failed
A check disagrees. Clearing `ISIG` does not change the table, it stops the
discipline consulting it, so 0x03 arrives as a byte with value 3. Checking the
byte before the flag gets that case backwards.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Measured on a real pseudoterminal, a child with the default flags dies of
signal 2 when 0x03 arrives, and the same child on a terminal with `ISIG` cleared
reads a byte with value 3. Same byte, same child, different flag.

```starter
int dispatch_byte(int byte, int isig, int vintr, int vsusp, int vquit) {
    (void)isig;
    if (byte == vintr) return 2;
    if (byte == vsusp) return 20;
    if (byte == vquit) return 3;
    return 0;
}
```

```tests
#include <assert.h>
int dispatch_byte(int, int, int, int, int);
int main(void) {
    /* The measured table: interrupt 0x03, suspend 0x1a, quit 0x1c. */
    assert(dispatch_byte(0x03, 1, 0x03, 0x1a, 0x1c) == 2);
    assert(dispatch_byte(0x1a, 1, 0x03, 0x1a, 0x1c) == 20);
    assert(dispatch_byte(0x1c, 1, 0x03, 0x1a, 0x1c) == 3);
    assert(dispatch_byte('a',  1, 0x03, 0x1a, 0x1c) == 0);
    /* Flag cleared: the table is not consulted at all. */
    assert(dispatch_byte(0x03, 0, 0x03, 0x1a, 0x1c) == 0);
    assert(dispatch_byte(0x1c, 0, 0x03, 0x1a, 0x1c) == 0);
    return 0;
}
```

```solution
int dispatch_byte(int byte, int isig, int vintr, int vsusp, int vquit) {
    if (!isig) return 0;
    if (byte == vintr) return 2;
    if (byte == vsusp) return 20;
    if (byte == vquit) return 3;
    return 0;
}
```

## When a read is allowed to return

Write `read_returns`, deciding whether a non-canonical read returns yet, given the
bytes available, how long it has waited in tenths of a second, and `VMIN` and
`VTIME`.

The defaults are one and zero, which is why a raw read returns on the first byte.

@kind output
@concept These two numbers are how a program tells an escape key pressed alone
from an escape sequence still arriving.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint With `VTIME` zero there is no deadline, so the read waits for `VMIN` bytes
however long that takes.
@diagnose assert verdict assert-failed
A check disagrees. A `VTIME` of zero means no timer at all rather than a timer
that has already expired, so a read with nothing available blocks instead of
returning empty. Treating the waited time as satisfying a zero deadline inverts
the default case.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after One and zero says return as soon as one byte exists and never time out,
which is what a fresh terminal in raw mode does. Setting `VTIME` to one gives a
read a tenth of a second, which is long enough for the rest of an escape sequence
and short enough that a lone escape key does not feel stuck.

```starter
int read_returns(unsigned long available, unsigned long waited_tenths,
                 unsigned long vmin, unsigned long vtime) {
    if (available >= vmin) return 1;
    return waited_tenths >= vtime;
}
```

```tests
#include <assert.h>
int read_returns(unsigned long, unsigned long, unsigned long, unsigned long);
int main(void) {
    /* The defaults: one byte is enough, and no timer. */
    assert(read_returns(1, 0, 1, 0) == 1);
    assert(read_returns(0, 0, 1, 0) == 0);
    /* No timer means waiting does not help. */
    assert(read_returns(0, 50, 1, 0) == 0);
    /* A deadline, not yet reached. */
    assert(read_returns(0, 0, 1, 1) == 0);
    /* A deadline, reached, and something arrived. */
    assert(read_returns(1, 1, 4, 1) == 1);
    /* A deadline reached with nothing at all. */
    assert(read_returns(0, 1, 4, 1) == 1);
    /* Enough bytes, before the deadline. */
    assert(read_returns(4, 0, 4, 1) == 1);
    return 0;
}
```

```solution
int read_returns(unsigned long available, unsigned long waited_tenths,
                 unsigned long vmin, unsigned long vtime) {
    if (available >= vmin && available > 0) return 1;
    if (vtime == 0) return available >= vmin;
    return waited_tenths >= vtime;
}
```

## Two ends, one pair of numbers

Write `winsize_after`, modelling the window size stored in the driver, given what
the master sets and what a program later reads.

The size is kernel state, not an environment variable.

@kind output
@concept The emulator sets it on its end, the kernel stores it, and a signal tells
the program to ask again. A program that does not ask keeps drawing at the old
width.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A fresh pseudoterminal reports zero until something sets it, and after that
both ends see the same numbers.
@diagnose assert verdict assert-failed
A check disagrees. Setting the size on the master changes what the slave reads,
because there is one pair of numbers in the driver rather than one per end. A
default of eighty columns is the emulator's convention and not the device's
initial state, which measures as zero.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A fresh pseudoterminal measures zero by zero. Set 40 by 132 on the master
and the slave reads 40 by 132. That is the whole mechanism behind resizing, plus
a signal to say the numbers changed.

```starter
void winsize_after(int set_called, unsigned short set_rows,
                   unsigned short set_cols,
                   unsigned short *rows, unsigned short *cols) {
    (void)set_called; (void)set_rows; (void)set_cols;
    *rows = 24;
    *cols = 80;
}
```

```tests
#include <assert.h>
void winsize_after(int, unsigned short, unsigned short,
                   unsigned short *, unsigned short *);
int main(void) {
    unsigned short r, c;
    /* Nothing has told it yet. */
    winsize_after(0, 0, 0, &r, &c);
    assert(r == 0 && c == 0);
    /* The master sets it; the slave reads the same numbers. */
    winsize_after(1, 40, 132, &r, &c);
    assert(r == 40 && c == 132);
    winsize_after(1, 24, 80, &r, &c);
    assert(r == 24 && c == 80);
    return 0;
}
```

```solution
void winsize_after(int set_called, unsigned short set_rows,
                   unsigned short set_cols,
                   unsigned short *rows, unsigned short *cols) {
    if (!set_called) { *rows = 0; *cols = 0; return; }
    *rows = set_rows;
    *cols = set_cols;
}
```
