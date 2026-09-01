# From NAND to a Running Program: nand2tetris vs. Ben Eater vs. J. Clark Scott

Research notes, 2026-09-01. Sources read directly (not from memory):

| Source | What was actually read |
|---|---|
| **nand2tetris** | `nand2tetris.org` course + project01–06 pages; the linked chapter PDFs for **Ch1 Boolean Logic, Ch2 Boolean Arithmetic, Ch3 Sequential Logic, Ch4 Machine Language, Ch5 Computer Architecture, Ch6 Assembler** (extracted with `pdftotext`); the HDL Survival Guide. |
| **Ben Eater** | `eater.net/8bit` and all module sub-pages (`/clock /registers /alu /ram /pc /output /bus /control /parts`), the KiCad-exported schematics, and Eater's own microcode source (`beneater/eeprom-programmer`, `microcode-eeprom-with-flags.ino`). |
| **J. Clark Scott** | Full `_djvu.txt` OCR of the archive.org scan, read end to end; TOC cross-checked against the book's index. |

A structural fact worth stating up front, because it drives most of the differences below:

- **nand2tetris' Hack CPU is single-cycle.** One instruction, one clock tick. There is no step counter, no microcode, no fetch/decode/execute *phases* in hardware — decode is pure combinational wiring inside `CPU.hdl`.
- **Eater's and Scott's machines are multi-cycle.** Both have an explicit step sequencer (Eater: a 74LS161 + 74LS138 giving T0–T4; Scott: a 12-memory-bit "stepper" giving steps 1–7) and both spend their first two or three steps on an identical fetch.

That single difference explains why Eater and Scott can teach "an instruction is a *sequence* of bus transfers" and nand2tetris cannot, and why nand2tetris can get to a running program in six projects and they cannot.

---

## 1. The three progressions, aligned

Rows are ordered by the merged dependency order (section 2), not by any one source's numbering. `—` means the source genuinely does not cover it.

| Concept | nand2tetris | Ben Eater | Scott |
|---|---|---|---|
| Physics → gates | **—** (Ch1 Perspective explicitly declines: "we did not address at all… the physical implementation of gates and chips using the laws of physics") | Prereq videos: *How semiconductors work*, *How a transistor works*, *Making logic gates from transistors* | **—** (one paragraph; "the half-dozen components inside a NAND gate" declared out of scope) |
| One primitive → all gates | **Ch1 / Project 1.** Nand is the only primitive. Build Not, And, Or, Xor, Mux, DMux (15 chips) | Starts *at* gates; buys 74LS00/02/04/08/32/86 off the shelf. Never derives one gate from another | **Ch6–8, 21.** NAND introduced as a story (room with two switches), then NOT (tie inputs), AND (NAND+NOT), OR, XOR. Ch21 ends: "Thank you Mr. NAND gate, bye bye for now" |
| Selection / routing / decoding | **Ch1.** Mux, DMux, Mux4Way16, Mux8Way16, DMux8Way | Implicit in hardware: 74LS157 muxes (RAM run/program mode), 74LS139 (display digit select), 74LS138 (T-state decode). Never taught as a topic | **Ch16.** Multi-input AND, then the 2×4 decoder generalized to 3×8 … 6×64 |
| Binary numbers, two's complement | **Ch2 §2.1–2.2.** Positional notation, 2's complement, "subtraction can be reduced to addition" | ALU videos 1–2: *build a 4-bit adder*, *Twos complement: negative numbers in binary*. Page states the thesis: "you'll know how to add negative numbers, which means you'll know how to subtract!" | **Ch18** (tally → Roman → Arabic → base-6 sloths → binary → hex), **Ch49** (subtraction = NOT + 1 + add; refuses to explain *why*) |
| Adder | **Ch2 / P2.** HalfAdder → FullAdder → Add16 → Inc16 | 2× 74LS283 cascaded | **Ch28.** Half adder (XOR + AND), full adder (2 XOR, 2 AND, 1 OR), eight chained |
| ALU | **Ch2 / P2.** Hack ALU: 6 control bits `zx nx zy ny f no`, outputs `out, zr, ng`, 18 documented functions out of 64 encodings | ALU module: adder + **8 XOR gates on the B input, with `SU` as the other XOR input *and* as the adder's carry-in** → A−B = A+(~B)+1 with one control bit. Flags: carry (C4), zero (NOR tree) | **Ch22–31.** Seven devices (SHL, SHR, NOT, AND, OR, XOR, ADD) + comparator/zero, each behind an enabler, selected by a 3×8 decoder off 3 `op` bits |
| Storing one bit | **Ch3.** *DFF is taken as a primitive.* Ch3 Perspective says so outright and points at other textbooks for the master-slave construction | Prereqs: **SR latch → D latch → D flip-flop**, built from gates, plus *JK flip-flop racing* and *Master-slave JK* on the PC page | **Ch9 "Remember When".** Four cross-wired NAND gates, inputs `i` and `s`, traced exhaustively. Warned as "the hardest diagram in the book" |
| The clock | **Ch3 Background.** Clock = the *time unit*. `out(t)=in(t-1)`. Cycle must be "slightly longer than the time it takes a bit to travel the longest distance." No clock is ever built | **Clock module.** Three 555s: astable (variable 1 Hz–few hundred Hz), monostable (button debounce), bistable (auto/manual mode latch), gate-mux between them, plus `HLT` gating | **Ch33.** A NOT gate feeding itself. Then the two-phase trick: delay `clk` a quarter cycle → `clk d`; `clk e = clk OR clk d` (wide), `clk s = clk AND clk d` (narrow, nested inside) |
| Register | **Ch3.** Bit = DFF + Mux on the load bit; Register = 16 Bits | Registers Parts 3–5: 2× 74LS173 + 74LS245 per register. A, B, IR | **Ch12** (byte = 8 memory bits sharing `s`), **Ch14** (Enabler = 8 AND gates; Register = Byte + Enabler) |
| The bus | **—.** No bus, no tri-state. Hack wires chips point-to-point and selects with Muxes | **Registers Part 1–2 + the whole `/bus` module.** *Tri-state logic: connecting multiple outputs together.* One `*O` bit asserted at a time, ever | **Ch15 "The Magic Bus".** Five registers on one bus; "never enable two registers onto the bus at once" |
| Enable/set discipline | **—** (implicit in load bits) | Control word split into `I` (in/latch) and `O` (out/drive) bits per module | **Ch36.** Control Section drawn as a switchboard: every enable ANDed with `clk e`, every set ANDed with `clk s` |
| Addressable memory | **Ch3 / P3.** RAM8 → RAM64 → RAM512 → RAM4K → RAM16K by "recursive ascent" | RAM module: 2× 74189 (16 bytes total), MAR (74LS173), 74LS157 muxes for program mode + DIP switches. Page calls 16 bytes "by far its biggest limitation" | **Ch17.** The cubbyhole analogy: MAR feeding two 4×16 decoders forming a 16×16 grid; 3 AND gates + 1 register per intersection; 257 registers. **Ch19**: an address is a *position*, not a stored label |
| Program counter | **Ch3.** PC chip: reset > load > inc priority | PC module: one 74LS161. `CE` = count, `/J` = parallel load from bus (that *is* the jump), `/CO` = drive bus | **Ch39.** IAR. Incremented for free during fetch: IAR→MAR while Bus 1 forces `1` into the ALU's B input, ADD → ACC |
| Instruction set / encoding | **Ch4 / P4.** 16-bit `ixxaccccccdddjjj`. A-instruction (`@n`) and C-instruction (`dest=comp;jump`) | 4-bit opcode + 4-bit operand in one byte: NOP, LDA, ADD, SUB, STA, LDI, JMP, JC, JZ, OUT, HLT | **Ch40–47.** 9 types, all 256 codes covered. Bit 0 = ALU-vs-other. `1000 rarb` ADD … `0111 ioda` I/O. 128 of the 256 codes are ALU variants |
| Datapath assembly | **Ch5 / P5.** `CPU.hdl` wires ALU + A + D + PC | `/bus` module: connect everything, then drive every control signal *by hand from switches* before automating | **Ch20** (CPU skeleton with two "?" boxes), **Ch32** (ALU wired in, Bus 1 introduced, inventory of every control bit still unconnected) |
| Control / sequencing | **Ch5.** Purely combinational decode. `i`-bit → A vs C; `a`+`c` bits → ALU; `d` bits → destinations; `j` bits + `zr`/`ng` → PC load | **Control module.** 74LS161 step counter clocked on `/CLK`, 74LS138 → T0–T5 with **O5 fed back to MR (early reset after 5 steps)**; 2× 28C16 EEPROM addressed by `{ZF, CF, opcode[4], step[3], byte-select}` → 16-bit control word | **Ch35–37.** The stepper: 12 memory bits, evens clocked by `clk`, odds by `not clk`, so "on" walks two bits per cycle; steps 1–7, step 7 wired to reset. Control Section = AND every control bit with its step and with `clk e`/`clk s` |
| Fetch–execute made visible | Hidden — it's one cycle | **T0: `MI\|CO`. T1: `RO\|II\|CE`.** Identical in all 16 microcode rows | **Step 1: IAR→MAR + Bus1→ACC. Step 2: RAM→IR. Step 3: ACC→IAR.** Identical for every instruction |
| Conditional branch | `j` bits ANDed against `zr`/`ng` | **Flags register (74LS173) → two more EEPROM address lines.** Four copies of the microcode table; exactly four cells patched to `IO\|J`. Video: *Making a computer Turing complete* | **Ch46.** Flag register (carry, a-larger, equal, zero), set only during step 5 of an ALU instruction. `JCAEZ` tests `OR(flag AND IR-bit)` |
| I/O | **Ch5.** Memory-mapped Screen (16384) and Keyboard (24576) inside `Memory.hdl` | **Output register module:** 74LS273 + 28C16 EEPROM as a binary→7-segment lookup, digit-multiplexed by a second 555 + 74LS107 + 74LS139 | **Ch50–53.** A separate 12-wire I/O bus; keyboard adapter walked through gate by gate; display adapter with dual-MAR RAM and raster scan math |
| Assembler | **Ch6 / P6.** Symbol table, predefined symbols, two-pass | — (one video *Comparing C to machine language*) | **Ch61.** Described, not built |
| Above the metal | **Ch7–12.** VM, compiler, OS | — | **Ch58–70.** OS, scheduling, calling convention (`JMPR R3`), file systems, viruses, firmware, boot, DAC/ADC, philosophy |

### Where they teach the *same* thing at the *same* moment

Three tight alignments worth exploiting:

1. **nand2tetris Ch2 ≈ Eater ALU module ≈ Scott Ch22–31.** All three arrive at "one adder plus an inverter trick does subtraction." Eater's is the cleanest hardware statement (`SU` XORs B *and* feeds carry-in). Scott's is the richest (seven operations, not two). nand2tetris' is the most abstract (six orthogonal control bits generating 64 functions).
2. **nand2tetris Ch3 ≈ Eater's prereq flip-flop trio + registers module ≈ Scott Ch9+14.** Same destination — a loadable register — from three different depths. nand2tetris *starts* where Eater and Scott *finish*: the DFF is handed to you as an axiom.
3. **nand2tetris Ch5 ≈ Eater control module ≈ Scott Ch35–48.** Same goal (a machine that fetches and executes), three different control philosophies: hardwired-combinational, microcoded-ROM, hardwired-with-explicit-stepper.

### Where the alignment breaks

- **The bus.** Eater and Scott both organize the entire machine around one shared bus and an enable/set protocol. nand2tetris has no bus at all — it multiplexes. A learner coming from nand2tetris to real hardware has never met tri-state logic or bus contention.
- **The step counter.** Eater and Scott both make "an instruction takes N clock cycles" physically visible with LEDs. nand2tetris makes it invisible by construction.
- **Gate-level memory.** Only Eater and Scott build a latch. nand2tetris explicitly declines.
- **Transistors.** Only Eater goes below the gate.
- **Anything above machine code.** Only nand2tetris *builds* it (Ch6–12); Scott *describes* it (Ch58–66); Eater does neither.

---

## 2. Merged, dependency-ordered unit list

Eight units. Each names what gets built, the hard prerequisite, and the single idea the unit exists to deliver.

---

### Unit 1 — One primitive, all of logic
**Build:** NOT, AND, OR, XOR, and a 1-bit multiplexer/demultiplexer, using nothing but NAND.
**Requires:** truth tables; that a wire carries one of two values.
**The one idea:** *Functional completeness.* Every Boolean function whatsoever — however complicated — is a finite arrangement of one repeated part. There is no second kind of magic waiting further up.

*(n2t Ch1 · Scott Ch6–8, 21 · Eater's gate videos, though he buys gates rather than deriving them.)*

---

### Unit 2 — Selection and addressing
**Build:** Mux (2→1 and 8→1), DMux, and an n-to-2ⁿ one-hot decoder.
**Requires:** Unit 1.
**The one idea:** *Control is data.* A "control signal" is not a different species of wire — it is an ordinary input that happens to be routed into selector logic. This is the mechanism that will later turn instruction bits into behavior, and it is the same mechanism that will address memory.

*(n2t Ch1 multi-way chips · Scott Ch16 · Eater uses 74LS138/139/157 but never teaches this as a topic — the gap is worth filling.)*

---

### Unit 3 — Arithmetic, and why subtraction is free
**Build:** half adder → full adder → n-bit ripple-carry adder → an ALU with a function-select input and zero/negative/carry flags.
**Requires:** Units 1–2 (the decoder selects which ALU result reaches the output); positional binary.
**The one idea:** *Two's complement makes subtraction into addition.* One control bit that inverts an operand and sets carry-in turns your adder into a subtractor. No second circuit. This is the first moment where a representation choice buys hardware.

*(n2t Ch2 · Eater ALU module · Scott Ch18, 22–31, 49.)*

---

### Unit 4 — Feedback, and the bit that stays
**Build:** SR latch (cross-coupled NANDs) → gated D latch → edge-triggered D flip-flop (master-slave) → a load-enabled register.
**Requires:** Units 1–3 (you need a Mux for the load bit); the willingness to reason about a circuit whose output feeds its own input.
**The one idea:** *Memory is feedback plus a clock edge.* Nothing new is added to the parts bin. The reason a loop of gates is legal here — and illegal in Unit 1 — is that the flip-flop makes `out(t)` depend on `in(t-1)`, not on `in(t)`, which is exactly what breaks the data race.

*(Eater's SR/D-latch/D-flip-flop trio + registers Part 3 · Scott Ch9, 12, 14 · n2t Ch3 assumes the DFF; do not skip the construction here.)*

---

### Unit 5 — The clock and the shared bus
**Build:** a real clock (free-running, plus a debounced single-step mode, plus a halt gate); a two-phase enable/set discipline; a shared bus with exactly one driver enabled per cycle.
**Requires:** Unit 4 (a register you can load on an edge).
**The one idea:** *A clock cycle is a contract about when signals are allowed to be garbage.* Combinational logic is wrong most of the time and right only after it settles; the clock names the moment it is guaranteed settled, and the enable-before-set / set-off-before-enable-off ordering is what lets one wire serve every module without a race.

*(Eater clock + registers Parts 1–2 + `/bus` · Scott Ch15, 33, 36 · n2t Ch3 Background, argued but never built.)*

---

### Unit 6 — Addressable storage and the counter
**Build:** an address register (MAR); a RAM of 2ⁿ words built by stacking registers behind the Unit-2 decoder; a program counter with reset / load / increment priority.
**Requires:** Units 2, 4, 5.
**The one idea:** *An address is a position, not a name.* Nothing inside a RAM cell says which cell it is; the decoder's one-hot output is the only thing that makes address 7 mean the seventh register. And the program counter is just a register whose default behavior is `+1` — which means a jump is not a special mechanism, it is a parallel load.

*(n2t Ch3 RAM8→RAM16K + PC · Eater RAM + PC modules · Scott Ch17, 19, 39.)*

---

### Unit 7 — Instruction encoding
**Build:** an instruction format (opcode field + operand/control fields), an instruction register, and a hand-assembled program of ~10 instructions. Then a program that does the assembling.
**Requires:** Units 3, 6 (you have to know what the fields will *drive* before you can choose them).
**The one idea:** *An instruction is a bit pattern chosen so that the wiring is cheap.* The encoding is not handed down; you design it, and you design it so that field boundaries line up with the decoder inputs, the register selects, and the ALU control bits you already built. Scott says it flatly: "the most important thing in inventing our Instruction Code, will be how simple we can make the wiring."

*(n2t Ch4 + Ch6 · Eater's opcode nibble feeding the EEPROM address lines directly · Scott Ch38–48.)*

---

### Unit 8 — Control: the fetch–execute loop
**Build:** a step counter + T-state decoder; a control-word generator (a microcode ROM, or hardwired combinational logic) mapping `(flags, opcode, step)` → control word; wire it to every enable and set; run a program.
**Requires:** everything above.
**The one idea:** *The instruction decoder is a lookup table.* Given the opcode, the step, and the flags, it emits which registers drive the bus and which latch it. There is no interpreter, no agent, no "understanding" — the control unit is the least clever component in the machine, and once you see the table you have seen the whole computer.

*(Eater control module — literally two EEPROMs · Scott Ch35–37 stepper + switchboard · n2t Ch5, where the same function is combinational wiring rather than a ROM.)*

---

## 3. Misconceptions each source calls out

### nand2tetris

| Misconception | Where | What the book actually says |
|---|---|---|
| **A register is a flip-flop with its output tied to its input.** | Ch3, Fig 3.1, labeled **"Invalid design"** | "it is not clear how we'll ever be able to load this device with a new data value… More generally, the rules of chip design dictate that internal pins must have a fan-in of 1." The fix is a Mux whose select bit *becomes* the load bit. This is the single most valuable diagram in the book. |
| **Feedback loops are always illegal.** | Ch3 §3.1 | Illegal in combinational chips ("the output would depend on itself"), legal in sequential ones, "since the DFFs introduce an inherent time delay… This property guards against the uncontrolled 'data races'." |
| **The ALU's output is trustworthy the instant you present inputs.** | Ch3 §3.1 | "it will take some time before the ALU's output stabilizes… Until then, the ALU will generate garbage." Sequential chips are *allowed* to be in unstable states mid-cycle; they must only be correct at the cycle boundary. |
| **The clock is a thing that makes the computer go.** | Ch3 §3.1 | The clock is a *time unit*, and the cycle length is chosen to exceed the longest propagation path. That's the entire trick "that synchronizes a set of stand-alone hardware components into a well-coordinated system." |
| **A flip-flop is irreducible.** | Ch3 §3.4 Perspective | Explicitly a pedagogical choice, not a fact: flip-flops are normally built "from elementary combinatorial gates (e.g., Nand gates) using appropriate feedback loops," master-slave, two-phase clock — "In this book we have chosen to abstract away these low-level considerations." |
| **NAND is *the* fundamental gate.** | Ch1 §1.4 Perspective | "one can build a complete computer platform using Nor gates alone, or… And, Or, and Not… theoretically equivalent, just as all theorems in geometry can be founded on different sets of axioms." |
| **A chip design is correct or incorrect.** | Ch1 §1.1.2 | Interface is unique; implementation is not. "the Xor function can be implemented using four, rather than five, And, Or, and Not gates." Correctness is contract satisfaction, not shape matching. |
| **`D=D+M` is an expression.** | Ch4 §4.3 Perspective | "the `+` character plays no algebraic role whatsoever… the three-character string `D+M`, taken as a whole, is treated as a single assembly mnemonic." Assembly *looks* like arithmetic and isn't. |
| **A 16-bit instruction can carry a 16-bit address.** | Ch4 §4.3 | Hack is "a ½ address machine" — no room for opcode + 15-bit address, hence the `@xxx` / C-instruction pairing that makes Hack assembly look so strange. |
| **You can sub-bus any internal wire.** (HDL Survival Guide) | — | Sub-busing works only on pins named in `IN`/`OUT` or on a chip-part's pins; a narrower slice of an internal bus must be produced *as an output* of some part. Practical, and a top-3 cause of stuck learners. |
| Bonus non-misconception the book is honest about | Ch2 §2.4 | Its own ripple-carry adder "is rather inefficient, due to the long delays incurred while the carry bit propagates." |

### Ben Eater

| Misconception | Where | What Eater does about it |
|---|---|---|
| **You can wire two outputs to the same wire.** | Registers Part 2, *Tri-state logic: connecting multiple outputs together* | Two totem-pole outputs fighting are a short from VCC to ground. The fix is a **third state, high-impedance** — and Hi-Z is *not* logic 0, it is electrically absent. This is why the control word has one `O` bit per module and the microcode never asserts two at once. |
| **A flip-flop stores a bit while the clock is high.** | D latch → D flip-flop → *JK flip-flop racing* → *Master-slave JK* | A D latch is **transparent**: while enable is high the output *follows* the input. The racing video shows the failure directly — a level-triggered JK toggles repeatedly during one clock pulse. Master-slave (two latches, inverted enables) captures on the *edge*. Everything downstream depends on this. |
| **"555 timer" means "oscillator."** | Clock module, three separate videos | The *same chip* appears three ways in one module: **astable** (oscillates, no stable state), **monostable** (one pulse per trigger — used to debounce the step button), **bistable** (a latch — used to select auto vs. manual mode). |
| **A pushbutton produces one clock pulse.** | Clock module (monostable 555) | Contact bounce would inject many edges per press. The debouncer exists because the naive wiring silently multi-steps the CPU. |
| **The ALU "runs" when you tell it to.** | ALU module | It is combinational and always computing A±B. `EO` only decides whether the answer is allowed onto the bus. |
| **Subtraction needs a subtractor.** | ALU module | Eight XORs on the B input plus `SU` wired to carry-in. `A − B = A + (~B) + 1`, one control bit doing both halves. The page's own framing: "Between the two videos, you'll know how to add negative numbers, which means you'll know how to subtract!" |
| **Signed numbers use a sign bit + magnitude.** | *Twos complement: negative numbers in binary* | The whole video exists because that intuition breaks addition; two's complement lets the *same* adder handle signed and unsigned. |
| **A jump is special machinery.** | PC module | `/J` is the 74LS161's parallel-load enable, with the bus on P0–P3. The microcode proves it: `JMP` is one step, `IO\|J`. |
| **Displaying a number is trivial.** | Output register | Binary→decimal is awkward combinational logic. The module builds it with K-maps, then throws that away for an EEPROM lookup — which is the conceptual setup for the control unit two modules later. |
| **The instruction decoder is complicated.** | Control module | It is two 28C16 EEPROMs. Address = `{ZF, CF, opcode nibble, step, byte-select}`; data = the 16-bit control word. No gates decode instructions. |
| **An instruction happens in one clock tick.** | Control module | Five T-states per instruction, LEDs on the step counter. T0 `MI\|CO` and T1 `RO\|II\|CE` are identical in all 16 rows — every instruction pays for the fetch. |
| **A conditional branch needs branch hardware.** | *Conditional jump instructions* | The flags become two more EEPROM address lines; the sketch builds four copies of the table and patches exactly four cells to `IO\|J`. That is the entire mechanism. |
| **The instruction set is fixed by the wiring.** | *Reprogramming CPU microcode with an Arduino*, *Adding more machine language instructions* | The ISA is *data*. You extend the CPU by reflashing a ROM. This is the actual argument for microcoded over hardwired control. |
| **`LDA/ADD/OUT/JMP` is a computer.** | *Making a computer Turing complete* | It is not — you need a data-dependent branch, which is what motivates the flags register and `JC`/`JZ`. |
| **Active-low is a detail.** | Control schematic | Eleven of sixteen control bits (`/MI /RO /IO /II /AI /AO /EO /BI /CO /J /FI`) pass through a 74LS04 bank; five (`HLT RI SU OI CE`) don't. And the step counter is clocked on `/CLK` so control signals are stable before registers latch on `CLK`. |

### Scott

| Misconception | Where | What Scott says |
|---|---|---|
| **The machine is complicated.** (the framing misconception) | Ch1, the Thermos | Joe assumes a sensor, a heater and a refrigerator. The truth is one principle — heat moves hot→cold, the Thermos only slows it. "Joe's concept of how the bottle worked was far more complicated than the truth." |
| **The computer is smart.** | Ch3 *Speed* | "the secret of computers is not that they are complex, rather it is their speed." Reinforced at Ch53: ~400 instruction cycles to draw one letter on screen. |
| **A bit is a number, or a symbol.** | Ch5 | A bit is a *physical place* with one of two states. A lump of clay is not a bit (too many states) until you fire it with "yes"/"no" on two faces. The entire 1840s telegraph — key, battery, miles of wire, clicker — **is one bit**. |
| **The letter 'E' is in there somewhere.** | Ch13, Ch54 | Edison's row of burned-out bulbs would show `0100 0101` and mean nothing, because ASCII didn't exist yet. Ch54 escalates: that same byte is a letter to the printer, a Jump to the IR, address 69 to the MAR, an addend to the adder, three lit pixels to the screen. "Each of these pieces of the computer is designed with a code in mind, but once it is built, the mind is gone and even the code is gone." **There is no ASCII table anywhere inside the computer.** |
| **An address is stored in the cell.** | Ch19 | Sixteen unsigned streets with sixteen unnumbered houses. "The fourth house on the seventh street" still locates it. Address is position. |
| **Enable and set can be simultaneous.** | Ch33 | The requirement is stated *before* the mechanism: the destination's set must go off *before* the source's enable does. Then `clk d` (quarter-cycle delay), `clk e = clk OR clk d`, `clk s = clk AND clk d` — narrow nested inside wide. "all enables and sets ultimately come from these two bits because they have the right timing." |
| **The stepper is special sequencing hardware.** | Ch35 | Same memory bits as the registers, "arranged very differently… We are not going to store anything in these bits, we are going to use them to create a series of steps." Evens clocked by `clk`, odds by `not clk`, so an "on" walks two bits per cycle. Step 7 is deliberately too short to move data. |
| **The instruction decoder interprets.** | Ch41–42 | Bit 0 alone splits ALU from non-ALU. When bit 0 is off, IR bits 1–3 go into an ordinary 3×8 decoder. Register selection is two 2×4 decoders off IR bits 4–5 and 6–7. That's it. |
| **The control section is a brain.** | Ch36 | "This is sort of a switchboard." All enables down the left ANDed with `clk e`, all sets down the right ANDed with `clk s`. Ch37: "a tightly controlled ballet of bits and bytes." |
| **Data moves.** | Ch15 | "By definition, bytes do not move around inside the computer… the 'from' byte has not changed… The old pattern simply ceases to exist." |
| **Flags can be read whenever.** | Ch46–47 | Flags are latched only during step 5 of an ALU instruction, because by the time a Jump-If runs "the ALU results are long gone." And CLF exists because a stale carry feeds back into add and shift — "you might add 2+2 and get 5." |
| **Software is a thing.** | Ch58 | Software is *the way the hardware is set*. Blank vs. recorded videotape: same weight, same appearance, only the magnetization differs. Two tests: can you send it without a truck; can a machine copy it. |
| **It knows.** | Ch70, the title answer | "NAND gates don't 'know' what they are doing… If one gate doesn't know anything, then it doesn't matter how many of them you connect together, if one of them knows absolutely zero, a million of them will also know zero." And: **"the answer to the question 'But How Do It Know?' is simply 'It doesn't know anything!'"** Plus an explicit warning about the anthropomorphic vocabulary — a computer "remembers," an adapter "listens," a jump "decides" — "There is nothing wrong with this as long as we know the truth of the matter." |
| **This is how real computers are built.** | Ch69 *Full Disclosure* | "no one has ever built this exact computer in the real world." Names the simplifications: wider registers, barrel shifters, hardware multipliers, more registers — and admits "The stepper in our computer is a simplification of something that most computers have, called a 'state machine.'" |

---

## 4. Machine-checkable exercise per unit

Each is stated as: **artifact the learner produces** → **what the checker does** → **what it catches**. The nand2tetris `.hdl` / `.tst` / `.cmp` triple is the existing proof that this is practical: "your chip design, tested on the supplied `.tst` file, should produce the outputs listed in the supplied `.cmp` file."

---

### Unit 1 — Functional completeness
**Build:** `not.hdl`, `and.hdl`, `or.hdl`, `xor.hdl`, `mux.hdl`, `dmux.hdl` — a netlist per gate, referencing only `nand` and previously-defined gates.

**Checker:**
1. **Primitive whitelist:** walk the netlist's part list transitively; assert the only leaf is `nand`. Fails if the learner used a built-in `xor`.
2. **Exhaustive truth table:** enumerate all 2ⁿ inputs (n ≤ 3, so ≤ 8 rows), evaluate the netlist, diff against the reference table. Exact equality, no tolerance.
3. **Acyclicity:** topologically sort the gate graph; a cycle is a hard failure at this unit (there is no clock yet).
4. *(Optional, scored not gated)* report NAND count vs. the known-minimal count — 4 for XOR, 4 for MUX — so the learner sees that correctness and efficiency are separate.

**Catches:** using a forbidden primitive; a De Morgan slip; an unconnected pin (shows up as a wrong row, not a crash).

---

### Unit 2 — Selection and addressing
**Build:** `decoder3to8` (3 select bits → 8 one-hot outputs) and `mux8way16` (8× 16-bit inputs + 3 select → 16-bit out).

**Checker:**
1. **One-hot invariant, exhaustive:** for all 8 select values, assert `popcount(outputs) == 1` and that the hot index equals the select value. 8 cases, total coverage.
2. **Routing property, randomized:** 1000 trials; fill the 8 data inputs with distinct random 16-bit values, pick a random select, assert `out == data[sel]`. Distinct values matter — identical fill would pass a broken mux.
3. **Non-interference:** vary a non-selected input while holding select and the selected input fixed; assert `out` does not change. This catches accidental ORing of all inputs, which passes test 2 when the unselected inputs happen to be 0.

**Catches:** a decoder that lights two lines for some input; a "mux" that is really an OR tree.

---

### Unit 3 — Arithmetic
**Build:** an 8-bit ALU with a function select and `carry`/`zero` flags. Two variants both fully checkable:

**Checker (Eater-shaped, exhaustive):**
- For **all 65,536** pairs `(a, b)` in `0..255`:
  - `SU=0`: assert `out == (a + b) & 0xFF` and `carry == (a + b > 255)` and `zero == (out == 0)`.
  - `SU=1`: assert `out == (a - b) & 0xFF`. Additionally assert the *structural* claim: `out == (a + (~b & 0xFF) + 1) & 0xFF`. Both must hold — the second is what verifies the learner built a subtractor out of an adder rather than a separate path.
- Assert the borrow convention explicitly: `carry == (a >= b)` for `SU=1`.

**Checker (nand2tetris-shaped, exhaustive over control):**
- For **all 64** combinations of `zx nx zy ny f no` × a fixed corpus of `(x, y)` including `0, 1, -1, 32767, -32768, 21845 (0x5555), -21846 (0xAAAA)` and 500 random pairs: run the reference pseudo-code from the Ch2 spec and diff `out`, `zr`, `ng`. This is ~36,000 assertions and finishes in under a second.
- Separately assert that the 18 documented function encodings produce their documented results (`0`, `1`, `-1`, `x`, `y`, `!x`, `-x`, `x+1`, `x-1`, `x+y`, `x-y`, `y-x`, `x&y`, `x|y`, …).

**Catches:** carry-in not wired to `SU`; XOR bank applied to the wrong operand; `ng` computed from the sign of the *inputs* rather than the output; `zr` computed with an AND tree instead of a NOR tree.

---

### Unit 4 — The stored bit
**Build:** `bit.hdl` — a 1-bit register with `in`, `load`, `out`.

**Checker:**
1. **Differential simulation against a 3-line reference.** Generate a 2,000-cycle random trace of `(in, load)` pairs. Reference model:
   ```
   out_next = in if load else out
   ```
   Step the learner's design one clock at a time and assert `learner.out(t) == reference.out(t)` for every `t`. Include runs that hold `load=0` for 200 consecutive cycles (catches leakage) and that toggle `in` rapidly while `load=0` (catches transparency).
2. **Transparency probe — the level-triggered trap.** Within a single clock cycle, change `in` after the edge and assert `out` does **not** change until the next edge. A D-*latch* mistaken for a D-*flip-flop* fails only this test and passes test 1 in most simulators.
3. **Structural check:** walk the netlist graph; assert every cycle in the graph passes through at least one clocked element. A combinational feedback loop is rejected with the offending cycle printed. This is the machine-checked form of nand2tetris' "Invalid design" figure.

**Catches:** feeding DFF output back to its input without a Mux; latch-vs-flip-flop confusion; load bit inverted.

---

### Unit 5 — Bus and clock discipline
**Build:** a control-word format and a bus model with N register models attached, each with an `xI` (in) and `xO` (out) bit.

**Checker:**
1. **Contention detector, static.** Given the learner's full control-word table (all opcodes × all steps × all flag combinations), assert for every entry: `popcount(word & OUT_MASK) <= 1`. For Eater's machine that is a scan over all 1024 EEPROM bytes and it catches bus shorts *before* anything is powered on. This is the highest-value single check in the whole curriculum.
2. **Contention detector, dynamic.** Run the simulation; if two drivers are ever enabled in the same cycle, fail with the cycle number and the two module names — do not silently OR them.
3. **Transfer correctness.** For 500 random `(src, dst)` pairs with random register contents: assert `dst == src_old` after one cycle and that no third register changed.
4. **Clock-phase invariant.** Sample the `clk_e` and `clk_s` waveforms at 100 sub-steps per cycle and assert `clk_s ⊆ clk_e` — every sample where `clk_s` is high has `clk_e` high, `clk_s` rises strictly after `clk_e` and falls strictly before it. This is Scott's Ch33 requirement, expressed as a checkable predicate.
5. **Hi-Z is not zero.** Model a disabled driver as `None`, not `0`. Assert that a bus with zero drivers enabled reads as undefined and that any register latching from it in that cycle is flagged — this catches the "I thought the disabled output drove low" error rather than letting it pass as a plausible `0`.

**Catches:** two `O` bits in one microcode word; set-window overhanging the enable-window; a design that "works" only because floating buses read as 0 in the simulator.

---

### Unit 6 — Memory and the counter
**Build:** `ram8` composed up to `ram1k`, plus a program counter.

**Checker (RAM):**
1. **Differential against a dict.** 10,000 random operations over the address space: `(addr, in, load)`. Reference is a Python list. Assert the output word matches every cycle.
2. **Aliasing sweep.** For every address `a`, write a unique sentinel `0xA000 | a`, then read *all* addresses and assert only `a` changed. For RAM8 this is 64 assertions; for RAM64, 4,096; do the full sweep at every level of the recursive construction, since a wrong decoder bit at RAM64 is invisible if you only spot-check.
3. **Read-during-write.** Assert that `out` reflects the *old* value in the cycle a write is issued, and the new value the cycle after — the timing contract, not just the storage.

**Checker (PC):** differential over 2,000 random `(reset, load, inc, in)` traces against
```
if reset: pc = 0
elif load: pc = in
elif inc:  pc = (pc + 1) & MASK
```
Deliberately include cycles where two or three control bits are asserted simultaneously — the priority order is the thing most learners get wrong, and it only shows up under conflict.

**Catches:** a decoder bit swapped between RAM levels; PC priority inverted; increment wrapping incorrectly at the top address.

---

### Unit 7 — Instruction encoding
**Build:** an assembler (source text → binary) for the learner's own ISA, plus 20 hand-encoded instructions.

**Checker:**
1. **Golden-file diff.** Assemble a corpus of programs and diff the output against reference `.hack`/`.bin` files byte for byte. Include a program with forward label references, backward references, a variable allocated at 16+, and every predefined symbol.
2. **Round-trip property.** `disassemble(assemble(p)) == canonicalize(p)` for the whole corpus, plus 1,000 randomly generated well-formed programs. A round-trip failure localizes to a single instruction, which a golden diff does not.
3. **Field-decode property, exhaustive over the opcode space.** For all 2ⁿ possible instruction words, assert the learner's field extractor (`opcode`, `regA`, `regB`, `dest`, `jump`) agrees with a reference bit-slicing function. For an 8-bit ISA that is 256 cases; for 16-bit Hack, sample the C-instruction space exhaustively over the `a`+`c`+`d`+`j` fields (2¹³ = 8,192 cases).
4. **Encoding-density audit.** Assert every one of the 2ⁿ opcode values maps to exactly one defined instruction or to an explicitly-reserved slot. Scott's ISA covers all 256; an ISA with silent holes is a design bug the checker can name.

**Catches:** off-by-one in the symbol table's next-free-variable counter; a jump-bit ordering swap; unencodable instructions that the learner never happened to write by hand.

---

### Unit 8 — Control and the running machine
**Build:** the control-word table (as a generated ROM image, or as combinational HDL) and the top-level computer.

**Checker:**
1. **ROM image diff.** Generate the reference microcode from a declarative spec; diff the learner's 1,024-byte image byte for byte. Report mismatches as `(flags, opcode, step) → expected word vs. actual word` with bit names, not as hex.
2. **Fetch-invariant, structural.** Assert that for **every** opcode and every flag combination, step 0 is exactly `MI|CO` and step 1 is exactly `RO|II|CE`. This encodes "every instruction pays for the fetch" as a machine-checked property over the whole table.
3. **Contention re-check** (Unit 5 test 1) run against the final table.
4. **Cycle-accurate differential execution.** Run the learner's CPU and a reference emulator side by side on a program corpus. After **every clock cycle**, compare full architectural state: PC/IAR, all registers, flags, and the entire RAM. Report the first divergent cycle with both states. Corpus: `Add`, `Max`, `Rect`, `Mult`, `Fill` (Hack), or Eater's counting / Fibonacci / conditional-jump demos.
5. **End-state tests for whole programs.** `Mult`: for 30 input pairs including `0×n`, `n×0`, `1×n`, and the largest legal product, assert `R2 == R0*R1` at halt and that the program halts within a cycle budget (an infinite loop must fail loudly, not hang the runner).
6. **Turing-completeness probe.** Assert a data-dependent loop terminates correctly: a program that counts down from a runtime value and halts. This fails on a machine with `JMP` but no `JC`/`JZ`, which is exactly the gap Eater's *Making a computer Turing complete* exists to close.

**Catches:** a jump condition ANDed with the wrong flag; the step counter resetting at the wrong T-state; a control bit that should be active-low and isn't (test 4 finds it on the first divergent cycle).

---

**Cross-cutting note on checker design:** every check above is either (a) exhaustive over a small input space, (b) a differential test against a 5-to-20-line reference model, or (c) a static invariant over a generated table. None require a hand-written expected-output file except the golden diffs in Units 7–8. That matters — hand-authored expected outputs are the part of nand2tetris' `.cmp` scheme that does not generalize to a learner's own ISA.

---

## 5. What each source uniquely has

### Only Scott has

- **Clock-phase timing as the load-bearing idea.** `clk` → `clk d` (quarter-cycle delay) → `clk e = OR`, `clk s = AND`. The requirement is motivated first ("we want to make sure that it goes off before we turn off the enable bit"), then the mechanism is derived. nand2tetris asserts the constraint and never builds it; Eater builds a clock but not a two-phase enable/set protocol.
- **A completely uniform data-movement primitive.** *Every* transfer in the machine is "enable exactly one source, pulse set on the destination." Every enable is ANDed with `clk e`, every set with `clk s`, and Ch36 draws the Control Section as a literal switchboard with enables on one side and sets on the other. Nothing in the other two sources is this uniform.
- **Six chapters on code vs. meaning.** Ch10, 13, 18, 53, 54 and the instruction-code chapter all attack the same misconception: nothing about a byte says which code it was written in. The Edison-lightbulbs image and the Ch54 five-destinations-one-byte passage are the best statement of it anywhere in the three sources. nand2tetris and Eater treat encoding as notation.
- **Number systems derived rather than asserted.** Tally marks → Roman → Arabic positional → the base-6 sloth thought experiment → *you already use base 6 in the minutes column of a clock* → binary → hex.
- **Gate-level peripheral adapters.** The keyboard adapter walked through gate by gate: the 8-input AND that recognizes address `0000 1111`, the memory bit that latches "selected," the enables. Plus the display adapter's dual-MAR RAM with separate input and output buses so raster scan and I/O writes never contend. Eater's output register is one EEPROM; nand2tetris' I/O is a memory map.
- **Explicit anti-anthropomorphism as pedagogy.** The book's whole thesis is a misconception-correction, and it names the linguistic trap directly.
- **Honest self-audit.** Ch69 lists what was faked, including "the stepper… is a simplification of something that most computers have, called a 'state machine'."
- **The full stack described.** OS scheduling, the `JMPR R3` calling convention, file systems, compilers, viruses, ROM/PROM/EPROM/EEPROM/Flash, bootstrapping, DAC/ADC, digital-vs-analog.

### Only Eater has

- **Physical reality.** Propagation delay you can see on LEDs, contact bounce you must debounce, a 74189 with inverting outputs, active-low enables, decoupling, power supply, and three full videos on *troubleshooting* a module that doesn't work. Neither book has a failure mode.
- **Tri-state logic, taught explicitly.** The Hi-Z third state, why two totem-pole outputs on one wire is a short circuit, and why Hi-Z is not 0. nand2tetris has no bus at all; Scott has a bus with "don't do that" rather than a mechanism.
- **The latch→flip-flop construction, done properly.** SR latch → D latch (transparent!) → master-slave D flip-flop, plus *JK flip-flop racing* showing the failure mode of getting it wrong. nand2tetris skips this by fiat; Scott's Ch9 memory bit is level-gated and he never distinguishes level- from edge-triggering.
- **Microcode as data.** Two EEPROMs, an Arduino programmer, and two videos about *changing the instruction set by reflashing a chip*. This is the strongest available argument for microcoded control, and neither book makes it — nand2tetris' control is hardwired combinational logic, Scott's is hardwired gates.
- **Three uses of one chip.** Astable / monostable / bistable 555 in a single module: the cleanest available demonstration that "what a component does" is a wiring choice.
- **"A ROM replaces any combinational function."** The 7-segment decoder is built the hard way with K-maps, then discarded for a lookup table — deliberately staged two modules before the control unit, so that when the instruction decoder turns out to be a ROM it is not a surprise.
- **Anti-big-bang integration, stated as method.** "The modularity of the design makes it easier to test each module by itself so we won't ever get to a point where we put it all together and nothing works." And the `/bus` module has you drive every control signal *by hand from switches* before automating any of it.
- **Turing completeness named as a threshold**, with the conditional-branch hardware built to cross it.

### Only nand2tetris has

- **Machine-checked exercises.** The `.hdl` / `.tst` / `.cmp` contract: "your chip design, tested on the supplied `.tst` file, should produce the outputs listed in the supplied `.cmp` file. If that is not the case, the simulator will let you know." Scott has no exercises at all by design; Eater has hardware you can only check by looking at LEDs.
- **A real HDL and simulator**, plus the substitution trick that makes it usable: unimplemented chips fall back to built-in versions, so you can build in any order and isolate failures.
- **Interface/implementation separation, argued.** Ch1: the interface is unique, the implementation is not; XOR in four gates or five, both correct. This is the idea that makes the whole 12-project ladder possible, and it is the only place a learner is told that the *contract* is the deliverable.
- **The full software stack, built.** Assembler (Ch6), VM (7–8), high-level language (9), compiler (10–11), OS (12). Scott describes this; Eater doesn't touch it; nand2tetris is the only one where you write it.
- **Explicit acknowledgement of its own abstractions.** Each chapter's Perspective section names what was left out — flip-flop internals, carry look-ahead, transistors, gate-count optimization — which makes the omissions navigable rather than invisible.
- **An orthogonal ALU control encoding.** Six independent bits (`zx nx zy ny f no`) generating 64 encodings of which 18 are useful — a genuinely different and more elegant design point than Eater's single `SU` bit or Scott's 3-bit op selector, and a better vehicle for "design the encoding to make the wiring cheap."
- **Scale.** RAM16K vs. Eater's 16 bytes and Scott's 256; a 16-bit word; a real screen and keyboard memory map; programs large enough that the software layers above become necessary rather than optional.

### The composite that beats all three

- Eater's **latch → flip-flop** construction and **tri-state bus** (Unit 4–5), because nand2tetris skips both and Scott skips edge-triggering.
- Scott's **two-phase `clk_e`/`clk_s`** and **enable/set switchboard** (Unit 5), because it is the only fully uniform data-movement discipline on offer.
- Eater's or Scott's **step counter** (Unit 8), because a single-cycle CPU hides the fetch-execute cycle exactly where the learner most needs to see it.
- Eater's **microcode-as-ROM** (Unit 8), because "the instruction decoder is a lookup table" is the punchline the whole curriculum is walking toward, and a ROM image is *statically checkable* in a way that hardwired logic is not.
- nand2tetris' **contract-based checking** throughout, because it is the only one of the three that can tell a learner they are wrong without a human in the loop.
- Scott's **code-vs-meaning thread** and **Ch70 answer**, because it is the actual conceptual payload — the reason the exercise is worth doing at all.
