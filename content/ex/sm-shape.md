## How many threads the register file can hold

Write `resident_threads`, returning how many threads a register file can keep
resident, given its size in bytes and how many registers each thread uses.

A register is four bytes. Every resident thread's registers exist at the same
time, because a warp switch has to cost nothing and so nothing is saved or
restored.

@kind output
@concept The file is a context store rather than a cache, and this division is
the entire reason it is larger than the cache beside it.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Each thread's registers are four bytes each, and they all have to fit at
once.
@diagnose assert verdict assert-failed
A check disagrees. Dividing the file size by the register count alone counts a
register as one byte. Four bytes each is what makes 256 kilobytes hold two
thousand threads rather than eight thousand.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A quarter of a megabyte of registers, larger than the cache next to it,
because graphics needed hundreds of fragments in flight to cover texture
latency.

```starter
unsigned resident_threads(unsigned file_bytes, unsigned regs_per_thread) {
    if (!regs_per_thread) return 0;
    return file_bytes / regs_per_thread;
}
```

```tests
#include <assert.h>
unsigned resident_threads(unsigned, unsigned);
int main(void) {
    /* 256 KB, 32 registers per thread. */
    assert(resident_threads(262144, 32) == 2048);
    assert(resident_threads(262144, 64) == 1024);
    assert(resident_threads(262144, 255) == 257);
    assert(resident_threads(65536, 16) == 1024);
    assert(resident_threads(262144, 0) == 0);
    return 0;
}
```

```solution
unsigned resident_threads(unsigned file_bytes, unsigned regs_per_thread) {
    if (!regs_per_thread) return 0;
    return file_bytes / (regs_per_thread * 4u);
}
```

## Warps resident, and the ceiling above them

Write `resident_warps`, returning how many warps are actually resident, given
how many threads the registers allow, the warp size, and the hardware's own
maximum number of resident warps.

Whichever limit binds first is the answer. A partial warp does not count.

@kind output
@concept Occupancy is a minimum over several independent budgets, which is why
raising one of them alone often changes nothing.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Convert threads to whole warps first, then take the smaller of that and
the hardware ceiling.
@diagnose assert verdict assert-failed
A check disagrees. A register file that would allow a hundred warps does not
give you a hundred if the multiprocessor can only track forty eight, and a
register budget below the ceiling is the case where using fewer registers helps.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why a kernel that spills a few more registers can lose a large
fraction of its performance in one step, rather than gradually.

```starter
unsigned resident_warps(unsigned threads, unsigned warp_size, unsigned max_warps) {
    (void)max_warps;
    if (!warp_size) return 0;
    return threads / warp_size;
}
```

```tests
#include <assert.h>
unsigned resident_warps(unsigned, unsigned, unsigned);
int main(void) {
    /* Registers allow 2048 threads, which is 64 warps, but only 48 fit. */
    assert(resident_warps(2048, 32, 48) == 48);
    /* Registers are the binding limit here. */
    assert(resident_warps(1024, 32, 48) == 32);
    assert(resident_warps(1000, 32, 48) == 31);   /* a partial warp does not count */
    assert(resident_warps(2048, 64, 48) == 32);
    assert(resident_warps(0, 32, 48) == 0);
    return 0;
}
```

```solution
unsigned resident_warps(unsigned threads, unsigned warp_size, unsigned max_warps) {
    if (!warp_size) return 0;
    unsigned w = threads / warp_size;
    return w < max_warps ? w : max_warps;
}
```

## Occupancy, as a number

Write `occupancy_pct`, returning the occupancy as a whole percentage, given the
resident warps and the maximum the hardware could hold.

Truncate towards zero. A maximum of zero has no occupancy to report.

@kind output
@concept It has no equivalent on a general purpose processor, because there
latency hiding is the machine's job and here it is yours.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Multiply before dividing, or every answer below a full one rounds to
nothing.
@diagnose assert verdict assert-failed
A check disagrees. Dividing the warps by the maximum first gives zero for
everything short of full occupancy, which is every interesting case.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Occupancy is the latency hiding budget made visible. It is not a target
in itself: full occupancy with no arithmetic to do is still a slow kernel.

```starter
unsigned occupancy_pct(unsigned resident, unsigned max_warps) {
    if (!max_warps) return 0;
    return (resident / max_warps) * 100u;
}
```

```tests
#include <assert.h>
unsigned occupancy_pct(unsigned, unsigned);
int main(void) {
    assert(occupancy_pct(48, 48) == 100);
    assert(occupancy_pct(24, 48) == 50);
    assert(occupancy_pct(32, 48) == 66);
    assert(occupancy_pct(1, 48) == 2);
    assert(occupancy_pct(0, 48) == 0);
    assert(occupancy_pct(48, 0) == 0);
    return 0;
}
```

```solution
unsigned occupancy_pct(unsigned resident, unsigned max_warps) {
    if (!max_warps) return 0;
    return resident * 100u / max_warps;
}
```

## Both sides of the branch

Write `divergent_cycles`, returning how many cycles a warp spends on a branch,
given the cost of each side and how many lanes take the first side.

When every lane goes the same way, only that side runs. When the lanes disagree,
the hardware runs both sides in turn with the inactive lanes switched off, so
both are paid for in full whatever the split is.

@kind output
@concept The cost of divergence does not depend on the split. One lane going
the other way costs exactly what sixteen do.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint The only question is whether the lanes agree, and there are two ways for
them to agree.
@diagnose assert verdict assert-failed
A check disagrees. A warp where all thirty two lanes take the second side is not
divergent, so it pays for the second side alone. Weighting the two sides by how
many lanes took each is a model of a machine that does not exist.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after This is why the advice is to make neighbouring threads agree rather than
to balance the branch, and that advice came from sorting draws so that
neighbouring pixels agree.

```starter
unsigned divergent_cycles(unsigned cost_a, unsigned cost_b,
                          unsigned lanes_a, unsigned warp_size) {
    return (cost_a * lanes_a + cost_b * (warp_size - lanes_a)) / warp_size;
}
```

```tests
#include <assert.h>
unsigned divergent_cycles(unsigned, unsigned, unsigned, unsigned);
int main(void) {
    /* All lanes take the first side. */
    assert(divergent_cycles(10, 20, 32, 32) == 10);
    /* All lanes take the second. */
    assert(divergent_cycles(10, 20, 0, 32) == 20);
    /* One lane differs: both sides run in full. */
    assert(divergent_cycles(10, 20, 31, 32) == 30);
    assert(divergent_cycles(10, 20, 1, 32) == 30);
    assert(divergent_cycles(10, 20, 16, 32) == 30);
    return 0;
}
```

```solution
unsigned divergent_cycles(unsigned cost_a, unsigned cost_b,
                          unsigned lanes_a, unsigned warp_size) {
    if (lanes_a == warp_size) return cost_a;
    if (lanes_a == 0) return cost_b;
    return cost_a + cost_b;
}
```

## Enough work to cover the wait

Write `warps_to_cover`, returning how many warps must be resident to hide a
memory latency, given the latency in cycles and how many cycles of independent
work each warp can issue before it too has to wait.

The warp that issued the access is one of them. Round up, because a fraction of
a warp does not exist.

@kind output
@concept You cannot make the access faster. The only lever is whether something
else is running while it happens.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Divide and round up, and remember that the waiting warp counts towards the
total.
@diagnose assert verdict assert-failed
A check disagrees. Rounding down leaves part of the latency uncovered, which is
the case where a kernel is a few warps short and stalls anyway. A latency that
divides exactly still needs the warp that is waiting.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after A four hundred cycle access and four cycles of independent work per warp
needs a hundred warps, which is more than a multiprocessor can hold. That is why
arithmetic intensity, and not occupancy alone, is the thing to raise.

```starter
unsigned warps_to_cover(unsigned latency, unsigned work_per_warp) {
    if (!work_per_warp) return 0;
    return latency / work_per_warp;
}
```

```tests
#include <assert.h>
unsigned warps_to_cover(unsigned, unsigned);
int main(void) {
    assert(warps_to_cover(400, 4) == 100);
    assert(warps_to_cover(400, 40) == 10);
    assert(warps_to_cover(400, 30) == 14);   /* rounded up */
    assert(warps_to_cover(0, 4) == 1);       /* the waiting warp still counts */
    assert(warps_to_cover(400, 0) == 0);
    return 0;
}
```

```solution
unsigned warps_to_cover(unsigned latency, unsigned work_per_warp) {
    if (!work_per_warp) return 0;
    unsigned n = (latency + work_per_warp - 1) / work_per_warp;
    return n ? n : 1;
}
```

## Reducing across a warp without memory

Write `shuffle_steps`, returning how many cross lane exchanges a reduction over
a warp takes, given the warp size.

Each step halves the number of lanes still holding a partial result, so the
count is the number of times the width can be halved before reaching one.

A width of one needs no steps at all.

@kind output
@concept The crossbar this uses was built so that a pixel could subtract its
neighbour, and it became a general exchange a decade later.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Count the halvings, not the lanes.
@diagnose assert verdict assert-failed
A check disagrees. A warp of thirty two reduces in five steps rather than
thirty one, because each step halves the survivors rather than removing one.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after The same hardware appears as subgroup operations in the graphics
interfaces, and the block operations came back to compute shaders so a compute
shader can take a derivative.

```starter
unsigned shuffle_steps(unsigned width) {
    return width ? width - 1 : 0;
}
```

```tests
#include <assert.h>
unsigned shuffle_steps(unsigned);
int main(void) {
    assert(shuffle_steps(1) == 0);
    assert(shuffle_steps(2) == 1);
    assert(shuffle_steps(4) == 2);
    assert(shuffle_steps(8) == 3);
    assert(shuffle_steps(32) == 5);
    assert(shuffle_steps(64) == 6);
    assert(shuffle_steps(0) == 0);
    return 0;
}
```

```solution
unsigned shuffle_steps(unsigned width) {
    unsigned n = 0;
    while (width > 1) { width >>= 1; n++; }
    return n;
}
```

## What the scratchpad costs in residency

Write `blocks_resident`, returning how many blocks fit on a multiprocessor,
given the shared memory available, the shared memory each block asks for, and
the hardware's maximum number of blocks.

A block that asks for no shared memory is limited only by the hardware maximum.

@kind output
@concept The scratchpad is a second budget competing with the registers for the
same thing, which is how many warps are resident.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint Two limits again, and one of them does not apply when the request is zero.
@diagnose assert verdict assert-failed
A check disagrees. A block asking for no shared memory is not limited by shared
memory at all, and dividing by zero to find that out is not the way to say so.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after Asking for a little more scratchpad can halve the resident blocks in one
step, which is the same cliff the register budget has and for the same reason.

```starter
unsigned blocks_resident(unsigned smem_total, unsigned smem_per_block,
                         unsigned max_blocks) {
    (void)max_blocks;
    if (!smem_per_block) return 0;
    return smem_total / smem_per_block;
}
```

```tests
#include <assert.h>
unsigned blocks_resident(unsigned, unsigned, unsigned);
int main(void) {
    /* 64 KB of shared memory, 16 KB per block, at most 32 blocks. */
    assert(blocks_resident(65536, 16384, 32) == 4);
    /* One byte more per block and only three fit. */
    assert(blocks_resident(65536, 16385, 32) == 3);
    /* The hardware maximum binds instead. */
    assert(blocks_resident(65536, 1024, 32) == 32);
    /* No shared memory requested. */
    assert(blocks_resident(65536, 0, 32) == 32);
    return 0;
}
```

```solution
unsigned blocks_resident(unsigned smem_total, unsigned smem_per_block,
                         unsigned max_blocks) {
    if (!smem_per_block) return max_blocks;
    unsigned by_smem = smem_total / smem_per_block;
    return by_smem < max_blocks ? by_smem : max_blocks;
}
```

## The transistors that were not spent

Write `hidden_by`, returning which mechanism hides a memory latency on a given
machine, given whether it has many resident threads.

Return 1 when the latency is hidden by having other work resident, and 0 when it
is hidden by reordering a single instruction stream.

A machine with more than a handful of resident threads per core hides latency
with residency, and does not need a reorder buffer, a branch predictor or
speculation at all.

@kind output
@concept The most informative part of the design is what was left out, and why
leaving it out was correct here.
@backend godbolt
@lang c
@flags -O2 -Wall -Wextra
@expect verdict assert-failed
@hint One machine has somewhere else to go when a warp stalls, and the other one
has to invent somewhere.
@diagnose assert verdict assert-failed
A check disagrees. A machine with one or two threads per core has nothing else
to run and must reorder its own stream. A machine with dozens does not, which is
why it deleted the most expensive apparatus a processor has.
@diagnose compile verdict compile-error
Read the line the compiler names.
@after With dozens of warps resident, a predictor and a reorder buffer are
wasted transistors, and the budget went to registers and arithmetic units
instead.

```starter
int hidden_by(unsigned resident_per_core) {
    (void)resident_per_core;
    return 0;
}
```

```tests
#include <assert.h>
int hidden_by(unsigned);
int main(void) {
    assert(hidden_by(48) == 1);
    assert(hidden_by(8) == 1);
    assert(hidden_by(2) == 0);
    assert(hidden_by(1) == 0);
    assert(hidden_by(0) == 0);
    return 0;
}
```

```solution
int hidden_by(unsigned resident_per_core) {
    return resident_per_core > 2;
}
```
