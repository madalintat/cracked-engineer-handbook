# C++ and Linux Systems Programming, Deeply

Research notes for a curriculum aimed at a strong SWE who wants to understand what actually
happens underneath their code.

Sources verified:
- **TLPI** — Kerrisk, *The Linux Programming Interface*, No Starch 2010, 1552pp.
  Chapter list taken from the author's own site (`man7.org/tlpi/toc-short.html`) and
  cross-checked against the archive.org item `The_Linux_Programming_Interface`
  (metadata + full-text `inside.php` endpoint + `_djvu.txt` brief contents, which supplied
  the page numbers below).
- **TC++PL4** — Stroustrup, *The C++ Programming Language*, 4th ed., Addison-Wesley 2013,
  ISBN 978-0-321-56384-2, 1368pp. Part/chapter structure and per-chapter section lists
  extracted from the PDF front matter and chapter-opener pages.
- Machine-level claims below were **executed against the live Compiler Explorer API**
  (x86-64 gcc 15.2, clang 21.1.0, ARM64 gcc trunk) — every assembly listing in this
  document is real output, not recalled.

---

## 1. TLPI — full chapter list, and the 12 that matter

### 1.1 All 64 chapters (with book page numbers)

| # | Chapter | p. |
|---|---|---|
| 1 | History and Standards | 1 |
| 2 | Fundamental Concepts | 21 |
| 3 | System Programming Concepts | 43 |
| 4 | File I/O: The Universal I/O Model | 69 |
| 5 | File I/O: Further Details | 89 |
| 6 | Processes | 113 |
| 7 | Memory Allocation | 139 |
| 8 | Users and Groups | 153 |
| 9 | Process Credentials | 167 |
| 10 | Time | 185 |
| 11 | System Limits and Options | 211 |
| 12 | System and Process Information | 223 |
| 13 | File I/O Buffering | 233 |
| 14 | File Systems | 251 |
| 15 | File Attributes | 279 |
| 16 | Extended Attributes | 311 |
| 17 | Access Control Lists | 319 |
| 18 | Directories and Links | 339 |
| 19 | Monitoring File Events (inotify) | 375 |
| 20 | Signals: Fundamental Concepts | 387 |
| 21 | Signals: Signal Handlers | 421 |
| 22 | Signals: Advanced Features | 447 |
| 23 | Timers and Sleeping | 479 |
| 24 | Process Creation | 513 |
| 25 | Process Termination | 531 |
| 26 | Monitoring Child Processes | 541 |
| 27 | Program Execution | 563 |
| 28 | Process Creation and Program Execution in More Detail | 591 |
| 29 | Threads: Introduction | 617 |
| 30 | Threads: Thread Synchronization | 631 |
| 31 | Threads: Thread Safety and Per-Thread Storage | 655 |
| 32 | Threads: Thread Cancellation | 671 |
| 33 | Threads: Further Details | 681 |
| 34 | Process Groups, Sessions, and Job Control | 699 |
| 35 | Process Priorities and Scheduling | 733 |
| 36 | Process Resources | 753 |
| 37 | Daemons | 767 |
| 38 | Writing Secure Privileged Programs | 783 |
| 39 | Capabilities | 797 |
| 40 | Login Accounting | 817 |
| 41 | Fundamentals of Shared Libraries | 833 |
| 42 | Advanced Features of Shared Libraries | 859 |
| 43 | Interprocess Communication Overview | 877 |
| 44 | Pipes and FIFOs | 889 |
| 45 | Introduction to System V IPC | 921 |
| 46 | System V Message Queues | 937 |
| 47 | System V Semaphores | 965 |
| 48 | System V Shared Memory | 997 |
| 49 | Memory Mappings | 1017 |
| 50 | Virtual Memory Operations | 1045 |
| 51 | Introduction to POSIX IPC | 1057 |
| 52 | POSIX Message Queues | 1063 |
| 53 | POSIX Semaphores | 1089 |
| 54 | POSIX Shared Memory | 1107 |
| 55 | File Locking | 1117 |
| 56 | Sockets: Introduction | 1149 |
| 57 | Sockets: UNIX Domain | 1165 |
| 58 | Sockets: Fundamentals of TCP/IP Networks | 1179 |
| 59 | Sockets: Internet Domains | 1197 |
| 60 | Sockets: Server Design | 1239 |
| 61 | Sockets: Advanced Topics | 1253 |
| 62 | Terminals | 1289 |
| 63 | Alternative I/O Models | 1325 |
| 64 | Pseudoterminals | 1375 |
| A | Tracing System Calls | 1401 |
| B | Parsing Command-Line Options | 1405 |
| C | Casting the NULL Pointer | 1413 |
| D | Kernel Configuration | 1417 |
| E | Further Sources of Information | — |
| F | Solutions to Selected Exercises | — |

### 1.2 The 12 that matter for "understand what my program is really doing"

The selection filter is deliberately **not** "what a systems programmer needs". A portable
systems-software curriculum would spend heavily on chapters 8, 9, 38, 39 (credentials,
privilege, capabilities), 14–18 (filesystem semantics), 55 (locking), 56–61 (sockets) and
45–54 (the IPC zoo). None of those explain what an existing application program is doing;
they are the API surface you write *against*. The chapters below are the ones that explain
what the **process** is — its memory, its scheduling, its dynamic linking, its threads —
because those are the things a C++ program is made of whether or not the programmer ever
calls a syscall by name.

| Pick | TLPI ch. | Why it's in |
|---|---|---|
| 1 | **3 — System Programming Concepts** | The entry point to the whole mental model: what a system call *is* mechanically (the trap, `errno`, the wrapper in glibc), why libc functions are not syscalls, and the fact that a "function call" in your code may be either. Everything else is unreadable without this. |
| 2 | **6 — Processes** | The process memory layout: text / initialized data / BSS / heap / stack / the mmap region, plus `environ`, `argv`, and the fact that the stack grows by page fault. This is the map onto which every C++ storage duration is drawn. |
| 3 | **7 — Memory Allocation** | `brk`/`sbrk` vs `mmap`, and how `malloc`/`free` are built on them. This is the chapter that makes `new` stop being magic. §7.1.4 (how free lists work) directly explains why freeing memory doesn't return it to the OS. |
| 4 | **49 — Memory Mappings** | `mmap`, `MAP_PRIVATE` vs `MAP_SHARED`, file-backed vs anonymous, copy-on-write. Explains the *other* half of allocation (large `new`, thread stacks, shared libraries, `fork`), and why "memory used" is an ambiguous question. |
| 5 | **50 — Virtual Memory Operations** | `mprotect`, `mlock`, `madvise`, and the residency model. Short chapter, huge payoff: this is where segfault stops being an error message and becomes a page-permission fault you can predict. Pairs with `/proc/PID/maps`. |
| 6 | **24 — Process Creation** | `fork()` and copy-on-write. The single best demonstration that address spaces are virtual and lazily materialised. Also the prerequisite for reasoning about `fork` in a C++ program that has heap state or threads. |
| 7 | **27 — Program Execution** | `execve`, and what a fresh process image is. Together with 24 this is "what happens between the shell and `main`", which is the gap most application programmers have never looked into. |
| 8 | **41 — Fundamentals of Shared Libraries** | ELF, `ld.so`, `LD_LIBRARY_PATH`, `SONAME`, symbol resolution. This is where "why did it link but not run" and "which `libstdc++` am I actually getting" are answered. |
| 9 | **42 — Advanced Features of Shared Libraries** | Lazy binding via PLT/GOT, `dlopen`, symbol visibility, versioning, `LD_PRELOAD`. The PLT/GOT indirect jump is *structurally the same trick as a vtable*, which makes this the natural pair with the C++ half. |
| 10 | **29 — Threads: Introduction** | POSIX threads, the shared-address-space model, and what a thread owns vs shares (stack and TLS vs heap and fds). `std::thread` is a thin wrapper over exactly this. |
| 11 | **30 — Threads: Thread Synchronization** | Mutexes and condition variables as they actually exist — and, critically, the futex model where the uncontended case never enters the kernel. This is the chapter that explains why `std::mutex` is cheap and why contention is a cliff, not a slope. |
| 12 | **12 — System and Process Information** (`/proc`) + **App. A — Tracing System Calls** (`strace`) | Counted as one unit because they are the same skill: *observing* a live process. `/proc/PID/{maps,status,smaps,stat}` and `strace`/`ltrace` turn every claim in the other eleven chapters into something you can check in ten seconds. Without this the curriculum is theory. |

**Honourable mentions deliberately cut.** Ch. 13 (File I/O Buffering) is excellent and does
belong in the final unit as reading, because the stdio-buffer-vs-`write()` story is the
cleanest demonstration that a library call and a syscall are different animals — but it is
narrower than the twelve above. Ch. 63 (Alternative I/O Models: `select`/`poll`/`epoll`) is
essential if the goal is writing servers and irrelevant if the goal is understanding your own
program. Ch. 25/26 (termination, `wait`) and Ch. 20–22 (signals) are the next tier: signals
in particular matter the moment you want to know what actually happened at a `SIGSEGV`, and
Ch. 20 is a fine bonus attached to Unit 2.

---

## 2. Stroustrup 4th ed. — part/chapter structure, and what's load-bearing

### 2.1 The four parts

| Part | Chapters | Pages |
|---|---|---|
| **I — Introductory Material** | 1 Notes to the Reader; 2 A Tour of C++: The Basics; 3 A Tour: Abstraction Mechanisms; 4 A Tour: Containers and Algorithms; 5 A Tour: Concurrency and Utilities | 3–132 |
| **II — Basic Facilities** | 6 Types and Declarations; 7 Pointers, Arrays, and References; 8 Structures, Unions, and Enumerations; 9 Statements; 10 Expressions; 11 Select Operations; 12 Functions; 13 Exception Handling; 14 Namespaces; 15 Source Files and Programs | 133–446 |
| **III — Abstraction Mechanisms** | 16 Classes; 17 Construction, Cleanup, Copy, and Move; 18 Overloading; 19 Special Operators; 20 Derived Classes; 21 Class Hierarchies; 22 Run-Time Type Information; 23 Templates; 24 Generic Programming; 25 Specialization; 26 Instantiation; 27 Templates and Hierarchies; 28 Metaprogramming; 29 A Matrix Design | 447–856 |
| **IV — The Standard Library** | 30 Standard Library Summary; 31 STL Containers; 32 STL Algorithms; 33 STL Iterators; 34 Memory and Resources; 35 Utilities; 36 Strings; 37 Regular Expressions; 38 I/O Streams; 39 Locales; 40 Numerics; 41 Concurrency; 42 Threads and Tasks; 43 The C Standard Library; 44 Compatibility | 857–1280 |

Note the book's own shape: Part I is a tour to be skimmed, Part II is the C-inherited
substrate, Part III is where the abstraction machinery lives, and Part IV is reference
material — **except** for chapters 34, 41 and 42, which are the ones that describe the
machine. That asymmetry drives the selection below.

### 2.2 The chapters that teach the machine underneath C++

With their actual section lists, since the sub-structure is what determines what to assign.

**Ch. 6 — Types and Declarations** (135)
Sections: The ISO C++ Standard · Types (Fundamental Types; Booleans; Character Types; Integer
Types; Floating-Point Types; Prefixes and Suffixes; void; **Sizes; Alignment**) · Declarations
(Structure of Declarations; Names; **Scope**; Initialization; auto and decltype) · **Objects and
Values (Lvalues and Rvalues; Lifetimes of Objects)** · Type Aliases.
→ §6.2.8 Sizes and §6.2.9 Alignment are the two sections that make `sizeof` a layout fact
rather than a language fact. §6.4.2 Lifetimes of Objects is the definition of storage duration
that Unit 2 maps onto the address space.

**Ch. 7 — Pointers, Arrays, and References** (171)
Sections: Pointers (void*; nullptr) · Arrays (Array Initializers; String Literals) · Pointers
into Arrays (Navigating Arrays; Multidimensional Arrays; Passing Arrays) · Pointers and const ·
**Pointers and Ownership** · **References (Lvalue References; Rvalue References; References to
References; Pointers and References)**.
→ §7.7.2 Rvalue References is the language-level half of move semantics; §7.5 Pointers and
Ownership is the language-level half of RAII. §7.7.4 makes the crucial point that a reference
*is* an address at runtime.

**Ch. 8 — Structures, Unions, and Enumerations** (201)
Sections: Structures (**struct Layout**; struct Names; Structures and Classes; Structures and
Arrays; Type Equivalence; **Plain Old Data**; **Fields**) · Unions · Enumerations.
→ §8.2.1 struct Layout and §8.2.6 POD are *the* object-layout sections in the book. §8.2.7
(bit-fields) and §8.3 (unions) are where the byte-level view becomes unavoidable.

> **Assign §8.2.6 with a correction.** The book is C++11-era and teaches **POD** as the central
> category. POD was **deprecated in C++20** by
> [P0767R1](https://wg21.link/P0767R1), along with `std::is_pod`. The modern decomposition is
> two independent properties — `is_standard_layout` (fixed member offsets, `offsetof` valid,
> first-member `reinterpret_cast` valid) and `is_trivially_copyable` (`memcpy`-able) — and POD
> was just their conjunction. Teach the two separately; they fail for different reasons, which
> is exactly what the deprecation was for. Related: C++20 added *implicit-lifetime types*
> (P0593R6), the category that finally makes `malloc` + `reinterpret_cast` well-defined.
> Two standard-layout rules that surprise people and make good exercises: **all non-static data
> members must have the same access control**, and **only one class in the hierarchy may have
> data members**.

**Ch. 11 — Select Operations** (273)
Sections: Etc. Operators · **Free Store (Memory Management; Arrays; Getting Memory Space;
Overloading new)** · Lists (Implementation Model) · **Lambda Expressions (Implementation
Model; Capture; Call and Return; The Type of a Lambda)** · Explicit Type Conversion.
→ §11.2 is the `new`/`delete`/`operator new` chapter, i.e. the direct hand-off to TLPI ch. 7.
§11.4.1 "Implementation Model" for lambdas is the section that says a lambda is a class with
an `operator()` — which is checkable in assembly.

**Ch. 13 — Exception Handling** (343)
Sections: Error Handling (Exceptions; **Exceptions and Efficiency**) · Exception Guarantees ·
**Resource Management (Finally)** · Enforcing Invariants · Throwing and Catching Exceptions ·
A vector Implementation (**Representing Memory Explicitly**; Assignment; Changing Size).
→ §13.3 is the RAII chapter. §13.1.7 Exceptions and Efficiency is the "zero-cost" claim that
Unit 3's exercise falsifies-or-confirms in the emitted assembly.

**Ch. 16 — Classes** (449) and **Ch. 17 — Construction, Cleanup, Copy, and Move** (481)
Ch. 17 sections: Constructors and Destructors (**Destructors and Resources**; Base and Member
Destructors; Calling Constructors and Destructors; **virtual Destructors**) · Class Object
Initialization · Member and Base Initialization · **Copy and Move (Copy; Move)** ·
**Generating Default Operations (Explicit Defaults; Default Operations; deleted Functions)**.
→ Ch. 17 is the single most important chapter in the book for this curriculum. §17.5 Copy and
Move and §17.6 Generating Default Operations (the rule of zero / rule of five, `=delete`) are
the whole of Unit 3.

**Ch. 20 — Derived Classes** (577)
Sections: Derived Classes (Member Functions; Constructors and Destructors) · Class Hierarchies
(Type Fields; **Virtual Functions**; Explicit Qualification; **Override Control**; using Base
Members; Return Type Relaxation) · Abstract Classes · Access Control · **Pointers to Members** ·
→ §20.3.2 Virtual Functions is where Stroustrup describes the vtbl. §20.6 pointers to members
are the one C++ construct whose *representation* is genuinely surprising (a pointer-to-member-
function is not a pointer).

**Ch. 21 — Class Hierarchies** (613)
Sections: Design of Class Hierarchies · **Multiple Inheritance (Multiple Interfaces; Multiple
Implementation Classes; Ambiguity Resolution; Repeated Use of a Base Class; Virtual Base
Classes; Replicated vs. Virtual Bases)**.
→ §21.3 is the only place the book confronts multiple vptrs, `this`-adjustment and virtual
bases. Read for layout, skim the design advice.

**Ch. 22 — Run-Time Type Information** (641)
Sections: Class Hierarchy Navigation (**dynamic_cast**; Multiple Inheritance; static_cast and
dynamic_cast; Recovering an Interface) · Double Dispatch and Visitors · **Construction and
Destruction** · **Type Identification** · Uses and Misuses of RTTI.
→ §22.4 Construction and Destruction (why virtual calls in constructors dispatch to the base)
is the sharpest evidence that the vptr is a *mutable data member*, not a static property.

**Ch. 23 Templates** (665), **25 Specialization** (721), **26 Instantiation** (741),
**28 Metaprogramming** (779)
Ch. 23 sections include **Template Instantiation**, **Type Checking (Type Equivalence; Error
Detection)**, **Source Code Organization (Linkage)**.
→ §23.2.2 Instantiation and §23.7 Linkage are the code-generation story (one symbol per
instantiation, vague linkage, COMDAT). Ch. 26 is entirely about instantiation and name
binding. Ch. 28 is optional for this curriculum — read §28.1–28.4 for the "templates are
compile-time program generators" framing and skip the SI-units example.

**Ch. 34 — Memory and Resources** (973)
Sections: "Almost Containers" (array; bitset; vector<bool>; Tuples) · **Resource Management
Pointers (unique_ptr; shared_ptr; weak_ptr)** · **Allocators (The Default Allocator; Allocator
Traits; Pointer Traits; Scoped Allocators)** · The Garbage Collection Interface ·
**Uninitialized Memory (Temporary Buffers; raw_storage_iterator)**.
→ §34.3 is where RAII becomes library machinery. §34.4 Allocators is the seam between C++ and
`malloc`. §34.6 Uninitialized Memory is where "storage" and "object" finally come apart.

**Ch. 41 — Concurrency** (1191)
Sections: **Memory Model (Memory Location; Instruction Reordering; Memory Order; Data Races)** ·
**Atomics (atomic Types; Flags and Fences)** · **volatile**.
→ This is the whole memory-model unit, in ~18 pages. §41.2.1 "Memory Location" (the definition
that makes adjacent bit-fields a data race but adjacent `char`s not) and §41.2.2 Instruction
Reordering are the two ideas. §41.4 volatile exists mainly to tell you it is *not* an atomic.

**Ch. 42 — Threads and Tasks** (1209)
Sections: **Threads (Identity; Construction; Destruction; join(); detach(); this_thread;
Killing a thread; thread_local Data)** · **Avoiding Data Races (Mutexes; Multiple Locks;
call_once(); Condition Variables)** · Task-Based Concurrency (future/promise; packaged_task;
async()).
→ §42.2 is a direct 1:1 mapping onto TLPI ch. 29–30. §42.2.3 Destruction (a joinable
`std::thread` destructor calls `terminate()`) is a lifetime lesson, not a concurrency one.

**Ch. 15 — Source Files and Programs** (419) — the sleeper pick.
Sections: Separate Compilation · **Linkage (File-Local Names; Header Files; The One-Definition
Rule; Linkage to Non-C++ Code; Linkage and Pointers to Functions)** · Using Header Files ·
**Programs (Initialization of Nonlocal Variables; Initialization and Concurrency; Program
Termination)**.
→ §15.2 ODR + §15.4.1 static initialization order are the C++-side language for what TLPI
41/42 describe from the ELF side. Assign it *with* TLPI 41, not on its own.

**Explicitly out of scope:** 9 Statements, 10 Expressions, 12 Functions, 14 Namespaces,
18 Overloading, 19 Special Operators, 24 Generic Programming, 27 Templates and Hierarchies,
29 A Matrix Design, 30–33 STL reference, 35–37, 39 Locales, 40 Numerics, 43, 44. Chapter 38
(I/O Streams) gets a cameo in Unit 7 only, for the buffering story.

---

## 3. Seven merged units, dependency-ordered

Each unit names one **concept**, its **prerequisites**, the **one idea** it exists to install,
and the reading from both books.

---

### Unit 1 — What an object *is*: bytes at an address

**Concept.** A C++ object is a typed span of storage at an address. Its size, alignment,
padding and member offsets are decided by an ABI (the Itanium C++ ABI on Linux), not by the
C++ standard, and they are directly observable.

**Reading.** TC++PL4 §6.2.8–6.2.9 (Sizes, Alignment), §6.4 (Objects and Values), ch. 7
(Pointers, Arrays, References), ch. 8 (struct Layout, POD, Fields, Unions) ·
TLPI ch. 3 (System Programming Concepts).

**Prerequisites.** None. This is the floor.

**The one idea.**
> `sizeof` is a *layout* decision, not a *type* decision. Reordering three members can change
> the size of a struct, and nothing in the source code says so — you have to look.

**Why first.** Every later unit is a statement about bytes: the heap is bytes the kernel
lent you, a vtable is bytes at offset 0, a move is bytes copied instead of bytes allocated,
false sharing is two objects landing in the same 64 bytes. If "object = span of bytes" is not
reflexive, none of it lands.

---

### Unit 2 — Where the bytes live: the address space and the two-level lie

**Concept.** Storage duration (automatic / static / dynamic / thread) maps onto regions of a
Linux process address space. `new` is not a kernel operation: it is `operator new` →
`malloc` → *sometimes* `brk` or `mmap`. And even the kernel's answer is a promise, not a
page — memory is materialised on first touch.

**Reading.** TC++PL4 §11.2 (Free Store: Memory Management, Arrays, Getting Memory Space,
Overloading new), ch. 34 §34.3–34.4, §34.6 (Uninitialized Memory) ·
TLPI ch. 6 (Processes / memory layout), ch. 7 (Memory Allocation), ch. 49 (Memory Mappings),
ch. 50 (Virtual Memory Operations).

**Prerequisites.** Unit 1.

**The one idea.**
> Allocation is a two-level lie. `malloc` hands you memory it already owns and usually did not
> ask the kernel for; the kernel hands out address space it has not backed with physical pages.
> `free` usually returns nothing to the OS, and a fresh 1 GiB allocation costs almost nothing
> until you write to it.

**Why here.** It's the first unit that requires both books at once, and it is where the
biggest single misconception (`new` = "ask the OS for memory") dies.

---

### Unit 3 — Lifetime: RAII, destructors, exceptions, and move

**Concept.** The compiler inserts destructor calls at every scope exit including the
exception path, and the exception path lives in a *table*, not in the instruction stream.
Move semantics is the language admitting that copying bytes is sometimes better expressed as
transferring ownership of an allocation.

**Reading.** TC++PL4 ch. 13 (esp. §13.1.7 Exceptions and Efficiency, §13.3 Resource
Management, §13.6 A vector Implementation), ch. 16, ch. 17 (all of it — §17.2 Constructors and
Destructors, §17.5 Copy and Move, §17.6 Generating Default Operations), §7.7.2 (Rvalue
References), §34.3 (unique_ptr / shared_ptr) ·
TLPI ch. 25 (Process Termination — `exit` vs `_exit`, `atexit` handlers), ch. 24 (fork:
the one case where C++ lifetime and OS lifetime disagree).

**Prerequisites.** Units 1–2 (you cannot explain what a move *saves* until you know what an
allocation *costs*).

**The one idea.**
> RAII is free on the happy path because the cost is in a table, not in the instruction stream.
> A destructor on the normal path is one `call`; the exception path is a duplicate of that call
> in a cold section that is only ever reached by the unwinder consulting `.eh_frame` and
> `.gcc_except_table`. You pay nothing until you throw, and then you pay a lot.

---

### Unit 4 — Indirection: vtables, and the same trick at process scale

**Concept.** A virtual call is a load of the vptr, a load from the vtable at a fixed offset,
and an indirect call. The Itanium ABI fixes that layout. Multiple inheritance means multiple
vptrs and `this`-adjusting thunks. And the *dynamic linker* solves the same problem the same
way: a call into a shared library goes through the PLT, which loads a function pointer from
the GOT and jumps to it.

**Reading.** TC++PL4 ch. 20 (§20.3.2 Virtual Functions, §20.3.4 Override Control, §20.6
Pointers to Members), ch. 21 §21.3 (Multiple Inheritance, Virtual Base Classes), ch. 22 (RTTI:
`dynamic_cast`, `typeid`, and §22.4 Construction and Destruction) ·
TLPI ch. 41 (Fundamentals of Shared Libraries), ch. 42 (Advanced Features — lazy binding,
PLT/GOT, `dlopen`, visibility, `LD_PRELOAD`) · TC++PL4 ch. 15 (Linkage, ODR).

**Prerequisites.** Units 1 and 3. (Layout for the vptr; lifetime for why the vptr changes
during construction.)

**The one idea.**
> Dynamic dispatch is one extra load and one indirect call — and it is *the same mechanism*
> the dynamic linker uses to reach across an `.so`. Late binding always costs an indirection
> and always defeats inlining; the only question is who owns the table.

---

### Unit 5 — Templates: the compiler as a code generator

**Concept.** A template is not a type or a function; it is a machine that emits one type or
function per instantiation. Every instantiation becomes a real, mangled symbol placed in a
COMDAT/`.section .text._Z...` group so the linker can deduplicate it across translation units.
Monomorphisation is why C++ generics have zero runtime cost and non-zero compile-time and
binary-size cost. And unconstrained templates fail *at instantiation, inside the library*,
which is why the error messages are famously bad — and why concepts exist.

**Reading.** TC++PL4 ch. 23 (esp. §23.2.2 Template Instantiation, §23.3 Type Checking /
Error Detection, §23.7 Source Code Organization: Linkage), ch. 25 (Specialization), ch. 26
(Instantiation, name binding, two-phase lookup), ch. 28 §28.1–28.4 (Type Functions, Traits,
Enable_if) · TC++PL4 ch. 15 (ODR, vague linkage) · TLPI ch. 41 (symbol resolution, weak
symbols) — the ELF half of "why does the same template appear in five objects and one binary".

**Prerequisites.** Unit 4 (you contrast monomorphisation with virtual dispatch; you need to
already know what the indirect call costs).

**The one idea.**
> Every template instantiation is a distinct symbol in the object file. The compiler is a code
> generator; templates are its input language. That is simultaneously why `std::sort` beats
> `qsort` and why your build takes eleven minutes.

---

### Unit 6 — Concurrency: threads, mutexes, and the memory model

**Concept.** `std::thread` is `pthread_create` is `clone(2)` with a specific flag set, a
`mmap`'d stack and a guard page. `std::mutex` is a futex, and an uncontended lock is a
userspace compare-and-swap that never enters the kernel. `std::atomic`'s memory orderings are
a contract with *the compiler* as much as with the CPU: on x86-64 (TSO) acquire and release
cost literally zero instructions, and yet specifying them changes the code the compiler is
allowed to emit.

**Reading.** TC++PL4 ch. 41 (Memory Model: Memory Location, Instruction Reordering, Memory
Order, Data Races; Atomics; volatile), ch. 42 (Threads: Construction, Destruction, join,
detach, thread_local; Avoiding Data Races: Mutexes, call_once, Condition Variables) ·
TLPI ch. 29 (Threads: Introduction), ch. 30 (Thread Synchronization), ch. 33 §33.x (threads
vs. `fork`/signals), ch. 28 (Process Creation and Program Execution in More Detail — `clone`).

**Prerequisites.** Units 2 and 3. (Address space, because threads share one and stacks are
`mmap`'d; lifetime, because `join`/`detach` is a lifetime problem and a joinable `std::thread`
destructor calls `terminate`.)

**The one idea.**
> The C++ memory model is not a description of your CPU. On x86-64 a release store and a
> relaxed store emit the *same instruction*; recompile the same file for ARM64 and they become
> `str` and `stlr`. Meanwhile the ordering you did not ask for is enforced against the
> *compiler* on every target — a non-atomic spin loop is deleted entirely at `-O2`.
> Write to the model, not to the hardware you happen to be on.

---

### Unit 7 — Measurement: observing the machine you've been reasoning about

**Concept.** Every claim in units 1–6 is falsifiable in under a minute with the right tool:
`strace` for the syscall boundary, `/proc/PID/maps` and `smaps` for the address space, `perf
stat`/`perf record` for cache and branch behaviour, `nm`/`readelf`/`c++filt` for symbols,
`pahole` for layout, and the compiler's own optimisation reports for vectorisation. The
performance model that ties them together is the cache line: 64 bytes, false sharing, and
struct-of-arrays vs array-of-structs.

**Reading.** TLPI App. A (Tracing System Calls), ch. 12 (System and Process Information —
`/proc`), ch. 36 (Process Resources), ch. 13 (File I/O Buffering — stdio buffer vs `write()`) ·
TC++PL4 ch. 38 §38.4 (stream buffering) as the C++ end of the same story; ch. 41 §41.2.1
(Memory Location) revisited as the false-sharing rule.

**Prerequisites.** All of 1–6.

**The one idea.**
> You cannot reason about performance you have not counted. The gap between "this should be
> fast" and "this is fast" is always a measurement away, and the measurement is usually one
> command.

---

## 4. The bridges — where a C++ feature is best taught as a syscall or an instruction

These are the joints of the curriculum. Each one is a place where the C++-side explanation is
incomplete on its own and the Linux-side explanation is unmotivated on its own.

All assembly below is **real output** from Compiler Explorer (x86-64 gcc 15.2, `-O2
-std=c++20`, Intel syntax, demangled) unless noted.

### Bridge A — `new` → `operator new` → `malloc` → `brk` / `mmap`
*(Unit 2. TC++PL4 §11.2 ↔ TLPI ch. 7 + ch. 49.)*

`new int(7)` does not allocate. It **calls** something:

```asm
f():                                  ; int* f(){ return new int(7); }
        sub     rsp, 8
        mov     edi, 4                ; sizeof(int)
        call    operator new(unsigned long)     ; mangled: _Znwm
        mov     DWORD PTR [rax], 7    ; <-- the *construction*, inlined
        add     rsp, 8
        ret

g():                                  ; int* g(){ return new int[100000]; }
        mov     edi, 400000
        jmp     operator new[](unsigned long)   ; mangled: _Znam
```

The teaching points, in order:
1. `new` is **two operations**: a call to `operator new` (allocation) and a construction the
   compiler inlines. `new[]` is a *different symbol* (`_Znam` vs `_Znwm`) — that is why
   `delete` on an array is UB. The mangling is a small readable table worth handing out:

   | Source | Symbol |
   |---|---|
   | `operator new(size_t)` | `_Znwm` (`m` = `unsigned long`) |
   | `operator new[](size_t)` | `_Znam` |
   | `operator delete(void*)` | `_ZdlPv` |
   | `operator delete(void*, size_t)` | `_ZdlPvm` (C++14 sized delete) |
   | `operator new(size_t, align_val_t)` | `_ZnwmSt11align_val_t` |
   | `operator new(size_t, const nothrow_t&)` | `_ZnwmRKSt9nothrow_t` |

   Two extras that reward five minutes each. **Over-aligned types route elsewhere:**
   `struct alignas(64) A` emits `movl $64,%edi; movl $64,%esi; callq _ZnwmSt11align_val_t`,
   which libstdc++ services with `aligned_alloc`, not `malloc`. And **`new T[n]` allocates a
   cookie** — 8 extra bytes holding the element count, present only when `T` has a non-trivial
   destructor, with an overflow check that passes `SIZE_MAX` to `_Znam` on wrap so you get a
   guaranteed `bad_alloc` instead of a tiny buffer. `delete[]` reads it back with
   `movq -8(%rdi), %rax`. `new int[n]` has no cookie at all.
2. libstdc++'s `operator new` is a thin wrapper — the actual source, from
   `libstdc++-v3/libsupc++/new_op.cc`:
   ```cpp
   _GLIBCXX_WEAK_DEFINITION void* operator new (std::size_t sz)
   {
     void *p;
     if (__builtin_expect (sz == 0, false)) sz = 1;   // malloc(0) is unpredictable
     while ((p = malloc (sz)) == 0) {
       new_handler handler = std::get_new_handler ();
       if (! handler) _GLIBCXX_THROW_OR_ABORT(bad_alloc());
       handler ();
     }
     return p;
   }
   ```
   No arena, no pooling — `malloc` plus the `new_handler` retry loop. `_GLIBCXX_WEAK_DEFINITION`
   is why replacing `operator new` in your own TU just works, which is exactly the `LD_PRELOAD`
   story from TLPI ch. 42.
3. glibc `malloc` decides between the heap and `mmap` **on the chunk size, in `sysmalloc`**:
   ```c
   if (av == NULL || ((unsigned long)(nb) >= (unsigned long)(mp_.mmap_threshold)
                      && (mp_.n_mmaps < mp_.n_mmaps_max)))
     { ... mm = sysmalloc_mmap (nb, pagesize, 0); ... }
   else /* main_arena */
     { size = nb + mp_.top_pad + MINSIZE; ...
       brk = (char *) (MORECORE ((long) size)); }   /* __sbrk -> brk(2) */
   ```
   Constants, checked against `malloc/malloc.c` at glibc 2.31 / 2.35 / 2.39 / 2.41 / master:
   `DEFAULT_MMAP_THRESHOLD` = **128 KiB**, `DEFAULT_MMAP_THRESHOLD_MAX` = 32 MiB on 64-bit
   (512 KiB on 32-bit), `DEFAULT_TRIM_THRESHOLD` = 128 KiB, `HEAP_MAX_SIZE` = 64 MiB, arena cap
   = 8 × ncores on 64-bit. Chunk sizing is
   `request2size(req) = max(32, (req + 8 + 15) & ~15)`.
   The threshold is *dynamic*: freeing an mmap'd chunk larger than the current threshold raises
   the threshold to that size (capped at 32 MiB) and sets trim to twice it — the theory being
   that a program repeatedly allocating and freeing 1 MiB buffers should recycle through `brk`
   rather than pay mmap + page faults + munmap + TLB shootdown each time. Calling
   `mallopt(M_MMAP_THRESHOLD, …)` **disables** the adaptation and pins the value.
   So `f()`'s 4 bytes come out of tcache with **no syscall at all**; `g()`'s 400 000 bytes are
   over the threshold and become an `mmap(NULL, ..., MAP_PRIVATE|MAP_ANONYMOUS)`.
4. **tcache** is the fast path and the number to quote depends on version:
   glibc ≤ 2.41 has `TCACHE_MAX_BINS 64` × `TCACHE_FILL_COUNT 7` (covering chunks to ~1032
   bytes usable); glibc master adds 12 large bins and raises the fill count to 16. Per-thread,
   unlocked, singly-linked, with pointer mangling since 2.32. Fastbins default to `M_MXFAST`
   = 128 bytes on 64-bit. **Quote the version or don't quote the number.**
5. Under `strace`, a program that news a small object in a loop shows **zero** syscalls after
   startup. That single observation is the whole unit.
6. The *first* allocation is special: the heap doesn't exist yet, so you see one `brk(NULL)`
   to discover the break (this is `__sbrk` initialising `__curbrk`) followed by a `brk(addr)`
   to move it. `main_arena.top` starts as a zero-sized sentinel pointing at its own bin —
   deliberately, per the source comment, *"thus forcing extension on the first malloc request,
   avoiding any special code in malloc to check whether it even exists yet."*

   > ⚠ **Do not teach the "132 KiB first brk is `M_TOP_PAD`" folklore.** The
   > [`mallopt(3)` man page](https://man7.org/linux/man-pages/man3/mallopt.3.html) documents
   > `M_TOP_PAD`'s default as 128 KiB, but **the glibc source contradicts it**:
   > `DEFAULT_TOP_PAD` is `(0)` in every version from 2.23 to master, with an adjacent comment
   > saying page rounding is normally sufficient. With `top_pad == 0` a first `malloc(100)`
   > should advance the break by one page, not 132 KiB. Empirically the 132 KiB heap is real —
   > my own CE run printed `[heap]` at exactly `0x21000` = 132 KiB — but it is almost certainly
   > accumulated startup allocation (C++ iostream static init allocates a lot before your first
   > `new`), not one padded request. Present it as an observation, not a derivation.
7. `free` returning nothing to the OS is not a bug: `M_TRIM_THRESHOLD` (default 128 KiB) is
   what decides whether the top of the heap is `brk`'d back down. mmap'd blocks *are*
   `munmap`'d on free. Secondary arenas, created on lock contention, are `mmap`'d 64 MiB
   `PROT_NONE` regions committed piecewise with `mprotect` — which is why thread-heavy
   processes show enormous VIRT with modest RSS.

**Assignment pairing:** read TC++PL4 §11.2.3 ("Getting Memory Space") and TLPI §7.1
back-to-back, then run `strace -e trace=brk,mmap,munmap ./a.out`.

### Bridge B — a virtual call → one load and one indirect jump
*(Unit 4. TC++PL4 §20.3.2 ↔ Itanium C++ ABI ↔ TLPI ch. 42's PLT/GOT.)*

```cpp
struct B { virtual void f(); virtual void g(); };
void call(B* b) { b->g(); }
```
```asm
call(B*):
        mov     rax, QWORD PTR [rdi]      ; load the vptr from offset 0 of *b
        jmp     [QWORD PTR [rax+8]]       ; call the 2nd slot (g), tail-called
```

Three instructions' worth of curriculum:
- **The vptr is at offset 0** of the most-derived object, and it is a real data member —
  `sizeof(B)` is 8 for a class with no data. It is *assigned by each constructor in turn*,
  which is why a virtual call from a base constructor dispatches to the base override
  (TC++PL4 §22.4).
- **`[rax+8]` is the second virtual function**, in declaration order. Slots are 8 bytes,
  numbered from 0. Change the declaration order of `f` and `g` and the offset changes — this
  is precisely why adding a virtual function to a class in a shared library is an ABI break,
  which connects straight to TLPI ch. 42's `SONAME`/versioning material.
- **What's at negative offsets.** The address in the vptr does not point at the start of the
  vtable. Here is a real emitted vtable for `struct D : B, B2`, which shows the whole layout
  including the secondary table:
  ```asm
  _ZTV1D:
        .quad   0                 ; [-16] offset-to-top (primary: 0)
        .quad   _ZTI1D            ; [ -8] RTTI pointer
                                  ; <-- ADDRESS POINT; the vptr holds THIS address
        .quad   _ZN1DD2Ev         ; [  0] complete-object destructor
        .quad   _ZN1DD0Ev         ; [  8] deleting destructor (dtor + operator delete)
        .quad   _ZN1D1fEv         ; [ 16] f()
        .quad   _ZN1B1gEv         ; [ 24] g()  inherited, not overridden
        .quad   _ZN1D1hEv         ; [ 32] h()
        .quad   -16               ; secondary vtable for the B2 base: offset-to-top
        .quad   _ZTI1D            ; same RTTI object (the ABI requires this)
        .quad   _ZThn16_N1D1hEv   ; thunk
        ...
  ```
  `dynamic_cast` and `typeid` read the `-8` slot; that is the entire cost of RTTI, and it is
  why `-fno-rtti` shrinks binaries. Note also that **a virtual destructor takes two slots**
  (complete-object `D1` and deleting `D0`), which is why a vtable has more entries than the
  class has virtual functions. Those two slots sit wherever the destructor was *declared* — in
  a class written `virtual void f(); virtual ~B();` the real emitted vtable is `f` at slot 0
  and the destructors at slots 1 and 2 (verified). Declaration order governs everything.

  **Three independent confirmations of the address point**, all verified live, and worth showing
  together because each speaks a different dialect:
  ```
  GCC  -fdump-lang-class=stderr   ->  vptr=((& B::_ZTV1B) + 16)
  Clang -Xclang -fdump-vtable-layouts ->  "-- (B, 0) vtable address --" printed after slot 1
  Relocation in the .o              ->  R_X86_64_32S _ZTV1B+0x10
  ```
  The linker's own relocation says `+0x10`: the constructor stores *vtable symbol + 16* into the
  vptr. That is the ABI's address point, stated by the object file rather than by a diagram.

  Vtables are `.weak`, in `.data.rel.ro` COMDAT, keyed on the class's *key function*
  (first non-inline non-pure virtual) — if there is none, every TU emits a copy and the linker
  dedupes.
- **Multiple inheritance** produces one vptr per non-empty polymorphic base, and calling
  through a secondary base requires adjusting `this` — the compiler emits a *thunk*:
  ```asm
  _ZThn16_N1D1hEv:          ; "Thunk, non-virtual, this -= 16"
        addq    $-16, %rdi
        jmp     D::h
  ```
  `_ZThn<n>_` reads as "non-virtual `this` adjustment by −n". A `static_cast<B2*>(dptr)` is a
  compile-time `addq $16` plus a null check, not a call.
- **Virtual inheritance** goes further: the shared base's position isn't a compile-time constant,
  so it's read from the vtable at a **negative** offset at runtime:
  ```asm
  _Z4vgetP2V1:              ; int vget(V1* p) { return ((VB*)p)->a; }
        movq    (%rdi), %rax
        movq    -24(%rax), %rax     ; vbase offset, read from the vtable
        movl    8(%rdi,%rax), %eax
  ```
  and the thunks become *virtual* thunks (`_ZTv0_n24_N2VD1fEv`) that load their adjustment at
  runtime rather than using a constant. A VTT (`_ZTT2VD`) is threaded through base constructors
  so partially-constructed objects see the right intermediate vtables. This is the honest answer
  to "why is virtual inheritance expensive."
- **Devirtualization** is the escape hatch, and `-fdevirtualize` is **on by default at `-O2`**
  in both GCC and Clang. Mark the class or the override `final` and `int devirt(D* d){ return
  d->f(); }` collapses to `movl $7, %eax; retq` — the call vanishes entirely. Beyond that:
  `-fdevirtualize-speculatively` (also default at `-O2` in GCC) emits a guarded direct call
  (`if (vptr == &_ZTV1D+16) inlined(); else indirect();`), so a monomorphic call site costs a
  well-predicted branch; and `-flto` plus `-fdevirtualize-at-ltrans` gives whole-program
  hierarchy visibility. Anonymous namespaces and `-fvisibility=hidden` help a lot, because a
  class that can't be derived from outside the DSO is a class the compiler can reason about.
  Showing the same source produce an indirect jump and then a direct call is the most
  persuasive argument for `final` anyone will ever see.
- **`typeid` and `dynamic_cast`.** `typeid(*b)` on a polymorphic lvalue is
  `movq (%rdi),%rax; movq -8(%rax),%rdi` — plus a null check branching to `__cxa_bad_typeid`.
  On a non-polymorphic type it's resolved at compile time to `&_ZTI<name>`, costing nothing.
  `dynamic_cast` is a genuine library call:
  ```c
  void* __dynamic_cast(const void* sub, const __class_type_info* src,
                       const __class_type_info* dst, ptrdiff_t src2dst_offset);
  ```
  (hint values: ≥0 a known unique non-virtual offset, −1 none, −2 not a public base, −3 a
  multiple public base). Only the null check and the `__cxa_bad_cast` throw edge are inline;
  the implementation walks the `__vmi_class_type_info` graph, which is why `dynamic_cast` on a
  deep hierarchy is orders of magnitude slower than a virtual call. `dynamic_cast<void*>(p)` is
  the cheap special case: read offset-to-top and add.
  One production gotcha worth a slide: `type_info::operator==` is a pointer compare within one
  DSO but falls back to `strcmp` of the `_ZTS` name string across DSOs — which is why
  `dynamic_cast` fails across `dlopen`ed libraries built with `-fvisibility=hidden`. That is a
  C++ bug whose root cause is in TLPI ch. 42.
- **The bridge to Linux:** the PLT does the identical thing at process scope. A call to a
  function in a shared library compiles to `call puts@PLT`; the PLT stub is
  `jmp [rip+offset]` through the GOT, and on first call the GOT entry points back at the
  resolver. One load, one indirect jump. Vtable and PLT are the same idea at two scales.

### Bridge C — RAII and move at the instruction level
*(Unit 3. TC++PL4 §13.1.7 + §17.5 ↔ the `.cold` section and the unwind tables.)*

```cpp
struct G { ~G(); };
void may_throw();
void f() { G g; may_throw(); }
```
```asm
f():
        push    rbx
        sub     rsp, 16
        call    may_throw()
        lea     rdi, [rsp+15]
        call    G::~G() [complete object destructor]
        add     rsp, 16
        pop     rbx
        ret
        mov     rbx, rax                 ; <-- landing pad, not reached by fallthrough
        jmp     .L2
f() (.cold):
.L2:
        lea     rdi, [rsp+15]
        call    G::~G() [complete object destructor]
        mov     rdi, rbx
        call    _Unwind_Resume
```

Compile the *same source* with `-fno-exceptions` and the cold section vanishes entirely:

```asm
f():
        sub     rsp, 24
        call    may_throw()
        lea     rdi, [rsp+15]
        call    G::~G() [complete object destructor]
        add     rsp, 24
        ret
```

That diff is the lesson. "Zero-cost exceptions" means:
- The happy path is **byte-identical** apart from register-saving forced by the landing pad.
  There is no flag, no check, no `setjmp`.
- The unwind path is a *second copy* of the cleanup code, parked in `.text.unlikely`, reachable
  only by the personality routine `__gxx_personality_v0` walking `.eh_frame` (the CFI) and
  `.gcc_except_table` (the LSDA) to find which landing pad covers the current PC.
- The compiler emits **a separate cleanup block for every distinct set of live objects**. Two
  guards in one function produced three landing-pad variants in a real listing. That is where
  exception-handling code size actually comes from, and it is all in cold blocks.
- Throwing costs: `__cxa_allocate_exception` (a `malloc`-ish call with a static emergency pool),
  `__cxa_throw(void* thrown, type_info*, void (*dest)(void*))`, `_Unwind_RaiseException`, and
  then a **two-phase** walk. Phase 1 (`_UA_SEARCH_PHASE`) walks the stack *virtually* — no
  frames popped, no destructors run — asking each frame's `__gxx_personality_v0` whether it has
  a matching handler. If none exists anywhere, `std::terminate` is called **from the throw point
  with the stack intact**, which is why an uncaught exception gives you a usable core dump.
  Phase 2 (`_UA_CLEANUP_PHASE`) walks again, restoring registers per frame from the CFI and
  jumping to each landing pad (exception pointer in `%rax`, selector in `%rdx`), each of which
  ends in `_Unwind_Resume`. Microseconds, not nanoseconds. Exceptions are for the exceptional;
  the assembly says so.
- Historically `_Unwind_Find_FDE` took a global lock, so concurrent throws serialised — a real
  scalability cliff. libgcc has since added a lock-free path via the `PT_GNU_EH_FRAME` header.
  *Verify against your specific libgcc before teaching it as fixed.*
- Corollary worth showing: a `noexcept` move constructor lets `std::vector::resize` move
  instead of copy (via `move_if_noexcept`). Marking a move constructor `noexcept` is one word
  that changes an O(n) copy into an O(n) pointer transfer.

**Move.** `std::move` itself is `static_cast<remove_reference_t<T>&&>(x)` — a compile-time
change of value category that emits **zero instructions, always, at every optimisation level.**
Every instruction people attribute to "the move" belongs to the move constructor that overload
resolution then selected. Corollary and the most common `std::move` bug: if the type has no
move constructor, `std::move` silently selects the *copy* constructor, with no diagnostic.

A `unique_ptr`-shaped move is three instructions, no call, no branch:
```asm
        movq    (%rdi), %rax        ; load source pointer
        movq    %rax, (%rsp)        ; store into destination
        movq    $0, (%rdi)          ; null the source
```
versus a copy, which would be `_Znwm` + copy + eventual `_ZdlPvm` — a round trip through the
allocator. But that copy constructor does not exist at all (`= delete`d), so the *compiler
error* is the teacher.

> **A `std::string` move is not free, and this is worth teaching precisely because everyone
> assumes it is.** libstdc++'s layout is `char* _M_p; size_t _M_len; union { char buf[16];
> size_t cap; }` — 32 bytes, and for a short string `_M_p` points *into the object itself*. A
> self-referential pointer cannot be memcpy'd, so the move constructor **branches**: heap case
> steals the pointer (3 stores); SSO case must actually copy 16 bytes with `movups` and
> re-point `_M_p` at the *destination's* buffer, then reset the source to point at its own.
> libc++ made the opposite trade — 24 bytes, no self-pointer, SSO flagged in a size bit — so
> its move is a flat 3-word copy. Two standard libraries, same standard, different cost model.

**Elision and the sret convention.** A class too big for two registers is returned via a hidden
pointer: the *caller* allocates the storage and passes its address in `%rdi`, every real
argument shifts one register right, and the callee must return that same pointer in `%rax`.
So `Big rvo() { return Big(); }` and `Big nrvo() { Big b; return b; }` compile **byte-identically**:
```asm
        movq    %rdi, %rbx           ; hidden return slot
        callq   _ZN3BigC1Ev          ; construct DIRECTLY into the caller's storage
        movq    %rbx, %rax           ; ABI: hand the sret pointer back
        retq
```
Get the distinction right when teaching it: **C++17 guaranteed elision covers prvalues only** —
`Big b = rvo();` is guaranteed because there was never a second object (the type need not even
be movable). **NRVO remains an optimisation**: the `nrvo()` above got it, but
`if (x) return a; else return b;` typically will not. And `return std::move(local)` actively
*disables* NRVO — a pessimisation you can see in the assembly and in the Unit 3 exercise output.

### Bridge D — `std::atomic` orderings → x86-64 TSO vs ARM64
*(Unit 6. TC++PL4 §41.2–41.3 ↔ the instruction set.)*

Same source, two targets. x86-64 gcc 15.2:

| C++ | x86-64 emitted |
|---|---|
| `a.load(relaxed)` | `mov eax, DWORD PTR a[rip]` |
| `a.load(acquire)` | `mov eax, DWORD PTR a[rip]` |
| `a.load()` *(seq_cst)* | `mov eax, DWORD PTR a[rip]` |
| `a.store(v, relaxed)` | `mov DWORD PTR a[rip], edi` |
| `a.store(v, release)` | `mov DWORD PTR a[rip], edi` |
| `a.store(v)` *(seq_cst)* | `xchg edi, DWORD PTR a[rip]` |
| `a.fetch_add(1, relaxed)` | `lock xadd DWORD PTR a[rip], eax` |
| `a.compare_exchange_strong` | `lock cmpxchg DWORD PTR a[rip], esi` |

ARM64 gcc trunk, identical source:

| C++ | ARM64 emitted |
|---|---|
| `a.load(relaxed)` | `ldr w0, [x0]` |
| `a.load(acquire)` | `ldar w0, [x0]` |
| `a.store(v, release)` | `stlr w0, [x1]` |
| `a.store(v)` *(seq_cst)* | `stlr w0, [x1]` |

The lesson lands in three beats:
1. **On x86, five of the eight rows are the same `mov`.** Acquire and release are free because
   the hardware is Total Store Order: it never reorders load-load, load-store or store-store.
   Only store→load can be reordered, which is exactly why the *seq_cst store* is the one that
   costs — it needs `xchg` (an implicitly `lock`ed RMW, chosen over `mov`+`mfence` because
   it's faster on most microarchitectures) to get StoreLoad ordering.
2. **They still constrain the *compiler*, which is the half people forget.** The right demo
   is not relaxed-vs-acquire (identical on x86) but atomic-vs-not. `while (!plain_bool) {}`
   at `-O2` compiles to a bare `ret` — GCC deletes the loop outright under the
   forward-progress rule. `while (!atomic.load(relaxed)) {}` keeps the load. Both orderings
   emit the same `movzx`; the *atomicity* is what stops the optimiser, and no `lock` prefix
   is involved. (Verified; full listings in §5 Unit 6 Part 2.)
3. **Recompile for ARM64 and the model becomes visible in the instruction stream.** `ldr` vs
   `ldar`, `str` vs `stlr`. The C++ memory model is portable; your intuition about x86 is not.
   Code that "works" on x86 with the wrong ordering is a latent ARM bug — this is the single
   most valuable thing a C++ programmer can learn from cross-compiling.

Five footnotes, each worth a paragraph:

**Fences.** `atomic_thread_fence(acquire)` and `(release)` emit **literally zero bytes** on
x86-64 — clang prints a `#MEMBARRIER` comment marker that assembles to nothing. `(seq_cst)`
emits `lock orl $0, -64(%rsp)`: a lock-prefixed no-op on the red zone, because any locked
instruction gives full fencing and touching a hot private stack line is cheaper than `mfence`.
On ARM64 the same three are `dmb ishld`, `dmb ish`, `dmb ish`. The zero-byte fence is the
single clearest proof that these orderings are instructions to the *compiler*.

**Every LOCK-prefixed RMW is a full barrier on x86.** Which means `fetch_add(relaxed)` and
`fetch_add(seq_cst)` compile to **identical instructions** — there is no such thing as a cheap
relaxed RMW here. On ARM64 the difference is real and visible (`ldxr`/`stxr` vs
`ldaxr`/`stlxr`). Another case where the x86 intuition is free and wrong.

**`compare_exchange_weak` and `_strong` emit identical code on x86** — `cmpxchg` cannot fail
spuriously. On ARM64 they differ: `weak` is one `ldxr`/`stxr` attempt, `strong` adds the retry
loop. So writing `weak` inside a loop you were going to write anyway is free on x86 and
strictly better on ARM. `LOCK CMPXCHG`'s contract maps exactly onto the C++ one: expected in
`EAX`, `ZF=1` on success, and on failure `EAX` is overwritten with the observed value.

**seq_cst store encoding is compiler- and version-dependent.** GCC 15.2 emits `xchg` (verified
above); older GCC emitted `mov` + `mfence`. Both are correct mappings of the same requirement —
drain the store buffer — and `xchg` is generally faster because `mfence` also orders
non-temporal stores it doesn't need to. Note the asymmetry: seq_cst *loads* are plain `mov`
because the debt was paid by the store. The reverse convention (fence on load, plain store) is
equally sound but loads outnumber stores, so nobody uses it — and mixing the two across
translation units would be unsound, which is why this mapping is effectively ABI.

**`memory_order_consume`.** The intent was to exploit *dependency ordering*: on every relevant
CPU except Alpha, a load whose address derives from a previously loaded pointer is already
ordered against it with no barrier — so `p = head.load(consume); use(p->data);` could be a plain
`ldr` where acquire needs `ldar`. This is the pattern RCU is built on. It failed because
optimisers routinely destroy the dependency (a compiler that proves `p` is one of two values
replaces the dependent load with a branch, and the ordering evaporates), and tracking it
correctly demands `[[carries_dependency]]` threaded through every signature on the path. **Every
production compiler implements it as `acquire`** — verified: `__ATOMIC_CONSUME` on AArch64
emits `ldar`, indistinguishable from acquire.
[P0371R1](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2016/p0371r1.html) ("Temporarily
discourage") was adopted for C++17;
[P3475R2](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p3475r2.pdf) (2025) proposes
formal deprecation. Teach it in one sentence: use `acquire`.

**ARM64 practicalities.** With `-march=armv8.1-a+lse` the LL/SC retry loops collapse to single
instructions (`ldadd`/`ldaddal`, `cas`/`casal`, `swp`/`swpal`), which scale far better under
contention; and `-moutline-atomics` (GCC default since 10, and on most distro toolchains) emits
runtime-dispatched helpers so one binary gets LSE where the hardware has it.

**`volatile` is not atomic** and provides no ordering whatsoever — TC++PL4 §41.4 exists to say
exactly this, and it is the one section of that chapter to assign as a corrective.

### Bridge E — `std::thread` → `pthread_create` → `clone(2)`
*(Unit 6. TC++PL4 §42.2 ↔ TLPI ch. 28–30.)*

`std::thread t{f};` on libstdc++/glibc:
1. Heap-allocates a `_State` object holding the callable (this is why the constructor can
   throw `std::bad_alloc`, and why the callable is *decay-copied*).
2. Calls `__gthread_create` → `pthread_create`.
3. glibc `pthread_create` `mmap`s a stack — default **8 MiB** (`ulimit -s`), `MAP_PRIVATE |
   MAP_ANONYMOUS | MAP_STACK`, plus a guard page made `PROT_NONE` with `mprotect`. That guard
   page is what turns infinite recursion into a clean `SIGSEGV` instead of silent corruption
   of a neighbour's stack. It is also why `top` shows enormous VIRT for a threaded process and
   modest RSS: 8 MiB of *address space* per thread, a few pages of actual memory.
4. Issues `clone3()` (glibc 2.34+; falls back to `clone()` on `ENOSYS`). From glibc master,
   `sysdeps/unix/sysv/linux/createthread.c`, verbatim:
   ```c
   const int clone_flags = (CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SYSVSEM
                            | CLONE_SIGHAND | CLONE_THREAD
                            | CLONE_SETTLS | CLONE_PARENT_SETTID
                            | CLONE_CHILD_CLEARTID | 0);
   struct clone_args args = {
       .flags = clone_flags,
       .parent_tid = (uintptr_t) &pd->tid,
       .child_tid  = (uintptr_t) &pd->joinstate,
       .stack = (uintptr_t) stackaddr, .stack_size = stacksize,
       .tls = (uintptr_t) tp,
   };
   ```
   Read the flag list as a checklist of *what a thread shares with its creator*: `CLONE_VM`
   address space, `CLONE_FS` cwd/root/umask, `CLONE_FILES` the fd table, `CLONE_SIGHAND` signal
   dispositions, `CLONE_THREAD` the thread group (same `getpid()`, distinct `gettid()` — this
   is the flag that makes it a thread rather than a process), `CLONE_SYSVSEM` semaphore undo
   state. `CLONE_SETTLS` is where `thread_local` comes from: it sets the `%fs` base on x86-64,
   equivalent to `arch_prctl(ARCH_SET_FS)`.
5. `CLONE_CHILD_CLEARTID` is the punchline: it tells the kernel to zero a word and
   `FUTEX_WAKE` on it when the thread exits. `pthread_join`, and therefore
   `std::thread::join()`, is a **futex wait on that address**. Joining is not polling.

   > ⚠ **Correction to the description everyone repeats.** Classic NPTL futex-waited on
   > `pd->tid`. **Current glibc does not** — Zanella's NPTL rework (~2.32–2.35) moved the wait
   > to a dedicated `pd->joinstate` field with four states, because using the TID as both an
   > identifier and a synchronisation word was racy. Note `.child_tid = &pd->joinstate` in the
   > struct above: `CLONE_CHILD_CLEARTID` still does the work, the address just moved. Say
   > *"futex wait on the `CLONE_CHILD_CLEARTID` address"* and you are correct on both old and
   > new glibc; say *"on the TID"* and you are describing pre-2.32.

   And the detail that makes it click: **joining an already-exited thread performs no syscall
   at all** — the `atomic_load_acquire` sees `EXITED` and the wait loop never runs. `futex(...,
   FUTEX_WAIT_PRIVATE, ...)` appears under `strace` only when the thread is genuinely running.
6. **TLS is variant II on x86-64**: the thread pointer (`%fs` base) points at the TCB and the
   static TLS block grows *downward* below it. glibc puts `struct pthread` at the top of the
   same mapping as the stack, so stack and TCB are one allocation. `__thread int x;` under
   initial-exec resolves to `movl %fs:x@tpoff, %eax` — one instruction, no call. Dynamic TLS
   (in `dlopen`ed libraries, general-dynamic model) instead calls `__tls_get_addr`, which is
   markedly slower — which is why `-ftls-model=initial-exec` is a real optimisation for shared
   libraries, and another Unit 4 ↔ Unit 6 crossover.
7. **glibc caches freed thread stacks** (default ~40 MiB). So the *second* and subsequent
   `pthread_create`s often show **no `mmap` at all** under `strace` — a nice surprise to set up
   before revealing.

Two more that fit here:
- **`std::thread`'s destructor calls `std::terminate()` if the thread is still joinable.**
  This looks like a language wart until you view it as a lifetime rule (Unit 3): the thread
  may hold references into the destroyed frame. `std::jthread` (C++20) joins instead.
- **`std::mutex` is a `pthread_mutex_t` and nothing else.** `sizeof(std::mutex) == 40` on
  x86-64; libstdc++ adds no logic — `lock()` *is* `pthread_mutex_lock`. The uncontended path is
  one `lock cmpxchgl` on the `__data.__lock` word, **zero syscalls**, ~20 cycles dominated by
  acquiring the cache line. The three-state protocol (Drepper, *Futexes Are Tricky*): `0` free,
  `1` locked no waiters, `2` locked with possible waiters.
  - Lock uncontended: CAS `0→1`. Done, no syscall.
  - Lock contended: CAS fails → `xchg` the word to `2` →
    `futex(&lock, FUTEX_WAIT_PRIVATE, 2, ...)`. The kernel re-checks the value under its bucket
    lock and only sleeps if it is still `2`, which closes the lost-wakeup race.
  - Unlock: if the *previous* value was `1`, no waiters existed — store `0` and return, **still
    no syscall**. Only if it was `2` do you pay `futex(&lock, FUTEX_WAKE_PRIVATE, 1, ...)`.

  `FUTEX_PRIVATE_FLAG` is 128, so raw `strace` shows `FUTEX_WAIT_PRIVATE` = 128 and
  `FUTEX_WAKE_PRIVATE` = 129. `strace` a program that locks an uncontended mutex ten million
  times and you see nothing at all; add a second thread and the `futex` calls appear. That
  contrast is the clearest possible demonstration of where the user/kernel boundary sits — and
  it kills the "mutexes are slow because they're syscalls" myth on the spot.
  (`std::condition_variable` is `pthread_cond_t`; the standard's spurious-wakeup wording exists
  precisely because `FUTEX_WAIT` can return `EINTR`.)
- **`fork()` in a threaded C++ program** (TLPI §28.4 + ch. 24) is the crossover exercise: the
  child gets one thread, and any mutex held by another thread at fork time is locked forever.
  This is why `malloc` in a forked child can deadlock.

### Bridge F — layout you can print vs. layout you can measure
*(Unit 1 ↔ Unit 7.)*

The smaller bridges, each worth a slide:
- `pahole` on debug info prints the holes: a `struct { char a; int b; char c; }` is 12 bytes
  with a 3-byte hole; reordering to `{ int b; char a; char c; }` makes it 8. This is a real
  tool output, not a hand-drawn diagram (see §5 Unit 1).
- `nm` + `c++filt` (or `nm -C`) makes name mangling concrete: `_Znwm` is `operator new`,
  `_ZSt4sortI...` is a `std::sort` instantiation. The Itanium mangling scheme is a *serialised
  type system*, and reading one mangled name aloud teaches overload resolution.
- `/proc/self/maps` printed by the program itself shows its own text/heap/stack/mmap regions
  with permissions — the address space from Unit 2 made literal. Column semantics are worth one
  slide: `inode == 0` means **no file backs this region** (heap, stack, BSS overflow, anonymous
  `mmap`), and `p` vs `s` is private-COW vs shared. `smaps_rollup` is the fast way to get real
  RSS/PSS for the whole process.
- **The red zone**, which is the cheapest possible demonstration that the ABI is a real document.
  SysV AMD64 psABI §3.2.2 reserves the 128 bytes *below* `%rsp`, so a leaf function can use it as
  its entire frame with no prologue at all:
  ```asm
  leaf(int, int):                    ; default -O1        ; with -mno-red-zone
        lea     rax, [rsp-40]        ;  negative offsets        sub  rsp, 40
        mov     eax, DWORD PTR [rsp-12]                         ...
        ret                                                     add  rsp, 40
  ```
  Same source, one flag, and the `sub`/`add` pair appears. Then the punchline: **Linux is built
  with `-mno-red-zone`** (`arch/x86/Makefile`), because interrupt entry pushes onto the current
  kernel stack and would silently clobber it. A compiler flag, an ABI paragraph, and a kernel
  build decision, all visible in four instructions.
- `sizeof(std::unique_ptr<T>) == 8` is the zero-overhead principle as a number. So is
  `sizeof(std::string) == 32` in libstdc++ — a pointer, a size, and a 16-byte union that holds
  15 chars inline — **versus 24 in libc++, with 22 chars inline** (both verified live). Two
  standard libraries, same standard, different layout *and different move cost*: libstdc++'s
  `_M_p` points into the object itself for short strings, so its move constructor must branch
  and copy, while libc++ flags SSO in a size bit and moves three flat words. The ABI is not
  the language, and the ABI is where the performance lives.

---

## 5. Machine-checkable exercises

**Backend contract (verified live).** `POST https://godbolt.org/api/compiler/<id>/compile`
with `Content-Type: application/json` and `Accept: application/json`. Body:

```json
{
  "source": "...",
  "compiler": "g152",
  "options": {
    "userArguments": "-O2 -std=c++20 -Wall",
    "executeParameters": { "args": [], "stdin": "" },
    "compilerOptions": { "executorRequest": false },
    "filters": { "intel": true, "demangle": true, "directives": true,
                 "labels": true, "commentOnly": true, "execute": false },
    "tools": [ { "id": "pahole", "args": "" } ],
    "libraries": []
  },
  "lang": "c++",
  "allowStoreCodeDebug": false
}
```

Three response shapes matter, all confirmed against the live API:

- **Compile.** `code` (0 = success), `asm` (array of `{text, source}`), and `stderr` — an array
  where diagnostic lines carry a structured `tag`:
  `{"line": 3, "column": 54, "text": "error: invalid conversion from 'const char*' to 'int'",
  "severity": 3, "file": "example.cpp"}`. This is the field every "provoke the error" exercise
  asserts on. Lines without a location (the source echo, the caret line, the
  `In function 'int main()':` header) have **no** `tag` — filter on its presence.

  **Severity values, all three verified live:**

  | value | meaning | example |
  |---|---|---|
  | **1** | note | `note: 'x' was declared here` |
  | **2** | warning | `warning: 'x' is used uninitialized [-Wuninitialized]` |
  | **3** | error | `error: expected ';' before '}' token` |

  Note **2 is warning and 1 is note** — a natural guess of "1 = warning" is wrong, and an
  exercise that gates on `severity >= 2` versus `== 3` behaves very differently.

- **Execute.** Set `compilerOptions.executorRequest: true` and `filters.execute: true`. The
  response has `didExecute`, `code`, `stdout` (array of `{text}`), `stderr`, `execTime`, and a
  nested `buildResult`.

  > **Two executor-mode gotchas, both verified — get these wrong and your checks silently pass.**
  >
  > **Compiler diagnostics move.** In executor mode the top-level `stderr` carries the
  > *program's* stderr; the **compiler's** diagnostics are under **`buildResult.stderr`**.
  > Verified: a program with an uninitialized-read warning returned `[]` tags at top level and
  > `[(2, line 2, "warning: 'x' is used uninitialized")]` under `buildResult.stderr`. An
  > exercise that looks for a diagnostic in the wrong place finds nothing and reports success.
  >
  > **`code` means two different things.** Top-level `code` is the *program's* exit status;
  > `buildResult.code` is the *compiler's*. When the build fails, verified:
  > `didExecute: false`, top-level `code: -1`, `buildResult.code: 1`. So **always check
  > `didExecute` before trusting `code`** — a compile failure otherwise looks like a program
  > that exited −1.
- **Tools.** `tools[].stdout` is an array of `{text}`. Confirmed working on `g152`: `pahole`,
  `readelf`, `nm`, `strings`, `ldd`, `clang-tidy`, `bloaty`, `llvm-mca`, `osaca`. `pahole`
  needs `-g` and `filters.binaryObject: true`.

Verified compiler IDs (all `supportsExecute: true`): `g131…g162` (x86-64 GCC 13.1 → 16.2),
`clang1701`, `clang1810`, `clang1910`, `clang2010`, `clang2110`, `clang2210`. Cross-target:
`arm64gtrunk`, `arm64g950` (ARM64 GCC) — these compile but do not execute, which is fine
because the ARM exercises assert on assembly.

Two endpoint facts worth writing down before someone loses an hour: **`POST /api/compilers/<id>`
(plural, no `/compile`) does not exist — it returns 405.** `/api/compilers` is GET-only
discovery; the POST target is `/api/compiler/<id>/compile` (singular). There is likewise no
`/execute` endpoint — execution is the same URL with `executorRequest: true`. And compiler IDs
must be queried, never guessed: `clang1700` **does not exist** (the 17.x id is `clang1701`),
though `g132`, `g141` and `clang1810` all do.

**Rate limits:** no `X-RateLimit-*` or `Retry-After` headers are returned, so you cannot
introspect your budget — you find out by being blocked. Godbolt's own infrastructure writeup
describes the limits as "very simple and very high, mostly because we used to be stricter and it
kept catching C++ trainers" — a classroom behind one NAT is exactly the shape of traffic that
historically tripped them. Enforcement is at the WAF plus a manual blocklist.

**For a learning platform: self-host** (the app is npm-based on port 10240; the full AWS
deployment is open source at `compiler-explorer/infra`, and community Docker images exist). Four
reasons, in order: no blocklist risk for autograder-shaped traffic; you install exactly the
compilers you teach; Docker gives you the sandbox boundary you would otherwise have to build
before running student C++; and **the public executor's 2 vCPUs make the concurrency half of
Unit 6 and 7 unmeasurable**. Either way, cache locally on
`(compilerId, source, userArguments, filters)` — responses come back `okToCache: true` and most
of a learning platform's traffic is the same snippet recompiled.

> ### ⚠ Two backend constraints that shape every exercise
>
> **1. Never gate on wall-clock time for anything *concurrent*.** The executor is **2 vCPUs**
> (`hardware_concurrency() == 2`) with a 20 s timeout and noisy neighbours. A false-sharing
> benchmark run three times *within a single process* — padded, unpadded, padded again —
> returned `428ms / 258ms / 1739ms`: the same configuration disagreeing with itself by 4×,
> with the "slow" version winning. Four threads on two cores measures the scheduler, not the
> cache.
>
> **Single-threaded memory benchmarks are a different story and do work.** An AoS-vs-SoA sum
> over 1 Mi elements measured a clean, repeatable **5.2×** (`6.69 ms` vs `1.30 ms`, 64 MiB vs
> 4 MiB of cache lines touched). The rule is therefore not "never time anything" but: **time
> single-threaded memory behaviour, never contention.** Even then, show the number and gate on
> something else.
>
> **2. Responses are cached by source hash** (`okToCache: true` in the response). Re-running
> identical source returns the *identical* result — so a flaky timing check doesn't even
> resample; it freezes one bad sample forever. This is a gift for deterministic checks (they
> are free after the first run) and fatal for nondeterministic ones.
>
> **Consequence:** every pass condition must be a compiler diagnostic, a property of the
> emitted assembly, a tool's output, or deterministic `stdout`. Performance claims get
> *demonstrated* on CE via layout and instruction counts, and *measured* offline with `perf`.
> This is not a limitation worth fighting — asserting on the assembly is the better exercise
> anyway, because it explains the mechanism instead of just observing the effect.
>
> **3. The output cap kills chatty programs.** A loop printing 200 000 lines to `std::cout`
> returns `code: 143` (SIGTERM). Programs must summarise, not stream.

---

### Unit 1 exercise — "Find the holes"

**Type: (a) compiler error the learner must fix + (c) tool output property.**

Given:
```cpp
struct Packet { char flags; int seq; char kind; double ts; short len; };
static_assert(sizeof(Packet) == 16, "reorder the members");
```

**Task.** Reorder the members — and only reorder them, don't change types — until the
`static_assert` passes.

**Why it teaches.** The failing `static_assert` reports the *actual* size in a follow-up note,
so the compiler is literally telling the learner how far off they are on each attempt.
Verified live — GCC 15.2:
```
L2 C24 sev3 | error: static assertion failed: reorder the members
L2 C24 sev1 | note: the comparison reduces to '(32 == 16)'
```
clang 21.1.0:
```
L2 C15 sev3 | error: static assertion failed due to requirement 'sizeof(P) == 16': reorder
L2 C24 sev1 | note: expression evaluates to '32 == 16'
```
The unordered struct is 32 bytes; 16 is achievable and is the tight packing
(`double, int, short, char, char`). The learner cannot brute-force it without forming the
alignment rule.

**Machine check.**
1. `code == 0` (assert passed), **and**
2. run the `pahole` tool on the same source with `-g` and `filters.binaryObject: true`;
   assert the output contains no `hole` line and `padding: 0`.

Verified `pahole` output shape for the unfixed version:
```
struct A {
	char                       a;                    /*     0     1 */
	/* XXX 3 bytes hole, try to pack */
	int                        b;                    /*     4     4 */
	char                       c;                    /*     8     1 */
	/* size: 12, cachelines: 1, members: 3 */
	/* sum members: 6, holes: 1, sum holes: 3 */
	/* padding: 3 */
};
```

**Follow-on — empty base optimization, verified live:**
```cpp
struct E {};                      // sizeof(E)  == 1
struct D1 : E { int x; };         // sizeof(D1) == 4   <- base is free
struct D2 { E e; int x; };        // sizeof(D2) == 8   <- member is not
```
**Machine check:** three `static_assert`s, all of which pass (confirmed: `E=1 EBO=4 member=8`).
The learner must explain why an empty *base* costs nothing but an empty *member* costs four
bytes. (Answer: distinct objects of the same type need distinct addresses; base subobjects are
exempt. This is why every stateless-deleter and stateless-allocator design uses inheritance,
and what C++20's `[[no_unique_address]]` finally fixes for members.)

**Follow-on — the ABI is not the language, verified live:**

| | libstdc++ (g152) | libc++ (clang2110 `-stdlib=libc++`) |
|---|---|---|
| `sizeof(std::string)` | **32** | **24** |
| `std::string{}.capacity()` (SSO) | **15** | **22** |
| `sizeof(std::vector<int>)` | 24 | 24 |
| `sizeof(std::unique_ptr<int>)` | 8 | 8 |
| `sizeof(std::shared_ptr<int>)` | 16 | 16 |

**Machine check:** compile the same source under both and assert the two `sizeof(std::string)`
values **differ**. One standard, two ABIs, two answers. `unique_ptr == 8` is the zero-overhead
principle as a number; `shared_ptr == 16` is the price of the control block pointer.

**Follow-on — zero-overhead has a precondition, verified live:**
```cpp
sizeof(std::unique_ptr<int>)                      == 8    // empty deleter, EBO'd away
sizeof(std::unique_ptr<FILE, void(*)(FILE*)>)     == 16   // function pointer is state
```
**Machine check:** assert `8` and `16`. This is the most common `unique_ptr` surprise in real
code — wrapping a C API with a function-pointer deleter silently doubles the size of every
handle. The fix (a stateless functor type, or a capture-less lambda's type via `decltype`)
brings it back to 8, and the learner has now used EBO deliberately rather than just observed it.

**Follow-on — ask the compiler instead of inferring.** Re-run the original `Packet` under
`-Xclang -fdump-record-layouts` and read the `DefinitionData` line. **Machine check:** `stdout`
contains `standard_layout` and `trivially_copyable`. Then make one member `private` and assert
`standard_layout` **disappears** — mixed access control breaks standard layout, and the
compiler will say so by name without you writing a single `static_assert`.

---

### Unit 2 exercise — "`new` is a function call"

**Type: (c) assembly property + (b) program output.**

**Part 1 — assembly.** Compile at `-O2`:
```cpp
int* small() { return new int(7); }
int* big()   { return new int[100000]; }
```
**Machine check:** the emitted assembly for `small()` contains `call operator new(unsigned long)`
and for `big()` contains `operator new[](unsigned long)`. Assert the two symbols **differ**.
(Confirmed real output above.) Then ask the learner to explain, in one line, why
`delete p` on `big()`'s result is undefined behaviour — the two distinct symbols are the answer.

**Part 2 — provoke the error.** Have the learner write a class-specific `operator new` that
returns `void*` but forgets the `size_t` parameter:
```cpp
struct S { static void* operator new(); };
```
**Machine check:** `code != 0` and a `severity: 3` diagnostic on line 1 matching
`/'operator new' takes type 'size_t'/`. Verified live (GCC 15.2):
`error: 'operator new' takes type 'size_t' ('long unsigned int') as first parameter
[-fpermissive]`. The compiler names the exact contract the learner violated.

**Part 3 — the address space, printed by the program itself.**

> The best find of this research: **`/proc/self/maps` is readable from inside the Compiler
> Explorer executor.** The program can print its own address space, deterministically, and the
> check is a string-property assertion. This turns TLPI ch. 6 into a CE exercise.

Have the learner write a program that reads `/proc/self/maps` and prints it. Verified live
output (truncated to the first 12 lines):

```
00400000-00401000 r--p 00000000 ca:01 349047   /app/output.s
00401000-00402000 r-xp 00001000 ca:01 349047   /app/output.s
00402000-00403000 r--p 00002000 ca:01 349047   /app/output.s
00403000-00404000 r--p 00002000 ca:01 349047   /app/output.s
00404000-00405000 rw-p 00003000 ca:01 349047   /app/output.s
167c7000-167e8000 rw-p 00000000 00:00 0        [heap]
7fc22de00000-7fc22de28000 r--p 00000000 ca:01 3357  /lib/x86_64-linux-gnu/libc.so.6
7fc22de28000-7fc22dfb0000 r-xp 00028000 ca:01 3357  /lib/x86_64-linux-gnu/libc.so.6
7fc22dfb0000-7fc22dfff000 r--p 001b0000 ca:01 3357  /lib/x86_64-linux-gnu/libc.so.6
7fc22dfff000-7fc22e003000 r--p 001fe000 ca:01 3357  /lib/x86_64-linux-gnu/libc.so.6
7fc22e003000-7fc22e005000 rw-p 00202000 ca:01 3357  /lib/x86_64-linux-gnu/libc.so.6
7fc22e005000-7fc22e012000 rw-p 00000000 00:00 0
```

**Machine check.** Assert the program's `stdout` contains: (i) exactly one line matching
`/r-xp .*output/` — there is exactly one executable mapping of your own code; (ii) a line
containing `[heap]`; (iii) at least one `r-xp` mapping of `libc.so.6`; (iv) **no** line that
is both `w` and `x`. The learner must then label each of the five `output` lines
(`r--p` = `.rodata`, `r-xp` = `.text`, `r--p` = RELRO, `rw-p` = `.data`/`.bss`) and explain
why W^X holds.

**Part 4 — watch a mapping appear.** Snapshot `/proc/self/maps` into a `std::set<std::string>`,
call `mmap(nullptr, 16<<20, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0)`, snapshot
again, print the diff; then `munmap` and diff again. Verified live:
```
--- mmap(16MB) ---   + 739514400000-739515400000 rw-p 00000000 00:00 0
--- munmap ---       - 739514400000-739515400000 rw-p 00000000 00:00 0
```
**Machine check:** exactly one `+` line after the `mmap` whose size is 0x1000000, and exactly
one matching `-` line after the `munmap`.

> **Caveat, tested:** trying to observe *`malloc`'s own* brk/mmap decision this way does **not**
> work in the sandbox. `malloc(4MB)` and even `malloc(32MB)` produced **no change** to
> `/proc/self/maps` — the allocator served both from space it already held. And touching
> 200 MiB gets the process `SIGKILL`ed (`code: 137`). So the *M_MMAP_THRESHOLD* half of
> Bridge A stays an offline exercise: `strace -e trace=brk,mmap,munmap ./a.out` on a real
> machine. What CE checks is the address space's *shape* and explicit `mmap`; what your laptop
> checks is the allocator's *policy*.

---

### Unit 3 exercise — "Zero-cost until you throw"

**Type: (c) assembly property, with the diff as the lesson.**

Compile this **twice**, once with `-O2` and once with `-O2 -fno-exceptions`:
```cpp
struct Guard { ~Guard(); };
void may_throw();
void f() { Guard g; may_throw(); }
```

**Machine check.**
- Both builds must contain **exactly one** `call Guard::~Guard()` on the fall-through path
  (same happy path).
- The `-O2` build must additionally contain `_Unwind_Resume` and a section label matching
  `/\.cold/` or `/text\.unlikely/`.
- The `-fno-exceptions` build must contain **neither**.

The assertion is a *difference between two compilations of the same source*, which is exactly
the claim "zero-cost exceptions" makes. (Real output for both is in §4 Bridge C.)

**Part 2 — the deleted function is the teacher.**
```cpp
#include <memory>
std::unique_ptr<int> take(std::unique_ptr<int> p) { return p; }
int main() { auto a = std::make_unique<int>(1); auto b = take(a); }
```
**Machine check:** `code != 0` with a `severity: 3` diagnostic matching
`/use of deleted function|call to deleted constructor/`. Verified live (GCC 15.2, line 3
col 56): `error: use of deleted function 'std::unique_ptr<_Tp, _Dp>::unique_ptr(const
std::unique_ptr<_Tp, _Dp>&) [with _Tp = int; _Dp = std::default_delete<int>]'`, followed by
a note pointing at the parameter that wanted the copy.
The fix is one `std::move`. The learner discovers move
semantics because the compiler refused to copy — this is the platform's core pedagogy in its
purest form.

**Part 3 — counting.** A `Tracer` that prints on construct / copy / move / destroy, returned
by value:
```cpp
struct T { T(){puts("ctor");} T(const T&){puts("copy");} T(T&&){puts("move");} ~T(){puts("dtor");} };
T make() { T t; return t; }
int main() { T a = make(); }
```
**Machine check on `stdout`** (verified live, `-O2 -std=c++20`, executor mode):
`["ctor", "dtor"]` — exactly one construction, zero copies, zero moves. NRVO built `t`
directly in the caller's return slot.

Then have the learner "improve" it to `return std::move(t);`. Verified output becomes
`["ctor", "move", "dtor", "dtor"]`. **Machine check:** assert `stdout` now contains `"move"`.
The learner introduced a pessimisation and the program reported it — `std::move` on a return
value inhibits NRVO.

---

### Unit 4 exercise — "Three instructions"

**Type: (c) assembly property.**

```cpp
struct Base { virtual void f(); virtual void g(); };
void call(Base* b) { b->g(); }
```
**Machine check (step 1):** assembly matches, in order, `/mov\s+rax, QWORD PTR \[rdi\]/` then
`/(call|jmp)\s+\[QWORD PTR \[rax\+8\]\]/`. Ask: *why 8 and not 0?* Then have the learner swap
the declaration order of `f` and `g` and re-run — the check now demands `[rax]`. **Slot index
is declaration order** is now a fact they derived, and the ABI-break lesson follows for free.

**Step 2 — devirtualize.** Same call site, but the argument is a `Derived*` and `Derived` is
marked `final`. **Machine check:** the assembly must contain a **direct** `call Derived::g()`
and must **not** contain `QWORD PTR [rdi]`. One keyword, one instruction removed.

**Step 3 — provoke the error.** The classic:
```cpp
struct B { virtual void f(int); };
struct D : B { void f(long) override; };
```
**Machine check:** `code != 0`, `severity: 3`, text matching `/marked 'override', but does not
override/`. Verified live (GCC 15.2, line 2 col 17):
`error: 'void D::f(long int)' marked 'override', but does not override`.
Then delete `override` and check that the code compiles **and is silently wrong** —
verified by output showing the base version called. The exercise's whole point is that the
compiler only helps when you ask it to.

**Step 3.5 — make the vtable itself visible.** Same class, three views, all verified:
```
-fdump-lang-class=stderr            -> "B::_ZTV1B: 5 entries" and "vptr=((& B::_ZTV1B) + 16)"
-Xclang -fdump-vtable-layouts       -> slot list with "-- (B, 0) vtable address --" after slot 1
filters {binaryObject:true,          -> "R_X86_64_32S _ZTV1B+0x10"
         demangle:false, directives:false}
```
**Machine check:** assert the GCC dump contains `+ 16)`, and assert the disassembly of the
object file contains a relocation matching `/_ZTV1B\+0x10/`. Ask the learner *why the compiler
stores the vtable symbol plus sixteen rather than the vtable symbol* — the answer (offset-to-top
at −16, RTTI at −8) is the entire Itanium vtable header, derived from a relocation rather than
recited.

Second question, using the same dump: given `virtual void f(); virtual ~B();`, GCC reports `f`
at slot 0 and **two** destructor entries at slots 1 and 2. Why two? (Complete-object `D1` vs
deleting `D0` — the latter also calls `operator delete`.) Now the learner can predict the vtable
of any class on sight.

**Step 4 — layout and thunks.** `static_assert(sizeof(Base) == 8)` for a virtual class with no
data members, then multiple inheritance:
```cpp
struct A { virtual void a(); int x; };
struct B { virtual void b(); int y; };
struct D : A, B { void a() override {} void b() override {} };
static_assert(sizeof(D) == 32, "");   // verified: passes — two vptrs + two ints + padding
void use() { D d; B* p = &d; p->b(); }
```
**Machine check:** the `static_assert` passes at 32 (8 vptr + 4 int + 4 pad, twice), and the
assembly contains a label matching `/non-virtual thunk to D::b\(\)/` — verified live at `-O1`.
Ask the learner what that thunk does before telling them: it subtracts 16 from `this` and
tail-jumps, because `B`'s subobject is not at the start of `D`.

---

### Unit 5 exercise — "The error message is the API"

**Type: (a) compiler error, both directions.**

**Part 1 — the bad message.** Give the learner:
```cpp
#include <vector>
#include <algorithm>
struct P { int x; };
int main() { std::vector<P> v; std::sort(v.begin(), v.end()); }
```
Live clang 21.1.0 produces a `code: 1` with a stack of `severity: 1` notes reading
`note: in instantiation of function template specialization 'std::sort<__gnu_cxx::__normal_iterator<P*, std::vector<P>>>' requested here`
before the real error. **Machine check:** count the diagnostics — the learner's task is to
*read* the deepest one and add `operator<`. Success = `code == 0`.

**Part 2 — the good message.** Same shape, expressed with a concept:
```cpp
#include <concepts>
template<std::integral T> T twice(T v) { return v + v; }
int main() { return twice(3.5); }
```
Live GCC 15.2 gives, at `severity: 3`,
`error: no matching function for call to 'twice(double)'`, followed by
`note: candidate 1: 'template<class T> requires integral<T> T twice(T)'` and
`note: constraints not satisfied`.
**Machine check:** `code != 0` and a `severity: 3` diagnostic on **line 3** whose text matches
`/no matching function/`, plus a note matching `/constraints not satisfied/`.
The learner's task is to compare the two error transcripts and state, in one sentence, where
each error was *detected*. That's the lesson: unconstrained templates fail deep inside the
library at instantiation; constrained ones fail at the call site.

**Part 3 — one symbol per instantiation.**
```cpp
template<class T> T twice(T v) { return v + v; }
template int    twice<int>(int);
template double twice<double>(double);
template long   twice<long>(long);
int main() {}
```
Run the `nm` tool with `filters.binaryObject: true`. Verified live output:
```
0000000000000000 W _Z5twiceIdET_S0_
0000000000000000 W _Z5twiceIiET_S0_
0000000000000000 W _Z5twiceIlET_S0_
```
**Machine check:** exactly three symbols matching `/_Z5twiceI.ET_S0_/`, all with binding `W`
(weak — the COMDAT binding the linker deduplicates across TUs). Then ask the learner to
demangle `_Z5twiceIdET_S0_` by hand before checking against `nm -C`. Monomorphisation stops
being a word, and `W`-not-`T` is the whole ODR story in one letter.

---

### Unit 6 exercise — "The model is not the machine"

**Type: (c) assembly property across two targets — the strongest exercise in the set.**

Source (one file, compiled twice):
```cpp
#include <atomic>
std::atomic<int> a;
int  ld_rlx()      { return a.load(std::memory_order_relaxed); }
int  ld_acq()      { return a.load(std::memory_order_acquire); }
void st_rel(int v) { a.store(v, std::memory_order_release); }
void st_sc (int v) { a.store(v); }
int  rmw()         { return a.fetch_add(1, std::memory_order_relaxed); }
```

**Machine check A — x86-64 (`g152`):**
- `ld_rlx` and `ld_acq` bodies are **identical** (both a plain `mov`), and neither contains
  `lock`, `mfence` or `xchg`.
- `st_rel` is a plain `mov`; `st_sc` contains `xchg`.
- `rmw` contains `lock xadd`.

**Machine check B — ARM64 (`arm64gtrunk`), same source:**
- `ld_rlx` contains `ldr` and **not** `ldar`.
- `ld_acq` contains `ldar`.
- `st_rel` contains `stlr`.

(Both transcripts are real; they're reproduced in §4 Bridge D.) The learner is asked to state
why `ld_rlx` and `ld_acq` are the same on x86 and different on ARM, *before* seeing B. The
misprediction is the teaching event.

**Part 2 — the compiler is the other half.** A spin loop:
```cpp
#include <atomic>
extern std::atomic<bool> ready;
void wait() { while (!ready.load(std::memory_order_relaxed)) {} }
```
vs. the same with `acquire`, vs. a non-atomic `extern bool ready;`. Verified live at `-O2`,
GCC 15.2 — all three, in full:

```asm
; relaxed AND acquire — byte-identical
wait():
.L2:    movzx   eax, BYTE PTR ready[rip]
        test    al, al
        je      .L2
        ret

; plain bool
wait():
        ret
```

**Machine check:** assert both atomic versions contain a `movzx` from `ready` **inside** a
backward branch, and assert the plain-`bool` version's body is a single `ret`.

This is a better result than the one students expect. Relaxed and acquire are identical here
(x86 gives acquire for free, and the load can't be hoisted either way because it's atomic) —
but the **non-atomic** version doesn't just get hoisted, GCC *deletes the entire loop*, because
the forward-progress guarantee lets it assume a loop with no side effects terminates. A data
race isn't "you might read a stale value"; it's "your loop may cease to exist." Nothing
persuades like a function body that is one `ret`.

**Part 3 — the joinable destructor.** Program: construct a `std::thread`, don't join.
**Machine check on execution:** `didExecute: true`, non-zero `code`, and `stderr` containing
`terminate called without an active exception`. Verified live (`-O2 -std=c++20 -pthread`,
executor mode): `didExecute: true, code: 139`, `stderr: ["terminate called without an active
exception", "Program terminated with signal: SIGSEGV"]`. Assert on the **stderr string**, not
the exit code — CE's runner reports the abort as 139/SIGSEGV, which is an artefact of the
sandbox. Then swap to `std::jthread` and check `code == 0` (verified). Lifetime rules enforced
at runtime, observed as an exit status.

---

### Unit 7 exercise — "Count it"

**Type: (c) compiler's own optimisation report + assembly property + (b) output.**

**Part 1 — the optimiser reports on itself.** Compile with
`-O3 -march=x86-64-v3 -ffast-math -fopt-info-vec`:
```cpp
struct P { float x, y, z; };
float aos(P* p, int n)     { float s=0; for (int i=0;i<n;i++) s += p[i].x; return s; }
float soa(float* x, int n) { float s=0; for (int i=0;i<n;i++) s += x[i];   return s; }
```
GCC 15.2 emits, as structured diagnostics with line and column:
`line 2, col 48, severity 3: "optimized: loop vectorized using 32 byte vectors"` and the same
for line 3. **Machine check:** assert a vectorisation note exists for *each* loop, then assert
on the assembly that the SoA loop's `ymm` register count exceeds the AoS loop's (the strided
AoS gather is materially worse even when both "vectorize"). Then remove `-ffast-math` and check
that the notes **disappear** — floating-point reassociation is not free, and the compiler will
tell you exactly why with `-fopt-info-vec-missed`.

**This is the one place timing is safe**, because it is single-threaded and memory-bound (see
the caveat above — the ban is on *concurrency* benchmarks). A 1 Mi-element sum measured a clean,
repeatable **5.2×**: `AoS 6.69 ms` touching 64 MiB of cache lines versus `SoA 1.30 ms` touching
4 MiB. Same arithmetic, same element count — the only difference is that AoS drags 64 bytes of
line for every 4 bytes it uses, *and* defeats the stride prefetcher. Show the number; still gate
on the vectorisation notes.

**Part 2 — false sharing, checked as a layout property.**

> ⚠ I tried to build this as a timing exercise and it **does not work on this backend** — see
> the caveat in the backend contract above. Two threads each doing 20 M relaxed `fetch_add`,
> padded vs unpadded, produced `padded=428ms shared=258ms padded2=1739ms` — three runs of the
> *same* configuration disagreeing by 4×, with the "bad" version winning. Don't ship the
> timing version.

What *is* deterministic is the layout, and the layout is the actual lesson:
```cpp
#include <atomic> #include <new>
struct Shared { std::atomic<long> a, b; };
struct Padded {
  alignas(std::hardware_destructive_interference_size) std::atomic<long> a;
  alignas(std::hardware_destructive_interference_size) std::atomic<long> b;
};
static_assert(sizeof(Shared) == 16);
static_assert(sizeof(Padded) == 128);   // verified
static_assert(offsetof(Padded, b) - offsetof(Padded, a) >= 64);
```
**Machine check:** all three `static_assert`s pass (verified), plus `pahole` reports
`cachelines: 1` for `Shared` and `cachelines: 2` for `Padded`, with a cacheline-boundary marker
between the members. Verified `pahole` output:

```
struct Shared {
	struct atomic<long int>    a;                   /*     0     8 */
	struct atomic<long int>    b;                   /*     8     8 */
	/* size: 16, cachelines: 1, members: 2 */
};
struct Padded {
	struct atomic<long int>    a __attribute__((__aligned__(64))); /*     0     8 */

	/* XXX 56 bytes hole, try to pack */

	/* --- cacheline 1 boundary (64 bytes) --- */
	struct atomic<long int>    b __attribute__((__aligned__(64))); /*    64     8 */

	/* size: 128, cachelines: 2, members: 2 */
	/* padding: 56 */
};
```

> **The best moment in the whole curriculum is in that output: `XXX 56 bytes hole, try to
> pack`.** The tool is giving advice that is exactly wrong here. Unit 1 taught the learner to
> eliminate holes; Unit 7 teaches them that this particular 56-byte hole *is the optimisation*.
> Ask them to explain why `pahole` is wrong before you tell them. A learner who can say "the
> tool optimises for size and I am optimising for cache-line exclusivity" has understood both
> units and knows that tools have assumptions.

**The cache line is not 64 bytes everywhere, and the constant is an ABI hazard.** Verified:
x86-64 gives `destructive == constructive == 64` on both GCC 15.2 and clang 21.1; **ARM64 gives
destructive 256**; Apple M-series hardware is 128 (`sysctl hw.cachelinesize`). Worse, Intel's L2
adjacent-line prefetcher works in **128-byte aligned pairs**, so two threads on two *different*
64-byte lines in the same pair can still contend.

And these are `constexpr` values baked into class layouts, which makes them an ABI commitment.
GCC says so itself in the `-Winterference-size` documentation (on by default):

> "all translation units that depend on ABI compatibility for the use of these variables must be
> compiled with the same `-mtune`. **If ABI stability is important, such as if the use is in a
> header for a library, you should probably not use the hardware interference size variables at
> all.**"

Availability is recent, too: libstdc++ shipped them in **GCC 12**, libc++ in **LLVM 19**.
So teach the constant for what it *names*, then teach `alignas(64)` (or 128) as what you
actually ship — a fixed number in your own header that cannot shift under `-mtune` and does not
trip the warning. Have the learner write both and explain why the "portable" one is the riskier
choice in a public header. That inversion is the lesson.

The timing half is the offline companion: `perf stat -e cache-misses` and `perf c2c record` on
a real machine. The layout tool from Unit 1 has become a performance tool — that is the point
of the unit.

**Part 3 — the library/syscall boundary.** The naive version of this (write 200 000 lines to
`std::cout`) gets killed by CE's output cap — verified, `code: 143`. Use a self-timing version
that writes to an `ostringstream` so the program reports its own number and exits cleanly:

```cpp
#include <iostream> #include <sstream> #include <chrono>
int main() {
  std::ostringstream sink;
  auto t0 = std::chrono::steady_clock::now();
  for (int i = 0; i < 200000; i++) sink << i << '\n';        // vs. << std::endl
  auto t1 = std::chrono::steady_clock::now();
  std::cout << std::chrono::duration_cast<std::chrono::microseconds>(t1-t0).count()
            << " us, bytes=" << sink.str().size() << "\n";
}
```
Verified live: `'\n'` → `9348 us, bytes=1288890`; `std::endl` → `16988 us, bytes=1288890`.

**Machine check — the two hard conditions are deterministic:** (i) both versions report
**identical** `bytes=` — `endl` produces no extra output, only extra work; (ii) the `endl`
version's assembly contains `std::basic_ostream<...>::flush` and the `'\n'` version does not
(verified: `flush in asm: True` / `False`). The printed microsecond counts are shown to the
learner as evidence but **must not be a pass condition** (see the caching/timing caveat above);
the ~1.8× gap held here but is not something to gate on.

The learner's write-up must explain that (i) proves `endl` is not "a newline" — it is a
newline *plus a flush*. Then the offline companion: run the `std::cout` version under
`strace -c -e trace=write` and count. Against a stringstream the flush costs a function call;
against a file descriptor it costs a `write(2)` per line, and the ratio explodes. That gap
between the two measurements *is* TLPI ch. 13.

---

## Appendix — reproducing the machine claims

Minimal client used to verify everything above:

```python
import json, urllib.request
def compile(src, comp="g152", args="-O2 -std=c++20", tools=None, execute=False, extra_filters=None):
    f = {"intel": True, "demangle": True, "directives": True,
         "labels": True, "commentOnly": True, "trim": False}
    if extra_filters: f.update(extra_filters)
    body = {"source": src, "compiler": comp,
            "options": {"userArguments": args,
                        "compilerOptions": {"executorRequest": execute},
                        "filters": f, "tools": tools or [], "libraries": []},
            "lang": "c++", "allowStoreCodeDebug": False}
    if execute:
        body["options"]["executeParameters"] = {"args": [], "stdin": ""}
    r = urllib.request.Request(
        f"https://godbolt.org/api/compiler/{comp}/compile",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    return json.load(urllib.request.urlopen(r))

asm  = lambda d: "\n".join(x.get("text","") for x in d.get("asm", []))
errs = lambda d: [x["tag"] for x in d.get("stderr", []) if "tag" in x]
```

Diagnostic `text` fields contain ANSI colour escapes — CE forcibly passes
`-fdiagnostics-color=always`. Two fixes: append **`-fno-diagnostics-color`** (GCC) /
`-fno-color-diagnostics` (clang) to `userArguments`, which comes after CE's flag and wins
(verified clean); or strip with `re.sub(r'\x1b\[[0-9;]*m', '', text)`. Either way, drive checks
off the `tag` objects, never the raw line — `tag.text` is already clean and has the
`<source>:line:col:` prefix removed.

### Compiler flags that dump layout through the API

These turn Units 1 and 4 from "read the assembly and infer" into "read the compiler's own
answer". Both toolchains write to **stdout**, so read `response.stdout`, not `stderr` — except
GCC, which needs an explicit redirect:

```
GCC   -fdump-lang-class=stderr        # class layout + vtables + VTT
GCC   -fdump-lang-class-slim=stderr   # hierarchy only
Clang -Xclang -fdump-record-layouts   # AST + IRgen record layout
Clang -Xclang -fdump-record-layouts-simple   # offsets in BITS, machine-readable
Clang -Xclang -fdump-vtable-layouts   # vtable slots with the address point marked
```

> **`-fdump-class-hierarchy` was renamed to `-fdump-lang-class` in GCC 8** (verified by
> bisecting godbolt compiler IDs: works on g75, `unrecognized command-line option` on g85
> through g162). Any tutorial still using the old name predates 2018.
>
> **The `=stderr` suffix is not optional on GCC.** Without it the dump goes to a *file*
> (`foo.cpp.001l.class`) that a remote CE instance will never hand back to you.

Clang's `-fdump-record-layouts` prints a `DefinitionData` line naming the type's categories
outright — `standard_layout trivially_copyable pod trivial literal pass_in_registers`. That is
the single best teaching artifact in the toolchain: the compiler stating, in words, which of
Unit 1's categories your struct belongs to.

### Provenance and open questions

Everything presented as "verified" was executed against the live Compiler Explorer API during
this research (x86-64 GCC 15.2, clang 21.1.0, ARM64 GCC trunk). The glibc and libstdc++ source
quotations were read from the upstream repositories. Five things to re-check before teaching
them as settled:

1. **`M_TOP_PAD` and the 132 KiB first `brk`.** The man page (128 KiB default) and the glibc
   source (`DEFAULT_TOP_PAD (0)` in every version from 2.23 to master) contradict each other.
   The 132 KiB `[heap]` is empirically real — CE printed exactly `0x21000` — but attributing it
   to `M_TOP_PAD` is almost certainly wrong. Teach it as an observation.
2. **tcache constants are version-dependent.** glibc ≤ 2.41 (every shipping distro today):
   64 bins × 7 entries. glibc master: adds 12 large bins, fill count 16. Always name the version.
3. **`pthread_join` waits on `pd->joinstate`, not `pd->tid`**, on glibc ≥ ~2.32. Most published
   explanations, including well-regarded ones, describe the pre-2.32 mechanism.
4. **seq_cst store encoding varies.** GCC 15.2 emits `xchg` (verified here); older GCC emitted
   `mov`+`mfence`. Both correct. Don't teach one as *the* mapping.
5. **`_Unwind_Find_FDE` lock contention on concurrent throws** was historically a hard
   scalability limit; libgcc has since added a lock-free path. Verify against the libgcc you
   actually ship before claiming it's fixed.

### Primary sources

- [Itanium C++ ABI](https://itanium-cxx-abi.github.io/cxx-abi/abi.html) ·
  [Exception Handling ABI](https://itanium-cxx-abi.github.io/cxx-abi/abi-eh.html) ·
  [Vtable Example](https://itanium-cxx-abi.github.io/cxx-abi/cxx-vtable-ex.html)
- libstdc++: [`libsupc++/new_op.cc`](https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/libsupc%2B%2B/new_op.cc) ·
  [`src/c++11/thread.cc`](https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/src/c%2B%2B11/thread.cc) ·
  [`include/bits/std_mutex.h`](https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/include/bits/std_mutex.h)
- glibc: [`malloc/malloc.c`](https://github.com/bminor/glibc/blob/master/malloc/malloc.c) ·
  [`malloc/arena.c`](https://github.com/bminor/glibc/blob/master/malloc/arena.c) ·
  [`nptl/pthread_create.c`](https://github.com/bminor/glibc/blob/master/nptl/pthread_create.c) ·
  [`nptl/pthread_join_common.c`](https://github.com/bminor/glibc/blob/master/nptl/pthread_join_common.c)
- [Malloc Tunable Parameters (glibc manual)](https://sourceware.org/glibc/manual/2.42/html_node/Malloc-Tunable-Parameters.html) ·
  [mallopt(3)](https://man7.org/linux/man-pages/man3/mallopt.3.html) ·
  [mmap(2)](https://www.man7.org/linux/man-pages/man2/mmap.2.html)
- [P0371R1 — discourage `memory_order_consume`](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2016/p0371r1.html) ·
  [P3475R2 — deprecate it](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p3475r2.pdf) ·
  [Preshing on `consume`](https://preshing.com/20140709/the-purpose-of-memory_order_consume-in-cpp11/)
- [MaskRay — C++ exception handling ABI](https://maskray.me/blog/2020-12-12-c++-exception-handling-abi) ·
  [Eli Bendersky — launching threads with `clone`](https://eli.thegreenplace.net/2018/launching-linux-threads-and-processes-with-clone/)
- [TLPI](https://man7.org/tlpi/) (chapter list, `toc-short.html`) ·
  [archive.org item](https://archive.org/details/The_Linux_Programming_Interface) (page numbers,
  via `_djvu.txt` and the `inside.php` full-text endpoint)
