## twos-complement
The representation every machine you will use stores signed integers in. The
top bit carries a negative weight rather than acting as a sign flag, so
addition and subtraction need no special case and the same adder serves both.
The price is asymmetry: one more negative value than positive, which is why
negating the smallest one has no answer.
@see sign-extension, overflow

## sign-extension
Widening a signed value by copying its top bit into every new bit, which
preserves its value under two's complement. Copying zeros instead would turn
every negative number into a large positive one, which is exactly what happens
when a signed value is widened through an unsigned type by mistake.
@see twos-complement, integer-promotion

## overflow
Arithmetic whose true result does not fit the type. Signed overflow is
undefined behaviour in C and C++, which means the compiler is entitled to
assume it cannot happen and to optimise on that assumption. Unsigned overflow
is defined to wrap, and is a different thing wearing a similar name.
@see twos-complement, undefined-behaviour

## undefined-behaviour
A construct the language standard declines to give any meaning. Not "does
something unpredictable at runtime": the compiler may assume it never occurs,
so code around it can be deleted or reordered on that basis. The observable
effect often appears in a function that contains no mistake at all.
@see overflow, sanitizer

## integer-promotion
The rule that converts narrow integer types to `int` before arithmetic. It is
why adding two `unsigned char` values gives an `int`, and why a comparison
between a signed and an unsigned value converts the signed one, turning minus
one into a very large number.
@see sign-extension, twos-complement

## sanitizer
A compiler mode that inserts checks for behaviour the language leaves
undefined, so the moment it happens is reported with a file, a line and the
operands rather than surfacing later as a wrong answer. It costs runtime speed,
which is the only reason it is not always on.
@see undefined-behaviour, overflow
