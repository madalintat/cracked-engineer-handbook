## Encoding a code point

Write `utf8_encode`, writing a code point into a buffer and returning how many
bytes it used.

One byte below 128. Two below 2048, with a leading byte of 110 and one
continuation. Three below 65536, leading 1110. Four above that, leading 11110.
Every continuation byte starts with 10.

@kind output
@concept Every property UTF-8 is admired for falls out of one rule: a leading
byte says how many follow, and a continuation byte never looks like anything
else.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The high bits of the code point go in the leading byte, and each
continuation takes the next six.
@diagnose assert verdict assert-failed
A check disagrees. Continuation bytes carry six bits each and are formed as 0x80
plus the low six bits of what is left, taken most significant first. The starter
handles only the one-byte case, so anything above 127 comes out as a single wrong
byte.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A byte under 128 is itself, which is why every ASCII file is already valid
UTF-8. That one decision is also what makes the encoding self synchronising and
what removes any question of byte order.

```starter
int utf8_encode(unsigned cp, unsigned char *out) {
    out[0] = (unsigned char)cp;
    return 1;
}
```

```tests
#include <assert.h>
int utf8_encode(unsigned, unsigned char *);
int main(void) {
    unsigned char b[4];
    assert(utf8_encode(0x41, b) == 1 && b[0] == 0x41);
    /* e with an acute accent. */
    assert(utf8_encode(0xE9, b) == 2 && b[0] == 0xC3 && b[1] == 0xA9);
    /* A combining acute accent. */
    assert(utf8_encode(0x301, b) == 2 && b[0] == 0xCC && b[1] == 0x81);
    /* The CJK character for middle. */
    assert(utf8_encode(0x4E2D, b) == 3);
    assert(b[0] == 0xE4 && b[1] == 0xB8 && b[2] == 0xAD);
    /* A grinning face. */
    assert(utf8_encode(0x1F600, b) == 4);
    assert(b[0] == 0xF0 && b[1] == 0x9F && b[2] == 0x98 && b[3] == 0x80);
    assert(utf8_encode(0x00, b) == 1 && b[0] == 0x00);
    return 0;
}
```

```solution
int utf8_encode(unsigned cp, unsigned char *out) {
    if (cp < 0x80) {
        out[0] = (unsigned char)cp;
        return 1;
    }
    if (cp < 0x800) {
        out[0] = (unsigned char)(0xC0 | (cp >> 6));
        out[1] = (unsigned char)(0x80 | (cp & 0x3F));
        return 2;
    }
    if (cp < 0x10000) {
        out[0] = (unsigned char)(0xE0 | (cp >> 12));
        out[1] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F));
        out[2] = (unsigned char)(0x80 | (cp & 0x3F));
        return 3;
    }
    out[0] = (unsigned char)(0xF0 | (cp >> 18));
    out[1] = (unsigned char)(0x80 | ((cp >> 12) & 0x3F));
    out[2] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F));
    out[3] = (unsigned char)(0x80 | (cp & 0x3F));
    return 4;
}
```

## Counting what the user counts

Write `count_code_points`, counting the code points in a UTF-8 string without
decoding any of them.

A continuation byte has its top two bits as 10 and nothing else does, so the
count is the bytes that are not continuations.

@kind output
@concept The leading byte and the continuation byte are distinguishable from each
other alone, which is what makes counting, seeking and searching all work on
bytes.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Mask with 0xC0 and compare against 0x80.
@diagnose assert verdict assert-failed
A check disagrees, and it will be one with a multi-byte character in it. Counting
bytes gives the buffer size rather than the character count. A continuation byte
is exactly one whose top two bits are 10, so skip those and count the rest.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This still is not what a reader would call the number of characters. The
family emoji is five code points and one character, and the accented e written as
a base letter plus a mark is two code points and one character. Code point count
is the number every language gives you and the one that belongs almost nowhere.

```starter
#include <stddef.h>
size_t count_code_points(const unsigned char *s, size_t n) {
    return n;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t count_code_points(const unsigned char *, size_t);
int main(void) {
    unsigned char ascii[] = {'h','i'};
    assert(count_code_points(ascii, 2) == 2);
    /* e with an acute accent: one code point, two bytes. */
    unsigned char acc[] = {0xC3, 0xA9};
    assert(count_code_points(acc, 2) == 1);
    /* e followed by a combining acute: two code points, three bytes. */
    unsigned char dec[] = {0x65, 0xCC, 0x81};
    assert(count_code_points(dec, 3) == 2);
    /* A grinning face: one code point, four bytes. */
    unsigned char emo[] = {0xF0, 0x9F, 0x98, 0x80};
    assert(count_code_points(emo, 4) == 1);
    assert(count_code_points(ascii, 0) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
size_t count_code_points(const unsigned char *s, size_t n) {
    size_t c = 0;
    for (size_t i = 0; i < n; i++)
        if ((s[i] & 0xC0) != 0x80) c++;
    return c;
}
```

## Landing in the middle

Write `char_start`, which takes a byte offset into a UTF-8 string and returns the
offset of the first byte of the character containing it.

This is the self-synchronising property, and it is the one no other popular
encoding has.

@kind output
@concept You can find the start of a character from anywhere inside it, which is
why a UTF-8 buffer can be split at an arbitrary point and repaired.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Walk backwards while the byte you are on is a continuation.
@diagnose assert verdict assert-failed
A check disagrees. Landing on a leading byte means you are already at the start
and must not move, and landing on a continuation byte means walking back until
you reach one that is not. The starter always steps back, which is wrong for
every offset that was already correct.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after No other popular encoding permits this. In UTF-16 a lone sixteen-bit unit
does not say whether it is the first or second half of a pair without looking at
its value, and in the older multi-byte encodings a second byte could be
indistinguishable from a first. Splitting a buffer anywhere and repairing it is
free here and was not before.

```starter
#include <stddef.h>
size_t char_start(const unsigned char *s, size_t at) {
    return at > 0 ? at - 1 : 0;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t char_start(const unsigned char *, size_t);
int main(void) {
    /* 'a' then a grinning face then 'b'. */
    unsigned char s[] = {0x61, 0xF0, 0x9F, 0x98, 0x80, 0x62};
    assert(char_start(s, 0) == 0);
    assert(char_start(s, 1) == 1);
    /* Anywhere inside the four-byte sequence returns its start. */
    assert(char_start(s, 2) == 1);
    assert(char_start(s, 3) == 1);
    assert(char_start(s, 4) == 1);
    assert(char_start(s, 5) == 5);
    return 0;
}
```

```solution
#include <stddef.h>
size_t char_start(const unsigned char *s, size_t at) {
    while (at > 0 && (s[at] & 0xC0) == 0x80) at--;
    return at;
}
```

## The encoding that says the same thing twice

An overlong encoding uses more bytes than a code point needs. It decodes to the
same value and it is invalid, and decoders that accepted them have let a slash
through a path check looking for the one-byte version.

Write `is_overlong`, reporting whether a two-byte sequence encodes a value that
should have been one byte.

@kind output
@concept Two byte sequences that decode to the same value are not both valid, and
a decoder that accepts either is a decoder an attacker can talk past.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Decode it and check whether the result would have fitted in one byte.
@diagnose assert verdict assert-failed
A check disagrees. A two-byte sequence carries eleven bits, and any value below
128 encoded that way is overlong. The leading byte 0xC0 or 0xC1 is always
overlong, because those cannot produce a value of 128 or more.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after 0xC0 0xAF decodes to a forward slash and is not a forward slash. A checker
that rejects the one-byte version and a decoder that accepts the two-byte one
between them let a path traversal through, which is why every conforming decoder
rejects these outright rather than normalising them.

```starter
int is_overlong(unsigned char b0, unsigned char b1) {
    (void)b0; (void)b1;
    return 0;
}
```

```tests
#include <assert.h>
int is_overlong(unsigned char, unsigned char);
int main(void) {
    /* 0xC0 0xAF decodes to a slash, which needs one byte. */
    assert(is_overlong(0xC0, 0xAF) == 1);
    /* 0xC1 0x81 decodes to 'A'. */
    assert(is_overlong(0xC1, 0x81) == 1);
    /* 0xC3 0xA9 is an accented e, which genuinely needs two bytes. */
    assert(is_overlong(0xC3, 0xA9) == 0);
    /* 0xC2 0x80 is the smallest legitimate two-byte sequence. */
    assert(is_overlong(0xC2, 0x80) == 0);
    assert(is_overlong(0xC2, 0xBF) == 0);
    return 0;
}
```

```solution
int is_overlong(unsigned char b0, unsigned char b1) {
    unsigned cp = ((unsigned)(b0 & 0x1F) << 6) | (b1 & 0x3F);
    return cp < 0x80;
}
```

## Two halves of one character

UTF-16 encodes a code point above 65535 as two sixteen-bit units. Write
`to_surrogates`, producing the pair.

Subtract 65536, take the top ten bits plus 0xD800 for the first unit and the
bottom ten plus 0xDC00 for the second.

@kind output
@concept UTF-16 is a variable-width encoding that most of the systems built on it
treat as fixed, which is where its surviving bugs are.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Subtract the offset first. Ten bits each.
@diagnose assert verdict assert-failed
A check disagrees. The subtraction of 65536 comes first, so the remaining twenty
bits split into two tens. Skipping it puts the wrong bits in both halves and can
produce a high surrogate outside the reserved range.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A grinning face is one code point and two units, which is why its `length`
in JavaScript is 2, why indexing to position 1 gives half a character, and why
reversing a string breaks every character above the basic range. The trap is that
it works for years, because most European text never leaves the first sixty five
thousand code points.

```starter
void to_surrogates(unsigned cp, unsigned *hi, unsigned *lo) {
    *hi = (cp >> 10) + 0xD800;
    *lo = (cp & 0x3FF) + 0xDC00;
}
```

```tests
#include <assert.h>
void to_surrogates(unsigned, unsigned *, unsigned *);
int main(void) {
    unsigned hi, lo;
    /* A grinning face. */
    to_surrogates(0x1F600, &hi, &lo);
    assert(hi == 0xD83D && lo == 0xDE00);
    /* The first code point that needs a pair. */
    to_surrogates(0x10000, &hi, &lo);
    assert(hi == 0xD800 && lo == 0xDC00);
    /* The last one Unicode defines. */
    to_surrogates(0x10FFFF, &hi, &lo);
    assert(hi == 0xDBFF && lo == 0xDFFF);
    return 0;
}
```

```solution
void to_surrogates(unsigned cp, unsigned *hi, unsigned *lo) {
    unsigned v = cp - 0x10000;
    *hi = (v >> 10) + 0xD800;
    *lo = (v & 0x3FF) + 0xDC00;
}
```

## Grouping what a reader sees

Write `count_graphemes`, using a simplified rule: a code point in the combining
marks range attaches to the character before it, and everything else starts a new
one.

The real algorithm has many more rules and a table that changes between Unicode
versions. This one captures the case people meet first.

@kind output
@concept What a reader calls a character is a run of code points, so the count
they mean is neither the byte count nor the code point count.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint A combining mark does not increase the count. A leading mark with nothing
before it still has to start one.
@diagnose assert verdict assert-failed
A check disagrees. Marks in the range 0x300 to 0x36F attach to whatever came
before, so they add nothing, unless nothing came before, in which case there is
still one thing on the screen. The starter counts every code point.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The real rules also group emoji joined by zero-width joiners, regional
indicator pairs that form flags, and several scripts where a syllable spans
several code points. And the table changes between versions, which means the
number of characters in a string can change when a library is upgraded. That is
correct behaviour: when a new emoji sequence is defined, what used to draw as
three symbols draws as one.

```starter
#include <stddef.h>
size_t count_graphemes(const unsigned *cps, size_t n) {
    return n;
}
```

```tests
#include <assert.h>
#include <stddef.h>
size_t count_graphemes(const unsigned *, size_t);
int main(void) {
    unsigned plain[3] = {'a', 'b', 'c'};
    assert(count_graphemes(plain, 3) == 3);
    /* e followed by a combining acute is one character. */
    unsigned acc[2] = {0x65, 0x301};
    assert(count_graphemes(acc, 2) == 1);
    /* Two marks on one base is still one. */
    unsigned two[3] = {0x65, 0x301, 0x308};
    assert(count_graphemes(two, 3) == 1);
    /* A mark with nothing before it is still something on the screen. */
    unsigned lone[1] = {0x301};
    assert(count_graphemes(lone, 1) == 1);
    unsigned mix[4] = {'a', 0x301, 'b', 0x308};
    assert(count_graphemes(mix, 4) == 2);
    assert(count_graphemes(plain, 0) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
size_t count_graphemes(const unsigned *cps, size_t n) {
    size_t c = 0;
    for (size_t i = 0; i < n; i++) {
        int mark = cps[i] >= 0x300 && cps[i] <= 0x36F;
        if (!mark || i == 0) c++;
    }
    return c;
}
```

## Rejecting what is not text

Write `utf8_valid`, checking that a byte sequence is well formed: every leading
byte is followed by the right number of continuations, and there are no stray
continuations.

A decoder that accepts malformed input is a decoder that produces characters
nobody wrote.

@kind output
@concept Validating at the boundary once is the defence, and it works because
the encoding makes malformed input detectable rather than merely unusual.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Read the leading byte to learn the length, then require exactly that many
continuations before the next leading byte.
@diagnose assert verdict assert-failed
A check disagrees. A truncated sequence at the end of the buffer is invalid, a
continuation byte with no leading byte before it is invalid, and a leading byte
followed by too few continuations is invalid. The starter only rejects the third.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Validate and normalise at the boundary, once, and treat everything inside
as checked. The alternative is every function in the program defending itself,
which is how the overlong slash got through: one component rejected the
dangerous form and another accepted a different spelling of it.

```starter
#include <stddef.h>
int utf8_valid(const unsigned char *s, size_t n) {
    for (size_t i = 0; i < n; i++) {
        if (s[i] < 0x80) continue;
        if ((s[i] & 0xE0) == 0xC0) i += 1;
        else if ((s[i] & 0xF0) == 0xE0) i += 2;
        else if ((s[i] & 0xF8) == 0xF0) i += 3;
    }
    return 1;
}
```

```tests
#include <assert.h>
#include <stddef.h>
int utf8_valid(const unsigned char *, size_t);
int main(void) {
    unsigned char ok1[] = {0x61, 0xC3, 0xA9, 0x62};
    assert(utf8_valid(ok1, 4) == 1);
    unsigned char ok2[] = {0xF0, 0x9F, 0x98, 0x80};
    assert(utf8_valid(ok2, 4) == 1);
    assert(utf8_valid(ok1, 0) == 1);
    /* A continuation byte with nothing leading it. */
    unsigned char stray[] = {0xA9};
    assert(utf8_valid(stray, 1) == 0);
    /* A two-byte leader with nothing after it. */
    unsigned char cut[] = {0xC3};
    assert(utf8_valid(cut, 1) == 0);
    /* A four-byte leader with only two continuations. */
    unsigned char short4[] = {0xF0, 0x9F, 0x98};
    assert(utf8_valid(short4, 3) == 0);
    /* A leader where a continuation was expected. */
    unsigned char wrong[] = {0xC3, 0x61};
    assert(utf8_valid(wrong, 2) == 0);
    return 0;
}
```

```solution
#include <stddef.h>
int utf8_valid(const unsigned char *s, size_t n) {
    size_t i = 0;
    while (i < n) {
        unsigned char b = s[i];
        size_t need;
        if (b < 0x80) need = 0;
        else if ((b & 0xE0) == 0xC0) need = 1;
        else if ((b & 0xF0) == 0xE0) need = 2;
        else if ((b & 0xF8) == 0xF0) need = 3;
        else return 0;
        if (i + need >= n) return 0;
        for (size_t k = 1; k <= need; k++)
            if ((s[i + k] & 0xC0) != 0x80) return 0;
        i += need + 1;
    }
    return 1;
}
```

## Bytes are not letters

Code point order is not alphabetical order in any language. Write
`byte_order_before`, comparing two strings by their bytes, and read what the
checks assert about it.

@kind output
@concept Comparing bytes gives a consistent order, which is what a data structure
needs, and it is not the order a person would produce.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Compare byte by byte; if one is a prefix of the other, the shorter comes
first.
@diagnose assert verdict assert-failed
A check disagrees. A prefix sorts before what extends it, and the comparison
stops at the first differing byte rather than continuing. Unsigned comparison
matters too: a byte above 127 must count as larger than an ASCII one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Zebra sorts before apple, because uppercase letters have lower code points.
In Swedish the accented letters belong after z, in German phone books they sort
with their base letters, and in Spanish ch was one letter for sorting until 1994.
Collation is a locale-specific algorithm with a large table, and no amount of
comparing bytes approximates it.

```starter
#include <stddef.h>
int byte_order_before(const unsigned char *a, size_t na,
                      const unsigned char *b, size_t nb) {
    (void)na; (void)nb;
    return a[0] < b[0];
}
```

```tests
#include <assert.h>
#include <stddef.h>
int byte_order_before(const unsigned char *, size_t,
                      const unsigned char *, size_t);
int main(void) {
    unsigned char apple[] = {'a','p','p','l','e'};
    unsigned char zebra[] = {'Z','e','b','r','a'};
    /* Uppercase has the lower code point, so Zebra comes first. */
    assert(byte_order_before(zebra, 5, apple, 5) == 1);
    assert(byte_order_before(apple, 5, zebra, 5) == 0);
    /* A prefix sorts before what extends it. */
    unsigned char app[] = {'a','p','p'};
    assert(byte_order_before(app, 3, apple, 5) == 1);
    assert(byte_order_before(apple, 5, app, 3) == 0);
    /* Equal strings are not before each other. */
    assert(byte_order_before(apple, 5, apple, 5) == 0);
    /* A non-ASCII byte is larger than every ASCII one. */
    unsigned char acc[] = {0xC3, 0xA9};
    assert(byte_order_before(zebra, 5, acc, 2) == 1);
    return 0;
}
```

```solution
#include <stddef.h>
int byte_order_before(const unsigned char *a, size_t na,
                      const unsigned char *b, size_t nb) {
    size_t n = na < nb ? na : nb;
    for (size_t i = 0; i < n; i++) {
        if (a[i] != b[i]) return a[i] < b[i];
    }
    return na < nb;
}
```
