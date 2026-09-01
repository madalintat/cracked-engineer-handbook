## register
A named location inside the processor core, addressed by a name in the
instruction encoding rather than by an address. There are sixteen
general-purpose ones on x86-64, and that number is the constraint every
optimisation above this layer works against.
@see calling-convention, spilling

## calling-convention
The agreement about which registers carry arguments, which returns a value, and
which a function must leave as it found them. Nothing in the processor enforces
it. It matters the moment one side of a call is code you did not write.
@see register, callee-saved

## callee-saved
A register a called function must restore before returning, so a caller can
keep something in it across a call. The rest are caller-saved and may be
destroyed freely. The split exists because either rule alone wastes work.
@see calling-convention, register

## spilling
Keeping a value in memory because there is no free register for it, and moving
it back and forth around the uses. With sixteen registers and more live values
than that, something has to spill, and it is the most common reason compiled
output is slower than expected.
@see register, callee-saved

## syscall
The instruction that asks the kernel to do something the process cannot do
itself. On Linux x86-64 the number goes in `rax` and the arguments follow the
same order as a function call with one substitution, because the instruction
overwrites `rcx` with the return address.
@see calling-convention
