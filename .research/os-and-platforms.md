# Operating Systems & Platforms — the comparative / boot / platform layer

Research note for a hardware curriculum. Assumes Linux userspace and syscall semantics are
being learned separately and deeply (TLPI). This document covers the two things TLPI does
*not*: (a) what happens between power-on and PID 1, and (b) what is actually different
between Linux, Windows NT and macOS/XNU when you look at them as a systems programmer.

Confidence is marked inline. `[verified]` = checked against a primary or near-primary source
this session, cited at the end. `[known]` = standard, well-documented material I am confident
in but did not re-verify. `[uncertain]` = flagged explicitly; do not teach as fact without
checking.

---

## 1. The boot path

### 1.0 The one idea

Boot is a sequence of increasingly capable execution environments, each one loading the next
from storage it can barely address, in a CPU mode that is more restrictive than the one the
kernel eventually wants. Every boot standard is an answer to the same question: *what is the
contract between the thing that loads and the thing that gets loaded?*

### 1.1 x86-64, power-on to PID 1

**Stage 0 — reset.** On power-good the CPU comes out of reset in **16-bit real mode** with
`CS.selector = 0xF000`, `CS.base = 0xFFFF0000`, `IP = 0xFFF0` — so the first fetch is at
physical `0xFFFFFFF0`, sixteen bytes below the top of the 4 GiB space. That is the *reset
vector*; the chipset aliases the top of flash there. The instruction found is almost always a
far jump into the firmware body. `[known — Intel SDM Vol. 3A §9.1.4 "First Instruction
Executed"]`

At this instant: **MMU off** (paging requires protected mode, `CR0.PG` is 0), caches
effectively unusable as memory, and **DRAM does not work yet** — the memory controller has not
been trained. Early firmware therefore runs in **cache-as-RAM (CAR)**: the L2/L3 is put in
no-fill mode so the cache lines act as a tiny scratch RAM. This is why very early firmware is
written in a style with no stack-heavy recursion and often no C at all until CAR is up.
`[known]`

Also early: **microcode update**. The CPU's decoder is patched from a blob in flash before
almost anything else, because errata workarounds and (post-2018) speculative-execution
mitigations live there. `[known]`

**Stage 1 — firmware.** Then memory training (SPD read over I²C/SMBus, DDR PHY calibration),
PCIe enumeration, and the platform's own security chain (Boot Guard / PSP).

Two families:

*Legacy BIOS.* Stays in 16-bit real mode. Exposes services as software interrupts
(`INT 10h` video, `INT 13h` disk, `INT 15h` memory map via `E820`). Reads the first 512-byte
sector of the boot disk (the MBR), checks for `0x55AA` at offset 510, loads it to physical
`0x7C00` and jumps. 446 bytes of code. Everything after that is the bootloader's problem, and
it is why GRUB has a "stage 1.5" wedged into the post-MBR gap. `[known]`

*UEFI.* Fundamentally different: **the firmware itself runs in 64-bit long mode** on x86-64,
with paging enabled but an **identity map** (virtual == physical), a flat segmentation model,
and interrupts largely off. So the MMU is on well before the OS exists, which surprises people
who learned the BIOS story. Key pieces:

- **ESP (EFI System Partition)** — a FAT32 partition, type GUID
  `C12A7328-F81F-11D2-BA4B-00A0C93EC93B`, on a GPT disk. Firmware knows FAT32; that is the
  whole trick. No 512-byte-sector games.
- **Boot applications are PE32+ binaries** — the Windows executable format, on every UEFI
  platform including Linux ones. A UEFI app's entry point is
  `EFI_STATUS efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)`.
- **Boot Services** (`AllocatePool`, `LoadImage`, `GetMemoryMap`, protocol database) exist only
  until `ExitBootServices()`. **Runtime Services** (`GetVariable`, `SetVariable`,
  `GetTime`, `ResetSystem`) survive into the running OS — this is what `efivarfs` on Linux and
  `efibootmgr` talk to.
- **Boot order is in NVRAM variables**, not in a sector: `Boot0000`, `Boot0001`, …, ordered by
  `BootOrder`. This is the single biggest practical difference from MBR booting — "reinstall
  the bootloader" is often really "fix a UEFI variable".
- **Fallback path**: `\EFI\BOOT\BOOTX64.EFI` on the ESP, used when no variable matches. This is
  what makes USB sticks bootable everywhere.
- **Secure Boot**: firmware verifies the PE signature against keys in `db`/`KEK`/`PK`. Linux
  distributions ship **shim**, a small Microsoft-signed loader that carries the distro's own
  key (MOK) and verifies the next stage. `[verified — UEFI spec; standard distro practice]`

**Stage 2 — bootloader.**

- **GRUB2** — a small OS in its own right: its own filesystem drivers, a scripting language, a
  module loader. Reads `grub.cfg`, offers a menu, loads kernel + initramfs, and calls the Linux
  boot protocol.
- **systemd-boot** (formerly gummiboot) — deliberately dumb: it does not parse filesystems
  beyond the ESP's FAT, it just lists `.conf` files in `/loader/entries/` and chainloads EFI
  binaries. It requires the kernel to be readable from the ESP, which is why systemd-boot setups
  put `vmlinuz` on the ESP itself.
- **EFI stub** — a modern Linux kernel built with `CONFIG_EFI_STUB=y` *is itself a valid PE32+
  UEFI application*. The firmware can load `vmlinuz` directly with no bootloader at all. The
  bzImage has two valid headers layered on the same bytes. Unified Kernel Images (UKI) extend
  this: kernel + initramfs + cmdline + stub in one signed PE, so the whole thing is covered by
  Secure Boot. `[known — Documentation/admin-guide/efi-stub.rst]`

**Stage 3 — kernel decompression.** The `bzImage` is: a legacy real-mode setup header, then a
compressed payload plus a small self-relocating **decompressor** (`arch/x86/boot/compressed/`).
The decompressor sets up early identity page tables, may relocate itself (KASLR chooses the
physical/virtual base here), decompresses the actual `vmlinux` ELF image, and jumps to
`startup_64`. Note that the *decompressor* is running in long mode with paging already on —
using its own minimal page tables, not the firmware's. `[known]`

**Stage 4 — kernel init.** `startup_64` → `x86_64_start_kernel` → `start_kernel()`
(architecture-independent). `start_kernel` brings up: the real page allocator, the scheduler,
timers, IRQs, the VFS, then `rest_init()` spawns two threads — PID 1 (`kernel_init`) and PID 2
(`kthreadd`). `kernel_init` mounts the initramfs, runs `/init`, which sets up enough to find and
mount the real root, then `switch_root`s and `exec`s the real `/sbin/init`. That `exec` is the
moment PID 1 becomes systemd, and **PID 1 is the first thing on the machine running in ring 3
with an MMU-enforced address space of its own.** `[known]`

**CPU mode / MMU timeline (x86-64, UEFI path):**

| Point | CPU mode | Paging | Address space |
|---|---|---|---|
| Reset vector | 16-bit real | off | physical, 20-bit-ish via segment base hack |
| Early firmware (CAR) | real → protected → long | off, then on | identity |
| UEFI boot services | 64-bit long | **on**, identity map | flat, 1:1 |
| Bootloader / EFI stub | 64-bit long | on, identity | 1:1, firmware's tables |
| Kernel decompressor | 64-bit long | on, **its own** early tables | identity + relocation |
| `start_kernel` | 64-bit long, ring 0 | on, real kernel tables | kernel half of canonical space |
| PID 1 | 64-bit long, **ring 3** | on, per-process `CR3` | user half, kernel mapped but inaccessible |

The legacy-BIOS path differs by inserting real mode → protected mode → long mode transitions
inside the bootloader/kernel instead of having the firmware do it.

### 1.2 ARM / AArch64 (the generic, non-Apple story)

**Exception levels replace rings.** EL0 = userspace, EL1 = kernel, EL2 = hypervisor,
EL3 = secure monitor. The CPU resets into the **highest implemented EL**, typically EL3.
`[known — ARM ARM]`

Typical server/embedded chain:

1. **BootROM** in on-die mask ROM — mounts nothing, reads a fixed offset of eMMC/SD/SPI.
2. **BL1/BL2 (Trusted Firmware-A)** — DRAM init, loads the rest.
3. **BL31 (TF-A runtime, EL3)** — stays resident forever as the **PSCI** provider. This is how
   Linux turns secondary CPUs on: `SMC` instruction → EL3 → `CPU_ON`. There is no equivalent
   concept on x86 (which uses INIT-SIPI-SIPI IPIs from the kernel itself).
4. **BL33 = U-Boot or EDK2.** U-Boot is the embedded norm; EDK2/UEFI is the norm for
   SystemReady-certified servers and some laptops (yes, UEFI on ARM is real and common in the
   server world).
5. **Kernel**, entered at EL2 (preferred, so KVM can work) or EL1.

**Device tree is the defining difference.** x86 has ACPI and PCI enumeration — the OS can *ask*
the platform what exists. Most ARM SoCs cannot be probed: there is no bus that enumerates the
UART at `0x09000000`. So the hardware description is shipped as a separate compiled data
structure, the **DTB (flattened device tree, FDT)**, and the bootloader hands the kernel a
pointer to it. Linux's AArch64 boot protocol: MMU **off**, D-cache off, I-cache anything,
`x0` = physical address of the DTB, `x1..x3` = 0. `[known — Documentation/arch/arm64/booting.rst]`

Contrast that with x86-64, where the kernel is entered with the MMU **on**. On AArch64 the
kernel enables the MMU itself, very early, setting up `TTBR0_EL1` (user, low addresses) and
`TTBR1_EL1` (kernel, high addresses) — a hardware split of the address space that x86-64 does
not have (x86 uses one `CR3` and a software convention about the canonical hole).

ARM servers that use UEFI use **ACPI instead of DT**, and then look much more like x86.
Practically: DT for embedded and phones, ACPI for servers, and a messy middle.

### 1.3 Apple Silicon

No UEFI at any point. No device tree in the FDT sense. `[verified — Asahi Linux platform docs]`

1. **SecureROM** (on-die, immutable) — verifies and loads the next stage from NOR flash, or
   drops into DFU.
2. **iBoot1 / LLB** — from NOR flash, machine-specific.
3. **iBoot2** — loaded from the *internal SSD*, per-OS. Brings up the on-die coprocessor
   firmwares (SEP, AOP, ANE, display), then loads and verifies a **kernelcache**.
4. **XNU** starts, handed an **ADT (Apple Device Tree)** — Apple's own format, related to the
   old OpenFirmware device tree, *not* the Linux FDT.

Two structural consequences:

- **Boot policy is per-OS-install, stored in the OS's own container**, and can only be changed
  from 1TR (One True Recovery, hold power at boot). "Reduced security" for a given install is
  what permits an unsigned kernel — so a third-party OS never weakens the security of the macOS
  install next to it. This is a genuinely better design than the global Secure Boot on/off
  switch of the PC world.
- **There is no firmware-provided runtime**: no boot services, no runtime services, no
  `GetVariable`. Whatever the OS wants, the OS drives directly.

**Asahi Linux chain** `[verified]`: `[Apple stages] → m1n1 stage 1 → m1n1 stage 2 → U-Boot →
GRUB → Linux`. m1n1 stage 1 is signed with the machine-specific key and installed from recovery;
it chainloads stage 2 from the ESP. Stage 2 does hardware init, **synthesises an FDT from the
ADT** (this is the key translation step), and loads U-Boot, which provides the standard AArch64
preboot environment (and a UEFI-ish interface for GRUB) that Apple's own boot chain does not.

**Teaching point:** three ecosystems, three answers to "how does the OS learn what hardware
exists" — x86 enumerates (ACPI + PCI), embedded ARM is told (DTB), Apple is told in a private
dialect (ADT) that a shim translates.

---

## 2. Kernel architectures compared

### 2.1 Linux — monolithic with loadable modules

One address space for all kernel code. Drivers, filesystems and the network stack run at the
same privilege as the scheduler, calling each other with ordinary function calls. Modules
(`.ko`) are relocatable ELF objects linked into the running kernel by `insmod`; they are not a
different privilege domain, only a different *lifetime*. The stability guarantee is at the
**syscall boundary only** — the in-kernel ABI is explicitly unstable, which is the entire
political argument about out-of-tree drivers.

**A syscall on x86-64, physically.** `[known — Intel SDM; arch/x86/entry/entry_64.S]`

Setup, done once per CPU at boot:

- `IA32_EFER.SCE` = 1 enables the `syscall`/`sysret` instructions.
- `MSR_LSTAR` (`0xC0000082`) = the kernel RIP to jump to — `entry_SYSCALL_64`.
- `MSR_STAR` (`0xC0000081`) = the CS/SS selectors for kernel and for the `sysret` return.
- `MSR_SYSCALL_MASK` / `SFMASK` (`0xC0000084`) = bits cleared from `RFLAGS` on entry (crucially
  `IF`, so interrupts are off for the first instructions, and `DF`, and `TF`).

At the `syscall` instruction the hardware does very little, deliberately: it saves `RIP` into
`RCX` and `RFLAGS` into `R11`, masks `RFLAGS` with `SFMASK`, loads `CS`/`SS` from `STAR`, and
jumps to `LSTAR`. **It does not switch the stack.** `RSP` on the first kernel instruction is
still the user's. That is why the first real instruction is `swapgs` (exchanging `GS_BASE` with
`MSR_KERNEL_GS_BASE`) to get at per-CPU data, from which the kernel stack is then loaded.
With **KPTI/PTI** (Meltdown mitigation) there is an extra step: entry lands on a tiny trampoline
stack in the small always-mapped page-table set, then switches `CR3` to the full kernel tables.

The Linux x86-64 syscall ABI: `rax` = number, args in `rdi, rsi, rdx, r10, r8, r9`, return in
`rax`, `rcx` and `r11` destroyed. **Note `r10` where the C ABI would use `rcx`** — because the
hardware overwrites `RCX` with the return address. This one-register difference between the C
calling convention and the syscall convention is a great, concrete exercise.

Return is `sysretq` (fast, but only valid for canonical addresses and requires the saved
`RCX`/`R11` to be intact) or `iretq` (slow, general, used after `ptrace`, signal handling, or
anything that modified the saved registers).

**AArch64.** `svc #0` raises a synchronous exception to EL1. The CPU jumps to an offset within
the table at `VBAR_EL1` chosen by the exception class and the originating EL/stack pointer;
`ELR_EL1` holds the return address, `SPSR_EL1` the saved state, `ESR_EL1` the syscall's
immediate. Linux AArch64 ABI: `x8` = syscall number, args in `x0..x5`, return in `x0`. Cleaner
than x86-64: the vector table is structured, the stack is chosen by hardware (`SP_EL1`), and
there is no `swapgs` equivalent needed because `TPIDR_EL1` is already a separate register.

### 2.2 Windows NT — hybrid

Layering, bottom to top:

- **HAL** (`hal.dll`) — interrupt controllers, timers, DMA, SMP startup. Historically the
  portability layer; on modern x86-64 it is much thinner than the marketing implied, and parts
  are compiled into `ntoskrnl`.
- **Kernel layer ("Ke")** — the actual microkernel-ish core: thread scheduling, DPCs, APCs,
  spinlocks, interrupt dispatch. Small.
- **Executive** — the big part, subsystem-per-prefix and it is worth memorising the prefixes
  because every NT symbol you will ever read starts with one: `Ob` (object manager), `Mm`
  (memory), `Ps` (process/thread), `Io` (I/O manager), `Cc` (cache), `Se` (security), `Cm`
  (configuration/registry), `Ex` (executive support), `Rtl` (runtime library).
- **`win32k.sys`** — the window manager and GDI, moved *into* the kernel in NT 4.0 for
  performance. This is the "hybrid" part people usually mean, and historically the richest
  source of local privilege escalations.

"Hybrid" is a fair label mostly because NT was *designed* with a microkernel's object model and
subsystem architecture, then had graphics and other services pulled into kernel mode for speed.
The **object manager** is the genuinely distinctive piece: nearly everything (processes,
threads, files, sections, events, mutexes, registry keys, devices) is a named object in a single
hierarchical namespace with a uniform handle/ACL model. Linux has nothing this uniform —
`/proc`, file descriptors, and SysV IPC keys are three unrelated namespaces.

**Win32 vs the NT API.** The NT API is the actual syscall interface, exported from `ntdll.dll`
as `Nt*` (and `Zw*`, the same functions with the previous-mode set to kernel). `kernel32.dll`
/ `kernelbase.dll` implement the documented Win32 API on top of it. `CreateFileW` is a
substantial wrapper around `NtCreateFile`: it translates DOS paths (`C:\x`) into NT object paths
(`\??\C:\x`), converts flag sets, and fills in an `OBJECT_ATTRIBUTES` and a `UNICODE_STRING`.
The Win32 subsystem also has a *server* process, `csrss.exe`, which historically did much more
and now handles console, process/thread bookkeeping, and shutdown.

**Why syscall numbers are unstable.** `[verified]` There is no stable syscall table. The numbers
are indices into the SSDT resolved by `nt!KiSystemCall64`, and they are reordered whenever
functions are added or removed — which happens every feature update, and has historically
happened within service packs. Microsoft's stable ABI is `kernel32`/`ntdll` *as DLLs*, not the
trap numbers. This is a real architectural choice, not an oversight: because every Windows
process is guaranteed to have `ntdll.dll` mapped, the DLL *is* the ABI, and the kernel is free
to renumber. Linux made the opposite choice (numbers are forever; the vDSO is an optimisation,
not the contract), which is exactly why static Linux binaries work across 15 years of kernels
and static Windows binaries are not a thing. Practical consequence: malware and EDR-evasion
tooling extracts numbers from `ntdll` at runtime, and the "syscall number tables by build"
websites exist because there is no API for it.

Mechanically the entry is the same hardware as Linux: `MSR_LSTAR` points at
`nt!KiSystemCall64`, or `nt!KiSystemCall64Shadow` when **KVA Shadow** (Windows' name for KPTI)
is enabled. `[verified]`

**WSL1 vs WSL2 — get this right.** `[verified — Microsoft docs + WSL internals]`

- **WSL1 is not a VM and contains no Linux kernel.** It is a syscall translation layer *inside
  the NT kernel*. `lxss.sys` / `lxcore.sys` implement Linux system calls as NT kernel code, and
  Linux processes run as **pico processes** — a minimal NT process type with an empty address
  space and no `ntdll`, whose traps are routed to a registered *pico provider* (here, lxcore)
  rather than to the normal NT system service table. The ELF binary is loaded by that provider.
  Files live on NTFS, which is where WSL1's notorious I/O slowness comes from (per-file NTFS
  overhead plus metadata emulation), and its incompatibilities come from syscalls and `/proc`
  entries lxcore never implemented. `ptrace`, some `netlink`, some `ioctl`s, and anything
  needing real cgroups were the classic gaps. WSL1 cannot run Docker.
- **WSL2 is a real VM running a real, Microsoft-built, mostly-upstream Linux kernel**, in a
  lightweight Hyper-V "utility VM" (Hyper-V is present as a hypervisor even on Windows Home for
  this). Full syscall compatibility, because the syscalls are being serviced by Linux.
  `/mnt/c` is a 9p (now virtiofs, `[uncertain]` — the transition happened around 2023 and I did
  not verify which is current on which build) network filesystem back to the host, so the
  performance tradeoff *inverts*: Linux-native files in the ext4 VHDX are fast, Windows files
  are slow. WSLg adds a Wayland/RDP bridge for GUI apps.
- Common misstatement to correct: "WSL2 is just a better WSL1", or "WSL1 is a container". WSL1
  is emulation of an ABI; WSL2 is virtualisation. They fail in completely different ways.
- WSL was open-sourced in May 2025 `[verified]`, so the userspace side is now readable source.

### 2.3 macOS / XNU — Mach + BSD + IOKit

XNU = "X is Not Unix". Three codebases in one kernel address space:

- **Mach (`osfmk/`)** — from CMU Mach 3.0 via OSF. Provides: tasks (address space + resource
  container), threads (the schedulable entity), virtual memory (`vm_map`, memory objects,
  pagers), and **ports** (IPC). Mach is a microkernel *design* that in XNU is **not run as a
  microkernel** — the BSD layer is compiled into the same binary and calls Mach functions
  directly, no message passing. Calling XNU "a microkernel" is wrong; calling it "Mach-based"
  is right.
- **BSD (`bsd/`)** — from FreeBSD (with lineage through 4.4BSD/NeXTSTEP). Provides the POSIX
  personality: processes (`proc`, wrapping a Mach task), signals, the VFS, sockets, `fork`,
  users and groups. A macOS process is *both* a BSD `proc` and a Mach `task`, with two
  independent identities (`pid_t` and a task port).
- **IOKit (`iokit/`)** — the driver framework, written in a restricted C++ (`libkern` provides
  a subset: no exceptions, no RTTI, no multiple inheritance, its own `OSObject` root class and
  `OSMetaClass` reflection). Drivers are objects in a registry with a matching/probe/score
  system. Modern macOS pushes drivers to **DriverKit** — user-space drivers, an actual
  microkernel-ish move, and the reason kexts are increasingly restricted.

**What a Mach port is.** A port is a kernel-owned, unidirectional message queue, and — this is
the important part — a **capability**. A task holds *port rights*, not port names: a **receive
right** (exactly one holder; owning it means you are the service), **send rights** (many), and
**send-once rights**. A port name is a per-task integer index into the task's IPC name space,
exactly like a file descriptor is an index into a file table. Rights can be transferred inside
messages, so passing a port right is how you delegate authority. This is a genuinely different
IPC model from Linux's: there is no ambient global namespace to guess at, and the `bootstrap`
port + `launchd` is how a process finds any service at all. `mach_msg` is the single syscall
that does everything; **MIG** (Mach Interface Generator) compiles `.defs` files into the
marshalling stubs, which is why so many XNU symbols look autogenerated.

Mach ports are also how the debugger works, how `task_for_pid` (and thus most of the security
model) works, how exceptions are delivered (an *exception port*, which is why a Mach exception
can be handled by another process before it ever becomes a BSD signal), and how XPC is built.

**Why syscall numbers have a class prefix.** `[verified]` XNU has to route a trap to Mach or to
BSD, and those two number spaces were independent historically. So the top byte of the number in
`rax` is a class: `SYSCALL_CLASS_SHIFT = 24`, `SYSCALL_CLASS_MACH = 1`,
`SYSCALL_CLASS_UNIX = 2` (also `MDEP = 3`, `DIAG = 4`). A BSD call is `0x2000000 | nr` — e.g.
`write` (BSD 4) is `0x2000004`, `execve` (59) is `0x200003B`. Mach traps use class 1 and
**negative** trap numbers in the source tables. `[uncertain — the exact encoding of the negative
Mach trap numbers into `rax` (whether it is `0x1000000 + n` with n negative, i.e. below
`0x1000000`) I did not verify this session; check `osfmk/kern/syscall_sw.c` and
`bsd/dev/x86_64/systemcalls.c` before teaching it.]`
Note also that Apple **does not support raw syscalls as a stable interface** on macOS — libSystem
is the ABI, the way `ntdll` is on Windows. On Apple Silicon this is enforced harder still.

**Rosetta 2.** `[verified — Apple Platform Security guide]` Not an emulator in the interpreting
sense. Primary path is **AOT translation**: the x86-64 Mach-O is translated to AArch64 ahead of
time and the result is cached on disk as a special Mach-O marked as a translation artifact. At
`exec` time the Rosetta runtime IPCs the Rosetta system service asking whether a translation
exists; if so it is mapped and run. A JIT path exists for code that could not be translated
ahead of time (self-modifying code, JITs like a JavaScript engine).

The reason it is fast is partly hardware: x86-64 has **TSO** (total store order) memory ordering
and AArch64 is weakly ordered, so faithful translation would need fences on nearly every memory
access. Apple's cores implement a **TSO mode toggled by a private register**, so translated
processes run with x86 memory semantics in hardware and need no fences. `[verified that the
mechanism exists; the specific register/encoding is undocumented by Apple — treat as
"undocumented implementation detail".]` There is also hardware assistance for x86 flag
semantics. `[uncertain]` This is the honest answer to "why can't QEMU do this" — it is not just
software.

### 2.4 The comparison table

| Dimension | Linux | Windows NT | macOS / XNU |
|---|---|---|---|
| **Kernel shape** | Monolithic + loadable modules; one address space, one privilege level | Hybrid: Ke microkernel core + Executive + HAL, plus `win32k.sys` graphics in kernel | Mach (osfmk) + BSD + IOKit, all co-linked in one address space; "Mach-based", not a microkernel |
| **Stable ABI boundary** | **The syscall table** — numbers are permanent, in-kernel ABI explicitly unstable | **`ntdll.dll` / `kernel32.dll`** — syscall numbers are an unstable implementation detail | **`libSystem.dylib`** — raw syscalls unsupported, especially on Apple Silicon |
| **Process creation** | `fork()`/`clone()` + `execve()`; child inherits by default, COW address space | `CreateProcess` / `NtCreateUserProcess` — build a new process from scratch, explicit inheritance list; no `fork` (POSIX subsystem had one, it's gone) | `fork`+`exec` (BSD) but `posix_spawn` is the preferred path and what `launchd` uses; `fork` is unsafe in a process with Mach/CF state |
| **Process object** | `task_struct`; "process" = thread group (`tgid`) | `EPROCESS` (Executive) + `KPROCESS` (kernel); a container for threads and a handle table, **not** a schedulable entity | BSD `proc` wrapping a Mach `task`; two identities, two APIs |
| **Thread model** | **1:1**. A thread *is* a `task_struct` created by `clone()` with `CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD`. The kernel has no separate thread type — "process vs thread" is a question about which flags were passed | **1:1**. `ETHREAD`/`KTHREAD`; the thread is the scheduling unit and a first-class kernel object with a handle. Fibers are pure user-mode; UMS was removed | **1:1**. The **Mach thread** is the schedulable entity; `pthread`s map onto Mach threads. Plus **GCD/libdispatch** as the idiomatic layer, with kernel support via workqueues |
| **Scheduler** | **EEVDF** since 6.6 (replaced CFS); `SCHED_FIFO`/`RR` realtime classes; **`sched_ext`** since 6.12 lets you write a scheduler in BPF | 32 priority levels: 0 (zero-page thread), 1–15 dynamic, 16–31 realtime (never boosted). Quantum-based with priority boosts for I/O completion, foreground windows, starvation (balance set manager) | Mach priority bands + **QoS classes** (`USER_INTERACTIVE`, `USER_INITIATED`, `DEFAULT`, `UTILITY`, `BACKGROUND`) propagated through GCD; QoS also steers P-core vs E-core placement on Apple Silicon |
| **Memory management** | `mm_struct` + red-black tree/maple tree of `vm_area_struct`; demand paging, COW, THP, reverse mapping via `anon_vma` | `Mm`: VADs (virtual address descriptors), **working sets** per process with a balance-set manager, prototype PTEs for shared pages, standby/modified page lists (the "cache is not free memory" story) | Mach VM: `vm_map` of `vm_map_entry`, backed by **memory objects** served by **pagers** (an abstraction inherited from real Mach, where pagers were user-space). Compressed memory since 10.9; no swap file by default until pressure |
| **Primary IPC** | Pipes, UNIX sockets (with SCM_RIGHTS fd passing), SysV/POSIX IPC, futex, eventfd, **D-Bus in userspace**, io_uring | Named pipes, **ALPC** (the internal RPC transport, undocumented-ish), LPC's successor; COM/RPC on top; window messages; shared sections + events | **Mach ports** and `mach_msg` underneath everything; **XPC** as the modern API; BSD sockets/pipes also present. Ports are capabilities, which is the structural difference |
| **Namespacing/isolation primitive** | Namespaces + cgroups | Job objects, silos (server silos = Windows containers), AppContainer | Sandbox (Seatbelt) profiles, App Sandbox entitlements |
| **Filesystem model** | VFS with `inode`/`dentry`/`file`; single rooted tree, mounts anywhere; **case-sensitive**; permissions are the mode bits + POSIX ACLs | Volume-per-drive-letter over an NT object namespace (`\??\C:`); `IRP`-based layered filter driver stack; NTFS with **ACL-only** security, alternate data streams, case-*preserving* and case-insensitive by default | VFS (BSD) + APFS; **case-insensitive by default** on macOS (a constant source of cross-platform bugs); extended attributes are load-bearing (quarantine, resource forks, code signatures) |
| **Driver model** | In-tree C modules; no stable kernel ABI; `sysfs`/`udev`; increasingly, drivers in userspace via VFIO/uio/FUSE | WDM/**KMDF** kernel drivers with a *stable-ish* ABI; **UMDF** user-mode drivers; layered filter stacks; **all kernel drivers must be WHQL-signed** since Vista x64 | **IOKit** C++ kexts, being deprecated; **DriverKit** dexts run in userspace; kexts require user approval and reduced security on Apple Silicon |
| **Security model** | uid/gid + capabilities(7) + LSMs (SELinux/AppArmor) + seccomp-bpf + namespaces | SIDs, tokens, ACLs on every object, **integrity levels**, UAC, privileges (`SeDebugPrivilege` etc.), Protected Process Light, code integrity (HVCI) | POSIX perms + **SIP** (System Integrity Protection, restricts even root), sandbox profiles, entitlements bound into the code signature, hardened runtime, notarization, and a Secure Enclave holding the keys |
| **Kernel/user split on x86-64** | Ring 0 / ring 3; kernel in the upper canonical half, per-process `CR3`, PTI | Ring 0 / ring 3; same split, KVA Shadow | Ring 0 / ring 3; same |

---

## 3. The layers that matter

### 3.1 Virtual memory — hardware vs kernel, precisely

**What the hardware does, with no kernel involvement:**

- Walks the page tables on a TLB miss. On x86-64 4-level paging: `CR3` → PML4 → PDPT → PD → PT,
  9 bits of virtual address per level, 12 bits of offset: 9+9+9+9+12 = 48. Each table is one
  4 KiB page of 512 8-byte entries. `[known]`
- **5-level paging (LA57)**, enabled by `CR4.LA57`, inserts a PML5 above PML4 and takes linear
  addresses to 57 bits: user address space 128 PiB, physical up to 4 PiB. Available on Ice Lake
  Xeon and later; Linux supports it and by default keeps user allocations below the 47-bit
  boundary unless an `mmap` hint above it is given, precisely so that pointer-tagging code does
  not break. `[verified — Intel 5-Level Paging white paper #335252; Linux
  Documentation/arch/x86/x86_64/5level-paging.rst]`
- Enforces **canonical addressing**: bits above the implemented width must be a sign extension
  of the top implemented bit, which creates the famous "hole" in the middle of the address space
  and is why kernel addresses start with `0xffff`.
- Checks PTE permission bits — Present, R/W, U/S, NX (needs `EFER.NXE`) — and raises **#PF
  (vector 14)** on violation, pushing an error code (bits: P, W/R, U/S, RSVD, I/D, PK, SS, SGX)
  and putting the faulting address in **`CR2`**.
- **Sets the A (accessed) and D (dirty) bits** in PTEs itself. The kernel only ever *clears*
  them. This is the hardware's contribution to page replacement.
- Caches translations in the **TLB**, tagged by **PCID** (x86) / **ASID** (ARM) so a context
  switch need not flush everything. `INVLPG` / `INVPCID` (x86) and `TLBI` (ARM) invalidate.
  Cross-CPU invalidation is *not* automatic on x86: the kernel sends **TLB shootdown IPIs**,
  which is why `munmap` in a heavily threaded process is expensive.
- On AArch64: two base registers, `TTBR0_EL1` (low half, per-process) and `TTBR1_EL1` (high
  half, kernel), so the kernel/user split is architectural rather than conventional. Granule
  sizes 4K/16K/64K are configurable — Apple platforms use **16 KiB** pages, which is a real
  portability surprise if you hardcoded 4096. `[known]`

**What the kernel does, which the hardware knows nothing about:**

- Decides what a fault *means*. The hardware only says "not present, write, user". The kernel
  looks up the `vm_area_struct` and decides among: (a) **demand paging** — allocate a zero page
  or read from the page cache, install a PTE, retry; (b) **copy-on-write** — the VMA is writable
  but the PTE is read-only and the page is shared, so copy it, install a private writable PTE;
  (c) **stack growth**; (d) **swap-in**; (e) **SIGSEGV**.
- Distinguishes **minor** faults (no I/O — page was already in memory, just not mapped for this
  process) from **major** faults (needed disk I/O). `getrusage(2)`'s `ru_minflt`/`ru_majflt` and
  `/proc/self/stat` expose the counts, and the ratio is the single most useful memory metric.
- Implements `mmap`. `MAP_ANONYMOUS|MAP_PRIVATE` = zero-fill on demand; the kernel maps every
  page of a fresh 1 GiB allocation to *the same* shared zero page, read-only, and only allocates
  real frames on first write. This is why `malloc(1<<30)` is instant and free.
- Implements `fork` as: copy the page tables, mark every writable private PTE read-only in both
  processes, bump refcounts. The first write in either process takes a COW fault. `fork` is
  cheap; the *cost is deferred* into faults, which is exactly the thing to measure.
- **Huge pages**: 2 MiB (PD entry with PS bit) and 1 GiB (PDPT entry). One TLB entry instead of
  512 or 262144. `hugetlbfs` = explicitly reserved, guaranteed; **THP** = transparent, the
  kernel promotes on the fly via `khugepaged` and can be steered with `madvise(MADV_HUGEPAGE)`.
  The tradeoff is internal fragmentation and allocation stalls when memory is fragmented.
- Page replacement (active/inactive LRU lists, `kswapd`, reclaim, and now **MGLRU**), writeback,
  and OOM killing.

**The teachable boundary:** the MMU is a fast, dumb tree-walker that raises an exception. Every
interesting behaviour — overcommit, COW, demand paging, mmap'd files, swap — is *the kernel's
interpretation of a fault*. Virtual memory is a hardware trap plus a policy.

### 3.2 Process and thread, per OS

- **Linux**: there is no thread type. `clone()` with `CLONE_THREAD` creates a `task_struct`
  sharing the caller's `mm_struct`, fd table, signal handlers and `tgid`. `getpid()` returns the
  tgid; `gettid()` returns the actual task id. "Process" is a userspace abstraction that the
  kernel supports via the thread-group concept. This uniformity is why containers work — the
  same `clone` flags that make threads also make namespaces.
- **Windows**: process and thread are distinct kernel objects with handles, security descriptors
  and an entry in the object namespace. The thread is scheduled; the process is only a container
  for an address space, a handle table and a token. Creating a thread is a normal, cheap
  operation and is the idiom (there is no `fork`, so the "cheap process" trick does not exist —
  which is why Windows build systems are slow at spawning and why `CreateProcess` takes
  ten arguments).
- **macOS**: `pthread_create` → a Mach thread inside the task. But the idiom is **GCD**: you
  submit blocks to queues and libdispatch manages a thread pool in cooperation with the kernel's
  workqueue mechanism, with QoS propagated from the submitting context. A macOS profile full of
  `dispatch_worker_thread` frames is normal, not a bug.

**Scheduling**, current state:

- Linux: **EEVDF** (Earliest Eligible Virtual Deadline First) merged in **6.6**, replacing CFS
  as the implementation behind `SCHED_NORMAL`. It gives each task a virtual deadline from its
  weight and a request size, picks the eligible task with the earliest deadline, and removes a
  pile of CFS's latency heuristics and tunables. `SCHED_FIFO`/`SCHED_RR`/`SCHED_DEADLINE`
  (EDF+CBS) unchanged above it. **`sched_ext`** landed in **6.12**: a scheduling class whose
  policy is a set of BPF programs, so you can load a scheduler at runtime.
  `[verified — kernel docs + Phoronix; note the `sched_ext` 6.12 date is from a secondary source]`
- Windows: 32 levels, 16–31 realtime and never dynamically adjusted, 0–15 dynamic with boosts
  (I/O completion, foreground, GUI wakeup, and an anti-starvation boost from the balance set
  manager). Quantum length differs between client (short, favours responsiveness) and server
  (long, favours throughput). `[known — Windows Internals]`
- macOS: Mach priority bands, but the API you use is **QoS class**, which the kernel maps to
  priority, timer coalescing, I/O throttling *and* core-type selection on Apple Silicon. A
  `BACKGROUND` QoS thread will be pinned to E-cores. This makes QoS the most consequential
  scheduling API of the three for real performance work on a Mac. `[known]`

### 3.3 System V AMD64 vs Microsoft x64 — the portability trap

Both are x86-64. Both are "the C calling convention". They agree on almost nothing.

| | **System V AMD64** (Linux, macOS, BSD) | **Microsoft x64** (Windows) |
|---|---|---|
| Integer/pointer args | `RDI, RSI, RDX, RCX, R8, R9` (6) | `RCX, RDX, R8, R9` (4) |
| Float/SSE args | `XMM0–XMM7` (8), counted **separately** from integer args | `XMM0–XMM3` — **the same four positional slots**. Arg 3 float uses XMM2 *and burns R8* |
| Further args | Stack, right to left | Stack, right to left |
| **Shadow / home space** | **None** | **32 bytes** always allocated by the caller above the return address, even for 0-arg calls; callee may spill the 4 register args there |
| **Red zone** | **128 bytes** below `RSP`, usable by leaf functions without adjusting `RSP` | **None**. This is a real bug source: SysV kernel code must build with `-mno-red-zone` because interrupts push onto the same stack |
| Integer return | `RAX`; 128-bit in `RDX:RAX` | `RAX` only |
| Float return | `XMM0` (`XMM1` for the second half of some pairs) | `XMM0` |
| **Callee-saved (int)** | `RBX, RBP, R12, R13, R14, R15` (+`RSP`) | `RBX, RBP, **RDI**, **RSI**, R12–R15` (+`RSP`) |
| **Callee-saved (vector)** | **None** — all XMM/YMM/ZMM are caller-saved | **`XMM6–XMM15` are callee-saved** (low 128 bits only) |
| Caller-saved (int) | `RAX, RCX, RDX, RSI, RDI, R8–R11` | `RAX, RCX, RDX, R8–R11` |
| Struct passing | Classified field-by-field into INTEGER/SSE/MEMORY; aggregates ≤16 bytes can go in **two registers**, possibly one int and one XMM | Only sizes **1, 2, 4, 8** go in a register. Anything else is copied by the caller and passed **by hidden pointer** |
| Struct return (large) | Hidden pointer in **`RDI`**, shifting all int args by one; returned again in `RAX` | Hidden pointer in **`RCX`**, shifting args by one; returned again in `RAX` |
| Variadic calls | `AL` = number of vector registers used (needed by the `va_arg` prologue that dumps registers to the register save area) | FP args are placed in **both** the XMM and the corresponding integer register — because the callee has no type information |
| Stack alignment | 16 bytes at the `call` site (so `RSP % 16 == 8` on entry) | Same |
| Frame pointer | `RBP` by convention, omittable | `RBP` by convention; frame pointer rules constrained by unwind data |
| Unwinding | DWARF CFI in `.eh_frame` — data-driven, arbitrary prologues | **SEH**: `.pdata` / `.xdata` `UNWIND_INFO` tables; the **prologue must be one of a restricted set of encodable forms**. This constrains the compiler, not just the metadata |
| Thread pointer | `FS` base (TLS via `%fs:0`) | `GS` base (TEB at `%gs:0x30`) |
| Kernel entry uses | `GS` after `swapgs` | `GS` after `swapgs` |
| **Linux syscall convention** (different from its own C ABI!) | `RAX`=nr, args `RDI, RSI, RDX, **R10**, R8, R9`; `RCX`/`R11` clobbered by the `syscall` instruction | n/a — Windows userspace does not call syscalls directly |

The two highest-value teaching points: **`RDI`/`RSI` swap sides** (caller-saved on Linux,
callee-saved on Windows — hand-written assembly that ports between them and forgets this
produces beautiful intermittent corruption), and **shadow space** (hand-written Windows assembly
that calls a C function without reserving 32 bytes will get its stack scribbled on by the
callee, legitimately).

### 3.4 Dynamic linking

| | **ELF** (Linux) | **PE/COFF** (Windows) | **Mach-O** (macOS) |
|---|---|---|---|
| Loader | `ld.so` / `ld-linux-x86-64.so.2`, path in `PT_INTERP` | The loader is **in `ntdll.dll`** (`LdrpInitialize`) — part of the OS, not a separate file | `dyld`, path in `LC_LOAD_DYLINKER` |
| Symbol resolution | **Flat namespace by default**: the first definition in the search order wins, globally | **Two-level**: every import names *both* the DLL and the symbol/ordinal | **Two-level namespace** since 10.1: an import records the dylib it came from |
| Indirection | **PLT + GOT** | **IAT** (import address table), fully bound at load, no lazy PLT by default | Lazy/`__stubs` + `__got`; modern dyld with **chained fixups** does it eagerly |
| Lazy binding | Yes, via `PLT[0]` → `_dl_runtime_resolve`; disabled by `-Wl,-z,now` (which full RELRO requires) | No (bound at load) | Historically yes; chained fixups (Big Sur+) made binding eager and the format much smaller |
| Interposition | **`LD_PRELOAD`**, plus plain symbol preemption (a definition in the executable beats one in a shared library) | No true equivalent. You patch the **IAT**, or hot-patch prologues (Detours), or inject a DLL | **`DYLD_INSERT_LIBRARIES`**, but blocked for SIP-protected, hardened-runtime, and restricted binaries |
| Versioning | Symbol versioning (`GLIBC_2.34`) in `.gnu.version_*` | DLL name + ordinal; SxS manifests for the ugly cases | Two-level namespace + install names + compatibility versions |
| Position independence | PIC/PIE the default everywhere | ASLR via relocations applied at load | PIE mandatory on arm64 |

**How the PLT/GOT dance actually works** (worth drawing once): a call to `printf` compiles to
`call printf@plt`. `printf@plt` is `jmp *printf@got(%rip)`. On first call that GOT slot still
points at the *next instruction in the PLT stub*, which pushes a relocation index and jumps to
`PLT[0]`, which jumps to `_dl_runtime_resolve`, which looks up the symbol, **writes the real
address into the GOT slot**, and tail-jumps to it. Every later call goes straight through. The
GOT is writable, which is the entire reason `RELRO` exists, and the reason `-Wl,-z,now`
(bind everything at load, then `mprotect` the GOT read-only) is a hardening flag.

**Symbol interposition** is not a hack, it is a consequence of the flat namespace: if the main
executable defines `malloc`, *every* library's call to `malloc` resolves to it, because the
executable is first in the search order. That is why you can override the allocator by just
linking a `malloc.o`, and why `LD_PRELOAD` (which inserts a library *before* everything) works
at all. `dlsym(RTLD_NEXT, "malloc")` is how the interposer reaches the one it shadowed. The
two-level namespaces of Windows and macOS make this deliberately harder — arguably safer,
definitely less fun.

### 3.5 Containers

A container is **a normal process on the host kernel** with three things applied:

1. **Namespaces** — per-process views of a global resource. `mnt` (mount table), `pid` (process
   numbering; the first process in a new pid ns is PID 1 *inside*, and reaping/signal semantics
   change accordingly), `net` (interfaces, routes, iptables, ports — a whole second network
   stack instance), `ipc`, `uts` (hostname), `user` (uid/gid mapping — the one that enables
   rootless containers, because uid 0 inside maps to an unprivileged uid outside), `cgroup`,
   `time`. Created by `clone()`/`unshare()` flags, joined by `setns()`. They are *not* security
   boundaries by themselves.
2. **cgroups v2** — a unified hierarchy of resource controllers (`cpu`, `memory`, `io`, `pids`,
   `hugetlb`, `cpuset`) that account and limit. `memory.max` is enforced by the page allocator
   and reclaim path; exceeding it triggers cgroup-level OOM, which is why containers get killed
   rather than swapping.
3. **Restriction** — dropped capabilities, `seccomp-bpf` syscall filters, an LSM profile, a
   read-only rootfs, `no_new_privs`.

Plus a chroot/pivot_root onto an overlayfs of image layers. That is all a container is.

**Why a container is not a VM, and why it matters for GPUs.** The container shares the host
kernel: the same page tables, the same scheduler, the same drivers, the same syscall table. So:

- You cannot run a Windows container on a Linux kernel, or a kernel module from inside a
  container, or a different kernel version.
- A kernel bug is a **host** compromise, not a guest one. This is the actual security
  difference; gVisor and Kata exist to reintroduce a boundary (a userspace kernel, or a real
  microVM).
- **Devices are host kernel objects.** The GPU driver (`nvidia.ko`) lives in the host kernel; you
  cannot install a driver in an image. But the userspace half — `libcuda.so`,
  `libnvidia-ml.so` — must **exactly match the host driver version**. That version coupling is
  the whole problem the **nvidia-container-toolkit** solves: it runs as an **OCI prestart hook**
  (`nvidia-container-runtime-hook` → `libnvidia-container`) that, at container start, bind-mounts
  the *host's* driver userspace libraries and the device nodes (`/dev/nvidia0`, `/dev/nvidiactl`,
  `/dev/nvidia-uvm`) into the container and sets the cgroup device permissions. Newer setups do
  the same thing declaratively via **CDI** (Container Device Interface). `[verified — NVIDIA
  docs]` The consequence to teach: a CUDA container image contains the CUDA *toolkit*, never the
  driver, and "works on my machine" failures are almost always driver/userspace version skew.

### 3.6 Virtualization, briefly

- **VT-x / AMD-V** add an orthogonal axis to the ring model: **VMX root** (the hypervisor, which
  still has rings 0–3) and **VMX non-root** (the guest, which also has rings 0–3, but where
  privileged operations trap out). The guest kernel genuinely runs in ring 0 — it just exits to
  the hypervisor on configured events. State lives in the **VMCS** (VMCB on AMD); `VMLAUNCH`/
  `VMRESUME` enter the guest, and a **VM exit** returns control with a reason code. Exits are the
  cost model of virtualization; everything in hypervisor engineering is about avoiding them.
- **Second-level address translation** (**EPT** on Intel, **NPT/RVI** on AMD) gives the guest its
  own page tables *and* a second hardware-walked table from guest-physical to host-physical, so
  the hypervisor no longer needs shadow page tables. This is what made virtualization cheap. A
  TLB miss then walks up to 4×4 + 4 = 24 memory accesses in the worst case, which is why huge
  pages matter more in VMs than on bare metal.
- **Type 1 vs type 2 is a marketing distinction more than a technical one.** ESXi and Xen are
  clearly type 1; **KVM** is a Linux kernel module that turns Linux into a type-1 hypervisor
  while Linux remains a general OS; Hyper-V, once enabled, demotes Windows itself into a "root
  partition" guest, which is why WSL2 and Windows containers and VBS all work off the same
  mechanism. macOS's Hypervisor.framework is the same idea exposed as an API.
- **IOMMU** (Intel VT-d, AMD-Vi, ARM SMMU) is the MMU for devices: it translates the addresses a
  device uses for DMA. Two uses: (a) protection — a buggy or malicious device cannot DMA over
  arbitrary host memory (this is the Thunderbolt/DMA-attack defence); (b) **passthrough** —
  assign a real PCIe device to a guest by programming the IOMMU so the guest's physical addresses
  are what the device sees. On Linux that is `vfio-pci`, and the granularity is the **IOMMU
  group**, which is why you sometimes cannot pass through one GPU without also passing through
  the audio function next to it.

---

## 4. Observability, per platform

### Linux

- **`perf`** — the PMU interface plus software events. Hardware counters (cycles, instructions,
  `cache-misses`, `dTLB-load-misses`, `branch-misses`), tracepoints, and sampling profiles.
  `perf stat` for counters, `perf record`/`report` for profiles, `perf trace` as an
  strace-alike. The PMU part needs real hardware access — it does not work in most containers or
  cloud sandboxes.
- **ftrace** — the in-kernel function tracer, driven entirely through `/sys/kernel/tracing`.
  `function_graph` gives you a call graph of the kernel with timings and costs nothing to have
  compiled in. `trace-cmd` is the friendly front end.
- **eBPF** — the one that changed things. A restricted bytecode VM in the kernel with a
  **static verifier** that proves, before load, that a program terminates (bounded loops only),
  touches only memory it is allowed to, and cannot crash the kernel. Programs attach to
  kprobes, tracepoints, uprobes, USDT probes, perf events, sockets, XDP, cgroups and LSM hooks;
  they are JIT-compiled to native code; they communicate with userspace via **maps** and ring
  buffers.

  Why it mattered: before eBPF, custom kernel instrumentation meant either a kernel module (can
  crash the box, needs a compiler and headers on the target) or a fixed set of pre-baked
  tracepoints. eBPF made it *safe to run user-supplied code in the kernel*, so tooling could be
  written once and shipped anywhere, and aggregation could happen **in the kernel** instead of
  by copying millions of events to userspace. `bpftrace` gives you a DTrace-like one-liner
  language on top; `bcc` gives you a Python/C toolkit; libbpf + CO-RE (Compile Once, Run
  Everywhere) uses BTF type information to make one binary work across kernel versions despite
  struct layout changes. eBPF has since escaped observability entirely — Cilium (networking),
  Katran (load balancing), `sched_ext` (scheduling), LSM/BPF (security).

### Windows

- **ETW (Event Tracing for Windows)** — the system-wide backbone, and much older than eBPF.
  Architecture: **providers** (thousands of them, in the kernel and in every Microsoft component,
  each with a GUID and manifest) → **sessions** (kernel-buffered, configured by the controller)
  → **consumers**. It is a *structured event* system rather than a dynamic-instrumentation one:
  you enable existing providers with keyword/level masks, you do not write new probes. Tooling:
  `xperf`/WPR to record, **WPA** (Windows Performance Analyzer) to view, `logman`, `tracelog`,
  PerfView (excellent for .NET, and free).
- **Kernel debugger (WinDbg + KD)** — Windows has a first-class, documented kernel debugging
  story with public symbols from the Microsoft symbol server. This is genuinely better than
  Linux's, and it is how most Windows internals knowledge was obtained.
- **eBPF for Windows** exists (a Microsoft open-source project running eBPF bytecode with a
  userspace verifier, mainly for networking hooks). `[uncertain — I did not verify its maturity
  or current status this session.]`

### macOS

- **DTrace** is present, inherited from Solaris, with the D language and providers (`syscall`,
  `pid`, `profile`, `fbt`). **But SIP restricts it**: the `fbt` and kernel providers, and
  attaching to system/hardened/restricted binaries, are blocked unless SIP is partially
  disabled (`csrutil enable --without dtrace`). So DTrace on macOS is a shadow of DTrace on
  Solaris/FreeBSD, and is best treated as available for your own unsigned binaries only.
  `[known; the exact `csrutil` flag set varies by OS version — `uncertain`]`
- **Instruments** (on top of the `ktrace`/`kperf` kernel facilities) is the real tool: Time
  Profiler, Allocations, System Trace, Points of Interest, Metal/GPU. It is a sampling and
  system-trace profiler with an excellent UI and no scripting story worth the name.
- **`os_signpost` / `os_log`** — the modern structured-logging and interval-marking API, which
  shows up as regions in Instruments. This is the closest thing macOS has to USDT probes, and
  the intended replacement for ad-hoc `printf` tracing.
- Ad-hoc: `sample`, `spindump`, `vmmap`, `heap`, `leaks`, `fs_usage`, `nettop`, `powermetrics`
  (the last is unusually good for per-cluster CPU/GPU power on Apple Silicon).

**Summary of the philosophies:** Linux made it safe to inject code into the kernel (eBPF).
Windows made every component emit structured events and gave you a query language over them
(ETW). macOS gave you an excellent GUI over a closed, curated set of kernel facilities and locks
out the general mechanism. That ordering — programmable / declarative / curated — predicts what
each platform will be pleasant or miserable for.

---

## 5. Curriculum — four units in dependency order

Backend assumption: **Compiler Explorer**. It compiles *and executes* C/C++ on Linux x86-64
(the "Execute the code" checkbox), shows assembly for any pane, supports side-by-side panes and
a diff view, and can target the Microsoft x64 ABI via **MSVC** (Microsoft hosts a CE instance
with real MSVC; the main site runs it under Wine) and via **`x86_64-w64-mingw32-gcc`**.
`[verified — CE/MSVC blog posts]`

Two constraints to design around `[uncertain — I did not test the current sandbox this session]`:

- **Do not rely on hardware PMU counters** (`perf`, `rdpmc`, `perf_event_open`). Sandboxed
  execution environments almost never expose them. Use `clock_gettime(CLOCK_MONOTONIC)` and
  **`getrusage(RUSAGE_SELF).ru_minflt`**, which are cheap, portable and exactly the right signal
  for the memory unit.
- **Do not rely on setting environment variables for the executed program** (so no real
  `LD_PRELOAD`). Every interposition exercise below is designed to work *inside a single
  translation unit*, which is more instructive anyway.
- **Windows-targeted panes should be compile-only.** Diff the assembly; do not try to run it.

Every exercise below is written so that it either **asserts** (fails loudly if the model is
wrong) or **produces a diff** whose expected shape is stated up front. That is what makes them
machine-checkable rather than "look at this".

---

### Unit 1 — The boundary

**The one idea:** *A system call is not a function call. It is a hardware trap with its own
register contract, and on Linux it is the only interface the kernel promises to keep.*

Narrative frame (reading, not exercises): the boot chain from §1, ending at `execve` — because
the last link in "reset vector → firmware → bootloader → kernel → PID 1 → your shell → your
program" is the same trap instruction you are about to write by hand. Cover UEFI vs BIOS, the
ESP, the EFI stub, and the AArch64/Apple contrast as context for *why* the kernel is entered
differently on different machines. Then §2.1–2.3: what a syscall boundary is on each OS, and why
Linux publishes numbers while Windows and macOS publish DLLs.

**Exercises.**

1. **`syscall` by hand, no libc.** Compile with `-nostdlib -static` and your own `_start`.
   Write to fd 1 and exit, using only inline asm.
   ```c
   // gcc -nostdlib -static -O2
   static long sys(long n, long a, long b, long c) {
     long r;
     __asm__ volatile ("syscall"
       : "=a"(r)
       : "a"(n), "D"(a), "S"(b), "d"(c)
       : "rcx", "r11", "memory");   // note the clobbers
     return r;
   }
   void _start(void) {
     sys(1, 1, (long)"hello from ring 3\n", 18);  // write
     sys(60, 0, 0, 0);                            // exit
     __builtin_unreachable();
   }
   ```
   *Check:* it prints. *Then:* remove `"rcx","r11"` from the clobber list, compile at `-O2` with
   surrounding live variables, and find the miscompilation. This teaches the hardware contract
   better than any diagram.

2. **`R10`, not `RCX`.** Use a 4-argument syscall (`pread64`, nr 17). Write one wrapper that
   puts argument 4 in `rcx` and one that puts it in `r10`; run both against a file you created
   with `openat`/`write`. The `rcx` version returns garbage or `-EFAULT`. Explain: the `syscall`
   instruction *overwrites* `RCX` with the return address, so the kernel ABI had to move that
   argument. This is the single clearest demonstration that the syscall ABI ≠ the C ABI.

3. **Where does libc put it?** Compile a normal `write(1, "x", 1)` with `-static -O2` and switch
   the pane to **binary/disassembly** mode. Find the `syscall` instruction inside the libc
   wrapper. Count how many instructions of overhead libc adds (errno handling, cancellation
   points). *Check:* you can state what those extra instructions do.

4. **The initial process stack.** With `-nostdlib`, `_start` receives the stack exactly as the
   kernel's ELF loader built it: `argc` at `[rsp]`, then `argv[]`, a NULL, `envp[]`, a NULL, then
   the auxiliary vector. Write `_start` in asm to pass `rsp` to a C function and print `argc`
   and `argv[0]`, then walk the auxv and print `AT_PAGESZ` (value 6) and `AT_SYSINFO_EHDR`
   (value 33 — the vDSO base). *Check:* `AT_PAGESZ == 4096`. This is the literal handoff from
   kernel to userspace and it closes the boot narrative.

5. **The same call on AArch64** (compile-only). Same source, `aarch64 gcc` pane, using
   `svc #0` with `x8` for the number. Diff the two panes: no `swapgs` concept, no clobbered
   return-address register, number in a dedicated register. Discuss `VBAR_EL1` and exception
   levels versus `MSR_LSTAR` and rings.

---

### Unit 2 — The ABI

**The one idea:** *"The C calling convention" is not one thing. The ABI is a per-platform
contract about registers, stack and ownership, and the compiler will show it to you.*

Depends on Unit 1 (you must already be comfortable reading the register moves around a `call`).

Reading: §3.3, plus the observation that Unit 1's syscall convention was a *third* convention
living on the same machine.

**Exercises.** All of these are "two panes, one diff". Set up: left pane `x86-64 gcc -O1`,
right pane `x64 msvc -O1` (or `x86_64-w64-mingw32-gcc -O1`).

1. **Seven arguments.** `long f(long a,long b,long c,long d,long e,long f_,long g)` returning a
   combination. Expected diff: SysV uses `RDI RSI RDX RCX R8 R9` + one stack slot; MS x64 uses
   `RCX RDX R8 R9` + **three** stack slots, and the caller does `sub rsp, 0x38` where the SysV
   caller does `sub rsp, 0x8`. Have them account for the extra 32 bytes: **shadow space**.

2. **Callee-saved sets.** A function that keeps six values live across an inner call. Expected
   diff: the MSVC version pushes/pops **`RSI` and `RDI`** as callee-saved; the gcc version
   freely clobbers them. *Check:* have them predict, before compiling, which registers appear in
   the prologue.

3. **The red zone.** A leaf function with a small local array, `-O1`. Expected diff: gcc uses
   `-8(%rsp)` etc. with **no `sub rsp`** at all; MSVC always adjusts. Then recompile the gcc pane
   with `-mno-red-zone` and watch the `sub rsp` appear. Explain why every kernel on the planet
   builds with `-mno-red-zone`.

4. **Struct by value.** `struct S { double d; long l; };` (16 bytes) passed and returned by
   value. Expected diff: SysV classifies it as `{SSE, INTEGER}` and passes it in `XMM0` + `RDI`
   and returns it in `XMM0` + `RAX`; MS x64 sees "not 1/2/4/8 bytes", so the **caller copies it
   to the stack and passes a pointer**, and the return uses a hidden pointer in `RCX`. Then try
   `struct T { long a, b; }` and `struct U { long a; }` and find the size cliff on each platform.
   This is the exercise that makes "the ABI is a real thing" land.

5. **Variadic.** `extern int v(int, ...); void g(void){ v(1, 2.5, 3.5); }` Expected diff: SysV
   emits `mov eax, 2` before the call — the count of vector registers used, required by the
   callee's register-save-area prologue. MS x64 puts each double in **both** `XMM` and the
   matching integer register. *Check:* they can explain why each design is necessary given what
   the callee knows.

6. **Break it deliberately.** Write a tiny function in inline asm that reads its first argument
   from `RDI` and clobbers `RSI` without saving. Call it from C. Correct on Linux; compile the
   *same* source in the MSVC pane and read the caller's assembly: the argument went to `RCX` and
   `RSI` was live across the call. *Check:* they can name both bugs from the assembly alone,
   without running anything.

---

### Unit 3 — Virtual memory and the fault

**The one idea:** *Memory is manufactured lazily by the kernel in response to hardware faults.
Allocation is nearly free; the cost is in the faults, and you can count them.*

Depends on Units 1–2 (you will use raw `mmap`, `getrusage` and timing loops).

Reading: §3.1 — split rigorously into "what the MMU does" (walk, check, set A/D, raise #PF, cache
in TLB) and "what the kernel does" (decide what the fault *means*).

**Exercises.** All runnable on CE's Linux executor; all assert.

1. **Allocation is free, touching is not.**
   ```
   mmap 1 GiB PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS
   t0 = now; (mmap itself)                       -> expect microseconds
   read ru_minflt                                 -> baseline
   touch one byte per 4096                        -> time this
   read ru_minflt                                 -> expect delta ~= 262144
   assert(delta > 250000 && delta < 275000);
   assert(mmap_time < touch_time / 100);
   ```
   *The point:* `VSZ` is a promise, `RSS` is a fact. Print both from
   `/proc/self/status` (`VmSize`, `VmRSS`) to confirm.

2. **The second pass.** Touch the same pages again, time it. Expect a large speedup (the PTEs are
   now present; you are measuring cache/TLB, not the kernel). `assert(second < first / 5);`
   Deliberately loose — the exercise is the ratio's existence, not its value.

3. **Copy-on-write is measurable.** Fill 256 MiB. `fork()`. In child A, only *read* every page;
   in child B, *write* one byte per page. Report each child's `ru_minflt`.
   `assert(B_minflt > 60000 && A_minflt < 1000);` Then explain the asymmetry in terms of the #PF
   error code's W/R bit and the kernel's COW handler. This is the single best demonstration of
   "the hardware raises, the kernel interprets".

4. **`fork` is cheap because faults are deferred.** Time `fork()` itself for a 16 MiB process and
   a 1 GiB process. It grows — but sub-linearly and far less than a copy would — because only the
   *page tables* are copied. `assert(fork_1G < 50 * fork_16M);` Discuss what `vfork` and
   `posix_spawn` avoid, and why Windows has no `fork` at all.

5. **Huge pages.** `mmap` 512 MiB aligned to 2 MiB, `madvise(MADV_HUGEPAGE)`, touch every page,
   compare `ru_minflt` against the same code without the `madvise`. If THP is granted the count
   drops by up to 512×. **Report-and-explain rather than assert**, and read
   `/sys/kernel/mm/transparent_hugepage/enabled` first — the sandbox may be set to `never`, in
   which case the *correct* answer is "no change, and here is the file that says why".

6. **TLB reach.** Pointer-chase through a randomly permuted array of pages, with the working set
   swept from 64 KiB to 512 MiB, timing ns/access. Plot mentally: you will see two knees — one
   at the L2/L3 boundary and one where the number of distinct pages exceeds the L2 TLB entry
   count (order 1500–3000 entries on modern cores). Repeat with `MADV_HUGEPAGE` and watch the
   second knee move right by ~512×. *Check:* they can name which knee is the cache and which is
   the TLB, and justify it.

7. **Faults you caused on purpose.** Install a `SIGSEGV` handler with `SA_SIGINFO`, `mprotect` a
   page `PROT_NONE`, touch it, and in the handler read `si_addr` (that is `CR2`, handed to you)
   and `mprotect` it back to `PROT_READ|PROT_WRITE` before returning. It resumes and works.
   *Check:* the program completes. This is user-space demand paging, and it is exactly how GC
   write barriers, `userfaultfd`, and CRIU work.

---

### Unit 4 — Linking, loading, and lying about symbols

**The one idea:** *The target of a call is chosen at run time by a program you can lie to. The
dynamic linker is the last compiler in the pipeline.*

Depends on Unit 2 (you must be able to read a `call` and a `jmp *offset(%rip)`).

Reading: §3.4, then §3.5 as the coda — a container changes the *namespace* the loader searches,
and nothing else. Same kernel, same ABI, same page tables.

**Exercises.**

1. **The PLT, visually.** Compile `int main(){ printf("hi\n"); }` in **binary/disassembly** mode.
   Find `call printf@plt`, then find the stub: `jmp *offset(%rip)`, `push $index`, `jmp PLT[0]`.
   Recompile with `-Wl,-z,now -Wl,-z,relro` and diff. *Check:* they can point at the GOT slot in
   both versions and say what it contains before the first call.

2. **Symbol preemption, no `LD_PRELOAD` needed.** In the *main executable*, define:
   ```c
   #define _GNU_SOURCE
   #include <dlfcn.h>
   static long count;
   void *malloc(size_t n) {
     static void *(*real)(size_t);
     if (!real) real = dlsym(RTLD_NEXT, "malloc");
     count++;
     return real(n);
   }
   ```
   Link with `-ldl`. Call something that allocates internally (`strdup`, `asprintf`, a C++
   `std::string`). `assert(count > 0);` *The point:* nothing preloaded anything. The executable
   is simply first in the flat-namespace search order, so **libc's own internal calls resolve to
   your definition**. `LD_PRELOAD` is the same mechanism with an extra library inserted ahead of
   everything. Discuss the reentrancy trap (`dlsym` may itself allocate).

3. **Who provided this symbol?** Use `dladdr(&malloc, &info)` and print `info.dli_fname` and
   `dli_sname`, both in the plain program and in the interposed one. *Check:* the filename
   changes from `libc.so.6` to your own binary. This makes "the flat namespace" concrete.

4. **The other mechanism.** Same interposition via `-Wl,--wrap=malloc` (define `__wrap_malloc`,
   call `__real_malloc`). Diff the two approaches: `--wrap` is a *link-time* redirect that only
   affects your own translation units and does **not** catch libc's internal calls, while symbol
   preemption is a *load-time* effect that catches everything. *Check:* the `--wrap` counter is
   strictly smaller than the preemption counter for the same program. That difference *is* the
   distinction between static and dynamic linking, in one number.

5. **The Windows contrast** (compile-only, mingw or MSVC pane). Compile the same `printf` call.
   Find `call *__imp_printf(%rip)` — an indirect call through the **IAT**, resolved at load time
   with no lazy-binding dance and no PLT stub, and naming *both* the DLL and the symbol.
   *Check:* they can explain why `LD_PRELOAD` has no direct Windows equivalent, and what you
   would have to patch instead (the IAT entry, or the function prologue).

6. **Off-CE coda, needs a real Linux box.** `unshare -Urn --fork --pid --mount-proc bash`, then
   run the *same unmodified binary* from exercise 2 inside it. It behaves identically — same
   kernel, same syscalls, same ABI, same dynamic linker — but `ip link` shows one interface and
   `ps` shows two processes. Then `cat /proc/self/cgroup` and `ls /proc/self/ns`. *Check:* they
   can state exactly which of the program's observable behaviours changed and which did not, and
   why a GPU would not be visible without the toolkit from §3.5.

---

### Where each platform's material lands

| Unit | Linux | Windows | macOS |
|---|---|---|---|
| 1 Boundary | `syscall`/`MSR_LSTAR`, stable numbers, vDSO | `ntdll` is the ABI; unstable SSDT indices; **WSL1 = translation, WSL2 = VM** | libSystem is the ABI; class-prefixed trap numbers; Rosetta 2 as an ABI story |
| 2 ABI | System V AMD64 | Microsoft x64, shadow space, SEH unwind | System V AMD64 with arm64 variants (arm64 differs from AAPCS64 on varargs `[uncertain — verify against Apple's "Writing ARM64 Code for Apple Platforms"]`) |
| 3 Memory | `vm_area_struct`, THP, minor/major faults | VADs, working sets, standby list | Mach VM, pagers, compressed memory, 16 KiB pages |
| 4 Linking | ELF, flat namespace, `LD_PRELOAD` | PE, two-level, IAT patching | Mach-O, two-level, `DYLD_INSERT_LIBRARIES` + SIP restrictions |

Observability (§4) is not its own unit — thread it through: `getrusage`/`/proc` in Unit 3,
`dladdr`/`LD_DEBUG=bindings` in Unit 4, and a single reading on eBPF vs ETW vs Instruments as the
"how you would find this on a real machine" epilogue.

---

## Sources

Verified this session:

- [Linux EEVDF scheduler documentation](https://docs.kernel.org/scheduler/sched-eevdf.html) —
  EEVDF merged for 6.6, replacing CFS.
- [Phoronix: EEVDF Scheduler Merged For Linux 6.6](https://www.phoronix.com/news/Linux-6.6-EEVDF-Merged)
- [Wikipedia: Completely Fair Scheduler](https://en.wikipedia.org/wiki/Completely_Fair_Scheduler) —
  used only for the `sched_ext` 6.12 date (secondary source).
- [Microsoft: Comparing WSL Versions](https://learn.microsoft.com/en-us/windows/wsl/compare-versions)
- [WSL notes: pico processes, lxss.sys / lxcore.sys](https://jsinkers.github.io/notes/notebooks/comp_sys/20_wsl.html)
- [Microsoft: WSL is now open source (May 2025)](https://blogs.windows.com/windowsdeveloper/2025/05/19/the-windows-subsystem-for-linux-is-now-open-source/)
- [Asahi Linux: Apple Silicon Boot Flow](https://asahilinux.org/docs/fw/boot/)
- [Asahi Linux: Asahi Boot Process](https://asahilinux.org/docs/alt/boot-process-guide/)
- [Asahi Linux: Open OS Platform Interoperability](https://asahilinux.org/docs/platform/open-os-interop/)
- [Asahi Linux: m1n1 / U-Boot](https://asahilinux.org/docs/sw/u-boot/)
- [The life of an XNU unix syscall on amd64](https://gist.github.com/yrp604/23e86dce9ca12bf514ef) —
  `SYSCALL_CLASS_SHIFT = 24`, `MACH = 1`, `UNIX = 2`.
- [John Millikin: UNIX syscalls (macOS class prefixes)](https://john-millikin.com/unix-syscalls)
- [Apple Platform Security: Rosetta 2 on a Mac with Apple silicon](https://support.apple.com/guide/security/rosetta-2-on-a-mac-with-apple-silicon-secebb113be1/web) —
  AOT translation, cached translation artifacts, IPC to the Rosetta service.
- [Analyzing the memory ordering models of the Apple M1](https://www.sciencedirect.com/science/article/pii/S1383762124000390) —
  M1 implements both weak ARM ordering and x86 TSO, selectable.
- [Intel: 5-Level Paging and 5-Level EPT White Paper (335252)](https://kib.kiev.ua/x86docs/Intel/5LP/335252-002.pdf) —
  `CR4.LA57`, 57-bit linear addresses, 128 PiB / 4 PiB.
- [Windows syscalls / KiSystemCall64 and LSTAR](https://n4r1b.netlify.app/posts/2019/03/system-calls-on-windows-x64/)
- [On Windows syscall mechanism and syscall number extraction](https://www.evilsocket.net/2014/02/11/On-Windows-syscall-mechanism-and-syscall-numbers-extraction-methods/) —
  numbers vary by version and service pack, no official API.
- [Syscalls on Windows 11 — KiSystemCall64 vs KiSystemCall64Shadow](https://hammertux.github.io/win-syscall-re)
- [NVIDIA: Enabling GPUs in the Container Runtime Ecosystem](https://developer.nvidia.com/blog/gpu-containers-runtime/)
- [NVIDIA Container Runtime hook (Sarus docs)](https://sarus.readthedocs.io/en/stable/config/nvidia-container-toolkit.html) —
  prestart OCI hook, libnvidia-container, device node + driver library injection.
- [Microsoft C++ blog: Execution and static analysis support for MSVC on Compiler Explorer](https://devblogs.microsoft.com/cppblog/execution-and-static-analysis-support-for-msvc-on-compiler-explorer/)
- [Matt Godbolt: MSVC and CE](https://xania.org/202407/msvc-on-ce) — MSVC under Wine, wineserver
  daemon, no library support for Windows compilers.

Standard references relied on but not re-fetched this session (`[known]` claims):
Intel SDM Vol. 3A (reset state §9.1.4, paging ch. 4, `syscall`/`sysret`, VMX ch. 23–28);
AMD64 Architecture Programmer's Manual; ARM Architecture Reference Manual for A-profile
(exception levels, `VBAR_EL1`, `TTBR0/1_EL1`); UEFI Specification 2.10; the System V AMD64
psABI; Microsoft's "x64 calling convention" and "x64 software conventions" docs; Linux
`Documentation/` (`arch/arm64/booting.rst`, `arch/x86/x86_64/5level-paging.rst`,
`admin-guide/efi-stub.rst`, `scheduler/`, `bpf/`); Windows Internals 7th ed. Parts 1–2;
*Mac OS X and iOS Internals* / Levin's `*OS Internals` vols. 1–2; Drepper, "How To Write Shared
Libraries"; the ELF gABI, Microsoft PE/COFF spec, and Apple's Mach-O reference.

---

## Explicit uncertainty list

Things to verify before teaching, in rough order of how likely I am to be wrong:

1. **XNU Mach trap number encoding.** The class scheme (`class << 24`) is verified, and
   `SYSCALL_CLASS_UNIX = 2` giving `0x2000000 | nr` is verified. The exact `RAX` encoding for
   **Mach traps**, which have negative trap numbers in `osfmk/kern/syscall_sw.c`, I did not
   confirm. Check the source before writing an example.
2. **`sched_ext` merge version (6.12).** From a secondary source only. Verify against the kernel
   changelog.
3. **WSL2's host filesystem transport.** 9p originally; I believe there has been a move to
   virtiofs on recent builds, but I did not confirm which builds or whether it is default.
4. **eBPF for Windows** — exists, but I did not verify its current maturity, scope, or whether it
   is production-supported.
5. **macOS DTrace and SIP** — that SIP restricts DTrace is well established; the precise
   `csrutil enable --without dtrace` syntax and which providers remain usable varies by macOS
   version and I did not check current behaviour.
6. **Apple's TSO register.** That the M-series implements a switchable TSO mode is verified from
   academic analysis; the specific system-register name and encoding are undocumented by Apple.
   Do not teach an encoding.
7. **Rosetta 2 x86-flag hardware assistance.** Widely reported, not verified here.
8. **arm64 Apple ABI divergence from AAPCS64** — Apple differs on variadic arguments and some
   argument-extension rules. Verify against Apple's "Writing ARM64 Code for Apple Platforms"
   before using it in Unit 2.
9. **Compiler Explorer sandbox specifics** — whether `/proc/self/*` is fully populated, whether
   `MADV_HUGEPAGE` is honoured, THP setting, `fork` limits, `mmap` size limits, and whether
   environment variables can be set for the executed program. Every Unit 3 and Unit 4 exercise
   should be run once on CE before it is assigned, and the assertion tolerances tuned.
10. **HAL's current role in Windows.** The "HAL provides portability" story is from the NT 3.x/4
    era; on modern x86-64 much of it is merged into `ntoskrnl` and the picture is muddier than
    the classic diagram. Windows Internals 7th ed. is the source to check.
11. **`win32k.sys`** — still in the kernel, but Microsoft has been progressively splitting and
    restricting it (win32kbase/win32kfull, and per-process win32k filtering). I did not verify
    the current decomposition.
