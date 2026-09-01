"""The Hardware Handbook: the track.

This list IS the table of contents. Nothing else registers a unit: `num`,
`title`, `part` and `accent` come from here and nowhere else. A unit whose slug
is absent from TRACK is a hard build error; a slug here with no file on disk is
emitted as a `ready: false` stub so the whole spine is visible from day one.

Backed by 36 research reports in .research/. Each part names the report(s) it
draws on so a unit author knows where to look.

A part's accent is not written on the part. It comes from the phase the part
belongs to, so the colour names a stage of the track rather than decorating it.
Nineteen parts rotating through seven colours is a rotation; seven phases each
holding one colour is a legend the reader can learn:

    gold    golden yellow   building a computer, and the brand
    copper  warm metal      understanding what one is
    clay    earth           the system it runs
    azure   cool blue       programs that scale
    violet  purple          signal, meaning, secrecy
    jade    green           parallel hardware
    slate   neutral         the world outside, and the end of the road

Gold leads rather than green, and that is a functional choice as much as a
visual one: with a green brand, a passing exercise looked like any other
accented element, so the pass colour had to be cyan to stay out of its way.
Gold hands green back to the thing green means everywhere else.
"""

import re

PHASES = [
    # (id, title, one-line, accent, part ids in order)
    ("build", "Build a computer",
     "A switch, then a gate, then a machine that runs a program you wrote.",
     "gold", ("physics", "logic", "silicon")),

    ("understand", "Understand what one is",
     "What it can compute at all, the instruction set it really speaks, and "
     "how it writes down a number.",
     "copper", ("theory", "machine", "numbers")),

    ("system", "The system it runs",
     "The kernel underneath your process, the disk underneath your file, and "
     "the compiler that got you here.",
     "clay", ("systems", "storage", "tools")),

    ("scale", "Programs that scale",
     "What costs what as the input grows, what breaks when two things run at "
     "once, and what happens when the machine is far away.",
     "azure", ("algorithms", "concurrency", "networks")),

    ("meaning", "Signal, meaning, secrecy",
     "Turning a voltage into a number, a number into information, and "
     "information into something only one person can read.",
     "violet", ("signals", "information", "security")),

    ("parallel", "Parallel hardware",
     "The other processor in your machine, and the arithmetic that made it "
     "the one that matters.",
     "jade", ("gpu", "kernels")),

    ("world", "The world outside",
     "Computers that move things, and the physical floor none of them get "
     "under.",
     "slate", ("embodied", "limits")),
]

PARTS = [
    # (id, roman, title, one-line, research reports)
    # No accent here on purpose: it belongs to the phase, see PHASES.
    ("physics", "I", "Physics",
     "What a switch is, what it costs to flip, and why that cost ended the "
     "free lunch in 2005.",
     ["transistors-cmos-fabrication"]),

    ("logic", "II", "Logic",
     "One primitive, repeated, until it becomes a machine that runs a program "
     "you wrote.",
     ["nand2tetris-eater-scott"]),

    ("silicon", "III", "Silicon",
     "The same design in a language a synthesiser understands, and what a "
     "clock period actually buys you.",
     ["digital-design-hdl-fpga"]),

    ("theory", "IV", "Theory",
     "What a computer can compute at all, and the negative results that "
     "explain why your linter has false positives.",
     ["theory-of-computation"]),

    ("machine", "V", "The machine",
     "A real instruction set, a real stack, and the microarchitecture that "
     "decides whether your loop is fast.",
     ["x86-64-assembly", "cpu-architectures"]),

    ("numbers", "VI", "Numbers and text",
     "Two's complement, IEEE-754 and UTF-8. Everything else you write is "
     "written in one of them.",
     ["numbers-text-numerics"]),

    ("systems", "VII", "Systems",
     "C++ down to its object model, Linux down to its syscalls, and the ABI "
     "boundary between them.",
     ["cpp-linux-systems", "os-and-platforms"]),

    ("storage", "VIII", "Storage",
     "Where the bytes live when the power is off, and why the device's physics "
     "picks your data structure.",
     ["storage-filesystems-engines"]),

    ("tools", "IX", "Tools",
     "The compiler, the interpreter, the terminal, the build and the "
     "debugger: the machinery between you and the machine.",
     ["compilers-interpreters-terminals-unix", "build-systems-toolchains",
              "debugging-and-measurement", "testing-fuzzing-verification"]),

    ("algorithms", "X", "Algorithms",
     "Where Big-O lies, and the linear algebra that decides what a GPU is even "
     "for.",
     ["algorithms-on-real-hardware", "numerical-linear-algebra"]),

    ("concurrency", "XI", "Concurrency",
     "Memory models, lock-free structures, and a coroutine as a frame that "
     "outlives its call.",
     ["concurrency-theory-coroutines"]),

    ("networks", "XII", "Networks",
     "From an ethernet frame to a TLS handshake to 512 GPUs running an "
     "all-reduce.",
     ["networking-and-internet"]),

    ("signals", "XIII", "Signals",
     "The analog boundary, the FFT, and the filters that turn a noisy sensor "
     "into a number you can use.",
     ["signals-and-dsp"]),

    ("information", "XIV", "Information",
     "Entropy as a floor, compression as modelling, and error correction as "
     "the same maths run backwards.",
     ["information-theory-coding", "cryptography"]),

    ("security", "XV", "Security",
     "The proof that microarchitecture is real: you can read it with a timer.",
     ["hardware-security"]),

    ("gpu", "XVI", "Graphics and the GPU",
     "A rasteriser that got general enough to do arithmetic, and the execution "
     "model that fell out of it.",
     ["graphics-pipeline", "modal-gpu-glossary", "cuda-programming-tuning",
              "nvidia-architectures", "amd-and-other-accelerators"]),

    ("kernels", "XVII", "Kernels and AI",
     "Tiled GEMM to block-scaled FP4, and the systems arithmetic of training a "
     "model that does not fit on one chip.",
     ["fp4-fp8-blackwell", "numpy-pytorch-internals",
              "ai-systems-distributed-training"]),

    ("embodied", "XVIII", "Embodied",
     "A chip with no operating system, a control loop with a deadline, and a "
     "policy that moves matter.",
     ["embedded-and-sbc", "robotics-control-embodied-ai"]),

    ("limits", "XIX", "Limits",
     "The thermodynamic floor, the walls we are hitting, and what else a "
     "computer could be made of.",
     ["limits-of-computation"]),
]

# (slug, part, title, blurb, backend)
#
# backend is the DEFAULT for the unit's exercises; an individual exercise may
# override it with @backend. One of: sim, godbolt, yosys, modal.
TRACK = [
    # I -- Physics ---------------------------------------------------------
    ("switch", "physics", "The switch",
     "A transistor is a switch you close with a voltage instead of a finger, "
     "and it is not a perfect switch. Both halves matter.", "godbolt"),
    ("cmos-gate", "physics", "The gate is two switch networks",
     "Inversion is free and non-inversion costs a stage. That is why the next "
     "part starts at NAND rather than AND.", "godbolt"),
    ("power", "physics", "Every switch costs energy",
     "P = alpha C V^2 f, and around 2005 the V stopped falling. Everything "
     "after this unit is a consequence.", "godbolt"),
    ("fabrication", "physics", "Making the thing is the hard part",
     "Yield falls exponentially with die area, so a big chip is not merely "
     "expensive. It is impossible. Chiplets follow.", "godbolt"),

    # II -- Logic ----------------------------------------------------------
    ("nand", "logic", "One primitive, all of logic",
     "Functional completeness: every Boolean function is one repeated part, "
     "and there is no second kind of magic further up.", "sim"),
    ("selection", "logic", "Selection and addressing",
     "Control is data. A control signal is an ordinary input routed into "
     "selector logic, and that is also how memory gets addressed.", "sim"),
    ("arithmetic", "logic", "Arithmetic, and why subtraction is free",
     "One control bit inverting an operand turns the adder into a subtractor. "
     "The first time a representation choice buys hardware.", "sim"),
    ("feedback", "logic", "Feedback, and the bit that stays",
     "Memory is feedback plus a clock edge. No new parts, and the loop is legal "
     "here and illegal one unit ago for one reason.", "sim"),
    ("clock-bus", "logic", "The clock and the shared bus",
     "A clock cycle is a contract about when signals are allowed to be "
     "garbage. One wire can then serve every module.", "sim"),
    ("memory", "logic", "Addressable storage and the counter",
     "An address is a position, not a name. And since the counter defaults to "
     "+1, a jump is a parallel load rather than a special mechanism.", "sim"),
    ("encoding", "logic", "Instruction encoding",
     "An instruction is a bit pattern chosen so the wiring is cheap. The "
     "fields line up with the decoder you already built.", "sim"),
    ("control", "logic", "Control: the fetch-execute loop",
     "The instruction decoder is a lookup table. The least clever component in "
     "the machine, and the one that makes it a computer.", "sim"),

    # III -- Silicon -------------------------------------------------------
    ("structure", "silicon", "Structure, not sequence",
     "Your code is not executed, it is built. Everything exists at once, "
     "forever, and settles.", "yosys"),
    ("clock-edge", "silicon", "The clock edge",
     "There are exactly two kinds of logic, and almost every bug is a "
     "confusion between them. One character proves it.", "yosys"),
    ("proving", "silicon", "Proving it works",
     "Verification is the job, and for hardware you can sometimes actually "
     "prove it rather than test it.", "yosys"),
    ("timing", "silicon", "Timing, and the chip it runs on",
     "The longest combinational path sets your clock. Too slow is not slow, "
     "it is wrong.", "yosys"),

    # IV -- Theory ---------------------------------------------------------
    ("universal", "theory", "The universal machine",
     "Every model of computation anyone has proposed computes the same things "
     "and you built one two parts ago without being told.", "godbolt"),
    ("languages", "theory", "Formal languages, and the tools built on them",
     "A lexer is a finite automaton and a regex engine is a choice between two "
     "walks. One of them takes 251 million steps.", "godbolt"),
    ("computability", "theory", "What cannot be decided",
     "Rice's theorem, and why a perfect optimiser, a perfect analyser and a "
     "perfect virus scanner are all impossible.", "godbolt"),
    ("complexity", "theory", "Complexity as advice",
     "NP-hardness tells you which approach to take, not that you should give "
     "up. SAT solvers crush intractable instances daily.", "godbolt"),

    # V -- The machine -----------------------------------------------------
    ("registers", "machine", "Registers and the stack",
     "Sixteen names, one of which grows downward. The calling convention is a "
     "contract you can read in the assembly.", "godbolt"),
    ("addressing", "machine", "Addressing and flags",
     "Addressing modes, the flags register, and why lea is not a load.",
     "godbolt"),
    ("syscalls", "machine", "Syscalls",
     "The one interface Linux promises never to renumber, and the register "
     "contract that is not the C one.", "godbolt"),
    ("elf", "machine", "ELF, linking and loading",
     "What runs between execve and main, and who chose the address of the "
     "function you are about to call.", "godbolt"),
    ("cache", "machine", "The memory hierarchy",
     "Four cycles or three hundred, decided by an address you did not think "
     "about. You can read your own cache sizes out of a timing table.",
     "godbolt"),
    ("pipeline", "machine", "Pipelines, prediction and SIMD",
     "The processor is guessing, and it is right 95% of the time. The other 5% "
     "is where your performance went.", "godbolt"),
    ("atomics", "machine", "Atomics and ordering",
     "x86 gives you more than you asked for, ARM gives you exactly what you "
     "asked for, and that is why your code broke on the M1.", "godbolt"),

    # VI -- Numbers and text -----------------------------------------------
    ("integers", "numbers", "Integers and overflow",
     "Two's complement makes subtraction free. Signed overflow is undefined, "
     "and the optimiser will cash that promise.", "godbolt"),
    ("floats", "numbers", "IEEE-754",
     "Subnormals, NaN, and five rounding modes. Also: what -ffast-math "
     "actually discards.", "godbolt"),
    ("stability", "numbers", "Stability, and the bridge to low precision",
     "Why parallel reductions disagree, why Kahan is not a panacea, and why "
     "4-bit training needs stochastic rounding.", "godbolt"),
    ("text", "numbers", "Unicode and UTF-8",
     "Code points are not characters, characters are not glyphs, and UTF-8 is "
     "one of the best-designed formats in computing.", "godbolt"),

    # VII -- Systems -------------------------------------------------------
    ("object-model", "systems", "The C++ object model",
     "Where the bytes go, what a vptr is, and why declaration order governs "
     "the vtable.", "godbolt"),
    ("raii", "systems", "RAII and moves",
     "A destructor is a scheduled instruction. Moves are what let ownership be "
     "cheap.", "godbolt"),
    ("compile-time", "systems", "Compile time",
     "Templates, instantiation, and why your build is slow.", "godbolt"),
    ("processes", "systems", "Processes and file descriptors",
     "Everything is a file until it is not, and a thread is a process that "
     "shared too much.", "godbolt"),
    ("virtual-memory", "systems", "Virtual memory",
     "Memory is manufactured lazily in response to hardware faults. Allocation "
     "is nearly free; the faults are not.", "godbolt"),
    ("scheduling", "systems", "Threads and scheduling",
     "What the kernel thinks a thread is, and who decides which one runs.",
     "godbolt"),
    ("abi", "systems", "The ABI",
     "The C calling convention is not one thing. Two compilers, one diff, "
     "every time.", "godbolt"),
    ("linking", "systems", "Linking and interposition",
     "The target of a call is chosen at run time by a program you can lie to.",
     "godbolt"),

    # VIII -- Storage ------------------------------------------------------
    ("flash", "storage", "The device decides everything",
     "NAND is read in pages and erased in blocks. Every piece of storage "
     "software is a consequence of that asymmetry.", "godbolt"),
    ("nvme", "storage", "Getting to the device",
     "The interface must express as much parallelism as the medium contains, "
     "which is also how your GPU is attached.", "godbolt"),
    ("page-cache", "storage", "The kernel's memory of the disk",
     "Your reads and writes talk to RAM. Durability is the separate, expensive "
     "act of leaving it.", "godbolt"),
    ("filesystems", "storage", "Naming bytes",
     "A filesystem is a crash-consistency protocol that protects its own "
     "metadata, not your data.", "godbolt"),
    ("storage-engines", "storage", "Structures dictated by physics",
     "B-tree or LSM is not a taste question. The device's cost asymmetry picks "
     "it, and the wrong key order costs 250x.", "godbolt"),

    # IX -- Tools ----------------------------------------------------------
    ("terminal", "tools", "The terminal is a kernel object",
     "Not the program and not the window: a kernel state machine with settable "
     "flags. Every weird behaviour is that machine obeying.", "godbolt"),
    ("shell", "tools", "The shell forks, and the tradition follows",
     "Globbing, redirection and pipes all happen in the gap between fork and "
     "exec, before your command runs one instruction.", "godbolt"),
    ("parsing", "tools", "Source text to syntax tree",
     "A grammar describes syntax, but a real language's syntax depends on its "
     "own semantics. C++ is the proof.", "godbolt"),
    ("ssa", "tools", "SSA and the middle end",
     "One definition per value turns 'where did this come from' into a pointer "
     "dereference. That is what made optimisation tractable.", "godbolt"),
    ("codegen", "tools", "The back end and the linker",
     "An -O level does not change what your program means. It changes how much "
     "of what you told the compiler it is allowed to believe.", "godbolt"),
    ("interpreters", "tools", "Interpreters and JITs",
     "An interpreter trades ahead-of-time optimisation for knowing what "
     "actually happened. A JIT spends that knowledge.", "godbolt"),
    ("build", "tools", "The build graph",
     "Never under-build, never over-build. Timestamps cannot tell you which.",
     "godbolt"),
    ("debugger", "tools", "The debugger and the sanitizer",
     "A breakpoint is a patched byte. A sanitizer is a compiler pass that "
     "makes the bug loud instead of silent.", "godbolt"),
    ("measurement", "tools", "Measurement",
     "One timing number is not a measurement. Report a distribution, and know "
     "what coordinated omission hides.", "godbolt"),
    ("testing", "tools", "Properties, fuzzing and proof",
     "Stop writing examples. Generate them, shrink them, and let coverage "
     "drive the search.", "godbolt"),

    # X -- Algorithms ------------------------------------------------------
    ("cost-model", "algorithms", "Big-O and the machine it assumes",
     "The cost model counts operations. The machine charges for memory "
     "movement. That gap is 600x.", "godbolt"),
    ("layout", "algorithms", "Layout is the algorithm",
     "Same complexity, same operations, different arrangement, and the "
     "arrangement wins at every size that fits in a real machine.", "godbolt"),
    ("branches", "algorithms", "Control flow is the algorithm",
     "The branch predictor is part of your complexity model, and the compiler "
     "has already applied half the fixes.", "godbolt"),
    ("scan", "algorithms", "Work, depth and the scan",
     "Parallel algorithms rank on two axes, and scan converts irregular work "
     "into regular work. The GPU part reuses this directly.", "godbolt"),
    ("blas", "algorithms", "The BLAS levels",
     "Only level 3 can ever reach peak. That single ratio explains why every "
     "numerical algorithm is rewritten in terms of GEMM.", "godbolt"),
    ("gemm", "algorithms", "GEMM itself",
     "Five loops written against the memory hierarchy. The same shape returns "
     "as thread-block, warp and thread tiles.", "godbolt"),
    ("decompositions", "algorithms", "Decompositions and conditioning",
     "LU, QR, SVD, and why you never invert a matrix to solve a system.",
     "godbolt"),
    ("sparse", "algorithms", "Sparse and iterative",
     "Sparsity destroys arithmetic intensity, so SpMV runs at 2% of peak and "
     "that is correct rather than a bug.", "godbolt"),

    # XI -- Concurrency ----------------------------------------------------
    ("memory-model", "concurrency", "Memory models",
     "Sequential consistency is the ideal nobody provides. The litmus tests "
     "show you what your hardware actually promises.", "godbolt"),
    ("lock-free", "concurrency", "Lock-free and the reclamation problem",
     "CAS is the easy part. Knowing when it is safe to free is the hard part, "
     "and usually the mutex wins.", "godbolt"),
    ("parallel-theory", "concurrency", "Work, span and scaling",
     "Amdahl and Gustafson disagree only about whether the problem size is "
     "fixed.", "godbolt"),
    ("coroutines", "concurrency", "Coroutines",
     "A coroutine is a function whose stack frame outlives its invocation. "
     "Every other detail follows from that.", "godbolt"),

    # XII -- Networks ------------------------------------------------------
    ("frames", "networks", "Frames and the link layer",
     "A packet is a byte layout with a fixed grammar, and every protocol is a "
     "header you parse with a pointer and a shift.", "godbolt"),
    ("routing", "networks", "Addressing and routing",
     "A network is a lookup table. The internet is 75,000 of them kept "
     "consistent by a protocol that votes on price.", "godbolt"),
    ("tcp", "networks", "TCP as a control loop",
     "Two coupled feedback loops: one protecting the receiver with a number it "
     "is told, one protecting the network with a number it must infer.",
     "godbolt"),
    ("sockets", "networks", "The socket API and how servers scale",
     "Every I/O API is a position on one question: who waits, and how many "
     "things can wait at once.", "godbolt"),
    ("web", "networks", "DNS, HTTP and TLS",
     "Typing a URL costs six round trips. Every protocol revision of the last "
     "fifteen years deletes one from that list.", "godbolt"),
    ("collectives", "networks", "How 512 GPUs talk",
     "A collective costs bytes divided by the bandwidth of the slowest link it "
     "crosses. Understanding that is worth 61% to 98%.", "godbolt"),

    # XIII -- Signals ------------------------------------------------------
    ("sampling", "signals", "The analog boundary",
     "Aliasing is not noise, it is a different signal that is indistinguishable "
     "from yours. The filter must be analog and must come first.", "godbolt"),
    ("fourier", "signals", "Time and frequency",
     "The FFT is not just faster than the DFT, it is more accurate. Both are "
     "worth knowing why.", "godbolt"),
    ("filters", "signals", "Filters",
     "One pole, one line of code, and the most-used filter in embedded "
     "software. Also the complementary filter in disguise.", "godbolt"),

    # XIV -- Information ---------------------------------------------------
    ("entropy", "information", "Information has a measure",
     "Entropy is expected code length and a hard floor, but only for the "
     "model you assumed. Your training loss is this number.", "godbolt"),
    ("compression", "information", "Removing redundancy",
     "Every compressor is a model plus a coder. The coder is solved; all "
     "remaining progress is modelling.", "godbolt"),
    ("ecc", "information", "Adding redundancy back",
     "Redundancy in the right algebraic shape reconstructs the original, and "
     "the guarantee is a theorem about an error model.", "godbolt"),
    ("symmetric", "information", "Symmetric cryptography",
     "The cipher is not the system. Modes are taught by their failure modes "
     "because that is how they are chosen.", "godbolt"),
    ("asymmetric", "information", "Asymmetric cryptography",
     "Uniqueness is load-bearing. Reuse a nonce and the maths hands over your "
     "key.", "godbolt"),
    ("crypto-hardware", "information", "Crypto and the hardware",
     "One of the few workloads where the correct implementation is "
     "deliberately slower than the fastest one.", "godbolt"),

    # XV -- Security -------------------------------------------------------
    ("cache-channel", "security", "The cache is real and you can see it",
     "Microarchitectural state is observable as timing, and it is not rolled "
     "back. A histogram proves it.", "godbolt"),
    ("speculation", "security", "Speculation leaks what it touches",
     "The architecture rolls back what you computed, not what you touched.",
     "godbolt"),
    ("mitigations", "security", "Every mitigation is a fossil",
     "Read the list backwards and it is a history of the field. Overwriting a "
     "return address teaches the calling convention.", "godbolt"),
    ("constant-time", "security", "Constant time as a discipline",
     "If the time or the access pattern depends on a secret, it leaks. The "
     "compiler does not know that.", "godbolt"),

    # XVI -- Graphics and the GPU ------------------------------------------
    ("frame-budget", "gpu", "Why a screen is an arithmetic problem",
     "Huge, deadlined and independent. A 16-core CPU has 80 cycles per pixel "
     "for everything.", "godbolt"),
    ("rasteriser", "gpu", "How a triangle becomes pixels",
     "Three linear edge functions on a grid, evaluated in 2x2 blocks, and "
     "that block is where the warp comes from.", "godbolt"),
    ("sm-shape", "gpu", "Why the SM is shaped like that",
     "Every structural feature was built to render triangles. CUDA added "
     "scatter, pointers, a scratchpad, and permission to stop pretending.",
     "godbolt"),
    ("throughput", "gpu", "The throughput machine",
     "A GPU does not make any instruction stream fast. It makes stalling free.",
     "modal"),
    ("execution-model", "gpu", "The execution model",
     "The warp is the unit of execution and the block is the unit of "
     "cooperation. Neither is the thread.", "modal"),
    ("gpu-memory", "gpu", "The memory hierarchy",
     "DRAM latency is about 100x shared memory, and local memory is DRAM "
     "wearing a disguise.", "modal"),
    ("coalescing", "gpu", "Coalescing",
     "A ratio, not a rule: maximise bytes used over bytes transferred. The "
     "compiler cannot see this and the profiler must.", "modal"),
    ("shared-memory", "gpu", "Shared memory and banks",
     "It decouples the access pattern you want from the one DRAM rewards, and "
     "has its own 32-way striping rule you must not violate instead.", "modal"),
    ("occupancy", "gpu", "The resource budget",
     "Occupancy is a budget outcome, not a goal. You compute it; you do not "
     "chase it.", "modal"),
    ("latency-hiding", "gpu", "Latency hiding",
     "Latency is hidden by having something else to issue, which is exactly "
     "why 100% occupancy is not the target.", "modal"),
    ("roofline", "gpu", "Roofline and the three limiters",
     "Memory, compute or latency. Speed of Light tells you which in two "
     "numbers, before you guess.", "modal"),

    # XVII -- Kernels and AI -----------------------------------------------
    ("strides", "kernels", "Strides and the dispatcher",
     "A transpose is free because a stride is a lie you tell about memory. One "
     "aten call routes on device, layout, autograd and autocast.", "godbolt"),
    ("autograd", "kernels", "Autograd",
     "The tape is built during the forward pass. backward() is a topological "
     "traversal of a graph you did not know you were making.", "godbolt"),
    ("tiled-gemm", "kernels", "Naive to tiled GEMM",
     "The same five loops from the algorithms part, now as thread-block, warp "
     "and thread tiles.", "modal"),
    ("cute", "kernels", "CuTe layouts",
     "Layout algebra turns index arithmetic back into algebra, and a "
     "swizzle into a composition.", "modal"),
    ("formats", "kernels", "The number formats",
     "E4M3, E5M2, E2M1. Sixteen values, and the whole dynamic range is 3.58 "
     "binades.", "modal"),
    ("block-scaling", "kernels", "Block scaling",
     "Shrink the scale's scope until the outliers stop poisoning the block. "
     "Two levels, because the first one's format is narrow.", "modal"),
    ("stochastic-rounding", "kernels", "Rounding and Hadamard",
     "Round-to-nearest stagnates at 0.5 where stochastic rounding reaches "
     "101.0. Two orthogonal fixes for two different problems.", "modal"),
    ("transformer-arithmetic", "kernels", "Transformer arithmetic",
     "A config file is a complete performance model. Params, FLOPs, bytes and "
     "step time all follow from eight numbers.", "godbolt"),
    ("flash-attention", "kernels", "Online softmax and FlashAttention",
     "Reformulating a global reduction as a streaming one lets you compute an "
     "NxN matrix without ever storing it. It is exact.", "modal"),
    ("inference", "kernels", "Inference is two machines",
     "Prefill is compute-bound and decode is memory-bound. Batch-1 decode "
     "wastes 99.66% of an H100 regardless of model size.", "modal"),
    ("parallelism", "kernels", "The parallelism taxonomy",
     "Each dimension buys a specific memory saving with a specific collective. "
     "Map the worst collective to the fastest wire.", "modal"),
    ("training-run", "kernels", "What actually breaks at scale",
     "466 interruptions in 54 days on 16,384 GPUs, and six of them were silent "
     "data corruption.", "modal"),

    # XVIII -- Embodied ----------------------------------------------------
    ("no-os", "embodied", "The chip with no operating system",
     "Your main() is the system. There is no boot, no scheduler and no one to "
     "catch you.", "godbolt"),
    ("abstraction-cost", "embodied", "The abstraction has a cost",
     "digitalWrite and PORTB do the same thing, and one costs 26x more. The "
     "optimiser provably cannot fix it.", "godbolt"),
    ("volatile", "embodied", "Time, interrupts and volatile",
     "The compiler may delete code you need, because it cannot see the "
     "hardware or the interrupt. And volatile is not atomic.", "godbolt"),
    ("cortex-m", "embodied", "Wider machines",
     "The same C on a machine with enough registers produces different code "
     "and different problems.", "godbolt"),
    ("determinism", "embodied", "Where determinism goes to die",
     "An OS buys abstraction and sells determinism. Knowing which side you are "
     "on is the architectural decision.", "godbolt"),
    ("actuators", "embodied", "Actuators and FOC",
     "A PI controller cannot track a sinusoid with zero error. That sentence "
     "is why field-oriented control exists.", "godbolt"),
    ("control-loops", "embodied", "Control loops",
     "PID properly, then cascade, and why the loop rates differ by four "
     "orders of magnitude.", "godbolt"),
    ("estimation", "embodied", "Estimation",
     "The Kalman filter is inverse-variance weighting. The off-diagonals are "
     "the punchline.", "godbolt"),
    ("kinematics", "embodied", "Kinematics",
     "Gimbal lock is a Jacobian going to zero, and you can watch it happen to "
     "six significant figures.", "godbolt"),
    ("planning", "embodied", "Planning",
     "Configuration space, sampling, and why a correct planner over a silently "
     "wrong domain is the bug you will actually write.", "godbolt"),
    ("policies", "embodied", "Physical intelligence",
     "The System 1 / System 2 split in modern robot policies is cascade "
     "control, rediscovered.", "modal"),

    # XIX -- Limits --------------------------------------------------------
    ("landauer", "limits", "The thermodynamic floor",
     "Erasing a bit costs kT ln 2. A 3 nm gate sits four orders of magnitude "
     "above it, and a 1990s gate sat eight.", "godbolt"),
    ("walls", "limits", "The walls we are hitting",
     "Moving a 64-bit word 10 mm costs 82 pJ and the arithmetic on it costs a "
     "few. Measure work in bytes moved.", "godbolt"),
    ("alternatives", "limits", "What else a computer could be",
     "Quantum speedup is interference cancelling wrong answers, not trying "
     "everything at once. A 3-qubit circuit is an 8x8 matrix.", "godbolt"),
]

BACKENDS = ("sim", "godbolt", "yosys", "modal")

ACCENTS = ["gold", "copper", "clay", "azure", "violet", "jade", "slate"]

PART_BY_ID = {p[0]: p for p in PARTS}

# Derived, never written twice. A part's colour is its phase's colour.
PHASE_OF = {pid: ph[0] for ph in PHASES for pid in ph[4]}
ACCENT_OF = {pid: ph[3] for ph in PHASES for pid in ph[4]}


def accent_of(part_id):
    """The accent a part inherits from its phase."""
    return ACCENT_OF[part_id]


def validate():
    """Fail loudly on a malformed track. Called by build.py before anything."""
    import prose

    problems = []
    seen = set()
    for slug, part, title, blurb, backend in TRACK:
        if slug in seen:
            problems.append(f"duplicate slug in TRACK: {slug}")
        seen.add(slug)
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug):
            problems.append(f"unit {slug!r} is not a clean kebab-case slug")
        if part not in PART_BY_ID:
            problems.append(f"unit {slug!r} names unknown part {part!r}")
        if backend not in BACKENDS:
            problems.append(f"unit {slug!r} names unknown backend {backend!r}")
        problems += prose.check_blurb(blurb, f"unit {slug}")
        problems += prose.check_title(title, f"unit {slug} title")

    part_ids = set()
    for pid, roman, title, blurb, reports in PARTS:
        if pid in part_ids:
            problems.append(f"duplicate part id: {pid}")
        part_ids.add(pid)
        if not reports:
            problems.append(f"part {pid!r} cites no research report")
        problems += prose.check_blurb(blurb, f"part {pid}")

    for pid in part_ids:
        if not any(u[1] == pid for u in TRACK):
            problems.append(f"part {pid!r} has no units")

    # Every part belongs to exactly one phase, and the phases cover the track
    # in its own order. Without this the two lists drift apart silently and a
    # part loses its colour.
    phase_ids, claimed = set(), []
    for phid, ptitle, pblurb, accent, members in PHASES:
        if phid in phase_ids:
            problems.append(f"duplicate phase id: {phid}")
        phase_ids.add(phid)
        if accent not in ACCENTS:
            problems.append(f"phase {phid!r} names unknown accent {accent!r}")
        problems += prose.check_blurb(pblurb, f"phase {phid}")
        problems += prose.check_title(ptitle, f"phase {phid} title")
        for pid in members:
            if pid not in part_ids:
                problems.append(f"phase {phid!r} names unknown part {pid!r}")
            elif pid in claimed:
                problems.append(f"part {pid!r} is in more than one phase")
            claimed.append(pid)

    for pid in part_ids:
        if pid not in claimed:
            problems.append(f"part {pid!r} belongs to no phase, so it has no "
                            f"accent")

    order = [p[0] for p in PARTS]
    if [c for c in claimed if c in part_ids] != order:
        problems.append("the phases do not list the parts in track order, so "
                        "the two-level index would disagree with the spine")

    if len({ph[3] for ph in PHASES}) != len(PHASES):
        problems.append("two phases share an accent, which defeats the point "
                        "of tying colour to phase")

    if problems:
        raise ValueError(
            f"{len(problems)} problem(s) in the track:\n  "
            + "\n  ".join(problems))
    return True


if __name__ == "__main__":
    validate()
    by_part = {}
    for slug, part, *_ in TRACK:
        by_part.setdefault(part, []).append(slug)
    print(f"{len(PARTS)} parts, {len(TRACK)} units written so far\n")
    for phid, ptitle, pblurb, accent, members in PHASES:
        print(f"\n  {ptitle}  [{accent}]")
        for pid in members:
            _, roman, title, *_ = PART_BY_ID[pid]
            n = len(by_part.get(pid, []))
            mark = f"{n} units" if n else "-- not yet enumerated"
            print(f"    {roman:<5} {title:<24} {mark}")
