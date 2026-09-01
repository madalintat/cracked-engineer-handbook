---
needs: [encoding, integers]
minutes: 55
one_idea: A string has at least four different lengths and the one your language reports is rarely the one your question was about.
sources: [numbers-text-numerics, compilers-interpreters-terminals-unix]
---

Ask how long a piece of text is and there are four defensible answers. Ask how to
uppercase it and the answer depends on what country the reader is in. Ask whether
two strings are equal and there are three reasonable definitions.

None of this is anybody being difficult. It is what happens when a data format
has to represent every writing system humans have used.

## Four different lengths

Take the family emoji, one of the ones made from several people.

As bytes in UTF-8 it is 18. As Unicode code points it is 5: three people and two
invisible joiners between them. As what a reader would call characters, meaning
grapheme clusters, it is 1. As glyphs actually drawn it is 1 on a font that has
the combined image and 3 on one that does not.

Every one of those numbers is correct for some purpose. Byte length is what you
allocate. Code point count is what most languages report. Grapheme count is what
a user means by "characters remaining". Glyph count is what fits on the line.

The bug is almost never in the counting. It is in using the number you got for
the question you asked.

```figure
{
  "kind": "bits",
  "alt": "The bytes of an accented e shown twice: as one code point encoded in two bytes, and as a base letter plus a combining mark encoded in three.",
  "caption": "The same reader-visible character, two ways. Both are valid, they compare unequal, and normalisation is the operation that decides which one you have.",
  "bits": 24,
  "groups": [
    { "from": 0,  "to": 7,  "label": "c3", "accent": "azure" },
    { "from": 8,  "to": 15, "label": "a9", "accent": "azure" },
    { "from": 16, "to": 23, "label": "one code point", "accent": "jade" }
  ]
}
```

## What UTF-8 gets right

UTF-8 encodes a code point in one to four bytes, and the design is worth
admiring because several good properties fall out of one decision.

A byte under 128 is itself. So every ASCII file is already valid UTF-8, and every
program that only cares about ASCII punctuation keeps working on text it does not
understand.

A byte of 128 or more is either a leading byte, which says how many follow, or a
continuation byte, which always has its top two bits as 10. Nothing else does.
Which means you can land anywhere in the middle of a string and find the start of
the character you are in by walking backwards past continuation bytes. It is self
synchronising, and no other popular encoding is.

There is no byte order to get wrong, because the unit is a byte. There is no need
for a marker at the start of the file, and the one that exists is a mistake other
encodings made that UTF-8 inherited by imitation.

And a substring search for one valid UTF-8 string inside another cannot match
across a character boundary, because a leading byte and a continuation byte can
never be confused. Searching bytes is searching characters, for free.

## What UTF-16 got wrong

Unicode originally promised to fit every character in sixteen bits, and several
important systems built their strings on that promise. Java, JavaScript, Windows,
and a great deal of what runs on them.

The promise did not hold. There are more than sixty five thousand characters, so
the encoding was extended: code points above the first sixty five thousand are
written as two sixteen-bit units, called a surrogate pair.

Which means UTF-16 is a variable-width encoding that everybody treats as a fixed
one. A string's `length` in JavaScript is a count of sixteen-bit units, so an
emoji has length 2, indexing into the middle of one gives half a character, and
reversing a string breaks every character above the basic range.

The trap is that it works for a long time. Text in most European languages fits
in the first sixty five thousand code points entirely, so the bug does not appear
until somebody types an emoji or a rare Chinese character.

## The same text, twice

There are two ways to write an accented e. One code point that means e with an
acute accent, or the plain letter e followed by a combining acute accent. Encoded
in UTF-8 the first is two bytes and the second is three.

They look identical. They compare unequal.

Normalisation is the operation that picks one. Composed form combines them where
a combined code point exists, decomposed form splits them apart. Comparing text
for equality means normalising both sides first, and which form you pick is a
policy decision rather than a correctness one.

This causes real bugs at boundaries. A file created on a system that decomposes
and read on one that composes has a name that does not match itself, which is
exactly the situation macOS users have with filenames containing accents.

## Case is not a property of a letter

Uppercasing looks like a per-character operation and is not.

The German sharp s uppercases to two letters, so the string gets longer. Turkish
has a dotless i, and uppercasing an ordinary i gives a dotted capital, which
means the correct result depends on the locale and not on the character. A
program that lowercases identifiers before comparing them behaves differently for
a Turkish user, and this has caused security failures where a check for "admin"
did not match.

The rule that follows is narrow and useful. If you are case folding for
comparison rather than for display, ask for the case-insensitive comparison the
library provides rather than lowercasing and comparing. They are different
operations and only one of them is locale independent.

## Sorting is a locale, not an ordering

Code point order is not alphabetical order in any language.

In Swedish the letters with diacritics come after z. In German phone books they
sort with their base letters. In Spanish, ch was a single letter for sorting
purposes until 1994. Uppercase comes before lowercase in code point order, which
puts Zebra before apple.

Collation is a locale-specific algorithm with a large table, and no amount of
comparing bytes approximates it. What comparing bytes is good for is a consistent
order, which is what a data structure needs and what a person does not.

## What a code point is not

One more distinction, because it decides which library call you want.

A code point is a number Unicode assigned to something. That something is
usually a character and is sometimes not: joiners, variation selectors,
directional marks and skin tone modifiers are all code points that are not
characters in any sense a reader would recognise.

So a grapheme cluster, which is what a reader calls a character, is a sequence of
code points that display as one unit. The rules for grouping them are a published
algorithm with a table, and the table changes between Unicode versions, which
means the number of characters in a string can change when you upgrade a library.

That sounds absurd and is the correct behaviour. When a new emoji sequence is
defined, text that previously showed as three symbols starts showing as one, and
a program that hardcoded the old grouping now disagrees with what the user sees.

The practical consequence is where to put each count. Byte length goes in your
buffers and your protocols, because it is stable. Grapheme count goes in your
user interface, because it is what people mean. Code point count belongs almost
nowhere, and it is the one every language gives you by default.

## Text as an attack surface

Three problems worth knowing because all three have shipped.

Homoglyphs are characters that look alike from different scripts. A Cyrillic a is
not a Latin a and renders identically, which is how a domain name can be
registered that is visually identical to somebody else's.

Bidirectional overrides reorder how text is displayed without changing what it
means. Source code containing them can display as one thing and compile as
another, which was published as Trojan Source in 2021 and affected every language
that permits these characters in comments and strings.

And overlong encodings are UTF-8 sequences that use more bytes than necessary for
a code point. They decode to the same value and are invalid, and decoders that
accepted them have allowed a slash to be smuggled past a path check that was
looking for the one-byte version.

The defence for all three is the same: validate and normalise at the boundary,
once, and treat everything inside as already checked.

## What to carry forward

Bytes, code points, grapheme clusters and glyphs are four different counts, and
the one your language gives you is usually code points, or in some languages
something worse.

UTF-8 is self synchronising, ASCII compatible and has no byte order, and those
three properties are why it won. UTF-16 is variable width and treated as fixed,
which is where the surviving bugs are.

Equality needs normalisation, case folding needs a locale or an explicit
case-insensitive comparison, and sorting for people needs collation. All three
are library calls, and writing them yourself is how the bugs above happen.

That closes Part VI. Part VII goes back under your process.

## Reading the errors you are about to see

These encode, decode and validate UTF-8 by hand, which is the one part of this
subject small enough to implement in an exercise and worth implementing once.

`assert-failed` names the sequence your code got wrong. Every byte sequence in
these tests was produced by encoding real text rather than written from the
specification.
