# Networking and the Internet, From the Wire Up

Research notes for a from-first-principles computing curriculum. Assumes the learner already
has Linux syscalls, C++, and GPU architecture. Two destinations, reached by one road:

- **"What actually happens when I type a URL"** — the general path, end to end, in order.
- **"How do 512 GPUs talk during distributed training"** — the specific path, with arithmetic.

The bet of this document is that these are the *same* subject. An all-reduce over InfiniBand and
a `GET /` over TCP differ in almost every constant and in almost no concept: both are a descriptor
ring, a DMA engine, a flow-control window, a completion notification, and a decision about who
copies the bytes.

---

## Provenance

**Executed live during this research.** Every runtime claim, every measured number, and every
exercise below was compiled and *run* against the Compiler Explorer execution API
(`https://godbolt.org/api/compiler/g152/compile`, GCC 15.2, `executorRequest: true`). The sandbox
turned out to be far more capable than expected, which reshaped the exercise design. Verified
capabilities, with the probe results, are in §8.

**Fetched from primary sources.** RFCs from `rfc-editor.org`, kernel documentation from
`docs.kernel.org`, NVIDIA documentation from `docs.nvidia.com` and `developer.nvidia.com`.
Every quoted formula and spec number below has a link in §10.

**Constraint discovered, not assumed.** The brief anticipated that outbound network access is
blocked from the sandbox. That is confirmed — `connect()` to `1.1.1.1:80` returns `-1` with
`errno=101 (ENETUNREACH)`. But *loopback TCP is fully functional*, `epoll` works, `io_uring` works,
and `TCP_INFO` reports live congestion-window state. This means the curriculum does not have to
retreat to simulation. It can observe the real kernel TCP stack.

**Flagged as unverified.** §9 lists what could not be checked and what is likely to go stale.

---

## Contents

| § | Section | The idea |
|---|---|---|
| 1 | [The Physical and Link Layer](#1-the-physical-and-link-layer) | A frame is a byte layout; a NIC is a descriptor ring with a doorbell |
| 2 | [IP and Routing](#2-ip-and-routing) | A network is a lookup table; the internet is 75,000 of them |
| 3 | [TCP, Properly](#3-tcp-properly) | Two feedback loops: one told its limit, one that must infer it |
| 4 | [Sockets — The Programmer's View](#4-sockets--the-programmers-view) | Every I/O API answers one question: who waits, and how many at once |
| 5 | [DNS, HTTP and TLS](#5-dns-http-and-tls--the-type-a-url-path) | A URL costs six round trips; every protocol revision deletes one |
| 6 | [The GPU-Cluster Networking Layer](#6-the-gpu-cluster-networking-layer) | Cost = bytes / bandwidth of the slowest link crossed |
| 7 | [Curriculum — Six Units](#7-curriculum--six-units-in-dependency-order) | 35 machine-checkable exercises, 12 verified running |
| 8 | [Sandbox Capabilities](#8-sandbox-capabilities--probed-not-assumed) | What Compiler Explorer actually allows |
| 9 | [What Could Not Be Verified](#9-what-could-not-be-verified) | 16 flagged items |
| 10 | [Sources](#10-sources) | RFCs, kernel docs, NVIDIA docs, executed code |

**The three results worth jumping to:** the Nagle/delayed-ACK deadlock reproduced at
[40.6 ms per iteration](#37-nagle-and-delayed-ack--the-pathology-reproduced) with no network; the
[full URL walkthrough](#57-what-actually-happens-in-order-from-typing-the-url-to-pixels) in 33
steps; and the [all-reduce arithmetic](#67-why-the-network-is-often-the-bottleneck--the-arithmetic)
showing 61% → 87% → 98% scaling efficiency on identical hardware.

---

## 1. The Physical and Link Layer

### 1.1 What is actually on the wire

Ethernet does not transmit "a frame". It transmits a continuous electrical or optical signal in
which a frame is a delimited interval. The full on-wire structure, with byte counts verified
against the IEEE 802.3 field layout:

```
  <---------------------- Layer 1 packet ------------------------>
  +----------+-----+------+------+------+-------------+-----+        +-----+
  | Preamble | SFD | Dst  | Src  | Type |   Payload   | FCS |  IPG   | ... |
  |    7     |  1  |  6   |  6   |  2   |  46 - 1500  |  4  |   12   |
  +----------+-----+------+------+------+-------------+-----+        +-----+
             <------------- Layer 2 frame: 64 - 1518 ------------->
```

- **Preamble (7 B)** — `0xAA` repeated: alternating `1010…`. This is not data. It is a clock. The
  receiver has no separate clock line, so it recovers timing from the transitions in the preamble
  (clock and data recovery, CDR). By the end of the preamble the receiver's PLL is locked to the
  sender's bit rate.
- **SFD (1 B)** — `0xAB`: the pattern breaks (`…1010` `1011`), and that break says "the next bit
  is byte 0 of the frame." Byte alignment, not just bit alignment.
- **Dst / Src MAC (6 B each)** — 48 bits. Top 24 bits are the OUI (organizationally unique
  identifier, assigned by IEEE); bottom 24 are vendor-assigned. Bit 0 of the first byte is the
  I/G bit: 1 means multicast (`ff:ff:ff:ff:ff:ff` = broadcast). Bit 1 is the U/L bit: 1 means
  locally administered, which is what your laptop sets when it randomizes its MAC for Wi-Fi
  privacy.
- **EtherType (2 B)** — `0x0800` IPv4, `0x86DD` IPv6, `0x0806` ARP, `0x8100` 802.1Q VLAN tag
  (which inserts 4 more bytes and pushes max frame to 1522).
- **Payload (46–1500 B)** — 1500 is *the* MTU, and the reason so much of networking is shaped
  around a number chosen in 1980 as a compromise between buffer cost and efficiency.
- **FCS (4 B)** — CRC-32, polynomial `0x04C11DB7` (reflected: `0xEDB88320`), init and final XOR
  `0xFFFFFFFF`. Computed by the NIC in hardware, checked by the receiving NIC in hardware. A frame
  that fails FCS is dropped silently at the MAC layer and counted in an error counter you will
  never look at until something is wrong.
- **IPG (12 B of idle)** — the interpacket gap, 96 bit times. Not optional. It gives the receiver
  time to finish frame processing and re-arm.

**The minimum frame is 64 bytes**, which is why payloads below 46 bytes get zero-padded. The
reason is CSMA/CD collision detection on the original shared-medium Ethernet: a frame had to be
long enough that a sender was still transmitting when a collision from the far end of a maximum-
length segment propagated back. Modern switched full-duplex Ethernet has no collisions at all, but
the 64-byte minimum survives, because the frame format is the format.

**The number that matters for performance work:** minimum on-wire cost is
`8 (preamble+SFD) + 64 (frame) + 12 (IPG) = 84 bytes = 672 bits`.

```
10 Gb/s  / 672 bits = 14,880,952 packets/sec  ->  67.2 ns per packet
 1 Gb/s  / 672 bits =  1,488,095 packets/sec  -> 672.0 ns per packet
```

At 3 GHz, 67.2 ns is about **200 CPU cycles per packet**. Hold onto that number — it is the entire
justification for §4.6 (kernel bypass). The Linux network stack costs roughly 1–2 µs per packet,
which is 15–30x the time budget at 10 GbE line rate with minimum-size frames.

### 1.2 Hubs, switches, routers — three different machines

| | Hub | Switch | Router |
|---|---|---|---|
| Layer | 1 (electrical) | 2 (frames) | 3 (packets) |
| Decision input | none | destination MAC | destination IP |
| Table | none | MAC/CAM table (learned) | routing table (configured/learned) |
| Collision domains | 1 (shared) | 1 per port | 1 per port |
| Broadcast domains | 1 | 1 (per VLAN) | 1 per interface |
| Rewrites the frame? | no | no | **yes** — new src/dst MAC, decrements IP TTL, recomputes IP checksum |

A **hub** is an electrical repeater. A signal arriving on any port is amplified and reproduced on
every other port. All ports share one collision domain; two simultaneous senders corrupt each
other. Hubs are extinct, and understanding why they died explains what a switch *is*.

A **switch** is a hub that learned to read. It maintains a forwarding table (historically a CAM,
content-addressable memory; now usually a TCAM or hash table in ASIC SRAM) mapping MAC address →
egress port. Learning is passive and requires no protocol: when a frame arrives on port 3 with
source MAC `X`, the switch writes `X → 3`. When a frame arrives destined for `X`, it is sent only
to port 3. If the destination is unknown, the switch **floods** it to all ports except the ingress
— which is how the first packet of any conversation works, and why a switch degrades to a hub
under CAM-table overflow (the basis of the classic MAC-flooding attack).

Two forwarding disciplines:

- **Store-and-forward** — receive the entire frame, verify FCS, then forward. Latency includes the
  full serialization time of the frame (1500 B at 10 Gb/s = 1.2 µs). Corrupt frames never
  propagate.
- **Cut-through** — begin forwarding as soon as the 6-byte destination MAC has arrived. Latency
  can be ~300 ns regardless of frame size. Corrupt frames *do* propagate (the switch has already
  sent the head before the FCS arrives). This is what low-latency trading and HPC switches do.

A **router** terminates the link layer. It strips the Ethernet frame entirely, looks up the
destination IP in the routing table (longest-prefix match), decrements the TTL, recomputes the IP
header checksum, and builds a **new** Ethernet frame for the next hop with a new source MAC (its
own egress port) and a new destination MAC (the next-hop router, found via ARP). This is the single
most important fact about layering: **MAC addresses are hop-local and change at every router; the
IP addresses do not change end to end** (NAT excepted, §2.6).

### 1.3 What a NIC actually is, as hardware

A modern NIC is a DMA-capable PCIe device that is best understood as a coprocessor with two ring
buffers per queue pair. It is not "a thing that gives you packets." It is a thing that writes into
your memory and then tells you it did.

#### Descriptors and rings

The driver allocates a **descriptor ring**: a physically contiguous circular array of fixed-size
descriptors, and tells the NIC its base address and length by writing to a BAR-mapped register.
Each descriptor is roughly:

```c
struct rx_desc {
    uint64_t buffer_addr;   // DMA (bus) address of a page/fragment the NIC may write into
    uint16_t length;        // filled by NIC: bytes written
    uint16_t checksum;      // filled by NIC: L4 checksum result or raw sum
    uint8_t  status;        // DD (descriptor done), EOP (end of packet), checksum-ok bits
    uint8_t  errors;
    uint16_t vlan_tag;      // stripped VLAN, if offloaded
};
```

Two indices govern the ring, and they live in different places:

- **Head** — owned by the NIC, advanced by the NIC as it consumes descriptors.
- **Tail** — owned by the driver, advanced by writing an MMIO register (a "doorbell").

For RX, the driver *posts empty buffers*: it fills descriptors with DMA addresses of free pages and
bumps the tail. The NIC consumes from head. The ring is a producer/consumer queue where the
producer is software and the consumer is silicon. For TX it is the reverse. When the NIC completes
a descriptor it sets the DD (descriptor done) status bit **in host memory via DMA**, so the driver
can poll a cache line instead of reading across PCIe (an MMIO read costs on the order of a
microsecond; a cache-line read of DMA'd memory costs nanoseconds).

#### "The driver gets a packet", concretely

Here is the actual sequence, which is worth memorizing because it is the template for RDMA,
GPUDirect, io_uring and NVMe alike:

1. Bits arrive on the wire. The PHY recovers the clock, deserializes, and hands bytes to the MAC.
2. The MAC checks the FCS and the destination MAC (against its unicast address, its multicast
   filter, and promiscuous mode). Non-matching frames are dropped in hardware.
3. **RSS** hashes the packet's 5-tuple (or 4-tuple) to select a receive queue (§1.5).
4. The NIC picks the next descriptor from that queue's RX ring and **DMAs the frame body directly
   into host RAM** at `buffer_addr` — into the page the driver posted, without the CPU touching it.
   On modern Intel systems with DDIO / DCA the write may land in L3 rather than DRAM.
5. The NIC DMAs the writeback (length, status=DD, checksum result) into the descriptor.
6. The NIC raises an **MSI-X interrupt** — a posted PCIe memory write to an address the OS
   programmed, which the interrupt controller turns into a vector on a specific CPU. MSI-X gives
   each queue its own vector, hence its own CPU, hence no shared lock.
7. The driver's ISR does almost nothing: it **masks the interrupt** and calls `napi_schedule()`.
8. Softirq context runs the driver's `poll()` function with a **budget**. Kernel documentation:
   *"drivers can process completions for any number of Tx packets but should only process up to
   `budget` number of Rx packets"* — because *"Rx processing is usually much more expensive."*
9. `poll()` walks descriptors with DD set, wraps each buffer in an `sk_buff`, hands it to
   `napi_gro_receive()`, and posts fresh empty buffers to replace the consumed ones.
10. When the ring is drained, the driver calls `napi_complete_done()` and **only then** re-enables
    the interrupt. Kernel docs: *"IRQ should only be unmasked after a successful call to
    `napi_complete_done()`."*

**This is NAPI, and it is the whole trick.** Under low load you get interrupt-driven latency. Under
high load, the interrupt stays masked and the kernel polls — because after the first packet of a
burst there is no point being told about the second. NAPI is adaptive interrupt-vs-poll, and it is
why Linux does not livelock under a packet flood the way pre-2001 stacks did.

#### Interrupt coalescing

Even NAPI's first interrupt costs ~1–2 µs (vector dispatch, cache pollution, pipeline flush). NICs
therefore delay interrupts:

- `rx-usecs` — wait this many microseconds after the first packet before interrupting.
- `rx-frames` — or interrupt after this many packets, whichever comes first.
- `adaptive-rx` — let the driver retune based on observed rate.

All settable via `ethtool -C`. This is a **pure latency-vs-CPU trade**: 50 µs coalescing on a
storage or trading path is a disaster; on a bulk-transfer path it is free throughput.

Linux also implements coalescing in software: *"`gro_flush_timeout` … is reused to control the
delay of the timer, while `napi_defer_hard_irqs` controls the number of consecutive empty polls
before NAPI gives up and goes back to using hardware IRQs."*

#### Offloads

The NIC does work the CPU would otherwise do. Each offload is a small lie the kernel tells itself:

| Offload | Direction | What the NIC does | What the kernel pretends |
|---|---|---|---|
| **Checksum offload** | both | Computes/verifies IP + TCP/UDP checksums | `CHECKSUM_UNNECESSARY` / `CHECKSUM_PARTIAL` — kernel writes a pseudo-header sum and lets the NIC finish |
| **TSO** (TCP Segmentation Offload) | TX | Splits one huge buffer into MSS-sized segments, replicating and incrementing headers | The stack pushed one 64 KB "packet" |
| **GSO** (Generic Segmentation Offload) | TX | *Software* fallback: kernel defers segmentation to the last moment before the driver | Same, but works on any NIC |
| **LRO** (Large Receive Offload) | RX | Merges consecutive segments into one big buffer, **lossily** (may discard header differences) | Received one big packet |
| **GRO** (Generic Receive Offload) | RX | *Software*, in NAPI: merges only when strictly reversible | Same, but forwarding-safe |

**The distinction that matters:** LRO is not safe on a router or bridge, because it destroys
information and the merged packet cannot be re-segmented into what arrived. GRO has strict merge
criteria and is reversible via GSO, so a Linux box that forwards or bridges can run GRO and must
not run LRO. This is why virtualization and container hosts default to GRO.

**Why offloads matter enormously:** a 64 KB TSO write becomes ~44 packets of 1448 B. The stack
traversal cost — socket lookup, congestion-control math, routing lookup, `sk_buff` allocation — is
paid **once instead of 44 times**. TSO/GRO are, empirically, the difference between ~4 Gb/s and
line-rate 40 Gb/s on a single core.

### 1.4 A NIC's most modern trick: it has become a switch

On any multi-tenant or GPU node, the NIC also does **SR-IOV**: it exposes multiple PCIe Virtual
Functions, each with its own queues, MAC and interrupts, that can be assigned directly to a VM or
container. The hypervisor is removed from the data path entirely. The NIC's embedded switch (the
"e-switch") forwards between VFs and the wire. This is the same architectural move as GPUDirect
(§6.4): the device does the work, and the CPU is removed from the path rather than optimized on it.

### 1.5 RSS and multiqueue

A single 100 Gb/s NIC cannot be serviced by one core. **RSS (Receive Side Scaling)** is the
hardware fix. From the kernel scaling documentation:

> *"The receive queue for a packet is determined by indexing the indirection table with the low
> order bits of the computed hash for the packet (usually a Toeplitz hash)."*

The hash is over the flow tuple — `(src IP, dst IP, src port, dst port)` for TCP/UDP, or just the
IP pair for other protocols. The **indirection table** (NICs *"should provide an indirection table
at least 4 times larger than the queue count"*) maps hash buckets to queues, which decouples the
queue count from a power of two and allows re-weighting without changing the hash.

The critical property: **all packets of one flow hash to one queue, hence one CPU.** That gives
per-flow ordering for free (TCP reordering is a performance disaster) and lets each core own its
ring lock-free.

The software family that surrounds it:

- **RPS** — *"the software equivalent of RSS"*, selecting a CPU after the driver, for NICs without
  RSS. Works on any NIC.
- **RFS** — RPS plus application locality: *"the hash is used as index into a flow lookup table.
  This table maps flows to the CPUs where those flows are being processed"* — so the packet is
  processed on the core where `recvmsg()` will be called, and the data is already in the right L2.
- **Accelerated RFS** — RFS pushed down into hardware via the driver's `ndo_rx_flow_steer`, so the
  NIC itself steers to the right core. *"Accelerated RFS should perform better than RFS since
  packets are sent directly to a CPU local to the thread consuming the data."*
- **XPS** — the transmit side, mapping CPUs (or RX queues) to TX queues to *"reduce contention on
  the device queue lock."*

**Symmetric RSS** matters for stateful middleboxes: by XOR-ing the address/port pairs before
hashing, both directions of a connection land on the same queue, so a firewall or IDS sees both
halves of a flow on one core.

### 1.6 Fibre vs copper, and the floor set by physics

| | Twisted pair (Cat6a) | DAC (twinax) | Multimode fibre | Single-mode fibre |
|---|---|---|---|---|
| Max reach | 100 m @ 10G | 3–7 m | 100 m @ 100G (OM4) | 10–80+ km |
| Latency/m | ~4.3–5.1 ns | ~4.3 ns | ~5.0 ns | ~4.9 ns |
| Power/port | high (PHY DSP) | very low (passive) | moderate | moderate |
| Cost | low | very low | moderate | high (optics) |

Copper Ethernet's latency is dominated not by propagation but by the **PHY**: 10GBASE-T uses
PAM-16 signalling with LDPC forward error correction, and the decoder alone adds ~2 µs of latency
per link. This is why data centres use DAC for in-rack and fibre for everything else, and why
10GBASE-T is nearly absent from HPC.

**The floor.** Light in vacuum: 299,792 km/s. Silica fibre has a group index around 1.468 at
1550 nm, so:

```
v = 299,792 / 1.468 = 204,220 km/s
delay = 1 / 204,220 s/km = 4.90 microseconds per kilometre
```

Round-trip, that is **~9.8 µs per km of separation**. Nothing you buy changes this. Consequences:

- **New York → London.** Great-circle 5,585 km; real cable routes ~6,600 km. One way ≈ 32 ms,
  RTT ≈ 65 ms, before a single router touches it. Measured RTTs of 70–80 ms are therefore mostly
  *physics*, not congestion.
- **Within a rack**, 3 m of DAC is 15 ns. Switch and NIC latency (300 ns–1 µs) dominates by 20–60x.
  Inside a data centre you optimize devices; across an ocean you optimize round trips. **This is the
  single reason TLS 1.3 and QUIC and HTTP/2 exist**: they are all, fundamentally, attempts to
  delete round trips, because a round trip is the one thing you cannot make faster.
- **Microwave beats fibre.** Light in air is ~1.0003x slower than vacuum vs 1.468x in glass. On the
  Chicago–New Jersey path, microwave relay is ~4 ms faster round trip than the best fibre. HFT
  firms have built literal towers for this. Physics is the product.

The other two delay terms, for completeness:

- **Serialization delay** = frame bits / link rate. 1500 B at 1 Gb/s = 12 µs; at 100 Gb/s = 120 ns.
- **Queueing delay** = the only unbounded term, and therefore the only one congestion control can
  do anything about (§3.6).

---

## 2. IP and Routing

### 2.1 IPv4

32 bits, written as four dotted decimal octets. The header is 20 bytes without options:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|Version|  IHL  |    DSCP   |ECN|          Total Length          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Identification        |Flags|      Fragment Offset     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Time to Live |    Protocol   |         Header Checksum        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Source Address                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Destination Address                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

Fields worth understanding rather than memorizing:

- **IHL** — header length in 32-bit words. Minimum 5 (20 bytes). This is why options are rare:
  every router must handle the variable length, and fast paths punt options to the slow path.
- **DSCP/ECN** — the old "Type of Service" byte. The bottom 2 bits are **ECN**, and they matter:
  `11` (CE, Congestion Experienced) is a router telling the endpoints it is congested *without
  dropping the packet*. ECN is how modern datacentre congestion control (DCTCP, and RoCE's DCQCN
  in §6.3) avoids loss entirely.
- **TTL** — decremented by every router. At zero the packet is dropped and an ICMP Time Exceeded is
  returned. This is a loop-breaker, and it is the entire mechanism behind traceroute (§2.7).
- **Header Checksum** — RFC 1071 one's-complement sum, over the header only, **recomputed at every
  hop** because TTL changes. IPv6 deleted this field entirely, on the reasoning that L2 has a CRC
  and L4 has a checksum, so the L3 one is redundant work at every router.

**The internet checksum** (RFC 1071) is worth implementing because it has a lovely property:
summing a buffer that already contains its own correct checksum yields zero. Verified live:

```
computed IPv4 header checksum       = 0x5303
inet_cksum over header incl. cksum  = 0x0000   <- the verification identity
full header: 45 00 00 3c 1c 46 40 00 40 06 53 03 0a 00 00 04 c0 a8 00 c7
```

It is one's-complement addition (with end-around carry) of 16-bit big-endian words, then bitwise
NOT. Its weakness — it cannot detect word reordering or compensating errors — is exactly why
Ethernet also carries a CRC-32.

### 2.2 Subnets and CIDR

An IP address is not one number. It is `(network, host)`, and the split is given by the prefix
length:

```
    192.168.1.130 / 26
    11000000.10101000.00000001.10000010
    |<------ network: 26 bits ----->|<-->| host: 6 bits

    mask     255.255.255.192  = /26
    network  192.168.1.128
    broadcast192.168.1.191
    usable   192.168.1.129 - 192.168.1.190   (2^6 - 2 = 62 hosts)
```

**CIDR** (Classless Inter-Domain Routing, 1993) replaced the fixed class A/B/C split, and it did
two things. First, it allowed prefixes of any length, ending the absurdity of a company needing
300 addresses being handed a /16 (65,536). Second, and more importantly, it enabled
**route aggregation**: an ISP holding `203.0.0.0/16` can advertise one route to the world instead
of 256 /24s. Without aggregation, the global routing table would be unmanageable — with it, it is
merely alarming (~1M IPv4 prefixes as of the mid-2020s).

**Longest-prefix match** is the forwarding rule. Given routes `10.0.0.0/8`, `10.1.0.0/16`, and
`10.1.2.0/24`, a packet to `10.1.2.3` takes the /24. More specific always wins, regardless of
table order. This is what makes routing composable: a general route can be overridden locally
without coordination. It is also why routers use TCAMs or tries (LC-trie, DIR-24-8) rather than
hash tables — a hash cannot do "longest prefix", only "exact".

Reserved ranges you must recognize on sight: `10/8`, `172.16/12`, `192.168/16` (RFC 1918 private),
`127/8` (loopback), `169.254/16` (link-local / APIPA — the address you get when DHCP fails),
`100.64/10` (carrier-grade NAT), `224/4` (multicast).

### 2.3 IPv6

128 bits, written as eight groups of four hex digits, with one run of zeros collapsible to `::`.
`2001:0db8:0000:0000:0000:0000:0000:0001` → `2001:db8::1`.

What actually changed, beyond the address size:

- **Fixed 40-byte header.** No IHL, no options — extension headers are a linked list *after* the
  base header, so routers can parse a constant-size header on the fast path.
- **No header checksum.** Removed as redundant (see §2.1).
- **No router fragmentation.** Only the source may fragment, via a Fragment extension header.
  Routers that need to fragment must drop and send ICMPv6 Packet Too Big. Minimum MTU is 1280 B.
- **SLAAC** — a host can self-configure: it hears a Router Advertisement carrying a /64 prefix and
  appends its own 64-bit interface identifier, no DHCP server required. RFC 8981 privacy addresses
  randomize and rotate that identifier so the host is not trackable by its MAC.
- **ARP is gone**, replaced by NDP over ICMPv6 (§2.4).
- **Every host typically has several addresses**: a link-local `fe80::/10` (always), one or more
  global unicast, and multicast group memberships. Address *selection* (RFC 6724) becomes a real
  algorithm rather than an afterthought.

### 2.4 ARP and NDP — the layer-2/layer-3 join

You have an IP for the next hop. You need a MAC to put in the frame. That gap is what ARP fills.

**ARP (IPv4, RFC 826)** — broadcast `who-has 192.168.1.1 tell 192.168.1.50` to
`ff:ff:ff:ff:ff:ff`; the owner unicasts back `192.168.1.1 is-at aa:bb:cc:dd:ee:ff`. Cached, with a
timeout on the order of a minute. ARP has **no authentication whatsoever** — any host may answer
for any address, which is ARP spoofing, and it is why switch-level protections (dynamic ARP
inspection, port security) exist. Gratuitous ARP (announcing your own mapping unsolicited) is how
failover VIPs move between machines.

**NDP (IPv6, RFC 4861)** — the same job over ICMPv6, using *multicast* rather than broadcast:
Neighbor Solicitation is sent to the solicited-node multicast group derived from the low 24 bits
of the target address, so on a switch with MLD snooping only the target's NIC is disturbed. NDP
also carries Router Solicitation/Advertisement (default gateway and prefix discovery, i.e. what
DHCP did in v4) and Duplicate Address Detection. SEND (RFC 3971) adds cryptographic protection;
essentially nobody deploys it.

### 2.5 Fragmentation, MTU and PMTUD

An IPv4 router that receives a packet larger than the egress MTU may fragment it: split the payload
into pieces, copy the header onto each, set the fragment offset (in 8-byte units), and set the MF
(More Fragments) flag on all but the last. **Reassembly happens only at the destination**, using
`(src, dst, protocol, identification)`.

Fragmentation is bad, for reasons worth spelling out:

1. **Loss amplification.** Lose one fragment and the entire original packet is lost. An 8-fragment
   packet on a 1%-loss path has an ~8% effective loss rate.
2. **No L4 header on fragments 2..n.** Only the first fragment carries the TCP/UDP ports, so
   firewalls, NAT and RSS cannot classify the rest. Many networks simply drop non-initial
   fragments.
3. **Reassembly is a DoS surface.** The receiver must buffer fragments with a timer. Overlapping-
   fragment attacks (teardrop) and resource exhaustion both live here.
4. **The 16-bit identification field** wraps quickly at high rates, risking mis-reassembly.

**PMTUD (Path MTU Discovery, RFC 1191)** avoids it: set the **DF (Don't Fragment)** bit on
everything. If a router cannot forward, it drops the packet and returns
**ICMP Type 3 Code 4 — Destination Unreachable / Fragmentation Needed**, which carries the
next-hop MTU. The sender caches this per destination and reduces its MSS.

**And this is where it breaks.** Overzealous firewalls block all ICMP. The sender never learns, so
it retransmits full-size packets forever, and the connection **hangs after the handshake completes
successfully** — small packets pass, the first full-size data packet vanishes. This is the
"ICMP black hole", and it is one of the most confusing failure modes in networking precisely
because the symptom (works, then silently stalls) does not resemble the cause (a dropped ICMP
message on a third machine).

Symptoms are classic: SSH connects then freezes on the banner; HTTPS handshakes then hangs on the
certificate; small pings work and `ping -s 1472` does not. Mitigations: **PLPMTUD** (RFC 4821),
which probes with progressively larger packets and needs no ICMP at all, and **MSS clamping**,
where a middlebox rewrites the MSS option in passing SYNs (universal on PPPoE, where the MTU is
1492, and on VPN tunnels).

**MTU arithmetic worth having memorized:**

```
Ethernet payload           1500
  - IPv4 header             -20  = 1480
  - TCP header              -20  = 1460   <- classic IPv4 MSS
  - TCP timestamps option   -12  = 1448   <- what Linux actually sends
IPv6:  1500 - 40 - 20 = 1440;  with timestamps 1428
Jumbo frames               9000 (datacentre / storage; must be end-to-end consistent)
Loopback                  65536 (verified: TCP_INFO reported snd_mss = 65483)
WireGuard overhead          -60;  IPsec/ESP  -50..-73;  VXLAN -50;  GRE -24
```

### 2.6 ICMP

Not "ping". ICMP is IP's control plane, and blocking it wholesale breaks the internet in subtle
ways (see PMTUD above).

| Type | Name | Why it matters |
|---|---|---|
| 0 / 8 | Echo Reply / Request | `ping` |
| 3 | Destination Unreachable | Code 4 = **Fragmentation Needed** (PMTUD); Code 3 = Port Unreachable, which is how UDP signals "nothing listening" and how classic traceroute knows it has arrived |
| 5 | Redirect | "use a better gateway" — a security hazard, usually disabled |
| 11 | Time Exceeded | TTL hit zero — **the entire basis of traceroute** |

ICMP messages carry the IP header plus the first 8 bytes of the original datagram, so the sender
can attribute the error to a specific socket. Eight bytes is exactly enough for the TCP/UDP source
and destination ports plus the sequence number.

### 2.7 What a traceroute is really showing you

The trick: send packets with **TTL = 1, 2, 3, …**. Each dies one hop further out, and each router
that kills one returns ICMP Time Exceeded **from its own address**. Collect the sources and you
have a path.

What it is *not* showing you:

- **Not necessarily one path.** ECMP (equal-cost multipath) hashes each flow to a different next
  hop. Classic traceroute varies the UDP destination port per probe, so **each probe may take a
  different physical route.** The "path" printed can be a chimera assembled from several. Paris
  traceroute fixes this by holding the flow tuple constant and varying fields outside the hash.
- **Not the return path.** Each ICMP reply travels back by its own route, which may be entirely
  different. Internet routing is frequently asymmetric. A latency spike at hop 7 might live on the
  return path from hop 7, not on the forward path at all.
- **Not a reliable latency profile.** Routers generate ICMP errors on a slow-path CPU, often
  heavily rate-limited and deprioritized. **High latency or stars at an intermediate hop mean
  nothing if the hops after it are fast.** Only the final hop's RTT is a real measurement.
- **Not complete.** MPLS-tunnelled segments may appear as one hop or as none. Firewalls may drop
  the probes or the ICMP replies. Some routers reply with an address from an unrelated interface.

Three implementations, worth knowing apart: **UDP to high ports** (classic Unix; arrival detected
by ICMP Port Unreachable), **ICMP Echo** (Windows `tracert`; better firewall traversal), and
**TCP SYN to port 80/443** (`tcptraceroute`; best of all through filters, because it looks like
traffic anyone would allow).

### 2.8 NAT and what it breaks

NAT rewrites addresses in flight. The dominant form is **NAPT / PAT** (what everyone means by
"NAT"): many private hosts share one public IP, disambiguated by rewriting the **source port**.

```
inside                          NAT table                        outside
192.168.1.50:51234  --->  (192.168.1.50:51234) <-> (203.0.113.7:40001)  ---> 93.184.215.14:443
192.168.1.51:51234  --->  (192.168.1.51:51234) <-> (203.0.113.7:40002)  ---> 93.184.215.14:443
```

The NAT must rewrite the IP addresses, the TCP/UDP ports, **and recompute both checksums** (the
L4 checksum covers a pseudo-header containing the IP addresses — this is the one place the layering
is deliberately violated, and NAT is the reason it hurts).

What NAT breaks, and why each one matters:

1. **Inbound connections.** There is no mapping until the inside host creates one. This is why
   peer-to-peer is hard and why we have STUN/TURN/ICE, UPnP/NAT-PMP/PCP, and hole punching.
2. **Protocols that embed addresses in their payload.** FTP's `PORT` command, SIP, H.323 all carry
   IP addresses *inside* the data stream. NAT must deep-inspect and rewrite them — an **ALG**
   (Application Layer Gateway) — which is fragile, breaks under encryption, and has produced a long
   list of CVEs.
3. **End-to-end integrity.** IPsec AH authenticates the IP header, so any NAT invalidates it.
   NAT-T (UDP encapsulation on port 4500) exists purely to work around this.
4. **State and timeouts.** The NAT holds per-flow state, so it is a failure domain and a scaling
   limit. Idle TCP mappings are reaped (often 5 minutes to 2 hours), which is why long-lived idle
   connections die silently and why every protocol grew a keepalive. UDP timeouts are far shorter
   (30 s is common) — this is why QUIC and WireGuard send keepalives.
5. **Logging and attribution.** With CGNAT, thousands of subscribers share one address, so an IP
   address is no longer an identifier.

**QUIC's connection ID (§5.5) is a direct response to point 4.** A QUIC connection is identified by
a connection ID in the packet, not by the 4-tuple, so it survives the NAT mapping changing, the
client switching from Wi-Fi to cellular, or the address changing entirely.

### 2.9 BGP — how the internet is actually stitched together

The internet is ~75,000 **Autonomous Systems**, each an independently administered network with an
**ASN**. BGP-4 (RFC 4271) is the only protocol that runs between them. Two things make it
structurally different from every interior routing protocol:

**It is a path-vector protocol, not a link-state or distance-vector one.** A BGP advertisement
carries the full **AS_PATH**: `203.0.113.0/24 via AS_PATH [64500 64510 64520]`. Loop prevention is
therefore trivial and requires no global view: if an AS sees its own number in the path, it
rejects the route. This also makes AS_PATH length the crude distance metric, and **AS path
prepending** (listing yourself several times) the crude traffic-engineering lever.

**It is a policy protocol, not a shortest-path protocol.** This is the part that surprises people
coming from OSPF. BGP's decision process is roughly:

1. Highest **LOCAL_PREF** (local policy — "prefer my cheap transit") — dominates everything.
2. Shortest **AS_PATH**.
3. Lowest **ORIGIN**, then lowest **MED** (a hint to a neighbour about which of my entry points to
   use).
4. **eBGP over iBGP**, then lowest IGP cost to the next hop, then tiebreakers.

LOCAL_PREF comes *first*. That means **money, not distance, is the primary determinant of internet
routing.** The economic relationships are:

- **Transit** — I pay you to reach everything. You advertise the full table to me.
- **Peering** — we exchange traffic between our own customers for free. Crucially, I do **not**
  advertise my transit provider's routes to you (that would make me your free transit). This is
  "valley-free routing", and it is why the internet's topology is not a mesh.
- **IXP** — a shared layer-2 fabric (DE-CIX, AMS-IX, LINX) where hundreds of networks peer at once
  over one port.

**BGP's original sin is that it has no authentication of the *content* of an announcement.**
Anyone can announce anyone's prefix, and because longest-prefix match always wins, announcing a
more specific prefix hijacks the traffic. The canonical incidents:

- **Pakistan Telecom / YouTube (2008)** — an attempt at domestic censorship announced a more
  specific /24 for YouTube; the announcement leaked to the global table and took YouTube off the
  internet for roughly two hours.
- **AS 7007 (1997)** — a misconfigured router re-announced a large fraction of the internet as
  originating from itself. Global outage.
- **Route leaks** — an AS accidentally advertising its transit routes to a peer, becoming an
  unwilling transit provider for traffic it cannot carry. This causes an outage by *congestion*
  rather than by blackhole.

The mitigations: **RPKI** with **ROV** (Route Origin Validation), where prefix holders publish
cryptographically signed ROAs stating which ASNs may originate their prefixes, and routers reject
invalid announcements. Deployment is substantial but incomplete. **ASPA** and **BGPsec** (which
signs the whole path) address path forgery, not just origin, and are barely deployed.

**Convergence is slow.** BGP is not designed for fast reconvergence; withdrawals propagate hop by
hop with MRAI timers damping updates. Global convergence after a major event can take minutes.
This is why anycast, and not BGP reconvergence, is what makes DNS and CDNs fast and resilient.

---

## 3. TCP, Properly

TCP's job is to provide a reliable, ordered, flow-controlled and congestion-controlled byte stream
over a network that provides none of those things. Everything in TCP follows from that sentence.

Current specification: **RFC 9293** (August 2022), which finally consolidated RFC 793 and its
thirty years of accumulated updates.

### 3.1 The three-way handshake

```
    Client                                             Server
                                                    (LISTEN)
    SYN, seq=x, MSS, wscale, SACK-perm, TS  ------>
                                                    (SYN-RECEIVED)
      <------  SYN+ACK, seq=y, ack=x+1, <same options>
    (ESTABLISHED)
    ACK, seq=x+1, ack=y+1                   ------>
                                                    (ESTABLISHED)
```

Why *three*? Because both directions need an independently agreed initial sequence number, and
each ISN must be acknowledged. The server's SYN and its ACK of the client's SYN are piggybacked
into one segment; that is the only reason it isn't four.

**Why the ISN is random.** RFC 6528: if ISNs were predictable, an off-path attacker could inject
data into an existing connection or spoof a full handshake. Linux derives the ISN from a hash of
the 4-tuple and a secret key, plus a clock — deterministic per connection, unpredictable to
outsiders, and monotonically advancing so that segments from a previous incarnation of the same
4-tuple are rejected.

**The handshake carries the options that define the connection**, and they can only be negotiated
here:

- **MSS** — the largest segment the sender is willing to receive. Not negotiated so much as
  declared by each side.
- **Window scale (RFC 7323)** — the window field is 16 bits, capping the window at 65,535 bytes.
  On a 100 ms, 1 Gb/s path the bandwidth-delay product is 12.5 MB. Without scaling, TCP would top
  out at 655 KB/s — 0.5% of the link. The scale factor shifts the window left by up to 14 bits.
  **If either side omits the option in the SYN, scaling is off for the whole connection**, forever.
  A middlebox that strips it silently caps your throughput.
- **SACK-permitted** — enables selective acknowledgement (§3.4).
- **Timestamps** — enables accurate RTT sampling on retransmitted segments (solving Karn's
  ambiguity) and PAWS (Protection Against Wrapped Sequence numbers), which matters on fast links
  where the 32-bit sequence space wraps in seconds.

**SYN floods and SYN cookies.** A half-open connection costs the server memory in the accept
backlog. An attacker sends SYNs from spoofed sources and never completes. The fix: **SYN cookies**
— the server encodes the connection state (MSS index, timestamp, a MAC over the 4-tuple) *into*
the ISN it sends, keeps no state at all, and reconstructs everything from the returning ACK. The
cost is that options not encodable in 32 bits (notably window scale, unless timestamps are also
available) may be lost — which is why SYN cookies are a defence, not a default.

**TCP Fast Open (RFC 7413)** puts data in the SYN, using a server-issued cookie from a prior
connection to authorize it. Saves one RTT. Deployment is poor, largely because middleboxes drop
SYNs with unfamiliar payloads — an early rehearsal of the ossification argument that produced
QUIC (§5.5).

### 3.2 Sequence numbers

The sequence number is a **byte offset**, not a packet counter. This is the design decision that
gives TCP its stream semantics: the receiver reassembles a byte stream, and segment boundaries are
not preserved. `write()` boundaries are invisible to the reader; this is why every TCP protocol
must carry its own framing (length prefix, delimiter, or chunked encoding).

The space is 32 bits and wraps. All comparisons must be modular (`(int32_t)(a - b) < 0`), never
`<`. On a 100 Gb/s link the space wraps in ~0.34 s, which is why PAWS uses timestamps to reject
old duplicates.

SYN and FIN each consume one sequence number, so they can be reliably acknowledged.

### 3.3 The sliding window and flow control

Two independent limits govern how much data may be in flight:

```
in_flight  <=  min( receive_window , congestion_window )
                    ^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^
                    receiver's       sender's estimate of
                    buffer space     what the network can carry
                    (advertised)     (inferred, never told)
```

**Flow control (rwnd)** protects the *receiver*. It is advertised in every ACK, and it is exact:
the receiver knows its own buffer.

**Congestion control (cwnd)** protects the *network*. Nothing tells the sender what it is. It must
be inferred from loss and delay, which is the entire difficulty of §3.6.

The **silly window syndrome** is what happens when the receiver advertises tiny windows as the
application drains a byte at a time, causing the sender to emit one-byte segments with 40 bytes of
header. Fixes on both sides: the receiver defers advertising a window increase until it is worth a
segment (Clark's solution), and the sender uses Nagle (§3.7).

**Zero-window** is the receiver saying "stop". The sender then sends **window probes** — periodic
one-byte segments — because if it merely waited for a window update and that update were lost, the
connection would deadlock forever. The probe makes deadlock impossible.

**The BDP is the number that matters.** `BDP = bandwidth × RTT`. To fill a 10 Gb/s link with a
50 ms RTT you need 62.5 MB in flight. That is your `SO_SNDBUF`/`SO_RCVBUF` (Linux autotunes via
`net.ipv4.tcp_rmem`/`tcp_wmem`), and if it is smaller, you are bandwidth-limited by your own buffer
rather than by the network. This is the "long fat network" problem, and every "why is my transfer
slow across the ocean" question is this question.

### 3.4 Cumulative vs selective ACK

**Cumulative ACK** — `ack=N` means "I have received every byte up to N-1, contiguously". Simple
and robust: a lost ACK is repaired by the next one.

The problem: send segments 1..10, lose 3. The receiver gets 4..10 but can only keep saying
`ack=3`. The sender knows 3 is missing and knows nothing else. Under Go-Back-N it retransmits
3..10, wasting seven segments' worth of bandwidth on a path that is already congested.

**SACK (RFC 2018)** fixes this. The receiver adds a TCP option listing the *contiguous blocks* it
has actually received above the cumulative point:

```
ACK 3, SACK [4-11]        -> "still missing 3; I have 4 through 10"
```

Now the sender retransmits exactly segment 3. With SACK, recovery from multiple losses in one
window takes one RTT instead of several. **D-SACK** (RFC 2883) extends it the other way: the
receiver reports *duplicate* data it received, which tells the sender it retransmitted
unnecessarily — usually because the network reordered rather than dropped — and lets it undo the
congestion-window reduction.

The option is limited to 4 blocks (3 with timestamps), because TCP options have only 40 bytes.

### 3.5 Retransmission and RTO

Two independent recovery mechanisms, and the difference between them is the difference between a
fast connection and a slow one.

**Fast retransmit** — three duplicate ACKs mean the receiver got segments past a hole. Retransmit
immediately, without waiting for a timer. Fast (one RTT), but requires enough data in flight to
generate three dupACKs.

**RTO (Retransmission Timeout)** — the fallback, computed per RFC 6298 from a smoothed RTT and its
variance:

```
SRTT   = (1 - alpha) * SRTT   + alpha * R          alpha = 1/8
RTTVAR = (1 - beta) * RTTVAR + beta * |SRTT - R|   beta  = 1/4
RTO    = SRTT + max(G, 4 * RTTVAR)                 G = clock granularity
```

The `4 * RTTVAR` term is Jacobson's key insight: on a network where delay is *variable*, a timeout
based on the mean alone will fire spuriously. The variance term makes the timer adaptive to jitter,
not just to latency. **RFC 6298 mandates a minimum RTO of 1 second**; Linux uses 200 ms
(`TCP_RTO_MIN`), which is aggressive and generally correct for real paths.

**Karn's algorithm**: never sample RTT from a retransmitted segment, because you cannot tell
whether the ACK is for the original or the retransmission. Timestamps (RFC 7323) resolve the
ambiguity and let you sample anyway.

**Exponential backoff**: each successive timeout for the same segment doubles the RTO. This is what
makes TCP safe under catastrophic congestion — and what makes a dead connection take minutes to
notice.

**RACK-TLP (RFC 8985)** is the modern replacement and is now the Linux default. Instead of counting
duplicate ACKs, it reasons in *time*: a segment is deemed lost if a segment sent *later* has been
acknowledged and more than a reorder window has passed. This handles tail losses (where there is no
subsequent data to generate dupACKs) and reordering far better than the dupACK threshold, which was
always a heuristic standing in for a clock.

### 3.6 Congestion control

The problem is a control-theory problem: estimate the capacity of a path you cannot see, using only
the signals the path incidentally gives you, while sharing it fairly with everyone else doing the
same thing, and never destabilizing.

#### The classic algorithm (RFC 5681)

**Slow start** — begin with `cwnd = IW` (RFC 6928 raised this to 10 segments; **Linux uses 10, and
this was observed live: `TCP_INFO` reported `snd_cwnd = 10`, `snd_ssthresh = 2147483647`**). For
each ACK, `cwnd += 1 MSS`. That doubles cwnd every RTT — exponential. "Slow" refers to the *start*
being slow compared to blasting a full window immediately, which is what pre-1988 TCP did and
which caused the congestion collapse that motivated all of this.

**Congestion avoidance** — once `cwnd >= ssthresh`, grow by 1 MSS per RTT instead of per ACK
(`cwnd += MSS*MSS/cwnd` per ACK). Linear, cautious probing.

**Fast retransmit / fast recovery** — three dupACKs mean a packet was lost but data is still
flowing, so the path is not dead. Set `ssthresh = cwnd/2`, `cwnd = ssthresh`, retransmit, and
continue. Contrast with an RTO, which means the pipe went silent: `cwnd` collapses to 1 and slow
start restarts.

This is **AIMD** — Additive Increase, Multiplicative Decrease — and Chiu and Jain showed in 1989
that AIMD is the control law that converges to fairness. That is a genuinely deep result: additive
increase moves flows toward equality, multiplicative decrease preserves ratios, and the combination
converges regardless of starting point.

The sawtooth this produces has a defining property: **Reno's throughput is inversely proportional
to RTT and to the square root of loss rate.**

```
Throughput  ~=  MSS / (RTT * sqrt(p))         (the Mathis equation)
```

This is fatal on long fat networks. To sustain 10 Gb/s at 100 ms RTT with 1500 B packets, Reno
needs a loss rate below about `2e-10` — one loss per 5 billion packets. That is not achievable, and
it is precisely why CUBIC exists.

#### CUBIC (RFC 9438, August 2023 — obsoletes RFC 8312)

CUBIC is the Linux default (**verified live: `getsockopt(TCP_CONGESTION)` returned `cubic`**). It
replaces the RTT-clocked linear growth with growth that is a **cubic function of wall-clock time
since the last congestion event**:

```
W_cubic(t) = C * (t - K)^3 + W_max

  C       = 0.4         (per RFC 9438: "C SHOULD be set to 0.4")
  beta    = 0.7         (per RFC 9438: "The parameter beta_cubic SHOULD be set to 0.7")
  W_max   = cwnd at the last congestion event
  K       = cbrt(W_max * (1 - beta) / C)   -- time to climb back to W_max
```

Two consequences fall out of the shape:

1. **The plateau.** Near `t = K`, the cubic is flat, so cwnd hovers near the previously known-good
   window — cautious exactly where caution is warranted.
2. **The RTT-independence.** Because `t` is wall-clock time, not RTTs, two flows with very
   different RTTs grow at similar rates. Reno, clocked by ACKs, systematically starves long-RTT
   flows. This was CUBIC's other major fix.

Away from the plateau the cubic is steep, so CUBIC recovers a large window in far fewer round trips
than Reno. And `beta = 0.7` rather than Reno's 0.5 means a gentler cut. CUBIC also runs a "TCP
friendly region" check to ensure it is never *less* aggressive than Reno would be.

#### BBR — and what it actually changed

Everything above treats **loss as the congestion signal**. That was true when router buffers were
small. It is false now: buffers are enormously oversized (**bufferbloat**), so a loss-based sender
fills the buffer completely before it sees a single drop. The result is a link at 100% utilization
with hundreds of milliseconds of standing queue. Throughput is fine; latency is destroyed. Every
"my video call breaks when someone uploads a file" is this.

**BBR** (Bottleneck Bandwidth and Round-trip propagation time) abandons loss entirely and builds an
explicit model. Current specification: **draft-ietf-ccwg-bbr-06** (IETF CCWG, latest revision
6 July 2026 — still an Internet-Draft, intended status experimental).

BBR estimates:

- **`BBR.max_bw`** — *"the windowed maximum recent bandwidth sample obtained during bandwidth
  probing cycles"* (max delivery rate over ~10 RTTs).
- **`BBR.min_rtt`** — *"the windowed minimum RTT measured over approximately 10 seconds."*
- **BDP** = `max_bw × min_rtt`.

Kleinrock proved in 1979 that the optimal operating point is exactly `BDP` in flight: any less and
you underutilize; any more and you only add queue. The catch is that **you cannot measure both at
once** — measuring max bandwidth requires filling the queue, which inflates RTT; measuring minimum
RTT requires draining it, which underutilizes. BBR therefore alternates, sampling each in turn and
combining the windowed estimates.

The state machine: **Startup** (exponential probe, gain 2/ln2 ≈ 2.89), **Drain** (remove the queue
built during startup), **ProbeBW** (steady state, cycling through DOWN / CRUISE / REFILL / UP),
and **ProbeRTT** (periodically cut inflight to ~4 packets for 200 ms to re-measure `min_rtt`).

The genuinely important change: **BBR paces packets.** Rather than sending a cwnd's worth as fast
as the NIC allows, it spaces them at the estimated bottleneck rate. This alone removes most
self-inflicted queueing, and it requires either a kernel pacing layer (`fq` qdisc) or NIC pacing
support.

Results and caveats: BBR delivers dramatically lower latency at equal throughput on
bufferbloated paths, and much better throughput on lossy paths (it does not misread random loss as
congestion, which is why it wins on cellular and satellite). **BBRv1 was unfair to CUBIC** on
shallow-buffered links, where it could take a disproportionate share; BBRv2 and v3 added explicit
loss and ECN responses to address this. Fairness against loss-based flows remains the central open
question and the reason BBR is still a draft rather than a standard.

#### The others, briefly

**Vegas** (delay-based, 1994) was right early and lost, because a delay-based flow yields to a
loss-based one and starves. **DCTCP** uses ECN marking to get a fine-grained multi-bit congestion
signal in a controlled datacentre, achieving very low queue occupancy — this is the direct ancestor
of RoCE's DCQCN (§6.3). **Compound TCP** (Windows) hybridized loss and delay.

### 3.7 Nagle and delayed ACK — the pathology, reproduced

**Nagle's algorithm (RFC 896, 1984)** solves the tinygram problem: a telnet session sending one
byte per keystroke wraps 1 byte in 40 bytes of header, a 4000% overhead. The rule:

> If there is unacknowledged data outstanding, buffer new small writes until either an ACK arrives
> or a full MSS has accumulated.

At most one small segment may be in flight at a time. Self-clocking, elegant, and correct in 1984.

**Delayed ACK (RFC 1122)** solves a complementary problem: a bare ACK is a 40-byte packet carrying
no data. So the receiver waits — up to 500 ms by RFC, **40 ms in Linux** — hoping to piggyback the
ACK on a response, or to accumulate two segments (an ACK must be sent for every second full-size
segment).

**Each is correct. Together they deadlock.** The pattern that triggers it is
**write–write–read** — the natural way to send a header and then a body:

```
Client                                     Server
write(header, 4)   -> sent immediately     (nothing unacked)
write(body, 60)    -> Nagle BUFFERS it     (header is unacked; body < MSS)
read(reply)        -> blocks
                                           got header only
                                           cannot answer -- incomplete message
                                           delays the ACK hoping to piggyback
                    ... 40 ms of nothing ...
                                           delayed-ACK timer fires -> ACK
body released by Nagle -> sent
                                           now has the full message -> replies
```

**Measured live in the sandbox** (GCC 15.2, kernel 7.0.0-1011-aws, loopback TCP, 100 iterations):

```
write-write-read, TCP_NODELAY=0 : 100 iters,  40636.6 us each
write-write-read, TCP_NODELAY=1 : 100 iters,     43.2 us each
```

**A 940x slowdown, and 40636 µs is the 40 ms delayed-ACK timer, visible to three significant
figures.** This is the single most convincing demonstration in the whole curriculum, and it runs in
a sandbox with no network.

A second measurement makes the mechanism precise. With a strict one-byte **write–read** ping-pong,
`TCP_NODELAY` makes no difference at all (measured: 27 µs vs 52 µs, dominated by scheduling noise
in the opposite direction) — because in a strict request/response there is never more than one
unacknowledged segment, so **Nagle never engages**. The bug requires two writes before a read. That
negative result is worth as much as the positive one: it tells you exactly when to expect the
pathology and when not to.

Three fixes, in order of correctness:

1. **Fix the application** — one `write()`/`writev()` per logical message. Nagle then never fires.
   This is the right fix and it is almost always easy.
2. **`TCP_NODELAY`** — disable Nagle. What every RPC library, database driver and web server does.
3. **`TCP_CORK`** (Linux) — the inverse: explicitly hold data until uncorked or 200 ms elapse.
   Useful for `sendfile()` where you want the header in the same segment as the file's first bytes.

### 3.8 TIME_WAIT and why it exists

```
    Active closer                          Passive closer
    FIN               ---------->
    (FIN_WAIT_1)                           (CLOSE_WAIT)
      <----------  ACK
    (FIN_WAIT_2)
      <----------  FIN                     (LAST_ACK)
    ACK               ---------->          (CLOSED)
    (TIME_WAIT)  -- wait 2*MSL --> (CLOSED)
```

The side that closes **first** enters `TIME_WAIT` and stays there for **2 × MSL** (Maximum Segment
Lifetime). RFC 793 sets MSL to 2 minutes, so 2×MSL is 4 minutes; **Linux hardcodes 60 seconds**
(`TCP_TIMEWAIT_LEN`, not tunable without recompiling).

It exists for two reasons, and the second is the one people forget:

1. **To absorb delayed duplicates.** If a segment from this connection is wandering the network and
   arrives after a *new* connection with the same 4-tuple has been established, it would be accepted
   as valid data. TIME_WAIT guarantees the 4-tuple is quarantined until every such segment has
   expired.
2. **To reliably terminate the connection.** The final ACK might be lost. If it is, the peer
   retransmits its FIN and expects an ACK. Only a socket still in TIME_WAIT can answer. Without it,
   the peer receives an RST, and may conclude data was lost.

The operational pain is real: a busy proxy or load balancer that closes connections accumulates
tens of thousands of TIME_WAIT sockets, exhausting the ephemeral port range (`net.ipv4.
ip_local_port_range`, default 32768–60999 ≈ 28,000 ports **per destination 4-tuple**).

Fixes, and their correctness:

- **`SO_REUSEADDR`** — allows `bind()` to a local address in TIME_WAIT. Safe. This is why every
  server sets it, and why omitting it makes restarts fail with `EADDRINUSE`.
- **`net.ipv4.tcp_tw_reuse = 1`** — allows reusing a TIME_WAIT socket for a **new outbound**
  connection when timestamps show it is safe. Reasonably safe, outbound only.
- **`tcp_tw_recycle`** — **removed from Linux in 4.12.** It was actively broken behind NAT, because
  it kept per-source-IP timestamp state and dropped connections from clients whose timestamps went
  backwards relative to another client behind the same NAT. If you find this in a tuning guide,
  the guide is dangerously out of date.
- **Architectural fix**: use keep-alive and don't churn connections; or arrange for the *client* to
  close first, moving the TIME_WAIT burden to the machines that have ports to spare.

### 3.9 Head-of-line blocking

**TCP delivers bytes in order, without exception.** If segment 5 is lost, segments 6–20 sit in the
receiver's out-of-order queue — received, ACKed via SACK, sitting in kernel memory — and the
application cannot read a single byte of them until segment 5 is retransmitted and arrives, one RTT
later.

For one sequential file transfer this is exactly what you want. For **anything multiplexed over one
TCP connection**, it is a disaster: one lost packet belonging to stream A stalls streams B through
Z, which have no dependency on it whatsoever.

This is the central flaw of HTTP/2 (§5.4). HTTP/2 solved application-layer HOL blocking with
multiplexed streams, and then discovered that **TCP reimposes it one layer down** — because TCP
has no idea the byte stream contains independent substreams. You cannot fix it inside TCP. The
only fix is to move the ordering guarantee to a layer that knows about the streams, which is
precisely what QUIC did (§5.5).

### 3.10 UDP, and when you actually want it

UDP is an 8-byte header — source port, destination port, length, checksum — over IP. It provides
multiplexing by port and an optional integrity check. It provides nothing else: no ordering, no
reliability, no flow control, no congestion control, no connection.

That sounds like a deficiency. It is a design: **UDP is the escape hatch for applications whose
reliability requirements do not match TCP's.**

- **DNS** — one small request, one small response. A TCP handshake would triple the latency, and
  retrying is cheaper than connection state. Falls back to TCP when responses exceed the UDP size
  (§5.2).
- **Real-time media (RTP)** — a retransmitted audio frame arrives after its playout deadline and is
  worthless. TCP's reliability actively harms you: it converts loss into *latency*, and for
  interactive media latency is the thing you cannot afford. Better to conceal the loss.
- **QUIC** — needs its *own* reliability and congestion control with per-stream semantics. UDP is
  used as a bare packet substrate because it is the only thing that traverses today's internet
  while still leaving the transport programmable in userspace (§5.5).
- **Gaming** — the newest state supersedes the old. Retransmitting a stale position is worse than
  useless.
- **Discovery / multicast** (mDNS, SSDP) — one-to-many; TCP has no such notion.

**The obligation:** if you build on UDP you must implement congestion control. UDP has no
protection against congestion collapse, and an unresponsive UDP flood is antisocial. QUIC
implements CUBIC or BBR internally for exactly this reason.

Two practical notes. **The UDP checksum is optional in IPv4** (zero means "not computed") and
**mandatory in IPv6**. And UDP is the primary vector for reflection/amplification DDoS, because it
is trivially spoofable and some services (DNS, NTP `monlist`, memcached) return responses far
larger than the request — memcached amplification reached factors above 50,000x.

---

## 4. Sockets — The Programmer's View

### 4.1 The full syscall sequence

**Server:**

```c
int fd = socket(AF_INET, SOCK_STREAM, 0);
// -> allocates struct socket + struct sock, installs TCP's proto_ops, returns a file descriptor.
//    Nothing has touched the network. There is no port, no address, no state.

int one = 1;
setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
// -> allows bind() over a lingering TIME_WAIT. Set this before bind or restarts fail.

bind(fd, (struct sockaddr*)&addr, sizeof addr);
// -> claims (address, port) in the kernel's bind hash. INADDR_ANY = all interfaces.
//    Port 0 = "kernel, pick one"; recover it with getsockname().

listen(fd, backlog);
// -> the socket becomes passive. THE KEY STEP: the kernel now creates TWO queues.
//      SYN queue      -- half-open, awaiting the final ACK   (net.ipv4.tcp_max_syn_backlog)
//      accept queue   -- fully established, awaiting accept() (min(backlog, somaxconn))
//    The three-way handshake is completed BY THE KERNEL, with no help from your process.

int c = accept(fd, &peer, &len);      // or accept4(..., SOCK_NONBLOCK|SOCK_CLOEXEC)
// -> pops one already-established connection off the accept queue and wraps it in a new fd.
//    accept() does not perform the handshake. It harvests its result.
```

That distinction is the one most people have backwards, and it explains a class of production
incidents: **if your process is slow to `accept()`, the accept queue fills, and the kernel then
silently drops incoming ACKs** (or sends RST, depending on `tcp_abort_on_overflow`). The client
believes it is connected; it has completed the handshake; and its data goes nowhere. Visible in
`netstat -s | grep -i listen` as "listen queue overflowed".

`accept4()` with `SOCK_CLOEXEC` in one call is not a micro-optimization — the two-syscall version
(`accept` then `fcntl`) has a race where a concurrent `fork()`+`exec()` leaks the descriptor.

**Client:**

```c
int fd = socket(AF_INET, SOCK_STREAM, 0);
// bind() is optional; connect() implicitly binds to an ephemeral port.
connect(fd, (struct sockaddr*)&server, sizeof server);
// blocking:     returns when the handshake completes (or ECONNREFUSED / ETIMEDOUT)
// non-blocking: returns -1/EINPROGRESS immediately; poll for EPOLLOUT, then check
//               getsockopt(fd, SOL_SOCKET, SO_ERROR, ...) -- writability alone does NOT mean success
```

**Shutdown, and the subtlety.** `close()` releases the descriptor and, if it is the last reference,
starts the FIN. `shutdown(fd, SHUT_WR)` sends the FIN **while keeping the socket readable** — a
half-close. This is the correct way to say "I'm done sending, tell me when you're done replying",
and it is what HTTP/1.0 `Connection: close` and `TCP_CORK`-style protocols rely on.

**`SO_LINGER`** with a nonzero timeout makes `close()` block until data is flushed. With a
**zero** timeout it sends an **RST** instead of a FIN, discarding queued data and skipping
TIME_WAIT. That is occasionally the right hammer and usually data loss.

### 4.2 Blocking vs non-blocking

Blocking is the default and is genuinely the right model when you have one connection per thread
and few connections. The code is linear and correct. It costs a thread (~8 KB kernel stack + 8 MB
of virtual address space for the user stack) and a context switch per operation, and it stops
scaling somewhere in the low thousands of connections.

`O_NONBLOCK` makes every operation return immediately: `EAGAIN`/`EWOULDBLOCK` if it would have
blocked. Now one thread can drive many connections — but it needs a way to know *which* fds are
ready, or it will spin. That is what the readiness-notification family is for.

Three properties that bite:

- **Short writes are normal.** `write()` on a non-blocking socket may accept 3 of your 100 bytes.
  Every send path must loop and track a partial offset.
- **`read()` returning 0 means EOF** (peer sent FIN). `-1`/`EAGAIN` means "nothing right now".
  Conflating them is a classic bug.
- **`EINTR`** — any blocking syscall can be interrupted by a signal. Retry, or use `SA_RESTART`.

### 4.3 select / poll / epoll / kqueue, and why epoll scales

**`select(2)`** — bitmaps of fds, three of them (read/write/except), plus a timeout.

- `fd_set` is a fixed bitmap of **`FD_SETSIZE` = 1024** on Linux. Descriptor 1024 cannot be
  represented. Writing to `fd_set` with a larger fd is a buffer overflow, not an error.
- The kernel scans **all** fds from 0 to nfds each call: **O(n)**.
- The bitmaps are **modified in place**, so you must rebuild them before every call.
- The complete fd set is copied into the kernel on every call, and the results back out.

**`poll(2)`** — an array of `struct pollfd`. Removes the 1024 limit and separates the input
(`events`) from the output (`revents`) so the array is reusable. Still **O(n)** in the kernel, and
still copies the whole array in and out every call.

**`epoll(7)`** — the structural fix. The insight: *the set of fds you are watching changes rarely;
the set that is ready changes constantly.* So separate them.

```c
int ep = epoll_create1(EPOLL_CLOEXEC);

struct epoll_event ev = { .events = EPOLLIN | EPOLLET, .data.fd = conn };
epoll_ctl(ep, EPOLL_CTL_ADD, conn, &ev);     // register ONCE -- O(log n), amortized O(1)

struct epoll_event out[64];
int n = epoll_wait(ep, out, 64, timeout_ms); // returns ONLY ready fds -- O(ready), not O(watched)
```

Why it is O(1) in the number of watched descriptors: `epoll_ctl` installs a **callback on the
socket's wait queue**. When a packet arrives and makes the socket readable, the kernel's socket code
invokes that callback, which moves the epoll item onto the epoll instance's **ready list**.
`epoll_wait` simply drains the ready list. The kernel never scans the watch set, because the
sockets themselves report in. That is the whole idea, and it is the same idea as an interrupt
versus a poll.

**Level-triggered (default)** — report while the condition holds. Read 100 of 1000 available bytes
and the next `epoll_wait` reports it again. Forgiving, and what you should start with.

**Edge-triggered (`EPOLLET`)** — report only on a *transition*. You must drain until `EAGAIN`, or
you will hang forever with data sitting in the buffer. Fewer syscalls; far less forgiving. Rule:
ET requires non-blocking fds and a drain loop, always.

**`EPOLLEXCLUSIVE`** (Linux 4.5+) fixes the **thundering herd**: without it, adding one listening
socket to N per-thread epoll instances wakes all N threads on each incoming connection, and N-1 go
back to sleep having done nothing.

**`kqueue(2)`** (BSD/macOS) is the same architecture, arrived earlier (FreeBSD 4.1, 2000), and is
in several ways cleaner: one unified interface for sockets, files, signals, timers, process events
and filesystem changes (`EVFILT_READ`, `EVFILT_VNODE`, `EVFILT_SIGNAL`, `EVFILT_TIMER`), and
`kevent()` performs registration and waiting in a **single syscall** rather than epoll's
`epoll_ctl` + `epoll_wait` pair.

Windows takes a third path: **IOCP** is a **completion** model, not a readiness model. You start an
operation and are told when it *finished*, rather than being told when you may start it. That is
the model io_uring brought to Linux.

### 4.4 The C10K problem, and how it was solved

Dan Kegel's 1999 formulation: a machine with adequate hardware could not serve 10,000 simultaneous
connections, not because of bandwidth or CPU but because **the software architecture had cost terms
linear in the number of connections.**

The three walls, and what removed each:

| Wall | Cost | Removed by |
|---|---|---|
| Thread/process per connection | ~8 MB VA + kernel stack each; scheduler and context-switch cost | Event loops; later, cheap userspace tasks (goroutines, `async`, fibers) |
| `select`/`poll` | O(n) scan **per call**, plus full set copied in and out | **epoll / kqueue**: O(1) registration, O(ready) wait |
| Kernel accept/lock contention | one listening socket, one accept queue, one lock | **`SO_REUSEPORT`**: N independent listeners, N queues, kernel load-balances by 4-tuple hash |

The winning architecture, which is what nginx, HAProxy, Envoy and every modern server converge on:

```
N worker processes/threads, N == core count
  each:  its own listening socket via SO_REUSEPORT
         its own epoll instance
         pinned to one core
         non-blocking sockets, a state machine per connection
         zero shared mutable state on the data path
```

**`SO_REUSEPORT`** (Linux 3.9; **verified available in the sandbox**) is worth dwelling on. Multiple
sockets may bind the *same* address and port. The kernel hashes each incoming connection's 4-tuple
to choose which listener receives it. This gives:

- **N accept queues instead of one** — no shared lock, and no thundering herd at all.
- **Even distribution** — better than `EPOLLEXCLUSIVE`, which merely avoids waking everyone.
- **Zero-downtime restarts** — a new process binds the same port, both serve, the old one drains
  and exits. No dropped connections, no `SO_REUSEADDR` dance.

The caveat: removing a listener rehashes the buckets, so connections **in the SYN queue** of the
departing socket can be lost. `SO_REUSEPORT` with `SO_INCOMING_CPU` or an eBPF `SO_ATTACH_REUSEPORT_
EBPF` program lets you control the mapping explicitly.

Today "C10K" is solved so thoroughly that the conversation moved to **C10M** — 10 million
connections — where the remaining costs are per-connection kernel memory (~10 KB of `sk_buff`,
socket and TCP state) and the per-packet stack traversal, which is what §4.6 attacks.

### 4.5 io_uring

epoll tells you when you *may* do I/O; you then make a syscall to do it. So a busy server still
makes 2–3 syscalls per request, each with a ~100–500 ns (post-Spectre/Meltdown mitigation) crossing
cost, plus the cache and TLB damage.

**io_uring** (Linux 5.1+) is a completion model built on **two shared-memory ring buffers**,
mmap'd between the kernel and userspace:

- **SQ (submission queue)** — userspace writes SQEs describing operations.
- **CQ (completion queue)** — the kernel writes CQEs with results.

Both are single-producer/single-consumer with `head`/`tail` indices and memory-ordering fences.
**Neither ring requires a syscall to access.** You batch many operations, then make **one**
`io_uring_enter()` call — and with `IORING_SETUP_SQPOLL` a kernel thread polls the submission queue,
so the syscall count on a busy server can reach **zero**.

**Verified live in the sandbox** — a raw `io_uring_setup` + `mmap` of all three regions + a `NOP`
submission + completion harvest, with no liburing:

```
io_uring_setup -> fd 3, features = 0x3ffff
io_uring_enter -> 1
CQE user_data = 0xc0ffee  res = 0
```

Why it is a genuinely different thing from epoll, not merely a faster one:

1. **Truly asynchronous file I/O.** `O_NONBLOCK` never worked for regular files — a read from a
   cold page cache blocks regardless, which is why every epoll-based server needed a thread pool
   for disk. io_uring makes file and socket I/O the same shape for the first time on Linux.
2. **Chaining.** `IOSQE_IO_LINK` expresses dependencies: `accept` → `read` → `write` submitted as
   one linked batch that the kernel executes in order, without returning to userspace between them.
3. **Registered buffers and files.** Pre-pin buffers (`IORING_REGISTER_BUFFERS`) and pre-resolve
   file descriptors, removing the per-operation `get_user_pages` and fd-table lookup.
4. **Every operation, one interface.** `read`, `write`, `send`, `recv`, `accept`, `connect`,
   `openat`, `close`, `fsync`, `statx`, `timeout`, `poll`, `splice`, `sendmsg_zc`.

The comparison to name explicitly: **io_uring is Linux's IOCP, arrived twenty years later, done with
shared memory rather than syscalls, and therefore faster than the thing it is catching up to.**

### 4.6 Zero-copy

The default path for serving a file involves four copies and two context switches:

```
read(file_fd, buf, n):   disk -> page cache -> user buffer      [DMA copy + CPU copy]
write(sock_fd, buf, n):  user buffer -> socket buffer -> NIC    [CPU copy + DMA copy]
```

The two CPU copies are pure waste: the data is never examined, only moved.

**`sendfile(out_fd, in_fd, offset, count)`** — the kernel moves data from the page cache to the
socket without it ever entering userspace. With **scatter-gather DMA** support the socket buffer
holds only *descriptors* pointing at page-cache pages, so the CPU copy count reaches **zero**: the
NIC DMAs straight out of the page cache.

**Verified live in the sandbox** (a file created in `/tmp` — the sandbox has no readable system
files, but writable `/tmp` works):

```
open /tmp/x.txt -> 3
sendfile         -> 15 bytes
received on the far side of an AF_UNIX socketpair: "hello sendfile"
```

**`splice(fd_in, off_in, fd_out, off_out, len, flags)`** — generalizes it by moving *pipe buffer
references* between descriptors. A pipe becomes a kernel-space conduit, so you can splice
socket → pipe → socket and proxy without ever touching the payload. `tee()` duplicates a pipe's
contents without consuming them; `vmsplice()` maps user pages into a pipe.

**`MSG_ZEROCOPY`** (Linux 4.14+) for `send()` — the kernel pins the user pages and DMAs from them
directly. Because the pages must stay untouched until the NIC is done, completion is asynchronous
and reported via the socket's error queue (`MSG_ERRQUEUE`). Worth it above roughly 10 KB per send;
below that, pinning costs more than copying.

The honest caveat: `sendfile()` cannot transform data. **TLS breaks the classic zero-copy path**,
because the bytes must be encrypted, which means reading them. This is exactly why
**kTLS** (kernel TLS) exists: put the record layer in the kernel (or offload it to the NIC), and
`sendfile()` works again on an HTTPS connection. This is how a modern CDN serves TLS at line rate.

### 4.7 Kernel bypass — DPDK and AF_XDP

Return to the arithmetic from §1.1: at 10 GbE with minimum-size frames, the budget is **67.2 ns per
packet**, about 200 cycles at 3 GHz. The Linux stack costs roughly 1–2 µs per packet: interrupt,
softirq, `sk_buff` allocation (a ~200-byte metadata struct per packet), protocol demux, routing
lookup, socket lookup, queue lock, syscall, copy to userspace. You are 15–30x over budget. No amount
of tuning closes that gap, because **the cost is structural**.

**DPDK** removes the kernel entirely.

- Bind the NIC to a userspace-owned driver (`vfio-pci` / `uio`), so the kernel driver never sees it.
- **Poll mode drivers**: no interrupts at all. A core spins on the descriptor ring forever, at 100%
  CPU, by design. Interrupt latency is not reduced — it is deleted.
- **Hugepages** (2 MB / 1 GB) for packet buffers, so the DTLB never misses on packet memory.
- **Lockless per-core rings**, cores pinned, NUMA-local memory, buffers cache-line aligned and
  prefetched.
- **Batching everywhere** — 32 packets per ring poll amortizes every fixed cost.

Result: 10–100+ Mpps per core. The costs are severe and worth stating plainly: the NIC is
*gone* from the OS (no `ping`, no `tcpdump`, no `ip`, no kernel firewall), you must supply your own
TCP/IP stack, and a core burns 100% CPU whether or not traffic exists.

**AF_XDP** is the Linux answer: most of the speed, without leaving the kernel. Per the kernel
documentation:

- **UMEM** — *"a region of virtual contiguous memory, divided into equal-sized frames"*, allocated
  by userspace (malloc, mmap, hugepages) and registered via `XDP_UMEM_REG`. Chunk size is 2K or 4K.
- **Four SPSC rings**: **FILL** (userspace hands empty frames to the kernel — *"used to transfer
  ownership of UMEM frames from user-space to kernel-space"*), **RX** (kernel returns filled
  frames), **TX** (userspace submits frames to send), **COMPLETION** (kernel returns frames it has
  finished transmitting — *"frame addresses from Tx descriptors that the kernel has finished
  processing and that can now be used again by user space"*).
- **XDP_DRV** (native driver support, zero-copy capable) vs **XDP_SKB** — *"a fallback mode that
  works for any network device"*, using generic XDP and SKBs, with a copy.

The structural advantage over DPDK: an **eBPF program at the XDP hook** decides, per packet, whether
to redirect it to the AF_XDP socket or let it continue up the normal Linux stack. So one NIC can
serve a bypass fast path *and* remain a normal, `tcpdump`-able, firewalled Linux interface. You
choose which flows bypass. DPDK is all or nothing.

**Who uses this, and why:**

- **HFT.** The entire product is tail latency. A DPDK or Solarflare/Onload path removes ~5–10 µs of
  jitter, and the microwave link in §1.6 removes 4 ms. Both are worth more than any feature.
- **NFV.** A virtualized router, firewall or 5G UPF *is* a packet processor. Its whole workload is
  the per-packet cost, so the kernel stack is not overhead on the way to the work — it is a
  competing implementation of the work.
- **Load balancers.** Google's Maglev and Facebook/Meta's Katran do exactly this; Katran is an
  eBPF/XDP program.

**And this is the same idea as GPUDirect RDMA (§6.4).** In both cases the answer to "the CPU is in
the way" is not to make the CPU faster but to **remove it from the data path and leave it only in
the control path.** Recognizing that this is one idea, appearing in NAPI, DPDK, AF_XDP, io_uring,
RDMA and GPUDirect alike, is the point of teaching them together.

---

## 5. DNS, HTTP and TLS — the "Type a URL" Path

### 5.1 The layer cake, for orientation

```
   you type      https://www.example.com/index.html
                 |
   [ browser ]   URL parse, HSTS check, cache check
   [ DNS      ]  name -> address                      (UDP/53, DoH/443, DoT/853)
   [ TCP/QUIC ]  connection setup                     (1 RTT, or 0 for QUIC resumption)
   [ TLS      ]  authentication + key agreement       (1 RTT in 1.3, 2 in 1.2, 0 on resume)
   [ HTTP     ]  request/response                     (1 RTT)
   [ browser ]   parse, subresources, layout, paint
```

Everything in this section is, structurally, an attempt to delete one of those round trips.

### 5.2 DNS, end to end

DNS is a distributed, hierarchical, cached key-value store. The hierarchy is read right to left:

```
  www.example.com.
  |   |       |  \_ root zone (the implicit trailing dot)
  |   |       \____ TLD:   com
  |   \____________ SLD:   example.com     <- the zone cut; where delegation happens
  \________________ host:  www
```

#### The actors

- **Stub resolver** — in your OS (`getaddrinfo(3)` → glibc NSS → `/etc/nsswitch.conf` →
  `/etc/hosts`, then `/etc/resolv.conf`). It is deliberately dumb: it asks one question and expects
  one answer. It sets **RD=1** (Recursion Desired).
- **Recursive resolver** — your ISP's, or `8.8.8.8`, `1.1.1.1`, or `systemd-resolved` on localhost.
  This is the one that does the work and holds the cache.
- **Root servers** — 13 *named* servers `a.root-servers.net` … `m.root-servers.net`, but over 1,500
  physical instances worldwide via **anycast**: the same IP announced by BGP from many locations,
  so packets reach the topologically nearest one. Anycast is how a 13-address system serves the
  planet.
- **TLD servers** — `.com` (Verisign), `.org`, `.uk`, …
- **Authoritative servers** — hold the actual zone file for `example.com`.

#### The resolution, with nothing skipped

```
1. Browser cache?  Chrome caches ~60 s.  Hit -> done.
2. OS cache / stub resolver cache?  Hit -> done.
3. /etc/hosts?  Hit -> done.  (This is why hosts-file entries beat DNS.)
4. Stub sends to the recursive resolver (RD=1):
       QNAME=www.example.com QTYPE=A QCLASS=IN
5. Recursive resolver checks its cache. Assume cold. It now iterates, RD=0:
   a. -> a root server:  "www.example.com A?"
      <- REFERRAL: "I don't know, but .com is served by a.gtld-servers.net ..."
         + GLUE: the A/AAAA records for those nameservers, in the ADDITIONAL section.
           (Glue exists to break the chicken-and-egg: you cannot resolve
            a.gtld-servers.net without already being able to reach .com.)
   b. -> a .com server:  "www.example.com A?"
      <- REFERRAL: "example.com is served by ns1.example.com ..." + glue
   c. -> ns1.example.com: "www.example.com A?"
      <- ANSWER (AA=1, the Authoritative Answer bit):
           www.example.com.  3600  IN  A  93.184.215.14
6. Resolver caches every record for its TTL and returns the answer to the stub.
7. Stub returns to getaddrinfo(), which returns a struct addrinfo list to the browser.
```

**Three or four round trips, cold — and essentially zero, warm.** DNS works because of caching, and
the TTL is the single knob that trades propagation speed against load. Lowering a TTL to 60 s before
a migration is standard practice for exactly this reason.

#### The wire format

12-byte header, then Question / Answer / Authority / Additional sections. Names are encoded as
**length-prefixed labels** terminated by a zero byte — no dots on the wire. **Verified live**, a
query built and parsed byte by byte:

```
DNS query (33 bytes):
12 34 | 01 00 | 00 01 | 00 00 | 00 00 | 00 00 | 03 www 07 example 03 com 00 | 00 01 | 00 01
 ID   | flags |  QD   |  AN   |  NS   |  AR   |          QNAME             | QTYPE | QCLASS
                RD=1                                                          A       IN

decoded QNAME = www.example.com.
```

**Compression pointers** are the one genuinely tricky part. A label length byte with its top two
bits set (`0xC0`) is not a length — the remaining 14 bits are an **offset from the start of the
message** to continue reading from. This keeps responses small, and it is a classic parser hazard:
a pointer loop will hang a naive implementation, so every parser needs a jump budget. Verified live:

```
answer NAME = www.example.com.   (encoded as just C0 0C -- a pointer to offset 12)
TYPE=1 CLASS=1 TTL=3600 RDLENGTH=4 A=93.184.215.14
```

Record types worth knowing: **A** / **AAAA** (addresses), **CNAME** (alias; may not coexist with
other records at the same name, which is why you cannot CNAME a zone apex), **MX**, **NS**,
**TXT** (SPF, DKIM, domain validation), **SOA**, **PTR** (reverse, via `in-addr.arpa`), **SRV**,
**CAA** (which CAs may issue for this domain), **HTTPS/SVCB** (RFC 9460 — advertises ALPN, port and
ECH config in DNS, letting a client skip discovery round trips and go straight to HTTP/3).

**Transport.** UDP/53, historically capped at 512 bytes. **EDNS(0)** (RFC 6891) uses a pseudo-record
(OPT) in the additional section to advertise a larger buffer, typically 1232 bytes — chosen to stay
under the IPv6 minimum MTU of 1280 and avoid fragmentation (§2.5). If the response still does not
fit, the server sets **TC=1** (truncated) and the client **retries over TCP/53**. Every DNS server
must support TCP; the belief that DNS is "UDP only" is a persistent and load-bearing misconception.

#### DNSSEC, DoT, DoH — three different problems

These are constantly confused, and they solve orthogonal things:

- **DNSSEC** (RFC 4033–4035) — **authenticity and integrity, not confidentiality.** Records are
  signed (RRSIG); keys are published (DNSKEY); the parent zone publishes a hash of the child's key
  (DS), forming a chain from the root's trust anchor down. It proves an answer is genuine. It does
  **not** encrypt anything — a DNSSEC query is fully visible on the wire. Non-existence is proven
  with NSEC/NSEC3, which historically enabled zone-walking; NSEC3 hashes the names, and NSEC5 /
  NSEC3 opt-out address the remainder.
- **DoT** (DNS over TLS, RFC 7858, port **853**) — **confidentiality.** A dedicated port, so network
  operators can see, allow or block DNS as a category.
- **DoH** (DNS over HTTPS, RFC 8484, port **443**) — **confidentiality plus indistinguishability.**
  DNS as HTTPS requests, mixed in with all other web traffic. This is why it is politically
  contentious: it defeats network-level DNS filtering, whether that filtering is malware blocking,
  parental controls, or censorship. It also moves visibility from your ISP to whoever operates the
  DoH resolver, which is a relocation of trust rather than an elimination of it.
- **DoQ** (DNS over QUIC, RFC 9250) — DoT's guarantees without TCP head-of-line blocking.

### 5.3 HTTP/1.1

Plain text, request/response, one message at a time per connection.

```
GET /index.html HTTP/1.1\r\n
Host: www.example.com\r\n              <- mandatory in 1.1; enables virtual hosting
User-Agent: curl/8.4.0\r\n
Accept: */*\r\n
Connection: keep-alive\r\n
\r\n

HTTP/1.1 200 OK\r\n
Content-Type: text/html\r\n
Content-Length: 1256\r\n
\r\n
<!doctype html>...
```

**Keep-alive** became the default in 1.1 (it was opt-in via `Connection: keep-alive` in 1.0). This
was the single biggest performance change in HTTP's history: without it, every resource costs a
fresh TCP handshake **and** a fresh TLS handshake, and every connection restarts in slow start with
`cwnd = 10`.

**Pipelining, and why it failed.** HTTP/1.1 permits sending request 2 before response 1 arrives.
It should have been a large win. It is disabled in every major browser, for three reasons:

1. **Head-of-line blocking at the application layer.** Responses must return **in request order**.
   One slow response blocks every response behind it, even if they are ready.
2. **Broken intermediaries.** Many proxies mishandled pipelined requests — silently, and sometimes
   by serving response 2's body against request 1, which is a correctness and security failure.
3. **No way to cancel.** You cannot abandon request 3 without tearing down the connection.

So browsers instead opened **6 parallel TCP connections per origin** — a workaround that costs 6
handshakes, 6 slow starts, and 6 congestion-control state machines competing against each other for
the same bottleneck. It also spawned the entire discipline of "web performance": domain sharding,
sprite sheets, CSS/JS concatenation, inlining. **HTTP/2 exists to make all of that unnecessary.**

**Chunked transfer encoding** (`Transfer-Encoding: chunked`) solves framing when the length is not
known in advance — a streamed or dynamically generated response. Each chunk is a hex length, CRLF,
the bytes, CRLF; a zero-length chunk ends the body, optionally followed by trailers. **Verified
live** with a hand-written decoder:

```
"1a\r\nThe quick brown fox jumps \r\n10\r\nover the lazy d\n\r\n0\r\n\r\n"
  ->  "The quick brown fox jumps over the lazy d\n"   (42 bytes)
```

The security-relevant corner: if a message carries **both** `Content-Length` and
`Transfer-Encoding: chunked`, different servers disagree about which wins. That disagreement between
a front-end proxy and a back-end server is **HTTP request smuggling** — one of the more consequential
web vulnerability classes, and a direct consequence of a text protocol with two framing mechanisms.
HTTP/2 and /3 eliminate it structurally by having exactly one, binary, unambiguous framing layer.

### 5.4 HTTP/2 (RFC 9113)

Same semantics (RFC 9110: methods, status codes, headers), a completely different wire format.

**Binary framing.** Everything is a frame: 9-byte header (24-bit length, 8-bit type, 8-bit flags,
31-bit stream ID) followed by a payload. Types: `DATA`, `HEADERS`, `PRIORITY`, `RST_STREAM`,
`SETTINGS`, `PUSH_PROMISE`, `PING`, `GOAWAY`, `WINDOW_UPDATE`, `CONTINUATION`. Binary framing
removes parsing ambiguity — and with it, request smuggling.

**Multiplexing.** Many concurrent **streams** over one TCP connection, each with an ID (odd =
client-initiated, even = server-initiated). Frames from different streams interleave freely.
Responses may return in any order. **This is the fix for HTTP/1.1's application-layer HOL blocking**,
and it makes domain sharding and concatenation counterproductive.

**HPACK (RFC 7541)** — header compression, and it is not gzip. HTTP headers are enormously
repetitive: the same `User-Agent`, `Accept`, `Cookie` on every request. HPACK uses:

- A **static table** of 61 common header entries (`:method: GET` is index 2, `:path: /` is index 4,
  `:scheme: https` is index 7). A whole header becomes **one byte**.
- A **dynamic table** — a per-connection FIFO of previously seen headers, referenced by index. The
  second request's `Cookie` is an index, not 500 bytes.
- **Huffman coding** for literal values, using a static table tuned on real HTTP header corpora.

Typical reduction is 80–90% of header bytes. HPACK was designed specifically to resist **CRIME**:
generic compression across a stream mixing attacker-controlled and secret data leaks the secret via
compressed length, so HPACK provides a `never-indexed` literal form for sensitive headers.

**Server push** — send a resource the client hasn't asked for. It was HTTP/2's marquee feature and
it **failed and has been removed from Chrome**: servers cannot know what is in the client's cache,
so push mostly wasted bandwidth. The replacement is `103 Early Hints`, which tells the client what
to fetch and lets the client's cache decide.

**And it still suffers TCP head-of-line blocking.** This is the crucial limitation and the whole
reason HTTP/3 exists. HTTP/2 removed HOL blocking at the application layer, then discovered that
TCP reimposes it beneath. As RFC 9114 puts it:

> *"because the parallel nature of HTTP/2's multiplexing is not visible to TCP's loss recovery
> mechanisms, a lost or reordered packet causes all active transactions to experience a stall."*

Lose one TCP segment and **every** multiplexed stream stalls for a full RTT, because TCP will not
deliver *any* subsequent byte until the hole is filled — and TCP does not know the byte stream
contains 40 independent responses. On a clean network HTTP/2 is a large win; on a lossy one it can
be **worse than six HTTP/1.1 connections**, because with six connections a loss stalls one sixth of
your requests, not all of them.

### 5.5 HTTP/3 and QUIC

**QUIC** (RFC 9000, transport; RFC 9001, TLS integration) is a complete transport protocol built
**on UDP** and implemented **in userspace**. HTTP/3 (RFC 9114, June 2022) is HTTP mapped onto it.

**Why UDP, when QUIC needs nothing UDP provides?** Two reasons, and neither is technical elegance:

1. **Ossification.** The internet is full of middleboxes — NATs, firewalls, "optimizers" — that
   parse TCP headers and reject anything unfamiliar. TCP Fast Open and even new TCP options are
   routinely dropped. **TCP cannot be evolved because the network will not let it.** UDP is the
   only remaining substrate that traverses the internet while leaving the transport programmable.
2. **Deployability.** A userspace transport ships with the browser and the server, on their release
   cadence. A kernel transport ships with the operating system, on a decade-long cadence. QUIC
   iterated more in five years than TCP did in twenty-five, purely because of this.

QUIC also **encrypts nearly the entire transport header**, including sequence numbers. This is
deliberate and defensive: middleboxes cannot inspect what they cannot read, so they cannot come to
depend on it, so QUIC does not ossify the way TCP did.

**Independent streams — the actual fix for HOL blocking.** QUIC's reliability and ordering are
**per stream**, not per connection. RFC 9114:

> *"Each request-response pair consumes a single QUIC stream. Streams are independent of each
> other, so one stream that is blocked or suffers packet loss does not prevent progress on other
> streams."*

Lose a packet carrying stream 7's data and only stream 7 waits. Streams 3, 11 and 15 are delivered
to the application immediately. This is the difference HTTP/2 could not achieve at any price,
because the ordering guarantee lived in a layer that did not know streams existed.

**Connection migration.** A QUIC connection is identified by a **Connection ID** carried in the
packet, not by the 4-tuple. Walk out of Wi-Fi range onto cellular: your IP changes, every TCP
connection dies, and QUIC continues — same connection, same keys, no handshake, no application-level
reconnect. Combined with §2.8, this also makes NAT rebinding a non-event.

**Handshake round trips**, which is the summary that matters:

```
TCP + TLS 1.2 :  1 RTT (TCP) + 2 RTT (TLS)  = 3 RTT before the first byte of HTTP
TCP + TLS 1.3 :  1 RTT (TCP) + 1 RTT (TLS)  = 2 RTT
QUIC          :                               1 RTT   (transport + crypto merged)
QUIC resumed  :                               0 RTT   (data in the very first packet)
```

QUIC merges the transport and cryptographic handshakes into one exchange — that is where the RTT
goes. At a 65 ms transatlantic RTT (§1.6), going from 3 RTT to 1 RTT saves 130 ms before any content
moves. That is the entire justification.

**QPACK (RFC 9204)** replaces HPACK, because HPACK's dynamic table requires strict ordering — the
very thing QUIC deliberately abandoned. QPACK splits the encoder/decoder state across dedicated
unidirectional streams and lets the encoder choose whether a header block may reference table
entries that might not have arrived, trading compression ratio against the risk of blocking.

**Costs, stated honestly:** QUIC burns more CPU than TCP (userspace crypto and packet handling
rather than kernel/NIC offload — historically 2–3x, closing as GSO/GRO for UDP and offloads mature);
some networks throttle or block UDP, so every client must fall back to TCP; and the loss of
transport-header visibility genuinely does make network operations harder.

### 5.6 TLS 1.3 (RFC 8446), in detail

TLS 1.3 is not an increment on 1.2. It removed everything that had been broken, which turned out to
be most of the protocol.

#### What was deleted, and why that is the story

- **All static-RSA key exchange.** In TLS 1.2 the client could encrypt the premaster secret to the
  server's RSA public key. If that key ever leaked, **every past session could be decrypted
  retroactively.** TLS 1.3 mandates ephemeral key exchange (ECDHE/DHE), so **forward secrecy is not
  optional**. This is the most important change in the protocol.
- **All CBC-mode ciphers** (Lucky13, BEAST, padding oracles), **RC4**, **3DES**, **compression**
  (CRIME), **renegotiation** (triple handshake), **custom DH groups** (Logjam), **MD5/SHA-1
  signatures**.
- The cipher suite list collapsed from **hundreds** to **five**, all AEAD:
  `TLS_AES_128_GCM_SHA256`, `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256`,
  `TLS_AES_128_CCM_SHA256`, `TLS_AES_128_CCM_8_SHA256`. A 1.3 suite names only the AEAD and the
  hash; key exchange and signature are negotiated separately. **Misconfiguration is nearly
  impossible**, which is a security property in itself.

#### The handshake, quoted from RFC 8446 §2

```
       Client                                           Server

Key  ^ ClientHello
Exch | + key_share*
     | + signature_algorithms*
     | + psk_key_exchange_modes*
     v + pre_shared_key*         -------->
                                                        ServerHello  ^ Key
                                                       + key_share*  | Exch
                                                  + pre_shared_key*  v
                                              {EncryptedExtensions}  ^  Server
                                              {CertificateRequest*}  v  Params
                                                     {Certificate*}  ^
                                               {CertificateVerify*}  | Auth
                                                         {Finished}  v
                                 <--------  [Application Data*]
     ^ {Certificate*}
Auth | {CertificateVerify*}
     v {Finished}                -------->
       [Application Data]        <------->  [Application Data]

   +  extension carried in the preceding message
   *  optional / situation-dependent
   {} encrypted with the sender's handshake_traffic_secret
   [] encrypted with the sender's application_traffic_secret_N
```

**The single trick that saved a round trip: the client speculates.** In TLS 1.2 the client offered
cipher suites, the server chose, and *then* keys were exchanged — two round trips, because you
cannot send a key share before knowing the group. TLS 1.3's `ClientHello` carries a **`key_share`
for the group the client guesses the server will pick** (in practice X25519). If the guess is right —
almost always — the server has everything it needs to derive keys from its own `ServerHello`, and
**every message after `ServerHello` is already encrypted**, including the certificate.

If the guess is wrong, the server sends `HelloRetryRequest` naming the group it wants, and the
client retries. That costs an extra round trip — degrading to TLS 1.2's cost, never worse.

**Consequences of encrypting from `ServerHello` onward:**

- **The certificate is encrypted.** A passive observer cannot see which certificate was served. In
  TLS 1.2 it was plaintext.
- **SNI is still plaintext** in the `ClientHello`, because the server needs it to select a
  certificate before any keys exist. This is the last major plaintext identifier, and
  **ECH (Encrypted Client Hello)** closes it by encrypting the real `ClientHello` inside an outer
  one, using a public key published in DNS via an **HTTPS/SVCB record** — which is why §5.2's SVCB
  and §5.6's privacy story are the same story.

**Key schedule.** Everything derives through **HKDF-Extract/Expand** in three stages — Early Secret
(from the PSK), Handshake Secret (from the ECDHE shared secret), Master Secret — with
`Derive-Secret` labels binding each key to the **transcript hash** of every handshake message so
far. Because keys depend on the transcript, tampering with any earlier message produces different
keys and the `Finished` MAC fails. This is what makes downgrade attacks structurally impossible
rather than merely detected.

**`CertificateVerify`** is the server proving it holds the private key: a signature over the
transcript hash. This is what static-RSA never did, and it is why a leaked key no longer
retroactively decrypts anything — the key signs, it does not encrypt.

#### 0-RTT, and its unavoidable weakness

```
       Client                                           Server
       ClientHello
       + early_data
       + key_share*
       + psk_key_exchange_modes
       + pre_shared_key
       (Application Data*)       -------->
                                                        ServerHello
                                                   + pre_shared_key
                                                       + key_share*
                                              {EncryptedExtensions}
                                                      + early_data*
                                                         {Finished}
                                 <--------       [Application Data*]
       (EndOfEarlyData)
       {Finished}                -------->
       [Application Data]        <------->       [Application Data]

   () encrypted with client_early_traffic_secret
```

After a prior session, the server issues a **`NewSessionTicket`** containing a PSK. On the next
connection the client sends application data **in its very first flight** — zero round trips.

**0-RTT data is replayable, and this cannot be fixed.** The early data is not covered by any
freshness exchange (there hasn't been one yet), so an attacker who captures it can resend it, and
the server cannot distinguish a replay from the original. RFC 8446 is explicit that applications
must only send **idempotent** requests in early data. In practice: `GET` yes, `POST` no. Servers
implement single-use ticket tracking and strict time windows as mitigation, but the guarantee is
weaker than for the rest of the protocol, permanently.

#### Certificates and the chain of trust

An X.509 certificate binds a **public key** to an **identity**, signed by a CA.

```
   Root CA (self-signed, in the OS/browser trust store, offline in an HSM)
      |  signs
   Intermediate CA  (online; what actually issues)
      |  signs
   Leaf: CN/SAN = www.example.com, public key, validity, EKU, SCTs
```

The **root is trusted because it is in your trust store** — a list shipped by Mozilla, Microsoft,
Apple or Google, curated by humans, with removal being the only enforcement mechanism that has ever
worked. Everything else is trusted transitively.

Validation, in order: check the signature chain up to a trusted root; verify the current time is
within each validity period; check the **SAN** (Subject Alternative Name) matches the requested host
(**CN has been deprecated for host matching for over a decade**); check basic constraints
(`CA: TRUE`) and path length on every intermediate; check key usage and EKU; check revocation.

**What a CA actually attests is narrower than people assume.** For a Domain Validated certificate —
the overwhelming majority, and what Let's Encrypt issues — the CA attests exactly one thing:

> *At the time of issuance, the requester demonstrated control over this domain name.*

Control is proven by serving a specific token at `http://domain/.well-known/acme-challenge/…`, by
publishing a DNS TXT record, or by presenting a specific certificate over TLS-ALPN. That is all.

**It does not attest** that the site is honest, safe, well-run, or the company you think it is.
`paypal-security-alert.com` gets a valid DV certificate in thirty seconds. The padlock has never
meant "trustworthy"; it means "encrypted to whoever controls this name". Browsers removed the EV
green bar precisely because users read it as a trust signal it could not support.

**OV/EV** add human verification of a legal entity, cost more, and are largely commercially dead.

**Revocation is the part that does not work.** **CRLs** are lists that grew unmanageably large.
**OCSP** requires a real-time query to the CA — which is a privacy leak (the CA learns every site
you visit), a latency cost, and a single point of failure. Because a failed OCSP check cannot be
allowed to break the web, browsers **soft-fail**: if the responder is unreachable, proceed. An
attacker who can present a revoked certificate can also block the OCSP query, so soft-fail
revocation provides no security against a network attacker. **OCSP stapling** (the server fetches
and attaches a fresh signed OCSP response) fixes the privacy and latency problems but not soft-fail,
unless the certificate carries the **Must-Staple** extension. In practice, browsers now use pushed
short lists of high-value revocations (Chrome's CRLSets, Firefox's OneCRL) and the ecosystem has
moved toward **short-lived certificates** — 90 days at Let's Encrypt, with the CA/Browser Forum
driving toward 47 days by 2029 — on the reasoning that a certificate that expires quickly does not
need to be revoked.

**Certificate Transparency (RFC 9162)** is the structural answer to "how do we know a CA behaved?"
Every issued certificate is submitted to public, **append-only, cryptographically verifiable
Merkle-tree logs**. The log returns an **SCT** (Signed Certificate Timestamp), a promise to include
the certificate, and Chrome and Safari **require SCTs or the certificate is rejected**.

Why the append-only property is the whole point: a Merkle tree lets anyone verify (a) that a
specific certificate is in the log — an inclusion proof, O(log n) — and (b) that the log has never
been rewritten — a consistency proof between two tree heads. A log operator cannot retroactively
remove or alter an entry without every monitor detecting it.

The effect: **CA misissuance became detectable rather than merely deniable.** Domain owners monitor
the logs (crt.sh, Cert Spotter) and learn within minutes if anyone issues for their domain. CT is
what caught Symantec's misissuance, which ended with Symantec's roots being distrusted by Chrome
and the business sold. That sequence — logs made it visible, visibility made distrust possible — is
the enforcement mechanism the CA system had lacked for two decades.

### 5.7 What actually happens, in order, from typing the URL to pixels

The full walkthrough. Assume Chrome, Linux, `https://www.example.com/`, warm-ish OS, cold cache for
this origin. Timings are order-of-magnitude for a ~30 ms RTT.

**Phase 0 — before any packet (0 ms)**

1. Keystrokes go to the omnibox. Chrome cannot tell yet whether this is a URL or a search, so it
   speculatively queries the search suggestion service *and* begins DNS prefetch and even TCP
   preconnect on likely completions. Some of the work below may already be done when you hit Enter.
2. Enter. The string is parsed per the WHATWG URL spec: scheme `https`, host `www.example.com`,
   port (implicit 443), path `/`. The host is normalized — lowercased, and IDN converted to
   **Punycode** (`münchen.de` → `xn--mnchen-3ya.de`). Homograph-attack defences (mixed-script
   detection) run here.
3. **HSTS check.** Chrome consults its preload list and stored HSTS state. If the domain is
   HSTS-known, an `http://` URL is rewritten to `https://` **internally, before any request**, so
   there is no plaintext request to intercept. This closes the SSL-stripping attack.
4. **Cache and service worker.** If a service worker is registered for the scope, its `fetch` event
   fires and it may serve the response entirely from `CacheStorage` — **the network is never
   touched, and everything below is skipped.** Otherwise the HTTP cache is consulted; a fresh entry
   ends the story here too, and a stale one will produce a conditional request
   (`If-None-Match` / `If-Modified-Since`).

**Phase 1 — DNS (~0–60 ms cold, ~0 ms warm)**

5. Chrome's own DNS cache (~60 s). Miss.
6. `getaddrinfo("www.example.com", "443", ...)` → glibc NSS → `/etc/nsswitch.conf` → `/etc/hosts`
   → `/etc/resolv.conf`. (If Chrome is configured for **DoH**, it skips the OS resolver entirely and
   issues an HTTPS request to its DoH endpoint — a chicken-and-egg the browser resolves by having
   the DoH server's address bootstrapped or already connected.)
7. The stub sends a UDP/53 query with RD=1 to the recursive resolver.
8. The recursive resolver iterates root → `.com` → `example.com` authoritative (§5.2), unless
   cached. **Three round trips to servers that may be anywhere on Earth, cold.**
9. Answer returns: `93.184.215.14` (A) and/or a AAAA. If both, **Happy Eyeballs v2 (RFC 8305)**
   applies: prefer IPv6, but start the IPv4 attempt after ~250 ms and take whichever connects first,
   so broken IPv6 costs a quarter second rather than a timeout.
10. If an **HTTPS/SVCB** record exists, the browser learns ALPN (`h3`), an alternate port, and any
    **ECH** public key here — allowing it to go straight to HTTP/3 and encrypt the SNI, skipping
    the Alt-Svc discovery round trip entirely.

**Phase 2 — routing the first packet (~1 ms locally)**

11. The kernel consults the routing table for `93.184.215.14` by **longest-prefix match**. Not
    local → use the default gateway, say `192.168.1.1`.
12. **ARP** for the gateway if not cached: broadcast `who-has 192.168.1.1`, receive
    `is-at aa:bb:cc:dd:ee:ff`, cache it (§2.4).
13. The kernel picks a **source address** (the egress interface's) and an **ephemeral source port**
    from `net.ipv4.ip_local_port_range`, ensuring the 4-tuple is unique.

**Phase 3 — TCP handshake (1 RTT, ~30 ms)**

14. `connect()` → the kernel builds a SYN with a random ISN (RFC 6528) and options: MSS 1460,
    window scale, SACK-permitted, timestamps (§3.1).
15. The IP header is built (TTL 64, DF set for PMTUD), the header checksum computed, and the
    packet handed to the driver — which places a descriptor in the TX ring and rings the doorbell.
    The NIC DMAs the frame out and computes the L4 checksum in hardware (§1.3).
16. The frame crosses the switch (MAC lookup), reaches the router, which **strips the frame,
    decrements TTL, recomputes the IP checksum, ARPs for its next hop, and builds a new frame**
    (§1.2). Repeat 10–20 times, each hop chosen by BGP-learned routes and longest-prefix match
    (§2.9). Somewhere in here the packet almost certainly enters a **CDN's anycast address** and
    terminates at an edge node tens of kilometres away rather than at an origin server.
17. SYN+ACK returns. The kernel sends ACK. `connect()` returns. **The connection is established and
    `cwnd = 10` — verified live in the sandbox as `snd_cwnd = 10`, `snd_ssthresh = 2147483647`**
    (§3.6).

**Phase 4 — TLS 1.3 handshake (1 RTT, ~30 ms)**

18. `ClientHello`: supported versions (1.3), the five AEAD cipher suites, `supported_groups`,
    **`key_share` with a speculative X25519 public key**, `signature_algorithms`,
    **`server_name` (SNI)** — plaintext unless ECH — and **ALPN** offering `h2`, `http/1.1`
    (and `h3` if going over QUIC).
19. `ServerHello` with the server's `key_share`. **Both sides now compute the ECDHE shared secret
    and run the HKDF key schedule.** Everything after this point is encrypted.
20. `{EncryptedExtensions}` (ALPN selection lands here), `{Certificate}` (the leaf plus
    intermediates, **encrypted**), `{CertificateVerify}` (a signature over the transcript hash,
    proving key possession), `{Finished}` (a MAC over the whole transcript).
21. The browser validates: chain to a trusted root, validity dates, **SAN** match, basic
    constraints, **CT SCTs present** (or reject), CAA/pinning policy, and revocation (soft-fail
    OCSP or a pushed CRLSet). Any failure produces the interstitial (§5.6).
22. The client sends `{Finished}`. **Handshake complete in one round trip.** Under TLS 1.2 this
    would have been two, and under 0-RTT resumption, zero.

**Phase 5 — HTTP request/response (1 RTT, ~30 ms)**

23. ALPN chose `h2`, so the client sends the HTTP/2 connection preface, a `SETTINGS` frame, and a
    `HEADERS` frame on stream 1, with pseudo-headers `:method: GET`, `:scheme: https`,
    `:authority: www.example.com`, `:path: /` — **HPACK-compressed against the static table, often
    to a few dozen bytes** (§5.4).
24. The server (a CDN edge) may serve from cache, or fetch from origin over its own pre-warmed
    connection.
25. The response returns: `HEADERS` (`:status: 200`, `content-type`, `cache-control`, `etag`,
    `strict-transport-security`, `content-security-policy`) then `DATA` frames.
26. **The first response is limited by `cwnd = 10` — about 14 KB.** Anything larger takes an extra
    round trip. This is why "keep your critical CSS under 14 KB" is real advice and not folklore,
    and why slow start is a *user-visible* phenomenon.

**Phase 6 — parse, subresources, and paint**

27. The HTML streams into the parser, which builds the **DOM incrementally** — it does not wait for
    the full document.
28. The **preload scanner** runs ahead of the parser, spotting `<img>`, `<link>`, `<script>` and
    starting those fetches immediately. This is one of the largest real-world wins in browser
    engineering.
29. Each subresource repeats **Phases 1–5** unless it is same-origin (in which case it multiplexes
    onto the existing HTTP/2 connection at essentially zero cost — the payoff for §5.4) or is
    cached.
30. CSS is fetched and parsed into the CSSOM. **CSS is render-blocking**: nothing paints until it
    is complete, because painting with the wrong styles would flash. A synchronous `<script>` is
    **parser-blocking**: it may call `document.write`, so the parser stops — hence `async` and
    `defer`.
31. DOM + CSSOM → render tree → **layout** (geometry; also called reflow) → **paint** (rasterize
    into layers) → **composite** (assemble layers, GPU-accelerated).
32. Layers are uploaded as textures and composited by the GPU. The compositor produces a frame,
    which is handed to the display pipeline and scanned out at the panel's refresh rate.
    **First Contentful Paint.**
33. `DOMContentLoaded` fires when parsing and deferred scripts finish; `load` when every subresource
    completes. JavaScript then typically fetches more data, and the cycle repeats.

**The tally.** Cold: DNS (3 RTT) + TCP (1) + TLS (1) + HTTP (1) = **six round trips** before the
first byte of HTML, plus another for anything past 14 KB. At 65 ms transatlantic that is **~400 ms
of pure latency**, none of it removable by faster hardware (§1.6). Every optimization in this
section — DNS caching, keep-alive, TLS 1.3's speculative key share, session resumption, QUIC's
merged handshake, 0-RTT, HTTP/2 multiplexing, preconnect, HSTS preload, SVCB records — exists to
delete round trips from that list. **That is the unifying idea of the entire application layer.**

---

## 6. The GPU-Cluster Networking Layer

Everything in §1–§5 was built for a network of independent machines exchanging small messages over
an unreliable, shared, contended medium. A GPU cluster is the opposite in every respect: a fixed
number of cooperating machines, a private and reliable fabric, and messages measured in gigabytes.
So essentially every design decision inverts. **The most useful way to hold this section is as a
systematic reversal of the assumptions in §3 and §4** — and the mechanism that replaces them is one
you already know from §1.3: a descriptor ring with a doorbell and a completion queue.

### 6.1 The hierarchy

```
 GPU  <-- 3.35 TB/s -->  its own HBM3                          (on-package)
 GPU  <-- 900 GB/s  -->  GPU in the same node   (NVLink 4 / NVSwitch)
 GPU  <-- 50 GB/s   -->  GPU in another node    (400 Gb/s NDR IB / RoCE)
 GPU  <-- 64 GB/s   -->  host DRAM              (PCIe Gen5 x16, bidirectional)
```

The two numbers that govern everything: **NVLink is ~9x the inter-node network**, and **HBM is
~4x NVLink**. Every design decision in distributed training is an attempt to keep traffic as far up
that list as possible. That is the whole game.

### 6.2 NVLink and NVSwitch (intra-node)

**NVLink** is a point-to-point, cache-coherent-capable GPU interconnect that replaces PCIe for
GPU-to-GPU traffic. Per NVIDIA's specifications:

| Generation | Per-GPU bandwidth | Switch aggregate | NVLink domain |
|---|---|---|---|
| NVLink 4 (Hopper, H100) | **900 GB/s** | 7.2 TB/s | 8 GPUs |
| NVLink 5 (Blackwell, B200/GB200) | **1,800 GB/s** | 130 TB/s (NVL72) | 8 or **72** GPUs |
| NVLink 6 (next gen) | **3,600 GB/s** | 260 TB/s (NVL72) | 8 or 72 |

> Note on units: NVIDIA quotes these as **aggregate bidirectional**. For the all-reduce arithmetic
> below, what matters is the **unidirectional** figure, which is half: **450 GB/s** per H100.
> Getting this wrong by 2x is the most common error in back-of-envelope cluster math.

**Why NVLink and not PCIe.** PCIe Gen5 x16 is ~64 GB/s bidirectional and is a *tree* — traffic
between two GPUs traverses a switch or, worse, the CPU root complex, contending with storage, the
NIC and everything else. NVLink is a dedicated mesh with ~14x the bandwidth, lower latency, and
native support for direct loads/stores into a peer GPU's memory (`cudaMemcpyPeer`, and unified
addressing where a pointer to peer memory is simply dereferenced).

**NVSwitch** is the crossbar. Without it, 8 GPUs are wired in a hybrid cube-mesh and bandwidth is
**non-uniform**: some pairs have several NVLinks between them, others have one, and a collective's
performance depends on which GPUs happen to be talking. NVSwitch makes it **non-blocking
all-to-all** — every GPU reaches every other at full bandwidth, and topology stops mattering. This
is what makes an 8-GPU node behave like one large GPU, and it is why tensor parallelism (§6.7) is
viable at all.

**GB200 NVL72 changes the shape of the problem.** By putting **72 GPUs in a single NVLink domain**
at 1,800 GB/s each, the boundary where you must drop from 450 GB/s to 50 GB/s moves from 8 GPUs to
72. Parallelism strategies that were previously impossible across nodes — large tensor parallel
degrees, expert parallelism for MoE models with their all-to-all traffic — become practical.

### 6.3 InfiniBand vs RoCE (inter-node)

**InfiniBand** is a purpose-built fabric, not Ethernet with extras. Verified rate table:

| Standard | Year | Per-lane signalling | Per-lane throughput | **4x link** | Encoding |
|---|---|---|---|---|---|
| EDR | 2014 | 25.78 Gb/s | 25 Gb/s | 100 Gb/s | 64b/66b |
| HDR | 2018 | 53.125 Gb/s | 50 Gb/s | **200 Gb/s** | PAM4 + 256b/257b |
| NDR | 2022 | 106.25 Gb/s | 100 Gb/s | **400 Gb/s** | PAM4 + 256b/257b |
| XDR | 2024 | 212.5 Gb/s | 200 Gb/s | **800 Gb/s** | PAM4 + 256b/257b |

Its defining property is that it is **lossless at the link layer**, using **credit-based flow
control**: a sender may not transmit unless it holds credits proving the receiver has buffer space.
Congestion therefore causes *backpressure*, never drops.

Stop and appreciate how completely this inverts §3. TCP's entire congestion-control apparatus —
slow start, AIMD, fast retransmit, RTO, CUBIC's cubic — exists to *infer* capacity from loss on a
network that drops packets when overwhelmed. InfiniBand's network **cannot drop**, so none of that
machinery is needed. Add centralized subnet management (an SM assigns LIDs and programs
deterministic routes, rather than each switch learning independently) and you get sub-microsecond
latency with no adaptive congestion control at all.

**RoCE v2** (RDMA over Converged Ethernet) puts the InfiniBand transport in a **UDP datagram**
(destination port 4791) over normal IP/Ethernet. The appeal is obvious: one fabric, standard
switches, existing operational tooling, IP routability across subnets.

The problem is equally obvious: **Ethernet drops packets, and RDMA's go-back-N recovery is
catastrophic under loss.** So RoCE must manufacture losslessness on top of a lossy fabric:

- **PFC (Priority Flow Control, 802.1Qbb)** — per-priority PAUSE frames. A congested switch tells
  its upstream to stop sending on that priority class.
- **ECN + DCQCN** — switches mark packets under queue buildup (§2.1); the receiver returns CNPs
  (Congestion Notification Packets); the sender NIC reduces its rate in hardware. This is DCTCP's
  idea (§3.6) implemented in silicon, and it is the mechanism that should keep PFC from ever
  firing.

**PFC is genuinely dangerous, and this is the single most important operational fact about RoCE.**
PAUSE is a blunt, per-hop, per-class instrument. It propagates backward through the fabric,
creating **congestion spreading** — victim flows sharing no bottleneck with the offender are
paused. Worse, because PFC creates a cyclic buffer dependency, a cycle in the pause graph produces
**PFC deadlock**: a permanently wedged fabric that no timeout resolves. Microsoft's published
experience running RoCE at scale is essentially a catalogue of these failures and the watchdogs
built to contain them.

**The practical judgement:** InfiniBand is losslessness by construction; RoCE is losslessness by
configuration, and configuration is the thing that fails at 3am. RoCE wins on cost, ecosystem and
routability, which is why hyperscalers with strong network engineering teams run it and many
smaller deployments regret it. NVIDIA's Spectrum-X is an attempt to make Ethernet behave properly
for this workload with adaptive routing and per-flow telemetry rather than PFC alone.

### 6.4 RDMA — what "kernel bypass, zero copy, no CPU" means mechanically

Not slogans. Three distinct, concrete mechanisms.

**Setup (the kernel *is* involved — once):**

1. **Memory registration.** `ibv_reg_mr(pd, addr, len, access)` — the kernel **pins** the pages
   (they can never be swapped or migrated, because the NIC will DMA to physical addresses with no
   ability to fault), builds a translation table in the NIC mapping the virtual range to physical
   pages, and returns an **`lkey`** (local key) and **`rkey`** (remote key). Registration is
   **expensive** — hundreds of microseconds — so real applications register large buffer pools once
   at startup and never again.
2. **Queue Pair creation.** A **QP** is a send queue plus a receive queue — the RDMA analogue of a
   socket, and structurally identical to the NIC descriptor rings of §1.3. A **CQ** (completion
   queue) receives completions. All three live in **userspace-mapped memory**.
3. **Connection.** QP numbers, LIDs/GIDs and packet sequence numbers are exchanged out of band
   (over TCP, typically) and the QP is transitioned INIT → RTR → RTS.

**The data path (the kernel is completely absent):**

4. The application writes a **WQE** (Work Queue Element) directly into the send queue in its own
   memory: opcode, local address + `lkey`, remote address + `rkey`, length.
5. It rings a **doorbell** — a single write to a NIC register in an mmap'd BAR page. **This is the
   entire cost of initiating a transfer: one store instruction.** No syscall. No context switch.
   No copy.
6. The NIC reads the WQE by DMA, translates the address through the registered MR, **DMAs the
   payload straight out of application memory**, and puts it on the wire.
7. The remote NIC receives it, translates the remote virtual address via the `rkey`, and **DMAs
   directly into the target application's memory**. For an RDMA WRITE, **the remote CPU is never
   interrupted and never notified.** It does not run a single instruction.
8. The local NIC DMAs a **CQE** into the completion queue. The application polls that memory (a
   cache-line read, ~100 ns) or arms an event.

Now the three claims are precise:

- **"Kernel bypass"** — after setup, no syscall on the data path. A `send()` costs ~1 µs in
  syscall, copy and stack traversal; a doorbell write costs ~100 ns.
- **"Zero copy"** — the NIC DMAs from and to the application's own registered buffers. There is no
  socket buffer, no `sk_buff`, no bounce. This is `sendfile()` (§4.6) generalized to both ends of
  the wire.
- **"No CPU involvement"** — for one-sided operations (RDMA WRITE / READ) the **remote** CPU does
  literally nothing. This is why RDMA scales: adding nodes does not add CPU load on the peers.

**The verbs:**

| Verb | Sides involved | Remote CPU | Use |
|---|---|---|---|
| **SEND / RECV** | two-sided — receiver must pre-post a RECV | notified | control messages, rendezvous setup |
| **RDMA WRITE** | one-sided — needs only the remote's `rkey` | **untouched** | bulk data push. What NCCL uses. |
| **RDMA READ** | one-sided | **untouched** | pull data; one extra round trip vs WRITE |
| **ATOMIC** (CAS, fetch-add) | one-sided | untouched | distributed locks, counters |

**RDMA WRITE is the fastest of these and the one NCCL uses**, because the sender always knows when
data is ready and a push needs no round trip to initiate.

Costs to state honestly: pinned memory cannot be swapped or migrated (an OOM and fragmentation
hazard); registration is slow, so buffer pools are mandatory; `rkey` is a **capability** — anyone
holding it can read or write that memory region, so RDMA fabrics assume a trusted network and are
not safe to expose; and classic Reliable Connection mode needs a QP per peer, so state grows as
O(N²) across the cluster (mitigated by Dynamically Connected transport and shared receive queues).

### 6.5 GPUDirect RDMA

Everything above still leaves one copy: the data is in **GPU** memory, and the NIC DMAs from
**host** memory. Without GPUDirect the path is:

```
GPU HBM  --cudaMemcpy D2H-->  host bounce buffer  --NIC DMA-->  wire
```

Two PCIe traversals, host memory bandwidth consumed, CPU involved in orchestration, and a latency
floor set by the copy.

**GPUDirect RDMA removes it.** Per NVIDIA's documentation, it is *"a technology introduced in
Kepler-class GPUs and CUDA 5.0 that enables a direct path for data exchange between the GPU and a
third-party peer device using standard features of PCI Express."*

The mechanism, and it is the same BAR trick as §1.3's doorbell, pointed the other way:

1. GPU memory is exposed through a **PCIe BAR aperture** (BAR1). The docs: *"Within this physical
   address space are linear windows called PCI BARs. Each device has six BAR registers at most, so
   it can have up to six active 32bit BAR regions."*
2. **`nvidia_p2p_get_pages()`** pins the GPU allocation and produces the physical page/BAR
   addresses the NIC needs. Docs: the NVIDIA driver *"exports functions to perform the necessary
   address translations and mappings"*, removing the CPU MMU from the path. Alignment is to 64 KB.
3. Those addresses are registered as a normal RDMA memory region. From the NIC's point of view it
   is just memory.
4. **The NIC DMAs directly to and from GPU HBM over PCIe peer-to-peer.** The path becomes
   `GPU HBM → PCIe → NIC → wire`. Host memory is never touched.
5. **Lazy unpinning** is important in practice — the docs warn that *"the most straightforward
   implementation using GPUDirect RDMA would pin memory before each transfer and unpin it right
   after"*, and that this is prohibitively slow. Keep regions pinned.

**Deployment requirements that actually bite:**

- The GPU and NIC should sit **under the same PCIe switch**, or at minimum the same root complex.
  Crossing a CPU socket over the inter-socket link (UPI/xGMI) can cut peer-to-peer bandwidth by
  more than half, and on some platforms breaks it entirely. This is why 8-GPU nodes pair each GPU
  with its own NIC under a shared switch, and why `nvidia-smi topo -m` is the first thing to check
  when performance is mysteriously bad.
- **PCIe ACS (Access Control Services) must be disabled** on the relevant bridges, or every P2P
  transaction is forced up to the root complex, defeating the purpose. Enabled by default on many
  server BIOSes; a classic silent 3x performance loss.
- `nvidia-peermem` (or the DMA-BUF path on newer kernels) must be loaded.

**GPUDirect Storage** applies the identical idea to NVMe: DMA straight from SSD into GPU memory,
bypassing the host bounce buffer for data loading.

### 6.6 NCCL

**NCCL** (NVIDIA Collective Communications Library) implements MPI-style collectives with GPU
kernels and topology-aware algorithms. It is what every training framework calls underneath
`DistributedDataParallel`, FSDP, DeepSpeed and Megatron-LM.

**The eight collectives**, per NVIDIA's documentation:

| Collective | Semantics (quoted) |
|---|---|
| **AllReduce** | *"performs reductions on data (for example, sum, min, max) across devices and stores the result in the receive buffer of every rank"* |
| **Broadcast** | *"copies an N-element buffer from the root rank to all the ranks"* |
| **Reduce** | *"the same operation as AllReduce, but stores the result only in the receive buffer of a specified root rank"* |
| **AllGather** | *"gathers N values from k ranks into an output buffer of size k*N, and distributes that result to all ranks"* |
| **ReduceScatter** | *"the same operation as Reduce, except that the result is scattered in equal-sized blocks between ranks"* |
| **AllToAll** | each rank sends chunk `j` to rank `j` and receives chunk `i` from rank `i` |
| **Gather** / **Scatter** | root-collecting and root-distributing variants |

**The identity that organizes all of them:**

```
AllReduce  ==  ReduceScatter  +  AllGather
```

This is not a curiosity. It is why ZeRO/FSDP works (§6.7), it is why the bus-bandwidth formulas
below take the shape they do, and it is the structure of the ring algorithm itself.

#### Ring all-reduce

`N` ranks in a logical ring; the buffer is split into `N` chunks.

**Phase 1 — reduce-scatter (N−1 steps).** At each step, rank `r` sends one chunk to `r+1` and
receives one from `r−1`, adding it into its own. After `N−1` steps, **rank `r` holds the fully
reduced chunk `r`** and nothing else complete.

**Phase 2 — all-gather (N−1 steps).** The same rotation, but copying instead of adding. After
`N−1` more steps every rank has every fully reduced chunk.

**Total: 2(N−1) steps, each moving S/N bytes**, so each rank sends and receives:

```
bytes per rank  =  2 * (N - 1) / N  *  S       ->  ~2S for large N
```

**Verified live.** A ring all-reduce over 8 threads connected by AF_UNIX socketpairs, running in the
sandbox with no network:

```
all-reduce over 8 ranks: every element == 36 ? YES
bytes sent per rank      = 57344
2*(N-1)/N * S  (S=32768 B) = 57344        <- exact match
```

The two properties that make this the default algorithm:

1. **Bandwidth-optimal.** `2(N−1)/N · S` is provably the minimum any all-reduce can move. No
   algorithm sends fewer bytes.
2. **Bandwidth-independent of N.** Each rank moves ~2S regardless of cluster size. This is why ring
   all-reduce replaced the parameter-server architecture, where the server moved N·S bytes and
   became the bottleneck the moment you added GPUs.

The weakness is latency: **2(N−1) sequential steps**, so latency is **O(N)**.

#### Bus bandwidth — the metric to actually use

Quoted from `nccl-tests/doc/PERFORMANCE.md`:

```
algbw = S / t                       (algorithm bandwidth: what the user perceives)

AllReduce      busbw = algbw * 2*(n-1)/n
ReduceScatter  busbw = algbw *   (n-1)/n
AllGather      busbw = algbw *   (n-1)/n
Broadcast      busbw = algbw * 1
Reduce         busbw = algbw * 1
```

The reasoning, quoted: for all-reduce *"we need 2(n-1) data transfers (x number of elements) to
perform an allReduce operation"*; for broadcast and reduce *"all data has to get out of the root
rank, hence the bottleneck is on the root rank which only has B as capacity"*, so no correction
applies.

**Why this matters practically: `busbw` is comparable across collectives and cluster sizes;
`algbw` is not.** If `busbw` is near your link's line rate, the fabric is saturated and no algorithm
change will help. If it is far below, you have a topology, configuration or algorithm problem —
check `NCCL_DEBUG=INFO` for the rings NCCL actually built, and `nvidia-smi topo -m` for whether
GPUDirect is engaging.

#### Trees, and why they exist

Ring latency is `2(N−1) · α` where `α` is the per-hop cost (~1–3 µs). At N=512 that is **1022
sequential hops ≈ 2 ms** before any bandwidth term. For a 140 GB gradient buffer, 2 ms is 0.04% —
irrelevant. For a 1 MB tensor, the bandwidth term is ~40 µs and **latency dominates by 50x**.

NCCL 2.4 introduced **double binary trees**. NVIDIA's write-up states the problem plainly: ring
*"latency scales linearly with the number of GPUs, preventing scaling above hundreds of GPUs."*

A binary tree gives `O(log N)` latency but naively halves bandwidth, because *"half or less ranks
in a binary tree are nodes and half (or more) ranks are leaves"* — leaves send and receive once
while internal nodes do double duty. The fix: **build two complementary trees** such that a rank
that is a leaf in one is an internal node in the other. Then every rank *"send[s] and receive[s]
data twice"*, which is *"as optimal as rings in terms of data sent/received"*, while retaining
logarithmic depth. NVIDIA reports the result offers *"full bandwidth and a logarithmic latency even
lower than 2D ring latency"*, and measured *"up to 180x improvement"* in latency at **24,576 GPUs**
on Summit versus rings.

**NCCL chooses ring or tree automatically** based on message size and rank count — trees for small
messages where latency rules, rings for large ones where bandwidth rules. It also splits traffic
across multiple **channels** (parallel rings/trees) to saturate all NVLinks, and uses
**NVLS/SHARP** where available, offloading the reduction arithmetic into the NVSwitch or the
InfiniBand switch itself so data is reduced *in the network* and moves once instead of twice.

#### What NCCL does at startup

Worth knowing because it explains the failure modes: NCCL detects the topology (`nvidia-smi topo`
equivalent: NVLink, NVSwitch, PCIe switches, NIC affinity, NUMA), builds rings and trees that
respect it, chooses transports per link (NVLink → P2P; same-node no-NVLink → PCIe or shared
memory; cross-node → IB verbs with GPUDirect, or TCP sockets as a fallback), and launches
persistent CUDA kernels that do the reduction arithmetic while proxy threads drive the NIC.

**The most common performance bug in a real cluster is NCCL silently falling back to TCP sockets
because GPUDirect could not be used** — wrong NIC affinity, ACS enabled, `nvidia-peermem` not
loaded. Symptom: an all-reduce 5–10x slower than expected. Diagnosis: `NCCL_DEBUG=INFO` and read
which transport it chose.

### 6.7 Why the network is often the bottleneck — the arithmetic

**The cluster.** 512 × H100 SXM: 64 nodes × 8 GPUs. NVSwitch inside each node. One 400 Gb/s NDR
ConnectX-7 per GPU.

```
intra-node (NVLink 4)  : 900 GB/s bidirectional  ->  450 GB/s unidirectional
inter-node (400G NDR)  : 400 Gb/s                ->   50 GB/s unidirectional
```

**The model.** Llama-3-70B-class: `P = 70e9` parameters, 80 layers, hidden 8192. Gradients in
bf16 → **`S = 2 × 70e9 = 140 GB` per all-reduce**.

**The step.** Global batch 4,194,304 tokens (4 Mi) → **8,192 tokens per GPU**.

---

#### Step 1 — how long is the compute?

Training FLOPs per token is `≈ 6P` (2P forward, 4P backward):

```
6 * 70e9  =  420 GFLOP per token
8192 tokens/GPU * 420e9  =  3.44e15 FLOP per GPU per step

H100 SXM bf16 dense peak = 989 TFLOP/s;  at ~40% MFU  ->  ~400 TFLOP/s effective

t_compute = 3.44e15 / 4.0e14  =  8.6 seconds
```

#### Step 2 — how long is a flat 512-way ring all-reduce?

```
bytes per rank = 2 * (511/512) * 140 GB  =  279.45 GB
t_comm         = 279.45 GB / 50 GB/s     =  5.59 seconds
```

**And there it is.**

```
step time = 8.6 + 5.59 = 14.19 s
communication = 5.59 / 14.19 = 39% of every step, doing zero arithmetic
scaling efficiency = 8.6 / 14.19 = 61%
```

**You bought 512 GPUs and 39% of your money is buying network time.** This is what "the network is
the bottleneck" means, quantitatively. And it gets worse with scale in the one term that matters:
adding GPUs shrinks `t_compute` (fewer tokens each) while `t_comm` stays at ~2S. **Communication is
the term that does not shrink**, so the ratio degrades without bound.

#### Step 3 — exploit the hierarchy (this is the actual fix)

Do not run one flat ring over 512 ranks. Use `AllReduce = ReduceScatter + AllGather` (§6.6) and put
each phase on the fastest fabric that can carry it:

```
1. Intra-node ReduceScatter over NVLink, 8 GPUs:
      (7/8) * 140 GB      = 122.5 GB  @ 450 GB/s  =  0.272 s
      each GPU now owns a fully-reduced 140/8 = 17.5 GB shard

2. Inter-node AllReduce of the 17.5 GB shards, 64 nodes:
      2 * (63/64) * 17.5 GB = 34.45 GB  @  50 GB/s  =  0.689 s

3. Intra-node AllGather over NVLink:
      (7/8) * 140 GB      = 122.5 GB  @ 450 GB/s  =  0.272 s

   total = 1.233 s      vs 5.59 s flat      ->  4.5x faster
```

The trick is entirely in step 2: **only 17.5 GB crosses the slow fabric instead of 140 GB.**
Reduce-scatter did the work of shrinking it, and the 8x reduction in inter-node bytes is exactly the
node size.

```
step time = 8.6 + 1.233 = 9.83 s      communication = 12.5%
scaling efficiency = 8.6 / 9.83 = 87%
```

#### Step 4 — overlap, and the bottleneck disappears

Gradients become available **during** the backward pass, layer by layer, not all at once. So bucket
them and launch each bucket's all-reduce as soon as it is ready, overlapping communication with the
remaining backward computation. This is exactly what PyTorch DDP's gradient buckets and FSDP's
prefetch do.

The backward pass is roughly 2/3 of the step: `≈ 5.7 s`. Since `1.233 s < 5.7 s`, **the entire
all-reduce hides underneath the backward pass** and the marginal cost approaches zero.

```
              flat ring, no overlap : 14.19 s   (61% efficiency)
        hierarchical, no overlap    :  9.83 s   (87%)
        hierarchical + overlap      : ~8.8 s    (~98%)
```

**This is the punchline of the whole section.** Naive: 61%. Hierarchy-aware: 87%. Hierarchy plus
overlap: ~98%. The hardware is identical in all three. **The difference is entirely in
understanding the network.** That is the argument for teaching this material to someone who thinks
of themselves as a GPU programmer rather than a network engineer.

#### Step 5 — the latency term, and why trees exist

The arithmetic above is pure bandwidth. Add the per-step latency `α ≈ 2 µs`:

```
ring, N=512 :  2*(N-1)   = 1022 hops * 2 us  =  2.04 ms
tree, N=512 :  2*log2(N) =   18 hops * 2 us  =  0.036 ms      -> 57x lower
```

For the 140 GB buffer, 2 ms against 5.59 s is 0.04% — ignore it. For a **1 MB** tensor:

```
bandwidth term = 2*(511/512)*1 MB / 50 GB/s  =  40 us
latency term (ring)                          = 2040 us     <- 50x larger
latency term (tree)                          =   36 us
```

**Below roughly 10 MB, the ring is entirely latency-bound and the tree wins outright.** This is why
NCCL switches algorithms by message size, and why gradient bucketing has a *lower* bound as well as
an upper one: buckets too small are latency-bound, buckets too large delay the overlap.

#### Step 6 — why tensor parallelism never leaves the node

Data parallelism all-reduces **gradients once per step**. Tensor parallelism all-reduces
**activations twice per layer, every layer, every forward and backward pass**.

For TP=8 on Llama-3-70B, micro-batch 1, sequence 8192, hidden 8192, 80 layers:

```
activation tensor       = 1 * 8192 * 8192 * 2 B      = 134.2 MB
ring all-reduce over 8  = 2*(7/8)*134.2 MB           = 234.9 MB moved per GPU
forward: 2 per layer * 80 layers = 160 all-reduces   =  37.6 GB
backward  ~2x forward                                =  75.2 GB
                                                total ~112.8 GB per step

over NVLink       @ 450 GB/s  =  0.251 s
over InfiniBand   @  50 GB/s  =  2.256 s      <- 9x worse
```

Compute for the same micro-batch is `8192 tokens × 420 GFLOP / 8 GPUs / 400 TFLOP/s ≈ 1.07 s`.

```
TP over NVLink      : 0.251 / (1.07 + 0.251) = 19% communication  -- acceptable
TP over InfiniBand  : 2.256 / (1.07 + 2.256) = 68% communication  -- unusable
```

**This is why tensor parallelism is capped at the NVLink domain size.** Not convention — arithmetic.
It is also precisely why GB200 NVL72's 72-GPU NVLink domain matters: it raises that cap from 8 to
72, and with it the size of model that can be tensor-parallelized without crossing the slow fabric.

The resulting standard layout, which now reads as a consequence rather than a convention:

```
Tensor parallel   -> INSIDE the node, over NVLink     (highest traffic, per-layer)
Pipeline parallel -> ACROSS nodes                     (lowest traffic: activations at
                                                       stage boundaries only)
Data parallel     -> ACROSS everything                (once per step, and overlappable)
```

#### Step 7 — the one-line rule

```
                    bytes moved by the collective
  t_comm  =  ---------------------------------------  +  hops * per-hop latency
                slowest link the collective crosses

  Optimize by, in order:
    1. reducing bytes            (fp8/bf16 gradients, compression, larger batches)
    2. moving them to a faster link   (hierarchy: NVLink before InfiniBand)
    3. hiding them under compute      (bucketing and overlap)
    4. reducing hops                  (trees over rings for small messages)
```

Every technique in distributed training — ZeRO/FSDP's shard-and-gather, gradient accumulation,
gradient compression, hierarchical all-reduce, SHARP in-network reduction, overlapped
backward-and-reduce — is one of those four moves.

---

## 7. Curriculum — Six Units in Dependency Order

**Design constraints.** The backend is Compiler Explorer, which compiles *and runs* C/C++ on Linux
x86-64. Outbound network access is blocked (`ENETUNREACH`, verified). But the sandbox is far richer
than that constraint suggests — **loopback TCP, epoll, io_uring, `TCP_INFO`, `SO_REUSEPORT`,
`sendfile`, and threads all work** (§8). So the exercises below do not simulate networking. They
**drive the real Linux TCP stack** and observe its actual state.

Every exercise is `assert`-based and self-checking: it prints observations and exits nonzero if an
invariant is violated. There is no test framework, no fixtures, no external data. **Every exercise
marked ✅ below was compiled and run successfully during this research.**

Progression of the single idea across the six units:

```
1. a packet is a byte layout        ->  parse it
2. a network is a lookup table      ->  build it
3. reliability is a control loop    ->  observe it
4. an API is a scaling decision     ->  measure it
5. a URL is six round trips         ->  count them
6. a collective is bytes / bandwidth->  compute it
```

---

### Unit 1 — Frames, Bytes and the Link Layer

> **The one idea:** *A packet is not an abstraction. It is a byte layout with a fixed grammar, and
> every protocol you will ever meet is a header you can parse with a pointer and a shift.*

**Prerequisites:** C++, pointers, endianness, bit manipulation.

**Content.** Ethernet frame anatomy and why the minimum is 64 bytes (§1.1). MAC addressing, the I/G
and U/L bits. Hub vs switch vs router as three different machines (§1.2). The NIC as hardware:
descriptor rings, DMA, doorbells, MSI-X, NAPI's interrupt-then-poll, offloads, RSS (§1.3–1.5).
Fibre vs copper and the 4.9 µs/km floor (§1.6).

**Exercises**

1. **CRC-32 from the polynomial. ✅** Implement the Ethernet FCS bit by bit — reflected polynomial
   `0xEDB88320`, init and final XOR `0xFFFFFFFF`. Check against the universal CRC known-answer
   vector.
   *Pass:* `crc32("123456789") == 0xCBF43926`. **Verified live.**
   *Extension:* build the 256-entry table, confirm it produces identical output, and measure the
   speedup.

2. **Ethernet frame parser. ✅** Given a byte array, extract destination and source MAC, EtherType,
   and the payload. Detect broadcast (`ff:ff:ff:ff:ff:ff`), multicast (I/G bit), and locally
   administered (U/L bit) addresses. Handle the 802.1Q case: EtherType `0x8100` means the real
   type is 4 bytes further on.
   *Pass:* asserts on a hand-built frame and a VLAN-tagged variant, plus a rejection test for a
   frame shorter than 64 bytes.

3. **Line-rate arithmetic.** Compute maximum packets-per-second for 1 / 10 / 100 GbE at 64-byte and
   1500-byte frames, accounting for the 8-byte preamble+SFD and the 12-byte IPG. Then compute the
   CPU cycle budget per packet at 3 GHz.
   *Pass:* `assert(pps_64B_at_10G == 14880952)` and `assert(fabs(ns_per_pkt - 67.2) < 0.1)`.
   *Why:* this single number motivates Units 4 and 6.

4. **A descriptor ring in C++.** Implement the RX ring of §1.3 — head owned by a "NIC" thread, tail
   by a "driver" thread, DD bits in shared memory, no locks, `std::atomic` with acquire/release
   ordering. The NIC thread fills descriptors; the driver polls DD, consumes, and reposts.
   *Pass:* every packet is delivered exactly once and in order; no descriptor is ever consumed
   before its DD bit is set. Run with 1M packets and `-fsanitize=thread`.
   *Why this is the keystone exercise:* this exact structure reappears as io_uring's SQ/CQ
   (Unit 4) and as an RDMA queue pair (Unit 6). Build it once, recognize it three times.

---

### Unit 2 — Addressing, Routing and the Path

> **The one idea:** *A network is a lookup table. Forwarding is longest-prefix match, and the
> internet is 75,000 such tables kept roughly consistent by a protocol that votes on price rather
> than distance.*

**Prerequisites:** Unit 1.

**Content.** IPv4 and IPv6 headers, field by field (§2.1, §2.3). CIDR and subnetting (§2.2).
ARP/NDP as the layer-2/layer-3 join (§2.4). Fragmentation, MTU, PMTUD and the ICMP black hole
(§2.5). ICMP as IP's control plane (§2.6). What traceroute really shows (§2.7). NAT and the five
things it breaks (§2.8). BGP: path vector, policy over distance, hijacks, RPKI (§2.9).

**Exercises**

5. **The internet checksum, and its verification identity. ✅** Implement RFC 1071 one's-complement
   addition with end-around carry. Compute the checksum of a 20-byte IPv4 header with the field
   zeroed, insert it, then re-sum the whole header.
   *Pass:* `assert(inet_cksum(header_including_checksum) == 0)`. **Verified live** — the computed
   value was `0x5303` and the verification sum was `0x0000`.
   *Extension:* the incremental-update trick (RFC 1624) — when a router decrements TTL, the
   checksum can be adjusted in O(1) rather than recomputed. Assert both paths agree.

6. **IPv4/IPv6 header parser.** Parse a full packet: Ethernet → IPv4 → TCP. Handle IHL > 5
   (options present), extract flags/fragment offset, and follow an IPv6 extension-header chain to
   find the real upper-layer protocol.
   *Pass:* asserts on constructed packets, including a fragmented one where you verify DF/MF and
   the offset-in-8-byte-units encoding.

7. **CIDR and longest-prefix match.** Parse `a.b.c.d/len`; compute network address, broadcast, host
   count and usable range. Then build a routing table and implement longest-prefix match by
   sorting prefixes descending by length.
   *Pass:* with routes `0.0.0.0/0`, `10.0.0.0/8`, `10.1.0.0/16`, `10.1.2.0/24`, assert that
   `10.1.2.3` selects the /24, `10.1.3.3` the /16, `10.2.0.1` the /8, `8.8.8.8` the default.
   *Extension:* implement a binary trie and assert it agrees with the linear scan on 10,000 random
   lookups. That is the difference between a router's data structure and a naive one.

8. **MTU and PMTUD budget.** Write a function computing the effective TCP MSS given a path MTU and
   a stack of encapsulations (IPv4/IPv6, TCP timestamps, VXLAN, WireGuard, IPsec).
   *Pass:* `assert(mss(1500, IPv4, timestamps) == 1448)` and
   `assert(mss(1500, IPv6, timestamps) == 1428)`.
   *Then:* simulate the black hole. Model a path whose MTU drops to 1400 at hop 3 with ICMP
   filtered, and show a sender retransmitting the same oversized segment forever.
   *Pass:* the simulation never converges without ICMP and converges in one step with it.

---

### Unit 3 — Reliability: TCP as a Control Loop

> **The one idea:** *TCP is two coupled feedback loops — one protecting the receiver with a number
> it is told, one protecting the network with a number it must infer — and every pathology in
> networking is one of those loops misreading its signal.*

**Prerequisites:** Units 1–2.

**Content.** The handshake and its options (§3.1). Sequence numbers as byte offsets (§3.2). Sliding
window, rwnd vs cwnd, BDP (§3.3). Cumulative vs SACK (§3.4). RTO estimation, Karn, RACK-TLP (§3.5).
Congestion control: slow start, AIMD, fast recovery; Reno vs CUBIC vs BBR (§3.6). Nagle and delayed
ACK (§3.7). TIME_WAIT (§3.8). Head-of-line blocking (§3.9). UDP (§3.10).

**Exercises**

9. **TCP header parser with pseudo-header checksum.** Parse a TCP header including options
   (MSS, window scale, SACK-permitted, timestamps — respecting the 40-byte option limit and the
   `NOP`/`EOL` padding rules). Then compute the TCP checksum over the RFC 793 pseudo-header
   (src IP, dst IP, zero, protocol, TCP length) plus the segment.
   *Pass:* re-summing the segment including its checksum yields zero — the same identity as
   exercise 5, now spanning two layers. *This is where the learner discovers that TCP's checksum
   deliberately reaches into the IP layer, and hence why NAT must recompute it (§2.8).*

10. **Sequence-number arithmetic that survives wraparound.** Implement `seq_lt`, `seq_leq`,
    `seq_gt` correctly.
    *Pass:* `assert(seq_lt(0xFFFFFFFF, 0x00000001))` — the naive `<` fails this and the modular
    `(int32_t)(a-b) < 0` passes. One assert, and the whole idea lands.

11. **Congestion control simulator.** Implement Reno and CUBIC (RFC 9438: `C = 0.4`, `β = 0.7`,
    `K = cbrt(W_max(1−β)/C)`) against a shared model: a link with a fixed BDP, a drop-tail queue,
    and loss when the queue overflows. Emit cwnd per RTT.
    *Pass:* (a) slow start doubles cwnd each RTT until `ssthresh`; (b) on loss, Reno halves and
    CUBIC multiplies by 0.7; (c) CUBIC's cwnd is flat near `t = K` and steep away from it;
    (d) CUBIC recovers to `W_max` in strictly fewer RTTs than Reno for `W_max > 100`.
    *Extension:* run two flows with a 10x RTT difference and assert Reno's throughput ratio is far
    from 1 while CUBIC's is much closer — the RTT-fairness property, demonstrated rather than
    asserted.

12. **Observe the real kernel's congestion window. ✅** Open a loopback TCP connection in one
    process (server thread and client thread), write bulk data, and sample
    `getsockopt(TCP_INFO)` and `getsockopt(TCP_CONGESTION)` as it goes.
    *Pass:* `assert(initial snd_cwnd == 10)` — RFC 6928's initial window, straight from the kernel.
    **Verified live:**
    ```
    bytes_written  cwnd  ssthresh    rtt_us   mss  unacked
            65536    10  2147483647      17  47616       2
         13172736    16  2147483647      23  65483       7
    cc algo: cubic
    ```
    *Discussion:* `ssthresh = 2147483647` means "still in slow start, no congestion event has ever
    occurred" — on loopback there is no loss, so CUBIC never leaves slow start. That negative
    result teaches more than a graph would.

13. **The Nagle / delayed-ACK deadlock, reproduced. ✅✅** Two threads, one loopback TCP connection.
    Client does `write(header)`, `write(body)`, `read(reply)`. Server reads the full 64-byte
    message and replies. Time 100 iterations with and without `TCP_NODELAY`.
    *Pass:* `assert(t_nagle > 100 * t_nodelay)`. **Verified live:**
    ```
    write-write-read, TCP_NODELAY=0 : 100 iters, 40636.6 us each
    write-write-read, TCP_NODELAY=1 : 100 iters,    43.2 us each
    ```
    **A 940x slowdown, and 40636 µs is the 40 ms Linux delayed-ACK timer measured to three
    significant figures.**
    *Then the control experiment, which matters just as much:* change the client to a strict
    `write(1 byte)` / `read(1 byte)` ping-pong and re-measure. `TCP_NODELAY` now makes **no
    difference** (measured 27 µs vs 52 µs, noise-dominated) — because with one outstanding segment
    Nagle never engages. *Pass:* assert the ratio is within 3x in either direction.
    *Why this is the best exercise in the curriculum:* the learner predicts a 40 ms stall from
    reading two RFCs written twelve years apart, then measures 40.6 ms in a sandbox with no
    network. Theory to microsecond-accurate observation, in forty lines.

14. **A reliable protocol over an unreliable channel.** Build a lossy channel abstraction over
    `socketpair` (drop, duplicate and reorder with configurable probability, driven by a seeded
    PRNG so runs are reproducible). Over it, implement stop-and-wait, then sliding-window
    Go-Back-N, then selective repeat with SACK.
    *Pass:* the received byte stream is byte-identical to the sent one at 0%, 5% and 30% loss, for
    all three. Then assert that at 5% loss, selective repeat transmits strictly fewer bytes than
    Go-Back-N — quantifying §3.4's argument rather than asserting it.

---

### Unit 4 — The Socket API, and How Servers Scale

> **The one idea:** *Every I/O API is a position on one question — who waits, and how many things
> can wait at once. select, epoll, io_uring and RDMA are four answers to that single question, and
> each one moves work further from the CPU.*

**Prerequisites:** Units 1–3, Linux syscalls, threads.

**Content.** The full server and client syscall sequences, and the SYN/accept queue distinction
(§4.1). Blocking vs non-blocking (§4.2). select/poll/epoll/kqueue and why epoll is O(1) (§4.3).
C10K and its three walls; `SO_REUSEPORT` (§4.4). io_uring (§4.5). Zero-copy: `sendfile`, `splice`,
`MSG_ZEROCOPY`, kTLS (§4.6). Kernel bypass: DPDK, AF_XDP (§4.7).

**Exercises**

15. **An echo server and client in one process. ✅** Server thread: `socket`/`setsockopt(SO_REUSEADDR)`/
    `bind(port 0)`/`getsockname`/`listen`/`accept`. Client thread: `socket`/`connect`/`write`/`read`.
    Print every syscall's return value.
    *Pass:* the echoed bytes match. **Verified live** on `127.0.0.1`, port assigned by the kernel.
    *The lesson to draw out:* `listen()` created the queues and the kernel completed the handshake;
    `accept()` only harvested the result.

16. **Demonstrate accept-queue overflow.** `listen(fd, 1)`, then connect 50 clients without ever
    calling `accept()`.
    *Pass:* observe that connects succeed past the backlog (the SYN queue absorbs them), then
    stall; assert that data written by a "connected" client is never received. Read
    `/proc/net/netstat` for `ListenOverflows` before and after and assert it increased.
    *Why:* this is a real production incident, reproduced in one file.

17. **epoll echo server, level- and edge-triggered. ✅** One thread, `epoll_wait`, N loopback client
    connections driven from another thread.
    *Pass:* all N clients get correct echoes with N = 1, 10, 200.
    *Then the trap:* switch to `EPOLLET` **without** a drain-to-`EAGAIN` loop and assert the server
    hangs with unread data. Add the loop and assert it passes. Count `epoll_wait` returns in both
    modes and assert ET makes strictly fewer calls.
    **Verified live:** `epoll_create1`/`epoll_ctl`/`epoll_wait` all functional; `epoll_wait`
    returned 1 for a ready loopback socket.

18. **select vs poll vs epoll, measured.** Register N mostly-idle connections, make one ready, and
    time the readiness call. Sweep N over 10, 100, 1000.
    *Pass:* `select` and `poll` times grow roughly linearly in N; `epoll_wait` stays flat.
    `assert(t_epoll(1000) < 2 * t_epoll(10))` and `assert(t_poll(1000) > 10 * t_poll(10))`.
    *Also:* assert that `select` cannot handle fd ≥ 1024 — attempt it and observe the failure.
    **That is the C10K problem, measured in one program.**

19. **`SO_REUSEPORT` load distribution. ✅** Four threads each create their own listening socket on
    the same port with `SO_REUSEPORT`, each with its own epoll. Connect 400 clients.
    *Pass:* every listener accepts a nonzero share, and the max/min ratio is under 2. Compare
    against one shared listener with four accepting threads and count wakeups to show the
    thundering herd. **Verified live:** `setsockopt(SO_REUSEPORT)` returned 0.

20. **io_uring from raw syscalls. ✅** No liburing. Call `io_uring_setup`, `mmap` the SQ ring, CQ
    ring and SQE array, fill an SQE, publish the tail with a release fence, call `io_uring_enter`,
    and harvest the CQE.
    *Pass:* start with `IORING_OP_NOP` and assert the CQE's `user_data` round-trips.
    **Verified live:**
    ```
    io_uring_setup -> fd 3, features = 0x3ffff
    io_uring_enter -> 1
    CQE user_data = 0xc0ffee  res = 0
    ```
    *Then:* an `IORING_OP_READ`/`IORING_OP_WRITE` echo server over a loopback socket, batching 32
    operations per `io_uring_enter`. Count syscalls and assert io_uring uses strictly fewer than
    the epoll version for the same work.
    *The recognition to force:* this is exercise 4's descriptor ring, with the kernel as the peer.

21. **`sendfile` zero-copy. ✅** Write a file to `/tmp`, then `sendfile()` it into a `socketpair`.
    *Pass:* the bytes arrive intact. **Verified live** — 15 bytes moved with no userspace buffer.
    *Then:* compare `read`+`write` against `sendfile` for a 64 MB file, counting syscalls and
    bytes copied through userspace. Assert `sendfile` performs strictly fewer syscalls.
    *Discussion:* why TLS breaks this, and what kTLS does about it (§4.6).

---

### Unit 5 — The Application Layer: DNS, HTTP, TLS

> **The one idea:** *Typing a URL costs six round trips, a round trip has a floor set by the speed
> of light, and every protocol revision of the last fifteen years is an attempt to delete one from
> that list.*

**Prerequisites:** Units 1–4.

**Content.** DNS end to end, wire format, compression pointers, caching, DNSSEC vs DoT vs DoH
(§5.2). HTTP/1.1, keep-alive, why pipelining failed, chunked encoding and request smuggling (§5.3).
HTTP/2: binary framing, multiplexing, HPACK, and the TCP head-of-line blocking it cannot escape
(§5.4). HTTP/3 and QUIC: independent streams, connection migration, 0-RTT, ossification (§5.5).
TLS 1.3: the message flow, the speculative key share that saved a round trip, the chain of trust,
what a CA attests, Certificate Transparency (§5.6). The full walkthrough (§5.7).

**Exercises**

22. **DNS query builder and response parser. ✅** Build a query from a hostname: 12-byte header,
    `RD=1`, `QDCOUNT=1`, length-prefixed labels, `QTYPE`/`QCLASS`. Then parse a response, including
    **compression pointers** (`0xC0` prefix = 14-bit offset from message start) with a jump budget
    to defeat pointer loops.
    *Pass:* round-trip a name; parse an A record's TTL and address.
    **Verified live:**
    ```
    query (33 B): 12340100000100000000000003777777076578616d706c6503636f6d0000010001
    decoded QNAME = www.example.com.
    answer NAME = www.example.com.   (encoded as C0 0C -- a pointer to offset 12)
    TYPE=1 CLASS=1 TTL=3600 RDLENGTH=4 A=93.184.215.14
    ```
    *Extension:* feed it a malicious response with a self-referential pointer and assert the parser
    terminates rather than hanging. **Every real DNS parser has had this bug.**

23. **A DNS cache with TTL semantics.** Wrap the parser in a cache keyed by `(qname, qtype)` with
    monotonic-clock expiry, plus negative caching (RFC 2308 — cache NXDOMAIN, bounded by the SOA
    minimum).
    *Pass:* a second lookup within the TTL performs zero parses; one after expiry performs one.
    Assert an NXDOMAIN is cached and expires by the SOA minimum, not the record TTL.

24. **HTTP/1.1 request builder and response parser. ✅** Emit a well-formed request as a string
    (correct CRLFs, mandatory `Host`). Parse a response: status line, headers (case-insensitive,
    with obs-fold rejected), and a body delimited by `Content-Length` **or** chunked encoding.
    *Pass:* chunked decoding verified live —
    `"1a\r\nThe quick brown fox jumps \r\n10\r\nover the lazy d\n\r\n0\r\n\r\n"` →
    `"The quick brown fox jumps over the lazy d\n"` (42 bytes).
    *Then the security exercise:* construct a message with **both** `Content-Length: 6` and
    `Transfer-Encoding: chunked`. Write two parsers — one preferring each — and show they disagree
    about where the message ends. *Pass:* assert they produce different framings; then implement
    RFC 9112's rule (reject the message) and assert it errors. **That is HTTP request smuggling,
    demonstrated in twenty lines.**

25. **HTTP/2 frames and HPACK.** Parse the 9-byte frame header (24-bit length, type, flags, 31-bit
    stream ID with the reserved bit masked). Implement HPACK decoding for the **static table**
    (61 entries) and indexed representations.
    *Pass:* assert index 2 decodes to `:method: GET`, index 4 to `:path: /`, index 7 to
    `:scheme: https`; and that a realistic 6-header request block compresses to under 15 bytes.
    *Then:* build an interleaved stream of `DATA` frames from three stream IDs and demultiplex
    them. *Pass:* each stream's bytes reassemble in order. **That is HTTP/2 multiplexing, built.**

26. **Head-of-line blocking, simulated and quantified.** Model a byte stream carrying three
    multiplexed logical streams and inject a loss.
    *Pass (TCP model):* assert that a loss in stream A's bytes delays delivery of **all** of B and
    C by one RTT. *Pass (QUIC model):* with per-stream reassembly buffers, assert B and C are
    delivered immediately while only A waits. **Assert the delivery-time difference explicitly.**
    *This makes §5.5's central claim a measured quantity rather than a story.*

27. **TLS record and handshake parser.** Parse the 5-byte record header (`ContentType`, legacy
    version, 16-bit length) and then a `ClientHello`: legacy version, 32-byte random, session ID,
    cipher suite list, compression methods, and the **extension list** — extracting `server_name`
    (SNI), `supported_versions`, `supported_groups` and `key_share`.
    *Pass:* on a hand-constructed TLS 1.3 `ClientHello`, assert SNI is `www.example.com`, that
    `supported_versions` contains `0x0304`, and that the offered `key_share` group is X25519
    (`0x001d`). Assert that the legacy version field says `0x0303` (TLS 1.2) — **the deliberate lie
    TLS 1.3 tells to get past middleboxes, which is §5.5's ossification argument made concrete.**
    *No OpenSSL required or available* — this is pure byte parsing, which is the point.

28. **Certificate chain validation logic.** Given a struct-based model of a chain (subject, issuer,
    SAN list, validity window, `isCA`, path length, key usage), implement validation: chain to a
    trusted root, check every validity window against a supplied clock, match the hostname against
    SAN with correct wildcard rules, and enforce basic constraints.
    *Pass:* accept a valid chain; and reject, with the **specific** reason, each of: expired leaf;
    hostname not in SAN; an intermediate without `isCA`; a path-length violation; a chain to an
    untrusted root; a wildcard `*.example.com` against `a.b.example.com` (wildcards match one label
    only); and `*.com`.
    *Extension:* implement a Merkle tree with inclusion and consistency proofs, and assert that a
    tampered leaf fails inclusion and a rewritten log fails consistency. **That is Certificate
    Transparency's actual guarantee, in code (§5.6).**

29. **Count the round trips.** Write a program that, given an RTT and a configuration (HTTP/1.1 vs
    /2 vs /3, TLS 1.2 vs 1.3, cold vs warm DNS, fresh vs resumed vs 0-RTT), computes time to first
    byte.
    *Pass:* assert `TCP+TLS1.2 = 3 RTT`, `TCP+TLS1.3 = 2 RTT`, `QUIC = 1 RTT`,
    `QUIC 0-RTT = 0 RTT`; and that at 65 ms RTT the gap between the worst and best case exceeds
    190 ms.
    *Then:* add the `cwnd = 10` constraint and assert that a 20 KB response costs one more round
    trip than a 12 KB one. **This is where "keep critical CSS under 14 KB" stops being folklore.**

---

### Unit 6 — Collectives: How 512 GPUs Talk

> **The one idea:** *A collective's cost is bytes divided by the bandwidth of the slowest link it
> crosses. Every technique in distributed training is one of four moves — send fewer bytes, use a
> faster link, hide the transfer under compute, or take fewer hops.*

**Prerequisites:** Units 1–5, GPU architecture.

**Content.** The bandwidth hierarchy (§6.1). NVLink and NVSwitch, and why aggregate-bidirectional
vs unidirectional is a 2x trap (§6.2). InfiniBand's credit-based losslessness vs RoCE's PFC/DCQCN,
and PFC deadlock (§6.3). RDMA mechanically: memory registration, queue pairs, doorbells,
one-sided verbs (§6.4). GPUDirect RDMA: BAR apertures, PCIe P2P, ACS (§6.5). NCCL: the eight
collectives, `AllReduce = ReduceScatter + AllGather`, ring vs double binary tree, bus bandwidth
(§6.6). The arithmetic (§6.7).

**Exercises**

30. **Ring all-reduce over socketpairs. ✅** N threads, N `socketpair`s wired into a ring. Implement
    reduce-scatter (N−1 steps of send-chunk / receive-chunk / add) then all-gather (N−1 steps of
    send-chunk / receive-chunk / copy). Count the bytes each rank sends.
    *Pass:* every element on every rank equals the sum across ranks, **and** bytes sent per rank
    equals exactly `2(N−1)/N · S`. **Verified live:**
    ```
    all-reduce over 8 ranks: every element == 36 ? YES
    bytes sent per rank        = 57344
    2*(N-1)/N * S  (S=32768 B) = 57344      <- exact
    ```
    *Implementation note discovered while validating this:* keep each chunk smaller than the socket
    buffer so `write()` never blocks. Otherwise every rank blocks writing while its neighbour
    blocks writing, and the ring deadlocks — **which is itself a worthwhile lesson about
    credit-based flow control (§6.3), and a good optional extension: make the chunk 1 MB, observe
    the deadlock, then fix it with non-blocking sockets.**

31. **The other collectives, and the identity.** Implement `ReduceScatter`, `AllGather`,
    `Broadcast` and `Reduce` on the same ring harness.
    *Pass:* `assert(AllReduce(x) == AllGather(ReduceScatter(x)))` elementwise, and that bytes moved
    by the composite equals bytes moved by the direct implementation. **The identity that organizes
    all of §6, proved by execution.**

32. **Bus bandwidth calculator.** Implement the `nccl-tests` formulas: `algbw = S/t`, and
    `busbw = algbw × 2(n−1)/n` for all-reduce, `× (n−1)/n` for reduce-scatter and all-gather,
    `× 1` for broadcast and reduce. Feed it the timings from exercises 30 and 31.
    *Pass:* the `busbw` values for all-reduce, reduce-scatter and all-gather agree within 20% —
    demonstrating that `busbw` is the comparable metric and `algbw` is not.

33. **Ring vs tree latency.** Model per-step latency `α` and per-byte cost `1/B`. Compute
    `t_ring = 2(N−1)(α + S/(N·B))` and `t_tree = 2·log2(N)·(α + S/B)`.
    *Pass:* assert the crossover exists; find it numerically for `N = 512`, `α = 2 µs`,
    `B = 50 GB/s`, and assert it falls in the 1–10 MB range. Assert the tree wins by more than 50x
    at `S = 1 MB` and loses at `S = 1 GB`. **That is NCCL's algorithm-selection heuristic,
    rediscovered.**

34. **The training-step model — the capstone.** Write a calculator taking `(P, N_gpus, gpus_per_node,
    nvlink_BW, network_BW, tokens_per_step, tflops_effective)` and returning compute time, flat-ring
    all-reduce time, hierarchical all-reduce time, and scaling efficiency for each.
    *Pass:* reproduce §6.7 exactly —
    ```
    assert(fabs(t_compute      - 8.60) < 0.1);
    assert(fabs(t_flat_ring    - 5.59) < 0.1);
    assert(fabs(t_hierarchical - 1.23) < 0.05);
    assert(fabs(eff_flat       - 0.61) < 0.01);
    assert(fabs(eff_hier       - 0.87) < 0.01);
    ```
    *Then sweep:* plot scaling efficiency against `N_gpus` from 8 to 8192 for both strategies, and
    assert the flat-ring curve degrades monotonically while the hierarchical one degrades far more
    slowly. *Then:* add the tensor-parallel model and assert TP over InfiniBand exceeds 60%
    communication while TP over NVLink stays under 25% — **deriving from arithmetic the rule that
    tensor parallelism never leaves the node.**

35. **A queue-pair simulator (optional, ties it together).** Model an RDMA QP over `socketpair`: a
    send queue of WQEs, a completion queue of CQEs, memory "registration" mapping a buffer to an
    `rkey`, and a one-sided `RDMA_WRITE` where the receiving thread **never executes any code** —
    a helper "NIC" thread performs the write into the target buffer and posts a CQE.
    *Pass:* the target buffer contains the written data and the target thread's operation counter
    is still zero. **That single assert is what "no CPU involvement" means, made mechanical
    (§6.4).**
    *Recognition:* this is exercise 4's descriptor ring and exercise 20's io_uring rings, a third
    time. If the learner sees that, the unit has done its job.

---

## 8. Sandbox Capabilities — Probed, Not Assumed

Every row below was determined by compiling and running a probe program on the Compiler Explorer
execution API. Kernel reported by `uname`: **`Linux 7.0.0-1011-aws`**. Compiler: **GCC 15.2**
(`g152`), flags `-O2 -std=c++20 -pthread`.

| Capability | Result | Evidence |
|---|---|---|
| `socketpair(AF_UNIX, SOCK_STREAM)` | ✅ works | 18 bytes round-tripped |
| `std::thread` | ✅ works | multi-threaded client/server verified |
| **Loopback TCP** (`bind`/`listen`/`accept`/`connect`) | ✅ **works** | bound `127.0.0.1:43235`, full PING/PONG |
| `bind()` to port 0 + `getsockname()` | ✅ works | kernel-assigned ports, so no port collisions between exercises |
| **`epoll_create1` / `epoll_ctl` / `epoll_wait`** | ✅ **works** | `epoll_wait` returned 1 |
| **`io_uring_setup` / `mmap` / `io_uring_enter`** | ✅ **works** | fd 3, `features=0x3ffff`, NOP CQE `user_data=0xc0ffee res=0` |
| `getsockopt(TCP_INFO)` | ✅ works | `cwnd=10 ssthresh=2147483647 rtt=17us mss=65483` |
| `getsockopt(TCP_CONGESTION)` | ✅ works | returned `cubic` |
| `setsockopt(TCP_NODELAY)` | ✅ works | 940x measured effect (§3.7) |
| `getsockopt(TCP_QUICKACK)` | ✅ works | default `1` |
| `setsockopt(SO_REUSEPORT)` | ✅ works | returned 0 |
| `sendfile()` | ✅ works | 15 bytes, file → socketpair |
| `pipe()` / `splice` prerequisites | ✅ works | — |
| File create/read/write in `/tmp` | ✅ works | `open("/tmp/x.txt", O_RDWR\|O_CREAT)` → fd 3 |
| Reading system files (`/etc/hostname`) | ❌ fails | `open` returned −1 |
| **Outbound network** | ❌ **blocked** | `connect(1.1.1.1:80)` → −1, `errno=101 ENETUNREACH` |
| `AF_PACKET` (raw frame capture) | ❌ blocked | `errno=1 EPERM` — no `CAP_NET_RAW` |
| `SOCK_RAW` (raw IP / ICMP) | ❌ blocked | `errno=1 EPERM` |
| OpenSSL headers | ❌ absent | `openssl/ssl.h: No such file or directory` |
| Wall-clock limit | ~20 s | a 2000-iteration Nagle test was SIGKILLed; 100 iterations is safe |

**What this means for exercise design.** Four things it forces, and two it unexpectedly permits:

*Forced:*
1. No live packet capture. Provide packet bytes as a `constexpr uint8_t[]` in the source, or build
   them programmatically (which is better anyway — the learner writes the serializer *and* the
   parser and asserts they round-trip).
2. No real DNS, HTTP or TLS over the network. Parse and construct wire formats instead.
3. No OpenSSL. TLS exercises are byte parsing and structural validation, not cryptography — which
   is the right level for this curriculum regardless.
4. Keep timed loops under ~15 seconds.

*Unexpectedly permitted, and this is what reshaped the curriculum:*
5. **Loopback TCP means the real kernel stack is available.** `TCP_INFO` exposes the live
   congestion window, RTT estimate and MSS. Unit 3 observes a real `cwnd = 10` rather than
   simulating one.
6. **The Nagle/delayed-ACK deadlock reproduces exactly**, at 40.6 ms per iteration. This was the
   single most valuable discovery of the research: the curriculum's best exercise needs no network
   at all.

---

## 9. What Could Not Be Verified

Stated plainly, so nothing below is taught as settled without checking.

**Verified by execution** — every runtime number in §3.6, §3.7, §4.1, §4.3, §4.5, §4.6, §5.2, §5.3,
§6.6 marked ✅, plus the whole of §8. These were run, not recalled.

**Verified by primary source** — every quoted formula and spec figure: RFC 9438's `C = 0.4` and
`β = 0.7`; RFC 8446's handshake diagrams; RFC 9114's HOL-blocking and stream-mapping statements and
its RFC cross-references (9000, 9001, 9204, 9110, 9112); the `nccl-tests` bus-bandwidth formulas;
NVIDIA's NVLink generation table; the InfiniBand rate table; the kernel NAPI and scaling
documentation quotations; the GPUDirect RDMA statements; `draft-ietf-ccwg-bbr-06`'s status and
state machine.

**Not verified — check before teaching:**

1. **Latency figures for switches, NICs and cable types (§1.6).** The ~300 ns cut-through, ~1 µs
   store-and-forward and ~2 µs 10GBASE-T PHY numbers are order-of-magnitude figures from vendor
   literature and general practice, not measurements taken here. The **4.9 µs/km fibre figure is
   arithmetic** from a group index of 1.468, which is itself wavelength- and fibre-dependent
   (1.4675–1.47 is the usual range for SMF-28 at 1550 nm) — the arithmetic is sound, the input is
   approximate.
2. **The NY–London RTT.** 65 ms is computed from ~6,600 km of cable route. Actual routes vary by
   cable system, and measured RTTs of 70–80 ms include equipment. Teach the *method*, not the
   number.
3. **"Linux stack costs 1–2 µs per packet" (§1.1, §4.7).** A widely cited range, heavily dependent
   on kernel version, CPU, mitigations (Spectre/Meltdown), and whether GRO is active. The
   *argument* (200 cycles of budget vs a much larger structural cost) is robust; the specific
   multiplier is not.
4. **DPDK's "10–100+ Mpps per core."** Vendor and benchmark figures spanning many years and
   hardware generations. Not independently checked.
5. **H100 effective TFLOP/s (§6.7).** 989 TFLOP/s bf16 dense is NVIDIA's specification; **40% MFU
   is an assumption**, chosen as a round mid-range figure. Real MFU for a 70B model ranges roughly
   35–55% depending on sequence length, parallelism strategy and framework. **Every absolute number
   in §6.7 moves with this input** — the *ratios* between the flat and hierarchical strategies do
   not, and those are the teaching point.
6. **The 4 Mi-token global batch and the 70B parameter count** are representative, not a specific
   published training run's configuration.
7. **`6P` FLOPs per token.** The standard approximation (Kaplan et al.); it excludes attention's
   quadratic term, which is non-negligible at long sequence lengths. At 8K context with 8K hidden
   the correction is small; at 128K context it is not.
8. **The NCCL "180x at 24,576 GPUs" figure** is quoted from NVIDIA's blog post and is their measured
   result on Summit. My independently derived theoretical ring/tree step ratio at that scale is far
   larger (~1,680x), which suggests their baseline was a *hierarchical* ring rather than a flat one.
   **Quote the 180x as NVIDIA's measurement; derive your own ratios separately and label them as
   theoretical.**
9. **NVLink unidirectional bandwidth.** NVIDIA quotes 900 GB/s for NVLink 4 as aggregate
   bidirectional; I have used 450 GB/s unidirectional throughout §6.7. This halving is the standard
   reading and is what makes the arithmetic consistent with published NCCL bus-bandwidth results,
   but **NVIDIA's page does not state the convention explicitly** and I could not find it stated on
   that page. Verify against `nccl-tests` output on real hardware before teaching the absolute
   numbers.
10. **NVLink 6 / "sixth generation" figures (3,600 GB/s, 260 TB/s)** come from NVIDIA's current
    marketing page and describe unreleased or newly released hardware. Treat as forward-looking.
11. **BGP table size (~1M IPv4 prefixes) and AS count (~75,000)** are approximate and grow
    continuously. Check CIDR Report or RIPE for current figures.
12. **CA/Browser Forum certificate lifetime schedule** (47 days by 2029) is a ballot outcome whose
    dates may shift.
13. **Ethernet minimum on-wire size.** I derived 84 bytes (8 + 64 + 12). The Wikipedia table
    fetched during research reported "72–1530 octets" for the layer-1 packet row, which appears to
    count preamble+SFD+frame *without* the IPG in that particular row. **The 84-byte figure is
    self-consistent and is confirmed by the canonical 14,880,952 pps at 10 GbE**, which only comes
    out right with 84. Teach 84 and show the derivation.
14. **The IPv4 header used in §2.1** is constructed, not captured. Its checksum (`0x5303`) is
    verified self-consistent by the sum-to-zero identity, which is the property being taught. It is
    not a real packet from a real capture.
15. **`tcp_info` in the sandbox is the 104-byte legacy struct** — `tcpi_bytes_acked` and other
    modern fields are absent from `<netinet/tcp.h>` there. Exercises using them must include
    `<linux/tcp.h>` instead, which was not tested.
16. **Sandbox behaviour is not contractual.** Compiler Explorer's execution environment may change
    its seccomp profile, kernel or limits at any time. Re-run the §8 probes before relying on them.

---

## 10. Sources

**RFCs (fetched from rfc-editor.org / datatracker.ietf.org)**

- [RFC 9438 — CUBIC for Fast and Long-Distance Networks](https://www.rfc-editor.org/rfc/rfc9438.html)
  (Aug 2023, Standards Track; obsoletes RFC 8312) — `C = 0.4`, `β_cubic = 0.7`, `W_cubic(t) = C(t−K)³ + W_max`
- [RFC 8446 — TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446.html) — §2 full handshake and §2.3 0-RTT diagrams, quoted verbatim
- [RFC 9114 — HTTP/3](https://www.rfc-editor.org/rfc/rfc9114.html) (Jun 2022) — HOL-blocking and stream-independence statements; cross-references to RFC 9000 (QUIC), 9001 (QUIC-TLS), 9204 (QPACK), 9110 (HTTP Semantics), 9112 (HTTP/1.1)
- [draft-ietf-ccwg-bbr](https://datatracker.ietf.org/doc/draft-ietf-ccwg-bbr/) — version **-06**, latest revision 6 July 2026, Active Internet-Draft; `BBR.max_bw`, `BBR.min_rtt`, and the Startup/Drain/ProbeBW/ProbeRTT state machine
- Referenced but not individually fetched: RFC 9293 (TCP), 5681 (Congestion Control), 6298 (RTO), 6928 (IW10), 8985 (RACK-TLP), 2018/2883 (SACK/D-SACK), 7323 (Window Scale, Timestamps, PAWS), 896 (Nagle), 1122 (Host Requirements), 6528 (ISN), 7413 (TFO), 1071 (Internet Checksum), 1624 (incremental checksum), 1191 (PMTUD), 4821 (PLPMTUD), 826 (ARP), 4861 (NDP), 8981 (IPv6 privacy addresses), 6724 (address selection), 4271 (BGP-4), 1035/2308/6891 (DNS, negative caching, EDNS0), 7858 (DoT), 8484 (DoH), 9250 (DoQ), 4033–4035 (DNSSEC), 9460 (SVCB/HTTPS records), 8305 (Happy Eyeballs v2), 9113 (HTTP/2), 7541 (HPACK), 9162 (Certificate Transparency)

**Linux kernel documentation (fetched from docs.kernel.org)**

- [NAPI](https://docs.kernel.org/networking/napi.html) — `napi_schedule()`, the poll budget, `napi_complete_done()` and IRQ unmasking, busy polling, `gro_flush_timeout` / `napi_defer_hard_irqs`
- [Scaling in the Linux Networking Stack](https://docs.kernel.org/networking/scaling.html) — RSS indirection table and Toeplitz hash, RPS, RFS, accelerated RFS (`ndo_rx_flow_steer`), XPS
- [AF_XDP](https://docs.kernel.org/networking/af_xdp.html) — UMEM, the FILL/COMPLETION/RX/TX rings, XDP_DRV vs XDP_SKB

**NVIDIA (fetched from nvidia.com / docs.nvidia.com / developer.nvidia.com)**

- [NVLink and NVLink Switch](https://www.nvidia.com/en-us/data-center/nvlink/) — per-GPU bandwidth by generation (900 / 1,800 / 3,600 GB/s), switch aggregates, NVLink domain sizes (8 | 72)
- [NCCL Collective Operations](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/collectives.html) — the eight collectives, quoted semantics
- [nccl-tests — PERFORMANCE.md](https://github.com/NVIDIA/nccl-tests/blob/master/doc/PERFORMANCE.md) — `algbw`/`busbw` and the correction factors for every collective
- [Massively Scale Deep Learning Training with NCCL 2.4](https://developer.nvidia.com/blog/massively-scale-deep-learning-training-nccl-2-4/) — double binary trees; ring latency scaling linearly; "up to 180x improvement" at 24,576 GPUs on Summit
- [GPUDirect RDMA](https://docs.nvidia.com/cuda/gpudirect-rdma/) — PCIe BAR windows, `nvidia_p2p_get_pages()`, lazy unpinning

**Reference tables**

- [InfiniBand (Wikipedia)](https://en.wikipedia.org/wiki/InfiniBand) — SDR through XDR: signalling rate, per-lane and 4x throughput, encoding
- [Ethernet frame (Wikipedia)](https://en.wikipedia.org/wiki/Ethernet_frame) — field sizes; the 84-byte minimum on-wire figure is derived and cross-checked against 14,880,952 pps at 10 GbE

**Executed**

- [Compiler Explorer execution API](https://godbolt.org/) — `POST /api/compiler/g152/compile` with `compilerOptions.executorRequest = true`. GCC 15.2, `Linux 7.0.0-1011-aws`. All ✅ results in §3.6, §3.7, §4.1, §4.3, §4.5, §4.6, §5.2, §5.3, §6.6, §7 and the whole of §8.
