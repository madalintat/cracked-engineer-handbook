# Algorithms on Real Hardware — Curriculum Research

Audience: a strong SWE who has just finished the memory-hierarchy unit and is about to start writing GPU kernels. They can already read assembly, they know what a cache line is, and they have seen a roofline plot.

Target end state: **can predict which of two algorithms with the same Big-O will be faster on a given machine, and say why in terms of cache lines, branches, and memory traffic; can reach for scan as a primitive rather than an exercise.**

Research date: **September 2026.**

## The framing, and what this unit is not

This is **not** a DSA course. The interview-prep genre is solved, free, and enormous; teaching it here would be a foreign object in a handbook about machines. Every fact in §1 is available in better form in CLRS, and a student who needs it should be sent there.

The claim that makes algorithms belong in a hardware handbook is narrower and sharper:

> **Big-O is a model of a machine that has not existed since about 1980.** It assumes every memory access costs the same, that a comparison costs what an add costs, and that control flow is free. All three assumptions are false by one to three orders of magnitude on any CPU you can buy. The gap between the model and the machine is not noise — it is routinely a factor of 10 to 600, and it is *predictable*. Learning to predict it is the skill.

The unit sits **after** the memory hierarchy because every explanation in it is a cache explanation, and **before** the GPU units because two of its ideas — **arithmetic intensity via tiling** and **prefix sum as the universal parallel primitive** — are the entire intellectual content of the first three CUDA kernels a person writes. If those ideas land here, the GPU units become mechanics rather than revelation.

### Two rules for this document

1. **Every performance number below was measured, or is cited to a source.** Numbers I measured are labelled with the machine. Numbers I could not verify are marked **[unverified]** and no figure is invented to fill a gap.
2. **Ratios travel; absolute times do not.** A ratio measured on one machine tells you the shape of the effect. The absolute milliseconds tell you about that machine's clock and that afternoon's thermal state. Teach ratios.

### The two machines used for measurement

Everything below labelled **[M3]** or **[CE]** was run during this research.

| | **[M3]** | **[CE]** |
|---|---|---|
| Machine | Apple M3, 4 P + 4 E cores | Compiler Explorer executor, x86-64 |
| L1d (P-core) | **128 KiB** (`hw.perflevel0.l1dcachesize`) | **32 KiB** (measured, §2.2) |
| L2 | **16 MiB** shared P-cluster (`hw.perflevel0.l2cachesize`) | **512 KiB** private (measured) |
| L3 | none (system-level cache instead) | ~8–32 MiB (measured) |
| **Cache line** | **128 bytes** (`hw.cachelinesize`) | **64 bytes** |
| RAM | 8 GB LPDDR5 | shared, ~2 vCPU sandbox |
| Compiler | Apple clang 21.0.0, `-O2 -std=c++20` | gcc snapshot, `-O2 -std=c++20` |

**The 64-vs-128-byte cache line difference between these two machines is not an annoyance — it is the single best teaching device in the document.** It makes several ratios move by more than 10x between the two machines in a way that is *exactly* predicted by theory. See §2.7.

---

# 1. The foundation, stated efficiently

This section is the prerequisite, not the point. It exists so §2 has vocabulary. Anyone who already has it should skip to §2.

## 1.1 Asymptotic notation, and what it deliberately throws away

`O(f)` is an upper bound on growth rate, `Ω(f)` a lower bound, `Θ(f)` both. The definitions are about behaviour as `n → ∞`, which is why they are silent about everything a working programmer cares about.

Asymptotic analysis makes four abstractions, and **all four are the subject of §2**:

| Abstraction | The reality |
|---|---|
| **Constants don't matter** | The constant is where the machine lives. A 600x constant (§2.1) does not become irrelevant at any `n` you will ever run. |
| **All memory accesses cost the same** (the *RAM model*, or *unit-cost model*) | An L1 hit is ~1 ns; a DRAM miss is ~100 ns. A 100x spread inside the operation the model prices at 1. |
| **All operations cost the same** | A correctly-predicted branch is free (0 cycles, folded out by the front end). A mispredicted one costs 15–20 cycles. A divide costs 20–40. A comparison and an add are not the same instruction. |
| **The input is adversarial or uniform** | Real inputs are partially sorted, have skewed key distributions, and repeat. Timsort exists entirely because of this. |

The honest framing to give a student: **asymptotic notation is a tool for ruling algorithms out, not for ranking the survivors.** It correctly tells you never to use `O(n²)` sorting on a million elements. It cannot tell you whether quicksort or mergesort will win, and it will actively mislead you about linked lists.

The formal replacement used in §2.3 is the **external-memory / ideal-cache model**, which prices *cache-line transfers* instead of operations. That model gets linked lists, B-trees, and tiling all correct, which is a good argument that it is the better default model for a systems course.

## 1.2 Amortised analysis and the doubling argument

Amortised cost is the average cost per operation over a worst-case *sequence*, with no probability involved. It is not average-case analysis.

**Dynamic array push is O(1) amortised.** The argument, in the form worth memorising:

Start with capacity 1. When full, allocate `2×` capacity, copy, free. Over `n` pushes, the copies happen at sizes 1, 2, 4, …, up to the largest power of two below `n`. Total elements copied:

```
1 + 2 + 4 + ... + 2^k  <  2^(k+1)  ≤  2n
```

So `n` pushes do at most `2n` copies plus `n` writes: `O(n)` total, `O(1)` each. The geometric series is the whole trick — it converges, so the doubling cost is bounded by a constant multiple of the final size.

**The growth factor is a real engineering decision, not a detail:**

| Factor | Who | Trade-off |
|---|---|---|
| **2×** | libstdc++ `std::vector`, Java `ArrayList` (1.5× actually), Go slices (<1024) | Fewest reallocations. But the freed blocks `1+2+…+2^(k-1) = 2^k − 1` are always *just* smaller than the next request, so the allocator can never reuse them — the arena grows monotonically. |
| **1.5×** | MSVC `std::vector`, folly `fbvector` | `1+1.5+2.25 > 3.375` after three steps, so freed blocks *can* be coalesced and reused. Slightly more copying, much better allocator behaviour. |
| **1.25×** | Go slices >1024 elements | Memory-conservative for large slices. |

The lazy-but-correct summary: **any factor > 1 gives O(1) amortised; factors ≤ φ ≈ 1.618 allow memory reuse.** Growing by a *constant* (`+16`) gives `O(n)` amortised — the classic bug.

**Amortised is not the same as worst-case, and that distinction has teeth.** A single push can still take `O(n)`. For a 60 Hz game loop or a hard-real-time control loop, an amortised bound is worthless; you need `reserve()` or a deque. This is the honest reason `std::deque` and chunked arrays exist.

## 1.3 The structures

Priced in both models — the operation model everyone teaches, and the **memory-transfer model** (cache-line transfers, `L` = line size in elements), which is what §2 is about.

| Structure | Lookup | Insert | Memory-transfer behaviour | When it actually wins |
|---|---|---|---|---|
| **Dynamic array** (`vector`) | O(1) index, O(n) search | O(1)* push, O(n) middle | **Perfect.** Sequential scan is `n/L` transfers and the prefetcher predicts every one. | Almost always. This is the default and you should need a reason to leave it. |
| **Linked list** | O(n) | O(1) *given the node* | **Worst possible.** `n` transfers, unprefetchable, plus per-node allocator overhead. | Splicing whole sublists in O(1); intrusive lists inside allocators/schedulers where nodes are embedded in the object anyway; when you must hold a stable reference across mutation. |
| **Hash table** | O(1) expected | O(1) expected | 1 transfer if open-addressed and the probe hits; 2+ dependent misses if chained. | Unordered key→value. See §2.7. |
| **BST (unbalanced)** | O(h), `h` up to `n` | O(h) | One miss per level, fully dependent. | Never, in production. Teaching device only. |
| **Balanced BST** (red-black, AVL) | O(log n) | O(log n) | `log₂ n` dependent misses. For n=10⁶ that's ~20 misses ≈ 2 µs. | Ordered iteration + point updates in memory. `std::map`, kernel schedulers (CFS used a red-black tree). |
| **B-tree** | O(log_B n) | O(log_B n) | **`log_B n` transfers.** `B` chosen so a node = one page/line. For n=10⁶, B=100: 3 transfers. **~7x fewer than a red-black tree.** | Anything on disk (every database). Also in-memory: `absl::btree_map`, Rust `BTreeMap`. See §2.4. |
| **Binary heap** | O(1) min | O(log n) push/pop | Implicit array — no pointers, and the top ~4 levels stay resident. Only the deep levels miss. | Priority queues. `std::priority_queue` is this. |
| **Trie** | O(k), k = key length | O(k) | `k` dependent misses; a 256-way node is 2 KB and mostly empty. | Prefix queries, autocomplete, IP routing (as a compressed/Patricia trie). Memory-hungry; ART (Adaptive Radix Tree) fixes this with variable node sizes. |
| **Union-find** | O(α(n)) ≈ O(1) | O(α(n)) | Two flat arrays, path compression flattens the chains. Genuinely cache-friendly. | Connectivity, Kruskal's MST, ECS entity grouping. |

\* amortised.

**Union-find deserves its own line** because it is the one classical structure whose asymptotic story and hardware story agree. Union by rank plus path compression gives `O(m α(n))` for `m` operations (Tarjan, 1975), where α is the inverse Ackermann function and is ≤ 4 for any `n` that fits in the universe. Both arrays are `int[n]`, contiguous, and path compression *actively improves locality over time* by shortening chains. Almost nothing else in this table does that.

### Graph representations

| | Space | Edge exists? | Iterate neighbours of v | Wins when |
|---|---|---|---|---|
| **Adjacency matrix** | `Θ(V²)` bits | **O(1)**, one bit-test | `O(V)` — must scan the whole row | Dense (`E ≈ V²`), small `V`, or you need bit-parallel set ops (`row_u & row_v` finds common neighbours 64 at a time). |
| **Adjacency list** (`vector<vector<int>>`) | `Θ(V + E)` | `O(deg v)` | `O(deg v)` | Sparse. But the outer vector-of-vectors is `V` separate allocations — `V` pointer chases before you even start. |
| **CSR** (compressed sparse row) | `Θ(V + E)`, two flat arrays | `O(log deg v)` binary search | `O(deg v)`, **fully sequential** | **The right default.** Two arrays: `offsets[V+1]`, `targets[E]`. Neighbours of `v` are `targets[offsets[v] .. offsets[v+1]]` — one contiguous run. This is the format every GPU graph library uses (§3.6) and every sparse-matrix library. |

The crossover is roughly `E ≈ V²/64` for the matrix — because the matrix packs 64 edges per word, it stays competitive far past the naive `E ≈ V²` guess.

**Teach CSR, not vector-of-vectors.** It is the same asymptotics, one allocation instead of `V`, and it is literally the format the GPU units will use. Building it is one counting pass plus one prefix sum — which is a nice early appearance of §3.2's primitive.

## 1.4 The algorithms

### Sorting

**The comparison lower bound.** A comparison sort's execution is a path through a binary decision tree whose leaves are the `n!` possible permutations. A tree with `n!` leaves has depth ≥ `log₂(n!)`, and by Stirling:

```
log₂(n!)  =  n log₂ n − n log₂ e + O(log n)  ≈  n log₂ n − 1.44 n
```

So `Ω(n log n)` comparisons, and the constant is exactly 1. Mergesort achieves `n log₂ n − n + 1` comparisons — **within 0.44n of optimal.** That is a genuinely tight bound, and worth showing, because it is one of the very few places in algorithms where theory and practice meet exactly.

The bound applies **only to comparison sorts**. Radix and counting sort read the *representation* of the key, not just its order, and escape it entirely.

| Sort | Time | Space | Stable | The hardware fact |
|---|---|---|---|---|
| **Quicksort** | `O(n log n)` avg, `O(n²)` worst | `O(log n)` stack | No | **In place.** Partition is two sequential streams. One unpredictable branch per element (§2.5, §2.6). |
| **Mergesort** | `O(n log n)` always | **`O(n)`** | Yes | Every element crosses the bus `2 log n` times through a second buffer. Predictable branches, but 2x the traffic. |
| **Heapsort** | `O(n log n)` always | `O(1)` | No | In place, but **sift-down jumps by `2i+1`** — the access pattern is a scaled walk that defeats prefetch. Reliably the slowest of the three despite the best bound. |
| **Introsort** | `O(n log n)` always | `O(log n)` | No | Quicksort, switching to heapsort past depth `2 log n`, insertion sort below ~16. **This is `std::sort`.** (Musser, 1997.) |
| **Timsort** | `O(n log n)`, **`O(n)` on sorted input** | `O(n)` | Yes | Finds existing runs and merges them. Python's `list.sort`, Java's `Arrays.sort` for objects. Exploits the fact that real data is usually partly ordered. |
| **pdqsort** | `O(n log n)` | `O(log n)` | No | Introsort + **branchless partitioning** + pattern detection. Rust's `sort_unstable`, Boost. See §2.5. |
| **Counting sort** | `Θ(n + k)` | `Θ(k)` | Yes | One histogram pass + one scatter. The scatter is random writes — that is the bottleneck. |
| **Radix sort (LSD)** | `Θ(d(n + k))` | `Θ(n + k)` | Yes | `d` passes of counting sort. **Measured 3.41x faster than `std::sort` on 4M 32-bit ints [CE]** (§2.5). Basis of all GPU sorting (§3.4). |

### Searching, graphs, DP

| Algorithm | Complexity | Note worth keeping |
|---|---|---|
| **Binary search** | `O(log n)` | `log n` **dependent, unpredictable** misses. The worst-behaved `O(log n)` in the canon. See §2.6. |
| **BFS** | `O(V + E)` | Queue-based; the frontier is the parallel unit (§3.6). |
| **DFS** | `O(V + E)` | Recursion or explicit stack. Basis of topological sort, SCC (Tarjan), cycle detection. |
| **Topological sort** | `O(V + E)` | Kahn's (repeatedly pop in-degree-0) or DFS post-order reversed. Kahn's parallelises by level; DFS does not. |
| **Dijkstra** | `O((V+E) log V)` binary heap | Fibonacci heap gives `O(E + V log V)` — **and loses in practice.** The constants and the pointer-chasing node structure eat the asymptotic win. The canonical example of the whole thesis of this document. |
| **A\*** | `O(E)` with a good heuristic | Dijkstra with `f = g + h`. Admissible `h` ⟹ optimal; consistent `h` ⟹ no re-expansion. (Hart, Nilsson & Raphael, 1968.) |
| **Dynamic programming** | varies | Two forms: memoised recursion (pointer-chasing a hash map, cache-hostile) and bottom-up table fill (**a sequential scan over an array — cache-perfect**). The bottom-up form is routinely several times faster for identical asymptotics, and it is the form that vectorises. |
| **Union-find** | `O(m α(n))` | See §1.3. |

**The DP note is the sleeper.** "Memoise your recursion" and "fill a table bottom-up" are presented as equivalent in every course. They are the same asymptotics and completely different programs: one is `n` hash lookups with dependent misses, the other is a linear scan a compiler can vectorise. If a student takes one thing from §1 into §2, this is a good candidate.

---

# 2. The point: where Big-O lies

Everything above is setup. This section is the unit.

## 2.1 Linked list vs vector: same O(n), measured 12x–637x apart

The textbook says traversing a linked list and traversing an array are both `Θ(n)`. Here is the measurement.

**The benchmark is designed to isolate the real variable.** All three cases sum `n` 64-bit integers. Crucially, **both linked lists use the same `std::vector<Node>` pool with identical allocation** — the only thing that changes is the *order the `next` pointers link them in*. That control removes "linked lists allocate badly" as a confound and leaves exactly one variable: **the order in which addresses are visited.**

**[M3], `-O2`, best of 3, total elements touched held constant at 2²⁴:**

| n | `vector` scan | list, **pool order** | list, **shuffled order** | shuffled ÷ vector |
|---:|---:|---:|---:|---:|
| 4,096 | 1.60 ms | 5.24 ms | 19.6 ms | **12.3x** |
| 65,536 | 1.27 ms | 9.43 ms | 100.5 ms | **79.3x** |
| 1,048,576 | 1.89 ms | 8.19 ms | 714.0 ms | **377x** |
| 8,388,608 | 2.83 ms | 6.59 ms | 1800.3 ms | **637x** |

**[CE] x86-64, n = 2²¹, single pass, shuffled: `140.4x`** (`vector` 1.84 ms vs list 258.5 ms).

### Reading the table — three separate lessons, and the middle column is the important one

**1. The ratio grows with `n`, without bound, at fixed asymptotics.** 12x → 637x. There is no crossover point where the linked list catches up; the gap *widens*. This is the cleanest possible refutation of "constants stop mattering for large n" — here the constant *is a function of n*, because it tracks which level of the hierarchy you have fallen out of.

**2. The middle column is the whole explanation.** A linked list traversed in pool order costs only 2–6x a vector, *and that ratio does not grow*. Same structure, same pointers, same `O(n)`, same allocations — 100x apart from the shuffled case. So the cost is **not** "linked lists are slow." It is:

> **Sequential access is prefetchable and pointer-chasing is a dependent load chain.** The hardware prefetcher watches the stream of addresses. A `+8` stride is trivially predictable, so the next line is already in flight before you ask. A shuffled `next` pointer is *unpredictable by construction* — and worse, the address of load `i+1` is the *result* of load `i`, so the CPU cannot even issue them in parallel. Every miss is fully exposed.

That is the difference between **bandwidth-bound** (many misses in flight, cost amortised across ~10–12 outstanding line-fill buffers) and **latency-bound** (one miss at a time, full DRAM latency serialised, `n` times).

**3. The arithmetic checks out exactly.** At `n = 2²³` on M3, DRAM latency is ~103 ns (measured, §2.2) and the vector scan runs at ~1 element per 0.34 ns. Ratio ≈ 300. Measured 637x — the extra factor comes from the second dependent load (`p->v` after `p->next` lands, though they share a line) plus TLB misses: 8M nodes × 16 B = 128 MB, which at 16 KiB pages is 8192 pages, far past any L2 TLB. **At this size you are paying a page-walk on most accesses too.** Worth mentioning; it is the reason huge pages exist.

### The practical rule

> A linked list is the right structure when you need **O(1) splice of a sublist** or a **stable reference across mutation**, and never because "insertion is O(1)." Insertion is O(1) *given the node*, and finding the node is O(n) of the worst kind of O(n) in computing.

Bjarne Stroustrup has made this point for over a decade with the "insert into a sorted sequence" demo: even for a workload with `n/2` expected element moves per insert (which `vector` pays and `list` does not), `vector` wins for essentially all `n`, because `memmove` at 30 GB/s beats `n/2` dependent cache misses. Chandler Carruth's CppCon 2014 talk *"Efficiency with Algorithms, Performance with Data Structures"* is the canonical presentation of the same argument.

**Source note:** the 12x–637x figures are mine, measured as described. The often-quoted "10–50x" range in the folklore is consistent with the *small-n* end of my table and with the pool-order case; the high end of my range comes from letting `n` grow past L2, which most demonstrations don't do.

## 2.2 The latency numbers, measured

Jeff Dean's "Latency Numbers Every Programmer Should Know" is the canonical list, and most reproductions of it are 15 years stale or have unit errors (I fetched one during this research that reported main memory as 100,000 ns). So: **here are numbers I measured, by pointer-chasing a random cycle** — the standard technique, since a random cycle defeats both the prefetcher and memory-level parallelism, exposing true load-to-use latency.

**[M3], 128-byte stride:**

| Working set | ns/access | What it reveals |
|---:|---:|---|
| 8 KiB | 1.10 | |
| 16–64 KiB | 1.10–1.11 | |
| **128 KiB** | **1.12** | ← last L1d-resident size. `hw.perflevel0.l1dcachesize` = **131072**. ✅ |
| 256 KiB | 4.77 | **L1 knee** |
| 512 KiB – 4 MiB | 6.12–6.68 | L2 |
| 8 MiB | 10.44 | L2, nearing capacity |
| **16 MiB** | **103.34** | **L2 knee.** `hw.perflevel0.l2cachesize` = **16777216**. ✅ |
| 32–128 MiB | 100.5–107.2 | DRAM |

**[CE] x86-64, 64-byte stride:**

| Working set | ns/access | |
|---:|---:|---|
| 8–32 KiB | 1.90–1.94 | L1d = **32 KiB** |
| 64–512 KiB | 5.00–6.47 | L2 = **512 KiB** |
| 1–8 MiB | 13.45–34.62 | L3 |
| 16–32 MiB | 159.7–240.9 | DRAM |

**This is the single best exercise in the unit.** The knees fall *exactly* on the values `sysctl` reports. A student runs a 20-line program and reads their own cache hierarchy out of a table of timings, with no documentation and no privileged access. It converts the memory-hierarchy unit from something they were told into something they measured.

### The ratio table

Normalised to an L1 hit, from the measurements above plus cited figures for storage and network:

| Level | Latency | **Ratio to L1** | Source |
|---|---:|---:|---|
| L1d hit | ~1 ns | **1** | measured [M3] 1.10, [CE] 1.94 |
| L2 hit | ~5–7 ns | **~5** | measured |
| L3 hit | ~15–35 ns | **~20** | measured [CE] |
| DRAM | ~100 ns | **~100** | measured [M3] 103, [CE] 160–240 (loaded shared host) |
| Branch mispredict | ~15–20 cycles ≈ 4–6 ns | ~5 | not directly measured; see §2.6 |
| NVMe SSD random 4K read | ~20–100 µs | **~50,000** | vendor datasheets **[unverified — not measured here]** |
| Same-datacenter RTT | ~0.5 ms | **~500,000** | Dean's figure, still approximately right |
| SATA SSD random read | ~100 µs | ~100,000 | **[unverified]** |
| HDD seek | ~5–10 ms | **~5,000,000** | **[unverified]** |
| CA ↔ Netherlands RTT | ~150 ms | **~150,000,000** | speed of light in fibre; ~9,000 km each way |

**The shape to memorise, not the digits:**

```
L1  :  L2  :  L3  : DRAM :  SSD   : network(DC) : disk seek : intercontinental
 1  :   5  :  20  : 100  : 50,000 :   500,000   : 5,000,000 :   150,000,000
```

**Each of the big gaps is a design boundary in real systems.** The DRAM→SSD gap of ~500x is why B-trees exist (§2.4). The DRAM cliff at 100x is why tiling exists (§2.3). The L1→DRAM 100x is why §2.1's table looks the way it does. And the one thing that has *not* changed since 2010 is the ratios — clocks stopped improving, and DRAM latency has been ~70–100 ns for over fifteen years while bandwidth went up 20x. **Latency is the quantity that stopped improving; every technique in this document is a way of trading it for bandwidth.**

## 2.3 Cache-oblivious and cache-aware algorithms

### The ideal-cache model

Frigo, Leiserson, Prokop and Ramachandran (FOCS 1999) proposed pricing algorithms by **memory transfers** instead of operations. The model: a processor with `Z` words of fully-associative cache, in lines of `L` words, with optimal replacement. Cost `Q(n; Z, L)` = number of line transfers.

Two flavours:

- **Cache-aware (blocked/tiled):** the code knows `Z` and `L` and is parameterised by them. Optimal, but needs tuning per machine and per cache level.
- **Cache-oblivious:** the code never mentions `Z` or `L`, yet achieves asymptotically optimal `Q` **at every level of the hierarchy simultaneously**. Achieved by *recursive halving*: as the recursion descends, subproblem sizes pass through every scale, so at *some* level of recursion the subproblem fits in *whatever* cache you have.

The model assumes a **tall cache**: `Z = Ω(L²)`. Real caches satisfy this comfortably (M3 L1: `Z` = 128 KiB, `L` = 128 B, `L²` = 16 KiB ✓).

### Cache-oblivious matrix transpose

Naive transpose `B[j][i] = A[i][j]` has one loop striding by `n` — every access a new line, `Q = Θ(mn)`.

Recursive: split the *longer* dimension in half, recurse, base case a single element. When a subproblem's two blocks both fit in cache, the rest of that subtree costs nothing extra. Result: **`Q = Θ(1 + mn/L)`** — optimal, and the code never mentions `L`.

```
transpose(A, B):
    if small: copy directly
    else if rows > cols: split rows in half, recurse on both
    else:                split cols in half, recurse on both
```

The cache-aware equivalent is to tile by `L`-sized blocks. Same performance, one tuning parameter, and it stops being optimal on a machine with different line sizes.

### The van Emde Boas layout

The layout analogue of the same recursive idea. To store a complete binary tree of height `h` in an array: split at height `h/2`, store the top subtree of size `√n` contiguously, then each of the `√n` bottom subtrees of size `√n` contiguously after it.

A root-to-leaf search then costs **`O(log_L n)`** transfers instead of `O(log n)`, cache-obliviously — because at some level of the recursion the subtrees have size ~`L` and each contributes one transfer. This is the same bound a B-tree achieves *with* knowledge of `L`. Same idea, one level up: **recursive layout gets you B-tree behaviour without knowing the page size.**

(In practice, Khuong & Morin (2015) measured that the simpler **Eytzinger** layout usually beats van Emde Boas for search — §2.6. The theory says vEB, the machine says Eytzinger, and the reason is prefetching. A good moment to teach humility about models.)

### Tiled matrix multiply and arithmetic intensity — **the link to the GPU units**

This is the most important subsection in the document for what comes next.

**Naive `ijk` matmul is `Θ(n³)` transfers**, because the inner loop over `k` strides `B` by `n` — a new cache line every iteration, and the `B` column is evicted before the next `i` reuses it.

**Blocked matmul** with tile size `T` chosen so three `T×T` tiles fit in cache (`3T² ≤ Z`, i.e. `T ≤ √(Z/3)`) gives:

```
Q(n) = Θ( n³ / (L √Z) )
```

which Hong & Kung (1981) proved optimal. A factor of `L√Z` fewer transfers than naive — on M3's L1 (`Z`=16384 doubles, `L`=16 doubles) that is a theoretical `16 × 128 = 2048x` reduction in traffic.

**Now state it as arithmetic intensity, and the GPU units are pre-taught.** For one `T×T×T` tile update:

- **Work:** `2T³` flops.
- **Traffic:** three `T×T` float tiles = `3T² × 4` bytes.
- **Arithmetic intensity:** `AI = 2T³ / (12T²) = T/6` flops per byte.

> **Arithmetic intensity is linear in tile size.** Bigger tiles ⟹ more flops per byte moved ⟹ further right on the roofline ⟹ compute-bound instead of memory-bound. And tile size is capped by the size of the fast memory: `T ≤ √(Z/3)`.

**That sentence is, verbatim, the design rule for a CUDA shared-memory matmul kernel.** `Z` becomes 48–228 KB of shared memory per SM instead of 32 KB of L1; `L` becomes a 128-byte coalesced transaction instead of a cache line; the tile becomes a `__shared__` array staged by the thread block. **The algorithm is identical. Only the names of the constants change.** A student who derives `AI = T/6` here does not need to be taught tiling again in the CUDA unit — they need to be told the new values of `Z` and `L`.

**Measured [M3], n=1024, single-threaded, `-O2`:**

| Version | Time | GFLOP/s | vs naive |
|---|---:|---:|---:|
| naive `ijk` | 1170.5 ms | 1.83 | 1.00x |
| loop-interchanged `ikj` | 72.7 ms | 29.53 | **16.1x** |
| tiled, T=64 | 57.4 ms | 37.39 | **20.4x** |

**Measured [CE] x86-64, n=1024:**

| Version | Time | GFLOP/s | vs naive |
|---|---:|---:|---:|
| naive `ijk` | 1649.3 ms | 1.30 | 1.00x |
| `ikj` | 241.8 ms | 8.88 | **6.8x** |
| tiled, T=64 | 207.5 ms | 10.35 | **8.0x** |

**Two things to draw out of this table.**

First, **loop interchange alone gets most of the win.** Swapping `j` and `k` so that both `B` and `C` are accessed sequentially in the inner loop buys 6.8x–16x, before any tiling. It is a one-line change with zero added complexity, and it also unlocks auto-vectorisation (the `ikj` inner loop is a scalar-times-vector FMA over contiguous memory). Tiling adds only another 1.2x on top at `n=1024`. **The lazy version of this optimisation is 85% of the win** — and that is worth saying, because most treatments present tiling as the point and skip the free part.

Second, **the ratio depends on `n` relative to cache.** At `n=512` on [CE] the same code gives only 3.5x/3.6x, because a 512×512 float matrix is 1 MB and three of them nearly fit in L3. **Tiling's benefit only appears once the problem outgrows the cache** — which is exactly what the ideal-cache model predicts, and a good reason to make students run both sizes.

## 2.4 B-trees exist because a disk page is 4 KB

The argument from device physics, in four steps:

1. **A rotating disk cannot read one byte.** The minimum unit is a sector (512 B, now 4 KB); the OS's minimum unit is a page (4 KB); an SSD's minimum program unit is a page (4–16 KB) and its minimum erase unit is a block (often several MB). **Reading 4 KB costs the same as reading 4 bytes.** The seek dominates completely: ~100 µs of latency to deliver data at ~1 µs per 4 KB.

2. **So the cost model is "number of pages touched", not "number of comparisons."** Under that model, a red-black tree over 10⁶ keys costs ~20 page reads ≈ 2 ms. That is a catastrophe.

3. **So make the node as large as the transfer unit.** A 4 KB node holding 8-byte keys and 8-byte child pointers fits `B ≈ 4096/16 = 256` children. Depth becomes `log₂₅₆(10⁶) ≈ 2.5` — call it **3 page reads** instead of 20. **~7x fewer I/Os**, from nothing but choosing the node size to match the device.

4. **The generalisation is the real lesson.** `B` is not 256 because 256 is a nice number. **`B` = (transfer unit) ÷ (entry size).** Change the device, and `B` changes:

| Where the tree lives | Transfer unit | Typical `B` | Depth for n=10⁹ |
|---|---|---:|---:|
| Spinning disk / SSD page | 4 KB | ~250 | 4 |
| **In-memory, cache line** | **64 B** (x86) | **~8–16** | **~8** |
| **In-memory, cache line** | **128 B** (Apple Silicon) | **~16–32** | **~6** |
| GPU global memory | 128 B transaction | ~16–32 | ~6 |

**The in-memory row is why `absl::btree_map` and Rust's `BTreeMap` exist and beat `std::map`.** They are B-trees with `B` tuned to the *cache line*, not the page. Same derivation, one constant changed. Google reports `absl::btree_map` using substantially less memory than `std::map` (one allocation per ~64 elements instead of one per element) and being faster for iteration and lookup **[the direction is well-established; I did not measure specific factors]**.

**The counter-move worth mentioning: LSM-trees.** B-trees do in-place updates, so every write is a random 4 KB page write. On flash that means read-modify-write of a page inside a multi-megabyte erase block. LSM-trees (LevelDB, RocksDB, Cassandra) instead buffer writes in memory and flush **sorted, sequential** runs, paying background compaction to keep read amplification bounded. **Same data, same queries, opposite structure — because the device's write physics differs from its read physics.** This is the cleanest available example of "the algorithm is a function of the hardware," and it belongs in the same breath as the B-tree derivation. (It is also the natural hand-off to the queued `storage-filesystems-engines` unit.)

(B-trees: Bayer & McCreight, *Acta Informatica* 1972.)

## 2.5 Why quicksort beats mergesort in practice

Mergesort has the better bound: `O(n log n)` **always**, versus quicksort's `O(n²)` worst case. It is also stable. And it loses.

**Measured [CE], 4,194,304 random 32-bit ints:**

| | Time | |
|---|---:|---|
| `std::sort` (introsort, in-place) | **413.8 ms** | |
| `std::stable_sort` (mergesort + `O(n)` buffer) | **997.9 ms** | **2.41x slower** |
| LSD radix, 4 passes × 8 bits | **121.4 ms** | **3.41x faster than `std::sort`** |

### Why quicksort wins — three reasons, in order of size

**1. In-place, so half the memory traffic.** Mergesort writes every element into a second buffer at every level: `2n log n` words crossing the bus, plus an `O(n)` allocation that on first touch costs `n/L` page faults. Quicksort's partition reads and writes the same array, in two sequential streams converging from the ends. **This is the dominant term.**

**2. Cache behaviour is self-improving.** Quicksort recurses on shrinking subarrays. Once a subarray fits in L2, *every remaining operation on it is an L2 hit* — and that is most of the operations, since most of the work happens in the small subproblems. Mergesort's merges at the top levels always touch the full `n`.

**3. It stops early.** Introsort cuts to insertion sort below ~16 elements. Insertion sort on 16 contiguous ints is a handful of predicted branches on one cache line — it is *faster than the recursive call overhead would be*. Roughly half of a sort's comparisons happen in these tiny subproblems.

Quicksort's `O(n²)` worry is handled by **introspection**, not by a better pivot rule: `std::sort` counts recursion depth and switches to heapsort past `2 log₂ n`. **Worst case becomes `O(n log n)` with quicksort's average-case constants.** You get the bound *and* the speed. (Musser, 1997.)

### Heapsort's paradox, briefly

Heapsort is `O(n log n)` worst-case *and* `O(1)` space — strictly better on paper than both — and is reliably the slowest. Sift-down accesses index `2i+1`: the stride *doubles* each level. That pattern is unprefetchable and touches a new line at every level once the heap outgrows the cache. Heapsort is in the standard library only as introsort's escape hatch, and that is exactly the right role for it.

### pdqsort's branchless partitioning

Classic Hoare partition runs one comparison per element whose outcome is **inherently unpredictable** — the pivot is near the median by design, so the branch is a coin flip and the predictor is right ~50% of the time. At ~15–20 cycles per mispredict, that is roughly **7–10 cycles per element of pure penalty**, which on random data is comparable to all the useful work.

**BlockQuicksort** (Edelkamp & Weiß, 2016) and **pdqsort** (Orson Peters) remove the branch. Instead of `if (a[i] < pivot) swap(...)`, process a fixed block (say 64 elements) in two phases:

```cpp
// Phase 1: no branch — record which indices need moving.
unsigned char offsets[64]; int count = 0;
for (int i = 0; i < 64; i++) {
    offsets[count] = i;
    count += (arr[base + i] < pivot);   // increment BY THE COMPARISON RESULT
}
// Phase 2: perform exactly `count` swaps, a predictable loop.
```

The comparison becomes a `setcc`/`cmov`-style data dependency instead of a control dependency. `offsets` is 64 bytes — one cache line, permanently in L1. **The unpredictable branch is converted into an unpredictable *value*, which the CPU handles at full speed.**

pdqsort also adds pattern detection (already-sorted and reverse-sorted runs get `O(n)` handling) and a "bad pattern breaker" — it counts partitions falling outside the 12.5%–87.5% percentile band and switches to heapsort after `log n` of them, keeping the `O(n log n)` worst case. It is Rust's `sort_unstable`. (Source: the pdqsort README; it gives a performance graph but **no tabulated speedup numbers, so I am not quoting one** — the frequently-cited "2–3x on random data" figure I could not verify against a primary source and have omitted.)

### And radix sort beats all of them, with an asterisk

3.41x faster than `std::sort` [CE], because `Θ(d(n+k))` with `d=4` is genuinely less work than `n log₂ n = 22n` comparisons. The asterisks: it is not comparison-based (needs a fixed-width key you can bucket by digit), it needs `O(n)` scratch, it is not in-place, and **the scatter phase is random writes** — which is why it is 3.4x rather than 5.5x, and why its GPU form (§3.4) spends all its effort on making that scatter coalesced.

## 2.6 Branch prediction and algorithms

### The famous benchmark — and why it usually doesn't reproduce any more

The Stack Overflow question *"Why is processing a sorted array faster than processing an unsorted array?"* is the most-upvoted question on the site. The loop:

```cpp
for (i = 0; i < N; i++)
    if (data[i] >= 128) sum += data[i];
```

runs several times faster on sorted data, because sorted data makes the branch perfectly predictable (a long run of not-taken, then a long run of taken) while random data makes it a coin flip.

**I could not reproduce it with that code on either machine.** Here is what actually happens, and it is a better lesson than the original.

**[M3], `-O2`:** unsorted 44.9 ms, sorted 44.4 ms — **1.01x. No effect at all.**

The assembly says why. Clang auto-vectorised the loop into NEON:

```asm
LBB0_6:
    ldp   q26, q27, [x9, #-32]
    cmgt.4s  v14, v26, v1     ; compare 4 lanes against 127 → mask
    and.16b  v29, v29, v26    ; mask the values
    orn.16b  v26, v29, v26    ; select
```

**There is no branch.** `cmgt` produces a lane mask and `and`/`orn` select — 4 elements per instruction, zero control flow.

Disable vectorisation and it *still* doesn't reproduce (**1.02x**), because clang if-converts the scalar loop too:

```asm
LBB0_1:
    ldr   w9, [x0], #4
    cmp   w9, #127
    csel  w9, w9, wzr, gt     ; ← conditional SELECT, not a branch
    add   x8, x8, x9
    subs  x1, x1, #1
    b.ne  LBB0_1              ; only the loop-back branch, perfectly predicted
```

`csel` is ARM's conditional move. **The compiler already applied the branchless fix.** The only branch left is the loop condition, which is taken 32767 times out of 32768.

**To see the effect you must give the compiler a branch it cannot remove** — a call it can't inline through:

```cpp
__attribute__((noinline)) long slow(long s, int v) { asm volatile("" ::: "memory"); return s + v; }
for (i = 0; i < N; i++)
    if (data[i] >= 128) t = slow(t, data[i]);   // opaque: must branch
```

| | unsorted | sorted | ratio |
|---|---:|---:|---:|
| plain loop, [CE] gcc `-O2` | 111.2 ms | 112.4 ms | **1.01x** (vectorised away) |
| **opaque call, [CE] gcc `-O2`** | **262.3 ms** | **47.5 ms** | **6.86x** |
| plain loop, [M3] clang `-O2` | 44.9 ms | 44.4 ms | **1.01x** (vectorised away) |
| **opaque call, [M3] clang `-O2`** | **181.7 ms** | **87.9 ms** | **2.08x** |

**6.86x on x86 — very close to the original Stack Overflow result — but only once the branch is real.** And note M3's 2.08x versus x86's 6.86x: Apple's predictor and its shorter pipeline make a mispredict cheaper. **The penalty is a microarchitectural parameter, not a constant of nature.**

**This is a better exercise than the original**, and it should be taught in this order:

1. Run the classic benchmark. Observe **no difference**. Be confused.
2. Read the assembly. Find `csel` / `cmgt`. Understand that the compiler already fixed it.
3. Defeat the optimisation. Observe 2–7x.
4. Conclude: **compilers now do branchless conversion for you on simple loops, and the skill is knowing when they can't** — which is whenever the branch body has side effects, calls something opaque, or is too large to if-convert profitably.

### Branchless techniques, and when they lose

| Technique | Form |
|---|---|
| **Conditional move** | `cmov` (x86) / `csel` (ARM). Compiler-emitted; you nudge it with the ternary operator or `std::min`/`std::max`. |
| **Arithmetic masking** | `mask = -(long)(cond); result = (mask & a) \| (~mask & b);` — works everywhere, no compiler cooperation needed. |
| **Predication via increment** | `count += (a[i] < pivot);` — the pdqsort trick (§2.5). |
| **Table lookup** | Replace a branch with an index. Trades a mispredict for a possible cache miss — usually a bad trade unless the table is tiny. |
| **SIMD masking** | AVX-512 `k`-registers, ARM SVE predicates, NEON `cmgt`+`bsl`. Per-lane predication is *the* reason AVX-512 and SVE can vectorise loops with `if`s inside. |

**The critical caveat: `cmov` is not free.** It converts a *control* dependency into a *data* dependency. A predicted branch costs ~0 cycles; a `cmov` costs 1 cycle **and lengthens the dependency chain**, blocking speculation past it. So:

> **Branchless wins when the branch is unpredictable (>~10% mispredict). Branchless loses when the branch is predictable.**

This is why GCC and Clang sometimes emit a branch where you expected `cmov`, and why `-O3` occasionally regresses code that `-O2` got right: the compiler is guessing at the mispredict rate, and PGO exists to stop it guessing. Linus Torvalds has a famous rant on exactly this — `cmov` was a pessimisation on the P4 and the folklore outlived the hardware.

### Binary search's branch-misprediction problem, and the Eytzinger layout

Binary search is the perfect storm:

- **Every branch is maximally unpredictable.** By construction each comparison eliminates exactly half the space, so it is a 50/50 coin flip — the theoretical worst case for a predictor. `log₂ n` mispredicts per query.
- **Every access is a cache miss, and they are dependent.** The next index depends on the current comparison, so no memory-level parallelism.
- **The access pattern is maximally spread.** First probe is the middle, then quarters — the first `log₂(n/L)` probes each touch a fresh line.

**Fix 1: branchless.** Replace the `if` with pointer arithmetic:

```cpp
const int* base = a; int len = n;
while (len > 1) { int half = len/2; base += (base[half-1] < key) ? half : 0; len -= half; }
```

**Fix 2: change the layout.** The **Eytzinger** layout stores the tree in breadth-first order in a 1-indexed array: root at 1, children of `k` at `2k` and `2k+1`. No pointers, and the search is a beautiful branchless loop:

```cpp
size_t k = 1;
while (k <= n) k = 2*k + (e[k] < key);      // no branch, no comparison-driven control flow
k >>= __builtin_ffsll(~k);                   // recover the predecessor from the path bits
```

The point is **locality**: the top of the tree — the nodes every query touches — is packed into the first few cache lines and stays permanently resident. In a sorted array the "root" (element `n/2`) and its "children" (`n/4`, `3n/4`) are megabytes apart.

**Fix 3: prefetch.** Because the next two candidates are at `2k` and `2k+1`, and their four grandchildren at `4k..4k+3`, you can prefetch several levels ahead speculatively — `__builtin_prefetch(e + k*16)` fetches the line containing the great-great-grandchildren. **The dependent chain is broken by fetching all possible next nodes.**

**Measured [M3], 1,048,576 random queries into a sorted `int` array:**

| n | branchy | branchless | **Eytzinger** | **Eytzinger + prefetch** |
|---:|---:|---:|---:|---:|
| 1,024 | 8.11 ms | 7.47 ms | **6.47 ms** | 44.92 ms |
| 16,384 | 13.83 ms | 12.33 ms | **10.76 ms** | 41.67 ms |
| 262,144 | 38.97 ms | 37.13 ms | **21.90 ms** | 70.65 ms |
| 4,194,304 | 89.31 ms | 77.04 ms | **45.37 ms** | 45.41 ms |
| **16,777,216** | 360.26 ms | 287.87 ms | 164.31 ms | **75.74 ms** |

**Three findings, and the third is the best one:**

1. **Branchless alone buys little: 1.07x–1.25x.** The mispredicts are real but they overlap with the cache misses, which dominate. *Fixing the branch without fixing the layout barely helps.*
2. **Eytzinger buys 2.2x at large `n`** and is never worse. The layout is the fix.
3. **Prefetching is a 7x *loss* at n=1024 and a 2.2x *win* at n=16M** — at the crossover (n≈4M) it is exactly break-even. When the data fits in cache, prefetching is pure wasted instructions and wasted bandwidth on lines you'll never use. When it doesn't, it converts a serial dependent chain into parallel misses. **A student who sees a single optimisation swing from 7x-worse to 2.2x-better across the same code is inoculated against cargo-culting optimisations for life.** Combined, Eytzinger+prefetch is **4.76x** faster than textbook binary search at n=16M.

(Layouts: Khuong & Morin, *Array Layouts for Comparison-Based Searching*, arXiv:1509.05053 — their conclusion, which my measurements agree with, is that "for larger values of n... the Eytzinger layout is usually the fastest," beating both B-tree and van Emde Boas layouts, contradicting the earlier theory-driven expectation.)

## 2.7 AoS vs SoA, struct packing, and data-oriented design

**Array of Structs** stores `[{x,y,z,...}, {x,y,z,...}, ...]`. **Struct of Arrays** stores `xs[], ys[], zs[]` separately. A loop that reads only `x` from every element pulls in the entire struct with AoS, and only the `x` array with SoA.

**The predicted ratio is exactly `min(sizeof(struct), L) / sizeof(field)`** — how many useful bytes arrive per cache line. Here it is, measured on two machines with different `L`:

**Summing one `float` field over 1–4M elements:**

| `sizeof(struct)` | **[M3]**, L = **128 B** | **[CE] x86**, L = **64 B** |
|---:|---:|---:|
| 12 B | 1.03x | 1.01x |
| 32 B | 0.97x | 1.19x |
| 64 B | **1.47x** | **3.66x** |
| 128 B | **20.81x** | **5.19x** |

**This table is the best single artifact in the document, because it is a controlled experiment with a moving hardware parameter.**

- **At 64 B:** on x86 the struct is exactly one cache line, so every line yields 1 useful float out of 16 → big penalty (3.66x). On M3 the 128-byte line holds *two* structs, so you still get 2 useful floats per line → only 1.47x.
- **At 128 B:** now M3's line holds exactly one struct — 1 useful float per 128-byte line, against SoA's 32 — and the ratio explodes to **20.8x**. x86 has been at "one struct spans two lines" since 64 B and grows only to 5.19x.
- **Below the line size, there is no effect at all** (1.0x), because you were getting multiple structs per line either way and the loop is bandwidth-bound on data you'd have fetched regardless.

> **The AoS/SoA penalty does not exist until your struct reaches the cache line size, and then it grows linearly.** Two machines, same source, ratios 4x apart in *opposite directions* at different struct sizes. Nothing in Big-O, and nothing in the source code, distinguishes these runs.

**Note for exercise design:** the 5.19x at 128 B on [CE] matches the clean 5.2x a prior agent measured on Compiler Explorer. That number is real and reproducible — and now we know it is specifically the *128-byte-struct-on-64-byte-lines* datapoint, not a universal constant.

### Struct packing and padding

C and C++ require each member to sit at an address that is a multiple of its alignment, and the struct's size to be a multiple of its own alignment (so arrays work). The compiler inserts padding, and **member declaration order changes `sizeof`**:

```c
struct Bad  { char a; long b; char c; };   // 1 + 7pad + 8 + 1 + 7pad = 24 bytes
struct Good { long b; char a; char c; };   // 8 + 1 + 1 + 6pad      = 16 bytes
```

**33% memory saved by reordering three fields.** Rule of thumb: **declare members in decreasing size order.** (Rust reorders fields for you unless you write `#[repr(C)]`; C and C++ never do, because the ABI is the layout.)

Padding matters because it is *transported*: every wasted byte occupies bandwidth, cache capacity, and TLB reach. In the table above, `sizeof` is the entire independent variable.

The other half of the same coin is **false sharing**: two threads writing different variables that share a cache line will ping-pong that line between cores at coherence-protocol cost, for no logical reason. The fix is to pad *up* to `std::hardware_destructive_interference_size` — the opposite of everything above. **Pack for single-threaded traversal; pad for multi-threaded writes.**

### Why ECS layouts exist in game engines

An **Entity Component System** stores game state as SoA by component. Not `vector<GameObject>` where each object has position, velocity, health, mesh, AI state — but `vector<Position>`, `vector<Velocity>`, one array per component, with entities as indices.

Every argument above applies, and two more that only show up at scale:

1. **Systems touch few components.** The physics system reads `Position` and `Velocity` and writes `Position`. With AoS it drags mesh handles, AI state, and inventory through the cache. A `GameObject` is easily 256+ bytes; physics wants 24 of them. **That is exactly the 128 B row of the table, worse.**
2. **Virtual dispatch dies.** OOP game objects mean `for (auto* o : objects) o->update();` — an indirect call per object, an unpredictable branch per object (different vtables), and a pointer chase per object. ECS turns it into a flat loop over one component array with a monomorphic body, which **vectorises**.
3. **Archetype storage makes iteration dense.** Entities with the same component set are stored together, so a system iterating "everything with Position and Velocity" walks contiguous memory with no per-entity test.

Mike Acton's CppCon 2014 talk *"Data-Oriented Design and C++"* is the canonical statement, and its central slogan is the thesis of this whole section: **"the purpose of all programs, and all parts of those programs, is to transform data from one form to another"** — so design around the *data's* shape and movement, not around a taxonomy of nouns.

## 2.8 Hash tables in practice

Two ways to resolve collisions:

| | **Chaining** | **Open addressing** |
|---|---|---|
| Collision handling | Bucket holds a pointer to a linked list | Probe subsequent slots in the same array |
| Lookup memory access | **1 miss for the bucket array + 1 dependent miss per chain node** | **1 miss, then usually a same-line hit** |
| Load factor | Works past 1.0; degrades gracefully | Must stay below ~0.75–0.9; degrades catastrophically near 1.0 |
| Deletion | Trivial | Needs tombstones or backward-shift |
| Reference stability | Pointers stay valid across rehash | Everything moves on rehash |
| Required by | **`std::unordered_map` — the standard mandates bucket iteration and reference stability, so it must chain** | `absl::flat_hash_map`, `folly::F14`, Rust `HashMap`, Python `dict` |

**Measured, lookup of 2M existing keys:**

| n | [M3] `unordered_map` | [M3] flat open-addr | ratio | [CE] `unordered_map` | [CE] flat | ratio |
|---:|---:|---:|---:|---:|---:|---:|
| 4,096 | 11.79 ms | 9.27 ms | 1.27x | 23.22 | 17.26 | 1.35x |
| 65,536 | 14.34 ms | 11.15 ms | 1.29x | 36.35 | 23.38 | 1.55x |
| 1,048,576 | 41.29 ms | 18.95 ms | **2.18x** | 85.06 | 60.39 | 1.41x |
| 8,388,608 | 52.97 ms | 28.18 ms | 1.88x | — | — | |

My open-addressing map is ~25 lines of naive linear probing with no SIMD and no tuning, and it still wins by 1.3x–2.2x. **The gap widens exactly where it should**: at small `n` everything is cached and the pointer chase is an L1 hit; at `n = 2²⁰` the table exceeds L2 and the second dependent miss is a full DRAM round trip. **Published comparisons of Abseil's Swiss tables against `std::unordered_map` report considerably larger factors than mine, and I'd expect them to — but I am quoting my own numbers because I could not verify a specific published figure. [the direction is well-established; specific published multiples are unverified]**

### Why open addressing wins on modern hardware

The whole argument in one sentence: **chaining needs two dependent memory accesses and open addressing usually needs one.** The bucket array load must complete before you know the node address; that's a serialised ~100 ns at the sizes where it matters. Add per-node allocation (a `malloc` per insert, nodes scattered across the heap, 16 bytes of pointer overhead per entry) and chaining loses on every axis except the two the C++ standard happens to require.

### Robin Hood hashing

On insertion, compare the probe distance of the key being inserted against the distance of the key occupying the slot. **If the incumbent is "richer" (closer to home), evict it and continue inserting the evicted key.** (Celis, 1986.) The effect is to equalise probe distances — it does not change the *mean* but it dramatically reduces the **variance**. That converts an unpredictable-length probe loop into a nearly-fixed-length one, which is (a) predictable for the branch predictor and (b) an early-exit condition: if you have probed further than the incumbent's distance, the key is definitively absent. Rust's `HashMap` used Robin Hood before switching to SwissTable in 2018.

### SIMD probing: Swiss tables and F14

**Google's Swiss table** (`absl::flat_hash_map`, presented by Matt Kulukundis at CppCon 2017) splits the table into a **control array** of one byte per slot, stored separately from the slots. Each control byte holds either an empty/deleted marker or the **top 7 bits of the hash** (H2), while the low bits (H1) choose the group.

Lookup:
1. `H1` selects a group of **16 consecutive slots**.
2. Load the group's 16 control bytes into one SSE2 register — **one 16-byte load, one cache line.**
3. `_mm_cmpeq_epi8` against a broadcast `H2`, then `_mm_movemask_epi8` → a 16-bit mask of candidate matches.
4. Iterate the set bits (usually zero or one), comparing full keys only for candidates.

> **16 slots are filtered in ~3 instructions, from one cache line, with no branches.** The 7-bit H2 tag makes a false candidate ~1/128 likely, so the expensive full-key comparison almost never runs speculatively.

The deep idea: **the metadata is separated from the data specifically so that the metadata is dense.** 16 slots' worth of filtering information fits in 16 bytes; the keys those slots hold might be 16 × 64 bytes. This is SoA applied to a hash table (§2.7) — and it lets one cache line answer "is it here, and where."

**Facebook's F14** (`folly::F14`, Bronson & Shi, 2019) uses the same idea with 14-way chunks (hence the name) plus an overflow counter per chunk, and ships `F14ValueMap` / `F14NodeMap` / `F14VectorMap` variants trading reference stability against density.

**The portability note worth making:** this design is intrinsic-dependent (SSE2 on x86, NEON on ARM, a scalar SWAR fallback elsewhere). It is a real example of an algorithm whose *structure* was chosen to fit a specific instruction — `pmovmskb` — rather than the other way round.

### The cost of a pointer chase, stated once

Every structure in §1.3 that stores `next`/`left`/`right` pointers pays the same tax: **one dependent, unprefetchable, potentially TLB-missing memory access per level.** §2.2 prices it at ~100 ns once you leave cache. That single fact explains, without any further argument, why linked lists lose to vectors, why B-trees beat red-black trees, why open addressing beats chaining, why memoised DP is slower than tabulated DP, and why Fibonacci heaps lose to binary heaps. **It is one fact and it retires half of the classical data-structure canon.**

## 2.9 SIMD-aware algorithms

SIMD executes one instruction across 4/8/16/32 lanes. The compiler will auto-vectorise simple loops (we saw it do so uninvited in §2.6, twice). The interesting question is *which algorithms can be expressed so that it's possible at all.*

### What vectorises, and why

| Pattern | Vectorises? | Why |
|---|---|---|
| **Elementwise map** (`c[i] = a[i]+b[i]`) | Trivially | Zero cross-lane dependency. |
| **Reduction** (`sum += a[i]`) | Yes, with a caveat | Keep `k` partial sums in `k` lanes, combine at the end. **For floats this changes the answer** — FP addition isn't associative — so it needs `-ffast-math` or explicit intent. This is the single most common reason a numeric loop refuses to vectorise. |
| **Prefix sum** | Yes, cleverly | Log-shift-and-add within a vector (Hillis-Steele in a register), then propagate the carry. §3.2's algorithm at 8-lane scale. |
| **Filter / compact** | Yes, on modern ISAs | AVX-512 `VPCOMPRESSD`, ARM SVE `COMPACT`. Before those, it needed a 256-entry shuffle-mask lookup table indexed by the comparison mask — a well-known trick. |
| **String search** | Yes, spectacularly | `memchr`: broadcast the byte, compare 32/64 at a time, `movemask`, `tzcnt`. Substring search: compare first and last characters of the needle simultaneously across 32 offsets (the "generic SIMD" algorithm), verify only the survivors. |
| **Sorting networks** | Yes, for fixed small n | A network of compare-exchanges with a data-independent schedule — perfectly branchless and SIMD-able. Used as the base case of vectorised quicksorts. |
| **Set intersection** (sorted lists) | Yes | Compare all-pairs of two 4-element blocks with shuffles; the basis of fast inverted-index intersection. |
| **Pointer chasing** | **No** | The address of load `i+1` is the *result* of load `i`. Serial by definition. |
| **Irregular control flow** | **Only with predication, and only if the bodies are cheap** | Masking executes *both* sides and discards one. If the two branches cost 5 and 500 cycles, you pay 505 on every lane. |
| **Loop-carried short dependencies** | **No** | `h = h*31 + a[i]` is one multiply of latency per element, serial. Fixed by hashing 4 independent streams and combining — which changes the hash. |
| **Gather/scatter-dominated code** | **Technically, but rarely profitably** | `VGATHERDPS` issues one element per cycle internally. A gather of 8 scattered elements is ~8 cycles + 8 potential misses. It is a convenience, not a speedup. |

**The unifying rule:**

> **SIMD requires that the work for lane `i` is independent of the result for lane `i−1`, and that all lanes do the same thing.** Every technique in vectorisation is a way of manufacturing one of those two properties: partial accumulators manufacture independence, masking manufactures uniformity.

**That is also the GPU's rule, at 32 lanes instead of 8.** A warp is a 32-wide SIMD unit with a friendlier programming model; "warp divergence" is exactly the masking cost in the third row from the bottom. A student who understands why `h = h*31 + a[i]` can't vectorise understands why it can't be a CUDA kernel either.

### Concrete results

- **simdjson** parses JSON at multiple GB/s by doing structural-character identification with SIMD comparisons across 64-byte blocks before any parsing logic runs. (Langdale & Lemire, *Parsing Gigabytes of JSON per Second*, 2019.)
- **Vectorised quicksort**: Intel's `x86-simd-sort` and Google Highway's `vqsort` use AVX-512 sorting networks for the base case and vectorised partitioning above it, reporting large multiples over `std::sort` for 32-bit keys. Blacher et al., *Vectorized and performance-portable Quicksort* (2022), report **up to ~10x**; I did not measure it and the exact multiple varies by key type and ISA. **[unverified — cited, not measured]**
- **`memchr`/`strlen`**: every libc's implementation has been SIMD for 15 years. This is why a hand-written `while (*p) p++;` is 10x slower than `strlen`.

---

# 3. Parallel and GPU algorithms

## 3.1 Work-depth analysis: the right model for parallelism

Sequential complexity has one number. Parallel complexity needs two:

- **Work `W(n)`** — total operations across all processors. The cost you pay in energy and in total machine time.
- **Depth `D(n)`** (also *span*, or `T∞`) — the longest chain of dependent operations. The time you would take with infinitely many processors.

**Brent's theorem** ties them together:

```
T_p  ≤  W/p + D
```

with `p` processors. And the two derived quantities:

- **Parallelism = `W/D`** — the maximum useful processor count. Beyond it you're adding idle cores.
- **Work-efficient** means `W` matches the best sequential algorithm's complexity, up to constants.

> **A parallel algorithm has to be judged on both axes, and the classic mistake is optimising depth while quietly multiplying work.** That mistake has a name and a worked example, and it is the next section.

Amdahl's law is the pessimistic corollary: if a fraction `s` of the work is inherently serial, speedup is capped at `1/s` no matter how many processors you have. Gustafson's rebuttal is that in practice you grow the problem with the machine, so `s` shrinks. Both are true; which applies depends on whether you have a fixed problem or a fixed time budget.

## 3.2 Scan (prefix sum): the fundamental parallel primitive

**This subsection is the one the GPU units depend on.** Treat it as the centrepiece.

Given an associative operator `⊕` and input `[a₀, a₁, …, aₙ₋₁]`:

- **Inclusive scan:** `[a₀, a₀⊕a₁, a₀⊕a₁⊕a₂, …]`
- **Exclusive scan:** `[I, a₀, a₀⊕a₁, …]` where `I` is the identity.

Sequentially it is a three-line loop and it looks like the most serial thing imaginable — each output depends on the previous one. **That appearance is the whole lesson: scan looks inherently sequential and is not, and the technique that unlocks it (exploiting associativity to re-bracket the computation) is the technique behind every parallel reduction, every parallel sort, and every segmented operation.**

### Why it matters more than it looks

Scan is how you turn **variable-sized, data-dependent output** into **parallel writes to computed addresses.** Every one of these is a scan:

| Problem | The scan |
|---|---|
| **Stream compaction / filter** | Scan the 0/1 predicate → each surviving element's output index. |
| **Building CSR from degrees** | Exclusive scan of per-vertex degree → `offsets[]`. |
| **Radix sort pass** | Scan the digit histogram → each bucket's base offset. |
| **BFS frontier expansion** | Scan neighbour counts → where each vertex writes its neighbours. |
| **Allocating variable output per thread** | Scan the per-thread counts → each thread's private output slot. |
| **Line-of-sight, run-length decode, sparse matvec, tokenizer offsets** | all scans |
| **Quicksort partition, in parallel** | Scan of the `<pivot` predicate. |

> **Any time parallel threads each produce a variable number of outputs and you need them packed contiguously, the answer is a scan.** That is the sentence to make a student memorise; the GPU units will cash it in repeatedly.

### Hillis-Steele: depth-optimal, work-inefficient

(Hillis & Steele, *Data parallel algorithms*, CACM 1986.)

```
for d = 1, 2, 4, 8, ... < n:
    for all i in parallel:  b[i] = (i >= d) ? a[i] + a[i-d] : a[i]
    swap(a, b)
```

Each pass makes every element the sum of a window twice as wide. After `log₂ n` passes each element holds the sum of everything before it.

- **Work: `Θ(n log n)`** — `n` additions per pass, `log n` passes.
- **Depth: `Θ(log n)`** — optimal.
- **Needs double buffering** (or a barrier plus a temporary), because element `i` reads `a[i-d]` while element `i-d` is being written.

### Blelloch: work-efficient, twice the depth

(Blelloch, *Prefix Sums and Their Applications*, CMU-CS-90-190, 1990.)

Two phases over an implicit balanced binary tree laid out in the array.

**Up-sweep (reduce)** — build partial sums bottom-up:
```
for d = 1, 2, 4, ... < n:
    for i = 2d-1, 4d-1, ... < n in parallel:  a[i] += a[i-d]
// a[n-1] now holds the total sum
```

**Down-sweep** — set the root to the identity, then push partial sums down. At each node, the **left child receives the node's value**, and the **right child receives the node's value ⊕ the left child's old value**:
```
a[n-1] = 0
for d = n/2, n/4, ... 1:
    for i = 2d-1, 4d-1, ... < n in parallel:
        t = a[i-d];  a[i-d] = a[i];  a[i] += t
```

- **Work: `Θ(n)`** — exactly `n−1` adds up, `n−1` adds and `n−1` swaps down.
- **Depth: `Θ(log n)`** — but `2 log n` passes, so twice Hillis-Steele's constant.
- **In place**, no double buffer.

**Verified during this research** (correctness checked against a sequential reference, operations counted by instrumentation):

| n | Blelloch: correct? | Blelloch ops | Hillis-Steele: correct? | H-S ops | **H-S ÷ Blelloch** |
|---:|---|---:|---|---:|---:|
| 8 | ✅ | 21 | ✅ | 24 | 1.14x |
| 1,024 | ✅ | 3,069 | ✅ | 10,240 | **3.34x** |
| 1,048,576 | ✅ | 3,145,725 | ✅ | 20,971,520 | **6.67x** |

`3,145,725 = 3(n−1)` **exactly**, and `20,971,520 = n log₂ n` **exactly**. The theory is not approximately right; it is exactly right, and a student can watch a counter confirm it.

Worked example (verified): Blelloch exclusive scan of `{3,1,7,0,4,1,6,3}` → `{0,3,4,11,11,15,16,22}`. ✅

### The comparison, and the honest ending

| | Work | Depth | Buffers | Verdict |
|---|---|---|---|---|
| Sequential | `n` | `n` | 1 | Optimal work, useless depth |
| **Hillis-Steele** | **`n log n`** | `log n` | 2 | Fine for `n` ≤ warp/block width, where the extra work is free because the lanes would be idle anyway |
| **Blelloch** | **`n`** | `2 log n` | 1 | The right choice at scale — `6.67x` less work at n=2²⁰ |

**But neither is what actually runs on a modern GPU, and saying so is important.**

A textbook Blelloch scan over global memory reads and writes the array **twice** (up-sweep + down-sweep) plus the recursive block-sum scan — roughly **4n** words of memory traffic. Scan is utterly memory-bound, so 4n traffic means at best 50% of peak bandwidth.

**What CUB and Thrust actually use is single-pass "decoupled look-back"** (Merrill & Garland, NVIDIA tech report, 2016): each block computes its local aggregate, publishes it with a status flag, then *looks back* at predecessor blocks' published aggregates — accepting an inclusive-prefix if one is available and otherwise summing aggregates further back — while its own local scan proceeds. This reads the input **once** and writes the output **once**: **2n traffic, memory-bandwidth-bound, ~2x the textbook algorithm.**

The three-level hierarchy that a real implementation uses:

1. **Warp scan** — Hillis-Steele using `__shfl_up_sync`, no shared memory at all, 5 steps for 32 lanes. Work-inefficiency is *free* here: the lanes exist whether you use them or not.
2. **Block scan** — scan the per-warp totals (one warp's worth), then add back.
3. **Device scan** — decoupled look-back across blocks.

> **The pedagogical arc: Hillis-Steele teaches the idea, Blelloch teaches work-efficiency, and decoupled look-back teaches that at the top level the real objective function is memory traffic, not operation count.** All three belong in the unit, in that order. Ending at Blelloch — as most courses do — leaves a student believing something that CUB stopped doing a decade ago.

## 3.3 Parallel reduction

Structurally the up-sweep half of Blelloch. Work `Θ(n)`, depth `Θ(log n)`, and it is the "hello world" of GPU optimisation because Mark Harris's classic *Optimizing Parallel Reduction in CUDA* deck walks seven successive versions of it. The progression is worth previewing here because every step is a hardware fact, not an algorithmic one:

1. Interleaved addressing with a modulo → **warp divergence** on every step.
2. Interleaved with strided index → **shared-memory bank conflicts.**
3. Sequential addressing → conflicts gone.
4. First add during load → **half the blocks were idle.**
5. Unroll the last warp → within a warp, execution is lockstep, so no `__syncthreads()` needed.
6. Fully unroll with templates.
7. Multiple elements per thread ("algorithm cascading") → **amortise the fixed overhead**, which is Brent's theorem applied by hand.

**The algorithm never changes across those seven versions. Only its mapping onto the hardware changes.** That is the thesis of this entire document, expressed as a CUDA tutorial, which is why the reduction belongs at the seam between this unit and the GPU units.

Modern implementations use warp-level primitives (`__shfl_down_sync`, and on newer hardware `__reduce_add_sync`) and skip most of the shared-memory choreography — but the seven steps remain the best available lesson in mechanical sympathy.

## 3.4 Parallel radix sort, and why GPU sorting is a different algorithm

**On a CPU, the fastest general sort is a comparison sort (introsort/pdqsort). On a GPU, it is radix sort.** Not a tuned variant — a different algorithm, chosen for different reasons.

**Why comparison sorts lose on a GPU:**
- Quicksort's recursion has **data-dependent, irregular** subproblem sizes → massive load imbalance across blocks.
- Partitioning needs a data-dependent scatter with cross-thread coordination.
- The comparison branch diverges within a warp by construction.
- The recursion depth is data-dependent, and dynamic parallelism is expensive.

**Why radix sort wins:**
- **Data-independent control flow.** `d` passes, each identical, regardless of input. No divergence.
- **Every pass is a histogram + a scan + a scatter** — and the scan is §3.2's primitive, already optimal.
- Work is `Θ(d·n)` with a tiny constant.

**One LSD pass over `b` bits:**

1. **Local histogram**: each block counts occurrences of each of `2^b` digit values among its elements (typically `b = 4` or `8`, so 16 or 256 counters).
2. **Global exclusive scan** of the histograms — over `(#blocks × 2^b)` counters, arranged so the scan yields, for each (block, digit) pair, the global offset where that block's elements with that digit begin. **This is where scan does the real work.**
3. **Scatter**: each element writes to `offset[block][digit] + rank_within_block`.

**The engineering is all in step 3.** A naive scatter is uncoalesced — 32 threads in a warp write to 32 unrelated addresses, costing up to 32 memory transactions instead of 1. Merrill & Grimshaw's insight (*High Performance and Scalable Radix Sorting*, 2011) is to **sort locally in shared memory first**, so that each block's output is contiguous per digit, and the global scatter becomes a small number of long coalesced runs. That single restructuring is most of the performance.

Bitonic sort deserves a mention as the other GPU sort: `Θ(n log²n)` work — asymptotically worse — but a **completely fixed, data-independent** compare-exchange network. That regularity makes it the right choice for small in-register or in-shared-memory sorts, where `log²n` of nothing is still nothing. **A second instance of "worse asymptotics, better hardware fit."**

Throughput on current GPUs is in the billions of keys per second for 32-bit keys, bandwidth-bound. **[I did not measure GPU numbers; specific throughput figures are unverified.]**

## 3.5 Segmented operations

A **segmented scan** scans independently within each of many variable-length segments, in one parallel pass. The input is the data plus a **head-flag array** marking where segments begin.

The trick is elegant: define an operator on `(value, flag)` pairs that is **still associative**:

```
(v₁, f₁) ⊕ (v₂, f₂)  =  ( f₂ ? v₂ : v₁ + v₂ ,  f₁ | f₂ )
```

A flag on the right operand blocks the carry from the left. Because this is associative, **the ordinary Blelloch scan works unmodified** — you just changed the operator.

> **Segmented scan is what makes irregular, ragged, variable-length work regular enough to run on a SIMD machine.** Ragged nested data — a sparse matrix's rows, a graph's adjacency lists, a batch of variable-length sequences — becomes one flat array plus a flag array, and one scan.

Applications: sparse matrix-vector multiply (segments = rows), variable-length batching in ML, quicksort where each recursion level is a set of segments, and BFS frontier expansion.

## 3.6 Why graphs are hard on GPUs, and what to do about it

Graph traversal is the adversary of everything a GPU is good at:

| GPU wants | Graph traversal gives |
|---|---|
| Coalesced, contiguous access | `targets[offsets[v]]` — a **random** offset per vertex |
| Uniform work per thread | Degrees follow a power law: one vertex has 10⁶ neighbours, its neighbour has 2 |
| Data-independent control flow | Every step is "which vertices are in the frontier" — data-dependent |
| Bandwidth-bound work | Pointer chasing is **latency**-bound, and GPU latency (~400–600 ns) is *worse* than a CPU's |

**The bandwidth/latency point deserves emphasis, because it is counterintuitive.** An H100 has ~3.35 TB/s of HBM bandwidth and a CPU has ~100 GB/s — a 30x advantage. But a single dependent pointer chase gets *none* of it: it is one 32-byte request at a time, and the GPU's memory latency is higher than the CPU's. **A GPU wins on graphs only when there are thousands of independent chases in flight**, which is precisely what frontier-based BFS manufactures.

### The techniques

**1. CSR, always.** Two flat arrays, `offsets[V+1]` and `targets[E]`. Neighbours of `v` are one contiguous run — so *within* a vertex's neighbour list, access is coalesced. This is not optional.

**2. Frontier-based (level-synchronous) BFS.** Instead of a queue, maintain the current frontier as an array and process the whole level in parallel:

```
frontier = [source]
while frontier not empty:
    degrees   = [deg(v) for v in frontier]              // parallel map
    offsets   = exclusive_scan(degrees)                 // ← THE SCAN
    total     = offsets[-1] + degrees[-1]
    neighbors = gather: thread i handles edge i of `total`, finding its
                source by binary search into `offsets`  // load-balanced
    frontier  = compact(unvisited(neighbors))           // ← ANOTHER SCAN
```

**Both of the hard steps are scans.** Allocating output space for variable-degree vertices is a scan; compacting the next frontier is a scan. §3.2 is not a warm-up for this — it *is* this.

**3. Load balancing.** The scan-then-binary-search pattern above ("load-balanced search", or merge-based partitioning) assigns each thread exactly one *edge* rather than one *vertex*, which makes work per thread constant regardless of degree distribution. The alternative from Merrill, Garland & Grimshaw (*Scalable GPU Graph Traversal*, PPoPP 2012) is **tiered cooperative expansion**: very high-degree vertices are expanded by an entire CTA, medium-degree by a warp, low-degree by a single thread, with the tier chosen at runtime. Both are ways of decoupling the parallel decomposition from the graph's structure.

**4. Direction-optimizing BFS** (Beamer, Asanović & Patterson, 2012). Top-down BFS ("for each frontier vertex, check its neighbours") is efficient when the frontier is small. When the frontier is large — which happens for one or two levels in the middle of a small-world graph, and those levels dominate the runtime — **bottom-up** is better: "for each *unvisited* vertex, check whether any neighbour is in the frontier," and stop at the first hit. Since most unvisited vertices have *some* frontier neighbour at that point, the early exit skips enormous numbers of edges. The hybrid switches direction per level based on frontier size, and is reported at several times faster than top-down alone on social graphs. **[direction well-established; I did not measure]**

**5. Push vs pull.** The same duality generalises to all graph algorithms (PageRank, SSSP): *push* has each active vertex update its neighbours (needs atomics, output-contention); *pull* has each vertex gather from its in-neighbours (no atomics, but reads everything). GraphIt, Ligra, and Gunrock all make this a tunable.

**The honest summary to give a student:** irregular graph algorithms are the workload where GPUs' advantage is smallest and hardest to obtain, and where all the effort goes into **converting irregularity into regularity** — with scan as the universal converter.

---

# 4. Randomised and approximate structures

These trade exactness for space, and the trade is usually spectacular. Grouped by what they approximate.

## 4.1 Bloom filter — approximate set membership

`m` bits, `k` independent hash functions. Insert: set `k` bits. Query: if any of `k` bits is 0, the element is **definitely absent**; if all are 1, it is **probably present**.

**No false negatives. False positives at a computable rate.** After inserting `n` elements:

```
p  =  ( 1 − e^(−kn/m) )^k
```

Optimal `k` for given `m/n`:

```
k* = (m/n) · ln 2 ≈ 0.693 (m/n)      ⟹    p = 2^(−k*) ≈ 0.6185^(m/n)
```

Inverting for bits per element at a target `p`:

```
m/n  =  −log₂(p) / ln 2  =  −1.44 · log₂(p)
```

| Target false-positive rate | Bits per element | Optimal `k` |
|---|---:|---:|
| 10% | 4.8 | 3 |
| 1% | **9.6** | 7 |
| 0.1% | 14.4 | 10 |
| 0.01% | 19.2 | 13 |

> **~10 bits per element for a 1% false-positive rate, regardless of how big the elements are.** A billion 64-byte keys is 64 GB exactly, or 1.2 GB as a Bloom filter with 1% error.

**Hardware note that matters in practice:** the `k` hash probes land on `k` random bits across `m` bits — so a large Bloom filter costs **`k` cache misses per query**, which can make it slower than the exact structure it was meant to accelerate. **Blocked Bloom filters** fix this by confining all `k` bits of an element to a single cache-line-sized block: one miss instead of `k`, at the cost of a slightly worse false-positive rate for the same space. This is §2 applied to §4 and worth calling out explicitly.

Uses: LSM-tree/SSTable read filtering (RocksDB, Cassandra — *the* canonical use, avoiding a disk read per SSTable), CDN cache admission, malicious-URL prescreening, join pre-filtering in databases.

Relatives: **Counting Bloom filters** (4-bit counters instead of bits) support deletion. **Cuckoo filters** (Fan et al., 2014) support deletion and beat Bloom below ~3% FP rate. **Quotient filters** are more cache-friendly by construction.

## 4.2 Count-Min Sketch — approximate frequency

(Cormode & Muthukrishnan, 2005.) A `d × w` array of counters and `d` hash functions. Increment: `+1` at `sketch[i][h_i(x)]` for each row. Query: **`min` over the rows** — collisions only ever inflate a counter, so the minimum is the least-inflated estimate.

```
w = ⌈e/ε⌉ ,   d = ⌈ln(1/δ)⌉
⟹  estimate ≤ true + ε·‖a‖₁  with probability ≥ 1 − δ
```

For `ε = 0.001` and `δ = 0.001`: `w ≈ 2718`, `d ≈ 7` — about 19,000 counters, **76 KB**, for frequency estimates over an unbounded stream within 0.1% of the total count.

**Always over-estimates, never under.** Uses: heavy-hitter detection, network flow monitoring, ad click counting, and finding frequent n-grams in a corpus. (**Count-Sketch**, an earlier relative, uses ±1 signs and a *median* estimator, giving unbiased estimates and a bound in terms of the `ℓ₂` norm.)

## 4.3 HyperLogLog — approximate cardinality

(Flajolet, Fusy, Gandouet & Meunier, 2007.) Counting distinct elements exactly needs a set — `Θ(n)` space. HLL does it in **kilobytes for billions of items.**

The idea: hash each element and look at the position of the **leading 1 bit** in the hash. Seeing a hash with 10 leading zeros suggests ~2¹⁰ distinct elements were seen (probability 2⁻¹⁰ per element). A single such estimate has enormous variance — so use the first `p` bits to pick one of `m = 2^p` registers, keep the max leading-zero count per register, and combine them with a **harmonic mean** (which is what tames the variance, and is HLL's contribution over its predecessor LogLog).

```
standard error  ≈  1.04 / √m
```

| `m` registers | Memory (6-bit registers) | Standard error |
|---:|---:|---:|
| 1,024 | 768 B | 3.25% |
| 16,384 | **12 KB** | **0.81%** |
| 65,536 | 48 KB | 0.41% |

> **~12 KB gives you distinct-count over an unbounded stream within about 0.8%.** Redis's `PFCOUNT` uses 12 KB per HLL for exactly this reason.

HLL is also **mergeable** — the union of two HLLs is the element-wise max of their registers — which is why it dominates distributed analytics: each shard keeps a sketch, and the coordinator merges. Google's **HLL++** (2013) adds a 64-bit hash (removing the large-cardinality correction) and a sparse representation with linear counting for small cardinalities, where plain HLL is weakest.

## 4.4 Skip list — probabilistic balanced search

(Pugh, 1990.) A sorted linked list with additional "express lane" lists above it: each node is promoted to the next level with probability `p` (typically ½). Search descends from the top, moving right while possible. Expected `O(log n)` for search/insert/delete.

**Why it exists:** it matches a balanced tree's bounds with *no rotations*, which makes **lock-free and fine-grained-concurrent implementations dramatically simpler** — an insertion is a few CAS operations on `next` pointers, with no structural rebalancing to synchronise. That is why it appears in Redis sorted sets, LevelDB/RocksDB memtables, and `java.util.concurrent.ConcurrentSkipListMap`.

**Its weakness is §2's weakness**: it is a pointer-chasing structure, so single-threaded it loses to a B-tree with cache-line-sized nodes. **Skip lists win on concurrency, not on speed.** Stating that plainly is more useful than presenting them as a general alternative to trees.

## 4.5 Reservoir sampling — uniform sample from a stream of unknown length

Keep `k` items. For item `i` (1-indexed), with `i > k`, replace a uniformly random one of the `k` with probability `k/i`.

```python
if i <= k:  reservoir[i-1] = x
else:
    j = randint(0, i-1)
    if j < k: reservoir[j] = x
```

Every item ends up in the reservoir with probability exactly `k/n`, in **`O(k)` space and one pass**, without ever knowing `n`. (Attributed to Alan Waterman; Vitter, 1985, gives the optimised `O(k(1+log(n/k)))` variants that skip ahead geometrically instead of drawing a random number per item.)

Uses: sampling log lines, training-data subsampling, distributed telemetry sampling.

## 4.6 Locality-sensitive hashing — and the bridge to vector search

**LSH inverts what a hash function is for.** A cryptographic hash maximises the chance that similar inputs land far apart. **An LSH family maximises the chance that similar inputs collide:**

```
Pr[ h(a) = h(b) ]  =  similarity(a, b)     (or a monotone function of it)
```

**MinHash** for Jaccard similarity: `h(S) = min over x∈S of π(x)` for a random permutation `π`. Then `Pr[h(A) = h(B)] = |A∩B| / |A∪B|` **exactly**. Used for near-duplicate document detection — and, notably, for deduplicating LLM pretraining corpora.

**SimHash / random hyperplanes** (Charikar, 2002) for cosine similarity: draw a random vector `r`, hash to `sign(r · v)`. Then `Pr[h(u) = h(v)] = 1 − θ(u,v)/π`. Concatenate `k` such bits into a signature; the Hamming distance between signatures estimates the angle.

**The AND/OR amplification** is the part worth teaching, because it is where the engineering lives. Concatenating `k` hashes into one band makes collisions require *all* `k` to match (sharpening precision); using `L` independent bands and taking the union makes a match require *any* band to hit (recovering recall). The resulting `1 − (1 − s^k)^L` curve is an S-curve whose threshold you place by choosing `k` and `L`.

### Why this belongs in an AI systems curriculum

Approximate nearest neighbour search over embedding vectors is **the** retrieval primitive: RAG, semantic search, recommendation, dedup. Exact nearest-neighbour over `n` vectors of dimension `d` costs `O(nd)` per query and is hopeless at `n = 10⁹`, `d = 1536`. Every production vector database is an ANN index, and LSH is the theoretical ancestor of the field:

| Method | Idea | Where |
|---|---|---|
| **LSH** | Hash so that near vectors collide | The theory; rarely the best in practice now |
| **IVF** (inverted file) | k-means cluster the vectors; search the nearest few centroids' lists | FAISS `IVFFlat` |
| **PQ** (product quantization) | Split the vector into subvectors, quantize each to a codebook, compute distances from lookup tables | FAISS `IVFPQ`; **compresses 1536-dim float32 (6 KB) to ~96 bytes** |
| **HNSW** | Hierarchical navigable small-world graph — a *layered proximity graph* whose top layers are long-range links | Malkov & Yashunin, 2016/2018. The current default: `hnswlib`, FAISS, pgvector, Qdrant, Weaviate |
| **ScaNN** | Anisotropic quantization — weights quantization error by its effect on the inner product, not on `ℓ₂` | Google, 2020 |

**And the hardware story from §2 applies directly.** HNSW is a **graph traversal** — it is §2's pointer chasing, §3.6's irregular access, and its performance is dominated by cache misses on the neighbour lists rather than by distance computations. IVF-PQ, by contrast, is a **flat scan of compressed codes with table lookups**: contiguous, SIMD-friendly, and it fits in cache precisely *because* PQ compressed it 64x. **The ANN accuracy/speed frontier is largely a memory-layout frontier**, which is a satisfying place for this unit to end: the most modern thing in the AI stack is governed by the oldest fact in the handbook.

---

# 5. Complexity theory, the minimum

Enough to be correct and to make decisions. Not more.

## 5.1 The classes, stated correctly

- **P** — decision problems solvable by a deterministic Turing machine in polynomial time.
- **NP** — decision problems whose **"yes" answers have a certificate verifiable in polynomial time.** (Equivalently: solvable by a *nondeterministic* machine in polynomial time. **"NP" is "Nondeterministic Polynomial", not "Non-Polynomial".**)
- **NP-hard** — at least as hard as everything in NP: every NP problem reduces to it in polynomial time. **Need not be in NP, and need not be a decision problem.** The halting problem is NP-hard.
- **NP-complete** — in NP **and** NP-hard. The hardest problems *in* NP.
- **co-NP** — the complements ("no" answers have short certificates). Not known to equal NP.

**A reduction `A ≤_p B`** transforms an instance of `A` into an instance of `B` in polynomial time such that the answers agree. It means **`B` is at least as hard as `A`** — and the direction is what everyone gets backwards. To prove your problem is NP-hard you reduce a *known* NP-hard problem **to** it, not from it.

Cook (1971) and independently Levin (1973) proved SAT is NP-complete; Karp (1972) reduced SAT to 21 more, and the field has been reducing ever since.

## 5.2 The common misstatements

| Wrong | Right |
|---|---|
| "NP means non-polynomial" | NP means *nondeterministic* polynomial. **P ⊆ NP.** Every problem in P is in NP. |
| "NP-complete problems can't be solved in polynomial time" | **Unknown.** That is P vs NP. We have no proof that any NP-complete problem requires super-polynomial time. |
| "NP-hard = NP-complete" | NP-complete ⊂ NP-hard. NP-hard includes undecidable problems and optimisation problems that aren't decision problems. |
| "This problem is NP" (as a difficulty claim) | Being *in* NP is an upper bound on difficulty, not a lower one. Sorting is in NP. |
| "NP-hard means exponential, so give up" | See §5.3. It means *give up on an exact, general, worst-case, efficient algorithm* — four qualifiers, each of which you can drop. |
| "P ≠ NP is proven" | It is the central open problem. Most researchers believe P ≠ NP; nobody has proved it. |
| "Travelling Salesman is NP-complete" | The *decision* version ("is there a tour under length `L`?") is NP-complete. The *optimisation* version is NP-hard and not in NP — you can't verify optimality with a short certificate. |

## 5.3 NP-hardness is practical advice, not despair

**NP-hardness is a statement about the worst case, of a general problem, solved exactly, in polynomial time.** It has four load-bearing qualifiers, and dropping any one is a real algorithm:

**Drop "worst case" → SAT solvers.** Modern CDCL SAT solvers routinely dispatch industrial instances with millions of variables. Hardware verification, program analysis, and dependency resolution all run on them daily. NP-hardness says nothing about *your* instances.

**Drop "general" → parameterised complexity.** Vertex Cover is NP-complete, but solvable in `O(2^k · n)` for cover size `k`. If `k` is small — and in practice it usually is — that is linear time. Whole subfields (treewidth, kernelization) exist here.

**Drop "exact" → approximation with proven bounds.**

| Problem | Approximation | Ratio |
|---|---|---|
| Vertex Cover | Take both endpoints of every edge in a maximal matching | **2** |
| Metric TSP | Christofides (MST + min-cost perfect matching on odd-degree vertices + shortcut) | **1.5** (improved to `1.5 − ε` by Karlin, Klein & Oveis Gharan, 2020) |
| Set Cover | Greedy — repeatedly take the set covering the most uncovered | `ln n`, **and this is optimal unless P = NP** |
| Knapsack | FPTAS by scaling and rounding the values | `1 + ε` for any `ε`, in `O(n³/ε)` |

**Not everything is approximable.** The PCP theorem (Arora, Safra, Lund, Motwani, Sudan, Szegedy, early 1990s) shows many problems are hard to approximate beyond a threshold. General TSP is inapproximable within *any* constant factor unless P = NP. **Knowing which side of that line you're on is the practical payoff of the theory.**

**Drop "polynomial" → heuristics with no guarantee.** Simulated annealing, genetic algorithms, beam search, local search. No bounds, and frequently excellent. Most real schedulers, routers, and placers are here. **And so is essentially all of deep learning**: training a neural network is non-convex optimisation with no guarantee of finding a global optimum, and it is the most economically significant heuristic ever deployed.

> **The right reaction to "this is NP-hard" is not "impossible." It is "I now know which four things I am allowed to give up, and I should pick the cheapest one."** That reframing is the entire practical content of complexity theory for a working engineer, and it is why the topic earns its ~half hour here and not more.

---

# 6. Curriculum

## 6.1 Position in the handbook

```
   memory hierarchy unit
            │   (gives: cache lines, hierarchy latencies, prefetching, TLB)
            ▼
   ┌──────────────────────────────────────────────┐
   │  A. Big-O and the Machine It Assumes         │
   │  B. Layout Is the Algorithm                  │
   │  C. Control Flow Is the Algorithm            │
   │  D. Work, Depth, and the Scan                │
   └──────────────────────────────────────────────┘
            │   (delivers: ideal-cache model, arithmetic intensity via tiling,
            │              SIMD's independence rule, scan as a primitive,
            │              CSR and frontier decomposition)
            ▼
   GPU / CUDA kernel units
```

The dependency is real in both directions. Unit B cannot be taught before the memory hierarchy (it is all cache explanations), and the GPU tiling unit is much harder without Unit A's arithmetic-intensity derivation and Unit D's scan.

## 6.2 The four units

---

### Unit A — Big-O and the Machine It Assumes

**The one idea:** *The cost model you were taught counts operations. The machine charges you for memory movement, and the two disagree by up to three orders of magnitude.*

**Content.** §1 at speed — asymptotic notation and its four abstractions, amortised analysis with the doubling argument, the structure and algorithm tables as reference. Then the pivot: the **ideal-cache model** `(Z, L)`, counting cache-line transfers instead of operations, and the observation that it correctly predicts every result in the following three units while the RAM model predicts none of them.

**Prerequisites:** memory hierarchy unit.
**Deliberately not covered:** proofs, the Master Theorem, recurrence-solving. A student who wants those has CLRS.
**Ends with:** the ratio table of §2.2, measured by the student on their own machine (Exercise 1).

---

### Unit B — Layout Is the Algorithm

**The one idea:** *At every problem size that fits in a real machine, how the data is laid out matters more than the asymptotic complexity of the code that walks it.*

**Content.** §2.1 (linked list vs vector, with the pool-order control), §2.2 (cache knees, measured), §2.4 (B-trees from device physics, and the in-memory B-tree as the same derivation with `L` = cache line), §2.7 (AoS/SoA, struct packing, ECS), §2.8 (hash tables, chaining vs open addressing, Swiss tables' SIMD probing), and §2.3's cache-oblivious material with the **tiling → arithmetic-intensity** derivation as the finale.

**This is the largest unit and the one that must land.** The arithmetic-intensity derivation `AI = T/6, T ≤ √(Z/3)` is the single highest-value transferable result in the whole document.

**Prerequisites:** Unit A.
**Ends with:** the student able to state, without running anything, why a `vector<Particle>` with a 128-byte `Particle` will be ~20x slower than SoA on Apple Silicon and ~5x on x86 — and get the reason right.

---

### Unit C — Control Flow Is the Algorithm

**The one idea:** *The branch predictor is part of your complexity model, and modern compilers have already applied half the fixes — so the skill is recognising when they can't.*

**Content.** §2.6 (branch prediction, the benchmark that no longer reproduces, `cmov`/`csel`, when branchless *loses*), §2.5 (quicksort vs mergesort, introsort/Timsort/pdqsort, branchless partitioning, and radix as the escape from the comparison bound), §2.6's Eytzinger material, §2.9 (SIMD's independence rule, what vectorises and what cannot).

**The deliberate emotional beat:** the student runs the world's most famous performance benchmark and it *doesn't work*. The resolution is in the assembly. This is the unit where reading compiler output becomes a reflex rather than a chore.

**Prerequisites:** Unit B, and the assembly unit.
**Ends with:** SIMD's rule — *lane `i` must not depend on lane `i−1`, and all lanes must do the same thing* — stated in a form that transfers directly to warps.

---

### Unit D — Work, Depth, and the Scan

**The one idea:** *Parallel algorithms are ranked on two axes at once, and prefix sum is the primitive that converts irregular, variable-sized work into regular parallel work.*

**Content.** §3.1 (work-depth, Brent, Amdahl/Gustafson), §3.2 **at length** (Hillis-Steele → Blelloch → decoupled look-back, with the applications table), §3.3 (reduction and Harris's seven versions as a preview of GPU mechanical sympathy), §3.4 (radix sort as *the* GPU sort, and why), §3.5 (segmented operations and the associative flag-operator trick), §3.6 (CSR, frontier BFS, load balancing, direction optimisation). §4 fits here as a lighter closing section, with §4.6's LSH→HNSW bridge pointing at the AI units.

**Prerequisites:** Units A–C.
**Explicitly a bridge:** this unit should end mid-sentence and the first CUDA unit should pick it up. Every concept here reappears there with a new name: block → tile, `Z` → shared memory, `L` → coalesced transaction, lane independence → warp divergence.

---

## 6.3 Machine-checkable exercises

**Backend: Compiler Explorer** (`https://godbolt.org/api/compiler/<id>/compile`), which compiles **and runs** x86-64 and shows assembly. All exercises below were **run on that API during this research** and the stated assertions passed.

**Sandbox properties, verified:**
- ✅ **Single-threaded memory-behaviour benchmarks are reliable and repeatable.** Every ratio below reproduced across runs.
- ⚠️ **~2 vCPUs.** Parallel speedup measurements are meaningless — do not write an exercise that asserts a multi-thread speedup.
- ⚠️ **Memory limit.** `1<<22` elements × 128 B = 512 MB **got SIGKILLed.** Keep working sets under ~256 MB; `1<<20` elements is a safe upper bound for large structs.
- ⚠️ **Absolute times vary run to run** on the shared host. **Assert on ratios, always, and with generous thresholds** (I suggest asserting at roughly half the measured value).

---

**Exercise 1 — Read your own cache hierarchy.** *(Unit A)*
Pointer-chase a random cycle at increasing working-set sizes (§2.2) and print ns/access. **Assert:** the largest size whose latency is within 1.5x of the 8 KiB baseline equals the machine's L1d size; and that some adjacent pair of sizes differs by more than 5x (a knee exists).
*Verified [CE]: 1.90 ns through 32 KiB, 5.00 ns at 64 KiB, 159.7 ns at 16 MiB. Knees at exactly 32 KiB and 512 KiB.*

**Exercise 2 — Linked list vs vector, with the control.** *(Unit B)*
Three traversals over the same node pool: `vector`, list in pool order, list in shuffled order. **Assert `shuffled/vector > 20` at n = 2²¹, AND `pool_order/vector < 10`.** The second assertion is the important one — it forces the student to confront that the structure isn't the problem, the *order* is.
*Verified [CE]: 140.4x shuffled. [M3]: 377x shuffled vs 4.3x pool-order at n=2²⁰.*

**Exercise 3 — AoS vs SoA, and predict the ratio from `sizeof`.** *(Unit B)*
Sum one `float` field over `1<<20` elements at struct sizes 12, 32, 64, 128 B. **Assert the 128-byte case exceeds 3x and the 12-byte case is under 1.3x.** Then have the student *predict* the ratios from `sizeof(struct)/sizeof(float)` capped at the line size, before running it.
*Verified [CE]: 1.01x / 1.19x / 3.66x / 5.19x. The 5.19x reproduces the previously observed 5.2x.*

**Exercise 4 — Naive vs interchanged vs tiled matmul.** *(Unit B)*
`n = 1024`, three versions. **Assert `naive/ikj > 3` and `naive/tiled > 4`.** Then have the student compute the arithmetic intensity `T/6` for `T = 8, 32, 64, 128` and identify which tile sizes satisfy `3T² ≤ Z` for their L1 and L2.
*Verified [CE] n=1024: naive 1649 ms, ikj 242 ms (6.8x), tiled-64 208 ms (8.0x). Note n=512 gives only 3.5x — make the student run both and explain the difference.*

**Exercise 5 — The branch benchmark that doesn't work, then does.** *(Unit C)*
Three parts:
 **(a)** Run the classic sorted-vs-unsorted loop. **Assert the ratio is between 0.9 and 1.2** — i.e. assert that *nothing happens*.
 **(b)** Compile with `-S` and **assert the inner loop's assembly contains `cmov`/`csel` or a SIMD compare (`pcmpgt`/`cmgt`), and contains no conditional jump other than the loop-back edge.** This is the "check the assembly for the absence of a jump" check, and it lands harder because the student didn't write the branchless code — the compiler did.
 **(c)** Replace the branch body with a `noinline` opaque call and re-run. **Assert `unsorted/sorted > 2.0`.**
*Verified [CE]: (a) 1.01x. (c) **6.86x**. [M3]: (a) 1.01x, (c) 2.08x — and the M3/x86 difference is itself worth a discussion question about mispredict penalty.*

**Exercise 6 — Sorting: introsort vs mergesort vs radix.** *(Unit C)*
`1<<22` random ints. **Assert `stable_sort/sort > 1.5` and `sort/radix > 2.0`.** Discussion: the algorithm with the better worst-case bound is 2.4x slower, and the one that isn't a comparison sort at all is 3.4x faster than that.
*Verified [CE]: `std::sort` 413.8 ms, `stable_sort` 997.9 ms (2.41x), radix 121.4 ms (3.41x).*

**Exercise 7 — Binary search layouts, and when prefetching hurts.** *(Unit C)*
Branchy, branchless, Eytzinger, Eytzinger+prefetch, at `n = 2¹⁰` and `n = 2²⁴`. **Assert Eytzinger beats branchy by >1.5x at the large size, AND that prefetching is *slower* than plain Eytzinger at the small size.** The second assertion is the one that teaches something.
*Verified [M3]: at n=2²⁴, branchy 360 ms → Eytzinger 164 ms (2.19x) → +prefetch 75.7 ms (**4.76x**). At n=2¹⁰, prefetch is **6.9x worse** than plain Eytzinger.*

**Exercise 8 — Implement Blelloch scan and verify against a reference.** *(Unit D)*
Implement up-sweep and down-sweep. **Assert (a)** output equals a sequential exclusive-scan reference for `n = 8, 1024, 2²⁰`; **(b)** an instrumented operation counter reports **exactly `3(n−1)`**; **(c)** a Hillis-Steele implementation is also correct and reports **exactly `n log₂ n`**; **(d)** the ratio at `n = 2²⁰` exceeds 6.
*Verified: Blelloch 3,145,725 ops = 3(n−1) exactly; Hillis-Steele 20,971,520 = n·log₂n exactly; ratio **6.67x**. Worked example `{3,1,7,0,4,1,6,3}` → `{0,3,4,11,11,15,16,22}` ✅.*

**Exercise 9 — Hash table: chaining vs open addressing.** *(Unit B)*
Write a ~25-line linear-probing open-addressed map; compare lookup against `std::unordered_map` at `n = 2¹², 2¹⁶, 2²⁰`. **Assert the flat map wins at every size, and that the ratio at 2²⁰ exceeds the ratio at 2¹².** The *widening* is the lesson: the second dependent miss only costs you once the table leaves cache.
*Verified [CE]: 1.35x / 1.55x / 1.41x. [M3]: 1.27x / 1.29x / 2.18x. Note [CE]'s ratio does not widen monotonically on the shared host — **assert only "flat wins at every size" on CE, and make the widening a discussion question rather than an assertion.***

**Exercise 10 — Build CSR with a prefix sum.** *(Unit D, bridge to GPU)*
Given an edge list, build CSR: count degrees, exclusive-scan to get `offsets`, scatter into `targets`. **Assert** the CSR neighbour sets match an `unordered_map<int, set<int>>` reference on a random graph. Then traverse with BFS in both representations and **assert CSR is faster**.
*Not run during this research — the construction is a direct composition of Exercise 8's scan with a counting pass, and both halves are verified. **[exercise design unverified end-to-end]***

---

# 7. Sources, and what I could not verify

## Measured during this research
Every figure labelled **[M3]** or **[CE]** was produced by benchmark code written and run for this document: linked-list/vector traversal, pointer-chase latency curves, AoS/SoA across four struct sizes on two line sizes, the branch-prediction benchmark in four variants plus assembly inspection, matmul at two sizes, four binary-search layouts, hash-table lookup, sorting comparison, and Blelloch/Hillis-Steele correctness and operation counts. Sources are in the session scratchpad (`bench.cpp`, `bench2.cpp`, `t_*.cpp`, `ce.py`).

## Cited literature
- Frigo, Leiserson, Prokop & Ramachandran, *Cache-Oblivious Algorithms*, FOCS 1999 — ideal-cache model, tall-cache assumption, recursive transpose/matmul.
- Hong & Kung, *I/O Complexity: The Red-Blue Pebble Game*, STOC 1981 — the `Θ(n³/(L√Z))` matmul lower bound.
- Bayer & McCreight, *Organization and Maintenance of Large Ordered Indices*, Acta Informatica 1972 — B-trees.
- Musser, *Introspective Sorting and Selection Algorithms*, SP&E 1997 — introsort.
- Edelkamp & Weiß, *BlockQuicksort*, 2016; Orson Peters, **pdqsort** (github.com/orlp/pdqsort) — branchless partitioning; the README confirms the technique and the 12.5%/87.5% bad-partition threshold with a `log n` budget before falling back to heapsort.
- Khuong & Morin, *Array Layouts for Comparison-Based Searching*, arXiv:1509.05053 — Eytzinger beats sorted, B-tree, and van Emde Boas layouts at large `n`.
- Celis, PhD thesis 1986 — Robin Hood hashing.
- Kulukundis, *Designing a Fast, Efficient, Cache-friendly Hash Table, Step by Step*, CppCon 2017 — Swiss tables. Bronson & Shi, *Open-sourcing F14*, Facebook Engineering 2019.
- Hillis & Steele, *Data Parallel Algorithms*, CACM 1986. Blelloch, *Prefix Sums and Their Applications*, CMU-CS-90-190, 1990.
- Harris, Sengupta & Owens, *Parallel Prefix Sum (Scan) with CUDA*, GPU Gems 3 ch. 39. Merrill & Garland, *Single-pass Parallel Prefix Scan with Decoupled Look-back*, NVIDIA, 2016.
- Merrill & Grimshaw, *High Performance and Scalable Radix Sorting*, 2011. Merrill, Garland & Grimshaw, *Scalable GPU Graph Traversal*, PPoPP 2012. Beamer, Asanović & Patterson, *Direction-Optimizing BFS*, SC 2012.
- Bloom 1970; Fan, Andersen, Kaminsky & Mitzenmacher, *Cuckoo Filter*, CoNEXT 2014.
- Cormode & Muthukrishnan, *An Improved Data Stream Summary: The Count-Min Sketch*, 2005.
- Flajolet, Fusy, Gandouet & Meunier, *HyperLogLog*, AofA 2007; Heule, Nunkesser & Hall, *HyperLogLog in Practice* (HLL++), EDBT 2013.
- Pugh, *Skip Lists*, CACM 1990. Vitter, *Random Sampling with a Reservoir*, TOMS 1985.
- Indyk & Motwani, STOC 1998 (LSH); Charikar, STOC 2002 (SimHash); Malkov & Yashunin, *HNSW*, TPAMI 2018.
- Cook 1971, Levin 1973, Karp 1972; Christofides 1976; Karlin, Klein & Oveis Gharan, *A (slightly) improved approximation algorithm for metric TSP*, STOC 2021.
- Langdale & Lemire, *Parsing Gigabytes of JSON per Second*, VLDB J. 2019. Blacher et al., *Vectorized and performance-portable Quicksort*, 2022.
- Talks: Chandler Carruth, *Efficiency with Algorithms, Performance with Data Structures*, CppCon 2014. Mike Acton, *Data-Oriented Design and C++*, CppCon 2014. Mark Harris, *Optimizing Parallel Reduction in CUDA*, NVIDIA.

## Explicitly not verified
- **Storage and network latencies** in §2.2's ratio table (SSD, HDD, datacenter RTT). Taken from vendor datasheets and Dean's list; **not measured here**. The CPU-side rows *were* measured.
- **`absl::flat_hash_map` / F14 speedup multiples** over `std::unordered_map`. The direction is well-established and the mechanism is documented; specific published factors could not be confirmed against a primary source, so only my own 1.3x–2.2x measurements are quoted.
- **pdqsort's speedup over `std::sort`.** The README has a graph and no table. The widely-repeated "2–3x" is **omitted** rather than repeated.
- **Vectorised quicksort's ~10x** — cited to Blacher et al., not measured.
- **GPU throughput figures** (radix sort keys/sec, direction-optimizing BFS speedups). No GPU was available; all §3 GPU performance claims are qualitative or cited.
- **`absl::btree_map` vs `std::map` factors.** Direction established, multiples not verified.
- **Exercise 10** (CSR construction) was designed but not run end-to-end.
- Jeff Dean's original latency list is **not** reproduced as-is; one online interactive version I fetched during this research returned unit-mangled values (main memory as 100,000 ns), which is a good illustration of why §2.2 measures instead of quoting.

## Two caveats on the measurements themselves
1. **[CE] runs on a shared ~2 vCPU host.** Absolute times fluctuate; ratios within a single run are stable and reproduced across runs. Every assertion in §6.3 is on a ratio with margin.
2. **[M3] has a 128-byte cache line and no L3.** Several ratios differ substantially from x86 as a direct consequence, which is a feature of this document rather than a defect — but a reader must not port an M3 absolute number to an x86 expectation.
