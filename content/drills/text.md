## How many lengths does a string have?

- [x] Four: bytes, code points, grapheme clusters, and glyphs drawn
- [ ] One, once you have decided on an encoding
- [ ] Two: bytes and characters
- [ ] Three: bytes, characters, and words

@why The family emoji is 18 bytes, 5 code points, 1 grapheme cluster, and 1 or 3
glyphs depending on the font. Every one of those is correct for some purpose.

## Which length belongs in a user interface?

- [x] The grapheme cluster count
- [ ] The byte count
- [ ] The code point count
- [ ] The glyph count

@why Byte length goes in buffers and protocols because it is stable. Code point
count is what every language gives you by default and belongs almost nowhere.

## What does a byte under 128 mean in UTF-8?

- [x] Itself, which is why every ASCII file is already valid UTF-8
- [ ] The start of a two-byte sequence
- [ ] A continuation byte
- [ ] A control code

@why Several of UTF-8's good properties fall out of that one decision, including
self-synchronisation and the absence of any byte order question.

## What makes UTF-8 self synchronising?

- [x] A continuation byte always has 10 as its top two bits and nothing else does
- [ ] Every character starts with a marker byte
- [ ] The length is encoded in a header
- [ ] Characters are a fixed number of bytes

@why You can land anywhere in a string and find the start of the character you
are in by walking backwards past continuations. No other popular encoding
permits this.

## Why does UTF-8 need no byte order mark?

- [x] The unit is a byte, so there is no order to get wrong
- [ ] The first byte always identifies the order
- [ ] The standard mandates big endian
- [ ] It does need one; the marker is required

@why The marker that exists is a mistake other encodings made that UTF-8
inherited by imitation.

## Why is searching a UTF-8 string for a substring safe at the byte level?

- [x] A leading byte and a continuation byte can never be confused, so no match can straddle a character
- [ ] Because search functions decode first
- [ ] Because characters are fixed width
- [ ] It is not safe; you must decode both strings

@why Searching bytes is searching characters, for free, which is another
consequence of the same encoding decision.

## What is a surrogate pair?

- [x] Two sixteen-bit units encoding one code point above 65535 in UTF-16
- [ ] Two code points that render as one character
- [ ] A composed and a decomposed form of the same character
- [ ] Two bytes of a UTF-8 continuation

@why Unicode originally promised everything would fit in sixteen bits. It did
not, so the encoding was extended, and UTF-16 became variable width.

## Why does a JavaScript string report length 2 for one emoji?

- [x] `length` counts sixteen-bit units, and that emoji is a surrogate pair
- [ ] It counts bytes
- [ ] It counts grapheme clusters and the emoji is two
- [ ] It counts code points including a joiner

@why Indexing to position 1 gives half a character, and reversing a string breaks
every character above the basic range. The trap is that it works for years,
because most European text never leaves the first sixty five thousand code
points.

## Two ways to write an accented e. What is the relationship?

- [x] Both are valid, they look identical, and they compare unequal
- [ ] Only the composed form is valid
- [ ] They compare equal because the renderer normalises
- [ ] The decomposed form is a legacy encoding

@why Normalisation is the operation that picks one, and comparing text for
equality means normalising both sides first.

## Why do filenames with accents sometimes not match themselves across systems?

- [x] One system stores them decomposed and the other composed
- [ ] The filesystem uses a different encoding
- [ ] Case folding differs between the systems
- [ ] The accents are stored in extended attributes

@why It is the situation macOS users have, and it is a normalisation mismatch at
a boundary rather than a bug in either system.

## Why is lowercasing before comparison a security problem?

- [x] The correct result depends on the locale, so a Turkish user gets a different answer
- [ ] Lowercasing allocates and can fail
- [ ] It loses information needed for the comparison
- [ ] It is slower than a direct comparison

@why Turkish has a dotless i, so uppercasing an ordinary i gives a dotted
capital. A check for "admin" has failed to match for exactly this reason. Ask for
the case-insensitive comparison instead.

## Is code point order alphabetical order?

- [x] In no language, and it puts Zebra before apple
- [ ] Yes, for languages using the Latin alphabet
- [ ] Yes, after normalisation
- [ ] Only for ASCII

@why Swedish puts accented letters after z, German phone books sort them with
their base letters, and Spanish treated ch as one letter until 1994. Collation is
a locale algorithm with a large table.

## What is an overlong encoding?

- [x] A UTF-8 sequence using more bytes than the code point needs, which is invalid
- [ ] A sequence longer than four bytes
- [ ] A code point above the Unicode maximum
- [ ] A grapheme cluster spanning many code points

@why 0xC0 0xAF decodes to a slash and is not a slash. Decoders that accepted them
have let a path traversal past a check looking for the one-byte form.

## What is Trojan Source?

- [x] Bidirectional override characters making source display as one thing and compile as another
- [ ] A homoglyph attack on package names
- [ ] An overlong encoding in a compiler's lexer
- [ ] A normalisation mismatch in a build system

@why Published in 2021, and it affected every language that permits those
characters in comments and strings.

## Why can a string's character count change when you upgrade a library?

- [x] The grapheme clustering rules have a table that changes between Unicode versions
- [ ] The encoding changed
- [ ] Normalisation forms are revised
- [ ] It cannot; the count is fixed by the bytes

@why That is correct behaviour. When a new emoji sequence is defined, text that
drew as three symbols draws as one, and a program with the old grouping now
disagrees with what the user sees.
