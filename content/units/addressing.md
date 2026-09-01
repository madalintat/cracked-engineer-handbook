---
needs: [registers, encoding]
minutes: 50
one_idea: One instruction can compute base plus index times scale plus displacement, and a comparison is a subtraction whose result is thrown away.
sources: [x86-64-assembly, cpu-architectures]
---

Two pieces of machinery sit under almost every line of compiled code, and
neither of them looks like a feature when you first meet it.

The first is how the processor works out which byte you meant. The second is how
a comparison turns into a branch, which involves a register nobody named in the
source and four bits that answer different questions about the same subtraction.

## The address that arrives for free

x86-64 lets an operand name a memory location like this:

```
mov rax, [rbx + rcx*8 + 16]
```

That is base plus index times scale plus displacement, and the processor
computes it as part of the load. Not a separate add and a separate shift: the
address generation unit does it while the instruction is in flight, and the whole
thing costs one instruction.

The scale is restricted to 1, 2, 4 or 8, and the reason is visible the moment you
write out an array access. If `rbx` holds the base of an array of eight-byte
values and `rcx` holds the index, that line is `array[i]`, and the displacement
handles a field offset inside a struct at the same time. One instruction for what
the source spells as a multiply, an add and a dereference.

This is why array indexing on this machine is close to free, and it is worth
remembering when Part X compares data layouts. The cost of `a[i]` is not the
arithmetic.

```figure
{
  "kind": "bits",
  "alt": "The four parts of a memory operand shown as fields: base register, index register, scale of one two four or eight, and a signed displacement.",
  "caption": "Every memory operand is these four parts, and any of them may be omitted. The processor adds them before the load, at no cost you can measure.",
  "bits": 32,
  "groups": [
    { "from": 0,  "to": 7,  "label": "displacement", "accent": "gold" },
    { "from": 8,  "to": 15, "label": "scale", "accent": "copper" },
    { "from": 16, "to": 23, "label": "index", "accent": "azure" },
    { "from": 24, "to": 31, "label": "base", "accent": "jade" }
  ]
}
```

## The instruction that does arithmetic by accident

Because the address calculation is general, somebody noticed you could ask for
the address and never do the load.

```
lea rax, [rdi + rdi*4]      ; rax = rdi * 5
```

`lea` means load effective address, and it is the closest thing x86-64 has to a
three-operand arithmetic instruction. It adds two registers, scales one of them,
adds a constant, and writes the result somewhere that is not either input.

Compilers use it constantly and not for addresses. It multiplies by 3, 5 and 9 in
one instruction. It adds two registers without destroying either. And it does all
of that without touching the flags, which turns out to matter.

## Flags, and the register nobody declares

Now the second piece. A comparison in your source becomes two instructions, and
the value that connects them is not in any register you named.

```
cmp rax, rbx        ; compute rax - rbx, throw the answer away
jl  somewhere       ; jump based on what that subtraction set
```

`cmp` is a subtraction whose result is discarded. What survives is the flags: a
handful of bits in a status register that record properties of the result. `test`
is the same trick with a bitwise and, which is why `test rax, rax` is how you ask
whether a value is zero.

Four flags matter here.

The zero flag is set when the result was zero, which means the operands were
equal. The sign flag is the top bit of the result. The carry flag is set when the
subtraction borrowed, which is unsigned overflow. The overflow flag is set when
the result's sign is wrong for the operands' signs, which is signed overflow.

## Two questions, two answers, one pair of bits

Here is the part that produces real bugs.

The processor does not know whether your bytes are signed. It performs one
subtraction and sets all four flags, and it is the branch you choose afterwards
that decides which interpretation you meant.

`jb` jumps if below, which reads the carry flag, and it is the unsigned
comparison. `jl` jumps if less, which compares the sign and overflow flags, and
it is the signed one. Same `cmp`, same bits, different question.

Take `cmp` between 0xFF and 0x01 in a byte. As unsigned that is 255 against 1,
so 0xFF is above. As signed it is -1 against 1, so 0xFF is below. Both answers
are correct and they disagree, and only the jump you wrote records which you
wanted.

This is exactly the bug from unit 015, where a comparator that treated its
operands as unsigned disagreed with a signed reference on half the input space.
Here it is one letter in a mnemonic.

## Carry against overflow

These two get confused because both mean "the answer did not fit".

Carry is about unsigned arithmetic. Add 0xFF and 0x01 in a byte and the true
answer is 256, which needs a ninth bit. The carry flag is that ninth bit, and it
is why multi-word addition works: add the low words, then add the high words plus
the carry.

Overflow is about signed arithmetic. Add 0x7F and 0x01 in a byte and the result
is 0x80, which as signed is -128. Two positives produced a negative, which is
impossible, so the overflow flag says the answer is wrong.

The same addition sets carry and not overflow, or overflow and not carry, or
both, or neither, depending only on the values. The processor computes both every
time because it has no idea which one you care about.

## The branch you can avoid

Once flags exist, there is another thing to do with them besides jumping.

```
cmp  rdi, rsi
cmovl rax, rdx      ; move only if the comparison said less
```

A conditional move reads the flags and either performs the move or does not. No
branch, so nothing to predict and nothing to mispredict, which unit 025 will show
costs around fifteen cycles when it goes wrong.

That makes conditional moves attractive for unpredictable conditions and a loss
for predictable ones, because a correctly predicted branch is nearly free while a
conditional move always waits for its input.

It also has a property Part XV depends on. A conditional move takes the same time
whichever way the condition goes, so it does not leak which way through timing.
Cryptographic code is written this way on purpose.

## Flags are shared state

The awkward part of this design is that the flags are one register and almost
every arithmetic instruction writes them.

So the distance between setting a flag and using it is not free to choose. Put an
`add` between the `cmp` and the `jl` and the branch tests the wrong subtraction,
silently, because nothing in the syntax connects them.

This is also why `inc` and `add 1` are not interchangeable. `inc` updates every
flag except carry, which means the processor has to merge the old carry with the
new flags, and on several generations that merge cost a stall. Compilers emit
`add` for that reason, and a hand-written `inc` in a hot loop has been a
measurable regression more than once.

`lea` avoiding the flags entirely, mentioned above, is the same design pressure
seen from the other side: an instruction that does arithmetic without disturbing
a comparison in progress is more useful than one that does not.

## Where the code itself lives

One last mode, because it is in every function you will disassemble.

```
mov rax, [rip + offset]
```

The address is relative to the instruction pointer. Nothing in the encoding names
an absolute address, so the whole block can be loaded anywhere and still work,
which is what makes position-independent executables possible and is why address
space layout randomisation can move things.

The 32-bit predecessor had no such mode, and position independence there cost a
register and a helper call per access. Adding this one addressing mode removed a
whole category of overhead, and it is the reason it is the default everywhere
now.

## What to carry forward

An address is base plus index times scale plus displacement, computed as part of
the instruction, which is why indexing costs nothing and why `lea` is an
arithmetic instruction.

A comparison is a subtraction that keeps only its side effects, and the same four
bits answer both the signed and the unsigned question. Which one you asked is
recorded in the jump, not in the compare.

## Reading the errors you are about to see

These are raw x86-64, assembled and run with no library underneath, so a
function returns its value in `rax` because the convention says so and nothing
enforces it.

`nonzero-exit` means the checks ran and your answer was wrong. `signal` usually
means an address you computed pointed somewhere real memory is not. `compile-error`
is the assembler, and it names the line.
