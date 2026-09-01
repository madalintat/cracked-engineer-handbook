## What are the four parts of an x86-64 memory operand?

- [x] Base register, index register, scale, and displacement
- [ ] Segment, page, offset, and permission
- [ ] Base, limit, index, and stride
- [ ] Register, immediate, shift, and extend

@why The processor adds them as part of the load, so one instruction covers what
the source spells as a multiply, an add and a dereference.

## Which scale factors does the encoding allow?

- [x] 1, 2, 4 and 8
- [ ] Any power of two up to 128
- [ ] Any value from 1 to 15
- [ ] Only 1 and 8

@why They are the sizes that matter for arrays of bytes, shorts, ints and
pointers. Anything else costs an extra instruction, which is why struct sizes get
rounded up in code that indexes them hard.

## What does `lea` do?

- [x] Computes an address and writes it to a register, without any memory access
- [ ] Loads a value from an address into a register
- [ ] Loads the address of the next instruction
- [ ] Computes an address and prefetches the cache line

@why It is the closest thing x86-64 has to a three-operand arithmetic
instruction: it adds, scales, adds a constant, and writes somewhere that is not
either input.

## Why do compilers use `lea` for arithmetic that has nothing to do with addresses?

- [x] It multiplies by 3, 5 or 9 in one instruction and leaves the flags alone
- [ ] It is shorter to encode than `add`
- [ ] It executes on a port `add` cannot use
- [ ] It avoids a dependency on the destination register

@why An instruction that does arithmetic without disturbing a comparison in
progress is more useful than one that does not, and that is the same design
pressure the flags create everywhere else.

## What is `cmp`?

- [x] A subtraction whose result is discarded, keeping only the flags
- [ ] A dedicated comparison unit separate from the adder
- [ ] An exclusive or followed by a zero test
- [ ] A subtraction that saturates rather than wrapping

@why `test` is the same trick with a bitwise and, which is why `test rax, rax`
is how every compiler asks whether a value is zero.

## After one `cmp`, how does the processor know whether you meant signed or unsigned?

- [x] It does not; the jump you write afterwards picks the interpretation
- [ ] From the register widths involved
- [ ] From a mode bit set by the operating system
- [ ] From whether the operands were loaded with sign extension

@why It performs one subtraction and sets every flag. `jb` reads carry and asks
the unsigned question; `jl` compares sign against overflow and asks the signed
one.

## Comparing 0xFF against 0x01 in a byte. Which is larger?

- [x] Both answers are correct: 0xFF is above as unsigned and below as signed
- [ ] 0xFF, because the comparison is unsigned by default
- [ ] 0x01, because the top bit makes 0xFF negative
- [ ] It is undefined without a signedness annotation

@why As unsigned that is 255 against 1; as signed it is -1 against 1. The bits
are identical and only the jump records which you wanted.

## What does the carry flag mean after an addition?

- [x] The unsigned result did not fit, and this is the bit that did not
- [ ] The signed result had the wrong sign
- [ ] The result was zero
- [ ] A borrow occurred from a lower word

@why It is why multi-word addition works: add the low words, then add the high
words plus the carry.

## What does the overflow flag mean after an addition?

- [x] Two operands of one sign produced a result of the other, so the signed answer is wrong
- [ ] The result exceeded the register width
- [ ] The result required a carry out of the top bit
- [ ] The operation saturated

@why Add 0x7F and 0x01 in a byte and you get 0x80, which as signed is -128. Two
positives cannot produce a negative, so the flag says the answer is wrong.

## What is the advantage of a conditional move over a branch?

- [x] Nothing to predict, and it takes the same time whichever way the condition goes
- [ ] It is always faster
- [ ] It uses fewer registers
- [ ] It can be executed speculatively where a branch cannot

@why That makes it a win for unpredictable conditions and a loss for predictable
ones, since a correctly predicted branch is nearly free while a conditional move
always waits for its input.

## Why is cryptographic code written with conditional moves?

- [x] Constant time either way means the timing does not leak which branch was taken
- [ ] They cannot be reordered by the processor
- [ ] They are immune to speculative execution attacks
- [ ] They avoid touching the flags

@why It is the same property that makes them useful for unpredictable branches,
used for a different reason, and Part XV depends on it.

## What happens if an `add` sits between a `cmp` and the branch that reads it?

- [x] The branch tests the addition's flags, silently, because nothing in the syntax connects them
- [ ] The assembler warns about a flag dependency
- [ ] The processor preserves the older flags for the branch
- [ ] Nothing, since `add` writes only the carry flag

@why The flags are one register written by almost every arithmetic instruction,
so the distance between setting them and using them is not free to choose.

## Why do compilers emit `add 1` rather than `inc`?

- [x] `inc` updates every flag except carry, and merging the old carry has cost a stall
- [ ] `inc` is longer to encode
- [ ] `inc` cannot address memory
- [ ] `inc` is deprecated in 64-bit mode

@why A hand-written `inc` in a hot loop has been a measurable regression more
than once, for exactly this reason.

## What does `mov rax, [rip + offset]` buy you?

- [x] The block can be loaded anywhere, since nothing in the encoding names an absolute address
- [ ] Faster loads, since the address needs no register
- [ ] Access to memory above the four gigabyte boundary
- [ ] Automatic bounds checking against the code segment

@why It is what makes position-independent executables possible and address space
layout randomisation able to move things.

## How did position independence work on 32-bit x86?

- [x] It cost a register and a helper call per access, because there was no such addressing mode
- [ ] It was not supported at all
- [ ] The loader rewrote every absolute address at load time
- [ ] A segment register held the base and was added automatically

@why Adding one addressing mode removed a whole category of overhead, which is
why position independence is the default everywhere now.
