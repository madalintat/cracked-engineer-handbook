# Embedded and Single-Board Computing

*Research for the hardware curriculum: the middle of the range, from a NAND gate to a datacenter GPU.*

Everything marked **[verified]** was checked against a primary source or reproduced by
actually compiling it. Everything marked **[unverified]** is stated on weaker evidence and
should be checked before it goes in front of students. Compile transcripts in section 7 are
real output from Compiler Explorer's API, captured during this research.

---

## 1. The fundamental distinction, made precise

The words *microcontroller*, *microprocessor*, *SoC*, *FPGA* and *ASIC* are used loosely in
practice, including by vendors. There are, however, real criteria underneath. The useful move
for a curriculum is to stop treating them as five points on a single "power" axis — they are
not — and instead separate the questions that actually differ.

### 1.1 The five questions that separate them

| Question | MCU | MPU | SoC | FPGA | ASIC |
|---|---|---|---|---|---|
| Where does code live? | on-die flash | external DRAM, loaded by a boot chain | external DRAM | there is no code; there is a bitstream | there is no code |
| Is the memory system deterministic? | yes — SRAM, fixed latency | no — caches, DRAM refresh, TLB | no | yes | yes |
| Is there an MMU? | no (MPU at most) | yes | yes | n/a | n/a |
| Can it run stock Linux? | no | yes | yes | only via a hard or soft CPU core | only if you designed one |
| What is "reset" to? | your `main()`, in microseconds | a ROM bootloader, then seconds of boot | same | load bitstream, then logic is live | logic is live |

The last row is the one students underrate, and it is the one that predicts the most about how
a system behaves in the field.

### 1.2 Microcontroller

**Defining criterion: the entire computer is on one die, and the program executes from
non-volatile memory that is also on that die.** An ATmega328P with no external components but
a decoupling capacitor is a complete computer. Flash, SRAM, the CPU, the timers, the ADC, the
oscillator — all one piece of silicon.

Consequences that follow *from that one fact*, which is why it is the right criterion:

- **No boot process worth the name.** On reset the core begins executing at a fixed address.
  There is no bootloader stage that fetches an OS image, because the program is already in the
  address space. Time from power-on to your first line of C is microseconds to low
  milliseconds.
- **Deterministic timing.** On-die SRAM has fixed, single-digit-cycle access latency. There is
  no cache, so there are no cache misses; there is no DRAM, so there is no refresh stall and no
  row-buffer conflict; there is no MMU, so there is no TLB miss and no page fault. An
  instruction sequence takes the same number of cycles every time it runs. This is the property
  that makes an MCU able to bit-bang a protocol, and it is *lost* the moment you add a cache —
  which is why Cortex-M7 parts with a D-cache reintroduce a class of timing bug that M0 parts
  simply cannot have.
- **No operating system is required, and usually there isn't one.** The default architecture is
  a `main()` with a `while(1)` in it. An RTOS is a library you link, not a thing you boot.
- **Memory is tiny and statically known.** 2 KB of SRAM on a 328P. `malloc` exists in avr-libc
  but using it is widely considered a mistake in this class of system, because fragmentation in
  2 KB is unrecoverable and there is no MMU to give you a fresh address space.
- **Peripherals are the point.** The CPU is often the least interesting part. You choose an MCU
  for its timers, its ADC, its CAN controller, its radio.

### 1.3 Microprocessor

**Defining criterion: the CPU die does not contain the program's working memory, and generally
contains no non-volatile program storage either.** It requires external DRAM and an external
boot medium to be a computer at all.

This forces the boot chain that MCU people find so strange: the part cannot execute your kernel
directly, because at power-on the DRAM controller is not yet trained and the DRAM contains
noise. So an on-die mask ROM runs first, brings up just enough of the chip to load a small
first-stage bootloader into on-die SRAM, which initialises DRAM, which lets a second-stage
loader (U-Boot, or Raspberry Pi's `start.elf`) load a kernel. Multi-second boot times are a
structural consequence, not sloppiness.

Because there is an MMU, there can be virtual memory, process isolation, and demand paging —
which is what makes a general-purpose OS possible. **This is the single hardest line in the
whole taxonomy: an MMU is a hard requirement for stock Linux.** Cortex-M parts have an MPU
(a region-based memory *protection* unit — it can say "this region is read-only to unprivileged
code" but it cannot *translate* addresses), and no amount of effort will run mainline Linux on
one. Cortex-A and the MMU-equipped Cortex-R parts can.

### 1.4 SoC

**"SoC" is a packaging-and-integration claim, not an architectural class.** It says: this die
carries a CPU complex plus a substantial set of non-CPU subsystems — GPU, video codec, memory
controller, display pipeline, USB, radios.

The honest thing to tell students is that *a microcontroller is also a system on a chip*, and
that the industry uses "SoC" to mean "application processor with lots of integrated
peripherals" purely by convention. The BCM2712 in a Pi 5 is an SoC; so is an ESP32; so, on the
literal meaning, is an ATmega328P. What makes the term worth keeping is that it flags where the
complexity lives: in a modern SoC, the CPU cores are a minority of the die area, and there are
typically several *other* processors on the die running their own firmware. On a Raspberry Pi,
the VideoCore GPU boots *before* the Arm cores do and is in a real sense the primary processor —
a fact that surprises people and is worth teaching precisely because it breaks the mental model
of "the CPU is in charge."

### 1.5 FPGA

**Defining criterion: there are no instructions. You are not writing a program that a fixed
datapath executes; you are describing a circuit, and the fabric becomes that circuit.**

This is the category error to head off early. An FPGA does not "run" Verilog. Verilog is
*synthesised* into a netlist of lookup tables and flip-flops, which is *placed and routed* onto
physical resources, which is emitted as a *bitstream* that sets millions of configuration bits.
After configuration, the chip is a piece of hardware that does what you described, in parallel,
every clock edge, forever. A `for` loop in synthesisable Verilog does not iterate in time — it
unrolls into that many copies of the hardware, in space.

The consequence: an FPGA's "performance" is measured in Fmax (the highest clock the critical
path allows) and in how many operations you did per cycle, not in instructions per second. And
its response latency can be a single clock cycle — nanoseconds, with zero jitter — which no
software system can match.

### 1.6 ASIC

**Defining criterion: the circuit is fixed in the mask set at manufacture.** Same design
concept as an FPGA, but committed to silicon rather than emulated on a configurable fabric.

The trade is entirely economic and physical. An FPGA pays roughly an order of magnitude in
area, power and clock speed for its configurability — the LUTs and, more importantly, the
programmable routing that connects them, which typically dominates the die. An ASIC pays that
back but requires non-recurring engineering and a mask set that runs from tens of thousands of
dollars on an old node to millions at a leading node. So: FPGA for low volume, for designs
that must change, and for prototyping; ASIC once volume amortises the NRE.

The datacenter GPU at the far end of this curriculum is an ASIC. So is the ATmega328P at the
near end. The category spans the whole course, which is a useful thing to point out.

### 1.7 The distinction that actually matters for a programmer

If a student remembers one thing from this section, make it this:

> **An OS buys you abstraction and costs you determinism. That is the trade, and it is not
> negotiable.**

Everything downstream follows. You take Linux when you want a filesystem, a TCP stack, memory
protection, and the ability to run software you did not write. You refuse it when you need to
guarantee that a pin changes state within a bounded number of nanoseconds — because a
general-purpose kernel's scheduler, its interrupt handling, its page faults and its power
management all inject unbounded latency, and the mitigations (`PREEMPT_RT`, CPU isolation,
locked pages) reduce the tail without ever removing it.

Section 3.5 gives the concrete version of this with numbers.

---

## 2. Arduino and AVR

Primary sources: the ATmega328P datasheet **DS40002061A**, the **AVR Instruction Set Manual
DS40002198C**, the avr-libc 2.1.0 manual, and the ArduinoCore-avr source.

### 2.1 The ATmega328P core

**Headline numbers**, from page 1 of the datasheet: *"131 Powerful Instructions – Most Single
Clock Cycle Execution"*, *"32 x 8 General Purpose Working Registers"*, *"Up to 20 MIPS Throughput
at 20MHz"*, and an *"On-chip 2-cycle Multiplier"*. Memory: **32 KB flash, 2 KB SRAM, 1 KB
EEPROM**. The speed grade is *"0 - 20MHz @ 4.5 - 5.5V"* — so the Uno's **16 MHz is well inside
the silicon limit**, and was chosen for clean USB-serial baud divisors, not because the part
could not go faster.

*(A datasheet-reading tip worth teaching: this document covers the ATmega48A/PA/88A/PA/168A/PA/328/P
as one family, so every memory figure appears as a slash-list. The **last** value is the 328P.
Students misread this constantly.)*

**Harvard architecture and the pipeline** (§7.6): two separate address spaces, and the fetch of
instruction *n+1* overlaps the execute of *n* — *"This is the basic pipelining concept to obtain
up to 1 MIPS per MHz."* A single-cycle ALU operation performs operand fetch, ALU and writeback
within one `clk_CPU`. There is no internal clock division: the CPU runs directly at the crystal
frequency, which is a large part of why AVR timing is so easy to reason about.

**The register file** (§7.4). R0–R31, each also mapped into data space at 0x00–0x1F. Three
pointer pairs:

| Pair | Registers | Notes |
|---|---|---|
| **X** | R27:R26 | `LD/ST X, X+, -X` — the free general pointer |
| **Y** | R29:R28 | supports **displacement** `LDD/STD Y+q` → avr-gcc's frame pointer |
| **Z** | R31:R30 | the **only** pointer `LPM`, `ICALL` and `IJMP` accept |

Why this matters: the AVR has no "any register can be a pointer" mode. There are exactly three
pointers, and two of them have mandatory special jobs — Y is the frame pointer, Z is the
flash-access and indirect-call register. That leaves X as the only genuinely free pointer, and
it is the root cause of avr-gcc's register pressure on pointer-heavy C.

**The R16–R31 immediate constraint** — the most consequential asymmetry in the ISA. A 16-bit
opcode that spends 8 bits on an immediate has only 4 bits left for the register field. So, per
the Instruction Set Manual, these instructions accept **only 16 ≤ d ≤ 31**: `LDI`, `ANDI`,
`ORI`, `SBR`, `CBR`, `SUBI`, `SBCI`, `CPI`, `SER`, and `MULS` (both operands). The word
operations `ADIW`/`SBIW` are narrower still — only R24, R26, R28, R30.

**Compiler consequence:** R0–R15 cannot hold a constant directly. Anything the compiler wants to
constant-initialise, compare against a literal, or mask must live in R16–R31 or cost an extra
`MOV`. avr-gcc effectively treats the lower half as second-class. This is why AVR code with more
than roughly eight live 8-bit values starts spilling — visible directly in Exercise E.

**The avr-gcc ABI:**

- **Call-clobbered (call-used): R18–R27, R30–R31** — free for a callee to destroy.
- **Call-saved: R2–R17, R28–R29** — a callee must preserve them. Note that **R28:R29 is Y**, the
  frame pointer, which is why the `push r28 / push r29` pair opens so many AVR functions.
- **R1 = `__zero_reg__`**, assumed always zero by all compiler-generated code. It must be
  re-cleared after any `MUL`, because MUL writes its result to R1:R0.
- **R0 = `__tmp_reg__`**, clobberable by anything except an ISR, which saves it.
- **Arguments** are allocated left to right in **R25 down to R8**, each rounded up to an even
  number of registers and aligned to an even-numbered register. The ninth argument onward goes
  on the stack.
- **Returns:** 8-bit in **R24** (not R25), 16-bit in R25:R24, 32-bit in R22–R25, 64-bit in
  R18–R25.
- **Types:** `int` is 16 bits, `long` 32, `long long` 64, and **`float` and `double` are both
  32 bits.** All confirmed by compilation in Exercise E.

**[Note on sourcing — `gcc.gnu.org/wiki/avr-gcc` is currently unreachable**, sitting behind an
anti-bot proof-of-work challenge. The identical upstream text is in the
[avr-libc FAQ](https://www.nongnu.org/avr-libc/user-manual/FAQ.html), "Which registers are used
by the C compiler?", which is what the wiki page was derived from. Cite the FAQ.]

**The memory map** (§8.3, §8.5) — and the reason `sbi` exists:

| Range | Contents | Reachable by |
|---|---|---|
| `0x0000–0x001F` | the 32 registers | register operands, and `LD`/`ST` as data |
| `0x0020–0x005F` | 64 standard I/O registers | `IN`/`OUT` (I/O addr 0x00–0x3F), or `LD`/`ST` at +0x20 |
| `0x0060–0x00FF` | 160 **extended** I/O registers | **only** `LD`/`LDS`/`LDD` and `ST`/`STS`/`STD` |
| `0x0100–0x08FF` | 2048 bytes of SRAM | all addressing modes |

The datasheet is explicit: *"I/O Registers within the address range **0x00 - 0x1F** are directly
bit-accessible using the **SBI and CBI** instructions… When using the I/O specific commands IN
and OUT, the I/O addresses **0x00 - 0x3F** must be used. When addressing I/O Registers as data
space using LD and ST instructions, **0x20 must be added** to these addresses."*

**Why `sbi`/`cbi` only reach the low 32:** those instructions encode the I/O address in **5
bits** (0 ≤ A ≤ 31). `IN`/`OUT` get 6 bits (0 ≤ A ≤ 63). Above 0x3F there is no I/O encoding at
all. This lands directly in real code — from avr-libc's `iom328p.h`:

```c
#define PINB   _SFR_IO8(0x03)   /* I/O 0x03 -> sbi/cbi OK  */
#define DDRB   _SFR_IO8(0x04)
#define PORTB  _SFR_IO8(0x05)   /* I/O 0x05 -> PORTB |= _BV(5) is ONE sbi */
#define TCCR0A _SFR_IO8(0x24)   /* I/O 0x24 -> IN/OUT only, NOT sbi/cbi   */
#define ADCSRA _SFR_MEM8(0x7A)  /* extended I/O -> LDS/STS only           */
```

So Arduino's `cbi(TCCR0A, COM0A1)` compiles to `in`/`andi`/`out` (3 cycles), while
`cbi(TCCR1A, …)` — TCCR1A is at data address 0x80, extended I/O — compiles to `lds`/`andi`/`sts`
(**6 cycles**). The address of a register determines what it costs to touch. That is a genuinely
surprising and memorable idea.

**Instruction set character** (cycle counts from DS40002198C, AVRe column; the ATmega328P is
AVRe+, and the manual states the two do not differ in cycle counts):

| Instruction class | Cycles |
|---|---|
| ALU ops, `LDI`, `CPI`, `IN`, `OUT` | **1** |
| `MUL`, `MULS`, `MULSU`, `FMUL` | **2** |
| `SBI`, `CBI` | **2** |
| `LD`/`ST`/`LDS`/`STS`, `PUSH`/`POP` | **2** |
| `LPM` (all forms) | **3** |
| `RJMP` 2, `RCALL`/`ICALL` 3, `CALL` 4, `RET`/`RETI` 4 | |
| `SBRC`/`SBRS`/`SBIC`/`SBIS` | 1 / 2 / 3 depending on skip |

**There is no divide instruction of any kind.** Division in C becomes a libgcc call
(`__udivmodhi4`, `__udivmodsi4`) costing hundreds of cycles. The most useful performance rule to
teach on this chip is therefore: **multiply is 2 cycles, divide is a function call, and shifting
is 1 cycle per bit.**

**Why PROGMEM exists.** The avr-libc manual states the problem exactly:

> *"The AVR is a Harvard architecture processor, where Flash is used for the program, RAM is
> used for data, and they each have separate address spaces… The problem is exacerbated by the
> fact that the C Language was not designed for Harvard architectures, it was designed for Von
> Neumann architectures where code and data exist in the same address space."*

And the trap students must be warned about explicitly — **`const` is not `PROGMEM`**:

> *"Many users bring up the idea of using C's keyword `const` as a means of declaring data to be
> in Program Space. Doing this would be an abuse of the intended meaning of the `const` keyword.
> `const` is used to tell the compiler that the data is to be 'read-only'… not as a means to
> identify where the data should be stored."*

A `const` array on AVR is **copied from flash into SRAM at startup and consumes both**. That is
the classic "why did my 2 KB of RAM vanish" bug, and it is visible in one instruction
**[verified — real output, `-Os -mmcu=atmega328p`]**:

```c
const uint8_t plain_const[8] = {1,2,3,4,5,6,7,8};
const uint8_t in_flash[8] PROGMEM = {1,2,3,4,5,6,7,8};
uint8_t read_const(uint8_t i){ return plain_const[i]; }
uint8_t read_flash(uint8_t i){ return pgm_read_byte(&in_flash[i]); }
```

```asm
read_const:                       read_flash:
  mov r30,r24                       mov r30,r24
  ldi r31,0                         ldi r31,0
  subi r30,lo8(-(plain_const))      subi r30,lo8(-(in_flash))
  sbci r31,hi8(-(plain_const))      sbci r31,hi8(-(in_flash))
  ld  r24,Z    ; <-- DATA space      lpm r24,Z    ; <-- PROGRAM space
  ret                               ret
```

Identical address arithmetic; **`ld` versus `lpm`**. The `const` array is read from SRAM, which
means a startup copy put it there and it is occupying 8 of your 2048 bytes forever. Two
instructions, one letter apart, and one of them costs you RAM. `PROGMEM` data must be read through
`pgm_read_byte`/`pgm_read_word`, which emit `LPM` (3 cycles) via Z — and the resulting pointer is
a *different kind of pointer* that the type system does not protect you from confusing with a
RAM pointer. Newer avr-gcc offers named address spaces (`__flash`) as a cleaner alternative.

Other timings worth knowing: **SRAM access is 2 cycles**; an EEPROM read **halts the CPU for
four cycles**.

### 2.2 `digitalWrite` versus direct port manipulation

This is the centrepiece lesson, and section 7's Exercise A is the machine-checkable version.
The essentials:

The real source (`ArduinoCore-avr/cores/arduino/wiring_digital.c`, LGPL-2.1) does **four PROGMEM
table lookups**, a validity check, a **switch over six PWM timers** to undo any prior
`analogWrite`, and then a pointer-based read-modify-write wrapped in `cli()`/SREG-restore.

**Why the `cli()` is genuinely necessary** — this is the part usually skipped, and it matters:
`*out |= bit` on a *variable* pointer cannot become `SBI`, because `SBI` needs a compile-time
constant I/O address and bit number, and here both are runtime values from a table. So it
compiles to `LD`/`OR`/`ST` — a real, interruptible read-modify-write on a shared port register.
If an ISR wrote a different bit of the same port between the `LD` and the `ST`, that write would
be silently lost. **The critical section is correct and necessary — and it is exactly the cost
that vanishes when the compiler can emit `SBI`, because `SBI` is atomic in hardware.**

**The numbers, three ways:**

- **Static cycle count from the disassembly: 52 cycles** for the pin-13 path, ~58 including the
  call. Counted independently twice during this research, from avr-gcc 7.3.0 and 14.2.0 output.
- **Published scope measurement:** Bill Grundmann, *"To use or not use digitalWrite"* (3 March
  2009), [billgrundmann.wordpress.com](https://billgrundmann.wordpress.com/2009/03/03/to-use-or-not-use-writedigital/), put a scope on a 16 MHz Arduino: *"The waveform high time is about
  **3.3 µsec (~53 clock cycles)**, the low time is about 3.45 µsec (~55 clock cycles)."*
- **Direct port write: 2 cycles, 125 ns.** Grundmann again: *"Now the high time is only 125 ns
  (only 2 clocks)… and a pulsing frequency of 2.7 MHz."*

So a **26–29× penalty**, plus ~20 bytes of flash per call site. The measured and the static
counts agree closely, which is a nice thing to show students: you can predict hardware behaviour
from the listing.

Grundmann also documents the toggle trick, which the datasheet confirms (§14, "Toggling the
Pin"): writing a 1 to a `PINx` bit **toggles** the corresponding output in hardware — one `SBI`,
no read-modify-write, no `cli()`. It is the fastest legal way to toggle an AVR pin.

**The teaching frame, stated fairly.** `digitalWrite` is not badly written; it honours a
*different contract*. It accepts a runtime pin number, works unchanged across every AVR from the
ATmega8 to the ATmega2560, silently undoes a prior `analogWrite`, and is interrupt-safe. All four
properties cost cycles, and the direct `SBI` gives up every one of them. **Generality bought with
cycles, at a knowable and measurable price** — that is the transferable lesson, and it applies
equally to an STM32 HAL call.

*(The Arduino authors knew. The comment above `turnOffPWM` in the real source reads: "But
shouldn't this be moved into pinMode? Seems silly to check and do on each digitalread or write."
It is a design apology, in the shipping code.)*

### 2.3 Timers, PWM, ADC

**Timer inventory:** Timer0 (8-bit, → Uno pins 5 and 6), Timer1 (**16-bit**, with input capture,
→ pins 9 and 10), Timer2 (8-bit, with **asynchronous operation** off a 32.768 kHz watch crystal
for RTC use, → pins 3 and 11).

**Prescalers** are not uniform, and the asymmetry is explicable: Timer0 and Timer1 offer
/1, /8, /64, /256, /1024 plus an external clock pin. Timer2 uniquely offers **/32 and /128** as
well, and no external pin — because those divisors give convenient sub-multiples of 32.768 kHz
for real-time-clock work.

**PWM modes:**
- **Fast PWM** — single-slope, counter runs BOTTOM→TOP: f = f_clk / (N · **256**)
- **Phase-correct PWM** — dual-slope, counts up then down, so edges stay centred and there is no
  glitch when the duty changes: f = f_clk / (N · **510**)

(510 rather than 512 because TOP and BOTTOM are each visited once per period, not twice.)

**Why `analogWrite()` is 490 Hz on some Uno pins and 980 Hz on others.** This is a great puzzle
because the answer is a *deliberate compatibility decision*, visible in a source comment. From
`ArduinoCore-avr/cores/arduino/wiring.c`, `init()`:

```c
// on the ATmega168, timer 0 is also used for fast hardware pwm
// (using phase-correct PWM would mean that timer 0 overflowed half as often
// resulting in different millis() behavior on the ATmega8 and ATmega168)
    sbi(TCCR0A, WGM01); sbi(TCCR0A, WGM00);   // Timer0 = FAST PWM
// timers 1 and 2 are used for phase-correct hardware pwm
// this is better for motors as it ensures an even waveform
    sbi(TCCR1A, WGM10);                        // Timer1 = 8-bit PHASE-CORRECT
    sbi(TCCR2A, WGM20);                        // Timer2 = 8-bit PHASE-CORRECT
```

All three run at prescaler 64, so at 16 MHz:

- Timer0 (**fast**): 16 000 000 / (64 × 256) = **976.6 Hz** → the "980 Hz" pins
- Timers 1 and 2 (**phase-correct**): 16 000 000 / (64 × 510) = **490.2 Hz** → the "490 Hz" pins

And pins 5 and 6 are exactly the Timer0 pins. **Timer0 is in fast PWM because it also drives
`millis()`**, and phase-correct would halve its overflow rate and change `millis()` behaviour
relative to the ATmega8. A user-visible frequency oddity that exists purely to preserve a
timekeeping API — an excellent illustration of how embedded design decisions propagate.

Note also that Timer1 is 16-bit but the core deliberately clamps it to 8-bit phase-correct
(TOP = 0xFF) so that all six PWM pins accept the same 0–255 argument.

**The ADC** (§24): 10-bit **successive approximation**, 6 channels on the PDIP part, plus an
internal 1.1 V bandgap reference and a temperature sensor. The two rules that determine
everything:

> *"the successive approximation circuitry requires an input clock frequency between **50kHz and
> 200kHz** to get maximum resolution"* … *"A normal conversion takes **13 ADC clock cycles**. The
> first conversion after the ADC is switched on takes 25 ADC clock cycles in order to initialize
> the analog circuitry."*

**Why `analogRead()` takes about 100 µs:** `wiring.c` selects prescaler ÷128 at 16 MHz, giving an
ADC clock of **125 kHz** — as close to the top of the legal window as the power-of-two dividers
allow. One conversion is therefore 13 / 125 000 = **104 µs**, and `analogRead()` busy-waits on
`ADSC` for the whole time. Arduino's own reference agrees: *"it takes about 100 microseconds
(0.0001 s) to read an analog input, so the maximum reading rate is about 10,000 times a second."*

A good exercise follows immediately: dropping to ÷16 gives a 1 MHz ADC clock and 13 µs
conversions at reduced effective resolution — a trade the datasheet explicitly sanctions.

### 2.4 Interrupts and the avr-libc model

**The vector table** sits at the bottom of flash — 26 vectors, 2 words apart, each slot holding
a `JMP`. **Priority is address order**: *"The lower the Interrupt Vector address, the higher the
priority."* RESET first, then INT0. This is **fixed in silicon** — there is no priority register
and no NVIC. That single fact is the cleanest contrast available with Cortex-M.

**Hardware response cost** (§7.7.1): *"The interrupt execution response for all the enabled AVR
interrupts is **four clock cycles minimum**… the vector is normally a jump to the interrupt
routine, and this jump takes **three clock cycles**… A return from an interrupt handling routine
takes **four clock cycles**."* Also: on entry the global interrupt enable bit is cleared; on
`RETI` the CPU *"will always execute one more instruction before any pending interrupt is
served"*; and critically — *"**the Status Register is not automatically stored** when entering an
interrupt routine, nor restored when returning. This must be handled by software."*

**Why an ISR is expensive.** avr-libc explains the mechanism plainly: *"The compiler uses, by
convention, a set of registers when it's normally executing compiler-generated code. It's
important that these registers, as well as the status register, get saved and restored. The extra
code needed to do this is enabled by tagging the interrupt function with
`__attribute__((signal))`."*

There is **no hardware register stacking**. The compiler must push every call-clobbered register
the ISR body touches, plus R0, R1 and SREG, at 2 cycles each way. Measured by **Nick Gammon**
([gammon.com.au/forum/?id=11488](http://www.gammon.com.au/forum/?id=11488), disassembly with
annotated cycle counts), a minimal `ISR()` touching four registers costs *"16 + 7 cycles
(**23 cycles**)… **1.4375 µS**"* to reach your first line, and *"another **19 clock cycles**"* to
return — **42 cycles of pure overhead**. And `attachInterrupt()`, which dispatches through a
function pointer and must therefore save the *entire* clobber set, costs **82 cycles / 5.125 µs**.
That is a concrete, citable reason to write `ISR(INT0_vect)` directly rather than use
`attachInterrupt()`.

Note the `eor r1, r1` in every ISR prologue: the handler cannot assume R1 is zero, because it may
have interrupted the two-instruction window between a `MUL` (which writes R1:R0) and gcc's
re-clear.

**ISR attributes** worth knowing: `ISR_BLOCK` (the default — interrupts stay off);
`ISR_NOBLOCK` (the compiler emits `sei()` as early as possible in the prologue to allow nesting —
*"care should be taken to avoid stack overflows"*); `ISR_NAKED` (no prologue or epilogue at all,
you must supply `reti()` yourself, and the `__zero_reg__` assumption may be wrong);
`ISR_ALIASOF`; `EMPTY_INTERRUPT`; and **`BADISR_vect`**, the catch-all, whose default
implementation **resets the application** — which is why an unhandled interrupt on AVR
manifests as a spontaneous reboot rather than a fault.

**The atomic-access problem**, in avr-libc's own words:

> *"A typical example that requires atomic access is a 16 (or more) bit variable that is shared
> between the main execution path and an ISR. While declaring such a variable as `volatile`
> ensures that the compiler will not optimize accesses to it away, **it does not guarantee atomic
> access to it**."*

Their worked failure is worth reproducing in the course: a `volatile uint16_t ctr` decremented in
an ISR and polled by `while (ctr != 0)`. If `ctr` is 0x100, the main path tests the low byte
(zero — passes), the ISR fires and decrements to 0x00FF, the main path then tests the *new* high
byte (also zero) and concludes the counter reached zero. It never did. Section 7's Exercise D
shows the two `lds` instructions with the window between them, and the `ATOMIC_BLOCK` fix.

**The avr-libc model in brief.** `<avr/io.h>` pulls in the device header, which is a flat list of
`#define`s over `_SFR_IO8`/`_SFR_MEM8`. Stripped down, `PORTB` is literally:

```c
#define _MMIO_BYTE(addr)  (*(volatile uint8_t *)(addr))
#define _SFR_IO8(io_addr) _MMIO_BYTE((io_addr) + 0x20)
#define PORTB             _SFR_IO8(0x05)      /* = *(volatile uint8_t *)0x25 */
#define _BV(bit)          (1 << (bit))
```

So `PORTB |= _BV(5)` is an ordinary C read-modify-write on a volatile byte, and it is the
**optimiser** that recognises 0x25 as I/O space with a constant bit and emits `sbi 0x5,5`. This
is exactly why avr-libc deprecated its own `sbi()`/`cbi()` macros: *"This actually is more
flexible than having `sbi` directly, as the optimizer will use a hardware `sbi` if appropriate,
or a read/or/write operation if not appropriate. **You do not need to keep track of which
registers `sbi`/`cbi` will operate on.**"* (Arduino's core still defines its own, as a legacy
holdover.) `_BV()` is pure notation — *"there is no run-time overhead."*

**`<util/delay.h>` and why it is fussy.** The documented requirement: *"compiler optimizations
**must** be enabled, and the delay time **must** be an expression that is a known constant at
compile-time."* The reason is that `_delay_ms()` is not a loop reading a variable — with a
constant argument and optimisation on, GCC folds the arithmetic at compile time and emits
`__builtin_avr_delay_cycles(n)`, an exactly-tuned `ldi`/`dec`/`brne` sequence. At `-O0`, or with
a runtime argument, the floating-point maths survives into the binary, dragging in the whole
soft-float library and producing a delay that is neither accurate nor monotonic. This is the most
common "why doesn't my delay work" bug, and it is another reason to teach at a fixed
optimisation level.

Also worth flagging: `_delay_ms()` is a **spin loop with interrupts left enabled**, so an ISR
firing during it makes it run long. Arduino's `delay()` is different — it polls `millis()`, so it
self-corrects, but it will hang forever if called from inside an ISR.

### 2.5 The modern Arduino boards that are not AVR

All figures from the official board datasheets at `docs.arduino.cc/resources/datasheets/`.

| Board | Silicon | Core | Clock | Memory | Note |
|---|---|---|---|---|---|
| **Uno R4 Minima** | Renesas **RA4M1** (R7FA4M1AB3CFM) | Cortex-**M4** with FPU | **48 MHz** | 256 KB flash, 32 KB SRAM, 8 KB EEPROM | **5 V I/O**, deliberately shield-compatible |
| **Uno R4 WiFi** | same RA4M1 + **ESP32-S3** radio coprocessor | M4 + Xtensa | 48 MHz | same | 5 V MCU and 3.3 V radio on one board, bridged by a TXB0108 level translator |
| **Nano 33 BLE / Sense** | u-blox NINA-B306 (**nRF52840**) | Cortex-**M4F** | **64 MHz** | 1 MB flash, 256 KB RAM | 3.3 V, **not** 5 V tolerant |
| **Nano 33 IoT** | ATSAMD21G18A + NINA-W102 (ESP32) | Cortex-**M0+** | 48 MHz | 256 KB flash, 32 KB SRAM | 3.3 V only |
| **Nano RP2040 Connect** | **RP2040** + NINA-W102 | dual Cortex-**M0+** | 133 MHz | 264 KB SRAM, **no on-chip flash** — 16 MB external QSPI | executes via XIP cache |
| **Portenta H7 / Giga R1** | ST **STM32H747XI** | Cortex-**M7** + Cortex-**M4** | **480 / 240 MHz** | 2 MB flash, 1 MB SRAM, +8 MB SDRAM, +16 MB QSPI | dual-core, cores talk over RPC |
| **Portenta C33** | Renesas **RA6M5** | Cortex-**M33** | **200 MHz** | 2 MB flash, 512 KB SRAM | *(correcting a common claim — this is M33, not M7)* |

**Why the shift matters pedagogically** — four distinct lessons:

**(a) 3.3 V is now the default, with one loud exception.** Nearly all of the modern boards are
3.3 V and explicitly not 5 V tolerant. But the **Uno R4 is deliberately 5 V**, for shield
compatibility — and the R4 WiFi therefore carries a **physical level translator** between its
5 V Renesas MCU and its 3.3 V ESP32-S3. That one board is the best teaching artefact available:
it makes the voltage-domain problem a component you can point at rather than an abstraction.

**(b) The direct-register habit does not transfer.** On AVR, `PORTB |= _BV(5)` is a documented
address and one instruction, and the datasheet is the whole API. The entire Uno R4
implementation, from `ArduinoCore-renesas/cores/arduino/digital.cpp`, is:

```c
void digitalWrite(pin_size_t pin, PinStatus val) {
    R_IOPORT_PinWrite(NULL, g_pin_cfg[pin].pin,
                      val == LOW ? BSP_IO_LEVEL_LOW : BSP_IO_LEVEL_HIGH);
}
```

There is no register in sight. `R_IOPORT_PinWrite` is **Renesas FSP**, a vendor HAL of several
thousand lines with its own driver-instance model; the Nano 33 BLE core goes further and sits on
**mbed OS**. A student who learned "look up the bit in the datasheet and set it" has nothing to
apply. **The skill that transfers is the reasoning — clocks, prescalers, peripheral state
machines, atomicity — not the addresses.** Worth saying out loud in Unit 4.

**(c) The Arduino API is now explicitly a portability layer.** From the ArduinoCore-API README:
*"This repository hosts the **hardware independent layer** of Arduino core… the abstract
definition of the Arduino core API… As of now, the following official cores are utilising
ArduinoCore-API: megaavr, mbed, samd, renesas."* Note what is **missing from that list: `avr`.**
The classic AVR core is the legacy branch; the abstraction was built *around* it, not from it.

**(d) `int` changes size — a real, silent portability trap.** On AVR, `int` is **16 bits** and a
pointer is **2 bytes**; on every ARM Arduino, `int` is 32 bits and a pointer is 4. Arduino's own
reference says so directly. Concrete failures to demonstrate:

```c
int ms = 40000;                    /* silently wraps negative on AVR, fine on ARM */
int total = 0;
for (int i = 0; i < 100; i++) total += analogRead(A0);   /* overflows after 32 reads on AVR */
long x = 1 << 20;                  /* zero on AVR, correct on ARM */
```

And the bonus trap, verified in Exercise E: **`double` is 32 bits on avr-gcc** — `double` and
`float` are the same type — but genuinely 64 bits on the ARM cores, so numeric code silently
changes precision when it moves. The fix to teach from day one is `<stdint.h>`: `int16_t`,
`uint32_t`, `int32_t`.

**[unverified — the Arduino Nano 33 BLE datasheet (ABX00030) never writes "nRF52840"; it names
only the u-blox NINA-B306 module, and the BLE Sense Rev2 datasheet misspells it "nRF52480" twice.
Cite u-blox's NINA-B3 datasheet or Nordic for the part number. Similarly, the Nano 33 IoT
datasheet has a typo ("32 kB Flash" where it means SRAM) — cite Microchip's SAMD21 datasheet.
And the Portenta H7 board datasheet does not state the internal 2 MB / 1 MB figures; those come
from the Giga R1 datasheet describing the same chip.]**

---

## 3. Raspberry Pi

### 3.1 The lineage, 1 through 5

Sources: Raspberry Pi's own [processor documentation](https://www.raspberrypi.com/documentation/computers/processors.html) and the `raspberrypi/documentation` asciidoc source.

| Model | SoC | Core / ISA | Cores | Clock | RAM | What changed |
|---|---|---|---|---|---|---|
| Pi 1 A/B | BCM2835 | ARM1176JZF-S, **ARMv6** + VFPv2 | 1 | 700 MHz | 256→512 MB | The baseline. 26-pin header; Ethernet *and* USB behind one LAN9512 on USB 2.0 |
| Pi 1 A+/B+ | BCM2835 | same | 1 | 700 MHz | 256/512 MB | **The 40-pin header** — frozen ever since. microSD |
| Pi Zero / W | BCM2835 | same | 1 | **1 GHz** | 512 MB (PoP) | Same die clocked up. No Ethernet chip at all — the only genuinely single-chip Pi |
| Pi 2 B v1.1 | **BCM2836** | Cortex-A7, **ARMv7-A** | 4 | 900 MHz | 1 GB | **First ISA break.** Raspberry Pi's own note: the *only* significant change from BCM2835 was swapping the ARM1176 for a quad A7 |
| Pi 2 B v1.2 | **BCM2837** | Cortex-A53, **ARMv8-A** | 4 | 900 MHz | 1 GB | 64-bit-capable silicon, still shipped running 32-bit userland |
| Pi 3 B | BCM2837 | Cortex-A53 | 4 | 1.2 GHz | 1 GB | ~50% faster than Pi 2; first on-board Wi-Fi/BT on a flagship |
| Pi 3 B+ | BCM2837B0 | Cortex-A53 | 4 | **1.4 GHz** | 1 GB | *"The Arm core hardware is the same; only the frequency is rated higher"* + heat spreader. "Gigabit" Ethernet is **300 Mb/s** — still behind USB 2.0 |
| Pi 4 B | **BCM2711** | Cortex-A72 | 4 | 1.5→**1.8 GHz** | 1–8 GB LPDDR4 | **Real gigabit Ethernet attached natively to the SoC**, and an internal PCIe link carrying the VL805 USB 3.0 controller. L1 32 kB D + 48 kB I/core; **1 MB shared L2, no L3** |
| Pi 400 | BCM2711 | Cortex-A72 | 4 | 1.8 GHz | 4 GB | Pi 4 in a keyboard; the heatspreader makes 1.8 GHz the default |
| Pi Zero 2 W | **RP3A0** | Cortex-A53 | 4 | 1 GHz | 512 MB | Raspberry Pi's first **System-in-Package**: a BCM2710A1 die (the die inside BCM2837) plus DRAM in one package |
| Pi 5 | **BCM2712** | Cortex-A76, **Armv8.2-A** | 4 | 2.4 GHz | 1–16 GB LPDDR4X | **16 nm.** 64 kB L1 I+D, **512 kB L2 per core, 2 MB shared L3**, ~17 GB/s. I/O split onto **RP1** |
| Pi 500 / 500+ | BCM2712 | Cortex-A76 | 4 | 2.4 GHz | 8 / 16 GB | Pi 5 in a keyboard |
| CM4 / CM5 | BCM2711 / BCM2712 | A72 / A76 | 4 | 1.5 / 2.4 GHz | 1–8 / 2–16 GB | Compute modules; both expose PCIe, CM5IO adds an M.2 M-key socket |

**The ISA story, which is the part worth teaching.** ARMv6 → ARMv7 at the Pi 2 was a *hard*
binary break: ARMv7-only instructions fault on an ARM1176. Debian's own `armhf` port targets
ARMv7, so Raspberry Pi maintained a **separate ARMv6 port** — in their words, *"a derivative of
Debian armhf with ARMv7-only instructions removed,"* which *"provides us with an operating
system which will run on every device we have ever manufactured, all the way back to 2011"*
([raspberrypi.com/news/raspberry-pi-os-64-bit](https://www.raspberrypi.com/news/raspberry-pi-os-64-bit/)).

The consequence is startling and makes a good lecture moment: **for roughly seven years, a Pi 3
or Pi 4 shipped running code compiled for a 2012-era ARM1176**, leaving A64, newer NEON and the
crypto extensions entirely on the table. The 64-bit OS was finally justified on three grounds —
closed-source apps only built for `arm64`, intrinsic A64 performance, and the 4 GB-per-process
ceiling being absurd on an 8 GB board.

The lesson to draw: **the 40-pin connector was frozen for twelve years and the ISA was not.**
Mechanical compatibility was guaranteed by decree; binary compatibility had to be bought, every
year, by shipping a deliberately crippled userland.

### 3.2 Pi 5 in depth

**Cortex-A76 versus A72.** Per [Arm's own launch material](https://developer.arm.com/community/arm-community-blogs/b/architectures-and-processors-blog/posts/cortex-a76-laptop-class-performance-with-mobile-efficiency), the A76 is *"Arm's first 4-wide decode core"* (A72 is 3-wide), dispatching up to 8 operations per cycle into an out-of-order backend, with a claimed +35% single-thread over A75 and a 4th-generation prefetcher.

But the cache hierarchy is the real story. BCM2711: 1 MB shared L2 and **no L3 whatsoever**.
BCM2712: **512 kB private L2 per core plus a 2 MB shared L3**, on 16 nm at 1.6× the clock.
Raspberry Pi's aggregate claim of **2–3× over Pi 4** on CPU- and I/O-bound work is mostly this.

**[unverified — pipeline stage depth for A76 and A72. Arm's TRMs (100798, 100095) are
JS-rendered and could not be fetched. Do not put a stage count on a slide without checking them.]**

**RP1, the in-house southbridge.** This is the architecturally interesting part of the Pi 5 and
belongs in the curriculum. Primary source: the [RP1 Peripherals datasheet](https://datasheets.raspberrypi.com/rp1/rp1-peripherals.pdf).

RP1 is *"a peripheral controller, designed by Raspberry Pi for use on Raspberry Pi 5,"*
connected to the application processor over **PCIe 2.0 ×4** — a 16 Gb/s link, roughly 2 GB/s
each way. Onto it moved: two independent XHCI controllers (>10 Gb/s of downstream USB, about 2×
Pi 4), the gigabit Ethernet MAC, **two 4-lane MIPI DPHY transceivers** shared between 2× CSI-2
and 2× DSI, the **28 GPIO of the 40-pin header** with 5× UART / 6× SPI / 4× I²C / 2× I²S /
24-bit DPI / 4-channel PWM, and a 3-channel video DAC for analog composite out.

Raspberry Pi's stated reason is worth quoting because it is a real architectural argument:
moving the interfaces off *"simplifies the design and reduces the cost of the AP, and makes it
easier to migrate to newer, more advanced process nodes."* Analog PHYs and 3.3 V I/O do not
shrink with the digital logic, so keeping them on the main SoC strands the whole chip on a
mature node. Note also that RP1 contains **two Cortex-M3 cores** of its own, an 8-channel DMA
controller, three PLLs, a 12-bit SAR ADC and 64 kB of SRAM — it is a substantial computer in
its own right.

**The latency tax — the single most important teaching fact about the Pi 5.** RP1 datasheet
§3.3.1:

> *"The PCIe link between RP1 and the host processor inserts an unavoidable amount of latency,
> typically 1μs at the design link width and speed. This is of chief concern for applications
> that rely on rapid but timely write sequences, e.g. bit-bashed protocols, or applications that
> need to respond quickly to the state change of a pin."*

Reads round-trip **twice** that. If PCIe ASPM is enabled, add ~2 µs (L0s) or ~5 µs (L1) to wake
the link on first access. **On a Pi 5, a GPIO write is a PCIe transaction.** Direct
register-poking GPIO code carried over from a Pi 4 gets *slower*, not faster. RP1 mitigates the
worst of it with atomic set/clear/XOR register aliases so you never pay two round-trips for a
read-modify-write, but the floor is hardware and no amount of kernel tuning removes it.

**RP1 also has PIO** — `PIO[0..27]` appears on alt-function a7 across all 28 header pins, and it
is exposed to Linux as `/dev/pio0`, driven by [piolib](https://github.com/raspberrypi/utils/tree/master/piolib), *"a clone of the PICO SDK PIO API."* Shipped examples include WS2812, PWM and a quadrature decoder. **[unverified — the published RP1 datasheet contains no PIO chapter; block/state-machine counts and PIO version for RP1 are undocumented. Use the RP2040 chapter as the reference.]**

**The exposed PCIe.** An FPC connector on the left edge, officially **PCIe Gen 2.0 ×1** =
**500 MB/s**, enabled with `dtparam=pciex1` unless a HAT+ is auto-detected. Gen 3 is available
via `dtparam=pciex1_gen=3` (≈985 MB/s) but Raspberry Pi state plainly: *"The Raspberry Pi 5 is
not certified for Gen 3.0 speeds. PCIe Gen 3.0 connections may be unstable."* Importantly there
are **two independent PCIe controllers** on BCM2712, so the ×1 slot does not steal bandwidth
from RP1's ×4.

**Other Pi 5 changes worth a mention:** a real **RTC** with a JST-SH battery connector and a
built-in charger (disabled by default; fit only a *rechargeable* Li-Mn cell) supporting a wake
alarm that drops the board to ~3 mA — which makes time-lapse and duty-cycled deployments
tractable for the first time; a PC-style **power button**; a 4-pin **fan connector with PWM and
tach**, where the firmware reads the tach at boot to auto-detect whether a fan is fitted; the
**3.5 mm AV jack removed** (composite survives as board pads); and **two mini 22-pin
combined CSI/DSI ports**, either of which can be a camera or a display, replacing Pi 4's one
CSI + one DSI. Power is 5 V @ 5 A USB-PD.

### 3.3 Raspberry Pi Pico: RP2040 and RP2350

**RP2040** ([datasheet](https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf)): dual
Cortex-M0+ up to 133 MHz, **264 kB SRAM in 6 banks**, 30 multifunction GPIO, 2× UART, 2× SPI,
2× I²C, 16 PWM channels, a 4-channel 12-bit 500 ksps ADC, USB 1.1 host/device, 12-channel DMA,
**8 PIO state machines**, 40 nm, QFN-56. The part number decodes: RP, **2** cores, core type
**0** (M0+), **4** = log₂(RAM/16 kB), **0** = no on-board non-volatile memory.

**No internal flash.** Code executes in place from external QSPI through an XIP subsystem with a
**16 kB two-way set-associative, single-cycle-hit cache**. Four address aliases select
cacheable/non-cacheable × allocating/non-allocating, and a fifth repurposes the cache as a
16 kB SRAM bank when XIP caching is off.

**The 6-bank SRAM, and why it matters.** Physically four 64 kB banks plus two 4 kB banks,
presented as one contiguous 264 kB region. Each bank has *"a dedicated AHB-Lite arbiter. This
means different bus masters can access different SRAM banks in parallel, so up to four 32-bit
SRAM accesses can take place every system clock cycle."* The first 256 kB is **word-striped**
across the four big banks — address `0x…00` → bank 0, `0x…04` → bank 1, and so on — so two
cores plus DMA plus a PIO-feeding DMA channel walking different buffers naturally land in
different banks without the programmer doing anything.

The two 4 kB banks are deliberately **not** striped, and the intended use is one per core for
stack and hot code, *"guaranteeing that the processors never stall on these accesses"* — which
is also how you make the highest-priority interrupt jitter-free. A lovely detail for the memory-
map unit: the un-striped mirrors of the big banks sit at +16 MB precisely because *"this is the
maximum offset that allows ARMv6M subroutine calls between the smaller banks and the
non-striped larger banks"* — ISA branch range leaking directly into the address map.

**Interrupt determinism:** *"The worst case interrupt latency, for the highest priority active
interrupt in a zero wait-state system not using jitter suppression, is 15 cycles"* — **120 ns at
125 MHz, bounded**, and jitter-free if the handler lives in the un-striped SRAM. This is the
number to hold up against Linux in section 3.5.

**RP2350** ([datasheet](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf)):
150 MHz, **520 kB SRAM in 10 banks**, 8 kB of antifuse OTP, up to 16 MB external QSPI flash *or
PSRAM* (32 MB with a second chip select), 5 V-tolerant GPIO when powered, an on-chip switched-
mode supply, **12 PIO state machines** (3 blocks), 16-channel DMA, and one HSTX block.
Variants: RP2350A (QFN-60, 30 GPIO), RP2350B (QFN-80, **48 GPIO**, 8 ADC, 24 PWM), and
RP2354A/B with 2 MB of stacked flash in package.

**The dual-ISA trick, precisely.** This is genuinely unusual and worth teaching properly. From
§3.1:

> *"There are two sockets for cores to attach to the system bus… The processor plugged into each
> socket is selectable at boot time: A Cortex-M33 processor, implementing the Armv8-M Main
> instruction set, plus extensions; A Hazard3 processor, implementing the RV32IMAC instruction
> set, plus extensions. Cortex-M33 is the default option. Whichever processor is unused is held
> in reset with its clock gated at the top level. Unused processors use zero dynamic power."*

Both are physically on the die. This is not emulation and not a fuse-blown SKU — there are
**four** CPUs on the chip and you choose which two run. Details:

- The Cortex-M33s are configured with **Security (TrustZone), DSP and FPU**, 8 SAU regions and
  8 MPU regions per security state.
- **Hazard3** is an open-hardware 3-stage in-order RISC-V core. RP2350 enables RV32I plus M, A,
  C, Zba, Zbb, Zbs, Zbkb, Zcb, Zcmp, Zicsr and a custom power extension — so "RV32IMAC" is the
  floor, not the whole story.
- Selection is by the **`ARCHSEL`** register, sampled when a core leaves reset and ignored at any
  other time; OTP `BOOT_ARCH` sets its reset value. The **USB bootloader runs on both
  architectures** and detects which one a UF2 targets, rebooting into the right mode — which is
  why drag-and-drop programming just works either way.
- `ARCHSEL` has **one bit per socket**, so a **mixed Arm + RISC-V** configuration is legal. The
  datasheet even guarantees interoperability: *"a shared variable can be safely, concurrently
  accessed by an Arm processor performing ldrex, strex instructions and a RISC-V processor
  performing amoadd.w instructions."* Of limited practical use (you need two toolchains and two
  images) but an outstanding lecture demo.
- RISC-V mode gives up some security features and the double-precision FP accelerator.

**Security features:** optional signed boot enforced by mask ROM with the key fingerprint in
OTP, protected OTP storage for a boot decryption key, global bus filtering by Arm/RISC-V
security and privilege level, peripherals/GPIO/DMA channels **individually assignable to
security domains**, hardware fault-injection mitigations (including a redundancy coprocessor),
a hardware TRNG, and a SHA-256 accelerator.

**The RP2350-E9 erratum — stated accurately, because it is widely mis-described.** It is *not* a
GPIO input latch and *not* a bootrom bug. The datasheet's own summary: *"Increased leakage
current on Bank 0 GPIO when pad input is enabled."* Affects RP2350 **A2**, fixed in **A3**.

Mechanically it is an analog leakage path through the input buffer of the fault-tolerant Bank 0
pad, on GPIO 0–47. It fires only when *all* of: the pad voltage sits in the undefined region
between V_IL and V_IH; the input buffer is enabled (`IE` set); the output buffer is disabled;
and isolation is clear. In that state the pad **sources about 120 µA at 3.3 V and holds itself
near 2.2 V** — it behaves like a parasitic pull-up. The **internal pull-down is far too weak to
fight it**, so a nominally pulled-down floating pin reads high. The internal pull-*up* is
unaffected (it drags the pad out of the bad region), and an external pull-down of ≤ 8.2 kΩ also
wins. Workarounds: keep `IE` clear when you need a pull-down and set it only for the instant of
the read, or fit the external resistor. The sting for this curriculum: *"PIO programs can't
toggle pad controls and therefore external pulls may be required."*

**[unverified — which RP2350 stepping ships in retail Pico 2 boards today. A2 is affected, A3
fixes it, A4 exists. Check the date code on the actual part.]**

**Boards:** Pico (RP2040, 264 kB, 2 MB flash), Pico W (adds CYW43439 Wi-Fi/BLE), Pico 2
(RP2350, 520 kB, 4 MB flash), Pico 2 W.

### 3.4 PIO, properly

This is the best thing in the whole Raspberry Pi ecosystem for teaching purposes, and it earns
the most time in the curriculum. Primary source: **RP2040 datasheet, Chapter 3**.

**The problem it solves.** A vendor ships the serial interfaces they anticipated. PIO ships the
ability to *build* one. The datasheet's own list of what people implement with it: *"8080 and
6800 parallel bus · I2C · 3-pin I2S · SDIO · SPI, DSPI, QSPI · UART · DPI or VGA (via resistor
DAC)."*

Two framings from the datasheet are worth quoting in a lecture because they explain the design
as an *economic* choice, not just a technical one:

> *"Each state machine, along with its supporting hardware, occupies approximately the same
> silicon area as a standard serial interface block, such as an SPI or I2C controller."*

> *"Making state machines programmable in a software-like manner, rather than a fully
> configurable logic fabric like a CPLD, allows more hardware interfaces to be offered in the
> same cost and power envelope."*

That is: PIO is what you build when you want FPGA-like flexibility at UART-like cost. It sits
exactly between the microcontroller and FPGA halves of this curriculum, which is why it is the
right capstone.

**The architecture.** RP2040 has 2 PIO blocks × 4 state machines = 8; RP2350 has 3 × 4 = 12.
Each block has **32 instructions of shared instruction memory** with four read ports, so all
four state machines execute from the same 32 words simultaneously and independently, each with
its own PC. Each state machine has:

- **two 32-bit shift registers** — OSR (output) and ISR (input), shifting either direction
- **two 32-bit scratch registers**, X and Y
- **4 × 32-bit FIFOs in each direction**, joinable into one 8-deep FIFO
- a **fractional clock divider**, 16 integer + 8 fractional bits
- **five independent GPIO mapping groups** — `out`, `in`, `set`, `side-set`, and `jmp pin`. All
  state machines see all pins, so, as the datasheet notes, *"the standard UART code allows TX,
  RX, CTS and RTS to be any four arbitrary GPIOs."*
- a **DMA interface sustaining one word per clock**

**The instruction set: exactly nine instructions.** *"The PIO has a total of nine instructions:
JMP, WAIT, IN, OUT, PUSH, PULL, MOV, IRQ, and SET."*

Every instruction is **16 bits**. Bits 15:13 are the opcode, bits 7:0 are operands, and
**bits 12:8 are a shared Delay / side-set field**:

```
Bit:    15 14 13 | 12 11 10  9  8 |  7  6  5  4  3  2  1  0
JMP      0  0  0 | Delay/side-set |   Condition  |   Address
WAIT     0  0  1 | Delay/side-set | Pol| Source  |    Index
IN       0  1  0 | Delay/side-set |    Source    |  Bit count
OUT      0  1  1 | Delay/side-set |  Destination |  Bit count
PUSH     1  0  0 | Delay/side-set |  0 IfF Blk 0  0  0  0  0
PULL     1  0  0 | Delay/side-set |  1 IfE Blk 0  0  0  0  0
MOV      1  0  1 | Delay/side-set |  Destination | Op | Source
IRQ      1  1  0 | Delay/side-set |  0 Clr Wait  |    Index
SET      1  1  1 | Delay/side-set |  Destination |    Data
```

*"All PIO instructions execute in one clock cycle."* And the shared field: the low bits *"encode
a number of idle cycles inserted between this instruction and the next"* (0–31, **free**, in the
same word), while the high bits *"encode a side-set… which can assert a constant onto some
GPIOs, concurrently with main instruction execution."* You **trade delay bits against side-set
bits**, and that budgeting decision is the central craft of writing PIO.

**How a PIO program differs from CPU code** — this is the part to labour, because students will
try to write C in it:

- **No memory access.** No loads, no stores, no address space at all. Data enters and leaves
  only through the FIFOs and the pins.
- **No arithmetic.** There is no add, no compare-with-immediate. What you get is `X--` and `Y--`
  as *branch conditions*, `MOV` with optional invert or bit-reverse, and shifting. The full list
  of `JMP` conditions is `!X`, `X--`, `!Y`, `Y--`, `X!=Y`, `PIN`, `!OSRE`.
- **No stack, no calls, no return.** Thirty-two instructions per block, total. You inline or you
  do not do it.
- **No interrupts in the CPU sense.** `IRQ` sets or clears one of eight flags; state machines can
  `WAIT` on them to rendezvous with each other, and they can be routed to the CPU's NVIC. That
  is *synchronisation*, not preemption. **Nothing ever interrupts a running state machine** —
  which is precisely why the timing is exact.
- **You write timing, not logic.** The unit of thought is the clock cycle, not the statement.
  Because every instruction is one cycle and the delay is in the same word, the loop period is a
  number you count off the listing with your finger.
- **Autopush / autopull** hide the FIFO bookkeeping: an `OUT` that empties the OSR past a
  configurable threshold refills it from the TX FIFO automatically, stalling only if the FIFO is
  empty. The catch, and it is a real one: *"an autopull can therefore occur at any point between
  two OUTs, depending on when the data arrives in the FIFO"* — which is why `MOV` *from* the OSR
  is undefined while autopull is enabled.
- **Side-set** *"allows state machines to change the level or direction of up to 5 pins,
  concurrently with the main execution of the instruction."* The motivating case is SPI, where a
  clock edge must coincide with a data transition: one `OUT` with a side-set does both at once.
  Three wins: exact timing, a smaller program (no separate instruction to toggle the clock), and
  a higher maximum frequency.
- **DMA feeds the FIFOs**, so once running, the CPU is entirely uninvolved.

**The canonical example — WS2812, in four instructions.** From
[pico-examples/pio/ws2812](https://github.com/raspberrypi/pico-examples/blob/master/pio/ws2812/ws2812.pio):

```
.program ws2812
.side_set 1
.define public T1 3
.define public T2 3
.define public T3 4
.wrap_target
bitloop:
    out x, 1       side 0 [T3 - 1] ; Side-set still takes place when instruction stalls
    jmp !x do_zero side 1 [T1 - 1] ; Branch on the bit we shifted out. Positive pulse
do_one:
    jmp  bitloop   side 1 [T2 - 1] ; Continue driving high, for a long pulse
do_zero:
    nop            side 0 [T2 - 1] ; Or drive low, for a short pulse
.wrap
```

Ten cycles per bit (T1+T2+T3), so the clock divider is `clk_sys / (bitrate × 10)`. The comment
on the first line is the entire lesson: *"Side-set still takes place when instruction stalls"* —
so when the FIFO runs dry the line is held **low**, which is exactly the WS2812 reset condition.
The protocol's failure mode and the hardware's stall behaviour coincide by design. `.wrap` costs
no instruction slot.

The other exemplary program is
[quadrature_encoder.pio](https://github.com/raspberrypi/pico-examples/blob/master/pio/quadrature_encoder/quadrature_encoder.pio), which shifts the two phase pins into the ISR and uses the low
four bits as an index into a **16-entry jump table** — a computed branch, in a nine-instruction
ISA. Y holds the count and is continuously non-blocking-written to the RX FIFO. The datasheet
notes the worst-case sampling loop is 10 cycles, so it reads step rates up to
**12.5 M steps/sec at 125 MHz**. That is the number to put next to "try this in an interrupt
handler."

**Toolchain:** `pioasm`, shipped with the Pico SDK, consumes `.pio` files and emits C headers
containing `const uint16_t` instruction arrays plus generated config helpers; it also has
MicroPython and Python backends.

### 3.5 Pi vs Arduino: when you need an OS and when it ruins you

**The trade, restated concretely.** An OS buys filesystems, TCP/IP, USB device support, a
package manager, threads, memory protection, and tens of thousands of packages you did not
write. It costs determinism, and every feature in that list is a source of unbounded delay:
page faults, scheduler decisions, threaded IRQs, cache and TLB pressure from unrelated
processes, thermal DVFS transitions — and on a Pi 5, a PCIe hop to reach a pin.

**The numbers with primary sources behind them:**

| | Latency | Jitter |
|---|---|---|
| RP2040 highest-priority interrupt | **15 cycles = 120 ns at 125 MHz**, worst case | zero, if the handler is in un-striped SRAM |
| PIO state machine | 1 cycle | **exactly zero** |
| Pi 5 GPIO access via RP1 | **~1 µs one-way**, ~2 µs for a read round-trip | +2 µs (ASPM L0s) / +5 µs (L1) on first access |
| Linux `PREEMPT` | kernel's own docs target *"the milliseconds range"* | unbounded tail |

**[unverified — I have no citable `cyclictest` measurement. The qualitative ordering is safe;
do not put a specific microsecond figure for Linux on a slide without measuring it on the
target board under load.]**

**PREEMPT_RT, and what it does and does not promise.** Merged into mainline in **Linux 6.12**
(September 2024) after roughly twenty years out of tree, the last blocker being the `printk`
rewrite. What `CONFIG_PREEMPT_RT` does, in the kernel's own Kconfig text: *"replacing various
locking primitives (spinlocks, rwlocks, etc.) with preemptible priority-inheritance aware
variants, enforcing interrupt threading and introducing mechanisms to break up long
non-preemptible sections. This makes the kernel, except for very low level and critical code
paths (entry code, scheduler, low level interrupt handling) fully preemptible."*

**The parenthetical is the whole caveat.** Entry code, the scheduler and low-level IRQ handling
stay non-preemptible. RT gives you a much lower and much more predictable upper bound; it does
not give you a hardware guarantee. It is soft real-time, and it costs throughput — threaded
IRQs, priority-inheritance mutexes and finer-grained locking are pure overhead on the fast path.
Worth contrasting with the stock kernel's own honesty: `PREEMPT_NONE` says *"there are no
guarantees and occasional longer delays are possible."*

**The canonical example: why you cannot bit-bang WS2812 from Linux userspace.** WS2812 encodes
each bit as a pulse whose *high time* distinguishes 0 from 1 — on the order of 0.4 µs versus
0.8 µs, with roughly ±150 ns of tolerance, and a >50 µs low period resets the strip.
**[unverified — those absolute timings are from the Worldsemi part datasheet, not a Raspberry Pi
source; the pico example gives only the 3:3:4 ratio.]** Stack the failure modes:

1. Your jitter budget is a few hundred nanoseconds. A `PREEMPT` kernel promises milliseconds —
   **three to four orders of magnitude short.**
2. A timer tick, a page fault, a network IRQ or the scheduler choosing someone else mid-frame
   corrupts a pixel. There is no CRC, so the strip simply shows the wrong colour and stays wrong.
3. On a Pi 5 you additionally pay ~1 µs *per pin write* across PCIe. **The transport alone
   exceeds the bit period.** Bit-banging from a Pi 5 core is not slow, it is structurally
   impossible.
4. DVFS and thermal throttling change what your calibrated delay loop means, at runtime.

The three things that work, in ascending order of elegance: an MCU with interrupts off; **PIO**
— four instructions, zero jitter, DMA-fed, CPU asleep; or, on a Pi 5, **PIO again**, through
RP1's block via `/dev/pio0` and `piolib`, whose shipped WS2812 example is the RP2040 program
*unmodified except for dynamic state-machine allocation*.

**That last point is the punchline of the entire unit.** The correct answer on the
microcontroller and on the Linux box is the *same PIO program*, because the fix was never a
faster CPU or a better scheduler — it was moving the timing out of software entirely.

**Boot time and power loss**, the two other places the OS bites:

- **Boot.** An RP2040 goes power-on → mask ROM → second stage from XIP flash → `main()` in
  sub-millisecond time, over a bounded ROM path with no enumeration and no init system. A Pi
  goes SoC ROM → EEPROM bootloader → firmware → device tree and kernel → initramfs → systemd →
  your service, in **seconds** — worse if `BOOT_ORDER` walks a USB or network stage first, where
  USB enumeration alone waits a documented minimum of two seconds. For anything battery-powered
  that wakes, acts and sleeps, **boot time is the power budget**; the Pi 5's ~3 mA RTC wake-alarm
  exists precisely because you cannot afford to cold-boot often.
- **Power loss.** An MCU writes flash only when told to; yank power and it resets, and on the
  next power-up the bootrom runs the same image. There is no mutable state to corrupt. A Pi has
  a live, mounted, journalling filesystem on removable flash, on top of an SD card running its
  own opaque flash translation layer doing wear-levelling in the background — a cut mid-erase
  can lose data the OS believed committed, because the *card's* translation table was in flight.
  Mitigations: read-only root with overlayfs, logs to tmpfs, NVMe over the PCIe connector
  instead of SD, or a UPS HAT that lets the Pi see the loss and halt cleanly.

**The decision rule to teach.** Ask: *is there a deadline measured in microseconds?*

- **Yes** → MCU, PIO, or dedicated hardware. Not Linux, and not Linux with PREEMPT_RT either.
- **No, but you need a filesystem, a network stack or a display** → Linux.
- **Both** → two chips. Which is exactly the architecture Raspberry Pi themselves converged on:
  BCM2712 runs Linux, RP1 owns the pins, and PIO sits *inside* RP1 so the deterministic work
  never touches the scheduler. **The Pi 5 block diagram is itself the answer to the question.**

---

## 4. Other microcontrollers worth knowing

### 4.1 The Cortex-M series, decoded

Arm publishes an official comparison document — **"Arm Cortex-M Processor Comparison Table", doc
102787** — which is the authoritative source for the table below. (The landing page at
`developer.arm.com/documentation/102787/latest` is JavaScript-only and says the document exists
only as a PDF.)

| | M0 | M0+ | M23 | M3 | M4 | M33 | M7 | M55 | M85 |
|---|---|---|---|---|---|---|---|---|---|
| **Architecture** | Armv6-M | Armv6-M | **v8-M Baseline** | Armv7-M | Armv7-M (E) | **v8-M Mainline** | Armv7-M (E) | **v8.1-M** | **v8.1-M** |
| Hardware divide | No | No | **Yes** | Yes | Yes | Yes | Yes | Yes | Yes |
| DSP extension | No | No | No | **No** | **Yes** | option | Yes | Yes | Yes |
| FPU | No | No | No | No | **SP option** | SP option | **SP + DP option** | HP/SP/DP | HP/SP/DP |
| TrustZone-M | No | No | **option** | No | No | **option** | No | option | **yes, not optional** |
| Helium (MVE) | No | No | No | No | No | No | No | **dual-beat option** | **dual-beat option** |
| Cache | No | No | No | No | No | No | **0–64 kB I+D** | 0–64 kB | 0–64 kB |
| TCM | No | No | No | No | No | No | **0–16 MB** | 0–16 MB | 0–16 MB |
| Max MPU regions | **0** | 8 | 16 | 8 | 8 | 16 | 16 | 16 | 16 |
| Max interrupts | 32 | 32 | 240 | 240 | 240 | **480** | 240 | 480 | 480 |
| **DMIPS/MHz** | 0.96 | 0.99 | 1.03 | 1.24 | 1.26 | 1.54 | **2.31** | 1.69 | **3.13** |
| **CoreMark/MHz** | 2.33 | 2.46 | 2.64 | 3.45 | 3.54 | 4.10 | **5.29** | 4.40 | **6.28** |

Two notes on reading Arm's own table. It lists **M4 and M7 as "Armv7-M" with "DSP: Yes"** —
"Armv7E-M" is precisely *Armv7-M plus the DSP extension*, so the common shorthand (M3 = v7-M,
M4/M7 = v7E-M) is correct, but do not be surprised when Arm's marketing material writes v7-M for
all three. And **bit-banding does not appear in the table at all**, because it is an *optional*
Armv7-M feature rather than a core-defining one.

**The confusing pairs, resolved:**

- **M0 vs M0+.** Same ISA, same 32 interrupts, no divide on either. Both offer a configurable
  single-cycle *or* 32-cycle multiplier. M0+ adds **single-cycle I/O access**, optimised code
  fetching for lower flash power, **deterministic instruction cycle timing**, optional trace
  (MTB), and an optional MPU — Arm's table shows M0 with a maximum of **zero** MPU regions and
  M0+ with 8. M0+ also has *lower* interrupt latency (15 cycles) despite the shorter pipeline.
- **M3 vs M4 vs "M4F".** Identical Armv7-M base, identical NVIC, identical bit-band option,
  identical 12-cycle latency. The M4 adds exactly two things: the **DSP extension** (SIMD,
  saturating arithmetic, packed halfword, extended MACs) and an **optional** single-precision
  FPU (FPv4-SP). Arm's own TRM says: *"The **Cortex-M4F** is a processor with the same capability
  as the Cortex-M4 processor, and includes floating point arithmetic functionality."* So a part
  advertised as "Cortex-M4" **may or may not have hardware float**; "M4F" means it does. Note the
  DSP extension is present regardless of the FPU, which is why an M4 without an FPU still beats
  an M3 at fixed-point DSP. Exercise F shows both halves of this in the generated code.
- **M7.** In-order **superscalar, dual-issue** with dynamic branch prediction — Arm: *"many
  instructions can be dual-issued, including load/load and load/store instruction pairs."*
  Optional split I- and D-caches (4–64 kB each), **TCM** (ITCM 64 bits wide; DTCM split into two
  32-bit interfaces), optional ECC on the cache RAMs, an **AHBS slave port letting DMA reach the
  TCMs while the core is clock-gated**, and an optional FPv5 FPU with **double precision**. This
  is the first Cortex-M where the *memory hierarchy*, not the core, dominates performance
  reasoning — and where determinism becomes a thing you have to engineer rather than get free.
- **M23 vs M33 — the Armv8-M split.** Both get TrustZone-M as an option. **M23 = Baseline** (the
  M0+-class instruction set, plus TrustZone, plus — surprisingly — hardware divide; Exercise F
  verifies this in the compiler). **M33 = Mainline** (full Thumb-2, up to 480 interrupts,
  optional Security, FP, DSP and Custom Datapath extensions). The slogan worth teaching:
  **M23 : M0+ :: M33 : M4, plus TrustZone on both.**
- **M55 / M85 — Helium.** Arm: *"MVE, supporting Single Instruction Multiple Data (SIMD)
  **128-bit vector operations**… Supported data types are: Integer, Half precision
  floating-point, Single precision floating-point… **MVE is also referred to as Arm Helium
  technology**."* Optional on both, and both implement the faster **dual-beat** variant. The
  pitch is edge machine learning: 4.40 → 6.28 CoreMark/MHz scalar, with the vector throughput
  on top. M85 also has TrustZone as *non-optional* and optional PACBTI (pointer authentication
  and branch-target identification).

**Pipeline depth** is genuinely hard to source. **[Only three are confirmable from Arm primary
documents: M23 is two-stage, M55 is four-stage, and M85 is seven-stage scalar / 9–10 stage
vector-and-floating-point. The familiar figures — M0 3-stage, M0+ 2-stage, M3/M4 3-stage, M7
6-stage — are secondary; Arm's TRMs say only "multistage" or "in-order issue pipeline". The M7's
*dual-issue superscalar* nature **is** primary; the number 6 is not.]**

**"Thumb-2 only — there is no A32 on Cortex-M."** Every M-profile core executes Thumb/Thumb-2
exclusively; the legacy 32-bit ARM instruction set does not exist there. Three consequences:

1. **Code density.** Thumb-2 mixes 16- and 32-bit encodings in one stream, so the common case
   costs two bytes. That is why a 32-bit core fits in 16 kB of flash at all.
2. **No interworking.** There is nothing to switch *to*, so no veneers and no `-mthumb-interwork`.
3. **But the Thumb bit is still there, and it bites.** Because vector entries remain
   "interworking-compatible", bit 0 of each vector loads into `EPSR.T` on exception entry. Arm
   states it identically across the M33, M55 and M85 TRMs: *"**All populated vectors in the
   vector table entries must have bit[0] set. Creating a vector table entry with bit[0] clear
   generates an INVSTATE (Invalid state flag) fault on the first instruction of the handler
   corresponding to this vector.**"* This is the classic hand-written-vector-table bug: you store
   the raw function address, and you get a UsageFault escalated to HardFault *on the handler's
   first instruction*, which makes it look like it came from nowhere. Toolchains normally set the
   bit for you because `&handler` for a Thumb function already has it.

### 4.2 The NVIC

**Vectored dispatch with no software demultiplexer.** The hardware fetches the handler address
from the vector table itself. There is no top-level dispatcher reading a pending register and
switching on it — which is exactly what an AVR or 8051 forces you to write.

**Hardware stacking.** Arm: *"the processor pushes information onto the current stack. This
operation is referred to as **stacking** and the structure of **eight data words** is referred to
as the **stack frame**"* — and, importantly, *"**In parallel to the stacking operation, the
processor performs a vector fetch.**"* The eight words are R0–R3, R12, LR, the return address and
xPSR: precisely the AAPCS caller-saved set. **That is *why* a plain C function works as an
interrupt handler** — the hardware saves everything the ABI permits a callee to clobber, and the
compiler's ordinary prologue saves R4–R11 if the handler needs them. Exercise D shows the
resulting five-instruction handler ending in a bare `bx lr`. On parts with an FPU the frame
extends to 26 words (lazily stacked by default).

**EXC_RETURN.** On entry the processor writes a magic value into LR; loading it into the PC is
what triggers exception return. On Armv7-M: `0xFFFFFFF1` → Handler mode, main stack;
`0xFFFFFFF9` → Thread mode, main stack; `0xFFFFFFFD` → Thread mode, process stack. Armv8-M
generalises this into a bitfield with additional bits for security state, whether callee
registers were stacked, and FP context. **Every RTOS context switch on Cortex-M is built on this
mechanism**, which makes it worth an explicit slide rather than a footnote.

**Tail-chaining and late arrival**, in Arm's words: tail-chaining — *"On completion of an
exception handler, if there is a pending exception that meets the requirements for exception
entry, **the stack pop is skipped** and control transfers to the new exception handler."* Late
arrival — *"If a higher priority exception occurs **during state saving** for a previous
exception, the processor switches to handle the higher priority exception… **State saving is not
affected by late arrival because the state saved is the same for both exceptions.**"*

**The cycle counts — confirmed from Arm primary.** The Cortex-M3 and Cortex-M4 TRMs contain
identical wording:

> *"There is a maximum of a **12 cycle latency** from asserting the interrupt to execution of the
> first instruction of the ISR when the memory being accessed has no wait states… Returns from
> interrupts similarly take **twelve cycles**… **Tail chaining requires 6 cycles** when using
> zero wait state memory."*

Other cores: **M0+ is 15 cycles** and **M23 is 15** (or **27** with the Security Extension and a
full stack) — both Arm primary. **[unverified: the M0's often-quoted 16 cycles is *not* in its
TRM, which explicitly defers to the implementer. And the M7, M33, M55 and M85 TRMs give no cycle
count at all — on those parts latency depends on cache, TCM and AXI, so a single number would be
meaningless. Treat any "12 cycles on M7" claim as unsourced.]**

**Priority grouping.** Each priority register splits into an upper *group priority* and a lower
*subpriority*. **Only the group priority determines preemption** — an interrupt of the same group
priority as the running handler does not preempt it; subpriority only orders simultaneous pending
interrupts; ties break toward the lowest IRQ number. Implementations choose **3 to 8 priority
bits**, so an STM32 gives you 4 bits (16 levels) and an nRF52 gives you 3 (8 levels). **This is
*the* portability trap in interrupt-priority code**, and it is worth making students hit it.

**SysTick** is the one timer that is architecturally the same everywhere: a **24-bit** down-counter
with registers at fixed addresses (`0xE000E010`–`0xE000E01C`) on every Cortex-M, which does not
decrement while halted for debug. It is an *implementation option* on M0/M0+ (so some tiny parts
lack it), and Armv8-M with TrustZone has **two** — Secure and Non-secure. Every RTOS uses it for
its tick precisely because it is the only portable timer.

**CMSIS** is Arm's *"vendor-independent hardware abstraction layer"*. The pedagogically useful
framing: **CMSIS-Core is the only layer that is genuinely identical across an STM32, an nRF52 and
a Kinetis** — `NVIC_EnableIRQ`, `SysTick_Config`, `__WFI`, `__DMB`, the SCB registers. Everything
above the core is vendor-specific. Also worth naming: **CMSIS-SVD**, the machine-readable
peripheral description from which every vendor header and every debugger register view is
generated, and **CMSIS-DSP**, the library you must actually call to use an M4's DSP extension
(see Exercise F).

### 4.3 ESP32

**[Sourcing note: Espressif's product-comparison pages are JavaScript-only and could not be
fetched. The variant table below is secondary (Wikipedia, whose columns cite the individual
Espressif datasheet PDFs). Verify against the per-chip datasheets before teaching from the exact
numbers.]**

| | CPU | Cores | Max clock | SRAM | Wi-Fi | Bluetooth | USB |
|---|---|---|---|---|---|---|---|
| **ESP32** (2016) | Xtensa **LX6** | 1–2 | 240 MHz | 520 KB | b/g/n | **4.2, Classic + LE** | no |
| **ESP32-S2** | Xtensa LX7 | 1 | 240 MHz | 320 KB | b/g/n | **none** | OTG |
| **ESP32-S3** | Xtensa LX7 | 2 | 240 MHz | 512 KB | b/g/n | 5 + LE | OTG |
| **ESP32-C3** | **RISC-V RV32IMC** | 1 | 160 MHz | 400 KB | b/g/n | 5 + LE | no |
| **ESP32-C6** | RISC-V RV32IMAC | 1 | 160 MHz | 512 KB | **Wi-Fi 6** | 5.3 + LE | no |
| **ESP32-H2** | RISC-V RV32IMAFC | 1 | 96 MHz | 256 KB | **none** | 5.3 + LE | no |
| **ESP32-P4** | **dual RISC-V** + LP core | 2+1 | 400 MHz | 768 KB | **none** | none | 2× OTG HS |

The parts that matter for a curriculum: **C3 is the pivot** — Espressif's move to RISC-V, in a
part that is software-compatible with the rest of the family. **H2 has no Wi-Fi at all** (pure
802.15.4 + BLE), and **P4 has no radio at all** (a high-performance application processor that
pairs with a C6 over SDIO). Those two are the cleanest illustration available that *radio choice
drives part choice*. 802.15.4 (Thread/Zigbee/Matter) is on C6 and H2, not on the plain
ESP32/S2/S3/C3.

**The ESP8266** mattered because it made Wi-Fi essentially free: a Tensilica L106 at 80/160 MHz
with ~160 KB of RAM and no internal flash, reaching the maker world in August 2014 at a price
nobody could match, and — decisively — acquiring an **Arduino core**, so you could program it
like any other Arduino. That is the template the whole ESP32 family inherited: cheap radio,
Arduino front door, real vendor SDK underneath.

**The pedagogically important point: on ESP32 you are always on an RTOS.** This is confirmable
from Espressif's own documentation and it genuinely changes the mental model students bring from
AVR:

- ESP-IDF ships *"a unique implementation of FreeRTOS with **dual-core symmetric multiprocessing
  (SMP)** capabilities."* It is not optional and it is not vanilla FreeRTOS.
- Per the startup guide, *"the main task is created and the FreeRTOS scheduler starts running"*
  before `app_main` is entered — **`app_main` is a FreeRTOS task, not `main()`**, and it is even
  allowed to return while the system keeps running.
- Therefore **Arduino-on-ESP32 is Arduino-on-an-RTOS**: `loop()` is a task body, `delay()` yields
  to the scheduler, and a tight `while(1)` with no yield can starve the watchdog and the Wi-Fi
  stack. Compare AVR, where `loop()` is literally `for(;;) loop();` inside `main`. **[This
  specific framing is an inference from the primary ESP-IDF startup and FreeRTOS docs, not a
  quote from an Arduino-ESP32 page — present it as such.]**

**PRO_CPU / APP_CPU.** *"PRO CPU (CPU0) initiates immediately after reset, while APP CPU will be
held in reset"*, and the PRO CPU releases it during `call_start_cpu0`. By convention, protocol
tasks pin to core 0 and application tasks to core 1, via `xTaskCreatePinnedToCore()`. **The
asymmetry is a startup and naming convention, not a hardware difference** — both are identical
cores.

**Execute-in-place from external flash.** There is no internal program flash; code lives on an
external SPI chip and runs through a **flash MMU and cache**, and once cached is *"as fast as
accessing other types of internal memory."* Two consequences worth teaching. First, a **cache
miss stalls**, so ESP32 timing is not deterministic in the way an AVR's is. Second, anything that
runs while the flash cache is *disabled* — during a flash write or erase, or in some low-power
paths — must not live in flash, which is why `IRAM_ATTR` and `ESP_INTR_FLAG_IRAM` exist.

And a lovely concrete lesson in "the datasheet number is not the number you get": of the ESP32's
*"520 KB of available SRAM (320 KB DRAM and 200 KB IRAM)"*, the **maximum statically allocated
DRAM is 160 KB**, the rest is heap-only — and **enabling Bluetooth costs you another 64 KB**.

### 4.4 STM32

**The naming, decoded.** Letter = market segment; digit = generation and positioning within it;
core follows from the segment and era.

| Segment | Series | Core |
|---|---|---|
| **Performance / mainstream** | F0 | M0 |
| | **F1** | **M3** — the original line (2007), and the Blue Pill |
| | F2 | M3 |
| | F3 | M4F (mixed-signal) |
| | **F4** | **M4F** — the long-running workhorse |
| | F7 | M7F |
| | **H7** | M7F, or **M7F + M4F dual-core**, 480–600 MHz |
| | H5 | M33F |
| **Low power** | L0 / L1 | M0+ / M3 |
| | L4 / L4+ | M4F |
| | L5 / **U5** | **M33F** — U5 is the current low-power flagship |
| **Mainstream refresh** | **G0** | **M0+** — the modern F0 replacement |
| | **G4** | **M4F @170 MHz**, with CORDIC and FMAC accelerators |
| **Cost** | **C0** | M0+ — launched explicitly against 8-bit: *"Your next 8-bit MCU is a 32-bit"* |
| **Wireless** | **WB** | **M4F + M0+** — application core plus a dedicated radio core |
| | WBA | M33F (BLE 5.4 + 802.15.4) |
| | **WL** | M4/M0+ with an integrated **sub-GHz LoRa** transceiver |

(MP1 and MP2 are Cortex-A parts that run Linux — the boundary of the MCU world, worth one slide.)

The practical guidance: F1 and F4 are legacy-but-everywhere and are what most tutorials assume;
**G0, G4, U5, H5, C0 and WBA are what ST actually wants new designs on.**

**The Blue Pill (STM32F103C8T6)** earns its place in the history but should be taught with a
warning. It made a proper Cortex-M — with SWD, a real NVIC, DMA and USB — cheaper than an Arduino
Nano, which is what pulled hobbyists past the AVR ceiling. It is also a **supply-chain cautionary
tale**: the market is full of counterfeit and re-marked dies (CS32, GD32 substitutes) with
different flash sizes, the wrong USB pull-up resistor that breaks enumeration, and inconsistent
debug behaviour. And it needs an **ST-Link**, not an Arduino-style auto-reset — which is precisely
where students learn what SWD is. **[unverified — st.com is JavaScript-rendered and no primary
page could be fetched for the F103's specifications.]**

**For a course, start on a Nucleo, not a Blue Pill.** Nucleo boards carry an **on-board ST-Link on
a snap-off tab**, so students get real breakpoints, watchpoints, SWO `printf` and live register
views for free. That single fact changes how much they can learn per hour more than any other
board choice.

**HAL vs LL vs registers — the honest trade-off.** **[ST's own wiki could not be reached; this
characterisation is assessment, not citation.]**

- **STM32Cube HAL.** *For:* one API across every STM32 family; CubeMX generates the pin-mux and
  **clock tree** setup, which removes a genuinely hard category of beginner suffering; it is what
  ST's examples, middleware (USB, FatFS, LwIP, TouchGFX) and support all assume. *Against:*
  large; **opaque** — "which register did that write?" takes a debugger; **blocking-by-default
  APIs** that teach the wrong reflexes and must be unlearned for the `_IT` and `_DMA` variants; a
  weak-symbol callback model that is easy to get wrong; a real history of version-to-version
  behaviour changes. **And it hides exactly the thing a hardware course exists to show.**
- **LL (Low Layer).** Thin `static inline` wrappers over single register fields —
  `LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_5)` compiles to essentially the `BSRR` store verified
  in section 5.5. Near-zero overhead, no hidden state, names that map one-to-one onto the
  reference manual, and it composes with HAL. **This is the best teaching layer for most of a
  course** — it forces students into the reference manual while sparing them typos in bit
  positions.
- **CMSIS plus bare registers.** Nothing between the student and the silicon, and it transfers to
  any vendor. But hand-writing the PLL and clock tree is a demoralising first week and there is
  no path to a USB stack. **The right dose is: bare registers for GPIO, one timer and one
  interrupt, so the abstraction is demystified — then move up.**
- **Alternatives worth naming:** **libopencm3** (LGPLv3, vendor-neutral, readable, partial
  coverage — and the licence matters for commercial static linking); **Rust's `embassy` /
  `embassy-stm32`**, where the PAC is generated from SVD and type-state pin configuration makes
  "use an unconfigured peripheral" a *compile* error — pedagogically excellent for showing that
  peripheral misuse can be a type error; and **Zephyr**.

**Recommendation for this curriculum: registers for the first three peripherals, LL for the body
of the course, HAL only when you need ST's middleware, and one lecture on Zephyr and embassy so
students know the industry did not stop at CubeMX.**

### 4.5 Teensy

**Teensy 4.0 / 4.1** use the NXP **i.MX RT1062**: **Cortex-M7 at 600 MHz** with an FPU covering
both 32-bit float and 64-bit double, *"dual-issue superscalar, capable of executing 2 instructions
per clock cycle"*, 2 MB flash (4.0) or **8 MB** (4.1), **1024 KB RAM of which 512 KB is tightly
coupled**, and 32 DMA channels. The 4.1 adds 10/100 Ethernet with a PHY, a native 4-bit SDIO
microSD socket, 8 UARTs, 55 I/O, and two QSPI pads that each take 8 MB of PSRAM.

**Why it is exceptional**, and why it belongs in a curriculum:

1. **Class and clock.** 600 MHz on a core rated 2.31 DMIPS/MHz, against an Arduino Uno's 16 MHz
   at roughly 1 MIPS/MHz — about three orders of magnitude, in a form factor and price bracket a
   student can afford.
2. **TCM, and code that runs from RAM.** The i.MX RT has **no internal flash**, so PJRC's
   toolchain copies code into the M7's ITCM at boot. The escape hatches are two keywords:
   **`FASTRUN`** to execute from tightly-coupled RAM *"for fastest performance"*, and
   **`FLASHMEM`** to leave a function running from flash and save RAM. **That is the best
   available hands-on demonstration of the TCM-versus-cache-versus-external hierarchy** — the
   student changes one keyword and measures the difference. It makes section 5.4's determinism
   argument concrete.
3. **The Audio library** — polyphonic playback, recording, synthesis, analysis, effects, filtering
   and mixing at 16-bit/44.1 kHz running *in the background* while the sketch runs, with a
   browser-based graphical patching tool that exports Arduino code, automatically using the M7's
   DSP instructions. It is the most impressive thing in hobbyist embedded and a superb motivator.

Teensy 3.x used Freescale/NXP **Kinetis** parts; the line was wound down after the NXP/Freescale
merger, which is why 4.x jumped to i.MX RT.

**The honest ecosystem caveat.** Teensy is **not open hardware in the Arduino sense**: the
bootloader lives in a PJRC-programmed chip whose firmware is not distributed, so you cannot build
a compatible board, and PJRC is a single small vendor with no second source. Unmatched
capability-per-dollar and an extraordinary library ecosystem, against single-vendor lock-in. Say
that out loud to students. **[unverified — PJRC's specific licensing terms and the Teensy 3.x
Kinetis part numbers could not be confirmed; the Audio library's own page still lists only
Teensy 3.x boards and is stale relative to the 4.x product pages.]**

### 4.6 Nordic nRF52 / nRF53 / nRF54

**nRF52832 vs nRF52840** — same core, same clock, and the delta is worth memorising:

| | nRF52832 | nRF52840 |
|---|---|---|
| Core | Cortex-M4 with FPU, 64 MHz | Cortex-M4 with FPU, 64 MHz |
| Flash / RAM | 512 or 256 KB / 64 or 32 KB | **1 MB / 256 KB** |
| Protocols | BLE, mesh, ANT, 2.4 GHz proprietary, **NFC-A tag** | + **Thread, Zigbee, 802.15.4** |
| USB | **no** | **USB 2.0 device** |

**The SoftDevice model** — architecturally the most instructive thing in this section, and worth
teaching for its own sake. A SoftDevice is a **precompiled, closed binary** BLE stack flashed at
the bottom of flash, with your application linked to start above it, reached through **SVC
instructions** in a reserved SVC-number range, and forwarding unclaimed interrupts to your vector
table. The genuinely interesting part is how it enforces the radio's determinism, using the NVIC
priority mechanism as a **scheduling contract**. From Nordic's S140 specification:

- It **reserves three NVIC priority levels**: **level 0** for *"the SoftDevice's timing critical
  processing"* (the radio's hard deadlines), **level 1** for *"handling the memory isolation and
  run time protection"*, and **level 4** for deferrable work and the SVC-based API.
- *"The application can use the remaining interrupt priority levels"* — on an 8-level nRF52,
  that leaves you **2, 3, 5, 6 and 7**.
- Latency follows mechanically: an application interrupt at 2 or 3 is delayed only by SoftDevice
  levels 0 and 1; one at 5, 6 or 7 can be delayed by *all* of them.
- The hard rule: *"**Handlers running at a priority level higher than 4… have neither access to
  SoftDevice functions nor to application specific SVCs or RTOS functions.**"* From a priority-2
  ISR you may **not** call the BLE API. And you may not simply `__disable_irq()` for an arbitrary
  span, because you will miss the radio's level-0 deadline and drop the link — hence
  `sd_nvic_critical_region_enter/exit`.

**Why teach this:** it is the clearest real-world example students will meet of **interrupt
priority as an architectural decision rather than a tuning knob**. The costs are equally
instructive — you cannot step into it in a debugger, your priority budget is permanently reduced,
a general-purpose RTOS's critical sections are no longer safe by default, and your linker memory
map becomes a negotiation. **[unverified — the exact SoftDevice flash/RAM footprint figures;
Nordic's memory-usage page could not be reached. The priority model above *is* verified.]**

**nRF5340 — and why a second core is the better answer.** Application core: **Cortex-M33 with
TrustZone at 128 MHz**, 1 MB flash, 512 KB RAM, FPU, DSP instructions, a two-way set-associative
cache toward flash/QSPI XIP, and a CryptoCell-312 security subsystem. Network core: a second
**Cortex-M33 at 64 MHz** with 256 KB flash and 64 KB RAM, carrying the Bluetooth 5.2 / 802.15.4
transceiver.

The argument to make in Unit 5: the SoftDevice's reserved priorities *manage* the determinism
problem by convention plus enforcement on a shared core, and the cost is that your application's
timing is permanently entangled with the stack's. Giving the radio **its own core, its own flash,
its own RAM and its own NVIC dissolves the problem instead**. The network core's worst case is
unaffected by anything the application does; the two communicate over an explicit IPC mailbox
rather than through shared priority space; you get all your priority levels back; and the radio
firmware can be certified and updated independently. **That the network core is only 64 MHz with
256 KB is precisely the point — the radio does not need to be fast, it needs to be never late.**

Note the same idea elsewhere: ST's **STM32WB** (M4F application + M0+ radio), the ESP32-P4 paired
with a C6, RP1 beside BCM2712, and a Zynq's hard Arm core beside FPGA fabric. It is the
industry's convergent answer to "I need both an OS and nanosecond timing."

**nRF Connect SDK** is the modern replacement for the nRF5-SDK-plus-SoftDevice model: built on
**Zephyr**, with an open-source Bluetooth controller and host, devicetree configuration and
MCUboot, covering nRF52, nRF53, nRF54, nRF70 and nRF91. **[unverified — all nRF54 specifics; only
"nRF Connect SDK supports nRF54L and nRF54H" could be confirmed.]**

### 4.7 RISC-V microcontrollers, and the commodity-ISA point

**WCH CH32V003** is the headline: a **QingKe 32-bit RISC-V** core at up to **48 MHz** with
**2 KB SRAM and 16 KB flash**, 18 I/O, in packages down to SOP-8, marketed at **under ten cents**
in volume. A 32-bit MCU priced *below* where 8-bit parts live — and it exists because RISC-V
removed the per-unit architecture licence from the bill of materials. WCH also ships CH32V203/307
parts that are near clones of STM32 peripherals with a RISC-V core swapped in. **[unverified —
the specific ISA string; WCH's page says "RISC-V2A", and RV32EC is the widely reported
designation but was not confirmed.]**

**GD32** makes the point even more vividly, and is worth a slide: GigaDevice began with
pin- and register-compatible Cortex-M3 alternates to the STM32F103, then shipped the **GD32VF103**
— the *same peripheral set and same register map* with a **RISC-V** core instead of the M3. Same
board, same reference manual for everything except the core chapter, different instruction set.
**[unverified in this session.]**

**SiFive** matters historically as the first commercial RISC-V core IP vendor, and the FE310 on
the HiFive1 (2016) was the first widely available RISC-V MCU board — which is what made RISC-V
teachable at all. It has since moved upmarket, with the low end largely ceded to in-house cores
(Espressif's, WCH's QingKe, Nuclei, Andes). **[unverified in this session.]**

**The point that matters for the curriculum.** The ISA is becoming a commodity choice, and three
independent pieces of evidence in this report show it: Espressif switched its entire new product
line from Xtensa to RISC-V while keeping **the same SDK and largely code-compatible
applications**; GigaDevice ships one peripheral set behind two different cores; and the RP2350
lets you choose **Cortex-M33 or RISC-V at boot on the same die**.

So: **teach the concepts that transfer** — memory-mapped I/O, vectored interrupts and priority,
DMA, clock trees, the fetch-decode-execute cost model, linker scripts and startup code — and treat
the instruction set as a detail. Students will change ISAs at least once in their careers and it
will be a smaller event than changing vendors. What does *not* commoditise, and where the real
difficulty lives, is the **interrupt controller semantics** (NVIC versus PLIC/CLIC are genuinely
different models), the **debug transport** (SWD versus JTAG), and the **peripheral programming
model**.

---

## 5. Embedded concepts a systems programmer needs

A systems programmer arriving from userspace already understands processes, syscalls, and
virtual memory. Almost none of that transfers. What follows is the set of ideas that replace
them.

### 5.1 GPIO — harder than it looks

A pin is not a boolean. The things that bite:

- **Push-pull vs open-drain.** A push-pull output has a transistor to VCC and one to GND; it
  actively drives both levels. An open-drain output can only pull *down*; the high level comes
  from an external (or internal) pull-up resistor. Open-drain is what makes a shared bus
  possible — many devices can pull the line low, nobody fights, and the line is high only when
  everyone lets go. This is exactly why I²C is open-drain, and it is the same wired-AND idea
  students met as a logic gate.
- **A floating input is a bug, not a zero.** A CMOS input with nothing connected sits at an
  undefined voltage, picks up noise, and — worse — can sit near the switching threshold with
  both transistors of the input buffer partly on, drawing real current. Every unused pin should
  be configured as an output or given a pull resistor. This is a top-three cause of mysterious
  power consumption in battery devices.
- **Reading a pin you drive may not return what you wrote.** On AVR the `PORTx` register is the
  output latch and `PINx` is the actual pin state. If you drive high into a short to ground,
  `PORTB` reads 1 and `PINB` reads 0. This distinction is the whole reason the AVR has three
  registers per port (`DDRx` direction, `PORTx` output latch / pull-up enable, `PINx` input).
  On the 328P, writing a 1 to a `PINx` bit *toggles* the corresponding output — a nice hardware
  shortcut that section 7's first transcript shows the compiler using.
- **Drive strength and slew rate** are configurable on most ARM parts. Fast slew makes sharp
  edges, which makes EMI and ringing. It matters more than beginners expect.

### 5.2 The serial bus family

| | Wires | Clock | Speed | Multi-drop | Error detection | Distance | Typical use |
|---|---|---|---|---|---|---|---|
| **UART** | 2 (+GND) | none (async) | to ~1–12 Mbps | no (point-to-point) | parity, optional | metres (TTL) | consoles, GPS, modems |
| **I²C** | 2 | shared, from master | 100 k / 400 k / 1 M / 3.4 M | yes, addressed | ACK/NACK per byte | ~1 m, cap-limited | sensors, EEPROM, config |
| **SPI** | 3 + 1 CS per device | shared, from master | tens of MHz | yes, by chip select | **none at all** | ~10 cm | displays, flash, ADCs |
| **CAN** | 2 (differential) | none (async, bit-stuffed) | 1 Mbps (5–8 Mbps FD) | yes, message-oriented | CRC + ack + fault confinement | ~40 m at 1 Mbps | automotive, industrial |

**I²C.** Two open-drain wires, SDA and SCL, with pull-ups. 7-bit addressing (10-bit exists,
rarely used). Every byte is acknowledged by the receiver pulling SDA low for a ninth bit. The
real-world problems:

- *Pull-up sizing is a genuine engineering trade, not a default.* The resistor and the bus
  capacitance form an RC. Too weak and edges are too slow for the spec's rise-time limit
  (1000 ns standard mode, **300 ns fast mode**); too strong and the sink cannot pull below
  V<sub>OL</sub> = 0.4 V within the 3 mA limit. Both bounds are computable
  **[verified by calculation; rise time ≈ 0.847·R·C for the spec's 0.3→0.7 V<sub>DD</sub>
  measurement]**:

  | Mode | Bus capacitance | Max pull-up |
  |---|---|---|
  | 100 kHz standard | 100 pF | 11.8 kΩ |
  | 100 kHz standard | 400 pF (spec max) | 2.95 kΩ |
  | **400 kHz fast** | **100 pF** | **3.54 kΩ** |
  | 400 kHz fast | 400 pF (spec max) | 0.89 kΩ |

  and the lower bound is (V<sub>DD</sub> − 0.4 V)/3 mA — **967 Ω at 3.3 V, 1.53 kΩ at 5 V**.

  Note what this shows: **the 4.7 kΩ folklore default is out of spec for 400 kHz at anything
  above about 75 pF of bus capacitance** — which is two or three modules on jumper wires. It
  works at 100 kHz and people therefore assume it always works. This is a good exercise: give
  students the rise-time formula and the V<sub>OL</sub> limit and have them derive the legal
  window for their own bus, rather than copying a number off a tutorial.
- *The bus-hang failure mode.* If a master is reset mid-transfer while a slave is driving a
  data bit low, the slave keeps holding SDA down waiting for clocks that never come, and the
  bus is dead. Recovery is to manually toggle SCL up to nine times until the slave releases
  SDA, then issue a STOP. Every production I²C driver should have this; most tutorials don't.
- *Clock stretching*: a slave may hold SCL low to say "wait." Many hardware masters handle this
  badly, and some (notoriously, the Raspberry Pi's Broadcom I²C block) have had known
  clock-stretching bugs. **[unverified — the Pi clock-stretch bug is widely reported but I could
  not re-confirm its current status against a Raspberry Pi source in this session.]**
- *Address collisions are a product problem.* Many sensors offer only two or three address
  options. Two of the same part on one bus is a real design constraint, solved with a mux or a
  second bus.
- Spec: NXP **UM10204**, "I²C-bus specification and user manual."

**SPI.** Four wires, full duplex, one chip-select per peripheral. It is fast and trivially
simple — a shift register in each direction — and it has **no acknowledgement and no error
detection whatsoever.** You clock out 8 bits and clock in 8 bits and you have no idea whether
anything is connected. A disconnected SPI flash reads as all-ones or all-zeros, which is why
"read the JEDEC ID first and check it" is the standard defensive move.

The trap is CPOL/CPHA. CPOL sets the idle level of the clock; CPHA selects whether data is
sampled on the leading or trailing edge. The four combinations are "mode 0" through "mode 3."
Getting it wrong usually produces data shifted by one bit, or data that works at low clock
rates and fails at high ones, which sends people hunting for a signal-integrity problem that
isn't there.

**UART.** No clock line at all: both ends must independently agree on the bit rate. The
receiver finds the start bit's falling edge, then samples at the middle of each expected bit
time. Accumulated error over a 10-bit frame must stay under roughly half a bit — in practice a
combined clock error above about 2–3% breaks the link. **This is the specific reason the
oscillator matters here more than anywhere else:** an internal RC oscillator is typically ±1–2%
over temperature (some are factory-trimmed better), and two such devices at opposite ends of
their tolerance will not talk. A crystal is ±20–50 ppm.

This is also why classic AVR baud rate tables list a percentage error for every crystal
frequency. Worked through for 115200 baud on an ATmega328P, using UBRR = F_CPU/(16·baud) − 1
**[verified by calculation]**:

| Crystal | U2X | UBRR | Actual baud | Error |
|---|---|---|---|---|
| 16 MHz | 0 | 8 | 111 111 | **−3.55%** |
| 16 MHz | 1 | 16 | 117 647 | **+2.12%** |
| 14.7456 MHz | 0 | 7 | **115 200** | **0.00%** |

Three things fall out of that table at once. A 16 MHz part **cannot** hit 115200, because the
divisor lands between integers and you must round. Arduino sets the double-speed bit **U2X** not
for speed but to move the error from −3.55% to +2.12%, back inside tolerance. And 14.7456 MHz is
exactly 115200 × 128 — which is why that otherwise bizarre crystal frequency is stocked by every
distributor. It exists solely to make serial divisors come out whole.

Levels are a separate axis from the protocol: TTL/CMOS (0 to 3.3 V or 5 V, what an MCU pin
does), RS-232 (±3 to ±15 V, inverted — connecting it directly to an MCU destroys the pin),
RS-485 (differential, multi-drop, hundreds of metres).

**CAN.** The elegant one, and worth teaching properly for its own sake.

CAN is a differential pair where one bus state is *dominant* (logic 0) and the other
*recessive* (logic 1); any node driving dominant wins over any number driving recessive —
wired-AND again. Arbitration falls straight out of this: every node that wants to transmit
starts sending its message identifier simultaneously, and while sending, each node *reads back*
the bus. If a node transmits recessive and reads dominant, some other node is sending a lower
identifier, so this node silently stops and becomes a receiver. **The winner's message is not
corrupted and no time is lost** — arbitration is non-destructive, unlike Ethernet's collide-and-
retry. Lower numeric identifier means higher priority, and the highest-priority message on the
bus always gets through with bounded latency.

CAN is also message-oriented rather than address-oriented: frames carry an identifier
describing *what the data is*, not who it is for, and any node may consume it. And it has real
fault handling — transmit and receive error counters, and a node that misbehaves puts *itself*
into error-passive and then bus-off state, disconnecting from the bus rather than jamming it.
Spec: **ISO 11898** (11898-1 data link layer, 11898-2 high-speed physical layer). CAN FD
extends the payload to 64 bytes and allows a faster data phase after arbitration.

### 5.3 Interrupts and ISR discipline

Two different numbers, routinely confused:

- **Latency** — how long from the event to the first instruction of your handler.
- **Jitter** — how much that latency *varies*. For control loops and protocol timing, jitter is
  usually what kills you, and it is what an OS destroys.

The discipline, in order of how often it is violated:

1. **Keep the ISR short.** Time spent in a handler is time other interrupts are delayed. The
   standard shape is: acknowledge the hardware, capture the minimum state, set a flag or post
   to a queue, return. Do the work in the main loop or an RTOS task ("deferred processing," the
   bottom half).
2. **Every variable shared with an ISR must be `volatile`.** Section 7's Exercise B shows what
   happens otherwise: the compiler hoists the load out of the loop and you get an infinite loop
   that never re-reads memory. This is not theoretical; it is a one-instruction `rjmp .-2`.
3. **`volatile` is necessary but not sufficient.** It guarantees the access happens; it does
   not make it atomic. On an 8-bit machine a 16-bit counter is read with two loads, and an
   interrupt landing between them gives you a torn value — half old, half new. Section 7
   Exercise D shows the two `lds` instructions with the window between them. The fix is to
   disable interrupts around the access (avr-libc's `ATOMIC_BLOCK(ATOMIC_RESTORESTATE)` from
   `<util/atomic.h>`), or to use a lock-free pattern where the ISR only ever increments and the
   reader retries until two consecutive reads agree.
4. **Do not call the world from an ISR.** No `malloc` (the heap lock is not reentrant), no
   `printf` (large, slow, may allocate, may block on a UART), no blocking calls, no RTOS API
   that isn't explicitly documented as ISR-safe — FreeRTOS marks these with a `FromISR` suffix
   and calling the non-ISR version from an interrupt is a classic crash.
5. **Watch for priority inversion** when an ISR and a task share a resource, and for
   re-entrancy when nesting is enabled.

The AVR-versus-Cortex-M contrast here is genuinely instructive and section 7 Exercise D makes
it concrete. On AVR, an interrupt is dispatched through a table of `rjmp`s and the *compiler*
must emit code to save every call-clobbered register the handler touches — for a handler that
calls a function, that is 15 pushes and 15 pops of pure overhead. On Cortex-M, the **NVIC**
stacks R0–R3, R12, LR, PC and xPSR *in hardware* on exception entry, vectors directly to the
handler's address with no software dispatch, and unstacks on return. Because the hardware saves
exactly the registers the AAPCS calls caller-saved, **a plain C function can be an interrupt
handler with no special attribute at all** — you just put its address in the vector table. The
NVIC also does *tail-chaining* (if another interrupt is pending on return, it skips the
unstack/restack entirely) and *late-arrival* (a higher-priority interrupt arriving during
stacking is handled first, reusing the same stack push). That is why Cortex-M interrupt latency
is a small documented constant rather than something the compiler determines. **[verified from
the Cortex-M3 and Cortex-M4 TRMs, which use identical wording]**: *"a maximum of a **12 cycle
latency** from asserting the interrupt to execution of the first instruction of the ISR"* with
zero wait states, twelve again on return, and *"**tail chaining requires 6 cycles**."* On M0+
and M23 the figure is **15**. See section 4.2 for the full picture, including which cores have
no published number at all.

### 5.4 DMA

A DMA controller is a small state machine that moves data between memory and peripherals
without the CPU. It solves the problem that a 12-bit ADC at 1 MSPS produces a sample every
microsecond, and servicing that with an interrupt per sample would consume the entire core.

The patterns worth teaching: peripheral-to-memory (ADC, I²S microphone, UART receive),
memory-to-peripheral (DAC, display refresh, I²S out), and circular / ping-pong buffering, where
the DMA wraps around a buffer forever and interrupts you at half-full and full so you always
have a stable half to process while it fills the other.

Two failure modes that are worth flagging loudly because they generate hard bugs:

- **Cache coherency.** On a Cortex-M7 with a data cache, the CPU and the DMA engine see
  different views of memory. If you fill a buffer and start a DMA transmit, your data may still
  be sitting in the D-cache and the DMA sends stale RAM. If DMA receives into a buffer you have
  recently read, your next read may hit a stale cache line. You must `SCB_CleanDCache_by_Addr`
  before a transmit and `SCB_InvalidateDCache_by_Addr` after a receive, with buffers aligned to
  and padded out to the 32-byte cache line so you do not clobber a neighbouring variable. This
  is one of the most notorious bug classes on STM32H7 and Teensy 4. It does not exist on M0–M4,
  which have no cache — a good illustration that adding a cache costs you determinism *and*
  correctness guarantees.
- **Not all memory is DMA-able.** On many parts the DMA engine sits on a bus matrix port that
  cannot reach tightly-coupled memory (DTCM), which is exactly where the linker put your stack.
  A DMA from a stack buffer silently transfers nothing.

### 5.5 Memory map and memory-mapped I/O

There are no I/O instructions on Arm and no syscalls. A peripheral register is a memory address.
Arm defines a standard map for all Cortex-M parts, which is why CMSIS is portable at all:

| Range | Contents |
|---|---|
| `0x0000_0000` | Code — flash, and the vector table at the very bottom |
| `0x2000_0000` | SRAM |
| `0x4000_0000` | Peripherals |
| `0x6000_0000` | External RAM |
| `0xE000_0000` | Private Peripheral Bus — NVIC, SysTick, SCB, MPU, debug |

Vendors then map their peripherals inside `0x4000_0000`, and the standard C idiom is a struct
overlaid on the base address:

```c
typedef struct { volatile uint32_t MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR; } GPIO_TypeDef;
#define GPIOA ((GPIO_TypeDef *) 0x48000000UL)
GPIOA->ODR |= (1u << 5);
```

Every field is `volatile`, and the struct layout must match the hardware exactly — which is why
these headers are machine-generated from the vendor's SVD (System View Description) files.

Two hardware behaviours that break the ordinary C mental model:

- **Read-to-clear and write-1-to-clear registers.** Reading a status register may clear it as a
  side effect. A read-modify-write on such a register loses events. Worse, a *debugger* reading
  it clears it, so the bug disappears under inspection.
- **Write-only registers.** `x |= bit` on a write-only register reads garbage. Drivers keep a
  RAM shadow copy of the intended value.

Two things are worth verifying in the compiler, because both are reassuring
**[verified — real output, `-O2 -mcpu=cortex-m4`]**. First, the struct overlay costs nothing —
`GPIOA->ODR |= (1u<<5)` becomes a plain base-plus-offset access, no pointer arithmetic at
runtime. Second, the atomic bit-set register is genuinely cheaper than the read-modify-write:

```asm
set_via_odr:                 set_via_bsrr:
  ldr r3, [r2, #20]            movs r2, #32
  orr r3, r3, #32              str  r2, [r3, #24]   ; one store, atomic, no read
  str r3, [r2, #20]            bx lr
  bx lr
```

**Bit-banding** on Cortex-M3 and M4 gives an alias region where each 32-bit word maps to one bit
of the underlying memory, so a single store performs an atomic bit set without a
read-modify-write. It was dropped in Armv8-M; the modern answer is a hardware bit-set/bit-clear
register pair — ST's `BSRR` above, the RP2040's `SET`/`CLR`/`XOR` register aliases, RP1's
equivalents — or, on AVR, the `sbi`/`cbi` instructions. **The same idea recurs at every scale in
this curriculum: give the hardware a way to set one bit so software never has to read, modify
and write.**

### 5.6 The linker script, and why embedded linking is different

On a hosted system the linker script is invisible because the OS loader handles placement.
Embedded has no loader, so *you* must state where everything goes, and the addresses are
physically real.

```ld
MEMORY {
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 512K
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 128K
}
SECTIONS {
  .isr_vector : { KEEP(*(.isr_vector)) } >FLASH
  .text       : { *(.text*) *(.rodata*) } >FLASH
  .data       : { _sdata = .; *(.data*) _edata = .; } >RAM AT >FLASH
  _sidata = LOADADDR(.data);
  .bss        : { _sbss = .; *(.bss*) *(COMMON) _ebss = .; } >RAM
}
```

The load-bearing ideas:

- **`>RAM AT >FLASH` is the whole trick.** Initialised globals must *live* in RAM at runtime
  (VMA = `0x2000_0000`) but must be *stored* in flash across power-off (LMA = somewhere in
  `0x0800_0000`). The linker gives the section two different addresses, and the startup code
  copies from LMA to VMA. This is the single most important thing to understand about embedded
  linking, and it is why a large `const`-less initialised array costs you *both* flash and RAM.
- **`.bss` costs no flash.** Zero-initialised data is not stored; startup zeroes it. Moving a
  buffer from `= {1,2,3}` to zero-init can save real flash.
- **`KEEP()` on the vector table.** With `--gc-sections`, the linker discards sections nothing
  references. Nothing in C references the vector table — the *hardware* does. Without `KEEP()`
  it is garbage collected and the chip does not boot.
- **`-ffunction-sections -fdata-sections -Wl,--gc-sections`** puts each function in its own
  section so unused ones can be dropped. On a part with 32 KB of flash this is not an
  optimisation, it is a requirement.
- **Read the `.map` file.** `-Wl,-Map=out.map` tells you exactly what consumed your flash and
  RAM. It is the embedded equivalent of a profiler and it is criminally underused.

Reference: the GNU `ld` manual, sections on `MEMORY`, `SECTIONS` and output section LMA.

### 5.7 From reset vector to `main()`

**On Cortex-M**, the hardware does something genuinely unusual that is worth dwelling on. On
every other architecture the reset vector is just an address to jump to. On Cortex-M, the
processor reads **two** words from the start of the vector table:

1. Word at offset `0x00` → loaded into the **main stack pointer**.
2. Word at offset `0x04` → the **reset handler address**, loaded into the PC.

So the stack is valid before a single instruction executes, and C can run immediately with no
assembly stack setup. (The address at `0x04` must have its low bit **set** — the Thumb bit.
Cortex-M has *only* Thumb-2; there is no A32 instruction set, and an address with a clear low
bit causes a HardFault. Toolchains handle this, but it explains the odd odd-numbered addresses
in a vector table dump.)

Then, in order:

1. `Reset_Handler` runs.
2. Copy `.data` from `_sidata` (flash) to `_sdata`.`.._edata` (RAM).
3. Zero `.bss` from `_sbss` to `_ebss`.
4. `SystemInit()` — configure the PLL, clock dividers, flash wait states, and the vector table
   offset register. Wait states matter: flash cannot keep up with a 400 MHz core, and setting
   the clock before the wait states is an instant, baffling crash.
5. `__libc_init_array()` — run C++ static constructors and anything in `.init_array`.
6. `main()`.
7. If `main` returns, spin forever. There is nowhere to return *to*.

**On AVR** the shape is the same but the mechanism is different and less magical. Address 0 is
the reset vector and the whole bottom of flash is a table of `rjmp`s. avr-libc splits startup
across numbered `.init0`–`.init9` sections which the linker concatenates in order: `.init2`
sets up the stack pointer and clears R1 (the zero register), `.init4` holds `__do_copy_data` and
`__do_clear_bss`, and `.init9` jumps to `main`. Because the ordering is by section name, you can
inject your own code very early — `__attribute__((section(".init3")))` is the standard way to
disable the watchdog before anything else runs, which matters because a watchdog reset on AVR
leaves the watchdog *enabled* with a short timeout and you can boot-loop forever otherwise.

### 5.8 `volatile`, precisely

C is defined in terms of an abstract machine, and the compiler need only preserve *observable
behaviour*. Reads and writes of ordinary objects are not observable — they can be reordered,
merged, hoisted out of loops, or deleted entirely, so long as the visible result is the same.
`volatile` declares that accesses to this object *are* observable side effects, so every access
in the source must appear in the output, in order, none added and none removed.

Three cases where it is required:

1. **Memory-mapped registers.** The value can change without the program writing it, and
   writing can have effects unrelated to storage.
2. **Variables shared with an ISR.** The ISR is invisible to the compiler's dataflow analysis.
3. **Variables shared with another thread** — *with a large caveat, below.*

What `volatile` does **not** give you, and this is where people get hurt:

- **Not atomicity.** A `volatile uint32_t` on an 8-bit machine is still four separate byte
  accesses.
- **Not ordering with respect to non-volatile accesses.** The compiler may not reorder two
  volatile accesses relative to each other, but it may freely move ordinary accesses across
  them.
- **Not a memory barrier, and nothing at all about the hardware.** The *CPU* may still reorder,
  and a write may sit in a store buffer. On Cortex-M you need `DMB`/`DSB` (CMSIS `__DMB()`,
  `__DSB()`) — for example after writing to a register that enables an interrupt, before
  relying on it.
- **Not a substitute for atomics in multithreaded code.** This is the point of the Linux
  kernel's `Documentation/process/volatile-considered-harmful.rst`: for concurrency, proper
  locking or `atomic_t` already implies the necessary barriers and compiler constraints, and
  reaching for `volatile` instead usually signals a misunderstanding. **The kernel's argument
  is about inter-CPU concurrency and does not apply to the two genuinely correct embedded uses
  above** — MMIO and ISR-shared flags on a single core. Teach both halves or students will
  cargo-cult one of them.

Section 7 Exercises B and C demonstrate every classic failure in real compiler output.

### 5.9 Bare metal vs RTOS vs Linux

**Bare metal / superloop.**

```c
int main(void) { init(); for(;;) { poll_a(); poll_b(); service(); } }
```

Smallest, fastest, most predictable, and entirely adequate for a very large fraction of real
products. It degrades when tasks have genuinely different rates and one long operation starves
another; the usual progression is superloop → superloop with a timer tick and state machines →
cooperative scheduler → preemptive RTOS. Many teams should stop before the end of that list.

**RTOS.** FreeRTOS is the common one: tasks with priorities, a preemptive scheduler driven by a
tick interrupt (typically 1 kHz), queues, semaphores, mutexes with priority inheritance, and
direct-to-task notifications (much cheaper than a queue for simple signalling). It can be built
with fully static allocation, which is what safety-critical work requires. Footprint is in the
single-digit kilobytes of flash — the usual figure quoted is roughly 6–12 KB depending on
features **[unverified as an exact number]** — plus a separate stack per task, which is the
real memory cost and the usual source of stack-overflow bugs.

The thing to be honest about: **an RTOS gives you concurrency, not determinism.** A preemptive
scheduler makes the *highest-priority ready task* deterministic and everything below it much
less so, and it introduces every concurrency bug you know from userspace into a system with no
memory protection to catch them.

Zephyr is a different proposition — a full OS with a device tree, Kconfig, a real driver model,
networking, filesystems and Bluetooth, under Linux Foundation governance and adopted as the
basis of Nordic's nRF Connect SDK. It brings genuine portability and a genuine learning cliff.

**Embedded Linux.** Requires an MMU, which as noted is a hard architectural line: Cortex-M
cannot run it, Cortex-A can. Buys you a filesystem, a TCP/IP stack, process isolation, package
management and the ability to run software you did not write. Costs you seconds of boot,
tens of megabytes of RAM, unbounded worst-case latency, and a filesystem that can be corrupted
by power loss — whereas an MCU losing power simply resets. (uClinux / `NOMMU` builds exist for
MMU-less parts but give up `fork()` and memory protection, and are a niche.)

**Decision criteria**, roughly in priority order: Do you need hard real-time response measured
in microseconds? → MCU. Do you need a network stack, a filesystem, or third-party software? →
Linux. Both? → a heterogeneous part (STM32MP1, i.MX, or the nRF5340 model) or two chips, with
the real-time work on a core that Linux cannot preempt.

### 5.10 Watchdogs

A watchdog is a countdown timer that resets the chip unless the software periodically clears
it. It is the last line of defence against a hang.

The details that matter:

- **An independent watchdog runs from its own oscillator**, so it survives a failure of the main
  clock or PLL. A window watchdog additionally rejects a pet that comes *too early*, catching a
  runaway loop that pets it constantly.
- **Never pet the watchdog from a timer ISR.** This is the classic mistake. If the main loop
  hangs but interrupts still run, the ISR happily pets the watchdog forever and the watchdog
  protects nothing. The correct pattern is for each critical task to set a flag showing it has
  run, and for one place to pet the dog only when all flags are set — then clear them.
- **Read the reset cause register on boot** and record it. A device that silently reboots and
  does not know why is a device you cannot debug in the field.
- The AVR-specific trap noted in 5.7: after a watchdog reset the WDT is still enabled with a
  short timeout, so clearing it must be nearly the first thing that happens.

### 5.11 Power modes

Typical tiers, with the names varying by vendor: **active** → **sleep** (core clock stopped,
peripherals running, wakes on any interrupt, µs wake) → **deep sleep / stop** (most clocks off,
RAM retained, wakes on a few sources, µs–ms wake) → **standby** (RAM mostly lost, essentially a
reset on wake) → **shutdown** (almost everything off, nanoamps, wakes only on a pin or RTC).

Current ranges span six orders of magnitude — tens of milliamps active, single-digit
microamps in deep sleep, hundreds of nanoamps in shutdown.

The two lessons:

- **Average current is what determines battery life**, so the design goal is to be asleep
  essentially always and to wake briefly. A device that is awake 0.1% of the time at 10 mA and
  asleep at 1 µA averages about 11 µA. Getting the *duty cycle* down beats optimising the
  active-mode current.
- **The core is usually not what is costing you.** A forgotten peripheral clock, a pull-up
  resistor with the pin driven low, a floating input oscillating, an LED, or the regulator's own
  quiescent current will each dwarf a sleeping core. Debugging this means an ammeter with
  microamp resolution and a lot of patience, and it is where the "floating input" point from
  5.1 comes home.

---

## 6. FPGA, briefly

### 6.1 What an FPGA physically is

A two-dimensional array of configurable logic blocks embedded in a sea of programmable routing.

- **The LUT is the bridge back to NAND.** A LUT is literally a small SRAM used as a truth table:
  a 4-input LUT is 16 bits of memory addressed by the four inputs, and it can therefore
  implement *any* Boolean function of four variables. Modern parts use 6-input LUTs (64 bits),
  often splittable into two smaller ones. This is the concrete answer to "how does a gate design
  become real silicon": your NAND gate is not built from a NAND transistor pair, it is a
  configuration of a memory. Which is a lovely inversion to show a class.
- **Flip-flops**, one or two per LUT, provide state and the clock boundary.
- **Carry chains** — dedicated fast paths between adjacent cells, because ripple carry through
  general routing would be hopelessly slow and adders are everywhere.
- **Block RAM**, a few kilobits each, dual-ported, scattered through the fabric.
- **DSP blocks** — hardened multiply-accumulate units, because building a multiplier from LUTs
  is enormously wasteful.
- **Clock management** — PLLs/MMCMs and dedicated low-skew global clock networks.
- **Programmable routing**, which is the part nobody expects: the switch matrices and wire
  segments typically dominate die area and are usually the source of your timing failures. The
  logic is rarely the bottleneck; getting the signal across the chip is.

**Configuration is volatile** in most FPGAs — SRAM cells, reloaded from an external flash on
every power-up, taking milliseconds. Lattice iCE40 and MachXO parts include on-chip flash
(instant-on, and no exposed bitstream). Antifuse parts are one-time programmable and used in
space and defence.

### 6.2 Verilog and VHDL are not programming languages

They are *hardware description* languages, and every difficulty beginners have comes from
reading them as software.

- **Everything is concurrent.** Statements in separate `always` blocks are not "run" in any
  order; they are all simultaneously-existing hardware, evaluated every time their inputs
  change.
- **`always @(posedge clk)` infers flip-flops.** That is how you get state. Combinational logic
  is everything else, and accidentally inferring a latch (by not assigning every output on every
  path in a combinational block) is the classic beginner bug.
- **Blocking (`=`) vs non-blocking (`<=`).** The rule taught everywhere: non-blocking in
  sequential (clocked) blocks, blocking in combinational ones. Mixing them produces designs that
  simulate correctly and synthesise into something else — **simulation/synthesis mismatch**, the
  most demoralising bug class in the field, because your testbench passes and the chip does not
  work.
- **A `for` loop unrolls into parallel hardware.** `for (i=0;i<8;i=i+1) sum = sum + a[i];` is
  not a loop, it is eight adders in a chain. Writing `for (i=0;i<1000000;...)` will attempt to
  instantiate a million adders and your synthesis run will not finish.
- **Only a subset of each language is synthesisable.** Delays (`#10`), `$display`, `initial`
  blocks in most contexts, and real arithmetic are simulation-only.

The flow is **synthesis** (HDL → netlist of LUTs and flops) → **place and route** (assign to
physical resources and find wires) → **bitstream** → **configuration**. The dominant constraint
is **timing closure**: the longest combinational path between two flip-flops sets the maximum
clock frequency, and when it does not meet your target you pipeline it — insert registers,
adding latency to gain throughput. This is the same pipelining idea as a CPU, met from the
other side, and it is a good curriculum linkage.

Modern alternatives worth naming: SystemVerilog (now the mainstream in industry),
and the generator languages — Chisel (Scala), Amaranth (Python), SpinalHDL — which let you
write programs that *emit* hardware, a genuinely different and more powerful idea than writing
the hardware directly.

### 6.3 When to reach for an FPGA

**Yes:** response latency in nanoseconds with zero jitter (motor control, physics triggers,
low-latency trading); massive parallel I/O (hundreds of pins switching simultaneously); a
protocol nobody makes a chip for; very high-rate DSP where you need thousands of multiplies per
cycle; cycle-accurate emulation of old hardware; and prototyping an ASIC before committing to
masks.

**No:** anything a $2 microcontroller can do; anything dominated by floating-point throughput
where a GPU wins on both cost and effort; cost- or power-sensitive high volume (that is an
ASIC); and — honestly — anything where the team's time matters more than the last microsecond,
because the tooling is slow, proprietary, and unpleasant, and compile times are measured in
tens of minutes.

### 6.4 The bridge back to NAND gates

This is the payoff for the first half of the curriculum, and it is real: **a nand2tetris design
can be ported to Verilog and run on an actual FPGA.** The Hack architecture is small enough
(a 16-bit CPU, an ALU with a handful of control bits, ROM and RAM) to fit comfortably in an
entry-level part, and the mapping is direct — HDL chips become modules, the ALU becomes
combinational logic, the registers become flip-flops. The screen and keyboard become a VGA
output and a PS/2 or USB input, which is the only part that requires new work.

Several public projects do exactly this. **[unverified — I could not confirm specific
repositories in this session because the web search budget was exhausted; verify and pick a
concrete one before teaching from it. Search terms: "nand2tetris FPGA Verilog", "Hack computer
iCE40", "Hack CPU Basys 3".]**

The pedagogical point is worth stating explicitly: in nand2tetris the NAND gate is a simulator
primitive and the whole thing is a thought experiment. On an FPGA it becomes a LUT configuration
driving real voltages on real pins at a real clock rate, and it either meets timing or it does
not. That transition — from "my design is correct" to "my design closes timing at 25 MHz" — is
the moment a student learns that hardware is a physical discipline.

### 6.5 Accessible hardware and open tooling

- **Lattice iCE40** is the one to teach on, because of **Project IceStorm** — the bitstream
  format was reverse-engineered, and there is a completely open toolchain: **Yosys** for
  synthesis, **nextpnr** for place and route, IceStorm for bitstream packing. No vendor account,
  no 30 GB installer, no licence server, and it runs on any OS. Boards: iCEBreaker, TinyFPGA BX,
  Icestick, Alchitry. **[unverified — the toolchain is well established and actively maintained,
  but I could not re-confirm its exact current state in this session.]**
- **Lattice ECP5** — bigger, also open (Project Trellis). Boards: ULX3S, OrangeCrab, ColorLight
  repurposed LED panel drivers, which are absurdly cheap.
- **AMD/Xilinx Artix-7** — the Digilent Basys 3 and Arty are the standard academic boards, with
  Vivado (free WebPACK edition, proprietary, enormous).
- **Intel/Altera** — Terasic DE0-Nano, DE10-Lite, DE10-Nano (the last has a hard Arm core and is
  the basis of the MiSTer retro-computing project, which is the most spectacular demonstration
  of cycle-accurate FPGA emulation available).

### 6.6 Soft cores and hard cores

- **Soft core** — a CPU synthesised into the fabric out of ordinary LUTs and flops. PicoRV32
  (tiny, area-optimised), VexRiscv (configurable, Spinal-generated), NEORV32 (VHDL, very
  complete). These are slow — tens of MHz — but you can instantiate several, and you can modify
  the ISA, which is the point.
- **Hard core** — a real CPU hardened next to the fabric on the same die. AMD Zynq (Cortex-A9 or
  A53) and Intel SoC FPGAs. You get Linux on the CPU side and deterministic logic on the fabric
  side, sharing memory. This is the honest answer to "I need both an OS and nanosecond timing"
  and it directly parallels the nRF5340 and RP1 architectures elsewhere in this report.

### 6.7 FPGA vs ASIC, and getting a chip made

An FPGA pays roughly an order of magnitude in area, power and clock speed versus an ASIC on the
same node, in exchange for being reconfigurable and having essentially zero NRE. An ASIC's mask
set costs from tens of thousands of dollars on a mature node into the millions at a leading
node, so the crossover is a volume question.

What is genuinely new and worth telling students: **an individual can now have a chip
fabricated.** **Tiny Tapeout** aggregates many small designs onto one shared die on a multi-
project wafer shuttle, so the mask cost is split hundreds of ways. Pricing is per "tile" —
**€70 per tile, with a single-tile digital design at roughly €185 including shipping and the
board** **[verified against tinytapeout.com's published pricing and calculator, September 2026;
analog designs require a minimum of two tiles and add per-pin cost]**. Related: Google and
Efabless's OpenMPW / chipIgnite shuttles on the SkyWater 130 nm open PDK. **[unverified —
Efabless's status has changed since the programme began and should be checked before citing.]**

That means the curriculum can, in principle, end where it started: a student's NAND-gate design,
described in Verilog, verified on an iCE40, and then fabricated as actual silicon for the price
of a decent mechanical keyboard.

---

## 7. Curriculum design

### 7.1 Five units in dependency order

Each unit is stated as **the one idea it delivers**. If a student comes away with only that
sentence, the unit worked.

---

#### Unit 1 — The chip with no operating system

> **One idea: on a microcontroller, your `main()` *is* the system. There is nothing underneath
> it.**

Where it sits: directly after the NAND-gate and CPU-from-scratch material. The student has just
built a CPU that has no OS because they never wrote one. Now they meet a commercial chip that
has no OS *by design*, and the continuity is the whole point.

Content: the taxonomy from section 1, but concretely rather than as a table — the ATmega328P
as a complete computer on one die; the memory map (registers at `0x00`, I/O at `0x20`, SRAM at
`0x100`); reset behaviour and the vector table; the superloop; why 2 KB of SRAM changes how you
write C. First contact with a datasheet, which is a skill in itself and should be taught
deliberately: how to find the register description tables and read a bit-field diagram.

Prerequisite for everything else. Nothing here requires hardware.

---

#### Unit 2 — The abstraction has a cost, and you can measure it

> **One idea: `digitalWrite(13, HIGH)` and `PORTB |= _BV(PB5)` do the same thing, and one of
> them costs about twenty-six times more. You can see exactly why in the assembly.**

Where it sits: immediately after Unit 1, because it is the single most convincing lesson in the
entire subject and it hooks people.

Content: the AVR register file and its asymmetries (R16–R31 for immediates, X/Y/Z pointer
pairs, R1 as the zero register); the avr-gcc calling convention; `sbi`/`cbi` and why they only
reach the low 32 I/O addresses; PROGMEM and what Harvard architecture costs you; then Exercise
A below, which is the centrepiece. Finish with the generalisation: this is not an Arduino
criticism, it is what *every* portable abstraction over hardware costs, and the same
investigation applies to an STM32 HAL call.

Depends on: Unit 1. Enables: Unit 3, and honestly enables a healthy scepticism that serves the
rest of the course.

---

#### Unit 3 — Time, interrupts, and the things the compiler will take away from you

> **One idea: the compiler is allowed to delete code you need, because it cannot see the
> hardware or the interrupt — and `volatile` is how you tell it what it cannot see.**

Where it sits: after Unit 2, because it needs the student to already be reading assembly
comfortably.

Content: timers, prescalers, PWM and the ADC as the way you actually measure and control time;
the interrupt vector table and the `ISR()` macro; ISR discipline from section 5.3; then
Exercises B, C and D, which show the loop being deleted, the MMIO writes being merged, and the
16-bit tearing race. The `ATOMIC_BLOCK` fix. This unit converts `volatile` from a keyword
students have seen and not understood into something they have watched go wrong.

Depends on: Unit 2. Enables: everything about correctness.

---

#### Unit 4 — Wider machines: Cortex-M, and what changes when the chip stops being small

> **One idea: the same C, on a machine with enough registers, produces different code and a
> different set of problems — and the hardware starts taking over jobs the compiler used to
> do.**

Where it sits: after Unit 3. This is the pivot from 8-bit to 32-bit and from "one chip" to "a
family."

Content: the Cortex-M feature ladder (M0/M0+/M3/M4/M7/M33/M55) and what each M-number actually
buys; the NVIC and hardware register stacking, contrasted directly with the AVR's fifteen
pushes; the standard Cortex-M memory map and CMSIS; the linker script and the reset-to-`main`
path from sections 5.6 and 5.7; the HAL-versus-registers debate presented as a real trade with
two defensible sides. Then Exercise E, the cross-architecture prologue comparison, which makes
the register-pressure point viscerally, and Exercise F, which turns the M-number ladder from a
table to be memorised into a difference students can see in the generated code.

Introduce the caches-and-DMA coherency problem here as the sting in the tail: the M7 is faster
*and* it has reintroduced non-determinism, which sets up Unit 5.

Depends on: Units 2 and 3.

---

#### Unit 5 — Where determinism goes to die, and what you do instead

> **One idea: an OS buys abstraction and sells determinism, and knowing which side of that
> trade you are on is the central architectural decision in embedded systems.**

Where it sits: last, because it is the synthesis and it requires everything above to land.

Content: the Raspberry Pi lineage and the SoC/MPU side of the taxonomy; boot chains and why
they take seconds; Linux latency and jitter, `PREEMPT_RT`, and the honest statement that it
reduces the tail without bounding it; the WS2812 problem as the canonical example — 1.25 µs bit
periods with ±150 ns tolerance, trivial from an MCU, unreliable from Linux userspace. Then the
three architectural answers: a second chip; a heterogeneous SoC (nRF5340, STM32MP1, Zynq); or a
programmable I/O engine — **RP2040 PIO**, which is the best thing in this unit and deserves the
most time. PIO is where the course's threads converge: it is a tiny deterministic state machine
you program in nine single-cycle instructions, sitting inside a modern SoC, doing the job an
FPGA would do. Close with the FPGA section and the loop back to NAND gates.

Depends on: all of the above.

---

### 7.2 Machine-checkable exercises

**Platform verification.** Compiler Explorer's public API was queried directly during this
research and **both toolchains are confirmed available [verified]**:

- **avr-gcc: 23 versions**, from 4.5.4 to 16.1.0, `instructionSet: "avr"`. Compiler IDs follow
  the pattern `cavrg1420` (= AVR gcc 14.2.0). **avr-libc headers are present** — `<avr/io.h>`,
  `<avr/pgmspace.h>`, `<avr/interrupt.h>` and `<util/atomic.h>` all resolve, and
  `-mmcu=atmega328p` is accepted, which is the thing that actually makes these exercises work.
- **arm-none-eabi-gcc: 8 versions** (5.4.1 through 11.2.1), listed as "ARM GCC … (none)".
  Compiler ID `carm1121` = 11.2.1. **[verified]** `-mthumb -mcpu=` accepts **cortex-m0, m0plus,
  m3, m4, m7, m23, m33 and m55**; **cortex-m85 is rejected** by GCC 11.2.1 and would need a
  newer arm-none-eabi than Compiler Explorer currently offers. So exercises can cover the whole
  ladder except M85.

  A bonus finding from that sweep, worth putting in front of students because it contradicts a
  natural assumption: **Cortex-M23 emits `udiv`.** It is an ARMv8-M *Baseline* core, which
  people expect to be M0-like, but Baseline includes hardware divide where ARMv6-M does not.
  "Baseline" is not a synonym for "M0-class."
- x86-64 gcc for the comparison arm: `cg151` = 15.1.

Everything below is **real captured output**, not reconstructed. The API can be driven from a
script for autograding:

```bash
curl -s -X POST https://godbolt.org/api/compiler/cavrg1420/compile \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"source":"...","options":{"userArguments":"-Os -mmcu=atmega328p"},"lang":"c"}'
```

**[verified — that exact command was run during this research and returned `"code": 0` with the
expected `sbi 0x5,5` in the `asm` array.]** So every one of these exercises is **automatically
gradeable by counting instructions in the returned assembly**, with no local toolchain to
install, which is exactly what you want for a self-paced course. The response is JSON with an
`asm` array of `{text, source}` objects; filtering to lines between two labels gives you a
per-function instruction count in a few lines of Python.

---

#### Exercise A — `digitalWrite` vs direct port manipulation *(the classic lesson)*

**Task.** Compile both forms for the ATmega328P at `-Os`. Count the instructions. Count the
cycles. Explain the ratio.

**Part 1 — direct port manipulation.** Source:

```c
#include <avr/io.h>
void set_high(void){ PORTB |=  _BV(PB5); }
void set_low (void){ PORTB &= ~_BV(PB5); }
void toggle  (void){ PINB   =  _BV(PB5); }
```

Result, `avr-gcc 14.2.0 -O2 -mmcu=atmega328p` **[verified — real output]**:

```asm
set_high:
  sbi 0x5,5       ; 2 cycles
  ret
set_low:
  cbi 0x5,5       ; 2 cycles
  ret
toggle:
  ldi r24,lo8(32)
  out 0x3,r24     ; writing PINx toggles PORTx on the 328P
  ret
```

**One instruction.** `sbi` (set bit in I/O register) is two cycles on the ATmega328P. Note also
that `toggle` shows the hardware toggle trick from section 5.1.

**Part 2 — `digitalWrite`.** Students compile a faithful standalone reproduction of the real
Arduino core (`ArduinoCore-avr`, `cores/arduino/wiring_digital.c`, LGPL-2.1) together with the
pin tables from `variants/standard/pins_arduino.h`. The real function is:

```c
void digitalWrite(uint8_t pin, uint8_t val)
{
	uint8_t timer = digitalPinToTimer(pin);
	uint8_t bit   = digitalPinToBitMask(pin);
	uint8_t port  = digitalPinToPort(pin);
	volatile uint8_t *out;

	if (port == NOT_A_PIN) return;
	if (timer != NOT_ON_TIMER) turnOffPWM(timer);

	out = portOutputRegister(port);
	uint8_t oldSREG = SREG;
	cli();
	if (val == LOW) { *out &= ~bit; } else { *out |= bit; }
	SREG = oldSREG;
}
```

Compiled at `-Os` for `atmega328p`, `blink_arduino()` — i.e. `digitalWrite(13, 1)` with **both
arguments compile-time constants** — produces **[verified — real output]**:

```asm
blink_arduino:
  ldi r22,lo8(1)
  ldi r24,lo8(13)
  jmp digitalWrite      ; tail call into a 60+ instruction function
```

and `digitalWrite` itself is **63 instructions**, of which the path actually taken for pin 13
is:

```asm
digitalWrite:
  ldi r25,0
  movw r30,r24                              ; --- table lookup 1: timer
  subi r30,lo8(-(digital_pin_to_timer_PGM))
  sbci r31,hi8(-(digital_pin_to_timer_PGM))
  lpm r18, Z                                ; 3 cycles
  movw r30,r24                              ; --- table lookup 2: bit mask
  subi r30,lo8(-(digital_pin_to_bit_mask_PGM))
  sbci r31,hi8(-(digital_pin_to_bit_mask_PGM))
  lpm r19, Z                                ; 3 cycles
  movw r30,r24                              ; --- table lookup 3: port
  subi r30,lo8(-(digital_pin_to_port_PGM))
  sbci r31,hi8(-(digital_pin_to_port_PGM))
  lpm r30, Z                                ; 3 cycles
  cp r30, __zero_reg__
  breq .L1
  cp r18, __zero_reg__
  breq .L3                                  ; pin 13 is NOT_ON_TIMER, skip the switch
.L3:
  ldi r31,0                                 ; --- table lookup 4: port -> register address
  lsl r30
  rol r31
  subi r30,lo8(-(port_to_output_PGM))
  sbci r31,hi8(-(port_to_output_PGM))
  lpm r26, Z+                               ; 3 cycles
  lpm r27, Z                                ; 3 cycles
  in r25,__SREG__                           ; --- save interrupt state
  cli
  ld r24,X                                  ; read-modify-write through a pointer
  cpse r22,__zero_reg__
  rjmp .L11
.L11:
  or r24,r19
  st X,r24
  rjmp .L12
.L12:
  out __SREG__,r25                          ; restore interrupt state
  ret
```

**Cycle count for the pin-13 path: 52 cycles**, counted from this listing using ATmega328P
timings (`lpm` = 3, `ld`/`st` = 2, `ret` = 4, taken branch = 2, `rjmp` = 2, most others = 1),
plus about 5 more in the caller.

**[verified two independent ways.]** The count was derived twice during this research from
avr-gcc 7.3.0 and 14.2.0 output, and it agrees with the published scope measurement: Bill
Grundmann put an oscilloscope on a 16 MHz Arduino in 2009 and measured *"about 3.3 µsec (~53
clock cycles)"* high and *"~55 clock cycles"* low, versus *"only 125 ns (only 2 clocks)"* for the
direct port write
([billgrundmann.wordpress.com](https://billgrundmann.wordpress.com/2009/03/03/to-use-or-not-use-writedigital/)).
Static count and measured hardware agree within 3%, which is itself worth showing students —
**you can predict real hardware behaviour by reading the listing.**

**So: 2 cycles versus roughly 55. At 16 MHz that is 125 ns versus about 3.4 µs.**

**Where the cost actually goes** — this is the part worth making students enumerate:

1. **Four PROGMEM table lookups** (timer, bit mask, port, output register address), at 3 cycles
   per `lpm` plus 3 instructions of pointer arithmetic each.
2. **A runtime validity check** on the port.
3. **A `switch` over six PWM timers** to turn off `analogWrite` if it was active on this pin.
4. **A pointer-based read-modify-write** instead of the single-instruction `sbi`, because `sbi`
   requires a *compile-time constant* address in the low 32 I/O registers and the address here
   is in a register.
5. **`cli`/restore around the write** — necessary, because a non-atomic read-modify-write of a
   port register can be corrupted by an ISR that touches the same port. `sbi` is atomic in
   hardware and needs none of this.

**Part 3 — the twist that makes this a real lesson.** Ask students: "the pin is a constant, so
why doesn't the optimiser fold it all away?" Then make `digitalWrite` `static inline` and
recompile. Result **[verified — real output]**:

```asm
blink_arduino:
  ldi r30,lo8(digital_pin_to_timer_PGM+13)   ; address folded...
  ldi r31,hi8(digital_pin_to_timer_PGM+13)
  lpm r24, Z                                  ; ...but the value is not
  ...
  cpi r24,lo8(4)                              ; the entire timer switch survives
  breq .L4
  ...
```

GCC inlines it, and constant-folds the table *addresses* — but the whole function still
survives. **`pgm_read_byte` is inline assembly (`lpm`), which the compiler cannot see through.**
Because the tables live in flash, a separate address space reachable only by an opaque
instruction, the optimiser cannot know that pin 13 has no timer, so it cannot eliminate the
switch.

That is a much better lesson than "abstractions are slow." It is: **Harvard architecture puts
your constant data somewhere the optimiser cannot reason about.** It ties Unit 2 back to the
architecture material and explains *why* `PROGMEM` exists at all.

**Autograde:** count instructions in the `blink_direct` and `digitalWrite` symbols; assert
1 and >50 respectively.

---

#### Exercise B — `volatile`, and the loop that vanishes

**Task.** Compile these six functions at `-O2` for `atmega328p` and explain each output.

```c
#include <avr/io.h>
#include <stdint.h>

uint8_t flag_plain;                                    /* A */
void wait_plain(void){ while (!flag_plain) { } }

volatile uint8_t flag_vol;                             /* B */
void wait_vol(void){ while (!flag_vol) { } }

void delay_plain(void){ for (uint16_t i=0;i<50000;i++){} }            /* C */
void delay_vol(void)  { for (volatile uint16_t i=0;i<50000;i++){} }   /* D */

#define BAD_UCSR0A (*(uint8_t *)0xC0)                  /* E: hand-rolled, no volatile */
void wait_bad(void){ while (!(BAD_UCSR0A & (1<<7))) { } }

void wait_good(void){ while (!(UCSR0A & (1<<7))) { } } /* F: avr-libc, volatile */
```

**Results [verified — real output, avr-gcc 14.2.0 `-O2`]:**

```asm
wait_plain:                    ; A - THE BUG
  lds r24,flag_plain           ; read the flag ONCE
  cpse r24,__zero_reg__
  ret
.L3:
  rjmp .L3                     ; then loop forever, never reading memory again

wait_vol:                      ; B - correct
.L6:
  lds r24,flag_vol             ; re-read every iteration
  cp r24, __zero_reg__
  breq .L6
  ret

delay_plain:                   ; C - THE BUG
  ret                          ; 50,000 iterations: gone. The whole function is `ret`.

delay_vol:                     ; D - correct, loop survives on the stack
  push r28
  ...
.L12:
  ldd r24,Y+1
  ldd r25,Y+2
  adiw r24,1
  std Y+2,r25
  std Y+1,r24
  ...
  brlo .L12

wait_bad:                      ; E - THE BUG, on a real hardware register
  lds r24,192                  ; read UCSR0A once
  sbrc r24,7
  ret
.L16:
  rjmp .L16                    ; hang forever

wait_good:                     ; F - correct
.L18:
  lds r24,192
  sbrs r24,7
  rjmp .L18
  ret
```

Three separate classic failures, all real:

- **A**: the ISR-shared flag. The load is hoisted out of the loop; the ISR sets the flag and the
  CPU never notices. The bug is a **two-byte infinite loop**, `rjmp .-2`.
- **C**: the delay loop is deleted *entirely* — `delay_plain` is a single `ret`. Students who
  have written `for(long i=0;i<100000;i++);` as a delay and found it "didn't work at -O2" have
  met this without understanding it.
- **E**: the same bug on a memory-mapped UART status register, which is the version that ships
  in products.

**Autograde:** assert `delay_plain` compiles to exactly one instruction; assert `wait_plain`
contains `rjmp` to itself; assert `wait_vol` contains `lds` *inside* the loop body.

---

#### Exercise C — `volatile` on MMIO, including the honest nuance

**Task.** Same idea on Cortex-M4, but designed to also show students **when `volatile` makes no
difference**, so they learn the rule rather than a superstition.

```c
#include <stdint.h>
#define ODR_V (*(volatile uint32_t *)0x48000014u)
#define ODR_N (*(uint32_t *)0x48000014u)
#define SR_V  (*(volatile uint32_t *)0x40013800u)
#define SR_N  (*(uint32_t *)0x40013800u)
extern volatile uint32_t DR_V; extern uint32_t DR_N;

void pulse_vol(void){ ODR_V=1; ODR_V=0; ODR_V=1; ODR_V=0; }
void pulse_bad(void){ ODR_N=1; ODR_N=0; ODR_N=1; ODR_N=0; }
uint32_t rx_vol(void){ while(!(SR_V & 0x20)){} return DR_V; }
uint32_t rx_bad(void){ while(!(SR_N & 0x20)){} return DR_N; }
uint32_t twice_vol(void){ return SR_V + SR_V; }
uint32_t twice_bad(void){ return SR_N + SR_N; }
```

**Results [verified — real output, arm-none-eabi-gcc 11.2.1 `-O2 -mthumb -mcpu=cortex-m4`]:**

```asm
pulse_vol:                 ; all four stores preserved, in order
  mov r3, #1207959552
  movs r1, #1
  movs r2, #0
  str r1, [r3, #20]
  str r2, [r3, #20]
  str r1, [r3, #20]
  str r2, [r3, #20]
  bx lr

pulse_bad:                 ; THREE OF FOUR WRITES DELETED
  mov r3, #1207959552
  movs r2, #0
  str r2, [r3, #20]        ; only the final value survives - the pulse train is gone
  bx lr

rx_bad:                    ; status read once, then hang
  ldr r3, [r3, #2048]
  lsls r3, r3, #26
  bmi .L14
.L13:
  b .L13

twice_vol:                 ; two independent samples: two loads
  ldr r0, [r3, #2048]
  ldr r3, [r3, #2048]
  add r0, r0, r3

twice_bad:                 ; ONE load, then x+x folded into a shift
  ldr r0, [r3, #2048]
  lsls r0, r0, #1
```

`pulse_bad` is the most alarming: a four-edge bit-bang collapses into **one store**. Three
transitions the hardware needed simply do not exist.

**The nuance to teach honestly.** A *single* isolated MMIO access often compiles identically
with and without `volatile`:

```c
void set_pin_vol(void){ ODR_V |= (1u<<5); }   /* both produce: */
void set_pin_bad(void){ ODR_N |= (1u<<5); }   /*   ldr / orr / str  */
```

**[verified — these two produced byte-identical output.]** So a student who tests `volatile`
with one write concludes it does nothing. The rule is: **`volatile` matters when there is more
than one access to elide, reorder, or hoist — repeated writes, or any read inside a loop.**
Teaching that explicitly prevents the "it worked without volatile so volatile is cargo cult"
conclusion, which is a genuinely common and dangerous one.

**Autograde:** assert `pulse_vol` contains four `str` and `pulse_bad` contains one.

---

#### Exercise D — the cost of an interrupt, and the tearing race

**Task.** Compile these and explain why one ISR is 8 instructions and the other is 38.

```c
#include <avr/io.h>
#include <avr/interrupt.h>
#include <stdint.h>
volatile uint16_t ticks;
volatile uint8_t  ready;
extern void log_event(uint8_t);

ISR(TIMER1_COMPA_vect) { ticks++; }
ISR(INT0_vect) { log_event(1); ready = 1; }

uint16_t read_ticks_racy(void){ return ticks; }
uint16_t read_ticks_safe(void){ uint8_t s=SREG; cli(); uint16_t t=ticks; SREG=s; return t; }
```

**Results [verified — real output, `-Os`]:**

```asm
__vector_11:                   ; ticks++  - leaf ISR, minimal save
  __gcc_isr 1
  push r25
  lds r24,ticks
  lds r25,ticks+1
  adiw r24,1
  sts ticks+1,r25
  sts ticks,r24
  pop r25
  __gcc_isr 2
  reti

__vector_1:                    ; calls a function -> must save EVERYTHING clobberable
  push r1
  push r0
  in r0,__SREG__
  push r0
  clr __zero_reg__
  push r18  push r19  push r20  push r21  push r22
  push r23  push r24  push r25  push r26  push r27
  push r30  push r31
  ldi r24,lo8(1)
  call log_event
  ldi r24,lo8(1)
  sts ready,r24
  pop r31 ... pop r18          ; and 15 matching pops
  pop r0
  out __SREG__,r0
  pop r0
  pop r1
  reti

read_ticks_racy:               ; THE TEARING RACE
  lds r24,ticks                ; <-- an interrupt landing HERE
  lds r25,ticks+1              ;     gives a value that is half old, half new
  ret

read_ticks_safe:
  in r18,__SREG__
  cli
  lds r24,ticks
  lds r25,ticks+1
  out __SREG__,r18
  ret
```

Three lessons in one compile:

1. **A trivial ISR is cheap; an ISR that calls a function is not.** `__vector_1` spends **15
   pushes and 15 pops** — about 60 cycles, ~3.75 µs at 16 MHz — before and after doing any
   work, because the compiler cannot know which registers `log_event` clobbers and must
   conservatively save every call-clobbered register plus `SREG` plus the zero register. This
   is the concrete version of "keep ISRs short."
2. **Contrast with Cortex-M.** Compile the equivalent handler for `-mcpu=cortex-m4`
   **[verified — real output]**:

   ```asm
   SysTick_Handler:
     ldr r2, .L3
     ldr r3, [r2]
     adds r3, r3, #1
     str r3, [r2]
     bx lr              ; <-- an ordinary function return
   ```

   That is an **entirely ordinary C function**. No pushes, no pops, no `reti`, no attribute on
   the declaration — you simply put its address in the vector table. The NVIC stacked
   R0–R3, R12, LR, PC and xPSR in hardware on entry and will unstack them on the `bx lr`.
   Putting this five-instruction listing next to `__vector_1`'s thirty pushes and pops is the
   single clearest way to show what hardware exception support actually buys.

   **Bonus, from the same compile:** a hand-written `Reset_Handler` that copies `.data` and
   zeroes `.bss` with explicit `while` loops compiles to `bl memcpy` and `bl memset` — GCC
   recognises the loop idioms and calls libc. This is a real embedded trap worth showing:
   your startup code now depends on library functions *before* the C runtime is initialised,
   which is exactly why production startup files are written in assembly or built with
   `-fno-builtin`. The vector table itself confirms section 5.7's claim — the first word is
   `_estack`, the second is `Reset_Handler`.
3. **`volatile` did not save you.** `ticks` is `volatile` and `read_ticks_racy` is still
   broken — two `lds` with an interrupt window between them. This is the sharpest possible
   demonstration that **`volatile` ≠ atomic**, and it lands right after Exercise B has convinced
   students that `volatile` fixes things.

**The fix, and the reassuring part.** avr-libc's `ATOMIC_BLOCK` is the idiomatic answer, and it
costs nothing over hand-written code **[verified — real output]**:

```c
#include <util/atomic.h>
uint16_t read_atomic(void){
  uint16_t t;
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) { t = ticks; }
  return t;
}
```

```asm
read_atomic:
  in r18,__SREG__      ; save interrupt state
  cli
  lds r24,ticks
  lds r25,ticks+1
  out __SREG__,r18     ; restore it - safe to call with interrupts already off
  ret
```

Identical to the hand-written `read_ticks_safe`, with no function call and no overhead — the
macro is a `for`-loop trick with a cleanup attribute, entirely optimised away.
`ATOMIC_BLOCK(ATOMIC_FORCEON)` instead emits a bare `cli` / `sei` pair, which is one instruction
cheaper but unconditionally re-enables interrupts and is therefore wrong inside an ISR. Making
students compile both and work out when each is safe is a good five-minute exercise.

**Autograde:** count `push` in each vector; assert ≥14 in `__vector_1` and ≤2 in `__vector_11`.

---

#### Exercise E — what a function prologue costs on a register-starved machine

**Task.** Compile one function for four targets and compare. This is the "why does 8-bit hurt"
exercise.

```c
#include <stdint.h>
uint32_t helper(uint32_t);
uint32_t mix(uint32_t a, uint32_t b, uint32_t c, uint32_t d, uint32_t e, uint32_t f)
{
    uint32_t x = a * b, y = c + d, z = e ^ f;
    uint32_t w = helper(x);
    return w + y * z + x;
}
```

**Results [verified — real output, all at `-Os`]:**

| Target | Instructions in `mix` | Prologue |
|---|---|---|
| ATmega328P | **~100** | 16 pushes + 8-byte frame + interrupt-safe SP update |
| Cortex-M0+ | **13** | `push {r4,r5,r6,lr}` |
| Cortex-M4 | **9** | `push {r4,r5,r6,lr}` |
| x86-64 SysV | **9** | `push r12/rbp/rbx` |

Cortex-M4:

```asm
mix:
  push {r4, r5, r6, lr}
  adds r5, r2, r3
  ldrd r3, r2, [sp, #16]
  mul  r4, r1, r0
  mov  r0, r4
  eor  r6, r3, r2
  bl   helper
  mla  r4, r6, r5, r4     ; fused multiply-accumulate
  add  r0, r0, r4
  pop  {r4, r5, r6, pc}
```

ATmega328P prologue and epilogue:

```asm
mix:
  push r4  push r5  push r6  push r7  push r8  push r9  push r10 push r11
  push r12 push r13 push r14 push r15 push r16 push r17 push r28 push r29
  in r28,__SP_L__
  in r29,__SP_H__
  sbiw r28,8
  in __tmp_reg__,__SREG__
  cli                      ; <-- !!
  out __SP_H__,r29
  out __SREG__,__tmp_reg__
  out __SP_L__,r28
  ...
  call __mulsi3            ; <-- !!
```

Four things to make students find:

1. **Sixteen pushes.** The avr-gcc ABI's call-saved set is R2–R17, R28, R29. Six 32-bit
   arguments is 24 bytes of live values on a machine with 32 single-byte registers, so the
   allocator uses essentially all of them.
2. **`call __mulsi3`.** There is **no 32-bit multiply instruction**. The ATmega328P has an
   8×8→16 `mul`; a 32×32 multiply is a libgcc function call, and there are two of them here.
   Cortex-M4 does it in one `mul`, and even fuses the multiply-add into `mla`.
3. **`cli` in the prologue.** Writing the 16-bit stack pointer takes two 8-bit stores, and an
   interrupt landing between them would see a corrupt SP. **The compiler disables interrupts to
   update the stack pointer.** This is the single most vivid demonstration in the course that
   "8-bit" is not a marketing number — it changes what is atomic.
4. **Arguments spilled to the stack** (`ldd r24,Y+27`), because only R8–R25 carry arguments.

Then a supporting one-liner **[verified]**: on avr-gcc, `sizeof(int) == 2`,
`sizeof(void*) == 2`, `sizeof(long) == 4`, and **`sizeof(double) == 4`** — `double` is `float`
by default on AVR. Every one of those is a real portability trap when Arduino code moves from a
Uno to an Uno R4, and it is worth a slide of its own.

**Autograde:** count instructions per target; assert the AVR version is >5× the M4 version and
contains `__mulsi3`.

---

#### Exercise F — what the M-number actually buys you *(and the flag everyone forgets)*

**Task.** Compile the same two functions for Cortex-M0+, M3 and M4, then compile again for M4
with the FPU flags. Explain all four results.

```c
#include <stdint.h>
uint32_t d(uint32_t a, uint32_t b){ return a / b; }
float fmul(float a, float b, float c){ return a*b + c; }
```

**Results [verified — real output, arm-none-eabi-gcc 11.2.1 `-O2 -mthumb`]:**

| Target | `a / b` | `a*b + c` |
|---|---|---|
| `-mcpu=cortex-m0plus` | `bl __aeabi_uidiv` — software | `bl __aeabi_fmul` + `bl __aeabi_fadd` — software |
| `-mcpu=cortex-m3` | `udiv r0, r0, r1` — **one instruction** | still two library calls |
| `-mcpu=cortex-m4` | `udiv r0, r0, r1` | **still two library calls** |
| `-mcpu=cortex-m4 -mfpu=fpv4-sp-d16 -mfloat-abi=hard` | `udiv` | `vfma.f32 s2, s0, s1` — **one fused instruction** |

```asm
; cortex-m0plus                    ; cortex-m3 / cortex-m4
d:                                 d:
  push {r4, lr}                      udiv r0, r0, r1
  bl __aeabi_uidiv                   bx lr
  pop {r4, pc}

; cortex-m4 with FPU flags
fmul:
  vfma.f32 s2, s0, s1              ; fused multiply-add, one instruction
  vmov.f32 s0, s2
  bx lr
```

Two lessons, and the second one is worth real emphasis:

1. **The M-number is a concrete instruction-set difference, not a speed grade.** ARMv6-M (M0,
   M0+) genuinely has no divide instruction, so every `/` and `%` on a non-constant is a
   function call costing tens of cycles. ARMv7-M (M3 and up) has `udiv`/`sdiv`. This is why
   "avoid division in the inner loop" is much more urgent advice on an M0 than an M4, and it is
   something students can verify rather than take on faith.

2. **`-mcpu=cortex-m4` does not enable the FPU.** You must also pass `-mfpu=fpv4-sp-d16` and
   `-mfloat-abi=hard`. Without them the compiler emits software floating point *on a chip with
   a hardware FPU sitting idle* — and everything still works, just several times slower, with
   no warning of any kind. This is one of the most common real configuration mistakes in
   embedded ARM projects, it is invisible without looking at the assembly, and this exercise
   catches it in about thirty seconds. It also makes the case for why reading generated code is
   a routine skill and not an exotic one.

   (Note the related trap: `-mfloat-abi=hard` changes the *calling convention* to pass floats in
   FPU registers, so every object file and every prebuilt library in the link must agree. Mixing
   them is a link error at best and silent corruption at worst.)

**Part 2 — the DSP extension does not come for free.** A common misconception is that
compiling for `-mcpu=cortex-m4` gets you the DSP/SIMD instructions. Compile a portable
saturating add:

```c
int32_t sat_add(int32_t a, int32_t b){
    int64_t r = (int64_t)a + b;
    if (r > INT32_MAX) r = INT32_MAX;
    if (r < INT32_MIN) r = INT32_MIN;
    return (int32_t)r;
}
```

**[verified — real output]** On Cortex-M4 GCC produces branchless code using **IT blocks**
(`itt lt` / `it ge`) — a Thumb-2 feature — where Cortex-M0+ must `push {r4,r5,lr}` and use real
branches, because ARMv6-M's Thumb subset has no conditional execution. That contrast alone is a
good demonstration of what Thumb-2 buys.

But **neither emits `qadd`**, the actual single-instruction saturating add the M4's DSP
extension provides. You only get it by asking:

```c
static inline int32_t QADD(int32_t x, int32_t y){
    int32_t r; __asm volatile("qadd %0, %1, %2" : "=r"(r) : "r"(x), "r"(y)); return r;
}
```

```asm
sat_add_intrinsic:
  qadd r0, r0, r1     ; one instruction, versus ~14 for the portable version
  bx lr
```

**Lesson 3: `-mcpu` selects what the compiler *may* emit, not what it *will*.** The FPU needs
explicit flags; the DSP extension needs explicit intrinsics (CMSIS `__QADD` and friends) or a
library written against them, such as CMSIS-DSP. "I bought an M4 for the DSP" and "my code uses
the DSP" are entirely different statements, and only the assembly can tell you which is true.

*(A caution worth passing on: inline assembly is not checked against the target ISA the way
ordinary codegen is — the `qadd` above also assembled under `-mcpu=cortex-m3`, which has no DSP
extension. I did not chase down exactly where that check is missing, but the practical warning
stands: inline asm can emit an instruction your part does not implement, and you find out as a
fault at runtime.)*

**Autograde:** assert `__aeabi_uidiv` appears for `cortex-m0plus` and not for `cortex-m3`;
assert `vfma` or `vmul` appears only in the hard-float build; assert `qadd` appears only in the
intrinsic version.

---

### 7.3 Notes on running these as a course

- **No hardware is required for any of the six exercises**, which matters a great deal for a
  self-paced curriculum. Hardware makes Units 3 and 5 much better but nothing is blocked
  without it.
- **Pin the compiler version in the exercise text.** Output differs across GCC releases —
  `__gcc_isr` in Exercise D exists only from GCC 8 onward, and older versions produce a heavier
  ISR prologue. The transcripts above are avr-gcc 14.2.0 and arm-none-eabi-gcc 11.2.1.
- **Pin the optimisation level too**, and make "recompile at `-O0` and explain the difference"
  an exercise in its own right. **[verified]** At `-O0`, the *non-volatile* versions from
  Exercise B are all correct: `delay_plain` keeps its full 50,000-iteration loop, and
  `wait_plain` re-reads the flag on every pass —

  ```asm
  wait_plain:            ; -O0: correct despite no volatile
  .L2:
    lds r24,flag_plain   ; the load IS inside the loop
    cp  r24, __zero_reg__
    breq .L2
  ```

  This is exactly why the bug ships. It works all through development, and appears the day
  someone builds the release with optimisation on. Showing students the same source producing
  correct code at `-O0` and broken code at `-O2` teaches the real lesson — that `volatile` is
  not about making code work today, it is about stating a contract the optimiser must honour.
- If you want a hardware track, the minimum kit is an Arduino Uno (or any 328P board), a
  Raspberry Pi Pico for the PIO material in Unit 5, and an iCEBreaker or similar iCE40 board for
  section 6. Total is well under a few hundred dollars.

---

## 8. Sources and verification status

### Reproduced directly during this research (highest confidence)

All assembly in section 7 is genuine output captured from the Compiler Explorer API
(`https://godbolt.org/api/compiler/<id>/compile`) on the dates of this research:

- `cavrg1420` — avr-gcc 14.2.0, `-Os` / `-O2 -mmcu=atmega328p`
- `carm1121` — arm-none-eabi-gcc 11.2.1, `-Os` / `-O2 -mthumb`, with `-mcpu=` swept across
  cortex-m0, m0plus, m3, m4, m7, m23, m33 and m55 (m85 rejected by this GCC version)
- `cg151` — x86-64 gcc 15.1, `-Os`
- Compiler availability enumerated from `https://godbolt.org/api/compilers/c?fields=id,name,semver,instructionSet`

Specifically reproduced, and safe to teach from: `sbi`/`cbi`/`PINx`-toggle codegen; the full
`digitalWrite` listing and its 52-cycle path, both as an out-of-line call and fully inlined;
the `volatile` failures (loop deleted to a bare `ret`, flag load hoisted into `rjmp .-2`,
four MMIO writes collapsed to one, two register reads folded to one shift); the same code
compiling *correctly* at `-O0`; `ATOMIC_BLOCK` costing nothing over hand-written `cli`;
the AVR ISR prologue at 15 pushes versus a Cortex-M handler ending in a plain `bx lr`; the
16-bit tearing race; the four-target prologue comparison including AVR's `cli` around the
stack-pointer update and its `__mulsi3` call; `sizeof(int)==2` and `sizeof(double)==4` on AVR;
`udiv` present on M3/M4 and absent on M0+; `vfma.f32` appearing only with explicit FPU flags;
`qadd` appearing only via an explicit intrinsic; `ld` versus `lpm` for `const` versus `PROGMEM`;
and struct-overlay MMIO plus `BSRR` costing what the CMSIS idiom promises.

Also computed and checked here rather than taken on trust: the UART baud-error table for
16 MHz versus 14.7456 MHz, and the I²C pull-up resistor bounds.

### Primary sources cited

- Microchip, **ATmega328P datasheet DS40002061A** — register file, memory map, instruction
  timings, timers, PWM modes, ADC, interrupt vector table and response cost.
- Microchip, **AVR Instruction Set Manual DS40002198C** — per-instruction cycle counts and
  operand ranges (including the 5-bit `SBI`/`CBI` I/O address field and the R16–R31 immediate
  constraint).
- **avr-libc 2.1.0 manual** — the register-usage FAQ (standing in for the unreachable
  `gcc.gnu.org/wiki/avr-gcc`), `<avr/pgmspace.h>` on Harvard architecture and `const`,
  `<util/atomic.h>`, `<util/delay.h>`, and the `ISR()` attribute set.
- **ArduinoCore-avr** — `wiring_digital.c`, `wiring.c` (the PWM-mode comment explaining
  490 vs 980 Hz), `wiring_analog.c`, `Arduino.h`, `variants/standard/pins_arduino.h`.
- **ArduinoCore-renesas** `cores/arduino/digital.cpp` and the **ArduinoCore-API** README.
- Official Arduino board datasheets at `docs.arduino.cc/resources/datasheets/` for the Uno R4,
  Nano 33 family, Nano RP2040 Connect, Portenta H7/C33 and Giga R1.
- Bill Grundmann, ["To use or not use digitalWrite"](https://billgrundmann.wordpress.com/2009/03/03/to-use-or-not-use-writedigital/) (2009) — the scope measurement corroborating Exercise A.
- Nick Gammon, ["Interrupts"](http://www.gammon.com.au/forum/?id=11488) — annotated disassembly
  and cycle counts for AVR ISR overhead and `attachInterrupt()`.
- **Raspberry Pi datasheets**: [RP2040](https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf) (Chapter 3 is the PIO reference), [RP2350](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf) (including the E9 erratum), and [RP1 Peripherals](https://datasheets.raspberrypi.com/rp1/rp1-peripherals.pdf) (§3.3.1 for the PCIe latency figure).
- The `raspberrypi/documentation` asciidoc source and [raspberrypi/pico-examples](https://github.com/raspberrypi/pico-examples/tree/master/pio) for the PIO programs.
- Linux `kernel/Kconfig.preempt` — the wording of what `CONFIG_PREEMPT_RT` does and does not
  make preemptible.
- Arm, **"Cortex-M Processor Comparison Table", doc 102787 v0300** — the feature matrix, DMIPS/MHz
  and CoreMark/MHz in section 4.1.
- Arm **Cortex-M3 TRM (DDI0337)** and **Cortex-M4 TRM (DDI0439)** — the 12 / 12 / 6 cycle
  exception-entry, exception-return and tail-chain figures, and the M4-vs-M4F distinction.
- Arm **Cortex-M0+ TRM (DDI0484)**, **Cortex-M23 TRM (DDI0550)**, **Cortex-M7 TRM (DDI0489)**,
  and the Cortex-M33 / M55 / M85 technical overviews — interrupt latency, pipeline depth where
  stated, TCM and cache configuration options, and the Thumb-bit / INVSTATE rule.
- Arm **Cortex-M3 Devices Generic User Guide (DUI0552)** — stack frame, EXC_RETURN values,
  tail-chaining, late arrival, priority grouping, SysTick.
- **CMSIS 6 documentation** (arm-software.github.io/CMSIS_6) — the description of CMSIS as a
  vendor-independent hardware abstraction layer and its component list.
- **ESP-IDF documentation** — the FreeRTOS SMP implementation, the application startup flow
  (`app_main` as a task), PRO_CPU/APP_CPU, flash MMU and cache, and the DRAM/IRAM budget.
- **Nordic S140 SoftDevice Specification** — the reserved NVIC priority levels 0, 1 and 4, the
  latency consequences, and the rule that handlers above priority 4 may not call SoftDevice
  functions. Nordic product pages for nRF52832, nRF52840 and nRF5340.
- **PJRC** Teensy 4.0 and 4.1 product pages and the Audio library page — clock, memory, TCM,
  `FASTRUN`/`FLASHMEM`, and the external bootloader chip.
- **openwch/ch32v003** vendor repository — core, clock, memory and packaging for the CH32V003.
- **avr-gcc ABI**, `gcc.gnu.org/wiki/avr-gcc` — call-saved/call-clobbered register sets,
  argument passing, R0/R1 conventions.
- **ArduinoCore-avr**, `cores/arduino/wiring_digital.c` and `variants/standard/pins_arduino.h`
  (LGPL-2.1) — the `digitalWrite` source in Exercise A was fetched verbatim from the repository.
- NXP, **UM10204**, I²C-bus specification and user manual — speeds, rise-time limits,
  addressing, clock stretching.
- **ISO 11898** — CAN data link layer (-1) and high-speed physical layer (-2).
- **GNU `ld` manual** — `MEMORY`, `SECTIONS`, LMA vs VMA, `KEEP`, `--gc-sections`.
- Arm, **Armv7-M Architecture Reference Manual** and the Cortex-M generic user guides —
  standard memory map, vector table format, NVIC behaviour, Thumb-only execution.
- Linux kernel, `Documentation/process/volatile-considered-harmful.rst` — the counterpoint on
  `volatile` in concurrent code.
- **PREEMPT_RT merged in Linux 6.12** (September 2024), on x86, x86_64, RISC-V and arm64 —
  confirmed via reporting of the merge and the resolution of the `printk` blocker.
  [Phoronix](https://www.phoronix.com/news/Linux-6.12-Does-Real-Time),
  [Wikipedia: PREEMPT_RT](https://en.wikipedia.org/wiki/PREEMPT_RT)
- **Tiny Tapeout** pricing — €70 per tile, ~€185 for a single-tile digital design including
  shipping; analog designs minimum two tiles plus per-pin cost.
  [tinytapeout.com/faq](https://tinytapeout.com/faq/),
  [pricing calculator](https://app.tinytapeout.com/calculator?tiles=1&pcbs=1),
  [analog specs](https://tinytapeout.com/specs/analog/)

### Flagged as unverified

The web search budget for this session was exhausted partway through, so the following are
stated on weaker evidence and should be confirmed before teaching:

1. **FreeRTOS footprint of roughly 6–12 KB** — an order-of-magnitude figure, not a checked one.
2. **The Raspberry Pi Broadcom I²C clock-stretching bug** — very widely reported historically;
   current status unconfirmed.
3. **Specific nand2tetris-on-FPGA projects** — such ports certainly exist and the approach is
   sound, but I could not confirm a particular repository. Pick and verify one before building
   a unit around it.
4. **Current state of Yosys / nextpnr / Project IceStorm** — well established and actively
   maintained as far as I know, but not re-confirmed in this session.
5. **Efabless OpenMPW / chipIgnite status** — the programme's situation has changed over time;
   check before citing alongside Tiny Tapeout.

Additional verification status for sections 2, 3 and 4 is recorded within those sections.
